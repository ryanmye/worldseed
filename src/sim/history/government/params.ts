// governments: parameters of the government system (city-states.md §4). Every number is a design default [A], not a
// historical rate (city-states.md References: "Design defaults").

import { Government } from '../../../contract.ts'

/** Default of HistoryOptions.governments (off until the R29 flip in its own PR). */
export const GOV_ON = false

/** Transition parameters (city-states.md §4.3-4.10). */
export const CITY = {
  /** herders: a founding capital with liveFrac >= herdFrac that keeps horses founds a Confederation. */
  herdFrac: 0.4,
  /** Merchant capital per head without goods: wealthHead * wealth / pop. */
  wealthHead: 1,
  /** trade_i: port 1, river-only river, inland inland, times smoothstep(thLow, thHigh, through). */
  river: 0.6,
  inland: 0.15,
  thLow: 1500,
  thHigh: 6000,
  /** Mercenaries: merc(m) = 1 + merc * m / (m + mercHalf). */
  merc: 1.2,
  mercHalf: 20,
  /** Member-town gates (§4.4). */
  minPop: 2000,
  settle: 20,
  rich0: 0.3,
  rich1: 1.0,
  mHead: 3,
  mHead1: 20,
  /** A rising when the town's force over the crown's suppression phi >= defy; chance step * rise * omega * (0.5 + 0.5 delta) * (1 + need). */
  defy: 0.8,
  rise: 0.006,
  /** A crushed rising: this share of the merchants' capital lost (fled or fined). */
  crushMerch: 0.4,
  /** A charter: chance step * charter * omega * need * (0.5 + 0.5 delta); the price price * (wealth + merchant capital). */
  charter: 0.01,
  price: 0.25,
  /** Contado: neighbours with pop <= contado * the city's (and below TOWN_POPULATION), nearer the city than their capital. */
  contado: 0.3,
  /** Free cities (§4.5): the yearly due due * decay * wealth of its capital; stops paying when proj < freeRebel * F, or (need >= 0.5) chance step * stopPay. */
  due: 0.08,
  freeRebel: 1.0,
  stopPay: 0.01,
  freedR: 0.6,
  /** Revoked after revokeYears when proj >= revoke * F, the overlord at peace and without need: chance step * revokeChance. */
  revokeYears: 60,
  revoke: 4,
  revokeChance: 0.004,
  /** Stateless free towns (§4.6). */
  freePop: 1500,
  free: 0.06,
  freePop1: 4000,
  freeTrade: 0.3,
  /** Councils at a succession (§4.7): members <= councilMembers, trade_c >= councilTrade, m_c >= councilHead; chance council * smoothstep(councilHead, councilHead1, m_c). */
  councilMembers: 8,
  councilTrade: 0.6,
  councilHead: 10,
  councilHead1: 40,
  council: 0.35,
  /** A signoria's lords driven out at an extinct or overthrown house. */
  restore: 0.4,
  /** Theocracy (§4.9): holy cities of universal faiths with org >= theoOrg and pop >= theoPop. */
  theoOrg: 0.5,
  theoPop: 1500,
  theoMembers: 6,
  theoCrown: 0.3,
  theoFree: 0.05,
  theoSecede: 0.03,
  /** Confederation succession: electOther replaced by confedOther. */
  confedOther: 0.35,
  /** Republics (§4.8): faction strife at a term's end; signoria. */
  faction: 0.08,
  signoria: 0.0012,
  sigWar: 2,
  sigCrisis: 3,
  sigLost: 2,
  sigFamily: 4,
  /** A signoria crowned after crownYears of one house (and a Kingdom or crownMembers members): chance step * crown. */
  crownYears: 80,
  crownMembers: 6,
  crown: 0.01,
  /** Confederation settling (§4.10). */
  settleYears: 100,
  settle2: 0.3,
  /** Trade rivalry: dR += step * tradeRival * max(GOV.tradeRival) * compete. */
  tradeRival: 0.03,
  /** Mercenaries' pay at war: mercPay * (mult - 1) * W_cap a step; none below mercFloor of capital W. */
  mercPay: 0.02,
  mercFloor: 50,
  /** The council of a republic (families' topFamilies). */
  councilK: 5,
} as const

/** Behaviour tables indexed by Government (city-states.md §4.11): Monarchy, Republic, FreeCity, Signoria, Theocracy, Confederation, League. */
export const GOV = {
  war: [1, 0.5, 0.3, 0.9, 0.7, 1.3, 0.5],
  tradeWar: [0, 1.5, 0.5, 1, 0, 0, 1],
  tradeRival: [0, 1, 0.5, 0.8, 0, 0, 1],
  embargo: [1, 0.8, 1, 0.9, 1, 1, 0.8],
  tariff: [1, 0.8, 0.8, 1, 1, 0.7, 0.6],
  merc: [0, 1, 1, 1, 0, 0, 1],
  reach: [1, 0.7, 0.6, 0.8, 0.8, 1.1, 1],
  unrest: [1, 1.1, 1, 1.15, 0.85, 1.2, 0.9],
  urge: [1, 1.5, 1.3, 1.3, 1, 0.8, 1.5],
  absorb: [1, 0, 0, 0, 0, 1, 0],
  contest: [0, 0, 0, 0.05, 0, 0.12, 0],
  crisis: [1, 0.6, 0.6, 1.2, 0.5, 1.3, 0.6],
  holy: [1, 1, 1, 1, 1.5, 1, 1],
  tribute: [0, 1, 1, 0, 0, 0, 1],
} as const

/** True for the forms whose head is elected (no house): Republic, FreeCity, Theocracy, League. */
export function electedForm(f: number): boolean {
  return f === Government.Republic || f === Government.FreeCity || f === Government.Theocracy || f === Government.League
}

/** True for the city-state forms (Republic, FreeCity, Signoria). */
export function cityForm(f: number): boolean {
  return f === Government.Republic || f === Government.FreeCity || f === Government.Signoria
}
