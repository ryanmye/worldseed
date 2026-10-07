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

export function createOrdersState(orders: readonly Order[], P: number, hop: number, rng: Rng): OrdersState {
  const n = orders.length
  const given = orders.map((o) => (o.target !== undefined ? { year: o.year, kind: o.kind, actor: o.actor, target: o.target } : { year: o.year, kind: o.kind, actor: o.actor }))
  const idx: number[] = []
  for (let k = 0; k < n; k++) idx.push(k)
  const yearOf = (k: number): number => { const y = Math.floor(given[k].year); return y >= 1 ? y : 1 }
  idx.sort((a, b) => (yearOf(a) - yearOf(b)) || (a - b))
  const year = new Int32Array(n), kind = new Int32Array(n), actor = new Int32Array(n), target = new Int32Array(n)
  for (let k = 0; k < n; k++) {
    const o = given[k]
    year[k] = Number.isFinite(o.year) ? yearOf(k) : 1 << 30
    kind[k] = Math.floor(o.kind)
    actor[k] = Number.isFinite(o.actor) ? Math.floor(o.actor) : -1
    target[k] = o.target !== undefined && Number.isFinite(o.target) ? Math.floor(o.target) : -1
  }
  return {
    rng, n, given, sorted: Int32Array.from(idx), next: 0,
    year, kind, actor, target, until: new Int32Array(n).fill(-1),
    status: new Int32Array(n), reason: new Int32Array(n), done: new Int32Array(n).fill(-1), acted: new Int32Array(n).fill(-1),
    product: new Int32Array(n).fill(-1), place: new Int32Array(n).fill(-1), best: new Float64Array(n), reach: new Float64Array(n), refused: new Uint8Array(n),
    active: [],
    exOrder: new Int32Array(P).fill(-1), exCell: new Int32Array(P).fill(-1), seOrder: new Int32Array(P).fill(-1), seCell: new Int32Array(P).fill(-1),
    crSpecies: new Int32Array(P).fill(-1), idIdea: new Int32Array(P).fill(-1),
    nPolity: 0, nTown: 0, evSeen: 0, hop,
  }
}
