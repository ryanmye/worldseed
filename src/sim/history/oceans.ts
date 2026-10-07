// Open ocean: how far from the shallows a people's ships dare to go, so that a wide ocean is a barrier until the
// seafaring ideas that cross it arrive (separate continents may stay apart, and their ideas, faiths and species diverge).
//
// Every deep-ocean cell has a gap: its distance in cells (at the n = 48 grid; scaled by Terrain.cellScale) to the nearest
// cell that is not open ocean (land, a lake, shallow sea or a shelf). A strait or a sea with islands has small gaps all the
// way across; the middle of a wide ocean a large one. A people's ships venture out to gap OCEAN.base (out of sight of the
// shallows only so far); the keeled ship adds OCEAN.keel, the compass OCEAN.compass (with the keel), celestial navigation
// OCEAN.navigation and then perSea for each Seafaring level above seaFree (ideas/params.ts: IdeaKind.Seafaring). With the
// ideas off, the same steps follow its Seafaring level (OCEAN.techKeel, techCompass, techNavigation).
// The searches that go where nobody of the people has been, the voyages of settlement (voyages.ts) and the exploring
// expeditions (exploration.ts), do not enter a deep cell beyond the sender's reach; and settlers sail open ocean beyond
// OCEAN.base only where their people knows it (explorers find the way first). Trade expeditions (goods/routes.ts) are not
// held back: they sail for goods of peoples their own already trades with or has met, so they never join two networks
// that have not met, and the long-haul lanes of the worlds whose continents met stay as they were. Nothing here draws;
// the gaps depend on the world alone (computed once per terrain).

import { TECH_FIELD_COUNT, TechField } from '../../contract.ts'
import type { HistoryState } from './state.ts'
import type { Terrain } from './terrain.ts'
import { IDEA_INDEX } from './ideas/state.ts'

export const OCEAN = {
  /** Off: any ocean is crossed as before (the check that nothing else changed). */
  on: true,
  /** Ocean gap (cells at n = 48) a people's ships venture out to without the seafaring ideas, and what each adds. */
  base: 2,
  keel: 0.25,
  compass: 0.25,
  navigation: 0,
  /** With navigation, each Seafaring level above seaFree adds perSea (the open ocean of great ships). */
  seaFree: 4.1,
  perSea: 3,
  /** With the ideas off: the Seafaring levels that stand for the keel, the compass and navigation. */
  techKeel: 1.4,
  techCompass: 1.9,
  techNavigation: 2.4,
}
const GAPS = new WeakMap<Terrain, Float32Array>() // (lookup only)

/** Ocean gap of every cell (0 for land, lakes, shallow sea), in n = 48 cell units. */
export function oceanGaps(s: HistoryState): Float32Array {
  const T = s.terrain
  let gap = GAPS.get(T)
  if (gap) return gap
  gap = oceanGapsOf(T, s.world.grid)
  GAPS.set(T, gap)
  return gap
}

/** The gaps of a terrain on its grid (oceanGaps, uncached). */
export function oceanGapsOf(T: Terrain, grid: { neighborOffsets: Uint32Array | Int32Array; neighbors: Uint32Array | Int32Array }): Float32Array {
  const N = T.cellCount
  const off = grid.neighborOffsets, nb = grid.neighbors
  const d = new Int32Array(N).fill(-1)
  const q = new Int32Array(N)
  let n = 0
  for (let i = 0; i < N; i++) if (!T.deep[i]) { d[i] = 0; q[n++] = i }
  for (let h = 0; h < n; h++) {
    const c = q[h]
    for (let k = off[c]; k < off[c + 1]; k++) { const j = nb[k]; if (d[j] < 0) { d[j] = d[c] + 1; q[n++] = j } }
  }
  const gap = new Float32Array(N)
  for (let i = 0; i < N; i++) gap[i] = d[i] > 0 ? d[i] * T.cellScale : 0
  return gap
}

/**
 * The widest gap on the best way by sea (or over other lands) from landmass a to landmass b: the least, over all ways, of
 * the largest gap crossed (tests and harnesses: two lands are joined within reach r when this is at most r). Infinity if none.
 */
export function oceanBottleneck(T: Terrain, gap: Float32Array, grid: { neighborOffsets: Uint32Array | Int32Array; neighbors: Uint32Array | Int32Array }, a: number, b: number): number {
  const N = T.cellCount
  const off = grid.neighborOffsets, nb = grid.neighbors
  // Thresholds in increasing order: the distinct gap values; flood fill from a within each.
  const all = Array.from(gap).sort((x, y) => x - y)
  const levels: number[] = []
  for (const g of all) if (levels.length === 0 || g > levels[levels.length - 1]) levels.push(g)
  const seen = new Uint8Array(N)
  const st: number[] = []
  for (let i = 0; i < N; i++) if (T.landmass[i] === a) { seen[i] = 1; st.push(i) }
  const parked: number[] = [] // (cells over the current level, met at the edge)
  for (const lv of levels) {
    for (let i = parked.length - 1; i >= 0; i--) if (gap[parked[i]] <= lv) { st.push(parked[i]); parked.splice(i, 1) }
    while (st.length) {
      const c = st.pop() as number
      if (T.landmass[c] === b) return lv
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (seen[j]) continue
        seen[j] = 1
        if (gap[j] <= lv) st.push(j)
        else parked.push(j)
      }
    }
  }
  return Infinity
}

const KEEL = IDEA_INDEX.get('keel') ?? -1, COMPASS = IDEA_INDEX.get('compass') ?? -1, NAVIGATION = IDEA_INDEX.get('navigation') ?? -1

/** Ocean gap people p's ships venture out to now (n = 48 cell units). */
export function oceanReach(s: HistoryState, p: number): number {
  const X = OCEAN
  if (!X.on) return Infinity
  const ix = s.ideas
  let keel: boolean, compass: boolean, nav: boolean
  if (ix !== null) {
    const o = p * ix.I
    keel = KEEL >= 0 && ix.held[o + KEEL] === 1
    compass = COMPASS >= 0 && ix.held[o + COMPASS] === 1
    nav = NAVIGATION >= 0 && ix.held[o + NAVIGATION] === 1
  } else {
    const sea = s.tech[p * TECH_FIELD_COUNT + TechField.Seafaring]
    keel = sea >= X.techKeel; compass = sea >= X.techCompass; nav = sea >= X.techNavigation
  }
  let r = X.base
  if (keel) { r += X.keel; if (compass) r += X.compass }
  if (nav) {
    r += X.navigation
    const sea = s.tech[p * TECH_FIELD_COUNT + TechField.Seafaring]
    if (sea > X.seaFree) r += X.perSea * (sea - X.seaFree)
  }
  return r + 1e-6
}
