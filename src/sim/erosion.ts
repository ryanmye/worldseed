// Cheap stream-power erosion over the cell graph (Braun & Willett 2013 style,
// implicit, slope exponent n = 1, area exponent m = 1/2), plus a little
// hillslope diffusion. Works on raw (pre-normalization) heights where sea
// level is 0; cells below 0 are base level and are never touched.
//
// Each iteration:
//   1. priority-flood the land from the coast (epsilon gradient across flats)
//      to get a drainage order and a receiver per land cell that always leads
//      to the sea, even out of pits;
//   2. accumulate drainage area downstream;
//   3. lower every land cell towards its (already updated) receiver with
//      h <- (h + f h_r) / (1 + f), f = K sqrt(A) / dx, which is unconditionally
//      stable and never cuts below the receiver;
//   4. diffuse a little so ridges between valleys stay rounded, not spiky.
// Pits (cells at or below their receiver) are left alone, but their outlets
// keep incising, so small noise-level depressions drain over the iterations.

import type { SimGrid } from './grid.ts'
import { cellDistance } from './grid.ts'
import { MinHeap } from './util.ts'

export interface ErosionOptions {
  iterations: number
  /** Stream-power coefficient, tuned at n = 48 (area in default-cell units, dx in radians). */
  k: number
  /** Hillslope diffusion blend per iteration, in [0, 1). */
  diffusion: number
  /** Optional per-cell multiplier on k (e.g. rock hardness). */
  erodibility?: Float64Array
}

const EPS = 1e-6

export function erode(g: SimGrid, h: Float64Array, opts: ErosionOptions): void {
  const N = g.cellCount
  const { pos, neighborOffsets: off, neighbors: nb } = g
  const filled = new Float64Array(N)
  const done = new Uint8Array(N)
  const order = new Int32Array(N)
  const recv = new Int32Array(N)
  const rdist = new Float64Array(N)
  const area = new Float64Array(N)
  const tmp = new Float64Array(N)
  const heap = new MinHeap(N)
  const cellArea = 23042 / N
  const ero = opts.erodibility

  // Coastal sea cells seed every flood; they do not change between iterations.
  const seeds: number[] = []
  for (let i = 0; i < N; i++) {
    if (h[i] >= 0) continue
    for (let k = off[i]; k < off[i + 1]; k++) {
      if (h[nb[k]] >= 0) { seeds.push(i); break }
    }
  }

  for (let it = 0; it < opts.iterations; it++) {
    // --- 1. Priority flood -------------------------------------------------
    done.fill(0)
    heap.size = 0
    for (let i = 0; i < N; i++) if (h[i] < 0) { done[i] = 1; filled[i] = h[i] }
    for (let s = 0; s < seeds.length; s++) heap.push(h[seeds[s]], seeds[s])
    let nOrder = 0
    while (heap.size > 0) {
      const c = heap.pop()
      if (h[c] >= 0) order[nOrder++] = c
      const fc = filled[c]
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (done[j]) continue
        done[j] = 1
        const e = h[j]
        filled[j] = e > fc + EPS ? e : fc + EPS
        heap.push(filled[j], j)
      }
    }
    // Land not reachable from any sea (a world with no ocean) is left as is.

    // Receivers: steepest descent on the filled surface.
    for (let t = 0; t < nOrder; t++) {
      const i = order[t]
      const fi = filled[i]
      let best = -1, bestSlope = 0, bestD = 1
      for (let k = off[i]; k < off[i + 1]; k++) {
        const j = nb[k]
        const drop = fi - filled[j]
        if (drop <= 0) continue
        const d = cellDistance(pos, i, j)
        const s = drop / d
        if (s > bestSlope) { bestSlope = s; best = j; bestD = d }
      }
      recv[i] = best
      rdist[i] = bestD
    }

    // --- 2. Drainage area ----------------------------------------------------
    for (let t = 0; t < nOrder; t++) area[order[t]] = cellArea
    for (let t = nOrder - 1; t >= 0; t--) {
      const i = order[t]
      const r = recv[i]
      if (r >= 0 && h[r] >= 0) area[r] += area[i]
    }

    // --- 3. Implicit stream-power incision, downstream first -----------------
    for (let t = 0; t < nOrder; t++) {
      const i = order[t]
      const r = recv[i]
      if (r < 0) continue
      const base = h[r] > 0 ? h[r] : 0
      const hi = h[i]
      if (hi <= base) continue
      let f = (opts.k * Math.sqrt(area[i])) / rdist[i]
      if (ero) f *= ero[i]
      h[i] = (hi + f * base) / (1 + f)
    }

    // --- 4. Hillslope diffusion on land (sea neighbours count as sea level) --
    const a = opts.diffusion
    if (a > 0) {
      for (let i = 0; i < N; i++) {
        const hi = h[i]
        if (hi < 0) { tmp[i] = hi; continue }
        let s = 0
        const o0 = off[i], o1 = off[i + 1]
        for (let k = o0; k < o1; k++) {
          const v = h[nb[k]]
          s += v > 0 ? v : 0
        }
        tmp[i] = (1 - a) * hi + (a * s) / (o1 - o0)
      }
      h.set(tmp)
    }
  }
}
