// polities: claims, the land states claim beyond their settlements' own (polity/claims.ts).

import { describe, expect, it } from 'vitest'
import { Biome } from '../../contract.ts'
import type { History, World } from '../../contract.ts'
import { generateWorld, simulateHistory } from '../index.ts'
import { runHistory } from './index.ts'
import type { HistoryState } from './state.ts'
import { POLITY } from './polity/params.ts'

/** Every claim pass of a run: each claimed cell checked against the state of the pass. */
function checkPasses(w: World, years: number): { passes: number; claimed: number; pocket: number } {
  let passes = 0, claimed = 0, pocket = 0
  runHistory(w, { years }, (s: HistoryState) => {
    const ps = s.pol
    if (ps === null || ps.claimYear !== s.year || s.year % POLITY.mapStep !== 0) return
    passes++
    const { cPol, cOwner, cKey, tOwner, polity } = ps
    const off = w.grid.neighborOffsets, nb = w.grid.neighbors
    const held = (c: number): boolean => tOwner[c] >= 0 && s.abandoned[tOwner[c]] < 0
    for (let c = 0; c < w.grid.cellCount; c++) {
      const p = cPol[c]
      if (p < 0) { if (cOwner[c] !== -1) throw new Error(`cell ${c}: claimant member ${cOwner[c]} without a polity`); continue }
      claimed++
      // Land, not ice, nobody's land (never inside another state's, or any settlement's, held land).
      if (w.elevation[c] < 0) throw new Error(`claimed cell ${c} is sea`)
      if (w.biome[c] === Biome.Ice) throw new Error(`claimed cell ${c} is ice`)
      if (held(c)) throw new Error(`claimed cell ${c} is held by ${tOwner[c]} (polity ${polity[tOwner[c]]}), claimed by ${p}`)
      // The claimant member is a living member of the claiming state.
      const o = cOwner[c]
      if (o < 0 || s.abandoned[o] >= 0 || polity[o] !== p) throw new Error(`claimed cell ${c}: member ${o} is not a living member of ${p}`)
      if (ps.pEnded[p] >= 0) throw new Error(`claimed cell ${c}: polity ${p} has ended`)
      if (cKey[c] > 1) { pocket++; continue }
      // A claim by reach: within it (key <= 1), and reached from a cell of the same state with a smaller key or from its held land.
      if (!(cKey[c] >= 0 && cKey[c] <= 1)) throw new Error(`claimed cell ${c}: key ${cKey[c]} beyond the reach`)
      let from = false
      for (let k = off[c]; k < off[c + 1] && !from; k++) {
        const j = nb[k]
        if (w.elevation[j] < 0) continue
        if (held(j) ? polity[tOwner[j]] === p : cPol[j] === p && cKey[j] < cKey[c]) from = true
      }
      if (!from) throw new Error(`claimed cell ${c} (polity ${p}, key ${cKey[c]}) not reached from its state's land`)
    }
    // Pockets: every claimed component of a state touches its held land (or a claim by reach that does).
    const seen = new Uint8Array(w.grid.cellCount)
    for (let c0 = 0; c0 < w.grid.cellCount; c0++) {
      if (cPol[c0] < 0 || cKey[c0] <= 1 || seen[c0]) continue
      const p = cPol[c0]
      const stack = [c0]
      seen[c0] = 1
      let touches = false
      while (stack.length > 0) {
        const c = stack.pop() as number
        for (let k = off[c]; k < off[c + 1]; k++) {
          const j = nb[k]
          if (w.elevation[j] < 0) continue
          if ((held(j) && polity[tOwner[j]] === p) || (cPol[j] === p && cKey[j] <= 1)) touches = true
          if (cPol[j] === p && cKey[j] > 1 && !seen[j]) { seen[j] = 1; stack.push(j) }
        }
      }
      if (!touches) throw new Error(`pocket at ${c0} of polity ${p} touches none of its land`)
    }
  })
  return { passes, claimed, pocket }
}

/** History-level checks of `claimed`: on drawn land only, owner a living member of a state, connected to that state's held land. */
function checkClaimed(w: World, h: History): { claimed: number; held: number; none: number } {
  const L = h.landCells.length, S = h.settlements.length
  expect(h.claimed.length).toBe(h.territory.length)
  const N = w.grid.cellCount
  const idx = new Int32Array(N).fill(-1)
  for (let k = 0; k < L; k++) idx[h.landCells[k]] = k
  const off = w.grid.neighborOffsets, nb = w.grid.neighbors
  let claimed = 0, held = 0, none = 0
  for (let q = 0; q < h.landSnapshotCount; q++) {
    const y = q * h.landInterval
    const sq = y / h.snapshotInterval
    expect(Number.isInteger(sq)).toBe(true)
    const pol = (k: number): number => { const o = h.territory[q * L + k] - 1; return o < 0 ? -1 : h.polity[sq * S + o] }
    for (let k = 0; k < L; k++) {
      const v = h.claimed[q * L + k]
      const o = h.territory[q * L + k] - 1
      if (v !== 0 && v !== 1) throw new Error(`claimed ${v}`)
      if (v === 0) { if (o >= 0) held++; else none++; continue }
      claimed++
      if (o < 0) throw new Error(`claimed cell ${h.landCells[k]} has no owner at ${y}`)
      if (w.biome[h.landCells[k]] === Biome.Ice) throw new Error(`claimed ice at ${y}`)
      const st = h.settlements[o]
      if (!(y >= st.foundedYear && (st.abandonedYear < 0 || y < st.abandonedYear))) throw new Error(`claim of ${o}, not alive at ${y}`)
      if (pol(k) < 0) throw new Error(`claim of ${o}, stateless at ${y}`)
    }
    // Each claimed component (by polity) reaches a held cell of that polity.
    const seen = new Uint8Array(L)
    for (let k0 = 0; k0 < L; k0++) {
      if (h.claimed[q * L + k0] !== 1 || seen[k0]) continue
      const p = pol(k0)
      const stack = [k0]
      seen[k0] = 1
      let touches = false
      while (stack.length > 0) {
        const k = stack.pop() as number
        const c = h.landCells[k]
        for (let i = off[c]; i < off[c + 1]; i++) {
          const j = idx[nb[i]]
          if (j < 0 || pol(j) !== p) continue
          if (h.claimed[q * L + j] === 0) { touches = true; continue }
          if (!seen[j]) { seen[j] = 1; stack.push(j) }
        }
      }
      if (!touches) throw new Error(`claim of polity ${p} at ${y} (cell ${h.landCells[k0]}) cut off from its held land`)
    }
  }
  return { claimed, held, none }
}

describe('claims', () => {
  it('every claim pass: claimed cells are nobody\'s land, within the reach of a living member, or an enclosed pocket', () => {
    const r = checkPasses(generateWorld(42), 1600)
    expect(r.passes).toBeGreaterThan(40)
    expect(r.claimed).toBeGreaterThan(0)
    expect(r.pocket).toBeGreaterThan(0)
    const w = generateWorld(9, { subdivisions: 24 })
    expect(checkPasses(w, 1400).passes).toBeGreaterThan(30)
  }, 240_000)

  it('the claimed layer: drawn land of living members of states, joined to held land; a minority of state land, wilderness remains', () => {
    for (const seed of [42, 7]) {
      const w = generateWorld(seed)
      const h = simulateHistory(w, { years: 2000 })
      const r = checkClaimed(w, h)
      expect(r.claimed).toBeGreaterThan(0)
      // (claims fill out countries; they do not swallow the world)
      expect(r.claimed).toBeLessThan(0.5 * r.held)
      expect(r.none).toBeGreaterThan(0.1 * (r.claimed + r.held + r.none))
    }
  }, 240_000)

  it('switched off with the polities, empty', () => {
    const h = simulateHistory(generateWorld(3), { years: 400, polities: false })
    expect(h.claimed.length).toBe(0)
  }, 60_000)
})
