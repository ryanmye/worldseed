// typology: the euphony gate of phoneme forms (language-typology-scripts.md §4.4). Pure.
//
// The gate of a typology word is its language's syllable template plus universal checks: a vowel in the word; no two vowels
// together (no hiatus: length is a feature, not a doubled vowel) and no identical phonemes together (geminates only as length);
// the consonants before the first vowel an allowed onset, those after the last an allowed final (cluster), those between a coda
// (up to codaMax) then an onset; no consonant three times; no consonant-vowel syllable said again within two syllables (tone and
// length ignored); at most TYPO.markedPerWord phonemes of the rare series and TYPO.clicksPerWord clicks. With only the template
// sizes (Languages.typo; the sound-change gate, which has no Rng and no inventory) clusters are judged by sonority sequencing.
// The drift gate allows one cluster beyond the template by one consonant if it obeys sonority sequencing, so sound change can
// make clusters (as syncope does) without breaking the template wholesale.

import { consFeatures, isConsonant, isVowel, Laryngeal, Manner, Place, vowFeatures } from './phoneme.ts'
import { sspCoda, sspOnset, unpackTypo } from './inventory.ts'
import { TYPO } from './params.ts'
import type { TypoProfile } from './types.ts'

export interface Template {
  onsetMax: number
  codaMax: number
  finalMax: number
  cvOnly: boolean
  onsets?: Set<string>
  codas?: Set<number>
  finals?: Set<number>
  finalClusters?: Set<string>
}

const tplCache = new WeakMap<TypoProfile, Template>()
/** The full template of a language (generation). */
export function templateOf(t: TypoProfile): Template {
  let x = tplCache.get(t)
  if (!x) {
    x = { onsetMax: t.onsetMax, codaMax: t.codaMax, finalMax: t.finalMax, cvOnly: t.cvOnly, onsets: new Set(t.onsets), codas: new Set(t.codas), finals: new Set(t.finals), finalClusters: new Set(t.finalClusters) }
    tplCache.set(t, x)
  }
  return x
}
const bitsCache = new Map<number, Template>()
/** The template from Languages.typo bits only (sound change; clusters by sonority). */
export function templateOfBits(bits: number): Template {
  let x = bitsCache.get(bits)
  if (!x) {
    const b = unpackTypo(bits)
    x = { onsetMax: Math.max(1, b.onsetMax), codaMax: b.codaMax, finalMax: b.finalMax, cvOnly: b.cvOnly }
    bitsCache.set(bits, x)
  }
  return x
}

/** A phoneme of the rare series (ejective, implosive, pharyngeal, labial-velar, click, uvular). */
export function isRare(c: number): boolean {
  if (!isConsonant(c)) return false
  const f = consFeatures(c)
  return f.lar === Laryngeal.Ejective || f.lar === Laryngeal.Implosive || f.manner === Manner.Click || f.place === Place.Pharyngeal || f.place === Place.LabialVelar || f.place === Place.Uvular
}
export const isClick = (c: number): boolean => isConsonant(c) && consFeatures(c).manner === Manner.Click

function onsetOk(run: number[], T: Template): boolean {
  if (run.length <= 1) return true
  if (run.length > T.onsetMax) return false
  if (T.onsets) return T.onsets.has(String.fromCharCode(...run))
  for (let i = 0; i + 1 < run.length; i++) if (!sspOnset(run[i], run[i + 1])) return false
  return true
}
function codaOk(run: number[], T: Template, final: boolean): boolean {
  if (!run.length) return true
  if (run.length > (final ? T.finalMax : T.codaMax)) return false
  if (run.length === 1) {
    if (final) return T.finals ? T.finals.has(run[0]) : true
    return T.codas ? T.codas.has(run[0]) : true
  }
  if (final && T.finalClusters && run.length === 2) return T.finalClusters.has(String.fromCharCode(run[0], run[1]))
  if (!final && T.codas && !T.codas.has(run[0])) return false
  for (let i = 0; i + 1 < run.length; i++) if (!sspCoda(run[i], run[i + 1])) return false
  return true
}
function medialOk(run: number[], T: Template): boolean {
  for (let k = 0; k <= Math.min(T.codaMax, run.length - 1); k++) if (codaOk(run.slice(0, k), T, false) && onsetOk(run.slice(k), T)) return true
  return false
}
/** A cluster beyond the template that still obeys sonority (the drift relaxation): a fall then a rise, one consonant over. */
function sspMedial(run: number[], max: number): boolean {
  if (run.length > max + 1) return false
  for (let k = 0; k < run.length; k++) {
    let ok = true
    for (let i = 0; i + 1 < k && ok; i++) if (!sspCoda(run[i], run[i + 1])) ok = false
    for (let i = k; i + 1 < run.length && ok; i++) if (!sspOnset(run[i], run[i + 1])) ok = false
    if (ok) return true
  }
  return false
}

/** The gate for one word (no spaces) of phoneme codes; `relax`: the drift gate (see the file comment). */
export function typoEuphonic(word: string, T: Template, relax = false): boolean {
  const n = word.length
  if (n < 2) return false
  const u: number[] = new Array(n)
  let vowels = 0, rare = 0, clicks = 0
  for (let i = 0; i < n; i++) {
    const c = word.charCodeAt(i)
    if (!isConsonant(c) && !isVowel(c)) return false
    u[i] = c
    if (isVowel(c)) vowels++
    else if (isRare(c)) { rare++; if (isClick(c)) clicks++ }
  }
  if (!vowels || rare > TYPO.markedPerWord || clicks > TYPO.clicksPerWord) return false
  for (let i = 1; i < n; i++) {
    if (u[i] === u[i - 1]) return false
    if (isVowel(u[i]) && isVowel(u[i - 1])) return false
  }
  if (T.cvOnly && isVowel(u[0])) return false
  let used = false
  let i = 0
  while (i < n) {
    if (isVowel(u[i])) { i++; continue }
    let j = i
    while (j < n && !isVowel(u[j])) j++
    const run = u.slice(i, j)
    let ok: boolean
    if (i === 0) ok = onsetOk(run, T) || (relax && !used && run.length <= T.onsetMax + 1 && run.every((c, k) => k === 0 || sspOnset(run[k - 1], c)) && (used = true))
    else if (j === n) ok = codaOk(run, T, true) || (relax && !used && T.finalMax > 0 && run.length <= T.finalMax + 1 && (used = true))
    else ok = medialOk(run, T) || (relax && !used && sspMedial(run, T.codaMax + T.onsetMax) && (used = true))
    if (!ok) return false
    i = j
  }
  // no consonant three times; no consonant-vowel syllable again within two syllables
  for (let a = 0; a < n; a++) {
    if (isVowel(u[a])) continue
    let count = 0
    for (let b = 0; b < n; b++) if (u[b] === u[a]) count++
    if (count >= 3) return false
    if (a + 1 < n && isVowel(u[a + 1])) {
      const q = vowFeatures(u[a + 1]).q
      for (let b = a + 2; b + 1 < n && b <= a + 5; b++) if (u[b] === u[a] && isVowel(u[b + 1]) && vowFeatures(u[b + 1]).q === q) return false
    }
  }
  return true
}

/** Syllables of a word (vowels). */
export function syllableCount(word: string): number {
  let k = 0
  for (let i = 0; i < word.length; i++) if (isVowel(word.charCodeAt(i))) k++
  return k
}
