// Precomputed lookups over a History so that everything the UI shows at a given
// year is a cheap function of that year (binary searches and array reads), with no
// state accumulated during playback. That is what makes scrubbing backwards exact.

import { CITY_POPULATION, EventType, FeatureKind, JourneyKind, TOWN_POPULATION, type GeoFeature, type History, type Journeys, type Settlement, type Structure, type TradeRoutes } from '../contract.ts'
import { LAST_SHOWN_EVENT, PeoplesEvent } from './format.ts'
import type { PeoplesData } from './peoplesData.ts'
import type { SpeciesData } from './speciesData.ts'
import type { ExpeditionData } from './expeditionsData.ts'
import { goodsGroupKey, goodsOtherIsSettlement, isGoodsEvent } from './goodsFormat.ts'
import { diseaseGroupKey, diseaseOtherIsSettlement, isDiseaseEvent } from './diseaseFormat.ts'
import { isTourismEvent, tourismGroupKey, tourismOtherIsSettlement } from './tourismFormat.ts'
import { isRenamingEvent, renamingHiddenInChronicle } from './renamingFormat.ts'
import { isFaithGroupKey, isRulersOrFaithEvent, rulersDropped, rulersGroupKey, rulersHiddenInList, rulersOtherIsSettlement } from './rulersFormat.ts'
import { allianceGroupPolity, blockadeGroupPolity, bondGroupPolity, gainKey, isCapitalFirstWalls, isMinorGain, isWallBuilt, revoltPolity, vassalSaidByPeace, wallGroupPolity } from './polityFormat.ts'

/** Kind of a chronicle entry. */
export const EntryKind = {
  /** One event. */
  Single: 0,
  /** Famines in many settlements in one year; the representative is the worst. */
  FamineBurst: 1,
  /** Foundings in one decade; the representative is the largest founding party. */
  Foundings: 2,
  /** Large migrations in one decade; the representative is the largest group. */
  Migrations: 3,
  /** Trade routes opened in one decade; the representative joins the largest pair of settlements. */
  TradeOpenings: 4,
  /** Trade routes closed in one decade. */
  TradeClosings: 5,
  /** Major features named by one settlement in one year; members are -(feature id + 1). */
  Named: 6,
  /** Events of one exploration or technology type (BURST_TYPES) in one decade; the representative is the largest. */
  Burst: 7,
  /** Landfalls on small islands (under SMALL_ISLAND_CELLS) in one century (ISLAND_BUCKET_YEARS); landfalls on larger land stay single entries. */
  Landfalls: 8,
  /** polities: minor gains (towns joining, settlements taken that are not capitals) of one polity from one other in one decade (polityFormat.ts gainKey). */
  PolityGains: 9,
  /** polities: raids on towns in one decade. */
  Raids: 10,
  /** polities: the small raids of one decade (History.raids); members are -(RAID_MEMBER_BASE + summary row). */
  SmallRaids: 11,
  /** polities: revolts against one polity, and their crushing, in one decade. */
  Revolts: 12,
  /** polities (second version): vassal and tribute bonds made or thrown off with one overlord in one decade. */
  Bonds: 13,
  /** polities (second version): alliances against one rival in one decade. */
  Alliances: 14,
  /** polities (second version): one polity's blockades in one decade. */
  Blockades: 15,
  /** polities (second version): forts built in one decade (anywhere). */
  Forts: 16,
  /** polities: walls built by one polity's towns in one decade (a capital's first ring is never grouped: it stays a line of its own). */
  Walls: 17,
  /** goods: deposit finds per decade, bypassed towns and lost fleets per leg and decade, posts per owner and decade (goodsFormat.ts goodsGroupKey). */
  Goods: 18,
  /** disease: cities struck per epidemic, armies struck per war, ports in quarantine per decade, sicknesses become endemic per disease and decade (diseaseFormat.ts diseaseGroupKey). */
  Disease: 19,
  /** tourism: places coming into and falling out of fashion per century, sights recognised per decade (tourismFormat.ts tourismGroupKey). */
  Tourism: 20,
  /** rulers: one state's successions per quarter-century, a contested succession's events, a war of succession (rulersFormat.ts rulersGroupKey; numbered apart from the others). */
  Rulers: 40,
  /** religion: one state's conversion and state religion, a faith reaching peoples per half-century, a holy war (rulersFormat.ts). */
  Faiths: 41,
} as const

/** Event types gathered per decade into one Burst entry when a decade has two or more (voyages lost, expeditions out and home, technology advances); first contacts, landfalls and discoveries are always single entries. */
const BURST_TYPES: readonly number[] = [PeoplesEvent.VoyageLost, PeoplesEvent.ExpeditionSent, PeoplesEvent.ExpeditionReturned, PeoplesEvent.TechAdvance]
export type EntryKind = (typeof EntryKind)[keyof typeof EntryKind]

export interface HistoryIndex {
  history: History
  /** Number of settlements (row length of population/food). */
  count: number
  /** Living settlements per snapshot (expedition bases are not settlements: see outpostCount). */
  aliveCount: Uint32Array
  /** Living expedition bases (Settlement.outpost) per snapshot. */
  outpostCount: Uint32Array
  /** 1 for an expedition base, per settlement. */
  isOutpost: Uint8Array
  /** Total population per snapshot. */
  totalPopulation: Float64Array
  /** Largest population any settlement reaches in the first NORM_YEARS (for size and light scaling; later peaks saturate). */
  maxPopulation: number
  /** log(1 + maxPopulation / POP_LOG_BASE), the normaliser for log-scaled sizes. */
  logMax: number
  /** Event indices in chronological order (stable), and their years. */
  order: Int32Array
  orderYear: Float64Array
  /**
   * Chronicle entries in order of their first event: the entry kind, the year of its
   * first event, and its member events as CSR (notableMembers[notableOffsets[k] ..
   * notableOffsets[k + 1]), chronological, with their years). An aggregated entry only
   * counts the members up to the current year, so it grows during playback and shrinks
   * when scrubbing back.
   */
  notableKind: Uint8Array
  notableYear: Float64Array
  notableOffsets: Uint32Array
  notableMembers: Int32Array
  notableMemberYear: Float64Array
  /** Years of all members of all entries, sorted: the chronicle changes when this count does. */
  memberYearsSorted: Float64Array
  /** CSR over settlements: events involving settlement i (as subject or `other`), chronological. */
  eventOffsets: Uint32Array
  eventList: Int32Array
  eventListYear: Float64Array
  /** CSR over settlements: settlements founded from settlement i, in founding order, with their founding years. */
  childOffsets: Uint32Array
  childList: Int32Array
  childYear: Float64Array
  /** The history's journeys, or null when it has none. */
  journeys: Journeys | null
  /** Per settlement, the journey of the settlers who founded it, or -1. */
  foundingJourney: Int32Array
  /** Towns and cities (by population tier) per snapshot. */
  townCount: Uint32Array
  cityCount: Uint32Array
  /** The history's structures (empty when it has none). */
  structures: Structure[]
  /** CSR over settlements: ids of the structures settlement i built, in building order. */
  structureOffsets: Uint32Array
  structureList: Int32Array
  /** Land-use snapshots, or null when the history has none (or they do not fit the grid). */
  land: LandData | null
  /** Trade routes and their volumes, or null when the history has none. */
  trade: TradeData | null
  /** Road levels per land snapshot, or null when the history has none. */
  roads: RoadData | null
  /** Wealth per snapshot per settlement (layout of `population`), or null. */
  wealth: Float32Array | null
  /** Largest wealth of any settlement per snapshot (0 without wealth). */
  wealthMax: Float32Array
  /** Peoples, knowledge and contact (peoplesData.ts; set by the history view), or null when the history has none. */
  peoples: PeoplesData | null
  /** Species, crops and herds (speciesData.ts; set by the history view), or null when the history has none. */
  species: SpeciesData | null
  /** Expedition bases, lost expeditions and discoveries (expeditionsData.ts; set by the history view). */
  expeditions: ExpeditionData | null
}

export interface TradeData {
  routes: TradeRoutes
  /** Years between trade snapshots, and their number. */
  interval: number
  count: number
  /** Loads per year per trade snapshot per route, row-major. */
  volume: Float32Array
  /** CSR over settlements: routes with settlement i at one end, in route order. */
  routeOffsets: Uint32Array
  routeList: Int32Array
  /** Routes open (volume > 0) per trade snapshot. */
  openCount: Uint32Array
  /** 1 where a route crosses water somewhere. */
  bySea: Uint8Array
}

export interface RoadData {
  road: Uint8Array
  interval: number
  count: number
}

export interface LandData {
  /** Cells per snapshot row. */
  cellCount: number
  interval: number
  count: number
  landUse: Uint8Array
  degradation: Uint8Array
}

/** Settlement size tier by population. */
export const Tier = { Village: 0, Town: 1, City: 2 } as const
export type Tier = (typeof Tier)[keyof typeof Tier]

export function tierOf(pop: number): Tier {
  return pop >= CITY_POPULATION ? Tier.City : pop >= TOWN_POPULATION ? Tier.Town : Tier.Village
}

export const TIER_NAMES: Record<Tier, string> = { [Tier.Village]: 'Village', [Tier.Town]: 'Town', [Tier.City]: 'City' }

/** Structures of a history, tolerating histories from before they existed. */
export function structuresOf(h: History): Structure[] {
  const s = (h as Partial<History>).structures
  return Array.isArray(s) ? s : []
}

/** Whether structure `st` stands in `year`. */
export function structureStands(st: Structure, year: number): boolean {
  return year >= st.builtYear && (st.lostYear < 0 || year < st.lostYear)
}

/** The history's land snapshots when present and consistent with its per-cell arrays, else null. */
export function landDataOf(h: History): LandData | null {
  const p = h as Partial<History>
  const N = h.capacity?.length ?? 0
  const count = p.landSnapshotCount ?? 0
  const interval = p.landInterval ?? 0
  const u = p.landUse, d = p.degradation
  if (!(u instanceof Uint8Array) || !(d instanceof Uint8Array) || N <= 0 || count <= 0 || !(interval > 0)) return null
  if (u.length < count * N || d.length < count * N) return null
  return { cellCount: N, interval, count, landUse: u, degradation: d }
}

/** The history's trade routes when present and self-consistent, else null. */
export function tradeDataOf(h: History, settlementCount: number, isWater?: (cell: number) => boolean): TradeData | null {
  const p = h as Partial<History>
  const T = p.trade
  const count = p.tradeSnapshotCount ?? 0
  const interval = p.tradeInterval ?? 0
  const volume = p.tradeVolume
  if (!T || !(T.count > 0) || !(volume instanceof Float32Array) || count <= 0 || !(interval > 0)) return null
  const R = T.count
  if (volume.length < count * R) return null
  for (const a of [T.a, T.b, T.openedYear, T.goodAB, T.goodBA]) if (!a || a.length < R) return null
  if (!T.pathOffsets || T.pathOffsets.length < R + 1 || !T.path || T.path.length < T.pathOffsets[R]) return null
  const N = settlementCount
  const routeOffsets = new Uint32Array(N + 1)
  const ok = (id: number) => id >= 0 && id < N
  for (let r = 0; r < R; r++) {
    if (ok(T.a[r])) routeOffsets[T.a[r] + 1]++
    if (ok(T.b[r]) && T.b[r] !== T.a[r]) routeOffsets[T.b[r] + 1]++
  }
  for (let i = 0; i < N; i++) routeOffsets[i + 1] += routeOffsets[i]
  const cursor = routeOffsets.slice(0, N)
  const routeList = new Int32Array(routeOffsets[N])
  for (let r = 0; r < R; r++) {
    if (ok(T.a[r])) routeList[cursor[T.a[r]]++] = r
    if (ok(T.b[r]) && T.b[r] !== T.a[r]) routeList[cursor[T.b[r]]++] = r
  }
  const openCount = new Uint32Array(count)
  for (let s = 0; s < count; s++) {
    let n = 0
    for (let r = 0; r < R; r++) if (volume[s * R + r] > 0) n++
    openCount[s] = n
  }
  const bySea = new Uint8Array(R)
  // without the world, water is where nobody can live (capacity 0)
  const water = isWater ?? ((c: number) => (h.capacity[c] ?? 1) <= 0)
  for (let r = 0; r < R; r++) {
    for (let k = T.pathOffsets[r] + 1; k + 1 < T.pathOffsets[r + 1]; k++) {
      if (water(T.path[k])) {
        bySea[r] = 1
        break
      }
    }
  }
  return { routes: T, interval, count, volume, routeOffsets, routeList, openCount, bySea }
}

/** The history's road rows when present and consistent with its land snapshots, else null. */
export function roadDataOf(h: History): RoadData | null {
  const p = h as Partial<History>
  const N = h.capacity?.length ?? 0
  const count = p.landSnapshotCount ?? 0
  const interval = p.landInterval ?? 0
  const road = p.road
  if (!(road instanceof Uint8Array) || N <= 0 || count <= 0 || !(interval > 0) || road.length < count * N) return null
  return { road, interval, count }
}

/** Largest number of migrant threads drawn at once, and how long one counts as drawn after arrival (years). */
const MIGRANT_THREADS = 36
const MIGRANT_THREAD_YEARS = 60
/** Migrant groups smaller than this are not drawn. */
const MIGRANT_MIN_SIZE = 20

/**
 * Histories grow in chunks of this many years (see historyView.ts). Whatever is chosen per
 * chunk of years, in order, is the same in a longer run of the same world (a shorter run
 * reproduces the start of a longer one), so a history and its extension agree on the past.
 */
export const HISTORY_CHUNK_YEARS = 500
/**
 * Scales that depend on the whole run (largest population, busiest route, largest
 * travelling group) are taken over the first NORM_YEARS years only, so extending the
 * history past them does not rescale (and so change) what was already shown. Later
 * peaks saturate the scale instead.
 */
export const NORM_YEARS = 2000

/**
 * The journeys worth drawing: every settler party, and the larger migrant groups, at most
 * MIGRANT_THREADS of them under way or still trailing at any time (largest first). Since
 * migration toward prosperous towns became common, drawing every group turned the map
 * into a hairball. Returns the input when nothing is dropped.
 *
 * Chosen chunk by chunk of HISTORY_CHUNK_YEARS (by arrival year, in order; the largest first
 * within a chunk), so a journey kept in a run stays kept in any longer run of the same world.
 */
function thinJourneys(J: Journeys, years: number): Journeys {
  const n = J.count
  const span = Math.max(1, Math.ceil(years) + MIGRANT_THREAD_YEARS + 2)
  const load = new Uint16Array(span)
  const keep = new Uint8Array(n)
  const chunks: number[][] = []
  for (let j = 0; j < n; j++) {
    if (J.kind[j] === JourneyKind.Army) continue // armies are drawn by the polities layer (render/polities.ts)
    if (J.kind[j] !== JourneyKind.Migrants) keep[j] = 1
    else if (J.size[j] >= MIGRANT_MIN_SIZE) {
      const c = Math.max(0, Math.ceil(J.arriveYear[j] / HISTORY_CHUNK_YEARS) - 1)
      ;(chunks[c] ??= []).push(j)
    }
  }
  for (const migrants of chunks) {
    if (!migrants) continue
    migrants.sort((a, b) => J.size[b] - J.size[a] || a - b)
    for (const j of migrants) {
      const y0 = Math.max(0, Math.floor(J.departYear[j]))
      const y1 = Math.min(span - 1, Math.ceil(J.arriveYear[j] + MIGRANT_THREAD_YEARS))
      let full = false
      for (let y = y0; y <= y1 && !full; y++) if (load[y] >= MIGRANT_THREADS) full = true
      if (full) continue
      for (let y = y0; y <= y1; y++) load[y]++
      keep[j] = 1
    }
  }
  let kept = 0
  for (let j = 0; j < n; j++) kept += keep[j]
  if (kept === n) return J
  const departYear = new Float32Array(kept), arriveYear = new Float32Array(kept), size = new Float32Array(kept)
  const from = new Int32Array(kept), to = new Int32Array(kept), kind = new Uint8Array(kept)
  const pathOffsets = new Uint32Array(kept + 1)
  let cells = 0
  for (let j = 0; j < n; j++) if (keep[j]) cells += J.pathOffsets[j + 1] - J.pathOffsets[j]
  const path = new Uint32Array(cells)
  let k = 0
  for (let j = 0; j < n; j++) {
    if (!keep[j]) continue
    departYear[k] = J.departYear[j]
    arriveYear[k] = J.arriveYear[j]
    size[k] = J.size[j]
    from[k] = J.from[j]
    to[k] = J.to[j]
    kind[k] = J.kind[j]
    const a = J.pathOffsets[j], b = J.pathOffsets[j + 1]
    path.set(J.path.subarray(a, b), pathOffsets[k])
    pathOffsets[k + 1] = pathOffsets[k] + (b - a)
    k++
  }
  return { count: kept, departYear, arriveYear, from, to, size, kind, pathOffsets, path }
}

/** Famines in one year from this many settlements up are one chronicle entry. */
const FAMINE_BURST = 3
/** Foundings (from a parent) are gathered into one chronicle entry per this many years. */
export const FOUNDING_BUCKET_YEARS = 10

/** Population at which log-scaled marker size / light intensity is ~log(2). */
export const POP_LOG_BASE = 20

export function logScaled(pop: number, logMax: number): number {
  if (pop <= 0) return 0
  return Math.min(1, Math.log(1 + pop / POP_LOG_BASE) / logMax)
}

export function isAlive(s: Settlement, year: number): boolean {
  return year >= s.foundedYear && (s.abandonedYear < 0 || year < s.abandonedYear)
}

/** Number of entries in the sorted `years[lo..hi)` that are <= year. */
export function countUpTo(years: Float64Array, year: number, lo = 0, hi = years.length): number {
  let a = lo, b = hi
  while (a < b) {
    const m = (a + b) >>> 1
    if (years[m] <= year) a = m + 1
    else b = m
  }
  return a - lo
}

/** Event types the chronicle and inspector can describe (unknown future types are left out rather than misread). */
function isShownType(type: number): boolean {
  if (isRulersOrFaithEvent(type)) return true // 80-97: rulers and faiths (rulersFormat.ts)
  return (type >= EventType.Founded && type <= LAST_SHOWN_EVENT) || (type >= 20 && type <= 43) || (type >= EventType.TechniqueFound && type <= EventType.Panzootic) || isGoodsEvent(type) || isDiseaseEvent(type) || isTourismEvent(type) || isRenamingEvent(type) // 110 renaming; 20-43: polities (35-43 the second version); 44-49: species, second version; 50-65 goods; 66-72 disease; 100-105 tourism
}

/** Whether `other` of an event of this type is a settlement id. */
function otherIsSettlement(type: number): boolean {
  if (rulersOtherIsSettlement(type)) return true // rulers, religion: the senior realm's capital, the marriage partner's, the parent faith's holy city, ...
  return type === EventType.Founded || type === EventType.Migration || type === EventType.TradeOpened || type === EventType.TradeClosed ||
    type === PeoplesEvent.Landfall || type === PeoplesEvent.FirstContact || type === PeoplesEvent.ExpeditionReturned ||
    type === PeoplesEvent.SpeciesAdopted || type === PeoplesEvent.Epidemic ||
    // species, second version: the people a technique, habit or plague came from, the seller a habit drains wealth to
    type === EventType.TechniqueAdopted || type === EventType.HabitSpreads || type === EventType.Drain || type === EventType.Panzootic ||
    // polities: the conqueror's, old, defending or receiving capital (not the capital of every town that joins)
    type === 21 || type === 22 || type === 24 || type === 25 || type === 30 || type === 32 || type === 33 ||
    // polities, second version: the capital risen against, the absorbed realm's, the overlord's, the ally's, the suppressing and blockading fleets' capital
    type === 35 || type === 37 || type === 38 || type === 39 || type === 42 || type === 43 ||
    // goods: the source, owner, home or far mart of a tradition, secret, lane or post
    goodsOtherIsSettlement(type) ||
    // disease: where a great epidemic or a city's sickness came from, the port's capital, the army's base
    diseaseOtherIsSettlement(type) ||
    // tourism: the place visited, the town a resort drew on, a sight's own settlement
    tourismOtherIsSettlement(type) ||
    // renaming: the capital of the realm behind it, the ruin whose name it took
    isRenamingEvent(type)
}

/** Landfalls on land smaller than this (cells at the default resolution, scaled) are small islands, gathered per ISLAND_BUCKET_YEARS. */
const SMALL_ISLAND_CELLS = 25

/**
 * Island landfalls are gathered per century rather than per FOUNDING_BUCKET_YEARS: they come
 * a few per century, now and then a burst, so finer buckets (a decade, then half a century)
 * still left most of them on lines of their own, one small island after another. Labelled
 * by the century's first year ("the 1600s").
 */
export const ISLAND_BUCKET_YEARS = 100
const islandBucketOf = (year: number) => Math.floor(year / ISLAND_BUCKET_YEARS)

/** Whether naming a feature is worth a chronicle line: continents and oceans, the larger seas, rivers, ranges and so on. */
export function isMajorFeature(f: GeoFeature, cellCount: number): boolean {
  const area = cellCount / 23042 // thresholds are tuned at the default resolution
  switch (f.kind) {
    case FeatureKind.Continent:
    case FeatureKind.Ocean:
      return true
    case FeatureKind.Sea: return f.size >= 90 * area
    case FeatureKind.Island: return f.size >= 25 * area
    case FeatureKind.Lake: return f.size >= 10 * area
    case FeatureKind.River: return f.size >= 14 * Math.sqrt(area)
    case FeatureKind.MountainRange: return f.size >= 50 * area
    case FeatureKind.Desert: return f.size >= 60 * area
    default: return f.size >= 150 * area
  }
}

/** Chronicle entries for named geography: the major features each settlement names, grouped per settlement and year, in year order. */
function namingEntries(h: History): { year: number; members: number[] }[] {
  const fs = (h as Partial<History>).features
  if (!Array.isArray(fs)) return []
  const out: { year: number; members: number[]; by: number }[] = []
  const N = h.capacity?.length ?? 23042
  for (const f of fs) {
    if (!isMajorFeature(f, N)) continue
    const last = out[out.length - 1]
    if (last && last.year === f.namedYear && last.by === f.namedBy) last.members.push(-f.id - 1)
    else out.push({ year: f.namedYear, members: [-f.id - 1], by: f.namedBy })
  }
  out.sort((a, b) => a.year - b.year)
  return out
}

/** Chronicle members standing for rows of History.raids are -(RAID_MEMBER_BASE + row). */
export const RAID_MEMBER_BASE = 1 << 24

/** Year a decade's small raids appear in the chronicle: its last year. */
export function smallRaidYear(h: History, row: number): number {
  return h.raids.decade[row] * 10 + 9
}

/** Chronicle entries for the small raids (History.raids), one per decade with two raids or more, in year order. */
function smallRaidEntries(h: History): { year: number; members: number[] }[] {
  const R = (h as Partial<History>).raids
  if (!R || !(R.count > 0) || !R.decade || !R.raids) return []
  const out: { year: number; members: number[] }[] = []
  let k = 0
  while (k < R.count) {
    const d = R.decade[k]
    const members: number[] = []
    let raids = 0
    for (; k < R.count && R.decade[k] === d; k++) {
      members.push(-(RAID_MEMBER_BASE + k))
      raids += R.raids[k]
    }
    if (raids >= 2) out.push({ year: d * 10 + 9, members })
  }
  out.sort((a, b) => a.year - b.year)
  return out
}

/** Trade openings (or closings) in one decade from this many up are one chronicle entry. */
const TRADE_BURST = 3

/** `isWater` (optional) tells which cells are water, for routes by sea. */
export function buildHistoryIndex(h: History, isWater?: (cell: number) => boolean): HistoryIndex {
  const N = h.settlements.length
  const S = h.snapshotCount
  const aliveCount = new Uint32Array(S)
  const outpostCount = new Uint32Array(S)
  const isOutpost = new Uint8Array(N)
  for (let i = 0; i < N; i++) if ((h.settlements[i] as { outpost?: boolean }).outpost === true) isOutpost[i] = 1
  const totalPopulation = new Float64Array(S)
  let maxPopulation = 0
  // the size scale: over the first NORM_YEARS only (see there)
  const normSnapshots = Math.floor(NORM_YEARS / Math.max(1, h.snapshotInterval)) + 1
  // size tiers per snapshot, in the same pass
  const townCount = new Uint32Array(S)
  const cityCount = new Uint32Array(S)
  for (let s = 0; s < S; s++) {
    let alive = 0, total = 0, peak = 0, towns = 0, cities = 0, bases = 0
    const base = s * N
    for (let i = 0; i < N; i++) {
      const p = h.population[base + i]
      if (p > 0 && isOutpost[i]) bases++
      else if (p > 0) {
        alive++
        total += p
        if (p > peak) peak = p
        if (p >= CITY_POPULATION) cities++
        else if (p >= TOWN_POPULATION) towns++
      }
    }
    if (s < normSnapshots && peak > maxPopulation) maxPopulation = peak
    aliveCount[s] = alive
    outpostCount[s] = bases
    totalPopulation[s] = total
    townCount[s] = towns
    cityCount[s] = cities
  }

  const E = h.events.length
  const order = new Int32Array(E)
  for (let i = 0; i < E; i++) order[i] = i
  let sorted = true
  for (let i = 1; i < E; i++) if (h.events[i].year < h.events[i - 1].year) sorted = false
  if (!sorted) order.sort((a, b) => h.events[a].year - h.events[b].year || a - b)
  const orderYear = new Float64Array(E)
  for (let k = 0; k < E; k++) orderYear[k] = h.events[order[k]].year

  // Migrations are frequent (people move toward prosperous towns); the chronicle only
  // shows the largest few percent of them, gathered per decade.
  // (the threshold from the first NORM_YEARS, so a longer run picks the same ones there)
  const migrations: number[] = []
  for (const e of h.events) if (e.type === EventType.Migration && e.year <= NORM_YEARS) migrations.push(e.value)
  migrations.sort((a, b) => a - b)
  const migrationThreshold = migrations.length ? Math.max(150, migrations[Math.floor(migrations.length * 0.97)]) : Infinity
  // A regional drought starves many settlements in the same year: one entry for the burst.
  const faminesPerYear = new Map<number, number>()
  for (const e of h.events) if (e.type === EventType.Famine) faminesPerYear.set(e.year, (faminesPerYear.get(e.year) ?? 0) + 1)
  // Expansion founds a settlement every year or so: one entry per decade that saw several.
  const bucketOf = (year: number) => Math.floor(year / FOUNDING_BUCKET_YEARS)
  // (an expedition base is not a colony: its founding is a line of its own)
  const isColony = (type: number, other: number, settlement = -1) => type === EventType.Founded && other >= 0 && !(settlement >= 0 && isOutpost[settlement])
  const foundingsPerBucket = new Map<number, number>()
  for (const e of h.events) if (isColony(e.type, e.other, e.settlement)) foundingsPerBucket.set(bucketOf(e.year), (foundingsPerBucket.get(bucketOf(e.year)) ?? 0) + 1)
  // trade routes open by the dozen once trade takes off, migrations too: per decade as well
  const perBucket = (type: number, keep: (value: number) => boolean, bucket: (year: number) => number = bucketOf) => {
    const m = new Map<number, number>()
    for (const e of h.events) if (e.type === type && keep(e.value)) m.set(bucket(e.year), (m.get(bucket(e.year)) ?? 0) + 1)
    return m
  }
  const openingsPerBucket = perBucket(EventType.TradeOpened, () => true)
  const closingsPerBucket = perBucket(EventType.TradeClosed, () => true)
  const migrationsPerBucket = perBucket(EventType.Migration, (v) => v >= migrationThreshold)
  const burstPerBucket = new Map<number, Map<number, number>>(BURST_TYPES.map((t) => [t, perBucket(t, () => true)]))
  const burstEntry = new Map<number, Map<number, number>>(BURST_TYPES.map((t) => [t, new Map<number, number>()]))
  const smallIsland = SMALL_ISLAND_CELLS * ((h.capacity?.length ?? 23042) / 23042)
  const isIslandLandfall = (type: number, value: number) => type === PeoplesEvent.Landfall && value > 0 && value < smallIsland
  const islandLandfallsPerBucket = perBucket(PeoplesEvent.Landfall, (v) => v > 0 && v < smallIsland, islandBucketOf)
  const landfallEntry = new Map<number, number>()
  const entries: { kind: EntryKind; members: number[] }[] = []
  const famineEntry = new Map<number, number>()
  const foundingEntry = new Map<number, number>()
  const openingEntry = new Map<number, number>()
  const closingEntry = new Map<number, number>()
  const migrationEntry = new Map<number, number>()
  const join = (map: Map<number, number>, key: number, kind: EntryKind, i: number) => {
    const at = map.get(key)
    if (at === undefined) {
      map.set(key, entries.length)
      entries.push({ kind, members: [i] })
    } else entries[at].members.push(i)
  }
  // named geography goes in after the events of its year (its namer's founding comes first)
  // polities: minor gains per (gainer, loser, decade) and raids on towns per decade, gathered when two or more
  const gainKeyOf = (e: { year: number }, g: number, l: number) => ((g + 2) * 40000 + (l + 2)) * 1000 + bucketOf(e.year)
  const gainsPerKey = new Map<number, number>()
  const gainKeyOfEvent = new Map<number, number>()
  h.events.forEach((e, i) => {
    if (!isShownType(e.type) || !isMinorGain(h, e)) return
    const [g, l] = gainKey(h, e)
    const k = gainKeyOf(e, g, l)
    gainKeyOfEvent.set(i, k)
    gainsPerKey.set(k, (gainsPerKey.get(k) ?? 0) + 1)
  })
  const gainEntry = new Map<number, number>()
  const revoltKeyOfEvent = new Map<number, number>()
  const revoltsPerKey = new Map<number, number>()
  h.events.forEach((e, i) => {
    if ((e.type as number) !== 30 && (e.type as number) !== 31) return
    const k = (revoltPolity(h, e) + 2) * 1000 + bucketOf(e.year)
    revoltKeyOfEvent.set(i, k)
    revoltsPerKey.set(k, (revoltsPerKey.get(k) ?? 0) + 1)
  })
  const revoltEntry = new Map<number, number>()
  // polities: walls built by one polity's towns, per decade, gathered when two or more (a capital's first ring stays its own line, see isCapitalFirstWalls)
  const wallKeyOfEvent = new Map<number, number>()
  const wallsPerKey = new Map<number, number>()
  h.events.forEach((e, i) => {
    if (!isWallBuilt(h, e) || isCapitalFirstWalls(h, e)) return
    const k = (wallGroupPolity(h, e) + 2) * 1000 + bucketOf(e.year)
    wallKeyOfEvent.set(i, k)
    wallsPerKey.set(k, (wallsPerKey.get(k) ?? 0) + 1)
  })
  const wallEntry = new Map<number, number>()
  // polities, second version: vassal bonds per overlord, alliances per rival, blockades per blockader, per decade, gathered when two or more
  const v2Group = (e: { type: number; year: number }, i: number) => {
    const t = e.type as number
    const ev = h.events[i]
    const g = t === 38 ? bondGroupPolity(ev) : t === 39 ? allianceGroupPolity(ev) : t === 43 ? blockadeGroupPolity(h, ev) : t === 4 ? -1 : -9
    return g === -9 ? -1 : (t * 40000 + g + 2) * 1000 + bucketOf(e.year)
  }
  const isFort = (e: { type: number; other: number }) => (e.type as number) === 4 && h.structures?.[e.other]?.type === 3
  const v2KeyOfEvent = new Map<number, number>()
  const v2PerKey = new Map<number, number>()
  h.events.forEach((e, i) => {
    const t = e.type as number
    if (t !== 38 && t !== 39 && t !== 43 && !isFort(e)) return
    const k = v2Group(e, i)
    v2KeyOfEvent.set(i, k)
    v2PerKey.set(k, (v2PerKey.get(k) ?? 0) + 1)
  })
  const v2Entry = new Map<number, number>()
  // goods: deposit finds per decade, bypassed towns and lost fleets per leg, posts per owner (goodsGroupKey), gathered when two or more
  const goodsKeyOfEvent = new Map<number, number>()
  const goodsPerKey = new Map<number, number>()
  h.events.forEach((e, i) => {
    if (!isGoodsEvent(e.type as number)) return
    const k = goodsGroupKey(e)
    if (k < 0) return
    goodsKeyOfEvent.set(i, k)
    goodsPerKey.set(k, (goodsPerKey.get(k) ?? 0) + 1)
  })
  const goodsEntry = new Map<number, number>()
  // disease: cities struck per epidemic, armies per war, quarantines per decade, endemic sicknesses per disease and decade (diseaseGroupKey), gathered when two or more
  const diseaseKeyOfEvent = new Map<number, number>()
  const diseasePerKey = new Map<number, number>()
  h.events.forEach((e, i) => {
    if (!isDiseaseEvent(e.type as number)) return
    const k = diseaseGroupKey(e)
    if (k < 0) return
    diseaseKeyOfEvent.set(i, k)
    diseasePerKey.set(k, (diseasePerKey.get(k) ?? 0) + 1)
  })
  const diseaseEntry = new Map<number, number>()
  // tourism: fashion per century, sights per decade (tourismGroupKey), gathered when two or more
  const tourismKeyOfEvent = new Map<number, number>()
  const tourismPerKey = new Map<number, number>()
  h.events.forEach((e, i) => {
    if (!isTourismEvent(e.type as number)) return
    const k = tourismGroupKey(e)
    if (k < 0) return
    tourismKeyOfEvent.set(i, k)
    tourismPerKey.set(k, (tourismPerKey.get(k) ?? 0) + 1)
  })
  const tourismEntry = new Map<number, number>()
  // rulers, religion: a succession's events, one state's routine successions, a war with its declaration, ... (rulersGroupKey), gathered when two or more
  const rulersKeyOfEvent = new Map<number, number>()
  const rulersPerKey = new Map<number, number>()
  for (let i = 0; i < h.events.length; i++) {
    const k = rulersGroupKey(h, i)
    if (k < 0) continue
    rulersKeyOfEvent.set(i, k)
    rulersPerKey.set(k, (rulersPerKey.get(k) ?? 0) + 1)
  }
  const rulersEntry = new Map<number, number>()
  const v2Kind = (t: number) => (t === 38 ? EntryKind.Bonds : t === 39 ? EntryKind.Alliances : t === 4 ? EntryKind.Forts : EntryKind.Blockades)
  const raidsPerBucket = perBucket(29, () => true)
  const raidEntry = new Map<number, number>()
  const smallRaids = smallRaidEntries(h)
  let nextSmallRaid = 0
  const namings = namingEntries(h)
  let nextNaming = 0
  for (const i of order) {
    const e = h.events[i]
    while (nextNaming < namings.length && namings[nextNaming].year < e.year) entries.push({ kind: EntryKind.Named, members: namings[nextNaming++].members })
    while (nextSmallRaid < smallRaids.length && smallRaids[nextSmallRaid].year < e.year) entries.push({ kind: EntryKind.SmallRaids, members: smallRaids[nextSmallRaid++].members })
    if (!isShownType(e.type)) continue
    if (rulersDropped(h, i)) continue // rulers: a reign or a house ended with its realm (the realm's end says it)
    if (renamingHiddenInChronicle(h, e)) continue // renaming: a qualified founding name (the inspector says it)
    if (e.type === EventType.Migration && e.value < migrationThreshold) continue
    if ((e.type as number) === 38 && vassalSaidByPeace(h, e)) continue // the peace line already says it (bug: don't say it twice)
    if (e.type === EventType.Famine && (faminesPerYear.get(e.year) ?? 0) >= FAMINE_BURST) join(famineEntry, e.year, EntryKind.FamineBurst, i)
    else if (isColony(e.type, e.other, e.settlement) && (foundingsPerBucket.get(bucketOf(e.year)) ?? 0) >= 2) join(foundingEntry, bucketOf(e.year), EntryKind.Foundings, i)
    else if (e.type === EventType.Migration && (migrationsPerBucket.get(bucketOf(e.year)) ?? 0) >= 2) join(migrationEntry, bucketOf(e.year), EntryKind.Migrations, i)
    else if (e.type === EventType.TradeOpened && (openingsPerBucket.get(bucketOf(e.year)) ?? 0) >= TRADE_BURST) join(openingEntry, bucketOf(e.year), EntryKind.TradeOpenings, i)
    else if (e.type === EventType.TradeClosed && (closingsPerBucket.get(bucketOf(e.year)) ?? 0) >= TRADE_BURST) join(closingEntry, bucketOf(e.year), EntryKind.TradeClosings, i)
    else if ((burstPerBucket.get(e.type)?.get(bucketOf(e.year)) ?? 0) >= 2) join(burstEntry.get(e.type)!, bucketOf(e.year), EntryKind.Burst, i)
    else if (isIslandLandfall(e.type, e.value) && (islandLandfallsPerBucket.get(islandBucketOf(e.year)) ?? 0) >= 2) join(landfallEntry, islandBucketOf(e.year), EntryKind.Landfalls, i)
    else if (gainKeyOfEvent.has(i) && (gainsPerKey.get(gainKeyOfEvent.get(i)!) ?? 0) >= 2) join(gainEntry, gainKeyOfEvent.get(i)!, EntryKind.PolityGains, i)
    else if ((e.type as number) === 29 && (raidsPerBucket.get(bucketOf(e.year)) ?? 0) >= 2) join(raidEntry, bucketOf(e.year), EntryKind.Raids, i)
    else if (revoltKeyOfEvent.has(i) && (revoltsPerKey.get(revoltKeyOfEvent.get(i)!) ?? 0) >= 2) join(revoltEntry, revoltKeyOfEvent.get(i)!, EntryKind.Revolts, i)
    else if (wallKeyOfEvent.has(i) && (wallsPerKey.get(wallKeyOfEvent.get(i)!) ?? 0) >= 2) join(wallEntry, wallKeyOfEvent.get(i)!, EntryKind.Walls, i)
    else if (v2KeyOfEvent.has(i) && (v2PerKey.get(v2KeyOfEvent.get(i)!) ?? 0) >= 2) join(v2Entry, v2KeyOfEvent.get(i)!, v2Kind(e.type as number), i)
    else if (rulersKeyOfEvent.has(i) && (rulersPerKey.get(rulersKeyOfEvent.get(i)!) ?? 0) >= 2) join(rulersEntry, rulersKeyOfEvent.get(i)!, isFaithGroupKey(rulersKeyOfEvent.get(i)!) ? EntryKind.Faiths : EntryKind.Rulers, i)
    else if (goodsKeyOfEvent.has(i) && (goodsPerKey.get(goodsKeyOfEvent.get(i)!) ?? 0) >= 2) join(goodsEntry, goodsKeyOfEvent.get(i)!, EntryKind.Goods, i)
    else if (diseaseKeyOfEvent.has(i) && (diseasePerKey.get(diseaseKeyOfEvent.get(i)!) ?? 0) >= 2) join(diseaseEntry, diseaseKeyOfEvent.get(i)!, EntryKind.Disease, i)
    else if (tourismKeyOfEvent.has(i) && (tourismPerKey.get(tourismKeyOfEvent.get(i)!) ?? 0) >= 2) join(tourismEntry, tourismKeyOfEvent.get(i)!, EntryKind.Tourism, i)
    else entries.push({ kind: EntryKind.Single, members: [i] })
  }
  while (nextNaming < namings.length) entries.push({ kind: EntryKind.Named, members: namings[nextNaming++].members })
  while (nextSmallRaid < smallRaids.length) entries.push({ kind: EntryKind.SmallRaids, members: smallRaids[nextSmallRaid++].members })
  const memberYear = (m: number) => (m >= 0 ? h.events[m].year : m <= -RAID_MEMBER_BASE ? smallRaidYear(h, -m - RAID_MEMBER_BASE) : h.features[-m - 1].namedYear)
  const notableKind = Uint8Array.from(entries, (en) => en.kind)
  const notableYear = Float64Array.from(entries, (en) => memberYear(en.members[0]))
  const notableOffsets = new Uint32Array(entries.length + 1)
  for (let k = 0; k < entries.length; k++) notableOffsets[k + 1] = notableOffsets[k] + entries[k].members.length
  const notableMembers = new Int32Array(notableOffsets[entries.length])
  entries.forEach((en, k) => notableMembers.set(en.members, notableOffsets[k]))
  const notableMemberYear = Float64Array.from(notableMembers, memberYear)
  const memberYearsSorted = Float64Array.from(notableMemberYear).sort()

  // per-settlement event lists
  const counts = new Uint32Array(N + 1)
  const involves = (sid: number) => sid >= 0 && sid < N
  for (const i of order) {
    const e = h.events[i]
    if (!isShownType(e.type)) continue
    if (rulersHiddenInList(h, i)) continue // rulers: the accession line of the same year says it
    if (involves(e.settlement)) counts[e.settlement]++
    if (otherIsSettlement(e.type) && involves(e.other) && e.other !== e.settlement) counts[e.other]++
  }
  const eventOffsets = new Uint32Array(N + 1)
  for (let i = 0; i < N; i++) eventOffsets[i + 1] = eventOffsets[i] + counts[i]
  const cursor = eventOffsets.slice(0, N)
  const eventList = new Int32Array(eventOffsets[N])
  for (const i of order) {
    const e = h.events[i]
    if (!isShownType(e.type)) continue
    if (rulersHiddenInList(h, i)) continue
    if (involves(e.settlement)) eventList[cursor[e.settlement]++] = i
    if (otherIsSettlement(e.type) && involves(e.other) && e.other !== e.settlement) eventList[cursor[e.other]++] = i
  }
  const eventListYear = new Float64Array(eventList.length)
  for (let k = 0; k < eventList.length; k++) eventListYear[k] = h.events[eventList[k]].year

  // children per settlement (ids are in founding order, so each list is chronological)
  const childOffsets = new Uint32Array(N + 1)
  // (expedition bases are not children: the inspector lists them as bases)
  for (const s of h.settlements) if (s.parent >= 0 && s.parent < N && !isOutpost[s.id]) childOffsets[s.parent + 1]++
  for (let i = 0; i < N; i++) childOffsets[i + 1] += childOffsets[i]
  const childCursor = childOffsets.slice(0, N)
  const childList = new Int32Array(childOffsets[N])
  for (const s of h.settlements) if (s.parent >= 0 && s.parent < N && !isOutpost[s.id]) childList[childCursor[s.parent]++] = s.id
  const childYear = Float64Array.from(childList, (id) => h.settlements[id].foundedYear)

  // journeys arrive with the sim; a history without them simply has none
  const J = (h as Partial<History>).journeys
  const journeys = J && J.count > 0 ? thinJourneys(J, h.years) : null
  const foundingJourney = new Int32Array(N).fill(-1)
  if (journeys) {
    for (let j = 0; j < journeys.count; j++) {
      const to = journeys.to[j]
      if (journeys.kind[j] === JourneyKind.Settlers && to >= 0 && to < N) foundingJourney[to] = j
    }
  }

  // structures per settlement (ids are in building order)
  const structures = structuresOf(h)
  const structureOffsets = new Uint32Array(N + 1)
  for (const st of structures) if (st.settlement >= 0 && st.settlement < N) structureOffsets[st.settlement + 1]++
  for (let i = 0; i < N; i++) structureOffsets[i + 1] += structureOffsets[i]
  const stCursor = structureOffsets.slice(0, N)
  const structureList = new Int32Array(structureOffsets[N])
  for (const st of structures) if (st.settlement >= 0 && st.settlement < N) structureList[stCursor[st.settlement]++] = st.id

  // wealth arrives with trade; tolerate histories without it
  const W = (h as Partial<History>).wealth
  const wealth = W instanceof Float32Array && W.length >= S * N ? W : null
  const wealthMax = new Float32Array(S)
  if (wealth) {
    for (let s = 0; s < S; s++) {
      let m = 0
      for (let i = 0; i < N; i++) if (wealth[s * N + i] > m) m = wealth[s * N + i]
      wealthMax[s] = m
    }
  }

  return {
    history: h,
    count: N,
    aliveCount,
    outpostCount,
    isOutpost,
    totalPopulation,
    maxPopulation,
    logMax: Math.log(1 + Math.max(maxPopulation, POP_LOG_BASE) / POP_LOG_BASE),
    order,
    orderYear,
    notableKind,
    notableYear,
    notableOffsets,
    notableMembers,
    notableMemberYear,
    memberYearsSorted,
    eventOffsets,
    eventList,
    eventListYear,
    childOffsets,
    childList,
    childYear,
    journeys,
    foundingJourney,
    townCount,
    cityCount,
    structures,
    structureOffsets,
    structureList,
    land: landDataOf(h),
    trade: tradeDataOf(h, N, isWater),
    roads: roadDataOf(h),
    wealth,
    wealthMax,
    peoples: null,
    species: null,
    expeditions: null,
  }
}

/** Snapshot interpolation at a (fractional) year. Writes into `out` to avoid allocation. */
export interface SnapshotPos {
  s0: number
  s1: number
  frac: number
}

export function snapshotAt(h: History, year: number, out: SnapshotPos): SnapshotPos {
  return bracketAt(h.snapshotCount, h.snapshotInterval, year, out)
}

/** Land snapshot interpolation at a (fractional) year. */
export function landSnapshotAt(land: LandData, year: number, out: SnapshotPos): SnapshotPos {
  return bracketAt(land.count, land.interval, year, out)
}

function bracketAt(count: number, interval: number, year: number, out: SnapshotPos): SnapshotPos {
  const last = count - 1
  const x = Math.min(Math.max(year / interval, 0), last)
  const s0 = Math.min(Math.floor(x), last)
  out.s0 = s0
  out.s1 = Math.min(s0 + 1, last)
  out.frac = out.s1 === s0 ? 0 : x - s0
  return out
}
