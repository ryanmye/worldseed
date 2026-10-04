// tourism: static scenery per cell (computed once at the start from the planet alone), and the spots: the most scenic
// habitable places, a few hops apart, that leisure travellers may come to (system.ts).
//
// Raw value of a land cell (not a lake) = the weighted sum (SCENERY) of: relief contrast (the highest minus the lowest
// elevation within two hops, water as 0: mountains beside lowland or water), a lake shore (fuller for a large lake), a sea
// coast (more on capes and peninsulas: the water share within two hops), a small island, a great river and its mouth,
// woodland, snow within reach (a cold mountain or glacier within two hops of a cell that is not that cold), a pleasant
// climate (moderate warmth and rainfall), a striking cold place (by ice or the sea), hot springs (plate-boundary ground,
// drawn from 'history-tourism-springs'), and the prominence of the world's largest lakes and highest range. Scenery is the
// rank among land cells: 255 u^3, so a tenth of the land is above 186 and the median 32.

import { Biome, SceneryBit } from '../../../contract.ts'
import type { World } from '../../../contract.ts'
import type { Rng } from '../../rng.ts'
import { smoothstep } from '../../util.ts'
import type { Terrain } from '../terrain.ts'
import { SCENERY } from './params.ts'

export interface Scenery {
  /** Rank-based scenery 0..255 per cell (0 at sea and on lakes). */
  scenery: Uint8Array
  /** SceneryBit flags per cell. */
  kind: Uint16Array
  /** Spots: habitable cells, most scenic first (by view, then cell). */
  spots: Int32Array
  /** View of each spot (own scenery or 0.9 of the best neighbour's), 0..255. */
  spotView: Float64Array
}

/** 1 inside [b, c], rising from a and falling to d (smooth). */
function plateau(a: number, b: number, c: number, d: number, x: number): number {
  if (x <= a || x >= d) return 0
  if (x < b) return smoothstep(a, b, x)
  if (x > c) return 1 - smoothstep(c, d, x)
  return 1
}

/** Connected components of the cells where `inside` is 1 (grid neighbours); component per cell (-1 outside) and sizes. */
function components(world: World, inside: Uint8Array): { comp: Int32Array; size: number[] } {
  const N = inside.length
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const comp = new Int32Array(N).fill(-1)
  const size: number[] = []
  const q = new Int32Array(N)
  for (let c = 0; c < N; c++) {
    if (!inside[c] || comp[c] >= 0) continue
    const id = size.length
    let h = 0, t = 0
    q[t++] = c
    comp[c] = id
    while (h < t) {
      const x = q[h++]
      for (let k = off[x]; k < off[x + 1]; k++) { const j = nb[k]; if (inside[j] && comp[j] < 0) { comp[j] = id; q[t++] = j } }
    }
    size.push(t)
  }
  return { comp, size }
}

export function computeScenery(world: World, T: Terrain, rng: Rng): Scenery {
  const X = SCENERY
  const N = T.cellCount
  const area = 23042 / N
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const { elevation: elev, temperature: temp, rainfall: rain, biome, lake, flow, plate, riverTo } = world
  const raw = new Float64Array(N)
  const kind = new Uint16Array(N)
  const isLand = new Uint8Array(N)
  for (let c = 0; c < N; c++) isLand[c] = elev[c] >= 0 && lake[c] === 0 ? 1 : 0

  // Lakes: sizes; the largest `famous` are great lakes.
  const lakes = components(world, lake)
  const lakeOrder = lakes.size.map((_, i) => i).sort((a, b) => lakes.size[b] - lakes.size[a] || a - b)
  const greatLake = new Uint8Array(lakes.size.length)
  for (let k = 0; k < lakeOrder.length && k < X.famous; k++) if (lakes.size[lakeOrder[k]] * area >= 4) greatLake[lakeOrder[k]] = 1
  // The highest range: the mountain cells connected to the highest land cell.
  const mount = new Uint8Array(N)
  let top = -1
  for (let c = 0; c < N; c++) {
    if (isLand[c] && biome[c] === Biome.Mountain) mount[c] = 1
    if (isLand[c] && (top < 0 || elev[c] > elev[top])) top = c
  }
  const ranges = components(world, mount)
  const greatRange = top >= 0 ? ranges.comp[top] : -1
  // Hot springs: plate-boundary land high enough, by chance (every candidate draws, in cell order).
  const spring = new Uint8Array(N)
  for (let c = 0; c < N; c++) {
    if (!isLand[c] || elev[c] < X.springElev || biome[c] === Biome.Ice) continue
    let edge = false
    for (let k = off[c]; k < off[c + 1]; k++) if (plate[nb[k]] !== plate[c]) { edge = true; break }
    if (edge && rng.next() < X.springChance) spring[c] = 1
  }

  // Two-hop neighbourhoods: one-hop aggregates (cell and neighbours), then the same over the neighbours' aggregates.
  const hi1 = new Float32Array(N), lo1 = new Float32Array(N), water1 = new Float32Array(N), flag1 = new Uint8Array(N)
  const SNOW = 1, ICE = 2, FAM = 4
  for (let c = 0; c < N; c++) {
    let hi = -1, lo = 2, water = 0, fl = 0
    for (let k = off[c] - 1; k < off[c + 1]; k++) {
      const j = k < off[c] ? c : nb[k]
      const ej = elev[j]
      const e = ej > 0 ? ej : 0
      if (e > hi) hi = e
      if (e < lo) lo = e
      if (ej < 0) water++
      const bj = biome[j]
      if (ej >= 0 && (bj === Biome.Mountain || bj === Biome.Ice) && temp[j] < X.snowTemp) fl |= SNOW
      if (bj === Biome.Ice) fl |= ICE
      if (greatRange >= 0 && ranges.comp[j] === greatRange) fl |= FAM
    }
    hi1[c] = hi; lo1[c] = lo; water1[c] = water / (off[c + 1] - off[c] + 1); flag1[c] = fl
  }
  for (let c = 0; c < N; c++) {
    if (!isLand[c]) continue
    let hi = hi1[c], lo = lo1[c], water = water1[c], fl = flag1[c]
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (hi1[j] > hi) hi = hi1[j]
      if (lo1[j] < lo) lo = lo1[j]
      water += water1[j]
      fl |= flag1[j]
    }
    water /= off[c + 1] - off[c] + 1
    const snow = fl & SNOW, ice = fl & ICE
    let fam = fl & FAM ? 1 : 0
    let lakeShore = 0, forest = 0, n1 = 1
    if (biome[c] === Biome.TemperateForest || biome[c] === Biome.Taiga || biome[c] === Biome.Rainforest) forest++
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      n1++
      if (lake[j]) {
        const L = lakes.comp[j]
        const v = 0.5 + 0.5 * smoothstep(1, X.lakeBig, lakes.size[L] * area)
        if (v > lakeShore) lakeShore = v
        if (greatLake[L]) fam = 1
      }
      if (biome[j] === Biome.TemperateForest || biome[j] === Biome.Taiga || biome[j] === Biome.Rainforest) forest++
    }
    const t = temp[c], r = rain[c]
    const relief = smoothstep(X.reliefLo, X.reliefHi, hi - lo)
    const coast = T.seaCoast[c] ? 0.4 + water : 0
    const island = T.seaCoast[c] && T.landmass[c] >= 0 && T.landmassSize[T.landmass[c]] * area <= X.islandCells ? 1 : 0
    const river = T.river[c] ? smoothstep(X.riverLo, X.riverHi, flow[c]) : 0
    const mouth = T.river[c] && (T.seaCoast[c] || (riverTo[c] >= 0 && elev[riverTo[c]] < 0)) ? 1 : 0
    const wood = forest / n1
    const snowy = snow && t >= X.snowTemp - 0.04 && biome[c] !== Biome.Ice ? 1 : 0
    const pleasant = plateau(X.t0, X.t1, X.t2, X.t3, t) * plateau(X.r0, X.r1, X.r2, X.r3, r)
    const cold = t < X.coldTemp && (ice || T.seaCoast[c]) ? 1 : 0
    let v = 0
    let bits = 0
    let x = X.wRelief * relief; v += x; if (x >= 0.2) bits |= SceneryBit.Relief
    x = X.wLake * lakeShore; v += x; if (x >= 0.2) bits |= SceneryBit.Lake
    x = X.wCoast * (coast > 1 ? 1 : coast); v += x; if (x >= 0.2) bits |= SceneryBit.Coast
    x = X.wIsland * island; v += x; if (x >= 0.2) bits |= SceneryBit.Island
    x = X.wRiver * river + X.wMouth * mouth; v += x; if (x >= 0.2) bits |= SceneryBit.River
    x = X.wForest * wood; v += x; if (x >= 0.2) bits |= SceneryBit.Forest
    x = X.wSnow * snowy; v += x; if (x >= 0.2) bits |= SceneryBit.Snow
    x = X.wPleasant * pleasant; v += x; if (x >= 0.2) bits |= SceneryBit.Pleasant
    x = X.wCold * cold; v += x; if (x >= 0.2) bits |= SceneryBit.Cold
    x = X.wSpring * spring[c]; v += x; if (x >= 0.2) bits |= SceneryBit.Spring
    v += X.wFamous * fam
    // (the world's great lakes and highest range: which of the two)
    if (fam) {
      let byLake = false
      for (let k = off[c]; k < off[c + 1]; k++) if (lake[nb[k]] && greatLake[lakes.comp[nb[k]]]) byLake = true
      bits |= byLake ? SceneryBit.GreatLake : SceneryBit.GreatRange
    }
    raw[c] = v
    kind[c] = bits
  }

  // Rank over land cells.
  // (a numeric sort of keys: raw value quantised to 1e-6, then cell id)
  let L = 0
  for (let c = 0; c < N; c++) if (isLand[c]) L++
  const keys = new Float64Array(L)
  const SH = 1048576
  for (let c = 0, k = 0; c < N; c++) if (isLand[c]) keys[k++] = Math.floor(raw[c] * 1e6) * SH + c
  keys.sort()
  const scenery = new Uint8Array(N)
  for (let k = 0; k < L; k++) {
    const u = L > 1 ? k / (L - 1) : 1
    let x = u
    for (let p = 1; p < X.power; p++) x *= u
    scenery[keys[k] % SH] = (255 * x + 0.5) | 0
  }

  // Spots: habitable cells by view, spotSpacing hops apart.
  const view = new Float64Array(N)
  const cand: number[] = []
  for (let c = 0; c < N; c++) {
    if (!T.habitable[c]) continue
    let v = scenery[c]
    for (let k = off[c]; k < off[c + 1]; k++) { const j = nb[k]; const w = 0.9 * scenery[j]; if (w > v) v = w }
    view[c] = v
    if (v >= X.spotMin) cand.push(c)
  }
  cand.sort((a, b) => view[b] - view[a] || a - b)
  const blocked = new Uint8Array(N)
  const stampN = new Int32Array(N).fill(-1)
  const spots: number[] = []
  const spotMax = Math.max(8, Math.floor(X.spotMax / area))
  const q: number[] = [], dq: number[] = []
  for (let t = 0; t < cand.length && spots.length < spotMax; t++) {
    const c = cand[t]
    if (blocked[c]) continue
    spots.push(c)
    // Block within spotSpacing hops (breadth first).
    q.length = 0; dq.length = 0
    q.push(c); dq.push(0); blocked[c] = 1
    const seen = stampN // (-2 - spot index marks)
    const mark = -2 - spots.length
    seen[c] = mark
    for (let h = 0; h < q.length; h++) {
      if (dq[h] >= X.spotSpacing) continue
      const x = q[h]
      for (let k = off[x]; k < off[x + 1]; k++) { const j = nb[k]; if (seen[j] !== mark) { seen[j] = mark; blocked[j] = 1; q.push(j); dq.push(dq[h] + 1) } }
    }
  }
  const spotView = new Float64Array(spots.length)
  for (let k = 0; k < spots.length; k++) spotView[k] = view[spots[k]]
  return { scenery, kind, spots: Int32Array.from(spots), spotView }
}
