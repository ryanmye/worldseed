// polities: cohesion, grievance, revolt, secession, succession crises and collapse (design 8).
//
// Cohesion (asabiya, every step): grows logistically on frontiers (an edge to another people, to a
// rival polity, between a state and stateless land) and decays slowly in safe interiors, so marches
// build states and empires that pushed their frontiers outward rot from the inside.
// Grievance h of a member (not the capital): distance from the capital (1 - g), foreign rule
// (1 - assimilation), recent conquest, famine, crowding, the state's war weariness, a succession
// crisis, another landmass than the capital's, taxes taken in a bad harvest; unrest moves toward it.
// Revolt: a member with unrest >= UNREST.revolt rises with chance UNREST.chance a step; the revolt
// spreads to discontented neighbouring members (a cluster). Rebels win with Rb^2 / (Rb^2 + Sup^2),
// Rb = sum a b T over the cluster, Sup = Proj of the capital at the seat (weaker in a crisis). A
// winning cluster with enough people becomes a successor state (origin Revolt, or Colonial overseas);
// a smaller one defects to a neighbouring polity of its own people that it would submit to, or goes
// stateless. A crushed one pays in people, wealth and cohesion, and the centre in exhaustion.
// Succession: rulers change every 15-40 years; each change may open a crisis (more likely with low
// cohesion and several peoples): weaker mass, more unrest, rivals emboldened. A crisis in a realm whose
// cohesion fell below UNREST.acrit fragments it: every member's unrest jumps and all revolts are
// resolved at once; if the rump left at the capital is small the polity ends (Fragmented).
// Capitals move when a member has long been much larger and safer (and when the capital is lost).

import { EventType, PolityEnd, PolityOrigin, RevoltCause } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import { foodBase } from '../migration.ts'
import type { HistoryState } from '../state.ts'
import { logEvent } from '../state.ts'
import { controlOne, distTo } from './control.ts'
import { spike } from './danger.ts'
import { COHESION, DANGER, POLITY, SMUGGLE, UNREST } from './params.ts'
import type { TradeState } from '../trade.ts'
import { crisisOpened, lowCohesion } from './civil.ts'
import { chooseCapital, membersOf, successors } from './realm.ts'
import { FAR, clampAsab, endPolity, grip, inCrisis, moveCapital, projAt, setPolity, submits } from './state.ts'
import type { PolityState } from './state.ts'
import { faithGrievance } from '../religion/system.ts' // religion:

/** System part (every step, after dangerStep, which marks the frontiers in scratchI): cohesion on frontiers and in interiors. */
export function cohesionStep(s: HistoryState, ps: PolityState): void {
  const C = COHESION
  const step = POLITY.step
  const living = s.living
  const { asab } = ps
  const front = ps.scratchI
  for (let t = 0; t < living.length; t++) {
    const i = living[t]
    const f = front[i]
    const a = asab[i]
    asab[i] = clampAsab(f !== 0 ? a + step * C.grow * a * (1 - a) * (f & 2 ? C.steppe : 1) : a - step * C.decay * a)
  }
}

/** Grievance terms of member i of polity p, grouped: [peasant, provincial, ethnic, colonial]. */
const terms = new Float64Array(5) // (religion: [4] religious)
function grievance(s: HistoryState, ps: PolityState, i: number, p: number): number {
  const U = UNREST
  const g = ps.dist[i] < FAR ? grip(ps.dist[i], ps.pReach[p]) : 0
  let e = ps.pExh[p]
  if (e > 1) e = 1
  const since = s.year - ps.conqueredAt[i]
  const conquest = since < U.conquestYears ? U.conquest * (1 - since / U.conquestYears) : 0
  const peasant = (s.year - s.lastFamine[i] <= U.famineYears ? U.famine : 0) + U.crowding * smoothstep(0.85, 1, s.pop[i] / foodBase(s, i)) + (ps.badTax[i] ? U.badTax : 0)
  // (v2: corruption where contraband pays)
  const provincial = U.distance * (1 - g) + U.exhaustion * e + (inCrisis(s, ps, p) ? U.crisis : 0) + SMUGGLE.corruptUnrest * ps.corrupt[i]
  const ethnic = U.foreign * (1 - ps.assim[i]) + conquest
  const T = s.terrain
  const colonial = T.landmass[s.cell[i]] !== T.landmass[s.cell[ps.pCapital[p]]] ? U.colony : 0
  terms[0] = peasant; terms[1] = provincial; terms[2] = ethnic; terms[3] = colonial
  if (s.rel !== null) { const r = faithGrievance(s, s.rel, i, p); terms[4] = r; return peasant + provincial + ethnic + colonial + r } // religion: a ruler of another faith, persecution
  return peasant + provincial + ethnic + colonial
}

function causeOf(): number {
  let c = 0
  for (let k = 1; k < 5; k++) if (terms[k] > terms[c]) c = k // (religion: terms[4] stays 0 without it)
  return c === 0 ? RevoltCause.Peasant : c === 1 ? RevoltCause.Provincial : c === 2 ? RevoltCause.Ethnic : c === 3 ? RevoltCause.Colonial : RevoltCause.Religious
}

/** System part (every step): grievance, unrest and assimilation of members. */
export function unrestStep(s: HistoryState, ps: PolityState): void {
  const U = UNREST
  const step = POLITY.step
  const rate = step * U.rate < 1 ? step * U.rate : 1
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const i = living[t]
    const p = ps.polity[i]
    if (p < 0) { ps.unrest[i] = 0; continue }
    if (ps.pCapital[p] === i) { ps.unrest[i] = 0; ps.badTax[i] = 0; continue }
    const h = grievance(s, ps, i, p)
    ps.unrest[i] += rate * (h - ps.unrest[i])
    ps.badTax[i] = 0
    if (ps.assim[i] < 1) { const a = ps.assim[i] + step * U.assim; ps.assim[i] = a > 1 ? 1 : a }
  }
}

/** A revolt seated at `seat` against polity p (rolled for, in revolt order); returns true if the rebels won. */
function revolt(s: HistoryState, ps: PolityState, seat: number, p: number): boolean {
  const U = UNREST
  const rng = ps.rng
  // Cluster: discontented members around the seat.
  const cluster: number[] = [seat]
  ps.rose[seat] = s.year
  for (let h = 0; h < cluster.length && cluster.length < U.cluster; h++) {
    const nb = ps.gNb[cluster[h]]
    if (!nb) continue
    for (let k = 0; k < nb.length && cluster.length < U.cluster; k++) {
      const v = nb[k]
      if (ps.polity[v] !== p || s.abandoned[v] >= 0 || ps.rose[v] === s.year || ps.pCapital[p] === v || ps.unrest[v] < U.spread) continue
      ps.rose[v] = s.year
      cluster.push(v)
    }
  }
  grievance(s, ps, seat, p)
  const cap = ps.pCapital[p]
  logEvent(s, EventType.Revolt, seat, cap, causeOf())
  ps.diag.revolts++
  let rb = 0
  for (const j of cluster) { rb += ps.asab[j] * ps.str[j] * ps.defense[s.cell[j]]; spike(ps, j, DANGER.revolt) }
  const sup = projAt(ps, p, ps.dist[seat] < FAR ? ps.dist[seat] : FAR) * (inCrisis(s, ps, p) ? 1 - U.crisisSupport : 1)
  const win = rng.next() < (rb * rb) / (rb * rb + sup * sup + 1e-12)
  if (!win) {
    for (const j of cluster) {
      s.pop[j] *= 1 - U.crushPop
      s.wealth[j] *= 1 - U.crushWealth
      ps.unrest[j] = U.crushAfter
      ps.asab[j] = clampAsab(ps.asab[j] + COHESION.crushed)
    }
    ps.pExh[p] += U.crushExhaust
    logEvent(s, EventType.RevoltCrushed, seat, cap, cluster.length)
    return false
  }
  ps.diag.revoltsWon++
  let pop = 0
  for (const j of cluster) pop += s.pop[j]
  if (cluster.length >= 2 && pop >= POLITY.minState) {
    const T = s.terrain
    const origin = T.landmass[s.cell[seat]] !== T.landmass[s.cell[cap]] ? PolityOrigin.Colonial : PolityOrigin.Revolt
    for (const j of cluster) setPolity(s, ps, j, -1, FAR)
    successors(s, ps, cluster, p, origin, cap)
    return true
  }
  // Too small for a state: defect to a neighbouring polity of its own people, or go stateless.
  for (const j of cluster) {
    let best = -1, bestD = FAR
    const nb = ps.gNb[j]
    if (nb) {
      for (let k = 0; k < nb.length; k++) {
        const q = ps.polity[nb[k]]
        if (q < 0 || q === p || ps.pPeople[q] !== s.people[j]) continue
        const d = distTo(ps, q, j, s.abandoned)
        if (submits(s, ps, j, projAt(ps, q, d), ps.pPeople[q], 1) && (best < 0 || d < bestD)) { best = q; bestD = d }
      }
    }
    if (best >= 0) {
      setPolity(s, ps, j, best, bestD)
      logEvent(s, EventType.Defected, j, ps.pCapital[best], best)
    } else setPolity(s, ps, j, -1, FAR)
    ps.unrest[j] = 0
  }
  return true
}

/** System part (every step): members with high unrest rise (in id order). */
export function revoltStep(s: HistoryState, ps: PolityState): void {
  const U = UNREST
  const rng = ps.rng
  const living = s.living.slice()
  for (let t = 0; t < living.length; t++) {
    const i = living[t]
    const p = ps.polity[i]
    if (p < 0 || ps.pCapital[p] === i || ps.unrest[i] < U.revolt || ps.rose[i] === s.year || s.abandoned[i] >= 0) continue
    if (rng.next() >= U.chance) continue
    revolt(s, ps, i, p)
  }
}

/** Fragmentation of polity p: every member's unrest jumps; all revolts are resolved at once. */
function fragment(s: HistoryState, ps: PolityState, p: number): void {
  const U = UNREST
  ps.diag.fragmentations++
  const members = membersOf(s, ps, p)
  let pop0 = 0
  for (const j of members) { pop0 += s.pop[j]; ps.unrest[j] += U.fragment }
  for (const j of members) {
    if (ps.polity[j] !== p || ps.pCapital[p] === j || ps.unrest[j] < U.revolt || ps.rose[j] === s.year) continue
    revolt(s, ps, j, p)
  }
  ps.pCrisisUntil[p] = s.year // (the old order is gone: the crisis ends with the break-up)
  const rest = membersOf(s, ps, p)
  let pop = 0
  for (const j of rest) pop += s.pop[j]
  if (rest.length < 3 && pop < 0.25 * pop0) {
    endPolity(s, ps, p, PolityEnd.Fragmented, -1)
    return
  }
  controlOne(s, ps, p, ps.heap)
}

/** System part (every step): successions and crises, fragmentation, capital moves, dwindling. */
export function realmStep(s: HistoryState, ps: PolityState, ts: TradeState): void {
  const U = UNREST
  const rng = ps.rng
  const alive = ps.alive.slice()
  for (const p of alive) {
    if (ps.pEnded[p] >= 0) continue
    // Dwindled.
    if (ps.pMembers[p] <= 0 || ps.pPop[p] < POLITY.dwindlePop) { endPolity(s, ps, p, PolityEnd.Dwindled, -1); continue }
    // Succession.
    if (s.rul !== null) { if (!inCrisis(s, ps, p)) lowCohesion(s, ps, ts, p) } // rulers: successions come with the rulers' deaths (rulers/system.ts)
    else if (s.year >= ps.pNextSucc[p]) {
      ps.pNextSucc[p] = s.year + U.next + Math.floor(rng.next() * U.spreadYears)
      const chance = U.crisisBase + U.crisisAsab * (1 - ps.pAsab[p]) + (ps.pMulti[p] ? U.crisisMulti : 0)
      if (!inCrisis(s, ps, p) && rng.next() < chance) {
        ps.pCrisisUntil[p] = s.year + U.crisisMin + Math.floor(rng.next() * (U.crisisMax - U.crisisMin + 1))
        logEvent(s, EventType.SuccessionCrisis, ps.pCapital[p], -1, p)
        crisisOpened(s, ps, ts, p) // v2: civil war or partition
        if (ps.pEnded[p] >= 0) continue
      }
    } else if (!inCrisis(s, ps, p)) lowCohesion(s, ps, ts, p) // v2: a realm without cohesion may fall into civil war
    if (inCrisis(s, ps, p) && ps.pAsab[p] < U.acrit && ps.pMembers[p] >= 2) { fragment(s, ps, p); if (ps.pEnded[p] >= 0) continue }
    // Capital move (b): a member long much larger and safer than the capital.
    const cap = ps.pCapital[p]
    let big = -1
    const m0 = p + 1 < ps.memOff.length ? ps.memOff[p] : 0, m1 = p + 1 < ps.memOff.length ? ps.memOff[p + 1] : 0
    for (let k = m0; k < m1; k++) {
      const m = ps.memList[k]
      if (m === cap || ps.polity[m] !== p || s.abandoned[m] >= 0) continue
      if (big < 0 || s.pop[m] > s.pop[big]) big = m
    }
    if (big >= 0 && s.pop[big] >= U.moveRatio * s.pop[cap] && ps.dangerAvg[big] < ps.dangerAvg[cap]) {
      if (ps.pRival[p] !== big) { ps.pRival[p] = big; ps.pRivalSince[p] = s.year }
      else if (s.year - ps.pRivalSince[p] >= U.moveYears) { moveCapital(s, ps, p, big); controlOne(s, ps, p, ps.heap) }
    } else { ps.pRival[p] = -1 }
  }
}

/** Yearly: members abandoned this year leave their polity; a lost capital is replaced (or the polity ends). */
export function lostCapitals(s: HistoryState, ps: PolityState, gone: readonly number[]): void {
  for (const id of gone) {
    const p = ps.polity[id]
    if (p < 0) continue
    const wasCap = ps.pCapital[p] === id
    setPolity(s, ps, id, -1, FAR)
    if (!wasCap || ps.pEnded[p] >= 0) continue
    const rest = membersOf(s, ps, p)
    if (rest.length === 0) { endPolity(s, ps, p, PolityEnd.Dwindled, -1); continue }
    moveCapital(s, ps, p, chooseCapital(s, ps, rest, ps.pReach[p]))
    controlOne(s, ps, p, ps.heap)
  }
}
