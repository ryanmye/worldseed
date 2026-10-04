// polities: claims, the land a state calls its own beyond its settlements' land (params.ts CLAIM).
//
// Every POLITY.mapStep years, after the step (membership as it stands for the land snapshot): one search over nobody's
// land from the edges of every state's held land at once, each state spending its own reach (by tier, people and
// technology; a member far from the capital starts with most of it spent), the cheapest share of reach winning each cell;
// it stops at the natural limits (sea, ice, anyone's land, a great river, a desert's far edge, a crest). Then the
// pockets: nobody's land enclosed by one state's land and claims is filled by it, within a size bound (the shape of the
// enclosure, the state's size), so that a country reads as one piece without one outpost claiming an empty continent.
//
// Claims are only ever nobody's land: a settlement's own land, the state's, a neighbour's or a stateless people's, is
// never claimed. They lapse with the state or the member: they are redrawn from scratch every pass, and a claim
// whose member is gone or stateless is not drawn (assemble.ts).
//
// cPol / cOwner: the claiming polity and member per cell (-1: none); on held cells they are scratch of the search.

import { Biome, EventType, RIVER_FLOW_THRESHOLD } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import { Heap } from '../heap.ts'
import type { HistoryState } from '../state.ts'
import { CLAIM } from './params.ts'
import { relIdx } from './relations.ts'
import { grip, tierOf, Tier } from './state.ts'
import type { PolityState } from './state.ts'

const ICE = 1, DESERT = 2, GREAT = 4

/** Per terrain (read only): step cost sqrt(moveCost / cellScale), flags (ice, desert, great river) and land neighbours (CSR). */
interface ClaimStatic { w: Float64Array; flag: Uint8Array; off: Int32Array; nb: Int32Array }
const STATIC = new WeakMap<object, ClaimStatic>()
function claimStatic(s: HistoryState): ClaimStatic {
  const T = s.terrain
  const got = STATIC.get(T)
  if (got) return got
  const N = T.cellCount
  const W = s.world
  const w = new Float64Array(N), flag = new Uint8Array(N)
  const great = CLAIM.greatRiver * RIVER_FLOW_THRESHOLD
  for (let c = 0; c < N; c++) {
    if (T.sea[c]) continue
    w[c] = Math.sqrt(T.moveCost[c] / T.cellScale)
    const b = W.biome[c]
    flag[c] = (b === Biome.Ice ? ICE : 0) | (b === Biome.Desert ? DESERT : 0) | (W.flow[c] >= great ? GREAT : 0)
  }
  const { neighborOffsets: go, neighbors: gn } = W.grid
  const off = new Int32Array(N + 1)
  let n = 0
  for (let c = 0; c < N; c++) { if (!T.sea[c]) for (let k = go[c]; k < go[c + 1]; k++) if (!T.sea[gn[k]]) n++; off[c + 1] = n }
  const nb = new Int32Array(n)
  n = 0
  for (let c = 0; c < N; c++) if (!T.sea[c]) for (let k = go[c]; k < go[c + 1]; k++) if (!T.sea[gn[k]]) nb[n++] = gn[k]
  const a = { w, flag, off, nb }
  STATIC.set(T, a)
  return a
}

const heap = new Heap(1024)
let reach = new Float64Array(0)
let heldN = new Int32Array(0)
let mark = new Int32Array(0)
let markRun = 0
const comp: number[] = []
const tallyP: number[] = [], tallyN: number[] = []

/** The claims pass: cPol / cOwner over nobody's land (see the file comment). */
export function claimPass(s: HistoryState, ps: PolityState): void {
  const T = s.terrain
  const N = T.cellCount
  const { w, flag, off, nb } = claimStatic(s)
  const { cOwner, cPol, cKey, cPeak, cDisp, tOwner, polity } = ps
  const abandoned = s.abandoned
  const elev = s.world.elevation
  cOwner.fill(-1)
  cPol.fill(-1)
  cDisp.fill(-1)
  ps.claimYear = s.year
  if (ps.alive.length === 0) return
  const P = ps.P
  if (reach.length < P) { reach = new Float64Array(ps.pcap); heldN = new Int32Array(ps.pcap) }
  reach.fill(0)
  heldN.fill(0)
  const X = CLAIM
  for (const p of ps.alive) {
    const t = tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop)
    const f = 1 + X.popBoost * (2 * smoothstep(X.popLow, X.popHigh, ps.pPop[p]) - 1)
    reach[p] = (X.share[t] * ps.pReach[p] * f) / T.cellScale
  }
  // Sources: the edge cells of every state's held land (a cell next to nobody's land), its member's grip spent.
  heap.size = 0
  const cells = ps.landCells
  for (let t = 0; t < cells.length; t++) {
    const c = cells[t]
    const o = tOwner[c]
    if (o < 0 || abandoned[o] >= 0) continue
    const p = polity[o]
    if (p < 0) continue
    heldN[p]++
    const r = reach[p]
    if (!(r > 0)) continue
    let edge = false
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      const oj = tOwner[j]
      if ((oj < 0 || abandoned[oj] >= 0) && (flag[j] & ICE) === 0) { edge = true; break }
    }
    if (!edge) continue
    const k0 = 1 - grip(ps.dist[o], ps.pReach[p])
    if (!(k0 < 1)) continue
    cKey[c] = k0; cPol[c] = p; cOwner[c] = o; cPeak[c] = 0
    heap.push(k0, c)
  }
  const crest = X.crestElev, drop = X.crestDrop
  while (heap.size > 0) {
    const key = heap.topKey()
    const u = heap.pop()
    if (key > cKey[u]) continue // (cheapened since)
    const ou = tOwner[u]
    const heldU = ou >= 0 && abandoned[ou] < 0
    const fu = flag[u]
    if (!heldU && (fu & GREAT) !== 0) continue // (a great river: taken, not crossed)
    const p = cPol[u], r = reach[p], peak = cPeak[u], owner = cOwner[u]
    const fromDesert = !heldU && (fu & DESERT) !== 0
    for (let k = off[u]; k < off[u + 1]; k++) {
      const j = nb[k]
      const oj = tOwner[j]
      if (oj >= 0 && abandoned[oj] < 0) continue
      const fj = flag[j]
      if ((fj & ICE) !== 0) continue
      if (fromDesert && (fj & DESERT) === 0) continue
      const ej = elev[j]
      if (peak >= crest && ej < peak - drop) continue
      const nk = key + w[j] / r
      if (nk > 1) continue
      const pj = cPol[j]
      if (pj >= 0) {
        if (nk >= cKey[j]) { if (pj !== p && cDisp[j] < 0) cDisp[j] = p; continue } // (another's claim, nearer: disputed)
        if (pj !== p && cDisp[j] < 0) cDisp[j] = pj
      }
      cKey[j] = nk; cPol[j] = p; cOwner[j] = owner; cPeak[j] = ej > peak ? ej : peak
      heap.push(nk, j)
    }
  }
  // (held cells were only sources)
  for (let t = 0; t < cells.length; t++) {
    const c = cells[t]
    const o = tOwner[c]
    if (o >= 0 && abandoned[o] < 0) { cPol[c] = -1; cOwner[c] = -1 }
  }
  // Pockets: components of nobody's unclaimed land (ice aside), by their border.
  if (mark.length < N) { mark = new Int32Array(N); markRun = 0 }
  const run0 = ++markRun // (component cells)
  for (let t = 0; t < cells.length; t++) {
    const c0 = cells[t]
    if (mark[c0] === run0 || cPol[c0] >= 0 || (flag[c0] & ICE) !== 0) continue
    const o0 = tOwner[c0]
    if (o0 >= 0 && abandoned[o0] < 0) continue
    comp.length = 0
    comp.push(c0)
    mark[c0] = run0
    for (let i = 0; i < comp.length; i++) {
      const c = comp[i]
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (mark[j] === run0 || cPol[j] >= 0 || (flag[j] & ICE) !== 0) continue
        const oj = tOwner[j]
        if (oj >= 0 && abandoned[oj] < 0) continue
        mark[j] = run0
        comp.push(j)
      }
    }
    // Border: each land cell next to the pocket once (by its state: held or claimed; -1 stateless).
    const runB = ++markRun
    tallyP.length = 0; tallyN.length = 0
    let border = 0
    for (let i = 0; i < comp.length; i++) {
      const c = comp[i]
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (mark[j] === run0 || mark[j] === runB || (flag[j] & ICE) !== 0) continue
        mark[j] = runB
        border++
        const oj = tOwner[j]
        const q = oj >= 0 && abandoned[oj] < 0 ? polity[oj] : cPol[j]
        if (q < 0) continue
        let m = 0
        while (m < tallyP.length && tallyP[m] !== q) m++
        if (m === tallyP.length) { tallyP.push(q); tallyN.push(0) }
        tallyN[m]++
      }
    }
    // (border cells are re-marked as component-free cells by runB; component cells keep run0)
    if (border === 0) continue
    let best = -1, bestN = 0
    for (let m = 0; m < tallyP.length; m++) if (tallyN[m] > bestN) { bestN = tallyN[m]; best = tallyP[m] }
    if (best < 0 || bestN < X.enclose * border) continue
    const size = comp.length
    const tier = tierOf(ps.pPop[best], ps.pMembers[best], ps.pMulti[best] === 1, ps.worldPop)
    if (tier === Tier.Chiefdom ? size > X.pocketChief : size > X.pocket * heldN[best] || size > X.pocketShape * bestN * bestN) continue
    fillPocket(ps, best, abandoned, off, nb, run0)
  }
  disputes(s, ps)
}

/** Border disputes: cells where two neighbours' claims meet, per relation; BorderDispute when a pair's reach disputeMin. */
function disputes(s: HistoryState, ps: PolityState): void {
  const { cPol, cDisp, relDispute, relDisputeOn } = ps
  for (let r = 0; r < relDispute.length; r++) relDispute[r] = 0
  const cells = ps.landCells
  for (let t = 0; t < cells.length; t++) {
    const c = cells[t]
    const a = cPol[c], b = cDisp[c]
    if (a < 0 || b < 0 || a === b) continue
    const r = relIdx(ps, a, b)
    if (r >= 0) relDispute[r]++
  }
  for (let r = 0; r < relDispute.length; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    const on = relDispute[r] >= CLAIM.disputeMin && ps.pEnded[a] < 0 && ps.pEnded[b] < 0
    if (on && relDisputeOn[r] === 0) s.events.push({ year: s.year, type: EventType.BorderDispute, settlement: ps.pCapital[a], other: ps.pCapital[b], value: b, extra: relDispute[r] })
    relDisputeOn[r] = on ? 1 : 0
  }
}

/**
 * Fills the component in `comp` (marked run0) with polity p, each cell taking the member of the nearest p cell on its
 * border (breadth first); cKey 2 marks a pocket's cells (a claim by enclosure, not by reach).
 */
function fillPocket(ps: PolityState, p: number, abandoned: Int32Array, off: Int32Array, nb: Int32Array, run0: number): void {
  const { cOwner, cPol, cKey, tOwner, polity } = ps
  const run = ++markRun // (cells filled)
  const queue: number[] = []
  for (let i = 0; i < comp.length; i++) {
    const c = comp[i]
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (mark[j] === run0 || mark[j] === run) continue
      const oj = tOwner[j]
      const heldJ = oj >= 0 && abandoned[oj] < 0
      const q = heldJ ? polity[oj] : cPol[j]
      if (q !== p) continue
      cPol[c] = p; cOwner[c] = heldJ ? oj : cOwner[j]; cKey[c] = 2
      mark[c] = run
      queue.push(c)
      break
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (mark[j] !== run0) continue
      cPol[j] = p; cOwner[j] = cOwner[c]; cKey[j] = 2
      mark[j] = run
      queue.push(j)
    }
  }
}
