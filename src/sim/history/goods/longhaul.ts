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
import type { PolityState } from '../polity/state.ts'
import { BANDIT, PIRACY, POLITY, SMUGGLE, TARIFF, WAYRISK } from '../polity/params.ts'
import { bound, embargoCode, enforcement as polEnforcement, privateers, refreshWayRisk } from '../polity/policy.ts'
import { cut as hubCut } from '../polity/outlaw.ts'
import { atWar } from '../polity/formation.ts'
import { CLASS, FLAGS, LANE, MART, MIDDLE, STOCK } from './params.ts'
import type { GoodsState } from './state.ts'
import { K, M, MIX_OF, density, ensureLegs, logGoods, mixFlow, mixScale, noteIncome } from './state.ts'
import { hvPrice, moveAmt, secretSmuggled, theta } from './market.ts'
import { ideaLand, ideaSea } from '../ideas/hooks.ts' // ideas:

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
  const ix = s.ideas
  const oc = (id: number, port: boolean): number => ((MIGRATION.oceanCost * T.cellScale) / Math.sqrt(s.tech[s.people[id] * TECH_FIELD_COUNT + TechField.Seafaring])) * (port ? TRADE.oceanPort : TRADE.oceanNoPort) / (ix !== null ? ideaSea(ix, s.people[id]) : 1) // (ideas:)
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
    g.legPath[k] = g.legA[k] === a ? path : path.slice().reverse() // (a relay leg's path runs from its lower end)
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
  g.legT.push(cost)
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
  g.fwdBid.fill(0)
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
      if (p >= 0 && ps.pCapital[p] === id && tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop) >= Tier.Kingdom) sc += MART.capital * ref
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
    let reach = MART.reach * TRADE.reach * (1 + GOODS.transportTech * (s.tech[s.people[m] * TECH_FIELD_COUNT + TechField.Crafts] - 1)) * (s.port[m] >= 0 ? TRADE.portReach : 1)
    if (s.ideas !== null) reach *= ideaLand(s.ideas, s.people[m]) // ideas:
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
let ADJ_OFF = new Int32Array(0)

/**
 * Market hook (trade.ts, after stocking, before the sweeps): forward prices of the marts for the HV classes, H rounds of
 * F_m = max(p_m, max over legs (F_n / (1 + mu) - t)).
 */
export function forwardPrices(s: HistoryState, ts: TradeState, g: GoodsState): void {
  // (Reckoned every other year: merchants' letters bring last season's prices.)
  if ((s.year & 1) === 1) return
  const order = g.legOrder
  const price = ts.price
  const fwd = g.fwd, via = g.fwdVia
  const living = s.living
  // The marts trading this year.
  const marts = MARTS
  marts.length = 0
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    if (!g.isMart[id]) continue
    for (let j = 0; j < NLG; j++) { const k = id * G + LEG_GOODS[j]; fwd[k] = price[k]; via[k] = -1; g.fwdBid[k] = 0 }
    if (ts.trader[id]) marts.push(id)
  }
  if (order.length === 0) return
  // Per open leg end: the other end, the markup and the transport of a class unit per unit of class transport (once a year).
  const S = s.count
  if (ADJ_OFF.length < S + 1) ADJ_OFF = new Int32Array(2 * S + 2)
  ADJ_OFF.fill(0, 0, S + 1)
  let n = 0
  for (let i = 0; i < order.length; i++) { const k = order[i]; if (!g.legOpen[k]) continue; ADJ_OFF[g.legA[k] + 1]++; ADJ_OFF[g.legB[k] + 1]++; n += 2 }
  for (let i = 0; i < S; i++) ADJ_OFF[i + 1] += ADJ_OFF[i]
  if (ADJ_N.length < n) { ADJ_N = new Int32Array(2 * n); ADJ_MU = new Float64Array(2 * n); ADJ_T = new Float64Array(2 * n) }
  const fill = FILL.length >= S ? FILL : (FILL = new Int32Array(2 * S))
  fill.set(ADJ_OFF.subarray(0, S)) // (a copy of the offsets)
  for (let i = 0; i < order.length; i++) {
    const k = order[i]
    if (!g.legOpen[k]) continue
    const a = g.legA[k], b = g.legB[k]
    const lt = g.legCost[k] * legFactor(s, ts, a, b)
    g.legT[k] = lt
    let e = fill[a]++
    ADJ_N[e] = b; ADJ_MU[e] = rOf(s, b) * MART.legYears + MART.risk + g.legHazard[k]; ADJ_T[e] = lt
    e = fill[b]++
    ADJ_N[e] = a; ADJ_MU[e] = rOf(s, a) * MART.legYears + MART.risk + g.legHazard[k]; ADJ_T[e] = lt
  }
  const S5 = S * NLG
  if (NXT.length < S5) { NXT = new Float64Array(2 * S5); NVIA = new Int32Array(2 * S5) }
  const nxt = NXT, nvia = NVIA
  const trader = ts.trader
  for (let h = 0; h < MART.H; h++) {
    for (let t = 0; t < marts.length; t++) {
      const m = marts[t]
      const e0 = ADJ_OFF[m], e1 = ADJ_OFF[m + 1]
      if (e0 === e1) continue
      for (let j = 0; j < NLG; j++) {
        const gd = LEG_GOODS[j]
        const tr = CLASS.transport[gd]
        let best = price[m * G + gd], bv = -1
        for (let e = e0; e < e1; e++) {
          const n2 = ADJ_N[e]
          if (!trader[n2]) continue
          const k2 = n2 * G + gd
          if (via[k2] === m) continue // (a price that comes back through m itself)
          const f = fwd[k2] / (1 + ADJ_MU[e]) - tr * ADJ_T[e]
          if (f > best) { best = f; bv = n2 }
        }
        nxt[m * NLG + j] = best
        nvia[m * NLG + j] = bv
      }
    }
    for (let t = 0; t < marts.length; t++) {
      const m = marts[t]
      if (ADJ_OFF[m] === ADJ_OFF[m + 1]) continue
      for (let j = 0; j < NLG; j++) { const k = m * G + LEG_GOODS[j]; fwd[k] = nxt[m * NLG + j]; via[k] = nvia[m * NLG + j] }
    }
  }
  // The merchants' bids for the season: forward price times their appetite (warehouses with room).
  for (let t = 0; t < marts.length; t++) {
    const m = marts[t]
    for (let j = 0; j < NLG; j++) { const gd = LEG_GOODS[j]; const k = m * G + gd; g.fwdBid[k] = fwd[k] * theta(s, ts, m, gd) }
  }
}
const NLG = LEG_GOODS.length
const MARTS: number[] = []
let ADJ_N = new Int32Array(0), ADJ_MU = new Float64Array(0), ADJ_T = new Float64Array(0)
let FILL = new Int32Array(0), NXT = new Float64Array(0), NVIA = new Int32Array(0)

/**
 * polities v2 on the long-haul legs (index = leg id): the polities of the two ends and their embargo, how hidden the way
 * is, enforcement at each end, the least policed settlement on the way (the smugglers' hub), privateers (refreshed every
 * POLITY.slowStep years, when the legs change and when a war begins or ends); pirates and bandits on the way (outlaw.ts
 * outlawStep, through legOutlaw) and the coastal settlements near each leg's sea cells (laneMap, through legLaneMap).
 */
export interface LegPolicy {
  n: number
  epoch: number
  year: number
  order: number[] | null
  pa: Int32Array
  pb: Int32Array
  block: Uint8Array
  hide: Float64Array
  ea: Float64Array
  eb: Float64Array
  hub: Int32Array
  hubE: Float64Array
  /** Sea cells on the leg's path, and the capital of an enemy's privateers on it (-1). */
  sea: Int32Array
  priv: Int32Array
  /** Pirates' and bandits' share of the cargo, and who takes it (outlawStep). */
  pir: Float64Array
  pirBy: Int32Array
  band: Float64Array
  bandBy: Int32Array
  /** Loads carried this year (the lane traffic that draws pirates). */
  loads: Float64Array
  /** Danger on the way (polities: policy.ts WAYRISK): the leg's worst cell risk (at the last full refresh). */
  risk: Float64Array
  /** Coastal settlements near each leg's sea cells (laneMap), CSR over legs [0, nearN). */
  nearN: number
  nearOff: Int32Array
  nearId: Int32Array
}

function makeLegPolicy(n: number): LegPolicy {
  return {
    n: 0, epoch: -1, year: -1000000, order: null,
    pa: new Int32Array(n), pb: new Int32Array(n), block: new Uint8Array(n), hide: new Float64Array(n), ea: new Float64Array(n), eb: new Float64Array(n),
    hub: new Int32Array(n).fill(-1), hubE: new Float64Array(n), sea: new Int32Array(n).fill(-1), priv: new Int32Array(n).fill(-1),
    pir: new Float64Array(n), pirBy: new Int32Array(n).fill(-1), band: new Float64Array(n), bandBy: new Int32Array(n).fill(-1), loads: new Float64Array(n),
    risk: new Float64Array(n),
    nearN: 0, nearOff: new Int32Array(1), nearId: new Int32Array(0),
  }
}

/** Grows leg policy arrays to n legs, keeping their contents. */
function growLegPolicy(lp: LegPolicy, n: number): LegPolicy {
  const x = makeLegPolicy(n)
  x.n = lp.n; x.epoch = lp.epoch; x.year = lp.year; x.order = lp.order
  x.pa.set(lp.pa); x.pb.set(lp.pb); x.block.set(lp.block); x.hide.set(lp.hide); x.ea.set(lp.ea); x.eb.set(lp.eb)
  x.hub.set(lp.hub); x.hubE.set(lp.hubE); x.sea.set(lp.sea); x.priv.set(lp.priv)
  x.pir.set(lp.pir); x.pirBy.set(lp.pirBy); x.band.set(lp.band); x.bandBy.set(lp.bandBy); x.loads.set(lp.loads); x.risk.set(lp.risk)
  x.nearN = lp.nearN; x.nearOff = lp.nearOff; x.nearId = lp.nearId
  return x
}

/** Sea cells on leg k's path (counted once). */
function legSea(s: HistoryState, g: GoodsState, lp: LegPolicy, k: number): number {
  let n = lp.sea[k]
  if (n >= 0) return n
  n = 0
  const path = g.legPath[k], sea = s.terrain.sea
  for (let i = 0; i < path.length; i++) if (sea[path[i]]) n++
  lp.sea[k] = n
  return n
}

let PRIV = new Int32Array(0)

/** The leg policy this year (see LegPolicy). */
function legPolicy(s: HistoryState, ps: PolityState, g: GoodsState): LegPolicy {
  let lp = g.legPol
  if (lp === null) { lp = makeLegPolicy(Math.max(64, g.legCount)); g.legPol = lp }
  if (lp.pa.length < g.legCount) { let n = lp.pa.length; while (n < g.legCount) n *= 2; lp = growLegPolicy(lp, n); g.legPol = lp }
  const full = lp.order !== g.legOrder || lp.n !== g.legCount || s.year - lp.year >= POLITY.slowStep
  if (!full && lp.epoch === ps.warEpoch) return lp
  if (PRIV.length < ps.pCapital.length) PRIV = new Int32Array(ps.pCapital.length * 2)
  privateers(s, ps, PRIV)
  lp.epoch = ps.warEpoch
  const { polity, defenseD } = ps
  const order = g.legOrder
  if (full) {
    lp.order = order; lp.n = g.legCount; lp.year = s.year
    // (a lane's path is fixed; a relay leg's may change when it is found again)
    for (let i = 0; i < order.length; i++) lp.sea[order[i]] = -1
    // Danger on the way (WAYRISK): each open leg's worst cell risk.
    refreshWayRisk(s, ps)
    const risk = ps.wayRisk
    for (let i = 0; i < order.length; i++) {
      const k = order[i]
      let R = 0
      if (g.legOpen[k]) { const path = g.legPath[k]; for (let j = 0; j < path.length; j++) if (risk[path[j]] > R) R = risk[path[j]] }
      lp.risk[k] = R
    }
  }
  const T = s.terrain
  const occ = s.occupant
  for (let i = 0; i < order.length; i++) {
    const k = order[i]
    if (!g.legOpen[k]) continue
    const a = g.legA[k], b = g.legB[k]
    const pa = a < ps.seen ? polity[a] : -1, pb = b < ps.seen ? polity[b] : -1
    const sea = legSea(s, g, lp, k)
    lp.priv[k] = sea > 0 ? (pa >= 0 && PRIV[pa] >= 0 ? PRIV[pa] : pb >= 0 && PRIV[pb] >= 0 ? PRIV[pb] : -1) : -1
    if (!full && lp.pa[k] === pa && lp.pb[k] === pb) { lp.block[k] = pa >= 0 && pb >= 0 && pa !== pb && !bound(ps, pa, pb) ? embargoCode(ps, pa, pb) : 0; continue }
    lp.pa[k] = pa; lp.pb[k] = pb
    lp.block[k] = pa >= 0 && pb >= 0 && pa !== pb && !bound(ps, pa, pb) ? embargoCode(ps, pa, pb) : 0
    if (pa === pb && pa < 0) { lp.hub[k] = -1; continue } // (stateless at both ends: no border to cross)
    // How hidden the way is, enforcement at each end, the least policed place on the way.
    const ca = s.cell[a], cb = s.cell[b]
    const path = g.legPath[k]
    let hub = -1, hubE = 2, outlaw = false
    for (let j = 1; j + 1 < path.length; j++) {
      const x = occ[path[j]]
      if (x < 0 || x === a || x === b || x >= ps.seen || s.abandoned[x] >= 0) continue
      const px = polity[x]
      if (px < 0 || s.outpost[x]) outlaw = true
      const e = px < 0 ? 0 : polEnforcement(s, ps, x, px)
      if (e < hubE) { hubE = e; hub = x }
    }
    const coastal = sea > 0 || T.seaCoast[ca] === 1 || T.seaCoast[cb] === 1
    lp.hide[k] = SMUGGLE.hideBase + (coastal ? SMUGGLE.hideSea : 0) + SMUGGLE.hideRough * 0.5 * (defenseD[ca] + defenseD[cb]) + (outlaw ? SMUGGLE.hideTransit : 0)
    lp.ea[k] = pa >= 0 ? polEnforcement(s, ps, a, pa) : 0
    lp.eb[k] = pb >= 0 ? polEnforcement(s, ps, b, pb) : 0
    lp.hub[k] = hub
    lp.hubE[k] = hubE
  }
  return lp
}

/** outlaw.ts laneMap hook: coastal settlements near each leg's sea cells; each one's lane traffic counts the loads the legs carried. */
export function legLaneMap(s: HistoryState, ps: PolityState, g: GoodsState): void {
  const lp = g.legPol
  if (lp === null || ps.seaNearOff === null) return
  const so = ps.seaNearOff, sc = ps.seaNearCell as Int32Array
  const L = g.legCount < lp.pa.length ? g.legCount : lp.pa.length
  const sea = s.terrain.sea
  const { lane, stamp } = ps
  const off = new Int32Array(L + 1)
  const ids: number[] = []
  for (let k = 0; k < L; k++) {
    off[k] = ids.length
    if (!g.legOpen[k] || legSea(s, g, lp, k) === 0) continue
    const a = g.legA[k], b = g.legB[k]
    const run = ++ps.run
    const path = g.legPath[k]
    const start = ids.length
    let alt = 0
    for (let i = 0; i < path.length && ids.length - start < LEG_NEAR_MAX; i++) {
      const j = path[i]
      if (!sea[j] || (alt++ & 1) === 1) continue
      for (let e = so[j]; e < so[j + 1]; e++) {
        const h = s.occupant[sc[e]]
        if (h < 0 || h === a || h === b || h >= ps.seen || stamp[h] === run || s.outpost[h]) continue
        stamp[h] = run
        ids.push(h)
      }
    }
    const v = lp.loads[k]
    if (v > 0) for (let i = start; i < ids.length; i++) lane[ids[i]] += v
  }
  off[L] = ids.length
  lp.nearN = L
  lp.nearOff = off
  lp.nearId = Int32Array.from(ids)
}
const LEG_NEAR_MAX = 32

/** outlaw.ts outlawStep hook: the worst pirate haven near each leg's sea cells (twice against an enemy at war) and bandits on relay legs' roads. */
export function legOutlaw(s: HistoryState, ps: PolityState, g: GoodsState): void {
  const lp = g.legPol
  if (lp === null) return
  const { pir, polity, lawless } = ps
  const L = g.legCount < lp.pa.length ? g.legCount : lp.pa.length
  for (let k = 0; k < L; k++) {
    lp.pir[k] = 0; lp.pirBy[k] = -1; lp.band[k] = 0; lp.bandBy[k] = -1
    if (!g.legOpen[k]) continue
    const a = g.legA[k], b = g.legB[k]
    if (k < lp.nearN) {
      let best = 0, bh = -1
      for (let e = lp.nearOff[k]; e < lp.nearOff[k + 1]; e++) {
        const h = lp.nearId[e]
        if (!(pir[h] > 0) || s.abandoned[h] >= 0) continue
        let v = PIRACY.lose * pir[h]
        const ph = polity[h]
        if (ph >= 0 && ((a < ps.seen && atWar(ps, ph, polity[a])) || (b < ps.seen && atWar(ps, ph, polity[b])))) v *= 2
        if (v > best) { best = v; bh = h }
      }
      lp.pir[k] = best > 0.5 ? 0.5 : best
      lp.pirBy[k] = bh
      if (bh >= 0) ps.taker[bh] = 1
    }
    if (g.legKind[k] !== LegKind.Relay) continue
    const path = g.legPath[k]
    if (path.length - legSea(s, g, lp, k) < 3) continue
    let band = a < ps.seen ? lawless[a] : 0, bb = a
    if (b < ps.seen && lawless[b] > band) { band = lawless[b]; bb = b }
    for (let j = 1; j + 1 < path.length; j++) { const x = s.occupant[path[j]]; if (x >= 0 && x < ps.seen && s.abandoned[x] < 0 && lawless[x] > band) { band = lawless[x]; bb = x } }
    lp.band[k] = band
    lp.bandBy[k] = band > 0 ? bb : -1
  }
}

/**
 * Market hook (trade.ts, after the local sweep): merchants move HV goods along the open legs, cheapest first, both ways.
 * polities v2: a leg's goods crossing a border pay the importer's duty (on their value at its price; only TARIFF.wedge of
 * it enters the gap), a share of them smuggled past it; between polities under an embargo or at war only contraband moves
 * (at SMUGGLE.premium times the transport); pirates, privateers and a blockade take a share of a leg's cargo at sea, bandits
 * on a relay leg's road raise its cost and take their toll. Duties, seizures, the smugglers' cut and plunder are paid at
 * once (and summed into the polities' accounts for the stats).
 */
export function longHaulSweep(s: HistoryState, ts: TradeState, g: GoodsState): void {
  const order = g.legOrder
  const stock = ts.stock, price = ts.price, deriv = ts.deriv, income = ts.income
  const ps = s.pol
  g.legVol.fill(0, 0, g.legCount)
  if (!FLAGS.longhaul) return
  const lp = ps !== null && order.length > 0 ? legPolicy(s, ps, g) : null
  if (lp !== null) lp.loads.fill(0)
  const V = GOODS.value
  const X = SMUGGLE
  for (const k of order) {
    if (!g.legOpen[k]) continue
    const a = g.legA[k], b = g.legB[k]
    if (s.abandoned[a] >= 0 || s.abandoned[b] >= 0 || !ts.trader[a] || !ts.trader[b]) continue
    const lane = g.legKind[k] === LegKind.Lane
    let lt = g.legT[k] // (route cost times the ends' transport factor, reckoned with the forward prices)
    const loss = lane ? g.legHazard[k] : 0
    // polities v2: the costs and dangers of the way, the border.
    let plund = 0, plTo = -1, blk = 0, pa = -1, pb = -1, bandShare = 0
    if (lp !== null) {
      const P2 = ps as PolityState
      pa = lp.pa[k]; pb = lp.pb[k]; blk = lp.block[k]
      const band = lp.band[k]
      if (band > 0) { lt *= 1 + BANDIT.cost * band; if (band >= BANDIT.toll) { plund += BANDIT.tollShare; bandShare = BANDIT.tollShare; plTo = lp.bandBy[k] } }
      const sea = lp.sea[k]
      if (sea > 0) {
        let pir = lp.pir[k], by = lp.pirBy[k]
        if (lp.priv[k] >= 0) { pir += PIRACY.privateer; if (by < 0) by = lp.priv[k] }
        if (pir > 0) { plund += pir; if (by >= 0) plTo = by }
        if (sea >= 2 && ((pa >= 0 && P2.pBlockade[pa] >= 0) || (pb >= 0 && P2.pBlockade[pb] >= 0))) plund += PIRACY.blockade
      }
      if (plund > 0.9) plund = 0.9
    }
    // (polities: the danger on the way, WAYRISK: a share of the cargo lost to war and raids, priced as the plunder is)
    const wr = lp !== null && WAYRISK.on ? WAYRISK.loss * lp.risk[k] : 0
    const ev = lp !== null && WAYRISK.on ? WAYRISK.escortValue * lp.risk[k] : 0 // (and the escorts dear goods need there, a share of their worth)
    const lost = loss + plund + wr > 0.95 ? 0.95 : loss + plund + wr
    let capLeft = lane ? g.legCap[k] - g.legUse[k] : Infinity
    for (let dir = 0; dir < 2; dir++) {
      const from = dir === 0 ? a : b, to = dir === 0 ? b : a
      const mu0 = rOf(s, to) * MART.legYears + MART.risk + loss
      const mu = wr > 0 ? mu0 + plund + wr + ev : mu0 + plund
      // The border: the importer's duty (or an embargo: contraband only), the smuggled share, the collector and the hub.
      let duty = 0, sig = 0, enf = 0, coll = -1, collP = -1, hub = to, smug = false
      if (lp !== null && pa !== pb) {
        const P2 = ps as PolityState
        const pf = dir === 0 ? pa : pb, pt = dir === 0 ? pb : pa
        if (pf < 0 || pt < 0 || !bound(P2, pf, pt)) {
          const ef = dir === 0 ? lp.ea[k] : lp.eb[k], et = dir === 0 ? lp.eb[k] : lp.ea[k]
          if (blk !== 0) {
            enf = ef > et ? ef : et
            const x = X.share * lp.hide[k] * (1 - enf)
            sig = x > 0.9 ? 0.9 : x
            collP = ef > et ? pf : pt
            smug = true
            if (MART.hubTransit && lp.hub[k] >= 0 && lp.hubE[k] < enf) hub = lp.hub[k]
          } else if (pt >= 0) {
            duty = P2.pTariff[pt] * TARIFF.hv
            if (duty > 0) {
              enf = et
              const x = X.share * lp.hide[k] * (1 - et) * (duty / (duty + X.tauHalf))
              sig = x > 0.9 ? 0.9 : x
              collP = pt
              if (MART.hubTransit && lp.hub[k] >= 0 && lp.hubE[k] < et) hub = lp.hub[k]
            }
          }
          if (collP >= 0) coll = P2.pCapital[collP]
          if (smug && !(sig > 0)) continue // (an embargo nobody runs)
        }
      }
      const wedge = TARIFF.wedge * duty
      const fwdBid = g.fwdBid, toMart = g.isMart[to], fromMart = g.isMart[from]
      for (let j = 0; j < NLG; j++) {
        const gd = LEG_GOODS[j]
        if (lane && !(capLeft > 0)) break
        const kf = from * G + gd, kt = to * G + gd
        const S0 = stock[kf]
        if (!(S0 > 0)) continue
        const pf = price[kf]
        const pLocal = price[kt]
        // The buyer's merchants bid their forward price (not back toward where it comes from); the seller's hold out for theirs.
        let P = pLocal
        const fb = fwdBid[kt]
        if (fb > P && toMart && g.fwdVia[kt] !== from) P = fb
        let res = pf
        const fsl = fwdBid[kf]
        if (fsl > res && fromMart) res = fsl
        const minGap = TRADE.minGap * V[gd]
        const dw = wedge * pLocal
        if (!(P - res * (1 + mu) - minGap - dw > 0)) continue
        const m = MIX_OF[gd]
        const tc = CLASS.transport[gd] * lt * (m >= 0 ? density(g, from, m, S0) : 1) * (smug ? X.premium : 1)
        const cost = (res + tc) * (1 + mu)
        const net = P - cost - minGap - dw
        if (!(net > 0)) continue
        let q = (TRADE.damping * (P - cost - dw)) / (deriv[kf] + deriv[kt])
        const most = 0.7 * S0
        if (q > most) q = most
        if (smug) q *= sig
        if (lane && q > capLeft) q = capLeft
        if (!(q > 1e-6)) continue
        const arrive = q * (1 - lost)
        stock[kf] = S0 - q
        stock[kt] += arrive
        if (m >= 0 && g.nSecretVars > 0 && sig > 0) secretSmuggled(s, g, from, to, m, q / S0, pf, smug ? 1 : sig)
        if (m >= 0) mixFlow(g, from, to, m, arrive, S0)
        else if (gd === 8) moveAmt(s, from, to, q, arrive, S0) // (stimulants by species)
        if (m >= 0 && lost > 0) mixScale(g, from, m, (S0 - q) / (S0 - arrive)) // (the cargo lost at sea leaves the sender's names too)
        // Income on what is realised: the season's return on the goods carried, and the gap to the buyer's own price (not
        // to the forward price it bought at, which it earns only when it sells on; the smugglers' cut likewise).
        const cr = (pf + tc) * (1 + mu) + dw
        let real = pLocal - cr > 0 ? pLocal - cr : 0
        const cap1 = STOCK.incomeGap * ts.worth[kt]
        if (real > cap1) real = cap1
        const loads = q * V[gd]
        if (lp !== null) {
          const P2 = ps as PolityState
          lp.loads[k] += loads
          const la = P2.legAcc
          // Plunder: pirates, privateers or a blockade, bandits' tolls (the goods' worth to whoever takes them).
          if (plund > 0) {
            if (plTo >= 0 && s.abandoned[plTo] < 0) income[plTo] += plund * q * pf
            la[2] += (plund - bandShare) * loads; la[3] += bandShare * loads
          }
          if (smug) {
            // Contraband only: a share seize * enforcement of it seized (its worth to the enforcer), the smugglers' cut to the hub.
            const seized = X.seize * enf * q
            if (coll >= 0 && s.abandoned[coll] < 0 && seized > 0) { income[coll] += seized * pLocal; P2.pRevYear[collP] += seized * pLocal }
            const c = X.hubCut * real * (q - seized)
            if (c > 0) hubCut(s, P2, hub, c, c, gd, collP, income)
            la[1] += (q - seized) * V[gd]
            income[from] += q * STOCK.hvMargin * TRADE.margin * V[gd]
            g.legVol[k] += q
            g.legGood[(k * G + gd) * 2 + dir] += q
            if (lane) { capLeft -= q; g.legUse[k] += q }
            hvPrice(ts, kf, ts.demand[kf])
            hvPrice(ts, kt, ts.demand[kt])
            continue
          }
          if (duty > 0) {
            // The duty on the legal part, seizures of the smuggled part, the smugglers' cut.
            const caught = X.seize * enf
            const rev = duty * (1 - sig) * q * pLocal + caught * sig * q * pLocal
            if (coll >= 0 && s.abandoned[coll] < 0 && rev > 0) { income[coll] += rev; P2.pRevYear[collP] += rev }
            const c = X.hubCut * (1 - caught) * sig * real * q
            if (c > 0) hubCut(s, P2, hub, c, c, gd, collP, income)
            la[0] += (1 - sig) * loads; la[1] += sig * (1 - caught) * loads
          }
        }
        const carrier = q * (mu0 * (pf + tc) + MART.carrier * real)
        const gap = real
        income[to] += carrier
        income[from] += q * ((1 - MART.carrier) * gap + STOCK.hvMargin * TRADE.margin * V[gd])
        g.relayYear[to] += carrier
        if (!g.relayIn[to]) { g.relayIn[to] = 1; g.relayList.push(to) }
        noteIncome(s, g, 13, carrier + q * ((1 - MART.carrier) * gap + STOCK.hvMargin * TRADE.margin * V[gd]))
        trackVar(g, to, from, m, carrier)
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
