// Determinism guard (lane/ci-determinism): the sim's results must not depend on the engine. Math.pow (and `**`) changed
// between Node 22 and Node 25 (V8 moved Math.pow to std::pow), and G0 realistic seed 1 went 086a0ba67ed15ca6 -> 0e20763885721f5f
// on CI. powD (detMath.ts) is V8 12.4's pow in plain JS: these values were recorded with Math.pow on Node 22, and the test
// passes on any engine. The scan below keeps raw pow / `**` out of the sim, and freezes the other transcendental calls.
import { describe, expect, it } from 'vitest'
import { powD } from './detMath.ts'

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

  // Other transcendental functions: none in src/sim/history (the sim's rule: + - * / sqrt floor; history/index.ts). The
  // language modules' calls below predate this guard. They agree between Node 22 and Node 25 (200k inputs each, tools of
  // lane/ci-determinism) but an engine is free to change them as V8 changed pow: port them to detMath.ts before adding more.
  // A new call fails here; removing one means lowering its count.
  const FROZEN: Record<string, number> = {
    './history/why.ts': 1, // log2 (the Why panel's records; causes, dramatic only)
    './names/contact.ts': 2,
    './names/drift.ts': 1,
    './names/languageTree.ts': 4,
    './names/lexicon.ts': 5,
    './names/liveDrift.ts': 1,
    './names/script/glyphs.ts': 1,
    './names/typology/profile.ts': 6,
  }
  it('no new exp, log or trig calls in the sim (frozen list)', () => {
    const got: Record<string, number> = {}
    for (const [f, src] of replay) {
      const n = (code(src).match(/\bMath\.(exp|expm1|log|log2|log10|log1p|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|cbrt|hypot)\b/g) ?? []).length
      if (n) got[f] = n
    }
    expect(got).toEqual(FROZEN)
  })
})
