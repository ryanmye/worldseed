// orders: tests of the player's nudges (src/sim/history/orders): the off-switch, determinism, prefix stability and resumability
// with orders, outcomes and events, the text encoding and the feasibility check.

import { describe, expect, it } from 'vitest'
import { EventType, ORDER_KIND_COUNT, OrderKind, OrderReason, OrderRole, OrderStatus, decodeOrders, describeOrderKinds, encodeOrders, orderFeasible, sortOrders } from '../../../contract.ts'
import type { History, Order, World } from '../../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../../index.ts'
import { pickOrders } from './ordersStats.ts'

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
const isOurs = (t: number): boolean => t >= 170 && t <= 179
/** Hash of every History field but the orders' own (orders, orderOutcomes, events 170-179). */
function hashPreOrders(hi: History): string {
  const r = hi as unknown as Record<string, unknown>
  let h = 0x811c9dc5
  for (const k of Object.keys(r).filter((x) => x !== 'orders' && x !== 'orderOutcomes').sort()) {
    h = fnvBytes(h, enc.encode(k))
    h = hv(h, k === 'events' ? hi.events.filter((e) => !isOurs(e.type)) : r[k])
  }
  return (h >>> 0).toString(16)
}
/** Hash of every History field. */
function hashAll(hi: History): string {
  return (hv(0x811c9dc5, hi) >>> 0).toString(16)
}

/**
 * Histories without orders: hashPreOrders of simulateHistory without orders (and with orders: []) equals the history of main
 * 59362dc, before them (where it is every key of History), recorded there by the same hash. A later change elsewhere must
 * regenerate these.
 */
const GOLDEN: [number, number, number | undefined, Record<string, boolean>, string][] = [
  [42, 2000, undefined, {}, '5d876b1e'],
  [3, 600, undefined, {}, 'bfa7b671'],
  [7, 900, undefined, { polities: false, goods: false }, '8580e65e'],
  [1, 1500, undefined, { disease: false }, '3d7f1cf2'],
  [9, 800, 24, {}, 'def70eb5'],
]

const worlds = new Map<number, World>()
function world(seed: number): World {
  let w = worlds.get(seed)
  if (!w) { w = generateWorld(seed); worlds.set(seed, w) }
  return w
}

/** The standard orders (ordersStats.ts) of seed 3: set A at 700, set B at 950, each from the run without orders. */
let ORDERS3: Order[] | null = null
function ordersOf3(): Order[] {
  if (ORDERS3) return ORDERS3
  const w = world(3)
  const base = simulateHistory(w, { years: 1100 })
  ORDERS3 = [
    ...pickOrders(w, base, 699, 'A').map((o) => ({ ...o, year: 700 })),
    ...pickOrders(w, base, 949, 'B').map((o) => ({ ...o, year: 950 })),
  ]
  return ORDERS3
}

describe('orders', () => {
  it('without orders (undefined or []), every History field is the one from before the orders, and the orders fields are absent', () => {
    for (const [seed, years, n, opts, hash] of GOLDEN) {
      const w = n ? generateWorld(seed, { subdivisions: n }) : world(seed)
      const a = simulateHistory(w, { years, ...opts })
      expect(hashPreOrders(a)).toBe(hash)
      expect(hashAll(a)).toBe(hashAll(simulateHistory(w, { years, ...opts, orders: [] })))
      expect('orders' in a).toBe(false)
      expect('orderOutcomes' in a).toBe(false)
      expect(a.events.some((e) => isOurs(e.type))).toBe(false)
    }
  }, 400_000)

  it('with orders: deterministic, nothing changes before the first order, resumable in 50-year chunks', () => {
    const w = world(3)
    const orders = ordersOf3()
    expect(orders.length).toBeGreaterThanOrEqual(4)
    const a = simulateHistory(w, { years: 1100, orders })
    expect(hashAll(simulateHistory(w, { years: 1100, orders }))).toBe(hashAll(a))
    // Prefix: before the first order's year, the history is the one without orders, field for field.
    expect(hashPreOrders(simulateHistory(w, { years: 699, orders }))).toBe(hashPreOrders(simulateHistory(w, { years: 699 })))
    // ...and a later order changes nothing before its year: set B (950) on top of set A, up to 949.
    const setA = orders.filter((o) => o.year === 700)
    expect(hashPreOrders(simulateHistory(w, { years: 949, orders }))).toBe(hashPreOrders(simulateHistory(w, { years: 949, orders: setA })))
    // Resumable: 50-year steps (simulateTo, then advanceTo) equal one run; advanceTo to a middle year equals the short run.
    const run = createHistoryRun(w, { orders })
    for (let y = 50; y < 1100; y += 50) run.simulateTo!(y)
    expect(hashAll(run.advanceTo(1100))).toBe(hashAll(a))
    const run2 = createHistoryRun(w, { orders })
    const mid = run2.advanceTo(800)
    expect(hashAll(mid)).toBe(hashAll(simulateHistory(w, { years: 800, orders })))
    expect(hashAll(run2.advanceTo(1100))).toBe(hashAll(a))
    // Applied in year order whatever the list order: the two sets swapped (each set's own order kept) give the same history.
    const swapped = [...orders.filter((o) => o.year === 950), ...setA]
    expect(hashPreOrders(simulateHistory(w, { years: 1100, orders: swapped }))).toBe(hashPreOrders(a))
  }, 400_000)

  it('records an outcome for every order, with events 170-173 telling the story', () => {
    const w = world(3)
    const orders = ordersOf3()
    const late: Order = { year: 5000, kind: OrderKind.Fortify, actor: 0 }
    const bad: Order = { year: 710, kind: OrderKind.War, actor: 99999, target: 0 }
    const all = [...orders, late, bad]
    const h = simulateHistory(w, { years: 1100, orders: all })
    expect(h.orders).toEqual(all)
    const R = h.orderOutcomes as NonNullable<History['orderOutcomes']>
    expect(R.length).toBe(all.length)
    expect(R[all.length - 2].status).toBe(OrderStatus.Pending)
    expect(R[all.length - 1].status).toBe(OrderStatus.Failed)
    expect(R[all.length - 1].reason).toBe(OrderReason.NoActor)
    let fulfilled = 0
    for (let k = 0; k < orders.length; k++) {
      const r = R[k]
      expect(r.status).not.toBe(OrderStatus.Pending)
      const given = h.events.filter((e) => e.type === EventType.OrderGiven && e.value === k)
      expect(given.length).toBe(1)
      expect(given[0].year).toBe(orders[k].year)
      expect(given[0].extra).toBe(orders[k].kind)
      if (r.status === OrderStatus.Active) continue
      expect(r.year).toBeGreaterThanOrEqual(orders[k].year)
      expect(r.year).toBeLessThanOrEqual(orders[k].year + describeOrderKinds()[orders[k].kind].years)
      const type = r.status === OrderStatus.Fulfilled ? EventType.OrderFulfilled : r.status === OrderStatus.Failed ? EventType.OrderFailed : EventType.OrderLapsed
      const ev = h.events.filter((e) => e.type === type && e.value === k)
      expect(ev.length).toBe(1)
      expect(ev[0].year).toBe(r.year)
      if (r.status === OrderStatus.Fulfilled) {
        fulfilled++
        expect(r.acted).toBeGreaterThanOrEqual(0)
        if (orders[k].kind === OrderKind.War || orders[k].kind === OrderKind.Peace) expect(r.product).toBeLessThan(h.wars.count)
        if (orders[k].kind === OrderKind.War) expect(h.wars.startYear[r.product]).toBe(r.year)
        if (orders[k].kind === OrderKind.Peace) expect(h.wars.endYear[r.product]).toBe(r.year)
      }
    }
    expect(fulfilled).toBeGreaterThan(0)
    // Events stay in order of years.
    for (let i = 1; i < h.events.length; i++) expect(h.events[i].year).toBeGreaterThanOrEqual(h.events[i - 1].year)
  }, 400_000)

  it('encodes and decodes order lists as compact URL-safe text', () => {
    const orders: Order[] = [
      { year: 1500, kind: OrderKind.Explore, actor: 3, target: 12345 },
      { year: 1600, kind: OrderKind.War, actor: 7, target: 9 },
      { year: 1200, kind: OrderKind.Fortify, actor: 41 },
      { year: 900, kind: OrderKind.Quarantine, actor: 5 },
    ]
    const text = encodeOrders(orders)
    expect(text).toBe('1500:explore:3:12345;1600:war:7:9;1200:fortify:41;900:quarantine:5')
    expect(encodeURIComponent(text)).toBe(text.replace(/:/g, '%3A').replace(/;/g, '%3B'))
    expect(/^[0-9a-z:;-]*$/.test(text)).toBe(true)
    expect(decodeOrders(text)).toEqual(orders)
    expect(decodeOrders('')).toEqual([])
    expect(encodeOrders([])).toBe('')
    // Junk is skipped: unknown kinds, fractions, a missing target.
    expect(decodeOrders('1500:explore:3;12:nope:1:2;1.5:war:1:2;1600:WAR:7:9;;x')).toEqual([{ year: 1600, kind: OrderKind.War, actor: 7, target: 9 }])
    // Every kind round-trips.
    for (const k of describeOrderKinds()) {
      const o: Order = k.target === OrderRole.None ? { year: 10, kind: k.kind, actor: 2 } : { year: 10, kind: k.kind, actor: 2, target: 4 }
      expect(decodeOrders(encodeOrders([o]))).toEqual([o])
    }
    expect(sortOrders(orders).map((o) => o.year)).toEqual([900, 1200, 1500, 1600])
  })

  it('describes the order kinds and checks feasibility from a History', () => {
    const K = describeOrderKinds()
    expect(K.length).toBe(ORDER_KIND_COUNT)
    K.forEach((k, i) => { expect(k.kind).toBe(i); expect(k.years).toBeGreaterThan(0); expect(k.label.length).toBeGreaterThan(0) })
    expect(new Set(K.map((k) => k.key)).size).toBe(K.length)
    const w = world(3)
    const h = simulateHistory(w, { years: 1100 })
    const orders = ordersOf3()
    for (const o of orders) expect(orderFeasible(h, o, o.year)).toBe(OrderReason.None)
    expect(orderFeasible(h, { year: 700, kind: OrderKind.War, actor: 99999, target: 0 }, 700)).toBe(OrderReason.NoActor)
    expect(orderFeasible(h, { year: 300, kind: OrderKind.Crop, actor: 0, target: 9999 }, 300)).toBe(OrderReason.NoTarget)
    // A people's own founding cell is known to it: nothing to explore there.
    const p0 = h.peoples[0]
    expect(orderFeasible(h, { year: 300, kind: OrderKind.Explore, actor: 0, target: h.settlements[p0.founder].cell }, 300)).toBe(OrderReason.AlreadyDone)
    // Without polities, the polity kinds cannot act.
    const off = simulateHistory(world(3), { years: 200, polities: false })
    expect(orderFeasible(off, { year: 100, kind: OrderKind.War, actor: 0, target: 1 }, 100)).toBe(OrderReason.SystemOff)
    // And the simulation agrees: the order fails at once, with nothing else changed.
    const ho = simulateHistory(world(3), { years: 200, polities: false, orders: [{ year: 100, kind: OrderKind.War, actor: 0, target: 1 }] })
    expect(ho.orderOutcomes?.[0].status).toBe(OrderStatus.Failed)
    expect(ho.orderOutcomes?.[0].reason).toBe(OrderReason.SystemOff)
    expect(hashPreOrders(ho)).toBe(hashPreOrders(off))
  }, 400_000)
})
