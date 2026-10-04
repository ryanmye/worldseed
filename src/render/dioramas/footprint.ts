// How large a settlement's town plan (town.ts) is at its peak population, cheaply and
// without building it: for the town generator's own sizing and for anything that must
// make room for the town before its plan exists (terrainHeight.ts flattens a valley floor
// under it). Pure: depends only on the population convention (census.ts).

import { CITY_POPULATION, TOWN_POPULATION } from '../../contract.ts'
import { HOUSEHOLD, urbanPopulation } from './census.ts'

/** Mean patch spacing of a plan (KayKit units, before planScale). */
export const PATCH = 1.75
/** World units (object space, planet radius 1) per KayKit unit (models.ts KK). */
const KAYKIT_UNIT = 0.00075

/** Households of the town at peak population p (census.ts). */
export const townHouseholds = (p: number) => urbanPopulation(p) / HOUSEHOLD

/**
 * Households an inner patch of a plan for peak p is expected to hold (its dry share aside):
 * detached one-storey houses in a village, two-storey rows in a town, three- and four-storey
 * terraces and courtyard blocks in a city core. Only sizes the plan; the lots decide.
 * (Measured: what the lot cutter's patches hold when fully grown, a tenth less.)
 */
export function householdsPerPatch(p: number): number {
  if (p >= CITY_POPULATION * 0.85) return 16 + 7 * Math.min(1, Math.max(0, p - CITY_POPULATION) / 80000)
  if (p >= TOWN_POPULATION * 0.8) return 10.5
  return 5.5
}

/**
 * Footprint scale of the town of peak population p: a village's houses at full size, a
 * town's and a city's narrower and closer (0.7 from 10,000 up), so a city is a dense
 * fabric of many buildings rather than a village blown up. Heights shrink by its square
 * root only (storeys stay readable).
 */
export function planScale(p: number): number {
  const t = Math.min(1, Math.max(0, Math.log10(Math.max(1, p) / 1000)))
  return 1 - 0.3 * t
}

/** Expected radius of the town of peak population p on open dry land (KayKit units). */
export function townRadius(p: number): number {
  return (PATCH * Math.sqrt(townHouseholds(p) / householdsPerPatch(p) + 1.2) * 1.05 + 0.6) * planScale(p)
}

/**
 * The ground the town of a settlement of peak population p covers, in world units (object
 * space, planet radius 1) round its plan's centre: `radius` holds nine in ten of its
 * buildings on open dry land; `reach` its farthest, where it has grown out along a road
 * or a shore (about 1.5 times as far). On a coast the town is lopsided and its centre
 * (layout.ts originOf) stands up to ~0.75 of a cell spacing inland of the cell centre.
 */
export function townFootprint(p: number): { radius: number; reach: number } {
  const r = townRadius(Math.max(1, p)) * KAYKIT_UNIT
  return { radius: r, reach: r * 1.5 }
}
