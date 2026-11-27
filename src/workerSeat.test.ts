// seat-mode step 7: the worker's seat protocol (worker.ts seat, seatChoose, seatStop) in Node, with a fake `self`: a session
// played pause by pause through the worker equals one run with the same seat and orders.
import { describe, expect, it } from 'vitest'
import { SeatKind, decisionOrders } from './contract.ts'
import type { History, Order } from './contract.ts'
import { generateWorld, simulateHistory } from './sim/index.ts'
import { hashAll } from './sim/history/seat/hashing.ts'

type Msg = { type: string; requestId: number; history?: History; cards?: number[]; lost?: boolean; message?: string }
const inbox: Msg[] = []
let waiters: (() => void)[] = []
const g = globalThis as unknown as { self: { postMessage(m: Msg): void; onmessage: ((e: { data: unknown }) => void) | null } }
g.self = { postMessage: (m: Msg) => { inbox.push(m); const w = waiters; waiters = []; for (const f of w) f() }, onmessage: null }
const send = (data: unknown) => g.self.onmessage!({ data })
async function next(type: string): Promise<Msg> {
  for (;;) {
    const i = inbox.findIndex((m) => m.type === type || m.type === 'error')
    if (i >= 0) { const m = inbox.splice(i, 1)[0]; if (m.type === 'error') throw new Error(m.message); return m }
    await new Promise<void>((r) => waiters.push(r))
  }
}

describe('worker seat protocol', () => {
  it('pauses at decisions, appends the choices, and replays exactly', async () => {
    await import('./worker.ts')
    const seed = 42, from = 800
    send({ type: 'generate', requestId: 1, seed, worldOnly: true })
    await next('world')
    const seat = { kind: SeatKind.Polity, id: 2, from }
    let id = 2
    send({ type: 'seat', requestId: id, seat, orders: [] })
    const orders: Order[] = []
    let h: History | null = null
    for (let pause = 0; pause < 4; pause++) {
      const m = await next('seatPause')
      expect(m.requestId).toBe(id)
      h = m.history!
      for (const d of m.cards!) expect(h.seat!.decisions.year[d]).toBe(h.years)
      const add: Order[] = []
      for (const d of m.cards!) add.push(...decisionOrders(h, d, 0))
      orders.push(...add)
      send({ type: 'seatChoose', requestId: ++id, orders: add })
    }
    const m = await next('seatPause')
    h = m.history!
    expect(hashAll(h)).toBe(hashAll(simulateHistory(generateWorld(seed), { years: h.years, seat, orders })))
    // leave the throne: extended without pauses, a replace history
    send({ type: 'seatStop', requestId: ++id, years: h.years + 40 })
    const st = await next('history')
    expect(st.history!.years).toBe(h.years + 40)
    expect(st.history!.seat).toBeDefined()
  }, 900_000)
})
