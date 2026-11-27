// realism: the scorecard and its ratchet (MASTER-PLAN §2.7). No sim runs: these use the committed baseline rows and synthetic
// rows, so they take milliseconds. The baseline itself is re-recorded by hand (see realismStats.ts's header).
import { describe, expect, it } from 'vitest'
import baselineText from '../../../docs/realism-baseline.jsonl?raw'
import sweepText from '../../../docs/realism-sweep22.jsonl?raw'
import noiseText from '../../../docs/realism-noise.jsonl?raw'
import { miss, parseRows, REALISM_BASELINE, REALISM_SEEDS, REALISM_SWEEP_BASELINE, REALISM_SWEEP_SEEDS, realismCheck, realismNoise, realismScore, REALISM_TOL, REALISM_Z, TARGETS } from './realismStats.ts'

const base = parseRows(baselineText)
const sweep = parseRows(sweepText)
const recorded = (rows: typeof base) => { const s = realismScore(rows); return { score: Number(s.score.toFixed(6)), inRange: s.inRange, total: s.total } }
const target = (k: string): [string, number, number, string] => TARGETS.find((t) => t[0] === k)!

describe('realism baseline', () => {
  it('holds one --boot 0 row per realism seed, with every scored key', () => {
    expect(base.map((r) => r.seed).sort((a, b) => a - b)).toEqual([...REALISM_SEEDS].sort((a, b) => a - b))
    for (const r of base) for (const [k] of TARGETS) expect(k in r, `${k} in seed ${r.seed}`).toBe(true)
    for (const r of base) expect(r['pol.largestPopPeak']).toBeGreaterThanOrEqual(r['pol.largestPop2000'])
  })
  it('REALISM_BASELINE is the score of the committed rows under the current TARGETS (re-record it with any band edit)', () => {
    expect(recorded(base)).toEqual({ score: REALISM_BASELINE.score, inRange: REALISM_BASELINE.inRange, total: REALISM_BASELINE.total })
  })
  it('the 22-seed sweep rows: every sweep seed once, its 4 baseline rows equal to the baseline file, score recorded', () => {
    expect(sweep.map((r) => r.seed)).toEqual(REALISM_SWEEP_SEEDS)
    for (const r of base) expect(JSON.stringify(sweep.find((x) => x.seed === r.seed))).toBe(JSON.stringify(r))
    expect(recorded(sweep)).toEqual({ score: REALISM_SWEEP_BASELINE.score, inRange: REALISM_SWEEP_BASELINE.inRange, total: REALISM_SWEEP_BASELINE.total })
  })
  it('uses the §2.7 bands', () => {
    expect(target('epi.worstNet').slice(1, 3)).toEqual([0.25, 0.6])
    expect(target('epi.plagueWorstNet').slice(1, 3)).toEqual([0.25, 0.6])
    expect(target('epi.worstNet')[3]).toBe('Black Death 30-60%')
    expect(target('pol.largestPop1500').slice(1)).toEqual([0.15, 0.4, 'Han/Rome/Qing peaks 30-37%'])
    expect(target('pol.largestPop2000').slice(1)).toEqual([0.15, 0.4, 'Han/Rome/Qing peaks 30-37%'])
    expect(TARGETS.length).toBe(26)
  })
})

describe('realism ratchet', () => {
  const shift = (k: string, by: number) => base.map((r) => ({ ...r, [k]: r[k] + by }))
  it('passes on identical rows and on a better candidate', () => {
    expect(realismCheck(base, base).ok).toBe(true)
    expect(realismCheck(base, base, 0).ok).toBe(true)
    const better = base.map((r) => ({ ...r, 'war.alpha': 1.53 })) // in band on every seed
    const c = realismCheck(base, better, 0)
    expect(c.ok).toBe(true)
    expect(c.score).toBeLessThanOrEqual(c.base)
  })
  it('fails a WORSE target even inside the score tolerance, unless allowed', () => {
    const w = target('zipf2000.primacy')
    const rows = base.map((r) => ({ ...r, 'zipf2000.primacy': w[2] + 0.3 * (w[2] - w[1]) })) // 0.3 band widths out on every seed
    const c = realismCheck(base, rows, 1)
    expect(c.ok).toBe(false)
    expect(c.worse).toEqual(['zipf2000.primacy'])
    const a = realismCheck(base, rows, 1, ['zipf2000.primacy'])
    expect(a.ok).toBe(true)
    expect(a.allowed).toEqual(['zipf2000.primacy'])
  })
  it('fails when the score rises beyond the tolerance', () => {
    // Many small moves, none WORSE on its own: every in-band Gibrat beta pushed just below its band.
    const rows = shift('gibrat1000.beta', -0.2).map((r, i) => ({ ...r, 'gibrat1500.beta': shift('gibrat1500.beta', -0.2)[i]['gibrat1500.beta'] }))
    const c = realismCheck(base, rows, 0, ['gibrat1000.beta', 'gibrat1500.beta'])
    expect(c.score).toBeGreaterThan(c.base)
    expect(c.ok).toBe(false)
    expect(realismCheck(base, rows, 1, ['gibrat1000.beta', 'gibrat1500.beta']).ok).toBe(true)
  })
  it('fails when a reference seed has no candidate row', () => {
    const c = realismCheck(base, base.slice(1))
    expect(c.ok).toBe(false)
    expect(c.missing).toEqual([base[0].seed])
  })
  it('with a null ensemble (--noise), a move within the noise is not WORSE; one beyond it is', () => {
    const [k, lo, hi] = target('urb1500.u10'), w = hi - lo
    const at = (m: number, tag?: number) => base.map((r) => ({ ...r, [k]: m === 0 ? (lo + hi) / 2 : hi + m * w, ...(tag === undefined ? {} : { jitter: tag }) }))
    const ref = at(0)
    const noise = [0, 0.3, 0.1, 0.4, 0.2].flatMap((m, j) => at(m, 10001 + j)) // five jitters: member mean misses 0 .. 0.4
    const nz = realismNoise(ref, noise)
    expect(nz.k).toBe(6)
    expect(nz.mean[k]).toBeCloseTo(1 / 6, 9)
    const sd = Math.sqrt([0, 0, 0.3, 0.1, 0.4, 0.2].reduce((s, x) => s + (x - 1 / 6) ** 2, 0) / 5)
    expect(nz.sd[k]).toBeCloseTo(sd, 9)
    expect(nz.thr[k]).toBeCloseTo(REALISM_Z * sd * Math.sqrt(1 + 1 / 6), 9)
    const within = at(0.35) // +0.35 band widths: WORSE against the single reference, inside the null spread
    expect(realismCheck(ref, within, 1).worse).toEqual([k])
    const c = realismCheck(ref, within, 1, [], noise)
    expect(c.worse).toEqual([])
    expect(c.ok).toBe(true)
    expect(c.report).toContain('within null noise')
    const beyond = realismCheck(ref, at(1.2), 1, [], noise) // far past null mean + 3 sd
    expect(beyond.worse).toEqual([k])
    expect(beyond.ok).toBe(false)
    // An incomplete jitter group (a seed missing) is not a member; without members the rule is the plain one.
    expect(realismNoise(ref, at(0.3, 7).slice(1)).k).toBe(1)
    expect(realismCheck(ref, within, 1, [], []).worse).toEqual([k])
  })
  it('the committed null ensemble (docs/realism-noise.jsonl): 12 complete jitter groups on the realism seeds; the old rule flags pure noise, the noise rule mostly not', () => {
    const noise = parseRows(noiseText)
    const nz = realismNoise(base, noise)
    expect(nz.k).toBe(13)
    const tags = [...new Set(noise.map((r) => r.jitter))]
    let oldFail = 0, newFail = 0
    for (const t of tags) {
      const cand = noise.filter((r) => r.jitter === t)
      if (!realismCheck(base, cand).ok) oldFail++
      if (!realismCheck(base, cand, REALISM_TOL, [], noise.filter((r) => r.jitter !== t)).ok) newFail++
    }
    expect(oldFail).toBeGreaterThanOrEqual(11) // (nearly) every null perturbation fails the single-reference ratchet: 12/12 on the 8cabf09 ensemble, 11/12 on the realistic one (2026-11-27)
    expect(newFail).toBeLessThanOrEqual(2) // leave-one-out against the other 11
  })
  it('with a null ensemble, the score tolerance widens to REALISM_Z score sds around the ensemble mean', () => {
    const [k, lo, hi] = target('urb1500.u10'), w = hi - lo
    const at = (m: number, tag?: number) => base.map((r) => ({ ...r, [k]: m === 0 ? (lo + hi) / 2 : hi + m * w, ...(tag === undefined ? {} : { jitter: tag }) }))
    const noise = [0.5, 1, 1.5].flatMap((m, j) => at(m, 20001 + j))
    const nz = realismNoise(at(0), noise)
    const c = realismCheck(at(0), at(0), 0, [k], noise)
    expect(c.base).toBeCloseTo(nz.score.mean, 12)
    expect(c.tol).toBeCloseTo(REALISM_Z * nz.score.sd, 12)
    expect(c.ok).toBe(true)
  })
  it('miss is 0 inside the band, in band widths outside, capped at 2, NaN as 2', () => {
    expect(miss(0.5, 0, 1)).toBe(0)
    expect(miss(1.5, 0, 1)).toBe(0.5)
    expect(miss(-9, 0, 1)).toBe(2)
    expect(miss(NaN, 0, 1)).toBe(2)
  })
})
