// language: the glue between the history's assembly and language drift (language-drift.md §4; HistoryOptions.language).
//
// prepareLanguage runs before any name is coined: the tree, sound changes and core vocabulary (names/drift.ts) and contact
// (names/contact.ts: shifts and loans) from the population and polity snapshots. assembleLanguage runs after the renamings:
// it packs History.languages, speech and nameForms, borrows the exonyms (§4.7: for each town that reached TOWN_POPULATION and
// each people in contact with its speakers, once, at max(founding, contact, town size), from the name said then, into that
// people's main language, from 'lang-exo-<v>-<B>'; and for each town that shifted, its new people's at the shift at the
// latest), names the languages and makes the events LanguageSplit and LanguageDied (LanguageShift and LoanWave come from
// contact). Nothing here is read by the simulation.

import { EventType, TOWN_POPULATION } from '../../../contract.ts'
import type { HistoryEvent, Languages, NameForms, People, Renamings, Settlement, Speech, World } from '../../../contract.ts'
import { createRng } from '../../rng.ts'
import { applyContact, type ContactInput, type ContactResult } from '../../names/contact.ts'
import { buildDrift, type Drift } from '../../names/drift.ts'
import { LANG } from '../../names/languageParams.ts'
import { MEANING } from '../../names/lexicon.ts'
import { borrowWord } from '../../names/placeNames.ts'
import { spokenFormAt } from '../../names/spoken.ts'
import type { SettlementNaming } from '../../names/index.ts'
import { capitalizeName, fuseWords } from '../../names/words.ts'

export interface LanguageDiag {
  nodes: number
  shifts: number
  loans: number
  visibleLoans: number
  exonyms: number
  /** Assembly milliseconds: all of it (before naming to the end), and the tree, rules, vocabulary, contact and the tables. */
  ms: number
  parts: { tree: number; rules: number; lex: number; contact: number; naming: number; tables: number }
}

export interface PreparedLanguage {
  drift: Drift
  contact: ContactResult
  t0: number
  contactMs: number
  t1: number
}

export function prepareLanguage(world: World, settlements: readonly Settlement[], years: number, contact: Omit<ContactInput, 'people' | 'parent' | 'foundedYear'>): PreparedLanguage {
  const t0 = performance.now()
  const drift = buildDrift(world, settlements, years)
  const tc = performance.now()
  const res = applyContact(drift, {
    ...contact, people: settlements.map((s) => s.people), parent: settlements.map((s) => s.parent), foundedYear: settlements.map((s) => s.foundedYear),
  })
  const t1 = performance.now()
  return { drift, contact: res, t0, contactMs: t1 - tc, t1 }
}

export interface LanguageHistory {
  languages: Languages
  speech: Speech
  nameForms: NameForms
  /** LanguageSplit, LanguageShift, LoanWave and LanguageDied, chronological. */
  events: HistoryEvent[]
  diag: LanguageDiag
}

/** Packs the tables and makes the exonyms, names and events (see the file comment). */
export function assembleLanguage(prep: PreparedLanguage, naming: SettlementNaming, settlements: readonly Settlement[], renamings: Renamings,
  renamingForms: { form: string[]; language: number[] } | undefined, peoples: readonly People[], contactYear: Int16Array,
  population: Float32Array, snapshotInterval: number, snapshotCount: number): LanguageHistory {
  const { drift } = prep
  const tTables = performance.now()
  const { tree, rules, lex } = drift
  const years = drift.years
  const S = settlements.length
  const N = tree.count
  const C = LANG.core

  // --- History.speech ---
  const sStart = new Int32Array(S + 1)
  for (let v = 0; v < S; v++) sStart[v + 1] = sStart[v] + tree.rowYear[v].length
  const speech: Speech = { start: sStart, year: new Int16Array(sStart[S]), language: new Int16Array(sStart[S]) }
  for (let v = 0; v < S; v++) {
    for (let i = 0; i < tree.rowYear[v].length; i++) { speech.year[sStart[v] + i] = tree.rowYear[v][i]; speech.language[sStart[v] + i] = tree.rowNode[v][i] }
  }

  // --- History.languages ---
  const lexStart = new Int32Array(N * C + 1)
  for (let k = 0; k < N * C; k++) lexStart[k + 1] = lexStart[k] + lex.rows[k].length
  const LR = lexStart[N * C]
  const languages: Languages = {
    count: N, parent: Int16Array.from(tree.parent), people: Int16Array.from(tree.people), splitYear: Int16Array.from(tree.splitYear),
    cause: Uint8Array.from(tree.cause), seat: Int32Array.from(tree.seat), name: new Array<string>(N).fill(''), rate: Float32Array.from(drift.rates),
    ruleStart: rules.ruleStart, ruleYear: rules.ruleYear, ruleKind: rules.ruleKind, ruleVariant: rules.ruleVariant,
    lexStart, lexYear: new Int16Array(LR), lexDonor: new Int16Array(LR), lexForm: new Array<string>(LR),
  }
  for (let k = 0; k < N * C; k++) {
    const list = lex.rows[k]
    for (let i = 0; i < list.length; i++) {
      const r = lexStart[k] + i
      languages.lexYear[r] = list[i].year; languages.lexDonor[r] = list[i].donor; languages.lexForm[r] = list[i].form
    }
  }

  // --- History.nameForms (exonyms below) ---
  const R = renamings.count
  const nameForms: NameForms = {
    form: (naming.forms ?? settlements.map((s) => s.name.toLowerCase())).slice(), language: Int16Array.from(naming.level),
    renamingForm: renamingForms ? renamingForms.form.slice(0, R) : renamings.name.map((x) => x.toLowerCase()),
    renamingLanguage: renamingForms ? Int16Array.from(renamingForms.language.slice(0, R)) : new Int16Array(R).fill(-1),
    exoSettlement: new Int32Array(0), exoPeople: new Int16Array(0), exoYear: new Int16Array(0), exoLanguage: new Int16Array(0), exoForm: [],
  }
  const partial = { settlements: settlements as Settlement[], renamings, languages, speech, nameForms }

  // --- Names of the languages (said at the end of the run) ---
  const seen = new Map<string, number>()
  for (let n = 0; n < N; n++) {
    let name = ''
    if (tree.parent[n] < 0) name = peoples[tree.people[n]]?.name ?? ''
    if (!name) {
      const seatWord = spokenFormAt(partial, tree.seat[n], Math.max(tree.splitYear[n], years)).split(/[ '-]/).sort((a, b) => b.length - a.length)[0] ?? ''
      const derive = drift.wordSaid(n, MEANING.derive, years).split('|')[0]
      name = capitalizeName(fuseWords(drift.base(n), seatWord, derive) ?? seatWord)
    }
    const lc = name.toLowerCase()
    if (seen.has(lc)) name = `${name} of ${capitalizeName(spokenFormAt(partial, tree.seat[n], years))}`
    seen.set(lc, n)
    languages.name[n] = name
  }

  // --- Exonyms ---
  const P = peoples.length
  const Q = snapshotCount, I = snapshotInterval
  /** The main language of each people at each snapshot: that of its largest town speaking a language of its own (its first language else). */
  const mainCache = new Map<number, number>()
  const firstOf = new Int32Array(P).fill(-1)
  for (let n = N - 1; n >= 0; n--) if (tree.parent[n] < 0 && tree.people[n] >= 0 && tree.people[n] < P) firstOf[tree.people[n]] = n
  const mainNode = (people: number, year: number): number => {
    const q = Math.min(Q - 1, Math.max(0, Math.floor(year / I)))
    const key = people * 100000 + q
    const hit = mainCache.get(key)
    if (hit !== undefined) return hit
    let best = -1, bx = 0
    for (let v = 0; v < S; v++) {
      const x = population[q * S + v]
      if (!(x > bx)) continue
      const n = drift.node(v, q * I)
      if (tree.people[n] === people) { bx = x; best = n }
    }
    const out = best >= 0 ? best : firstOf[people]
    mainCache.set(key, out)
    return out
  }
  const ex: { v: number; p: number; year: number; node: number; form: string }[] = []
  for (let v = 0; v < S; v++) {
    const st = settlements[v]
    let townYear = -1
    for (let q = 0; q < Q; q++) if (population[q * S + v] >= TOWN_POPULATION) { townYear = q * I; break }
    // shifts: the new people's name at the shift at the latest
    const latest = new Map<number, number>()
    for (let i = 1; i < tree.rowYear[v].length; i++) {
      if (tree.rowShift[v][i] !== 1) continue
      const p = tree.people[tree.rowNode[v][i]]
      if (!latest.has(p)) latest.set(p, tree.rowYear[v][i])
    }
    const want = new Map<number, number>() // people -> borrowing year
    if (townYear >= 0) {
      const A = tree.people[drift.node(v, townYear)]
      for (let B = 0; B < P; B++) {
        if (B === A || A < 0 || A >= P) continue
        const c = contactYear[A * P + B]
        if (c < 0) continue
        const y = Math.max(st.foundedYear, c, townYear)
        if (y <= years) want.set(B, y)
      }
    }
    for (const [p, y] of latest) { const w = want.get(p); if (w === undefined || w > y) want.set(p, y) }
    const ps = [...want.keys()].sort((a, b) => a - b)
    for (const B of ps) {
      const y = want.get(B)!
      // the shift's tongue for a shifted town, else the people's main language then
      let node = -1
      for (let i = 1; i < tree.rowYear[v].length; i++) if (tree.rowShift[v][i] === 1 && tree.rowYear[v][i] === y && tree.people[tree.rowNode[v][i]] === B) node = tree.rowNode[v][i]
      if (node < 0) node = mainNode(B, y)
      if (node < 0) continue
      const said = spokenFormAt(partial, v, y)
      const rng = createRng(drift.world.seed, `lang-exo-${v}-${B}`)
      const form = said.split(' ').map((w) => w.split('-').map((x) => (x ? borrowWord(x, drift.base(node), rng) : x)).join('-')).join(' ')
      ex.push({ v, p: B, year: y, node, form })
    }
  }
  const E = ex.length
  nameForms.exoSettlement = Int32Array.from(ex.map((x) => x.v))
  nameForms.exoPeople = Int16Array.from(ex.map((x) => x.p))
  nameForms.exoYear = Int16Array.from(ex.map((x) => x.year))
  nameForms.exoLanguage = Int16Array.from(ex.map((x) => x.node))
  nameForms.exoForm = ex.map((x) => x.form)

  // --- Events: LanguageSplit, LanguageDied (and contact's) ---
  const events: HistoryEvent[] = []
  for (let n = 0; n < N; n++) {
    if (tree.parent[n] < 0) continue
    events.push({ year: tree.splitYear[n], type: EventType.LanguageSplit, settlement: tree.seat[n], other: tree.seat[tree.parent[n]], value: n, extra: tree.cause[n] })
  }
  const living = new Uint8Array(N)
  const lastEnd = new Int32Array(N).fill(-1)
  const lastTown = new Int32Array(N).fill(-1)
  const lastBy = new Int32Array(N).fill(-1)
  const endBySplit = new Uint8Array(N)
  for (let v = 0; v < S; v++) {
    const st = settlements[v]
    const ys = tree.rowYear[v], ns = tree.rowNode[v]
    const gone = st.abandonedYear >= 0 && st.abandonedYear <= years ? st.abandonedYear : -1
    for (let i = 0; i < ys.length; i++) {
      const n = ns[i]
      const next = i + 1 < ys.length ? ys[i + 1] : -1
      if (next < 0 && gone < 0) { living[n] = 1; continue }
      const end = next >= 0 && (gone < 0 || next <= gone) ? next : gone
      if (end > lastEnd[n] || (end === lastEnd[n] && v > lastTown[n])) {
        lastEnd[n] = end
        lastTown[n] = v
        lastBy[n] = next >= 0 && end === next ? ns[i + 1] : -1
        endBySplit[n] = next >= 0 && end === next && tree.rowShift[v][i + 1] !== 1 ? 1 : 0
      }
    }
  }
  for (let n = 0; n < N; n++) {
    if (living[n] || lastTown[n] < 0 || endBySplit[n]) continue
    events.push({ year: lastEnd[n], type: EventType.LanguageDied, settlement: lastTown[n], other: -1, value: n, extra: lastBy[n] })
  }
  for (const e of prep.contact.events) events.push(e)
  events.sort((a, b) => a.year - b.year || a.type - b.type || a.settlement - b.settlement || a.value - b.value)
  return {
    languages, speech, nameForms, events,
    diag: { nodes: N, shifts: prep.contact.shifts, loans: prep.contact.loans, visibleLoans: prep.contact.visibleLoans, exonyms: E, ms: performance.now() - prep.t0,
      parts: { ...drift.ms, contact: prep.contactMs, naming: tTables - prep.t1, tables: performance.now() - tTables } },
  }
}
