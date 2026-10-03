// Harvest weather: a global anomaly (with rare multi-year crises) plus one
// anomaly per weather region (with occasional regional droughts). Drawn from
// its own stream with a fixed number of draws per region per year, so the
// weather of a world never depends on what its settlements do.

import type { World } from '../../contract.ts'
import type { Rng } from '../rng.ts'
import { clamp } from '../util.ts'
import { WEATHER } from './params.ts'
import type { HistoryState } from './state.ts'

/** Approximately standard normal (Irwin-Hall with 4 uniforms); arithmetic only. */
export function gauss(rng: Rng): number {
  return (rng.next() + rng.next() + rng.next() + rng.next() - 2) * 1.7320508075688772
}

export interface Weather {
  rng: Rng
  regionCount: number
  region: Uint16Array
  regional: Float64Array
  drought: Float64Array
  droughtLeft: Int32Array
  global: number
  crisis: number
  crisisLeft: number
}

/** Assigns every cell to its nearest of WEATHER.regions random centres. */
export function createWeather(world: World, rng: Rng): Weather {
  const N = world.grid.cellCount
  const P = world.grid.positions
  const R = WEATHER.regions
  const centres = new Float64Array(R * 3)
  const v = [0, 0, 0]
  for (let r = 0; r < R; r++) {
    rng.unitVector(v)
    centres[r * 3] = v[0]
    centres[r * 3 + 1] = v[1]
    centres[r * 3 + 2] = v[2]
  }
  const region = new Uint16Array(N)
  for (let i = 0; i < N; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]
    let best = 0, bestDot = -2
    for (let r = 0; r < R; r++) {
      const d = x * centres[r * 3] + y * centres[r * 3 + 1] + z * centres[r * 3 + 2]
      if (d > bestDot) { bestDot = d; best = r }
    }
    region[i] = best
  }
  return {
    rng, regionCount: R, region,
    regional: new Float64Array(R),
    drought: new Float64Array(R),
    droughtLeft: new Int32Array(R),
    global: 0, crisis: 0, crisisLeft: 0,
  }
}

/** System: advance the weather one year and write harvest multipliers per region. */
export function weatherSystem(s: HistoryState, w: Weather): void {
  const W = WEATHER
  const rng = w.rng
  w.global = W.globalPersistence * w.global + W.globalSigma * gauss(rng)
  const crisisRoll = rng.next()
  const crisisSev = rng.range(W.crisisMin, W.crisisMax)
  const crisisLen = rng.int(W.crisisYearsMin, W.crisisYearsMax)
  if (w.crisisLeft > 0 && --w.crisisLeft === 0) w.crisis = 0
  if (w.crisisLeft === 0 && crisisRoll < W.crisisChance) { w.crisis = crisisSev; w.crisisLeft = crisisLen }
  for (let r = 0; r < w.regionCount; r++) {
    w.regional[r] = W.regionalPersistence * w.regional[r] + W.regionalSigma * gauss(rng)
    const roll = rng.next()
    const sev = rng.range(W.droughtMin, W.droughtMax)
    const len = rng.int(W.droughtYearsMin, W.droughtYearsMax)
    if (w.droughtLeft[r] > 0 && --w.droughtLeft[r] === 0) w.drought[r] = 0
    if (w.droughtLeft[r] === 0 && roll < W.droughtChance) { w.drought[r] = sev; w.droughtLeft[r] = len }
    s.harvest[r] = clamp(1 + w.global + w.regional[r] - w.crisis - w.drought[r], W.harvestMin, W.harvestMax)
  }
}
