// Exploration: expeditions and expedition bases.
//
// The urge to explore: a settlement whose daily needs are met (fed this year
// and free of famine for decades, and a town, or wealthy, or a prosperous
// port) builds up an urge each year, faster the more prosperous it is and the
// more advanced its people (Seafaring for a coastal one, else Crafts). Hungry
// or poor settlements lose it. When the urge is full the settlement fits out
// an expedition: a few dozen people, paid for out of its wealth. This is not
// colonisation: explorers seek the unknown, not farmland.
//
// The expedition (by sea from a coast, more often from a port, else overland)
// searches outward over true terrain within a range that grows with its
// people's technology and the sender's prosperity (land: rough ground, desert,
// mountains and ice are dear; at sea, open ocean; sea ice can be walked;
// landing parties go ashore at a cost); the sender's own expedition bases are
// waypoints the search also starts from, so exploration proceeds in stages. It
// heads for the reached cell its people does not know with the most unknown
// cells on the way there, preferring the far north and south, ice, deserts,
// mountains, unknown coasts and far ocean. If too little is unknown within
// reach, it does not set out and the settlement waits. On the way it may be
// lost (more likely over ice, desert, mountains and open ocean, less with
// technology; VoyageLost at sea, nothing at all on land: nothing it saw comes
// home). Otherwise its people learns the way out and the cells within
// EXPLORE.margin of it, meets the peoples whose settlements it passed, and the
// sender gains prestige and wealth, so success encourages more.
//
// Expedition bases: an expedition that survives may leave a base (an outpost:
// Settlement.outpost) at the best site in land nobody could farm on the far
// half of its way: polar coasts and ice margins, deserts, mountains, remote
// islands, places near ore, salt or (in the far north) furs and ivory. A base
// has a few dozen people, does not farm, trade, grow or migrate, and looks
// around like any settlement (so it keeps its surroundings known, sees
// further, and may be where two peoples first meet). Its parent supplies it
// every year at a cost growing with the people there and the route's length
// (cheaper with Crafts), and gets a little back from nearby ore, salt or furs.
// It is abandoned when its parent is abandoned, cannot pay, is no longer
// prosperous or goes hungry for years, or its route has grown beyond the parent's reach. Bases never become
// ordinary settlements (they stand only where nobody could farm).
//
// Species (species.ts): an expedition that comes home may bring wild plants and
// animals it saw on the way, and those of peoples it met, where they would grow.
//
// Discovery: the first expedition to reach a notable place logs it: each pole,
// each sizeable landmass nobody had seen and nobody lives on, the world's
// highest summit and the heart of its largest desert.
//
// Draws come from the 'history-expeditions' stream only.

import { Biome, EventType, JourneyKind, TechField } from '../../contract.ts'
import type { Rng } from '../rng.ts'
import { clamp, smoothstep } from '../util.ts'
import { EXPEDITION_COST, EXPLORE, OUTPOST, POPULATION } from './params.ts'
import { prosperity } from './migration.ts'
import type { HistoryState } from './state.ts'
import { abandon, found, logEvent, logJourney, techOf } from './state.ts'
import { ContactVia, learnPath } from './knowledge.ts'
import { speciesExpedition } from './species.ts'
import { expeditionFinds } from './goods/deposits.ts' // goods:

/** Notable places (Discovery): kind of a discovery record. */
export const Place = {
  NorthPole: 0,
  SouthPole: 1,
  Landmass: 2,
  Summit: 3,
  Desert: 4,
} as const
export type Place = (typeof Place)[keyof typeof Place]

/** Expedition records for the stats harness. */
export interface ExpeditionLog {
  year: number[]
  from: number[]
  senderPop: number[]
  senderWealth: number[]
  senderProsperity: number[]
  /** 1 by sea. */
  sea: number[]
  /** 0 came home, 1 founded a base, 2 lost. */
  outcome: number[]
  /** Cells newly known to the sender's people. */
  cells: number[]
  /** Farthest cell reached. */
  far: number[]
  /** Technology driving it (Seafaring or Crafts). */
  tech: number[]
}

export interface ExploreState {
  rng: Rng
  // Per settlement.
  urge: Float64Array
  nextTry: Int32Array
  /** Searches in a row that found nothing worth the trip. */
  fails: Int32Array
  /** Per weather region and people: the last year a search from there found nothing worth the trip, and the largest such range since. */
  newsYear: Int32Array
  newsRange: Float64Array
  /** Bases: years in a row the parent failed them, yearly supply cost per unit of (people / Crafts factor), yearly yield, route cost; per parent: living bases. */
  strikes: Int32Array
  routeCost: Float64Array
  yieldOf: Float64Array
  bases: Int32Array
  /** 1 for a base founded by a sea expedition (its route is reckoned by sea). */
  bySea: Uint8Array
  /** Each base's route from its parent's cell (lookup only). */
  route: Map<number, number[]>
  // Static per cell.
  /** Expedition cost of entering each cell overland and by sea (-1: impassable), scaled by the grid. */
  costLand: Float64Array
  costSea: Float64Array
  hazard: Float64Array
  /** Searches made (diagnostics), and those that found nothing worth the trip. */
  searches: number
  fruitless: number
  /** Bit 1: north pole region, 2: south pole region, 4: by the highest summit, 8: by the heart of the largest desert. */
  mark: Uint8Array
  summit: number
  desertHeart: number
  /** Weather regions: cells (CSR) and neighbouring regions (CSR, the region itself first). */
  regOff: Int32Array
  regCell: Int32Array
  regNbOff: Int32Array
  regNb: Int32Array
  /** Per people and region: cells unknown to the people at the last count, and the year of that count (-1: never). */
  unknownCount: Int32Array
  unknownYear: Int32Array
  /** Landmass cells, CSR (to tell whether anyone knew a landmass). */
  lmOff: Int32Array
  lmCell: Int32Array
  lmChecked: Uint8Array
  minLandmass: number
  reached: Uint8Array
  // Search.
  /** The same costs in whole tenths (at least 1; -1 impassable), for the search. */
  stepLand: Int32Array
  stepSea: Int32Array
  dist: Int32Array
  prev: Int32Array
  stamp: Int32Array
  src: Int32Array
  unk: Int32Array
  run: number
  buckets: Int32Array[]
  bucketLen: Int32Array
  marginHops: number
  maxAlive: number
  // Records.
  log: ExpeditionLog
  /** Discoveries: event index in s.events, place kind, cell. */
  discEvent: number[]
  discKind: number[]
  discCell: number[]
  /** Year an expedition first revealed each cell that nobody knew before, -1 otherwise (diagnostics). */
  revealed: Int16Array
}

export function createExplore(s: HistoryState, rng: Rng): ExploreState {
  const T = s.terrain
  const w = s.world
  const N = T.cellCount
  const { neighborOffsets: off, neighbors: nb } = w.grid
  const E = EXPEDITION_COST
  const X = EXPLORE
  const costLand = new Float64Array(N)
  const costSea = new Float64Array(N)
  const hazard = new Float64Array(N)
  const mark = new Uint8Array(N)
  const P = w.grid.positions
  let summit = -1
  for (let i = 0; i < N; i++) {
    const b = w.biome[i]
    const e = w.elevation[i]
    const y = P[i * 3 + 1]
    if (y >= 0.995) mark[i] |= 1
    else if (y <= -0.995) mark[i] |= 2
    if (T.sea[i]) {
      hazard[i] = b === Biome.Ice ? X.hazardIce : T.deep[i] ? X.hazardDeep : X.hazardShallow
      if (b === Biome.Ice) { costLand[i] = costSea[i] = E.biome[Biome.Ice] * T.cellScale; continue } // sea ice is walked
      costLand[i] = -1
      costSea[i] = (T.deep[i] ? E.deep : E.shallow) * T.cellScale
      continue
    }
    costLand[i] = (w.lake[i] ? E.lake : E.biome[b] + E.highland * smoothstep(0.3, 0.7, e)) * T.cellScale
    costSea[i] = costLand[i] * E.landing // landing parties
    hazard[i] = b === Biome.Ice ? X.hazardIce : b === Biome.Desert ? X.hazardDesert : b === Biome.Mountain ? X.hazardMountain : b === Biome.Tundra ? X.hazardCold : X.hazardLand
    if (!w.lake[i] && (summit < 0 || e > w.elevation[summit])) summit = i
  }
  // The heart of the largest desert: its cell farthest (in hops) from any other land.
  const comp = new Int32Array(N).fill(-1)
  const queue = new Int32Array(N)
  let bestComp = -1, bestSize = 0
  for (let i = 0; i < N; i++) {
    if (comp[i] >= 0 || T.sea[i] || w.biome[i] !== Biome.Desert) continue
    let head = 0, tail = 0
    queue[tail++] = i
    comp[i] = i
    while (head < tail) {
      const c = queue[head++]
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (comp[j] < 0 && !T.sea[j] && w.biome[j] === Biome.Desert) { comp[j] = i; queue[tail++] = j }
      }
    }
    if (tail > bestSize) { bestSize = tail; bestComp = i }
  }
  let desertHeart = -1
  if (bestComp >= 0) {
    const depth = new Int32Array(N).fill(-1)
    let head = 0, tail = 0
    for (let i = 0; i < N; i++) {
      if (comp[i] !== bestComp) continue
      let edge = false
      for (let k = off[i]; k < off[i + 1]; k++) if (comp[nb[k]] !== bestComp) edge = true
      if (edge) { depth[i] = 0; queue[tail++] = i }
    }
    while (head < tail) {
      const c = queue[head++]
      if (desertHeart < 0 || depth[c] > depth[desertHeart]) desertHeart = c
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (comp[j] === bestComp && depth[j] < 0) { depth[j] = depth[c] + 1; queue[tail++] = j }
      }
    }
  }
  const near = (c: number, bit: number): void => {
    mark[c] |= bit
    for (let k = off[c]; k < off[c + 1]; k++) mark[nb[k]] |= bit
  }
  if (summit >= 0) near(summit, 4)
  if (desertHeart >= 0) near(desertHeart, 8)
  // Landmass cells (CSR).
  const M = T.landmassSize.length
  const lmOff = new Int32Array(M + 1)
  for (let i = 0; i < N; i++) if (T.landmass[i] >= 0) lmOff[T.landmass[i] + 1]++
  for (let m = 0; m < M; m++) lmOff[m + 1] += lmOff[m]
  const fill = lmOff.slice(0, M)
  const lmCell = new Int32Array(lmOff[M])
  for (let i = 0; i < N; i++) if (T.landmass[i] >= 0) lmCell[fill[T.landmass[i]]++] = i
  // Weather regions: their cells and which regions touch which.
  const R = s.harvest.length
  const region = s.weatherRegion
  const regOff = new Int32Array(R + 1)
  for (let i = 0; i < N; i++) regOff[region[i] + 1]++
  for (let r = 0; r < R; r++) regOff[r + 1] += regOff[r]
  const rfill = regOff.slice(0, R)
  const regCell = new Int32Array(N)
  for (let i = 0; i < N; i++) regCell[rfill[region[i]]++] = i
  const touch = new Uint8Array(R * R)
  for (let i = 0; i < N; i++) for (let k = off[i]; k < off[i + 1]; k++) touch[region[i] * R + region[nb[k]]] = 1
  const regNbOff = new Int32Array(R + 1)
  const regNbList: number[] = []
  for (let r = 0; r < R; r++) {
    regNbList.push(r)
    for (let q = 0; q < R; q++) if (q !== r && touch[r * R + q]) regNbList.push(q)
    regNbOff[r + 1] = regNbList.length
  }
  // Integer steps for the search, and enough buckets that the dearest never wraps onto the one being emptied.
  const toStep = (x: number): number => (x < 0 ? -1 : Math.max(1, Math.round(10 * x)))
  const stepLand = new Int32Array(N), stepSea = new Int32Array(N)
  let maxStep = 1
  for (let i = 0; i < N; i++) {
    stepLand[i] = toStep(costLand[i]); stepSea[i] = toStep(costSea[i])
    if (stepLand[i] > maxStep) maxStep = stepLand[i]
    if (stepSea[i] > maxStep) maxStep = stepSea[i]
  }
  const buckets: Int32Array[] = []
  for (let b = 0; b <= maxStep; b++) buckets.push(new Int32Array(32))
  const cap = 256
  const scale = N / 23042
  return {
    rng,
    urge: new Float64Array(cap),
    nextTry: new Int32Array(cap),
    fails: new Int32Array(cap),
    newsYear: new Int32Array(s.harvest.length * s.know.P).fill(-1000000),
    newsRange: new Float64Array(s.harvest.length * s.know.P),
    strikes: new Int32Array(cap),
    routeCost: new Float64Array(cap),
    yieldOf: new Float64Array(cap),
    bases: new Int32Array(cap),
    bySea: new Uint8Array(cap),
    route: new Map(),
    costLand, costSea, hazard, searches: 0, fruitless: 0, mark, summit, desertHeart,
    regOff, regCell, regNbOff, regNb: Int32Array.from(regNbList),
    unknownCount: new Int32Array(R * s.know.P), unknownYear: new Int32Array(R * s.know.P).fill(-1),
    lmOff, lmCell, lmChecked: new Uint8Array(M),
    minLandmass: Math.max(3, Math.round(8 * scale)),
    reached: new Uint8Array(5),
    stepLand, stepSea,
    dist: new Int32Array(N),
    prev: new Int32Array(N),
    stamp: new Int32Array(N),
    src: new Int32Array(N),
    unk: new Int32Array(N),
    run: 0,
    buckets, bucketLen: new Int32Array(buckets.length),
    marginHops: Math.max(1, Math.round((X.margin * T.n) / 48)),
    maxAlive: Math.max(4, Math.round(OUTPOST.maxAlive * scale)),
    log: { year: [], from: [], senderPop: [], senderWealth: [], senderProsperity: [], sea: [], outcome: [], cells: [], far: [], tech: [] },
    discEvent: [], discKind: [], discCell: [],
    revealed: new Int16Array(N).fill(-1),
  }
}

function ensureSettlements(es: ExploreState, count: number): void {
  if (count <= es.urge.length) return
  let size = es.urge.length
  while (size < count) size *= 2
  const f = (a: Float64Array): Float64Array => { const b = new Float64Array(size); b.set(a); return b }
  const i = (a: Int32Array): Int32Array => { const b = new Int32Array(size); b.set(a); return b }
  es.urge = f(es.urge)
  es.nextTry = i(es.nextTry)
  es.fails = i(es.fails)
  es.strikes = i(es.strikes)
  es.routeCost = f(es.routeCost)
  es.yieldOf = f(es.yieldOf)
  es.bases = i(es.bases)
  const u = new Uint8Array(size); u.set(es.bySea); es.bySea = u
}

/** Technology that drives a settlement's expeditions: Seafaring for a coastal one (if higher), else Crafts. (goods: exported for trade expeditions) */
export function driveTech(s: HistoryState, id: number): number {
  const cr = techOf(s, id, TechField.Crafts)
  if (!s.terrain.seaCoast[s.cell[id]]) return cr
  const se = techOf(s, id, TechField.Seafaring)
  return se > cr ? se : cr
}

/** Expedition range of settlement `id` by land or sea (cost units at this grid's scale), before the random factor. (goods: exported) */
export function rangeOf(s: HistoryState, id: number, sea: boolean, f: number): number {
  const X = EXPLORE
  const t = techOf(s, id, sea ? TechField.Seafaring : TechField.Crafts)
  return (sea ? X.seaRange : X.landRange) * (1 + X.rangeTech * (t - 1)) * (1 + X.wealthRange * f) * s.terrain.cellScale
}

/** System (after the milestones): bases are supplied (or abandoned); every EXPLORE.step years expeditions set out. */
export function explorationSystem(s: HistoryState, es: ExploreState): void {
  ensureSettlements(es, s.count)
  upkeep(s, es)
  const X = EXPLORE
  if (s.year % X.step !== 0) return
  const dt = X.step
  const living = s.living
  const n0 = living.length // (living does not change below: bases go to s.outposts)
  for (let t = 0; t < n0; t++) {
    const id = living[t]
    const p = s.pop[id]
    if (p < X.minPop || s.food[id] < X.minFood || s.year - s.lastFamine[id] < X.fedYears || s.year - s.founded[id] < X.minAge) {
      es.urge[id] *= 1 - X.hungerFade * dt // hungry or struggling: nobody thinks of exploring
      continue
    }
    const f = prosperity(s, id)
    const town = smoothstep(X.townLow, X.townHigh, p)
    const portF = s.port[id] >= 0 ? X.portSat * f : 0
    let sat = town > f ? town : f
    if (portF > sat) sat = portF
    if (sat > 1) sat = 1
    if (sat < X.satMin) { es.urge[id] *= 1 - X.fade * dt; continue }
    if (!frontier(s, es, id)) { es.urge[id] *= 1 - X.fade * dt; continue } // nothing unknown anywhere near: no urge
    es.urge[id] += dt * X.urge * sat * (1 + X.urgeTech * (driveTech(s, id) - 1))
    if (es.urge[id] < 1 || s.year < es.nextTry[id]) continue
    es.urge[id] = 0
    expedition(s, es, id, f)
  }
}

/**
 * True when the people of settlement `id` has something left to explore near it: an unknown cell in its weather
 * region or a neighbouring one (counts per people and region, refreshed every EXPLORE.countStep years).
 */
function frontier(s: HistoryState, es: ExploreState, id: number): boolean {
  const p = s.people[id]
  const r0 = s.weatherRegion[s.cell[id]]
  const R = es.regOff.length - 1
  const known = s.know.known, base = p * s.know.N
  for (let t = es.regNbOff[r0]; t < es.regNbOff[r0 + 1]; t++) {
    const r = es.regNb[t]
    const key = p * R + r
    if (es.unknownYear[key] < 0 || s.year - es.unknownYear[key] >= EXPLORE.countStep) {
      let n = 0
      for (let k = es.regOff[r]; k < es.regOff[r + 1]; k++) if (known[base + es.regCell[k]] < 0) n++
      es.unknownCount[key] = n
      es.unknownYear[key] = s.year
    }
    if (es.unknownCount[key] >= EXPLORE.minUnknown) return true
  }
  return false
}

/** Bases: the parent pays for supplies and gets the yield; a base whose parent is gone, failing or out of reach is abandoned. */
function upkeep(s: HistoryState, es: ExploreState): void {
  const O = OUTPOST
  const list = s.outposts
  let w = 0
  const check = s.year % O.checkStep === 0
  for (let t = 0; t < list.length; t++) {
    const id = list[t]
    const parent = s.parent[id]
    let keep = s.abandoned[parent] < 0
    if (keep) {
      const cost = (O.supply * s.pop[id] * es.routeCost[id]) / (1 + O.supplyTech * (techOf(s, parent, TechField.Crafts) - 1))
      if (s.food[parent] < O.parentFood || s.wealth[parent] < cost || prosperity(s, parent) < O.parentProsperity) {
        if (++es.strikes[id] >= O.strikes) keep = false
      } else {
        es.strikes[id] = 0
        s.wealth[parent] += es.yieldOf[id] - cost
        if (s.wealth[parent] < 0) s.wealth[parent] = 0
      }
      if (keep && check && es.routeCost[id] > O.reach * rangeOf(s, parent, es.bySea[id] === 1, prosperity(s, parent))) keep = false
    }
    if (keep) { list[w++] = id; continue }
    abandon(s, id)
    es.bases[parent]--
  }
  list.length = w
}

/** Target weight of an unknown cell: 1 plus bonuses for the far north and south, ice, desert, mountains, coasts and far ocean. */
function weight(s: HistoryState, c: number): number {
  const X = EXPLORE
  const T = s.terrain
  const b = s.world.biome[c]
  const y = s.world.grid.positions[c * 3 + 1]
  let w = 1
  if (y >= X.polarY || y <= -X.polarY) w += X.polarBonus
  if (b === Biome.Ice) w += X.iceBonus
  else if (b === Biome.Desert) w += X.desertBonus
  else if (b === Biome.Mountain) w += X.mountainBonus
  if (T.sea[c]) { if (T.deep[c] && b !== Biome.Ice) w += X.oceanBonus }
  else if (T.seaCoast[c]) w += X.coastBonus
  return w
}

/** Site value of cell c for a base (0 where none can stand), `along` its share of the way out. */
function siteValue(s: HistoryState, c: number, along: number): number {
  const O = OUTPOST
  const T = s.terrain
  const w = s.world
  if (T.sea[c] || w.lake[c] || T.habitable[c] || s.occupant[c] >= 0) return 0
  const b = w.biome[c]
  const y = w.grid.positions[c * 3 + 1]
  const polar = y >= O.polarY || y <= -O.polarY || b === Biome.Ice || b === Biome.Tundra
  let v = O.far * along
  if (polar) v += O.polar
  if (b === Biome.Desert) v += O.desert
  if (b === Biome.Mountain) v += O.mountain
  if (s.lmLiving[T.landmass[c]] === 0) v += O.island
  if (T.seaCoast[c]) v += O.coastal
  if (resourceYield(s, c) > 0) v += O.resource
  return v
}

/** What a base on cell c sends its parent a year: ore and salt nearby, furs and ivory in the far north. */
function resourceYield(s: HistoryState, c: number): number {
  const O = OUTPOST
  const T = s.terrain
  const w = s.world
  const { neighborOffsets: off, neighbors: nb } = w.grid
  let ore = T.ore[c], salt = T.salt[c]
  for (let k = off[c]; k < off[c + 1]; k++) { ore += T.ore[nb[k]]; salt += T.salt[nb[k]] }
  const y = w.grid.positions[c * 3 + 1]
  const b = w.biome[c]
  const furs = (y >= O.polarY || y <= -O.polarY) && (b === Biome.Tundra || b === Biome.Taiga || b === Biome.Ice) ? O.furs : 0
  return O.ore * ore + O.salt * salt + furs
}

/** One expedition from settlement `id` (prosperity f). */
function expedition(s: HistoryState, es: ExploreState, id: number, f: number): void {
  const X = EXPLORE
  const O = OUTPOST
  const T = s.terrain
  const rng = es.rng
  const origin = s.cell[id]
  const people = s.people[id]
  const port = s.port[id] >= 0
  const coastal = T.seaCoast[origin] === 1
  const sea = coastal && rng.next() < (port ? X.seaPort : X.seaCoast)
  const tech = techOf(s, id, sea ? TechField.Seafaring : TechField.Crafts)
  // From a port the sea is cheaper.
  const range = rangeOf(s, id, sea, f) * rng.range(X.jitterMin, X.jitterMax) * (sea && port ? EXPEDITION_COST.portRange : 1)
  const costOf = sea ? es.costSea : es.costLand
  const stepOf = sea ? es.stepSea : es.stepLand
  // News: a search from this weather region by this people found nothing lately within about this range: stay home.
  const nk = s.weatherRegion[origin] * s.know.P + people
  const nf = s.year - es.newsYear[nk] < X.newsYears
  if (nf && range <= X.newsMargin * es.newsRange[nk]) { es.nextTry[id] = s.year + X.retry; return }
  es.searches++

  // Search outward from home and from the sender's own bases: Dijkstra over integer tenths of cost with a
  // bucket queue (one bucket per cost residue, more than the dearest step), ties in insertion order.
  const { dist, prev, stamp, src, unk, buckets, bucketLen } = es
  const known = s.know.known, kBase = people * s.know.N
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const run = ++es.run
  const B = buckets.length
  const rangeI = Math.floor(10 * range)
  bucketLen.fill(0)
  let pending = 0
  const push = (c: number, d: number): void => {
    const bk = d % B
    let arr = buckets[bk]
    if (bucketLen[bk] === arr.length) { const a = new Int32Array(arr.length * 2); a.set(arr); buckets[bk] = arr = a }
    arr[bucketLen[bk]++] = c
    pending++
  }
  stamp[origin] = run; dist[origin] = 0; prev[origin] = -1; src[origin] = -1; unk[origin] = 0
  push(origin, 0)
  const outposts = s.outposts
  const d0 = Math.floor(10 * X.waypoint * range)
  for (let t = 0; t < outposts.length; t++) {
    const b = outposts[t]
    if (s.parent[b] !== id) continue
    const c = s.cell[b]
    if (stamp[c] === run && dist[c] <= d0) continue
    stamp[c] = run; dist[c] = d0; prev[c] = -1; src[c] = b; unk[c] = 0
    push(c, d0)
  }
  let best = -1, bestScore = 0, visits = 0
  search: for (let cur = 0; pending > 0 && cur <= rangeI; cur++) {
    const bk = cur % B
    const items = buckets[bk]
    for (let i = 0; i < bucketLen[bk]; i++) {
      const c = items[i]
      pending--
      if (dist[c] !== cur) continue // improved since it was queued
      if (visits >= X.maxVisits) break search
      visits++
      if (known[kBase + c] < 0 && unk[c] >= X.minUnknown) {
        const score = unk[c] * weight(s, c) * rng.range(0.7, 1.3)
        if (score > bestScore) { bestScore = score; best = c }
      }
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        const step = stepOf[j]
        if (step < 0) continue
        const nd = cur + step
        if (nd > rangeI || (stamp[j] === run && nd >= dist[j])) continue
        stamp[j] = run; dist[j] = nd; prev[j] = c; src[j] = src[c]
        unk[j] = unk[c] + (known[kBase + j] < 0 ? 1 : 0)
        push(j, nd)
      }
    }
    bucketLen[bk] = 0
  }
  if (best < 0) {
    // Nothing worth the trip within reach: wait, longer after each such search in a row.
    const k = es.fails[id] < X.retryMax ? ++es.fails[id] : X.retryMax
    es.nextTry[id] = s.year + X.retry * k
    es.fruitless++
    es.newsRange[nk] = nf && es.newsRange[nk] > range ? es.newsRange[nk] : range
    es.newsYear[nk] = s.year
    return
  }
  es.fails[id] = 0

  // The way out: home (through a base's route if it set out from one) to the farthest cell.
  const tail: number[] = []
  for (let c = best; c >= 0; c = prev[c]) tail.push(c)
  tail.reverse()
  const via = src[best]
  let out: number[]
  if (via >= 0) {
    const r = es.route.get(via) as number[]
    out = r.slice()
    for (let k = 1; k < tail.length; k++) out.push(tail[k])
  } else out = tail
  let g = Math.floor(s.pop[id] * X.groupShare)
  if (g < X.groupLow) g = X.groupLow
  if (g > X.groupHigh) g = X.groupHigh
  const cost = X.cost * g * (1 + out.length / X.costCells)
  if (s.wealth[id] < cost) { es.nextTry[id] = s.year + X.retry; return } // cannot afford it
  s.wealth[id] -= cost
  logEvent(s, EventType.ExpeditionSent, id, -1, g)
  const log = es.log
  log.year.push(s.year); log.from.push(id); log.senderPop.push(s.pop[id]); log.senderWealth.push(s.wealth[id] + cost); log.senderProsperity.push(f)
  log.sea.push(sea ? 1 : 0); log.far.push(best); log.tech.push(tech)

  // Hazard of the way out and back.
  let h = 0
  for (let k = 1; k < out.length; k++) h += es.hazard[out[k]]
  h = (h * T.cellScale * (1 + X.back)) / (1 + X.hazardTech * (tech - 1))
  const lost = rng.next() < 1 - 1 / (1 + h)
  const years = clamp(X.travelBase + X.travelPerCell * out.length, X.travelBase, X.travelMax)
  const departYear = Math.max(s.founded[id], s.year - years)
  if (lost) {
    // Lost somewhere on the way out (beyond halfway): nothing it saw comes home.
    s.pop[id] -= g
    if (sea) logEvent(s, EventType.VoyageLost, id, -1, g)
    const at = Math.max(1, Math.min(out.length, Math.floor(out.length * rng.range(0.5, 1)) + 1))
    logJourney(s, { departYear, arriveYear: s.year, from: id, to: -1, size: g, kind: JourneyKind.Expedition, path: out.slice(0, at) })
    log.outcome.push(2); log.cells.push(0)
    return
  }
  const back = Math.floor(g * (1 - rng.range(0, X.attrition) * (h / (1 + h))))
  s.pop[id] -= g - back

  // A base on the far part of the way: on it, or on land beside it (a shore it passed)?
  let base = -1, baseAt = -1, baseCell = -1
  if (s.outposts.length < es.maxAlive && es.bases[id] < O.perParent && rng.next() < O.chance) {
    let bestV = O.minValue
    const from = Math.floor(out.length * O.from)
    for (let k = out.length - 1; k >= from && k > 0; k--) {
      const c = out[k]
      const along = k / (out.length - 1)
      let v = siteValue(s, c, along)
      if (v > bestV) { bestV = v; baseAt = k; baseCell = c }
      if (!T.sea[c]) continue
      for (let e = off[c]; e < off[c + 1]; e++) {
        const j = nb[e]
        if (j === origin) continue
        v = siteValue(s, j, along)
        if (v > bestV) { bestV = v; baseAt = k; baseCell = j }
      }
    }
  }
  let path = out
  if (baseAt >= 0) {
    path = out.slice(0, baseAt + 1)
    if (path[baseAt] !== baseCell) path.push(baseCell)
  }

  // What they saw, and whom they met (before the base looks around: they saw it all on the way).
  const fresh = s.know.fresh[people]
  const fresh0 = fresh.length
  const cells = learnPath(s, id, path, true, es.marginHops, ContactVia.Expedition)
  if (s.goods !== null) expeditionFinds(s, s.goods, id, path) // goods: rare deposits seen on the way
  speciesExpedition(s, id, path) // (seed and stock brought home)
  firstSeen(s, es, fresh, fresh0)
  discoveries(s, es, id, path, fresh, fresh0)
  s.wealth[id] += X.prestige * cells
  es.urge[id] = X.successUrge

  if (baseAt >= 0) {
    const c = baseCell
    let bp = Math.floor(back * O.popShare)
    if (bp > O.pop) bp = O.pop
    if (bp > POPULATION.abandonPop && s.occupant[c] < 0) {
      s.pop[id] -= bp
      base = found(s, c, bp, id, true)
      ensureSettlements(es, s.count)
      es.bases[id]++
      es.strikes[base] = 0
      es.urge[base] = 0
      es.route.set(base, path)
      es.routeCost[base] = routeCostOf(path, costOf)
      es.bySea[base] = sea ? 1 : 0
      es.yieldOf[base] = resourceYield(s, c)
    }
  }
  logEvent(s, EventType.ExpeditionReturned, id, base, cells)
  if (base >= 0) logJourney(s, { departYear, arriveYear: s.year, from: id, to: base, size: g, kind: JourneyKind.Expedition, path })
  else {
    // Out and back the same way.
    const round = path.slice()
    for (let k = path.length - 2; k >= 0; k--) round.push(path[k])
    logJourney(s, { departYear, arriveYear: s.year, from: id, to: id, size: g, kind: JourneyKind.Expedition, path: round })
  }
  log.outcome.push(base >= 0 ? 1 : 0); log.cells.push(cells)
}

/**
 * goods: a base founded by another system (a mining camp at a deposit) is kept up like an expedition's: its route from
 * its parent along `path` (land), supplies and strikes, abandonment.
 */
export function registerBase(s: HistoryState, es: ExploreState, base: number, path: number[]): void {
  ensureSettlements(es, s.count)
  const parent = s.parent[base]
  es.bases[parent]++
  es.strikes[base] = 0
  es.urge[base] = 0
  es.route.set(base, path)
  es.routeCost[base] = routeCostOf(path, es.costLand)
  es.bySea[base] = 0
  es.yieldOf[base] = resourceYield(s, s.cell[base])
}

/** Expedition cost of a path from its first cell. */
function routeCostOf(path: readonly number[], costOf: Float64Array): number {
  let c = 0
  for (let k = 1; k < path.length; k++) { const x = costOf[path[k]]; c += x > 0 ? x : 0 }
  return c
}

/** Cells just learned that nobody knew before: first revealed by an expedition (diagnostics). */
function firstSeen(s: HistoryState, es: ExploreState, fresh: number[], from: number): void {
  const k = s.know
  const { known, N, P } = k
  for (let i = from; i < fresh.length; i++) {
    const c = fresh[i]
    let other = false
    for (let q = 0; q < P && !other; q++) if (known[q * N + c] >= 0 && known[q * N + c] < s.year) other = true
    if (!other && es.revealed[c] < 0) es.revealed[c] = s.year
  }
}

/** Discovery events for the notable places the expedition from `id` reached first. */
function discoveries(s: HistoryState, es: ExploreState, id: number, path: readonly number[], fresh: number[], from: number): void {
  const mark = es.mark
  let m = 0
  for (let k = 0; k < path.length; k++) m |= mark[path[k]]
  const place = (kind: Place, cell: number): void => {
    if (es.reached[kind]) return
    es.reached[kind] = 1
    es.discEvent.push(s.events.length)
    es.discKind.push(kind)
    es.discCell.push(cell)
    logEvent(s, EventType.Discovery, id, cell, -1) // discovery-cell: `other` is the cell reached
  }
  const at = (bit: number): number => { for (let k = 0; k < path.length; k++) if (mark[path[k]] & bit) return path[k]; return -1 }
  if (m & 1) place(Place.NorthPole, at(1))
  if (m & 2) place(Place.SouthPole, at(2))
  if (m & 4) place(Place.Summit, es.summit)
  if (m & 8) place(Place.Desert, es.desertHeart)
  // Landmasses nobody lives on and nobody had seen.
  const T = s.terrain
  const k = s.know
  const { known, N, P } = k
  const p = s.people[id]
  for (let i = from; i < fresh.length; i++) {
    const c = fresh[i]
    const lm = T.landmass[c]
    if (lm < 0 || es.lmChecked[lm] || s.lmEver[lm] || T.landmassSize[lm] < es.minLandmass) continue
    es.lmChecked[lm] = 1
    let seen = false
    for (let t = es.lmOff[lm]; t < es.lmOff[lm + 1] && !seen; t++) {
      const q0 = es.lmCell[t]
      for (let q = 0; q < P && !seen; q++) {
        const y = known[q * N + q0]
        if (y >= 0 && (q !== p || y < s.year)) seen = true
      }
    }
    if (seen) continue
    es.discEvent.push(s.events.length)
    es.discKind.push(Place.Landmass)
    es.discCell.push(c)
    logEvent(s, EventType.Discovery, id, landmassReached(s, path, lm, c), -1) // discovery-cell: where the way out touched the landmass
  }
}

/**
 * discovery-cell: the cell of landmass `lm` an expedition reached: the first cell of its way out on that landmass,
 * else the first beside the way, else `seen` (a cell of it within the expedition's sight margin).
 */
function landmassReached(s: HistoryState, path: readonly number[], lm: number, seen: number): number {
  const L = s.terrain.landmass
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  for (let k = 0; k < path.length; k++) if (L[path[k]] === lm) return path[k]
  for (let k = 0; k < path.length; k++) {
    const c = path[k]
    for (let e = off[c]; e < off[c + 1]; e++) if (L[nb[e]] === lm) return nb[e]
  }
  return seen
}
