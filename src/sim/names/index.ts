// Procedural settlement names: deterministic from world.seed and the
// settlement table alone (ids, cells, parents, founding years) so a name
// never changes when unrelated simulation rules are tuned.
//
// Each original tribe (parent -1) gets its own Language (phonology.ts). A
// settlement inherits its parent's language; branch "distance" grows with
// generation depth and with years since the tribe's founding, and at each
// branch level a daughter language is derived by sound shift + suffix swap.
// A name is a root built in that language, sometimes combined with a
// site-based affix (river, coast, hill, forest, plain, lake, ford) chosen
// from the settlement's cell, or occasionally named after its parent.
//
// All draws come from the 'names-*' Rng streams, never streams used by the
// rest of the history sim, and settlements are named strictly in id order
// (parent before child) so naming a prefix of the table reproduces the same
// names as naming the whole table.
//
// Geographic features (continents, seas, rivers, ...) are found by
// features.ts and named by `nameFeatures` (featureNames.ts) in the language
// of the settlement that first settles on or beside them.

import { Biome, RIVER_FLOW_THRESHOLD } from '../../contract.ts'
import type { World } from '../../contract.ts'
import { createRng } from '../rng.ts'
import type { Language, MeaningClass } from './phonology.ts'
import { buildLanguage, deriveLanguage, MEANING_CLASSES } from './phonology.ts'
import { buildRoot, composeName, fluentName, letterCount, pickWeighted } from './words.ts'
import type { Drift } from './drift.ts'

/** The fields `nameSettlements` needs from a settlement; a subset of the full contract type. */
export interface SettlementLike {
  id: number
  cell: number
  parent: number
  foundedYear: number
}

/** Generations between possible language branch points. */
const GEN_PER_BRANCH = 5
/** Years since the tribe's founding between possible language branch points. */
const YEARS_PER_BRANCH = 350
/** Hard cap on branch depth so a 2000-year run cannot recurse unboundedly. */
const MAX_BRANCH = 8
/** Chance a settlement with a parent is named after it instead of getting a fresh root. */
const PARENT_NAME_PROB = 0.12
/** Chance a settlement with an applicable site class gets that affix. */
const SITE_AFFIX_PROB = 0.42

const SITE_CLASSES: readonly MeaningClass[] = ['river', 'coast', 'hill', 'forest', 'plain', 'lake', 'ford']

/** Site-based meaning classes that apply to a cell (river, coast, hill, forest, plain, lake, ford). */
function siteClasses(world: World, cell: number): MeaningClass[] {
  const classes: MeaningClass[] = []
  const biome = world.biome[cell]
  const isRiver = world.flow[cell] >= RIVER_FLOW_THRESHOLD
  if (isRiver) classes.push('river')
  if (biome === Biome.Mountain) classes.push('hill')
  if (biome === Biome.TemperateForest || biome === Biome.Taiga || biome === Biome.Rainforest) classes.push('forest')
  if (biome === Biome.Grassland || biome === Biome.Savanna) classes.push('plain')
  const { neighborOffsets: off, neighbors: nb } = world.grid
  let coastal = false
  let lakeAdj = false
  for (let k = off[cell]; k < off[cell + 1]; k++) {
    const j = nb[k]
    if (world.elevation[j] < 0) coastal = true
    if (world.lake[j]) lakeAdj = true
  }
  if (coastal) classes.push('coast')
  if (lakeAdj) classes.push('lake')
  if (isRiver) classes.push('ford') // a crossing-point flavor alongside plain river names
  return classes
}

/** Settlement names plus what feature naming needs to speak each settlement's language. */
export interface SettlementNaming {
  names: string[]
  /** The bare root (lower case) each name was built on. */
  roots: string[]
  /** Originating tribe (an original settlement's id) and language branch level per settlement. */
  tribe: Int32Array
  level: Int32Array
  /**
   * The language of a tribe at a branch level (memoised). language: with drift, `level` is the coining language's id
   * (History.languages) and this its people's sound pattern with its words as at its start (`tribe` is kept for the call shape;
   * level 0 still means the tribe's own proto-language).
   */
  language(tribe: number, level: number): Language
  /** language: the drift context (absent without HistoryOptions.language). */
  drift?: Drift
  /** language: each settlement's founding name as an underlying form (lower case), with drift. */
  forms?: string[]
  /** language: the language settlement `id` speaks at `year`, with drift. */
  node?(id: number, year: number): number
  /** language: a form (lower case) as said by language `node` at `year`, with drift. */
  surface?(form: string, node: number, year: number): string
}

/**
 * Names every settlement and reports each one's root and language. Pure in
 * (world, settlements): depends on no other simulation state.
 */
export function nameSettlementsDetailed(world: World, settlements: readonly SettlementLike[], drift?: Drift): SettlementNaming {
  const n = settlements.length
  const names = new Array<string>(n)
  const roots = new Array<string>(n)
  const tribeRoot = new Int32Array(n)
  const levelOf = new Int32Array(n)

  const langCache = new Map<string, Language>()
  function getLanguage(tribe: number, level: number): Language {
    if (drift) {
      // (level 0: the tribe's proto-language, as callers that ask for a people's own tongue mean; else the language id)
      const node = level === 0 && tribe >= 0 && tribe < drift.tree.foundNode.length ? drift.tree.foundNode[tribe] : level
      return drift.langAt(node, drift.tree.splitYear[node])
    }
    const key = tribe + ':' + level
    const cached = langCache.get(key)
    if (cached) return cached
    const lang = level <= 0
      ? buildLanguage(createRng(world.seed, `names-lang-${tribe}`))
      : deriveLanguage(getLanguage(tribe, level - 1), createRng(world.seed, `names-shift-${tribe}-${level}`))
    langCache.set(key, lang)
    return lang
  }
  const result: SettlementNaming = { names, roots, tribe: tribeRoot, level: levelOf, language: getLanguage }
  // language: with drift a name is coined as an underlying form in the language spoken at the founding, with the words then in
  // force, and borne as said that year (uniqueness and fluency are judged on what is said); without, `say` is the identity.
  const forms = drift ? new Array<string>(n) : undefined
  if (drift) {
    result.drift = drift
    result.forms = forms
    result.node = drift.node
    result.surface = (form, node, year) => drift.surface(form, node, year)
  }
  if (n === 0) return result

  // Generation depth and originating tribe, single pass (parent always precedes child).
  const depth = new Int32Array(n)
  for (let id = 0; id < n; id++) {
    const p = settlements[id].parent
    if (p < 0) { depth[id] = 0; tribeRoot[id] = id } else { depth[id] = depth[p] + 1; tribeRoot[id] = tribeRoot[p] }
  }

  const rng = createRng(world.seed, 'names-draw')
  const used = new Set<string>()
  const taken = new Set<string>()

  for (let id = 0; id < n; id++) {
    const st = settlements[id]
    const tribe = tribeRoot[id]
    const yearsSince = st.foundedYear - settlements[tribe].foundedYear
    const branchLevel = drift ? drift.tree.foundNode[id] : Math.min(MAX_BRANCH, Math.max(Math.floor(depth[id] / GEN_PER_BRANCH), Math.floor(yearsSince / YEARS_PER_BRANCH)))
    levelOf[id] = branchLevel
    const lang = drift ? drift.langAt(branchLevel, st.foundedYear) : getLanguage(tribe, branchLevel)
    const say = drift ? (x: string): string => drift.surfaceName(x, branchLevel, st.foundedYear) : (x: string): string => x
    const classes = siteClasses(world, st.cell)

    let name: string | null = null
    let root = ''
    for (let attempts = 1; ; attempts++) {
      if (st.parent >= 0 && rng.next() < PARENT_NAME_PROB) {
        root = roots[st.parent] ?? 'ana'
        const opts = lang.affixes.new
        name = composeName(lang, root, opts[pickWeighted(rng, opts.map((o) => o.weight))])
      } else {
        root = buildRoot(lang, rng)
        if (classes.length && rng.next() < SITE_AFFIX_PROB) {
          const opts = lang.affixes[classes[rng.int(0, classes.length - 1)]]
          name = composeName(lang, root, opts[pickWeighted(rng, opts.map((o) => o.weight))])
        } else {
          name = composeName(lang, root, undefined)
        }
      }
      if (name !== null) {
        const said = say(name)
        const lc = letterCount(said)
        if (!used.has(said.toLowerCase()) && lc >= 3 && lc <= 12) break
      }
      if (attempts > 300) { // practically unreachable safety valve; never appends a number
        name = name ?? composeName(lang, root, undefined) ?? 'Ana'
        break
      }
    }
    // An awkward name (an echoed syllable, too long, one vowel throughout: words.ts isFluent) is drawn again from a stream of
    // its own, so the shared stream above draws as before and no other settlement's name changes; the root stays (a
    // daughter town still takes its parent's root).
    // (`used` holds the names the shared stream gave, as before; `taken` the names given; one the stream gives that a
    // redrawn name took is drawn again too)
    let said = say(name)
    used.add(said.toLowerCase())
    if (!fluentName(said) || taken.has(said.toLowerCase())) {
      const r2 = createRng(world.seed, `names-fluent-${id}`)
      for (let k = 0; k < 80; k++) {
        const cand = st.parent >= 0 && r2.next() < PARENT_NAME_PROB
          ? composeName(lang, roots[st.parent] ?? 'ana', lang.affixes.new[pickWeighted(r2, lang.affixes.new.map((o) => o.weight))])
          : composeName(lang, buildRoot(lang, r2), undefined)
        if (cand === null) continue
        const c = say(cand)
        if ((k < 60 && !fluentName(c)) || used.has(c.toLowerCase()) || taken.has(c.toLowerCase())) continue
        const lc = letterCount(c)
        if (lc >= 3 && lc <= 12) { name = cand; said = c; break }
      }
    }
    taken.add(said.toLowerCase())
    roots[id] = root
    names[id] = said
    if (forms) forms[id] = name.toLowerCase()
  }

  return result
}

/**
 * Procedurally names every settlement. Pure in (world, settlements): depends
 * on no other simulation state, so names are stable across unrelated tuning.
 */
export function nameSettlements(world: World, settlements: readonly SettlementLike[]): string[] {
  return nameSettlementsDetailed(world, settlements).names
}

export type { Language, MeaningClass } from './phonology.ts'
export { MEANING_CLASSES, SITE_CLASSES }
