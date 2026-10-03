// Peoples and their cradles.
//
// The founding tribes do not all start on one landmass: they live in a few
// separate cradles spread over the world's habitable continents, typically two
// to four (one per continent with enough habitable land, two on a big one,
// at least two even on a world with a single continent, where they sit far
// apart), each the home of two to four tribes close enough to meet within a
// few centuries. Cradle centres are drawn among the best regions (summed
// potential of the habitable cells around them), mutually far apart and
// preferring landmasses without a cradle yet; tribes sit on the better sites
// of their cradle's region. Each tribe founds a people (state.found); every
// settlement belongs to its founder's people.
//
// Draws come from the 'history-cradles' stream only. People names are drawn
// afterwards from the founder's language ('names-people-<founder>' streams,
// so settlement and feature names are unchanged).

import type { People, World } from '../../contract.ts'
import type { Rng } from '../rng.ts'
import { createRng } from '../rng.ts'
import type { SettlementNaming } from '../names/index.ts'
import { buildMorph, buildRoot, capitalizeName, fuseWords, letterCount } from '../names/words.ts'
import { CRADLE, POPULATION } from './params.ts'
import type { HistoryState } from './state.ts'
import { found, setPeoples } from './state.ts'

/** The founding plan: tribe cells and sizes, and the cradle (index into centres) of each tribe. */
export interface CradlePlan {
  cells: number[]
  pops: number[]
  cradle: number[]
  /** Centre cell of each cradle. */
  centres: number[]
}

function chord2(P: Float32Array, a: number, b: number): number {
  const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]
  return dx * dx + dy * dy + dz * dz
}

let regionQueue = new Int32Array(0)

/** Habitable cells within `hops` plain hops over land of `c` (BFS order, c first). */
function region(s: HistoryState, c: number, hops: number, stamp: Int32Array, depth: Int32Array, run: number, out: number[]): void {
  const T = s.terrain
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  out.length = 0
  const queue = regionQueue.length >= T.cellCount ? regionQueue : (regionQueue = new Int32Array(T.cellCount))
  let tail = 0
  queue[tail++] = c
  stamp[c] = run
  depth[c] = 0
  for (let head = 0; head < tail; head++) {
    const q = queue[head]
    if (T.habitable[q]) out.push(q)
    if (depth[q] >= hops) continue
    for (let e = off[q]; e < off[q + 1]; e++) {
      const j = nb[e]
      if (stamp[j] === run || T.sea[j]) continue
      stamp[j] = run
      depth[j] = depth[q] + 1
      queue[tail++] = j
    }
  }
}

/** Plans the cradles and the tribes in them (does not found anything). */
export function planCradles(s: HistoryState, rng: Rng): CradlePlan {
  const C = CRADLE
  const T = s.terrain
  const N = T.cellCount
  const P = s.world.grid.positions
  const M = T.landmassSize.length
  const plan: CradlePlan = { cells: [], pops: [], cradle: [], centres: [] }
  const lmHab = new Int32Array(M)
  for (let i = 0; i < N; i++) if (T.habitable[i]) lmHab[T.landmass[i]]++
  const scale = N / 23042
  // Eligible landmasses (or, failing any, the one with the most habitable land).
  const eligible = new Uint8Array(M)
  let slots = 0, best = -1
  for (let m = 0; m < M; m++) {
    if (lmHab[m] > 0 && (best < 0 || lmHab[m] > lmHab[best])) best = m
    if (lmHab[m] < C.minHab * scale) continue
    eligible[m] = 1
    slots += lmHab[m] >= C.bigHab * scale ? 2 : 1
  }
  if (best < 0) return plan // no habitable land at all
  if (slots === 0) { eligible[best] = 1; slots = 1 }
  let K = slots < C.minCount ? C.minCount : slots > C.maxCount ? C.maxCount : slots
  if (K > C.minCount && rng.next() < C.dropChance) K--

  // Candidate centres: the better half (by potential) of each eligible landmass's habitable cells, valued by their region.
  const hops = Math.max(1, Math.round((C.regionHops * T.n) / 48))
  const stamp = new Int32Array(N).fill(-1)
  const depth = new Int32Array(N)
  let run = 0
  const reg: number[] = []
  const cand: number[] = []
  const value: number[] = []
  for (let m = 0; m < M; m++) {
    if (!eligible[m]) continue
    const cells: number[] = []
    for (let i = 0; i < N; i++) if (T.habitable[i] && T.landmass[i] === m) cells.push(i)
    cells.sort((a, b) => T.potential[b] - T.potential[a] || a - b)
    cells.length = Math.max(1, Math.ceil(cells.length / 2))
    for (const c of cells) {
      region(s, c, hops, stamp, depth, run++, reg)
      let v = 0
      for (const q of reg) v += T.potential[q]
      cand.push(c)
      value.push(v)
    }
  }
  // Greedy: each new centre among the best few by value * spacing, far from the others.
  const hasCradle = new Uint8Array(M)
  let minChord2 = C.minChord * C.minChord
  const floor2 = C.floorChord * C.floorChord
  const spread2 = C.spreadChord * C.spreadChord
  const topI: number[] = [], topS: number[] = []
  while (plan.centres.length < K) {
    topI.length = 0; topS.length = 0
    for (let i = 0; i < cand.length; i++) {
      const c = cand[i]
      let dmin2 = 1e9
      for (const q of plan.centres) { const d = chord2(P, c, q); if (d < dmin2) dmin2 = d }
      if (dmin2 < minChord2) continue
      let score = value[i]
      if (plan.centres.length > 0) {
        // min(1, d / spreadChord).
        score *=dmin2 >= spread2 ? 1 : Math.sqrt(dmin2 / spread2)
        if (!hasCradle[T.landmass[c]]) score *= C.otherLand
      }
      // Keep the best `pool` (insertion into a small sorted list; ties on the lower index).
      let at = topS.length
      while (at > 0 && topS[at - 1] < score) at--
      if (at >= C.pool) continue
      topI.splice(at, 0, i)
      topS.splice(at, 0, score)
      if (topI.length > C.pool) { topI.length = C.pool; topS.length = C.pool }
    }
    if (topI.length === 0) {
      if (minChord2 <= floor2) break
      minChord2 *= C.relax * C.relax
      if (minChord2 < floor2) minChord2 = floor2
      continue
    }
    let total = 0
    for (const x of topS) total += x
    let x = rng.next() * total
    let pick = topI[topI.length - 1]
    for (let k = 0; k < topI.length; k++) { x -= topS[k]; if (x < 0) { pick = topI[k]; break } }
    plan.centres.push(cand[pick])
    hasCradle[T.landmass[cand[pick]]] = 1
  }

  // Tribes: several per cradle, on the better half of its region, mutually apart.
  const K2 = plan.centres.length
  const low = K2 <= 2 ? C.tribesLow2 : C.tribesLow
  const tribeChord2 = C.tribeChord * C.tribeChord
  const minTribe2 = C.tribeFloor * C.tribeFloor
  const tribeHops = Math.max(1, Math.round((C.tribeHops * T.n) / 48))
  for (let k = 0; k < K2; k++) {
    let count = rng.int(low, C.tribesHigh)
    if (plan.cells.length + count > C.maxTribes) count = C.maxTribes - plan.cells.length
    region(s, plan.centres[k], tribeHops, stamp, depth, run++, reg)
    const sites = reg.slice().sort((a, b) => T.potential[b] - T.potential[a] || a - b)
    sites.length = Math.max(1, Math.ceil(sites.length / 2))
    let total = 0
    for (const c of sites) total += T.potential[c]
    let min2 = tribeChord2
    let fails = 0, placed = 0
    while (placed < count && min2 >= minTribe2) {
      let x = rng.next() * total
      let c = sites[sites.length - 1]
      for (let i = 0; i < sites.length; i++) { x -= T.potential[sites[i]]; if (x < 0) { c = sites[i]; break } }
      let ok = true
      for (let i = 0; ok && i < plan.cells.length; i++) if (chord2(P, c, plan.cells[i]) < min2) ok = false
      if (ok) {
        plan.cells.push(c)
        plan.pops.push(Math.round(rng.range(POPULATION.tribePopMin, POPULATION.tribePopMax)))
        plan.cradle.push(k)
        placed++
        fails = 0
      } else if (++fails >= 60) {
        min2 *= 0.8
        fails = 0
      }
    }
  }
  return plan
}

/** Places the founding tribes ('history-cradles' stream); returns the plan. */
export function seedPeoples(s: HistoryState, rng: Rng): CradlePlan {
  const plan = planCradles(s, rng)
  setPeoples(s, plan.cells.length)
  for (let t = 0; t < plan.cells.length; t++) found(s, plan.cells[t], plan.pops[t], -1)
  return plan
}

/**
 * Names each people in its founder's language: a fresh root, now and then with an ending of the
 * language, unique among peoples and different from the original tribes' settlement names. Draws only
 * from 'names-people-<founder>', and depends only on the tribes, so a longer run names its peoples
 * alike. (It may coincide with a later settlement's or feature's name: those are drawn independently.)
 */
export function namePeoples(world: World, founders: readonly number[], naming: SettlementNaming): People[] {
  const used = new Set<string>()
  for (const f of founders) used.add(naming.names[f].toLowerCase())
  const out: People[] = []
  for (let p = 0; p < founders.length; p++) {
    const founder = founders[p]
    const lang = naming.language(founder, 0)
    const rng = createRng(world.seed, `names-people-${founder}`)
    let name = ''
    for (let attempt = 0; attempt < 400 && !name; attempt++) {
      let w = buildRoot(lang, rng)
      if (rng.next() < 0.4) {
        const f = fuseWords(lang, w, buildMorph(lang, rng, 2, true))
        if (f !== null && letterCount(f) <= 9) w = f
      }
      const cand = capitalizeName(w)
      if (letterCount(cand) >= 3 && !used.has(cand.toLowerCase())) name = cand
    }
    if (!name) name = capitalizeName(naming.roots[founder] ?? 'ana') + 'i' + p // practically unreachable
    used.add(name.toLowerCase())
    out.push({ id: p, founder, name })
  }
  return out
}
