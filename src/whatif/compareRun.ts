// What-if (experience-whatif-director-sagas §1.4): the other world's run, as the worker's `compare` request makes it.
// The options are the kept run's with another order list (and cradles), canonical exactly as worker.ts canonicalises them
// for `orders` requests, so the other world is bit-identical to what "Adopt the other world" (an `orders` request) would
// simulate, and its cache entry is an ordinary one (whatif worker test). Stepped in chunks by a generator so the worker
// can post progress and let other requests run between chunks.

import { canonicalCradles, decodeOrders, encodeOrders, type CreateHistoryRun, type History, type HistoryOptions, type Order, type World } from '../contract.ts'

/** History options with the orders and the cradles canonical and each dropped when there are none (worker.ts canonicalOptions). */
export function canonicalOptions(o: HistoryOptions | undefined): HistoryOptions | undefined {
  if (!o || (o.orders === undefined && o.cradles === undefined)) return o
  const { orders, cradles, ...rest } = o
  const out: HistoryOptions = { ...rest }
  if (orders !== undefined) {
    const canon = decodeOrders(encodeOrders(orders))
    if (canon.length > 0) out.orders = canon
  }
  const cc = cradles ? canonicalCradles(cradles) : []
  if (cc.length > 0) out.cradles = cc
  return Object.keys(out).length > 0 ? out : undefined
}

/** The other world's options: the kept options with `orders` (and `cradles` when given) in place of the kept ones (as worker.ts reorder). */
export function compareOptions(kept: HistoryOptions | undefined, orders: readonly Order[], cradles?: readonly number[]): HistoryOptions | undefined {
  const base: HistoryOptions = { ...(kept ?? {}) }
  delete base.orders
  if (cradles !== undefined) base.cradles = cradles.slice()
  return canonicalOptions({ ...base, orders: orders.slice() })
}

/** Steps a new run of `world` with `options` to `years`, yielding the year reached after each chunk; returns the History. */
export function* compareSteps(createHistoryRun: CreateHistoryRun, world: World, options: HistoryOptions | undefined, years: number, chunk = 50): Generator<number, History> {
  const run = createHistoryRun(world, options)
  while (run.year + chunk < years) {
    if (run.simulateTo) run.simulateTo(run.year + chunk)
    else run.advanceTo(run.year + chunk)
    yield run.year
  }
  return run.advanceTo(years)
}

/** The whole run at once (tests, Node). */
export function runCompare(createHistoryRun: CreateHistoryRun, world: World, kept: HistoryOptions | undefined, orders: readonly Order[], years: number, cradles?: readonly number[]): History {
  const it = compareSteps(createHistoryRun, world, compareOptions(kept, orders, cradles), years)
  for (;;) {
    const r = it.next()
    if (r.done) return r.value
  }
}
