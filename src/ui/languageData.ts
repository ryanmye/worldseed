// language: names as said in the year shown (language-drift.md §5), for every label and line of the UI that names a town.
//
// With drift (History.languages present: HistoryOptions.language, lang=1) a town's name is its form through the sound changes
// of its speakers' line up to the year (names/spoken.ts spokenNameAt). The year is the one renamingData sets: the view year,
// or the event's year inside withEventNames. Results are cached in an LRU keyed by what can change the name (the form, the
// line, the rules crossed: spokenKey), so scrubbing re-evaluates a name only when a rule date is crossed. changeYears gives the
// years at which any name can change (rule years, speech rows, exonym borrowings), which renamingData folds into namesEpoch.
// Without drift every function here answers null or nothing and the UI names towns as before.

import type { History } from '../contract.ts'
import { hasDrift, spokenKey, spokenNameAt } from '../sim/names/spoken.ts'

const CACHE_MAX = 8192
const cache = new Map<string, string>()
let cacheH: History | null = null

/** The name of town `id` said at `year` by its own speakers (or by `people`), or null without drift. */
export function spokenName(h: History, id: number, year: number, people = -1): string | null {
  if (!hasDrift(h) || id < 0 || id >= h.settlements.length) return null
  if (h !== cacheH) { cache.clear(); cacheH = h }
  const y = Number.isFinite(year) ? Math.max(0, Math.min(h.years, Math.floor(year))) : h.years
  const key = spokenKey(h, id, y, people)
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const name = spokenNameAt(h, id, y, people)
  cache.set(key, name)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return name
}

const yearsCache = new WeakMap<History, Float64Array>()

/** Sorted years at which some spoken name can change (empty without drift). */
export function changeYears(h: History | null): Float64Array {
  if (!h || !hasDrift(h)) return new Float64Array(0)
  let ys = yearsCache.get(h)
  if (ys) return ys
  const set = new Set<number>()
  const L = h.languages!
  for (let i = 0; i < L.ruleYear.length; i++) set.add(L.ruleYear[i])
  const sp = h.speech!
  for (let i = 0; i < sp.year.length; i++) set.add(sp.year[i])
  const nf = h.nameForms!
  for (let i = 0; i < nf.exoYear.length; i++) set.add(nf.exoYear[i])
  ys = Float64Array.from([...set].sort((a, b) => a - b))
  yearsCache.set(h, ys)
  return ys
}

/** How many change years are <= y (the language part of the names epoch). */
export function changeSlot(h: History | null, y: number): number {
  const a = changeYears(h)
  let lo = 0, hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (a[m] <= y) lo = m + 1
    else hi = m
  }
  return lo
}
