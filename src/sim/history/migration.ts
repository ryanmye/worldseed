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
//
// Knowledge (knowledge.ts): a group moves only through cells its people
// knows, and joins only settlements of its own people or of a people it has
// met; it may found a site beside strangers it knows of, and meets them
// there. Its route and the cells beside it become known (and a route passing
// strangers' land makes first contact).
//
// Species (species.ts): a group judges a site by what its own species would make
// of the land there (so nobody settles highlands without a highland crop),
// crosses desert cheaply with camels and highlands with llamas, and travels
// further with horses.
//
// frontier: expansion advances as a front with occasional leaps: most groups
// prefer near, contiguous land and may stop at a town they pass (frontier.ts).

import { EventType, JourneyKind, TechField } from '../../contract.ts'
import { clamp, smoothstep } from '../util.ts'
import { FRONTIER, MIGRATION, PORT, SPECIES, VOYAGE, WEALTH } from './params.ts'
import { claimStrength } from './population.ts'
import { hubSize } from './trade.ts'
import type { HistoryState } from './state.ts'
import { found, logEvent, logJourney, productivityOf, techOf } from './state.ts'
import { learnPath } from './knowledge.ts'
import { hasHorse, moveMuls, siteFactorAt, siteRows } from './species.ts'
import { contiguous, createFrontier, passJoin, setAllowed, syncFrontier } from './frontier.ts' // frontier:
import type { FrontierState } from './frontier.ts'
import { fleeChance, joinBlocked, joinFactor, refugeeKnowledge, siteFactor } from './polity/system.ts' // polities:
import { rushAt } from './goods/hooks.ts' // goods:

/**
 * Reusable search buffers. The search is Dijkstra with a bucket queue (Dial's algorithm): bucket b
 * holds cells at travel cost [b * width, (b + 1) * width), width below the cheapest step anywhere
 * (MIGRATION.bucketWidth cell units), so every cell is final when its bucket comes up; within a
 * bucket cells are settled in the order they were reached.
 */
export interface Search {
  dist: Float64Array
  stamp: Int32Array
  /** Predecessor cell on the shortest path found so far, valid wherever `stamp` matches `run`. */
  prev: Int32Array
  /** Cells settled this run (stamp), at what cost. */
  done: Int32Array
  doneDist: Float64Array
  buckets: Int32Array[]
  bucketLen: Int32Array
  /** Buckets [0, used) may hold entries from the last run. */
  used: number
  /** 1 / bucket width. */
  inv: number
  run: number
  /** frontier: settled-land counts and the frontier stream (frontier.ts), created at the first migration. */
  frontier: FrontierState | null
}

export function createSearch(cellCount: number, cellScale: number): Search {
  const buckets: Int32Array[] = []
  for (let b = 0; b < 64; b++) buckets.push(new Int32Array(16))
  return {
    dist: new Float64Array(cellCount),
    stamp: new Int32Array(cellCount),
    prev: new Int32Array(cellCount),
    done: new Int32Array(cellCount),
    doneDist: new Float64Array(cellCount),
    buckets,
    bucketLen: new Int32Array(64),
    used: 0,
    inv: 1 / (MIGRATION.bucketWidth * cellScale),
    run: 0,
    frontier: null,
  }
}

/** Queues cell c at cost d (bucket floor(d * inv)), growing the buckets as needed. */
function enqueue(search: Search, c: number, d: number): void {
  const b = Math.floor(d * search.inv)
  if (b >= search.bucketLen.length) {
    let size = search.bucketLen.length
    while (size <= b) size *= 2
    const len = new Int32Array(size)
    len.set(search.bucketLen)
    search.bucketLen = len
    for (let k = search.buckets.length; k < size; k++) search.buckets.push(new Int32Array(16))
  }
  let arr = search.buckets[b]
  const n = search.bucketLen[b]
  if (n === arr.length) {
    const a = new Int32Array(arr.length * 2)
    a.set(arr)
    search.buckets[b] = arr = a
  }
  arr[n] = c
  search.bucketLen[b] = n + 1
  if (b >= search.used) search.used = b + 1
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
 * Cosmetic travel time in years for a route: about 1 year for a short hop,
 * growing toward ~10 for routes whose land legs use up most of the (possibly
 * voyage-boosted) budget; sea legs go by boat, VOYAGE.travelPerCell years a cell.
 */
function travelYears(s: HistoryState, path: number[], budget: number): number {
  const T = s.terrain
  let land = 0, sea = 0
  for (let k = 1; k < path.length; k++) {
    const c = path[k]
    if (T.sea[c]) sea++
    else land += s.moveCost[c]
  }
  return clamp(1 + 9 * (land / budget) + VOYAGE.travelPerCell * sea, 1, 10)
}

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
  // frontier: settled land as of now (foundings and abandonments since last year).
  if (!search.frontier) search.frontier = createFrontier(s)
  syncFrontier(s, search.frontier, true)
  // Groups leave from settlements alive at the start of the system; new ones wait a year.
  const movers = s.living.slice()
  for (let t = 0; t < movers.length; t++) {
    const id = movers[t]
    const p = s.pop[id]
    const roll = rng.next()
    const flee = M.hungerChance * (1 - smoothstep(M.hungerLow, M.hungerHigh, s.food[id])) + (s.pol !== null ? fleeChance(s.pol, id) : 0) // polities: flight from danger
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
    // A group that finds nowhere to go stays; its settlement waits before trying again
    // (colonists longer after each search in a row that found nothing, up to retryMax times as long).
    if (migrate(s, search, id, g, refugees)) s.migFails[id] = 0
    else if (refugees) s.nextMigration[id] = s.year + M.retryRefugees
    else {
      const k = s.migFails[id] < M.retryMax ? ++s.migFails[id] : M.retryMax
      s.nextMigration[id] = s.year + M.retryColonists * k
    }
  }
}

/** Travel cost multipliers by species move class for the current search (species.moveMuls). */
const TMUL = new Float64Array(3)

/** Result of the last siteSearch: best new site (cell) or settlement to join, -1 if none. */
let foundCell = -1
let foundJoin = -1
/** Whether the last shadow siteSearch (restricted, no jitter) met unknown cells within its budget. */
let foundFrontier = false

/**
 * The search a group of g from settlement `from` makes for somewhere to go (Dijkstra over travel
 * cost within `budget`). With `restrict`, only through cells its people knows and joining only
 * peoples it has met; with `jitter`, scores carry the usual random factor (drawn from the
 * migration stream; without it nothing is drawn, for shadow decisions). Sets foundCell / foundJoin.
 * frontier: unless `leap`, near and contiguous sites are preferred (frontier.ts; setAllowed done by the caller).
 */
function siteSearch(s: HistoryState, search: Search, from: number, g: number, mayJoin: boolean, budget: number, ocean: number, seaMul: number, prod: number, restrict: boolean, jitter: boolean, leap: boolean): void {
  const M = MIGRATION
  const T = s.terrain
  const rng = s.rngMigration
  const sitePref = 1 + PORT.sitePref
  const k = s.know
  const known = k.known
  const people = s.people[from]
  const kBase = people * k.N
  const cBase = people * k.P
  const contact = k.contact

  const { dist, stamp, prev, done, doneDist } = search
  const run = ++search.run
  search.bucketLen.fill(0, 0, search.used)
  search.used = 0
  const origin = s.cell[from]
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  dist[origin] = 0
  stamp[origin] = run
  enqueue(search, origin, 0)

  let bestScore = 0
  let bestCell = -1
  let bestJoin = -1
  const minFood = M.foundMinRatio * g
  // Hoisted for the hot loop.
  const { occupant, food: foodRatio, people: peopleOf, nearCount, claim, effCap, portReach, outpost } = s
  const moveCost = s.moveCost
  const { habitable, potential, deep, sea, catchOff, catchBase, catchCell, catchW } = T
  const seaCost = T.moveCost
  // Species: site factors and travel over desert / highland for this group.
  const rows = siteRows(s, from)
  const siteMax = s.sp.siteMax
  const mcls = s.sp.moveClass
  const tm = TMUL
  moveMuls(s, from, tm)
  const plain = tm[1] === 1 && tm[2] === 1
  let sf = 0
  const st = claimStrength(g)
  const maxVisits = M.maxVisits
  const costPenalty = M.costPenalty
  let visits = 0
  let frontier = false
  const inv = search.inv
  // frontier: distance discount and contiguity (none for a group that goes far).
  const fr = search.frontier as FrontierState
  const FR = FRONTIER
  const originLm = T.landmass[origin]
  const invHalf = 1 / FR.distHalf
  for (let b = 0, i = 0; ;) {
    if (i >= search.bucketLen[b]) {
      if (++b >= search.used) break
      i = 0
      continue
    }
    const c = search.buckets[b][i++]
    const d = dist[c]
    if (Math.floor(d * inv) !== b || (done[c] === run && doneDist[c] <= d)) continue // stale entry
    if (visits >= maxVisits) break
    done[c] = run
    doneDist[c] = d
    visits++
    if (c !== origin) {
      const occ = occupant[c]
      if (occ >= 0) {
        // A hungry place takes nobody in (checked first: the rest is dearer); strangers neither, nor an expedition base.
        if (foodRatio[occ] >= M.joinFood && outpost[occ] === 0 && (!restrict || peopleOf[occ] === people || contact[cBase + peopleOf[occ]] >= 0)) {
          const pop = s.pop[occ]
          const wf = prosperity(s, occ)
          const rich = wf >= WEALTH.joinMin
          let spare = M.joinRoom * foodBase(s, occ) - pop
          if (rich) { const room = WEALTH.joinRoom * wf * pop; if (room > spare) spare = room }
          if ((mayJoin || rich) && spare >= g && (s.pol === null || !joinBlocked(s.pol, from, occ))) { // polities: never into an enemy at war
            const draw = (1 + (M.urbanDraw * pop) / (pop + M.urbanHalf)) * (1 + WEALTH.draw * wf)
            let score = (M.joinBias * spare * draw * (jitter ? rng.range(0.75, 1.25) : 1)) / (1 + (costPenalty * d) / budget)
            if (!leap) { const dd = 1 + d * invHalf; score *= (1 + FR.contigBonus) / (dd * dd) } // frontier: (a settlement is settled land)
            if (s.pol !== null) score *= joinFactor(s, s.pol, from, occ) // polities: crowding into walled towns
            if (s.goods !== null) score *= rushAt(s.goods, c) // goods: the rush to a fresh find
            if (score > bestScore) { bestScore = score; bestCell = -1; bestJoin = occ }
          }
        }
      } else if (habitable[c] === 1 && nearCount[c] === 0 && potential[c] * prod * siteMax[c] >= minFood && potential[c] * prod * (sf = siteFactorAt(s, rows, c)) >= minFood) {
        // What the group could expect here (people fed, at its productivity and with its species), sharing every
        // base-catchment cell with its current claimants as the food system would, and what the land would give it alone.
        let v = 0, a = 0
        for (let q = catchOff[c], e = catchBase[c]; q < e; q++) {
          const j = catchCell[q]
          const w = catchW[q]
          const wg = w * st
          const cw = effCap[j] * w
          v += (cw * wg) / (claim[j] + wg)
          a += cw
        }
        const food = v * prod * sf
        if (food >= minFood) {
          // Empty land pulls: the larger the share of the land nobody else works, the better.
          const alone = a * prod * sf
          const free = alone > 0 ? food / alone : 0
          // frontier: near, contiguous land first; the empty-land pull at the frontier and overseas.
          const contig = leap || contiguous(s, fr, c)
          const pull = contig || T.landmass[c] !== originLm ? M.emptyPull : M.emptyPull * FR.farPull
          let score = (food * (1 + pull * free * free) * (jitter ? rng.range(0.75, 1.25) : 1)) / (1 + (costPenalty * d) / budget)
          if (!leap) { const dd = 1 + d * invHalf; score *= (contig ? 1 + FR.contigBonus : 1) / (dd * dd) }
          if (portReach[c]) score *= sitePref
          if (s.pol !== null) score *= siteFactor(s, s.pol, c, from) // polities: danger and defensibility
          if (s.goods !== null) score *= rushAt(s.goods, c) // goods: the rush to a fresh find
          if (score > bestScore) { bestScore = score; bestCell = c; bestJoin = -1 }
        }
      }
    }
    for (let e = off[c], e1 = off[c + 1]; e < e1; e++) {
      const j = nb[e]
      if (restrict && known[kBase + j] < 0) {
        // Nobody of this people has seen it (the shadow search notes whether that cut its reach short).
        if (!jitter && !frontier) frontier = d + (deep[j] ? ocean : sea[j] ? seaCost[j] * seaMul : plain ? moveCost[j] : moveCost[j] * tm[mcls[j]]) <= budget
        continue
      }
      const nd = d + (deep[j] ? ocean : sea[j] ? seaCost[j] * seaMul : plain ? moveCost[j] : moveCost[j] * tm[mcls[j]])
      if (nd > budget) continue
      if (stamp[j] === run && nd >= dist[j]) continue
      stamp[j] = run
      dist[j] = nd
      prev[j] = c
      enqueue(search, j, nd)
    }
  }
  foundCell = bestCell
  foundJoin = bestJoin
  foundFrontier = frontier
}

/** Sends a group of g from settlement `from`; returns false if it found nowhere to go. */
function migrate(s: HistoryState, search: Search, from: number, g: number, mayJoin: boolean): boolean {
  const M = MIGRATION
  const T = s.terrain
  const rng = s.rngMigration
  // Technology: Farming for what a site would yield, Crafts for how far the group can travel overland, Seafaring at sea.
  const prod = productivityOf(s, from)
  const hasPort = s.port[from] >= 0
  const voyage = rng.next() < (hasPort ? PORT.voyageChance : M.voyageChance)
  let budget = M.budget * (1 + M.budgetTech * (techOf(s, from, TechField.Crafts) - 1)) * rng.range(M.budgetJitterMin, M.budgetJitterMax)
  if (hasHorse(s, from)) budget *= 1 + SPECIES.horseBudget
  let ocean = (M.oceanCost * T.cellScale) / Math.sqrt(techOf(s, from, TechField.Seafaring))
  if (voyage) { budget *= M.voyageBudget; ocean *= M.voyageOcean }
  // frontier: a few groups go far (long voyages, and leapChance of the rest: from the frontier stream).
  const fr = search.frontier as FrontierState
  const leap = fr.rng.next() < FRONTIER.leapChance || voyage
  syncFrontier(s, fr, false)
  setAllowed(s, fr, s.people[from])
  // Boats: from a port the sea is cheap; without one every sea cell costs more.
  ocean *= hasPort ? PORT.oceanMul : M.seaNoPort
  const seaMul = hasPort ? PORT.seaMul : M.seaNoPort

  const kd = s.knowDiag
  if (kd) {
    // Shadow decisions without randomness: from what the people knows, and from full knowledge.
    siteSearch(s, search, from, g, mayJoin, budget, ocean, seaMul, prod, true, false, leap)
    const kc = foundCell, kj = foundJoin
    if (foundFrontier) kd.migFrontier++
    siteSearch(s, search, from, g, mayJoin, budget, ocean, seaMul, prod, false, false, leap)
    kd.migrations++
    if (foundCell !== kc || foundJoin !== kj) {
      if (kc < 0 && kj < 0) kd.migBlocked++
      else kd.migRedirected++
    }
  }
  siteSearch(s, search, from, g, mayJoin, budget, ocean, seaMul, prod, true, true, leap)
  let bestCell = foundCell, bestJoin = foundJoin
  const { prev } = search
  const origin = s.cell[from]

  // frontier: bound for a new site, the group may stop at a settlement it passes that takes it in.
  let joinPath: number[] | null = null
  if (bestCell >= 0 && !leap) {
    const way = reconstructPath(prev, origin, bestCell)
    const stop = passJoin(s, fr, from, g, way, foodBase, prosperity)
    if (stop.join >= 0) {
      bestJoin = stop.join
      bestCell = -1
      joinPath = way.slice(0, stop.at + 1)
      if (joinPath[stop.at] !== s.cell[stop.join]) joinPath.push(s.cell[stop.join])
    }
  }
  if (bestJoin >= 0) {
    s.pop[from] -= g
    s.pop[bestJoin] += g
    logEvent(s, EventType.Migration, from, bestJoin, g)
    if (s.pol !== null && s.people[from] !== s.people[bestJoin]) refugeeKnowledge(s, s.pol, from, bestJoin, g) // polities: (v2) refugees carry their skills
    const arriveYear = s.year
    const path = joinPath ?? reconstructPath(prev, origin, s.cell[bestJoin])
    const departYear = Math.max(s.founded[from], arriveYear - travelYears(s, path, budget))
    logJourney(s, { departYear, arriveYear, from, to: bestJoin, size: g, kind: JourneyKind.Migrants, path })
    learnPath(s, from, path, true)
    return true
  }
  if (bestCell >= 0) {
    s.pop[from] -= g
    const to = found(s, bestCell, g, from)
    const arriveYear = s.year
    const path = reconstructPath(prev, origin, bestCell)
    const departYear = Math.max(s.founded[from], arriveYear - travelYears(s, path, budget))
    logJourney(s, { departYear, arriveYear, from, to, size: g, kind: JourneyKind.Settlers, path })
    learnPath(s, to, path, true)
    return true
  }
  return false
}
