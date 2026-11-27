// Throne slice (lane N3): the reign's end in words (EVALUATION §4 Lane 3: "a reign-end summary card: what you decided, what
// came of it, your epithet and a share link"). DOM-free: the controller shows it as a message, the bots log it.
import type { History, Ruler } from '../../../contract.ts'
import { Ctx } from '../../sagas/facts.ts'
import { reignFacts, rulerEpithet } from '../../sagas/epithets.ts'
import { optionLabel, decisionTitle } from '../seatFormat.ts'
import { callbacksAt, rulerTitle } from './callbacks.ts'
import { crownedAs } from './heirs.ts'

export interface ReignSummary {
  ruler: number
  title: string
  /** "the Long-reigning" ('' none). */
  epithet: string
  lines: string[]
  /** Decisions of the reign whose outcomes the summary tells (the bots' visible-consequence metric). */
  callbacks: number[]
  /** The share link's query: seat=, o= and the year the reign ended (the page adds the rest). */
  year: number
}

const END: Record<number, string> = { 1: 'died', 2: 'fell in battle', 3: 'was killed when the capital fell', 4: 'was overthrown and killed', 5: 'was deposed', 6: 'died of the plague', 7: 'saw the realm end', 8: 'came to the end of the term' }

/** The summary of reign r of the seat's realm, as of `year`. */
export function reignSummary(h: History, r: Ruler, year: number): ReignSummary {
  let epithet = ''
  try { epithet = rulerEpithet(reignFacts(new Ctx(h, null, year), r.id)) } catch { epithet = '' }
  const D = h.seat!.decisions
  const end = r.ended >= 0 ? r.ended : year
  const decided: string[] = []
  const ds: number[] = []
  for (let d = 0; d < D.count; d++) {
    if (D.polity[d] !== r.polity || D.year[d] < r.acceded || D.year[d] >= end || D.chosen[d] < 0) continue
    ds.push(d)
    decided.push(`${D.year[d]}, ${decisionTitle(h, d)}: ${D.deferred?.[d] === 1 ? `left to the court (${optionLabel(h, d, D.chosen[d]).toLowerCase()})` : optionLabel(h, d, D.chosen[d])}`)
  }
  const came = callbacksAt(h, end + 1, r.acceded, end - r.acceded + 30, 6).filter((c) => ds.includes(c.d))
  const lines: string[] = []
  const who = crownedAs(h, r)
  lines.push(`${who}${who.includes(', crowned as') ? ',' : ''} reigned ${end - r.acceded} years (${r.acceded}–${end})${r.ended >= 0 ? ` and ${END[r.end] ?? 'left the throne'}, aged ${r.ended - r.born}` : ''}.`)
  if (decided.length) lines.push(`You decided: ${decided.slice(-6).join('; ')}${decided.length > 6 ? ` (and ${decided.length - 6} more)` : ''}.`)
  else lines.push('No matter of this reign came to you.')
  if (came.length) lines.push(`What came of it: ${came.map((c) => c.text.replace(/^Because /, '')).join(' ')}`)
  return { ruler: r.id, title: `${rulerTitle(r)}${epithet ? ` ${epithet}` : ''}`, epithet, lines, callbacks: came.map((c) => c.d), year: end }
}

/** The share link: the page's address with the reign's year (a reload replays the same reign to that year). */
export function shareLink(href: string, year: number): string {
  try {
    const u = new URL(href)
    u.searchParams.set('year', String(year))
    return u.href
  } catch { return href }
}
