// typology: words and names taken into a typology language (language-typology-scripts.md §5.2), the phoneme-space branches of
// placeNames.ts borrowWord, adaptName, dedicate, freshPlace and qualify. Each phoneme becomes the recipient's nearest by
// feature distance (place, manner, laryngeal, then secondary; vowels by quality, then length and nasality; a tone the recipient
// lacks becomes its nearest, and none at all is dropped), then the word is repaired to the recipient's template: a prothetic
// vowel or a lost consonant for an onset it cannot begin with, a vowel added or a consonant lost at an end it cannot close, an
// epenthetic vowel in a cluster it cannot say, a glide or a lost vowel in hiatus. A plain name of any tongue (letters) is first
// read by the legacy letter values (phoneme.ts fromLetters). The legacy branches and their draws are untouched.

import type { Rng } from '../../rng.ts'
import type { Language } from '../phonology.ts'
import { fluentName, pickWeighted } from '../words.ts'
import { blocked } from './blocklist.ts'
import { distance, fromLetters, isConsonant, isVowel, SEG, toneOf, vowFeatures, withTone } from './phoneme.ts'
import { syllableCount, templateOf, typoEuphonic } from './phonotactics.ts'
import { plainOk, romanize } from './orthography.ts'
import type { TypoProfile } from './types.ts'
import { asForm, typoCompose, typoFuse, typoRoot } from './words.ts'

const ch = (c: number): string => String.fromCharCode(c)

/** The recipient's nearest phoneme to `c` (or its `rank`-th nearest, for the jittered attempts). */
export function nearestPhoneme(c: number, t: TypoProfile, rank = 0): number {
  if (isVowel(c)) {
    const bare = withTone(c, 0)
    let best = t.vowels[0], bd = Infinity
    for (const v of t.vowels) { const d = distance(bare, v); if (d < bd) { bd = d; best = v } }
    if (!t.tones.length) return best
    const tone = toneOf(c)
    const keep = t.tones.indexOf(tone) >= 0 ? tone : tone ? nearestTone(tone, t.tones) : t.tones[t.tones.length - 1]
    return withTone(best, keep)
  }
  if (!isConsonant(c)) return c
  if (rank === 0 && t.cons.indexOf(c) >= 0) return c
  const ds = t.cons.map((x) => distance(c, x))
  const order = t.cons.map((_, i) => i).sort((a, b) => ds[a] - ds[b] || a - b)
  return t.cons[order[Math.min(rank, order.length - 1)]]
}
function nearestTone(tone: number, tones: readonly number[]): number {
  // high/rising together, low/falling together, mid between
  const pos = [0, 2, 1, 0, 2, 0]
  let best = tones[0], bd = Infinity
  for (const x of tones) { const d = Math.abs(pos[x] - pos[tone]); if (d < bd) { bd = d; best = x } }
  return best
}

function linkVowel(t: TypoProfile): number {
  const a = t.vowels.find((v) => vowFeatures(v).q === 5) ?? t.vowels.find((v) => vowFeatures(v).q === 0) ?? t.vowels[0]
  return t.tones.length ? withTone(a, t.tones[0]) : a
}

/** Repairs a phoneme sequence (one word) to the language's template (see the file comment); null when it will not pass. */
export function fitWord(units: number[], t: TypoProfile, rng: Rng): string | null {
  const T = templateOf(t)
  let u = units.filter((c, i) => i === 0 || c !== units[i - 1])
  // hiatus: a glide between, or the second vowel falls
  for (let i = u.length - 1; i > 0; i--) {
    if (!isVowel(u[i]) || !isVowel(u[i - 1])) continue
    const glide = t.cons.indexOf(SEG.y) >= 0 ? SEG.y : t.cons.indexOf(SEG.w) >= 0 ? SEG.w : -1
    if (glide >= 0 && rng.next() < 0.5) u.splice(i, 0, glide)
    else u.splice(i, 1)
  }
  const V = linkVowel(t)
  for (let pass = 0; pass < 8; pass++) {
    const w = u.map(ch).join('')
    if (u.length >= 2 && typoEuphonic(w, T)) return w
    // the first bad place: the initial run, the final run, or a medial run
    let i0 = 0
    while (i0 < u.length && !isVowel(u[i0])) i0++
    if (i0 === u.length) { u.push(V); continue }
    if (i0 > T.onsetMax || (i0 >= 2 && !T.onsets?.has(u.slice(0, i0).map(ch).join('')))) {
      if (!T.cvOnly && rng.next() < 0.5) u.unshift(V)
      else u.shift()
      continue
    }
    if (T.cvOnly && i0 === 0) { u.unshift(t.cons[1] ?? t.cons[0]); continue }
    let j = u.length
    while (j > 0 && !isVowel(u[j - 1])) j--
    const fin = u.slice(j)
    const finOk = fin.length === 0 || (fin.length <= T.finalMax && (fin.length === 1 ? T.finals?.has(fin[0]) : T.finalClusters?.has(fin.map(ch).join(''))))
    if (!finOk) {
      if (!T.finalMax || !t.finals.length || rng.next() < 0.55) u.push(V)
      else u.pop()
      continue
    }
    // a medial cluster: an epenthetic vowel after its first consonant
    let fixed = false
    for (let k = i0 + 1; k < j - 1; k++) {
      if (isVowel(u[k]) || isVowel(u[k + 1]) || !isVowel(u[k - 1])) continue
      u.splice(k + 1, 0, V)
      fixed = true
      break
    }
    if (!fixed) {
      // a repeated consonant or syllable: change the last vowel
      const last = u.map((c, i) => (isVowel(c) ? i : -1)).filter((i) => i >= 0).pop()
      if (last === undefined) return null
      const others = t.vowels.filter((v) => withTone(u[last], 0) !== v)
      if (!others.length) return null
      u[last] = t.tones.length ? withTone(others[rng.int(0, others.length - 1)], toneOf(u[last]) || t.tones[0]) : others[rng.int(0, others.length - 1)]
    }
  }
  return null
}

function plainOf(lang: Language, form: string): string {
  return romanize(form, lang.typo!.ortho, 'plain')
}
/** A name (phoneme form) fit to bear: each word through the gate, the plain spelling 3..max letters, pronounceable, fluent, not blocked. */
export function okName(lang: Language, form: string, max = 11): boolean {
  const p = plainOf(lang, form)
  const n = p.replace(/[^a-z]/g, '').length
  if (n < 3 || n > max || !plainOk(p) || !fluentName(p) || blocked(p)) return false
  const T = templateOf(lang.typo!)
  for (const w of form.split(/[ -]/)) if (w && !typoEuphonic(w, T, true)) return false
  return true
}

function units(form: string): number[] {
  const out: number[] = []
  for (let i = 0; i < form.length; i++) { const c = form.charCodeAt(i); if (isConsonant(c) || isVowel(c)) out.push(c) }
  return out
}
/** The main word of a name (its longest). */
function mainWord(name: string): string {
  let best = ''
  for (const w of name.split(/[ -]/)) if (w.length > best.length) best = w
  return best
}
function toPhonemes(s: string): string {
  return /[a-z]/i.test(s) ? fromLetters(s) : s
}
/** Drops the last syllable (from the onset of its vowel). */
function clip(u: number[]): number[] {
  let i = u.length - 1
  while (i >= 0 && !isVowel(u[i])) i--
  if (i > 0 && !isVowel(u[i - 1])) i--
  return u.slice(0, Math.max(1, i))
}

/** A word (any language's phonemes, or letters) taken into `to` (placeNames.ts borrowWord in phoneme space). */
export function typoBorrowWord(word: string, to: Language, rng: Rng): string {
  const t = to.typo!
  const src = units(toPhonemes(word))
  for (let attempt = 0; attempt < 8; attempt++) {
    const u = src.map((c) => (attempt >= 3 && isConsonant(c) && rng.next() < 0.35 ? nearestPhoneme(c, t, 1) : nearestPhoneme(c, t)))
    const w = fitWord(u, t, rng)
    if (w !== null && w.length >= 2) return w
  }
  return asForm(to, word)
}

/** The old name in the new language (placeNames.ts adaptName in phoneme space); a phoneme form, or null. */
export function typoAdaptName(old: string, to: Language, endings: readonly string[], rng: Rng): string | null {
  const t = to.typo!
  const oldLc = old.toLowerCase()
  const base = units(toPhonemes(mainWord(oldLc)))
  for (let attempt = 0; attempt < 12; attempt++) {
    let u = base.map((c) => (attempt >= 3 && isConsonant(c) && rng.next() < 0.35 ? nearestPhoneme(c, t, 1) : nearestPhoneme(c, t)))
    if (syllableCount(u.map(ch).join('')) >= 3 && (attempt >= 6 || rng.next() < 0.35)) u = clip(u)
    let w = fitWord(u, t, rng)
    if (w === null) continue
    const x = rng.next()
    if (x < 0.22) w = typoFuse(to, w, endings[rng.int(0, endings.length - 1)]) ?? w
    else if (x < 0.32) {
      const opts = to.affixes.new
      w = typoCompose(to, w, opts[pickWeighted(rng, opts.map((o) => o.weight))]) ?? w
    }
    if (plainOf(to, w) === oldLc || attempt >= 4) {
      const e = typoFuse(to, w, endings[rng.int(0, endings.length - 1)])
      if (e !== null) w = e
    }
    if (plainOf(to, w) !== oldLc && okName(to, w)) return w
  }
  return null
}

/** A name for a person, a house or a faith (placeNames.ts dedicate in phoneme space). */
export function typoDedicate(honoree: string, lang: Language, endings: readonly string[], rng: Rng): string | null {
  const t = lang.typo!
  const full = fitWord(units(asForm(lang, mainWord(honoree.toLowerCase()))), t, rng) ?? typoRoot(lang, rng)
  for (let attempt = 0; attempt < 10; attempt++) {
    const short = syllableCount(full) <= 2
    let base = full
    if (!(attempt < 3 && rng.next() < 0.6 && short)) { let u = units(full); while (syllableCount(u.map(ch).join('')) > 2) u = clip(u); base = fitWord(u, t, rng) ?? full }
    const e = endings[rng.int(0, endings.length - 1)]
    const x = rng.next()
    let name: string | null
    if (x < 0.14 && lang.twoWord && plainOf(lang, endings[1]).length >= 3) name = base + ' ' + endings[1]
    else if (x < 0.24) name = typoFuse(lang, e, base)
    else name = typoFuse(lang, base, e)
    if (name !== null && okName(lang, name)) return name
  }
  return null
}

/** A fresh name of the language (placeNames.ts freshPlace in phoneme space). */
export function typoFreshPlace(lang: Language, endings: readonly string[], rng: Rng): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const root = typoRoot(lang, rng)
    const x = rng.next()
    let name: string | null
    if (x < 0.4) name = typoFuse(lang, root, endings[rng.int(0, endings.length - 1)])
    else if (x < 0.55) { const opts = lang.affixes.new; name = typoCompose(lang, root, opts[pickWeighted(rng, opts.map((o) => o.weight))]) }
    else name = root
    if (name !== null && okName(lang, name)) return name
  }
  return typoRoot(lang, rng)
}

/** A founding name already borne elsewhere, qualified (placeNames.ts qualify in phoneme space). */
export function typoQualify(name: string, lang: Language, endings: readonly string[], rng: Rng): string | null {
  const base = fitWord(units(asForm(lang, mainWord(name.toLowerCase()))), lang.typo!, rng)
  if (base === null) return null
  for (let attempt = 0; attempt < 8; attempt++) {
    let cand: string | null
    if (attempt < 5) { const opts = lang.affixes.new; cand = typoCompose(lang, base, opts[pickWeighted(rng, opts.map((o) => o.weight))]) }
    else cand = typoFuse(lang, base, endings[rng.int(0, endings.length - 1)])
    if (cand !== null && plainOf(lang, cand) !== name.toLowerCase() && okName(lang, cand)) return cand
  }
  return null
}
