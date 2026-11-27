// The goods traded on any route (split out of tradePanel.ts so main.ts need not load the panel: onboarding bundle split).

import type { TradeRoutes } from '../contract.ts'

/**
 * Distinct goods actually carried (either way) by any route of this trade network, ascending by id. A
 * goods legend should iterate this instead of 0..GOOD_COUNT, so it does not grow with unused entries once
 * GOOD_COUNT rises (e.g. 9 -> 13): most worlds never see every good traded. Safe at either good count since
 * it only ever reports ids that actually appear on a route.
 */
export function goodsInUse(T: TradeRoutes): number[] {
  const seen = new Set<number>()
  for (let r = 0; r < T.count; r++) {
    seen.add(T.goodAB[r])
    seen.add(T.goodBA[r])
  }
  return [...seen].sort((a, b) => a - b)
}
