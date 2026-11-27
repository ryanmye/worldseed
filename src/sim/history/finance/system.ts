// finance: crown treasuries, borrowing from merchant capital, default and bankruptcy (state-finances.md §2.4; HistoryOptions.finance).
//
// The crown gets a purse of its own. The coin that used to land in the capital's wealth (the wealth tax, duties and seizures,
// tribute, the crown's share of plunder, royalties on Treasure mined by its members) is booked to it (hooks.ts); it spends on
// court, garrisons, works, war, tribute and interest, most peacetime spending flowing back into the capital (FIN.home) and most
// war spending consumed (FIN.warHome). Costs are multiples of ordinary revenue R° (revenue smoothed over years at peace), so they
// hold across eras; a realm with no coin (R° < FIN.minRev) feels no fiscal constraint, and exhaustion rules it as before.
// One fiscal year per year, in politySystem just before the campaigns (§3.1):
//   income: coin = this year's bookings + last year's plunder and tribute;  R = pRevSm + taxSm + mineSm;  R° follows R at peace
//   expenses E = court + garrison + works + war + tribute out;  treas += coin - E;  interest from the treasury (pro rata, the
//   rest capitalised);  spend-back;  overflow above reserveCap * R°
//   rate  r_p = clamp(C9 * rBase + rStain * stain + rLoad * (debt / R° - loadFree)+ + rWar [war] + rCoin (1 - coin) - rAble (ability - 1))
//   borrow: at war to keep chest * war cost in hand, or in arrears the shortfall + cushion * E, up to the credit limit
//   rate * debt <= dsMax * R° (1 + warlikeDs (rWar - 0.5)), from lenders domestic first (lenders.ts); repay at peace above repayAbove R°
//   arrears: unpaid years; the army's pay factor pPay = 1 - unpaidProj * min(1, unpaid / unpaidFull)
//   default when interest > dsBreak R° or unpaid >= arrearYears: haircut h = clamp(1 - dsAfter R° / (r debt), hMin, 1); stain += 2h
//   repudiation after a usurpation, a conqueror's accession or a new house: one 'history-finance' draw < repudiate (0.5 + rWar)
//   tax pressure: taxMul eases toward 1 + taxUp * min(1, (E - coin)+ / R°) (C8), a grievance (unrest terms[5], Taxes)
// The literature behind the design: sovereign default and the reputation for repayment (Eaton & Gersovitz 1981, Review of
// Economic Studies 48(2): 289-309, https://doi.org/10.2307/2296886), serial defaulters (Reinhart & Rogoff 2009, This Time Is
// Different), the fiscal-military state (Brewer 1989, The Sinews of Power); every number is a design default.

import { BondKind, EventType, GrievanceKind, LenderKind, LoanEnd, PolityEnd, WarKind } from '../../../contract.ts'
import type { EventType as EventTypeT } from '../../../contract.ts'
import { CLASS } from '../goods/params.ts'
import { Good } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { VASSAL } from '../polity/params.ts'
import { ARMS } from '../polity/params.ts'
import { FIN } from './params.ts'
import type { FinanceState } from './state.ts'
import { ensureFinPolities, ensureFinSettlements } from './state.ts'
import type { LenderOffer } from './lenders.ts'
import { lenderCandidates, lenderGive, lenderLose, lenderRoom, lenderTake, poolsOfYear } from './lenders.ts'
import { headroomOf, rateOf } from './hooks.ts'
import { recordGrievance } from '../polity/grievances.ts' // oaths:
import { at } from '../polity/grudgeState.ts'

function logX(s: HistoryState, type: EventTypeT, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

const pools: number[] = []
const offers: LenderOffer[] = []

/** The account of (p, kind, id): open if none (LoanTaken). */
function account(s: HistoryState, ps: PolityState, fin: FinanceState, p: number, kind: number, id: number, rate: number): number {
  const key = p * 16777216 + kind * 4194304 + id
  const k0 = fin.acct.get(key)
  if (k0 !== undefined) return k0
  const k = fin.lPol.length
  fin.lPol.push(p); fin.lKind.push(kind); fin.lId.push(id); fin.lSeat.push(id); fin.lStart.push(s.year); fin.lEnd.push(-1); fin.lCause.push(LoanEnd.Ongoing)
  fin.lPrin.push(0); fin.lRate.push(rate); fin.lRate0.push(rate); fin.lRateMax.push(rate); fin.lPeak.push(0); fin.lPaid.push(0); fin.lLost.push(0)
  while (fin.open.length <= p) fin.open.push([])
  fin.open[p].push(k)
  fin.acct.set(key, k)
  if (fin.diag.rates.length < 4096) fin.diag.rates.push(rate)
  logX(s, EventType.LoanTaken, ps.pCapital[p], id, k, rate)
  return k
}

function closeAccount(s: HistoryState, fin: FinanceState, k: number, cause: number): void {
  if (fin.lEnd[k] >= 0) return
  fin.lEnd[k] = s.year
  fin.lCause[k] = cause
  const p = fin.lPol[k]
  const o = fin.open[p]
  const i = o.indexOf(k)
  if (i >= 0) o.splice(i, 1)
  fin.acct.delete(p * 16777216 + fin.lKind[k] * 4194304 + fin.lId[k])
}

function debtOf(fin: FinanceState, p: number): number {
  let d = 0
  if (p < fin.open.length) for (const k of fin.open[p]) d += fin.lPrin[k]
  return d
}

/** Writes off share h of p's accounts (a default or, h = 1, a repudiation); returns [lost, the seat that lost most]. */
function writeOff(s: HistoryState, ps: PolityState, fin: FinanceState, p: number, h: number, cause: number): [number, number] {
  let total = 0, worst = -1, worstX = 0
  const og = ps.og !== null && ps.og.oaths ? ps.og : null
  const list = p < fin.open.length ? fin.open[p].slice() : []
  for (const k of list) {
    const lost = h * fin.lPrin[k]
    if (!(lost > 0)) continue
    fin.lPrin[k] -= lost
    fin.lLost[k] += lost
    total += lost
    const share = lenderLose(s, fin, fin.lKind[k], fin.lId[k], lost)
    const seat = fin.lSeat[k]
    if (lost > worstX) { worstX = lost; worst = seat }
    if (fin.lKind[k] === LenderKind.Pool && share >= FIN.ruinShare && s.abandoned[seat] < 0) { logX(s, EventType.HousesRuined, seat, ps.pCapital[p], k, share > 1 ? 1 : share); fin.diag.ruined++ }
    // oaths: the polity of a foreign lender's seat holds it against the debtor
    const q = seat < ps.seen ? ps.polity[seat] : -1
    if (og !== null && q >= 0 && q !== p && ps.pEnded[q] < 0) {
      const Rq = q < fin.pcap ? fin.revOrd[q] : 0
      const w = 0.4 * FIN.grudgeW * (lost / (Rq > FIN.minRev ? Rq : FIN.minRev))
      recordGrievance(s, ps, og, GrievanceKind.CrownDefault, q, p, w < 0.4 * FIN.grudgeW ? w : 0.4 * FIN.grudgeW, seat, -1)
    }
    if (fin.lPrin[k] <= 1e-9) { fin.lPrin[k] = 0; closeAccount(s, fin, k, cause) }
  }
  fin.diag.lost += total
  return [total, worst]
}

/** The fiscal year of every alive polity (politySystem, just before the campaigns). */
export function fiscalYear(s: HistoryState, ps: PolityState, fin: FinanceState): void {
  ensureFinPolities(fin, ps.P)
  ensureFinSettlements(fin, s.count)
  const divert = FIN.divert
  // royalties on Treasure mined by members (goods on)
  const g = s.goods
  if (g !== null) {
    const worth = CLASS.worth[Good.Treasure]
    for (let d = 0; d < g.dCount; d++) {
      const out = g.dOut[d], wk = g.dWorker[d]
      if (!(out > 0) || wk < 0 || wk >= ps.seen || s.abandoned[wk] >= 0) continue
      const p = ps.polity[wk]
      if (p < 0) continue
      let x = FIN.royalty * out * worth
      const lim = 0.5 * s.wealth[wk]
      if (x > lim) x = lim
      if (!(x > 0)) continue
      fin.mineYear[p] += x
      if (divert) { s.wealth[wk] -= x; fin.coinYear[p] += x; fin.diag.inRoyalty += x }
    }
  }
  if (divert) poolsOfYear(s, pools)
  else pools.length = 0
  const alive = ps.alive
  for (let t = 0; t < alive.length; t++) {
    const p = alive[t]
    const cap = ps.pCapital[p]
    // account housekeeping: a seat abandoned (the crown keeps it), or now one of p's own towns (seized)
    if (p < fin.open.length && fin.open[p].length > 0) {
      for (const k of fin.open[p].slice()) {
        const seat = fin.lSeat[k]
        if (s.abandoned[seat] >= 0) { lenderLose(s, fin, fin.lKind[k], fin.lId[k], fin.lPrin[k]); fin.lLost[k] += fin.lPrin[k]; fin.lPrin[k] = 0; closeAccount(s, fin, k, LoanEnd.LenderGone) }
        else if (fin.lKind[k] === LenderKind.Pool && seat < ps.seen && ps.polity[seat] === p && fin.lStart[k] < s.year && seizedSince(ps, seat, fin.lStart[k])) { lenderLose(s, fin, fin.lKind[k], fin.lId[k], fin.lPrin[k]); fin.lLost[k] += fin.lPrin[k]; fin.lPrin[k] = 0; closeAccount(s, fin, k, LoanEnd.Seized) }
      }
    }
    // income
    const coin = fin.coinYear[p] + fin.coinNext[p]
    fin.coinYear[p] = 0; fin.coinNext[p] = 0
    fin.taxSm[p] += FIN.revSmooth * (fin.taxYear[p] - fin.taxSm[p]); fin.taxYear[p] = 0
    fin.mineSm[p] += FIN.revSmooth * (fin.mineYear[p] - fin.mineSm[p]); fin.mineYear[p] = 0
    const R = ps.pRevSm[p] + fin.taxSm[p] + fin.mineSm[p]
    fin.rev[p] = R
    if (ps.pWars[p] === 0) fin.revOrd[p] += FIN.revSmooth * (R - fin.revOrd[p])
    const R0 = fin.revOrd[p]
    const money = R0 >= FIN.minRev
    // expenses
    let ms = Math.sqrt(ps.pMembers[p] / FIN.courtRef)
    if (ms < FIN.courtMin) ms = FIN.courtMin
    else if (ms > FIN.courtMax) ms = FIN.courtMax
    const court = FIN.court * R0 * ms
    let garrison: number
    if (ps.og !== null && ps.og.arms) garrison = FIN.garrison * R0 * (1 + ARMS.costMul * at(ps.og.pArms, p, 0)) // arms: the cost of arms replaces rivalArmy
    else garrison = FIN.garrison * R0 * (1 + FIN.rivalArmy * maxRivalry(ps, p))
    let works = 0
    if (R0 > 0) works = R0 * (FIN.ring * ringsShare(s, ps, p) + FIN.fortW * fortsOf(ps, p))
    let war = 0
    for (const w of ps.activeWars) {
      const att = ps.wAtt[w] === p
      if (!att && ps.wDef[w] !== p) continue
      war += R0 * (att ? FIN.warAtt * (1 + (ps.wSiege[w] >= 0 ? FIN.siege : 0)) : FIN.warDef) * (ps.wKind[w] === WarKind.CivilWar ? FIN.civil : 1)
    }
    let trib = 0
    const sb = ps.pSub[p]
    if (sb >= 0 && ps.bEnd[sb] < 0) {
      const b = ps.bB[sb]
      trib = (ps.bKind[sb] === BondKind.Vassal ? VASSAL.share : VASSAL.tribute) * R
      if (b >= 0 && ps.pEnded[b] < 0 && divert) { if (b >= fin.pcap) ensureFinPolities(fin, b + 1); fin.coinNext[b] += trib; ps.pRevYear[b] += trib; fin.diag.inTrib += trib }
    }
    const E = court + garrison + works + war + trib
    fin.spendYear[p] = E
    fin.diag.outCourt += court; fin.diag.outGarrison += garrison; fin.diag.outWorks += works; fin.diag.outWar += war; fin.diag.outTrib += trib
    fin.treas[p] += coin - E
    // interest
    let interest = 0
    const open = p < fin.open.length ? fin.open[p] : null
    if (open !== null) for (const k of open) interest += fin.lRate[k] * fin.lPrin[k]
    fin.interest[p] = interest
    if (interest > 0) {
      const paidShare = fin.treas[p] >= interest ? 1 : fin.treas[p] > 0 ? fin.treas[p] / interest : 0
      for (const k of open!) {
        const due = fin.lRate[k] * fin.lPrin[k]
        const paid = due * paidShare
        if (paid > 0) { fin.lPaid[k] += paid; if (divert) lenderTake(s, fin, fin.lKind[k], fin.lId[k], paid, false) }
        if (paid < due) { fin.lPrin[k] += due - paid; if (fin.lPrin[k] > fin.lPeak[k]) fin.lPeak[k] = fin.lPrin[k] } // (arrears of interest capitalised)
      }
      fin.treas[p] -= interest * paidShare
      fin.diag.outInterest += interest * paidShare
    }
    // spend-back and overflow
    if (divert && s.abandoned[cap] < 0) {
      const back = FIN.home * (court + garrison + works) + FIN.warHome * war
      s.wealth[cap] += back
      fin.diag.homeBack += back
      const top = FIN.reserveCap * R0
      if (fin.treas[p] > top) { const x = fin.treas[p] - top; s.wealth[cap] += x; fin.treas[p] = top; fin.diag.overflow += x }
    }
    // rate, borrowing, repayment
    fin.debt[p] = debtOf(fin, p)
    const r = rateOf(s, fin, p)
    fin.rate[p] = r
    if (divert && money) {
      const target = ps.pWars[p] > 0 ? FIN.chest * war : 0
      let need = target - fin.treas[p] + (fin.treas[p] < 0 ? FIN.cushion * E : 0)
      let room = headroomOf(s, fin, p)
      if (need > FIN.minLoan * R0 && r < FIN.refuse && room > 0) {
        lenderCandidates(s, ps, fin, p, pools, offers)
        for (const o of offers) {
          if (!(need > 0) || !(room > 0)) break
          let x = lenderRoom(s, fin, o)
          if (x > need) x = need
          if (x > room) x = room
          if (x < FIN.minLoan * R0 * 0.25) continue
          const rr = r + (o.foreign ? FIN.rForeign : 0)
          const k = account(s, ps, fin, p, o.kind, o.id, rr)
          const y = lenderGive(s, fin, o.kind, o.id, x)
          if (!(y > 0)) continue
          fin.lRate[k] = (fin.lPrin[k] * fin.lRate[k] + y * rr) / (fin.lPrin[k] + y)
          if (fin.lRate[k] > fin.lRateMax[k]) fin.lRateMax[k] = fin.lRate[k]
          fin.lPrin[k] += y
          if (fin.lPrin[k] > fin.lPeak[k]) fin.lPeak[k] = fin.lPrin[k]
          fin.treas[p] += y
          fin.diag.lent += y
          need -= y; room -= y
        }
      } else if (ps.pWars[p] === 0 && open !== null && open.length > 0 && fin.treas[p] > FIN.repayAbove * R0) {
        let pay = FIN.repay * (fin.treas[p] - FIN.repayAbove * R0)
        const order = open.slice().sort((a, b) => fin.lRate[b] - fin.lRate[a] || a - b)
        for (const k of order) {
          if (!(pay > 0)) break
          const x = pay < fin.lPrin[k] ? pay : fin.lPrin[k]
          fin.lPrin[k] -= x
          fin.treas[p] -= x
          pay -= x
          fin.diag.repaid += x
          lenderTake(s, fin, fin.lKind[k], fin.lId[k], x, true)
          if (fin.lPrin[k] <= 1e-9) { fin.lPrin[k] = 0; closeAccount(s, fin, k, LoanEnd.Repaid) }
        }
      }
      fin.debt[p] = debtOf(fin, p)
    }
    // arrears and the army's pay
    fin.unpaid[p] = fin.treas[p] < 0 && (money || fin.debt[p] > 0) ? fin.unpaid[p] + 1 : 0
    const u = fin.unpaid[p] / FIN.unpaidFull
    ps.pPay[p] = divert && money ? 1 - FIN.unpaidProj * (u < 1 ? u : 1) : 1
    // default
    const debt = fin.debt[p]
    if (divert && debt > 0 && s.year - fin.lastDefault[p] >= FIN.defaultGap && (fin.interest[p] > FIN.dsBreak * R0 || (fin.unpaid[p] >= FIN.arrearYears && debt > FIN.needDebtLow * R0))) {
      let h = 1 - (FIN.dsAfter * R0) / (r * debt) // (a realm whose revenue has gone writes off nearly all)
      if (h < FIN.hMin) h = FIN.hMin
      if (h > 1) h = 1
      const [, worst] = writeOff(s, ps, fin, p, h, LoanEnd.Defaulted)
      fin.stain[p] += FIN.stainDefault * h
      fin.lastDefault[p] = s.year
      if (fin.treas[p] < 0) fin.treas[p] = 0
      fin.unpaid[p] = 0
      ps.pPay[p] = 1
      fin.diag.defaults++
      fin.diag.defaultLog.push(s.year, p, h, debt, R0)
      logX(s, EventType.CrownDefault, cap, worst, p, h)
      fin.debt[p] = debtOf(fin, p)
    }
    // repudiation by a new ruler
    if (fin.acc[p] !== 0) {
      fin.acc[p] = 0
      if (divert && money && fin.debt[p] > FIN.repudiateMin * R0) {
        const Rr = s.rul
        const wl = Rr !== null && p < Rr.pcap && Rr.cur[p] >= 0 ? Rr.rWar[Rr.cur[p]] : 0.5
        if (fin.rng.next() < FIN.repudiate * (0.5 + wl)) {
          const d0 = fin.debt[p]
          const [, worst] = writeOff(s, ps, fin, p, 1, LoanEnd.Repudiated)
          fin.stain[p] += FIN.stainRepudiate
          fin.lastDefault[p] = s.year
          fin.diag.repudiations++
          logX(s, EventType.Repudiation, cap, worst, p, d0)
          fin.debt[p] = 0
        }
      }
    }
    // tax pressure (C8 factor 1)
    if (divert && money) {
      const def = (E - coin) / R0
      const want = 1 + FIN.taxUp * (def > 0 ? (def < 1 ? def : 1) : 0)
      let m = fin.taxMul[p] + FIN.taxRate * (want - fin.taxMul[p])
      if (m < 1) m = 1
      else if (m > FIN.taxMax) m = FIN.taxMax
      fin.taxMul[p] = m
    }
    fin.stain[p] *= FIN.stainKeep
    fin.defSm[p] += FIN.sfdSmooth * ((E + interest - coin) / (R0 > FIN.minRev ? R0 : FIN.minRev) - fin.defSm[p])
    fin.spendSm[p] += FIN.revSmooth * (E + interest - fin.spendSm[p])
  }
  for (let id = 0; id < s.count && id < fin.paidTax.length; id++) fin.paidTax[id] = 0
}

/** True when the pool seat was taken by p after the account opened (its last change of hands since then). */
function seizedSince(ps: PolityState, seat: number, start: number): boolean {
  return ps.joined[seat] > start
}

/** Max rivalry of p with a bordering polity (for the garrison). */
function maxRivalry(ps: PolityState, p: number): number {
  let m = 0
  const R = ps.relA.length
  for (let r = 0; r < R; r++) {
    if (ps.relA[r] !== p && ps.relB[r] !== p) continue
    if (ps.relEdges[r].length === 0) continue
    if (ps.relR[r] > m) m = ps.relR[r]
  }
  return m < 1 ? m : 1
}

/** sum(rings * pop) / pPop over p's members (the last control pass's member list). */
function ringsShare(s: HistoryState, ps: PolityState, p: number): number {
  if (p + 1 >= ps.memOff.length || !(ps.pPop[p] > 0)) return 0
  let x = 0
  for (let k = ps.memOff[p]; k < ps.memOff[p + 1]; k++) { const m = ps.memList[k]; if (ps.polity[m] === p && ps.walls[m] > 0) x += ps.walls[m] * s.pop[m] }
  return x / ps.pPop[p]
}

function fortsOf(ps: PolityState, p: number): number {
  if (p + 1 >= ps.memOff.length) return 0
  let n = 0
  for (let k = ps.memOff[p]; k < ps.memOff[p + 1]; k++) { const m = ps.memList[k]; if (ps.polity[m] === p && ps.fort[m] >= 0) n++ }
  return n
}

/** endPolity hook: absorbed or reunified, its debts pass to the absorber (Assumed); otherwise the lenders lose all (Lost). */
export function finPolityEnded(s: HistoryState, ps: PolityState, fin: FinanceState, p: number, cause: number, by: number): void {
  if (p >= fin.open.length || fin.open[p].length === 0) return
  const x = by >= 0 && by < ps.seen ? ps.polity[by] : -1
  const pass = (cause === PolityEnd.Absorbed || cause === PolityEnd.Reunified) && x >= 0 && x !== p && ps.pEnded[x] < 0
  for (const k of fin.open[p].slice()) {
    const prin = fin.lPrin[k]
    if (pass) {
      closeAccount(s, fin, k, LoanEnd.Assumed)
      const key = x * 16777216 + fin.lKind[k] * 4194304 + fin.lId[k]
      let j = fin.acct.get(key)
      if (j === undefined) {
        j = fin.lPol.length
        fin.lPol.push(x); fin.lKind.push(fin.lKind[k]); fin.lId.push(fin.lId[k]); fin.lSeat.push(fin.lSeat[k]); fin.lStart.push(s.year); fin.lEnd.push(-1); fin.lCause.push(LoanEnd.Ongoing)
        fin.lPrin.push(0); fin.lRate.push(fin.lRate[k]); fin.lRate0.push(fin.lRate[k]); fin.lRateMax.push(fin.lRate[k]); fin.lPeak.push(0); fin.lPaid.push(0); fin.lLost.push(0)
        while (fin.open.length <= x) fin.open.push([])
        fin.open[x].push(j)
        fin.acct.set(key, j)
      }
      fin.lRate[j] = (fin.lPrin[j] * fin.lRate[j] + prin * fin.lRate[k]) / (fin.lPrin[j] + prin + 1e-12)
      fin.lPrin[j] += prin
      if (fin.lPrin[j] > fin.lPeak[j]) fin.lPeak[j] = fin.lPrin[j]
    } else {
      const share = lenderLose(s, fin, fin.lKind[k], fin.lId[k], prin)
      fin.lLost[k] += prin
      fin.diag.lost += prin
      const seat = fin.lSeat[k]
      if (fin.lKind[k] === LenderKind.Pool && share >= FIN.ruinShare && s.abandoned[seat] < 0) { logX(s, EventType.HousesRuined, seat, ps.pCapital[p], k, share > 1 ? 1 : share); fin.diag.ruined++ }
      closeAccount(s, fin, k, LoanEnd.Lost)
    }
    fin.lPrin[k] = 0
  }
  fin.debt[p] = 0
}

/** city-states: a charter price paid partly by cancelling p's debt to lenders seated at `town`; returns the remainder to pay. */
export function finCharterOffset(s: HistoryState, p: number, town: number, price: number): number {
  const fin = s.fin
  if (fin === null || p >= fin.open.length) return price
  let left = price
  for (const k of fin.open[p].slice()) {
    if (!(left > 0)) break
    if (fin.lSeat[k] !== town) continue
    const x = left < fin.lPrin[k] ? left : fin.lPrin[k]
    fin.lPrin[k] -= x
    left -= x
    const e = fin.expo[fin.lId[k]] - x
    fin.expo[fin.lId[k]] = e > 0 ? e : 0
    if (fin.lPrin[k] <= 1e-9) { fin.lPrin[k] = 0; closeAccount(s, fin, k, LoanEnd.Charter) }
  }
  fin.debt[p] = debtOf(fin, p)
  return left
}
