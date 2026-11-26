import { describe, expect, it } from 'vitest'
import { liveRuns } from './liveRanges.ts'

function runs(starts: number[], live: number[], maxRuns: number): [number, number][] {
  const out = new Uint32Array(maxRuns * 2)
  const scratch = new Uint32Array(live.length * 2 + 2)
  const r = liveRuns(starts, live, live.length, maxRuns, out, scratch)
  const res: [number, number][] = []
  for (let j = 0; j < r; j++) res.push([out[j * 2], out[j * 2 + 1]])
  return res
}

/** Every index of a live item is covered, nothing is covered twice, and the runs keep their order. */
function covers(starts: number[], live: number[], got: [number, number][]) {
  const drawn = new Set<number>()
  let last = -1
  for (const [s, c] of got) {
    expect(s).toBeGreaterThan(last)
    for (let k = s; k < s + c; k++) {
      expect(drawn.has(k)).toBe(false)
      drawn.add(k)
    }
    last = s + c - 1
  }
  for (let i = 0; i < live.length; i++) if (live[i]) for (let k = starts[i]; k < starts[i + 1]; k++) expect(drawn.has(k)).toBe(true)
}

describe('liveRuns', () => {
  const starts = [0, 6, 12, 18, 18, 30, 36, 60, 66]
  it('finds the runs of live items (empty items do not break a run)', () => {
    expect(runs(starts, [0, 0, 0, 0, 0, 0, 0, 0], 8)).toEqual([])
    expect(runs(starts, [1, 1, 1, 1, 1, 1, 1, 1], 8)).toEqual([[0, 66]])
    expect(runs(starts, [1, 0, 1, 0, 1, 0, 0, 1], 8)).toEqual([[0, 6], [12, 18], [60, 6]])
    expect(runs(starts, [0, 0, 1, 0, 1, 0, 0, 0], 8)).toEqual([[12, 18]])
  })
  it('merges at the smallest gaps down to the cap', () => {
    const live = [1, 0, 1, 0, 1, 0, 0, 1]
    // runs [0,6) [12,30) [60,66), gaps 6 and 30: two runs keep the 30 gap
    const two = runs(starts, live, 2)
    expect(two).toEqual([[0, 30], [60, 6]])
    covers(starts, live, two)
    expect(runs(starts, live, 1)).toEqual([[0, 66]])
  })
  it('covers every live item for random inputs and caps', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296)
    for (let t = 0; t < 200; t++) {
      const n = 1 + Math.floor(rnd() * 60)
      const st = [0]
      for (let i = 0; i < n; i++) st.push(st[i] + Math.floor(rnd() * 4) * 6)
      const live = Array.from({ length: n }, () => (rnd() < 0.3 ? 1 : 0))
      const cap = 1 + Math.floor(rnd() * 8)
      const got = runs(st, live, cap)
      expect(got.length).toBeLessThanOrEqual(cap)
      covers(st, live, got)
    }
  })
})
