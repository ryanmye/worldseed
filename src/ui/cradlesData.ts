// Cradle wishes (HistoryOptions.cradles; History.cradleWish, cradleCell, cradlePlaced, cradleCrowded; EventType.CradlePlaced)
// for the UI: the planted hearths of a history, and the preview of a wish list before simulating (the simulation's own
// previewCradles, loaded on first use and run on the main thread: about a tenth of a second).

import { CradleOutcome, type History, type World } from '../contract.ts'
import type { CradlePreview } from '../sim/history/cradleWish.ts'

/** The cradle-wish arrays of a history (per people), or null when no people had a wish. */
export interface CradleRecord {
  /** The cell wished for each people, -1 none. */
  wish: Int32Array
  /** The cell each people began on. */
  cell: Int32Array
  /** The CradleOutcome per people. */
  placed: Uint8Array
  /** 1 where two wished peoples were set down within sight of each other. */
  crowded: Uint8Array
}

export function cradlesOf(h: History): CradleRecord | null {
  const { cradleWish: wish, cradleCell: cell, cradlePlaced: placed } = h
  const P = h.peoples.length
  if (!wish || !cell || !placed || placed.length < P) return null
  let any = false
  for (let p = 0; p < P; p++) if (placed[p] !== CradleOutcome.Chosen) any = true
  return any ? { wish, cell, placed, crowded: h.cradleCrowded ?? new Uint8Array(P) } : null
}

/** The outcome for people p (Chosen without a record). */
export const hearthOf = (r: CradleRecord | null, p: number): number => (r && p >= 0 && p < r.placed.length ? r.placed[p] : CradleOutcome.Chosen)

let sim: Promise<typeof import('../sim/history/cradleWish.ts')> | null = null
let last: { world: World; key: string; value: CradlePreview } | null = null

/** What the History will record for these wishes on this world (count: the peoples it gets), without simulating. */
export async function previewCradles(world: World, cells: readonly number[]): Promise<CradlePreview> {
  const key = cells.join(',')
  if (last && last.world === world && last.key === key) return last.value
  sim ??= import('../sim/history/cradleWish.ts')
  const value = (await sim).previewCradles(world, cells)
  last = { world, key, value }
  return value
}
