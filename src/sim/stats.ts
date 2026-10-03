// Prints per-seed world statistics. Run with:
//   node src/sim/stats.ts            (Node >= 23, native type stripping)
//   npx vitest run src/sim/stats.test.ts --reporter=default   (vitest hides passing-test logs otherwise)

import { BIOME_COUNT, Biome, RIVER_FLOW_THRESHOLD } from '../contract.ts'
import type { World } from '../contract.ts'
import { generateWorld } from './index.ts'

export const BIOME_NAMES: string[] = []
for (const [name, id] of Object.entries(Biome)) BIOME_NAMES[id] = name

/** Water shallower than this (elevation > -x) counts as shallow sea in the stats. */
export const SHALLOW_DEPTH = 0.1
/** Shallow water more than this many cell hops (at n = 48) from deep water counts as "interior shallow sea". */
export const SHALLOW_HOPS = 4
/** A landmass at least this fraction of the planet's cells counts as a continent-sized landmass. */
export const LANDMASS_MIN_FRACTION = 0.005

export interface WorldStats {
  seed: number
  ms: number
  plates: number
  oceanPct: number
  biomePct: number[]
  /** Biome share of land cells only (excludes Ocean/Coast and sea ice). */
  landBiomePct: number[]
  maxElevation: number
  minElevation: number
  riverCells: number
  maxFlow: number
  /** Lake cells as % of land cells. */
  lakePct: number
  /** Connected landmasses of at least LANDMASS_MIN_FRACTION of the planet. */
  landmasses: number
  /** Largest connected landmass as % of all land. */
  largestLandPct: number
  /** % of water cells that are shallow (> -SHALLOW_DEPTH) and farther than SHALLOW_HOPS hops from deep water. */
  interiorShallowPct: number
  /** Largest connected patch of such interior shallow water, as % of all cells. */
  interiorShallowMaxPatchPct: number
  /** % of land cells poleward of 65 degrees. */
  polarLandPct: number
  /** Land share (%) of the more land-covered of the two polar caps (poleward of 65 degrees). */
  polarCapPct: number
}

/** Connected components of cells where mask[i] = 1; returns component sizes (unsorted) and the label per cell. */
export function components(world: World, mask: Uint8Array): { sizes: number[]; label: Int32Array } {
  const N = world.grid.cellCount
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const label = new Int32Array(N).fill(-1)
  const sizes: number[] = []
  const stack = new Int32Array(N)
  for (let s = 0; s < N; s++) {
    if (!mask[s] || label[s] >= 0) continue
    const id = sizes.length
    let sp = 0, size = 0
    stack[sp++] = s
    label[s] = id
    while (sp > 0) {
      const c = stack[--sp]
      size++
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (mask[j] && label[j] < 0) { label[j] = id; stack[sp++] = j }
      }
    }
    sizes.push(size)
  }
  return { sizes, label }
}

/** Hop distance from every cell to the nearest cell with src[i] = 1 (BFS). */
export function hopDistance(world: World, src: Uint8Array): Int32Array {
  const N = world.grid.cellCount
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const dist = new Int32Array(N).fill(-1)
  const queue = new Int32Array(N)
  let head = 0, tail = 0
  for (let i = 0; i < N; i++) if (src[i]) { dist[i] = 0; queue[tail++] = i }
  while (head < tail) {
    const c = queue[head++]
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (dist[j] < 0) { dist[j] = dist[c] + 1; queue[tail++] = j }
    }
  }
  return dist
}

/** Interior shallow-sea mask: shallow water far (in hops, scaled to n = 48) from deep water. */
export function interiorShallowMask(world: World): Uint8Array {
  const N = world.grid.cellCount
  const e = world.elevation
  const deep = new Uint8Array(N)
  for (let i = 0; i < N; i++) deep[i] = e[i] <= -SHALLOW_DEPTH ? 1 : 0
  const d = hopDistance(world, deep)
  const n = Math.round(Math.sqrt((N - 2) / 10))
  const hops = Math.max(1, Math.round((SHALLOW_HOPS * n) / 48))
  const mask = new Uint8Array(N)
  for (let i = 0; i < N; i++) mask[i] = e[i] < 0 && e[i] > -SHALLOW_DEPTH && (d[i] < 0 || d[i] > hops) ? 1 : 0
  return mask
}

export function worldStats(world: World, ms: number): WorldStats {
  const N = world.grid.cellCount
  const counts = new Array<number>(BIOME_COUNT).fill(0)
  const landCounts = new Array<number>(BIOME_COUNT).fill(0)
  let ocean = 0, maxE = -Infinity, minE = Infinity, river = 0, maxFlow = 0
  let land = 0, lakes = 0, polar = 0
  let capN = 0, capS = 0, capNLand = 0, capSLand = 0
  const lake = world.lake as Uint8Array | undefined
  const landMask = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    const e = world.elevation[i]
    const yc = world.grid.positions[i * 3 + 1]
    if (yc > 0.9063) { capN++; if (e >= 0) capNLand++ }
    if (yc < -0.9063) { capS++; if (e >= 0) capSLand++ }
    counts[world.biome[i]]++
    if (e < 0) ocean++
    else {
      land++
      landMask[i] = 1
      landCounts[world.biome[i]]++
      if (lake && lake[i]) lakes++
      const y = world.grid.positions[i * 3 + 1]
      if (y > 0.9063 || y < -0.9063) polar++
    }
    if (e > maxE) maxE = e
    if (e < minE) minE = e
    if (world.flow[i] >= RIVER_FLOW_THRESHOLD) river++
    if (world.flow[i] > maxFlow) maxFlow = world.flow[i]
  }
  const { sizes } = components(world, landMask)
  let largest = 0, big = 0
  for (const s of sizes) {
    if (s > largest) largest = s
    if (s >= LANDMASS_MIN_FRACTION * N) big++
  }
  const shallow = interiorShallowMask(world)
  let shallowCount = 0
  for (let i = 0; i < N; i++) shallowCount += shallow[i]
  let maxPatch = 0
  for (const s of components(world, shallow).sizes) if (s > maxPatch) maxPatch = s
  return {
    seed: world.seed,
    ms,
    plates: world.plateCount,
    oceanPct: (100 * ocean) / N,
    biomePct: counts.map((c) => (100 * c) / N),
    landBiomePct: landCounts.map((c) => (land > 0 ? (100 * c) / land : 0)),
    maxElevation: maxE,
    minElevation: minE,
    riverCells: river,
    maxFlow,
    lakePct: land > 0 ? (100 * lakes) / land : 0,
    landmasses: big,
    largestLandPct: land > 0 ? (100 * largest) / land : 0,
    interiorShallowPct: ocean > 0 ? (100 * shallowCount) / ocean : 0,
    interiorShallowMaxPatchPct: (100 * maxPatch) / N,
    polarLandPct: land > 0 ? (100 * polar) / land : 0,
    polarCapPct: Math.max(capN > 0 ? (100 * capNLand) / capN : 0, capS > 0 ? (100 * capSLand) / capS : 0),
  }
}

const SHORT = ['Ocn', 'Cst', 'Ice', 'Tun', 'Tai', 'TmF', 'Grs', 'Des', 'Sav', 'RnF', 'Mtn']

export function formatStats(rows: WorldStats[]): string {
  const pad = (s: string, n: number) => s.padStart(n)
  const lines: string[] = []
  lines.push('IceAll and Coast are % of all cells; the biome columns after them are % of land cells')
  lines.push(
    `lake% = lake cells / land; nLand = landmasses >= ${LANDMASS_MIN_FRACTION * 100}% of planet; big% = largest landmass / land; ` +
      `shSea% = water cells shallower than ${SHALLOW_DEPTH} and > ${SHALLOW_HOPS} hops from deep water; shPatch = largest such patch, % of planet; pole% = land poleward of 65 deg; cap% = land share of the fuller polar cap`,
  )
  lines.push(
    [pad('seed', 6), pad('ms', 5), pad('pl', 3), pad('ocean%', 7), pad('maxE', 5), pad('rivers', 6), pad('maxFl', 6), pad('lake%', 5), pad('nLand', 5), pad('big%', 5), pad('shSea%', 6), pad('shPatch', 7), pad('pole%', 5), pad('cap%', 5), pad('IceAll', 6), pad('Coast', 5)]
      .concat(SHORT.slice(2).map((s) => pad(s, 5)))
      .join(' '),
  )
  for (const r of rows) {
    lines.push(
      [
        pad(String(r.seed), 6),
        pad(r.ms.toFixed(0), 5),
        pad(String(r.plates), 3),
        pad(r.oceanPct.toFixed(1), 7),
        pad(r.maxElevation.toFixed(2), 5),
        pad(String(r.riverCells), 6),
        pad(r.maxFlow.toFixed(0), 6),
        pad(r.lakePct.toFixed(2), 5),
        pad(String(r.landmasses), 5),
        pad(r.largestLandPct.toFixed(1), 5),
        pad(r.interiorShallowPct.toFixed(2), 6),
        pad(r.interiorShallowMaxPatchPct.toFixed(2), 7),
        pad(r.polarLandPct.toFixed(1), 5),
        pad(r.polarCapPct.toFixed(0), 5),
        pad(r.biomePct[Biome.Ice].toFixed(1), 6),
        pad(r.biomePct[Biome.Coast].toFixed(1), 5),
      ]
        .concat(r.landBiomePct.slice(2).map((p) => pad(p.toFixed(1), 5)))
        .join(' '),
    )
  }
  const mean = (f: (r: WorldStats) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length
  lines.push(
    [
      pad('mean', 6), pad(mean((r) => r.ms).toFixed(0), 5), pad('', 3), pad(mean((r) => r.oceanPct).toFixed(1), 7),
      pad(mean((r) => r.maxElevation).toFixed(2), 5), pad(mean((r) => r.riverCells).toFixed(0), 6), pad('', 6),
      pad(mean((r) => r.lakePct).toFixed(2), 5), pad(mean((r) => r.landmasses).toFixed(1), 5), pad(mean((r) => r.largestLandPct).toFixed(1), 5),
      pad(mean((r) => r.interiorShallowPct).toFixed(2), 6), pad(mean((r) => r.interiorShallowMaxPatchPct).toFixed(2), 7), pad(mean((r) => r.polarLandPct).toFixed(1), 5),
      pad(mean((r) => r.polarCapPct).toFixed(0), 5), pad(mean((r) => r.biomePct[Biome.Ice]).toFixed(1), 6), pad(mean((r) => r.biomePct[Biome.Coast]).toFixed(1), 5),
    ]
      .concat(SHORT.slice(2).map((_, k) => pad(mean((r) => r.landBiomePct[k + 2]).toFixed(1), 5)))
      .join(' '),
  )
  return lines.join('\n')
}

export const STATS_SEEDS = [1, 2, 3, 42, 1337, 2024, 31337, 77, 99999, 123456, 12345]

export function runStats(seeds: number[] = STATS_SEEDS): WorldStats[] {
  const rows: WorldStats[] = []
  generateWorld(0) // warm up the JIT so timings reflect steady state
  for (const seed of seeds) {
    const t0 = performance.now()
    const w = generateWorld(seed)
    const ms = performance.now() - t0
    rows.push(worldStats(w, ms))
  }
  return rows
}

// Run directly: `node src/sim/stats.ts [seed ...]`.
if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) {
  const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
  const seeds = argv.slice(2).map(Number).filter((s) => Number.isFinite(s))
  console.log(formatStats(runStats(seeds.length > 0 ? seeds : STATS_SEEDS)))
}
