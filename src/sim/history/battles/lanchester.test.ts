import { describe, expect, it } from 'vitest'
import { lnSqrt } from '../../util.ts'
import { breakTime, resolve } from './lanchester.ts'

/** RK4 of the normalised square law (da/dtau = -d / rs, dd/dtau = -rs a) until a side reaches its break. */
function rk4(x: number, bA: number, bD: number): { winner: number; a: number; d: number; tau: number } {
  const rs = Math.sqrt(x)
  let a = 1, d = 1, t = 0
  const h = 1e-5
  const fa = (_a: number, d_: number) => -d_ / rs
  const fd = (a_: number) => -rs * a_
  for (;;) {
    const k1a = fa(a, d), k1d = fd(a)
    const k2a = fa(a + 0.5 * h * k1a, d + 0.5 * h * k1d), k2d = fd(a + 0.5 * h * k1a)
    const k3a = fa(a + 0.5 * h * k2a, d + 0.5 * h * k2d), k3d = fd(a + 0.5 * h * k2a)
    const k4a = fa(a + h * k3a, d + h * k3d), k4d = fd(a + h * k3a)
    const na = a + (h / 6) * (k1a + 2 * k2a + 2 * k3a + k4a)
    const nd = d + (h / 6) * (k1d + 2 * k2d + 2 * k3d + k4d)
    if (nd <= bD || na <= bA) {
      // linear interpolation to the crossing
      const sD = nd <= bD ? (d - bD) / (d - nd) : 2, sA = na <= bA ? (a - bA) / (a - na) : 2
      const s = Math.min(sD, sA)
      return { winner: sD <= sA ? 0 : 1, a: a + s * (na - a), d: d + s * (nd - d), tau: t + s * h }
    }
    a = na; d = nd; t += h
  }
}

describe('battles: Lanchester core', () => {
  it('lnSqrt matches Math.log on [1e-6, 1e6]', () => {
    for (let k = 0; k <= 1200; k++) {
      const y = Math.pow(10, -6 + (12 * k) / 1200)
      const want = Math.log(y)
      const got = lnSqrt(y)
      expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want)))
    }
  })

  it('resolve agrees with an RK4 integration (winner, losses to 1e-6, tau to 1e-4)', () => {
    for (const x of [0.3, 0.9, 1, 1.1, 4]) {
      for (const [bA, bD] of [[0.8, 0.8], [0.7, 0.85], [0.9, 0.75]]) {
        const xs = (1 - bD * bD) / (1 - bA * bA)
        if (Math.abs(x - xs) < 1e-12) continue // (a dead heat: both break at once)
        // U = 0.5 gives L = 1: x' = x
        const r = resolve(x, xs, bA, bD, 0, 0.5)
        const ode = rk4(x, bA, bD)
        expect(r.winner).toBe(ode.winner)
        if (r.winner === 0) { expect(Math.abs(1 - r.fA - ode.a)).toBeLessThan(1e-6); expect(r.fD).toBeCloseTo(1 - bD, 12) }
        else { expect(Math.abs(1 - r.fD - ode.d)).toBeLessThan(1e-6); expect(r.fA).toBeCloseTo(1 - bA, 12) }
        expect(Math.abs(r.tau - ode.tau)).toBeLessThan(1e-4)
      }
    }
  })

  it('an even fight with x\' = 1.2 and b = 0.8 lasts tau ~ 0.204', () => {
    expect(breakTime(Math.sqrt(1.2), 0.8)).toBeCloseTo(0.204, 2)
    expect(breakTime(1, 0.8)).toBeCloseTo(Math.log(1 / 0.8), 9)
  })

  it('the outcome test with x = r*r, x* = 1 is bitwise today\'s r*r / (r*r + 1)', () => {
    let seed = 12345
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296)
    for (let k = 0; k < 100000; k++) {
      const r = Math.exp(4 * (rnd() - 0.5) * 2)
      const U = rnd()
      const old = U < (r * r) / (r * r + 1)
      const x = r * r
      expect(resolve(x, 1, 0.8, 0.8, 0.15, U).winner === 0).toBe(old)
    }
  })

  it('the winner of the outcome draw is the side the closed form says breaks the other first', () => {
    for (const U of [0.01, 0.2, 0.49, 0.51, 0.8, 0.99]) {
      for (const x of [0.25, 1, 3]) {
        const r = resolve(x, 1, 0.8, 0.8, 0.15, U)
        expect(r.winner === 0).toBe(r.xEff > 1)
        expect(r.fA).toBeGreaterThanOrEqual(0); expect(r.fD).toBeGreaterThanOrEqual(0)
        expect(r.fA).toBeLessThanOrEqual(1); expect(r.fD).toBeLessThanOrEqual(1)
      }
    }
  })
})
