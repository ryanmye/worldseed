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
const PARENT_NAME_PROB = 0.14
/** Chance a settlement with an applicable site class gets that affix. */
const SITE_AFFIX_PROB = 0.5

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

/**
 * Procedurally names every settlement. Pure in (world, settlements): depends
 * on no other simulation state, so names are stable across unrelated tuning.
 */
export function nameSettlements(world: World, settlements: readonly SettlementLike[]): string[] {
  const n = settlements.length
  const result = new Array<string>(n)
  if (n === 0) return result

  // Generation depth and originating tribe, single pass (parent always precedes child).
  const depth = new Int32Array(n)
  const tribeRoot = new Int32Array(n)
  for (let id = 0; id < n; id++) {
    const p = settlements[id].parent
    if (p < 0) { depth[id] = 0; tribeRoot[id] = id } else { depth[id] = depth[p] + 1; tribeRoot[id] = tribeRoot[p] }
  }

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

  const rng = createRng(world.seed, 'names-draw')
  const used = new Set<string>()
  const rootOf = new Array<string>(n)

  for (let id = 0; id < n; id++) {
    const st = settlements[id]
    const tribe = tribeRoot[id]
    const yearsSince = st.foundedYear - settlements[tribe].foundedYear
    const branchLevel = Math.min(MAX_BRANCH, Math.max(Math.floor(depth[id] / GEN_PER_BRANCH), Math.floor(yearsSince / YEARS_PER_BRANCH)))
    const lang = getLanguage(tribe, branchLevel)
    const classes = siteClasses(world, st.cell)

    let name = ''
    let root = ''
    let attempts = 0
    for (;;) {
      attempts++
      if (st.parent >= 0 && rng.next() < PARENT_NAME_PROB) {
        const parentRoot = rootOf[st.parent] ?? 'a'
        const opts = lang.affixes.new
        const opt = opts[pickWeighted(rng, opts.map((o) => o.weight))]
        root = parentRoot
        name = composeName(lang, parentRoot, opt)
      } else {
        root = buildRoot(lang, rng)
        if (classes.length && rng.next() < SITE_AFFIX_PROB) {
          const cls = classes[rng.int(0, classes.length - 1)]
          const opts = lang.affixes[cls]
          const opt = opts[pickWeighted(rng, opts.map((o) => o.weight))]
          name = composeName(lang, root, opt)
        } else {
          name = composeName(lang, root, undefined)
        }
      }
      const key = name.toLowerCase()
      const lc = letterCount(name)
      if (!used.has(key) && lc >= 3 && lc <= 12) break
      if (attempts > 300) break // practically unreachable safety valve; never appends a number
    }
    used.add(name.toLowerCase())
    rootOf[id] = root
    result[id] = name
  }

  return result
}

export type { Language, MeaningClass } from './phonology.ts'
export { MEANING_CLASSES, SITE_CLASSES }
