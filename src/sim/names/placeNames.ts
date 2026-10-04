// renaming: new names for places renamed by history (see history/renaming/), in the languages of the world.
//
//   adaptName   the old name taken into another language: each sound becomes the nearest the new tongue has, a cluster it
//               cannot begin a word with gets a prothetic vowel or loses its first consonant ("Smyrna" -> "Izmir"), a final
//               it cannot end on takes a vowel or falls, a long name may be clipped ("Eboracum" -> "York"), and now and then
//               one of the new language's endings is added. Recognisably the old name, said by foreigners.
//   dedicate    a name for a person, a house or a faith: the name with a city ending of the language ("-abad", "-pur",
//               "-polis", "-grad"), now and then before it or as a second word.
//   freshPlace  a new name of the language (a fresh root, often with its city ending).
//   qualify     a founding name another town already bore, with the language's ending for new places ("New ...").
//
// Each language's two city endings come from 'names-cityaffix-<tribe>-<level>' (memoised per call site's cache); everything
// else from the Rng passed in. Results are capitalised; validity (length, euphony) is checked here, uniqueness by the caller.

import type { World } from '../../contract.ts'
import { createRng } from '../rng.ts'
import type { Rng } from '../rng.ts'
import type { SettlementNaming } from './index.ts'
import type { Language } from './phonology.ts'
import { buildMorph, buildRoot, capitalizeName, composeName, fuseWords, isEuphonic, letterCount, pickWeighted, toUnits } from './words.ts'

/** Longest renamed name, in letters (dedications run long: "Constantinople"). */
export const MAX_PLACE = 13

/** Nearest consonants in order of preference, for a sound the new language lacks. */
const NEAR_C: Record<string, readonly string[]> = {
  p: ['b', 'f', 't', 'k'], b: ['p', 'v', 'm', 'd'], t: ['d', 'th', 's', 'k'], d: ['t', 'th', 'n', 'r'], k: ['g', 'h', 'ch', 't'],
  g: ['k', 'h', 'ng', 'd'], m: ['n', 'b', 'p'], n: ['m', 'ng', 'l', 'r'], ng: ['n', 'g', 'm'], f: ['p', 'v', 'h', 'th'],
  v: ['b', 'w', 'f', 'm'], s: ['sh', 'z', 'th', 't'], z: ['s', 'sh', 'd'], sh: ['s', 'ch', 'z', 'h'], th: ['t', 's', 'f', 'd'],
  r: ['l', 'd', 'n'], l: ['r', 'n', 'd'], w: ['v', 'b', 'h'], y: ['l', 'h', 'r'], h: ['k', 'f', 'sh', 'g'], ch: ['sh', 'k', 't', 's'],
  gh: ['g', 'h', 'k'], kh: ['k', 'h', 'g'], ph: ['f', 'p'], dh: ['d', 'th', 't'], zh: ['z', 'sh', 's'],
}
const NEAR_V: Record<string, readonly string[]> = { a: ['o', 'e', 'u', 'i'], e: ['i', 'a', 'o', 'u'], i: ['e', 'u', 'a', 'o'], o: ['u', 'a', 'e', 'i'], u: ['o', 'i', 'a', 'e'] }
const VOWELS = 'aeiou'

function nearest(x: string, have: readonly string[], near: Record<string, readonly string[]>): string {
  if (have.indexOf(x) >= 0) return x
  const n = near[x]
  if (n) for (const y of n) if (have.indexOf(y) >= 0) return y
  return have[0] ?? x
}

/** The two city endings of a language (a short one and a longer one that can stand as a word). */
export function cityEndings(world: World, naming: SettlementNaming, cache: Map<string, string[]>, tribe: number, level: number): string[] {
  const key = tribe + ':' + level
  let e = cache.get(key)
  if (e) return e
  const lang = naming.language(tribe, level)
  const rng = createRng(world.seed, `names-cityaffix-${tribe}-${level}`)
  e = [buildMorph(lang, rng, 2, true), buildMorph(lang, rng, 3, true)]
  cache.set(key, e)
  return e
}

/** True when every word of a capitalised name is euphonic and the name is 3..max letters. */
function ok(name: string, max = MAX_PLACE): boolean {
  const n = letterCount(name)
  if (n < 3 || n > max) return false
  for (const w of name.toLowerCase().split(/[ -]/)) if (!isEuphonic(w)) return false
  return true
}

/** The main word of a name (its longest, lower case, without an apostrophe if the language writes none). */
function mainWord(name: string): string {
  let best = ''
  for (const w of name.toLowerCase().split(/[ -]/)) if (letterCount(w) > letterCount(best)) best = w
  return best
}

/** A word's sounds in the new language (nearest consonants and vowels; diphthongs it lacks lose their second vowel). */
function soundsInto(word: string, to: Language): string[] {
  const units = toUnits(word)
  const out: string[] = []
  for (let i = 0; i < units.length; i++) {
    const u = units[i]
    if (u.s === "'") { if (to.usesApostrophe) out.push("'"); continue }
    if (u.vowel) {
      const v = nearest(u.s, to.vowels, NEAR_V)
      const prev = out.length ? out[out.length - 1] : ''
      if (prev.length === 1 && VOWELS.indexOf(prev) >= 0) {
        if (to.diphthongs.indexOf(prev + v) < 0) continue // (a vowel pair the language lacks: the second falls)
      }
      out.push(v)
    } else out.push(nearest(u.s, to.consonants, NEAR_C))
  }
  return out
}

const isV = (u: string): boolean => u.length === 1 && VOWELS.indexOf(u) >= 0

/** Repairs a sound sequence to the new language's word shape: onset clusters, the final, and hiatus without an apostrophe. */
function fitShape(units: string[], to: Language, rng: Rng): string[] {
  const u = units.slice()
  // (no hiatus unless the language writes it)
  for (let i = u.length - 2; i > 0; i--) {
    if (u[i] !== "'" || to.usesApostrophe) continue
    const pair = isV(u[i - 1]) && isV(u[i + 1]) && to.diphthongs.indexOf(u[i - 1] + u[i + 1]) < 0
    u.splice(i, pair ? 2 : 1) // (the second vowel of a hiatus the language cannot write falls with it)
  }
  // An onset cluster the language lacks: a prothetic vowel, or the first consonant falls.
  if (u.length >= 3 && !isV(u[0]) && !isV(u[1]) && u[1] !== "'") {
    if (to.onsetClusters.indexOf(u[0] + u[1]) < 0) {
      if (rng.next() < 0.5) u.unshift(nearest('i', to.vowels, NEAR_V))
      else u.shift()
    }
  }
  // A final the language cannot end on: a vowel follows, or it falls.
  const last = u[u.length - 1]
  if (u.length && !isV(last) && to.finals.indexOf(last) < 0) {
    if (!to.finals.length || rng.next() < 0.55) u.push(to.vowels[rng.int(0, to.vowels.length - 1)])
    else u.pop()
  }
  return u
}

/** Euphonic variants: as is, else with an epenthetic vowel breaking the first bad consonant pair. */
function repair(units: string[], to: Language): string | null {
  const w = units.join('')
  if (isEuphonic(w)) return w
  const ep = nearest('e', to.vowels, NEAR_V)
  for (let i = 1; i < units.length; i++) {
    if (isV(units[i]) || isV(units[i - 1]) || units[i] === "'" || units[i - 1] === "'") continue
    const v = units.slice(0, i).concat([ep], units.slice(i)).join('')
    if (isEuphonic(v)) return v
  }
  return null
}

/** Vowel groups (syllables) of a sound sequence. */
function syllables(units: string[]): number {
  let n = 0
  for (let i = 0; i < units.length; i++) if (isV(units[i]) && (i === 0 || !isV(units[i - 1]))) n++
  return n
}

/** Drops the last syllable (from the onset of its vowel). */
function clip(units: string[]): string[] {
  let i = units.length - 1
  while (i >= 0 && !isV(units[i])) i--
  while (i > 0 && isV(units[i - 1])) i--
  if (i > 0 && !isV(units[i - 1])) i--
  return units.slice(0, i)
}

/**
 * The old name in the new language (see the file comment); null when no attempt gives a valid name different from the old.
 * `endings` are the new language's city endings.
 */
export function adaptName(old: string, to: Language, endings: readonly string[], rng: Rng): string | null {
  const base = mainWord(old)
  const oldLc = old.toLowerCase()
  for (let attempt = 0; attempt < 12; attempt++) {
    let u = soundsInto(base, to)
    if (syllables(u) >= 3 && rng.next() < 0.35) u = clip(u)
    u = fitShape(u, to, rng)
    let w = repair(u, to)
    if (w === null) continue
    const x = rng.next()
    if (x < 0.22) w = fuseWords(to, w, endings[rng.int(0, endings.length - 1)]) ?? w
    else if (x < 0.32) {
      const opts = to.affixes.new
      const c = composeName(to, w, opts[pickWeighted(rng, opts.map((o) => o.weight))])
      if (c !== null) w = c.toLowerCase()
    }
    if (w === base || w === oldLc || attempt >= 4) {
      // (the same sounds in both tongues: the new speakers' ending, or a vowel of theirs, sets it apart)
      const f = fuseWords(to, w, endings[rng.int(0, endings.length - 1)])
      if (f !== null && f !== base) w = f
    }
    const name = capitalizeName(w)
    if (name.toLowerCase() !== oldLc && ok(name)) return name
  }
  return null
}

/** Shortens a long base to its first two syllables (a dedication must stay a name). */
function clipBase(base: string): string {
  const u = toUnits(base).map((x) => x.s)
  if (syllables(u) <= 2 || letterCount(base) <= 6) return base
  let k = 0, i = 0
  for (; i < u.length; i++) { if (isV(u[i]) && (i === 0 || !isV(u[i - 1]))) { k++; if (k === 3) break } }
  // (cut before the third syllable's onset)
  let j = i
  if (j > 0 && !isV(u[j - 1])) j--
  return u.slice(0, j).join('')
}

/** A name for a person, a house or a faith: `honoree` with a city ending of `lang`. Null when nothing fits. */
export function dedicate(honoree: string, lang: Language, endings: readonly string[], rng: Rng): string | null {
  const full = mainWord(honoree)
  for (let attempt = 0; attempt < 10; attempt++) {
    const base = attempt < 3 && rng.next() < 0.6 ? full : clipBase(full)
    const e = endings[rng.int(0, endings.length - 1)]
    const x = rng.next()
    let name: string | null = null
    if (x < 0.14 && lang.twoWord && letterCount(endings[1]) >= 3) name = capitalizeName(base) + ' ' + capitalizeName(endings[1])
    else if (x < 0.24) { const f = fuseWords(lang, e, base); name = f === null ? null : capitalizeName(f) }
    else { const f = fuseWords(lang, base, e); name = f === null ? null : capitalizeName(f) }
    if (name !== null && ok(name)) return name
  }
  return null
}

/** A fresh name of the language: a new root, often with its city ending or its ending for new places. */
export function freshPlace(lang: Language, endings: readonly string[], rng: Rng): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const root = buildRoot(lang, rng)
    const x = rng.next()
    let name: string | null
    if (x < 0.4) { const f = fuseWords(lang, root, endings[rng.int(0, endings.length - 1)]); name = f === null ? null : capitalizeName(f) }
    else if (x < 0.55) { const opts = lang.affixes.new; name = composeName(lang, root, opts[pickWeighted(rng, opts.map((o) => o.weight))]) }
    else name = capitalizeName(root)
    if (name !== null && ok(name, 12)) return name
  }
  return capitalizeName(buildRoot(lang, rng))
}

/** A founding name already borne elsewhere, qualified with the language's ending for new places (or its city ending). */
export function qualify(name: string, lang: Language, endings: readonly string[], rng: Rng): string | null {
  const base = mainWord(name)
  for (let attempt = 0; attempt < 8; attempt++) {
    let cand: string | null
    if (attempt < 5) { const opts = lang.affixes.new; cand = composeName(lang, base, opts[pickWeighted(rng, opts.map((o) => o.weight))]) }
    else { const f = fuseWords(lang, base, endings[rng.int(0, endings.length - 1)]); cand = f === null ? null : capitalizeName(f) }
    if (cand !== null && cand.toLowerCase() !== name.toLowerCase() && ok(cand)) return cand
  }
  return null
}
