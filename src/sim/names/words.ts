// Pure string/phoneme helpers used to build roots, short affix morphs and to
// fuse a root with an affix. No randomness lives below `buildRoot`/`buildMorph`
// except through the `Rng` passed in; `fuse*` and the validity checks are pure
// functions of their string arguments so composition stays deterministic and
// cheap to retry.

import type { Rng } from '../rng.ts'
import type { AffixOption, Language } from './phonology.ts'

const VOWEL_CHARS = 'aeiou'
/** Digraphs count as one consonant phoneme for run-length purposes. */
const DIGRAPHS = ['ng', 'sh', 'th', 'ch']

function isVowelChar(ch: string): boolean {
  return VOWEL_CHARS.indexOf(ch) >= 0
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

function consonant(lang: Language, rng: Rng): string {
  return lang.consonants[rng.int(0, lang.consonants.length - 1)]
}
function coda(lang: Language, rng: Rng): string {
  const pool = lang.codaConsonants.length ? lang.codaConsonants : lang.consonants
  return pool[rng.int(0, pool.length - 1)]
}
function vowel(lang: Language, rng: Rng): string {
  return lang.vowels[rng.int(0, lang.vowels.length - 1)]
}
function cluster(lang: Language, rng: Rng): string {
  return lang.onsetClusters.length ? lang.onsetClusters[rng.int(0, lang.onsetClusters.length - 1)] : consonant(lang, rng)
}

/** Builds the text of one syllable for shape index 0..4 = V, CV, VC, CVC, CCV. */
export function buildSyllableText(lang: Language, rng: Rng, shapeIdx: number): string {
  switch (shapeIdx) {
    case 0: return vowel(lang, rng)
    case 1: return consonant(lang, rng) + vowel(lang, rng)
    case 2: return vowel(lang, rng) + coda(lang, rng)
    case 4: return cluster(lang, rng) + vowel(lang, rng)
    default: return consonant(lang, rng) + vowel(lang, rng) + coda(lang, rng) // CVC
  }
}

function startsWithVowel(s: string): boolean {
  return s.length > 0 && isVowelChar(s[0])
}
function endsWithVowel(s: string): boolean {
  return s.length > 0 && isVowelChar(s[s.length - 1])
}

/** A root word: 2-3 syllables typically. CCV (cluster onset) only ever opens the word. */
export function buildRoot(lang: Language, rng: Rng): string {
  let text = ''
  for (let attempt = 0; attempt < 40; attempt++) {
    const k = rng.int(lang.minSyll, lang.maxSyll)
    text = ''
    let prevEndedVowel = false
    for (let i = 0; i < k; i++) {
      const weights = i === 0 ? lang.shapeWeights : [lang.shapeWeights[0], lang.shapeWeights[1], lang.shapeWeights[2], lang.shapeWeights[3], 0]
      const shapeIdx = pickWeighted(rng, weights)
      const syl = buildSyllableText(lang, rng, shapeIdx)
      if (prevEndedVowel && startsWithVowel(syl) && lang.usesApostrophe && rng.next() < 0.3) text += "'"
      text += syl
      prevEndedVowel = endsWithVowel(syl)
    }
    if (text.length >= 3 && text.length <= 7 && maxConsonantRun(text) < 3 && !hasTripleRepeatLetter(text)) return text
  }
  return text || 'an'
}

/** A short 1-syllable affix morph (no cluster onset, so it never risks a boundary run on its own). */
export function buildMorph(lang: Language, rng: Rng): string {
  let text = ''
  const shapeChoices = [1, 2, 3]
  for (let attempt = 0; attempt < 20; attempt++) {
    const shapeIdx = shapeChoices[rng.int(0, shapeChoices.length - 1)]
    text = buildSyllableText(lang, rng, shapeIdx)
    if (text.length >= 2 && text.length <= 4 && maxConsonantRun(text) < 3) return text
  }
  return text || 'a'
}

/** Joins two lowercase words, merging a vowel-vowel seam and breaking up any consonant run >= 3. */
function fuseTwo(lang: Language, a: string, b: string): string {
  const aEndsVowel = endsWithVowel(a)
  const bStartsVowel = startsWithVowel(b)
  let combined = aEndsVowel && bStartsVowel ? a.slice(0, -1) + b : a + b
  if (maxConsonantRun(combined) >= 3) {
    const link = lang.vowels.find((v) => v.length === 1) ?? 'a'
    combined = a + link + b
  }
  if (hasTripleRepeatLetter(combined)) combined = combined.replace(/(.)\1\1+/g, '$1$1')
  return combined
}

/** Composes a settlement's final display name from its root and an optional site/ancestry affix. */
export function composeName(lang: Language, rootText: string, affix: AffixOption | undefined): string {
  if (!affix) return capitalizeName(rootText)
  if (affix.kind === 'prefix') {
    if (affix.attach === 'space') return capitalizeName(affix.text) + ' ' + capitalizeName(rootText)
    if (affix.attach === 'hyphen') return capitalizeName(affix.text) + '-' + capitalizeName(rootText)
    return capitalizeName(fuseTwo(lang, affix.text, rootText))
  }
  if (affix.attach === 'space') return capitalizeName(rootText) + ' ' + capitalizeName(affix.text)
  if (affix.attach === 'hyphen') return capitalizeName(rootText) + '-' + affix.text
  return capitalizeName(fuseTwo(lang, rootText, affix.text))
}
