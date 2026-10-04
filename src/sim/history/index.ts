// Settlement history: a deterministic yearly simulation of population, food,
// migration and new settlements on top of a generated World, precomputed for
// the whole run with periodic snapshots.
//
// Each year runs a fixed sequence of small systems over shared state:
//   weather -> food -> trade -> population -> migration
//   -> voyages -> abandonment (-> routes of the abandoned close) -> structures
//   -> [land use -> degradation] -> [roads] -> milestones -> exploration
//   -> technology -> knowledge -> snapshots
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
// trade; peoples in contact share what they know. Each people has its own
// technology in four fields (technology.ts), grown from its own activity and
// learned from the peoples it has met; every effect of technology reads the
// settlement's people's level. Prosperous settlements send expeditions to the
// edge of their people's known world and found expedition bases where nobody
// could farm (exploration.ts).
//
// Random streams (all derived from world.seed): 'history-cradles' (where the
// cradles and tribes are), 'history-weather' (fixed draws per year,
// independent of what people do), 'history-migration' (who leaves, where they
// go), 'history-voyages' (voyages of settlement by sea: who sails, where to,
// who is lost; voyages.ts), 'history-structures' (when ports and dams get
// built) and 'history-expeditions' (who explores, where, who is lost, where
// bases go; exploration.ts); 'history-ore' seeds the ore-richness noise; people
// names come from 'names-people-<founder>' (peoples.ts). Knowledge, contact
// and technology draw nothing.
// The sim uses only + - * / and sqrt (and floor), so output is bit-identical
// across engines. Nothing depends on the run's length: a longer run repeats a
// shorter one exactly up to its end.
//
// History.capacity is the base carrying capacity at productivity 1 (year 0);
// the effective capacity of a settlement's land is roughly capacity times its
// people's Farming level (History.technology; for a typical people about 4x by
// year 2000, easing off after it), lowered by degradation and raised by irrigation
// (land.ts, structures.ts), and raised by wealth and trade (trade.ts: rich
// hubs get more from their land and import food).

import { GOOD_COUNT, TECH_FIELD_COUNT } from '../../contract.ts'
import type { GeoFeature, History, HistoryEvent, HistoryOptions, Journeys, Settlement, SimulateHistory, World } from '../../contract.ts'
import { createRng } from '../rng.ts'
import { nameWorld } from '../names/featureNames.ts'
import { createSearch, migrationSystem } from './migration.ts'
import { degradationSystem, landUseSystem } from './land.ts'
import { HISTORY_DEFAULTS, LAND, ROAD } from './params.ts'
import { abandonmentSystem, foodSystem, milestoneSystem, populationSystem } from './population.ts'
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
import { createTech, technologySystem } from './technology.ts'
import { createExplore, explorationSystem } from './exploration.ts'
import { Place } from './exploration.ts'
import type { ExpeditionLog } from './exploration.ts'
import { detectFeatures } from '../names/features.ts'
import type { FeatureMap } from '../names/features.ts'
import type { TechState } from './technology.ts'

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
  /** First year each people learned technology from each other people (diffusion), -1 if never: firstLearn[learner * P + teacher]. */
  firstLearn?: Int16Array
  /** Smoothed trade volume between peoples at the end, [a * P + b]; 1 where settlements of the two have seen each other. */
  peopleVolume?: Float64Array
  near?: Uint8Array
  /** Every expedition that set out (exploration.ts), in order; searches made for one, and those that found nothing worth the trip. */
  expeditions?: ExpeditionLog
  expSearches?: number
  expFruitless?: number
  /** Discovery events in order: place kind (exploration.ts Place) and cell. */
  discoveryKind?: number[]
  discoveryCell?: number[]
  /** Year an expedition first revealed each cell nobody knew before, -1 otherwise. */
  revealed?: Int16Array
}

function copyLog(l: ExpeditionLog): ExpeditionLog {
  return { year: l.year.slice(), from: l.from.slice(), senderPop: l.senderPop.slice(), senderWealth: l.senderWealth.slice(), senderProsperity: l.senderProsperity.slice(), sea: l.sea.slice(), outcome: l.outcome.slice(), cells: l.cells.slice(), far: l.far.slice(), tech: l.tech.slice() }
}

/**
 * The events, with each Discovery's value set to the named feature it reached (the landmass, the mountain range
 * of the summit, the desert), if that feature had a name by the year of the discovery, else -1 (always for a pole).
 * Features named by a year keep their ids in longer runs, so this never depends on the run's length.
 */
function discoveryEvents(events: HistoryEvent[], at: number[], kind: number[], cell: number[], features: GeoFeature[], map: FeatureMap): HistoryEvent[] {
  const out = events.slice()
  if (at.length === 0) return out
  const byAnchor = new Map<string, number>()
  for (const f of features) byAnchor.set(f.kind + ':' + f.anchorCell, f.id)
  for (let i = 0; i < at.length; i++) {
    const e = events[at[i]]
    const c = cell[i]
    const det = kind[i] === Place.Landmass ? map.land[c] : kind[i] === Place.Summit ? map.relief[c] : kind[i] === Place.Desert ? map.cover[c] : -1
    let value = -1
    if (det >= 0) {
      const d = map.features[det]
      const id = byAnchor.get(d.kind + ':' + d.anchorCell)
      if (id !== undefined && features[id].namedYear <= e.year) value = id
    }
    out[at[i]] = { year: e.year, type: e.type, settlement: e.settlement, other: e.other, value }
  }
  return out
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

/** Grows a Uint8 buffer to hold `need` bytes, keeping its contents. */
function ensureU8(a: Uint8Array<ArrayBuffer>, need: number): Uint8Array<ArrayBuffer> {
  if (need <= a.length) return a
  let size = Math.max(1, a.length)
  while (size < need) size *= 2
  const b = new Uint8Array(size)
  b.set(a)
  return b
}

/** A history run that can be continued: the state at the end of the years simulated so far. */
export interface HistoryRunner {
  /** Last year simulated. */
  readonly year: number
  /** Simulates up to `years` (no earlier than `year`) and assembles everything up to then; the run can go on afterwards. */
  advance(years: number): HistoryRun
}

/**
 * Starts a run (year 0: the tribes founded) that can be advanced year by year. Advancing to year Y
 * gives exactly what a from-scratch run of Y years gives: nothing in a year depends on how long the
 * run will be, and assembling a History copies everything out of the state, which goes on unchanged.
 * `probe`, if given, is called with the internal state at the end of every year (tuning only; it must not modify anything).
 */
export function createRunner(world: World, options?: HistoryOptions, probe?: (s: HistoryState, t: TradeState, k: TechState) => void, measureKnowledge = false): HistoryRunner {
  const interval = Math.max(1, Math.floor(options?.snapshotInterval ?? HISTORY_DEFAULTS.snapshotInterval))
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
  const cradles = seedPeoples(s, createRng(seed, 'history-cradles'))
  const voyages = createVoyages(s, createRng(seed, 'history-voyages'))
  const trade = createTrade(N)
  const techState = createTech(s)
  const explore = createExplore(s, createRng(seed, 'history-expeditions'))
  const P = s.know.P

  // Land snapshots (Uint8 per cell), growing with the run: snapshot q at q * N.
  const landInterval = HISTORY_DEFAULTS.landInterval
  let landUse = new Uint8Array(16 * N)
  let degradation = new Uint8Array(16 * N)
  let road = new Uint8Array(16 * N)
  let landCount = 0
  const landSnapshot = (): void => {
    const q = landCount++
    landUse = ensureU8(landUse, landCount * N)
    degradation = ensureU8(degradation, landCount * N)
    road = ensureU8(road, landCount * N)
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
  const snapOff: number[] = []
  const snapCount: number[] = []
  let used = 0
  // Technology: P * TECH_FIELD_COUNT per snapshot (the people count is fixed), 0 for a people that died out.
  const PF = P * TECH_FIELD_COUNT
  let snapTech = new Float32Array(Math.max(1, 64 * PF))
  let techUsed = 0
  const peopleAlive = new Uint8Array(P)
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
    snapOff.push(used)
    snapCount.push(n)
    used += n
    snapTech = ensure(snapTech, techUsed + PF)
    peopleAlive.fill(0)
    for (let t = 0; t < s.living.length; t++) peopleAlive[s.people[s.living[t]]] = 1
    for (let i = 0; i < PF; i++) snapTech[techUsed + i] = peopleAlive[(i / TECH_FIELD_COUNT) | 0] ? s.tech[i] : 0
    techUsed += PF
  }
  // Trade snapshots, ragged the same way over route ids.
  const tradeInterval = HISTORY_DEFAULTS.tradeInterval
  let snapVol = new Float32Array(4096)
  const volOff: number[] = []
  const volCount: number[] = []
  const goodVolume: number[] = []
  let volUsed = 0
  const tradeSnapshot = (): void => {
    const n = trade.routeCount
    snapVol = ensure(snapVol, volUsed + n)
    for (let r = 0; r < n; r++) snapVol[volUsed + r] = trade.rOpen[r] ? trade.rVol[r] : 0
    volOff.push(volUsed)
    volCount.push(n)
    volUsed += n
    for (let g = 0; g < GOOD_COUNT; g++) goodVolume.push(trade.goodYear[g])
  }

  snapshot()
  landSnapshot()
  tradeSnapshot()
  const step = (year: number): void => {
    s.year = year
    s.landYear = year % LAND.step === 0
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
    explorationSystem(s, explore)
    technologySystem(s, trade, techState)
    knowledgeSystem(s)
    if (year % interval === 0) snapshot()
    if (year % landInterval === 0) landSnapshot()
    if (year % tradeInterval === 0) tradeSnapshot()
    if (probe) probe(s, trade, techState)
  }

  /** Everything up to year `years` (the year just simulated), copied out of the state. */
  const assemble = (years: number): HistoryRun => {
    const snapshotCount = Math.floor(years / interval) + 1
    const landSnapshotCount = Math.floor(years / landInterval) + 1
    const tradeSnapshotCount = Math.floor(years / tradeInterval) + 1
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
      settlements.push({ id, cell: s.cell[id], foundedYear: s.founded[id], parent: s.parent[id], abandonedYear: s.abandoned[id], name: '', people: s.people[id], outpost: s.outpost[id] === 1 })
    }
    // Settlement names and named geography, in the order things are founded and reached (names/featureNames.ts).
    const featureMap = detectFeatures(world)
    const { names, features, naming } = nameWorld(world, settlements, featureMap)
    for (let id = 0; id < S; id++) settlements[id].name = names[id]
    const peoples = namePeoples(world, s.founders, cradles.cradle, naming, names)
    const capacity = new Float32Array(terrain.cellCount)
    for (let i = 0; i < terrain.cellCount; i++) capacity[i] = terrain.capacity[i]
    const journeys = assembleJourneys(s.journeys)
    const log = voyages.log
    return {
      history: {
        years, snapshotInterval: interval, snapshotCount, settlements, population, food, capacity,
        events: discoveryEvents(s.events, explore.discEvent, explore.discKind, explore.discCell, features, featureMap), journeys,
        structures: s.structures.map((x) => ({ ...x })), // (later years may still mark them lost)
        landInterval, landSnapshotCount,
        landUse: landUse.slice(0, landSnapshotCount * N), degradation: degradation.slice(0, landSnapshotCount * N), road: road.slice(0, landSnapshotCount * N),
        wealth, trade: routes, tradeInterval, tradeSnapshotCount, tradeVolume,
        features, peoples,
        knownYear: s.know.known.slice(),
        contactYear: s.know.contact.slice(),
        technology: snapTech.slice(0, snapshotCount * PF),
      },
      terrain,
      diag: {
        goodVolume: Float64Array.from(goodVolume.slice(0, tradeSnapshotCount * GOOD_COUNT)), through,
        voyages: { year: log.year.slice(), from: log.from.slice(), outcome: log.outcome.slice(), port: log.port.slice(), senderPop: log.senderPop.slice(), cost: log.cost.slice(), seaCells: log.seaCells.slice(), toLandmass: log.toLandmass.slice(), visits: log.visits.slice() },
        cradles, knowledge: s.knowDiag ? { ...s.knowDiag } : undefined, contactVia: s.know.via.slice(),
        firstLearn: techState.firstLearn.slice(), peopleVolume: techState.pairVol.slice(), near: s.know.near.slice(),
        expeditions: copyLog(explore.log), expSearches: explore.searches, expFruitless: explore.fruitless, discoveryKind: explore.discKind.slice(), discoveryCell: explore.discCell.slice(), revealed: explore.revealed.slice(),
      },
    }
  }

  let year = 0
  return {
    get year() { return year },
    advance(years: number): HistoryRun {
      // (At most 32767: knownYear and contactYear store years as Int16.)
      const target = Math.min(32767, Math.max(0, Math.floor(years)))
      if (target < year) throw new RangeError(`history run is at year ${year}; cannot go back to ${target}`)
      for (let y = year + 1; y <= target; y++) step(y)
      year = target
      return assemble(year)
    },
  }
}

/** Runs the simulation and also returns the internal terrain and diagnostics (for the stats harness); see createRunner for `probe`. */
export function runHistory(world: World, options?: HistoryOptions, probe?: (s: HistoryState, t: TradeState, k: TechState) => void, measureKnowledge = false): HistoryRun {
  return createRunner(world, options, probe, measureKnowledge).advance(options?.years ?? HISTORY_DEFAULTS.years)
}

export const simulateHistory: SimulateHistory = (world, options) => runHistory(world, options).history

/**
 * A history that can be extended: `advanceTo(years)` simulates only the years after the last call
 * and returns the History of years 0..years, identical to `simulateHistory(world, { ...options, years })`
 * (options.years is ignored here). Each returned History owns all its arrays (they may be transferred).
 * Going back to fewer years than already simulated runs that history from scratch.
 */
export function createHistoryRun(world: World, options?: HistoryOptions): { readonly year: number; advanceTo(years: number): History } {
  const runner = createRunner(world, options)
  return {
    get year() { return runner.year },
    advanceTo(years: number): History {
      const target = Math.min(32767, Math.max(0, Math.floor(years)))
      if (target < runner.year) return simulateHistory(world, { ...options, years: target })
      return runner.advance(target).history
    },
  }
}
