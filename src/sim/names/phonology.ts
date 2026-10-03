// A Language is a seeded phonology: a small consonant/vowel inventory, syllable
// shapes with weights, a few phonotactic choices (which consonants may close a
// syllable or end a word, onset clusters, diphthongs, whether hiatus gets an
// apostrophe, whether names may be hyphenated or two words) and a small set of
// place-name affixes per meaning class.
//
// Each original language is drawn from one of a few rhythm styles, from open
// and vowel-rich (almost every syllable CV, names end in vowels) to clipped and
// consonant-final (CVC syllables, clusters), so cultures differ audibly.
// `buildLanguage` makes an original tribe's language from a fresh Rng;
// `deriveLanguage` makes a daughter language by applying a couple of regular
// sound shifts and regenerating affixes, so descendants sound related but
// drift apart. Shifts map inventories element by element (index i of the
// daughter's list is the reflex of index i of the parent's), which lets words
// be carried over from parent to daughter (see shiftWord in words.ts).

import type { Rng } from '../rng.ts'
import { buildMorph, CODA_OK, DIPHTHONGS_OK, FINAL_OK, ONSET_CLUSTERS_OK } from './words.ts'

export type MeaningClass = 'river' | 'coast' | 'hill' | 'forest' | 'plain' | 'lake' | 'ford' | 'new'
export const MEANING_CLASSES: readonly MeaningClass[] = ['river', 'coast', 'hill', 'forest', 'plain', 'lake', 'ford', 'new']

export interface AffixOption {
  text: string
  kind: 'prefix' | 'suffix'
  attach: 'fuse' | 'space' | 'hyphen'
  weight: number
}

/** Syllable shape weights in fixed order: V, CV, VC, CVC, CCV. */
export interface Language {
  consonants: string[]
  /** Consonants that may close a syllable inside a word. */
  codaConsonants: string[]
  /** Consonants a word may end in (empty: words end in vowels). */
  finals: string[]
  onsetClusters: string[]
  vowels: string[]
  diphthongs: string[]
  shapeWeights: number[]
  /** Chance a word's last syllable is open (ends in a vowel). */
  openFinal: number
  minSyll: number
  maxSyll: number
  /** Chance of a third syllable when maxSyll is 3. */
  longWord: number
  /** Hiatus (two vowels meeting) is allowed and written with an apostrophe. */
  usesApostrophe: boolean
  /** Hill and ford names may take a hyphenated prefix. */
  usesHyphen: boolean
  /** Coast and colony names may be two words. */
  twoWord: boolean
  affixes: Record<MeaningClass, AffixOption[]>
}

const CONSONANTS_MASTER = ['p', 't', 'k', 'b', 'd', 'g', 'm', 'n', 'ng', 'f', 'v', 's', 'z', 'sh', 'th', 'r', 'l', 'w', 'y', 'h', 'ch']
/** Consonants every language is likely to have: names without any of these sound alien. */
const CORE_CONSONANTS = ['n', 'r', 'l', 'm', 's', 't', 'k']
const PURE_VOWELS = ['a', 'e', 'i', 'o', 'u']

/** Regular sound shifts a daughter language may apply; each only fires if its `from` is in use. */
const CONSONANT_SHIFTS: Array<[string, string]> = [
  ['p', 'f'], ['t', 'th'], ['k', 'h'], ['b', 'v'], ['d', 'th'], ['g', 'k'], ['w', 'v'], ['th', 'f'], ['z', 's'], ['ch', 'sh'], ['v', 'w'], ['sh', 's'], ['h', 'k'],
]
const VOWEL_SHIFTS: Array<[string, string]> = [['a', 'o'], ['e', 'i'], ['o', 'u'], ['u', 'o'], ['i', 'e']]

interface Style {
  weights: number[]
  openFinal: number
  finals: [number, number]
  longWord: number
  diphthong: number
  clusters: [number, number]
}

/** Rhythm styles, from open and vowel-rich to clipped and consonant-final. */
const STYLES: Style[] = [
  { weights: [0.45, 3.2, 0.04, 0.3, 0.1], openFinal: 0.94, finals: [0, 1], longWord: 0.6, diphthong: 0.7, clusters: [0, 1] },
  { weights: [0.3, 2.5, 0.12, 0.85, 0.25], openFinal: 0.7, finals: [1, 2], longWord: 0.45, diphthong: 0.5, clusters: [0, 2] },
  { weights: [0.2, 1.8, 0.2, 1.4, 0.4], openFinal: 0.45, finals: [2, 4], longWord: 0.3, diphthong: 0.3, clusters: [1, 3] },
  { weights: [0.1, 1.1, 0.25, 2.3, 0.7], openFinal: 0.18, finals: [3, 5], longWord: 0.12, diphthong: 0.12, clusters: [2, 4] },
]

function sample<T>(rng: Rng, arr: readonly T[], count: number): T[] {
  const copy = arr.slice()
  rng.shuffle(copy)
  return copy.slice(0, Math.max(0, Math.min(count, copy.length)))
}

function buildAffixSet(rng: Rng, lang: Language, cls: MeaningClass): AffixOption[] {
  const count = rng.next() < 0.6 ? 1 : 2
  const opts: AffixOption[] = []
  for (let i = 0; i < count; i++) {
    let kind: 'prefix' | 'suffix' = 'suffix'
    let attach: 'fuse' | 'space' | 'hyphen' = 'fuse'
    if ((cls === 'coast' || cls === 'new') && lang.twoWord && rng.next() < 0.5) {
      kind = rng.next() < 0.6 ? 'prefix' : 'suffix'
      attach = 'space'
    } else if ((cls === 'hill' || cls === 'ford') && lang.usesHyphen && rng.next() < 0.5) {
      kind = 'prefix'
      attach = 'hyphen'
    } else if (rng.next() < 0.12) {
      kind = 'prefix' // fused prefix
    }
    // a separate word must be a real syllable (3-4 letters); fused affixes may be shorter
    const morph = buildMorph(lang, rng, attach === 'space' ? 3 : 2, kind === 'suffix' && attach === 'fuse')
    opts.push({ text: morph, kind, attach, weight: 1 })
  }
  return opts
}

/** Builds an original tribe's language from a fresh Rng. */
export function buildLanguage(rng: Rng): Language {
  const style = STYLES[rng.int(0, STYLES.length - 1)]
  // most of the core consonants plus a few others
  const core = sample(rng, CORE_CONSONANTS, rng.int(4, 6))
  const others = sample(rng, CONSONANTS_MASTER.filter((c) => core.indexOf(c) < 0), rng.int(3, 6))
  const consonants = core.concat(others)
  const finalPool = FINAL_OK.filter((c) => consonants.indexOf(c) >= 0)
  const nFinals = Math.min(finalPool.length, rng.int(style.finals[0], style.finals[1]))
  // open styles prefer sonorant finals; the pool is ordered sonorants first
  const finals = style.finals[1] <= 2 ? finalPool.slice(0, nFinals) : sample(rng, finalPool, nFinals)
  const codaConsonants = CODA_OK.filter((c) => consonants.indexOf(c) >= 0)
  const clusterPool = ONSET_CLUSTERS_OK.filter((cl) => consonants.indexOf(cl.slice(0, cl.length - 1)) >= 0)
  const onsetClusters = sample(rng, clusterPool, rng.int(style.clusters[0], style.clusters[1]))

  let vowels = sample(rng, PURE_VOWELS, rng.int(3, 5))
  if (vowels.indexOf('a') < 0 && rng.next() < 0.7) vowels = vowels.concat(['a'])
  const diphthongs = rng.next() < style.diphthong ? sample(rng, DIPHTHONGS_OK.filter((d) => vowels.indexOf(d[0]) >= 0), rng.int(1, 2)) : []

  const shapeWeights = style.weights.map((w) => w * (0.75 + rng.next() * 0.5))
  if (!onsetClusters.length) shapeWeights[4] = 0

  const minSyll = 2
  const maxSyll = rng.next() < 0.3 + style.longWord ? 3 : 2
  const usesApostrophe = style.openFinal > 0.6 && rng.next() < 0.18
  const usesHyphen = rng.next() < 0.12
  const twoWord = rng.next() < 0.4

  const lang: Language = {
    consonants, codaConsonants, finals, onsetClusters, vowels, diphthongs, shapeWeights,
    openFinal: Math.min(0.97, Math.max(0.1, style.openFinal + (rng.next() - 0.5) * 0.15)),
    minSyll, maxSyll, longWord: style.longWord, usesApostrophe, usesHyphen, twoWord,
    affixes: {} as Record<MeaningClass, AffixOption[]>,
  }
  for (const cls of MEANING_CLASSES) lang.affixes[cls] = buildAffixSet(rng, lang, cls)
  return lang
}

/** Applies up to `count` applicable shifts element by element (indices are preserved). */
function shiftList(list: readonly string[], shifts: readonly (readonly [string, string])[], rng: Rng, count: number): string[] {
  const applicable = shifts.filter(([from]) => list.indexOf(from) >= 0)
  if (!applicable.length) return list.slice()
  const chosen = sample(rng, applicable, Math.min(count, applicable.length))
  let out = list.slice()
  for (const [from, to] of chosen) out = out.map((x) => (x === from ? to : x))
  return out
}

/** Makes a daughter language: a couple of regular sound shifts, plus a fresh set of affixes. */
export function deriveLanguage(parent: Language, rng: Rng): Language {
  const consonants = shiftList(parent.consonants, CONSONANT_SHIFTS, rng, 2)
  const vowels = shiftList(parent.vowels, VOWEL_SHIFTS, rng, 1)
  // the reflex of each parent consonant, by inventory position
  const reflex = (c: string): string => {
    const i = parent.consonants.indexOf(c)
    return i >= 0 ? consonants[i] : c
  }
  const finals = parent.finals.map(reflex).filter((c, i, a) => FINAL_OK.indexOf(c) >= 0 && a.indexOf(c) === i)
  const codaConsonants = CODA_OK.filter((c) => consonants.indexOf(c) >= 0)
  const onsetClusters = parent.onsetClusters
    .map((cl) => reflex(cl.slice(0, cl.length - 1)) + cl[cl.length - 1])
    .filter((cl, i, a) => ONSET_CLUSTERS_OK.indexOf(cl) >= 0 && a.indexOf(cl) === i)
  const diphthongs = parent.diphthongs.filter((d) => vowels.indexOf(d[0]) >= 0)

  const shapeWeights = parent.shapeWeights.map((w) => w * (0.85 + rng.next() * 0.3))
  if (!onsetClusters.length) shapeWeights[4] = 0
  const lang: Language = {
    consonants,
    codaConsonants,
    finals: finals.length || parent.finals.length === 0 ? finals : ['n'],
    onsetClusters,
    vowels,
    diphthongs,
    shapeWeights,
    openFinal: Math.min(0.97, Math.max(0.1, parent.openFinal + (rng.next() - 0.5) * 0.12)),
    minSyll: parent.minSyll,
    maxSyll: parent.maxSyll,
    longWord: parent.longWord,
    // hiatus marking is a habit that is easily lost and seldom gained
    usesApostrophe: parent.usesApostrophe ? rng.next() < 0.85 : rng.next() < 0.03,
    usesHyphen: parent.usesHyphen,
    twoWord: rng.next() < 0.15 ? !parent.twoWord : parent.twoWord,
    affixes: {} as Record<MeaningClass, AffixOption[]>,
  }
  for (const cls of MEANING_CLASSES) lang.affixes[cls] = buildAffixSet(rng, lang, cls)
  return lang
}
