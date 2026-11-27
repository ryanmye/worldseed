// typology: romanization traditions (language-typology-scripts.md §4.7). Pure; shared by the assembly and the UI.
//
// A tradition is a per-language choice of 4 options in each of 16 spelling slots (2 bits each, packed in Languages.ortho): the
// in-world "scholarly school" of the people (as Wade-Giles, Yale and Hanyu Pinyin spell one Chinese, Wikipedia "Romanization of
// Chinese"). Each option gives two registers:
//   plain       ASCII letters and an apostrophe; may be lossy; map labels, Settlement.name, search and URLs;
//   scholarly   a whitelist of precomposed letters (no combining marks; every letter's toUpperCase() one code point, which
//               rules out ǰ and ŉ); must be injective over the language (repairOrtho), shown in the inspector and panels.
// One diacritic per letter: tone takes it first; length is then written by doubling the vowel, nasality by a following ˜.
// Tone is never written in plain. Tier-2 letters (Latin Extended-B and Additional, IPA, spacing modifiers) fall back within the
// tradition when the UI's glyph probe finds them missing (`supported`); the fallback changes only display, never the History.

import type { Rng } from '../../rng.ts'
import { consFeatures, isConsonant, isVowel, Laryngeal, Manner, Place, Secondary, Tone, vow, vowFeatures } from './phoneme.ts'

export const ORTHO_SLOTS = 16
export const Slot = { Sh: 0, Ch: 1, J: 2, X: 3, Ng: 4, Asp: 5, Ej: 6, Imp: 7, Retro: 8, Uvu: 9, Phar: 10, Click: 11, Long: 12, Nasal: 13, Tone: 14, Vowel: 15 } as const
export type Register = 'plain' | 'scholarly'

export const slotOf = (ortho: number, slot: number): number => (ortho >>> (slot * 2)) & 3
export const setSlot = (ortho: number, slot: number, v: number): number => ((ortho & ~(3 << (slot * 2))) | ((v & 3) << (slot * 2))) >>> 0

/** A fresh tradition: an option per slot (16 draws). */
export function drawOrtho(rng: Rng): number {
  let o = 0
  for (let s = 0; s < ORTHO_SLOTS; s++) o = setSlot(o, s, rng.int(0, 3))
  return o
}
/** A daughter's tradition: the parent's, with 1-2 slots redrawn at chance `p` (3 draws then 2 per slot redrawn). */
export function deriveOrtho(parent: number, rng: Rng, p: number): number {
  const u = rng.next(), k = rng.next() < 0.5 ? 1 : 2
  let o = parent
  for (let i = 0; i < k; i++) { const s = rng.int(0, ORTHO_SLOTS - 1), v = rng.int(0, 3); if (u < p) o = setSlot(o, s, v) }
  return o
}

// --- spellings: [plain, scholarly] ---
type Pair = [string, string]
const SH: Pair[][] = [[['sh', 'š'], ['zh', 'ž']], [['x', 'ś'], ['j', 'ź']], [['sj', 'ş'], ['zj', 'ẓ']], [['sh', 'x'], ['zh', 'ʒ']]]
const CH: Pair[][] = [[['ch', 'č'], ['j', 'ǯ'], ['ts', 'c'], ['dz', 'ʒ']], [['c', 'ć'], ['dj', 'đ'], ['tz', 'ċ'], ['dz', 'ż']], [['tj', 'c'], ['dj', 'j'], ['ts', 'ŧ'], ['dz', 'ʣ']], [['tch', 'ʧ'], ['dj', 'ʤ'], ['ts', 'ʦ'], ['dz', 'ʣ']]]
const J: Pair[] = [['y', 'y'], ['j', 'j'], ['i', 'j'], ['y', 'ĭ']]
const X: Pair[][] = [[['kh', 'x'], ['gh', 'ġ']], [['x', 'ḫ'], ['g', 'ǧ']], [['h', 'χ'], ['gh', 'ɣ']], [['kh', 'ħ'], ['gh', 'ğ']]]
const NG: Pair[][] = [[['ng', 'ŋ'], ['ny', 'ñ']], [['ng', 'ṅ'], ['nh', 'ń']], [['ng', 'ŋ'], ['gn', 'ň']], [['n', 'ŋ'], ['ny', 'ɲ']]]
const ASP: Pair[] = [['h', 'ʰ'], ['', 'h'], ['h', 'ʰ'], ['', "ʻ"]]
const EJ: Pair[] = [["'", 'ʼ'], ["'", "'"], ['', 'ʼ'], ["'", 'ʼ']]
/** Implosives by place (bilabial, alveolar, palatal, velar): [plain prefix form, scholarly]. */
const IMP: Pair[][] = [
  [["'b", 'ɓ'], ["'d", 'ɗ'], ["'j", 'ʄ'], ["'g", 'ɠ']],
  [['b', 'ɓ'], ['d', 'ɗ'], ['y', 'ʄ'], ['g', 'ɠ']],
  [['b', 'ƀ'], ['d', 'đ'], ['j', 'ɉ'], ['g', 'ǥ']],
  [["'b", 'ɓ'], ["'d", 'ɗ'], ["'y", 'ʄ'], ["'g", 'ɠ']],
]
/** Retroflex: stop, voiced stop, nasal, fricative, voiced fricative, lateral, tap/flap. */
const RETRO: Pair[][] = [
  [['t', 'ṭ'], ['d', 'ḍ'], ['n', 'ṇ'], ['s', 'ṣ'], ['z', 'ẓ'], ['l', 'ḷ'], ['r', 'ṛ']],
  [['rt', 'ṭ'], ['rd', 'ḍ'], ['rn', 'ṇ'], ['rs', 'ṣ'], ['rz', 'ẓ'], ['rl', 'ḷ'], ['rr', 'ṛ']],
  [['tx', 'ţ'], ['dx', 'ď'], ['nx', 'ň'], ['sx', 'ş'], ['zx', 'ž'], ['lx', 'ľ'], ['rx', 'ř']],
  [['t', 'ʈ'], ['d', 'ɖ'], ['n', 'ɳ'], ['s', 'ʂ'], ['z', 'ʐ'], ['l', 'ɭ'], ['r', 'ɽ']],
]
/** Uvular: stop, voiced stop, fricative, voiced fricative. */
const UVU: Pair[][] = [
  [['q', 'q'], ['gq', 'ɢ'], ['kh', 'χ'], ['gh', 'ʁ']],
  [['q', 'q'], ["g'", 'ġ'], ['x', 'ẋ'], ['r', 'ṙ']],
  [['k', 'q'], ['g', 'ǧ'], ['h', 'ḵ'], ['gh', 'ř']],
  [['qh', 'q'], ['gh', 'ɢ'], ['xh', 'χ'], ['rh', 'ʁ']],
]
const PHAR: Pair[][] = [[['hh', 'ḥ'], ["'", 'ʿ']], [["h'", 'ħ'], ["'", 'ʕ']], [['h', 'ḥ'], ['', 'ʿ']], [['hh', 'ħ'], ["'", 'ʿ']]]
/** Clicks: alveolar, dental, lateral, palatal. */
const CLICK: Pair[][] = [
  [['q', 'ǃ'], ['c', 'ǀ'], ['x', 'ǁ'], ['tc', 'ǂ']],
  [['q', 'q'], ['c', 'c'], ['x', 'x'], ['qc', 'ç']],
  [['qh', 'ǃ'], ['ch', 'ǀ'], ['xh', 'ǁ'], ['tch', 'ǂ']],
  [['q', 'ǃ'], ['c', 'ǀ'], ['lx', 'ǁ'], ['tc', 'ǂ']],
]
/** Vowel qualities: plain, and scholarly in the Latin school (slot options 0, 2) and the IPA school (1, 3). */
const V_PLAIN = ['i', 'ue', 'e', 'oe', 'e', 'a', 'y', 'e', 'a', 'u', 'u', 'o', 'o', 'a', 'u', 'oe']
const V_LATIN = ['i', 'ü', 'e', 'ö', 'è', 'a', 'ï', 'ë', 'ă', 'u', 'ı', 'o', 'ò', 'å', 'ű', 'œ']
const V_IPA = ['i', 'y', 'e', 'ø', 'ɛ', 'a', 'ɨ', 'ə', 'ɐ', 'u', 'ɯ', 'o', 'ɔ', 'ɑ', 'ʉ', 'œ']
const TONE_MARK = ['', '́', '̄', '̀', '̌', '̂']
const TONE_DIGIT = ['', '¹', '²', '³', '⁴', '⁵']

/** base + one combining mark, precomposed; null when no single code point (whose uppercase is one too) exists. */
function compose(base: string, mark: string): string | null {
  const c = (base + mark).normalize('NFC')
  return c.length === 1 && c.toUpperCase().length === 1 ? c : null
}

function consonant(code: number, o: number, reg: 0 | 1): string {
  const f = consFeatures(code)
  const voiced = f.lar === Laryngeal.Voiced || f.lar === Laryngeal.Implosive || f.lar === Laryngeal.Prenasalised
  let s = baseConsonant(f.place, f.manner, voiced, o, reg)
  if (f.lar === Laryngeal.Implosive) {
    const i = f.place === Place.Bilabial ? 0 : f.place === Place.Palatal ? 2 : f.place === Place.Velar || f.place === Place.Uvular ? 3 : 1
    s = IMP[slotOf(o, Slot.Imp)][i][reg]
  } else if (f.lar === Laryngeal.Prenasalised) {
    const nas = f.place === Place.Bilabial ? ['m', 'ᵐ'] : f.place === Place.Velar ? ['n', 'ᵑ'] : ['n', 'ⁿ']
    s = nas[reg] + s
  } else if (f.lar === Laryngeal.Aspirated) s += ASP[slotOf(o, Slot.Asp)][reg]
  else if (f.lar === Laryngeal.Ejective) s += EJ[slotOf(o, Slot.Ej)][reg]
  if (f.sec === Secondary.Labialised) s += reg ? 'ʷ' : 'w'
  else if (f.sec === Secondary.Palatalised) s += reg ? 'ʲ' : 'y'
  return s
}

function baseConsonant(place: number, manner: number, voiced: boolean, o: number, reg: 0 | 1): string {
  const v = voiced ? 1 : 0
  switch (manner) {
    case Manner.Stop:
      switch (place) {
        case Place.Bilabial: case Place.Labiodental: return v ? 'b' : 'p'
        case Place.Retroflex: return RETRO[slotOf(o, Slot.Retro)][v][reg]
        case Place.Palatal: return reg ? (v ? 'ǵ' : 'ḱ') : (v ? 'gy' : 'ky')
        case Place.Velar: return v ? 'g' : 'k'
        case Place.Uvular: return UVU[slotOf(o, Slot.Uvu)][v][reg]
        case Place.Glottal: case Place.Pharyngeal: return reg ? 'ʔ' : "'"
        case Place.LabialVelar: return reg ? (v ? 'ǧ' : 'ǩ') : (v ? 'gb' : 'kp')
        default: return v ? 'd' : 't'
      }
    case Manner.Nasal:
      switch (place) {
        case Place.Bilabial: case Place.Labiodental: return 'm'
        case Place.Retroflex: return RETRO[slotOf(o, Slot.Retro)][2][reg]
        case Place.Palatal: return NG[slotOf(o, Slot.Ng)][1][reg]
        case Place.Velar: case Place.Uvular: return NG[slotOf(o, Slot.Ng)][0][reg]
        case Place.LabialVelar: return reg ? 'ŋm' : 'ngm'
        default: return 'n'
      }
    case Manner.Fricative:
      switch (place) {
        case Place.Bilabial: return reg ? (v ? 'β' : 'ɸ') : (v ? 'v' : 'f')
        case Place.Labiodental: return v ? 'v' : 'f'
        case Place.Dental: return reg ? (v ? 'ð' : 'þ') : (v ? 'dh' : 'th')
        case Place.Postalveolar: return SH[slotOf(o, Slot.Sh)][v][reg]
        case Place.Retroflex: return RETRO[slotOf(o, Slot.Retro)][3 + v][reg]
        case Place.Palatal: return reg ? (v ? 'ʝ' : 'ç') : (v ? 'y' : 'hy')
        case Place.Velar: return X[slotOf(o, Slot.X)][v][reg]
        case Place.Uvular: return UVU[slotOf(o, Slot.Uvu)][2 + v][reg]
        case Place.Pharyngeal: return PHAR[slotOf(o, Slot.Phar)][v][reg]
        case Place.Glottal: return 'h'
        case Place.LabialVelar: return reg ? 'ʍ' : 'wh'
        default: return v ? 'z' : 's'
      }
    case Manner.Affricate:
      if (place === Place.Postalveolar || place === Place.Palatal) return CH[slotOf(o, Slot.Ch)][v][reg]
      return CH[slotOf(o, Slot.Ch)][2 + v][reg]
    case Manner.LateralAffricate: return reg ? 'ƛ' : 'tl'
    case Manner.Lateral:
      if (place === Place.Retroflex) return RETRO[slotOf(o, Slot.Retro)][5][reg]
      if (place === Place.Palatal) return reg ? 'ľ' : 'ly'
      return v ? 'l' : reg ? 'ł' : 'hl'
    case Manner.Tap: return place === Place.Retroflex ? RETRO[slotOf(o, Slot.Retro)][6][reg] : reg ? 'ŕ' : 'r'
    case Manner.Trill: return 'r'
    case Manner.Approximant:
      if (place === Place.Palatal) return J[slotOf(o, Slot.J)][reg]
      return 'w'
    case Manner.Click: {
      const i = place === Place.Dental ? 1 : place === Place.Postalveolar ? 2 : place === Place.Palatal ? 3 : 0
      return CLICK[slotOf(o, Slot.Click)][i][reg]
    }
  }
  return reg ? '?' : ''
}

function vowel(code: number, o: number, reg: 0 | 1, toned: boolean): string {
  const f = vowFeatures(code)
  if (!reg) {
    let s = V_PLAIN[f.q]
    if (f.q === 6 && J[slotOf(o, Slot.J)][0] === 'y') s = 'i'
    if (f.long) { const l = slotOf(o, Slot.Long); s += l === 0 || l === 3 ? (s.length === 1 ? s : '') : l === 1 ? 'h' : '' }
    if (f.nasal && (slotOf(o, Slot.Nasal) & 1) === 0) s += 'n'
    return s
  }
  const school = slotOf(o, Slot.Vowel) & 1 ? V_IPA : V_LATIN
  const base = school[f.q]
  let s = base, used = false, suffix = ''
  if (f.tone) {
    const c = (slotOf(o, Slot.Tone) & 1) === 0 ? compose(base, TONE_MARK[f.tone]) : null
    if (c) { s = c; used = true } else suffix += TONE_DIGIT[f.tone]
  }
  let nasalSuffix = ''
  if (f.nasal) {
    const c = used ? null : compose(base, (slotOf(o, Slot.Nasal) & 1) === 0 ? '̃' : '̨')
    if (c) { s = c; used = true } else nasalSuffix = '˜'
  }
  if (f.long) {
    const l = slotOf(o, Slot.Long)
    const c = used || toned || l === 2 ? null : compose(base, l === 1 ? '̂' : '̄')
    if (c) s = c
    else s += base
  }
  return s + nasalSuffix + suffix
}

/** The spelling of one phoneme (`toned`: the word marks tone, so length is doubled). */
export function spell(code: number, o: number, reg: Register, toned = false): string {
  const r = reg === 'plain' ? 0 : 1
  if (isConsonant(code)) return consonant(code, o, r)
  if (isVowel(code)) return vowel(code, o, r, toned)
  return String.fromCharCode(code)
}

/** Tier-1 letters (assumed everywhere: ASCII, Latin-1 Supplement, Latin Extended-A) [A; lane M checks devices]. */
export function tier1(ch: string): boolean {
  const c = ch.charCodeAt(0)
  return c < 0x180 && ch.length === 1
}
/** Fallbacks for tier-2 letters, within the same tradition (display only). */
const FALLBACK: Record<string, string> = {
  'ṭ': 'ţ', 'ḍ': 'ď', 'ṇ': 'ň', 'ṣ': 'ş', 'ẓ': 'ž', 'ḷ': 'ľ', 'ṛ': 'ř', 'ʈ': 'ţ', 'ɖ': 'ď', 'ɳ': 'ň', 'ʂ': 'ş', 'ʐ': 'ž', 'ɭ': 'ľ', 'ɽ': 'ř',
  'ǯ': 'dž', 'ʒ': 'ž', 'ʧ': 'č', 'ʤ': 'dž', 'ʦ': 'c', 'ʣ': 'dz', 'ŧ': 'c', 'ǧ': 'ğ', 'ḫ': 'x', 'χ': 'x', 'ɣ': 'ğ', 'ẋ': 'x', 'ṙ': 'ř',
  'ŋ': 'ng', 'ṅ': 'ň', 'ɲ': 'ñ', 'ʰ': 'h', 'ʼ': "'", 'ʻ': "'", 'ɓ': "'b", 'ɗ': "'d", 'ʄ': "'j", 'ɠ': "'g", 'ƀ': 'b', 'ɉ': 'j', 'ǥ': 'g',
  'ɢ': 'ġ', 'ʁ': 'ř', 'ḥ': 'ħ', 'ʿ': "'", 'ʕ': "'", 'ǃ': 'q', 'ǀ': 'c', 'ǁ': 'x', 'ǂ': 'ç', 'ʔ': "'", 'ǵ': 'ĝ', 'ḱ': 'ķ', 'β': 'v', 'ɸ': 'f',
  'ʝ': 'j', 'ʍ': 'hw', 'ŕ': 'r', 'ɛ': 'è', 'ɨ': 'ï', 'ə': 'ë', 'ɐ': 'ă', 'ɯ': 'ı', 'ɔ': 'ò', 'ɑ': 'å', 'ʉ': 'ű', 'ʷ': 'w', 'ʲ': 'y', 'ᵐ': 'm',
  'ⁿ': 'n', 'ᵑ': 'ng', '˜': 'n', 'ƛ': 'tł', 'ǩ': 'kp', 'ŋm': 'ŋm', '⁴': '4', '⁵': '5', 'ḵ': 'k', 'ẽ': 'ę', 'ỹ': 'y',
}

const cache = new Map<number, Map<number, string>>()
function spellCached(code: number, o: number, reg: Register, toned: boolean): string {
  const key = o * 4 + (reg === 'plain' ? 0 : 2) + (toned ? 1 : 0)
  let m = cache.get(key)
  if (!m) { if (cache.size > 4096) cache.clear(); cache.set(key, (m = new Map())) }
  let s = m.get(code)
  if (s === undefined) m.set(code, (s = spell(code, o, reg, toned)))
  return s
}

/**
 * A phoneme form (words split at spaces and hyphens) spelt in tradition `ortho`, lower case. Letters pass through. Plain words
 * keep at most two apostrophes and never begin with one. `supported` (scholarly only): the glyph probe; an unsupported letter
 * takes its fallback.
 */
export function romanize(form: string, ortho: number, reg: Register = 'plain', supported?: (ch: string) => boolean): string {
  let out = ''
  let word = ''
  let toned = false
  if (reg === 'scholarly') for (let i = 0; i < form.length; i++) { const c = form.charCodeAt(i); if (isVowel(c) && (c - 0xf000) % 6 !== 0) { toned = true; break } }
  const flush = (): void => {
    if (reg === 'plain') {
      while (word.startsWith("'")) word = word.slice(1)
      let n = 0
      word = word.replace(/'/g, () => (++n > 2 ? '' : "'"))
      while (word.endsWith("'")) word = word.slice(0, -1)
    }
    out += word
    word = ''
  }
  for (let i = 0; i < form.length; i++) {
    const c = form.charCodeAt(i)
    if (c === 32 || c === 45) { flush(); out += form[i]; continue }
    if (c < 0xe000) { word += form[i].toLowerCase(); continue }
    let s = spellCached(c, ortho, reg, toned)
    if (supported && reg === 'scholarly') {
      let t = ''
      for (const ch of s) t += tier1(ch) || supported(ch) ? ch : FALLBACK[ch] ?? ch
      s = t
    }
    word += s
  }
  flush()
  return out
}

/** Every phoneme a language may write: its consonants and its vowels with each tone it has (or none). */
export function writable(consonants: readonly number[], vowels: readonly number[], tones: readonly number[]): number[] {
  const out = consonants.slice()
  for (const v of vowels) {
    if (!tones.length) out.push(v)
    else for (const t of tones) out.push(v - ((v - 0xf000) % 6) + t)
  }
  return out
}

/** The slots that spell a phoneme (for repair). */
function slotsOf(code: number): number[] {
  if (isVowel(code)) return [Slot.Vowel, Slot.Long, Slot.Nasal, Slot.Tone]
  const f = consFeatures(code)
  const s: number[] = []
  if (f.lar === Laryngeal.Aspirated) s.push(Slot.Asp)
  if (f.lar === Laryngeal.Ejective) s.push(Slot.Ej)
  if (f.lar === Laryngeal.Implosive) s.push(Slot.Imp)
  if (f.place === Place.Retroflex) s.push(Slot.Retro)
  if (f.place === Place.Uvular) s.push(Slot.Uvu)
  if (f.place === Place.Pharyngeal) s.push(Slot.Phar)
  if (f.manner === Manner.Click) s.push(Slot.Click)
  if (f.manner === Manner.Affricate) s.push(Slot.Ch)
  if (f.manner === Manner.Fricative && f.place === Place.Postalveolar) s.push(Slot.Sh)
  if (f.manner === Manner.Fricative && f.place === Place.Velar) s.push(Slot.X)
  if (f.manner === Manner.Nasal && (f.place === Place.Velar || f.place === Place.Palatal)) s.push(Slot.Ng)
  if (f.manner === Manner.Approximant && f.place === Place.Palatal) s.push(Slot.J)
  return s
}

/** Conflicting pairs of phonemes in the scholarly register (a spelling that is another's spelling plus a prefix of a third's). */
export function conflicts(codes: readonly number[], ortho: number): [number, number][] {
  const toned = codes.some((c) => isVowel(c) && (c - 0xf000) % 6 !== 0)
  const sp = new Map<string, number>()
  const out: [number, number][] = []
  for (const c of codes) {
    const s = spell(c, ortho, 'scholarly', toned)
    const o = sp.get(s)
    if (o !== undefined && o !== c) out.push([o, c])
    else sp.set(s, c)
  }
  const prefix = new Set<string>()
  for (const s of sp.keys()) for (let k = 1; k <= s.length; k++) prefix.add(s.slice(0, k))
  for (const [s, c] of sp) {
    for (let k = 1; k < s.length; k++) {
      const a = sp.get(s.slice(0, k))
      // (a vowel then a vowel never meet in a word: the gate forbids hiatus, so a doubled long vowel is unambiguous)
      if (a !== undefined && prefix.has(s.slice(k)) && !(isVowel(a) && isVowel(c))) out.push([a, c])
    }
  }
  return out
}

/**
 * Makes a tradition injective in the scholarly register over `codes`: each conflict moves a slot of the phonemes in it to its
 * next option (no Rng), until none is left or 48 moves were made. Returns the repaired tradition.
 */
export function repairOrtho(codes: readonly number[], ortho: number): number {
  let o = ortho
  for (let step = 0; step < 48; step++) {
    const cs = conflicts(codes, o)
    if (!cs.length) return o
    const [a, b] = cs[0]
    const slots = slotsOf(b).concat(slotsOf(a))
    if (!slots.length) return o
    const s = slots[step % slots.length]
    o = setSlot(o, s, (slotOf(o, s) + 1) & 3)
  }
  return o
}

/** Whether a plain spelling is pronounceable (§8.1): a-z and apostrophes, a vowel letter in every word, at most 4 consonant letters in a row. */
export function plainOk(name: string, maxWord = 12): boolean {
  for (const w of name.toLowerCase().split(/[ -]/)) {
    if (!w) continue
    if (!/^[a-z']+$/.test(w)) return false
    if (w.replace(/'/g, '').length > maxWord) return false
    if (!/[aeiouy]/.test(w)) return false
    if (/[^aeiouy']{5}/.test(w)) return false
    if ((w.match(/'/g)?.length ?? 0) > 2 || w[0] === "'") return false
  }
  return true
}
/** Every character of a scholarly spelling is whitelisted: no combining mark, and its uppercase one code point. */
export function scholarlyOk(s: string): boolean {
  for (const ch of s) {
    if (/\p{M}/u.test(ch)) return false
    if (ch === ' ' || ch === '-' || ch === "'") continue
    if (ch.toUpperCase().length !== 1) return false
  }
  return true
}
/** Lower case, diacritics folded (search; the blocklist). */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export { Tone, vow }
