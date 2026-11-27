// seat-mode steps 8, 9, 13: the court order kinds (orders/seatOrders.ts) and their cards (seat/watch.ts). A session that takes
// the active option of every card fulfils court orders and logs their events; the dependent kinds are off without their system.
import { describe, expect, it } from 'vitest'
import { OrderKind, OrderReason, OrderStatus, SeatKind, decisionOrders } from '../../../contract.ts'
import type { History, Order, OrderKind as OK } from '../../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../../index.ts'

describe('seat court kinds', () => {
  it('without finance or oaths, Borrow and Betray are SystemOff; a bad Defy or Repudiate fails NoBond', () => {
    const w = generateWorld(3)
    const orders: Order[] = [
      { year: 100, kind: OrderKind.Borrow as OK, actor: 0 },
      { year: 100, kind: OrderKind.Betray as OK, actor: 0, target: 1 },
      { year: 100, kind: OrderKind.Defy as OK, actor: 0, target: 1 },
      { year: 100, kind: OrderKind.Repudiate as OK, actor: 0, target: 1 },
    ]
    const h = simulateHistory(w, { years: 120, orders })
    const r = h.orderOutcomes!
    expect([r[0].reason, r[1].reason]).toEqual([OrderReason.SystemOff, OrderReason.SystemOff])
    for (const k of [2, 3]) { expect(r[k].status).toBe(OrderStatus.Failed); expect([OrderReason.NoBond, OrderReason.NoActor, OrderReason.NoTarget]).toContain(r[k].reason) }
  }, 300_000)

  it('a session taking the active options fulfils court orders (seed 42, 800-1100, finance and oaths on)', () => {
    const w = generateWorld(42)
    const run = createHistoryRun(w, { seat: { kind: SeatKind.Polity, id: 3, from: 800 }, finance: true, oaths: true })
    run.simulateTo(800)
    let i = 0
    for (;;) {
      const y = run.playSeat!(1100)
      if (y >= 1100) break
      const h = run.advanceTo(y)
      const D = h.seat!.decisions
      for (let d = 0; d < D.count; d++) {
        if (D.year[d] !== y) continue
        const act: number[] = []
        for (let o = 0; o < D.optStart[d + 1] - D.optStart[d]; o++) { const oo = D.optStart[d] + o; if (D.orderStart[oo + 1] > D.orderStart[oo]) act.push(o) }
        run.addOrders!(decisionOrders(h, d, act.length ? act[i++ % act.length] : 0))
      }
    }
    const h: History = run.advanceTo(1100)
    const kinds = new Set(h.seat!.decisions.kind)
    for (const k of [2, 3]) expect(kinds.has(k)).toBe(true) // Heir, Crisis (seat step 8)
    const done = new Set<number>()
    h.orders!.forEach((o, k) => { if (o.kind >= OrderKind.Repudiate && h.orderOutcomes![k].status === OrderStatus.Fulfilled) done.add(o.kind) })
    expect(done.size).toBeGreaterThanOrEqual(3)
    expect(h.events.some((e) => (e.type as number) === 274)).toBe(true) // HeirNamed
    expect(h.events.some((e) => (e.type as number) === 275)).toBe(true) // CourtPlacated
  }, 900_000)
})
