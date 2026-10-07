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
  const N = T.cellCount
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const d = new Int32Array(N).fill(-1)
  const q = new Int32Array(N)
  let n = 0
  for (let i = 0; i < N; i++) if (!T.deep[i]) { d[i] = 0; q[n++] = i }
  for (let h = 0; h < n; h++) {
    const c = q[h]
    for (let k = off[c]; k < off[c + 1]; k++) { const j = nb[k]; if (d[j] < 0) { d[j] = d[c] + 1; q[n++] = j } }
  }
  gap = new Float32Array(N)
  for (let i = 0; i < N; i++) gap[i] = d[i] > 0 ? d[i] * T.cellScale : 0
  GAPS.set(T, gap)
  return gap
}

const KEEL = IDEA_INDEX.get('keel') ?? -1, COMPASS = IDEA_INDEX.get('compass') ?? -1, NAVIGATION = IDEA_INDEX.get('navigation') ?? -1

/** Ocean gap people p's ships venture out to now (n = 48 cell units). */
export function oceanReach(s: HistoryState, p: number): number {
  const X = OCEAN
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
