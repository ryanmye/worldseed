// typology: phonemes as feature bundles (language-typology-scripts.md §3.1). Pure; shared by the assembly and the UI.
//
// A typology-on form is a plain string with one UTF-16 code unit per phoneme, from the Private Use Area, so toUnits is
// s.split(''), hashing, saves and NameForms are unchanged in kind, and two phonemes never collide in spelling. Never displayed:
// orthography.ts romanize() renders a form for people, ipa() for tests and debugging. Spaces and hyphens keep their ASCII
// meaning (word breaks), as in letter forms.
//
// Consonant code = 0xE000 + ((place * 10 + manner) * 6 + laryngeal) * 3 + secondary   (12 x 10 x 6 x 3 = 2160 codes)
// Vowel code     = 0xF000 + ((quality * 2 + long) * 2 + nasal) * 6 + tone             (16 x 2 x 2 x 6 = 384 codes)
//
// Coding conventions for segments the feature grid does not name: a voiceless Lateral is the lateral fricative ɬ; the lateral
// click is coded at Postalveolar (ǁ), the palatal click at Palatal (ǂ); /w/ is a LabialVelar Approximant, /h/ a Glottal
// Fricative, /ʔ/ a Glottal Stop.

export const Place = { Bilabial: 0, Labiodental: 1, Dental: 2, Alveolar: 3, Postalveolar: 4, Retroflex: 5, Palatal: 6, Velar: 7, Uvular: 8, Pharyngeal: 9, Glottal: 10, LabialVelar: 11 } as const
export const Manner = { Stop: 0, Nasal: 1, Fricative: 2, Affricate: 3, LateralAffricate: 4, Lateral: 5, Tap: 6, Trill: 7, Approximant: 8, Click: 9 } as const
export const Laryngeal = { Voiceless: 0, Voiced: 1, Aspirated: 2, Ejective: 3, Implosive: 4, Prenasalised: 5 } as const
export const Secondary = { None: 0, Labialised: 1, Palatalised: 2 } as const
/** Vowel qualities (front/central/back x height; rounding implied by the IPA cell). */
export const Quality = { i: 0, y: 1, e: 2, ø: 3, ɛ: 4, a: 5, ɨ: 6, ə: 7, ɐ: 8, u: 9, ɯ: 10, o: 11, ɔ: 12, ɑ: 13, ʉ: 14, œ: 15 } as const
/** Tone on a vowel: 0 none, 1 high, 2 mid, 3 low, 4 rising, 5 falling. */
export const Tone = { None: 0, High: 1, Mid: 2, Low: 3, Rising: 4, Falling: 5 } as const

export const C_BASE = 0xe000
export const C_COUNT = 2160
export const V_BASE = 0xf000
export const V_COUNT = 384
/** RootPattern placeholders (typology/words.ts): the root's 1st, 2nd and 3rd consonant in a vocalic pattern. */
export const SLOT_BASE = 0xe900

export interface ConsonantFeatures { place: number; manner: number; lar: number; sec: number }
export interface VowelFeatures { q: number; long: number; nasal: number; tone: number }

export function cons(place: number, manner: number, lar = 0, sec = 0): number {
  return C_BASE + ((place * 10 + manner) * 6 + lar) * 3 + sec
}
export function vow(q: number, long = 0, nasal = 0, tone = 0): number {
  return V_BASE + ((q * 2 + long) * 2 + nasal) * 6 + tone
}
export const isConsonant = (code: number): boolean => code >= C_BASE && code < C_BASE + C_COUNT
export const isVowel = (code: number): boolean => code >= V_BASE && code < V_BASE + V_COUNT
export const isSlot = (code: number): boolean => code >= SLOT_BASE && code < SLOT_BASE + 3
export const isPhoneme = (code: number): boolean => isConsonant(code) || isVowel(code)

export function consFeatures(code: number): ConsonantFeatures {
  let x = code - C_BASE
  const sec = x % 3; x = (x - sec) / 3
  const lar = x % 6; x = (x - lar) / 6
  const manner = x % 10
  return { place: (x - manner) / 10, manner, lar, sec }
}
export function vowFeatures(code: number): VowelFeatures {
  let x = code - V_BASE
  const tone = x % 6; x = (x - tone) / 6
  const nasal = x % 2; x = (x - nasal) / 2
  const long = x % 2
  return { q: (x - long) / 2, long, nasal, tone }
}
/** The vowel with its tone replaced (or cleared with 0). */
export function withTone(code: number, tone: number): number {
  return code - ((code - V_BASE) % 6) + tone
}
export const toneOf = (code: number): number => (isVowel(code) ? (code - V_BASE) % 6 : 0)
/** A vowel's quality-only code (short, oral, toneless). */
export function plainVowel(code: number): number {
  const f = vowFeatures(code)
  return vow(f.q)
}

/** Whether a string holds phoneme codes (a typology form) rather than letters. */
export function hasPhonemes(s: string): boolean {
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= C_BASE && c < 0xf8ff) return true }
  return false
}

/** Sonority (Clements 1990 scale, coarse): 0 stop/click, 1 affricate, 2 fricative, 3 nasal, 4 liquid, 5 glide, 6 vowel. */
export function sonority(code: number): number {
  if (isVowel(code)) return 6
  if (!isConsonant(code)) return 0
  const { manner, lar } = consFeatures(code)
  switch (manner) {
    case Manner.Stop: case Manner.Click: return 0
    case Manner.Affricate: case Manner.LateralAffricate: return 1
    case Manner.Fricative: return 2
    case Manner.Nasal: return 3
    case Manner.Lateral: return lar === Laryngeal.Voiceless ? 2 : 4
    case Manner.Tap: case Manner.Trill: return 4
    default: return 5
  }
}

/** Obstruents: stops, affricates, fricatives and clicks (and ɬ). */
export const isObstruent = (code: number): boolean => isConsonant(code) && sonority(code) <= 2

// --- IPA (tests and debugging only; combining marks allowed) ---
const IPA_V = ['i', 'y', 'e', 'ø', 'ɛ', 'a', 'ɨ', 'ə', 'ɐ', 'u', 'ɯ', 'o', 'ɔ', 'ɑ', 'ʉ', 'œ']
const IPA_TONE = ['', '́', '̄', '̀', '̌', '̂']
/** [place][manner] -> [voiceless, voiced] IPA base. */
const IPA_C: Record<number, Record<number, [string, string]>> = {
  0: { 0: ['p', 'b'], 1: ['m̥', 'm'], 2: ['ɸ', 'β'], 3: ['pɸ', 'bβ'], 8: ['ʍ', 'w'] },
  1: { 0: ['p̪', 'b̪'], 1: ['ɱ', 'ɱ'], 2: ['f', 'v'], 3: ['p͡f', 'b͡v'], 8: ['ʋ', 'ʋ'] },
  2: { 0: ['t̪', 'd̪'], 1: ['n̪', 'n̪'], 2: ['θ', 'ð'], 3: ['t͡θ', 'd͡ð'], 9: ['ǀ', 'ǀ'] },
  3: { 0: ['t', 'd'], 1: ['n̥', 'n'], 2: ['s', 'z'], 3: ['t͡s', 'd͡z'], 4: ['t͡ɬ', 'd͡ɮ'], 5: ['ɬ', 'l'], 6: ['ɾ̥', 'ɾ'], 7: ['r̥', 'r'], 8: ['ɹ̥', 'ɹ'], 9: ['ǃ', 'ǃ'] },
  4: { 0: ['t̠', 'd̠'], 1: ['n̠', 'n̠'], 2: ['ʃ', 'ʒ'], 3: ['t͡ʃ', 'd͡ʒ'], 9: ['ǁ', 'ǁ'] },
  5: { 0: ['ʈ', 'ɖ'], 1: ['ɳ̊', 'ɳ'], 2: ['ʂ', 'ʐ'], 3: ['ʈ͡ʂ', 'ɖ͡ʐ'], 5: ['ɭ̊', 'ɭ'], 6: ['ɽ̊', 'ɽ'], 8: ['ɻ̊', 'ɻ'] },
  6: { 0: ['c', 'ɟ'], 1: ['ɲ̊', 'ɲ'], 2: ['ç', 'ʝ'], 3: ['t͡ɕ', 'd͡ʑ'], 5: ['ʎ̥', 'ʎ'], 8: ['j̊', 'j'], 9: ['ǂ', 'ǂ'] },
  7: { 0: ['k', 'g'], 1: ['ŋ̊', 'ŋ'], 2: ['x', 'ɣ'], 3: ['k͡x', 'g͡ɣ'], 5: ['ʟ̥', 'ʟ'], 8: ['ɰ̊', 'ɰ'] },
  8: { 0: ['q', 'ɢ'], 1: ['ɴ̥', 'ɴ'], 2: ['χ', 'ʁ'], 3: ['q͡χ', 'ɢ͡ʁ'], 7: ['ʀ̥', 'ʀ'] },
  9: { 0: ['ʡ', 'ʡ'], 2: ['ħ', 'ʕ'] },
  10: { 0: ['ʔ', 'ʔ'], 2: ['h', 'ɦ'] },
  11: { 0: ['k͡p', 'g͡b'], 1: ['ŋ͡m', 'ŋ͡m'], 2: ['ʍ', 'ʍ'], 8: ['ʍ', 'w'] },
}
const IMPLOSIVE: Record<number, string> = { 0: 'ɓ', 3: 'ɗ', 2: 'ɗ̪', 5: 'ᶑ', 6: 'ʄ', 7: 'ɠ', 8: 'ʛ' }

/** IPA for one phoneme code (a placeholder as C1..C3; any other character as itself). */
export function ipaOf(code: number): string {
  if (isVowel(code)) {
    const f = vowFeatures(code)
    return IPA_V[f.q] + (f.nasal ? '̃' : '') + IPA_TONE[f.tone] + (f.long ? 'ː' : '')
  }
  if (isSlot(code)) return 'C' + (code - SLOT_BASE + 1)
  if (!isConsonant(code)) return String.fromCharCode(code)
  const f = consFeatures(code)
  const pair = IPA_C[f.place]?.[f.manner] ?? ['?', '?']
  let s: string
  if (f.lar === Laryngeal.Implosive) s = IMPLOSIVE[f.place] ?? pair[1] + 'ʼ'
  else if (f.lar === Laryngeal.Prenasalised) s = (f.place === 0 ? 'ᵐ' : f.place === 7 ? 'ᵑ' : 'ⁿ') + pair[1]
  else s = pair[f.lar === Laryngeal.Voiced ? 1 : 0] + (f.lar === Laryngeal.Aspirated ? 'ʰ' : f.lar === Laryngeal.Ejective ? 'ʼ' : '')
  return s + (f.sec === Secondary.Labialised ? 'ʷ' : f.sec === Secondary.Palatalised ? 'ʲ' : '')
}
/** IPA for a form (tests and debugging). */
export function ipa(form: string): string {
  let out = ''
  for (let i = 0; i < form.length; i++) out += ipaOf(form.charCodeAt(i))
  return out
}

// --- Named segments (inventory.ts builds inventories from these) ---
const P = Place, M = Manner, L = Laryngeal
export const SEG = {
  p: cons(P.Bilabial, M.Stop), b: cons(P.Bilabial, M.Stop, L.Voiced),
  t: cons(P.Alveolar, M.Stop), d: cons(P.Alveolar, M.Stop, L.Voiced),
  k: cons(P.Velar, M.Stop), g: cons(P.Velar, M.Stop, L.Voiced),
  q: cons(P.Uvular, M.Stop), G: cons(P.Uvular, M.Stop, L.Voiced),
  glottal: cons(P.Glottal, M.Stop),
  m: cons(P.Bilabial, M.Nasal, L.Voiced), n: cons(P.Alveolar, M.Nasal, L.Voiced), ng: cons(P.Velar, M.Nasal, L.Voiced), ny: cons(P.Palatal, M.Nasal, L.Voiced),
  f: cons(P.Labiodental, M.Fricative), v: cons(P.Labiodental, M.Fricative, L.Voiced),
  th: cons(P.Dental, M.Fricative), dh: cons(P.Dental, M.Fricative, L.Voiced),
  s: cons(P.Alveolar, M.Fricative), z: cons(P.Alveolar, M.Fricative, L.Voiced),
  sh: cons(P.Postalveolar, M.Fricative), zh: cons(P.Postalveolar, M.Fricative, L.Voiced),
  x: cons(P.Velar, M.Fricative), gh: cons(P.Velar, M.Fricative, L.Voiced),
  X: cons(P.Uvular, M.Fricative), R: cons(P.Uvular, M.Fricative, L.Voiced),
  hh: cons(P.Pharyngeal, M.Fricative), ain: cons(P.Pharyngeal, M.Fricative, L.Voiced),
  h: cons(P.Glottal, M.Fricative),
  ts: cons(P.Alveolar, M.Affricate), dz: cons(P.Alveolar, M.Affricate, L.Voiced),
  ch: cons(P.Postalveolar, M.Affricate), j: cons(P.Postalveolar, M.Affricate, L.Voiced),
  tl: cons(P.Alveolar, M.LateralAffricate), lh: cons(P.Alveolar, M.Lateral),
  l: cons(P.Alveolar, M.Lateral, L.Voiced), r: cons(P.Alveolar, M.Trill, L.Voiced), rt: cons(P.Alveolar, M.Tap, L.Voiced),
  w: cons(P.LabialVelar, M.Approximant, L.Voiced), y: cons(P.Palatal, M.Approximant, L.Voiced),
} as const

export const VQ = { i: vow(0), e: vow(2), a: vow(5), o: vow(11), u: vow(9), ə: vow(7), ɨ: vow(6), ɛ: vow(4), ɔ: vow(12), y: vow(1), ø: vow(3), ɯ: vow(10), ɑ: vow(13), ʉ: vow(14), œ: vow(15), ɐ: vow(8) } as const

/** Legacy letters as phonemes (t, th = /θ/, sh = /ʃ/, ch = /tʃ/, y = /j/, ng = /ŋ/ ...): for tests and reading plain names back. */
export const LEGACY_LETTER: Record<string, number> = {
  p: SEG.p, b: SEG.b, t: SEG.t, d: SEG.d, k: SEG.k, g: SEG.g, c: SEG.k, q: SEG.q, m: SEG.m, n: SEG.n, ng: SEG.ng, ny: SEG.ny,
  f: SEG.f, v: SEG.v, s: SEG.s, z: SEG.z, sh: SEG.sh, zh: SEG.zh, th: SEG.th, dh: SEG.dh, kh: SEG.x, gh: SEG.gh, x: SEG.x,
  ph: SEG.f, h: SEG.h, ch: SEG.ch, j: SEG.j, ts: SEG.ts, tl: SEG.tl, hl: SEG.lh, lh: SEG.lh, r: SEG.r, l: SEG.l, w: SEG.w, y: SEG.y,
  "'": SEG.glottal,
  a: VQ.a, e: VQ.e, i: VQ.i, o: VQ.o, u: VQ.u,
}
const LEGACY_DIGRAPHS = ['ng', 'ny', 'sh', 'zh', 'th', 'dh', 'kh', 'gh', 'ph', 'ch', 'ts', 'tl', 'hl', 'lh']

/**
 * Letters (a plain name or a letter form, lower case) read as phonemes by the legacy values (greedy digraphs). Spaces and
 * hyphens are kept; a doubled vowel becomes a long one; other characters are dropped.
 */
export function fromLetters(s: string): string {
  let out = ''
  const w = s.toLowerCase()
  for (let i = 0; i < w.length;) {
    const ch = w[i]
    if (ch === ' ' || ch === '-') { out += ch; i++; continue }
    const two = w.slice(i, i + 2)
    if (LEGACY_DIGRAPHS.indexOf(two) >= 0) { out += String.fromCharCode(LEGACY_LETTER[two]); i += 2; continue }
    const code = LEGACY_LETTER[ch]
    if (code === undefined) { i++; continue }
    if (isVowel(code) && w[i + 1] === ch) { const f = vowFeatures(code); out += String.fromCharCode(vow(f.q, 1)); i += 2; continue }
    if (!isVowel(code) && w[i + 1] === ch) { i++; continue } // (a doubled consonant letter is one consonant)
    out += String.fromCharCode(code)
    i++
  }
  return out
}

/** Feature distance between two consonants (place, then manner, then laryngeal, then secondary) or two vowels. */
export function distance(a: number, b: number): number {
  if (a === b) return 0
  const av = isVowel(a), bv = isVowel(b)
  if (av !== bv) return 1000
  if (av) {
    const x = vowFeatures(a), y = vowFeatures(b)
    return VQ_DIST[x.q][y.q] * 10 + (x.long !== y.long ? 3 : 0) + (x.nasal !== y.nasal ? 4 : 0) + (x.tone !== y.tone ? 1 : 0)
  }
  const x = consFeatures(a), y = consFeatures(b)
  const placeD = Math.abs(PLACE_POS[x.place] - PLACE_POS[y.place])
  const mannerD = Math.abs(sonority(a) - sonority(b)) * 4 + (x.manner !== y.manner ? 2 : 0)
  const larD = x.lar === y.lar ? 0 : (x.lar <= 1 && y.lar <= 1) ? 3 : 5
  return placeD * 6 + mannerD * 5 + larD * 2 + (x.sec !== y.sec ? 3 : 0)
}
/** Places on a front-to-back line (labial-velars beside velars). */
const PLACE_POS = [0, 0.6, 1.2, 1.6, 2.1, 2.5, 3, 4, 4.8, 5.5, 6.2, 3.8]
/** Vowel quality positions (height, backness, rounding). */
const VQ_POS: [number, number, number][] = [
  [0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, 1], [2, 0, 0], [3, 1, 0], [0, 1, 0], [1.5, 1, 0], [2.5, 1, 0], [0, 2, 1], [0, 2, 0], [1, 2, 1], [2, 2, 1], [3, 2, 0], [0, 1, 1], [2, 0, 1],
]
const VQ_DIST: number[][] = VQ_POS.map((a) => VQ_POS.map((b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) * 1.2 + Math.abs(a[2] - b[2]) * 0.8))
