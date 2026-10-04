// Per-cell population density for the Population view: each living settlement's people
// (History.population at a snapshot) are spread over its own cell and the land cells
// around it that it farms, weight falling off with graph distance (own cell most, then
// neighbours out to 1-3 hops depending on the settlement's size; land only; an outpost
// counts at its own cell only). Weights are normalised per settlement so its people are
// conserved, and cells where settlements' reach overlaps are summed.
//
// The cell lists and base (distance-only) weights are precomputed once per history
// (buildPopulationDensity); update(s) is then a cheap weighted sum over those lists, so it
// can be called whenever the shown snapshot index changes without allocating.

import type { Grid, History, World } from '../contract.ts'
import { CITY_POPULATION, TOWN_POPULATION } from '../contract.ts'
import { isWaterCell, lakeArray } from '../render/globe.ts'
import { NORM_YEARS, type HistoryIndex, type LandData } from './historyIndex.ts'

/** Weight of a cell at graph distance `hop` from its settlement, before normalisation. */
const WEIGHT_BY_HOP: readonly number[] = [1, 0.45, 0.2, 0.09]

/** Reach (in hops) by settlement size tier: villages stay local, towns and cities spread further. */
function maxHopFor(peak: number, outpost: boolean): number {
  if (outpost) return 0
  if (peak >= CITY_POPULATION) return 3
  if (peak >= TOWN_POPULATION) return 2
  return 1
}

export interface PopulationDensity {
  /** People per cell at the last snapshot passed to `update`; reused in place. */
  density: Float32Array
  /** Fixed colour-scale maximum from the first NORM_YEARS of this history. */
  densityMax: number
  /** Recompute `density` for population snapshot `s`. Pure function of `s`. */
  update(s: number): void
}

function spreadFrom(startCell: number, maxHop: number, isLand: (c: number) => boolean, grid: Grid, outCells: number[], outHops: number[]) {
  outCells.length = 0
  outHops.length = 0
  const visited = new Set<number>()
  visited.add(startCell)
  outCells.push(startCell)
  outHops.push(0)
  let frontier = [startCell]
  for (let hop = 1; hop <= maxHop && frontier.length > 0; hop++) {
    const next: number[] = []
    for (const c of frontier) {
      for (let k = grid.neighborOffsets[c]; k < grid.neighborOffsets[c + 1]; k++) {
        const nb = grid.neighbors[k]
        if (visited.has(nb) || !isLand(nb)) continue
        visited.add(nb)
        outCells.push(nb)
        outHops.push(hop)
        next.push(nb)
      }
    }
    frontier = next
  }
}

export function buildPopulationDensity(world: World, index: HistoryIndex): PopulationDensity {
  const h: History = index.history
  const N = index.count
  const cellCount = world.grid.cellCount
  const lake = lakeArray(world)
  const isLand = (c: number) => !isWaterCell(world, lake, c)

  // Peak population per settlement over the first NORM_YEARS (static reach, so the spread
  // lists below need building only once per history).
  const normSnapshots = Math.min(h.snapshotCount, Math.floor(NORM_YEARS / Math.max(1, h.snapshotInterval)) + 1)
  const peak = new Float32Array(N)
  for (let s = 0; s < normSnapshots; s++) {
    const base = s * N
    for (let i = 0; i < N; i++) {
      const p = h.population[base + i]
      if (p > peak[i]) peak[i] = p
    }
  }

  // Build the CSR spread lists: cells[] and base (distance-only) weights, normalised to
  // sum to 1 per settlement.
  const offsets = new Uint32Array(N + 1)
  const cellsTmp: number[] = []
  const hopsTmp: number[] = []
  const perSettlement: { cells: number[]; weights: number[] }[] = new Array(N)
  let maxListLen = 1
  for (let i = 0; i < N; i++) {
    const s = h.settlements[i]
    const outpost = (s as { outpost?: boolean }).outpost === true
    const hop = maxHopFor(peak[i], outpost)
    spreadFrom(s.cell, hop, isLand, world.grid, cellsTmp, hopsTmp)
    const n = cellsTmp.length
    let sum = 0
    const weights = new Array<number>(n)
    for (let k = 0; k < n; k++) {
      const w = WEIGHT_BY_HOP[Math.min(hopsTmp[k], WEIGHT_BY_HOP.length - 1)]
      weights[k] = w
      sum += w
    }
    if (sum <= 0) sum = 1
    for (let k = 0; k < n; k++) weights[k] /= sum
    perSettlement[i] = { cells: cellsTmp.slice(), weights }
    offsets[i + 1] = offsets[i] + n
    if (n > maxListLen) maxListLen = n
  }
  const totalEntries = offsets[N]
  const spreadCells = new Int32Array(totalEntries)
  const spreadWeights = new Float32Array(totalEntries)
  for (let i = 0; i < N; i++) {
    const { cells, weights } = perSettlement[i]
    spreadCells.set(cells, offsets[i])
    spreadWeights.set(weights, offsets[i])
  }

  const land: LandData | null = index.land
  const tilt = new Float32Array(maxListLen) // scratch, reused across calls

  const density = new Float32Array(cellCount)

  function update(s: number) {
    density.fill(0)
    const base = s * N
    const year = s * h.snapshotInterval
    const landRow = land ? Math.min(land.count - 1, Math.max(0, Math.floor(year / land.interval))) : -1
    for (let i = 0; i < N; i++) {
      const p = h.population[base + i]
      if (p <= 0) continue
      const a = offsets[i], b = offsets[i + 1]
      if (landRow < 0) {
        for (let k = a; k < b; k++) density[spreadCells[k]] += p * spreadWeights[k]
        continue
      }
      let sum = 0
      for (let k = a; k < b; k++) {
        const cell = spreadCells[k]
        const luv = land!.landUse[landRow * cellCount + cell] / 255
        const tw = spreadWeights[k] * (0.4 + 1.2 * luv)
        tilt[k - a] = tw
        sum += tw
      }
      if (sum <= 0) {
        for (let k = a; k < b; k++) density[spreadCells[k]] += p * spreadWeights[k]
        continue
      }
      for (let k = a; k < b; k++) density[spreadCells[k]] += (p * tilt[k - a]) / sum
    }
  }

  // Robust scale: the 97th percentile of this history's per-snapshot peak cell density,
  // taken over the first NORM_YEARS only (so extending the history past it never rescales
  // colours already shown; see NORM_YEARS).
  const maxes: number[] = []
  for (let s = 0; s < normSnapshots; s++) {
    update(s)
    let m = 0
    for (let c = 0; c < cellCount; c++) if (density[c] > m) m = density[c]
    maxes.push(m)
  }
  maxes.sort((a, b) => a - b)
  const densityMax = maxes.length > 0 ? Math.max(1, maxes[Math.floor(0.97 * (maxes.length - 1))]) : 1

  return { density, densityMax, update }
}
