// orders: the player's nudges in the yearly tick (index.ts), only when HistoryOptions.orders has any (HistoryState.orders).
//
//   ordersBegin (first thing in the year: the orders of the year are given, checked, and put in force; OrderGiven, OrderFailed)
//   -> the systems, whose hooks (orders/hooks.ts) read the nudges in force -> ordersPolity (after the polity system: the court
//   may move to the ordered seat) -> ... -> ordersEnd (last thing in the year: the year's events are matched against the orders
//   in force: OrderFulfilled; actors and targets gone: OrderFailed; time run out: OrderLapsed).
//
// An order changes nothing before its year: until then no hook sees it, and the orders' own draws ('history-orders') start with
// it. What each kind does is in params.ts and contract.ts (OrderKind, describeOrderKinds); outcomes in contract.ts OrderOutcome.

import { EventType, FaithKind, JourneyKind, OrderKind, OrderReason, OrderStatus, StructureType, TECH_FIELD_COUNT, TechField, describeOrderKinds } from '../../../contract.ts'
import type { Order, OrderOutcome } from '../../../contract.ts'
import type { Rng } from '../../rng.ts'
import type { HistoryState } from '../state.ts'
import { ITEMS, S_COUNT, hasBit, itemBit } from '../species.ts'
import { atWar } from '../polity/formation.ts'
import { relIdx } from '../polity/relations.ts'
import { bound } from '../polity/policy.ts'
import { WAR } from '../polity/params.ts'
import { moveCapital } from '../polity/state.ts'
import type { PolityState } from '../polity/state.ts'
import { controlOne } from '../polity/control.ts'
import { polityFaith, shareOf } from '../religion/system.ts'
import { PRE } from '../ideas/state.ts'
import { IDEA_DEFS } from '../ideas/params.ts'
import { ideaQuarantine } from '../ideas/hooks.ts'
import { QUARANTINE } from '../disease/params.ts'
import { ORDERS } from './params.ts'
import { chordCells } from './hooks.ts'
import { createOrdersState } from './state.ts'
import type { OrdersState } from './state.ts'

const YEARS = describeOrderKinds().map((k) => k.years)

export function createOrders(s: HistoryState, orders: readonly Order[], rng: Rng): OrdersState {
  return createOrdersState(orders, s.know.P, 1.12 / s.terrain.n, rng)
}

function push(s: HistoryState, type: number, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type: type as EventType, settlement, other, value, extra })
}

/** The largest living settlement (not a base) of people p, or -1 when it has none. */
function seatOfPeople(s: HistoryState, p: number): number {
  let best = -1
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    if (s.people[id] !== p || s.outpost[id]) continue
    if (best < 0 || s.pop[id] > s.pop[best]) best = id
  }
  return best
}

const isPeopleKind = (k: number): boolean => k === OrderKind.Explore || k === OrderKind.Settle || k === OrderKind.Crop || k === OrderKind.Idea
const isPolityKind = (k: number): boolean => k === OrderKind.War || k === OrderKind.Peace || k === OrderKind.Seat || k === OrderKind.Faith
const liveTown = (s: HistoryState, id: number): boolean => id >= 0 && id < s.count && s.abandoned[id] < 0
const livePolity = (ps: PolityState, p: number): boolean => p >= 0 && p < ps.pCapital.length && ps.pEnded[p] < 0

/** The actor's seat, where an order's story is told: the people's largest town, the polity's capital, the town itself. */
function seatOf(s: HistoryState, ox: OrdersState, k: number): number {
  const kd = ox.kind[k], a = ox.actor[k]
  if (isPeopleKind(kd)) return a >= 0 && a < s.know.P ? seatOfPeople(s, a) : -1
  if (isPolityKind(kd)) return s.pol !== null && a >= 0 && a < s.pol.pCapital.length ? s.pol.pCapital[a] : -1
  return liveTown(s, a) ? a : -1
}

/** Why order k cannot act now (OrderReason.None when it may): checked when it is given. */
function check(s: HistoryState, ox: OrdersState, k: number): number {
  const kd = ox.kind[k], a = ox.actor[k], t = ox.target[k]
  const R = OrderReason
  const N = s.terrain.cellCount
  const ps = s.pol
  if (isPeopleKind(kd)) {
    if (a < 0 || a >= s.know.P || seatOfPeople(s, a) < 0) return R.NoActor
    if (kd === OrderKind.Explore || kd === OrderKind.Settle) {
      if (t < 0 || t >= N) return R.NoTarget
      const known = s.know.known[a * N + t] >= 0
      if (kd === OrderKind.Explore) return known ? R.AlreadyDone : R.None
      if (s.terrain.sea[t] || !(s.terrain.capacity[t] > 0)) return R.Unfit
      return known ? R.None : R.Unknown
    }
    if (kd === OrderKind.Crop) {
      if (t < 0 || t >= S_COUNT) return R.NoTarget
      if (s.sp.year[a * ITEMS + t] >= 0) return R.AlreadyDone
      const b = itemBit(t)
      const living = s.living
      for (let i = 0; i < living.length; i++) {
        const id = living[i]
        if (s.people[id] !== a || s.outpost[id]) continue
        const c = s.cell[id]
        if (!hasBit(s.sp.unfit0[c], s.sp.unfit1[c], b)) return R.None
      }
      return R.Unfit
    }
    const ix = s.ideas
    if (ix === null) return R.SystemOff
    if (t < 0 || t >= ix.I || IDEA_DEFS[t].technique >= 0) return R.NoTarget
    if (ix.held[a * ix.I + t]) return R.AlreadyDone
    const pre = PRE[t]
    for (let j = 0; j < pre.length; j++) if (!ix.held[a * ix.I + pre[j]]) return R.Prerequisite
    return R.None
  }
  if (ps === null) return R.SystemOff
  if (isPolityKind(kd)) {
    if (!livePolity(ps, a)) return R.NoActor
    if (kd === OrderKind.War || kd === OrderKind.Peace) {
      if (t === a || !livePolity(ps, t)) return R.NoTarget
      const w = atWar(ps, a, t)
      if (kd === OrderKind.War) return w ? R.AlreadyDone : R.None
      return w ? R.None : R.NotAtWar
    }
    if (kd === OrderKind.Seat) {
      if (!liveTown(s, t) || s.outpost[t]) return R.NoTarget
      if (ps.pCapital[a] === t) return R.AlreadyDone
      return t < ps.polity.length && ps.polity[t] === a ? R.None : R.NotMember
    }
    const rel = s.rel
    if (rel === null || s.rul === null) return R.SystemOff
    if (t < 0 || t >= rel.kind.length || rel.kind[t] !== FaithKind.Universal || rel.endYear[t] >= 0) return R.NoTarget
    return polityFaith(s, rel, a) === t ? R.AlreadyDone : R.None
  }
  if (!liveTown(s, a) || s.outpost[a]) return R.NoActor
  if (kd === OrderKind.Fortify) return a < ps.walls.length && ps.walls[a] > 0 ? R.AlreadyDone : R.None
  if (kd === OrderKind.Quarantine) {
    const dz = s.dz
    if (dz === null) return R.SystemOff
    if (s.port[a] < 0 || a >= ps.polity.length || ps.polity[a] < 0) return R.NotPort
    if (a < dz.quar.length && dz.quar[a] >= 0) return R.AlreadyDone
    const p = s.people[a]
    if (s.tech[p * TECH_FIELD_COUNT + TechField.Crafts] < QUARANTINE.crafts || (s.ideas !== null && !ideaQuarantine(s.ideas, p))) return R.Unskilled
    return R.None
  }
  return R.NoTarget
}

/** The per-people tables and counts of the orders in force (after any change). */
function tables(ox: OrdersState): void {
  ox.exOrder.fill(-1); ox.seOrder.fill(-1); ox.crSpecies.fill(-1); ox.idIdea.fill(-1)
  ox.nPolity = 0; ox.nTown = 0
  for (const k of ox.active) {
    const a = ox.actor[k], t = ox.target[k]
    switch (ox.kind[k]) {
      case OrderKind.Explore: ox.exOrder[a] = k; ox.exCell[a] = t; break
      case OrderKind.Settle: ox.seOrder[a] = k; ox.seCell[a] = t; break
      case OrderKind.Crop: ox.crSpecies[a] = t; break
      case OrderKind.Idea: ox.idIdea[a] = t; break
      case OrderKind.Fortify: case OrderKind.Quarantine: ox.nTown++; break
      default: ox.nPolity++
    }
  }
}

function resolve(s: HistoryState, ox: OrdersState, k: number, status: number, reason: number, place: number): void {
  ox.status[k] = status
  ox.reason[k] = reason
  ox.done[k] = s.year
  if (place >= 0 || ox.place[k] < 0) ox.place[k] = place
  const type = status === OrderStatus.Fulfilled ? EventType.OrderFulfilled : status === OrderStatus.Failed ? EventType.OrderFailed : EventType.OrderLapsed
  const other = status === OrderStatus.Fulfilled ? otherOf(s, ox, k) : -1
  push(s, type, place, other, k, status === OrderStatus.Fulfilled ? ox.product[k] : reason)
}

/** The related settlement of a fulfilled order (for the chronicle): the sender, the defender's capital, the old capital... */
function otherOf(s: HistoryState, ox: OrdersState, k: number): number {
  const kd = ox.kind[k], t = ox.target[k]
  if ((kd === OrderKind.War || kd === OrderKind.Peace) && s.pol !== null && t >= 0 && t < s.pol.pCapital.length) return s.pol.pCapital[t]
  return -1
}

/** First thing in the year: the orders of the year are given; those that cannot act fail at once. */
export function ordersBegin(s: HistoryState, ox: OrdersState): void {
  if (ox.active.length === 0) ox.evSeen = s.events.length
  if (ox.next >= ox.n || ox.year[ox.sorted[ox.next]] > s.year) return
  let changed = false
  while (ox.next < ox.n && ox.year[ox.sorted[ox.next]] <= s.year) {
    const k = ox.sorted[ox.next++]
    const seat = seatOf(s, ox, k)
    const kd = ox.kind[k]
    const t = ox.target[k]
    push(s, EventType.OrderGiven, seat, kd === OrderKind.Seat ? t : (kd === OrderKind.War || kd === OrderKind.Peace) && s.pol !== null && t >= 0 && t < s.pol.pCapital.length ? s.pol.pCapital[t] : -1, k, kd)
    ox.place[k] = seat
    const why = kd >= 0 && kd < YEARS.length ? check(s, ox, k) : OrderReason.NoTarget
    if (why !== OrderReason.None) { resolve(s, ox, k, OrderStatus.Failed, why, seat); continue }
    ox.status[k] = OrderStatus.Active
    ox.until[k] = s.year + YEARS[kd]
    if (kd === OrderKind.Settle || kd === OrderKind.Explore) {
      // (the nearest settlement of the people to the target so far: progress; the nearest able one: which towns the order moves)
      let d = Infinity
      for (const id of s.living) if (s.people[id] === ox.actor[k] && !s.outpost[id]) { const x = chordCells(s, s.cell[id], t); if (x < d) d = x }
      ox.best[k] = d
      reachOf(s, ox, k)
    }
    ox.active.push(k)
    changed = true
  }
  if (changed) tables(ox)
}

/** After the polity system: the court may move to the ordered seat (the ruler's consent drawn from the orders' stream). */
export function ordersPolity(s: HistoryState, ox: OrdersState, ps: PolityState): void {
  if (ox.nPolity === 0) return
  for (const k of ox.active) {
    if (ox.kind[k] !== OrderKind.Seat || ox.status[k] !== OrderStatus.Active) continue
    const a = ox.actor[k], t = ox.target[k]
    if (!livePolity(ps, a) || !liveTown(s, t) || t >= ps.polity.length || ps.polity[t] !== a || ps.pCapital[a] === t) continue
    const cap = ps.pCapital[a]
    if (cap >= 0 && s.pop[t] < ORDERS.seatShare * s.pop[cap]) continue
    if (ox.rng.next() >= ORDERS.seatChance) continue
    moveCapital(s, ps, a, t)
    controlOne(s, ps, a, ps.heap)
  }
}

/** Last thing in the year: the year's events matched against the orders in force; actors gone; time run out. */
export function ordersEnd(s: HistoryState, ox: OrdersState): void {
  if (ox.active.length === 0) { ox.evSeen = s.events.length; return }
  const ev = s.events
  const ps = s.pol
  const N = s.terrain.cellCount
  const start = ox.evSeen
  const end = ev.length
  for (let e = start; e < end; e++) {
    const x = ev[e]
    const ty = x.type as number
    for (const k of ox.active) {
      if (ox.status[k] !== OrderStatus.Active) continue
      const kd = ox.kind[k], a = ox.actor[k], t = ox.target[k]
      let hit = -1 // the settlement where it came to pass
      switch (kd) {
        case OrderKind.Explore:
          if (ty === EventType.ExpeditionSent && s.people[x.settlement] === a) {
            if (ox.acted[k] < 0) ox.acted[k] = s.year
            ox.product[k] = expeditionJourney(s, x.settlement)
            ox.place[k] = x.settlement
            if (s.know.known[a * N + t] >= 0) hit = x.settlement
          }
          break
        case OrderKind.Settle:
          if (ty === EventType.Founded && x.other >= 0 && s.people[x.settlement] === a && !s.outpost[x.settlement]) {
            const d = chordCells(s, s.cell[x.settlement], t)
            if (d <= ORDERS.settleHops * ox.hop) { ox.product[k] = x.settlement; hit = x.settlement }
            else if (d < ox.best[k]) { ox.best[k] = d; if (ox.acted[k] < 0) ox.acted[k] = s.year; ox.product[k] = x.settlement; ox.place[k] = x.settlement }
          }
          break
        case OrderKind.Crop:
          if ((ty === EventType.SpeciesAdopted || ty === EventType.Domesticated) && x.value === t && s.people[x.settlement] === a) { ox.product[k] = x.settlement; hit = x.settlement }
          break
        case OrderKind.Idea:
          if ((ty === EventType.IdeaAdopted || ty === EventType.IdeaConceived) && x.value === t && x.settlement >= 0 && s.people[x.settlement] === a) { ox.product[k] = x.settlement; hit = x.settlement }
          else if (ty === EventType.IdeaResisted && x.value === t && x.settlement >= 0 && s.people[x.settlement] === a) ox.refused[k] = 1
          break
        case OrderKind.War:
          if (ty === EventType.WarDeclared && ps !== null) {
            const w = x.value
            if ((ps.wAtt[w] === a && ps.wDef[w] === t) || (ps.wAtt[w] === t && ps.wDef[w] === a)) { ox.product[k] = w; hit = x.settlement }
          }
          break
        case OrderKind.Peace:
          if (ty === EventType.PeaceMade && ps !== null) {
            const w = x.value
            if ((ps.wAtt[w] === a && ps.wDef[w] === t) || (ps.wAtt[w] === t && ps.wDef[w] === a)) { ox.product[k] = w; hit = ps.pCapital[a] }
          }
          break
        case OrderKind.Seat:
          if (ty === EventType.CapitalMoved && x.value === a && x.settlement === t) { ox.product[k] = t; hit = t }
          break
        case OrderKind.Faith:
          if (ty === EventType.RulerConverted && x.value === t && ps !== null && livePolity(ps, a) && ps.pCapital[a] === x.settlement) {
            ox.product[k] = s.rul !== null && a < s.rul.pcap ? s.rul.cur[a] : -1
            hit = x.settlement
          }
          break
        case OrderKind.Fortify:
          if (ty === EventType.Built && x.value === StructureType.Walls && x.settlement === a) { ox.product[k] = x.other; hit = a }
          break
        case OrderKind.Quarantine:
          if (ty === EventType.Quarantine && x.settlement === a) { ox.product[k] = a; hit = a }
          break
      }
      if (hit >= 0) {
        if (ox.acted[k] < 0) ox.acted[k] = s.year
        resolve(s, ox, k, OrderStatus.Fulfilled, kd === OrderKind.Explore ? OrderReason.Reached : OrderReason.Done, hit)
      }
    }
  }
  // Explore: the target came to be known otherwise (a people met shared its maps).
  for (const k of ox.active) {
    if (ox.status[k] !== OrderStatus.Active || ox.kind[k] !== OrderKind.Explore) continue
    if (s.know.known[ox.actor[k] * N + ox.target[k]] >= 0) resolve(s, ox, k, OrderStatus.Fulfilled, OrderReason.Done, seatOf(s, ox, k))
  }
  // Actors and targets gone; time run out.
  for (const k of ox.active) {
    if (ox.status[k] !== OrderStatus.Active) continue
    const gone = goneReason(s, ox, k)
    if (gone !== OrderReason.None) { resolve(s, ox, k, OrderStatus.Failed, gone, seatOf(s, ox, k)); continue }
    if (s.year < ox.until[k]) continue
    const partly = ox.acted[k] >= 0
    resolve(s, ox, k, partly ? OrderStatus.Partly : OrderStatus.Expired, partly ? (ox.kind[k] === OrderKind.Explore ? OrderReason.Reached : OrderReason.Done) : blocker(s, ox, k), seatOf(s, ox, k))
  }
  let w = 0
  for (const k of ox.active) if (ox.status[k] === OrderStatus.Active) { ox.active[w++] = k; if (ox.kind[k] === OrderKind.Explore || ox.kind[k] === OrderKind.Settle) reachOf(s, ox, k) }
  if (w !== ox.active.length) { ox.active.length = w; tables(ox) }
  ox.evSeen = s.events.length
}

/** Explore, Settle: the chord from the people's nearest town of at least ORDERS.senderPop people to the target (Infinity: none). */
function reachOf(s: HistoryState, ox: OrdersState, k: number): void {
  const a = ox.actor[k], t = ox.target[k]
  let d = Infinity
  const living = s.living
  for (let i = 0; i < living.length; i++) {
    const id = living[i]
    if (s.people[id] !== a || s.outpost[id] || s.pop[id] < ORDERS.senderPop) continue
    const x = chordCells(s, s.cell[id], t)
    if (x < d) d = x
  }
  ox.reach[k] = d
}

/** The journey (History.journeys id) of the expedition from `id` recorded this year, or -1. */
function expeditionJourney(s: HistoryState, id: number): number {
  const J = s.journeys
  for (let i = J.length - 1; i >= 0 && J[i].arriveYear === s.year; i--) if (J[i].from === id && J[i].kind === JourneyKind.Expedition) return i
  return -1
}

/** OrderReason.ActorGone / TargetGone (or NotMember) when the order can no longer act, else None. */
function goneReason(s: HistoryState, ox: OrdersState, k: number): number {
  const kd = ox.kind[k], a = ox.actor[k], t = ox.target[k]
  const ps = s.pol
  if (isPeopleKind(kd)) return seatOfPeople(s, a) < 0 ? OrderReason.ActorGone : OrderReason.None
  if (isPolityKind(kd)) {
    if (ps === null || !livePolity(ps, a)) return OrderReason.ActorGone
    if ((kd === OrderKind.War || kd === OrderKind.Peace) && !livePolity(ps, t)) return OrderReason.TargetGone
    if (kd === OrderKind.Seat && !liveTown(s, t)) return OrderReason.TargetGone
    return OrderReason.None
  }
  return liveTown(s, a) ? OrderReason.None : OrderReason.ActorGone
}

/** Why an order ran out of time with nothing done (a look at the state when it lapses). */
function blocker(s: HistoryState, ox: OrdersState, k: number): number {
  const kd = ox.kind[k], a = ox.actor[k], t = ox.target[k]
  const R = OrderReason
  const ps = s.pol
  switch (kd) {
    case OrderKind.Explore: return ox.refused[k] ? R.OutOfReach : R.NoExpedition
    case OrderKind.Settle: return R.NoRoom
    case OrderKind.Crop: return R.NoSource
    case OrderKind.Idea: return ox.refused[k] ? R.Refused : R.NoSource
    case OrderKind.War: {
      if (ps === null) return R.SystemOff
      const r = relIdx(ps, a, t)
      if (r < 0 || ps.relEdges[r].length === 0) return R.NoBorder
      if (s.year < ps.relTruce[r] || bound(ps, a, t)) return R.Truce
      if (ps.pWars[a] >= WAR.maxWars) return R.Busy
      return R.TooWeak
    }
    case OrderKind.Peace: return atWar(ps as PolityState, a, t) ? R.Refused : R.NotAtWar
    case OrderKind.Seat: {
      if (ps === null) return R.SystemOff
      if (t >= ps.polity.length || ps.polity[t] !== a) return R.NotMember
      const cap = ps.pCapital[a]
      return cap >= 0 && s.pop[t] < ORDERS.seatShare * s.pop[cap] ? R.TooWeak : R.Refused
    }
    case OrderKind.Faith: {
      // (a ruler of one universal faith turns to another only when the capital has: religion/system.ts rulersStep)
      const rel = s.rel
      if (rel === null || ps === null || !livePolity(ps, a)) return R.SystemOff
      const rf = polityFaith(s, rel, a), c = ps.pCapital[a]
      if (rf >= 0 && rel.kind[rf] === FaithKind.Universal && shareOf(rel, c, t) <= shareOf(rel, c, rf)) return R.Refused
      return R.Absent
    }
    case OrderKind.Fortify: return R.TooWeak
    case OrderKind.Quarantine: {
      if (ps === null || s.port[a] < 0 || a >= ps.polity.length || ps.polity[a] < 0) return R.NotPort
      const p = s.people[a]
      if (s.tech[p * TECH_FIELD_COUNT + TechField.Crafts] < QUARANTINE.crafts || (s.ideas !== null && !ideaQuarantine(s.ideas, p))) return R.Unskilled
      return R.Refused
    }
  }
  return R.None
}

/** History.orders and orderOutcomes up to year `years` (an order not yet given is Pending). */
export function assembleOrders(ox: OrdersState, years: number): { orders: Order[]; orderOutcomes: OrderOutcome[] } {
  const orders = ox.given.map((o) => ({ ...o }))
  const orderOutcomes: OrderOutcome[] = []
  for (let k = 0; k < ox.n; k++) {
    if (ox.year[k] > years) { orderOutcomes.push({ status: OrderStatus.Pending, reason: OrderReason.None, year: -1, acted: -1, product: -1, place: -1 }); continue }
    orderOutcomes.push({ status: ox.status[k] as OrderStatus, reason: ox.reason[k] as OrderReason, year: ox.done[k], acted: ox.acted[k], product: ox.product[k], place: ox.place[k] })
  }
  return { orders, orderOutcomes }
}
