// seat-mode step 2 (live append, §3.2): orders appended to a run paused at year Y - 1 give exactly the history of a run created
// with all of them from the start (orders/state.ts appendOrders, HistoryRunner.addOrders, HistoryRun.addOrders).
import { describe, expect, it } from 'vitest'
import { OrderKind } from '../../../contract.ts'
import type { History, Order, World } from '../../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../../index.ts'
import { pickOrders } from './ordersStats.ts'
import { hashAll } from '../seat/hashing.ts'

const SEED = 42
let W: World | null = null
const world = (): World => (W ??= generateWorld(SEED))
let BASE: History | null = null
/** The run without orders, 1000 years (the orders are picked from it). */
const base = (): History => (BASE ??= simulateHistory(world(), { years: 1000 }))
const at = (y: number, set: 'A' | 'B'): Order[] => pickOrders(world(), base(), y - 1, set).map((o) => ({ ...o, year: y }))
/** The largest living town at year y - 1 (for a Fortify order). */
function bigTown(h: History, y: number): number {
  const q = Math.floor((y - 1) / h.snapshotInterval), S = h.settlements.length
  let best = -1
  for (const x of h.settlements) if (!x.outpost && x.foundedYear < y && x.abandonedYear < 0 && (best < 0 || h.population[q * S + x.id] > h.population[q * S + best])) best = x.id
  return best
}

describe('live append (seat-mode §3.2)', () => {
  it('a run with no orders added, or an empty list, is the run without orders; orders fields absent', () => {
    const run = createHistoryRun(world())
    run.simulateTo(450)
    run.addOrders([])
    const h = run.advanceTo(1000)
    expect(hashAll(h)).toBe(hashAll(base()))
    expect('orders' in h).toBe(false)
  }, 400_000)

  it('orders appended at Y - 1 (to a run without any) equal a run created with them, and change the history', () => {
    const A = at(600, 'A')
    expect(A.length).toBeGreaterThanOrEqual(2)
    expect(A.some((o) => o.kind === OrderKind.War || o.kind === OrderKind.Peace || o.kind === OrderKind.Explore)).toBe(true)
    const run = createHistoryRun(world())
    run.simulateTo(599)
    run.addOrders(A)
    const live = run.advanceTo(1000)
    const fresh = simulateHistory(world(), { years: 1000, orders: A })
    expect(hashAll(live)).toBe(hashAll(fresh))
    expect(live.orderOutcomes).toEqual(fresh.orderOutcomes)
    expect(hashAll(live)).not.toBe(hashAll(base()))
  }, 600_000)

  it('a 3-step chain (each appended at the year before) equals the run with the whole list', () => {
    const A = at(600, 'A'), B = at(800, 'B')
    const F: Order[] = [{ year: 900, kind: OrderKind.Fortify, actor: bigTown(base(), 900) }]
    const run = createHistoryRun(world())
    run.simulateTo(599); run.addOrders(A)
    run.simulateTo(799); run.addOrders(B)
    run.simulateTo(899); run.addOrders(F)
    const live = run.advanceTo(1000)
    expect(hashAll(live)).toBe(hashAll(simulateHistory(world(), { years: 1000, orders: [...A, ...B, ...F] })))
  }, 600_000)

  it('an order at or before the run year throws, and nothing is added', () => {
    const run = createHistoryRun(world())
    run.simulateTo(100)
    expect(() => run.addOrders([{ year: 100, kind: OrderKind.Fortify, actor: 0 }])).toThrow(RangeError)
    expect(() => run.addOrders([{ year: 101, kind: OrderKind.Fortify, actor: 0 }, { year: 50, kind: OrderKind.Fortify, actor: 0 }])).toThrow(RangeError)
    const h = run.advanceTo(120)
    expect('orders' in h).toBe(false)
    const run2 = createHistoryRun(world(), { orders: [{ year: 30, kind: OrderKind.Fortify, actor: 0 }] })
    run2.simulateTo(100)
    expect(() => run2.addOrders([{ year: 90, kind: OrderKind.Fortify, actor: 0 }])).toThrow(RangeError)
    expect(run2.advanceTo(120).orders?.length).toBe(1)
  }, 200_000)

  it('a pending later order plus an earlier append sorts as from scratch', () => {
    const X: Order = { year: 950, kind: OrderKind.Fortify, actor: bigTown(base(), 950) }
    const A = at(600, 'A')
    const run = createHistoryRun(world(), { orders: [X] })
    run.simulateTo(599)
    run.addOrders(A)
    const live = run.advanceTo(1000)
    expect(hashAll(live)).toBe(hashAll(simulateHistory(world(), { years: 1000, orders: [X, ...A] })))
  }, 600_000)
})
