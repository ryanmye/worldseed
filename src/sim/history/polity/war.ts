// polities: war and raids (design 6; no tribute, vassals, blockades or civil wars in v1).
//
// Declaration (every step, per pair with no war or truce, both ways, 'history-war'):
//   adv   = Proj_p(front) / Proj_q(front), front = q's member on the border most exposed to p
//   drive = smoothstep(0.6, 1.2, R) * smoothstep(1, 2, adv) * (q in crisis ? 2 : 1) * (1 - E_p)
//   chance = step * WAR.declare * drive
// Wars are opportunistic: the stronger attack the weak, the exhausted and the leaderless.
//
// Campaign (yearly per war): one front a year, the target v on the border that the attacker can
// strike hardest relative to its defence:
//   A = Proj_p(v) * supply,   D = Proj_q(v) * T_v * (1 + wall_v) + Local_v,   win = A^2 / (A^2 + D^2)
// Both sides lose WAR.battle of the front settlements' people; the target's fields are ravaged and its
// danger spikes. A win moves v to the attacker (Conquered), perhaps sacked. A walled town or a capital
// is besieged: each failed year improves the besiegers' odds (attrition). When the defender's capital
// falls, its members submit to the conqueror if the shock is enough; the rest keep a rump state under
// a new capital, or, if too few, split into successor states or go stateless. A defender stronger on
// its own front counterattacks. An army journey (JourneyKind.Army) marks each campaign.
// Exhaustion grows with war-years and deaths; peace comes when either side is exhausted, the
// defender is gone, or by chance after a few years: a truce follows and rivalry halves.
//
// Raids (every step, 'history-polities'): any settlement may raid a neighbour of another polity, or a
// stateless neighbour of another people (stateless raiders too): chance step * 0.004 * drive,
//   drive = 2 (1 - food) + max(0, prosperity_v - prosperity_u) + R + 0.5 horse + 0.5 [herders]
// success L_u^2 / (L_u^2 + D_v^2): the raiders take a fifth of the target's wealth and a hundredth of
// its people; a failed raid costs the raiders. Raids on settlements of WAR.raidLog or more are logged.

import { EventType, JourneyKind, PolityEnd, PolityOrigin, WarKind, WarOutcome } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import { logEvent, logJourney, loseStructure } from '../state.ts'
import { prosperity } from '../migration.ts'
import { controlOne, distTo } from './control.ts'
import { loseWalls, spike } from './danger.ts'
import { COHESION, POLITY, WAR } from './params.ts'
import { chooseCapital, membersOf, successors } from './realm.ts'
import { relationOf } from './relations.ts'
import { FAR, clampAsab, endPolity, horseOf, inCrisis, isCapital, localOf, moveCapital, projAt, setPolity, submits, wallFactor } from './state.ts'
import type { PolityState } from './state.ts'

// --- Declarations ------------------------------------------------------------------------------------

/** Best front of attacker p against q over the pair's border edges: sets frontU / frontV / frontD and returns Proj_p / Local at v (0 if none). */
let frontU = -1, frontV = -1, frontD = 0
function exposedFront(s: HistoryState, ps: PolityState, edges: readonly number[], p: number, q: number): number {
  let best = 0
  frontU = -1; frontV = -1
  for (let k = 0; k < edges.length; k += 3) {
    const a = edges[k], b = edges[k + 1], c = edges[k + 2]
    const u = ps.polity[a] === p ? a : b, v = u === a ? b : a
    if (ps.polity[u] !== p || ps.polity[v] !== q) continue
    const d = ps.dist[u] + c
    const r = projAt(ps, p, d) / (localOf(s, ps, v) + 1e-9)
    if (r > best) { best = r; frontU = u; frontV = v; frontD = d }
  }
  return best
}

/** System part (every step): rivals declare war. */
export function declarations(s: HistoryState, ps: PolityState): void {
  const rng = ps.rngWar
  const R = ps.relA.length
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0 || ps.relWar[r] >= 0 || s.year < ps.relTruce[r]) continue
    const rv = smoothstep(WAR.rLow, WAR.rHigh, ps.relR[r])
    if (rv <= 0 || ps.relEdges[r].length === 0) continue
    for (let dir = 0; dir < 2; dir++) {
      const p = dir === 0 ? a : b, q = dir === 0 ? b : a
      if (ps.pWars[p] >= WAR.maxWars || ps.relWar[r] >= 0) continue
      if (exposedFront(s, ps, ps.relEdges[r], p, q) <= 0) continue
      const pq = projAt(ps, q, ps.dist[frontV])
      const adv = projAt(ps, p, frontD) / (pq + 1e-9)
      let e = ps.pExh[p]
      if (e > 1) e = 1
      const drive = rv * smoothstep(WAR.advLow, WAR.advHigh, adv) * (inCrisis(s, ps, q) ? WAR.crisisMul : 1) * (1 - e)
      if (drive <= 0) continue
      if (rng.next() >= POLITY.step * WAR.declare * drive) continue
      declare(s, ps, r, p, q)
    }
  }
}

function declare(s: HistoryState, ps: PolityState, r: number, p: number, q: number): void {
  const w = ps.wKind.length
  ps.wKind.push(WarKind.Conquest)
  ps.wAtt.push(p); ps.wDef.push(q)
  ps.wStart.push(s.year); ps.wEnd.push(-1); ps.wOutcome.push(WarOutcome.Ongoing)
  ps.wTaken.push(0); ps.wRetaken.push(0); ps.wDead.push(0)
  ps.wSiege.push(-1); ps.wSiegeYears.push(0); ps.wSiegeFrom.push(-1)
  ps.activeWars.push(w)
  ps.relWar[r] = w
  ps.pWars[p]++
  ps.pWars[q]++
  logEvent(s, EventType.WarDeclared, ps.pCapital[p], ps.pCapital[q], w)
}

// --- Campaigns -----------------------------------------------------------------------------------------

/** Ends war w this year with the given outcome. */
function closeWar(s: HistoryState, ps: PolityState, w: number, outcome: number): void {
  const p = ps.wAtt[w], q = ps.wDef[w]
  ps.wEnd[w] = s.year
  ps.wOutcome[w] = outcome
  const i = ps.activeWars.indexOf(w)
  if (i >= 0) ps.activeWars.splice(i, 1)
  const lo = p < q ? p : q, hi = p < q ? q : p
  const r = ps.relIndex.get(lo * 65536 + hi)
  if (r !== undefined) {
    ps.relWar[r] = -1
    ps.relTruce[r] = s.year + WAR.truce
    ps.relR[r] *= WAR.peaceR
    ps.relLastWar[r] = s.year
  }
  ps.pWars[p]--
  ps.pWars[q]--
  const sg = ps.wSiege[w]
  if (sg >= 0 && s.abandoned[sg] < 0 && ps.polity[sg] === q) logEvent(s, EventType.SiegeLifted, sg, ps.wSiegeFrom[w], w)
  ps.wSiege[w] = -1
  // The winners' cohesion rises.
  const winner = outcome === WarOutcome.AttackerGains || outcome === WarOutcome.Conquest ? p : outcome === WarOutcome.DefenderGains ? q : -1
  if (winner >= 0 && ps.pEnded[winner] < 0) {
    const living = s.living
    for (let t = 0; t < living.length; t++) { const id = living[t]; if (ps.polity[id] === winner) ps.asab[id] = clampAsab(ps.asab[id] + COHESION.warWon) }
  }
  logEvent(s, EventType.PeaceMade, ps.pCapital[p], ps.pCapital[q], w)
}

/** A cosmetic army journey from u to v (a bounded cell search), arriving this year. */
function armyJourney(s: HistoryState, ps: PolityState, u: number, v: number, edgeCost: number, mass: number): void {
  const T = s.terrain
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const { aDist, aPrev, aStamp, aHeap: heap } = ps
  const run = ++ps.aRun
  const o = s.cell[u], t = s.cell[v]
  const budget = WAR.pathBudget * (edgeCost > 2 * T.cellScale ? edgeCost : 2 * T.cellScale)
  heap.size = 0
  aStamp[o] = run; aDist[o] = 0; aPrev[o] = -1
  heap.push(0, o)
  let found = false, visits = 0
  while (heap.size > 0 && visits < 4000) {
    const d = heap.topKey()
    const c = heap.pop()
    if (d > aDist[c]) continue
    visits++
    if (c === t) { found = true; break }
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      const step = T.sea[j] ? (T.deep[j] ? 3 * T.cellScale : T.moveCost[j]) : s.moveCost[j]
      const nd = d + step
      if (nd > budget) continue
      if (aStamp[j] === run && nd >= aDist[j]) continue
      aStamp[j] = run; aDist[j] = nd; aPrev[j] = c
      heap.push(nd, j)
    }
  }
  if (!found) return
  const path: number[] = []
  for (let c = t; c >= 0; c = aPrev[c]) path.push(c)
  path.reverse()
  let size = WAR.army * mass
  if (size < WAR.armyMin) size = WAR.armyMin
  if (size > WAR.armyMax) size = WAR.armyMax
  const arrive = s.year
  let years = 0.2 + 0.02 * path.length
  if (years > 0.9) years = 0.9
  let depart = arrive - years
  if (depart < s.founded[u]) depart = s.founded[u]
  logJourney(s, { departYear: depart, arriveYear: arrive, from: u, to: v, size, kind: JourneyKind.Army, path })
}

/** Odds of a strike by p from u on q's v at graph cost d: A and D. */
let strikeA = 0, strikeD = 0
function strike(s: HistoryState, ps: PolityState, p: number, q: number, u: number, v: number, d: number): number {
  strikeA = projAt(ps, p, d) / (1 + 0.5 * ps.ravage[u])
  const cap = isCapital(ps, v)
  strikeD = projAt(ps, q, ps.dist[v]) * ps.defense[s.cell[v]] * wallFactor(ps, v, cap) + localOf(s, ps, v)
  return strikeA / (strikeD + 1e-9)
}

/** Best front of p against q this year (current membership): sets frontU / frontV / frontD; returns A / D (0 if none). */
function campaignFront(s: HistoryState, ps: PolityState, p: number, q: number, defenders: readonly number[]): number {
  let best = 0
  frontU = -1; frontV = -1
  for (const v of defenders) {
    if (ps.polity[v] !== q) continue
    const nb = ps.gNb[v], co = ps.gCost[v]
    if (!nb) continue
    for (let k = 0; k < nb.length; k++) {
      const u = nb[k]
      if (ps.polity[u] !== p || s.abandoned[u] >= 0) continue
      const d = ps.dist[u] + co[k]
      const r = strike(s, ps, p, q, u, v, d)
      if (r > best) { best = r; frontU = u; frontV = v; frontD = d }
    }
  }
  return best
}

/** v falls to p in war w (struck from u at graph cost d). Returns true if v was q's capital. */
function conquer(s: HistoryState, ps: PolityState, w: number, p: number, q: number, u: number, v: number, d: number, attacker: boolean): boolean {
  const wasCap = ps.pCapital[q] === v
  setPolity(s, ps, v, p, d)
  ps.conqueredAt[v] = s.year
  ps.unrest[v] = 0.3
  if (attacker) ps.wTaken[w]++
  else ps.wRetaken[w]++
  logEvent(s, EventType.Conquered, v, u, w)
  if (ps.wSiege[w] === v) ps.wSiege[w] = -1
  // Sack.
  const rng = ps.rngWar
  const chance = WAR.sack * (wasCap && s.people[u] !== s.people[v] ? WAR.sackCapital : 1)
  if (rng.next() < chance) {
    const lost = WAR.sackPop * s.pop[v]
    s.pop[v] -= lost
    ps.wDead[w] += lost
    ps.diag.sackDead += lost
    s.wealth[v] *= 1 - WAR.sackWealth
    if (ps.walls[v] > 0 && rng.next() < WAR.slight) loseWalls(s, ps, v)
    if (s.dam[v] >= 0 && rng.next() < WAR.damLost) loseStructure(s, s.dam[v])
    spike(ps, v, WAR.sackDanger)
    logEvent(s, EventType.Sacked, v, u, WAR.sackPop)
  }
  return wasCap
}

/** q's capital fell to p in war w: members submit to the shock, the rest keep a rump or split. */
function capitalFalls(s: HistoryState, ps: PolityState, w: number, p: number, q: number, fallen: number): void {
  const rest = membersOf(s, ps, q)
  const base = ps.dist[fallen] // (now p's graph cost to the fallen capital)
  const people = ps.pPeople[p]
  const keep: number[] = []
  for (const j of rest) {
    let d = distTo(ps, p, j, s.abandoned)
    const via = base + (ps.dist[j] < FAR ? ps.dist[j] : FAR)
    if (via < d) d = via
    if (d < FAR && inContactPeople(s, people, s.people[j]) && submits(s, ps, j, projAt(ps, p, d), people, WAR.shock)) {
      setPolity(s, ps, j, p, d)
      ps.conqueredAt[j] = s.year
      ps.wTaken[w]++
      logEvent(s, EventType.Conquered, j, -1, w)
    } else keep.push(j)
  }
  for (const j of keep) ps.asab[j] = clampAsab(ps.asab[j] + COHESION.capitalLost)
  let pop = 0
  for (const j of keep) pop += s.pop[j]
  if (keep.length > 0 && pop >= POLITY.minState) {
    const c = chooseCapital(s, ps, keep, ps.pReach[q])
    moveCapital(s, ps, q, c)
    controlOne(s, ps, q, ps.heap)
    return
  }
  // No rump: the polity ends; the leftovers split into successor states or go stateless.
  for (const j of keep) setPolity(s, ps, j, -1, FAR)
  endPolity(s, ps, q, PolityEnd.Conquered, ps.pCapital[p])
  successors(s, ps, keep, q, PolityOrigin.Fragment, fallen)
}

function inContactPeople(s: HistoryState, a: number, b: number): boolean {
  return a === b || s.know.contact[a * s.know.P + b] >= 0
}

/** One battle of war w: p strikes q's v from u. */
function battle(s: HistoryState, ps: PolityState, w: number, p: number, q: number, u: number, v: number, d: number, attacker: boolean, dead: Float64Array): void {
  const rng = ps.rngWar
  let r = strike(s, ps, p, q, u, v, d)
  const siege = ps.walls[v] > 0 || isCapital(ps, v)
  if (attacker && siege) {
    if (ps.wSiege[w] !== v) {
      const old = ps.wSiege[w]
      if (old >= 0 && s.abandoned[old] < 0 && ps.polity[old] === q) logEvent(s, EventType.SiegeLifted, old, ps.wSiegeFrom[w], w)
      ps.wSiege[w] = v
      ps.wSiegeYears[w] = 0
      ps.wSiegeFrom[w] = u
    }
    for (let k = 0; k < ps.wSiegeYears[w]; k++) r *= WAR.siegeAttrition
  }
  const win = (r * r) / (r * r + 1)
  // Casualties and devastation.
  const lu = WAR.battle * s.pop[u], lv = WAR.battle * s.pop[v]
  s.pop[u] -= lu
  s.pop[v] -= lv
  dead[0] += attacker ? lu : lv
  dead[1] += attacker ? lv : lu
  ps.wDead[w] += lu + lv
  ps.diag.warDead += lu + lv
  if (ps.ravage[v] < WAR.ravage) ps.ravage[v] = WAR.ravage
  spike(ps, v, siege ? WAR.sackDanger : WAR.frontDanger)
  spike(ps, u, WAR.frontDanger)
  const nb = ps.gNb[v]
  if (nb) for (let k = 0; k < nb.length; k++) if (s.abandoned[nb[k]] < 0) spike(ps, nb[k], WAR.nearDanger)
  const T = s.terrain
  const c = s.cell[v]
  for (let k = T.catchOff[c], e = T.catchBase[c]; k < e; k++) s.landUse[T.catchCell[k]] *= WAR.fields
  armyJourney(s, ps, u, v, d - ps.dist[u], ps.pMass[p])
  if (rng.next() < win) {
    if (conquer(s, ps, w, p, q, u, v, d, attacker)) capitalFalls(s, ps, w, p, q, v)
  } else if (attacker && siege) ps.wSiegeYears[w]++
}

/** Exhaustion of p after a war-year with `dead` of its people killed. */
function exhaust(s: HistoryState, ps: PolityState, p: number, dead: number): void {
  let e = ps.pExh[p] + WAR.perYear + (ps.pPop[p] > 0 ? (WAR.deaths * dead) / ps.pPop[p] : 0)
  if (s.wealth[ps.pCapital[p]] < WAR.poorShare * ps.pMass[p]) e += WAR.poor
  ps.pExh[p] = e
}

/** System part (yearly): every war fights its year; peace when one side is spent. */
export function campaigns(s: HistoryState, ps: PolityState): void {
  if (ps.activeWars.length === 0) return
  const wars = ps.activeWars.slice()
  const dead = new Float64Array(2)
  const rng = ps.rngWar
  for (const w of wars) {
    const p = ps.wAtt[w], q = ps.wDef[w]
    if (ps.pEnded[q] >= 0) { closeWar(s, ps, w, ps.pEndBy[q] === ps.pCapital[p] ? WarOutcome.Conquest : ps.wTaken[w] > ps.wRetaken[w] ? WarOutcome.AttackerGains : WarOutcome.WhitePeace); continue }
    if (ps.pEnded[p] >= 0) { closeWar(s, ps, w, ps.wRetaken[w] > 0 ? WarOutcome.DefenderGains : WarOutcome.WhitePeace); continue }
    dead[0] = 0; dead[1] = 0
    const def = membersOf(s, ps, q)
    if (campaignFront(s, ps, p, q, def) > 0) battle(s, ps, w, p, q, frontU, frontV, frontD, true, dead)
    // Counteroffensive by a defender stronger on its own front.
    if (ps.pEnded[q] < 0) {
      const att = membersOf(s, ps, p)
      if (campaignFront(s, ps, q, p, att) >= WAR.counter) battle(s, ps, w, q, p, frontU, frontV, frontD, false, dead)
    }
    exhaust(s, ps, p, dead[0])
    if (ps.pEnded[q] < 0) exhaust(s, ps, q, dead[1])
    if (ps.pEnded[q] >= 0) { closeWar(s, ps, w, WarOutcome.Conquest); continue }
    if (ps.pEnded[p] >= 0) { closeWar(s, ps, w, ps.wRetaken[w] > 0 ? WarOutcome.DefenderGains : WarOutcome.WhitePeace); continue }
    const spent = ps.pExh[p] >= 1 || ps.pExh[q] >= 1
    const tired = s.year - ps.wStart[w] >= WAR.peaceAfter && rng.next() < WAR.peaceChance
    if (spent || tired) {
      const t = ps.wTaken[w], b = ps.wRetaken[w]
      closeWar(s, ps, w, t > b ? WarOutcome.AttackerGains : b > t ? WarOutcome.DefenderGains : WarOutcome.WhitePeace)
    }
  }
}

/** Yearly: exhaustion fades at peace, ravaged fields recover. */
export function warYear(s: HistoryState, ps: PolityState): void {
  for (const p of ps.alive) if (ps.pWars[p] === 0 && ps.pExh[p] > 0) { const e = ps.pExh[p] - WAR.exhaustDecay; ps.pExh[p] = e > 0 ? e : 0 }
  const living = s.living
  const keep = 1 - WAR.ravageDecay
  for (let t = 0; t < living.length; t++) { const id = living[t]; if (ps.ravage[id] > 0) { const r = ps.ravage[id] * keep; ps.ravage[id] = r < 0.001 ? 0 : r } }
}

// --- Raids -----------------------------------------------------------------------------------------------

function recordRaid(s: HistoryState, ps: PolityState, v: number, wealth: number): void {
  const decade = Math.floor(s.year / 10)
  const key = decade * 1048576 + v
  const i = ps.raidKey.get(key)
  if (i === undefined) {
    ps.raidKey.set(key, ps.raidDecade.length)
    ps.raidDecade.push(decade); ps.raidSettlement.push(v); ps.raidCount.push(1); ps.raidWealth.push(wealth)
  } else { ps.raidCount[i]++; ps.raidWealth[i] += wealth }
}

/** System part (every step): raids across state borders and between peoples, by states and stateless alike. */
export function raids(s: HistoryState, ps: PolityState): void {
  const rng = ps.rng
  const living = s.living
  const minPop = WAR.raidMinPop
  const step = POLITY.step
  for (let t = 0; t < living.length; t++) {
    const u = living[t]
    if (s.pop[u] < minPop) continue
    const pu = ps.polity[u]
    const nb = ps.gNb[u]
    if (!nb) continue
    // The richest neighbour of another polity (or a stateless one of another people).
    let v = -1, best = 0
    for (let k = 0; k < nb.length; k++) {
      const x = nb[k]
      if (s.abandoned[x] >= 0 || s.outpost[x] || s.pop[x] < minPop) continue
      const px = ps.polity[x]
      if (px === pu && (pu >= 0 || s.people[x] === s.people[u])) continue
      if (pu >= 0 && px >= 0 && pu !== px && !inContactPeople(s, s.people[u], s.people[x])) continue
      const loot = s.wealth[x] + 0.05 * s.pop[x]
      if (loot > best) { best = loot; v = x }
    }
    if (v < 0) continue
    const pv = ps.polity[v]
    const fu = prosperity(s, u), fv = prosperity(s, v)
    const R = pu >= 0 && pv >= 0 ? relationOf(ps, pu, pv) : 0
    const drive = WAR.hungry * (1 - s.food[u]) + (fv > fu ? fv - fu : 0) + R + WAR.steppe * horseOf(s, u) + (s.liveFrac[u] > WAR.herdFrac ? WAR.herders : 0)
    if (drive <= 0) continue
    if (rng.next() >= step * WAR.raid * drive) continue
    const L = ps.asab[u] * ps.str[u]
    let D = localOf(s, ps, v)
    if (pv >= 0) { const pr = projAt(ps, pv, ps.dist[v]); if (pr > D) D = pr }
    ps.diag.raids++
    const won = rng.next() < (L * L) / (L * L + D * D + 1e-12)
    if (won) {
      ps.diag.raidsWon++
      const take = WAR.raidWealth * s.wealth[v]
      s.wealth[v] -= take
      s.wealth[u] += take
      const lost = WAR.raidPop * s.pop[v]
      s.pop[v] -= lost
      ps.diag.raidDead += lost
      spike(ps, v, WAR.raidDanger)
      if (s.pop[v] >= WAR.raidLog) logEvent(s, EventType.Raid, v, u, take)
      else recordRaid(s, ps, v, take)
    } else {
      const lost = WAR.raidFail * s.pop[u]
      s.pop[u] -= lost
      ps.diag.raidDead += lost
    }
  }
}
