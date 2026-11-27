// rulers: deference (rulers/deference.ts) and the seat's use of it (seat/system.ts seatChoices): units on a bare state, then a
// played session (seed 42) whose deferrals replay exactly.
import { describe, expect, it } from 'vitest'
import { DEFER_OPTIONS, EventType, OrderKind, SeatKind, decisionOrders } from '../../../contract.ts'
import type { History, Order } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../../index.ts'
import { DeferenceCause, addDeference, deferBlame, deferContestMul, deferOverthrowMul, deferUnrest, deferenceOf, deferenceTaken, deferenceYear, figureheadOf, reclaimPower } from './deference.ts'
import { seatChoices } from '../seat/system.ts'
import { createSeatState } from '../seat/state.ts'
import { SEAT } from '../seat/params.ts'
import { hashAll } from '../seat/hashing.ts'

const bare = (): HistoryState => ({ year: 100, events: [], pol: null, defer: null, orders: null } as unknown as HistoryState)

describe('deference (units)', () => {
  it('is a no-op at 0: nothing created, neutral factors', () => {
    const s = bare()
    deferenceTaken(s, 3)
    deferenceYear(s)
    expect(s.defer).toBeNull()
    expect(deferOverthrowMul(s, 3)).toBeUndefined()
    expect(deferContestMul(s, 3)).toBe(1)
    expect(deferUnrest(s, 3)).toBe(0)
  })

  it('raises the overthrow and contest factors monotonically, and tips into decline and back', () => {
    const s = bare()
    let last = 1
    for (let i = 0; i < 6; i++) {
      addDeference(s, 2, 0.8, DeferenceCause.Player)
      const m = deferOverthrowMul(s, 2)!
      expect(m).toBeGreaterThanOrEqual(last)
      expect(deferContestMul(s, 2)).toBeGreaterThan(1)
      last = m
    }
    expect(figureheadOf(s, 2)).toBe(true)
    expect(s.events.some((e) => (e.type as number) === EventType.SeatDeclined)).toBe(true)
    for (let i = 0; i < SEAT.reassertRun; i++) deferenceTaken(s, 2)
    expect(figureheadOf(s, 2)).toBe(false)
    expect(s.events.some((e) => (e.type as number) === EventType.SeatReasserted && e.extra === 0)).toBe(true)
    reclaimPower(s, 2)
    expect(deferenceOf(s, 2)).toBe(0)
    expect(deferOverthrowMul(s, 2)).toBe(SEAT.reclaimRisk) // (a reclaim's risk for SEAT.reclaimYears)
  })

  it('a divisive deferral costs less authority, and its blame shields the ruler', () => {
    const run = (div: number, blame: boolean) => {
      const s = bare()
      const st = createSeatState({ kind: SeatKind.Polity, id: 5, from: 0 })
      st.dYear.push(99); st.dKind.push(3); st.dPolity.push(5); st.dDiv.push(div); st.dCourt.push(0)
      // a Choice deferral (target row 0 * 8 + defer) given this year, and the same option taken by the ruler for comparison
      const target = blame ? DEFER_OPTIONS.defer : 0
      ;(s as unknown as { orders: unknown }).orders = { n: 1, target: Int32Array.from([target]) }
      s.events.push({ year: 100, type: EventType.OrderGiven, settlement: -1, other: -1, value: 0, extra: OrderKind.Choice })
      seatChoices(s, st)
      return s
    }
    const routine = run(0.05, true), divisive = run(0.9, true), taken = run(0.9, false)
    expect(deferenceOf(divisive, 5)).toBeLessThan(deferenceOf(routine, 5))
    expect(deferenceOf(taken, 5)).toBe(0)
    // the blame shield: the ruler's grievance term is lower than when the same matter was decided by the ruler (here: none fed)
    expect(deferUnrest(divisive, 5)).toBeLessThan(deferUnrest(taken, 5))
    expect(divisive.events.some((e) => (e.type as number) === EventType.DeferBlamed)).toBe(true)
    // blame alone, at an equal deference, lowers the term
    const a = bare(), b = bare()
    addDeference(a, 1, 1, DeferenceCause.Player); addDeference(b, 1, 1, DeferenceCause.Player)
    deferBlame(b, 1, 0.8, 3)
    expect(deferUnrest(b, 1)).toBeLessThan(deferUnrest(a, 1))
  })
})

describe('deference in a seat session (seed 42)', () => {
  const w = generateWorld(42)
  const seat = { kind: SeatKind.Polity, id: 2, from: 800 }
  function session(defer: boolean): { h: History; orders: Order[] } {
    const run = createHistoryRun(w, { seat })
    run.simulateTo(800)
    const orders: Order[] = []
    for (let i = 0; i < 6; i++) {
      const y = run.playSeat!(1000)
      if (y >= 1000) break
      const h = run.advanceTo(y)
      const D = h.seat!.decisions
      for (let d = 0; d < D.count; d++) if (D.year[d] === y) { const o = decisionOrders(h, d, defer ? DEFER_OPTIONS.defer : 0); orders.push(...o); run.addOrders!(o) }
    }
    return { h: run.advanceTo(run.year), orders }
  }

  it('deferrals are Choice orders: the session replays exactly, and feeds deference; decisions taken feed none', () => {
    const a = session(true)
    expect(a.orders.some((o) => o.kind === OrderKind.Choice && (o.target! & 7) === DEFER_OPTIONS.defer)).toBe(true)
    expect(a.h.deference).toBeDefined()
    expect(a.h.seat!.decisions.deferred.some((x) => x === 1)).toBe(true)
    const replay = simulateHistory(w, { years: a.h.years, seat, orders: a.orders })
    expect(hashAll(replay)).toBe(hashAll(a.h))
    const b = session(false)
    expect(b.h.deference).toBeUndefined()
    expect(b.h.events.some((e) => (e.type as number) >= 182 && (e.type as number) <= 184)).toBe(false)
  }, 900_000)
})
