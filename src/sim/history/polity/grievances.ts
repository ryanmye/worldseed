// grudges and oaths: grievances between polities (grudges-and-oaths.md §3.5; HistoryOptions.oaths).
//
// A wrong done by polity q to polity p is a row (GrievanceKind, weight w0) that fades: every POLITY.slowStep years
//   w *= OATH.keep = 0.5^(slowStep / halfLife)          (a literal: no pow in the sim)
// and is put aside below OATH.forget. The grudge of p against q is G(p, q) = sum of w over p's open rows against q, and
//   g(p, q) = G / (G + OATH.half)  in [0, 1).
// Wrongs are recorded where they happen, RNG-free (recording alone draws nothing): towns taken (one row per war and wronged,
// merged), sacks and capitals (war.ts conquer / capitalFalls), bonds thrown off (bonds.ts endBond), holy cities (a scan of
// HolyCityFell at the slow step), broken truces and betrayals (oaths.ts). A town or holy city or capital back in the hands of
// the wronged ends its row (avenged), and so does a won revenge war (its rows * OATH.avenged).
// Effects: rivalry dR += OATH.rivalry * (g(a, b) + g(b, a)) + OATH.repRivalry * (f_a / (f_a + 1) + f_b / (f_b + 1)) per year
// (relations.ts), and the declaration factor 1 + OATH.drive * g(p, q) (C1, compose.ts; war.ts).
// Inheritance: a successor state takes up its parent's open rows at OATH.inherit of their weight (heir = the row); a realm
// that absorbs or reunifies another takes up its quarrels in full, and the wrongs between the two end (cause 4); rows held
// by a realm that ended without heirs, or against one that ended, end (cause 2; 3 when an heir took them up).
// The faithless score f of a polity (oaths.ts) decays by OATH.repKeep each slow step here.

import { EventType, GrievanceKind, PolityEnd } from '../../../contract.ts'
import type { EventType as EventTypeT, Grievances } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { OATH } from './params.ts'
import type { PolityState } from './state.ts'
import type { GrudgeState } from './grudgeState.ts'
import { at, dkey, put } from './grudgeState.ts'

/** Row end causes (Grievances.endCause). */
export const GrievanceEnd = { Faded: 0, Avenged: 1, Ended: 2, Inherited: 3, United: 4 } as const

function logX(s: HistoryState, type: EventTypeT, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

/** g(p, q): p's grudge against q in [0, 1) (0 when oaths is off or there is none). */
export function grudge(og: GrudgeState, p: number, q: number): number {
  const G = og.gSum.get(dkey(p, q))
  return G === undefined ? 0 : G / (G + OATH.half)
}

/** The open row of most weight that p holds against q, or -1. */
export function strongestGrievance(og: GrudgeState, p: number, q: number): number {
  const r = og.gBest.get(dkey(p, q))
  return r === undefined ? -1 : r
}

/** The faithless score of p. */
export function faithOf(og: GrudgeState, p: number): number {
  return at(og.faith, p, 0)
}

function addSum(og: GrudgeState, row: number, dw: number): void {
  const k = dkey(og.gWronged[row], og.gOffender[row])
  og.gSum.set(k, (og.gSum.get(k) ?? 0) + dw)
  const b = og.gBest.get(k)
  if (b === undefined || og.gW[row] > og.gW[b]) og.gBest.set(k, row)
}

function newRow(s: HistoryState, og: GrudgeState, kind: number, p: number, q: number, w: number, site: number, war: number, towns: number, heir: number): number {
  const i = og.gKind.length
  og.gKind.push(kind); og.gWronged.push(p); og.gOffender.push(q); og.gYear.push(s.year)
  og.gW0.push(w); og.gW.push(w); og.gEnd.push(-1); og.gEndCause.push(0)
  og.gSite.push(site); og.gWar.push(war); og.gTowns.push(towns); og.gHeir.push(heir)
  og.gActive.push(i) // (rows are made in id order, so the list stays ascending)
  addSum(og, i, w)
  return i
}

/** Records a wrong done by q to p (RNG-free). TownConquered rows of one war and pair merge. Returns the row, or -1. */
export function recordGrievance(s: HistoryState, ps: PolityState, og: GrudgeState, kind: number, p: number, q: number, w: number, site: number, war: number): number {
  if (!og.oaths || p < 0 || q < 0 || p === q || ps.pEnded[p] >= 0 || ps.pEnded[q] >= 0) return -1
  if (kind === GrievanceKind.TownConquered && war >= 0) {
    const act = og.gActive
    for (let k = act.length - 1; k >= 0; k--) {
      const i = act[k]
      if (og.gWar[i] !== war || og.gKind[i] !== kind || og.gWronged[i] !== p || og.gOffender[i] !== q) continue
      og.gTowns[i]++
      const w1 = og.gW[i] + w > OATH.capTown ? OATH.capTown : og.gW[i] + w
      const w0 = og.gW0[i] + w > OATH.capTown ? OATH.capTown : og.gW0[i] + w
      const dw = w1 - og.gW[i]
      og.gW[i] = w1; og.gW0[i] = w0
      if (dw > 0) addSum(og, i, dw)
      return i
    }
  }
  og.diag.grievances++
  return newRow(s, og, kind, p, q, w, site, war, kind === GrievanceKind.TownConquered ? 1 : 0, -1)
}

/** war.ts conquer hook: p took v from q in war w (wasCap: q's capital; sacked: and sacked it). */
export function grievConquered(s: HistoryState, ps: PolityState, og: GrudgeState, w: number, p: number, q: number, v: number, wasCap: boolean, sacked: boolean): void {
  if (!og.oaths) return
  recordGrievance(s, ps, og, GrievanceKind.TownConquered, q, p, OATH.wTown, v, w)
  if (sacked) recordGrievance(s, ps, og, GrievanceKind.TownSacked, q, p, OATH.wSack, v, w)
  if (wasCap) recordGrievance(s, ps, og, GrievanceKind.CapitalTaken, q, p, OATH.wCapital, v, w)
}

function endRow(og: GrudgeState, i: number, year: number, cause: number): void {
  og.gEnd[i] = year
  og.gEndCause[i] = cause
}

/** Recomputes gSum / gBest from the open rows (ascending), dropping the closed ones from gActive. */
function rebuild(og: GrudgeState): void {
  og.gSum.clear(); og.gBest.clear()
  const act = og.gActive
  let n = 0
  for (let k = 0; k < act.length; k++) {
    const i = act[k]
    if (og.gEnd[i] >= 0) continue
    act[n++] = i
    addSum(og, i, og.gW[i])
  }
  act.length = n
}

/**
 * System part (every slow step, right after rivalry): holy cities fallen since the last look, decay, avenging and forgetting,
 * rows of ended realms, the faithless score's decay.
 */
export function grievanceStep(s: HistoryState, ps: PolityState, og: GrudgeState): void {
  if (!og.oaths) return
  // Holy cities that fell (religion logs HolyCityFell in its own system; caught here at the next slow step).
  const ev = s.events
  for (let k = og.gEvSeen; k < ev.length; k++) {
    const e = ev[k]
    if (e.type !== EventType.HolyCityFell) continue
    const w = e.extra ?? -1
    if (w < 0 || w >= ps.wAtt.length) continue
    const a = ps.wAtt[w], d = ps.wDef[w]
    const holder = e.other >= 0 && e.other < ps.seen ? ps.polity[e.other] : -1
    const off = holder === a || holder === d ? holder : ps.polity[e.settlement] === a ? a : d
    recordGrievance(s, ps, og, GrievanceKind.HolyCityTaken, off === a ? d : a, off, OATH.wHoly, e.settlement, w)
  }
  og.gEvSeen = ev.length
  const act = og.gActive
  for (let k = 0; k < act.length; k++) {
    const i = act[k]
    if (og.gEnd[i] >= 0) continue
    const p = og.gWronged[i], q = og.gOffender[i]
    if (ps.pEnded[q] >= 0) { endRow(og, i, s.year, GrievanceEnd.Ended); continue }
    if (ps.pEnded[p] >= 0) { endRow(og, i, s.year, at(og.gPassed, i, 0) ? GrievanceEnd.Inherited : GrievanceEnd.Ended); continue }
    const kind = og.gKind[i], v = og.gSite[i]
    if ((kind === GrievanceKind.TownConquered || kind === GrievanceKind.CapitalTaken || kind === GrievanceKind.HolyCityTaken) && v >= 0 && v < ps.seen && s.abandoned[v] < 0 && ps.polity[v] === p) {
      endRow(og, i, s.year, GrievanceEnd.Avenged)
      og.diag.avenged++
      if (kind !== GrievanceKind.TownConquered) logX(s, EventType.Avenged, ps.pCapital[p], ps.pCapital[q], i, kind)
      continue
    }
    const x = og.gW[i] * OATH.keep
    og.gW[i] = x
    if (x < OATH.forget) endRow(og, i, s.year, GrievanceEnd.Faded)
  }
  rebuild(og)
  for (let p = 0; p < og.faith.length; p++) { const f = og.faith[p] * OATH.repKeep; og.faith[p] = f < 1e-4 ? 0 : f }
}

/** newPolity hook: successor q of `parent` takes up its parent's open grievances at OATH.inherit of their weight. */
export function grudgeNewPolity(s: HistoryState, ps: PolityState, og: GrudgeState, q: number, parent: number): void {
  if (!og.oaths) return
  const act = og.gActive
  const n = act.length
  for (let k = 0; k < n; k++) {
    const i = act[k]
    if (og.gEnd[i] >= 0 || og.gWronged[i] !== parent) continue
    const o = og.gOffender[i]
    if (o === q || ps.pEnded[o] >= 0) continue
    const w = OATH.inherit * og.gW[i]
    if (w < OATH.forget) continue
    newRow(s, og, og.gKind[i], q, o, w, og.gSite[i], og.gWar[i], og.gTowns[i], i)
    put(og.gPassed, i, 1, 0)
    og.diag.inherited++
  }
}

/**
 * endPolity hook: p ended (cause, `by` the settlement it ended by). Absorbed or reunified: its quarrels pass to the absorber
 * in full (the wrongs between the two end, cause 4). Otherwise the wrongs done by p end at the next slow step, and the wrongs
 * done to it pass to any heir made now (successors) or end then.
 */
export function grudgeEnded(s: HistoryState, ps: PolityState, og: GrudgeState, p: number, cause: number, by: number): void {
  if (!og.oaths) return
  if (cause !== PolityEnd.Absorbed && cause !== PolityEnd.Reunified) return
  const x = by >= 0 && by < ps.seen ? ps.polity[by] : -1
  if (x < 0 || x === p || ps.pEnded[x] >= 0) return
  const act = og.gActive
  let moved = false
  for (let k = 0; k < act.length; k++) {
    const i = act[k]
    if (og.gEnd[i] >= 0) continue
    const a = og.gWronged[i], b = og.gOffender[i]
    if (a !== p && b !== p) continue
    const na = a === p ? x : a, nb = b === p ? x : b
    if (na === nb) { endRow(og, i, s.year, GrievanceEnd.United); moved = true; continue }
    og.gWronged[i] = na; og.gOffender[i] = nb
    moved = true
  }
  if (moved) rebuild(og)
}

/** Avenging by war (war.ts closeWar hook): a revenge war (cause >= 0) won by its attacker p repays p's wrongs from q. */
export function grudgeWarEnded(s: HistoryState, ps: PolityState, og: GrudgeState, w: number, attackerWon: boolean): void {
  if (!og.oaths || !attackerWon || at(og.wCause, w, -1) < 0) return
  const p = ps.wAtt[w], q = ps.wDef[w]
  const act = og.gActive
  let any = false
  for (let k = 0; k < act.length; k++) {
    const i = act[k]
    if (og.gEnd[i] >= 0 || og.gWronged[i] !== p || og.gOffender[i] !== q) continue
    og.gW[i] *= OATH.avenged
    any = true
    const kind = og.gKind[i]
    if (og.gW[i] < OATH.forget) {
      endRow(og, i, s.year, GrievanceEnd.Avenged)
      og.diag.avenged++
      if (kind === GrievanceKind.TruceBroken || kind === GrievanceKind.AllyBetrayed || kind === GrievanceKind.HolyCityTaken || kind === GrievanceKind.CapitalTaken) logX(s, EventType.Avenged, ps.pCapital[p], ps.pCapital[q], i, kind)
    }
  }
  if (any) rebuild(og)
}

/** Rivalry hook (relationStep, per pair a < b, a year): grudges both ways (RivalryPart.Grudge). */
export function grudgeRivalry(og: GrudgeState, a: number, b: number): number {
  return OATH.rivalry * (grudge(og, a, b) + grudge(og, b, a))
}

/** Rivalry hook: each side's name for faithlessness (RivalryPart.Reputation). */
export function repRivalry(og: GrudgeState, a: number, b: number): number {
  const fa = at(og.faith, a, 0), fb = at(og.faith, b, 0)
  return OATH.repRivalry * (fa / (fa + 1) + fb / (fb + 1))
}

/** History.grievances. */
export function assembleGrievances(og: GrudgeState | null): Grievances {
  const n = og === null ? 0 : og.gKind.length
  const g: Grievances = {
    count: n, kind: new Uint8Array(n), wronged: new Int16Array(n), offender: new Int16Array(n), year: new Int16Array(n),
    weight: new Float32Array(n), endYear: new Int16Array(n), endCause: new Uint8Array(n), settlement: new Int32Array(n), war: new Int32Array(n),
    towns: new Uint16Array(n), heir: new Int32Array(n), halfLife: OATH.halfLife,
  }
  if (og === null) return g
  for (let i = 0; i < n; i++) {
    g.kind[i] = og.gKind[i]; g.wronged[i] = og.gWronged[i]; g.offender[i] = og.gOffender[i]; g.year[i] = og.gYear[i]
    g.weight[i] = og.gW0[i]; g.endYear[i] = og.gEnd[i]; g.endCause[i] = og.gEndCause[i]; g.settlement[i] = og.gSite[i]; g.war[i] = og.gWar[i]
    g.towns[i] = og.gTowns[i] > 65535 ? 65535 : og.gTowns[i]; g.heir[i] = og.gHeir[i]
  }
  return g
}
