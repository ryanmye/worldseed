// Test helper: a History without the fields of the plans that landed after the per-system golden hashes were recorded
// (grudges-and-oaths: grievances, faithless, arms, armsRaces and the wars' cause, ally and race columns; state-finances: the
// treasury and loan tables; society: the soc* tables). With those systems off the fields are empty or -1; the 8cabf09 fields are guarded by G0 (hashBase).

import type { History } from '../../contract.ts'

export const LATER_KEYS: ReadonlySet<string> = new Set([
  'grievances', 'faithless', 'arms', 'armsRaces', // grudges-and-oaths
  'treasury', 'crownDebt', 'crownRevenue', 'crownSpending', 'creditRate', 'coinage', 'fiscalDistress', 'loans', 'loanBalance', // state-finances
  'socWage', 'socUrbanWage', 'socRent', 'socPsi', 'socMMP', 'socEMP', 'socSFD', 'socElite', 'socUrban', 'socClergy', 'socCoercion', 'socPhase', // society
])

/** h without the later fields (a shallow copy; wars without cause, ally and race). */
export function withoutLater(h: History): History {
  const o: Record<string, unknown> = {}
  for (const k of Object.keys(h)) if (!LATER_KEYS.has(k)) o[k] = (h as unknown as Record<string, unknown>)[k]
  if (h.wars) { const w: Record<string, unknown> = { ...h.wars }; delete w.cause; delete w.ally; delete w.race; o.wars = w }
  return o as unknown as History
}
