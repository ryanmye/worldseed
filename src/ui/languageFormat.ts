// language: chronicle and inspector lines for the language events (250-253), the inspector's etymology line and the language
// lines of the peoples panel (language-drift.md §6). Hedged, like the other chronicle lines: the history is a story about
// invented tongues, not a record. Every function answers null or '' without drift (History.languages absent).

import { EventType, LanguageSplitCause, renamingAt, type History, type HistoryEvent } from '../contract.ts'
import { LANG } from '../sim/names/languageParams.ts'
import { MEANING } from '../sim/names/lexicon.ts'
import { ruleSpec, evolve } from '../sim/names/soundChange.ts'
import { exonymRow, hasDrift, languageAt, sayForm, speechRowAt, spokenNameAt, stagedName } from '../sim/names/spoken.ts'
import { romanize } from '../sim/names/typology/orthography.ts'
import { spokenName } from './languageData.ts'
import { namesYear } from './renamingData.ts'

/** A town's name as said in the year names are told at (format.ts settlementName, without importing it). */
const settlementName = (h: History, id: number): string => (id >= 0 && id < h.settlements.length ? spokenName(h, id, namesYear()) ?? h.settlements[id].name : 'a town')

export const isLanguageEvent = (t: number): boolean => t >= EventType.LanguageSplit && t <= EventType.LanguageDied

function langName(h: History, n: number): string {
  const L = h.languages
  return L && n >= 0 && n < L.count ? L.name[n] : 'a tongue'
}

/** Chronicle line for a language event, or null for other events (or without drift). */
export function describeLanguageEvent(h: History, e: HistoryEvent): string | null {
  if (!isLanguageEvent(e.type as number) || !hasDrift(h)) return null
  const L = h.languages!
  const town = settlementName(h, e.settlement)
  const extra = e.extra ?? -1
  switch (e.type as number) {
    case EventType.LanguageSplit: {
      const parent = L.parent[e.value] >= 0 ? langName(h, L.parent[e.value]) : 'its mother tongue'
      return e.extra === LanguageSplitCause.Overseas
        ? `Across the sea the speech of the ${parent} settlers about ${town} has grown, it seems, into a tongue of its own, ${langName(h, e.value)}`
        : `In the far country about ${town} the ${parent} tongue has grown, it seems, into one of its own, ${langName(h, e.value)}`
    }
    case EventType.LanguageShift:
      return `By about ${e.year} the townsfolk of ${town} speak the ${langName(h, e.value)} of their rulers`
    case EventType.LoanWave:
      return `Many ${langName(h, extra)} words have entered ${langName(h, e.value)}, it seems, under ${langName(h, extra)} rule`
    case EventType.LanguageDied:
      return extra >= 0
        ? `The last speakers of ${langName(h, e.value)}, at ${town}, have given up their tongue for ${langName(h, extra)}`
        : `${langName(h, e.value)} is heard no more: its last town, ${town}, lies empty`
  }
  return null
}

/** Inspector line for a language event from the point of view of settlement `id`, or null. */
export function describeLanguageEventFor(h: History, e: HistoryEvent, id: number): string | null {
  if (!isLanguageEvent(e.type as number) || !hasDrift(h)) return null
  if (e.type === EventType.LanguageShift && e.settlement === id) return `Its people took up ${langName(h, e.value)}, the tongue of their rulers`
  if (e.type === EventType.LanguageSplit && e.settlement === id) return `Its speech grew into a tongue of its own, ${langName(h, e.value)}`
  if (e.type === EventType.LanguageDied && e.settlement === id) return `The last town to speak ${langName(h, e.value)}`
  return describeLanguageEvent(h, e)
}

/**
 * The inspector's etymology line for settlement `id` at `year`: "From Old Vashtari Vashtarum (founded 412); the Leko call it
 * Bastar". A town that took up another tongue: "Its people took up Kepian about 1310; formerly Tiboi in Lekoan". '' without drift.
 */
export function etymologyLine(h: History, id: number, year: number): string {
  if (!hasDrift(h) || id < 0 || id >= h.settlements.length) return ''
  const L = h.languages!, nf = h.nameForms!, sp = h.speech!
  const st = h.settlements[id]
  if (year < st.foundedYear) return ''
  const parts: string[] = []
  const now = spokenNameAt(h, id, year)
  const k = renamingAt(h, id, year)
  const coinYear = k < 0 ? st.foundedYear : h.renamings.year[k]
  const coinLang = k < 0 ? nf.language[id] : nf.renamingLanguage[k]
  const then = k < 0 ? st.name : h.renamings.name[k]
  const row = speechRowAt(h, id, year)
  const shifted = row > sp.start[id] && L.people[sp.language[row]] !== L.people[sp.language[sp.start[id]]]
  if (shifted) {
    const before = spokenNameAt(h, id, sp.year[row] - 1)
    parts.push(`Its people took up ${langName(h, sp.language[row])} about ${sp.year[row]}; formerly ${before} in ${langName(h, sp.language[row - 1])}`)
  } else if (then.toLowerCase() !== now.toLowerCase() && coinLang >= 0) {
    parts.push(`From ${stagedName(h, coinLang, coinYear)} ${then} (${k < 0 ? 'founded' : 'named'} ${coinYear})`)
  }
  // what the people of the largest other tongue in contact call it
  const mine = languageAt(h, id, year)
  for (let p = 0; p < h.peoples.length; p++) {
    if (mine >= 0 && p === L.people[mine]) continue
    const e = exonymRow(h, id, p, year)
    if (e < 0) continue
    const x = sayForm(L, evolve(L, nf.exoForm[e], nf.exoLanguage[e], nf.exoYear[e], year, LANG.minNameLetters), nf.exoLanguage[e])
    if (x.toLowerCase() === now.toLowerCase()) continue
    parts.push(`the ${h.peoples[p].name} call it ${x}`)
    if (parts.length >= 3) break
  }
  const s = parts.join('; ')
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

/** Shared core vocabulary (of LANG.core meanings) of languages a and b at `year`: same row = same cognate set. */
export function sharedCore(h: History, a: number, b: number, year: number): number {
  const L = h.languages
  if (!L) return 0
  let same = 0
  for (let m = 0; m < LANG.core; m++) if (wordRow(h, a, m, year) === wordRow(h, b, m, year)) same++
  return same / LANG.core
}

/** The lex row in force for meaning m in language n at `year` (History.languages lex columns), -1 none. */
export function wordRow(h: History, n: number, m: number, year: number): number {
  const L = h.languages!
  const C = LANG.core
  let end = Infinity
  for (let k = n; k >= 0; k = L.parent[k]) {
    for (let r = L.lexStart[k * C + m + 1] - 1; r >= L.lexStart[k * C + m]; r--) {
      const y = L.lexYear[r]
      if (y <= year && y < end) return r
    }
    end = L.splitYear[k]
  }
  return -1
}

/** The word for meaning m in language n as said at `year` (the first of an affix's texts). */
export function wordSaid(h: History, n: number, m: number, year: number): string {
  const L = h.languages!
  const r = wordRow(h, n, m, year)
  if (r < 0) return ''
  const w = L.lexForm[r].split('|')[0]
  const said = evolve(L, w, n, L.lexDonor[r] < 0 ? -1 : L.lexYear[r], year, 2)
  return L.model === 1 && L.ortho ? romanize(said, L.ortho[n], 'scholarly') : said // (typology: spelt for the panel)
}

/**
 * The language lines of people p at `year` for the peoples panel: each of its languages (in tree order) with its start, the
 * towns that speak it, its shared core with its mother tongue, its word for "river", and its latest sound changes.
 */
let linesKey = ''
let linesH: History | null = null
let linesOut: string[] = []
export function peopleLanguageLines(h: History, p: number, year: number): string[] {
  if (!hasDrift(h)) return []
  if (h === linesH && linesKey === `${p}|${year}`) return linesOut.slice()
  linesH = h
  linesKey = `${p}|${year}`
  linesOut = peopleLanguageLinesUncached(h, p, year)
  return linesOut.slice()
}

function peopleLanguageLinesUncached(h: History, p: number, year: number): string[] {
  const L = h.languages!
  const towns = new Int32Array(L.count)
  for (let id = 0; id < h.settlements.length; id++) {
    const s = h.settlements[id]
    if (s.foundedYear > year || (s.abandonedYear >= 0 && s.abandonedYear <= year)) continue
    const n = languageAt(h, id, year)
    if (n >= 0) towns[n]++
  }
  const out: string[] = []
  for (let n = 0; n < L.count && out.length < 12; n++) {
    if (L.people[n] !== p || L.splitYear[n] > year) continue
    let depth = 0
    for (let k = L.parent[n]; k >= 0; k = L.parent[k]) depth++
    const from = L.parent[n] < 0 ? '' : ` · from ${langName(h, L.parent[n])} ${L.splitYear[n]} (${L.cause[n] === LanguageSplitCause.Overseas ? 'overseas' : 'distance'}), ${Math.round(sharedCore(h, n, L.parent[n], year) * 100)}% shared core`
    const river = wordSaid(h, n, MEANING.affix, year)
    const rules: string[] = []
    for (let r = L.ruleStart[n + 1] - 1; r >= L.ruleStart[n] && rules.length < 2; r--) {
      if (L.ruleYear[r] > year) continue
      const spec = ruleSpec(L.ruleKind[r], L.ruleVariant[r], L.model === 1)
      if (spec) rules.push(`c. ${L.ruleYear[r]}: ${spec.label}`)
    }
    out.push(`${'· '.repeat(depth)}${langName(h, n)}: ${towns[n] ? `${towns[n]} town${towns[n] === 1 ? '' : 's'}` : 'no speakers'}${from}${river ? ` · "river" ${river}` : ''}${rules.length ? ` · ${rules.join('; ')}` : ''}`)
  }
  return out
}

/** The Legend's archaic form of a town's name: as said when it was coined, when that differs from now ("men now say Vastra"). */
export function archaicName(h: History, id: number, year: number): string | null {
  if (!hasDrift(h)) return null
  const k = renamingAt(h, id, year)
  const coinYear = k < 0 ? h.settlements[id].foundedYear : h.renamings.year[k]
  const old = spokenNameAt(h, id, coinYear)
  return old.toLowerCase() === spokenNameAt(h, id, year).toLowerCase() ? null : old
}
