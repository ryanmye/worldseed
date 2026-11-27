// polities: per-polity member aggregates, one O(living) pass per POLITY.step (MASTER-PLAN §1.4, D-dup 9; owner: society).
// Court, MIR, FP and migration read these (polAgg) instead of making their own passes. RNG-free, read-only on the rest.
// The pass runs when a reader exists (society on); readers must not call polAgg otherwise.

import { TOWN_POPULATION } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { foodBase } from '../migration.ts'
import type { PolityState } from './state.ts'

export interface PolAggs {
  cap: number
  /** Σ pop, Σ foodBase (loads a year), people in members >= TOWN_POPULATION, Σ wealth, Σ merchant capital (goods' mw). */
  pop: Float64Array
  food: Float64Array
  town: Float64Array
  wealth: Float64Array
  mw: Float64Array
  /** The member with the most merchant capital (else the largest town), -1. */
  top: Int32Array
}

export function createAggs(): PolAggs {
  const n = 64
  return { cap: n, pop: new Float64Array(n), food: new Float64Array(n), town: new Float64Array(n), wealth: new Float64Array(n), mw: new Float64Array(n), top: new Int32Array(n) }
}

function ensure(a: PolAggs, need: number): void {
  if (need <= a.cap) return
  let n = a.cap
  while (n < need) n *= 2
  a.pop = new Float64Array(n); a.food = new Float64Array(n); a.town = new Float64Array(n); a.wealth = new Float64Array(n); a.mw = new Float64Array(n); a.top = new Int32Array(n)
  a.cap = n
}

/** The pass (every POLITY.step, after the control pass): members' sums per polity, in s.living order. */
export function aggregatePass(s: HistoryState, ps: PolityState, a: PolAggs): void {
  ensure(a, ps.P)
  const P = ps.P
  a.pop.fill(0, 0, P); a.food.fill(0, 0, P); a.town.fill(0, 0, P); a.wealth.fill(0, 0, P); a.mw.fill(0, 0, P); a.top.fill(-1, 0, P)
  const m = s.goods !== null ? s.goods.ext.merch.mw : null
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const p = ps.polity[id]
    if (p < 0) continue
    const pop = s.pop[id]
    a.pop[p] += pop
    a.food[p] += foodBase(s, id)
    if (pop >= TOWN_POPULATION) a.town[p] += pop
    a.wealth[p] += s.wealth[id]
    const x = m !== null && id < m.length ? m[id] : 0
    a.mw[p] += x
    if (pop < TOWN_POPULATION) continue
    const b = a.top[p]
    const bx = b >= 0 && m !== null && b < m.length ? m[b] : 0
    if (b < 0 || x > bx || (x === bx && pop > s.pop[b])) a.top[p] = id
  }
}

/** polAgg: the aggregates of polity p as of the last pass. */
export function polAgg(a: PolAggs, p: number): { pop: number; food: number; town: number; wealth: number; mw: number; top: number } {
  if (p < 0 || p >= a.cap) return { pop: 0, food: 0, town: 0, wealth: 0, mw: 0, top: -1 }
  return { pop: a.pop[p], food: a.food[p], town: a.town[p], wealth: a.wealth[p], mw: a.mw[p], top: a.top[p] }
}
