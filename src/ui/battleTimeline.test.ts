import { describe, expect, it } from 'vitest'
import { strengthsAt, jitter } from './battleTimeline.ts'
import { breakTime } from '../sim/history/battles/lanchester.ts'

describe('battleTimeline', () => {
  it('strengths follow the square law: x a^2 - d^2 = x - 1', () => {
    for (const x of [0.3, 1, 2.5, 6]) for (const tau of [0, 0.05, 0.1, 0.2]) {
      const [a, d] = strengthsAt(x, tau)
      if (a > 0 && d > 0 && a < 1 && d < 1) expect(x * a * a - d * d).toBeCloseTo(x - 1, 6)
    }
  })
  it('the defenders reach their break at the closed-form break time', () => {
    const x = 2.2, b = 0.8
    const tau = breakTime(Math.sqrt(x), b)
    expect(strengthsAt(x, tau)[1]).toBeCloseTo(b, 6)
  })
  it('jitter is deterministic and in [-1, 1]', () => {
    for (let i = 0; i < 100; i++) { const j = jitter(i, 3); expect(j).toBe(jitter(i, 3)); expect(Math.abs(j)).toBeLessThanOrEqual(1) }
  })
})
