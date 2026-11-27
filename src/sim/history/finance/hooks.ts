// finance: the narrow hooks other systems call (state-finances.md §0.3, §0.3b, §0.5, §2.4.1, §2.4.6). Every query is O(1) or
// O(accounts of p), RNG-free, and returns its neutral value (or the old flow) when s.fin is null.
//
// Booking (where the coin flows already happen): crownRev (duties and seizures, 5 sites), bookTax (the wealth tax), bookPlunder,
// finCredit. With finance on (and FIN.divert) the coin goes to the treasury instead of the capital's wealth.
// Queries for city-states, society, court and seat-mode: finNeed, finDefaulted, finRevenue, finTownRevenue, finTreasury, finSpend,
// finCredit, finCharterOffset, crownOwedAt, setRateMul, setCourtRateMul, finSFD, finMonetised, finOutsideBorrow, finCanDebase,
// and the money queries (finPrice, finReal, finAccept, finWageLag, finInflation: neutral until the money layer, D-S4).
// War chain factors: finWarDrive (C1 factor 4), finPeaceDebt (C6 factor 2), finOverthrow (C3 factor 1), finPay, finExhaust.

import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { FIN } from './params.ts'
import type { FinanceState } from './state.ts'
import { ensureFinPolities, ensureFinSettlements } from './state.ts'

/** Coin booked to p this year. */
export function book(fin: FinanceState, p: number, x: number): void {
  if (p >= fin.pcap) ensureFinPolities(fin, p + 1)
  fin.coinYear[p] += x
}

/**
 * Duties and seizures collected at settlement c for polity q (outlaw.ts flushAccounts, longhaul.ts). Off: exactly the old two
 * statements. On: pRevYear keeps its meaning; the coin goes to q's treasury (to the collector's income when q < 0 or ended).
 */
export function crownRev(s: HistoryState, ps: PolityState, income: Float64Array, c: number, q: number, x: number): void {
  const fin = s.fin
  if (fin === null || !FIN.divert || q < 0 || ps.pEnded[q] >= 0) {
    if (c >= 0 && s.abandoned[c] < 0) income[c] += x
    if (q >= 0) ps.pRevYear[q] += x
    return
  }
  ps.pRevYear[q] += x
  book(fin, q, x)
  fin.diag.inDuty += x
}

/** taxSystem: the wealth tax w a member `id` of p paid; returns true when the coin went to the treasury (else the capital takes it). */
export function bookTax(fin: FinanceState, p: number, id: number, w: number): boolean {
  if (id >= fin.paidTax.length) ensureFinSettlements(fin, id + 1)
  fin.paidTax[id] += w
  if (p >= fin.pcap) ensureFinPolities(fin, p + 1)
  fin.taxYear[p] += w
  if (!FIN.divert) return false
  book(fin, p, w)
  fin.diag.inTax += w
  return true
}

/** conquer: the conqueror's share x of the plunder; returns the part left for the capital. */
export function bookPlunder(fin: FinanceState, p: number, x: number): number {
  if (!FIN.divert) return x
  const c = FIN.plunderCrown * x
  if (p >= fin.pcap) ensureFinPolities(fin, p + 1)
  fin.coinNext[p] += c
  fin.diag.inPlunder += c
  return x - c
}

/** The tax pressure of p (C8 factor 1), or undefined (skipped) when finance is off or p is at 1. */
export function finTaxPressure(s: HistoryState, p: number): number | undefined {
  const fin = s.fin
  if (fin === null || p >= fin.pcap || fin.taxMul[p] === 1) return undefined
  return fin.taxMul[p]
}

/** R° of p (0 off). */
export function finRevOrd(s: HistoryState, p: number): number {
  const fin = s.fin
  return fin === null || p >= fin.pcap ? 0 : fin.revOrd[p]
}

/** finMonetised: R° >= FIN.minRev. */
export function finMonetised(s: HistoryState, p: number): boolean {
  const fin = s.fin
  return fin !== null && p < fin.pcap && fin.revOrd[p] >= FIN.minRev
}

/** Crown need 0..1 (city-states §9.2; arms fatigue; the oath calculus' war cost). */
export function finNeed(s: HistoryState, ps: PolityState, p: number): number {
  const fin = s.fin
  if (fin === null || p >= fin.pcap) return 0
  const R = fin.revOrd[p]
  if (R < FIN.minRev) { if (ps.pWars[p] > 0) { const e = ps.pExh[p]; return 0.4 + 0.6 * (e > 1 ? 1 : e) } return 0 }
  let n = smoothstep(FIN.needDebtLow, FIN.needDebtHigh, fin.debt[p] / R) + (fin.unpaid[p] >= 1 ? 0.4 : 0) + (ps.pWars[p] > 0 ? 0.3 : 0)
  if (finDefaulted(s, p)) n += 0.5
  return n > 1 ? 1 : n
}

/** In arrears, or a default or repudiation within FIN.defaultedYears. */
export function finDefaulted(s: HistoryState, p: number): boolean {
  const fin = s.fin
  if (fin === null || p >= fin.pcap) return false
  return fin.unpaid[p] >= 1 || s.year - fin.lastDefault[p] <= FIN.defaultedYears
}

/** R, the crown's coin revenue a year now. */
export function finRevenue(s: HistoryState, p: number): number {
  const fin = s.fin
  return fin === null || p >= fin.pcap ? 0 : fin.rev[p]
}

/** A town's taxable revenue a year (the proxy of §0.3: its own income, its merchants' pay, the wealth tax it paid this year). */
export function finTownRevenue(s: HistoryState, id: number): number {
  const fin = s.fin
  const m = s.goods !== null ? s.goods.ext.merch.mw : null
  return 0.02 * s.wealth[id] + (m !== null && id < m.length ? 0.0003 * m[id] : 0) + (fin !== null && id < fin.paidTax.length ? fin.paidTax[id] : 0)
}

/** Coin in p's treasury (negative: arrears). */
export function finTreasury(s: HistoryState, p: number): number {
  const fin = s.fin
  return fin === null || p >= fin.pcap ? 0 : fin.treas[p]
}

/** p pays `amount` now from its treasury if it has it (credit for this is the next fiscal year's borrowing); true if paid. */
export function finSpend(s: HistoryState, p: number, amount: number, kind: 'suppress' | 'mercenary' | 'welfare' | 'subsidy' | 'envoys' | 'other' = 'other'): boolean {
  const fin = s.fin
  void kind
  if (fin === null || p >= fin.pcap || !(amount > 0)) return false
  if (fin.treas[p] < amount) return false
  fin.treas[p] -= amount
  fin.diag.outSpend += amount
  return true
}

/** Coin received by p: a charter price, a free city's due, an estates' grant, offices sold, a sponsor's subsidy. */
export function finCredit(s: HistoryState, p: number, amount: number, kind: 'charter' | 'due' | 'grant' | 'venal' | 'subsidy'): void {
  const fin = s.fin
  void kind
  if (fin === null || p < 0 || !(amount > 0)) return
  book(fin, p, amount)
  fin.diag.inCredit += amount
}

/** Principal p owes lenders seated at `town`. */
export function crownOwedAt(s: HistoryState, p: number, town: number): number {
  const fin = s.fin
  if (fin === null || p >= fin.open.length) return 0
  let x = 0
  for (const k of fin.open[p]) if (fin.lSeat[k] === town) x += fin.lPrin[k]
  return x
}

/** city-states: a government's credit multiplier (C9 gov factor; 1 default). */
export function setRateMul(s: HistoryState, p: number, m: number): void {
  const fin = s.fin
  if (fin === null) return
  if (p >= fin.pcap) ensureFinPolities(fin, p + 1)
  fin.rateGov[p] = m
}

/** court-politics: the court's credit multiplier (C9 court factor; 1 default). */
export function setCourtRateMul(s: HistoryState, p: number, m: number): void {
  const fin = s.fin
  if (fin === null) return
  if (p >= fin.pcap) ensureFinPolities(fin, p + 1)
  fin.rateCourt[p] = m
}

/** finSFD (§2.8): the fiscal part of Goldstone's state fiscal distress, >= 0, 1 an ordinary realm; the society proxy when unmonetised. */
export function finSFD(s: HistoryState, ps: PolityState, p: number): number {
  const fin = s.fin
  if (fin === null || p >= fin.pcap || fin.revOrd[p] < FIN.minRev) {
    let e = ps.pExh[p]
    if (e > 1) e = 1
    const R = s.rul
    const lost = R !== null && p < R.pcap && s.year - R.lost[p] <= 10 ? 0.5 : 0
    return 1 + 0.6 * e + lost + (ps.pCrisisUntil[p] > s.year ? 0.3 : 0)
  }
  const R0 = fin.revOrd[p]
  const u = fin.unpaid[p] < 3 ? fin.unpaid[p] : 3
  const t = fin.treas[p] > 0 ? fin.treas[p] / (FIN.reserveCap * R0) : 0
  const d = fin.debt[p] / R0 - FIN.needDebtLow
  const x = 1 + FIN.sfdLoad * (d > 0 ? d : 0) + FIN.sfdDef * (fin.defSm[p] > 0 ? fin.defSm[p] : 0) + FIN.sfdArr * u + (finDefaulted(s, p) ? FIN.sfdDefault : 0) - FIN.sfdReserve * (t < 1 ? t : 1)
  return x < FIN.sfdMin ? FIN.sfdMin : x > FIN.sfdMax ? FIN.sfdMax : x
}

/** C1 factor 4: a crown that can fund a war declares readily; one with no money or a recent default holds back (undefined: skipped). */
export function finWarDrive(s: HistoryState, ps: PolityState, p: number): number | undefined {
  const fin = s.fin
  if (!FIN.divert) return undefined // (shadow mode: no effects)
  if (fin === null || p >= fin.pcap) return undefined
  const R0 = fin.revOrd[p]
  if (R0 < FIN.minRev) return undefined
  const cost = FIN.warAtt * R0
  const surplus = fin.rev[p] - fin.spendYear[p] - fin.interest[p]
  const gap = cost - (surplus > 0 ? surplus : 0)
  const room = headroomOf(s, fin, p)
  const fy = gap <= 1e-9 ? 1e9 : ((fin.treas[p] > 0 ? fin.treas[p] : 0) + room) / gap
  void ps
  return FIN.declFloor + (1 - FIN.declFloor) * smoothstep(FIN.fundLow, FIN.fundHigh, fy) * (fy > FIN.chestYears ? FIN.chestMul : 1) * (s.year - fin.lastDefault[p] < FIN.afterYears ? FIN.afterDefault : 1)
}

/** The rate p could borrow at now (§2.4.4, without the foreign premium). */
export function rateOf(s: HistoryState, fin: FinanceState, p: number): number {
  const R0 = fin.revOrd[p]
  const R = s.rul
  const ab = R !== null && p < R.pcap && R.cur[p] >= 0 ? R.rAbility[R.cur[p]] : 1
  const load = R0 > 0 ? fin.debt[p] / R0 - FIN.loadFree : 0
  let m = fin.rateGov[p] * fin.rateCourt[p] // C9 (gov · court; clamped [0.5, 2])
  if (m < 0.5) m = 0.5
  else if (m > 2) m = 2
  const pw = s.pol !== null && s.pol.pWars[p] > 0 ? FIN.rWar : 0
  const r = m * FIN.rBase + FIN.rStain * fin.stain[p] + FIN.rLoad * (load > 0 ? load : 0) + pw + FIN.rCoin * (1 - fin.coin[p]) - FIN.rAble * (ab - 1)
  return r < FIN.rMin ? FIN.rMin : r > FIN.rMax ? FIN.rMax : r
}

/** Borrowing room left under the credit limit: dsMax * R° * (1 + warlikeDs * (rWar - 0.5)) / r - debt (0 when refused). */
export function headroomOf(s: HistoryState, fin: FinanceState, p: number): number {
  const r = rateOf(s, fin, p)
  if (r >= FIN.refuse) return 0
  const R = s.rul
  const wl = R !== null && p < R.pcap && R.cur[p] >= 0 ? R.rWar[R.cur[p]] : 0.5
  const h = (FIN.dsMax * fin.revOrd[p] * (1 + FIN.warlikeDs * (wl - 0.5))) / r - fin.debt[p]
  return h > 0 ? h : 0
}

/** court-politics: the headroom-limited amount the borrowing rule would lend p now (pure). */
export function finOutsideBorrow(s: HistoryState, p: number, x: number): number {
  const fin = s.fin
  if (fin === null || p >= fin.pcap) return 0
  const h = headroomOf(s, fin, p)
  return x < h ? x : h
}

/** court-politics: the debasement gate (pure; debasement is deferred, so false). */
export function finCanDebase(s: HistoryState, p: number): boolean {
  void s; void p
  return FIN.debase && false
}

/** C6 factor 2: the tired-peace chance * (1 + peaceDebt * min(2, the more indebted side's debt / R°)) (undefined: skipped). */
export function finPeaceDebt(s: HistoryState, p: number, q: number): number | undefined {
  const fin = s.fin
  if (!FIN.divert) return undefined // (shadow mode: no effects)
  if (fin === null) return undefined
  const lp = p < fin.pcap && fin.revOrd[p] >= FIN.minRev ? fin.debt[p] / fin.revOrd[p] : 0
  const lq = q < fin.pcap && fin.revOrd[q] >= FIN.minRev ? fin.debt[q] / fin.revOrd[q] : 0
  const l = lp > lq ? lp : lq
  return 1 + FIN.peaceDebt * (l < 2 ? l : 2)
}

/** C3 factor 1: an unpaid army's mutterings: 1 + unpaidOverthrow * min(unpaid, 3) (undefined: skipped). */
export function finOverthrow(s: HistoryState, p: number): number | undefined {
  const fin = s.fin
  if (!FIN.divert) return undefined // (shadow mode: no effects)
  if (fin === null || p >= fin.pcap) return undefined
  const u = fin.unpaid[p]
  return 1 + FIN.unpaidOverthrow * (u < 3 ? u : 3)
}

/** war.ts exhaust: with finance, the unpaid term (replacing WAR.poor); null without it. */
export function finExhaust(s: HistoryState, p: number): number | null {
  const fin = s.fin
  if (!FIN.divert) return null // (shadow mode: no effects)
  if (fin === null || p >= fin.pcap || fin.revOrd[p] < FIN.minRev) return null // (an unmonetised realm: exhaustion rules it as before)
  const u = fin.unpaid[p]
  return FIN.unpaidExh * (u < 3 ? u : 3)
}

/** Unpaid years of p (0 off). */
export function finUnpaid(s: HistoryState, p: number): number {
  const fin = s.fin
  return fin === null || p >= fin.pcap ? 0 : fin.unpaid[p]
}

/** rulers: an accession that may repudiate the crown's debts (usurped, a conqueror's choice, a new house). */
export function finAccession(fin: FinanceState, p: number, how: number): void {
  if (p >= fin.pcap) ensureFinPolities(fin, p + 1)
  fin.acc[p] = how + 1
}

// --- Money (§0.3b): neutral until the money layer lands (D-S4) ---
/** Price level of p's coin (1). */
export function finPrice(s: HistoryState, p: number): number { void s; void p; return 1 }
/** Real value of nominal coin of p (the nominal, at price 1). */
export function finReal(s: HistoryState, p: number, nominal: number): number { void s; void p; return nominal }
/** Share of face value at which q accepts p's coin (1). */
export function finAccept(s: HistoryState, p: number, q: number): number { void s; void p; void q; return 1 }
/** Wages against prices (1). */
export function finWageLag(s: HistoryState, p: number): number { void s; void p; return 1 }
/** Smoothed inflation (0). */
export function finInflation(s: HistoryState, p: number): number { void s; void p; return 0 }

/** unrest grievance terms[5] (Taxes): taxGrief * (taxMul - 1) (+ coinGrief * (1 - coin) once debasement lands). */
export function finTaxGrief(s: HistoryState, p: number): number {
  const fin = s.fin
  if (fin === null || p >= fin.pcap) return 0
  return FIN.taxGrief * (fin.taxMul[p] - 1)
}

/** tariffStep need: the treasury in years of R° (with finance on and monetised), else NaN (the old capital wealth / mass). */
export function finNeedYears(s: HistoryState, p: number): number {
  const fin = s.fin
  if (fin === null || p >= fin.pcap || fin.revOrd[p] < FIN.minRev || !FIN.divert) return NaN
  return fin.treas[p] / fin.revOrd[p]
}
