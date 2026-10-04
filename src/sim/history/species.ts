// Species: the useful plants and animals of a world (History.species), each native to one or two places
// and spreading through colonisation, contact and trade, so whom a people has met decides what it can grow
// and herd. Technology is how well a people farms; species are what it has to farm with.
//
// Catalogue (SPECIES_TABLE): staples (yield relative to the baseline grain, labour, a climate envelope in the
// world's temperature and rainfall, conditions such as water for paddy) and livestock (pasture value, traction,
// pack transport, disease load). Fit per cell = trap(temperature) * trap(rainfall) * conditions (fitAt, speciesFit).
//
// Origins and founding sets (createSpecies, once): each cradle gets a founding set drawn among the species that
// fit its tribes' land, of unequal size (always with a staple that grows there); those species are native there.
// Every other species gets one (some two) wild origins elsewhere, preferring land no cradle holds, so expansion,
// expeditions and contact find them.
//
// Possession: each settlement holds a set of species (two 32-bit mask words; techniques use the upper bits of
// the second), inherited by its colonies (seaborne colonies carry only part of it). A people holds a species
// from the year one of its settlements first does (History.speciesYear, speciesSource).
//
// Food (cropOf): a settlement's farm part is multiplied by its crop multiplier, a weighted mean over the cells of
// its base catchment of rf + crop * mc + live * mh (river fishing, crop and livestock shares of the cell):
// mc = max(floor, best + second * second-best yield of its staples there) * (1 + traction), each staple's yield
// Y * fit * (marginal-land factor) / (Boserup labour factor), times its techniques; mh the best pasture value of
// its herds there (dairy animals more), or hunting where none fits. Normalised by SPECIES.norm, so a typical
// cradle starts at the old calibration (gains above it count at SPECIES.above). Marginal land: potato opens highlands
// and cool taiga, sorghum dry desert edges (their own agri floor; such cells are habitable, but only those who hold
// the crop judge them worth settling: siteFactor).
//
// Spread (speciesSystem, every SPECIES.spreadStep years per settlement): domestication where a settlement's fields touch
// a wild range; adoption from its links (parent and children, settlements within SPECIES.linkHops, trade partners,
// settlements of other peoples it has seen or met through: speciesSight), only where the species fits (catchment
// fit) and helps (benefit gate on the crop multiplier gain, plus range and transport for animals), slower from other
// peoples (and for their staples), faster after famine; and, slowly, anything its own people holds anywhere.
// Returning expeditions bring home species they saw (exploration.ts). The east-west pattern comes only from the
// climate envelopes: nothing here knows about latitude.
//
// Livestock: pasture (above), traction (crop yield), pack transport (trade cost), camels make desert cheap to cross
// (migration and trade), llamas mountains; horses extend migration range and sight.
//
// Techniques (TECHNIQUES; internal, not in the contract yet): early-ripening rice, crop rotation (a legume companion
// to the cereals) and the heavy plough, found by trigger, held and spread like species.
//
// Disease: herds held long and towns build a crowd-disease load per people (seeping along contacts); at first contact
// a large gap starts an epidemic among the less exposed people (capped mortality, spreading outward from the contact
// settlement), which then shares the diseases; a people suffers at most one per DISEASE.cooldown years.
//
// Draws: 'history-species-origins' (origins and founding sets), 'history-species-spread' (everything else). Names
// are given at assembly from 'names-species-<id>', in the language of the settlement that first held the species.

import { Biome, EventType, RIVER_FLOW_THRESHOLD, SpeciesCategory, TECH_FIELD_COUNT, TechField, TOWN_POPULATION } from '../../contract.ts'
import type { People, SpeciesInfo, World } from '../../contract.ts'
import type { Rng } from '../rng.ts'
import { createRng } from '../rng.ts'
import { smoothstep } from '../util.ts'
import type { SettlementNaming } from '../names/index.ts'
import { buildMorph, buildRoot, fuseWords, letterCount } from '../names/words.ts'
import { CAPACITY, CATCHMENT, CRADLE, DISEASE, SPECIES, TECHNIQUE } from './params.ts'
import type { HistoryState } from './state.ts'
import { logEvent } from './state.ts'
import type { CradlePlan } from './peoples.ts'

// ---------------------------------------------------------------------------------------------------------
// Catalogue

type Trap = readonly [number, number, number, number]

export interface SpeciesDef {
  archetype: string
  category: SpeciesCategory
  /** Staples: yield relative to the baseline grain at fit 1; livestock: pasture value relative to plain herding (dairy > 1). */
  yield: number
  /** Staples: labour relative to the baseline grain (Boserup factor above 1). */
  labour: number
  /** Chance per decade that a settlement takes it up from one link that has it (benefit 1, same people). */
  adopt: number
  /** Envelopes: min, lo, hi, max (fit 0 outside [min, max], 1 on [lo, hi], linear between). */
  t: Trap
  r: Trap
  /** Allowed biomes (bit per biome id), 0 for any land. */
  biomes: number
  /** Elevation limits (land 0..1). */
  eMin: number
  eMax: number
  /** Paddy: needs water (river or creek, lake shore, or a wet lowland). */
  water: boolean
  /** Marginal land: the agri value this species reaches on these biomes (instead of CAPACITY.agri), with rainfall >= floorRain; it keeps only 1 - reliefCut of the highland penalty (terraced tubers on slopes). */
  floorBiomes: number
  floorAgri: number
  floorRain: number
  reliefCut: number
  /** Number of native places (1 or 2). */
  origins: number
  /** Preferred origin climate (wild origins and the cell of a founding species' origin): t, r and elevation ranges, latitude (|y|) limit, and whether to keep off cradle regions. */
  hearthT: readonly [number, number]
  hearthR: readonly [number, number]
  hearthE: readonly [number, number]
  hearthLat: number
  /** Cereal (rotation works on it). */
  cereal: boolean
  // Livestock.
  /** Traction: crop part * (1 + traction) (best of the herds held). */
  traction: number
  /** Pack transport: trade transport cost * pack (best held). */
  pack: number
  /** Travel cost on Desert cells / highland cells for its holders. */
  desertMove: number
  mountainMove: number
  /** Crowd-disease weight. */
  disease: number
  /** Chance a seaborne colony carries it. */
  seaCarry: number
}

const B = (...ids: number[]): number => { let m = 0; for (const b of ids) m |= 1 << b; return m }

function staple(archetype: string, y: number, labour: number, adopt: number, t: Trap, r: Trap, more: Partial<SpeciesDef> = {}): SpeciesDef {
  return {
    archetype, category: SpeciesCategory.Staple, yield: y, labour, adopt, t, r, biomes: 0, eMin: -1, eMax: 2, water: false,
    floorBiomes: 0, floorAgri: 0, floorRain: 0, reliefCut: 0, origins: 1,
    hearthT: [0, 1], hearthR: [0, 1], hearthE: [-1, 2], hearthLat: 1, cereal: false,
    traction: 0, pack: 1, desertMove: 1, mountainMove: 1, disease: 0, seaCarry: 0.9, ...more,
  }
}
function herd(archetype: string, y: number, adopt: number, biomes: number, t: Trap, r: Trap, more: Partial<SpeciesDef> = {}): SpeciesDef {
  return {
    archetype, category: SpeciesCategory.Livestock, yield: y, labour: 1, adopt, t, r, biomes, eMin: -1, eMax: 2, water: false,
    floorBiomes: 0, floorAgri: 0, floorRain: 0, reliefCut: 0, origins: 1,
    hearthT: [0, 1], hearthR: [0, 1], hearthE: [-1, 2], hearthLat: 1, cereal: false,
    traction: 0, pack: 1, desertMove: 1, mountainMove: 1, disease: 0, seaCarry: 0.5, ...more,
  }
}

const { TemperateForest: TF, Grassland: GR, Savanna: SV, Desert: DS, Mountain: MT, Taiga: TG } = Biome

/**
 * The species of v1, in id order (tuned starting values from the design document; envelopes in the world's
 * temperature t and rainfall r, roughly t = (deg C + 12) / 40 and r = mm / 2500).
 */
export const SPECIES_TABLE: readonly SpeciesDef[] = [
  staple('wheat', 1.0, 1.0, 0.25, [0.35, 0.45, 0.68, 0.82], [0.1, 0.16, 0.36, 0.6], { eMax: 0.45, cereal: true, hearthT: [0.55, 0.7], hearthR: [0.14, 0.3], hearthE: [0.08, 0.35] }),
  staple('barley', 0.9, 0.9, 0.25, [0.28, 0.38, 0.7, 0.85], [0.07, 0.12, 0.36, 0.6], { cereal: true, hearthT: [0.45, 0.65], hearthR: [0.1, 0.25] }),
  staple('paddyRice', 1.3, 2.0, 0.15, [0.6, 0.72, 1, 1], [0.05, 0.15, 1, 1], { water: true, eMax: 0.35, origins: 2, hearthT: [0.75, 0.92], hearthR: [0.4, 0.75] }),
  staple('maize', 1.25, 1.0, 0.2, [0.5, 0.6, 0.92, 0.99], [0.15, 0.24, 0.55, 0.8], { hearthT: [0.7, 0.85], hearthR: [0.25, 0.45], hearthE: [0.12, 0.35] }),
  staple('potato', 1.4, 1.1, 0.15, [0.3, 0.4, 0.58, 0.76], [0.16, 0.28, 0.6, 0.85], {
    floorBiomes: B(MT, TG), floorAgri: 0.6, floorRain: 0.16, reliefCut: 0.75, hearthT: [0.4, 0.6], hearthE: [0.3, 2], hearthLat: 0.45,
  }),
  staple('cassava', 1.22, 0.6, 0.2, [0.68, 0.78, 1, 1], [0.18, 0.25, 0.9, 1], { eMax: 0.4, hearthT: [0.88, 1], hearthR: [0.4, 0.65] }),
  staple('sorghum', 0.85, 0.8, 0.25, [0.62, 0.72, 1, 1], [0.06, 0.14, 0.32, 0.55], {
    cereal: true, floorBiomes: B(DS), floorAgri: 0.3, floorRain: 0.07, hearthT: [0.85, 1], hearthR: [0.14, 0.3],
  }),
  herd('cattle', 1.15, 0.2, B(GR, TF, SV, TG), [0.3, 0.38, 0.9, 0.97], [0.08, 0.15, 0.55, 0.7], {
    origins: 2, traction: 0.1, pack: 0.85, disease: 0.45, seaCarry: 0.5, hearthT: [0.5, 0.9], hearthR: [0.15, 0.4],
  }),
  herd('sheepGoat', 1.15, 0.3, B(MT, GR, SV, DS, TF), [0.25, 0.32, 1, 1], [0.03, 0.07, 0.45, 0.6], {
    floorBiomes: B(MT, DS), floorAgri: 0.3, floorRain: 0.05, disease: 0.2, seaCarry: 0.7, hearthT: [0.5, 0.75], hearthR: [0.1, 0.3], hearthE: [0.1, 0.5],
  }),
  herd('horse', 1.1, 0.2, B(GR, SV, TG), [0.25, 0.32, 0.72, 0.8], [0.05, 0.1, 0.35, 0.45], {
    traction: 0.05, pack: 0.8, disease: 0.15, seaCarry: 0.4, hearthT: [0.35, 0.6], hearthR: [0.08, 0.3],
  }),
  herd('camel', 1.15, 0.15, B(DS, GR, SV), [0.3, 0.45, 1, 1], [0, 0.02, 0.18, 0.26], {
    floorBiomes: B(DS), floorAgri: 0.2, floorRain: 0, pack: 0.85, desertMove: 0.45, disease: 0.1, seaCarry: 0.2, hearthT: [0.6, 1], hearthR: [0.03, 0.14],
  }),
  herd('llama', 0.95, 0.15, 0, [0.25, 0.32, 0.65, 0.75], [0.05, 0.12, 0.7, 0.9], {
    eMin: 0.28, floorBiomes: B(MT), floorAgri: 0.3, floorRain: 0.05, mountainMove: 0.85, disease: 0.05, seaCarry: 0.3, hearthT: [0.35, 0.6], hearthE: [0.3, 2], hearthLat: 0.45,
  }),
]

export const S_COUNT = SPECIES_TABLE.length
export const SP = { wheat: 0, barley: 1, paddyRice: 2, maize: 3, potato: 4, cassava: 5, sorghum: 6, cattle: 7, sheepGoat: 8, horse: 9, camel: 10, llama: 11 } as const

/** Techniques and improved strains (internal for now): bit TECH_BIT + k of a settlement's species mask. */
export const TECHNIQUES = ['earlyRice', 'rotation', 'heavyPlough'] as const
export const K_COUNT = TECHNIQUES.length
export const TQ = { earlyRice: 0, rotation: 1, heavyPlough: 2 } as const
/** Mask bit of technique 0 (species use bits [0, TECH_BIT)). */
export const TECH_BIT = 48
/** Items: species ids [0, S_COUNT), then techniques at S_COUNT + k (index into per-people year arrays). */
const ITEMS = S_COUNT + K_COUNT

const STAPLES: number[] = []
const HERDS: number[] = []
for (let i = 0; i < S_COUNT; i++) (SPECIES_TABLE[i].category === SpeciesCategory.Staple ? STAPLES : HERDS).push(i)
/** Mask words of the labour-heavy staples (their yield follows population pressure). */
let LABOUR0 = 0, LABOUR1 = 0
for (const x of STAPLES) if (SPECIES_TABLE[x].labour > 1) { if (x < 32) LABOUR0 |= 1 << x; else LABOUR1 |= 1 << (x - 32) }

/** Mask bit of item x (species id or S_COUNT + technique). */
function itemBit(x: number): number {
  return x < S_COUNT ? x : TECH_BIT + (x - S_COUNT)
}
function hasBit(m0: number, m1: number, b: number): boolean {
  return b < 32 ? ((m0 >>> b) & 1) === 1 : ((m1 >>> (b - 32)) & 1) === 1
}

// ---------------------------------------------------------------------------------------------------------
// Fit

function trap(x: number, a: Trap): number {
  if (x < a[0] || x > a[3]) return 0
  if (x < a[1]) return a[1] > a[0] ? (x - a[0]) / (a[1] - a[0]) : 1
  if (x <= a[2]) return 1
  return a[3] > a[2] ? (a[3] - x) / (a[3] - a[2]) : 1
}

/** Water for paddy at land cell i: a river or creek (flow >= share of the river threshold), a lake shore, or a wet lowland (rainfall >= wetRain below elevation wetElev). */
function paddyWater(world: World, i: number, creek: number, wetRain: number, wetElev: number): boolean {
  if (world.flow[i] >= creek * RIVER_FLOW_THRESHOLD) return true
  if (world.rainfall[i] >= wetRain && world.elevation[i] < wetElev) return true
  const { neighborOffsets: off, neighbors: nb } = world.grid
  for (let k = off[i]; k < off[i + 1]; k++) if (world.lake[nb[k]]) return true
  return false
}

/** Fit of species d at land cell i (0..1); `early`: paddy under the early-ripening strain's wetter water rule. */
export function fitAt(world: World, d: SpeciesDef, i: number, early = false): number {
  const e = world.elevation[i]
  const b = world.biome[i]
  if (e < 0 || world.lake[i] || b === Biome.Ice) return 0
  if (d.biomes !== 0 && ((d.biomes >>> b) & 1) === 0 && !(d.eMin > 0 && e >= d.eMin)) return 0
  if (e > d.eMax) return 0
  if (d.eMin > 0 && e < d.eMin && b !== Biome.Mountain) return 0
  let f = trap(world.temperature[i], d.t) * trap(world.rainfall[i], d.r)
  if (f <= 0) return 0
  if (d.water && !(early ? paddyWater(world, i, 0.3, 0.45, 0.15) : paddyWater(world, i, 0.5, 0.6, 0.08))) return 0
  return f
}

/** The agri value species d reaches on land cell i as marginal land (0 where it opens nothing). */
function floorAgri(world: World, d: SpeciesDef, i: number): number {
  if (d.floorBiomes === 0 || ((d.floorBiomes >>> world.biome[i]) & 1) === 0 || world.rainfall[i] < d.floorRain) return 0
  return d.floorAgri
}

/**
 * Field part (no river, no fish) of a land cell's farm capacity per unit of CAPACITY.base * area with the best
 * marginal-land staple that grows there (0 if none): what terrain.ts uses to call such cells habitable.
 */
export function marginalFarm(world: World, i: number, farmQ: number, relief: number): number {
  let best = 0
  for (const s of STAPLES) {
    const d = SPECIES_TABLE[s]
    const a = floorAgri(world, d, i)
    if (a <= 0 || fitAt(world, d, i) <= 0) continue
    const rel = 1 - (1 - d.reliefCut) * (1 - relief)
    const v = a * farmQ * rel
    if (v > best) best = v
  }
  return best
}

/**
 * Fit of every species at every cell, row-major fit[species * cellCount + cell] (for the tests and the stats harness);
 * with `strains`, the best fit any improved strain gives (early-ripening paddy's wetter water rule).
 */
export function speciesFit(world: World, strains = false): Float32Array {
  const N = world.grid.cellCount
  const out = new Float32Array(S_COUNT * N)
  for (let s = 0; s < S_COUNT; s++) {
    for (let i = 0; i < N; i++) {
      let f = fitAt(world, SPECIES_TABLE[s], i)
      if (strains && s === SP.paddyRice) { const g = fitAt(world, SPECIES_TABLE[s], i, true); if (g > f) f = g }
      out[s * N + i] = f
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------
// State

/** An epidemic wave among people `q`, from contact with people `p`. */
interface Wave {
  q: number
  p: number
  year: number
  cell: number
  mortality: number
  /** Settlement through which it came (q's) and the source's. */
  at: number
  from: number
  done: boolean
}

export interface SpeciesState {
  N: number
  P: number
  rng: Rng
  // Static per cell (rows: species; staple rows of `val`/`fit` have an extra early-rice paddy row at S_COUNT).
  fit: Float32Array
  /** Staples: yield * fit * marginal factor; livestock: pasture value * fit * marginal factor. iratio: 1 / the marginal factor (1 on ordinary land). */
  val: Float32Array
  iratio: Float32Array
  /** Catchment fit (habitable cells): weighted mean fit over the base catchment. */
  fitCatch: Float32Array
  /** Site factors for migrants (habitable cells, normalised): crop part per staple, livestock part per herd (row S_COUNT: hunting only). */
  siteCrop: Float32Array
  siteLive: Float32Array
  /** Upper bound of the site factor of any group (cheap early reject). */
  siteMax: Float32Array
  /** Cells of t >= TECHNIQUE.riceHot; moist temperate fields for the heavy plough. */
  hot: Uint8Array
  plough: Uint8Array
  /** Travel class per cell: 0 plain, 1 desert, 2 highland. */
  moveClass: Uint8Array
  /** Desert and highland share of each habitable cell's full catchment (benefit of camels and llamas). */
  desertNear: Float32Array
  highNear: Float32Array
  /** Species that do not fit a habitable cell's catchment (catchment fit < SPECIES.minFit): never taken up there. */
  unfit0: Uint32Array
  unfit1: Uint32Array
  /** Wild ranges: mask words per cell of the species whose range covers it; and per habitable cell over its base catchment. */
  range0: Uint32Array
  range1: Uint32Array
  catchRange0: Uint32Array
  catchRange1: Uint32Array
  /** Origin cells per species. */
  origins: number[][]
  /** Founding set of each cradle (species ids), each people's (mask words), and each people's cradle. */
  cradleSet: number[][]
  cradle: Int32Array
  found0: Uint32Array
  found1: Uint32Array
  // Per settlement (grown with the count).
  m0: Uint32Array
  m1: Uint32Array
  /** Crop multiplier the food system applies (raw / norm), and the raw one. */
  cropMul: Float64Array
  raw: Float64Array
  /** Livestock part of the food relative to the whole (for the food split), per settlement. */
  liveAdj: Float64Array
  /** Best staple on the settlement's own cell (-1: none fits). */
  main: Int8Array
  firstChild: Int32Array
  nextSibling: Int32Array
  /** Settlements of other peoples it has seen (knowledge.ts look), up to SIGHT_LINKS, or null. */
  sight: (number[] | null)[]
  /** Items found of no use to it at its current species (cleared when they change, and every century). */
  dull0: Uint32Array
  dull1: Uint32Array
  dullYear: Int32Array
  /** Year of each settlement's next spread step. */
  due: Int32Array
  /** Benefit of each item per settlement (-1: not reckoned), valid until benUntil (cleared when its species change). */
  ben: Float32Array
  benUntil: Int32Array
  /** Epidemic: wave that hit it (-1), years of loss left, yearly loss. */
  epiWave: Int32Array
  epiLeft: Int8Array
  epiRate: Float64Array
  // Per people.
  /** First year each people held each item (species, then techniques), -1: year[p * ITEMS + x]; source people, -1. */
  year: Int16Array
  source: Int8Array
  /** What each people's living settlements hold between them (mask words, refreshed every SPECIES.step years and on each gain). */
  pm0: Uint32Array
  pm1: Uint32Array
  /** Crowd-disease load, and the year of each people's last epidemic. */
  disease: Float64Array
  lastEpidemic: Int32Array
  /** First holder (settlement) and year of each species. */
  firstHolder: Int32Array
  firstYear: Int32Array
  waves: Wave[]
  /** Waves still spreading, and settlements still losing people to one. */
  activeWaves: number
  sick: number
  /** Routes by settlement (rebuilt every SPECIES.step years from the open trade routes): CSR over [0, routeN). */
  routeOff: Int32Array
  routeTo: Int32Array
  routeVol: Float64Array
  routeN: number
  // Scratch.
  linkBridge: Float64Array
  linkFrom: Int32Array
  linkCount: Int32Array
  claimBest: Float64Array
  claimWho: Int32Array
  claimStamp: Int32Array
  claimRun: number
  /** Diagnostics: technique acquisitions (year, people, technique, settlement), epidemics (year, victim people, source people, mortality, victim pop before). */
  techLog: number[]
  epiLog: number[]
}

/** Interface the trade state offers here (kept structural to avoid an import cycle). */
export interface RouteView {
  openList: number[]
  rA: number[]
  rB: number[]
  rVol: Float64Array
}

function chord2(P: Float32Array, a: number, b: number): number {
  const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]
  return dx * dx + dy * dy + dz * dz
}

/**
 * Builds the species tables for a world, places the origins and the cradles' founding sets (draws from `rng`,
 * 'history-species-origins'), and sizes the per-people arrays. Called after the cradles are planned and before
 * the tribes are founded.
 */
export function createSpecies(s: HistoryState, plan: CradlePlan, rngOrigins: Rng, rng: Rng): SpeciesState {
  const world = s.world
  const T = s.terrain
  const N = T.cellCount
  const P = plan.cells.length
  const area = 23042 / N
  const Sx = S_COUNT + 1
  const fit = new Float32Array(Sx * N)
  const val = new Float32Array(Sx * N)
  const iratio = new Float32Array(Sx * N).fill(1)
  const { capFarm, liveFrac, riverFishFrac, farmQ, relief, riverCap } = T
  const agri = CAPACITY.agri
  for (let x = 0; x < Sx; x++) {
    const s0 = x < S_COUNT ? x : SP.paddyRice
    const d = SPECIES_TABLE[s0]
    const o = x * N
    for (let i = 0; i < N; i++) {
      if (capFarm[i] <= 0) continue
      const f = fitAt(world, d, i, x === S_COUNT)
      if (f <= 0) continue
      fit[o + i] = f
      // Marginal land: this species' own capacity on the cell over the cell's farm capacity.
      let ratio = 1
      const fa = floorAgri(world, d, i)
      const b = world.biome[i]
      if (fa > agri[b] || d.reliefCut > 0) {
        const rel = 1 - (1 - d.reliefCut) * (1 - relief[i])
        const cap = CAPACITY.base * area * (fa > agri[b] ? fa : agri[b]) * farmQ[i] * rel + riverCap[i]
        if (cap > capFarm[i]) ratio = cap / capFarm[i]
      }
      val[o + i] = d.yield * f * ratio
      iratio[o + i] = 1 / ratio
    }
  }
  // Static flags.
  const hot = new Uint8Array(N)
  const plough = new Uint8Array(N)
  const moveClass = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    if (T.sea[i]) continue
    const b = world.biome[i]
    if (world.temperature[i] >= TECHNIQUE.riceHot) hot[i] = 1
    if ((b === Biome.TemperateForest || b === Biome.Grassland) && world.rainfall[i] >= 0.25) plough[i] = 1
    if (b === Biome.Desert) moveClass[i] = 1
    else if (b === Biome.Mountain || world.elevation[i] >= 0.3) moveClass[i] = 2
  }
  // Catchment fit and site factors (habitable cells).
  const fitCatch = new Float32Array(S_COUNT * N)
  const siteCrop = new Float32Array(S_COUNT * N)
  const siteLive = new Float32Array((S_COUNT + 1) * N)
  const siteMax = new Float32Array(N)
  const desertNear = new Float32Array(N)
  const highNear = new Float32Array(N)
  const norm = SPECIES.norm, floor = SPECIES.floor, hunt = SPECIES.hunt
  const { catchOff, catchBase, catchCell, catchW } = T
  // (Each habitable cell's base catchment gathered once: cell, weight, crop and livestock shares.)
  const GJ = new Int32Array(256), GW = new Float64Array(256), GC = new Float64Array(256), GL = new Float64Array(256)
  for (let c = 0; c < N; c++) {
    if (!T.habitable[c]) continue
    let den = 0, rfS = 0, crS = 0, lfS = 0, n = 0
    for (let k = catchOff[c], e = catchBase[c]; k < e && n < 256; k++) {
      const j = catchCell[k]
      const w = catchW[k] * capFarm[j]
      const lf = liveFrac[j], rf = riverFishFrac[j]
      GJ[n] = j; GW[n] = w; GC[n] = w * (1 - lf - rf); GL[n] = w * lf; n++
      den += w
      rfS += w * rf
      crS += w * (1 - lf - rf)
      lfS += w * lf
    }
    let nd = 0, nh = 0, nAll = 0
    for (let k = catchOff[c]; k < catchOff[c + 1]; k++) {
      const m = moveClass[catchCell[k]]
      nAll++
      if (m === 1) nd++
      else if (m === 2) nh++
    }
    desertNear[c] = nAll > 0 ? nd / nAll : 0
    highNear[c] = nAll > 0 ? nh / nAll : 0
    if (den <= 0) continue
    const inv = 1 / den
    siteLive[S_COUNT * N + c] = (hunt * lfS * inv) / norm
    let bestCrop = (rfS + floor * crS) * inv, bestLive = hunt * lfS * inv
    for (const x of STAPLES) {
      const o = x * N
      let fs = 0, cs = 0
      for (let t = 0; t < n; t++) {
        const j = GJ[t]
        fs += GW[t] * fit[o + j]
        const v = val[o + j]
        cs += GC[t] * (v > floor ? v : floor)
      }
      fitCatch[o + c] = fs * inv
      const v = (rfS + cs) * inv
      siteCrop[o + c] = v / norm
      if (v > bestCrop) bestCrop = v
    }
    for (const x of HERDS) {
      const o = x * N
      let fs = 0, ls = 0
      for (let t = 0; t < n; t++) {
        const j = GJ[t]
        fs += GW[t] * fit[o + j]
        const v = val[o + j]
        ls += GL[t] * (v > hunt ? v : hunt)
      }
      fitCatch[o + c] = fs * inv
      const v = ls * inv
      siteLive[o + c] = v / norm
      if (v > bestLive) bestLive = v
    }
    siteMax[c] = (bestCrop + bestLive) / norm // (no group's siteFactor exceeds it)
  }
  const unfit0 = new Uint32Array(N), unfit1 = new Uint32Array(N)
  for (let c = 0; c < N; c++) {
    if (!T.habitable[c]) continue
    for (let x = 0; x < S_COUNT; x++) {
      if (fitCatch[x * N + c] >= SPECIES.minFit) continue
      const b = itemBit(x)
      if (b < 32) unfit0[c] |= 1 << b
      else unfit1[c] |= 1 << (b - 32)
    }
  }

  const sp: SpeciesState = {
    N, P, rng, fit, val, iratio, fitCatch, siteCrop, siteLive, siteMax, hot, plough, moveClass, desertNear, highNear,
    range0: new Uint32Array(N), range1: new Uint32Array(N), catchRange0: new Uint32Array(N), catchRange1: new Uint32Array(N),
    origins: [], cradleSet: [], cradle: Int32Array.from(plan.cradle), found0: new Uint32Array(P), found1: new Uint32Array(P),
    m0: new Uint32Array(256), m1: new Uint32Array(256), cropMul: new Float64Array(256), raw: new Float64Array(256), liveAdj: new Float64Array(256),
    main: new Int8Array(256), firstChild: new Int32Array(256), nextSibling: new Int32Array(256),
    sight: [], dull0: new Uint32Array(256), dull1: new Uint32Array(256), dullYear: new Int32Array(256),
    ben: new Float32Array(256 * ITEMS).fill(-1), benUntil: new Int32Array(256), due: new Int32Array(256),
    unfit0, unfit1,
    epiWave: new Int32Array(256), epiLeft: new Int8Array(256), epiRate: new Float64Array(256),
    year: new Int16Array(P * ITEMS).fill(-1), source: new Int8Array(P * ITEMS).fill(-1), pm0: new Uint32Array(P), pm1: new Uint32Array(P), disease: new Float64Array(P), lastEpidemic: new Int32Array(P).fill(-1000000),
    firstHolder: new Int32Array(S_COUNT).fill(-1), firstYear: new Int32Array(S_COUNT).fill(-1),
    waves: [], activeWaves: 0, sick: 0,
    routeOff: new Int32Array(257), routeTo: new Int32Array(0), routeVol: new Float64Array(0), routeN: 0,
    linkBridge: new Float64Array(64), linkFrom: new Int32Array(64), linkCount: new Int32Array(64),
    claimBest: new Float64Array(N), claimWho: new Int32Array(N), claimStamp: new Int32Array(N).fill(-1), claimRun: 0,
    techLog: [], epiLog: [],
  }
  placeOrigins(s, sp, plan, rngOrigins)
  return sp
}

/** Cells within `hops` plain hops over land of c (BFS, c first). */
function landRegion(s: HistoryState, c: number, hops: number, stamp: Int32Array, run: number, depth: Int32Array, queue: Int32Array): number {
  const T = s.terrain
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  let tail = 0
  queue[tail++] = c
  stamp[c] = run
  depth[c] = 0
  for (let head = 0; head < tail; head++) {
    const q = queue[head]
    if (depth[q] >= hops) continue
    for (let e = off[q]; e < off[q + 1]; e++) {
      const j = nb[e]
      if (stamp[j] === run || T.sea[j]) continue
      stamp[j] = run
      depth[j] = depth[q] + 1
      queue[tail++] = j
    }
  }
  return tail
}

/** How well cell i suits an origin of species x: fit, doubled in its preferred hearth climate. */
function hearthScore(world: World, sp: SpeciesState, x: number, i: number): number {
  const f = sp.fit[x * sp.N + i]
  if (f <= 0) return 0
  const d = SPECIES_TABLE[x]
  const t = world.temperature[i], r = world.rainfall[i], e = world.elevation[i]
  const y = world.grid.positions[i * 3 + 1]
  let pref = 1
  if (t >= d.hearthT[0] && t <= d.hearthT[1]) pref += 0.5
  if (r >= d.hearthR[0] && r <= d.hearthR[1]) pref += 0.5
  if (e >= d.hearthE[0] && e <= d.hearthE[1]) pref += 0.5
  if ((y < 0 ? -y : y) <= d.hearthLat) pref += 0.5
  return f * pref
}

/** M1: founding sets for the cradles (their species native there) and wild origins for the rest. */
function placeOrigins(s: HistoryState, sp: SpeciesState, plan: CradlePlan, rng: Rng): void {
  const world = s.world
  const T = s.terrain
  const N = sp.N
  const P = plan.cells.length
  const K = plan.centres.length
  const pos = world.grid.positions
  const origins: number[][] = []
  for (let x = 0; x < S_COUNT; x++) origins.push([])
  const stamp = new Int32Array(N).fill(-1)
  const depth = new Int32Array(N)
  const queue = new Int32Array(N)
  let run = 0
  // Cradle regions (as the cradle planner sees them) and which cradle each cell belongs to.
  const regionOf = new Int32Array(N).fill(-1)
  const regionCells: number[][] = []
  const hops = Math.max(1, Math.round((CRADLE.regionHops * T.n) / 48))
  for (let k = 0; k < K; k++) {
    const n = landRegion(s, plan.centres[k], hops, stamp, run++, depth, queue)
    const cells: number[] = []
    for (let t = 0; t < n; t++) { cells.push(queue[t]); if (regionOf[queue[t]] < 0) regionOf[queue[t]] = k }
    // Tribes' own surroundings belong to the region too.
    for (let p = 0; p < P; p++) {
      if (plan.cradle[p] !== k) continue
      const m = landRegion(s, plan.cells[p], 3, stamp, run++, depth, queue)
      for (let t = 0; t < m; t++) { if (regionOf[queue[t]] < 0) regionOf[queue[t]] = k; cells.push(queue[t]) }
    }
    regionCells.push(cells)
  }
  // Founding sets: mean catchment fit over the cradle's tribes.
  const sets: number[][] = []
  for (let k = 0; k < K; k++) {
    const tribes: number[] = []
    for (let p = 0; p < P; p++) if (plan.cradle[p] === k) tribes.push(plan.cells[p])
    const cf = new Float64Array(S_COUNT)
    for (let x = 0; x < S_COUNT; x++) {
      let f = 0
      for (const c of tribes) f += sp.fitCatch[x * N + c]
      cf[x] = tribes.length > 0 ? f / tribes.length : 0
    }
    const size = 2 + Math.floor(SPECIES.packageSpan * rng.next())
    const set: number[] = []
    const free = (x: number) => origins[x].length < SPECIES_TABLE[x].origins
    // The staple that grows there: the best fitting with an origin to spare (weighted by fit^2), else the best fitting.
    let pick = -1
    {
      let total = 0
      const w = new Float64Array(S_COUNT)
      for (const x of STAPLES) if (free(x) && cf[x] >= 0.5) { w[x] = cf[x] * cf[x] * (0.5 + rng.next()); total += w[x] }
      if (total > 0) {
        let best = -1
        for (const x of STAPLES) if (w[x] > 0 && (best < 0 || w[x] > w[best])) best = x
        pick = best
      } else {
        for (const x of STAPLES) if (free(x) && (pick < 0 || cf[x] > cf[pick])) pick = x
        if (pick < 0 || cf[pick] <= 0) { pick = -1; for (const x of STAPLES) if (pick < 0 || cf[x] > cf[pick]) pick = x }
      }
    }
    set.push(pick)
    let herds = 0
    while (set.length < size) {
      let best = -1, bestW = 0
      for (let x = 0; x < S_COUNT; x++) {
        if (set.indexOf(x) >= 0 || !free(x) || cf[x] < SPECIES.packageFit) continue
        const isHerd = SPECIES_TABLE[x].category === SpeciesCategory.Livestock
        if (isHerd && herds >= SPECIES.packageHerds) continue
        const w = cf[x] * (0.3 + rng.next())
        if (w > bestW) { bestW = w; best = x }
      }
      if (best < 0) break
      set.push(best)
      if (SPECIES_TABLE[best].category === SpeciesCategory.Livestock) herds++
    }
    set.sort((a, b) => a - b)
    sets.push(set)
    // Origins of the founding species: their best hearth cell in the cradle region.
    for (const x of set) {
      if (!free(x)) continue
      let bestC = -1, bestS = 0
      for (const c of regionCells[k]) {
        const sc = hearthScore(world, sp, x, c)
        if (sc > bestS) { bestS = sc; bestC = c }
      }
      if (bestC < 0) bestC = plan.centres[k]
      origins[x].push(bestC)
    }
  }
  // Wild origins for the rest (and now and then a second one for species that may have two).
  const hasCradle = new Uint8Array(T.landmassSize.length)
  for (let k = 0; k < K; k++) hasCradle[T.landmass[plan.centres[k]]] = 1
  const minChord2 = SPECIES.originChord * SPECIES.originChord
  for (let x = 0; x < S_COUNT; x++) {
    const d = SPECIES_TABLE[x]
    let want = d.origins - origins[x].length
    if (want <= 0) continue
    if (origins[x].length > 0 && rng.next() >= SPECIES.secondOrigin) want = 0
    for (let n = 0; n < want; n++) {
      // Best hearth score over land; candidates near it (>= originFit of the best fit), weighted.
      let maxF = 0
      for (let i = 0; i < N; i++) { const f = sp.fit[x * N + i]; if (f > maxF) maxF = f }
      if (maxF <= 0) break
      const minF = Math.min(SPECIES.originFit, maxF)
      let total = 0
      const cand: number[] = [], wts: number[] = []
      for (let i = 0; i < N; i++) {
        if (sp.fit[x * N + i] < minF - 1e-6) continue
        let ok = true
        for (const o of origins[x]) if (chord2(pos, i, o) < minChord2) ok = false
        if (!ok) continue
        let w = hearthScore(world, sp, x, i)
        if (!hasCradle[T.landmass[i]]) w *= SPECIES.otherLand
        if (regionOf[i] >= 0) w *= SPECIES.inCradle
        if (w <= 0) continue
        cand.push(i); wts.push(w); total += w
      }
      if (cand.length === 0) break
      let r = rng.next() * total
      let c = cand[cand.length - 1]
      for (let t = 0; t < cand.length; t++) { r -= wts[t]; if (r < 0) { c = cand[t]; break } }
      origins[x].push(c)
    }
    if (origins[x].length === 0) {
      // Nowhere fits well: the best-fitting land cell.
      let best = -1
      for (let i = 0; i < N; i++) if (sp.fit[x * N + i] > 0 && (best < 0 || sp.fit[x * N + i] > sp.fit[x * N + best])) best = i
      if (best < 0) for (let i = 0; i < N; i++) if (!T.sea[i] && !world.lake[i] && world.biome[i] !== Biome.Ice) { best = i; break }
      if (best >= 0) origins[x].push(best)
    }
  }
  sp.origins = origins
  sp.cradleSet = sets
  for (let p = 0; p < P; p++) {
    let m0 = 0, m1 = 0
    for (const x of sets[plan.cradle[p]]) { const b = itemBit(x); if (b < 32) m0 |= 1 << b; else m1 |= 1 << (b - 32) }
    sp.found0[p] = m0 >>> 0
    sp.found1[p] = m1 >>> 0
  }
  // Wild ranges: land within rangeHops plain hops of each origin, where the species fits at least rangeFit.
  const rh = Math.max(1, Math.round((SPECIES.rangeHops * T.n) / 48))
  for (let x = 0; x < S_COUNT; x++) {
    const b = itemBit(x)
    for (const o of origins[x]) {
      const n = landRegion(s, o, rh, stamp, run++, depth, queue)
      for (let t = 0; t < n; t++) {
        const c = queue[t]
        if (c !== o && sp.fit[x * N + c] < SPECIES.rangeFit) continue
        if (b < 32) sp.range0[c] |= 1 << b
        else sp.range1[c] |= 1 << (b - 32)
      }
    }
  }
  const { catchOff, catchBase, catchCell } = T
  for (let c = 0; c < N; c++) {
    if (!T.habitable[c]) continue
    let a0 = 0, a1 = 0
    for (let k = catchOff[c]; k < catchBase[c]; k++) { a0 |= sp.range0[catchCell[k]]; a1 |= sp.range1[catchCell[k]] }
    sp.catchRange0[c] = a0 >>> 0
    sp.catchRange1[c] = a1 >>> 0
  }
}

function growI32(a: Int32Array, n: number): Int32Array { const b = new Int32Array(n); b.set(a); return b }
function growU32(a: Uint32Array, n: number): Uint32Array { const b = new Uint32Array(n); b.set(a); return b }
function growF64(a: Float64Array, n: number): Float64Array { const b = new Float64Array(n); b.set(a); return b }
function growI8(a: Int8Array, n: number): Int8Array { const b = new Int8Array(n); b.set(a); return b }

function ensureSettlements(sp: SpeciesState, count: number): void {
  if (count <= sp.m0.length) return
  let size = sp.m0.length
  while (size < count) size *= 2
  sp.m0 = growU32(sp.m0, size)
  sp.m1 = growU32(sp.m1, size)
  sp.cropMul = growF64(sp.cropMul, size)
  sp.raw = growF64(sp.raw, size)
  sp.liveAdj = growF64(sp.liveAdj, size)
  sp.main = growI8(sp.main, size)
  sp.firstChild = growI32(sp.firstChild, size)
  sp.nextSibling = growI32(sp.nextSibling, size)
  sp.epiWave = growI32(sp.epiWave, size)
  sp.epiLeft = growI8(sp.epiLeft, size)
  sp.epiRate = growF64(sp.epiRate, size)
  sp.dull0 = growU32(sp.dull0, size)
  sp.dull1 = growU32(sp.dull1, size)
  sp.dullYear = growI32(sp.dullYear, size)
  const ben = new Float32Array(size * ITEMS).fill(-1)
  ben.set(sp.ben)
  sp.ben = ben
  sp.benUntil = growI32(sp.benUntil, size)
  sp.due = growI32(sp.due, size)
}

// ---------------------------------------------------------------------------------------------------------
// Crop multiplier

/**
 * Crop multiplier of settlement `id` if it held the species / techniques in (m0, m1): the weighted mean over its base
 * catchment of rf + crop * mc + live * mh (see the header), normalised (its yields; the land marginal crops open counts
 * as it is). With `write`, stores it (and the raw mean, the food split factor and the main staple) for the settlement.
 */
export function cropOf(s: HistoryState, id: number, m0: number, m1: number, write: boolean): number {
  const sp = s.sp
  const T = s.terrain
  const N = sp.N
  const c = s.cell[id]
  const p = s.pop[id], ex = s.expected[id]
  let press = ex > 0 ? p / ex : 1
  if (press > 1) press = 1
  const early = hasBit(m0, m1, TECH_BIT + TQ.earlyRice)
  const rotation = hasBit(m0, m1, TECH_BIT + TQ.rotation)
  const cattle = hasBit(m0, m1, SP.cattle)
  const horse = hasBit(m0, m1, SP.horse)
  const plough = cattle && hasBit(m0, m1, TECH_BIT + TQ.heavyPlough)
  const traction = cattle ? SPECIES_TABLE[SP.cattle].traction : horse ? SPECIES_TABLE[SP.horse].traction : 0
  // Held staples: row offset, yield factor, hot-cell bonus.
  let ns = 0
  const rows = ROWS, muls = MULS, hots = HOTS, ids = IDS
  for (const x of STAPLES) {
    if (!hasBit(m0, m1, x)) continue
    const d = SPECIES_TABLE[x]
    const lab = d.labour > 1 ? 1 / (1 + SPECIES.boserup * (d.labour - 1) * (1 - press)) : 1
    const paddyEarly = x === SP.paddyRice && early
    rows[ns] = (paddyEarly ? S_COUNT : x) * N
    muls[ns] = lab * (rotation && d.cereal ? 1 + TECHNIQUE.rotationYield : 1)
    hots[ns] = paddyEarly ? TECHNIQUE.riceYield : 0
    ids[ns] = x
    ns++
  }
  let nh = 0
  const hrows = HROWS
  for (const x of HERDS) if (hasBit(m0, m1, x)) hrows[nh++] = x * N
  const val = sp.val, ir = sp.iratio, hot = sp.hot, plo = sp.plough
  const { catchOff, catchBase, catchCell, catchW, capFarm, liveFrac, riverFishFrac } = T
  const floor = SPECIES.floor, second = SPECIES.second, hunt = SPECIES.hunt
  // Two sums: what the land yields with these species (num), and the same without the marginal-land factors (numY):
  // the yields are normalised and damped above the old calibration, the marginal factor (land opened) is not.
  let num = 0, numY = 0, den = 0, lnum = 0, lden = 0
  let main = -1
  const k0 = catchOff[c], k1 = catchBase[c]
  for (let k = k0; k < k1; k++) {
    const j = catchCell[k]
    const w = catchW[k] * capFarm[j]
    let v1 = 0, v2 = 0, y1 = 0, y2 = 0, b1 = -1
    for (let t = 0; t < ns; t++) {
      const r = rows[t] + j
      let v = val[r] * muls[t]
      if (hots[t] > 0 && hot[j]) v *= 1 + hots[t]
      if (v > v1) { v2 = v1; y2 = y1; v1 = v; y1 = v * ir[r]; b1 = t } else if (v > v2) { v2 = v; y2 = v * ir[r] }
    }
    let mc = v1 + second * v2, my = y1 + second * y2
    if (mc < floor) mc = floor
    if (my < floor) my = floor
    const tr = 1 + traction + (plough && plo[j] ? TECHNIQUE.ploughYield : 0)
    mc *= tr
    my *= tr
    if (k === k0 && b1 >= 0 && v1 >= floor) main = ids[b1]
    let mh = hunt, hy = hunt
    for (let t = 0; t < nh; t++) { const r = hrows[t] + j; const v = val[r]; if (v > mh) { mh = v; hy = v * ir[r] } }
    if (hy < hunt) hy = hunt
    const lf = liveFrac[j], rf = riverFishFrac[j]
    num += w * (rf + (1 - lf - rf) * mc + lf * mh)
    numY += w * (rf + (1 - lf - rf) * my + lf * hy)
    den += w
    lnum += w * lf * mh
    lden += w * lf
  }
  const raw = den > 0 ? num / den : floor
  let yld = den > 0 ? numY / den : floor
  if (yld > SPECIES.mulCap) yld = SPECIES.mulCap
  const f = normalised(yld) * (numY > 0 ? num / numY : 1)
  if (write) {
    sp.raw[id] = raw
    sp.cropMul[id] = f
    sp.liveAdj[id] = lden > 0 ? lnum / lden / raw : 1
    sp.main[id] = main
  }
  return f
}
/** The food system's multiplier for a raw yield multiplier: raw / norm, with gains above 1 damped (SPECIES.above). */
export function normalised(raw: number): number {
  const m = raw / SPECIES.norm
  return m > 1 ? 1 + SPECIES.above * (m - 1) : m
}
const ROWS = new Int32Array(64), MULS = new Float64Array(64), HOTS = new Float64Array(64), IDS = new Int32Array(64), HROWS = new Int32Array(64)

/**
 * Site factor for a group from settlement `from` at habitable cell c: what its species would make of the land there
 * relative to the old calibration (best single staple's crop part plus best herd's livestock part, normalised).
 */
export function siteFactor(s: HistoryState, from: number, c: number): number {
  return siteFactorAt(s, siteRows(s, from), c)
}

/**
 * The species rows siteFactorAt reads for settlement `from`'s groups: [staple count, staple row offsets..., herd row
 * offsets...] (hunting's row last). Valid until the next call.
 */
export function siteRows(s: HistoryState, from: number): Int32Array {
  const sp = s.sp
  const N = sp.N
  const m0 = sp.m0[from], m1 = sp.m1[from]
  const r = SITE_ROWS
  let n = 1
  for (const x of STAPLES) if (hasBit(m0, m1, x)) r[n++] = x * N
  r[0] = n - 1
  for (const x of HERDS) if (hasBit(m0, m1, x)) r[n++] = x * N
  r[n++] = S_COUNT * N
  r[n] = -1
  return r
}
const SITE_ROWS = new Int32Array(80)

/** siteFactor from rows given by siteRows. */
export function siteFactorAt(s: HistoryState, rows: Int32Array, c: number): number {
  const sp = s.sp
  const crop = sp.siteCrop, live = sp.siteLive
  const ns = rows[0]
  let a = 0
  for (let k = 1; k <= ns; k++) { const v = crop[rows[k] + c]; if (v > a) a = v }
  let b = 0
  for (let k = ns + 1; rows[k] >= 0; k++) { const v = live[rows[k] + c]; if (v > b) b = v }
  return a + b
}

/** Travel cost multipliers on desert and highland cells for settlement `id`'s groups and goods (camels, llamas): out[0..2] by move class. */
export function moveMuls(s: HistoryState, id: number, out: Float64Array): void {
  const sp = s.sp
  const m0 = sp.m0[id], m1 = sp.m1[id]
  out[0] = 1
  out[1] = hasBit(m0, m1, SP.camel) ? SPECIES_TABLE[SP.camel].desertMove : 1
  out[2] = hasBit(m0, m1, SP.llama) ? SPECIES_TABLE[SP.llama].mountainMove : 1
}

/**
 * Pack-animal factor on trade transport for settlement `id`: its best pack animal's over SPECIES.packRef (the ox cart the
 * old transport costs were calibrated with), at most 1: horses carry a little cheaper than oxen.
 */
export function packOf(s: HistoryState, id: number): number {
  const sp = s.sp
  const m0 = sp.m0[id], m1 = sp.m1[id]
  let best = 1
  for (const x of HERDS) if (hasBit(m0, m1, x) && SPECIES_TABLE[x].pack < best) best = SPECIES_TABLE[x].pack
  const f = best / SPECIES.packRef
  return f < 1 ? f : 1
}

/** True when settlement `id` keeps horses. */
export function hasHorse(s: HistoryState, id: number): boolean {
  return hasBit(s.sp.m0[id], s.sp.m1[id], SP.horse)
}

// ---------------------------------------------------------------------------------------------------------
// Gains

/** Settlement `id` takes up item x (species or technique) this year, from settlement `from` (-1: tamed, found or bred). */
function gainItem(s: HistoryState, id: number, x: number, from: number): void {
  const sp = s.sp
  const b = itemBit(x)
  if (b < 32) sp.m0[id] = (sp.m0[id] | (1 << b)) >>> 0
  else sp.m1[id] = (sp.m1[id] | (1 << (b - 32))) >>> 0
  sp.dull0[id] = 0
  sp.dull1[id] = 0
  sp.benUntil[id] = 0
  cropOf(s, id, sp.m0[id], sp.m1[id], true)
  const p = s.people[id]
  if (b < 32) sp.pm0[p] = (sp.pm0[p] | (1 << b)) >>> 0
  else sp.pm1[p] = (sp.pm1[p] | (1 << (b - 32))) >>> 0
  const key = p * ITEMS + x
  if (sp.year[key] >= 0) return
  sp.year[key] = s.year
  const srcPeople = from >= 0 && s.people[from] !== p ? s.people[from] : -1
  sp.source[key] = srcPeople
  if (x < S_COUNT) {
    if (sp.firstYear[x] < 0) { sp.firstYear[x] = s.year; sp.firstHolder[x] = id }
    if (srcPeople >= 0) logEvent(s, EventType.SpeciesAdopted, id, from, x)
    else logEvent(s, EventType.Domesticated, id, -1, x)
  } else sp.techLog.push(s.year, p, x - S_COUNT, id)
}

/**
 * A settlement was just founded (state.found): an original tribe holds its cradle's founding set, any other
 * settlement its parent's species. Its crop multiplier is reckoned.
 */
export function speciesOnFounded(s: HistoryState, id: number): void {
  const sp = s.sp
  ensureSettlements(sp, s.count)
  const parent = s.parent[id]
  sp.firstChild[id] = -1
  sp.nextSibling[id] = -1
  sp.dull0[id] = 0
  sp.dull1[id] = 0
  sp.dullYear[id] = s.year
  sp.benUntil[id] = 0
  // First spread step: the next year y > founding with y = id (mod spreadStep).
  const st = SPECIES.spreadStep
  let d = s.year + 1 + ((((id - s.year - 1) % st) + st) % st)
  if (d <= s.year) d += st
  sp.due[id] = d
  while (sp.sight.length < s.count) sp.sight.push(null)
  sp.epiLeft[id] = 0
  sp.epiRate[id] = 0
  if (parent >= 0) {
    sp.m0[id] = sp.m0[parent]
    sp.m1[id] = sp.m1[parent]
    sp.epiWave[id] = sp.epiWave[parent]
    sp.nextSibling[id] = sp.firstChild[parent]
    sp.firstChild[parent] = id
  } else {
    const p = s.people[id]
    sp.m0[id] = sp.found0[p]
    sp.m1[id] = sp.found1[p]
    sp.epiWave[id] = -1
    sp.pm0[p] = (sp.pm0[p] | sp.m0[id]) >>> 0
    sp.pm1[p] = (sp.pm1[p] | sp.m1[id]) >>> 0
    for (let x = 0; x < S_COUNT; x++) {
      if (!hasBit(sp.m0[id], sp.m1[id], itemBit(x))) continue
      sp.year[p * ITEMS + x] = 0
      if (sp.firstYear[x] < 0) { sp.firstYear[x] = 0; sp.firstHolder[x] = id }
    }
  }
  cropOf(s, id, sp.m0[id], sp.m1[id], true)
}

/** A seaborne colony (voyages.ts) carries only part of its parent's species: plants mostly, animals at their sea-carry odds; always a staple. */
export function speciesSeaKit(s: HistoryState, id: number): void {
  const sp = s.sp
  const rng = sp.rng
  const m0 = sp.m0[id], m1 = sp.m1[id]
  // Techniques travel with the people; species at their odds.
  let k0 = 0, k1 = TECH_BIT >= 32 ? m1 & ~((1 << (TECH_BIT - 32)) - 1) : 0
  let anyStaple = false
  const keep = (x: number): void => { const b = itemBit(x); if (b < 32) k0 |= 1 << b; else k1 |= 1 << (b - 32) }
  for (let x = 0; x < S_COUNT; x++) {
    if (!hasBit(m0, m1, itemBit(x))) continue
    if (rng.next() < SPECIES_TABLE[x].seaCarry) {
      keep(x)
      if (SPECIES_TABLE[x].category === SpeciesCategory.Staple) anyStaple = true
    }
  }
  if (!anyStaple) {
    // The settlers' seed corn: the parent's main staple (or its first held).
    const par = s.parent[id]
    let x = par >= 0 ? sp.main[par] : -1
    if (x < 0 || !hasBit(m0, m1, x)) for (const y of STAPLES) if (hasBit(m0, m1, y)) { x = y; break }
    if (x >= 0) keep(x)
  }
  sp.m0[id] = k0 >>> 0
  sp.m1[id] = k1 >>> 0
  sp.dull0[id] = 0
  sp.dull1[id] = 0
  sp.benUntil[id] = 0
  cropOf(s, id, sp.m0[id], sp.m1[id], true)
}

/** Most settlements of other peoples a settlement keeps track of for exchanging species. */
const SIGHT_LINKS = 12

/** Settlements a and b of different peoples see each other (knowledge.ts): each can take up the other's species. */
export function speciesSight(s: HistoryState, a: number, b: number): void {
  const sp = s.sp
  if (!sp) return
  while (sp.sight.length < s.count) sp.sight.push(null)
  // An expedition base stands for its parent.
  if (s.outpost[a]) a = s.parent[a]
  if (s.outpost[b]) b = s.parent[b]
  if (a < 0 || b < 0 || s.people[a] === s.people[b]) return
  addSight(sp, a, b)
  addSight(sp, b, a)
}
function addSight(sp: SpeciesState, a: number, b: number): void {
  let l = sp.sight[a]
  if (!l) { l = []; sp.sight[a] = l }
  if (l.indexOf(b) >= 0) return
  if (l.length >= SIGHT_LINKS) l.shift()
  l.push(b)
}

/** Benefit of item x for settlement id (0..1): the crop multiplier gain, plus range and transport for animals (cached a while per settlement). */
function benefitOf(s: HistoryState, id: number, x: number): number {
  const sp = s.sp
  if (sp.benUntil[id] <= s.year) {
    sp.ben.fill(-1, id * ITEMS, (id + 1) * ITEMS)
    sp.benUntil[id] = s.year + SPECIES.benefitYears
  }
  const key = id * ITEMS + x
  const cached = sp.ben[key]
  if (cached >= 0) return cached
  const now = sp.cropMul[id]
  const b = itemBit(x)
  const m0 = sp.m0[id], m1 = sp.m1[id]
  const n0 = b < 32 ? (m0 | (1 << b)) >>> 0 : m0
  const n1 = b < 32 ? m1 : (m1 | (1 << (b - 32))) >>> 0
  let gain = (cropOf(s, id, n0, n1, false) - now) / now
  if (x < S_COUNT && SPECIES_TABLE[x].category === SpeciesCategory.Livestock) {
    const c = s.cell[id]
    if (x === SP.horse) gain += 0.06
    if (x === SP.camel) gain += 0.4 * sp.desertNear[c]
    if (x === SP.llama) gain += 0.3 * sp.highNear[c]
    const pk = SPECIES_TABLE[x].pack / SPECIES.packRef
    if (s.pop[id] >= 400) { const cur = packOf(s, id); if (pk < cur) gain += 0.3 * (cur - pk) }
  }
  const v = smoothstep(SPECIES.gainLow, SPECIES.gainHigh, gain)
  sp.ben[key] = v
  return v
}

// ---------------------------------------------------------------------------------------------------------
// Yearly system

/** Rebuilds the per-settlement lists of open trade routes. */
function rebuildRoutes(s: HistoryState, sp: SpeciesState, tv: RouteView): void {
  const S = s.count
  if (sp.routeOff.length < S + 1) sp.routeOff = new Int32Array(Math.max(S + 1, 2 * sp.routeOff.length))
  const off = sp.routeOff
  off.fill(0, 0, S + 1)
  const list = tv.openList
  for (let t = 0; t < list.length; t++) { const r = list[t]; off[tv.rA[r] + 1]++; off[tv.rB[r] + 1]++ }
  for (let i = 0; i < S; i++) off[i + 1] += off[i]
  const n = off[S]
  if (sp.routeTo.length < n) { sp.routeTo = new Int32Array(2 * n); sp.routeVol = new Float64Array(2 * n) }
  const fill = FILL.length >= S ? FILL : (FILL = new Int32Array(2 * S))
  for (let i = 0; i < S; i++) fill[i] = off[i]
  for (let t = 0; t < list.length; t++) {
    const r = list[t]
    const a = tv.rA[r], b = tv.rB[r], v = tv.rVol[r]
    sp.routeTo[fill[a]] = b; sp.routeVol[fill[a]++] = v
    sp.routeTo[fill[b]] = a; sp.routeVol[fill[b]++] = v
  }
  sp.routeN = S
}
let FILL = new Int32Array(0)

/**
 * System (end of year): epidemics run their course; every SPECIES.spreadStep years per settlement (staggered by id),
 * domestication and adoption; every SPECIES.step years per people, techniques and disease loads; the crop multipliers
 * of labour-heavy staples' holders are refreshed every SPECIES.refresh years (staggered by id).
 */
export function speciesSystem(s: HistoryState, tv: RouteView): void {
  const sp = s.sp
  ensureSettlements(sp, s.count)
  runWaves(s, sp)
  const step = SPECIES.spreadStep
  const year = s.year
  const living = s.living
  if (year % SPECIES.step === 0 || sp.routeN === 0) rebuildRoutes(s, sp, tv)
  const due = sp.due
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    if (due[id] > year) continue
    // (Due every spreadStep years, staggered by id; every refresh-th of those the crop multiplier is refreshed first
    // where labour-heavy staples are held: they pay more as land grows scarce.)
    due[id] = year + step
    if (((year / step) | 0) % REFRESH_STEPS === id % REFRESH_STEPS && ((sp.m0[id] & LABOUR0) !== 0 || (sp.m1[id] & LABOUR1) !== 0)) cropOf(s, id, sp.m0[id], sp.m1[id], true)
    spreadAt(s, sp, id)
  }
  if (year % SPECIES.step === 0) peoplePass(s, sp)
}

/** Domestication and adoption at settlement `id` (see the header). */
function spreadAt(s: HistoryState, sp: SpeciesState, id: number): void {
  const T = s.terrain
  const c = s.cell[id]
  const p = s.people[id]
  const rng = sp.rng
  if (s.year - sp.dullYear[id] >= 100) { sp.dull0[id] = 0; sp.dull1[id] = 0; sp.dullYear[id] = s.year }
  // What it lacks that could be of use: not held, fitting its land, not found useless lately.
  const skip0 = sp.m0[id] | sp.unfit0[c] | sp.dull0[id], skip1 = sp.m1[id] | sp.unfit1[c] | sp.dull1[id]
  const pop = s.pop[id]
  const push = s.year - s.lastFamine[id] <= SPECIES.pushYears ? SPECIES.push : 1
  // Domestication: wild ranges the fields touch.
  const w0 = sp.catchRange0[c] & ~skip0, w1 = sp.catchRange1[c] & ~skip1
  if (w0 !== 0 || w1 !== 0) {
    const farm = s.tech[p * TECH_FIELD_COUNT + TechField.Farming]
    const base = SPECIES.domesticate * SPECIES.spreadStep * (pop / (pop + SPECIES.domHalf)) * farm
    for (let x = 0; x < S_COUNT; x++) {
      if (!hasBit(w0, w1, itemBit(x)) || hasBit(sp.m0[id], sp.m1[id], itemBit(x))) continue
      const ben = benefitOf(s, id, x)
      if (ben <= 0) { dull(sp, id, x); continue }
      if (rng.next() < base * ben) gainItem(s, id, x, -1)
    }
  }
  // Links: parent and children, settlements within the reach of its fields, trade partners, those seen of other peoples.
  LINK_N = 0
  LINK_SKIP0 = sp.m0[id] | sp.unfit0[c] | sp.dull0[id]
  LINK_SKIP1 = sp.m1[id] | sp.unfit1[c] | sp.dull1[id]
  linkTo(s, sp, id, p, s.parent[id], 0)
  for (let ch = sp.firstChild[id]; ch >= 0; ch = sp.nextSibling[ch]) linkTo(s, sp, id, p, ch, 0)
  const occ = s.occupant
  const near = SPECIES.linkHops
  const { catchCell, catchDist } = T
  for (let k = T.catchOff[c], e = T.catchOff[c + 1]; k < e && catchDist[k] <= near; k++) { const o = occ[catchCell[k]]; if (o >= 0 && o !== id) linkTo(s, sp, id, p, o, 0) }
  if (id < sp.routeN) for (let k = sp.routeOff[id]; k < sp.routeOff[id + 1]; k++) linkTo(s, sp, id, p, sp.routeTo[k], sp.routeVol[k])
  const seen = id < sp.sight.length ? sp.sight[id] : null
  if (seen) for (let k = 0; k < seen.length; k++) linkTo(s, sp, id, p, seen[k], 0)
  const bridge = sp.linkBridge, from = sp.linkFrom, links = sp.linkCount, cand = LINK_CAND
  // Anything its own people grows elsewhere: seed and stock pass along the people's own ways (markets, kin).
  const i0 = sp.pm0[p] & ~LINK_SKIP0, i1 = sp.pm1[p] & ~LINK_SKIP1
  if (i0 !== 0 || i1 !== 0) {
    for (let x = 0; x < ITEMS; x++) {
      if (!hasBit(i0, i1, itemBit(x))) continue
      let seenX = false
      for (let t = 0; t < LINK_N && !seenX; t++) if (cand[t] === x) seenX = true
      if (seenX) continue
      const ben = benefitOf(s, id, x)
      if (ben <= 0) { dull(sp, id, x); continue }
      if (rng.next() < SPECIES.inPeople * DECADES * ben * push) gainItem(s, id, x, -1)
    }
  }
  for (let t = 0; t < LINK_N; t++) {
    const x = cand[t]
    const br = bridge[x]
    const k = from[x]
    const n0 = links[x]
    bridge[x] = 0; from[x] = -1; links[x] = 0
    if (hasBit(sp.m0[id], sp.m1[id], itemBit(x))) continue
    let rate: number
    if (x < S_COUNT) {
      const d = SPECIES_TABLE[x]
      rate = d.adopt
      if (d.category === SpeciesCategory.Staple && s.people[k] !== p) rate *= SPECIES.novelty
    } else rate = TECHNIQUE.adopt[x - S_COUNT]
    const ben = benefitOf(s, id, x)
    if (ben <= 0) { dull(sp, id, x); continue }
    // More neighbours who have it, more chances (the best link counts fully, each further one half, at most `links` in all).
    let n = 1 + 0.5 * (n0 - 1)
    if (n > SPECIES.links) n = SPECIES.links
    if (rng.next() < rate * DECADES * ben * br * push * n) gainItem(s, id, x, k)
  }
}
/** Decades between a settlement's spread steps (rates are per decade); spread steps between crop refreshes. */
const DECADES = SPECIES.spreadStep / 10
const REFRESH_STEPS = Math.max(1, Math.round(SPECIES.refresh / SPECIES.spreadStep))
/** Scratch of spreadAt: items some link offers (LINK_N of them, bridge / from / count in the species state), and what to skip. */
let LINK_N = 0, LINK_SKIP0 = 0, LINK_SKIP1 = 0
const LINK_CAND = new Int32Array(64)

/** Settlement `id` (people p) looks at what settlement k has that it lacks; `trade`: loads a year on their route. */
function linkTo(s: HistoryState, sp: SpeciesState, id: number, p: number, k: number, trade: number): void {
  if (k < 0 || k === id || s.abandoned[k] >= 0 || s.outpost[k]) return
  const a0 = sp.m0[k] & ~LINK_SKIP0, a1 = sp.m1[k] & ~LINK_SKIP1
  if (a0 === 0 && a1 === 0) return
  const q = s.people[k]
  let br: number
  if (q === p) br = SPECIES.within
  else {
    if (s.know.contact[p * s.know.P + q] < 0 || !SPECIES.exchange) return
    br = SPECIES.cross + (SPECIES.crossTrade * trade) / (trade + SPECIES.tradeHalf)
  }
  const bridge = sp.linkBridge, from = sp.linkFrom, links = sp.linkCount
  for (let m = a0; m !== 0; m &= m - 1) {
    const x = 31 - Math.clz32(m & -m) // (species ids are their bits below 32)
    if (links[x]++ === 0) LINK_CAND[LINK_N++] = x
    if (bridge[x] < br) { bridge[x] = br; from[x] = k }
  }
  for (let m = a1; m !== 0; m &= m - 1) {
    const b = 63 - Math.clz32(m & -m)
    const x = b >= TECH_BIT ? S_COUNT + b - TECH_BIT : b
    if (links[x]++ === 0) LINK_CAND[LINK_N++] = x
    if (bridge[x] < br) { bridge[x] = br; from[x] = k }
  }
}

function dull(sp: SpeciesState, id: number, x: number): void {
  const b = itemBit(x)
  if (b < 32) sp.dull0[id] = (sp.dull0[id] | (1 << b)) >>> 0
  else sp.dull1[id] = (sp.dull1[id] | (1 << (b - 32))) >>> 0
}

/** Every SPECIES.step years: per people, techniques found and disease loads. */
function peoplePass(s: HistoryState, sp: SpeciesState): void {
  const P = sp.P
  const living = s.living
  const pop = PPOP.length >= P ? PPOP : (PPOP = new Float64Array(P))
  const town = PTOWN.length >= P ? PTOWN : (PTOWN = new Float64Array(P))
  const riceHot = PRICE.length >= P ? PRICE : (PRICE = new Float64Array(P))
  const plough = PPLOUGH.length >= P ? PPLOUGH : (PPLOUGH = new Float64Array(P))
  pop.fill(0); town.fill(0); riceHot.fill(0); plough.fill(0)
  const bestRice = BRICE.length >= P ? BRICE : (BRICE = new Int32Array(P))
  const bestCereal = BCER.length >= P ? BCER : (BCER = new Int32Array(P))
  const bestPlough = BPLO.length >= P ? BPLO : (BPLO = new Int32Array(P))
  bestRice.fill(-1); bestCereal.fill(-1); bestPlough.fill(-1)
  sp.pm0.fill(0)
  sp.pm1.fill(0)
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const p = s.people[id]
    const x = s.pop[id]
    sp.pm0[p] |= sp.m0[id]
    sp.pm1[p] |= sp.m1[id]
    pop[p] += x
    if (x >= TOWN_POPULATION) town[p] += x
    const c = s.cell[id]
    const m0 = sp.m0[id], m1 = sp.m1[id]
    if (sp.main[id] === SP.paddyRice && sp.hot[c] && !hasBit(m0, m1, TECH_BIT + TQ.earlyRice)) {
      riceHot[p] += x
      if (bestRice[p] < 0 || x > s.pop[bestRice[p]]) bestRice[p] = id
    }
    if ((hasBit(m0, m1, SP.wheat) || hasBit(m0, m1, SP.barley) || hasBit(m0, m1, SP.sorghum)) && !hasBit(m0, m1, TECH_BIT + TQ.rotation)) {
      if (bestCereal[p] < 0 || x > s.pop[bestCereal[p]]) bestCereal[p] = id
    }
    if (hasBit(m0, m1, SP.cattle) && !hasBit(m0, m1, TECH_BIT + TQ.heavyPlough) && sp.plough[c]) {
      plough[p] += x
      if (bestPlough[p] < 0 || x > s.pop[bestPlough[p]]) bestPlough[p] = id
    }
  }
  const rng = sp.rng
  const X = TECHNIQUE
  for (let p = 0; p < P; p++) {
    if (pop[p] <= 0) continue
    const o = p * TECH_FIELD_COUNT
    const yr = (x: number) => sp.year[p * ITEMS + x]
    // Early-ripening rice: bred where paddy has long been grown in hot lowlands.
    if (bestRice[p] >= 0 && yr(SP.paddyRice) >= 0 && s.year - yr(SP.paddyRice) >= X.riceHeld) {
      if (rng.next() < X.riceChance * (riceHot[p] / pop[p])) gainItem(s, bestRice[p], S_COUNT + TQ.earlyRice, -1)
    }
    if (bestCereal[p] >= 0 && s.tech[o + TechField.Farming] >= X.rotationFarming) {
      if (rng.next() < X.rotationChance) gainItem(s, bestCereal[p], S_COUNT + TQ.rotation, -1)
    }
    if (bestPlough[p] >= 0 && s.tech[o + TechField.Metalworking] >= X.ploughMetal) {
      if (rng.next() < X.ploughChance * (plough[p] / pop[p])) gainItem(s, bestPlough[p], S_COUNT + TQ.heavyPlough, -1)
    }
    // Disease load: herds held long, and towns.
    let keep = 1
    for (const x of HERDS) {
      const y = yr(x)
      if (y < 0) continue
      const age = s.year - y
      keep *= 1 - (SPECIES_TABLE[x].disease * age) / (age + DISEASE.ageHalf)
    }
    const L = 1 - keep
    const U = town[p] / pop[p]
    const target = L * (DISEASE.townBase + (1 - DISEASE.townBase) * U)
    sp.disease[p] += SPECIES.step * DISEASE.rate * (target - sp.disease[p])
  }
  // Diseases also seep along contacts: each people moves toward share * the heaviest load among those it has met.
  const D = sp.disease
  const contact = s.know.contact
  for (let p = 0; p < P; p++) {
    if (pop[p] <= 0) continue
    let top = 0
    for (let q = 0; q < P; q++) if (q !== p && pop[q] > 0 && contact[p * P + q] >= 0 && D[q] > top) top = D[q]
    const t = DISEASE.share * top
    if (t > D[p]) SEEP[p] = D[p] + SPECIES.step * DISEASE.seep * (t - D[p])
    else SEEP[p] = D[p]
  }
  for (let p = 0; p < P; p++) if (pop[p] > 0) D[p] = SEEP[p]
}
const SEEP = new Float64Array(128)
let PPOP = new Float64Array(0), PTOWN = new Float64Array(0), PRICE = new Float64Array(0), PPLOUGH = new Float64Array(0)
let BRICE = new Int32Array(0), BCER = new Int32Array(0), BPLO = new Int32Array(0)

/**
 * Two peoples met this year through settlements a and b (knowledge.ts meet): if one carries a much heavier
 * crowd-disease load, an epidemic starts among the other, from the settlement through which they met.
 */
export function speciesOnContact(s: HistoryState, a: number, b: number): void {
  const sp = s.sp
  if (!sp) return
  const pa = s.people[a], pb = s.people[b]
  const g = sp.disease[pa] - sp.disease[pb]
  if (g > DISEASE.gap) startWave(s, sp, pb, pa, b, a, g)
  else if (-g > DISEASE.gap) startWave(s, sp, pa, pb, a, b, -g)
}

function startWave(s: HistoryState, sp: SpeciesState, q: number, p: number, at: number, from: number, gap: number): void {
  let m = DISEASE.slope * (gap - DISEASE.offset)
  if (m > DISEASE.max) m = DISEASE.max
  const share = DISEASE.share * sp.disease[p]
  if (s.year - sp.lastEpidemic[q] < DISEASE.cooldown) {
    // Still reeling from the last one (and seasoned by it): the new sicknesses pass with no great dying.
    if (sp.disease[q] < share) sp.disease[q] = share
    return
  }
  if (m <= 0) return
  sp.lastEpidemic[q] = s.year
  let before = 0
  for (let t = 0; t < s.living.length; t++) { const id = s.living[t]; if (s.people[id] === q) before += s.pop[id] }
  sp.waves.push({ q, p, year: s.year, cell: s.cell[at], mortality: m, at, from, done: false })
  sp.activeWaves++
  sp.epiLog.push(s.year, q, p, m, before)
  logEvent(s, EventType.Epidemic, at, from, m)
  if (sp.disease[q] < share) sp.disease[q] = share
}

/** Epidemic waves spread outward and take their toll. */
function runWaves(s: HistoryState, sp: SpeciesState): void {
  if (sp.sick === 0 && sp.activeWaves === 0) return
  const living = s.living
  const P = s.world.grid.positions
  let active = 0
  for (let w = 0; w < sp.waves.length; w++) {
    const wave = sp.waves[w]
    if (wave.done) continue
    const r = DISEASE.speed * (s.year - wave.year)
    const r2 = r * r
    let left = 0
    const rate = wave.mortality / DISEASE.years
    for (let t = 0; t < living.length; t++) {
      const id = living[t]
      if (s.people[id] !== wave.q || sp.epiWave[id] === w) continue
      if (chord2(P, s.cell[id], wave.cell) > r2) { left++; continue }
      sp.epiWave[id] = w
      sp.epiLeft[id] = DISEASE.years
      sp.epiRate[id] = rate
      sp.sick++
    }
    if (left === 0 || r > 2.01) wave.done = true
    else active++
  }
  sp.activeWaves = active
  let sick = 0
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    if (sp.epiLeft[id] <= 0) continue
    sp.epiLeft[id]--
    s.pop[id] *= 1 - sp.epiRate[id]
    if (sp.epiLeft[id] > 0) sick++
  }
  sp.sick = sick
}

/** A returning expedition (exploration.ts) brings home what it saw: wild species near its way and those of peoples it met. */
export function speciesExpedition(s: HistoryState, id: number, path: readonly number[]): void {
  const sp = s.sp
  const rng = sp.rng
  const c = s.cell[id]
  const N = sp.N
  let w0 = 0, w1 = 0
  for (let k = 0; k < path.length; k++) { w0 |= sp.range0[path[k]]; w1 |= sp.range1[path[k]] }
  w0 &= ~sp.m0[id]; w1 &= ~sp.m1[id]
  if (w0 !== 0 || w1 !== 0) {
    for (let x = 0; x < S_COUNT; x++) {
      if (!hasBit(w0, w1, x) || sp.fitCatch[x * N + c] < SPECIES.minFit) continue
      if (rng.next() < SPECIES.expedition * benefitOf(s, id, x)) gainItem(s, id, x, -1)
    }
  }
  // Settlements of peoples met on the way.
  const p = s.people[id]
  for (let k = 0; k < path.length; k++) {
    const o = s.occupant[path[k]]
    if (o < 0 || s.outpost[o] || s.people[o] === p || s.know.contact[p * s.know.P + s.people[o]] < 0 || !SPECIES.exchange) continue
    const a0 = sp.m0[o] & ~sp.m0[id], a1 = sp.m1[o] & ~sp.m1[id]
    if (a0 === 0 && a1 === 0) continue
    for (let x = 0; x < S_COUNT; x++) {
      if (!hasBit(a0, a1, x) || sp.fitCatch[x * N + c] < SPECIES.minFit) continue
      if (rng.next() < SPECIES.expedition * benefitOf(s, id, x)) gainItem(s, id, x, o)
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Land layers and assembly

/**
 * Main staple and herd of each farmed cell (land use > 0 in the snapshot), from the settlement with the largest
 * claim on it: the one it holds that yields most there, species id + 1, or 0 (none of its staples / herds grows there
 * at all, or nobody claims the fields any more).
 */
export function speciesLandSnapshot(s: HistoryState, crop: Uint8Array, herdOut: Uint8Array, o: number): void {
  const sp = s.sp
  const T = s.terrain
  const N = sp.N
  const { catchOff, catchBase, catchCell, catchW, catchDist } = T
  const best = sp.claimBest, who = sp.claimWho, stamp = sp.claimStamp
  const run = ++sp.claimRun
  const living = s.living
  const list = CLAIMED.length >= N ? CLAIMED : (CLAIMED = new Int32Array(N))
  let n = 0
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const c = s.cell[id]
    const p = s.pop[id]
    const st = Math.sqrt(p * Math.sqrt(p))
    const big = p > CATCHMENT.reachLow
    const r1 = big ? CATCHMENT.hops + (CATCHMENT.maxHops - CATCHMENT.hops) * smoothstep(CATCHMENT.reachLow, CATCHMENT.reachHigh, p) + 1 : 0
    const base = catchBase[c]
    const end = big ? catchOff[c + 1] : base
    for (let k = catchOff[c]; k < end; k++) {
      let f = 1
      if (k >= base) { f = r1 - catchDist[k]; if (f <= 0) break; if (f > 1) f = 1 }
      const j = catchCell[k]
      const v = f * catchW[k] * st
      if (stamp[j] !== run) { stamp[j] = run; best[j] = v; who[j] = id; list[n++] = j }
      else if (v > best[j]) { best[j] = v; who[j] = id }
    }
  }
  const use = s.landUse
  const val = sp.val
  const liveFrac = T.liveFrac
  for (let t = 0; t < n; t++) {
    const j = list[t]
    if (((use[j] * 255 + 0.5) | 0) === 0) continue
    const id = who[j]
    const m0 = sp.m0[id], m1 = sp.m1[id]
    const early = hasBit(m0, m1, TECH_BIT + TQ.earlyRice)
    let bc = -1, bv = 0
    for (const x of STAPLES) {
      if (!hasBit(m0, m1, x)) continue
      const row = x === SP.paddyRice && early ? S_COUNT : x
      let v = val[row * N + j]
      if (x === SP.paddyRice && early && sp.hot[j]) v *= 1 + TECHNIQUE.riceYield
      if (v > bv) { bv = v; bc = x }
    }
    if (bc >= 0) crop[o + j] = bc + 1
    let bh = -1, hv = 0
    if (liveFrac[j] > 0) {
      for (const x of HERDS) {
        if (!hasBit(m0, m1, x)) continue
        const v = val[x * N + j]
        if (v > hv) { hv = v; bh = x }
      }
    }
    if (bh >= 0) herdOut[o + j] = bh + 1
  }
}

let CLAIMED = new Int32Array(0)

/** Species of this world for History.species: names in the language of the settlement that first held each (prefix-stable). */
export function assembleSpecies(world: World, sp: SpeciesState, naming: SettlementNaming, peoples: People[], founders: readonly number[], cellOf: (id: number) => number): SpeciesInfo[] {
  // Naming order: by first year held, then id; never-held species last (named in the language of the people founded nearest their origin).
  const order: number[] = []
  for (let x = 0; x < S_COUNT; x++) order.push(x)
  order.sort((a, b) => {
    const ya = sp.firstYear[a] < 0 ? 1e9 : sp.firstYear[a], yb = sp.firstYear[b] < 0 ? 1e9 : sp.firstYear[b]
    return ya - yb || a - b
  })
  const used = new Set<string>()
  for (const p of peoples) used.add(p.name.toLowerCase())
  const names: string[] = new Array<string>(S_COUNT).fill('')
  const P = world.grid.positions
  for (const x of order) {
    let namer = sp.firstHolder[x]
    let lang
    if (namer >= 0) lang = naming.language(naming.tribe[namer], naming.level[namer])
    else {
      let best = 0, bd = 1e9
      const o = sp.origins[x][0] ?? 0
      for (let p = 0; p < founders.length; p++) { const d = chord2(P, cellOf(founders[p]), o); if (d < bd) { bd = d; best = p } }
      namer = founders[best]
      lang = naming.language(naming.tribe[namer], 0)
    }
    const rng = createRng(world.seed, `names-species-${x}`)
    let name = ''
    for (let attempt = 0; attempt < 400 && !name; attempt++) {
      let w = buildRoot(lang, rng)
      if (rng.next() < 0.35) {
        const f = fuseWords(lang, w, buildMorph(lang, rng, 2, true))
        if (f !== null && letterCount(f) <= 9) w = f
      }
      if (letterCount(w) >= 3 && !used.has(w.toLowerCase())) name = w.toLowerCase()
    }
    if (!name) name = SPECIES_TABLE[x].archetype.toLowerCase() + x // practically unreachable
    used.add(name)
    names[x] = name
  }
  const out: SpeciesInfo[] = []
  for (let x = 0; x < S_COUNT; x++) {
    const d = SPECIES_TABLE[x]
    out.push({ id: x, archetype: d.archetype, category: d.category, name: names[x], origins: sp.origins[x].slice(), yield: d.category === SpeciesCategory.Staple ? d.yield : 0 })
  }
  return out
}

/** speciesYear and speciesSource for History (species items only, P * S_COUNT), each with its own buffer. */
export function speciesTables(sp: SpeciesState): { year: Int16Array; source: Int8Array; techYear: Int16Array } {
  const P = sp.P
  const year = new Int16Array(P * S_COUNT)
  const source = new Int8Array(P * S_COUNT)
  const techYear = new Int16Array(P * K_COUNT)
  for (let p = 0; p < P; p++) {
    for (let x = 0; x < S_COUNT; x++) { year[p * S_COUNT + x] = sp.year[p * ITEMS + x]; source[p * S_COUNT + x] = sp.source[p * ITEMS + x] }
    for (let k = 0; k < K_COUNT; k++) techYear[p * K_COUNT + k] = sp.year[p * ITEMS + S_COUNT + k]
  }
  return { year, source, techYear }
}
