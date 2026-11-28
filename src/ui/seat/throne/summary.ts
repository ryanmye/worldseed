// Throne slice (lane N3): the reign's end in words (EVALUATION §4 Lane 3: "a reign-end summary card: what you decided, what
// came of it, your epithet and a share link"). DOM-free: the controller shows it as a message, the bots log it.
import { decodeOrders, encodeOrders } from '../../../contract.ts'
import type { History, Ruler } from '../../../contract.ts'
import { Ctx } from '../../sagas/facts.ts'
import { reignFacts, rulerEpithet } from '../../sagas/epithets.ts'
import { optionLabel, decisionTitle } from '../seatFormat.ts'
import { callbacksAt, nYears, rulerTitle } from './callbacks.ts'
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

const MAJORITY = 16
/** A stable pick among synonyms for reign r. */
const pickOf = (r: number, xs: readonly string[]) => xs[((r * 2654435761) >>> 0) % xs.length]
const SYNONYMS: Record<string, readonly string[]> = {
  'the Feeble': ['the Feeble', 'the Unready', 'the Weak'], 'the Devout': ['the Devout', 'the Godly'], 'the Warlike': ['the Warlike', 'the Bold'],
  'the Peaceable': ['the Peaceable', 'the Mild'], 'the Great': ['the Great', 'the Wise'], 'the Fallen': ['the Fallen', 'the Slain'],
}

/**
 * lane N3d: the reign summary's epithet (play-test #2: "the Feeble" three reigns running; "the Child-king" for a king crowned at
 * 15 who reigned 32 years). The sagas' own rule (sagas/epithets.ts, unchanged: their golden texts) with: the child-king only for
 * one crowned a minor who had a regency of some years; a brief or young reign named as such before a trait; a trait's word
 * from a few synonyms; and not the epithet the reign before it bore, when another fits.
 */
export function throneEpithet(h: History, r: Ruler, year: number, depth = 0): string {
  const c = new Ctx(h, null, year)
  const f = reignFacts(c, r.id)
  const crownedMinor = r.acceded - r.born <= MAJORITY - 3
  const childOk = crownedMinor && f.regency >= 3
  const alt = { ...f, regency: childOk ? f.regency : 0 }
  let e = rulerEpithet(alt)
  const ended = r.ended >= 0
  const fromTrait = e === 'the Feeble' || e === 'the Devout' || e === 'the Warlike' || e === 'the Peaceable' || e === 'the Great' || e === ''
  if (fromTrait && ended && r.ended - r.acceded <= 2) e = 'the Brief'
  else if (fromTrait && ended && (r.end === 1 || r.end === 6) && r.ended - r.born < 30) e = 'the Young'
  else if (SYNONYMS[e]) e = pickOf(r.id, SYNONYMS[e])
  // (not the same as the reign before, when it is a word of choice: the brief, the young or a trait's)
  if (depth === 0 && e && r.predecessor >= 0) {
    const prev = (h.rulers ?? [])[r.predecessor]
    if (prev && prev.polity === r.polity && throneEpithet(h, prev, year, 1) === e) {
      const base = Object.entries(SYNONYMS).find(([, xs]) => xs.includes(e))
      if (base) { const xs = base[1]; e = xs[(xs.indexOf(e) + 1) % xs.length] }
      else if (e === 'the Brief' || e === 'the Young') e = f.traits.includes('feeble') ? 'the Unready' : ''
    }
  }
  return e
}

/** The summary of reign r of the seat's realm, as of `year`. */
export function reignSummary(h: History, r: Ruler, year: number): ReignSummary {
  let epithet = ''
  try { epithet = throneEpithet(h, r, year) } catch { epithet = '' }
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
  const how = r.end === 2 && r.ended - r.born < 16 ? 'was killed in the fighting' : END[r.end] ?? 'left the throne' // (lane N3d: a child does not lead the army)
  lines.push(`${who}${who.includes(', crowned as') ? ',' : ''} reigned ${nYears(end - r.acceded)} (${r.acceded}–${end})${r.ended >= 0 ? ` and ${how}, aged ${r.ended - r.born}` : ''}.`)
  if (decided.length) lines.push(`You decided: ${decided.slice(-6).join('; ')}${decided.length > 6 ? ` (and ${decided.length - 6} more)` : ''}.`)
  else lines.push('No matter of this reign came to you.')
  // (lane N3d: each line its own sentence, capitalised: the play-test's ". you chose…")
  if (came.length) lines.push(`What came of it: ${came.map((c, i) => { const t = c.text.replace(/^Because /, ''); return i === 0 ? t : t.charAt(0).toUpperCase() + t.slice(1) }).join(' ')}`)
  return { ruler: r.id, title: `${rulerTitle(r)}${epithet ? ` ${epithet}` : ''}`, epithet, lines, callbacks: came.map((c) => c.d), year: end }
}

/**
 * The share link: the page's address with the reign's year (a reload replays the same reign to that year). lane N3b: the
 * choices made after the reign (o= orders past year + 1, the year after its last pause) are dropped, so the replay stops at
 * the first pause after it instead of the last pause of the whole seat, and the page starts its view there (year=).
 */
export function shareLink(href: string, year: number): string {
  try {
    const u = new URL(href)
    u.searchParams.set('year', String(year))
    const o = u.searchParams.get('o')
    if (o) {
      const kept = decodeOrders(o).filter((x) => x.year <= year + 1)
      if (kept.length > 0) u.searchParams.set('o', encodeOrders(kept))
      else u.searchParams.delete('o')
    }
    return u.href
  } catch { return href }
}
