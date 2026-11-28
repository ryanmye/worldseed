// orders: the state of the player's nudges (HistoryOptions.orders), created only when there are orders (HistoryState.orders is
// null otherwise, and every hook is then a no-op). Orders are kept as given (index k = History.orders[k]) and activated in year
// order (ties in list order: `sorted`). Per people, the order in force of each people-kind (Explore, Settle, Crop, Idea), so the
// hooks in the systems read one array entry; the polity and town kinds are few and looked up in `active`.

import type { Order } from '../../../contract.ts'
import type { Rng } from '../../rng.ts'

export interface OrdersState {
  /** Draws of the orders' own decisions (terms of peace, the court's consent), from 'history-orders'. */
  rng: Rng
  n: number
  given: Order[]
  /** Given indices in the order they are applied (year, then list order); the next one to activate. */
  sorted: Int32Array
  next: number
  /** Per order (given index): the year it acts from (at least 1), kind, actor, target (-1 none), last year in force. */
  year: Int32Array
  kind: Int32Array
  actor: Int32Array
  target: Int32Array
  until: Int32Array
  /** Per order: OrderStatus, OrderReason, year resolved (-1), first year acted (-1), product (-1), place (-1). */
  status: Int32Array
  reason: Int32Array
  done: Int32Array
  acted: Int32Array
  product: Int32Array
  place: Int32Array
  /** Per order: a figure of its progress (Settle: the nearest chord from a settlement of the people to the target so far). */
  best: Float64Array
  /** Per order (Explore, Settle): the chord from the people's nearest town of at least ORDERS.senderPop to the target (refreshed yearly). */
  reach: Float64Array
  /** Per order: 1 when the system refused it (an idea resisted), for the reason when it lapses. */
  refused: Uint8Array
  /** lane N3c, per order (Commission): the year the masons asked for more (the work waits for their pay), -1 once paid, 0 not yet. */
  stage: Int32Array
  /** Orders in force (given indices, in activation order). */
  active: number[]
  /** Per people: the order in force of each people-kind (-1), its target cell, species or idea. */
  exOrder: Int32Array
  exCell: Int32Array
  seOrder: Int32Array
  seCell: Int32Array
  crSpecies: Int32Array
  idIdea: Int32Array
  /** Orders in force of the polity kinds (War, Peace, Seat, Faith) and the town kinds (Fortify, Quarantine). */
  nPolity: number
  nTown: number
  /** Events looked at up to here (the end-of-year scan). */
  evSeen: number
  /** Chord between neighbouring cells (about). */
  hop: number
}

/** The year order k acts from: its year floored, at least 1 (the sort key; a non-finite year sorts as given). */
function yearOf(o: Order): number { const y = Math.floor(o.year); return y >= 1 ? y : 1 }

/** A copy of an order as kept (target only when given). */
function keep(o: Order): Order {
  return o.target !== undefined ? { year: o.year, kind: o.kind, actor: o.actor, target: o.target } : { year: o.year, kind: o.kind, actor: o.actor }
}

/** Given indices sorted by (year, list index): the order the orders are applied in. */
function sortedOf(given: readonly Order[]): Int32Array {
  const idx: number[] = []
  for (let k = 0; k < given.length; k++) idx.push(k)
  idx.sort((a, b) => (yearOf(given[a]) - yearOf(given[b])) || (a - b))
  return Int32Array.from(idx)
}

/** Fills the fixed per-order fields of orders from..given.length - 1 (year, kind, actor, target). */
function fillFixed(ox: Pick<OrdersState, 'given' | 'year' | 'kind' | 'actor' | 'target'>, from: number): void {
  for (let k = from; k < ox.given.length; k++) {
    const o = ox.given[k]
    ox.year[k] = Number.isFinite(o.year) ? yearOf(o) : 1 << 30
    ox.kind[k] = Math.floor(o.kind)
    ox.actor[k] = Number.isFinite(o.actor) ? Math.floor(o.actor) : -1
    ox.target[k] = o.target !== undefined && Number.isFinite(o.target) ? Math.floor(o.target) : -1
  }
}

export function createOrdersState(orders: readonly Order[], P: number, hop: number, rng: Rng): OrdersState {
  const n = orders.length
  const given = orders.map(keep)
  const year = new Int32Array(n), kind = new Int32Array(n), actor = new Int32Array(n), target = new Int32Array(n)
  fillFixed({ given, year, kind, actor, target }, 0)
  return {
    rng, n, given, sorted: sortedOf(given), next: 0,
    year, kind, actor, target, until: new Int32Array(n).fill(-1),
    status: new Int32Array(n), reason: new Int32Array(n), done: new Int32Array(n).fill(-1), acted: new Int32Array(n).fill(-1),
    product: new Int32Array(n).fill(-1), place: new Int32Array(n).fill(-1), best: new Float64Array(n), reach: new Float64Array(n), refused: new Uint8Array(n), stage: new Int32Array(n),
    active: [],
    exOrder: new Int32Array(P).fill(-1), exCell: new Int32Array(P).fill(-1), seOrder: new Int32Array(P).fill(-1), seCell: new Int32Array(P).fill(-1),
    crSpecies: new Int32Array(P).fill(-1), idIdea: new Int32Array(P).fill(-1),
    nPolity: 0, nTown: 0, evSeen: 0, hop,
  }
}

/** Grows a typed array to `n` entries, keeping its contents and filling the rest with `fill`. */
function grown<T extends Int32Array | Float64Array | Uint8Array>(a: T, n: number, fill: number): T {
  const b = new (a.constructor as new (n: number) => T)(n)
  b.set(a)
  if (fill !== 0) b.fill(fill, a.length)
  return b
}

/**
 * seat-mode §3.2 (live append): adds orders to a live run's orders state, in place, as if they had been in the list from the
 * start (given indices n, n + 1, ... after the existing ones). Valid only while none of them has acted: every order of `more`
 * must be for a year after `year` (the last year simulated), and then the state is exactly the one a run created with
 * `given.concat(more)` has at the end of `year`: the orders already activated (sorted[0 .. next)) keep their places, because
 * each appended order sorts after every order of a year <= `year`; per-order progress, the orders in force, the per-people
 * tables, the events cursor and the stream (`rng`, which drew only for orders in force) are kept. Throws a RangeError otherwise.
 * (perf-efficiency P6.3 rebuilds a restored run's orders through this same function.)
 */
export function appendOrders(ox: OrdersState, more: readonly Order[], year: number): void {
  for (const o of more) if (!(Number.isFinite(o.year) && yearOf(o) > year)) throw new RangeError(`order for year ${o.year} cannot be added to a run at year ${year}`)
  if (more.length === 0) return
  const n0 = ox.n, n = n0 + more.length
  ox.given = ox.given.concat(more.map(keep))
  ox.year = grown(ox.year, n, 0); ox.kind = grown(ox.kind, n, 0); ox.actor = grown(ox.actor, n, 0); ox.target = grown(ox.target, n, 0)
  fillFixed(ox, n0)
  ox.until = grown(ox.until, n, -1)
  ox.status = grown(ox.status, n, 0); ox.reason = grown(ox.reason, n, 0)
  ox.done = grown(ox.done, n, -1); ox.acted = grown(ox.acted, n, -1); ox.product = grown(ox.product, n, -1); ox.place = grown(ox.place, n, -1)
  ox.best = grown(ox.best, n, 0); ox.reach = grown(ox.reach, n, 0); ox.refused = grown(ox.refused, n, 0); ox.stage = grown(ox.stage, n, 0)
  const sorted = sortedOf(ox.given)
  for (let i = 0; i < ox.next; i++) if (sorted[i] !== ox.sorted[i]) throw new Error('appendOrders: the activated orders would move (an order of an earlier year)')
  ox.sorted = sorted
  ox.n = n
}
