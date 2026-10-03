// Voyages of settlement: colonising expeditions by sea.
//
// Each year every coastal settlement of some size may fit out an expedition:
// rarely without a port, more often with one, more often under population
// pressure, when rich, and when a known, still open land lies within reach.
// Its range (in sea-cost units: a shallow cell costs 1, open ocean more, less
// from a port) grows with technology (the productivity curve), the sender's
// wealth and its size, so early boats hop along coasts and to offshore
// islands, later ones cross straits and narrow seas, and rich port cities
// late in the run cross open ocean. The expedition searches outward over the
// sea (Dijkstra; sea ice is impassable) for landfalls: free habitable coast
// that leaves the group most of what the land would give it alone, judged on
// what the settlers could expect there (as land migrants judge sites), better
// at river mouths, on another landmass, on an empty one, and on a land known
// to be open; nearer landfalls score higher. The first few acceptable
// landfalls bound the search (those on the home landmass count for less).
//
// Risk: an expedition may be lost at sea (more likely the more open ocean it
// crosses, less with technology and on a known route), and the survivors who
// land have lost some of their number. A lost expedition founds nothing and
// logs no event (the contract has none for it; see the stats harness). A
// colony that lands lives through hard first years (occasional heavy
// losses), so some fail and are abandoned; the rest grow, spread by ordinary
// land migration, build ports and send voyages of their own.
//
// Knowledge: the first landfall on a landmass with nobody on it records a
// discovery (from the sender's landmass, with the route's cost). While that
// land stays open, voyages from the discoverers' landmass are more frequent,
// sail far enough to reach it, prefer it, and lose fewer ships on the way:
// waves of settlement rather than one-offs.
//
// Decisions draw from the 'history-voyages' stream only.

import { Biome, JourneyKind } from '../../contract.ts'
import type { Rng } from '../rng.ts'
import { clamp, MinHeap, smoothstep } from '../util.ts'
import { MIGRATION, VOYAGE } from './params.ts'
import { claimStrength } from './population.ts'
import { foodBase, prosperity } from './migration.ts'
import type { HistoryState } from './state.ts'
import { canSettle, found, logJourney } from './state.ts'
import type { VoyageLog } from './index.ts'

export interface VoyageState {
  rng: Rng
  dist: Float64Array
  stamp: Int32Array
  prev: Int32Array
  /** Landfall cells already judged in this search (stamp), and the sea cell they were first reached from. */
  seen: Int32Array
  heap: MinHeap
  run: number
  /** Habitable cells per landmass. */
  lmHab: Int32Array
  /** Year a landmass was first reached by a voyage, or -1. */
  knownSince: Int32Array
  /** Discoveries: sender landmass, discovered landmass, sea cost of the route. */
  discFrom: number[]
  discTo: number[]
  discCost: number[]
  /** Per landmass, this year's best known open target (cached per year): landmass and cost, -1 if none. */
  targetYear: Int32Array
  target: Int32Array
  targetCost: Float64Array
  /** Seaborne colonies still in their hard first years. */
  young: number[]
  /** Searches in a row that found no landfall, per settlement (each waits longer before trying again). */
  fails: Int32Array
  /** News per weather region: the last year a search from there found no landfall, and the largest range that failed since. */
  newsYear: Int32Array
  newsRange: Float64Array
  log: VoyageLog
}

export function createVoyages(s: HistoryState, rng: Rng): VoyageState {
  const T = s.terrain
  const N = T.cellCount
  const M = T.landmassSize.length
  const lmHab = new Int32Array(M)
  for (let i = 0; i < N; i++) if (T.habitable[i]) lmHab[T.landmass[i]]++
  return {
    rng,
    dist: new Float64Array(N),
    stamp: new Int32Array(N),
    prev: new Int32Array(N),
    seen: new Int32Array(N),
    heap: new MinHeap(1024),
    run: 0,
    lmHab,
    knownSince: new Int32Array(M).fill(-1),
    discFrom: [], discTo: [], discCost: [],
    targetYear: new Int32Array(M).fill(-1),
    target: new Int32Array(M).fill(-1),
    targetCost: new Float64Array(M),
    young: [],
    fails: new Int32Array(256),
    newsYear: new Int32Array(s.harvest.length).fill(-1000000),
    newsRange: new Float64Array(s.harvest.length),
    log: { year: [], from: [], outcome: [], port: [], senderPop: [], cost: [], seaCells: [], toLandmass: [], visits: [] },
  }
}

/** True while landmass m is worth sailing for: fewer settlements than max(3, habitable cells / openPer). */
function isOpen(s: HistoryState, vs: VoyageState, m: number): boolean {
  const cap = vs.lmHab[m] / VOYAGE.openPer
  return s.lmLiving[m] < (cap > 3 ? cap : 3)
}

/** Cheapest known open land discovered from landmass `from` (cached per year); sets vs.target / vs.targetCost[from]. */
function knownTarget(s: HistoryState, vs: VoyageState, from: number): number {
  if (vs.targetYear[from] === s.year) return vs.target[from]
  vs.targetYear[from] = s.year
  let best = -1, bestCost = 0
  for (let k = 0; k < vs.discFrom.length; k++) {
    if (vs.discFrom[k] !== from) continue
    const m = vs.discTo[k]
    if (!isOpen(s, vs, m)) continue
    if (best < 0 || vs.discCost[k] < bestCost) { best = m; bestCost = vs.discCost[k] }
  }
  vs.target[from] = best
  vs.targetCost[from] = bestCost
  return best
}

/** System (after migration): hard years of young colonies, then expeditions set out. */
export function voyageSystem(s: HistoryState, vs: VoyageState): void {
  const V = VOYAGE
  const rng = vs.rng
  // Hard first years of seaborne colonies.
  const young = vs.young
  let w = 0
  for (let t = 0; t < young.length; t++) {
    const id = young[t]
    if (s.abandoned[id] >= 0 || s.year - s.founded[id] > V.hardYears) continue
    young[w++] = id
    if (rng.next() < V.hardChance) s.pop[id] *= 1 - rng.range(V.hardMin, V.hardMax)
  }
  young.length = w

  if (vs.fails.length < s.count) {
    let size = vs.fails.length
    while (size < s.count) size *= 2
    const a = new Int32Array(size)
    a.set(vs.fails)
    vs.fails = a
  }
  const T = s.terrain
  const living = s.living
  const n0 = living.length // colonies founded below wait a year
  for (let t = 0; t < n0; t++) {
    const id = living[t]
    const c = s.cell[id]
    const p = s.pop[id]
    if (!T.seaCoast[c] || p < V.minPop || s.founded[id] >= s.year || s.year < s.nextVoyage[id]) continue
    const hasPort = s.port[id] >= 0
    const pressure = smoothstep(MIGRATION.pressureLow, MIGRATION.pressureHigh, p / foodBase(s, id))
    const f = prosperity(s, id)
    const known = knownTarget(s, vs, T.landmass[c])
    const chance = (hasPort ? V.portChance : V.coastChance) * (V.drive0 + (1 - V.drive0) * pressure) * (1 + V.wealthChance * f) * (known >= 0 ? 1 + V.knownBoost : 1)
    if (rng.next() >= chance) continue
    voyage(s, vs, id, hasPort, f, known)
  }
}

/** After finding nowhere to go: wait retry years times the number of such searches in a row (at most retryMax of them). */
function retryLater(s: HistoryState, vs: VoyageState, from: number): void {
  const k = vs.fails[from] < VOYAGE.retryMax ? ++vs.fails[from] : VOYAGE.retryMax
  s.nextVoyage[from] = s.year + VOYAGE.retry * k
}

/** One expedition from settlement `from`. */
function voyage(s: HistoryState, vs: VoyageState, from: number, hasPort: boolean, f: number, known: number): void {
  const V = VOYAGE
  const T = s.terrain
  const rng = vs.rng
  const prod = s.productivity
  const p = s.pop[from]
  const origin = s.cell[from]
  const originLm = T.landmass[origin]
  const biome = s.world.biome
  let g = Math.floor(p * rng.range(V.groupMin, V.groupMax))
  if (g < V.groupLow) g = V.groupLow
  if (g > V.groupHigh) g = V.groupHigh
  if (g > p - 2 * MIGRATION.minGroup) g = Math.floor(p - 2 * MIGRATION.minGroup)
  let range = (hasPort ? V.portRange : V.coastRange) * (1 + V.rangeTech * (prod - 1)) * (1 + V.wealthRange * f) *
    (1 + V.sizeRange * smoothstep(V.sizeLow, V.sizeHigh, p)) * rng.range(V.jitterMin, V.jitterMax)
  if (rng.next() < V.boldChance) range *= V.boldRange // now and then a bold captain sails much further
  if (known >= 0) {
    const want = 1.1 * vs.targetCost[originLm]
    const cap = V.knownRangeMax * range
    if (want > range) range = want < cap ? want : cap
  }
  range *= T.cellScale
  // News: if a voyage from this region found nothing within about this range lately, nobody sails.
  const region = s.weatherRegion[origin]
  const fresh = s.year - vs.newsYear[region] < V.newsYears
  if (fresh && range <= V.newsMargin * vs.newsRange[region]) {
    retryLater(s, vs, from)
    return
  }
  const shallowCost = T.cellScale
  const deepCost = (hasPort ? V.deepPort : V.deep) * T.cellScale
  const minFood = MIGRATION.foundMinRatio * g
  const st = claimStrength(g)

  const { dist, stamp, prev, seen, heap } = vs
  const run = ++vs.run
  heap.size = 0
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  dist[origin] = 0
  stamp[origin] = run
  heap.push(0, origin)
  let bestScore = 0, bestCell = -1, bestDist = 0
  let visits = 0, candidates = 0
  while (heap.size > 0 && visits < V.maxVisits && candidates < V.maxCandidates) {
    const d = heap.topKey()
    const c = heap.pop()
    if (d > dist[c]) continue
    visits++
    const fromSea = c !== origin
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (!T.sea[j]) {
        // A landfall: judged once, from the nearest sea cell that reaches it.
        if (!fromSea || seen[j] === run) continue
        seen[j] = run
        prev[j] = c
        if (!canSettle(s, j) || T.potential[j] * prod < minFood) continue
        // What the group could expect here, and what the land would give it alone.
        let food = 0, alone = 0
        for (let e = T.catchOff[j]; e < T.catchBase[j]; e++) {
          const q = T.catchCell[e]
          const cw = T.catchW[e]
          const wg = cw * st
          const cap = s.effCap[q] * cw
          food += (cap * wg) / (s.claim[q] + wg)
          alone += cap
        }
        food *= prod
        alone *= prod
        if (food < minFood || food < V.freeMin * alone) continue
        const free = food / alone
        const m = T.landmass[j]
        candidates += m === originLm ? V.homeCount : 1
        let value = food * free
        if (T.river[j]) value *= 1 + V.riverMouth
        if (m !== originLm) value *= 1 + V.otherLand
        if (s.lmLiving[m] === 0) value *= 1 + V.emptyLand
        if (m === known) value *= 1 + V.knownPref
        const score = (value * rng.range(0.75, 1.25)) / (1 + (V.costPenalty * d) / range)
        if (score > bestScore) { bestScore = score; bestCell = j; bestDist = d }
        continue
      }
      if (biome[j] === Biome.Ice) continue
      const nd = d + (T.deep[j] ? deepCost : shallowCost)
      if (nd > range) continue
      if (stamp[j] === run && nd >= dist[j]) continue
      stamp[j] = run
      dist[j] = nd
      prev[j] = c
      heap.push(nd, j)
    }
  }

  const log = vs.log
  log.year.push(s.year)
  log.from.push(from)
  log.port.push(hasPort ? 1 : 0)
  log.senderPop.push(p)
  log.visits.push(visits)
  if (bestCell < 0) {
    // Nowhere worth going: the expedition never sails; try again in a while (longer after each such search).
    retryLater(s, vs, from)
    vs.newsRange[region] = fresh && vs.newsRange[region] > range ? vs.newsRange[region] : range
    vs.newsYear[region] = s.year
    log.outcome.push(0); log.cost.push(0); log.seaCells.push(0); log.toLandmass.push(-1)
    return
  }
  // The route: origin, sea cells, landfall.
  const path: number[] = [bestCell]
  for (let c = bestCell; c !== origin; ) { c = prev[c]; path.push(c) }
  path.reverse()
  let deepCells = 0
  for (let k = 1; k + 1 < path.length; k++) if (T.deep[path[k]]) deepCells++
  const toLm = T.landmass[bestCell]
  const knownRoute = vs.knownSince[toLm] >= 0
  let hazard = V.lossBase + (V.lossDeep * deepCells * T.cellScale) / (1 + V.lossTech * (prod - 1))
  if (knownRoute) hazard *= V.knownSafe
  const lost = rng.next() < 1 - 1 / (1 + hazard)
  const attrition = rng.range(0, V.attrition) * (bestDist / range)
  s.pop[from] -= g
  log.cost.push(bestDist / T.cellScale)
  log.seaCells.push(path.length - 2)
  log.toLandmass.push(toLm)
  if (lost) {
    s.nextVoyage[from] = s.year + V.retryLost
    log.outcome.push(2)
    return
  }
  let landed = Math.floor(g * (1 - attrition))
  if (landed < MIGRATION.minGroup) landed = MIGRATION.minGroup
  const firstLanding = s.lmLiving[toLm] === 0 && toLm !== originLm
  const to = found(s, bestCell, landed, from)
  s.nextVoyage[from] = s.year + V.cooldown
  vs.fails[from] = 0
  vs.newsYear[region] = -1000000
  vs.young.push(to)
  if (firstLanding) {
    if (vs.knownSince[toLm] < 0) vs.knownSince[toLm] = s.year
    vs.discFrom.push(originLm)
    vs.discTo.push(toLm)
    vs.discCost.push(bestDist / T.cellScale)
    vs.targetYear[originLm] = -1 // re-evaluate known targets
  }
  log.outcome.push(1)
  const arriveYear = s.year
  const years = clamp(V.travelBase + V.travelPerCell * path.length, V.travelBase, V.travelMax)
  const departYear = Math.max(s.founded[from], arriveYear - years)
  logJourney(s, { departYear, arriveYear, from, to, size: landed, kind: JourneyKind.Settlers, path })
}
