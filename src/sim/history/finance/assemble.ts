// finance: snapshots during the run and the History tables at assembly (state-finances.md §2.5). Empty when finance is off.

import type { Loans } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { FIN } from './params.ts'
import type { FinanceState } from './state.ts'
import { finSFD } from './hooks.ts'

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
const byte = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0)

/** Snapshot hook (with polSnapshot): treasury, debt, revenue, spending, rate, coin and distress per polity. */
export function finSnapshot(s: HistoryState, ps: PolityState, fin: FinanceState): void {
  const P = ps.P
  const o = fin.snUsed
  fin.snTreas = growF(fin.snTreas, o + P); fin.snDebt = growF(fin.snDebt, o + P); fin.snRev = growF(fin.snRev, o + P); fin.snSpend = growF(fin.snSpend, o + P)
  fin.snRate = growU(fin.snRate, o + P); fin.snCoin = growU(fin.snCoin, o + P); fin.snSFD = growU(fin.snSFD, o + P)
  for (let p = 0; p < P; p++) {
    const live = ps.pEnded[p] < 0 && p < fin.pcap
    fin.snTreas[o + p] = live ? fin.treas[p] : 0
    fin.snDebt[o + p] = live ? fin.debt[p] : 0
    fin.snRev[o + p] = live ? fin.revOrd[p] : 0
    fin.snSpend[o + p] = live ? fin.spendSm[p] : 0
    fin.snRate[o + p] = live ? (fin.rate[p] >= FIN.refuse ? 255 : byte(fin.rate[p] / 0.5)) : 0
    fin.snCoin[o + p] = live ? byte(fin.coin[p]) : 0
    fin.snSFD[o + p] = live ? byte(finSFD(s, ps, p) / FIN.sfdMax) : 0
  }
  fin.snOff.push(o); fin.snN.push(P); fin.snUsed += P
}

/** Trade-snapshot hook: the principal of every account. */
export function finTradeSnapshot(fin: FinanceState): void {
  const n = fin.lPol.length
  const o = fin.lbUsed
  fin.lbSnap = growF(fin.lbSnap, o + n)
  for (let k = 0; k < n; k++) fin.lbSnap[o + k] = fin.lEnd[k] >= 0 ? 0 : fin.lPrin[k]
  fin.lbOff.push(o); fin.lbN.push(n); fin.lbUsed += n
}

export interface FinanceHistory {
  treasury: Float32Array
  crownDebt: Float32Array
  crownRevenue: Float32Array
  crownSpending: Float32Array
  creditRate: Uint8Array
  coinage: Uint8Array
  fiscalDistress: Uint8Array
  loans: Loans
  loanBalance: Float32Array
}

function loansOf(fin: FinanceState | null): Loans {
  const n = fin === null ? 0 : fin.lPol.length
  const L: Loans = {
    count: n, polity: new Int16Array(n), lenderKind: new Uint8Array(n), lender: new Int32Array(n), seat: new Int32Array(n), startYear: new Int16Array(n), endYear: new Int16Array(n),
    end: new Uint8Array(n), peak: new Float32Array(n), rate0: new Float32Array(n), rateMax: new Float32Array(n), paid: new Float32Array(n), lost: new Float32Array(n),
  }
  if (fin === null) return L
  for (let k = 0; k < n; k++) {
    L.polity[k] = fin.lPol[k]; L.lenderKind[k] = fin.lKind[k]; L.lender[k] = fin.lId[k]; L.seat[k] = fin.lSeat[k]; L.startYear[k] = fin.lStart[k]; L.endYear[k] = fin.lEnd[k]
    L.end[k] = fin.lCause[k]; L.peak[k] = fin.lPeak[k]; L.rate0[k] = fin.lRate0[k]; L.rateMax[k] = fin.lRateMax[k]; L.paid[k] = fin.lPaid[k]; L.lost[k] = fin.lLost[k]
  }
  return L
}

export function emptyFinanceHistory(): FinanceHistory {
  return { treasury: new Float32Array(0), crownDebt: new Float32Array(0), crownRevenue: new Float32Array(0), crownSpending: new Float32Array(0), creditRate: new Uint8Array(0), coinage: new Uint8Array(0), fiscalDistress: new Uint8Array(0), loans: loansOf(null), loanBalance: new Float32Array(0) }
}

/** The tables as of now (snapshotCount snapshots of P polities; tradeSnapshotCount trade snapshots). */
export function assembleFinance(fin: FinanceState, P: number, snapshotCount: number, tradeSnapshotCount: number): FinanceHistory {
  const f32 = (src: Float32Array) => { const a = new Float32Array(snapshotCount * P); for (let q = 0; q < snapshotCount && q < fin.snOff.length; q++) a.set(src.subarray(fin.snOff[q], fin.snOff[q] + fin.snN[q]), q * P); return a }
  const u8 = (src: Uint8Array) => { const a = new Uint8Array(snapshotCount * P); for (let q = 0; q < snapshotCount && q < fin.snOff.length; q++) a.set(src.subarray(fin.snOff[q], fin.snOff[q] + fin.snN[q]), q * P); return a }
  const loans = loansOf(fin)
  const K = loans.count
  const loanBalance = new Float32Array(tradeSnapshotCount * K)
  for (let q = 0; q < tradeSnapshotCount && q < fin.lbOff.length; q++) loanBalance.set(fin.lbSnap.subarray(fin.lbOff[q], fin.lbOff[q] + fin.lbN[q]), q * K)
  return { treasury: f32(fin.snTreas), crownDebt: f32(fin.snDebt), crownRevenue: f32(fin.snRev), crownSpending: f32(fin.snSpend), creditRate: u8(fin.snRate), coinage: u8(fin.snCoin), fiscalDistress: u8(fin.snSFD), loans, loanBalance }
}
