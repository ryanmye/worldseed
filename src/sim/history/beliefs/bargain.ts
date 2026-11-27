// beliefs: the bargaining crisis (beliefs-and-deception.md §3.4; MASTER-PLAN §2.3 C1 placement). With beliefs on, a
// declaration draw that hits means "p presses its claim on q", and the press is bargained before any war.
//
// Perceived advantage at the chosen front (the walls are public, the strength is not):
//   a^ = Proj_p(front) / projBel(p, q, front) / (1 + multiWar coal_p) * bias_p    (coal_p: q's protectors known to p)
//   a~ = projBel(q, p, front) / Proj_q(front) / (1 + multiWar coal_q)              (q's view; it knows its secret friends)
//   drive = rv * max(smoothstep(advLow, advHigh, a^), prevent * dpi+) * crisis * (1 - E_p)   (replaces today's term; pressMul outside the C1 clamp)
// The bargain (Fearon 1995, take-it-or-leave-it by the challenger; RNG-free but for the ruler draw):
//   pi(x) = x^2 / (x^2 + 1) (the battle law);  pi_p = pi(a^), pi_q = pi(a~)
//   c_p = cWar (1 + E_p) fund_p;  c_q = cWar cDef (1 + E_q) fund_q   (fund: 1 + fundK (1 - smoothstep(0.5, 4, finFundYears)), or the poor proxy)
//   kappa = holyK when a holy city faces p (indivisibility); the pie = q's border towns facing p (no capital, no holy city), at most cedeMax
//   x* = pi_q + c_q - kappa (the most q yields, in pie shares); towns greedily by population while their share fits (Fearon's
//   indivisibility in small); else tribute when x* >= tributeX (worth tributeVal)
//   commitment (Powell 2006): F = (T_pq / G_p)^3, a^_fut = a^ / F, dpi = pi(a^) - pi(a^_fut); no deal binds when dpi > c_p + c_q
//   peace when pi_p - c_p <= x_got, no commitment problem and the ruler does not spoil it (settleFail, x 2 warlike: Fearon's
//   non-rationalist path); p backs down (Deterred) when pi_p - c_p <= 0.

import { EventType, WarMotive } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { projAt } from '../polity/state.ts'
import { ALLIANCE, POLITY, WAR } from '../polity/params.ts'
import { atWar } from '../polity/formation.ts'
import { relIdx } from '../polity/relations.ts'
import { subject } from '../polity/bonds.ts'
import { cedeTowns } from '../polity/war.ts'
import { recordGrievance } from '../polity/grievances.ts'
import { finFundYears, finMonetised } from '../finance/hooks.ts'
import { GrievanceKind } from '../../../contract.ts'
import { BELIEF } from './params.ts'
import type { BeliefState } from './state.ts'
import { knownProtectors } from './deception.ts'
import { kalman, kingdomPlus, logX, noise, ownGrowth, piWin, projBel, rowOf } from './system.ts'

const borders = (ps: PolityState) => (x: number, y: number): boolean => { const r = relIdx(ps, x, y); return r >= 0 && ps.relEdges[r].length > 0 }

/** The crisis scratch (one candidate at a time, set by crisisDrive, read by bargain). */
const C = { ahat: 0, acheck: 0, adv: 0, cp: 0, cq: 0, dpi: 0, F: 1, frontV: -1, coal: 0 }

function fundMul(s: HistoryState, ps: PolityState, p: number): number {
  if (s.fin !== null && finMonetised(s, p)) return 1 + BELIEF.fundK * (1 - smoothstep(BELIEF.fundLo, BELIEF.fundHi, finFundYears(s, p)))
  return s.wealth[ps.pCapital[p]] < WAR.poorShare * ps.pMass[p] ? BELIEF.poorMul : 1
}

/**
 * The belief part of the press drive of p on q at the front (frontV, frontD) found by declarations: max(smoothstep(advLow,
 * advHigh, a^), prevent * dpi+). `adv` is the true front advantage (with arms), `armsK` the arms factor on it.
 */
export function crisisDrive(s: HistoryState, ps: PolityState, bel: BeliefState, p: number, q: number, frontV: number, frontD: number, adv: number, armsK: number): number {
  const X = BELIEF
  const tw = (x: number, y: number) => atWar(ps, x, y)
  const bd = borders(ps)
  const coalP = knownProtectors(ps, bel, p, q, false, ALLIANCE.join, tw, bd)
  const coalQ = knownProtectors(ps, bel, p, q, true, ALLIANCE.join, tw, bd)
  const R = s.rul
  const bias = R !== null && p < R.pcap && R.cur[p] >= 0 ? 1 + X.optimism * (R.rWar[R.cur[p]] - 0.5) : 1
  const dq = ps.dist[frontV]
  // (the press is judged on the pair alone; q's known protectors weigh in once the crisis is open: bargain)
  const ahat = (projAt(ps, p, frontD) / (projBel(s, ps, p, q, dq) + 1e-9)) * bias * armsK
  const acheck = (projBel(s, ps, q, p, frontD) / (projAt(ps, q, dq) + 1e-9) / (1 + POLITY.multiWar * coalQ)) * armsK
  let e = ps.pExh[p]
  if (e > 1) e = 1
  let eq = ps.pExh[q]
  if (eq > 1) eq = 1
  const cp = X.cWar * (1 + e) * fundMul(s, ps, p)
  const cq = X.cWar * X.cDef * (1 + eq) * fundMul(s, ps, q)
  // Commitment: q's believed growth against p's own over the horizon (3 slow steps: F = ratio^3).
  const k = rowOf(ps, p, q)
  const T = k >= 0 && k < bel.trend.length && bel.est[k] > 0 ? bel.trend[k] : 1
  const ratio = T / ownGrowth(ps, bel, p)
  let F = 1
  for (let h = 0; h < X.horizon; h++) F *= ratio
  const dpi = piWin(ahat) - piWin(ahat / F)
  C.ahat = ahat; C.coal = coalP; C.acheck = acheck; C.adv = adv; C.cp = cp; C.cq = cq; C.dpi = dpi; C.F = F; C.frontV = frontV
  const d1 = smoothstep(WAR.advLow, WAR.advHigh, ahat)
  const d2 = X.prevent * smoothstep(0, 0.25, dpi - cp)
  return d1 > d2 ? d1 : d2
}

const pie: number[] = []

/** A holy city of p's or q's state faith held by q on the p-q border (or the front town). */
function holyAtStake(s: HistoryState, ps: PolityState, r: number, p: number, q: number, frontV: number): boolean {
  const rel = s.rel
  if (rel === null) return false
  for (const x of [p, q]) {
    if (x >= rel.pcap) continue
    const f = rel.state[x]
    if (f < 0) continue
    const h = rel.holy[f]
    if (h < 0 || h >= ps.seen || s.abandoned[h] >= 0 || ps.polity[h] !== q) continue
    if (h === frontV) return true
    const e = ps.relEdges[r]
    for (let i = 0; i < e.length; i += 3) if (e[i] === h || e[i + 1] === h) return true
  }
  return false
}

function isHoly(s: HistoryState, v: number): boolean {
  const rel = s.rel
  if (rel === null) return false
  for (let f = 0; f < rel.holy.length; f++) if (rel.holy[f] === v) return true
  return false
}

/**
 * The bargain after a press of p on q (relation r) hit (crisisDrive just set the scratch). Returns the WarMotive (>= 1) when
 * it ends in war (the caller declares it and calls beliefWarDeclared), or 0 when it ended without war (Coerced or Deterred).
 */
export function bargain(s: HistoryState, ps: PolityState, bel: BeliefState, r: number, p: number, q: number): number {
  const X = BELIEF
  const { acheck, cp, cq, dpi, frontV } = C
  bel.diag.crises++
  // The crisis is itself a look: q musters (its show of strength included) and p reassesses (one cheap observation, 2 draws).
  const k = rowOf(ps, p, q)
  if (k >= 0 && k < bel.est.length && bel.est[k] > 0 && ps.pMass[q] > 0) {
    const e0 = bel.est[k]
    kalman(bel, k, ps.pMass[q] * (1 + bel.bluff[q] * bel.cred[q]) * noise(bel.rng, 1 / Math.sqrt(X.iCrisis)), X.iCrisis)
    C.ahat *= e0 / bel.est[k]
  }
  // q's protectors known to p stand by it (extended deterrence; secret ones stay hidden)
  C.ahat /= 1 + POLITY.multiWar * C.coal
  const ahat = C.ahat
  // p no longer thinks itself the stronger (and fears no rising power): it backs down.
  if (!(ahat > WAR.advLow) && !(dpi > cp)) { deterred(s, ps, bel, p, q); return 0 }
  const pp = piWin(ahat), pq = piWin(acheck)
  const kappa = holyAtStake(s, ps, r, p, q, frontV) ? X.holyK : 0
  // The pie: q's border settlements facing p, by population.
  pie.length = 0
  const e = ps.relEdges[r]
  const cap = ps.pCapital[q]
  for (let i = 0; i < e.length; i += 3) {
    for (let j = 0; j < 2; j++) {
      const v = e[i + j]
      if (ps.polity[v] !== q || v === cap || s.abandoned[v] >= 0 || s.outpost[v] || pie.indexOf(v) >= 0 || isHoly(s, v)) continue
      pie.push(v)
    }
  }
  pie.sort((a, b) => s.pop[b] - s.pop[a] || a - b)
  if (pie.length > X.cedeMax) pie.length = X.cedeMax
  let tot = 0
  for (const v of pie) tot += s.pop[v]
  const xStar0 = pq + cq
  const xStar = xStar0 - kappa
  const towns: number[] = []
  let got = 0
  if (tot > 0) for (const v of pie) { const sh = s.pop[v] / tot; if (got + sh <= xStar) { towns.push(v); got += sh } }
  let tribute = false
  if (towns.length === 0 && xStar >= X.tributeX && ps.pSub[q] < 0 && ps.pSub[p] < 0) { tribute = true; got = X.tributeVal }
  const want = pp - cp
  const commitment = dpi > cp + cq
  if (commitment) return warMotive(bel, WarMotive.Preventive)
  // p weighs war against the risk of losing it (a beaten challenger loses ground too: deterLoss of the pie) and backs down
  if (want <= 0 || want - (1 - pp) * X.deterLoss <= 0) { deterred(s, ps, bel, p, q); return 0 }
  if (want <= got) {
    const R = s.rul
    const fail = X.settleFail * (R !== null && p < R.pcap && R.cur[p] >= 0 ? 2 * R.rWar[R.cur[p]] : 1)
    if (bel.rng.next() < fail) return warMotive(bel, WarMotive.Ruler)
    coerce(s, ps, bel, r, p, q, tribute ? null : towns)
    return 0
  }
  if (kappa > 0 && want <= xStar0) return warMotive(bel, WarMotive.Indivisible)
  if (want <= xStar) return warMotive(bel, WarMotive.Discrete)
  return warMotive(bel, WarMotive.Optimism)
}

let lastMotive = 0
function warMotive(bel: BeliefState, m: number): number {
  bel.diag.wars++
  bel.diag.byMotive[m]++
  if (m === WarMotive.Preventive && C.F > 1) bel.diag.preventF++
  lastMotive = m
  return m
}

/** After the bargained war w was declared (declarations): record what the attacker believed and why no bargain held. */
export function beliefWarDeclared(bel: BeliefState, w: number): void {
  while (bel.wBel.length <= w) { bel.wBel.push(-1); bel.wTrue.push(-1); bel.wMotive.push(0); bel.wGap0.push(-1) }
  bel.wBel[w] = C.ahat
  bel.wTrue[w] = C.adv
  bel.wMotive[w] = lastMotive
  const g = piWin(C.ahat) - piWin(C.acheck)
  bel.wGap0[w] = g > 0 ? g : 0
}

function deterred(s: HistoryState, ps: PolityState, bel: BeliefState, p: number, q: number): void {
  bel.diag.deterred++
  const bluff = bel.bluff[q] > 0
  if (!kingdomPlus(ps, p) || !kingdomPlus(ps, q)) return
  bel.diag.deterredLogged++
  logX(s, EventType.Deterred, ps.pCapital[p], ps.pCapital[q], q, bluff ? 1 : 0)
}

function coerce(s: HistoryState, ps: PolityState, bel: BeliefState, r: number, p: number, q: number, towns: number[] | null): void {
  const X = BELIEF
  bel.diag.coerced++
  logX(s, EventType.Coerced, ps.pCapital[p], ps.pCapital[q], p, towns === null ? 0 : towns.length)
  if (towns === null) { bel.diag.tributes++; subject(s, ps, q, p, true) }
  else {
    const n = cedeTowns(s, ps, q, p, towns)
    if (ps.og !== null && ps.og.oaths && n > 0) recordGrievance(s, ps, ps.og, GrievanceKind.TownCeded, q, p, X.wCeded * n < X.capCeded ? X.wCeded * n : X.capCeded, towns[0], -1) // grudges:
  }
  ps.relTruce[r] = s.year + X.cedeTruce
  let x = ps.relR[r]
  if (!(ps.og !== null && ps.og.oaths)) x += X.coerceR
  x *= X.coercePeace
  ps.relR[r] = x > 2 ? 2 : x
}

/** The tired-peace convergence factor of war w (C6 factor 4b): 1 + converge * max(0, 1 - gap now / max(gap at start, 0.05)); undefined when not bargained. */
export function convergeFactor(s: HistoryState, ps: PolityState, bel: BeliefState, w: number): number | undefined {
  if (w >= bel.wGap0.length || bel.wGap0[w] < 0) return undefined
  const p = ps.wAtt[w], q = ps.wDef[w]
  const mp = ps.pMass[p], mq = ps.pMass[q]
  if (!(mp > 0) || !(mq > 0)) return undefined
  const pp = piWin(mp / beliefOr(s, ps, p, q))
  const pq = piWin(beliefOr(s, ps, q, p) / mq)
  const gap = pp - pq
  const g0 = bel.wGap0[w] > 0.05 ? bel.wGap0[w] : 0.05
  const c = 1 - (gap > 0 ? gap : 0) / g0
  return 1 + BELIEF.converge * (c > 0 ? c : 0)
}

function beliefOr(s: HistoryState, ps: PolityState, o: number, t: number): number {
  const bel = s.bel!
  const k = rowOf(ps, o, t)
  return k >= 0 && k < bel.est.length && bel.est[k] > 0 ? bel.est[k] : ps.pMass[t]
}
