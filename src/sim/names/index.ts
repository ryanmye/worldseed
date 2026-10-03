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
import { buildRoot, composeName, letterCount, pickWeighted } from './words.ts'

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
  /** The language of a tribe at a branch level (memoised). */
  language(tribe: number, level: number): Language
}

/**
 * Names every settlement and reports each one's root and language. Pure in
 * (world, settlements): depends on no other simulation state.
 */
export function nameSettlementsDetailed(world: World, settlements: readonly SettlementLike[]): SettlementNaming {
  const n = settlements.length
  const names = new Array<string>(n)
  const roots = new Array<string>(n)
  const tribeRoot = new Int32Array(n)
  const levelOf = new Int32Array(n)

  const langCache = new Map<string, Language>()
  function getLanguage(tribe: number, level: number): Language {
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
  if (n === 0) return result

  // Generation depth and originating tribe, single pass (parent always precedes child).
  const depth = new Int32Array(n)
  for (let id = 0; id < n; id++) {
    const p = settlements[id].parent
    if (p < 0) { depth[id] = 0; tribeRoot[id] = id } else { depth[id] = depth[p] + 1; tribeRoot[id] = tribeRoot[p] }
  }

  const rng = createRng(world.seed, 'names-draw')
  const used = new Set<string>()

  for (let id = 0; id < n; id++) {
    const st = settlements[id]
    const tribe = tribeRoot[id]
    const yearsSince = st.foundedYear - settlements[tribe].foundedYear
    const branchLevel = Math.min(MAX_BRANCH, Math.max(Math.floor(depth[id] / GEN_PER_BRANCH), Math.floor(yearsSince / YEARS_PER_BRANCH)))
    levelOf[id] = branchLevel
    const lang = getLanguage(tribe, branchLevel)
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
        const lc = letterCount(name)
        if (!used.has(name.toLowerCase()) && lc >= 3 && lc <= 12) break
      }
      if (attempts > 300) { // practically unreachable safety valve; never appends a number
        name = name ?? composeName(lang, root, undefined) ?? 'Ana'
        break
      }
    }
    used.add(name.toLowerCase())
    roots[id] = root
    names[id] = name
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
