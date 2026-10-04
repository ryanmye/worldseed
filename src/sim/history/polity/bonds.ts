// polities v2: bonds between polities (design 5, 6.5, 9.7): vassalage, tribute and alliances.
//
// Vassalage: a polity that lost a war to an attacker much stronger at its capital (advantage >= VASSAL.vassalAdv,
// and large or foreign), whose capital fell to a foreign conqueror while it was large (with chance VASSAL.fall, its
// rump), or that is overawed in peace by a neighbour overaweRatio times its size (its capital would submit), becomes a
// vassal instead of being annexed. It keeps its id and government, sends VASSAL.share of the grain tax its capital
// receives and of its capital's wealth income to the overlord's capital, trades duty-free with it and never fights it.
// A vassal is cheap to hold at a distance (its members do not thin the overlord's reach), so large loose empires
// become possible. It throws the bond off when the overlord's projection at its capital falls below its own mass
// (BecameVassal, extra 1), outlives an overlord that ends, and is absorbed after absorbYears if the overlord has grown
// absorb times stronger there. No chains: a polity that becomes a vassal hands its own vassals to its new overlord.
// Tribute: a lesser defeat (advantage tributeAdv..vassalAdv at peace) pays VASSAL.tribute for tributeYears.
// Alliances: two realms (Kingdoms or larger) that a third at least as large as each threatens (rivalry >= ALLIANCE.threat
// with both) and that do not threaten each other (< calm) ally (chance ALLIANCE.chance per slow step); an ally joins a
// defensive war with chance join; the bond lapses when the threat fades.
// Buffer states: attacking a small polity next to a rival of the attacker alarms that rival (rivalry + bufferR), which
// may take the victim under its protection (an alliance).

import { BondEnd, BondKind, EventType, TOWN_POPULATION } from '../../../contract.ts'
import type { EventType as EventTypeT } from '../../../contract.ts'
import { WEALTH } from '../params.ts'
import type { HistoryState } from '../state.ts'
import { logEvent } from '../state.ts'
import { distTo } from './control.ts'
import { atWar } from './formation.ts'
import { ALLIANCE, POLITY, RELATION, VASSAL } from './params.ts'
import { ensureRelation, relIdx, relationOf } from './relations.ts'
import { FAR, Tier, endPolity, grainShare, inContact, localOf, projAt, setPolity, tierOf } from './state.ts'
import type { PolityState } from './state.ts'
import { PolityEnd, PolityOrigin } from '../../../contract.ts'
import { tied, unionBond } from '../rulers/marriage.ts' // rulers:
import { MARRIAGE } from '../rulers/params.ts' // rulers:

function logX(s: HistoryState, type: EventTypeT, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

/** Graph cost from p's capital to q's capital across their border (FAR if they do not touch). */
export function distAcross(s: HistoryState, ps: PolityState, p: number, q: number): number {
  const capQ = ps.pCapital[q]
  let best = distTo(ps, p, capQ, s.abandoned)
  const r = relIdx(ps, p, q)
  if (r < 0) return best
  const e = ps.relEdges[r]
  for (let k = 0; k < e.length; k += 3) {
    const a = e[k], b = e[k + 1], c = e[k + 2]
    if (s.abandoned[a] >= 0 || s.abandoned[b] >= 0) continue
    const u = ps.polity[a] === p ? a : ps.polity[b] === p ? b : -1
    const v = u === a ? b : a
    if (u < 0 || ps.polity[v] !== q || !(ps.dist[u] < FAR) || !(ps.dist[v] < FAR)) continue
    const d = ps.dist[u] + c + ps.dist[v]
    if (d < best) best = d
  }
  return best
}

/** Advantage of p at q's capital: Proj_p there over q's own defence there (its mass, or its capital's Local). */
export function advantageAt(s: HistoryState, ps: PolityState, p: number, q: number): number {
  const d = distAcross(s, ps, p, q)
  if (!(d < FAR)) return 0
  const cap = ps.pCapital[q]
  const l = localOf(s, ps, cap)
  const def = ps.pMass[q] > l ? ps.pMass[q] : l
  return projAt(ps, p, d) / (def + 1e-9)
}

/** Overlord of p (or the recipient of its tribute), -1. */
export function overlordOf(ps: PolityState, p: number): number {
  const k = ps.pSub[p]
  return k >= 0 ? ps.bB[k] : -1
}

/** Vassals (and tributaries) of p, in bond order. */
function subjectsOf(ps: PolityState, p: number): number[] {
  const out: number[] = []
  for (const k of ps.activeBonds) if (ps.bKind[k] !== BondKind.Alliance && ps.bB[k] === p) out.push(k)
  return out
}

function newBond(s: HistoryState, ps: PolityState, kind: number, a: number, b: number, until: number, threat: number): number {
  const k = ps.bKind.length
  ps.bKind.push(kind); ps.bA.push(a); ps.bB.push(b); ps.bStart.push(s.year); ps.bEnd.push(-1); ps.bCause.push(BondEnd.Ongoing)
  ps.bUntil.push(until); ps.bThreat.push(threat)
  ps.activeBonds.push(k)
  if (kind !== BondKind.Alliance) ps.pSub[a] = k
  return k
}

/** Ends bond k this year. */
export function endBond(s: HistoryState, ps: PolityState, k: number, cause: number): void {
  if (ps.bEnd[k] >= 0) return
  ps.bEnd[k] = s.year
  ps.bCause[k] = cause
  const i = ps.activeBonds.indexOf(k)
  if (i >= 0) ps.activeBonds.splice(i, 1)
  if (ps.bKind[k] !== BondKind.Alliance && ps.pSub[ps.bA[k]] === k) ps.pSub[ps.bA[k]] = -1
  if (cause === BondEnd.Freed) logX(s, EventType.BecameVassal, ps.pCapital[ps.bA[k]], ps.pCapital[ps.bB[k]], ps.bB[k] + (ps.bKind[k] === BondKind.Tribute ? 1000 : 0), 1)
}

/** Polity a becomes the vassal (tribute: tributary for a term) of b; its own subjects pass to b. */
export function subject(s: HistoryState, ps: PolityState, a: number, b: number, tribute: boolean): void {
  if (a === b || ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0) return
  const top = overlordOf(ps, b)
  if (top >= 0) b = top // (no chains: bow to the overlord's overlord)
  if (a === b) return
  if (ps.pSub[a] >= 0) endBond(s, ps, ps.pSub[a], BondEnd.Ended)
  for (const k of subjectsOf(ps, a)) {
    const x = ps.bA[k], kind = ps.bKind[k], until = ps.bUntil[k]
    endBond(s, ps, k, BondEnd.Ended)
    if (x !== b) newBond(s, ps, kind, x, b, until, -1)
  }
  // Allies of one another no more.
  for (let i = ps.activeBonds.length - 1; i >= 0; i--) {
    const k = ps.activeBonds[i]
    if (ps.bKind[k] === BondKind.Alliance && ((ps.bA[k] === a && ps.bB[k] === b) || (ps.bA[k] === b && ps.bB[k] === a))) endBond(s, ps, k, BondEnd.Ended)
  }
  newBond(s, ps, tribute ? BondKind.Tribute : BondKind.Vassal, a, b, tribute ? s.year + VASSAL.tributeYears : -1, -1)
  if (tribute) ps.diag.tributes++
  else ps.diag.vassals++
  logX(s, EventType.BecameVassal, ps.pCapital[a], ps.pCapital[b], b + (tribute ? 1000 : 0), 0)
}

/** True when p and q are allies. */
export function allied(ps: PolityState, p: number, q: number): boolean {
  for (const k of ps.activeBonds) if (ps.bKind[k] === BondKind.Alliance && ((ps.bA[k] === p && ps.bB[k] === q) || (ps.bA[k] === q && ps.bB[k] === p))) return true
  return false
}

/** Allies of p (and its overlord, which protects it), in bond order. */
export function protectorsOf(ps: PolityState, p: number): number[] {
  const out: number[] = []
  for (const k of ps.activeBonds) {
    if (ps.bKind[k] === BondKind.Alliance) { if (ps.bA[k] === p) out.push(ps.bB[k]); else if (ps.bB[k] === p) out.push(ps.bA[k]) }
    else if (ps.bKind[k] === BondKind.Vassal && ps.bA[k] === p) out.push(ps.bB[k])
  }
  return out
}

/** Terms at peace after a war of conquest that the attacker p did not finish: vassalage or tribute; returns the outcome to record (or `outcome`). */
export function peaceTerms(s: HistoryState, ps: PolityState, p: number, q: number, outcome: number, vassalage: number, tribute: number): number {
  if (ps.pEnded[p] >= 0 || ps.pEnded[q] >= 0 || ps.pSub[p] >= 0 || overlordOf(ps, q) === p) return outcome
  const adv = advantageAt(s, ps, p, q)
  if (adv >= VASSAL.vassalAdv && (ps.pMembers[q] >= VASSAL.vassalMembers || ps.pPeople[q] !== ps.pPeople[p])) { subject(s, ps, q, p, false); return vassalage }
  if (adv >= VASSAL.tributeAdv && ps.pSub[q] < 0) { subject(s, ps, q, p, true); return tribute }
  return outcome
}

/** System part (every slow step, after absorption): large realms overawed by a far larger neighbour become its vassals. */
export function overawe(s: HistoryState, ps: PolityState): void {
  const P = POLITY
  const alive = ps.alive.slice() // (member lists from absorption, just before: stale members are skipped)
  for (const p of alive) {
    if (ps.pEnded[p] >= 0 || ps.pMembers[p] < P.absorbMembers || ps.pWars[p] > 0 || ps.pSub[p] >= 0 || ps.pOrigin[p] === PolityOrigin.League) continue
    const c = ps.pCapital[p]
    let best = -1, bestR = 0
    const m0 = ps.memOff[p], m1 = ps.memOff[p + 1]
    const tried: number[] = []
    for (let k = m0; k < m1; k++) {
      const m = ps.memList[k]
      if (ps.polity[m] !== p) continue
      const mn = ps.gNb[m]
      if (!mn) continue
      for (let e = 0; e < mn.length; e++) {
        let q = ps.polity[mn[e]]
        if (q < 0 || q === p || tried.indexOf(q) >= 0) continue
        tried.push(q)
        if (ps.pSub[q] >= 0) q = overlordOf(ps, q)
        if (q === p || ps.pPop[q] < VASSAL.overaweRatio * ps.pPop[p] || ps.pWars[q] > 0 || atWar(ps, p, q) || !inContact(s, ps.pPeople[q], ps.pPeople[p])) continue
        const d = distAcross(s, ps, q, p)
        if (!(d < FAR)) continue
        const foreign = ps.pPeople[q] !== ps.pPeople[p] ? 1 + P.foreign : 1
        const lc = localOf(s, ps, c)
        const def = ps.pMass[p] > lc ? ps.pMass[p] : lc
        const ratio = (projAt(ps, q, d) * (P.subBase + (1 - P.subBase) * grainShare(s, c))) / (VASSAL.overawe * def * foreign + 1e-9)
        if (ratio >= 1 && ratio > bestR) { best = q; bestR = ratio }
      }
    }
    if (best >= 0) subject(s, ps, p, best, false)
  }
}

/** System part (every step): vassals throw off the bond or are absorbed, tribute lapses, bonds of ended polities end, alliances lapse. */
export function bondStep(s: HistoryState, ps: PolityState): void {
  const list = ps.activeBonds.slice()
  for (const k of list) {
    if (ps.bEnd[k] >= 0) continue
    const a = ps.bA[k], b = ps.bB[k]
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0) { endBond(s, ps, k, BondEnd.Ended); continue }
    const kind = ps.bKind[k]
    if (kind === BondKind.Tribute) { if (s.year >= ps.bUntil[k]) endBond(s, ps, k, BondEnd.Lapsed); continue }
    if (kind === BondKind.Alliance) {
      const c = ps.bThreat[k]
      if (atWar(ps, a, b) || c < 0 || ps.pEnded[c] >= 0 || (relationOf(ps, a, c) < ALLIANCE.lapse && relationOf(ps, b, c) < ALLIANCE.lapse)) endBond(s, ps, k, BondEnd.Lapsed)
      continue
    }
    // Vassal a of b.
    if (s.rul !== null && unionBond(s.rul, k)) continue // rulers: a personal union holds by its ruler, not by force (rulers/marriage.ts)
    const d = distAcross(s, ps, b, a)
    const proj = d < FAR ? projAt(ps, b, d) : 0
    const m = ps.pMass[a]
    if (proj < VASSAL.rebel * m) {
      endBond(s, ps, k, BondEnd.Freed)
      const r = ensureRelation(ps, a, b)
      if (ps.relR[r] < RELATION.secedeR) ps.relR[r] = RELATION.secedeR
      continue
    }
    if (s.year - ps.bStart[k] >= VASSAL.absorbYears && proj >= VASSAL.absorb * m && ps.pWars[a] === 0) absorbVassal(s, ps, k, a, b, d)
  }
}

/** The overlord b takes its vassal a in whole. */
function absorbVassal(s: HistoryState, ps: PolityState, k: number, a: number, b: number, d: number): void {
  endBond(s, ps, k, BondEnd.Absorbed)
  for (const j of subjectsOf(ps, a)) endBond(s, ps, j, BondEnd.Ended)
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    if (ps.polity[id] !== a) continue
    setPolity(s, ps, id, b, d + (ps.dist[id] < FAR ? ps.dist[id] : 0))
    if (s.pop[id] >= TOWN_POPULATION) logEvent(s, EventType.Joined, id, ps.pCapital[b], b)
  }
  ps.diag.absorbed++
  endPolity(s, ps, a, PolityEnd.Absorbed, ps.pCapital[b])
}

/** System part (every slow step, after rivalry): polities threatened by a common rival ally. */
export function allianceStep(s: HistoryState, ps: PolityState): void {
  const X = ALLIANCE
  const R = ps.relA.length
  const hostA: number[] = [], hostB: number[] = []
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0 || ps.relR[r] < X.threat) continue
    hostA.push(a); hostB.push(b)
  }
  const H = hostA.length
  for (let i = 0; i < H; i++) {
    for (let j = i + 1; j < H; j++) {
      // A common rival c of x and y.
      let c = -1, x = -1, y = -1
      if (hostA[i] === hostA[j]) { c = hostA[i]; x = hostB[i]; y = hostB[j] }
      else if (hostA[i] === hostB[j]) { c = hostA[i]; x = hostB[i]; y = hostA[j] }
      else if (hostB[i] === hostA[j]) { c = hostB[i]; x = hostA[i]; y = hostB[j] }
      else if (hostB[i] === hostB[j]) { c = hostB[i]; x = hostA[i]; y = hostA[j] }
      if (c < 0 || x === y) continue
      if (ps.pEnded[x] >= 0 || ps.pEnded[y] >= 0 || relationOf(ps, x, y) >= X.calm || atWar(ps, x, y) || allied(ps, x, y)) continue
      if (overlordOf(ps, x) === y || overlordOf(ps, y) === x || !inContact(s, ps.pPeople[x], ps.pPeople[y])) continue
      if (alliances(ps, x) >= 2 || alliances(ps, y) >= 2) continue
      // (realms against a rival at least as large as each)
      if (tierOf(ps.pPop[x], ps.pMembers[x], ps.pMulti[x] === 1, ps.worldPop) < Tier.Kingdom || tierOf(ps.pPop[y], ps.pMembers[y], ps.pMulti[y] === 1, ps.worldPop) < Tier.Kingdom) continue
      if (ps.pPop[c] < ps.pPop[x] || ps.pPop[c] < ps.pPop[y] || ps.rng.next() >= X.chance * (s.rul !== null && tied(s.rul, x, y) ? MARRIAGE.alliance : 1)) continue // (rulers: houses tied by marriage ally more readily)
      ally(s, ps, x < y ? x : y, x < y ? y : x, c)
    }
  }
}

function alliances(ps: PolityState, p: number): number {
  let n = 0
  for (const k of ps.activeBonds) if (ps.bKind[k] === BondKind.Alliance && (ps.bA[k] === p || ps.bB[k] === p)) n++
  return n
}

/** p and q ally against c. */
export function ally(s: HistoryState, ps: PolityState, p: number, q: number, c: number): void {
  newBond(s, ps, BondKind.Alliance, p, q, -1, c)
  ps.diag.alliances++
  logX(s, EventType.Alliance, ps.pCapital[p], ps.pCapital[q], q, c)
}

/**
 * Tax system hook: vassals and tributaries send their share of what their capitals took in (food in inFood, and
 * wealth) to their overlords' capitals.
 */
export function tributeFlows(s: HistoryState, ps: PolityState, inFood: Float64Array): void {
  for (const k of ps.activeBonds) {
    const kind = ps.bKind[k]
    if (kind === BondKind.Alliance) continue
    const a = ps.bA[k], b = ps.bB[k]
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0) continue
    const ca = ps.pCapital[a], cb = ps.pCapital[b]
    if (s.abandoned[ca] >= 0 || s.abandoned[cb] >= 0) continue
    const share = kind === BondKind.Vassal ? VASSAL.share : VASSAL.tribute
    const x = share * inFood[ca]
    if (x > 0) { inFood[ca] -= x; inFood[cb] += x }
    const w = share * WEALTH.decay * s.wealth[ca]
    s.wealth[ca] -= w
    s.wealth[cb] += w
    ps.pRevYear[b] += w // (counts as the overlord's revenue)
  }
}

/** Buffer states (declare): the attack of p on a small q alarms q's other neighbours that are p's rivals; one may take q under its protection. */
export function bufferAlarm(s: HistoryState, ps: PolityState, p: number, q: number, roll: () => number): void {
  if (ps.pPop[q] >= ALLIANCE.buffer * ps.pPop[p]) return
  const R = ps.relA.length
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (a !== q && b !== q) continue
    const c = a === q ? b : a
    if (c === p || ps.pEnded[c] >= 0 || ps.relEdges[r].length === 0) continue
    const rc = relIdx(ps, c, p)
    if (rc < 0 || ps.relR[rc] < ALLIANCE.threat) continue
    ps.relR[rc] = ps.relR[rc] + ALLIANCE.bufferR > 2 ? 2 : ps.relR[rc] + ALLIANCE.bufferR
    if (!allied(ps, c, q) && overlordOf(ps, q) < 0 && alliances(ps, c) < 2 && roll() < ALLIANCE.join) ally(s, ps, c < q ? c : q, c < q ? q : c, p)
  }
}
