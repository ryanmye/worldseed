// frontier: land settlement advances as a front, with occasional leaps (used by migration.ts).
//
// A land group's site search (migration.ts siteSearch) judges sites as before and then, unless the group is
// one of the few that go far (a long voyage, or FRONTIER.leapChance), also:
//   - discounts a site by its travel cost d from the origin: score / (1 + d / distHalf)^2, so the first good land
//     reached is preferred (a much better site further out can still win);
//   - favours contiguous sites, those within FRONTIER.contigDist (catchment distance, so further along rivers and
//     coasts) of a living settlement of the group's own people or of a people it has met, or on a road: score *
//     (1 + contigBonus); joining an existing settlement counts as contiguous;
//   - lets the empty-land pull (MIGRATION.emptyPull) act fully only at the frontier (contiguous sites) and overseas
//     (another landmass); elsewhere at farPull of its strength, so it does not draw settlers past half-settled land.
// A group bound for a new site may also stop at a town it passes (on or beside its way, at least passMinPop people)
// that would take it in (fed, room for it, its own people or a people it has met): with chance passJoin per such town.
// Colonising sea voyages (voyages.ts) and expeditions (exploration.ts) are unchanged.
//
// State: per people and cell, how many living settlements of that people reach the cell (catchment lists, kept
// in step with foundings and abandonments incrementally). Draws come from the 'history-frontier' stream only.

import type { Rng } from '../rng.ts'
import { createRng } from '../rng.ts'
import { FRONTIER, MIGRATION, WEALTH } from './params.ts'
import type { HistoryState } from './state.ts'

export interface FrontierState {
  rng: Rng
  P: number
  N: number
  /** Living (non-base) settlements of each people whose catchment within contigDist reaches each cell: cnt[people * N + cell]. */
  cnt: Uint16Array
  /** Settlement ids counted in `cnt`, ascending; settlements [0, seen) have been examined. */
  counted: number[]
  seen: number
  /** Peoples whose settled land counts as contiguous for the current group (its own and those it has met), and how many. */
  allowed: Int32Array
  allowedCount: number
}

export function createFrontier(s: HistoryState): FrontierState {
  const P = s.know.P
  const N = s.terrain.cellCount
  return {
    rng: createRng(s.world.seed, 'history-frontier'),
    P, N,
    cnt: new Uint16Array(P * N),
    counted: [],
    seen: 0,
    allowed: new Int32Array(P),
    allowedCount: 0,
  }
}

function mark(s: HistoryState, fs: FrontierState, id: number, delta: number): void {
  const T = s.terrain
  const c = s.cell[id]
  const base = s.people[id] * fs.N
  const maxD = FRONTIER.contigDist + 1e-9
  const cnt = fs.cnt
  for (let k = T.catchOff[c]; k < T.catchOff[c + 1]; k++) {
    if (T.catchDist[k] > maxD) break // (nearest first)
    cnt[base + T.catchCell[k]] += delta
  }
}

/** Brings the counts up to date: settlements founded since the last call, and (with `full`) those abandoned. */
export function syncFrontier(s: HistoryState, fs: FrontierState, full: boolean): void {
  const list = fs.counted
  if (full) {
    let w = 0
    for (let t = 0; t < list.length; t++) {
      const id = list[t]
      if (s.abandoned[id] >= 0) { mark(s, fs, id, -1); continue }
      list[w++] = id
    }
    list.length = w
  }
  for (let id = fs.seen; id < s.count; id++) {
    if (s.outpost[id] || s.abandoned[id] >= 0) continue
    mark(s, fs, id, 1)
    list.push(id)
  }
  fs.seen = s.count
}

/** Sets the peoples whose land counts as contiguous for a group of people p: p and those it has met. */
export function setAllowed(s: HistoryState, fs: FrontierState, p: number): void {
  const k = s.know
  let n = 0
  fs.allowed[n++] = p
  for (let q = 0; q < fs.P; q++) if (q !== p && k.contact[p * k.P + q] >= 0) fs.allowed[n++] = q
  fs.allowedCount = n
}

/** True when cell c is contiguous with the settled land of the allowed peoples (setAllowed), or on a road. */
export function contiguous(s: HistoryState, fs: FrontierState, c: number): boolean {
  if (s.road[c] >= FRONTIER.roadMin) return true
  const cnt = fs.cnt, N = fs.N, allowed = fs.allowed
  for (let t = 0; t < fs.allowedCount; t++) if (cnt[allowed[t] * N + c] > 0) return true
  return false
}

/**
 * A group of g from settlement `from` (people p, allowed set for it) bound for a new site along `path`: the first
 * settlement on or beside its way that would take it in and where it chooses to stop (chance passJoin each),
 * and the index on the path where it turns off; -1 if none. `foodBase` and `prosperity` are migration.ts's.
 */
export function passJoin(s: HistoryState, fs: FrontierState, from: number, g: number, path: number[], foodBase: (s: HistoryState, id: number) => number, prosperity: (s: HistoryState, id: number) => number): { join: number; at: number } {
  const M = MIGRATION
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const occupant = s.occupant
  const dest = path[path.length - 1]
  const origin = path[0]
  const allowed = fs.allowed
  const tried: number[] = []
  const takes = (o: number): boolean => {
    if (o < 0 || o === from || s.outpost[o] || s.pop[o] < FRONTIER.passMinPop || s.food[o] < M.joinFood || tried.indexOf(o) >= 0) return false
    tried.push(o) // (each settlement passed is considered once)
    let ok = false
    for (let t = 0; t < fs.allowedCount; t++) if (allowed[t] === s.people[o]) ok = true
    if (!ok) return false
    const pop = s.pop[o]
    let spare = M.joinRoom * foodBase(s, o) - pop
    const wf = prosperity(s, o)
    if (wf >= WEALTH.joinMin) { const room = WEALTH.joinRoom * wf * pop; if (room > spare) spare = room }
    return spare >= g
  }
  for (let k = 1; k + 1 < path.length; k++) {
    const c = path[k]
    const o = occupant[c]
    if (takes(o)) { if (fs.rng.next() < FRONTIER.passJoin) return { join: o, at: k }; continue }
    for (let e = off[c]; e < off[c + 1]; e++) {
      const j = nb[e]
      if (j === dest || j === origin) continue
      const oj = occupant[j]
      if (oj >= 0 && takes(oj) && fs.rng.next() < FRONTIER.passJoin) return { join: oj, at: k }
    }
  }
  return { join: -1, at: -1 }
}
