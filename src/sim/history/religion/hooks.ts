// religion: hooks other systems call that need nothing of the religion system's own imports (so importing them adds no import cycle).

import type { HistoryState } from '../state.ts'

/** disease (hook): a plague at settlement id counts as a woe (founding crises of faiths). */
export function religionPlague(s: HistoryState, id: number): void {
  const rel = s.rel
  if (rel !== null && id < rel.cap) rel.woe[id] = s.year
}
