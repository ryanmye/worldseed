// seat-mode step 6: the watcher (seat/watch.ts). A run paused at each decision and continued with the orders chosen equals the
// run with those orders from the start; the watcher draws nothing; fog; cadence.
import watchSource from './watch.ts?raw'
import { describe, expect, it } from 'vitest'
import { DecisionKind, SeatKind, decisionOrders } from '../../../contract.ts'
import type { History, Order, SeatOptions, World } from '../../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../../index.ts'
import { hashAll } from './hashing.ts'
import { SEAT, URGENT } from './params.ts'

const SEED = 42, Y0 = 800, Y1 = 1000
let W: World | null = null
const world = (): World => (W ??= generateWorld(SEED))
/** The largest polity at year y (by people in its towns). */
function largest(h: History): number {
  const S = h.settlements.length, q = h.snapshotCount - 1
  const pop = new Float64Array(h.polities.length)
  for (let id = 0; id < S; id++) { const p = h.polity[q * S + id]; if (p >= 0) pop[p] += h.population[q * S + id] }
  let big = 0
  for (let p = 0; p < pop.length; p++) if (pop[p] > pop[big]) big = p
  return big
}
let SEATOPT: SeatOptions | null = null
const seat = (): SeatOptions => (SEATOPT ??= { kind: SeatKind.Polity, id: largest(simulateHistory(world(), { years: Y0 })), from: Y0 })

/** A live session: pause at each decision, pick (deterministically: alternately the first and the last option), append, play on. */
function session(): { h: History; orders: Order[]; pauses: number } {
  const run = createHistoryRun(world(), { seat: seat() })
  run.simulateTo(Y0)
  const orders: Order[] = []
  let pauses = 0
  for (;;) {
    const y = run.playSeat!(Y1)
    if (y >= Y1) break
    const h = run.advanceTo(y)
    const D = h.seat!.decisions
    for (let d = 0; d < D.count; d++) {
      if (D.year[d] !== y) continue
      const n = D.optStart[d + 1] - D.optStart[d]
      const o = decisionOrders(h, d, pauses % 2 === 0 ? 0 : n - 1)
      orders.push(...o)
      run.addOrders!(o)
    }
    pauses++
  }
  return { h: run.advanceTo(Y1), orders, pauses }
}

describe('seat watcher (seat-mode §3.5)', () => {
  it('a session paused at each decision equals one run with the same seat and orders (same decisions table)', () => {
    const { h, orders, pauses } = session()
    expect(pauses).toBeGreaterThanOrEqual(3)
    const replay = simulateHistory(world(), { years: Y1, seat: seat(), orders })
    expect(hashAll(replay)).toBe(hashAll(h))
    const D = h.seat!.decisions
    // every decision of the session was answered (its Choice recorded), but one on the last year
    for (let d = 0; d < D.count; d++) if (D.year[d] < Y1) expect(D.chosen[d]).toBeGreaterThanOrEqual(0)
    // and the choices changed the history (from the run with the seat alone)
    expect(hashAll(simulateHistory(world(), { years: Y1, seat: seat() }))).not.toBe(hashAll(h))
  }, 900_000)

  it('fog, cadence and options: what a court could know, at most 2 cards a year, gaps, every card has the court option', () => {
    const h = simulateHistory(world(), { years: Y1, seat: seat() })
    const D = h.seat!.decisions
    expect(D.count).toBeGreaterThan(0)
    const P = h.peoples.length, N = h.capacity.length
    const perYear = new Map<number, number>()
    let last = -1e9
    const lastKind = new Map<number, number>()
    for (let d = 0; d < D.count; d++) {
      const y = D.year[d], k = h.seat!.peopleAt[y - Y0], kind = D.kind[d]
      expect(y).toBeGreaterThan(Y0)
      perYear.set(y, (perYear.get(y) ?? 0) + 1)
      if (y !== last) { if (URGENT.indexOf(kind) < 0) expect(y - last).toBeGreaterThanOrEqual(SEAT.minGap) }
      const lk = lastKind.get(kind)
      if (lk !== undefined && SEAT.cool[kind] > 0) expect(y - lk).toBeGreaterThanOrEqual(SEAT.cool[kind])
      lastKind.set(kind, y)
      last = y
      if (kind === DecisionKind.WarOnUs || kind === DecisionKind.Opening) {
        const q = D.subject[d]
        const cap = h.polities[q].capitals.filter((_, i) => h.polities[q].capitalYears[i] <= y).pop()!
        const pq = h.settlements[cap].people
        if (pq !== k) { const c = h.contactYear[k * P + pq]; expect(c >= 0 && c <= y).toBe(true) }
      }
      if (D.place[d] >= 0 && kind !== DecisionKind.Faith) { const kn = h.knownYear[k * N + h.settlements[D.place[d]].cell]; expect(kn >= 0 && kn <= y).toBe(true) }
      const o0 = D.optStart[d], o1 = D.optStart[d + 1]
      expect(o1 - o0).toBeGreaterThanOrEqual(2)
      let court = 0
      for (let o = o0; o < o1; o++) if (D.orderStart[o + 1] === D.orderStart[o]) court++
      expect(court).toBe(1)
    }
    for (const n of perYear.values()) expect(n).toBeLessThanOrEqual(SEAT.maxCards)
  }, 600_000)

  it('reads nothing a court could not know (no pre-drawn deaths or scheduled kills)', () => {
    const src = (watchSource as string).split('\n').filter((l: string) => !l.trimStart().startsWith('//')).join('\n')
    expect(/rDeath|\.kill\b|pCrisisUntil|\.rng\b|next\(\)/.test(src)).toBe(false)
  })
})
