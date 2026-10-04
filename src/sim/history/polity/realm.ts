// polities: choosing capitals and splitting leftovers into successor states (design 6.3 step 5,
// 7.3 capitals, 8.3, 8.6).
//
// New-capital score = pop * (1 - 0.5 z) * sqrt(T) * centrality, centrality = 1 / (1 + d / lambda) with d
// the member's graph cost from the old capital (the only distances at hand; a proxy for its mean
// distance to the other members). Successor states: the leftover members of a polity that lost its
// capital (or a fragmenting one) split into the connected groups they form on the settlement graph;
// a group of POLITY.minState people and at least two settlements becomes a new polity (its largest
// member the capital, parent the old polity), the rest go stateless.

import { EventType } from '../../../contract.ts'
import type { PolityOrigin } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { logEvent } from '../state.ts'
import { controlOne } from './control.ts'
import { POLITY, RELATION } from './params.ts'
import { FAR, clampAsab, newPolity, setPolity } from './state.ts'
import type { PolityState } from './state.ts'
import { ensureRelation } from './relations.ts'

/** Score of settlement id as a capital (lambda the polity's reach). */
export function capitalScore(s: HistoryState, ps: PolityState, id: number, lambda: number): number {
  const d = ps.dist[id] < FAR ? ps.dist[id] : 10 * lambda
  return (s.pop[id] * (1 - 0.5 * ps.danger[id]) * Math.sqrt(ps.defense[s.cell[id]])) / (1 + d / lambda)
}

/** Best capital among ids (alive), or -1. */
export function chooseCapital(s: HistoryState, ps: PolityState, ids: readonly number[], lambda: number): number {
  let best = -1, bestS = -1
  for (const id of ids) {
    if (s.abandoned[id] >= 0) continue
    const sc = capitalScore(s, ps, id, lambda)
    if (sc > bestS) { bestS = sc; best = id }
  }
  return best
}

/** Members of polity p among the living, ascending. */
export function membersOf(s: HistoryState, ps: PolityState, p: number): number[] {
  const out: number[] = []
  const living = s.living
  for (let t = 0; t < living.length; t++) if (ps.polity[living[t]] === p) out.push(living[t])
  return out
}

/**
 * Connected groups (over the settlement graph, within `ids`) of the given settlements: each with enough
 * people becomes a successor state of `parent` (origin given; Seceded logged against `oldCap`), the rest
 * go stateless. The ids must currently not belong to a living polity they should stay in (the caller
 * has set them aside). Returns the new polity ids.
 */
export function successors(s: HistoryState, ps: PolityState, ids: readonly number[], parent: number, origin: PolityOrigin, oldCap: number): number[] {
  const out: number[] = []
  if (ids.length === 0) return out
  const run = ++ps.run
  const { stamp } = ps
  for (const id of ids) stamp[id] = run
  const done = ++ps.run
  const group: number[] = []
  for (const seed of ids) {
    if (stamp[seed] !== run) continue
    group.length = 0
    stamp[seed] = done
    group.push(seed)
    for (let h = 0; h < group.length; h++) {
      const nb = ps.gNb[group[h]]
      if (!nb) continue
      for (let k = 0; k < nb.length; k++) {
        const v = nb[k]
        if (stamp[v] !== run) continue
        stamp[v] = done
        group.push(v)
      }
    }
    let pop = 0, cap = -1
    for (const id of group) { pop += s.pop[id]; if (cap < 0 || s.pop[id] > s.pop[cap]) cap = id }
    if (group.length >= 2 && pop >= POLITY.minState) {
      for (const id of group) setPolity(s, ps, id, -1, FAR)
      const q = newPolity(s, ps, cap, origin, parent)
      for (const id of group) if (id !== cap) setPolity(s, ps, id, q, FAR)
      for (const id of group) { ps.asab[id] = clampAsab(ps.asab[id] + POLITY.foundAsab); ps.unrest[id] = 0 }
      if (parent >= 0 && ps.pEnded[parent] < 0) {
        const r = ensureRelation(ps, parent, q)
        ps.relR[r] = RELATION.secedeR
        ps.relTruce[r] = s.year + RELATION.truceSecede
      }
      logEvent(s, EventType.Seceded, cap, oldCap, q)
      controlOne(s, ps, q, ps.heap)
      out.push(q)
    } else {
      for (const id of group) setPolity(s, ps, id, -1, FAR)
    }
  }
  return out
}
