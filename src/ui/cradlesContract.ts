// The UI's one seam to the simulation's planted cradles (HistoryOptions.cradles; History.cradleWish, cradleCell,
// cradlePlaced; EventType.CradlePlaced; encodeCradles, decodeCradles, cradleCount). Until the simulation side is merged
// they come from local stand-ins (cradlesStandIn.ts); at the merge the export line below changes to
// `from '../contract.ts'`. Everything else here works either way: a History is read
// through cradlesOf(), which returns null for a history without the arrays, and the outcomes are the contract's numbers.

export { CradleOutcome, encodeCradles, decodeCradles, cradleCount } from './cradlesStandIn.ts'
import type { EventType, History, HistoryOptions } from '../contract.ts'

/** EventType.CradlePlaced: year 0; `settlement` the people's first settlement, `value` the people, `extra` the outcome. */
export const CRADLE_PLACED = 180 as number as EventType

/** The outcomes (History.cradlePlaced, the `extra` of CradlePlaced), by their contract numbers. */
export const Hearth = { Chosen: 0, Placed: 1, Moved: 2, Rejected: 3 } as const

/** History options with the planted cradles (HistoryOptions.cradles once merged). */
export type CradleOptions = HistoryOptions & { cradles?: number[] }

/** The planted-cradle arrays of a history (per people), or null when it has none (no wishes, or a simulation without them). */
export interface CradleRecord {
  /** The cell wished for each people, -1 none. */
  wish: Int32Array
  /** The cell each people began on. */
  cell: Int32Array
  /** The outcome per people (Hearth). */
  placed: Uint8Array
}

export function cradlesOf(h: History): CradleRecord | null {
  const x = h as History & { cradleWish?: Int32Array; cradleCell?: Int32Array; cradlePlaced?: Uint8Array }
  const P = h.peoples.length
  if (!x.cradleWish || !x.cradleCell || !x.cradlePlaced || x.cradlePlaced.length < P) return null
  let any = false
  for (let p = 0; p < P; p++) if (x.cradlePlaced[p] !== Hearth.Chosen) any = true
  return any ? { wish: x.cradleWish, cell: x.cradleCell, placed: x.cradlePlaced } : null
}

/** The outcome for people p (Hearth.Chosen without a record). */
export const hearthOf = (r: CradleRecord | null, p: number): number => (r && p >= 0 && p < r.placed.length ? r.placed[p] : Hearth.Chosen)

/** A cradle list in canonical form: whole cell ids or -1, trailing -1 dropped ([] when nothing is wished), so equal wishes give one cache key. */
export function canonicalCradles(cells: readonly number[] | undefined): number[] {
  if (!cells || cells.length === 0) return []
  const out = cells.map((c) => (Number.isInteger(c) && c >= 0 ? c : -1))
  while (out.length && out[out.length - 1] < 0) out.pop()
  return out
}
