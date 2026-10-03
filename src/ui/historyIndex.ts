// Precomputed lookups over a History so that everything the UI shows at a given
// year is a cheap function of that year (binary searches and array reads), with no
// state accumulated during playback. That is what makes scrubbing backwards exact.

import { CITY_POPULATION, EventType, JourneyKind, TOWN_POPULATION, type History, type Journeys, type Settlement, type Structure } from '../contract.ts'

/** Kind of a chronicle entry. */
export const EntryKind = {
  /** One event. */
  Single: 0,
  /** Famines in many settlements in one year; the representative is the worst. */
  FamineBurst: 1,
  /** Foundings in one decade; the representative is the largest founding party. */
  Foundings: 2,
} as const
export type EntryKind = (typeof EntryKind)[keyof typeof EntryKind]

export interface HistoryIndex {
  history: History
  /** Number of settlements (row length of population/food). */
  count: number
  /** Living settlements per snapshot. */
  aliveCount: Uint32Array
  /** Total population per snapshot. */
  totalPopulation: Float64Array
  /** Largest population any settlement reaches (for size and light scaling). */
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
  return type >= EventType.Founded && type <= EventType.StructureLost
}

/** Whether `other` of an event of this type is a settlement id. */
function otherIsSettlement(type: number): boolean {
  return type === EventType.Founded || type === EventType.Migration
}

export function buildHistoryIndex(h: History): HistoryIndex {
  const N = h.settlements.length
  const S = h.snapshotCount
  const aliveCount = new Uint32Array(S)
  const totalPopulation = new Float64Array(S)
  let maxPopulation = 0
  for (let s = 0; s < S; s++) {
    let alive = 0, total = 0
    const base = s * N
    for (let i = 0; i < N; i++) {
      const p = h.population[base + i]
      if (p > 0) {
        alive++
        total += p
        if (p > maxPopulation) maxPopulation = p
      }
    }
    aliveCount[s] = alive
    totalPopulation[s] = total
  }

  const E = h.events.length
  const order = Int32Array.from({ length: E }, (_, i) => i)
  let sorted = true
  for (let i = 1; i < E; i++) if (h.events[i].year < h.events[i - 1].year) sorted = false
  if (!sorted) order.sort((a, b) => h.events[a].year - h.events[b].year || a - b)
  const orderYear = Float64Array.from(order, (i) => h.events[i].year)

  // Migrations are frequent; the chronicle only shows the largest tenth of them.
  const migrations: number[] = []
  for (const e of h.events) if (e.type === EventType.Migration) migrations.push(e.value)
  migrations.sort((a, b) => a - b)
  const migrationThreshold = migrations.length ? Math.max(100, migrations[Math.floor(migrations.length * 0.9)]) : Infinity
  // A regional drought starves many settlements in the same year: one entry for the burst.
  const faminesPerYear = new Map<number, number>()
  for (const e of h.events) if (e.type === EventType.Famine) faminesPerYear.set(e.year, (faminesPerYear.get(e.year) ?? 0) + 1)
  // Expansion founds a settlement every year or so: one entry per decade that saw several.
  const bucketOf = (year: number) => Math.floor(year / FOUNDING_BUCKET_YEARS)
  const isColony = (type: number, other: number) => type === EventType.Founded && other >= 0
  const foundingsPerBucket = new Map<number, number>()
  for (const e of h.events) if (isColony(e.type, e.other)) foundingsPerBucket.set(bucketOf(e.year), (foundingsPerBucket.get(bucketOf(e.year)) ?? 0) + 1)
  const entries: { kind: EntryKind; members: number[] }[] = []
  const famineEntry = new Map<number, number>()
  const foundingEntry = new Map<number, number>()
  const join = (map: Map<number, number>, key: number, kind: EntryKind, i: number) => {
    const at = map.get(key)
    if (at === undefined) {
      map.set(key, entries.length)
      entries.push({ kind, members: [i] })
    } else entries[at].members.push(i)
  }
  for (const i of order) {
    const e = h.events[i]
    if (!isShownType(e.type)) continue
    if (e.type === EventType.Migration && e.value < migrationThreshold) continue
    if (e.type === EventType.Famine && (faminesPerYear.get(e.year) ?? 0) >= FAMINE_BURST) join(famineEntry, e.year, EntryKind.FamineBurst, i)
    else if (isColony(e.type, e.other) && (foundingsPerBucket.get(bucketOf(e.year)) ?? 0) >= 2) join(foundingEntry, bucketOf(e.year), EntryKind.Foundings, i)
    else entries.push({ kind: EntryKind.Single, members: [i] })
  }
  const notableKind = Uint8Array.from(entries, (en) => en.kind)
  const notableYear = Float64Array.from(entries, (en) => h.events[en.members[0]].year)
  const notableOffsets = new Uint32Array(entries.length + 1)
  for (let k = 0; k < entries.length; k++) notableOffsets[k + 1] = notableOffsets[k] + entries[k].members.length
  const notableMembers = new Int32Array(notableOffsets[entries.length])
  entries.forEach((en, k) => notableMembers.set(en.members, notableOffsets[k]))
  const notableMemberYear = Float64Array.from(notableMembers, (i) => h.events[i].year)
  const memberYearsSorted = Float64Array.from(notableMemberYear).sort()

  // per-settlement event lists
  const counts = new Uint32Array(N + 1)
  const involves = (sid: number) => sid >= 0 && sid < N
  for (const i of order) {
    const e = h.events[i]
    if (!isShownType(e.type)) continue
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
    if (involves(e.settlement)) eventList[cursor[e.settlement]++] = i
    if (otherIsSettlement(e.type) && involves(e.other) && e.other !== e.settlement) eventList[cursor[e.other]++] = i
  }
  const eventListYear = Float64Array.from(eventList, (i) => h.events[i].year)

  // children per settlement (ids are in founding order, so each list is chronological)
  const childOffsets = new Uint32Array(N + 1)
  for (const s of h.settlements) if (s.parent >= 0 && s.parent < N) childOffsets[s.parent + 1]++
  for (let i = 0; i < N; i++) childOffsets[i + 1] += childOffsets[i]
  const childCursor = childOffsets.slice(0, N)
  const childList = new Int32Array(childOffsets[N])
  for (const s of h.settlements) if (s.parent >= 0 && s.parent < N) childList[childCursor[s.parent]++] = s.id
  const childYear = Float64Array.from(childList, (id) => h.settlements[id].foundedYear)

  // journeys arrive with the sim; a history without them simply has none
  const J = (h as Partial<History>).journeys
  const journeys = J && J.count > 0 ? J : null
  const foundingJourney = new Int32Array(N).fill(-1)
  if (journeys) {
    for (let j = 0; j < journeys.count; j++) {
      const to = journeys.to[j]
      if (journeys.kind[j] === JourneyKind.Settlers && to >= 0 && to < N) foundingJourney[to] = j
    }
  }

  // size tiers per snapshot
  const townCount = new Uint32Array(S)
  const cityCount = new Uint32Array(S)
  for (let s = 0; s < S; s++) {
    let towns = 0, cities = 0
    const base = s * N
    for (let i = 0; i < N; i++) {
      const p = h.population[base + i]
      if (p >= CITY_POPULATION) cities++
      else if (p >= TOWN_POPULATION) towns++
    }
    townCount[s] = towns
    cityCount[s] = cities
  }

  // structures per settlement (ids are in building order)
  const structures = structuresOf(h)
  const structureOffsets = new Uint32Array(N + 1)
  for (const st of structures) if (st.settlement >= 0 && st.settlement < N) structureOffsets[st.settlement + 1]++
  for (let i = 0; i < N; i++) structureOffsets[i + 1] += structureOffsets[i]
  const stCursor = structureOffsets.slice(0, N)
  const structureList = new Int32Array(structureOffsets[N])
  for (const st of structures) if (st.settlement >= 0 && st.settlement < N) structureList[stCursor[st.settlement]++] = st.id

  return {
    history: h,
    count: N,
    aliveCount,
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
