// grudges and oaths: the balance of threat and bandwagoning (grudges-and-oaths.md §3.10; HistoryOptions.balance).
//
// States ally against the greatest threat, not the greatest power. Threat = aggregate power x proximity x offensive intent
// (Walt 1987, The Origins of Alliances, https://doi.org/10.7591/9780801469992; offensive capability folded into proximity):
//   adv    = advantageAt(c, x)       (Proj_c at x's capital over x's defence: power x proximity in one number)
//   intent = clamp01(wR * smoothstep(0.3, 1.2, R(c, x)) + wG * g(x, c) + wF * f_c / (1 + f_c) + wA * aggr_c)
//   theta(c -> x) = adv / (adv + 1) * intent,   aggr_c = n / (n + 2), n = conquest wars c began within ALIGN.aggrYears
// allianceStepBalance replaces the R >= ALLIANCE.threat rule: pairs threatened by the same c with theta >= thetaMin ally with
//   chance ALLIANCE.chance * smoothstep(thetaMin, thetaFull, min(theta_x, theta_y)) * (c the hegemon ? 1 + coalition : 1)
//   * marriage / (1 + repAlliance * (f_x + f_y))   (C7, compose.ts), one 'history-align' draw per pair passing the filters;
// a coalition may grow to ALIGN.maxAlliances. A defensive ally joins with ALLIANCE.join * (joinBase + joinTheta * theta(attacker
// -> ally)) (threshold only, same draw). Weak states next to a hegemon with no balancer at hand bandwagon (Walt 1987 ch. 2;
// Schweller 1994, https://doi.org/10.2307/2539149, argues bandwagoning is more often for profit, not modelled): they ally
// with it against its rival, or offer tribute unasked. Both are rare and limited to weak states, as the params say.
// Proxies without balance: theta(c -> x) = 0.5 * smoothstep(1, 2, advantageAt(c, x)); an alliance against c is worth
// smoothstep(0.7, 1.2, R(x, c)).

import { BondKind, EventType } from '../../../contract.ts'
import type { EventType as EventTypeT } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import { ALIGN, ALLIANCE } from './params.ts'
import type { PolityState } from './state.ts'
import { Tier, inContact, tierOf } from './state.ts'
import type { GrudgeState } from './grudgeState.ts'
import { at, put } from './grudgeState.ts'
import { advantageAt, alliances, allied, ally, overlordOf, subject } from './bonds.ts'
import { relIdx, relationOf } from './relations.ts'
import { faithOf, grudge } from './grievances.ts'
import { atWar } from './formation.ts'
import { repFactor } from './oaths.ts'
import { c7Alliance } from '../compose.ts'
import type { C7Factors } from '../compose.ts'
import { tied } from '../rulers/marriage.ts' // rulers:
import { MARRIAGE } from '../rulers/params.ts' // rulers:

/** aggr_c: n / (n + 2) over the conquest wars c began within ALIGN.aggrYears. */
export function aggrOf(s: HistoryState, og: GrudgeState, c: number): number {
  const ys = c < og.aggrYears.length ? og.aggrYears[c] : undefined
  if (!ys) return 0
  let n = 0
  for (let k = ys.length - 1; k >= 0 && s.year - ys[k] < ALIGN.aggrYears; k--) n++
  return n / (n + 2)
}

/** declare hook (balance): c began a war of conquest this year. */
export function noteAggression(s: HistoryState, og: GrudgeState, c: number): void {
  while (og.aggrYears.length <= c) og.aggrYears.push([])
  const ys = og.aggrYears[c]
  ys.push(s.year)
  if (ys.length > 16) ys.splice(0, ys.length - 16)
}

/** theta(c -> x): the threat c poses to x (balance on: power x proximity x intent; off: the proxy). Pure. */
export function threatOf(s: HistoryState, ps: PolityState, c: number, x: number): number {
  const adv = advantageAt(s, ps, c, x)
  const og = ps.og
  if (og === null || !og.balance) return 0.5 * smoothstep(1, 2, adv)
  const fc = faithOf(og, c)
  let intent = ALIGN.wR * smoothstep(0.3, 1.2, relationOf(ps, c, x)) + ALIGN.wG * (og.oaths ? grudge(og, x, c) : 0) + ALIGN.wF * (fc / (1 + fc)) + ALIGN.wA * aggrOf(s, og, c)
  if (intent > 1) intent = 1
  return (adv / (adv + 1)) * intent
}

/** The cached theta(c -> x) of relation r this slow step (balance on), else threatOf. */
export function threatAt(s: HistoryState, ps: PolityState, r: number, c: number, x: number): number {
  const og = ps.og
  if (og !== null && og.balance && r >= 0) {
    const v = ps.relA[r] === c ? at(og.relThrAB, r, -1) : at(og.relThrBA, r, -1)
    if (v >= 0) return v
  }
  return threatOf(s, ps, c, x)
}

/** The worth of an alliance against c to x (balance: theta(c -> x); proxy: smoothstep(0.7, 1.2, R(x, c))). */
export function allianceWorth(s: HistoryState, ps: PolityState, x: number, c: number): number {
  if (c < 0 || ps.pEnded[c] >= 0) return 0
  const og = ps.og
  if (og !== null && og.balance) return threatOf(s, ps, c, x)
  return smoothstep(0.7, 1.2, relationOf(ps, x, c))
}

// --- The alliance pass with balance on --------------------------------------------------------------------

/** The hegemon: the alive polity of most mass (ties: lower id) if it holds >= ALIGN.hegemonMin of the polities' people, else -1. */
function hegemonOf(ps: PolityState): number {
  let h = -1, tot = 0
  for (const p of ps.alive) { tot += ps.pPop[p]; if (h < 0 || ps.pMass[p] > ps.pMass[h]) h = p }
  return h >= 0 && tot > 0 && ps.pPop[h] >= ALIGN.hegemonMin * tot ? h : -1
}

/** True when x holds an alliance whose threat is c. */
function alliedAgainst(ps: PolityState, x: number, c: number): boolean {
  for (const k of ps.activeBonds) if (ps.bKind[k] === BondKind.Alliance && ps.bThreat[k] === c && (ps.bA[k] === x || ps.bB[k] === x)) return true
  return false
}

const kingdom = (ps: PolityState, x: number) => tierOf(ps.pPop[x], ps.pMembers[x], ps.pMulti[x] === 1, ps.worldPop) >= Tier.Kingdom

/** System part (every slow step, with balance on, in place of the R >= threat rule): alliances against the greatest threat. */
export function allianceStepBalance(s: HistoryState, ps: PolityState, og: GrudgeState): void {
  const X = ALIGN
  const R = ps.relA.length
  const h = hegemonOf(ps)
  og.hegemon = h
  // theta both ways for pairs with rivalry or a grudge (cached for this slow step: oaths, arms and bondStep read it)
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    let ab = -1, ba = -1
    if (ps.pEnded[a] < 0 && ps.pEnded[b] < 0 && (ps.relR[r] >= X.preR || (og.oaths && (grudge(og, a, b) > 0 || grudge(og, b, a) > 0)))) { ab = threatOf(s, ps, a, b); ba = threatOf(s, ps, b, a) }
    put(og.relThrAB, r, ab, -1); put(og.relThrBA, r, ba, -1)
  }
  // threats (c, x, theta) in relation order, both ways
  const tc: number[] = [], tx: number[] = [], tt: number[] = []
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    for (let dir = 0; dir < 2; dir++) {
      const c = dir === 0 ? a : b, x = dir === 0 ? b : a
      const th = dir === 0 ? at(og.relThrAB, r, -1) : at(og.relThrBA, r, -1)
      if (th < X.thetaMin || !kingdom(ps, x) || overlordOf(ps, x) === c || allied(ps, x, c)) continue
      tc.push(c); tx.push(x); tt.push(th)
    }
  }
  const rng = og.rngAlign!
  const T = tc.length
  for (let i = 0; i < T; i++) {
    for (let j = i + 1; j < T; j++) {
      if (tc[i] !== tc[j]) continue
      const c = tc[i], x = tx[i], y = tx[j]
      if (x === y || ps.pEnded[x] >= 0 || ps.pEnded[y] >= 0 || ps.pEnded[c] >= 0) continue
      if (relationOf(ps, x, y) >= ALLIANCE.calm || atWar(ps, x, y) || allied(ps, x, y)) continue
      if (overlordOf(ps, x) === y || overlordOf(ps, y) === x || !inContact(s, ps.pPeople[x], ps.pPeople[y])) continue
      if (alliances(ps, x) >= (alliedAgainst(ps, x, c) ? X.maxAlliances : 2) || alliances(ps, y) >= (alliedAgainst(ps, y, c) ? X.maxAlliances : 2)) continue
      // (C7: the theta ramp and the coalition bonus shape ALLIANCE.chance itself, factor 1; reputation is factor 2)
      const base = ALLIANCE.chance * smoothstep(X.thetaMin, X.thetaFull, tt[i] < tt[j] ? tt[i] : tt[j]) * (c === h ? 1 + X.coalition : 1)
      const f = repFactor(og, x, y)
      if (f !== undefined) C7F.reputation = f
      if (rng.next() >= c7Alliance(base, s.rul !== null && tied(s.rul, x, y) ? MARRIAGE.alliance : 1, f !== undefined ? C7F : undefined)) continue
      ally(s, ps, x < y ? x : y, x < y ? y : x, c)
      og.diag.balancing++
      if (c === h) og.diag.coalitionAlliances++
    }
  }
}
const C7F: C7Factors = {}

/** bondStep (balance on): an alliance against c lapses when c no longer threatens either ally (theta < thetaMin / 2). */
export function threatLapsed(s: HistoryState, ps: PolityState, a: number, b: number, c: number): boolean {
  const lim = ALIGN.thetaMin / 2
  return threatAt(s, ps, relIdx(ps, c, a), c, a) < lim && threatAt(s, ps, relIdx(ps, c, b), c, b) < lim
}

/** System part (every slow step, right after the alliances, balance on): weak neighbours of the hegemon side with it. */
export function bandwagonStep(s: HistoryState, ps: PolityState, og: GrudgeState): void {
  const h = og.hegemon
  if (h < 0 || ps.pEnded[h] >= 0) return
  const X = ALIGN
  const rng = og.rngAlign!
  const alive = ps.alive.slice()
  for (const x of alive) {
    if (x === h || ps.pEnded[x] >= 0 || ps.pSub[x] >= 0 || overlordOf(ps, h) === x) continue
    const rx = relIdx(ps, x, h)
    if (rx < 0 || ps.relEdges[rx].length === 0 || allied(ps, x, h) || atWar(ps, x, h) || ps.pWars[x] > 0) continue
    const chief = !kingdom(ps, x)
    if (!chief && ps.pPop[x] >= X.weak * ps.pPop[h]) continue
    const th = threatAt(s, ps, rx, h, x)
    if (th < X.bandTheta) continue
    // no balancer at hand: a neighbouring kingdom at peace with x that h threatens too
    if (!chief) {
      let balancer = false
      for (let r = 0; r < ps.relA.length && !balancer; r++) {
        const a = ps.relA[r], b = ps.relB[r]
        if (a !== x && b !== x) continue
        const y = a === x ? b : a
        if (y === h || ps.pEnded[y] >= 0 || !kingdom(ps, y) || ps.relR[r] >= ALLIANCE.calm || !inContact(s, ps.pPeople[x], ps.pPeople[y])) continue
        if (threatAt(s, ps, relIdx(ps, h, y), h, y) >= X.thetaMin) balancer = true
      }
      if (balancer) continue
    }
    const fh = faithOf(og, h)
    if (rng.next() >= X.band * smoothstep(X.bandTheta, 1, th) * (1 - fh / (1 + fh))) continue
    // h's strongest rival other than x
    let c = -1, best = -1
    for (let r = 0; r < ps.relA.length; r++) {
      const a = ps.relA[r], b = ps.relB[r]
      if (a !== h && b !== h) continue
      const y = a === h ? b : a
      if (y === x || ps.pEnded[y] >= 0 || ps.relR[r] < ALLIANCE.threat) continue
      const t = threatAt(s, ps, r, y, h)
      if (t > best) { best = t; c = y }
    }
    if (c >= 0) {
      logX(s, EventType.Bandwagon, ps.pCapital[x], ps.pCapital[h], h, 0)
      ally(s, ps, x < h ? x : h, x < h ? h : x, c)
      og.diag.bandwagonAlly++
    } else {
      logX(s, EventType.Bandwagon, ps.pCapital[x], ps.pCapital[h], h, 1)
      subject(s, ps, x, h, true)
      og.diag.bandwagonTribute++
    }
    if (ps.relR[rx] > X.bandR) ps.relR[rx] = X.bandR
  }
}

function logX(s: HistoryState, type: EventTypeT, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}
