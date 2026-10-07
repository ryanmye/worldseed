// goods: headless tuning harness for worked goods, specialities, secrets and long-distance trade. Run with:
//   node src/sim/history/goods/goodsStats.ts [seed ...]              (Node >= 23; summary over the seeds, goods on and off)
//   node src/sim/history/goods/goodsStats.ts --detail 12345 42        (also the per-seed printouts)
//   node src/sim/history/goods/goodsStats.ts --no-off                 (skip the runs with the goods system off)
// Reports the design's targets (goods/design.md 11.1): global aggregates against the goods-off run, how far luxuries travel,
// price multiplication along relay chains and its fall after a lane, lanes, posts, monopolies and leaks, entrepots, bypassed
// marts, arms and tools, technology divergence, traditions, mining booms, runaway checks, time and memory.

import { DepositKind, EventType, LegKind, PostKind, SecretKind, TOWN_POPULATION } from '../../../contract.ts'
import type { History, World } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import type { HistoryRun } from '../index.ts'
import type { HistoryState } from '../state.ts'
import type { TradeState } from '../trade.ts'
import { HISTORY_STATS_SEEDS } from '../stats.ts'
import { CASH, SPECIES_TABLE } from '../species.ts'

const G = 13
const R_KM = 6371
const CH = ['Founded', 'Contact', 'Espionage', 'Defection', 'Smuggling', 'Conquest', 'Rediscovery', 'Chart']
const DK = ['gold', 'silver', 'gems', 'amber', 'pearls', 'murex']
const CRAFT = ['silk', 'dyeing', 'fine cloth', 'blades']

function med(a: number[]): number { const b = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[b.length >> 1] : 0.5 * (b[b.length / 2 - 1] + b[b.length / 2])) : NaN }
function pct(a: number[], p: number): number { const b = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN }
function fmt(x: number, d = 1): string { return !Number.isFinite(x) ? '-' : Math.abs(x) >= 10000 ? (x / 1000).toFixed(0) + 'k' : x.toFixed(d) }

/** What a probe records of the internal state during a run. */
export interface Probe {
  /** Distances (km) from the origin of each named Luxury / Finery unit held by traders at the end, weighted by amount. */
  dist: number[]; distW: number[]
  /** Price records: year, variety, source ratio, far ratio, far distance (km). */
  price: number[]
  /** Tool farm multipliers of traders at the end. */
  toolMul: number[]
  /** Relay income (smoothed) and wealth per head of traders at the end, and through-traffic. */
  relay: number[]; wph: number[]; through: number[]
  /** Wealth a head of the town alone (without its merchant capital). */
  wphTown: number[]
  /** World Treasure price index (median price / worth over traders) per decade. */
  treasure: number[]
  /** Arms per head of each polity's members per decade: [decade][polity] (mean over members). */
  polArms: Map<number, Float64Array>
}

/** Index of each species among the cash crops (CASH order), and their count. */
const CASH_IDX: Int32Array & { n: number } = Object.assign(new Int32Array(64).fill(-1), { n: CASH.length })
CASH.forEach((x, q) => { CASH_IDX[x] = q })

export function newProbe(): Probe { return { dist: [], distW: [], price: [], toolMul: [], relay: [], wph: [], wphTown: [], through: [], treasure: [], polArms: new Map() } }

function chordKm(P: Float32Array, a: number, b: number): number {
  const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]
  const c = Math.sqrt(dx * dx + dy * dy + dz * dz)
  // Great-circle from chord: 2 asin(c / 2) ~ c + c^3 / 24 + 3 c^5 / 640 (enough for display).
  return R_KM * (c + (c * c * c) / 24 + (3 * c * c * c * c * c) / 640)
}

export function probeFn(pr: Probe, years: number): (s: HistoryState, t: TradeState) => void {
  return (s: HistoryState, t: TradeState) => {
    const g = s.goods
    if (g === null) return
    const P = s.world.grid.positions
    if (s.year % 10 === 0) {
      // Price of the three largest Luxury crop varieties: at the source, and at the farthest trader holding it at 5% or more.
      const top: number[] = []
      for (let v = 1; v < g.vCount; v++) if (g.vGood[v] === 7 && g.vKind[v] === 1 && g.vOrigin[v] >= 0) top.push(v)
      top.sort((a, b) => g.vOriginOut[b] - g.vOriginOut[a] || a - b)
      for (const v of top.slice(0, 3)) {
        // The source: the cheapest market among the variety's growers (its people's traders growing its species).
        let o = -1, ps = Infinity
        const x = g.vSource[v], pv = g.vPeople[v]
        const q = CASH_IDX[x]
        for (const id of s.living) {
          if (!t.trader[id] || s.people[id] !== pv || q < 0 || !(g.cashCoef[id * CASH_IDX.n + q] > 0)) continue
          const r = t.price[id * G + 7] / t.worth[id * G + 7]
          if (r < ps) { ps = r; o = id }
        }
        if (o < 0) continue
        // The dearest market it reaches (a trader holding it at 5% or more of its Luxury, at least 500 km away).
        let far = -1, fd = 0, fp = 0
        for (const id of s.living) {
          if (!t.trader[id] || id === o) continue
          const S = g.held[id * G + 7] + 1e-9
          const off = (id * 4 + 0) * 4
          for (let k = 0; k < 4; k++) if (g.mixV[off + k] === v && g.mixA[off + k] >= 0.05 * S) {
            const d = chordKm(P, s.cell[o], s.cell[id])
            const r = t.price[id * G + 7] / t.worth[id * G + 7]
            if (d >= 500 && r > fp) { fp = r; fd = d; far = id }
          }
        }
        if (far >= 0) pr.price.push(s.year, v, ps, fp, fd)
      }
      // Treasure price index.
      const r: number[] = []
      for (const id of s.living) if (t.trader[id] && t.worth[id * G + 11] > 0) r.push(t.price[id * G + 11] / t.worth[id * G + 11])
      pr.treasure.push(med(r))
      // Arms per head per polity.
      const ps = s.pol
      if (ps !== null) {
        const sum = new Float64Array(ps.P), pop = new Float64Array(ps.P)
        for (const id of s.living) { const p = id < ps.seen ? ps.polity[id] : -1; if (p < 0 || id >= g.cap) continue; sum[p] += g.arms[id] * g.armsRel[id]; pop[p] += s.pop[id] }
        const a = new Float64Array(ps.P)
        for (let p = 0; p < ps.P; p++) a[p] = pop[p] > 0 ? sum[p] / pop[p] : 0
        pr.polArms.set(s.year / 10, a)
      }
    }
    if (s.year !== years) return
    for (const id of s.living) {
      if (!t.trader[id]) continue
      pr.toolMul.push(g.toolMul[id])
      // (wealth a head: the town's and its merchant houses' capital, goods/merchants.ts; wphTown the town's alone)
      const mc = id < g.merch.cap ? g.merch.mw[id] : 0
      pr.relay.push(g.relaySm[id]); pr.wph.push((s.wealth[id] + mc) / s.pop[id]); pr.wphTown.push(s.wealth[id] / s.pop[id]); pr.through.push(s.through[id])
      for (const [m, c] of [[0, 7], [2, 10]]) {
        const off = (id * 4 + m) * 4
        for (let k = 0; k < 4; k++) {
          const v = g.mixV[off + k]
          if (v <= 0 || g.vOrigin[v] < 0) continue
          pr.dist.push(chordKm(P, s.cell[g.vOrigin[v]], s.cell[id])); pr.distW.push(g.mixA[off + k])
          void c
        }
      }
    }
  }
}

/** Weighted quantile. */
function wq(x: number[], w: number[], q: number): number {
  const i = x.map((_, k) => k).sort((a, b) => x[a] - x[b])
  let tot = 0
  for (const k of i) tot += w[k]
  let acc = 0
  for (const k of i) { acc += w[k]; if (acc >= q * tot) return x[k] }
  return NaN
}

export interface GoodsSeedStats { seed: number; row: Record<string, number>; detail: string }

function aggregates(h: History, row: Record<string, number>, suffix: string): void {
  const S = h.settlements.length
  for (const y of [500, 1000, 1500, 2000]) {
    if (y > h.years) continue
    const q = Math.floor(y / h.snapshotInterval)
    let tot = 0, living = 0, towns = 0, cities = 0, wealth = 0
    for (let i = 0; i < S; i++) { const x = h.population[q * S + i]; if (x <= 0) continue; tot += x; wealth += h.wealth[q * S + i]; if (!h.settlements[i].outpost) living++; if (x >= TOWN_POPULATION) towns++; if (x >= 10000) cities++ }
    const open = new Uint8Array(h.trade.count)
    for (const e of h.events) { if (e.year > y) break; if (e.type === EventType.TradeOpened) open[e.value] = 1; else if (e.type === EventType.TradeClosed) open[e.value] = 0 }
    let routes = 0
    for (let r = 0; r < open.length; r++) routes += open[r]
    row[`pop${y}${suffix}`] = tot; row[`living${y}${suffix}`] = living; row[`routes${y}${suffix}`] = routes
    if (y === 2000) {
      row[`towns${suffix}`] = towns; row[`cities${suffix}`] = cities; row[`wph${suffix}`] = wealth / tot
      let mc = 0
      if (h.merchantWealth.length) for (let i = 0; i < S; i++) mc += h.merchantWealth[q * S + i]
      row[`merchShare${suffix}`] = mc / (mc + wealth)
    }
  }
  row[`firstState${suffix}`] = h.polities.length ? h.polities[0].foundedYear : 9999
  const q = h.snapshotCount - 1
  const mem = new Int32Array(h.polities.length)
  for (let i = 0; i < S; i++) { const p = h.polity[q * S + i]; if (p >= 0 && h.population[q * S + i] > 0) mem[p]++ }
  let n = 0
  for (let p = 0; p < mem.length; p++) if (mem[p] >= 2) n++
  row[`states2${suffix}`] = n
  row[`extinct${suffix}`] = h.population.subarray(q * S).some((x) => x > 0) ? 0 : 1
  // Technology spread between peoples.
  const P = h.peoples.length
  for (let f = 0; f < 4; f++) {
    let mn = 99, mx = 0
    for (let p = 0; p < P; p++) { const v = h.technology[(q * P + p) * 4 + f]; if (v > 0) { mn = Math.min(mn, v); mx = Math.max(mx, v) } }
    row[`spread${'FSMC'[f]}${suffix}`] = mx - mn
    row[`max${'FSMC'[f]}${suffix}`] = mx
  }
}

/** Runs one seed and measures it (goods on), with the goods-off aggregates when `off`. */
export function goodsSeedStats(seed: number, off: boolean, detail: boolean, pre?: { w: World; run: HistoryRun; pr: Probe; ms: number }): GoodsSeedStats {
  const w = pre ? pre.w : generateWorld(seed)
  const pr = pre ? pre.pr : newProbe()
  const t0 = performance.now()
  const run = pre ? pre.run : runHistory(w, {}, probeFn(pr, 2000))
  const ms = pre ? pre.ms : performance.now() - t0
  const h = run.history
  const T = run.terrain
  const row: Record<string, number> = { ms }
  aggregates(h, row, '')
  if (off) { const t1 = performance.now(); const ho = runHistory(w, { goods: false }).history; row.msOff = performance.now() - t1; aggregates(ho, row, 'Off') }
  const S = h.settlements.length
  const ev = h.events
  const count = (t: number): number => { let n = 0; for (const e of ev) if (e.type === t) n++; return n }
  // T1: how far the named luxuries and fine cloth travel.
  row.distMed = wq(pr.dist, pr.distW, 0.5); row.distP90 = wq(pr.dist, pr.distW, 0.9)
  // T2: high-value share of trade by value (last trade snapshot).
  const gv = run.diag.goodVolume, tq = h.tradeSnapshotCount - 1
  let all = 0, hv = 0
  for (let c = 0; c < G; c++) { const x = gv[tq * G + c]; all += x; if (c >= 7) hv += x }
  row.hvShare = all > 0 ? hv / all : NaN
  // T3: price multiplication of a spice: far / source price of the luxury crop variety recorded most often, before and
  // 30-60 years after the first lane opened for it (or for the same crop of the same people); else the world's first lane.
  const pl = pr.price
  let before = NaN, after = NaN, peak = NaN
  {
    const freq = new Map<number, number>() // (lookup only)
    let vt = -1, best = 0
    for (let i = 0; i < pl.length; i += 5) { const v = pl[i + 1]; const n = (freq.get(v) ?? 0) + 1; freq.set(v, n); if (n > best || (n === best && v < vt)) { best = n; vt = v } }
    const ratios: { y: number; r: number }[] = []
    for (let i = 0; i < pl.length; i += 5) if (pl[i + 1] === vt && pl[i + 2] > 0) ratios.push({ y: pl[i], r: pl[i + 3] / pl[i + 2] })
    peak = ratios.length ? Math.max(...ratios.map((x) => x.r)) : NaN
    const same = (x: number): boolean => x === vt || (x > 0 && vt > 0 && h.varieties[x].kind === h.varieties[vt].kind && h.varieties[x].source === h.varieties[vt].source && h.varieties[x].people === h.varieties[vt].people)
    const lane = h.events.find((e) => e.type === EventType.DirectRoute && same(e.extra ?? -1)) ?? h.events.find((e) => e.type === EventType.DirectRoute)
    if (lane) {
      before = med(ratios.filter((x) => x.y < lane.year && x.y >= lane.year - 50).map((x) => x.r))
      after = med(ratios.filter((x) => x.y >= lane.year + 30 && x.y <= lane.year + 60).map((x) => x.r))
      row.priceLaneOwn = same(lane.extra ?? -1) ? 1 : 0
    }
    row.priceRatioMed = med(ratios.map((x) => x.r))
  }
  row.priceBefore = before; row.priceAfter = after; row.pricePeak = peak
  // T4: lanes.
  let lanes = 0, ocean = 0, firstLane = 9999
  for (const e of ev) if (e.type === EventType.DirectRoute) { lanes++; if (e.year < firstLane) firstLane = e.year }
  for (let k = 0; k < h.longHaul.count; k++) {
    if (h.longHaul.kind[k] !== LegKind.Lane) continue
    let deep = 0
    for (let i = h.longHaul.pathOffsets[k]; i < h.longHaul.pathOffsets[k + 1]; i++) if (T.deep[h.longHaul.path[i]]) deep++
    if (deep >= 25) ocean++
  }
  row.lanes = lanes; row.oceanLanes = ocean; row.firstLane = firstLane
  let relayLegs = 0
  const qL = h.tradeSnapshotCount - 1
  for (let k = 0; k < h.longHaul.count; k++) if (h.longHaul.kind[k] === LegKind.Relay && h.longHaulVolume[qL * h.longHaul.count + k] > 0) relayLegs++
  row.relayLegs = relayLegs
  let marts = 0
  for (let i = 0; i < S; i++) marts += h.mart[qL * S + i]
  row.marts = marts
  // Trade expeditions.
  const gd = run.diag.goods
  if (gd) {
    row.tradeExp = gd.expYear.length
    row.tradeSailed = gd.expOutcome.filter((x) => x > 0).length
    row.tradeLost = gd.expOutcome.filter((x) => x === 2).length
    row.tradeExpLate = gd.expYear.filter((y) => y >= 1500).length
  }
  // T5: posts.
  row.posts = h.posts.length
  // (a victualling station is a fort post too: design 4.3, Cape Town)
  let fortTown = 0, stationTown = 0
  for (const p of h.posts) {
    if ((p.kind !== PostKind.Fort && p.kind !== PostKind.Station) || p.settlement < 0) continue
    for (let q = 0; q < h.snapshotCount; q++) if (h.population[q * S + p.settlement] >= TOWN_POPULATION) { if (p.kind === PostKind.Fort) fortTown = 1; else stationTown = 1; break }
  }
  row.fortTown = fortTown; row.fortOrStationTown = fortTown || stationTown ? 1 : 0
  row.forts = h.posts.filter((p) => p.kind === PostKind.Fort).length
  // T6: monopolies: years to the first leak per secret (to the end if none), per kind.
  const firstLeak = new Map<number, number>()
  for (const e of ev) if (e.type === EventType.SecretLeaked && e.extra !== 0 && !firstLeak.has(e.value)) firstLeak.set(e.value, e.year)
  const dur: number[][] = [[], [], []]
  let held50 = 0, never = 0
  const held = new Set<number>() // (membership only)
  for (let i = 0; i < h.secretHolds.count; i++) held.add(h.secretHolds.secret[i])
  for (const x of h.secrets) {
    if (!held.has(x.id)) continue // (a secret nobody ever held: a species no people had)
    const end = firstLeak.get(x.id) ?? h.years
    const d = end - x.foundYear
    if (x.kind <= 2) dur[x.kind].push(d)
    if (d >= 50) held50++
    if (!firstLeak.has(x.id)) never++
  }
  row.secrets = held.size; row.secrets50 = held50; row.neverLeak = held.size ? never / held.size : NaN
  row.durSpecies = med(dur[SecretKind.Species]); row.durCraft = med(dur[SecretKind.Craft]); row.durChart = med(dur[SecretKind.Chart])
  const chans = new Set<number>() // (membership only)
  for (const e of ev) if (e.type === EventType.SecretLeaked && e.extra !== undefined) chans.add(e.extra)
  for (let c = 0; c < 8; c++) row[`ch${c}`] = chans.has(c) ? 1 : 0
  row.leaks = count(EventType.SecretLeaked); row.monoBroken = count(EventType.MonopolyBroken)
  // T7: entrepots: wealth a head of the 10 marts with most relay income against the median trader with through-traffic.
  {
    const idx = pr.relay.map((_, i) => i).sort((a, b) => pr.relay[b] - pr.relay[a])
    const top = idx.slice(0, 10).map((i) => pr.wph[i])
    const hubs = pr.wph.filter((_, i) => pr.through[i] > 3000)
    row.entrepot = med(top) / med(hubs)
    row.entrepotTown = med(idx.slice(0, 10).map((i) => pr.wphTown[i])) / med(pr.wphTown.filter((_, i) => pr.through[i] > 3000))
  }
  // T8: bypassed marts that lose >= 30% of people or wealth within 100 years.
  {
    let n = 0, lost = 0
    for (const e of ev) {
      if (e.type !== EventType.Bypassed) continue
      n++
      const q0 = Math.floor(e.year / h.snapshotInterval)
      const q1 = Math.min(h.snapshotCount - 1, Math.floor((e.year + 100) / h.snapshotInterval))
      const i = e.settlement
      // (wealth: the town's and its merchant houses', goods/merchants.ts)
      const mwOf = (q: number): number => (h.merchantWealth.length ? h.merchantWealth[q * S + i] : 0)
      const p0 = h.population[q0 * S + i], w0 = h.wealth[q0 * S + i] + mwOf(q0)
      let pmin = p0, wmin = w0
      for (let q = q0; q <= q1; q++) { pmin = Math.min(pmin, h.population[q * S + i]); wmin = Math.min(wmin, h.wealth[q * S + i] + mwOf(q)) }
      if (pmin <= 0.7 * p0 || wmin <= 0.7 * w0) lost++
    }
    row.bypassed = n; row.bypassDecline = n ? lost / n : NaN
  }
  // T9: arms in war: share of decided wars won by the side with more arms a head (when one has twice the other's).
  {
    let won = 0, n = 0
    const W = h.wars
    for (let k = 0; k < W.count; k++) {
      const o = W.outcome[k]
      if (o !== 2 && o !== 3 && o !== 4) continue
      const a = pr.polArms.get(Math.floor(W.startYear[k] / 10))
      if (!a) continue
      const xa = a[W.attacker[k]], xd = a[W.defender[k]]
      if (!(xa > 0 || xd > 0) || (xa < 2 * xd && xd < 2 * xa)) continue
      n++
      const attWon = o === 2 || o === 4
      if ((xa > xd) === attWon) won++
    }
    row.armsWin = n ? won / n : NaN; row.armsWars = n
  }
  // T10: tools.
  row.toolMed = med(pr.toolMul); row.toolP90 = pct(pr.toolMul, 0.9)
  // T12: traditions.
  row.traditions = h.traditions.length
  row.renowned = count(EventType.TraditionRenowned)
  let carried = 0
  for (const t of h.traditions) if (t.parent >= 0 && h.traditions[t.parent].people !== t.people) carried = 1
  row.carried = carried
  // T13: the bonanza: Treasure price index 50 years after its find against before, and the mine town's growth in 30 years.
  {
    const bon = h.deposits.find((d) => d.kind === DepositKind.Silver && d.richness >= 4)
    row.boom = count(EventType.Boom)
    if (bon && bon.foundYear >= 0) {
      const d0 = Math.floor(bon.foundYear / 10)
      const b = pr.treasure[d0] ?? NaN, a = Math.min(...pr.treasure.slice(d0 + 1, d0 + 6).filter((x) => Number.isFinite(x)), NaN)
      row.bonanzaPrice = a / b
      const ev2 = ev.find((e) => e.type === EventType.Built && h.structures[e.other]?.type === 4 && h.structures[e.other].cell === bon.cell)
      const town = ev2 ? ev2.settlement : -1
      if (town >= 0) {
        const q0 = Math.floor(bon.foundYear / h.snapshotInterval), q1 = Math.min(h.snapshotCount - 1, q0 + 6)
        row.bonanzaGrowth = h.population[q1 * S + town] / Math.max(1, h.population[q0 * S + town])
      }
    }
  }
  // T14: no runaway.
  {
    const q = h.snapshotCount - 1
    let tot = 0, top = 0
    for (let i = 0; i < S; i++) { const x = h.wealth[q * S + i]; tot += x; if (x > top) top = x }
    row.topShare = tot > 0 ? top / tot : NaN
    let fastest = 0
    for (let q2 = 20; q2 < h.snapshotCount; q2 += 20) for (let i = 0; i < S; i++) {
      const a = h.wealth[(q2 - 20) * S + i], b = h.wealth[q2 * S + i]
      if (a > 1000 && h.mart[Math.floor((q2 * h.snapshotInterval) / h.tradeInterval) * S + i] && b / a > fastest) fastest = b / a
    }
    row.fastestMart = fastest
  }
  // Memory of the new arrays.
  row.memMB = (h.depositOutput.byteLength + h.traditionQuality.byteLength + h.industry.byteLength + h.metal.byteLength + h.longHaulVolume.byteLength + h.priceIndex.byteLength + h.mart.byteLength + h.secretGuard.byteLength + h.longHaul.path.byteLength + h.secretHolds.count * 16) / 1e6
  row.deposits = h.deposits.length; row.found = h.deposits.filter((d) => d.foundYear >= 0).length
  row.varieties = h.varieties.length
  return { seed, row, detail: detail ? detailOf(h, run.diag.goods, pr) : '' }
}

/** Per-seed printouts: deposits, traditions, secrets and leaks, marts, lanes, prices, bypassed marts, technology per people. */
function detailOf(h: History, gd: { expYear: number[]; expOutcome: number[] } | undefined, pr: Probe): string {
  const S = h.settlements.length
  const name = (i: number): string => (i >= 0 && i < S ? h.settlements[i].name : '-')
  const pname = (p: number): string => (p >= 0 ? h.peoples[p].name : 'stateless')
  const out: string[] = []
  out.push(`  deposits (${h.deposits.length}):`)
  for (const d of h.deposits) out.push(`    #${d.id} ${DK[d.kind]} rich ${d.richness.toFixed(1)} cell ${d.cell}: ${d.foundYear >= 0 ? `found ${d.foundYear} by ${name(d.foundBy)}` : 'never found'}${d.exhaustedYear >= 0 ? `, gave out ${d.exhaustedYear}` : ''}${d.variety >= 0 ? ` (${h.varieties[d.variety].maker} ${DK[d.kind]})` : ''}`)
  out.push(`  traditions (${h.traditions.length}):`)
  for (const t of h.traditions) {
    const q = h.traditionQuality
    let best = 0
    for (let k = 0; k < h.tradeSnapshotCount; k++) best = Math.max(best, q[k * h.traditions.length + t.id])
    out.push(`    #${t.id} "${t.maker}" ${CRAFT[t.craft]} of ${pname(t.people)}, born ${t.bornYear} at ${name(t.bornAt)}${t.parent >= 0 ? ` (daughter of #${t.parent})` : ''}, seats ${t.seats.length}, best quality ${(best / 64).toFixed(2)}${t.endYear >= 0 ? `, lost ${t.endYear}` : ''}`)
  }
  out.push(`  secrets (${h.secrets.length}):`)
  for (const x of h.secrets) {
    const subj = x.kind === SecretKind.Species ? SPECIES_TABLE[x.subject].archetype : x.kind === SecretKind.Craft ? (x.subject === 3 ? 'steel' : 'purple') : `chart of leg ${x.subject}`
    const hs: string[] = []
    const H = h.secretHolds
    for (let i = 0; i < H.count; i++) if (H.secret[i] === x.id) hs.push(`${pname(H.people[i])} ${H.from[i]}-${H.to[i] < 0 ? '' : H.to[i]} (${CH[H.channel[i]]}${H.via[i] >= 0 ? ' via ' + name(H.via[i]) : ''})`)
    if (x.kind === SecretKind.Chart && hs.length <= 1) continue
    out.push(`    #${x.id} ${subj} from ${x.foundYear}${x.lostYear >= 0 ? `, lost ${x.lostYear}` : ''}: ${hs.join('; ')}`)
  }
  const charts = h.secrets.filter((x) => x.kind === SecretKind.Chart).length
  out.push(`    (${charts} charts, those never shared not listed)`)
  const qL = h.tradeSnapshotCount - 1
  const marts: string[] = []
  for (let i = 0; i < S; i++) if (h.mart[qL * S + i]) marts.push(name(i))
  out.push(`  marts at the end (${marts.length}): ${marts.slice(0, 40).join(', ')}${marts.length > 40 ? ' ...' : ''}`)
  out.push(`  lanes:`)
  for (const e of h.events) if (e.type === EventType.DirectRoute) {
    const k = e.value
    let deep = 0
    const v = e.extra ?? -1
    out.push(`    ${e.year} ${name(e.settlement)} (${pname(h.settlements[e.settlement].people)}) to ${name(e.other)} for ${v >= 0 ? h.varieties[v].maker + ' ' + varietyNoun(h, v) : '?'}: leg ${k}, ${h.longHaul.pathOffsets[k + 1] - h.longHaul.pathOffsets[k]} cells${deep ? '' : ''}${h.longHaul.closedYear[k] >= 0 ? `, closed ${h.longHaul.closedYear[k]}` : ''}`)
  }
  if (gd) out.push(`    trade expeditions ${gd.expYear.length}: sailed ${gd.expOutcome.filter((x) => x > 0).length}, lost ${gd.expOutcome.filter((x) => x === 2).length}, no target ${gd.expOutcome.filter((x) => x === 0).length}`)
  out.push(`  posts:`)
  for (const p of h.posts) out.push(`    #${p.id} ${['factory', 'fort', 'station', 'camp'][p.kind]} of ${name(p.owner)} ${p.kind === 0 ? 'at ' + name(p.host) : 'at ' + name(p.settlement)} ${p.foundedYear}-${p.endedYear < 0 ? '' : p.endedYear}`)
  out.push(`  price of the top luxury, far / source (decades):`)
  const byV = new Map<number, string[]>()
  for (let i = 0; i < pr.price.length; i += 5) {
    const v = pr.price[i + 1]
    if (!byV.has(v)) byV.set(v, [])
    ;(byV.get(v) as string[]).push(`${pr.price[i]}:${(pr.price[i + 3] / pr.price[i + 2]).toFixed(1)}x@${(pr.price[i + 4] / 1000).toFixed(1)}Mm`)
  }
  const vs = [...byV.keys()].sort((a, b) => (byV.get(b) as string[]).length - (byV.get(a) as string[]).length).slice(0, 2)
  for (const v of vs) out.push(`    ${h.varieties[v].maker} ${varietyNoun(h, v)}: ${(byV.get(v) as string[]).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 24)) === 0).join(' ')}`)
  out.push(`  bypassed:`)
  for (const e of h.events) if (e.type === EventType.Bypassed) {
    const q0 = Math.floor(e.year / h.snapshotInterval), q1 = Math.min(h.snapshotCount - 1, q0 + 20)
    out.push(`    ${e.year} ${name(e.settlement)} by the lane of ${name(e.other)} (lost ${((e.extra ?? 0) * 100).toFixed(0)}% of relay income): pop ${h.population[q0 * S + e.settlement].toFixed(0)} -> ${h.population[q1 * S + e.settlement].toFixed(0)} in 100 years, wealth ${h.wealth[q0 * S + e.settlement].toFixed(0)} -> ${h.wealth[q1 * S + e.settlement].toFixed(0)}`)
  }
  out.push(`  technology per people (F S M C) at 500 / 1000 / 1500 / 2000:`)
  const P = h.peoples.length
  for (let p = 0; p < P; p++) {
    const cols: string[] = []
    for (const y of [500, 1000, 1500, 2000]) {
      const q = Math.floor(y / h.snapshotInterval)
      cols.push([0, 1, 2, 3].map((f) => h.technology[(q * P + p) * 4 + f].toFixed(2)).join(' '))
    }
    out.push(`    ${pname(p).padEnd(10)} ${cols.join(' | ')}`)
  }
  return out.join('\n')
}

function varietyNoun(h: History, v: number): string {
  const x = h.varieties[v]
  if (x.kind === 1) return SPECIES_TABLE[x.source].archetype
  if (x.kind === 2) return DK[h.deposits[x.source].kind]
  if (x.kind === 3) return CRAFT[h.traditions[x.source].craft]
  if (x.kind === 4) return 'furs'
  return 'goods'
}

/** Target table across seeds (design 11.1 and the milestone brief). */
export function formatGoodsStats(rows: GoodsSeedStats[]): string {
  const col = (k: string): number[] => rows.map((r) => r.row[k])
  const m = (k: string): string => fmt(med(col(k)), 2)
  const sum = (k: string): number => col(k).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
  const L: string[] = []
  L.push(`goods: medians over ${rows.length} seeds (goods on | off)`)
  L.push(`  time ms ${m('ms')} (max ${fmt(Math.max(...col('ms')), 0)}) | off ${m('msOff')}`)
  for (const y of [500, 1000, 1500, 2000]) L.push(`  ${y}: pop ${fmt(med(col('pop' + y)), 0)} | ${fmt(med(col('pop' + y + 'Off')), 0)}; living ${m('living' + y)} | ${m('living' + y + 'Off')}; routes ${m('routes' + y)} | ${m('routes' + y + 'Off')}`)
  L.push(`  towns ${m('towns')} | ${m('townsOff')}; cities ${m('cities')} | ${m('citiesOff')}; first state ${m('firstState')} | ${m('firstStateOff')}; states 2+ ${m('states2')} | ${m('states2Off')}; extinct ${sum('extinct')} | ${sum('extinctOff')}`)
  L.push(`  wealth a head at 2000 ${m('wph')} | ${m('wphOff')} (T14 within +-30%); top settlement share ${m('topShare')} (<= .15); fastest mart wealth growth in a century ${m('fastestMart')}x (<= 19, 3%/yr)`)
  L.push(`  technology spread F/S/M/C at 2000: ${m('spreadF')}/${m('spreadS')}/${m('spreadM')}/${m('spreadC')} | ${m('spreadFOff')}/${m('spreadSOff')}/${m('spreadMOff')}/${m('spreadCOff')} (T11: M >= .4, C >= .3); max C ${m('maxC')} | ${m('maxCOff')}`)
  L.push(`  T1 named luxury and fine cloth distance from origin km: median ${m('distMed')} p90 ${m('distP90')} (>= 800, >= 4000)`)
  L.push(`  T2 HV share of trade value ${m('hvShare')} (.20-.35)`)
  L.push(`  T3 top luxury far / source price: median ${m('priceRatioMed')}, peak ${m('pricePeak')}; before its lane ${m('priceBefore')}, 30-60 years after ${m('priceAfter')} (a lane for it in ${sum('priceLaneOwn')}/${rows.length})`)
  L.push(`  T4 lanes ${m('lanes')} (6-30) per world, ocean-spanning in ${col('oceanLanes').filter((x) => x > 0).length}/${rows.length} (>= 14/20); first lane ${m('firstLane')} (1250-1700); relay legs ${m('relayLegs')}, marts ${m('marts')}`)
  L.push(`  trade expeditions ${m('tradeExp')} (sailed ${m('tradeSailed')}, lost ${m('tradeLost')}; after 1500 ${m('tradeExpLate')})`)
  L.push(`  T5 posts ${m('posts')} (4-25), forts ${m('forts')}; a fort or station became a town in ${sum('fortOrStationTown')}/${rows.length} (>= 6/20), a fort in ${sum('fortTown')}/${rows.length}`)
  L.push(`  T6 secrets ${m('secrets')}, held >= 50 years ${m('secrets50')} (2-6), years to first leak species ${m('durSpecies')} craft ${m('durCraft')} chart ${m('durChart')}; never leak ${m('neverLeak')} (<= .3); leaks ${m('leaks')}, broken ${m('monoBroken')}`)
  L.push(`     leak channels seen across seeds: ${CH.map((c, i) => `${c} ${sum('ch' + i)}`).join(', ')} (>= 5 channels)`)
  L.push(`  T7 entrepots: top-10 relay marts' wealth a head (town and merchants) / median hub's ${m('entrepot')} (>= 2); the towns' alone ${m('entrepotTown')}; merchant capital share of all wealth ${m('merchShare')}`)
  L.push(`  T8 bypassed ${m('bypassed')} per world, declining within 100 years ${m('bypassDecline')} (>= .5)`)
  L.push(`  T9 arms: decided wars won by the better armed (2x) side ${m('armsWin')} over ${m('armsWars')} wars (>= .6)`)
  L.push(`  T10 tools farm multiplier median ${m('toolMed')} p90 ${m('toolP90')} (gain .05-.15 where plentiful)`)
  L.push(`  T12 traditions ${m('traditions')} (6-20), renowned ${m('renowned')} (2-6), carried to another people in ${sum('carried')}/${rows.length} (>= 12/20)`)
  L.push(`  T13 booms ${sum('boom')}; Treasure price 50 years after the bonanza / before ${m('bonanzaPrice')} (<= .7); mine town growth in 30 years ${m('bonanzaGrowth')} (>= 2)`)
  L.push(`  deposits ${m('deposits')}, found ${m('found')}; varieties ${m('varieties')}; memory of the goods arrays ${m('memMB')} MB`)
  L.push('  per seed: ' + rows.map((r) => `${r.seed}: lanes ${r.row.lanes} trad ${r.row.traditions} sec ${r.row.secrets} leaks ${r.row.leaks} pop ${fmt(r.row.pop2000 / 1000, 0)}k|${fmt(r.row.pop2000Off / 1000, 0)}k`).join('; '))
  return L.join('\n')
}

export function runGoodsStats(seeds: number[], off: boolean, detail: number[]): string {
  const rows: GoodsSeedStats[] = []
  for (const seed of seeds) rows.push(goodsSeedStats(seed, off, detail.indexOf(seed) >= 0))
  const out = [formatGoodsStats(rows)]
  for (const r of rows) if (r.detail) out.push(`\n== seed ${r.seed}\n${r.detail}`)
  return out.join('\n')
}

if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) {
  const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
  const args = argv.slice(2)
  const off = !args.includes('--no-off')
  const di = args.indexOf('--detail')
  const detail = di >= 0 ? args.slice(di + 1).filter((a: string) => !a.startsWith('--')).map(Number) : []
  const seeds = di >= 0 ? detail : args.filter((a: string) => !a.startsWith('--')).map(Number)
  console.log(runGoodsStats(seeds.length ? seeds : HISTORY_STATS_SEEDS, off, detail))
}
