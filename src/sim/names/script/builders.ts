// typology: a script's signs by type, and names transcribed into them (language-typology-scripts.md §6.2-6.4). Pure in (world
// seed, History.scripts, the lexicon of the script's language); the UI caches the results (ui/scriptData.ts).
//
//   alphabet      a glyph per consonant and vowel quality (a length mark where the language has length);
//   abjad         consonant glyphs only; long vowels by a consonant-like glyph (a mater lectionis, after the abjads) [A];
//   abugida       consonant bases with an inherent vowel (the language's most frequent), vowel marks, a vowel killer for a
//                 coda, and independent vowels;
//   syllabary     a sign per consonant-vowel pair (at most SIGNS.maxSyllabary; beyond it vowels are grouped by height, a
//                 defective spelling [A]); a coda is dropped or written with a dead-vowel sign (by script);
//   logosyllabic  syllable signs (rebus) for names, with a place determinative before town names (by script) [A];
//   featural      consonant shapes built from a place stroke, a manner stroke and a laryngeal tick; vowels a line and dots.
// Transcription takes the spoken phoneme form at the year, so a name in its native script drifts with speech.

import { createRng } from '../../rng.ts'
import type { History } from '../../../contract.ts'
import { consFeatures, distance, isConsonant, isVowel, vow, vowFeatures } from '../typology/phoneme.ts'
import { deriveGlyph, diacritic, distinctGlyph, drawGlyph, familyStyle, type Glyph, type Stroke, signature } from './glyphs.ts'

export const SIGNS = { maxSyllabary: 160 } as const
export const ScriptKind = { Logosyllabic: 0, Syllabary: 1, Abugida: 2, Abjad: 3, Alphabet: 4, Featural: 5 } as const

export interface SignSet {
  script: number
  type: number
  direction: number
  glyphs: Glyph[]
  /** Sign keys -> glyph index: c<code> consonant, v<quality> vowel, s<code>.<quality> syllable (code -1: no consonant), m<quality> vowel mark, k killer, L length, d determinative. */
  key: Map<string, number>
  /** Abugida: the inherent vowel quality. */
  inherent: number
  /** Syllabary: codas get a dead-vowel sign (else dropped). */
  deadVowel: boolean
  /** Logosyllabic: a place determinative before town names. */
  determinative: boolean
}

export type ScriptSource = Pick<History, 'scripts' | 'languages'>

/** The consonants and vowel qualities of language `n`'s lexicon (its line's root words): the sounds a script is fitted to. */
export function soundsOf(h: ScriptSource, n: number): { cons: number[]; vq: number[]; long: boolean; freq: Map<number, number> } {
  const L = h.languages
  const cons = new Set<number>(), vq = new Map<number, number>()
  let long = false
  if (L && n >= 0 && n < L.count) {
    let root = n
    while (L.parent[root] >= 0) root = L.parent[root]
    for (let m = 0; m < 100; m++) {
      const r = L.lexStart[root * 100 + m]
      for (const ch of L.lexForm[r] ?? '') {
        const c = ch.charCodeAt(0)
        if (isConsonant(c)) cons.add(c)
        else if (isVowel(c)) { const f = vowFeatures(c); vq.set(f.q, (vq.get(f.q) ?? 0) + 1); if (f.long) long = true }
      }
    }
  }
  return { cons: [...cons].sort((a, b) => a - b), vq: [...vq.keys()].sort((a, b) => a - b), long, freq: vq }
}

const cache = new Map<string, SignSet>()

/** The sign set of script `s` (see the file comment). Daughters reuse their parent's glyphs. */
export function signSet(seed: number, h: ScriptSource, s: number): SignSet | null {
  const S = h.scripts
  if (!S || s < 0 || s >= S.count) return null
  const ck = `${seed}|${S.count}|${s}`
  const hit = cache.get(ck)
  if (hit) return hit
  const st = familyStyle(seed, S.family[s])
  const r = createRng(seed, `script-glyph-${s}`)
  const type = S.type[s], dir = S.direction[s]
  const sounds = soundsOf(h, S.language[s])
  const parent = S.parent[s] >= 0 ? signSet(seed, h, S.parent[s]) : null
  const mirror = !!parent && ((parent.direction === 0 && dir === 1) || (parent.direction === 1 && dir === 0))
  const derived = S.origin[s] === 3
  const glyphs: Glyph[] = []
  const key = new Map<string, number>()
  const want = (k: string, strokes?: number): void => {
    if (key.has(k)) return
    let g: Glyph
    const pk = parent?.key.get(k)
    if (parent && pk !== undefined) g = deriveGlyph(parent.glyphs[pk], st, r, mirror, derived)
    else if (parent && parent.glyphs.length && (k[0] === 'c' || k[0] === 's')) {
      // a sign the parent lacks: its nearest consonant's glyph with a diacritic stroke
      const code = Number(k.slice(1).split('.')[0])
      let best = -1, bd = Infinity
      for (const [pk2, gi] of parent.key) {
        if (pk2[0] !== k[0]) continue
        const c2 = Number(pk2.slice(1).split('.')[0])
        if (!(code >= 0 && c2 >= 0)) continue
        const d = distance(code, c2)
        if (d < bd) { bd = d; best = gi }
      }
      g = best >= 0 ? diacritic(deriveGlyph(parent.glyphs[best], st, r, mirror, false), r) : distinctGlyph(st, r, glyphs, strokes)
    } else g = distinctGlyph(st, r, glyphs, strokes)
    key.set(k, glyphs.length)
    glyphs.push(g)
  }
  let inherent = sounds.vq[0] ?? 5
  let bestF = -1
  for (const [q, f] of sounds.freq) if (f > bestF) { bestF = f; inherent = q }
  const set: SignSet = { script: s, type, direction: dir, glyphs, key, inherent, deadVowel: r.next() >= 0.4, determinative: r.next() < 0.7 }
  if (type === ScriptKind.Alphabet || type === ScriptKind.Abjad) {
    for (const c of sounds.cons) want('c' + c)
    if (type === ScriptKind.Alphabet) for (const q of sounds.vq) want('v' + q)
    if (sounds.long) want('L', 1)
  } else if (type === ScriptKind.Abugida) {
    for (const c of sounds.cons) want('c' + c)
    for (const q of sounds.vq) { want('v' + q); if (q !== inherent) want('m' + q, 1 + r.int(0, 1)) }
    want('k', 1)
  } else if (type === ScriptKind.Syllabary || type === ScriptKind.Logosyllabic) {
    const vq = groupVowels(sounds.vq, sounds.cons.length)
    for (const q of vq) want(`s-1.${q}`)
    for (const c of sounds.cons) for (const q of vq) want(`s${c}.${q}`)
    if (type === ScriptKind.Logosyllabic) {
      // the determinative: two components side by side, larger as composite characters are
      const a = drawGlyph(st, r, 2), b = drawGlyph(st, r, 2)
      const strokes: Stroke[] = a.strokes.map((x) => ({ ...x, x0: x.x0 / 2, x1: x.x1 / 2, cx: x.cx === undefined ? undefined : x.cx / 2 })).concat(b.strokes.map((x) => ({ ...x, x0: 50 + x.x0 / 2, x1: 50 + x.x1 / 2, cx: x.cx === undefined ? undefined : 50 + x.cx / 2 })))
      key.set('d', glyphs.length)
      glyphs.push({ strokes, count: a.count + b.count, sig: signature(strokes) })
    }
  } else {
    // featural: place base + manner stroke + laryngeal tick; vowels a line with dots
    for (const c of sounds.cons) {
      const f = consFeatures(c)
      const base = drawGlyph(familyStyle(seed, S.family[s] * 1000 + f.place), createRng(seed, `script-feat-${S.family[s]}-p${f.place}`), 1)
      const man = drawGlyph(familyStyle(seed, S.family[s] * 1000 + 100 + f.manner), createRng(seed, `script-feat-${S.family[s]}-m${f.manner}`), 1)
      const strokes = base.strokes.concat(man.strokes, f.lar ? [{ x0: 80, y0: 10 + f.lar * 10, x1: 92, y1: 10 + f.lar * 10 }] : [])
      key.set('c' + c, glyphs.length)
      glyphs.push({ strokes, count: 2 + (f.lar ? 1 : 0), sig: signature(strokes) })
    }
    for (const q of sounds.vq) {
      const strokes: Stroke[] = [{ x0: 50, y0: 10, x1: 50, y1: 90 }]
      for (let i = 0; i <= q % 3; i++) strokes.push({ x0: q < 6 ? 62 : 32, y0: 25 + i * 20, x1: q < 6 ? 66 : 36, y1: 29 + i * 20 })
      key.set('v' + q, glyphs.length)
      glyphs.push({ strokes, count: strokes.length, sig: signature(strokes) })
    }
  }
  if (cache.size > 64) cache.clear()
  cache.set(ck, set)
  return set
}

/** Vowel qualities a syllabary distinguishes: all of them, or grouped by height when the signs would pass SIGNS.maxSyllabary. */
function groupVowels(vq: readonly number[], nCons: number): number[] {
  if ((nCons + 1) * vq.length <= SIGNS.maxSyllabary) return vq.slice()
  const HEIGHT = [0, 0, 1, 1, 2, 3, 0, 1, 2, 0, 0, 1, 2, 3, 0, 2]
  const rep = new Map<number, number>()
  for (const q of vq) if (!rep.has(HEIGHT[q])) rep.set(HEIGHT[q], q)
  return [...rep.values()]
}
function heightRep(set: SignSet, q: number): number {
  if (set.key.has(`s-1.${q}`)) return q
  const HEIGHT = [0, 0, 1, 1, 2, 3, 0, 1, 2, 0, 0, 1, 2, 3, 0, 2]
  for (const k of set.key.keys()) if (k.startsWith('s-1.')) { const x = Number(k.slice(4)); if (HEIGHT[x] === HEIGHT[q]) return x }
  return Number([...set.key.keys()].find((k) => k.startsWith('s-1.'))?.slice(4) ?? 5)
}
function nearestCons(set: SignSet, c: number, prefix: string): number {
  let best = -1, bd = Infinity
  for (const k of set.key.keys()) {
    if (!k.startsWith(prefix)) continue
    const x = Number(k.slice(prefix.length).split('.')[0])
    if (!(x >= 0)) continue
    const d = distance(c, x)
    if (d < bd) { bd = d; best = x }
  }
  return best
}

/** A run of glyphs for a phoneme form: glyph indices in reading order, and the direction. */
export interface GlyphRun { glyphs: number[]; dir: number }

/** `form` (a phoneme form said at the year) in the signs of `set` (see the file comment); `town` adds a determinative. */
export function transcribe(set: SignSet, form: string, town = false): GlyphRun {
  const out: number[] = []
  const g = (k: string): void => { const i = set.key.get(k); if (i !== undefined) out.push(i) }
  const u: number[] = []
  for (const ch of form) { const c = ch.charCodeAt(0); if (isConsonant(c) || isVowel(c)) u.push(c) }
  const T = set.type
  if (T === ScriptKind.Logosyllabic && town && set.determinative) g('d')
  for (let i = 0; i < u.length; i++) {
    const c = u[i]
    if (T === ScriptKind.Alphabet || T === ScriptKind.Abjad || T === ScriptKind.Featural) {
      if (isConsonant(c)) { const x = set.key.has('c' + c) ? c : nearestCons(set, c, 'c'); if (x >= 0) g('c' + x) }
      else {
        const f = vowFeatures(c)
        if (T === ScriptKind.Abjad) { if (f.long) { const glide = nearestCons(set, c, 'c'); if (glide >= 0) g('c' + glide) } continue }
        g('v' + f.q)
        if (f.long) g('L')
      }
    } else if (T === ScriptKind.Abugida) {
      if (isConsonant(c)) {
        const x = set.key.has('c' + c) ? c : nearestCons(set, c, 'c')
        if (x >= 0) g('c' + x)
        const next = u[i + 1]
        if (next !== undefined && isVowel(next)) { const q = vowFeatures(next).q; if (q !== set.inherent) g('m' + q); i++ }
        else g('k')
      } else g('v' + vowFeatures(c).q)
    } else {
      // syllabary and logosyllabic
      if (isConsonant(c)) {
        const next = u[i + 1]
        const x = set.key.has(`s${c}.${heightRep(set, set.inherent)}`) ? c : nearestCons(set, c, 's')
        if (next !== undefined && isVowel(next)) { g(`s${x}.${heightRep(set, vowFeatures(next).q)}`); i++ }
        else if (set.deadVowel) g(`s${x}.${heightRep(set, set.inherent)}`)
      } else g(`s-1.${heightRep(set, vowFeatures(c).q)}`)
    }
  }
  return { glyphs: out, dir: set.direction }
}

export { vow }
