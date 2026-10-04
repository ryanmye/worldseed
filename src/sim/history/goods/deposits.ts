// goods: rare deposits, regional specialities from geology (design 1.4).
//
// Placed once at set-up from the world's plates, elevation, climate and rivers (draws from 'history-goods', weighted by a
// placement score, at least DEPOSIT.spacing hops between two of a kind): placer gold in rivers below mountains, lode gold
// and silver in the mountains of plate boundaries (one silver bonanza), gems in the rivers of old stable land, amber on cold
// shallow coasts, pearls on warm ones, murex on warm-temperate ones. Found by the prospectors of settlements whose fields
// reach them (every 10 years, at a chance growing with Metalworking) or at once by an expedition passing within a hop
// (DepositFound). Worked by the settlement with the largest claim on the cell, or by a mining camp (an expedition base) when
// nobody farms there; output falls as the reserve runs down (MineExhausted). A find draws migrants for a few decades (the
// rush); a bonanza that floods the world's Treasure markets logs a Boom.

import { Biome, DepositKind, EventType, Good, PostKind, RIVER_FLOW_THRESHOLD, StructureType, TECH_FIELD_COUNT, TechField, VarietyKind } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import { found, logEvent } from '../state.ts'
import { learn } from '../knowledge.ts'
import type { ExploreState } from '../exploration.ts'
import { registerBase } from '../exploration.ts'
import { DEPOSIT } from './params.ts'
import type { GoodsState } from './state.ts'
import { MIX_OF, Maker, addPost, ensureGoods, logGoods, mixAdd, newVariety } from './state.ts'
import { GOOD_COUNT } from '../../../contract.ts'

const G = GOOD_COUNT
/** Internal kinds: placer gold, lode gold, silver, gems, amber, pearls, murex. */
export const DK = { Placer: 0, Lode: 1, Silver: 2, Gems: 3, Amber: 4, Pearls: 5, Murex: 6 } as const
export const DK_CONTRACT = [DepositKind.Gold, DepositKind.Gold, DepositKind.Silver, DepositKind.Gems, DepositKind.Amber, DepositKind.Pearls, DepositKind.Murex]
export const DK_GOOD = [Good.Treasure, Good.Treasure, Good.Treasure, Good.Treasure, Good.Luxury, Good.Luxury, Good.Luxury]
/** Worth per unit relative to grain of each kind. */
export const DK_VALUE = [60, 60, 40, 80, 30, 40, 50]

/** Cells within `hops` plain hops of c (BFS), c first. */
function ring(s: HistoryState, c: number, hops: number): number[] {
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const out = [c]
  const depth = [0]
  const seen = new Set<number>([c]) // (membership only)
  for (let i = 0; i < out.length; i++) {
    if (depth[i] >= hops) continue
    const x = out[i]
    for (let k = off[x]; k < off[x + 1]; k++) { const j = nb[k]; if (!seen.has(j)) { seen.add(j); out.push(j); depth.push(depth[i] + 1) } }
  }
  return out
}


/** Places the world's deposits (set-up, after the tribes are founded). */
export function placeDeposits(s: HistoryState, g: GoodsState): void {
  const w = s.world
  const T = s.terrain
  const N = T.cellCount
  const { neighborOffsets: off, neighbors: nb, positions: pos } = w.grid
  const rng = g.rng
  // Hops from the nearest plate boundary (capped).
  const bdist = new Int32Array(N).fill(99)
  const queue: number[] = []
  for (let i = 0; i < N; i++) {
    for (let k = off[i]; k < off[i + 1]; k++) if (w.plate[nb[k]] !== w.plate[i]) { bdist[i] = 0; queue.push(i); break }
  }
  for (let h = 0; h < queue.length; h++) {
    const c = queue[h]
    if (bdist[c] >= 12) continue
    for (let k = off[c]; k < off[c + 1]; k++) { const j = nb[k]; if (bdist[j] > bdist[c] + 1) { bdist[j] = bdist[c] + 1; queue.push(j) } }
  }
  // Placer: river cells within 4 steps downstream of a mountain.
  const below = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    if (w.biome[i] !== Biome.Mountain) continue
    let c = w.riverTo[i]
    for (let k = 0; k < 4 && c >= 0; k++) { below[c] = 1; c = w.riverTo[c] }
  }
  const coastNear = (i: number): boolean => { for (let k = off[i]; k < off[i + 1]; k++) if (w.biome[nb[k]] === Biome.Coast) return true; return false }
  const score = (kind: number, i: number): number => {
    if (T.sea[i] || w.lake[i]) return 0
    const e = w.elevation[i], t = w.temperature[i], r = w.rainfall[i], b = w.biome[i]
    const river = w.flow[i] >= RIVER_FLOW_THRESHOLD
    switch (kind) {
      case DK.Placer: return river && below[i] && b !== Biome.Ice ? 1 : 0
      case DK.Lode: return b === Biome.Mountain && bdist[i] <= 2 && e >= 0.45 ? 1 + e : 0
      case DK.Silver: return b === Biome.Mountain && bdist[i] <= 2 && e >= 0.4 ? (1 + e) * (1 + (1 - r)) : 0
      case DK.Gems: return river && bdist[i] >= 10 && e >= 0.05 && e <= 0.3 ? 1 : 0
      case DK.Amber: return T.seaCoast[i] && t <= 0.4 && t >= 0.12 && b !== Biome.Ice && coastNear(i) ? 1 : 0
      case DK.Pearls: return T.seaCoast[i] && t >= 0.75 && coastNear(i) ? (r < 0.3 ? 2 : 1) : 0
      case DK.Murex: return T.seaCoast[i] && t >= 0.55 && t <= 0.75 && coastNear(i) ? 1 : 0
    }
    return 0
  }
  // Mean chord of a hop, for spacing.
  let hc = 0, hn = 0
  for (let i = 0; i < N && hn < 600; i += 37) for (let k = off[i]; k < off[i + 1]; k++) {
    const j = nb[k]
    const dx = pos[i * 3] - pos[j * 3], dy = pos[i * 3 + 1] - pos[j * 3 + 1], dz = pos[i * 3 + 2] - pos[j * 3 + 2]
    hc += Math.sqrt(dx * dx + dy * dy + dz * dz); hn++
  }
  const space = (hc / hn) * DEPOSIT.spacing
  const space2 = space * space
  const kinds: number[] = [], cells: number[] = [], rich: number[] = []
  const wts = new Float64Array(N)
  for (let kind = 0; kind < DEPOSIT.count.length; kind++) {
    let total = 0
    for (let i = 0; i < N; i++) { const x = score(kind, i); wts[i] = x; total += x }
    for (let n = 0; n < DEPOSIT.count[kind]; n++) {
      // Draw a cell by weight among those far enough from the deposits of this contract kind.
      let tw = 0
      for (let i = 0; i < N; i++) {
        if (!(wts[i] > 0)) continue
        let ok = true
        for (let d = 0; d < cells.length && ok; d++) {
          if (DK_CONTRACT[kinds[d]] !== DK_CONTRACT[kind]) continue
          const j = cells[d]
          const dx = pos[i * 3] - pos[j * 3], dy = pos[i * 3 + 1] - pos[j * 3 + 1], dz = pos[i * 3 + 2] - pos[j * 3 + 2]
          if (dx * dx + dy * dy + dz * dz < space2) ok = false
        }
        if (!ok) wts[i] = 0
        else tw += wts[i]
      }
      if (!(tw > 0)) break
      let u = rng.next() * tw
      let pick = -1
      for (let i = 0; i < N; i++) { if (!(wts[i] > 0)) continue; u -= wts[i]; if (u < 0) { pick = i; break } }
      if (pick < 0) for (let i = N - 1; i >= 0; i--) if (wts[i] > 0) { pick = i; break }
      kinds.push(kind); cells.push(pick)
      rich.push(kind === DK.Silver && n === 0 ? DEPOSIT.bonanza : rng.range(0.7, 1.4))
      wts[pick] = 0
    }
    void total
  }
  const D = kinds.length
  g.dCount = D
  g.dKind = Int32Array.from(kinds)
  g.dCell = Int32Array.from(cells)
  g.dRich = Float64Array.from(rich)
  g.dFound = new Int32Array(D).fill(-1)
  g.dFoundBy = new Int32Array(D).fill(-1)
  g.dExh = new Int32Array(D).fill(-1)
  g.dVar = new Int32Array(D).fill(-1)
  g.dR = new Float64Array(D)
  g.dR0 = new Float64Array(D)
  g.dPeak = new Float64Array(D)
  g.dOut = new Float64Array(D)
  g.dWorker = new Int32Array(D).fill(-1)
  g.dCamp = new Int32Array(D).fill(-1)
  g.dMine = new Int32Array(D).fill(-1)
  g.rushUntil = new Int32Array(D).fill(-1)
  g.boomLogged = new Uint8Array(D)
  for (let d = 0; d < D; d++) {
    const k = g.dKind[d]
    const years = k === DK.Silver && g.dRich[d] >= DEPOSIT.bonanza ? DEPOSIT.bonanzaYears : DEPOSIT.reserve[k]
    g.dR0[d] = years > 0 ? years * DEPOSIT.yield[k] * g.dRich[d] : 0
    g.dR[d] = g.dR0[d]
  }
  g.dRing = []
  g.dNear = new Int32Array(N)
  for (let d = 0; d < D; d++) {
    g.dRing.push(ring(s, g.dCell[d], DEPOSIT.rushHops))
    for (const c of ring(s, g.dCell[d], 1)) if (g.dNear[c] === 0) g.dNear[c] = d + 1
  }
}

/** True when the people of settlement id can work deposit d (its technology gate). */
function gateOk(s: HistoryState, g: GoodsState, d: number, id: number): boolean {
  const k = g.dKind[d]
  const f = DEPOSIT.gateField[k]
  return f < 0 || s.tech[s.people[id] * TECH_FIELD_COUNT + f] >= DEPOSIT.gateLevel[k]
}

/** Deposit d found this year by settlement `by` (an expedition's sender when `expedition`). */
function discover(s: HistoryState, g: GoodsState, d: number, by: number, expedition: boolean): void {
  g.dFound[d] = s.year
  g.dFoundBy[d] = by
  const k = g.dKind[d]
  const v = newVariety(s, g, DK_GOOD[k], VarietyKind.Deposit, d, s.people[by], Maker.Settlement, by, DK_VALUE[k], DEPOSIT.rel[k], k === DK.Murex)
  g.dVar[d] = v
  logGoods(s, EventType.DepositFound, by, -1, d, expedition ? 1 : 0)
  const p = s.people[by]
  for (const c of ring(s, g.dCell[d], 2)) learn(s, p, c)
  if (DK_GOOD[k] === Good.Treasure) g.rushUntil[d] = s.year + DEPOSIT.rushYears
  rushMap(s, g)
}

/** Rush multipliers: cells near a fresh Treasure find draw migrants, more for a large share of the world's Treasure output. */
export function rushMap(s: HistoryState, g: GoodsState): void {
  const rush = g.rush
  for (let d = 0; d < g.dCount; d++) for (const c of g.dRing[d]) rush[c] = 1
  for (let d = 0; d < g.dCount; d++) {
    if (g.rushUntil[d] < s.year || g.dExh[d] >= 0) continue
    const k = g.dKind[d]
    const est = DEPOSIT.yield[k] * g.dRich[d]
    const share = g.treasureOut > 0 ? (g.dOut[d] > 0 ? g.dOut[d] : est) / (g.treasureOut + (g.dOut[d] > 0 ? 0 : est)) : 1
    const f = 1 + DEPOSIT.rushK * (share > 1 ? 1 : share)
    for (const c of g.dRing[d]) if (f > rush[c]) rush[c] = f
  }
}

/** An expedition from settlement id passed along `path`: deposits within a hop of it are found at once. */
export function expeditionFinds(s: HistoryState, g: GoodsState, id: number, path: readonly number[]): void {
  const near = g.dNear
  if (near.length === 0) return
  for (let i = 0; i < path.length; i++) {
    const d = near[path[i]] - 1
    if (d < 0 || g.dFound[d] >= 0 || !gateOk(s, g, d, id)) continue
    discover(s, g, d, id, true)
  }
}

/** Every 10 years (year % 10 = 3): prospectors of settlements whose fields reach a deposit may find it; workers are chosen again. */
export function prospect(s: HistoryState, g: GoodsState): void {
  const T = s.terrain
  const rng = g.rng
  for (let d = 0; d < g.dCount; d++) {
    if (g.dFound[d] >= 0) continue
    const cell = g.dCell[d]
    const near = g.dRing[d]
    for (let i = 0; i < near.length; i++) {
      const id = s.occupant[near[i]]
      if (id < 0 || s.outpost[id] || s.abandoned[id] >= 0 || !gateOk(s, g, d, id)) continue
      // Its base catchment covers the cell or a neighbour of it.
      const c = s.cell[id]
      let covers = false
      for (let k = T.catchOff[c]; k < T.catchBase[c] && !covers; k++) { const j = T.catchCell[k]; if (j === cell || g.dNear[j] === d + 1) covers = true }
      if (!covers) continue
      const M = s.tech[s.people[id] * TECH_FIELD_COUNT + TechField.Metalworking]
      const ch = smoothstep(DEPOSIT.prospLow, DEPOSIT.prospHigh, M) * (g.dKind[d] === DK.Placer ? DEPOSIT.placerFind : DEPOSIT.find)
      if (rng.next() < ch) { discover(s, g, d, id, false); break }
    }
  }
  rushMap(s, g)
}

/** The settlement with the largest catchment weight on cell c (traders first), -1. */
function workerOf(s: HistoryState, c: number, ring3: readonly number[]): number {
  const T = s.terrain
  let best = -1, bw = 0
  for (let i = 0; i < ring3.length; i++) {
    const id = s.occupant[ring3[i]]
    if (id < 0 || s.outpost[id] || s.abandoned[id] >= 0) continue
    const sc = s.cell[id]
    for (let k = T.catchOff[sc]; k < T.catchOff[sc + 1]; k++) {
      if (T.catchCell[k] !== c) continue
      const w = T.catchW[k] * (s.pop[id] >= 400 ? 10 : 1)
      if (w > bw) { bw = w; best = id }
      break
    }
  }
  return best
}

/** Hop path over land and coast from cell a to cell b (BFS, at most `max` hops), or null. */
function hopPath(s: HistoryState, a: number, b: number, max: number): number[] | null {
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const prev = new Map<number, number>() // (lookup only)
  const depth = new Map<number, number>()
  const q = [a]
  prev.set(a, -1); depth.set(a, 0)
  for (let h = 0; h < q.length; h++) {
    const c = q[h]
    if (c === b) break
    const dc = depth.get(c) as number
    if (dc >= max) continue
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (prev.has(j) || (s.terrain.deep[j] && j !== b)) continue
      prev.set(j, c); depth.set(j, dc + 1); q.push(j)
    }
  }
  if (!prev.has(b)) return null
  const out: number[] = []
  for (let c = b; c >= 0; c = prev.get(c) as number) out.push(c)
  out.reverse()
  return out
}

/** Builds a Mine on deposit d's cell for settlement `owner` (logged as Built). */
function buildMine(s: HistoryState, g: GoodsState, d: number, owner: number): void {
  const sid = s.structures.length
  s.structures.push({ id: sid, type: StructureType.Mine, cell: g.dCell[d], settlement: owner, builtYear: s.year, lostYear: -1 })
  logEvent(s, EventType.Built, owner, sid, StructureType.Mine)
  g.dMine[d] = sid
}

function loseMine(s: HistoryState, g: GoodsState, d: number): void {
  const sid = g.dMine[d]
  if (sid < 0) return
  const st = s.structures[sid]
  st.lostYear = s.year
  logEvent(s, EventType.StructureLost, st.settlement, sid, StructureType.Mine)
  g.dMine[d] = -1
}

/**
 * System (yearly, before the market): found deposits are worked; output goes into the worker's stock (a camp's into its
 * parent's) as the deposit's variety; reserves run down; MineExhausted, Boom; camps founded where nobody farms.
 */
export function mineYear(s: HistoryState, g: GoodsState, es: ExploreState): void {
  ensureGoods(g, s.count)
  let world = 0
  const decade = s.year % 10 === 3
  for (let d = 0; d < g.dCount; d++) {
    g.dOut[d] = 0
    if (g.dFound[d] < 0 || g.dExh[d] >= 0) continue
    const k = g.dKind[d]
    // The worker: kept while it lives; chosen again every decade or when lost.
    let wk = g.dWorker[d]
    const camp = g.dCamp[d]
    if (wk >= 0 && s.abandoned[wk] >= 0) { wk = -1; loseMine(s, g, d) }
    if (camp >= 0 && s.abandoned[camp] >= 0) { g.dCamp[d] = -1; if (wk === camp) { wk = -1; loseMine(s, g, d) } }
    if (wk < 0 || (decade && wk !== g.dCamp[d])) {
      const nw = workerOf(s, g.dCell[d], g.dRing[d])
      if (nw >= 0 && nw !== wk) { if (wk >= 0) loseMine(s, g, d); wk = nw }
      else if (nw < 0 && wk < 0 && DK_GOOD[k] === Good.Treasure) wk = foundCamp(s, g, es, d)
    }
    g.dWorker[d] = wk
    if (wk < 0) continue
    if (!gateOk(s, g, d, wk)) continue
    const isCamp = s.outpost[wk] === 1
    const sink = isCamp ? s.parent[wk] : wk
    if (sink < 0 || s.abandoned[sink] >= 0) continue
    if (g.dMine[d] < 0 && DK_GOOD[k] === Good.Treasure) buildMine(s, g, d, wk)
    const pop = isCamp ? DEPOSIT.campPop : s.pop[wk]
    const lab = pop / (pop + DEPOSIT.workHalf)
    const M = s.tech[s.people[wk] * TECH_FIELD_COUNT + TechField.Metalworking]
    let out = DEPOSIT.yield[k] * g.dRich[d] * lab * (1 + DEPOSIT.techMul * (M - 1))
    if (g.dR0[d] > 0) {
      out *= Math.sqrt(g.dR[d] / g.dR0[d])
      if (out > g.dR[d]) out = g.dR[d]
      g.dR[d] -= out
    }
    if (out > g.dPeak[d]) g.dPeak[d] = out
    g.dOut[d] = out
    if (DK_GOOD[k] === Good.Treasure) world += out
    const gd = DK_GOOD[k]
    ensureGoods(g, s.count)
    g.held[sink * G + gd] += out
    mixAdd(g, sink, MIX_OF[gd], g.dVar[d], out)
    g.mined[sink] += out
    g.vOut[g.dVar[d]] += out
    if (out > g.vOriginOut[g.dVar[d]]) { g.vOriginOut[g.dVar[d]] = out; g.vOrigin[g.dVar[d]] = sink }
    // A small place cannot store it all: what it cannot use or sell is lost.
    if (s.pop[sink] < 400) { const capH = 50; if (g.held[sink * G + gd] > capH) g.held[sink * G + gd] = capH }
    if (g.dR0[d] > 0 && out < DEPOSIT.exhausted * g.dPeak[d] && s.year - g.dFound[d] > 20) {
      g.dExh[d] = s.year
      logEvent(s, EventType.MineExhausted, wk, -1, d)
      loseMine(s, g, d)
    }
  }
  const prev = g.treasureOut
  g.treasureOut = world
  // Boom: a find that passes `boom` of the world's Treasure output.
  for (let d = 0; d < g.dCount; d++) {
    if (g.boomLogged[d] || !(g.dOut[d] > 0) || DK_GOOD[g.dKind[d]] !== Good.Treasure) continue
    const share = g.dOut[d] / (world > 0 ? world : 1)
    if (share >= DEPOSIT.boom && g.dRich[d] >= DEPOSIT.bonanza && world > 0.5 * prev) {
      g.boomLogged[d] = 1
      logGoods(s, EventType.Boom, g.dWorker[d], -1, d, share)
    }
  }
}

/** A mining camp at deposit d, founded by its finder (an expedition base kept up by it), when nobody farms there; returns it or -1. */
function foundCamp(s: HistoryState, g: GoodsState, es: ExploreState, d: number): number {
  const by = g.dFoundBy[d]
  if (by < 0 || s.abandoned[by] >= 0 || s.outpost[by] || s.pop[by] < 400) return -1
  const c = g.dCell[d]
  if (s.occupant[c] >= 0 || s.terrain.sea[c]) return -1
  const path = hopPath(s, s.cell[by], c, 40)
  if (path === null) return -1
  const n = DEPOSIT.campFound
  if (s.pop[by] < 4 * n) return -1
  s.pop[by] -= n
  const id = found(s, c, n, by, true)
  ensureGoods(g, s.count)
  registerBase(s, es, id, path)
  g.dCamp[d] = id
  const post = addPost(s, g, PostKind.Camp, by, -1, id, -1)
  g.postOf[id] = -1 // (a camp is an expedition base: it does not trade)
  void post
  return id
}
