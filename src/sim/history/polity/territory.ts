// polities: territory and the settlement graph (design 3).
//
// Map pass (every POLITY.mapStep years): one multi-source travel-cost search (Dijkstra over s.moveCost,
// roads included) from every living settlement over land (lakes included, never sea), each source out
// to its own radius (larger for larger places). Every cell reached belongs to the settlement that got
// there cheapest (ties by visit order); cells beyond every radius are nobody's: wilderness between
// states. Borders are then a pure function of membership: a cell's polity is its owner's polity.
//
// Settlement graph (rebuilt in the same pass): owners of neighbouring cells are linked at the cost of
// their cheapest crossing (tDist + tDist + half the two cells' move costs); open trade routes crossing
// at least two sea cells link their ends at the route's cost times POLITY.seaArmy (armies cost more
// than freight); a colony founded over the sea keeps a link to its mother town. Between passes a new
// settlement is linked to the owner of its cell (or to its parent). Edges to abandoned settlements are
// skipped wherever the graph is read.

import { TRADE } from '../params.ts'
import { MIGRATION } from '../params.ts'
import { TechField } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import { Heap } from '../heap.ts'
import type { HistoryState } from '../state.ts'
import { techOf } from '../state.ts'
import type { TradeState } from '../trade.ts'
import { DANGER, POLITY } from './params.ts'
import type { PolityState } from './state.ts'

/** Bucket width of the map search in cell units (below the cheapest step: a road along a coastal river, about 0.39). */
const BUCKET = 0.25
const buckets: Int32Array[] = []
let bucketLen = new Int32Array(0)

/** Army travel cost along a cell path from settlement a to b (land at move cost; sea legs as freight would pay, times seaArmy). Also returns sea cells in seaCount. */
let seaCount = 0
export function armyPathCost(s: HistoryState, path: readonly number[], a: number, b: number): number {
  const T = s.terrain
  const pa = s.port[a] >= 0, pb = s.port[b] >= 0
  const seaMul = 0.5 * ((pa ? TRADE.seaPort : TRADE.seaNoPort) + (pb ? TRADE.seaPort : TRADE.seaNoPort))
  const sf = 0.5 * (techOf(s, a, TechField.Seafaring) + techOf(s, b, TechField.Seafaring))
  const oc = (MIGRATION.oceanCost * T.cellScale) / Math.sqrt(sf)
  const ocean = 0.5 * oc * ((pa ? TRADE.oceanPort : TRADE.oceanNoPort) + (pb ? TRADE.oceanPort : TRADE.oceanNoPort))
  let cost = 0, sea = 0
  for (let k = 1; k < path.length; k++) {
    const j = path[k]
    if (T.sea[j]) { sea++; cost += (T.deep[j] ? ocean : T.moveCost[j] * seaMul) * POLITY.seaArmy }
    else cost += s.moveCost[j]
  }
  seaCount = sea
  return cost
}

function ensureGraph(ps: PolityState, count: number): void {
  while (ps.gNb.length < count) { ps.gNb.push([]); ps.gCost.push([]) }
}

/** Adds (or cheapens) the edge between settlements a and b. */
export function addEdge(ps: PolityState, a: number, b: number, cost: number): void {
  if (a === b) return
  ensureGraph(ps, (a > b ? a : b) + 1)
  const na = ps.gNb[a]
  for (let k = 0; k < na.length; k++) {
    if (na[k] !== b) continue
    if (cost < ps.gCost[a][k]) {
      ps.gCost[a][k] = cost
      const nb = ps.gNb[b]
      for (let q = 0; q < nb.length; q++) if (nb[q] === a) { ps.gCost[b][q] = cost; break }
    }
    return
  }
  na.push(b); ps.gCost[a].push(cost)
  ps.gNb[b].push(a); ps.gCost[b].push(cost)
}

/** The map pass: territory per cell, the settlement graph and the border cells. */
export function mapPass(s: HistoryState, ps: PolityState, ts: TradeState, heap: Heap): void {
  const T = s.terrain
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const { tOwner, tDist } = ps
  const moveCost = s.moveCost
  tOwner.fill(-1)
  void heap
  // Multi-source Dijkstra with a bucket queue (Dial): buckets narrower than the cheapest step, so a cell is
  // final when its bucket comes up; cells within a bucket in the order reached.
  const radius = ps.scratchF
  const living = s.living
  const r0 = POLITY.mapR0 * T.cellScale, r1 = POLITY.mapR1 * T.cellScale
  const inv = 1 / (BUCKET * T.cellScale)
  const nB = Math.floor((r0 + r1) * inv) + 2
  while (buckets.length < nB) buckets.push(new Int32Array(64))
  if (bucketLen.length < nB) bucketLen = new Int32Array(nB)
  bucketLen.fill(0)
  const push = (c: number, d: number): void => {
    const b = Math.floor(d * inv)
    let arr = buckets[b]
    const n = bucketLen[b]
    if (n === arr.length) { const x = new Int32Array(n * 2); x.set(arr); buckets[b] = arr = x }
    arr[n] = c
    bucketLen[b] = n + 1
  }
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    radius[id] = r0 + r1 * smoothstep(POLITY.mapPopLow, POLITY.mapPopHigh, s.pop[id])
    const c = s.cell[id]
    tOwner[c] = id
    tDist[c] = 0
    push(c, 0)
  }
  const sea = T.sea
  for (let b = 0; b < nB; b++) {
    for (let i = 0; i < bucketLen[b]; i++) {
      const c = buckets[b][i]
      const d = tDist[c]
      if (Math.floor(d * inv) !== b) continue // (improved since: queued again further down)
      const a = tOwner[c]
      const r = radius[a]
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (sea[j]) continue
        const nd = d + moveCost[j]
        if (nd > r) continue
        if (tOwner[j] >= 0 && nd >= tDist[j]) continue
        tOwner[j] = a
        tDist[j] = nd
        push(j, nd)
      }
    }
  }
  // Land edges between owners of neighbouring cells, at the cheapest crossing; border cells (one entry per cell and other owner).
  const S = s.count
  const gNb: number[][] = [], gCost: number[][] = []
  for (let id = 0; id < S; id++) { gNb.push([]); gCost.push([]) }
  const add = (a: number, b: number, cost: number): void => {
    const na = gNb[a]
    for (let k = 0; k < na.length; k++) {
      if (na[k] !== b) continue
      if (cost < gCost[a][k]) {
        gCost[a][k] = cost
        const nbb = gNb[b]
        for (let q = 0; q < nbb.length; q++) if (nbb[q] === a) { gCost[b][q] = cost; break }
      }
      return
    }
    na.push(b); gCost[a].push(cost)
    gNb[b].push(a); gCost[b].push(cost)
  }
  const bc: number[] = [], bo: number[] = []
  const cells = ps.landCells
  // (one pass: borders of owned cells; for unowned ones, the wilderness fringe that takes its owners' danger)
  const fc: number[] = [], fo: number[] = [0], fw: number[] = []
  const cellZ = ps.cellZ, wild = DANGER.wild
  for (let t = 0; t < cells.length; t++) {
    const c = cells[t]
    const a = tOwner[c]
    if (a < 0) {
      cellZ[c] = wild
      const start = fw.length
      for (let k = off[c]; k < off[c + 1]; k++) {
        const b = tOwner[nb[k]]
        if (b < 0) continue
        let dup = false
        for (let q = start; q < fw.length; q++) if (fw[q] === b) { dup = true; break }
        if (!dup) fw.push(b)
      }
      if (fw.length > start) { fc.push(c); fo.push(fw.length) }
      continue
    }
    const start = bo.length
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      const b = tOwner[j]
      if (b < 0 || b === a) continue
      let dup = false
      for (let q = start; q < bo.length; q++) if (bo[q] === b) { dup = true; break }
      if (!dup) { bc.push(c); bo.push(b) }
      if (b < a) continue
      add(a, b, tDist[c] + tDist[j] + 0.5 * (moveCost[c] + moveCost[j]))
    }
  }
  ps.borderCell = bc
  ps.borderOther = bo
  ps.fringeCell = fc
  ps.fringeOff = fo
  ps.fringeOwner = fw
  // Sea edges: open routes over at least two sea cells.
  for (const r of ts.openList) {
    const a = ts.rA[r], b = ts.rB[r]
    if (s.abandoned[a] >= 0 || s.abandoned[b] >= 0) continue
    const cost = armyPathCost(s, ts.rPath[r], a, b)
    if (seaCount >= 2) add(a, b, cost)
  }
  // Colonies' links to their mother towns.
  for (let k = 0; k < ps.linkA.length; k++) {
    const a = ps.linkA[k], b = ps.linkB[k]
    if (s.abandoned[a] >= 0 || s.abandoned[b] >= 0) continue
    add(a, b, ps.linkCost[k])
  }
  ps.gNb = gNb
  ps.gCost = gCost
  ps.mapYear = s.year
}

/** Links a settlement founded this year into the graph: to the owner of its cell, else to its parent (by its founders' path). */
export function linkNew(s: HistoryState, ps: PolityState, id: number): void {
  ensureGraph(ps, id + 1)
  if (s.outpost[id]) return
  const c = s.cell[id]
  const par = s.parent[id]
  // The founders' journey (recorded this year, to this settlement), if any.
  let path: number[] | null = null
  const J = s.journeys
  for (let k = J.length - 1; k >= 0 && J[k].arriveYear === s.year; k--) if (J[k].to === id && J[k].kind === 0) { path = J[k].path; break }
  if (par >= 0 && path !== null && s.abandoned[par] < 0) {
    const cost = armyPathCost(s, path, par, id)
    if (seaCount >= 2) {
      ps.linkA.push(par); ps.linkB.push(id); ps.linkCost.push(cost)
      addEdge(ps, par, id, cost)
    }
  }
  const o = ps.tOwner[c]
  if (o >= 0 && o !== id && s.abandoned[o] < 0) addEdge(ps, id, o, ps.tDist[c] + 0.5 * s.moveCost[c])
  else if (par >= 0 && s.abandoned[par] < 0 && path !== null) addEdge(ps, id, par, armyPathCost(s, path, par, id))
}

/** Danger of cell c now: its owner's (+ on a hostile border), or the wilderness value (cellDanger keeps it for unowned cells). */
export function zCell(s: HistoryState, ps: PolityState, c: number): number {
  const o = ps.tOwner[c]
  if (o < 0) return ps.cellZ[c]
  const zo = ps.cellOut[c] // (v2: pirates on the coast, bandits on the road)
  if (s.abandoned[o] >= 0) return zo > DANGER.wild ? zo : DANGER.wild
  const z = ps.danger[o] + (ps.hostile[c] ? DANGER.hostileEdge : 0)
  return z > 1 ? 1 : z > zo ? z : zo
}

/** Every land cell's danger into cellZ (for the danger layer). */
export function fillCellDanger(s: HistoryState, ps: PolityState): void {
  const cells = ps.landCells
  for (let t = 0; t < cells.length; t++) { const c = cells[t]; if (ps.tOwner[c] >= 0) ps.cellZ[c] = zCell(s, ps, c) }
}

/** Wilderness cell danger (every step): unowned cells next to owned land take half their owners' largest danger. */
export function cellDanger(s: HistoryState, ps: PolityState): void {
  const { cellZ, danger } = ps
  const abandoned = s.abandoned
  const wild = DANGER.wild
  const { fringeCell, fringeOff, fringeOwner } = ps
  for (let k = 0; k < fringeCell.length; k++) {
    let m = 0
    for (let q = fringeOff[k]; q < fringeOff[k + 1]; q++) {
      const b = fringeOwner[q]
      if (abandoned[b] < 0 && danger[b] > m) m = danger[b]
    }
    const z = wild + 0.5 * m
    cellZ[fringeCell[k]] = z > 1 ? 1 : z
  }
  // v2: outlaw danger on unowned cells (coasts near pirate havens, bandit roads through the wilds).
  const { outFree, cellOut } = ps
  for (let k = 0; k < outFree.length; k++) {
    const c = outFree[k]
    if (cellOut[c] > cellZ[c]) cellZ[c] = cellOut[c]
  }
}

export function createMapHeap(): Heap {
  return new Heap(4096)
}
