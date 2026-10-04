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
/** Per cell this pass: SEA_ICE, NOBODY (claimable), STATELESS (a stateless settlement's land) or the holding state's id. */
let hp = new Int32Array(0)
const CLAIMED = -4, SEA_ICE = -3, NOBODY = -2, STATELESS = -1
/** Per landmass: 1 when some state holds land on it this pass (pockets are looked for only there). */
let massHeld = new Uint8Array(0)
let mark = new Int32Array(0)
let markRun = 0
/** The current component (comp[0, compN)), the source cells (to clear), the cells claimed by reach, a pocket's fill queue. */
let comp = new Int32Array(0)
let compN = 0
let src = new Int32Array(0)
let won = new Int32Array(0)
let queue = new Int32Array(0)
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
  if (hp.length < N) { hp = new Int32Array(N); mark = new Int32Array(N); comp = new Int32Array(N); src = new Int32Array(N); won = new Int32Array(N); queue = new Int32Array(N); markRun = 0 }
  const mass = T.landmass
  if (massHeld.length < T.landmassSize.length) massHeld = new Uint8Array(T.landmassSize.length)
  massHeld.fill(0)
  reach.fill(0)
  heldN.fill(0)
  const X = CLAIM
  for (const p of ps.alive) {
    const t = tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop)
    const f = 1 + X.popBoost * (2 * smoothstep(X.popLow, X.popHigh, ps.pPop[p]) - 1)
    reach[p] = (X.share[t] * ps.pReach[p] * f) / T.cellScale
  }
  // Who holds each land cell.
  const cells = ps.landCells
  hp.fill(SEA_ICE)
  for (let t = 0; t < cells.length; t++) {
    const c = cells[t]
    if ((flag[c] & ICE) !== 0) continue
    const o = tOwner[c]
    if (o < 0 || abandoned[o] >= 0) { hp[c] = NOBODY; continue }
    const p = polity[o]
    if (p >= 0) { hp[c] = p; heldN[p]++; massHeld[mass[c]] = 1 } else hp[c] = STATELESS
  }
  let maxHeld = 0
  for (const p of ps.alive) if (heldN[p] > maxHeld) maxHeld = heldN[p]
  // (no pocket larger than this can be filled)
  const maxPocket = X.pocket * maxHeld > X.pocketChief ? X.pocket * maxHeld : X.pocketChief
  // Sources: the edge cells of every state's held land (a cell next to nobody's land), its member's grip spent.
  heap.size = 0
  let srcN = 0
  for (let t = 0; t < cells.length; t++) {
    const c = cells[t]
    const p = hp[c]
    if (p < 0 || !(reach[p] > 0)) continue
    let edge = false
    for (let k = off[c], e = off[c + 1]; k < e; k++) if (hp[nb[k]] === NOBODY) { edge = true; break }
    if (!edge) continue
    const o = tOwner[c]
    const k0 = 1 - grip(ps.dist[o], ps.pReach[p])
    if (!(k0 < 1)) continue
    cKey[c] = k0; cPol[c] = p; cOwner[c] = o; cPeak[c] = 0
    src[srcN++] = c
    heap.push(k0, c)
  }
  const crest = X.crestElev, drop = X.crestDrop
  let wonN = 0
  while (heap.size > 0) {
    const key = heap.topKey()
    const u = heap.pop()
    if (key > cKey[u]) continue // (cheapened since)
    const heldU = hp[u] >= 0
    const fu = flag[u]
    if (!heldU && (fu & GREAT) !== 0) continue // (a great river: taken, not crossed)
    const p = cPol[u], r = reach[p], peak = cPeak[u], owner = cOwner[u]
    const fromDesert = !heldU && (fu & DESERT) !== 0
    for (let k = off[u], e = off[u + 1]; k < e; k++) {
      const j = nb[k]
      if (hp[j] !== NOBODY) continue // (anyone's land, ice)
      if (fromDesert && (flag[j] & DESERT) === 0) continue
      const ej = elev[j]
      if (peak >= crest && ej < peak - drop) continue
      const nk = key + w[j] / r
      if (nk > 1) continue
      const pj = cPol[j]
      if (pj >= 0) {
        if (nk >= cKey[j]) { if (pj !== p && cDisp[j] < 0) cDisp[j] = p; continue } // (another's claim, nearer: disputed)
        if (pj !== p && cDisp[j] < 0) cDisp[j] = pj
      }
      if (pj < 0) won[wonN++] = j
      cKey[j] = nk; cPol[j] = p; cOwner[j] = owner; cPeak[j] = ej > peak ? ej : peak
      heap.push(nk, j)
    }
  }
  // (held cells were only sources)
  for (let i = 0; i < srcN; i++) { const c = src[i]; cPol[c] = -1; cOwner[c] = -1 }
  for (let i = 0; i < wonN; i++) hp[won[i]] = CLAIMED // (claimed by reach: cPol says by whom)
  // Pockets: components of nobody's unclaimed land (ice aside), by their border.
  const run0 = ++markRun // (component cells)
  for (let t = 0; t < cells.length; t++) {
    const c0 = cells[t]
    if (hp[c0] !== NOBODY || mark[c0] === run0 || massHeld[mass[c0]] === 0) continue
    compN = 0
    comp[compN++] = c0
    mark[c0] = run0
    for (let i = 0; i < compN; i++) {
      const c = comp[i]
      for (let k = off[c], e = off[c + 1]; k < e; k++) {
        const j = nb[k]
        if (hp[j] !== NOBODY || mark[j] === run0) continue
        mark[j] = run0
        comp[compN++] = j
      }
    }
    if (compN > maxPocket) continue
    // Border: each land cell next to the pocket once (by its state: held or claimed; stateless land counts for none).
    const runB = ++markRun
    tallyP.length = 0; tallyN.length = 0
    let border = 0
    for (let i = 0; i < compN; i++) {
      const c = comp[i]
      for (let k = off[c], e = off[c + 1]; k < e; k++) {
        const j = nb[k]
        const h = hp[j]
        if (h === SEA_ICE || mark[j] === run0 || mark[j] === runB) continue
        mark[j] = runB
        border++
        const q = h === CLAIMED ? cPol[j] : h
        if (q < 0) continue
        let m = 0
        while (m < tallyP.length && tallyP[m] !== q) m++
        if (m === tallyP.length) { tallyP.push(q); tallyN.push(0) }
        tallyN[m]++
      }
    }
    // (border cells are re-marked by runB; component cells keep run0)
    if (border === 0) continue
    let best = -1, bestN = 0
    for (let m = 0; m < tallyP.length; m++) if (tallyN[m] > bestN) { bestN = tallyN[m]; best = tallyP[m] }
    if (best < 0 || bestN < X.enclose * border) continue
    const size = compN
    const tier = tierOf(ps.pPop[best], ps.pMembers[best], ps.pMulti[best] === 1, ps.worldPop)
    if (tier === Tier.Chiefdom ? size > X.pocketChief : size > X.pocket * heldN[best] || size > X.pocketShape * bestN * bestN) continue
    fillPocket(ps, best, off, nb, run0)
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
 * Fills the component in comp[0, compN) (marked run0) with polity p, each cell taking the member of the nearest p cell on
 * its border (breadth first); cKey 2 marks a pocket's cells (a claim by enclosure, not by reach).
 */
function fillPocket(ps: PolityState, p: number, off: Int32Array, nb: Int32Array, run0: number): void {
  const { cOwner, cPol, cKey, tOwner } = ps
  const run = ++markRun // (cells filled)
  let head = 0, tail = 0
  for (let i = 0; i < compN; i++) {
    const c = comp[i]
    for (let k = off[c], e = off[c + 1]; k < e; k++) {
      const j = nb[k]
      if (mark[j] === run0 || mark[j] === run) continue
      const h = hp[j]
      if ((h >= 0 ? h : h === CLAIMED || h === NOBODY ? cPol[j] : -1) !== p) continue
      cPol[c] = p; cOwner[c] = h >= 0 ? tOwner[j] : cOwner[j]; cKey[c] = 2
      mark[c] = run
      hp[c] = CLAIMED
      queue[tail++] = c
      break
    }
  }
  while (head < tail) {
    const c = queue[head++]
    for (let k = off[c], e = off[c + 1]; k < e; k++) {
      const j = nb[k]
      if (mark[j] !== run0) continue
      cPol[j] = p; cOwner[j] = cOwner[c]; cKey[j] = 2
      mark[j] = run
      hp[j] = CLAIMED
      queue[tail++] = j
    }
  }
}
