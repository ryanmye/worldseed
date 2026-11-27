// language: the drift context of one assembly (language-drift.md §4): the tree (languageTree.ts), each language's pace and
// sound changes, and the core vocabulary (lexicon.ts), with the lookups naming needs: the sound pattern and words a language
// coins with at a year, and a form as said by a language at a year. Built from the settlement table and the world alone
// (contact.ts adds loans and language shifts to it before any name is coined).

import type { World } from '../../contract.ts'
import { createRng } from '../rng.ts'
import { buildLexicon, GEO_CLASSES, type Lexicon } from './featureNames.ts'
import { LANG } from './languageParams.ts'
import { buildTree, drawRates, drawRules, nodeAt, type LanguageTree, type TreeSettlement } from './languageTree.ts'
import { drawLexicon, MEANING, protoWords, wordAt, type LexState } from './lexicon.ts'
import type { Language } from './phonology.ts'
import { buildLanguage, MEANING_CLASSES } from './phonology.ts'
import { evolve, type LanguageRules } from './soundChange.ts'
import { capitalizeName } from './words.ts'
import { drawProfiles, type ProfileInput } from './typology/profile.ts'
import { typoLanguage, withOrtho } from './typology/words.ts'
import { deriveOrtho, drawOrtho, repairOrtho, romanize, writable } from './typology/orthography.ts'
import { TYPO } from './typology/params.ts'

/** typology: what the profiles need (HistoryOptions.typology): each people's cradle (People.cradle) and each cradle's centre cell. */
export interface TypoInput {
  cradle: readonly number[]
  centres: readonly number[]
}

export interface Drift {
  world: World
  years: number
  tree: LanguageTree
  rates: number[]
  rules: LanguageRules
  lex: LexState
  /** Milliseconds spent on the tree, the rules and the vocabulary (diagnostics). */
  ms: { tree: number; rules: number; lex: number }
  /** The founder (tribe) of each language's people: whose sound pattern it coins in ('names-lang-<tribe>'). */
  tribe: number[]
  /** The sound pattern of language n's people (its proto-language's Language, without drift). */
  base(n: number): Language
  /** typology: the spelling tradition and packed profile of each language (absent without HistoryOptions.typology). */
  ortho?: Uint32Array
  typo?: Uint32Array
  /** Language n's sound pattern with the site affixes in force at `year`. */
  langAt(n: number, year: number): Language
  /** Language n's geographic vocabulary in force at `year`, with its people's naming habits. */
  lexiconAt(n: number, year: number): Lexicon
  /** Language n's two city endings in force at `year`. */
  endingsAt(n: number, year: number): string[]
  /** The language settlement `id` speaks at `year`. */
  node(id: number, year: number): number
  /** A form (lower case) said at `year` by language n, having entered it after `from` (-1: a native word). */
  surface(form: string, n: number, year: number, from?: number): string
  /** surface, capitalised as a name (at least LANG.minNameLetters letters). */
  surfaceName(form: string, n: number, year: number, from?: number): string
  /** The word for meaning m in language n at `year`, as said then (a loan from when it was borrowed). */
  wordSaid(n: number, m: number, year: number): string
}

/** Packs per-language rule lists into the History.languages rule columns. */
export function packRules(count: number, parent: readonly number[], splitYear: readonly number[], drawn: { year: number[][]; kind: number[][]; variant: number[][] }): LanguageRules {
  const start = new Int32Array(count + 1)
  for (let n = 0; n < count; n++) start[n + 1] = start[n] + drawn.year[n].length
  const R = start[count]
  const L: LanguageRules = {
    count, parent: Int16Array.from(parent), splitYear: Int16Array.from(splitYear), ruleStart: start,
    ruleYear: new Int16Array(R), ruleKind: new Uint8Array(R), ruleVariant: new Uint8Array(R),
  }
  for (let n = 0; n < count; n++) {
    for (let i = 0; i < drawn.year[n].length; i++) {
      const r = start[n] + i
      L.ruleYear[r] = drawn.year[n][i]; L.ruleKind[r] = drawn.kind[n][i]; L.ruleVariant[r] = drawn.variant[n][i]
    }
  }
  return L
}

/** The drift context for a settlement table assembled at `years` (see the file comment). */
export function buildDrift(world: World, settlements: readonly TreeSettlement[], years: number, typoIn?: TypoInput): Drift {
  const seed = world.seed
  const t0 = performance.now()
  const tree = buildTree(world, settlements)
  const t1 = performance.now()
  const N = tree.count
  const tribe: number[] = []
  for (let n = 0; n < N; n++) tribe.push(tree.parent[n] < 0 ? tree.seat[n] : tribe[tree.parent[n]])
  const baseCache = new Map<number, Language>()
  // typology: every people's sound system at once (the profiles' balance guard looks at all of them), from 'names-typo-world',
  // 'names-typo-<tribe>' and 'names-ortho-<node>'; each language's tradition is its parent's with 1-2 slots redrawn now and then.
  let ortho: Uint32Array | undefined, typoBits: Uint32Array | undefined
  if (typoIn) {
    const roots: number[] = []
    for (let n = 0; n < N; n++) if (tree.parent[n] < 0) roots.push(n)
    const P = world.grid.positions
    const unit = (cell: number): [number, number, number] => {
      const x = P[cell * 3], y = P[cell * 3 + 1], z = P[cell * 3 + 2], r = Math.hypot(x, y, z) || 1
      return [x / r, y / r, z / r]
    }
    const C = typoIn.centres.length
    const inputs: ProfileInput[] = roots.map((n) => {
      const t = tree.seat[n]
      const c = Math.max(0, Math.min(C - 1, typoIn.cradle[settlements[t].people] ?? 0))
      const a = unit(settlements[t].cell), b = C ? unit(typoIn.centres[c]) : a
      return { tribe: t, cradle: c, fromCentre: (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 }
    })
    const prof = drawProfiles(seed, inputs, C, (c) => unit(typoIn.centres[c]))
    ortho = new Uint32Array(N)
    typoBits = new Uint32Array(N)
    roots.forEach((n, i) => {
      const o0 = drawOrtho(createRng(seed, `names-ortho-${n}`))
      const lang = typoLanguage(prof.draw[i], prof.rng[i], o0)
      const t = lang.typo!
      t.ortho = repairOrtho(writable(t.cons, t.vowels, t.tones), o0)
      baseCache.set(tree.seat[n], lang)
    })
    for (let n = 0; n < N; n++) {
      const t = baseCache.get(tribe[n])!.typo!
      ortho[n] = tree.parent[n] < 0 ? t.ortho : repairOrtho(writable(t.cons, t.vowels, t.tones), deriveOrtho(ortho[tree.parent[n]], createRng(seed, `names-ortho-${n}`), TYPO.orthoRedraw))
      typoBits[n] = t.bits
    }
  }
  const base = (n: number): Language => {
    const t = tribe[n]
    let l = baseCache.get(t)
    if (!l) baseCache.set(t, (l = buildLanguage(createRng(seed, `names-lang-${t}`))))
    return l
  }
  const protoCache = new Map<number, string[]>()
  const proto = (n: number): string[] => {
    const t = tribe[n]
    let w = protoCache.get(t)
    if (!w) protoCache.set(t, (w = protoWords(world, base(n), t)))
    return w
  }
  const rates = drawRates(seed, N)
  // the sample vocabulary for rule applicability: the visible words (each affix text) and 12 core words
  const sample = (n: number): string[] => {
    const w = proto(n)
    const out: string[] = []
    for (let m = 0; m < LANG.visible + 12 && m < w.length; m++) for (const x of w[m].split('|')) if (x.indexOf(' ') < 0) out.push(x)
    return out
  }
  const rules = packRules(N, tree.parent, tree.splitYear, drawRules(seed, tree, rates, sample, years))
  if (typoBits) rules.typo = typoBits
  const t2 = performance.now()
  const lex = drawLexicon(seed, tree, rates, proto, base, years)
  const t3 = performance.now()

  const habits = new Map<number, Lexicon>()
  const habitsOf = (n: number): Lexicon => {
    const t = tribe[n]
    let h = habits.get(t)
    if (!h) habits.set(t, (h = buildLexicon(base(n), createRng(seed, `names-geo-${t}-0`))))
    return h
  }
  const formAt = (n: number, m: number, year: number): string => {
    const [k, i] = wordAt(lex, tree, n, m, year)
    return k < 0 ? proto(n)[m] : lex.rows[k * LANG.core + m][i].form
  }
  const keyOf = (n: number, from: number, to: number, year: number): string => {
    let key = String(n)
    for (let m = from; m < to; m++) { const [k, i] = wordAt(lex, tree, n, m, year); key += ':' + k + '.' + i }
    return key
  }
  const langCache = new Map<string, Language>()
  const lexCache = new Map<string, Lexicon>()
  const surface = (form: string, n: number, year: number, from = -1): string => evolve(rules, form, n, from, year, 2)
  const drift: Drift = {
    world, years, tree, rates, rules, lex, tribe, base, ortho, typo: typoBits, ms: { tree: t1 - t0, rules: t2 - t1, lex: t3 - t2 },
    langAt(n, year) {
      const key = keyOf(n, MEANING.affix, MEANING.geo, year)
      let l = langCache.get(key)
      if (l) return l
      const b = base(n)
      const affixes = {} as Language['affixes']
      MEANING_CLASSES.forEach((cls, m) => {
        const texts = formAt(n, MEANING.affix + m, year).split('|')
        affixes[cls] = b.affixes[cls].map((o, i) => ({ ...o, text: texts[Math.min(i, texts.length - 1)] || o.text }))
      })
      l = { ...b, affixes }
      if (ortho) l = withOrtho(l, ortho[n]) // (typology: spelt in this language's tradition)
      langCache.set(key, l)
      return l
    },
    lexiconAt(n, year) {
      const key = keyOf(n, MEANING.geo, MEANING.city, year)
      let x = lexCache.get(key)
      if (x) return x
      const h = habitsOf(n)
      const words = {} as Lexicon['words']
      GEO_CLASSES.forEach((g, i) => { words[g] = formAt(n, MEANING.geo + i, year) })
      x = { ...h, words, derive: formAt(n, MEANING.derive, year) }
      lexCache.set(key, x)
      return x
    },
    endingsAt(n, year) {
      return [formAt(n, MEANING.city, year), formAt(n, MEANING.city + 1, year)]
    },
    node: (id, year) => nodeAt(tree, id, year),
    surface,
    surfaceName(form, n, year, from = -1) {
      const said = evolve(rules, form.toLowerCase(), n, from, year, LANG.minNameLetters)
      return capitalizeName(ortho ? romanize(said, ortho[n], 'plain') : said)
    },
    wordSaid(n, m, year) {
      const [k, i] = wordAt(lex, tree, n, m, year)
      if (k < 0) return proto(n)[m]
      const row = lex.rows[k * LANG.core + m][i]
      return row.form.split('|').map((x) => surface(x, n, year, row.donor < 0 ? -1 : row.year)).join('|')
    },
  }
  return drift
}
