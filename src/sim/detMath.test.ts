// Determinism guard (lane/ci-determinism): the sim's results must not depend on the engine. Math.pow (and `**`) changed
// between Node 22 and Node 25 (V8 moved Math.pow to std::pow), and G0 realistic seed 1 went 086a0ba67ed15ca6 -> 0e20763885721f5f
// on CI. powD (detMath.ts) is V8 12.4's pow in plain JS: these values were recorded with Math.pow on Node 22, and the test
// passes on any engine. The scan below keeps raw pow / `**` out of the sim, and freezes the other transcendental calls.
import { describe, expect, it } from 'vitest'
import { acosD, cosD, expD, hypotD, log2D, logD, powD, sinD } from './detMath.ts'

// [x, y, Math.pow(x, y) on Node 22]
const PINS: [number, number, number][] = [
  [0.9, 4, 0.6561000000000001], // outlaw.ts flushAccounts (TARIFF.smooth): Node 25 gives 0.6561
  [0.9, 5, 0.5904900000000001],
  [0.9, 3, 0.7290000000000001],
  [0.9, 269, 4.911736262754243e-13],
  [0.9, 324, 1.4947654752210201e-15],
  [0.7484354534529793, 1.5292544733221893, 0.6420221027270459],
  [82.65400969269857, 0.75, 27.412455843154486],
  [1.008419406402776, 1303, 55523.500582892935],
  [653.2829270600391, 3.8011021249346877, 50175021295.18701],
  [2147483648.5, -0.5, 0.000021579186435065595],
  [0.5, 1070.3, 6.4e-323], // subnormal result
  [1e-310, 0.37, 1.9952623149688837e-115], // subnormal x
  [-1.5, 7, -17.0859375],
  [-1.5, 8, 25.62890625],
  [-2, 0.5, NaN],
  [2, -1074, 5e-324],
  [1.0000001, 1099511627776, Infinity], // |y| > 2^31
  [0.3, -1.7, 7.742725577066099],
]

describe('detMath', () => {
  it('powD returns what Math.pow returned on Node 22 (pinned values)', () => {
    for (const [x, y, want] of PINS) expect(powD(x, y), `${x} ** ${y}`).toBe(want)
  })

  it('powD over a generated set hashes to the Node 22 value (20000 inputs: integer, large integer and fractional exponents)', () => {
    let s = 2463534242
    const r = (): number => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
    const f = new Float64Array(1), u = new Uint32Array(f.buffer)
    let h = 0x811c9dc5
    for (let i = 0; i < 20000; i++) {
      const c = i % 4, x = c === 0 ? r() * 2 : c === 1 ? 0.5 + r() : c === 2 ? r() * 1000 : r()
      const y = c === 0 ? 1 + Math.floor(r() * 40) : c === 1 ? 10 + Math.floor(r() * 3000) : c === 2 ? (r() - 0.5) * 10 : r() * 3
      f[0] = powD(x, y); h = Math.imul(h ^ u[0], 16777619) >>> 0; h = Math.imul(h ^ u[1], 16777619) >>> 0
    }
    expect(h.toString(16)).toBe('b485ac2f') // (Math.pow on Node 25.9.0 gives abdd86ee)
  })

  it('powD keeps the ECMAScript special cases', () => {
    const v = [0, -0, 1, -1, 2, -2, 0.5, -0.5, 3, -3, Infinity, -Infinity, NaN, 1e-310, 1e308, 2 ** 53]
    for (const x of v) for (const y of v) {
      const want = Math.pow(x, y)
      // (every engine agrees on these: exact or special results)
      const special = Number.isNaN(want) || !Number.isFinite(want) || want === 0 || [0, 1, -1, 2, 0.5].includes(y) || [0, 1, -1, Infinity, -Infinity].includes(x)
      if (special) expect(Object.is(powD(x, y), want), `${x} ** ${y}`).toBe(true)
    }
  })

  it('expD, logD, log2D, sinD, cosD, acosD, hypotD over a generated set hash to Math.* on Node 22 and Node 25', () => {
    // 20000 inputs each (normal ranges, huge-argument trig reduction, subnormals, any bit pattern). The ports were checked
    // bit-exact against Math.* on 1M inputs per function plus edge cases on Node 22.23.5 and 25.9.0 (lane/detmath2,
    // runs/detmath2/tools/cmp.ts); these hashes are Math.* on both.
    let s = 2463534242
    const r = (): number => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
    const f = new Float64Array(1), u = new Uint32Array(f.buffer)
    const wide = (): number => { u[0] = (r() * 4294967296) >>> 0; u[1] = (r() * 4294967296) >>> 0; return f[0] }
    const trig = [() => 2 * Math.PI * r(), () => (r() - 0.5) * 2e6, () => wide(), () => (r() - 0.5) * 1e-7]
    const ins: Record<string, (() => number)[]> = {
      exp: [() => (r() - 0.5) * 1500, () => (r() - 0.5) * 2, () => -r() * 30, () => wide()],
      log: [() => r(), () => 1 - r(), () => r() * 1e6, () => Math.abs(wide())],
      log2: [() => r() * 1000, () => r(), () => 1 + (r() - 0.5) * 1e-5, () => Math.abs(wide())],
      sin: trig,
      cos: trig,
      acos: [() => (r() - 0.5) * 2, () => 1 - r() * 1e-6, () => -1 + r() * 1e-6, () => (r() - 0.5) * 1e-9],
      hypot: [() => (r() - 0.5) * 10, () => wide(), () => (r() - 0.5) * 1e-200, () => r()],
    }
    const fns: [string, (...x: number[]) => number, string][] = [
      ['exp', expD, '4710cc06'], ['log', logD, '8401922d'], ['log2', log2D, 'fb72e84e'], ['sin', sinD, '3c9a39c3'],
      ['cos', cosD, 'd70f99e9'], ['acos', acosD, '53e6724e'], ['hypot', hypotD, '2734eeb6'],
    ]
    for (const [name, fn, want] of fns) {
      let h = 0x811c9dc5
      const g = ins[name]
      for (let i = 0; i < 20000; i++) {
        const x = g[i % 4]()
        f[0] = name === 'hypot' ? (i % 2 ? fn(x, g[(i + 1) % 4](), g[(i + 2) % 4]()) : fn(x, g[(i + 3) % 4]())) : fn(x)
        h = Math.imul(h ^ u[0], 16777619) >>> 0; h = Math.imul(h ^ u[1], 16777619) >>> 0
      }
      expect(h.toString(16), name).toBe(want)
    }
  })

  it('the ports keep the special cases', () => {
    const v = [0, -0, 1, -1, 0.5, -0.5, 2, Infinity, -Infinity, NaN, 5e-324, 1e-310, 1e308, Math.PI, 710, -746]
    for (const x of v) {
      expect(Object.is(expD(x), Math.exp(x)), `exp ${x}`).toBe(true)
      expect(Object.is(logD(x), Math.log(x)), `log ${x}`).toBe(true)
      expect(Object.is(log2D(x), Math.log2(x)), `log2 ${x}`).toBe(true)
      expect(Object.is(sinD(x), Math.sin(x)), `sin ${x}`).toBe(true)
      expect(Object.is(cosD(x), Math.cos(x)), `cos ${x}`).toBe(true)
      expect(Object.is(acosD(x), Math.acos(x)), `acos ${x}`).toBe(true)
      for (const y of v) expect(Object.is(hypotD(x, y), Math.hypot(x, y)), `hypot ${x} ${y}`).toBe(true)
    }
    expect(hypotD()).toBe(0)
    expect(hypotD(NaN, Infinity)).toBe(Infinity)
  })

  // The replay path: every module under src/sim but tests and the measurement modules (*Stats.ts, stats.ts, realismFit.ts),
  // which no replay-path module imports.
  const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const replay = Object.entries(sources).filter(([f]) => !/\.test\.ts$|Stats\.ts$|\/stats\.ts$|\/realismFit\.ts$/.test(f) && f !== './detMath.ts')
  const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')

  it('no Math.pow or ** in the sim (powD instead)', () => {
    expect(replay.length).toBeGreaterThan(150)
    for (const [f, src] of replay) {
      const c = code(src)
      expect(/\bMath\.pow\b/.test(c), `${f}: Math.pow (use powD from src/sim/detMath.ts)`).toBe(false)
      expect(/[\w)\]]\s*\*\*\s*[\w(.-]/.test(c), `${f}: the ** operator (use powD, or x * x)`).toBe(false)
    }
  })

  // Other transcendental functions: none on the replay path. The language modules (names/*) and the Why panel's records
  // (history/why.ts) call the detMath ports (expD, logD, log2D, sinD, cosD, acosD, hypotD) instead; port any other function
  // to detMath.ts (from V8's src/base/ieee754.cc, bit-identical to Node 22 and 25) before using it.
  const FROZEN: Record<string, number> = {}
  it('no exp, log, trig, hypot or cbrt calls in the sim (detMath ports instead)', () => {
    const got: Record<string, number> = {}
    for (const [f, src] of replay) {
      const n = (code(src).match(/\bMath\.(exp|expm1|log|log2|log10|log1p|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|cbrt|hypot)\b/g) ?? []).length
      if (n) got[f] = n
    }
    expect(got).toEqual(FROZEN)
  })
})
