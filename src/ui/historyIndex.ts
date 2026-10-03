// Precomputed lookups over a History so that everything the UI shows at a given
// year is a cheap function of that year (binary searches and array reads), with no
// state accumulated during playback. That is what makes scrubbing backwards exact.

import { CITY_POPULATION, EventType, JourneyKind, TOWN_POPULATION, type History, type Journeys, type Settlement, type Structure, type TradeRoutes } from '../contract.ts'

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
  /** Trade routes and their volumes, or null when the history has none. */
  trade: TradeData | null
  /** Road levels per land snapshot, or null when the history has none. */
  roads: RoadData | null
  /** Wealth per snapshot per settlement (layout of `population`), or null. */
  wealth: Float32Array | null
  /** Largest wealth of any settlement per snapshot (0 without wealth). */
  wealthMax: Float32Array
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
 * The journeys worth drawing: every settler party, and the larger migrant groups, at most
 * MIGRANT_THREADS of them under way or still trailing at any time (largest first). Since
 * migration toward prosperous towns became common, drawing every group turned the map
 * into a hairball. Returns the input when nothing is dropped.
 */
function thinJourneys(J: Journeys, years: number): Journeys {
  const n = J.count
  const span = Math.max(1, Math.ceil(years) + MIGRANT_THREAD_YEARS + 2)
  const load = new Uint16Array(span)
  const keep = new Uint8Array(n)
  const migrants: number[] = []
  for (let j = 0; j < n; j++) {
    if (J.kind[j] !== JourneyKind.Migrants) keep[j] = 1
    else if (J.size[j] >= MIGRANT_MIN_SIZE) migrants.push(j)
  }
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
  return type >= EventType.Founded && type <= EventType.TradeClosed
}

/** Whether `other` of an event of this type is a settlement id. */
function otherIsSettlement(type: number): boolean {
  return type === EventType.Founded || type === EventType.Migration || type === EventType.TradeOpened || type === EventType.TradeClosed
}

/** Trade openings (or closings) in one decade from this many up are one chronicle entry. */
const TRADE_BURST = 3

/** `isWater` (optional) tells which cells are water, for routes by sea. */
export function buildHistoryIndex(h: History, isWater?: (cell: number) => boolean): HistoryIndex {
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

  // Migrations are frequent (people move toward prosperous towns); the chronicle only
  // shows the largest few percent of them, gathered per decade.
  const migrations: number[] = []
  for (const e of h.events) if (e.type === EventType.Migration) migrations.push(e.value)
  migrations.sort((a, b) => a - b)
  const migrationThreshold = migrations.length ? Math.max(150, migrations[Math.floor(migrations.length * 0.97)]) : Infinity
  // A regional drought starves many settlements in the same year: one entry for the burst.
  const faminesPerYear = new Map<number, number>()
  for (const e of h.events) if (e.type === EventType.Famine) faminesPerYear.set(e.year, (faminesPerYear.get(e.year) ?? 0) + 1)
  // Expansion founds a settlement every year or so: one entry per decade that saw several.
  const bucketOf = (year: number) => Math.floor(year / FOUNDING_BUCKET_YEARS)
  const isColony = (type: number, other: number) => type === EventType.Founded && other >= 0
  const foundingsPerBucket = new Map<number, number>()
  for (const e of h.events) if (isColony(e.type, e.other)) foundingsPerBucket.set(bucketOf(e.year), (foundingsPerBucket.get(bucketOf(e.year)) ?? 0) + 1)
  // trade routes open by the dozen once trade takes off, migrations too: per decade as well
  const perBucket = (type: number, keep: (value: number) => boolean) => {
    const m = new Map<number, number>()
    for (const e of h.events) if (e.type === type && keep(e.value)) m.set(bucketOf(e.year), (m.get(bucketOf(e.year)) ?? 0) + 1)
    return m
  }
  const openingsPerBucket = perBucket(EventType.TradeOpened, () => true)
  const closingsPerBucket = perBucket(EventType.TradeClosed, () => true)
  const migrationsPerBucket = perBucket(EventType.Migration, (v) => v >= migrationThreshold)
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
  for (const i of order) {
    const e = h.events[i]
    if (!isShownType(e.type)) continue
    if (e.type === EventType.Migration && e.value < migrationThreshold) continue
    if (e.type === EventType.Famine && (faminesPerYear.get(e.year) ?? 0) >= FAMINE_BURST) join(famineEntry, e.year, EntryKind.FamineBurst, i)
    else if (isColony(e.type, e.other) && (foundingsPerBucket.get(bucketOf(e.year)) ?? 0) >= 2) join(foundingEntry, bucketOf(e.year), EntryKind.Foundings, i)
    else if (e.type === EventType.Migration && (migrationsPerBucket.get(bucketOf(e.year)) ?? 0) >= 2) join(migrationEntry, bucketOf(e.year), EntryKind.Migrations, i)
    else if (e.type === EventType.TradeOpened && (openingsPerBucket.get(bucketOf(e.year)) ?? 0) >= TRADE_BURST) join(openingEntry, bucketOf(e.year), EntryKind.TradeOpenings, i)
    else if (e.type === EventType.TradeClosed && (closingsPerBucket.get(bucketOf(e.year)) ?? 0) >= TRADE_BURST) join(closingEntry, bucketOf(e.year), EntryKind.TradeClosings, i)
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
  const journeys = J && J.count > 0 ? thinJourneys(J, h.years) : null
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
