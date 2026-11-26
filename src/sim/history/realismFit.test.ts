// realism: the estimators recover known parameters from synthetic draws (seeded, so deterministic).
import { describe, expect, it } from 'vitest'
import { durations, fitPowerLaw, giZipf, ols, ppml, rng32 } from './realismFit.ts'

const r = rng32(7)
const gauss = (): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())

describe('realismFit', () => {
  it('recovers a Pareto exponent and does not reject it', () => {
    const x = Array.from({ length: 2000 }, () => 10 * Math.pow(1 - r(), -1 / 1.5)) // alpha 2.5
    const f = fitPowerLaw(x, { boot: 40, seed: 1 })!
    expect(f.alpha).toBeGreaterThan(2.4)
    expect(f.alpha).toBeLessThan(2.6)
    expect(f.p).toBeGreaterThan(0.1)
    expect(f.expR).toBeGreaterThan(2) // power law beats the exponential
  })
  it('a fixed xmin gives the Hill estimate', () => {
    const x = Array.from({ length: 5000 }, () => 1000 * Math.pow(1 - r(), -1)) // zeta 1
    const f = fitPowerLaw(x, { xmin: 1000 })!
    expect(f.alpha - 1).toBeCloseTo(1, 1)
    expect(giZipf(x, 500).zeta).toBeGreaterThan(0.85)
  })
  it('regressions recover their coefficients', () => {
    const X = Array.from({ length: 800 }, () => [r() * 5, r() * 3])
    const y = X.map(([a, b]) => Math.exp(1 + 0.8 * a - 1.0 * b + 0.3 * gauss()))
    const p = ppml(y, X), o = ols(y.map(Math.log), X).beta
    expect(p[1]).toBeCloseTo(0.8, 1); expect(p[2]).toBeCloseTo(-1, 1)
    expect(o[1]).toBeCloseTo(0.8, 1); expect(o[2]).toBeCloseTo(-1, 1)
  })
  it('censored exponential mean', () => {
    const d = Array.from({ length: 4000 }, () => -100 * Math.log(1 - r()))
    const c = d.map((v) => Math.min(v, 150)), e = d.map((v) => v < 150)
    const s = durations(c, e)
    expect(s.meanMle).toBeGreaterThan(92); expect(s.meanMle).toBeLessThan(108)
  })
})
