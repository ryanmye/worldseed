// Tourism up close: which towns get a resort quarter (town.ts TownPlan.resort) and over which years.
//
// A town gets one if the history founded it as a resort (Settlement.resort: from its founding), or once its
// visitors are a meaningful share of its people: at least RESORT_MIN_VISITORS a year and RESORT_SHARE of its
// population at three trade snapshots or more (from the first). The quarter stays once built (old hotels outlive
// their fashion); its pleasure boats are out only in the years the visitors come (busy spans: trade snapshots
// with at least BUSY_VISITORS a year, gaps under GAP years bridged). Its size follows the most visitors it ever
// had a year; the town reach it is placed in, its population that year. A bath house where its cell or a
// neighbouring land cell has hot springs (SceneryBit.Spring); it looks for the water where its cell or a neighbour is
// on a sea or lake shore (Coast, Lake, GreatLake, Island), even beyond its plan's patches. Older histories (or tourism off) have no
// visitor flows: nothing then.

import { SceneryBit, type History, type World } from '../../contract.ts'
import type { ResortSpec } from './town.ts'

/** Visitors a year, as a share of the population, that make a town a resort. */
export const RESORT_SHARE = 0.15
/** ...and at least this many a year. */
export const RESORT_MIN_VISITORS = 20
const BUSY_VISITORS = 10
const GAP = 30

export interface ResortQuarter extends ResortSpec {
  /** Year the quarter is built. */
  from: number
  /** Years with visitors (boats on the water): [from, to) pairs, ascending. */
  busy: number[]
  /** Most visitors a year, and the population that year. */
  peak: number
  pop: number
}

const cache = new WeakMap<object, (ResortQuarter | null)[]>()

/** Per settlement its resort quarter, or null (cached per history). */
export function resortQuarters(world: World, h: History): (ResortQuarter | null)[] {
  const hit = cache.get(h)
  if (hit) return hit
  const N = h.settlements.length
  const out: (ResortQuarter | null)[] = new Array(N).fill(null)
  cache.set(h, out)
  const hp = h as Partial<History>
  const F = hp.visitorFlows
  const TI = hp.tradeInterval ?? 0
  if (!F || !(F.rowCount > 0) || !(TI > 0) || !F.rowSnapshot || !F.rowPair || !F.visitors || !F.to) return out
  const S = h.snapshotCount, SI = h.snapshotInterval
  const popAt = (q: number, id: number) => h.population[Math.min(S - 1, Math.max(0, Math.floor((q * TI) / SI))) * N + id] ?? 0
  const peakV = new Float32Array(N), peakQ = new Int32Array(N).fill(-1), firstQ = new Int32Array(N).fill(-1)
  const count = new Uint16Array(N)
  const busy: number[][] = []
  const acc = new Float32Array(N)
  const touched: number[] = []
  const flush = (q: number) => {
    for (const id of touched) {
      const v = acc[id]
      acc[id] = 0
      const p = popAt(q, id)
      if (v > peakV[id]) { peakV[id] = v; peakQ[id] = q }
      const meaningful = v >= RESORT_MIN_VISITORS && v >= RESORT_SHARE * p
      if (meaningful) {
        if (firstQ[id] < 0) firstQ[id] = q
        if (count[id] < 65535) count[id]++
      }
      if (!(meaningful || (h.settlements[id].resort === true && v >= BUSY_VISITORS))) continue
      const b = (busy[id] ??= [])
      const y0 = q * TI, y1 = (q + 1) * TI
      if (b.length && y0 - b[b.length - 1] < GAP) b[b.length - 1] = y1
      else b.push(y0, y1)
    }
    touched.length = 0
  }
  let cur = -1
  for (let r = 0; r < F.rowCount; r++) {
    const q = F.rowSnapshot[r]
    if (q !== cur) {
      if (cur >= 0) flush(cur)
      cur = q
    }
    const id = F.to[F.rowPair[r]]
    if (!(id >= 0 && id < N)) continue
    if (acc[id] === 0) touched.push(id)
    acc[id] += F.visitors[r]
  }
  if (cur >= 0) flush(cur)
  const kind = hp.sceneryKind && hp.sceneryKind.length === world.grid.cellCount ? hp.sceneryKind : null
  const { neighborOffsets: off, neighbors: nb } = world.grid
  for (let id = 0; id < N; id++) {
    const s = h.settlements[id]
    if (s.outpost) continue
    const flagged = s.resort === true
    if (!flagged && count[id] < 3) continue
    let bath = false, shore = false
    if (kind) {
      const c = s.cell
      const SHORE = SceneryBit.Coast | SceneryBit.Lake | SceneryBit.GreatLake | SceneryBit.Island
      bath = (kind[c] & SceneryBit.Spring) !== 0
      shore = (kind[c] & SHORE) !== 0
      for (let k = off[c]; k < off[c + 1]; k++) {
        if (world.elevation[nb[k]] < 0) continue
        if (kind[nb[k]] & SceneryBit.Spring) bath = true
        if (kind[nb[k]] & SHORE) shore = true
      }
    }
    const v = Math.max(peakV[id], RESORT_MIN_VISITORS)
    let pop = peakQ[id] >= 0 ? popAt(peakQ[id], id) : 0
    if (pop <= 0) for (let q = 0; q < S; q++) pop = Math.max(pop, h.population[q * N + id])
    const lodges = Math.min(4, 1 + Math.floor(Math.log2(v / RESORT_MIN_VISITORS)))
    out[id] = {
      from: flagged ? Math.max(0, s.foundedYear) : firstQ[id] * TI,
      busy: busy[id] ?? [],
      peak: peakV[id],
      pop: Math.max(1, pop),
      lodges,
      villas: Math.min(5, lodges + 1),
      boats: Math.min(5, 2 + Math.floor(v / 120)),
      bath,
      shore,
    }
  }
  return out
}
