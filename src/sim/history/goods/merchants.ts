// goods: merchant capital (the merchant houses of the marts), kept apart from the town's wealth.
//
// A town's wealth (HistoryState.wealth) is income smoothed over decades, and a big town spends much of it on luxuries
// (habit.ts) and taxes; the profits of the long-haul trade, a small part of all income, vanish into it, so an entrepot was
// no richer than any hub and a bypassed relay town lost little. Here the merchants of a settlement keep their capital:
//
//  - Inflow: a share MERCHANT.keep of the merchant profit made at a settlement on the long-haul legs (relays and lanes:
//    the carrier's return and gap at the buying end, the seller's share of the gap; longhaul.ts) goes to its merchant
//    capital instead of the town's income; and both ends' houses gain MERCHANT.turnover of the worth of every cargo moved
//    on a leg (commission, credit, freight: the turnover of a house grows its capital, apart from what the town earns).
//  - Their stock in trade is theirs: the luxuries, stimulants and finery a mart's merchants send on along the legs are not
//    charged to the town as its purchases (habit.ts pays for what a town bought; merchantResaleNet).
//  - Every year the houses pay a share MERCHANT.pay of their capital into the town (wages, building, spending) and lose a
//    share MERCHANT.wear (bad debts, heirs, fires); beyond MERCHANT.maxHead a head they spend it (bounded). Houses gather
//    where the trade converges: a share MERCHANT.gather of a mart's capital a year moves to its open-leg partner with the
//    most relay income, when that has gatherRatio times its own.
//  - Ventures: a trade expedition from a mart is paid out of its merchants' capital first (routes.ts).
//  - Flight: once a mart is bypassed (routes.ts relayYear logs Bypassed: a lane took the goods it lived on) and while its
//    relay income stays below BYPASS.share of its peak, its merchants leave for the ends of the lane that took the trade,
//    MERCHANT.flee of their capital a year, half to each end (lost when an end is gone; MerchantsMoved is logged when they
//    begin to go), and with them MERCHANT.fleeTown of the town's wealth (empty houses and warehouses: lost) and fleePop of
//    its people (to the lane's ends) a year, times sqrt(peak relay income / the town's income), at most 1. A settlement
//    abandoned loses its capital.
//  - The town: merchant capital a head m raises its economy (HistoryState.econ, after the trade system's settle:
//    MERCHANT.econ * m / (m + MERCHANT.half)), so an entrepot grows; History.merchantWealth shows the capital (a town's
//    wealth a head is (wealth + merchantWealth) / population).
//
// Deterministic: no draws; settlements in id order (living list).

import { EventType } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { logEvent } from '../state.ts'
import { BYPASS } from './params.ts'
import { WEALTH } from '../params.ts'
import type { GoodsState } from './state.ts'

/** Merchant capital (see the header). */
export const MERCHANT = {
  /** Share of the long-haul merchant profit made at a settlement kept as merchant capital. */
  keep: 0.6,
  /** Share of the value of the cargo moved on a leg that each end's merchant houses gain (their turnover: commission, credit, freight). */
  turnover: 0.4,
  /** Share of the merchants' resale along the legs not charged to the town's purchases (merchantResaleNet). */
  resale: 1,
  /** Share of the capital paid into the town's income a year. */
  pay: 0.0003,
  /** Share of the capital lost a year. */
  wear: 0.0007,
  /** Share of a mart's capital moving a year to the busiest mart its legs reach (relay income at least `gatherRatio` times its own). */
  gather: 0.05,
  gatherRatio: 1.25,
  /** Share of a bypassed mart's capital leaving a year while its relay income stays low. */
  flee: 0.05,
  /** Shares of a bypassed mart's town wealth and people leaving with its merchants a year, times its dependence on the relay trade. */
  fleeTown: 0.05,
  fleePop: 0.006,
  /** Most merchant capital a head a settlement keeps (the rest is spent and lost). */
  maxHead: 120,
  /** Economy multiplier term from merchant capital per head m: econ * m / (m + half). */
  econ: 0.15,
  half: 20,
}

export interface MerchantState {
  cap: number
  /** Merchant capital per settlement. */
  mw: Float64Array
  /** Bypassed marts: the ends of the lane that took their trade (-1 none). */
  toA: Int32Array
  toB: Int32Array
  /** 1 once MerchantsMoved was logged for the settlement. */
  moved: Uint8Array
  /** Luxuries, stimulants and finery a mart's merchants sent on along the legs this year (their worth at its price). */
  resale: Float64Array
  /** Snapshots (with the population snapshots), ragged: snapshot q holds ids [0, snapN[q]) from snapOff[q]. */
  snap: Float32Array
  snapOff: number[]
  snapN: number[]
  used: number
}

export function createMerchants(cap: number): MerchantState {
  const n = cap > 16 ? cap : 16
  return { cap: n, mw: new Float64Array(n), toA: new Int32Array(n).fill(-1), toB: new Int32Array(n).fill(-1), moved: new Uint8Array(n), resale: new Float64Array(n), snap: new Float32Array(4096), snapOff: [], snapN: [], used: 0 }
}

function grow(m: MerchantState, count: number): void {
  if (count <= m.cap) return
  let n = m.cap
  while (n < count) n *= 2
  const mw = new Float64Array(n); mw.set(m.mw); m.mw = mw
  const a = new Int32Array(n).fill(-1); a.set(m.toA); m.toA = a
  const b = new Int32Array(n).fill(-1); b.set(m.toB); m.toB = b
  const v = new Uint8Array(n); v.set(m.moved); m.moved = v
  const r = new Float64Array(n); r.set(m.resale); m.resale = r
  m.cap = n
}

/** Long-haul merchant profit x made at settlement id: keeps its merchants' share, returns the part left to the town's income. */
export function merchantTake(g: GoodsState, id: number, x: number): number {
  if (!(x > 0)) return x
  const m = g.merch
  if (id >= m.cap) grow(m, id + 1)
  const k = MERCHANT.keep * x
  m.mw[id] += k
  return x - k
}

/** Cargo worth `value` moved on a leg from mart a to mart b: the turnover of both ends' merchant houses. */
export function merchantTurnover(g: GoodsState, a: number, b: number, value: number): void {
  if (!(value > 0)) return
  const m = g.merch
  const hi = a > b ? a : b
  if (hi >= m.cap) grow(m, hi + 1)
  const x = MERCHANT.turnover * value
  m.mw[a] += x
  m.mw[b] += x
}

/** Goods a town pays for (luxuries, stimulants, finery) worth `value` at mart a's price sent on along a leg by its merchants. */
export function merchantResale(g: GoodsState, a: number, value: number): void {
  if (!(value > 0)) return
  const m = g.merch
  if (a >= m.cap) grow(m, a + 1)
  m.resale[a] += value
}

/**
 * habit.ts, when settlement id pays for what it bought this year (`paid`, out of its wealth): the part its merchants sent on
 * along the legs is their stock in trade, not the town's purchase (their profit on it is net of its cost), so it is not
 * charged to the town. Returns what the town pays; the year's resale is cleared.
 */
export function merchantResaleNet(g: GoodsState, id: number, paid: number, share: number): number {
  const m = g.merch
  if (id >= m.cap) return paid
  const r = m.resale[id] * share * MERCHANT.resale
  m.resale[id] = 0
  return paid > r ? paid - r : 0
}

/** Capital the merchants of id can put into a venture. */
export function merchantFunds(g: GoodsState, id: number): number {
  const m = g.merch
  return id < m.cap ? m.mw[id] : 0
}

/** Pays `cost` for a venture of id: its merchants' capital first, then the town's wealth. */
export function merchantPay(s: HistoryState, g: GoodsState, id: number, cost: number): void {
  const m = g.merch
  const have = id < m.cap ? m.mw[id] : 0
  if (have >= cost) { m.mw[id] = have - cost; return }
  if (have > 0) m.mw[id] = 0
  s.wealth[id] -= cost - have
}

/** A mart bypassed by lane k (routes.ts relayYear): its merchants will follow the trade to the lane's ends. */
export function merchantsBypassed(g: GoodsState, id: number, k: number): void {
  const m = g.merch
  if (id >= m.cap) grow(m, id + 1)
  m.toA[id] = g.legA[k] !== id ? g.legA[k] : -1
  m.toB[id] = g.legB[k] !== id ? g.legB[k] : -1
}

/** Yearly (goods system, after relay income): pay, wear, flight of bypassed marts' merchants, capital of the abandoned. */
export function merchantYear(s: HistoryState, g: GoodsState): void {
  const m = g.merch
  grow(m, s.count)
  const mw = m.mw
  const X = MERCHANT
  const keep = 1 - X.pay - X.wear
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const c = mw[id]
    if (!(c > 0)) continue
    s.wealth[id] += X.pay * c
    let left = c * keep
    // Flight: a bypassed mart whose relay income stays low.
    const a = m.toA[id], b = m.toB[id]
    if ((a >= 0 || b >= 0) && id < g.cap && g.relaySm[id] < BYPASS.share * g.relayPeak[id]) {
      const out = X.flee * left
      left -= out
      const okA = a >= 0 && s.abandoned[a] < 0, okB = b >= 0 && s.abandoned[b] < 0
      if (okA) mw[a] += okB ? 0.5 * out : out
      if (okB) mw[b] += okA ? 0.5 * out : out
      // With them go part of the town's wealth (their houses and warehouses stand empty: lost) and its people (their
      // households and hands, to the lane's ends), with how much the town lived on the relay trade: the square root of its peak relay income against its income.
      const inc = WEALTH.decay * s.wealth[id]
      const pk = g.relayPeak[id]
      const dep = pk > 0 ? (pk >= inc ? 1 : Math.sqrt(pk / inc)) : 0 // (sqrt: a town half living on it loses most of what it would)
      const wOut = X.fleeTown * dep * s.wealth[id]
      const pOut = Math.floor(X.fleePop * dep * s.pop[id])
      if (wOut > 0) s.wealth[id] -= wOut // (houses and warehouses left empty: lost)
      if (pOut >= 1 && (okA || okB) && s.pop[id] - pOut >= 1) {
        s.pop[id] -= pOut
        const hA = okA && okB ? Math.floor(0.5 * pOut) : okA ? pOut : 0
        if (hA > 0) s.pop[a] += hA
        if (pOut - hA > 0) s.pop[b] += pOut - hA
      }
      if (!m.moved[id]) { m.moved[id] = 1; logEvent(s, EventType.MerchantsMoved, id, okA ? a : okB ? b : -1, c) }
    }
    mw[id] = left
  }
  // Gathering: merchant houses move to the entrepot their legs lead to (the open leg partner with the most relay income).
  if (X.gather > 0) {
    const best = BEST.length >= s.count ? BEST : (BEST = new Int32Array(2 * s.count))
    best.fill(-1, 0, s.count)
    const rs = g.relaySm
    for (let k = 0; k < g.legCount; k++) {
      if (!g.legOpen[k]) continue
      const a = g.legA[k], b = g.legB[k]
      if (a >= g.cap || b >= g.cap) continue
      if (best[a] < 0 || rs[b] > rs[best[a]]) best[a] = b
      if (best[b] < 0 || rs[a] > rs[best[b]]) best[b] = a
    }
    for (let t = 0; t < living.length; t++) {
      const id = living[t]
      const y = best[id]
      if (y < 0 || id >= g.cap || !(mw[id] > 0) || s.abandoned[y] >= 0 || !(rs[y] > X.gatherRatio * rs[id])) continue
      const out = X.gather * mw[id]
      mw[id] -= out
      mw[y] += out
    }
  }
  // (bounded: beyond maxHead a head the houses spend it, palaces and loans never repaid; the abandoned lose it)
  for (let id = 0; id < s.count; id++) {
    if (!(mw[id] > 0)) continue
    if (s.abandoned[id] >= 0) { mw[id] = 0; continue }
    const top = X.maxHead * s.pop[id]
    if (mw[id] > top) mw[id] = top
  }
}

let BEST = new Int32Array(0)

/** After the trade system's settle (trade.ts): merchant capital a head raises the town's economy. */
export function merchantEcon(s: HistoryState, g: GoodsState): void {
  const m = g.merch
  const mw = m.mw
  const X = MERCHANT
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    if (id >= m.cap) continue
    const c = mw[id]
    const p = s.pop[id]
    if (!(c > 0) || !(p > 0)) continue
    const pc = c / p
    s.econ[id] += (X.econ * pc) / (pc + X.half)
  }
}

/** Snapshot (with the population snapshots). */
export function merchantSnapshot(s: HistoryState, g: GoodsState): void {
  const m = g.merch
  const n = s.count
  if (m.snap.length < m.used + n) { let k = m.snap.length; while (k < m.used + n) k *= 2; const b = new Float32Array(k); b.set(m.snap); m.snap = b }
  for (let id = 0; id < n; id++) m.snap[m.used + id] = id < m.cap && s.abandoned[id] < 0 ? m.mw[id] : 0
  m.snapOff.push(m.used)
  m.snapN.push(n)
  m.used += n
}

/** History.merchantWealth: snapshots 0..Q-1 padded to S settlements (same layout as History.wealth). */
export function assembleMerchants(g: GoodsState, Q: number, S: number): Float32Array {
  const m = g.merch
  const out = new Float32Array(Q * S)
  for (let q = 0; q < Q; q++) out.set(m.snap.subarray(m.snapOff[q], m.snapOff[q] + m.snapN[q]), q * S)
  return out
}
