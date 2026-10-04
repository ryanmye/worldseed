// rulers: rulers as people, their heirs, successions, houses and the dynastic cycle (the rulers system; marriage.ts for ties
// and unions).
//
// Every polity has a ruler from its founding (hook in newPolity): the founder of a new house (a league: an elected head with
// a term and no house). A ruler has a birth year and a year of natural death drawn at the accession from the mortality table
// (state.ts), traits (ability from the house's vigour, warlike from the house's temperament, piety, tolerance), and an heir
// pool: children born while the ruler is fertile (each with its own year of death), siblings and cousins kept from before.
// Yearly (politySystem, after the campaigns): rulers die of age, fall in battle (a realm at war), are killed when the capital
// falls (hook in capitalFalls), are overthrown when weak (more so at war, in a crisis or after a lost war), or die of
// plague (the hook rulerPlague, for the disease system); then the succession:
//   the law of the ruling people (Primogeniture, Partible, Elective, Seniority; women after men where cognatic) picks the
//   heir from the pool; a chiefdom's chief may come from another family, an elective throne may pass to another house;
//   no heir: a marriage claim may give a personal union or a war of succession (marriage.ts), else a new house is raised;
//   a minor heir opens a regency (the realm weak as in a crisis); the succession is contested with a chance from the law,
//   the realm's cohesion and peoples, a minor, bastard or woman heir and a weak predecessor: a SuccessionCrisis, in which a
//   realm with a rival centre may fall into civil war (the pretender a rival of the house, or a new house) or a Kingdom be
//   partitioned; under partible law adult sons may divide the realm (the existing Partition, each share under a brother).
// The dynastic cycle: a new house starts with high vigour; each new generation regresses to the mean with a downward
// drift (a settled court); ability scales the realm's mass (control.ts hook) and weak rulers invite overthrow.

import { AccessionHow, EventType, PolityOrigin, ReignEnd, WarOutcome } from '../../../contract.ts'
import type { EventType as EventTypeT } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { TradeState } from '../trade.ts'
import type { PolityState } from '../polity/state.ts'
import { Tier, tierOf } from '../polity/state.ts'
import { CIVIL, POLITY } from '../polity/params.ts'
import { membersOf } from '../polity/realm.ts'
import { civilWar, partition, rivalCentre } from '../polity/civil.ts'
import { RULERS, SUCCESSION } from './params.ts'
import { Ctx, deathYear, drawLaw, ensureRulerPolities } from './state.ts'
import type { RulerState } from './state.ts'
import { marriageStep, unionEnded, unionStep, unionsOnSuccession, extinctClaim } from './marriage.ts'
import { capitalFaith } from '../religion/system.ts' // religion:

const H = RULERS.heirs

export function logX(s: HistoryState, type: EventTypeT, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)

// --- Heirs ---------------------------------------------------------------------------------------------

/** Removes heir slot k of polity p. */
function dropHeir(R: RulerState, p: number, k: number): void {
  const o = p * H
  const n = R.hN[p]
  for (let j = k; j < n - 1; j++) {
    R.hBorn[o + j] = R.hBorn[o + j + 1]; R.hDeath[o + j] = R.hDeath[o + j + 1]; R.hLegit[o + j] = R.hLegit[o + j + 1]
    R.hFemale[o + j] = R.hFemale[o + j + 1]; R.hChild[o + j] = R.hChild[o + j + 1]; R.hParent[o + j] = R.hParent[o + j + 1]
  }
  R.hN[p] = n - 1
}

/** Drops the dead from p's pool. */
function pruneHeirs(R: RulerState, p: number, year: number): void {
  for (let k = R.hN[p] - 1; k >= 0; k--) if (R.hDeath[p * H + k] <= year) dropHeir(R, p, k)
}

/** Rank of an heir for keeping in a full pool (higher keeps): legitimate children first, then siblings, the young over the old. */
function keepRank(R: RulerState, i: number, year: number): number {
  return (R.hLegit[i] ? 4 : 0) + (R.hChild[i] ? 2 : 0) + (year - R.hBorn[i] < 50 ? 1 : 0)
}

/** Adds an heir to p's pool (replacing the least worth keeping when full). */
function addHeir(R: RulerState, p: number, year: number, born: number, death: number, legit: number, female: number, child: number, parent: number): void {
  const o = p * H
  let k = R.hN[p]
  if (k >= H) {
    let worst = -1, wr = 99
    for (let j = 0; j < H; j++) { const r = keepRank(R, o + j, year); if (r < wr || (r === wr && R.hBorn[o + j] < R.hBorn[o + worst])) { wr = r; worst = j } }
    const nr = (legit ? 4 : 0) + (child ? 2 : 0) + (year - born < 50 ? 1 : 0)
    if (nr <= wr) return
    dropHeir(R, p, worst)
    k = R.hN[p]
  }
  R.hBorn[o + k] = born; R.hDeath[o + k] = death; R.hLegit[o + k] = legit; R.hFemale[o + k] = female; R.hChild[o + k] = child; R.hParent[o + k] = parent
  R.hN[p] = k + 1
}

/** A child born this year (`year`) to reign r of polity p, perhaps. */
function birthYear(R: RulerState, p: number, r: number, year: number): void {
  const rng = R.rng
  const age = year - R.rBorn[r]
  const to = R.rFemale[r] ? RULERS.fertileToF : RULERS.fertileTo
  if (age < RULERS.fertileFrom || age > to) return
  if (rng.next() >= RULERS.birth) return
  const female = rng.next() < 0.5 ? 1 : 0
  const legit = rng.next() < RULERS.legit ? 1 : 0
  const death = deathYear(R, year, year, rng.next())
  addHeir(R, p, year, year, death, legit, female, 1, r)
}

/** The children reign r (just acceded in p) already has: births drawn for each fertile year so far, the dead left out. */
function backfill(R: RulerState, p: number, r: number, year: number): void {
  const rng = R.rng
  const born = R.rBorn[r]
  const to = born + (R.rFemale[r] ? RULERS.fertileToF : RULERS.fertileTo)
  for (let y = born + RULERS.fertileFrom; y < year && y <= to; y++) {
    if (rng.next() >= RULERS.birth) continue
    const female = rng.next() < 0.5 ? 1 : 0
    const legit = rng.next() < RULERS.legit ? 1 : 0
    const death = deathYear(R, y, y, rng.next())
    if (death > year) addHeir(R, p, year, y, death, legit, female, 1, r)
  }
}

/** Siblings of a new house's founder (brothers and sisters of about the founder's age). */
function founderSiblings(R: RulerState, p: number, born: number, year: number): void {
  const rng = R.rng
  const n = rng.int(0, RULERS.siblings)
  for (let k = 0; k < n; k++) {
    const b = born + rng.int(-RULERS.siblingSpread, RULERS.siblingSpread)
    const female = rng.next() < 0.5 ? 1 : 0
    const d = deathYear(R, b, b < year ? year : b, rng.next())
    if (b <= year && d > year) addHeir(R, p, year, b, d, 1, female, 0, -1)
  }
}

/**
 * The heir of p's pool under law `law` (cognatic: women after men), or -1. Primogeniture and partible: legitimate children
 * by age, then siblings; seniority: adults first, siblings before children; elective: as seniority among adults. Bastards last.
 */
export function pickHeir(R: RulerState, p: number, law: number, cognatic: boolean, year: number): number {
  const o = p * H
  const n = R.hN[p]
  let best = -1, bestK = 1e9
  const senior = law === 2 || law === 3
  for (let k = 0; k < n; k++) {
    const i = o + k
    if (R.hDeath[i] <= year) continue
    const female = R.hFemale[i] === 1
    if (female && !cognatic) continue
    const adult = year - R.hBorn[i] >= RULERS.majority
    // A lexicographic key (lower first): bastard, woman, [seniority: minor], [seniority: child before sibling inverted], birth.
    let key = (R.hLegit[i] ? 0 : 8) + (female ? 4 : 0)
    if (senior) key += (adult ? 0 : 2) + (R.hChild[i] ? 1 : 0)
    else key += R.hChild[i] ? 0 : 1
    const kk = key * 100000 + (R.hBorn[i] + 50000)
    if (kk < bestK) { bestK = kk; best = k }
  }
  return best
}

/** Adult legitimate sons of reign `dead` in p's pool, other than slot `heir`. */
function adultSons(R: RulerState, p: number, dead: number, heir: number, year: number): number {
  const o = p * H
  let n = 0
  for (let k = 0; k < R.hN[p]; k++) {
    const i = o + k
    if (k === heir || R.hDeath[i] <= year || !R.hLegit[i] || R.hFemale[i] || R.hParent[i] !== dead || year - R.hBorn[i] < RULERS.majority) continue
    n++
  }
  return n
}

/** Adults in p's pool other than slot `skip` (rivals in the house). */
function adultsIn(R: RulerState, p: number, skip: number, year: number): number {
  const o = p * H
  let n = 0
  for (let k = 0; k < R.hN[p]; k++) if (k !== skip && R.hDeath[o + k] > year && year - R.hBorn[o + k] >= RULERS.majority) n++
  return n
}

/** The best adult of p's pool other than slot `skip` (a rival claimant: legitimate men first, then the eldest), or -1. */
function rivalIn(R: RulerState, p: number, skip: number, year: number): number {
  const o = p * H
  let best = -1, bk = 1e9
  for (let k = 0; k < R.hN[p]; k++) {
    const i = o + k
    if (k === skip || R.hDeath[i] <= year || year - R.hBorn[i] < RULERS.majority) continue
    const kk = ((R.hLegit[i] ? 0 : 2) + (R.hFemale[i] ? 1 : 0)) * 100000 + R.hBorn[i] + 50000
    if (kk < bk) { bk = kk; best = k }
  }
  return best
}

// --- Reigns and houses ---------------------------------------------------------------------------------------

/** A new house founded now by a ruler of polity p (its vigour and temperament drawn); returns its id. */
function newHouse(s: HistoryState, R: RulerState, p: number): number {
  const d = R.dFounder.length
  const rng = R.rng
  R.dFounder.push(-1)
  R.dFounded.push(s.year)
  R.dEnded.push(-1)
  R.dHome.push(p)
  R.dPeople.push(s.pol !== null ? s.pol.pPeople[p] : 0)
  R.dVigour.push(RULERS.founder0 + (RULERS.founder1 - RULERS.founder0) * rng.next())
  R.dWar.push(rng.next())
  R.dThrones.push(0)
  return d
}

/**
 * Reign of a person on p's throne from this year: born, woman, house `dyn` (-1 a league head), how; `parent` the reign of the
 * parent (a child of a ruler of the house), `person` an earlier reign of the same person (a union) or -1; `term` a league
 * head's term. Logs RulerAcceded (and DynastyFounded for a house's first reign); a minor opens a regency. Returns the reign id.
 */
export function accede(s: HistoryState, ps: PolityState, R: RulerState, p: number, born: number, female: number, dyn: number, how: number, parent: number, person: number, term: number): number {
  const rng = R.rng
  const r = R.rPolity.length
  const pred = R.cur[p]
  const people = ps.pPeople[p]
  R.rPolity.push(p); R.rDyn.push(dyn); R.rFemale.push(female); R.rBorn.push(born); R.rAcc.push(s.year); R.rEnd.push(-1); R.rDied.push(-1)
  R.rHow.push(how); R.rCause.push(ReignEnd.Reigning); R.rLaw.push(R.law[people]); R.rPred.push(pred); R.rCap.push(ps.pCapital[p])
  R.rParent.push(parent)
  if (person >= 0) {
    // The same person on a second throne: the same traits, faith and death.
    R.rPerson.push(R.rPerson[person]); R.rAbility.push(R.rAbility[person]); R.rWar.push(R.rWar[person]); R.rPiety.push(R.rPiety[person]); R.rTol.push(R.rTol[person])
    R.rFaith0.push(R.rFaith[person]); R.rFaith.push(R.rFaith[person]); R.rDeath.push(R.rDeath[person])
  } else {
    R.rPerson.push(r)
    let v = 1
    if (dyn >= 0) {
      // The dynastic cycle: a child of the house's last generation is a new generation.
      if (parent >= 0 && R.rDyn[parent] === dyn) {
        const x = 1 + RULERS.regress * (R.dVigour[dyn] - 1) - RULERS.drift + RULERS.gen * (2 * rng.next() - 1)
        R.dVigour[dyn] = clamp(x, 0.5, 1.6)
      }
      v = R.dVigour[dyn]
    }
    R.rAbility.push(clamp(v * (1 + RULERS.abilityNoise * (2 * rng.next() - 1)), RULERS.abilityMin, RULERS.abilityMax))
    R.rWar.push(dyn >= 0 ? 0.5 * R.dWar[dyn] + 0.5 * rng.next() : rng.next())
    R.rPiety.push(rng.next())
    R.rTol.push(rng.next())
    // religion: a ruler of the house keeps the predecessor's faith; others hold the capital's.
    const f = s.rel === null ? -1 : pred >= 0 && dyn >= 0 && R.rDyn[pred] === dyn ? R.rFaith[pred] : capitalFaith(s, ps.pCapital[p])
    R.rFaith0.push(f); R.rFaith.push(f)
    R.rDeath.push(term > 0 ? s.year + term : deathYear(R, born, s.year, rng.next()))
  }
  R.cur[p] = r
  if (dyn >= 0) {
    if (R.dFounder[dyn] < 0) { R.dFounder[dyn] = r; logX(s, EventType.DynastyFounded, ps.pCapital[p], -1, dyn, r) }
    R.dThrones[dyn]++
  }
  logX(s, EventType.RulerAcceded, ps.pCapital[p], -1, r, how)
  const age = s.year - born
  if (dyn >= 0 && person < 0 && age < RULERS.majority) {
    const left = RULERS.majority - age
    logX(s, EventType.Regency, ps.pCapital[p], -1, r, left)
    const until = s.year + (left < RULERS.regencyMax ? left : RULERS.regencyMax)
    if (ps.pCrisisUntil[p] < until) ps.pCrisisUntil[p] = until
    R.diag.regencies++
  }
  return r
}

/** Ends the reign on p's throne this year with `cause` (died: a death, else the ruler lives on); logs ReignEnded. */
export function endReign(s: HistoryState, ps: PolityState, R: RulerState, p: number, cause: number): void {
  const r = R.cur[p]
  if (r < 0 || R.rEnd[r] >= 0) return
  R.rEnd[r] = s.year
  R.rCause[r] = cause
  const died = cause === ReignEnd.Natural || cause === ReignEnd.Battle || cause === ReignEnd.Sack || cause === ReignEnd.Overthrown || cause === ReignEnd.Plague
  if (died) {
    // (the same person's other reigns know the death too: marriage.ts ends them)
    R.rDied[r] = s.year
  }
  const d = R.rDyn[r]
  if (d >= 0) R.dThrones[d]--
  logX(s, EventType.ReignEnded, ps.pCapital[p], -1, r, cause)
}

/** House d ends now if it holds no throne (logged at p's capital, `last` its last reign). */
export function checkHouse(s: HistoryState, ps: PolityState, R: RulerState, d: number, p: number, last: number): void {
  if (d < 0 || R.dEnded[d] >= 0 || R.dThrones[d] > 0) return
  R.dEnded[d] = s.year
  logX(s, EventType.DynastyEnded, ps.pCapital[p], -1, d, last)
}

/** A new house's founder takes p's throne (how), with siblings and children of their own. */
export function newHouseAccede(s: HistoryState, ps: PolityState, R: RulerState, p: number, how: number): number {
  const rng = R.rng
  const d = newHouse(s, R, p)
  R.hN[p] = 0
  const born = s.year - rng.int(RULERS.founderAge0, RULERS.founderAge1)
  const female = rng.next() < 0.06 ? 1 : 0
  founderSiblings(R, p, born, s.year)
  const r = accede(s, ps, R, p, born, female, d, how, -1, -1, 0)
  backfill(R, p, r, s.year)
  return r
}

/** A league's elected head takes office (no house; a term). */
function electHead(s: HistoryState, ps: PolityState, R: RulerState, p: number): number {
  const rng = R.rng
  R.hN[p] = 0
  const born = s.year - rng.int(40, 65)
  return accede(s, ps, R, p, born, 0, -1, AccessionHow.Elected, -1, -1, rng.int(RULERS.termMin, RULERS.termMax))
}

/** Heir slot k of p's pool takes the throne (the rest of the pool stay as siblings of the new ruler). */
function heirAccede(s: HistoryState, ps: PolityState, R: RulerState, p: number, k: number, dyn: number, how: number): number {
  const i = p * H + k
  const born = R.hBorn[i], female = R.hFemale[i], parent = R.hParent[i]
  dropHeir(R, p, k)
  for (let j = 0; j < R.hN[p]; j++) R.hChild[p * H + j] = 0
  // (old cousins beyond the grandparents' generation fade from the pool)
  for (let j = R.hN[p] - 1; j >= 0; j--) if (s.year - R.hBorn[p * H + j] > 75) dropHeir(R, p, j)
  const r = accede(s, ps, R, p, born, female, dyn, how, parent, -1, 0)
  backfill(R, p, r, s.year)
  return r
}

// --- Hooks of the polity system ---------------------------------------------------------------------------------

/** newPolity hook: the first ruler of polity p (a new house's founder, a league head, a partition's heir or a civil war's claimant). */
export function rulerNewPolity(s: HistoryState, ps: PolityState, R: RulerState, p: number): void {
  ensureRulerPolities(R, p + 1)
  R.cur[p] = -1
  R.hN[p] = 0
  R.kill[p] = 0
  R.union[p] = -1
  R.lost[p] = -1000000
  const origin = ps.pOrigin[p]
  if (origin === PolityOrigin.League) { electHead(s, ps, R, p); return }
  if (R.ctx === Ctx.Partition && R.ctxSrc >= 0) {
    // A share of a divided realm: an adult son of the dead ruler (a brother of the new one), else a kinsman of the house.
    const src = R.ctxSrc, dyn = R.ctxDyn, year = s.year
    const o = src * H
    let pick = -1
    for (let k = 0; k < R.hN[src]; k++) {
      const i = o + k
      if (R.hDeath[i] <= year || !R.hLegit[i] || R.hFemale[i] || year - R.hBorn[i] < RULERS.majority) continue
      if (pick < 0 || R.hBorn[i] < R.hBorn[o + pick]) pick = k
    }
    let born: number, female = 0, parent = R.ctxDead
    if (pick >= 0) { born = R.hBorn[o + pick]; female = R.hFemale[o + pick]; parent = R.hParent[o + pick]; dropHeir(R, src, pick) }
    else born = year - R.rng.int(20, 45)
    const r = accede(s, ps, R, p, born, female, dyn, AccessionHow.Inherited, parent, -1, 0)
    backfill(R, p, r, year)
    return
  }
  if (R.ctx === Ctx.Civil) {
    // A rival claimant of the house (or a new house's man) at the rival centre.
    if (R.ctxDyn >= 0) {
      const r = accede(s, ps, R, p, R.ctxBorn, R.ctxFemale, R.ctxDyn, AccessionHow.Claimed, -1, -1, 0) // (a kinsman: brother, uncle or cousin)
      backfill(R, p, r, s.year)
    } else newHouseAccede(s, ps, R, p, AccessionHow.Claimed)
    R.ctx = Ctx.None
    return
  }
  newHouseAccede(s, ps, R, p, AccessionHow.Founded)
}

/** endPolity hook (before PolityEnded is logged): the reign ends with the realm; unions and ties of p end. */
export function rulerPolityEnded(s: HistoryState, ps: PolityState, R: RulerState, p: number): void {
  if (p >= R.pcap) return
  const r = R.cur[p]
  if (r < 0) return
  const k = R.kill[p]
  R.kill[p] = 0
  if (R.rEnd[r] < 0) endReign(s, ps, R, p, k !== 0 ? k : ReignEnd.RealmEnded)
  unionEnded(s, ps, R, p)
  checkHouse(s, ps, R, R.rDyn[r], p, r)
}

/** capitalFalls hook: the ruler of q may be killed as its capital falls (taken effect at the rulers' year, or with the realm's end). */
export function rulerCapitalFell(ps: PolityState, R: RulerState, q: number): void {
  if (q >= R.pcap || R.cur[q] < 0) return
  if (R.rng.next() < RULERS.sack) R.kill[q] = ReignEnd.Sack
  void ps
}

// disease: rulerPlague (an epidemic at the capital) lives in hooks.ts, which the disease system imports without the polity modules.
export { rulerPlague } from './hooks.ts'

/** Control hook: the realm's mass * (1 + RULERS.mass * (ability - 1)). */
export function rulerMass(R: RulerState, p: number): number {
  if (p >= R.pcap) return 1
  const r = R.cur[p]
  return r < 0 ? 1 : 1 + RULERS.mass * (R.rAbility[r] - 1)
}

/** Declaration hook: a warlike ruler declares more readily (RULERS.warBase + warlike, mean 1). */
export function rulerWar(R: RulerState, p: number): number {
  if (p >= R.pcap) return 1
  const r = R.cur[p]
  return r < 0 ? 1 : RULERS.warBase + R.rWar[r]
}

// --- The yearly system -------------------------------------------------------------------------------------------

/** Lost wars since the last look (PeaceMade events): the loser's last defeat year. */
function scanWars(s: HistoryState, ps: PolityState, R: RulerState): void {
  const ev = s.events
  for (let k = R.evSeen; k < ev.length; k++) {
    const e = ev[k]
    if (e.type !== EventType.PeaceMade) continue
    const w = e.value
    const o = ps.wOutcome[w]
    const att = ps.wAtt[w], def = ps.wDef[w]
    const loser = o === WarOutcome.DefenderGains ? att : o === WarOutcome.AttackerGains || o === WarOutcome.Conquest || o === WarOutcome.Tribute || o === WarOutcome.Vassalage ? def : -1
    if (loser >= 0 && loser < R.pcap) R.lost[loser] = s.year
  }
  R.evSeen = ev.length
}

/** System (yearly, in politySystem after the campaigns): deaths, births, overthrows, successions; ties and unions every slow step. */
export function rulerYear(s: HistoryState, ps: PolityState, R: RulerState, ts: TradeState): void {
  ensureRulerPolities(R, ps.P)
  scanWars(s, ps, R)
  const rng = R.rng
  const year = s.year
  const alive = ps.alive.slice()
  for (const p of alive) {
    if (ps.pEnded[p] >= 0) continue
    const r = R.cur[p]
    if (r < 0) continue
    if (R.union[p] >= 0) { R.kill[p] = 0; continue } // (a junior realm's ruler is the senior's: deaths and births go with the senior)
    if (R.rDyn[r] < 0) {
      // A league: the head's term.
      if (year >= R.rDeath[r]) { endReign(s, ps, R, p, ReignEnd.TermEnded); electHead(s, ps, R, p) }
      continue
    }
    let cause = 0
    if (R.kill[p] !== 0) { cause = R.kill[p]; R.kill[p] = 0 }
    else if (year >= R.rDeath[r]) cause = ReignEnd.Natural
    else if (ps.pWars[p] > 0 && rng.next() < RULERS.battle * (0.4 + R.rWar[r]) * (R.rFemale[r] ? RULERS.womanBattle : 1)) cause = ReignEnd.Battle
    else {
      const weak = RULERS.overthrowAbility - R.rAbility[r]
      if (weak > 0 && year - R.rAcc[r] >= 2) {
        let e = ps.pExh[p]
        if (e > 1) e = 1
        const x = RULERS.overthrow * weak * (1 + e + (ps.pCrisisUntil[p] > year ? 1 : 0) + (year - R.lost[p] <= 10 ? RULERS.overthrowLost : 0))
        if (rng.next() < x) cause = rng.next() < RULERS.overthrowKill ? ReignEnd.Overthrown : ReignEnd.Deposed
      }
    }
    if (cause !== 0) { succession(s, ps, R, ts, p, cause); continue }
    birthYear(R, p, r, year)
  }
  if (year % POLITY.step === 0) unionStep(s, ps, R)
  if (year % POLITY.slowStep === 0) marriageStep(s, ps, R)
}

/** The succession at p after its ruler's reign ended with `cause` (the throne vacant this year). */
export function succession(s: HistoryState, ps: PolityState, R: RulerState, ts: TradeState, p: number, cause: number): void {
  const rng = R.rng
  const year = s.year
  const dead = R.cur[p]
  const dyn = R.rDyn[dead]
  endReign(s, ps, R, p, cause)
  R.diag.successions++
  pruneHeirs(R, p, year)
  const people = ps.pPeople[p]
  if (rng.next() < RULERS.lawChange) R.law[people] = drawLaw(rng)
  const law = R.law[people]
  const tier = tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop)
  let clean = true
  // Overthrown or deposed: the usurper's new house.
  if (cause === ReignEnd.Overthrown || cause === ReignEnd.Deposed) {
    newHouseAccede(s, ps, R, p, AccessionHow.Usurped)
    R.diag.usurped++
    clean = false
    if (rng.next() < SUCCESSION.extinctContested) contested(s, ps, R, ts, p, -1, dead)
  } else if (cause === ReignEnd.Sack && rng.next() < RULERS.puppet) {
    // The conqueror sets its own man on the throne.
    newHouseAccede(s, ps, R, p, AccessionHow.Conquered)
    clean = false
  } else {
    let heir = pickHeir(R, p, law, R.cognatic[people] === 1, year)
    let how: number = AccessionHow.Inherited
    if (tier === Tier.Chiefdom && rng.next() < RULERS.chiefHouse) heir = -2 // (a chief from another family)
    else if (law === 2) { if (rng.next() < RULERS.electOther) heir = -2; else how = AccessionHow.Elected }
    if (heir === -2) {
      newHouseAccede(s, ps, R, p, AccessionHow.Elected)
      clean = false
    } else if (heir < 0) {
      // No heir: the house is extinct here; a marriage claim, or a new house.
      R.diag.extinct++
      clean = false
      if (!extinctClaim(s, ps, R, p, dyn)) {
        newHouseAccede(s, ps, R, p, ps.pWars[p] > 0 ? AccessionHow.Usurped : AccessionHow.Elected)
        if (rng.next() < SUCCESSION.extinctContested) contested(s, ps, R, ts, p, -1, dead)
      }
    } else {
      const i = p * H + heir
      const S = SUCCESSION
      const age = year - R.hBorn[i]
      let rivals = law === 2 || law === 3 ? adultsIn(R, p, heir, year) - 1 : 0
      if (rivals < 0) rivals = 0
      let rv = S.rival * rivals
      if (rv > S.rivalMax) rv = S.rivalMax
      const weak = 1 - R.rAbility[dead]
      const chance = S.base[law] + S.cohesion * (1 - ps.pAsab[p]) + (ps.pMulti[p] ? S.multi : 0) + (age < RULERS.majority ? S.minor : 0) +
        (R.hLegit[i] ? 0 : S.bastard) + (R.hFemale[i] ? S.woman : 0) + (weak > 0 ? S.weak * weak : 0) + rv
      const sons = law === 1 ? adultSons(R, p, dead, heir, year) : 0
      if (ps.pCrisisUntil[p] <= year && rng.next() < chance) {
        clean = false
        // A disputed succession: the heir, or a rival of the house (or a usurper), takes the capital; the loser may rise.
        const rival = rivalIn(R, p, heir, year)
        if (rng.next() < S.heirWins || (rival < 0 && rng.next() < 0.5)) {
          const keepBorn = rival >= 0 ? R.hBorn[p * H + rival] : 0, keepFemale = rival >= 0 ? R.hFemale[p * H + rival] : 0
          heirAccede(s, ps, R, p, heir, dyn, how)
          contested(s, ps, R, ts, p, rival >= 0 ? dyn : -1, dead, keepBorn, keepFemale)
        } else if (rival >= 0) {
          const hb = R.hBorn[i], hf = R.hFemale[i]
          heirAccede(s, ps, R, p, rival, dyn, AccessionHow.Usurped)
          contested(s, ps, R, ts, p, dyn, dead, hb, hf)
        } else {
          newHouseAccede(s, ps, R, p, AccessionHow.Usurped)
          contested(s, ps, R, ts, p, dyn, dead, R.hBorn[i], R.hFemale[i])
        }
      } else {
        heirAccede(s, ps, R, p, heir, dyn, how)
        // Partible law: adult brothers share the realm.
        if (sons > 0 && tier >= Tier.Kingdom && ps.pMembers[p] >= CIVIL.minMembers && ps.pSub[p] < 0 && rng.next() < SUCCESSION.partible) {
          R.diag.partible++
          divide(s, ps, R, p, dyn, dead)
        }
      }
    }
  }
  if (clean) R.diag.clean++
  if (ps.pEnded[p] < 0) unionsOnSuccession(s, ps, R, p, clean)
  checkHouse(s, ps, R, dyn, p, dead)
}

/** p is divided among the brothers of its new ruler (polity Partition; each share's first ruler a brother: rulerNewPolity). */
function divide(s: HistoryState, ps: PolityState, R: RulerState, p: number, dyn: number, dead: number): void {
  R.ctx = Ctx.Partition; R.ctxSrc = p; R.ctxDyn = dyn; R.ctxDead = dead
  const members = membersOf(s, ps, p)
  if (partition(s, ps, p, members)) {
    R.diag.partitions++
    if (R.rng.next() < RULERS.afterPartition) R.law[ps.pPeople[p]] = 0 // (the realm learns the cost of division)
  }
  R.ctx = Ctx.None; R.ctxSrc = -1
}

/**
 * A contested succession at p (the new ruler already on the throne): a SuccessionCrisis; with a rival centre a civil war
 * may follow (the pretender: born / female of house `rivalDyn`, or a new house when -1), else a partition of a Kingdom.
 */
function contested(s: HistoryState, ps: PolityState, R: RulerState, ts: TradeState, p: number, rivalDyn: number, dead: number, born = 0, female = 0): void {
  const S = SUCCESSION
  const rng = R.rng
  R.diag.contested++
  ps.pCrisisUntil[p] = s.year + S.crisisMin + Math.floor(rng.next() * (S.crisisMax - S.crisisMin + 1))
  logX(s, EventType.SuccessionCrisis, ps.pCapital[p], -1, p, R.cur[p])
  if (ps.pMembers[p] < CIVIL.minMembers || ps.pSub[p] >= 0) return
  const members = membersOf(s, ps, p)
  const rc = rivalCentre(s, ps, p, members)
  if (rc >= 0 && rng.next() < S.civil * (1 + ps.pMembers[p] / CIVIL.sizeCrisis)) {
    R.ctx = Ctx.Civil; R.ctxDyn = rivalDyn; R.ctxBorn = rivalDyn >= 0 ? born : 0; R.ctxFemale = female; R.ctxDead = dead
    if (rivalDyn >= 0 && s.year - born < RULERS.majority) R.ctxBorn = s.year - RULERS.majority - R.rng.int(0, 20)
    if (civilWar(s, ps, ts, p, rc, members)) {
      R.diag.civil++
      // (the pretender leaves the capital's pool)
      if (rivalDyn >= 0) for (let k = R.hN[p] - 1; k >= 0; k--) if (R.hBorn[p * H + k] === born && R.hFemale[p * H + k] === female) { dropHeir(R, p, k); break }
    }
    R.ctx = Ctx.None
    return
  }
  if (tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop) >= Tier.Kingdom && rng.next() < S.partition) divide(s, ps, R, p, R.rDyn[R.cur[p]], dead)
}

