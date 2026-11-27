// families: the interface for the sibling plans (merchant-families.md §8; MASTER-PLAN §1.4 "merchant capital shares").
//
// city-states (§8.2): the families at a town and their weight there, in the sim (familiesAt, topFamilies, familyCapitalAt,
//   familyInfluence, topFamilyAt); History.families.seatSnap* and ui/familiesData.ts councilAt give the same per snapshot.
// state-finances (§8.1, finances §0.2): finance owns the loan table; families give capacity and take the money's moves
//   (familyLendCapacity, lendersFor, familyLend, familyRepaid, familyAbsorbDefault, familyForgive). Lending moves money out of
//   the town pools, so it is feedback: only with FAMILY.feedback (familiesLend), otherwise finance lends from the pools
//   (LenderKind.Pool) and families only mirror the pools' losses (system.ts mirrorFinance).
// All are pure reads (O(seats)) except the lending calls; every one is neutral (0, -1, nothing) when families are off.

import { FamilySeatKind } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { FIN } from '../finance/params.ts'
import { FAMILY } from './params.ts'
import type { FamilyState } from './state.ts'
import { ensureFamTowns } from './state.ts'

function famOf(s: HistoryState): FamilyState | null {
  return s.goods !== null ? s.goods.ext.fam : null
}

function mwAt(s: HistoryState, t: number): number {
  const mw = s.goods!.ext.merch.mw
  return t >= 0 && t < mw.length ? mw[t] : 0
}

function polOf(s: HistoryState, t: number): number {
  const ps = s.pol
  return ps !== null && t >= 0 && t < ps.seen ? ps.polity[t] : -1
}

/** True when family f trades now. */
export function familyAlive(s: HistoryState, f: number): boolean {
  const F = famOf(s)
  return F !== null && f >= 0 && f < F.fEnded.length && F.fEnded[f] < 0
}

/** Home town of family f now (-1 when off or ended). */
export function familyHome(s: HistoryState, f: number): number {
  return familyAlive(s, f) ? famOf(s)!.fHome[f] : -1
}

// --- city-states: who holds the capital of a town ---------------------------------------------------------------------

/** Open seats at `town` sorted by capital (desc; ties by family id) into `out`; returns the count (0 when off). */
export function familiesAt(s: HistoryState, town: number, out: number[]): number {
  out.length = 0
  const F = famOf(s)
  if (F === null) return 0
  const list = F.atTown[town]
  if (list === undefined) return 0
  for (const k of list) out.push(k)
  out.sort((a, b) => F.sSig[b] - F.sSig[a] || F.sFam[a] - F.sFam[b])
  return out.length
}

/** Family of seat k. */
export function seatFamily(s: HistoryState, k: number): number {
  const F = famOf(s)
  return F !== null && k >= 0 && k < F.sFam.length ? F.sFam[k] : -1
}

/** Capital the families hold at `town` (sum of their seats; never more than FAMILY.kappa of the town's merchant capital). */
export function familyCapitalAt(s: HistoryState, town: number): number {
  const F = famOf(s)
  if (F === null) return 0
  const list = F.atTown[town]
  if (list === undefined) return 0
  let x = 0
  for (const k of list) x += F.sSig[k]
  return x * mwAt(s, town)
}

/** Capital family f holds at `town` (0 without a seat there). */
export function familyWealthAt(s: HistoryState, f: number, town: number): number {
  const F = famOf(s)
  if (F === null || f < 0 || f >= F.fSeats.length) return 0
  for (const k of F.fSeats[f]) if (F.sTown[k] === town) return F.sSig[k] * mwAt(s, town)
  return 0
}

/** Weight of family f in `town`: its seat's capital against the town's wealth and merchant capital, in [0, 1). */
export function familyInfluence(s: HistoryState, f: number, town: number): number {
  const c = familyWealthAt(s, f, town)
  if (!(c > 0)) return 0
  return c / (s.wealth[town] + mwAt(s, town) + 1)
}

/** The k richest families seated at `town` (family ids, desc by seat capital; ties by id) into `out`: a council. Returns the count. */
export function topFamilies(s: HistoryState, town: number, k: number, out: number[]): number {
  const seats: number[] = []
  const n = familiesAt(s, town, seats)
  out.length = 0
  const F = famOf(s)
  for (let i = 0; i < n && out.length < k; i++) out.push(F!.sFam[seats[i]])
  return out.length
}

/** The richest family seated at `town`, -1. */
export function topFamilyAt(s: HistoryState, town: number): number {
  const out: number[] = []
  return topFamilies(s, town, 1, out) > 0 ? out[0] : -1
}

/** Capital family f holds in polity p's towns now. */
export function familyCapitalIn(s: HistoryState, f: number, p: number): number {
  const F = famOf(s)
  if (F === null || f < 0 || f >= F.fSeats.length) return 0
  let x = 0
  for (const k of F.fSeats[f]) if (polOf(s, F.sTown[k]) === p) x += F.sSig[k] * mwAt(s, F.sTown[k])
  return x
}

// --- state-finances: families as lenders (feedback) --------------------------------------------------------------------

/** True when families lend to crowns themselves (families on and FAMILY.feedback). */
export function familiesLend(s: HistoryState): boolean {
  return FAMILY.feedback && famOf(s) !== null
}

/** What f has out to p now (principal lent through finance, less repaid or written off). */
export function familyOwed(s: HistoryState, f: number, p: number): number {
  const F = famOf(s)
  if (F === null) return 0
  return F.outTo.get(f * 65536 + p) ?? 0
}

/** Capital family f can lend to polity p now: FIN.lendCap (families' lendShare) of its capital in p's towns and what it has out to p, less that. 0 when off or without feedback. */
export function familyLendCapacity(s: HistoryState, f: number, p: number): number {
  if (!familiesLend(s) || !familyAlive(s, f)) return 0
  const held = familyCapitalIn(s, f, p)
  const out = familyOwed(s, f, p)
  const x = FIN.lendCap * (held + out) - out
  return x > 0 ? x : 0
}

/** Families able to lend to p, by capacity (desc; ties by id), into `out` (at most out.length); returns the count. */
export function lendersFor(s: HistoryState, p: number, out: Int32Array): number {
  const F = famOf(s)
  if (F === null || !familiesLend(s)) return 0
  const c: { f: number; x: number }[] = []
  for (const f of F.alive) { const x = familyLendCapacity(s, f, p); if (x > 0) c.push({ f, x }) }
  c.sort((a, b) => b.x - a.x || a.f - b.f)
  const n = c.length < out.length ? c.length : out.length
  for (let i = 0; i < n; i++) out[i] = c[i].f
  return n
}

/** f lends `amount` to p: its seats in p's towns give it pro rata (their towns' merchant capital falls). Returns the amount lent. */
export function familyLend(s: HistoryState, f: number, p: number, amount: number): number {
  const F = famOf(s)
  if (F === null || !(amount > 0)) return 0
  const cap = familyLendCapacity(s, f, p)
  const x = amount < cap ? amount : cap
  if (!(x > 0)) return 0
  const held = familyCapitalIn(s, f, p)
  if (!(held > 0)) return 0
  const mw = s.goods!.ext.merch.mw
  ensureFamTowns(F, s.count)
  let lent = 0
  for (const k of F.fSeats[f]) {
    const t = F.sTown[k]
    if (polOf(s, t) !== p) continue
    const c = F.sSig[k] * mw[t]
    let y = (x * c) / held
    if (y > c) y = c
    if (!(y > 0)) continue
    moveSeat(F, k, mw, t, -y)
    lent += y
  }
  F.outTo.set(f * 65536 + p, familyOwed(s, f, p) + lent)
  F.fLent[f] += lent
  return lent
}

/** Money comes back to f (interest, or principal when `principal`, owed by p): credited to its home seat's town pool and share. */
export function familyRepaid(s: HistoryState, f: number, amount: number, p = -1, principal = false): void {
  const F = famOf(s)
  if (F === null || !(amount > 0)) return
  if (principal && p >= 0) forgive(F, f, p, amount)
  if (!familyAlive(s, f)) return
  const k = F.fHomeSeat[f]
  const t = F.sTown[k]
  if (s.abandoned[t] >= 0) return
  const mw = s.goods!.ext.merch.mw
  ensureFamTowns(F, s.count)
  moveSeat(F, k, mw, t, amount)
}

/** p defaults on `amount` owed to f: written off (the money already left the pools); the ruin check (cause Default, other = p's capital) follows at the families' pass. */
export function familyAbsorbDefault(s: HistoryState, f: number, p: number, amount: number): void {
  const F = famOf(s)
  if (F === null || !(amount > 0)) return
  forgive(F, f, p, amount)
  const ps = s.pol
  F.pendingRuin.push(f, ps !== null && p >= 0 && p < ps.P ? ps.pCapital[p] : -1)
}

/** p's debt `amount` to f is cancelled for something else (a town's charter): no money moves. */
export function familyForgive(s: HistoryState, f: number, p: number, amount: number): void {
  const F = famOf(s)
  if (F === null || !(amount > 0)) return
  forgive(F, f, p, amount)
}

/** p's debt `amount` to f passes to polity q (p was absorbed or reunified: finance's LoanEnd.Assumed). */
export function familyAssumed(s: HistoryState, f: number, p: number, q: number, amount: number): void {
  const F = famOf(s)
  if (F === null || !(amount > 0)) return
  forgive(F, f, p, amount)
  F.outTo.set(f * 65536 + q, (F.outTo.get(f * 65536 + q) ?? 0) + amount)
  F.fLent[f] += amount
}

function forgive(F: FamilyState, f: number, p: number, x: number): void {
  const key = f * 65536 + p
  const o = (F.outTo.get(key) ?? 0) - x
  if (o > 1e-9) F.outTo.set(key, o)
  else F.outTo.delete(key)
  F.fLent[f] = F.fLent[f] - x > 0 ? F.fLent[f] - x : 0
}

/** Seat k's capital changes by dx and its town's pool with it (the shares are settled at the families' pass: system.ts accounting books it as the seat's own move, not the pool's). */
function moveSeat(F: FamilyState, k: number, mw: Float64Array, t: number, dx: number): void {
  let nm = mw[t] + dx
  if (nm < 0) { dx = -mw[t]; nm = 0 }
  mw[t] = nm
  if (F.tmark[t] === 0) { F.tmark[t] = 1; F.touched.push(t) }
  F.lendY[t] -= dx
  F.seatLendY.set(k, (F.seatLendY.get(k) ?? 0) - dx)
}

/** Diagnostic: families seated at `town` whose seat there is their home. */
export function homesAtTown(s: HistoryState, town: number): number {
  const F = famOf(s)
  if (F === null) return 0
  const list = F.atTown[town]
  let n = 0
  if (list !== undefined) for (const k of list) if (F.sKind[k] === FamilySeatKind.Home) n++
  return n
}
