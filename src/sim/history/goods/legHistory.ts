// goods: the history of the long-haul legs as History.longHaul shows them (prefix-stable leg records).
//
// The simulation keeps one leg per mart pair (relay) or per lane, and a relay leg is found again at every mart rebuild:
// its path is then replaced by the way its merchants take now (settlements come and go along it), and a closed relay leg
// found again reopens. History.longHaul must not depend on the run's length (a 2500-year history repeats the 2000-year
// one up to 2000), so it does not show the simulation's legs as they are at the end of the run: it shows their records,
// one per spell of a leg on one way. A record begins when a leg opens, reopens or changes its way, and ends (closedYear)
// when the leg closes or changes its way again (the next record begins the same year). Lanes never change their way,
// so a lane is one record all its life. Records are numbered in order of beginning; events, posts and chart secrets
// name the record of their lane (a lane's record is fixed when it opens).
//
// Bookkeeping only: nothing here is read by the simulation, which runs exactly as without it.

import { GOOD_COUNT, PRICE_INDEX_GOODS } from '../../../contract.ts'
import type { LongHaul } from '../../../contract.ts'
import { CLASS } from './params.ts'
import type { GoodsState } from './state.ts'

const G = GOOD_COUNT

/** The leg records (see the header). */
export interface LegHistory {
  count: number
  /** Simulation leg of each record. */
  leg: number[]
  opened: number[]
  /** -1 while it lasts. */
  closed: number[]
  /** The record's path (the leg's path array of its spell; never modified afterwards). */
  path: number[][]
  /** Per record: the leg's cumulative goods (legGood) when it began, and (once ended) the main classes of its spell. */
  good0: Float64Array
  goodAB: number[]
  goodBA: number[]
  /** Current record of each simulation leg (-1 none yet). */
  cur: number[]
}

export function createLegHistory(): LegHistory {
  return { count: 0, leg: [], opened: [], closed: [], path: [], good0: new Float64Array(64 * G * 2), goodAB: [], goodBA: [], cur: [] }
}

/** Main class carried each way by leg k since its cumulative goods were `base` (at offset bo), as [ab, ba] (7: Luxury when none). */
function mainClasses(g: GoodsState, k: number, base: Float64Array, bo: number): [number, number] {
  const lg = g.legGood
  const amt = (c: number, dir: number): number => lg[(k * G + c) * 2 + dir] - base[bo + c * 2 + dir]
  let ab = 7, ba = 7
  for (const c of PRICE_INDEX_GOODS) {
    if (amt(c, 0) * CLASS.worth[c] > amt(ab, 0) * CLASS.worth[ab]) ab = c
    if (amt(c, 1) * CLASS.worth[c] > amt(ba, 1) * CLASS.worth[ba]) ba = c
  }
  if (!(amt(ab, 0) > 0)) ab = ba
  if (!(amt(ba, 1) > 0)) ba = ab
  return [ab, ba]
}

/** Ends the current record of leg k (if it lasts) this year. */
export function legRecordEnd(g: GoodsState, k: number, year: number): void {
  const h = g.ext.legHist
  const r = k < h.cur.length ? h.cur[k] : -1
  if (r < 0 || h.closed[r] >= 0) return
  h.closed[r] = year
  const [ab, ba] = mainClasses(g, k, h.good0, r * G * 2)
  h.goodAB[r] = ab
  h.goodBA[r] = ba
}

/**
 * Leg k opened, reopened or was found again this year along `path` (its path now): begins a record unless its current
 * record lasts on the same way.
 */
export function legRecordOpen(g: GoodsState, k: number, path: number[], year: number): void {
  const h = g.ext.legHist
  while (h.cur.length <= k) h.cur.push(-1)
  const r0 = h.cur[k]
  if (r0 >= 0 && h.closed[r0] < 0) {
    const p = h.path[r0]
    if (p === path) return
    let same = p.length === path.length
    for (let i = 0; same && i < p.length; i++) if (p[i] !== path[i]) same = false
    if (same) return
    legRecordEnd(g, k, year)
  }
  const r = h.count++
  if (h.good0.length < h.count * G * 2) { const b = new Float64Array(2 * h.good0.length); b.set(h.good0); h.good0 = b }
  for (let i = 0; i < G * 2; i++) h.good0[r * G * 2 + i] = g.legGood[k * G * 2 + i]
  h.leg.push(k)
  h.opened.push(year)
  h.closed.push(-1)
  h.path.push(path)
  h.goodAB.push(7)
  h.goodBA.push(7)
  h.cur[k] = r
}

/** The record History shows for simulation leg k now (a lane's record never changes), -1 if none. */
export function legRecord(g: GoodsState, k: number): number {
  const h = g.ext.legHist
  return k >= 0 && k < h.cur.length ? h.cur[k] : -1
}

/** Volume of each record this year (the leg's while the record lasts and the leg is open, else 0), written at `out[o..]`. */
export function legRecordVolumes(g: GoodsState, out: Float32Array, o: number): void {
  const h = g.ext.legHist
  for (let r = 0; r < h.count; r++) {
    const k = h.leg[r]
    out[o + r] = h.closed[r] < 0 && g.legOpen[k] ? g.legVol[k] : 0
  }
}

/** History.longHaul from the records (paths, a, b, kind and chart from their legs). */
export function assembleLegRecords(g: GoodsState): LongHaul {
  const h = g.ext.legHist
  const L = h.count
  let total = 0
  for (let r = 0; r < L; r++) total += h.path[r].length
  const lh: LongHaul = {
    count: L, a: new Int32Array(L), b: new Int32Array(L), kind: new Uint8Array(L), openedYear: new Int16Array(L),
    closedYear: new Int16Array(L), chart: new Int16Array(L), goodAB: new Uint8Array(L), goodBA: new Uint8Array(L), pathOffsets: new Uint32Array(L + 1), path: new Uint32Array(total),
  }
  let off = 0
  for (let r = 0; r < L; r++) {
    const k = h.leg[r]
    lh.a[r] = g.legA[k]; lh.b[r] = g.legB[k]; lh.kind[r] = g.legKind[k]
    lh.openedYear[r] = h.opened[r]; lh.closedYear[r] = h.closed[r]
    lh.chart[r] = g.legChart[k]
    // (a record that ended: its spell's main classes; one that lasts: those carried since it began, up to now)
    if (h.closed[r] >= 0) { lh.goodAB[r] = h.goodAB[r]; lh.goodBA[r] = h.goodBA[r] } else { const [ab, ba] = mainClasses(g, k, h.good0, r * G * 2); lh.goodAB[r] = ab; lh.goodBA[r] = ba }
    lh.pathOffsets[r] = off
    const p = h.path[r]
    for (let i = 0; i < p.length; i++) lh.path[off + i] = p[i]
    off += p.length
  }
  lh.pathOffsets[L] = off
  return lh
}
