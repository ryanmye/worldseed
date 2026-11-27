// beliefs: deception (beliefs-and-deception.md §3.6, §3.7, §3.9, §3.10): bluffs and credibility, spies and counter-espionage,
// secret alliances, forged claims. Run by beliefStep after the observations (never in shadow mode).
//
// Bluffs: a Kingdom+ realm that thinks itself outmatched by a rival (psi = est(t -> q) / mass_t) may make a show of strength
// (shown factor 1 + bluffSize on its cheap channels, scaled by its credibility) for bluffYears, paying bluffCost * bluff a year
// (Fearon 1997: a costly signal); unpaid, the show ends. Any observer with a hard channel (marriage, envoys, spies, war) may
// see through it (exposeK * Ih / (Ih + 1) a slow step); exposure halves credibility, which recovers by credRecover a step.
// Spies: a realm with rivals keeps a spy service toward smoothstep(0.3, 1.2, its highest rivalry) (+ spyWar at war), paid
// spyCost * spy a year; counter-espionage is half of it (+ counterEmpire for empires). Spies give a hard channel on rivals and
// may be caught (caughtK * spy * counter): rivalry rises, a SpyCaught grievance (grudges), SpyCaught logged for Kingdom+ pairs.
// Secret alliances: drawn at formation (bonds.ts ally), revealed when invoked (war.ts declare) or found out by the threat's spies.
//
// Draw order (after the observations): exposures (rows in order), bluff decisions (ps.alive ascending), spies caught (spying
// polity ascending, then relations in order), secret discovery (activeBonds order), forgeries (relations in order).

import { BeliefSource, BondEnd, BondKind, EventType, GrievanceKind } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { Tier, tierOf } from '../polity/state.ts'
import { POLITY, WAR } from '../polity/params.ts'
import { recordGrievance } from '../polity/grievances.ts'
import { endBond } from '../polity/bonds.ts'
import { finMonetised, finRevOrd, finSpend } from '../finance/hooks.ts'
import { BELIEF } from './params.ts'
import type { BeliefState } from './state.ts'
import { bluffSeen, kingdomPlus, logX } from './system.ts'

/** The cost unit of p: R° with a monetised crown, else unitMass * pMass. */
function unitOf(s: HistoryState, ps: PolityState, p: number): number {
  return finMonetised(s, p) ? finRevOrd(s, p) : BELIEF.unitMass * ps.pMass[p]
}

/** p pays `amount`: from the treasury (finances), else from the capital's wealth (as goods' espionage does); true if paid. */
export function belPay(s: HistoryState, ps: PolityState, p: number, amount: number): boolean {
  if (!(amount > 0)) return true
  if (finMonetised(s, p)) return finSpend(s, p, amount, 'other')
  const c = ps.pCapital[p]
  if (c < 0 || s.wealth[c] < amount) return false
  s.wealth[c] -= amount
  return true
}

let psi = new Float64Array(64)
let rivalMax = new Float64Array(64)

export function deceptionStep(s: HistoryState, ps: PolityState, bel: BeliefState): void {
  const X = BELIEF
  const rng = bel.rng
  const R = ps.relA.length
  const step = POLITY.slowStep
  // 1. Exposures: a hard-channel observer of a bluffing realm.
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0) continue
    for (let dir = 0; dir < 2; dir++) {
      const o = dir === 0 ? a : b, t = dir === 0 ? b : a
      if (bel.bluff[t] <= 0) continue
      const k = 2 * r + dir
      const ih = bel.hard[k]
      if (!(ih > 0)) continue
      if (rng.next() >= X.exposeK * (ih / (ih + 1))) continue
      const src = bel.src[k]
      const bit = (src & BeliefSource.Spies) !== 0 ? BeliefSource.Spies : (src & BeliefSource.Envoys) !== 0 ? BeliefSource.Envoys : BeliefSource.Marriage
      bluffSeen(s, ps, bel, t, o, bit)
    }
  }
  // Per polity: highest rivalry with a neighbour, and the fear psi (how outmatched it thinks itself).
  if (psi.length < ps.P) { psi = new Float64Array(bel.pcap); rivalMax = new Float64Array(bel.pcap) }
  psi.fill(0); rivalMax.fill(0)
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0) continue
    const x = ps.relR[r]
    if (ps.relEdges[r].length > 0) { if (x > rivalMax[a]) rivalMax[a] = x; if (x > rivalMax[b]) rivalMax[b] = x }
    if (x < WAR.rLow) continue
    const ka = 2 * r, kb = 2 * r + 1
    if (bel.est[ka] > 0 && ps.pMass[a] > 0) { const f = bel.est[ka] / ps.pMass[a]; if (f > psi[a]) psi[a] = f }
    if (bel.est[kb] > 0 && ps.pMass[b] > 0) { const f = bel.est[kb] / ps.pMass[b]; if (f > psi[b]) psi[b] = f }
  }
  // 2. Spy services and their cost; bluffs end (expired or unpaid); 3. bluff decisions (ps.alive ascending).
  for (const p of ps.alive) {
    const tier = tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop)
    const target = (tier >= Tier.Kingdom ? smoothstep(0.3, 1.2, rivalMax[p]) : 0) + (ps.pWars[p] > 0 ? X.spyWar : 0)
    let sp = bel.spy[p] + X.spyRate * (target - bel.spy[p])
    if (sp < 1e-4) sp = 0
    if (sp > 0 && !belPay(s, ps, p, X.spyCost * sp * unitOf(s, ps, p) * step)) sp *= 0.5
    bel.spy[p] = sp
    bel.counter[p] = 0.5 * sp + (tier >= Tier.Empire ? X.counterEmpire : 0)
    if (bel.bluff[p] > 0) {
      if (s.year >= bel.bluffUntil[p]) { bel.bluff[p] = 0; bel.bluffUntil[p] = 0 }
      else if (!belPay(s, ps, p, X.bluffCost * bel.bluff[p] * unitOf(s, ps, p) * step)) { bel.bluff[p] = 0; bel.bluffUntil[p] = 0; bel.diag.bluffsUnpaid++ }
      continue
    }
    if (tier < Tier.Kingdom || bel.cred[p] < X.credMin) continue
    const chance = X.bluffChance * smoothstep(X.bluffLo, X.bluffHi, psi[p]) * abilityClamp(s, p)
    if (!(chance > 0) || rng.next() >= chance) continue
    bel.bluff[p] = X.bluffSize
    bel.bluffFrom[p] = s.year
    bel.bluffUntil[p] = s.year + X.bluffYears
    bel.diag.bluffs++
    logX(s, EventType.BluffBegun, ps.pCapital[p], -1, p, 1 + X.bluffSize)
  }
  // 4. Spies caught: each spying polity (ascending), each rival in relation order.
  for (const o of ps.alive) {
    const sp = bel.spy[o]
    if (sp < X.spyMin) continue
    for (let r = 0; r < R; r++) {
      const a = ps.relA[r], b = ps.relB[r]
      if (a !== o && b !== o) continue
      const t = a === o ? b : a
      if (ps.pEnded[t] >= 0 || ps.relR[r] < X.spyR) continue
      if (rng.next() >= X.caughtK * sp * bel.counter[t]) continue
      bel.caught[2 * r + (a === o ? 0 : 1)] = s.year
      const x = ps.relR[r] + X.caughtR
      ps.relR[r] = x > 2 ? 2 : x
      if (ps.og !== null) recordGrievance(s, ps, ps.og, GrievanceKind.SpyCaught, t, o, X.wSpy, ps.pCapital[t], -1) // grudges:
      bel.diag.spiesCaught++
      if (kingdomPlus(ps, o) && kingdomPlus(ps, t)) logX(s, EventType.SpyCaught, ps.pCapital[t], ps.pCapital[o], o, 0)
    }
  }
  // 5. Secret alliances found out by the threat's spies.
  for (const k of ps.activeBonds.slice()) {
    if (ps.bKind[k] !== BondKind.Alliance || k >= bel.bKnown.length || bel.bKnown[k] !== -1) continue
    const c = ps.bThreat[k], x = ps.bA[k], y = ps.bB[k]
    if (c < 0 || ps.pEnded[c] >= 0 || !(bel.spy[c] > 0)) continue
    const cx = bel.counter[x] > bel.counter[y] ? bel.counter[x] : bel.counter[y]
    if (rng.next() >= X.discoverK * bel.spy[c] * (1 - X.counterK * cx)) continue
    bel.bKnown[k] = s.year
    bel.diag.revealedSpies++
    logX(s, EventType.AllianceRevealed, ps.pCapital[x], ps.pCapital[y], -1, s.year - ps.bStart[k])
  }
  // 6. Forged claims (off until tuned).
  if (X.forgery) forgeries(s, ps, bel)
}

function abilityClamp(s: HistoryState, p: number): number {
  const R = s.rul
  if (R === null || p >= R.pcap || R.cur[p] < 0) return 1
  const a = R.rAbility[R.cur[p]]
  return a < BELIEF.abilityLo ? BELIEF.abilityLo : a > BELIEF.abilityHi ? BELIEF.abilityHi : a
}

/** Forged claims (§3.10): a warlike, able Kingdom+ ruler forges a claim on a quarrelsome neighbour; its hard-channel watchers may expose it. */
function forgeries(s: HistoryState, ps: PolityState, bel: BeliefState): void {
  const X = BELIEF
  const rng = bel.rng
  const R = ps.relA.length
  const Rul = s.rul
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0) continue
    for (let dir = 0; dir < 2; dir++) {
      const p = dir === 0 ? a : b, q = dir === 0 ? b : a
      const k = 2 * r + dir
      if (bel.forged[k] > 0) {
        // exposure by q's hard channels on p (q observes p: row 2r + (1 - dir))
        const ih = bel.hard[2 * r + (1 - dir)]
        if (ih > 0 && rng.next() < X.exposeK * (ih / (ih + 1))) {
          const site = forgeSite(ps, r, q)
          logX(s, EventType.ClaimExposed, ps.pCapital[p], site, q, s.year - bel.forgedAt[k])
          bel.forged[k] = 0; bel.forgedAt[k] = -1
          bel.cred[p] *= X.credHit
          bel.diag.forgedExposed++
          if (ps.og !== null) recordGrievance(s, ps, ps.og, GrievanceKind.ClaimForged, q, p, X.wForged, site, -1)
          else { const x = ps.relR[r] + 0.05; ps.relR[r] = x > 2 ? 2 : x }
          continue
        }
        bel.forged[k] *= X.forgeDecay
        if (bel.forged[k] < 0.05) { bel.forged[k] = 0; bel.forgedAt[k] = -1 }
      }
      const x = ps.relR[r]
      if (x < X.forgeLo || x >= WAR.rLow || Rul === null || p >= Rul.pcap || Rul.cur[p] < 0 || !kingdomPlus(ps, p) || ps.relEdges[r].length === 0) continue
      const rr = Rul.cur[p]
      if (rng.next() >= X.forgeK * Rul.rWar[rr] * Rul.rAbility[rr]) continue
      if (bel.forged[k] <= 0) bel.forgedAt[k] = s.year
      bel.forged[k] += 1
      bel.diag.forged++
      logX(s, EventType.ClaimForged, ps.pCapital[p], forgeSite(ps, r, q), q, 0)
    }
  }
}

/** A border town of q on relation r (its first border member), or q's capital. */
function forgeSite(ps: PolityState, r: number, q: number): number {
  const e = ps.relEdges[r]
  for (let i = 0; i < e.length; i += 3) { if (ps.polity[e[i]] === q) return e[i]; if (ps.polity[e[i + 1]] === q) return e[i + 1] }
  return ps.pCapital[q]
}

/** relationStep hook: the extra rivalry a year from p's forged claims on the other side of relation r. */
export function forgedRivalry(bel: BeliefState, r: number): number {
  if (!BELIEF.forgery || 2 * r + 1 >= bel.forged.length) return 0
  const f = bel.forged[2 * r] + bel.forged[2 * r + 1]
  return f > 0 ? BELIEF.forgeW * (f / (f + 1)) : 0
}

// --- Secret alliances (§3.7) --------------------------------------------------------------------------------------------

/** bonds.ts ally hook (after the ps.rng draw that formed bond k of x and y against c): true when it is made in secret (one draw). */
export function beliefSecret(ps: PolityState, bel: BeliefState, k: number, x: number, y: number, c: number): boolean {
  while (bel.bKnown.length <= k) bel.bKnown.push(-2)
  if (BELIEF.shadow || c < 0 || ps.pEnded[c] >= 0) return false
  const m = ps.pMass[x] + ps.pMass[y]
  const secret = bel.rng.next() < BELIEF.secretShare * smoothstep(1, 2, ps.pMass[c] / (m + 1e-9))
  if (!secret) return false
  bel.bKnown[k] = -1
  bel.diag.secret++
  return true
}

/** True when bond k is a secret alliance not yet revealed. */
export function isSecret(bel: BeliefState | null, k: number): boolean {
  return bel !== null && k < bel.bKnown.length && bel.bKnown[k] === -1
}

/**
 * The protectors of q that p knows of (its overlord; allies whose pact is public or revealed; all when p is a member), each
 * bordering p and not at war with it: their count times ALLIANCE.join is p's expected coalition (coal_p). `all` counts the
 * secret ones too (q's own view: it knows its friends).
 */
export function knownProtectors(ps: PolityState, bel: BeliefState, p: number, q: number, all: boolean, join: number, atWarWith: (x: number, y: number) => boolean, borders: (x: number, y: number) => boolean): number {
  let c = 0
  for (const k of ps.activeBonds) {
    const kind = ps.bKind[k]
    let x = -1
    if (kind === BondKind.Alliance) { if (ps.bA[k] === q) x = ps.bB[k]; else if (ps.bB[k] === q) x = ps.bA[k] }
    else if (kind === BondKind.Vassal && ps.bA[k] === q) x = ps.bB[k]
    if (x < 0 || x === p || ps.pEnded[x] >= 0) continue
    if (!all && kind === BondKind.Alliance && isSecret(bel, k)) continue
    if (atWarWith(x, p) || !borders(x, p)) continue
    c += join
  }
  return c
}

/**
 * war.ts declare hook, as protector x of q joins the war on p (the war about to be declared is w): a secret pact comes to
 * light (AllianceRevealed, before x's WarDeclared). Returns true when x was also publicly allied with p (double-dealing):
 * the caller records the betrayal after the declaration (grudges' oathBroken), or here the x-p bond lapses (no grudges).
 */
export function beliefJoin(s: HistoryState, ps: PolityState, bel: BeliefState, x: number, q: number, p: number, w: number): boolean {
  let kxq = -1, kxp = -1
  for (const k of ps.activeBonds) {
    if (ps.bKind[k] !== BondKind.Alliance) continue
    const a = ps.bA[k], b = ps.bB[k]
    if ((a === x && b === q) || (a === q && b === x)) kxq = k
    else if ((a === x && b === p) || (a === p && b === x)) kxp = k
  }
  if (kxq < 0 || !isSecret(bel, kxq)) return false
  bel.bKnown[kxq] = s.year
  bel.diag.revealedJoin++
  logX(s, EventType.AllianceRevealed, ps.pCapital[x], ps.pCapital[q], w, s.year - ps.bStart[kxq])
  if (kxp < 0 || isSecret(bel, kxp)) return false
  bel.diag.doubleDealt++
  if (ps.og !== null && ps.og.oaths) return true
  endBond(s, ps, kxp, BondEnd.Lapsed)
  return false
}
