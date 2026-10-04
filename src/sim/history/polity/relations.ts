// polities: rivalry between neighbouring polities (design 5; no alliances, tribute or vassals in v1).
//
// Relations exist only between polities that border each other (a graph edge between members) and
// whose ruling peoples are the same or have met. Every step, per pair:
//   dR = step * [0.04 claim + 0.01 [peoples differ] + 0.02 hunger + 0.03 [war within 50 years] - 0.02 v / (v + 200)] - step * 0.01 R
//   claim  = contested / (contested + 6)   cells in the base catchments of members of both (Carneiro's squeeze)
//   hunger = mean (1 - food) of the members on the border, v = open trade loads a year between their members.
// Pairs are kept in arrays in creation order (the Map is for lookup only); a pair whose polity ended is
// skipped. The border edges of each pair this step are kept for the war rules.

import type { HistoryState } from '../state.ts'
import type { TradeState } from '../trade.ts'
import { NEVER, inContact } from './state.ts'
import type { PolityState } from './state.ts'
import { POLITY, RELATION } from './params.ts'

function key(p: number, q: number): number {
  return p < q ? p * 65536 + q : q * 65536 + p
}

/** Relation index of polities p and q, or -1. */
export function relIdx(ps: PolityState, p: number, q: number): number {
  const r = ps.relIndex.get(key(p, q))
  return r === undefined ? -1 : r
}

/** Rivalry R between p and q (0 if they have no relation). */
export function relationOf(ps: PolityState, p: number, q: number): number {
  const r = ps.relIndex.get(key(p, q))
  return r === undefined ? 0 : ps.relR[r]
}

/** The relation of p and q, created (R = 0) if missing. */
export function ensureRelation(ps: PolityState, p: number, q: number): number {
  const k = key(p, q)
  const r = ps.relIndex.get(k)
  if (r !== undefined) return r
  const i = ps.relA.length
  ps.relIndex.set(k, i)
  ps.relA.push(p < q ? p : q)
  ps.relB.push(p < q ? q : p)
  ps.relR.push(0)
  ps.relTruce.push(NEVER)
  ps.relWar.push(-1)
  ps.relLastWar.push(NEVER)
  ps.relEdges.push([])
  ps.relContested.push(0)
  return i
}

/** System part (every step): border edges per pair, then rivalry. */
export function relationStep(s: HistoryState, ps: PolityState, ts: TradeState): void {
  const X = RELATION
  const step = POLITY.step
  const living = s.living
  const { polity, gNb, gCost } = ps
  for (let r = 0; r < ps.relEdges.length; r++) ps.relEdges[r].length = 0
  // Border edges (each member pair once, lower id first) and hunger on the border.
  const hunger: number[] = [], hungerN: number[] = []
  for (let t = 0; t < living.length; t++) {
    const u = living[t]
    const pu = polity[u]
    if (pu < 0) continue
    const nb = gNb[u], co = gCost[u]
    if (!nb) continue
    for (let k = 0; k < nb.length; k++) {
      const v = nb[k]
      if (v < u || s.abandoned[v] >= 0) continue
      const pv = polity[v]
      if (pv < 0 || pv === pu || !inContact(s, ps.pPeople[pu], ps.pPeople[pv])) continue
      const r = ensureRelation(ps, pu, pv)
      ps.relEdges[r].push(u, v, co[k])
      while (hunger.length <= r) { hunger.push(0); hungerN.push(0) }
      hunger[r] += (1 - s.food[u]) + (1 - s.food[v])
      hungerN[r] += 2
    }
  }
  const R = ps.relA.length
  // Contested farmland: cells in the base catchments of members of two polities (recounted at map passes).
  const contested = ps.relContested
  if (ps.mapYear === s.year) {
    for (let r = 0; r < R; r++) contested[r] = 0
    contestedClaims(s, ps)
  }
  // Trade between members of the two.
  const vol = new Float64Array(R)
  for (const r of ts.openList) {
    const pa = polity[ts.rA[r]], pb = polity[ts.rB[r]]
    if (pa < 0 || pb < 0 || pa === pb) continue
    const i = ps.relIndex.get(key(pa, pb))
    if (i !== undefined) vol[i] += ts.rVol[r]
  }
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0) continue
    let x = ps.relR[r]
    let d = -X.decay * x
    if (ps.relEdges[r].length > 0) {
      const c = contested[r]
      const v = vol[r]
      const h = r < hunger.length && hungerN[r] > 0 ? hunger[r] / hungerN[r] : 0
      d += X.claim * (c / (c + X.claimHalf)) + (ps.pPeople[a] !== ps.pPeople[b] ? X.differ : 0) + X.hunger * h +
        (s.year - ps.relLastWar[r] < X.recentYears ? X.recentWar : 0) - X.trade * (v / (v + X.tradeHalf))
    }
    x += step * d
    ps.relR[r] = x < 0 ? 0 : x > 2 ? 2 : x
  }
}

function contestedClaims(s: HistoryState, ps: PolityState): void {
  const contested = ps.relContested
  const living = s.living
  const polity = ps.polity
  const T = s.terrain
  const { cellMark, cellPol } = ps
  const run = ++ps.cellRun
  for (let t = 0; t < living.length; t++) {
    const m = living[t]
    const p = polity[m]
    if (p < 0) continue
    const c = s.cell[m]
    for (let k = T.catchOff[c], e = T.catchBase[c]; k < e; k++) {
      const j = T.catchCell[k]
      if (cellMark[j] !== run) { cellMark[j] = run; cellPol[j] = p; continue }
      const o = cellPol[j]
      if (o < 0 || o === p) continue
      const r = ps.relIndex.get(key(o, p))
      if (r !== undefined) contested[r]++
      cellPol[j] = -1
    }
  }
}
