// Climate: temperature from latitude and an elevation lapse rate; rainfall
// from moisture advected over the cell graph by banded prevailing winds
// (trades / westerlies / polar easterlies), picked up over warm ocean, rained
// out by rising air (ITCZ, polar front, windward slopes) and depleted behind
// mountains (rain shadow). Over hot land the wind also turns inland (a crude
// monsoon) and part of the moisture spreads isotropically, so continental
// interiors are not uniformly bone dry.

import type { SimGrid } from './grid.ts'
import { createSimplex3, fbm } from './noise.ts'
import type { Rng } from './rng.ts'
import { clamp, smoothstep } from './util.ts'

export interface ClimateResult {
  temperature: Float32Array
  rainfall: Float32Array
  /** Prevailing wind (unit tangent xyz per cell), useful for debugging. */
  wind: Float64Array
  /** Un-normalized steady-state precipitation, for debugging/tuning. */
  rawRain: Float64Array
}

/** Piecewise-linear lookup over sorted knots xs -> ys. */
function piecewise(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0]
  for (let k = 1; k < xs.length; k++) {
    if (x <= xs[k]) {
      const t = (x - xs[k - 1]) / (xs[k] - xs[k - 1])
      return ys[k - 1] + t * (ys[k] - ys[k - 1])
    }
  }
  return ys[ys.length - 1]
}

// Large-scale vertical motion by |sin(latitude)|: rising air (wet) at the
// equator (ITCZ) and polar front (~60 deg), sinking dry air at the subtropical
// highs (~30 deg) and the poles.
const LIFT_X = [0, 0.17, 0.34, 0.5, 0.64, 0.8, 0.9, 1]
const LIFT_Y = [1.7, 1.25, 0.7, 0.4, 0.85, 1.15, 0.8, 0.45]

/** Strength of the inland (monsoon) wind component over hot land, relative to the prevailing wind. */
const MONSOON = 0.7

/** Share of advected moisture spread evenly to all neighbours instead of downwind. */
const SPREAD = 0.3

/** Raw precipitation that maps to rainfall 1 (before sqrt). */
const RAIN_REF = 0.12

export function generateClimate(g: SimGrid, elevation: Float32Array, rng: Rng): ClimateResult {
  const N = g.cellCount
  const { pos, neighborOffsets: off, neighbors: nb } = g
  const cs = g.cellScale
  const nTemp = createSimplex3(rng)
  const nWindX = createSimplex3(rng)
  const nWindY = createSimplex3(rng)
  const nRain = createSimplex3(rng)

  // --- Temperature ----------------------------------------------------------
  const temp = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
    let t = 1 - y * y // sin^2(lat): 1 at equator, 0.75 at 30, 0.25 at 60
    t = 0.04 + 0.96 * t
    t += 0.05 * fbm(nTemp, x, y, z, { octaves: 3, frequency: 2 })
    const e = elevation[i]
    if (e > 0) t -= 0.45 * e // lapse rate: high peaks are near-polar
    else t += 0.03 * (1 - t) // oceans slightly milder
    temp[i] = clamp(t, 0, 1)
  }

  // --- Prevailing winds -----------------------------------------------------
  // Monsoon: warm land draws sea air inland, so the wind over land gains a
  // component up the gradient of distance from the sea (stronger where hot).
  const coastHops = hopsFromSea(g, elevation)
  const wind = new Float64Array(N * 3)
  for (let i = 0; i < N; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
    // Local frame: east = normalize(Y x p), north = p x east.
    let ex = z, ez = -x
    const el = Math.sqrt(ex * ex + ez * ez)
    if (el < 1e-9) { ex = 1; ez = 0 } else { ex /= el; ez /= el }
    const nx = y * ez, ny = z * ex - x * ez, nz = -y * ex
    const a = Math.abs(y)
    // Zonal: -1 easterly trades, +1 westerlies, -1 polar easterlies.
    const u = -1 + 2 * smoothstep(0.4, 0.6, a) - 2 * smoothstep(0.8, 0.93, a)
    // Meridional, poleward-positive: trades and polar easterlies flow equatorward.
    const m = -0.45 + 0.9 * smoothstep(0.4, 0.6, a) - 0.9 * smoothstep(0.8, 0.93, a)
    const v = y >= 0 ? m : -m
    const px = 0.45 * fbm(nWindX, x, y, z, { octaves: 2, frequency: 1.8 })
    const py = 0.45 * fbm(nWindY, x, y, z, { octaves: 2, frequency: 1.8 })
    let wx = (u + px) * ex + (v + py) * nx
    let wy = (v + py) * ny
    let wz = (u + px) * ez + (v + py) * nz
    if (elevation[i] >= 0) {
      const mon = MONSOON * smoothstep(0.45, 0.85, temp[i])
      if (mon > 0) {
        let gx = 0, gy = 0, gz = 0
        const hi = coastHops[i]
        for (let k = off[i]; k < off[i + 1]; k++) {
          const j = nb[k]
          const dh = coastHops[j] - hi
          if (dh === 0) continue
          let dx = pos[j * 3] - x, dy = pos[j * 3 + 1] - y, dz = pos[j * 3 + 2] - z
          const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz)
          dx *= inv; dy *= inv; dz *= inv
          gx += dh * dx; gy += dh * dy; gz += dh * dz
        }
        const gl = Math.sqrt(gx * gx + gy * gy + gz * gz)
        if (gl > 1e-9) {
          const f = mon / gl
          wx += f * gx; wy += f * gy; wz += f * gz
        }
      }
    }
    const wl = Math.sqrt(wx * wx + wy * wy + wz * wz)
    if (wl > 1e-9) { wx /= wl; wy /= wl; wz /= wl } else { wx = ex; wy = 0; wz = ez }
    wind[i * 3] = wx
    wind[i * 3 + 1] = wy
    wind[i * 3 + 2] = wz
  }

  // Downwind distribution weights per directed edge (CSR order of the source).
  const E = off[N]
  const w = new Float64Array(E)
  for (let i = 0; i < N; i++) {
    let sum = 0
    for (let k = off[i]; k < off[i + 1]; k++) {
      const j = nb[k]
      let dx = pos[j * 3] - pos[i * 3], dy = pos[j * 3 + 1] - pos[i * 3 + 1], dz = pos[j * 3 + 2] - pos[i * 3 + 2]
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz)
      dx *= inv; dy *= inv; dz *= inv
      const al = dx * wind[i * 3] + dy * wind[i * 3 + 1] + dz * wind[i * 3 + 2]
      const a = al > 0 ? al * al : 0
      w[k] = a
      sum += a
    }
    const deg = off[i + 1] - off[i]
    // Mostly downwind, plus some isotropic spread (eddies, seasonal wind
    // shifts) so moisture also reaches interiors that lie upwind of a coast.
    for (let k = off[i]; k < off[i + 1]; k++) w[k] = (sum > 0 ? (1 - SPREAD) * (w[k] / sum) : 0) + (sum > 0 ? SPREAD : 1) / deg
  }

  // Upwind land height per cell, for orographic lift.
  const land = new Float64Array(N)
  for (let i = 0; i < N; i++) land[i] = elevation[i] > 0 ? elevation[i] : 0
  const upH = new Float64Array(N)
  const upW = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    for (let k = off[i]; k < off[i + 1]; k++) {
      upH[nb[k]] += w[k] * land[i]
      upW[nb[k]] += w[k]
    }
  }
  const baseRate = new Float64Array(N)
  const cap = new Float64Array(N)
  const isOcean = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    const up = upW[i] > 0 ? upH[i] / upW[i] : land[i]
    const rise = land[i] - up
    const lift = piecewise(LIFT_X, LIFT_Y, Math.abs(pos[i * 3 + 1]))
    let r = 0.055 * lift * cs // per-cell rate, scaled so decay length in radians is resolution independent
    if (rise > 0.02) r += 0.8 * (rise - 0.02) // windward slope (gentle continental ramps barely count)
    baseRate[i] = r > 0.5 ? 0.5 : r
    cap[i] = 0.25 + temp[i]
    isOcean[i] = elevation[i] < 0 && temp[i] > 0.1 ? 1 : 0 // frozen sea barely evaporates
  }

  // --- Moisture advection (Jacobi iteration to steady state) ---------------
  const moist = new Float64Array(N)
  const inflow = new Float64Array(N)
  const rain = new Float64Array(N)
  const iters = Math.max(80, Math.round(3.2 * Math.sqrt(N / 10)))
  const recycle = 0.6
  const evap = Math.min(1, 0.35 * cs)
  const keep = 1 - 0.015 * cs
  for (let it = 0; it < iters; it++) {
    inflow.fill(0)
    for (let i = 0; i < N; i++) {
      const mi = moist[i]
      if (mi === 0) continue
      for (let k = off[i]; k < off[i + 1]; k++) inflow[nb[k]] += w[k] * mi
    }
    for (let i = 0; i < N; i++) {
      let m = inflow[i]
      if (isOcean[i] && m < cap[i]) m += evap * (cap[i] - m)
      const excess = m > cap[i] ? m - cap[i] : 0
      const p = (m - excess) * baseRate[i] + 0.6 * excess
      rain[i] = p
      // Land re-evaporates part of what falls (vegetation, soil), extending inland reach.
      const back = isOcean[i] || elevation[i] < 0 ? 0 : recycle * p * temp[i]
      moist[i] = (m - p + back) * keep
    }
  }

  // --- Normalize ------------------------------------------------------------
  // Absolute (not per-world) scale, so worlds can genuinely differ in
  // wetness; sqrt compresses the long wet tail (windward coasts, ITCZ).
  const temperature = new Float32Array(N)
  const rainfall = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
    const jitter = 1 + 0.15 * fbm(nRain, x, y, z, { octaves: 3, frequency: 3 })
    temperature[i] = temp[i]
    rainfall[i] = clamp(Math.sqrt(rain[i] / RAIN_REF) * jitter, 0, 1)
  }
  return { temperature, rainfall, wind, rawRain: rain }
}

/** Hop distance from the nearest sea cell (0 on the sea); a world with no sea gets 0 everywhere. */
function hopsFromSea(g: SimGrid, elevation: Float32Array): Int32Array {
  const N = g.cellCount
  const { neighborOffsets: off, neighbors: nb } = g
  const dist = new Int32Array(N).fill(-1)
  const queue = new Int32Array(N)
  let head = 0, tail = 0
  for (let i = 0; i < N; i++) if (elevation[i] < 0) { dist[i] = 0; queue[tail++] = i }
  while (head < tail) {
    const c = queue[head++]
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (dist[j] < 0) { dist[j] = dist[c] + 1; queue[tail++] = j }
    }
  }
  for (let i = 0; i < N; i++) if (dist[i] < 0) dist[i] = 0
  return dist
}
