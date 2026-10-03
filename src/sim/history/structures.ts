// Structures: ports and dams.
//
// Ports: a coastal settlement of PORT.pop people builds one with a yearly
// chance. Its owner fishes its coastal fields better (food system), its
// emigrants sail cheaper and further (migration), and coastal sites within
// PORT.range sea hops of any port attract founders.
//
// Dams: a town on (or beside) a sizeable river, in a dry place or after a
// recent famine, may dam a river cell at or upstream of itself (never at the
// mouth), choosing the site that irrigates the most farmland downstream net of
// the farmland its reservoir drowns. Irrigation raises the farm capacity of
// the river cells below the dam (and their land neighbours at half strength)
// for whoever farms them, most in dry land; the owner's bad harvests are
// damped. Both fall out of use when the owner is abandoned (state.abandon),
// or when it shrinks below `keep` of the size needed to build them (silted
// harbour, broken canals); a settlement that grows again may rebuild.
//
// Decisions draw from the 'history-structures' stream.

import { Biome, RIVER_FLOW_THRESHOLD, StructureType } from '../../contract.ts'
import { DAM, PORT } from './params.ts'
import { refreshCapacity } from './land.ts'
import type { HistoryState } from './state.ts'
import { build, loseStructure } from './state.ts'

/** A step count given at n = 48, at this grid's resolution (at least 1). */
function hops(s: HistoryState, at48: number): number {
  return Math.max(1, Math.round((at48 * s.terrain.n) / 48))
}

/** Irrigation strength on cell j: DAM.irrigation * (0.3 + 0.7 * aridity). */
function irrigationAt(s: HistoryState, j: number): number {
  return DAM.irrigation * (0.3 + 0.7 * s.terrain.aridity[j])
}

/** True when cell j already carries a dam in use. */
function dammed(s: HistoryState, j: number): boolean {
  for (const st of s.structures) if (st.type === StructureType.Dam && st.lostYear < 0 && st.cell === j) return true
  return false
}

/** Best dam cell for settlement `id`, or -1. */
function damSite(s: HistoryState, id: number): number {
  const T = s.terrain
  const w = s.world
  const { riverTo, flow, lake } = w
  const { neighborOffsets: off, neighbors: nb } = w.grid
  const c = s.cell[id]
  const upMax = hops(s, DAM.upHops)
  const reach = hops(s, DAM.reach)
  const minFlow = DAM.minFlow * RIVER_FLOW_THRESHOLD
  let best = -1
  let bestValue = 0
  for (let k = T.catchOff[c]; k < T.catchBase[c]; k++) {
    const j = T.catchCell[k]
    if (!T.river[j] || lake[j] || flow[j] < minFlow) continue
    const to = riverTo[j]
    if (to < 0 || T.sea[to]) continue // not at the mouth
    // At or upstream of the settlement (or of a cell beside it).
    let ok = false
    let q = j
    for (let step = 0; step <= upMax && q >= 0 && !ok; step++) {
      if (q === c) ok = true
      else for (let e = off[c]; e < off[c + 1]; e++) if (nb[e] === q) { ok = true; break }
      q = riverTo[q]
    }
    if (!ok || dammed(s, j)) continue
    let value = -DAM.reservoirLoss * T.capFarm[j]
    q = to
    for (let step = 0; step < reach && q >= 0 && !T.sea[q]; step++) {
      value += T.capFarm[q] * irrigationAt(s, q)
      q = riverTo[q]
    }
    if (value > bestValue) { bestValue = value; best = j }
  }
  return best
}

/** System: settlements build ports and dams; derived fields are rebuilt when structures change. */
export function structureSystem(s: HistoryState, scratch: Float64Array, ps: PortSearch): void {
  const T = s.terrain
  const rng = s.rngStructures
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const p = s.pop[id]
    const c = s.cell[id]
    if (s.port[id] >= 0 && p < PORT.keep * PORT.pop) loseStructure(s, s.port[id])
    if (s.dam[id] >= 0 && p < DAM.keep * DAM.pop) loseStructure(s, s.dam[id])
    if (s.port[id] < 0 && p >= PORT.pop && T.seaCoast[c]) {
      if (rng.next() < PORT.chance) {
        build(s, id, StructureType.Port, c)
        markPortReach(s, ps, [c]) // a new port only adds reach
      }
    }
    if (s.dam[id] < 0 && p >= DAM.pop) {
      const risk = T.aridity[c] + (s.year - s.lastFamine[id] <= DAM.famineMemory ? DAM.famineRisk : 0)
      if (risk > 0 && rng.next() < DAM.chance * risk) {
        const j = damSite(s, id)
        if (j >= 0) build(s, id, StructureType.Dam, j)
      }
    }
  }
  if (s.damsDirty) rebuildIrrigation(s, scratch)
  if (s.portsDirty) rebuildPortReach(s, ps)
}

/** Recomputes farm multipliers from the dams in use, then effective capacity. */
export function rebuildIrrigation(s: HistoryState, irr: Float64Array): void {
  s.damsDirty = false
  const T = s.terrain
  const { riverTo } = s.world
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const reach = hops(s, DAM.reach)
  const cells = T.landCells
  for (let t = 0; t < cells.length; t++) irr[cells[t]] = 0
  for (const st of s.structures) {
    if (st.type !== StructureType.Dam || st.lostYear >= 0) continue
    let q = riverTo[st.cell]
    for (let step = 0; step < reach && q >= 0 && !T.sea[q]; step++) {
      const g = irrigationAt(s, q)
      if (T.capacity[q] > 0 && g > irr[q]) irr[q] = g // (lakes on the way carry water but grow nothing)
      for (let e = off[q]; e < off[q + 1]; e++) {
        const j = nb[e]
        if (T.capacity[j] <= 0) continue
        const h = 0.5 * irrigationAt(s, j)
        if (h > irr[j]) irr[j] = h
      }
      q = riverTo[q]
    }
  }
  for (let t = 0; t < cells.length; t++) s.farmMul[cells[t]] = 1 + irr[cells[t]]
  for (const st of s.structures) {
    if (st.type === StructureType.Dam && st.lostYear < 0) s.farmMul[st.cell] *= 1 - DAM.reservoirLoss
  }
  refreshCapacity(s)
}

/** Reusable buffers for the bounded sea search around ports. */
export interface PortSearch {
  queue: Int32Array
  depth: Int32Array
  stamp: Int32Array
  run: number
}

export function createPortSearch(cellCount: number): PortSearch {
  return { queue: new Int32Array(cellCount), depth: new Int32Array(cellCount), stamp: new Int32Array(cellCount), run: 0 }
}

/** Marks coastal land within PORT.range hops of open (non-ice) sea from the given port cells. */
function markPortReach(s: HistoryState, ps: PortSearch, ports: number[]): void {
  const T = s.terrain
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const biome = s.world.biome
  const reach = s.portReach
  const range = hops(s, PORT.range)
  const { queue, depth, stamp } = ps
  const run = ++ps.run
  let head = 0, tail = 0
  for (const p of ports) {
    reach[p] = 1
    for (let e = off[p]; e < off[p + 1]; e++) {
      const j = nb[e]
      if (!T.sea[j] || biome[j] === Biome.Ice || stamp[j] === run) continue
      stamp[j] = run
      depth[j] = 1
      queue[tail++] = j
    }
  }
  while (head < tail) {
    const c = queue[head++]
    const d = depth[c]
    for (let e = off[c]; e < off[c + 1]; e++) {
      const j = nb[e]
      if (!T.sea[j]) {
        if (T.seaCoast[j] && T.habitable[j]) reach[j] = 1
        continue
      }
      if (d >= range || biome[j] === Biome.Ice || stamp[j] === run) continue
      stamp[j] = run
      depth[j] = d + 1
      queue[tail++] = j
    }
  }
}

/** Recomputes which coastal land lies within PORT.range sea hops of a port in use (after a port is lost). */
export function rebuildPortReach(s: HistoryState, ps: PortSearch): void {
  s.portsDirty = false
  s.portReach.fill(0)
  const ports: number[] = []
  for (const st of s.structures) if (st.type === StructureType.Port && st.lostYear < 0) ports.push(st.cell)
  markPortReach(s, ps, ports)
}
