// governments: the adapter for wealth, force and need (city-states.md §4.3, §9.2, §9.3). Finances and families plug in here;
// without them every quantity runs on the proxies of §4.3. Pure reads: nothing here draws or writes.
//
// With finance on: need is finNeed (§9.2); the charter price, the due and the mercenary pay go through finCredit / finSpend
// (system.ts). The revenue ratio rho stays on the proxy (town and crown measured alike, wealth + merchant capital) on purpose:
// finRevenue and finTownRevenue are in different units, and mixing a proxy numerator with a treasury denominator would move
// the gate with finances on or off (deviation recorded in the plan's addendum).
// With families feedback on (FAMILY.feedback): merchant capital per head is the families' capital at the town (§9.3 am. 1).

import { RIVER_FLOW_THRESHOLD } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import { WEALTH } from '../params.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { FAR, grip, inCrisis, localOf, projAt } from '../polity/state.ts'
import { UNREST } from '../polity/params.ts'
import { finNeed } from '../finance/hooks.ts' // finance:
import { FAMILY } from '../families/params.ts' // families:
import { familyCapitalAt } from '../families/api.ts' // families:
import { CITY } from './params.ts'

/** Merchant capital at town i (goods' pool; 0 without goods). */
export function merchAt(s: HistoryState, i: number): number {
  const g = s.goods
  if (g === null) return 0
  const m = g.ext.merch
  return i < m.cap ? m.mw[i] : 0
}

/** m_i: merchant capital per head (families' capital with feedback; wealthHead * wealth without goods). */
export function mHead(s: HistoryState, i: number): number {
  const pop = s.pop[i]
  if (!(pop > 0)) return 0
  if (s.goods === null) return (CITY.wealthHead * s.wealth[i]) / pop
  if (FAMILY.feedback && s.goods.ext.fam !== null) return familyCapitalAt(s, i) / pop
  return merchAt(s, i) / pop
}

/** W_i = wealth + merchant capital. */
export function wealthAll(s: HistoryState, i: number): number {
  return s.wealth[i] + merchAt(s, i)
}

/** rho_i = rev_i / (crownRev_p + eps): the town's money income against the crown's. */
export function revRatio(s: HistoryState, ps: PolityState, i: number, p: number): number {
  const c = ps.pCapital[p]
  const rev = WEALTH.decay * wealthAll(s, i)
  const crown = WEALTH.decay * wealthAll(s, c) + ps.pRevSm[p]
  return rev / (crown + 1e-9)
}

/** trade_i in [0, 1]: (port 1, river CITY.river, inland CITY.inland) * smoothstep(thLow, thHigh, through). */
export function tradeOf(s: HistoryState, i: number): number {
  const w = s.port[i] >= 0 ? 1 : s.world.flow[s.cell[i]] >= RIVER_FLOW_THRESHOLD ? CITY.river : CITY.inland
  return w * smoothstep(CITY.thLow, CITY.thHigh, s.through[i])
}

/** merc(m) = 1 + merc * m / (m + mercHalf): the armies the town's money hires, per its levy. */
export function mercOf(m: number): number {
  return 1 + (CITY.merc * m) / (m + CITY.mercHalf)
}

/** F_i: the town's force (its own levy times its mercenaries). `extra` adds to m (pilgrims' money per head). */
export function forceOf(s: HistoryState, ps: PolityState, i: number, extra = 0): number {
  return localOf(s, ps, i) * mercOf(mHead(s, i) + extra)
}

/** S_i: the crown's suppression at town i (weaker in a crisis). */
export function suppressOf(s: HistoryState, ps: PolityState, i: number, p: number): number {
  const d = ps.dist[i] < FAR ? ps.dist[i] : FAR
  return projAt(ps, p, d) * (inCrisis(s, ps, p) ? 1 - UNREST.crisisSupport : 1)
}

/** need_p in [0, 1]: finNeed with finance, else max(war, crisis, a lost war). */
export function needOf(s: HistoryState, ps: PolityState, p: number): number {
  if (s.fin !== null) return finNeed(s, ps, p)
  let n = 0
  if (ps.pWars[p] > 0) { const e = ps.pExh[p]; n = 0.4 + 0.6 * (e > 1 ? 1 : e) }
  if (inCrisis(s, ps, p) && n < 0.6) n = 0.6
  const R = s.rul
  if (R !== null && p < R.pcap && s.year - R.lost[p] <= 10 && n < 0.5) n = 0.5
  return n
}

/** delta_i = max(1 - grip(dist, reach), smoothstep(0.3, 1, phi)): how distant or weak the lord is where the town stands. */
export function distantOf(ps: PolityState, i: number, p: number, phi: number): number {
  const g = ps.dist[i] < FAR ? grip(ps.dist[i], ps.pReach[p]) : 0
  const a = 1 - g, b = smoothstep(0.3, 1, phi)
  return a > b ? a : b
}
