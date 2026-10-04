// polities: headless tuning harness for states, war and danger. Run with:
//   node src/sim/history/polityStats.ts [seed ...]            (Node >= 23, native type stripping)
//   node src/sim/history/polityStats.ts --map 42 7            (also timelines, successor trees and ASCII territory maps)
//   node src/sim/history/polityStats.ts --no-ab               (skip the runs with the polity system off)
// Reports, across seeds, the design's tuning targets (polities/design.md 14.1): polity counts, share of
// settlements and people inside states, the largest state's share, lifetimes, formation / conquest /
// secession / fragmentation counts, wars and their outcomes, the population cost against the same
// world with polities off, where large towns sit (defensible sites, distance from borders) against the
// off run, danger, capitals, churn, path dependence and snowballing, and the failure modes; and (v2,
// formatPolityV2) great empires and hegemons' spheres, civil wars, partitions, reunifications, bonds,
// duty revenue, contraband, pirates and smugglers' hubs, towns on pirate-exposed coasts, forts, blockades.

import { Biome, BondEnd, BondKind, CITY_POPULATION, EventType, PolityEnd, PolityOrigin, StructureType, TOWN_POPULATION, WarOutcome } from '../../contract.ts'
import type { History, World } from '../../contract.ts'
import { generateWorld } from '../index.ts'
import { runHistory } from './index.ts'
import type { HistoryRun } from './index.ts'
import { HISTORY_STATS_SEEDS, spearman } from './stats.ts'
import { buildDefense } from './polity/defense.ts'
import { Tier, tierOf } from './polity/state.ts'

export interface PolityStatRow {
  seed: number
  ms: number
  msOff: number
  firstYear: number
  /** Living polities with >= 2 members at 800, 1200, 1500, 1600, 2000, and the most at any snapshot. */
  count: number[]
  countMax: number
  /** Largest share of the living settlements any one polity held at any snapshot. */
  maxSettleShare: number
  /** Share of living settlements inside polities at 1000 and 2000; share of people at 2000. */
  inside1000: number
  inside2000: number
  popInside2000: number
  /** Largest polity's share of world people at 2000. */
  largest2000: number
  /** Lifetimes (years; alive ones to the end of the run) of polities that ever reached Kingdom; share of all polities < 20 years. */
  kingdomLife: number[]
  shortShare: number
  /** Longest years a lineage held its founding core. */
  coreYears: number
  formed: number
  conquered: number
  seceded: number
  fragmentations: number
  absorbed: number
  /** Wars declared, per century per 10 living polities; lengths (ended wars); outcomes count by WarOutcome. */
  wars: number
  warRate: number
  warLength: number[]
  outcomes: number[]
  /** World people at 2000 with polities and without, worst 100-year fall (share), share of abandonments after war. */
  pop2000: number
  popOff2000: number
  worstFall: number
  warAbandon: number
  /** Revolts per century per polity of >= 10 members, share won. */
  revoltRate: number
  revoltWin: number
  /** Mean T of foundings in danger >= 0.4 minus in danger <= 0.1; counts. */
  siteT: number
  siteCellT: number
  siteHigh: number
  siteLow: number
  /**
   * Site choice against the site the group would have chosen without danger (migration's foundings from year 300): of
   * those whose site without danger lay in danger >= 0.2 (raided borderlands, pirate coasts), the share that went elsewhere
   * and the mean danger chosen minus that site's; (founders' own danger >= 0.3) the mean defensibility chosen minus that
   * site's; counts.
   */
  siteQuieter: number
  siteDz: number
  siteDD: number
  siteAltN: number
  siteFearN: number
  /** Cities >= 10k walled at 2000; share of the 10 largest that are or were capitals. */
  citiesWalled: number
  topCapitals: number
  /** Towns >= 3000 at 2000 on defensible sites (T >= 1.3), with / without polities; mean hops from a border between polities, with / without. */
  townsDefOn: number
  townsDefOff: number
  townsBorderOn: number
  townsBorderOff: number
  /** The same for towns founded after year 500; people-weighted T and hops over all settlements; largest settlement, cities and towns, on / off. */
  lateDefOn: number
  lateDefOff: number
  lateBorderOn: number
  lateBorderOff: number
  wTOn: number
  wTOff: number
  wHopsOn: number
  wHopsOff: number
  bigOn: number
  bigOff: number
  citiesOn: number
  citiesOff: number
  townsOn: number
  townsOff: number
  /** Mean cell danger over land, and share of land cells >= 0.4, at 800, 1200, 1600, 2000. */
  danger: number[]
  dangerHigh: number[]
  /** Capitals: mean capital people / mean member people at 2000; capitals among cities >= 10k. */
  capitalRatio: number
  capitalsCities: number
  /** Membership changes per settlement per century (median over settlements alive >= 100 years). */
  churn: number
  /** Spearman of lineage people share 1100 vs 2000. */
  pathDep: number
  /** Largest polity's peak share, and whether it fell by >= 30% within 300 years. */
  peakShare: number
  peakFell: boolean
  /** Share of polities (>= 2 members ever) with at most 3 members at their peak. */
  tinyShare: number
  raidsLogged: number
  raidsSmall: number
  diag: Record<string, number>
  v2: PolityV2Row
}

/** v2 measures (trade policy, the outlaw economy, civil wars and bonds). */
export interface PolityV2Row {
  civilWars: number
  partitions: number
  /** Reunified events: civil wars won, kindred states brought back. */
  reunified: number
  vassals: number
  tributes: number
  alliances: number
  freed: number
  forts: number
  blockades: number
  /** Largest share of world people held by a state with its vassals (hegemon sphere) at any snapshot, its year, and whether it fell by >= 30% within 300 years. */
  sphereMax: number
  sphereYear: number
  sphereFell: boolean
  /** Largest single state share at any snapshot. */
  stateMax: number
  /** Duty revenue / capitals' income and contraband / value crossing restricted borders, means over 1500-2000; mean tariff rate of living polities at 2000. */
  revShare: number
  smugShare: number
  tariff2000: number
  /** Cargo value lost to pirates / privateers and to bandits over 1500-2000, as a share of the value crossing restricted borders (pirates) and of all route volume. */
  pirLoss: number
  bandLoss: number
  /** Smugglers' hubs (SmugglingRing), pirate havens (PiratesRise), suppressions; mean defensibility of havens vs coastal settlements; share of hubs stateless; hubs on a border or a coast. */
  hubs: number
  havens: number
  suppressed: number
  havenD: number
  coastD: number
  hubStateless: number
  hubEdge: number
  /** Share of all towns (>= 3,000) at 2000 standing on coasts exposed to pirates (1000-2000) and on sheltered coasts, on and off (the same cells). */
  townExposedOn: number
  townShelteredOn: number
  townExposedOff: number
  townShelteredOff: number
  exposedN: number
  /** Refugee knowledge transfers. */
  refugeeTech: number
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN
  const a = xs.slice().sort((x, y) => x - y)
  return a.length % 2 ? a[(a.length - 1) >> 1] : 0.5 * (a[a.length / 2 - 1] + a[a.length / 2])
}
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

function worldPop(h: History, q: number): number {
  const S = h.settlements.length
  let t = 0
  for (let i = 0; i < S; i++) t += h.population[q * S + i]
  return t
}

/** Per polity at snapshot q: people, members (living, not outposts). */
function polityAt(h: History, q: number): { pop: Float64Array; mem: Int32Array; total: number; living: number; inside: number } {
  const S = h.settlements.length
  const P = h.polities.length
  const pop = new Float64Array(P), mem = new Int32Array(P)
  let total = 0, living = 0, inside = 0
  for (let i = 0; i < S; i++) {
    const x = h.population[q * S + i]
    if (x <= 0 || h.settlements[i].outpost) continue
    total += x
    living++
    const p = h.polity[q * S + i]
    if (p >= 0) { pop[p] += x; mem[p]++; inside++ }
  }
  return { pop, mem, total, living, inside }
}

function lineageRoot(h: History): Int32Array {
  const root = new Int32Array(h.polities.length)
  for (const p of h.polities) root[p.id] = p.parent >= 0 ? root[p.parent] : p.id
  return root
}

/** Hops from each cell to the nearest land cell on a border between two polities at snapshot q (land q2), -1 if none reachable. */
function borderHops(world: World, h: History, q: number, q2: number): Int32Array {
  const N = world.grid.cellCount
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const S = h.settlements.length
  const L = h.landCells.length
  const cellPol = new Int32Array(N).fill(-2)
  for (let k = 0; k < L; k++) {
    const o = h.territory[q2 * L + k]
    cellPol[h.landCells[k]] = o > 0 ? h.polity[q * S + o - 1] : -1
  }
  const hops = new Int32Array(N).fill(-1)
  const queue: number[] = []
  for (let c = 0; c < N; c++) {
    const a = cellPol[c]
    if (a < 0) continue
    for (let k = off[c]; k < off[c + 1]; k++) { const b = cellPol[nb[k]]; if (b >= 0 && b !== a) { hops[c] = 0; queue.push(c); break } }
  }
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]
    for (let k = off[c]; k < off[c + 1]; k++) { const j = nb[k]; if (hops[j] < 0 && world.elevation[j] >= 0) { hops[j] = hops[c] + 1; queue.push(j) } }
  }
  return hops
}

export function polityStats(world: World, run: HistoryRun, off: HistoryRun | null, ms: number, msOff: number): PolityStatRow {
  const h = run.history
  const S = h.settlements.length
  const P = h.polities.length
  const yearsQ = (y: number): number => Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval))
  const last = h.snapshotCount - 1
  const endYear = h.years
  const { defense } = buildDefense(world, run.terrain)
  // Counts by century.
  const count: number[] = []
  for (const y of [800, 1200, 1500, 1600, 2000]) {
    const a = polityAt(h, yearsQ(y))
    let n = 0
    for (let p = 0; p < P; p++) if (a.mem[p] >= 2) n++
    count.push(n)
  }
  let countMax = 0, maxSettleShare = 0
  const tierEver = new Uint8Array(P)
  const peakMem = new Int32Array(P)
  const shareSeries: Float64Array[] = []
  for (let q = 0; q <= last; q++) {
    const a = polityAt(h, q)
    let n = 0
    const sh = new Float64Array(P)
    for (let p = 0; p < P; p++) {
      if (a.mem[p] >= 2) n++
      if (a.mem[p] > peakMem[p]) peakMem[p] = a.mem[p]
      const t = tierOf(a.pop[p], a.mem[p], false, a.total)
      if (t > tierEver[p]) tierEver[p] = t
      sh[p] = a.total > 0 ? a.pop[p] / a.total : 0
      if (a.living > 0 && a.mem[p] / a.living > maxSettleShare) maxSettleShare = a.mem[p] / a.living
    }
    shareSeries.push(sh)
    if (n > countMax) countMax = n
  }
  const a1000 = polityAt(h, yearsQ(1000)), a2000 = polityAt(h, last)
  let largest = 0
  for (let p = 0; p < P; p++) if (a2000.pop[p] > largest) largest = a2000.pop[p]
  // Lifetimes.
  const kingdomLife: number[] = []
  let short = 0
  for (const p of h.polities) {
    const life = (p.endedYear >= 0 ? p.endedYear : endYear) - p.foundedYear
    if (tierEver[p.id] >= Tier.Kingdom) kingdomLife.push(life)
    if (p.endedYear >= 0 && life < 20) short++
  }
  // Lineage cores: years the root's founding capital stayed in a polity of its lineage (longest run).
  const root = lineageRoot(h)
  let coreYears = 0
  for (const p of h.polities) {
    if (p.parent >= 0) continue
    const core = p.capitals[0]
    let runY = 0
    for (let q = 0; q <= last; q++) {
      const k = h.polity[q * S + core]
      if (k >= 0 && root[k] === p.id) { runY += h.snapshotInterval; if (runY > coreYears) coreYears = runY } else runY = 0
    }
  }
  // Events.
  let formed = 0, conquered = 0, seceded = 0, raidsLogged = 0, revolts = 0
  const famineOrWar = new Int32Array(S).fill(-100000)
  for (const e of h.events) {
    if (e.type === EventType.PolityFounded && h.polities[e.value].origin === PolityOrigin.Formed) formed++
    if (e.type === EventType.Seceded) seceded++
    if (e.type === EventType.Raid) raidsLogged++
    if (e.type === EventType.Revolt) revolts++
    if (e.type === EventType.Conquered || e.type === EventType.Sacked || e.type === EventType.Raid) famineOrWar[e.settlement] = e.year
  }
  for (const p of h.polities) if (p.endCause === PolityEnd.Conquered) conquered++
  let absorbed = 0
  for (const p of h.polities) if (p.endCause === PolityEnd.Absorbed) absorbed++
  // Fragmentations: a polity of >= 15 members losing >= 40% of its members within 30 years into >= 2 successors.
  let fragmentations = 0
  const step = Math.max(1, Math.round(30 / h.snapshotInterval))
  const memSeries: Int32Array[] = []
  for (let q = 0; q <= last; q++) memSeries.push(polityAt(h, q).mem)
  for (const p of h.polities) {
    const kids = h.polities.filter((c) => c.parent === p.id)
    if (kids.length < 2) continue
    let hit = false
    for (let q = 0; q + step <= last && !hit; q++) {
      const m0 = memSeries[q][p.id]
      if (m0 < 15) continue
      const m1 = memSeries[q + step][p.id]
      if (m1 > 0.6 * m0) continue
      const y0 = q * h.snapshotInterval, y1 = (q + step) * h.snapshotInterval
      let n = 0
      for (const c of kids) if (c.foundedYear >= y0 && c.foundedYear <= y1) n++
      if (n >= 2) hit = true
    }
    if (hit) fragmentations++
  }
  // Wars.
  const W = h.wars
  const warLength: number[] = []
  const outcomes = new Array(8).fill(0)
  for (let w = 0; w < W.count; w++) {
    if (W.endYear[w] >= 0) warLength.push(W.endYear[w] - W.startYear[w])
    outcomes[W.outcome[w]]++
  }
  let polYears = 0
  for (let q = 0; q <= last; q++) { let n = 0; const m = memSeries[q]; for (let p = 0; p < P; p++) if (m[p] >= 2) n++; polYears += n * h.snapshotInterval }
  const warRate = polYears > 0 ? (W.count / (polYears / 100)) * 10 : 0
  // Revolts per century per polity of >= 10 members.
  let bigYears = 0
  for (let q = 0; q <= last; q++) { const m = memSeries[q]; for (let p = 0; p < P; p++) if (m[p] >= 10) bigYears += h.snapshotInterval }
  const diag = run.diag.polity
  const revoltRate = bigYears > 0 ? revolts / (bigYears / 100) : 0
  const revoltWin = diag && diag.revolts > 0 ? diag.revoltsWon / diag.revolts : 0
  // Population and its worst century.
  const pop2000 = worldPop(h, last)
  const popOff2000 = off ? worldPop(off.history, off.history.snapshotCount - 1) : NaN
  let worstFall = 0
  const span = Math.round(100 / h.snapshotInterval)
  for (let q = 0; q + span <= last; q++) { const a = worldPop(h, q), b = worldPop(h, q + span); if (a > 0 && 1 - b / a > worstFall) worstFall = 1 - b / a }
  let abandoned = 0, warAb = 0
  for (const st of h.settlements) {
    if (st.abandonedYear < 0 || st.outpost) continue
    abandoned++
    if (st.abandonedYear - famineOrWar[st.id] <= 10) warAb++
  }
  // Siting by danger: T of foundings on the founders' own landmass by the danger they left (and by the site's danger).
  let tHigh = 0, nHigh = 0, tLow = 0, nLow = 0, cHigh = 0, cnHigh = 0, cLow = 0, cnLow = 0
  if (diag) for (let k = 0; k < diag.foundYear.length; k++) {
    if (!diag.foundHome[k]) continue
    const z = diag.foundFromZ[k], t = diag.foundT[k], zc = diag.foundCellZ[k]
    if (z >= 0.4) { tHigh += t; nHigh++ } else if (z <= 0.1) { tLow += t; nLow++ }
    if (zc >= 0.4) { cHigh += t; cnHigh++ } else if (zc <= 0.1) { cLow += t; cnLow++ }
  }
  // Site choice against the alternatives weighed.
  let sqN = 0, sqLower = 0, sqDz = 0, sfN = 0, sfDD = 0
  if (diag && diag.siteYear) for (let k = 0; k < diag.siteYear.length; k++) {
    if (diag.siteYear[k] < 300) continue
    if (diag.siteAltZ[k] >= 0.2) { sqN++; sqDz += diag.siteZ[k] - diag.siteAltZ[k]; if (!diag.siteSame[k]) sqLower++ }
    if (diag.siteFromZ[k] >= 0.3) { sfN++; sfDD += diag.siteD[k] - diag.siteAltD[k] }
  }
  // Walls and capitals at the end.
  const walledAt = new Uint8Array(S)
  for (const x of h.structures) if (x.type === StructureType.Walls && x.lostYear < 0) walledAt[x.settlement] = 1
  const wasCapital = new Uint8Array(S), isCap = new Uint8Array(S)
  for (const p of h.polities) {
    for (const c of p.capitals) wasCapital[c] = 1
    if (p.endedYear < 0) isCap[p.capitals[p.capitals.length - 1]] = 1
  }
  let cities = 0, citiesW = 0, capCities = 0
  const order: number[] = []
  for (let i = 0; i < S; i++) {
    const x = h.population[last * S + i]
    if (x <= 0) continue
    order.push(i)
    if (x >= CITY_POPULATION) { cities++; if (walledAt[i]) citiesW++; if (isCap[i]) capCities++ }
  }
  order.sort((a, b) => h.population[last * S + b] - h.population[last * S + a])
  let topCap = 0
  const top = order.slice(0, 10)
  for (const i of top) if (wasCapital[i]) topCap++
  // Capital sizes.
  let capPop = 0, capN = 0, memPop = 0, memN = 0
  for (let i = 0; i < S; i++) {
    const x = h.population[last * S + i]
    const k = h.polity[last * S + i]
    if (x <= 0 || k < 0 || h.settlements[i].outpost) continue
    if (isCap[i]) { capPop += x; capN++ } else { memPop += x; memN++ }
  }
  // Towns on defensible sites and their distance from borders (borders of the run with polities, both runs).
  const lq = h.landSnapshotCount - 1
  const hops = borderHops(world, h, last, lq)
  const townStats = (hh: History, after: number): [number, number] => {
    const S2 = hh.settlements.length, l2 = hh.snapshotCount - 1
    let n = 0, def = 0, hs = 0, hn = 0
    for (let i = 0; i < S2; i++) {
      if (hh.population[l2 * S2 + i] < TOWN_POPULATION || hh.settlements[i].foundedYear < after) continue
      const c = hh.settlements[i].cell
      n++
      if (defense[c] >= 1.3) def++
      if (hops[c] >= 0) { hs += hops[c]; hn++ }
    }
    return [n > 0 ? def / n : NaN, hn > 0 ? hs / hn : NaN]
  }
  /** People-weighted mean T and hops from a border over all living settlements at the end. */
  const weighted = (hh: History): [number, number] => {
    const S2 = hh.settlements.length, l2 = hh.snapshotCount - 1
    let w = 0, t = 0, hw = 0, hs = 0
    for (let i = 0; i < S2; i++) {
      const x = hh.population[l2 * S2 + i]
      if (x <= 0) continue
      const c = hh.settlements[i].cell
      w += x; t += x * defense[c]
      if (hops[c] >= 0) { hw += x; hs += x * hops[c] }
    }
    return [w ? t / w : NaN, hw ? hs / hw : NaN]
  }
  const cityStats = (hh: History): [number, number, number] => {
    const S2 = hh.settlements.length, l2 = hh.snapshotCount - 1
    let big = 0, cities = 0, towns = 0
    for (let i = 0; i < S2; i++) { const x = hh.population[l2 * S2 + i]; if (x > big) big = x; if (x >= CITY_POPULATION) cities++; if (x >= TOWN_POPULATION) towns++ }
    return [big, cities, towns]
  }
  const [townsDefOn, townsBorderOn] = townStats(h, 0)
  const [townsDefOff, townsBorderOff] = off ? townStats(off.history, 0) : [NaN, NaN]
  const [lateDefOn, lateBorderOn] = townStats(h, 500)
  const [lateDefOff, lateBorderOff] = off ? townStats(off.history, 500) : [NaN, NaN]
  const [wTOn, wHopsOn] = weighted(h)
  const [wTOff, wHopsOff] = off ? weighted(off.history) : [NaN, NaN]
  const [bigOn, citiesOn, townsOn] = cityStats(h)
  const [bigOff, citiesOff, townsOff] = off ? cityStats(off.history) : [NaN, NaN, NaN]
  // Danger.
  const danger: number[] = [], dangerHigh: number[] = []
  const L = h.landCells.length
  for (const y of [800, 1200, 1600, 2000]) {
    const q2 = Math.min(h.landSnapshotCount - 1, Math.round(y / h.landInterval))
    let sum = 0, high = 0
    for (let k = 0; k < L; k++) { const z = h.danger[q2 * L + k] / 255; sum += z; if (z >= 0.4) high++ }
    danger.push(L ? sum / L : 0)
    dangerHigh.push(L ? high / L : 0)
  }
  // Churn: membership changes per settlement per century.
  const churnRates: number[] = []
  for (let i = 0; i < S; i++) {
    if (h.settlements[i].outpost) continue
    let changes = 0, alive = 0, prev = -3
    for (let q = 0; q <= last; q++) {
      if (h.population[q * S + i] <= 0) { prev = -3; continue }
      alive += h.snapshotInterval
      const k = h.polity[q * S + i]
      if (prev !== -3 && k !== prev) changes++
      prev = k
    }
    if (alive >= 100) churnRates.push(changes / (alive / 100))
  }
  // Path dependence: lineage shares 1100 vs 2000.
  const linShare = (q: number): Float64Array => {
    const a = polityAt(h, q)
    const out = new Float64Array(P)
    for (let p = 0; p < P; p++) out[root[p]] += a.total > 0 ? a.pop[p] / a.total : 0
    return out
  }
  const l1100 = linShare(yearsQ(1100)), l2000 = linShare(last)
  const xs: number[] = [], ys: number[] = []
  for (let p = 0; p < P; p++) if (root[p] === p && (l1100[p] > 0 || l2000[p] > 0)) { xs.push(l1100[p]); ys.push(l2000[p]) }
  const pathDep = xs.length >= 3 ? spearman(xs, ys) : NaN
  // Snowball: the polity with the highest share at any snapshot up to 300 years before the end; did it fall >= 30% within 300 years?
  let peak = 0, peakP = -1, peakQ = 0
  const qMax = Math.max(0, last - Math.round(300 / h.snapshotInterval))
  for (let q = 0; q <= qMax; q++) for (let p = 0; p < P; p++) if (shareSeries[q][p] > peak) { peak = shareSeries[q][p]; peakP = p; peakQ = q }
  let fell = false
  const horizon = Math.round(300 / h.snapshotInterval)
  if (peakP >= 0) for (let q = peakQ; q <= Math.min(last, peakQ + horizon); q++) if (shareSeries[q][peakP] <= 0.7 * peak) fell = true
  // Tiny polities.
  let ever2 = 0, tiny = 0
  for (let p = 0; p < P; p++) { if (peakMem[p] < 2) continue; ever2++; if (peakMem[p] <= 3) tiny++ }
  let first = -1
  for (const p of h.polities) { first = p.foundedYear; break }
  const v2 = polityV2(world, run, off, shareSeries)
  return {
    v2,
    seed: world.seed, ms, msOff, firstYear: first, count, countMax, maxSettleShare,
    inside1000: a1000.living ? a1000.inside / a1000.living : 0, inside2000: a2000.living ? a2000.inside / a2000.living : 0,
    popInside2000: a2000.total ? sumArr(a2000.pop) / a2000.total : 0,
    largest2000: a2000.total ? largest / a2000.total : 0,
    kingdomLife, shortShare: P ? short / P : 0, coreYears, formed, conquered, seceded, fragmentations, absorbed,
    wars: W.count, warRate, warLength, outcomes, pop2000, popOff2000, worstFall, warAbandon: abandoned ? warAb / abandoned : 0,
    revoltRate, revoltWin, siteT: nHigh && nLow ? tHigh / nHigh - tLow / nLow : NaN, siteCellT: cnHigh && cnLow ? cHigh / cnHigh - cLow / cnLow : NaN, siteHigh: nHigh, siteLow: nLow,
    siteQuieter: sqN ? sqLower / sqN : NaN, siteDz: sqN ? sqDz / sqN : NaN, siteDD: sfN ? sfDD / sfN : NaN, siteAltN: sqN, siteFearN: sfN,
    citiesWalled: cities ? citiesW / cities : NaN, topCapitals: top.length ? topCap / top.length : 0,
    townsDefOn, townsDefOff, townsBorderOn, townsBorderOff, lateDefOn, lateDefOff, lateBorderOn, lateBorderOff, wTOn, wTOff, wHopsOn, wHopsOff, bigOn, bigOff, citiesOn, citiesOff, townsOn, townsOff, danger, dangerHigh,
    capitalRatio: capN && memN ? capPop / capN / (memPop / memN) : NaN, capitalsCities: cities ? capCities / cities : NaN,
    churn: median(churnRates), pathDep, peakShare: peak, peakFell: fell, tinyShare: ever2 ? tiny / ever2 : 0,
    raidsLogged, raidsSmall: sumRaids(h), diag: diag ? { raids: diag.raids, raidsWon: diag.raidsWon, revolts: diag.revolts, revoltsWon: diag.revoltsWon, frag: diag.fragmentations, absorbed: diag.absorbed, warDead: diag.warDead, sackDead: diag.sackDead, raidDead: diag.raidDead } : {},
  }
}

/** Overlord of each polity at year y from the bonds table (-1 none). */
export function overlordsAt(h: History, y: number): Int32Array {
  const out = new Int32Array(h.polities.length).fill(-1)
  const B = h.bonds
  for (let k = 0; k < B.count; k++) {
    if (B.kind[k] !== BondKind.Vassal || B.startYear[k] > y || (B.endYear[k] >= 0 && B.endYear[k] <= y)) continue
    out[B.a[k]] = B.b[k]
  }
  return out
}

/** Exposure of coastal land cells to pirates over years 1000..end (mean of the land snapshots): havens' strength fading over 6 sea hops. */
function pirateExposure(world: World, h: History): Float64Array {
  const N = world.grid.cellCount
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const sea = (c: number): boolean => world.elevation[c] < 0
  const E = new Float64Array(N)
  const S = h.settlements.length
  const mark = new Int32Array(N).fill(-1)
  let samples = 0, run = 0
  for (let y = 1000; y <= h.years; y += 20) {
    const q = Math.floor(y / h.snapshotInterval)
    samples++
    for (let i = 0; i < S; i++) {
      const x = h.piracy[q * S + i] / 255
      if (!(x > 0.05)) continue
      run++
      let ring: number[] = []
      const c0 = h.settlements[i].cell
      mark[c0] = run
      for (let k = off[c0]; k < off[c0 + 1]; k++) { const j = nb[k]; if (sea(j)) { mark[j] = run; ring.push(j) } }
      for (let hop = 1; hop <= 6 && ring.length; hop++) {
        const z = x * (1 - (hop - 1) / 6)
        const next: number[] = []
        for (const c of ring) for (let k = off[c]; k < off[c + 1]; k++) { const j = nb[k]; if (mark[j] === run) continue; mark[j] = run; if (sea(j)) next.push(j); else E[j] += z }
        ring = next
      }
    }
  }
  if (samples) for (let c = 0; c < N; c++) E[c] /= samples
  return E
}

function polityV2(world: World, run: HistoryRun, off: HistoryRun | null, shareSeries: Float64Array[]): PolityV2Row {
  const h = run.history
  const S = h.settlements.length
  const P = h.polities.length
  const last = h.snapshotCount - 1
  const cnt = (t: number): number => h.events.reduce((n, e) => n + (e.type === t ? 1 : 0), 0)
  const B = h.bonds
  let vassals = 0, tributes = 0, alliances = 0, freed = 0
  for (let k = 0; k < B.count; k++) { if (B.kind[k] === BondKind.Vassal) vassals++; else if (B.kind[k] === BondKind.Tribute) tributes++; else alliances++; if (B.end[k] === BondEnd.Freed) freed++ }
  let forts = 0
  for (const x of h.structures) if (x.type === StructureType.Fort) forts++
  // Spheres: a state with its vassals.
  let sphereMax = 0, sphereQ = 0, sphereP = -1, stateMax = 0
  const sphereSeries: Float64Array[] = []
  const q800 = Math.min(last, Math.floor(800 / h.snapshotInterval)) // (shares of a tiny early world do not count)
  for (let q = 0; q <= last; q++) {
    const ov = overlordsAt(h, q * h.snapshotInterval)
    const sh = shareSeries[q]
    const sp = new Float64Array(P)
    for (let p = 0; p < P; p++) { sp[ov[p] >= 0 ? ov[p] : p] += sh[p]; if (q >= q800 && sh[p] > stateMax) stateMax = sh[p] }
    sphereSeries.push(sp)
    if (q >= q800) for (let p = 0; p < P; p++) if (sp[p] > sphereMax) { sphereMax = sp[p]; sphereQ = q; sphereP = p }
  }
  let sphereFell = false
  if (sphereP >= 0) for (let q = sphereQ; q <= Math.min(last, sphereQ + Math.round(300 / h.snapshotInterval)); q++) if (sphereSeries[q][sphereP] <= 0.7 * sphereMax) sphereFell = true
  // Revenue, contraband, losses over 1500-2000.
  const d = run.diag.polity
  let rev = 0, inc = 0, leg = 0, smug = 0, pir = 0, band = 0, vol = 0
  if (d) for (let y = 1500; y < Math.min(h.years, 2000); y++) { rev += d.yRev[y] ?? 0; inc += d.yCapInc[y] ?? 0; leg += d.yLegal[y] ?? 0; smug += d.ySmug[y] ?? 0; pir += d.yPir[y] ?? 0; band += d.yBand[y] ?? 0 }
  const RC = h.trade.count
  for (let t = Math.floor(1500 / h.tradeInterval); t < h.tradeSnapshotCount; t++) for (let r = 0; r < RC; r++) vol += h.tradeVolume[t * RC + r] * h.tradeInterval
  let tsum = 0, tn = 0
  for (let p = 0; p < P; p++) { const x = h.tariff[last * P + p]; if (h.polities[p].endedYear < 0) { tsum += x / 255; tn++ } }
  // Hubs and havens: where they are.
  const T = run.terrain
  const { defenseD } = buildDefense(world, T)
  let hubs = 0, hubStateless = 0, hubEdge = 0, havens = 0, havenD = 0
  for (const e of h.events) {
    if (e.type === EventType.SmugglingRing) {
      hubs++
      const q = Math.min(last, Math.floor(e.year / h.snapshotInterval))
      if (h.polity[q * S + e.settlement] < 0) hubStateless++
      if (T.seaCoast[h.settlements[e.settlement].cell] || defenseD[h.settlements[e.settlement].cell] > 0) hubEdge++
    } else if (e.type === EventType.PiratesRise) { havens++; havenD += defenseD[h.settlements[e.settlement].cell] }
  }
  let coastD = 0, coastN = 0
  for (let i = 0; i < S; i++) if (h.population[last * S + i] > 0 && T.seaCoast[h.settlements[i].cell]) { coastD += defenseD[h.settlements[i].cell]; coastN++ }
  // Pirates and coastal towns.
  const E = pirateExposure(world, h)
  // (the havens' own cells are left out: the comparison is of the coasts they prey on)
  const nest = new Uint8Array(world.grid.cellCount)
  for (let q = 0; q <= last; q++) for (let i = 0; i < S; i++) if (h.piracy[q * S + i] > 13) nest[h.settlements[i].cell] = 1
  // Share of all towns (>= 3,000) at 2000 that stand on exposed coasts, and on sheltered coasts (the havens' own cells left out).
  const coastTowns = (hh: History): [number, number, number, number] => {
    const S2 = hh.settlements.length, l2 = hh.snapshotCount - 1
    let all = 0, et = 0, st = 0, en = 0
    for (let i = 0; i < S2; i++) {
      const x = hh.population[l2 * S2 + i]
      const c = hh.settlements[i].cell
      if (x <= 0 || hh.settlements[i].outpost) continue
      if (T.seaCoast[c] && !nest[c] && E[c] >= 0.05) en++
      if (x < TOWN_POPULATION) continue
      all++
      if (!T.seaCoast[c] || nest[c]) continue
      if (E[c] >= 0.05) et++
      else if (E[c] < 0.01) st++
    }
    return [all ? et / all : NaN, all ? st / all : NaN, en, 0]
  }
  const [eOn, sOn, nE] = coastTowns(h)
  const [eOff, sOff] = off ? coastTowns(off.history) : [NaN, NaN]
  return {
    civilWars: cnt(EventType.CivilWar), partitions: cnt(EventType.Partitioned), reunified: cnt(EventType.Reunified), vassals, tributes, alliances, freed, forts, blockades: cnt(EventType.Blockade),
    sphereMax, sphereYear: sphereQ * h.snapshotInterval, sphereFell, stateMax,
    revShare: inc > 0 ? rev / inc : NaN, smugShare: leg + smug > 0 ? smug / (leg + smug) : NaN, tariff2000: tn ? tsum / tn : NaN,
    pirLoss: leg + smug > 0 ? pir / (leg + smug) : NaN, bandLoss: vol > 0 ? band / vol : NaN,
    hubs, havens, suppressed: cnt(EventType.PiratesSuppressed), havenD: havens ? havenD / havens : NaN, coastD: coastN ? coastD / coastN : NaN,
    hubStateless: hubs ? hubStateless / hubs : NaN, hubEdge: hubs ? hubEdge / hubs : NaN,
    townExposedOn: eOn, townShelteredOn: sOn, townExposedOff: eOff, townShelteredOff: sOff, exposedN: nE, refugeeTech: d ? d.refugeeTech : 0,
  }
}

/** The v2 table: per seed and the targets. */
export function formatPolityV2(rows: PolityStatRow[]): string {
  const n = rows.length
  const out: string[] = []
  out.push('seed  civil part reun  vass trib ally freed forts block  sphere  year fell state  rev/inc smug/x tariff pirLoss bandLoss hubs havens supp havenD coastD hubSL hubEdge  townExp/Shel on   off   nExp refTech')
  for (const r of rows) {
    const v = r.v2
    out.push([pad(r.seed, 6), pad(v.civilWars, 5), pad(v.partitions, 4), pad(v.reunified, 4), pad(v.vassals, 5), pad(v.tributes, 4), pad(v.alliances, 4), pad(v.freed, 5), pad(v.forts, 5), pad(v.blockades, 5),
      pad(f2(v.sphereMax), 7), pad(v.sphereYear, 5), pad(v.sphereFell ? 'y' : 'n', 4), pad(f2(v.stateMax), 5), pad(f2(v.revShare), 8), pad(f2(v.smugShare), 6), pad(f2(v.tariff2000), 6), pad(f2(v.pirLoss), 7), pad(f2(v.bandLoss), 8),
      pad(v.hubs, 4), pad(v.havens, 6), pad(v.suppressed, 4), pad(f2(v.havenD), 6), pad(f2(v.coastD), 6), pad(f2(v.hubStateless), 5), pad(f2(v.hubEdge), 7),
      pad(f2(v.townExposedOn) + '/' + f2(v.townShelteredOn), 14), pad(f2(v.townExposedOff) + '/' + f2(v.townShelteredOff), 10), pad(v.exposedN, 5), pad(v.refugeeTech, 6)].join(' '))
  }
  const col = (f: (r: PolityStatRow) => number): number[] => rows.map(f).filter((x) => Number.isFinite(x))
  const cnt = (f: (r: PolityStatRow) => boolean): string => `${rows.filter(f).length}/${n}`
  const rng = (xs: number[]): string => (xs.length ? `${f2(Math.min(...xs))}..${f2(Math.max(...xs))} (median ${f2(median(xs))})` : '-')
  const t: [string, string, string][] = [
    ['Great empire: a state or hegemon sphere >= 0.40 (from 800)', '>= 2/20', `${cnt((r) => r.v2.sphereMax >= 0.4)} (state alone ${cnt((r) => r.v2.stateMax >= 0.4)}); sphere max ${rng(col((r) => r.v2.sphereMax))}`],
    ['  ... and it fell >= 30% within 300 years', 'all of them', `${cnt((r) => r.v2.sphereMax >= 0.4 && r.v2.sphereFell)}`],
    ['Civil wars per world', 'some in larger states', `${rng(col((r) => r.v2.civilWars))}; worlds with any ${cnt((r) => r.v2.civilWars > 0)}`],
    ['Partitions / reunifications (sum)', 'both occur', `${sum(rows, (r) => r.v2.partitions)} / ${sum(rows, (r) => r.v2.reunified)}; worlds with a partition ${cnt((r) => r.v2.partitions > 0)}, a reunification ${cnt((r) => r.v2.reunified > 0)}`],
    ['Vassals / tributes / alliances / freed (sum)', '(info)', `${sum(rows, (r) => r.v2.vassals)} / ${sum(rows, (r) => r.v2.tributes)} / ${sum(rows, (r) => r.v2.alliances)} / ${sum(rows, (r) => r.v2.freed)}`],
    ['Duty revenue / capitals\' income 1500-2000', 'visible part', rng(col((r) => r.v2.revShare))],
    ['Contraband / value crossing restricted borders', '0.05-0.20', rng(col((r) => r.v2.smugShare))],
    ['Mean tariff y2000', '(info)', rng(col((r) => r.v2.tariff2000))],
    ['Lost to pirates / restricted value; to bandits / route volume', '(info)', `${rng(col((r) => r.v2.pirLoss))}; ${rng(col((r) => r.v2.bandLoss))}`],
    ['Smugglers\' hubs per world (SmugglingRing)', 'a handful', `${rng(col((r) => r.v2.hubs))}; stateless share ${f2(median(col((r) => r.v2.hubStateless)))}, on a coast or rough site ${f2(median(col((r) => r.v2.hubEdge)))}`],
    ['Pirate havens per world (PiratesRise) / suppressed', 'a handful', `${rng(col((r) => r.v2.havens))} / ${sum(rows, (r) => r.v2.suppressed)} suppressed`],
    ['  havens\' defensibility vs coastal settlements', 'havens > coast', `${f2(median(col((r) => r.v2.havenD)))} vs ${f2(median(col((r) => r.v2.coastD)))}`],
    ['Share of towns >= 3k on exposed / sheltered coasts', 'exposed lower than off', `on ${f2(median(col((r) => r.v2.townExposedOn)))} / ${f2(median(col((r) => r.v2.townShelteredOn)))}, off ${f2(median(col((r) => r.v2.townExposedOff)))} / ${f2(median(col((r) => r.v2.townShelteredOff)))}; exposed on < off in ${rows.filter((r) => r.v2.townExposedOn < r.v2.townExposedOff).length}/${n}, exposed/sheltered on < off in ${rows.filter((r) => r.v2.townExposedOn * r.v2.townShelteredOff < r.v2.townExposedOff * r.v2.townShelteredOn).length}/${n}`],
    ['Forts / blockades (sum)', '(info)', `${sum(rows, (r) => r.v2.forts)} / ${sum(rows, (r) => r.v2.blockades)}`],
  ]
  out.push('')
  out.push('Measure (v2)'.padEnd(60) + 'Target'.padEnd(34) + 'Result')
  for (const [a, b, c] of t) out.push(a.padEnd(60) + b.padEnd(34) + c)
  return out.join('\n')
}

function sumArr(a: Float64Array): number { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t }
function sumRaids(h: History): number { let t = 0; for (let i = 0; i < h.raids.count; i++) t += h.raids.raids[i]; return t }

const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '  - ')
const f0 = (x: number): string => (Number.isFinite(x) ? x.toFixed(0) : '-')
const pad = (s: string | number, n: number): string => String(s).padStart(n)

/** The target table across seeds: measure, target, result, verdict. */
export function formatPolityStats(rows: PolityStatRow[]): string {
  const n = rows.length
  const out: string[] = []
  out.push('seed    ms   off  first  n800 n1200 n1600 n2000  max  in1000 in2000 popIn largest  kLife  short core  form conq sec frag abs  wars rate  wlen  pop/off worst warAb  revR  win  siteT walled topCap  churn  path  peak fell tiny')
  for (const r of rows) {
    out.push([pad(r.seed, 6), pad(f0(r.ms), 5), pad(f0(r.msOff), 5), pad(r.firstYear, 6), pad(r.count[0], 5), pad(r.count[1], 5), pad(r.count[3], 5), pad(r.count[4], 5), pad(r.countMax, 4),
      pad(f2(r.inside1000), 7), pad(f2(r.inside2000), 6), pad(f2(r.popInside2000), 5), pad(f2(r.largest2000), 7), pad(f0(median(r.kingdomLife)), 6), pad(f2(r.shortShare), 6), pad(r.coreYears, 4),
      pad(r.formed, 5), pad(r.conquered, 4), pad(r.seceded, 3), pad(r.fragmentations, 4), pad(r.absorbed, 3), pad(r.wars, 5), pad(f2(r.warRate), 4), pad(f0(median(r.warLength)), 5),
      pad(f2(r.pop2000 / r.popOff2000), 8), pad(f2(r.worstFall), 5), pad(f2(r.warAbandon), 5), pad(f2(r.revoltRate), 5), pad(f2(r.revoltWin), 4), pad(f2(r.siteT), 6), pad(f2(r.citiesWalled), 6), pad(f2(r.topCapitals), 6),
      pad(f2(r.churn), 6), pad(f2(r.pathDep), 5), pad(f2(r.peakShare), 5), pad(r.peakFell ? 'y' : 'n', 4), pad(f2(r.tinyShare), 4)].join(' '))
  }
  const col = (f: (r: PolityStatRow) => number): number[] => rows.map(f).filter((x) => Number.isFinite(x))
  const cnt = (f: (r: PolityStatRow) => boolean): string => `${rows.filter(f).length}/${n}`
  const rng = (xs: number[]): string => `${f2(Math.min(...xs))}..${f2(Math.max(...xs))} (median ${f2(median(xs))})`
  const lives = rows.flatMap((r) => r.kingdomLife)
  const lens = rows.flatMap((r) => r.warLength)
  const t: [string, string, string][] = [
    ['First polity founded', 'year 350-900 (median ~600)', `${rng(col((r) => r.firstYear))}`],
    ['  by year 900 / by 1200', '>= 18/20 / all', `${cnt((r) => r.firstYear >= 0 && r.firstYear <= 900)} / ${cnt((r) => r.firstYear >= 0 && r.firstYear <= 1200)}`],
    ['Polities >= 2 members y800', '2-15', rng(col((r) => r.count[0]))],
    ['  y1200', '8-30', rng(col((r) => r.count[1]))],
    ['  y1600', '12-45', rng(col((r) => r.count[3]))],
    ['  y2000', '12-50', rng(col((r) => r.count[4]))],
    ['  never > 80', 'all', cnt((r) => r.countMax <= 80)],
    ['  >= 3 at y1500 (no world state)', '>= 19/20', cnt((r) => r.count[2] >= 3)],
    ['  >= 5 at y1500', '>= 18/20', cnt((r) => r.count[2] >= 5)],
    ['Settlements inside polities y1000', '0.20-0.50', rng(col((r) => r.inside1000))],
    ['  y2000', '0.55-0.85', rng(col((r) => r.inside2000))],
    ['  stateless >= 10% at y2000', '>= 18/20', cnt((r) => r.inside2000 <= 0.9)],
    ['People inside polities y2000', '(info)', rng(col((r) => r.popInside2000))],
    ['Largest polity share y2000', 'median 0.15-0.30, <= 0.60 all', rng(col((r) => r.largest2000))],
    ['  >= 0.40 (a great empire)', '>= 2/20', cnt((r) => r.largest2000 >= 0.4)],
    ['  >= 0.40 of settlements at any time', '>= 2/20', `${cnt((r) => r.maxSettleShare >= 0.4)} (max share median ${f2(median(col((r) => r.maxSettleShare)))})`],
    ['Lifetimes of Kingdoms+ (years)', 'median 120-300', `median ${f0(median(lives))}, mean ${f0(mean(lives))}, n ${lives.length}`],
    ['  polities ending < 20 years', '<= 0.30', rng(col((r) => r.shortShare))],
    ['Lineage holding its core >= 500 y', '>= 10/20', cnt((r) => r.coreYears >= 500)],
    ['Fragmentation (>= 15 members, -40% in 30 y, >= 2 successors)', '>= 15/20 with >= 1', cnt((r) => r.fragmentations >= 1)],
    ['Wars per century per 10 polities', '2-8', rng(col((r) => r.warRate))],
    ['War length (years)', 'median 3-15; <= 10% > 30', `median ${f0(median(lens))}, > 30: ${f2(lens.filter((x) => x > 30).length / Math.max(1, lens.length))}`],
    ['World pop y2000 / polities off', '>= 0.85', rng(col((r) => r.pop2000 / r.popOff2000))],
    ['Worst 100-year world decline', '<= 0.20', rng(col((r) => r.worstFall))],
    ['Abandonments within 10 y of war/raid', '<= 0.15', rng(col((r) => r.warAbandon))],
    ['Revolts per century per polity >= 10 members', '0.5-3', rng(col((r) => r.revoltRate))],
    ['  share won', '0.25-0.50', rng(col((r) => r.revoltWin))],
    ['Founding T: founders\' danger >= 0.4 minus <= 0.1 (home landmass)', '>= 0.15', rng(col((r) => r.siteT))],
    ['  by the site\'s own danger', '(info)', rng(col((r) => r.siteCellT))],
    ['Foundings whose best site without danger was in danger >= 0.2: share that went elsewhere', '>= 0.5', rng(col((r) => r.siteQuieter))],
    ['  danger chosen minus that site\'s', '<= -0.1', rng(col((r) => r.siteDz))],
    ['  founders in danger >= 0.3: defensibility chosen minus that site\'s', '> 0', rng(col((r) => r.siteDD))],
    ['Cities >= 10k walled y2000', '0.40-0.90', rng(col((r) => r.citiesWalled))],
    ['Top-10 cities that are or were capitals', '>= 0.50', rng(col((r) => r.topCapitals))],
    ['Churn: changes per settlement per century', 'median <= 1.0', rng(col((r) => r.churn))],
    ['Path dependence (Spearman lineage share 1100 vs 2000)', 'median <= 0.7', rng(col((r) => r.pathDep))],
    ['Snowball: peak share (by 1700) fell >= 30% within 300 y', '>= 12/20', cnt((r) => r.peakFell)],
    ['Towns >= 3k on defensible sites (T >= 1.3): on vs off', 'on > off', `on ${f2(median(col((r) => r.townsDefOn)))} off ${f2(median(col((r) => r.townsDefOff)))}`],
    ['Towns >= 3k: hops from a border, on vs off', 'on > off', `on ${f2(median(col((r) => r.townsBorderOn)))} off ${f2(median(col((r) => r.townsBorderOff)))}`],
    ['  towns founded after 500: defensible, on vs off', 'on > off', `on ${f2(median(col((r) => r.lateDefOn)))} off ${f2(median(col((r) => r.lateDefOff)))}`],
    ['  towns founded after 500: hops from a border, on vs off', 'on > off', `on ${f2(median(col((r) => r.lateBorderOn)))} off ${f2(median(col((r) => r.lateBorderOff)))}`],
    ['People-weighted T of settlements y2000, on vs off', 'on > off', `on ${f2(median(col((r) => r.wTOn)))} off ${f2(median(col((r) => r.wTOff)))} (on > off in ${rows.filter((r) => r.wTOn > r.wTOff).length}/${n})`],
    ['People-weighted hops from a border y2000, on vs off', 'on > off', `on ${f2(median(col((r) => r.wHopsOn)))} off ${f2(median(col((r) => r.wHopsOff)))} (on > off in ${rows.filter((r) => r.wHopsOn > r.wHopsOff).length}/${n})`],
    ['Largest settlement y2000 on / off', '(range 35-78k)', `${f0(median(col((r) => r.bigOn)))} / ${f0(median(col((r) => r.bigOff)))}`],
    ['Cities >= 10k / towns >= 3k y2000, on / off', '8-27 / 35-58', `${f0(median(col((r) => r.citiesOn)))} / ${f0(median(col((r) => r.townsOn)))} vs ${f0(median(col((r) => r.citiesOff)))} / ${f0(median(col((r) => r.townsOff)))}`],
    ['Mean land danger y800/1200/1600/2000', '(info)', [0, 1, 2, 3].map((k) => f2(median(col((r) => r.danger[k])))).join(' ')],
    ['Land danger >= 0.4 share', '(info)', [0, 1, 2, 3].map((k) => f2(median(col((r) => r.dangerHigh[k])))).join(' ')],
    ['Capital / member mean people y2000', '(info) > 1', rng(col((r) => r.capitalRatio))],
    ['Cities >= 10k that are capitals y2000', '(info)', rng(col((r) => r.capitalsCities))],
    ['Tiny polities (peak <= 3 members)', '(failure mode: many)', rng(col((r) => r.tinyShare))],
    ['Formed / conquered / seceded / fragmented / absorbed (sum)', '(info)', `${sum(rows, (r) => r.formed)} / ${sum(rows, (r) => r.conquered)} / ${sum(rows, (r) => r.seceded)} / ${sum(rows, (r) => r.fragmentations)} / ${sum(rows, (r) => r.absorbed)}`],
    ['War outcomes white / att / def / conquest / ongoing', '(info)', [WarOutcome.WhitePeace, WarOutcome.AttackerGains, WarOutcome.DefenderGains, WarOutcome.Conquest, WarOutcome.Ongoing].map((o) => sum(rows, (r) => r.outcomes[o])).join(' / ')],
    ['Raids: logged events / small (summarised)', '(event flood check)', `${sum(rows, (r) => r.raidsLogged)} / ${sum(rows, (r) => r.raidsSmall)}`],
    ['Timing ms: median on / off', '+<= 200', `${f0(median(col((r) => r.ms)))} / ${f0(median(col((r) => r.msOff)))}`],
  ]
  out.push('')
  out.push('Measure'.padEnd(60) + 'Target'.padEnd(34) + 'Result')
  for (const [a, b, c] of t) out.push(a.padEnd(60) + b.padEnd(34) + c)
  return out.join('\n')
}

function sum(rows: PolityStatRow[], f: (r: PolityStatRow) => number): number {
  let t = 0
  for (const r of rows) t += f(r)
  return t
}

// --- Timelines, successor trees and maps ----------------------------------------------------------

const TIER_WORD = ['Chiefdom', 'Kingdom', 'Empire']
const ORIGIN_WORD = ['formed', 'revolt', 'fragment', 'colonial', 'partition', 'civil war', 'league']
const END_WORD = ['alive', 'conquered', 'fragmented', 'dwindled', 'reunified', 'absorbed']
const QUAL_WORD = ['', 'North ', 'South ', 'East ', 'West ', 'New ', 'Upper ', 'Lower ', 'Restored ']

export function polityTimeline(h: History, minPeak = 6): string {
  const P = h.polities.length
  const last = h.snapshotCount - 1
  const peak = new Int32Array(P), peakPop = new Float64Array(P), peakYear = new Int32Array(P), tier = new Uint8Array(P)
  for (let q = 0; q <= last; q++) {
    const a = polityAt(h, q)
    for (let p = 0; p < P; p++) {
      if (a.mem[p] > peak[p]) { peak[p] = a.mem[p]; peakYear[p] = q * h.snapshotInterval }
      if (a.pop[p] > peakPop[p]) peakPop[p] = a.pop[p]
      const t = tierOf(a.pop[p], a.mem[p], false, a.total)
      if (t > tier[p]) tier[p] = t
    }
  }
  const name = (p: number): string => QUAL_WORD[h.polities[p].qualifier] + h.polities[p].name
  const lines: string[] = []
  const W = h.wars
  for (const p of h.polities) {
    if (peak[p.id] < minPeak) continue
    const cap = h.settlements[p.capitals[0]].name
    let s = `${pad(p.foundedYear, 4)}  ${TIER_WORD[tier[p.id]]} of ${name(p.id)} (#${p.id}) at ${cap}, ${ORIGIN_WORD[p.origin]}`
    if (p.parent >= 0) s += ` from ${name(p.parent)} (#${p.parent})`
    s += `; peak ${peak[p.id]} settlements in ${peakYear[p.id]}, ${f0(peakPop[p.id])} people`
    if (p.capitals.length > 1) s += `; capitals ${p.capitals.map((c, k) => h.settlements[c].name + ' ' + p.capitalYears[k]).join(', ')}`
    const att: string[] = [], def: string[] = []
    for (let w = 0; w < W.count; w++) {
      const o = ['?', 'white', 'won', 'lost', 'conquest', 'tribute', 'vassalage', 'reunified'][W.outcome[w]] + (W.kind[w] === 1 ? ' (civil war)' : '')
      if (W.attacker[w] === p.id) att.push(`${W.startYear[w]}-${W.endYear[w] < 0 ? '' : W.endYear[w]} vs ${name(W.defender[w])} ${o}`)
      if (W.defender[w] === p.id) def.push(`${W.startYear[w]} by ${name(W.attacker[w])}`)
    }
    if (att.length) s += `\n        attacked: ${att.slice(0, 8).join('; ')}${att.length > 8 ? ` (+${att.length - 8})` : ''}`
    if (def.length) s += `\n        attacked by: ${def.slice(0, 8).join('; ')}${def.length > 8 ? ` (+${def.length - 8})` : ''}`
    s += `\n        ${p.endedYear >= 0 ? `ended ${p.endedYear}: ${END_WORD[p.endCause]}` : 'alive at the end'}`
    lines.push(s)
  }
  // Successor trees of lineages with at least one large member.
  const kids: number[][] = h.polities.map(() => [])
  for (const p of h.polities) if (p.parent >= 0) kids[p.parent].push(p.id)
  const tree: string[] = []
  const walk = (p: number, depth: number): void => {
    const x = h.polities[p]
    tree.push(`${'  '.repeat(depth)}${name(p)} #${p} ${x.foundedYear}-${x.endedYear < 0 ? '' : x.endedYear} [${ORIGIN_WORD[x.origin]}, peak ${peak[p]}]`)
    if (depth < 6) for (const c of kids[p]) walk(c, depth + 1)
  }
  for (const p of h.polities) {
    if (p.parent >= 0 || kids[p.id].length === 0) continue
    let big = false
    const stack = [p.id]
    while (stack.length) { const x = stack.pop() as number; if (peak[x] >= 10) big = true; stack.push(...kids[x]) }
    if (big) walk(p.id, 0)
  }
  return lines.join('\n') + '\n\nSuccessor trees (lineages with a polity of >= 10 settlements):\n' + tree.join('\n') + '\n\nv2 chronicle:\n' + v2Chronicle(h, peak, minPeak)
}

const GOOD_WORD = ['grain', 'fish', 'livestock', 'timber', 'ore', 'salt', 'cloth', 'luxuries', 'stimulants']

/** The v2 events in order, as chronicle lines (bonds and civil wars of polities that reached minPeak settlements; every pirate and smuggler event). */
export function v2Chronicle(h: History, peak: Int32Array, minPeak: number): string {
  const name = (p: number): string => QUAL_WORD[h.polities[p].qualifier] + h.polities[p].name
  const sn = (id: number): string => (id >= 0 ? h.settlements[id].name : '-')
  const polOf = (id: number, y: number): number => { const q = Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval)); return id >= 0 ? h.polity[q * h.settlements.length + id] : -1 }
  const out: string[] = []
  for (const e of h.events) {
    let line = ''
    switch (e.type) {
      case EventType.CivilWar: { const a = h.wars.attacker[e.value], d = h.wars.defender[e.value]; if (peak[d] >= minPeak || peak[a] >= minPeak) line = `civil war: ${sn(e.settlement)} rose against ${sn(e.other)}; ${name(a)} (#${a}) against ${name(d)} (#${d}), war #${e.value} ended ${h.wars.endYear[e.value] < 0 ? 'not yet' : h.wars.endYear[e.value] + ' ' + ['?', 'white peace', 'pretender gained', 'crown gained', 'conquest', 'tribute', 'vassalage', 'reunified'][h.wars.outcome[e.value]]}`; break }
      case EventType.Partitioned: line = `${name(e.value)} (#${e.value}) partitioned among heirs at ${sn(e.settlement)}`; break
      case EventType.Reunified: { const x = polOf(e.settlement, e.year); line = `${x >= 0 ? name(x) + ' (#' + x + ')' : sn(e.settlement)} reunified ${name(e.value)} (#${e.value}, last capital ${sn(e.other)})`; break }
      case EventType.BecameVassal: { const b = e.value % 1000, a = polOf(e.settlement, e.year); if (peak[b] >= minPeak || (a >= 0 && peak[a] >= minPeak)) line = `${a >= 0 ? name(a) + ' (#' + a + ')' : sn(e.settlement)} ${e.extra === 1 ? 'threw off its bond to' : e.value >= 1000 ? 'pays tribute to' : 'became the vassal of'} ${name(b)} (#${b})`; break }
      case EventType.Alliance: { const a = polOf(e.settlement, e.year); if (peak[e.value] >= minPeak || (a >= 0 && peak[a] >= minPeak)) line = `alliance: ${a >= 0 ? name(a) : sn(e.settlement)} and ${name(e.value)} against ${e.extra !== undefined && e.extra >= 0 ? name(e.extra) : '?'}`; break }
      case EventType.SmugglingRing: line = `smugglers' hub at ${sn(e.settlement)} (${polOf(e.settlement, e.year) >= 0 ? 'in ' + name(polOf(e.settlement, e.year)) : 'stateless'}): ${GOOD_WORD[e.value] ?? '?'}, evading ${e.other >= 0 ? sn(e.other) : '-'}`; break
      case EventType.PiratesRise: line = `pirates rise at ${sn(e.settlement)} (${polOf(e.settlement, e.year) >= 0 ? 'in ' + name(polOf(e.settlement, e.year)) : 'stateless'})${e.value >= 0 ? `, striking the lane ${sn(h.trade.a[e.value])}-${sn(h.trade.b[e.value])}` : ''}`; break
      case EventType.PiratesSuppressed: line = `pirates of ${sn(e.settlement)} put down by the fleets of ${sn(e.other)}`; break
      case EventType.Blockade: { const a = h.wars.attacker[e.value]; if (peak[a] >= minPeak || peak[h.wars.defender[e.value]] >= minPeak) line = `${name(a)} blockades ${sn(e.settlement)} (war #${e.value})`; break }
      default: break
    }
    if (line) out.push(`${pad(e.year, 4)}  ${line}`)
  }
  return out.join('\n')
}

/** Equirectangular map of territory at `year`: one letter per polity (largest first), '.' stateless land. */
export function asciiPolityMap(world: World, h: History, year: number, W = 120, H = 40): string {
  const Pp = world.grid.positions
  const S = h.settlements.length
  const q = Math.min(h.snapshotCount - 1, Math.floor(year / h.snapshotInterval))
  const lq = Math.min(h.landSnapshotCount - 1, Math.round(year / h.landInterval))
  const L = h.landCells.length
  const a = polityAt(h, q)
  const order: number[] = []
  for (let p = 0; p < h.polities.length; p++) if (a.mem[p] > 0) order.push(p)
  order.sort((x, y) => a.pop[y] - a.pop[x])
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const letter = new Map<number, string>()
  order.forEach((p, i) => letter.set(p, i < letters.length ? letters[i] : '+'))
  const grid: string[] = new Array(W * H).fill(' ')
  const rank = new Float64Array(W * H).fill(-1)
  const at = (i: number): number => {
    const x = Pp[i * 3], y = Pp[i * 3 + 1], z = Pp[i * 3 + 2]
    const lon = Math.atan2(z, x), lat = Math.asin(Math.max(-1, Math.min(1, y)))
    const col = Math.min(W - 1, Math.floor(((lon / Math.PI + 1) / 2) * W))
    const row = Math.min(H - 1, Math.floor((1 - (lat / (Math.PI / 2) + 1) / 2) * H))
    return row * W + col
  }
  for (let k = 0; k < L; k++) {
    const c = h.landCells[k]
    const o = h.territory[lq * L + k]
    const pol = o > 0 ? h.polity[q * S + o - 1] : -1
    const pix = at(c)
    let ch = world.biome[c] === Biome.Ice ? '#' : '.', r = 1
    if (pol >= 0) { ch = letter.get(pol) ?? '+'; r = 2 + a.pop[pol] / (a.total + 1) }
    if (r > rank[pix]) { rank[pix] = r; grid[pix] = ch }
  }
  // v2: pirate havens (@, strength >= 0.2) and smugglers' hubs ($, contraband >= 0.3 of income) over the territory.
  let havens = 0, hubs = 0
  for (let i = 0; i < S; i++) {
    const pir = h.piracy[q * S + i], con = h.contraband[q * S + i]
    if (pir < 51 && con < 77) continue
    const pix = at(h.settlements[i].cell)
    if (pir >= 51) { grid[pix] = '@'; rank[pix] = 99; havens++ } else { grid[pix] = '$'; rank[pix] = 98; hubs++ }
  }
  const ov = overlordsAt(h, year)
  const vassal = (p: number): string => (ov[p] >= 0 ? `, vassal of ${letter.get(ov[p]) ?? '#' + ov[p]}` : '')
  const legend = order.slice(0, 14).map((p) => `${letter.get(p)} ${QUAL_WORD[h.polities[p].qualifier]}${h.polities[p].name} (${a.mem[p]}, ${f0(a.pop[p])}${vassal(p)})`).join('  ')
  const others: string[] = []
  for (const p of order.slice(14)) if (ov[p] >= 0) others.push(`${letter.get(p)} vassal of ${letter.get(ov[p]) ?? '#' + ov[p]}`)
  const lines = [`year ${year}: ${legend}${order.length > 14 ? `  ... ${order.length} polities${others.length ? ' (' + others.join(', ') + ')' : ''}` : ''}   (. stateless land, @ pirate haven ${havens}, $ smugglers' hub ${hubs})`]
  for (let row = 0; row < H; row++) lines.push(grid.slice(row * W, row * W + W).join(''))
  return lines.join('\n')
}

export function runPolityStats(seeds: number[], maps: boolean, ab: boolean): string {
  runHistory(generateWorld(0), { years: 300 })
  if (ab) runHistory(generateWorld(0), { years: 300, polities: false })
  const rows: PolityStatRow[] = []
  const extra: string[] = []
  for (const seed of seeds) {
    const w = generateWorld(seed)
    const t0 = performance.now()
    const run = runHistory(w)
    const t1 = performance.now()
    const off = ab ? runHistory(w, { polities: false }) : null
    const t2 = performance.now()
    rows.push(polityStats(w, run, off, t1 - t0, ab ? t2 - t1 : NaN))
    if (maps) {
      extra.push(`\n=== seed ${seed}: polities ===\n` + polityTimeline(run.history))
      for (const y of [800, 1200, 1600, 2000]) if (y <= run.history.years) extra.push(asciiPolityMap(w, run.history, y))
    }
  }
  return formatPolityStats(rows) + '\n\n' + formatPolityV2(rows) + '\n' + extra.join('\n')
}

if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) {
  const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
  const args = argv.slice(2)
  const maps = args.includes('--map')
  const ab = !args.includes('--no-ab')
  const seeds = args.map(Number).filter((s) => Number.isFinite(s))
  console.log(runPolityStats(seeds.length > 0 ? seeds : HISTORY_STATS_SEEDS, maps, ab))
}
