// cradle wishes: tests of the player's wished start cells (HistoryOptions.cradles; cradleWish.ts): the off-switch, the outcomes
// against the livability rule, the first settlements and the CradlePlaced events, the preview and the count, the text form,
// determinism, prefix stability and resumability.

import { describe, expect, it } from 'vitest'
import { CradleOutcome, EventType, canonicalCradles, decodeCradles, encodeCradles } from '../../contract.ts'
import type { History, World } from '../../contract.ts'
import { createHistoryRun, cradleCount, generateWorld, previewCradles, simulateHistory } from '../index.ts'
import { cradleWishRadius } from './cradleWish.ts'
import { CRADLE_WISH } from './params.ts'
import type { Terrain } from './terrain.ts'
import { buildTerrain } from './terrain.ts'

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
/** Hash of every History field. */
function hashAll(hi: History): string {
  return (hv(0x811c9dc5, hi) >>> 0).toString(16)
}

/**
 * Histories without a wish: hashAll of simulateHistory equals the history of main 0750a61, before the cradle wishes, recorded
 * there by the same hash. A later change elsewhere must regenerate these.
 */
const GOLDEN: [number, number, number | undefined, Record<string, boolean>, string][] = [
  [42, 1200, undefined, {}, '7c6520a6'],
  [3, 600, undefined, {}, 'bfa7b671'],
  [7, 900, undefined, { polities: false, goods: false }, '8580e65e'],
  [9, 800, 24, {}, 'def70eb5'],
]

const worlds = new Map<string, World>()
function world(seed: number, n?: number): World {
  const key = `${seed}/${n ?? ''}`
  let w = worlds.get(key)
  if (!w) { w = generateWorld(seed, n ? { subdivisions: n } : undefined); worlds.set(key, w) }
  return w
}

function chord(w: World, a: number, b: number): number {
  const P = w.grid.positions
  return Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2])
}
/** Hops from c to every cell (over land or sea), -1 beyond `max`. */
function hopsFrom(w: World, c: number, max: number): Int32Array {
  const { neighborOffsets: off, neighbors: nb, cellCount } = w.grid
  const d = new Int32Array(cellCount).fill(-1)
  const q = [c]
  d[c] = 0
  for (let h = 0; h < q.length; h++) {
    const x = q[h]
    if (d[x] >= max) continue
    for (let e = off[x]; e < off[x + 1]; e++) if (d[nb[e]] < 0) { d[nb[e]] = d[x] + 1; q.push(nb[e]) }
  }
  return d
}
const livable = (T: Terrain, c: number): boolean => T.baseHabitable[c] === 1 && T.sea[c] === 0

/** Wishes for seed 3 exercising every rule: a livable cell far from the default tribes, a coastal sea cell, open ocean, -1, the first wish again, a livable cell close to the first. */
let WISH3: number[] | null = null
function wishes3(): number[] {
  if (WISH3) return WISH3
  const w = world(3)
  const T = buildTerrain(w)
  const N = T.cellCount
  const def = simulateHistory(w, { years: 0 })
  const tribes = def.peoples.map((p) => def.settlements[p.founder].cell)
  const { neighborOffsets: off, neighbors: nb } = w.grid
  let far = -1, farD = -1
  for (let c = 0; c < N; c++) {
    if (!livable(T, c)) continue
    let ln = 0
    for (let e = off[c]; e < off[c + 1]; e++) if (livable(T, nb[e])) ln++
    if (ln < off[c + 1] - off[c]) continue // inland, among livable land
    let m = Infinity
    for (const t of tribes) m = Math.min(m, chord(w, c, t))
    if (m > farD || (m === farD && c < far)) { farD = m; far = c }
  }
  let coast = -1
  for (let c = 0; c < N && coast < 0; c++) {
    if (!T.sea[c] || chord(w, c, far) < 0.5) continue
    for (let e = off[c]; e < off[c + 1]; e++) if (livable(T, nb[e])) { coast = c; break }
  }
  const R = cradleWishRadius(T.n)
  let ocean = -1
  for (let c = 0; c < N && ocean < 0; c++) {
    if (!T.sea[c]) continue
    const d = hopsFrom(w, c, R + 2)
    let land = false
    for (let i = 0; i < N && !land; i++) if (d[i] >= 0 && !T.sea[i]) land = true
    if (!land) ocean = c
  }
  let close = -1
  for (let c = 0; c < N && close < 0; c++) if (c !== far && livable(T, c) && chord(w, c, far) < 0.08) close = c
  expect([far, coast, ocean, close].every((c) => c >= 0)).toBe(true)
  WISH3 = [far, coast, ocean, -1, far, close]
  return WISH3
}

describe('cradle wishes', () => {
  it('without a wish (undefined, [], only -1, or wishes beyond the people count), every History field is the one from before them', () => {
    for (const [seed, years, n, opts, hash] of GOLDEN) {
      const w = world(seed, n)
      const a = simulateHistory(w, { years, ...opts })
      expect(hashAll(a)).toBe(hash)
      expect(a.cradleWish).toBeUndefined()
      expect(a.cradleCell).toBeUndefined()
      expect(a.cradlePlaced).toBeUndefined()
      expect(a.cradleCrowded).toBeUndefined()
      expect(a.events.some((e) => e.type === EventType.CradlePlaced)).toBe(false)
      if (seed === 3) {
        expect(hashAll(simulateHistory(w, { years, ...opts, cradles: [] }))).toBe(hash)
        expect(hashAll(simulateHistory(w, { years, ...opts, cradles: [-1, -1, -1] }))).toBe(hash)
        const beyond = new Array(a.peoples.length).fill(-1).concat([a.settlements[0].cell])
        expect(hashAll(simulateHistory(w, { years, ...opts, cradles: beyond }))).toBe(hash)
      }
    }
  })

  it('the people count depends only on the world (cradleCount), and the preview tells what the History records', () => {
    for (const [seed, , n] of GOLDEN) {
      const w = world(seed, n)
      const P = cradleCount(w)
      expect(simulateHistory(w, { years: 0 }).peoples.length).toBe(P)
      if (seed === 3) {
        const h = simulateHistory(w, { years: 0, cradles: wishes3() })
        expect(h.peoples.length).toBe(P)
        const pv = previewCradles(w, wishes3())
        expect(pv.count).toBe(P)
        expect(Array.from(pv.wish)).toEqual(Array.from(h.cradleWish!))
        expect(Array.from(pv.cell)).toEqual(Array.from(h.cradleCell!))
        expect(Array.from(pv.placed)).toEqual(Array.from(h.cradlePlaced!))
        expect(Array.from(pv.crowded)).toEqual(Array.from(h.cradleCrowded!))
        expect(Array.from(pv.cradle)).toEqual(h.peoples.map((p) => p.cradle))
      }
      const none = previewCradles(w)
      const d = simulateHistory(w, { years: 0 })
      expect(Array.from(none.cell)).toEqual(d.peoples.map((p) => d.settlements[p.founder].cell))
      expect(Array.from(none.cradle)).toEqual(d.peoples.map((p) => p.cradle))
    }
  })

  it('places, moves or rejects each wish by the livability rule; first settlements, events and cradles agree', () => {
    const w = world(3)
    const T = buildTerrain(w)
    const N = T.cellCount
    const R = cradleWishRadius(T.n)
    const cradles = wishes3()
    const h = simulateHistory(w, { years: 300, cradles })
    const P = h.peoples.length
    expect(P).toBe(6)
    const wish = h.cradleWish!, cell = h.cradleCell!, placed = h.cradlePlaced!, crowded = h.cradleCrowded!
    expect([wish.length, cell.length, placed.length, crowded.length]).toEqual([P, P, P, P])
    // The expected outcomes of the chosen wishes.
    expect(Array.from(placed)).toEqual([CradleOutcome.Placed, CradleOutcome.Moved, CradleOutcome.Rejected, CradleOutcome.Chosen, CradleOutcome.Moved, CradleOutcome.Placed])
    const taken: number[] = []
    for (let p = 0; p < P; p++) {
      const c = cell[p]
      const f = h.settlements[h.peoples[p].founder]
      expect(f.cell).toBe(c) // the first settlement is at cradleCell
      expect(f.foundedYear).toBe(0)
      expect(f.parent).toBe(-1)
      expect(livable(T, c)).toBe(true)
      expect(wish[p]).toBe(cradles[p] >= 0 ? cradles[p] : -1)
      const ws = wish[p]
      if (placed[p] === CradleOutcome.Placed) {
        expect(c).toBe(ws)
        expect(taken.includes(c)).toBe(false)
      } else if (placed[p] === CradleOutcome.Moved) {
        expect(livable(T, ws) && !taken.includes(ws)).toBe(false)
        const d = hopsFrom(w, ws, R)
        expect(d[c]).toBeGreaterThanOrEqual(0)
        // No free livable cell within the radius is nearer.
        for (let i = 0; i < N; i++) if (d[i] >= 0 && livable(T, i) && !taken.includes(i)) expect(chord(w, ws, i)).toBeGreaterThanOrEqual(chord(w, ws, c) - 1e-9)
      } else if (placed[p] === CradleOutcome.Rejected) {
        if (ws < N) {
          const d = hopsFrom(w, ws, R)
          for (let i = 0; i < N; i++) if (d[i] >= 0) expect(livable(T, i) && !taken.includes(i)).toBe(false)
        }
      } else expect(ws).toBe(-1)
      if (placed[p] === CradleOutcome.Placed || placed[p] === CradleOutcome.Moved) taken.push(c)
    }
    // Distinct start cells; the peoples the simulation placed keep away from the wished ones.
    expect(new Set(Array.from(cell)).size).toBe(P)
    for (let p = 0; p < P; p++) for (let q = 0; q < P; q++) {
      const pw = placed[p] === CradleOutcome.Placed || placed[p] === CradleOutcome.Moved
      const qw = placed[q] === CradleOutcome.Placed || placed[q] === CradleOutcome.Moved
      if (p !== q && !pw && qw) expect(chord(w, cell[p], cell[q])).toBeGreaterThanOrEqual(CRADLE_WISH.avoidChord - 1e-9)
      if (p < q && pw && qw) expect(crowded[p] === 1 && crowded[q] === 1).toBe(chord(w, cell[p], cell[q]) < CRADLE_WISH.crowdChord)
    }
    expect(crowded[0]).toBe(1) // the first wish and the one close to it
    expect(crowded[5]).toBe(1)
    // Events: one CradlePlaced at year 0 per wished people, right after its founding.
    const ev = h.events.filter((e) => e.type === EventType.CradlePlaced)
    expect(ev.map((e) => e.value)).toEqual([0, 1, 2, 4, 5])
    for (const e of ev) {
      expect(e.year).toBe(0)
      expect(e.settlement).toBe(h.peoples[e.value].founder)
      expect(e.other).toBe(-1)
      expect(e.extra).toBe(placed[e.value])
      const i = h.events.indexOf(e)
      expect(h.events[i - 1].type === EventType.Founded || h.events.slice(0, i).some((x) => x.type === EventType.Founded && x.settlement === e.settlement)).toBe(true)
    }
    // Cradles: numbered 0.. without gaps; the wished people far from every tribe begins its own.
    const ks = Array.from(new Set(h.peoples.map((p) => p.cradle))).sort((a, b) => a - b)
    expect(ks).toEqual(ks.map((_, i) => i))
    expect(h.peoples.filter((p) => p.cradle === h.peoples[0].cradle).every((p) => [0, 4, 5].includes(p.id))).toBe(true)
    // The world goes on: nobody died out at the founding.
    for (let p = 0; p < P; p++) expect(h.population[h.peoples[p].founder]).toBeGreaterThan(0)
    // A cell outside the world is rejected.
    const out = simulateHistory(w, { years: 0, cradles: [N + 5] })
    expect(out.cradlePlaced![0]).toBe(CradleOutcome.Rejected)
    expect(out.cradleWish![0]).toBe(N + 5)
  })

  it('with wishes: deterministic, prefix-stable, resumable in 50-year chunks', () => {
    const w = world(3)
    const cradles = wishes3()
    const a = simulateHistory(w, { years: 600, cradles })
    expect(hashAll(simulateHistory(w, { years: 600, cradles: cradles.slice() }))).toBe(hashAll(a))
    const run = createHistoryRun(w, { cradles })
    const mid = run.advanceTo(300)
    expect(hashAll(mid)).toBe(hashAll(simulateHistory(w, { years: 300, cradles })))
    expect(hashAll(run.advanceTo(600))).toBe(hashAll(a))
    const run2 = createHistoryRun(w, { cradles })
    for (let y = 50; y <= 600; y += 50) expect(run2.simulateTo(y)).toBe(y)
    expect(hashAll(run2.advanceTo(600))).toBe(hashAll(a))
    // Canonical lists give the same history.
    expect(hashAll(simulateHistory(w, { years: 600, cradles: canonicalCradles([...cradles, -1, -1]) }))).toBe(hashAll(a))
  })

  it('encodes and decodes wish lists as URL-safe text', () => {
    const cs = [12345, -1, 9981, 0, -1]
    const t = encodeCradles(cs)
    expect(t).toBe('12345;-1;9981;0;-1')
    expect(/^[0-9;-]*$/.test(t)).toBe(true)
    expect(decodeCradles(t)).toEqual(cs)
    expect(encodeCradles([])).toBe('')
    expect(decodeCradles('')).toEqual([])
    expect(decodeCradles('5;x;;-7;2.5;7')).toEqual([5, -1, -1, -1, -1, 7])
    expect(encodeCradles([3, 1.5, -4, NaN])).toBe('3;-1;-1;-1')
    expect(canonicalCradles([-1, 4, -1, -1])).toEqual([-1, 4])
    expect(canonicalCradles([-1, -1])).toEqual([])
    expect(canonicalCradles([])).toEqual([])
  })
})
