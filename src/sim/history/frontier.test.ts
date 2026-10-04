// Tests for gradual knowledge after contact (knowledgeSpread.ts), frontier settlement (frontier.ts)
// and where discoveries happened (Discovery events' `other`).

import { describe, expect, it } from 'vitest'
import { EventType, JourneyKind } from '../../contract.ts'
import type { World } from '../../contract.ts'
import { generateWorld } from '../index.ts'
import { createRunner, runHistory } from './index.ts'
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

describe('gradual knowledge after contact', () => {
  it('the other people\'s lands become known over decades to centuries, not in the year of contact; faster with trade', () => {
    const share0: number[] = [], crossShare0: number[] = []
    let traders = 0, tradersLearned = 0
    for (const seed of SEEDS) {
      const w = world(seed)
      const h = run(seed).history
      const N = w.grid.cellCount, P = h.peoples.length, R = h.trade.count
      const cradle = h.peoples.map((p) => p.cradle)
      for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) {
        const Y = h.contactYear[a * P + b]
        if (a === b || Y < 0) continue
        // What b knew at contact that a did not know before.
        const cells: number[] = []
        for (let i = 0; i < N; i++) {
          const yb = h.knownYear[b * N + i], ya = h.knownYear[a * N + i]
          if (yb >= 0 && yb <= Y && !(ya >= 0 && ya < Y)) cells.push(i)
        }
        if (cells.length < 50) continue
        const knownBy = (year: number) => cells.filter((c) => { const y = h.knownYear[a * N + c]; return y >= 0 && y <= year }).length / cells.length
        share0.push(knownBy(Y))
        if (cradle[a] !== cradle[b]) crossShare0.push(knownBy(Y))
        // Pairs that came to trade substantially (>= 100 loads a year between them at some trade snapshot) learn most of it within 150 years of that.
        let tStart = -1
        for (let q = Math.ceil(Y / h.tradeInterval); q < h.tradeSnapshotCount && tStart < 0; q++) {
          let v = 0
          for (let r = 0; r < R; r++) {
            const pa = h.settlements[h.trade.a[r]].people, pb = h.settlements[h.trade.b[r]].people
            if ((pa === a && pb === b) || (pa === b && pb === a)) v += h.tradeVolume[q * R + r]
          }
          if (v >= 100) tStart = q * h.tradeInterval
        }
        if (tStart >= 0 && tStart + 150 <= h.years) {
          traders++
          if (knownBy(tStart + 150) >= 0.8) tradersLearned++
        }
      }
    }
    const med = (xs: number[]) => [...xs].sort((x, y) => x - y)[xs.length >> 1]
    expect(share0.length).toBeGreaterThan(50)
    // In the year of contact only what lies near the meeting: a small share, much smaller between cradles.
    expect(med(share0)).toBeLessThan(0.4)
    expect(med(crossShare0)).toBeLessThan(0.15)
    expect(share0.filter((x) => x > 0.95).length).toBeLessThan(0.15 * share0.length)
    // Trading partners come to know most of it.
    expect(traders).toBeGreaterThan(10)
    expect(tradersLearned).toBeGreaterThanOrEqual(0.8 * traders)
  }, 300_000)

  it('knowledge is never lost; the meeting settlements are known at contact; trade routes link settlements known to both', () => {
    let chainSeeds = 0
    for (const seed of SEEDS) {
      const w = world(seed)
      const h = run(seed).history
      const N = w.grid.cellCount, P = h.peoples.length
      const known = (p: number, c: number, year: number) => { const y = h.knownYear[p * N + c]; return y >= 0 && y <= year }
      for (const e of h.events) {
        if (e.type !== EventType.FirstContact) continue
        const a = h.settlements[e.settlement], b = h.settlements[e.other]
        if (!known(a.people, b.cell, e.year) || !known(b.people, a.cell, e.year)) throw new Error(`seed ${seed}: contact in ${e.year} through ${e.settlement} and ${e.other}, not known to each other then`)
      }
      const tr = h.trade
      for (let r = 0; r < tr.count; r++) {
        const a = h.settlements[tr.a[r]], b = h.settlements[tr.b[r]]
        const y = tr.openedYear[r]
        if (!known(a.people, b.cell, y) || !known(b.people, a.cell, y)) throw new Error(`seed ${seed}: route ${r} opened in ${y} between settlements not known to each other's peoples`)
      }
      // Chains: a people knows a settlement of a people it has not met (yet) through a third it had met.
      let chains = 0
      for (let a = 0; a < P && chains === 0; a++) for (let c = 0; c < P && chains === 0; c++) {
        if (a === c) continue
        const met = h.contactYear[a * P + c]
        for (const st of h.settlements) {
          if (st.people !== c) continue
          const y = h.knownYear[a * N + st.cell]
          if (y < 0 || y < st.foundedYear || (met >= 0 && y >= met)) continue
          for (let b = 0; b < P; b++) {
            const ab = h.contactYear[a * P + b], bc = h.contactYear[b * P + c]
            if (b !== a && b !== c && ab >= 0 && ab <= y && bc >= 0 && bc <= y) { chains++; break }
          }
          if (chains > 0) break
        }
      }
      if (chains > 0) chainSeeds++
    }
    expect(chainSeeds).toBeGreaterThanOrEqual(SEEDS.length / 2)
  }, 300_000)

  it('what each people knows only grows, year by year of a run', () => {
    const w = world(42)
    let prev: Int16Array | null = null
    let checks = 0
    createRunner(w, undefined, (s) => {
      if (s.year % 50 !== 0) return
      const k = s.know.known
      if (prev) {
        for (let i = 0; i < k.length; i++) if (prev[i] >= 0 && k[i] !== prev[i]) throw new Error(`year ${s.year}: knownYear[${i}] went from ${prev[i]} to ${k[i]}`)
      }
      prev = k.slice()
      checks++
    }).advance(2000)
    expect(checks).toBe(40)
  }, 300_000)
})

describe('frontier settlement', () => {
  it('land settlers mostly found near, contiguous sites; a few still go far', () => {
    const len: number[] = []
    let land = 0, contig3 = 0, contig5 = 0
    for (const seed of SEEDS) {
      const w = world(seed)
      const h = run(seed).history
      const N = w.grid.cellCount, P = h.peoples.length
      const { neighborOffsets: off, neighbors: nb } = w.grid
      // Settlements ever on each cell, to tell who lived near a site in a given year.
      const onCell = new Map<number, number[]>()
      for (const st of h.settlements) { if (st.outpost) continue; const l = onCell.get(st.cell); if (l) l.push(st.id); else onCell.set(st.cell, [st.id]) }
      const J = h.journeys
      const stamp = new Int32Array(N).fill(-1)
      for (let j = 0; j < J.count; j++) {
        if (J.kind[j] !== JourneyKind.Settlers) continue
        const o0 = J.pathOffsets[j], o1 = J.pathOffsets[j + 1]
        let sea = 0
        for (let k = o0; k < o1; k++) if (w.elevation[J.path[k]] < 0) sea++
        if (sea >= 2) continue // (voyages are unchanged)
        land++
        len.push(o1 - o0 - 1)
        const to = J.to[j], Y = J.arriveYear[j], p = h.settlements[to].people
        // Same people, or a people met by then, within 3 / 5 plain hops of the site.
        const kin = (q: number) => q === p || (h.contactYear[p * P + q] >= 0 && h.contactYear[p * P + q] <= Y)
        const site = h.settlements[to].cell
        let ring = [site], near = -1
        stamp[site] = j
        for (let d = 0; d <= 5 && near < 0; d++) {
          const next: number[] = []
          for (const c of ring) {
            for (const id of onCell.get(c) ?? []) {
              const st = h.settlements[id]
              if (id !== to && st.foundedYear <= Y && (st.abandonedYear < 0 || st.abandonedYear >= Y) && kin(st.people)) near = d
            }
            for (let e = off[c]; e < off[c + 1]; e++) if (stamp[nb[e]] !== j) { stamp[nb[e]] = j; next.push(nb[e]) }
          }
          ring = next
        }
        if (near >= 0 && near <= 3) contig3++
        if (near >= 0) contig5++
      }
    }
    len.sort((a, b) => a - b)
    const share = (f: (x: number) => boolean) => len.filter(f).length / len.length
    expect(land).toBeGreaterThan(5000)
    // Shorter journeys than the old leapfrogging (median 7 cells, a seventh within 3): the first good land reached.
    expect(len[len.length >> 1]).toBeLessThanOrEqual(6)
    expect(share((x) => x <= 3)).toBeGreaterThan(0.18)
    // Some still go far.
    expect(share((x) => x >= 10)).toBeGreaterThan(0.03)
    expect(share((x) => x >= 10)).toBeLessThan(0.2)
    // Foundings contiguous with the settled land of their people or its contacts.
    expect(contig3 / land).toBeGreaterThan(0.83)
    expect(contig5 / land).toBeGreaterThan(0.97)
  }, 300_000)
})

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
  }, 300_000)
})
