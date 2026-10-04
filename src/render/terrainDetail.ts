// Close-zoom detail geometry: the land triangles near the camera, each tessellated into
// a regular grid of n x n sub-triangles (n a power of two, ~TARGET / distance), displaced
// by the shared ground function (terrainHeight.ts) with the octaves that level resolves.
// Where two tiles of different levels meet, the finer one's edge vertices collapse onto
// the coarser one's (the index list skips what degenerates), and near its edges and
// corners a tile carries only the octaves of the coarser level there, so tiles agree on
// every vertex they share and the surface is closed. Level 1 carries none: the patch
// meets the base mesh exactly at its edge and the detail grows in toward the camera.
//
// A tile depends only on its triangle, its level and its edges' and corners' levels, so
// tiles are cached and a plan rebuilds only the tiles whose levels changed. A plan is
// made when the camera has moved by a fraction of its altitude (or turned), the missing
// tiles are built a few milliseconds per frame (nearest first), and the globe (globe.ts)
// commits the result in one go into the same geometry and draw call as the base mesh,
// hiding the base triangles it replaces.

import type { World } from '../contract.ts'
import { DETAIL_OCTAVES, evalGround, newGroundSample, RELIEF_NEAR, type TerrainField } from './terrainHeight.ts'

/** Sub-triangle edge in pixels-ish: level n ~ TARGET / distance (planet radii). */
const TARGET = 1.5
/** Finest level. */
const MAX_LEVEL = 32
/** Distance from the camera beyond which there is no detail geometry. */
export const DETAIL_RANGE = 0.9
/** Octaves the geometry can carry at most (the finest is per pixel only). */
const MESH_OCTAVES = DETAIL_OCTAVES - 1

/** Per-cell data the tiles copy from the globe (interpolated over each tile). */
export interface CellAttrs {
  seaIce: Float32Array
  depth: Float32Array
  seed: Uint8Array
}

/** A built patch: vertex attributes as the globe geometry lays them out, and indices. */
export interface PatchData {
  vertexCount: number
  indexCount: number
  position: Float32Array
  grad: Float32Array
  bary: Float32Array
  surf: Float32Array
  terr: Float32Array
  depth: Float32Array
  corners: Float32Array
  seed: Uint8Array
  /** Base triangle of each vertex (corner colours). */
  tri: Uint32Array
  index: Uint32Array
  /** 1 for each base triangle the patch replaces. */
  hidden: Uint8Array
  /** Tiles and their levels (perf=1). */
  tiles: number
  maxLevel: number
}

export interface DetailPatch {
  /** Per drawn frame: camera in object space, view direction, half diagonal field of view (rad). Returns true if a new plan was made. */
  update(camX: number, camY: number, camZ: number, dirX: number, dirY: number, dirZ: number, halfFov: number): boolean
  /** Builds until `deadline` (performance.now()); true when a finished patch waits in `result`. */
  step(deadline: number): boolean
  /** Work planned or in progress. */
  readonly pending: boolean
  readonly result: PatchData
  /** Plan again at the next update (the ground changed). */
  invalidate(): void
  /** Last build's wall time and vertex count (perf=1). */
  readonly stats: { ms: number; vertices: number; tiles: number; maxLevel: number; builds: number }
}

/** `a` with room for exactly `n` (when it grows; contents kept). */
function grow<T extends Float32Array | Uint32Array | Uint8Array>(a: T, n: number): T {
  if (a.length >= n) return a
  const b = new (a.constructor as { new (n: number): T })(n)
  b.set(a)
  return b
}

export function createDetailPatch(world: World, field: TerrainField, cells: CellAttrs): DetailPatch {
  const { positions: P, triangles, cellCount: N } = world.grid
  const T = triangles.length / 3
  // ---- static topology ----
  const centroid = new Float32Array(T * 3)
  const land = new Uint8Array(T)
  const relief = new Float32Array(T)
  const coastal = new Uint8Array(T)
  for (let t = 0; t < T; t++) {
    const a = triangles[t * 3], b = triangles[t * 3 + 1], c = triangles[t * 3 + 2]
    let x = P[a * 3] + P[b * 3] + P[c * 3], y = P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1], z = P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]
    const l = Math.hypot(x, y, z) || 1
    centroid[t * 3] = x / l; centroid[t * 3 + 1] = y / l; centroid[t * 3 + 2] = z / l
    const e = field.eS
    land[t] = e[a] >= 0 || e[b] >= 0 || e[c] >= 0 ? 1 : 0
    relief[t] = Math.max(field.amp[a], field.amp[b], field.amp[c])
    const near0 = (i: number) => Math.abs(e[i]) < 0.12
    coastal[t] = land[t] && (e[a] < 0 || e[b] < 0 || e[c] < 0 || near0(a) || near0(b) || near0(c)) ? 1 : 0
  }
  // neighbour across each edge k (corners k, k+1)
  const across = new Int32Array(T * 3).fill(-1)
  {
    const edges = new Map<number, number>()
    for (let t = 0; t < T; t++) {
      for (let k = 0; k < 3; k++) {
        const a = triangles[t * 3 + k], b = triangles[t * 3 + ((k + 1) % 3)]
        const key = a < b ? a * N + b : b * N + a
        const o = edges.get(key)
        if (o === undefined) edges.set(key, t * 3 + k)
        else {
          across[t * 3 + k] = Math.floor(o / 3)
          across[o] = t
        }
      }
    }
  }
  // triangles around each cell
  const fanOff = new Uint32Array(N + 1)
  for (let v = 0; v < triangles.length; v++) fanOff[triangles[v] + 1]++
  for (let i = 0; i < N; i++) fanOff[i + 1] += fanOff[i]
  const fanTri = new Uint32Array(triangles.length)
  {
    const fill = fanOff.slice(0, N)
    for (let v = 0; v < triangles.length; v++) fanTri[fill[triangles[v]]++] = Math.floor(v / 3)
  }
  const triRadius = 1.2 * Math.sqrt((4 * Math.PI) / N) // centroid to farthest corner, generously
  const edgeLen = 1.07 * Math.sqrt((4 * Math.PI) / N)
  const lambda0 = 1 / field.detailFreq
  /** Octaves a tessellation of level n carries (continuous in log n; none at level 1). */
  const bandOf = (n: number) => (n <= 1 ? 0 : Math.max(0, Math.min(MESH_OCTAVES, 1 + Math.log((lambda0 * n) / (3 * edgeLen)) / Math.log(2.03))))
  const BMAX = bandOf(MAX_LEVEL)

  // ---- plan ----
  const level = new Uint8Array(T) // log2 level + 1 (0: not in the patch)
  /** Per cell: the coarsest level of the triangles around it (1 if any is not tessellated). */
  const cornerLevel = new Uint8Array(N)
  let planned: number[] = []
  let planCam = [0, 0, 0]
  let planDir = [0, 0, 1]
  let planned0 = false
  let dirty = true
  /** Tiles of the plan still to build (not in the cache). */
  let work: number[] = []
  let next = 0
  let ready = false
  let t0 = 0
  let builds = 0
  let generation = 0

  // ---- tile cache: one tile per (triangle, level, edge levels, corner levels) ----
  interface Tile {
    key: number
    nv: number
    ni: number
    position: Float32Array
    grad: Float32Array
    bary: Float32Array
    surf: Float32Array
    terr: Float32Array
    depth: Float32Array
    seed: Uint8Array
    index: Uint32Array
    used: number
  }
  const cache = new Map<number, Tile>()
  let cachedVerts = 0
  /** Most cached vertices kept between plans. */
  const CACHE_VERTS = 600_000
  const keyOf = (t: number) => {
    const l = (x: number) => Math.max(0, Math.round(Math.log2(Math.max(1, x))))
    const n = 1 << (level[t] - 1)
    let k = l(n)
    for (let e = 0; e < 3; e++) k = k * 8 + l(edgeLevel(t, e, n))
    for (let c = 0; c < 3; c++) k = k * 8 + l(cornerLevel[triangles[t * 3 + c]])
    return t * 2097152 + k // 7 levels x 3 bits
  }
  const edgeLevel = (t: number, e: number, n: number) => {
    const o = across[t * 3 + e]
    return o >= 0 && level[o] ? Math.min(n, 1 << (level[o] - 1)) : 1
  }

  const result: PatchData = {
    vertexCount: 0, indexCount: 0,
    position: new Float32Array(0), grad: new Float32Array(0), bary: new Float32Array(0), surf: new Float32Array(0), terr: new Float32Array(0),
    depth: new Float32Array(0), corners: new Float32Array(0), seed: new Uint8Array(0), tri: new Uint32Array(0), index: new Uint32Array(0),
    hidden: new Uint8Array(T), tiles: 0, maxLevel: 0,
  }
  const stats = { ms: 0, vertices: 0, tiles: 0, maxLevel: 0, builds: 0 }
  const s = newGroundSample()
  let localMap = new Int32Array(0)

  function plan(cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, halfFov: number) {
    planCam = [cx, cy, cz]
    planDir = [dx, dy, dz]
    planned0 = true
    level.fill(0)
    planned = []
    const camR = Math.hypot(cx, cy, cz)
    const alt = camR - 1
    if (alt < DETAIL_RANGE) {
      const ux = cx / camR, uy = cy / camR, uz = cz / camR
      // beyond the horizon (with room for tall ground just behind it)
      const horizon = Math.acos(Math.min(1, 1 / camR)) + 0.3
      const cosH = Math.cos(Math.min(Math.PI, horizon))
      const cosF = Math.cos(Math.min(Math.PI * 0.5, halfFov + 0.22))
      const dists: number[] = []
      for (let t = 0; t < T; t++) {
        if (!land[t]) continue
        const x = centroid[t * 3], y = centroid[t * 3 + 1], z = centroid[t * 3 + 2]
        if (x * ux + y * uy + z * uz < cosH) continue
        const vx = x - cx, vy = y - cy, vz = z - cz
        const dc = Math.hypot(vx, vy, vz)
        const d = Math.max(dc - triRadius * 0.6, 1e-3)
        if (d > DETAIL_RANGE) continue
        // in front of the camera (a generous cone), or close beneath it
        if (d > alt * 2 && (vx * dx + vy * dy + vz * dz) / dc < cosF) continue
        // fine tessellation only where there is relief to carry (small triangles cost fragment
        // work: every 2x2 pixel quad a triangle touches is shaded); plains need just enough
        // to follow the sphere, coasts the drawn shoreline
        // (relief only where its crests would stand a pixel or two high at that distance, and
        // plains and coasts only near the camera, where models stand on them)
        const visible = relief[t] > d * 0.17
        const cap = visible && relief[t] > 0.08 ? MAX_LEVEL : visible && relief[t] > 0.03 ? 16 : coastal[t] ? (d < 0.15 ? 8 : 1) : d < 0.12 ? 4 : 1
        const n = Math.min(cap, TARGET / d)
        // nearest power of two (in log)
        const lv = Math.min(cap, 1 << Math.max(0, Math.round(Math.log2(Math.max(1, n)))))
        if (lv < 2) continue
        level[t] = Math.log2(lv) + 1
        planned.push(t)
        dists.push(d)
      }
      const order = planned.map((_, i) => i).sort((a, b) => dists[a] - dists[b])
      planned = order.map((i) => planned[i])
    }
    // corner levels: the coarsest triangle around each corner (1: it meets the base mesh)
    for (const t of planned) {
      for (let k = 0; k < 3; k++) {
        const c = triangles[t * 3 + k]
        let m = MAX_LEVEL
        for (let q = fanOff[c]; q < fanOff[c + 1]; q++) {
          const o = fanTri[q]
          m = Math.min(m, level[o] ? 1 << (level[o] - 1) : 1)
        }
        cornerLevel[c] = m
      }
    }
    generation++
    work = []
    for (const t of planned) {
      const tile = cache.get(keyOf(t))
      if (tile) tile.used = generation
      else work.push(t)
    }
    next = 0
    ready = false
    dirty = false
    t0 = performance.now()
  }

  function buildTile(t: number): Tile {
    const n = 1 << (level[t] - 1)
    const ca = triangles[t * 3], cb = triangles[t * 3 + 1], cc = triangles[t * 3 + 2]
    // edge levels: edge 0 = (a, b) (j = 0), edge 1 = (b, c) (i + j = n), edge 2 = (c, a) (i = 0)
    const ne0 = edgeLevel(t, 0, n), ne1 = edgeLevel(t, 1, n), ne2 = edgeLevel(t, 2, n)
    // octaves: the tile's own, falling to its edges' and corners' near them, so tiles of
    // different levels agree on every vertex they share (see bandOf)
    const bT = bandOf(n), b0 = bandOf(ne0), b1 = bandOf(ne1), b2 = bandOf(ne2)
    const bA = bandOf(cornerLevel[ca]), bB = bandOf(cornerLevel[cb]), bC = bandOf(cornerLevel[cc])
    const nv = ((n + 1) * (n + 2)) / 2
    if (localMap.length < nv) localMap = new Int32Array(nv * 2)
    const vid = (i: number, j: number) => (i * (2 * n + 3 - i)) / 2 + j // row i has n + 1 - i vertices
    // collapsed edge vertices map onto the coarser edge's vertices (not evaluated)
    let count = 0
    for (let i = 0; i <= n; i++) {
      for (let j = 0; i + j <= n; j++) {
        const l = vid(i, j)
        let mi = i, mj = j
        if (j === 0 && ne0 < n) { const st0 = n / ne0; mi = Math.floor(i / st0) * st0 }
        else if (i === 0 && ne2 < n) { const st2 = n / ne2; mj = Math.floor(j / st2) * st2 }
        else if (i + j === n && ne1 < n) { const st1 = n / ne1; mi = Math.floor(i / st1) * st1; mj = n - mi }
        if (mi !== i || mj !== j) localMap[l] = -1 - vid(mi, mj)
        else { localMap[l] = 0; count++ }
      }
    }
    const tile: Tile = {
      key: keyOf(t), nv: count, ni: 0, used: generation,
      position: new Float32Array(count * 3), grad: new Float32Array(count * 3), bary: new Float32Array(count * 3),
      surf: new Float32Array(count * 4), terr: new Float32Array(count * 4), depth: new Float32Array(count), seed: new Uint8Array(count * 4),
      index: new Uint32Array(0),
    }
    const { seaIce, depth, seed } = cells
    const sa = seed[ca], sb = seed[cb], sc = seed[cc]
    const coastSlope = field.coastSlope
    const ramp = (b: number, d: number) => b + (BMAX - b) * smooth01(d / 0.35)
    let v = 0
    for (let i = 0; i <= n; i++) {
      for (let j = 0; i + j <= n; j++) {
        const l = vid(i, j)
        if (localMap[l] < 0) continue
        localMap[l] = v
        const lb = i / n, lc = j / n, la = 1 - lb - lc
        const band = Math.min(bT, ramp(b0, lc), ramp(b1, la), ramp(b2, lb), ramp(bA, 1 - la), ramp(bB, 1 - lb), ramp(bC, 1 - lc))
        evalGround(field, ca, cb, cc, la, lb, lc, band, s)
        const r = 1 + RELIEF_NEAR * s.h
        const v3 = v * 3, v4 = v * 4
        tile.position[v3] = s.ux * r; tile.position[v3 + 1] = s.uy * r; tile.position[v3 + 2] = s.uz * r
        tile.grad[v3] = s.gx; tile.grad[v3 + 1] = s.gy; tile.grad[v3 + 2] = s.gz
        tile.bary[v3] = la; tile.bary[v3 + 1] = lb; tile.bary[v3 + 2] = lc
        tile.surf[v4] = s.e
        tile.surf[v4 + 1] = s.snow
        tile.surf[v4 + 2] = la * seaIce[ca] + lb * seaIce[cb] + lc * seaIce[cc]
        tile.surf[v4 + 3] = s.d
        tile.terr[v4] = s.h
        tile.terr[v4 + 1] = s.aw
        tile.terr[v4 + 2] = band
        tile.terr[v4 + 3] = s.ridge
        tile.seed[v4] = sa; tile.seed[v4 + 1] = sb; tile.seed[v4 + 2] = sc
        tile.seed[v4 + 3] = Math.min(255, Math.round(((la * coastSlope[ca] + lb * coastSlope[cb] + lc * coastSlope[cc]) / 0.5) * 255))
        tile.depth[v] = la * depth[ca] + lb * depth[cb] + lc * depth[cc]
        v++
      }
    }
    for (let i = 0; i <= n; i++) for (let j = 0; i + j <= n; j++) {
      const l = vid(i, j)
      if (localMap[l] < 0) localMap[l] = localMap[-1 - localMap[l]]
    }
    // sub-triangles, CCW like the base triangle (a, b, c); collapsed ones skipped
    const idx = new Uint32Array(n * n * 3)
    let ii = 0
    for (let i = 0; i < n; i++) {
      for (let j = 0; i + j < n; j++) {
        const p0 = localMap[vid(i, j)], p1 = localMap[vid(i + 1, j)], p2 = localMap[vid(i, j + 1)]
        if (p0 !== p1 && p1 !== p2 && p0 !== p2) { idx[ii++] = p0; idx[ii++] = p1; idx[ii++] = p2 }
        if (i + j + 1 < n) {
          const q0 = localMap[vid(i + 1, j)], q1 = localMap[vid(i + 1, j + 1)], q2 = localMap[vid(i, j + 1)]
          if (q0 !== q1 && q1 !== q2 && q0 !== q2) { idx[ii++] = q0; idx[ii++] = q1; idx[ii++] = q2 }
        }
      }
    }
    tile.index = idx.slice(0, ii)
    tile.ni = ii
    return tile
  }

  /** Concatenates the plan's tiles into the result arrays. */
  function finish() {
    const r = result
    let nv = 0, ni = 0
    const tiles: Tile[] = []
    const tris: number[] = []
    for (const t of planned) {
      const tile = cache.get(keyOf(t))
      if (!tile) continue
      tiles.push(tile)
      tris.push(t)
      nv += tile.nv
      ni += tile.ni
    }
    r.position = grow(r.position, nv * 3); r.grad = grow(r.grad, nv * 3); r.bary = grow(r.bary, nv * 3); r.corners = grow(r.corners, nv * 3)
    r.surf = grow(r.surf, nv * 4); r.terr = grow(r.terr, nv * 4); r.seed = grow(r.seed, nv * 4)
    r.depth = grow(r.depth, nv); r.tri = grow(r.tri, nv); r.index = grow(r.index, ni)
    let v = 0, i = 0
    r.hidden.fill(0)
    let maxLevel = 0
    for (let k = 0; k < tiles.length; k++) {
      const tile = tiles[k]
      const t = tris[k]
      r.position.set(tile.position, v * 3); r.grad.set(tile.grad, v * 3); r.bary.set(tile.bary, v * 3)
      r.surf.set(tile.surf, v * 4); r.terr.set(tile.terr, v * 4); r.seed.set(tile.seed, v * 4); r.depth.set(tile.depth, v)
      const ca = triangles[t * 3], cb = triangles[t * 3 + 1], cc = triangles[t * 3 + 2]
      for (let q = 0; q < tile.nv; q++) {
        r.corners[(v + q) * 3] = ca; r.corners[(v + q) * 3 + 1] = cb; r.corners[(v + q) * 3 + 2] = cc
        r.tri[v + q] = t
      }
      for (let q = 0; q < tile.ni; q++) r.index[i + q] = tile.index[q] + v
      v += tile.nv
      i += tile.ni
      r.hidden[t] = 1
      maxLevel = Math.max(maxLevel, 1 << (level[t] - 1))
    }
    r.vertexCount = v
    r.indexCount = i
    r.tiles = tiles.length
    r.maxLevel = maxLevel
    // forget the least recently used tiles beyond the cache budget
    if (cachedVerts > CACHE_VERTS) {
      const old = [...cache.values()].filter((x) => x.used !== generation).sort((a, b) => a.used - b.used)
      for (const x of old) {
        if (cachedVerts <= CACHE_VERTS * 0.7) break
        cache.delete(x.key)
        cachedVerts -= x.nv
      }
    }
    builds++
    stats.ms = performance.now() - t0
    stats.vertices = v
    stats.tiles = tiles.length
    stats.maxLevel = maxLevel
    stats.builds = builds
  }

  return {
    update(cx, cy, cz, dx, dy, dz, halfFov) {
      const camR = Math.hypot(cx, cy, cz)
      const alt = Math.max(0.004, camR - 1)
      if (!dirty && planned0) {
        // keep the current plan while it is good enough; let a build in progress finish
        const moved = Math.hypot(cx - planCam[0], cy - planCam[1], cz - planCam[2])
        const turned = dx * planDir[0] + dy * planDir[1] + dz * planDir[2]
        if (moved <= 0.12 * alt && turned >= 0.97) return false
        if (next < work.length && moved < 0.6 * alt && turned > 0.85) return false
        // high above with nothing shown: nothing to plan
        if (alt >= DETAIL_RANGE && planned.length === 0 && result.vertexCount === 0) {
          planCam = [cx, cy, cz]
          return false
        }
      }
      plan(cx, cy, cz, dx, dy, dz, halfFov)
      if (work.length === 0) {
        finish()
        ready = true
      }
      return true
    },
    step(deadline) {
      if (ready) {
        ready = false
        return true
      }
      if (next >= work.length) return false
      while (next < work.length) {
        const tile = buildTile(work[next++])
        cache.set(tile.key, tile)
        cachedVerts += tile.nv
        if (performance.now() > deadline) break
      }
      if (next >= work.length) {
        finish()
        return true
      }
      return false
    },
    get pending() {
      return ready || next < work.length
    },
    result,
    invalidate() {
      dirty = true
      cache.clear()
      cachedVerts = 0
    },
    stats,
  }
}

function smooth01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t
  return c * c * (3 - 2 * c)
}
