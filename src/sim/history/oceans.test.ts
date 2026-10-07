// oceans: wide oceans wait for the seafaring ideas (oceans.ts).

import { describe, expect, it } from 'vitest'
import { generateWorld, simulateHistory } from '../index.ts'
import { runHistory } from './index.ts'
import type { HistoryState } from './state.ts'
import { OCEAN, oceanGaps, oceanReach } from './oceans.ts'

/** Contact networks among the peoples alive at the history's last snapshot (union of contactYear pairs). */
function networks(h: ReturnType<typeof simulateHistory>): number {
  const P = h.peoples.length, S = h.settlements.length, q = h.snapshotCount - 1
  const alive = new Uint8Array(P)
  for (let i = 0; i < S; i++) if (h.population[q * S + i] > 0) alive[h.settlements[i].people] = 1
  const par = Array.from({ length: P }, (_, i) => i)
  const find = (x: number): number => (par[x] === x ? x : (par[x] = find(par[x])))
  for (let a = 0; a < P; a++) for (let b = a + 1; b < P; b++) if (h.contactYear[a * P + b] >= 0) par[find(a)] = find(b)
  const roots: number[] = []
  for (let p = 0; p < P; p++) if (alive[p] && !roots.includes(find(p))) roots.push(find(p))
  return roots.length
}

describe('oceans', () => {
  it('measures the open-ocean gap from the shallows, and a reach that grows with the seafaring ideas', () => {
    let state: HistoryState | null = null
    const w = generateWorld(42)
    runHistory(w, { years: 1500 }, (s) => { if (s.year === 1500) state = s })
    const s = state as unknown as HistoryState
    const T = s.terrain
    const gap = oceanGaps(s)
    expect(oceanGaps(s)).toBe(gap) // (once per terrain)
    const { neighborOffsets: off, neighbors: nb } = w.grid
    let deep = 0
    for (let i = 0; i < T.cellCount; i++) {
      if (!T.deep[i]) { expect(gap[i]).toBe(0); continue }
      deep++
      expect(gap[i]).toBeGreaterThanOrEqual(T.cellScale)
      // (one more than its nearest neighbour toward the shallows)
      let m = Infinity
      for (let k = off[i]; k < off[i + 1]; k++) m = Math.min(m, gap[nb[k]])
      expect(gap[i]).toBeCloseTo(m + T.cellScale, 5)
    }
    expect(deep).toBeGreaterThan(0)
    // Reach: at least OCEAN.base for every people; more with the keel and compass held; never below base.
    for (let p = 0; p < s.know.P; p++) expect(oceanReach(s, p)).toBeGreaterThanOrEqual(OCEAN.base)
    const ix = s.ideas!
    const p0 = 0
    const saved = ix.held.slice()
    ix.held.fill(0, p0 * ix.I, (p0 + 1) * ix.I)
    const bare = oceanReach(s, p0)
    expect(bare).toBeCloseTo(OCEAN.base, 5)
    ix.held.fill(1, p0 * ix.I, (p0 + 1) * ix.I)
    expect(oceanReach(s, p0)).toBeGreaterThan(bare)
    ix.held.set(saved)
  }, 120_000)

  it('a wide ocean keeps a continent apart past 2000 in some worlds; small seas are crossed', () => {
    // (seed 12: its cradle landmasses are joined only across 5 cells of open ocean; seed 42: across 1)
    expect(networks(simulateHistory(generateWorld(12), { years: 2000 }))).toBeGreaterThan(1)
    expect(networks(simulateHistory(generateWorld(42), { years: 2000 }))).toBe(1)
  }, 300_000)
})
