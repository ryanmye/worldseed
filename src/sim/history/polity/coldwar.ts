// cold wars (barriers-coldwar.md §3; grudges addendum "barriers & cold war"; HistoryOptions.coldWars; stream 'history-coldwar').
//
// A cold war is an emergent condition between two great rivals that are deterred from fighting each other (CW-R1: deterrence
// is the cause; nothing here damps C1). What it adds is the displacement of conflict (Snyder 1965's stability-instability
// paradox): proxy aid, courting and stealing clients, spies, and crises. Every effect goes through an existing quantity:
//   - proxy aid: money through finances (finSpend 'subsidy' by the sponsor, finCredit 'subsidy' to the side, 0.7 of it), or the
//     capitals' wealth without a monetised crown; strength through battles' M_aid in the CB stack (compose.ts); a ProxyAid
//     grievance (GrievanceKind 17) of the side aided against (CW-R3: no C6 or C2 factor);
//   - spheres: C7 factor 6 `sphere` (compose.ts) for a principal allying against the other principal; defection of clients;
//   - espionage: beliefs' spy target + CW.spy * kappa (deception.ts reads cwSpyBoost);
//   - crises: backdown (credibility), compromise (rivalry falls), or escalation to war through war.ts declare() on its own path
//     (CW-R2), less likely with fast news (Washington-Moscow link, 1963).
//
// Intensity (§3.1):  kappa_ab = smoothstep(1.0, 1.8, R_ab) * pi_ab,  pi_ab = min(M_a, M_b) / max(M_a, M_b)
//   (M: the other's belief of each when beliefs is on, else pMass). A cold war begins when both are Kingdom+, each holds at
//   least CW.great of the summed mass of the polities in contact with either (Waltz 1964's bipolar dominance), R >= CW.rOn for
//   CW.rivalYears, an arms race is open (arms off: R >= CW.raceR), pi >= CW.parity, and they have not fought for CW.quiet years.
// Endings (§3.5): Thaw (R < CW.thawR for CW.thawYears), HotWar (any war between them: cwDeclared), Collapsed (a side in crisis
// that lost CW.collapseLoss of its mass within CW.collapseYears, or that broke apart), Eclipsed (pi < CW.eclipse for
// CW.eclipseYears, or one bowed to the other), Ended (a side ended otherwise).
// The crisis of a side (for Collapsed) is finDefaulted, a contested throne (inCrisis) or a civil war: the proxy for society's
// Psi until society lands.
//
// Draw order per slow step (all 'history-coldwar', cold wars in id order within each part): proxies (cold war, principal a then
// b, active wars ascending: one draw per (cold war, principal, war) with an eligible side, while it does not already aid one),
// defections (cold war, principal a then b, its clients in bond order: one draw each where the chance > 0), crises (one draw
// per cold war; a second for the resolution on a hit; a third for escalation when it comes to that).
// Phase 4 hook: ideological blocs (MIR) set the ideological flag and add CW.ideo to kappa (ideoOf; always 0 for now).

import { BondEnd, BondKind, ColdWarEnd, CrisisOutcome, EventType, GrievanceKind, PolityEnd, RivalryPart, WarKind, WarMotive } from '../../../contract.ts'
import type { ColdWars, EventType as EventTypeT } from '../../../contract.ts'
import type { Rng } from '../../rng.ts'
import { createRng } from '../../rng.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import type { CBFactors, C7Factors } from '../compose.ts'
import { ALIGN, POLITY, WAR } from './params.ts'
import type { PolityState } from './state.ts'
import { Tier, inContact, tierOf } from './state.ts'
import { at, put } from './grudgeState.ts'
import { recordGrievance } from './grievances.ts'
import { alliances, ally, endBond, overlordOf, subject } from './bonds.ts'
import { relIdx } from './relations.ts'
import { atWar } from './formation.ts'
import { bound } from './policy.ts'
import { rulerWar } from '../rulers/system.ts' // rulers:
import { finDefaulted, finCredit, finMonetised, finRevOrd, finSpend } from '../finance/hooks.ts' // finance:
import { BELIEF } from '../beliefs/params.ts' // beliefs:
import { whyPending, whyRelSet } from '../why.ts' // causes:

/** Cold-war parameters (barriers-coldwar §3). Every value is a design default [A] unless a source is named in the plan. */
export const CW = {
  /** HistoryOptions.coldWars default (false until the harness CW1-CW8 passes and the flip PR lands; R29). */
  enabled: false,
  /** Detection: share of the summed mass in contact either holds; rivalry on and its years; R that stands for an arms race with arms off; parity (with deterrence: parityDeter); years without war. */
  great: 0.15,
  rOn: 1.2,
  rivalYears: 30,
  raceR: 1.4,
  parity: 0.5,
  parityDeter: 0.25,
  quiet: 50, // (plan 25; harness: at 25 most cold wars were pairs merely between wars, 60-90% ended hot within decades)
  /** kappa's rivalry ramp. */
  kLo: 1.0,
  kHi: 1.8,
  /** Phase 4: kappa += ideo for an ideological cold war. */
  ideo: 0.3,
  /** Proxies: base chance a slow step (* kappa * 4 r (1 - r) * (1 + rival aid)); rivalry with the side's enemy that qualifies; aid a year as a share of revenue; share reaching the side; M_aid's k; the grievance's weight. */
  proxy: 1.0, // (plan 0.25: with 1-3 wars open at a time it gave a median of 0 proxies per cold war)
  proxyR: 0.6,
  aidShare: 0.03,
  aidPass: 0.7,
  aidK: 0.25,
  wProxy: 0.15,
  /** Spheres: C7 sphere = 1 + sphere * kappa; defection base chance a slow step; the aid balance term. */
  sphere: 0.5,
  defect: 0.03,
  aidBal: 0.2,
  /** Espionage: beliefs' spy target + spy * kappa. */
  spy: 0.3,
  /** Crises: chance a slow step (* kappa * (1 + flare * [a proxy began or a client defected this step])); backdown and compromise thresholds of the second draw; the rivalry a compromise sheds. */
  crisis: 0.25, // (plan 0.08 gives 0.8 kappa crises a century, below CW6's 1-5)
  flare: 0.5,
  backdown: 0.6,
  compromise: 0.85,
  compromiseR: 0.1,
  /** Escalation: chance * lagMul (0.2 + 0.8 l / (l + lagHalf), l in days) * (both deterred ? deterEsc : 1). */
  esc: 0.6, // (plan 0.12 gives an escalated share of 0.15 * 0.12 = 2%, below CW6's 5-25%)
  lagHalf: 3,
  deterEsc: 0.3,
  /** Endings: thaw below thawR for thawYears; collapse: crisis and a loss of collapseLoss of the peak mass within collapseYears; eclipse: pi below eclipse for eclipseYears. */
  thawR: 0.7,
  thawYears: 20,
  collapseLoss: 0.3,
  collapseYears: 30,
  eclipse: 0.3,
  eclipseYears: 20,
  /** Detente: kappa below detente * peak (extra 0); back above refreeze * peak (extra 1). */
  detente: 0.5,
  refreeze: 0.7,
  /** News lag proxy (barriers §2.3) when barriers is off: km/day on foot, couriers (Empire tier), sail; path factor. */
  vFoot: 25,
  vCourier: 67,
  vSail: 120,
  path: 1.3,
}

export interface ColdWarDiag {
  /** Rivalry spells (R >= rOn for rivalYears, both Kingdom+) seen, and those that became cold wars (CW1). */
  longRivalries: number
  longBecame: number
  proxies: number
  /** (cold war, principal, war) triples with an eligible side (one draw each), and wars looked at. */
  proxyEligible: number
  proxyLooked: number
  aidPaid: number
  aidUnpaid: number
  aidSpent: number
  defections: number
  crises: number
  escalated: number
  /** C7 sphere factors applied, and how many hit C7's clamp (C7 test: clamp share <= 1%). */
  sphereN: number
  /** CB aid factors applied. */
  aidBattles: number
  /** Detection checks that passed each condition (tuning). */
  gate: number[]
}

export interface ColdWarState {
  /** 'history-coldwar'. */
  rng: Rng
  // --- Lazy per-relation arrays ---
  /** Year the current spell of R >= rOn began (-1 none); the spell already counted as a long rivalry (its start year, or -1). */
  relRival: number[]
  relCounted: number[]
  /** The spell (its start year) that already became a cold war (CW1), or -1. */
  relBecame: number[]
  /** The open cold war (-1), and the year the last one between them ended. */
  relCw: number[]
  relCwEnd: number[]
  // --- The table (ids in order of starting) ---
  a: number[]; b: number[]; rel: number[]; start: number[]; end: number[]; cause: number[]; war: number[]; ideo: number[]
  proxies: number[]; crises: number[]; defections: number[]; peak: number[]; peakY: number[]; kappa: number[][]
  /** Working values: kappa now, its peak (float), the years R stayed below thawR / pi below eclipse since, detente (1 eased), flare this step, mass samples of each side. */
  kNow: number[]; kPeak: number[]; lowSince: number[]; eclSince: number[]; eased: number[]; flare: number[]
  massA: number[][]; massB: number[][]
  /** Open cold wars, ascending. */
  active: number[]
  // --- Aid rows: sponsor, side aided, war, cold war, start, end (-1 open), the side's enemy ---
  aP: number[]; aS: number[]; aW: number[]; aCw: number[]; aStart: number[]; aEnd: number[]; aO: number[]; aAtt: number[]
  activeAid: number[]
  /** Per war: sponsors aiding its attacker and its defender. */
  wAidA: number[]; wAidD: number[]
  /** Per polity: the spy boost (CW.spy * the highest kappa of its cold wars). */
  pSpy: number[]
  diag: ColdWarDiag
}

export function createColdWars(seed: number): ColdWarState {
  return {
    rng: createRng(seed, 'history-coldwar'),
    relRival: [], relCounted: [], relBecame: [], relCw: [], relCwEnd: [],
    a: [], b: [], rel: [], start: [], end: [], cause: [], war: [], ideo: [], proxies: [], crises: [], defections: [], peak: [], peakY: [], kappa: [],
    kNow: [], kPeak: [], lowSince: [], eclSince: [], eased: [], flare: [], massA: [], massB: [],
    active: [],
    aP: [], aS: [], aW: [], aCw: [], aStart: [], aEnd: [], aO: [], aAtt: [], activeAid: [],
    wAidA: [], wAidD: [], pSpy: [],
    diag: { longRivalries: 0, longBecame: 0, proxies: 0, proxyEligible: 0, proxyLooked: 0, aidPaid: 0, aidUnpaid: 0, aidSpent: 0, defections: 0, crises: 0, escalated: 0, sphereN: 0, aidBattles: 0, gate: [0, 0, 0, 0, 0] },
  }
}

function logX(s: HistoryState, type: EventTypeT, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

const byte = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0)
const kingdom = (ps: PolityState, x: number): boolean => tierOf(ps.pPop[x], ps.pMembers[x], ps.pMulti[x] === 1, ps.worldPop) >= Tier.Kingdom

/** Phase 4 hook (MIR): 1 when the two regimes' families are hostile (AFF <= -0.5). Always 0 until ideologies land. */
function ideoOf(_ps: PolityState, _a: number, _b: number): number {
  return 0
}

/** Phase 4 hook (future-tech): both hold `deterrence`. Never before future-tech lands. */
function deterred(_s: HistoryState, _a: number, _b: number): boolean {
  return false
}

/** The masses of a and b as each is seen by the other (beliefs on), else their true masses. */
let mA = 0, mB = 0
function seenMasses(s: HistoryState, ps: PolityState, r: number, a: number, b: number): void {
  mA = ps.pMass[a]; mB = ps.pMass[b]
  const bel = s.bel
  if (bel === null) return
  const ea = 2 * r + 1 < bel.est.length ? bel.est[2 * r + 1] : 0 // (relB's estimate of relA)
  const eb = 2 * r < bel.est.length ? bel.est[2 * r] : 0 // (relA's estimate of relB)
  const ra = ps.relA[r] === a
  const ma = ra ? ea : eb, mb = ra ? eb : ea
  if (ma > 0) mA = ma
  if (mb > 0) mB = mb
}

function parityOf(): number {
  const lo = mA < mB ? mA : mB, hi = mA < mB ? mB : mA
  return hi > 0 ? lo / hi : 0
}

/** kappa of relation r between a and b now (sets mA, mB). */
function kappaOf(s: HistoryState, ps: PolityState, r: number, a: number, b: number, ideo: number): number {
  seenMasses(s, ps, r, a, b)
  const k = smoothstep(CW.kLo, CW.kHi, ps.relR[r]) * parityOf() + (ideo ? CW.ideo : 0)
  return k > 1 ? 1 : k
}

/** News lag in days between the capitals of a and b: barriers' newsLag when barriers is on, else the same proxy here (barriers §2.3). */
export function cwLag(s: HistoryState, ps: PolityState, a: number, b: number): number {
  const P = s.world.grid.positions
  const ca = s.cell[ps.pCapital[a]], cb = s.cell[ps.pCapital[b]]
  const x1 = P[ca * 3], y1 = P[ca * 3 + 1], z1 = P[ca * 3 + 2], x2 = P[cb * 3], y2 = P[cb * 3 + 1], z2 = P[cb * 3 + 2]
  const r1 = Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1) || 1, r2 = Math.sqrt(x2 * x2 + y2 * y2 + z2 * z2) || 1
  const dx = x1 / r1 - x2 / r2, dy = y1 / r1 - y2 / r2, dz = z1 / r1 - z2 / r2
  const h = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2
  const d = 2 * 6371 * (h + (h * h * h) / 6 + (3 * h * h * h * h * h) / 40)
  const lm = s.terrain.landmass
  const emp = tierOf(ps.pPop[a], ps.pMembers[a], ps.pMulti[a] === 1, ps.worldPop) >= Tier.Empire || tierOf(ps.pPop[b], ps.pMembers[b], ps.pMulti[b] === 1, ps.worldPop) >= Tier.Empire
  return CW.path * d * (lm[ca] !== lm[cb] ? 1 / CW.vSail : 1 / (emp ? CW.vCourier : CW.vFoot))
}

/** x is a client of P: its ally, or its vassal or tributary. */
function clientOf(ps: PolityState, x: number, P: number): boolean {
  if (x === P || x < 0) return false
  if (overlordOf(ps, x) === P) return true
  for (const k of ps.activeBonds) if (ps.bKind[k] === BondKind.Alliance && ((ps.bA[k] === x && ps.bB[k] === P) || (ps.bA[k] === P && ps.bB[k] === x))) return true
  return false
}

/** A side in crisis (for Collapsed): its crown defaulted, its throne contested, or it fights a civil war. */
function inTrouble(s: HistoryState, ps: PolityState, x: number): boolean {
  if (finDefaulted(s, x)) return true
  for (const w of ps.activeWars) if (ps.wKind[w] === WarKind.CivilWar && (ps.wAtt[w] === x || ps.wDef[w] === x)) return true
  return false
}

/** The prestige proxy of p beside q (migration's Pi before it lands, barriers §2.2): half its share of their mass, half of their capitals' wealth. */
function prestige(s: HistoryState, ps: PolityState, p: number, q: number): number {
  const m = ps.pMass[p] + ps.pMass[q]
  const wp = s.wealth[ps.pCapital[p]], wq = s.wealth[ps.pCapital[q]]
  const w = wp + wq
  return 0.5 * (m > 0 ? ps.pMass[p] / m : 0.5) + 0.5 * (w > 0 ? wp / w : 0.5)
}

/** The resolve of x in a crisis with y: its believed advantage * credibility * the ruler's warlikeness. */
function resolve(s: HistoryState, ps: PolityState, r: number, x: number, y: number): number {
  seenMasses(s, ps, r, x, y)
  const adv = mB > 0 ? ps.pMass[x] / mB : 1
  const cred = s.bel !== null && x < s.bel.cred.length ? s.bel.cred[x] : 1
  return adv * cred * (s.rul !== null ? rulerWar(s.rul, x) : 1)
}

/** The revenue unit of p: R° with a monetised crown, else beliefs' unitMass * pMass. */
function unitOf(s: HistoryState, ps: PolityState, p: number): number {
  return finMonetised(s, p) ? finRevOrd(s, p) : BELIEF.unitMass * ps.pMass[p]
}

/** p pays `amount` of aid to x (from the treasury with a monetised crown, else from the capital's wealth); true if paid. */
function payAid(s: HistoryState, ps: PolityState, cw: ColdWarState, p: number, x: number, amount: number): boolean {
  if (!(amount > 0)) return true
  if (finMonetised(s, p)) {
    if (!finSpend(s, p, amount, 'subsidy')) return false
    if (finMonetised(s, x)) finCredit(s, x, CW.aidPass * amount, 'subsidy')
    else s.wealth[ps.pCapital[x]] += CW.aidPass * amount
  } else {
    const c = ps.pCapital[p]
    if (c < 0 || s.wealth[c] < amount) return false
    s.wealth[c] -= amount
    if (finMonetised(s, x)) finCredit(s, x, CW.aidPass * amount, 'subsidy')
    else s.wealth[ps.pCapital[x]] += CW.aidPass * amount
  }
  cw.diag.aidSpent += amount
  return true
}

function stopAid(s: HistoryState, cw: ColdWarState, i: number): void {
  if (cw.aEnd[i] >= 0) return
  cw.aEnd[i] = s.year
  const w = cw.aW[i]
  if (cw.aAtt[i] === 1) cw.wAidA[w]--
  else cw.wAidD[w]--
  const k = cw.activeAid.indexOf(i)
  if (k >= 0) cw.activeAid.splice(k, 1)
}

function endColdWar(s: HistoryState, ps: PolityState, cw: ColdWarState, i: number, cause: number, war: number): void {
  if (cw.end[i] >= 0) return
  cw.end[i] = s.year
  cw.cause[i] = cause
  cw.war[i] = war
  put(cw.relCw, cw.rel[i], -1, -1)
  put(cw.relCwEnd, cw.rel[i], s.year, -1)
  const k = cw.active.indexOf(i)
  if (k >= 0) cw.active.splice(k, 1)
  for (const j of cw.activeAid.slice()) if (cw.aCw[j] === i) stopAid(s, cw, j)
  logX(s, EventType.ColdWarEnded, ps.pCapital[cw.a[i]], ps.pCapital[cw.b[i]], i, cause)
}

/** declare hook: a war between the principals of an open cold war ends it (HotWar). */
export function cwDeclared(s: HistoryState, ps: PolityState, cw: ColdWarState, r: number, w: number): void {
  const i = at(cw.relCw, r, -1)
  if (i < 0) return
  endColdWar(s, ps, cw, i, ColdWarEnd.HotWar, w)
}

/** Battle hook (CB stack): M_aid of the striker p against q in war w, or undefined when neither side is aided. */
const CBF: CBFactors = {}
export function cwAid(ps: PolityState, w: number, p: number): CBFactors | undefined {
  const cw = ps.cw
  if (cw === null || w >= cw.wAidA.length) return undefined
  const att = ps.wAtt[w] === p
  const ap = att ? cw.wAidA[w] : cw.wAidD[w], aq = att ? cw.wAidD[w] : cw.wAidA[w]
  if (ap <= 0 && aq <= 0) return undefined
  cw.diag.aidBattles++
  CBF.aid = (1 + CW.aidK * ap) / (1 + CW.aidK * aq)
  return CBF
}

/** C7 hook: f with the sphere factor added when x or y is a principal allying against the other principal (c), else f itself. */
const C7S: C7Factors = {}
export function cwSphere(ps: PolityState, x: number, y: number, c: number, f: C7Factors | undefined): C7Factors | undefined {
  const cw = ps.cw
  if (cw === null || c < 0 || cw.active.length === 0) return f
  let k = -1
  for (const i of cw.active) {
    const a = cw.a[i], b = cw.b[i]
    if ((c === a && (x === b || y === b)) || (c === b && (x === a || y === a))) { if (cw.kNow[i] > k) k = cw.kNow[i] }
  }
  if (k < 0) return f
  C7S.balance = f?.balance; C7S.reputation = f?.reputation; C7S.affinity = f?.affinity; C7S.court = f?.court; C7S.talk = f?.talk; C7S.seat = f?.seat
  C7S.sphere = 1 + CW.sphere * k
  cw.diag.sphereN++
  return C7S
}

/** beliefs hook (spy service target): CW.spy * the highest kappa of p's cold wars (as of the last cold-war step). */
export function cwSpyBoost(cw: ColdWarState, p: number): number {
  return at(cw.pSpy, p, 0)
}

/** System part (every slow step, after armsStep and beliefStep, before declarations): endings, detection, kappa, proxies, defections, crises. */
export function coldWarStep(s: HistoryState, ps: PolityState, cw: ColdWarState, declareFn: (r: number, p: number, q: number) => void): void {
  const X = CW
  const R = ps.relA.length
  const y = s.year
  // 1. Endings of the open cold wars (no draws): a side ended, bowed, collapsed or was eclipsed; or the rivalry thawed.
  for (const i of cw.active.slice()) {
    const a = cw.a[i], b = cw.b[i], r = cw.rel[i]
    cw.flare[i] = 0
    const endA = ps.pEnded[a] >= 0, endB = ps.pEnded[b] >= 0
    if (endA || endB) {
      const e = endA ? ps.pEnd[a] : ps.pEnd[b]
      endColdWar(s, ps, cw, i, e === PolityEnd.Fragmented || e === PolityEnd.Reunified ? ColdWarEnd.Collapsed : ColdWarEnd.Ended, -1)
      continue
    }
    if (overlordOf(ps, a) === b || overlordOf(ps, b) === a) { endColdWar(s, ps, cw, i, ColdWarEnd.Eclipsed, -1); continue }
    cw.massA[i].push(ps.pMass[a]); cw.massB[i].push(ps.pMass[b])
    const n = Math.floor(X.collapseYears / POLITY.slowStep) + 1
    if (cw.massA[i].length > n) { cw.massA[i].shift(); cw.massB[i].shift() }
    let collapsed = false
    for (let side = 0; side < 2 && !collapsed; side++) {
      const x = side === 0 ? a : b, ms = side === 0 ? cw.massA[i] : cw.massB[i]
      let pk = 0
      for (const m of ms) if (m > pk) pk = m
      if (pk > 0 && ps.pMass[x] <= (1 - X.collapseLoss) * pk && inTrouble(s, ps, x)) collapsed = true
    }
    if (collapsed) { endColdWar(s, ps, cw, i, ColdWarEnd.Collapsed, -1); continue }
    const k = kappaOf(s, ps, r, a, b, cw.ideo[i])
    const pi = parityOf()
    if (pi < X.eclipse) { if (cw.eclSince[i] < 0) cw.eclSince[i] = y } else cw.eclSince[i] = -1
    if (ps.relR[r] < X.thawR) { if (cw.lowSince[i] < 0) cw.lowSince[i] = y } else cw.lowSince[i] = -1
    if (cw.eclSince[i] >= 0 && y - cw.eclSince[i] >= X.eclipseYears) { endColdWar(s, ps, cw, i, ColdWarEnd.Eclipsed, -1); continue }
    if (cw.lowSince[i] >= 0 && y - cw.lowSince[i] >= X.thawYears) { endColdWar(s, ps, cw, i, ColdWarEnd.Thaw, -1); continue }
    cw.kNow[i] = k
    if (k > cw.kPeak[i]) { cw.kPeak[i] = k; cw.peak[i] = byte(k); cw.peakY[i] = y }
    cw.kappa[i].push(byte(k))
    if (cw.eased[i] === 0 && k < X.detente * cw.kPeak[i]) { cw.eased[i] = 1; logX(s, EventType.Detente, ps.pCapital[a], ps.pCapital[b], i, 0) }
    else if (cw.eased[i] === 1 && k > X.refreeze * cw.kPeak[i]) { cw.eased[i] = 0; logX(s, EventType.Detente, ps.pCapital[a], ps.pCapital[b], i, 1) }
  }
  // 2. Detection (no draws), relations in order.
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0) { if (at(cw.relRival, r, -1) >= 0) put(cw.relRival, r, -1, -1); continue }
    const Rr = ps.relR[r]
    let since = at(cw.relRival, r, -1)
    if (Rr >= X.rOn) { if (since < 0) { since = y; put(cw.relRival, r, y, -1) } } else { if (since >= 0) put(cw.relRival, r, -1, -1); continue }
    if (y - since < X.rivalYears) continue
    const g = cw.diag.gate
    if (!kingdom(ps, a) || !kingdom(ps, b)) continue
    const fresh = at(cw.relCounted, r, -1) !== since
    if (fresh) { put(cw.relCounted, r, since, -1); cw.diag.longRivalries++ }
    if (at(cw.relCw, r, -1) >= 0) continue
    g[0]++
    if (ps.relWar[r] >= 0 || y - ps.relLastWar[r] < X.quiet || y - at(cw.relCwEnd, r, -1000000) < X.quiet) continue
    g[1]++
    const race = ps.og !== null && ps.og.arms ? at(ps.og.relRace, r, -1) >= 0 : Rr >= X.raceR
    if (!race) continue
    g[2]++
    if (bound(ps, a, b)) continue
    seenMasses(s, ps, r, a, b)
    if (parityOf() < (deterred(s, a, b) ? X.parityDeter : X.parity)) continue
    g[3]++
    // each holds >= great of the summed mass of the polities in contact with either
    const pa = ps.pPeople[a], pb = ps.pPeople[b]
    let tot = 0
    for (const x of ps.alive) if (inContact(s, pa, ps.pPeople[x]) || inContact(s, pb, ps.pPeople[x])) tot += ps.pMass[x]
    if (!(tot > 0) || ps.pMass[a] < X.great * tot || ps.pMass[b] < X.great * tot) continue
    g[4]++
    const i = cw.a.length
    const ideo = ideoOf(ps, a, b)
    const k = kappaOf(s, ps, r, a, b, ideo)
    cw.a.push(a); cw.b.push(b); cw.rel.push(r); cw.start.push(y); cw.end.push(-1); cw.cause.push(0); cw.war.push(-1); cw.ideo.push(ideo)
    cw.proxies.push(0); cw.crises.push(0); cw.defections.push(0); cw.peak.push(byte(k)); cw.peakY.push(y); cw.kappa.push([byte(k)])
    cw.kNow.push(k); cw.kPeak.push(k); cw.lowSince.push(-1); cw.eclSince.push(-1); cw.eased.push(0); cw.flare.push(0)
    cw.massA.push([ps.pMass[a]]); cw.massB.push([ps.pMass[b]])
    cw.active.push(i)
    put(cw.relCw, r, i, -1)
    if (at(cw.relBecame, r, -1) !== since) { put(cw.relBecame, r, since, -1); cw.diag.longBecame++ }
    logX(s, EventType.ColdWarBegan, ps.pCapital[a], ps.pCapital[b], i, ideo)
  }
  if (cw.active.length === 0) { spyBoosts(ps, cw); return }
  const rng = cw.rng
  // 3. Proxies: the aid in force is paid (or stops); new aid is drawn.
  for (const j of cw.activeAid.slice()) {
    const w = cw.aW[j], p = cw.aP[j], x = cw.aS[j]
    if (ps.wEnd[w] >= 0 || ps.pEnded[p] >= 0 || ps.pEnded[x] >= 0) { stopAid(s, cw, j); continue }
    if (!payAid(s, ps, cw, p, x, X.aidShare * unitOf(s, ps, p) * POLITY.slowStep)) { cw.diag.aidUnpaid++; stopAid(s, cw, j); continue }
    cw.diag.aidPaid++
  }
  const wars = ps.activeWars.slice().sort((u, v) => u - v)
  for (const i of cw.active) {
    const k = cw.kNow[i]
    for (let side = 0; side < 2; side++) {
      const P = side === 0 ? cw.a[i] : cw.b[i], Q = side === 0 ? cw.b[i] : cw.a[i]
      for (const w of wars) {
        if (ps.wEnd[w] >= 0) continue
        const att = ps.wAtt[w], def = ps.wDef[w]
        if (att === P || def === P || ps.pEnded[att] >= 0 || ps.pEnded[def] >= 0) continue
        if (aidOf(cw, P, w) >= 0) continue
        cw.diag.proxyLooked++
        let best = -1, bestO = -1, bestSc = -1
        for (let d = 0; d < 2; d++) {
          const sd = d === 0 ? att : def, o = d === 0 ? def : att
          if (sd === Q || clientOf(ps, sd, Q) || atWar(ps, P, sd)) continue
          if (!(o === Q || clientOf(ps, o, Q) || relationOfIdx(ps, P, o) >= X.proxyR)) continue
          if (!inContact(s, ps.pPeople[P], ps.pPeople[sd])) continue
          const m = ps.pMass[sd] + ps.pMass[o]
          const fr = m > 0 ? ps.pMass[sd] / m : 0.5
          const sc = 4 * fr * (1 - fr)
          if (sc > bestSc) { bestSc = sc; best = sd; bestO = o }
        }
        if (best < 0) continue
        cw.diag.proxyEligible++
        const rival = aidOf(cw, Q, w) >= 0 && cw.aO[aidOf(cw, Q, w)] === best ? 1 : 0 // (Q already backs best's enemy)
        if (rng.next() >= X.proxy * k * bestSc * (1 + rival)) continue
        if (!payAid(s, ps, cw, P, best, X.aidShare * unitOf(s, ps, P) * POLITY.slowStep)) { cw.diag.aidUnpaid++; continue }
        const j = cw.aP.length
        cw.aP.push(P); cw.aS.push(best); cw.aW.push(w); cw.aCw.push(i); cw.aStart.push(y); cw.aEnd.push(-1); cw.aO.push(bestO); cw.aAtt.push(best === att ? 1 : 0)
        cw.activeAid.push(j)
        while (cw.wAidA.length <= w) { cw.wAidA.push(0); cw.wAidD.push(0) }
        if (best === att) cw.wAidA[w]++
        else cw.wAidD[w]++
        cw.proxies[i]++
        cw.flare[i] = 1
        cw.diag.proxies++
        logX(s, EventType.ProxyWar, ps.pCapital[P], ps.pCapital[best], w, i)
        if (ps.og !== null && ps.og.oaths) recordGrievance(s, ps, ps.og, GrievanceKind.ProxyAid, bestO, P, X.wProxy, ps.pCapital[P], w) // grudges: the side aided against holds it
      }
    }
  }
  // 4. Spheres: clients of each principal in contact with the other may defect.
  for (const i of cw.active) {
    if (cw.end[i] >= 0) continue
    const k = cw.kNow[i]
    for (let side = 0; side < 2; side++) {
      const P = side === 0 ? cw.a[i] : cw.b[i], Q = side === 0 ? cw.b[i] : cw.a[i]
      if (ps.pEnded[P] >= 0 || ps.pEnded[Q] >= 0) continue
      const dPi = prestige(s, ps, Q, P) - prestige(s, ps, P, Q)
      for (const kb of ps.activeBonds.slice()) {
        if (ps.bEnd[kb] >= 0) continue
        const kind = ps.bKind[kb]
        let x = -1
        if (kind === BondKind.Alliance) { if (ps.bA[kb] === P) x = ps.bB[kb]; else if (ps.bB[kb] === P) x = ps.bA[kb] }
        else if (ps.bB[kb] === P) x = ps.bA[kb]
        if (x < 0 || x === Q || ps.pEnded[x] >= 0 || !inContact(s, ps.pPeople[x], ps.pPeople[Q]) || atWar(ps, x, Q) || clientOf(ps, x, Q)) continue
        const bal = aidTo(cw, Q, x) - aidTo(cw, P, x)
        const ch = X.defect * k * smoothstep(0, 0.3, dPi + (bal > 0 ? X.aidBal : bal < 0 ? -X.aidBal : 0))
        if (!(ch > 0) || rng.next() >= ch) continue
        if (kind === BondKind.Alliance) {
          const cap = ps.og !== null && ps.og.balance ? ALIGN.maxAlliances : 2
          if (alliances(ps, x) > cap || alliances(ps, Q) >= cap) continue
          endBond(s, ps, kb, BondEnd.Lapsed)
          ally(s, ps, x < Q ? x : Q, x < Q ? Q : x, P)
        } else {
          endBond(s, ps, kb, BondEnd.Lapsed)
          subject(s, ps, x, Q, kind === BondKind.Tribute)
        }
        cw.defections[i]++
        cw.flare[i] = 1
        cw.diag.defections++
        logX(s, EventType.ClientDefected, ps.pCapital[x], ps.pCapital[Q], i, P)
      }
    }
  }
  // 5. Crises.
  for (const i of cw.active.slice()) {
    if (cw.end[i] >= 0) continue
    const a = cw.a[i], b = cw.b[i], r = cw.rel[i]
    if (rng.next() >= X.crisis * cw.kNow[i] * (1 + X.flare * cw.flare[i])) continue
    cw.crises[i]++
    cw.diag.crises++
    const u2 = rng.next()
    const ra = resolve(s, ps, r, a, b), rb = resolve(s, ps, r, b, a)
    let out: number
    if (u2 < X.backdown) {
      const loser = ra < rb ? a : b
      out = loser === a ? CrisisOutcome.BackdownA : CrisisOutcome.BackdownB
      const bel = s.bel
      if (bel !== null && loser < bel.cred.length) { const c = bel.cred[loser] - 0.5 * BELIEF.credHit; bel.cred[loser] = c > 0 ? c : 0 } // beliefs: credibility lost
    } else if (u2 < X.compromise) {
      out = CrisisOutcome.Compromise
      compromise(ps, r)
    } else {
      const l = cwLag(s, ps, a, b)
      const lagMul = 0.2 + (0.8 * l) / (l + X.lagHalf)
      const stander = ra >= rb ? a : b, other = stander === a ? b : a
      const can = ps.relWar[r] < 0 && ps.pWars[stander] < WAR.maxWars && !bound(ps, a, b)
      if (rng.next() < X.esc * lagMul * (deterred(s, a, b) ? X.deterEsc : 1) && can) {
        out = CrisisOutcome.Escalated
        cw.diag.escalated++
        logX(s, EventType.Crisis, ps.pCapital[a], ps.pCapital[b], i, out)
        const w0 = ps.wKind.length
        if (ps.why) whyPending(ps.why, ps.relR[r], 1, 0, 1, false, s.rul !== null ? rulerWar(s.rul, stander) : 1, 1, false, -1, 1) // causes:
        declareFn(r, stander, other) // (CW-R2: its own path; cwDeclared ends the cold war: HotWar)
        const bel = s.bel
        if (bel !== null) { while (bel.wBel.length <= w0) { bel.wBel.push(-1); bel.wTrue.push(-1); bel.wMotive.push(0); bel.wGap0.push(-1) } bel.wMotive[w0] = WarMotive.Crisis } // beliefs: why no bargain held
        continue
      }
      out = CrisisOutcome.Compromise
      compromise(ps, r)
    }
    logX(s, EventType.Crisis, ps.pCapital[a], ps.pCapital[b], i, out)
  }
  spyBoosts(ps, cw)
}

function compromise(ps: PolityState, r: number): void {
  const x = ps.relR[r] - CW.compromiseR
  const v = x > 0 ? x : 0
  if (ps.why) whyRelSet(ps.why, r, RivalryPart.ColdWar, ps.relR[r], v) // causes:
  ps.relR[r] = v
}

function spyBoosts(ps: PolityState, cw: ColdWarState): void {
  for (let p = 0; p < cw.pSpy.length; p++) cw.pSpy[p] = 0
  for (const i of cw.active) {
    const v = CW.spy * cw.kNow[i]
    if (v > at(cw.pSpy, cw.a[i], 0)) put(cw.pSpy, cw.a[i], v, 0)
    if (v > at(cw.pSpy, cw.b[i], 0)) put(cw.pSpy, cw.b[i], v, 0)
  }
  void ps
}

function relationOfIdx(ps: PolityState, p: number, q: number): number {
  const r = relIdx(ps, p, q)
  return r < 0 ? 0 : ps.relR[r]
}

/** The open aid row of sponsor p in war w, or -1. */
function aidOf(cw: ColdWarState, p: number, w: number): number {
  for (const j of cw.activeAid) if (cw.aP[j] === p && cw.aW[j] === w) return j
  return -1
}

/** Open aid rows of sponsor p to x. */
function aidTo(cw: ColdWarState, p: number, x: number): number {
  let n = 0
  for (const j of cw.activeAid) if (cw.aP[j] === p && cw.aS[j] === x) n++
  return n
}

// --- Assembly --------------------------------------------------------------------------------------------

/** History.coldWars (empty when off). */
export function assembleColdWars(ps: PolityState | null): ColdWars {
  const cw = ps !== null ? ps.cw : null
  const n = cw === null ? 0 : cw.a.length
  const kappaOff = new Int32Array(n + 1)
  let L = 0
  for (let i = 0; i < n; i++) { kappaOff[i] = L; L += cw!.kappa[i].length }
  kappaOff[n] = L
  const out: ColdWars = {
    count: n, a: new Int16Array(n), b: new Int16Array(n), start: new Int16Array(n), end: new Int16Array(n), endCause: new Uint8Array(n), war: new Int32Array(n),
    ideological: new Uint8Array(n), proxies: new Uint16Array(n), crises: new Uint16Array(n), defections: new Uint16Array(n), peak: new Uint8Array(n), peakYear: new Int16Array(n),
    kappaOff, kappa: new Uint8Array(L),
  }
  if (cw === null) return out
  for (let i = 0; i < n; i++) {
    out.a[i] = cw.a[i]; out.b[i] = cw.b[i]; out.start[i] = cw.start[i]; out.end[i] = cw.end[i]; out.endCause[i] = cw.cause[i]; out.war[i] = cw.war[i]
    out.ideological[i] = cw.ideo[i]; out.proxies[i] = cw.proxies[i]; out.crises[i] = cw.crises[i]; out.defections[i] = cw.defections[i]
    out.peak[i] = cw.peak[i]; out.peakYear[i] = cw.peakY[i]
    out.kappa.set(cw.kappa[i], kappaOff[i])
  }
  return out
}
