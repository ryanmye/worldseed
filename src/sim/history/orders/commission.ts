// orders: lane N3c's patronage order, OrderKind.Commission (seat-only, given by the Patronage card). The crown pays for a great
// work in one of its major towns; the landmarks system raises it (landmarks/system.ts commissions: begun the year it is given,
// halted a year for every year the realm is at war, given up on a default, a rising of the town or a civil war, besides the
// rules every great work obeys: sacked, abandoned, lost, the realm ended). Every effect is the actor's own: without the order
// the run is exactly the one without it.
//
//   give (seatGive)   the kind chosen by context (commissionPick): a victory monument at the capital after a war won within
//                     SEAT.commissionVictory years, a great temple of the state faith, a great library where the people writes,
//                     else a market hall; the down payment (finance: commissionDown x R° from the treasury; without: commissionCost
//                     of the capital's wealth) or Failed (Refused); the build years and the variant drawn from the orders' stream.
//   each year (ordersEnd, commissionEnd)   while it is building, the instalment (commissionYearly x R°, or commissionUpkeep of the
//                     capital's wealth): unpaid, the work is given up the next year (Refused); each year the realm is at war,
//                     with chance SEAT.commissionWarStop (orders' stream) the war takes the masons and the coin: given up the
//                     next year (AtWar). Finished: Fulfilled, product the
//                     landmark; given up: Failed with the cause (Refused a default or unpaid masons, AtWar, Rising a revolt or civil war,
//                     NotMember the town lost, TargetGone sacked or abandoned, ActorGone the realm ended).
import { FaithKind, LandmarkKind, LandmarkState, OrderKind, OrderReason, OrderStatus, WarOutcome } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { IDEA_INDEX } from '../ideas/state.ts'
import { K as SLOTS } from '../religion/state.ts'
import { finRevOrd, finSpend } from '../finance/hooks.ts'
import { SEAT } from '../seat/params.ts'
import type { OrdersState } from './state.ts'

const KD = LandmarkKind
const I_WRITING = IDEA_INDEX.get('writing') ?? -1

const member = (ps: PolityState, id: number, p: number): boolean => id >= 0 && id < ps.polity.length && ps.polity[id] === p

/** The build years of a commissioned work of kind `kind` ([min, max]; SEAT.commissionBuild). */
export function commissionBuild(kind: number): readonly [number, number] {
  const B = SEAT.commissionBuild
  return kind === KD.Monument ? B.monument : kind === KD.GreatTemple ? B.temple : kind === KD.Library ? B.library : B.market
}

/** p won a war (took land, a conquest or tribute as attacker; held and gained as defender) that ended within SEAT.commissionVictory years. */
export function wonLately(s: HistoryState, ps: PolityState, p: number): boolean {
  for (let w = ps.wEnd.length - 1; w >= 0; w--) {
    const e = ps.wEnd[w]
    if (e < 0 || s.year - e > SEAT.commissionVictory) continue
    const o = ps.wOutcome[w]
    if ((ps.wAtt[w] === p && (o === WarOutcome.AttackerGains || o === WarOutcome.Conquest || o === WarOutcome.Tribute)) || (ps.wDef[w] === p && o === WarOutcome.DefenderGains)) return true
  }
  return false
}

/** The faith p's crown holds (-1 none or without religion). */
function crownFaith(s: HistoryState, p: number): number {
  const rel = s.rel
  return rel !== null && p >= 0 && p < rel.pcap ? rel.state[p] : -1
}

/** The town's majority faith (-1). */
function majorityOf(s: HistoryState, v: number): number {
  const rel = s.rel
  if (rel === null || v >= rel.seen || rel.fN[v] === 0) return -1
  return rel.fId[v * SLOTS]
}

/**
 * The great work p's crown would raise at town v now (a LandmarkKind), -1 when none fits: a victory monument at the capital
 * after a war won lately, a great temple of the crown's universal faith where the town follows it, a great library where its
 * people writes, else a market hall; each only where the town has none of the kind (begun and not given up). Pure reads.
 */
export function commissionPick(s: HistoryState, p: number, v: number): number {
  const ps = s.pol, lm = s.lm
  if (ps === null || lm === null || v < 0 || v >= lm.seen || !member(ps, v, p)) return -1
  const has = lm.has[v]
  const lacks = (k: number) => (has & (1 << k)) === 0
  if (v === ps.pCapital[p] && lacks(KD.Monument) && wonLately(s, ps, p)) return KD.Monument
  const f = crownFaith(s, p)
  if (f >= 0 && s.rel !== null && s.rel.kind[f] === FaithKind.Universal && majorityOf(s, v) === f && lacks(KD.GreatTemple)) return KD.GreatTemple
  const ix = s.ideas
  const writes = ix !== null && I_WRITING >= 0 && ix.held[s.people[v] * ix.I + I_WRITING] === 1
  if (writes && lacks(KD.Library)) return KD.Library
  return lacks(KD.MarketHall) ? KD.MarketHall : -1
}

/** A major town of p: the capital, or one of at least max(commissionPop, commissionTown x the capital's) people. */
export function majorTown(s: HistoryState, ps: PolityState, p: number, v: number): boolean {
  const cap = ps.pCapital[p]
  if (v === cap) return true
  if (v < 0 || v >= s.count || s.abandoned[v] >= 0 || s.outpost[v] || !member(ps, v, p)) return false
  const need = cap >= 0 ? Math.max(SEAT.commissionPop, SEAT.commissionTown * s.pop[cap]) : SEAT.commissionPop
  return s.pop[v] >= need
}

/** The town p's court would build in: the capital if a work fits there, else the largest major town where one does (-1). */
export function commissionTown(s: HistoryState, ps: PolityState, p: number): number {
  const cap = ps.pCapital[p]
  if (cap >= 0 && commissionPick(s, p, cap) >= 0) return cap
  let best = -1
  for (const id of s.living) {
    if (id === cap || !majorTown(s, ps, p, id) || commissionPick(s, p, id) < 0) continue
    if (best < 0 || s.pop[id] > s.pop[best]) best = id
  }
  return best
}

/** The down payment now (finance: commissionDown x R°; without finance: commissionCost of the capital's wealth). */
export function commissionDown(s: HistoryState, ps: PolityState, p: number): number {
  if (s.fin !== null) return SEAT.commissionDown * finRevOrd(s, p)
  const cap = ps.pCapital[p]
  return cap >= 0 ? SEAT.commissionCost * s.wealth[cap] : 0
}

/** The crown can pay the down payment `mul` times over (finance: its treasury; without: a capital of some wealth). */
export function commissionAfford(s: HistoryState, ps: PolityState, p: number, mul: number): boolean {
  const fin = s.fin
  if (fin !== null) return p < fin.pcap && fin.revOrd[p] > 0 && fin.treas[p] >= mul * commissionDown(s, ps, p)
  const cap = ps.pCapital[p]
  return cap >= 0 && s.wealth[cap] > 0
}

/** A commission of p in force (given, not resolved), -1. */
export function commissionOf(s: HistoryState, p: number): number {
  const ox = s.orders
  if (ox === null) return -1
  for (const k of ox.active) if (ox.kind[k] === OrderKind.Commission && ox.actor[k] === p && ox.status[k] === OrderStatus.Active) return k
  return -1
}

/** Why Commission by a at town t could not act now (orders/system.ts orderCheck; the polity is alive). */
export function commissionCheck(s: HistoryState, ps: PolityState, a: number, t: number): number {
  const R = OrderReason
  if (s.lm === null) return R.SystemOff
  if (t < 0 || t >= s.count || s.abandoned[t] >= 0 || s.outpost[t]) return R.NoTarget
  if (!member(ps, t, a)) return R.NotMember
  if (!majorTown(s, ps, a, t)) return R.TooWeak
  if (commissionOf(s, a) >= 0) return R.Busy
  if (commissionPick(s, a, t) < 0) return R.AlreadyDone
  return commissionAfford(s, ps, a, 1) ? R.None : R.Refused
}

/** At give (seatGive): the kind, the down payment, the build years and variant (orders' stream). Returns the status. */
export function commissionGive(s: HistoryState, ox: OrdersState, ps: PolityState, k: number): number {
  const a = ox.actor[k], t = ox.target[k]
  const kind = commissionPick(s, a, t)
  if (kind < 0) { ox.reason[k] = OrderReason.AlreadyDone; return OrderStatus.Failed }
  const cost = commissionDown(s, ps, a)
  if (s.fin !== null) {
    if (!finSpend(s, a, cost, 'other')) { ox.reason[k] = OrderReason.Refused; return OrderStatus.Failed }
  } else {
    const cap = ps.pCapital[a]
    if (cap >= 0) s.wealth[cap] -= cost
  }
  const [lo, hi] = commissionBuild(kind)
  const years = ox.rng.int(lo, hi)
  const variant = ox.rng.int(0, 3)
  ox.best[k] = kind + 16 * variant // (read by landmarks/system.ts commissions)
  ox.reach[k] = years
  ox.refused[k] = 0
  return OrderStatus.Active
}

/**
 * ordersEnd (after the landmarks' year): order k's work finished (Fulfilled: the town), given up (Failed: its cause), or still
 * building (this year's instalment; unpaid, the work stops next year). Returns [status, reason, place] when resolved, else null.
 */
export function commissionEnd(s: HistoryState, ox: OrdersState, k: number): [number, number, number] | null {
  const lm = s.lm, ps = s.pol
  const a = ox.actor[k], v = ox.target[k], id = ox.product[k]
  if (lm === null || ps === null) return [OrderStatus.Failed, OrderReason.SystemOff, v]
  if (id < 0) {
    // (not begun: the town was lost or ruined between the order and the masons)
    if (ps.pEnded[a] >= 0) return [OrderStatus.Failed, OrderReason.ActorGone, -1]
    return [OrderStatus.Failed, member(ps, v, a) ? OrderReason.TargetGone : OrderReason.NotMember, v]
  }
  if (lm.lDone[id] >= 0) return [OrderStatus.Fulfilled, OrderReason.Done, lm.lSett[id]]
  if (lm.lState[id] === LandmarkState.Unfinished) {
    const why = lm.comWhy.get(id)
    if (why !== undefined) return [OrderStatus.Failed, why, v]
    if (ps.pEnded[a] >= 0) return [OrderStatus.Failed, OrderReason.ActorGone, -1]
    return [OrderStatus.Failed, member(ps, v, a) ? OrderReason.TargetGone : OrderReason.NotMember, v]
  }
  // building: the war's toll (a draw only in a year at war), then this year's instalment
  if (ps.pWars[a] > 0 && ox.rng.next() < SEAT.commissionWarStop) { ox.refused[k] = 2; return null }
  if (s.fin !== null) {
    const due = SEAT.commissionYearly * finRevOrd(s, a)
    if (due > 0 && !finSpend(s, a, due, 'other')) ox.refused[k] = 1
  } else {
    const cap = ps.pCapital[a]
    if (cap >= 0) s.wealth[cap] -= SEAT.commissionUpkeep * s.wealth[cap]
  }
  return null
}
