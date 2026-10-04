// religion: hooks other systems call that need nothing of the religion system's own imports (so importing them adds no import cycle).

import type { HistoryState } from '../state.ts'
import type { ReligionState } from './state.ts'

/** disease (hook): a plague at settlement id counts as a woe (founding crises of faiths). */
export function religionPlague(s: HistoryState, id: number): void {
  const rel = s.rel
  if (rel !== null && id < rel.cap) rel.woe[id] = s.year
}

/** tourism (hook): pilgrims' income a year at settlement id (0 unless it is a holy city of a living faith). */
export function pilgrimsAt(rel: ReligionState, id: number): number {
  let x = 0
  for (let f = 0; f < rel.kind.length; f++) if (rel.holy[f] === id && rel.endYear[f] < 0) x += rel.pilgrims[f]
  return x
}
