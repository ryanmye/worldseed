// tourism: tests of scenery, sights, leisure travel and resort towns (src/sim/history/tourism).

import { describe, expect, it } from 'vitest'
import { EventType, SightKind } from '../../../contract.ts'
import type { History, World } from '../../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../../index.ts'
import { runHistory } from '../index.ts'
import type { HistoryState } from '../state.ts'
import { RESORT, SIGHT } from './params.ts'

const TOURISM_KEYS = new Set(['scenery', 'sceneryKind', 'sights', 'visitorFlows'])

function fnvBytes(h: number, b: Uint8Array): number {
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) }
  return h
}
const enc = new TextEncoder()
/** Hash of any value: typed arrays by bytes, arrays and objects key by key (sorted), numbers as float64. */
function hv(h: number, v: unknown): number {
  if (v === null || v === undefined) return fnvBytes(h, enc.encode(String(v)))
  if (ArrayBuffer.isView(v)) { h = fnvBytes(h, enc.encode(v.constructor.name)); return fnvBytes(h, new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) }
  if (typeof v === 'number') return fnvBytes(h, new Uint8Array(new Float64Array([v]).buffer))
  if (typeof v === 'string' || typeof v === 'boolean') return fnvBytes(h, enc.encode(typeof v + String(v)))
  if (Array.isArray(v)) { h = fnvBytes(h, enc.encode('[' + v.length)); for (const x of v) h = hv(h, x); return h }
  if (typeof v === 'object') { for (const k of Object.keys(v as object).sort()) { h = fnvBytes(h, enc.encode(k)); h = hv(h, (v as Record<string, unknown>)[k]) } return h }
  return h
}
/** Hash of every History field that exists without the tourism system (every key; settlements without `resort`, events without the tourism events). */
export function hashPreTourism(hi: History): string {
  const r = hi as unknown as Record<string, unknown>
  let h = 0x811c9dc5
  for (const k of Object.keys(r).filter((x) => !TOURISM_KEYS.has(x) && x !== 'renamings').sort()) { // (renaming: later than tourism)
    h = fnvBytes(h, enc.encode(k))
    if (k === 'settlements') h = hv(h, hi.settlements.map((s) => { const o: Record<string, unknown> = { ...s }; delete o.resort; return o }))
    else if (k === 'events') h = hv(h, hi.events.filter((e) => e.type < 100 || e.type > 109))
    else h = hv(h, r[k])
  }
  return (h >>> 0).toString(16)
}
/** Hash of the tourism fields and the resort flags. */
function hashTourism(hi: History): string {
  const r = hi as unknown as Record<string, unknown>
  let h = 0x811c9dc5
  for (const k of [...TOURISM_KEYS].sort()) h = hv(h, r[k])
  h = hv(h, hi.settlements.map((s) => s.resort))
  h = hv(h, hi.events.filter((e) => e.type >= 100 && e.type <= 109))
  return (h >>> 0).toString(16)
}

/**
 * Histories without the tourism system: hashPreTourism of simulateHistory with tourism off equals the history without it
 * (every key of History): first the commit before it (fca7cc7); since the merge with rulers, religion and the disease retune,
 * the tip of that merge, verified by hashing every field against it and recorded here. A later change outside the tourism
 * system must regenerate these.
 */
// (Re-recorded with the far ventures, port gateways and danger siting: tourism-off runs checked on every field against f960f11
// plus this branch's diff; goods-off and polities-off runs against this tree with goods/ or polity/ and migration.ts as before.)
const GOLDEN: [number, number, number | undefined, Record<string, boolean>, string][] = [
  [42, 2000, undefined, {}, 'b4430c0e'],
  [3, 600, undefined, {}, 'a24e63e4'],
  [7, 900, undefined, { polities: false, goods: false }, '8d539b84'],
  [1, 1500, undefined, { disease: false }, 'ab783aee'],
  [9, 800, 24, {}, 'ed63cae2'],
]

const worlds = new Map<number, World>()
function world(seed: number): World {
  let w = worlds.get(seed)
  if (!w) { w = generateWorld(seed); worlds.set(seed, w) }
  return w
}
const histories = new Map<string, History>()
function history(seed: number, years = 2000): History {
  const key = seed + ':' + years
  let h = histories.get(key)
  if (!h) { h = simulateHistory(world(seed), { years }); histories.set(key, h) }
  return h
}

const aliveAt = (h: History, id: number, y: number): boolean => h.settlements[id].foundedYear <= y && (h.settlements[id].abandonedYear < 0 || h.settlements[id].abandonedYear > y)

/** Structural invariants of the tourism fields. */
function checkTourism(w: World, h: History): void {
  const N = w.grid.cellCount, S = h.settlements.length, P = h.peoples.length
  const F = h.visitorFlows
  // Scenery: static, in range, 0 at sea and on lakes, rank-based (about a tenth of the land at 186 or more).
  expect(h.scenery.length).toBe(N)
  expect(h.sceneryKind.length).toBe(N)
  let land = 0, top = 0
  for (let c = 0; c < N; c++) {
    if (w.elevation[c] < 0 || w.lake[c]) { if (h.scenery[c] !== 0 || h.sceneryKind[c] !== 0) throw new Error(`scenery at sea ${c}`); continue }
    land++
    if (h.scenery[c] >= 186) top++
  }
  expect(top / land).toBeGreaterThan(0.08)
  expect(top / land).toBeLessThan(0.12)
  for (const a of [h.scenery, h.sceneryKind, F.from, F.to, F.firstYear, F.pathOffsets, F.path, F.rowSnapshot, F.rowPair, F.visitors, F.spend]) {
    expect(a.byteOffset).toBe(0)
    expect(a.buffer.byteLength).toBe(a.byteLength)
  }
  // Pairs: living settlements known to the source people when they first travelled, with a path between them.
  expect(F.from.length).toBe(F.count)
  expect(F.pathOffsets.length).toBe(F.count + 1)
  const firstTravel = new Int32Array(P).fill(-1)
  for (const e of h.events) if (e.type === EventType.LeisureTravel) { expect(firstTravel[e.value]).toBe(-1); firstTravel[e.value] = e.year; expect(h.settlements[e.settlement].people).toBe(e.value) }
  for (let k = 0; k < F.count; k++) {
    const a = F.from[k], b = F.to[k], y = F.firstYear[k]
    expect(a !== b && a >= 0 && a < S && b >= 0 && b < S).toBe(true)
    if (k > 0) expect(y).toBeGreaterThanOrEqual(F.firstYear[k - 1])
    expect(aliveAt(h, a, y) && aliveAt(h, b, y)).toBe(true)
    expect(h.settlements[a].outpost || h.settlements[b].outpost).toBe(false)
    const p = h.settlements[a].people
    expect(firstTravel[p] >= 0 && firstTravel[p] <= y).toBe(true)
    const kn = h.knownYear[p * N + h.settlements[b].cell]
    expect(kn >= 0 && kn <= y).toBe(true)
    const q = h.settlements[b].people
    if (q !== p) { const m = h.contactYear[p * P + q]; expect(m >= 0 && m <= y).toBe(true) }
    expect(F.path[F.pathOffsets[k]]).toBe(h.settlements[a].cell)
    expect(F.path[F.pathOffsets[k + 1] - 1]).toBe(h.settlements[b].cell)
  }
  // Rows: sorted by snapshot then pair, of pairs between settlements living at the snapshot, positive.
  for (let r = 0; r < F.rowCount; r++) {
    const q = F.rowSnapshot[r], k = F.rowPair[r], y = q * h.tradeInterval
    if (r > 0 && (q < F.rowSnapshot[r - 1] || (q === F.rowSnapshot[r - 1] && k <= F.rowPair[r - 1]))) throw new Error(`row ${r} out of order`)
    if (q >= h.tradeSnapshotCount || k < 0 || k >= F.count || F.firstYear[k] > y) throw new Error(`row ${r} bad pair/snapshot`)
    if (!aliveAt(h, F.from[k], y) || !aliveAt(h, F.to[k], y)) throw new Error(`row ${r}: pair ${k} not living in ${y}`)
    if (!(F.visitors[r] > 0) || !(F.spend[r] >= 0)) throw new Error(`row ${r} visitors ${F.visitors[r]}`)
  }
  // Resorts: founded for visitors (ResortFounded), after their people's first travel; alive at the end only with visitors within the grace period.
  const lastRow = new Int32Array(S).fill(-1)
  for (let r = 0; r < F.rowCount; r++) lastRow[F.to[F.rowPair[r]]] = F.rowSnapshot[r] * h.tradeInterval
  for (const st of h.settlements) {
    if (!st.resort) continue
    expect(st.parent).toBeGreaterThanOrEqual(0)
    expect(st.outpost).toBe(false)
    const ev = h.events.find((e) => e.type === EventType.ResortFounded && e.settlement === st.id)
    expect(ev?.year).toBe(st.foundedYear)
    expect(ev?.other).toBe(st.parent)
    const p = h.settlements[st.parent].people
    expect(firstTravel[p] >= 0 && firstTravel[p] <= st.foundedYear).toBe(true)
    if (st.abandonedYear < 0) expect(Math.max(lastRow[st.id], st.foundedYear)).toBeGreaterThanOrEqual(h.years - RESORT.grace - h.tradeInterval)
  }
  // Sights: valid places and years, each with its event.
  for (const x of h.sights) {
    expect(x.id).toBe(h.sights.indexOf(x))
    expect(x.cell >= 0 && x.cell < N).toBe(true)
    expect(x.fromYear >= 0 && x.fromYear <= h.years).toBe(true)
    expect(x.fame >= 0 && x.fame <= 1.5).toBe(true)
    expect(x.settlement >= -1 && x.settlement < S).toBe(true)
    if (x.settlement >= 0) { expect(h.settlements[x.settlement].cell).toBe(x.cell); expect(x.name).toBe(h.settlements[x.settlement].name) }
    const ev = h.events.find((e) => e.type === EventType.SightRecognised && e.value === x.id)
    expect(ev && ev.year === x.fromYear && ev.extra === x.kind && ev.other === x.settlement && aliveAt(h, ev.settlement, ev.year)).toBe(true)
    if (x.settlement >= 0 && aliveAt(h, x.settlement, x.fromYear)) expect(ev!.settlement).toBe(x.settlement)
    if (x.kind === SightKind.Ruin) {
      // (an abandoned place, ruinAfter years on; or a great town shrunk to a fraction of its peak)
      const st = h.settlements[x.settlement], a = st.abandonedYear
      if (a >= 0 && a < x.fromYear) expect(x.fromYear - a).toBeGreaterThanOrEqual(SIGHT.ruinAfter)
      else {
        const S = h.settlements.length
        let peak = 0
        for (let q = 0; q * h.snapshotInterval <= x.fromYear; q++) peak = Math.max(peak, h.population[q * S + st.id])
        expect(peak).toBeGreaterThanOrEqual(SIGHT.ruinPop * 0.9)
      }
    }
    if (x.kind === SightKind.OldCapital) expect(h.polities.some((p) => p.capitals.includes(x.settlement) && p.foundedYear + SIGHT.capitalYears <= x.fromYear)).toBe(true)
    if (x.kind === SightKind.PolarBase) expect(h.settlements[x.settlement].outpost).toBe(true)
  }
  // Events consistent with the tables.
  for (const e of h.events) {
    if (e.type < 100 || e.type > 109) continue
    expect(e.type).toBeLessThanOrEqual(EventType.SightRecognised)
    switch (e.type) {
      case EventType.ResortFounded: expect(h.settlements[e.settlement].resort).toBe(true); break
      case EventType.ResortAbandoned: expect(h.settlements[e.settlement].resort).toBe(true); expect(h.settlements[e.settlement].abandonedYear).toBe(e.year); expect(e.value).toBeGreaterThanOrEqual(RESORT.grace); break
      case EventType.ResortInFashion: expect(e.value).toBeGreaterThanOrEqual(RESORT.fashionOn); expect(aliveAt(h, e.settlement, e.year)).toBe(true); break
      case EventType.ResortDeclined: expect((e.extra ?? -1) >= 0 && (e.extra ?? -1) <= 3).toBe(true); expect(h.events.some((f) => f.type === EventType.ResortInFashion && f.settlement === e.settlement && f.year < e.year)).toBe(true); break
      case EventType.LeisureTravel: break
      case EventType.SightRecognised: expect(e.value >= 0 && e.value < h.sights.length).toBe(true); break
      default: throw new Error(`unknown tourism event ${e.type}`)
    }
  }
}

describe('tourism', () => {
  it('switched off, the history is the one from before the tourism system, with the tourism fields empty', () => {
    for (const [seed, years, n, opts, hash] of GOLDEN) {
      const w = n ? generateWorld(seed, { subdivisions: n }) : world(seed)
      const h = simulateHistory(w, { years, ...opts, tourism: false, renaming: false }) // (renaming: later, off here too)
      expect(hashPreTourism(h)).toBe(hash)
      expect(h.scenery.length + h.sceneryKind.length + h.sights.length + h.visitorFlows.count + h.visitorFlows.rowCount + h.visitorFlows.path.length).toBe(0)
      expect(h.events.some((e) => e.type >= 100 && e.type <= 109)).toBe(false)
      expect(h.settlements.some((s) => s.resort)).toBe(false)
    }
  }, 240_000)

  it('is deterministic, and inert before the first leisure travel', () => {
    const a = history(6)
    const b = simulateHistory(generateWorld(6))
    expect(hashTourism(b)).toBe(hashTourism(a))
    expect(hashPreTourism(b)).toBe(hashPreTourism(a))
    expect(hashTourism(history(3))).not.toBe(hashTourism(a))
    // Up to the first travel the history is the one without the system.
    const first = a.events.find((e) => e.type === EventType.LeisureTravel)!.year
    const y = Math.floor((first - 1) / 10) * 10
    const on = simulateHistory(world(6), { years: y }), off = simulateHistory(world(6), { years: y, tourism: false })
    expect(hashPreTourism(on)).toBe(hashPreTourism(off))
  }, 180_000)

  it('a longer run repeats a shorter one exactly; a resumed run equals runs from scratch, owning its arrays', () => {
    const w = world(6)
    const short = simulateHistory(w, { years: 2000 })
    const long = simulateHistory(w, { years: 2600 })
    expect(Array.from(long.scenery)).toEqual(Array.from(short.scenery))
    expect(Array.from(long.sceneryKind)).toEqual(Array.from(short.sceneryKind))
    expect(long.sights.slice(0, short.sights.length)).toEqual(short.sights)
    const A = short.visitorFlows, B = long.visitorFlows
    expect(A.count).toBeGreaterThan(0)
    expect(B.count).toBeGreaterThanOrEqual(A.count)
    for (let k = 0; k < A.count; k++) if (A.from[k] !== B.from[k] || A.to[k] !== B.to[k] || A.firstYear[k] !== B.firstYear[k] || A.pathOffsets[k + 1] !== B.pathOffsets[k + 1]) throw new Error(`pair ${k} differs`)
    for (let i = 0; i < A.path.length; i++) if (A.path[i] !== B.path[i]) throw new Error(`path ${i} differs`)
    expect(B.rowCount).toBeGreaterThan(A.rowCount)
    for (let r = 0; r < A.rowCount; r++) if (A.rowSnapshot[r] !== B.rowSnapshot[r] || A.rowPair[r] !== B.rowPair[r] || A.visitors[r] !== B.visitors[r] || A.spend[r] !== B.spend[r]) throw new Error(`row ${r} differs`)
    for (let i = 0; i < short.settlements.length; i++) expect(long.settlements[i].resort).toBe(short.settlements[i].resort)
    const evS = short.events.filter((e) => e.type >= 100), evL = long.events.filter((e) => e.type >= 100)
    expect(evL.slice(0, evS.length)).toEqual(evS)
    // Resumable.
    const run = createHistoryRun(w)
    const a = run.advanceTo(2000)
    expect(hashTourism(a)).toBe(hashTourism(short))
    expect(hashPreTourism(a)).toBe(hashPreTourism(short))
    const b = run.advanceTo(2600)
    expect(hashTourism(b)).toBe(hashTourism(long))
    expect(hashPreTourism(b)).toBe(hashPreTourism(long))
    expect(hashTourism(a)).toBe(hashTourism(short)) // (untouched by the extension)
    const bufs = (h: History) => [h.scenery, h.sceneryKind, h.visitorFlows.from, h.visitorFlows.path, h.visitorFlows.rowPair, h.visitorFlows.visitors].map((x) => x.buffer)
    const seen = new Set(bufs(a))
    for (const x of bufs(b)) expect(seen.has(x)).toBe(false)
  }, 240_000)

  it('every history satisfies the tourism invariants; resorts farm nothing', () => {
    for (const seed of [6, 42]) checkTourism(world(seed), history(seed))
    const w = generateWorld(9, { subdivisions: 24 })
    checkTourism(w, simulateHistory(w, { years: 2400 }))
    // Resorts: no fields of their own (the food system skips them), fed by trade or by food bought with visitor money.
    let checked = 0
    const run = runHistory(world(3), { years: 2400 }, (s: HistoryState) => {
      const tz = s.tz
      if (!tz || !tz.anyResort || s.year % 50 !== 0) return
      for (const id of s.living) if (tz.resort[id] && s.founded[id] < s.year) { expect(s.expected[id]).toBe(0); checked++ }
    })
    expect(checked).toBeGreaterThan(0)
    checkTourism(world(3), run.history)
  }, 300_000)

  it('dynamics: late and small by 2000, substantial by 3000, a small share of the economy', () => {
    for (const seed of [1, 42]) {
      const h = history(seed, 3000)
      checkTourism(world(seed), h)
      const first = h.events.find((e) => e.type === EventType.LeisureTravel)
      expect(first).toBeDefined()
      expect(first!.year).toBeGreaterThanOrEqual(1100)
      expect(first!.year).toBeLessThanOrEqual(2000)
      const F = h.visitorFlows
      const at = (y: number): { dests: number; visitors: number; spend: number } => {
        const q = Math.floor(y / h.tradeInterval)
        const m = new Map<number, number>() // (lookup only)
        let visitors = 0, spend = 0
        for (let r = 0; r < F.rowCount; r++) if (F.rowSnapshot[r] === q) { const to = F.to[F.rowPair[r]]; m.set(to, (m.get(to) ?? 0) + F.visitors[r]); visitors += F.visitors[r]; spend += F.spend[r] }
        let dests = 0
        for (const v of m.values()) if (v >= 20) dests++
        return { dests, visitors, spend }
      }
      const a = at(2000), b = at(3000)
      expect(a.dests).toBeLessThanOrEqual(15)
      expect(b.dests).toBeGreaterThanOrEqual(10)
      expect(b.visitors).toBeGreaterThan(2 * a.visitors)
      // Spending: a small share of the world's wealth (and of its yearly trade income, a few percent at most).
      const S = h.settlements.length, q = h.snapshotCount - 1
      let wealth = 0
      for (let id = 0; id < S; id++) wealth += h.wealth[q * S + id]
      expect(b.spend).toBeLessThan(0.02 * wealth)
      expect(h.settlements.filter((s) => s.resort).length).toBeGreaterThanOrEqual(2)
      // No people dies out.
      const alive = new Uint8Array(h.peoples.length)
      for (let i = 0; i < S; i++) if (h.population[q * S + i] > 0) alive[h.settlements[i].people] = 1
      expect(alive.every((x) => x === 1)).toBe(true)
    }
  }, 300_000)
})
