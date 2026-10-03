// Tectonic plates: seeded, noise-weighted multi-source flood fill over the cell
// graph (a "noisy Voronoi"), each plate drifting as a rigid rotation about a
// random axis, flagged oceanic or continental.

import type { SimGrid } from './grid.ts'
import { cellDistance } from './grid.ts'
import { fbm, createSimplex3 } from './noise.ts'
import type { Rng } from './rng.ts'
import { MinHeap } from './util.ts'

export interface Plates {
  count: number
  /** Plate id per cell. */
  plate: Uint16Array
  /** Rotation axis (unit) per plate, xyz. */
  axis: Float64Array
  /** Angular speed per plate (arbitrary units, ~0.3..1). */
  speed: Float64Array
  /** 1 = continental, 0 = oceanic. */
  continental: Uint8Array
  /** Relative density in [0, 1); decides which plate subducts in ocean-ocean collisions. */
  density: Float64Array
  /** Cell count per plate. */
  size: Uint32Array
  /**
   * Per-world tendency in [0, 1) for continents to drift apart: 0 keeps
   * neighbouring continental plates welded into supercontinents, near 1 opens
   * seas between them unless they are strongly converging.
   */
  dispersal: number
}

export interface PlateOptions {
  /** Target fraction of the surface covered by continental plates. */
  continentalFraction: number
}

export function generatePlates(g: SimGrid, rng: Rng, opts: PlateOptions): Plates {
  const N = g.cellCount
  const { pos, neighborOffsets: off, neighbors: nb } = g
  const count = Math.min(rng.int(12, 20), N) // n = 1 has only 12 cells

  // Seed cells, spread out by rejection with a shrinking minimum separation.
  const seeds: number[] = []
  let minSep = 0.9
  let tries = 0
  while (seeds.length < count) {
    const c = Math.floor(rng.next() * N)
    let ok = true
    for (let s = 0; s < seeds.length; s++) {
      if (cellDistance(pos, c, seeds[s]) < minSep) { ok = false; break }
    }
    if (ok) seeds.push(c)
    if (++tries % 200 === 0) minSep *= 0.85
  }

  // Per-plate growth rate makes plate sizes uneven (a few big, several small).
  const growth = new Float64Array(count)
  for (let p = 0; p < count; p++) {
    const r = rng.next()
    growth[p] = 0.6 + 0.9 * r * r
  }

  // Edge costs are measured between domain-warped positions: the flood fill
  // then approximates a Voronoi diagram in warped space, whose boundaries pull
  // back to ragged, non-convex curves (a plain cost field averages out along
  // paths and leaves boundaries nearly straight). A mild cost field on top
  // varies how easily plates grow through different regions.
  const noise = createSimplex3(rng)
  const warped = new Float64Array(N * 3)
  const costField = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
    const wx = x + 0.3 * fbm(noise, x, y, z, { octaves: 4, frequency: 2.5 })
    const wy = y + 0.3 * fbm(noise, x + 31.7, y - 11.3, z + 5.1, { octaves: 4, frequency: 2.5 })
    const wz = z + 0.3 * fbm(noise, x - 23.9, y + 17.5, z - 41.3, { octaves: 4, frequency: 2.5 })
    warped[i * 3] = wx
    warped[i * 3 + 1] = wy
    warped[i * 3 + 2] = wz
    costField[i] = 1 + 0.5 * fbm(noise, x + 7.7, y + 3.3, z - 9.9, { octaves: 3, frequency: 3 })
  }

  const plate = new Uint16Array(N).fill(0xffff)
  const best = new Float64Array(N).fill(Infinity)
  const owner = new Int32Array(N).fill(-1)
  const heap = new MinHeap(N * 2)
  for (let p = 0; p < count; p++) {
    best[seeds[p]] = 0
    owner[seeds[p]] = p
    heap.push(0, seeds[p])
  }
  while (heap.size > 0) {
    const key = heap.topKey()
    const c = heap.pop()
    if (plate[c] !== 0xffff || key > best[c]) continue
    const p = owner[c]
    plate[c] = p
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (plate[j] !== 0xffff) continue
      const d = key + (cellDistance(warped, c, j) * 0.5 * (costField[c] + costField[j])) / growth[p]
      if (d < best[j] || (d === best[j] && p < owner[j])) {
        best[j] = d
        owner[j] = p
        heap.push(d, j)
      }
    }
  }

  const size = new Uint32Array(count)
  for (let i = 0; i < N; i++) size[plate[i]]++

  const axis = new Float64Array(count * 3)
  const speed = new Float64Array(count)
  const density = new Float64Array(count)
  const v = [0, 0, 0]
  for (let p = 0; p < count; p++) {
    rng.unitVector(v)
    axis[p * 3] = v[0]
    axis[p * 3 + 1] = v[1]
    axis[p * 3 + 2] = v[2]
    speed[p] = rng.range(0.3, 1)
    density[p] = rng.next()
  }

  // Continental flags. Each world draws a dispersal tendency: clustered
  // worlds let continental plates touch (one or two big landmasses), dispersed
  // worlds prefer plates that do not border an already-continental plate
  // (several mid-sized continents). Plates centred near a pole are often
  // passed over, and very large plates are avoided so no single plate makes a
  // supercontinent on its own. Plates passed over get a second chance if the
  // target area is not reached.
  const shared = new Float64Array(count * count) // boundary edge counts between plates
  const perimeter = new Float64Array(count)
  const cy = new Float64Array(count)
  for (let i = 0; i < N; i++) {
    const pi = plate[i]
    cy[pi] += pos[i * 3 + 1]
    for (let k = off[i]; k < off[i + 1]; k++) {
      const pj = plate[nb[k]]
      if (pj !== pi) { shared[pi * count + pj]++; perimeter[pi]++ }
    }
  }
  for (let p = 0; p < count; p++) cy[p] = cy[p] / size[p]
  const continental = new Uint8Array(count)
  const order: number[] = []
  for (let p = 0; p < count; p++) order.push(p)
  rng.shuffle(order)
  const disperse = rng.next()
  const target = opts.continentalFraction * N
  let area = 0
  const deferred: number[] = []
  for (let t = 0; t < count; t++) {
    const p = order[t]
    if (area >= target) break
    // Skip a plate that would overshoot badly, unless we have nothing yet.
    if (area > 0 && area + size[p] > target * 1.35) continue
    let touching = 0
    for (let q = 0; q < count; q++) if (continental[q]) touching += shared[p * count + q]
    const adj = perimeter[p] > 0 ? touching / perimeter[p] : 0
    const polar = cy[p] < 0 ? -cy[p] : cy[p]
    let reject = 0
    if (polar > 0.8) reject += 0.25 + 1.5 * (polar - 0.8)
    if (size[p] > 0.6 * target) reject += 0.5
    reject += disperse * 2.5 * adj
    if (rng.next() < reject) { deferred.push(p); continue }
    continental[p] = 1
    area += size[p]
  }
  for (let t = 0; t < deferred.length && area < target * 0.9; t++) {
    const p = deferred[t]
    if (area > 0 && area + size[p] > target * 1.35) continue
    continental[p] = 1
    area += size[p]
  }
  for (let p = 0; p < count; p++) if (continental[p]) density[p] *= 0.5 // continental crust is buoyant

  return { count, plate, axis, speed, continental, density, size, dispersal: disperse }
}

/** Surface velocity of plate p at cell i (tangent vector), written into out. */
export function plateVelocity(pl: Plates, g: SimGrid, p: number, i: number, out: Float64Array | number[]): void {
  const ax = pl.axis[p * 3], ay = pl.axis[p * 3 + 1], az = pl.axis[p * 3 + 2]
  const x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2]
  const s = pl.speed[p]
  out[0] = s * (ay * z - az * y)
  out[1] = s * (az * x - ax * z)
  out[2] = s * (ax * y - ay * x)
}
