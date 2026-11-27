// finance: the war hooks of the campaigns (state-finances.md §2.4.6): ArmyUnpaid (once per side and war) and WarBankrupt
// (the war ends when a side's unpaid army is spent, or after FIN.mutinyYears unpaid: mutiny).

import { EventType } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { FIN } from './params.ts'

function logX(s: HistoryState, type: number, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type: type as EventType, settlement, other, value, extra })
}

/** campaigns, after exhaustion: logs ArmyUnpaid; returns the side (polity) whose bankruptcy ends war w now, or -1. */
export function warBroke(s: HistoryState, ps: PolityState, w: number, p: number, q: number, spent: boolean): number {
  const fin = s.fin
  if (fin === null || !FIN.divert) return -1
  let b = -1
  for (let k = 0; k < 2; k++) {
    const x = k === 0 ? p : q
    if (x >= fin.pcap || fin.unpaid[x] < 1) continue
    while (fin.wUnpaid.length <= w) fin.wUnpaid.push(0)
    const bit = k === 0 ? 1 : 2
    if ((fin.wUnpaid[w] & bit) === 0) { fin.wUnpaid[w] |= bit; fin.diag.unpaidWars++; logX(s, EventType.ArmyUnpaid, ps.pCapital[x], ps.pCapital[k === 0 ? q : p], w, -1) }
    if (b < 0 && ((spent && ps.pExh[x] >= 1) || fin.unpaid[x] >= FIN.mutinyYears)) b = x
  }
  return b
}

/** WarBankrupt, just before the peace. */
export function logWarBankrupt(s: HistoryState, ps: PolityState, w: number, b: number): void {
  const fin = s.fin!
  fin.diag.bankrupt++
  logX(s, EventType.WarBankrupt, ps.pCapital[b], ps.pCapital[ps.wAtt[w] === b ? ps.wDef[w] : ps.wAtt[w]], w, fin.unpaid[b])
}
