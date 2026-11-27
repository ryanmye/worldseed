// orders: seat-mode's court kinds (seat-mode §3.6; OrderKind 11-20, 22), given only by decision cards. Their checks, what they do
// when given (ordersBegin), and how they are matched at the end of the year (ordersEnd). What they do while in force lives in
// the systems' hooks (orders/hooks.ts: the alliance pass, marriages, the succession, the overthrow chance, the realm's mass, the
// war's end, finance's borrowing and taxes, the oaths' betrayal step). Every effect is the actor's own: with none of these
// orders the run is exactly the one without them. Draws only from the orders' stream ('history-orders').
//
//   Repudiate p -> q   at give: the alliance (BondEnd.Renounced) and any marriage tie end; rivalry + SEAT.renounceR; with oaths
//                      q holds an AllyBetrayed grievance at SEAT.renounceGrief of its weight. BondRenounced. Fulfilled at once.
//   Repudiate p -> p   (finance) the crown refuses its debts in this year's fiscal step (finance/system.ts). Fulfilled on Repudiation.
//   Defy p -> o        at give: the bond to the overlord is thrown off (BondEnd.Freed, as bondStep's own), rivalry >= secedeR. BondRenounced.
//   Submit p -> q      in force: a yearly draw after the war's first year (war.ts); accepted: the war ends, p pays tribute. TributeOffered.
//   Ally p -> q        in force: the alliance pass (bonds.ts, align.ts) reads the threat lower and the chance higher for the pair.
//   Marry p -> q       in force: marriageStep waives the rivalry test for the pair and a refused draw may still be agreed.
//   Designate p -> born   at give: HeirNamed. In force: the succession picks the designee (rulers/system.ts). Fulfilled at accession.
//   Placate p          at give: paid (capital wealth, or the treasury with finance); an open crisis ends next year; member unrest
//                      eased. CourtPlacated. In force: the overthrow chance x SEAT.placateMul (C3 order factor).
//   Purge p            at give: one draw: the general strikes first (the ruler overthrown next year) or is purged. GeneralPurged.
//                      In force (purged): no overthrow (C3 = 0), the realm's mass x SEAT.purgeMass.
//   Borrow p           (finance) in force: the crown borrows to a war chest even at peace. Fulfilled when its debt grows.
//   Levy p             finance: in force, the tax pressure eases toward its highest. Without: at give, SEAT.levyShare of the
//                      members' wealth to the capital, unrest + levyUnrest. LevyRaised.
//   Betray p -> q      (oaths) in force: betrayalStep defects the ordered ally when it can (offer or tired). Fulfilled on Betrayal.

import { BondEnd, BondKind, EventType, GrievanceKind, OrderKind, OrderReason, OrderStatus, ReignEnd } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { atWar } from '../polity/formation.ts'
import { allied, endBond, overlordOf } from '../polity/bonds.ts'
import { ensureRelation, relIdx } from '../polity/relations.ts'
import { RELATION, OATH } from '../polity/params.ts'
import { recordGrievance } from '../polity/grievances.ts'
import { allianceBond } from '../polity/oaths.ts'
import { at } from '../polity/grudgeState.ts'
import { RULERS } from '../rulers/params.ts'
import { finSpend, finRevOrd } from '../finance/hooks.ts'
import { SEAT } from '../seat/params.ts'
import type { OrdersState } from './state.ts'

const H = RULERS.heirs

/** Kinds handled here (11-20, 22). */
export const isSeatKind = (k: number): boolean => (k >= OrderKind.Repudiate && k <= OrderKind.Levy) || k === OrderKind.Betray
/** Seat kinds whose target is a polity (the Repudiate of the crown's debts names the actor itself). */
export const seatPolityTarget = (k: number): boolean => k === OrderKind.Repudiate || k === OrderKind.Defy || k === OrderKind.Submit || k === OrderKind.Ally || k === OrderKind.Marry || k === OrderKind.Betray
/** Seat kinds that act while in force and are done when their time runs out having acted (Fulfilled, not Partly). */
export const seatInForce = (k: number): boolean => k === OrderKind.Placate || k === OrderKind.Purge || k === OrderKind.Levy

const livePolity = (ps: PolityState, p: number): boolean => p >= 0 && p < ps.pCapital.length && ps.pEnded[p] < 0

function push(s: HistoryState, type: number, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type: type as EventType, settlement, other, value, extra })
}

/** The marriage tie between p's and q's houses now, -1. */
function tieOf(s: HistoryState, p: number, q: number): number {
  const R = s.rul
  if (R === null) return -1
  const a = p < q ? p : q, b = p < q ? q : p
  for (const m of R.mActive) if (R.mA[m] === a && R.mB[m] === b) return m
  return -1
}

/** The pool slot of p's heir born in `born` who is alive now, -1. */
export function heirSlot(s: HistoryState, p: number, born: number): number {
  const R = s.rul
  if (R === null || p >= R.pcap) return -1
  for (let k = 0; k < R.hN[p]; k++) if (R.hBorn[p * H + k] === born && R.hDeath[p * H + k] > s.year) return k
  return -1
}

/** p is an ally in an alliance war beside q (the oaths' record of the war it joined): that war, -1. */
export function allyWar(ps: PolityState, p: number, q: number): number {
  const og = ps.og
  if (og === null || !og.oaths) return -1
  for (const wx of ps.activeWars) {
    if (ps.wAtt[wx] !== p) continue
    const wq = at(og.wAlly, wx, -1)
    if (wq >= 0 && ps.wEnd[wq] < 0 && ps.wDef[wq] === q) return wx
  }
  return -1
}

/** Why a seat kind could not act if given now (orders/system.ts orderCheck for kinds 11-20, 22; the polity is alive). */
export function seatCheck(s: HistoryState, ps: PolityState, kd: number, a: number, t: number): number {
  const R = OrderReason
  if (kd === OrderKind.Repudiate && t === a) {
    const fin = s.fin
    if (fin === null) return R.SystemOff
    return a < fin.pcap && fin.debt[a] > 0 ? R.None : R.NoBond
  }
  if (seatPolityTarget(kd) && (t === a || !livePolity(ps, t))) return R.NoTarget
  const rul = s.rul
  switch (kd) {
    case OrderKind.Repudiate: return allianceBond(ps, a, t) >= 0 || tieOf(s, a, t) >= 0 ? R.None : R.NoBond
    case OrderKind.Defy: return overlordOf(ps, a) === t ? R.None : R.NoBond
    case OrderKind.Submit: return atWar(ps, a, t) ? R.None : R.NotAtWar
    case OrderKind.Ally:
      if (allied(ps, a, t)) return R.AlreadyDone
      if (atWar(ps, a, t) || overlordOf(ps, a) === t || overlordOf(ps, t) === a) return R.NoTarget
      return R.None
    case OrderKind.Marry: {
      if (rul === null) return R.SystemOff
      if (tieOf(s, a, t) >= 0) return R.AlreadyDone
      const r = relIdx(ps, a, t)
      if (r < 0 || ps.relEdges[r].length === 0) return R.NoBorder
      if (atWar(ps, a, t)) return R.NoTarget
      const da = a < rul.pcap && rul.cur[a] >= 0 ? rul.rDyn[rul.cur[a]] : -1, db = t < rul.pcap && rul.cur[t] >= 0 ? rul.rDyn[rul.cur[t]] : -1
      if (da < 0 || db < 0 || da === db) return R.NoTarget
      return R.None
    }
    case OrderKind.Designate:
      if (rul === null) return R.SystemOff
      return heirSlot(s, a, t) >= 0 ? R.None : R.NoHeir
    case OrderKind.Placate: return R.None
    case OrderKind.Purge: return rul === null ? R.SystemOff : a < rul.pcap && rul.cur[a] >= 0 && rul.rDyn[rul.cur[a]] >= 0 ? R.None : R.NoActor
    case OrderKind.Borrow: return s.fin === null ? R.SystemOff : R.None
    case OrderKind.Levy: return R.None
    case OrderKind.Betray: {
      const og = ps.og
      if (og === null || !og.oaths) return R.SystemOff
      return allianceBond(ps, a, t) >= 0 && allyWar(ps, a, t) >= 0 ? R.None : R.NoBond
    }
  }
  return R.NoTarget
}

/**
 * A seat kind was given and put in force (ordersBegin): its effects at give. Returns the status it is resolved with now
 * (Fulfilled, Failed), or Active to stay in force; product, acted and the reason are set on ox.
 */
export function seatGive(s: HistoryState, ox: OrdersState, ps: PolityState, k: number): number {
  const kd = ox.kind[k], a = ox.actor[k], t = ox.target[k]
  const cap = ps.pCapital[a]
  switch (kd) {
    case OrderKind.Repudiate: {
      if (t === a) return OrderStatus.Active // (the crown's debts: this year's fiscal step)
      const b = allianceBond(ps, a, t)
      const m = tieOf(s, a, t)
      if (b >= 0) endBond(s, ps, b, BondEnd.Renounced)
      if (m >= 0 && s.rul !== null) { const R = s.rul; R.mEnd[m] = s.year; R.mActive.splice(R.mActive.indexOf(m), 1) }
      const r = ensureRelation(ps, a, t)
      ps.relR[r] = ps.relR[r] + SEAT.renounceR > 2 ? 2 : ps.relR[r] + SEAT.renounceR
      if (b >= 0 && ps.og !== null) recordGrievance(s, ps, ps.og, GrievanceKind.AllyBetrayed, t, a, OATH.wAlly * SEAT.renounceGrief, ps.pCapital[t], -1) // oaths: they remember it
      push(s, EventType.BondRenounced, cap, ps.pCapital[t], t, (b >= 0 ? BondKind.Alliance : 3) + (m >= 0 ? 16 : 0))
      ox.product[k] = b
      ox.acted[k] = s.year
      return OrderStatus.Fulfilled
    }
    case OrderKind.Defy: {
      const b = ps.pSub[a]
      const kind = ps.bKind[b]
      endBond(s, ps, b, BondEnd.Freed)
      const r = ensureRelation(ps, a, t)
      if (ps.relR[r] < RELATION.secedeR) ps.relR[r] = RELATION.secedeR
      push(s, EventType.BondRenounced, cap, ps.pCapital[t], t, kind)
      ox.product[k] = b
      ox.acted[k] = s.year
      return OrderStatus.Fulfilled
    }
    case OrderKind.Designate: {
      const R = s.rul!
      push(s, EventType.HeirNamed, cap, -1, R.cur[a], t)
      return OrderStatus.Active
    }
    case OrderKind.Placate: {
      let spent = 0
      if (s.fin !== null && finRevOrd(s, a) > 0) {
        spent = SEAT.placateR * finRevOrd(s, a)
        if (!finSpend(s, a, spent, 'other')) { ox.reason[k] = OrderReason.Refused; return OrderStatus.Failed }
      } else if (cap >= 0) {
        spent = SEAT.placateCost * s.wealth[cap]
        s.wealth[cap] -= spent
      }
      if (ps.pCrisisUntil[a] > s.year + 1) ps.pCrisisUntil[a] = s.year + 1
      for (const id of s.living) if (id < ps.polity.length && ps.polity[id] === a) ps.unrest[id] *= SEAT.placateUnrest
      push(s, EventType.CourtPlacated, cap, -1, a, spent)
      ox.product[k] = spent
      ox.acted[k] = s.year
      return OrderStatus.Active
    }
    case OrderKind.Purge: {
      const R = s.rul!
      const r = R.cur[a]
      const ab = R.rAbility[r]
      const u = ox.rng.next()
      const first = u < SEAT.purgeFail + SEAT.purgeAble * (ab < 1 ? 1 - ab : 0)
      push(s, EventType.GeneralPurged, cap, -1, a, first ? 1 : 0)
      ox.product[k] = first ? 1 : 0
      ox.acted[k] = s.year
      if (first) { R.kill[a] = ReignEnd.Overthrown; ox.reason[k] = OrderReason.Refused; return OrderStatus.Failed } // (the general struck first: the ruler falls at the next rulers' year)
      return OrderStatus.Active
    }
    case OrderKind.Borrow: {
      const fin = s.fin!
      ox.best[k] = a < fin.pcap ? fin.debt[a] : 0
      return OrderStatus.Active
    }
    case OrderKind.Levy: {
      if (s.fin !== null) { ox.product[k] = -1; ox.acted[k] = s.year; return OrderStatus.Active }
      if (cap < 0) return OrderStatus.Active
      let raised = 0
      for (const id of s.living) {
        if (id >= ps.polity.length || ps.polity[id] !== a || id === cap) continue
        const x = SEAT.levyShare * s.wealth[id]
        s.wealth[id] -= x
        raised += x
        ps.unrest[id] = ps.unrest[id] + SEAT.levyUnrest > 1 ? 1 : ps.unrest[id] + SEAT.levyUnrest
      }
      s.wealth[cap] += raised
      push(s, EventType.LevyRaised, cap, -1, a, raised)
      ox.product[k] = raised
      ox.acted[k] = s.year
      return OrderStatus.Fulfilled
    }
  }
  return OrderStatus.Active
}

/** ordersEnd: whether event x fulfils seat order k (the settlement where it came to pass, or -1). */
export function seatMatch(ox: OrdersState, ps: PolityState | null, k: number, x: { type: number; settlement: number; other: number; value: number }): number {
  if (ps === null) return -1
  const kd = ox.kind[k], a = ox.actor[k], t = ox.target[k]
  const ca = ps.pCapital[a], ct = t >= 0 && t < ps.pCapital.length ? ps.pCapital[t] : -1
  switch (kd) {
    case OrderKind.Repudiate:
      if (t === a && x.type === EventType.Repudiation && x.value === a) { ox.product[k] = -1; return ca }
      return -1
    case OrderKind.Submit:
      if (x.type === EventType.TributeOffered && x.settlement === ca && x.other === ct) { ox.product[k] = x.value; return ca }
      return -1
    case OrderKind.Ally:
      if (x.type === EventType.Alliance && ((x.settlement === ca && x.other === ct) || (x.settlement === ct && x.other === ca))) {
        ox.product[k] = allianceBond(ps, a, t)
        return ca
      }
      return -1
    case OrderKind.Betray:
      if (x.type === EventType.Betrayal && x.settlement === ca && x.other === ct) { ox.product[k] = x.value; return ca }
      return -1
  }
  return -1
}

/** ordersEnd, after the events: a state that fulfils (>= 0, the place) or fails (-2: target gone) seat order k, else -1. */
export function seatState(s: HistoryState, ox: OrdersState, ps: PolityState | null, k: number): number {
  if (ps === null || !livePolity(ps, ox.actor[k])) return -1
  const kd = ox.kind[k], a = ox.actor[k], t = ox.target[k]
  const ca = ps.pCapital[a]
  switch (kd) {
    case OrderKind.Marry: {
      const m = tieOf(s, a, t)
      if (m >= 0) { ox.product[k] = m; return ca }
      return -1
    }
    case OrderKind.Designate: {
      const R = s.rul
      if (R === null || a >= R.pcap) return -1
      const r = R.cur[a]
      if (r >= 0 && R.rBorn[r] === t && R.rAcc[r] >= ox.year[k]) { ox.product[k] = r; return ca }
      return heirSlot(s, a, t) < 0 ? -2 : -1
    }
    case OrderKind.Borrow: {
      const fin = s.fin
      if (fin !== null && a < fin.pcap && fin.debt[a] > ox.best[k] + 1e-9) { if (ox.acted[k] < 0) ox.acted[k] = s.year; return ca }
      return -1
    }
  }
  return -1
}

