// polities: headless tuning harness for states, war and danger. Run with:
//   node src/sim/history/polityStats.ts [seed ...]            (Node >= 23, native type stripping)
//   node src/sim/history/polityStats.ts --map 42 7            (also timelines, successor trees and ASCII territory maps)
//   node src/sim/history/polityStats.ts --no-ab               (skip the runs with the polity system off)
// Reports, across seeds, the design's tuning targets (polities/design.md 14.1): polity counts, share of
// settlements and people inside states, the largest state's share, lifetimes, formation / conquest /
// secession / fragmentation counts, wars and their outcomes, the population cost against the same
// world with polities off, where large towns sit (defensible sites, distance from borders) against the
// off run, danger, capitals, churn, path dependence and snowballing, and the failure modes.

import { Biome, CITY_POPULATION, EventType, PolityEnd, PolityOrigin, StructureType, TOWN_POPULATION, WarOutcome } from '../../contract.ts'
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
  let countMax = 0
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
      const t = tierOf(a.pop[p], a.mem[p], false)
      if (t > tierEver[p]) tierEver[p] = t
      sh[p] = a.total > 0 ? a.pop[p] / a.total : 0
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
  return {
    seed: world.seed, ms, msOff, firstYear: first, count, countMax,
    inside1000: a1000.living ? a1000.inside / a1000.living : 0, inside2000: a2000.living ? a2000.inside / a2000.living : 0,
    popInside2000: a2000.total ? sumArr(a2000.pop) / a2000.total : 0,
    largest2000: a2000.total ? largest / a2000.total : 0,
    kingdomLife, shortShare: P ? short / P : 0, coreYears, formed, conquered, seceded, fragmentations, absorbed,
    wars: W.count, warRate, warLength, outcomes, pop2000, popOff2000, worstFall, warAbandon: abandoned ? warAb / abandoned : 0,
    revoltRate, revoltWin, siteT: nHigh && nLow ? tHigh / nHigh - tLow / nLow : NaN, siteCellT: cnHigh && cnLow ? cHigh / cnHigh - cLow / cnLow : NaN, siteHigh: nHigh, siteLow: nLow,
    citiesWalled: cities ? citiesW / cities : NaN, topCapitals: top.length ? topCap / top.length : 0,
    townsDefOn, townsDefOff, townsBorderOn, townsBorderOff, lateDefOn, lateDefOff, lateBorderOn, lateBorderOff, wTOn, wTOff, wHopsOn, wHopsOff, bigOn, bigOff, citiesOn, citiesOff, townsOn, townsOff, danger, dangerHigh,
    capitalRatio: capN && memN ? capPop / capN / (memPop / memN) : NaN, capitalsCities: cities ? capCities / cities : NaN,
    churn: median(churnRates), pathDep, peakShare: peak, peakFell: fell, tinyShare: ever2 ? tiny / ever2 : 0,
    raidsLogged, raidsSmall: sumRaids(h), diag: diag ? { raids: diag.raids, raidsWon: diag.raidsWon, revolts: diag.revolts, revoltsWon: diag.revoltsWon, frag: diag.fragmentations, absorbed: diag.absorbed, warDead: diag.warDead, sackDead: diag.sackDead, raidDead: diag.raidDead } : {},
  }
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
    ['Polities >= 2 members y800', '2-15', rng(col((r) => r.count[0]))],
    ['  y1200', '8-30', rng(col((r) => r.count[1]))],
    ['  y1600', '12-45', rng(col((r) => r.count[3]))],
    ['  y2000', '12-50', rng(col((r) => r.count[4]))],
    ['  never > 80', 'all', cnt((r) => r.countMax <= 80)],
    ['  >= 3 at y1500 (no world state)', '>= 19/20', cnt((r) => r.count[2] >= 3)],
    ['Settlements inside polities y1000', '0.20-0.50', rng(col((r) => r.inside1000))],
    ['  y2000', '0.55-0.85', rng(col((r) => r.inside2000))],
    ['  stateless >= 10% at y2000', '>= 18/20', cnt((r) => r.inside2000 <= 0.9)],
    ['People inside polities y2000', '(info)', rng(col((r) => r.popInside2000))],
    ['Largest polity share y2000', 'median 0.15-0.30, <= 0.60 all', rng(col((r) => r.largest2000))],
    ['  >= 0.40 (a great empire)', '>= 2/20', cnt((r) => r.largest2000 >= 0.4)],
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
      const t = tierOf(a.pop[p], a.mem[p], false)
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
      const o = ['?', 'white', 'won', 'lost', 'conquest', '', '', ''][W.outcome[w]]
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
  return lines.join('\n') + '\n\nSuccessor trees (lineages with a polity of >= 10 settlements):\n' + tree.join('\n')
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
  const legend = order.slice(0, 12).map((p) => `${letter.get(p)} ${QUAL_WORD[h.polities[p].qualifier]}${h.polities[p].name} (${a.mem[p]}, ${f0(a.pop[p])})`).join('  ')
  const lines = [`year ${year}: ${legend}${order.length > 12 ? `  ... ${order.length} polities` : ''}   (. stateless land)`]
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
  return formatPolityStats(rows) + '\n' + extra.join('\n')
}

if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) {
  const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
  const args = argv.slice(2)
  const maps = args.includes('--map')
  const ab = !args.includes('--no-ab')
  const seeds = args.map(Number).filter((s) => Number.isFinite(s))
  console.log(runPolityStats(seeds.length > 0 ? seeds : HISTORY_STATS_SEEDS, maps, ab))
}
