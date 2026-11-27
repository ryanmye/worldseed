// rulers: pure hazard helpers, extracted from system.ts with identical arithmetic (MASTER-PLAN §4.1 Phase 0; seat-mode §3.5
// and step 6, which now only uses them). Readers (the seat watcher, the court, character mode) predict with these; the
// rulers system draws with them, so a prediction and the draw can never drift apart.
//
// - overthrowHazard: the yearly overthrow chance x of p's ruler (rulerYear), through the C3 stack (compose.ts).
// - contestChance: the chance that p's succession is contested (succession), for the law's heir now.
// - eligibleHeirs: the heirs of p's pool the law could pick (pickHeir's filter).
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import type { RulerState } from './state.ts'
import { RULERS, SUCCESSION } from './params.ts'
import { c3Overthrow } from '../compose.ts'
import type { C3Factors } from '../compose.ts'
import { finOverthrow } from '../finance/hooks.ts' // finance:

const H = RULERS.heirs

/** True if heir slot i (absolute: p * H + k) may inherit under a law that is (not) cognatic at `year`: alive, and a man unless cognatic. */
export function heirEligible(R: RulerState, i: number, cognatic: boolean, year: number): boolean {
  return R.hDeath[i] > year && (cognatic || R.hFemale[i] !== 1)
}

/**
 * The heir of p's pool under law `law` (cognatic: women after men), or -1. Primogeniture and partible: legitimate children
 * by age, then siblings; seniority: adults first, siblings before children; elective: as seniority among adults. Bastards last.
 */
export function pickHeir(R: RulerState, p: number, law: number, cognatic: boolean, year: number): number {
  const o = p * H
  const n = R.hN[p]
  let best = -1, bestK = 1e9
  const senior = law === 2 || law === 3
  for (let k = 0; k < n; k++) {
    const i = o + k
    if (!heirEligible(R, i, cognatic, year)) continue
    const female = R.hFemale[i] === 1
    const adult = year - R.hBorn[i] >= RULERS.majority
    // A lexicographic key (lower first): bastard, woman, [seniority: minor], [seniority: child before sibling inverted], birth.
    let key = (R.hLegit[i] ? 0 : 8) + (female ? 4 : 0)
    if (senior) key += (adult ? 0 : 2) + (R.hChild[i] ? 1 : 0)
    else key += R.hChild[i] ? 0 : 1
    const kk = key * 100000 + (R.hBorn[i] + 50000)
    if (kk < bestK) { bestK = kk; best = k }
  }
  return best
}

/**
 * The pool slots k (0 .. hN[p) - 1) of p's heirs the law could pick at `year` (pickHeir's filter: alive; women only under a
 * cognatic law), written into `out` in pool order; returns their count. The 8cabf09 laws all take bastards (last), so
 * legitimacy does not exclude.
 */
export function eligibleHeirs(R: RulerState, p: number, year: number, out: Int32Array | number[], cognatic: boolean): number {
  const o = p * H
  let n = 0
  for (let k = 0; k < R.hN[p]; k++) if (heirEligible(R, o + k, cognatic, year)) out[n++] = k
  return n
}

/** Adults in p's pool other than slot `skip` (rivals in the house). */
export function adultsIn(R: RulerState, p: number, skip: number, year: number): number {
  const o = p * H
  let n = 0
  for (let k = 0; k < R.hN[p]; k++) if (k !== skip && R.hDeath[o + k] > year && year - R.hBorn[o + k] >= RULERS.majority) n++
  return n
}

/** True if reign r is exposed to overthrow at `year` (rulerYear draws then): less able than overthrowAbility, and on the throne >= 2 years. */
export function overthrowExposed(R: RulerState, r: number, year: number): boolean {
  return RULERS.overthrowAbility - R.rAbility[r] > 0 && year - R.rAcc[r] >= 2
}

/**
 * The yearly overthrow chance of reign r on p's throne at `year` (rulerYear's x), or 0 when its ruler is not exposed (able
 * enough, or acceded less than 2 years ago): RULERS.overthrow * weak * (1 + exhaustion + crisis + lost), through C3.
 * rulerYear draws whenever overthrowExposed, whatever x is (an order may set x to 0 and the stream stays aligned).
 */
export function overthrowHazard(s: HistoryState, ps: PolityState, R: RulerState, p: number): number {
  const r = R.cur[p]
  if (r < 0) return 0
  const year = s.year
  if (!overthrowExposed(R, r, year)) return 0
  const weak = RULERS.overthrowAbility - R.rAbility[r]
  let e = ps.pExh[p]
  if (e > 1) e = 1
  const x = RULERS.overthrow * weak * (1 + e + (ps.pCrisisUntil[p] > year ? 1 : 0) + (year - R.lost[p] <= 10 ? RULERS.overthrowLost : 0))
  const f = s.fin !== null ? finOverthrow(s, p) : undefined // finance: an unpaid army (C3 factor 1)
  if (f === undefined) return c3Overthrow(x)
  C3F.fin = f
  return c3Overthrow(x, C3F)
}
const C3F: C3Factors = {}

/**
 * The chance that heir slot `heir` of p's pool succeeding reign `dead` under law `law` at `year` is contested (succession's
 * `chance`; drawn only outside a crisis).
 */
export function contestChanceOf(ps: PolityState, R: RulerState, p: number, law: number, dead: number, heir: number, year: number): number {
  const i = p * H + heir
  const S = SUCCESSION
  const age = year - R.hBorn[i]
  let rivals = law === 2 || law === 3 ? adultsIn(R, p, heir, year) - 1 : 0
  if (rivals < 0) rivals = 0
  let rv = S.rival * rivals
  if (rv > S.rivalMax) rv = S.rivalMax
  const weak = 1 - R.rAbility[dead]
  return S.base[law] + S.cohesion * (1 - ps.pAsab[p]) + (ps.pMulti[p] ? S.multi : 0) + (age < RULERS.majority ? S.minor : 0) +
    (R.hLegit[i] ? 0 : S.bastard) + (R.hFemale[i] ? S.woman : 0) + (weak > 0 ? S.weak * weak : 0) + rv
}

/**
 * The chance that p's succession would be contested if its ruler died now, for the heir its law picks now (a prediction:
 * the real succession may first change the law, and a chiefdom or elective throne may pass outside the pool). 0 without a
 * ruler or an heir; contested successions are not drawn during a crisis, so also 0 then.
 */
export function contestChance(s: HistoryState, ps: PolityState, R: RulerState, p: number): number {
  const dead = R.cur[p]
  if (dead < 0 || R.rDyn[dead] < 0 || ps.pCrisisUntil[p] > s.year) return 0
  const people = ps.pPeople[p]
  const law = R.law[people]
  const heir = pickHeir(R, p, law, R.cognatic[people] === 1, s.year)
  return heir < 0 ? 0 : contestChanceOf(ps, R, p, law, dead, heir, s.year)
}
