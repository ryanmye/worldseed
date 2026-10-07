// The player's nudges in words (orders: contract.ts Order, OrderOutcome; events 170-173): a one-line story per order in the
// wording of the stats harness's story() (sim/history/orders/ordersStats.ts) with the reasons in words, the chronicle and
// inspector lines of the order events, their chronicle category and headlines. Pure functions of the History (and of the
// place namer the Nudge panel registers for target cells, which needs the world's detected features).

import { OrderKind, OrderReason, OrderStatus, describeOrderKinds, settlementNameAt } from '../contract.ts'
import type { History, HistoryEvent, Order, OrderOutcome } from '../contract.ts'

export const ORDER_KINDS = describeOrderKinds()

/** Order events: OrderGiven 170, OrderFulfilled 171, OrderFailed 172, OrderLapsed 173. */
export const ORDER_GIVEN = 170, ORDER_FULFILLED = 171, ORDER_FAILED = 172, ORDER_LAPSED = 173
export const isOrderEvent = (t: number) => t >= ORDER_GIVEN && t <= ORDER_LAPSED

/** "the Chakan Nain" for a cell (the most local feature named by `year`), or '' when it has no name yet (set by the Nudge panel). */
let placeNamer: ((cell: number, year: number) => string) | null = null
export function setOrderPlaceNamer(fn: ((cell: number, year: number) => string) | null): void {
  placeNamer = fn
}

/** Why an order came out as it did, in words (by kind where the reason reads differently). */
export function reasonWords(reason: number, kind: number): string {
  switch (reason) {
    case OrderReason.NoActor: return kind === OrderKind.Fortify || kind === OrderKind.Quarantine ? 'no such town then' : kind <= OrderKind.Idea ? 'no such people then' : 'no such state then'
    case OrderReason.NoTarget: return 'not something it could be urged toward'
    case OrderReason.SystemOff: return 'that part of the rules is switched off'
    case OrderReason.AlreadyDone:
      switch (kind) {
        case OrderKind.Explore: return 'it already knows the place'
        case OrderKind.Crop: return 'it already has it'
        case OrderKind.Idea: return 'it already holds it'
        case OrderKind.War: return 'already at war with them'
        case OrderKind.Seat: return 'already its capital'
        case OrderKind.Faith: return 'already the ruler’s faith'
        case OrderKind.Fortify: return 'its walls are already up'
        case OrderKind.Quarantine: return 'already in quarantine'
      }
      return 'already so'
    case OrderReason.ActorGone: return 'it was gone before it could'
    case OrderReason.TargetGone: return 'the other side was gone'
    case OrderReason.Unknown: return 'its people do not know the land that way'
    case OrderReason.Unfit: return kind === OrderKind.Settle ? 'that is sea' : 'it grows at none of its towns'
    case OrderReason.NoSource: return kind === OrderKind.Idea ? 'no one it has met holds it, and it cannot conceive it' : 'no one it knows has it, nor the wild near its fields'
    case OrderReason.Prerequisite: return 'it lacks an idea this one rests on'
    case OrderReason.NoBorder: return 'no border with them'
    case OrderReason.Truce: return 'a truce holds between them'
    case OrderReason.TooWeak: return kind === OrderKind.War ? 'never strong enough at the border to dare it' : 'too small a town'
    case OrderReason.NotAtWar: return 'already at peace'
    case OrderReason.NotMember: return 'the town is not in the realm'
    case OrderReason.Refused: return kind === OrderKind.Idea ? 'its faithful or its guilds would not have it' : 'the ruler would not'
    case OrderReason.NotPort: return 'no port there'
    case OrderReason.Unskilled: return 'its people lack the craft of quarantine'
    case OrderReason.Absent: return 'too few of the realm follow it'
    case OrderReason.Reached: return 'an expedition reached it'
    case OrderReason.NoExpedition: return 'no town of its people could send an expedition'
    case OrderReason.Done: return 'it came about'
    case OrderReason.Busy: return 'already fighting as many wars as it can'
    case OrderReason.OutOfReach: return 'its expeditions found nothing unknown within reach that way'
    case OrderReason.NoRoom: return 'its settlers found no free land within reach that way'
  }
  return ''
}

/** Status words: pending, in force, fulfilled, partly, failed, expired. */
export const STATUS_WORDS: readonly string[] = ['pending', 'in force', 'fulfilled', 'partly', 'failed', 'expired']

const aliveAt = (h: History, id: number, y: number) => {
  const x = h.settlements[id]
  return !!x && x.foundedYear <= y && (x.abandonedYear < 0 || x.abandonedYear > y)
}
const snapOf = (h: History, y: number) => Math.max(0, Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval)))

/** The largest living town of people `p` at year `y` (its seat), or -1. */
export function peopleSeat(h: History, p: number, y: number): number {
  const S = h.settlements.length, base = snapOf(h, y) * S
  let best = -1
  for (let i = 0; i < S; i++) {
    const x = h.settlements[i]
    if (x.people !== p || x.outpost || !aliveAt(h, i, y)) continue
    if (best < 0 || h.population[base + i] > h.population[base + best]) best = i
  }
  return best
}

/** The capital of polity `p` at year `y`, or -1. */
export function capitalAt(h: History, p: number, y: number): number {
  const P = h.polities[p]
  if (!P) return -1
  let c = -1
  for (let k = 0; k < P.capitals.length && P.capitalYears[k] <= y; k++) c = P.capitals[k]
  return c < 0 && P.capitals.length ? P.capitals[0] : c
}

const town = (h: History, id: number, y: number) => (id >= 0 && id < h.settlements.length ? settlementNameAt(h, id, y) : 'a town')
/** (politiesData.ts's qualifiers: a successor that kept its parent's name is "North Temukuntin") */
const QUALIFIERS: readonly string[] = ['', 'North', 'South', 'East', 'West', 'New', 'Upper', 'Lower', 'Restored']
/** A state's short name with its qualifier ("North Temukuntin"). */
export function polityWords(h: History, p: number): string {
  const x = p >= 0 && p < h.polities.length ? h.polities[p] : null
  if (!x) return 'a state'
  const q = QUALIFIERS[x.qualifier] ?? ''
  return q ? `${q} ${x.name}` : x.name
}
const polName = polityWords
const pplName = (h: History, p: number) => (p >= 0 && p < h.peoples.length ? 'the ' + h.peoples[p].name : 'a people')
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Compass direction of cell `b` seen from cell `a` ("north", "south-west", ...), from the planet's cell positions (none without a world). */
let positions: Float32Array | null = null
export function setOrderPositions(p: Float32Array | null): void {
  positions = p
}
function bearing(a: number, b: number): string {
  if (!positions) return ''
  const P = positions
  const lat = (c: number) => Math.asin(Math.max(-1, Math.min(1, P[c * 3 + 1])))
  const lon = (c: number) => Math.atan2(P[c * 3], P[c * 3 + 2])
  const f1 = lat(a), f2 = lat(b), dl = lon(b) - lon(a)
  const y = Math.sin(dl) * Math.cos(f2)
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8]
}

/** A target cell in words: its most local named feature ("the Chakan Nain"), else "the land {direction} of {the actor's seat}", else "cell N". */
export function cellWords(h: History, cell: number, year: number, from = -1): string {
  const named = placeNamer?.(cell, year) ?? ''
  if (named) return named
  if (from >= 0 && from < h.settlements.length) {
    const d = bearing(h.settlements[from].cell, cell)
    if (d) return `the land ${d} of ${town(h, from, year)}`
  }
  return `cell ${cell}`
}

/** What the order urges, after "urged to": "explore toward the Chakan Nain", "make war on Kubeta", "raise walls". */
export function urgePhrase(h: History, o: Order): string {
  const t = o.target ?? -1
  const y = o.year
  switch (o.kind) {
    // (the place by the name it bears by the end of the run: the story is told looking back)
    case OrderKind.Explore: return `explore toward ${cellWords(h, t, h.years, peopleSeat(h, o.actor, y - 1))}`
    case OrderKind.Settle: return `settle toward ${cellWords(h, t, h.years, peopleSeat(h, o.actor, y - 1))}`
    case OrderKind.Crop: { const s = h.species[t]; return s ? `take up ${s.name} (${s.archetype})` : 'take up a crop' }
    case OrderKind.Idea: return `seek ${h.ideas[t]?.name ?? 'an idea'}`
    case OrderKind.War: return `make war on ${polName(h, t)}`
    case OrderKind.Peace: return `make peace with ${polName(h, t)}`
    case OrderKind.Seat: return `move its court to ${town(h, t, y)}`
    case OrderKind.Faith: return `take up the ${h.faiths[t]?.name ?? '?'} faith`
    case OrderKind.Fortify: return 'raise walls'
    case OrderKind.Quarantine: return 'hold ships in quarantine'
  }
  return ORDER_KINDS[o.kind]?.label.toLowerCase() ?? 'act'
}

/** The order's actor by name: "the Krakinoth", "Temukuntin", "the ruler of Temukuntin", "Thimin", "the port of Thimin". */
export function actorWords(h: History, o: Order): string {
  if (o.kind <= OrderKind.Idea) return pplName(h, o.actor)
  if (o.kind === OrderKind.Faith) return `the ruler of ${polName(h, o.actor)}`
  if (o.kind === OrderKind.Quarantine) return `the port of ${town(h, o.actor, o.year)}`
  if (o.kind === OrderKind.Fortify) return town(h, o.actor, o.year)
  return polName(h, o.actor)
}

/** Whether the actor takes a plural verb (a people). */
const plural = (o: Order) => o.kind <= OrderKind.Idea

/** What was done, for a fulfilled order ("send an expedition from Songailsak that reaches it"), agreeing with the actor. */
function doneWords(h: History, o: Order, r: OrderOutcome): string {
  const yr = r.year
  const at = r.place >= 0 ? town(h, r.place, yr) : ''
  const pl = plural(o)
  switch (o.kind) {
    case OrderKind.Explore: {
      const from = r.product >= 0 && h.journeys && r.product < h.journeys.count ? h.journeys.from[r.product] : -1
      return r.reason === OrderReason.Reached ? `send an expedition${from >= 0 ? ` from ${town(h, from, yr)}` : at ? ` from ${at}` : ''} that reaches it` : 'learn of it from others'
    }
    case OrderKind.Settle: return `found ${town(h, r.product, yr)}`
    case OrderKind.Crop: case OrderKind.Idea: return at ? `take it up at ${at}` : 'take it up'
    case OrderKind.War: return h.wars.attacker[r.product] === o.actor ? (pl ? 'declare war' : 'declares war') : 'is attacked first'
    case OrderKind.Peace: return 'makes peace'
    case OrderKind.Seat: return 'moves the court there'
    case OrderKind.Faith: return 'converts'
    case OrderKind.Fortify: return 'raises walls'
    case OrderKind.Quarantine: return 'begins a quarantine'
  }
  return 'does it'
}

/** In force for this many years from its year (describeOrderKinds). */
export const orderYears = (o: Order) => ORDER_KINDS[o.kind]?.years ?? 0

/**
 * The one-line story of order k of `h` (final, as the run ends): "The Krakinoth, urged to explore toward the Chakan Nain,
 * send an expedition from Songailsak that reaches it in 1010".
 */
export function orderStory(h: History, k: number): string {
  const o = h.orders?.[k]
  if (!o) return ''
  const r = h.orderOutcomes?.[k]
  const ask = `${cap(actorWords(h, o))}, urged to ${urgePhrase(h, o)}`
  if (!r) return `${ask} in ${o.year}`
  const yr = r.year
  switch (r.status) {
    case OrderStatus.Fulfilled: return `${ask}, ${doneWords(h, o, r)} in ${yr}`
    case OrderStatus.Partly: {
      const what = o.kind === OrderKind.Explore ? `an expedition${r.place >= 0 ? ` from ${town(h, r.place, yr)}` : ''} went that way but did not reach it`
        : o.kind === OrderKind.Settle && r.product >= 0 ? `${town(h, r.product, yr)} was founded nearer` : reasonWords(r.reason, o.kind)
      return `${ask}: by ${yr} ${what}`
    }
    case OrderStatus.Failed: return `${ask}: failed in ${yr}, ${reasonWords(r.reason, o.kind)}`
    case OrderStatus.Expired: return `${ask}: nothing came of it by ${yr}${r.reason ? `, ${reasonWords(r.reason, o.kind)}` : ''}`
    case OrderStatus.Active: return `${ask}: still in force at the end of the run`
  }
  return `${ask}: from ${o.year}, after the end of the run`
}

/** The status of an order as of `year` (what the list and the map show then): Pending before its year, Active until it is resolved. */
export function statusAt(o: Order, r: OrderOutcome | undefined, year: number): number {
  if (year < o.year) return OrderStatus.Pending
  if (!r) return OrderStatus.Active
  if (r.year >= 0 && year >= r.year) return r.status
  return r.status === OrderStatus.Pending ? OrderStatus.Pending : OrderStatus.Active
}

// ---------- chronicle and inspector ----------

/** Chronicle line of an order event. */
export function describeOrderEvent(h: History, e: HistoryEvent): string | null {
  const t = e.type as number
  if (!isOrderEvent(t)) return null
  const o = h.orders?.[e.value]
  if (!o) return 'An order'
  if (t === ORDER_GIVEN) return `${cap(actorWords(h, o))} ${plural(o) ? 'are' : 'is'} urged to ${urgePhrase(h, o)}`
  return orderStory(h, e.value)
}

/** Inspector line of an order event for settlement `id` (the actor's seat, or where it came to pass). */
export function describeOrderEventFor(h: History, e: HistoryEvent, id: number): string | null {
  const t = e.type as number
  if (!isOrderEvent(t)) return null
  const o = h.orders?.[e.value]
  if (!o) return 'An order'
  const line = describeOrderEvent(h, e) ?? ''
  if (t === ORDER_FULFILLED && e.settlement !== id && e.other === id) return `Played its part: ${line}`
  return `Nudge: ${line}`
}

/** Chronicle category of an order event: Politics and war for the state's and the town's orders, Trade and exploration for the people's. */
export function orderEventIsPolitics(h: History, e: HistoryEvent): boolean {
  const o = h.orders?.[e.value]
  return !!o && o.kind >= OrderKind.War
}

/** A fulfilled order is a headline. */
export const isOrderHeadline = (e: HistoryEvent) => (e.type as number) === ORDER_FULFILLED
