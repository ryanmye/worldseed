// Settlement history: a deterministic yearly simulation of population, food,
// migration and new settlements on top of a generated World, precomputed for
// the whole run with periodic snapshots.
//
// Each year runs a fixed sequence of small systems over shared state:
//   weather -> food -> trade -> [polities: grain tax] -> population -> migration
//   -> voyages -> abandonment (-> routes of the abandoned close) -> [polities] -> structures
//   -> [land use -> degradation] -> [roads] -> milestones -> exploration
//   -> technology -> knowledge -> knowledge spread -> species -> snapshots
// (land use and degradation advance every LAND.step years, roads every
// ROAD.step years; in land
// years the food system also records which fields feed each settlement). The
// trade system (trade.ts) rebuilds its link graph every TRADE.linkStep years
// and runs the market every year between the harvest and the population
// system, so imports feed people the year they arrive. Land snapshots (Uint8
// use, degradation and road per cell) are taken every landInterval years,
// trade-volume snapshots every tradeInterval years.
// Polities (polity/system.ts; HistoryOptions.polities, on by default) form states, borders, war,
// raids, danger and revolts; switched off, the history is exactly the one without them.
//
// Peoples (peoples.ts): the founding tribes live in a few separate cradles
// over the world's continents; each founds a people, and every settlement
// belongs to its founder's people. What each people knows of the world and
// whom it has met (knowledge.ts) limits where its groups migrate, sail and
// trade; peoples in contact learn what the other knows, gradually (knowledgeSpread.ts). Each people has its own
// technology in four fields (technology.ts), grown from its own activity and
// learned from the peoples it has met; every effect of technology reads the
// settlement's people's level. Prosperous settlements send expeditions to the
// edge of their people's known world and found expedition bases where nobody
// could farm (exploration.ts). Each cradle starts with its own few species
// (staples and herds native there; others are wild elsewhere), which multiply
// what its land yields and spread through colonisation, contact and trade
// (species.ts); first contact may bring epidemics.
//
// Random streams (all derived from world.seed): 'history-cradles' (where the
// cradles and tribes are), 'history-weather' (fixed draws per year,
// independent of what people do), 'history-migration' (who leaves, where they
// go), 'history-voyages' (voyages of settlement by sea: who sails, where to,
// who is lost; voyages.ts), 'history-structures' (when ports and dams get
// built) and 'history-expeditions' (who explores, where, who is lost, where
// bases go; exploration.ts), 'history-frontier' (which land groups go far,
// and whether a group stops at a town it passes; frontier.ts),
// 'history-species-origins' (where species are
// native, the cradles' founding sets) and 'history-species-spread' (taming,
// adoption, techniques, what seaborne colonies carry; species.ts),
// 'history-polities' and 'history-war' (states, raids, revolts, successions; battles, sacks; polity/);
// 'history-ore' seeds the ore-richness noise; people names come from
// 'names-people-<founder>' (peoples.ts), species names from
// 'names-species-<id>'. Knowledge, contact and technology draw nothing.
// species-v2: after the species system, speciesV2.ts runs cash crops, habit,
// storage, blight and techniques ('history-species-hazard' for blight and
// livestock plague, 'history-species-techniques' for techniques found;
// technique names from 'names-technique-<id>').
// disease (HistoryOptions.disease, on by default; disease/): at the end of each year, after the goods system, epidemics spread
// over trade routes, legs, neighbours, kin and the year's journeys, endemic crowd diseases and fever take a steady toll; a first
// contact passes the peoples' crowd diseases (the species system's contact epidemic is then this system's). Streams
// 'history-disease-pool' (the world's diseases, plague reservoirs) and 'history-disease' (everything else); disease names
// from 'names-disease-<id>'. Switched off, the history is exactly the one without it.
// rulers (rulers/; HistoryOptions.rulers, needs polities): named rulers, heirs, successions, houses, marriages and
// unions, from 'history-rulers' (names from 'names-house-<id>', 'names-ruler-<id>' and endings per language).
// landmarks (landmarks/; HistoryOptions.landmarks): castles, palaces, temples and the other great buildings, the towns'
// temples and shrines, raised, neglected, ruined, restored and rededicated as a consequence of history, at the very end of
// the year (after renaming), from 'history-landmarks' (faith traditions from 'landmarks-faith-<id>', names from
// 'names-landmark-<id>'). A pure consequence layer: on or off, every other field is the same.
// religion (religion/; HistoryOptions.religion): faiths, spread, conversion, churches, schism, persecution and holy war,
// from 'history-religion', at the end of the year before the snapshots (names from 'names-faith-<id>').
// tourism (tourism/; HistoryOptions.tourism): scenery, sights, leisure travel and resort towns, from
// 'history-tourism-springs' and 'history-tourism'; resorts buy their food after the tax (tourismProvision) and visitors
// wear roads before the road system.
// The year's end runs goods, then tourism, then disease, then religion, then one milestone pass (refugees from sickness and
// persecution). Tourism comes before disease so the year's visitors (tz.fFrom/fTo/fVis) carry sickness the same year
// (DiseaseVia.Visitors); religion after disease so a town struck hard is a woe for religion the same year, and its
// pilgrims (rel.pilgrims, read by tourismExtraScores) feed next year's destinations. An epidemic at a capital may take
// its ruler and heirs (disease/system.ts strike), which the rulers system (in politySystem) enacts the next year.
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
import type { GeoFeature, History, HistoryEvent, HistoryOptions, HistoryRun as HistoryRunContract, Journeys, Settlement, SimulateHistory, World } from '../../contract.ts'
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
import { knowledgeSpreadSystem } from './knowledgeSpread.ts' // gradual-knowledge:
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
import { assembleSpecies, createSpecies, speciesLandSnapshot, speciesSystem, speciesTables } from './species.ts'
import { assembleV2, createSpeciesV2, speciesV2Snapshot, speciesV2System, v2Diag } from './speciesV2.ts' // species-v2
import type { SpeciesV2Diag } from './speciesV2.ts' // species-v2
import { Place } from './exploration.ts'
import type { ExpeditionLog } from './exploration.ts'
import { detectFeatures } from '../names/features.ts'
import type { FeatureMap } from '../names/features.ts'
import type { TechState } from './technology.ts'
// polities:
import { POLITY } from './polity/params.ts'
import { createPolitySystem, politySystem, taxSystem } from './polity/system.ts'
import { assemblePolityHistory, createSnaps, emptyPolityHistory, polLandSnapshot, polSnapshot, polTradeSnapshot } from './polity/assemble.ts'
import type { PolityDiag } from './polity/state.ts'
// goods: worked goods, specialities, stocks and merchants, long-haul trade, posts, secrets, smuggling (goods/).
import { GOODS_ON } from './goods/params.ts'
import { createGoodsSystem, goodsProduce, goodsYear } from './goods/system.ts'
import { assembleGoods, emptyGoodsHistory, goodsSnapshot } from './goods/assemble.ts'
import type { GoodsDiag } from './goods/state.ts'
import { assembleMerchants, merchantSnapshot } from './goods/merchants.ts' // goods: merchant capital
// disease: epidemics, endemic crowd diseases, plague, camp fever and place-bound fever (disease/).
import { DISEASE_ON } from './disease/params.ts'
import { createDisease } from './disease/state.ts'
import type { DiseaseDiag, DiseaseState } from './disease/state.ts'
import { diseaseSnapshot, diseaseSystem } from './disease/system.ts'
import { assembleDisease, emptyDiseaseHistory } from './disease/assemble.ts'
// rulers: named rulers, houses, successions, marriages and unions (rulers/).
import { RULERS } from './rulers/params.ts'
import { createRulers } from './rulers/state.ts'
import type { RulerDiag } from './rulers/state.ts'
import { assembleRulers, emptyRulerHistory } from './rulers/assemble.ts'
// religion: faiths, conversion, state churches, schism, persecution, holy war (religion/).
import { RELIGION } from './religion/params.ts'
import { createReligionSystem, religionSnapshot, religionYear } from './religion/system.ts'
import type { ReligionDiag } from './religion/state.ts'
import { assembleReligion, emptyReligionHistory } from './religion/assemble.ts'
// tourism: scenery, sights, leisure travel and resort towns (tourism/).
import { TOURISM_ON } from './tourism/params.ts'
import { createTourism } from './tourism/state.ts'
import type { TourismDiag } from './tourism/state.ts'
import { tourismProvision, tourismRoads, tourismSnapshot, tourismYear } from './tourism/system.ts'
import { assembleTourism, emptyTourismHistory } from './tourism/assemble.ts'
// renaming: places renamed by history (renaming/).
import { RENAMING_ON } from './renaming/params.ts'
import { createRenaming, renamingYear } from './renaming/system.ts'
import type { RenamingDiag } from './renaming/state.ts'
import { assembleRenamings, emptyRenamingHistory, weaveEvents } from './renaming/assemble.ts'
// ideas: inventions and practices, carried by trade (ideas/).
import { IDEAS_ON } from './ideas/params.ts'
import { createIdeasSystem, ideasYear } from './ideas/system.ts'
import type { IdeasDiag } from './ideas/state.ts'
import { assembleIdeas, emptyIdeasHistory } from './ideas/assemble.ts'
// landmarks: great buildings and houses of worship raised by history (landmarks/).
import { LANDMARKS_ON } from './landmarks/params.ts'
import { createLandmarks, landmarksYear } from './landmarks/system.ts'
import type { LandmarksDiag } from './landmarks/state.ts'
import { assembleLandmarks, emptyLandmarkHistory } from './landmarks/assemble.ts'

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
  /** Species: founding set of each cradle (species ids); first year each people held each technique (-1), techYear[p * K + k]. */
  cradleSets?: number[][]
  techYear?: Int16Array
  /** Technique acquisitions: (year, people, technique, settlement) flattened; epidemics: (year, victim people, source people, mortality, victim population before) flattened. */
  techLog?: number[]
  epiLog?: number[]
  /** Disease load per people at the end. */
  disease?: Float64Array
  /** species-v2: blights, plagues, drains, pellagra, drain balances, loanword names (speciesV2.ts). */
  speciesV2?: SpeciesV2Diag
  /** polities: counters of the polity system (absent when it is off). */
  polity?: PolityDiag
  /** goods: records of the goods system (absent when it is off). */
  goods?: GoodsDiag
  /** disease: the disease system's records, and its state at the end (absent when it is off; the state is the live one: read only). */
  disease2?: DiseaseDiag
  diseaseState?: DiseaseState
  /** rulers: counters of the rulers system (absent when it is off). */
  rulers?: RulerDiag
  /** religion: counters of the religion system, and the year each settlement first followed a universal faith in its majority (-1). */
  religion?: ReligionDiag & { firstUniversal: Int32Array }
  /** tourism: the tourism system's counters (absent when it is off). */
  tourism?: TourismDiag
  /** renaming: the renaming system's counters (absent when it is off). */
  renaming?: RenamingDiag
  /** ideas: the ideas system's counters (absent when it is off). */
  ideas?: IdeasDiag
  /** landmarks: the landmarks system's counters (absent when it is off). */
  landmarks?: LandmarksDiag
}

/** goods: a copy of the goods records (the run goes on). */
function copyGoodsDiag(d: GoodsDiag): GoodsDiag {
  const out = {} as Record<string, number[]>
  for (const k of Object.keys(d) as (keyof GoodsDiag)[]) out[k] = d[k].slice()
  return out as unknown as GoodsDiag
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
 * Flattens the recorded journeys into the struct-of-arrays contract shape, each array with its own buffer, in the
 * order they were recorded: every journey is recorded the year it ends (arriveYear), so the table is in order of
 * arrival and a longer run's table begins with a shorter one's exactly. (Sorted by departYear, as it was, a journey
 * that set out before a run's last year but arrived after it would come in between, re-indexing the later ones.)
 */
function assembleJourneys(records: HistoryState['journeys']): Journeys {
  const sorted = records
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
  /** Simulates up to `years` (no earlier than `year`) without assembling anything (cheap progress steps; advance assembles later). */
  simulate(years: number): void
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
  const cradles = seedPeoples(s, createRng(seed, 'history-cradles'), (plan) => {
    s.sp = createSpecies(s, plan, createRng(seed, 'history-species-origins'), createRng(seed, 'history-species-spread'))
    s.sp.v2 = createSpeciesV2(s, createRng(seed, 'history-species-hazard'), createRng(seed, 'history-species-techniques')) // species-v2
    // disease: the world's diseases, before the tribes meet (unless switched off).
    if (options?.disease ?? DISEASE_ON) s.dz = createDisease(world, terrain, weather.region, weather.regionCount, plan.cells.length, createRng(seed, 'history-disease-pool'), createRng(seed, 'history-disease'))
  })
  const dz = s.dz // disease:
  const voyages = createVoyages(s, createRng(seed, 'history-voyages'))
  const trade = createTrade(N)
  const techState = createTech(s)
  const explore = createExplore(s, createRng(seed, 'history-expeditions'))
  const P = s.know.P
  // polities: the polity system (states, war, danger), unless switched off.
  const pol = (options?.polities ?? POLITY.enabled) ? createPolitySystem(s, trade) : null
  s.pol = pol
  const polSnaps = pol ? createSnaps(pol) : null
  // goods: the goods system, unless switched off.
  const gx = (options?.goods ?? GOODS_ON) ? createGoodsSystem(s, trade) : null
  s.goods = gx
  // rulers: rulers and houses (they need the polities), unless switched off.
  const rul = pol && (options?.rulers ?? RULERS.enabled) ? createRulers(s) : null
  s.rul = rul
  // religion: faiths, unless switched off.
  const rel = (options?.religion ?? RELIGION.enabled) ? createReligionSystem(s) : null
  s.rel = rel
  // tourism: scenery and the scenic spots, unless switched off.
  const tz = (options?.tourism ?? TOURISM_ON) ? createTourism(world, terrain, P, createRng(seed, 'history-tourism-springs'), createRng(seed, 'history-tourism')) : null
  s.tz = tz
  // renaming: places renamed by history (a pure consequence layer, read-only on the rest), unless switched off.
  const rn = (options?.renaming ?? RENAMING_ON) ? createRenaming(s) : null
  // ideas: inventions and practices (they set the technology caps), unless switched off.
  const ix = (options?.ideas ?? IDEAS_ON) ? createIdeasSystem(s) : null
  s.ideas = ix
  // landmarks: great buildings and houses of worship (a pure consequence layer, read-only on the rest), unless switched off.
  const lm = (options?.landmarks ?? LANDMARKS_ON) ? createLandmarks(s) : null

  // Land snapshots (Uint8 per cell), growing with the run: snapshot q at q * N.
  const landInterval = HISTORY_DEFAULTS.landInterval
  let landUse = new Uint8Array(16 * N)
  let degradation = new Uint8Array(16 * N)
  let road = new Uint8Array(16 * N)
  let crop = new Uint8Array(16 * N)
  let herd = new Uint8Array(16 * N)
  let cash = new Uint8Array(16 * N) // species-v2
  let landCount = 0
  const landSnapshot = (): void => {
    const q = landCount++
    landUse = ensureU8(landUse, landCount * N)
    degradation = ensureU8(degradation, landCount * N)
    road = ensureU8(road, landCount * N)
    crop = ensureU8(crop, landCount * N)
    herd = ensureU8(herd, landCount * N)
    cash = ensureU8(cash, landCount * N) // species-v2
    speciesLandSnapshot(s, crop, herd, q * N, cash)
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
    if (pol && polSnaps) polLandSnapshot(s, pol, polSnaps) // polities:
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
    speciesV2Snapshot(s) // species-v2: habit, storable
    if (pol && polSnaps) polSnapshot(s, pol, polSnaps) // polities:
    if (gx) merchantSnapshot(s, gx) // goods: merchant capital
    if (dz) diseaseSnapshot(dz) // disease:
    if (rel) religionSnapshot(s, rel) // religion:
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
    if (pol && polSnaps) polTradeSnapshot(pol, trade, polSnaps) // polities: (v2) contraband and losses per route
    if (gx) goodsSnapshot(s, gx, trade) // goods:
    if (tz) tourismSnapshot(s, tz, volOff.length - 1) // tourism: visitors per pair
  }

  snapshot()
  landSnapshot()
  tradeSnapshot()
  const step = (year: number): void => {
    s.year = year
    s.landYear = year % LAND.step === 0
    weatherSystem(s, weather)
    foodSystem(s)
    if (gx) goodsProduce(s, gx, explore) // goods: mines and furs, before the market
    tradeSystem(s, trade)
    if (pol) taxSystem(s, pol) // polities: grain tax to capitals
    if (tz) tourismProvision(s, tz) // tourism: visitor income buys food for resorts and their hosts
    populationSystem(s)
    migrationSystem(s, search)
    voyageSystem(s, voyages)
    abandonmentSystem(s)
    tradeAbandonSystem(s, trade)
    if (pol) politySystem(s, pol, trade) // polities: states, war, danger
    structureSystem(s, scratch, portSearch)
    if (s.landYear) {
      landUseSystem(s)
      degradationSystem(s)
    }
    if (year % ROAD.step === 0) {
      if (tz) tourismRoads(s, tz, trade) // tourism: visitors wear their ways
      roadSystem(s, trade)
    }
    milestoneSystem(s)
    explorationSystem(s, explore)
    if (ix) ideasYear(s, ix, trade, techState) // ideas: pulses of the year; every IDEA.step years conception, learning, loss, caps
    technologySystem(s, trade, techState)
    knowledgeSystem(s)
    knowledgeSpreadSystem(s, techState) // gradual-knowledge: fronts of knowledge between peoples in contact
    speciesSystem(s, trade)
    speciesV2System(s, trade) // species-v2
    if (gx) goodsYear(s, gx, trade, techState, explore) // goods: events, lanes, posts; decadal phases
    if (tz) tourismYear(s, tz, trade, explore) // tourism: sights, destinations, leisure travel, resorts
    if (dz) diseaseSystem(s, dz, trade, techState) // disease: outbreaks spread and take their toll (visitors carry them too); endemic sickness, fever
    const fled = rel ? religionYear(s, rel, trade) : false // religion: spread, conversion, churches, schism, persecution, pilgrims, flight
    if (dz || fled) milestoneSystem(s) // disease, religion: the year's last milestone pass (refugees from struck towns and persecution may lift a town over one)
    if (rn) renamingYear(s, rn) // renaming: conquest, cession, capitals, faith, trade, restoration, revival (reads only)
    if (lm) landmarksYear(s, lm) // landmarks: works begun and finished, neglect, ruin, restoration, conversion (reads only)
    if (year % interval === 0) snapshot()
    if (year % landInterval === 0) landSnapshot()
    if (year % tradeInterval === 0) tradeSnapshot()
    if (probe) probe(s, trade, techState)
  }

  // The world's named-geography features (names/features.ts) depend on the world alone: detected once, at the first assembly.
  let featureMapCache: FeatureMap | null = null

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
      settlements.push({ id, cell: s.cell[id], foundedYear: s.founded[id], parent: s.parent[id], abandonedYear: s.abandoned[id], name: '', people: s.people[id], outpost: s.outpost[id] === 1, post: false, resort: tz !== null && id < tz.cap && tz.resort[id] === 1 })
    }
    // Settlement names and named geography, in the order things are founded and reached (names/featureNames.ts).
    const featureMap = featureMapCache ?? (featureMapCache = detectFeatures(world)) // (read only below)
    const { names, features, naming } = nameWorld(world, settlements, featureMap)
    for (let id = 0; id < S; id++) settlements[id].name = names[id]
    const peoples = namePeoples(world, s.founders, cradles.cradle, naming, names)
    const usedNames = new Set<string>() // species-v2: technique names unique among species names too
    const species = assembleSpecies(world, s.sp, naming, peoples, s.founders, (id) => s.cell[id], usedNames)
    const spT = speciesTables(s.sp)
    const v2 = assembleV2(world, s, naming, usedNames, snapshotCount, S, spT.techYear.slice(), spT.techSource) // species-v2
    const capacity = new Float32Array(terrain.cellCount)
    for (let i = 0; i < terrain.cellCount; i++) capacity[i] = terrain.capacity[i]
    const journeys = assembleJourneys(s.journeys)
    const log = voyages.log
    // polities: states, borders, wars and danger (empty when the system is off).
    const polHist = pol && polSnaps ? assemblePolityHistory(world, s, pol, polSnaps, years, snapshotCount, landSnapshotCount, tradeSnapshotCount, RC, naming, peoples.map((p) => p.name)) : emptyPolityHistory()
    // goods: (empty when the system is off); forts and stations are flagged on their settlements.
    const goodsHist = gx ? assembleGoods(gx, years, tradeSnapshotCount, S, names, peoples.map((p) => p.name)) : emptyGoodsHistory()
    for (const x of goodsHist.posts) if (x.settlement >= 0 && (x.kind === 1 || x.kind === 2)) settlements[x.settlement].post = true
    const diseaseHist = dz ? assembleDisease(world, dz, naming, peoples.map((p) => p.name), snapshotCount) : emptyDiseaseHistory() // disease:
    // rulers, religion: (empty when off).
    const rulHist = rul ? assembleRulers(world, rul, pol ? pol.P : 0, naming) : emptyRulerHistory()
    const relHist = rel ? assembleReligion(world, rel, naming, peoples.map((p) => p.name), snapshotCount, S, pol ? pol.P : 0) : emptyReligionHistory()
    const tourismHist = tz ? assembleTourism(tz, tradeSnapshotCount, names, features, featureMap) : emptyTourismHistory() // tourism:
    const ideasHist = ix ? assembleIdeas(ix) : emptyIdeasHistory() // ideas:
    const renHist = rn ? assembleRenamings(world, rn, settlements, naming, features, rulHist.rulers, rulHist.dynasties, relHist.faiths) : emptyRenamingHistory() // renaming:
    const lmHist = lm ? assembleLandmarks(world, lm, settlements, renHist.renamings, naming, rulHist.rulers, rulHist.dynasties, relHist.faiths, peoples, goodsHist.traditions) : emptyLandmarkHistory() // landmarks: (named after the renamings)
    return {
      history: {
        years, snapshotInterval: interval, snapshotCount, settlements, population, food, capacity,
        events: weaveEvents(weaveEvents(discoveryEvents(s.events, explore.discEvent, explore.discKind, explore.discCell, features, featureMap), renHist.events), lmHist.events), journeys, // (renaming: PlaceRenamed woven in; landmarks: theirs after it)
        structures: s.structures.map((x) => ({ ...x })), // (later years may still mark them lost)
        landInterval, landSnapshotCount,
        landUse: landUse.slice(0, landSnapshotCount * N), degradation: degradation.slice(0, landSnapshotCount * N), road: road.slice(0, landSnapshotCount * N),
        wealth, trade: routes, tradeInterval, tradeSnapshotCount, tradeVolume,
        features, peoples,
        knownYear: s.know.known.slice(),
        contactYear: s.know.contact.slice(),
        technology: snapTech.slice(0, snapshotCount * PF),
        species, speciesYear: spT.year, speciesSource: spT.source,
        crop: crop.slice(0, landSnapshotCount * N), herd: herd.slice(0, landSnapshotCount * N),
        cash: cash.slice(0, landSnapshotCount * N), ...v2, // species-v2
        ...polHist, // polities:
        ...goodsHist, // goods:
        merchantWealth: gx ? assembleMerchants(gx, snapshotCount, S) : new Float32Array(0), // goods: merchant capital
        ...diseaseHist, // disease:
        ...rulHist, // rulers:
        ...relHist, // religion:
        ...tourismHist, // tourism:
        renamings: renHist.renamings, // renaming:
        ...ideasHist, // ideas:
        landmarks: lmHist.landmarks, // landmarks:
      },
      terrain,
      diag: {
        goodVolume: Float64Array.from(goodVolume.slice(0, tradeSnapshotCount * GOOD_COUNT)), through,
        voyages: { year: log.year.slice(), from: log.from.slice(), outcome: log.outcome.slice(), port: log.port.slice(), senderPop: log.senderPop.slice(), cost: log.cost.slice(), seaCells: log.seaCells.slice(), toLandmass: log.toLandmass.slice(), visits: log.visits.slice() },
        cradles, knowledge: s.knowDiag ? { ...s.knowDiag } : undefined, contactVia: s.know.via.slice(),
        firstLearn: techState.firstLearn.slice(), peopleVolume: techState.pairVol.slice(), near: s.know.near.slice(),
        expeditions: copyLog(explore.log), expSearches: explore.searches, expFruitless: explore.fruitless, discoveryKind: explore.discKind.slice(), discoveryCell: explore.discCell.slice(), revealed: explore.revealed.slice(),
        cradleSets: s.sp.cradleSet.map((x) => x.slice()), techYear: spT.techYear, techLog: s.sp.techLog.slice(), epiLog: s.sp.epiLog.slice(), disease: s.sp.disease.slice(),
        speciesV2: v2Diag(s, species.map((x) => x.name), v2.techniques.map((x) => x.name), naming), // species-v2
        polity: pol ? {
          ...pol.diag, foundYear: pol.diag.foundYear.slice(), foundCellZ: pol.diag.foundCellZ.slice(), foundT: pol.diag.foundT.slice(), foundFromZ: pol.diag.foundFromZ.slice(), foundHome: pol.diag.foundHome.slice(), foundCell: pol.diag.foundCell.slice(),
          yRev: pol.diag.yRev.slice(), yCapInc: pol.diag.yCapInc.slice(), yLegal: pol.diag.yLegal.slice(), ySmug: pol.diag.ySmug.slice(), yPir: pol.diag.yPir.slice(), yBand: pol.diag.yBand.slice(), yPirates: pol.diag.yPirates.slice(),
        } : undefined, // polities:
        goods: gx ? copyGoodsDiag(gx.diag) : undefined, // goods:
        disease2: dz ? { ...dz.diag, army: dz.diag.army.slice(), spent: dz.diag.spent.slice(), epiDead: dz.diag.epiDead.slice(), endDead: dz.diag.endDead.slice(), feverDead: dz.diag.feverDead.slice() } : undefined, // disease:
        diseaseState: dz ?? undefined, // disease:
        rulers: rul ? { ...rul.diag } : undefined, // rulers:
        religion: rel ? { ...rel.diag, firstUniversal: rel.firstUni.slice(0, S) } : undefined, // religion:
        tourism: tz ? { ...tz.diag, spendDecade: tz.diag.spendDecade.slice() } : undefined, // tourism:
        renaming: rn ? { ...rn.diag } : undefined, // renaming:
        ideas: ix ? { ...ix.diag, byHow: ix.diag.byHow.slice() } : undefined, // ideas:
        landmarks: lm ? { ...lm.diag } : undefined, // landmarks:
      },
    }
  }

  let year = 0
  /** Steps the run to `years` (clamped; at most 32767: knownYear and contactYear store years as Int16). */
  const simulateTo = (years: number): void => {
    const target = Math.min(32767, Math.max(0, Math.floor(years)))
    if (target < year) throw new RangeError(`history run is at year ${year}; cannot go back to ${target}`)
    for (let y = year + 1; y <= target; y++) step(y)
    year = target
  }
  return {
    get year() { return year },
    advance(years: number): HistoryRun {
      simulateTo(years)
      return assemble(year)
    },
    simulate: simulateTo,
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
export function createHistoryRun(world: World, options?: HistoryOptions): Required<HistoryRunContract> {
  const runner = createRunner(world, options)
  return {
    get year() { return runner.year },
    advanceTo(years: number): History {
      const target = Math.min(32767, Math.max(0, Math.floor(years)))
      if (target < runner.year) return simulateHistory(world, { ...options, years: target })
      return runner.advance(target).history
    },
    simulateTo(years: number): number {
      const target = Math.min(32767, Math.max(0, Math.floor(years)))
      if (target > runner.year) runner.simulate(target)
      return runner.year
    },
  }
}
