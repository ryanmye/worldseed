// polities: war and raids (design 6; no tribute, vassals, blockades or civil wars in v1).
//
// Declaration (every step, per pair with no war or truce, both ways, 'history-war'):
//   adv   = Proj_p(front) / Proj_q(front), front = q's member on the border most exposed to p
//   drive = smoothstep(0.6, 1.2, R) * smoothstep(1, 2, adv) * (q in crisis ? 2 : 1) * (1 - E_p)
//   chance = step * WAR.declare * drive
// Wars are opportunistic: the stronger attack the weak, the exhausted and the leaderless.
// oaths (grievances.ts): the C1 grudge factor 1 + OATH.drive * g(p, q); a declaration with g >= OATH.revengeMin is a revenge
// war (Wars.cause = p's strongest grievance against q), and a won revenge war repays those wrongs (* OATH.avenged).
// A truce sworn at a peace may be broken, and a defending ally may defect (oaths.ts). finance (finance/): unpaid armies fight
// worse (projAt * pPay) and tire (the unpaid term replaces the poor-capital one for monetised realms); a side unpaid for
// FIN.mutinyYears, or spent while unpaid, ends its war bankrupt (WarBankrupt); the crown's means scale the declaration (C1
// factor 4) and its debts the tired peace (C6 factor 2).
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

import { EventType, GrievanceKind, JourneyKind, PolityEnd, PolityOrigin, WarKind, WarOutcome } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import { logEvent, logJourney, loseStructure } from '../state.ts'
import { prosperity } from '../migration.ts'
import { learnPath } from '../knowledge.ts'
import { controlOne, distTo } from './control.ts'
import { loseFort, loseWalls, spike } from './danger.ts'
import { ALLIANCE, ARMS, CIVIL, COHESION, OATH, POLITY, VASSAL, WAR } from './params.ts'
import { blockade } from './outlaw.ts'
import { bound } from './policy.ts'
import { allied, bufferAlarm, overlordOf, peaceTerms, protectorsOf, subject } from './bonds.ts'
import { chooseCapital, membersOf, successors } from './realm.ts'
import { relIdx, relationOf } from './relations.ts'
import { FAR, clampAsab, endPolity, horseOf, inCrisis, isCapital, localOf, moveCapital, projAt, setPolity, submits, wallFactor } from './state.ts'
import { atWar } from './formation.ts'
import type { PolityState } from './state.ts'
import { rulerCapitalFell, rulerWar } from '../rulers/system.ts' // rulers:
import { holyDrive, holyWarDeclared } from '../religion/system.ts' // religion:
import { peaceUrged, submitAccepted, warOrders, warRivalry } from '../orders/hooks.ts' // orders: (seat: Submit)
import type { OrdersState } from '../orders/state.ts' // seat:
import { c1WarDeclare, c6Peace } from '../compose.ts' // C1, C6 stacks
import type { C1Factors } from '../compose.ts'
import { govWarMul } from '../government/hooks.ts' // governments:
import { ORDERS } from '../orders/params.ts' // orders:
import { grievConquered, grudge, grudgeWarEnded, recordGrievance, strongestGrievance } from './grievances.ts' // oaths:
import { put } from './grudgeState.ts' // oaths:
import { breakExcess, breakFactor, joinChance, linkAlly, oathBroken, oathTruce, swearTruce } from './oaths.ts' // oaths:
import { OathCase } from './shadow.ts' // oaths:
import { noteAggression } from './align.ts' // balance:
import { armsAdv, armsAgainst, armsDeclared, armsPeace } from './arms.ts' // arms:
import { battleDecisive, battleFought } from '../battles/system.ts' // battles:
import { BATTLE } from '../battles/params.ts' // battles:
import { cwAid, cwDeclared, cwJoinRestraint, cwRestraint } from './coldwar.ts' // cold wars:
import { cbBattleX, jJoin } from '../compose.ts' // CB, J stacks
import { bookPlunder, finExhaust, finPeaceDebt, finWarDrive } from '../finance/hooks.ts' // finance:
import { logWarBankrupt, warBroke } from '../finance/war.ts' // finance:
import type { C6Factors } from '../compose.ts'
import { whyPending, whyRelScale, whyWar } from '../why.ts' // causes:
import { BELIEF } from '../beliefs/params.ts' // beliefs:
import { beliefBattle, beliefPeace } from '../beliefs/system.ts' // beliefs:
import { bargain, beliefWarDeclared, convergeFactor, crisisDrive } from '../beliefs/bargain.ts' // beliefs:
import { beliefJoin } from '../beliefs/deception.ts' // beliefs:
import { TOWN_POPULATION, WarWhyFlag } from '../../../contract.ts' // beliefs:

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

/** C1 factors (reused scratch; oaths: the grudge; finance: money), C6 factors (finance: debt). */
const C1F: C1Factors = {}
const C6F: C6Factors = {}

/** System part (every step): rivals declare war. */
export function declarations(s: HistoryState, ps: PolityState): void {
  const rng = ps.rngWar
  const og = ps.og !== null && ps.og.oaths ? ps.og : null // oaths:
  const R = ps.relA.length
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0 || ps.relWar[r] >= 0) continue
    const inTruce = s.year < ps.relTruce[r]
    if (inTruce && !(og !== null && oathTruce(ps, og, r))) continue // (oaths: a truce sworn at a peace may be broken, below)
    const wo = s.orders !== null ? warOrders(s.orders, a, b) : 0 // orders: a side urged to war (rivalry read higher, warMul below)
    const rv = smoothstep(WAR.rLow, WAR.rHigh, wo !== 0 ? warRivalry(wo, ps.relR[r]) : ps.relR[r])
    if (rv <= 0 || ps.relEdges[r].length === 0) continue
    if (bound(ps, a, b)) continue // (v2: a vassal and its overlord never fight)
    const oath = og !== null && (inTruce || allied(ps, a, b)) // oaths: a truce or an alliance to break
    for (let dir = 0; dir < 2; dir++) {
      const p = dir === 0 ? a : b, q = dir === 0 ? b : a
      if (ps.pWars[p] >= WAR.maxWars || ps.relWar[r] >= 0) continue
      if (exposedFront(s, ps, ps.relEdges[r], p, q) <= 0) continue
      const pq = projAt(ps, q, ps.dist[frontV])
      let adv = projAt(ps, p, frontD) / (pq + 1e-9)
      if (ps.og !== null && ps.og.arms) adv *= armsAdv(ps, ps.og, r, p) // arms: arming deters as well as provokes
      let e = ps.pExh[p]
      if (e > 1) e = 1
      const g = og !== null ? grudge(og, p, q) : 0
      if (og !== null) C1F.grudge = 1 + OATH.drive * g // oaths: p's grudge against q
      const money = s.fin !== null ? finWarDrive(s, ps, p) : undefined // finance: can the crown fund it (C1 factor 4)
      C1F.money = money
      const rs = ps.cw !== null ? cwRestraint(ps, p, q) : undefined // cold wars (ruling D-CW1): great powers' restraint (C1 factor 7)
      C1F.restraint = rs
      const fm = s.gov !== null ? govWarMul(s.gov, p, q) : undefined // governments: the form's appetite for war, and for trade wars (C1 factor 2)
      C1F.form = fm
      if (oath) {
        // oaths: one 'history-oaths' draw per candidate, damped by the excess of breaking (oaths.ts, shadow.ts)
        const kase = inTruce ? OathCase.Truce : OathCase.AllyAttack
        const E = breakExcess(s, ps, og!, r, p, q, adv, kase)
        const mul = c1WarDeclare(s.rul !== null ? rulerWar(s.rul, p) : 1, s.rel !== null ? holyDrive(s, s.rel, p, q) : 1, (wo & (1 << dir)) !== 0 ? ORDERS.warMul : 1, C1F)
        if (og!.rng!.next() >= POLITY.slowStep * WAR.declare * rv * (inCrisis(s, ps, q) ? WAR.crisisMul : 1) * (1 - e) * mul * breakFactor(E)) continue
        if (ps.why) whyPending(ps.why, wo !== 0 ? warRivalry(wo, ps.relR[r]) : ps.relR[r], adv, e, mul, inCrisis(s, ps, q), s.rul !== null ? rulerWar(s.rul, p) : 1, s.rel !== null ? holyDrive(s, s.rel, p, q) : 1, (wo & (1 << dir)) !== 0, frontV, rv * (1 - e) * breakFactor(E)) // causes:
        const w0 = ps.wKind.length
        declare(s, ps, r, p, q)
        if (s.rel !== null) holyWarDeclared(s, s.rel, p, q, w0) // religion:
        if (g >= OATH.revengeMin) { put(og!.wCause, w0, strongestGrievance(og!, p, q), -1); og!.diag.revengeWars++ }
        oathBroken(s, ps, og!, p, q, w0, kase === OathCase.Truce ? 0 : 1)
        continue
      }
      if (s.bel !== null && !BELIEF.shadow && (wo & (1 << dir)) === 0) {
        // beliefs: p presses its claim on what it believes; the crisis is bargained (beliefs/bargain.ts), war only when no deal holds
        const ak = ps.og !== null && ps.og.arms ? armsAdv(ps, ps.og, r, p) : 1
        const bdrive = rv * crisisDrive(s, ps, s.bel, p, q, frontV, frontD, adv, ak) * (inCrisis(s, ps, q) ? WAR.crisisMul : 1) * (1 - e)
        if (bdrive <= 0) continue
        const bmul = c1WarDeclare(s.rul !== null ? rulerWar(s.rul, p) : 1, s.rel !== null ? holyDrive(s, s.rel, p, q) : 1, 1, og !== null || money !== undefined || rs !== undefined || fm !== undefined ? C1F : undefined)
        if (rng.next() >= POLITY.slowStep * WAR.declare * bdrive * bmul * BELIEF.pressMul) continue
        const motive = bargain(s, ps, s.bel, r, p, q)
        if (motive === 0) continue
        if (ps.why) { whyPending(ps.why, ps.relR[r], adv, e, bmul, inCrisis(s, ps, q), s.rul !== null ? rulerWar(s.rul, p) : 1, s.rel !== null ? holyDrive(s, s.rel, p, q) : 1, false, frontV, bdrive); ps.why.pFlags |= WarWhyFlag.Bargained } // causes:
        const w0 = ps.wKind.length
        declare(s, ps, r, p, q)
        beliefWarDeclared(s.bel, w0)
        if (s.rel !== null) holyWarDeclared(s, s.rel, p, q, w0) // religion:
        if (og !== null && g >= OATH.revengeMin) { put(og.wCause, w0, strongestGrievance(og, p, q), -1); og.diag.revengeWars++ } // oaths: a revenge war
        continue
      }
      const drive = rv * smoothstep(WAR.advLow, WAR.advHigh, adv) * (inCrisis(s, ps, q) ? WAR.crisisMul : 1) * (1 - e)
      if (drive <= 0) continue
      const mul = c1WarDeclare(s.rul !== null ? rulerWar(s.rul, p) : 1, s.rel !== null ? holyDrive(s, s.rel, p, q) : 1, (wo & (1 << dir)) !== 0 ? ORDERS.warMul : 1, og !== null || money !== undefined || rs !== undefined || fm !== undefined ? C1F : undefined) // C1 (compose.ts): rulers: a warlike ruler; religion: holy war; orders:; oaths: the grudge; finance: money; cold wars: restraint; governments: form
      if (rng.next() >= POLITY.slowStep * WAR.declare * drive * mul) continue
      if (ps.why) whyPending(ps.why, wo !== 0 ? warRivalry(wo, ps.relR[r]) : ps.relR[r], adv, e, mul, inCrisis(s, ps, q), s.rul !== null ? rulerWar(s.rul, p) : 1, s.rel !== null ? holyDrive(s, s.rel, p, q) : 1, (wo & (1 << dir)) !== 0, frontV, drive) // causes:
      const w0 = ps.wKind.length
      declare(s, ps, r, p, q)
      if (s.rel !== null) holyWarDeclared(s, s.rel, p, q, w0) // religion:
      if (og !== null && g >= OATH.revengeMin) { put(og.wCause, w0, strongestGrievance(og, p, q), -1); og.diag.revengeWars++ } // oaths: a revenge war
    }
  }
}

/** p declares war on q (relation r); a civil war (v2) is logged as CivilWar, and allies and protectors of q may join a war of conquest. */
export function declare(s: HistoryState, ps: PolityState, r: number, p: number, q: number, kind: number = WarKind.Conquest, joined = false): void {
  const w = ps.wKind.length
  if (ps.why) whyWar(ps.why, ps, r, kind, joined) // causes: why it was declared
  ps.wKind.push(kind)
  ps.wAtt.push(p); ps.wDef.push(q)
  ps.wStart.push(s.year); ps.wEnd.push(-1); ps.wOutcome.push(WarOutcome.Ongoing)
  ps.wTaken.push(0); ps.wRetaken.push(0); ps.wDead.push(0)
  ps.wSiege.push(-1); ps.wSiegeYears.push(0); ps.wSiegeFrom.push(-1); ps.wLastGain.push(s.year)
  ps.activeWars.push(w)
  ps.relWar[r] = w
  ps.pWars[p]++
  ps.pWars[q]++
  ps.warEpoch++
  if (ps.cw !== null) cwDeclared(s, ps, ps.cw, r, w) // cold wars: a war between the principals ends it (HotWar)
  if (ps.og !== null && ps.og.balance && kind === WarKind.Conquest && !joined) noteAggression(s, ps.og, p) // balance: offensive intent
  if (kind === WarKind.CivilWar) { logEvent(s, EventType.CivilWar, ps.pCapital[p], ps.pCapital[q], w); return }
  logEvent(s, EventType.WarDeclared, ps.pCapital[p], ps.pCapital[q], w)
  if (ps.og !== null && ps.og.arms) armsDeclared(s, ps, ps.og, r, w) // arms: the race ends in war
  if (joined) return
  // v2: buffer states alarm the attacker's rivals; allies and the overlord of the attacked come to its defence.
  const rng = ps.rngWar
  bufferAlarm(s, ps, p, q, () => rng.next())
  for (const x of protectorsOf(ps, q)) {
    if (x === p || ps.pEnded[x] >= 0 || ps.pWars[x] >= WAR.maxWars || atWar(ps, x, p) || bound(ps, x, p)) continue
    const rx = relIdx(ps, x, p)
    if (rx < 0 || ps.relEdges[rx].length === 0 || ps.relWar[rx] >= 0) continue
    const jf = ps.cw !== null ? cwJoinRestraint(ps, x, p) : undefined // cold wars (ruling on D-CW1): a great power's restraint in joining (J stack)
    if (rng.next() >= jJoin(ps.og !== null ? joinChance(s, ps, p, q, x) : ALLIANCE.join, jf)) continue // (oaths: a faithless realm finds fewer friends; balance: those who fear p come readily)
    if (ps.og !== null) linkAlly(ps.og, ps.wKind.length, w) // oaths: the war it joined
    const wj = ps.wKind.length
    const dd = s.bel !== null ? beliefJoin(s, ps, s.bel, x, q, p, wj) : false // beliefs: a secret pact comes to light; double-dealing
    declare(s, ps, rx, x, p, WarKind.Conquest, true)
    if (dd && ps.og !== null) oathBroken(s, ps, ps.og, x, p, wj, 1) // beliefs, oaths: x betrayed its public ally p
  }
}

// --- Campaigns -----------------------------------------------------------------------------------------

/** Ends war w this year with the given outcome (terms false: a separate peace, no vassalage or tribute). Exported for oaths and seat-mode. */
export function closeWar(s: HistoryState, ps: PolityState, w: number, outcome: number, terms = true): void {
  if (ps.wEnd[w] >= 0) return
  const p = ps.wAtt[w], q = ps.wDef[w]
  ps.wEnd[w] = s.year
  ps.warEpoch++
  // v2: a civil war ends in reunification when one side is gone; an unfinished war of conquest may end in vassalage or tribute.
  if (ps.wKind[w] === WarKind.CivilWar && (ps.pEnded[p] >= 0 || ps.pEnded[q] >= 0)) outcome = WarOutcome.Reunified
  else if (terms && ps.wKind[w] === WarKind.Conquest && outcome !== WarOutcome.Conquest && outcome !== WarOutcome.DefenderGains && outcome !== WarOutcome.Vassalage)
    outcome = peaceTerms(s, ps, p, q, outcome, WarOutcome.Vassalage, WarOutcome.Tribute)
  ps.wOutcome[w] = outcome
  if (ps.og !== null) grudgeWarEnded(s, ps, ps.og, w, (outcome === WarOutcome.AttackerGains || outcome === WarOutcome.Conquest || outcome === WarOutcome.Vassalage || outcome === WarOutcome.Tribute) && overlordOf(ps, p) !== q) // oaths: a won revenge war repays the wrongs
  if (ps.pBlockade[q] === w) ps.pBlockade[q] = -1
  if (ps.pBlockade[p] === w) ps.pBlockade[p] = -1
  if (s.bel !== null) beliefPeace(s, ps, p, q) // beliefs: a last look at each other
  const i = ps.activeWars.indexOf(w)
  if (i >= 0) ps.activeWars.splice(i, 1)
  const lo = p < q ? p : q, hi = p < q ? q : p
  const r = ps.relIndex.get(lo * 65536 + hi)
  if (r !== undefined) {
    ps.relWar[r] = -1
    ps.relTruce[r] = s.year + WAR.truce
    if (ps.og !== null && ps.og.oaths) swearTruce(ps.og, r, w) // oaths: the truce is sworn
    if (ps.og !== null && ps.og.arms) armsPeace(ps.og, r) // arms: demobilisation
    ps.relR[r] *= WAR.peaceR
    if (ps.why) whyRelScale(ps.why, r, WAR.peaceR) // causes:
    ps.relLastWar[r] = s.year
  }
  ps.pWars[p]--
  ps.pWars[q]--
  const sg = ps.wSiege[w]
  if (sg >= 0 && s.abandoned[sg] < 0 && ps.polity[sg] === q) logEvent(s, EventType.SiegeLifted, sg, ps.wSiegeFrom[w], w)
  ps.wSiege[w] = -1
  // The winners' cohesion rises.
  const winner = outcome === WarOutcome.AttackerGains || outcome === WarOutcome.Conquest || outcome === WarOutcome.Vassalage || outcome === WarOutcome.Tribute ? (overlordOf(ps, p) === q ? q : p) : outcome === WarOutcome.DefenderGains ? q : outcome === WarOutcome.Reunified ? (ps.pEnded[p] >= 0 ? q : p) : -1
  if (winner >= 0 && ps.pEnded[winner] < 0) {
    const living = s.living
    for (let t = 0; t < living.length; t++) { const id = living[t]; if (ps.polity[id] === winner) ps.asab[id] = clampAsab(ps.asab[id] + COHESION.warWon) }
  }
  logEvent(s, EventType.PeaceMade, ps.pCapital[p], ps.pCapital[q], w)
}

/** A cosmetic army journey from u to v (a bounded cell search), arriving this year. Returns its path of cells (null: no way within the budget, nothing logged). */
function armyJourney(s: HistoryState, ps: PolityState, u: number, v: number, edgeCost: number, mass: number): number[] | null {
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
  if (!found) return null
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
  learnPath(s, u, path, false) // (the attacker's people learn the way they marched)
  return path
}

/** Odds of a strike by p from u on q's v at graph cost d: A and D. */
let strikeA = 0, strikeD = 0
function strike(s: HistoryState, ps: PolityState, p: number, q: number, u: number, v: number, d: number): number {
  strikeA = projAt(ps, p, d) / (1 + 0.5 * ps.ravage[u])
  const cap = isCapital(ps, v)
  // (walls shelter the town's own defenders, already in Local; the realm's field army fights on the ground's terms)
  // (at its capital a realm's field army counts at capitalField: the rest holds the provinces and garrisons, so a
  // stronger attacker can take a peer's capital; the citadel and walls are in Local)
  strikeD = projAt(ps, q, ps.dist[v]) * (cap ? WAR.capitalField : 1) * ps.defense[s.cell[v]] * (WAR.fieldWall ? wallFactor(ps, v, cap) : 1) + localOf(s, ps, v)
  if (ps.og !== null && ps.og.arms) { strikeA *= 1 + ARMS.proj * armsAgainst(ps, ps.og, p, q); strikeD *= 1 + ARMS.proj * armsAgainst(ps, ps.og, q, p) } // arms: the pair's arms on its fronts
  return strikeA / (strikeD + 1e-9)
}

/**
 * Best front of p against q this year (current membership): the target worth most, win chance times value (a
 * province 1, the capital 1 + capitalValue * q's members: decapitation). Sets frontU / frontV / frontD; returns
 * that front's A / D (0 if none).
 */
function campaignFront(s: HistoryState, ps: PolityState, p: number, q: number, defenders: readonly number[]): number {
  let best = 0, bestR = 0
  frontU = -1; frontV = -1
  const capValue = 1 + WAR.capitalValue * ps.pMembers[q]
  for (const v of defenders) {
    if (ps.polity[v] !== q) continue
    const nb = ps.gNb[v], co = ps.gCost[v]
    if (!nb) continue
    const value = ps.pCapital[q] === v ? capValue : 1
    for (let k = 0; k < nb.length; k++) {
      const u = nb[k]
      if (ps.polity[u] !== p || s.abandoned[u] >= 0) continue
      const d = ps.dist[u] + co[k]
      const r = strike(s, ps, p, q, u, v, d)
      const sc = ((r * r) / (r * r + 1)) * value
      if (sc > best) { best = sc; bestR = r; frontU = u; frontV = v; frontD = d }
    }
  }
  return bestR
}

/** v falls to p in war w (struck from u at graph cost d). Returns true if v was q's capital. */
function conquer(s: HistoryState, ps: PolityState, w: number, p: number, q: number, u: number, v: number, d: number, attacker: boolean): boolean {
  const wasCap = ps.pCapital[q] === v
  setPolity(s, ps, v, p, d)
  ps.conqueredAt[v] = s.year
  ps.unrest[v] = 0.3
  if (attacker) ps.wTaken[w]++
  else ps.wRetaken[w]++
  const e = ps.pExh[p] - WAR.momentum
  ps.pExh[p] = e > 0 ? e : 0
  logEvent(s, EventType.Conquered, v, u, w)
  if (ps.wSiege[w] === v) ps.wSiege[w] = -1
  // Sack.
  const rng = ps.rngWar
  const chance = WAR.sack * (wasCap && s.people[u] !== s.people[v] ? WAR.sackCapital : 1)
  const sacked = rng.next() < chance
  if (ps.og !== null) grievConquered(s, ps, ps.og, w, p, q, v, wasCap, sacked) // oaths: the town, its sack, the capital
  if (sacked) {
    const lost = WAR.sackPop * s.pop[v]
    s.pop[v] -= lost
    ps.wDead[w] += lost
    ps.diag.sackDead += lost
    const loot = WAR.sackWealth * s.wealth[v]
    s.wealth[v] -= loot
    s.wealth[ps.pCapital[p]] += s.fin !== null ? bookPlunder(s.fin, p, WAR.plunder * loot) : WAR.plunder * loot // (finance: the crown's share to the treasury, next year)
    if (ps.walls[v] > 0 && rng.next() < WAR.slight) loseWalls(s, ps, v)
    if (ps.fort[v] >= 0 && rng.next() < WAR.slight) loseFort(s, ps, v) // v2
    if (s.dam[v] >= 0 && rng.next() < WAR.damLost) loseStructure(s, s.dam[v])
    spike(ps, v, WAR.sackDanger)
    logEvent(s, EventType.Sacked, v, u, WAR.sackPop)
  }
  return wasCap
}

/** q's capital fell to p in war w: members submit to the shock, the rest keep a rump or split. */
function capitalFalls(s: HistoryState, ps: PolityState, w: number, p: number, q: number, fallen: number): void {
  if (s.rul !== null) rulerCapitalFell(ps, s.rul, q) // rulers: the ruler may die as the capital falls
  const rest = membersOf(s, ps, q)
  let pop0 = s.pop[fallen]
  for (const j of rest) pop0 += s.pop[j]
  const base = ps.dist[fallen] // (now p's graph cost to the fallen capital)
  const people = ps.pPeople[p]
  const civil = ps.wKind[w] === WarKind.CivilWar
  // v2: a large foreign realm whose capital fell may bow as the conqueror's vassal instead (its rump keeps its government).
  if (!civil && rest.length + 1 >= VASSAL.vassalMembers && ps.pPeople[q] !== people && ps.pSub[p] < 0 && ps.rngWar.next() < VASSAL.fall) {
    let pop = 0
    for (const j of rest) pop += s.pop[j]
    if (rest.length > 0 && pop >= POLITY.minState) {
      for (const j of rest) ps.asab[j] = clampAsab(ps.asab[j] + COHESION.capitalLost)
      moveCapital(s, ps, q, chooseCapital(s, ps, rest, ps.pReach[q]))
      controlOne(s, ps, q, ps.heap)
      subject(s, ps, q, p, false)
      closeWar(s, ps, w, WarOutcome.Vassalage)
      return
    }
  }
  const keep: number[] = []
  for (const j of rest) {
    let d = distTo(ps, p, j, s.abandoned)
    const via = base + (ps.dist[j] < FAR ? ps.dist[j] : FAR)
    if (via < d) d = via
    if (d < FAR && inContactPeople(s, people, s.people[j]) && submits(s, ps, j, projAt(ps, p, d), people, civil ? CIVIL.alpha : WAR.shock)) {
      setPolity(s, ps, j, p, d)
      ps.conqueredAt[j] = s.year
      ps.wTaken[w]++
      logEvent(s, EventType.Conquered, j, -1, w)
      if (ps.og !== null) recordGrievance(s, ps, ps.og, GrievanceKind.TownConquered, q, p, OATH.wTown, j, w) // oaths:
    } else keep.push(j)
  }
  for (const j of keep) ps.asab[j] = clampAsab(ps.asab[j] + COHESION.capitalLost)
  let pop = 0
  for (const j of keep) pop += s.pop[j]
  if (civil) {
    // v2: the civil war is won; the realm is one again (the holdouts go their own way).
    for (const j of keep) setPolity(s, ps, j, -1, FAR)
    logEvent(s, EventType.Reunified, ps.pCapital[p], fallen, q)
    ps.diag.reunified++
    endPolity(s, ps, q, PolityEnd.Reunified, ps.pCapital[p])
    successors(s, ps, keep, q, PolityOrigin.Fragment, fallen)
    return
  }
  if (keep.length > 0 && pop >= POLITY.minState && pop >= WAR.rumpShare * pop0) {
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
  // (the journey reads no pop, danger or fields, and draws nothing: it goes before the roll, so battles can see its path)
  const path = armyJourney(s, ps, u, v, d - ps.dist[u], ps.pMass[p])
  const U = rng.next()
  let lu = WAR.battle * s.pop[u], lv = WAR.battle * s.pop[v]
  const cbf = ps.cw !== null ? cwAid(ps, w, p) : undefined // cold wars: proxy aid (CB stack, compose.ts)
  const xb = cbBattleX(r, cbf)
  const won = s.bat !== null ? battleFought(s, s.bat, ps, w, p, q, u, v, attacker, siege, r, U, path, lu, lv, strikeA, strikeD, cbf) : U < xb / (xb + 1) // battles: the contest recorded (neutral: the same test)
  if (s.bel !== null) beliefBattle(s, w, p, q, strikeA, strikeD) // beliefs: war reveals strength (battles §3.8: keep this call)
  let rp = 0, rq = 0
  if (s.bat !== null && !s.bat.neutral) { lu = s.bat.tollU; lv = s.bat.tollV; rp = s.bat.realmP; rq = s.bat.realmQ } // battles: the toll shared by casualties; the realm's levies (already deducted)
  // Casualties and devastation.
  s.pop[u] -= lu
  s.pop[v] -= lv
  dead[0] += attacker ? lu + rp : lv + rq
  dead[1] += attacker ? lv + rq : lu + rp
  ps.wDead[w] += lu + lv + rp + rq
  ps.diag.warDead += lu + lv + rp + rq
  if (ps.ravage[v] < WAR.ravage) ps.ravage[v] = WAR.ravage
  spike(ps, v, siege ? WAR.sackDanger : WAR.frontDanger)
  spike(ps, u, WAR.frontDanger)
  const nb = ps.gNb[v]
  if (nb) for (let k = 0; k < nb.length; k++) if (s.abandoned[nb[k]] < 0) spike(ps, nb[k], WAR.nearDanger)
  const T = s.terrain
  const c = s.cell[v]
  for (let k = T.catchOff[c], e = T.catchBase[c]; k < e; k++) s.landUse[T.catchCell[k]] *= WAR.fields
  if (won) {
    if (conquer(s, ps, w, p, q, u, v, d, attacker)) capitalFalls(s, ps, w, p, q, v)
  } else if (attacker && siege) ps.wSiegeYears[w]++
}

/**
 * beliefs (and grudges): `from` cedes `towns` to `to` without war, never its capital: each joins `to` (a Joined event for a
 * town of TOWN_POPULATION or more), marked conquered this year with unrest `unrest`. Returns the number ceded. RNG-free.
 */
export function cedeTowns(s: HistoryState, ps: PolityState, from: number, to: number, towns: readonly number[], unrest = 0.3): number {
  let n = 0
  for (const v of towns) {
    if (ps.polity[v] !== from || v === ps.pCapital[from] || s.abandoned[v] >= 0) continue
    setPolity(s, ps, v, to, distTo(ps, to, v, s.abandoned))
    ps.conqueredAt[v] = s.year
    ps.unrest[v] = unrest
    if (s.pop[v] >= TOWN_POPULATION) logEvent(s, EventType.Joined, v, ps.pCapital[to], to)
    n++
  }
  return n
}

/** Exhaustion of p after a war-year with `dead` of its people killed. */
function exhaust(s: HistoryState, ps: PolityState, p: number, dead: number): void {
  let e = ps.pExh[p] + (s.bat !== null && s.bat.tempo ? BATTLE.perYear : WAR.perYear) + (ps.pPop[p] > 0 ? (WAR.deaths * dead) / ps.pPop[p] : 0)
  const fx = s.fin !== null ? finExhaust(s, p) : null // finance: unpaid soldiers (replaces the poor-capital term)
  if (fx !== null) e += fx
  else if (s.wealth[ps.pCapital[p]] < WAR.poorShare * ps.pMass[p]) e += WAR.poor
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
    const takenBefore = ps.wTaken[w]
    blockade(s, ps, w, p, q) // (v2: the stronger fleet blockades the enemy's ports)
    const def = membersOf(s, ps, q)
    if (campaignFront(s, ps, p, q, def) > 0) battle(s, ps, w, p, q, frontU, frontV, frontD, true, dead)
    if (ps.wEnd[w] >= 0) continue // (v2: ended in the battle: the defender bowed as a vassal)
    // Counteroffensive by a defender stronger on its own front.
    if (ps.pEnded[q] < 0) {
      const att = membersOf(s, ps, p)
      if (campaignFront(s, ps, q, p, att) >= WAR.counter) battle(s, ps, w, q, p, frontU, frontV, frontD, false, dead)
    }
    if (ps.wEnd[w] >= 0) continue
    exhaust(s, ps, p, dead[0])
    if (ps.pEnded[q] < 0) exhaust(s, ps, q, dead[1])
    if (ps.pEnded[q] >= 0) { closeWar(s, ps, w, WarOutcome.Conquest); continue }
    if (ps.pEnded[p] >= 0) { closeWar(s, ps, w, ps.wRetaken[w] > 0 ? WarOutcome.DefenderGains : WarOutcome.WhitePeace); continue }
    if (ps.wTaken[w] > takenBefore) ps.wLastGain[w] = s.year
    if (s.orders !== null && s.orders.nPolity > 0 && submitWar(s, ps, s.orders, w, p, q)) continue // seat: tribute offered and accepted
    const spent = ps.pExh[p] >= 1 || ps.pExh[q] >= 1
    const fd = s.fin !== null ? finPeaceDebt(s, p, q) : undefined // finance: the more indebted side seeks terms (C6 factor 2)
    C6F.debt = fd
    const cv = s.bel !== null && !BELIEF.shadow ? convergeFactor(s, ps, s.bel, w) : undefined // beliefs: beliefs converge, peace comes (C6 factor 3b)
    C6F.converge = cv
    const bt = s.bat !== null && s.bat.tempo // battles: war tempo (C6 factor 1) and a decisive battle this year (C6 factor 4, which lifts the gates)
    const dec = bt && battleDecisive(s.bat!, w, s.year)
    C6F.tempo = bt ? BATTLE.peaceChance : undefined
    C6F.decisive = dec ? BATTLE.decisivePeace : undefined
    const tired = (((s.year - ps.wStart[w] >= (bt ? BATTLE.peaceAfter : WAR.peaceAfter) && s.year - ps.wLastGain[w] >= WAR.winning) || dec) && rng.next() < c6Peace(WAR.peaceChance, fd !== undefined || cv !== undefined || bt ? C6F : undefined)) || (s.orders !== null && peaceUrged(s, s.orders, p, q, ps.wStart[w])) // orders: envoys seek terms
    // finance: an army unpaid (ArmyUnpaid once per side and war); a bankrupt side's war ends (spent by it, or mutiny)
    const broke = s.fin !== null ? warBroke(s, ps, w, p, q, spent) : -1
    if (spent || tired || broke >= 0) {
      if (broke >= 0) logWarBankrupt(s, ps, w, broke)
      const t = ps.wTaken[w], b = ps.wRetaken[w]
      closeWar(s, ps, w, t > b ? WarOutcome.AttackerGains : b > t ? WarOutcome.DefenderGains : WarOutcome.WhitePeace)
    }
  }
  // A war whose side fell later this year (in another war) ends this year too, as if it had come later in the order.
  for (const w of wars) {
    if (ps.wEnd[w] >= 0) continue
    const p = ps.wAtt[w], q = ps.wDef[w]
    if (ps.pEnded[q] >= 0) closeWar(s, ps, w, ps.pEndBy[q] === ps.pCapital[p] ? WarOutcome.Conquest : ps.wTaken[w] > ps.wRetaken[w] ? WarOutcome.AttackerGains : WarOutcome.WhitePeace)
    else if (ps.pEnded[p] >= 0) closeWar(s, ps, w, ps.wRetaken[w] > 0 ? WarOutcome.DefenderGains : WarOutcome.WhitePeace)
  }
}

/** seat (Submit): a side ordered to offer tribute whose offer is accepted this year (one orders' draw): the war ends, the enemy gaining, and it pays tribute. */
function submitWar(s: HistoryState, ps: PolityState, ox: OrdersState, w: number, p: number, q: number): boolean {
  const by = submitAccepted(s, ox, p, q, ps.wStart[w]) ? p : submitAccepted(s, ox, q, p, ps.wStart[w]) ? q : -1
  if (by < 0) return false
  const to = by === p ? q : p
  closeWar(s, ps, w, by === p ? WarOutcome.DefenderGains : WarOutcome.AttackerGains, false)
  if (ps.pEnded[by] < 0 && ps.pEnded[to] < 0) subject(s, ps, by, to, true)
  s.events.push({ year: s.year, type: EventType.TributeOffered, settlement: ps.pCapital[by], other: ps.pCapital[to], value: w, extra: VASSAL.tributeYears })
  return true
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
  const step = POLITY.slowStep
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
