// goods: marts (entrepots) and the long-haul layer (design 3.5).
//
// Marts are rebuilt every 10 years: traders of some size scored by the traffic through them, ports and capitals counted
// extra, best first up to a cap, with the forced members (trading posts, mines of Treasure, tradition seats, the largest
// grower of each secret or rare luxury, the ends of lanes). Relay legs join each mart to its nearest few marts over the
// settlement links (a search through what its people knows, to marts of peoples in contact); lanes are direct ways opened
// by trade expeditions (routes.ts). Every year, after the local market, merchants move high-value goods along the legs
// (cheapest first, both ways, one leg a year): goods go from a to b when b's buying price (its forward price, what its
// merchants can get two markets on, while their warehouses have room) beats a's price plus transport, times the relay
// markup (merchant's return for the year and the risk of the way). The carrier keeps most of the net gap, so merchant
// capital builds up at entrepots; lanes carry at most their capacity and lose some cargo to the sea.

import { EventType, GOOD_COUNT, LegKind, TECH_FIELD_COUNT, TechField } from '../../../contract.ts'
import { GOODS, MIGRATION, TRADE, WEALTH } from '../params.ts'
import type { HistoryState } from '../state.ts'
import type { TradeState } from '../trade.ts'
import { chainPath } from '../trade.ts'
import { moveMuls } from '../species.ts'
import { Heap } from '../heap.ts'
import { Tier, tierOf } from '../polity/state.ts'
import { embargoed } from '../polity/system.ts'
import { CLASS, FLAGS, LANE, MART, MIDDLE, STOCK } from './params.ts'
import type { GoodsState } from './state.ts'
import { K, M, MIX_OF, density, ensureLegs, logGoods, mixFlow, mixScale, noteIncome } from './state.ts'
import { buyPrice, hvPrice, sellPrice } from './market.ts'

const G = GOOD_COUNT
const KEY = 1 << 20
/** High-value classes that move on legs. */
const LEG_GOODS = [7, 8, 9, 10, 11]

/** Merchant's return r of settlement x (falls with Crafts). */
function rOf(s: HistoryState, x: number): number {
  const cr = s.tech[s.people[x] * TECH_FIELD_COUNT + TechField.Crafts]
  return MIDDLE.r0 / (1 + MIDDLE.rTech * (cr - 1))
}

/** Transport factor of a leg's two ends: 1 / (1 + transportTech * (mean Crafts - 1)) times their pack animals. */
function legFactor(s: HistoryState, ts: TradeState, a: number, b: number): number {
  const cr = 0.5 * (s.tech[s.people[a] * TECH_FIELD_COUNT + TechField.Crafts] + s.tech[s.people[b] * TECH_FIELD_COUNT + TechField.Crafts])
  return (0.5 * (ts.pack[a] + ts.pack[b])) / (1 + GOODS.transportTech * (cr - 1))
}

const MA = new Float64Array(3), MB = new Float64Array(3)
/** Trade travel cost along a cell path between settlements a and b this year (as trade.ts routeCost does for a route). */
export function pathCost(s: HistoryState, path: readonly number[], a: number, b: number): number {
  const T = s.terrain
  const pa = s.port[a] >= 0, pb = s.port[b] >= 0
  const seaMul = 0.5 * ((pa ? TRADE.seaPort : TRADE.seaNoPort) + (pb ? TRADE.seaPort : TRADE.seaNoPort))
  const oc = (id: number, port: boolean): number => ((MIGRATION.oceanCost * T.cellScale) / Math.sqrt(s.tech[s.people[id] * TECH_FIELD_COUNT + TechField.Seafaring])) * (port ? TRADE.oceanPort : TRADE.oceanNoPort)
  const ocean = 0.5 * (oc(a, pa) + oc(b, pb))
  moveMuls(s, a, MA)
  moveMuls(s, b, MB)
  const mcls = s.sp.moveClass
  let cost = 0
  for (let k = 1; k < path.length; k++) {
    const j = path[k]
    cost += T.deep[j] ? ocean : T.sea[j] ? T.moveCost[j] * seaMul : s.moveCost[j] * 0.5 * (MA[mcls[j]] + MB[mcls[j]])
  }
  return cost
}

/** Opens (or reopens) the leg between marts a and b of `kind` along `path`; returns its id. */
export function openLeg(s: HistoryState, g: GoodsState, a: number, b: number, kind: number, path: number[], cost: number): number {
  const lo = a < b ? a : b, hi = a < b ? b : a
  const key = kind === LegKind.Relay ? lo * KEY + hi : -1
  let k = key >= 0 ? g.legIndex.get(key) ?? -1 : -1
  if (k >= 0 && g.legKind[k] === LegKind.Relay) {
    g.legPath[k] = path
    g.legCost[k] = cost
    if (!g.legOpen[k]) { g.legOpen[k] = 1; g.legClosed[k] = -1 }
    return k
  }
  k = g.legCount++
  ensureLegs(g, g.legCount)
  if (key >= 0) g.legIndex.set(key, k)
  g.legA.push(kind === LegKind.Lane ? a : lo)
  g.legB.push(kind === LegKind.Lane ? b : hi)
  g.legKind.push(kind)
  g.legOpened.push(s.year)
  g.legClosed.push(-1)
  g.legChart.push(-1)
  g.legPath.push(kind === LegKind.Relay && a > b ? path.slice().reverse() : path)
  g.legCost.push(cost)
  g.legOpen.push(1)
  g.legCap.push(0)
  g.legUse.push(0)
  g.legSailed.push(0)
  g.legIdle.push(0)
  g.legVariety.push(-1)
  g.legHazard.push(0)
  g.legRisk0.push(0)
  g.legProfit.push(0)
  return k
}

/** Closes leg k this year. */
export function closeLeg(s: HistoryState, g: GoodsState, k: number): void {
  if (!g.legOpen[k]) return
  g.legOpen[k] = 0
  g.legClosed[k] = s.year
}

let SD = new Float64Array(0), SP2 = new Int32Array(0), SS = new Int32Array(0)
let SRUN = 0
const HEAP = new Heap(256)

/**
 * Every 10 years (year % 10 = 1): marts, relay legs, the open legs cheapest first.
 */
export function rebuildMarts(s: HistoryState, ts: TradeState, g: GoodsState): void {
  const living = s.living
  const S = s.count
  const isMart = g.isMart
  isMart.fill(0, 0, g.cap)
  const ps = s.pol
  // Score and the forced members.
  const cand: number[] = [], score: number[] = []
  const forced = FORCED.length >= S ? FORCED : (FORCED = new Uint8Array(2 * S))
  forced.fill(0, 0, S)
  for (let i = 0; i < g.postCount; i++) { const x = g.pSettlement[i]; if (x >= 0 && g.pEnded[i] < 0) forced[x] = 1 }
  for (let d = 0; d < g.dCount; d++) { const x = g.dWorker[d]; if (x >= 0 && g.dFound[d] >= 0 && g.dExh[d] < 0 && g.dKind[d] <= 3) forced[x] = 1 }
  for (let t = 0; t < g.tCount; t++) { if (g.tEnd[t] >= 0) continue; const se = g.tSeats[t], to = g.tSeatTo[t]; for (let k = 0; k < se.length; k++) if (to[k] < 0) forced[se[k]] = 1 }
  for (let v = 1; v < g.vCount; v++) { if (g.vKind[v] === 1 && (g.vSecret[v] >= 0 || g.vValue[v] >= 20) && g.vOrigin[v] >= 0) forced[g.vOrigin[v]] = 1 }
  for (const k of g.lanes) if (g.legOpen[k]) { forced[g.legA[k]] = 1; forced[g.legB[k]] = 1 }
  const ref = WEALTH.hubRef
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    if (!ts.trader[id]) continue
    if (forced[id]) { isMart[id] = 1; continue }
    if (s.pop[id] < MART.minPop) continue
    let sc = s.through[id] + (s.port[id] >= 0 ? MART.port * ref : 0)
    if (ps !== null && id < ps.seen) {
      const p = ps.polity[id]
      if (p >= 0 && ps.pCapital[p] === id && tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1) >= Tier.Kingdom) sc += MART.capital * ref
    }
    cand.push(id); score.push(sc)
  }
  const order = cand.map((_, i) => i)
  order.sort((x, y) => score[y] - score[x] || cand[x] - cand[y])
  const cap = Math.max(8, Math.round((MART.maxMarts * s.terrain.cellCount) / 23042))
  for (let i = 0; i < order.length && i < cap; i++) isMart[cand[order[i]]] = 1
  // Relay legs: the nearest marts over the links, through known land, of peoples in contact.
  if (SD.length < S) { SD = new Float64Array(2 * S); SP2 = new Int32Array(2 * S); SS = new Int32Array(2 * S) }
  const seen = new Uint8Array(g.legCount)
  const know = s.know
  for (let t = 0; t < living.length; t++) {
    const m = living[t]
    if (!isMart[m] || m >= ts.adjCount) continue
    const reach = MART.reach * TRADE.reach * (1 + GOODS.transportTech * (s.tech[s.people[m] * TECH_FIELD_COUNT + TechField.Crafts] - 1)) * (s.port[m] >= 0 ? TRADE.portReach : 1)
    const run = ++SRUN
    HEAP.size = 0
    SS[m] = run; SD[m] = 0; SP2[m] = -1
    HEAP.push(0, m)
    const kBase = s.people[m] * know.N
    let visits = 0, found = 0
    while (HEAP.size > 0 && visits < MART.maxNodes && found < MART.relay) {
      const d = HEAP.topKey()
      const u = HEAP.pop()
      if (d > SD[u]) continue
      visits++
      if (u !== m && isMart[u] && ts.trader[u]) {
        const pu = s.people[u], pm = s.people[m]
        if (pu === pm || know.contact[pm * know.P + pu] >= 0) {
          found++
          const chain: number[] = []
          for (let x = u; x >= 0; x = SP2[x]) chain.push(x)
          chain.reverse()
          const key = (m < u ? m : u) * KEY + (m < u ? u : m)
          const old = g.legIndex.get(key)
          if (old === undefined || !seen[old]) {
            const path = chainPath(s, ts, chain)
            const k = openLeg(s, g, m, u, LegKind.Relay, path, pathCost(s, path, m, u))
            if (k < seen.length) seen[k] = 1
            else SEEN_NEW.push(k)
          }
          continue
        }
      }
      for (let e = ts.adjOff[u]; e < ts.adjOff[u + 1]; e++) {
        const v = ts.adjNode[e]
        if (know.known[kBase + s.cell[v]] < 0) continue
        const nd = d + ts.edgeCost[ts.adjEdge[e]]
        if (nd > reach) continue
        if (SS[v] === run && nd >= SD[v]) continue
        SS[v] = run; SD[v] = nd; SP2[v] = u
        HEAP.push(nd, v)
      }
    }
  }
  // Relay legs not found again close; lanes stay (their ends are kept marts).
  for (let k = 0; k < seen.length; k++) if (g.legOpen[k] && g.legKind[k] === LegKind.Relay && !seen[k]) closeLeg(s, g, k)
  SEEN_NEW.length = 0
  // Lane costs follow the holders' technology; open legs cheapest first.
  const open: number[] = []
  for (let k = 0; k < g.legCount; k++) {
    if (!g.legOpen[k]) continue
    if (g.legKind[k] === LegKind.Lane) g.legCost[k] = pathCost(s, g.legPath[k], g.legA[k], g.legB[k])
    open.push(k)
  }
  open.sort((x, y) => g.legCost[x] - g.legCost[y] || x - y)
  g.legOrder = open
}
let FORCED = new Uint8Array(0)
const SEEN_NEW: number[] = []

/** Adjacency of the open legs per mart (rebuilt with the forward prices each year; CSR over settlement ids). */
let ADJ_OFF = new Int32Array(0), ADJ_LEG = new Int32Array(0)

/**
 * Market hook (trade.ts, after stocking, before the sweeps): forward prices of the marts for the HV classes, H rounds of
 * F_m = max(p_m, max over legs (F_n / (1 + mu) - t)).
 */
export function forwardPrices(s: HistoryState, ts: TradeState, g: GoodsState): void {
  const order = g.legOrder
  const S = s.count
  if (ADJ_OFF.length < S + 1) ADJ_OFF = new Int32Array(2 * S + 2)
  ADJ_OFF.fill(0, 0, S + 1)
  let n = 0
  for (const k of order) { if (!g.legOpen[k]) continue; ADJ_OFF[g.legA[k] + 1]++; ADJ_OFF[g.legB[k] + 1]++; n += 2 }
  for (let i = 0; i < S; i++) ADJ_OFF[i + 1] += ADJ_OFF[i]
  if (ADJ_LEG.length < n) ADJ_LEG = new Int32Array(2 * n)
  const fill = FILL.length >= S ? FILL : (FILL = new Int32Array(2 * S))
  for (let i = 0; i < S; i++) fill[i] = ADJ_OFF[i]
  for (const k of order) { if (!g.legOpen[k]) continue; ADJ_LEG[fill[g.legA[k]]++] = k; ADJ_LEG[fill[g.legB[k]]++] = k }
  const price = ts.price
  const fwd = g.fwd
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    if (!g.isMart[id]) continue
    for (const gd of LEG_GOODS) { fwd[id * G + gd] = price[id * G + gd]; g.fwdVia[id * G + gd] = -1 }
  }
  if (order.length === 0) return
  const nxt = NXT.length >= S * LEG_GOODS.length ? NXT : (NXT = new Float64Array(2 * S * LEG_GOODS.length))
  if (NVIA.length < nxt.length) NVIA = new Int32Array(nxt.length)
  for (let h = 0; h < MART.H; h++) {
    for (let t = 0; t < living.length; t++) {
      const m = living[t]
      if (!g.isMart[m] || !ts.trader[m]) continue
      for (let j = 0; j < LEG_GOODS.length; j++) {
        const gd = LEG_GOODS[j]
        let best = price[m * G + gd], via = -1
        for (let e = ADJ_OFF[m]; e < ADJ_OFF[m + 1]; e++) {
          const k = ADJ_LEG[e]
          const n2 = g.legA[k] === m ? g.legB[k] : g.legA[k]
          if (!ts.trader[n2]) continue
          const mu = rOf(s, n2) * MART.legYears + MART.risk + g.legHazard[k]
          const tc = CLASS.transport[gd] * g.legCost[k] * legFactor(s, ts, m, n2)
          if (g.fwdVia[n2 * G + gd] === m) continue // (a price that comes back through m itself)
          const f = fwd[n2 * G + gd] / (1 + mu) - tc
          if (f > best) { best = f; via = n2 }
        }
        nxt[m * LEG_GOODS.length + j] = best
        NVIA[m * LEG_GOODS.length + j] = via
      }
    }
    for (let t = 0; t < living.length; t++) {
      const m = living[t]
      if (!g.isMart[m] || !ts.trader[m]) continue
      for (let j = 0; j < LEG_GOODS.length; j++) { fwd[m * G + LEG_GOODS[j]] = nxt[m * LEG_GOODS.length + j]; g.fwdVia[m * G + LEG_GOODS[j]] = NVIA[m * LEG_GOODS.length + j] }
    }
  }
}
let FILL = new Int32Array(0), NXT = new Float64Array(0), NVIA = new Int32Array(0)

/**
 * Market hook (trade.ts, after the local sweep): merchants move HV goods along the open legs, cheapest first, both ways.
 */
export function longHaulSweep(s: HistoryState, ts: TradeState, g: GoodsState): void {
  const order = g.legOrder
  const stock = ts.stock, price = ts.price, deriv = ts.deriv
  const pol = s.pol
  for (let i = 0; i < g.legCount; i++) g.legVol[i] = 0
  if (!FLAGS.longhaul) return
  for (const k of order) {
    if (!g.legOpen[k]) continue
    const a = g.legA[k], b = g.legB[k]
    if (s.abandoned[a] >= 0 || s.abandoned[b] >= 0 || !ts.trader[a] || !ts.trader[b]) continue
    if (pol !== null && embargoed(pol, a, b)) continue
    const lane = g.legKind[k] === LegKind.Lane
    const lf = legFactor(s, ts, a, b)
    const loss = lane ? g.legHazard[k] : 0
    let capLeft = lane ? g.legCap[k] - g.legUse[k] : Infinity
    for (let dir = 0; dir < 2; dir++) {
      const from = dir === 0 ? a : b, to = dir === 0 ? b : a
      const mu = rOf(s, to) * MART.legYears + MART.risk + loss
      for (const gd of LEG_GOODS) {
        if (lane && !(capLeft > 0)) break
        const kf = from * G + gd, kt = to * G + gd
        const S0 = stock[kf]
        if (!(S0 > 0)) continue
        const m = MIX_OF[gd]
        const tc = CLASS.transport[gd] * g.legCost[k] * lf * (m >= 0 ? density(g, from, m, S0) : 1)
        const pf = price[kf]
        const P = buyPrice(s, ts, g, to, gd, from)
        const pLocal = price[kt]
        const res = sellPrice(s, ts, g, from, gd) // (the seller's merchants hold out for their own forward price)
        const cost = (res + tc) * (1 + mu)
        const net = P - cost - TRADE.minGap * GOODS.value[gd]
        if (!(net > 0)) continue
        let q = (TRADE.damping * (P - cost)) / (deriv[kf] + deriv[kt])
        const most = 0.7 * S0
        if (q > most) q = most
        if (lane && q > capLeft) q = capLeft
        if (!(q > 1e-6)) continue
        const arrive = q * (1 - loss)
        stock[kf] = S0 - q
        stock[kt] += arrive
        if (m >= 0) mixFlow(g, from, to, m, arrive, S0)
        if (m >= 0 && loss > 0) mixScale(g, from, m, (S0 - q) / (S0 - arrive)) // (the cargo lost at sea leaves the sender's names too)
        // Income on what is realised: the season's return on the goods carried, and the gap to the buyer's own price (not
        // to the forward price it bought at, which it earns only when it sells on).
        let real = pLocal - (pf + tc) * (1 + mu) > 0 ? pLocal - (pf + tc) * (1 + mu) : 0
        const cap1 = STOCK.incomeGap * ts.worth[kt]
        if (real > cap1) real = cap1
        const carrier = real > 0 ? q * (mu * (pf + tc) + MART.carrier * real) : 0
        const gap = real
        ts.income[to] += carrier
        ts.income[from] += q * ((1 - MART.carrier) * gap + TRADE.margin * GOODS.value[gd])
        g.relayYear[to] += carrier
        noteIncome(s, g, 13, carrier + q * ((1 - MART.carrier) * gap + TRADE.margin * GOODS.value[gd]))
        trackVar(g, to, from, m, carrier)
        const loads = q * GOODS.value[gd]
        ts.throughYear[a] += TRADE.ownWeight * loads
        ts.throughYear[b] += TRADE.ownWeight * loads
        g.legVol[k] += q
        g.legGood[(k * G + gd) * 2 + dir] += q
        if (lane) { capLeft -= q; g.legUse[k] += q; if (s.year - g.legOpened[k] < 10) g.legProfit[k] += carrier }
        hvPrice(ts, kf, ts.demand[kf])
        hvPrice(ts, kt, ts.demand[kt])
      }
    }
  }
}

/** Relay income at mart `to` from goods of the sender's mix: the variety that brought it most this decade. */
function trackVar(g: GoodsState, to: number, from: number, m: number, amount: number): void {
  if (m < 0) return
  const o = (from * M + m) * K
  let best = 0, bv = 0
  for (let k = 0; k < K; k++) { const v = g.mixV[o + k]; if (v > 0 && g.mixA[o + k] > best) { best = g.mixA[o + k]; bv = v } }
  if (bv <= 0) return
  if (g.relayVarYear[to] === bv) g.relayVarAmt[to] += amount
  else if (amount > g.relayVarAmt[to]) { g.relayVarYear[to] = bv; g.relayVarAmt[to] = amount }
}

/** Yearly after the market: lanes' capacity follows their use, their losses fall with sailing; idle lanes close; FleetLost. */
export function laneYear(s: HistoryState, g: GoodsState, ts: TradeState): void {
  const X = LANE
  for (const k of g.lanes) {
    if (!g.legOpen[k]) continue
    const a = g.legA[k], b = g.legB[k]
    if (s.abandoned[a] >= 0 || s.abandoned[b] >= 0) { closeLeg(s, g, k); continue }
    const cap = g.legCap[k]
    const use = g.legUse[k]
    g.legUse[k] = 0
    if (use > 0) { g.legSailed[k]++; g.legIdle[k] = 0 } else if (++g.legIdle[k] >= X.idle) { closeLeg(s, g, k); continue }
    const u = cap > 0 ? use / cap : 0
    const top = X.capMax * s.pop[a] * s.tech[s.people[a] * TECH_FIELD_COUNT + TechField.Seafaring]
    let c = cap
    if (u > X.highUse) c *= X.grow
    else if (u < X.lowUse) c *= X.shrink
    if (c > top) c = top
    const floor = 0.5 * X.cap0 * (ts.demand[a * G + 7] > 0 ? ts.demand[a * G + 7] : 1)
    if (c < floor) c = floor
    g.legCap[k] = c
    // Risk falls as the way becomes known.
    const h = g.legHazard[k]
    if (use > 0 && h > 0) {
      const base = laneRisk(g, k)
      g.legHazard[k] = base / (1 + g.legSailed[k] / X.riskYears)
      if (g.rng.next() < h * X.fleetLost) logGoods(s, EventType.FleetLost, a, b, k, use * CLASS.worth[7])
    }
  }
}

/** Base loss rate of lane k (from its path's hazard, set at opening). */
function laneRisk(g: GoodsState, k: number): number {
  return g.legRisk0[k]
}
