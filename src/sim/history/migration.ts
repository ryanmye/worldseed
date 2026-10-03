// Migration: settlements under population pressure or hunger send out groups.
// A group searches outward over terrain cost (Dijkstra, cheap along rivers and
// coasts, expensive over mountains, desert and open sea) within a travel
// budget and either founds a new settlement at the best free site it reaches
// or joins an existing settlement with spare food. Groups leaving a port sail
// cheaper and more often go on long voyages; coastal sites within reach of a
// port attract founders. Sites are judged on their effective (degraded,
// irrigated) capacity, so exhausted land is avoided until it recovers.
// Roads make overland travel cheaper. Trade shapes migration too: pressure is
// measured against the food a settlement gets including its net imports, rich
// settlements keep their people and draw migrants, and colonists may join a
// rich settlement instead of founding a new one. Founders value uncrowded
// land: a site's score rises with the share of its land nobody else works,
// so groups reaching a new, empty land spread out over it.

import { EventType, JourneyKind } from '../../contract.ts'
import { clamp, MinHeap, smoothstep } from '../util.ts'
import { MIGRATION, PORT, WEALTH } from './params.ts'
import { claimStrength } from './population.ts'
import { hubSize } from './trade.ts'
import type { HistoryState } from './state.ts'
import { canSettle, found, logEvent, logJourney } from './state.ts'

/** Reusable Dijkstra buffers. */
export interface Search {
  dist: Float64Array
  stamp: Int32Array
  /** Predecessor cell on the shortest path found so far, valid wherever `stamp` matches `run`. */
  prev: Int32Array
  heap: MinHeap
  run: number
}

export function createSearch(cellCount: number): Search {
  return {
    dist: new Float64Array(cellCount),
    stamp: new Int32Array(cellCount),
    prev: new Int32Array(cellCount),
    heap: new MinHeap(1024),
    run: 0,
  }
}

/** Walks `prev` from `dest` back to `origin`, returning the path origin-first. */
function reconstructPath(prev: Int32Array, origin: number, dest: number): number[] {
  const path: number[] = [dest]
  let c = dest
  while (c !== origin) {
    c = prev[c]
    path.push(c)
  }
  path.reverse()
  return path
}

/**
 * Cosmetic travel time in years for a route that cost `dist` out of `budget`:
 * about 1 year for a short hop, growing toward ~10 for routes that use up
 * most of the (possibly voyage-boosted) budget.
 */
function travelYears(dist: number, budget: number): number {
  return clamp(1 + 9 * (dist / budget), 1, 10)
}

/**
 * What a group of g settlers could expect at `cell` (people fed, this year's
 * productivity), sharing every base-catchment cell with its current claimants
 * as the food system would.
 */
export function settlerFood(s: HistoryState, cell: number, g: number): number {
  const T = s.terrain
  const st = claimStrength(g)
  let v = 0, a = 0
  for (let k = T.catchOff[cell]; k < T.catchBase[cell]; k++) {
    const j = T.catchCell[k]
    const w = T.catchW[k]
    const wg = w * st
    const cw = s.effCap[j] * w
    v += (cw * wg) / (s.claim[j] + wg)
    a += cw
  }
  settlerAlone = a * s.productivity
  return v * s.productivity
}

/** What the group of the last settlerFood call would get at that cell with nobody else around (set by settlerFood). */
let settlerAlone = 0

/** Prosperity f = max(w / (w + half), x / (1 + x)) of a settlement, w = wealth per head, x = hub size (0 for none). */
export function prosperity(s: HistoryState, id: number): number {
  const p = s.pop[id]
  if (p <= 0) return 0
  const w = s.wealth[id] / p
  const f = w / (w + WEALTH.half)
  const x = hubSize(s, id)
  const h = x / (1 + x)
  return f > h ? f : h
}

/** Food a settlement can count on: expected local food plus smoothed net imports, if it imports (at least 1). */
export function foodBase(s: HistoryState, id: number): number {
  const imp = s.foodImport[id]
  const f = s.expected[id] + (imp > 0 ? imp : 0)
  return f > 1 ? f : 1
}

/**
 * System: pressured settlements send groups. Population pressure (people
 * near the food the land gives) sends colonists, who found new settlements;
 * hunger sends refugees, who found or join whichever is better.
 */
export function migrationSystem(s: HistoryState, search: Search): void {
  const M = MIGRATION
  const rng = s.rngMigration
  // Groups leave from settlements alive at the start of the system; new ones wait a year.
  const movers = s.living.slice()
  for (let t = 0; t < movers.length; t++) {
    const id = movers[t]
    const p = s.pop[id]
    const roll = rng.next()
    const flee = M.hungerChance * (1 - smoothstep(M.hungerLow, M.hungerHigh, s.food[id]))
    if (p < M.minPop) {
      // Too few to split up: when hunger drives them out, the whole hamlet
      // leaves together (and the site is abandoned).
      if (p >= M.minGroup && roll < flee * M.exodusChance && s.year >= s.nextMigration[id]) {
        if (!migrate(s, search, id, p, true)) s.nextMigration[id] = s.year + M.retryRefugees
      }
      continue
    }
    const colonise = (M.pressureChance * smoothstep(M.pressureLow, M.pressureHigh, p / foodBase(s, id))) / (1 + WEALTH.stay * prosperity(s, id))
    if (roll >= colonise + flee || s.year < s.nextMigration[id]) continue
    const g = Math.floor(p * rng.range(M.groupMin, M.groupMax))
    if (g < M.minGroup || p - g < M.minGroup) continue
    const refugees = roll >= colonise
    // A group that finds nowhere to go stays; its settlement waits before trying again.
    if (!migrate(s, search, id, g, refugees)) s.nextMigration[id] = s.year + (refugees ? M.retryRefugees : M.retryColonists)
  }
}

/** Sends a group of g from settlement `from`; returns false if it found nowhere to go. */
function migrate(s: HistoryState, search: Search, from: number, g: number, mayJoin: boolean): boolean {
  const M = MIGRATION
  const T = s.terrain
  const rng = s.rngMigration
  const prod = s.productivity
  const hasPort = s.port[from] >= 0
  const voyage = rng.next() < (hasPort ? PORT.voyageChance : M.voyageChance)
  let budget = M.budget * (1 + M.budgetTech * (prod - 1)) * rng.range(M.budgetJitterMin, M.budgetJitterMax)
  let ocean = (M.oceanCost * T.cellScale) / Math.sqrt(prod)
  if (voyage) { budget *= M.voyageBudget; ocean *= M.voyageOcean }
  // Boats: from a port the sea is cheap; without one every sea cell costs more.
  ocean *= hasPort ? PORT.oceanMul : M.seaNoPort
  const seaMul = hasPort ? PORT.seaMul : M.seaNoPort
  const sitePref = 1 + PORT.sitePref

  const { dist, stamp, prev, heap } = search
  const run = ++search.run
  heap.size = 0
  const origin = s.cell[from]
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  dist[origin] = 0
  stamp[origin] = run
  heap.push(0, origin)

  let bestScore = 0
  let bestDist = 0
  let bestCell = -1
  let bestJoin = -1
  const minFood = M.foundMinRatio * g
  let visits = 0
  while (heap.size > 0 && visits < M.maxVisits) {
    const d = heap.topKey()
    const c = heap.pop()
    if (d > dist[c]) continue // stale entry
    visits++
    const penalty = 1 + (M.costPenalty * d) / budget
    if (c !== origin) {
      const occ = s.occupant[c]
      if (occ >= 0) {
        const pop = s.pop[occ]
        const wf = prosperity(s, occ)
        const rich = wf >= WEALTH.joinMin
        let spare = M.joinRoom * foodBase(s, occ) - pop
        if (rich) { const room = WEALTH.joinRoom * wf * pop; if (room > spare) spare = room }
        if ((mayJoin || rich) && spare >= g && s.food[occ] >= M.joinFood) {
          const draw = (1 + (M.urbanDraw * pop) / (pop + M.urbanHalf)) * (1 + WEALTH.draw * wf)
          const score = (M.joinBias * spare * draw * rng.range(0.75, 1.25)) / penalty
          if (score > bestScore) { bestScore = score; bestDist = d; bestCell = -1; bestJoin = occ }
        }
      } else if (canSettle(s, c) && T.potential[c] * prod >= minFood) {
        const food = settlerFood(s, c, g)
        if (food >= minFood) {
          // Empty land pulls: the larger the share of the land nobody else works, the better.
          const free = settlerAlone > 0 ? food / settlerAlone : 0
          let score = (food * (1 + M.emptyPull * free * free) * rng.range(0.75, 1.25)) / penalty
          if (s.portReach[c]) score *= sitePref
          if (score > bestScore) { bestScore = score; bestDist = d; bestCell = c; bestJoin = -1 }
        }
      }
    }
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      const nd = d + (T.deep[j] ? ocean : T.sea[j] ? T.moveCost[j] * seaMul : s.moveCost[j])
      if (nd > budget) continue
      if (stamp[j] === run && nd >= dist[j]) continue
      stamp[j] = run
      dist[j] = nd
      prev[j] = c
      heap.push(nd, j)
    }
  }

  if (bestJoin >= 0) {
    s.pop[from] -= g
    s.pop[bestJoin] += g
    logEvent(s, EventType.Migration, from, bestJoin, g)
    const arriveYear = s.year
    const departYear = Math.max(s.founded[from], arriveYear - travelYears(bestDist, budget))
    const path = reconstructPath(prev, origin, s.cell[bestJoin])
    logJourney(s, { departYear, arriveYear, from, to: bestJoin, size: g, kind: JourneyKind.Migrants, path })
    return true
  }
  if (bestCell >= 0) {
    s.pop[from] -= g
    const to = found(s, bestCell, g, from)
    const arriveYear = s.year
    const departYear = Math.max(s.founded[from], arriveYear - travelYears(bestDist, budget))
    const path = reconstructPath(prev, origin, bestCell)
    logJourney(s, { departYear, arriveYear, from, to, size: g, kind: JourneyKind.Settlers, path })
    return true
  }
  return false
}
