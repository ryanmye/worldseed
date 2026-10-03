// Drainage: priority-flood depression filling from the ocean (Barnes et al.
// 2014, with an epsilon gradient across flats), then steepest descent on the
// filled surface and downstream accumulation of rainfall.
//
// Every land cell's filled height is strictly greater than that of the cell it
// was flooded from, so steepest descent on the filled surface always has a
// strictly lower neighbour: chains are acyclic and end in the ocean.

import type { SimGrid } from './grid.ts'
import { cellDistance } from './grid.ts'
import { MinHeap } from './util.ts'

export interface RiverResult {
  riverTo: Int32Array
  flow: Float32Array
  /** Depression-filled surface (>= elevation on land). Cells where filled > elevation are lakes. */
  filled: Float64Array
}

const EPS = 1e-5

export function computeRivers(g: SimGrid, elevation: Float32Array, rainfall: Float32Array): RiverResult {
  const N = g.cellCount
  const { pos, neighborOffsets: off, neighbors: nb } = g
  const filled = new Float64Array(N)
  const done = new Uint8Array(N)
  const heap = new MinHeap(N)
  const riverTo = new Int32Array(N).fill(-1)

  let oceanCount = 0
  for (let i = 0; i < N; i++) {
    if (elevation[i] < 0) {
      filled[i] = elevation[i]
      done[i] = 1
      heap.push(filled[i], i)
      oceanCount++
    }
  }
  // A planet with no ocean at all: drain to the lowest cell.
  if (oceanCount === 0) {
    let low = 0
    for (let i = 1; i < N; i++) if (elevation[i] < elevation[low]) low = i
    filled[low] = elevation[low]
    done[low] = 1
    heap.push(filled[low], low)
  }

  const order = new Int32Array(N) // land cells in increasing filled height
  let nOrder = 0
  while (heap.size > 0) {
    const c = heap.pop()
    if (elevation[c] >= 0) order[nOrder++] = c
    const fc = filled[c]
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (done[j]) continue
      done[j] = 1
      const e = elevation[j]
      filled[j] = e > fc + EPS ? e : fc + EPS
      heap.push(filled[j], j)
    }
  }

  // Steepest descent on the filled surface.
  for (let t = 0; t < nOrder; t++) {
    const i = order[t]
    if (elevation[i] < 0) continue
    let best = -1
    let bestSlope = 0
    const fi = filled[i]
    for (let k = off[i]; k < off[i + 1]; k++) {
      const j = nb[k]
      const drop = fi - filled[j]
      if (drop <= 0) continue
      const slope = drop / cellDistance(pos, i, j)
      if (slope > bestSlope) { bestSlope = slope; best = j }
    }
    riverTo[i] = best
  }

  // Accumulate rainfall downstream, highest cells first. Units: one default-
  // resolution (n = 48) cell receiving rainfall 1, so thresholds are
  // resolution independent.
  const area = 23042 / N
  const acc = new Float64Array(N)
  for (let t = nOrder - 1; t >= 0; t--) {
    const i = order[t]
    acc[i] += rainfall[i] * area
    const d = riverTo[i]
    if (d >= 0 && elevation[d] >= 0) acc[d] += acc[i]
  }
  const flow = new Float32Array(N)
  for (let i = 0; i < N; i++) flow[i] = elevation[i] >= 0 ? acc[i] : 0
  return { riverTo, flow, filled }
}

export interface LakeOptions {
  /** A depression counts as a lake only if its deepest point is at least this deep (elevation units). */
  minDepth: number
  /** ... and it covers at least this many cells at n = 48 (scaled with resolution). */
  minCells: number
}

export const LAKE_OPTIONS: LakeOptions = { minDepth: 0.004, minCells: 2 }

/**
 * Lakes from the depression fill: connected land cells whose filled level sits
 * above the terrain (by more than the epsilon gradient), kept only when the
 * basin is both deep and large enough to not be noise. The whole flooded basin
 * becomes lake, so each lake has one flat water level.
 */
export function computeLakes(g: SimGrid, elevation: Float32Array, filled: Float64Array, opts: LakeOptions = LAKE_OPTIONS): Uint8Array {
  const N = g.cellCount
  const { neighborOffsets: off, neighbors: nb } = g
  const wet = new Uint8Array(N)
  // Flats crossed by the epsilon gradient rise by EPS per cell; a real
  // depression is flooded by well over that.
  const minFlood = 50 * EPS
  for (let i = 0; i < N; i++) if (elevation[i] >= 0 && filled[i] - elevation[i] > minFlood) wet[i] = 1
  const minCells = Math.max(1, Math.round(opts.minCells / (g.cellScale * g.cellScale)))
  const lake = new Uint8Array(N)
  const seen = new Uint8Array(N)
  const stack = new Int32Array(N)
  const members = new Int32Array(N)
  for (let s = 0; s < N; s++) {
    if (!wet[s] || seen[s]) continue
    let sp = 0, m = 0, depth = 0
    stack[sp++] = s
    seen[s] = 1
    while (sp > 0) {
      const c = stack[--sp]
      members[m++] = c
      const d = filled[c] - elevation[c]
      if (d > depth) depth = d
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (wet[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j }
      }
    }
    if (depth >= opts.minDepth && m >= minCells) for (let t = 0; t < m; t++) lake[members[t]] = 1
  }
  return lake
}
