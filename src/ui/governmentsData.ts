// governments: UI reads of History.governments (city-states.md §7.1): the form of a polity at a year, its words and the
// ruler titles. With the table empty (governments off, or an old history) every polity reads as before: a Monarchy, or a
// League for a league.

import { Government, GovernmentCause, PolityOrigin } from '../contract.ts'
import type { History } from '../contract.ts'

/** The governments row of polity p in force at `year` (the last with year <= y), -1 when none. */
export function governmentRowAt(h: History, p: number, year: number): number {
  const o = h.governmentOffsets
  if (!o || p < 0 || p + 1 >= o.length) return -1
  let r = -1
  for (let k = o[p]; k < o[p + 1]; k++) { const x = h.governmentIds[k]; if (h.governments.year[x] <= year) r = x; else break }
  return r
}

/** Form of government of polity p at `year` (Government). */
export function governmentAt(h: History, p: number, year: number): number {
  const r = governmentRowAt(h, p, year)
  if (r >= 0) return h.governments.form[r]
  return h.polities[p]?.origin === PolityOrigin.League ? Government.League : Government.Monarchy
}

/** The year polity p took the form it has at `year` (its founding year without the table). */
export function governmentSince(h: History, p: number, year: number): number {
  const r = governmentRowAt(h, p, year)
  return r >= 0 ? h.governments.year[r] : h.polities[p]?.foundedYear ?? 0
}

/** The title word of a form, or null for a Monarchy (the tier word stands). `small`: city-sized (a chiefdom's tier). */
export function governmentWord(form: number, small: boolean): string | null {
  switch (form) {
    case Government.Republic: return 'Republic'
    case Government.FreeCity: return 'Free City'
    case Government.Signoria: return small ? 'Lordship' : 'Duchy'
    case Government.Theocracy: return small ? 'Holy City' : 'Theocracy'
    case Government.Confederation: return 'Confederation'
    case Government.League: return 'League'
    default: return null
  }
}

/** Lower-case description of a form ("a merchant republic"). */
export function governmentPhrase(form: number): string {
  switch (form) {
    case Government.Republic: return 'a merchant republic'
    case Government.FreeCity: return 'a free city'
    case Government.Signoria: return 'a lordship'
    case Government.Theocracy: return 'a theocracy'
    case Government.Confederation: return 'a confederation of herding clans'
    case Government.League: return 'a league of towns'
    default: return 'a monarchy'
  }
}

/** The head's title by form (null: the rulers' own words). */
export function governmentRulerWord(form: number, female: boolean, small: boolean): string | null {
  switch (form) {
    case Government.Republic: return 'Consul'
    case Government.FreeCity: return 'Burgomaster'
    case Government.Signoria: return small ? (female ? 'Lady' : 'Lord') : female ? 'Duchess' : 'Duke'
    case Government.Theocracy: return female ? 'High Priestess' : 'High Priest'
    case Government.Confederation: return female ? 'Khatun' : 'Khan'
    case Government.League: return 'Elected head'
    default: return null
  }
}

/** The form history of p as a compact timeline: "Monarchy 900-1420 · Republic 1420-1610 · Lordship 1610-". */
export function governmentTimeline(h: History, p: number): string {
  const o = h.governmentOffsets
  if (!o || p + 1 >= o.length || o[p] === o[p + 1]) return ''
  const parts: string[] = []
  const P = h.polities[p]
  for (let k = o[p]; k < o[p + 1]; k++) {
    const r = h.governmentIds[k]
    const y0 = h.governments.year[r]
    const y1 = k + 1 < o[p + 1] ? h.governments.year[h.governmentIds[k + 1]] : P && P.endedYear >= 0 ? P.endedYear : -1
    if (k + 1 < o[p + 1] && y1 === y0) continue
    const w = governmentWord(h.governments.form[r], false) ?? 'Monarchy'
    parts.push(`${w} ${y0}–${y1 >= 0 ? y1 : ''}`)
  }
  return parts.join(' · ')
}

/** How the form at the row came about, a short clause ("rose against its lord"). */
export function governmentCauseWords(cause: number): string {
  switch (cause) {
    case GovernmentCause.Charter: return 'bought its liberties with a charter'
    case GovernmentCause.Rising: return 'its burghers rose against their lord'
    case GovernmentCause.Free: return 'its merchants chose to govern themselves'
    case GovernmentCause.Freed: return 'stopped paying its due to its overlord'
    case GovernmentCause.Council: return 'the great houses abolished the throne'
    case GovernmentCause.Restored: return 'its lords were driven out and the republic restored'
    case GovernmentCause.Strongman: return 'a strongman made himself its lord'
    case GovernmentCause.Family: return 'its leading family made itself master'
    case GovernmentCause.Crowned: return 'its lords took a crown'
    case GovernmentCause.Clergy: return 'its clergy took the rule'
    case GovernmentCause.Secularised: return 'its priests lost the rule'
    case GovernmentCause.Settled: return 'its herding clans settled into a kingdom'
    default: return 'so it was founded'
  }
}
