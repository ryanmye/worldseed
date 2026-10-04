// Tests for gradual knowledge after contact (knowledgeSpread.ts), frontier settlement (frontier.ts)
// and where discoveries happened (Discovery events' `other`).

import { describe, expect, it } from 'vitest'
import { EventType, JourneyKind } from '../../contract.ts'
import type { World } from '../../contract.ts'
import { generateWorld } from '../index.ts'
import { runHistory } from './index.ts'
import type { HistoryRun } from './index.ts'
import { Place } from './exploration.ts'
import { EXPLORE } from './params.ts'

const SEEDS = [1, 2, 3, 42, 1337, 2024, 31337, 77, 99999, 123456]

const worlds = new Map<number, World>()
function world(seed: number): World {
  let w = worlds.get(seed)
  if (!w) { w = generateWorld(seed); worlds.set(seed, w) }
  return w
}
const runs = new Map<number, HistoryRun>()
function run(seed: number): HistoryRun {
  let r = runs.get(seed)
  if (!r) { r = runHistory(world(seed)); runs.set(seed, r) }
  return r
}

describe('discoveries', () => {
  it('carry the cell reached, on or beside the way of the expedition that made them', () => {
    let total = 0
    for (const seed of SEEDS) {
      const w = world(seed)
      const { history: h, diag } = run(seed)
      const N = w.grid.cellCount
      const { neighborOffsets: off, neighbors: nb } = w.grid
      const J = h.journeys
      const disc = h.events.filter((e) => e.type === EventType.Discovery)
      expect(disc.length).toBe((diag.discoveryCell ?? []).length)
      for (let i = 0; i < disc.length; i++) {
        const e = disc[i]
        const c = e.other
        if (!(Number.isInteger(c) && c >= 0 && c < N)) throw new Error(`seed ${seed}: Discovery ${i} has cell ${c}`)
        // The expedition's journey: sent from e.settlement, arriving that year. Poles, the summit and the desert heart
        // are on or beside its way; a landmass too unless it was only sighted (then within the sight margin).
        const reach = (diag.discoveryKind ?? [])[i] === Place.Landmass ? Math.max(1, Math.round((EXPLORE.margin * Math.sqrt((N - 2) / 10)) / 48)) : 1
        let found = false
        for (let j = 0; j < J.count && !found; j++) {
          if (J.kind[j] !== JourneyKind.Expedition || J.from[j] !== e.settlement || J.arriveYear[j] !== e.year) continue
          let ring = new Set<number>()
          for (let k = J.pathOffsets[j]; k < J.pathOffsets[j + 1]; k++) ring.add(J.path[k])
          if (ring.has(c)) found = true
          for (let d = 0; d < reach && !found; d++) {
            const next = new Set<number>(ring)
            for (const p of ring) for (let q = off[p]; q < off[p + 1]; q++) next.add(nb[q])
            ring = next
            if (ring.has(c)) found = true
          }
        }
        if (!found) throw new Error(`seed ${seed}: Discovery ${i} (year ${e.year}) at cell ${c}, not on or beside its expedition's way`)
        total++
      }
    }
    expect(total).toBeGreaterThan(5)
  }, 120_000)
})
