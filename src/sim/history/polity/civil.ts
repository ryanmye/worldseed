// polities v2: civil war, partition and reunification (design 8.4).
//
// Rival centre: a member of at least CIVIL.rivalRatio times the capital's people / (1 + members / sizeRef) (and
// rivalPop) at least rivalDist * lambda from it, the largest such. When a succession crisis opens in a realm of
// minMembers or more with a rival centre, civil war breaks out with chance CIVIL.crisis * (1 + members / sizeCrisis)
// (great realms split more readily); in a realm whose cohesion fell below lowA, with chance lowChance * (1 - A / lowA)
// a step. Sides: a second control search from the rival centre; member j sides with it when
//   g(d_rival(j)) * aff_rival(j) > g(d_capital(j)) * aff_capital(j),   aff = 1.3 [the centre's people] * 1.2 [an open route to it]
// The pretender's side becomes a new polity (origin CivilWar, parent the realm) at war with it at once (WarKind
// CivilWar, logged CivilWar). The side that takes the other's capital takes back every member that submits at
// CIVIL.alpha (Reunified; the loser ends Reunified); a peace leaves the realm divided (two successor states sharing the
// parent), and revolts in the weakened halves may break them further.
// Partition: otherwise, when the crisis hits a Kingdom or Empire with heirs (members of heirRatio times the capital's
// people, heirPop, far enough), chance CIVIL.partition: the realm is divided among the capital and its 1-2 largest
// heirs by nearest seat on the settlement graph; each heir's share of two or more settlements and POLITY.minState
// people is a new polity (origin Partition, Seceded), the capital's share keeps the old one (Partitioned).
// Reunification of kin (every slow step): of two adjacent polities of one lineage (same root ancestor) and ruling
// people at peace, the one kinRatio times larger brings the other back (chance kinChance) when its projection at the
// other's capital beats alphaKin times its defence (Reunified; the other ends Reunified).

import { EventType, PolityEnd, PolityOrigin, WarKind } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { logEvent } from '../state.ts'
import type { TradeState } from '../trade.ts'
import { controlOne } from './control.ts'
import { CIVIL, POLITY, RELATION, WAR } from './params.ts'
import { membersOf } from './realm.ts'
import { ensureRelation } from './relations.ts'
import { FAR, clampAsab, endPolity, grainShare, grip, localOf, newPolity, projAt, setPolity, tierOf, Tier } from './state.ts'
import type { PolityState } from './state.ts'
import { declare } from './war.ts'
import { distAcross, overlordOf } from './bonds.ts'

const KEY = 1 << 20

/** The rival centre of polity p (largest qualifying member), or -1. */
export function rivalCentre(s: HistoryState, ps: PolityState, p: number, members: readonly number[]): number {
  const cap = ps.pCapital[p]
  const lam = ps.pReach[p]
  // (a large realm has many provincial seats a pretender can rise from: the bar falls with its size)
  const bar = (CIVIL.rivalRatio * s.pop[cap]) / (1 + ps.pMembers[p] / CIVIL.sizeRef)
  const need = bar > CIVIL.rivalPop ? bar : CIVIL.rivalPop
  let best = -1
  for (const m of members) {
    if (m === cap || ps.polity[m] !== p || s.pop[m] < need || !(ps.dist[m] < FAR) || ps.dist[m] < CIVIL.rivalDist * lam) continue
    if (best < 0 || s.pop[m] > s.pop[best]) best = m
  }
  return best
}

/** Multi-source search from `seats` over p's members: nearest seat index per member (in scratchI) and its cost (ringDist). */
function seatSearch(ps: PolityState, p: number, members: readonly number[], seats: readonly number[]): void {
  const { stamp, ringDist: dist, scratchI: owner, heap } = ps
  const run = ++ps.run
  for (const m of members) { stamp[m] = run; dist[m] = FAR; owner[m] = -1 }
  heap.size = 0
  for (let i = 0; i < seats.length; i++) { const c = seats[i]; dist[c] = 0; owner[c] = i; heap.push(0, c) }
  while (heap.size > 0) {
    const d = heap.topKey()
    const u = heap.pop()
    if (d > dist[u]) continue
    const nb = ps.gNb[u], co = ps.gCost[u]
    if (!nb) continue
    for (let k = 0; k < nb.length; k++) {
      const v = nb[k]
      if (stamp[v] !== run || ps.polity[v] !== p) continue
      const nd = d + co[k]
      if (nd < dist[v]) { dist[v] = nd; owner[v] = owner[u]; heap.push(nd, v) }
    }
  }
}

function openRoute(ts: TradeState, a: number, b: number): boolean {
  const lo = a < b ? a : b, hi = a < b ? b : a
  const r = ts.routeIndex.get(lo * KEY + hi)
  return r !== undefined && ts.rOpen[r] === 1
}

/** Civil war in p: the rival centre r and the members on its side rise as a new polity, at war with p at once. */
export function civilWar(s: HistoryState, ps: PolityState, ts: TradeState, p: number, r: number, members: readonly number[]): boolean {
  const cap = ps.pCapital[p]
  const lam = ps.pReach[p]
  // Cost from the rival centre over the members (the capital's is in dist from the control pass).
  seatSearch(ps, p, members, [r])
  const dR = ps.ringDist
  const side: number[] = [r]
  let pop = s.pop[r]
  const pr = s.people[r], pc = s.people[cap]
  for (const j of members) {
    if (j === cap || j === r || ps.polity[j] !== p) continue
    const gc = (ps.dist[j] < FAR ? grip(ps.dist[j], lam) : 0) * (s.people[j] === pc ? CIVIL.sameFolk : 1) * (openRoute(ts, j, cap) ? CIVIL.route : 1)
    const gr = (dR[j] < FAR ? grip(dR[j], lam) : 0) * (s.people[j] === pr ? CIVIL.sameFolk : 1) * (openRoute(ts, j, r) ? CIVIL.route : 1)
    if (gr > gc) { side.push(j); pop += s.pop[j] }
  }
  if (side.length < 2 || pop < POLITY.minState || side.length >= members.length - 1) return false
  for (const j of side) setPolity(s, ps, j, -1, FAR)
  const q = newPolity(s, ps, r, PolityOrigin.CivilWar, p)
  for (const j of side) if (j !== r) setPolity(s, ps, j, q, FAR)
  for (const j of side) { ps.asab[j] = clampAsab(ps.asab[j] + POLITY.foundAsab); ps.unrest[j] = 0 }
  controlOne(s, ps, q, ps.heap)
  controlOne(s, ps, p, ps.heap)
  const rel = ensureRelation(ps, p, q)
  ps.relR[rel] = RELATION.secedeR
  ps.relTruce[rel] = s.year
  declare(s, ps, rel, q, p, WarKind.CivilWar)
  ps.diag.civilWars++
  return true
}

/** Partition of p among its capital and its 1-2 largest heirs. */
export function partition(s: HistoryState, ps: PolityState, p: number, members: readonly number[]): boolean {
  const cap = ps.pCapital[p]
  const lam = ps.pReach[p]
  const need = CIVIL.heirRatio * s.pop[cap] > CIVIL.heirPop ? CIVIL.heirRatio * s.pop[cap] : CIVIL.heirPop
  const heirs: number[] = []
  for (const m of members) {
    if (m === cap || ps.polity[m] !== p || s.pop[m] < need || !(ps.dist[m] < FAR) || ps.dist[m] < CIVIL.rivalDist * lam) continue
    heirs.push(m)
  }
  if (heirs.length === 0) return false
  heirs.sort((a, b) => s.pop[b] - s.pop[a] || a - b)
  if (heirs.length > 2) heirs.length = 2
  const seats = [cap, ...heirs]
  seatSearch(ps, p, members, seats)
  const owner = ps.scratchI
  const groups: number[][] = seats.map(() => [])
  for (const m of members) if (ps.polity[m] === p && owner[m] > 0) groups[owner[m]].push(m)
  let made = 0
  for (let i = 1; i < seats.length; i++) {
    const g = groups[i]
    let pop = 0
    for (const j of g) pop += s.pop[j]
    if (g.length < 2 || pop < POLITY.minState) continue
    if (made === 0) logEvent(s, EventType.Partitioned, cap, -1, p)
    for (const j of g) setPolity(s, ps, j, -1, FAR)
    const q = newPolity(s, ps, seats[i], PolityOrigin.Partition, p)
    for (const j of g) if (j !== seats[i]) setPolity(s, ps, j, q, FAR)
    for (const j of g) ps.unrest[j] = 0
    controlOne(s, ps, q, ps.heap)
    const rel = ensureRelation(ps, p, q)
    ps.relR[rel] = 0.3
    ps.relTruce[rel] = s.year + WAR.truce
    logEvent(s, EventType.Seceded, seats[i], cap, q)
    made++
  }
  if (made === 0) return false
  controlOne(s, ps, p, ps.heap)
  ps.diag.partitions++
  return true
}

/** At the opening of a succession crisis in p: civil war or partition, perhaps. */
export function crisisOpened(s: HistoryState, ps: PolityState, ts: TradeState, p: number): void {
  if (ps.pMembers[p] < CIVIL.minMembers || ps.pSub[p] >= 0) return
  const rng = ps.rng
  const members = membersOf(s, ps, p)
  const r = rivalCentre(s, ps, p, members)
  if (r >= 0 && rng.next() < CIVIL.crisis * (1 + ps.pMembers[p] / CIVIL.sizeCrisis)) { civilWar(s, ps, ts, p, r, members); return }
  if (tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1) >= Tier.Kingdom && rng.next() < CIVIL.partition) partition(s, ps, p, members)
}

/** Every step: a realm whose cohesion is low may fall into civil war without a crisis. */
export function lowCohesion(s: HistoryState, ps: PolityState, ts: TradeState, p: number): void {
  const A = ps.pAsab[p]
  if (A >= CIVIL.lowA || ps.pMembers[p] < CIVIL.minMembers || ps.pSub[p] >= 0) return
  if (ps.rng.next() >= POLITY.step * CIVIL.lowChance * (1 - A / CIVIL.lowA)) return
  const members = membersOf(s, ps, p)
  const r = rivalCentre(s, ps, p, members)
  if (r >= 0) civilWar(s, ps, ts, p, r, members)
}

/** Root ancestor of polity p. */
function rootOf(ps: PolityState, p: number): number {
  let x = p
  while (ps.pParent[x] >= 0) x = ps.pParent[x]
  return x
}

/** System part (every slow step): kindred successor states are brought back by the stronger. */
export function kinStep(s: HistoryState, ps: PolityState): void {
  const R = ps.relA.length
  const rng = ps.rng
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0 || ps.relWar[r] >= 0 || ps.relEdges[r].length === 0) continue
    if (ps.pPeople[a] !== ps.pPeople[b] || rootOf(ps, a) !== rootOf(ps, b)) continue
    const x = ps.pPop[a] >= ps.pPop[b] ? a : b, y = x === a ? b : a
    if (ps.pPop[x] < CIVIL.kinRatio * ps.pPop[y] || ps.pWars[x] > 0 || ps.pWars[y] > 0 || ps.pSub[x] >= 0 || overlordOf(ps, y) >= 0) continue
    const d = distAcross(s, ps, x, y)
    if (!(d < FAR)) continue
    const capY = ps.pCapital[y]
    const l = localOf(s, ps, capY)
    const def = ps.pMass[y] > l ? ps.pMass[y] : l
    if (projAt(ps, x, d) * (POLITY.subBase + (1 - POLITY.subBase) * grainShare(s, capY)) < CIVIL.alphaKin * def) continue
    if (rng.next() >= CIVIL.kinChance) continue
    reunify(s, ps, x, y, d)
  }
}

/** Polity x takes back the whole of kindred polity y (its members at graph cost d plus theirs from y's capital). */
export function reunify(s: HistoryState, ps: PolityState, x: number, y: number, d: number): void {
  const capY = ps.pCapital[y]
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    if (ps.polity[id] === y) setPolity(s, ps, id, x, d + (ps.dist[id] < FAR ? ps.dist[id] : 0))
  }
  logEvent(s, EventType.Reunified, ps.pCapital[x], capY, y)
  ps.diag.reunified++
  endPolity(s, ps, y, PolityEnd.Reunified, ps.pCapital[x])
}
