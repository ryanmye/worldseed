// Shared contract between the simulation (src/sim) and the renderer (src/render).
// Neither side imports anything from the other except through these types and
// the `generateWorld` entry point exported by src/sim/index.ts.

/**
 * The planet surface as a graph of cells. Cells are the vertices of a
 * subdivided icosahedron projected onto the unit sphere, so every cell has
 * 5 or 6 neighbours and cells are near-uniform in area.
 */
export interface Grid {
  cellCount: number
  /** Unit-sphere xyz per cell, length 3 * cellCount. +Y is the north pole. */
  positions: Float32Array
  /** Triangle list over cell indices (the icosphere faces), length 3 * triangleCount. Counter-clockwise seen from outside. */
  triangles: Uint32Array
  /**
   * CSR adjacency: neighbours of cell i are neighbors[neighborOffsets[i] .. neighborOffsets[i + 1]).
   * Each ring is ordered counter-clockwise seen from outside.
   */
  neighborOffsets: Uint32Array
  neighbors: Uint32Array
}

export const Biome = {
  Ocean: 0,
  Coast: 1, // shallow water
  Ice: 2,
  Tundra: 3,
  Taiga: 4,
  TemperateForest: 5,
  Grassland: 6,
  Desert: 7,
  Savanna: 8,
  Rainforest: 9,
  Mountain: 10,
} as const
export type Biome = (typeof Biome)[keyof typeof Biome]
export const BIOME_COUNT = 11

/** A generated planet. All per-cell arrays have length grid.cellCount. */
export interface World {
  seed: number
  grid: Grid
  plateCount: number
  /** Tectonic plate id per cell, in [0, plateCount). */
  plate: Uint16Array
  /** Elevation in [-1, 1]; sea level is 0. */
  elevation: Float32Array
  /** Mean temperature in [0, 1]; 0 is polar cold, 1 is equatorial hot. */
  temperature: Float32Array
  /** Annual rainfall in [0, 1]. */
  rainfall: Float32Array
  /** Biome id per cell, see `Biome`. */
  biome: Uint8Array
  /** Downstream cell for land drainage, or -1 for ocean cells and sinks. */
  riverTo: Int32Array
  /** Accumulated drainage flow per cell (>= 0); cells at or above RIVER_FLOW_THRESHOLD are rivers. */
  flow: Float32Array
  /** 1 where a land cell is covered by a lake (a filled depression), else 0. Lake cells keep a land biome. */
  lake: Uint8Array
}

/** Flow at or above this is a river. Flow is scaled to be independent of grid resolution. */
export const RIVER_FLOW_THRESHOLD = 6

export interface WorldOptions {
  /** Icosphere subdivision frequency; cellCount = 10 * n^2 + 2. Default 48 (~23k cells). */
  subdivisions?: number
}

/** Signature of the entry point exported by src/sim/index.ts. Must be deterministic in (seed, options). */
export type GenerateWorld = (seed: number, options?: WorldOptions) => World
