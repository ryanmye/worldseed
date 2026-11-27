// Sagas: crowns' money (state-finances.md §4.4). The chronicle register states the record; the legend tells it.

import { EventType } from '../../contract.ts'
import type { Ctx } from './facts.ts'
import { num, times, type PhraseTable, type Voice } from './voice.ts'

export const FIN_T: PhraseTable = {
  finLoans: [['From {year} its crown borrowed from the merchant houses{of}.'], ['From {year} its kings lived on the gold of the merchant houses{of}.']],
  finDefault: [['Its crown stopped its payments {times}, first in {year}.'], ['{Times} its treasury failed and its creditors were left to weep, first in {year}.']],
  finRepudiate: [['In {year} a new ruler refused the debts of the crown.'], ['In {year} the new king tore up the bonds of his predecessor.']],
  finBankrupt: [['{N} of its wars ended because it could no longer pay its soldiers, first in {year}.'], ['{N} times its soldiers, unpaid, went home before the war was won, first in {year}.']],
  yDefault: [['In {year} the crown of {state} stopped its payments.'], ['In {year} the treasury of {state} ran dry and its creditors were ruined.']],
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

/** The finance sentences of polity p's state saga (section hWar). */
export function financeLines(c: Ctx, v: Voice, p: number): string[] {
  const out: string[] = []
  const Y = c.Y
  const mine = (t: number) => c.type(t).filter((i) => c.ev(i).year <= Y && c.polityOf(c.ev(i).settlement, c.ev(i).year) === p).map((i) => c.ev(i))
  const loans = mine(EventType.LoanTaken)
  if (loans.length > 0) {
    const seats = [...new Set(loans.map((e) => e.other))].slice(0, 2).map((id) => c.name(id, loans[0].year))
    out.push(v.p('finLoans', { year: loans[0].year, of: seats.length ? ` of ${seats.join(' and ')}` : '' }))
  }
  const defs = mine(EventType.CrownDefault)
  if (defs.length > 0) { const t = times(defs.length); out.push(v.p('finDefault', { times: t, Times: cap(t), year: defs[0].year })) }
  const rep = mine(EventType.Repudiation)
  if (rep.length > 0) out.push(v.p('finRepudiate', { year: rep[0].year }))
  const bk = mine(EventType.WarBankrupt)
  if (bk.length > 0) out.push(v.p('finBankrupt', { N: cap(num(bk.length)), year: bk[0].year }))
  return out
}

/** The decade chronicle's finance sentence. */
export function financeYearLines(c: Ctx, v: Voice, of: (t: number) => { year: number; settlement: number }[]): string[] {
  const d = of(EventType.CrownDefault)[0]
  return d ? [v.p('yDefault', { year: d.year, state: c.pname(c.polityOf(d.settlement, d.year)) })] : []
}
