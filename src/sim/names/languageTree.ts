// language: the language tree, what each settlement speaks, and each language's dated sound changes (language-drift.md §4.2,
// §4.3). The tree is pure in (world, settlement table): no Rng. Each people has one proto-language (founded with its first
// town); a daughter parts when its speakers separate:
//   - overseas: the LANG.overseasK-th town of a language on a landmass other than its seat's makes the towns there a daughter;
//   - distance: the LANG.regionK-th town in another world region of the seat's landmass, LANG.regionAge years or more after the
//     language's own start, makes that region's towns a daughter.
// Settlements are taken in id order (founding order); a town begins in its parent's language as it stands at the founding (or
// in the daughter already formed for its landmass or region). A split adds rows only from its year on, so the tree of a prefix
// of the table is the prefix of the tree.
//
// Rates and rules are drawn per language from its own streams ('lang-rate-<n>', 'lang-rules-<n>'), languages in id order: each
// language's sound changes form a renewal process at LANG.mu x rate per millennium from its start, drawn only up to the
// assembled year (each draw depends only on earlier draws: prefix-stable). The kind of each change is drawn, and when no
// variant of it would change a word of the language's sample vocabulary as it stands then, the next kind (cyclically) that
// would; the variant likewise.

import { LanguageSplitCause } from '../../contract.ts'
import type { World } from '../../contract.ts'
import { createRng } from '../rng.ts'
import type { Rng } from '../rng.ts'
import { LANG } from './languageParams.ts'
import { SOUND_CHANGES, applyUnits } from './soundChange.ts'
import { toUnits } from './words.ts'

/** The fields the tree needs of a settlement. */
export interface TreeSettlement {
  cell: number
  parent: number
  foundedYear: number
  abandonedYear: number
  people: number
}

/** The tree, being built (plain arrays; the assembly packs them into History.languages and History.speech). */
export interface LanguageTree {
  count: number
  parent: number[]
  people: number[]
  splitYear: number[]
  cause: number[]
  seat: number[]
  /** Language each settlement spoke at its founding. */
  foundNode: Int32Array
  /** Speech rows per settlement, years ascending (the founding row first). */
  rowYear: number[][]
  rowNode: number[][]
  /** 1 for a row that is a language shift (contact.ts), else 0. */
  rowShift: number[][]
}

const landmassCache = new WeakMap<World, Int32Array>()
const regionCache = new WeakMap<World, Int32Array>()

/** Landmass id of each land cell (-1 at sea): connected land, as the terrain finds it. Cached per world. */
export function landmassOf(world: World): Int32Array {
  const hit = landmassCache.get(world)
  if (hit) return hit
  const N = world.grid.cellCount
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const elev = world.elevation
  const lm = new Int32Array(N).fill(-1)
  const queue = new Int32Array(N)
  let id = 0
  for (let s = 0; s < N; s++) {
    if (elev[s] < 0 || lm[s] >= 0) continue
    let sp = 0
    queue[sp++] = s
    lm[s] = id
    while (sp > 0) {
      const c = queue[--sp]
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (elev[j] >= 0 && lm[j] < 0) { lm[j] = id; queue[sp++] = j }
      }
    }
    id++
  }
  landmassCache.set(world, lm)
  return lm
}

/**
 * World regions: LANG.regions centres by farthest-point sampling over land cells (the first the lowest-index land cell; ties to
 * the lower index), each land cell in the region of its nearest centre (-1 at sea). Pure in the world; cached.
 */
export function regionsOf(world: World): Int32Array {
  const hit = regionCache.get(world)
  if (hit) return hit
  const N = world.grid.cellCount
  const P = world.grid.positions
  const land: number[] = []
  for (let c = 0; c < N; c++) if (world.elevation[c] >= 0) land.push(c)
  const region = new Int32Array(N).fill(-1)
  if (land.length) {
    const L = land.length
    const best = new Float64Array(L).fill(-Infinity) // highest dot product with any centre (nearest)
    const centres: number[] = []
    let next = 0
    for (let r = 0; r < LANG.regions && r < L; r++) {
      const c = land[next]
      centres.push(c)
      const cx = P[3 * c], cy = P[3 * c + 1], cz = P[3 * c + 2]
      let far = -1, farDot = Infinity
      for (let i = 0; i < L; i++) {
        const q = land[i]
        const d = P[3 * q] * cx + P[3 * q + 1] * cy + P[3 * q + 2] * cz
        if (d > best[i]) { best[i] = d; region[q] = r }
        if (best[i] < farDot) { farDot = best[i]; far = i }
      }
      next = far
    }
  }
  regionCache.set(world, region)
  return region
}

/** The language settlement `id` speaks at `year` (its last row with year <= year; its founding language before its founding). */
export function nodeAt(tree: Pick<LanguageTree, 'rowYear' | 'rowNode'>, id: number, year: number): number {
  const ys = tree.rowYear[id], ns = tree.rowNode[id]
  let k = 0
  for (let i = 1; i < ys.length; i++) if (ys[i] <= year) k = i
  return ns[k]
}

/** Builds the tree over the whole settlement table (see the file comment). */
export function buildTree(world: World, settlements: readonly TreeSettlement[]): LanguageTree {
  const S = settlements.length
  const lm = landmassOf(world)
  const region = regionsOf(world)
  const tree: LanguageTree = {
    count: 0, parent: [], people: [], splitYear: [], cause: [], seat: [], foundNode: new Int32Array(S),
    rowYear: new Array<number[]>(S), rowNode: new Array<number[]>(S), rowShift: new Array<number[]>(S),
  }
  const add = (parent: number, people: number, year: number, cause: number, seat: number): number => {
    tree.parent.push(parent); tree.people.push(people); tree.splitYear.push(year); tree.cause.push(cause); tree.seat.push(seat)
    return tree.count++
  }
  /** Daughters formed, and towns waiting to form one, by key ("o<node>:<landmass>" or "r<node>:<region>"). */
  const daughter = new Map<string, number>()
  const pending = new Map<string, number[]>()
  const alive = (id: number, year: number): boolean => settlements[id].abandonedYear < 0 || settlements[id].abandonedYear > year
  for (let id = 0; id < S; id++) {
    const st = settlements[id]
    let node: number
    if (st.parent < 0 || st.parent >= id) node = add(-1, st.people, st.foundedYear, LanguageSplitCause.Proto, id)
    else {
      node = nodeAt(tree, st.parent, st.foundedYear)
      const seatCell = settlements[tree.seat[node]].cell
      let key = ''
      let cause: number = LanguageSplitCause.Overseas
      if (lm[st.cell] !== lm[seatCell]) key = `o${node}:${lm[st.cell]}`
      else if (region[st.cell] !== region[seatCell] && region[st.cell] >= 0) { key = `r${node}:${region[st.cell]}`; cause = LanguageSplitCause.Distance }
      if (key) {
        const d = daughter.get(key)
        if (d !== undefined) node = d
        else {
          let list = pending.get(key)
          if (!list) pending.set(key, (list = []))
          list.push(id)
          const k = cause === LanguageSplitCause.Overseas ? LANG.overseasK : LANG.regionK
          const oldEnough = cause === LanguageSplitCause.Overseas || st.foundedYear - tree.splitYear[node] >= LANG.regionAge
          if (list.length >= k && oldEnough && tree.count < LANG.maxNodes) {
            const year = st.foundedYear
            const dn = add(node, tree.people[node], year, cause, list[0])
            daughter.set(key, dn)
            pending.delete(key)
            for (const m of list) {
              if (m === id || !alive(m, year)) continue
              tree.rowYear[m].push(year)
              tree.rowNode[m].push(dn)
              tree.rowShift[m].push(0)
            }
            node = dn
          }
        }
      }
    }
    tree.foundNode[id] = node
    tree.rowYear[id] = [st.foundedYear]
    tree.rowNode[id] = [node]
    tree.rowShift[id] = [0]
  }
  return tree
}

/** A draw from N(0, 1) (Box-Muller, two uniforms). */
function normal(rng: Rng): number {
  const u = 1 - rng.next(), v = rng.next()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Each language's pace (exp(N(0, LANG.rateSpread)), from 'lang-rate-<n>'). */
export function drawRates(seed: number, count: number): number[] {
  const out: number[] = []
  for (let n = 0; n < count; n++) out.push(Math.exp(LANG.rateSpread * normal(createRng(seed, `lang-rate-${n}`))))
  return out
}

/** Drawn sound changes, per language, in date order. */
export interface DrawnRules {
  year: number[][]
  kind: number[][]
  variant: number[][]
}

/**
 * Each language's sound changes up to `years` (see the file comment). `sample(n)` is the sample vocabulary of language n's
 * people (underlying forms; the proto-language's words), worn along the lineage to each language's start.
 */
export function drawRules(seed: number, tree: Pick<LanguageTree, 'count' | 'parent' | 'splitYear'>, rates: readonly number[], sample: (n: number) => readonly string[], years: number): DrawnRules {
  const out: DrawnRules = { year: [], kind: [], variant: [] }
  /** The sample vocabulary of each language as it stood after each of its rules: corpusAt[n][r] after rule r - 1 (r = 0: at its start). */
  const corpusAt: string[][][][] = []
  for (let n = 0; n < tree.count; n++) {
    let corpus: string[][]
    const p = tree.parent[n]
    if (p < 0) corpus = sample(n).map((w) => toUnits(w).map((u) => u.s))
    else {
      // the parent's words as they stood at the split (its rules before the split year)
      let r = 0
      while (r < out.year[p].length && out.year[p][r] < tree.splitYear[n]) r++
      corpus = corpusAt[p][r].slice()
    }
    const ys: number[] = [], ks: number[] = [], vs: number[] = []
    const snaps: string[][][] = [corpus.slice()]
    const rng = createRng(seed, `lang-rules-${n}`)
    const mean = 1000 / (LANG.mu * rates[n])
    let t = tree.splitYear[n]
    for (;;) {
      t += -Math.log(1 - rng.next()) * mean
      const uKind = rng.next(), uVar = rng.next()
      const year = Math.max(tree.splitYear[n], Math.floor(t))
      if (year > years || year > 32767) break
      // the drawn kind, else the next kind (cyclically) with a variant that changes some word of the sample; the variant likewise
      let kind = -1, variant = -1
      const K = SOUND_CHANGES.length
      const k0 = Math.min(K - 1, Math.floor(uKind * K))
      for (let j = 0; j < K && kind < 0; j++) {
        const k = (k0 + j) % K
        const nv = SOUND_CHANGES[k].length
        const v0 = Math.min(nv - 1, Math.floor(uVar * nv))
        for (let i = 0; i < nv && kind < 0; i++) {
          const v = (v0 + i) % nv
          for (const w of corpus) if (applyUnits(w, k, v) !== null) { kind = k; variant = v; break }
        }
      }
      if (kind < 0) continue
      ys.push(year); ks.push(kind); vs.push(variant)
      for (let i = 0; i < corpus.length; i++) corpus[i] = applyUnits(corpus[i], kind, variant) ?? corpus[i]
      snaps.push(corpus.slice())
    }
    out.year.push(ys); out.kind.push(ks); out.variant.push(vs)
    corpusAt.push(snaps)
  }
  return out
}
