// orders: the hooks the systems call (each a line or two there, only when HistoryState.orders is not null). They read the
// nudges in force (orders/state.ts) and return a neutral value (0, 1, -1, false) for everyone not ordered, so an order changes
// nothing but its own actor's chances. Pure reads, except peaceUrged, which draws from the orders' own stream.

import { OrderKind } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { ORDERS } from './params.ts'
import type { OrdersState } from './state.ts'

/** Chord between cells a and b on the unit sphere. */
export function chordCells(s: HistoryState, a: number, b: number): number {
  const P = s.world.grid.positions
  const dx = P[3 * a] - P[3 * b], dy = P[3 * a + 1] - P[3 * b + 1], dz = P[3 * a + 2] - P[3 * b + 2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** True when settlement id is among the towns of its people nearest the target of order k (within nearShare of the nearest able one's distance, plus nearHops cells). */
function nearTarget(s: HistoryState, ox: OrdersState, k: number, id: number): boolean {
  return chordCells(s, s.cell[id], ox.target[k]) <= ORDERS.nearShare * ox.reach[k] + ORDERS.nearHops * ox.hop
}

/** Explore: the extra share of the urge to explore of settlement id (0 when its people is not ordered or it is not near the target). */
export function exploreUrge(s: HistoryState, ox: OrdersState, id: number): number {
  const k = ox.exOrder[s.people[id]]
  return k >= 0 && nearTarget(s, ox, k, id) ? ORDERS.exploreUrge - 1 : 0
}

/** Explore: a search of the ordered people found nothing unknown within reach. */
export function exploreFruitless(ox: OrdersState, people: number): void {
  const k = ox.exOrder[people]
  if (k >= 0) ox.refused[k] = 1
}

/** Settle: the yearly chance that settlement id sends settlers (`colonise` when not ordered or not near the target). */
export function settleUrge(s: HistoryState, ox: OrdersState, id: number, colonise: number): number {
  const k = ox.seOrder[s.people[id]]
  if (k < 0 || colonise >= ORDERS.settleChance || !nearTarget(s, ox, k, id)) return colonise
  return ORDERS.settleChance
}

/** Explore: the target cell of `people`'s order in force, or -1. */
export function exploreTarget(ox: OrdersState, people: number): number {
  return ox.exOrder[people] >= 0 ? ox.exCell[people] : -1
}

/** Explore: weight of candidate cell c of an expedition from cell `home` toward the target cell t. */
export function towardTarget(s: HistoryState, t: number, home: number, c: number): number {
  const d0 = chordCells(s, home, t)
  if (!(d0 > 0)) return 1
  const x = d0 / (chordCells(s, c, t) + ORDERS.towardHalf * d0)
  let w = 1
  for (let k = 0; k < ORDERS.towardPow; k++) w *= x
  return w
}

/** Settle: factor on the founding score of site c for a group from settlement `from` (1 when its people is not ordered). */
export function settleBias(s: HistoryState, ox: OrdersState, from: number, c: number): number {
  const p = s.people[from]
  if (ox.seOrder[p] < 0) return 1
  const t = ox.seCell[p]
  const d0 = chordCells(s, s.cell[from], t)
  if (!(d0 > 0)) return 1
  const x = d0 / (chordCells(s, c, t) + ORDERS.towardHalf * d0)
  const w = x * x
  return w > ORDERS.settleMax ? ORDERS.settleMax : w
}

/** Settle: true when a group from settlement `from` goes under an order (its people ordered, the town near the target). */
export function settleUrged(s: HistoryState, ox: OrdersState, from: number): boolean {
  const k = ox.seOrder[s.people[from]]
  return k >= 0 && nearTarget(s, ox, k, from)
}

/** Settle: factor on the score of joining a town for a group from `from` (settleJoinMul when it goes under an order, else 1). */
export function settleJoin(s: HistoryState, ox: OrdersState, from: number): number {
  return settleUrged(s, ox, from) ? ORDERS.settleJoinMul : 1
}

/** Crop: the species `people` is ordered to take up, or -1. */
export function cropTarget(ox: OrdersState, people: number): number {
  return ox.crSpecies[people]
}
/** Crop: chance factor of item x for a settlement whose people's ordered species is cx. */
export function cropMul(cx: number, x: number): number {
  return x === cx ? ORDERS.cropMul : 1
}
/** Crop: the benefit of item x as the adoption judges it (the ordered species is taken up even when it adds nothing). */
export function cropBen(cx: number, x: number, ben: number): number {
  return x === cx && ben < ORDERS.cropMinBen ? ORDERS.cropMinBen : ben
}

/** Idea: the idea `people` is ordered to seek, or -1; ideaMul for it. */
export function ideaTarget(ox: OrdersState, people: number): number {
  return ox.idIdea[people]
}
export function ideaMul(io: number, i: number): number {
  return i === io ? ORDERS.ideaMul : 1
}

/** War: 1 when polity a is ordered to make war on b, 2 when b on a (3 both), 0 none. */
export function warOrders(ox: OrdersState, a: number, b: number): number {
  if (ox.nPolity === 0) return 0
  let m = 0
  for (const k of ox.active) {
    if (ox.kind[k] !== OrderKind.War) continue
    if (ox.actor[k] === a && ox.target[k] === b) m |= 1
    else if (ox.actor[k] === b && ox.target[k] === a) m |= 2
  }
  return m
}
/** War: the rivalry the declaration reads, raised for an ordered pair. */
export function warRivalry(m: number, r: number): number {
  return m !== 0 ? r + ORDERS.warRivalry : r
}

/** Peace: true when an order for peace between p and q (either side) brings terms this year (a draw from the orders' stream). */
export function peaceUrged(s: HistoryState, ox: OrdersState, p: number, q: number, start: number): boolean {
  if (ox.nPolity === 0 || s.year - start < ORDERS.peaceAfter) return false
  for (const k of ox.active) {
    if (ox.kind[k] !== OrderKind.Peace) continue
    const a = ox.actor[k], b = ox.target[k]
    if ((a === p && b === q) || (a === q && b === p)) return ox.rng.next() < ORDERS.peaceChance
  }
  return false
}

/** Faith: the faith polity p's ruler is ordered to take up, or -1. */
export function faithTarget(ox: OrdersState, p: number): number {
  if (ox.nPolity === 0) return -1
  for (const k of ox.active) if (ox.kind[k] === OrderKind.Faith && ox.actor[k] === p) return ox.target[k]
  return -1
}

/** Fortify, Quarantine: true when settlement id is under an order of this kind. */
export function townUrged(ox: OrdersState, kind: number, id: number): boolean {
  if (ox.nTown === 0) return false
  for (const k of ox.active) if (ox.kind[k] === kind && ox.actor[k] === id) return true
  return false
}
