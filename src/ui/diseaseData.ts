// Epidemic disease of a History (contract: History.diseases .. quarantines), indexed for the UI:
// the outbreaks by year (binary-searchable), by settlement and by epidemic; who is sick at a
// year; the epidemics going on at a year and how far each has got; the world's diseases with a
// gloss by archetype and kind; endemic sickness and fever tolerance per people at a snapshot;
// ports in quarantine; armies struck by sickness per faction. Built once per history (diseaseOf
// caches it); all of it is optional at runtime: a history without disease data (or with none
// that ever struck) gives null and the UI hides what it would show.
//
// A settlement struck in an outbreak row is sick from `year` to `year + duration - 1`; the
// toll is mortality / 255 of its people (spread over the duration).

import { Biome, CITY_POPULATION, DiseaseKind, DiseaseVia, EventType, type DiseaseInfo, type EpidemicInfo, type History, type Outbreaks, type Quarantines, type World } from '../contract.ts'
import { politiesOf, polityAtYear } from './politiesData.ts'
import { peopleName, settlementName } from './format.ts'

export interface DiseaseData {
  history: History
  /** Settlements, peoples, diseases, epidemics, outbreak rows. */
  N: number
  P: number
  D: number
  E: number
  R: number
  diseases: DiseaseInfo[]
  epidemics: EpidemicInfo[]
  O: Outbreaks
  /** Display name per disease ("Bunewu"; '' if it never appeared), and its gloss ("the plague of the steppe rodents"). */
  names: string[]
  gloss: string[]
  /** Disease kind per outbreak row. */
  rowKind: Uint8Array
  /** Year struck and first year well again (year + duration) per row; rowYear ascending. */
  rowYear: Float64Array
  rowEnd: Float64Array
  /** Expected deaths per row (people), and the place's people when struck. */
  rowDeaths: Float32Array
  rowPop: Float32Array
  /** 1 where the place was a city (>= CITY_POPULATION) when struck. */
  rowCity: Uint8Array
  /** Longest duration of any disease. */
  maxDuration: number
  /** Rows per settlement (CSR, chronological). */
  sOff: Uint32Array
  sList: Int32Array
  /** Rows per epidemic (CSR, chronological), their years, and the running sum of their deaths. */
  eOff: Uint32Array
  eList: Int32Array
  eYear: Float64Array
  eCum: Float64Array
  /** Last year of each epidemic (its endYear, or the end of the run while still going). */
  epiEnd: Float64Array
  /** Great epidemics by start year. */
  great: number[]
  /** Ports in quarantine (rows of History.quarantines) per settlement. */
  Q: Quarantines | null
  qOf: Map<number, number[]>
  /** ArmyStricken events (indices into History.events) by the faction whose army it was. */
  armiesOf: Map<number, number[]>
  /** Per-cell fever (0..255), static, or null. */
  fever: Uint8Array | null
  /** Snapshot layout of feverTolerance / endemic (null when absent). */
  tolerance: Uint8Array | null
  endemic: Uint8Array | null
  /** Losses per people per great epidemic (lazy). */
  peopleLoss: Map<number, { epi: number; share: number; deaths: number }[]>
  /** Whether the glosses were made with the world's biomes (the plague's reservoir). */
  withWorld: boolean
}

const cache = new WeakMap<History, DiseaseData | null>()

/** The disease data of a history, or null when it has none (cached; `world` sharpens the plague's gloss). */
export function diseaseOf(h: History | null | undefined, world?: World | null): DiseaseData | null {
  if (!h) return null
  if (cache.has(h)) {
    const d = cache.get(h) ?? null
    if (d && world && !d.withWorld) {
      d.gloss = d.diseases.map((x) => diseaseGloss(x, world))
      d.withWorld = true
    }
    return d
  }
  let d: DiseaseData | null = null
  try {
    d = buildDiseaseData(h, world ?? null)
  } catch (err) {
    console.warn('disease: data unusable, hidden', err)
    d = null
  }
  cache.set(h, d)
  return d
}

function buildDiseaseData(h: History, world: World | null): DiseaseData | null {
  const p = h as Partial<History>
  const diseases = Array.isArray(p.diseases) ? p.diseases : []
  const epidemics = Array.isArray(p.epidemics) ? p.epidemics : []
  const O = p.outbreaks
  if (!diseases.length || !O || !(O.count >= 0) || !O.year || !O.settlement) return null
  if (!diseases.some((x) => x.firstYear >= 0)) return null
  const N = h.settlements.length
  const P = Array.isArray(p.peoples) ? p.peoples.length : 0
  const D = diseases.length
  const E = epidemics.length
  const R = O.count
  const S = h.snapshotCount
  for (const a of [O.disease, O.settlement, O.year, O.mortality, O.source, O.via, O.epidemic]) if (!a || a.length < R) return null
  const rowKind = new Uint8Array(R)
  const rowYear = new Float64Array(R)
  const rowEnd = new Float64Array(R)
  const rowDeaths = new Float32Array(R)
  const rowPop = new Float32Array(R)
  const rowCity = new Uint8Array(R)
  let maxDuration = 1
  for (const x of diseases) maxDuration = Math.max(maxDuration, x.duration || 1)
  let sorted = true
  for (let i = 0; i < R; i++) {
    const d = diseases[O.disease[i]]
    rowKind[i] = d ? d.kind : DiseaseKind.Crowd
    rowYear[i] = O.year[i]
    rowEnd[i] = O.year[i] + Math.max(1, d?.duration ?? 1)
    if (i > 0 && rowYear[i] < rowYear[i - 1]) sorted = false
    const id = O.settlement[i]
    // the place's people when struck (interpolated between snapshots)
    let pop = 0
    if (id >= 0 && id < N) {
      const x = Math.min(Math.max(O.year[i] / h.snapshotInterval, 0), S - 1)
      const s0 = Math.floor(x), s1 = Math.min(s0 + 1, S - 1)
      const a = h.population[s0 * N + id], b = h.population[s1 * N + id]
      pop = a > 0 && b > 0 ? a + (b - a) * (x - s0) : Math.max(a, b)
    }
    rowPop[i] = pop
    rowDeaths[i] = (pop * O.mortality[i]) / 255
    rowCity[i] = pop >= CITY_POPULATION ? 1 : 0
  }
  if (!sorted) {
    // (the contract keeps them in order of the year struck; every search here relies on it)
    console.warn('disease: outbreak rows are not in year order; hidden')
    return null
  }
  // per settlement
  const sOff = new Uint32Array(N + 1)
  for (let i = 0; i < R; i++) {
    const id = O.settlement[i]
    if (id >= 0 && id < N) sOff[id + 1]++
  }
  for (let i = 0; i < N; i++) sOff[i + 1] += sOff[i]
  const sList = new Int32Array(sOff[N])
  {
    const cur = sOff.slice(0, N)
    for (let i = 0; i < R; i++) {
      const id = O.settlement[i]
      if (id >= 0 && id < N) sList[cur[id]++] = i
    }
  }
  // per epidemic
  const eOff = new Uint32Array(E + 1)
  for (let i = 0; i < R; i++) {
    const e = O.epidemic[i]
    if (e >= 0 && e < E) eOff[e + 1]++
  }
  for (let e = 0; e < E; e++) eOff[e + 1] += eOff[e]
  const eList = new Int32Array(eOff[E])
  {
    const cur = eOff.slice(0, E)
    for (let i = 0; i < R; i++) {
      const e = O.epidemic[i]
      if (e >= 0 && e < E) eList[cur[e]++] = i
    }
  }
  const eYear = Float64Array.from(eList, (i) => O.year[i])
  // (the places' tolls times their people, scaled so that each epidemic's sum is its own count of the dead)
  for (let e = 0; e < E; e++) {
    let s = 0
    for (let k = eOff[e]; k < eOff[e + 1]; k++) s += rowDeaths[eList[k]]
    const want = epidemics[e].deaths
    if (s > 0 && want > 0) for (let k = eOff[e]; k < eOff[e + 1]; k++) rowDeaths[eList[k]] *= want / s
  }
  const eCum = new Float64Array(eList.length)
  for (let e = 0; e < E; e++) {
    let s = 0
    for (let k = eOff[e]; k < eOff[e + 1]; k++) {
      s += rowDeaths[eList[k]]
      eCum[k] = s
    }
  }
  const epiEnd = Float64Array.from(epidemics, (x) => (x.endYear >= 0 ? x.endYear : h.years))
  const great = epidemics.filter((x) => x.great).sort((a, b) => a.startYear - b.startYear || a.id - b.id).map((x) => x.id)
  // quarantine
  const Qr = p.quarantines
  const Q = Qr && Qr.count > 0 && Qr.settlement && Qr.from && Qr.to ? Qr : null
  const qOf = new Map<number, number[]>()
  if (Q) for (let i = 0; i < Q.count; i++) {
    const id = Q.settlement[i]
    const a = qOf.get(id)
    if (a) a.push(i)
    else qOf.set(id, [i])
  }
  // armies struck, by the faction of the settlement they marched from
  const armiesOf = new Map<number, number[]>()
  const pd = politiesOf(h)
  if (pd) h.events.forEach((e, i) => {
    if ((e.type as number) !== EventType.ArmyStricken || e.other < 0) return
    const q = polityAtYear(pd, e.other, e.year)
    if (q < 0) return
    const a = armiesOf.get(q)
    if (a) a.push(i)
    else armiesOf.set(q, [i])
  })
  const cells = world?.grid.cellCount ?? h.capacity.length
  const fever = p.fever instanceof Uint8Array && p.fever.length >= cells ? p.fever : null
  const tolerance = p.feverTolerance instanceof Uint8Array && P > 0 && p.feverTolerance.length >= S * P ? p.feverTolerance : null
  const endemic = p.endemic instanceof Uint8Array && P > 0 && p.endemic.length >= S * P ? p.endemic : null
  const names = diseases.map((x) => (x.name ? x.name.charAt(0).toUpperCase() + x.name.slice(1) : ''))
  return {
    history: h, N, P, D, E, R, diseases, epidemics, O, names,
    gloss: diseases.map((x) => diseaseGloss(x, world)),
    rowKind, rowYear, rowEnd, rowDeaths, rowPop, rowCity, maxDuration,
    sOff, sList, eOff, eList, eYear, eCum, epiEnd, great, Q, qOf, armiesOf, fever, tolerance, endemic,
    peopleLoss: new Map(), withWorld: world !== null,
  }
}

// ---------------------------------------------------------------------------
// words

/** Where the plague's reservoir lies, as the rodents' country ("steppe"). */
function reservoirWord(world: World | null, cell: number): string {
  if (!world || cell < 0 || cell >= world.grid.cellCount) return 'wild'
  switch (world.biome[cell]) {
    case Biome.Grassland:
    case Biome.Savanna: return 'steppe'
    case Biome.Desert: return 'desert'
    case Biome.Mountain: return 'mountain'
    case Biome.Taiga:
    case Biome.TemperateForest: return 'forest'
    case Biome.Rainforest: return 'jungle'
    case Biome.Tundra: return 'tundra'
    default: return 'wild'
  }
}

/** "a pox of the herding peoples", "the plague of the steppe rodents", "a camp fever", "the marsh fever". */
export function diseaseGloss(d: DiseaseInfo, world: World | null): string {
  switch (d.archetype) {
    case 'pox': return 'a pox of the herding peoples'
    case 'measles': return 'a spotted fever of the towns'
    case 'flux': return 'a bloody flux of crowded places'
    case 'plague': return `the plague of the ${reservoirWord(world, d.originCell)} rodents`
    case 'fever': return 'the marsh fever'
    case 'typhus': return 'a camp fever'
  }
  return d.kind === DiseaseKind.Plague ? 'a plague of the wild rodents' : d.kind === DiseaseKind.Fever ? 'a fever of the hot lowlands' : d.kind === DiseaseKind.Camp ? 'a camp fever' : 'a sickness of herds and towns'
}

export const KIND_WORDS: readonly string[] = ['Crowd sickness', 'Plague', 'Fever', 'Camp fever']
/** Colours per disease kind (CSS), as the map draws them (render/disease.ts). */
export const KIND_CSS: readonly string[] = ['#cfe24c', '#b968ff', '#ff9a3c', '#8fb2ff']
export const KIND_RGB: readonly (readonly [number, number, number])[] = [[0.81, 0.89, 0.3], [0.73, 0.41, 1.0], [1.0, 0.6, 0.24], [0.56, 0.7, 1.0]]

/** How an outbreak came: "by sea from Rilko". */
export function viaWords(via: number): string {
  switch (via) {
    case DiseaseVia.Origin: return 'began here'
    case DiseaseVia.Route: return 'along the trade road'
    case DiseaseVia.Sea: return 'by sea'
    case DiseaseVia.Near: return 'from nearby'
    case DiseaseVia.Kin: return 'from kin'
    case DiseaseVia.Journey: return 'with travellers'
    case DiseaseVia.Army: return 'with an army'
    case DiseaseVia.Contact: return 'at first contact'
    case DiseaseVia.Focus: return 'from where it lingered'
  }
  return ''
}

/** How an outbreak came from `from`: "by sea from Rilko", "along the trade road from Razu", "(began here)". */
export function viaPhrase(via: number, from: string): string {
  switch (via) {
    case DiseaseVia.Origin: return '(began here)'
    case DiseaseVia.Route: return `along the trade road from ${from}`
    case DiseaseVia.Sea: return `by sea from ${from}`
    case DiseaseVia.Near: return `from neighbouring ${from}`
    case DiseaseVia.Kin: return `from its kin at ${from}`
    case DiseaseVia.Journey: return `with travellers from ${from}`
    case DiseaseVia.Army: return `with an army from ${from}`
    case DiseaseVia.Contact: return `at first contact with ${from}`
    case DiseaseVia.Focus: return `returning from ${from}`
  }
  return `from ${from}`
}

const ORDINALS = ['', 'all', 'half', 'a third', 'a quarter', 'a fifth', 'a sixth', 'a seventh', 'an eighth', 'a ninth', 'a tenth']
const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']
/** "a sixth", "one in fourteen", "a few in a hundred" for a share lost. */
export function shareWords(f: number): string {
  if (!(f > 0)) return 'few'
  if (f >= 0.62) return 'most'
  if (f >= 0.42) return 'half'
  const n = Math.round(1 / f)
  if (n <= 10) return ORDINALS[n]
  if (n <= 20) return `one in ${NUMBER_WORDS[n]}`
  return 'a few in a hundred'
}

/** "one in three of the sick die" for a disease's case fatality. */
export function mortalityWords(d: DiseaseInfo): string {
  if (d.kind === DiseaseKind.Fever || d.placeBound) return 'a slow burden on those who live there, deadliest to newcomers'
  const m = d.mortality
  if (m >= 0.42) return 'about half of the sick die'
  const n = Math.round(1 / Math.max(0.01, m))
  return n > 20 ? 'few of the sick die' : `one in ${NUMBER_WORDS[n]} of the sick die`
}

/** A people's fever tolerance (0..1) in words. */
export function toleranceWords(t: number): string {
  if (t < 0.08) return 'no defence against the fever'
  if (t < 0.28) return 'little used to the fever'
  if (t < 0.52) return 'partly hardened to the fever'
  return 'long hardened to the fever'
}

/** A cell's fever (0..255) in words, or '' below fever ground. */
export function feverWords(v: number): string {
  if (v < 64) return ''
  if (v < 120) return 'light fever ground'
  if (v < 185) return 'fever ground'
  return 'deadly fever ground'
}

/** "the great bunewu" or "the bunewu" for epidemic e. */
export function epidemicNoun(dd: DiseaseData, e: number): string {
  const x = dd.epidemics[e]
  const n = (dd.diseases[x?.disease]?.name ?? '') || 'sickness'
  return x?.great ? `the great ${n}` : `the ${n}`
}

/** "The great bunewu of 1794". */
export function epidemicTitle(dd: DiseaseData, e: number): string {
  const s = epidemicNoun(dd, e)
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} of ${dd.epidemics[e]?.startYear ?? ''}`
}

export const diseaseNameOf = (dd: DiseaseData, d: number) => dd.diseases[d]?.name || 'a sickness'

// ---------------------------------------------------------------------------
// queries (all cheap functions of the year)

/** Number of entries of the ascending years[lo..hi) that are <= y. */
function upTo(years: Float64Array, y: number, lo = 0, hi = years.length): number {
  let a = lo, b = hi
  while (a < b) {
    const m = (a + b) >>> 1
    if (years[m] <= y) a = m + 1
    else b = m
  }
  return a - lo
}

/** Outbreak rows struck by the year (the first rowsUpTo rows). */
export function rowsUpTo(dd: DiseaseData, year: number): number {
  return upTo(dd.rowYear, Math.floor(year + 1e-6))
}

/** The row that has settlement id sick at the year (the latest struck), or -1. */
export function sickRow(dd: DiseaseData, id: number, year: number): number {
  if (id < 0 || id >= dd.N) return -1
  const y = Math.floor(year + 1e-6)
  for (let k = dd.sOff[id + 1] - 1; k >= dd.sOff[id]; k--) {
    const i = dd.sList[k]
    if (dd.rowYear[i] > y) continue
    if (y < dd.rowEnd[i]) return i
    if (dd.rowYear[i] + dd.maxDuration <= y) break
  }
  return -1
}

/** Rows of settlement id struck by the year, newest first. */
export function rowsOfSettlement(dd: DiseaseData, id: number, year: number): number[] {
  const out: number[] = []
  if (id < 0 || id >= dd.N) return out
  const y = Math.floor(year + 1e-6)
  for (let k = dd.sOff[id + 1] - 1; k >= dd.sOff[id]; k--) if (dd.rowYear[dd.sList[k]] <= y) out.push(dd.sList[k])
  return out
}

/** Settlement ids sick at the year (into out). */
export function sickAt(dd: DiseaseData, year: number, out: number[]): number[] {
  out.length = 0
  const y = Math.floor(year + 1e-6)
  const n = upTo(dd.rowYear, y)
  for (let i = n - 1; i >= 0; i--) {
    if (dd.rowYear[i] + dd.maxDuration <= y) break
    if (y < dd.rowEnd[i]) out.push(dd.O.settlement[i])
  }
  return out
}

/** Epidemics going on at the year (begun and not yet over), oldest first. */
export function activeEpidemics(dd: DiseaseData, year: number): number[] {
  const y = Math.floor(year + 1e-6)
  const out: number[] = []
  for (let e = 0; e < dd.E; e++) {
    const x = dd.epidemics[e]
    if (x.startYear <= y && y <= dd.epiEnd[e] && dd.eOff[e + 1] > dd.eOff[e]) out.push(e)
  }
  return out
}

/** How far epidemic e has got by the year: places struck, deaths, peoples reached, places sick now. */
export function epidemicExtent(dd: DiseaseData, e: number, year: number): { places: number; deaths: number; peoples: number; sick: number } {
  const y = Math.floor(year + 1e-6)
  const lo = dd.eOff[e], hi = dd.eOff[e + 1]
  const n = upTo(dd.eYear, y, lo, hi)
  const people = new Set<number>()
  let sick = 0
  for (let k = lo; k < lo + n; k++) {
    const i = dd.eList[k]
    const id = dd.O.settlement[i]
    if (id >= 0 && id < dd.N) people.add(dd.history.settlements[id].people)
    if (y < dd.rowEnd[i]) sick++
  }
  return { places: n, deaths: n > 0 ? dd.eCum[lo + n - 1] : 0, peoples: people.size, sick }
}

/** Snapshot index of a year. */
export function snapOf(dd: DiseaseData, year: number): number {
  const h = dd.history
  return Math.max(0, Math.min(h.snapshotCount - 1, Math.floor(year / h.snapshotInterval + 1e-6)))
}

/** Diseases endemic among people p at snapshot s (ids). */
export function endemicAt(dd: DiseaseData, p: number, s: number): number[] {
  if (!dd.endemic || p < 0 || p >= dd.P) return []
  const bits = dd.endemic[s * dd.P + p]
  const out: number[] = []
  for (let d = 0; d < dd.D && d < 8; d++) if (bits & (1 << d)) out.push(d)
  return out
}

/** Fever tolerance of people p at snapshot s, 0..1 (0 without the data). */
export function toleranceAt(dd: DiseaseData, p: number, s: number): number {
  if (!dd.tolerance || p < 0 || p >= dd.P) return 0
  return dd.tolerance[s * dd.P + p] / 255
}

/** Ports holding ships in quarantine at the year. */
export function quarantinedAt(dd: DiseaseData, year: number): number[] {
  const out: number[] = []
  const Q = dd.Q
  if (!Q) return out
  const y = Math.floor(year + 1e-6)
  for (let i = 0; i < Q.count; i++) if (Q.from[i] <= y && (Q.to[i] < 0 || y < Q.to[i])) out.push(Q.settlement[i])
  return out
}

/** Quarantine spells of settlement id begun by the year ([from, to] with to -1 still in force). */
export function quarantinesOf(dd: DiseaseData, id: number, year: number): { from: number; to: number }[] {
  const Q = dd.Q
  const rows = dd.qOf.get(id)
  if (!Q || !rows) return []
  return rows.filter((i) => Q.from[i] <= year).map((i) => ({ from: Q.from[i], to: Q.to[i] >= 0 && Q.to[i] <= year ? Q.to[i] : -1 }))
}

/** People of the peoples reached by great epidemic e lost, per people (deaths over the people's population when first reached). */
export function peopleLosses(dd: DiseaseData, p: number): { epi: number; share: number; deaths: number }[] {
  const got = dd.peopleLoss.get(p)
  if (got) return got
  const h = dd.history
  const out: { epi: number; share: number; deaths: number }[] = []
  for (const e of dd.great) {
    const x = dd.epidemics[e]
    if (!x.peoples.includes(p)) continue
    let deaths = 0
    let first = -1
    for (let k = dd.eOff[e]; k < dd.eOff[e + 1]; k++) {
      const i = dd.eList[k]
      const id = dd.O.settlement[i]
      if (id < 0 || id >= dd.N || h.settlements[id].people !== p) continue
      deaths += dd.rowDeaths[i]
      if (first < 0) first = dd.O.year[i]
    }
    if (first < 0) continue
    const s = snapOf(dd, first)
    let pop = 0
    for (let id = 0; id < dd.N; id++) if (h.settlements[id].people === p) pop += h.population[s * dd.N + id]
    out.push({ epi: e, deaths, share: pop > 0 ? Math.min(1, deaths / pop) : 0 })
  }
  dd.peopleLoss.set(p, out)
  return out
}

/** Name of the people of settlement id, or ''. */
export function peopleOfSettlement(dd: DiseaseData, id: number): string {
  const p = id >= 0 && id < dd.N ? dd.history.settlements[id].people : -1
  return p >= 0 ? peopleName(dd.history, p) ?? '' : ''
}

export const sname = (dd: DiseaseData, id: number) => (id >= 0 && id < dd.N ? settlementName(dd.history, id) : 'a far place')
