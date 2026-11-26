// Drawing only the live part of a ribbon geometry (long-haul legs, outlaw lanes, trade lines).
// These geometries hold every item that will ever exist (a leg, a lane slot, a network piece),
// each a contiguous run of the index buffer, and their vertex shaders hide the items not live at
// the shown year. Hidden items still cost vertex work every frame, so the live items' index runs
// become the geometry's draw groups (drawn with a one-entry material array): the same triangles
// in the same order as drawing the whole buffer, minus ones the shader would have hidden. Runs
// are merged at their smallest gaps down to a few groups (each group is a draw call); merging
// only draws hidden triangles again, so the picture never changes. No buffer is re-uploaded.
// The live sets change with the year or the trade snapshot, not per frame.

import type * as THREE from 'three'

/** Most draw groups per geometry (one draw call each). */
export const MAX_LIVE_RUNS = 8

/**
 * The index runs of the live items, merged to at most `maxRuns`: items 0..n-1 occupy
 * index ranges [starts[i], starts[i+1]); `live[i]` non-zero for a live item. Writes
 * (start, count) pairs into `out` (length >= 2 * maxRuns) and returns the number of runs.
 * `scratch` (length >= n + 1 entries, reused) holds the unmerged runs. Empty items never
 * break a run.
 */
export function liveRuns(starts: ArrayLike<number>, live: ArrayLike<number>, n: number, maxRuns: number, out: Uint32Array, scratch: Uint32Array): number {
  // unmerged runs as (start, end) pairs in scratch
  let r = 0
  let open = false
  for (let i = 0; i < n; i++) {
    const a = starts[i], b = starts[i + 1]
    if (b <= a) continue
    if (live[i]) {
      if (open) scratch[r * 2 - 1] = b
      else {
        scratch[r * 2] = a
        scratch[r * 2 + 1] = b
        r++
        open = true
      }
    } else open = false
  }
  if (r === 0) return 0
  const keep = Math.max(1, maxRuns)
  if (r <= keep) {
    for (let j = 0; j < r; j++) {
      out[j * 2] = scratch[j * 2]
      out[j * 2 + 1] = scratch[j * 2 + 1] - scratch[j * 2]
    }
    return r
  }
  // split only at the (keep - 1) widest gaps: find the threshold gap width by selection
  const gaps: number[] = []
  for (let j = 0; j + 1 < r; j++) gaps.push(scratch[(j + 1) * 2] - scratch[j * 2 + 1])
  const sorted = gaps.slice().sort((x, y) => y - x)
  const cut = keep - 1
  const threshold = cut > 0 ? sorted[cut - 1] : Infinity
  // gaps wider than the threshold always split; ties at it split until `cut` splits are used
  let wider = 0
  for (const g of gaps) if (g > threshold) wider++
  let tiesLeft = cut - wider
  let m = 0
  out[0] = scratch[0]
  for (let j = 0; j + 1 < r; j++) {
    const g = gaps[j]
    const split = g > threshold || (g === threshold && tiesLeft-- > 0)
    if (split) {
      out[m * 2 + 1] = scratch[j * 2 + 1] - out[m * 2]
      m++
      out[m * 2] = scratch[(j + 1) * 2]
    }
  }
  out[m * 2 + 1] = scratch[(r - 1) * 2 + 1] - out[m * 2]
  return m + 1
}

/**
 * Sets the geometry's draw groups to `runs` (start, count) pairs, material 0 (the mesh's
 * material must be a one-entry array). Returns the index count drawn.
 */
export function setRunGroups(geom: THREE.BufferGeometry, runs: Uint32Array, count: number): number {
  geom.clearGroups()
  let total = 0
  for (let j = 0; j < count; j++) {
    geom.addGroup(runs[j * 2], runs[j * 2 + 1], 0)
    total += runs[j * 2 + 1]
  }
  return total
}

/** A geometry's live-run state: scratch buffers sized for its items, and the last result. */
export interface LiveRunState {
  readonly starts: Uint32Array
  readonly live: Uint8Array
  readonly n: number
  /** Index count drawn now (the whole buffer until the first update). */
  drawn: number
  update(geom: THREE.BufferGeometry): number
}

/** Live-run bookkeeping for a geometry of n items over index ranges `starts` (n + 1 entries). */
export function createLiveRuns(starts: Uint32Array, n: number, maxRuns = MAX_LIVE_RUNS): LiveRunState {
  const live = new Uint8Array(n)
  const out = new Uint32Array(maxRuns * 2)
  const scratch = new Uint32Array(n * 2 + 2)
  const state: LiveRunState = {
    starts,
    live,
    n,
    drawn: n > 0 ? starts[n] - starts[0] : 0,
    update(geom) {
      const runs = liveRuns(starts, live, n, maxRuns, out, scratch)
      state.drawn = setRunGroups(geom, out, runs)
      return state.drawn
    },
  }
  return state
}
