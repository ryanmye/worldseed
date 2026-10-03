// Settlement history: a deterministic yearly simulation of population, food,
// migration and new settlements on top of a generated World, precomputed for
// the whole run with periodic snapshots.
//
// Each year runs a fixed sequence of small systems over shared state:
//   productivity -> weather -> food -> trade -> population -> migration
//   -> voyages -> abandonment (-> routes of the abandoned close) -> structures
//   -> [land use -> degradation] -> [roads] -> milestones -> snapshots
// (land use and degradation advance every LAND.step years, roads every
// ROAD.step years; in land
// years the food system also records which fields feed each settlement). The
// trade system (trade.ts) rebuilds its link graph every TRADE.linkStep years
// and runs the market every year between the harvest and the population
// system, so imports feed people the year they arrive. Land snapshots (Uint8
// use, degradation and road per cell) are taken every landInterval years,
// trade-volume snapshots every tradeInterval years.
// Later systems (polities, war) slot into this sequence.
//
// Random streams (all derived from world.seed): 'history-tribes' (founders),
// 'history-weather' (fixed draws per year, independent of what people do),
// 'history-migration' (who leaves, where they go), 'history-voyages' (voyages
// of settlement by sea: who sails, where to, who is lost; voyages.ts) and
// 'history-structures' (when ports and dams get built); 'history-ore' seeds
// the ore-richness noise.
// The sim uses only + - * / and sqrt (and floor), so output is bit-identical
// across engines.
//
// History.capacity is the base carrying capacity at productivity 1 (year 0);
// the effective capacity in year y is roughly capacity * productivityAt(y)
// (about 4x by year 2000), lowered by degradation and raised by irrigation
// (land.ts, structures.ts), and raised by wealth and trade (trade.ts: rich
// hubs get more from their land and import food).

import { GOOD_COUNT } from '../../contract.ts'
import type { History, HistoryOptions, Journeys, Settlement, SimulateHistory, World } from '../../contract.ts'
import { createRng } from '../rng.ts'
import type { Rng } from '../rng.ts'
import { nameSettlements } from '../names/index.ts'
import { createSearch, migrationSystem } from './migration.ts'
import { degradationSystem, landUseSystem } from './land.ts'
import { HISTORY_DEFAULTS, LAND, POPULATION, ROAD } from './params.ts'
import { abandonmentSystem, foodSystem, milestoneSystem, populationSystem, productivitySystem } from './population.ts'
import { createPortSearch, structureSystem } from './structures.ts'
import type { HistoryState } from './state.ts'
import { canSettle, createState, found } from './state.ts'
import { buildTerrain } from './terrain.ts'
import type { Terrain } from './terrain.ts'
import { createWeather, weatherSystem } from './weather.ts'
import { createVoyages, voyageSystem } from './voyages.ts'
import { assembleTrade, createTrade, roadSystem, tradeAbandonSystem, tradeSystem } from './trade.ts'
import type { TradeState } from './trade.ts'

/**
 * Founding tribes: on the landmass with the most total potential (the
 * "cradle"), drawn among its best sites, weighted by potential, mutually far apart.
 */
function seedTribes(s: HistoryState, rng: Rng): void {
  const T = s.terrain
  const N = T.cellCount
  const P = s.world.grid.positions
  const lmPot = new Float64Array(T.landmassSize.length)
  for (let i = 0; i < N; i++) if (T.habitable[i]) lmPot[T.landmass[i]] += T.capacity[i]
  let cradle = -1
  for (let m = 0; m < lmPot.length; m++) if (lmPot[m] > 0 && (cradle < 0 || lmPot[m] > lmPot[cradle])) cradle = m
  if (cradle < 0) return // no habitable land at all

  // Candidates: the best quarter of the cradle's habitable cells by potential.
  const cand: number[] = []
  for (let i = 0; i < N; i++) if (T.habitable[i] && T.landmass[i] === cradle) cand.push(i)
  cand.sort((a, b) => T.potential[b] - T.potential[a] || a - b)
  cand.length = Math.max(1, Math.ceil(cand.length / 4))
  let total = 0
  for (const c of cand) total += T.potential[c]

  const count = rng.int(POPULATION.tribesMin, POPULATION.tribesMax)
  const placed: number[] = []
  // Minimum chord distance between tribes; shrinks when sites run out.
  let minChord2 = 0.5 * 0.5
  let fails = 0
  while (placed.length < count && minChord2 > 1e-6) {
    let x = rng.next() * total
    let c = cand[cand.length - 1]
    for (let k = 0; k < cand.length; k++) {
      x -= T.potential[cand[k]]
      if (x < 0) { c = cand[k]; break }
    }
    let ok = canSettle(s, c)
    for (let k = 0; ok && k < placed.length; k++) {
      const q = placed[k]
      const dx = P[c * 3] - P[q * 3], dy = P[c * 3 + 1] - P[q * 3 + 1], dz = P[c * 3 + 2] - P[q * 3 + 2]
      if (dx * dx + dy * dy + dz * dz < minChord2) ok = false
    }
    if (ok) {
      placed.push(c)
      found(s, c, Math.round(rng.range(POPULATION.tribePopMin, POPULATION.tribePopMax)), -1)
      fails = 0
    } else if (++fails >= 40) {
      minChord2 *= 0.7
      fails = 0
    }
  }
}

/** Grows a Float32 buffer, keeping its contents. */
function ensure(a: Float32Array<ArrayBuffer>, need: number): Float32Array<ArrayBuffer> {
  if (need <= a.length) return a
  let size = a.length
  while (size < need) size *= 2
  const b = new Float32Array(size)
  b.set(a)
  return b
}

/** Internal figures for the stats harness (not part of the contract). */
export interface HistoryDiagnostics {
  /** Loads per good per trade snapshot: goodVolume[q * GOOD_COUNT + g]. */
  goodVolume: Float64Array
  /** Smoothed loads on and through each settlement at the end of the run. */
  through: Float64Array
  /** Every voyage of settlement searched for (see voyages.ts), in order. */
  voyages?: VoyageLog
}

/** Voyage records for the stats harness: one entry per expedition that set out to look for land. */
export interface VoyageLog {
  year: number[]
  from: number[]
  /** 0 = no landfall found (stayed home), 1 = founded a colony, 2 = lost at sea. */
  outcome: number[]
  /** 1 when the sender had a port in use. */
  port: number[]
  senderPop: number[]
  /** Sea cost and sea cells of the chosen route (0 when none). */
  cost: number[]
  seaCells: number[]
  /** Landmass of the landfall (-1 when none) and whether it differs from the sender's. */
  toLandmass: number[]
  /** Sea cells the search visited. */
  visits: number[]
}

export interface HistoryRun {
  history: History
  terrain: Terrain
  diag: HistoryDiagnostics
}

/**
 * Sorts the recorded journeys by departYear (stable, so ties keep the order
 * they were recorded in during the run) and flattens them into the
 * struct-of-arrays contract shape, each array with its own buffer.
 */
function assembleJourneys(records: HistoryState['journeys']): Journeys {
  const sorted = records.slice().sort((a, b) => a.departYear - b.departYear)
  const count = sorted.length
  const departYear = new Float32Array(count)
  const arriveYear = new Float32Array(count)
  const from = new Int32Array(count)
  const to = new Int32Array(count)
  const size = new Float32Array(count)
  const kind = new Uint8Array(count)
  const pathOffsets = new Uint32Array(count + 1)
  let totalPath = 0
  for (let i = 0; i < count; i++) totalPath += sorted[i].path.length
  const path = new Uint32Array(totalPath)
  let off = 0
  for (let i = 0; i < count; i++) {
    const j = sorted[i]
    departYear[i] = j.departYear
    arriveYear[i] = j.arriveYear
    from[i] = j.from
    to[i] = j.to
    size[i] = j.size
    kind[i] = j.kind
    pathOffsets[i] = off
    for (let k = 0; k < j.path.length; k++) path[off + k] = j.path[k]
    off += j.path.length
  }
  pathOffsets[count] = off
  return { count, departYear, arriveYear, from, to, size, kind, pathOffsets, path }
}

/**
 * Runs the simulation and also returns the internal terrain and diagnostics (for the stats harness).
 * `probe`, if given, is called with the internal state at the end of every year (tuning only; it must not modify anything).
 */
export function runHistory(world: World, options?: HistoryOptions, probe?: (s: HistoryState, t: TradeState) => void): HistoryRun {
  const years = Math.max(0, Math.floor(options?.years ?? HISTORY_DEFAULTS.years))
  const interval = Math.max(1, Math.floor(options?.snapshotInterval ?? HISTORY_DEFAULTS.snapshotInterval))
  const snapshotCount = Math.floor(years / interval) + 1
  const seed = world.seed

  const terrain = buildTerrain(world)
  const weather = createWeather(world, createRng(seed, 'history-weather'))
  const s = createState(world, terrain, weather.region, weather.regionCount, createRng(seed, 'history-migration'), createRng(seed, 'history-structures'))
  const search = createSearch(terrain.cellCount)
  const N = terrain.cellCount
  const scratch = new Float64Array(N)
  const portSearch = createPortSearch(N)
  const voyages = createVoyages(s, createRng(seed, 'history-voyages'))

  // Land snapshots: fixed size, written in place.
  const landInterval = HISTORY_DEFAULTS.landInterval
  const landSnapshotCount = Math.floor(years / landInterval) + 1
  const landUse = new Uint8Array(landSnapshotCount * N)
  const degradation = new Uint8Array(landSnapshotCount * N)
  const road = new Uint8Array(landSnapshotCount * N)
  const trade = createTrade(N)
  const landSnapshot = (q: number): void => {
    const cells = terrain.landCells
    const o = q * N
    for (let t = 0; t < cells.length; t++) {
      const j = cells[t]
      landUse[o + j] = (s.landUse[j] * 255 + 0.5) | 0
      degradation[o + j] = (s.degradation[j] * 255 + 0.5) | 0
    }
    for (let t = 0; t < trade.roadCount; t++) {
      const j = trade.roadCells[t]
      road[o + j] = (s.road[j] * 255 + 0.5) | 0
    }
  }

  // Snapshots are ragged while the run is going (settlement count grows):
  // snapshot k holds ids [0, snapCount[k]) starting at snapOff[k].
  let snapPop = new Float32Array(4096)
  let snapFood = new Float32Array(4096)
  let snapWealth = new Float32Array(4096)
  const snapOff = new Int32Array(snapshotCount)
  const snapCount = new Int32Array(snapshotCount)
  let used = 0
  let k = 0
  const snapshot = (): void => {
    const n = s.count
    snapPop = ensure(snapPop, used + n)
    snapFood = ensure(snapFood, used + n)
    snapWealth = ensure(snapWealth, used + n)
    for (let id = 0; id < n; id++) {
      snapPop[used + id] = s.pop[id]
      snapFood[used + id] = s.food[id]
      snapWealth[used + id] = s.wealth[id]
    }
    snapOff[k] = used
    snapCount[k] = n
    used += n
    k++
  }
  // Trade snapshots, ragged the same way over route ids.
  const tradeInterval = HISTORY_DEFAULTS.tradeInterval
  const tradeSnapshotCount = Math.floor(years / tradeInterval) + 1
  let snapVol = new Float32Array(4096)
  const volOff = new Int32Array(tradeSnapshotCount)
  const volCount = new Int32Array(tradeSnapshotCount)
  const goodVolume = new Float64Array(tradeSnapshotCount * GOOD_COUNT)
  let volUsed = 0
  const tradeSnapshot = (q: number): void => {
    const n = trade.routeCount
    snapVol = ensure(snapVol, volUsed + n)
    for (let r = 0; r < n; r++) snapVol[volUsed + r] = trade.rOpen[r] ? trade.rVol[r] : 0
    volOff[q] = volUsed
    volCount[q] = n
    volUsed += n
    for (let g = 0; g < GOOD_COUNT; g++) goodVolume[q * GOOD_COUNT + g] = trade.goodYear[g]
  }

  s.year = 0
  productivitySystem(s)
  seedTribes(s, createRng(seed, 'history-tribes'))
  snapshot()
  landSnapshot(0)
  tradeSnapshot(0)
  for (let year = 1; year <= years; year++) {
    s.year = year
    s.landYear = year % LAND.step === 0
    productivitySystem(s)
    weatherSystem(s, weather)
    foodSystem(s)
    tradeSystem(s, trade)
    populationSystem(s)
    migrationSystem(s, search)
    voyageSystem(s, voyages)
    abandonmentSystem(s)
    tradeAbandonSystem(s, trade)
    structureSystem(s, scratch, portSearch)
    if (s.landYear) {
      landUseSystem(s)
      degradationSystem(s)
    }
    if (year % ROAD.step === 0) roadSystem(s, trade)
    milestoneSystem(s)
    if (year % interval === 0) snapshot()
    if (year % landInterval === 0) landSnapshot(year / landInterval)
    if (year % tradeInterval === 0) tradeSnapshot(year / tradeInterval)
    if (probe) probe(s, trade)
  }

  const S = s.count
  const population = new Float32Array(snapshotCount * S)
  const food = new Float32Array(snapshotCount * S)
  const wealth = new Float32Array(snapshotCount * S)
  for (let q = 0; q < snapshotCount; q++) {
    population.set(snapPop.subarray(snapOff[q], snapOff[q] + snapCount[q]), q * S)
    food.set(snapFood.subarray(snapOff[q], snapOff[q] + snapCount[q]), q * S)
    wealth.set(snapWealth.subarray(snapOff[q], snapOff[q] + snapCount[q]), q * S)
  }
  const routes = assembleTrade(trade)
  const RC = routes.count
  const tradeVolume = new Float32Array(tradeSnapshotCount * RC)
  for (let q = 0; q < tradeSnapshotCount; q++) tradeVolume.set(snapVol.subarray(volOff[q], volOff[q] + volCount[q]), q * RC)
  const through = new Float64Array(S)
  for (let id = 0; id < S; id++) through[id] = s.through[id]
  const settlements: Settlement[] = []
  for (let id = 0; id < S; id++) {
    settlements.push({ id, cell: s.cell[id], foundedYear: s.founded[id], parent: s.parent[id], abandonedYear: s.abandoned[id], name: '' })
  }
  const names = nameSettlements(world, settlements)
  for (let id = 0; id < S; id++) settlements[id].name = names[id]
  const capacity = new Float32Array(terrain.cellCount)
  for (let i = 0; i < terrain.cellCount; i++) capacity[i] = terrain.capacity[i]
  const journeys = assembleJourneys(s.journeys)

  return {
    history: {
      years, snapshotInterval: interval, snapshotCount, settlements, population, food, capacity, events: s.events, journeys,
      structures: s.structures, landInterval, landSnapshotCount, landUse, degradation, road, wealth,
      trade: routes, tradeInterval, tradeSnapshotCount, tradeVolume,
    },
    terrain,
    diag: { goodVolume, through, voyages: voyages.log },
  }
}

export const simulateHistory: SimulateHistory = (world, options) => runHistory(world, options).history
