// Polities in the UI: a per-history index over History.polities, History.polity,
// History.territory, History.danger, History.wars, History.raids and the political events
// (EventType 20-34), so that everything the globe, the Polities panel, the inspector and the
// chronicle show about states at a year is a cheap function of that year.
//
//  - Alive polities per snapshot (CSR, ascending id) with their members, population and tier
//    (Chiefdom, Kingdom or Empire, derived as in the contract: Empire at 60k+ people or two
//    peoples each >= 15% with 25+ members; Kingdom at 6+ members and 5k+ people).
//  - Capitals (from capitals / capitalYears), successors (parent links), wars per polity,
//    political events per polity, walls and sacks per settlement, army journeys.
//  - The polity of every cell at (snapshot s, land snapshot q): owner settlement
//    territory[q * L + k] - 1 of land cell landCells[k], and its polity polity[s * S + owner];
//    cached for the last few (s, q) pairs (cellPolities).
//  - A stable colour per polity from its hue, nudged in lightness and saturation away from
//    the earlier polities near it whose hues are close (successors stay near their parent's
//    hue, as the simulation intends).
//
// Every field is optional at runtime: politiesOf(h) is null for a history without polity data
// (the placeholders of a simulation from before polities), and everything built on it hides.
//
// townPolityState() is the small interface the 3D town generator (render/dioramas) can adopt:
// for a settlement and a year, the wall rings in use with their build years, slighted walls,
// how recently it was sacked, whether it is a capital, and a rough garrison size.

import { CITY_POPULATION, EventType, JourneyKind, PolityEnd, StructureType, type History, type HistoryEvent, type Polity, type RaidSummary, type Wars, type World } from '../contract.ts'

export const PolityTier = { Chiefdom: 0, Kingdom: 1, Empire: 2 } as const
export type PolityTier = (typeof PolityTier)[keyof typeof PolityTier]
export const TIER_WORDS: readonly string[] = ['Chiefdom', 'Kingdom', 'Empire']

/** English qualifiers by PolityQualifier. */
const QUALIFIER_WORDS: readonly string[] = ['', 'North', 'South', 'East', 'West', 'New', 'Upper', 'Lower', 'Restored']

/** Cell value for water in cellPolities (unowned land is -1). */
export const WATER = -2

/** Years over which a sack marks a town (scorched ground, ruins), fading. */
export const SACK_YEARS = 40

/** Political event types (20-34). */
export const PolityEvent = {
  Founded: 20, Ended: 21, CapitalMoved: 22, Joined: 23, WarDeclared: 24, PeaceMade: 25, Conquered: 26, Sacked: 27,
  SiegeLifted: 28, Raid: 29, Revolt: 30, RevoltCrushed: 31, Seceded: 32, Defected: 33, SuccessionCrisis: 34,
} as const
export const isPolityEventType = (t: number) => t >= 20 && t <= 34

export interface ArmyData {
  count: number
  /** Indices into History.journeys (kind Army), sorted by arrival. */
  journey: Int32Array
  depart: Float32Array
  arrive: Float32Array
  /** Year from which the march is drawn: its war's start, or a little before it set out. */
  shownFrom: Float32Array
  from: Int32Array
  to: Int32Array
  size: Float32Array
  /** Polity of the staging settlement when it set out (-1 none). */
  polity: Int16Array
  /** Largest army (men), for marker sizes. */
  maxSize: number
}

export interface PolitiesData {
  history: History
  /** Polities, and their short display names with qualifier ("North Vashtar"). */
  count: number
  list: readonly Polity[]
  names: string[]
  /** sRGB 0..1, 3 per polity, and CSS colours (assignPolityColors refines them with the world). */
  rgb: Float32Array
  css: string[]
  settlementCount: number
  snapshotCount: number
  interval: number
  polity: Int16Array
  /** Alive polities per snapshot, ascending id: [aliveOffsets[s], aliveOffsets[s + 1]). */
  aliveOffsets: Uint32Array
  aliveId: Int16Array
  aliveMembers: Uint32Array
  alivePop: Float32Array
  aliveTier: Uint8Array
  /** Largest number alive at once. */
  maxAlive: number
  /** First and last snapshot in which each polity has members (-1 never). */
  firstSnap: Int32Array
  lastSnap: Int32Array
  /** Successor states per polity (ids, in founding order). */
  children: number[][]
  wars: Wars | null
  /** War ids per polity (as attacker or defender), in order of declaration. */
  warsOf: number[][]
  /** Political events (types 20-34, plus walls built / lost) per polity, chronological event indices. */
  eventsOf: number[][]
  /** Land layers, or null when absent or inconsistent. */
  land: { cells: Uint32Array; L: number; count: number; interval: number; territory: Uint16Array; danger: Uint8Array | null } | null
  /** Land index of each cell (-1 water), for cell lookups; null without land layers. */
  landIndexOf: Int32Array | null
  armies: ArmyData | null
  raids: RaidSummary | null
  /** Walls (structure ids) per settlement, oldest first. */
  wallsOf: Map<number, number[]>
  /** Sacks per settlement: [year, fraction lost] pairs, chronological. */
  sacksOf: Map<number, number[]>
  /** Conquests per settlement: years, chronological (for slighted walls). */
  conquestsOf: Map<number, number[]>
  /** Years a settlement changed hands (taken, joined, went over, broke away, founded a state), chronological. */
  changesOf: Map<number, number[]>
  /** Cell-polity cache (see cellPolities). */
  cache: { key: number; cells: Int16Array }[]
  cellCount: number
}

const cache = new WeakMap<History, PolitiesData | null>()

/** The polity index of `h` (built once per history), or null when it has no polity data. */
export function politiesOf(h: History | null | undefined): PolitiesData | null {
  if (!h) return null
  if (cache.has(h)) return cache.get(h) ?? null
  let pd: PolitiesData | null = null
  try {
    pd = buildPolitiesData(h)
  } catch (err) {
    console.warn('polities: data unusable, hidden', err)
    pd = null
  }
  cache.set(h, pd)
  return pd
}

const clampS = (pd: PolitiesData, s: number) => Math.max(0, Math.min(pd.snapshotCount - 1, s))
/** Snapshot just before an event of year y (the state it changed), and the one at or after it. */
export const snapBefore = (pd: PolitiesData, y: number) => clampS(pd, Math.floor((y - 1) / pd.interval))
export const snapAfter = (pd: PolitiesData, y: number) => clampS(pd, Math.ceil(y / pd.interval))
/** Polity of settlement `id` at snapshot s (-1 stateless or not alive). */
export const polityAt = (pd: PolitiesData, id: number, s: number) => (id >= 0 && id < pd.settlementCount ? pd.polity[clampS(pd, s) * pd.settlementCount + id] : -1)

function hsl(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0), f(8), f(4)]
}

function buildPolitiesData(h: History): PolitiesData | null {
  const p = h as Partial<History>
  const list = p.polities
  const N = h.settlements.length
  const S = h.snapshotCount
  if (!Array.isArray(list) || list.length === 0 || !(p.polity instanceof Int16Array) || p.polity.length < S * N) return null
  const P = list.length
  const pol = p.polity
  const names = list.map((x) => (x.qualifier > 0 && QUALIFIER_WORDS[x.qualifier] ? `${QUALIFIER_WORDS[x.qualifier]} ${x.name}` : x.name))
  const rgb = new Float32Array(P * 3)
  const css: string[] = []
  for (let i = 0; i < P; i++) {
    const c = hsl(((list[i].hue % 1) + 1) % 1, 0.62, 0.56)
    rgb.set(c, i * 3)
    css.push(`rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`)
  }

  // ---- alive per snapshot: members, population, tier (one pass over the polity rows) ----
  const isOutpost = new Uint8Array(N)
  for (let i = 0; i < N; i++) if ((h.settlements[i] as { outpost?: boolean }).outpost === true) isOutpost[i] = 1
  const peopleOf = new Int32Array(N)
  for (let i = 0; i < N; i++) peopleOf[i] = Math.max(0, (h.settlements[i] as { people?: number }).people ?? 0)
  const PP = Math.max(1, Array.isArray(p.peoples) ? p.peoples.length : 1)
  const members = new Uint32Array(P), popSum = new Float64Array(P)
  const peoplePop = new Float64Array(P * PP)
  const touched: number[] = []
  const offsets = new Uint32Array(S + 1)
  const ids: number[] = [], mem: number[] = [], pops: number[] = [], tiers: number[] = []
  const firstSnap = new Int32Array(P).fill(-1), lastSnap = new Int32Array(P).fill(-1)
  let maxAlive = 0
  for (let s = 0; s < S; s++) {
    const base = s * N
    for (let i = 0; i < N; i++) {
      const q = pol[base + i]
      if (q < 0 || q >= P) continue
      if (members[q] === 0 && popSum[q] === 0) touched.push(q)
      if (isOutpost[i]) continue
      const pp = h.population[base + i]
      members[q]++
      popSum[q] += pp
      peoplePop[q * PP + Math.min(PP - 1, peopleOf[i])] += pp
    }
    touched.sort((a, b) => a - b)
    for (const q of touched) {
      if (members[q] === 0) {
        popSum[q] = 0
        continue
      }
      let shares = 0
      for (let k = 0; k < PP; k++) {
        if (popSum[q] > 0 && peoplePop[q * PP + k] >= 0.15 * popSum[q]) shares++
        peoplePop[q * PP + k] = 0
      }
      const pop = popSum[q], m = members[q]
      const tier = pop >= 60000 || (shares >= 2 && m >= 25) ? PolityTier.Empire : m >= 6 && pop >= 5000 ? PolityTier.Kingdom : PolityTier.Chiefdom
      ids.push(q)
      mem.push(m)
      pops.push(pop)
      tiers.push(tier)
      if (firstSnap[q] < 0) firstSnap[q] = s
      lastSnap[q] = s
      members[q] = 0
      popSum[q] = 0
    }
    maxAlive = Math.max(maxAlive, ids.length - offsets[s])
    touched.length = 0
    offsets[s + 1] = ids.length
  }

  const children: number[][] = list.map(() => [])
  for (const x of list) if (x.parent >= 0 && x.parent < P && x.parent !== x.id) children[x.parent].push(x.id)

  // ---- wars ----
  const W = p.wars
  const wars = W && W.count > 0 && W.attacker && W.attacker.length >= W.count && W.defender && W.startYear && W.endYear ? W : null
  const warsOf: number[][] = list.map(() => [])
  if (wars) {
    for (let w = 0; w < wars.count; w++) {
      const a = wars.attacker[w], d = wars.defender[w]
      if (a >= 0 && a < P) warsOf[a].push(w)
      if (d >= 0 && d < P && d !== a) warsOf[d].push(w)
    }
  }

  // ---- land layers ----
  const cells = p.landCells
  const Q = p.landSnapshotCount ?? 0
  const LI = p.landInterval ?? 0
  const cellCount = h.capacity?.length ?? 0
  let land: PolitiesData['land'] = null
  let landIndexOf: Int32Array | null = null
  if (cells instanceof Uint32Array && cells.length > 0 && p.territory instanceof Uint16Array && Q > 0 && LI > 0 && p.territory.length >= Q * cells.length) {
    const L = cells.length
    const danger = p.danger instanceof Uint8Array && p.danger.length >= Q * L ? p.danger : null
    land = { cells, L, count: Q, interval: LI, territory: p.territory, danger }
    landIndexOf = new Int32Array(cellCount).fill(-1)
    for (let k = 0; k < L; k++) if (cells[k] < cellCount) landIndexOf[cells[k]] = k
  }

  const pd: PolitiesData = {
    history: h,
    count: P,
    list,
    names,
    rgb,
    css,
    settlementCount: N,
    snapshotCount: S,
    interval: h.snapshotInterval,
    polity: pol,
    aliveOffsets: offsets,
    aliveId: Int16Array.from(ids),
    aliveMembers: Uint32Array.from(mem),
    alivePop: Float32Array.from(pops),
    aliveTier: Uint8Array.from(tiers),
    maxAlive,
    firstSnap,
    lastSnap,
    children,
    wars,
    warsOf,
    eventsOf: list.map(() => []),
    land,
    landIndexOf,
    armies: null,
    raids: p.raids && p.raids.count > 0 ? p.raids : null,
    wallsOf: new Map(),
    sacksOf: new Map(),
    conquestsOf: new Map(),
    changesOf: new Map(),
    cache: [],
    cellCount,
  }

  // ---- political events per polity; sacks and conquests per settlement ----
  const push = (m: Map<number, number[]>, k: number, ...v: number[]) => {
    const a = m.get(k)
    if (a) a.push(...v)
    else m.set(k, v)
  }
  const addTo = (q: number, i: number) => {
    if (q >= 0 && q < P) {
      const a = pd.eventsOf[q]
      if (a[a.length - 1] !== i) a.push(i)
    }
  }
  const order = h.events.map((_, i) => i)
  order.sort((a, b) => h.events[a].year - h.events[b].year || a - b)
  for (const i of order) {
    const e = h.events[i]
    const t = e.type as number
    if (!isPolityEventType(t)) {
      if ((t === EventType.Built || t === EventType.StructureLost) && h.structures?.[e.other]?.type === StructureType.Walls) addTo(polityAt(pd, e.settlement, snapAfter(pd, e.year)), i)
      continue
    }
    for (const q of eventPolities(pd, e)) addTo(q, i)
    if (t === PolityEvent.Sacked) push(pd.sacksOf, e.settlement, e.year, e.value)
    if (t === PolityEvent.Conquered) push(pd.conquestsOf, e.settlement, e.year)
    if (t === PolityEvent.Conquered || t === PolityEvent.Joined || t === PolityEvent.Defected || t === PolityEvent.Seceded || t === PolityEvent.Founded) push(pd.changesOf, e.settlement, e.year)
  }
  for (const a of pd.eventsOf) a.sort((x, y) => h.events[x].year - h.events[y].year || x - y)

  // ---- walls ----
  const sts = Array.isArray(p.structures) ? p.structures : []
  for (const st of sts) if (st.type === StructureType.Walls && st.settlement >= 0 && st.settlement < N) push(pd.wallsOf, st.settlement, st.id)

  // ---- armies ----
  const J = p.journeys
  if (J && J.count > 0 && J.kind) {
    const js: number[] = []
    for (let j = 0; j < J.count; j++) if (J.kind[j] === JourneyKind.Army && J.from[j] >= 0 && J.from[j] < N && J.to[j] >= 0 && J.to[j] < N) js.push(j)
    js.sort((a, b) => J.arriveYear[a] - J.arriveYear[b] || a - b)
    const n = js.length
    if (n > 0) {
      const a: ArmyData = {
        count: n,
        journey: Int32Array.from(js),
        depart: Float32Array.from(js, (j) => J.departYear[j]),
        arrive: Float32Array.from(js, (j) => J.arriveYear[j]),
        shownFrom: new Float32Array(n),
        from: Int32Array.from(js, (j) => J.from[j]),
        to: Int32Array.from(js, (j) => J.to[j]),
        size: Float32Array.from(js, (j) => J.size[j]),
        polity: new Int16Array(n),
        maxSize: 1,
      }
      for (let k = 0; k < n; k++) {
        a.maxSize = Math.max(a.maxSize, a.size[k])
        const q = polityAt(pd, a.from[k], snapBefore(pd, Math.ceil(a.depart[k])))
        a.polity[k] = q
        // drawn from the start of its war (or a little before it set out), not before
        let start = a.depart[k] - 1.5
        if (wars && q >= 0) {
          for (const w of warsOf[q]) {
            const end = wars.endYear[w] < 0 ? Infinity : wars.endYear[w]
            if (wars.startYear[w] <= a.arrive[k] && end + 1 >= a.arrive[k]) start = Math.min(start, wars.startYear[w])
          }
        }
        a.shownFrom[k] = start
      }
      pd.armies = a
    }
  }
  return pd
}

/** Polities an event concerns (for the per-polity event lists). */
export function eventPolities(pd: PolitiesData, e: HistoryEvent): number[] {
  const t = e.type as number
  const b = snapBefore(pd, e.year), a = snapAfter(pd, e.year)
  const W = pd.wars
  const warSides = (w: number) => (W && w >= 0 && w < W.count ? [W.attacker[w], W.defender[w]] : [])
  switch (t) {
    case PolityEvent.Founded:
    case PolityEvent.Ended:
    case PolityEvent.CapitalMoved:
    case PolityEvent.Joined:
    case PolityEvent.SuccessionCrisis:
      return [e.value]
    case PolityEvent.WarDeclared:
    case PolityEvent.PeaceMade:
    case PolityEvent.SiegeLifted:
      return warSides(e.value)
    case PolityEvent.Conquered:
      return [polityAt(pd, e.settlement, b), polityAt(pd, e.settlement, a)]
    case PolityEvent.Sacked:
      return [polityAt(pd, e.settlement, b), polityAt(pd, e.settlement, a), polityAt(pd, e.other, a)]
    case PolityEvent.Raid:
      return [polityAt(pd, e.settlement, b)]
    case PolityEvent.Revolt:
    case PolityEvent.RevoltCrushed:
      return [polityAt(pd, e.other, b)]
    case PolityEvent.Seceded:
      return [e.value, polityAt(pd, e.other, b)]
    case PolityEvent.Defected:
      return [e.value, polityAt(pd, e.settlement, b)]
    default:
      return []
  }
}

/**
 * Polity of settlement `id` at `year`: its polity at the snapshot at or before the year, unless
 * that polity has ended by then (then the one at the next snapshot), so an ended state is not named.
 */
export function polityAtYear(pd: PolitiesData, id: number, year: number): number {
  const s = clampS(pd, Math.floor(year / pd.interval))
  const p = polityAt(pd, id, s)
  if (p >= 0 && !polityLives(pd, p, year)) return polityAt(pd, id, s + 1)
  // it changed hands since the snapshot: the next snapshot has its new polity
  const ch = pd.changesOf.get(id)
  if (ch) for (const y of ch) if (y > s * pd.interval && y <= year) return polityAt(pd, id, s + 1)
  return p
}

/** Index into the alive arrays of polity p at snapshot s, or -1. */
export function statIndex(pd: PolitiesData, p: number, s: number): number {
  s = clampS(pd, s)
  let lo = pd.aliveOffsets[s], hi = pd.aliveOffsets[s + 1]
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (pd.aliveId[m] < p) lo = m + 1
    else hi = m
  }
  return lo < pd.aliveOffsets[s + 1] && pd.aliveId[lo] === p ? lo : -1
}

/** Tier of polity p at snapshot s (its last known tier when not alive then, Chiefdom if never). */
export function tierAt(pd: PolitiesData, p: number, s: number): PolityTier {
  let k = statIndex(pd, p, s)
  if (k < 0 && pd.lastSnap[p] >= 0) k = statIndex(pd, p, s < pd.firstSnap[p] ? pd.firstSnap[p] : pd.lastSnap[p])
  return (k >= 0 ? pd.aliveTier[k] : 0) as PolityTier
}

/** "Kingdom of North Vashtar" at snapshot s. */
export function polityTitle(pd: PolitiesData, p: number, s: number): string {
  if (p < 0 || p >= pd.count) return 'a state'
  return `${TIER_WORDS[tierAt(pd, p, s)]} of ${pd.names[p]}`
}

/** Capital of polity p at `year` (its first before it was founded), or -1. */
export function capitalAt(pd: PolitiesData, p: number, year: number): number {
  const x = pd.list[p]
  if (!x || !x.capitals?.length) return -1
  let k = 0
  while (k + 1 < x.capitals.length && (x.capitalYears[k + 1] ?? Infinity) <= year) k++
  return x.capitals[k]
}

/** Whether settlement `id` is the capital of a polity alive at `year`: that polity, else -1. */
export function capitalOf(pd: PolitiesData, id: number, year: number): number {
  const q = polityAtYear(pd, id, year)
  if (q >= 0 && capitalAt(pd, q, year) === id) return q
  return -1
}

/** Whether polity p exists at `year` (founded, not yet ended). */
export const polityLives = (pd: PolitiesData, p: number, year: number) => {
  const x = pd.list[p]
  return !!x && year >= x.foundedYear && (x.endedYear < 0 || year < x.endedYear)
}

/** Whether war w is in progress at `year`. */
export function warActive(pd: PolitiesData, w: number, year: number): boolean {
  const W = pd.wars
  if (!W) return false
  return year >= W.startYear[w] && (W.endYear[w] < 0 || year < W.endYear[w])
}

/** War ids in progress at `year`, written into `out` (cleared first). */
export function warsActiveAt(pd: PolitiesData, year: number, out: number[]): number[] {
  out.length = 0
  const W = pd.wars
  if (!W) return out
  for (let w = 0; w < W.count; w++) if (warActive(pd, w, year)) out.push(w)
  return out
}

/** The land snapshot nearest a year. */
export function landSnapNear(pd: PolitiesData, year: number): number {
  const L = pd.land
  if (!L) return 0
  return Math.max(0, Math.min(L.count - 1, Math.round(year / L.interval)))
}

/**
 * Polity of every cell at snapshot s and land snapshot q (WATER for water, -1 for land
 * nobody's or held by a stateless settlement). Cached for the last few (s, q) pairs.
 */
export function cellPolities(pd: PolitiesData, s: number, q: number): Int16Array | null {
  const L = pd.land
  if (!L || pd.cellCount <= 0) return null
  s = clampS(pd, s)
  q = Math.max(0, Math.min(L.count - 1, q))
  const key = s * 100003 + q
  for (let i = 0; i < pd.cache.length; i++) {
    if (pd.cache[i].key === key) {
      const hit = pd.cache[i]
      if (i > 0) {
        pd.cache.splice(i, 1)
        pd.cache.unshift(hit)
      }
      return hit.cells
    }
  }
  const out = pd.cache.length >= 6 ? pd.cache.pop()!.cells : new Int16Array(pd.cellCount)
  out.fill(WATER)
  const N = pd.settlementCount
  const row = q * L.L
  const base = s * N
  for (let k = 0; k < L.L; k++) {
    const c = L.cells[k]
    if (c >= pd.cellCount) continue
    const o = L.territory[row + k] - 1
    out[c] = o >= 0 && o < N ? pd.polity[base + o] : -1
  }
  pd.cache.unshift({ key, cells: out })
  return out
}

/** Danger 0..255 of cell `cell` at land snapshot q (0 without data). */
export function dangerAt(pd: PolitiesData, cell: number, q: number): number {
  const L = pd.land
  if (!L || !L.danger || !pd.landIndexOf) return 0
  const k = pd.landIndexOf[cell] ?? -1
  if (k < 0) return 0
  return L.danger[Math.max(0, Math.min(L.count - 1, q)) * L.L + k]
}

/** "safe", "unsettled", "dangerous", "lawless" for a danger level 0..255. */
export function dangerWords(d: number): string {
  if (d < 12) return 'Safe'
  if (d < 40) return 'Mostly safe'
  if (d < 80) return 'Unsettled'
  if (d < 140) return 'Dangerous'
  return 'Lawless'
}

/** sRGB 0..1 to CIE Lab (D65), and the same colour as a deuteranope sees it (Vienot et al. 1999), both written to out[0..5]. */
function labPair(c: readonly number[], out: Float64Array): void {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const r = lin(c[0]), g = lin(c[1]), b = lin(c[2])
  const lab = (R: number, G: number, B: number, o: number) => {
    const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
    const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B
    const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    out[o] = 116 * f(Y) - 16
    out[o + 1] = 500 * (f(X) - f(Y))
    out[o + 2] = 200 * (f(Y) - f(Z))
  }
  lab(r, g, b, 0)
  // deuteranopia (red-green colour blindness, the commonest)
  lab(0.29275 * r + 0.70725 * g, 0.29275 * r + 0.70725 * g, -0.02234 * r + 0.02234 * g + b, 3)
}

/**
 * Colours that keep neighbours apart: in founding order, each polity takes the variant of its
 * hue (nudged in hue by up to 0.1, lighter, darker or paler) farthest in colour, as seen with
 * normal vision and with red-green colour blindness, from the earlier polities alive at its
 * founding whose capitals lie near its own (its parent included). A successor so stays in its
 * parent's hue family (the hue comes from the simulation) but reads apart from it. Depends
 * only on founding years and capitals, so a longer run of the same history keeps the colours.
 */
export function assignPolityColors(pd: PolitiesData, world: World): void {
  const P = pd.count
  const pos = world.grid.positions
  const capPos = new Float32Array(P * 3)
  for (let p = 0; p < P; p++) {
    const c0 = pd.list[p].capitals?.[0] ?? -1
    const cell = c0 >= 0 && c0 < pd.settlementCount ? pd.history.settlements[c0].cell : -1
    if (cell >= 0) capPos.set([pos[cell * 3], pos[cell * 3 + 1], pos[cell * 3 + 2]], p * 3)
  }
  // neighbours: polities whose land touched within the first 150 years of the later one (sampled every 50 years)
  const touch = new Set<number>()
  const { neighborOffsets: off, neighbors: nb, cellCount } = world.grid
  if (pd.land && pd.cellCount === cellCount) {
    const step = Math.max(1, Math.round(50 / pd.interval))
    for (let s = 0; s < pd.snapshotCount; s += step) {
      if (pd.aliveOffsets[s + 1] - pd.aliveOffsets[s] < 2) continue
      const y = s * pd.interval
      const cells = cellPolities(pd, s, landSnapNear(pd, y))
      if (!cells) continue
      for (let c = 0; c < cellCount; c++) {
        const v = cells[c]
        if (v < 0) continue
        for (let k = off[c]; k < off[c + 1]; k++) {
          const w = cells[nb[k]]
          if (w <= v) continue
          if (y <= pd.list[w].foundedYear + 150) touch.add(v * P + w)
        }
      }
    }
  }
  // (saturated enough to read as a tint over green land and over sand alike)
  const shades: [number, number][] = [[0.68, 0.55], [0.78, 0.43], [0.62, 0.67], [0.85, 0.36], [0.74, 0.61]]
  const shifts = [0, 0.05, -0.05, 0.1, -0.1, 0.15, -0.15, 0.2, -0.2]
  const labs = new Float64Array(P * 6)
  const cand = new Float64Array(6)
  const cosNear = Math.cos(0.42) // radians between capitals
  for (let p = 0; p < P; p++) {
    const x = pd.list[p]
    const hue = ((x.hue % 1) + 1) % 1
    const others: number[] = []
    for (let q = 0; q < p; q++) {
      const y = pd.list[q]
      if (y.endedYear >= 0 && y.endedYear <= x.foundedYear && !touch.has(q * P + p)) continue
      const dot = capPos[p * 3] * capPos[q * 3] + capPos[p * 3 + 1] * capPos[q * 3 + 1] + capPos[p * 3 + 2] * capPos[q * 3 + 2]
      if (dot >= cosNear || q === x.parent || touch.has(q * P + p)) others.push(q)
    }
    let best: [number, number, number] = hsl(hue, shades[0][0], shades[0][1])
    let bestScore = -Infinity
    for (let hi = 0; hi < shifts.length; hi++) {
      for (let v = 0; v < shades.length; v++) {
        const c = hsl((((hue + shifts[hi]) % 1) + 1) % 1, shades[v][0], shades[v][1])
        labPair(c, cand)
        let d = 60
        for (const q of others) {
          const o = q * 6
          const dn = Math.hypot(cand[0] - labs[o], cand[1] - labs[o + 1], cand[2] - labs[o + 2])
          const dd = Math.hypot(cand[3] - labs[o + 3], cand[4] - labs[o + 4], cand[5] - labs[o + 5])
          d = Math.min(d, dn, dd * 1.15)
        }
        // enough apart is enough: then stay close to the intended hue and shade
        const score = Math.min(d, 45) - Math.abs(shifts[hi]) * 22 - v * 1.2
        if (score > bestScore) {
          bestScore = score
          best = c
        }
      }
    }
    pd.rgb.set(best, p * 3)
    labPair(best, cand)
    labs.set(cand, p * 6)
    pd.css[p] = `rgb(${Math.round(best[0] * 255)}, ${Math.round(best[1] * 255)}, ${Math.round(best[2] * 255)})`
  }
}

/** Whether a wall lost in `lostYear` was slighted (taken down after the town fell) rather than left to decay. */
export function wallSlighted(pd: PolitiesData | null, settlement: number, lostYear: number): boolean {
  if (!pd || lostYear < 0) return false
  const c = pd.conquestsOf.get(settlement)
  return !!c && c.some((y) => Math.abs(y - lostYear) <= 1)
}

// ---------------------------------------------------------------------------
// The 3D town generator's view of a settlement (render/dioramas may adopt it).

export interface TownWallRing {
  /** Structure id (History.structures). */
  id: number
  builtYear: number
  /** Year it fell out of use, or -1 while in use at the year asked. */
  lostYear: number
  /** Ring number: 0 the innermost (oldest), counting only rings in use. -1 for a lost ring. */
  ring: number
  /** Taken down after the town fell (draw it broken). */
  slighted: boolean
}

export interface TownPolityState {
  /** Wall rings in use at the year, oldest (innermost) first. */
  walls: TownWallRing[]
  /** Walls slighted at or before the year whose ruins still show (lost within SACK_YEARS * 3 years), oldest first. */
  ruinedWalls: TownWallRing[]
  /** Year of the most recent sack at or before the year, or -1. */
  sackedYear: number
  /** 1 the year it was sacked, fading to 0 over SACK_YEARS years (0 when never or long ago). */
  sacked: number
  /** Fraction of its people lost in that sack (0..1). */
  sackLoss: number
  /** Polity it belongs to at the year (-1 stateless), and whether it is that polity's capital. */
  polity: number
  capital: boolean
  /** Rough fighting men kept there: the largest army staged from it in the last 30 years, else an estimate from its population when walled or a capital (0 otherwise). */
  garrison: number
}

/**
 * Polity state of settlement `settlement` at `year` for the town generator, or null when the
 * history has no polity data (draw walls by size as before). A pure function of the year.
 */
export function townPolityState(history: History, settlement: number, year: number): TownPolityState | null {
  const pd = politiesOf(history)
  if (!pd || settlement < 0 || settlement >= pd.settlementCount) return null
  const sts = history.structures
  const walls: TownWallRing[] = []
  const ruinedWalls: TownWallRing[] = []
  for (const id of pd.wallsOf.get(settlement) ?? []) {
    const st = sts[id]
    if (!st || year < st.builtYear) continue
    if (st.lostYear >= 0 && year >= st.lostYear) {
      const slighted = wallSlighted(pd, settlement, st.lostYear)
      if (slighted && year - st.lostYear <= SACK_YEARS * 3) ruinedWalls.push({ id, builtYear: st.builtYear, lostYear: st.lostYear, ring: -1, slighted })
      continue
    }
    walls.push({ id, builtYear: st.builtYear, lostYear: -1, ring: walls.length, slighted: false })
  }
  let sackedYear = -1, sackLoss = 0
  const sacks = pd.sacksOf.get(settlement)
  if (sacks) {
    for (let k = 0; k < sacks.length; k += 2) {
      if (sacks[k] > year) break
      sackedYear = sacks[k]
      sackLoss = sacks[k + 1]
    }
  }
  const sacked = sackedYear >= 0 && year - sackedYear < SACK_YEARS ? 1 - (year - sackedYear) / SACK_YEARS : 0
  const s = clampS(pd, Math.floor(year / pd.interval))
  const polity = polityAtYear(pd, settlement, year)
  const capital = polity >= 0 && capitalAt(pd, polity, year) === settlement
  let garrison = 0
  const A = pd.armies
  if (A) {
    for (let k = 0; k < A.count; k++) {
      if (A.arrive[k] > year) break
      if (A.from[k] === settlement && year - A.depart[k] <= 30) garrison = Math.max(garrison, A.size[k])
    }
  }
  if (garrison === 0 && (walls.length > 0 || capital)) {
    const pop = history.population[s * pd.settlementCount + settlement] ?? 0
    garrison = Math.round(pop * (capital ? 0.03 : 0.015) * (pop >= CITY_POPULATION ? 1.2 : 1))
  }
  return { walls, ruinedWalls, sackedYear, sacked, sackLoss, polity, capital, garrison }
}

/** How a polity ended, in words ("conquered", "broke apart", ...). */
export function endWords(cause: number): string {
  switch (cause) {
    case PolityEnd.Conquered: return 'conquered'
    case PolityEnd.Fragmented: return 'broke apart'
    case PolityEnd.Dwindled: return 'dwindled away'
    case PolityEnd.Reunified: return 'reunified'
    case PolityEnd.Absorbed: return 'absorbed'
    default: return 'ended'
  }
}
