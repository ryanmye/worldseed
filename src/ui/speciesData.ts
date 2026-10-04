// Per-history lookups about the useful plants and animals of a world (History.species):
// a colour and a short description per species, which peoples held which species since
// when and from whom (speciesYear, speciesSource), the main staple, herd animal and cash
// crop of each cell per land snapshot (crop, herd, cash) with per-snapshot tallies, the
// exchange web (who passed which species to whom, and where), the epidemics, the habits
// of each people (habit, stimulants, HabitSpreads), the share of food in store (storable),
// the farming techniques (techniques, techniqueYear, techniqueSource) with their own
// exchange web, and the blights and livestock plagues as pulses over the stricken land.
// Everything the UI shows at a year is a cheap function of that year, so scrubbing in
// either direction is exact.
//
// Colours are chosen per archetype and per map view: a view shows one kind at a time
// (staples in Crops, animals in Herds, fibre, luxury and stimulant crops in Cash crops),
// so colours need only be told apart within a view, and the cash crops are in hue
// families by kind (fibre cool, luxuries warm and purple, stimulants green and brown).
//
// All of it is optional at runtime: without valid species fields there is no SpeciesData
// and the species views, panel, chips and lines stay hidden. Each field is checked on its
// own: a history with species but no crop or herd layers still gets the panel and chips,
// one without habits or techniques simply shows none.
//
// STAND_IN (the one switch below): for developing before the simulation produces these
// fields, 'fallback' fabricates plausible ones when they are missing (a dozen species with
// origins at the founders of peoples whose homeland suits them, spread along first
// contacts with a delay where the climate suits them, crop and herd layers from the land
// use and each cell's nearest settlement's people, and Domesticated, SpeciesAdopted and
// Epidemic events) and 'force' does so even when real fields are present. 'off' (the
// default) never does.

import { EventType, Good, SpeciesCategory, type History, type HistoryEvent, type SpeciesInfo, type TechniqueInfo, type World } from '../contract.ts'
import { PeoplesEvent, speciesGloss } from './format.ts'
import type { PeoplesData } from './peoplesData.ts'

type StandIn = 'off' | 'fallback' | 'force'
/** DEV STAND-IN SWITCH: 'off' in committed code (see the header). */
const STAND_IN = 'off' as StandIn

/** View category of the Cash crops view: fibre, luxury and stimulant species (origin markers, legend). */
export const CASH_VIEW = 10

/** Whether a species of category `c` is shown by the map view of category `view` (0 Crops, 1 Herds, CASH_VIEW Cash crops). */
export function inViewCategory(c: number, view: number): boolean {
  return view === CASH_VIEW ? c === SpeciesCategory.Fibre || c === SpeciesCategory.Luxury || c === SpeciesCategory.Stimulant : c === view && view >= 0
}

export interface SpeciesData {
  count: number
  list: readonly SpeciesInfo[]
  /** Display colour per species: CSS hex and sRGB 0..1 triplets. */
  css: string[]
  rgb: Float32Array
  /** "Pallu" (capitalised world name) and "a highland tuber" (", harmful" added for harmful stimulants). */
  names: string[]
  gloss: string[]
  /** The gloss without the harm word (where a tag shows it). */
  plainGloss: string[]
  /** The good each species yields in trade (Good id: cloth, luxuries, stimulants; wool beasts cloth), -1 none (staples, most animals, ornamentals). */
  good: Int8Array
  /** "ruinous", "harmful", "mildly harmful" or '' for each species (stimulants only). */
  harmWord: string[]
  /** Number of peoples (rows of year and source). */
  peoples: number
  /** Year people p first held species s, -1 never: year[p * count + s]. */
  year: Int16Array
  /** The people it came from, -1 own (founding set or tamed): source[p * count + s]. */
  source: Int8Array
  /** Main staple / herd animal / cash crop per land snapshot per cell (species id + 1, 0 none), or null when the history has none. */
  crop: Uint8Array | null
  herd: Uint8Array | null
  cash: Uint8Array | null
  cellCount: number
  landInterval: number
  landCount: number
  /** Cells whose main crop (herd, cash crop) is species s at land snapshot l: [l * count + s]; cells with any crop (herd, cash crop) per land snapshot. */
  cropCells: Uint32Array
  herdCells: Uint32Array
  cashCells: Uint32Array
  farmedCells: Uint32Array
  pastureCells: Uint32Array
  cashTotal: Uint32Array
  /** 1 where a species is the main crop, herd or cash crop of some cell at some land snapshot of the history. */
  everGrown: Uint8Array
  /** Per species and origin, the settlements (of any year) nearest first, for "native near Kepia" (the first founded by the year shown). */
  originNear: Int32Array[][]
  /** The exchange web: one arc per adoption, from the giver's place to the taker's, from its year (sorted by year). */
  arcSpecies: Int32Array
  arcFrom: Int32Array
  arcTo: Int32Array
  arcYear: Float32Array
  /** Epidemic pulses: cells of the stricken people's larger settlements, and the year. */
  epidemicCells: Int32Array
  epidemicYears: Float32Array
  /** Blight (kind 0) and livestock plague (kind 1) pulses: the stricken people's fields or pastures of that species, the year, and a 0..1 delay spreading out from where it struck first. */
  hazardCells: Int32Array
  hazardYears: Float32Array
  hazardDelay: Float32Array
  hazardKind: Uint8Array
  // ---- habits
  /** Species ids of the stimulants in `habit` order, and each species' index there (-1 not a stimulant). */
  stimulants: number[]
  stimIndex: Int8Array
  /** Habituation 0..255 per snapshot per people per stimulant: habit[(s * peoples + p) * stimulants.length + k], or null. */
  habit: Uint8Array | null
  snapshotCount: number
  snapshotInterval: number
  /** Year of the HabitSpreads event of people p and stimulant k (-1 none), and the people it came from (-1 none): [p * stimulants.length + k]. */
  habitSince: Int16Array
  habitFrom: Int8Array
  /** Share of food in store 0..255 per snapshot per settlement (History.storable), or null; settlement count. */
  storable: Uint8Array | null
  settlementCount: number
  // ---- techniques
  techniques: readonly TechniqueInfo[]
  /** "Zumun" and "early-ripening rice, two harvests a year". */
  techNames: string[]
  techGloss: string[]
  /** Year people p first had technique k, -1 never: techYear[p * techniques.length + k]; the people it came from (-1 own). */
  techYear: Int16Array
  techSource: Int8Array
  /** Where and when each technique was first worked out (cell, year, people; -1 never). */
  techFirstCell: Int32Array
  techFirstYear: Int32Array
  techFirstPeople: Int32Array
  /** Technique exchange web, like the species arcs. */
  techArc: Int32Array
  techArcFrom: Int32Array
  techArcTo: Int32Array
  techArcYear: Float32Array
  standIn: boolean
}

// ---------------------------------------------------------------------------
// colours and descriptions

/** Distinct hues for a dark map (for an archetype not in LOOK). */
const PALETTE = [
  '#e6b422', '#6fbf4a', '#e0703a', '#5aa9e6', '#c86fc9', '#ece27c', '#3fb8a8', '#e05a6e',
  '#9b8ce0', '#a8c64a', '#b8875a', '#7ad1e8', '#f09bc0', '#5f7fd9', '#dcc08f', '#4d9e5f',
  '#ef9a6a', '#c3aaf0', '#c4c44a', '#8ecfb0', '#d65f9a', '#8fa3b8', '#f2c36b', '#6a9e9e',
]

/**
 * Colour, gloss and (where it is not its category's) the good yielded, per archetype key as
 * the simulation names them. Colours are distinct within each map view: the staples among
 * themselves, the herd animals among themselves, the fibre, luxury and stimulant crops
 * together (fibre in cool blues and white, luxuries in warm reds, golds and purples,
 * stimulants in greens, browns and scarlet).
 */
const LOOK: Record<string, { css: string; gloss: string; good?: number }> = {
  // staples (Crops view)
  wheat: { css: '#e6b422', gloss: 'a grassland grain' },
  barley: { css: '#6fbf4a', gloss: 'a hardy grain' },
  paddyrice: { css: '#e0703a', gloss: 'a paddy grain' },
  maize: { css: '#5aa9e6', gloss: 'a tall-stalked grain' },
  potato: { css: '#c86fc9', gloss: 'a highland tuber' },
  cassava: { css: '#f2c79a', gloss: 'a tropical root' },
  sorghum: { css: '#3fb8a8', gloss: 'a savanna grain' },
  millet: { css: '#a2804e', gloss: 'a dry-country grain' },
  sweetpotato: { css: '#e05a6e', gloss: 'a warm-country root' },
  yamtaro: { css: '#7d68f0', gloss: 'a wet-forest tuber' },
  plantain: { css: '#c8e05a', gloss: 'a starchy tree fruit' },
  pulse: { css: '#e9e4d8', gloss: 'a field bean' },
  // herd animals (Herds view; wool beasts also yield cloth)
  cattle: { css: '#e05a6e', gloss: 'a great grazer' },
  sheepgoat: { css: '#9b8ce0', gloss: 'a flock of hardy browsers', good: Good.Cloth },
  horse: { css: '#a8c64a', gloss: 'a steppe runner' },
  camel: { css: '#d9a35a', gloss: 'a desert beast of burden' },
  llama: { css: '#7ad1e8', gloss: 'a mountain pack animal', good: Good.Cloth },
  pig: { css: '#f4a6cc', gloss: 'a forest rooter' },
  buffalo: { css: '#4f6fd9', gloss: 'a wetland ox' },
  coldherd: { css: '#e8e6dc', gloss: 'a tundra herd deer', good: Good.Cloth },
  // fibre (Cash crops view)
  cotton: { css: '#f0f1ee', gloss: 'a fibre shrub' },
  flax: { css: '#8cc0ff', gloss: 'a fibre plant for linen' },
  hemp: { css: '#8a9a3c', gloss: 'a rope fibre' },
  silk: { css: '#c3a4ff', gloss: 'a thread-spinning grub', good: Good.Luxury },
  bamboo: { css: '#3fd0c0', gloss: 'a giant grass for building', good: -1 },
  // luxuries and dyes
  sugarcane: { css: '#f5ea8c', gloss: 'a sweet cane' },
  grape: { css: '#8e3cc0', gloss: 'a vine for wine' },
  pepper: { css: '#ff8a2b', gloss: 'a fiery spice' },
  clovenutmeg: { css: '#a8304a', gloss: 'a spice of the islands' },
  incense: { css: '#f7a8c4', gloss: 'a fragrant resin' },
  indigo: { css: '#3f4fd6', gloss: 'a blue dye plant' },
  cochineal: { css: '#e03a78', gloss: 'a dye insect' },
  // stimulants and narcotics
  tea: { css: '#6ccf4f', gloss: 'a leaf for brewing' },
  coffee: { css: '#a85f34', gloss: 'a bean for brewing' },
  cacao: { css: '#dcae84', gloss: 'a bitter bean for drinking' },
  tobacco: { css: '#d8a92a', gloss: 'a habit-forming leaf' },
  poppy: { css: '#ff4a3d', gloss: 'a narcotic flower' },
  coca: { css: '#2e9a64', gloss: 'a stimulating leaf' },
  // ornamentals
  cherry: { css: '#ffb7d5', gloss: 'a blossoming tree' },
  tulip: { css: '#ff6a5a', gloss: 'a garden bulb' },
}
const lookOf = (archetype: string) => LOOK[archetype.toLowerCase().replace(/[\s_-]+/g, '')]

/** Glosses of the techniques by archetype key. */
const TECHNIQUE_GLOSS: Record<string, string> = {
  earlyrice: 'early-ripening rice, two harvests a year',
  rotation: 'resting fields under a pulse between grain crops',
  heavyplough: 'a heavy plough for clay soils, drawn by oxen',
  terrace: 'terraced fields on the hillsides',
  paddyirrigation: 'paddies watered from dams and channels',
  nixtamal: 'lime-treating the tall grain so it nourishes',
  freezedrying: 'freeze-drying tubers in the mountain cold, to keep for years',
  grafting: 'grafting vines and fruit trees',
  breeding: 'breeding stronger herds',
  hardygrain: 'a hardy strain of grain for poor and cold land',
}

/** "ruinous", "harmful", "mildly harmful" or '' for a species' harm. */
export function harmWordOf(x: SpeciesInfo): string {
  const h = x.harm ?? 0
  return h >= 0.5 ? 'ruinous' : h >= 0.2 ? 'harmful' : h > 0 ? 'mildly harmful' : ''
}

/** Whether species x is habit-forming. */
export const isHabitForming = (x: SpeciesInfo) => (x.habit ?? 0) > 0 || x.category === SpeciesCategory.Stimulant

/** The good species x yields in trade (see SpeciesData.good). */
function goodOf(x: SpeciesInfo): number {
  const own = lookOf(x.archetype ?? '')?.good
  if (own !== undefined) return own
  return x.category === SpeciesCategory.Fibre ? Good.Cloth : x.category === SpeciesCategory.Luxury ? Good.Luxury : x.category === SpeciesCategory.Stimulant ? Good.Stimulant : -1
}

function hexRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

// ---------------------------------------------------------------------------
// reading the history

function readFields(h: History, P: number, N: number) {
  const p = h as Partial<History>
  const list = p.species
  if (!Array.isArray(list) || list.length === 0) return null
  const S = list.length
  const Y = p.speciesYear, Src = p.speciesSource
  if (!(Y instanceof Int16Array) || Y.length < P * S) return null
  const source = Src instanceof Int8Array && Src.length >= P * S ? Src : new Int8Array(P * S).fill(-1)
  const L = p.landSnapshotCount ?? 0
  const okLayer = (a: unknown) => (a instanceof Uint8Array && L > 0 && a.length >= L * N ? a : null)
  return { list, year: Y, source, crop: okLayer(p.crop), herd: okLayer(p.herd), cash: okLayer(p.cash) }
}

/** Largest living settlement (not a base) of people `p` at `year`, else its founder; -1 without peoples data. */
function largestOf(h: History, pd: PeoplesData, p: number, year: number): number {
  const N = h.settlements.length
  const s = Math.max(0, Math.min(h.snapshotCount - 1, Math.round(year / h.snapshotInterval)))
  let best = -1, bestPop = 0
  for (let i = 0; i < N; i++) {
    if (pd.people[i] !== p || (h.settlements[i] as { outpost?: boolean }).outpost === true) continue
    const v = h.population[s * N + i]
    if (v > bestPop) {
      bestPop = v
      best = i
    }
  }
  return best >= 0 ? best : pd.founder[p] ?? -1
}

/**
 * The people whose land each cell is at land snapshot `l` (-1 nobody's), into `out`
 * (length cellCount): from History.territory where the history has it, else the people of
 * the nearest living settlement within a few steps over land. `queue` and `depth` are
 * scratch (length cellCount).
 */
export function cellPeopleAt(world: World, h: History, people: ArrayLike<number>, l: number, out: Int16Array, queue: Int32Array, depth: Uint8Array): Int16Array {
  out.fill(-1)
  const p = h as Partial<History>
  const LC = p.landCells, T = p.territory
  const L = h.landSnapshotCount ?? 0
  if (LC instanceof Uint32Array && T instanceof Uint16Array && LC.length > 0 && T.length >= L * LC.length && l >= 0 && l < L) {
    const o = l * LC.length
    const NS = h.settlements.length
    for (let k = 0; k < LC.length; k++) {
      const v = T[o + k] - 1
      if (v >= 0 && v < NS) out[LC[k]] = people[v]
    }
    return out
  }
  const NS = h.settlements.length
  const sn = Math.max(0, Math.min(h.snapshotCount - 1, Math.round((l * (h.landInterval ?? 20)) / h.snapshotInterval)))
  let tail = 0
  for (let i = 0; i < NS; i++) {
    if (h.population[sn * NS + i] <= 0 || (h.settlements[i] as { outpost?: boolean }).outpost === true) continue
    const c = h.settlements[i].cell
    if (out[c] >= 0) continue
    out[c] = people[i]
    depth[c] = 0
    queue[tail++] = c
  }
  const { neighborOffsets: off, neighbors: nb } = world.grid
  for (let head = 0; head < tail; head++) {
    const c = queue[head]
    if (depth[c] >= 6) continue
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (out[j] >= 0 || world.elevation[j] < 0) continue
      out[j] = out[c]
      depth[j] = depth[c] + 1
      queue[tail++] = j
    }
  }
  return out
}

/** Species data for history `h`, or null when it has none. Run applySpeciesStandIn first (when developing without the real fields). */
export function buildSpeciesData(world: World, h: History, pd: PeoplesData | null, standIn = false): SpeciesData | null {
  if (!pd) return null
  const N = world.grid.cellCount
  const P = pd.count
  const f = readFields(h, P, N)
  if (!f) return null
  const S = f.list.length
  const NS = h.settlements.length
  // colours: the archetype's own, else the next palette colour within its category
  const css: string[] = new Array(S)
  const rgb = new Float32Array(S * 3)
  const perCat = new Int32Array(8)
  for (let sp = 0; sp < S; sp++) {
    const x = f.list[sp]
    const own = lookOf(x.archetype ?? '')
    const hex = own ? own.css : PALETTE[(perCat[Math.min(7, Math.max(0, x.category))]++ * 5 + x.category * 3) % PALETTE.length]
    css[sp] = hex
    rgb.set(hexRgb(hex), sp * 3)
  }
  const names = f.list.map((x, i) => (x.name ? x.name.charAt(0).toUpperCase() + x.name.slice(1) : `Species ${i + 1}`))
  const harmWord = f.list.map(harmWordOf)
  const plainGloss = f.list.map((x) => lookOf(x.archetype ?? '')?.gloss ?? speciesGloss(x.archetype ?? '', x.category))
  const gloss = plainGloss.map((g, i) => g + (harmWord[i] ? `, ${harmWord[i]}` : ''))
  const good = Int8Array.from(f.list, goodOf)
  const L = h.landSnapshotCount ?? 0
  const cropCells = new Uint32Array(Math.max(1, L) * S)
  const herdCells = new Uint32Array(Math.max(1, L) * S)
  const cashCells = new Uint32Array(Math.max(1, L) * S)
  const farmedCells = new Uint32Array(Math.max(1, L))
  const pastureCells = new Uint32Array(Math.max(1, L))
  const cashTotal = new Uint32Array(Math.max(1, L))
  const everGrown = new Uint8Array(S)
  for (let l = 0; l < L; l++) {
    const o = l * N
    if (f.crop) for (let c = 0; c < N; c++) { const v = f.crop[o + c]; if (v > 0 && v <= S) { cropCells[l * S + v - 1]++; farmedCells[l]++ } }
    if (f.herd) for (let c = 0; c < N; c++) { const v = f.herd[o + c]; if (v > 0 && v <= S) { herdCells[l * S + v - 1]++; pastureCells[l]++ } }
    if (f.cash) for (let c = 0; c < N; c++) { const v = f.cash[o + c]; if (v > 0 && v <= S) { cashCells[l * S + v - 1]++; cashTotal[l]++ } }
  }
  for (let l = 0; l < L; l++) for (let s = 0; s < S; s++) if (cropCells[l * S + s] || herdCells[l * S + s] || cashCells[l * S + s]) everGrown[s] = 1
  // the settlements nearest each origin (the nearest 24, of any year), for "native near Kepia"
  const P3 = world.grid.positions
  const dots = new Float64Array(NS)
  const nearestSettlements = (c: number) => {
    for (let i = 0; i < NS; i++) {
      const sc = h.settlements[i].cell
      dots[i] = P3[c * 3] * P3[sc * 3] + P3[c * 3 + 1] * P3[sc * 3 + 1] + P3[c * 3 + 2] * P3[sc * 3 + 2]
    }
    const ids = Array.from({ length: NS }, (_, i) => i).sort((a, b) => dots[b] - dots[a] || a - b)
    return Int32Array.from(ids.slice(0, 24))
  }
  const originNear = f.list.map((x) => (x.origins ?? []).filter((c) => c >= 0 && c < N).map(nearestSettlements))
  // the exchange web: from the SpeciesAdopted events when there are any, else from the sources between the peoples' founders
  const arcs: { s: number; a: number; b: number; y: number }[] = []
  for (const e of h.events) {
    if ((e.type as number) !== PeoplesEvent.SpeciesAdopted) continue
    if (e.value < 0 || e.value >= S || e.settlement < 0 || e.settlement >= NS || e.other < 0 || e.other >= NS) continue
    arcs.push({ s: e.value, a: h.settlements[e.other].cell, b: h.settlements[e.settlement].cell, y: e.year })
  }
  if (!arcs.length) {
    for (let p = 0; p < P; p++) {
      for (let s = 0; s < S; s++) {
        const q = f.source[p * S + s], y = f.year[p * S + s]
        if (q < 0 || q >= P || y < 0) continue
        const fa = pd.founder[q], fb = pd.founder[p]
        if (fa < 0 || fb < 0) continue
        arcs.push({ s, a: largestCell(h, pd, q, y), b: largestCell(h, pd, p, y), y })
      }
    }
  }
  arcs.sort((x, y) => x.y - y.y)
  // epidemics: pulses at the stricken people's larger settlements
  const eCells: number[] = [], eYears: number[] = []
  for (const e of h.events) {
    if ((e.type as number) !== PeoplesEvent.Epidemic || e.settlement < 0 || e.settlement >= NS) continue
    const p = pd.people[e.settlement]
    const sn = Math.max(0, Math.min(h.snapshotCount - 1, Math.round(e.year / h.snapshotInterval)))
    const mine: number[] = []
    for (let i = 0; i < NS; i++) if (pd.people[i] === p && h.population[sn * NS + i] > 0 && (h.settlements[i] as { outpost?: boolean }).outpost !== true) mine.push(i)
    mine.sort((a, b) => h.population[sn * NS + b] - h.population[sn * NS + a])
    for (const i of mine.slice(0, 6)) {
      eCells.push(h.settlements[i].cell)
      eYears.push(e.year + (i === e.settlement ? 0 : 0.6))
    }
  }
  const hazard = buildHazards(world, h, pd, f.crop, f.herd, S)
  const habits = readHabits(h, pd, S)
  const tech = readTechniques(h, pd)
  return {
    count: S,
    list: f.list,
    css,
    rgb,
    names,
    gloss,
    plainGloss,
    good,
    harmWord,
    peoples: P,
    year: f.year,
    source: f.source,
    crop: f.crop,
    herd: f.herd,
    cash: f.cash,
    cellCount: N,
    landInterval: h.landInterval ?? 20,
    landCount: L,
    cropCells,
    herdCells,
    cashCells,
    farmedCells,
    pastureCells,
    cashTotal,
    everGrown,
    originNear,
    arcSpecies: Int32Array.from(arcs, (a) => a.s),
    arcFrom: Int32Array.from(arcs, (a) => a.a),
    arcTo: Int32Array.from(arcs, (a) => a.b),
    arcYear: Float32Array.from(arcs, (a) => a.y),
    epidemicCells: Int32Array.from(eCells),
    epidemicYears: Float32Array.from(eYears),
    ...hazard,
    ...habits,
    snapshotCount: h.snapshotCount,
    snapshotInterval: h.snapshotInterval,
    settlementCount: NS,
    ...tech,
    standIn,
  }
}

/** Habits per people (History.habit, stimulants, HabitSpreads events) and the stored food (History.storable). */
function readHabits(h: History, pd: PeoplesData, S: number) {
  const p = h as Partial<History>
  const P = pd.count
  const NS = h.settlements.length
  const stim = Array.isArray(p.stimulants) ? p.stimulants.filter((s) => s >= 0 && s < S) : []
  const K = stim.length
  const habit = K > 0 && p.habit instanceof Uint8Array && p.habit.length >= h.snapshotCount * P * K && stim.length === p.stimulants!.length ? p.habit : null
  const stimIndex = new Int8Array(S).fill(-1)
  if (habit) stim.forEach((s, k) => (stimIndex[s] = k))
  const habitSince = new Int16Array(Math.max(1, P * K)).fill(-1)
  const habitFrom = new Int8Array(Math.max(1, P * K)).fill(-1)
  if (habit) {
    for (const e of h.events) {
      if ((e.type as number) !== EventType.HabitSpreads || e.settlement < 0 || e.settlement >= NS) continue
      const k = e.value >= 0 && e.value < S ? stimIndex[e.value] : -1
      const q = pd.people[e.settlement]
      if (k < 0 || q < 0 || q >= P || habitSince[q * K + k] >= 0) continue
      habitSince[q * K + k] = e.year
      habitFrom[q * K + k] = e.other >= 0 && e.other < NS ? pd.people[e.other] : -1
    }
  }
  const storable = p.storable instanceof Uint8Array && p.storable.length >= h.snapshotCount * NS ? p.storable : null
  return { stimulants: habit ? stim : [], stimIndex, habit, habitSince, habitFrom, storable }
}

/** Techniques: names, glosses, who held them since when, where first worked out, and their exchange web. */
function readTechniques(h: History, pd: PeoplesData) {
  const p = h as Partial<History>
  const P = pd.count
  const NS = h.settlements.length
  const list0 = Array.isArray(p.techniques) ? p.techniques : []
  const T0 = list0.length
  const ok = T0 > 0 && p.techniqueYear instanceof Int16Array && p.techniqueYear.length >= P * T0
  const techniques: readonly TechniqueInfo[] = ok ? list0 : []
  const T = techniques.length
  const techYear = ok ? (p.techniqueYear as Int16Array) : new Int16Array(0)
  const techSource = ok && p.techniqueSource instanceof Int8Array && p.techniqueSource.length >= P * T ? p.techniqueSource : new Int8Array(P * T).fill(-1)
  const techNames = techniques.map((t, k) => (t.name ? t.name.charAt(0).toUpperCase() + t.name.slice(1) : `Technique ${k + 1}`))
  const techGloss = techniques.map((t) => TECHNIQUE_GLOSS[(t.archetype ?? '').toLowerCase()] ?? 'a farming technique')
  const techFirstCell = new Int32Array(T).fill(-1)
  const techFirstYear = new Int32Array(T).fill(-1)
  const techFirstPeople = new Int32Array(T).fill(-1)
  for (let k = 0; k < T; k++) {
    for (let q = 0; q < P; q++) {
      const y = techYear[q * T + k]
      if (y >= 0 && (techFirstYear[k] < 0 || y < techFirstYear[k]) && techSource[q * T + k] < 0) {
        techFirstYear[k] = y
        techFirstPeople[k] = q
      }
    }
  }
  for (const e of h.events) {
    if ((e.type as number) !== EventType.TechniqueFound || e.value < 0 || e.value >= T || e.settlement < 0 || e.settlement >= NS) continue
    const k = e.value
    if (techFirstCell[k] < 0 || e.year < techFirstYear[k]) {
      techFirstCell[k] = h.settlements[e.settlement].cell
      if (techFirstYear[k] < 0 || e.year < techFirstYear[k]) {
        techFirstYear[k] = e.year
        techFirstPeople[k] = pd.people[e.settlement]
      }
    }
  }
  for (let k = 0; k < T; k++) if (techFirstCell[k] < 0 && techFirstPeople[k] >= 0) techFirstCell[k] = largestCell(h, pd, techFirstPeople[k], techFirstYear[k])
  const arcs: { k: number; a: number; b: number; y: number }[] = []
  for (const e of h.events) {
    if ((e.type as number) !== EventType.TechniqueAdopted || e.value < 0 || e.value >= T) continue
    if (e.settlement < 0 || e.settlement >= NS || e.other < 0 || e.other >= NS) continue
    arcs.push({ k: e.value, a: h.settlements[e.other].cell, b: h.settlements[e.settlement].cell, y: e.year })
  }
  if (!arcs.length) {
    for (let q = 0; q < P; q++) {
      for (let k = 0; k < T; k++) {
        const src = techSource[q * T + k], y = techYear[q * T + k]
        if (src < 0 || src >= P || y < 0) continue
        arcs.push({ k, a: largestCell(h, pd, src, y), b: largestCell(h, pd, q, y), y })
      }
    }
  }
  arcs.sort((x, y) => x.y - y.y)
  return {
    techniques,
    techNames,
    techGloss,
    techYear,
    techSource,
    techFirstCell,
    techFirstYear,
    techFirstPeople,
    techArc: Int32Array.from(arcs, (a) => a.k),
    techArcFrom: Int32Array.from(arcs, (a) => a.a),
    techArcTo: Int32Array.from(arcs, (a) => a.b),
    techArcYear: Float32Array.from(arcs, (a) => a.y),
  }
}

/** Most cells one blight or plague pulse covers. */
const HAZARD_MAX_CELLS = 700

/**
 * Blight and livestock plague pulses: for each Blight (Panzootic) event, the cells of the
 * stricken people's land whose main crop (herd) is that species at the land snapshot of
 * the year, delayed by their distance from where it struck first; if none match, the land
 * around that settlement.
 */
function buildHazards(world: World, h: History, pd: PeoplesData, crop: Uint8Array | null, herd: Uint8Array | null, S: number) {
  const N = world.grid.cellCount
  const NS = h.settlements.length
  const L = h.landSnapshotCount ?? 0
  const cells: number[] = [], years: number[] = [], delay: number[] = [], kind: number[] = []
  const owner = new Int16Array(N)
  const queue = new Int32Array(N)
  const depth = new Uint8Array(N)
  const dist = new Int32Array(N)
  let ownerL = -1
  const { neighborOffsets: off, neighbors: nb } = world.grid
  for (const e of h.events) {
    const t = e.type as number
    if (t !== EventType.Blight && t !== EventType.Panzootic) continue
    if (e.settlement < 0 || e.settlement >= NS || e.value < 0 || e.value >= S) continue
    const layer = t === EventType.Blight ? crop : herd
    const p = pd.people[e.settlement]
    const start = h.settlements[e.settlement].cell
    // distance over land from where it struck first
    dist.fill(-1)
    dist[start] = 0
    let tail = 0
    queue[tail++] = start
    for (let head = 0; head < tail; head++) {
      const c = queue[head]
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (dist[j] >= 0 || world.elevation[j] < 0) continue
        dist[j] = dist[c] + 1
        queue[tail++] = j
      }
    }
    const mine: number[] = []
    if (layer && L > 0) {
      const l = Math.max(0, Math.min(L - 1, Math.floor(e.year / Math.max(1, h.landInterval ?? 20) + 1e-6)))
      if (l !== ownerL) {
        cellPeopleAt(world, h, pd.people, l, owner, queue, depth)
        ownerL = l
      }
      const o = l * N
      for (let c = 0; c < N; c++) if (layer[o + c] === e.value + 1 && owner[c] === p && dist[c] >= 0) mine.push(c)
    }
    if (!mine.length) for (let c = 0; c < N; c++) if (dist[c] >= 0 && dist[c] <= 2) mine.push(c)
    mine.sort((a, b) => dist[a] - dist[b] || a - b)
    if (mine.length > HAZARD_MAX_CELLS) mine.length = HAZARD_MAX_CELLS
    const far = Math.max(1, dist[mine[mine.length - 1]] ?? 1)
    for (const c of mine) {
      cells.push(c)
      years.push(e.year)
      delay.push(dist[c] / far)
      kind.push(t === EventType.Blight ? 0 : 1)
    }
  }
  return { hazardCells: Int32Array.from(cells), hazardYears: Float32Array.from(years), hazardDelay: Float32Array.from(delay), hazardKind: Uint8Array.from(kind) }
}

function largestCell(h: History, pd: PeoplesData, p: number, year: number): number {
  const id = largestOf(h, pd, p, year)
  return id >= 0 ? h.settlements[id].cell : 0
}

/** Species people `p` holds at `year`, in id order (into `out`). */
export function heldAt(d: SpeciesData, p: number, year: number, out: number[]): number[] {
  out.length = 0
  if (p < 0 || p >= d.peoples) return out
  for (let s = 0; s < d.count; s++) {
    const y = d.year[p * d.count + s]
    if (y >= 0 && y <= year) out.push(s)
  }
  return out
}

/** Number of peoples holding species `s` at `year`. */
export function holdersAt(d: SpeciesData, s: number, year: number): number {
  let n = 0
  for (let p = 0; p < d.peoples; p++) {
    const y = d.year[p * d.count + s]
    if (y >= 0 && y <= year) n++
  }
  return n
}

/** Number of peoples holding technique `k` at `year`. */
export function techHoldersAt(d: SpeciesData, k: number, year: number): number {
  const T = d.techniques.length
  let n = 0
  for (let p = 0; p < d.peoples; p++) {
    const y = d.techYear[p * T + k]
    if (y >= 0 && y <= year) n++
  }
  return n
}

/** Land snapshot whose crop, herd and cash layers show at `year` (they switch at the snapshot year). */
export function cropSnapshotAt(d: SpeciesData, year: number): number {
  return Math.max(0, Math.min(d.landCount - 1, Math.floor(year / Math.max(1, d.landInterval) + 1e-6)))
}

/** Snapshot (of `habit` and `storable`) shown at `year`: the nearest, as the population snapshots are. */
export function habitSnapshotAt(d: SpeciesData, year: number): number {
  return Math.max(0, Math.min(d.snapshotCount - 1, Math.round(year / Math.max(1, d.snapshotInterval))))
}

/** Habit 0..255 of people `p` for stimulant index `k` at snapshot `s` (0 without habit data). */
export function habitLevel(d: SpeciesData, s: number, p: number, k: number): number {
  const K = d.stimulants.length
  if (!d.habit || k < 0 || k >= K || p < 0 || p >= d.peoples) return 0
  return d.habit[(s * d.peoples + p) * K + k]
}

/** The layer (crop, herd or cash) on which species `s` is the main one of a cell, or null. */
export function layerOf(d: SpeciesData, s: number): Uint8Array | null {
  const c = d.list[s]?.category
  return c === SpeciesCategory.Staple ? d.crop : c === SpeciesCategory.Livestock ? d.herd : c === SpeciesCategory.Fibre || c === SpeciesCategory.Luxury || c === SpeciesCategory.Stimulant ? d.cash : null
}

// ---------------------------------------------------------------------------
// DEV STAND-IN (see STAND_IN)

interface Arch { a: string; c: number; t: number; r: number; hi: number }
const STAND_IN_SPECIES: Arch[] = [
  { a: 'wheat', c: 0, t: 0.55, r: 0.36, hi: 0 },
  { a: 'rice', c: 0, t: 0.82, r: 0.78, hi: 0 },
  { a: 'potato', c: 0, t: 0.38, r: 0.5, hi: 1 },
  { a: 'maize', c: 0, t: 0.7, r: 0.52, hi: 0 },
  { a: 'millet', c: 0, t: 0.78, r: 0.24, hi: 0 },
  { a: 'taro', c: 0, t: 0.88, r: 0.86, hi: 0 },
  { a: 'barley', c: 0, t: 0.42, r: 0.3, hi: 0 },
  { a: 'sheep', c: 1, t: 0.45, r: 0.34, hi: 0 },
  { a: 'cattle', c: 1, t: 0.6, r: 0.5, hi: 0 },
  { a: 'goat', c: 1, t: 0.62, r: 0.24, hi: 1 },
  { a: 'camel', c: 1, t: 0.8, r: 0.1, hi: 0 },
  { a: 'llama', c: 1, t: 0.4, r: 0.42, hi: 1 },
]

function hashf(a: number, b: number, c = 0): number {
  let x = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b) ^ Math.imul(c + 13, 0xc2b2ae35)) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39) >>> 0
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296
}

function fitOf(world: World, c: number, k: Arch): number {
  const T = world.temperature[c], R = world.rainfall[c], E = Math.max(0, world.elevation[c])
  const base = Math.exp(-(((T - k.t) / 0.2) ** 2) - (((R - k.r) / 0.28) ** 2))
  const s = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
  return base * (k.hi ? 0.55 + 0.9 * s(0.12, 0.42, E) : 1 - 0.55 * s(0.3, 0.6, E))
}

/**
 * Fabricates History.species, speciesYear, speciesSource, crop and herd and the species
 * events when STAND_IN asks for it (see the header), writing them into `h` (its events
 * replaced by a sorted copy). Run it after buildPeoplesData and before the history index.
 * Returns whether it did.
 */
export function applySpeciesStandIn(world: World, h: History, pd: PeoplesData | null): boolean {
  if (STAND_IN === 'off' || !pd || pd.count === 0) return false
  const N = world.grid.cellCount
  if (STAND_IN === 'fallback' && readFields(h, pd.count, N)) return false
  const P = pd.count
  const S = STAND_IN_SPECIES.length
  const NS = h.settlements.length
  const fcell = (p: number) => h.settlements[pd.founder[p]]?.cell ?? 0
  const cradle = (p: number) => ((h as Partial<History>).peoples?.[p] as { cradle?: number } | undefined)?.cradle ?? p
  // origins: the people whose homeland suits it best (spread over peoples), sometimes a second in another cradle
  const load = new Int32Array(P)
  const origins: number[][] = []
  for (let s = 0; s < S; s++) {
    const k = STAND_IN_SPECIES[s]
    const score = (p: number) => fitOf(world, fcell(p), k) * (0.65 + 0.7 * hashf(p, s, world.seed)) / (1 + load[p])
    let best = 0
    for (let p = 1; p < P; p++) if (score(p) > score(best)) best = p
    load[best]++
    const o = [best]
    if (s % 3 === 1) {
      let second = -1
      for (let p = 0; p < P; p++) if (cradle(p) !== cradle(best) && fitOf(world, fcell(p), k) > 0.25 && (second < 0 || score(p) > score(second))) second = p
      if (second >= 0) { o.push(second); load[second]++ }
    }
    origins.push(o)
  }
  // names in the language of the first people to hold it: a piece of one of its place names
  const used = new Set<string>()
  const species: SpeciesInfo[] = STAND_IN_SPECIES.map((k, s) => {
    const p = origins[s][0]
    const own = h.settlements.filter((x) => pd.people[x.id] === p)
    let name = ''
    for (let t = 0; t < 8 && (!name || used.has(name)); t++) {
      const src = (own[Math.floor(hashf(s, t, 3) * own.length)]?.name ?? 'kala').toLowerCase().replace(/[^a-z]/g, '')
      const cut = 3 + Math.floor(hashf(s, t, 5) * 2)
      const ends = ['u', 'i', 'el', 'an', 'o', 'ra', 'ek', 'ish']
      name = src.slice(0, cut).replace(/[aeiou]+$/, '') + ends[Math.floor(hashf(s, t, 9) * ends.length)]
    }
    used.add(name)
    return { id: s, archetype: k.a, category: k.c as SpeciesCategory, name, origins: origins[s].map(fcell), yield: k.c === 0 ? 0.8 + 0.5 * hashf(s, 1) : 0 }
  })
  // who holds what from when: the origins from the start or a domestication, then along contacts
  const Y = new Int16Array(P * S).fill(-1)
  const Src = new Int8Array(P * S).fill(-1)
  const added: HistoryEvent[] = []
  const C = pd.contactYear
  for (let s = 0; s < S; s++) {
    const k = STAND_IN_SPECIES[s]
    const tent = new Float64Array(P).fill(Infinity)
    const from = new Int32Array(P).fill(-1)
    for (const p of origins[s]) {
      const tamed = hashf(s, p, 11) < 0.5 ? 0 : Math.round(150 + hashf(s, p, 12) * 750)
      tent[p] = tamed
      if (tamed > 0) {
        const at = largestOf(h, pd, p, tamed)
        if (at >= 0) added.push({ year: tamed, type: PeoplesEvent.Domesticated as EventType, settlement: at, other: -1, value: s })
      }
    }
    const done = new Uint8Array(P)
    for (let it = 0; it < P; it++) {
      let p = -1
      for (let q = 0; q < P; q++) if (!done[q] && tent[q] < Infinity && (p < 0 || tent[q] < tent[p])) p = q
      if (p < 0) break
      done[p] = 1
      Y[p * S + s] = Math.round(tent[p])
      Src[p * S + s] = from[p]
      for (let q = 0; q < P; q++) {
        const met = C[p * P + q]
        if (done[q] || q === p || met < 0) continue
        if (fitOf(world, fcell(q), k) < 0.16) continue // its homeland does not suit it
        const y = Math.max(tent[p], met) + 25 + hashf(s, p * 31 + q, 13) * 110
        if (y > h.years) continue
        if (y < tent[q]) { tent[q] = y; from[q] = p }
      }
    }
    for (let q = 0; q < P; q++) {
      const src = Src[q * S + s], y = Y[q * S + s]
      if (src < 0 || y < 0) continue
      const at = largestOf(h, pd, q, y), by = largestOf(h, pd, src, y)
      if (at >= 0 && by >= 0) added.push({ year: y, type: PeoplesEvent.SpeciesAdopted as EventType, settlement: at, other: by, value: s })
    }
  }
  // epidemics: the first contact across cradles often brings a sickness new to the smaller people (one each at most)
  const struck = new Uint8Array(P)
  for (let a = 0; a < P; a++) {
    for (let b = a + 1; b < P; b++) {
      const met = C[a * P + b]
      if (met <= 0 || (cradle(a) === cradle(b) && hashf(a, b, 21) > 0.25) || hashf(a, b, 22) > 0.6) continue
      const sn = Math.max(0, Math.min(h.snapshotCount - 1, Math.round(met / h.snapshotInterval)))
      const victim = pd.population[sn * P + a] < pd.population[sn * P + b] ? a : b
      if (struck[victim]) continue
      struck[victim] = 1
      const y = Math.min(h.years, met + 2 + Math.floor(hashf(a, b, 23) * 10))
      const at = largestOf(h, pd, victim, y), by = largestOf(h, pd, victim === a ? b : a, y)
      if (at >= 0 && by >= 0) added.push({ year: y, type: PeoplesEvent.Epidemic as EventType, settlement: at, other: by, value: 0.1 + hashf(a, b, 24) * 0.25 })
    }
  }
  // crop and herd layers: per land snapshot, each farmed cell grows the best-suited staple its nearest settlement's people holds
  const L = h.landSnapshotCount ?? 0
  const LI = h.landInterval ?? 20
  const U = (h as Partial<History>).landUse
  const crop = new Uint8Array(Math.max(0, L) * N)
  const herd = new Uint8Array(Math.max(0, L) * N)
  if (U instanceof Uint8Array && U.length >= L * N) {
    const { neighborOffsets: off, neighbors: nb } = world.grid
    const owner = new Int32Array(N)
    const depth = new Int8Array(N)
    const queue = new Int32Array(N)
    const fits = new Float32Array(N * S)
    for (let c = 0; c < N; c++) if (world.elevation[c] >= 0) for (let s = 0; s < S; s++) fits[c * S + s] = fitOf(world, c, STAND_IN_SPECIES[s]) * (0.85 + 0.3 * hashf(c, s, 31))
    for (let l = 0; l < L; l++) {
      const year = l * LI
      const sn = Math.max(0, Math.min(h.snapshotCount - 1, Math.round(year / h.snapshotInterval)))
      owner.fill(-1)
      let tail = 0
      for (let i = 0; i < NS; i++) {
        if (h.population[sn * NS + i] <= 0 || (h.settlements[i] as { outpost?: boolean }).outpost === true) continue
        const c = h.settlements[i].cell
        if (owner[c] >= 0) continue
        owner[c] = pd.people[i]
        depth[c] = 0
        queue[tail++] = c
      }
      for (let head = 0; head < tail; head++) {
        const c = queue[head]
        if (depth[c] >= 6) continue
        for (let k = off[c]; k < off[c + 1]; k++) {
          const j = nb[k]
          if (owner[j] >= 0 || world.elevation[j] < 0) continue
          owner[j] = owner[c]
          depth[j] = depth[c] + 1
          queue[tail++] = j
        }
      }
      for (let c = 0; c < N; c++) {
        const u = U[l * N + c]
        const p = owner[c]
        if (p < 0 || u < 12) continue
        let bc = -1, bh = -1, fc = 0.04, fh = 0.04
        for (let s = 0; s < S; s++) {
          const y = Y[p * S + s]
          if (y < 0 || y > year) continue
          const v = fits[c * S + s]
          if (STAND_IN_SPECIES[s].c === 0) { if (u >= 30 && v > fc) { fc = v; bc = s } } else if (v > fh) { fh = v; bh = s }
        }
        crop[l * N + c] = bc + 1
        herd[l * N + c] = bh + 1
      }
    }
  }
  const hw = h as unknown as Record<string, unknown>
  hw.species = species
  hw.speciesYear = Y
  hw.speciesSource = Src
  hw.crop = crop
  hw.herd = herd
  const kept = h.events.filter((e) => (e.type as number) < PeoplesEvent.Domesticated || (e.type as number) > PeoplesEvent.Epidemic)
  h.events = [...kept, ...added].sort((a, b) => a.year - b.year)
  return true
}
