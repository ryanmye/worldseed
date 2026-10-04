// Polities in the UI: a per-history index over History.polities, History.polity,
// History.territory, History.danger, History.wars, History.raids and the political events
// (EventType 20-34), so that everything the globe, the Polities panel, the inspector and the
// chronicle show about states at a year is a cheap function of that year.
//
//  - Alive polities per snapshot (CSR, ascending id) with their members, population and tier
//    (Chiefdom, Kingdom or Empire; see TIER_RULE below for the exact thresholds, which the UI
//    sets deliberately differently from the simulation's own rule).
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

import { BondKind, CITY_POPULATION, EventType, JourneyKind, PolityEnd, PolityOrigin, StructureType, WarKind, type Bonds, type History, type HistoryEvent, type Polity, type RaidSummary, type Wars, type World } from '../contract.ts'

export const PolityTier = { Chiefdom: 0, Kingdom: 1, Empire: 2 } as const
export type PolityTier = (typeof PolityTier)[keyof typeof PolityTier]
export const TIER_WORDS: readonly string[] = ['Chiefdom', 'Kingdom', 'Empire']

/**
 * The tier rule, the one place the UI decides "Chiefdom", "Kingdom" or "Empire". This intentionally
 * DIFFERS from (and overrides, for display purposes) the simulation's own tier rule in contract.ts/sim:
 * the simulation was calling small multi-people states (e.g. 4-13 thousand people spread over a couple
 * of peoples) an "Empire", which reads wrong in the UI, so the thresholds below add a population floor
 * to the multi-people path and tie both the Empire and Kingdom floors to world population. If the
 * thresholds ever need to change again, THIS object is the single place to adjust - nothing else in
 * the UI should hardcode a tier threshold.
 *
 * Empire: pop >= max(empirePop, empireWorld * world people), OR (at least multiPeoples peoples each
 *   holding >= multiShare of its members, with >= multiMembers members, AND pop >= max(multiPop,
 *   multiWorld * world people)).
 * Kingdom: members >= kingdomMembers AND pop >= max(kingdomPop, kingdomWorld * world people).
 * Otherwise: Chiefdom.
 * "World people" is everyone living in a settlement (not an expedition base) at the snapshot.
 * A League (PolityOrigin.League) is always "League of ..." whatever its tier (tierWord).
 */
export const TIER_RULE = {
  empirePop: 20000, empireWorld: 0.08,
  kingdomPop: 2000, kingdomWorld: 0.008, kingdomMembers: 6,
  multiShare: 0.15, multiPeoples: 2, multiMembers: 25, multiPop: 10000, multiWorld: 0.04,
}

/** Tier of a polity of `pop` people in `members` settlements, `peoplesAtShare` of its peoples holding TIER_RULE.multiShare of it or more, in a world of `worldPop` people. */
export function tierOf(pop: number, members: number, peoplesAtShare: number, worldPop: number): PolityTier {
  const R = TIER_RULE
  const multiEmpire = peoplesAtShare >= R.multiPeoples && members >= R.multiMembers && pop >= Math.max(R.multiPop, R.multiWorld * worldPop)
  if (pop >= Math.max(R.empirePop, R.empireWorld * worldPop) || multiEmpire) return PolityTier.Empire
  if (members >= R.kingdomMembers && pop >= Math.max(R.kingdomPop, R.kingdomWorld * worldPop)) return PolityTier.Kingdom
  return PolityTier.Chiefdom
}

/** English qualifiers by PolityQualifier. */
const QUALIFIER_WORDS: readonly string[] = ['', 'North', 'South', 'East', 'West', 'New', 'Upper', 'Lower', 'Restored']

/** Cell value for water in cellPolities (unowned land is -1). */
export const WATER = -2

/** Years over which a sack marks a town (scorched ground, ruins), fading. */
export const SACK_YEARS = 40

/** Political event types (20-34, and the second version's 35-43). */
export const PolityEvent = {
  Founded: 20, Ended: 21, CapitalMoved: 22, Joined: 23, WarDeclared: 24, PeaceMade: 25, Conquered: 26, Sacked: 27,
  SiegeLifted: 28, Raid: 29, Revolt: 30, RevoltCrushed: 31, Seceded: 32, Defected: 33, SuccessionCrisis: 34,
  CivilWar: 35, Partitioned: 36, Reunified: 37, BecameVassal: 38, Alliance: 39, SmugglingRing: 40, PiratesRise: 41, PiratesSuppressed: 42, Blockade: 43,
} as const
export const isPolityEventType = (t: number) => t >= 20 && t <= 43

/** contraband (0..255) from which a settlement counts as a smugglers' hub (marked on the map, said in the inspector). */
export const HUB_CONTRABAND = 64
/** Share of the goods crossing between two polities (not at war, not bound) carried as contraband from which their border is drawn as embargoed. */
export const EMBARGO_SHARE = 0.5
/** Bond values of BecameVassal events: value >= this is tribute (value - TRIBUTE_BASE the overlord). */
export const TRIBUTE_BASE = 1000

/** A blockade (EventType.Blockade): `port` blockaded by the fleets of the polity ruled from `by` in war `war`, from `year` until the war ends. */
export interface BlockadeMark { year: number; end: number; port: number; by: number; war: number }

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

  // ---- polities v2 (each null or empty when the history has none) ----
  /** People living in settlements (expedition bases not counted) per snapshot: the world population the tier rule may scale with. */
  worldPop: Float64Array
  /** Vassalage, tribute and alliances, and the bonds of each polity (as either side), in order of making. */
  bonds: Bonds | null
  bondsOf: number[][]
  /** Tariff rate (0..255) and duty revenue per snapshot per polity (layout of History.tariff). */
  tariff: Uint8Array | null
  tariffRevenue: Float32Array | null
  /** Contraband and the share of cargo lost per trade snapshot per route (layout of History.tradeVolume), with the trade layout. */
  smuggle: Float32Array | null
  loss: Uint8Array | null
  trade: { count: number; snapshots: number; interval: number; a: Int32Array; b: Int32Array; volume: Float32Array } | null
  /** Contraband share of income and pirate strength per snapshot per settlement (layout of population). */
  contraband: Uint8Array | null
  piracy: Uint8Array | null
  /** Blockades, by year. */
  blockades: BlockadeMark[]
  /** Settlements that were ever a smugglers' hub (contraband >= HUB_CONTRABAND) or a pirate haven (piracy > 0) at some snapshot. */
  hubSettlements: Int32Array
  havenSettlements: Int32Array
  /** Embargoed pairs per trade snapshot (lazily, see embargoesAt). */
  embargoCache: Map<number, Int32Array>
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
  const worldPop = new Float64Array(S)
  let maxAlive = 0
  for (let s = 0; s < S; s++) {
    const base = s * N
    let world = 0
    for (let i = 0; i < N; i++) if (!isOutpost[i]) world += h.population[base + i]
    worldPop[s] = world
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
        if (popSum[q] > 0 && peoplePop[q * PP + k] >= TIER_RULE.multiShare * popSum[q]) shares++
        peoplePop[q * PP + k] = 0
      }
      const pop = popSum[q], m = members[q]
      const tier = tierOf(pop, m, shares, world)
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
    worldPop,
    bonds: null,
    bondsOf: list.map(() => []),
    tariff: null,
    tariffRevenue: null,
    smuggle: null,
    loss: null,
    trade: null,
    contraband: null,
    piracy: null,
    blockades: [],
    hubSettlements: new Int32Array(0),
    havenSettlements: new Int32Array(0),
    embargoCache: new Map(),
  }

  // ---- polities v2: bonds, trade policy, the outlaw economy (each optional) ----
  const B = p.bonds
  if (B && B.count > 0 && B.a && B.a.length >= B.count && B.b && B.kind && B.startYear && B.endYear) {
    pd.bonds = B
    for (let k = 0; k < B.count; k++) {
      if (B.a[k] >= 0 && B.a[k] < P) pd.bondsOf[B.a[k]].push(k)
      if (B.b[k] >= 0 && B.b[k] < P && B.b[k] !== B.a[k]) pd.bondsOf[B.b[k]].push(k)
    }
  }
  if (p.tariff instanceof Uint8Array && p.tariff.length >= S * P) pd.tariff = p.tariff
  if (p.tariffRevenue instanceof Float32Array && p.tariffRevenue.length >= S * P) pd.tariffRevenue = p.tariffRevenue
  const T = p.trade, TS = p.tradeSnapshotCount ?? 0, TI = p.tradeInterval ?? 0
  if (T && T.count > 0 && TS > 0 && TI > 0 && p.tradeVolume instanceof Float32Array && p.tradeVolume.length >= TS * T.count) {
    pd.trade = { count: T.count, snapshots: TS, interval: TI, a: T.a, b: T.b, volume: p.tradeVolume }
    if (p.smuggleVolume instanceof Float32Array && p.smuggleVolume.length >= TS * T.count) pd.smuggle = p.smuggleVolume
    if (p.tradeLoss instanceof Uint8Array && p.tradeLoss.length >= TS * T.count) pd.loss = p.tradeLoss
  }
  const everAbove = (a: Uint8Array, min: number) => {
    const seen = new Uint8Array(N)
    for (let k = 0; k < S * N; k++) if (a[k] >= min) seen[k % N] = 1
    const ids: number[] = []
    for (let i = 0; i < N; i++) if (seen[i]) ids.push(i)
    return Int32Array.from(ids)
  }
  if (p.contraband instanceof Uint8Array && p.contraband.length >= S * N) {
    pd.contraband = p.contraband
    pd.hubSettlements = everAbove(p.contraband, HUB_CONTRABAND)
  }
  if (p.piracy instanceof Uint8Array && p.piracy.length >= S * N) {
    pd.piracy = p.piracy
    pd.havenSettlements = everAbove(p.piracy, 1)
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
    if (t === PolityEvent.Conquered || t === PolityEvent.Joined || t === PolityEvent.Defected || t === PolityEvent.Seceded || t === PolityEvent.Founded || t === PolityEvent.CivilWar) push(pd.changesOf, e.settlement, e.year)
    if (t === PolityEvent.Blockade && e.settlement >= 0 && e.settlement < N) {
      const w = e.value
      const end = wars && w >= 0 && w < wars.count ? (wars.endYear[w] < 0 ? Infinity : wars.endYear[w]) : e.year + 5
      pd.blockades.push({ year: e.year, end: Math.max(e.year + 1, end), port: e.settlement, by: e.other, war: w })
    }
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
    case PolityEvent.CivilWar:
    case PolityEvent.Blockade:
      return warSides(e.value)
    case PolityEvent.Partitioned:
      return [e.value]
    case PolityEvent.Reunified:
      return [polityAt(pd, e.settlement, a), e.value]
    case PolityEvent.BecameVassal:
      return [polityAt(pd, e.settlement, a), e.value % TRIBUTE_BASE]
    case PolityEvent.Alliance:
      return [polityAt(pd, e.settlement, a), e.value]
    case PolityEvent.SmugglingRing:
      return [polityAt(pd, e.settlement, a), e.other >= 0 ? polityAt(pd, e.other, a) : -1]
    case PolityEvent.PiratesRise:
      return [polityAt(pd, e.settlement, a)]
    case PolityEvent.PiratesSuppressed:
      return [polityAt(pd, e.settlement, a), e.other >= 0 ? polityAt(pd, e.other, a) : -1]
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

/** The title word of polity p at tier `tier`: "League" for a league of towns whatever its size, else the tier's word. */
export function tierWord(pd: PolitiesData, p: number, tier: number): string {
  return pd.list[p]?.origin === PolityOrigin.League ? 'League' : TIER_WORDS[tier] ?? 'Chiefdom'
}

/** "Kingdom of North Vashtar" ("League of Vashtar") at snapshot s. */
export function polityTitle(pd: PolitiesData, p: number, s: number): string {
  if (p < 0 || p >= pd.count) return 'a state'
  return `${tierWord(pd, p, tierAt(pd, p, s))} of ${pd.names[p]}`
}

// ---------------------------------------------------------------------------
// polities v2: bonds, civil wars, blockades, trade policy and the outlaw economy

/** Whether bond k is in force at `year`. */
export function bondActive(pd: PolitiesData, k: number, year: number): boolean {
  const B = pd.bonds
  if (!B) return false
  return year >= B.startYear[k] && (B.endYear[k] < 0 || year < B.endYear[k])
}

/** The Vassal or Tribute bond polity p is under at `year` (it is the `a` of at most one), or -1. */
export function overlordBond(pd: PolitiesData, p: number, year: number): number {
  const B = pd.bonds
  if (!B || p < 0 || p >= pd.count) return -1
  for (const k of pd.bondsOf[p]) if (B.a[k] === p && B.kind[k] !== BondKind.Alliance && bondActive(pd, k, year)) return k
  return -1
}

/** The overlord of p at `year` when p is its vassal (not a tributary), or -1. */
export function overlordOf(pd: PolitiesData, p: number, year: number): number {
  const k = overlordBond(pd, p, year)
  return k >= 0 && pd.bonds!.kind[k] === BondKind.Vassal ? pd.bonds!.b[k] : -1
}

/** Bonds in force at `year` in which p is the overlord (b of a Vassal or Tribute bond), written to `out`. */
export function subjectBonds(pd: PolitiesData, p: number, year: number, out: number[] = []): number[] {
  out.length = 0
  const B = pd.bonds
  if (!B || p < 0 || p >= pd.count) return out
  for (const k of pd.bondsOf[p]) if (B.b[k] === p && B.a[k] !== p && B.kind[k] !== BondKind.Alliance && bondActive(pd, k, year)) out.push(k)
  return out
}

/** Whether polities p and q are bound at `year` (vassal and overlord, tributary, allies, or vassals of one overlord). */
export function boundAt(pd: PolitiesData, p: number, q: number, year: number): boolean {
  const B = pd.bonds
  if (!B || p < 0 || q < 0) return false
  for (const k of pd.bondsOf[p]) if (((B.a[k] === p && B.b[k] === q) || (B.a[k] === q && B.b[k] === p)) && bondActive(pd, k, year)) return true
  const op = overlordOf(pd, p, year), oq = overlordOf(pd, q, year)
  return op >= 0 && op === oq
}

/** Whether war w is a civil war. */
export const isCivilWar = (pd: PolitiesData, w: number) => !!pd.wars && w >= 0 && w < pd.wars.count && pd.wars.kind[w] === WarKind.CivilWar

/** Whether polities p and q are at war with each other at `year`. */
export function atWarAt(pd: PolitiesData, p: number, q: number, year: number): boolean {
  const W = pd.wars
  if (!W || p < 0 || q < 0) return false
  for (const w of pd.warsOf[p]) if (((W.attacker[w] === p && W.defender[w] === q) || (W.attacker[w] === q && W.defender[w] === p)) && warActive(pd, w, year)) return true
  return false
}

/** Trade snapshot nearest a year (0 without trade). */
export const tradeSnapNear = (pd: PolitiesData, year: number) => (pd.trade ? Math.max(0, Math.min(pd.trade.snapshots - 1, Math.round(year / pd.trade.interval))) : 0)

/**
 * Embargoed pairs at trade snapshot t, flat [p, q, ...] with p < q: neighbouring polities, not at war and not bound,
 * whose trade with each other is at least EMBARGO_SHARE contraband. (The history does not record embargoes: an embargo
 * short of war stops all legal trade but in food, so what still crosses is mostly smuggled; pairs that stopped trading
 * altogether cannot be told apart from pairs that never traded.) Cached per trade snapshot.
 */
export function embargoesAt(pd: PolitiesData, t: number): Int32Array {
  const T = pd.trade, SM = pd.smuggle
  if (!T || !SM) return new Int32Array(0)
  t = Math.max(0, Math.min(T.snapshots - 1, t))
  const hit = pd.embargoCache.get(t)
  if (hit) return hit
  const year = t * T.interval
  const s = clampS(pd, Math.floor(year / pd.interval))
  const N = pd.settlementCount, R = T.count
  const sums = new Map<number, [number, number]>()
  for (let r = 0; r < R; r++) {
    const v = T.volume[t * R + r]
    if (!(v > 0)) continue
    const a = T.a[r], b = T.b[r]
    if (a < 0 || b < 0 || a >= N || b >= N) continue
    const pa = pd.polity[s * N + a], pb = pd.polity[s * N + b]
    if (pa < 0 || pb < 0 || pa === pb) continue
    const key = Math.min(pa, pb) * 65536 + Math.max(pa, pb)
    const x = sums.get(key)
    if (x) {
      x[0] += v
      x[1] += SM[t * R + r]
    } else sums.set(key, [v, SM[t * R + r]])
  }
  const out: number[] = []
  for (const [key, [v, sm]] of sums) {
    if (sm < EMBARGO_SHARE * v) continue
    const p = Math.floor(key / 65536), q = key % 65536
    if (atWarAt(pd, p, q, year) || boundAt(pd, p, q, year)) continue
    out.push(p, q)
  }
  const arr = Int32Array.from(out)
  if (pd.embargoCache.size > 64) pd.embargoCache.clear()
  pd.embargoCache.set(t, arr)
  return arr
}

/** Contraband share (0..1) of settlement id's income and its pirates' strength (0..1) at snapshot s. */
export const contrabandAt = (pd: PolitiesData, id: number, s: number) => (pd.contraband && id >= 0 && id < pd.settlementCount ? pd.contraband[clampS(pd, s) * pd.settlementCount + id] / 255 : 0)
export const piracyAt = (pd: PolitiesData, id: number, s: number) => (pd.piracy && id >= 0 && id < pd.settlementCount ? pd.piracy[clampS(pd, s) * pd.settlementCount + id] / 255 : 0)

/** Tariff rate (0..1) of polity p at snapshot s, and its duty revenue (wealth a year). */
export const tariffAt = (pd: PolitiesData, p: number, s: number) => (pd.tariff && p >= 0 && p < pd.count ? pd.tariff[clampS(pd, s) * pd.count + p] / 255 : 0)
export const revenueAt = (pd: PolitiesData, p: number, s: number) => (pd.tariffRevenue && p >= 0 && p < pd.count ? pd.tariffRevenue[clampS(pd, s) * pd.count + p] : 0)

/** Blockades in force at `year` (port blockaded, from the event until its war ends), written to `out`. */
export function blockadesAt(pd: PolitiesData, year: number, out: BlockadeMark[] = []): BlockadeMark[] {
  out.length = 0
  for (const b of pd.blockades) {
    if (b.year > year) break
    if (year < b.end) out.push(b)
  }
  return out
}

/** A sphere at snapshot s: an overlord (not itself anyone's vassal) with its vassals and tributaries. */
export interface Sphere { overlord: number; vassals: number[]; tributaries: number[]; members: number; pop: number }

/** Spheres at `year` (snapshot s for the numbers), by people (overlord and vassals; tributaries are listed, not counted), largest first. */
export function spheresAt(pd: PolitiesData, year: number, s: number): Sphere[] {
  const B = pd.bonds
  if (!B) return []
  const by = new Map<number, Sphere>()
  for (let k = 0; k < B.count; k++) {
    if (B.kind[k] === BondKind.Alliance || !bondActive(pd, k, year)) continue
    const a = B.a[k], o = B.b[k]
    if (a === o || statIndex(pd, a, s) < 0 || statIndex(pd, o, s) < 0) continue
    let x = by.get(o)
    if (!x) by.set(o, (x = { overlord: o, vassals: [], tributaries: [], members: 0, pop: 0 }))
    ;(B.kind[k] === BondKind.Vassal ? x.vassals : x.tributaries).push(a)
  }
  const out: Sphere[] = []
  for (const x of by.values()) {
    for (const q of [x.overlord, ...x.vassals]) {
      const i = statIndex(pd, q, s)
      if (i < 0) continue
      x.members += pd.aliveMembers[i]
      x.pop += pd.alivePop[i]
    }
    out.push(x)
  }
  out.sort((a, b) => b.pop - a.pop || a.overlord - b.overlord)
  return out
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
