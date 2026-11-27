// grudges and oaths: the shadow of the future (grudges-and-oaths.md §3.6a; part of HistoryOptions.oaths).
//
// An oath (a truce sworn at a peace, or an alliance) is played as a repeated Prisoner's Dilemma, one round per period of
// POLITY.slowStep years. With grim-trigger punishment a player keeps faith iff delta >= (T - R) / (T - P) (the folk-theorem
// condition: Friedman 1971, https://doi.org/10.2307/2296617; Axelrod 1984, The Evolution of Cooperation, whose continuation
// weight is "the shadow of the future"). Rearranged, it breaks iff T - R > delta / (1 - delta) * (R - P). On top sits the
// reputational cost C of the faithless score, which decays by OATH.repKeep a period:
//   E = (T - R) - delta / (1 - delta) * (R - P) - C,   C = faith * repCost * (0.5 + piety) / (1 - delta * repKeep)
// Caveats: grim trigger is the harshest punishment, so this is the most permissive condition for cooperation, and real rulers do
// not solve games: E is used as a propensity (smoothstep(0, OATH.breakSpan, E) on a chance), not as a hard threshold.
// Payoffs are realm shares per period (0.1 = a tenth of the realm's people); every weight is a design default.
//
// delta of p's ruler (oathDelta, pure):
//   s10 = surv[age + 10] / surv[age]   (survival over one period; a league head: at most the term left / 10)
//   lambda = lawSec[law] * heir * (1 - SUCCESSION.base[law]) * (crisis ? crisisSec : 1)
//            heir: 1 adult and legitimate, heirMinor a minor or a bastard, heirNone none (pickHeir's choice, read-only)
//   delta = clamp(delta0 * (s10 + (1 - s10) * lambda) * (1 - dDanger * dangerAvg[capital]), deltaMin, deltaMax)
//   rulers off: deltaNoRulers.
// So old, heirless, elected or embattled rulers break oaths; young dynasts with heirs keep them. RNG-free: + - * / only.

import type { HistoryState } from '../state.ts'
import { OATH } from './params.ts'
import type { PolityState } from './state.ts'
import { inCrisis } from './state.ts'
import { MAX_AGE } from '../rulers/state.ts'
import { RULERS, SUCCESSION } from '../rulers/params.ts'
import { pickHeir } from '../rulers/hazards.ts'

/** Which oath a decision is about. */
export const OathCase = { Truce: 0, AllyAttack: 1, Defect: 2 } as const

/** delta of polity p's ruler now (deltaNoRulers without rulers or without a reign). */
export function oathDelta(s: HistoryState, ps: PolityState, p: number): number {
  const R = s.rul
  let d = OATH.deltaNoRulers
  if (R !== null && p < R.pcap && R.cur[p] >= 0) {
    const r = R.cur[p]
    const year = s.year
    let age = year - R.rBorn[r]
    if (age < 0) age = 0
    if (age > MAX_AGE) age = MAX_AGE
    const a10 = age + 10 > MAX_AGE + 1 ? MAX_AGE + 1 : age + 10
    let s10 = R.surv[age] > 0 ? R.surv[a10] / R.surv[age] : 0
    if (R.rDyn[r] < 0) { const left = R.rDeath[r] - year; const t = left > 0 ? left / 10 : 0; if (t < s10) s10 = t } // (a league head's term end is public)
    const people = ps.pPeople[p]
    const law = R.law[people]
    const k = pickHeir(R, p, law, R.cognatic[people] === 1, year)
    let heir = OATH.heirNone
    if (k >= 0) {
      const i = p * RULERS.heirs + k
      heir = R.hLegit[i] === 1 && year - R.hBorn[i] >= RULERS.majority ? 1 : OATH.heirMinor
    }
    const lam = OATH.lawSec[law] * heir * (1 - SUCCESSION.base[law]) * (inCrisis(s, ps, p) ? OATH.crisisSec : 1)
    d = OATH.delta0 * (s10 + (1 - s10) * lam)
  }
  const cap = ps.pCapital[p]
  d *= 1 - OATH.dDanger * (cap >= 0 && cap < ps.seen ? ps.dangerAvg[cap] : 0)
  return d < OATH.deltaMin ? OATH.deltaMin : d > OATH.deltaMax ? OATH.deltaMax : d
}

/** The piety of p's ruler (0.5 without rulers). */
export function rulerPiety(s: HistoryState, p: number): number {
  const R = s.rul
  if (R === null || p >= R.pcap || R.cur[p] < 0) return 0.5
  return R.rPiety[R.cur[p]]
}

/**
 * The excess E of breaking an oath: (T - R) - delta / (1 - delta) * (R - P) - C, with C the reputational cost of adding
 * `faith` to the faithless score (OATH.faithTruce or faithAlly) for a ruler of piety `piety`. Pure.
 */
export function oathExcess(delta: number, tr: number, rp: number, faith: number, piety: number): number {
  const c = (faith * OATH.repCost * (0.5 + piety)) / (1 - delta * OATH.repKeep)
  return tr - (delta / (1 - delta)) * rp - c
}
