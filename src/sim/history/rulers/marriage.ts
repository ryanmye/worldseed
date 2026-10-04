// rulers: marriage ties between ruling houses, personal unions and wars of succession.
//
// Ties (every POLITY.slowStep years): two neighbouring realms whose peoples have met (a relation with border edges), at
// peace, with rivalry below MARRIAGE.maxR, both ruled by houses, marry with chance MARRIAGE.chance. A tie lowers their
// rivalry (relations hook) and doubles their chance to ally against a common rival (bonds hook); it lapses after
// MARRIAGE.years, at war, or when either house loses its throne.
// Claims: when a house dies out (no heir) on a throne tied by marriage, the tied ruler's claim is 1 - age / years. With
// chance union * claim the tied ruler inherits: a personal union (the junior realm bound to the senior as a vassal in
// History.bonds, one person on both thrones). Passed over, the claimant presses its claim by war with chance war * claim
// (a war of succession). A union merges into one realm after mergeYears (the senior absorbs the junior: PolityEnd.Absorbed),
// and splits when the senior's succession is not clean (a new house, a crisis), when the junior throws off the bond, or
// when the senior realm ends.

import { AccessionHow, BondEnd, BondKind, EventType, PolityEnd, PolityOrigin, ReignEnd, TOWN_POPULATION, UnionEnd } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { logEvent } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { FAR, Tier, endPolity, inContact, setPolity, tierOf } from '../polity/state.ts'
import { WAR } from '../polity/params.ts'
import { atWar } from '../polity/formation.ts'
import { distAcross, endBond, subject } from '../polity/bonds.ts'
import { bound } from '../polity/policy.ts'
import { relIdx } from '../polity/relations.ts'
import { declare } from '../polity/war.ts'
import { controlOne } from '../polity/control.ts'
import { MARRIAGE } from './params.ts'
import type { RulerState } from './state.ts'
import { accede, endReign, logX, newHouseAccede } from './system.ts'

/** True when bond k is the bond of an active personal union. */
export function unionBond(R: RulerState, k: number): boolean {
  for (const u of R.uActive) if (R.uBond[u] === k) return true
  return false
}

/** True when the ruling houses of p and q are tied by marriage. */
export function tied(R: RulerState, p: number, q: number): boolean {
  const a = p < q ? p : q, b = p < q ? q : p
  for (const m of R.mActive) if (R.mA[m] === a && R.mB[m] === b) return true
  return false
}

function houseOf(R: RulerState, p: number): number {
  if (p >= R.pcap) return -1
  const r = R.cur[p]
  return r >= 0 && R.rEnd[r] < 0 ? R.rDyn[r] : -1
}

/** Ends tie m now. */
function endTie(s: HistoryState, R: RulerState, m: number, i: number): void {
  R.mEnd[m] = s.year
  R.mActive.splice(i, 1)
}

/** System part (every slow step): ties lapse; neighbours marry. */
export function marriageStep(s: HistoryState, ps: PolityState, R: RulerState): void {
  for (let i = R.mActive.length - 1; i >= 0; i--) {
    const m = R.mActive[i]
    const a = R.mA[m], b = R.mB[m]
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0 || houseOf(R, a) !== R.mDA[m] || houseOf(R, b) !== R.mDB[m] || atWar(ps, a, b) || s.year - R.mYear[m] >= MARRIAGE.years) endTie(s, R, m, i)
  }
  const rng = R.rng
  const N = ps.relA.length
  for (let r = 0; r < N; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0 || ps.relWar[r] >= 0 || ps.relEdges[r].length === 0 || ps.relR[r] >= MARRIAGE.maxR) continue
    const da = houseOf(R, a), db = houseOf(R, b)
    if (da < 0 || db < 0 || da === db || R.union[a] >= 0 || R.union[b] >= 0 || tied(R, a, b)) continue
    if (rng.next() >= MARRIAGE.chance) continue
    const m = R.mA.length
    R.mA.push(a); R.mB.push(b); R.mDA.push(da); R.mDB.push(db); R.mYear.push(s.year); R.mEnd.push(-1)
    R.mActive.push(m)
    R.diag.marriages++
    const big = (p: number): boolean => tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop) >= Tier.Kingdom
    if (big(a) && big(b)) logX(s, EventType.RoyalMarriage, ps.pCapital[a], ps.pCapital[b], m, -1)
  }
}

/** True when p is the senior realm of an active union. */
function isSenior(R: RulerState, p: number): boolean {
  for (const u of R.uActive) if (R.uSenior[u] === p) return true
  return false
}

/** Ends union u now with `end` (logs UnionDissolved). */
function closeUnion(s: HistoryState, ps: PolityState, R: RulerState, u: number, end: number): void {
  const i = R.uActive.indexOf(u)
  if (i < 0) return
  R.uActive.splice(i, 1)
  R.uEnd[u] = s.year
  R.uCause[u] = end
  const j = R.uJunior[u]
  if (j < R.pcap && R.union[j] === u) R.union[j] = -1
  logX(s, EventType.UnionDissolved, ps.pCapital[j], ps.pCapital[R.uSenior[u]], u, end)
}

/** The junior j of union u breaks away under a new house of its own. */
function split(s: HistoryState, ps: PolityState, R: RulerState, u: number, cause: number, how: number): void {
  const j = R.uJunior[u]
  closeUnion(s, ps, R, u, UnionEnd.Split)
  const k = R.uBond[u]
  if (k >= 0 && ps.bEnd[k] < 0) endBond(s, ps, k, BondEnd.Freed)
  if (ps.pEnded[j] >= 0) return
  endReign(s, ps, R, j, cause)
  newHouseAccede(s, ps, R, j, how)
}

/**
 * A house died out on p's throne (no heir): a ruler tied to it by marriage may claim it. Returns true when the throne is
 * filled here (a union, or a new house with the claimant passed over, who may go to war).
 */
export function extinctClaim(s: HistoryState, ps: PolityState, R: RulerState, p: number, dyn: number): boolean {
  if (dyn < 0) return false
  let best = -1, bc = 0
  for (const m of R.mActive) {
    let q = -1, dq = -1
    if (R.mA[m] === p && R.mDA[m] === dyn) { q = R.mB[m]; dq = R.mDB[m] }
    else if (R.mB[m] === p && R.mDB[m] === dyn) { q = R.mA[m]; dq = R.mDA[m] }
    if (q < 0 || ps.pEnded[q] >= 0 || houseOf(R, q) !== dq) continue
    const c = 1 - (s.year - R.mYear[m]) / MARRIAGE.years
    if (c > bc) { bc = c; best = m }
  }
  if (best < 0) return false
  const q = R.mA[best] === p ? R.mB[best] : R.mA[best]
  const rng = R.rng
  const can = R.union[q] < 0 && ps.pSub[q] < 0 && !atWar(ps, p, q) && ps.pOrigin[p] !== PolityOrigin.League && !isSenior(R, p) && inContact(s, ps.pPeople[p], ps.pPeople[q])
  if (can && rng.next() < MARRIAGE.union * bc) { formUnion(s, ps, R, q, p); return true }
  // Passed over: the great men raise a house of their own; the claimant may fight for the throne.
  R.diag.passedOver++
  newHouseAccede(s, ps, R, p, AccessionHow.Elected)
  const rel = relIdx(ps, p, q)
  if (rel >= 0 && ps.relEdges[rel].length > 0 && ps.relWar[rel] < 0 && ps.pWars[q] < WAR.maxWars && !bound(ps, p, q) && rng.next() < MARRIAGE.war * bc) {
    const w = ps.wKind.length
    declare(s, ps, rel, q, p)
    R.sWars.push(w)
    R.diag.wars++
    logX(s, EventType.SuccessionWar, ps.pCapital[q], ps.pCapital[p], w, best)
  }
  return true
}

/** The ruler of q takes the throne of p too: a personal union (p bound to q as its vassal). */
function formUnion(s: HistoryState, ps: PolityState, R: RulerState, q: number, p: number): void {
  const rq = R.cur[q]
  const b0 = ps.bKind.length
  subject(s, ps, p, q, false)
  let bond = -1
  for (let k = ps.bKind.length - 1; k >= b0; k--) if (ps.bKind[k] === BondKind.Vassal && ps.bA[k] === p && ps.bB[k] === q) { bond = k; break }
  const u = R.uSenior.length
  R.uSenior.push(q); R.uJunior.push(p); R.uStart.push(s.year); R.uEnd.push(-1); R.uCause.push(UnionEnd.Ongoing); R.uBond.push(bond)
  R.uActive.push(u)
  R.union[p] = u
  R.hN[p] = 0
  const r = accede(s, ps, R, p, R.rBorn[rq], R.rFemale[rq], R.rDyn[rq], AccessionHow.Union, R.rParent[rq], rq, 0)
  R.uRuler.push(r)
  R.diag.unions++
  logX(s, EventType.UnionFormed, ps.pCapital[p], ps.pCapital[q], u, r)
}

/** After the succession at p (clean: the heir of the house without dispute): its junior realms follow the new ruler, or split. */
export function unionsOnSuccession(s: HistoryState, ps: PolityState, R: RulerState, p: number, clean: boolean): void {
  if (R.uActive.length === 0) return
  const list = R.uActive.slice()
  const rp = R.cur[p]
  for (const u of list) {
    if (R.uSenior[u] !== p) continue
    const j = R.uJunior[u]
    if (ps.pEnded[j] >= 0) continue
    const old = R.cur[j]
    const cause = R.rCause[R.rPred[rp] >= 0 ? R.rPred[rp] : rp]
    if (!clean || R.rDyn[rp] !== R.rDyn[old]) { split(s, ps, R, u, cause, AccessionHow.Elected); continue }
    endReign(s, ps, R, j, cause)
    R.hN[j] = 0
    accede(s, ps, R, j, R.rBorn[rp], R.rFemale[rp], R.rDyn[rp], AccessionHow.Inherited, R.rParent[rp], rp, 0)
  }
}

/** endPolity hook part: unions of p end with it (a senior's juniors break away; a junior absorbed by its senior merged). */
export function unionEnded(s: HistoryState, ps: PolityState, R: RulerState, p: number): void {
  if (R.uActive.length === 0) return
  const list = R.uActive.slice()
  for (const u of list) {
    if (R.uJunior[u] === p) {
      const k = R.uBond[u]
      closeUnion(s, ps, R, u, k >= 0 && ps.bCause[k] === BondEnd.Absorbed ? UnionEnd.Merged : UnionEnd.Ended)
    } else if (R.uSenior[u] === p) {
      const j = R.uJunior[u]
      closeUnion(s, ps, R, u, UnionEnd.Ended)
      if (ps.pEnded[j] >= 0) continue
      endReign(s, ps, R, j, R.rCause[R.cur[p]])
      newHouseAccede(s, ps, R, j, AccessionHow.Elected)
    }
  }
}

/** System part (every step): unions whose bond broke split; old unions merge into one realm. */
export function unionStep(s: HistoryState, ps: PolityState, R: RulerState): void {
  if (R.uActive.length === 0) return
  const list = R.uActive.slice()
  for (const u of list) {
    const j = R.uJunior[u], q = R.uSenior[u]
    if (ps.pEnded[j] >= 0 || ps.pEnded[q] >= 0) continue
    const k = R.uBond[u]
    if (k < 0 || ps.bEnd[k] >= 0) { split(s, ps, R, u, ReignEnd.Deposed, AccessionHow.Usurped); continue } // (thrown off: the junior's own house; its ruler deposed there)
    if (s.year - R.uStart[u] < MARRIAGE.mergeYears || ps.pWars[j] > 0 || ps.pWars[q] > 0) continue
    if (ps.pPeople[j] !== ps.pPeople[q] && !inContact(s, ps.pPeople[j], ps.pPeople[q])) continue
    merge(s, ps, R, u)
  }
}

/** Union u becomes one realm: the senior absorbs the junior. */
function merge(s: HistoryState, ps: PolityState, R: RulerState, u: number): void {
  const j = R.uJunior[u], q = R.uSenior[u]
  closeUnion(s, ps, R, u, UnionEnd.Merged)
  const k = R.uBond[u]
  if (k >= 0 && ps.bEnd[k] < 0) endBond(s, ps, k, BondEnd.Absorbed)
  const d = distAcross(s, ps, q, j)
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    if (ps.polity[id] !== j) continue
    setPolity(s, ps, id, q, d < FAR ? d + (ps.dist[id] < FAR ? ps.dist[id] : 0) : FAR)
    if (s.pop[id] >= TOWN_POPULATION) logEvent(s, EventType.Joined, id, ps.pCapital[q], q)
  }
  endPolity(s, ps, j, PolityEnd.Absorbed, ps.pCapital[q])
  controlOne(s, ps, q, ps.heap)
}
