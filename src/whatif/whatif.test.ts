// What-if (experience-whatif-director-sagas §1.11 tests 1-4): the fingerprint is a pure function of the History (its
// snapshot() copy gives the same), leaves the player's events out; the diff of a run with itself is empty (divergence
// -1, similarity 1, identity matches); a fulfilled Fortify parts the runs at its year with a kept settlement prefix;
// synthetic polity matching; the event-field table agrees with the UI's predicate.

import { describe, expect, it } from 'vitest'
import { EventType, OrderKind, OrderStatus, type History, type Order } from '../contract.ts'
import { generateWorld, simulateHistory } from '../sim/index.ts'
import { snapshot } from '../historyCache.ts'
import { otherIsSettlement } from '../ui/historyIndex.ts'
import { EVENT_TYPE_MAX, isPlayerEvent, otherIsSettlementType } from './eventFields.ts'
import { fingerprintBytes, fingerprintOf, MINHASH_K, type HistoryFingerprint } from './fingerprint.ts'
import { diffFingerprints, partingYear } from './diff.ts'

const SEED = 42
const YEARS = 400
const world = generateWorld(SEED)
let base: History | null = null
const baseRun = () => (base ??= simulateHistory(world, { years: YEARS }))

/** A Fortify at `year` on the largest towns, the first that is fulfilled (and its run). */
function fortified(year: number): { order: Order; h: History } {
  const h0 = baseRun()
  const N = h0.settlements.length, s = Math.floor(year / h0.snapshotInterval)
  const ids = [...Array(N).keys()].sort((a, b) => h0.population[s * N + b] - h0.population[s * N + a])
  for (const id of ids.slice(0, 12)) {
    const order: Order = { year, kind: OrderKind.Fortify, actor: id }
    const h = simulateHistory(world, { years: YEARS, orders: [order] })
    if (h.orderOutcomes?.[0].status === OrderStatus.Fulfilled) return { order, h }
  }
  throw new Error('no fortify fulfilled')
}

describe('fingerprint', () => {
  it('is the same for a History and its snapshot copy, and leaves the player\'s events out', { timeout: 900_000 }, () => {
    const h = baseRun()
    const a = fingerprintOf(h), b = fingerprintOf(snapshot(h))
    for (const k of Object.keys(a) as (keyof HistoryFingerprint)[]) {
      const x = a[k], y = b[k]
      if (ArrayBuffer.isView(x)) expect(Array.from(x as Uint32Array)).toEqual(Array.from(y as Uint32Array))
      else expect(x).toEqual(y)
    }
    expect(fingerprintBytes(a)).toBeLessThan(500_000)
    const { h: ho } = fortified(200)
    const f = fingerprintOf(ho)
    for (let i = 0; i < f.evCount; i++) expect(isPlayerEvent(f.evType[i])).toBe(false)
    expect(ho.events.some((e) => isPlayerEvent(e.type))).toBe(true)
  })
})

describe('diff', () => {
  it('of a run with itself: no divergence, similarity 1, identity matches', { timeout: 900_000 }, () => {
    const h = baseRun()
    const fp = fingerprintOf(h)
    const d = diffFingerprints(fp, fingerprintOf(snapshot(h)), world.grid.positions)
    expect(d.divergence).toBe(-1)
    expect(Array.from(d.similarity).every((x) => x === 1)).toBe(true)
    expect(d.firstA.length + d.firstB.length).toBe(0)
    expect(d.prefix).toBe(h.settlements.length)
    expect(Array.from(d.sMatch)).toEqual([...Array(h.settlements.length).keys()])
    expect(Array.from(d.pMatch)).toEqual([...Array(h.polities.length).keys()])
    expect(Array.from(d.wMatch)).toEqual([...Array(h.wars.count).keys()])
    expect(partingYear(d)).toBe(-1)
  })

  it('a fulfilled Fortify parts the runs at its year, keeping a settlement prefix', { timeout: 900_000 }, () => {
    const { order, h } = fortified(200)
    const d = diffFingerprints(fingerprintOf(baseRun()), fingerprintOf(h), world.grid.positions)
    expect(d.divergence).toBeGreaterThanOrEqual(order.year)
    expect(d.prefix).toBeGreaterThan(0)
    expect(d.firstA.length + d.firstB.length).toBeGreaterThan(0)
    for (let k = 0; k < d.similarity.length; k++) if ((k + 1) * 10 <= d.divergence) expect(d.similarity[k]).toBe(1)
    // the walls are among the first differences of the nudged run
    const built = Array.from(d.firstB).some((i) => h.events[i].type === EventType.Built && h.events[i].settlement === order.actor)
    expect(built).toBe(true)
  })
})

/** A synthetic fingerprint of `P` polities (people, founded, capital cell, MinHash lanes per polity). */
function synth(pols: { people: number; founded: number; cap: number; lanes: number[] }[]): HistoryFingerprint {
  const fp = fingerprintOf({ years: 100, snapshotInterval: 5, snapshotCount: 21, settlements: [], population: new Float32Array(0), events: [], peoples: [{ id: 0 }, { id: 1 }], polities: [], landCells: new Uint32Array(0), landSnapshotCount: 0, landInterval: 20 } as unknown as History)
  const P = pols.length
  fp.pFounded = Int16Array.from(pols, (p) => p.founded)
  fp.pEnded = new Int16Array(P).fill(-1)
  fp.pPeople = Int16Array.from(pols, (p) => p.people)
  fp.pCap = new Int32Array(P).fill(-1)
  fp.pCapCell = Int32Array.from(pols, (p) => p.cap)
  fp.pPeak = new Float32Array(P).fill(1000)
  fp.pPeakYear = new Int16Array(P)
  fp.pMinhash = Uint32Array.from(pols.flatMap((p) => p.lanes))
  return fp
}

describe('polity matching (synthetic)', () => {
  const L = (x: number) => Array.from({ length: MINHASH_K }, (_, k) => x * 100 + k)
  it('Jaccard 1 and the same people match; other peoples never do', () => {
    const A = synth([{ people: 0, founded: 50, cap: 7, lanes: L(1) }, { people: 1, founded: 60, cap: 9, lanes: L(2) }])
    const B = synth([{ people: 1, founded: 55, cap: 9, lanes: L(2) }, { people: 1, founded: 50, cap: 3, lanes: L(1) }, { people: 0, founded: 52, cap: 70, lanes: L(1) }])
    A.evCount = 0; B.evCount = 0
    // (a divergence at 0: no shared polity prefix)
    const d = diffFingerprints(A, { ...B, evYear: Int16Array.of(0), evExact: Uint32Array.of(1), evHash: Uint32Array.of(1), evIndex: Int32Array.of(0), evType: Uint16Array.of(0), evCell: Int32Array.of(-1), evCount: 1 })
    expect(d.divergence).toBe(0)
    expect(d.pMatch[0]).toBe(1) // same people, same land, same capital
    expect(d.pMatch[1]).toBe(-1) // same land as A's polity 0, but another people
    expect(d.pMatch[2]).toBe(0)
    expect(d.pScore[0]).toBeGreaterThan(0.9)
  })
})

describe('event fields', () => {
  it('agree with the UI\'s otherIsSettlement on every type id', () => {
    for (let t = 0; t <= EVENT_TYPE_MAX; t++) expect(otherIsSettlementType(t), `type ${t}`).toBe(otherIsSettlement(t))
  })
})
