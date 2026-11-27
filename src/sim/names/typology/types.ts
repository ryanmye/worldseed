// typology: the sound system of one typology language (Language.typo; built by inventory.ts). Types only.

import type { TypoDraw } from './profile.ts'

export interface TypoProfile {
  /** The drawn classes it was built from. */
  draw: TypoDraw
  /** Consonant and vowel codes (vowels toneless: short, long and nasal variants); tones in use (empty: none). */
  cons: number[]
  vowels: number[]
  tones: number[]
  /** Syllable template: most consonants before a vowel, closing a syllable inside a word, and ending a word. */
  onsetMax: number
  codaMax: number
  finalMax: number
  /** Every syllable needs an onset (no vowel-initial words). */
  cvOnly: boolean
  /** Allowed onset clusters (2-3 phonemes), medial codas, word finals and 2-consonant final clusters. */
  onsets: string[]
  codas: number[]
  finals: number[]
  finalClusters: string[]
  /** Isolating names: how morphemes are joined (0 fused, 1 hyphen, 2 space). */
  join: number
  /** Prefixing (noun-class) languages: the class prefixes [place, person/people, language, thing]; empty otherwise. */
  prefixes: string[]
  /** RootPattern languages: the vocalic patterns of nouns (with SLOT_BASE placeholders); empty otherwise. */
  patterns: string[]
  /** The spelling tradition (orthography.ts; per language the drift overrides it). */
  ortho: number
  /** Packed summary (Languages.typo; see packTypo). */
  bits: number
}
