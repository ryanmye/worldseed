// families: named merchant families owning shares of the towns' merchant capital (merchant-families.md §2; HistoryOptions.families).
//
// The pool model of goods/merchants.ts is unchanged: a town's merchant capital mw[town] is one number. A family owns seats, one
// home and up to FAMILY.maxSeats-1 factors (branches), each a share sigma of its town's pool; seat capital = sigma * mw[town], and
// what the families do not hold (1 - sum sigma, at least 1 - kappa) belongs to the lesser merchants. Every pool dynamic (pay,
// wear, flight, gathering, the cap a head, abandonment, crown loans from the pool) reaches the families through the pools, so the
// model is scale-free while capital grows a thousandfold. With FAMILY.feedback false the pass only re-divides pools: it writes
// nothing but its own state and draws only from 'history-merchants', so every other History field is the same on or off.
//
// One pass a year at the very end (index.ts, after landmarks), in a fixed order:
//   P1  the year's events (DirectRoute, ExpeditionSent, PostFounded/Lost, MerchantsMoved, FleetLost, Sacked, Conquered,
//       WarDeclared, PeaceMade, Reunified, CivilWar, ReignEnded, DynastyEnded, PolityEnded) and the year's outbreaks: lanes owned,
//       ventures, factories, seizures, emigration, backings; shocks queued
//   P2  share accounting per seated town: G = m0 + in + movedIn - paid; rho = min(1, mw / G);
//       c1 = max(0, c0 + lane capture + share of the rest by sigma * ability (* (1 + court)) against the free share + transit - venture paid) * rho
//   P3  shocks (fleet, failed venture, sack, plague, crown default: notional without finance, its pool losses mirrored with it),
//       each followed by the ruin check c < ruinRel * peak -> draw < ruinChance -> Bankrupt
//   P4  heads: deaths, accession (Son, Brother, Nephew, Widow, SonInLaw, or no heir), vigour and ability, cadet splits
//   P5  homes: an abandoned home passes to the largest branch, or the family ends (TownLost)
//   P6  (year % 10 == 3) founding at towns with free capital (marts; other towns at FAMILY.nonMart times the bar), branches, closures
//   P7  (year % 10 == 6, rulers on) marriages into ruling houses of Kingdom tier and lapses
//   P9  patronage of the year's new landmarks
//   P10 peaks, fading, and the snapshot at snapshot years
// The design defaults are in params.ts; nothing here is taken from an outside source (the dynastic decline of vigour echoes Ibn
// Khaldun's three generations, as summarised in Wikipedia "Asabiyyah", https://en.wikipedia.org/wiki/Asabiyyah; no number from it).

import { EventType, FamilyCause, FamilyEnd, FamilyMoveCause, FamilyRuin, FamilySeatClose, FamilySeatKind, FamilySeatOpen, HeadHow, LandmarkKind, LandmarkRank, LenderKind, PostKind, ReignEnd, SuccessionLaw, WarOutcome } from '../../../contract.ts'
import type { EventType as EventTypeT } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { GoodsState } from '../goods/state.ts'
import type { LandmarksState } from '../landmarks/state.ts'
import { atWar } from '../polity/formation.ts'
import { Tier, tierOf } from '../polity/state.ts'
import { FAMILY } from './params.ts'
import type { FamilyState } from './state.ts'
import { ensureFamLegs, ensureFamTowns, famDeathYear } from './state.ts'

const X = FAMILY

function logF(F: FamilyState, year: number, type: EventTypeT, settlement: number, other: number, value: number, extra: number): void {
  F.events.push({ year, type, settlement, other, value, extra })
}

function polOf(s: HistoryState, t: number): number {
  const ps = s.pol
  return ps !== null && t >= 0 && t < ps.seen ? ps.polity[t] : -1
}

function mwOf(g: GoodsState, t: number): number {
  const mw = g.ext.merch.mw
  return t < mw.length ? mw[t] : 0
}

/** Capital of seat k now. */
export function seatCapital(g: GoodsState, F: FamilyState, k: number): number {
  return F.sSig[k] * mwOf(g, F.sTown[k])
}

/** Capital of family f now (sum of its open seats). */
export function familyCapital(g: GoodsState, F: FamilyState, f: number): number {
  let c = 0
  for (const k of F.fSeats[f]) c += F.sSig[k] * mwOf(g, F.sTown[k])
  return c
}

/** Free share of town t's pool (what the families do not hold). */
export function freeShare(F: FamilyState, t: number): number {
  const list = F.atTown[t]
  if (list === undefined) return 1
  let x = 1
  for (const k of list) x -= F.sSig[k]
  return x > 0 ? x : 0
}

function uni(F: FamilyState, a: number, b: number): number {
  return a + (b - a) * F.rng.next()
}

// --- rows ------------------------------------------------------------------------------------------------------------

function openSeat(F: FamilyState, f: number, town: number, kind: number, open: number, sig: number, year: number, leg: number, post: number): number {
  const k = F.sFam.length
  F.sFam.push(f); F.sTown.push(town); F.sKind.push(kind); F.sFrom.push(year); F.sTo.push(-1); F.sOpen.push(open); F.sClose.push(FamilySeatClose.Open)
  F.sLeg.push(leg); F.sPost.push(post); F.sSig.push(sig > 0 ? sig : 0)
  let list = F.atTown[town]
  if (list === undefined) { list = []; F.atTown[town] = list }
  list.push(k)
  F.fSeats[f].push(k)
  if (kind === FamilySeatKind.Home) { F.fHomeSeat[f] = k; F.fHome[f] = town }
  return k
}

function removeFrom(a: number[], x: number): void {
  const i = a.indexOf(x)
  if (i >= 0) a.splice(i, 1)
}

/** Closes seat k (its share goes back to the free pool); a factor's closing is logged for the causes that make a story. */
function closeSeat(F: FamilyState, k: number, cause: number, year: number): void {
  if (F.sTo[k] >= 0) return
  F.sTo[k] = year
  F.sClose[k] = cause
  F.sSig[k] = 0
  const list = F.atTown[F.sTown[k]]
  if (list !== undefined) { removeFrom(list, k); if (list.length === 0) F.atTown[F.sTown[k]] = undefined }
  const f = F.sFam[k]
  removeFrom(F.fSeats[f], k)
  if (F.sKind[k] === FamilySeatKind.Branch && cause !== FamilySeatClose.Ended && cause !== FamilySeatClose.Bankrupt)
    logF(F, year, EventType.BranchClosed, F.sTown[k], F.fHome[f], f, cause)
}

function seatAt(F: FamilyState, f: number, town: number): number {
  for (const k of F.fSeats[f]) if (F.sTown[k] === town) return k
  return -1
}

function homesAt(F: FamilyState, town: number): number {
  const list = F.atTown[town]
  if (list === undefined) return 0
  let n = 0
  for (const k of list) if (F.sKind[k] === FamilySeatKind.Home) n++
  return n
}

/** The richest family's seat at town t (ties: lower family id), -1. */
function richestSeat(g: GoodsState, F: FamilyState, t: number): number {
  const list = F.atTown[t]
  if (list === undefined) return -1
  let best = -1, bc = -1
  for (const k of list) {
    const c = F.fCap[F.sFam[k]]
    if (c > bc || (c === bc && F.sFam[k] < F.sFam[best])) { bc = c; best = k }
  }
  void g
  return best
}

function takeLane(F: FamilyState, f: number, k: number, record: number, year: number): void {
  if (k >= F.lcap) ensureFamLegs(F, k + 1)
  if (F.laneOwner[k] === f) return
  if (F.laneOwner[k] >= 0) dropLane(F, k, year)
  F.inLegA[k] = 0; F.inLegB[k] = 0 // (its books start now)
  F.laneOwner[k] = f
  F.laneRow[k] = F.lnFam.length
  F.lnFam.push(f); F.lnLeg.push(record); F.lnFrom.push(year); F.lnTo.push(-1)
  F.fLanes[f].push(k)
}

function dropLane(F: FamilyState, k: number, year: number): void {
  const f = F.laneOwner[k]
  if (f < 0) return
  F.inLegA[k] = 0; F.inLegB[k] = 0
  F.lnTo[F.laneRow[k]] = year
  F.laneOwner[k] = -1
  F.laneRow[k] = -1
  removeFrom(F.fLanes[f], k)
}

/** A head takes over family f (draws: born, death, female for a son or nephew where cognatic, vigour noise, ability noise). */
function accede(s: HistoryState, F: FamilyState, f: number, how: number, prev: number): number {
  const year = s.year
  let born: number
  if (how === HeadHow.Founder) born = year - Math.floor(uni(F, X.founderAge0, X.founderAge1))
  else if (how === HeadHow.Son || how === HeadHow.Nephew) {
    born = F.hBorn[prev] + Math.floor(uni(F, 22, 36))
    if (born > year - X.headAge) born = year - X.headAge
  } else if (how === HeadHow.Brother) {
    born = F.hBorn[prev] + Math.floor(uni(F, -4, 10))
    if (born > year - X.headAge) born = year - X.headAge
  } else born = year - Math.floor(uni(F, 22, 40))
  const death = famDeathYear(F.surv, born, year, F.rng.next())
  let female = how === HeadHow.Widow ? 1 : 0
  if (how === HeadHow.Son || how === HeadHow.Nephew) {
    const R = s.rul
    const pe = F.fPeople[f]
    if (R !== null && pe < R.cognatic.length && R.cognatic[pe] === 1 && F.rng.next() < X.heiress) female = 1
  }
  let V: number
  if (how === HeadHow.Founder) V = uni(F, X.vig0, X.vig1)
  else if (how === HeadHow.SonInLaw) V = uni(F, 0.9, 1.3)
  else if (how === HeadHow.Widow) V = F.fVigour[f]
  else V = 1 + X.regress * (F.fVigour[f] - 1) - X.drift + uni(F, -X.gen, X.gen)
  F.fVigour[f] = V
  let a = V * uni(F, 1 - X.abilityNoise, 1 + X.abilityNoise)
  if (a < X.abilityMin) a = X.abilityMin
  else if (a > X.abilityMax) a = X.abilityMax
  const h = F.hFam.length
  F.hFam.push(f); F.hBorn.push(born); F.hFrom.push(year); F.hTo.push(-1); F.hDied.push(-1); F.hDeath.push(death); F.hHow.push(how); F.hAbility.push(a); F.hFemale.push(female); F.hPrev.push(prev)
  F.fHead[f] = h
  return h
}

function canFound(F: FamilyState): boolean {
  if (F.alive.length >= X.maxAlive || F.fFounded.length >= X.maxEver) { F.diag.capHits++; return false }
  return true
}

/** A new family with its home at `home` holding share sig there. */
function found(s: HistoryState, F: FamilyState, home: number, cause: number, sig: number, other: number, parent: number, open: number): number {
  const f = F.fFounded.length
  const year = s.year
  F.fFounded.push(year); F.fEnded.push(-1); F.fEnd.push(FamilyEnd.Alive); F.fRuin.push(FamilyRuin.None); F.fCause.push(cause)
  F.fFirstHome.push(home); F.fHome.push(home); F.fParent.push(parent); F.fPeople.push(s.people[home]); F.fHomeSeat.push(-1); F.fSeats.push([]); F.fLanes.push([])
  F.fVigour.push(1); F.fHead.push(-1); F.fPeak.push(0); F.fPeakYear.push(-1); F.fPeakCap.push(0); F.fLow.push(0)
  F.fTransit.push(0); F.fTransitFrom.push(-1); F.fTransitUntil.push(-1); F.fCourt.push(-1); F.fMarriage.push(-1)
  F.fLoan.push(0); F.fLoanP.push(-1); F.fLent.push(0); F.fCap.push(0)
  F.alive.push(f) // (ids ascend: alive stays sorted)
  openSeat(F, f, home, FamilySeatKind.Home, open, sig, year, -1, -1)
  if (parent >= 0) { F.fVigour[f] = F.fVigour[parent]; F.fPeople[f] = F.fPeople[parent]; accede(s, F, f, HeadHow.Brother, F.fHead[parent]) } // (a cadet: the new head's brother, of the parent's vigour)
  else accede(s, F, f, HeadHow.Founder, -1)
  F.fCap[f] = familyCapital(s.goods!, F, f)
  F.diag.founded[cause]++
  logF(F, year, EventType.FamilyFounded, home, other, f, cause)
  return f
}

/** Family f ends: its seats close (shares to the free pools), its lanes are unowned, a marriage lapses. */
function endFamily(s: HistoryState, F: FamilyState, f: number, end: number, ruin: number, other: number): void {
  if (F.fEnded[f] >= 0) return
  const year = s.year
  const home = F.fHome[f]
  F.fEnded[f] = year; F.fEnd[f] = end; F.fRuin[f] = ruin
  const seatClose = end === FamilyEnd.Bankrupt ? FamilySeatClose.Bankrupt : end === FamilyEnd.TownLost ? FamilySeatClose.TownLost : FamilySeatClose.Ended
  for (const k of F.fSeats[f].slice()) closeSeat(F, k, seatClose, year)
  for (const k of F.fLanes[f].slice()) dropLane(F, k, year)
  const h = F.fHead[f]
  if (h >= 0 && F.hTo[h] < 0) F.hTo[h] = year
  lapse(F, f, year)
  F.fTransit[f] = 0
  removeFrom(F.alive, f)
  F.diag.ended[end]++
  if (end === FamilyEnd.Bankrupt) F.diag.ruin[ruin]++
  logF(F, year, EventType.FamilyFell, home, other, f, end * 16 + ruin)
}

function lapse(F: FamilyState, f: number, year: number): void {
  const m = F.fMarriage[f]
  if (m >= 0 && F.mgEnd[m] < 0) F.mgEnd[m] = year
  F.fMarriage[f] = -1
  F.fCourt[f] = -1
}

// --- shocks ----------------------------------------------------------------------------------------------------------

/** Seat k loses share `loss` of its capital (to the free pool). */
function seatLoss(F: FamilyState, k: number, loss: number): void {
  if (!(loss > 0)) return
  const l = loss < 1 ? loss : 1
  F.sSig[k] *= 1 - l
}

/** The ruin check after a shock to f (one draw when it is under the bar). */
function ruinCheck(s: HistoryState, F: FamilyState, f: number, ruin: number, other: number): void {
  if (F.fEnded[f] >= 0) return
  const c = familyCapital(s.goods!, F, f)
  F.fCap[f] = c
  const pk = F.fPeak[f] > c ? F.fPeak[f] : c
  if (c < X.ruinRel * pk && F.rng.next() < X.ruinChance) endFamily(s, F, f, FamilyEnd.Bankrupt, ruin, other)
}

interface Shock { f: number; seat: number; loss: number; ruin: number; other: number }
const shocks: Shock[] = []

// --- P1: the year's events -------------------------------------------------------------------------------------------

/** Families at war risk: seats of f in polity q (in seat order). */
function seatsIn(s: HistoryState, F: FamilyState, f: number, q: number, out: number[]): void {
  out.length = 0
  for (const k of F.fSeats[f]) if (polOf(s, F.sTown[k]) === q) out.push(k)
}
const tmp: number[] = []

/** Notional crown default (finance off): the court banker of p and families married into its house carry a loan. */
function notionalDefault(s: HistoryState, F: FamilyState, p: number, done: Set<number>): void {
  if (done.has(p)) return
  done.add(p)
  const ps = s.pol
  if (ps === null || p < 0 || p >= ps.P) return
  const cap = ps.pCapital[p]
  const banker = cap >= 0 ? richestSeat(s.goods!, F, cap) : -1
  for (const f of F.alive.slice()) {
    const court = F.fCourt[f] === p
    const bank = banker >= 0 && F.sFam[banker] === f && F.fHome[f] === cap
    if (!court && !bank) continue
    seatsIn(s, F, f, p, tmp)
    if (tmp.length === 0) continue
    F.fLoanP[f] = p
    if (F.rng.next() >= X.defaultChance) continue
    const loss = X.defaultShare * X.loanShare
    for (const k of tmp) shocks.push({ f, seat: k, loss, ruin: FamilyRuin.Default, other: cap })
  }
}

function scanEvents(s: HistoryState, F: FamilyState, g: GoodsState): void {
  const ev = s.events
  const year = s.year
  const ps = s.pol
  const R = s.rul
  const lh = g.ext.legHist
  const done = new Set<number>() // (membership only: polities that defaulted this year)
  const sponsorOk = new Set<number>() // (membership only)
  F.sponsor.length = 0
  const finOn = s.fin !== null
  for (let i = F.evSeen; i < ev.length; i++) {
    const e = ev[i]
    switch (e.type) {
      case EventType.ExpeditionSent: {
        const h = e.settlement
        if (h < F.cap && F.payY[h] > 0) { const k = richestSeat(g, F, h); if (k >= 0) F.sponsor.push(k) }
        break
      }
      case EventType.DirectRoute: {
        const h = e.settlement
        const k = e.value >= 0 && e.value < lh.leg.length ? lh.leg[e.value] : -1
        if (k < 0) break
        sponsorOk.add(h)
        const legs = [k]
        for (const k2 of g.lanes) if (k2 !== k && g.legOpened[k2] === year && g.legA[k2] === g.legB[k]) legs.push(k2) // (the second leg past a victualling station)
        // the sponsor family (or the richest at h when the crown paid) runs it; merchants without a family found one on it
        let owner = -1
        const paid = h < F.cap && F.payY[h] > 0
        const rs = richestSeat(g, F, h)
        if (rs >= 0) owner = F.sFam[rs]
        else if (paid && canFound(F)) {
          const phi = freeShare(F, h)
          owner = found(s, F, h, FamilyCause.Venture, X.ventureTake < phi ? X.ventureTake : phi, e.other, -1, FamilySeatOpen.Founded)
        }
        if (owner >= 0) for (const kk of legs) takeLane(F, owner, kk, kk === k ? e.value : (lh.cur[kk] ?? -1), year)
        break
      }
      case EventType.PostFounded: {
        if (e.extra !== PostKind.Factory) break
        const post = e.value
        const leg = g.pLeg[post]
        const f = leg >= 0 && leg < F.lcap ? F.laneOwner[leg] : -1
        const host = e.settlement
        if (f < 0 || F.fEnded[f] >= 0 || host < 0 || seatAt(F, f, host) >= 0 || F.fSeats[f].length >= X.maxSeats) break
        const sig = branchShare(g, F, f, host)
        const k = openSeat(F, f, host, FamilySeatKind.Branch, FamilySeatOpen.Factory, sig, year, F.laneRow[leg] >= 0 ? F.lnLeg[F.laneRow[leg]] : -1, post)
        F.diag.branches++
        logF(F, year, EventType.FamilyBranch, host, F.fHome[f], f, k)
        break
      }
      case EventType.PostLost: {
        const post = e.value
        const cause = e.extra === 1 ? FamilySeatClose.Seized : e.extra === 2 ? FamilySeatClose.Expelled : FamilySeatClose.Withdrawn
        const list = F.atTown[e.settlement]
        if (list !== undefined) for (const k of list.slice()) if (F.sPost[k] === post && F.sKind[k] === FamilySeatKind.Branch) closeSeat(F, k, cause, year)
        break
      }
      case EventType.MerchantsMoved: {
        const h = e.settlement
        const list = F.atTown[h]
        if (list === undefined) break
        const m = g.ext.merch
        for (const k of list.slice()) {
          if (F.sKind[k] !== FamilySeatKind.Home) continue
          const f = F.sFam[k]
          if (F.rng.next() >= X.emigrate) continue
          const a = h < m.cap ? m.toA[h] : -1, b = h < m.cap ? m.toB[h] : -1
          const okA = a >= 0 && s.abandoned[a] < 0, okB = b >= 0 && s.abandoned[b] < 0
          let n = -1
          if (okA && okB) n = g.relaySm[b] > g.relaySm[a] ? b : a
          else if (okA) n = a
          else if (okB) n = b
          if (n < 0) continue
          moveHome(s, F, g, f, n, FamilyMoveCause.Bypassed, h)
          F.fTransit[f] = seatCapital(g, F, F.fSeats[f].find((x) => F.sTown[x] === h) ?? -1)
          F.fTransitFrom[f] = h
          F.fTransitUntil[f] = year + X.transitYears
          F.diag.emigrations++
        }
        break
      }
      case EventType.FleetLost: {
        const k = e.value >= 0 && e.value < lh.leg.length ? lh.leg[e.value] : -1
        const f = k >= 0 && k < F.lcap ? F.laneOwner[k] : -1
        if (f < 0 || F.fEnded[f] >= 0) break
        const c = familyCapital(g, F, f)
        if (!(c > 0)) break
        const x = X.fleetMul * (e.extra ?? 0) / c
        shocks.push({ f, seat: F.fHomeSeat[f], loss: x < X.fleetMax ? x : X.fleetMax, ruin: FamilyRuin.Fleet, other: -1 })
        break
      }
      case EventType.Sacked: {
        const list = F.atTown[e.settlement]
        if (list !== undefined) for (const k of list) shocks.push({ f: F.sFam[k], seat: k, loss: X.sackLoss, ruin: FamilyRuin.War, other: e.other })
        break
      }
      case EventType.Conquered: {
        if (ps === null) break
        const t = e.settlement, w = e.value
        const list = F.atTown[t]
        if (list === undefined || w < 0 || w >= ps.wAtt.length) break
        const q = polOf(s, t) // (the conqueror now)
        const enemy = ps.wAtt[w] === q ? ps.wDef[w] : ps.wAtt[w]
        for (const k of list.slice()) {
          if (F.sKind[k] !== FamilySeatKind.Branch) continue
          const f = F.sFam[k]
          if (polOf(s, F.fHome[f]) === enemy) closeSeat(F, k, FamilySeatClose.Seized, year)
        }
        break
      }
      case EventType.WarDeclared: {
        if (ps === null) break
        const w = e.value
        if (w < 0 || w >= ps.wAtt.length) break
        const A = ps.wAtt[w], D = ps.wDef[w]
        for (const f of F.alive.slice()) {
          const hp = polOf(s, F.fHome[f])
          if (hp !== A && hp !== D) continue
          if (F.fCourt[f] === (hp === A ? D : A)) lapse(F, f, year)
          seatsIn(s, F, f, hp === A ? D : A, tmp)
          for (const k of tmp) if (F.sKind[k] === FamilySeatKind.Branch && F.rng.next() < X.seize) closeSeat(F, k, FamilySeatClose.Seized, year)
        }
        break
      }
      case EventType.CivilWar: back(s, F, g, e.settlement, e.other, e.value); break
      case EventType.PeaceMade: {
        resolveBacking(s, F, g, e.value, -1)
        if (!finOn && ps !== null && e.value >= 0 && e.value < ps.wOutcome.length) {
          const o = ps.wOutcome[e.value]
          const loser = o === WarOutcome.AttackerGains || o === WarOutcome.Conquest ? ps.wDef[e.value] : o === WarOutcome.DefenderGains ? ps.wAtt[e.value] : -1
          if (loser >= 0) notionalDefault(s, F, loser, done)
        }
        break
      }
      case EventType.Reunified: resolveBacking(s, F, g, -1, e.value); break
      case EventType.ReignEnded: {
        if (finOn || R === null || e.value < 0 || e.value >= R.rPolity.length) break
        const c = e.extra ?? 0
        if (c === ReignEnd.Overthrown || c === ReignEnd.Deposed || c === ReignEnd.Battle || c === ReignEnd.RealmEnded) notionalDefault(s, F, R.rPolity[e.value], done)
        break
      }
      case EventType.DynastyEnded: {
        for (const f of F.alive.slice()) {
          const m = F.fMarriage[f]
          if (m < 0 || F.mgDyn[m] !== e.value) continue
          const p = F.mgPolity[m]
          lapse(F, f, year)
          if (!finOn) notionalDefault(s, F, p, done)
        }
        break
      }
      case EventType.PolityEnded: if (!finOn) notionalDefault(s, F, e.value, done); break
    }
  }
  F.evSeen = ev.length
  // Ventures that came to nothing (no lane opened from the sponsor's town this year): the loss stands; a ruin check follows.
  for (const k of F.sponsor) if (!sponsorOk.has(F.sTown[k])) shocks.push({ f: F.sFam[k], seat: k, loss: 0, ruin: FamilyRuin.Venture, other: -1 })
  // Plague at a home (the disease system's outbreaks of the year).
  F.plague.clear()
  const dz = s.dz
  if (dz !== null) {
    for (let i = F.dzSeen; i < dz.oSettlement.length; i++) {
      const t = dz.oSettlement[i], toll = dz.oToll[i]
      if (!(toll >= X.plagueMin)) continue
      const list = F.atTown[t]
      if (list === undefined) continue
      for (const k of list) {
        if (F.sKind[k] !== FamilySeatKind.Home) continue
        const f = F.sFam[k]
        const t0 = F.plague.get(f) ?? 0
        if (toll > t0) F.plague.set(f, toll)
      }
    }
    F.dzSeen = dz.oSettlement.length
  }
}

/** Finance on, feedback or not: the pools' crown losses of the year (accounts' written-off principal) fall on the families seated there by share. */
function mirrorFinance(s: HistoryState, F: FamilyState, g: GoodsState): void {
  const fin = s.fin
  if (fin === null) return
  const seen = F.finLost
  const n = fin.lPol.length
  while (seen.length < n) seen.push(0)
  const ps = s.pol
  for (let k = F.finLow; k < n; k++) {
    if (fin.lKind[k] !== LenderKind.Pool) continue
    const d = fin.lLost[k] - seen[k]
    if (!(d > 0)) continue
    seen[k] = fin.lLost[k]
    const t = fin.lSeat[k]
    const list = F.atTown[t]
    if (list === undefined) continue
    const mw = mwOf(g, t)
    const p = fin.lPol[k]
    const other = ps !== null && p < ps.P ? ps.pCapital[p] : -1
    for (const st of list) {
      const c = F.sSig[st] * mw
      if (!(c > 0)) continue
      const x = (F.sSig[st] * d) / c // (its share of the pool's claim, against what it holds now)
      shocks.push({ f: F.sFam[st], seat: st, loss: x < 1 ? x : 1, ruin: FamilyRuin.Default, other })
      F.fLoanP[F.sFam[st]] = p
    }
  }
  while (F.finLow < n && fin.lEnd[F.finLow] >= 0 && fin.lLost[F.finLow] === seen[F.finLow]) F.finLow++
}

// --- backing (P8) ----------------------------------------------------------------------------------------------------

function back(s: HistoryState, F: FamilyState, g: GoodsState, pretender: number, capital: number, w: number): void {
  const ps = s.pol
  if (ps === null || w < 0) return
  const pn = polOf(s, pretender), p0 = polOf(s, capital)
  if (pn < 0 || p0 < 0) return
  for (const f of F.alive) {
    const home = F.fHome[f]
    const hp = polOf(s, home)
    const side = hp === pn ? 1 : home === capital ? 0 : -1
    if (side < 0) continue
    let stake = 0
    for (const k of F.fSeats[f]) {
      const q = polOf(s, F.sTown[k])
      if (q !== pn && q !== p0) continue
      const c = seatCapital(g, F, k)
      stake += X.backShare * c
      F.sSig[k] *= 1 - X.backShare
    }
    if (!(stake > 0)) continue
    const r = F.bkFam.length
    F.bkFam.push(f); F.bkWar.push(w); F.bkSide.push(side); F.bkStake.push(stake); F.bkOut.push(0)
    F.diag.backings++
    logF(F, s.year, EventType.FamilyBacked, home, pretender, f, w)
    void r
  }
}

/** A civil war's end (PeaceMade of war w, or Reunified absorbing polity y): the backers win back their stake or lose it. */
function resolveBacking(s: HistoryState, F: FamilyState, g: GoodsState, w: number, y: number): void {
  const ps = s.pol
  if (ps === null) return
  for (let r = 0; r < F.bkFam.length; r++) {
    if (F.bkOut[r] !== 0) continue
    const war = F.bkWar[r]
    const att = ps.wAtt[war], def = ps.wDef[war] // (the pretender attacks: civil.ts declare(q, p))
    let pretenderWon: boolean
    if (w >= 0) {
      if (war !== w) continue
      const o = ps.wOutcome[war]
      pretenderWon = o !== WarOutcome.DefenderGains && o !== WarOutcome.Reunified
    } else {
      if (y !== att && y !== def) continue
      pretenderWon = y === def
    }
    const f = F.bkFam[r]
    const won = (F.bkSide[r] === 1) === pretenderWon
    F.bkOut[r] = won ? 1 : 2
    if (F.fEnded[f] >= 0) continue
    const hs = F.fHomeSeat[f]
    const home = F.fHome[f]
    const mw = mwOf(g, home)
    if (won) {
      if (mw > 0) {
        let add = (F.bkStake[r] * (1 + X.backGain)) / mw
        const phi = freeShare(F, home)
        if (add > phi) add = phi
        F.sSig[hs] += add
      }
    } else {
      const winner = pretenderWon ? att : def
      if (polOf(s, home) === winner) { shocks.push({ f, seat: hs, loss: X.confiscate, ruin: FamilyRuin.War, other: ps.pCapital[winner] }) }
    }
  }
}

// --- branches --------------------------------------------------------------------------------------------------------

/** The share a new branch of f at b takes (branchTake of its home capital, at most branchHalfFree of b's free share); the home gives it up. */
function branchShare(g: GoodsState, F: FamilyState, f: number, b: number): number {
  const mwb = mwOf(g, b)
  const hs = F.fHomeSeat[f]
  if (!(mwb > 0) || hs < 0) return 0
  const home = F.sTown[hs]
  const mwh = mwOf(g, home)
  const v = X.branchTake * F.sSig[hs] * mwh
  let sig = v / mwb
  const lim = X.branchHalfFree * freeShare(F, b)
  if (sig > lim) sig = lim
  if (mwh > 0) { F.sSig[hs] -= (sig * mwb) / mwh; if (F.sSig[hs] < 0) F.sSig[hs] = 0 }
  return sig
}

/** Moves f's home to town n (its branch there becomes the home, or a seat opens); the old home stays as a branch. */
function moveHome(s: HistoryState, F: FamilyState, g: GoodsState, f: number, n: number, cause: number, from: number): void {
  const year = s.year
  const hs = F.fHomeSeat[f]
  if (hs >= 0 && F.sTo[hs] < 0) {
    const sig = F.sSig[hs], t = F.sTown[hs]
    closeSeat(F, hs, FamilySeatClose.Ended, year)
    if (s.abandoned[t] < 0 && cause !== FamilyMoveCause.TownLost) openSeat(F, f, t, FamilySeatKind.Branch, FamilySeatOpen.Moved, sig, year, -1, -1)
  }
  const b = seatAt(F, f, n)
  let sig = 0
  if (b >= 0) { sig = F.sSig[b]; closeSeat(F, b, FamilySeatClose.Ended, year) }
  openSeat(F, f, n, FamilySeatKind.Home, FamilySeatOpen.Moved, sig, year, -1, -1)
  logF(F, year, EventType.FamilyMoved, n, from, f, cause)
  void g
}

// --- the pass --------------------------------------------------------------------------------------------------------

const towns: number[] = []
let mark = new Uint8Array(0)

function accounting(s: HistoryState, F: FamilyState, g: GoodsState): void {
  const mw = g.ext.merch.mw
  const year = s.year
  if (mark.length < s.count) mark = new Uint8Array(2 * s.count)
  towns.length = 0
  for (const f of F.alive) for (const k of F.fSeats[f]) { const t = F.sTown[k]; if (!mark[t]) { mark[t] = 1; towns.push(t) } }
  towns.sort((a, b) => a - b)
  // transit: the share each emigrating family held at its old home, before this year's accounting
  const tsig = new Map<number, number>() // (lookup only)
  for (const f of F.alive) {
    if (!(F.fTransit[f] > 0)) continue
    if (year > F.fTransitUntil[f]) { F.fTransit[f] = 0; continue }
    const k = seatAt(F, f, F.fTransitFrom[f])
    tsig.set(f, k >= 0 ? F.sSig[k] : 0)
  }
  const w: number[] = []
  const c1s: number[] = []
  for (const m of towns) {
    mark[m] = 0
    const list = F.atTown[m]
    if (list === undefined) continue
    const mwm = m < mw.length ? mw[m] : 0
    const m0 = F.m0[m]
    const inY = F.inY[m], mov = F.movInY[m], pay = F.payY[m], lent = F.lendY[m]
    const G = m0 + inY + mov - pay - lent
    const rho = G > 0 ? (mwm < G ? mwm / G : 1) : 0
    const pm = polOf(s, m)
    let sumSig = 0, sumW = 0, sumL = 0
    w.length = 0; c1s.length = 0
    for (const k of list) {
      sumSig += F.sSig[k]
      const f = F.sFam[k]
      let L = 0
      if (F.sFrom[k] < year) for (const kk of F.fLanes[f]) { if (g.legA[kk] === m) L += F.inLegA[kk]; else if (g.legB[kk] === m) L += F.inLegB[kk] }
      L *= X.own
      sumL += L
      c1s.push(L)
      const wk = F.sFrom[k] < year ? F.sSig[k] * F.hAbility[F.fHead[f]] * (1 + (F.fCourt[f] >= 0 && F.fCourt[f] === pm ? X.court : 0)) : 0
      w.push(wk)
      sumW += wk
    }
    const phi = sumSig < 1 ? 1 - sumSig : 0
    let Rm = inY - sumL
    if (Rm < 0) Rm = 0
    Rm += mov // (capital gathered or fled here: the houses seated here take it in as they take the trade)
    const den = sumW + X.freeWeight * phi
    let tot = 0
    for (let i = 0; i < list.length; i++) {
      const k = list[i]
      if (F.sFrom[k] === year) { c1s[i] = F.sSig[k] * mwm; tot += F.sSig[k]; continue } // (opened this year at today's pool)
      const f = F.sFam[k]
      const c0 = F.sSig[k] * m0
      const C = den > 0 ? (Rm * w[i]) / den : 0
      let P = 0
      if (pay > 0 && F.sponsor.indexOf(k) >= 0) P = pay
      if (lent !== 0) P += F.seatLendY.get(k) ?? 0 // (feedback: lent to a crown or repaid)
      let M = 0
      if (F.fTransit[f] > 0 && F.fHomeSeat[f] === k) {
        M = mov * (tsig.get(f) ?? 0)
        if (M > F.fTransit[f]) M = F.fTransit[f]
        if (M > Rm - C) M = Rm - C > 0 ? Rm - C : 0 // (out of what arrived, not on top of it)
        F.fTransit[f] -= M
      }
      let c1 = c0 + c1s[i] + C + M - P
      if (c1 < 0) c1 = 0
      c1 *= rho
      F.sSig[k] = mwm > 0 ? c1 / mwm : 0
      tot += F.sSig[k]
    }
    if (tot > X.kappa) { const sc = X.kappa / tot; for (const k of list) F.sSig[k] *= sc }
  }
}

function capitals(F: FamilyState, g: GoodsState): number {
  const cs: number[] = []
  for (const f of F.alive) { const c = familyCapital(g, F, f); F.fCap[f] = c; cs.push(c) }
  if (cs.length === 0) return 0
  cs.sort((a, b) => a - b)
  const n = cs.length
  return n % 2 === 1 ? cs[(n - 1) >> 1] : 0.5 * (cs[n / 2 - 1] + cs[n / 2])
}

/** P4: deaths and successions, in family id order. */
function heads(s: HistoryState, F: FamilyState, g: GoodsState, med: number): void {
  const year = s.year
  const R = s.rul
  for (const f of F.alive.slice()) {
    if (F.fEnded[f] >= 0) continue
    const h = F.fHead[f]
    const pt = F.plague.get(f) ?? 0
    let dies = year >= F.hDeath[h]
    if (!dies && pt > 0) { const ch = pt * X.plagueCourt; dies = F.rng.next() < (ch < 1 ? ch : 1) }
    if (!dies) continue
    F.hTo[h] = year
    F.hDied[h] = year
    const W = X.howWeights
    const none = pt > 0 ? 2 * W[5] : W[5]
    let x = F.rng.next() * (W[0] + W[1] + W[2] + W[3] + W[4] + none)
    let how = -1
    for (let i = 0; i < 5; i++) { x -= W[i]; if (x < 0) { how = i + 1; break } }
    if (how < 0) { endFamily(s, F, f, FamilyEnd.NoHeir, FamilyRuin.None, -1); continue }
    const nh = accede(s, F, f, how, h)
    logF(F, year, EventType.FamilyHead, F.fHome[f], -1, f, nh)
    // a cadet line may split off with the richest branch
    if (F.fSeats[f].length >= X.splitSeats && F.fCap[f] >= X.splitRel * med && F.alive.length < X.maxAlive && F.fFounded.length < X.maxEver) {
      const pe = F.fPeople[f]
      const partible = R !== null && pe < R.law.length && R.law[pe] === SuccessionLaw.Partible
      if (F.rng.next() < X.split * (partible ? 2 : 1)) {
        let best = -1, bc = -1
        for (const k of F.fSeats[f]) { if (F.sKind[k] !== FamilySeatKind.Branch) continue; const c = seatCapital(g, F, k); if (c > bc) { bc = c; best = k } }
        if (best >= 0) {
          const t = F.sTown[best], sig = F.sSig[best]
          closeSeat(F, best, FamilySeatClose.Ended, year)
          found(s, F, t, FamilyCause.Split, sig, F.fHome[f], f, FamilySeatOpen.Split)
          F.diag.splits++
        }
      }
    }
  }
}

/** P5: an abandoned home passes to the largest branch, or the family ends; branches at abandoned towns close. */
function homes(s: HistoryState, F: FamilyState, g: GoodsState): void {
  const year = s.year
  for (const f of F.alive.slice()) {
    for (const k of F.fSeats[f].slice()) if (F.sKind[k] === FamilySeatKind.Branch && s.abandoned[F.sTown[k]] >= 0) closeSeat(F, k, FamilySeatClose.TownLost, year)
    const home = F.fHome[f]
    if (s.abandoned[home] < 0) continue
    let best = -1, bc = -1
    for (const k of F.fSeats[f]) { if (F.sKind[k] !== FamilySeatKind.Branch) continue; const c = seatCapital(g, F, k); if (c > bc) { bc = c; best = k } }
    if (best < 0) { endFamily(s, F, f, FamilyEnd.TownLost, FamilyRuin.None, -1); continue }
    moveHome(s, F, g, f, F.sTown[best], FamilyMoveCause.TownLost, home)
  }
}

/** P6 founding: towns in s.living order with free merchant capital over the bar. */
function founding(s: HistoryState, F: FamilyState, g: GoodsState, med: number): void {
  const mw = g.ext.merch.mw
  const bar = X.foundAbs > X.foundRel * med ? X.foundAbs : X.foundRel * med
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const m = living[t]
    if (m >= mw.length || !(mw[m] > 0)) continue
    const mart = m < g.cap && g.isMart[m] === 1
    const phi = freeShare(F, m)
    if (phi * mw[m] < bar * (mart ? 1 : X.nonMart)) continue
    if (homesAt(F, m) >= X.perTown) continue
    if (!canFound(F)) return
    if (F.rng.next() >= X.foundChance) continue
    found(s, F, m, FamilyCause.Capital, X.foundTake * phi, -1, -1, FamilySeatOpen.Founded)
    if (!mart) F.diag.nonMart++
  }
}

/** P6: an open lane nobody runs is taken up by the richest family seated at its home end, else at its far end. */
function adoptLanes(s: HistoryState, F: FamilyState, g: GoodsState): void {
  const lh = g.ext.legHist
  for (const k of g.lanes) {
    if (!g.legOpen[k] || (k < F.lcap && F.laneOwner[k] >= 0)) continue
    let st = richestSeat(g, F, g.legA[k])
    if (st < 0) st = richestSeat(g, F, g.legB[k])
    if (st < 0) continue
    const f = F.sFam[st]
    if (F.fEnded[f] >= 0) continue
    takeLane(F, f, k, k < lh.cur.length ? lh.cur[k] : -1, s.year)
  }
}

/** P6 branches and closures, families in id order. */
function branches(s: HistoryState, F: FamilyState, g: GoodsState, med: number): void {
  const year = s.year
  const ps = s.pol
  const bar = X.branchAbs > X.branchRel * med ? X.branchAbs : X.branchRel * med
  for (const f of F.alive.slice()) {
    // closures first (a factor too small to keep)
    const cf = familyCapital(g, F, f)
    for (const k of F.fSeats[f].slice()) if (F.sKind[k] === FamilySeatKind.Branch && year - F.sFrom[k] >= 20 && seatCapital(g, F, k) < X.branchCloseShare * cf) closeSeat(F, k, FamilySeatClose.Withdrawn, year)
    if (F.fSeats[f].length >= X.maxSeats || cf < bar) continue
    const home = F.fHome[f]
    const hp = polOf(s, home)
    let best = -1, bv = -1, bleg = -1, bopen = 0
    const consider = (b: number, leg: number, open: number): void => {
      if (b < 0 || b === home || s.abandoned[b] >= 0 || seatAt(F, f, b) >= 0 || !(mwOf(g, b) > 0)) return
      const q = polOf(s, b)
      if (ps !== null && hp >= 0 && q >= 0 && q !== hp && atWar(ps, hp, q)) return
      const v = b < g.cap ? g.relaySm[b] : 0
      if (v > bv || (v === bv && b < best)) { bv = v; best = b; bleg = leg; bopen = open }
    }
    for (const k of F.fLanes[f]) if (g.legOpen[k]) consider(g.legA[k] === home ? g.legB[k] : g.legA[k], F.laneRow[k] >= 0 ? F.lnLeg[F.laneRow[k]] : -1, FamilySeatOpen.Lane)
    if (best < 0) for (let k = 0; k < g.legCount; k++) {
      if (!g.legOpen[k]) continue
      const a = g.legA[k], b = g.legB[k]
      if (a !== home && b !== home) continue
      const o = a === home ? b : a
      if (o < g.cap && g.isMart[o] === 1) consider(o, -1, FamilySeatOpen.Relay)
    }
    if (best < 0) continue
    if (F.rng.next() >= X.branchChance) continue
    const sig = branchShare(g, F, f, best)
    if (!(sig > 0)) continue
    const k = openSeat(F, f, best, FamilySeatKind.Branch, bopen, sig, year, bleg, -1)
    F.diag.branches++
    logF(F, year, EventType.FamilyBranch, best, home, f, k)
  }
}

/** P7: marriages into ruling houses (rulers and polities on), and the ties' lapses. */
function court(s: HistoryState, F: FamilyState, g: GoodsState): void {
  const ps = s.pol, R = s.rul
  if (ps === null || R === null) return
  const year = s.year
  for (const f of F.alive) {
    const m = F.fMarriage[f]
    if (m < 0) continue
    const p = F.mgPolity[m]
    const cur = p < R.pcap ? R.cur[p] : -1
    if (year - F.mgYear[m] >= X.marryYears || ps.pEnded[p] >= 0 || cur < 0 || R.rDyn[cur] !== F.mgDyn[m]) lapse(F, f, year)
  }
  if (year % 10 !== 6) return
  const cand: number[] = []
  for (const f of F.alive) {
    if (F.fMarriage[f] >= 0) continue
    cand.length = 0
    const hp = polOf(s, F.fHome[f])
    if (hp >= 0) cand.push(hp)
    for (const k of F.fSeats[f]) { const q = polOf(s, F.sTown[k]); if (q >= 0 && cand.indexOf(q) < 0 && ps.pCapital[q] === F.sTown[k]) cand.push(q) }
    for (const p of cand) {
      if (ps.pEnded[p] >= 0 || p >= R.pcap) continue
      const cur = R.cur[p]
      if (cur < 0 || R.rDyn[cur] < 0) continue
      if (tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop) < Tier.Kingdom) continue
      const held = capitalIn(s, F, g, f, p)
      if (held < X.marryRel * s.wealth[ps.pCapital[p]]) continue
      let above = 0
      for (const f2 of F.alive) if (f2 !== f && capitalIn(s, F, g, f2, p) > held) above++
      if (above >= X.marryTop) continue
      if (F.rng.next() >= X.marryChance * (F.fLoanP[f] === p ? X.marryLoanMul : 1)) continue
      const daughter = F.rng.next() < X.marryDaughter ? 1 : 0
      const r = F.mgFam.length
      F.mgFam.push(f); F.mgDyn.push(R.rDyn[cur]); F.mgPolity.push(p); F.mgRuler.push(cur); F.mgYear.push(year); F.mgEnd.push(-1); F.mgDaughter.push(daughter)
      F.fMarriage[f] = r
      F.fCourt[f] = p
      F.diag.marriages++
      logF(F, year, EventType.FamilyMarriage, F.fHome[f], ps.pCapital[p], f, r)
      break
    }
  }
}

function capitalIn(s: HistoryState, F: FamilyState, g: GoodsState, f: number, p: number): number {
  let c = 0
  for (const k of F.fSeats[f]) if (polOf(s, F.sTown[k]) === p) c += seatCapital(g, F, k)
  return c
}

const PATRON_GREAT: readonly number[] = [LandmarkKind.MarketHall, LandmarkKind.Guildhall, LandmarkKind.GreatTemple, LandmarkKind.Lighthouse, LandmarkKind.Library]

/** P9: the richest family seated at a new landmark's town pays for it when its seat holds patronRel of the town's wealth. */
function patronage(s: HistoryState, F: FamilyState, g: GoodsState, lm: LandmarksState | null): void {
  if (lm === null) return
  const n = lm.lKind.length
  for (let r = F.lmSeen; r < n; r++) {
    const kind = lm.lKind[r]
    const great = lm.lRank[r] === LandmarkRank.Great && PATRON_GREAT.indexOf(kind) >= 0
    const lesser = kind === LandmarkKind.Temple && lm.lRank[r] === LandmarkRank.Lesser
    if (!great && !lesser) continue
    const t = lm.lSett[r]
    const k = richestSeat(g, F, t)
    if (k < 0) continue
    if (seatCapital(g, F, k) < X.patronRel * s.wealth[t]) continue
    const f = F.sFam[k]
    F.ptFam.push(f); F.ptLandmark.push(r); F.ptYear.push(s.year)
    if (great) logF(F, s.year, EventType.FamilyPatron, t, -1, f, r)
  }
  F.lmSeen = n
}

/** The families' pass of the year (index.ts, after landmarks). */
export function familiesYear(s: HistoryState, F: FamilyState, lm: LandmarksState | null): void {
  const g = s.goods
  if (g === null) return
  const year = s.year
  const t0 = performance.now() // (tuning only)
  ensureFamTowns(F, s.count)
  ensureFamLegs(F, g.legCount)
  shocks.length = 0
  // fresh capitals for the event handlers (shares are from last year's pass, the pools from this year)
  for (const f of F.alive) F.fCap[f] = familyCapital(g, F, f)
  scanEvents(s, F, g) // P1
  if (s.fin !== null) mirrorFinance(s, F, g)
  accounting(s, F, g) // P2
  // P3: shocks in the order queued, each with its ruin check; then the plague at homes (family id order)
  for (const x of shocks) {
    if (F.fEnded[x.f] >= 0 || x.seat < 0 || F.sTo[x.seat] >= 0) continue
    seatLoss(F, x.seat, x.loss)
    ruinCheck(s, F, x.f, x.ruin, x.other)
  }
  shocks.length = 0
  for (let i = 0; i < F.pendingRuin.length; i += 2) ruinCheck(s, F, F.pendingRuin[i], FamilyRuin.Default, F.pendingRuin[i + 1]) // (feedback: crown defaults on family loans)
  F.pendingRuin.length = 0
  for (const f of F.alive.slice()) {
    const t = F.plague.get(f)
    if (t === undefined) continue
    seatLoss(F, F.fHomeSeat[f], X.plagueLoss * t)
    ruinCheck(s, F, f, FamilyRuin.Plague, -1)
  }
  const med = capitals(F, g)
  heads(s, F, g, med) // P4
  homes(s, F, g) // P5
  if (year % 10 === 3) { founding(s, F, g, med); adoptLanes(s, F, g); branches(s, F, g, med) } // P6
  court(s, F, g) // P7
  patronage(s, F, g, lm) // P9
  // P10: peaks and fading
  const med2 = capitals(F, g)
  for (const f of F.alive.slice()) {
    const c = F.fCap[f]
    const pd = F.fPeak[f] * X.peakDecay
    F.fPeak[f] = c > pd ? c : pd
    if (F.alive.length > 1 && c < X.fadeRel * med2) { if (++F.fLow[f] >= X.fadeYears) endFamily(s, F, f, FamilyEnd.Faded, FamilyRuin.None, -1) }
    else F.fLow[f] = 0
  }
  // the hooks' year is over (only the towns written and the lanes run are cleared); m0 for the seated towns
  for (const t of F.touched) { F.inY[t] = 0; F.payY[t] = 0; F.movInY[t] = 0; F.lendY[t] = 0; F.tmark[t] = 0 }
  F.touched.length = 0
  F.seatLendY.clear()
  const mw = g.ext.merch.mw
  for (const f of F.alive) {
    for (const k of F.fLanes[f].slice()) { if (!g.legOpen[k]) dropLane(F, k, year); else { F.inLegA[k] = 0; F.inLegB[k] = 0 } } // (lanes that closed lose their owner)
    for (const k of F.fSeats[f]) { const t = F.sTown[k]; F.m0[t] = t < mw.length ? mw[t] : 0 }
  }
  F.diag.ms += performance.now() - t0
}

/** Snapshot (with the population snapshots): live families, then their open seats, ascending, with their capital. */
export function familiesSnapshot(s: HistoryState, F: FamilyState): void {
  const g = s.goods
  F.snapFamOff.push(F.snapFam.length)
  F.snapSeatOff.push(F.snapSeat.length)
  if (g === null) return
  const seats: number[] = []
  for (const f of F.alive) {
    const c = familyCapital(g, F, f)
    F.snapFam.push(f); F.snapFamCap.push(c)
    if (c > F.fPeakCap[f]) { F.fPeakCap[f] = c; F.fPeakYear[f] = s.year }
    for (const k of F.fSeats[f]) seats.push(k)
  }
  seats.sort((a, b) => a - b)
  for (const k of seats) { F.snapSeat.push(k); F.snapSeatCap.push(seatCapital(g, F, k)) }
}
