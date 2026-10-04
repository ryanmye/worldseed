// Names for geographic features: a feature is named in the year the first
// settlement is founded on or beside it (see featuresAt), by that settlement,
// in its language. Each language has a small geographic vocabulary (words
// working like "Sea", "River", "Mount", "-land", "Great") and its own habits:
// whether the generic word comes before or after the name, how often it fuses
// onto it. A daughter language inherits its parent's vocabulary through its
// sound shifts, with the odd word replaced, so related peoples name things alike.
//
// Pure in (world, settlement table): depends on ids, cells, parents, founding
// years and names only, and on nothing founded after the namer (prefix-stable:
// a longer history names its features alike). Each feature draws from its own stream
// ('names-feature-<key>'), each vocabulary from 'names-geo-<tribe>-<level>',
// so a feature's name does not depend on how many other features exist, except
// where it would collide with an earlier name and is drawn again.

import { FeatureKind } from '../../contract.ts'
import type { GeoFeature, World } from '../../contract.ts'
import { createRng } from '../rng.ts'
import type { Rng } from '../rng.ts'
import { detectFeatures, featuresAt } from './features.ts'
import type { FeatureMap } from './features.ts'
import type { SettlementLike, SettlementNaming } from './index.ts'
import { nameSettlementsDetailed } from './index.ts'
import type { Language } from './phonology.ts'
import { buildMorph, buildRoot, capitalizeName, fluentName, fuseWords, isEuphonic, letterCount, shiftWord } from './words.ts'

type GeoClass = 'ocean' | 'sea' | 'lake' | 'river' | 'mount' | 'land' | 'island' | 'desert' | 'forest' | 'great'
const GEO_CLASSES: readonly GeoClass[] = ['ocean', 'sea', 'lake', 'river', 'mount', 'land', 'island', 'desert', 'forest', 'great']

/** A language's geographic vocabulary and naming habits. */
interface Lexicon {
  words: Record<GeoClass, string>
  /** Generic word before the name ("Tal Oru") rather than after ("Oru Tal"). */
  headFirst: boolean
  /** Chance a generic word fuses onto the name as a suffix ("Orutal"). */
  fuse: number
  /** Derivational ending for names made from a settlement's root ("Kepi" -> "Kepian"). */
  derive: string
  /** Consonant softenings used in derived names ("Kepia" -> "Kephia"). */
  lenition: Array<[string, string]>
}

const LENITIONS: Array<[string, string]> = [['p', 'ph'], ['t', 'th'], ['k', 'kh'], ['b', 'v'], ['d', 'dh'], ['g', 'gh'], ['s', 'sh'], ['m', 'v'], ['r', 'l']]

function buildLexicon(lang: Language, rng: Rng): Lexicon {
  const words = {} as Record<GeoClass, string>
  for (const cls of GEO_CLASSES) {
    for (let attempt = 0; ; attempt++) {
      // "-land" is a suffix and may be short; the others stand as words of 3-4 letters
      const w = buildMorph(lang, rng, cls === 'land' ? 2 : 3, true)
      let clash = false
      for (const other of GEO_CLASSES) if (words[other] === w) clash = true
      if (!clash || attempt > 20) { words[cls] = w; break }
    }
  }
  const lenition: Array<[string, string]> = []
  for (const l of LENITIONS) if (lang.consonants.indexOf(l[0]) >= 0 && rng.next() < 0.5) lenition.push(l)
  return {
    words,
    headFirst: rng.next() < 0.45,
    fuse: rng.next() < 0.35 ? 0.5 + rng.next() * 0.4 : rng.next() * 0.25,
    derive: buildMorph(lang, rng, 2, true),
    lenition,
  }
}

/** A daughter's vocabulary: the parent's words through the daughter's sound shifts, the odd one replaced. */
function shiftLexicon(parent: Lexicon, from: Language, to: Language, rng: Rng): Lexicon {
  const words = {} as Record<GeoClass, string>
  for (const cls of GEO_CLASSES) {
    const shifted = shiftWord(parent.words[cls], from, to)
    words[cls] = shifted !== null && rng.next() >= 0.15 ? shifted : buildMorph(to, rng, cls === 'land' ? 2 : 3, true)
  }
  const derive = shiftWord(parent.derive, from, to) ?? parent.derive
  return { words, headFirst: parent.headFirst, fuse: parent.fuse, derive, lenition: parent.lenition.filter((l) => to.consonants.indexOf(l[0]) >= 0) }
}

/** Generic word class for a feature kind. */
const KIND_WORD: Record<FeatureKind, GeoClass> = {
  [FeatureKind.Continent]: 'land',
  [FeatureKind.Island]: 'island',
  [FeatureKind.Ocean]: 'ocean',
  [FeatureKind.Sea]: 'sea',
  [FeatureKind.Lake]: 'lake',
  [FeatureKind.River]: 'river',
  [FeatureKind.MountainRange]: 'mount',
  [FeatureKind.Desert]: 'desert',
  [FeatureKind.Forest]: 'forest',
}

/** Longest single word and longest whole name, in letters. */
const MAX_WORD = 9
const MAX_NAME = 14

/** Variants of a settlement's root: softened ("Kepia" -> "Kephia") or with the derivational ending. */
function deriveRoot(lang: Language, lex: Lexicon, root: string, rng: Rng): string | null {
  const opts: string[] = []
  for (const [from, to] of lex.lenition) {
    // soften the first occurrence that is followed by a vowel
    for (let i = 0; i < root.length; i++) {
      if (root.slice(i, i + from.length) !== from || i + from.length >= root.length) continue
      if ('aeiou'.indexOf(root[i + from.length]) < 0 || (i > 0 && 'aeiou'.indexOf(root[i - 1]) < 0)) continue
      const v = root.slice(0, i) + to + root.slice(i + from.length)
      if (isEuphonic(v)) opts.push(v)
      break
    }
  }
  const d = fuseWords(lang, root, lex.derive)
  if (d !== null && letterCount(d) <= MAX_WORD) opts.push(d)
  return opts.length ? opts[rng.int(0, opts.length - 1)] : null
}

/** Joins a name root and a generic word in the language's habit (two words, or fused). */
function withGeneric(lang: Language, lex: Lexicon, root: string, word: string, rng: Rng, fuseBias = 0): string | null {
  // no echoes like "Hos Hosor" or "Zubon Bon"
  if (root.slice(0, 2) === word.slice(0, 2) || root.slice(-3) === word.slice(-3)) return null
  if (rng.next() < lex.fuse + fuseBias) {
    const f = fuseWords(lang, root, word)
    if (f !== null && letterCount(f) <= MAX_WORD) return capitalizeName(f)
  }
  if (letterCount(root) > MAX_WORD - 1) return null
  return lex.headFirst ? capitalizeName(word) + ' ' + capitalizeName(root) : capitalizeName(root) + ' ' + capitalizeName(word)
}

interface NameContext {
  lang: Language
  lex: Lexicon
  /** Root of the naming settlement's name. */
  settlementRoot: string
  /** The feature is among the largest of its kind. */
  major: boolean
}

/** One candidate name for a feature, or null when the draw does not combine well. */
function featureName(kind: FeatureKind, ctx: NameContext, rng: Rng): string | null {
  const { lang, lex } = ctx
  const w = lex.words
  // a root: sometimes the naming settlement's own, softened or derived, else a fresh one
  let root: string
  let derived = false
  if (ctx.settlementRoot && rng.next() < 0.32) {
    const d = deriveRoot(lang, lex, ctx.settlementRoot, rng)
    if (d === null) return null
    root = d
    derived = true
  } else root = buildRoot(lang, rng)
  if (letterCount(root) > MAX_WORD) return null
  const x = rng.next()
  switch (kind) {
    case FeatureKind.Continent:
      if (x < 0.6) {
        const f = fuseWords(lang, root, w.land)
        return f !== null && letterCount(f) <= MAX_WORD ? capitalizeName(f) : null
      }
      return capitalizeName(root)
    case FeatureKind.Island:
      return x < 0.55 ? capitalizeName(root) : withGeneric(lang, lex, root, w.island, rng)
    case FeatureKind.Ocean:
      if (x < 0.3 && ctx.major && !derived) return lex.headFirst ? capitalizeName(w.great) + ' ' + capitalizeName(w.ocean) : capitalizeName(w.ocean) + ' ' + capitalizeName(w.great)
      return withGeneric(lang, lex, root, w.ocean, rng)
    case FeatureKind.Sea:
      if (x < 0.15 && ctx.major && !derived) return withGeneric(lang, lex, w.great, w.sea, rng)
      return withGeneric(lang, lex, root, w.sea, rng)
    case FeatureKind.Lake:
      return withGeneric(lang, lex, root, w.lake, rng)
    case FeatureKind.River:
      return x < 0.6 ? capitalizeName(root) : withGeneric(lang, lex, root, w.river, rng)
    case FeatureKind.MountainRange:
      return withGeneric(lang, lex, root, w.mount, rng, 0.1)
    case FeatureKind.Desert:
      if (x < 0.25 && ctx.major && !derived) return withGeneric(lang, lex, w.great, w.desert, rng)
      return withGeneric(lang, lex, root, w.desert, rng)
    default:
      if (x < 0.2 && ctx.major && !derived) return withGeneric(lang, lex, w.great, w.forest, rng)
      return withGeneric(lang, lex, root, w.forest, rng)
  }
}

/** The fields `nameFeatures` needs from a settlement. */
export interface NamedSettlementLike extends SettlementLike {
  name: string
}

/**
 * Names the geographic features of a world that its settlements reach: each
 * feature is named when the first settlement is founded on or beside it (ties:
 * lower id), in that settlement's language. Features never reached are left out.
 * Names are unique across settlements and features. Returned in order of naming
 * (namedYear, then namer, then detection order), ids matching positions.
 * `map` may be passed when the caller already detected the features.
 *
 * Settlements and features are taken in the order they appear (a settlement when
 * it is founded, a feature right after its namer), and a feature's name avoids only
 * the names that exist by then, so nothing named by year Y depends on what comes
 * after Y. The settlement names are the table's; `nameWorld` also settles the rare
 * settlement whose own name a feature took first.
 */
export function nameFeatures(world: World, settlements: readonly NamedSettlementLike[], map: FeatureMap = detectFeatures(world)): GeoFeature[] {
  return nameAll(world, settlements, map, settlements.map((s) => s.name)).features
}

/**
 * Names every settlement and every reached feature together (see nameFeatures): a settlement keeps
 * its own name (nameSettlements) unless an earlier feature or renamed settlement already has it, and
 * then gets a fresh one in its language (stream 'names-rename-<id>'). Pure in (world, settlement table),
 * and names given by year Y never depend on what comes after Y. nameFeatures on the returned names
 * gives the same features.
 */
export function nameWorld(world: World, settlements: readonly SettlementLike[], map: FeatureMap = detectFeatures(world)): { names: string[]; features: GeoFeature[]; naming: SettlementNaming } {
  return nameAll(world, settlements, map, null)
}

function nameAll(world: World, settlements: readonly SettlementLike[], map: FeatureMap, given: readonly string[] | null): { names: string[]; features: GeoFeature[]; naming: SettlementNaming } {
  const F = map.features.length
  const S = settlements.length
  const naming = nameSettlementsDetailed(world, settlements)
  const names = given ? given.slice() : naming.names.slice()
  if (S === 0) return { names, features: [], naming }

  // who reaches each feature first
  const order = settlements.map((_, i) => i)
  order.sort((a, b) => settlements[a].foundedYear - settlements[b].foundedYear || a - b)
  const namer = new Int32Array(F).fill(-1)
  const touched: number[] = []
  let left = F
  for (let t = 0; t < S && left > 0; t++) {
    const id = order[t]
    touched.length = 0
    featuresAt(map, world, settlements[id].cell, touched)
    for (const f of touched) if (namer[f] < 0) { namer[f] = id; left-- }
  }

  // which features are the largest few of their kind (for "Great ..." names)
  const major = new Uint8Array(F)
  for (let kind = 0; kind <= FeatureKind.Forest; kind++) {
    const ids: number[] = []
    for (let f = 0; f < F; f++) if (map.features[f].kind === kind) ids.push(f)
    ids.sort((a, b) => map.features[b].size - map.features[a].size || a - b)
    for (let i = 0; i < ids.length && i < 2; i++) major[ids[i]] = 1
  }

  const reached: number[] = []
  for (let f = 0; f < F; f++) if (namer[f] >= 0) reached.push(f)
  reached.sort((a, b) => settlements[namer[a]].foundedYear - settlements[namer[b]].foundedYear || namer[a] - namer[b] || a - b)

  const used = new Set<string>()
  // Settlements enter in founding order (ids ascend with founding years); one whose name is taken is renamed (nameWorld only).
  let admitted = 0
  const admit = (upTo: number): void => {
    for (; admitted <= upTo && admitted < S; admitted++) {
      const id = admitted
      if (!given && used.has(names[id].toLowerCase())) names[id] = rename(world, naming, id, used)
      used.add(names[id].toLowerCase())
    }
  }
  const lexCache = new Map<string, Lexicon>()
  const lexicon = (tribe: number, level: number): Lexicon => {
    const key = tribe + ':' + level
    const hit = lexCache.get(key)
    if (hit) return hit
    const rng = createRng(world.seed, `names-geo-${tribe}-${level}`)
    const lex = level <= 0
      ? buildLexicon(naming.language(tribe, 0), rng)
      : shiftLexicon(lexicon(tribe, level - 1), naming.language(tribe, level - 1), naming.language(tribe, level), rng)
    lexCache.set(key, lex)
    return lex
  }

  const out: GeoFeature[] = []
  for (const f of reached) {
    const det = map.features[f]
    const by = namer[f]
    admit(by)
    const tribe = naming.tribe[by], level = naming.level[by]
    // the root of the namer's name; recomputed names match the table unless the settlement was renamed
    const own = names[by]
    const root = naming.names[by] === own ? naming.roots[by] : own.toLowerCase().split(/[ '-]/)[0]
    const ctx: NameContext = { lang: naming.language(tribe, level), lex: lexicon(tribe, level), settlementRoot: root, major: major[f] === 1 }
    const rng = createRng(world.seed, `names-feature-${det.key}`)
    let name = ''
    for (let attempt = 0; attempt < 400; attempt++) {
      const cand = featureName(det.kind, ctx, rng)
      if (cand === null || letterCount(cand) > MAX_NAME || letterCount(cand) < 3 || used.has(cand.toLowerCase()) || (attempt < 300 && !fluentName(cand))) continue
      name = cand
      break
    }
    if (!name) {
      // practically unreachable: a fresh root with the kind word, then numbered roots of fresh draws
      for (let attempt = 0; !name; attempt++) {
        const cand = capitalizeName(buildRoot(ctx.lang, rng)) + ' ' + capitalizeName(ctx.lex.words[KIND_WORD[det.kind]])
        if (!used.has(cand.toLowerCase()) || attempt > 1000) name = cand
      }
    }
    used.add(name.toLowerCase())
    out.push({
      id: out.length,
      kind: det.kind,
      name,
      namedYear: settlements[by].foundedYear,
      namedBy: by,
      anchorCell: det.anchorCell,
      size: det.size,
      spine: det.spine.slice(),
    })
  }
  admit(S - 1)
  return { names, features: out, naming }
}

/** A fresh name for settlement `id` in its language, not in `used` (its own was taken by an earlier name). */
function rename(world: World, naming: SettlementNaming, id: number, used: Set<string>): string {
  const lang = naming.language(naming.tribe[id], naming.level[id])
  const rng = createRng(world.seed, `names-rename-${id}`)
  let name = ''
  for (let attempt = 0; attempt < 300 && !name; attempt++) {
    const cand = capitalizeName(buildRoot(lang, rng))
    const lc = letterCount(cand)
    if (lc >= 3 && lc <= 12 && !used.has(cand.toLowerCase()) && (attempt >= 200 || fluentName(cand))) name = cand
  }
  for (let attempt = 0; !name; attempt++) { // practically unreachable
    const cand = capitalizeName(buildRoot(lang, rng) + buildRoot(lang, rng))
    if (!used.has(cand.toLowerCase()) || attempt > 1000) name = cand
  }
  return name
}
