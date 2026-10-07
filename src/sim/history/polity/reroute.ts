// polities: an open trade route re-paths round danger (WAYRISK.reroute; policy.ts calls rerouteStep at every full refresh of
// the pairs' policy, every POLITY.slowStep years, after the merchants' risk per cell is refreshed).
//
// A route's path is fixed when it opens (trade.ts createRoute); before, a road through newly dangerous land could only idle
// and close. Now, at each refresh, an open route whose way the danger makes markedly dearer looks for another:
//   cost of a way  = the sum over its steps of the route's travel cost there (trade.ts routeCost: land, sea and deep sea by
//                    the ends' ports, camels and llamas) times (1 + WAYRISK.path * risk), the risk of the cell entered, or 1
//                    for a step from one polity's land straight into its enemy's at war (a war front)
//   candidates     = open routes whose ends are not themselves at war, whose current way costs at least rerouteGain more for
//                    its danger than without it (danger alone could pay for a re-path), and that last re-pathed at least
//                    rerouteGap years ago
//   the search     = a bounded cheapest-way search from one end to the other over the cells either end's people knows
//                    (rerouteVisits cells at most), pruned at (1 - rerouteGain) of the current way's cost
//   re-path        = when the new way costs less than (1 - rerouteGain) of the current one (hysteresis: paths do not flicker)
// A route that re-pathed keeps the way it opened along (its first path) and goes back to it when the danger there has
// fallen, by the same rule (the first way costing less than (1 - rerouteGain) of the current one). The route keeps its id
// (History.trade, keyed by the pair); each re-path is recorded with its year (History.trade.repath*), its transit
// settlements (tolls) and its sea flag are taken again along the new way, both peoples learn it, and the lanes near the
// sea are mapped again at the next outlaw step (pirates strike the ways that pass them now). The pair's cost is the new
// way's (the market pays its own cost, as on any route).
// Deterministic: the routes in pair order, the heap ordered by key then cell.

import type { HistoryState } from '../state.ts'
import type { TradeState } from '../trade.ts'
import { oceanCost, routeCost } from '../trade.ts'
import { TRADE } from '../params.ts'
import { Heap } from '../heap.ts'
import { learnPath } from '../knowledge.ts'
import { moveMuls } from '../species.ts'
import { WAYRISK } from './params.ts'
import { atWar } from './formation.ts'
import { embargoCode } from './policy.ts'
import { ensureRoutesP } from './state.ts'
import type { PolityState } from './state.ts'

/** Search scratch (per cell; stamped per search). */
let DIST = new Float64Array(0), PREV = new Int32Array(0), STAMP = new Int32Array(0), RUN = 0
const HEAP = new Heap(1024)
const MA = new Float64Array(3), MB = new Float64Array(3)
/** The route's step costs this refresh: sea factor, deep-sea cost, the two ends' move-class factors (set by setRoute). */
const RC = { seaMul: 0, ocean: 0 }

function setRoute(s: HistoryState, ts: TradeState, r: number): void {
  const a = ts.rA[r], b = ts.rB[r]
  const pa = s.port[a] >= 0, pb = s.port[b] >= 0
  RC.seaMul = 0.5 * ((pa ? TRADE.seaPort : TRADE.seaNoPort) + (pb ? TRADE.seaPort : TRADE.seaNoPort))
  RC.ocean = 0.5 * (oceanCost(s, a, pa) + oceanCost(s, b, pb))
  moveMuls(s, a, MA)
  moveMuls(s, b, MB)
}

/** Travel cost of entering cell j on route (as trade.ts routeCost). */
function stepCost(s: HistoryState, j: number): number {
  const T = s.terrain
  if (T.deep[j]) return RC.ocean
  if (T.sea[j]) return T.moveCost[j] * RC.seaMul
  const m = s.sp.moveClass[j]
  return s.moveCost[j] * 0.5 * (MA[m] + MB[m])
}

/** Polity of the land cell c (its owner's, -1 for sea, wilderness or an abandoned owner). */
function polAt(s: HistoryState, ps: PolityState, c: number): number {
  const w = ps.tOwner[c]
  return w >= 0 && w < ps.seen && s.abandoned[w] < 0 ? ps.polity[w] : -1
}

/** The danger weight of the step from cell c into cell j: risk there, or 1 across a war front. */
function weight(s: HistoryState, ps: PolityState, c: number, j: number): number {
  let x = ps.wayRisk[j]
  if (WAYRISK.warFront && x < 1) {
    const p = polAt(s, ps, c)
    if (p >= 0) { const q = polAt(s, ps, j); if (q >= 0 && q !== p && atWar(ps, p, q)) x = 1 }
  }
  return x
}

/** Cost of a way: [with the danger, without it] into WC. */
const WC = { risk: 0, plain: 0 }
function wayCost(s: HistoryState, ps: PolityState, path: readonly number[]): void {
  const kp = WAYRISK.path
  let rc = 0, pc = 0
  for (let k = 1; k < path.length; k++) {
    const j = path[k]
    const st = stepCost(s, j)
    pc += st
    rc += st * (1 + kp * weight(s, ps, path[k - 1], j))
  }
  WC.risk = rc
  WC.plain = pc
}

/** The cheapest way from a's cell to b's under the danger, if it costs less than `bound` (else null). */
function search(s: HistoryState, ps: PolityState, ts: TradeState, r: number, bound: number): number[] | null {
  const N = s.terrain.cellCount
  if (DIST.length < N) { DIST = new Float64Array(N); PREV = new Int32Array(N); STAMP = new Int32Array(N) }
  const run = ++RUN
  const a = ts.rA[r], b = ts.rB[r]
  const src = s.cell[a], dst = s.cell[b]
  const known = s.know.known
  const ka = s.people[a] * N, kb = s.people[b] * N
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const kp = WAYRISK.path
  const heap = HEAP
  heap.size = 0
  STAMP[src] = run; DIST[src] = 0; PREV[src] = -1
  heap.push(0, src)
  let visits = 0
  const maxV = WAYRISK.rerouteVisits
  while (heap.size > 0) {
    const d = heap.topKey()
    if (d >= bound) return null
    const c = heap.pop()
    if (d > DIST[c]) continue
    if (c === dst) {
      const out: number[] = []
      for (let x = c; x >= 0; x = PREV[x]) out.push(x)
      out.reverse()
      return out
    }
    if (++visits > maxV) return null
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (known[ka + j] < 0 && known[kb + j] < 0) continue // (a way neither end's people knows)
      const nd = d + stepCost(s, j) * (1 + kp * weight(s, ps, c, j))
      if (nd >= bound) continue
      if (STAMP[j] === run && nd >= DIST[j]) continue
      STAMP[j] = run
      DIST[j] = nd
      PREV[j] = c
      heap.push(nd, j)
    }
  }
  return null
}

/** Route r follows `path` from this year: transit, sea flag, the peoples' knowledge, the pair's way and cost, the record. */
function repath(s: HistoryState, ps: PolityState, ts: TradeState, r: number, pair: number, path: number[]): void {
  const a = ts.rA[r], b = ts.rB[r]
  if (ps.rOrig[r].length === 0) ps.rOrig[r] = ts.rPath[r]
  ts.rPath[r] = path
  // Transit: the trading settlements the way passes through, and where the goods change between land and sea, the trader
  // whose region (the last link search) holds that shore (transshipment), as trade.ts createRoute.
  const transit: number[] = []
  const T = s.terrain
  for (let k = 1; k + 1 < path.length; k++) {
    const x = s.occupant[path[k]]
    if (x >= 0 && x !== a && x !== b && ts.trader[x] && transit.indexOf(x) < 0) transit.push(x)
  }
  let bySea = 0
  for (let k = 1; k < path.length; k++) {
    const c0 = path[k - 1], c1 = path[k]
    if (T.sea[c1]) bySea = 1
    if (T.sea[c0] === T.sea[c1]) continue
    const shore = T.sea[c0] ? c1 : c0
    if (ts.stamp[shore] !== ts.run) continue
    const x = ts.label[shore]
    if (x !== a && x !== b && s.abandoned[x] < 0 && transit.indexOf(x) < 0) transit.push(x)
  }
  ts.rTransit[r] = transit
  ts.rSea[r] = bySea
  ps.rSea[r] = -1 // (its sea cells counted again: policy.ts routeSea)
  learnPath(s, a, path, false)
  if (s.people[b] !== s.people[a]) learnPath(s, b, path, false)
  ps.rRe[r] = s.year
  ps.laneDirty = true
  ts.reRoute.push(r); ts.reYear.push(s.year); ts.rePath.push(path)
  if (pair >= 0) { ts.pairPath[pair] = path; ts.pairCost[pair] = routeCost(s, ts, r) }
  ps.diag.wayRepaths++
}

/** System part (policy.ts pairPolicy, every full refresh, the merchants' risk fresh): open routes re-path round danger, and back. */
export function rerouteStep(s: HistoryState, ps: PolityState, ts: TradeState): void {
  const W = WAYRISK
  const gain = W.rerouteGain
  const P = ts.pairCount
  ensureRoutesP(ps, ts.routeCount + 1)
  const orig = ps.rOrig
  while (orig.length < ts.routeCount) orig.push(NONE)
  for (let i = 0; i < P; i++) {
    const r = ts.pairRoute[i]
    if (r < 0 || !ts.rOpen[r]) continue
    const a = ts.rA[r], b = ts.rB[r]
    if (s.abandoned[a] >= 0 || s.abandoned[b] >= 0 || !ts.trader[a] || !ts.trader[b]) continue
    if (ps.rRe[r] >= 0 && s.year - ps.rRe[r] < W.rerouteGap) continue
    const pa = a < ps.seen ? ps.polity[a] : -1, pb = b < ps.seen ? ps.polity[b] : -1
    if (embargoCode(ps, pa, pb) === 1) continue // (the ends at war: no way round that)
    setRoute(s, ts, r)
    wayCost(s, ps, ts.rPath[r])
    const cur = WC.risk, plain = WC.plain
    const bound = (1 - gain) * cur
    // Back on the way it opened along, once the danger there has fallen.
    const o = orig[r]
    if (o.length > 0 && o !== ts.rPath[r]) {
      wayCost(s, ps, o)
      if (WC.risk < bound) { repath(s, ps, ts, r, i, o); continue }
    }
    if (cur - plain <= gain * cur) continue // (danger alone could not pay for another way)
    const path = search(s, ps, ts, r, bound)
    if (path !== null) {
      repath(s, ps, ts, r, i, path)
    }
  }
}
const NONE: number[] = []
