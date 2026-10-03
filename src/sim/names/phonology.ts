// A Language is a seeded phonology: a small consonant/vowel inventory, syllable
// shapes with weights, a few phonotactic choices (coda set, onset clusters,
// whether hiatus gets an apostrophe) and a small set of place-name affixes per
// meaning class. `buildLanguage` makes an original tribe's language from a
// fresh Rng; `deriveLanguage` makes a daughter language by applying a couple
// of regular sound shifts and regenerating affixes, so descendants sound
// related but drift apart.

import type { Rng } from '../rng.ts'
import { buildMorph } from './words.ts'

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
  codaConsonants: string[]
  onsetClusters: string[]
  vowels: string[]
  shapeWeights: number[]
  minSyll: number
  maxSyll: number
  usesApostrophe: boolean
  affixes: Record<MeaningClass, AffixOption[]>
}

const CONSONANTS_MASTER = ['p', 't', 'k', 'b', 'd', 'g', 'm', 'n', 'ng', 'f', 'v', 's', 'z', 'sh', 'th', 'r', 'l', 'w', 'y', 'h', 'ch']
const CODA_CANDIDATES = ['n', 'm', 'ng', 'r', 'l', 's', 't', 'k', 'd', 'th']
const ONSET_CLUSTERS_MASTER = ['tr', 'dr', 'kr', 'gr', 'pr', 'br', 'fr', 'st', 'sk', 'sp', 'sl', 'sw', 'pl', 'bl', 'gl', 'fl', 'kl', 'shr', 'thr']
const PURE_VOWELS = ['a', 'e', 'i', 'o', 'u']
const DIPHTHONGS = ['ai', 'ei', 'ou', 'ia', 'oa', 'au']

/** Regular sound shifts a daughter language may apply; each only fires if its `from` is in use. */
const CONSONANT_SHIFTS: Array<[string, string]> = [
  ['p', 'f'], ['t', 'th'], ['k', 'h'], ['b', 'v'], ['d', 'th'], ['s', 'z'], ['g', 'gh'], ['w', 'v'], ['th', 'f'], ['f', 'h'],
]
const VOWEL_SHIFTS: Array<[string, string]> = [['a', 'o'], ['e', 'i'], ['o', 'u'], ['u', 'o'], ['i', 'e']]

function sample<T>(rng: Rng, arr: readonly T[], count: number): T[] {
  const copy = arr.slice()
  rng.shuffle(copy)
  return copy.slice(0, Math.max(0, Math.min(count, copy.length)))
}

function buildAffixSet(rng: Rng, lang: Language, cls: MeaningClass): AffixOption[] {
  const count = rng.next() < 0.6 ? 1 : 2
  const opts: AffixOption[] = []
  for (let i = 0; i < count; i++) {
    const morph = buildMorph(lang, rng)
    let kind: 'prefix' | 'suffix' = 'suffix'
    let attach: 'fuse' | 'space' | 'hyphen' = 'fuse'
    if (cls === 'coast' || cls === 'new') {
      if (rng.next() < 0.55) { kind = 'prefix'; attach = 'space' }
    } else if (cls === 'hill' || cls === 'ford') {
      if (rng.next() < 0.12) { kind = 'prefix'; attach = 'hyphen' }
    }
    opts.push({ text: morph, kind, attach, weight: 1 })
  }
  return opts
}

/** Builds an original tribe's language from a fresh Rng. */
export function buildLanguage(rng: Rng): Language {
  const nCons = rng.int(7, 11)
  const consonants = sample(rng, CONSONANTS_MASTER, nCons)
  const codaPool = CODA_CANDIDATES.filter((c) => consonants.indexOf(c) >= 0)
  const codaSource = codaPool.length ? codaPool : consonants
  const codaConsonants = sample(rng, codaSource, Math.max(2, Math.min(codaSource.length, rng.int(2, 5))))
  const clusterPool = ONSET_CLUSTERS_MASTER.filter((cl) => consonants.indexOf(cl[0]) >= 0)
  const onsetClusters = clusterPool.length ? sample(rng, clusterPool, rng.int(0, Math.min(4, clusterPool.length))) : []

  let vowels = sample(rng, PURE_VOWELS, Math.min(5, rng.int(3, 5)))
  if (!vowels.length) vowels = ['a']
  if (rng.next() < 0.5) vowels = vowels.concat(sample(rng, DIPHTHONGS, 1))

  const shapeWeights = [
    0.5 + rng.next(),
    1.5 + rng.next() * 1.5,
    0.3 + rng.next(),
    0.8 + rng.next() * 1.2,
    onsetClusters.length ? 0.2 + rng.next() * 0.8 : 0,
  ]

  const minSyll = 2
  const maxSyll = rng.next() < 0.55 ? 3 : 2
  const usesApostrophe = rng.next() < 0.15

  const lang: Language = {
    consonants, codaConsonants, onsetClusters, vowels, shapeWeights, minSyll, maxSyll, usesApostrophe,
    affixes: {} as Record<MeaningClass, AffixOption[]>,
  }
  for (const cls of MEANING_CLASSES) lang.affixes[cls] = buildAffixSet(rng, lang, cls)
  return lang
}

function shiftList(list: readonly string[], shifts: readonly (readonly [string, string])[], rng: Rng, count: number): string[] {
  const applicable = shifts.filter(([from]) => list.indexOf(from) >= 0)
  if (!applicable.length) return list.slice()
  const chosen = sample(rng, applicable, Math.min(count, applicable.length))
  let out = list.slice()
  for (const [from, to] of chosen) out = out.map((x) => (x === from ? to : x))
  return out
}

function shiftClusters(clusters: readonly string[], shifts: readonly (readonly [string, string])[], rng: Rng, count: number): string[] {
  const applicable = shifts.filter(([from]) => clusters.some((cl) => cl.indexOf(from) >= 0))
  if (!applicable.length) return clusters.slice()
  const chosen = sample(rng, applicable, Math.min(count, applicable.length))
  let out = clusters.slice()
  for (const [from, to] of chosen) out = out.map((cl) => cl.split(from).join(to))
  return out
}

/** Makes a daughter language: a couple of regular sound shifts, plus a fresh set of affixes. */
export function deriveLanguage(parent: Language, rng: Rng): Language {
  const consonants = shiftList(parent.consonants, CONSONANT_SHIFTS, rng, 2)
  const codaConsonants = shiftList(parent.codaConsonants, CONSONANT_SHIFTS, rng, 2).filter((c) => consonants.indexOf(c) >= 0 || CODA_CANDIDATES.indexOf(c) >= 0)
  const onsetClusters = shiftClusters(parent.onsetClusters, CONSONANT_SHIFTS, rng, 1)
  const vowels = shiftList(parent.vowels, VOWEL_SHIFTS, rng, 1)

  const lang: Language = {
    consonants,
    codaConsonants: codaConsonants.length ? codaConsonants : consonants.slice(0, Math.max(1, Math.min(2, consonants.length))),
    onsetClusters,
    vowels: vowels.length ? vowels : parent.vowels.slice(),
    shapeWeights: parent.shapeWeights.map((w) => w * (0.7 + rng.next() * 0.6)),
    minSyll: parent.minSyll,
    maxSyll: parent.maxSyll,
    usesApostrophe: rng.next() < 0.2 ? !parent.usesApostrophe : parent.usesApostrophe,
    affixes: {} as Record<MeaningClass, AffixOption[]>,
  }
  for (const cls of MEANING_CLASSES) lang.affixes[cls] = buildAffixSet(rng, lang, cls)
  return lang
}
