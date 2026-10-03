// Geographic features found from the World alone (pure, deterministic, a few
// milliseconds at the default resolution): the things a map would name.
//
// - Landmasses: connected land (lakes count as land); large ones are
//   continents, the next largest islands.
// - Water: the world ocean is opened morphologically (erode by R cells, grow
//   back by R): what the opening removes is water narrower than ~2R between
//   coasts, i.e. bays, gulfs, straits and sounds; its large connected pieces are
//   seas. Open water whose eroded core is small (a wide sea behind a narrow
//   strait) is a sea too, as is any water body not connected to the world
//   ocean. The remaining open ocean is split into a few oceans grown from deep,
//   mutually distant basin seeds, with growth slowed over shallow water so
//   borders follow ridges and island chains.
// - Lakes: connected lake cells.
// - Rivers: main stems from mouth to source, always following the largest
//   tributary upstream; long tributaries of the largest rivers are their own features.
// - Mountain ranges: connected high ground (relative to the world's land
//   elevations); very large massifs are split, and each range gets a crest
//   line along its high cells between the two ends of its long axis.
// - Deserts and forests: large connected regions of one biome.
//
// Every feature has an anchor cell near its visual centre (the cell farthest
// from the region's border; for a river a cell on its lower course, for a range
// the middle of its crest), a size in cells and, for rivers and ranges, a spine.
// Distances are hop counts on the cell graph (cells are near-uniform), and all
// thresholds are scaled with resolution so features do not depend on it much.

import { Biome, FeatureKind, RIVER_FLOW_THRESHOLD } from '../../contract.ts'
import type { World } from '../../contract.ts'
import { MinHeap } from '../util.ts'

export interface DetectedFeature {
  kind: FeatureKind
  anchorCell: number
  size: number
  /** Ordered cells along a river (source to mouth: spine[i + 1] = riverTo[spine[i]]) or a range's crest; empty for blobs. */
  spine: number[]
  /** Stable identity (kind and a defining cell) for per-feature random streams. */
  key: string
}

/** Detected features and, per cell, which of them it belongs to (index into `features`, or -1). */
export interface FeatureMap {
  features: DetectedFeature[]
  /** Continent or island of a land cell. */
  land: Int32Array
  /** Ocean or sea of a water cell. */
  water: Int32Array
  lake: Int32Array
  /** Mountain range. */
  relief: Int32Array
  /** Desert or forest. */
  cover: Int32Array
  /** River features through each cell (a confluence carries two). */
  river: Int32Array
  river2: Int32Array
}

/** Cell count of the default (n = 48) grid, which the thresholds below are tuned for. */
const BASE_CELLS = 23042

const T = {
  /** A landmass is a continent from this many cells, or this fraction of all land. */
  continentCells: 250,
  continentFraction: 0.05,
  islandCells: 6,
  maxIslands: 8,
  /** Opening radius (cells) separating open ocean from bays, gulfs and straits. */
  openRadius: 4,
  /**
   * An eroded ocean core this large (and holding this fraction of the world ocean) is open
   * ocean; smaller cores are seas behind straits, however wide.
   */
  oceanCoreCells: 700,
  oceanCoreFraction: 0.15,
  /** An ocean basin with at least this share of its border on land, and under this share of the ocean, is a sea. */
  enclosedSea: 0.75,
  enclosedSeaFraction: 0.2,
  seaCells: 28,
  maxSeas: 15,
  /** Ocean cells per ocean (sets how many oceans), and bounds on their number. */
  cellsPerOcean: 3300,
  maxOceans: 6,
  lakeCells: 3,
  maxLakes: 12,
  riverCells: 5,
  maxRivers: 28,
  tributaryCells: 7,
  tributaryFlow: 22,
  maxTributaries: 12,
  /** High ground: land at or above this percentile of land elevation, clamped. */
  highPercentile: 0.88,
  highMin: 0.22,
  highMax: 0.4,
  rangeCells: 8,
  /** Ranges larger than splitCells are split into pieces of about pieceCells. */
  splitCells: 230,
  pieceCells: 140,
  maxRanges: 14,
  desertCells: 35,
  maxDeserts: 5,
  forestCells: 70,
  maxForests: 6,
}

interface Ctx {
  world: World
  N: number
  off: Uint32Array
  nb: Uint32Array
  P: Float32Array
  /** Area and length scale relative to the default grid. */
  area: number
  lin: number
  /** Scratch: per-cell distances and a queue, reset by their users. */
  dist: Int32Array
  queue: Int32Array
}

interface Components {
  /** Component id per cell (-1 outside the mask), ids in order of their lowest cell. */
  id: Int32Array
  members: number[][]
}

/** Connected components of the cells where mask is 1 (members in BFS order from the lowest cell). */
function components(ctx: Ctx, mask: Uint8Array): Components {
  const { N, off, nb, queue } = ctx
  const id = new Int32Array(N).fill(-1)
  const members: number[][] = []
  for (let s = 0; s < N; s++) {
    if (!mask[s] || id[s] >= 0) continue
    const c = members.length
    const list: number[] = []
    let head = 0, tail = 0
    queue[tail++] = s
    id[s] = c
    while (head < tail) {
      const x = queue[head++]
      list.push(x)
      for (let k = off[x]; k < off[x + 1]; k++) {
        const j = nb[k]
        if (mask[j] && id[j] < 0) { id[j] = c; queue[tail++] = j }
      }
    }
    members.push(list)
  }
  return { id, members }
}

/** Indices of `lists` ordered by size (largest first), ties by lowest first member. */
function bySize(lists: number[][]): number[] {
  const order = lists.map((_, i) => i)
  order.sort((a, b) => lists[b].length - lists[a].length || lists[a][0] - lists[b][0])
  return order
}

/**
 * The member farthest (in hops) from the region's border, ties broken toward the
 * region's mean direction, then the lowest cell: a label anchor near the visual centre.
 */
function poleAnchor(ctx: Ctx, members: readonly number[], region: Int32Array, rid: number): number {
  const { off, nb, dist, queue, P } = ctx
  let head = 0, tail = 0
  let cx = 0, cy = 0, cz = 0
  for (const c of members) {
    cx += P[c * 3]; cy += P[c * 3 + 1]; cz += P[c * 3 + 2]
    dist[c] = 0
    for (let k = off[c]; k < off[c + 1]; k++) {
      if (region[nb[k]] !== rid) { dist[c] = 1; queue[tail++] = c; break }
    }
  }
  if (tail === 0) { dist[members[0]] = 1; queue[tail++] = members[0] } // the region is the whole sphere
  while (head < tail) {
    const x = queue[head++]
    for (let k = off[x]; k < off[x + 1]; k++) {
      const j = nb[k]
      if (region[j] === rid && dist[j] === 0) { dist[j] = dist[x] + 1; queue[tail++] = j }
    }
  }
  let best = members[0], bestD = -1, bestDot = -Infinity
  for (const c of members) {
    const d = dist[c]
    const dot = cx * P[c * 3] + cy * P[c * 3 + 1] + cz * P[c * 3 + 2]
    if (d > bestD || (d === bestD && (dot > bestDot || (dot === bestDot && c < best)))) { best = c; bestD = d; bestDot = dot }
  }
  for (const c of members) dist[c] = 0
  return best
}

/** Hop distance from the cells where src is 1, through cells where pass is 1 (others stay -1). */
function hopDistance(ctx: Ctx, src: Uint8Array, pass: Uint8Array): Int32Array {
  const { N, off, nb, queue } = ctx
  const d = new Int32Array(N).fill(-1)
  let head = 0, tail = 0
  for (let i = 0; i < N; i++) if (src[i]) { d[i] = 0; queue[tail++] = i }
  while (head < tail) {
    const x = queue[head++]
    for (let k = off[x]; k < off[x + 1]; k++) {
      const j = nb[k]
      if (pass[j] && d[j] < 0) { d[j] = d[x] + 1; queue[tail++] = j }
    }
  }
  return d
}

/**
 * Splits `members` into `k` pieces grown (by hops, inside the member set) from
 * mutually distant seeds; the first seed is `first`, later seeds maximise
 * distance-to-seeds times weight(cell). Writes the piece index into `piece`
 * for every member and returns the seeds.
 */
function splitRegion(ctx: Ctx, members: readonly number[], inSet: Uint8Array, k: number, first: number, weight: (c: number) => number, piece: Int32Array): number[] {
  const { off, nb, queue, dist } = ctx
  const seeds: number[] = []
  for (const c of members) { dist[c] = 0x7fffffff; piece[c] = -1 }
  // each new seed claims the cells it is strictly closer to (incremental multi-source BFS)
  const claim = (s: number): void => {
    const i = seeds.length
    seeds.push(s)
    let head = 0, tail = 0
    dist[s] = 0
    piece[s] = i
    queue[tail++] = s
    while (head < tail) {
      const x = queue[head++]
      const d = dist[x] + 1
      for (let q = off[x]; q < off[x + 1]; q++) {
        const j = nb[q]
        if (inSet[j] && d < dist[j]) { dist[j] = d; piece[j] = i; queue[tail++] = j }
      }
    }
  }
  claim(first)
  while (seeds.length < k) {
    let best = -1, bestScore = -1
    for (const c of members) {
      const d = dist[c]
      if (d <= 0 || d === 0x7fffffff) continue
      const s = d * weight(c)
      if (s > bestScore) { best = c; bestScore = s }
    }
    if (best < 0) break
    claim(best)
  }
  for (const c of members) dist[c] = 0
  return seeds
}

export function detectFeatures(world: World): FeatureMap {
  const N = world.grid.cellCount
  const area = N / BASE_CELLS
  const ctx: Ctx = {
    world, N, off: world.grid.neighborOffsets, nb: world.grid.neighbors, P: world.grid.positions,
    area, lin: Math.sqrt(area), dist: new Int32Array(N), queue: new Int32Array(N),
  }
  const elev = world.elevation
  const cells = (x: number) => Math.max(1, Math.round(x * area))
  const hops = (x: number) => Math.max(1, Math.round(x * ctx.lin))

  const features: DetectedFeature[] = []
  const map: FeatureMap = {
    features,
    land: new Int32Array(N).fill(-1),
    water: new Int32Array(N).fill(-1),
    lake: new Int32Array(N).fill(-1),
    relief: new Int32Array(N).fill(-1),
    cover: new Int32Array(N).fill(-1),
    river: new Int32Array(N).fill(-1),
    river2: new Int32Array(N).fill(-1),
  }
  const addBlob = (kind: FeatureKind, members: readonly number[], perCell: Int32Array, region: Int32Array, rid: number): void => {
    const f = features.length
    const anchorCell = poleAnchor(ctx, members, region, rid)
    for (const c of members) perCell[c] = f
    features.push({ kind, anchorCell, size: members.length, spine: [], key: `${kind}-${anchorCell}` })
  }

  // ---- landmasses
  const landMask = new Uint8Array(N)
  let landCells = 0
  for (let i = 0; i < N; i++) if (elev[i] >= 0) { landMask[i] = 1; landCells++ }
  const lands = components(ctx, landMask)
  const continentMin = Math.max(cells(T.continentCells), Math.round(T.continentFraction * landCells))
  let islands = 0
  for (const c of bySize(lands.members)) {
    const m = lands.members[c]
    if (m.length >= continentMin) addBlob(FeatureKind.Continent, m, map.land, lands.id, c)
    else if (m.length >= cells(T.islandCells) && islands < T.maxIslands) {
      addBlob(FeatureKind.Island, m, map.land, lands.id, c)
      islands++
    }
  }

  // ---- water bodies
  detectWater(ctx, map, landMask, addBlob, cells, hops)

  // ---- lakes
  const lakeMask = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (world.lake[i] === 1) lakeMask[i] = 1
  const lakes = components(ctx, lakeMask)
  let nLakes = 0
  for (const c of bySize(lakes.members)) {
    if (lakes.members[c].length < cells(T.lakeCells) || nLakes >= T.maxLakes) break
    addBlob(FeatureKind.Lake, lakes.members[c], map.lake, lakes.id, c)
    nLakes++
  }

  // ---- rivers
  detectRivers(ctx, map, hops)

  // ---- mountain ranges
  detectRanges(ctx, map, cells)

  // ---- deserts and forests
  const biomeBlobs = (kind: FeatureKind, biomes: readonly number[], minCells: number, max: number): void => {
    // components of each biome separately, pooled
    const pooled: { members: number[]; comp: Components; c: number }[] = []
    const one = new Uint8Array(N)
    for (const b of biomes) {
      for (let i = 0; i < N; i++) one[i] = elev[i] >= 0 && world.biome[i] === b ? 1 : 0
      const comp = components(ctx, one)
      comp.members.forEach((m, c) => { if (m.length >= minCells) pooled.push({ members: m, comp, c }) })
    }
    pooled.sort((a, b) => b.members.length - a.members.length || a.members[0] - b.members[0])
    for (let i = 0; i < pooled.length && i < max; i++) addBlob(kind, pooled[i].members, map.cover, pooled[i].comp.id, pooled[i].c)
  }
  biomeBlobs(FeatureKind.Desert, [Biome.Desert], cells(T.desertCells), T.maxDeserts)
  biomeBlobs(FeatureKind.Forest, [Biome.TemperateForest, Biome.Taiga, Biome.Rainforest], cells(T.forestCells), T.maxForests)

  return map
}

type AddBlob = (kind: FeatureKind, members: readonly number[], perCell: Int32Array, region: Int32Array, rid: number) => void

function detectWater(ctx: Ctx, map: FeatureMap, landMask: Uint8Array, addBlob: AddBlob, cells: (x: number) => number, hops: (x: number) => number): void {
  const { N, off, nb, world } = ctx
  const elev = world.elevation
  const waterMask = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (!landMask[i]) waterMask[i] = 1
  const bodies = components(ctx, waterMask)
  if (!bodies.members.length) return
  const bodyOrder = bySize(bodies.members)
  const main = bodyOrder[0]
  const seaMin = cells(T.seaCells)

  // region per water cell: -1 unassigned; >= 0 index into `regions`
  const region = new Int32Array(N).fill(-1)
  interface Region { kind: FeatureKind; members: number[] }
  const regions: Region[] = []
  const newRegion = (kind: FeatureKind, members: number[]): void => {
    const r = regions.length
    for (const c of members) region[c] = r
    regions.push({ kind, members })
  }

  // water bodies apart from the world ocean: inland seas
  for (let t = 1; t < bodyOrder.length; t++) {
    const m = bodies.members[bodyOrder[t]]
    if (m.length >= seaMin) newRegion(FeatureKind.Sea, m)
  }

  // opening of the world ocean
  const inMain = new Uint8Array(N)
  for (const c of bodies.members[main]) inMain[c] = 1
  const dLand = hopDistance(ctx, landMask, waterMask)
  const R = hops(T.openRadius)
  const eroded = new Uint8Array(N)
  for (const c of bodies.members[main]) if (dLand[c] > R) eroded[c] = 1
  const cores = components(ctx, eroded)
  // grow each core back by R through the ocean; the first core to arrive claims a cell
  const owner = new Int32Array(N).fill(-1)
  const depth = new Int32Array(N)
  {
    const { queue } = ctx
    let head = 0, tail = 0
    for (let i = 0; i < N; i++) if (eroded[i]) { owner[i] = cores.id[i]; queue[tail++] = i }
    while (head < tail) {
      const x = queue[head++]
      if (depth[x] >= R) continue
      for (let k = off[x]; k < off[x + 1]; k++) {
        const j = nb[k]
        if (inMain[j] && owner[j] < 0) { owner[j] = owner[x]; depth[j] = depth[x] + 1; queue[tail++] = j }
      }
    }
  }
  // cores: big ones are open ocean, small ones seas behind straits
  const coreCells: number[][] = cores.members.map(() => [])
  for (const c of bodies.members[main]) if (owner[c] >= 0) coreCells[owner[c]].push(c)
  const oceanCores: number[] = []
  for (let k = 0; k < cores.members.length; k++) {
    if (cores.members[k].length >= Math.max(cells(T.oceanCoreCells), T.oceanCoreFraction * bodies.members[main].length)) oceanCores.push(k)
    else if (coreCells[k].length >= seaMin) newRegion(FeatureKind.Sea, coreCells[k])
  }
  // what the opening removed: bays, gulfs, straits
  const residual = new Uint8Array(N)
  for (const c of bodies.members[main]) if (owner[c] < 0) residual[c] = 1
  const narrows = components(ctx, residual)
  for (const k of bySize(narrows.members)) {
    if (narrows.members[k].length < seaMin) break
    newRegion(FeatureKind.Sea, narrows.members[k])
  }
  // keep only the largest seas; the others fall back into the ocean
  {
    const seaIdx: number[] = []
    regions.forEach((r, i) => { if (r.kind === FeatureKind.Sea) seaIdx.push(i) })
    seaIdx.sort((a, b) => regions[b].members.length - regions[a].members.length || regions[a].members[0] - regions[b].members[0])
    for (let t = T.maxSeas; t < seaIdx.length; t++) {
      for (const c of regions[seaIdx[t]].members) region[c] = -1
      regions[seaIdx[t]].members = []
    }
  }

  // oceans: the open water of the big cores, split among a few deep, distant basin seeds
  const oceanSet = new Uint8Array(N)
  const oceanMembers: number[] = []
  for (const c of bodies.members[main]) {
    if (region[c] < 0 && owner[c] >= 0 && oceanCores.indexOf(owner[c]) >= 0) { oceanSet[c] = 1; oceanMembers.push(c) }
  }
  if (oceanMembers.length) {
    const total = oceanMembers.length
    const K = Math.max(oceanCores.length, Math.min(T.maxOceans, Math.round(total / cells(T.cellsPerOcean))), 1)
    let minE = 0
    for (const c of oceanMembers) if (elev[c] < minE) minE = elev[c]
    const depthW = (c: number) => 0.55 + 0.45 * (minE < 0 ? elev[c] / minE : 0)
    // seeds per core, proportional to its share of ocean
    const seeds: number[] = []
    const piece = new Int32Array(N).fill(-1)
    const perCore = oceanCores.map((k) => {
      let n = 0
      for (const c of coreCells[k]) if (oceanSet[c]) n++
      return n
    })
    let left = K
    oceanCores.forEach((k, t) => {
      const mem: number[] = []
      for (const c of coreCells[k]) if (oceanSet[c]) mem.push(c)
      if (!mem.length) return
      const want = t === oceanCores.length - 1 ? Math.max(1, left) : Math.max(1, Math.round((K * perCore[t]) / total))
      left -= want
      let deepest = mem[0]
      for (const c of mem) if (elev[c] < elev[deepest]) deepest = c
      for (const s of splitRegion(ctx, mem, oceanSet, want, deepest, depthW, piece)) seeds.push(s)
    })
    // final borders: growth from the seeds, slowed over shallow water (ridges, island arcs).
    // Integer edge costs (half-hops, 2..7) let a bucket queue stand in for a heap.
    const label = new Int32Array(N).fill(-1)
    const cost = new Int32Array(N).fill(0x7fffffff)
    const B = 8
    const buckets: number[][] = []
    for (let b = 0; b < B; b++) buckets.push([])
    seeds.forEach((s, i) => { cost[s] = 0; label[s] = i; buckets[0].push(s) })
    let pending = seeds.length
    for (let d = 0; pending > 0; d++) {
      const list = buckets[d % B]
      for (let t = 0; t < list.length; t++) {
        const x = list[t]
        pending--
        if (cost[x] !== d) continue
        for (let k = off[x]; k < off[x + 1]; k++) {
          const j = nb[k]
          if (!oceanSet[j]) continue
          const shallow = Math.min(1, Math.max(0, 1 + elev[j] / 0.35))
          const c = d + 2 + Math.round(5 * shallow * shallow)
          if (c < cost[j]) { cost[j] = c; label[j] = label[x]; buckets[c % B].push(j); pending++ }
        }
      }
      list.length = 0
    }
    const basins: number[][] = seeds.map(() => [])
    for (const c of oceanMembers) if (label[c] >= 0) basins[label[c]].push(c)
    // a basin walled in by land (a gulf or mediterranean between continents) is a sea
    for (let i = 0; i < basins.length; i++) {
      const b = basins[i]
      if (!b.length) continue
      let landEdges = 0, openEdges = 0
      for (const c of b) {
        for (let k = off[c]; k < off[c + 1]; k++) {
          const j = nb[k]
          if (landMask[j]) landEdges++
          else if (oceanSet[j] && label[j] !== i) openEdges++
        }
      }
      const enclosed = landEdges / Math.max(1, landEdges + openEdges)
      newRegion(enclosed >= T.enclosedSea && b.length < T.enclosedSeaFraction * total ? FeatureKind.Sea : FeatureKind.Ocean, b)
    }
  }

  // leftover ocean water (small bays, dropped seas) joins the nearest region
  {
    const { queue } = ctx
    let head = 0, tail = 0
    for (const c of bodies.members[main]) if (region[c] >= 0) queue[tail++] = c
    while (head < tail) {
      const x = queue[head++]
      for (let k = off[x]; k < off[x + 1]; k++) {
        const j = nb[k]
        if (inMain[j] && region[j] < 0) {
          region[j] = region[x]
          regions[region[x]].members.push(j)
          queue[tail++] = j
        }
      }
    }
  }

  // oceans first (largest first), then seas
  const order = regions.map((_, i) => i).filter((i) => regions[i].members.length > 0)
  order.sort((a, b) => (regions[a].kind === regions[b].kind ? 0 : regions[a].kind === FeatureKind.Ocean ? -1 : 1) || regions[b].members.length - regions[a].members.length || regions[a].members[0] - regions[b].members[0])
  for (const r of order) addBlob(regions[r].kind, regions[r].members, map.water, region, r)
}

function detectRivers(ctx: Ctx, map: FeatureMap, hops: (x: number) => number): void {
  const { N, world } = ctx
  const { riverTo, flow, elevation: elev } = world
  const isRiver = (c: number) => elev[c] >= 0 && flow[c] >= RIVER_FLOW_THRESHOLD
  // upstream children, CSR
  const upOff = new Int32Array(N + 1)
  for (let i = 0; i < N; i++) if (riverTo[i] >= 0 && isRiver(i)) upOff[riverTo[i] + 1]++
  for (let i = 0; i < N; i++) upOff[i + 1] += upOff[i]
  const up = new Int32Array(upOff[N])
  const cur = upOff.slice(0, N)
  for (let i = 0; i < N; i++) if (riverTo[i] >= 0 && isRiver(i)) up[cur[riverTo[i]]++] = i
  const mainChild = (c: number): number => {
    let best = -1
    for (let k = upOff[c]; k < upOff[c + 1]; k++) {
      const j = up[k]
      if (best < 0 || flow[j] > flow[best] || (flow[j] === flow[best] && j < best)) best = j
    }
    return best
  }
  /** Cells from `start` upstream to the source along the largest tributary. */
  const traceUp = (start: number): number[] => {
    const out = [start]
    for (let c = mainChild(start); c >= 0; c = mainChild(c)) out.push(c)
    return out
  }

  const stems: number[][] = []
  for (let i = 0; i < N; i++) {
    if (!isRiver(i)) continue
    const t = riverTo[i]
    if (t >= 0 && elev[t] >= 0) continue
    const s = traceUp(i)
    if (s.length >= hops(T.riverCells)) stems.push(s)
  }
  stems.sort((a, b) => b.length - a.length || flow[b[0]] - flow[a[0]] || a[0] - b[0])
  stems.length = Math.min(stems.length, T.maxRivers)

  // long tributaries of the kept rivers (one level), ending at their confluence
  const tribs: number[][] = []
  for (const s of stems) {
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      const mainUp = i + 1 < s.length ? s[i + 1] : -1
      for (let k = upOff[c]; k < upOff[c + 1]; k++) {
        const j = up[k]
        if (j === mainUp || flow[j] < T.tributaryFlow) continue
        const t = traceUp(j)
        if (t.length >= hops(T.tributaryCells)) tribs.push([c].concat(t))
      }
    }
  }
  tribs.sort((a, b) => b.length - a.length || flow[b[1]] - flow[a[1]] || a[1] - b[1])
  tribs.length = Math.min(tribs.length, T.maxTributaries)

  for (const s of stems.concat(tribs)) {
    const spine = s.slice().reverse() // source to mouth (or confluence)
    const f = map.features.length
    for (const c of spine) {
      if (map.river[c] < 0) map.river[c] = f
      else if (map.river2[c] < 0) map.river2[c] = f
    }
    const anchorCell = spine[Math.floor((spine.length - 1) * 0.7)]
    map.features.push({ kind: FeatureKind.River, anchorCell, size: spine.length, spine, key: `${FeatureKind.River}-${s[0]}-${s[1] ?? s[0]}` })
  }
}

function detectRanges(ctx: Ctx, map: FeatureMap, cells: (x: number) => number): void {
  const { N, off, nb, world, queue, dist } = ctx
  const elev = world.elevation
  const landE: number[] = []
  for (let i = 0; i < N; i++) if (elev[i] >= 0 && world.lake[i] !== 1) landE.push(elev[i])
  if (!landE.length) return
  landE.sort((a, b) => a - b)
  const hiT = Math.min(T.highMax, Math.max(T.highMin, landE[Math.min(landE.length - 1, Math.floor(T.highPercentile * landE.length))]))
  const high = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (elev[i] >= hiT && world.lake[i] !== 1) high[i] = 1
  const comps = components(ctx, high)
  const pieces: number[][] = []
  const piece = new Int32Array(N).fill(-1)
  for (const k of bySize(comps.members)) {
    const m = comps.members[k]
    if (m.length < cells(T.rangeCells)) break
    if (m.length <= cells(T.splitCells)) { pieces.push(m); continue }
    const parts = Math.round(m.length / cells(T.pieceCells))
    let top = m[0]
    for (const c of m) if (elev[c] > elev[top]) top = c
    const seeds = splitRegion(ctx, m, high, parts, top, () => 1, piece)
    const lists: number[][] = seeds.map(() => [])
    for (const c of m) if (piece[c] >= 0) lists[piece[c]].push(c)
    for (const l of lists) if (l.length >= cells(T.rangeCells)) pieces.push(l)
  }
  pieces.sort((a, b) => b.length - a.length || a[0] - b[0])
  pieces.length = Math.min(pieces.length, T.maxRanges)

  const inPiece = new Uint8Array(N)
  const cost = new Float64Array(N).fill(Infinity)
  const prev = new Int32Array(N).fill(-1)
  const far = (from: number, members: readonly number[]): number => {
    for (const c of members) dist[c] = -1
    let head = 0, tail = 0
    queue[tail++] = from
    dist[from] = 0
    let last = from
    while (head < tail) {
      const x = queue[head++]
      last = x
      for (let k = off[x]; k < off[x + 1]; k++) {
        const j = nb[k]
        if (inPiece[j] && dist[j] < 0) { dist[j] = dist[x] + 1; queue[tail++] = j }
      }
    }
    for (const c of members) dist[c] = 0
    return last
  }
  for (const m of pieces) {
    for (const c of m) inPiece[c] = 1
    let maxE = hiT
    for (const c of m) if (elev[c] > maxE) maxE = elev[c]
    const a = far(m[0], m)
    const b = far(a, m)
    // crest: cheapest path a -> b inside the range, cheaper along high ground
    const heap = new MinHeap(m.length)
    cost[a] = 0
    heap.push(0, a)
    while (heap.size > 0) {
      const key = heap.topKey()
      const x = heap.pop()
      if (key > cost[x]) continue
      if (x === b) break
      for (let k = off[x]; k < off[x + 1]; k++) {
        const j = nb[k]
        if (!inPiece[j]) continue
        const h = (elev[j] - hiT) / Math.max(1e-6, maxE - hiT)
        const c = key + 1 + 2 * (1 - h)
        if (c < cost[j]) { cost[j] = c; prev[j] = x; heap.push(c, j) }
      }
    }
    const spine: number[] = [b]
    for (let x = b; x !== a;) {
      const p = prev[x]
      if (p < 0) break
      spine.push(p)
      x = p
    }
    spine.reverse()
    for (const c of m) { inPiece[c] = 0; cost[c] = Infinity; prev[c] = -1 }
    const f = map.features.length
    for (const c of m) map.relief[c] = f
    const anchorCell = spine[Math.floor((spine.length - 1) / 2)]
    map.features.push({ kind: FeatureKind.MountainRange, anchorCell, size: m.length, spine, key: `${FeatureKind.MountainRange}-${anchorCell}` })
  }
}

/**
 * Features on or beside a cell, by index into map.features (each once): its own
 * landmass, lake, river, range, desert or forest, and those of its neighbours,
 * plus the oceans and seas of neighbouring water (only the cell's own when
 * `beside` is false). Appends to `out` and returns it.
 */
export function featuresAt(map: FeatureMap, world: World, cell: number, out: number[] = [], beside = true): number[] {
  const add = (f: number) => { if (f >= 0 && out.indexOf(f) < 0) out.push(f) }
  const { neighborOffsets: off, neighbors: nb } = world.grid
  add(map.land[cell]); add(map.water[cell]); add(map.lake[cell]); add(map.river[cell]); add(map.river2[cell]); add(map.relief[cell]); add(map.cover[cell])
  if (!beside) return out
  for (let k = off[cell]; k < off[cell + 1]; k++) {
    const j = nb[k]
    add(map.water[j]); add(map.lake[j]); add(map.river[j]); add(map.river2[j]); add(map.relief[j]); add(map.cover[j])
  }
  return out
}
