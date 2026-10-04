// polities: formation, peaceful growth by submission, and absorption of small chiefdoms (design 2).
//
// Submission (state.submits): settlement j submits to a power that can project more force onto it
// than it can raise itself, weighted by how much taxable grain it has:
//   Proj * (0.3 + 0.7 gamma_j) >= alpha * Local_j * (1 + 0.5 [other people])
// so grain-poor herders and fishers, defensible hill and marsh villages and distant places stay
// out (non-state space by the rule itself).
//
// Formation (every step): a stateless settlement of formPopOf people (relative to the world's settlements, at most
// POLITY.formPop) with a grain share of at
// least formGrain, formRatio times as big as every stateless neighbour within reach, becomes a capital
// when at least formDependents stateless neighbours would submit to it; they join. Larger centres are
// tried first, so they win contested hinterlands.
// Accretion (every step): each polity's stateless neighbours that pass the test join it, at most
// accreteMax per polity per step, the most dominated first (logged as Joined only for towns).
// Absorption: a chiefdom whose capital would submit to a much larger neighbouring polity joins it whole.

import { EventType, PolityEnd, PolityOrigin, TOWN_POPULATION } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { logEvent } from '../state.ts'
import { distTo, rebuildMembers } from './control.ts'
import { POLITY } from './params.ts'
import { FAR, clampAsab, endPolity, grainShare, grip, inContact, localOf, newPolity, projAt, reachOf, setPolity } from './state.ts'
import type { PolityState } from './state.ts'

/** Pairs of polities at war with each other (active wars): true if p and q fight. */
export function atWar(ps: PolityState, p: number, q: number): boolean {
  if (p < 0 || q < 0 || p === q || ps.pWars[p] === 0 || ps.pWars[q] === 0) return false
  const lo = p < q ? p : q, hi = p < q ? q : p
  const r = ps.relIndex.get(lo * 65536 + hi)
  return r !== undefined && ps.relWar[r] >= 0
}

const POPS = { a: new Float64Array(1024) }

/**
 * Population a founding capital needs: formQuant times the formTop-quantile of the living (non-outpost) settlements'
 * people, within [formPopMin, formPop]. In a world of small villages the largest stand out sooner; in a rich one the
 * bar stays at formPop.
 */
export function formPopOf(s: HistoryState): number {
  const P = POLITY
  const living = s.living
  if (POPS.a.length < living.length) POPS.a = new Float64Array(living.length * 2)
  const a = POPS.a
  let n = 0
  for (let t = 0; t < living.length; t++) { const id = living[t]; if (!s.outpost[id]) a[n++] = s.pop[id] }
  if (n === 0) return P.formPop
  const v = a.subarray(0, n).sort()
  const x = P.formQuant * v[Math.min(n - 1, Math.floor(P.formTop * n))]
  return x < P.formPopMin ? P.formPopMin : x > P.formPop ? P.formPop : x
}

/** System part (every step): new states form around dominant towns. */
export function formation(s: HistoryState, ps: PolityState): void {
  const P = POLITY
  const living = s.living
  const cand: number[] = []
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    if (ps.polity[id] >= 0 || s.pop[id] < P.formPopMin || grainShare(s, id) < P.formGrain) continue
    cand.push(id)
  }
  if (cand.length === 0) return
  // (the world's bar only when some settlement could clear it)
  const formPop = formPopOf(s)
  let nc = 0
  for (let t = 0; t < cand.length; t++) if (s.pop[cand[t]] >= formPop) cand[nc++] = cand[t]
  cand.length = nc
  if (nc === 0) return
  cand.sort((a, b) => s.pop[b] - s.pop[a] || a - b)
  const deps: number[] = []
  for (const i of cand) {
    if (ps.polity[i] >= 0) continue
    const nb = ps.gNb[i], co = ps.gCost[i]
    if (!nb || nb.length === 0) continue
    const people = s.people[i]
    const lam = reachOf(s, -1, people, 1)
    let biggest = 0
    for (let k = 0; k < nb.length; k++) {
      const v = nb[k]
      if (s.abandoned[v] >= 0 || ps.polity[v] >= 0 || s.outpost[v] || co[k] > lam) continue
      if (s.pop[v] > biggest) biggest = s.pop[v]
    }
    if (s.pop[i] < P.formRatio * biggest) continue
    const mass = ps.asab[i] * ps.str[i]
    deps.length = 0
    for (let k = 0; k < nb.length; k++) {
      const j = nb[k]
      if (s.abandoned[j] >= 0 || ps.polity[j] >= 0 || s.outpost[j] || !inContact(s, people, s.people[j])) continue
      const g = grainShare(s, j)
      const foreign = s.people[j] !== people ? 1 + P.foreign : 1
      if (mass * grip(co[k], lam) * (P.subBase + (1 - P.subBase) * g) >= P.submit * localOf(s, ps, j) * foreign) deps.push(j)
    }
    if (deps.length < P.formDependents) continue
    const p = newPolity(s, ps, i, PolityOrigin.Formed, -1)
    ps.asab[i] = clampAsab(ps.asab[i] + P.foundAsab)
    for (const j of deps) {
      let c = FAR
      for (let k = 0; k < nb.length; k++) if (nb[k] === j) c = co[k]
      setPolity(s, ps, j, p, c)
      ps.asab[j] = clampAsab(ps.asab[j] + P.foundAsab)
    }
  }
}

/** System part (every step): stateless neighbours submit to polities. */
export function accretion(s: HistoryState, ps: PolityState): void {
  const P = POLITY
  const living = s.living
  const cj: number[] = [], cp: number[] = [], cr: number[] = [], cd: number[] = []
  const pl: number[] = [], dl: number[] = []
  for (let t = 0; t < living.length; t++) {
    const j = living[t]
    if (ps.polity[j] >= 0) continue
    const nb = ps.gNb[j], co = ps.gCost[j]
    if (!nb) continue
    pl.length = 0; dl.length = 0
    for (let k = 0; k < nb.length; k++) {
      const u = nb[k]
      const p = ps.polity[u]
      if (p < 0 || s.abandoned[u] >= 0) continue
      const d = ps.dist[u] + co[k]
      const i = pl.indexOf(p)
      if (i < 0) { pl.push(p); dl.push(d) } else if (d < dl[i]) dl[i] = d
    }
    if (pl.length === 0) continue
    const loc = localOf(s, ps, j)
    const g = grainShare(s, j)
    let best = -1, bestR = 0, bestD = 0
    for (let i = 0; i < pl.length; i++) {
      const p = pl[i]
      if (!inContact(s, ps.pPeople[p], s.people[j])) continue
      const foreign = s.people[j] !== ps.pPeople[p] ? 1 + P.foreign : 1
      const ratio = (projAt(ps, p, dl[i]) * (P.subBase + (1 - P.subBase) * g)) / (P.submit * loc * foreign + 1e-9)
      if (ratio >= 1 && ratio > bestR) { best = p; bestR = ratio; bestD = dl[i] }
    }
    if (best >= 0) { cj.push(j); cp.push(best); cr.push(bestR); cd.push(bestD) }
  }
  if (cj.length === 0) return
  const order = cj.map((_, i) => i)
  order.sort((a, b) => cp[a] - cp[b] || cr[b] - cr[a] || cj[a] - cj[b])
  let last = -1, taken = 0
  for (const i of order) {
    const p = cp[i]
    if (p !== last) { last = p; taken = 0 }
    if (taken >= P.accreteMax) continue
    taken++
    const j = cj[i]
    setPolity(s, ps, j, p, cd[i])
    if (s.pop[j] >= TOWN_POPULATION) logEvent(s, EventType.Joined, j, ps.pCapital[p], p)
  }
}

/** System part (every step): chiefdoms whose capital would submit to a much larger neighbour join it whole. */
export function absorption(s: HistoryState, ps: PolityState): void {
  const P = POLITY
  rebuildMembers(s, ps)
  const alive = ps.alive.slice()
  for (const p of alive) {
    if (ps.pEnded[p] >= 0 || ps.pMembers[p] >= P.absorbMembers || ps.pWars[p] > 0) continue
    const c = ps.pCapital[p]
    // Neighbouring polities of the members.
    let best = -1, bestR = 0, bestD = 0
    const m0 = ps.memOff[p], m1 = ps.memOff[p + 1]
    const tried: number[] = []
    for (let k = m0; k < m1; k++) {
      const m = ps.memList[k]
      if (ps.polity[m] !== p) continue
      const mn = ps.gNb[m]
      if (!mn) continue
      for (let e = 0; e < mn.length; e++) {
        const q = ps.polity[mn[e]]
        if (q < 0 || q === p || tried.indexOf(q) >= 0) continue
        tried.push(q)
        if (ps.pPop[q] < 3 * ps.pPop[p] || atWar(ps, p, q) || !inContact(s, ps.pPeople[q], ps.pPeople[p])) continue
        const d = distTo(ps, q, c, s.abandoned)
        const dd = d < FAR ? d : ps.dist[mn[e]] + ps.dist[m] + 1
        const foreign = ps.pPeople[q] !== ps.pPeople[p] ? 1 + P.foreign : 1
        const def = ps.pMass[p] > localOf(s, ps, c) ? ps.pMass[p] : localOf(s, ps, c)
        const ratio = (projAt(ps, q, dd) * (P.subBase + (1 - P.subBase) * grainShare(s, c))) / (P.submit * def * foreign + 1e-9)
        if (ratio >= 1 && ratio > bestR) { best = q; bestR = ratio; bestD = dd }
      }
    }
    if (best < 0) continue
    const q = best
    const living = s.living
    for (let t = 0; t < living.length; t++) {
      const id = living[t]
      if (ps.polity[id] !== p) continue
      setPolity(s, ps, id, q, bestD + ps.dist[id])
      if (s.pop[id] >= TOWN_POPULATION) logEvent(s, EventType.Joined, id, ps.pCapital[q], q)
    }
    ps.diag.absorbed++
    endPolity(s, ps, p, PolityEnd.Absorbed, ps.pCapital[q])
  }
}
