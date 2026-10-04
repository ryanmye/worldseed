// Trade: the route network and the merchants travelling it.
//
//  - Flow lines: routes are bundled into the shared network of routeCurves.ts (every
//    distinct cell-to-cell link once, on one smooth curve), and each link is drawn once
//    with brightness and width from the summed volume of all the routes using it, so a
//    shared corridor reads as one line that thickens with its traffic rather than a braid.
//    Per frame nothing is uploaded: a float texture holds each link's summed volume at the
//    two trade snapshots bracketing the year, each node's largest link volume (a thin
//    branch swells into the trunk it joins, so junctions are smooth), and the road level
//    of each land link at the two land snapshots; it is rewritten only when a snapshot
//    pair changes, and the vertex shader interpolates. One draw call.
//  - Visual grammar: sea lanes are pale cyan dashes. On land the road is the corridor
//    (roads.ts draws it along the same curve): from mid zoom inward a land link that has a
//    road is left to the road, and the trade line only shows where no road has been worn
//    yet (a faint warm line); at globe zoom, where roads are faint, the warm line traces
//    the road exactly. With roads hidden every land link is drawn.
//  - The routes of the selected settlement are drawn bold on top, route by route, along
//    the same geometry (and, once closed, as a faint trace).
//  - Merchants: symbolic traffic, not simulated. Route r carries merchant k while its
//    volume exceeds a threshold that grows geometrically with k (so a minor route has
//    0-1, a major artery a handful), fading in across the threshold; all thresholds are
//    scaled by a per-snapshot factor (interpolated between snapshots) that keeps the total
//    near a budget at globe zoom (relaxed as the camera nears, so more of them fade in up
//    close), so the crowd thins smoothly instead of hitting the cap; only merchants that
//    can be in view count, and the last few slots under the cap fade rather than pop. Each merchant shuttles back and forth
//    along its route (on the shared curves) at a steady ground speed in simulated time
//    with a phase hashed from (r, k); odd merchants start the other way. Going a -> b it
//    carries goodAB, coming back goodBA, and is tinted by that good, with a thin light
//    outline: a capsule on land, a small ship at sea, larger on busy links. Positions are a
//    pure function of the year (a paused frame is static, scrubbing is exact). They go
//    into preallocated instance buffers (one draw call); the same positions feed the 3D
//    carts and ships of the diorama layer up close.
//
// Playback speed: 1x is 20 years per second, so merchants move at a symbolic pace (an
// average route takes a few seconds of wall time at 1x); at 16x they fade out and the
// flow lines carry the picture.

import * as THREE from 'three'
import { GOOD_COUNT, type TradeRoutes, type World } from '../contract.ts'
import { SUN_DIRECTION } from './globe.ts'
import { RELIEF_GLSL, reliefUniforms } from './terrainHeight.ts'
import { flat, flatUniforms, SEAM_FRAG_GLSL } from './mapProjection.ts'
import { sunUniforms } from './sun.ts'
import { HALF_SAMPLES, networkRouteSamples, routeNetwork } from './routeCurves.ts'

/**
 * Good colours (sRGB hex), indexed by Good: grain, fish, livestock, timber, ore, salt, cloth, luxury,
 * stimulant, metalware, finery, treasure, wares. Chosen to read on water and land alike (luxuries a royal
 * violet apart from the ore's magenta, stimulants a bright orange apart from the livestock's coral). The
 * last four (added for the 13-good contract) are a slate-grey for metalware (apart from ore's magenta and
 * cloth's blue), a rose pink for finery (apart from luxury's violet and livestock's coral), a gilt gold for
 * treasure (apart from grain's paler yellow) and a sandy tan for wares (apart from salt's near-white and
 * stimulant's orange). Only the first GOOD_COUNT entries are ever read, so this stays correct at 9 goods too.
 */
export const GOOD_COLORS: readonly string[] = [
  '#f7d54a', '#3fe6cf', '#f2605f', '#8fd447', '#ef7dff', '#f6f4ee', '#5f93ff', '#a65cff', '#ff9a2e',
  '#8aa8b0', '#ff6fb8', '#d9a62a', '#c2a46a',
]
/**
 * Team colour of the diorama palette (dioramas/material.ts) per good, for carts and ships. That palette has
 * only 7 usable tint slots, already one each for the original 9 goods (with luxury and stimulant reusing
 * cloth's and salt's own closest tints), so metalware, finery, treasure and wares each reuse whichever
 * existing tint reads closest to them: metalware the ore's slate blue, finery the livestock's brick red
 * (both warm, both apart from luxury's own violet dot colour), treasure the grain's ochre (gilt gold), and
 * wares the salt's thatch brown (sandy tan). Only the first GOOD_COUNT entries are ever read.
 */
const GOOD_PALETTE = [3, 6, 5, 4, 2, 7, 1, 5, 7, 2, 5, 3, 7]

/** Height of the routes above the ground (as the journey trails, so ships and carts sit right). */
const LIFT = 0.0032
/** Merchants per route at most, and visible merchants at most. */
const MAX_PER_ROUTE = 6
const MAX_MERCHANTS = 320
/** Merchants (whole globe) the per-snapshot threshold scale aims for at globe zoom, and the slots under the cap that fade. */
const MERCHANT_BUDGET = 420
const CAP_FADE_SLOTS = 48
/** Volume (loads per year) at which a route's first merchant appears; each further one needs this factor more. */
const FIRST_MERCHANT_VOLUME = 15
const MERCHANT_VOLUME_FACTOR = 3.6
/** Merchant ground speed in grid cells per simulated year, and the shortest one-way trip (years). */
const CELLS_PER_YEAR = 0.15
const MIN_TRIP_YEARS = 22
/** Merchants fade out within this arc length of a route end (they enter the town). */
const END_FADE = 0.006
/** Width of the volume texture. */
const TEX_W = 1024

export interface TradeInput {
  routes: TradeRoutes
  /** Years between trade snapshots, and their number. */
  interval: number
  snapshots: number
  /** Per trade snapshot per route (row-major). */
  volume: Float32Array
  /** Road level rows (as the road layer gets them), so land trade hands over to the roads; optional. */
  road?: { road: Uint8Array; interval: number; snapshots: number } | null
  /** The volume scale is taken over the first this many trade snapshots (so a longer history does not rescale earlier ones); default all. */
  normSnapshots?: number
}

/** Merchants as last written by setTime, in the diorama layer's TravelGroups layout. */
export interface MerchantView {
  count: number
  pos: Float32Array
  dir: Float32Array
  /** palette index, size (0..1), at sea (0|1), opacity per merchant. */
  info: Float32Array
}

export interface TradeLayer {
  object: THREE.Group
  /** Per frame: continuous year; whether the timeline is playing and at what speed multiplier. */
  setTime(year: number, playing: boolean, speed: number): void
  /** Settlement whose routes are highlighted, or -1. */
  setSelected(id: number): void
  /** Whether roads are drawn (then they carry the land legs from mid zoom inward). */
  setRoadsShown(show: boolean): void
  /** Per frame, before setTime: camera/sun in object space and viewport size. */
  update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number): void
  merchants(): MerchantView
  /** Fade merchant markers out within camera distance near..far (where models take over); far <= 0 turns it off. */
  setYield(near: number, far: number): void
  dispose(): void
}

function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function hexToLinear(hex: string): THREE.Vector3 {
  const c = new THREE.Color(hex) // three converts sRGB hex to linear working colour
  return new THREE.Vector3(c.r, c.g, c.b)
}

/** Bracketing snapshots of a continuous year. */
function bracket(year: number, interval: number, count: number): [number, number, number] {
  const last = count - 1
  const x = Math.min(Math.max(year / interval, 0), last)
  const s0 = Math.min(Math.floor(x), last)
  const s1 = Math.min(s0 + 1, last)
  return [s0, s1, s1 === s0 ? 0 : x - s0]
}

const LEVEL_GLSL = /* glsl */ `
  float level(float v) {
    return v > 0.0 ? 0.3 + 0.7 * clamp(log(1.0 + v / 4.0) / uLogMax, 0.0, 1.0) : 0.0;
  }
`

export function buildTradeLayer(world: World, input: TradeInput): TradeLayer {
  const T = input.routes
  const R = T.count
  const S = input.snapshots
  const vol = input.volume
  const cellSpacing = Math.sqrt((4 * Math.PI) / world.grid.cellCount)
  const speed = CELLS_PER_YEAR * cellSpacing // world units per year

  const net = routeNetwork(world, T.pathOffsets, T.path, R)
  const L = net.linkCount
  const NN = net.nodeCount
  const smp = networkRouteSamples(net, R, LIFT)
  const { offsets: sOff, pos: sPos, frac: sFrac, water: sWater, link: sLink } = smp

  // ---------- active routes per trade-snapshot pair (s, s + 1), largest first ----------
  const pairOff = new Uint32Array(S + 1)
  const pairTmp: number[] = []
  {
    // largest volume first, then by route id: one numeric sort of packed keys (the float32
    // volume's bits, inverted, above the route id), several times faster than a comparator
    // on long histories (R < 2^21 keeps the keys exact in a double)
    const ROUTE_BITS = 2097152
    const bits = new Uint32Array(1)
    const f32 = new Float32Array(bits.buffer)
    const keys = new Float64Array(R)
    for (let s = 0; s < S; s++) {
      const s1 = Math.min(S - 1, s + 1)
      let n = 0
      for (let r = 0; r < R; r++) {
        const m = Math.max(vol[s * R + r], vol[s1 * R + r])
        if (m > 0) {
          f32[0] = m
          keys[n++] = (0xffffffff - bits[0]) * ROUTE_BITS + r
        }
      }
      const sorted = keys.subarray(0, n).sort()
      for (let i = 0; i < n; i++) {
        const k = sorted[i]
        pairTmp.push(k - Math.floor(k / ROUTE_BITS) * ROUTE_BITS) // exact: a power-of-two divisor
      }
      pairOff[s + 1] = pairOff[s] + n
    }
  }
  const pairList = Int32Array.from(pairTmp)
  const jitter = new Float32Array(R)
  for (let r = 0; r < R; r++) jitter[r] = 0.6 + 0.8 * hash01(r, 7)

  // ---------- link volumes ----------
  const { routeLinkOffsets: rlOff, routeLinks: rLinks } = net
  /** Summed volume per link at snapshot s (routes active in pair p, which holds every route open at s). */
  function linkVolumes(s: number, p: number, out: Float32Array) {
    out.fill(0)
    for (let q = pairOff[p]; q < pairOff[p + 1]; q++) {
      const r = pairList[q]
      const v = vol[s * R + r]
      if (v <= 0) continue
      for (let k = rlOff[r]; k < rlOff[r + 1]; k++) out[rLinks[k]] += v
    }
  }
  const linkVol0 = new Float32Array(L)
  const linkVol1 = new Float32Array(L)
  let maxVol = 1
  for (let s = 0, sn = Math.min(S, input.normSnapshots ?? S); s < sn; s++) {
    linkVolumes(s, s, linkVol0)
    for (let l = 0; l < L; l++) if (linkVol0[l] > maxVol) maxVol = linkVol0[l]
  }
  const logMax = Math.log(1 + maxVol / 4)
  const levelOf = (v: number) => (v > 0 ? 0.3 + 0.7 * Math.min(1, Math.log(1 + v / 4) / logMax) : 0)

  // texels: links (volume at s0, s1; road level at l0, l1), then nodes (largest link volume at s0, s1)
  const texH = Math.max(1, Math.ceil((L + NN) / TEX_W))
  const volData = new Float32Array(TEX_W * texH * 4)
  const volTex = new THREE.DataTexture(volData, TEX_W, texH, THREE.RGBAFormat, THREE.FloatType)
  volTex.minFilter = volTex.magFilter = THREE.NearestFilter
  volTex.generateMipmaps = false
  volTex.needsUpdate = true
  // per-route volumes (selected settlement's routes)
  const rTexH = Math.max(1, Math.ceil(R / TEX_W))
  const routeData = new Float32Array(TEX_W * rTexH * 4)
  const routeTex = new THREE.DataTexture(routeData, TEX_W, rTexH, THREE.RGBAFormat, THREE.FloatType)
  routeTex.minFilter = routeTex.magFilter = THREE.NearestFilter
  routeTex.generateMipmaps = false
  routeTex.needsUpdate = true

  // ---------- flow lines: every half link once ----------
  const HS = HALF_SAMPLES
  const halves = 2 * L
  const V = halves * HS * 2
  const vPos = new Float32Array(V * 3)
  const vSide = new Float32Array(V * 4)
  const vLink = new Float32Array(V * 4)
  const vArc = new Float32Array(V)
  for (let h = 0; h < halves; h++) {
    const l = h >> 1
    const node = h & 1 ? net.linkNodeB[l] : net.linkNodeA[l]
    const arcEnd = net.halfArc[h * HS + HS - 1]
    for (let s = 0; s < HS; s++) {
      const i = h * HS + s
      const r = net.halfRadius[i] + LIFT
      for (let e = 0; e < 2; e++) {
        const v = i * 2 + e
        vPos[v * 3] = net.halfDir[i * 3] * r
        vPos[v * 3 + 1] = net.halfDir[i * 3 + 1] * r
        vPos[v * 3 + 2] = net.halfDir[i * 3 + 2] * r
        vSide[v * 4] = net.halfSide[i * 3]
        vSide[v * 4 + 1] = net.halfSide[i * 3 + 1]
        vSide[v * 4 + 2] = net.halfSide[i * 3 + 2]
        vSide[v * 4 + 3] = e === 0 ? -1 : 1
        vLink[v * 4] = l
        vLink[v * 4 + 1] = L + node
        vLink[v * 4 + 2] = s / (HS - 1)
        vLink[v * 4 + 3] = net.linkSea[l]
        vArc[v] = arcEnd - net.halfArc[i] // from the link midpoint, so dashes run on across it
      }
    }
  }
  const index = new Uint32Array(halves * (HS - 1) * 6)
  {
    let k = 0
    for (let h = 0; h < halves; h++) {
      for (let s = 0; s + 1 < HS; s++) {
        const v = (h * HS + s) * 2
        index[k++] = v; index[k++] = v + 2; index[k++] = v + 1
        index[k++] = v + 1; index[k++] = v + 2; index[k++] = v + 3
      }
    }
  }
  const lineGeom = new THREE.BufferGeometry()
  lineGeom.setAttribute('position', new THREE.BufferAttribute(vPos, 3))
  lineGeom.setAttribute('aSide', new THREE.BufferAttribute(vSide, 4))
  lineGeom.setAttribute('aLink', new THREE.BufferAttribute(vLink, 4))
  lineGeom.setAttribute('aArc', new THREE.BufferAttribute(vArc, 1))
  lineGeom.setIndex(new THREE.BufferAttribute(index, 1))

  const shared = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
    uPixel: { value: 0.001 },
    uPixelRatio: { value: 1 },
    uLogMax: { value: logMax },
    uFrac: { value: 0 },
    /** Route lines thin and fade out close to the ground (1 from mid zoom out, 0 among the 3D towns). */
    uClose: { value: 1 },
    /** How far lines and markers are lowered from LIFT toward the ground up close. */
    uDrop: { value: 0 },
  }
  const lineUniforms = {
    ...shared,
    uVol: { value: volTex },
    uRoadFrac: { value: 0 },
    uRoadCarry: { value: 1 },
  }
  const blend = {
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  } as const

  const lineMaterial = new THREE.ShaderMaterial({
    uniforms: lineUniforms,
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      attribute vec4 aSide; // side direction, across (-1|1)
      attribute vec4 aLink; // link texel, node texel, position along the half (0 node .. 1 midpoint), sea
      attribute float aArc; // arc length from the link midpoint
      uniform sampler2D uVol;
      uniform float uFrac;
      uniform float uRoadFrac;
      uniform float uRoadCarry;
      uniform float uLogMax;
      uniform float uPixel;
      uniform float uPixelRatio;
      uniform float uClose;
      uniform float uDrop;
      uniform vec3 uCamObj;
      uniform vec3 uSunObj;
      uniform float uDaylight;
      varying float vAcross;
      varying float vSoft;
      varying float vCore;
      varying float vStrength;
      varying float vArc;
      varying float vSea;
      varying float vLand;
      varying float vFacing;
      varying float vNight;
      ${LEVEL_GLSL}
      vec4 texel(float id) {
        int i = int(id + 0.5);
        return texelFetch(uVol, ivec2(i - (i / ${TEX_W}) * ${TEX_W}, i / ${TEX_W}), 0);
      }
      void main() {
        vec3 positionR = ws_relief(position); // the ground at the zoom's relief (terrainHeight.ts)
        vec4 lk = texel(aLink.x);
        float s = mix(level(lk.x), level(lk.y), uFrac);
        vSea = aLink.w;
        // on land a link with a road is the road's from mid zoom inward
        float road = vSea > 0.5 ? 0.0 : smoothstep(0.035, 0.14, mix(lk.z, lk.w, uRoadFrac));
        vLand = mix(1.0, uRoadCarry, road);
        if (s <= 0.002 || vLand < 0.004) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec4 nd = texel(aLink.y);
        float sn = mix(level(nd.x), level(nd.y), uFrac);
        // a thin branch swells into the trunk at a junction
        vStrength = mix(max(s, sn), s, smoothstep(0.0, 0.45, aLink.z));
        // half widths in CSS pixels: hairlines for minor links, a couple of pixels for arteries
        float core = (0.3 + 1.15 * vStrength * vStrength) * mix(0.45, 1.0, uClose);
        vec3 base = positionR - normalize(positionR) * uDrop;
        vec4 mv = modelViewMatrix * vec4(ws_place(base), 1.0);
        float pix = -mv.z * uPixel * uPixelRatio;
        float outer = core + 0.6;
        vCore = core / outer;
        vSoft = 0.9 / outer;
        vAcross = aSide.w;
        vec3 p = base + aSide.xyz * aSide.w * outer * pix;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(ws_placeV(p), 1.0);
        vec3 up = normalize(positionR);
        vFacing = ws_facing(dot(up, normalize(uCamObj - positionR)));
        vNight = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
        vArc = aArc;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uClose;
      varying float vAcross;
      varying float vSoft;
      varying float vCore;
      varying float vStrength;
      varying float vArc;
      varying float vSea;
      varying float vLand;
      varying float vFacing;
      varying float vNight;
      ${SEAM_FRAG_GLSL}
      void main() {
        ws_clipLine();
        float limb = smoothstep(0.0, 0.3, vFacing);
        float x = abs(vAcross);
        float coreMask = 1.0 - smoothstep(vCore - vSoft, vCore, x);
        bool sea = vSea > 0.5;
        vec3 col;
        float a;
        if (sea) {
          // dashes centred on each link midpoint, so the pattern runs on across it
          float f = abs(fract(vArc / 0.009 + 0.5) - 0.5);
          col = vec3(0.62, 0.90, 1.0);
          a = (0.24 + 0.66 * vStrength) * coreMask * (1.0 - step(0.29, f));
        } else {
          col = mix(vec3(0.95, 0.58, 0.26), vec3(1.0, 0.84, 0.55), vStrength);
          a = (0.2 + 0.66 * vStrength) * coreMask * vLand;
        }
        a *= mix(1.0, 0.5, vNight) * limb * uClose;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col * a, a);
      }
    `,
    ...blend,
  })
  const lines = new THREE.Mesh(lineGeom, lineMaterial)
  lines.frustumCulled = false
  lines.renderOrder = 6.5 // after clouds, under the journey trails and settlement markers

  // ---------- selected settlement's routes (built on selection) ----------
  const highlightUniforms = {
    ...shared,
    uRouteVol: { value: routeTex },
    uYear: { value: 0 },
  }
  const highlightMaterial = new THREE.ShaderMaterial({
    uniforms: highlightUniforms,
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      attribute vec4 aSide; // side direction, across (-1|1)
      attribute vec4 aRoute; // route id, year first opened, sea, arc length
      uniform sampler2D uRouteVol;
      uniform float uFrac;
      uniform float uLogMax;
      uniform float uYear;
      uniform float uPixel;
      uniform float uPixelRatio;
      uniform float uClose;
      uniform float uDrop;
      uniform vec3 uCamObj;
      varying float vAcross;
      varying float vSoft;
      varying float vCore;
      varying float vArc;
      varying float vSea;
      varying float vFacing;
      varying float vGhost;
      ${LEVEL_GLSL}
      void main() {
        vec3 positionR = ws_relief(position); // the ground at the zoom's relief (terrainHeight.ts)
        int id = int(aRoute.x + 0.5);
        vec4 t = texelFetch(uRouteVol, ivec2(id - (id / ${TEX_W}) * ${TEX_W}, id / ${TEX_W}), 0);
        float s = mix(level(t.x), level(t.y), uFrac);
        // a closed route stays as a faint trace
        vGhost = uYear >= aRoute.y && s < 0.15 ? 1.0 : 0.0;
        if (s <= 0.002 && vGhost < 0.5) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        float strength = max(s, vGhost * 0.15);
        float core = (1.05 + 0.75 * strength) * mix(0.4, 1.0, uClose);
        vec3 base = positionR - normalize(positionR) * uDrop;
        vec4 mv = modelViewMatrix * vec4(ws_place(base), 1.0);
        float pix = -mv.z * uPixel * uPixelRatio;
        float outer = core + mix(0.3, 1.0, uClose) + 0.6;
        vCore = core / outer;
        vSoft = 0.9 / outer;
        vAcross = aSide.w;
        vec3 p = base + aSide.xyz * aSide.w * outer * pix;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(ws_placeV(p), 1.0);
        vFacing = ws_facing(dot(normalize(positionR), normalize(uCamObj - positionR)));
        vArc = aRoute.w;
        vSea = aRoute.z;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uClose;
      varying float vAcross;
      varying float vSoft;
      varying float vCore;
      varying float vArc;
      varying float vSea;
      varying float vFacing;
      varying float vGhost;
      ${SEAM_FRAG_GLSL}
      void main() {
        ws_clipLine();
        float limb = smoothstep(0.0, 0.3, vFacing);
        float x = abs(vAcross);
        float body = 1.0 - smoothstep(1.0 - vSoft, 1.0, x);
        float coreMask = 1.0 - smoothstep(vCore - vSoft, vCore, x);
        bool sea = vSea > 0.5;
        vec3 c = sea ? vec3(0.80, 0.97, 1.0) : vec3(1.0, 0.90, 0.62);
        vec3 col = mix(vec3(0.06, 0.03, 0.01), c, coreMask);
        float a = body * mix(0.55, 1.0, coreMask);
        if (sea) a *= mix(0.3, 1.0, step(0.42, fract(vArc / 0.009)));
        if (vGhost > 0.5) a *= 0.35 * mix(0.25, 1.0, step(0.5, fract(vArc / 0.005)));
        a *= limb * uClose;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col * a, a);
      }
    `,
    ...blend,
  })
  let highlightGeom = new THREE.BufferGeometry()
  const highlight = new THREE.Mesh(highlightGeom, highlightMaterial)
  highlight.frustumCulled = false
  highlight.renderOrder = 6.6
  highlight.visible = false

  function buildHighlight(id: number) {
    highlightGeom.dispose()
    highlightGeom = new THREE.BufferGeometry()
    highlight.geometry = highlightGeom
    highlight.visible = false
    if (id < 0) return
    const routes: number[] = []
    let samples = 0
    for (let r = 0; r < R; r++) {
      if ((T.a[r] === id || T.b[r] === id) && sOff[r + 1] - sOff[r] >= 2) {
        routes.push(r)
        samples += sOff[r + 1] - sOff[r]
      }
    }
    if (routes.length === 0) return
    const hp = new Float32Array(samples * 2 * 3)
    const hs = new Float32Array(samples * 2 * 4)
    const hr = new Float32Array(samples * 2 * 4)
    const idx: number[] = []
    let v = 0
    for (const r of routes) {
      for (let s = sOff[r]; s < sOff[r + 1]; s++) {
        for (let e = 0; e < 2; e++) {
          hp[v * 3] = sPos[s * 3]
          hp[v * 3 + 1] = sPos[s * 3 + 1]
          hp[v * 3 + 2] = sPos[s * 3 + 2]
          hs[v * 4] = smp.side[s * 3]
          hs[v * 4 + 1] = smp.side[s * 3 + 1]
          hs[v * 4 + 2] = smp.side[s * 3 + 2]
          hs[v * 4 + 3] = e === 0 ? -1 : 1
          hr[v * 4] = r
          hr[v * 4 + 1] = T.openedYear[r]
          hr[v * 4 + 2] = sWater[s]
          hr[v * 4 + 3] = smp.arc[s]
          v++
        }
        if (s + 1 < sOff[r + 1]) {
          const b = v - 2
          idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
        }
      }
    }
    highlightGeom.setAttribute('position', new THREE.BufferAttribute(hp, 3))
    highlightGeom.setAttribute('aSide', new THREE.BufferAttribute(hs, 4))
    highlightGeom.setAttribute('aRoute', new THREE.BufferAttribute(hr, 4))
    highlightGeom.setIndex(idx)
    highlight.visible = true
  }

  // ---------- merchants (instanced markers) ----------
  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  quad.setIndex([0, 1, 2, 0, 2, 3])
  const mPos = new Float32Array(MAX_MERCHANTS * 3)
  const mDir = new Float32Array(MAX_MERCHANTS * 3)
  const mInfo = new Float32Array(MAX_MERCHANTS * 4) // good, size, sea, opacity
  const dInfo = new Float32Array(MAX_MERCHANTS * 4) // the same with a palette index, for the dioramas
  const dyn = (arr: Float32Array, size: number) => new THREE.InstancedBufferAttribute(arr, size).setUsage(THREE.DynamicDrawUsage)
  const mPosAttr = dyn(mPos, 3)
  const mDirAttr = dyn(mDir, 3)
  const mInfoAttr = dyn(mInfo, 4)
  quad.setAttribute('aPos', mPosAttr)
  quad.setAttribute('aDir', mDirAttr)
  quad.setAttribute('aInfo', mInfoAttr)
  quad.instanceCount = 0

  const merchantUniforms = {
    ...shared,
    uViewport: { value: new THREE.Vector2(1, 1) },
    uSizeScale: { value: 1 },
    uYield: { value: new THREE.Vector2(0, 0) },
    uGood: { value: GOOD_COLORS.slice(0, GOOD_COUNT).map(hexToLinear) },
  }
  const merchantMaterial = new THREE.ShaderMaterial({
    uniforms: merchantUniforms,
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      attribute vec3 aPos;
      attribute vec3 aDir;
      attribute vec4 aInfo; // good, size (0..1), at sea, opacity
      uniform float uPixelRatio;
      uniform float uSizeScale;
      uniform vec2 uViewport;
      uniform vec3 uCamObj;
      uniform vec3 uSunObj;
      uniform float uDaylight;
      uniform vec2 uYield;
      uniform float uDrop;
      uniform vec3 uGood[${GOOD_COUNT}];
      varying vec2 vPx;
      varying float vR;
      varying float vSea;
      varying float vAlpha;
      varying float vNight;
      varying vec3 vFill;
      void main() {
        vec3 aPosR = ws_relief(aPos); // the ground at the zoom's relief (terrainHeight.ts)
        vec3 up = normalize(aPosR);
        vec3 at = aPosR - up * uDrop;
        float facing = ws_facing(dot(up, normalize(uCamObj - at)));
        if (facing <= 0.0 || aInfo.w <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(ws_place(at), 1.0);
        vec4 ahead = projectionMatrix * modelViewMatrix * vec4(ws_place(at + aDir * 0.01), 1.0);
        vec2 d = (ahead.xy / ahead.w - clip.xy / clip.w) * uViewport;
        vec2 fwd = length(d) > 1e-5 ? normalize(d) : vec2(1.0, 0.0);
        vec2 side = vec2(-fwd.y, fwd.x);
        float r = (1.2 + 0.95 * aInfo.y) * uSizeScale * mix(0.6, 1.0, sqrt(facing));
        float ext = r * 2.4 + 3.0;
        vec2 offPx = (fwd * position.x + side * position.y) * ext;
        clip.xy += offPx * uPixelRatio * 2.0 / uViewport * clip.w;
        gl_Position = clip;
        vPx = position.xy * ext;
        vR = r;
        vSea = aInfo.z;
        vAlpha = aInfo.w * smoothstep(0.0, 0.3, facing);
        if (uYield.y > 0.0) vAlpha *= smoothstep(uYield.x, uYield.y, length(uCamObj - at));
        vNight = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
        vFill = uGood[int(aInfo.x + 0.5)];
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vPx;
      varying float vR;
      varying float vSea;
      varying float vAlpha;
      varying float vNight;
      varying vec3 vFill;
      float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
        vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
        vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
        vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
        vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
        vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
        float s = sign(e0.x * e2.y - e0.y * e2.x);
        vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                         vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                         vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
        return -sqrt(d.x) * sign(d.y);
      }
      void main() {
        float d;
        if (vSea > 0.5) {
          // a small ship: an arrowhead with a notched stern, pointing along +x
          float L = vR * 2.2;
          float W = vR * 1.45;
          float hull = sdTri(vPx, vec2(L, 0.0), vec2(-L * 0.8, W), vec2(-L * 0.8, -W));
          float notch = sdTri(vPx, vec2(-L * 0.25, 0.0), vec2(-L * 1.2, W * 1.4), vec2(-L * 1.2, -W * 1.4));
          d = max(hull, -notch);
        } else {
          // a caravan: a short capsule along the road (settlement markers are round)
          vec2 q = vec2(max(abs(vPx.x) - vR * 0.75, 0.0), vPx.y);
          d = length(q) - vR * 0.8;
        }
        // the good's colour, a hairline dark seam, then a thin light outline that reads on
        // dark water and bright land alike
        float fill = 1.0 - smoothstep(-0.75, -0.15, d);
        float seam = 1.0 - smoothstep(0.05, 0.45, d);
        float body = 1.0 - smoothstep(0.75, 1.25, d);
        vec3 c = mix(vec3(0.96, 0.95, 0.90), mix(vec3(0.06, 0.05, 0.04), vFill, fill), seam);
        float a = body * mix(0.8, 1.0, seam);
        float k = vAlpha * mix(1.0, 0.6, vNight);
        a *= k;
        if (a < 0.004) discard;
        gl_FragColor = vec4(c * a, a);
      }
    `,
    ...blend,
  })
  const merchantMesh = new THREE.Mesh(quad, merchantMaterial)
  merchantMesh.frustumCulled = false
  merchantMesh.renderOrder = 8.8 // over the settlement markers and structure icons, under travelling settlers

  const object = new THREE.Group()
  object.name = 'trade'
  object.add(lines, highlight, merchantMesh)

  // ---------- merchant budget: a threshold scale per trade snapshot ----------
  const thresholdScale = new Float32Array(S) // 0: not computed yet
  const logFactor = Math.log(MERCHANT_VOLUME_FACTOR)
  /** Merchants at snapshot s (half faded in or more) with thresholds scaled by g. */
  function merchantCount(s: number, g: number): number {
    let n = 0
    for (let q = pairOff[s]; q < pairOff[s + 1]; q++) {
      const r = pairList[q]
      const v = vol[s * R + r]
      const base = FIRST_MERCHANT_VOLUME * jitter[r] * g * 0.78
      if (v < base) continue
      n += Math.min(MAX_PER_ROUTE, Math.floor(Math.log(v / base) / logFactor) + 1)
    }
    return n
  }
  function scaleAt(s: number): number {
    if (thresholdScale[s] > 0) return thresholdScale[s]
    let g = 1
    if (merchantCount(s, 1) > MERCHANT_BUDGET) {
      let lo = 0, hi = Math.log(1e4)
      for (let it = 0; it < 18; it++) {
        const m = (lo + hi) / 2
        if (merchantCount(s, Math.exp(m)) > MERCHANT_BUDGET) lo = m
        else hi = m
      }
      g = Math.exp(hi)
    }
    thresholdScale[s] = g
    return g
  }

  const tmpQ = new THREE.Quaternion()
  const camObj = new THREE.Vector3(0, 0, 3)
  const view: MerchantView = { count: 0, pos: mPos, dir: mDir, info: dInfo }
  let shownS0 = -1
  let shownS1 = -1
  let shownL0 = -1
  let shownL1 = -1
  let roadsShown = true
  /** Cosine of the angle from the point under the camera beyond which a merchant cannot be in view. */
  let cosView = 0

  function upload(attr: THREE.InstancedBufferAttribute, n: number) {
    attr.clearUpdateRanges()
    attr.addUpdateRange(0, n * attr.itemSize)
    attr.needsUpdate = true
  }

  /** Index of the last sample at or before fraction p of route r. */
  function sampleAt(r: number, p: number): number {
    let lo = sOff[r], top = sOff[r + 1] - 2
    while (lo < top) {
      const m = (lo + top + 1) >>> 1
      if (sFrac[m] <= p) lo = m
      else top = m - 1
    }
    return lo
  }

  function writeMerchants(year: number, s0: number, s1: number, frac: number, fade: number) {
    let n = 0
    if (fade > 0) {
      const cl = camObj.length() || 1
      const cx = camObj.x / cl, cy = camObj.y / cl, cz = camObj.z / cl
      // closer in, where less of the globe is in view, the budget thins the crowd less
      // (continuous in the zoom, so merchants fade in as the camera nears)
      const zoomFactor = Math.min(1, Math.max(0.35, (cl - 1.5) / 1.3))
      const g = Math.exp((Math.log(scaleAt(s0)) * (1 - frac) + Math.log(scaleAt(s1)) * frac) * zoomFactor)
      outer: for (let q = pairOff[s0]; q < pairOff[s0 + 1]; q++) {
        const r = pairList[q]
        const v0 = vol[s0 * R + r], v1 = vol[s1 * R + r]
        const presence = (v0 > 0 ? 1 - frac : 0) + (v1 > 0 ? frac : 0)
        const L = smp.length[r]
        if (presence <= 0 || L <= 0 || sOff[r + 1] - sOff[r] < 2) continue
        const v = v0 + (v1 - v0) * frac
        const trip = Math.max(MIN_TRIP_YEARS, L / speed)
        let threshold = FIRST_MERCHANT_VOLUME * jitter[r] * g
        for (let k = 0; k < MAX_PER_ROUTE; k++, threshold *= MERCHANT_VOLUME_FACTOR) {
          if (v < threshold * 0.7) break
          let a = presence * fade * Math.min(1, (v - threshold * 0.7) / (threshold * 0.3))
          // back and forth: the first half of the cycle a -> b, the second b -> a
          const w = year / (2 * trip) + hash01(r, k) + (k & 1) * 0.5
          const c = w - Math.floor(w)
          const forward = c < 0.5
          const p = forward ? 2 * c : 2 - 2 * c
          const fromEnd = Math.min(p, 1 - p) * L
          a *= Math.min(1, fromEnd / END_FADE)
          if (a < 0.02) continue
          const lo = sampleAt(r, p)
          const f0 = sFrac[lo], f1 = sFrac[lo + 1]
          const u = f1 > f0 ? Math.min(1, Math.max(0, (p - f0) / (f1 - f0))) : 0
          const i0 = lo * 3, i1 = lo * 3 + 3
          const dx = sPos[i1] - sPos[i0], dy = sPos[i1 + 1] - sPos[i0 + 1], dz = sPos[i1 + 2] - sPos[i0 + 2]
          const x = sPos[i0] + dx * u, y = sPos[i0 + 1] + dy * u, z = sPos[i0 + 2] + dz * u
          // only what can be in view counts toward the cap
          if ((x * cx + y * cy + z * cz) / (Math.hypot(x, y, z) || 1) < cosView) continue
          // the last slots under the cap fade, so the crowd thins instead of popping
          a *= Math.min(1, (MAX_MERCHANTS - n) / CAP_FADE_SLOTS)
          const l = (forward ? 1 : -1) / (Math.hypot(dx, dy, dz) || 1)
          mPos[n * 3] = x
          mPos[n * 3 + 1] = y
          mPos[n * 3 + 2] = z
          mDir[n * 3] = dx * l
          mDir[n * 3 + 1] = dy * l
          mDir[n * 3 + 2] = dz * l
          const good = forward ? T.goodAB[r] : T.goodBA[r]
          const gi = good < GOOD_COUNT ? good : 0
          const sea = sWater[u < 0.5 ? lo : lo + 1]
          // larger on busy links
          const lk = sLink[lo]
          const sizeT = Math.sqrt(levelOf(linkVol0[lk] + (linkVol1[lk] - linkVol0[lk]) * frac))
          mInfo[n * 4] = gi
          mInfo[n * 4 + 1] = sizeT
          mInfo[n * 4 + 2] = sea
          mInfo[n * 4 + 3] = a
          dInfo[n * 4] = GOOD_PALETTE[gi]
          dInfo[n * 4 + 1] = sizeT
          dInfo[n * 4 + 2] = sea
          dInfo[n * 4 + 3] = a
          if (++n >= MAX_MERCHANTS) break outer
        }
      }
    }
    quad.instanceCount = n
    view.count = n
    if (n > 0) {
      upload(mPosAttr, n)
      upload(mDirAttr, n)
      upload(mInfoAttr, n)
    }
  }

  const road = input.road ?? null
  const N = world.grid.cellCount
  function setRoadRows(l0: number, l1: number) {
    if (!road) return
    const o0 = l0 * N, o1 = l1 * N
    const rd = road.road
    for (let l = 0; l < L; l++) {
      if (net.linkSea[l]) continue
      const a = net.linkA[l], b = net.linkB[l]
      volData[l * 4 + 2] = Math.min(rd[o0 + a], rd[o0 + b]) / 255
      volData[l * 4 + 3] = Math.min(rd[o1 + a], rd[o1 + b]) / 255
    }
  }

  return {
    object,
    setTime(year: number, playing: boolean, playSpeed: number) {
      const [s0, s1, frac] = bracket(year, input.interval, S)
      let dirty = false
      if (s0 !== shownS0 || s1 !== shownS1) {
        linkVolumes(s0, s0, linkVol0)
        linkVolumes(s1, s0, linkVol1)
        for (let l = 0; l < L; l++) {
          volData[l * 4] = linkVol0[l]
          volData[l * 4 + 1] = linkVol1[l]
        }
        for (let nd = 0; nd < NN; nd++) {
          let m0 = 0, m1 = 0
          for (let k = net.nodeLinkOffsets[nd]; k < net.nodeLinkOffsets[nd + 1]; k++) {
            const l = net.nodeLinks[k]
            if (linkVol0[l] > m0) m0 = linkVol0[l]
            if (linkVol1[l] > m1) m1 = linkVol1[l]
          }
          volData[(L + nd) * 4] = m0
          volData[(L + nd) * 4 + 1] = m1
        }
        for (let r = 0; r < R; r++) {
          routeData[r * 4] = vol[s0 * R + r]
          routeData[r * 4 + 1] = vol[s1 * R + r]
        }
        routeTex.needsUpdate = true
        shownS0 = s0
        shownS1 = s1
        dirty = true
      }
      if (road) {
        const [l0, l1, lf] = bracket(year, road.interval, road.snapshots)
        lineUniforms.uRoadFrac.value = lf
        if (l0 !== shownL0 || l1 !== shownL1) {
          setRoadRows(l0, l1)
          shownL0 = l0
          shownL1 = l1
          dirty = true
        }
      }
      if (dirty) volTex.needsUpdate = true
      shared.uFrac.value = frac
      highlightUniforms.uYear.value = year
      // symbolic traffic: readable up to 4x, gone at 16x (the flow lines carry it)
      const fade = !playing || playSpeed <= 1 ? 1 : playSpeed <= 4 ? 0.8 : 0
      writeMerchants(year, s0, s1, frac, fade)
    },
    setSelected(id: number) {
      buildHighlight(id)
    },
    setRoadsShown(show: boolean) {
      roadsShown = show
    },
    update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number) {
      object.updateWorldMatrix(true, false)
      object.getWorldQuaternion(tmpQ).invert()
      shared.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      camera.getWorldPosition(camObj)
      object.worldToLocal(camObj)
      shared.uCamObj.value.copy(camObj)
      shared.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, drawSize.y)
      shared.uPixelRatio.value = pixelRatio
      merchantUniforms.uViewport.value.copy(drawSize)
      const dist = camObj.length()
      // the part of the globe in view: the view cone's corner ray, a margin for the
      // tilted view up close, and never past the horizon
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
      const corner = Math.atan(Math.hypot(tanV, tanV * camera.aspect))
      const horizon = Math.acos(Math.min(1, 1 / Math.max(1, dist)))
      const k = dist * Math.sin(corner)
      cosView = Math.cos(Math.min(horizon, (k < 1 ? Math.asin(k) - corner : horizon) + 0.25))
      // on the flat map the whole view is the map around the centre (mapProjection.ts): its
      // half diagonal in map units, generously (the projection stretches toward the edges)
      if (flat.t > 0) cosView = Math.cos(Math.min(Math.PI, (dist - 1) * Math.tan(corner) * 1.8 + 0.25))
      merchantUniforms.uSizeScale.value = Math.min(1.4, Math.max(0.85, Math.sqrt(3.25 / dist)))
      // From mid zoom inward the roads carry the land legs: the warm line on a road (the
      // same curve, so never a second line beside it) fades to a tint, and is gone up close
      // where the road ribbon is wide.
      const smooth = (a: number, b: number) => {
        const t = Math.min(1, Math.max(0, (dist - a) / (b - a)))
        return t * t * (3 - 2 * t)
      }
      lineUniforms.uRoadCarry.value = roadsShown && road ? smooth(1.3, 1.65) * (0.35 + 0.65 * smooth(1.9, 2.7)) : 1
      // among the 3D towns the road, carts and ships carry the picture: route lines thin
      // and fade out, and lines and markers come down from their lift toward the ground
      const alt = dist - 1
      shared.uClose.value = smooth(1.1, 1.35)
      shared.uDrop.value = LIFT * (1 - Math.min(1, Math.max(0.06, alt / 0.6)))
      lines.visible = shared.uClose.value > 0.003
    },
    merchants() {
      return view
    },
    setYield(near: number, far: number) {
      merchantUniforms.uYield.value.set(near, far)
    },
    dispose() {
      lineGeom.dispose()
      highlightGeom.dispose()
      quad.dispose()
      lineMaterial.dispose()
      highlightMaterial.dispose()
      merchantMaterial.dispose()
      volTex.dispose()
      routeTex.dispose()
    },
  }
}
