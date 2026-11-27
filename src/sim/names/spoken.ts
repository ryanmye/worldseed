// language: the name a town is said by at a year (language-drift.md §5), pure and shared by the assembly and the UI.
//
// spokenNameAt(h, id, year) is the endonym: the name in force (the founding name or the renaming in force) as an underlying
// form, through the sound changes of the line of the language the town speaks that year. A town that took up another people's
// tongue (a LanguageShift) is called by that people's exonym of it, worn by their changes, until it is renamed again.
// spokenNameAt(h, id, year, people) is what `people` calls it: their exonym when they borrowed one, else the endonym.
// Without drift (an older history, or HistoryOptions.language off) both are settlementNameAt.

import { renamingAt, settlementNameAt } from '../../contract.ts'
import type { History } from '../../contract.ts'
import { LANG } from './languageParams.ts'
import { evolve, isAncestor, rulesCrossed } from './soundChange.ts'
import { capitalizeName } from './words.ts'

export type SpokenSource = Pick<History, 'settlements' | 'renamings'> & Partial<Pick<History, 'languages' | 'speech' | 'nameForms'>>

/** Whether h carries drift tables (HistoryOptions.language on). */
export function hasDrift(h: SpokenSource): boolean {
  return !!h.languages && h.languages.count > 0 && !!h.speech && !!h.nameForms && h.speech.start.length === h.settlements.length + 1
}

/** The speech row in force for settlement `id` at `year` (its founding row before its founding), or -1 without drift. */
export function speechRowAt(h: SpokenSource, id: number, year: number): number {
  const sp = h.speech
  if (!sp || id < 0 || id + 1 >= sp.start.length) return -1
  const a = sp.start[id], b = sp.start[id + 1]
  if (a >= b) return -1
  let k = a
  for (let i = a + 1; i < b; i++) if (sp.year[i] <= year) k = i
  return k
}

/** The language settlement `id` speaks at `year` (History.languages id), or -1 without drift. */
export function languageAt(h: SpokenSource, id: number, year: number): number {
  const k = speechRowAt(h, id, year)
  return k < 0 ? -1 : h.speech!.language[k]
}

/** Row of the exonym `people` borrowed for town `id` by `year`, or -1. */
export function exonymRow(h: SpokenSource, id: number, people: number, year: number): number {
  const nf = h.nameForms
  if (!nf) return -1
  const S = nf.exoSettlement
  let lo = 0, hi = S.length
  while (lo < hi) { const m = (lo + hi) >>> 1; if (S[m] < id || (S[m] === id && nf.exoPeople[m] < people)) lo = m + 1; else hi = m }
  return lo < S.length && S[lo] === id && nf.exoPeople[lo] === people && nf.exoYear[lo] <= year ? lo : -1
}

/** What spokenFormAt says, before the sound changes: the form, the language whose line wears it, and the year it entered it. */
export interface SpokenSpec {
  form: string
  node: number
  from: number
  /** The exonym row used, or -1 (the town's own name). */
  exo: number
}

/** The form and line of the name of `id` at `year` (see the file comment), or null without drift. */
export function spokenSpec(h: SpokenSource, id: number, year: number, people = -1): SpokenSpec | null {
  if (!hasDrift(h)) return null
  const L = h.languages!, nf = h.nameForms!
  const k = renamingAt(h, id, year)
  const form = k < 0 ? nf.form[id] : nf.renamingForm[k]
  const coin = k < 0 ? nf.language[id] : nf.renamingLanguage[k]
  if (form === undefined || !(coin >= 0 && coin < L.count)) return null
  const since = k < 0 ? h.settlements[id].foundedYear : h.renamings.year[k]
  const speaker = languageAt(h, id, year)
  const want = people >= 0 ? people : speaker >= 0 ? L.people[speaker] : L.people[coin]
  if (want !== L.people[coin]) {
    const e = exonymRow(h, id, want, year)
    if (e >= 0 && (people >= 0 || nf.exoYear[e] >= since)) {
      const x = nf.exoLanguage[e]
      return { form: nf.exoForm[e], node: people < 0 && speaker >= 0 && isAncestor(L, x, speaker) ? speaker : x, from: nf.exoYear[e], exo: e }
    }
  }
  const node = speaker >= 0 && isAncestor(L, coin, speaker) ? speaker : coin
  return { form, node, from: -1, exo: -1 }
}

/** The name of `id` said at `year` (lower case), by its own speakers, or by `people` (see the file comment). */
export function spokenFormAt(h: SpokenSource, id: number, year: number, people = -1): string {
  const spec = spokenSpec(h, id, year, people)
  if (!spec) return settlementNameAt(h, id, year).toLowerCase()
  return evolve(h.languages!, spec.form, spec.node, spec.from, year, LANG.minNameLetters)
}

/** The name of `id` said at `year`, capitalised (see the file comment). */
export function spokenNameAt(h: SpokenSource, id: number, year: number, people = -1): string {
  const spec = spokenSpec(h, id, year, people)
  if (!spec) return settlementNameAt(h, id, year)
  return capitalizeName(evolve(h.languages!, spec.form, spec.node, spec.from, year, LANG.minNameLetters))
}

/** A key that changes only when the spoken name of `id` at `year` can (the UI cache key). */
export function spokenKey(h: SpokenSource, id: number, year: number, people = -1): string {
  const spec = spokenSpec(h, id, year, people)
  if (!spec) return `${id}|${renamingAt(h, id, year)}`
  return `${id}|${people}|${spec.exo}|${spec.node}|${spec.form}|${rulesCrossed(h.languages!, spec.node, spec.from, year)}`
}

/** "Old X" within LANG.oldYears of a language's start, "Middle X" until LANG.middleYears, else X (for a name coined at `year`). */
export function stagedName(h: SpokenSource, node: number, year: number): string {
  const L = h.languages
  if (!L || node < 0 || node >= L.count) return ''
  const age = year - L.splitYear[node]
  const name = L.name[node]
  return age < LANG.oldYears ? `Old ${name}` : age < LANG.middleYears ? `Middle ${name}` : name
}
