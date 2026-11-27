// seat-mode step 5: the seat follows history (seat/system.ts) and changes nothing else.
import { describe, expect, it } from 'vitest'
import { EventType, SeatEnd, SeatKind } from '../../../contract.ts'
import type { History, World } from '../../../contract.ts'
import { generateWorld, simulateHistory } from '../../index.ts'
import { hashWithout } from './hashing.ts'

const worlds = new Map<number, World>()
const world = (seed: number): World => { let w = worlds.get(seed); if (!w) { w = generateWorld(seed); worlds.set(seed, w) } return w }
const isSeat = (t: number): boolean => t >= 270 && t <= 279
const seatEvents = (h: History) => h.events.filter((e) => isSeat(e.type))

describe('seat resolution (seat-mode §3.4)', () => {
  it('seat on, no orders: every field but History.seat and events 270-279 is the run without a seat', () => {
    const off = simulateHistory(world(1), { years: 1200 })
    for (const seat of [{ kind: SeatKind.Polity, id: 11, from: 1100 }, { kind: SeatKind.House, id: 19, from: 1050, ambitions: [0, 1, 3, 4] }, { kind: SeatKind.People, id: 0, from: 900 }] as const) {
      const on = simulateHistory(world(1), { years: 1200, seat: { ...seat, ambitions: 'ambitions' in seat ? [...seat.ambitions] : undefined } })
      expect(hashWithout(on, ['seat'], isSeat)).toBe(hashWithout(off, [], isSeat))
      expect(off.events.some((e) => isSeat(e.type))).toBe(false)
      expect('seat' in off).toBe(false)
      const S = on.seat!
      expect(S.polityAt.length).toBe(1200 - seat.from + 1)
      const taken = seatEvents(on).filter((e) => e.type === EventType.SeatTaken)
      expect(taken.length).toBe(1)
      expect(taken[0].year).toBe(seat.from)
    }
  }, 600_000)

  it('a Polity seat passes to its house\'s other throne when its realm ends (seed 1: polity 11, 1174)', () => {
    const h = simulateHistory(world(1), { years: 1200, seat: { kind: SeatKind.Polity, id: 11, from: 1100 } })
    const S = h.seat!
    expect(S.polityAt[0]).toBe(11)
    const passed = seatEvents(h).filter((e) => e.type === EventType.SeatPassed)
    expect(passed.length).toBeGreaterThanOrEqual(1)
    expect(passed[0].year).toBe(1174)
    expect(S.lostYear).toBe(-1)
    const q = passed[0].value
    expect(S.polityAt[1174 - 1100]).toBe(q)
    // the new realm is ruled by the same house as polity 11's last ruler
    const last = h.rulers.filter((r) => r.polity === 11).pop()!
    expect(h.rulers.some((r) => r.polity === q && r.dynasty === last.dynasty && r.acceded <= 1174 && (r.ended < 0 || r.ended >= 1174))).toBe(true)
  }, 300_000)

  it('a Polity seat is lost when its realm is conquered with no throne of the house left (seed 42: polity 5, 942)', () => {
    const h = simulateHistory(world(42), { years: 960, seat: { kind: SeatKind.Polity, id: 5, from: 900 } })
    const S = h.seat!
    expect(S.lostYear).toBe(942)
    const lost = seatEvents(h).filter((e) => e.type === EventType.SeatLost)
    expect(lost.length).toBe(1)
    expect(lost[0].extra).toBe(SeatEnd.Conquered)
    expect(S.polityAt[960 - 900]).toBe(-1)
    // nothing after the seat is lost
    expect(seatEvents(h).filter((e) => e.year > 942).length).toBe(0)
  }, 300_000)

  it('a House seat follows the house from throne to throne', () => {
    const h = simulateHistory(world(1), { years: 1200, seat: { kind: SeatKind.House, id: 19, from: 1050 } })
    const S = h.seat!
    const held = new Set([...S.polityAt].filter((p) => p >= 0))
    expect(held.has(20) || held.has(11)).toBe(true)
    for (let y = 1050; y <= 1200; y++) {
      const p = S.polityAt[y - 1050]
      if (p < 0) continue
      expect(h.rulers.some((r) => r.polity === p && r.dynasty === 19 && r.acceded <= y && (r.ended < 0 || r.ended >= y))).toBe(true)
    }
  }, 300_000)
})
