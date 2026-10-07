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
// the set of distinct cell-to-cell links the routes travel, and every curve on a link is
// made of pieces that depend only on the route's own cells around it, so a curve is the
// same on the globe and the map, at every zoom, after the history is extended, and
// whatever other routes exist:
//  - Each link has one meeting point and direction, fixed by the link alone: the midpoint
//    of its two cell centres; on a link between land and sea the drawn shoreline (the
//    shader's noisy coast, terrainHeight.ts evalGround `land`) along the line between the
//    centres, past the cells' boundary and at the water's surface, so a cart runs down to
//    the quay and a ship leaves from the waterline; on a link along a river, beside it on
//    the river's default bank.
//  - A piece runs from a node point in a cell out to the meeting point on one of its
//    links, keyed by the route's cells there (the cell before, this one and the next;
//    `window` 2, for the long-haul lanes, two each side) and shared by every
//    route with the same window. The node point is (p + 2a + b) / 4 of the window's cells
//    (window 2: (p2 + 4p1 + 6a + 4b + b2) / 16), only where they are all land or all sea
//    and the point stays on its medium; at a coast transition or a route's end it is the
//    cell centre; on a river, the bank (a fixed default side, unless both neighbours lie
//    off the river on one side), so a road along a valley runs beside its river. Both
//    pieces at a node follow the line through the neighbours, so a route is smooth there.
//  - A piece is checked against land and sea (a sea piece over water and, by a coast, the
//    drawn sea); one that strays takes the straight chord within its cell instead.
//  - Per route, the ordered links (and their direction) and the two pieces on each:
//    merchants walk their route along the shared pieces.
// The network depends on the world and the paths only; it is built once per history
// (cached) and used by both the trade layer (flow lines, merchants) and the road layer
// (roads, bridges), so a road and the land trade it carries are the same curve.

import * as THREE from 'three'
import { RIVER_FLOW_THRESHOLD, type World } from '../contract.ts'
import { isWaterCell, lakeArray, surfaceRadius } from './globe.ts'
import { riverHalfWidthNear } from './rivers.ts'
import { evalGround, locate, located, newGroundSample, terrainOf } from './terrainHeight.ts'

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
  /** 1 where the sample lies over water (SHORE at a waterline meeting point of the route network: see segmentWater). */
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

/** Samples per piece (node point to meeting point), both ends included. */
export const PIECE_SAMPLES = 6

/**
 * PathSamples.water of a sample at a shoreline meeting point: the waterline where a land piece
 * meets a sea piece (a cart arrives there, a ship leaves). A segment with one end there has the
 * medium of its other end (segmentWater).
 */
export const SHORE = 2

/** Medium of the stretch between samples lo and lo + 1 at u in [0, 1] along it (1 water, 0 land). */
export function segmentWater(water: Uint8Array, lo: number, u: number): number {
  const a = water[lo], b = water[lo + 1]
  if (a === SHORE) return b === SHORE ? 1 : b
  if (b === SHORE) return a
  return u < 0.5 ? a : b
}

/** Half width of a river ribbon at flow f, close up (as rivers.ts draws it there; wider further out, where roads are a map line). */
export function riverHalfWidth(f: number): number {
  return riverHalfWidthNear(f)
}

/** Gap between a river's edge (close up) and the centre of a road on its bank: a road's half width and a little verge. */
const BANK_CLEARANCE = 0.0013
/** How far past the drawn shore a ship leaves, as a fraction of the line between the two cells. */
const SHIP_ROOM = 0.1
/** No neighbour in a piece's window (neighbour slots 0..6 index a cell's neighbour list). */
const NONE = 7

export interface RouteNetwork {
  world: World
  /** Smoothing window: 1 (a node from its two neighbours), 2 (from two cells each side, for the long-haul legs). */
  window: number
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
   * Pieces: the curve from a cell's node point out to the meeting point on one of its links, one
   * per distinct window of cells a route has there (window 1: the route's cells before and after;
   * window 2: two each side), shared by every route with that window. Its link, its end of the
   * link (0 at linkA's cell, 1 at linkB's), its node, 1 where it lies at sea, and 1 where its node
   * point is a route's end (nothing continues past it). PIECE_SAMPLES samples each, from the node
   * point (first) to the meeting point (last): unit direction (3), ground radius, unit side vector
   * (3, in the tangent plane, across the curve), arc length from the node point.
   */
  pieceCount: number
  pieceLink: Int32Array
  pieceEnd: Uint8Array
  pieceNode: Int32Array
  pieceSea: Uint8Array
  pieceOpen: Uint8Array
  pieceDir: Float32Array
  pieceRadius: Float32Array
  pieceSide: Float32Array
  pieceArc: Float32Array
  /** Pieces of each link, as CSR (linkPieces[linkPieceOffsets[l] ..)), in the order first used. */
  linkPieceOffsets: Uint32Array
  linkPieces: Int32Array
  /**
   * Per route: its links in travel order, 1 where it travels the link from linkA to linkB, and the
   * pieces it travels on each (out from the link's first cell, in to its second).
   */
  routeLinkOffsets: Uint32Array
  routeLinks: Int32Array
  routeForward: Uint8Array
  routePieceFrom: Int32Array
  routePieceTo: Int32Array
}

const networkCache = new WeakMap<Uint32Array, RouteNetwork>()

/**
 * The bundled network of the paths path[pathOffsets[r] .. pathOffsets[r + 1]) (cached per path
 * array, world and window). `window` 2 smooths over five cells instead of three (the
 * long-haul lanes, which cross open sea in long straight runs).
 */
export function routeNetwork(world: World, pathOffsets: Uint32Array, path: Uint32Array, count: number, window = 1): RouteNetwork {
  const hit = networkCache.get(path)
  if (hit && hit.world === world && hit.window === window && hit.routeLinkOffsets.length === count + 1) return hit
  const net = buildRouteNetwork(world, pathOffsets, path, count, window)
  networkCache.set(path, net)
  return net
}

function buildRouteNetwork(world: World, pathOffsets: Uint32Array, path: Uint32Array, count: number, window: number): RouteNetwork {
  const { grid, flow, riverTo } = world
  const P = grid.positions
  const N = grid.cellCount
  const nbOff = grid.neighborOffsets
  const nbList = grid.neighbors
  const lake = lakeArray(world)
  const water = (c: number) => isWaterCell(world, lake, c)
  const isRiver = (c: number) => flow[c] >= RIVER_FLOW_THRESHOLD && riverTo[c] >= 0 && !water(c)
  const spacing = Math.sqrt((4 * Math.PI) / N)
  const wide = window >= 2

  // drawn along shared sea lanes (see snapSeaLegs)
  ;({ offsets: pathOffsets, path } = snapSeaLegs(world, pathOffsets, path, count, water))

  // ---------- links, nodes, and each route's cells (repeats dropped) ----------
  const linkIndex = new Map<number, number>()
  const la: number[] = [], lb: number[] = []
  const rl: number[] = [], rf: number[] = []
  const routeLinkOffsets = new Uint32Array(count + 1)
  const cellsOf: number[] = [] // per route link k: the route's cell sequence, at seqStart[r] + (k - routeLinkOffsets[r])
  const seqStart = new Int32Array(count + 1)
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
    seqStart[r] = cellsOf.length
    const p0 = pathOffsets[r], p1 = pathOffsets[r + 1]
    let ok = p1 - p0 >= 2
    for (let k = p0; k < p1 && ok; k++) if (path[k] >= N) ok = false
    if (!ok) continue
    endCell[path[p0]] = 1
    endCell[path[p1 - 1]] = 1
    cellsOf.push(path[p0])
    for (let k = p0 + 1; k < p1; k++) {
      const c = path[k - 1], d = path[k]
      if (c === d) continue
      cellsOf.push(d)
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
    // a route of one repeated cell has no links: drop its lone cell
    if (rl.length === routeLinkOffsets[r]) cellsOf.length = seqStart[r]
  }
  routeLinkOffsets[count] = rl.length
  seqStart[count] = cellsOf.length
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

  // ---------- the ground: cells, rivers, the drawn shore ----------
  const nbSlot = (c: number, x: number) => {
    for (let k = nbOff[c]; k < nbOff[c + 1]; k++) if (nbList[k] === x) return Math.min(NONE, k - nbOff[c])
    return NONE
  }
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
  // where the drawn shore (the shader's noisy coast contour) may differ from the cells: sea cells
  // beside land (1) and land cells beside the sea (2); lakes are drawn by their cells
  const coastal = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    if (lake && lake[i]) continue
    const w = water(i)
    for (let k = nbOff[i]; k < nbOff[i + 1]; k++) {
      const j = nbList[k]
      if (w ? !water(j) : water(j) && !(lake && lake[j])) coastal[i] = w ? 1 : 2
    }
  }
  const field = terrainOf(world)
  const ground = newGroundSample()
  /** The drawn ground at unit vector (x, y, z) is land (the coast contour; lakes are drawn by their cells). */
  const drawnLand = (x: number, y: number, z: number, start: number) => {
    locate(world, x, y, z, start)
    const { a, b, c, la: wa, lb: wb, lc: wc } = located
    if (lake && ((lake[a] && wa > 0.5) || (lake[b] && wb > 0.5) || (lake[c] && wc > 0.5))) return false
    evalGround(field, a, b, c, wa, wb, wc, 0, ground)
    return ground.land > 0
  }
  /** (x, y, z) is fit for a sea piece: over a water cell and, by a coast, over the drawn sea. */
  const seaOk = (x: number, y: number, z: number, start: number) => {
    const c = nearestCell(x, y, z, start)
    return water(c) && !(coastal[c] && drawnLand(x, y, z, c))
  }
  /**
   * A cell's own point on its drawn medium, into out: its centre, or where the drawn coast puts
   * the centre on the other side, the nearest point of the cell that it does not (rings outward);
   * the centre if there is none. Once per cell.
   */
  const anchorPos = new Float32Array(N * 3)
  const anchorDone = new Uint8Array(N)
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), aq = new THREE.Vector3()
  const anchor = (a: number, out: THREE.Vector3) => {
    if (!anchorDone[a]) {
      anchorDone[a] = 1
      out.set(P[a * 3], P[a * 3 + 1], P[a * 3 + 2])
      const sea = water(a)
      if (coastal[a] && drawnLand(out.x, out.y, out.z, a) === sea) {
        e1.set(-out.y, out.x, 0)
        if (e1.lengthSq() < 1e-6) e1.set(0, -out.z, out.y)
        e1.normalize()
        e2.crossVectors(out, e1)
        search: for (let k = 1; k <= 5; k++) {
          for (let j = 0; j < 12; j++) {
            const ang = (j + (k & 1) * 0.5) * (Math.PI / 6), rr = k * 0.08 * spacing
            aq.copy(out).addScaledVector(e1, Math.cos(ang) * rr).addScaledVector(e2, Math.sin(ang) * rr).normalize()
            if (nearestCell(aq.x, aq.y, aq.z, a) === a && drawnLand(aq.x, aq.y, aq.z, a) !== sea) {
              out.copy(aq)
              break search
            }
          }
        }
      }
      anchorPos[a * 3] = out.x
      anchorPos[a * 3 + 1] = out.y
      anchorPos[a * 3 + 2] = out.z
    }
    return out.set(anchorPos[a * 3], anchorPos[a * 3 + 1], anchorPos[a * 3 + 2])
  }
  // river courses: the main inflow of each river cell, and the side of its banks (cross of up and the flow)
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
  /** x is the next or previous cell along c's river. */
  const along = (c: number, x: number) => (riverTo[x] === c && isRiver(x)) || riverTo[c] === x
  const t3 = new THREE.Vector3(), u3 = new THREE.Vector3(), s3 = new THREE.Vector3()
  /** The default bank side of the river through c (unit, tangent), into s3; false where it has none. */
  const riverSide = (c: number) => {
    const up = upOf(c), down = riverTo[c]
    u3.set(P[c * 3], P[c * 3 + 1], P[c * 3 + 2])
    const ux = up >= 0 ? up : c
    t3.set(P[down * 3] - P[ux * 3], P[down * 3 + 1] - P[ux * 3 + 1], P[down * 3 + 2] - P[ux * 3 + 2])
    t3.addScaledVector(u3, -t3.dot(u3))
    if (t3.lengthSq() < 1e-12) return false
    s3.crossVectors(u3, t3).normalize()
    return true
  }
  /** `out` moved from unit vector `at` by `off` along ±s3 (the given side first), onto land; false if neither side is. */
  const toBank = (at: THREE.Vector3, side: number, off: number, start: number, out: THREE.Vector3) => {
    for (const b of [side, -side]) {
      out.copy(at).addScaledVector(s3, b * off).normalize()
      if (!water(nearestCell(out.x, out.y, out.z, start))) return true
    }
    return false
  }

  // ---------- meeting points: fixed by the link alone ----------
  // the midpoint of the two cell centres (between sea cells by a coast, moved along their boundary
  // off the drawn land); on a link between land and sea just past the drawn shoreline on the line
  // between them, at the water's surface; on a link along a river, beside it on the default bank
  const meetDir = new Float32Array(L * 3)
  const meetTan = new Float32Array(L * 3) // unit, toward linkB
  const meetRadius = new Float32Array(L)
  {
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), m = new THREE.Vector3(), tn = new THREE.Vector3(), q = new THREE.Vector3()
    for (let l = 0; l < L; l++) {
      const A = linkA[l], B = linkB[l]
      pa.set(P[A * 3], P[A * 3 + 1], P[A * 3 + 2])
      pb.set(P[B * 3], P[B * 3 + 1], P[B * 3 + 2])
      const wa = water(A), wb = water(B)
      m.copy(pa).add(pb).normalize()
      let r = (surfaceRadius(world, A) + surfaceRadius(world, B)) / 2
      if (wa !== wb) {
        // along the line between the two cells' points on their drawn medium (see anchor; the
        // nodes of a coast transition), from the sea's toward the land's: the last drawn water
        // before the shore, a little past it (a ship's length), so the ship leaves from the
        // drawn waterline (wherever the drawn coast puts it, also short of the cells' boundary)
        const land = wa ? B : A, sea = wa ? A : B
        const pl = anchor(land, new THREE.Vector3()), ps = anchor(sea, new THREE.Vector3())
        let tShore = 0
        for (let s = 64; s >= 0; s--) {
          const t = s / 64
          q.copy(pl).lerp(ps, t).normalize()
          if (drawnLand(q.x, q.y, q.z, t > 0.5 ? sea : land)) {
            tShore = t
            break
          }
        }
        // (halfway to the sea's point where the shore lies close to it)
        const t = tShore + SHIP_ROOM <= 0.97 ? tShore + SHIP_ROOM : Math.min(0.985, (tShore + 1) / 2)
        m.copy(pl).lerp(ps, t).normalize()
        r = surfaceRadius(world, sea)
        // the direction: along that line
        if (wa) pa.copy(ps), pb.copy(pl)
        else pa.copy(pl), pb.copy(ps)
      } else if (wa) {
        // between sea cells by a coast: off the drawn land, along the cells' boundary
        if (coastal[A] || coastal[B]) {
          if (!seaOk(m.x, m.y, m.z, A)) {
            tn.copy(pb).sub(pa)
            s3.crossVectors(m, tn).normalize()
            let found = false
            for (let k = 1; k <= 6 && !found; k++) {
              for (const sg of [1, -1]) {
                q.copy(m).addScaledVector(s3, sg * k * 0.06 * spacing).normalize()
                const c = nearestCell(q.x, q.y, q.z, A)
                if ((c === A || c === B) && !drawnLand(q.x, q.y, q.z, c)) {
                  m.copy(q)
                  found = true
                  break
                }
              }
            }
          }
        }
      } else if (isRiver(A) && isRiver(B) && (riverTo[A] === B || riverTo[B] === A)) {
        const up = riverTo[A] === B ? A : B, down = up === A ? B : A
        tn.set(P[down * 3] - P[up * 3], P[down * 3 + 1] - P[up * 3 + 1], P[down * 3 + 2] - P[up * 3 + 2])
        s3.crossVectors(m, tn).normalize()
        const off = riverHalfWidth(Math.max(flow[A], flow[B])) + BANK_CLEARANCE
        if (toBank(m, 1, off, A, q)) m.copy(q)
      }
      meetDir[l * 3] = m.x
      meetDir[l * 3 + 1] = m.y
      meetDir[l * 3 + 2] = m.z
      tn.copy(pb).sub(pa)
      tn.addScaledVector(m, -tn.dot(m)).normalize()
      meetTan[l * 3] = tn.x
      meetTan[l * 3 + 1] = tn.y
      meetTan[l * 3 + 2] = tn.z
      meetRadius[l] = r
    }
  }
  const linkOf = (c: number, d: number) => linkIndex.get(Math.min(c, d) * N + Math.max(c, d)) ?? -1

  // ---------- node points and meeting points of a window ----------
  const v1 = new THREE.Vector3()
  /**
   * The node point of cell a on a route through p, a, b (-1: none), into out: on a river, its
   * bank (the default side, unless both neighbours lie off the river on one side); else, with
   * p, a, b all land or all sea, (p + 2a + b) / 4 if that stays in a's cell (and, by a coast, on
   * its side of the drawn shore); else a's centre (coast transitions, route ends; by a coast, the
   * nearest point of the cell on its side of the drawn shore, see anchor).
   */
  const nodePoint1 = (p: number, a: number, b: number, out: THREE.Vector3) => {
    out.set(P[a * 3], P[a * 3 + 1], P[a * 3 + 2])
    const w = water(a)
    if (!w && isRiver(a)) {
      if (!riverSide(a)) return out
      let side = 0, mixed = false, n = 0
      for (const x of [p, b]) {
        if (x < 0) continue
        n++
        if (along(a, x)) {
          mixed = true
          continue
        }
        const sg = Math.sign((P[x * 3] - out.x) * s3.x + (P[x * 3 + 1] - out.y) * s3.y + (P[x * 3 + 2] - out.z) * s3.z)
        if (side === 0) side = sg
        else if (sg !== side) mixed = true
      }
      const bank = !mixed && n > 0 && side !== 0 ? side : 1
      u3.copy(out)
      if (toBank(u3, bank, riverHalfWidth(flow[a]) + BANK_CLEARANCE, a, v1)) out.copy(v1)
      return out
    }
    if (p < 0 || b < 0 || water(p) !== w || water(b) !== w) return anchor(a, out)
    v1.set(P[p * 3] + 2 * P[a * 3] + P[b * 3], P[p * 3 + 1] + 2 * P[a * 3 + 1] + P[b * 3 + 1], P[p * 3 + 2] + 2 * P[a * 3 + 2] + P[b * 3 + 2]).normalize()
    if (nearestCell(v1.x, v1.y, v1.z, a) !== a) return anchor(a, out)
    if (coastal[a] && drawnLand(v1.x, v1.y, v1.z, a) === w) return anchor(a, out)
    return out.copy(v1)
  }
  /** (x, y, z) lies on the medium of cell a: a cell of it and, by a coast, its side of the drawn shore. */
  const onMedium = (x: number, y: number, z: number, a: number) => {
    if (water(a)) return seaOk(x, y, z, a)
    const c = nearestCell(x, y, z, a)
    return !water(c) && !(coastal[c] && !drawnLand(x, y, z, c))
  }
  /** The cells (-1: none) are all there and all land or all sea. */
  const sameMedium = (cs: readonly number[]) => {
    const w = water(cs[0])
    for (const c of cs) if (c < 0 || water(c) !== w) return false
    return true
  }
  /** Window 2: a node among four neighbours of its medium at (p2 + 4 p1 + 6 a + 4 b + b2) / 16, if that lies on it; else as nodePoint1. */
  const nodePoint2 = (p2: number, p1: number, a: number, b: number, b2: number, out: THREE.Vector3) => {
    const cs = [a, p2, p1, b, b2]
    if (sameMedium(cs)) {
      out.set(0, 0, 0)
      const wts = [6, 1, 4, 4, 1]
      for (let i = 0; i < 5; i++) out.x += wts[i] * P[cs[i] * 3], out.y += wts[i] * P[cs[i] * 3 + 1], out.z += wts[i] * P[cs[i] * 3 + 2]
      out.normalize()
      if (onMedium(out.x, out.y, out.z, a)) return out
    }
    return nodePoint1(p1, a, b, out)
  }
  /**
   * The meeting point on link a-b of a route through p1, a, b, b2 (direction, unit tangent toward b,
   * radius): the link's own (window 1, or where the four are not all land or all sea); window 2,
   * (p1 + 3a + 3b + b2) / 8 if that lies on their medium.
   */
  const meet = (p1: number, a: number, b: number, b2: number, dir: THREE.Vector3, tan: THREE.Vector3) => {
    const l = linkOf(a, b)
    const sg = a === linkA[l] ? 1 : -1
    if (wide && sameMedium([a, p1, b, b2])) {
      dir.set(
        P[p1 * 3] + 3 * P[a * 3] + 3 * P[b * 3] + P[b2 * 3],
        P[p1 * 3 + 1] + 3 * P[a * 3 + 1] + 3 * P[b * 3 + 1] + P[b2 * 3 + 1],
        P[p1 * 3 + 2] + 3 * P[a * 3 + 2] + 3 * P[b * 3 + 2] + P[b2 * 3 + 2],
      ).normalize()
      if (onMedium(dir.x, dir.y, dir.z, a)) {
        tan.set(P[b * 3] + P[b2 * 3] - P[p1 * 3] - P[a * 3], P[b * 3 + 1] + P[b2 * 3 + 1] - P[p1 * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] + P[b2 * 3 + 2] - P[p1 * 3 + 2] - P[a * 3 + 2])
        tan.addScaledVector(dir, -tan.dot(dir)).normalize()
        return meetRadius[l]
      }
    }
    dir.set(meetDir[l * 3], meetDir[l * 3 + 1], meetDir[l * 3 + 2])
    tan.set(meetTan[l * 3] * sg, meetTan[l * 3 + 1] * sg, meetTan[l * 3 + 2] * sg)
    return meetRadius[l]
  }

  // ---------- pieces ----------
  const S = PIECE_SAMPLES
  const pieceIndex = new Map<number, number>()
  const pLink: number[] = [], pEnd: number[] = [], pSea: number[] = [], pOpen: number[] = []
  let pDir = new Float32Array(1024 * S * 3), pRad = new Float32Array(1024 * S), pSide = new Float32Array(1024 * S * 3), pArc = new Float32Array(1024 * S)
  const grow = () => {
    const cap = pDir.length / (S * 3) * 2
    const g = (x: Float32Array, k: number) => {
      const y = new Float32Array(cap * S * k)
      y.set(x)
      return y
    }
    pDir = g(pDir, 3)
    pRad = g(pRad, 1)
    pSide = g(pSide, 3)
    pArc = g(pArc, 1)
  }
  const X = new THREE.Vector3(), T = new THREE.Vector3(), M = new THREE.Vector3(), D = new THREE.Vector3()
  const m0 = new THREE.Vector3(), d0 = new THREE.Vector3()
  const b1 = new THREE.Vector3(), b2v = new THREE.Vector3(), q = new THREE.Vector3(), prev = new THREE.Vector3(), tan = new THREE.Vector3()
  const CHECK = 12
  /** Point (into q) and derivative (into tan) of the cubic X, b1, b2v, M at t. */
  const cubic = (t: number) => {
    const u = 1 - t
    q.set(0, 0, 0).addScaledVector(X, u * u * u).addScaledVector(b1, 3 * u * u * t).addScaledVector(b2v, 3 * u * t * t).addScaledVector(M, t * t * t)
    tan.set(0, 0, 0)
      .addScaledVector(X, -3 * u * u)
      .addScaledVector(b1, 3 * u * u - 6 * u * t)
      .addScaledVector(b2v, 6 * u * t - 3 * t * t)
      .addScaledVector(M, 3 * t * t)
    return q.normalize()
  }
  /** The piece at cell a toward b, for a route with p2, p1 before a and b2 after b (-1: none). */
  const makePiece = (l: number, e: number, p2: number, p1: number, a: number, b: number, b2: number) => {
    const id = pLink.length
    if ((id + 1) * S * 3 > pDir.length) grow()
    const sea = water(a)
    if (wide) nodePoint2(p2, p1, a, b, b2, X)
    else nodePoint1(p1, a, b, X)
    const rM = meet(p1, a, b, b2, M, D)
    // the tangent at the node: along the line from the previous meeting point to the next
    if (p1 >= 0) {
      if (wide) {
        meet(b, a, p1, p2, m0, d0)
        T.copy(M).sub(m0)
      } else T.set(P[b * 3] - P[p1 * 3], P[b * 3 + 1] - P[p1 * 3 + 1], P[b * 3 + 2] - P[p1 * 3 + 2])
    } else T.copy(M).sub(X)
    T.addScaledVector(X, -T.dot(X))
    if (T.lengthSq() < 1e-16) T.copy(M).sub(X)
    T.normalize()
    const h = X.distanceTo(M) * 0.42
    b1.copy(X).addScaledVector(T, h)
    b2v.copy(M).addScaledVector(D, -h)
    // checked against its medium: a sea piece over water (and the drawn sea by a coast), a land piece
    // over land (or, toward a shore, the link's own two cells); else the straight chord
    const mixed = water(b) !== sea
    /** How the current curve fits: 0 on its medium, 1 over the other side of the drawn shore, 2 over a cell of the other medium. */
    const misfit = () => {
      let worst = 0
      for (let s = 1; s < CHECK && worst < 2; s++) {
        cubic(s / CHECK)
        const c = nearestCell(q.x, q.y, q.z, a)
        if (sea) {
          // (toward the shore it may run on into the land cell, over the drawn sea up to the waterline)
          if (!water(c) && !(mixed && c === b)) worst = 2
          else if ((coastal[c] || !water(c)) && drawnLand(q.x, q.y, q.z, c)) worst = Math.max(worst, !water(c) ? 2 : 1)
        } else if (mixed) {
          // toward the shore: the link's own cells (the end lies past the waterline)
          if (c !== a && c !== b && water(c)) worst = 2
        } else if (water(c)) worst = 2
        else if (coastal[c] && !drawnLand(q.x, q.y, q.z, c)) worst = Math.max(worst, 1)
      }
      return worst
    }
    const bad = misfit()
    if (bad > 0) {
      const k1x = b1.x, k1y = b1.y, k1z = b1.z, k2x = b2v.x, k2y = b2v.y, k2z = b2v.z
      b1.copy(X).lerp(M, 1 / 3)
      b2v.copy(X).lerp(M, 2 / 3)
      // the straight chord, unless it fits no better
      if (misfit() >= bad) {
        b1.set(k1x, k1y, k1z)
        b2v.set(k2x, k2y, k2z)
      }
    }
    const rn = surfaceRadius(world, a)
    let arc = 0
    for (let s = 0; s < S; s++) {
      const t = s / (S - 1)
      cubic(t)
      if (s > 0) arc += q.distanceTo(prev)
      prev.copy(q)
      const i = id * S + s
      pDir[i * 3] = q.x
      pDir[i * 3 + 1] = q.y
      pDir[i * 3 + 2] = q.z
      pRad[i] = rn + (rM - rn) * t
      pArc[i] = arc
      tan.crossVectors(q, tan).normalize()
      pSide[i * 3] = tan.x
      pSide[i * 3 + 1] = tan.y
      pSide[i * 3 + 2] = tan.z
    }
    pLink.push(l)
    pEnd.push(e)
    pSea.push(sea ? 1 : 0)
    pOpen.push(p1 < 0 ? 1 : 0)
    return id
  }
  /** The piece at cell a toward b (link l) for this window, made on first use. */
  const pieceFor = (l: number, p2: number, p1: number, a: number, b: number, b2: number) => {
    // the window as the geometry reads it: neighbours only, no doubling back
    if (p1 >= 0 && (p1 === b || nbSlot(a, p1) === NONE)) p1 = -1
    if (p1 < 0 || !wide || p2 === a || nbSlot(p1, p2) === NONE) p2 = -1
    if (!wide || b2 === a || nbSlot(b, b2) === NONE) b2 = -1
    const e = a === linkA[l] ? 0 : 1
    const key = (((l * 2 + e) * 8 + (p1 < 0 ? NONE : nbSlot(a, p1))) * 8 + (p2 < 0 ? NONE : nbSlot(p1, p2))) * 8 + (b2 < 0 ? NONE : nbSlot(b, b2))
    let id = pieceIndex.get(key)
    if (id === undefined) {
      id = makePiece(l, e, p2, p1, a, b, b2)
      pieceIndex.set(key, id)
    }
    return id
  }
  const routePieceFrom = new Int32Array(routeLinks.length)
  const routePieceTo = new Int32Array(routeLinks.length)
  for (let r = 0; r < count; r++) {
    const k0 = routeLinkOffsets[r], k1 = routeLinkOffsets[r + 1]
    const s0 = seqStart[r], n = k1 - k0 + 1 // cells c_0 .. c_{n-1}
    const cell = (i: number) => (i >= 0 && i < n ? cellsOf[s0 + i] : -1)
    for (let k = k0; k < k1; k++) {
      const i = k - k0, l = routeLinks[k]
      const a = cell(i), b = cell(i + 1)
      routePieceFrom[k] = pieceFor(l, cell(i - 2), cell(i - 1), a, b, cell(i + 2))
      routePieceTo[k] = pieceFor(l, cell(i + 3), cell(i + 2), b, a, cell(i - 1))
    }
  }
  const pieceCount = pLink.length
  const pieceLink = Int32Array.from(pLink)
  const pieceEnd = Uint8Array.from(pEnd)
  const pieceNode = new Int32Array(pieceCount)
  for (let i = 0; i < pieceCount; i++) pieceNode[i] = pieceEnd[i] ? linkNodeB[pieceLink[i]] : linkNodeA[pieceLink[i]]
  const linkPieceOffsets = new Uint32Array(L + 1)
  for (let i = 0; i < pieceCount; i++) linkPieceOffsets[pieceLink[i] + 1]++
  for (let l = 0; l < L; l++) linkPieceOffsets[l + 1] += linkPieceOffsets[l]
  const linkPieces = new Int32Array(pieceCount)
  {
    const cur = linkPieceOffsets.slice(0, L)
    for (let i = 0; i < pieceCount; i++) linkPieces[cur[pieceLink[i]]++] = i
  }

  return {
    world,
    window,
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
    pieceCount,
    pieceLink,
    pieceEnd,
    pieceNode,
    pieceSea: Uint8Array.from(pSea),
    pieceOpen: Uint8Array.from(pOpen),
    pieceDir: pDir.slice(0, pieceCount * S * 3),
    pieceRadius: pRad.slice(0, pieceCount * S),
    pieceSide: pSide.slice(0, pieceCount * S * 3),
    pieceArc: pArc.slice(0, pieceCount * S),
    linkPieceOffsets,
    linkPieces,
    routeLinkOffsets,
    routeLinks,
    routeForward,
    routePieceFrom,
    routePieceTo,
  }
}

/** Every sample of a piece. */
const ALL_SAMPLES: readonly number[] = Array.from({ length: PIECE_SAMPLES }, (_, i) => i)

/**
 * PathSamples of every route along the network (`lift` above the ground), plus the link of every
 * sample. `keep`: which samples of each piece to use (the first and the last among them), the
 * same for every piece, so routes sharing a piece share its samples.
 */
export function networkRouteSamples(net: RouteNetwork, count: number, lift: number, keep: readonly number[] = ALL_SAMPLES): PathSamples & { link: Int32Array } {
  const S = PIECE_SAMPLES
  const K = keep.length
  let cap = 0
  for (let r = 0; r < count; r++) {
    const n = net.routeLinkOffsets[r + 1] - net.routeLinkOffsets[r]
    if (n > 0) cap += n * 2 * (K - 1) + 1
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
  const put = (piece: number, s: number, w: number, l: number) => {
    const i = piece * S + s
    const r = net.pieceRadius[i] + lift
    pos[ns * 3] = net.pieceDir[i * 3] * r
    pos[ns * 3 + 1] = net.pieceDir[i * 3 + 1] * r
    pos[ns * 3 + 2] = net.pieceDir[i * 3 + 2] * r
    side[ns * 3] = net.pieceSide[i * 3]
    side[ns * 3 + 1] = net.pieceSide[i * 3 + 1]
    side[ns * 3 + 2] = net.pieceSide[i * 3 + 2]
    water[ns] = w
    link[ns] = l
    ns++
  }
  for (let r = 0; r < count; r++) {
    offsets[r] = ns
    const k0 = net.routeLinkOffsets[r], k1 = net.routeLinkOffsets[r + 1]
    if (k1 <= k0) continue
    for (let k = k0; k < k1; k++) {
      const l = net.routeLinks[k]
      const pf = net.routePieceFrom[k], pt = net.routePieceTo[k]
      const wf = net.pieceSea[pf], wt = net.pieceSea[pt]
      // from the node out to the meeting point (the waterline where land meets sea), then in along the other piece
      for (let j = k === k0 ? 0 : 1; j < K; j++) put(pf, keep[j], j === K - 1 ? (wf === wt ? wf : SHORE) : wf, l)
      for (let j = K - 2; j >= 0; j--) put(pt, keep[j], wt, l)
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
