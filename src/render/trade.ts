// Trade: the route network and the merchants travelling it.
//
//  - Routes: every route is smoothed once into a sampled curve (routeCurves.ts, the
//    approach of the journey trails, so land legs stay on land and sea legs at sea) and
//    laid into one static ribbon buffer. Per frame nothing is uploaded: a small float
//    texture holds each route's volume at the two trade snapshots bracketing the year
//    (rewritten only when that pair changes) and the vertex shader interpolates it, so a
//    route fades in as it opens and out as it closes, and brightness and width follow
//    log volume. Land legs are a warm line, sea lanes a pale cyan dashed one. The routes
//    of the selected settlement are drawn bold (and, once closed, as a faint trace).
//    One draw call; the draw range stops at the last route opened by the current year.
//  - Merchants: symbolic traffic, not simulated. Route r carries merchant k while its
//    volume exceeds a threshold that grows geometrically with k (so a minor route has
//    0-1, a major artery a handful), fading in across the threshold. Each merchant shuttles
//    back and forth at a steady ground speed in simulated time with a phase hashed from
//    (r, k); odd merchants start the other way. Going a -> b it carries goodAB, coming back
//    goodBA, and is tinted by that good: a dot on land, a small ship at sea. Positions are
//    a pure function of the year (a paused frame is static, scrubbing is exact). Per frame
//    only the routes active at the current trade-snapshot pair are visited (precomputed
//    lists, largest first) until a global cap of visible merchants is reached; they go
//    into preallocated instance buffers (one draw call). The same positions feed the 3D
//    carts and ships of the diorama layer up close.
//
// Playback speed: 1x is 20 years per second, so merchants move at a symbolic pace (an
// average route takes a few seconds of wall time at 1x); at 16x they fade out and the
// route lines carry the picture.

import * as THREE from 'three'
import { GOOD_COUNT, type TradeRoutes, type World } from '../contract.ts'
import { SUN_DIRECTION } from './globe.ts'
import { sunUniforms } from './sun.ts'
import { smoothPaths } from './routeCurves.ts'

/** Good colours (sRGB hex), indexed by Good: grain, fish, livestock, timber, ore, salt. */
export const GOOD_COLORS: readonly string[] = ['#f6e27c', '#4fc0f2', '#ef6f68', '#8ad04c', '#b996ff', '#f4f2ea']
/** Team colour of the diorama palette (dioramas/material.ts) per good, for carts and ships. */
const GOOD_PALETTE = [3, 6, 5, 4, 2, 7]

/** Height of the routes above the ground (as the journey trails, so ships and carts sit right). */
const LIFT = 0.0032
/** Merchants per route at most, and visible merchants at most. */
const MAX_PER_ROUTE = 6
const MAX_MERCHANTS = 320
/** Volume (loads per year) at which a route's first merchant appears; each further one needs this factor more. */
const FIRST_MERCHANT_VOLUME = 15
const MERCHANT_VOLUME_FACTOR = 3.6
/** Merchant ground speed in grid cells per simulated year, and the shortest one-way trip (years). */
const CELLS_PER_YEAR = 0.15
const MIN_TRIP_YEARS = 22
/** Merchants fade out within this arc length of a route end (they enter the town). */
const END_FADE = 0.006

export interface TradeInput {
  routes: TradeRoutes
  /** Years between trade snapshots, and their number. */
  interval: number
  snapshots: number
  /** Per trade snapshot per route (row-major). */
  volume: Float32Array
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
  /** Draw the land legs fainter up close, where the roads carry them. */
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

export function buildTradeLayer(world: World, input: TradeInput): TradeLayer {
  const T = input.routes
  const R = T.count
  const S = input.snapshots
  const vol = input.volume
  const cellSpacing = Math.sqrt((4 * Math.PI) / world.grid.cellCount)
  const speed = CELLS_PER_YEAR * cellSpacing // world units per year

  const smp = smoothPaths(world, T.pathOffsets, T.path, R, LIFT)
  const { offsets: sOff, pos: sPos, side: sSide, arc: sArc, frac: sFrac, water: sWater } = smp

  let maxVol = 1
  for (let i = 0; i < S * R; i++) if (vol[i] > maxVol) maxVol = vol[i]
  const logMax = Math.log(1 + maxVol / 4)
  const levelOf = (v: number) => (v > 0 ? 0.3 + 0.7 * Math.min(1, Math.log(1 + v / 4) / logMax) : 0)

  // ---------- active routes per trade-snapshot pair (s, s + 1), largest first ----------
  const pairOff = new Uint32Array(S + 1)
  const pairTmp: number[] = []
  const pairKey = new Float32Array(R)
  {
    const lists: number[][] = []
    for (let s = 0; s < S; s++) {
      const s1 = Math.min(S - 1, s + 1)
      const list: number[] = []
      for (let r = 0; r < R; r++) {
        const m = Math.max(vol[s * R + r], vol[s1 * R + r])
        if (m > 0) {
          list.push(r)
          pairKey[r] = m
        }
      }
      list.sort((a, b) => pairKey[b] - pairKey[a] || a - b)
      lists.push(list)
      pairOff[s + 1] = pairOff[s] + list.length
    }
    for (const l of lists) for (const r of l) pairTmp.push(r)
  }
  const pairList = Int32Array.from(pairTmp)
  const jitter = new Float32Array(R)
  for (let r = 0; r < R; r++) jitter[r] = 0.6 + 0.8 * hash01(r, 7)

  // ---------- route ribbons ----------
  const ns = sOff[R]
  const V = ns * 2
  const vPos = new Float32Array(V * 3)
  const vSide = new Float32Array(V * 4)
  const vRoute = new Float32Array(V * 4)
  const vArc = new Float32Array(V * 2)
  {
    let r = 0
    for (let s = 0; s < ns; s++) {
      while (sOff[r + 1] <= s) r++
      for (let e = 0; e < 2; e++) {
        const v = s * 2 + e
        vPos[v * 3] = sPos[s * 3]
        vPos[v * 3 + 1] = sPos[s * 3 + 1]
        vPos[v * 3 + 2] = sPos[s * 3 + 2]
        vSide[v * 4] = sSide[s * 3]
        vSide[v * 4 + 1] = sSide[s * 3 + 1]
        vSide[v * 4 + 2] = sSide[s * 3 + 2]
        vSide[v * 4 + 3] = e === 0 ? -1 : 1
        vRoute[v * 4] = r
        vRoute[v * 4 + 1] = T.a[r]
        vRoute[v * 4 + 2] = T.b[r]
        vRoute[v * 4 + 3] = T.openedYear[r]
        vArc[v * 2] = sArc[s]
        vArc[v * 2 + 1] = sWater[s]
      }
    }
  }
  let quads = 0
  for (let r = 0; r < R; r++) quads += Math.max(0, sOff[r + 1] - sOff[r] - 1)
  const index = new Uint32Array(quads * 6)
  const indexOffsets = new Uint32Array(R + 1)
  {
    let k = 0
    for (let r = 0; r < R; r++) {
      indexOffsets[r] = k
      for (let s = sOff[r]; s + 1 < sOff[r + 1]; s++) {
        const v = s * 2
        index[k++] = v; index[k++] = v + 2; index[k++] = v + 1
        index[k++] = v + 1; index[k++] = v + 2; index[k++] = v + 3
      }
    }
    indexOffsets[R] = k
  }
  // routes come in order of first opening; if not, draw them all and let the shader hide closed ones
  let openedSorted = true
  for (let r = 1; r < R; r++) if (T.openedYear[r] < T.openedYear[r - 1]) openedSorted = false

  const lineGeom = new THREE.BufferGeometry()
  lineGeom.setAttribute('position', new THREE.BufferAttribute(vPos, 3))
  lineGeom.setAttribute('aSide', new THREE.BufferAttribute(vSide, 4))
  lineGeom.setAttribute('aRoute', new THREE.BufferAttribute(vRoute, 4))
  lineGeom.setAttribute('aArc', new THREE.BufferAttribute(vArc, 2))
  lineGeom.setIndex(new THREE.BufferAttribute(index, 1))
  lineGeom.setDrawRange(0, 0)

  // volumes at the bracketing trade snapshots, one texel per route
  const texW = Math.max(1, Math.min(R, 1024))
  const texH = Math.max(1, Math.ceil(R / texW))
  const volData = new Float32Array(texW * texH * 4)
  const volTex = new THREE.DataTexture(volData, texW, texH, THREE.RGBAFormat, THREE.FloatType)
  volTex.minFilter = volTex.magFilter = THREE.NearestFilter
  volTex.generateMipmaps = false
  volTex.needsUpdate = true

  const shared = {
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
    uPixel: { value: 0.001 },
    uPixelRatio: { value: 1 },
  }
  const lineUniforms = {
    ...shared,
    uVol: { value: volTex },
    uTexW: { value: texW },
    uFrac: { value: 0 },
    uLogMax: { value: logMax },
    uYear: { value: 0 },
    uSel: { value: -1 },
    uLandFade: { value: 1 },
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
      attribute vec4 aSide; // side direction, across (-1|1)
      attribute vec4 aRoute; // route id, end a, end b, year first opened
      attribute vec2 aArc; // arc length from end a, over water
      uniform sampler2D uVol;
      uniform int uTexW;
      uniform float uFrac;
      uniform float uLogMax;
      uniform float uYear;
      uniform float uSel;
      uniform float uPixel;
      uniform float uPixelRatio;
      uniform vec3 uCamObj;
      uniform vec3 uSunObj;
      uniform float uDaylight;
      varying float vAcross;
      varying float vSoft;
      varying float vCore;
      varying float vStrength;
      varying float vArc;
      varying float vWater;
      varying float vFacing;
      varying float vNight;
      varying float vSel;
      varying float vGhost;
      float level(float v) {
        return v > 0.0 ? 0.3 + 0.7 * clamp(log(1.0 + v / 4.0) / uLogMax, 0.0, 1.0) : 0.0;
      }
      void main() {
        int id = int(aRoute.x + 0.5);
        vec4 t = texelFetch(uVol, ivec2(id - (id / uTexW) * uTexW, id / uTexW), 0);
        float s = mix(level(t.x), level(t.y), uFrac);
        vSel = (abs(aRoute.y - uSel) < 0.5 || abs(aRoute.z - uSel) < 0.5) ? 1.0 : 0.0;
        // a closed route of the selected settlement stays as a faint trace
        vGhost = vSel > 0.5 && uYear >= aRoute.w && s < 0.15 ? 1.0 : 0.0;
        if (s <= 0.002 && vGhost < 0.5) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vStrength = max(s, vGhost * 0.15);
        // half widths in CSS pixels: hairlines for minor routes, a bold highlight with a dark rim
        float core = vSel > 0.5 ? 1.05 + 0.75 * vStrength : 0.32 + 0.9 * vStrength * vStrength;
        float rim = vSel > 0.5 ? 1.0 : 0.0;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float pix = -mv.z * uPixel * uPixelRatio;
        float outer = core + rim + 0.6;
        vCore = core / outer;
        vSoft = 0.9 / outer;
        vAcross = aSide.w;
        vec3 p = position + aSide.xyz * aSide.w * outer * pix;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        vec3 up = normalize(position);
        vFacing = dot(up, normalize(uCamObj - position));
        vNight = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
        vArc = aArc.x;
        vWater = aArc.y;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uLandFade;
      varying float vAcross;
      varying float vSoft;
      varying float vCore;
      varying float vStrength;
      varying float vArc;
      varying float vWater;
      varying float vFacing;
      varying float vNight;
      varying float vSel;
      varying float vGhost;
      void main() {
        float limb = smoothstep(0.0, 0.3, vFacing);
        float x = abs(vAcross);
        float body = 1.0 - smoothstep(1.0 - vSoft, 1.0, x);
        float coreMask = 1.0 - smoothstep(vCore - vSoft, vCore, x);
        bool sea = vWater > 0.5;
        float dash = step(0.42, fract(vArc / 0.009));
        vec3 col;
        float a;
        if (vSel > 0.5) {
          vec3 c = sea ? vec3(0.80, 0.97, 1.0) : vec3(1.0, 0.90, 0.62);
          col = mix(vec3(0.06, 0.03, 0.01), c, coreMask);
          a = body * mix(0.55, 1.0, coreMask);
          if (sea) a *= mix(0.3, 1.0, dash);
          if (vGhost > 0.5) a *= 0.35 * mix(0.25, 1.0, step(0.5, fract(vArc / 0.005)));
        } else {
          col = sea ? vec3(0.62, 0.90, 1.0) : mix(vec3(0.95, 0.58, 0.26), vec3(1.0, 0.84, 0.55), vStrength);
          a = (0.22 + 0.68 * vStrength) * coreMask;
          if (sea) a *= dash * 0.95;
          else a *= uLandFade;
          a *= mix(1.0, 0.5, vNight);
        }
        a *= limb;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col * a, a);
      }
    `,
    ...blend,
  })
  const lines = new THREE.Mesh(lineGeom, lineMaterial)
  lines.frustumCulled = false
  lines.renderOrder = 6.5 // after clouds, under the journey trails and settlement markers

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
      uniform vec3 uGood[${GOOD_COUNT}];
      varying vec2 vPx;
      varying float vR;
      varying float vSea;
      varying float vAlpha;
      varying float vNight;
      varying vec3 vFill;
      void main() {
        vec3 up = normalize(aPos);
        float facing = dot(up, normalize(uCamObj - aPos));
        if (facing <= 0.0 || aInfo.w <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(aPos, 1.0);
        vec4 ahead = projectionMatrix * modelViewMatrix * vec4(aPos + aDir * 0.01, 1.0);
        vec2 d = (ahead.xy / ahead.w - clip.xy / clip.w) * uViewport;
        vec2 fwd = length(d) > 1e-5 ? normalize(d) : vec2(1.0, 0.0);
        vec2 side = vec2(-fwd.y, fwd.x);
        float r = (1.05 + 0.6 * aInfo.y) * uSizeScale * mix(0.6, 1.0, sqrt(facing));
        float ext = r * 2.2 + 3.0;
        vec2 offPx = (fwd * position.x + side * position.y) * ext;
        clip.xy += offPx * uPixelRatio * 2.0 / uViewport * clip.w;
        gl_Position = clip;
        vPx = position.xy * ext;
        vR = r;
        vSea = aInfo.z;
        vAlpha = aInfo.w * smoothstep(0.0, 0.3, facing);
        if (uYield.y > 0.0) vAlpha *= smoothstep(uYield.x, uYield.y, length(uCamObj - aPos));
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
        vec3 rim = vec3(0.08, 0.05, 0.03);
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
        // a dark rim for contrast, thin on tiny markers so their colour still reads
        float rw = clamp(0.38 * vR, 0.35, vSea > 0.5 ? 0.8 : 1.0);
        float inner = 1.0 - smoothstep(-rw - 0.2, -0.1, d);
        float bodyA = 1.0 - smoothstep(0.3, 1.3, d);
        vec3 bodyC = mix(rim, vFill, inner);
        float glow = exp(-max(d, 0.0) * 0.6) * 0.25;
        vec3 c = vFill * glow;
        float a = glow;
        c = bodyC * bodyA + c * (1.0 - bodyA);
        a = bodyA + a * (1.0 - bodyA);
        float k = vAlpha * mix(1.0, 0.6, vNight);
        c *= k;
        a *= k;
        if (a < 0.004) discard;
        gl_FragColor = vec4(c, a);
      }
    `,
    ...blend,
  })
  const merchantMesh = new THREE.Mesh(quad, merchantMaterial)
  merchantMesh.frustumCulled = false
  merchantMesh.renderOrder = 8.8 // over the settlement markers and structure icons, under travelling settlers

  const object = new THREE.Group()
  object.name = 'trade'
  object.add(lines, merchantMesh)

  const tmpQ = new THREE.Quaternion()
  const camObj = new THREE.Vector3(0, 0, 3)
  const view: MerchantView = { count: 0, pos: mPos, dir: mDir, info: dInfo }
  let shownS0 = -1
  let shownS1 = -1
  let roadsShown = true

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
      const cx = camObj.x, cy = camObj.y, cz = camObj.z
      outer: for (let q = pairOff[s0]; q < pairOff[s0 + 1]; q++) {
        const r = pairList[q]
        const v0 = vol[s0 * R + r], v1 = vol[s1 * R + r]
        const presence = (v0 > 0 ? 1 - frac : 0) + (v1 > 0 ? frac : 0)
        const L = smp.length[r]
        if (presence <= 0 || L <= 0 || sOff[r + 1] - sOff[r] < 2) continue
        const v = v0 + (v1 - v0) * frac
        const trip = Math.max(MIN_TRIP_YEARS, L / speed)
        const sizeT = Math.sqrt(levelOf(v))
        let threshold = FIRST_MERCHANT_VOLUME * jitter[r]
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
          // only the near side counts toward the cap
          if (x * (cx - x) + y * (cy - y) + z * (cz - z) <= 0) continue
          const l = (forward ? 1 : -1) / (Math.hypot(dx, dy, dz) || 1)
          mPos[n * 3] = x
          mPos[n * 3 + 1] = y
          mPos[n * 3 + 2] = z
          mDir[n * 3] = dx * l
          mDir[n * 3 + 1] = dy * l
          mDir[n * 3 + 2] = dz * l
          const good = forward ? T.goodAB[r] : T.goodBA[r]
          const g = good < GOOD_COUNT ? good : 0
          const sea = sWater[u < 0.5 ? lo : lo + 1]
          mInfo[n * 4] = g
          mInfo[n * 4 + 1] = sizeT
          mInfo[n * 4 + 2] = sea
          mInfo[n * 4 + 3] = a
          dInfo[n * 4] = GOOD_PALETTE[g]
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

  return {
    object,
    setTime(year: number, playing: boolean, playSpeed: number) {
      const last = S - 1
      const x = Math.min(Math.max(year / input.interval, 0), last)
      const s0 = Math.min(Math.floor(x), last)
      const s1 = Math.min(s0 + 1, last)
      const frac = s1 === s0 ? 0 : x - s0
      if (s0 !== shownS0 || s1 !== shownS1) {
        for (let r = 0; r < R; r++) {
          volData[r * 4] = vol[s0 * R + r]
          volData[r * 4 + 1] = vol[s1 * R + r]
        }
        volTex.needsUpdate = true
        shownS0 = s0
        shownS1 = s1
      }
      lineUniforms.uFrac.value = frac
      lineUniforms.uYear.value = year
      // routes opened by the end of this bracket (the shader hides the closed ones)
      let hi = R
      if (openedSorted) {
        const until = s1 * input.interval
        let a = 0, b = R
        while (a < b) {
          const m = (a + b) >>> 1
          if (T.openedYear[m] <= Math.max(until, year)) a = m + 1
          else b = m
        }
        hi = a
      }
      lineGeom.setDrawRange(0, indexOffsets[hi])
      // symbolic traffic: readable up to 4x, gone at 16x (the route lines carry it)
      const fade = !playing || playSpeed <= 1 ? 1 : playSpeed <= 4 ? 0.8 : 0
      writeMerchants(year, s0, s1, frac, fade)
    },
    setSelected(id: number) {
      lineUniforms.uSel.value = id
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
      merchantUniforms.uSizeScale.value = Math.min(1.4, Math.max(0.8, Math.sqrt(3.25 / dist)))
      // up close the roads carry the land legs
      const t = Math.min(1, Math.max(0, (dist - 1.4) / 1.0))
      lineUniforms.uLandFade.value = roadsShown ? 0.4 + 0.6 * t * t * (3 - 2 * t) : 1
    },
    merchants() {
      return view
    },
    setYield(near: number, far: number) {
      merchantUniforms.uYield.value.set(near, far)
    },
    dispose() {
      lineGeom.dispose()
      quad.dispose()
      lineMaterial.dispose()
      merchantMaterial.dispose()
      volTex.dispose()
    },
  }
}
