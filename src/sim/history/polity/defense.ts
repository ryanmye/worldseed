// polities: static defensibility of each cell (design 7.1), from the World alone.
//
// A raw score per land cell sums the features that make a town site defensible:
//   hill        DEFENSE.hill * smoothstep over the rank of its relief relative to its surroundings
//               (elevation above the mean of the cells within two hops, sea counting as sea level):
//               hilltops, spurs, crags, coastal heights
//   island      DEFENSE.island on a landmass < 40 cells (at n = 48)
//   peninsula   DEFENSE.peninsula * smoothstep(penLow, penHigh, sea share within two hops): headlands, necks
//   river bend  DEFENSE.bend with >= 3 river neighbours (water on several sides: a meander's core, an island in it)
//   confluence  DEFENSE.confluence on a river cell that two rivers flow into
//   pass        DEFENSE.pass where two neighbours not beside each other rise passRise above it (a narrow way between heights)
//   marsh       DEFENSE.marsh with >= 2 lake neighbours
//   mountain    DEFENSE.mountain on Mountain cells
//   river line  DEFENSE.river on any river cell
// The score is then ranked among the habitable cells: D = smoothstep(q(1 - DEFENSE.share), q(1 - DEFENSE.fullShare), raw),
// so only about `share` of the habitable land counts as defensible at all and about `fullShare` fully;
// T = 1 + 1.2 * D in [1, 2.2]. (Was: T summed from absolute elevation, coast and river terms, which gave half the
// habitable land some defensibility and left site choice almost blind to it.)
// Deterministic: fixed loops, a numeric typed-array sort, only + - * /.

import { Biome, RIVER_FLOW_THRESHOLD } from '../../../contract.ts'
import type { World } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { Terrain } from '../terrain.ts'
import { DEFENSE } from './params.ts'

export function buildDefense(world: World, T: Terrain): { defense: Float64Array; defenseD: Float64Array } {
  const X = DEFENSE
  const N = T.cellCount
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const elev = world.elevation, flow = world.flow
  const defense = new Float64Array(N).fill(1)
  const defenseD = new Float64Array(N)
  const island = 40 * (T.n / 48) * (T.n / 48)
  const river = (c: number): boolean => !T.sea[c] && !world.lake[c] && flow[c] >= RIVER_FLOW_THRESHOLD
  // Relief relative to surroundings, and the sea share, within two hops.
  const prom = new Float64Array(N)
  const seaShare = new Float64Array(N)
  const stamp = new Int32Array(N).fill(-1)
  const ring: number[] = []
  for (let c = 0; c < N; c++) {
    if (T.sea[c]) continue
    ring.length = 0
    stamp[c] = c
    for (let k = off[c]; k < off[c + 1]; k++) { const j = nb[k]; if (stamp[j] !== c) { stamp[j] = c; ring.push(j) } }
    const r1 = ring.length
    for (let t = 0; t < r1; t++) {
      const i = ring[t]
      for (let k = off[i]; k < off[i + 1]; k++) { const j = nb[k]; if (stamp[j] !== c) { stamp[j] = c; ring.push(j) } }
    }
    let sum = 0, sea = 0
    for (let t = 0; t < ring.length; t++) {
      const j = ring[t]
      if (T.sea[j]) sea++
      sum += elev[j] > 0 ? elev[j] : 0
    }
    const e = elev[c] > 0 ? elev[c] : 0
    prom[c] = ring.length > 0 ? e - sum / ring.length : 0
    seaShare[c] = ring.length > 0 ? sea / ring.length : 0
  }
  // Rank of relief among the habitable cells.
  const hab: number[] = []
  for (let c = 0; c < N; c++) if (T.habitable[c]) hab.push(c)
  const H = hab.length
  const quantile = (v: Float64Array, q: number): number => (H > 0 ? v[Math.min(H - 1, Math.floor(q * H))] : 0)
  const sortedProm = new Float64Array(H)
  for (let t = 0; t < H; t++) sortedProm[t] = prom[hab[t]]
  sortedProm.sort()
  const pLow = quantile(sortedProm, X.hillLow), pHigh = quantile(sortedProm, X.hillHigh)
  // Raw score.
  const raw = new Float64Array(N)
  for (let c = 0; c < N; c++) {
    if (T.sea[c]) continue
    let r = 0
    if (prom[c] > 0) r += X.hill * (pHigh > pLow ? smoothstep(pLow, pHigh, prom[c]) : prom[c] >= pHigh ? 1 : 0)
    if (T.landmassSize[T.landmass[c]] < island) r += X.island
    r += X.peninsula * smoothstep(X.penLow, X.penHigh, seaShare[c])
    let rivers = 0, inflow = 0, lakes = 0
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (river(j)) { rivers++; if (world.riverTo[j] === c) inflow++ }
      if (world.lake[j]) lakes++
    }
    if (rivers >= 3) r += X.bend
    const isRiver = river(c)
    if (isRiver && inflow >= 2) r += X.confluence
    if (isRiver) r += X.river
    if (lakes >= 2) r += X.marsh
    if (world.biome[c] === Biome.Mountain) r += X.mountain
    // Pass: two neighbours rising passRise above c that are not neighbours of each other.
    const rise = elev[c] + X.passRise
    let pass = false
    for (let k = off[c]; k < off[c + 1] && !pass; k++) {
      const a = nb[k]
      if (elev[a] < rise) continue
      for (let m = k + 1; m < off[c + 1] && !pass; m++) {
        const b = nb[m]
        if (elev[b] < rise) continue
        let adj = false
        for (let q = off[a]; q < off[a + 1]; q++) if (nb[q] === b) { adj = true; break }
        if (!adj) pass = true
      }
    }
    if (pass) r += X.pass
    raw[c] = r
  }
  // Rank-based D among the habitable cells.
  const sortedRaw = new Float64Array(H)
  for (let t = 0; t < H; t++) sortedRaw[t] = raw[hab[t]]
  sortedRaw.sort()
  const lo = quantile(sortedRaw, 1 - X.share), hi = quantile(sortedRaw, 1 - X.fullShare)
  for (let c = 0; c < N; c++) {
    if (T.sea[c]) continue
    const r = raw[c]
    const d = r <= lo ? 0 : hi > lo ? smoothstep(lo, hi, r) : 1
    defenseD[c] = d
    defense[c] = 1 + 1.2 * d
  }
  return { defense, defenseD }
}
