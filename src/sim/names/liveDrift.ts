// barriers (barriers-coldwar.md §1 B-R1, §2.1): language drift advanced inside the year loop, so the simulation can read who
// understands whom. The tree is extended incrementally over newly founded ids (languageTree.ts extendTree: the tree of a prefix
// of the table is the prefix of the tree) and the native lexicon is drawn lazily per (language, meaning), each list keeping its
// own stream 'lang-lex-<n>-<m>' and time, exactly as drawLexicon draws it (the coined forms are drawn too, so the stream stays
// aligned; only the rows' identity is read). Loans and shifts stay assembly-only (contact.ts): in-loop intelligibility uses
// native cognates only.
//
//   c_ab(Y) = the share of the LANG.core meanings whose word in force in a and b at Y is the same native row
//   I(a, b) = smoothstep(IB.cLo 0.60, IB.cHi 0.95, c_ab)         (a == b: 1; unrelated: 0)
//
// The direction (less shared vocabulary, less understanding) follows Gooskens et al. (2009); the band ends are design
// defaults checked against the language-drift probe (c 0.91 at ~300 y -> I 0.97; c 0.77-0.80 at 0.5-1 ky -> 0.48-0.65).
// Assembly still calls buildDrift (deviation from B-R1's "assembly reuses this state": the language lane owns assembly; the
// guard test checks the live rows equal buildDrift's for a prefix year). Typology worlds are not supported here (their
// coining language comes from the world-wide profile draw): barriers falls back to the people proxy there.

import type { World } from '../../contract.ts'
import { createRng } from '../rng.ts'
import type { Rng } from '../rng.ts'
import { smoothstep } from '../util.ts'
import { LANG } from './languageParams.ts'
import { createTreeBuilder, drawRates, extendTree, nodeAt, type TreeBuilder, type TreeSettlement } from './languageTree.ts'
import { coinWord, meaningRates } from './lexicon.ts'
import type { Language } from './phonology.ts'
import { buildLanguage } from './phonology.ts'
import { logD } from '../detMath.ts'

export const IB_C = { cLo: 0.6, cHi: 0.95 }

interface LexList {
  /** Row years (native rows only; index 0 the inherited word for a proto-language). */
  years: number[]
  rng: Rng | null
  t: number
  /** The next replacement drawn but not yet in force (its year), or Infinity when the stream is done. */
  next: number
}

export interface LiveDrift {
  world: World
  b: TreeBuilder
  rates: number[]
  g: number[]
  tribe: number[]
  base: Map<number, Language>
  lists: Map<number, LexList>
  /** Pair cache of I per decade: key a * 4096 + b (a < b). */
  cache: Map<number, number>
  cacheDecade: number
}

export function createLiveDrift(world: World): LiveDrift {
  return { world, b: createTreeBuilder(), rates: [], g: meaningRates(world.seed), tribe: [], base: new Map(), lists: new Map(), cache: new Map(), cacheDecade: -1 }
}

/** Takes the settlements founded so far into the tree. */
export function advanceLive(ld: LiveDrift, count: number, get: (id: number) => TreeSettlement): void {
  extendTree(ld.world, ld.b, count, get)
  const T = ld.b.tree
  for (let n = ld.rates.length; n < T.count; n++) {
    ld.rates.push(drawRates(ld.world.seed, n + 1)[n])
    ld.tribe.push(T.parent[n] < 0 ? T.seat[n] : ld.tribe[T.parent[n]])
  }
}

function baseOf(ld: LiveDrift, n: number): Language {
  const t = ld.tribe[n]
  let l = ld.base.get(t)
  if (!l) ld.base.set(t, (l = buildLanguage(createRng(ld.world.seed, `names-lang-${t}`))))
  return l
}

/** The native rows of meaning m in language n drawn up to year Y (drawLexicon's process, lazily). */
function listOf(ld: LiveDrift, n: number, m: number, Y: number): LexList {
  const key = n * LANG.core + m
  let L = ld.lists.get(key)
  const T = ld.b.tree
  if (!L) {
    const start = T.splitYear[n]
    L = { years: T.parent[n] < 0 ? [start] : [], rng: null, t: start, next: Infinity }
    const rate = LANG.lambda * ld.rates[n] * ld.g[m]
    if (rate > 0) { L.rng = createRng(ld.world.seed, `lang-lex-${n}-${m}`); L.next = -1 }
    ld.lists.set(key, L)
  }
  const rate = LANG.lambda * ld.rates[n] * ld.g[m]
  while (L.rng !== null) {
    if (L.next < 0) {
      L.t += -logD(1 - L.rng.next()) * 1000 / rate
      const year = Math.floor(L.t)
      if (year > 32767) { L.rng = null; L.next = Infinity; break }
      coinWord(baseOf(ld, n), m, L.rng) // (keeps the stream aligned with drawLexicon)
      L.next = year
    }
    if (L.next > Y) break
    L.years.push(L.next)
    L.next = -1
  }
  return L
}

/** The native row in force for meaning m in language n at Y: language k * 65536 + index, or -1. */
function rowAt(ld: LiveDrift, n: number, m: number, Y: number): number {
  const T = ld.b.tree
  let end = Infinity
  for (let k = n; k >= 0; k = T.parent[k]) {
    const ys = listOf(ld, k, m, Y).years
    for (let i = ys.length - 1; i >= 0; i--) if (ys[i] <= Y && ys[i] < end) return k * 65536 + i
    end = T.splitYear[k]
  }
  return -1
}

/** The native years of meaning m of language n up to Y (the guard test compares them with drawLexicon). */
export function liveRows(ld: LiveDrift, n: number, m: number, Y: number): number[] {
  return listOf(ld, n, m, Y).years.filter((y) => y <= Y)
}

/** Native cognate share of languages a and b at Y. */
export function cognateShare(ld: LiveDrift, a: number, b: number, Y: number): number {
  if (a === b) return 1
  const T = ld.b.tree
  let ra = a, rb = b
  while (T.parent[ra] >= 0) ra = T.parent[ra]
  while (T.parent[rb] >= 0) rb = T.parent[rb]
  if (ra !== rb) return 0
  let same = 0
  for (let m = 0; m < LANG.core; m++) if (rowAt(ld, a, m, Y) === rowAt(ld, b, m, Y)) same++
  return same / LANG.core
}

/** Mutual intelligibility of languages a and b at Y (cached per decade). */
export function intelligibility(ld: LiveDrift, a: number, b: number, Y: number): number {
  if (a === b) return 1
  const dec = Math.floor(Y / 10)
  if (dec !== ld.cacheDecade) { ld.cache.clear(); ld.cacheDecade = dec }
  const key = a < b ? a * 4096 + b : b * 4096 + a
  const hit = ld.cache.get(key)
  if (hit !== undefined) return hit
  const I = smoothstep(IB_C.cLo, IB_C.cHi, cognateShare(ld, a, b, Y))
  ld.cache.set(key, I)
  return I
}

/** The language settlement id speaks at Y (in the live tree). */
export function liveNode(ld: LiveDrift, id: number, Y: number): number {
  return id < ld.b.done ? nodeAt(ld.b.tree, id, Y) : -1
}
