// Sagas: the facts a saga is made of, read from the recorded History up to the year it is told at (nothing later
// is ever said). One index per history (events by settlement and by type, settlements by people), built on first
// use; the rest are small lookups over it and over the polity, ruler and faith indexes the panels already build.

import { landmarkNameAt, RIVER_FLOW_THRESHOLD, settlementNameAt, type History, type HistoryEvent, type World } from '../../contract.ts'
import { politiesOf, statIndex, tierWord, type PolitiesData } from '../politiesData.ts'
import { rulersOf, rulerWord, type RulersData } from '../rulersData.ts'
import { faithName, faithsOf, type FaithsData } from '../faithsData.ts'

export interface SagaIndex {
  /** Event indices whose `settlement` is the id, chronological. */
  bySettlement: number[][]
  /** Event indices of each type, chronological. */
  byType: Map<number, number[]>
  /** Settlement ids of each people, in founding order. */
  ofPeople: number[][]
  /** Event years, for the cut at the year told. */
  years: Int16Array
}

const indexCache = new WeakMap<History, SagaIndex>()

export function sagaIndexOf(h: History): SagaIndex {
  let ix = indexCache.get(h)
  if (ix) return ix
  const N = h.settlements.length
  const bySettlement: number[][] = Array.from({ length: N }, () => [])
  const byType = new Map<number, number[]>()
  const years = new Int16Array(h.events.length)
  h.events.forEach((e, i) => {
    years[i] = e.year
    if (e.settlement >= 0 && e.settlement < N) bySettlement[e.settlement].push(i)
    let a = byType.get(e.type)
    if (!a) byType.set(e.type, (a = []))
    a.push(i)
  })
  const ofPeople: number[][] = h.peoples.map(() => [])
  for (const s of h.settlements) if (s.people >= 0 && s.people < ofPeople.length) ofPeople[s.people].push(s.id)
  ix = { bySettlement, byType, ofPeople, years }
  indexCache.set(h, ix)
  return ix
}

/** Everything a generator reads, bound to the year the saga is told at. */
export class Ctx {
  readonly h: History
  readonly world: World | null
  /** The year told at: nothing after it is said. */
  readonly Y: number
  readonly seed: number
  readonly pd: PolitiesData | null
  readonly rd: RulersData | null
  readonly fd: FaithsData | null
  readonly ix: SagaIndex
  readonly N: number
  /** Snapshot of the year told. */
  readonly sY: number
  /** Events up to the year told: indices below `cut`. */
  readonly cut: number
  /** Settlements whose present name has been given beside an older one. */
  private noted = new Set<number>()

  constructor(h: History, world: World | null, year: number) {
    this.h = h
    this.world = world
    this.Y = Math.max(0, Math.min(h.years, Math.floor(year)))
    this.seed = world?.seed ?? 0
    this.pd = politiesOf(h)
    this.rd = this.pd ? rulersOf(h) : null
    this.fd = faithsOf(h)
    this.ix = sagaIndexOf(h)
    this.N = h.settlements.length
    this.sY = this.snap(this.Y)
    let lo = 0, hi = this.ix.years.length
    while (lo < hi) {
      const m = (lo + hi) >>> 1
      if (this.ix.years[m] <= this.Y) lo = m + 1
      else hi = m
    }
    this.cut = lo
  }

  snap(y: number): number {
    return Math.max(0, Math.min(this.h.snapshotCount - 1, Math.floor(y / Math.max(1, this.h.snapshotInterval))))
  }

  ev(i: number): HistoryEvent {
    return this.h.events[i]
  }

  /** Event indices of `type` up to the year told. */
  type(type: number): number[] {
    const a = this.ix.byType.get(type)
    if (!a) return []
    let n = 0
    while (n < a.length && a[n] < this.cut) n++
    return n === a.length ? a : a.slice(0, n)
  }

  /** Event indices at settlement `id` up to the year told (optionally of the given types). */
  at(id: number, types?: readonly number[]): number[] {
    const a = id >= 0 && id < this.N ? this.ix.bySettlement[id] : []
    const out: number[] = []
    for (const i of a) {
      if (i >= this.cut) break
      if (!types || types.includes(this.h.events[i].type)) out.push(i)
    }
    return out
  }

  // ---- settlements ----
  pop(id: number, y = this.Y): number {
    return this.h.population[this.snap(y) * this.N + id] ?? 0
  }
  alive(id: number, y = this.Y): boolean {
    const s = this.h.settlements[id]
    return !!s && s.foundedYear <= y && (s.abandonedYear < 0 || s.abandonedYear > y)
  }
  /** Its largest population up to the year told, and the year of it. */
  peak(id: number): { pop: number; year: number } {
    let pop = 0, year = 0
    const I = this.h.snapshotInterval
    for (let s = 0; s <= this.sY; s++) {
      const v = this.h.population[s * this.N + id]
      if (v > pop) { pop = v; year = s * I }
    }
    return { pop, year }
  }
  /** Name in use at `y`. */
  name(id: number, y = this.Y): string {
    return id >= 0 && id < this.N ? settlementNameAt(this.h, id, y) : 'a far place'
  }
  /** Name in use at `y`, with the name it bears at the year told the first time it differs ("Rilko (now Rilkochal)"). */
  place(id: number, y: number): string {
    const a = this.name(id, y)
    if (id < 0 || id >= this.N || this.noted.has(id)) return a
    const b = this.name(id, this.Y)
    if (a !== b && this.alive(id)) {
      this.noted.add(id)
      return `${a} (now ${b})`
    }
    return a
  }
  peopleName(p: number): string {
    return this.h.peoples[p]?.name ?? 'a lost people'
  }
  peopleOf(id: number): number {
    return id >= 0 && id < this.N ? this.h.settlements[id].people : -1
  }
  isOutpost(id: number): boolean {
    return !!this.h.settlements[id]?.outpost
  }

  // ---- states ----
  pname(p: number): string {
    const pd = this.pd
    return pd && p >= 0 && p < pd.count ? pd.names[p] : 'a forgotten realm'
  }
  /** Population, members and tier of polity p at snapshot s (null when it had no members then). */
  pstat(p: number, s: number): { pop: number; members: number; tier: number } | null {
    const pd = this.pd
    if (!pd) return null
    const k = statIndex(pd, p, s)
    if (k < 0) return null
    return { pop: pd.alivePop[k], members: pd.aliveMembers[k], tier: pd.aliveTier[k] }
  }
  /** Its height up to the year told: the snapshot of its largest population. */
  ppeak(p: number): { pop: number; members: number; tier: number; year: number; maxTier: number } {
    const pd = this.pd
    let best = { pop: 0, members: 0, tier: 0, year: -1, maxTier: 0 }
    if (!pd || p < 0 || p >= pd.count || pd.firstSnap[p] < 0) return best
    const last = Math.min(this.sY, pd.lastSnap[p])
    for (let s = pd.firstSnap[p]; s <= last; s++) {
      const st = this.pstat(p, s)
      if (!st) continue
      if (st.tier > best.maxTier) best.maxTier = st.tier
      if (st.pop > best.pop) best = { ...st, year: s * pd.interval, maxTier: best.maxTier }
    }
    return best
  }
  /** "Kingdom of North Vashtar" with its tier at `y` (its last tier while it lived, when `y` is past its end). */
  ptitle(p: number, y = this.Y): string {
    const pd = this.pd
    if (!pd || p < 0 || p >= pd.count) return 'a forgotten realm'
    let s = this.snap(y)
    if (pd.lastSnap[p] >= 0 && s > pd.lastSnap[p]) s = pd.lastSnap[p]
    if (s < pd.firstSnap[p]) s = pd.firstSnap[p]
    const st = this.pstat(p, s)
    return `${tierWord(pd, p, st ? st.tier : 0)} of ${pd.names[p]}`
  }
  /** Its greatest title up to the year told ("Empire of Rilkochal"). */
  pgreatTitle(p: number): string {
    const pd = this.pd
    if (!pd || p < 0 || p >= pd.count) return 'a forgotten realm'
    return `${tierWord(pd, p, this.ppeak(p).maxTier)} of ${pd.names[p]}`
  }
  plives(p: number, y = this.Y): boolean {
    const x = this.pd?.list[p]
    return !!x && x.foundedYear <= y && (x.endedYear < 0 || x.endedYear > y)
  }
  /** Polity of settlement `id` at `y` (-1). */
  polityOf(id: number, y: number): number {
    const pd = this.pd
    if (!pd || id < 0 || id >= this.N) return -1
    return pd.polity[this.snap(y) * this.N + id]
  }
  /** The capital of p at `y` (its capitals list). */
  capital(p: number, y: number): number {
    const x = this.pd?.list[p]
    if (!x) return -1
    let c = x.capitals[0] ?? -1
    for (let k = 0; k < x.capitals.length; k++) if (x.capitalYears[k] <= y) c = x.capitals[k]
    return c
  }

  // ---- rulers ----
  /** "King Narun II" (the title word of its realm's tier late in the reign, or at `at`). */
  ruler(r: number, at = -1): string {
    const rd = this.rd
    if (!rd || r < 0 || r >= rd.R) return 'its ruler'
    const x = rd.rulers[r]
    const w = rulerWord(rd, r, at >= 0 ? at : Math.max(x.acceded, (x.ended >= 0 && x.ended <= this.Y ? x.ended : this.Y) - 1))
    return w === 'Elected head' ? `${rd.title[r]}, elected head` : `${w} ${rd.title[r]}`
  }
  rulerName(r: number): string {
    return this.rd && r >= 0 && r < this.rd.R ? this.rd.title[r] : 'its ruler'
  }
  /** Years reigned up to the year told. */
  reignYears(r: number): number {
    const x = this.rd?.rulers[r]
    if (!x) return 0
    const end = x.ended >= 0 && x.ended <= this.Y ? x.ended : this.Y
    return Math.max(0, end - x.acceded)
  }
  reignEndedBy(r: number): boolean {
    const x = this.rd?.rulers[r]
    return !!x && x.ended >= 0 && x.ended <= this.Y
  }

  // ---- sickness ----
  private glossed = new Set<number>()
  /** "the rusmun" (with what it was the first time: "the rusmun, a camp fever,"), '' unnamed. */
  disease(d: number, legend = false): string {
    const x = this.h.diseases?.[d]
    if (!x || !x.name) return ''
    if (this.glossed.has(d)) return `the ${x.name}`
    this.glossed.add(d)
    const g = (legend ? DISEASE_KENNING : DISEASE_GLOSS)[x.archetype] ?? 'a sickness'
    return `the ${x.name}, ${g},`
  }

  // ---- faiths, landmarks ----
  faith(f: number): string {
    return this.fd && f >= 0 && f < this.fd.F ? faithName(this.fd, f) : 'another faith'
  }
  faithWord(f: number): string {
    return this.fd?.faiths[f]?.name ?? ''
  }
  /** Majority faith of settlement id at snapshot s (-1). */
  faithAt(id: number, s: number): number {
    const v = this.h.faith?.[s * this.N + id]
    return v === undefined || v === 255 ? -1 : v
  }
  landmark(i: number, y = this.Y): string {
    return landmarkNameAt(this.h, i, y)
  }
}

/** Indices of the largest values: the top `n` of `ids` by `key`, descending. */
export function topBy<T>(ids: readonly T[], key: (x: T) => number, n: number): T[] {
  return [...ids].map((x) => [x, key(x)] as const).filter((a) => a[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map((a) => a[0])
}

const DISEASE_GLOSS: Record<string, string> = { pox: 'a pox', measles: 'a spotted fever of children', flux: 'a bloody flux', plague: 'a plague of rats and fleas', fever: 'a marsh fever', typhus: 'a camp fever' }
const DISEASE_KENNING: Record<string, string> = { pox: 'the pitting death', measles: 'the red spotting', flux: 'the bloody flux', plague: 'the black death of rats', fever: 'the marsh-shaking', typhus: 'the soldiers\' fever' }

const BIOME_WHERE: readonly string[] = ['at sea', 'by the shallows', 'on the ice', 'on the tundra', 'among the northern pines', 'in wooded country', 'on the open grassland', 'at the edge of the desert', 'on the savanna', 'in the rainforest', 'in the mountains']

/** Where a cell lies, in words, from the world (biome, sea coast, river, lake); null without a world. */
export function settingOf(c: Ctx, cell: number): { where: string; coast: boolean; river: boolean; lake: boolean } | null {
  const w = c.world
  if (!w || cell < 0 || cell >= w.grid.cellCount) return null
  const g = w.grid
  let coast = false, lake = false
  for (let k = g.neighborOffsets[cell]; k < g.neighborOffsets[cell + 1]; k++) {
    const n = g.neighbors[k]
    if (w.elevation[n] < 0) coast = true
    else if (w.lake[n]) lake = true
  }
  const river = w.flow[cell] >= RIVER_FLOW_THRESHOLD
  return { where: BIOME_WHERE[w.biome[cell]] ?? 'in open country', coast, river, lake }
}

/** Main crop and herd at a cell at year `y` (species ids, -1 none), from the land snapshots. */
export function farmingAt(c: Ctx, cell: number, y: number): { crop: number; herd: number } {
  const h = c.h, w = c.world
  if (!w || !h.crop || h.landSnapshotCount <= 0) return { crop: -1, herd: -1 }
  const C = w.grid.cellCount
  const q = Math.max(0, Math.min(h.landSnapshotCount - 1, Math.floor(y / Math.max(1, h.landInterval))))
  const cr = h.crop[q * C + cell] ?? 0, hd = h.herd?.[q * C + cell] ?? 0
  return { crop: cr - 1, herd: hd - 1 }
}
