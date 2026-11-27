// finance: crown treasuries and loans (state-finances.md): tables, invariants, events, the shadow ledger and finSFD.
//
// With HistoryOptions.finance false (the default) the tree was checked identical to main on every 8cabf09 History field
// (G0, scripts/g0.ts on seeds 1, 42, 1234 at 2000 years); with FIN.divert false (shadow mode) finance on equals off.

import { describe, expect, it } from 'vitest'
import { EventType, LoanEnd } from '../../../contract.ts'
import type { History, HistoryOptions } from '../../../contract.ts'
import { generateWorld, simulateHistory } from '../../index.ts'
import { hashBase } from '../../../hashBase.ts'
import { logStreams } from '../../rng.ts'
import { FIN } from './params.ts'
import { finSFD } from './hooks.ts'
import { createFinance } from './state.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'

const worlds = new Map<number, ReturnType<typeof generateWorld>>()
const world = (seed: number) => { let w = worlds.get(seed); if (!w) { w = generateWorld(seed); worlds.set(seed, w) } return w }
const runs = new Map<string, History>()
function run(seed: number, o: HistoryOptions): History {
  const k = seed + JSON.stringify(o)
  let h = runs.get(k)
  if (!h) { h = simulateHistory(world(seed), o); runs.set(k, h) }
  return h
}

function checkFinance(h: History): void {
  const P = h.polities.length, Q = h.snapshotCount
  for (const a of [h.treasury, h.crownDebt, h.crownRevenue, h.crownSpending, h.creditRate, h.coinage, h.fiscalDistress]) expect(a.length).toBe(Q * P)
  const L = h.loans
  for (const a of [L.polity, L.lenderKind, L.lender, L.seat, L.startYear, L.endYear, L.end, L.peak, L.rate0, L.rateMax, L.paid, L.lost]) expect(a.length).toBe(L.count)
  expect(h.loanBalance.length).toBe(h.tradeSnapshotCount * L.count)
  for (let k = 0; k < L.count; k++) {
    expect(L.end[k] === LoanEnd.Ongoing).toBe(L.endYear[k] === -1)
    if (L.endYear[k] >= 0) expect(L.endYear[k]).toBeGreaterThanOrEqual(L.startYear[k])
    expect(L.rate0[k]).toBeGreaterThanOrEqual(FIN.rMin - 1e-6)
    expect(L.rateMax[k]).toBeGreaterThanOrEqual(L.rate0[k] - 1e-6)
    expect(L.peak[k]).toBeGreaterThanOrEqual(0)
  }
  const ev = h.events
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]
    if (e.type === EventType.LoanTaken) { expect(e.value).toBeLessThan(L.count); expect(L.startYear[e.value]).toBe(e.year) }
    if (e.type === EventType.CrownDefault) { expect(e.extra!).toBeGreaterThan(0); expect(e.extra!).toBeLessThanOrEqual(1) }
    if (e.type === EventType.WarBankrupt) {
      // its PeaceMade follows the same year, for the same war
      expect(ev.slice(i + 1).some((f) => f.type === EventType.PeaceMade && f.value === e.value && f.year === e.year)).toBe(true)
      expect(e.extra!).toBeGreaterThanOrEqual(1)
    }
  }
  for (let i = 0; i < h.fiscalDistress.length; i++) expect(Number.isFinite(h.fiscalDistress[i])).toBe(true)
}

describe('finance', () => {
  it('off: empty tables, no events, no stream', () => {
    const h = run(42, { years: 600 })
    expect(h.treasury.length + h.loans.count + h.loanBalance.length).toBe(0)
    expect(h.events.some((e) => e.type >= 210 && e.type <= 219)).toBe(false)
    const log: string[] = []
    logStreams(log)
    try { simulateHistory(world(1), { years: 200, finance: true }) } finally { logStreams(null) }
    expect(log.filter((x) => x === 'history-finance').length).toBe(1)
  }, 300_000)

  it('shadow mode (FIN.divert false) books the ledger and changes nothing else', () => {
    FIN.divert = false
    try {
      const on = simulateHistory(world(42), { years: 1200, finance: true }), off = run(42, { years: 1200 })
      expect(hashBase(on)).toBe(hashBase(off))
      expect(on.crownRevenue.some((x) => x > 0)).toBe(true)
    } finally { FIN.divert = true }
  }, 300_000)

  it('on: tables in shape, loans valid, bankruptcies end their wars', () => {
    let loans = 0, bankrupt = 0
    for (const seed of [42, 1]) {
      const h = run(seed, { years: 2000, finance: true })
      checkFinance(h)
      loans += h.loans.count
      bankrupt += h.events.filter((e) => e.type === EventType.WarBankrupt).length
    }
    expect(loans).toBeGreaterThan(0)
    expect(bankrupt).toBeGreaterThan(0)
    checkFinance(run(42, { years: 2000, finance: true, oaths: true, balance: true, arms: true }))
  }, 900_000)

  it('a longer run repeats a shorter one', () => {
    const a = simulateHistory(world(3), { years: 1200, finance: true }), b = simulateHistory(world(3), { years: 1500, finance: true })
    const P = a.polities.length, Q = a.snapshotCount, PB = b.polities.length
    for (let q = 0; q < Q; q++) for (let p = 0; p < P; p++) expect(b.treasury[q * PB + p]).toBe(a.treasury[q * P + p])
    for (let k = 0; k < a.loans.count; k++) { expect(b.loans.polity[k]).toBe(a.loans.polity[k]); expect(b.loans.startYear[k]).toBe(a.loans.startYear[k]) }
  }, 600_000)

  it('finSFD: an ordinary realm 1, a full reserve 0.7, debt and arrears above 2', () => {
    const fin = createFinance(1, 16)
    const s = { year: 1000, fin, rul: null } as unknown as HistoryState
    const ps = { pExh: new Float64Array(4), pCrisisUntil: new Int32Array(4) } as unknown as PolityState
    fin.revOrd[0] = 100
    expect(Math.abs(finSFD(s, ps, 0) - 1)).toBeLessThan(1e-12)
    fin.treas[0] = FIN.reserveCap * 100
    expect(Math.abs(finSFD(s, ps, 0) - (1 - FIN.sfdReserve))).toBeLessThan(1e-12)
    fin.treas[0] = 0; fin.debt[0] = 400; fin.unpaid[0] = 2
    const x = finSFD(s, ps, 0)
    expect(x).toBeGreaterThanOrEqual(2.4)
    expect(x).toBeLessThanOrEqual(3.2)
    fin.revOrd[0] = 0
    expect(finSFD(s, ps, 0)).toBe(1)
  })
})
