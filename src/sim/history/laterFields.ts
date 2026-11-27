// Test helper: a History without the fields of the plans that landed after the per-system golden hashes were recorded
// (grudges-and-oaths: grievances, faithless, arms, armsRaces and the wars' cause, ally and race columns; state-finances: the
// treasury and loan tables; beliefs-and-deception: the belief tables, wars.believed / actual / motive and bonds.known; merchant-families: History.families; society: the soc* tables; city-states: History.governments and its offsets). With those systems off the fields are empty or -1; the 8cabf09 fields are guarded by G0 (hashBase).

import type { History } from '../../contract.ts'

export const LATER_KEYS: ReadonlySet<string> = new Set([
  'grievances', 'faithless', 'arms', 'armsRaces', // grudges-and-oaths
  'deference', // rulers: deference (seat steps 8-9 lane)
  'treasury', 'crownDebt', 'crownRevenue', 'crownSpending', 'creditRate', 'coinage', 'fiscalDistress', 'loans', 'loanBalance', // state-finances
  'socWage', 'socUrbanWage', 'socRent', 'socPsi', 'socMMP', 'socEMP', 'socSFD', 'socElite', 'socUrban', 'socClergy', 'socCoercion', 'socPhase', // society
  'strength', 'beliefs', 'beliefEst', 'beliefSd', 'beliefSource', 'bluffShown', 'spyService', 'credibility', // beliefs-and-deception
  'families', // merchant-families
  'governments', 'governmentOffsets', 'governmentIds', // city-states
])

/** h without the later fields (a shallow copy; wars without cause, ally and race). */
export function withoutLater(h: History): History {
  const o: Record<string, unknown> = {}
  for (const k of Object.keys(h)) if (!LATER_KEYS.has(k)) o[k] = (h as unknown as Record<string, unknown>)[k]
  if (h.wars) { const w: Record<string, unknown> = { ...h.wars }; delete w.cause; delete w.ally; delete w.race; delete w.believed; delete w.actual; delete w.motive; o.wars = w }
  if (h.bonds) { const b: Record<string, unknown> = { ...h.bonds }; delete b.known; o.bonds = b } // (beliefs)
  return o as unknown as History
}
