// typology: roots, morphs and names in phoneme space, by morphology style (language-typology-scripts.md §4.5). The names/words.ts
// builders dispatch here when lang.typo is set; with it absent nothing here runs, so letter worlds are unchanged.
//
//   Isolating    morphemes of one syllable (with tone where the language has it), names of 2-3 morphemes joined fused, by a
//                hyphen or by a space (the language's habit), at most 3 syllables and no syllable twice.
//   Suffixing    a root and 0-2 suffixes; with vowel harmony the suffix vowels follow the root's last vowel (front/back).
//   Prefixing    noun classes: 4 class prefixes (place, person/people, language, thing); a town takes the place prefix half the
//                time, a people's name always its people prefix.
//   Compounding  names are root + root (the site word a full root), head first or last by the language, a linking vowel where
//                the template needs one.
//   RootPattern  roots of 2-3 consonants (no two alike, no two of one place first), words a vocalic pattern over the root; the
//                site affixes are patterns, so composing interdigitates the root's consonants with them.
// Every word passes the language's gate (phonotactics.ts); every plain spelling is pronounceable (orthography.ts plainOk) and
// not blocked (blocklist.ts).

import type { Rng } from '../../rng.ts'
import type { AffixOption, Language, MeaningClass } from '../phonology.ts'
import { MEANING_CLASSES } from '../phonology.ts'
import { blocked } from './blocklist.ts'
import { buildInventory, packTypo } from './inventory.ts'
import { consFeatures, fromLetters, hasPhonemes, isConsonant, isSlot, isVowel, SEG, SLOT_BASE, vow, vowFeatures, withTone } from './phoneme.ts'
import { isClick, syllableCount, templateOf, typoEuphonic } from './phonotactics.ts'
import { Style, type TypoDraw } from './profile.ts'
import { plainOk, romanize } from './orthography.ts'
import { TYPO } from './params.ts'
import type { TypoProfile } from './types.ts'
import { nearestPhoneme } from './borrow.ts'

const ch = (c: number): string => String.fromCharCode(c)
function pickW(rng: Rng, w: readonly number[]): number {
  let t = 0
  for (const x of w) t += x
  let x = rng.next() * t
  for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return i }
  return w.length - 1
}
function pick<T>(rng: Rng, a: readonly T[]): T {
  return a[rng.int(0, a.length - 1)]
}

/** Consonant weights: the earlier in the inventory (more usual), the likelier; clicks held near TYPO.clickRate per syllable. */
const consWeights = new WeakMap<TypoProfile, number[]>()
function consonant(t: TypoProfile, rng: Rng): number {
  let w = consWeights.get(t)
  if (!w) {
    const nClick = t.cons.filter(isClick).length
    const base = t.cons.map((c, i) => (isClick(c) ? 0 : 1 / (1 + 0.06 * i)))
    const sum = base.reduce((a, b) => a + b, 0)
    // clicks share TYPO.clickRate * 0.6 of all onsets (under the 0.12 cap)
    const cw = nClick ? (sum * TYPO.clickRate * 0.6) / (1 - TYPO.clickRate * 0.6) / nClick : 0
    w = t.cons.map((c, i) => (isClick(c) ? cw : base[i]))
    consWeights.set(t, w)
  }
  return t.cons[pickW(rng, w)]
}
/** A vowel with a tone (the plain qualities likelier than long or nasal ones). */
function vowel(t: TypoProfile, rng: Rng): number {
  const w = t.vowels.map((v) => { const f = vowFeatures(v); return f.long || f.nasal ? 0.35 : 1 })
  const v = t.vowels[pickW(rng, w)]
  return t.tones.length ? withTone(v, pick(rng, t.tones)) : v
}

/** One syllable. `onset`: 2 must, 1 usual, 0 never; `coda`: 0 open, 1 medial coda allowed, 2 word-final allowed. */
function syllable(t: TypoProfile, rng: Rng, onset: number, coda: number): string {
  let s = ''
  if (onset === 2 || (onset === 1 && (t.cvOnly || rng.next() < 0.85))) {
    if (t.onsetMax >= 2 && t.onsets.length && rng.next() < (t.draw.syl === 2 ? 0.3 : 0.18)) s += pick(rng, t.onsets)
    else s += ch(consonant(t, rng))
  }
  s += ch(vowel(t, rng))
  if (coda === 2 && t.finalMax > 0 && t.finals.length && rng.next() < (t.draw.syl === 2 ? 0.6 : 0.45)) {
    s += t.finalMax >= 2 && t.finalClusters.length && rng.next() < 0.2 ? pick(rng, t.finalClusters) : ch(pick(rng, t.finals))
  } else if (coda === 1 && t.codaMax > 0 && t.codas.length && rng.next() < (t.draw.syl === 2 ? 0.45 : 0.3)) s += ch(pick(rng, t.codas))
  return s
}

/** The plain spelling of a form in the language's tradition. */
export function plainOf(lang: Language, form: string): string {
  return romanize(form, lang.typo!.ortho, 'plain')
}
function plainLen(lang: Language, form: string): number {
  return plainOf(lang, form).replace(/[^a-z]/g, '').length
}
/** A word fit to be (part of) a name: the gate, a pronounceable plain spelling within `max` letters, nothing blocked. */
function fit(lang: Language, w: string, min: number, max: number): boolean {
  const t = lang.typo!
  if (!typoEuphonic(w, templateOf(t))) return false
  const p = plainOf(lang, w)
  const n = p.replace(/[^a-z]/g, '').length
  return n >= min && n <= max && plainOk(p) && !blocked(p)
}

const joinStr = (t: TypoProfile): string => (t.join === 1 ? '-' : t.join === 2 ? ' ' : '')

/** A root word (see the file comment). */
export function typoRoot(lang: Language, rng: Rng): string {
  const t = lang.typo!
  const st = t.draw.style
  for (let attempt = 0; attempt < 60; attempt++) {
    let w: string
    if (st === Style.Isolating) {
      const k = rng.next() < 0.75 ? 2 : 1
      const parts: string[] = []
      for (let i = 0; i < k; i++) parts.push(syllable(t, rng, 2, 2))
      if (parts.some((p) => !fit(lang, p, 2, 6))) continue
      if (k === 2 && sameSyllable(parts[0], parts[1])) continue
      w = parts.join('')
      if (!typoEuphonic(w, templateOf(t))) continue
      if (plainLen(lang, w) < 3 || plainLen(lang, w) > 9 || !plainOk(plainOf(lang, w)) || blocked(plainOf(lang, w))) continue
      return w
    }
    if (st === Style.RootPattern) {
      w = interdigitate(skeleton(t, rng), pick(rng, t.patterns))
      if (fit(lang, w, 3, 9)) return w
      continue
    }
    const sylW = t.draw.syl === 0 ? [0.1, 0.5, 0.4] : t.draw.syl === 1 ? [0.2, 0.55, 0.25] : [0.35, 0.5, 0.15]
    const k = 1 + pickW(rng, sylW)
    w = ''
    for (let i = 0; i < k; i++) {
      const last = i === k - 1
      const afterV = w.length > 0 && isVowel(w.charCodeAt(w.length - 1))
      w += syllable(t, rng, i === 0 ? 1 : afterV ? 2 : 1, last ? 2 : 1)
    }
    if (fit(lang, w, 3, 9)) return w
  }
  return ch(t.cons[1]) + ch(t.vowels[0]) + ch(t.cons[4] ?? t.cons[0]) + ch(t.vowels[1] ?? t.vowels[0])
}

/** A one-syllable morph (an affix or a short word) of `minLetters`..5 plain letters; `final`: it may end a word. */
export function typoMorph(lang: Language, rng: Rng, minLetters = 2, final = true): string {
  const t = lang.typo!
  for (let attempt = 0; attempt < 40; attempt++) {
    let w: string
    if (t.draw.style === Style.Compounding && minLetters >= 3 && rng.next() < 0.6) w = syllable(t, rng, 2, 1) + syllable(t, rng, 2, final ? 2 : 1)
    else w = syllable(t, rng, t.draw.style === Style.Isolating ? 2 : 1, final ? 2 : 1)
    if (fit(lang, w, minLetters, t.draw.style === Style.Compounding ? 7 : 5)) return w
  }
  return ch(t.cons[4] ?? t.cons[0]) + ch(t.vowels[0])
}

function sameSyllable(a: string, b: string): boolean {
  const strip = (s: string): string => { let o = ''; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); o += isVowel(c) ? ch(vow(vowFeatures(c).q)) : s[i] } return o }
  return strip(a) === strip(b)
}

// --- harmony ---
const FRONT = new Set([0, 1, 2, 3, 4, 15])
const BACK = new Set([9, 10, 11, 12, 13, 5])
/** Front <-> back counterparts (quality ids): i-ɯ, y-u, e-o... a pairs with e. */
const COUNTER: Record<number, number[]> = { 0: [10, 9], 1: [9], 2: [11, 5], 3: [11], 4: [12, 13], 15: [12], 9: [1, 0], 10: [0], 11: [3, 2], 12: [4], 13: [4, 2], 5: [2, 4] }
function harmonize(t: TypoProfile, root: string, affix: string): string {
  let cls = -1
  for (let i = root.length - 1; i >= 0; i--) {
    const c = root.charCodeAt(i)
    if (!isVowel(c)) continue
    const q = vowFeatures(c).q
    if (FRONT.has(q)) cls = 0; else if (BACK.has(q)) cls = 1
    break
  }
  if (cls < 0) return affix
  const quals = new Set(t.vowels.map((v) => vowFeatures(v).q))
  let out = ''
  for (let i = 0; i < affix.length; i++) {
    const c = affix.charCodeAt(i)
    if (!isVowel(c)) { out += affix[i]; continue }
    const f = vowFeatures(c)
    if ((cls === 0 && FRONT.has(f.q)) || (cls === 1 && BACK.has(f.q)) || !(FRONT.has(f.q) || BACK.has(f.q))) { out += affix[i]; continue }
    const to = (COUNTER[f.q] ?? []).find((q) => quals.has(q))
    out += to === undefined ? affix[i] : ch(vow(to, f.long, f.nasal, f.tone))
  }
  return out
}

// --- root and pattern ---
function skeleton(t: TypoProfile, rng: Rng): number[] {
  const n = rng.next() < 0.15 ? 2 : 3
  for (let attempt = 0; attempt < 30; attempt++) {
    const c: number[] = []
    for (let i = 0; i < n; i++) c.push(consonant(t, rng))
    if (new Set(c).size < n) continue
    if (consFeatures(c[0]).place === consFeatures(c[1]).place) continue
    return c
  }
  return [t.cons[1], t.cons[4] ?? t.cons[2], t.cons[2]].slice(0, n)
}
/** The root consonants in a pattern (placeholders C1..C3; a 2-consonant root doubles C2 into C3's place, as C1aC2aC2). */
export function interdigitate(root: readonly number[], pattern: string): string {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charCodeAt(i)
    if (isSlot(c)) { const k = c - SLOT_BASE; out += ch(root[Math.min(k, root.length - 1)]) } else out += pattern[i]
  }
  return out
}
/** The consonants of a word, in order, as a root (at most 3). */
function rootOf(word: string): number[] {
  const out: number[] = []
  for (let i = 0; i < word.length && out.length < 3; i++) { const c = word.charCodeAt(i); if (isConsonant(c)) out.push(c) }
  return out
}
function drawPatterns(t: TypoProfile, rng: Rng, count: number): string[] {
  const C1 = ch(SLOT_BASE), C2 = ch(SLOT_BASE + 1), C3 = ch(SLOT_BASE + 2)
  const V = (): string => ch(vowel(t, rng))
  const shapes = [
    (): string => C1 + V() + C2 + V() + C3,
    (): string => C1 + V() + C2 + C3 + V(),
    (): string => C1 + C2 + V() + C3,
    (): string => V() + C1 + C2 + V() + C3,
    (): string => C1 + V() + C2 + V() + C3 + V(),
    (): string => ch(t.cons.indexOf(SEG.m) >= 0 ? SEG.m : t.cons[3]) + V() + C1 + C2 + V() + C3,
  ]
  const out: string[] = []
  for (let k = 0; out.length < count && k < 160; k++) {
    const p = shapes[rng.int(0, shapes.length - 1)]()
    if (out.indexOf(p) < 0) out.push(p)
  }
  return out
}

// --- joining ---
/** A linking vowel: the language's /a/-like or first vowel, toned as needed. */
function linkVowel(t: TypoProfile): number {
  const a = t.vowels.find((v) => vowFeatures(v).q === 5) ?? t.vowels.find((v) => vowFeatures(v).q === 7) ?? t.vowels[0]
  return t.tones.length ? withTone(a, t.tones[t.tones.length - 1]) : a
}

/** Joins two words of the language, smoothing the seam; null when no smoothing passes the gate. */
export function typoFuse(lang: Language, a0: string, b0: string): string | null {
  const t = lang.typo!
  const a = asForm(lang, a0), b0f = asForm(lang, b0)
  if (!a || !b0f) return null
  if (t.draw.style === Style.RootPattern && hasSlot(b0f)) return interdigitate(rootOf(a), b0f)
  const b = t.draw.harmony && t.draw.style === Style.Suffixing ? harmonize(t, a, b0f) : b0f
  if (t.draw.style === Style.Isolating && t.join) {
    const w = a + joinStr(t) + b
    return syllableCount(w) <= 3 ? w : null
  }
  const T = templateOf(t)
  const aV = isVowel(a.charCodeAt(a.length - 1)), bV = isVowel(b.charCodeAt(0))
  const cands: string[] = []
  if (aV && bV) cands.push(a.slice(0, -1) + b, a + b.slice(1), a + ch(t.cons.indexOf(SEG.y) >= 0 ? SEG.y : t.cons[0]) + b)
  else if (!aV && !bV) cands.push(a + b, a + ch(linkVowel(t)) + b, a.slice(0, -1) + b)
  else cands.push(a + b)
  for (const c of cands) if (c.length >= 2 && typoEuphonic(c, T) && (t.draw.style !== Style.Isolating || syllableCount(c) <= 3)) return c
  return null
}
function hasSlot(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (isSlot(s.charCodeAt(i))) return true
  return false
}

/** Phonemes for `s`: a phoneme form as it is; letters (a plain name of any tongue) read and fitted to the language's sounds. */
export function asForm(lang: Language, s: string): string {
  if (!s) return s
  if (hasPhonemes(s) && !/[a-z]/i.test(s)) return s
  const t = lang.typo!
  const raw = hasPhonemes(s) ? s.replace(/[a-z']+/gi, (x) => fromLetters(x)) : fromLetters(s)
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i)
    out += isConsonant(c) || isVowel(c) ? ch(nearestPhoneme(c, t)) : raw[i]
  }
  return out
}

/** Longest single word, in plain letters, and longest two-word name (as names/words.ts). */
const MAX_WORD = 10
const MAX_TWO_WORDS = 12

/** A settlement-style name from a root and an optional affix (a phoneme form, not yet spelt); null if they do not combine well. */
export function typoCompose(lang: Language, rootText: string, affix: AffixOption | undefined): string | null {
  const t = lang.typo!
  const root = asForm(lang, rootText)
  let w: string | null
  if (!affix) w = root
  else if (affix.attach === 'space' || affix.attach === 'hyphen') {
    const sep = affix.attach === 'space' ? ' ' : '-'
    if (plainLen(lang, root) + plainLen(lang, affix.text) > MAX_TWO_WORDS || plainLen(lang, root) > 8) return null
    w = affix.kind === 'prefix' ? affix.text + sep + root : root + sep + affix.text
  } else w = affix.kind === 'prefix' ? typoFuse(lang, affix.text, root) : typoFuse(lang, root, affix.text)
  if (w === null) return null
  // noun classes: a town takes the place prefix half the time (decided by the form, so no draw)
  if (t.prefixes.length && !w.includes(' ') && hashOf(w) % 2 === 0) w = typoFuse(lang, t.prefixes[0], w) ?? w
  for (const part of w.split(/[ -]/)) if (part && plainLen(lang, part) > MAX_WORD) return null
  const p = plainOf(lang, w)
  if (!plainOk(p, MAX_WORD) || blocked(p)) return null
  if (t.draw.style === Style.Isolating && syllableCount(w.replace(/[ -]/g, '')) > 3) return null
  return w
}
function hashOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** A people's name stem with its class prefix (Prefixing languages), else the stem. */
export function withClass(lang: Language, w: string, cls: 1 | 2 | 3): string {
  const t = lang.typo
  if (!t || !t.prefixes.length) return w
  return typoFuse(lang, t.prefixes[cls], asForm(lang, w)) ?? w
}

/** One meaning class's affix options (as phonology.ts buildAffixSet, in phoneme space; patterns for RootPattern). */
export function typoAffixSet(lang: Language, cls: MeaningClass, rng: Rng): AffixOption[] {
  const t = lang.typo!
  const st = t.draw.style
  const count = rng.next() < 0.6 ? 1 : 2
  const opts: AffixOption[] = []
  for (let i = 0; i < count; i++) {
    let kind: 'prefix' | 'suffix' = st === Style.Prefixing ? 'prefix' : 'suffix'
    let attach: 'fuse' | 'space' | 'hyphen' = 'fuse'
    if (st === Style.Compounding) kind = t.draw.headInitial ? 'prefix' : 'suffix'
    if ((cls === 'coast' || cls === 'new') && lang.twoWord && rng.next() < 0.5) { attach = 'space'; kind = rng.next() < 0.5 ? 'prefix' : kind }
    else if ((cls === 'hill' || cls === 'ford') && lang.usesHyphen && rng.next() < 0.5) { kind = 'prefix'; attach = 'hyphen' }
    let text: string
    if (st === Style.RootPattern && attach === 'fuse') text = pick(rng, t.patterns.length ? t.patterns : [''])
    else text = typoMorph(lang, rng, attach === 'space' || st === Style.Compounding ? 3 : 2, kind === 'suffix' && attach === 'fuse')
    opts.push({ text, kind, attach, weight: 1 })
  }
  return opts
}

/** A new native word for meaning m (lexicon.ts coinWord, in phoneme space). */
export function typoCoinWord(lang: Language, m: number, rng: Rng, geo: number, derive: number, city: number, land: number): string {
  if (m < geo) {
    const cls = MEANING_CLASSES[m]
    return lang.affixes[cls].map((o) => (lang.typo!.draw.style === Style.RootPattern && o.attach === 'fuse' ? pick(rng, lang.typo!.patterns) : typoMorph(lang, rng, o.attach === 'space' ? 3 : 2, o.kind === 'suffix' && o.attach === 'fuse'))).join('|')
  }
  if (m < derive) return typoMorph(lang, rng, m - geo === land ? 2 : 3, true)
  if (m === derive || m === city) return typoMorph(lang, rng, 2, true)
  if (m === city + 1) return typoMorph(lang, rng, 3, true)
  return typoRoot(lang, rng)
}

const SHAPES: number[][] = [[0.3, 3, 0, 0, 0], [0.25, 2.5, 0.1, 0.9, 0.3], [0.15, 1.8, 0.2, 1.6, 0.6]]

/** A typology Language: the drawn profile's sound system (inventory.ts) and the legacy fields filled with phoneme symbols. */
export function typoLanguage(draw: TypoDraw, rng: Rng, ortho: number): Language {
  const t = buildInventory(draw, rng)
  t.ortho = ortho
  t.join = draw.style === Style.Isolating ? pickW(rng, [0.5, 0.3, 0.2]) : 0
  const lang: Language = {
    consonants: t.cons.map(ch), codaConsonants: t.codas.map(ch), finals: t.finals.map(ch), onsetClusters: t.onsets.slice(),
    vowels: t.vowels.map(ch), diphthongs: [], shapeWeights: SHAPES[draw.syl].slice(),
    openFinal: draw.syl === 0 ? 1 : draw.syl === 1 ? 0.55 : 0.4, minSyll: 1, maxSyll: 3, longWord: 0.3,
    usesApostrophe: false, usesHyphen: t.join === 1 || rng.next() < 0.12, twoWord: t.join === 2 || rng.next() < 0.4,
    affixes: {} as Record<MeaningClass, AffixOption[]>, typo: t,
  }
  if (draw.style === Style.RootPattern) {
    // (only patterns the template allows: tried on the language's first consonants)
    const T = templateOf(t)
    const probe = [t.cons[0], t.cons[3] ?? t.cons[1], t.cons[1]]
    t.patterns = drawPatterns(t, rng, 30).filter((p) => typoEuphonic(interdigitate(probe, p), T)).slice(0, 3 + rng.int(0, 2))
    if (!t.patterns.length) t.patterns = [ch(SLOT_BASE) + ch(t.vowels[0]) + ch(SLOT_BASE + 1) + ch(t.vowels[1] ?? t.vowels[0]) + ch(SLOT_BASE + 2) + ch(t.vowels[0])]
  }
  if (draw.style === Style.Prefixing) {
    const seen = new Set<string>()
    for (let k = 0; k < 4; k++) {
      let p = ''
      for (let a = 0; a < 20; a++) {
        p = rng.next() < 0.75 || t.cvOnly ? ch(consonant(t, rng)) + ch(vowel(t, rng)) : ch(vowel(t, rng))
        if (!seen.has(p)) break
      }
      seen.add(p)
      t.prefixes.push(p)
    }
  }
  for (const cls of MEANING_CLASSES) lang.affixes[cls] = typoAffixSet(lang, cls, rng)
  t.bits = packTypo(t)
  return lang
}

/** A typology Language seen in another tradition (a daughter's spelling school): same sounds, its own ortho. */
export function withOrtho(lang: Language, ortho: number): Language {
  if (!lang.typo || lang.typo.ortho === ortho) return lang
  return { ...lang, typo: { ...lang.typo, ortho } }
}
