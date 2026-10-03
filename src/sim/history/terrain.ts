// Static per-cell data the history runs on: carrying capacity, catchments,
// travel cost and landmasses. Computed once from the World, never mutated.

import { Biome, RIVER_FLOW_THRESHOLD } from '../../contract.ts'
import type { World } from '../../contract.ts'
import { MinHeap, smoothstep } from '../util.ts'
import { CAPACITY, CATCHMENT, DEGRADATION, MOVE_COST } from './params.ts'

export interface Terrain {
  cellCount: number
  /** Subdivision frequency n and 48 / n. */
  n: number
  cellScale: number
  /** Base carrying capacity in people at productivity 1 (0 for water, lakes, ice). */
  capacity: Float64Array
  /** 1 for land, non-lake cells with capacity >= habitableMin (scaled by area). */
  habitable: Uint8Array
  /** Capacity split: farmland (fields and floodplain, which degrade and can be irrigated) and fishing; capacity = capFarm + capFish. */
  capFarm: Float64Array
  capFish: Float64Array
  /** Cells with capacity > 0, ascending: the only cells land use and degradation ever touch. */
  landCells: Int32Array
  /** How fast intensive use exhausts the land (1 = average; steep, arid, rainforest and taiga higher; floodplains low). */
  fragility: Float64Array
  /** 1 - smoothstep(0.1, 0.45, rainfall) on farmable land (capacity > 0), else 0. */
  aridity: Float64Array
  /** River cells (flow >= RIVER_FLOW_THRESHOLD, land). */
  river: Uint8Array
  /** Land, non-lake cells next to open (non-ice) sea: port sites. */
  seaCoast: Uint8Array
  /** 1 for sea cells (elevation < 0). */
  sea: Uint8Array
  /**
   * CSR catchment per habitable cell (empty elsewhere): cells with capacity > 0 within distance
   * CATCHMENT.maxHops over land (n = 48 hop units, shorter along rivers and
   * coasts), with base weight and distance, nearest first (own cell first).
   * Entries [catchOff[c], catchBase[c]) are within CATCHMENT.hops, the reach of
   * every settlement; the rest only feed large settlements.
   */
  catchOff: Int32Array
  catchBase: Int32Array
  catchCell: Int32Array
  catchW: Float64Array
  catchDist: Float64Array
  /** CSR exclusion zone per habitable cell: land cells within exclusionHops plain hops (including itself). */
  exclOff: Int32Array
  exclCell: Int32Array
  /** Sum of weight * capacity over the base catchment (uncontested, productivity 1). */
  potential: Float64Array
  /** Cost of entering a cell in n = 48 cell units; NaN-free. Deep ocean cells are flagged in `deep` and cost oceanCost(era). */
  moveCost: Float64Array
  deep: Uint8Array
  /** Landmass label per land cell (lakes included), -1 for sea. */
  landmass: Int32Array
  landmassSize: number[]
}

export function buildTerrain(world: World): Terrain {
  const N = world.grid.cellCount
  const n = Math.max(1, Math.round(Math.sqrt((N - 2) / 10)))
  const cellScale = 48 / n
  const area = 23042 / N
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const { elevation: elev, temperature: temp, rainfall: rain, biome, flow, lake } = world
  const C = CAPACITY

  // --- Carrying capacity -----------------------------------------------------
  const capacity = new Float64Array(N)
  const habitable = new Uint8Array(N)
  const capFarm = new Float64Array(N)
  const capFish = new Float64Array(N)
  const fragility = new Float64Array(N)
  const aridity = new Float64Array(N)
  const seaCoast = new Uint8Array(N)
  const D = DEGRADATION
  const habMin = C.habitableMin * area
  for (let i = 0; i < N; i++) {
    const e = elev[i]
    const b = biome[i]
    if (e < 0 || lake[i] || b === Biome.Ice) continue
    let slope = 0
    let seaAdj = false, shallowAdj = false, lakeAdj = false
    for (let k = off[i]; k < off[i + 1]; k++) {
      const j = nb[k]
      const ej = elev[j]
      if (ej < 0) {
        if (biome[j] === Biome.Coast) shallowAdj = true
        else if (biome[j] !== Biome.Ice) seaAdj = true
      } else {
        if (lake[j]) lakeAdj = true
        const d = ej > e ? ej - e : e - ej
        if (d > slope) slope = d
      }
    }
    // Slopes are per hop; express them per n = 48 hop.
    slope *= n / 48
    const t = temp[i], r = rain[i]
    const warmth = smoothstep(0.08, 0.4, t)
    const moist = smoothstep(0.05, 0.35, r)
    const relief = 1 - 0.85 * smoothstep(0.1, 0.45, e)
    const rough = 1 - 0.5 * smoothstep(0.03, 0.15, slope)
    const farm = C.agri[b] * warmth * (0.25 + 0.75 * moist) * relief * rough
    const fr = flow[i] / RIVER_FLOW_THRESHOLD
    // fr^0.75 from square roots (no pow): big rivers feed disproportionately many.
    let river = fr >= 1 ? C.river * Math.min(C.riverMax, Math.sqrt(fr * Math.sqrt(fr))) : C.creek * fr
    river *= (0.3 + 0.7 * warmth) * relief
    let fish = shallowAdj ? C.fishShallow : seaAdj ? C.fishSea : 0
    if (lakeAdj) fish += C.fishLake
    fish *= 0.3 + 0.7 * warmth
    const cap = C.base * area * (farm + river + fish)
    capacity[i] = cap
    capFarm[i] = C.base * area * (farm + river)
    capFish[i] = C.base * area * fish
    if (cap >= habMin) habitable[i] = 1
    if (seaAdj || shallowAdj) seaCoast[i] = 1
    aridity[i] = 1 - smoothstep(0.1, 0.45, r)
    let frag = 1 + D.slope * smoothstep(0.03, 0.15, slope) + D.arid * (1 - smoothstep(0.1, 0.4, r)) + D.biome[b]
    frag *= fr >= 1 ? D.floodplain : 1 - (1 - D.floodplain) * 0.5 * fr
    fragility[i] = frag
  }
  const land: number[] = []
  for (let i = 0; i < N; i++) if (capacity[i] > 0) land.push(i)
  const landCells = Int32Array.from(land)

  // --- Catchments ------------------------------------------------------------
  // Dijkstra over land from each land cell, in n = 48 hop units: one hop
  // costs 1, but less along a river (boats, irrigation), along a coast
  // (fishing boats, coastal trade) and across lakes, so river and coastal
  // settlements naturally draw on more land. Entries are in Dijkstra order,
  // so distances never decrease along a cell's list.
  const K = CATCHMENT
  const isRiver = new Uint8Array(N)
  const isCoastal = new Uint8Array(N)
  const sea = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    if (elev[i] < 0) { sea[i] = 1; continue }
    if (flow[i] >= RIVER_FLOW_THRESHOLD) isRiver[i] = 1
    for (let k = off[i]; k < off[i + 1]; k++) if (elev[nb[k]] < 0) { isCoastal[i] = 1; break }
  }
  const edgeCost = (i: number, j: number): number => {
    let f = 1
    if (isRiver[i] && isRiver[j] && (world.riverTo[i] === j || world.riverTo[j] === i)) f = K.riverEdge
    else if (lake[i] || lake[j]) f = K.lakeEdge
    else if (isCoastal[i] && isCoastal[j]) f = K.coastEdge
    return f * cellScale
  }
  const weightAt = (d: number): number => {
    const W = K.weights
    const lo = Math.floor(d)
    return lo >= W.length - 1 ? W[W.length - 1] : W[lo] * (1 - (d - lo)) + W[lo + 1] * (d - lo)
  }
  const catchOff = new Int32Array(N + 1)
  const catchBase = new Int32Array(N)
  let cells: number[] = []
  let ds: number[] = []
  const stamp = new Int32Array(N).fill(-1)
  const dist = new Float64Array(N)
  const heap = new MinHeap(256)
  const potential = new Float64Array(N)
  const maxD = K.maxHops + 1e-9
  for (let s = 0; s < N; s++) {
    catchOff[s] = cells.length
    catchBase[s] = cells.length
    if (!habitable[s]) continue // only settlements need catchments
    heap.size = 0
    heap.push(0, s)
    stamp[s] = s
    dist[s] = 0
    let pot = 0
    let base = cells.length
    while (heap.size > 0) {
      const d = heap.topKey()
      const c = heap.pop()
      if (d > dist[c]) continue
      if (capacity[c] > 0) {
        cells.push(c)
        ds.push(d)
        if (d <= K.hops + 1e-9) { pot += weightAt(d) * capacity[c]; base = cells.length }
      }
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (elev[j] < 0) continue
        const nd = d + edgeCost(c, j)
        if (nd > maxD || (stamp[j] === s && nd >= dist[j])) continue
        stamp[j] = s
        dist[j] = nd
        heap.push(nd, j)
      }
    }
    catchBase[s] = base
    potential[s] = pot
  }
  catchOff[N] = cells.length
  const catchCell = Int32Array.from(cells)
  const catchDist = Float64Array.from(ds)
  const catchW = new Float64Array(catchDist.length)
  for (let k = 0; k < catchDist.length; k++) catchW[k] = weightAt(catchDist[k])
  cells = []; ds = []

  // Exclusion zones: land cells within exclusionHops plain hops (BFS), CSR.
  const exclusionHops = Math.max(1, Math.round((K.exclusionHops * n) / 48))
  const exclOff = new Int32Array(N + 1)
  const excl: number[] = []
  const depth = new Int32Array(N)
  const queue = new Int32Array(N)
  stamp.fill(-1)
  for (let s = 0; s < N; s++) {
    exclOff[s] = excl.length
    if (!habitable[s]) continue
    let head = 0, tail = 0
    queue[tail++] = s
    stamp[s] = s
    depth[s] = 0
    while (head < tail) {
      const c = queue[head++]
      excl.push(c)
      if (depth[c] === exclusionHops) continue
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (stamp[j] === s || elev[j] < 0) continue
        stamp[j] = s
        depth[j] = depth[c] + 1
        queue[tail++] = j
      }
    }
  }
  exclOff[N] = excl.length
  const exclCell = Int32Array.from(excl)

  // --- Travel cost ------------------------------------------------------------
  const M = MOVE_COST
  const moveCost = new Float64Array(N)
  const deep = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    const e = elev[i]
    const b = biome[i]
    let c: number
    if (e < 0) {
      if (b === Biome.Ocean) { deep[i] = 1; c = 0 }
      else c = M.biome[b] // shallow coast, sea ice
    } else if (lake[i]) {
      c = M.lake
    } else {
      c = M.biome[b] + M.highland * smoothstep(0.3, 0.7, e)
      if (flow[i] >= RIVER_FLOW_THRESHOLD) c = M.riverBase + M.riverScale * c
      for (let k = off[i]; k < off[i + 1]; k++) {
        if (elev[nb[k]] < 0) { c *= M.coastal; break }
      }
    }
    moveCost[i] = c * cellScale
  }

  // --- Landmasses ---------------------------------------------------------------
  const landmass = new Int32Array(N).fill(-1)
  const landmassSize: number[] = []
  for (let s = 0; s < N; s++) {
    if (elev[s] < 0 || landmass[s] >= 0) continue
    const id = landmassSize.length
    let sp = 0, size = 0
    queue[sp++] = s
    landmass[s] = id
    while (sp > 0) {
      const c = queue[--sp]
      size++
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (elev[j] >= 0 && landmass[j] < 0) { landmass[j] = id; queue[sp++] = j }
      }
    }
    landmassSize.push(size)
  }

  return {
    cellCount: N, n, cellScale, capacity, habitable, capFarm, capFish, landCells, fragility, aridity,
    river: isRiver, seaCoast, sea,
    catchOff, catchBase, catchCell, catchW, catchDist, exclOff, exclCell, potential,
    moveCost, deep, landmass, landmassSize,
  }
}
