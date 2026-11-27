// beliefs: what polities believe of each other's strength (beliefs-and-deception.md §2.1, §3.2, §3.3, §3.5).
//
// Each observer o holds of each polity t it has a relation with an estimate m^ of t's mass (pMass, the base of Proj), the
// log-variance v of it and a smoothed growth ratio T. Everything else in projAt is public (grip, wars, exhaustion, pay), so
// the believed projection is projBel(o, t, d) = m^ * grip(d, reach_t) / (1 + multiWar (wars_t - 1)) * (1 - exhaustionProj E_t)
// * pay_t. The true mass keeps moving while m^ moves only when o observes, so a stale belief is the default error.
//
// Every slow step (beliefStep, after allianceStep and before declarations) each row drifts (v += vDrift) and, when any
// channel informs it (contact, border, trade: cheap; marriage, envoys, spies: hard; precisions in BELIEF), takes one noisy
// observation y = mass * (I_cheap * shown + I_hard) / I * noise(1 / sqrt I) with a scalar Kalman update on log-strength
// (Kalman 1960): k = v / (v + 1/I), m^ <- m^ * (y / m^)^k, v <- (1 - k) v. A bluff (deception.ts) multiplies what the cheap
// channels see by 1 + bluff * cred. Battles (beliefBattle) and peace (beliefPeace) are precise observations: war reveals
// (Blainey 1973; Slantchev 2003; Smith & Stam 2004).
//
// Arithmetic: + - * / sqrt only (no exp, log or pow in the sim). noise() is a triangular deviate mapped through the [1/1]
// Pade approximant of e^n, (2 + n) / (2 - n), which is exactly log-symmetric; rpow(r, k) ~ r^k is the [1/1] Pade form
// ((1 + k) r + (1 - k)) / ((1 - k) r + (1 + k)), exact at k = 0 and 1 and log-symmetric (error < 3% for r in [1/4, 4]).
//
// Draw order per slow step (all from 'history-beliefs'): initialisations and observations (relations in order, dir 0 then
// 1), then deception.ts (exposures, bluff decisions, spies caught, secret discovery, forgeries). Battles draw 4 per battle
// and the peace 4, in the war's order of events; the bargain one at most per crisis (bargain.ts).

import { BeliefSource, EventType } from '../../../contract.ts'
import type { Rng } from '../../rng.ts'
import type { HistoryState } from '../state.ts'
import type { EventType as EventTypeT } from '../../../contract.ts'
import type { PolityState } from '../polity/state.ts'
import { Tier, grip, inContact, tierOf } from '../polity/state.ts'
import { POLITY, RELATION } from '../polity/params.ts'
import { relIdx } from '../polity/relations.ts'
import { tied } from '../rulers/marriage.ts'
import { BELIEF } from './params.ts'
import type { BeliefState } from './state.ts'
import { ensureBelPolities, ensureBelRows } from './state.ts'
import { deceptionStep } from './deception.ts'
import { barrierStep, eliteE, newsLag, stale } from './barriers.ts' // barriers:

const SQRT6 = 2.449489742783178

/** A log-normal-ish multiplicative deviate with log-sd ~sigma (2 draws): triangular n with variance sigma^2, clamped to +-1.5, through (2 + n) / (2 - n). */
export function noise(rng: Rng, sigma: number): number {
  let n = sigma * SQRT6 * (rng.next() + rng.next() - 1)
  if (n > 1.5) n = 1.5
  else if (n < -1.5) n = -1.5
  return (2 + n) / (2 - n)
}

/** r^k for r > 0, k in [0, 1], by the [1/1] Pade form around r = 1. */
export function rpow(r: number, k: number): number {
  return ((1 + k) * r + (1 - k)) / ((1 - k) * r + (1 + k))
}

/** The battle law's win chance for an advantage x: x^2 / (x^2 + 1). */
export function piWin(x: number): number {
  const x2 = x * x
  return x2 / (x2 + 1)
}

/** The pair row of o's belief of t (-1 when they have no relation). */
export function rowOf(ps: PolityState, o: number, t: number): number {
  const r = relIdx(ps, o, t)
  if (r < 0) return -1
  return 2 * r + (ps.relA[r] === o ? 0 : 1)
}

/** o's estimate of t's mass (the true mass when o has formed none). */
export function believedMass(s: HistoryState, ps: PolityState, o: number, t: number): number {
  const bel = s.bel
  if (bel === null) return ps.pMass[t]
  const k = rowOf(ps, o, t)
  return k >= 0 && k < bel.est.length && bel.est[k] > 0 ? bel.est[k] : ps.pMass[t]
}

/** The projection o believes t has at graph cost d from t's capital (projAt with the believed mass). */
export function projBel(s: HistoryState, ps: PolityState, o: number, t: number, d: number): number {
  const wars = ps.pWars[t]
  let e = ps.pExh[t]
  if (e > 1) e = 1
  return (believedMass(s, ps, o, t) * grip(d, ps.pReach[t])) / (1 + POLITY.multiWar * (wars > 1 ? wars - 1 : 0)) * (1 - POLITY.exhaustionProj * e) * ps.pPay[t]
}

/** Logs an event with an `extra`. */
export function logX(s: HistoryState, type: EventTypeT, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

/** Kingdom or larger. */
export function kingdomPlus(ps: PolityState, p: number): boolean {
  return tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop) >= Tier.Kingdom
}

/** The History.beliefs row of pair row k, made at its first forming. */
function formed(s: HistoryState, bel: BeliefState, k: number, o: number, t: number): void {
  if (bel.hrow[k] >= 0) return
  bel.hrow[k] = bel.hObs.length
  bel.hObs.push(o); bel.hTgt.push(t); bel.hFrom.push(s.year)
}

/** The scalar Kalman update of row k with observation y (mass units) of precision I. */
export function kalman(bel: BeliefState, k: number, y: number, I: number): void {
  const v = bel.varL[k]
  const g = v / (v + 1 / I)
  let r = y / bel.est[k]
  if (r < 0.125) r = 0.125
  else if (r > 8) r = 8
  bel.est[k] *= rpow(r, g)
  let w = (1 - g) * v
  if (w < BELIEF.vMin) w = BELIEF.vMin
  else if (w > BELIEF.vMax) w = BELIEF.vMax
  bel.varL[k] = w
  bel.diag.updates++
}

/** A precise observation of t by o (war, peace, a defector): forms the row if needed (no draw then), else one Kalman update. */
function observe(s: HistoryState, ps: PolityState, bel: BeliefState, o: number, t: number, y: number, I: number, bit: number): void {
  const k = rowOf(ps, o, t)
  if (k < 0) return
  if (k >= bel.est.length) ensureBelRows(bel, ps.relA.length)
  if (bel.est[k] <= 0) {
    bel.est[k] = y; bel.varL[k] = 1 / I; bel.prev[k] = y; bel.trend[k] = 1
    formed(s, bel, k, o, t)
  } else kalman(bel, k, y, I)
  bel.src[k] |= bit
  bel.seen[k] = s.year
}

/** Ruler ability of p, clamped (1 without rulers or a ruler). */
function abilityOf(s: HistoryState, p: number): number {
  const R = s.rul
  if (R === null || p >= R.pcap) return 1
  const r = R.cur[p]
  if (r < 0) return 1
  const a = R.rAbility[r]
  return a < BELIEF.abilityLo ? BELIEF.abilityLo : a > BELIEF.abilityHi ? BELIEF.abilityHi : a
}

/** Envoys: an alliance (known to its members) or a vassal or tribute bond between a and b. */
function bonded(ps: PolityState, a: number, b: number): boolean {
  for (const k of ps.activeBonds) {
    const x = ps.bA[k], y = ps.bB[k]
    if ((x === a && y === b) || (x === b && y === a)) return true
  }
  return false
}

/** System part (every slow step, after allianceStep): every row drifts and observes through its channels; then deception. */
export function beliefStep(s: HistoryState, ps: PolityState, bel: BeliefState): void {
  ensureBelPolities(bel, ps.P)
  const R = ps.relA.length
  ensureBelRows(bel, R)
  const X = BELIEF
  const rng = bel.rng
  const vol = bel.vol
  const shadow = X.shadow
  const rel = s.rel
  const ib = s.ib
  if (ib !== null) barrierStep(s, ps, ib) // barriers: the live tongues, interpreters
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0) continue
    // Channels both ways (cheap: contact, border, trade, faith; hard: marriage, envoys).
    let ic = 0, ih = 0, bits = 0
    if (inContact(s, ps.pPeople[a], ps.pPeople[b])) { ic += X.iContact; bits |= BeliefSource.Contact }
    const edges = ps.relEdges[r].length / 3
    if (edges > 0) { ic += X.iBorder * (edges < X.borderFull ? edges / X.borderFull : 1); bits |= BeliefSource.Border }
    const v = vol !== null && r < vol.length ? vol[r] : 0
    if (v > 0) { ic += X.iTrade * (v / (v + RELATION.tradeHalf)); bits |= BeliefSource.Trade }
    if (rel !== null && a < rel.pcap && b < rel.pcap && rel.state[a] >= 0 && rel.state[a] === rel.state[b]) { ic += X.iFaith; bits |= BeliefSource.Faith }
    if (s.rul !== null && tied(s.rul, a, b)) { ih += X.iMarriage; bits |= BeliefSource.Marriage }
    if (bonded(ps, a, b)) { ih += X.iAlly; bits |= BeliefSource.Envoys }
    // barriers: cheap channels (contact, border, trade) through the tongue; spies too; the lag makes news stale
    let eSpy = 1, lag = 0
    if (ib !== null) {
      const e = eliteE(s, ps, ib, a, b)
      const icNoFaith = ic - ((bits & BeliefSource.Faith) !== 0 ? X.iFaith : 0)
      ic = icNoFaith * (0.3 + 0.7 * e) + (ic - icNoFaith)
      eSpy = 0.5 + 0.5 * e
      lag = newsLag(s, ps, ib, a, b)
      ib.diag.pairs++; ib.diag.eSum += e; ib.diag.lagSum += lag
      if (e < 0.3) ib.diag.unintelligible++
    }
    for (let dir = 0; dir < 2; dir++) {
      const o = dir === 0 ? a : b, t = dir === 0 ? b : a
      const k = 2 * r + dir
      const mass = ps.pMass[t]
      if (!(mass > 0)) continue
      let is = 0, sb = bits
      if (!shadow && bel.spy[o] > 0 && ps.relR[r] >= X.spyR && s.year - bel.caught[k] > POLITY.slowStep) {
        is = X.iSpy * bel.spy[o] * (1 - X.counterK * bel.counter[t])
        if (is > 0) sb |= BeliefSource.Spies
        else is = 0
      }
      const ab = abilityOf(s, o)
      let Ic = ic * ab, Ih = (ih + is * eSpy) * ab
      if (lag > 0) { Ic = stale(Ic, lag); Ih = stale(Ih, lag) } // barriers:
      bel.hard[k] = Ih
      if (bel.est[k] <= 0) {
        // First impression: a successor takes its parent's view of t; else a wide guess.
        const par = ps.pParent[o]
        const kp = par >= 0 ? rowOf(ps, par, t) : -1
        if (kp >= 0 && kp < bel.est.length && bel.est[kp] > 0) {
          bel.est[k] = bel.est[kp]
          const w = bel.varL[kp] + X.vInherit
          bel.varL[k] = w > X.vMax ? X.vMax : w
        } else {
          bel.est[k] = mass * noise(rng, Math.sqrt(X.sigma0Sq))
          bel.varL[k] = X.sigma0Sq
        }
        bel.prev[k] = bel.est[k]
        bel.trend[k] = 1
        formed(s, bel, k, o, t)
      } else {
        const w = bel.varL[k] + X.vDrift
        bel.varL[k] = w > X.vMax ? X.vMax : w
      }
      const I = Ic + Ih
      if (!(I > 0)) { bel.src[k] = 0; continue }
      const shown = shadow ? 1 : 1 + bel.bluff[t] * bel.cred[t]
      const y = mass * ((Ic * shown + Ih) / I) * noise(rng, 1 / Math.sqrt(I))
      kalman(bel, k, y, I)
      bel.src[k] = sb
      bel.seen[k] = s.year
    }
  }
  // Trend of each belief (its growth per slow step), for the commitment problem.
  for (let r = 0; r < R; r++) {
    if (ps.pEnded[ps.relA[r]] >= 0 || ps.pEnded[ps.relB[r]] >= 0) continue
    for (let k = 2 * r; k < 2 * r + 2; k++) {
      if (bel.est[k] <= 0) continue
      if (bel.prev[k] > 0) bel.trend[k] += X.trendRate * (bel.est[k] / bel.prev[k] - bel.trend[k])
      bel.prev[k] = bel.est[k]
    }
  }
  if (!shadow) deceptionStep(s, ps, bel)
  // Credibility recovers; own mass for the next step's growth ratio.
  for (const p of ps.alive) {
    bel.cred[p] += X.credRecover * (1 - bel.cred[p])
  }
  slowSnapshot(s, ps, bel)
  for (const p of ps.alive) bel.massPrev[p] = ps.pMass[p]
}

/** p's own growth ratio over the last slow step (1 when unknown). */
export function ownGrowth(ps: PolityState, bel: BeliefState, p: number): number {
  const m0 = p < bel.pcap ? bel.massPrev[p] : 0
  return m0 > 0 ? ps.pMass[p] / m0 : 1
}

/** battles hook (war.ts battle, after the outcome): p struck q in war w; each sees the other at sigmaBattle (4 draws); a bluff is seen through. */
export function beliefBattle(s: HistoryState, w: number, p: number, q: number, aTrue: number, dTrue: number): void {
  const bel = s.bel, ps = s.pol
  if (bel === null || ps === null) return
  void aTrue; void dTrue
  ensureBelPolities(bel, ps.P)
  const I = 1 / (BELIEF.sigmaBattle * BELIEF.sigmaBattle)
  const yq = ps.pMass[q] * noise(bel.rng, BELIEF.sigmaBattle)
  const yp = ps.pMass[p] * noise(bel.rng, BELIEF.sigmaBattle)
  if (yq > 0) observe(s, ps, bel, p, q, yq, I, BeliefSource.War)
  if (yp > 0) observe(s, ps, bel, q, p, yp, I, BeliefSource.War)
  bel.diag.battles++
  if (BELIEF.shadow) return
  if (bel.bluff[q] > 0) bluffSeen(s, ps, bel, q, p, BeliefSource.War)
  if (bel.bluff[p] > 0) bluffSeen(s, ps, bel, p, q, BeliefSource.War)
  void w
}

/** closeWar hook: at the peace each side takes one more look at the other (sigmaPeace; 4 draws). */
export function beliefPeace(s: HistoryState, ps: PolityState, p: number, q: number): void {
  const bel = s.bel
  if (bel === null || ps.pEnded[p] >= 0 || ps.pEnded[q] >= 0) return
  const I = 1 / (BELIEF.sigmaPeace * BELIEF.sigmaPeace)
  const yq = ps.pMass[q] * noise(bel.rng, BELIEF.sigmaPeace)
  const yp = ps.pMass[p] * noise(bel.rng, BELIEF.sigmaPeace)
  if (yq > 0) observe(s, ps, bel, p, q, yq, I, BeliefSource.War)
  if (yp > 0) observe(s, ps, bel, q, p, yp, I, BeliefSource.War)
}

/** court-politics hook: a defector from p's court tells q what it knows (a precise read of p; no draws). */
export function beliefDefector(s: HistoryState, q: number, p: number, comp: number): void {
  const bel = s.bel, ps = s.pol
  if (bel === null || ps === null || !(comp > 0) || ps.pEnded[p] >= 0) return
  observe(s, ps, bel, q, p, ps.pMass[p], BELIEF.iSpy * comp, BeliefSource.Spies)
}

/** battles: p's precision about q minus q's about p, saturated to [-1, 1] (0 without beliefs or rows). */
export function intelEdge(s: HistoryState, p: number, q: number): number {
  const bel = s.bel, ps = s.pol
  if (bel === null || ps === null) return 0
  const a = rowOf(ps, p, q), b = rowOf(ps, q, p)
  if (a < 0 || b < 0 || a >= bel.est.length || bel.est[a] <= 0 || bel.est[b] <= 0) return 0
  const ia = 1 / bel.varL[a], ib = 1 / bel.varL[b]
  return (ia - ib) / (ia + ib)
}

/**
 * The bluff of t is seen through by o (via channel `bit`): o's belief snaps toward the truth, t's credibility falls, the
 * bluff ends; rivals of o that know t learn of it second-hand (no draws).
 */
export function bluffSeen(s: HistoryState, ps: PolityState, bel: BeliefState, t: number, o: number, bit: number): void {
  const X = BELIEF
  const k = rowOf(ps, o, t)
  const mass = ps.pMass[t]
  if (k >= 0 && k < bel.est.length && bel.est[k] > 0 && mass > 0) {
    let r = mass / bel.est[k]
    if (r < 0.125) r = 0.125
    else if (r > 8) r = 8
    bel.est[k] *= rpow(r, X.exposeGain)
  }
  bel.cred[t] *= X.credHit
  bel.bluff[t] = 0
  bel.bluffUntil[t] = 0
  bel.diag.bluffsExposed++
  if (kingdomPlus(ps, t)) logX(s, EventType.BluffExposed, ps.pCapital[t], ps.pCapital[o], o, bit)
  // Second-hand: o's rivals who know t.
  const R = ps.relA.length
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (a !== o && b !== o) continue
    const c = a === o ? b : a
    if (c === t || ps.pEnded[c] >= 0 || ps.relR[r] < 0.6) continue
    const kc = rowOf(ps, c, t)
    if (kc < 0 || kc >= bel.est.length || bel.est[kc] <= 0 || !(mass > 0)) continue
    kalman(bel, kc, mass, X.secondHandI)
  }
}

const byte = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0)
function growF(a: Float32Array<ArrayBuffer>, need: number): Float32Array<ArrayBuffer> {
  if (need <= a.length) return a
  let n = a.length
  while (n < need) n *= 2
  const b = new Float32Array(n); b.set(a); return b
}
function growU(a: Uint8Array<ArrayBuffer>, need: number): Uint8Array<ArrayBuffer> {
  if (need <= a.length) return a
  let n = a.length
  while (n < need) n *= 2
  const b = new Uint8Array(n); b.set(a); return b
}

/** The slow snapshot (end of beliefStep): every History.beliefs row and each polity's bluff, spies and credibility. */
function slowSnapshot(s: HistoryState, ps: PolityState, bel: BeliefState): void {
  const n = bel.hObs.length
  const o = bel.snUsed
  bel.snEst = growF(bel.snEst, o + n); bel.snSd = growU(bel.snSd, o + n); bel.snSrc = growU(bel.snSrc, o + n)
  bel.snEst.fill(0, o, o + n); bel.snSd.fill(0, o, o + n); bel.snSrc.fill(0, o, o + n)
  const K = bel.hrow.length
  for (let k = 0; k < K; k++) {
    const h = bel.hrow[k]
    if (h < 0 || bel.est[k] <= 0) continue
    const r = k >> 1
    if (ps.pEnded[ps.relA[r]] >= 0 || ps.pEnded[ps.relB[r]] >= 0) continue
    bel.snEst[o + h] = bel.est[k]
    const sd = Math.sqrt(bel.varL[k]) * 100
    bel.snSd[o + h] = sd >= 255 ? 255 : (sd + 0.5) | 0
    bel.snSrc[o + h] = bel.src[k]
  }
  bel.snOff.push(o); bel.snN.push(n); bel.snQ.push(Math.floor(s.year / BELIEF.snapStep)); bel.snUsed += n
  const P = ps.P
  const u = bel.spUsed
  bel.spBluff = growU(bel.spBluff, u + P); bel.spSpy = growU(bel.spSpy, u + P); bel.spCred = growU(bel.spCred, u + P)
  for (let p = 0; p < P; p++) {
    const live = ps.pEnded[p] < 0 && p < bel.pcap
    bel.spBluff[u + p] = live ? byte(bel.bluff[p]) : 0
    bel.spSpy[u + p] = live ? byte(bel.spy[p]) : 0
    bel.spCred[u + p] = live ? byte(bel.cred[p]) : 0
  }
  bel.spOff.push(u); bel.spN.push(P); bel.spUsed += P
}

/** Main snapshot hook (with polSnapshot): each polity's true strength. */
export function beliefSnapshot(ps: PolityState, bel: BeliefState): void {
  const P = ps.P
  const o = bel.stUsed
  bel.stMass = growF(bel.stMass, o + P)
  for (let p = 0; p < P; p++) bel.stMass[o + p] = ps.pEnded[p] < 0 ? ps.pMass[p] : 0
  bel.stOff.push(o); bel.stN.push(P); bel.stUsed += P
}
