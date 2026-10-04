// tourism: hooks for other systems (this module imports only hooks of theirs, so it adds no import cycle).

import type { HistoryState } from '../state.ts'
import { pilgrimsAt } from '../religion/hooks.ts' // religion:
import { SIGHT } from './params.ts'

/**
 * Extra destination scores per settlement (religion hook: holy cities and pilgrimage). Fills out[id] (0 on entry, for ids
 * below s.count) with a pull 0..1 for living settlements worth a journey for reasons other than scenery, and returns true if
 * it wrote any. Every TRAVEL.destStep years the tourism system makes each settlement with a score of at least SIGHT.holyMin a
 * destination (a Holy sight the first time) and adds the score to its appeal.
 * religion: each holy city of a living universal faith scores x / (x + SIGHT.holyHalf) for the pilgrims' income x a year of
 * all the faiths it is holy to (religion/hooks.ts pilgrimsAt: pilgrim * followers * safety); nothing when religion is off.
 */
export function tourismExtraScores(s: HistoryState, out: Float64Array): boolean {
  const rel = s.rel
  if (rel === null) return false
  const half = SIGHT.holyHalf
  let any = false
  for (let f = 0; f < rel.kind.length; f++) {
    const h = rel.holy[f]
    if (h < 0 || h >= s.count || rel.endYear[f] >= 0 || out[h] > 0 || s.abandoned[h] >= 0) continue
    const x = pilgrimsAt(rel, h)
    if (!(x > 0)) continue
    out[h] = x / (x + half)
    any = true
  }
  return any
}
