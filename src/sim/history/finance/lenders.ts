// finance: lenders (state-finances.md §0.2). A lender is (LenderKind, id): a town's merchant pool (goods on: the merchant capital
// MerchantState.mw of settlement id), or a town's own wealth when goods is off. Merchant families (LenderKind.Family) lend through
// families/api.ts only when they are on with FAMILY.feedback (familiesLend): they are then candidates beside the pools, and a
// pool lends only its free capital (what the families seated there do not hold), so nothing is lent twice. Without feedback
// the families only mirror the pools' losses (families/system.ts), and nothing here changes.
// Candidates for polity p, in a fixed order: domestic first (seats among p's members), then foreign seats whose people p's people
// have met, each by assets descending, ties by (kind, id). Pool candidates are the FIN.poolTop largest pools of the year.

import { LenderKind } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { inContact } from '../polity/state.ts'
import { FIN } from './params.ts'
import type { FinanceState } from './state.ts'
import { ensureFinSettlements } from './state.ts'
import { familiesLend, familyAbsorbDefault, familyAlive, familyCapitalAt, familyHome, familyLend, familyLendCapacity, familyOwed, familyRepaid, lendersFor } from '../families/api.ts' // families: (feedback only)

export interface LenderOffer { kind: number; id: number; seat: number; assets: number; foreign: 0 | 1 }

/** The pools that may lend this year: settlements with merchant capital >= poolMin, largest first (ties by id), at most poolTop. */
export function poolsOfYear(s: HistoryState, out: number[]): void {
  out.length = 0
  if (s.goods === null) return
  const mw = s.goods.ext.merch.mw
  const living = s.living
  for (let t = 0; t < living.length; t++) { const id = living[t]; if (id < mw.length && mw[id] >= POOL_MIN) out.push(id) }
  out.sort((a, b) => mw[b] - mw[a] || a - b)
  if (out.length > POOL_TOP) out.length = POOL_TOP
}
const POOL_MIN = 20
const POOL_TOP = 48

/** Assets of a lender: a pool's capital plus its crown exposure; a town's wealth. */
export function lenderAssets(s: HistoryState, fin: FinanceState, kind: number, id: number, p = -1): number {
  if (kind === LenderKind.Family) return familyLendCapacity(s, id, p) + familyOwed(s, id, p) // (families: what it holds in p's towns and has out to p)
  if (id >= fin.expo.length) ensureFinSettlements(fin, id + 1)
  if (kind === LenderKind.Pool) {
    const mw = s.goods !== null ? s.goods.ext.merch.mw : null
    let m = mw !== null && id < mw.length ? mw[id] : 0
    if (familiesLend(s)) { m -= familyCapitalAt(s, id); if (m < 0) m = 0 } // (families: the pool lends its free capital only)
    return m + fin.expo[id]
  }
  return s.wealth[id] + fin.expo[id]
}

/** Lender candidates for p in the fixed order (pools of the year, or towns when goods is off). */
export function lenderCandidates(s: HistoryState, ps: PolityState, fin: FinanceState, p: number, pools: readonly number[], out: LenderOffer[]): void {
  out.length = 0
  const people = ps.pPeople[p]
  if (s.goods !== null) {
    for (const id of pools) {
      if (s.abandoned[id] >= 0) continue
      const q = id < ps.seen ? ps.polity[id] : -1
      const dom = q === p
      if (!dom && !inContact(s, people, s.people[id])) continue
      out.push({ kind: LenderKind.Pool, id, seat: id, assets: lenderAssets(s, fin, LenderKind.Pool, id), foreign: dom ? 0 : 1 })
    }
  } else {
    const m0 = ps.memOff[p], m1 = p + 1 < ps.memOff.length ? ps.memOff[p + 1] : m0
    for (let k = m0; k < m1; k++) {
      const id = ps.memList[k]
      if (ps.polity[id] !== p || s.abandoned[id] >= 0 || s.wealth[id] < FIN.townMin) continue
      out.push({ kind: LenderKind.Town, id, seat: id, assets: lenderAssets(s, fin, LenderKind.Town, id), foreign: 0 })
    }
  }
  // families (feedback): the houses with capital in p's towns, beside the pools (their capital is p's, so domestic)
  if (familiesLend(s)) {
    const n = lendersFor(s, p, famBuf)
    for (let i = 0; i < n; i++) {
      const f = famBuf[i]
      out.push({ kind: LenderKind.Family, id: f, seat: familyHome(s, f), assets: lenderAssets(s, fin, LenderKind.Family, f, p), foreign: 0 })
    }
  }
  out.sort((a, b) => a.foreign - b.foreign || b.assets - a.assets || a.kind - b.kind || a.id - b.id)
}

const famBuf = new Int32Array(64)

/** What the lender may still lend: lendCap (Pool) or townCap (Town) of its assets, less its exposure; a family's own capacity. */
export function lenderRoom(s: HistoryState, fin: FinanceState, o: LenderOffer, p = -1): number {
  if (o.kind === LenderKind.Family) return familyLendCapacity(s, o.id, p)
  const cap = o.kind === LenderKind.Pool ? FIN.lendCap * o.assets - fin.expo[o.id] : FIN.townCap * s.wealth[o.id] - fin.expo[o.id]
  return cap > 0 ? cap : 0
}

/** The money leaves the lender (returns the amount actually lent). */
export function lenderGive(s: HistoryState, fin: FinanceState, kind: number, id: number, x: number, p = -1): number {
  if (!(x > 0)) return 0
  if (kind === LenderKind.Family) return familyLend(s, id, p, x)
  if (kind === LenderKind.Pool) {
    const mw = s.goods!.ext.merch.mw
    const y = x < mw[id] ? x : mw[id]
    mw[id] -= y
    fin.expo[id] += y
    return y
  }
  const y = x < s.wealth[id] ? x : s.wealth[id]
  s.wealth[id] -= y
  fin.expo[id] += y
  return y
}

/** Interest or principal back to the lender (principal also lowers its exposure). */
export function lenderTake(s: HistoryState, fin: FinanceState, kind: number, id: number, x: number, principal: boolean, p = -1): void {
  if (!(x > 0)) return
  if (kind === LenderKind.Family) { familyRepaid(s, id, x, p, principal); return }
  if (s.abandoned[id] >= 0) return
  if (kind === LenderKind.Pool && s.goods !== null && id < s.goods.ext.merch.mw.length) s.goods.ext.merch.mw[id] += x
  else s.wealth[id] += x
  if (principal) { const e = fin.expo[id] - x; fin.expo[id] = e > 0 ? e : 0 }
}

/** The lender writes off x (exposure falls; the money is gone): returns the loss as a share of its assets before. */
export function lenderLose(s: HistoryState, fin: FinanceState, kind: number, id: number, x: number, p = -1): number {
  if (kind === LenderKind.Family) { const a = lenderAssets(s, fin, kind, id, p); familyAbsorbDefault(s, id, p, x); return a > 0 ? x / a : 0 }
  const a = lenderAssets(s, fin, kind, id)
  const e = fin.expo[id] - x
  fin.expo[id] = e > 0 ? e : 0
  return a > 0 ? x / a : 0
}

/** The lender is still there to be repaid: a family that trades, a seat not abandoned. */
export function lenderAlive(s: HistoryState, kind: number, id: number, seat: number): boolean {
  if (kind === LenderKind.Family) return familyAlive(s, id)
  return s.abandoned[seat] < 0
}
