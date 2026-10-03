import { describe, expect, it } from 'vitest'
import { BIOME_COUNT, Biome } from '../contract.ts'
import type { World } from '../contract.ts'
import { buildGrid } from './grid.ts'
import { generateWorld } from './index.ts'
import { createRng } from './rng.ts'
import { computeRivers } from './rivers.ts'
import { worldStats } from './stats.ts'

const SEEDS = [1, 2, 3, 42, 1337, 2024, 31337, 77, 99999, 123456]

/** FNV-1a over the raw bytes of every array in the world. */
function hashWorld(w: World): string {
  const arrays: ArrayBufferView[] = [
    w.grid.positions, w.grid.triangles, w.grid.neighborOffsets, w.grid.neighbors,
    w.plate, w.elevation, w.temperature, w.rainfall, w.biome, w.riverTo, w.flow, w.lake,
  ]
  let h = 0x811c9dc5
  for (const a of arrays) {
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i]
      h = Math.imul(h, 0x01000193)
    }
  }
  return (h >>> 0).toString(16) + ':' + w.plateCount
}

const worlds = new Map<number, World>()
function world(seed: number): World {
  let w = worlds.get(seed)
  if (!w) {
    w = generateWorld(seed)
    worlds.set(seed, w)
  }
  return w
}

describe('grid', () => {
  for (const n of [1, 2, 5, 48]) {
    it(`n=${n}: counts, valence, symmetric adjacency, unit positions`, () => {
      const g = buildGrid(n)
      expect(g.cellCount).toBe(10 * n * n + 2)
      expect(g.triangles.length).toBe(3 * 20 * n * n)
      expect(g.positions.length).toBe(3 * g.cellCount)
      expect(g.neighborOffsets.length).toBe(g.cellCount + 1)
      expect(g.neighbors.length).toBe(g.neighborOffsets[g.cellCount])

      let fives = 0
      const edges = new Set<number>()
      for (let i = 0; i < g.cellCount; i++) {
        const deg = g.neighborOffsets[i + 1] - g.neighborOffsets[i]
        expect(deg === 5 || deg === 6).toBe(true)
        if (deg === 5) fives++
        const seen = new Set<number>()
        for (let k = g.neighborOffsets[i]; k < g.neighborOffsets[i + 1]; k++) {
          const j = g.neighbors[k]
          expect(j).not.toBe(i)
          expect(seen.has(j)).toBe(false)
          seen.add(j)
          edges.add(i * g.cellCount + j)
        }
        const r = Math.hypot(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2])
        expect(Math.abs(r - 1)).toBeLessThan(1e-6)
      }
      expect(fives).toBe(12)
      for (let i = 0; i < g.cellCount; i++) {
        for (let k = g.neighborOffsets[i]; k < g.neighborOffsets[i + 1]; k++) {
          const j = g.neighbors[k]
          expect(edges.has(j * g.cellCount + i)).toBe(true)
        }
      }
      // Every triangle edge is an adjacency edge; triangles wind CCW from outside.
      for (let t = 0; t < g.triangles.length; t += 3) {
        const a = g.triangles[t], b = g.triangles[t + 1], c = g.triangles[t + 2]
        expect(edges.has(a * g.cellCount + b)).toBe(true)
        expect(edges.has(b * g.cellCount + c)).toBe(true)
        expect(edges.has(c * g.cellCount + a)).toBe(true)
        const P = g.pos
        const abx = P[b * 3] - P[a * 3], aby = P[b * 3 + 1] - P[a * 3 + 1], abz = P[b * 3 + 2] - P[a * 3 + 2]
        const acx = P[c * 3] - P[a * 3], acy = P[c * 3 + 1] - P[a * 3 + 1], acz = P[c * 3 + 2] - P[a * 3 + 2]
        const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
        expect(nx * P[a * 3] + ny * P[a * 3 + 1] + nz * P[a * 3 + 2]).toBeGreaterThan(0)
      }
    })
  }

  it('has cells on both poles (+Y north)', () => {
    const g = buildGrid(48)
    let north = false, south = false
    for (let i = 0; i < g.cellCount; i++) {
      if (g.positions[i * 3 + 1] > 0.99999) north = true
      if (g.positions[i * 3 + 1] < -0.99999) south = true
    }
    expect(north && south).toBe(true)
  })

  it('neighbour rings are ordered counter-clockwise around each cell', () => {
    const g = buildGrid(8)
    const P = g.pos
    for (let i = 0; i < g.cellCount; i++) {
      const o = g.neighborOffsets[i], d = g.neighborOffsets[i + 1] - o
      for (let k = 0; k < d; k++) {
        const a = g.neighbors[o + k], b = g.neighbors[o + ((k + 1) % d)]
        // (i, a, b) should be a CCW triangle seen from outside.
        const abx = P[a * 3] - P[i * 3], aby = P[a * 3 + 1] - P[i * 3 + 1], abz = P[a * 3 + 2] - P[i * 3 + 2]
        const acx = P[b * 3] - P[i * 3], acy = P[b * 3 + 1] - P[i * 3 + 1], acz = P[b * 3 + 2] - P[i * 3 + 2]
        const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
        expect(nx * P[i * 3] + ny * P[i * 3 + 1] + nz * P[i * 3 + 2]).toBeGreaterThan(0)
      }
    }
  })
})

describe('rng', () => {
  it('streams are reproducible and independent by name', () => {
    const a = createRng(5, 'plates'), b = createRng(5, 'plates'), c = createRng(5, 'climate')
    const xa = [a.next(), a.next(), a.next()]
    expect([b.next(), b.next(), b.next()]).toEqual(xa)
    expect([c.next(), c.next(), c.next()]).not.toEqual(xa)
  })

  it('first draws are not correlated across nearby seeds', () => {
    const firsts = SEEDS.map((s) => createRng(s, 'world').next())
    const sorted = [...firsts].sort((x, y) => x - y)
    // No two of 10 first draws within 1e-3 of each other (would be suspicious).
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(1e-3)
  })
})

describe('generateWorld', () => {
  it('is deterministic: same seed gives bit-identical arrays', () => {
    const h1 = hashWorld(generateWorld(4242))
    const h2 = hashWorld(generateWorld(4242))
    expect(h2).toBe(h1)
  })

  it('different seeds give different worlds', () => {
    const hashes = new Set(SEEDS.slice(0, 5).map((s) => hashWorld(world(s))))
    expect(hashes.size).toBe(5)
  })

  it('respects the subdivisions option', () => {
    const w = generateWorld(9, { subdivisions: 16 })
    expect(w.grid.cellCount).toBe(10 * 16 * 16 + 2)
    expect(w.elevation.length).toBe(w.grid.cellCount)
    expect(hashWorld(generateWorld(9, { subdivisions: 16 }))).toBe(hashWorld(w))
  })

  it('arrays have contract lengths and value ranges', () => {
    for (const seed of SEEDS) {
      const w = world(seed)
      const N = w.grid.cellCount
      expect(w.seed).toBe(seed)
      expect(w.plateCount).toBeGreaterThanOrEqual(12)
      expect(w.plateCount).toBeLessThanOrEqual(20)
      for (const a of [w.plate, w.elevation, w.temperature, w.rainfall, w.biome, w.riverTo, w.flow, w.lake]) expect(a.length).toBe(N)
      const platesUsed = new Set<number>()
      for (let i = 0; i < N; i++) {
        expect(w.plate[i]).toBeLessThan(w.plateCount)
        platesUsed.add(w.plate[i])
        const e = w.elevation[i], t = w.temperature[i], r = w.rainfall[i], f = w.flow[i]
        if (!(e >= -1 && e <= 1)) throw new Error(`seed ${seed} cell ${i} elevation ${e}`)
        if (!(t >= 0 && t <= 1)) throw new Error(`seed ${seed} cell ${i} temperature ${t}`)
        if (!(r >= 0 && r <= 1)) throw new Error(`seed ${seed} cell ${i} rainfall ${r}`)
        if (!(f >= 0 && Number.isFinite(f))) throw new Error(`seed ${seed} cell ${i} flow ${f}`)
        expect(w.biome[i]).toBeLessThan(BIOME_COUNT)
      }
      expect(platesUsed.size).toBe(w.plateCount)
    }
  })

  it('ocean fraction is within 55-75% for every seed', () => {
    for (const seed of SEEDS) {
      const w = world(seed)
      let ocean = 0
      for (let i = 0; i < w.grid.cellCount; i++) if (w.elevation[i] < 0) ocean++
      const frac = ocean / w.grid.cellCount
      expect(frac).toBeGreaterThanOrEqual(0.55)
      expect(frac).toBeLessThanOrEqual(0.75)
    }
  })

  it('every land riverTo chain reaches the ocean without cycles', () => {
    for (const seed of SEEDS) {
      const w = world(seed)
      const N = w.grid.cellCount
      const { neighborOffsets: off, neighbors: nb } = w.grid
      // 0 = unknown, 1 = on current path, 2 = known to reach the ocean
      const state = new Uint8Array(N)
      for (let i = 0; i < N; i++) {
        if (w.elevation[i] < 0) {
          expect(w.riverTo[i]).toBe(-1)
          state[i] = 2
        }
      }
      for (let i = 0; i < N; i++) {
        if (state[i] === 2) continue
        const path: number[] = []
        let c = i
        while (state[c] === 0) {
          state[c] = 1
          path.push(c)
          const d = w.riverTo[c]
          if (d < 0) throw new Error(`seed ${seed}: land cell ${c} is a sink`)
          let adjacent = false
          for (let k = off[c]; k < off[c + 1]; k++) if (nb[k] === d) adjacent = true
          if (!adjacent) throw new Error(`seed ${seed}: riverTo of ${c} is not a neighbour`)
          c = d
        }
        if (state[c] === 1) throw new Error(`seed ${seed}: cycle through cell ${c}`)
        for (const p of path) state[p] = 2
      }
    }
  })

  it('flow accumulates downstream', () => {
    const w = world(1)
    for (let i = 0; i < w.grid.cellCount; i++) {
      const d = w.riverTo[i]
      if (d >= 0 && w.elevation[d] >= 0) expect(w.flow[d]).toBeGreaterThanOrEqual(w.flow[i])
    }
  })

  it('biomes are consistent with land/water', () => {
    for (const seed of SEEDS) {
      const w = world(seed)
      for (let i = 0; i < w.grid.cellCount; i++) {
        const b = w.biome[i]
        if (w.elevation[i] < 0) expect(b === Biome.Ocean || b === Biome.Coast || b === Biome.Ice).toBe(true)
        else expect(b === Biome.Ocean || b === Biome.Coast).toBe(false)
      }
    }
  })

  it('biome mix is plausible across seeds', () => {
    const total = new Array<number>(BIOME_COUNT).fill(0)
    for (const seed of SEEDS) {
      const w = world(seed)
      const counts = new Array<number>(BIOME_COUNT).fill(0)
      let land = 0
      for (let i = 0; i < w.grid.cellCount; i++) {
        counts[w.biome[i]]++
        total[w.biome[i]]++
        if (w.elevation[i] >= 0) land++
      }
      // No seed is mostly desert, and every seed has both arid and humid land.
      expect(counts[Biome.Desert] / land).toBeLessThan(0.5)
      expect(counts[Biome.Desert]).toBeGreaterThan(0)
      expect(counts[Biome.Rainforest] + counts[Biome.TemperateForest] + counts[Biome.Taiga]).toBeGreaterThan(0.1 * land)
    }
    for (let b = 0; b < BIOME_COUNT; b++) expect(total[b]).toBeGreaterThan(0)
  })

  it('every typed array owns a distinct, whole buffer (transferable)', () => {
    const w = world(42)
    const arrays: ArrayBufferView[] = [
      w.grid.positions, w.grid.triangles, w.grid.neighborOffsets, w.grid.neighbors,
      w.plate, w.elevation, w.temperature, w.rainfall, w.biome, w.riverTo, w.flow, w.lake,
    ]
    const buffers = new Set<ArrayBufferLike>()
    for (const a of arrays) {
      expect(a.byteOffset).toBe(0)
      expect(a.buffer.byteLength).toBe(a.byteLength)
      buffers.add(a.buffer)
    }
    expect(buffers.size).toBe(arrays.length)
  })

  it('lakes are 0/1, only on land, and cover a plausible share of land', () => {
    let total = 0, totalLand = 0
    for (const seed of SEEDS) {
      const w = world(seed)
      let lakes = 0, land = 0
      for (let i = 0; i < w.grid.cellCount; i++) {
        const l = w.lake[i]
        expect(l === 0 || l === 1).toBe(true)
        if (w.elevation[i] >= 0) land++
        if (l) {
          lakes++
          if (w.elevation[i] < 0) throw new Error(`seed ${seed}: lake on sea cell ${i}`)
          const b = w.biome[i]
          expect(b === Biome.Ocean || b === Biome.Coast).toBe(false)
        }
      }
      expect(lakes / land).toBeLessThan(0.05)
      total += lakes
      totalLand += land
    }
    expect(total / totalLand).toBeGreaterThan(0.003)
  })

  it('lake cells are flooded depressions that still drain to a neighbour', () => {
    const g = buildGrid(48)
    for (const seed of [1, 1337, 12345]) {
      const w = world(seed)
      const { filled } = computeRivers(g, w.elevation, w.rainfall)
      const { neighborOffsets: off, neighbors: nb } = w.grid
      let lakeCells = 0
      for (let i = 0; i < w.grid.cellCount; i++) {
        if (!w.lake[i]) continue
        lakeCells++
        expect(filled[i] - w.elevation[i]).toBeGreaterThan(0)
        const d = w.riverTo[i]
        let adjacent = false
        for (let k = off[i]; k < off[i + 1]; k++) if (nb[k] === d) adjacent = true
        expect(adjacent).toBe(true)
      }
      expect(lakeCells).toBeGreaterThan(0)
    }
  })

  it('no seed has large shallow seas cut off from deep water (the "pale blob" artefact)', () => {
    for (const seed of SEEDS) {
      const s = worldStats(world(seed), 0)
      // % of water cells shallower than the Coast cut and > 4 hops from deep water.
      if (!(s.interiorShallowPct < 1.5)) throw new Error(`seed ${seed}: interior shallow sea ${s.interiorShallowPct.toFixed(2)}% of water`)
      // Largest connected patch of such water, % of the planet.
      if (!(s.interiorShallowMaxPatchPct < 0.5)) throw new Error(`seed ${seed}: shallow patch ${s.interiorShallowMaxPatchPct.toFixed(2)}% of planet`)
    }
  })

  it('continents vary: several seeds have many landmasses, few are one supercontinent, poles mostly open', () => {
    let many = 0, single = 0, polarContinents = 0
    for (const seed of SEEDS) {
      const s = worldStats(world(seed), 0)
      if (s.landmasses >= 4) many++
      if (s.largestLandPct > 85) single++
      if (!(s.polarLandPct < 20)) throw new Error(`seed ${seed}: ${s.polarLandPct.toFixed(1)}% of land poleward of 65 deg`)
      // An Antarctica-like continent covers about half of its polar cap.
      if (s.polarCapPct >= 45) polarContinents++
    }
    expect(many).toBeGreaterThanOrEqual(3)
    expect(single).toBeLessThanOrEqual(3)
    // Some worlds have a polar continent, most do not.
    expect(polarContinents).toBeGreaterThanOrEqual(1)
    expect(polarContinents).toBeLessThanOrEqual(4)
  })

  it('biome balance is Earth-like on average and desert never dominates', () => {
    const rows = SEEDS.map((seed) => worldStats(world(seed), 0))
    const mean = (b: number) => rows.reduce((s, r) => s + r.landBiomePct[b], 0) / rows.length
    for (const r of rows) expect(r.landBiomePct[Biome.Desert]).toBeLessThan(32)
    expect(mean(Biome.Desert)).toBeGreaterThan(10)
    expect(mean(Biome.Desert)).toBeLessThan(22)
    expect(mean(Biome.Savanna)).toBeGreaterThan(10)
    expect(mean(Biome.Grassland)).toBeGreaterThan(8)
    expect(mean(Biome.TemperateForest)).toBeGreaterThan(8)
  })

  it('erosion carves valleys: high-flow highland cells sit below their neighbours', () => {
    let sum = 0, n = 0
    for (const seed of [1, 42, 1337]) {
      const w = world(seed)
      const { neighborOffsets: off, neighbors: nb } = w.grid
      for (let i = 0; i < w.grid.cellCount; i++) {
        if (w.elevation[i] < 0.2 || w.flow[i] < 3) continue
        let s = 0
        for (let k = off[i]; k < off[i + 1]; k++) s += w.elevation[nb[k]]
        sum += w.elevation[i] - s / (off[i + 1] - off[i])
        n++
      }
    }
    expect(n).toBeGreaterThan(50)
    expect(sum / n).toBeLessThan(-0.02)
  })
})

