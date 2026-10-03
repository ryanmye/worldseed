// Roads and bridges worn by overland trade.
//
// Roads: History.road holds a road level per cell per land snapshot. Drawn naively
// (every road cell joined to every road neighbour) roads form blobs around busy towns,
// so the road network is the land part of the bundled trade network (routeCurves.ts):
// only cell-to-cell links that some route travels, each drawn once along the same curve
// the land trade line and the merchants follow, so a road and its traffic never run
// side by side. Where the network runs along a river its nodes sit on one bank, so a
// road up a valley is drawn beside the river rather than over it, and crosses only where
// it changes banks. Geometry is static; a link's level is the lower road level of its two
// cells, read from a small texture holding the road rows of the two land snapshots
// bracketing the year (rewritten only when that pair changes) and interpolated in the
// vertex shader, so roads appear, widen and fade with traffic as a pure function of the
// year. Packed-earth ribbons, sun-lit, over the rivers; faint at globe zoom (where the
// trade layer's warm line traces them), clear from mid zoom inward. Close to the ground,
// among the 3D settlements, a road is a narrow track a cart or two wide lying on the
// rendered ground (probed), with a lift that shrinks with the camera's altitude, so
// houses and carts stand on it rather than under it.
//
// Bridges: wherever a road curve crosses a river curve (the river pieces as rivers.ts
// draws them through the link's two cells), a bridge sits at the crossing, its deck along
// the road. At mid zoom it is a flat glyph, a short light deck with dark end caps (one
// instanced draw call); up close a low-poly stone bridge from the diorama layer stands in
// for it (see `placements`). A road leaving a river town from its centre gets none (the
// town draws its own).

import * as THREE from 'three'
import { RIVER_FLOW_THRESHOLD, type TradeRoutes, type World } from '../contract.ts'
import { isWaterCell, lakeArray, SUN_COLOR, SUN_DIRECTION } from './globe.ts'
import { sunUniforms } from './sun.ts'
import { HALF_SAMPLES, riverHalfWidth, routeNetwork } from './routeCurves.ts'
import { createSurface, type Probe } from './dioramas/surface.ts'

/** Height of road ribbons above the ground at globe zoom (rivers 0.0012); it shrinks toward the ground up close. */
const ROAD_LIFT = 0.0014
/** How far a road piece reaches past a junction or end node, so pieces meeting there close up. */
const JUNCTION_REACH = 0.00025
/** A crossing this close to a route end (a river town's centre) gets no bridge: the town draws its own. */
const TOWN_BRIDGE_RADIUS = 0.006
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
  const { grid, flow, riverTo, elevation } = world
  const P = grid.positions
  const N = grid.cellCount
  const off = grid.neighborOffsets
  const nb = grid.neighbors
  const lake = lakeArray(world)
  const T = input.routes
  const water = (c: number) => isWaterCell(world, lake, c)
  const isRiver = (c: number) => flow[c] >= RIVER_FLOW_THRESHOLD && riverTo[c] >= 0 && !water(c)
  const net = routeNetwork(world, T.pathOffsets, T.path, T.count)
  const HS = HALF_SAMPLES
  const degree = (n: number) => net.nodeLinkOffsets[n + 1] - net.nodeLinkOffsets[n]

  // ---------- road pieces: the land halves of the network ----------
  let pieceCount = 0
  let extCount = 0
  for (let l = 0; l < net.linkCount; l++) {
    if (net.linkSea[l]) continue
    pieceCount += 2
    if (degree(net.linkNodeA[l]) !== 2) extCount++
    if (degree(net.linkNodeB[l]) !== 2) extCount++
  }
  const V = (pieceCount * HS + extCount) * 2
  const pos = new Float32Array(V * 3)
  const side = new Float32Array(V * 4) // side xyz, across
  const cells = new Float32Array(V * 4) // link end cells, position along the half, 0
  const index = new Uint32Array((pieceCount * (HS - 1) + extCount) * 6)
  let nv = 0
  let ni = 0
  const surface = createSurface(world)
  const probe: Probe = { radius: 0, nx: 0, ny: 0, nz: 0, elev: 0, lake: 0, cell: 0 }
  let probeStart = 0
  const put = (x: number, y: number, z: number, r: number, sx: number, sy: number, sz: number, a: number, b: number, t: number) => {
    // on the rendered ground (the triangulated surface); the lift is added in the shader
    const len = Math.hypot(x, y, z) || 1
    if (surface.probe(x / len, y / len, z / len, surface.nearestCell(x / len, y / len, z / len, probeStart), probe)) {
      r = probe.radius / len
      probeStart = probe.cell
    }
    for (let e = 0; e < 2; e++) {
      pos[nv * 3] = x * r
      pos[nv * 3 + 1] = y * r
      pos[nv * 3 + 2] = z * r
      side[nv * 4] = sx
      side[nv * 4 + 1] = sy
      side[nv * 4 + 2] = sz
      side[nv * 4 + 3] = e === 0 ? -1 : 1
      cells[nv * 4] = a
      cells[nv * 4 + 1] = b
      cells[nv * 4 + 2] = t
      nv++
    }
  }
  const { halfDir: hd, halfRadius: hr, halfSide: hsd } = net
  for (let l = 0; l < net.linkCount; l++) {
    if (net.linkSea[l]) continue
    const a = net.linkA[l], b = net.linkB[l]
    for (let e = 0; e < 2; e++) {
      const h = 2 * l + e
      const node = e === 0 ? net.linkNodeA[l] : net.linkNodeB[l]
      const i0 = h * HS
      const base = nv
      // at a junction or a road's end, reach a little past the node so the pieces close up
      const ext = degree(node) !== 2
      if (ext) {
        const dx = hd[i0 * 3] - hd[i0 * 3 + 3], dy = hd[i0 * 3 + 1] - hd[i0 * 3 + 4], dz = hd[i0 * 3 + 2] - hd[i0 * 3 + 5]
        const k = JUNCTION_REACH / (Math.hypot(dx, dy, dz) || 1)
        put(hd[i0 * 3] + dx * k, hd[i0 * 3 + 1] + dy * k, hd[i0 * 3 + 2] + dz * k, hr[i0], hsd[i0 * 3], hsd[i0 * 3 + 1], hsd[i0 * 3 + 2], a, b, 0)
      }
      for (let s = 0; s < HS; s++) {
        const i = i0 + s
        put(hd[i * 3], hd[i * 3 + 1], hd[i * 3 + 2], hr[i], hsd[i * 3], hsd[i * 3 + 1], hsd[i * 3 + 2], a, b, s / (HS - 1))
      }
      const n = (nv - base) / 2
      for (let s = 1; s < n; s++) {
        const v = base + s * 2
        index[ni++] = v - 2; index[ni++] = v; index[ni++] = v - 1
        index[ni++] = v - 1; index[ni++] = v; index[ni++] = v + 1
      }
    }
  }

  // ---------- river courses as rivers.ts draws them (for bridges) ----------
  const main = new Int32Array(N).fill(-1)
  for (let i = 0; i < N; i++) {
    if (!isRiver(i)) continue
    const j = riverTo[i]
    if (main[j] < 0 || flow[i] > flow[main[j]]) main[j] = i
  }
  const unitOf = (c: number) => new THREE.Vector3(P[c * 3], P[c * 3 + 1], P[c * 3 + 2])
  const midOf = (x: number, y: number) => unitOf(x).add(unitOf(y)).normalize()
  /** Sampled river pieces drawn through cell b (its main course and the tributaries joining it), with their flow. */
  const piecesOf = (b: number): { pts: THREE.Vector3[]; flow: number }[] => {
    if (!isRiver(b)) return []
    const out: { pts: THREE.Vector3[]; flow: number }[] = []
    const bez = (A: THREE.Vector3, C: THREE.Vector3, B: THREE.Vector3) => {
      const pts: THREE.Vector3[] = []
      for (let s = 0; s < 8; s++) {
        const t = s / 7, u = 1 - t
        pts.push(new THREE.Vector3().addScaledVector(A, u * u).addScaledVector(C, 2 * u * t).addScaledVector(B, t * t).normalize())
      }
      return pts
    }
    const c = riverTo[b]
    let end: THREE.Vector3
    if (water(c)) {
      const eb = elevation[b], ec = elevation[c]
      const t = ec < 0 && eb > ec ? Math.min(0.8, Math.max(0.2, eb / (eb - ec))) : 0.5
      end = unitOf(b).lerp(unitOf(c), t).normalize()
    } else end = midOf(b, c)
    const up = main[b]
    if (up >= 0) {
      const start = midOf(up, b)
      out.push({ pts: bez(start, unitOf(b), end), flow: flow[b] })
      const join = start.clone().multiplyScalar(0.25).addScaledVector(unitOf(b), 0.5).addScaledVector(end, 0.25).normalize()
      for (let k = off[b]; k < off[b + 1]; k++) {
        const a = nb[k]
        if (a === up || riverTo[a] !== b || !isRiver(a)) continue
        const s0 = midOf(a, b)
        out.push({ pts: bez(s0, s0.clone().add(join).normalize(), join), flow: flow[a] })
      }
    } else {
      let outlet = -1
      for (let k = off[b]; k < off[b + 1]; k++) if (riverTo[nb[k]] === b && water(nb[k])) outlet = nb[k]
      if (outlet >= 0) out.push({ pts: bez(midOf(outlet, b), unitOf(b), end), flow: flow[b] })
      else out.push({ pts: bez(unitOf(b), unitOf(b).add(end).normalize(), end), flow: flow[b] })
    }
    return out
  }
  const pieceCache = new Map<number, { pts: THREE.Vector3[]; flow: number }[]>()
  const pieces = (c: number) => {
    let p = pieceCache.get(c)
    if (!p) {
      p = piecesOf(c)
      pieceCache.set(c, p)
    }
    return p
  }

  // ---------- bridges: where a road curve crosses a river curve ----------
  const bridgePos: number[] = []
  const bridgeDir: number[] = []
  const bridgeSpan: number[] = []
  const bridgeCells: number[] = []
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), up3 = new THREE.Vector3(), hit = new THREE.Vector3(), dir = new THREE.Vector3()
  const road2 = new Float64Array(HS * 2)
  for (let l = 0; l < net.linkCount; l++) {
    if (net.linkSea[l]) continue
    const a = net.linkA[l], b = net.linkB[l]
    const cand = [...pieces(a), ...pieces(b)]
    if (cand.length === 0) continue
    for (let e = 0; e < 2; e++) {
      const h = 2 * l + e
      const node = e === 0 ? net.linkNodeA[l] : net.linkNodeB[l]
      const i0 = h * HS
      // a local plane at the half's node
      up3.set(hd[i0 * 3], hd[i0 * 3 + 1], hd[i0 * 3 + 2])
      e1.set(hd[i0 * 3 + 3 * (HS - 1)] - up3.x, hd[i0 * 3 + 3 * (HS - 1) + 1] - up3.y, hd[i0 * 3 + 3 * (HS - 1) + 2] - up3.z)
      e1.addScaledVector(up3, -e1.dot(up3)).normalize()
      e2.crossVectors(up3, e1)
      for (let s = 0; s < HS; s++) {
        const i = i0 + s
        const dx = hd[i * 3] - up3.x, dy = hd[i * 3 + 1] - up3.y, dz = hd[i * 3 + 2] - up3.z
        road2[s * 2] = dx * e1.x + dy * e1.y + dz * e1.z
        road2[s * 2 + 1] = dx * e2.x + dy * e2.y + dz * e2.z
      }
      for (const pc of cand) {
        for (let w = 0; w + 1 < pc.pts.length; w++) {
          const p = pc.pts[w], q = pc.pts[w + 1]
          const px = (p.x - up3.x) * e1.x + (p.y - up3.y) * e1.y + (p.z - up3.z) * e1.z
          const py = (p.x - up3.x) * e2.x + (p.y - up3.y) * e2.y + (p.z - up3.z) * e2.z
          const qx = (q.x - up3.x) * e1.x + (q.y - up3.y) * e1.y + (q.z - up3.z) * e1.z
          const qy = (q.x - up3.x) * e2.x + (q.y - up3.y) * e2.y + (q.z - up3.z) * e2.z
          for (let s = 0; s + 1 < HS; s++) {
            const ax = road2[s * 2], ay = road2[s * 2 + 1], bx = road2[s * 2 + 2], by = road2[s * 2 + 3]
            const rx = bx - ax, ry = by - ay, sx = qx - px, sy = qy - py
            const den = rx * sy - ry * sx
            if (Math.abs(den) < 1e-14) continue
            const t = ((px - ax) * sy - (py - ay) * sx) / den
            const u = ((px - ax) * ry - (py - ay) * rx) / den
            if (t < 0 || t > 1 || u < 0 || u > 1) continue
            const i = i0 + s
            hit.set(hd[i * 3] + (hd[i * 3 + 3] - hd[i * 3]) * t, hd[i * 3 + 1] + (hd[i * 3 + 4] - hd[i * 3 + 1]) * t, hd[i * 3 + 2] + (hd[i * 3 + 5] - hd[i * 3 + 2]) * t).normalize()
            // a road leaving a river town from its centre: the town has its own bridges
            if (net.nodeEnd[node] && hit.distanceTo(up3) < TOWN_BRIDGE_RADIUS) continue
            // one bridge per crossing, also where two links meet on the river
            let dup = false
            for (let k = 0; k < bridgeSpan.length && !dup; k++) {
              const o = k * 3, br = bridgeR(k)
              if (Math.hypot(bridgePos[o] / br - hit.x, bridgePos[o + 1] / br - hit.y, bridgePos[o + 2] / br - hit.z) < 0.004) dup = true
            }
            if (dup) continue
            dir.set(hd[i * 3 + 3] - hd[i * 3], hd[i * 3 + 4] - hd[i * 3 + 1], hd[i * 3 + 5] - hd[i * 3 + 2])
            dir.addScaledVector(hit, -dir.dot(hit)).normalize()
            let r = hr[i] + (hr[i + 1] - hr[i]) * t
            if (surface.probe(hit.x, hit.y, hit.z, surface.nearestCell(hit.x, hit.y, hit.z, probeStart), probe)) r = probe.radius // on the ground
            bridgePos.push(hit.x * r, hit.y * r, hit.z * r)
            bridgeDir.push(dir.x, dir.y, dir.z)
            // (the diorama bridge is (span - 0.0018) * 1.1 long: the river and a little either side)
            bridgeSpan.push(2.1 * riverHalfWidth(pc.flow) + 0.0022)
            bridgeCells.push(a, b, b)
          }
        }
      }
    }
  }
  function bridgeR(k: number) {
    return Math.hypot(bridgePos[k * 3], bridgePos[k * 3 + 1], bridgePos[k * 3 + 2]) || 1
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
    uLift: { value: ROAD_LIFT },
    uFar: { value: 1 },
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
      attribute vec4 aCells; // the link's two cells, position along the half, unused
      uniform float uPixel;
      uniform float uPixelRatio;
      uniform float uLift;
      uniform float uFar;
      ${roadLevelGlsl}
      varying float vAcross;
      varying float vSoft;
      varying float vAlpha;
      varying float vLevel;
      varying vec3 vObjPos;
      void main() {
        float l = min(roadAt(aCells.x), roadAt(aCells.y));
        float vis = smoothstep(0.035, 0.14, l);
        if (vis <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec3 ground = position + normalize(position) * uLift;
        vec4 mv = modelViewMatrix * vec4(ground, 1.0);
        float pix = -mv.z * uPixel * uPixelRatio;
        // half width: a track a cart or two wide up close, the map's width further out
        float w = mix(0.0001 + 0.00016 * l, 0.0002 + 0.00058 * l, uFar);
        float hw = max(w, 0.55 * pix);
        vAlpha = vis * mix(0.95, 0.5 + 0.4 * l, uFar) * min(1.0, w / hw);
        float outer = hw + 0.6 * pix;
        vAcross = aSide.w;
        vSoft = min(1.0, pix / outer);
        vLevel = l;
        vec3 p = ground + aSide.xyz * aSide.w * outer;
        vObjPos = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${litGlsl}
      uniform float uZoom;
      uniform float uFar;
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
        // up close a darker, warmer packed earth (the map's paler line reads better far out)
        albedo = mix(albedo * vec3(0.78, 0.74, 0.68), albedo, uFar);
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
      attribute vec4 aInfo; // span (world), the road link's two cells (twice the second)
      uniform float uPixel;
      uniform float uPixelRatio;
      uniform float uBridgeZoom;
      uniform float uLift;
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
        vec3 c = aPos * (1.0 + uLift + 0.00006);
        vec4 mv = modelViewMatrix * vec4(c, 1.0);
        float pix = -mv.z * uPixel * uPixelRatio; // world size of a CSS pixel here
        // a deck about as wide as the road (the 3D bridge is 0.00045 wide)
        vec2 halfPx = vec2(max(0.5 * aInfo.x / pix, 6.0), max((0.00016 + 0.00012 * l) / pix, 2.0));
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
      const L = (bridgeSpan[k] - 0.0018) * 1.1, W = 0.00045, H = 0.0006 // a small bridge, the size of the 3D settlements (dioramas)
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
      // close to the ground: narrow tracks lying on it
      const alt = Math.max(0, dist - 1)
      const tf = Math.min(1, Math.max(0, (alt - 0.12) / 0.5))
      uniforms.uFar.value = tf * tf * (3 - 2 * tf)
      uniforms.uLift.value = Math.min(ROAD_LIFT, Math.max(0.00004, 0.0006 * alt))
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
