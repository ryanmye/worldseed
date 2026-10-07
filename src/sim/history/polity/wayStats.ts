// Danger on the way of trade: stats harness (polity/params.ts WAYRISK, reroute.ts). Per seed: the share of loads on risky ways
// and the high-value share of them; traffic through pirate havens' waters around their rise and across war fronts during the
// wars (cell by cell, along each route's path at the time: History.trade with its re-paths), both against the world's; the
// price premium of goods carried over risky ways (buyer's price over seller's, per class, risky ways against safe ones);
// TradeForsaken / TradeRestored and how soon a forsaken route was restored; re-paths; bandits against traffic; and the world's
// global aggregates (people, towns, routes, trade, states, pirates, sights, landmarks, ocean lanes, extinctions) to keep near
// main. Without seeds: the 20 stats seeds. `--json` adds one JSON line per seed.
//   node src/sim/history/polity/wayStats.ts [--years N] [--json] [--seeds40] seeds...

import { CITY_POPULATION, DiseaseKind, EventType, GOOD_COUNT, LandmarkRank, TOWN_POPULATION } from '../../../contract.ts'
import type { History } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import { GOODS } from '../params.ts'
import { HISTORY_STATS_SEEDS, spearman } from '../stats.ts'
import type { HistoryState } from '../state.ts'
import type { TradeState } from '../trade.ts'
import type { PairPolicy } from './policy.ts'
import { BANDIT } from './params.ts'

const G = GOOD_COUNT
const RISKY = 0.2, SAFE = 0.05
/** Classes reported for the premium: the bulk goods together (0..6), then each high-value class (7..11). */
const CLASSES = ['bulk', 'Luxury', 'Stimulant', 'Metalware', 'Finery', 'Treasure']
const classOf = (g: number): number => (g < 7 ? 0 : g <= 11 ? g - 6 : -1)

export interface WayRow {
  seed: number
  ms: number
  riskyShare: number
  hvRiskyShare: number
  hvSafeShare: number
  /** Per PiratesRise: loads through the haven's waters (3 sea hops) after / before, raw and as a share of the world's sea-route loads. */
  haven: number[]
  havenRaw: number[]
  /** Per war (>= 10 years): loads crossing between the two sides' lands during / before, as a share of the world's loads; third parties only. */
  front: number[]
  front3: number[]
  /** Premium: medians of buyer / seller price, per class, on risky and on safe ways. */
  premRisky: number[]
  premSafe: number[]
  forsaken: number
  restored: number
  restoredQuick: number
  repaths: number
  repathRoutes: number
  /** Bandits: Spearman of lawlessness against through-traffic (lawless settlements), mean lawlessness, bandit roads (routes at the toll). */
  banditRho: number
  lawlessMean: number
  banditRoads: number
  agg: Record<string, number>
}

function median(a: number[]): number {
  const b = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y)
  const n = b.length
  return n === 0 ? NaN : n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2
}

/** The path of route r at year y: [array, from, to) (History.trade, with its re-paths when it has them). */
export function pathAt(h: History, r: number, y: number): [Uint32Array, number, number] {
  const T = h.trade as History['trade'] & { repathCount?: number; repathRoute?: Int32Array; repathYear?: Int16Array; repathOffsets?: Uint32Array; repathPath?: Uint32Array }
  let best = -1
  const n = T.repathCount ?? 0
  for (let k = 0; k < n && T.repathYear![k] <= y; k++) if (T.repathRoute![k] === r) best = k
  if (best < 0) return [T.path, T.pathOffsets[r], T.pathOffsets[r + 1]]
  return [T.repathPath!, T.repathOffsets![best], T.repathOffsets![best + 1]]
}

export function wayRow(seed: number, years: number): WayRow {
  const w = generateWorld(seed)
  const N = w.grid.cellCount
  // Probe (every 10 years from 300): risky ways, the premium, bandits.
  let tot = 0, risky = 0, hvRisky = 0, hvSafe = 0, safe = 0
  const premR: number[][] = CLASSES.map(() => []), premS: number[][] = CLASSES.map(() => [])
  const lawX: number[] = [], lawT: number[] = []
  let lawSum = 0, lawN = 0, bRoads = 0, bSamples = 0
  const probe = (s: HistoryState, ts: TradeState): void => {
    if (s.year < 300 || s.year % 10 !== 0) return
    const ps = s.pol
    if (ps === null) return
    const pc = ps.policy as PairPolicy | null
    if (pc === null) return
    const V = GOODS.value
    for (let p = 0; p < ts.pairCount && p < pc.n; p++) {
      const r = ts.pairRoute[p]
      if (r < 0 || !ts.rOpen[r]) continue
      const vol = ts.rVol[r]
      const R = pc.risk[p]
      let hv = 0
      const o = p * G * 2
      for (let g = 7; g < G; g++) hv += (ts.pairFlow[o + g * 2] + ts.pairFlow[o + g * 2 + 1]) * V[g]
      tot += vol
      if (R >= RISKY) { risky += vol; hvRisky += hv } else if (R < SAFE) { safe += vol; hvSafe += hv }
      const a = ts.pairA[p], b = ts.pairB[p]
      for (let g = 0; g < G; g++) {
        const c = classOf(g)
        if (c < 0) continue
        const f0 = ts.pairFlow[o + g * 2], f1 = ts.pairFlow[o + g * 2 + 1]
        if (!(f0 > 1e-3 || f1 > 1e-3)) continue
        const from = f0 >= f1 ? a : b, to = f0 >= f1 ? b : a
        const pf = ts.price[from * G + g], pt = ts.price[to * G + g]
        if (!(pf > 0) || !(pt > 0)) continue
        if (R >= RISKY) premR[c].push(pt / pf); else if (R < SAFE) premS[c].push(pt / pf)
      }
    }
    for (const x of s.living) {
      if (x >= ps.seen) continue
      const l = ps.lawless[x]
      if (!(l > 0)) continue
      lawX.push(l); lawT.push(s.through[x])
      lawSum += l; lawN++
    }
    for (const r of ts.openList) if (r < ps.rBand.length && ps.rBand[r] >= BANDIT.toll) bRoads++
    bSamples++
  }
  const t = performance.now()
  const run = runHistory(w, { years }, probe)
  const ms = performance.now() - t
  const h = run.history
  const S = h.settlements.length
  const RC = h.trade.count
  const TI = h.tradeInterval
  const sea = new Uint8Array(N)
  for (let c = 0; c < N; c++) if (w.elevation[c] < 0) sea[c] = 1
  const { neighborOffsets: off, neighbors: nb } = w.grid
  // Route paths at each trade snapshot: as version lists (start year, from, to) per route.
  const T = h.trade as History['trade'] & { repathCount?: number; repathRoute?: Int32Array; repathYear?: Int16Array; repathOffsets?: Uint32Array; repathPath?: Uint32Array }
  const nRe = T.repathCount ?? 0
  const routeVolAt = (q: number, r: number): number => (r < RC ? h.tradeVolume[q * RC + r] : 0)
  /** Per trade snapshot: loads summed over routes whose path at that year satisfies f (called once per route path). */
  const series = (f: (arr: Uint32Array, a: number, b: number, y: number) => boolean): Float64Array => {
    const out = new Float64Array(h.tradeSnapshotCount)
    for (let q = 0; q < h.tradeSnapshotCount; q++) {
      const y = q * TI
      for (let r = 0; r < RC; r++) {
        const v = routeVolAt(q, r)
        if (!(v > 0)) continue
        const [arr, a, b] = pathAt(h, r, y)
        if (f(arr, a, b, y)) out[q] += v
      }
    }
    return out
  }
  const mean = (x: Float64Array, y0: number, y1: number): number => {
    let s = 0, n = 0
    for (let q = Math.max(0, Math.ceil(y0 / TI)); q * TI <= y1 && q < x.length; q++) { s += x[q]; n++ }
    return n ? s / n : NaN
  }
  const allSea = series((arr, a, b) => { for (let k = a; k < b; k++) if (sea[arr[k]]) return true; return false })
  const all = series(() => true)
  // Pirate havens.
  const haven: number[] = [], havenRaw: number[] = []
  for (const e of h.events) {
    if (e.type !== EventType.PiratesRise || e.year < 100 || e.year + 40 > years) continue
    const mask = new Uint8Array(N)
    let ring = [h.settlements[e.settlement].cell]
    const seen = new Uint8Array(N)
    seen[ring[0]] = 1
    for (let hop = 0; hop < 3; hop++) {
      const next: number[] = []
      for (const c of ring) for (let k = off[c]; k < off[c + 1]; k++) { const j = nb[k]; if (!seen[j] && sea[j]) { seen[j] = 1; mask[j] = 1; next.push(j) } }
      ring = next
    }
    const x = series((arr, a, b) => { for (let k = a; k < b; k++) if (mask[arr[k]]) return true; return false })
    const b0 = mean(x, e.year - 30, e.year - 10), b1 = mean(x, e.year + 10, e.year + 40)
    const s0 = mean(allSea, e.year - 30, e.year - 10), s1 = mean(allSea, e.year + 10, e.year + 40)
    if (!(b0 > 0) || !(s0 > 0) || !(s1 > 0)) continue
    havenRaw.push(b1 / b0)
    haven.push((b1 / s1) / (b0 / s0))
  }
  // War fronts: loads stepping between the two sides' lands.
  const landIndex = new Int32Array(N).fill(-1)
  for (let k = 0; k < h.landCells.length; k++) landIndex[h.landCells[k]] = k
  const LC = h.landCells.length
  const polAt = (c: number, y: number): number => {
    const k = landIndex[c]
    if (k < 0) return -1
    const lq = Math.min(h.landSnapshotCount - 1, Math.floor(y / h.landInterval))
    const o = h.territory[lq * LC + k] - 1
    if (o < 0) return -1
    const sq = Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval))
    return h.polity[sq * S + o]
  }
  const front: number[] = [], front3: number[] = []
  const W = h.wars
  for (let i = 0; i < W.count; i++) {
    const p = W.attacker[i], q = W.defender[i], y0 = W.startYear[i], y1 = W.endYear[i] < 0 ? years : W.endYear[i]
    if (y1 - y0 < 10 || y0 < 100) continue
    const cross = (arr: Uint32Array, a: number, b: number, y: number): boolean => {
      let last = -2
      for (let k = a; k < b; k++) {
        const x = polAt(arr[k], y)
        if ((x === p && last === q) || (x === q && last === p)) return true
        last = x
      }
      return false
    }
    const x = series(cross)
    const b0 = mean(x, y0 - 20, y0 - 1), b1 = mean(x, y0 + 5, Math.min(y1, y0 + 30))
    const s0 = mean(all, y0 - 20, y0 - 1), s1 = mean(all, y0 + 5, Math.min(y1, y0 + 30))
    if (b0 > 0 && s0 > 0 && s1 > 0) front.push((b1 / s1) / (b0 / s0))
    // Third parties: the routes, neither of whose ends belongs to either side, that crossed between their lands at the last
    // trade snapshot before the war: their loads (along whatever way they take) during the war against before.
    const q0 = Math.floor((y0 - 1) / TI)
    const sq0 = Math.min(h.snapshotCount - 1, Math.floor((q0 * TI) / h.snapshotInterval))
    const set: number[] = []
    for (let r = 0; r < RC && q0 >= 0; r++) {
      if (!(routeVolAt(q0, r) > 0)) continue
      const pa = h.polity[sq0 * S + h.trade.a[r]], pb = h.polity[sq0 * S + h.trade.b[r]]
      if (pa === p || pa === q || pb === p || pb === q) continue
      const [arr, a, b] = pathAt(h, r, q0 * TI)
      if (cross(arr, a, b, q0 * TI)) set.push(r)
    }
    const x3 = new Float64Array(h.tradeSnapshotCount)
    for (let qq = 0; qq < h.tradeSnapshotCount; qq++) for (const r of set) x3[qq] += routeVolAt(qq, r)
    const c0 = mean(x3, y0 - 20, y0 - 1), c1 = mean(x3, y0 + 5, Math.min(y1, y0 + 30))
    if (c0 > 0 && s0 > 0 && s1 > 0) front3.push((c1 / s1) / (c0 / s0))
  }
  // Forsaken and restored.
  let forsaken = 0, restored = 0, quick = 0
  for (const e of h.events) {
    if (e.type === EventType.TradeForsaken) forsaken++
    else if (e.type === EventType.TradeRestored) { restored++; if ((e.extra ?? 0) < 5) quick++ }
  }
  const reRoutes = new Set<number>() // (count only)
  for (let k = 0; k < nRe; k++) reRoutes.add(T.repathRoute![k])
  // Global aggregates at the end of the run.
  const q = h.snapshotCount - 1
  let pop = 0, living = 0, towns = 0, cities = 0
  for (let v = 0; v < S; v++) {
    const x = h.population[q * S + v]
    if (!(x > 0) || h.settlements[v].abandonedYear >= 0) continue
    pop += x; living++
    if (x >= TOWN_POPULATION) towns++
    if (x >= CITY_POPULATION) cities++
  }
  const tq = h.tradeSnapshotCount - 1
  let routesOpen = 0, vol = 0, volSea = 0
  for (let r = 0; r < RC; r++) { const v = h.tradeVolume[tq * RC + r]; if (v > 0) { routesOpen++; vol += v; if (allSeaRoute(h, r, sea, years)) volSea += v } }
  const polities = new Set<number>() // (count only)
  for (let v = 0; v < S; v++) { const p = h.polity[q * S + v]; if (p >= 0) polities.add(p) }
  let rises = 0
  for (const e of h.events) if (e.type === EventType.PiratesRise) rises++
  let wealth = 0
  for (let v = 0; v < S; v++) wealth += h.wealth[q * S + v]
  let oceanLanes = 0, legsOpen = 0
  const LH = h.longHaul
  for (let k = 0; k < LH.count; k++) {
    if (LH.closedYear[k] < 0) legsOpen++
    if (LH.kind[k] !== 1) continue
    let deep = 0
    for (let j = LH.pathOffsets[k]; j < LH.pathOffsets[k + 1]; j++) if (w.elevation[LH.path[j]] < -0.1) deep++
    if (deep >= 5) oceanLanes++
  }
  const peopleAlive = new Uint8Array(h.peoples.length)
  for (let v = 0; v < S; v++) if (h.population[q * S + v] > 0 && h.settlements[v].abandonedYear < 0) peopleAlive[h.settlements[v].people] = 1
  let extinct = 0
  for (let p = 0; p < h.peoples.length; p++) if (!peopleAlive[p]) extinct++
  let great = 0, lesser = 0
  for (let i = 0; i < h.landmarks.count; i++) if (h.landmarks.rank[i] === LandmarkRank.Great) great++; else lesser++
  let visitors = 0
  const VF = h.visitorFlows
  for (let k = 0; k < VF.rowCount; k++) if (VF.rowSnapshot[k] === tq) visitors += VF.visitors[k]
  let plague = 0
  for (const d of h.diseases) if (d.kind === DiseaseKind.Plague && d.firstYear >= 0) plague = 1
  let landmarkSights = 0
  for (const x of h.sights) if ((x.kind as number) === 7) landmarkSights++
  const agg: Record<string, number> = {
    pop: Math.round(pop), living, towns, cities, routesOpen, routes: RC, vol: Math.round(vol), volSea: Math.round(volSea), wealth: Math.round(wealth), polities: polities.size, wars: W.count, rises,
    sights: h.sights.length, landmarkSights, visitors: Math.round(visitors), great, lesser, legsOpen, oceanLanes, extinct, plague, renamings: h.renamings.count, events: h.events.length,
  }
  return {
    seed, ms, riskyShare: risky / tot, hvRiskyShare: hvRisky / risky, hvSafeShare: hvSafe / safe, haven, havenRaw, front, front3,
    premRisky: premR.map(median), premSafe: premS.map(median), forsaken, restored, restoredQuick: quick, repaths: nRe, repathRoutes: reRoutes.size,
    banditRho: lawX.length > 2 ? spearman(lawX, lawT) : NaN, lawlessMean: lawN ? lawSum / lawN : 0, banditRoads: bSamples ? bRoads / bSamples : 0, agg,
  }
}

/** True if route r's path (as opened) has a sea cell. */
function allSeaRoute(h: History, r: number, sea: Uint8Array, years: number): boolean {
  const [arr, a, b] = pathAt(h, r, years)
  for (let k = a; k < b; k++) if (sea[arr[k]]) return true
  return false
}

function f2(x: number): string { return Number.isFinite(x) ? x.toFixed(2) : '  - ' }
function f3(x: number): string { return Number.isFinite(x) ? x.toFixed(3) : '  -  ' }

export const SEEDS_40 = [...HISTORY_STATS_SEEDS, 12345, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]

function main(): void {
  const args = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
  const yi = args.indexOf('--years')
  const years = yi >= 0 ? Number(args[yi + 1]) : 2000
  const json = args.includes('--json')
  const seeds = args.filter((a: string, i: number) => !a.startsWith('--') && (yi < 0 || i !== yi + 1)).map(Number)
  const list = seeds.length ? seeds : args.includes('--seeds40') ? SEEDS_40 : HISTORY_STATS_SEEDS
  const rows: WayRow[] = []
  console.log('seed    ms   risky hvRisky hvSafe  haven(n)  raw   front(n) third  forsk rest quick repath(routes)  bandRho lawless bRoads   premium risky/safe ' + CLASSES.join(' '))
  for (const seed of list) {
    const r = wayRow(seed, years)
    rows.push(r)
    console.log(`${String(seed).padEnd(7)} ${String(Math.round(r.ms)).padStart(5)} ${f3(r.riskyShare)} ${f3(r.hvRiskyShare)} ${f3(r.hvSafeShare)}  ${f2(median(r.haven))}(${r.haven.length}) ${f2(median(r.havenRaw))}  ${f2(median(r.front))}(${r.front.length}) ${f2(median(r.front3))}  ${String(r.forsaken).padStart(5)} ${String(r.restored).padStart(4)} ${String(r.restoredQuick).padStart(5)} ${String(r.repaths).padStart(6)}(${r.repathRoutes})  ${f2(r.banditRho)} ${f3(r.lawlessMean)} ${f2(r.banditRoads)}  ` + CLASSES.map((_, c) => `${f2(r.premRisky[c])}/${f2(r.premSafe[c])}`).join(' '))
    if (json) console.log('JSON ' + JSON.stringify(r))
  }
  const all = (f: (r: WayRow) => number[]): number[] => rows.flatMap(f)
  console.log(`\nmedians over ${rows.length} seeds: risky share ${f3(median(rows.map((r) => r.riskyShare)))}, high-value share on risky ways ${f3(median(rows.map((r) => r.hvRiskyShare)))} (safe ways ${f3(median(rows.map((r) => r.hvSafeShare)))})`)
  console.log(`haven traffic after/before (share of world sea loads) ${f2(median(all((r) => r.haven)))} over ${all((r) => r.haven).length} rises (raw ${f2(median(all((r) => r.havenRaw)))}); war-front traffic during/before ${f2(median(all((r) => r.front)))} over ${all((r) => r.front).length} wars (third parties ${f2(median(all((r) => r.front3)))} over ${all((r) => r.front3).length})`)
  console.log(`forsaken ${rows.reduce((a, r) => a + r.forsaken, 0)}, restored ${rows.reduce((a, r) => a + r.restored, 0)} (within 5 years ${rows.reduce((a, r) => a + r.restoredQuick, 0)}); re-paths ${rows.reduce((a, r) => a + r.repaths, 0)} on ${rows.reduce((a, r) => a + r.repathRoutes, 0)} routes`)
  console.log(`bandits: Spearman(lawlessness, traffic) median ${f2(median(rows.map((r) => r.banditRho)))}; mean lawlessness ${f3(median(rows.map((r) => r.lawlessMean)))}; bandit roads ${f2(median(rows.map((r) => r.banditRoads)))}`)
  console.log('premium (median of the seeds\' medians, buyer/seller) risky / safe / ratio: ' + CLASSES.map((c, i) => { const a = median(rows.map((r) => r.premRisky[i])), b = median(rows.map((r) => r.premSafe[i])); return `${c} ${f2(a)}/${f2(b)}/${f2(a / b)}` }).join(', '))
  const keys = Object.keys(rows[0].agg)
  console.log('aggregates (sum over seeds): ' + keys.map((k) => `${k} ${rows.reduce((a, r) => a + r.agg[k], 0)}`).join(', '))
  console.log('aggregates (median): ' + keys.map((k) => `${k} ${median(rows.map((r) => r.agg[k]))}`).join(', '))
  console.log(`worlds with an ocean lane ${rows.filter((r) => r.agg.oceanLanes > 0).length}/${rows.length}; extinctions ${rows.reduce((a, r) => a + r.agg.extinct, 0)}; plague worlds ${rows.reduce((a, r) => a + r.agg.plague, 0)}`)
}

if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) main()
