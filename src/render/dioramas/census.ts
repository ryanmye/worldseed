// The population convention of the close-zoom view: how many of a settlement's people the
// picture shows where, and how many people each building stands for. Everything that
// draws people up close (town.ts plans, the satellite villages in layout.ts) and the
// inspector's line about it follows these pure functions, so that counting roofs in the
// picture and applying the convention gives back the simulation's number.
//
// A settlement is the population centre of its cell (~150 km across) and its catchment:
// its number includes the people of the surrounding countryside.
//
//  - Urban share: the principal town (or the village itself) holds urbanShare(p) of the
//    population p; a hamlet or village of up to 300 is all in one place, a town of 3,000
//    keeps 60% in town, a city of 30,000 45%, a metropolis of 100,000 38% (smooth, log-
//    linear between those anchors). urbanPopulation(p) and ruralPopulation(p) both rise
//    with p, so growth and decline stay monotone in town and countryside alike.
//  - Households: one dwelling unit (one roof, one storey) houses HOUSEHOLD = 6 people. A
//    building houses roof units x storeys households, counted the way a viewer counts
//    them: a detached house, a hut (with or without its granary), a pair of huts or a
//    fenced compound is one household; a terrace is drawn as separate narrow houses side
//    by side, each its own roof and height; a courtyard block of six roofs on three storeys
//    houses 18. Storeys are what the facade shader draws (a row of windows per 0.3 model
//    units of wall), so height carries population; they are kept low where a viewer would
//    not credit them (one in villages and outer wards, one or two in a town, up to three or
//    four only in a city's core). Landmarks (temples, halls, markets, mills, forts) house
//    nobody. Town buildings are drawn narrower as the town grows (town.ts planScale), so a
//    city is a denser fabric of more buildings, not a village blown up.
//  - Countryside: the rest live in satellite villages and hamlets of 6-person houses,
//    spread over the settlement's territory (its own cell and the land cells within 2
//    hops, 3 past 6,000, 4 past 25,000 and 5 past 100,000 people, that it claims more
//    strongly than any other settlement, the larger reaching further). Villages fill one
//    after another in a fixed order (sizes from the seed and the settlement id), each made
//    of clusters of 4-6 houses, a well, church and market as they grow. The countryside
//    shows at most RURAL_HOUSES_PER_CELL houses per land cell of its territory: beyond
//    that (only the largest cities) the picture under-counts the countryside.
//  - The lone farmsteads of the land-use layer stand only on land no settlement claims;
//    inside a territory its villages are the countryside.

import type { History, World } from '../../contract.ts'

/** People per household: one dwelling unit, one storey. */
export const HOUSEHOLD = 6
/** Most countryside houses shown per land cell of a settlement's territory. */
export const RURAL_HOUSES_PER_CELL = 220
/** Height of a storey (model units), as the facade shader draws windows. */
export const STOREY = 0.3

/** (population, share in the principal town), log-linear between. */
const URBAN: readonly (readonly [number, number])[] = [
  [300, 1], [1000, 0.8], [3000, 0.6], [10000, 0.5], [30000, 0.45], [100000, 0.38], [300000, 0.35],
]

/** Share of population p living in the principal town (1 for a village of up to 300). */
export function urbanShare(p: number): number {
  if (p <= URBAN[0][0]) return 1
  for (let i = 1; i < URBAN.length; i++) {
    const [p1, s1] = URBAN[i]
    if (p <= p1) {
      const [p0, s0] = URBAN[i - 1]
      const t = Math.log(p / p0) / Math.log(p1 / p0)
      return s0 + (s1 - s0) * t
    }
  }
  return URBAN[URBAN.length - 1][1]
}

/** People in the principal town (rises with p). */
export const urbanPopulation = (p: number) => (p > 0 ? p * urbanShare(p) : 0)
/** People in the countryside: villages and hamlets (rises with p). */
export const ruralPopulation = (p: number) => (p > 0 ? p - urbanPopulation(p) : 0)

/** Smallest population p with f(p) >= v (f rising): bisection in log p. */
function invert(f: (p: number) => number, v: number): number {
  if (v <= 0) return 0
  let lo = Math.log(Math.max(1, v)), hi = lo + 2
  while (f(Math.exp(hi)) < v) hi += 1
  if (f(Math.exp(lo)) >= v) return Math.exp(lo)
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2
    if (f(Math.exp(m)) >= v) hi = m
    else lo = m
  }
  return Math.exp(hi)
}
/** Population at which the town holds u people. */
export const urbanThreshold = (u: number) => invert(urbanPopulation, u)
/** Population at which the countryside holds r people. */
export const ruralThreshold = (r: number) => invert(ruralPopulation, r)

/** Storeys of a wall from `base` to `eave` (model units) under height scale sy: as the facade shader counts them. */
export function storeys(base: number, eave: number, sy: number): number {
  if (eave <= base) return 1
  return Math.max(1, Math.floor(((eave - base) * sy) / STOREY + 0.3))
}

/** Households of a building: its roof units times its storeys. */
export const households = (roofUnits: number, storeyCount: number) => Math.max(0, roofUnits) * Math.max(1, storeyCount)

// ---------- the countryside ----------

/** A small deterministic hash to [0, 1) (independent of surface.ts so the UI can use it). */
function rnd(seed: number, id: number, a: number, b: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(id + 0x632be5ab, 0x85ebca6b) ^ Math.imul(a + 0x1b873593, 0xc2b2ae35) ^ Math.imul(b + 0x27d4eb2f, 0x165667b1)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** Houses in one cluster of a village: clusters come in 4, 5 and 6 houses (the cluster kind 0, 1, 2). */
export const CLUSTER_HOUSES: readonly number[] = [4, 5, 6]
/** Cluster kind (0..2) of cluster j of village v. */
export const clusterKind = (seed: number, id: number, v: number, j: number) => Math.min(2, Math.floor(rnd(seed, id, v * 97 + j, 0x51) * 3))

/** Target size in houses of village v of a settlement (the first few are the larger villages). */
export function villageTarget(seed: number, id: number, v: number): number {
  const u = rnd(seed, id, v, 0x52), w = rnd(seed, id, v, 0x53)
  if (v === 0) return Math.round(30 + 20 * w)
  if (v <= 3) return Math.round(14 + 16 * w)
  if (u < 0.55) return Math.round(4 + 5 * w) // hamlet
  if (u < 0.9) return Math.round(10 + 14 * w) // village
  return Math.round(25 + 20 * w) // large village
}

/** Clusters of village v (its houses reach its target) and their kinds. */
export function villageClusters(seed: number, id: number, v: number, out: number[]): number[] {
  out.length = 0
  const target = villageTarget(seed, id, v)
  let n = 0
  for (let j = 0; n < target; j++) {
    const k = clusterKind(seed, id, v, j)
    out.push(k)
    n += CLUSTER_HOUSES[k]
  }
  return out
}

/** Countryside houses shown at population p for a territory of `landCells` land cells. */
export function ruralHouses(p: number, landCells: number): number {
  return Math.min(Math.floor(ruralPopulation(p) / HOUSEHOLD), Math.max(1, landCells) * RURAL_HOUSES_PER_CELL)
}

/**
 * The villages that hold `houses` countryside houses (whole clusters, in order): how many
 * have at least one cluster standing, and the houses those clusters hold. A cluster stands
 * once the houses it completes are no more than half a cluster beyond `houses`.
 */
export function villagesHolding(seed: number, id: number, houses: number): { villages: number; houses: number } {
  const tmp: number[] = []
  let cum = 0, villages = 0
  for (let v = 0; v < 100000; v++) {
    villageClusters(seed, id, v, tmp)
    let any = false
    for (const k of tmp) {
      const h = CLUSTER_HOUSES[k]
      if (cum + h / 2 > houses) return { villages: villages + (any ? 1 : 0), houses: cum }
      cum += h
      any = true
    }
    villages++
  }
  return { villages, houses: cum }
}

// ---------- territories ----------

export interface Territories {
  /** Per settlement: its territory's land cells (own cell first), nearest hops first. */
  cells: Int32Array[]
  /** Per settlement: hop distance of each of those cells. */
  hops: Uint8Array[]
}

const territoryCache = new WeakMap<object, Territories>()


/** Hops of a settlement's territory: 2, 3 for one that ever passes 6,000, 4 past 25,000 (the reach of its fields in the simulation), 5 past 100,000. */
export const territoryHops = (peak: number) => (peak >= 100000 ? 5 : peak >= 25000 ? 4 : peak >= 6000 ? 3 : 2)
/** Claim of a settlement on a cell `hop` hops away (lower wins): nearer, and larger settlements reach further. */
const claim = (hop: number, peak: number) => (hop === 0 ? -100 : hop - 0.6 * Math.log10(Math.max(1, peak) / 1000))

/**
 * Every settlement's territory: the land cells within territoryHops of it that it claims
 * more strongly than any other settlement (fewer hops, less 0.6 hop per tenfold of peak
 * population: a city's countryside reaches past its small neighbours; every settlement
 * keeps its own cell), ties to the larger peak. Outposts have none. Cached per history (a
 * longer run is a new history and recomputes).
 */
export function territories(world: World, h: History): Territories {
  const cached = territoryCache.get(h)
  if (cached) return cached
  const g = territorySteps(world, h)
  for (;;) {
    const r = g.next()
    if (r.done) return r.value
  }
}

/** The territories if already computed for this history, else null. */
export const cachedTerritories = (h: History): Territories | null => territoryCache.get(h) ?? null

/** territories() in steps of a millisecond or so (the renderer spreads it over frames); caches the result. */
export function* territorySteps(world: World, h: History): Generator<void, Territories, void> {
  const cached = territoryCache.get(h)
  if (cached) return cached
  const { neighborOffsets: off, neighbors: nb, cellCount } = world.grid
  const N = h.settlements.length
  // peak population of each settlement over the history
  const pk = new Float32Array(N)
  for (let s = 0; s < h.snapshotCount; s++) {
    if (s % 48 === 47) yield
    for (let i = 0; i < N; i++) pk[i] = Math.max(pk[i], h.population[s * N + i])
  }
  const bestClaim = new Float32Array(cellCount).fill(Infinity)
  const bestId = new Int32Array(cellCount).fill(-1)
  const seen = new Int32Array(cellCount).fill(-1)
  const lists: number[][] = []
  const listHops: number[][] = []
  const frontier: number[] = [], next: number[] = []
  for (let id = 0; id < N; id++) {
    if (id % 128 === 127) yield
    const s = h.settlements[id]
    const cl: number[] = [], hl: number[] = []
    lists.push(cl)
    listHops.push(hl)
    if (s.outpost || pk[id] <= 0) continue
    const R = territoryHops(pk[id])
    frontier.length = 0
    frontier.push(s.cell)
    seen[s.cell] = id
    for (let hop = 0; hop <= R && frontier.length; hop++) {
      next.length = 0
      for (const c of frontier) {
        if (world.elevation[c] >= 0) {
          cl.push(c)
          hl.push(hop)
          const b = bestId[c], cv = claim(hop, pk[id])
          if (b < 0 || cv < bestClaim[c] || (cv === bestClaim[c] && (pk[id] > pk[b] || (pk[id] === pk[b] && id < b)))) {
            bestClaim[c] = cv
            bestId[c] = id
          }
        }
        if (hop === R) continue
        for (let k = off[c]; k < off[c + 1]; k++) {
          const j = nb[k]
          if (seen[j] === id) continue
          seen[j] = id
          next.push(j)
        }
      }
      frontier.length = 0
      for (const c of next) frontier.push(c)
    }
  }
  const cells: Int32Array[] = [], hops: Uint8Array[] = []
  for (let id = 0; id < N; id++) {
    const cl = lists[id], hl = listHops[id]
    const keep: number[] = [], kh: number[] = []
    for (let i = 0; i < cl.length; i++) if (bestId[cl[i]] === id || i === 0) { keep.push(cl[i]); kh.push(hl[i]) }
    cells.push(Int32Array.from(keep))
    hops.push(Uint8Array.from(kh))
  }
  const t = { cells, hops }
  territoryCache.set(h, t)
  return t
}

/** What the picture shows of settlement `id` at population p. */
export interface Census {
  /** People in the principal town. */
  town: number
  /** People in the countryside (all of them, whether or not every house is shown). */
  rural: number
  /** Villages and hamlets standing. */
  villages: number
  /** Countryside houses shown (each HOUSEHOLD people). */
  houses: number
}

export function census(world: World, h: History, id: number, p: number): Census {
  const s = h.settlements[id]
  if (!s || s.outpost || p <= 0) return { town: Math.max(0, p), rural: 0, villages: 0, houses: 0 }
  const land = territories(world, h).cells[id]?.length ?? 1
  const rh = ruralHouses(p, land)
  const v = villagesHolding(world.seed | 0, id, rh)
  return { town: urbanPopulation(p), rural: ruralPopulation(p), villages: v.villages, houses: v.houses }
}

/** The inspector's line: where the people of settlement `id` live at population p, or '' when all in one place. */
export function censusLine(world: World, h: History, id: number, p: number): string {
  const c = census(world, h, id, p)
  if (c.villages === 0 || c.rural < 1) return ''
  const round = (x: number) => (x >= 10000 ? Math.round(x / 100) * 100 : x >= 1000 ? Math.round(x / 50) * 50 : Math.round(x / 10) * 10)
  const place = p >= 10000 ? 'city' : p >= 3000 ? 'town' : 'village'
  const n = c.villages
  const where = n === 1 ? (c.houses < 10 ? 'a hamlet nearby' : 'a village nearby') : `${n} villages and hamlets around it`
  return `About ${round(c.town).toLocaleString('en-US')} live in the ${place}; the rest in ${where}`
}
