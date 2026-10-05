// Trade: goods, links, routes, the yearly market, wealth and roads.
//
// Goods. Each settlement's food (from the food system) is split into Grain,
// Fish and Livestock by where it comes from (fields, sea / lake / river and
// port, pasture); Timber, Ore and Salt come from its catchment's uncleared
// forest, ore-rich highlands and arid shores, worked by its people. Every
// good has a per-capita need. A settlement's price for a good is its worth
// times 2 / (1 + stock / need), and for food also rises steeply with hunger
// (food / people below 1) and falls when food is plentiful, so a farming
// village sells grain cheaply, a port sells fish, and a crowded or hungry
// town pays well for anything edible.
//
// Links. Every TRADE.linkStep years a bounded multi-source travel-cost search
// from all trading settlements (the migration cost field: rivers and coasts
// cheap, mountains and desert dear, sea cheap for ports and dear without,
// roads cheaper) splits the land into regions (a port's region reaches
// TRADE.portSeaRadius times further over water, so overseas colonies are
// not cut off); settlements whose regions touch are linked. Each trading settlement then searches that settlement
// graph for partners within reach and keeps the TRADE.nearest cheapest plus
// the TRADE.gravity with the best size / cost^2 (big markets pull trade from
// further away); ports search TRADE.portReach times further. A partner reached through other settlements is traded with
// directly, along the chained path, and those settlements take a toll; so
// does the trader whose region holds a shore where the goods change between
// land and sea (transshipment), which makes ports, river mouths and straits hubs.
// A port at the end of a route that goes by sea is a gateway: its own trade on
// that route counts TRADE.portWeight (not ownWeight) toward its hub status.
// Pairs that have never traded are only re-examined every TRADE.probeStep years.
// Knowledge (knowledge.ts): a trader searches only through settlements whose
// cells its people knows; a partner (or a settlement on the way) of a people
// not yet met makes first contact (the route would link them), so routes run
// only between peoples in contact. A new route's path becomes known to the
// peoples at both ends.
//
// Market. Each year, after the harvest, goods flow along the candidate pairs
// (cheapest first, TRADE.passes sweeps): wherever the price gap for a good
// beats its transport cost (falling with the Crafts of the two ends' peoples), a damped step moves
// goods from cheap to dear. A pair that is not yet trading needs a larger gap
// (TRADE.openHurdle) to start. Food that arrives feeds people this year;
// food that leaves does not. The first flow on a pair opens its route
// (TradeOpened; the route keeps its id for good); a route closes after
// TRADE.closeYears years of next to nothing, or when an end is abandoned.
//
// Wealth. Exporters earn half the price gap they close plus a margin; places
// a route passes through take a toll. Wealth decays slowly; per head it
// raises a settlement's food multiplier (econ), together with being a hub
// (loads on and through it), and keeps and draws people (migration.ts).
// Prosperous settlements also outbid others for food (their food prices are
// scaled up), so trade hubs feed themselves from further afield.
//
// Roads. Route volume wears roads into the land cells of its path; roads fade
// without traffic, and lower travel cost for trade and migration.
//
// Danger (polities: policy.ts WAYRISK): the link search prices each cell at (1 + path * the merchants' risk there), so
// traders pick safer partners and new routes bend round dangerous ground (the market pays the way's own cost); a pair
// loses a share of what it carries on a dangerous way (its pc.lost) and pays for escorts (pc.cost): merchants weigh the
// loss against the goods' worth at the buyer's (bulk leaves first, dear goods pay the premium), and what they send
// arrives short by it.
//
// Animals (species.ts): pack animals at either end make transport cheaper,
// camels make desert legs cheap and llamas highland legs (in the link search
// by the region's settlement, on a route by its two ends).
//
// Everything is deterministic: fixed iteration orders, Maps used only for
// lookup, no randomness.

import { EventType, GOOD_COUNT, TECH_FIELD_COUNT, TechField } from '../../contract.ts'
import { Heap } from './heap.ts'
import { CASHCROP, GOODS, MIGRATION, ROAD, TRADE, WEALTH } from './params.ts'
import { prosperity } from './migration.ts'
import { reachOf } from './population.ts'
import type { HistoryState } from './state.ts'
import { logEvent, techOf } from './state.ts'
import { ideaLand, ideaSea } from './ideas/hooks.ts' // ideas:
import { ContactVia, learnPath, meet } from './knowledge.ts'
import { moveMuls, packOf } from './species.ts'
import { marketGoods, stimFlow } from './cashCrops.ts' // species-v2
import { perishOf } from './storage.ts' // species-v2
import { incomeWatch, pairPolicy, refreshWayRisk, routeClosed, routeLoads, routeOpened } from './polity/policy.ts' // polities: (v2) duties, embargo, smuggling, pirates and bandits; danger on the way
import type { PairPolicy } from './polity/policy.ts' // polities:
import { SMUGGLE, TARIFF, WAYRISK } from './polity/params.ts' // polities:
import { ACCOUNTS, flushAccounts } from './polity/outlaw.ts' // polities:
// goods: high-value classes, stocks and merchants, middlemen, the long-haul layer (goods/*); contraband is polities v2's.
import { HVR, cutOf, goodsSettle, goodsStock, hvMoved, hvPair, hvPrice, hvTransport, pairCuts } from './goods/market.ts'
import { forwardPrices, longHaulSweep } from './goods/longhaul.ts'
import { noteIncome } from './goods/state.ts'
import { STOCK } from './goods/params.ts'
import { diseaseTradeMul } from './disease/system.ts' // disease:
import { tourismDemand } from './tourism/system.ts' // tourism:

const G = GOOD_COUNT
/** Goods [0, FOOD) are food. */
const FOOD = 3
/** Pair keys: a * KEY + b, a < b. */
const KEY = 1 << 20

export interface TradeState {
  // Cell search (link graph).
  dist: Float64Array
  label: Int32Array
  prev: Int32Array
  stamp: Int32Array
  run: number
  heap: Heap
  visited: Int32Array
  /** Link graph edges between settlements whose regions touch; boundary cells per edge. */
  edgeA: number[]
  edgeB: number[]
  edgeCost: number[]
  edgeCellA: number[]
  edgeCellB: number[]
  /** polities: each edge's cost without the danger on the way (the same crossing), for the partner choice it changed (diagnostics); cost to each cell without it (scratch). */
  edgeCost0: number[]
  dist0: Float64Array
  /** CSR adjacency over settlement ids [0, adjCount). */
  adjCount: number
  adjOff: Int32Array
  adjNode: Int32Array
  adjEdge: Int32Array
  /** Year of the last link rebuild (the prev / label fields are from it), or -1. */
  linkYear: number

  // Candidate pairs, sorted by cost (cheapest first).
  pairCount: number
  pairA: Int32Array
  pairB: Int32Array
  pairCost: Float64Array
  pairRoute: Int32Array
  /** Settlement chain from pairA to pairB through the link graph (for building the route path when it opens). */
  pairChain: number[][]
  /** polities: the cell path of each pair (its route's, or the one it would open along), for the danger on the way. */
  pairPath: number[][]
  /** Goods moved this year per pair: [(p * G + g) * 2 + dir], dir 0 = a to b. */
  pairFlow: Float64Array

  // Routes.
  routeCount: number
  routeIndex: Map<number, number>
  rA: number[]
  rB: number[]
  rOpened: number[]
  rPath: number[][]
  rTransit: number[][]
  /** 1 when the route's way goes by sea (its port ends are gateways: TRADE.portWeight). */
  rSea: Uint8Array
  rOpen: Uint8Array
  rIdle: Int32Array
  /** Loads this year. */
  rVol: Float64Array
  /** Loads since the last road update. */
  rRoadAcc: Float64Array
  /** Cumulative goods moved: [(r * G + g) * 2 + dir]. */
  rGood: Float64Array
  /** Open route ids, in order of (re)opening. */
  openList: number[]

  // Market, per settlement (index id * G + g).
  stock: Float64Array
  demand: Float64Array
  price: Float64Array
  deriv: Float64Array
  income: Float64Array
  throughYear: Float64Array
  food0: Float64Array
  /** Resource potential per settlement: timber, ore, salt (units a year at productivity 1 and full labour). */
  res: Float64Array
  trader: Uint8Array
  /** Food price multiplier this year: prosperous settlements outbid others for food (1 + WEALTH.bid * prosperity). */
  bid: Float64Array
  /** Pack-animal transport factor this year (species.packOf). */
  pack: Float64Array
  // species-v2: worth of Cloth, Luxury and Stimulant at each settlement this year ([id * G + g], g >= 6; cashCrops.ts), and the transport factor of its grain (storage.ts).
  worth: Float64Array
  perish: Float64Array
  /** goods: 1 for the high-value classes priced by scarcity (goods/market.ts hvPrice), or null while the goods system is off. */
  hv: Uint8Array | null

  // Settlement-graph search.
  gDist: Float64Array
  gPrev: Int32Array
  gStamp: Int32Array
  gRun: number
  gHeap: Heap

  // Roads.
  roadCells: Int32Array
  roadCount: number
  isRoad: Uint8Array
  traffic: Float64Array

  /** Loads this year per good (diagnostics). */
  goodYear: Float64Array
  /** Scratch for path assembly. */
  pathPos: Int32Array
  pathStamp: Int32Array
  pathRun: number
}

export function createTrade(cellCount: number): TradeState {
  const S = 256
  return {
    dist: new Float64Array(cellCount),
    label: new Int32Array(cellCount),
    prev: new Int32Array(cellCount),
    stamp: new Int32Array(cellCount),
    run: 0,
    heap: new Heap(1024),
    visited: new Int32Array(cellCount),
    edgeA: [], edgeB: [], edgeCost: [], edgeCellA: [], edgeCellB: [], edgeCost0: [], dist0: new Float64Array(cellCount),
    adjCount: 0,
    adjOff: new Int32Array(1),
    adjNode: new Int32Array(0),
    adjEdge: new Int32Array(0),
    linkYear: -1,
    pairCount: 0,
    pairA: new Int32Array(0),
    pairB: new Int32Array(0),
    pairCost: new Float64Array(0),
    pairRoute: new Int32Array(0),
    pairChain: [],
    pairPath: [],
    pairFlow: new Float64Array(0),
    routeCount: 0,
    routeIndex: new Map(),
    rA: [], rB: [], rOpened: [], rPath: [], rTransit: [],
    rOpen: new Uint8Array(256), rSea: new Uint8Array(256),
    rIdle: new Int32Array(256),
    rVol: new Float64Array(256),
    rRoadAcc: new Float64Array(256),
    rGood: new Float64Array(256 * G * 2),
    openList: [],
    stock: new Float64Array(S * G),
    demand: new Float64Array(S * G),
    price: new Float64Array(S * G),
    deriv: new Float64Array(S * G),
    income: new Float64Array(S),
    throughYear: new Float64Array(S),
    food0: new Float64Array(S),
    res: new Float64Array(S * 3),
    trader: new Uint8Array(S),
    bid: new Float64Array(S),
    pack: new Float64Array(S),
    worth: new Float64Array(S * G), // species-v2
    perish: new Float64Array(S).fill(1), // species-v2
    hv: null, // goods: (set by index.ts when the system is on)
    gDist: new Float64Array(S),
    gPrev: new Int32Array(S),
    gStamp: new Int32Array(S),
    gRun: 0,
    gHeap: new Heap(256),
    roadCells: new Int32Array(cellCount),
    roadCount: 0,
    isRoad: new Uint8Array(cellCount),
    traffic: new Float64Array(cellCount),
    goodYear: new Float64Array(G),
    pathPos: new Int32Array(cellCount),
    pathStamp: new Int32Array(cellCount),
    pathRun: 0,
  }
}

function growF(a: Float64Array, size: number): Float64Array {
  const b = new Float64Array(size)
  b.set(a)
  return b
}
function growI(a: Int32Array, size: number): Int32Array {
  const b = new Int32Array(size)
  b.set(a)
  return b
}
function growU(a: Uint8Array, size: number): Uint8Array {
  const b = new Uint8Array(size)
  b.set(a)
  return b
}

/** Grows the per-settlement buffers to cover `count` settlements. */
function ensureSettlements(ts: TradeState, count: number): void {
  if (count <= ts.trader.length) return
  let size = ts.trader.length
  while (size < count) size *= 2
  ts.stock = growF(ts.stock, size * G)
  ts.demand = growF(ts.demand, size * G)
  ts.price = growF(ts.price, size * G)
  ts.deriv = growF(ts.deriv, size * G)
  ts.income = growF(ts.income, size)
  ts.throughYear = growF(ts.throughYear, size)
  ts.food0 = growF(ts.food0, size)
  ts.res = growF(ts.res, size * 3)
  ts.trader = growU(ts.trader, size)
  ts.bid = growF(ts.bid, size)
  ts.pack = growF(ts.pack, size)
  ts.worth = growF(ts.worth, size * G) // species-v2
  ts.perish = growF(ts.perish, size) // species-v2
  ts.gDist = growF(ts.gDist, size)
  ts.gPrev = growI(ts.gPrev, size)
  ts.gStamp = growI(ts.gStamp, size)
}

function ensureRoutes(ts: TradeState, count: number): void {
  if (count <= ts.rOpen.length) return
  let size = ts.rOpen.length
  while (size < count) size *= 2
  ts.rOpen = growU(ts.rOpen, size)
  ts.rSea = growU(ts.rSea, size)
  ts.rIdle = growI(ts.rIdle, size)
  ts.rVol = growF(ts.rVol, size)
  ts.rRoadAcc = growF(ts.rRoadAcc, size)
  ts.rGood = growF(ts.rGood, size * G * 2)
}

/** species-v2: goods traded this year (scratch). */
const GOODS_LIST = new Int32Array(G)
/** This year's traders in living order (scratch, grown). */
let TRADERS = new Int32Array(256)
/** Travel cost multipliers by species move class (species.moveMuls), scratch. */
const LINK_MUL = new Float64Array(3)
const ROUTE_MUL = new Float64Array(3)

/** Deep-ocean cost of one cell for trade by settlement `id` this year (its people's Seafaring), with or without a port. */
function oceanCost(s: HistoryState, id: number, port: boolean): number {
  const c = ((MIGRATION.oceanCost * s.terrain.cellScale) / Math.sqrt(techOf(s, id, TechField.Seafaring))) * (port ? TRADE.oceanPort : TRADE.oceanNoPort)
  return s.ideas !== null ? c / ideaSea(s.ideas, s.people[id]) : c // ideas: keels, rudders, the compass
}

/**
 * Rebuilds the link graph: a multi-source search from every trading
 * settlement over the travel-cost field (each region with its own sea costs,
 * by whether its settlement has a port), out to TRADE.radius; settlements
 * whose regions touch are linked, at the cost of the cheapest crossing.
 */
function rebuildLinks(s: HistoryState, ts: TradeState): void {
  const T = s.terrain
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const { dist, label, prev, stamp, heap, visited } = ts
  const run = ++ts.run
  heap.size = 0
  const living = s.living
  // polities: the merchants' risk per cell prices each step (WAYRISK.path); dist0 keeps the danger-free cost along the same search.
  const ps = WAYRISK.on ? s.pol : null
  if (ps !== null) refreshWayRisk(s, ps)
  const rk = ps !== null ? ps.wayRisk : null
  const kp = WAYRISK.path
  const dist0 = ts.dist0
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    if (!ts.trader[id]) continue
    const c = s.cell[id]
    stamp[c] = run
    dist[c] = 0
    dist0[c] = 0
    label[c] = id
    prev[c] = -1
    heap.push(0, c)
  }
  // Deep-ocean cost per people (its Seafaring), without the port factor.
  const P = s.know.P
  const oceanOf = new Float64Array(P)
  for (let q = 0; q < P; q++) oceanOf[q] = (MIGRATION.oceanCost * T.cellScale) / Math.sqrt(s.tech[q * TECH_FIELD_COUNT + TechField.Seafaring])
  if (s.ideas !== null) for (let q = 0; q < P; q++) oceanOf[q] /= ideaSea(s.ideas, q) // ideas:
  const peopleOf = s.people
  const radius = TRADE.radius
  const radiusSea = TRADE.radius * TRADE.portSeaRadius
  const mcls = s.sp.moveClass
  const tm = LINK_MUL
  let lastA = -1
  let nv = 0
  while (heap.size > 0) {
    const d = heap.topKey()
    const c = heap.pop()
    if (d > dist[c]) continue
    visited[nv++] = c
    const a = label[c]
    const port = s.port[a] >= 0
    const seaMul = port ? TRADE.seaPort : TRADE.seaNoPort
    const ocean = oceanOf[peopleOf[a]] * (port ? TRADE.oceanPort : TRADE.oceanNoPort)
    if (a !== lastA) { moveMuls(s, a, tm); lastA = a } // (the region's settlement's camels and llamas)
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      const st = T.deep[j] ? ocean : T.sea[j] ? T.moveCost[j] * seaMul : s.moveCost[j] * tm[mcls[j]]
      const nd = rk === null ? d + st : d + st * (1 + kp * rk[j])
      if (nd > (port && T.sea[j] ? radiusSea : radius)) continue // ports' regions reach further over water
      if (stamp[j] === run && nd >= dist[j]) continue
      stamp[j] = run
      dist[j] = nd
      if (rk !== null) dist0[j] = dist0[c] + st
      label[j] = a
      prev[j] = c
      heap.push(nd, j)
    }
  }
  // Region boundaries: one edge per touching pair, at its cheapest crossing.
  const edgeA: number[] = [], edgeB: number[] = [], edgeCost: number[] = [], edgeCellA: number[] = [], edgeCellB: number[] = [], edgeCost0: number[] = []
  const index = new Map<number, number>()
  for (let t = 0; t < nv; t++) {
    const c = visited[t]
    const la = label[c]
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (stamp[j] !== run) continue
      const lb = label[j]
      if (lb <= la) continue
      const cost = dist[c] + dist[j] + 0.5 * (s.moveCost[s.cell[la]] + s.moveCost[s.cell[lb]])
      const key = la * KEY + lb
      const e = index.get(key)
      if (e === undefined) {
        index.set(key, edgeA.length)
        edgeA.push(la); edgeB.push(lb); edgeCost.push(cost); edgeCellA.push(c); edgeCellB.push(j)
        if (rk !== null) edgeCost0.push(dist0[c] + dist0[j] + 0.5 * (s.moveCost[s.cell[la]] + s.moveCost[s.cell[lb]]))
      } else if (cost < edgeCost[e]) {
        edgeCost[e] = cost; edgeCellA[e] = c; edgeCellB[e] = j
        if (rk !== null) edgeCost0[e] = dist0[c] + dist0[j] + 0.5 * (s.moveCost[s.cell[la]] + s.moveCost[s.cell[lb]])
      }
    }
  }
  ts.edgeA = edgeA; ts.edgeB = edgeB; ts.edgeCost = edgeCost; ts.edgeCellA = edgeCellA; ts.edgeCellB = edgeCellB; ts.edgeCost0 = edgeCost0
  // CSR adjacency.
  const S = s.count
  const adjOff = new Int32Array(S + 1)
  for (let e = 0; e < edgeA.length; e++) { adjOff[edgeA[e] + 1]++; adjOff[edgeB[e] + 1]++ }
  for (let i = 0; i < S; i++) adjOff[i + 1] += adjOff[i]
  const fill = adjOff.slice(0, S)
  const adjNode = new Int32Array(adjOff[S])
  const adjEdge = new Int32Array(adjOff[S])
  for (let e = 0; e < edgeA.length; e++) {
    const a = edgeA[e], b = edgeB[e]
    adjNode[fill[a]] = b; adjEdge[fill[a]++] = e
    adjNode[fill[b]] = a; adjEdge[fill[b]++] = e
  }
  ts.adjCount = S
  ts.adjOff = adjOff
  ts.adjNode = adjNode
  ts.adjEdge = adjEdge
  ts.linkYear = s.year
}

/** Cell path of link edge e from settlement u's cell to the other end's (valid until the next rebuild). */
function edgePath(ts: TradeState, e: number, u: number): number[] {
  const prev = ts.prev
  const fromA: number[] = []
  for (let c = ts.edgeCellA[e]; c >= 0; c = prev[c]) fromA.push(c)
  fromA.reverse() // a's cell ... boundary cell on a's side
  for (let c = ts.edgeCellB[e]; c >= 0; c = prev[c]) fromA.push(c) // ... b's cell
  if (ts.edgeA[e] !== u) fromA.reverse()
  return fromA
}

/** Link edge between settlements u and v, or -1. */
function findEdge(ts: TradeState, u: number, v: number): number {
  if (u >= ts.adjCount) return -1
  for (let k = ts.adjOff[u]; k < ts.adjOff[u + 1]; k++) if (ts.adjNode[k] === v) return ts.adjEdge[k]
  return -1
}

/** Cell path along a settlement chain (consecutive cells adjacent, loops cut out). (goods: exported for the long-haul legs) */
export function chainPath(s: HistoryState, ts: TradeState, chain: number[]): number[] {
  const { pathStamp, pathPos } = ts
  const run = ++ts.pathRun
  const out: number[] = []
  const add = (c: number): void => {
    if (pathStamp[c] === run) {
      // Back on a cell already on the path: cut the loop out.
      const keep = pathPos[c]
      for (let k = keep + 1; k < out.length; k++) pathStamp[out[k]] = 0
      out.length = keep + 1
      return
    }
    pathStamp[c] = run
    pathPos[c] = out.length
    out.push(c)
  }
  add(s.cell[chain[0]])
  for (let i = 0; i + 1 < chain.length; i++) {
    const seg = edgePath(ts, findEdge(ts, chain[i], chain[i + 1]), chain[i])
    for (let k = 1; k < seg.length; k++) add(seg[k])
  }
  return out
}

/** Trade travel cost along a route's recorded path this year. */
function routeCost(s: HistoryState, ts: TradeState, r: number): number {
  const T = s.terrain
  const path = ts.rPath[r]
  const pa = s.port[ts.rA[r]] >= 0, pb = s.port[ts.rB[r]] >= 0
  const seaMul = 0.5 * ((pa ? TRADE.seaPort : TRADE.seaNoPort) + (pb ? TRADE.seaPort : TRADE.seaNoPort))
  const ocean = 0.5 * (oceanCost(s, ts.rA[r], pa) + oceanCost(s, ts.rB[r], pb))
  const ta = LINK_MUL, tb = ROUTE_MUL
  moveMuls(s, ts.rA[r], ta)
  moveMuls(s, ts.rB[r], tb)
  const mcls = s.sp.moveClass
  let cost = 0
  for (let k = 1; k < path.length; k++) {
    const j = path[k]
    cost += T.deep[j] ? ocean : T.sea[j] ? T.moveCost[j] * seaMul : s.moveCost[j] * 0.5 * (ta[mcls[j]] + tb[mcls[j]])
  }
  return cost
}

/** Resource potential (timber, ore, salt) per living settlement, over its catchment. */
function rebuildResources(s: HistoryState, ts: TradeState): void {
  const T = s.terrain
  const { catchOff, catchBase, catchCell, catchW, catchDist, timber, ore, salt } = T
  const u = s.landUse
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const c = s.cell[id]
    const r1 = reachOf(s.pop[id]) + 1
    const base = catchBase[c]
    let tb = 0, or = 0, sa = 0
    for (let k = catchOff[c]; k < catchOff[c + 1]; k++) {
      let w = catchW[k]
      if (k >= base) {
        const f = r1 - catchDist[k]
        if (f <= 0) break
        if (f < 1) w *= f
      }
      const j = catchCell[k]
      tb += w * timber[j] * (1 - u[j])
      or += w * ore[j]
      sa += w * salt[j]
    }
    ts.res[id * 3] = tb
    ts.res[id * 3 + 1] = or
    ts.res[id * 3 + 2] = sa
  }
}

/**
 * Candidate pairs: from every trader, a search over the link graph within
 * reach; keep the nearest few and the strongest gravity partners. Open routes
 * stay candidates while both ends live; pairs with a route trade along its path.
 */
function rebuildPairs(s: HistoryState, ts: TradeState): void {
  const living = s.living
  const pairA: number[] = [], pairB: number[] = [], pairCost: number[] = [], pairRoute: number[] = []
  const pairChain: number[][] = []
  const index = new Map<number, number>()
  const gPrev = ts.gPrev
  const candId: number[] = [], candCost: number[] = []
  const chosen: number[] = []
  const addPair = (a: number, b: number, cost: number, chain: number[] | null, route: number): void => {
    const lo = a < b ? a : b, hi = a < b ? b : a
    const key = lo * KEY + hi
    if (index.get(key) !== undefined) return
    index.set(key, pairA.length)
    pairA.push(lo); pairB.push(hi); pairCost.push(cost)
    const r = route >= 0 ? route : ts.routeIndex.get(key) ?? -1
    pairRoute.push(r)
    if (chain && a > b) chain.reverse()
    pairChain.push(chain ?? [])
  }
  const kd = s.knowDiag
  const pd = s.pol !== null && WAYRISK.on ? s.pol.diag : null // polities: (diag) the partners the danger on the way changed
  const shadow: number[] = []
  for (let t = 0; t < living.length; t++) {
    const src = living[t]
    if (!ts.trader[src] || src >= ts.adjCount) continue
    let reach = TRADE.reach * (1 + GOODS.transportTech * (techOf(s, src, TechField.Crafts) - 1)) // (its people's Crafts)
    if (s.ideas !== null) reach *= ideaLand(s.ideas, s.people[src]) // ideas: the wheel, roads, coinage, credit
    const reachSrc = s.port[src] >= 0 ? reach * TRADE.portReach : reach // shipping lines from ports
    if (pd !== null) {
      // Shadow: the partners without the danger on the way (every edge at its danger-free cost).
      partnerSearch(s, ts, src, reachSrc, true, candId, candCost, chosen, ts.edgeCost0)
      shadow.length = 0
      for (const i of chosen) shadow.push(candId[i])
    }
    if (kd) {
      // Shadow: the partners full knowledge would give.
      partnerSearch(s, ts, src, reachSrc, false, candId, candCost, chosen, ts.edgeCost)
      const all = chosen.map((i) => candId[i])
      partnerSearch(s, ts, src, reachSrc, true, candId, candCost, chosen, ts.edgeCost)
      kd.tradeSearches++
      kd.tradePartners += all.length
      for (const v of all) {
        let hit = false
        for (const i of chosen) if (candId[i] === v) hit = true
        if (!hit) kd.tradeLost++
      }
    } else partnerSearch(s, ts, src, reachSrc, true, candId, candCost, chosen, ts.edgeCost)
    if (pd !== null) {
      pd.wayPartnerSlots += chosen.length
      for (const i of chosen) if (shadow.indexOf(candId[i]) < 0) pd.wayPartnersDiffer++
    }
    for (const i of chosen) {
      const v = candId[i]
      const chain: number[] = []
      for (let u = v; u >= 0; u = gPrev[u]) chain.push(u)
      chain.reverse() // src ... v
      // Strangers on the way or at the end: the route would link them, so they meet.
      const ps = s.people[src]
      for (let k = 1; k < chain.length; k++) if (s.people[chain[k]] !== ps) meet(s, src, chain[k], ContactVia.Trade)
      // polities: the partner was chosen by the danger-weighted cost; the market pays the way's own (danger-free) cost.
      let cost = candCost[i]
      if (pd !== null) { cost = 0; for (let k = 0; k + 1 < chain.length; k++) cost += ts.edgeCost0[findEdge(ts, chain[k], chain[k + 1])] }
      addPair(src, v, cost, chain, -1)
    }
  }
  // Open routes stay candidates while both ends live.
  for (const r of ts.openList) {
    const a = ts.rA[r], b = ts.rB[r]
    if (s.abandoned[a] >= 0 || s.abandoned[b] >= 0) continue
    addPair(a, b, 0, null, r)
  }
  // Pairs that have a route trade along its recorded path.
  for (let p = 0; p < pairA.length; p++) if (pairRoute[p] >= 0) pairCost[p] = routeCost(s, ts, pairRoute[p])
  // Cheapest first.
  const order = pairA.map((_, i) => i)
  order.sort((x, y) => pairCost[x] - pairCost[y] || pairA[x] - pairA[y] || pairB[x] - pairB[y])
  const P = order.length
  ts.pairCount = P
  ts.pairA = new Int32Array(P)
  ts.pairB = new Int32Array(P)
  ts.pairCost = new Float64Array(P)
  ts.pairRoute = new Int32Array(P)
  ts.pairChain = []
  for (let i = 0; i < P; i++) {
    const p = order[i]
    ts.pairA[i] = pairA[p]
    ts.pairB[i] = pairB[p]
    ts.pairCost[i] = pairCost[p]
    ts.pairRoute[i] = pairRoute[p]
    ts.pairChain.push(pairChain[p])
  }
  // polities: each pair's cell path (its route's, or the one it would open along), for the danger on the way (policy.ts wayOf).
  ts.pairPath = []
  if (s.pol !== null) for (let i = 0; i < P; i++) { const r = ts.pairRoute[i]; ts.pairPath.push(r >= 0 ? ts.rPath[r] : ts.pairChain[i].length > 0 ? chainPath(s, ts, ts.pairChain[i]) : []) }
  ts.pairFlow = new Float64Array(P * G * 2)
}

/**
 * Partner search from trader `src` over the link graph within `reachSrc`: candidates (traders, in
 * order of cost) into candId / candCost, the chosen ones (indices) into `chosen`: the nearest few,
 * then the strongest pulls (size / cost^2) among the rest. With `restrict`, only through settlements
 * whose cells src's people knows. Chains back to src are in ts.gPrev until the next search. `edgeCost`: the link edges' costs
 * (ts.edgeCost; polities: ts.edgeCost0 for the danger-free shadow).
 */
function partnerSearch(s: HistoryState, ts: TradeState, src: number, reachSrc: number, restrict: boolean, candId: number[], candCost: number[], chosen: number[], edgeCost: number[]): void {
  const { gDist, gPrev, gStamp, gHeap: heap, adjOff, adjNode, adjEdge } = ts
  const k = s.know
  const known = k.known
  const kBase = s.people[src] * k.N
  const cell = s.cell
  const run = ++ts.gRun
  heap.size = 0
  gStamp[src] = run
  gDist[src] = 0
  gPrev[src] = -1
  heap.push(0, src)
  candId.length = 0
  candCost.length = 0
  let visits = 0
  while (heap.size > 0 && visits < TRADE.maxNodes) {
    const d = heap.topKey()
    const u = heap.pop()
    if (d > gDist[u]) continue
    visits++
    if (u !== src && ts.trader[u]) { candId.push(u); candCost.push(d) }
    for (let e = adjOff[u]; e < adjOff[u + 1]; e++) {
      const v = adjNode[e]
      if (restrict && known[kBase + cell[v]] < 0) continue // unheard of
      const nd = d + edgeCost[adjEdge[e]]
      if (nd > reachSrc) continue
      if (gStamp[v] === run && nd >= gDist[v]) continue
      gStamp[v] = run
      gDist[v] = nd
      gPrev[v] = u
      heap.push(nd, v)
    }
  }
  chosen.length = 0
  for (let i = 0; i < candId.length && i < TRADE.nearest; i++) chosen.push(i)
  for (let m = 0; m < TRADE.gravity; m++) {
    let best = -1, bestScore = 0
    for (let i = TRADE.nearest; i < candId.length; i++) {
      if (chosen.indexOf(i) >= 0) continue
      const c = candCost[i] > 1 ? candCost[i] : 1
      const score = s.pop[candId[i]] / (c * c)
      if (score > bestScore) { bestScore = score; best = i }
    }
    if (best < 0) break
    chosen.push(best)
  }
}

/** Prices of the food goods at settlement i (they share the hunger term). */
function setFoodPrices(s: HistoryState, ts: TradeState, i: number): void {
  const o = i * G
  const p = s.pop[i]
  const { stock, demand, price, deriv } = ts
  const V = GOODS.value
  const dw = GOODS.dietWeight
  const F = stock[o] + stock[o + 1] + stock[o + 2]
  const y = F / p
  const bid = ts.bid[i]
  let h: number, hd: number
  if (y < 1) {
    h = 1 + GOODS.hungerSlope * (1 - y)
    hd = GOODS.hungerSlope / p
    if (h > GOODS.hungerMax) { h = GOODS.hungerMax; hd = 0 }
  } else {
    h = 1 - GOODS.surplusSlope * (y - 1)
    hd = GOODS.surplusSlope / p
    if (h < GOODS.hungerMin) { h = GOODS.hungerMin; hd = 0 }
  }
  for (let g = 0; g < FOOD; g++) {
    const D = demand[o + g]
    const inv = 1 / (1 + stock[o + g] / D)
    price[o + g] = bid * V[g] * (dw * 2 * inv + (1 - dw) * h)
    deriv[o + g] = bid * V[g] * ((dw * 2 * inv * inv) / D + (1 - dw) * hd)
  }
}

/** Price of non-food good g at settlement i. */
function setGoodPrice(ts: TradeState, i: number, g: number): void {
  const k = i * G + g
  const D = ts.demand[k]
  if (ts.hv !== null && ts.hv[g] === 1) { hvPrice(ts, k, D); return } // goods: scarcity prices of the high-value classes
  const inv = 1 / (1 + ts.stock[k] / D)
  const V = g >= 6 ? ts.worth[k] : GOODS.value[g] // species-v2: the new goods' worth varies (wealth, habit)
  ts.price[k] = V * 2 * inv
  ts.deriv[k] = (V * 2 * inv * inv) / D
}

/** Creates the route for pair p (first opening): records its path and transit settlements. */
function createRoute(s: HistoryState, ts: TradeState, p: number): number {
  const a = ts.pairA[p], b = ts.pairB[p]
  const chain = ts.pairChain[p]
  const r = ts.routeCount++
  ensureRoutes(ts, r + 1)
  ts.routeIndex.set(a * KEY + b, r)
  ts.rA.push(a)
  ts.rB.push(b)
  ts.rOpened.push(s.year)
  const path = chainPath(s, ts, chain)
  ts.rPath.push(path)
  // Transit: the settlements the chain passes through, and where goods change between land and
  // sea, the trading settlement whose region holds that shore (transshipment: ports, river mouths, straits).
  const transit = chain.slice(1, chain.length - 1)
  const T = s.terrain
  for (let k = 1; k < path.length; k++) {
    const c0 = path[k - 1], c1 = path[k]
    if (T.sea[c0] === T.sea[c1]) continue
    const shore = T.sea[c0] ? c1 : c0
    if (ts.stamp[shore] !== ts.run) continue
    const x = ts.label[shore]
    if (x !== a && x !== b && transit.indexOf(x) < 0) transit.push(x)
  }
  ts.rTransit.push(transit)
  let bySea = 0
  for (let k = 1; k < path.length; k++) if (T.sea[path[k]]) { bySea = 1; break }
  ts.rSea[r] = bySea
  // The peoples at both ends learn the way.
  learnPath(s, a, path, false)
  if (s.people[b] !== s.people[a]) learnPath(s, b, path, false)
  return r
}

function closeRoute(s: HistoryState, ts: TradeState, r: number): void {
  ts.rOpen[r] = 0
  ts.rVol[r] = 0
  ts.rIdle[r] = 0
  logEvent(s, EventType.TradeClosed, ts.rA[r], ts.rB[r], r)
}

/**
 * System: the yearly market. Runs after the food system (this year's
 * harvest) and before the population system (which eats what is left).
 */
export function tradeSystem(s: HistoryState, ts: TradeState): void {
  ensureSettlements(ts, s.count)
  const living = s.living
  const { stock, demand, income, throughYear, food0, trader, res } = ts
  const need = GOODS.need
  const workHalf = GOODS.workHalf
  const tech = s.tech
  const gx = s.goods // goods:
  const tz = s.tz // tourism:
  let traders = 0
  trader.fill(0, 0, s.count) // (abandoned settlements never trade)
  if (TRADERS.length < living.length) TRADERS = new Int32Array(2 * living.length)
  const tl = TRADERS // (the traders in living order: the loops below that only touch traders)
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const on = s.pop[id] >= TRADE.minPop || (gx !== null && id < gx.cap && gx.postOf[id] >= 0) || (tz !== null && id < tz.cap && tz.resort[id] === 1) ? 1 : 0 // goods: trading posts always trade; tourism: so do resorts
    trader[id] = on
    if (on) tl[traders] = id
    traders += on
    income[id] = 0
    throughYear[id] = 0
  }
  // Links, partners and resources every linkStep years (as soon as two settlements can trade).
  if (traders >= 2 && (ts.linkYear < 0 || s.year - ts.linkYear >= TRADE.linkStep)) {
    if (s.pol !== null) flushAccounts(s, s.pol, ts) // polities: (v2) the accounts of the old pairs first
    rebuildLinks(s, ts)
    rebuildResources(s, ts)
    rebuildPairs(s, ts)
  }
  ts.goodYear.fill(0)
  for (const r of ts.openList) ts.rVol[r] = 0
  if (ts.pairCount === 0) { settle(s, ts); return }

  // Stocks, needs and prices of the traders.
  for (let t = 0; t < traders; t++) {
    const id = tl[t]
    const o = id * G
    const p = s.pop[id]
    const F = s.supply[id]
    const ff = s.fishFrac[id], lf = s.liveFrac[id]
    stock[o] = F * (1 - ff - lf)
    stock[o + 1] = F * ff
    stock[o + 2] = F * lf
    // Non-food output: labour times Crafts (felling, boiling salt) or Metalworking (ore); needs for it grow with Crafts.
    const to = s.people[id] * TECH_FIELD_COUNT
    const crafts = tech[to + TechField.Crafts]
    const lab = p / (p + workHalf)
    stock[o + 3] = res[id * 3] * lab * crafts
    stock[o + 4] = res[id * 3 + 1] * lab * tech[to + TechField.Metalworking]
    stock[o + 5] = res[id * 3 + 2] * lab * crafts
    const demTech = 1 + GOODS.demandTech * (crafts - 1)
    for (let g = 0; g < G; g++) demand[o + g] = need[g] * p * (g < FOOD ? 1 : demTech)
    food0[id] = F
    ts.bid[id] = 1 + WEALTH.bid * prosperity(s, id)
    ts.pack[id] = packOf(s, id)
    marketGoods(s, ts, id, o, demTech) // species-v2: Cloth, Luxury, Stimulant (and bamboo timber)
    if (gx !== null) goodsStock(s, ts, gx, id, o, demTech) // goods: held stocks, class units by variety, the new classes
    if (tz !== null && id < tz.cap && tz.visitors[id] > 0) tourismDemand(tz, id, p, demand, o) // tourism: luxuries and finery where visitors stay
    ts.perish[id] = perishOf(s, id) // species-v2
    setFoodPrices(s, ts, id)
    for (let g = FOOD; g < G; g++) setGoodPrice(ts, id, g)
  }

  // Market sweeps.
  const { pairA, pairB, pairCost, pairRoute, pairFlow, price, deriv, rOpen } = ts
  const V = GOODS.value
  const tUnit = new Float64Array(G)
  const minGap = new Float64Array(G)
  for (let g = 0; g < G; g++) { tUnit[g] = GOODS.transport[g]; minGap[g] = TRADE.minGap * V[g] }
  const tt = GOODS.transportTech
  const peopleOf = s.people
  const P = ts.pairCount
  pairFlow.fill(0)
  const damping = TRADE.damping, maxShare = TRADE.maxShare, margin = TRADE.margin
  const probeOff = s.year % TRADE.probeStep !== 0
  // species-v2: goods nobody trading holds this year move nowhere (their price is the same everywhere): skipped.
  const goods = GOODS_LIST
  let nGoods = 0
  for (let g = 0; g < G; g++) {
    let any = g < 6
    for (let t = 0; t < traders && !any; t++) if (stock[tl[t] * G + g] > 0) any = true
    if (any) goods[nGoods++] = g
  }
  const perish = ts.perish, cashShare = CASHCROP.maxShare, v2 = s.sp.v2 // species-v2 (hoisted)
  const pol = s.pol // polities:
  const hvEvery = STOCK.hvEvery // goods:
  // polities (v2): this year's duties, embargoes (war included), smuggling and the costs of pirates and bandits per pair;
  // pairs under a duty or an embargo take the restricted path below (legal flow net of duty, then contraband).
  const pc: PairPolicy | null = pol !== null ? pairPolicy(s, pol, ts) : null
  // A legal flow under a duty: merchants pass most of the duty on (only TARIFF.wedge of it enters the gap they need); a
  // share sig of the flow evades it as contraband (no duty; a share seize * enforcement seized; the smugglers' cut to the
  // hub). Duties, seizures and cuts are summed per pair and paid out as the market closes (polity/outlaw.ts marketClosed).
  const restrictedFlow = (p: number, from: number, to: number, g: number, net: number, dir: number, duty: number, sig: number, enf: number): void => {
    const kf = from * G + g, kt = to * G + g
    let qq = (damping * net) / (deriv[kf] + deriv[kt])
    const lim = (g >= 6 ? cashShare : maxShare) * stock[kf]
    if (qq > lim) qq = lim
    if (!(qq > 1e-6)) return
    const pt = price[kt]
    const x = pc as PairPolicy
    const qs = sig * qq
    if (qs > 0) {
      // (what is seized is worth its value to the enforcer; the goods themselves stay in the market)
      const seized = SMUGGLE.seize * enf * qs
      const v = (qs - seized) * V[g]
      x.smug[p] += v
      const cut = SMUGGLE.hubCut * net * (qs - seized)
      if (dir === 0) { x.revAB[p] += seized * pt; x.cutAB[p] += cut; if (cut > x.bestAB[p]) { x.bestAB[p] = cut; x.gAB[p] = g } }
      else { x.revBA[p] += seized * pt; x.cutBA[p] += cut; if (cut > x.bestBA[p]) { x.bestBA[p] = cut; x.gBA[p] = g } }
    }
    stock[kf] -= qq
    stock[kt] += qq
    if (g >= 7) stimFlow(v2, g, from, to, qq, stock[kf] + qq, pt)
    income[from] += qq * (0.5 * net + margin * V[g])
    const d = duty * pt * (qq - qs)
    if (d > 0) { if (dir === 0) x.revAB[p] += d; else x.revBA[p] += d }
    pairFlow[(p * G + g) * 2 + dir] += qq
    x.legal[p] += (qq - qs) * V[g]
    if (g < FOOD) { setFoodPrices(s, ts, from); setFoodPrices(s, ts, to) }
    else { setGoodPrice(ts, from, g); setGoodPrice(ts, to, g) }
  }
  // Under an embargo (or war) only contraband moves: a share sig of what the market would move, at premium times the transport.
  const smuggleFlow = (p: number, from: number, to: number, g: number, net: number, dir: number, sig: number, enf: number): void => {
    const kf = from * G + g, kt = to * G + g
    let qq = (sig * damping * net) / (deriv[kf] + deriv[kt])
    const lim = sig * (g >= 6 ? cashShare : maxShare) * stock[kf]
    if (qq > lim) qq = lim
    if (!(qq > 1e-6)) return
    const pt = price[kt]
    const x = pc as PairPolicy
    // (what is seized is worth its value to the enforcer; the goods themselves stay in the market)
    const seized = SMUGGLE.seize * enf * qq
    const got = qq - seized
    const v = got * V[g]
    x.smug[p] += v
    const cut = SMUGGLE.hubCut * net * got
    if (dir === 0) { x.revAB[p] += seized * pt; x.cutAB[p] += cut; if (cut > x.bestAB[p]) { x.bestAB[p] = cut; x.gAB[p] = g } }
    else { x.revBA[p] += seized * pt; x.cutBA[p] += cut; if (cut > x.bestBA[p]) { x.bestBA[p] = cut; x.gBA[p] = g } }
    if (gx !== null && g >= 7) { // goods: the high-value classes (their variety mix moves; secret contraband is the smuggled seeds' channel)
      hvMoved(s, ts, gx, from, to, g, qq, pt, 1)
      income[from] += qq * margin * V[g]
      pairFlow[(p * G + g) * 2 + dir] += qq
      return
    }
    stock[kf] -= qq
    stock[kt] += qq
    if (g >= 7) stimFlow(v2, g, from, to, qq, stock[kf] + qq, pt)
    income[from] += qq * margin * V[g]
    pairFlow[(p * G + g) * 2 + dir] += qq
    if (g < FOOD) { setFoodPrices(s, ts, from); setFoodPrices(s, ts, to) }
    else { setGoodPrice(ts, from, g); setGoodPrice(ts, to, g) }
  }
  const wedge = TARIFF.wedge, foodDuty = TARIFF.food
  const hvDuty = TARIFF.hv // goods: the high-value classes pay this share of the rate
  /** A flow q of good g on duty pair p (dir 0: a to b), net gap net, at the importer's price pt: summed for marketClosed. */
  const dutyFlow = (p: number, g: number, dir: number, q: number, net: number, pt: number): void => {
    const x = pc as PairPolicy
    const v = q * V[g], w = q * pt
    const fw = g < FOOD ? foodDuty : gx !== null && g >= 7 ? hvDuty : 1
    if (dir === 0) { x.vAB[p] += v; x.pvAB[p] += w; x.dbAB[p] += fw * w; x.nbAB[p] += net * q; if (v > x.bestAB[p]) { x.bestAB[p] = v; x.gAB[p] = g } }
    else { x.vBA[p] += v; x.pvBA[p] += w; x.dbBA[p] += fw * w; x.nbBA[p] += net * q; if (v > x.bestBA[p]) { x.bestBA[p] = v; x.gBA[p] = g } }
  }
  /** A pair under an embargo (food legal, under a duty) or at war: contraband only. */
  const blocked = (p: number, a: number, b: number, c: number, oa: number, ob: number): void => {
    const x = pc as PairPolicy
    const bk = x.block[p]
    const prem = SMUGGLE.premium
    const dAB = x.dAB[p], dBA = x.dBA[p]
    for (let gi = 0; gi < nGoods; gi++) {
      const g = goods[gi]
      if (g >= 6 && !(stock[oa + g] > 0) && !(stock[ob + g] > 0)) continue
      const mg = minGap[g]
      const gap = price[ob + g] - price[oa + g]
      if (gx !== null && g >= 7) { // goods: high-value classes travel by the value density of the sender's mix (reckoned for the way the gap runs)
        if (gap > 0) {
          if (x.sAB[p] > 0) { const tA = hvTransport(gx, a, g, stock[oa + g]) * c; if (gap > prem * tA + mg) smuggleFlow(p, a, b, g, gap - prem * tA, 0, x.sAB[p], x.eAB[p]) }
        } else if (x.sBA[p] > 0) { const tB = hvTransport(gx, b, g, stock[ob + g]) * c; if (-gap > prem * tB + mg) smuggleFlow(p, b, a, g, -gap - prem * tB, 1, x.sBA[p], x.eBA[p]) }
        continue
      }
      const tg = tUnit[g] * c
      const tA = g === 0 ? tg * perish[a] : tg
      const tB = g === 0 ? tg * perish[b] : tg
      if (bk === 2 && g < FOOD) { // (an embargo stops all but food)
        const rA = dAB * foodDuty, rB = dBA * foodDuty
        const dA = wedge * rA * price[ob + g], dB = wedge * rB * price[oa + g]
        if (gap > tA + dA + mg) restrictedFlow(p, a, b, g, gap - tA - dA, 0, rA, 0, 0)
        else if (-gap > tB + dB + mg) restrictedFlow(p, b, a, g, -gap - tB - dB, 1, rB, 0, 0)
        continue
      }
      if (gap > prem * tA + mg) { if (x.sAB[p] > 0) smuggleFlow(p, a, b, g, gap - prem * tA, 0, x.sAB[p], x.eAB[p]) }
      else if (-gap > prem * tB + mg && x.sBA[p] > 0) smuggleFlow(p, b, a, g, -gap - prem * tB, 1, x.sBA[p], x.eBA[p])
    }
  }
  if (gx !== null) { pairCuts(s, ts, gx); forwardPrices(s, ts, gx) } // goods: middlemen's cuts, merchants' forward prices
  const dzMul = diseaseTradeMul(s) // disease: (null when nothing is touched this year, or the system is off)
  for (let pass = 0; pass < TRADE.passes; pass++) {
    for (let p = 0; p < P; p++) {
      const a = pairA[p], b = pairB[p]
      if (!trader[a] || !trader[b]) continue
      const r = pairRoute[p]
      if (r < 0 && probeOff) continue
      // Transport gets cheaper with the Crafts of the two ends' peoples (their mean).
      const cr = 0.5 * (tech[peopleOf[a] * TECH_FIELD_COUNT + TechField.Crafts] + tech[peopleOf[b] * TECH_FIELD_COUNT + TechField.Crafts])
      // Pack animals at the two ends carry it cheaper.
      const c0 = (pairCost[p] * (r >= 0 && rOpen[r] ? 1 : 1 + TRADE.openHurdle) * 0.5 * (ts.pack[a] + ts.pack[b])) / (1 + tt * (cr - 1))
      let c = pc !== null ? c0 * pc.cost[p] : c0 // polities: (v2) pirates, privateers, blockade, bandits on the way
      if (dzMul !== null) c *= dzMul[a] * dzMul[b] // disease: sick places and quarantined ports trade at a cost
      const oa = a * G, ob = b * G
      // polities: the share of the cargo lost on the way (WAYRISK): merchants weigh it against the goods' worth at the buyer's.
      const lv = pc !== null ? pc.lost[p] : 0
      const keep = 1 - lv
      // polities: (v2) a pair under a duty prices it in (only TARIFF.wedge of it: merchants pass the rest on) and sums
      // what crosses for the accounts (duty, evasion, seizure: marketClosed); one under an embargo or at war takes blocked().
      let rp = false, wAB = 0, wBA = 0
      if (pc !== null && pc.code[p] !== 0) {
        if (pc.block[p] !== 0) { blocked(p, a, b, c, oa, ob); continue }
        rp = true
        wAB = wedge * pc.dAB[p]
        wBA = wedge * pc.dBA[p]
      }
      // goods: high-value goods keep in store: local merchants deal in them on each pair every other year (half the pairs a
      // year; the goods list is ascending, so the high-value classes come last).
      const hvOff = gx !== null && (s.year + p) % hvEvery !== 0
      for (let gi = 0; gi < nGoods; gi++) {
        const g = goods[gi]
        if (hvOff && g >= 7) break
        if (g >= 6 && !(stock[oa + g] > 0) && !(stock[ob + g] > 0)) continue // species-v2: nothing to move (same outcome, cheaper)
        if (gx !== null && g >= 7) { // goods: high-value classes (polities: under the duty's wedge, its flows summed for the accounts)
          if (hvPair(s, ts, gx, p, a, b, g, c, wAB * hvDuty, wBA * hvDuty, lv) && rp) dutyFlow(p, g, HVR.dir, HVR.q, HVR.net, HVR.pt)
          continue
        }
        const gap = price[ob + g] - price[oa + g]
        const tr = g === 0 ? tUnit[0] * c * (gap > 0 ? perish[a] : perish[b]) : tUnit[g] * c // species-v2: perishable grain
        // (polities: what arrives of it, at the buyer's price: the gap each way)
        const gAB = lv > 0 ? price[ob + g] * keep - price[oa + g] : gap, gBA = lv > 0 ? price[oa + g] * keep - price[ob + g] : -gap
        let from: number, to: number, net: number, dir: number
        if (rp) { // polities: (v2) the duty's wedge (food pays a lower duty)
          const fw = g < FOOD ? foodDuty : 1
          const dA = wAB * fw * price[ob + g], dB = wBA * fw * price[oa + g]
          if (gAB > tr + dA + minGap[g]) { from = a; to = b; net = gAB - tr - dA; dir = 0 }
          else if (gBA > tr + dB + minGap[g]) { from = b; to = a; net = gBA - tr - dB; dir = 1 }
          else continue
        } else {
          const tm = tr + minGap[g]
          if (gAB > tm) { from = a; to = b; net = gAB - tr; dir = 0 }
          else if (gBA > tm) { from = b; to = a; net = gBA - tr; dir = 1 }
          else continue
        }
        const kf = from * G + g, kt = to * G + g
        let q = (damping * net) / (deriv[kf] + deriv[kt])
        const cap = (g >= 6 ? cashShare : maxShare) * stock[kf] // species-v2: light, dear goods leave in bulk
        if (q > cap) q = cap
        if (!(q > 1e-6)) continue
        stock[kf] -= q
        stock[kt] += lv > 0 ? q * keep : q // (polities: short by what the way took)
        if (g >= 7) stimFlow(v2, g, from, to, q, stock[kf] + q, price[kt]) // species-v2: buyers pay for luxuries and stimulants (and which stimulants moved)
        income[from] += q * (0.5 * net + margin * V[g])
        pairFlow[(p * G + g) * 2 + dir] += q
        if (rp) dutyFlow(p, g, dir, q, net, price[kt]) // polities: (v2)
        if (g < FOOD) { setFoodPrices(s, ts, from); setFoodPrices(s, ts, to) }
        else { setGoodPrice(ts, from, g); setGoodPrice(ts, to, g) }
      }
    }
  }

  if (gx !== null) longHaulSweep(s, ts, gx) // goods: mart to mart, one leg a year

  // Routes: open on first flow, record volume and goods.
  for (let p = 0; p < P; p++) {
    const a = pairA[p], b = pairB[p]
    if (!trader[a] || !trader[b]) continue
    let vol = 0, hvl = 0
    const o = p * G * 2
    // (only the goods traded this year can have moved: the others' flows are 0; goods: hvl sums the high-value classes' loads
    // in hvLoads's order, without its +0 terms)
    for (let gi = 0; gi < nGoods; gi++) { const g = goods[gi]; const x = (pairFlow[o + g * 2] + pairFlow[o + g * 2 + 1]) * V[g]; vol += x; if (g >= 7) hvl += x }
    if (!(vol > 0)) continue
    let r = pairRoute[p]
    if (r < 0) { r = createRoute(s, ts, p); pairRoute[p] = r } // (may grow the route buffers: use ts.* below)
    if (!ts.rOpen[r]) {
      ts.rOpen[r] = 1
      ts.rIdle[r] = 0
      ts.openList.push(r)
      logEvent(s, EventType.TradeOpened, a, b, r)
      if (pol !== null) routeOpened(s, pol, ts, r) // polities: a route forsaken for danger restored
    }
    ts.rVol[r] = vol
    if (pol !== null) routeLoads(pol, r, vol) // polities: (its peak, for TradeForsaken)
    const og = r * G * 2
    for (let gi = 0; gi < nGoods; gi++) {
      const g = goods[gi]
      const ab = pairFlow[o + g * 2], ba = pairFlow[o + g * 2 + 1]
      ts.rGood[og + g * 2] += ab
      ts.rGood[og + g * 2 + 1] += ba
      ts.goodYear[g] += (ab + ba) * V[g]
    }
    if (pc !== null) { pc.route[p] = r; const l = pc.loss[p]; if (l > 0) pc.lossV[p] += l * vol } // polities: (v2) cargo lost to pirates and bandits (paid out by flushAccounts)
    // (A port at the end of a way by sea is a gateway: goods change there between the ships and the land.)
    const sw = ts.rSea[r] === 1 ? TRADE.portWeight : TRADE.ownWeight
    throughYear[a] += (s.port[a] >= 0 ? sw : TRADE.ownWeight) * vol
    throughYear[b] += (s.port[b] >= 0 ? sw : TRADE.ownWeight) * vol
    const transit = ts.rTransit[r]
    const hvv = gx !== null ? gx.pairHv[p] : 0
    const tollVol = gx !== null ? vol - hvl : vol // goods: high-value goods pay their cut instead (hvLoads)
    for (let k = 0; k < transit.length; k++) {
      const x = transit[k]
      if (s.abandoned[x] >= 0) continue
      throughYear[x] += vol
      income[x] += TRADE.toll * tollVol
      if (hvv > 0 && ts.trader[x]) { const cut = cutOf(s, x) * hvv; income[x] += cut; noteIncome(s, gx!, 14, cut) } // goods: every hand takes a cut (none where nothing of value moved)
    }
  }

  if (pol !== null && s.year % ACCOUNTS === ACCOUNTS - 1) flushAccounts(s, pol, ts) // polities: (v2) duties, contraband, plunder paid out
  // Fed by what is left after trade.
  for (let t = 0; t < traders; t++) {
    const id = tl[t]
    const o = id * G
    const F = stock[o] + stock[o + 1] + stock[o + 2]
    const p = s.pop[id]
    s.supply[id] = F
    s.food[id] = F >= p ? 1 : F / p
    s.foodImport[id] += WEALTH.importSmoothing * (F - food0[id] - s.foodImport[id])
  }
  if (gx !== null) goodsSettle(s, ts, gx) // goods: workshops, consumption, tools and arms, stocks carried over
  settle(s, ts)
}

/** Hub size x = sqrt(t / hubRef) of settlement `id`, t = smoothed loads passing through it plus ownWeight times those on its own routes. */
export function hubSize(s: HistoryState, id: number): number {
  return Math.sqrt(s.through[id] / WEALTH.hubRef)
}

/** Idle routes close; wealth, hub status and the food multiplier update; non-traders' imports fade. */
function settle(s: HistoryState, ts: TradeState): void {
  // Routes without trade this year idle, and close after closeYears.
  const list = ts.openList
  let w = 0
  for (let t = 0; t < list.length; t++) {
    const r = list[t]
    ts.rRoadAcc[r] += ts.rVol[r]
    if (ts.rVol[r] < TRADE.closeMin) ts.rIdle[r]++
    else ts.rIdle[r] = 0
    if (ts.rIdle[r] >= TRADE.closeYears) { closeRoute(s, ts, r); if (s.pol !== null) routeClosed(s, s.pol, ts, r); continue } // (polities: forsaken for danger?)
    list[w++] = r
  }
  list.length = w
  const living = s.living
  const W = WEALTH
  const pol = s.pol // polities:
  if (pol !== null) incomeWatch(s, pol, ts.income) // polities: (v2) smoothed income and contraband income of hubs and capitals
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const p = s.pop[id]
    const wealth = s.wealth[id] * (1 - W.decay) + ts.income[id]
    s.wealth[id] = wealth
    s.through[id] += 0.2 * (ts.throughYear[id] - s.through[id])
    if (!ts.trader[id]) s.foodImport[id] *= 1 - W.importSmoothing
    const pw = p > 0 ? wealth / p : 0
    const hub = W.hubK * hubSize(s, id)
    s.econ[id] = 1 + (W.cap * pw) / (pw + W.half) + (hub < W.hubCap ? hub : W.hubCap)
    ts.income[id] = 0
    ts.throughYear[id] = 0
  }
}

/** System (after abandonment): routes with an abandoned end close this year. */
export function tradeAbandonSystem(s: HistoryState, ts: TradeState): void {
  const list = ts.openList
  let w = 0
  for (let t = 0; t < list.length; t++) {
    const r = list[t]
    if (s.abandoned[ts.rA[r]] >= 0 || s.abandoned[ts.rB[r]] >= 0) { closeRoute(s, ts, r); continue }
    list[w++] = r
  }
  list.length = w
}

/** System (every ROAD.step years): route traffic wears roads into land cells; roads fade without it; travel costs follow. */
export function roadSystem(s: HistoryState, ts: TradeState): void {
  const T = s.terrain
  const lake = s.world.lake
  const dt = ROAD.step
  const { traffic, isRoad, roadCells } = ts
  let count = ts.roadCount
  for (let r = 0; r < ts.routeCount; r++) {
    const acc = ts.rRoadAcc[r]
    if (!(acc > 0)) continue
    ts.rRoadAcc[r] = 0
    const per = acc / dt
    const path = ts.rPath[r]
    for (let k = 0; k < path.length; k++) {
      const c = path[k]
      if (T.sea[c] || lake[c]) continue
      traffic[c] += per
      if (!isRoad[c]) { isRoad[c] = 1; roadCells[count++] = c }
    }
  }
  const road = s.road
  const R = ROAD
  const up = R.riseRate * dt, down = R.fadeRate * dt
  let w = 0
  for (let t = 0; t < count; t++) {
    const c = roadCells[t]
    const tr = traffic[c]
    traffic[c] = 0
    const tg = tr / (tr + R.half)
    let x = road[c]
    x += (tg - x) * (tg > x ? up : down)
    if (tr === 0 && x < R.epsilon) {
      road[c] = 0
      s.moveCost[c] = T.moveCost[c]
      isRoad[c] = 0
      continue
    }
    road[c] = x
    s.moveCost[c] = T.moveCost[c] * (1 - R.discount * x)
    roadCells[w++] = c
  }
  ts.roadCount = w
}

/** Flattens the routes into the contract shape (each array with its own buffer). Main goods: most carried each way over the run. */
export function assembleTrade(ts: TradeState): {
  count: number
  a: Int32Array
  b: Int32Array
  openedYear: Float32Array
  goodAB: Uint8Array
  goodBA: Uint8Array
  pathOffsets: Uint32Array
  path: Uint32Array
} {
  const R = ts.routeCount
  const a = Int32Array.from(ts.rA)
  const b = Int32Array.from(ts.rB)
  const openedYear = Float32Array.from(ts.rOpened)
  const goodAB = new Uint8Array(R)
  const goodBA = new Uint8Array(R)
  const pathOffsets = new Uint32Array(R + 1)
  let total = 0
  for (let r = 0; r < R; r++) total += ts.rPath[r].length
  const path = new Uint32Array(total)
  let off = 0
  for (let r = 0; r < R; r++) {
    let bestAB = 0, bestBA = 0
    const o = r * G * 2
    for (let g = 1; g < G; g++) {
      if (ts.rGood[o + g * 2] * GOODS.value[g] > ts.rGood[o + bestAB * 2] * GOODS.value[bestAB]) bestAB = g
      if (ts.rGood[o + g * 2 + 1] * GOODS.value[g] > ts.rGood[o + bestBA * 2 + 1] * GOODS.value[bestBA]) bestBA = g
    }
    // A direction that never carried anything takes the other direction's good.
    if (!(ts.rGood[o + bestAB * 2] > 0)) bestAB = bestBA
    if (!(ts.rGood[o + bestBA * 2 + 1] > 0)) bestBA = bestAB
    goodAB[r] = bestAB
    goodBA[r] = bestBA
    pathOffsets[r] = off
    const p = ts.rPath[r]
    for (let k = 0; k < p.length; k++) path[off + k] = p[k]
    off += p.length
  }
  pathOffsets[R] = off
  return { count: R, a, b, openedYear, goodAB, goodBA, pathOffsets, path }
}
