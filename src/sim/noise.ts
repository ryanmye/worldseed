// Seeded 3D simplex noise (after Gustavson's public-domain reference) and fBm
// helpers. Sampled at unit-sphere xyz, so there are no lat/long seams.

import type { Rng } from './rng.ts'

export type Noise3 = (x: number, y: number, z: number) => number

// The 12 cube-edge gradients.
const GRAD3 = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
])

const F3 = 1 / 3
const G3 = 1 / 6

/** Simplex noise in roughly [-1, 1], with a permutation table drawn from rng. */
export function createSimplex3(rng: Rng): Noise3 {
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    const t = p[i]
    p[i] = p[j]
    p[j] = t
  }
  const perm = new Uint8Array(512)
  const permMod12 = new Uint8Array(512)
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255]
    permMod12[i] = perm[i] % 12
  }

  return (xin, yin, zin) => {
    const s = (xin + yin + zin) * F3
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const k = Math.floor(zin + s)
    const t = (i + j + k) * G3
    const x0 = xin - (i - t)
    const y0 = yin - (j - t)
    const z0 = zin - (k - t)

    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1 }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1 }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1 }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1 }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
    }

    const x1 = x0 - i1 + G3
    const y1 = y0 - j1 + G3
    const z1 = z0 - k1 + G3
    const x2 = x0 - i2 + 2 * G3
    const y2 = y0 - j2 + 2 * G3
    const z2 = z0 - k2 + 2 * G3
    const x3 = x0 - 1 + 3 * G3
    const y3 = y0 - 1 + 3 * G3
    const z3 = z0 - 1 + 3 * G3

    const ii = i & 255
    const jj = j & 255
    const kk = k & 255

    let n = 0
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0
    if (t0 > 0) {
      const g = permMod12[ii + perm[jj + perm[kk]]] * 3
      t0 *= t0
      n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0)
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1
    if (t1 > 0) {
      const g = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3
      t1 *= t1
      n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1)
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2
    if (t2 > 0) {
      const g = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3
      t2 *= t2
      n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2)
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3
    if (t3 > 0) {
      const g = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3
      t3 *= t3
      n += t3 * t3 * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3)
    }
    return 32 * n
  }
}

export interface FbmParams {
  octaves: number
  /** Base frequency in cycles per unit of sphere radius. */
  frequency: number
  lacunarity?: number
  gain?: number
}

// Fixed per-octave offsets so octaves don't share the lattice origin.
const OCTAVE_OFFSETS = [
  0, 0, 0, 17.13, -5.71, 3.37, -11.9, 23.41, 7.77, 31.3, 9.1, -19.6,
  -27.2, -13.8, 41.5, 5.55, 37.7, -33.1, -45.3, 29.9, 11.2, 53.1, -2.4, -49.8,
]

/** Fractional Brownian motion, normalized to roughly [-1, 1]. */
export function fbm(noise: Noise3, x: number, y: number, z: number, params: FbmParams): number {
  const lac = params.lacunarity ?? 2
  const gain = params.gain ?? 0.5
  let f = params.frequency
  let amp = 1
  let sum = 0
  let norm = 0
  for (let o = 0; o < params.octaves; o++) {
    const off = (o % 8) * 3
    sum += amp * noise(x * f + OCTAVE_OFFSETS[off], y * f + OCTAVE_OFFSETS[off + 1], z * f + OCTAVE_OFFSETS[off + 2])
    norm += amp
    f *= lac
    amp *= gain
  }
  return sum / norm
}

/** Ridged multifractal-ish fBm in [0, 1]: sharp crests where noise crosses zero. */
export function ridged(noise: Noise3, x: number, y: number, z: number, params: FbmParams): number {
  const lac = params.lacunarity ?? 2
  const gain = params.gain ?? 0.5
  let f = params.frequency
  let amp = 1
  let sum = 0
  let norm = 0
  for (let o = 0; o < params.octaves; o++) {
    const off = (o % 8) * 3
    let r = 1 - Math.abs(noise(x * f + OCTAVE_OFFSETS[off], y * f + OCTAVE_OFFSETS[off + 1], z * f + OCTAVE_OFFSETS[off + 2]))
    r *= r
    sum += amp * r
    norm += amp
    f *= lac
    amp *= gain
  }
  return sum / norm
}
