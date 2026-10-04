// polities: static defensibility of each cell (design 7.1), from the World alone.
//
//   T = 1 + 0.6 * smoothstep(0.25, 0.6, elevation)        hills, hilltops
//         + 0.3 * [Mountain]
//         + 0.4 * [landmass < 40 cells (at n = 48)]       islands
//         + 0.3 * [at least half the neighbours are sea]   peninsulas, headlands
//         + 0.15 * [river cell]                            river lines and fords
//         + 0.2 * [Rainforest or >= 2 lake neighbours]     marsh, swamp, forest refuge
//   capped at 2.2;   D = (T - 1) / 1.2 in [0, 1].

import { Biome, RIVER_FLOW_THRESHOLD } from '../../../contract.ts'
import type { World } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { Terrain } from '../terrain.ts'

export function buildDefense(world: World, T: Terrain): { defense: Float64Array; defenseD: Float64Array } {
  const N = T.cellCount
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const defense = new Float64Array(N).fill(1)
  const defenseD = new Float64Array(N)
  const island = 40 * (T.n / 48) * (T.n / 48)
  for (let c = 0; c < N; c++) {
    if (T.sea[c]) continue
    const e = world.elevation[c]
    let t = 1 + 0.6 * smoothstep(0.25, 0.6, e)
    if (world.biome[c] === Biome.Mountain) t += 0.3
    if (T.landmassSize[T.landmass[c]] < island) t += 0.4
    let sea = 0, lakes = 0, n = 0
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      n++
      if (T.sea[j]) sea++
      else if (world.lake[j]) lakes++
    }
    if (2 * sea >= n) t += 0.3
    if (world.flow[c] >= RIVER_FLOW_THRESHOLD) t += 0.15
    if (world.biome[c] === Biome.Rainforest || lakes >= 2) t += 0.2
    if (t > 2.2) t = 2.2
    defense[c] = t
    defenseD[c] = (t - 1) / 1.2
  }
  return { defense, defenseD }
}
