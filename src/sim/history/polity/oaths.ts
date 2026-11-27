// grudges and oaths: truces as oaths, attacks on allies and betrayal in war (grudges-and-oaths.md §3.6, §3.7;
// HistoryOptions.oaths).
//
// Truce: the peace that ends a war swears a truce of WAR.truce years (relOath = the war); truces of secession, partition and
// civil war are not oaths and still bind. During an oath truce a declaration is still possible:
//   chance = slowStep * WAR.declare * rv * crisis * (1 - E_p) * mul * OATH.breakMul * smoothstep(0, OATH.breakSpan, E)
// with E the excess of breaking (shadow.ts; the attacker's odds enter E through `win`, so the drive's adv smoothstep is not
// applied), drawn from 'history-oaths' (one draw per candidate that reaches it), so 'history-war' is untouched until the world
// diverges. Attacking one's own ally is damped the same way (OathCase.AllyAttack) and ends the alliance Betrayed.
// Payoffs (realm shares per period):
//   gain = rulerWar * win * (people of up to takeMax of q's border towns, its capital excluded) / pPop_p,  win = adv^2 / (1 + adv^2)
//   t = tradeW * v / (v + 200),  a = allied ? allyW * worth of the alliance : 0 (+ tieW tied by marriage)
//   T - R = gain + threatW * theta(q -> p) - warCost - (t + a),   R - P = t + a + hostile * warCost
// A broken oath records a grievance of the victim (TruceBroken or AllyBetrayed), adds to the breaker's faithless score
// (faithTruce, faithAlly; at most repMax; it decays by repKeep a slow step), and alarms the witnesses: every polity bordering
// the breaker, allied with the victim or of the victim's people gains rivalry witnessR with the breaker. The score divides
// the alliance chance (C7) and the join chance by 1 + repAlliance * f (threshold only: no draw is added or skipped).
//
// Betrayal (betrayalStep, every POLITY.step after the bonds): an ally x that joined the defence of q against the common enemy
// e may make a separate peace (OathCase.Defect):
//   T - R = value_t + threatW * theta(e -> x) + warCost * (1 + tired) - a_xq,   value_t = people of up to cedeMax of e's border towns / pPop_x
//   R - P = a_xq + bondW * (g(x, e) + R(x, e) / 2 + [tied to q] 0.5 + [q's people] 0.25) + hostile * warCost
//   chance = POLITY.step * OATH.defect * smoothstep(0, breakSpan, E), when e has towns to give or x is spent (tired > 0.5).
// On defection the alliance ends Betrayed, e cedes the towns (Joined) and the war ends; if x's rivalry with q is >= turnR and
// it can strike q (adv >= 1), it turns on its former ally.

import { BondEnd, BondKind, EventType, GrievanceKind, RivalryPart, TOWN_POPULATION, WarOutcome } from '../../../contract.ts'
import { whyOath, whyRelSet } from '../why.ts' // causes:
import type { EventType as EventTypeT } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import { logEvent } from '../state.ts'
import { ALIGN, ALLIANCE, OATH, POLITY, WAR } from './params.ts'
import type { PolityState } from './state.ts'
import { setPolity } from './state.ts'
import { distTo } from './control.ts'
import type { GrudgeState } from './grudgeState.ts'
import { at, put } from './grudgeState.ts'
import { faithOf, grudge, recordGrievance } from './grievances.ts'
import { OathCase, oathDelta, oathExcess, rulerPiety } from './shadow.ts'
import { allianceWorth, threatAt, threatOf } from './align.ts'
import { advantageAt, allied, endBond } from './bonds.ts'
import { relIdx, relationOf } from './relations.ts'
import { tied } from '../rulers/marriage.ts' // rulers:
import { rulerWar } from '../rulers/system.ts' // rulers:
import { finWarCost } from './finHooks.ts' // finances: the war cost in the oath calculus

function logX(s: HistoryState, type: EventTypeT, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

/** True when relation r's truce in force was sworn at the peace of a war (an oath), not at a secession or partition. */
export function oathTruce(ps: PolityState, og: GrudgeState, r: number): boolean {
  const w = at(og.relOath, r, -1)
  return w >= 0 && ps.wEnd[w] >= 0 && ps.wEnd[w] + WAR.truce === ps.relTruce[r]
}

/** closeWar hook: the peace of war w swears the truce of relation r. */
export function swearTruce(og: GrudgeState, r: number, w: number): void {
  put(og.relOath, r, w, -1)
}

/** The alliance bond between p and q, or -1. */
export function allianceBond(ps: PolityState, p: number, q: number): number {
  for (const k of ps.activeBonds) if (ps.bKind[k] === BondKind.Alliance && ((ps.bA[k] === p && ps.bB[k] === q) || (ps.bA[k] === q && ps.bB[k] === p))) return k
  return -1
}

/** People of up to n of q's members on its border with p (relation r), largest first, `skip` excluded; their ids in `out`. */
function borderTowns(s: HistoryState, ps: PolityState, r: number, p: number, q: number, n: number, skip: number, out: number[]): number {
  out.length = 0
  const e = ps.relEdges[r]
  for (let k = 0; k < e.length; k += 3) {
    const a = e[k], b = e[k + 1]
    const v = ps.polity[a] === q && ps.polity[b] === p ? a : ps.polity[b] === q && ps.polity[a] === p ? b : -1
    if (v < 0 || v === skip || s.abandoned[v] >= 0 || out.indexOf(v) >= 0) continue
    out.push(v)
  }
  out.sort((x, y) => s.pop[y] - s.pop[x] || x - y)
  if (out.length > n) out.length = n
  let pop = 0
  for (const v of out) pop += s.pop[v]
  return pop
}
const towns: number[] = []

/** The trade lost with the partner of relation r: tradeW * v / (v + 200). */
function tradeLoss(og: GrudgeState, r: number): number {
  const v = og.relVol !== null && r < og.relVol.length ? og.relVol[r] : 0
  return (OATH.tradeW * v) / (v + 200)
}

let lastDelta = 0

/** E of p breaking its oath (truce or alliance) with q to make war (relation r; adv p's advantage on its best front). */
export function breakExcess(s: HistoryState, ps: PolityState, og: GrudgeState, r: number, p: number, q: number, adv: number, kase: number): number {
  const delta = oathDelta(s, ps, p)
  lastDelta = delta
  og.diag.deltaSum += delta; og.diag.deltaN++
  const win = (adv * adv) / (1 + adv * adv)
  const take = borderTowns(s, ps, r, p, q, OATH.takeMax, ps.pCapital[q], towns)
  const gain = (s.rul !== null ? rulerWar(s.rul, p) : 1) * win * (take / (ps.pPop[p] + 1))
  const t = tradeLoss(og, r)
  let a = 0
  if (kase === OathCase.AllyAttack) { const k = allianceBond(ps, p, q); if (k >= 0) a = OATH.allyW * allianceWorth(s, ps, p, ps.bThreat[k]) }
  if (s.rul !== null && tied(s.rul, p, q)) a += OATH.tieW
  const wc = OATH.warCost * finWarCost(s, ps, p)
  const tr = gain + OATH.threatW * threatAt(s, ps, r, q, p) - wc - (t + a)
  const rp = t + a + OATH.hostile * wc
  return noteExcess(og, oathExcess(delta, tr, rp, kase === OathCase.Truce ? OATH.faithTruce : OATH.faithAlly, rulerPiety(s, p)))
}

function noteExcess(og: GrudgeState, E: number): number {
  if (E > 0) og.diag.excessPos++
  if ((og.diag.deltaN & 7) === 0) og.diag.excessSample.push(E)
  return E
}

/** The declaration chance factor of a broken oath: breakMul * smoothstep(0, breakSpan, E). */
export function breakFactor(E: number): number {
  return OATH.breakMul * smoothstep(0, OATH.breakSpan, E)
}

/** A broken oath: p made war (war w) on q against its truce (extra 0) or its alliance (extra 1). */
export function oathBroken(s: HistoryState, ps: PolityState, og: GrudgeState, p: number, q: number, w: number, extra: number): void {
  const ally = extra === 1
  recordGrievance(s, ps, og, ally ? GrievanceKind.AllyBetrayed : GrievanceKind.TruceBroken, q, p, ally ? OATH.wAlly : OATH.wTruce, ps.pCapital[q], w)
  addFaith(og, p, ally ? OATH.faithAlly : OATH.faithTruce)
  witnesses(ps, p, q)
  if (ally) {
    const k = allianceBond(ps, p, q)
    if (k >= 0) endBond(s, ps, k, BondEnd.Betrayed)
    og.diag.alliesAttacked++
  } else og.diag.trucesBroken++
  og.diag.breakDeltaSum += lastDelta; og.diag.breakDeltaN++
  if (lastDelta < 0.6) og.diag.breaksByLowDelta++
  if (ps.why) whyOath(ps.why, w) // causes: declared against an oath
  logX(s, EventType.OathBroken, ps.pCapital[p], ps.pCapital[q], w, extra)
}

function addFaith(og: GrudgeState, p: number, f: number): void {
  const x = at(og.faith, p, 0) + f
  put(og.faith, p, x > OATH.repMax ? OATH.repMax : x, 0)
}

/** The witnesses of p's broken faith with q: its neighbours, q's allies and q's people gain rivalry with p. */
function witnesses(ps: PolityState, p: number, q: number): void {
  const R = ps.relA.length
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (a !== p && b !== p) continue
    const c = a === p ? b : a
    if (c === q || ps.pEnded[c] >= 0) continue
    if (!(ps.relEdges[r].length > 0 || allied(ps, c, q) || ps.pPeople[c] === ps.pPeople[q])) continue
    const x = ps.relR[r] + OATH.witnessR
    if (ps.why) whyRelSet(ps.why, r, RivalryPart.Reputation, ps.relR[r], x > 2 ? 2 : x) // causes:
    ps.relR[r] = x > 2 ? 2 : x
  }
}

/** The C7 reputation factor of an alliance of x and y: 1 / (1 + repAlliance * (f_x + f_y)), or undefined when neither is doubted. */
export function repFactor(og: GrudgeState | null, x: number, y: number): number | undefined {
  if (og === null || !og.oaths) return undefined
  const f = faithOf(og, x) + faithOf(og, y)
  return f > 0 ? 1 / (1 + OATH.repAlliance * f) : undefined
}

/** The chance that x comes to the defence of its ally or vassal q against p (threshold on the existing draw). */
export function joinChance(s: HistoryState, ps: PolityState, p: number, q: number, x: number): number {
  const og = ps.og
  if (og === null) return ALLIANCE.join
  let c = ALLIANCE.join
  if (og.balance) { const j = ALLIANCE.join * (ALIGN.joinBase + ALIGN.joinTheta * threatOf(s, ps, p, x)); c = j > ALIGN.joinMax ? ALIGN.joinMax : j }
  if (og.oaths) { const f = faithOf(og, q); if (f > 0) c /= 1 + OATH.repAlliance * f }
  return c
}

/** Grows the per-war links for war w (declare). */
export function linkAlly(og: GrudgeState, w: number, joined: number): void {
  put(og.wAlly, w, joined, -1)
}

// --- Betrayal in war ------------------------------------------------------------------------------------

/** System part (every POLITY.step, after the bonds): allies in a defensive war may make a separate peace or turn. */
export function betrayalStep(s: HistoryState, ps: PolityState, og: GrudgeState, closeWar: (w: number, outcome: number) => void, declare: (r: number, p: number, q: number) => void): void {
  if (!og.oaths || ps.activeWars.length === 0) return
  const rng = og.rng!
  const wars = ps.activeWars.slice()
  for (const wx of wars) {
    const wq = at(og.wAlly, wx, -1)
    if (wq < 0 || ps.wEnd[wx] >= 0 || ps.wEnd[wq] >= 0) continue
    const x = ps.wAtt[wx], e = ps.wDef[wx], q = ps.wDef[wq]
    if (ps.pEnded[x] >= 0 || ps.pEnded[e] >= 0 || ps.pEnded[q] >= 0 || x === q) continue
    const k = allianceBond(ps, x, q)
    if (k < 0) continue // (only alliances are betrayed: an overlord defending its vassal is not)
    const r = relIdx(ps, x, e)
    if (r < 0) continue
    let tired = ps.pExh[x]
    if (tired > 1) tired = 1
    const offer = borderTowns(s, ps, r, x, e, OATH.cedeMax, ps.pCapital[e], towns)
    if (!(offer > 0 || tired > 0.5)) continue
    const delta = oathDelta(s, ps, x)
    og.diag.deltaSum += delta; og.diag.deltaN++
    const value = offer / (ps.pPop[x] + 1)
    const a = OATH.allyW * allianceWorth(s, ps, x, ps.bThreat[k]) + (s.rul !== null && tied(s.rul, x, q) ? OATH.tieW : 0)
    const bond = grudge(og, x, e) + relationOf(ps, x, e) / 2 + (s.rul !== null && tied(s.rul, x, q) ? 0.5 : 0) + (ps.pPeople[x] === ps.pPeople[q] ? 0.25 : 0)
    const wc = OATH.warCost * finWarCost(s, ps, x)
    const tr = value + OATH.threatW * threatAt(s, ps, r, e, x) + wc * (1 + tired) - a
    const rp = a + OATH.bondW * bond + OATH.hostile * wc
    const E = noteExcess(og, oathExcess(delta, tr, rp, OATH.faithAlly, rulerPiety(s, x)))
    if (rng.next() >= POLITY.step * OATH.defect * smoothstep(0, OATH.breakSpan, E)) continue
    // Defection: the Betrayal first, then the ceded towns (Joined), the peace and any new war.
    const turn = relationOf(ps, x, q) >= OATH.turnR && relIdx(ps, x, q) >= 0 && ps.relEdges[relIdx(ps, x, q)].length > 0 && advantageAt(s, ps, x, q) >= 1
    endBond(s, ps, k, BondEnd.Betrayed)
    recordGrievance(s, ps, og, GrievanceKind.AllyBetrayed, q, x, OATH.wAlly, ps.pCapital[q], wx)
    addFaith(og, x, OATH.faithAlly)
    witnesses(ps, x, q)
    og.diag.betrayals++
    og.diag.breakDeltaSum += delta; og.diag.breakDeltaN++
    if (delta < 0.6) og.diag.breaksByLowDelta++
    logX(s, EventType.Betrayal, ps.pCapital[x], ps.pCapital[q], wx, turn ? 1 : 0)
    let ceded = 0
    for (const v of towns) {
      if (ps.polity[v] !== e || v === ps.pCapital[e]) continue
      setPolity(s, ps, v, x, distTo(ps, x, v, s.abandoned))
      ps.conqueredAt[v] = s.year
      ps.unrest[v] = 0.3
      if (s.pop[v] >= TOWN_POPULATION) logEvent(s, EventType.Joined, v, ps.pCapital[x], x)
      ceded++
    }
    og.diag.separatePeace++
    closeWar(wx, ceded > 0 ? WarOutcome.AttackerGains : WarOutcome.WhitePeace)
    if (turn && ps.pWars[x] < WAR.maxWars && ps.pEnded[q] < 0 && ps.relWar[relIdx(ps, x, q)] < 0) {
      const w = ps.wKind.length
      declare(relIdx(ps, x, q), x, q)
      if (ps.why) whyOath(ps.why, w) // causes: it turned on its ally
      og.diag.turned++
    }
  }
}
