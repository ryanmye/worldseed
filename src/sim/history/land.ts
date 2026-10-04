// Land systems: how people change the ground they live on.
//
// Land use: each living settlement cultivates its catchment, nearest cells
// first, until the cultivated land feeds its people. On a cell it shares, a
// settlement can work at most its share of the claims (the share the food
// system gives it), so the cultivated fraction of a cell is the sum over its
// claimants of share * (fraction of that share they need). The food system
// records these targets as it computes food (one pass over each catchment);
// this file moves use toward them: quickly when fields are cleared, over
// decades when they go wild. A village farms part of its own cell; a city
// farms its whole reach.
//
// Degradation: intensive use (beyond an onset, squared) times the land's
// fragility (steep, arid, rainforest, taiga high; floodplains low) and the
// crowding of the people farming it makes a load; only load beyond a
// tolerance exhausts the soil. So sturdy farmland under moderate use stays
// healthy, while fragile land and over-crowded heartlands (including cities
// living beyond their land) wear out. Land recovers when left alone.
// Degraded farmland yields less, which feeds back into food, migration and
// abandonment.

import { smoothstep } from '../util.ts'
import { DEGRADATION, LAND } from './params.ts'
import type { HistoryState } from './state.ts'

/** Effective capacity of cell j at productivity 1 from its current degradation and farm multiplier. */
export function effectiveCapacity(s: HistoryState, j: number): number {
  const T = s.terrain
  return T.capFarm[j] * (1 - DEGRADATION.yieldLoss * s.degradation[j]) * s.farmMul[j] + T.capFish[j]
}

/**
 * System: cultivation moves toward this year's targets (set by the food
 * system as it works out where each settlement's food comes from), one
 * LAND.step of years at a time.
 */
export function landUseSystem(s: HistoryState): void {
  const target = s.landTarget
  const active = s.active
  const count = s.activeCount
  // Move use toward the target; consume the target (all non-zero targets are on active cells).
  const u = s.landUse
  const stressAcc = s.stressAcc
  const stress = s.landStress
  const L = LAND
  const up = L.clearRate * L.step
  const down = L.wildRate * L.step
  for (let t = 0; t < count; t++) {
    const j = active[t]
    const x = u[j]
    let tg = target[j]
    stress[j] = tg > 0 ? stressAcc[j] / tg : 0
    stressAcc[j] = 0
    target[j] = 0
    if (tg > 1) tg = 1
    if (tg === x) continue
    let v = x + (tg - x) * (tg > x ? up : down)
    if (tg === 0 && v < L.epsilon) v = 0
    u[j] = v
  }
}

/** System: soil exhaustion under use, recovery when left alone (one LAND.step); updates effective capacity. Retires wild cells. */
export function degradationSystem(s: HistoryState): void {
  const T = s.terrain
  const { fragility, capFarm, capFish } = T
  const stress = s.landStress
  const u = s.landUse
  const deg = s.degradation
  const farmMul = s.farmMul
  const effCap = s.effCap
  const D = DEGRADATION
  const dt = LAND.step
  const onsetScale = 1 / (1 - D.onset)
  const active = s.active
  const count = s.activeCount
  let w = 0
  for (let t = 0; t < count; t++) {
    const j = active[t]
    const x = u[j]
    let d = deg[j]
    if (x === 0 && d === 0) { s.isActive[j] = 0; continue }
    let e = (x - D.onset) * onsetScale
    if (e < 0) e = 0
    let wear = 0
    if (e > 0) {
      const load = e * e * fragility[j] * (D.stressBase + (1 - D.stressBase) * smoothstep(D.crowdLow, D.crowdHigh, stress[j])) * s.sp.wear[j] // species-v2: crop wear (cashCrops.ts)
      if (load > D.tolerance) wear = D.rate * (load - D.tolerance)
    }
    d += dt * (wear * (1 - d) - d * (D.recovery * (1 - x) + D.renewal))
    if (x === 0 && d < LAND.epsilon) d = 0
    deg[j] = d
    effCap[j] = capFarm[j] * (1 - D.yieldLoss * d) * farmMul[j] + capFish[j]
    active[w++] = j
  }
  s.activeCount = w
}

/** Rebuilds effective capacity of every land cell (after farm multipliers change). */
export function refreshCapacity(s: HistoryState): void {
  const cells = s.terrain.landCells
  for (let t = 0; t < cells.length; t++) s.effCap[cells[t]] = effectiveCapacity(s, cells[t])
}
