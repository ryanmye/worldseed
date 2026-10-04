// polities: the control pass (every POLITY.step years; design 4).
//
//   b_i     = pop * q * (1 + 0.5 prosperity)             men, quality, money
//   lambda  = lambda0 * (1 + 0.5 (Crafts - 1)) / sqrt(1 + members / overload)
//   g(d)    = 1 / (1 + (d / lambda)^2)
//   M_p     = A_p * sum_i b_i g(dist_i) * (crisis ? 0.6 : 1)
//
// dist_i is the shortest graph cost from the capital through members only (Dijkstra); a member the
// capital cannot reach through its own lands (an exclave without a sea link) has g = 0. A_p is the
// population-weighted mean cohesion of the members. Also rebuilds the member lists per polity.

import type { Heap } from '../heap.ts'
import type { HistoryState } from '../state.ts'
import { FAR, grip, inCrisis, powerOf, reachOf } from './state.ts'
import type { PolityState } from './state.ts'
import { POLITY } from './params.ts'

/** Member lists per polity (ascending ids), from the current membership. */
export function rebuildMembers(s: HistoryState, ps: PolityState): void {
  const P = ps.P
  const off = new Int32Array(P + 1)
  const living = s.living
  for (let t = 0; t < living.length; t++) { const p = ps.polity[living[t]]; if (p >= 0) off[p + 1]++ }
  for (let p = 0; p < P; p++) off[p + 1] += off[p]
  const list = new Int32Array(off[P])
  const fill = off.slice(0, P)
  for (let t = 0; t < living.length; t++) { const id = living[t]; const p = ps.polity[id]; if (p >= 0) list[fill[p]++] = id }
  ps.memOff = off
  ps.memList = list
}

let peoplePop = new Float64Array(0)

/** Distances, reach, cohesion and mass of polity p over its members list[m0, m1). */
function controlOf(s: HistoryState, ps: PolityState, p: number, heap: Heap, list: ArrayLike<number>, m0: number, m1: number): void {
  const { dist, stamp, gNb, gCost } = ps
  const n = m1 - m0
  ps.pMembers[p] = n
  const lam = reachOf(s, p, ps.pPeople[p], n)
  ps.pReach[p] = lam
  const run = ++ps.run
  for (let k = m0; k < m1; k++) { const m = list[k]; stamp[m] = run; dist[m] = FAR }
  const cap = ps.pCapital[p]
  heap.size = 0
  // Through members, and across one ring of foreign or stateless settlements at POLITY.transit times the cost
  // (a ring node's cost is kept in ringDist; it leads only on to members).
  const ringRun = -run
  const { ringDist } = ps
  if (stamp[cap] === run) { dist[cap] = 0; heap.push(0, cap) }
  while (heap.size > 0) {
    const d = heap.topKey()
    const u = heap.pop()
    const member = stamp[u] === run
    if (d > (member ? dist[u] : ringDist[u])) continue
    const nb = gNb[u], co = gCost[u]
    if (!nb) continue
    for (let k = 0; k < nb.length; k++) {
      const v = nb[k]
      if (stamp[v] === run) {
        const nd = d + co[k] * (member ? 1 : POLITY.transit)
        if (nd < dist[v]) { dist[v] = nd; heap.push(nd, v) }
      } else if (member && s.abandoned[v] < 0) {
        const nd = d + co[k] * POLITY.transit
        if (stamp[v] !== ringRun || nd < ringDist[v]) { stamp[v] = ringRun; ringDist[v] = nd; heap.push(nd, v) }
      }
    }
  }
  const NP = s.know.P
  if (peoplePop.length < NP) peoplePop = new Float64Array(NP)
  peoplePop.fill(0)
  let pop = 0, aSum = 0, bSum = 0, ports = 0
  for (let k = m0; k < m1; k++) {
    const m = list[k]
    const x = s.pop[m]
    if (s.port[m] >= 0) ports++
    pop += x
    aSum += x * ps.asab[m]
    const dm = dist[m]
    if (dm < FAR) bSum += ps.str[m] * grip(dm, lam)
    peoplePop[s.people[m]] += x
  }
  ps.pPop[p] = pop
  ps.pPorts[p] = ports
  const A = pop > 0 ? aSum / pop : 0
  ps.pAsab[p] = A
  ps.pMass[p] = A * bSum * (inCrisis(s, ps, p) ? POLITY.crisisMass : 1)
  let multi = 0
  for (let q = 0; q < NP; q++) if (pop > 0 && peoplePop[q] >= POLITY.multiShare * pop) multi++
  ps.pMulti[p] = multi >= 2 ? 1 : 0
  if (n > ps.pPeak[p]) ps.pPeak[p] = n
}

/** Power of every living settlement, member lists, distances from capitals, reach, cohesion and mass of every polity. */
export function controlPass(s: HistoryState, ps: PolityState, heap: Heap): void {
  const living = s.living
  let world = 0
  for (let t = 0; t < living.length; t++) { const id = living[t]; ps.str[id] = powerOf(s, id); if (!s.outpost[id]) world += s.pop[id] }
  ps.worldPop = world
  rebuildMembers(s, ps)
  for (const p of ps.alive) controlOf(s, ps, p, heap, ps.memList, ps.memOff[p], ps.memOff[p + 1])
}

/** The control pass for one polity (after its capital or members changed between steps). */
export function controlOne(s: HistoryState, ps: PolityState, p: number, heap: Heap): void {
  const list: number[] = []
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    if (ps.polity[id] !== p) continue
    list.push(id)
    if (!(ps.str[id] > 0)) ps.str[id] = powerOf(s, id)
  }
  controlOf(s, ps, p, heap, list, 0, list.length)
}

/** Graph cost from polity p's capital to settlement j through a member neighbour (FAR if no member is adjacent). */
export function distTo(ps: PolityState, p: number, j: number, abandoned: Int32Array): number {
  const nb = ps.gNb[j], co = ps.gCost[j]
  let best = FAR
  if (!nb) return best
  for (let k = 0; k < nb.length; k++) {
    const u = nb[k]
    if (ps.polity[u] !== p || abandoned[u] >= 0) continue
    const d = ps.dist[u] + co[k]
    if (d < best) best = d
  }
  return best
}
