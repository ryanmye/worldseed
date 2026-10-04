// Voyages of settlement: colonising expeditions by sea.
//
// Each year every coastal settlement of some size may fit out an expedition:
// without a port mostly early on and over shorter ranges (the chance fades
// and the range grows slowly with technology), more often and further with
// one, more often under population
// pressure, when rich or large, and when a known, still open land was found
// from its landmass. Its range (in sea-cost units: a shallow cell costs 1,
// open ocean more, less from a port) grows with technology (the productivity
// curve), the sender's wealth and its size, and now and then a bold captain
// sails much further; so early boats hop along coasts and to offshore
// islands, later ones cross straits and narrow seas, and rich port cities
// late in the run cross open ocean. The expedition searches outward over the
// sea (Dijkstra over integer costs with a bucket queue; sea ice is
// impassable) for landfalls: free habitable coast that leaves the group most
// of what the land would give it alone, judged on what the settlers could
// expect there (as land migrants judge sites), better at river mouths, on
// sheltered (shallow-water) shores, on another landmass, on an empty one and
// on a land known to be open; nearer landfalls score higher. The first few
// acceptable landfalls bound the search (those on the home landmass count for
// less). A search that finds nowhere to go makes the settlement wait (longer
// after each such search) and spreads the news through its weather region:
// for a while nobody there sails unless they can sail clearly further.
//
// Risk: an expedition may be lost at sea (more likely the more open ocean it
// crosses, less with technology and on a route its people has sailed before),
// and the survivors who land have lost some of their number. A lost
// expedition founds nothing and logs VoyageLost. A colony that lands lives
// through hard first years (occasional heavy losses), so some fail and are
// abandoned; the rest grow, spread by ordinary land migration, build ports
// and send voyages of their own.
//
// Exploration (knowledge.ts): an expedition explores at the edge of what its
// people knows. Everything its search covered (the sea it crossed and the
// coasts it sighted) becomes known to its people when it comes home or lands,
// whether or not it found a landfall (a lost one brings nothing back); one
// that lands has met the peoples whose settlements it sighted on its way (an
// expedition that found nowhere to go only brings back where they live).
//
// Known open land: the first landfall on a landmass with nobody on it records
// a discovery by the sender's people (from the sender's landmass, with the
// route's cost). While that land stays open, voyages of that people and of
// the peoples in contact with it (its network, who share what they know) from
// the discoverers' landmass are more frequent, sail far enough to reach it,
// prefer it, and lose fewer ships on the way: waves of settlement rather than
// one-offs. Other peoples have to find it for themselves.
//
// Decisions draw from the 'history-voyages' stream only.

import { Biome, EventType, JourneyKind, TechField } from '../../contract.ts'
import type { Rng } from '../rng.ts'
import { clamp, smoothstep } from '../util.ts'
import { MIGRATION, VOYAGE } from './params.ts'
import { claimStrength } from './population.ts'
import { foodBase, prosperity } from './migration.ts'
import type { HistoryState } from './state.ts'
import { canSettle, found, logEvent, logJourney, productivityOf, techOf } from './state.ts'
import { ContactVia, learn, learnPath, meet } from './knowledge.ts'
import type { VoyageLog } from './index.ts'

export interface VoyageState {
  rng: Rng
  dist: Float64Array
  stamp: Int32Array
  prev: Int32Array
  /** Landfall cells already judged in this search (stamp), and the sea cell they were first reached from. */
  seen: Int32Array
  /** Bucket queue over integer sea costs (one bucket per cost residue, more than the dearest step). */
  buckets: Int32Array[]
  bucketLen: Int32Array
  run: number
  /** Habitable cells per landmass, and the landmass count M. */
  lmHab: Int32Array
  M: number
  /** Year each people first landed a colony on each landmass by sea, or -1: landed[people * M + landmass]. */
  landed: Int32Array
  /** Discoveries: discovering people, sender landmass, discovered landmass, sea cost of the route. */
  discPeople: number[]
  discFrom: number[]
  discTo: number[]
  discCost: number[]
  /** Per people and sender landmass (people * M + landmass), this year's best known open target (cached per year): landmass and cost, -1 if none. */
  targetYear: Int32Array
  target: Int32Array
  targetCost: Float64Array
  /** Sea cells a search visited and coast cells it sighted (judged as landfalls), and settlements of unmet peoples it sighted. */
  visited: Int32Array
  coast: Int32Array
  sighted: number[]
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
  const P = s.know.P
  const lmHab = new Int32Array(M)
  for (let i = 0; i < N; i++) if (T.habitable[i]) lmHab[T.landmass[i]]++
  // Steps cost at most this many tenths (see voyage), so this many buckets never wrap onto the one being emptied.
  const maxStep = Math.max(1, Math.round(10 * T.cellScale * Math.max(1, VOYAGE.deep, VOYAGE.deepPort)))
  const buckets: Int32Array[] = []
  for (let b = 0; b <= maxStep; b++) buckets.push(new Int32Array(64))
  return {
    rng,
    dist: new Float64Array(N),
    stamp: new Int32Array(N),
    prev: new Int32Array(N),
    seen: new Int32Array(N),
    buckets, bucketLen: new Int32Array(buckets.length),
    run: 0,
    lmHab, M,
    landed: new Int32Array(P * M).fill(-1),
    discPeople: [], discFrom: [], discTo: [], discCost: [],
    targetYear: new Int32Array(P * M).fill(-1),
    target: new Int32Array(P * M).fill(-1),
    targetCost: new Float64Array(P * M),
    visited: new Int32Array(N),
    coast: new Int32Array(N),
    sighted: [],
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

/**
 * Cheapest open land discovered from landmass `from` by people p or a people in its network
 * (cached per people and landmass per year); sets vs.target / vs.targetCost[p * M + from].
 */
function knownTarget(s: HistoryState, vs: VoyageState, p: number, from: number): number {
  const key = p * vs.M + from
  if (vs.targetYear[key] === s.year) return vs.target[key]
  vs.targetYear[key] = s.year
  const net = s.know.net
  const n = net[p]
  let best = -1, bestCost = 0
  for (let k = 0; k < vs.discFrom.length; k++) {
    if (vs.discFrom[k] !== from || net[vs.discPeople[k]] !== n) continue
    const m = vs.discTo[k]
    if (!isOpen(s, vs, m)) continue
    if (best < 0 || vs.discCost[k] < bestCost) { best = m; bestCost = vs.discCost[k] }
  }
  vs.target[key] = best
  vs.targetCost[key] = bestCost
  return best
}

/** The old rule, for the knowledge diagnostics: cheapest open land anyone discovered from landmass `from`. */
function anyoneTarget(s: HistoryState, vs: VoyageState, from: number): number {
  let best = -1, bestCost = 0
  for (let k = 0; k < vs.discFrom.length; k++) {
    if (vs.discFrom[k] !== from) continue
    const m = vs.discTo[k]
    if (!isOpen(s, vs, m)) continue
    if (best < 0 || vs.discCost[k] < bestCost) { best = m; bestCost = vs.discCost[k] }
  }
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
  const maxMul = (1 + V.wealthChance) * (1 + V.sizeChance) * (1 + V.knownBoost) // largest drive * wealth * size * knowledge factor
  for (let t = 0; t < n0; t++) {
    const id = living[t]
    const c = s.cell[id]
    const p = s.pop[id]
    if (!T.seaCoast[c] || p < V.minPop || s.founded[id] >= s.year || s.year < s.nextVoyage[id]) continue
    const hasPort = s.port[id] >= 0
    const base = hasPort ? V.portChance : V.coastChance / (1 + V.coastFade * (techOf(s, id, TechField.Seafaring) - 1))
    const roll = rng.next()
    if (roll >= base * maxMul) continue // (no chance this year whatever the drive)
    const pressure = smoothstep(MIGRATION.pressureLow, MIGRATION.pressureHigh, p / foodBase(s, id))
    const f = prosperity(s, id)
    const known = knownTarget(s, vs, s.people[id], T.landmass[c])
    const chance = base * (V.drive0 + (1 - V.drive0) * pressure) * (1 + V.wealthChance * f) * (1 + V.sizeChance * smoothstep(V.sizeLow, V.sizeHigh, p)) *
      (known >= 0 ? 1 + V.knownBoost : 1)
    if (roll >= chance) continue
    const kd = s.knowDiag
    if (kd) {
      kd.voyages++
      if (anyoneTarget(s, vs, T.landmass[c]) !== known) kd.voyTargetDiffers++
    }
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
  const prod = productivityOf(s, from) // (what the land would yield the settlers)
  const sea = techOf(s, from, TechField.Seafaring) // (how far and how safely they sail)
  const p = s.pop[from]
  const origin = s.cell[from]
  const originLm = T.landmass[origin]
  const people = s.people[from]
  const tKey = people * vs.M + originLm
  const biome = s.world.biome
  let g = Math.floor(p * rng.range(V.groupMin, V.groupMax))
  if (g < V.groupLow) g = V.groupLow
  if (g > V.groupHigh) g = V.groupHigh
  if (g > p - 2 * MIGRATION.minGroup) g = Math.floor(p - 2 * MIGRATION.minGroup)
  let range = (hasPort ? V.portRange : V.coastRange) * (1 + (hasPort ? V.rangeTech : V.coastTech) * (sea - 1)) * (1 + V.wealthRange * f) *
    (1 + V.sizeRange * smoothstep(V.sizeLow, V.sizeHigh, p)) * rng.range(V.jitterMin, V.jitterMax)
  if (rng.next() < V.boldChance) range *= V.boldRange // now and then a bold captain sails much further
  if (known >= 0) {
    const want = 1.1 * vs.targetCost[tKey]
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
  // Sea costs in integer tenths (exact sums), searched with a bucket queue: Dijkstra order, ties in insertion order.
  const stepS = Math.max(1, Math.round(10 * T.cellScale))
  const stepD = Math.max(1, Math.round(10 * (hasPort ? V.deepPort : V.deep) * T.cellScale))
  const rangeI = Math.floor(10 * range)
  const minFood = MIGRATION.foundMinRatio * g
  const st = claimStrength(g)

  const { dist, stamp, prev, seen, buckets, bucketLen, visited, coast, sighted } = vs
  let nVisited = 0, nCoast = 0
  sighted.length = 0
  const B = buckets.length
  const run = ++vs.run
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  dist[origin] = 0
  stamp[origin] = run
  bucketLen.fill(0)
  buckets[0][0] = origin
  bucketLen[0] = 1
  let pending = 1
  let bestScore = 0, bestCell = -1, bestDist = 0
  let visits = 0, candidates = 0
  search: for (let cur = 0; pending > 0 && cur <= rangeI; cur++) {
    const b = cur % B
    const items = buckets[b]
    for (let i = 0; i < bucketLen[b]; i++) {
      const c = items[i]
      pending--
      if (dist[c] !== cur) continue // improved since it was queued
      if (visits >= V.maxVisits || candidates >= V.maxCandidates) break search
      visits++
      visited[nVisited++] = c
      const fromSea = c !== origin
      const d = cur * 0.1
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (!T.sea[j]) {
          // A landfall: judged once, from the nearest sea cell that reaches it.
          if (!fromSea || seen[j] === run) continue
          seen[j] = run
          prev[j] = c
          coast[nCoast++] = j
          const occ = s.occupant[j]
          if (occ >= 0 && s.people[occ] !== people && sighted.indexOf(occ) < 0) sighted.push(occ)
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
          if (!T.deep[c]) value *= 1 + V.sheltered // reached over shallow water: a sheltered shore
          if (m !== originLm) value *= 1 + V.otherLand
          if (s.lmLiving[m] === 0) value *= 1 + V.emptyLand
          if (m === known) value *= 1 + V.knownPref
          const score = (value * rng.range(0.75, 1.25)) / (1 + (V.costPenalty * d) / range)
          if (score > bestScore) { bestScore = score; bestCell = j; bestDist = d }
          continue
        }
        if (biome[j] === Biome.Ice) continue
        const nd = cur + (T.deep[j] ? stepD : stepS)
        if (nd > rangeI) continue
        if (stamp[j] === run && nd >= dist[j]) continue
        stamp[j] = run
        dist[j] = nd
        prev[j] = c
        const nbk = nd % B
        let arr = buckets[nbk]
        if (bucketLen[nbk] === arr.length) {
          const a = new Int32Array(arr.length * 2)
          a.set(arr)
          buckets[nbk] = arr = a
        }
        arr[bucketLen[nbk]++] = j
        pending++
      }
    }
    bucketLen[b] = 0
  }

  const log = vs.log
  log.year.push(s.year)
  log.from.push(from)
  log.port.push(hasPort ? 1 : 0)
  log.senderPop.push(p)
  log.visits.push(visits)
  if (bestCell < 0) {
    // Nowhere worth going: the expedition comes home with what it saw; try again in a while (longer after each such search).
    explored(s, vs, from, nVisited, nCoast, false)
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
  const shallowCells = path.length - 2 - deepCells
  const toLm = T.landmass[bestCell]
  // A known route: a people of the sender's network has landed a colony on that landmass before.
  let knownRoute = false
  const net = s.know.net
  for (let q = 0; q < s.know.P; q++) if (net[q] === net[people] && vs.landed[q * vs.M + toLm] >= 0) { knownRoute = true; break }
  let hazard = ((V.lossShallow * shallowCells + V.lossDeep * deepCells) * T.cellScale) / (1 + V.lossTech * (sea - 1))
  if (knownRoute) hazard *= V.knownSafe
  const lost = rng.next() < 1 - 1 / (1 + hazard)
  const attrition = rng.range(0, V.attrition) * (bestDist / range)
  s.pop[from] -= g
  s.voyageAcc[people] += 1 // (Seafaring learns from voyages made, technology.ts)
  log.cost.push(bestDist / T.cellScale)
  log.seaCells.push(path.length - 2)
  log.toLandmass.push(toLm)
  if (lost) {
    s.nextVoyage[from] = s.year + V.retryLost
    logEvent(s, EventType.VoyageLost, from, -1, g)
    log.outcome.push(2)
    return
  }
  let landed = Math.floor(g * (1 - attrition))
  if (landed < MIGRATION.minGroup) landed = MIGRATION.minGroup
  const firstLanding = s.lmLiving[toLm] === 0 && toLm !== originLm
  explored(s, vs, from, nVisited, nCoast, true) // (before the colony looks around: the crew saw it all on the way)
  const to = found(s, bestCell, landed, from)
  if (vs.landed[people * vs.M + toLm] < 0) vs.landed[people * vs.M + toLm] = s.year
  s.nextVoyage[from] = s.year + V.cooldown
  vs.fails[from] = 0
  vs.newsYear[region] = -1000000
  vs.young.push(to)
  if (firstLanding) {
    vs.discPeople.push(people)
    vs.discFrom.push(originLm)
    vs.discTo.push(toLm)
    vs.discCost.push(bestDist / T.cellScale)
    vs.targetYear.fill(-1) // re-evaluate known targets
  }
  log.outcome.push(1)
  const arriveYear = s.year
  const years = clamp(V.travelBase + V.travelPerCell * path.length, V.travelBase, V.travelMax)
  const departYear = Math.max(s.founded[from], arriveYear - years)
  logJourney(s, { departYear, arriveYear, from, to, size: landed, kind: JourneyKind.Settlers, path })
  learnPath(s, to, path, true)
}

/**
 * An expedition that came back or landed: its people learns the sea its search covered and the coasts
 * it sighted (strangers' towns included); one that landed has also met the strangers it saw on the way.
 */
function explored(s: HistoryState, vs: VoyageState, from: number, nVisited: number, nCoast: number, landed: boolean): void {
  const p = s.people[from]
  const known = s.know.known, base = p * s.know.N, fresh = s.know.fresh[p], year = s.year
  const { visited, coast } = vs
  for (let i = 0; i < nVisited; i++) { const c = visited[i]; if (known[base + c] < 0) { known[base + c] = year; fresh.push(c) } } // (learn, inlined)
  for (let i = 0; i < nCoast; i++) learn(s, p, coast[i])
  const sighted = vs.sighted
  if (s.knowDiag && sighted.length > 0) s.knowDiag.voySightings++
  if (landed) for (let i = 0; i < sighted.length; i++) if (s.abandoned[sighted[i]] < 0) meet(s, from, sighted[i], ContactVia.Voyage)
}
