// language: the core vocabulary of each language (language-drift.md §4.4). LANG.core meanings; the first LANG.visible are the
// words names are made of:
//   0..7    the site affixes of each MeaningClass (river, coast, hill, forest, plain, lake, ford, new; a word is the texts of
//           the class's affix options, joined by '|'),
//   8..17   the geographic words of feature names (featureNames.ts GEO_CLASSES: ocean ... great),
//   18      the derivational ending ("Kepi" -> "Kepian"),
//   19, 20  the two city endings of renamed places (placeNames.ts cityEndings).
// A proto-language inherits its people's words: the affixes of buildLanguage('names-lang-<tribe>'), the geographic words and
// ending of the level-0 lexicon ('names-geo-<tribe>-0'), the city endings of 'names-cityaffix-<tribe>-0' (all as the names
// without drift have them) and fresh roots for the rest ('lang-core-<tribe>'). Each meaning of each language is then replaced
// on its own branch by a renewal process at LANG.lambda x rate per millennium from the language's start ('lang-lex-<n>-<m>'),
// each new word coined in the people's sound pattern. Contact (contact.ts) adds loans to the same rows.
//
// The word for a meaning in force in language n at year Y is the latest row of n at or before Y, else the latest row of its
// parent before n's split, and so on up the lineage (a daughter inherits the words of the day she parted).

import type { World } from '../../contract.ts'
import { createRng } from '../rng.ts'
import type { Rng } from '../rng.ts'
import { buildLexicon, GEO_CLASSES } from './featureNames.ts'
import { LANG } from './languageParams.ts'
import type { Language } from './phonology.ts'
import { MEANING_CLASSES } from './phonology.ts'
import { buildMorph, buildRoot } from './words.ts'
import { typoCoinWord } from './typology/words.ts'

/** Meaning ids of the visible words. */
export const MEANING = { affix: 0, geo: 8, derive: 18, city: 19 } as const

export interface LexRow {
  year: number
  /** Donor language, -1 a native word. */
  donor: number
  form: string
}

/** The vocabulary being built: rows[n * LANG.core + m], years ascending. */
export interface LexState {
  rows: LexRow[][]
}

/** What the lookups need of the tree. */
export interface LexTree {
  count: number
  parent: ArrayLike<number>
  splitYear: ArrayLike<number>
}

/** The inherited words of a people (see the file comment). */
export function protoWords(world: World, lang: Language, tribe: number): string[] {
  const out: string[] = []
  for (const cls of MEANING_CLASSES) out.push(lang.affixes[cls].map((o) => o.text).join('|'))
  const lex = buildLexicon(lang, createRng(world.seed, `names-geo-${tribe}-0`))
  for (const g of GEO_CLASSES) out.push(lex.words[g])
  out.push(lex.derive)
  const er = createRng(world.seed, `names-cityaffix-${tribe}-0`)
  out.push(buildMorph(lang, er, 2, true), buildMorph(lang, er, 3, true))
  const rng = createRng(world.seed, `lang-core-${tribe}`)
  while (out.length < LANG.core) out.push(buildRoot(lang, rng))
  return out
}

/** A new native word for meaning m, shaped like the word it replaces. */
export function coinWord(lang: Language, m: number, rng: Rng): string {
  if (lang.typo) return typoCoinWord(lang, m, rng, MEANING.geo, MEANING.derive, MEANING.city, GEO_CLASSES.indexOf('land'))
  if (m < MEANING.geo) {
    const cls = MEANING_CLASSES[m]
    return lang.affixes[cls].map((o) => buildMorph(lang, rng, o.attach === 'space' ? 3 : 2, o.kind === 'suffix' && o.attach === 'fuse')).join('|')
  }
  if (m < MEANING.derive) return buildMorph(lang, rng, GEO_CLASSES[m - MEANING.geo] === 'land' ? 2 : 3, true)
  if (m === MEANING.derive || m === MEANING.city) return buildMorph(lang, rng, 2, true)
  if (m === MEANING.city + 1) return buildMorph(lang, rng, 3, true)
  return buildRoot(lang, rng)
}

/** Gamma(k, 1/k) per meaning (mean 1; LANG.meaningShape 0: every meaning 1), from 'lang-meaning-<m>'. */
export function meaningRates(seed: number): number[] {
  const k = LANG.meaningShape
  const out: number[] = []
  for (let m = 0; m < LANG.core; m++) {
    if (!(k > 0)) { out.push(1); continue }
    // Marsaglia & Tsang for shape >= 1; boosted for shape < 1
    const rng = createRng(seed, `lang-meaning-${m}`)
    const a = k < 1 ? k + 1 : k
    const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d)
    let x = 0
    for (;;) {
      const u1 = 1 - rng.next(), u2 = rng.next()
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      const v = Math.pow(1 + c * z, 3)
      if (v <= 0) continue
      if (Math.log(1 - rng.next()) < 0.5 * z * z + d - d * v + d * Math.log(v)) { x = d * v; break }
    }
    if (k < 1) x *= Math.pow(1 - rng.next(), 1 / k)
    out.push(x / k)
  }
  return out
}

/**
 * The inherited words of every proto-language and the native replacements of every language up to `years` (see the file
 * comment). `proto(n)` gives a proto-language's inherited words; `lang(n)` the sound pattern its people coin in.
 */
export function drawLexicon(seed: number, tree: LexTree, rates: readonly number[], proto: (n: number) => readonly string[], lang: (n: number) => Language, years: number): LexState {
  const C = LANG.core
  const rows: LexRow[][] = []
  const g = meaningRates(seed)
  for (let n = 0; n < tree.count; n++) {
    const start = tree.splitYear[n]
    const inherited = tree.parent[n] < 0 ? proto(n) : null
    for (let m = 0; m < C; m++) {
      const list: LexRow[] = []
      if (inherited) list.push({ year: start, donor: -1, form: inherited[m] })
      const rate = LANG.lambda * rates[n] * g[m]
      if (rate > 0) {
        const rng = createRng(seed, `lang-lex-${n}-${m}`)
        let t = start
        for (;;) {
          t += -Math.log(1 - rng.next()) * 1000 / rate
          const year = Math.floor(t)
          if (year > years || year > 32767) break
          list.push({ year, donor: -1, form: coinWord(lang(n), m, rng) })
        }
      }
      rows.push(list)
    }
  }
  return { rows }
}

/**
 * The row in force for meaning m in language n at year Y: [language holding it, index in its rows], or [-1, -1] (a language
 * with no inherited word: never for a tree built here).
 */
export function wordAt(lex: LexState, tree: LexTree, n: number, m: number, year: number): [number, number] {
  let end = Infinity
  for (let k = n; k >= 0; k = tree.parent[k]) {
    const list = lex.rows[k * LANG.core + m]
    for (let i = list.length - 1; i >= 0; i--) {
      const y = list[i].year
      if (y <= year && y < end) return [k, i]
    }
    end = tree.splitYear[k]
  }
  return [-1, -1]
}
