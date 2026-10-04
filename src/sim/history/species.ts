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
//
// species-v2: 40 species (staples and herds first, ids < FOOD_COUNT, then fibre, luxury, stimulant and ornamental
// species: cash crops yield the goods Cloth, Luxury and Stimulant), ten techniques (History.techniques, logged as
// TechniqueFound / TechniqueAdopted; found in techniques.ts, spread here, between peoples mostly with trade). cropOf
// also ranks a cell's staples by yield * storability preference (the food counts the yield), applies blight (bmul) and
// livestock plague (herdKeep), terraces, dam-fed paddy, hardy barley, the legume companion and bred herds, and writes
// each staple's share of the crop food and the storage mix (storage.ts). A staple that would grow where none held does
// is worth taking up (uncovered). Site conditions (small islands, coasts) are relaxed on worlds where nothing meets
// them (fitCtx). The rest of v2 is in speciesV2.ts and the files it runs.

import { Biome, EventType, RIVER_FLOW_THRESHOLD, SpeciesCategory, TECH_FIELD_COUNT, TechField, TOWN_POPULATION } from '../../contract.ts'
import type { People, SpeciesInfo, TechniqueInfo, World } from '../../contract.ts'
import type { Rng } from '../rng.ts'
import { createRng } from '../rng.ts'
import { smoothstep } from '../util.ts'
import type { SettlementNaming } from '../names/index.ts'
import { buildMorph, buildRoot, fuseWords, letterCount } from '../names/words.ts'
import { CAPACITY, CATCHMENT, CRADLE, DISEASE, SPECIES, SPECIES2, TECHNIQUE, TECHNIQUE2, WEALTH } from './params.ts'
import type { HistoryState } from './state.ts'
import { logEvent } from './state.ts'
import type { CradlePlan } from './peoples.ts'
import type { SpeciesV2 } from './speciesV2.ts'

/** species-v2: migration.ts prosperity, inlined (no import cycle through the trade system). */
export function prosperityOf(s: HistoryState, id: number): number {
  const p = s.pop[id]
  if (p <= 0) return 0
  const w = s.wealth[id] / p
  const f = w / (w + WEALTH.half)
  const x = Math.sqrt(s.through[id] / WEALTH.hubRef)
  const h = x / (1 + x)
  return f > h ? f : h
}

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
  // species-v2: storage, blight, cash crops, habit (see the v2 header below the catalogue).
  /** Staples: share of the harvest that keeps in store (0..1); storeDrought: what counts against drought (cassava keeps in the ground). */
  store: number
  storeDrought: number
  /** Staples: drought sensitivity (weight on the weather shortfall). */
  sigma: number
  /** Soil wear multiplier of its fields (staples on their share of the land, cash crops on theirs). */
  wear: number
  /** Blight exposure factor: 1 seed crops, 2 (or more) clonal crops grown from cuttings. */
  clone: number
  /** Cash crops: the good it yields (Good id; -1 none), units of it per unit of food the land would give, the contract's worth per unit. */
  good: number
  cashYield: number
  value: number
  /** Stimulants: contract habit (0..1) and harm (0..1); sim effects: productivity loss and yearly extra mortality at full habit (negative: a small benefit). */
  habit: number
  harm: number
  harmEcon: number
  harmDeath: number
  /** Adoption from another people at this factor (secrets, monopolies; 1 for most); adoption ramps up with Crafts from crafts - 0.4 to crafts + 0.2 (0: no need). */
  cross: number
  crafts: number
  /** Conditions: a landmass of at most `island` cells (n = 48; 0 none); within `coast` plain hops of the sea (0 none); river cells count as wet (rainfall at least 0.3). */
  island: number
  coast: number
  riverWet: boolean
  /** Herds: share of the livestock food also yielding wool (Cloth). */
  wool: number
  /** Ornamentals and vines: adoption * TECHNIQUE2.graftAdopt once grafting is held. */
  graft: boolean
}

const B = (...ids: number[]): number => { let m = 0; for (const b of ids) m |= 1 << b; return m }

const V2_DEFAULTS = {
  store: 0.5, storeDrought: -1, sigma: 1, wear: 1, clone: 1, good: -1, cashYield: 0, value: 0, habit: 0, harm: 0, harmEcon: 0, harmDeath: 0,
  cross: 1, crafts: 0, island: 0, coast: 0, riverWet: false, wool: 0, graft: false,
}
function fill(d: SpeciesDef): SpeciesDef {
  if (d.storeDrought < 0) d.storeDrought = d.store
  return d
}

function staple(archetype: string, y: number, labour: number, adopt: number, t: Trap, r: Trap, more: Partial<SpeciesDef> = {}): SpeciesDef {
  return fill({
    archetype, category: SpeciesCategory.Staple, yield: y, labour, adopt, t, r, biomes: 0, eMin: -1, eMax: 2, water: false,
    floorBiomes: 0, floorAgri: 0, floorRain: 0, reliefCut: 0, origins: 1,
    hearthT: [0, 1], hearthR: [0, 1], hearthE: [-1, 2], hearthLat: 1, cereal: false,
    traction: 0, pack: 1, desertMove: 1, mountainMove: 1, disease: 0, seaCarry: 0.9, ...V2_DEFAULTS, ...more,
  })
}
function herd(archetype: string, y: number, adopt: number, biomes: number, t: Trap, r: Trap, more: Partial<SpeciesDef> = {}): SpeciesDef {
  return fill({
    archetype, category: SpeciesCategory.Livestock, yield: y, labour: 1, adopt, t, r, biomes, eMin: -1, eMax: 2, water: false,
    floorBiomes: 0, floorAgri: 0, floorRain: 0, reliefCut: 0, origins: 1,
    hearthT: [0, 1], hearthR: [0, 1], hearthE: [-1, 2], hearthLat: 1, cereal: false,
    traction: 0, pack: 1, desertMove: 1, mountainMove: 1, disease: 0, seaCarry: 0.5, ...V2_DEFAULTS, ...more,
  })
}
/** species-v2: fibre, luxury, stimulant and ornamental species (no food; cash crops yield `good`). */
function crop(archetype: string, category: SpeciesCategory, good: number, cashYield: number, adopt: number, t: Trap, r: Trap, more: Partial<SpeciesDef> = {}): SpeciesDef {
  return fill({
    archetype, category, yield: 0, labour: 1, adopt, t, r, biomes: 0, eMin: -1, eMax: 2, water: false,
    floorBiomes: 0, floorAgri: 0, floorRain: 0, reliefCut: 0, origins: 1,
    hearthT: [0, 1], hearthR: [0, 1], hearthE: [-1, 2], hearthLat: 1, cereal: false,
    traction: 0, pack: 1, desertMove: 1, mountainMove: 1, disease: 0, seaCarry: 0.7, ...V2_DEFAULTS, good, cashYield, ...more,
  })
}

const { TemperateForest: TF, Grassland: GR, Savanna: SV, Desert: DS, Mountain: MT, Taiga: TG, Tundra: TU, Rainforest: RF } = Biome
const { Fibre: FIB, Luxury: LUX, Stimulant: STI, Ornamental: ORN } = SpeciesCategory
/** Goods of the cash crops (contract Good ids). */
const CLOTH = 6, LUXG = 7, STIMG = 8

/**
 * The species of v1, in id order (tuned starting values from the design document; envelopes in the world's
 * temperature t and rainfall r, roughly t = (deg C + 12) / 40 and r = mm / 2500).
 */
export const SPECIES_TABLE: readonly SpeciesDef[] = [
  staple('wheat', 1.0, 1.0, 0.25, [0.35, 0.45, 0.68, 0.82], [0.1, 0.16, 0.36, 0.6], { eMax: 0.45, cereal: true, hearthT: [0.55, 0.7], hearthR: [0.14, 0.3], hearthE: [0.08, 0.35], store: 0.9, sigma: 1, wear: 1 }),
  staple('barley', 0.9, 0.9, 0.25, [0.24, 0.36, 0.7, 0.85], [0.07, 0.12, 0.36, 0.6], { cereal: true, hearthT: [0.45, 0.65], hearthR: [0.1, 0.25], store: 0.9, sigma: 0.9, wear: 0.9 }),
  staple('paddyRice', 1.8, 2.0, 0.15, [0.6, 0.72, 1, 1], [0.05, 0.15, 1, 1], { water: true, eMax: 0.35, origins: 2, hearthT: [0.75, 0.92], hearthR: [0.4, 0.75], store: 0.85, sigma: 0.7, wear: 0.4 }),
  staple('maize', 1.4, 1.0, 0.2, [0.5, 0.6, 0.92, 0.99], [0.15, 0.24, 0.55, 0.8], { hearthT: [0.7, 0.85], hearthR: [0.25, 0.45], hearthE: [0.12, 0.35], store: 0.75, sigma: 1.1, wear: 1.25 }),
  staple('potato', 1.9, 1.1, 0.15, [0.3, 0.4, 0.58, 0.76], [0.16, 0.28, 0.6, 0.85], {
    floorBiomes: B(MT, TG), floorAgri: 0.6, floorRain: 0.16, reliefCut: 0.75, hearthT: [0.4, 0.6], hearthE: [0.3, 2], hearthLat: 0.45, store: 0.2, sigma: 1, wear: 1.1, clone: 2,
  }),
  staple('cassava', 1.5, 0.6, 0.2, [0.68, 0.78, 1, 1], [0.18, 0.25, 0.9, 1], { eMax: 0.4, hearthT: [0.88, 1], hearthR: [0.4, 0.65], store: 0.1, storeDrought: 0.5, sigma: 0.5, wear: 0.8, clone: 2 }),
  staple('sorghum', 0.85, 0.8, 0.25, [0.62, 0.72, 1, 1], [0.06, 0.14, 0.32, 0.55], {
    cereal: true, floorBiomes: B(DS), floorAgri: 0.3, floorRain: 0.07, hearthT: [0.85, 1], hearthR: [0.14, 0.3], store: 0.85, sigma: 0.6, wear: 1,
  }),
  herd('cattle', 1.15, 0.2, B(GR, TF, SV, TG), [0.3, 0.38, 0.9, 0.97], [0.08, 0.15, 0.55, 0.7], {
    origins: 2, traction: 0.1, pack: 0.85, disease: 0.45, seaCarry: 0.5, hearthT: [0.5, 0.9], hearthR: [0.15, 0.4],
  }),
  herd('sheepGoat', 1.15, 0.3, B(MT, GR, SV, DS, TF), [0.25, 0.32, 1, 1], [0.03, 0.07, 0.45, 0.6], {
    floorBiomes: B(MT, DS), floorAgri: 0.3, floorRain: 0.05, disease: 0.2, seaCarry: 0.7, hearthT: [0.5, 0.75], hearthR: [0.1, 0.3], hearthE: [0.1, 0.5], wool: 0.08,
  }),
  herd('horse', 1.1, 0.2, B(GR, SV, TG), [0.25, 0.32, 0.72, 0.8], [0.05, 0.1, 0.35, 0.45], {
    traction: 0.05, pack: 0.8, disease: 0.15, seaCarry: 0.4, hearthT: [0.35, 0.6], hearthR: [0.08, 0.3],
  }),
  herd('camel', 1.15, 0.15, B(DS, GR, SV), [0.3, 0.45, 1, 1], [0, 0.02, 0.18, 0.26], {
    floorBiomes: B(DS), floorAgri: 0.2, floorRain: 0, pack: 0.85, desertMove: 0.45, disease: 0.1, seaCarry: 0.2, hearthT: [0.6, 1], hearthR: [0.03, 0.14],
  }),
  herd('llama', 0.95, 0.15, 0, [0.25, 0.32, 0.65, 0.75], [0.05, 0.12, 0.7, 0.9], {
    eMin: 0.28, floorBiomes: B(MT), floorAgri: 0.3, floorRain: 0.05, mountainMove: 0.85, disease: 0.05, seaCarry: 0.3, hearthT: [0.35, 0.6], hearthE: [0.3, 2], hearthLat: 0.45, wool: 0.04,
  }),
  // species-v2: the remaining staples.
  staple('millet', 0.7, 0.8, 0.25, [0.4, 0.5, 0.9, 1], [0.05, 0.09, 0.3, 0.5], {
    cereal: true, floorBiomes: B(DS), floorAgri: 0.3, floorRain: 0.07, origins: 2, hearthT: [0.5, 0.68], hearthR: [0.1, 0.22], store: 0.95, sigma: 0.6, wear: 0.9,
  }),
  staple('sweetPotato', 1.45, 0.9, 0.2, [0.6, 0.7, 1, 1], [0.18, 0.3, 0.7, 0.9], { reliefCut: 0.5, hearthT: [0.85, 1], hearthR: [0.4, 0.7], store: 0.3, sigma: 0.8, wear: 0.9, clone: 2 }),
  staple('yamTaro', 1.3, 1.5, 0.2, [0.72, 0.82, 1, 1], [0.3, 0.42, 1, 1], { origins: 2, hearthT: [0.85, 1], hearthR: [0.45, 0.8], store: 0.5, sigma: 0.8, wear: 0.9, clone: 2 }),
  staple('plantain', 1.2, 0.5, 0.2, [0.78, 0.86, 1, 1], [0.4, 0.55, 1, 1], { hearthT: [0.88, 1], hearthR: [0.55, 1], store: 0.05, sigma: 0.6, wear: 0.6, clone: 2.5 }),
  staple('pulse', 0.45, 0.9, 0.25, [0.35, 0.45, 0.85, 0.95], [0.1, 0.16, 0.5, 0.7], { origins: 2, hearthT: [0.55, 0.72], hearthR: [0.14, 0.3], store: 0.9, sigma: 0.9, wear: 0.5 }),
  // species-v2: the remaining livestock.
  herd('pig', 1.0, 0.3, B(TF, RF, SV), [0.4, 0.5, 1, 1], [0.2, 0.3, 1, 1], { origins: 2, disease: 0.3, seaCarry: 0.8, hearthT: [0.5, 0.9], hearthR: [0.3, 0.7] }),
  herd('buffalo', 1.2, 0.2, B(RF, SV, GR), [0.65, 0.72, 1, 1], [0.3, 0.4, 1, 1], { traction: 0.12, disease: 0.2, seaCarry: 0.4, hearthT: [0.78, 0.95], hearthR: [0.4, 0.75] }),
  herd('coldHerd', 1.15, 0.2, B(TU, TG, MT), [0.04, 0.1, 0.38, 0.46], [0.02, 0.06, 0.6, 0.8], {
    origins: 2, floorBiomes: B(TU, TG), floorAgri: 0.3, floorRain: 0.02, disease: 0.05, seaCarry: 0.3, hearthT: [0.12, 0.32], hearthLat: 1, wool: 0.03,
  }),
  // species-v2: fibre and industrial.
  crop('cotton', FIB, CLOTH, 1.0, 0.15, [0.62, 0.74, 1, 1], [0.12, 0.18, 0.5, 0.65], { origins: 2, riverWet: true, wear: 1.6, value: 3, hearthT: [0.78, 0.95], hearthR: [0.15, 0.35] }),
  crop('flax', FIB, CLOTH, 0.8, 0.2, [0.35, 0.42, 0.65, 0.72], [0.15, 0.22, 0.5, 0.6], { wear: 1.1, value: 3, hearthT: [0.55, 0.68], hearthR: [0.16, 0.32] }),
  crop('hemp', FIB, CLOTH, 0.7, 0.2, [0.3, 0.38, 0.75, 0.82], [0.12, 0.18, 0.6, 0.7], { wear: 1, value: 2.5, hearthT: [0.4, 0.55], hearthR: [0.2, 0.45] }),
  crop('silk', FIB, LUXG, 0.12, 0.15, [0.5, 0.58, 0.82, 0.9], [0.25, 0.32, 0.6, 0.7], { eMax: 0.2, wear: 0.8, value: 30, cross: 0.05, crafts: 1.6, hearthT: [0.65, 0.8], hearthR: [0.35, 0.55] }),
  crop('bamboo', FIB, -1, 0, 0.15, [0.6, 0.68, 1, 1], [0.35, 0.45, 1, 1], { origins: 2, wear: 0.8, hearthT: [0.7, 0.9], hearthR: [0.45, 0.8] }),
  // species-v2: luxuries, spices and dyes.
  crop('sugarCane', LUX, LUXG, 0.25, 0.15, [0.75, 0.82, 1, 1], [0.35, 0.45, 1, 1], { riverWet: true, wear: 1.8, value: 12, crafts: 1.8, hearthT: [0.88, 1], hearthR: [0.5, 0.9] }),
  crop('grape', LUX, LUXG, 0.2, 0.1, [0.48, 0.55, 0.72, 0.78], [0.08, 0.12, 0.38, 0.45], { wear: 0.8, value: 8, graft: true, hearthT: [0.58, 0.7], hearthR: [0.12, 0.3] }),
  crop('pepper', LUX, LUXG, 0.2, 0.15, [0.82, 0.88, 1, 1], [0.5, 0.58, 1, 1], { coast: 1, wear: 0.9, value: 20, hearthT: [0.9, 1], hearthR: [0.6, 1] }),
  crop('cloveNutmeg', LUX, LUXG, 0.3, 0.06, [0.85, 0.9, 1, 1], [0.45, 0.6, 1, 1], { island: 20, wear: 0.7, value: 60, cross: 0.3, hearthT: [0.9, 1], hearthR: [0.6, 1] }),
  crop('incense', LUX, LUXG, 0.2, 0.08, [0.7, 0.76, 1, 1], [0.02, 0.04, 0.14, 0.2], { eMin: 0.04, eMax: 0.5, coast: 2, wear: 0.5, value: 25, hearthT: [0.8, 1], hearthE: [0.1, 0.4] }),
  crop('indigo', LUX, LUXG, 0.2, 0.15, [0.65, 0.72, 1, 1], [0.22, 0.28, 0.8, 0.9], { origins: 2, wear: 1.3, value: 12, hearthT: [0.8, 1], hearthR: [0.3, 0.6] }),
  crop('cochineal', LUX, LUXG, 0.2, 0.06, [0.6, 0.66, 0.88, 0.92], [0.08, 0.12, 0.35, 0.42], { eMin: 0.15, eMax: 0.65, wear: 0.6, value: 40, cross: 0.3, hearthT: [0.7, 0.85], hearthE: [0.2, 0.45] }),
  // species-v2: stimulants and narcotics (habit, harm; harmEcon / harmDeath are the sim's effects at full habit).
  crop('tea', STI, STIMG, 0.15, 0.12, [0.55, 0.62, 0.85, 0.9], [0.4, 0.48, 1, 1], { eMin: 0.06, eMax: 0.55, wear: 0.8, value: 10, habit: 0.5, harmEcon: -0.02, cross: 0.1, hearthT: [0.65, 0.8], hearthE: [0.1, 0.4] }),
  crop('coffee', STI, STIMG, 0.15, 0.08, [0.65, 0.72, 0.9, 0.95], [0.35, 0.42, 0.8, 0.9], { eMin: 0.15, eMax: 0.6, wear: 1.2, value: 10, habit: 0.5, harmEcon: -0.015, hearthT: [0.75, 0.88], hearthE: [0.2, 0.45] }),
  crop('cacao', STI, STIMG, 0.12, 0.08, [0.85, 0.9, 1, 1], [0.45, 0.52, 1, 1], { eMax: 0.2, wear: 1, value: 15, habit: 0.3, hearthT: [0.9, 1], hearthR: [0.55, 1] }),
  crop('tobacco', STI, STIMG, 0.25, 0.3, [0.5, 0.58, 1, 1], [0.15, 0.22, 0.7, 0.8], { wear: 2, value: 8, habit: 0.8, harm: 0.3, harmEcon: 0.015, harmDeath: 0.0004, hearthT: [0.7, 0.85], hearthR: [0.25, 0.45], hearthE: [0.1, 0.35] }),
  crop('poppy', STI, STIMG, 0.2, 0.12, [0.42, 0.48, 0.85, 0.9], [0.08, 0.12, 0.45, 0.55], { riverWet: true, wear: 1.1, value: 20, habit: 1, harm: 1, harmEcon: 0.05, harmDeath: 0.0008, hearthT: [0.55, 0.7], hearthR: [0.12, 0.3] }),
  crop('coca', STI, STIMG, 0.15, 0.08, [0.65, 0.72, 1, 1], [0.35, 0.42, 1, 1], { eMin: 0.12, eMax: 0.65, wear: 0.9, value: 6, habit: 0.6, harm: 0.1, harmEcon: 0.01, harmDeath: 0.0002, hearthT: [0.72, 0.88], hearthE: [0.25, 0.5] }),
  // species-v2: ornamentals (character and prestige only).
  crop('cherry', ORN, -1, 0, 0.03, [0.42, 0.48, 0.68, 0.74], [0.28, 0.34, 0.7, 0.8], { biomes: B(TF), graft: true, hearthT: [0.5, 0.65] }),
  crop('tulip', ORN, -1, 0, 0.04, [0.32, 0.38, 0.62, 0.68], [0.08, 0.12, 0.35, 0.42], { biomes: B(MT, GR), eMin: -1, graft: true, hearthT: [0.4, 0.6], hearthE: [0.2, 0.6] }),
]

export const S_COUNT = SPECIES_TABLE.length
export const SP = {
  wheat: 0, barley: 1, paddyRice: 2, maize: 3, potato: 4, cassava: 5, sorghum: 6, cattle: 7, sheepGoat: 8, horse: 9, camel: 10, llama: 11,
  millet: 12, sweetPotato: 13, yamTaro: 14, plantain: 15, pulse: 16, pig: 17, buffalo: 18, coldHerd: 19,
  cotton: 20, flax: 21, hemp: 22, silk: 23, bamboo: 24, sugarCane: 25, grape: 26, pepper: 27, cloveNutmeg: 28, incense: 29, indigo: 30, cochineal: 31,
  tea: 32, coffee: 33, cacao: 34, tobacco: 35, poppy: 36, coca: 37, cherry: 38, tulip: 39,
} as const
/** species-v2: species [0, FOOD_COUNT) are staples and herds (they have yield rows); the rest are cash crops and ornamentals. */
export const FOOD_COUNT = 20

/** Techniques and improved strains: bit TECH_BIT + k of a settlement's species mask (History.techniques). */
export const TECHNIQUES = ['earlyRice', 'rotation', 'heavyPlough', 'terrace', 'paddyIrrigation', 'nixtamal', 'freezeDrying', 'grafting', 'breeding', 'hardyGrain'] as const
export const K_COUNT = TECHNIQUES.length
export const TQ = { earlyRice: 0, rotation: 1, heavyPlough: 2, terrace: 3, irrigation: 4, nixtamal: 5, freezeDrying: 6, grafting: 7, breeding: 8, hardyGrain: 9 } as const
/** The species each technique applies to (-1: general), in TECHNIQUES order. */
export const TECHNIQUE_SPECIES: readonly number[] = [2, -1, 7, -1, 2, 3, 4, 26, -1, 1]
/** Mask bit of technique 0 (species use bits [0, TECH_BIT)). */
export const TECH_BIT = 48
/** Items: species ids [0, S_COUNT), then techniques at S_COUNT + k (index into per-people year arrays). */
export const ITEMS = S_COUNT + K_COUNT
/** species-v2: extra yield rows after the FOOD_COUNT species rows: early-ripening paddy, dam-irrigated paddy (no water rule), hardy barley. */
export const ROW_EARLY = FOOD_COUNT, ROW_IRRIG = FOOD_COUNT + 1, ROW_HARDY = FOOD_COUNT + 2
const ROWS_ALL = FOOD_COUNT + 3

const STAPLES: number[] = []
const HERDS: number[] = []
/** species-v2: fibre, luxury and stimulant species (cash crops), and the stimulants (History.stimulants order). */
export const CASH: number[] = []
export const STIMULANTS: number[] = []
for (let i = 0; i < S_COUNT; i++) {
  const c = SPECIES_TABLE[i].category
  if (c === SpeciesCategory.Staple) STAPLES.push(i)
  else if (c === SpeciesCategory.Livestock) HERDS.push(i)
  if (SPECIES_TABLE[i].good >= 0) CASH.push(i)
  if (c === SpeciesCategory.Stimulant) STIMULANTS.push(i)
}
export const NST = STAPLES.length
/** Index of each staple among the staples (-1 for other species), and the staples by that index. */
export const STAPLE_INDEX: Int32Array = new Int32Array(S_COUNT).fill(-1)
for (let t = 0; t < STAPLES.length; t++) STAPLE_INDEX[STAPLES[t]] = t
export const STAPLE_IDS: readonly number[] = STAPLES
export const HERD_IDS: readonly number[] = HERDS
/** Index of each stimulant species in STIMULANTS (-1 otherwise). */
export const STIM_INDEX: Int32Array = new Int32Array(S_COUNT).fill(-1)
for (let k = 0; k < STIMULANTS.length; k++) STIM_INDEX[STIMULANTS[k]] = k
/** species-v2: species whose marginal land makes cells habitable: the staples, and reindeer / yak herding on the tundra and taiga. */
const MARGINAL: number[] = STAPLES.concat([SP.coldHerd]).filter((x) => SPECIES_TABLE[x].floorBiomes !== 0 || SPECIES_TABLE[x].reliefCut > 0)
/** Mask words of the labour-heavy staples (their yield follows population pressure). */
let LABOUR0 = 0, LABOUR1 = 0
for (const x of STAPLES) if (SPECIES_TABLE[x].labour > 1) { if (x < 32) LABOUR0 |= 1 << x; else LABOUR1 |= 1 << (x - 32) }

/** Mask bit of item x (species id or S_COUNT + technique). */
export function itemBit(x: number): number {
  return x < S_COUNT ? x : TECH_BIT + (x - S_COUNT)
}
export function hasBit(m0: number, m1: number, b: number): boolean {
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

/**
 * species-v2: per-world cell context for the site conditions of a few species: size of each land cell's landmass,
 * plain hops to the sea (0 for coastal land, up to 3; 255 beyond), and per species whether its conditions are
 * relaxed on this world (1: no cell meets them, so the island condition becomes a coastal one; 2: the coastal one is
 * dropped too). Cached per world (computed once, read only).
 */
interface FitCtx { lmSize: Int32Array; coastHops: Uint8Array; relax: Uint8Array; islandScale: number }
const FIT_CTX = new WeakMap<World, FitCtx>()
function fitCtx(world: World): FitCtx {
  const got = FIT_CTX.get(world)
  if (got) return got
  const N = world.grid.cellCount
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const el = world.elevation
  const lmSize = new Int32Array(N)
  const label = new Int32Array(N).fill(-1)
  const queue = new Int32Array(N)
  for (let s0 = 0; s0 < N; s0++) {
    if (el[s0] < 0 || label[s0] >= 0) continue
    let tail = 0
    queue[tail++] = s0
    label[s0] = s0
    for (let h = 0; h < tail; h++) {
      const c = queue[h]
      for (let k = off[c]; k < off[c + 1]; k++) { const j = nb[k]; if (el[j] >= 0 && label[j] < 0) { label[j] = s0; queue[tail++] = j } }
    }
    for (let t = 0; t < tail; t++) lmSize[queue[t]] = tail
  }
  const coastHops = new Uint8Array(N).fill(255)
  let tail = 0
  for (let i = 0; i < N; i++) {
    if (el[i] < 0) continue
    for (let k = off[i]; k < off[i + 1]; k++) if (el[nb[k]] < 0) { coastHops[i] = 0; queue[tail++] = i; break }
  }
  for (let h = 0; h < tail; h++) {
    const c = queue[h]
    if (coastHops[c] >= 3) continue
    for (let k = off[c]; k < off[c + 1]; k++) { const j = nb[k]; if (el[j] >= 0 && coastHops[j] === 255) { coastHops[j] = coastHops[c] + 1; queue[tail++] = j } }
  }
  const ctx: FitCtx = { lmSize, coastHops, relax: new Uint8Array(S_COUNT), islandScale: N / 23042 }
  FIT_CTX.set(world, ctx)
  for (let x = 0; x < S_COUNT; x++) {
    const d = SPECIES_TABLE[x]
    if (d.island <= 0 && d.coast <= 0) continue
    for (let level = 0; level <= 2; level++) {
      ctx.relax[x] = level
      let ok = false
      for (let i = 0; i < N && !ok; i++) if (fitAt(world, d, i, false, x) >= 0.5) ok = true
      if (ok) break
    }
  }
  return ctx
}

/** Fit of species d at land cell i (0..1); `early`: paddy under the early-ripening strain's wetter water rule; `x`: d's id (for the site conditions). */
export function fitAt(world: World, d: SpeciesDef, i: number, early = false, x = -1): number {
  const e = world.elevation[i]
  const b = world.biome[i]
  if (e < 0 || world.lake[i] || b === Biome.Ice) return 0
  if (d.biomes !== 0 && ((d.biomes >>> b) & 1) === 0 && !(d.eMin > 0 && e >= d.eMin)) return 0
  if (e > d.eMax) return 0
  if (d.eMin > 0 && e < d.eMin && b !== Biome.Mountain) return 0
  let r = world.rainfall[i]
  if (d.riverWet && r < 0.3 && world.flow[i] >= RIVER_FLOW_THRESHOLD) r = 0.3 // species-v2: river water in dry land
  let f = trap(world.temperature[i], d.t) * trap(r, d.r)
  if (f <= 0) return 0
  if (d.water && !(early ? paddyWater(world, i, 0.3, 0.45, 0.15) : paddyWater(world, i, 0.5, 0.6, 0.08))) return 0
  if (d.island > 0 || d.coast > 0) {
    // species-v2: site conditions (a small island, near the coast; relaxed on worlds where nothing meets them).
    const ctx = fitCtx(world)
    const level = x >= 0 ? ctx.relax[x] : 0
    if (d.island > 0 && level === 0 && ctx.lmSize[i] > d.island * ctx.islandScale) return 0
    const coast = d.island > 0 && level === 1 ? 1 : d.coast
    if (coast > 0 && level < 2 && ctx.coastHops[i] >= coast && !(d.island <= 0 && d.coast === 1 && e >= 0.12)) return 0
  }
  return f
}
/** fitAt for species id x (its site conditions as relaxed on this world). */
export function fitOfSpecies(world: World, x: number, i: number): number {
  return fitAt(world, SPECIES_TABLE[x], i, false, x)
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
  for (const s of MARGINAL) {
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
      let f = fitAt(world, SPECIES_TABLE[s], i, false, s)
      if (strains && s === SP.paddyRice) {
        const g = fitAt(world, SPECIES_TABLE[s], i, true); if (g > f) f = g
        const h = fitAt(world, IRRIGATED_PADDY, i); if (h > f) f = h // (on dam-irrigated cells only, in fact)
      }
      if (strains && s === SP.barley) { const g = fitAt(world, HARDY_BARLEY, i); if (g > f) f = g }
      out[s * N + i] = f
    }
  }
  return out
}
/** species-v2: improved strains as envelopes: paddy on dam-irrigated land (no water rule), cold-hardy barley. */
const IRRIGATED_PADDY: SpeciesDef = { ...SPECIES_TABLE[SP.paddyRice], water: false }
const HARDY_BARLEY: SpeciesDef = { ...SPECIES_TABLE[SP.barley], t: [0.18, 0.3, 0.7, 0.85] }
/** The envelope a yield row uses: the species, or the strain of an extra row. */
function rowDef(x: number): SpeciesDef {
  return x === ROW_EARLY ? SPECIES_TABLE[SP.paddyRice] : x === ROW_IRRIG ? IRRIGATED_PADDY : x === ROW_HARDY ? HARDY_BARLEY : SPECIES_TABLE[x]
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
  /** species-v2: first holder (settlement) of each technique, -1. */
  firstTech: Int32Array
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
  // species-v2 (cashCrops.ts, habit.ts, blight.ts, storage.ts, techniques.ts; speciesV2.ts runs them).
  /** Per settlement: multiplier on the farm part of its food (land under cash crops, pellagra, habit harm); 1 by default (population.ts). */
  keep: Float64Array
  /** Per settlement: weight on a bad harvest's shortfall (drought sensitivity and stores of its staples; population.ts). */
  damp: Float64Array
  /** Per settlement: share of its crop food that keeps in store (0..1), and each staple's share of its crop food [id * NST + staple index] (cropOf). */
  sto: Float32Array
  share: Float32Array
  /** Per settlement: share of its fields under each cash crop [id * CASH.length + index in CASH]. */
  cashX: Float32Array
  cashTot: Float64Array
  /** Per settlement: the land pressure (pop / expected food, at most 1) its crop multiplier was last reckoned at. */
  pressAt: Float32Array
  /** Per people: yield multiplier of each staple under blight [p * NST + staple index]; share of the herds left after a livestock plague. */
  bmul: Float64Array
  herdKeep: Float64Array
  /** Per cell: 1 once catchCash has reckoned it. */
  cashDone: Uint8Array
  /** Per cell: soil-wear multiplier of the crops grown there (land.ts degradation), and the yield gain of terracing (>= 1). */
  wear: Float64Array
  terr: Float32Array
  /** The trade market (prices per settlement and good, traders), as of last year; null before the first year. */
  tv: MarketView | null
  /** State of the v2 systems (speciesV2.ts). */
  v2: SpeciesV2
}

/** Interface the trade state offers here (kept structural to avoid an import cycle). */
export interface RouteView {
  openList: number[]
  rA: number[]
  rB: number[]
  rVol: Float64Array
}
/** species-v2: the market as the species systems read it (structural: trade.ts TradeState). */
export interface MarketView extends RouteView {
  price: Float64Array
  stock: Float64Array
  trader: Uint8Array
  pairCount: number
  pairA: Int32Array
  pairB: Int32Array
  pairFlow: Float64Array
}

export function chord2(P: Float32Array, a: number, b: number): number {
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
  // species-v2: fit rows for every species; yield rows (val, iratio) for the staples and herds plus the strains' extra rows.
  const fit = new Float32Array(S_COUNT * N)
  const val = new Float32Array(ROWS_ALL * N)
  const iratio = new Float32Array(ROWS_ALL * N).fill(1)
  const { capFarm, liveFrac, riverFishFrac, farmQ, relief, riverCap } = T
  const agri = CAPACITY.agri
  for (let x = FOOD_COUNT; x < S_COUNT; x++) {
    const d = SPECIES_TABLE[x]
    const o = x * N
    for (let i = 0; i < N; i++) if (capFarm[i] > 0) fit[o + i] = fitAt(world, d, i, false, x)
  }
  for (let x = 0; x < ROWS_ALL; x++) {
    const d = rowDef(x)
    const o = x * N
    for (let i = 0; i < N; i++) {
      if (capFarm[i] <= 0) continue
      const f = fitAt(world, d, i, x === ROW_EARLY, x < FOOD_COUNT ? x : -1)
      if (f <= 0) continue
      if (x < FOOD_COUNT) fit[o + i] = f
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
  // species-v2: terracing halves the highland penalty of a cell's fields (its yield gain, >= 1).
  const terr = new Float32Array(N).fill(1)
  for (let i = 0; i < N; i++) {
    if (capFarm[i] <= 0 || relief[i] >= 0.999) continue
    const rel = 1 - SPECIES2.terraceCut * (1 - relief[i])
    const cap = CAPACITY.base * area * agri[world.biome[i]] * farmQ[i] * rel + riverCap[i]
    if (cap > capFarm[i]) terr[i] = cap / capFarm[i]
  }
  // Catchment fit and site factors (habitable cells; site rows for the staples and herds, row FOOD_COUNT: hunting only).
  const fitCatch = new Float32Array(S_COUNT * N)
  const siteCrop = new Float32Array(FOOD_COUNT * N)
  const siteLive = new Float32Array((FOOD_COUNT + 1) * N)
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
    siteLive[FOOD_COUNT * N + c] = (hunt * lfS * inv) / norm
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
  // (species-v2: the catchment fit of the cash crops and ornamentals, and their unfit bits, are reckoned per cell when
  // a settlement is founded there: catchCash.)
  const unfit0 = new Uint32Array(N), unfit1 = new Uint32Array(N)
  for (let c = 0; c < N; c++) {
    if (!T.habitable[c]) continue
    for (let x = 0; x < FOOD_COUNT; x++) {
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
    firstHolder: new Int32Array(S_COUNT).fill(-1), firstYear: new Int32Array(S_COUNT).fill(-1), firstTech: new Int32Array(K_COUNT).fill(-1),
    waves: [], activeWaves: 0, sick: 0,
    routeOff: new Int32Array(257), routeTo: new Int32Array(0), routeVol: new Float64Array(0), routeN: 0,
    linkBridge: new Float64Array(64), linkFrom: new Int32Array(64), linkCount: new Int32Array(64),
    claimBest: new Float64Array(N), claimWho: new Int32Array(N), claimStamp: new Int32Array(N).fill(-1), claimRun: 0,
    techLog: [], epiLog: [],
    keep: new Float64Array(256).fill(1), damp: new Float64Array(256).fill(1), sto: new Float32Array(256), share: new Float32Array(256 * NST),
    cashX: new Float32Array(256 * CASH.length), cashTot: new Float64Array(256), pressAt: new Float32Array(256), bmul: new Float64Array(P * NST).fill(1), herdKeep: new Float64Array(P).fill(1),
    wear: new Float64Array(N).fill(1), terr, tv: null, v2: null as unknown as SpeciesV2, // (v2: set by speciesV2.ts before the tribes are founded)
    cashDone: new Uint8Array(N),
  }
  for (const c of plan.cells) catchCash(s, sp, c)
  placeOrigins(s, sp, plan, rngOrigins)
  return sp
}

/** species-v2: catchment fit of the cash crops and ornamentals at habitable cell c, and their unfit bits (once per cell). */
export function catchCash(s: HistoryState, sp: SpeciesState, c: number): void {
  if (sp.cashDone[c]) return
  sp.cashDone[c] = 1
  const T = s.terrain
  if (!T.habitable[c]) return
  const N = sp.N
  const { catchOff, catchBase, catchCell, catchW, capFarm } = T
  const fit = sp.fit, fitCatch = sp.fitCatch
  let den = 0, n = 0
  for (let k = catchOff[c], e = catchBase[c]; k < e && n < 256; k++, n++) den += catchW[k] * capFarm[catchCell[k]]
  const inv = den > 0 ? 1 / den : 0
  let u0 = sp.unfit0[c], u1 = sp.unfit1[c]
  for (let x = FOOD_COUNT; x < S_COUNT; x++) {
    let fc = 0
    if (den > 0) {
      const o = x * N
      let fs = 0, t = 0
      for (let k = catchOff[c], e = catchBase[c]; k < e && t < 256; k++, t++) { const j = catchCell[k]; fs += catchW[k] * capFarm[j] * fit[o + j] }
      fc = fs * inv
    }
    fitCatch[x * N + c] = fc
    if (fc >= SPECIES.minFit) continue
    const b = itemBit(x)
    if (b < 32) u0 |= 1 << b
    else u1 |= 1 << (b - 32)
  }
  sp.unfit0[c] = u0 >>> 0
  sp.unfit1[c] = u1 >>> 0
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
      for (let x = 0; x < FOOD_COUNT; x++) { // (species-v2: food species; a cash crop now and then below)
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
    // species-v2: with chance SPECIES2.cashFounding, one fibre / luxury / stimulant species that fits the tribes' land well.
    if (rng.next() < SPECIES2.cashFounding) {
      let best = -1, bestW = 0
      for (let x = FOOD_COUNT; x < S_COUNT; x++) {
        if (!free(x) || cf[x] < SPECIES2.cashFoundingFit || SPECIES_TABLE[x].category === SpeciesCategory.Ornamental) continue
        const w = cf[x] * (0.3 + rng.next())
        if (w > bestW) { bestW = w; best = x }
      }
      if (best >= 0) set.push(best)
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
    // (species-v2: the species' fit row and its best value hoisted out of the loops.)
    const fitRow = sp.fit.subarray(x * N, x * N + N)
    let maxF = 0
    for (let i = 0; i < N; i++) { const f = fitRow[i]; if (f > maxF) maxF = f }
    for (let n = 0; n < want; n++) {
      // Best hearth score over land; candidates near it (>= originFit of the best fit), weighted.
      if (maxF <= 0) break
      const minF = Math.min(SPECIES.originFit, maxF)
      let total = 0
      const cand: number[] = [], wts: number[] = []
      for (let i = 0; i < N; i++) {
        if (fitRow[i] < minF - 1e-6) continue
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

export function ensureSettlements(sp: SpeciesState, count: number): void {
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
  // species-v2
  const keep = new Float64Array(size).fill(1); keep.set(sp.keep); sp.keep = keep
  const damp = new Float64Array(size).fill(1); damp.set(sp.damp); sp.damp = damp
  const sto = new Float32Array(size); sto.set(sp.sto); sp.sto = sto
  const share = new Float32Array(size * NST); share.set(sp.share); sp.share = share
  const cx = new Float32Array(size * CASH.length); cx.set(sp.cashX); sp.cashX = cx
  sp.cashTot = growF64(sp.cashTot, size)
  const pa = new Float32Array(size); pa.set(sp.pressAt); sp.pressAt = pa
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
  // species-v2: buffalo pull ploughs too; terraces, dam-fed paddies, hardy barley, the legume companion, bred herds, blight and plague.
  let traction = cattle ? SPECIES_TABLE[SP.cattle].traction : horse ? SPECIES_TABLE[SP.horse].traction : 0
  if (hasBit(m0, m1, SP.buffalo) && SPECIES_TABLE[SP.buffalo].traction > traction) traction = SPECIES_TABLE[SP.buffalo].traction
  const terrace = hasBit(m0, m1, TECH_BIT + TQ.terrace)
  const irrigation = hasBit(m0, m1, TECH_BIT + TQ.irrigation)
  const pulse = hasBit(m0, m1, SP.pulse)
  const pp = s.people[id]
  const bm = sp.bmul, bo = pp * NST
  // Held staples: row offset, yield factor, hot-cell bonus, dam-irrigated row (-1 none).
  let ns = 0
  const rows = ROWS, muls = MULS, hots = HOTS, ids = IDS, alts = ALTS, prefs = PREFS
  for (const x of STAPLES) {
    if (!hasBit(m0, m1, x)) continue
    const d = SPECIES_TABLE[x]
    const lab = d.labour > 1 ? 1 / (1 + SPECIES.boserup * (d.labour - 1) * (1 - press)) : 1
    const paddyEarly = x === SP.paddyRice && early
    rows[ns] = (paddyEarly ? ROW_EARLY : x === SP.barley && hasBit(m0, m1, TECH_BIT + TQ.hardyGrain) ? ROW_HARDY : x) * N
    muls[ns] = lab * (rotation && d.cereal ? 1 + TECHNIQUE.rotationYield : 1) * bm[bo + STAPLE_INDEX[x]]
    hots[ns] = paddyEarly ? TECHNIQUE.riceYield : 0
    alts[ns] = x === SP.paddyRice && irrigation ? ROW_IRRIG * N : -1
    prefs[ns] = 1 - SPECIES2.storePref * (1 - (x === SP.potato && hasBit(m0, m1, TECH_BIT + TQ.freezeDrying) ? SPECIES2.chunoStore : d.store))
    ids[ns] = x
    ns++
  }
  let nh = 0
  const hrows = HROWS
  for (const x of HERDS) if (hasBit(m0, m1, x)) hrows[nh++] = x * N
  const herdMul = (hasBit(m0, m1, TECH_BIT + TQ.breeding) ? 1 + SPECIES2.breedYield : 1)
  const herdKeep = sp.herdKeep[pp]
  const val = sp.val, ir = sp.iratio, hot = sp.hot, plo = sp.plough, terr = sp.terr, farmMul = s.farmMul
  const pulseRow = SP.pulse * N, fitT = sp.fit
  const { catchOff, catchBase, catchCell, catchW, capFarm, liveFrac, riverFishFrac } = T
  const floor = SPECIES.floor, second = SPECIES.second, hunt = SPECIES.hunt
  const pulseBonus = SPECIES2.pulseBonus
  const food = FOODS
  if (write) for (let t = 0; t < ns; t++) food[t] = 0
  let minor = 0
  // Two sums: what the land yields with these species (num), and the same without the marginal-land factors (numY):
  // the yields are normalised and damped above the old calibration, the marginal factor (land opened) is not.
  let num = 0, numY = 0, den = 0, lnum = 0, lden = 0
  let main = -1
  const k0 = catchOff[c], k1 = catchBase[c]
  for (let k = k0; k < k1; k++) {
    const j = catchCell[k]
    const w = catchW[k] * capFarm[j]
    // (Staples ranked by yield * storability preference: farmers favour a harvest that keeps; the food counts the yield.)
    let v1 = 0, v2 = 0, y1 = 0, y2 = 0, b1 = -1, b2 = -1, c1 = 0, c2 = 0
    for (let t = 0; t < ns; t++) {
      let r = rows[t] + j
      let v = val[r] * muls[t]
      if (alts[t] >= 0 && farmMul[j] > 1.0001) { const ra = alts[t] + j; const va = val[ra] * muls[t]; if (va > v) { v = va; r = ra } }
      if (hots[t] > 0 && hot[j]) v *= 1 + hots[t]
      const cv = v * prefs[t]
      if (cv > c1) { c2 = c1; v2 = v1; y2 = y1; b2 = b1; c1 = cv; v1 = v; y1 = v * ir[r]; b1 = t } else if (cv > c2) { c2 = cv; v2 = v; y2 = v * ir[r]; b2 = t }
    }
    let mc = v1 + second * v2, my = y1 + second * y2
    if (pulse && b1 >= 0 && SPECIES_TABLE[ids[b1]].cereal) { const g = 1 + pulseBonus * fitT[pulseRow + j]; mc *= g; my *= g }
    let floored = false
    if (mc < floor) { mc = floor; floored = true }
    if (my < floor) my = floor
    let tr = 1 + traction + (plough && plo[j] ? TECHNIQUE.ploughYield : 0)
    if (terrace) tr *= terr[j]
    mc *= tr
    my *= tr
    if (k === k0 && b1 >= 0 && v1 >= floor) main = ids[b1]
    let mh = hunt, hy = hunt
    for (let t = 0; t < nh; t++) { const r = hrows[t] + j; const v = val[r]; if (v > mh) { mh = v; hy = v * ir[r] } }
    if (hy < hunt) hy = hunt
    if (mh > hunt) { mh = hunt + (mh * herdMul - hunt) * herdKeep; hy = hunt + (hy * herdMul - hunt) * herdKeep }
    const lf = liveFrac[j], rf = riverFishFrac[j]
    num += w * (rf + (1 - lf - rf) * mc + lf * mh)
    numY += w * (rf + (1 - lf - rf) * my + lf * hy)
    den += w
    lnum += w * lf * mh
    lden += w * lf
    if (write) {
      // Each staple's part of the crop food (the floor counts as minor crops).
      const wc = w * (1 - lf - rf) * tr
      if (floored || b1 < 0) minor += wc * floor
      else { food[b1] += wc * v1; if (b2 >= 0) food[b2] += wc * second * v2 }
    }
  }
  const raw = den > 0 ? num / den : floor
  let yld = den > 0 ? numY / den : floor
  if (yld > SPECIES.mulCap) yld = SPECIES.mulCap
  const f = normalised(yld) * (numY > 0 ? num / numY : 1)
  if (write) {
    sp.raw[id] = raw
    sp.cropMul[id] = f
    sp.pressAt[id] = press
    sp.liveAdj[id] = lden > 0 ? lnum / lden / raw : 1
    sp.main[id] = main
    // species-v2: staple shares of the crop food, what keeps in store, and how hard a drought hits (storage.ts reads these).
    let tot = minor
    for (let t = 0; t < ns; t++) tot += food[t]
    const so = id * NST
    sp.share.fill(0, so, so + NST)
    const chuno = hasBit(m0, m1, TECH_BIT + TQ.freezeDrying)
    let sto = 0, dmp = 0
    if (tot > 0) {
      const inv = 1 / tot
      for (let t = 0; t < ns; t++) {
        const x = ids[t]
        const sh = food[t] * inv
        sp.share[so + STAPLE_INDEX[x]] = sh
        const d = SPECIES_TABLE[x]
        const st = x === SP.potato && chuno ? SPECIES2.chunoStore : d.store
        const sd = x === SP.potato && chuno ? SPECIES2.chunoStore : d.storeDrought
        sto += sh * st
        dmp += sh * d.sigma * (1 - SPECIES2.storeDamp * sd)
      }
      const mi = minor * inv
      sto += mi * SPECIES2.minorStore
      dmp += mi * (1 - SPECIES2.storeDamp * SPECIES2.minorStore)
    } else { sto = SPECIES2.minorStore; dmp = 1 - SPECIES2.storeDamp * SPECIES2.minorStore }
    sp.sto[id] = sto
    sp.damp[id] = SPECIES2.storage ? dmp / SPECIES2.dampRef : 1
  }
  return f
}
/** The food system's multiplier for a raw yield multiplier: raw / norm, with gains above 1 damped (SPECIES.above). */
export function normalised(raw: number): number {
  const m = raw / SPECIES.norm
  return m > 1 ? 1 + SPECIES.above * (m - 1) : m
}
const ROWS = new Int32Array(64), MULS = new Float64Array(64), HOTS = new Float64Array(64), IDS = new Int32Array(64), HROWS = new Int32Array(64)
const ALTS = new Int32Array(64), FOODS = new Float64Array(64), PREFS = new Float64Array(64)

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
  r[n++] = FOOD_COUNT * N
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
export function gainItem(s: HistoryState, id: number, x: number, from: number): void {
  const sp = s.sp
  const b = itemBit(x)
  if (b < 32) sp.m0[id] = (sp.m0[id] | (1 << b)) >>> 0
  else sp.m1[id] = (sp.m1[id] | (1 << (b - 32))) >>> 0
  // species-v2: a cash crop or ornamental changes no yield: the crop multiplier and what the others are worth stay.
  if (x < FOOD_COUNT || x >= S_COUNT) {
    sp.dull0[id] = 0
    sp.dull1[id] = 0
    sp.benUntil[id] = 0
    cropOf(s, id, sp.m0[id], sp.m1[id], true)
  }
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
  } else {
    // species-v2: techniques are in the contract now (first per people).
    sp.techLog.push(s.year, p, x - S_COUNT, id)
    if (sp.firstTech[x - S_COUNT] < 0) sp.firstTech[x - S_COUNT] = id
    if (srcPeople >= 0) logEvent(s, EventType.TechniqueAdopted, id, from, x - S_COUNT)
    else logEvent(s, EventType.TechniqueFound, id, -1, x - S_COUNT)
  }
}

/**
 * A settlement was just founded (state.found): an original tribe holds its cradle's founding set, any other
 * settlement its parent's species. Its crop multiplier is reckoned.
 */
export function speciesOnFounded(s: HistoryState, id: number): void {
  const sp = s.sp
  ensureSettlements(sp, s.count)
  catchCash(s, sp, s.cell[id]) // species-v2
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
  // species-v2: cash crops, ornamentals and the techniques that change no yield have benefits of their own.
  if ((x >= FOOD_COUNT && x < S_COUNT) || x === S_COUNT + TQ.nixtamal || x === S_COUNT + TQ.freezeDrying || x === S_COUNT + TQ.grafting) {
    const v = x < S_COUNT ? cashBenefit(s, id, x) : techBenefit(s, id, x - S_COUNT)
    sp.ben[key] = v
    return v
  }
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
  let v = smoothstep(SPECIES.gainLow, SPECIES.gainHigh, gain)
  // species-v2: a staple that would grow where none of the settlement's grows (fields at the floor) is worth having even
  // when those fields are few: every people farms its own land with something once the crop is at hand.
  if (x < S_COUNT && SPECIES_TABLE[x].category === SpeciesCategory.Staple && v < SPECIES2.coverBen) {
    const cv = SPECIES2.coverBen * smoothstep(SPECIES2.coverLow, SPECIES2.coverHigh, uncovered(s, id, x))
    if (cv > v) v = cv
  }
  sp.ben[key] = v
  return v
}

/** species-v2: share of settlement `id`'s base catchment (by farm capacity) where staple x grows but none it holds does. */
function uncovered(s: HistoryState, id: number, x: number): number {
  const sp = s.sp
  const T = s.terrain
  const N = sp.N
  const m0 = sp.m0[id], m1 = sp.m1[id]
  const fit = sp.fit
  const c = s.cell[id]
  let held = 0
  const hs = UNC
  for (const y of STAPLES) if (hasBit(m0, m1, y)) hs[held++] = y * N
  let num = 0, den = 0
  for (let k = T.catchOff[c]; k < T.catchBase[c]; k++) {
    const j = T.catchCell[k]
    const w = T.catchW[k] * T.capFarm[j]
    den += w
    if (fit[x * N + j] <= 0) continue
    let any = false
    for (let t = 0; t < held && !any; t++) if (fit[hs[t] + j] > 0) any = true
    if (!any) num += w
  }
  return den > 0 ? num / den : 0
}
const UNC = new Int32Array(64)

/**
 * species-v2: benefit of a cash crop or ornamental for settlement `id` (0..1). A cash crop pays where the price its good
 * fetches at the settlement (after last year's trade) times what the land would yield of it beats the price of grain
 * (traders); elsewhere only for home use (cloth, the people's habit). Ornamentals: prestige in prosperous towns.
 */
function cashBenefit(s: HistoryState, id: number, x: number): number {
  const sp = s.sp
  const d = SPECIES_TABLE[x]
  const X = SPECIES2
  const fc = sp.fitCatch[x * sp.N + s.cell[id]]
  if (d.category === SpeciesCategory.Ornamental) return s.pop[id] >= X.ornamentPop ? smoothstep(X.ornamentLow, X.ornamentHigh, prosperityOf(s, id)) : 0
  if (d.good < 0) return smoothstep(SPECIES.gainLow, SPECIES.gainHigh, X.bambooGain * fc) // (bamboo: timber that regrows)
  let gain = 0
  const tv = sp.tv
  if (tv && id < tv.trader.length && tv.trader[id]) {
    const o = id * 9 // (GOOD_COUNT)
    const pf = tv.price[o] > X.minFoodPrice ? tv.price[o] : X.minFoodPrice
    const r = (tv.price[o + d.good] * d.cashYield * fc) / pf - 1
    gain = X.cashGain * smoothstep(0, 1, r)
  } else gain = d.good === CLOTH ? X.homeCloth : X.homeCash
  if (d.category === SpeciesCategory.Stimulant) gain += X.habitGain * sp.v2.habit[s.people[id] * STIMULANTS.length + STIM_INDEX[x]]
  return smoothstep(SPECIES.gainLow, SPECIES.gainHigh, gain)
}

/** species-v2: benefit of the techniques that change no yield: lime-processing for maize eaters, freeze-drying for potato eaters, grafting for vine and orchard growers. */
function techBenefit(s: HistoryState, id: number, k: number): number {
  const sp = s.sp
  const so = id * NST
  if (k === TQ.nixtamal) return smoothstep(0.08, 0.35, sp.share[so + STAPLE_INDEX[SP.maize]])
  if (k === TQ.freezeDrying) return smoothstep(0.08, 0.35, sp.share[so + STAPLE_INDEX[SP.potato]])
  const m0 = sp.m0[id], m1 = sp.m1[id]
  return hasBit(m0, m1, SP.grape) || hasBit(m0, m1, SP.cherry) || hasBit(m0, m1, SP.tulip) ? 1 : 0
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
export function speciesSystem(s: HistoryState, tv: MarketView): void {
  const sp = s.sp
  ensureSettlements(sp, s.count)
  sp.tv = tv // (species-v2: cash crops judge prices)
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
    if (((year / step) | 0) % REFRESH_STEPS === id % REFRESH_STEPS && ((sp.m0[id] & LABOUR0) !== 0 || (sp.m1[id] & LABOUR1) !== 0)) {
      // (species-v2: only when the pressure on the land moved since the last reckoning.)
      const ex = s.expected[id]
      let press = ex > 0 ? s.pop[id] / ex : 1
      if (press > 1) press = 1
      const d = press - sp.pressAt[id]
      if (d > SPECIES2.pressMove || -d > SPECIES2.pressMove) cropOf(s, id, sp.m0[id], sp.m1[id], true)
    }
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
      // species-v2: the draw first, the benefit (a crop multiplier reckoning) only when the draw could succeed.
      const u = rng.next()
      if (u >= base) continue
      const ben = benefitOf(s, id, x)
      if (ben <= 0) { dull(sp, id, x); continue }
      if (u < base * ben) gainItem(s, id, x, -1)
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
      const pmax = (x < S_COUNT ? SPECIES.inPeople : TECHNIQUE2.inPeople) * DECADES * push
      const u = rng.next() // (species-v2: draw first)
      if (u >= pmax) continue
      const ben = benefitOf(s, id, x)
      if (ben <= 0) { dull(sp, id, x); continue }
      if (u < pmax * ben) gainItem(s, id, x, -1)
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
      // species-v2: secrets and monopolies pass slowly between peoples; some need craft skill; grafting carries vines and orchards.
      if (s.people[k] !== p) rate *= d.cross
      if (d.crafts > 0) rate *= smoothstep(d.crafts - 0.4, d.crafts + 0.2, s.tech[p * TECH_FIELD_COUNT + TechField.Crafts])
      if (d.graft && hasBit(sp.m0[id], sp.m1[id], TECH_BIT + TQ.grafting)) rate *= TECHNIQUE2.graftAdopt
    } else rate = TECHNIQUE.adopt[x - S_COUNT]
    // More neighbours who have it, more chances (the best link counts fully, each further one half, at most `links` in all).
    let n = 1 + 0.5 * (n0 - 1)
    if (n > SPECIES.links) n = SPECIES.links
    const pmax = rate * DECADES * br * push * n
    const u = rng.next() // (species-v2: draw first)
    if (u >= pmax) continue
    const ben = benefitOf(s, id, x)
    if (ben <= 0) { dull(sp, id, x); continue }
    if (u < pmax * ben) gainItem(s, id, x, k)
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
  // species-v2: techniques pass between peoples mostly with trade (TECHNIQUE.cross, crossTrade), within a people as species do.
  const brT = q === p ? br : TECHNIQUE2.cross + (TECHNIQUE2.crossTrade * trade) / (trade + TECHNIQUE2.tradeHalf)
  for (let m = a1; m !== 0; m &= m - 1) {
    const b = 63 - Math.clz32(m & -m)
    const x = b >= TECH_BIT ? S_COUNT + b - TECH_BIT : b
    const bx = b >= TECH_BIT ? brT : br
    if (links[x]++ === 0) LINK_CAND[LINK_N++] = x
    if (bridge[x] < bx) { bridge[x] = bx; from[x] = k }
  }
}

function dull(sp: SpeciesState, id: number, x: number): void {
  const b = itemBit(x)
  if (b < 32) sp.dull0[id] = (sp.dull0[id] | (1 << b)) >>> 0
  else sp.dull1[id] = (sp.dull1[id] | (1 << (b - 32))) >>> 0
}

/** Every SPECIES.step years: per people, techniques found and disease loads. */
function peoplePass(s: HistoryState, sp: SpeciesState): void {
  // (species-v2: techniques are found in techniques.ts now.)
  const P = sp.P
  const living = s.living
  const pop = PPOP.length >= P ? PPOP : (PPOP = new Float64Array(P))
  const town = PTOWN.length >= P ? PTOWN : (PTOWN = new Float64Array(P))
  pop.fill(0); town.fill(0)
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
  }
  for (let p = 0; p < P; p++) {
    if (pop[p] <= 0) continue
    const yr = (x: number) => sp.year[p * ITEMS + x]
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
let PPOP = new Float64Array(0), PTOWN = new Float64Array(0)

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
export function speciesLandSnapshot(s: HistoryState, crop: Uint8Array, herdOut: Uint8Array, o: number, cash: Uint8Array): void {
  const sp = s.sp
  const T = s.terrain
  const N = sp.N
  const { catchOff, catchBase, catchCell, catchW, catchDist } = T
  const best = sp.claimBest, who = sp.claimWho, stamp = sp.claimStamp
  const run = ++sp.claimRun
  const living = s.living
  const list = CLAIMED.length >= N ? CLAIMED : (CLAIMED = new Int32Array(N))
  if (WHO2.length < N) { WHO2 = new Int32Array(N); BEST2 = new Float64Array(N) }
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
      if (stamp[j] !== run) { stamp[j] = run; best[j] = v; who[j] = id; list[n++] = j; WHO2[j] = -1; BEST2[j] = 0 }
      else if (v > best[j]) { BEST2[j] = best[j]; WHO2[j] = who[j]; best[j] = v; who[j] = id }
      else if (v > BEST2[j]) { BEST2[j] = v; WHO2[j] = id } // (species-v2: the second claimant)
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
    const bc = bestStapleAt(s, id, j)
    if (bc >= 0) crop[o + j] = bc + 1
    // species-v2: the main cash crop: of those the settlement grows (share >= SPECIES2.cashShown), the largest share that fits the cell.
    if (sp.cashTot[id] > 0) {
      let bx = -1, bs = SPECIES2.cashShown
      const co = id * CASH.length
      for (let q = 0; q < CASH.length; q++) {
        const sh = sp.cashX[co + q]
        if (sh >= bs && sp.fit[CASH[q] * N + j] > 0) { bs = sh; bx = CASH[q] }
      }
      if (bx >= 0) cash[o + j] = bx + 1
    }
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
  // species-v2: a farmed cell whose largest claimant grows none of its staples there shows the crop of the second
  // claimant if it grows one there (several settlements share most fields), so 0 stays mostly where none can grow any.
  for (let t = 0; t < n; t++) {
    const j = list[t]
    if (crop[o + j] !== 0 || WHO2[j] < 0 || ((use[j] * 255 + 0.5) | 0) === 0) continue
    const x = bestStapleAt(s, WHO2[j], j)
    if (x >= 0) crop[o + j] = x + 1
  }
}
/** species-v2: the staple settlement `id` grows best on cell j (as cropOf ranks them: strains, blight, storability), or -1 if none of its staples grows there. */
function bestStapleAt(s: HistoryState, id: number, j: number): number {
  const sp = s.sp
  const N = sp.N
  const val = sp.val
  if (PREP_ID !== id || PREP_RUN !== sp.claimRun) {
    // (The settlement's staples prepared once per snapshot and settlement: row, alternative row, factor.)
    PREP_ID = id; PREP_RUN = sp.claimRun
    const m0 = sp.m0[id], m1 = sp.m1[id]
    const early = hasBit(m0, m1, TECH_BIT + TQ.earlyRice)
    const hardy = hasBit(m0, m1, TECH_BIT + TQ.hardyGrain), irrig = hasBit(m0, m1, TECH_BIT + TQ.irrigation)
    const chuno = hasBit(m0, m1, TECH_BIT + TQ.freezeDrying)
    const bo = s.people[id] * NST
    let n = 0
    for (const x of STAPLES) {
      if (!hasBit(m0, m1, x)) continue
      PREP_X[n] = x
      PREP_ROW[n] = (x === SP.paddyRice && early ? ROW_EARLY : x === SP.barley && hardy ? ROW_HARDY : x) * N
      PREP_ALT[n] = x === SP.paddyRice && irrig ? ROW_IRRIG * N : -1
      PREP_HOT[n] = x === SP.paddyRice && early ? 1 + TECHNIQUE.riceYield : 1
      PREP_MUL[n] = sp.bmul[bo + STAPLE_INDEX[x]] * (1 - SPECIES2.storePref * (1 - (x === SP.potato && chuno ? SPECIES2.chunoStore : SPECIES_TABLE[x].store)))
      n++
    }
    PREP_N = n
  }
  const irrigated = s.farmMul[j] > 1.0001, hot = sp.hot[j] === 1
  let bc = -1, bv = 0
  for (let t = 0; t < PREP_N; t++) {
    let v = val[PREP_ROW[t] + j]
    if (PREP_ALT[t] >= 0 && irrigated && val[PREP_ALT[t] + j] > v) v = val[PREP_ALT[t] + j]
    if (hot) v *= PREP_HOT[t]
    v *= PREP_MUL[t]
    if (v > bv) { bv = v; bc = PREP_X[t] }
  }
  return bc
}
let PREP_ID = -1, PREP_RUN = -1, PREP_N = 0
const PREP_X = new Int32Array(64), PREP_ROW = new Int32Array(64), PREP_ALT = new Int32Array(64), PREP_HOT = new Float64Array(64), PREP_MUL = new Float64Array(64)
let WHO2 = new Int32Array(0), BEST2 = new Float64Array(0)

let CLAIMED = new Int32Array(0)

/** Species of this world for History.species: names in the language of the settlement that first held each (prefix-stable). */
export function assembleSpecies(world: World, sp: SpeciesState, naming: SettlementNaming, peoples: People[], founders: readonly number[], cellOf: (id: number) => number, usedOut?: Set<string>): SpeciesInfo[] {
  // Naming order: by first year held, then id; never-held species last (named in the language of the people founded nearest their origin).
  const order: number[] = []
  for (let x = 0; x < S_COUNT; x++) order.push(x)
  order.sort((a, b) => {
    const ya = sp.firstYear[a] < 0 ? 1e9 : sp.firstYear[a], yb = sp.firstYear[b] < 0 ? 1e9 : sp.firstYear[b]
    return ya - yb || a - b
  })
  const used = usedOut ?? new Set<string>() // (species-v2: technique names come after, unique among both)
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
    const info: SpeciesInfo = { id: x, archetype: d.archetype, category: d.category, name: names[x], origins: sp.origins[x].slice(), yield: d.category === SpeciesCategory.Staple ? d.yield : 0 }
    // species-v2: the optional fields where they apply.
    if (d.category === SpeciesCategory.Staple) { info.storability = d.store; info.clonal = d.clone > 1 }
    if (d.good >= 0) info.value = d.value
    if (d.category === SpeciesCategory.Stimulant) { info.habit = d.habit; info.harm = d.harm }
    out.push(info)
  }
  return out
}

/**
 * species-v2: techniques of this world for History.techniques: names in the language of the settlement that first had
 * each (prefix-stable: in order of the first year anyone had it, then id; never-held ones in the first tribe's language).
 */
export function assembleTechniques(world: World, sp: SpeciesState, naming: SettlementNaming, used: Set<string>, founders: readonly number[]): TechniqueInfo[] {
  const first = (k: number): number => { let y = 1e9; for (let p = 0; p < sp.P; p++) { const v = sp.year[p * ITEMS + S_COUNT + k]; if (v >= 0 && v < y) y = v } return y }
  const order: number[] = []
  for (let k = 0; k < K_COUNT; k++) order.push(k)
  const fy = order.map(first)
  order.sort((a, b) => fy[a] - fy[b] || a - b)
  const names: string[] = new Array<string>(K_COUNT).fill('')
  for (const k of order) {
    const namer = sp.firstTech[k] >= 0 ? sp.firstTech[k] : founders[0] ?? 0
    const lang = naming.language(naming.tribe[namer], sp.firstTech[k] >= 0 ? naming.level[namer] : 0)
    const rng = createRng(world.seed, `names-technique-${k}`)
    let name = ''
    for (let attempt = 0; attempt < 400 && !name; attempt++) {
      let w = buildRoot(lang, rng)
      if (rng.next() < 0.5) {
        const f = fuseWords(lang, w, buildMorph(lang, rng, 2, true))
        if (f !== null && letterCount(f) <= 10) w = f
      }
      if (letterCount(w) >= 3 && !used.has(w.toLowerCase())) name = w.toLowerCase()
    }
    if (!name) name = TECHNIQUES[k].toLowerCase() + k // practically unreachable
    used.add(name)
    names[k] = name
  }
  const out: TechniqueInfo[] = []
  for (let k = 0; k < K_COUNT; k++) out.push({ id: k, archetype: TECHNIQUES[k], name: names[k], species: TECHNIQUE_SPECIES[k] })
  return out
}

/** speciesYear and speciesSource for History (species items only, P * S_COUNT), each with its own buffer. */
export function speciesTables(sp: SpeciesState): { year: Int16Array; source: Int8Array; techYear: Int16Array; techSource: Int8Array } {
  const P = sp.P
  const year = new Int16Array(P * S_COUNT)
  const source = new Int8Array(P * S_COUNT)
  const techYear = new Int16Array(P * K_COUNT)
  const techSource = new Int8Array(P * K_COUNT)
  for (let p = 0; p < P; p++) {
    for (let x = 0; x < S_COUNT; x++) { year[p * S_COUNT + x] = sp.year[p * ITEMS + x]; source[p * S_COUNT + x] = sp.source[p * ITEMS + x] }
    for (let k = 0; k < K_COUNT; k++) { techYear[p * K_COUNT + k] = sp.year[p * ITEMS + S_COUNT + k]; techSource[p * K_COUNT + k] = sp.source[p * ITEMS + S_COUNT + k] }
  }
  return { year, source, techYear, techSource }
}
