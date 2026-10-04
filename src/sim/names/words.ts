// Pure string/phoneme helpers used to build roots, short affix morphs and to
// fuse a root with an affix. No randomness lives below `buildRoot`/`buildMorph`
// except through the `Rng` passed in; `fuse*` and the validity checks are pure
// functions of their string arguments so composition stays deterministic and
// cheap to retry.
//
// `isEuphonic` is the single gate every generated word passes: it rejects
// awkward vowel hiatus, harsh or over-long consonant clusters (and any cluster
// at the end of a word), doubled letters, repeated syllables ("itit", "nufnu")
// and a consonant used three or more times ("Moththathis").

import type { Rng } from '../rng.ts'
import type { AffixOption, Language } from './phonology.ts'

/** Consonants that may end a word, best first (sonorants before stops). */
export const FINAL_OK = ['n', 'r', 'l', 's', 'm', 'th', 'sh', 't', 'k', 'd', 'ng']
/** Consonants that may close a syllable before another consonant. */
export const CODA_OK = ['n', 'm', 'r', 'l', 's']
export const ONSET_CLUSTERS_OK = ['tr', 'dr', 'kr', 'gr', 'pr', 'br', 'fr', 'thr', 'shr', 'st', 'sk', 'sp', 'sl', 'pl', 'bl', 'gl', 'fl', 'kl']
export const DIPHTHONGS_OK = ['ai', 'au', 'ei', 'ou', 'ia', 'io', 'oi', 'ea']

const VOWEL_CHARS = 'aeiou'
/** Digraphs that count as one consonant phoneme for run-length purposes. */
const DIGRAPHS = ['ng', 'sh', 'th', 'ch']
/** Further digraphs from sound shifts; they count as two letters toward consonant runs. */
const SOFT_DIGRAPHS = ['gh', 'kh', 'ph', 'dh', 'zh']

function isVowelChar(ch: string): boolean {
  return VOWEL_CHARS.indexOf(ch) >= 0
}

export interface Unit {
  s: string
  vowel: boolean
  /** Weight toward a consonant run (2 for the soft digraphs). */
  w: number
}

/** Splits a lowercase word into phoneme units; an apostrophe becomes a break unit (s = "'"). */
export function toUnits(s: string): Unit[] {
  const units: Unit[] = []
  let i = 0
  while (i < s.length) {
    const two = s.slice(i, i + 2)
    if (DIGRAPHS.indexOf(two) >= 0) {
      units.push({ s: two, vowel: false, w: 1 })
      i += 2
      continue
    }
    if (SOFT_DIGRAPHS.indexOf(two) >= 0) {
      units.push({ s: two, vowel: false, w: 2 })
      i += 2
      continue
    }
    const c = s[i]
    if (c === "'") units.push({ s: c, vowel: false, w: 0 })
    else units.push({ s: c, vowel: isVowelChar(c), w: 1 })
    i++
  }
  return units
}

/** Splits a lowercase ASCII word into phoneme units, treating known digraphs as one unit. */
function phonemeUnits(s: string): boolean[] {
  const units: boolean[] = [] // true = vowel unit
  let i = 0
  while (i < s.length) {
    const two = s.slice(i, i + 2)
    if (DIGRAPHS.indexOf(two) >= 0) {
      units.push(false)
      i += 2
      continue
    }
    const c = s[i]
    if (c === "'" || c === '-' || c === ' ') { i++; continue }
    units.push(isVowelChar(c))
    i++
  }
  return units
}

/** Longest run of consecutive consonant phonemes (digraph-aware). */
export function maxConsonantRun(s: string): number {
  const units = phonemeUnits(s.toLowerCase())
  let run = 0
  let best = 0
  for (const v of units) {
    run = v ? 0 : run + 1
    if (run > best) best = run
  }
  return best
}

/** True if any letter repeats 3+ times in a row (orthographic, not phoneme-aware). */
export function hasTripleRepeatLetter(s: string): boolean {
  let run = 1
  for (let i = 1; i < s.length; i++) {
    if (s[i] === s[i - 1] && s[i] !== '-' && s[i] !== ' ') {
      run++
      if (run >= 3) return true
    } else run = 1
  }
  return false
}

/** Count of ASCII letters only (ignores spaces, hyphens, apostrophes). */
export function letterCount(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) n++
  }
  return n
}

const SONORANTS = ['n', 'm', 'r', 'l']
const OBSTRUENTS = ['t', 'd', 'k', 'g', 'p', 'b', 'f', 'v', 'th']

/** Whether consonant a may close a syllable before consonant b inside a word. */
function medialPairOk(a: Unit, b: Unit): boolean {
  if (a.w > 1 || b.w > 1 || a.s === b.s) return false
  if (SONORANTS.indexOf(a.s) >= 0) {
    if (b.s === 'h' || b.s === 'w' || b.s === 'y' || b.s === 'ng') return false
    if (a.s === 'n') return b.s !== 'p' && b.s !== 'b' && b.s !== 'm'
    if (a.s === 'm') return b.s === 'p' || b.s === 'b'
    return true // r, l before anything else
  }
  if (a.s === 's') return b.s === 't' || b.s === 'k' || b.s === 'p' || b.s === 'm' || b.s === 'n' || b.s === 'l'
  if (OBSTRUENTS.indexOf(a.s) >= 0) return b.s === 'r' || (b.s === 'l' && a.s !== 't' && a.s !== 'd' && a.s !== 'th')
  return false
}

const REPEATED_CHUNK = /([a-z]{2,})\1/
const REPEATED_CV = /([b-df-hj-np-tv-z][aeiou])[a-z]?\1/
const DOUBLED = /([a-z])\1/

/**
 * Phonotactic gate for one lowercase word (letters and apostrophes): vowel runs of
 * at most a known diphthong, at most two consonants together (a known onset
 * cluster at the start, a sonorant or s + consonant or stop + liquid inside, and a
 * single allowed final consonant at the end), no doubled letters, no repeated
 * syllables and no consonant used three times.
 */
export function isEuphonic(word: string): boolean {
  if (letterCount(word) < 2) return false
  if (DOUBLED.test(word) || REPEATED_CHUNK.test(word) || REPEATED_CV.test(word)) return false
  const u = toUnits(word)
  const n = u.length
  if (u[0].s === "'" || u[n - 1].s === "'") return false
  let i = 0
  let apostrophes = 0
  while (i < n) {
    if (u[i].s === "'") {
      // only between two vowels, at most once
      if (++apostrophes > 1 || !u[i - 1].vowel || !u[i + 1].vowel) return false
      i++
      continue
    }
    let j = i
    const vowel = u[i].vowel
    while (j < n && u[j].s !== "'" && u[j].vowel === vowel) j++
    const len = j - i
    if (vowel) {
      if (len > 2) return false
      if (len === 2 && DIPHTHONGS_OK.indexOf(u[i].s + u[i + 1].s) < 0) return false
    } else {
      let w = 0
      for (let k = i; k < j; k++) w += u[k].w
      if (w > 2) return false
      if (i === 0) {
        if (len === 1 && u[0].s === 'ng') return false
        if (len === 2 && ONSET_CLUSTERS_OK.indexOf(u[0].s + u[1].s) < 0) return false
      } else if (j === n) {
        if (len > 1 || FINAL_OK.indexOf(u[i].s) < 0) return false
      } else if (len === 2 && !medialPairOk(u[i], u[i + 1])) return false
      if (len > 2) return false
    }
    i = j
  }
  // no consonant phoneme three times, none twice around one vowel ("Mumo", "Gigar", "Choch")
  for (let a = 0; a < n; a++) {
    if (u[a].vowel || u[a].s === "'") continue
    if (a + 2 < n && u[a + 1].vowel && u[a + 2].s === u[a].s) return false
    let count = 0
    for (let b = 0; b < n; b++) if (u[b].s === u[a].s) count++
    if (count >= 3) return false
  }
  return true
}

export function capFirst(w: string): string {
  return w.length ? w[0].toUpperCase() + w.slice(1) : w
}

/** Capitalises each space/hyphen-separated word; apostrophes stay mid-word. */
export function capitalizeName(s: string): string {
  return s
    .split(' ')
    .map((word) => word.split('-').map(capFirst).join('-'))
    .join(' ')
}

/** Weighted pick over parallel weights; falls back to the last index if weights sum to 0. */
export function pickWeighted(rng: Rng, weights: readonly number[]): number {
  let total = 0
  for (const w of weights) total += w
  if (total <= 0) return weights.length - 1
  let x = rng.next() * total
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i]
    if (x < 0) return i
  }
  return weights.length - 1
}

function pick(rng: Rng, list: readonly string[]): string {
  return list[rng.int(0, list.length - 1)]
}
function vowel(lang: Language, rng: Rng): string {
  return lang.diphthongs.length && rng.next() < 0.16 ? pick(rng, lang.diphthongs) : pick(rng, lang.vowels)
}

function startsWithVowel(s: string): boolean {
  return s.length > 0 && isVowelChar(s[0])
}
function endsWithVowel(s: string): boolean {
  return s.length > 0 && isVowelChar(s[s.length - 1])
}

/**
 * A root word of minSyll..maxSyll syllables. Syllable shapes follow the language's
 * weights; a vowel-initial syllable never follows a vowel-final one (unless the
 * language writes hiatus with an apostrophe), clusters only open the word, and the
 * last syllable is open with the language's openFinal chance, else closed by one of
 * its allowed final consonants.
 */
export function buildRoot(lang: Language, rng: Rng): string {
  let text = ''
  const W = lang.shapeWeights
  for (let attempt = 0; attempt < 60; attempt++) {
    const k = lang.maxSyll > lang.minSyll && rng.next() < lang.longWord ? lang.maxSyll : lang.minSyll
    const openEnd = !lang.finals.length || rng.next() < lang.openFinal
    text = ''
    let apostrophe = false
    for (let i = 0; i < k; i++) {
      const last = i === k - 1
      const afterVowel = text.length > 0 && endsWithVowel(text)
      const hiatus = afterVowel && lang.usesApostrophe && !apostrophe
      // V, CV, VC, CVC, CCV
      const w = [W[0], W[1], W[2], W[3], i === 0 ? W[4] : 0]
      if (afterVowel && !hiatus) w[0] = w[2] = 0
      if (afterVowel && hiatus) { w[0] *= 0.3; w[2] *= 0.3 }
      if (last && openEnd) w[2] = w[3] = 0
      if (last && !openEnd) w[0] = w[1] = w[4] = 0
      if (!last && !lang.codaConsonants.length) w[2] = w[3] = 0
      const shape = pickWeighted(rng, w)
      const onset = shape === 1 || shape === 3 ? pick(rng, lang.consonants) : shape === 4 ? pick(rng, lang.onsetClusters.length ? lang.onsetClusters : lang.consonants) : ''
      const v = vowel(lang, rng)
      const closed = shape === 2 || shape === 3
      const coda = closed ? pick(rng, last ? lang.finals : lang.codaConsonants) : ''
      if (!onset && afterVowel) {
        text += "'"
        apostrophe = true
      }
      text += onset + v + coda
    }
    const letters = letterCount(text)
    if (letters >= (apostrophe ? 5 : 3) && letters <= 8 && isEuphonic(text)) return text
  }
  // practically unreachable: a plain CVCV from the inventory
  const c0 = lang.consonants.find((c) => c.length === 1) ?? 'n'
  return c0 + lang.vowels[0] + 'r' + (lang.vowels[1] ?? 'a')
}

/**
 * A short 1-syllable affix morph of minLetters..4 letters. `final` morphs end a word,
 * so a closing consonant must be one of the language's finals.
 */
export function buildMorph(lang: Language, rng: Rng, minLetters = 2, final = true): string {
  let text = ''
  const codas = final ? lang.finals : lang.finals.concat(lang.codaConsonants)
  for (let attempt = 0; attempt < 30; attempt++) {
    const shape = codas.length ? rng.int(0, 2) : 0 // CV, VC, CVC
    const v = vowel(lang, rng)
    text = shape === 0 ? pick(rng, lang.consonants) + v : shape === 1 ? v + pick(rng, codas) : pick(rng, lang.consonants) + v + pick(rng, codas)
    const letters = letterCount(text)
    if (letters >= minLetters && letters <= 4 && isEuphonic(text)) return text
  }
  return lang.vowels[0] + 'n'
}

/** Joins two lowercase words, smoothing the seam; null when no smoothing gives a euphonic word. */
export function fuseWords(lang: Language, a: string, b: string): string | null {
  const link = lang.vowels.find((v) => v.length === 1) ?? 'a'
  const cands: string[] = []
  if (endsWithVowel(a) && startsWithVowel(b)) cands.push(a + b, a.slice(0, -1) + b, a + b.slice(1))
  else if (!endsWithVowel(a) && !startsWithVowel(b)) {
    cands.push(a + b, a + link + b)
    if (endsWithVowel(a.slice(0, -1))) cands.push(a.slice(0, -1) + b)
  } else cands.push(a + b)
  for (const c of cands) if (isEuphonic(c)) return c
  return null
}

/** Longest single word, in letters, of a settlement name. */
const MAX_WORD = 10
/** Longest two-word name, in letters. */
const MAX_TWO_WORDS = 11

/** Composes a settlement's display name from its root and an optional site/ancestry affix; null if they do not combine well. */
export function composeName(lang: Language, rootText: string, affix: AffixOption | undefined): string | null {
  if (!affix) return capitalizeName(rootText)
  if (affix.attach === 'space' || affix.attach === 'hyphen') {
    if (letterCount(rootText) + letterCount(affix.text) > MAX_TWO_WORDS || letterCount(rootText) > 7) return null
    const sep = affix.attach === 'space' ? ' ' : '-'
    return affix.kind === 'prefix'
      ? capitalizeName(affix.text) + sep + capitalizeName(rootText)
      : capitalizeName(rootText) + sep + (affix.attach === 'space' ? capitalizeName(affix.text) : affix.text)
  }
  const fused = affix.kind === 'prefix' ? fuseWords(lang, affix.text, rootText) : fuseWords(lang, rootText, affix.text)
  if (fused === null || letterCount(fused) > MAX_WORD) return null
  return capitalizeName(fused)
}

/**
 * Carries a word from a parent language into a daughter language: every consonant and
 * vowel is replaced by its reflex (same inventory position). Returns null when the
 * result is not euphonic.
 */
export function shiftWord(word: string, parent: Language, child: Language): string | null {
  let out = ''
  for (const u of toUnits(word)) {
    if (u.vowel) {
      const i = parent.vowels.indexOf(u.s)
      out += i >= 0 && i < child.vowels.length ? child.vowels[i] : u.s
    } else {
      const i = parent.consonants.indexOf(u.s)
      out += i >= 0 && i < child.consonants.length ? child.consonants[i] : u.s
    }
  }
  return isEuphonic(out) ? out : null
}
