// renaming: the name a place bears at a year (History.renamings), for every label and line of the UI that names a town.
//
// Settlement.name is the founding name; a renamed town (a handful per history) bears another from its renaming year. The UI
// names towns in two ways:
//  - "now" (labels, the inspector's title, panels, hover readouts): the name in force at the year shown, the view year. It
//    is set once per frame (setNamesYear, from historyView.ts); that costs a binary search over the renaming years, and
//    namesEpoch() moves on only when a renaming year is crossed (or the history changes), so a panel can add the epoch to
//    the key it already compares and rebuild only then.
//  - in a line about an event (the chronicle, the inspector's history): the name at the event, so the text is a function of
//    the event and not of the year shown. withEventNames(year, fn) runs fn with names as they were during that year: a
//    renaming takes effect at the end of its year (it is a consequence of the year's events: "Thoselunoye sacks Rolto",
//    then "Rolto ... is renamed Thesmuvul"). A Distinguished renaming is the town's name from its founding, always.
// renamedName answers null for a town that bears its founding name, at once for a history without renamings (older
// histories, renaming: false): every caller then says what it said before.

import { RenameCause, type History } from '../contract.ts'

/** One renamed settlement: its renamings (History.renamings rows) in order, with their years and names. */
export interface RenamedPlace {
  rows: number[]
  years: number[]
  names: string[]
  /** A Distinguished renaming: the name from the founding on. */
  always: boolean[]
}

export interface RenamingIndex {
  /** By settlement id; only renamed settlements. */
  places: Map<number, RenamedPlace>
  /** Renaming years in order (History.renamings.year, chronological), for the epoch. */
  years: Float64Array
}

const cache = new WeakMap<History, RenamingIndex | null>()
let lastH: History | null = null
let lastIdx: RenamingIndex | null = null

/** The renamings of a history by settlement, or null when it has none (built once per history). */
export function renamingsOf(h: History | null | undefined): RenamingIndex | null {
  if (!h) return null
  if (h === lastH) return lastIdx
  let idx = cache.get(h)
  if (idx === undefined) {
    idx = build(h)
    cache.set(h, idx)
  }
  lastH = h
  lastIdx = idx
  return idx
}

function build(h: History): RenamingIndex | null {
  const R = (h as Partial<History>).renamings
  if (!R || !(R.count > 0) || !R.settlement || !R.year || !Array.isArray(R.name)) return null
  const N = h.settlements.length
  const places = new Map<number, RenamedPlace>()
  const years = new Float64Array(R.count)
  for (let i = 0; i < R.count; i++) {
    years[i] = R.year[i]
    const id = R.settlement[i]
    if (!(id >= 0 && id < N) || typeof R.name[i] !== 'string' || !R.name[i]) continue
    let p = places.get(id)
    if (!p) places.set(id, (p = { rows: [], years: [], names: [], always: [] }))
    p.rows.push(i)
    p.years.push(R.year[i])
    p.names.push(R.name[i])
    p.always.push(R.cause?.[i] === RenameCause.Distinguished)
  }
  // (the table is chronological; keep the years sorted for the binary search even if one is not)
  for (let i = 1; i < years.length; i++) if (years[i] < years[i - 1]) { years.sort(); break }
  return places.size ? { places, years } : null
}

// ---- the year names are told at

let viewYear = Infinity
let viewH: History | null = null
let viewSlot = -1
let epoch = 0
/** NaN: names at the view year; else names as during this year (withEventNames). */
let eventYear = NaN

/** Renamings with year <= y. */
function slotOf(idx: RenamingIndex | null, y: number): number {
  if (!idx) return 0
  const a = idx.years
  let lo = 0, hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (a[m] <= y) lo = m + 1
    else hi = m
  }
  return lo
}

/** The year shown (once per frame): true when a name in force changed (or the history did), which also moves namesEpoch on. */
export function setNamesYear(h: History | null, year: number): boolean {
  viewYear = year
  const idx = renamingsOf(h)
  const slot = slotOf(idx, year)
  if (h === viewH && slot === viewSlot) return false
  viewH = h
  viewSlot = slot
  epoch++
  return true
}

/** Moves on whenever the names in force at the view year change: add it to a panel's key to rebuild its names then. */
export function namesEpoch(): number {
  return epoch
}

/** Runs fn with every town named as during `year` (before that year's renamings): the names of a line about an event. */
export function withEventNames<T>(year: number, fn: () => T): T {
  const saved = eventYear
  eventYear = year
  try {
    return fn()
  } finally {
    eventYear = saved
  }
}

/** Index into p's renamings of the one in force: at the view year (inclusive), or during the event year (exclusive); -1 for the founding name. */
function inForce(p: RenamedPlace, year: number, during: boolean): number {
  let k = -1
  for (let i = 0; i < p.years.length; i++) if (p.always[i] || (during ? p.years[i] < year : p.years[i] <= year)) k = i
  return k
}

/** The name settlement `id` bears now (the view year, or the event's year inside withEventNames), or null for its founding name. */
export function renamedName(h: History, id: number): string | null {
  const idx = renamingsOf(h)
  if (!idx) return null
  const p = idx.places.get(id)
  if (!p) return null
  const during = !Number.isNaN(eventYear)
  const k = inForce(p, during ? eventYear : viewYear, during)
  return k < 0 ? null : p.names[k]
}

/** The History.renamings row in force for settlement `id` at `year` (inclusive), or -1 (its founding name). */
export function renamingRowAt(h: History, id: number, year: number): number {
  const p = renamingsOf(h)?.places.get(id)
  if (!p) return -1
  const k = inForce(p, year, false)
  return k < 0 ? -1 : p.rows[k]
}

/** A name a town bore before the one it bears at a year, with the year it gave way. */
export interface FormerName {
  name: string
  /** The year the name gave way (its last spell). */
  until: number
}

/** Earlier names of settlement `id` at `year`, oldest first, each once (its last spell), the name in force left out. */
export function formerNames(h: History, id: number, year: number): FormerName[] {
  const p = renamingsOf(h)?.places.get(id)
  if (!p) return []
  const k = inForce(p, year, false)
  if (k < 0) return []
  // the names borne in order: the founding name (unless Distinguished from the start), then each renaming's
  const seq: { name: string; from: number }[] = []
  for (let i = 0; i <= k; i++) {
    if (i === 0 && !p.always[0]) seq.push({ name: h.settlements[id]?.name ?? '', from: -Infinity })
    seq.push({ name: p.names[i], from: p.years[i] })
  }
  const now = p.names[k]
  const out: FormerName[] = []
  for (let i = 0; i + 1 < seq.length; i++) {
    const n = seq[i].name
    if (!n || n === now) continue
    const until = seq[i + 1].from
    const at = out.findIndex((f) => f.name === n)
    if (at >= 0) out.splice(at, 1)
    out.push({ name: n, until })
  }
  return out
}
