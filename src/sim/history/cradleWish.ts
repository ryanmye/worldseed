// cradle wishes: the player plants where civilisations start (HistoryOptions.cradles).
//
// The founding plan is drawn as ever (peoples.ts, 'history-cradles'), so a world has the same number of
// peoples whatever is wished (cradleCount). Then, for each people p with a wish (cradles[p] >= 0), in
// people order:
//   - a wished cell that is baseHabitable land (the land a founding tribe can live on) and free is used
//     as it is (CradleOutcome.Placed);
//   - else the nearest free baseHabitable cell (by chord, ties on the lower id) within CRADLE_WISH.radiusHops
//     hops of it, over land or sea, is used (Moved);
//   - else (or a cell id outside the world) the wish is rejected and the people keeps the simulation's own
//     choice (Rejected).
// Then the peoples the simulation places (no wish, or rejected) that sit within avoidChord of a wished
// people, or on the same cell, are redrawn among their own cradle's sites (the better half, by potential,
// of the habitable cells within tribeHops of its centre, weighted by potential, kept apart from the others
// as the planner keeps tribes apart), from 'history-cradles-wish' only; failing that, the free site farthest
// from the others. Two wished peoples within crowdChord of each other are kept and noted (crowded).
// Last, the cradles: a wished people joins the nearest cradle (one that still holds a people the
// simulation placed, or one begun by an earlier wish) whose centre is on its landmass within joinChord,
// else begins its own (centred on its cell); cradles left without a people are dropped and the rest
// renumbered in order. Everything after follows the rules.

import type { World } from '../../contract.ts'
import { CradleOutcome } from '../../contract.ts'
import type { Rng } from '../rng.ts'
import { createRng } from '../rng.ts'
import { CRADLE, CRADLE_WISH } from './params.ts'
import type { CradlePlan, PlanInput } from './peoples.ts'
import { planCradles } from './peoples.ts'
import { buildTerrain } from './terrain.ts'

/** What became of the wishes, per people (History.cradleWish, cradleCell, cradlePlaced, cradleCrowded). */
export interface CradleWishResult {
  /** The cell wished (as given, when a whole number >= 0), or -1. */
  wish: Int32Array
  /** The start cell used. */
  cell: Int32Array
  /** CradleOutcome. */
  placed: Uint8Array
  /** 1 when another wished people began within crowdChord (in sight at founding). */
  crowded: Uint8Array
}

/** The wish of people p: a whole number >= 0 (possibly outside the world), else -1. */
function wishOf(cradles: readonly number[], p: number): number {
  const c = p < cradles.length ? cradles[p] : -1
  return typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 0x7fffffff ? c : -1
}

/** True when some people of the P has a wish. */
export function hasCradleWish(cradles: readonly number[] | undefined, P: number): boolean {
  if (!cradles) return false
  for (let p = 0; p < P && p < cradles.length; p++) if (wishOf(cradles, p) >= 0) return true
  return false
}

function chord2(P: Float32Array, a: number, b: number): number {
  const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]
  return dx * dx + dy * dy + dz * dz
}

/** Cells within `hops` hops of c (BFS order, c first); over land only when `landOnly`. */
function bfs(s: PlanInput, c: number, hops: number, landOnly: boolean): number[] {
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const sea = s.terrain.sea
  const depth = new Int32Array(s.terrain.cellCount).fill(-1)
  const out = [c]
  depth[c] = 0
  for (let head = 0; head < out.length; head++) {
    const q = out[head]
    if (depth[q] >= hops) continue
    for (let e = off[q]; e < off[q + 1]; e++) {
      const j = nb[e]
      if (depth[j] >= 0 || (landOnly && sea[j])) continue
      depth[j] = depth[q] + 1
      out.push(j)
    }
  }
  return out
}

/** The wish radius in hops for a grid of subdivision n (CRADLE_WISH.radiusHops at n = 48). */
export function cradleWishRadius(n: number): number {
  return Math.max(1, Math.round((CRADLE_WISH.radiusHops * n) / 48))
}

/** Applies the wishes to the plan (cells, cradle, centres; in place) and returns what became of them. */
export function applyCradleWishes(s: PlanInput, plan: CradlePlan, cradles: readonly number[], rng: Rng): CradleWishResult {
  const T = s.terrain
  const N = T.cellCount
  const pos = s.world.grid.positions
  const P = plan.cells.length
  const res: CradleWishResult = { wish: new Int32Array(P).fill(-1), cell: new Int32Array(P), placed: new Uint8Array(P), crowded: new Uint8Array(P) }
  const used = new Uint8Array(N) // cells taken by wished peoples
  const radius = cradleWishRadius(T.n)
  const wished = new Uint8Array(P) // placed or moved as wished
  // 1. The wishes, in people order.
  for (let p = 0; p < P; p++) {
    const w = wishOf(cradles, p)
    res.wish[p] = w
    if (w < 0) continue
    let cell = -1
    if (w < N) {
      if (T.baseHabitable[w] && !T.sea[w] && !used[w]) { cell = w; res.placed[p] = CradleOutcome.Placed }
      else {
        let best = -1, bestD = Infinity
        for (const c of bfs(s, w, radius, false)) {
          if (!T.baseHabitable[c] || T.sea[c] || used[c]) continue
          const d = chord2(pos, w, c)
          if (d < bestD || (d === bestD && c < best)) { best = c; bestD = d }
        }
        if (best >= 0) { cell = best; res.placed[p] = CradleOutcome.Moved }
      }
    }
    if (cell < 0) { res.placed[p] = CradleOutcome.Rejected; continue }
    used[cell] = 1
    wished[p] = 1
    plan.cells[p] = cell
  }
  // 2. The peoples the simulation places, moved off the wished ones.
  const avoid2 = CRADLE_WISH.avoidChord * CRADLE_WISH.avoidChord
  const tribeChord2 = CRADLE.tribeChord * CRADLE.tribeChord
  const floor2 = CRADLE.tribeFloor * CRADLE.tribeFloor
  const tribeHops = Math.max(1, Math.round((CRADLE.tribeHops * T.n) / 48))
  const taken = (c: number, self: number): boolean => {
    for (let q = 0; q < P; q++) if (q !== self && plan.cells[q] === c) return true
    return false
  }
  const nearest2 = (c: number, self: number): number => {
    let m = Infinity
    for (let q = 0; q < P; q++) if (q !== self) { const d = chord2(pos, c, plan.cells[q]); if (d < m) m = d }
    return m
  }
  for (let p = 0; p < P; p++) {
    if (wished[p]) continue
    const c0 = plan.cells[p]
    let clash = false
    for (let q = 0; q < P && !clash; q++) if (wished[q] && (plan.cells[q] === c0 || chord2(pos, c0, plan.cells[q]) < avoid2)) clash = true
    if (!clash) continue
    const sites = bfs(s, plan.centres[plan.cradle[p]], tribeHops, true).filter((c) => T.baseHabitable[c] === 1)
    sites.sort((a, b) => T.potential[b] - T.potential[a] || a - b)
    sites.length = Math.max(1, Math.ceil(sites.length / 2))
    let total = 0
    for (const c of sites) total += T.potential[c]
    let pick = -1
    let min2 = tribeChord2
    let fails = 0
    while (pick < 0 && min2 >= floor2 && total > 0) {
      let x = rng.next() * total
      let c = sites[sites.length - 1]
      for (let i = 0; i < sites.length; i++) { x -= T.potential[sites[i]]; if (x < 0) { c = sites[i]; break } }
      if (!taken(c, p) && nearest2(c, p) >= Math.max(min2, avoid2)) pick = c
      else if (++fails >= 60) { min2 *= 0.8; fails = 0 }
    }
    if (pick < 0) {
      // The free site farthest from the others (ties on the earlier, better site); else stay unless the cell is taken.
      let bestD = -1
      for (const c of sites) { if (taken(c, p)) continue; const d = nearest2(c, p); if (d > bestD) { bestD = d; pick = c } }
      if (pick < 0 || bestD <= nearest2(c0, p)) pick = taken(c0, p) ? pick : c0
    }
    if (pick < 0) {
      // (Practically unreachable: every site of the cradle taken.) The nearest free habitable cell anywhere.
      let bestD = Infinity
      for (let c = 0; c < N; c++) if (T.baseHabitable[c] && !T.sea[c] && !taken(c, p)) { const d = chord2(pos, c0, c); if (d < bestD) { bestD = d; pick = c } }
      if (pick < 0) pick = c0
    }
    plan.cells[p] = pick
  }
  for (let p = 0; p < P; p++) res.cell[p] = plan.cells[p]
  // 3. Crowded wishes: two wished peoples in sight of each other at founding.
  const crowd2 = CRADLE_WISH.crowdChord * CRADLE_WISH.crowdChord
  for (let p = 0; p < P; p++) for (let q = p + 1; q < P; q++) {
    if (wished[p] && wished[q] && chord2(pos, plan.cells[p], plan.cells[q]) < crowd2) { res.crowded[p] = 1; res.crowded[q] = 1 }
  }
  // 4. The cradles: wished peoples join a live cradle near them or begin their own; empty ones are dropped.
  const K = plan.centres.length
  const centres = plan.centres.slice()
  const live: number[] = []
  for (let k = 0; k < K; k++) {
    let any = false
    for (let p = 0; p < P; p++) if (!wished[p] && plan.cradle[p] === k) any = true
    live.push(any ? 1 : 0)
  }
  const join2 = CRADLE_WISH.joinChord * CRADLE_WISH.joinChord
  const cradle = plan.cradle.slice()
  for (let p = 0; p < P; p++) {
    if (!wished[p]) continue
    const c = plan.cells[p]
    let best = -1, bestD = Infinity
    for (let k = 0; k < centres.length; k++) {
      if (!live[k] || T.landmass[centres[k]] !== T.landmass[c]) continue
      const d = chord2(pos, c, centres[k])
      if (d <= join2 && d < bestD) { best = k; bestD = d }
    }
    if (best < 0) { best = centres.length; centres.push(c); live.push(1) }
    cradle[p] = best
  }
  const renum = new Int32Array(centres.length).fill(-1)
  plan.centres = []
  for (let k = 0; k < centres.length; k++) {
    let any = false
    for (let p = 0; p < P; p++) if (cradle[p] === k) any = true
    if (any) { renum[k] = plan.centres.length; plan.centres.push(centres[k]) }
  }
  for (let p = 0; p < P; p++) plan.cradle[p] = renum[cradle[p]]
  return res
}

/** The founding plan of a world with the given wishes, without simulating (the plan's 'history-cradles' draws, then the wishes). */
function planOf(world: World, cradles?: readonly number[]): { plan: CradlePlan; wish?: CradleWishResult } {
  const s: PlanInput = { world, terrain: buildTerrain(world) }
  const plan = planCradles(s, createRng(world.seed, 'history-cradles'))
  const wish = cradles && hasCradleWish(cradles, plan.cells.length) ? applyCradleWishes(s, plan, cradles, createRng(world.seed, 'history-cradles-wish')) : undefined
  return { plan, wish }
}

/**
 * How many peoples a world gets (History.peoples.length of every history of it, whatever the options and the wishes):
 * it depends only on the world. Builds the world's terrain (a fraction of a second).
 */
export function cradleCount(world: World): number {
  return planOf(world).plan.cells.length
}

/** A preview of the wishes without simulating: per people the wish, the start cell used, the CradleOutcome and the crowded flag, exactly as the History will record them; and each people's cradle. */
export interface CradlePreview {
  count: number
  wish: Int32Array
  cell: Int32Array
  placed: Uint8Array
  crowded: Uint8Array
  /** People.cradle of each people. */
  cradle: Int32Array
}

export function previewCradles(world: World, cradles?: readonly number[]): CradlePreview {
  const { plan, wish } = planOf(world, cradles)
  const P = plan.cells.length
  return {
    count: P,
    wish: wish ? wish.wish : new Int32Array(P).fill(-1),
    cell: Int32Array.from(plan.cells),
    placed: wish ? wish.placed : new Uint8Array(P),
    crowded: wish ? wish.crowded : new Uint8Array(P),
    cradle: Int32Array.from(plan.cradle),
  }
}
