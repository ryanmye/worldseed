// Biome classification from temperature, rainfall and elevation
// (a simplified Whittaker diagram).

import { Biome } from '../contract.ts'

export const BIOME_THRESHOLDS = {
  /** Water shallower than this (elevation > -x) is Coast. */
  coastDepth: 0.1,
  /** Sea colder than this freezes. */
  seaIce: 0.12,
  /** Land colder than this is ice sheet. */
  landIce: 0.07,
  /** Land above this elevation is Mountain. */
  mountain: 0.4,
  tundra: 0.22,
  taiga: 0.38,
  tropical: 0.72,
  /** Rainfall cuts: below desert* is Desert; temperate forest needs forest; rainforest needs rainforest. */
  desertTemperate: 0.14,
  forest: 0.33,
  desertTropical: 0.17,
  rainforest: 0.5,
}

export function classifyBiomes(elevation: Float32Array, temperature: Float32Array, rainfall: Float32Array): Uint8Array {
  const T = BIOME_THRESHOLDS
  const N = elevation.length
  const biome = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    const e = elevation[i]
    const t = temperature[i]
    const r = rainfall[i]
    let b: Biome
    if (e < 0) {
      if (t < T.seaIce) b = Biome.Ice
      else if (e > -T.coastDepth) b = Biome.Coast
      else b = Biome.Ocean
    } else if (t < T.landIce) {
      b = Biome.Ice
    } else if (e > T.mountain) {
      b = Biome.Mountain
    } else if (t < T.tundra) {
      b = Biome.Tundra
    } else if (t < T.taiga) {
      b = r < 0.12 ? Biome.Tundra : Biome.Taiga
    } else if (t < T.tropical) {
      if (r < T.desertTemperate) b = Biome.Desert
      else if (r < T.forest) b = Biome.Grassland
      else b = Biome.TemperateForest
    } else {
      if (r < T.desertTropical) b = Biome.Desert
      else if (r < T.rainforest) b = Biome.Savanna
      else b = Biome.Rainforest
    }
    biome[i] = b
  }
  return biome
}
