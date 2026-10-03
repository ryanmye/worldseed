// Settlement history: a deterministic yearly simulation of population, food,
// migration and new settlements on top of a generated World, precomputed for
// the whole run with periodic snapshots.
//
// Each year runs a fixed sequence of small systems over shared state:
//   productivity -> weather -> food -> trade -> population -> migration
//   -> voyages -> abandonment (-> routes of the abandoned close) -> structures
//   -> [land use -> degradation] -> [roads] -> milestones -> knowledge -> snapshots
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
// Peoples (peoples.ts): the founding tribes live in a few separate cradles
// over the world's continents; each founds a people, and every settlement
// belongs to its founder's people. What each people knows of the world and
// whom it has met (knowledge.ts) limits where its groups migrate, sail and
// trade; peoples in contact share what they know.
//
// Random streams (all derived from world.seed): 'history-cradles' (where the
// cradles and tribes are), 'history-weather' (fixed draws per year,
// independent of what people do), 'history-migration' (who leaves, where they
// go), 'history-voyages' (voyages of settlement by sea: who sails, where to,
// who is lost; voyages.ts) and 'history-structures' (when ports and dams get
// built); 'history-ore' seeds the ore-richness noise; people names come from
// 'names-people-<founder>' (peoples.ts). Knowledge and contact draw nothing.
// The sim uses only + - * / and sqrt (and floor), so output is bit-identical
// across engines. Nothing depends on the run's length: a longer run repeats a
// shorter one exactly up to its end.
//
// History.capacity is the base carrying capacity at productivity 1 (year 0);
// the effective capacity in year y is roughly capacity * productivityAt(y)
// (about 4x by year 2000, easing off after it), lowered by degradation and raised by irrigation
// (land.ts, structures.ts), and raised by wealth and trade (trade.ts: rich
// hubs get more from their land and import food).

import { GOOD_COUNT } from '../../contract.ts'
import type { History, HistoryOptions, Journeys, Settlement, SimulateHistory, World } from '../../contract.ts'
import { createRng } from '../rng.ts'
import { nameSettlementsDetailed } from '../names/index.ts'
import { nameFeatures } from '../names/featureNames.ts'
import { createSearch, migrationSystem } from './migration.ts'
import { degradationSystem, landUseSystem } from './land.ts'
import { HISTORY_DEFAULTS, LAND, ROAD } from './params.ts'
import { abandonmentSystem, foodSystem, milestoneSystem, populationSystem, productivitySystem } from './population.ts'
import { createPortSearch, structureSystem } from './structures.ts'
import type { HistoryState } from './state.ts'
import { createState } from './state.ts'
import { knowledgeSystem } from './knowledge.ts'
import type { CradlePlan } from './peoples.ts'
import { namePeoples, seedPeoples } from './peoples.ts'
import { buildTerrain } from './terrain.ts'
import type { Terrain } from './terrain.ts'
import { createWeather, weatherSystem } from './weather.ts'
import { createVoyages, voyageSystem } from './voyages.ts'
import { assembleTrade, createTrade, roadSystem, tradeAbandonSystem, tradeSystem } from './trade.ts'
import type { TradeState } from './trade.ts'

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
  /** The founding plan: tribe cells and their cradles. */
  cradles?: CradlePlan
  /** How often knowledge changed a decision (only when runHistory is asked to measure it). */
  knowledge?: KnowledgeDiag
  /** How each pair of peoples first met (knowledge.ts ContactVia), -1 if never: contactVia[a * P + b]. */
  contactVia?: Int8Array
}

/**
 * Decisions knowledge changed, measured by shadow decisions without randomness (runHistory with
 * measureKnowledge): the same choice made from what the people knows and from full knowledge.
 */
export interface KnowledgeDiag {
  /** Migration searches; of them, those where the no-jitter best destination differs (redirected) or exists only with full knowledge (blocked). */
  migrations: number
  migRedirected: number
  migBlocked: number
  /** Migration searches whose reach was cut short by the edge of what their people knew (unknown cells within the budget). */
  migFrontier: number
  /** Trade partner searches (one per trader per link rebuild), partners chosen with full knowledge, and of those not chosen from what the people knows. */
  tradeSearches: number
  tradePartners: number
  tradeLost: number
  /** Voyages, and those whose known-open-land target differs from what the old per-landmass rule (anyone's discoveries) would give. */
  voyages: number
  voyTargetDiffers: number
  /** Voyage searches that sighted a settlement of a people not yet met. */
  voySightings: number
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
export function runHistory(world: World, options?: HistoryOptions, probe?: (s: HistoryState, t: TradeState) => void, measureKnowledge = false): HistoryRun {
  // (At most 32767: knownYear and contactYear store years as Int16.)
  const years = Math.min(32767, Math.max(0, Math.floor(options?.years ?? HISTORY_DEFAULTS.years)))
  const interval = Math.max(1, Math.floor(options?.snapshotInterval ?? HISTORY_DEFAULTS.snapshotInterval))
  const snapshotCount = Math.floor(years / interval) + 1
  const seed = world.seed

  const terrain = buildTerrain(world)
  const weather = createWeather(world, createRng(seed, 'history-weather'))
  const s = createState(world, terrain, weather.region, weather.regionCount, createRng(seed, 'history-migration'), createRng(seed, 'history-structures'))
  const search = createSearch(terrain.cellCount, terrain.cellScale)
  const N = terrain.cellCount
  const scratch = new Float64Array(N)
  const portSearch = createPortSearch(N)
  if (measureKnowledge) s.knowDiag = { migrations: 0, migRedirected: 0, migBlocked: 0, migFrontier: 0, tradeSearches: 0, tradePartners: 0, tradeLost: 0, voyages: 0, voyTargetDiffers: 0, voySightings: 0 }
  s.year = 0
  productivitySystem(s)
  const cradles = seedPeoples(s, createRng(seed, 'history-cradles'))
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
    knowledgeSystem(s)
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
    settlements.push({ id, cell: s.cell[id], foundedYear: s.founded[id], parent: s.parent[id], abandonedYear: s.abandoned[id], name: '', people: s.people[id] })
  }
  const naming = nameSettlementsDetailed(world, settlements)
  for (let id = 0; id < S; id++) settlements[id].name = naming.names[id]
  const features = nameFeatures(world, settlements) // named geography (names/featureNames.ts)
  const peoples = namePeoples(world, s.founders, naming)
  const capacity = new Float32Array(terrain.cellCount)
  for (let i = 0; i < terrain.cellCount; i++) capacity[i] = terrain.capacity[i]
  const journeys = assembleJourneys(s.journeys)

  return {
    history: {
      years, snapshotInterval: interval, snapshotCount, settlements, population, food, capacity, events: s.events, journeys,
      structures: s.structures, landInterval, landSnapshotCount, landUse, degradation, road, wealth,
      trade: routes, tradeInterval, tradeSnapshotCount, tradeVolume,
      features, peoples,
      knownYear: s.know.known, // (allocated for this run: owns its buffer)
      contactYear: s.know.contact,
    },
    terrain,
    diag: { goodVolume, through, voyages: voyages.log, cradles, knowledge: s.knowDiag ?? undefined, contactVia: s.know.via },
  }
}

export const simulateHistory: SimulateHistory = (world, options) => runHistory(world, options).history
