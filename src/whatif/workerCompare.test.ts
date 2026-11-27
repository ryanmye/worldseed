// What-if (experience-whatif-director-sagas §1.11 test 7, and §1.7 test 5's skeleton): the worker's compare request in
// Node with a fake `self`. The other world equals a fresh run with the same options bit for bit (so Adopt is the same
// history), the kept history keeps extending, a skeleton keeps what the comparison reads, and a cancelled compare posts
// nothing.

import { describe, expect, it } from 'vitest'
import { OrderKind, type History, type Order } from '../contract.ts'
import { generateWorld, simulateHistory } from '../sim/index.ts'
import { hashValue } from '../historyCache.ts'
import type { WhatIfDigest } from './diff.ts'
import { isSkeleton } from './skeleton.ts'

type Msg = { type: string; requestId: number; compareId?: number; history?: History; alt?: History; digest?: WhatIfDigest; skeleton?: boolean; message?: string }
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

describe('worker compare', () => {
  it('runs the other world beside the kept one, exactly', { timeout: 900_000 }, async () => {
    await import('../worker.ts')
    const seed = 42, years = 400
    send({ type: 'generate', requestId: 1, seed, historyOptions: { years } })
    const a = await next('history')
    const h = a.history!
    // the largest town at 200 is told to raise walls
    const N = h.settlements.length, s = 200 / h.snapshotInterval
    let town = 0
    for (let id = 0; id < N; id++) if (h.population[s * N + id] > h.population[s * N + town]) town = id
    const orders: Order[] = [{ year: 200, kind: OrderKind.Fortify, actor: town }]
    // a cancelled compare posts nothing; the next one answers
    send({ type: 'compare', requestId: 1, compareId: 1, orders, years, lite: false })
    send({ type: 'compareCancel', compareId: 1 })
    send({ type: 'compare', requestId: 1, compareId: 2, orders, years, lite: false })
    // an extension of the kept history runs between the compare's chunks and still resumes
    send({ type: 'extend', requestId: 1, years: years + 50 })
    const c = await next('compare')
    expect(c.compareId).toBe(2)
    expect(inbox.some((m) => m.type === 'compare' && m.compareId === 1)).toBe(false)
    const fresh = simulateHistory(generateWorld(seed), { years, orders })
    expect(hashValue(c.alt)).toBe(hashValue(fresh))
    expect(c.skeleton).toBe(false)
    expect(c.digest!.divergence).toBeGreaterThanOrEqual(-1)
    const ext = await next('history')
    expect(ext.history!.years).toBe(years + 50)
    // lite: a skeleton, the comparison of the extended history with the same orders
    send({ type: 'compare', requestId: 1, compareId: 3, orders, years: years + 50, lite: true })
    const l = await next('compare')
    expect(l.skeleton).toBe(true)
    expect(isSkeleton(l.alt!)).toBe(true)
    expect(l.alt!.population.length).toBeGreaterThan(0)
    expect(l.alt!.landUse.length).toBe(0)
    expect(l.alt!.events.length).toBeGreaterThan(0)
  })
})
