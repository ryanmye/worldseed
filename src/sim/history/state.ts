// Shared mutable state of a history run, plus the few primitive operations
// every system uses (found, abandon, log). Systems are plain functions over
// this state, run in a fixed order each year (see index.ts).

import type { EventType, HistoryEvent, JourneyKind, Structure, World } from '../../contract.ts'
import { EventType as Ev, StructureType } from '../../contract.ts'
import type { Rng } from '../rng.ts'
import type { Terrain } from './terrain.ts'
import { PRODUCTIVITY } from './params.ts'

/** A recorded journey before it is sorted and flattened into `Journeys`. */
export interface JourneyRecord {
  departYear: number
  arriveYear: number
  from: number
  to: number
  size: number
  kind: JourneyKind
  /** Cell path, origin cell first, destination cell last. */
  path: number[]
}

export interface HistoryState {
  world: World
  terrain: Terrain
  year: number
  /** Productivity multiplier on all capacities this year. */
  productivity: number

  // Settlements, struct-of-arrays indexed by id; `count` ids exist.
  count: number
  cell: Int32Array
  pop: Float64Array
  /** Food supply ratio in [0, 1] this year. */
  food: Float64Array
  /** Expected food (people fed) at an average harvest, this year. */
  expected: Float64Array
  /** Food actually produced this year (expected * harvest). */
  supply: Float64Array
  founded: Int32Array
  parent: Int32Array
  abandoned: Int32Array
  lastFamine: Int32Array
  /** Year before which the settlement sends no new group (after a failed search). */
  nextMigration: Int32Array
  /** Structure id of the settlement's port / dam in use, or -1. */
  port: Int32Array
  dam: Int32Array
  /** Bit 1: became a town, bit 2: became a city (already logged). */
  milestone: Int32Array
  /** Ids of living settlements, ascending. */
  living: number[]

  // Per cell.
  /** Living settlement on the cell, or -1. */
  occupant: Int32Array
  /** Living settlements within the exclusion radius; a cell can be settled only when 0. */
  nearCount: Int32Array
  /** Sum over living settlements of catchment weight * claim strength (population^0.75) on this cell. */
  claim: Float64Array
  /** Effective capacity this year at productivity 1: capFarm * (1 - yieldLoss * degradation) * farmMul + capFish. */
  effCap: Float64Array
  /** Cultivated fraction in [0, 1], and the target the food system set this year (consumed by the land-use system). */
  landUse: Float64Array
  landTarget: Float64Array
  /** Degradation in [0, 1]. */
  degradation: Float64Array
  /**
   * Cells with land use, a use target or degradation (the only ones the land
   * systems visit), in insertion order, and a membership flag per cell.
   */
  active: Int32Array
  activeCount: number
  isActive: Uint8Array
  /** Farm multiplier from irrigation (> 1) and reservoirs (< 1); 1 elsewhere. Rebuilt when dams change. */
  farmMul: Float64Array
  /** 1 for coastal land within PORT.range sea hops of a port in use. Rebuilt when ports change. */
  portReach: Uint8Array
  /** True in years when the land systems run (every LAND.step years); the food system then records field targets. */
  landYear: boolean
  /** Set when a dam is built or lost, or a port lost, so derived fields get rebuilt. */
  damsDirty: boolean
  portsDirty: boolean
  structures: Structure[]

  /** Harvest multiplier per cell's weather region this year, looked up via weatherRegion. */
  weatherRegion: Uint16Array
  harvest: Float64Array

  events: HistoryEvent[]
  journeys: JourneyRecord[]
  rngMigration: Rng
  rngStructures: Rng
}

export function productivityAt(year: number): number {
  return 1 + PRODUCTIVITY.linear * year + PRODUCTIVITY.quad * year * year
}

export function createState(world: World, terrain: Terrain, weatherRegion: Uint16Array, regionCount: number, rngMigration: Rng, rngStructures: Rng): HistoryState {
  const N = terrain.cellCount
  const cap = 256
  return {
    world, terrain, year: 0, productivity: productivityAt(0),
    count: 0,
    cell: new Int32Array(cap),
    pop: new Float64Array(cap),
    food: new Float64Array(cap),
    expected: new Float64Array(cap),
    supply: new Float64Array(cap),
    founded: new Int32Array(cap),
    parent: new Int32Array(cap),
    abandoned: new Int32Array(cap),
    lastFamine: new Int32Array(cap),
    nextMigration: new Int32Array(cap),
    port: new Int32Array(cap),
    dam: new Int32Array(cap),
    milestone: new Int32Array(cap),
    living: [],
    occupant: new Int32Array(N).fill(-1),
    nearCount: new Int32Array(N),
    claim: new Float64Array(N),
    effCap: Float64Array.from(terrain.capacity),
    landUse: new Float64Array(N),
    landTarget: new Float64Array(N),
    degradation: new Float64Array(N),
    active: new Int32Array(N),
    activeCount: 0,
    isActive: new Uint8Array(N),
    farmMul: new Float64Array(N).fill(1),
    portReach: new Uint8Array(N),
    landYear: false,
    damsDirty: false,
    portsDirty: false,
    structures: [],
    weatherRegion,
    harvest: new Float64Array(regionCount).fill(1),
    events: [],
    journeys: [],
    rngMigration,
    rngStructures,
  }
}

function grow<T extends Int32Array | Float64Array>(a: T, size: number): T {
  const b = new (a.constructor as { new (n: number): T })(size)
  b.set(a)
  return b
}

function ensureCapacity(s: HistoryState, need: number): void {
  if (need <= s.cell.length) return
  let size = s.cell.length
  while (size < need) size *= 2
  s.cell = grow(s.cell, size)
  s.pop = grow(s.pop, size)
  s.food = grow(s.food, size)
  s.expected = grow(s.expected, size)
  s.supply = grow(s.supply, size)
  s.founded = grow(s.founded, size)
  s.parent = grow(s.parent, size)
  s.abandoned = grow(s.abandoned, size)
  s.lastFamine = grow(s.lastFamine, size)
  s.nextMigration = grow(s.nextMigration, size)
  s.port = grow(s.port, size)
  s.dam = grow(s.dam, size)
  s.milestone = grow(s.milestone, size)
}

export function logEvent(s: HistoryState, type: EventType, settlement: number, other: number, value: number): void {
  s.events.push({ year: s.year, type, settlement, other, value })
}

export function logJourney(s: HistoryState, j: JourneyRecord): void {
  s.journeys.push(j)
}

function markNear(s: HistoryState, cell: number, delta: number): void {
  const T = s.terrain
  for (let k = T.exclOff[cell]; k < T.exclOff[cell + 1]; k++) s.nearCount[T.exclCell[k]] += delta
}

/** True when a new settlement may be founded on `cell`. */
export function canSettle(s: HistoryState, cell: number): boolean {
  return s.terrain.habitable[cell] === 1 && s.nearCount[cell] === 0 && s.occupant[cell] < 0
}

/** Founds a settlement this year and logs it. Returns its id. Ids ascend, so `living` stays sorted. */
export function found(s: HistoryState, cell: number, pop: number, parent: number): number {
  const id = s.count
  ensureCapacity(s, id + 1)
  s.count = id + 1
  s.cell[id] = cell
  s.pop[id] = pop
  s.food[id] = 1
  s.expected[id] = pop
  s.supply[id] = pop
  s.founded[id] = s.year
  s.parent[id] = parent
  s.abandoned[id] = -1
  s.lastFamine[id] = -1000000
  s.nextMigration[id] = 0
  s.port[id] = -1
  s.dam[id] = -1
  s.milestone[id] = 0
  s.living.push(id)
  s.occupant[cell] = id
  markNear(s, cell, 1)
  logEvent(s, Ev.Founded, id, parent, pop)
  return id
}

/** Builds a structure for settlement `owner` this year, logs it and returns its id. */
export function build(s: HistoryState, owner: number, type: StructureType, cell: number): number {
  const id = s.structures.length
  s.structures.push({ id, type, cell, settlement: owner, builtYear: s.year, lostYear: -1 })
  if (type === StructureType.Port) s.port[owner] = id // (the structure system extends port reach)
  else { s.dam[owner] = id; s.damsDirty = true }
  logEvent(s, Ev.Built, owner, id, type)
  return id
}

/** A structure falls out of use this year (owner abandoned, or too small to keep it up); logs it. */
export function loseStructure(s: HistoryState, id: number): void {
  const st = s.structures[id]
  st.lostYear = s.year
  if (st.type === StructureType.Port) { s.port[st.settlement] = -1; s.portsDirty = true }
  else { s.dam[st.settlement] = -1; s.damsDirty = true }
  logEvent(s, Ev.StructureLost, st.settlement, id, st.type)
}

/** Abandons a settlement this year (the caller removes it from `living`); its structures fall out of use. */
export function abandon(s: HistoryState, id: number): void {
  logEvent(s, Ev.Abandoned, id, -1, s.pop[id])
  s.abandoned[id] = s.year
  s.pop[id] = 0
  s.food[id] = 0
  s.occupant[s.cell[id]] = -1
  markNear(s, s.cell[id], -1)
  if (s.port[id] >= 0) loseStructure(s, s.port[id])
  if (s.dam[id] >= 0) loseStructure(s, s.dam[id])
}
