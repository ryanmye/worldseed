// Stand-ins for the simulation side's contract additions for planted cradles (contract.ts once merged): the same names
// and signatures, so the UI builds and runs before the merge. cradlesContract.ts re-exports these; at the merge it
// re-exports contract.ts's instead (one line) and this file can go.

import type { World } from '../contract.ts'

/** What became of a people's wished cradle (History.cradlePlaced). */
export const CradleOutcome = {
  /** No wish: the simulation chose the cradle. */
  Chosen: 0,
  /** Placed as wished. */
  Placed: 1,
  /** The wished cell could not be lived on: moved to the nearest livable land. */
  Moved: 2,
  /** Rejected: no livable land near enough; the simulation chose. */
  Rejected: 3,
} as const
export type CradleOutcome = (typeof CradleOutcome)[keyof typeof CradleOutcome]

/** URL text of a cradle list (c=): the cells joined by '.', -1 written as '-'. */
export function encodeCradles(cells: number[]): string {
  return cells.map((c) => (Number.isInteger(c) && c >= 0 ? String(c) : '-')).join('.')
}

/** Parses encodeCradles text; anything that is not a whole cell id reads as -1. */
export function decodeCradles(s: string): number[] {
  if (!s.trim()) return []
  return s.split('.').map((x) => (/^\d+$/.test(x.trim()) ? Number(x.trim()) : -1))
}

/** How many peoples the world will have (stand-in: the simulation's most, CRADLE.maxTribes; the real one plans the cradles). */
export function cradleCount(_world: World): number {
  return 12
}
