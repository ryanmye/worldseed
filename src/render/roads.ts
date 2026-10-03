// Roads and bridges worn by overland trade.
//
// Roads: History.road holds a road level per cell per land snapshot. Drawn naively
// (every road cell joined to every road neighbour) roads form blobs around busy towns,
// so the road network is taken from the trade paths instead: only cell-to-cell links that
// some route actually travels are drawn. Each road cell becomes a smooth piece the way
// rivers are built (rivers.ts): a quadratic Bezier from the midpoint of the incoming link,
// with the cell as control point, to the midpoint of the outgoing link (one piece per
// distinct pair of links a route turns through; a road's end runs to the cell centre).
// Geometry is static; the level of every link comes from a small texture holding the
// road rows of the two land snapshots bracketing the year (rewritten only when that pair
// changes) and is interpolated in the vertex shader, so roads appear, widen and fade
// with traffic as a pure function of the year. Pale tan ribbons, sun-lit, just above the
// terrain (over the rivers); faint at globe zoom, clear from mid zoom inward.
//
// Bridges: where a road piece passes through a river cell and crosses the river's course
// (the road's two links separate the river's upstream and downstream links in the cell's
// neighbour ring, rather than sharing one of them), a bridge sits at the point where the
// two curves meet. At mid zoom it is a flat glyph, a short light deck with dark end caps
// (one instanced draw call); up close a low-poly stone bridge from the diorama layer
// stands in for it (see `placements`).

import * as THREE from 'three'
import { RIVER_FLOW_THRESHOLD, type TradeRoutes, type World } from '../contract.ts'
import { isWaterCell, lakeArray, surfaceRadius, SUN_COLOR, SUN_DIRECTION } from './globe.ts'
import { sunUniforms } from './sun.ts'

/** Height of road ribbons above the ground (rivers sit at 0.0012). */
const ROAD_LIFT = 0.0014
const SEGMENTS = 6
/** Road level (0..255) above which a bridge stands (models and glyphs). */
const BRIDGE_LEVEL = 26

export interface RoadInput {
  /** Road level per land snapshot per cell (row-major), 0..255. */
  road: Uint8Array
  interval: number
  snapshots: number
  routes: TradeRoutes
}

/** Bridges for the diorama layer (see DioramaLayer.setBridges). */
export interface BridgePlacements {
  count: number
  /** Generated low-poly bridge, deck along +z, unit length (owned by the road layer). */
  geometry: THREE.BufferGeometry
  /** Instance matrix (16 floats, column-major) per bridge: deck along the road, scaled to the span. */
  mat: Float32Array
  /** Ground position per bridge (xyz). */
  pos: Float32Array
  /** Road level (0..255) of bridge k at land snapshot s. */
  level(k: number, s: number): number
  /** Level at which a bridge stands. */
  threshold: number
  interval: number
  snapshots: number
}

export interface RoadLayer {
  object: THREE.Group
  /** Per frame: continuous year (uploads road rows only when the snapshot pair changes). */
  setTime(year: number): void
  update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number): void
  /** Fade bridge glyphs out within camera distance near..far (where models take over); far <= 0 turns it off. */
  setYield(near: number, far: number): void
  /** Bridges for the 3D layer, or null when there are none. */
  placements: BridgePlacements | null
  dispose(): void
}

const TEX_W = 1024

export function buildRoadLayer(world: World, input: RoadInput): RoadLayer {
  const { grid, flow, riverTo } = world
  const P = grid.positions
  const N = grid.cellCount
  const off = grid.neighborOffsets
  const nb = grid.neighbors
  const lake = lakeArray(world)
  const T = input.routes
  const land = (c: number) => !isWaterCell(world, lake, c)
  const isRiver = (c: number) => flow[c] >= RIVER_FLOW_THRESHOLD && riverTo[c] >= 0 && land(c)

  // ---------- road pieces from the route paths ----------
  const turnKeys = new Set<number>()
  const turns: number[] = [] // p, c, q
  const halfUsed = new Set<number>() // c * N + neighbour, links covered by a turn piece
  const ends: number[] = [] // c, neighbour
  const valid = (c: number) => c >= 0 && c < N
  for (let r = 0; r < T.count; r++) {
    const p0 = T.pathOffsets[r], p1 = T.pathOffsets[r + 1]
    for (let k = p0; k < p1; k++) {
      const c = T.path[k]
      if (!valid(c) || !land(c)) continue
      const prev = k > p0 ? T.path[k - 1] : -1
      const next = k + 1 < p1 ? T.path[k + 1] : -1
      const pl = valid(prev) && land(prev)
      const nl = valid(next) && land(next)
      if (pl && nl && prev !== next) {
        const lo = Math.min(prev, next), hi = Math.max(prev, next)
        const key = (c * N + lo) * N + hi
        if (!turnKeys.has(key)) {
          turnKeys.add(key)
          turns.push(prev, c, next)
          halfUsed.add(c * N + prev)
          halfUsed.add(c * N + next)
        }
      } else if (pl) ends.push(c, prev)
      else if (nl) ends.push(c, next)
    }
  }
  const endKeys = new Set<number>()
  const endList: number[] = []
  for (let i = 0; i < ends.length; i += 2) {
    const key = ends[i] * N + ends[i + 1]
    if (halfUsed.has(key) || endKeys.has(key)) continue
    endKeys.add(key)
    endList.push(ends[i], ends[i + 1])
  }

  const pieceCount = turns.length / 3 + endList.length / 2
  const vertsPer = SEGMENTS * 2
  const V = pieceCount * vertsPer
  const pos = new Float32Array(V * 3)
  const side = new Float32Array(V * 4) // side xyz, across
  const cells = new Float32Array(V * 4) // p, c, q, t
  const index = new Uint32Array(pieceCount * (SEGMENTS - 1) * 6)
  let nv = 0
  let ni = 0
  const a = new THREE.Vector3(), b = new THREE.Vector3(), m = new THREE.Vector3()
  const pt = new THREE.Vector3(), tan = new THREE.Vector3(), sd = new THREE.Vector3()
  const unit = (c: number, out: THREE.Vector3) => out.set(P[c * 3], P[c * 3 + 1], P[c * 3 + 2])
  const mid = (x: number, y: number, out: THREE.Vector3) => out.set(P[x * 3] + P[y * 3], P[x * 3 + 1] + P[y * 3 + 1], P[x * 3 + 2] + P[y * 3 + 2]).normalize()

  /** Quadratic Bezier on unit vectors a -> ctrl -> b at t: point (normalised) and tangent. */
  const bezier = (A: THREE.Vector3, C: THREE.Vector3, B: THREE.Vector3, t: number, outP: THREE.Vector3, outT: THREE.Vector3 | null) => {
    const u = 1 - t
    outP.set(0, 0, 0).addScaledVector(A, u * u).addScaledVector(C, 2 * u * t).addScaledVector(B, t * t)
    if (outT) outT.set(0, 0, 0).addScaledVector(C, 2 * u).addScaledVector(A, -2 * u).addScaledVector(B, 2 * t).addScaledVector(C, -2 * t)
    return outP.normalize()
  }

  function emit(A: THREE.Vector3, C: THREE.Vector3, B: THREE.Vector3, rA: number, rC: number, rB: number, cp: number, cc: number, cq: number) {
    const base = nv
    for (let s = 0; s < SEGMENTS; s++) {
      const t = s / (SEGMENTS - 1)
      const u = 1 - t
      bezier(A, C, B, t, pt, tan)
      sd.crossVectors(pt, tan).normalize()
      const r = rA * u * u + rC * 2 * u * t + rB * t * t + ROAD_LIFT
      for (let e = 0; e < 2; e++) {
        pos[nv * 3] = pt.x * r
        pos[nv * 3 + 1] = pt.y * r
        pos[nv * 3 + 2] = pt.z * r
        side[nv * 4] = sd.x
        side[nv * 4 + 1] = sd.y
        side[nv * 4 + 2] = sd.z
        side[nv * 4 + 3] = e === 0 ? -1 : 1
        cells[nv * 4] = cp
        cells[nv * 4 + 1] = cc
        cells[nv * 4 + 2] = cq
        cells[nv * 4 + 3] = t
        nv++
      }
      if (s > 0) {
        const v = base + s * 2
        index[ni++] = v - 2; index[ni++] = v; index[ni++] = v - 1
        index[ni++] = v - 1; index[ni++] = v; index[ni++] = v + 1
      }
    }
  }

  // main upstream river cell of each cell (as rivers.ts draws them)
  const main = new Int32Array(N).fill(-1)
  for (let i = 0; i < N; i++) {
    if (!isRiver(i)) continue
    const j = riverTo[i]
    if (main[j] < 0 || flow[i] > flow[main[j]]) main[j] = i
  }
  const ringIndex = (c: number, x: number) => {
    for (let k = off[c]; k < off[c + 1]; k++) if (nb[k] === x) return k - off[c]
    return -1
  }
  /** Whether the road through c (links to p and q) crosses the river through c (links to u and d). */
  const crosses = (c: number, p: number, q: number, u: number, d: number) => {
    if (u === p || u === q || d === p || d === q) return false
    const n = off[c + 1] - off[c]
    const ip = ringIndex(c, p), iq = ringIndex(c, q), iu = ringIndex(c, u), id = ringIndex(c, d)
    if (ip < 0 || iq < 0 || iu < 0 || id < 0) return false
    const span = (iq - ip + n) % n
    const between = (ix: number) => (ix - ip + n) % n < span
    return between(iu) !== between(id)
  }
  const riverHalfWidth = (f: number) => Math.min(0.0032, 0.0006 + 0.00075 * Math.log(Math.max(f, RIVER_FLOW_THRESHOLD) / RIVER_FLOW_THRESHOLD))

  const bridgePos: number[] = []
  const bridgeDir: number[] = []
  const bridgeSpan: number[] = []
  const bridgeCells: number[] = []
  const ra = new THREE.Vector3(), rb = new THREE.Vector3(), rc = new THREE.Vector3(), rq = new THREE.Vector3()
  const bestP = new THREE.Vector3(), bestT = new THREE.Vector3()

  for (let i = 0; i < turns.length; i += 3) {
    const p = turns[i], c = turns[i + 1], q = turns[i + 2]
    mid(p, c, a)
    unit(c, m)
    mid(c, q, b)
    const rc0 = surfaceRadius(world, c)
    emit(a, m, b, (surfaceRadius(world, p) + rc0) / 2, rc0, (surfaceRadius(world, q) + rc0) / 2, p, c, q)
  }
  // ---------- bridges ----------
  // Walking each route: a road through a river cell crosses there when its two links
  // separate the river's links in the cell's ring. A road may also join a river and run
  // along it (both follow cheap valleys, and both are drawn through the cell centres, so
  // they coincide there); if it leaves on the other bank from the one it came from, it
  // crossed, and the bridge goes where it leaves.
  const riverLink = (x: number, y: number) => (riverTo[x] === y && isRiver(x)) || (riverTo[y] === x && isRiver(y))
  /** Upstream and downstream neighbours of river cell c as drawn, preferring `along` when it is on the river. */
  const courseOf = (c: number, along: number, out: Int32Array) => {
    let up = main[c]
    if (along >= 0 && riverTo[along] === c && isRiver(along)) up = along
    if (up < 0) for (let k = off[c]; k < off[c + 1]; k++) if (riverTo[nb[k]] === c && !land(nb[k])) up = nb[k] // lake outlet
    out[0] = up
    out[1] = riverTo[c]
    return up >= 0 && out[1] >= 0
  }
  /** Which bank of the river (u upstream, d downstream) through c the neighbour x is on. */
  const bankOf = (c: number, x: number, u: number, d: number) => {
    const n = off[c + 1] - off[c]
    const iu = ringIndex(c, u), id = ringIndex(c, d), ix = ringIndex(c, x)
    return (ix - id + n) % n < (iu - id + n) % n ? 0 : 1
  }
  const course = new Int32Array(2)
  const bridgeKeys = new Set<number>()
  const addBridge = (p: number, c: number, q: number, u: number, d: number, alongRiver: boolean) => {
    const key = (c * N + Math.min(p, q)) * N + Math.max(p, q)
    if (bridgeKeys.has(key)) return
    bridgeKeys.add(key)
    mid(p, c, a)
    unit(c, m)
    mid(c, q, b)
    const rc0 = surfaceRadius(world, c)
    if (alongRiver) {
      // where the road leaves the river for the far bank
      bezier(a, m, b, 0.62, bestP, bestT)
    } else {
      // where the road and river curves meet
      mid(u, c, ra)
      mid(c, d, rb)
      let best = Infinity
      for (let s = 1; s < 24; s++) {
        bezier(a, m, b, s / 24, rc, tan)
        for (let w = 1; w < 24; w++) {
          bezier(ra, m, rb, w / 24, rq, null)
          const dd = rc.distanceToSquared(rq)
          if (dd < best) {
            best = dd
            bestP.copy(rc)
            bestT.copy(tan)
          }
        }
      }
    }
    bestT.addScaledVector(bestP, -bestT.dot(bestP)).normalize()
    bridgePos.push(bestP.x * rc0, bestP.y * rc0, bestP.z * rc0)
    bridgeDir.push(bestT.x, bestT.y, bestT.z)
    bridgeSpan.push(2 * riverHalfWidth(flow[c]) + 0.0026)
    bridgeCells.push(p, c, q)
  }
  for (let r = 0; r < T.count; r++) {
    const p0 = T.pathOffsets[r], p1 = T.pathOffsets[r + 1]
    let entryBank = -1 // bank the road came from before joining the river (-1: not on a river)
    for (let k = p0 + 1; k + 1 < p1; k++) {
      const p = T.path[k - 1], c = T.path[k], q = T.path[k + 1]
      if (!valid(p) || !valid(c) || !valid(q) || !land(p) || !land(c) || !land(q) || !isRiver(c)) {
        entryBank = -1
        continue
      }
      const inAlong = riverLink(p, c), outAlong = riverLink(c, q)
      if (!inAlong && !outAlong) {
        if (courseOf(c, -1, course) && crosses(c, p, q, course[0], course[1])) addBridge(p, c, q, course[0], course[1], false)
        entryBank = -1
      } else if (!inAlong && outAlong) {
        entryBank = courseOf(c, q, course) && course[0] !== p && course[1] !== p ? bankOf(c, p, course[0], course[1]) : -1
      } else if (inAlong && !outAlong) {
        if (entryBank >= 0 && courseOf(c, p, course) && course[0] !== q && course[1] !== q && bankOf(c, q, course[0], course[1]) !== entryBank) {
          addBridge(p, c, q, course[0], course[1], true)
        }
        entryBank = -1
      }
    }
  }

  for (let i = 0; i < endList.length; i += 2) {
    const c = endList[i], x = endList[i + 1]
    mid(x, c, a)
    unit(c, b)
    m.copy(a).add(b).normalize()
    const rc0 = surfaceRadius(world, c)
    const rA = (surfaceRadius(world, x) + rc0) / 2
    emit(a, m, b, rA, (rA + rc0) / 2, rc0, x, c, x)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 4))
  geometry.setAttribute('aCells', new THREE.BufferAttribute(cells, 4))
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.02)

  // road rows of the two bracketing land snapshots: R = row 0, G = row 1
  const texH = Math.ceil(N / TEX_W)
  const texData = new Uint8Array(TEX_W * texH * 4)
  const roadTex = new THREE.DataTexture(texData, TEX_W, texH, THREE.RGBAFormat, THREE.UnsignedByteType)
  roadTex.minFilter = roadTex.magFilter = THREE.NearestFilter
  roadTex.generateMipmaps = false
  roadTex.needsUpdate = true

  const uniforms = {
    uRoad: { value: roadTex },
    uFrac: { value: 0 },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunColor: { value: SUN_COLOR.clone() },
    uPixel: { value: 0.001 },
    uPixelRatio: { value: 1 },
    uZoom: { value: 0.3 },
    uBridgeZoom: { value: 0 },
    uYield: { value: new THREE.Vector2(0, 0) },
  }

  const roadLevelGlsl = /* glsl */ `
    uniform sampler2D uRoad;
    uniform float uFrac;
    float roadAt(float cell) {
      int c = int(cell + 0.5);
      vec4 t = texelFetch(uRoad, ivec2(c - (c / ${TEX_W}) * ${TEX_W}, c / ${TEX_W}), 0);
      return mix(t.r, t.g, uFrac);
    }
  `
  const litGlsl = /* glsl */ `
    uniform vec3 uSunObj;
    uniform float uDaylight;
    uniform vec3 uCamObj;
    uniform vec3 uSunColor;
    vec3 lit(vec3 albedo, vec3 up) {
      float mu = mix(dot(up, normalize(uSunObj)), 0.92, uDaylight);
      float day = smoothstep(-0.12, 0.12, mu);
      return albedo * (uSunColor * max(mu, 0.0) * day + vec3(0.035, 0.04, 0.06));
    }
  `

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec4 aSide;
      attribute vec4 aCells; // previous cell, this cell, next cell, position along the piece
      uniform float uPixel;
      uniform float uPixelRatio;
      ${roadLevelGlsl}
      varying float vAcross;
      varying float vSoft;
      varying float vAlpha;
      varying float vLevel;
      varying vec3 vObjPos;
      void main() {
        float rc = roadAt(aCells.y);
        float l = mix(min(roadAt(aCells.x), rc), min(rc, roadAt(aCells.z)), aCells.w);
        float vis = smoothstep(0.035, 0.14, l);
        if (vis <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float pix = -mv.z * uPixel * uPixelRatio;
        float w = 0.0002 + 0.00058 * l;
        float hw = max(w, 0.55 * pix);
        vAlpha = vis * (0.5 + 0.4 * l) * min(1.0, w / hw);
        float outer = hw + 0.6 * pix;
        vAcross = aSide.w;
        vSoft = min(1.0, pix / outer);
        vLevel = l;
        vec3 p = position + aSide.xyz * aSide.w * outer;
        vObjPos = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${litGlsl}
      uniform float uZoom;
      varying float vAcross;
      varying float vSoft;
      varying float vAlpha;
      varying float vLevel;
      varying vec3 vObjPos;
      void main() {
        vec3 up = normalize(vObjPos);
        float limb = smoothstep(0.05, 0.35, dot(up, normalize(uCamObj - vObjPos)));
        float x = abs(vAcross);
        float edge = 1.0 - smoothstep(1.0 - vSoft, 1.0, x);
        // packed earth with a slightly darker verge; highways a little paler
        vec3 albedo = mix(vec3(0.25, 0.19, 0.12), vec3(0.36, 0.29, 0.19), vLevel);
        albedo *= mix(1.0, 0.72, smoothstep(0.55, 1.0, x));
        vec3 col = lit(albedo, up);
        float a = vAlpha * edge * limb * uZoom;
        if (a < 0.003) discard;
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -6,
  })
  const roads = new THREE.Mesh(geometry, material)
  roads.renderOrder = 2.5 // over the rivers, under the clouds
  roads.name = 'roads'

  // ---------- bridge glyphs ----------
  const nb0 = bridgePos.length / 3
  const nBridges = Math.max(1, nb0)
  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  quad.setIndex([0, 1, 2, 0, 2, 3])
  const bPos = new Float32Array(nBridges * 3)
  bPos.set(bridgePos)
  const bDir = new Float32Array(nBridges * 3)
  bDir.set(bridgeDir)
  const bInfo = new Float32Array(nBridges * 4) // span, p, c, q
  for (let k = 0; k < nb0; k++) {
    bInfo[k * 4] = bridgeSpan[k]
    bInfo[k * 4 + 1] = bridgeCells[k * 3]
    bInfo[k * 4 + 2] = bridgeCells[k * 3 + 1]
    bInfo[k * 4 + 3] = bridgeCells[k * 3 + 2]
  }
  quad.setAttribute('aPos', new THREE.InstancedBufferAttribute(bPos, 3))
  quad.setAttribute('aDir', new THREE.InstancedBufferAttribute(bDir, 3))
  quad.setAttribute('aInfo', new THREE.InstancedBufferAttribute(bInfo, 4))
  quad.instanceCount = nb0
  const glyphMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aPos;
      attribute vec3 aDir;
      attribute vec4 aInfo; // span (world), previous cell, river cell, next cell
      uniform float uPixel;
      uniform float uPixelRatio;
      uniform float uBridgeZoom;
      uniform vec2 uYield;
      uniform vec3 uCamObj;
      ${roadLevelGlsl}
      varying vec2 vLocal;
      varying vec2 vHalf;
      varying float vAlpha;
      varying vec3 vObjPos;
      void main() {
        float l = min(min(roadAt(aInfo.y), roadAt(aInfo.z)), roadAt(aInfo.w));
        float vis = smoothstep(${(BRIDGE_LEVEL / 255).toFixed(4)}, ${((BRIDGE_LEVEL + 20) / 255).toFixed(4)}, l) * uBridgeZoom;
        vec3 up = normalize(aPos);
        float facing = dot(up, normalize(uCamObj - aPos));
        if (uYield.y > 0.0) vis *= smoothstep(uYield.x, uYield.y, length(uCamObj - aPos));
        if (vis <= 0.0 || facing <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec3 c = aPos * (1.0 + ${(ROAD_LIFT + 0.0003).toFixed(4)});
        vec4 mv = modelViewMatrix * vec4(c, 1.0);
        float pix = -mv.z * uPixel * uPixelRatio; // world size of a CSS pixel here
        vec2 halfPx = vec2(max(0.5 * aInfo.x / pix, 6.0), max((0.00035 + 0.0007 * l) / pix, 2.0));
        vec2 ext = halfPx + 2.0;
        vec3 sd = normalize(cross(up, aDir));
        vec3 p = c + (aDir * position.x * ext.x + sd * position.y * ext.y) * pix;
        vObjPos = p;
        vLocal = position.xy * ext;
        vHalf = halfPx;
        vAlpha = vis * smoothstep(0.05, 0.3, facing);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${litGlsl}
      varying vec2 vLocal;
      varying vec2 vHalf;
      varying float vAlpha;
      varying vec3 vObjPos;
      void main() {
        vec2 p = vLocal;
        vec2 h = vHalf;
        float deck = max(abs(p.x) - h.x, abs(p.y) - h.y);
        // end caps: short bars across both ends, a little wider than the deck
        float cap = max(abs(abs(p.x) - h.x + 0.7) - 0.9, abs(p.y) - h.y - 1.4);
        float d = min(deck, cap);
        float a = 1.0 - smoothstep(-0.5, 0.6, d);
        // light stone deck, dark parapets along its sides, dark caps
        float parapet = smoothstep(h.y - 1.3, h.y - 0.5, abs(p.y));
        float isCap = 1.0 - smoothstep(-0.4, 0.4, cap - deck + 0.2);
        vec3 stone = vec3(0.93, 0.89, 0.80);
        vec3 dark = vec3(0.22, 0.17, 0.12);
        vec3 albedo = mix(stone, dark, max(parapet * 0.75, isCap));
        vec3 col = lit(albedo, normalize(vObjPos)) * 1.15 + albedo * 0.06;
        a *= vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  })
  const glyphs = new THREE.Mesh(quad, glyphMaterial)
  glyphs.frustumCulled = false
  glyphs.renderOrder = 6.4 // over the clouds, under the trade routes
  glyphs.visible = nb0 > 0

  const object = new THREE.Group()
  object.name = 'roads'
  object.add(roads, glyphs)

  // ---------- bridges for the 3D layer ----------
  let placements: BridgePlacements | null = null
  let bridgeGeometry: THREE.BufferGeometry | null = null
  if (nb0 > 0) {
    bridgeGeometry = buildBridgeGeometry()
    const mat = new Float32Array(nb0 * 16)
    const fwd = new THREE.Vector3(), upv = new THREE.Vector3(), sdv = new THREE.Vector3()
    for (let k = 0; k < nb0; k++) {
      upv.set(bPos[k * 3], bPos[k * 3 + 1], bPos[k * 3 + 2])
      const r = upv.length()
      upv.normalize()
      fwd.set(bDir[k * 3], bDir[k * 3 + 1], bDir[k * 3 + 2])
      sdv.crossVectors(upv, fwd).normalize()
      // model forward is +z, X = Y x Z; deck length = span, fixed width and height
      const L = bridgeSpan[k] * 1.1, W = 0.0016, H = 0.0023
      const o = k * 16
      mat[o] = sdv.x * W; mat[o + 1] = sdv.y * W; mat[o + 2] = sdv.z * W; mat[o + 3] = 0
      mat[o + 4] = upv.x * H; mat[o + 5] = upv.y * H; mat[o + 6] = upv.z * H; mat[o + 7] = 0
      mat[o + 8] = fwd.x * L; mat[o + 9] = fwd.y * L; mat[o + 10] = fwd.z * L; mat[o + 11] = 0
      mat[o + 12] = upv.x * r; mat[o + 13] = upv.y * r; mat[o + 14] = upv.z * r; mat[o + 15] = 1
    }
    const road = input.road
    const lastRow = input.snapshots - 1
    placements = {
      count: nb0,
      geometry: bridgeGeometry,
      mat,
      pos: bPos,
      level(k: number, s: number) {
        const o = Math.min(lastRow, Math.max(0, s)) * N
        return Math.min(road[o + bridgeCells[k * 3]], road[o + bridgeCells[k * 3 + 1]], road[o + bridgeCells[k * 3 + 2]])
      },
      threshold: BRIDGE_LEVEL,
      interval: input.interval,
      snapshots: input.snapshots,
    }
  }

  const tmpQ = new THREE.Quaternion()
  let shown0 = -1
  let shown1 = -1

  return {
    object,
    placements,
    setTime(year: number) {
      const last = input.snapshots - 1
      const x = Math.min(Math.max(year / input.interval, 0), last)
      const s0 = Math.min(Math.floor(x), last)
      const s1 = Math.min(s0 + 1, last)
      uniforms.uFrac.value = s1 === s0 ? 0 : x - s0
      if (s0 === shown0 && s1 === shown1) return
      shown0 = s0
      shown1 = s1
      const road = input.road
      const o0 = s0 * N, o1 = s1 * N
      for (let c = 0; c < N; c++) {
        texData[c * 4] = road[o0 + c]
        texData[c * 4 + 1] = road[o1 + c]
      }
      roadTex.needsUpdate = true
    },
    update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number) {
      object.updateWorldMatrix(true, false)
      object.getWorldQuaternion(tmpQ).invert()
      uniforms.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      const cam = uniforms.uCamObj.value
      camera.getWorldPosition(cam)
      object.worldToLocal(cam)
      uniforms.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, drawSize.y)
      uniforms.uPixelRatio.value = pixelRatio
      const dist = cam.length()
      // faint at globe zoom, clear from mid zoom inward; bridge glyphs only from mid zoom
      const t = Math.min(1, Math.max(0, (2.9 - dist) / 0.9))
      uniforms.uZoom.value = 0.3 + 0.7 * t * t * (3 - 2 * t)
      const tb = Math.min(1, Math.max(0, (2.45 - dist) / 0.45))
      uniforms.uBridgeZoom.value = tb * tb * (3 - 2 * tb)
    },
    setYield(near: number, far: number) {
      uniforms.uYield.value.set(near, far)
    },
    dispose() {
      geometry.dispose()
      quad.dispose()
      material.dispose()
      glyphMaterial.dispose()
      roadTex.dispose()
      bridgeGeometry?.dispose()
    },
  }
}

/**
 * A low-poly stone bridge: deck along z in [-0.5, 0.5] (unit length), x in [-0.5, 0.5],
 * deck top at y = 1, three arches on two piers, parapets, footings sunk below ground.
 * Same attributes as the diorama models (position, normal, RGBA8 aColor with alpha 0:
 * no team colour), so the diorama material draws it.
 */
export function buildBridgeGeometry(): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const tri = (p: number[], q: number[], r: number[], rgb: number[]) => {
    pos.push(...p, ...q, ...r)
    for (let i = 0; i < 3; i++) col.push(rgb[0], rgb[1], rgb[2], 0)
  }
  const quadF = (p: number[], q: number[], r: number[], s: number[], rgb: number[]) => {
    tri(p, q, r, rgb)
    tri(p, r, s, rgb)
  }
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, rgb: number[], top = rgb) => {
    quadF([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top)
    quadF([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], rgb)
    quadF([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], rgb)
    quadF([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], rgb)
    quadF([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], rgb)
  }
  const stone = [176, 164, 142], stoneDark = [140, 128, 110], deckTop = [150, 128, 98], capStone = [196, 186, 166]
  const W = 0.42 // half width of the spandrel walls
  const deckY0 = 0.78, deckY1 = 0.9
  // deck slab and parapets
  box(-0.5, deckY0, -0.5, 0.5, deckY1, 0.5, stone, deckTop)
  box(-0.5, deckY1, -0.5, -0.38, 1.0, 0.5, stoneDark, capStone)
  box(0.38, deckY1, -0.5, 0.5, 1.0, 0.5, stoneDark, capStone)
  // abutments at both banks and two piers with cutwaters
  box(-W, -0.4, -0.5, W, deckY0, -0.4, stoneDark)
  box(-W, -0.4, 0.4, W, deckY0, 0.5, stoneDark)
  for (const zc of [-0.14, 0.14]) {
    box(-W, -0.4, zc - 0.045, W, deckY0, zc + 0.045, stoneDark)
    // pointed cutwaters on both faces of the pier
    for (const sx of [-1, 1]) {
      tri([sx * W, -0.4, zc - 0.045], [sx * (W + 0.12), -0.4, zc], [sx * W, 0.42, zc - 0.045], stoneDark)
      tri([sx * W, -0.4, zc + 0.045], [sx * W, 0.42, zc + 0.045], [sx * (W + 0.12), -0.4, zc], stoneDark)
      tri([sx * W, 0.42, zc - 0.045], [sx * (W + 0.12), -0.4, zc], [sx * W, 0.42, zc + 0.045], stone)
    }
  }
  // three arches: spandrel walls on both faces and the arch soffit between them
  const spans: [number, number][] = [[-0.4, -0.185], [-0.095, 0.095], [0.185, 0.4]]
  const seg = 6
  for (const [z0, z1] of spans) {
    const zc = (z0 + z1) / 2, hz = (z1 - z0) / 2
    const crown = deckY0 - 0.12
    const spring = 0.12
    const archY = (z: number) => spring + (crown - spring) * Math.sqrt(Math.max(0, 1 - ((z - zc) / hz) ** 2))
    for (let i = 0; i < seg; i++) {
      const za = z0 + ((z1 - z0) * i) / seg, zb = z0 + ((z1 - z0) * (i + 1)) / seg
      const ya = archY(za), yb = archY(zb)
      for (const sx of [-1, 1]) {
        const x = sx * W
        if (sx < 0) quadF([x, ya, za], [x, deckY0, za], [x, deckY0, zb], [x, yb, zb], stone)
        else quadF([x, ya, za], [x, yb, zb], [x, deckY0, zb], [x, deckY0, za], stone)
      }
      quadF([-W, ya, za], [-W, yb, zb], [W, yb, zb], [W, ya, za], stoneDark)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aColor', new THREE.BufferAttribute(new Uint8Array(col), 4, true))
  g.computeVertexNormals()
  return g
}
