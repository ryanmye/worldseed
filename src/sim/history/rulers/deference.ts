// rulers: deference, a polity-level quantity: how far a realm has grown used to being ruled without its ruler. Fed by causes
// (DeferenceCause): today only the player in seat mode (a matter left to the court: Player); a follow-up lane adds the AI's
// absentee and do-nothing rulers (Minor, Absent, Union, Indolent, Infirm, Captive) through the same addDeference. Every effect
// keys on the polity's value whatever its cause, and is a no-op at 0: until something feeds it the state is null (s.defer),
// nothing reads a value, History.deference is absent, and the history is the one without it (G0 holds).
//
// API (HistoryState s, polity p):
//   addDeference(s, p, amount, cause)   feed it (creates the state); may tip the realm into decline (SeatDeclined)
//   deferenceTaken(s, p)                a decision the ruler took himself: x SEAT.deferTaken, one more in a row (may reassert)
//   deferenceRelease(s, p, keep)        absentee: the ruler rules in person again (x keep, out of decline); true if it was in decline
//   reclaimPower(s, p)                  the ruler takes the power back at once: 0, out of decline (SeatReasserted extra 1);
//                                       the throne is less safe for SEAT.reclaimYears (the C3 factor below)
//   deferenceYear(s)                    yearly, first thing: x SEAT.deferKeep
//   deferenceOf(s, p)                   the value (0 none); deferenceK(s, p) = min(1, value / SEAT.deferFull)
//   figureheadOf(s, p)                  true while the deciding body rules in all but name (value reached SEAT.deferDecline)
//   seatDeferencePressure(s, p)         the pressure 0..1 later plans read: court-politics (faction and estates strength,
//                                       privileges, regime drift toward the deciding body, a mayor of the palace), riots
//                                       (legitimacy), modern-ideologies (constitutional drift). Today = deferenceK. Also
//                                       exported as deferencePressure (the plan's name).
//   deferOverthrowMul(s, p)             C3 order-slot factor (1 + deferOverthrow k) x (reclaimRisk while a reclaim's risk holds), undefined at 1
//   deferContestMul(s, p)               the contest chance's factor 1 + deferContest k (1 at 0)
//   deferUnrest(s, p)                   the Provincial grievance term deferUnrest k - the blame shield (UnrestPart.Deference; 0 at 0)
//   deferBlame(s, p, amount, kind)      a divisive matter (amount 0..1) the deciding body decided: it bears the blame (DeferBlamed):
//                                       the ruler is shielded (the grievance term above falls by blameShield * amount, fading
//                                       x blameKeep a year) and the court spends credit (deference x (1 - blameSpend * amount)).
//                                       The hook for court-politics (the faction or minister responsible loses favour, may be
//                                       dismissed as a scapegoat) and riots (anger aimed at ministers rather than the crown).
//   assembleDeference(s)                History.deference (absent when null)
// Draws nothing. Every constant is a design default (seat/params.ts SEAT.defer*).
import { EventType } from '../../../contract.ts'
import type { DeferenceHistory } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { SEAT } from '../seat/params.ts'

/** What fed a realm's deference (History.deference.fed per cause). Reserved values for the follow-up lane's AI causes. */
export const DeferenceCause = { Player: 0, Minor: 1, Absent: 2, Union: 3, Indolent: 4, Infirm: 5, Captive: 6 } as const
export type DeferenceCause = (typeof DeferenceCause)[keyof typeof DeferenceCause]
export const DEFERENCE_CAUSE_COUNT = 7

export interface DeferenceState {
  /** Per polity (grown on demand): the value, 1 while in decline, decisions taken in a row, a reclaim's risk until (-1). */
  value: Float64Array
  figurehead: Uint8Array
  run: Int32Array
  reclaimUntil: Int32Array
  /** Per polity x cause: the total fed. */
  fed: Float64Array
  /** Per polity: the blame shield (the deciding body bore the blame for divisive matters). */
  blame: Float64Array
  /** Polities with a value > 0 or a reclaim in force (the yearly pass). */
  live: Set<number>
}

function ensure(s: HistoryState, p: number): DeferenceState {
  let d = s.defer
  if (d === null) d = s.defer = { value: new Float64Array(0), figurehead: new Uint8Array(0), run: new Int32Array(0), reclaimUntil: new Int32Array(0), fed: new Float64Array(0), blame: new Float64Array(0), live: new Set() }
  if (p >= d.value.length) {
    const n = Math.max(p + 1, d.value.length * 2, 16)
    const g = <T extends Float64Array | Uint8Array | Int32Array>(a: T, m: number, fill: number): T => { const b = new (a.constructor as new (k: number) => T)(m); b.set(a); if (fill !== 0) b.fill(fill, a.length); return b }
    d.value = g(d.value, n, 0); d.figurehead = g(d.figurehead, n, 0); d.run = g(d.run, n, 0); d.reclaimUntil = g(d.reclaimUntil, n, -1)
    d.fed = g(d.fed, n * DEFERENCE_CAUSE_COUNT, 0)
    d.blame = g(d.blame, n, 0)
  }
  return d
}

function push(s: HistoryState, type: number, p: number, extra: number): void {
  const cap = s.pol !== null && p >= 0 && p < s.pol.pCapital.length ? s.pol.pCapital[p] : -1
  s.events.push({ year: s.year, type: type as EventType, settlement: cap, other: -1, value: p, extra })
}

export function deferenceOf(s: HistoryState, p: number): number {
  const d = s.defer
  return d === null || p < 0 || p >= d.value.length ? 0 : d.value[p]
}
export function deferenceK(s: HistoryState, p: number): number {
  const v = deferenceOf(s, p)
  return v > 0 ? (v < SEAT.deferFull ? v / SEAT.deferFull : 1) : 0
}
export function figureheadOf(s: HistoryState, p: number): boolean {
  const d = s.defer
  return d !== null && p >= 0 && p < d.figurehead.length && d.figurehead[p] === 1
}
export const seatDeferencePressure = deferenceK
/** The same pressure under its plan name (absentee-rulers: court-politics reads it for the deciding body's strength). */
export const deferencePressure = deferenceK

export function addDeference(s: HistoryState, p: number, amount: number, cause: DeferenceCause): void {
  if (p < 0 || !(amount > 0)) return
  const d = ensure(s, p)
  d.value[p] += amount
  d.fed[p * DEFERENCE_CAUSE_COUNT + cause] += amount
  d.run[p] = 0
  d.live.add(p)
  if (!d.figurehead[p] && d.value[p] >= SEAT.deferDecline) {
    d.figurehead[p] = 1
    // (the player's realm: SeatDeclined; an AI cause's decline is told by its feeder, rulers/absentee.ts CouncilRuled)
    if (cause === DeferenceCause.Player) push(s, EventType.SeatDeclined, p, Math.round(d.value[p] * 100))
  }
}

/**
 * absentee: the ruler rules again in person (an AI reign ended, a regent handed over, the ruler came home): deference x keep,
 * out of decline. Returns whether the realm was in decline (the caller tells it: RuledInPerson). No-op without the state.
 */
export function deferenceRelease(s: HistoryState, p: number, keep: number): boolean {
  const d = s.defer
  if (d === null || p < 0 || p >= d.value.length) return false
  d.value[p] *= keep
  if (d.value[p] < 1e-3) d.value[p] = 0
  d.run[p] = 0
  const was = d.figurehead[p] === 1
  d.figurehead[p] = 0
  return was
}

export function deferenceTaken(s: HistoryState, p: number): void {
  const d = s.defer
  if (d === null || p < 0 || p >= d.value.length) return
  d.value[p] *= SEAT.deferTaken
  d.run[p]++
  if (d.figurehead[p] && d.run[p] >= SEAT.reassertRun) {
    d.figurehead[p] = 0
    if (d.value[p] > SEAT.deferDecline / 2) d.value[p] = SEAT.deferDecline / 2
    push(s, EventType.SeatReasserted, p, 0)
  }
}

export function reclaimPower(s: HistoryState, p: number): void {
  if (p < 0) return
  const d = ensure(s, p)
  d.value[p] = 0
  d.run[p] = 0
  d.reclaimUntil[p] = s.year + SEAT.reclaimYears
  d.live.add(p)
  if (d.figurehead[p]) { d.figurehead[p] = 0; push(s, EventType.SeatReasserted, p, 1) }
}

export function deferenceYear(s: HistoryState): void {
  const d = s.defer
  if (d === null) return
  for (const p of [...d.live]) {
    d.value[p] *= SEAT.deferKeep
    if (d.value[p] < 1e-3 && !d.figurehead[p]) d.value[p] = 0
    d.blame[p] *= SEAT.blameKeep
    if (d.blame[p] < 1e-4) d.blame[p] = 0
    if (d.value[p] === 0 && d.blame[p] === 0 && d.reclaimUntil[p] < s.year) d.live.delete(p)
  }
}

export function deferOverthrowMul(s: HistoryState, p: number): number | undefined {
  const d = s.defer
  if (d === null || p < 0 || p >= d.value.length) return undefined
  const k = deferenceK(s, p)
  let m = k > 0 ? 1 + SEAT.deferOverthrow * k : 1
  if (d.reclaimUntil[p] >= s.year) m *= SEAT.reclaimRisk
  return m !== 1 ? m : undefined
}
export function deferContestMul(s: HistoryState, p: number): number {
  const k = deferenceK(s, p)
  return k > 0 ? 1 + SEAT.deferContest * k : 1
}
export function deferUnrest(s: HistoryState, p: number): number {
  const d = s.defer
  if (d === null || p < 0 || p >= d.value.length) return 0
  const k = deferenceK(s, p)
  return (k > 0 ? SEAT.deferUnrest * k : 0) - d.blame[p]
}

export function deferBlame(s: HistoryState, p: number, amount: number, kind: number): void {
  if (p < 0 || !(amount > 0)) return
  const d = ensure(s, p)
  d.blame[p] += SEAT.blameShield * amount
  d.value[p] *= 1 - SEAT.blameSpend * amount
  d.live.add(p)
  push(s, EventType.DeferBlamed, p, kind)
}

export function assembleDeference(s: HistoryState): DeferenceHistory | undefined {
  const d = s.defer
  if (d === null) return undefined
  const P = d.value.length
  return { value: Float32Array.from(d.value), figurehead: Uint8Array.from(d.figurehead), fed: Float32Array.from(d.fed), causes: DEFERENCE_CAUSE_COUNT, count: P }
}
