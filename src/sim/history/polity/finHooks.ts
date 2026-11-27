// state-finances: the narrow hooks the war chain reads (grudges' oath calculus and arms). Until finances is on they return
// their neutral values.

import type { HistoryState } from '../state.ts'
import type { PolityState } from './state.ts'
import { finNeed } from '../finance/hooks.ts'
import { FIN } from '../finance/params.ts'

/** OATH.warCost multiplier for p: 1 + finNeed(p) with finances, else 1. */
export function finWarCost(s: HistoryState, ps: PolityState, p: number): number {
  return s.fin !== null ? 1 + finNeed(s, ps, p) : 1
}

/** arms fatigue input need_p: finNeed(p) with finances, else min(1, war exhaustion). */
export function finArmsNeed(s: HistoryState, ps: PolityState, p: number): number {
  if (s.fin !== null) return finNeed(s, ps, p)
  const e = ps.pExh[p]
  return e > 1 ? 1 : e
}

/** True when finances charges the cost of arms (its garrison term); false: arms.ts drains the capitals' wealth. */
export function finArmsCost(s: HistoryState): boolean {
  return s.fin !== null && FIN.divert
}
