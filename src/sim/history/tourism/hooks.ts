// tourism: hooks for other systems.

import type { HistoryState } from '../state.ts'

/**
 * Extra destination scores per settlement (religion hook: holy cities and pilgrimage). Fills out[id] (0 on entry, for ids
 * below s.count) with a pull 0..1 for living settlements worth a journey for reasons other than scenery, and returns true if
 * it wrote any. Every TRAVEL.destStep years the tourism system makes each settlement with a score of at least SIGHT.holyMin a
 * destination (a Holy sight the first time) and adds the score to its appeal. Nothing fills it yet: the religion system,
 * when merged, should return its holy cities here (e.g. out[id] = 0.3 + 0.7 * sanctity), read from its own state on `s`.
 */
export function tourismExtraScores(s: HistoryState, out: Float64Array): boolean {
  void s
  void out
  return false
}
