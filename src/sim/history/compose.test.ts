// compose (MASTER-PLAN §2.3): every stack is the 8cabf09 expression with no factors, clamps only the new factors' product,
// skips absent systems (not ×1), and applies player-order factors after the clamp (R33). G0 (hashBase.test.ts) proves the
// wired call sites unchanged.
import { describe, expect, it } from 'vitest'
import {
  c1WarDeclare, c2Grievance, c2RevoltChance, c3Overthrow, c4Reach, c5Growth, c5Harvest, c5Shortfall, c5Supply, c6Peace,
  c7Alliance, c8Tax, c9RateMul, c10Spread,
} from './compose.ts'

describe('compose stacks', () => {
  it('neutral: the 8cabf09 expression verbatim (bit-identical, also for {} with no field set)', () => {
    const xs = [0, 1e-9, 0.012345678901, 0.25, 1, 1.7, 3.3, 12.5]
    for (const a of xs) for (const b of [1, 0.8, 1.25]) {
      expect(Object.is(c1WarDeclare(a, b, 1.5), a * b * 1.5)).toBe(true)
      expect(Object.is(c1WarDeclare(a, b, 1.5, {}), a * b * 1.5)).toBe(true)
      expect(Object.is(c7Alliance(a, b), a * b)).toBe(true)
      expect(Object.is(c7Alliance(a, b, {}), a * b)).toBe(true)
    }
    for (const a of xs) for (const f of [undefined, {}]) {
      expect(c2Grievance(a, f)).toBe(a)
      expect(c2RevoltChance(a, f)).toBe(a)
      expect(c3Overthrow(a, f)).toBe(a)
      expect(c4Reach(a, f)).toBe(a)
      expect(c5Harvest(a, f)).toBe(a)
      expect(c5Supply(a, f)).toBe(a)
      expect(c5Growth(a, f)).toBe(a)
      expect(c5Shortfall(a, f)).toBe(a)
      expect(c6Peace(a, f)).toBe(a)
      expect(c8Tax(a, f)).toBe(a)
      expect(c10Spread(a, f)).toBe(a)
    }
    expect(c9RateMul()).toBe(1)
    expect(c9RateMul({})).toBe(1)
  })

  it('the non-order product is clamped; order factors apply after the clamp (Purge = 0 vetoes)', () => {
    expect(c3Overthrow(0.01, { fin: 100 })).toBeCloseTo(0.04) // clamp 4
    expect(c3Overthrow(0.01, { fin: 100, seat: 0.35 })).toBeCloseTo(0.014) // order after the clamp
    expect(c3Overthrow(0.01, { fin: 0.01, divine: 1.3 })).toBeCloseTo(0.01 * 0.2 * 1.3)
    expect(c3Overthrow(0.01, { fin: 3, seat: 0 })).toBe(0)
    expect(c1WarDeclare(1, 1.2, 1.5, { grudge: 10 })).toBeCloseTo(5 * 1.2 * 1.5) // holy and order outside the clamp
    expect(c1WarDeclare(1.3, 1, 1, { courtWar: 0.9 })).toBeCloseTo(0.9) // court replaces the ruler
    expect(c7Alliance(0.25, 1, { balance: 10, seat: 4 })).toBeCloseTo(0.25 * 4 * 4)
    expect(c4Reach(2, { network: 0.1 })).toBeCloseTo(1)
    expect(c5Growth(0.02, { fertility: 2, faith: 1 })).toBeCloseTo(0.02 * 1.3)
    expect(c5Shortfall(0.5, { relief: 0.1 })).toBeCloseTo(0.15)
    expect(c6Peace(0.1, { decisive: 0.7 })).toBe(0.6)
    expect(c9RateMul({ usury: 5 })).toBe(2)
    expect(c10Spread(0.4, { press: 1.5 })).toBeCloseTo(0.6)
    expect(c2Grievance(0.8, { form: 1.5 })).toBe(1)
    expect(c2RevoltChance(0.06, { riotsMu: 0.9 })).toBe(0.5)
    expect(c5Harvest(0.6, { feed: true, divine: 1.15, max: 1.1 })).toBeCloseTo(1.1)
  })
})
