// goods: smuggling, the minimal form (design 6.2, v1): contraband on war-embargoed flows and on monopoly rent.
//
// The interface the full smuggling of polities v2 can replace or absorb is two functions:
//   smuggleShare(s, g, from, to, path, inc) -> SHARE { sigma, enf, hub }: the share of a restricted flow that goes as
//     contraband (sigma = base * hide * (1 - enf) * inc), the receiving end's enforcement (grip * cohesion share), and the
//     smuggler hub (the end or transit settlement with the least enforcement);
//   contraband(s, ts, g, p, a, b, nGoods, goods): applies it to a war-embargoed local pair: suppressed flow in (what the pair
//     would move without the embargo, at transport * SMUGGLE.cost), contraband flow (sigma of it) and seizure (seize * enf of
//     that, to the enforcing capital) out; the hub takes hubShare of the gap as smuggled income.
// Monopoly rent (market.ts hvPair) calls smuggleShare with inc = rho / (rho + incHalf): that share evades the rent.
// SmugglingRing: a hub whose smuggled income first passes SMUGGLE.ring of its income (smoothed), checked yearly (system.ts).

import { GOOD_COUNT, TECH_FIELD_COUNT, TechField } from '../../../contract.ts'
import { GOODS, TRADE } from '../params.ts'
import type { HistoryState } from '../state.ts'
import type { TradeState } from '../trade.ts'
import { grip } from '../polity/state.ts'
import { CLASS, SMUGGLE } from './params.ts'
import type { GoodsState } from './state.ts'
import { MIX_OF, density, mixFlow } from './state.ts'
import { hvPrice } from './market.ts'

const G = GOOD_COUNT

/** Result of smuggleShare. */
export const SHARE = { sigma: 0, enf: 0, hub: -1 }

/** Enforcement at settlement id by its polity: grip(dist, reach) * cohesion / (cohesion + 0.2); 0 when stateless. */
export function enforcement(s: HistoryState, id: number): number {
  const ps = s.pol
  if (ps === null || id >= ps.seen) return 0
  const p = ps.polity[id]
  if (p < 0) return 0
  const A = ps.pAsab[p]
  return grip(ps.dist[id], ps.pReach[p]) * (A / (A + 0.2)) * (ps.pCrisisUntil[p] > s.year ? 0.6 : 1)
}

/**
 * Share of a restricted flow from `from` to `to` that is smuggled (SHARE.sigma), the enforcement at the receiving end
 * (SHARE.enf), and the hub (SHARE.hub). `path` is the cell path (or null), `inc` the incentive (1 for an embargo).
 */
export function smuggleShare(s: HistoryState, g: GoodsState, from: number, to: number, path: readonly number[] | null, transit: readonly number[] | null, inc: number): void {
  const X = SMUGGLE
  const T = s.terrain
  let hide = X.hide0
  let sea = T.seaCoast[s.cell[from]] === 1 || T.seaCoast[s.cell[to]] === 1
  let dSum = 0, dN = 0
  const ps = s.pol
  if (path !== null) {
    for (let k = 0; k < path.length; k++) {
      const c = path[k]
      if (T.sea[c]) { sea = true; continue }
      if (ps !== null) { dSum += ps.defenseD[c]; dN++ }
    }
  }
  if (sea) hide += X.sea
  if (dN > 0) hide += X.defence * (dSum / dN)
  let enf = enforcement(s, to)
  let hub = to, hubEnf = enf
  const fe = enforcement(s, from)
  if (fe < hubEnf) { hub = from; hubEnf = fe }
  let haven = false
  if (transit !== null) {
    for (let k = 0; k < transit.length; k++) {
      const x = transit[k]
      if (s.abandoned[x] >= 0) continue
      const e = enforcement(s, x)
      if (e < hubEnf) { hub = x; hubEnf = e }
      if (e === 0 || s.outpost[x] || (x < g.cap && g.postOf[x] >= 0)) haven = true
    }
  }
  if (haven) hide += X.haven
  if (enf > 1) enf = 1
  SHARE.sigma = X.base * hide * (1 - enf) * inc
  SHARE.enf = enf
  SHARE.hub = hub
}

/** Seized and smuggled value per decade (diagnostics). */
function record(g: GoodsState, year: number, seized: number, smuggled: number): void {
  const d = Math.floor(year / 10)
  while (g.diag.seized.length <= d) { g.diag.seized.push(0); g.diag.smuggled.push(0) }
  g.diag.seized[d] += seized
  g.diag.smuggled[d] += smuggled
}

/**
 * Market hook (trade.ts, a local pair whose ends' polities are at war): smugglers carry a share of what the pair would
 * trade, dearer, and part of it is seized by the receiving end's state. See the header.
 */
export function contraband(s: HistoryState, ts: TradeState, g: GoodsState, p: number, a: number, b: number, nGoods: number, goods: Int32Array): void {
  const X = SMUGGLE
  const r = ts.pairRoute[p]
  const path = r >= 0 ? ts.rPath[r] : null
  const transit = r >= 0 ? ts.rTransit[r] : ts.pairChain[p].slice(1, -1)
  const stock = ts.stock, price = ts.price, deriv = ts.deriv
  const tech = s.tech, peopleOf = s.people
  const cr = 0.5 * (tech[peopleOf[a] * TECH_FIELD_COUNT + TechField.Crafts] + tech[peopleOf[b] * TECH_FIELD_COUNT + TechField.Crafts])
  const c = (ts.pairCost[p] * (r >= 0 && ts.rOpen[r] ? 1 : 1 + TRADE.openHurdle) * 0.5 * (ts.pack[a] + ts.pack[b]) * X.cost) / (1 + GOODS.transportTech * (cr - 1))
  for (let dirAB = 0; dirAB < 2; dirAB++) {
    const from = dirAB === 0 ? a : b, to = dirAB === 0 ? b : a
    smuggleShare(s, g, from, to, path, transit, 1)
    const sigma = SHARE.sigma, enf = SHARE.enf, hub = SHARE.hub
    if (!(sigma > 0)) continue
    for (let gi = 0; gi < nGoods; gi++) {
      const gd = goods[gi]
      if (gd < 3) continue // (food is not smuggled across a war front in this version)
      const kf = from * G + gd, kt = to * G + gd
      const S0 = stock[kf]
      if (!(S0 > 0)) continue
      const m = MIX_OF[gd]
      const tr = CLASS.transport[gd] * c * (m >= 0 ? density(g, from, m, S0) : 1)
      const gap = price[kt] - price[kf]
      const net = gap - tr - TRADE.minGap * GOODS.value[gd]
      if (!(net > 0)) continue
      let q = (TRADE.damping * (gap - tr)) / (deriv[kf] + deriv[kt])
      const most = 0.35 * S0
      if (q > most) q = most
      q *= sigma
      if (!(q > 1e-6)) continue
      const seized = X.seize * enf * q
      const arrive = q - seized
      stock[kf] = S0 - q
      stock[kt] += arrive
      if (m >= 0) mixFlow(g, from, to, m, arrive, S0)
      const pf = price[kf]
      ts.income[from] += q * 0.5 * (1 - X.hubShare) * (gap - tr)
      const hubGain = arrive * X.hubShare * (gap - tr)
      ts.income[hub] += hubGain
      const ps = s.pol
      const capTo = ps !== null && to < ps.seen && ps.polity[to] >= 0 ? ps.pCapital[ps.polity[to]] : -1
      if (hub < g.cap) { g.smugYear[hub] += hubGain; g.smugClass[hub] = gd; g.smugCap[hub] = capTo }
      if (capTo >= 0) s.wealth[capTo] += seized * pf
      ts.pairFlow[(p * G + gd) * 2 + dirAB] += arrive
      record(g, s.year, seized * pf, q * pf)
      if (ts.hv !== null && ts.hv[gd] === 1) { hvPrice(ts, kf, ts.demand[kf]); hvPrice(ts, kt, ts.demand[kt]) }
      else if (gd >= 3) { setBulk(ts, kf, gd); setBulk(ts, kt, gd) }
    }
  }
}

/** Bulk non-food price at index k of class gd (as trade.ts setGoodPrice). */
function setBulk(ts: TradeState, k: number, gd: number): void {
  const D = ts.demand[k]
  const inv = 1 / (1 + ts.stock[k] / D)
  const V = gd >= 6 ? ts.worth[k] : GOODS.value[gd]
  ts.price[k] = V * 2 * inv
  ts.deriv[k] = (V * 2 * inv * inv) / D
}
