// rulers: hooks other systems call that need nothing of the polity modules (so that importing them adds no import cycle).

import { ReignEnd } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { RULERS } from './params.ts'

const H = RULERS.heirs

/**
 * disease: hook for the epidemic system. An epidemic that kills a share `mortality` of the people at polity p's capital takes
 * the ruler with chance mortality * court (the court shares the city's air) and each heir likewise; the ruler's death takes
 * effect at the next rulers' year (cause Plague).
 */
export function rulerPlague(s: HistoryState, p: number, mortality: number, court = 1): void {
  const R = s.rul
  if (R === null || p < 0 || p >= R.pcap || R.cur[p] < 0) return
  const x = mortality * court
  const rng = R.rng
  if (R.kill[p] === 0 && R.rng.next() < x) R.kill[p] = ReignEnd.Plague
  for (let k = 0; k < R.hN[p]; k++) if (rng.next() < x) R.hDeath[p * H + k] = s.year
}
