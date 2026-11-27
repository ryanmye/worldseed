// finance: the state of crown treasuries and loans (state-finances.md §2.2). Per polity arrays grow by doubling with ps.P;
// loan accounts are JS arrays in order of opening (prefix-stable). HistoryState.fin is null when HistoryOptions.finance is off.

import type { Rng } from '../../rng.ts'
import { createRng } from '../../rng.ts'

export interface FinanceDiag {
  /** Coin booked by source over the run: wealth tax, duties, tribute in, plunder, royalties, credits (charters, dues, grants). */
  inTax: number
  inDuty: number
  inTrib: number
  inPlunder: number
  inRoyalty: number
  inCredit: number
  /** Spending by kind: court, garrison, works, war, tribute out, interest; spent by finSpend (suppress, mercenary, welfare...). */
  outCourt: number
  outGarrison: number
  outWorks: number
  outWar: number
  outTrib: number
  outInterest: number
  outSpend: number
  /** Borrowed, repaid (principal), lost by lenders (defaults, repudiations, lost crowns), spent back into capitals, overflow. */
  lent: number
  repaid: number
  lost: number
  homeBack: number
  overflow: number
  defaults: number
  repudiations: number
  bankrupt: number
  unpaidWars: number
  ruined: number
  /** Rates of loans opened (a sample, for the harness median). */
  rates: number[]
  /** Per default: year, polity, haircut, debt, R°. */
  defaultLog: number[]
}

export interface FinanceState {
  /** 'history-finance': repudiation only (debasement deferred). */
  rng: Rng
  pcap: number
  /** Coin in the treasury (wealth units); negative = bills in arrears. */
  treas: Float64Array
  /** Coin booked this year, and booked for next year (plunder, tribute paid after the payee's fiscal year). */
  coinYear: Float64Array
  coinNext: Float64Array
  /** This year's wealth tax and royalties (summed as booked), and their smoothed values a year. */
  taxYear: Float64Array
  mineYear: Float64Array
  taxSm: Float64Array
  mineSm: Float64Array
  /** R: revenue a year now (pRevSm + taxSm + mineSm); R°: ordinary revenue, smoothed over years at peace only. */
  rev: Float64Array
  revOrd: Float64Array
  /** Spending a year, smoothed; last year's expenses (E, before interest). */
  spendSm: Float64Array
  spendYear: Float64Array
  /** Principal outstanding, interest due this year. */
  debt: Float64Array
  interest: Float64Array
  /** Credit record (a stain), the rate it could borrow at. */
  stain: Float64Array
  rate: Float64Array
  /** Consecutive years in arrears; year of the last default or repudiation. */
  unpaid: Int32Array
  lastDefault: Int32Array
  /** Tax pressure (1..taxMax), silver content of the coin (1: sound; debasement deferred), credit multipliers (C9: government, court). */
  taxMul: Float64Array
  coin: Float64Array
  rateGov: Float64Array
  rateCourt: Float64Array
  /** An accession that may repudiate since the last fiscal year: AccessionHow + 1, 0 none. */
  acc: Int8Array
  /** Smoothed deficit / R° (finSFD). */
  defSm: Float64Array
  // --- Loan accounts ---
  lPol: number[]; lKind: number[]; lId: number[]; lSeat: number[]
  lStart: number[]; lEnd: number[]; lCause: number[]
  lPrin: number[]; lRate: number[]; lRate0: number[]; lRateMax: number[]; lPeak: number[]; lPaid: number[]; lLost: number[]
  /** Open accounts per polity (ascending), and the open account of (polity, kind, id) by key (lookup only). */
  open: number[][]
  acct: Map<number, number>
  /** Pool and Town lenders' crown exposure per settlement; the wealth tax each settlement paid this year. */
  expo: Float64Array
  paidTax: Float64Array
  /** Wars with an ArmyUnpaid logged: bit 1 attacker, 2 defender (lazy by war id). */
  wUnpaid: number[]
  // --- Snapshots (ragged per polity) ---
  snTreas: Float32Array<ArrayBuffer>; snDebt: Float32Array<ArrayBuffer>; snRev: Float32Array<ArrayBuffer>; snSpend: Float32Array<ArrayBuffer>
  snRate: Uint8Array<ArrayBuffer>; snCoin: Uint8Array<ArrayBuffer>; snSFD: Uint8Array<ArrayBuffer>
  snOff: number[]; snN: number[]; snUsed: number
  /** Loan balances per trade snapshot (ragged per account). */
  lbSnap: Float32Array<ArrayBuffer>; lbOff: number[]; lbN: number[]; lbUsed: number
  diag: FinanceDiag
}

const f64 = (n: number, v = 0) => { const a = new Float64Array(n); if (v !== 0) a.fill(v); return a }

export function createFinance(seed: number, settlements: number): FinanceState {
  const n = 64
  return {
    rng: createRng(seed, 'history-finance'),
    pcap: n,
    treas: f64(n), coinYear: f64(n), coinNext: f64(n), taxYear: f64(n), mineYear: f64(n), taxSm: f64(n), mineSm: f64(n), rev: f64(n), revOrd: f64(n),
    spendSm: f64(n), spendYear: f64(n), debt: f64(n), interest: f64(n), stain: f64(n), rate: f64(n, 0.05), unpaid: new Int32Array(n), lastDefault: new Int32Array(n).fill(-1000000),
    taxMul: f64(n, 1), coin: f64(n, 1), rateGov: f64(n, 1), rateCourt: f64(n, 1), acc: new Int8Array(n), defSm: f64(n),
    lPol: [], lKind: [], lId: [], lSeat: [], lStart: [], lEnd: [], lCause: [], lPrin: [], lRate: [], lRate0: [], lRateMax: [], lPeak: [], lPaid: [], lLost: [],
    open: [], acct: new Map(),
    expo: f64(Math.max(256, settlements)), paidTax: f64(Math.max(256, settlements)),
    wUnpaid: [],
    snTreas: new Float32Array(1024), snDebt: new Float32Array(1024), snRev: new Float32Array(1024), snSpend: new Float32Array(1024),
    snRate: new Uint8Array(1024), snCoin: new Uint8Array(1024), snSFD: new Uint8Array(1024), snOff: [], snN: [], snUsed: 0,
    lbSnap: new Float32Array(1024), lbOff: [], lbN: [], lbUsed: 0,
    diag: {
      inTax: 0, inDuty: 0, inTrib: 0, inPlunder: 0, inRoyalty: 0, inCredit: 0, outCourt: 0, outGarrison: 0, outWorks: 0, outWar: 0, outTrib: 0, outInterest: 0, outSpend: 0,
      lent: 0, repaid: 0, lost: 0, homeBack: 0, overflow: 0, defaults: 0, repudiations: 0, bankrupt: 0, unpaidWars: 0, ruined: 0, rates: [], defaultLog: [],
    },
  }
}

function grow<T extends Float64Array | Int32Array | Int8Array>(a: T, size: number, fill = 0): T {
  const b = new (a.constructor as { new (n: number): T })(size)
  if (fill !== 0) b.fill(fill)
  b.set(a)
  return b
}

/** Grows the per-polity arrays to hold `need` polities. */
export function ensureFinPolities(fin: FinanceState, need: number): void {
  if (need <= fin.pcap) return
  let n = fin.pcap
  while (n < need) n *= 2
  fin.treas = grow(fin.treas, n); fin.coinYear = grow(fin.coinYear, n); fin.coinNext = grow(fin.coinNext, n); fin.taxYear = grow(fin.taxYear, n); fin.mineYear = grow(fin.mineYear, n)
  fin.taxSm = grow(fin.taxSm, n); fin.mineSm = grow(fin.mineSm, n); fin.rev = grow(fin.rev, n); fin.revOrd = grow(fin.revOrd, n); fin.spendSm = grow(fin.spendSm, n); fin.spendYear = grow(fin.spendYear, n)
  fin.debt = grow(fin.debt, n); fin.interest = grow(fin.interest, n); fin.stain = grow(fin.stain, n); fin.rate = grow(fin.rate, n, 0.05); fin.unpaid = grow(fin.unpaid, n)
  fin.lastDefault = grow(fin.lastDefault, n, -1000000); fin.taxMul = grow(fin.taxMul, n, 1); fin.coin = grow(fin.coin, n, 1); fin.rateGov = grow(fin.rateGov, n, 1); fin.rateCourt = grow(fin.rateCourt, n, 1)
  fin.acc = grow(fin.acc, n); fin.defSm = grow(fin.defSm, n)
  fin.pcap = n
}

/** Grows the per-settlement arrays to hold `need` settlements. */
export function ensureFinSettlements(fin: FinanceState, need: number): void {
  if (need <= fin.expo.length) return
  let n = fin.expo.length
  while (n < need) n *= 2
  fin.expo = grow(fin.expo, n); fin.paidTax = grow(fin.paidTax, n)
}
