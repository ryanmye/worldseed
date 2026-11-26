import { describe, expect, it } from 'vitest'
import { IDLE_TURN_SECONDS, TOUCH_TURN_SECONDS, turnLimit, turnSpeedFactor } from './idleTurn.ts'

describe('idle turn', () => {
  it('limits the turn on every device unless asked for explicitly', () => {
    expect(turnLimit(false, false)).toBe(IDLE_TURN_SECONDS)
    expect(turnLimit(true, false)).toBe(TOUCH_TURN_SECONDS)
    expect(turnLimit(true, true)).toBe(Infinity)
    expect(turnLimit(false, true)).toBe(Infinity)
    expect(TOUCH_TURN_SECONDS).toBeLessThan(IDLE_TURN_SECONDS)
  })

  it('turns at full speed, then eases to rest at the limit', () => {
    expect(turnSpeedFactor(0, 45)).toBe(1)
    expect(turnSpeedFactor(42.9, 45)).toBe(1)
    expect(turnSpeedFactor(44, 45)).toBeCloseTo(0.5, 6)
    expect(turnSpeedFactor(45, 45)).toBe(0)
    expect(turnSpeedFactor(60, 45)).toBe(0)
    let prev = 1
    for (let t = 43; t <= 45; t += 0.1) {
      const k = turnSpeedFactor(t, 45)
      expect(k).toBeLessThanOrEqual(prev + 1e-12)
      prev = k
    }
  })

  it('never eases an unlimited turn, and copes with a limit shorter than the ease', () => {
    expect(turnSpeedFactor(1e6, Infinity)).toBe(1)
    expect(turnSpeedFactor(0, 1)).toBe(1)
    expect(turnSpeedFactor(0.5, 1)).toBeCloseTo(0.5, 6)
    expect(turnSpeedFactor(1, 0)).toBe(0)
  })
})
