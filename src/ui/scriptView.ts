// typology: a town's name in its speakers' native script, as inline SVG (language-typology-scripts.md §6.5, §9.2). DOM-free
// string building; the city card puts it under the plain name. Glyph sets are generated lazily (names/script/builders.ts) and
// runs kept in an LRU of 1024. The glyph seed is the world's, read off the history as its founders' cells (History carries no
// seed; the founders' cells are the world's alone), so a world's scripts look alike across reloads.

import { scriptAt, type History } from '../contract.ts'
import { languageAt, spokenFormAt, spokenKey } from '../sim/names/spoken.ts'
import { signSet, transcribe } from '../sim/names/script/builders.ts'
import { pathOf } from '../sim/names/script/glyphs.ts'

const runs = new Map<string, string | null>()
let runsH: History | null = null

/** The glyph seed of a history (see the file comment). */
export function glyphSeed(h: History): number {
  let s = 0x9e3779b9
  for (let i = 0; i < Math.min(8, h.settlements.length); i++) s = Math.imul(s ^ h.settlements[i].cell, 0x85ebca6b) >>> 0
  return s >>> 0
}

/** The script town `id`'s speakers write at `year` (History.scripts id), or -1 (unwritten, or no scripts). */
export function townScript(h: History, id: number, year: number): number {
  if (!h.scripts || !h.languages) return -1
  const n = languageAt(h, id, year)
  return n >= 0 ? scriptAt(h, h.languages.people[n], year) : -1
}

/** Inline SVG of the native-script name of town `id` at `year` (`em` px high), or null when it is unwritten. */
export function nameRunSvg(h: History, id: number, year: number, em = 18): string | null {
  const s = townScript(h, id, year)
  if (s < 0) return null
  if (runsH !== h) { runs.clear(); runsH = h }
  const key = `${spokenKey(h, id, year)}|${s}|${em}`
  if (runs.has(key)) return runs.get(key)!
  const set = signSet(glyphSeed(h), h, s)
  let out: string | null = null
  if (set) {
    const run = transcribe(set, spokenFormAt(h, id, year), true)
    if (run.glyphs.length) {
      const vertical = run.dir === 2
      const order = run.dir === 1 ? run.glyphs.slice().reverse() : run.glyphs
      const step = 110
      const w = vertical ? 100 : order.length * step, hgt = vertical ? order.length * step : 100
      const sw = 9
      const parts = order.map((g, i) => `<path transform="translate(${vertical ? 0 : i * step} ${vertical ? i * step : 0})" d="${pathOf(set.glyphs[g])}"/>`)
      const pw = vertical ? em : (em * w) / 100, ph = vertical ? (em * hgt) / 100 : em
      out = `<svg class="script-run" viewBox="-6 -6 ${w + 12} ${hgt + 12}" width="${Math.round(pw)}" height="${Math.round(ph)}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${h.scripts!.name[s]} script">${parts.join('')}</svg>`
    }
  }
  if (runs.size > 1024) runs.clear()
  runs.set(key, out)
  return out
}
