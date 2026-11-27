// rulers: absentee and do-nothing rulers of the AI realms (absentee-rulers.md; HistoryOptions.absentee). Rulers who let the
// court decide outside throne mode feed the same polity-level deference as the player's "let the court decide"
// (rulers/deference.ts: addDeference, deferBlame), so every effect is the shared one (C3 overthrow and contest up, the
// Provincial grievance term, the deciding body's strength through deferencePressure, decline past SEAT.deferDecline).
//
// Causes, read from existing state each year (no draws; the rulers stream stays aligned), per year while they hold:
//   Minor     the ruler is under RULERS.majority: the regent's council accrues power (Merovingian, Henry VI)
//   Union     a junior realm of a personal union (rulers: R.union): a viceroy or council rules it (Aragon, Kalmar)
//   Absent    the ruler leads his army in person in a war far from his capital (battles: the war side's commander is the
//             reign's own row; without battles the expected chance he leads, BATTLE.rulerLead[tier] (0.5 + warlike)),
//             x farness 1 - grip(distance to the enemy, the realm's reach)
//   Captive   taken in a ruler-led battle lost in a rout (battles; hash01, never a stream draw): captive for 1-4 years
//   Indolent  little engagement from existing traits: low ability and little warlike (no new trait drawn)
//   Infirm    old age: from ABSENTEE.infirmFrom on, growing with the years
// The realm declines (figurehead) when deference passes SEAT.deferDecline: CouncilRuled names the cause that weighed most in
// the reign. The episode ends with the reign (deference x keepReign, the court's habits outlive the ruler), the regent's
// handover at majority, the ruler's return, or the union's end (RuledInPerson); a few end in a coup (the shared C3 factor).
// Blame shield (the plan's addendum): a court that governs (deference weight >= blameK) bears the blame for a lost war or a
// crown default: deferBlame(s, p, divisive, kind) shields the ruler's grievance and spends the court's credit.
// The player's seat realm is the player's: no AI cause feeds it.
import { CommanderFate, EventType, BattleFlag } from '../../../contract.ts'
import type { EventType as EventTypeT } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { FAR, grip, tierOf } from '../polity/state.ts'
import { distAcross } from '../polity/bonds.ts'
import type { RulerState } from './state.ts'
import { RULERS } from './params.ts'
import { BATTLE } from '../battles/params.ts'
import { DEFERENCE_CAUSE_COUNT, DeferenceCause, addDeference, deferBlame, deferenceK, deferenceRelease, figureheadOf } from './deference.ts'
import { hash01, seedToU32 } from '../../rng.ts'

/**
 * Design defaults [A], tuned on seeds 1 7 42 1234 (absenteeStats.ts): a minority of reigns (target 10-25%) see significant
 * deference while the direct overthrow hazard stays within +15% (the realism guard). Idleness is fed lightly: idle rulers are
 * the ones exposed to overthrow (low ability), so each unit of it costs the most hazard.
 */
export const ABSENTEE = {
  /** Deference fed per year (deference fades x SEAT.deferKeep = 0.98 a year: a steady feed f settles near 50 f). */
  minor: 0.3,
  union: 0.15,
  absent: 0.4,
  captive: 0.8,
  indolent: 0.05,
  /** Indolence = clamp01((idleAbility - ability) / idleAbilitySpan) x clamp01((idleWar - warlike) / idleWarSpan). */
  idleAbility: 1.0,
  idleAbilitySpan: 0.3,
  idleWar: 0.5,
  idleWarSpan: 0.35,
  /** Infirmity: infirm x (age - infirmFrom), at most infirmMax a year. */
  infirm: 0.025,
  infirmFrom: 62,
  infirmMax: 0.35,
  /** Taken captive: a ruler beaten in a rout (BattleFlag.Pursuit) with chance captiveChance, for 1..captiveYears years. */
  captiveChance: 0.35,
  captiveYears: 4,
  /** Deference kept when the reign ends (the court's habits outlive the ruler) and at a regent's handover or a return. */
  keepReign: 0.5,
  keepHandover: 0.5,
  keepReturn: 0.6,
  /** The blame shield: a court weighing at least blameK bears a lost war (divisive blameWar) or a default (blameDefault). */
  blameK: 0.4,
  blameWar: 0.8,
  blameDefault: 0.7,
} as const

/** DeferBlamed extra of an AI court's blame (above every DecisionKind): a lost war, a crown default. */
export const BLAME_LOST_WAR = 100
export const BLAME_DEFAULT = 101

const C = DEFERENCE_CAUSE_COUNT
const CAUSES = [DeferenceCause.Minor, DeferenceCause.Absent, DeferenceCause.Union, DeferenceCause.Indolent, DeferenceCause.Infirm, DeferenceCause.Captive] as const

export interface AbsenteeDiag {
  /** Deference fed per DeferenceCause (index), the declines (CouncilRuled) by their cause, and how they ended (RuledInPerson extra). */
  fed: number[]
  declines: number[]
  ended: number[]
  captives: number
  blamed: number
}

export interface AbsenteeState {
  seed: number
  /** Per polity (grown on demand): the reign last seen (-1), in a union last year, captive until (inclusive, -1), the
   * decline's cause (-1 none) and the deference fed this reign per cause. */
  cap: number
  reign: Int32Array
  union: Uint8Array
  captiveUntil: Int32Array
  cause: Int8Array
  acc: Float64Array
  batSeen: number
  evSeen: number
  diag: AbsenteeDiag
}

export function createAbsentee(seed: number): AbsenteeState {
  return {
    seed: seedToU32(seed), cap: 0, reign: new Int32Array(0), union: new Uint8Array(0), captiveUntil: new Int32Array(0), cause: new Int8Array(0), acc: new Float64Array(0),
    batSeen: 0, evSeen: 0,
    diag: { fed: new Array(C).fill(0), declines: new Array(C).fill(0), ended: [0, 0, 0, 0], captives: 0, blamed: 0 },
  }
}

function ensure(A: AbsenteeState, need: number): void {
  if (need <= A.cap) return
  const n = Math.max(need, A.cap * 2, 64)
  const i32 = (a: Int32Array, fill: number): Int32Array => { const b = new Int32Array(n).fill(fill); b.set(a); return b }
  A.reign = i32(A.reign, -1)
  A.captiveUntil = i32(A.captiveUntil, -1)
  const u = new Uint8Array(n); u.set(A.union); A.union = u
  const c = new Int8Array(n).fill(-1); c.set(A.cause); A.cause = c
  const f = new Float64Array(n * C); f.set(A.acc); A.acc = f
  A.cap = n
}

function log(s: HistoryState, type: EventTypeT, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x)

/** Indolence of reign r (0..1) from its traits. */
export function indolence(R: RulerState, r: number): number {
  const X = ABSENTEE
  return clamp01((X.idleAbility - R.rAbility[r]) / X.idleAbilitySpan) * clamp01((X.idleWar - R.rWar[r]) / X.idleWarSpan)
}

/** How far from home p's ruler campaigns in person this year (0..1): the largest lead x farness over p's wars. */
function absence(s: HistoryState, ps: PolityState, R: RulerState, p: number, r: number): number {
  if (ps.pWars[p] <= 0) return 0
  const bs = s.bat
  let best = 0
  let proxy = -1
  for (const w of ps.activeWars) {
    const side = ps.wAtt[w] === p ? 0 : ps.wDef[w] === p ? 1 : -1
    if (side < 0) continue
    let lead: number
    if (bs !== null) {
      const c = 2 * w + side < bs.wCmd.length ? bs.wCmd[2 * w + side] : -1
      lead = c >= 0 && bs.cReign[c] === r && bs.cFate[c] === CommanderFate.Serving ? 1 : 0
    } else {
      // (without battles: the expected chance he leads in person, the commanders' rule)
      if (proxy < 0) proxy = clamp01(BATTLE.rulerLead[tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop)] * (0.5 + R.rWar[r]))
      lead = proxy
    }
    if (lead <= best) continue
    const q = side === 0 ? ps.wDef[w] : ps.wAtt[w]
    const d = distAcross(s, ps, p, q)
    const far = d < FAR ? 1 - grip(d, ps.pReach[p] > 0 ? ps.pReach[p] : 1) : 1
    if (lead * far > best) best = lead * far
  }
  return best
}

/** Rulers beaten in a rout in this year's battles may be taken captive (hash01 on the battle id: no stream moves). */
function battleCaptives(s: HistoryState, ps: PolityState, R: RulerState, A: AbsenteeState): void {
  const bs = s.bat
  if (bs === null) return
  const X = ABSENTEE
  for (let b = A.batSeen; b < bs.bYear.length; b++) {
    const fl = bs.bFlags[b]
    if ((fl & BattleFlag.RulerLed) === 0 || (fl & BattleFlag.Pursuit) === 0) continue
    const c = bs.bWinner[b] === 0 ? bs.bCmdD[b] : bs.bCmdA[b] // (the beaten side's commander)
    const r = bs.cReign[c]
    if (r < 0) continue
    const p = bs.cPolity[c]
    if (p < 0 || p >= R.pcap || R.cur[p] !== r || ps.pEnded[p] >= 0) continue
    ensure(A, p + 1)
    if (A.captiveUntil[p] >= s.year) continue
    if (hash01(A.seed ^ 0x5ab5e17, b) >= X.captiveChance) continue
    const years = 1 + Math.floor(hash01(A.seed ^ 0x7c0ffee, b) * X.captiveYears)
    A.captiveUntil[p] = s.year + years - 1
    A.diag.captives++
    log(s, EventType.RulerTaken, bs.bTarget[b], ps.pCapital[p], r, years)
  }
  A.batSeen = bs.bYear.length
}

/** p's ruler rules in person again: deference x keep; a decline ends (RuledInPerson, how). */
function release(s: HistoryState, ps: PolityState, A: AbsenteeState, p: number, keep: number, how: number): void {
  if (s.defer === null) return
  const was = deferenceRelease(s, p, keep)
  if (was && A.cause[p] >= 0) {
    log(s, EventType.RuledInPerson, ps.pCapital[p], A.reign[p], p, how)
    A.diag.ended[how]++
  }
  A.cause[p] = -1
}

/** System (yearly, after politySystem): the year's absentee causes feed deference; declines begin and end; the court bears blame. */
export function absenteeYear(s: HistoryState, ps: PolityState, R: RulerState, A: AbsenteeState, seatPolity: number): void {
  ensure(A, ps.P)
  const X = ABSENTEE
  const year = s.year
  battleCaptives(s, ps, R, A)
  // Defaults this year (finance): the court that governs bears the blame.
  const ev = s.events
  const defaults: number[] = []
  for (let k = A.evSeen; k < ev.length; k++) if (ev[k].type === EventType.CrownDefault) defaults.push(ev[k].value)
  A.evSeen = ev.length
  for (const p of ps.alive) {
    if (ps.pEnded[p] >= 0 || p >= R.pcap) continue
    const r = R.cur[p]
    if (r < 0) continue
    const o = p * C
    if (A.reign[p] !== r) {
      // A new reign: the court's habits outlive the ruler (deference x keepReign), the decline ends with him.
      if (A.reign[p] >= 0 && s.defer !== null) release(s, ps, A, p, X.keepReign, 0)
      A.reign[p] = r
      A.cause[p] = -1
      for (let k = 0; k < C; k++) A.acc[o + k] = 0
    }
    if (p === seatPolity) { A.union[p] = R.union[p] >= 0 ? 1 : 0; continue } // (the player's realm: the player decides)
    if (R.rDyn[r] < 0) { A.union[p] = 0; continue } // (an elected league head rules his term)
    const age = year - R.rBorn[r]
    const inUnion = R.union[p] >= 0
    // Handovers: the ruler came of age, the union ended, the ruler came home from captivity.
    if (age === RULERS.majority && year > R.rAcc[r]) release(s, ps, A, p, X.keepHandover, 1)
    if (A.union[p] === 1 && !inUnion) release(s, ps, A, p, X.keepReturn, 3)
    if (A.captiveUntil[p] === year - 1) release(s, ps, A, p, X.keepReturn, 2)
    A.union[p] = inUnion ? 1 : 0
    // The year's causes.
    const minor = age < RULERS.majority ? X.minor : 0
    const union = inUnion ? X.union : 0
    const away = absence(s, ps, R, p, r)
    const absent = away > 0 ? X.absent * away : 0
    const captive = A.captiveUntil[p] >= year ? X.captive : 0
    const idle = indolence(R, r)
    const indolent = idle > 0 ? X.indolent * idle : 0
    const infirm = age > X.infirmFrom ? Math.min(X.infirmMax, X.infirm * (age - X.infirmFrom)) : 0
    // A campaign's absence over (he came home): the decline it caused ends.
    if (A.cause[p] === DeferenceCause.Absent && absent === 0 && figureheadOf(s, p)) release(s, ps, A, p, X.keepReturn, 2)
    const amt = [0, minor, absent, union, indolent, infirm, captive]
    for (const c of CAUSES) {
      const a = amt[c]
      if (a <= 0) continue
      addDeference(s, p, a, c)
      A.acc[o + c] += a
      A.diag.fed[c] += a
    }
    if (A.cause[p] < 0 && figureheadOf(s, p)) {
      let best: number = DeferenceCause.Minor
      for (const c of CAUSES) if (A.acc[o + c] > A.acc[o + best]) best = c
      if (A.acc[o + best] > 0) {
        A.cause[p] = best
        A.diag.declines[best]++
        log(s, EventType.CouncilRuled, ps.pCapital[p], r, p, best)
      }
    }
    // The blame shield: a court that governs bears a lost war (rulers: R.lost this year) or a crown default.
    if (s.defer !== null && deferenceK(s, p) >= X.blameK) {
      if (R.lost[p] === year) { deferBlame(s, p, X.blameWar, BLAME_LOST_WAR); A.diag.blamed++ }
      if (defaults.length > 0 && defaults.indexOf(p) >= 0) { deferBlame(s, p, X.blameDefault, BLAME_DEFAULT); A.diag.blamed++ }
    }
  }
}
