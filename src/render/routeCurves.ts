// Curves along cell paths, shared by the trade and road layers.
//
// smoothPaths: each path on its own, as the journey trails do it (journeys.ts). A cell
// path on the hex grid drawn cell to cell runs in three fixed directions; instead each
// path becomes a centripetal Catmull-Rom curve through a decimated subset of its cells
// (every KNOT_STRIDE-th, both cells of every land/sea transition, and the endpoints). Each
// stretch between two knots is checked against the grid: a land stretch whose curve
// strays over water (a bay), or a sea stretch that strays over land (a cape), gets the
// skipped cells back as knots until it fits. Every sample records whether it lies over
// water, so land legs stay on land and sea legs at sea.
//
// routeNetwork: all trade paths at once, bundled. Smoothing every route separately draws
// routes that share a corridor as a braid of near-parallel lines; instead the network is
// the set of distinct cell-to-cell links the routes travel, each drawn (and travelled)
// along one shared curve:
//  - Nodes are the cells on some path. A node sits at its cell centre, except that a land
//    node on a river (not a route end) moves to one bank, clear of the river ribbon, so a
//    road along a valley runs beside its river instead of on top of it. The bank is the
//    one most of the node's off-river links lead to; a run of nodes along the river keeps
//    the bank of its neighbours. Chains of plain nodes (two links, not on a river, not at
//    a route end or junction, not at the coast) are relaxed toward their neighbours a few
//    times, within their own cell and its land or sea, which straightens the hex zigzag.
//  - Each link is two half curves, one per end: a cubic from the node to the link's
//    midpoint. Halves meet at the midpoint with the link's direction, and at a node with
//    two links both halves follow the line through the neighbours, so a chain is smooth;
//    at a junction a half carries on the straightest opposite link, or points straight in.
//  - Per route, the ordered links (and their direction): merchants walk their route along
//    the shared halves.
// The network depends on the world and the paths only; it is built once per history
// (cached) and used by both the trade layer (flow lines, merchants) and the road layer
// (roads, bridges), so a road and the land trade it carries are the same curve.

import * as THREE from 'three'
import { RIVER_FLOW_THRESHOLD, type World } from '../contract.ts'
import { isWaterCell, lakeArray, surfaceRadius } from './globe.ts'

const KNOT_STRIDE = 3
const SAMPLES_PER_CELL = 3

export interface PathSamples {
  /** Paths in the input. */
  count: number
  /** Samples of path i are [offsets[i], offsets[i + 1]); fewer than 2 means nothing to draw. */
  offsets: Uint32Array
  /** xyz per sample, `lift` above the ground. */
  pos: Float32Array
  /** Unit sideways direction per sample (in the tangent plane, perpendicular to the curve). */
  side: Float32Array
  /** Arc length from the path start (world units) per sample. */
  arc: Float32Array
  /** arc / total length per sample. */
  frac: Float32Array
  /** 1 where the sample lies over water. */
  water: Uint8Array
  /** Total arc length per path. */
  length: Float32Array
}

/** Centripetal Catmull-Rom (alpha 0.5) between p1 and p2 at u in [0, 1]. */
function centripetal(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, u: number, out: THREE.Vector3) {
  const t1 = Math.sqrt(Math.max(p0.distanceTo(p1), 1e-9))
  const t2 = t1 + Math.sqrt(Math.max(p1.distanceTo(p2), 1e-9))
  const t3 = t2 + Math.sqrt(Math.max(p2.distanceTo(p3), 1e-9))
  const t = t1 + (t2 - t1) * u
  const lerp = (a: number, b: number, ta: number, tb: number) => ((tb - t) / (tb - ta)) * a + ((t - ta) / (tb - ta)) * b
  const coord = (a: number, b: number, c: number, d: number) => {
    const A1 = lerp(a, b, 0, t1), A2 = lerp(b, c, t1, t2), A3 = lerp(c, d, t2, t3)
    const B1 = lerp(A1, A2, 0, t2), B2 = lerp(A2, A3, t1, t3)
    return lerp(B1, B2, t1, t2)
  }
  return out.set(coord(p0.x, p1.x, p2.x, p3.x), coord(p0.y, p1.y, p2.y, p3.y), coord(p0.z, p1.z, p2.z, p3.z))
}

/** Smoothed samples of the paths path[offsets[i] .. offsets[i + 1]). */
export function smoothPaths(world: World, pathOffsets: Uint32Array, path: Uint32Array, count: number, lift: number): PathSamples {
  const P = world.grid.positions
  const nbOff = world.grid.neighborOffsets
  const nbList = world.grid.neighbors
  const cellCount = world.grid.cellCount
  const lake = lakeArray(world)
  const knots: number[] = []
  const tmpKnots: number[] = []
  const ka = new THREE.Vector3(), kb = new THREE.Vector3(), kc = new THREE.Vector3(), kd = new THREE.Vector3()
  const q = new THREE.Vector3(), t = new THREE.Vector3()
  const unit = (cell: number, out: THREE.Vector3) => out.set(P[cell * 3], P[cell * 3 + 1], P[cell * 3 + 2])
  const isWater = (cell: number) => isWaterCell(world, lake, cell)

  function curvePoint(p0: number, i0: number, i1: number, i2: number, i3: number, u: number, out: THREE.Vector3) {
    unit(path[p0 + i1], kb)
    unit(path[p0 + i2], kc)
    if (i0 >= 0) unit(path[p0 + i0], ka)
    else ka.copy(kb).multiplyScalar(2).sub(kc)
    if (i3 >= 0) unit(path[p0 + i3], kd)
    else kd.copy(kc).multiplyScalar(2).sub(kb)
    centripetal(ka, kb, kc, kd, u, out)
    return out.normalize()
  }

  function nearestCell(v: THREE.Vector3, start: number): number {
    let cur = start
    let best = P[cur * 3] * v.x + P[cur * 3 + 1] * v.y + P[cur * 3 + 2] * v.z
    for (let iter = 0; iter < 64; iter++) {
      let next = -1
      for (let k = nbOff[cur]; k < nbOff[cur + 1]; k++) {
        const c = nbList[k]
        const d = P[c * 3] * v.x + P[c * 3 + 1] * v.y + P[c * 3 + 2] * v.z
        if (d > best) {
          best = d
          next = c
        }
      }
      if (next < 0) break
      cur = next
    }
    return cur
  }

  const samplesOf = (span: number) => Math.max(2, span * SAMPLES_PER_CELL)

  function chooseKnots(p0: number, n: number) {
    knots.length = 0
    let last = 0
    knots.push(0)
    for (let k = 1; k < n; k++) {
      const transition = isWater(path[p0 + k]) !== isWater(path[p0 + k - 1])
      const before = k + 1 < n && isWater(path[p0 + k + 1]) !== isWater(path[p0 + k])
      if (k === n - 1 || transition || before || k - last >= KNOT_STRIDE) {
        knots.push(k)
        last = k
      }
    }
    for (let round = 0; round < 6; round++) {
      let changed = false
      tmpKnots.length = 0
      for (let i = 0; i + 1 < knots.length; i++) {
        tmpKnots.push(knots[i])
        const i1 = knots[i], i2 = knots[i + 1]
        if (i2 - i1 < 2) continue
        const w = isWater(path[p0 + i1])
        const m = samplesOf(i2 - i1)
        let ok = true
        for (let s = 1; s < m && ok; s++) {
          const u = s / m
          curvePoint(p0, i > 0 ? knots[i - 1] : -1, i1, i2, i + 2 < knots.length ? knots[i + 2] : -1, u, q)
          const guess = path[p0 + Math.min(i2, i1 + Math.round(u * (i2 - i1)))]
          if (isWater(nearestCell(q, guess)) !== w) ok = false
        }
        if (!ok) {
          if (i2 - i1 <= 3) for (let k = i1 + 1; k < i2; k++) tmpKnots.push(k)
          else tmpKnots.push((i1 + i2) >> 1)
          changed = true
        }
      }
      tmpKnots.push(knots[knots.length - 1])
      knots.length = 0
      for (const k of tmpKnots) knots.push(k)
      if (!changed) break
    }
  }

  const validPath = (p0: number, p1: number) => {
    for (let k = p0; k < p1; k++) if (path[k] >= cellCount) return false
    return true
  }

  let cap = 0
  for (let j = 0; j < count; j++) {
    const n = pathOffsets[j + 1] - pathOffsets[j]
    if (n >= 2) cap += (n - 1) * SAMPLES_PER_CELL + 1
  }
  const sPos = new Float32Array(cap * 3)
  const sSide = new Float32Array(cap * 3)
  const sFrac = new Float32Array(cap)
  const sArc = new Float32Array(cap)
  const sWater = new Uint8Array(cap)
  const length = new Float32Array(count)
  const offsets = new Uint32Array(count + 1)
  let ns = 0

  for (let j = 0; j < count; j++) {
    offsets[j] = ns
    const p0 = pathOffsets[j], p1 = pathOffsets[j + 1]
    const n = p1 - p0
    if (n < 2 || !validPath(p0, p1)) continue
    chooseKnots(p0, n)
    let cell = path[p0]
    for (let i = 0; i + 1 < knots.length; i++) {
      const i1 = knots[i], i2 = knots[i + 1]
      const r1 = surfaceRadius(world, path[p0 + i1]), r2 = surfaceRadius(world, path[p0 + i2])
      const m = samplesOf(i2 - i1)
      const lastPiece = i + 2 === knots.length
      for (let s = 0; s < m + (lastPiece ? 1 : 0); s++) {
        const u = s / m
        curvePoint(p0, i > 0 ? knots[i - 1] : -1, i1, i2, i + 2 < knots.length ? knots[i + 2] : -1, u, q)
        cell = nearestCell(q, cell)
        const w = u === 0 ? isWater(path[p0 + i1]) : u === 1 ? isWater(path[p0 + i2]) : isWater(cell)
        const r = r1 + (r2 - r1) * u + lift
        sPos[ns * 3] = q.x * r
        sPos[ns * 3 + 1] = q.y * r
        sPos[ns * 3 + 2] = q.z * r
        sWater[ns] = w ? 1 : 0
        ns++
      }
    }
    const s0 = offsets[j]
    for (let s = s0; s < ns; s++) {
      const a = Math.max(s0, s - 1), b = Math.min(ns - 1, s + 1)
      t.set(sPos[b * 3] - sPos[a * 3], sPos[b * 3 + 1] - sPos[a * 3 + 1], sPos[b * 3 + 2] - sPos[a * 3 + 2])
      q.set(sPos[s * 3], sPos[s * 3 + 1], sPos[s * 3 + 2]).normalize()
      t.crossVectors(q, t).normalize()
      sSide[s * 3] = t.x
      sSide[s * 3 + 1] = t.y
      sSide[s * 3 + 2] = t.z
    }
    let len = 0
    sArc[s0] = 0
    for (let s = s0 + 1; s < ns; s++) {
      len += Math.hypot(sPos[s * 3] - sPos[s * 3 - 3], sPos[s * 3 + 1] - sPos[s * 3 - 2], sPos[s * 3 + 2] - sPos[s * 3 - 1])
      sArc[s] = len
    }
    for (let s = s0; s < ns; s++) sFrac[s] = len > 0 ? sArc[s] / len : (s - s0) / Math.max(1, ns - 1 - s0)
    length[j] = len
  }
  offsets[count] = ns
  return { count, offsets, pos: sPos, side: sSide, arc: sArc, frac: sFrac, water: sWater, length }
}

// ---------------------------------------------------------------------------
// Bundled route network

/** Samples per half link (node to link midpoint), both ends included. */
export const HALF_SAMPLES = 6

/** Half width of a river ribbon at flow f (as rivers.ts draws it). */
export function riverHalfWidth(f: number): number {
  return Math.min(0.0032, 0.0006 + 0.00075 * Math.log(Math.max(f, RIVER_FLOW_THRESHOLD) / RIVER_FLOW_THRESHOLD))
}

/** Gap between a river's edge and the centre of a road on its bank. */
const BANK_CLEARANCE = 0.0023

export interface RouteNetwork {
  world: World
  /** Distinct links: cells linkA < linkB, their nodes, and 1 where either end is water (a sea lane). */
  linkCount: number
  linkA: Int32Array
  linkB: Int32Array
  linkNodeA: Int32Array
  linkNodeB: Int32Array
  linkSea: Uint8Array
  /** Routes using each link. */
  linkRoutes: Uint16Array
  /** Nodes: their cell, and the incident links as CSR (nodeLinks[nodeLinkOffsets[n] ..)). */
  nodeCount: number
  nodeCell: Int32Array
  nodeLinkOffsets: Uint32Array
  nodeLinks: Int32Array
  /** 1 where a node is the end of some route (a settlement). */
  nodeEnd: Uint8Array
  /** Node of each cell, or -1. */
  nodeOfCell: Int32Array
  /**
   * Half h of link l is 2l (from linkA's node) or 2l + 1 (from linkB's node); its
   * HALF_SAMPLES samples run from the node (first) to the link midpoint (last), shared
   * with the other half there. Per sample: unit direction (3), ground radius, unit side
   * vector (3, in the tangent plane, across the curve), arc length from the node.
   */
  halfDir: Float32Array
  halfRadius: Float32Array
  halfSide: Float32Array
  halfArc: Float32Array
  /** Per route: its links in travel order, and 1 where it travels the link from linkA to linkB. */
  routeLinkOffsets: Uint32Array
  routeLinks: Int32Array
  routeForward: Uint8Array
}

const networkCache = new WeakMap<Uint32Array, RouteNetwork>()

/** The bundled network of the paths path[pathOffsets[r] .. pathOffsets[r + 1]) (cached per path array and world). */
export function routeNetwork(world: World, pathOffsets: Uint32Array, path: Uint32Array, count: number): RouteNetwork {
  const hit = networkCache.get(path)
  if (hit && hit.world === world && hit.routeLinkOffsets.length === count + 1) return hit
  const net = buildRouteNetwork(world, pathOffsets, path, count)
  networkCache.set(path, net)
  return net
}

function buildRouteNetwork(world: World, pathOffsets: Uint32Array, path: Uint32Array, count: number): RouteNetwork {
  const { grid, flow, riverTo } = world
  const P = grid.positions
  const N = grid.cellCount
  const nbOff = grid.neighborOffsets
  const nbList = grid.neighbors
  const lake = lakeArray(world)
  const water = (c: number) => isWaterCell(world, lake, c)
  const isRiver = (c: number) => flow[c] >= RIVER_FLOW_THRESHOLD && riverTo[c] >= 0 && !water(c)
  const spacing = Math.sqrt((4 * Math.PI) / N)

  // drawn along shared sea lanes (see snapSeaLegs)
  ;({ offsets: pathOffsets, path } = snapSeaLegs(world, pathOffsets, path, count, water))

  // ---------- links and nodes ----------
  const linkIndex = new Map<number, number>()
  const la: number[] = [], lb: number[] = []
  const rl: number[] = [], rf: number[] = []
  const routeLinkOffsets = new Uint32Array(count + 1)
  const nodeOfCell = new Int32Array(N).fill(-1)
  const nodeCellList: number[] = []
  const endCell = new Uint8Array(N)
  const addNode = (c: number) => {
    if (nodeOfCell[c] < 0) {
      nodeOfCell[c] = nodeCellList.length
      nodeCellList.push(c)
    }
  }
  for (let r = 0; r < count; r++) {
    routeLinkOffsets[r] = rl.length
    const p0 = pathOffsets[r], p1 = pathOffsets[r + 1]
    let ok = p1 - p0 >= 2
    for (let k = p0; k < p1 && ok; k++) if (path[k] >= N) ok = false
    if (!ok) continue
    endCell[path[p0]] = 1
    endCell[path[p1 - 1]] = 1
    for (let k = p0 + 1; k < p1; k++) {
      const c = path[k - 1], d = path[k]
      if (c === d) continue
      const lo = Math.min(c, d), hi = Math.max(c, d)
      const key = lo * N + hi
      let id = linkIndex.get(key)
      if (id === undefined) {
        id = la.length
        linkIndex.set(key, id)
        la.push(lo)
        lb.push(hi)
        addNode(lo)
        addNode(hi)
      }
      rl.push(id)
      rf.push(c === lo ? 1 : 0)
    }
  }
  routeLinkOffsets[count] = rl.length
  const L = la.length
  const linkA = Int32Array.from(la), linkB = Int32Array.from(lb)
  const routeLinks = Int32Array.from(rl), routeForward = Uint8Array.from(rf)
  const nodeCount = nodeCellList.length
  const nodeCell = Int32Array.from(nodeCellList)
  const linkNodeA = new Int32Array(L), linkNodeB = new Int32Array(L)
  const linkSea = new Uint8Array(L)
  const linkRoutes = new Uint16Array(L)
  for (let l = 0; l < L; l++) {
    linkNodeA[l] = nodeOfCell[linkA[l]]
    linkNodeB[l] = nodeOfCell[linkB[l]]
    linkSea[l] = water(linkA[l]) || water(linkB[l]) ? 1 : 0
  }
  for (let r = 0; r < count; r++) {
    // a route crossing a link twice counts once
    for (let k = routeLinkOffsets[r]; k < routeLinkOffsets[r + 1]; k++) {
      const l = routeLinks[k]
      let dup = false
      for (let q = routeLinkOffsets[r]; q < k && !dup; q++) if (routeLinks[q] === l) dup = true
      if (!dup && linkRoutes[l] < 65535) linkRoutes[l]++
    }
  }
  const nodeLinkOffsets = new Uint32Array(nodeCount + 1)
  for (let l = 0; l < L; l++) {
    nodeLinkOffsets[linkNodeA[l] + 1]++
    nodeLinkOffsets[linkNodeB[l] + 1]++
  }
  for (let n = 0; n < nodeCount; n++) nodeLinkOffsets[n + 1] += nodeLinkOffsets[n]
  const nodeLinks = new Int32Array(nodeLinkOffsets[nodeCount])
  {
    const cur = nodeLinkOffsets.slice(0, nodeCount)
    for (let l = 0; l < L; l++) {
      nodeLinks[cur[linkNodeA[l]]++] = l
      nodeLinks[cur[linkNodeB[l]]++] = l
    }
  }
  const nodeEnd = new Uint8Array(nodeCount)
  for (let n = 0; n < nodeCount; n++) nodeEnd[n] = endCell[nodeCell[n]]
  const otherNode = (l: number, n: number) => (linkNodeA[l] === n ? linkNodeB[l] : linkNodeA[l])
  const degree = (n: number) => nodeLinkOffsets[n + 1] - nodeLinkOffsets[n]

  // ---------- node positions (unit vectors) ----------
  const pos = new Float32Array(nodeCount * 3)
  for (let n = 0; n < nodeCount; n++) {
    const c = nodeCell[n]
    pos[n * 3] = P[c * 3]
    pos[n * 3 + 1] = P[c * 3 + 1]
    pos[n * 3 + 2] = P[c * 3 + 2]
  }
  const fixed = new Uint8Array(nodeCount)

  /** Nearest cell to unit vector (x, y, z), walking greedily from `start`. */
  const nearestCell = (x: number, y: number, z: number, start: number) => {
    let cur = start
    let best = P[cur * 3] * x + P[cur * 3 + 1] * y + P[cur * 3 + 2] * z
    for (let iter = 0; iter < 16; iter++) {
      let next = -1
      for (let k = nbOff[cur]; k < nbOff[cur + 1]; k++) {
        const c = nbList[k]
        const d = P[c * 3] * x + P[c * 3 + 1] * y + P[c * 3 + 2] * z
        if (d > best) {
          best = d
          next = c
        }
      }
      if (next < 0) break
      cur = next
    }
    return cur
  }
  // river nodes move to one bank
  const main = new Int32Array(N).fill(-1)
  for (let i = 0; i < N; i++) {
    if (!isRiver(i)) continue
    const j = riverTo[i]
    if (main[j] < 0 || flow[i] > flow[main[j]]) main[j] = i
  }
  const upOf = (c: number) => {
    if (main[c] >= 0) return main[c]
    for (let k = nbOff[c]; k < nbOff[c + 1]; k++) if (riverTo[nbList[k]] === c && water(nbList[k])) return nbList[k] // lake outlet
    return -1
  }
  const riverSide = new Float32Array(nodeCount * 3)
  const bank = new Int8Array(nodeCount)
  const onRiver = new Uint8Array(nodeCount)
  const t3 = new THREE.Vector3(), u3 = new THREE.Vector3(), s3 = new THREE.Vector3(), d3 = new THREE.Vector3()
  const along = (c: number, x: number) => (riverTo[x] === c && isRiver(x)) || riverTo[c] === x
  for (let n = 0; n < nodeCount; n++) {
    const c = nodeCell[n]
    if (!isRiver(c) || nodeEnd[n]) continue
    const up = upOf(c), down = riverTo[c]
    u3.set(P[c * 3], P[c * 3 + 1], P[c * 3 + 2])
    const ux = up >= 0 ? up : c
    t3.set(P[down * 3] - P[ux * 3], P[down * 3 + 1] - P[ux * 3 + 1], P[down * 3 + 2] - P[ux * 3 + 2])
    t3.addScaledVector(u3, -t3.dot(u3))
    if (t3.lengthSq() < 1e-12) continue
    s3.crossVectors(u3, t3).normalize()
    riverSide[n * 3] = s3.x
    riverSide[n * 3 + 1] = s3.y
    riverSide[n * 3 + 2] = s3.z
    onRiver[n] = 1
    let vote = 0
    for (let k = nodeLinkOffsets[n]; k < nodeLinkOffsets[n + 1]; k++) {
      const l = nodeLinks[k]
      const x = nodeCell[otherNode(l, n)]
      if (along(c, x)) continue
      d3.set(P[x * 3] - u3.x, P[x * 3 + 1] - u3.y, P[x * 3 + 2] - u3.z)
      vote += Math.sign(d3.dot(s3)) * linkRoutes[l]
    }
    bank[n] = Math.sign(vote)
  }
  // runs along the river keep the bank of their neighbours
  for (let pass = 0; pass < 12; pass++) {
    let changed = false
    for (let n = 0; n < nodeCount; n++) {
      if (!onRiver[n] || bank[n] !== 0) continue
      let vote = 0
      for (let k = nodeLinkOffsets[n]; k < nodeLinkOffsets[n + 1]; k++) {
        const m = otherNode(nodeLinks[k], n)
        if (onRiver[m] && bank[m] !== 0 && along(nodeCell[n], nodeCell[m])) vote += bank[m]
      }
      if (vote !== 0) {
        bank[n] = Math.sign(vote)
        changed = true
      }
    }
    if (!changed) break
  }
  for (let n = 0; n < nodeCount; n++) {
    if (!onRiver[n]) continue
    const c = nodeCell[n]
    const off = riverHalfWidth(flow[c]) + BANK_CLEARANCE
    // the chosen bank, else the other one if that would put the road in a lake
    for (const b of bank[n] < 0 ? [-1, 1] : [1, -1]) {
      u3.set(P[c * 3], P[c * 3 + 1], P[c * 3 + 2])
      u3.x += riverSide[n * 3] * b * off
      u3.y += riverSide[n * 3 + 1] * b * off
      u3.z += riverSide[n * 3 + 2] * b * off
      u3.normalize()
      if (water(nearestCell(u3.x, u3.y, u3.z, c))) continue
      pos[n * 3] = u3.x
      pos[n * 3 + 1] = u3.y
      pos[n * 3 + 2] = u3.z
      break
    }
    fixed[n] = 1
  }

  // relax chains of plain nodes
  const nbA = new Int32Array(nodeCount).fill(-1), nbB = new Int32Array(nodeCount).fill(-1)
  const seaNode = new Uint8Array(nodeCount)
  for (let n = 0; n < nodeCount; n++) {
    seaNode[n] = water(nodeCell[n]) ? 1 : 0
    if (fixed[n] || nodeEnd[n] || degree(n) !== 2) continue
    const l0 = nodeLinks[nodeLinkOffsets[n]], l1 = nodeLinks[nodeLinkOffsets[n] + 1]
    if (linkSea[l0] !== linkSea[l1]) continue
    nbA[n] = otherNode(l0, n)
    nbB[n] = otherNode(l1, n)
  }
  const next = new Float32Array(pos.length)
  const maxShift = 0.42 * spacing
  for (let iter = 0; iter < 8; iter++) {
    next.set(pos)
    for (let n = 0; n < nodeCount; n++) {
      const a = nbA[n], b = nbB[n]
      if (a < 0 || (iter >= 3 && !seaNode[n])) continue // land: a light touch; open sea: straighter
      let x = pos[n * 3] + 0.25 * (pos[a * 3] + pos[b * 3] - 2 * pos[n * 3])
      let y = pos[n * 3 + 1] + 0.25 * (pos[a * 3 + 1] + pos[b * 3 + 1] - 2 * pos[n * 3 + 1])
      let z = pos[n * 3 + 2] + 0.25 * (pos[a * 3 + 2] + pos[b * 3 + 2] - 2 * pos[n * 3 + 2])
      const len = Math.hypot(x, y, z) || 1
      x /= len
      y /= len
      z /= len
      const c = nodeCell[n]
      if (Math.hypot(x - P[c * 3], y - P[c * 3 + 1], z - P[c * 3 + 2]) > maxShift) continue
      const at = nearestCell(x, y, z, c)
      if (seaNode[n] ? !water(at) : water(at) || isRiver(at)) continue
      next[n * 3] = x
      next[n * 3 + 1] = y
      next[n * 3 + 2] = z
    }
    pos.set(next)
  }

  // ---------- half curves ----------
  const H = 2 * L
  const S = HALF_SAMPLES
  const halfDir = new Float32Array(H * S * 3)
  const halfRadius = new Float32Array(H * S)
  const halfSide = new Float32Array(H * S * 3)
  const halfArc = new Float32Array(H * S)
  const pn = new THREE.Vector3(), pm = new THREE.Vector3(), py = new THREE.Vector3(), mid = new THREE.Vector3()
  const tn = new THREE.Vector3(), dm = new THREE.Vector3(), b1 = new THREE.Vector3(), b2 = new THREE.Vector3()
  const q = new THREE.Vector3(), prev = new THREE.Vector3(), tan = new THREE.Vector3()
  const nodeVec = (n: number, out: THREE.Vector3) => out.set(pos[n * 3], pos[n * 3 + 1], pos[n * 3 + 2])
  const tangentPlane = (v: THREE.Vector3, at: THREE.Vector3) => v.addScaledVector(at, -v.dot(at)).normalize()
  for (let l = 0; l < L; l++) {
    for (let e = 0; e < 2; e++) {
      const n = e === 0 ? linkNodeA[l] : linkNodeB[l]
      const m = e === 0 ? linkNodeB[l] : linkNodeA[l]
      nodeVec(n, pn)
      nodeVec(m, pm)
      mid.copy(pn).add(pm).normalize()
      dm.copy(pm).sub(pn)
      tangentPlane(dm, mid)
      // tangent at the node: along the line through the opposite neighbour
      let bestCos = 2, y = -1
      for (let k = nodeLinkOffsets[n]; k < nodeLinkOffsets[n + 1]; k++) {
        const o = nodeLinks[k]
        if (o === l) continue
        const yy = otherNode(o, n)
        nodeVec(yy, py)
        const cos = (pm.x - pn.x) * (py.x - pn.x) + (pm.y - pn.y) * (py.y - pn.y) + (pm.z - pn.z) * (py.z - pn.z)
        const norm = Math.hypot(pm.x - pn.x, pm.y - pn.y, pm.z - pn.z) * Math.hypot(py.x - pn.x, py.y - pn.y, py.z - pn.z) || 1
        if (cos / norm < bestCos) {
          bestCos = cos / norm
          y = yy
        }
      }
      if (y >= 0 && (degree(n) === 2 || bestCos < -0.55)) {
        nodeVec(y, py)
        tn.copy(pm).sub(py)
      } else tn.copy(pm).sub(pn)
      tangentPlane(tn, pn)
      const h = pn.distanceTo(mid) * 0.42
      b1.copy(pn).addScaledVector(tn, h)
      b2.copy(mid).addScaledVector(dm, -h)
      const rn = surfaceRadius(world, nodeCell[n])
      const rmid = (rn + surfaceRadius(world, nodeCell[m])) / 2
      const base = (2 * l + e) * S
      let arc = 0
      for (let s = 0; s < S; s++) {
        const t = s / (S - 1), u = 1 - t
        q.set(0, 0, 0).addScaledVector(pn, u * u * u).addScaledVector(b1, 3 * u * u * t).addScaledVector(b2, 3 * u * t * t).addScaledVector(mid, t * t * t)
        tan.set(0, 0, 0).addScaledVector(b1.clone().sub(pn), 3 * u * u).addScaledVector(b2.clone().sub(b1), 6 * u * t).addScaledVector(mid.clone().sub(b2), 3 * t * t)
        q.normalize()
        if (s > 0) arc += q.distanceTo(prev)
        prev.copy(q)
        const i = base + s
        halfDir[i * 3] = q.x
        halfDir[i * 3 + 1] = q.y
        halfDir[i * 3 + 2] = q.z
        halfRadius[i] = rn + (rmid - rn) * t
        halfArc[i] = arc
        tan.crossVectors(q, tan).normalize()
        halfSide[i * 3] = tan.x
        halfSide[i * 3 + 1] = tan.y
        halfSide[i * 3 + 2] = tan.z
      }
    }
  }

  return {
    world,
    linkCount: L,
    linkA,
    linkB,
    linkNodeA,
    linkNodeB,
    linkSea,
    linkRoutes,
    nodeCount,
    nodeCell,
    nodeLinkOffsets,
    nodeLinks,
    nodeEnd,
    nodeOfCell,
    halfDir,
    halfRadius,
    halfSide,
    halfArc,
    routeLinkOffsets,
    routeLinks,
    routeForward,
  }
}

/** Cells either side of a sea leg it may move to, and the cost of a step along a link an earlier route already uses. */
const SNAP_RINGS = 2
const SHARED_STEP = 0.55

/**
 * Sea legs snapped onto shared lanes. Across open water many paths are equally short, so
 * routes between nearby ports run one cell apart and draw as parallel lanes. Routes are
 * taken in order (first opened first); each sea leg of three cells or more (a run of
 * water cells between its two shore cells) is re-found as the cheapest path within
 * SNAP_RINGS cells of the original, where a step along a link an earlier route already
 * uses costs less, so later routes join the lanes of earlier ones (a leg at most two
 * cells longer than before; else it stays). Land legs are kept as they are (roads are
 * worn on their cells). Drawing only: the history is unchanged.
 */
function snapSeaLegs(world: World, pathOffsets: Uint32Array, path: Uint32Array, count: number, water: (c: number) => boolean): { offsets: Uint32Array; path: Uint32Array } {
  const N = world.grid.cellCount
  const off = world.grid.neighborOffsets
  const nb = world.grid.neighbors
  const used = new Set<number>()
  const key = (a: number, b: number) => (a < b ? a * N + b : b * N + a)
  const stamp = new Int32Array(N).fill(-1)
  const dist = new Float64Array(N).fill(Infinity)
  const from = new Int32Array(N)
  const done = new Uint8Array(N)
  const touched: number[] = []
  // binary heap of (cost, cell)
  const hc: number[] = [], hv: number[] = []
  const push = (c: number, v: number) => {
    let i = hc.length
    hc.push(c)
    hv.push(v)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (hc[p] <= hc[i]) break
      ;[hc[p], hc[i]] = [hc[i], hc[p]]
      ;[hv[p], hv[i]] = [hv[i], hv[p]]
      i = p
    }
  }
  const pop = () => {
    const v = hv[0]
    const lc = hc.pop()!, lv = hv.pop()!
    if (hc.length > 0) {
      hc[0] = lc
      hv[0] = lv
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < hc.length && hc[l] < hc[m]) m = l
        if (r < hc.length && hc[r] < hc[m]) m = r
        if (m === i) break
        ;[hc[m], hc[i]] = [hc[i], hc[m]]
        ;[hv[m], hv[i]] = [hv[i], hv[m]]
        i = m
      }
    }
    return v
  }
  const outPath: number[] = []
  const offsets = new Uint32Array(count + 1)
  const leg: number[] = []
  let legId = 0
  for (let r = 0; r < count; r++) {
    offsets[r] = outPath.length
    const p0 = pathOffsets[r], p1 = pathOffsets[r + 1]
    let ok = p1 - p0 >= 2
    for (let k = p0; k < p1 && ok; k++) if (path[k] >= N) ok = false
    if (!ok) {
      for (let k = p0; k < p1; k++) outPath.push(path[k])
      continue
    }
    const start = outPath.length
    for (let k = p0; k < p1; ) {
      if (!water(path[k])) {
        outPath.push(path[k])
        k++
        continue
      }
      let e = k
      while (e + 1 < p1 && water(path[e + 1])) e++
      // water run [k, e] between the shore cells k - 1 and e + 1 (when the path has them)
      if (e - k + 1 >= 3 && k > p0 && e + 1 < p1) {
        const id = legId++
        // the corridor: SNAP_RINGS rings of water around the run, and the two shore cells
        let ring: number[] = []
        for (let q = k - 1; q <= e + 1; q++) {
          if (stamp[path[q]] !== id) {
            stamp[path[q]] = id
            ring.push(path[q])
          }
        }
        for (let g = 0; g < SNAP_RINGS; g++) {
          const next: number[] = []
          for (const c of ring) {
            for (let j = off[c]; j < off[c + 1]; j++) {
              const x = nb[j]
              if (stamp[x] === id || !water(x)) continue
              stamp[x] = id
              next.push(x)
            }
          }
          ring = next
        }
        // cheapest path from the shore cell before the run to the one after it
        const src = path[k - 1], dst = path[e + 1]
        hc.length = 0
        hv.length = 0
        dist[src] = 0
        from[src] = -1
        touched.push(src)
        push(0, src)
        while (hc.length > 0) {
          const c = pop()
          if (done[c]) continue
          done[c] = 1
          if (c === dst) break
          for (let j = off[c]; j < off[c + 1]; j++) {
            const x = nb[j]
            if (stamp[x] !== id || done[x] || (x !== dst && !water(x))) continue
            const d = dist[c] + (used.has(key(c, x)) ? SHARED_STEP : 1)
            if (d < dist[x] - 1e-9) {
              if (dist[x] === Infinity) touched.push(x)
              dist[x] = d
              from[x] = c
              push(d, x)
            }
          }
        }
        leg.length = 0
        if (done[dst]) for (let c = dst; c >= 0; c = from[c]) leg.push(c)
        for (const c of touched) {
          done[c] = 0
          dist[c] = Infinity
        }
        touched.length = 0
        // leg runs dst .. src: keep its water cells (the shore cells are pushed by the land steps)
        if (leg.length >= 3 && leg.length - 2 <= e - k + 1 + 2) for (let q = leg.length - 2; q >= 1; q--) outPath.push(leg[q])
        else for (let q = k; q <= e; q++) outPath.push(path[q])
      } else for (let q = k; q <= e; q++) outPath.push(path[q])
      k = e + 1
    }
    for (let k = start + 1; k < outPath.length; k++) used.add(key(outPath[k - 1], outPath[k]))
  }
  offsets[count] = outPath.length
  return { offsets, path: Uint32Array.from(outPath) }
}

/** PathSamples of every route along the network (`lift` above the ground), plus the link of every sample. */
export function networkRouteSamples(net: RouteNetwork, count: number, lift: number): PathSamples & { link: Int32Array } {
  const S = HALF_SAMPLES
  let cap = 0
  for (let r = 0; r < count; r++) {
    const n = net.routeLinkOffsets[r + 1] - net.routeLinkOffsets[r]
    if (n > 0) cap += n * 2 * (S - 1) + 1
  }
  const pos = new Float32Array(cap * 3)
  const side = new Float32Array(cap * 3)
  const arc = new Float32Array(cap)
  const frac = new Float32Array(cap)
  const water = new Uint8Array(cap)
  const link = new Int32Array(cap)
  const length = new Float32Array(count)
  const offsets = new Uint32Array(count + 1)
  let ns = 0
  const put = (h: number, s: number, l: number) => {
    const i = h * S + s
    const r = net.halfRadius[i] + lift
    pos[ns * 3] = net.halfDir[i * 3] * r
    pos[ns * 3 + 1] = net.halfDir[i * 3 + 1] * r
    pos[ns * 3 + 2] = net.halfDir[i * 3 + 2] * r
    side[ns * 3] = net.halfSide[i * 3]
    side[ns * 3 + 1] = net.halfSide[i * 3 + 1]
    side[ns * 3 + 2] = net.halfSide[i * 3 + 2]
    water[ns] = net.linkSea[l]
    link[ns] = l
    ns++
  }
  for (let r = 0; r < count; r++) {
    offsets[r] = ns
    const k0 = net.routeLinkOffsets[r], k1 = net.routeLinkOffsets[r + 1]
    if (k1 <= k0) continue
    for (let k = k0; k < k1; k++) {
      const l = net.routeLinks[k]
      const fwd = net.routeForward[k] === 1
      const hFrom = 2 * l + (fwd ? 0 : 1), hTo = 2 * l + (fwd ? 1 : 0)
      // from the node out to the midpoint, then in along the other half to the next node
      for (let s = k === k0 ? 0 : 1; s < S; s++) put(hFrom, s, l)
      for (let s = S - 2; s >= 0; s--) put(hTo, s, l)
    }
    const s0 = offsets[r]
    let len = 0
    arc[s0] = 0
    for (let s = s0 + 1; s < ns; s++) {
      len += Math.hypot(pos[s * 3] - pos[s * 3 - 3], pos[s * 3 + 1] - pos[s * 3 - 2], pos[s * 3 + 2] - pos[s * 3 - 1])
      arc[s] = len
    }
    for (let s = s0; s < ns; s++) frac[s] = len > 0 ? arc[s] / len : (s - s0) / Math.max(1, ns - 1 - s0)
    length[r] = len
  }
  offsets[count] = ns
  return { count, offsets, pos, side, arc, frac, water, length, link }
}
