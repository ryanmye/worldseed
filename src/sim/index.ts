// Planet generation entry point. Pure, deterministic in (seed, options), no DOM.

import type { GenerateWorld, World, WorldOptions } from '../contract.ts'
import { classifyBiomes } from './biomes.ts'
import { generateClimate } from './climate.ts'
import { generateElevation } from './elevation.ts'
import { DEFAULT_SUBDIVISIONS, buildGrid } from './grid.ts'
import { generatePlates } from './plates.ts'
import { createRng } from './rng.ts'
import { computeLakes, computeRivers } from './rivers.ts'

export const generateWorld: GenerateWorld = (seed: number, options?: WorldOptions): World => {
  const n = options?.subdivisions ?? DEFAULT_SUBDIVISIONS
  const grid = buildGrid(n)

  // One independent stream per subsystem: adding draws to one never shifts another.
  const worldRng = createRng(seed, 'world')
  const oceanFraction = worldRng.range(0.58, 0.72)
  const continentalFraction = 1 - oceanFraction + worldRng.range(0.0, 0.08)

  const plates = generatePlates(grid, createRng(seed, 'plates'), { continentalFraction })
  const { elevation } = generateElevation(grid, plates, createRng(seed, 'elevation'), { oceanFraction })
  const { temperature, rainfall } = generateClimate(grid, elevation, createRng(seed, 'climate'))
  const biome = classifyBiomes(elevation, temperature, rainfall)
  const { riverTo, flow, filled } = computeRivers(grid, elevation, rainfall)
  const lake = computeLakes(grid, elevation, filled)

  return {
    seed,
    // Strip the sim-internal float64 positions; return only contract fields.
    grid: {
      cellCount: grid.cellCount,
      positions: grid.positions,
      triangles: grid.triangles,
      neighborOffsets: grid.neighborOffsets,
      neighbors: grid.neighbors,
    },
    plateCount: plates.count,
    plate: plates.plate,
    elevation,
    temperature,
    rainfall,
    biome,
    riverTo,
    flow,
    lake,
  }
}

export { createHistoryRun, simulateHistory } from './history/index.ts'
export { cradleCount, previewCradles } from './history/cradleWish.ts' // cradle wishes
export type { CradlePreview } from './history/cradleWish.ts'
export type { World, WorldOptions } from '../contract.ts'
