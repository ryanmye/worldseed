// Elevation: a land/sea mask from continental crust (plate flags + large-scale
// noise + domain-warped coastal detail, thresholded by quantile), a base
// height profile built from the signed distance to that coast (lowlands
// rising into interiors on land; a narrow shelf, a continental slope and the
// abyssal plain at sea), tectonic boundary features from relative plate
// motion, stream-power erosion, and finally a hypsometric remap to [-1, 1]
// with sea level at 0.

import type { SimGrid } from './grid.ts'
import { cellDistance } from './grid.ts'
import { erode } from './erosion.ts'
import { createSimplex3, fbm, ridged } from './noise.ts'
import type { Plates } from './plates.ts'
import { plateVelocity } from './plates.ts'
import type { Rng } from './rng.ts'
import { MinHeap, blur, bump, clamp, scaledPasses, smoothstep } from './util.ts'

export interface ElevationOptions {
  /** Fraction of cells that end up below sea level. */
  oceanFraction: number
}

export interface ElevationResult {
  elevation: Float32Array
  /** Signed boundary stress per cell after propagation (+ convergent), for debugging/stats. */
  tectonic: Float64Array
  /** Land/sea mask the coastline was built from (1 = land), before tectonics and erosion. */
  landMask: Uint8Array
  /** 1 where enclosed water was turned into a lake basin. */
  basin: Uint8Array
}

// Feature widths are in radians of arc so worlds look alike at any subdivision.
const W = {
  ccCore: 0.09, ccPlateau: 0.24,
  andesOffset: 0.035, andesCore: 0.08, andesFoot: 0.18,
  trench: 0.045,
  arcOffset: 0.075, arc: 0.05,
  ridge: 0.13,
  rift: 0.06, riftShoulderOffset: 0.08, riftShoulder: 0.05,
  transform: 0.05,
}

/** Raw-height profile (sea level 0). Shelf and slope widths are radians of arc. */
const PROFILE = {
  shelfDepth: 0.075, // raw depth at the shelf break
  shelfMin: 0.012, shelfMax: 0.05, // shelf width range
  slope: 0.09, // continental slope width
  abyss: 0.5, // abyssal plain depth
  coastLow: 0.012, // land height right at the coast
  interior: 0.11, // extra height reached deep inland
  interiorScale: 0.12, // distance over which the interior rise half-completes
  landFloor: 0.006, // land-mask cells are kept at least about this high
}

/** Smooth, monotone floor: identity above 2f, tends to 0+ far below, C1 at f. */
function softFloor(h: number, f: number): number {
  if (h >= f) return h
  return (f * f) / (2 * f - h)
}

export function generateElevation(g: SimGrid, pl: Plates, rng: Rng, opts: ElevationOptions): ElevationResult {
  const N = g.cellCount
  const { pos, neighborOffsets: off, neighbors: nb } = g
  const plate = pl.plate

  // --- 0. Crust and the land/sea mask -----------------------------------------
  const nBase = createSimplex3(rng)
  const nDetail = createSimplex3(rng)
  const nRidge = createSimplex3(rng)
  const nCoast = createSimplex3(rng)
  const nWarp = createSimplex3(rng)
  const nShelf = createSimplex3(rng)
  const nLakes = createSimplex3(rng)
  const cont = new Float64Array(N)
  for (let i = 0; i < N; i++) cont[i] = pl.continental[plate[i]]
  riftContinents(g, pl, rng, cont)
  blur(g, cont, scaledPasses(g, 16), 0.6)

  // Continental crust = blurred plate flag + large-scale noise, minus a soft
  // polar penalty (continents may reach the poles, but rarely sit on them).
  // The mask adds domain-warped multi-octave noise on top, so coasts get
  // bays, peninsulas and offshore islands at the scale of a few cells.
  const crustSmooth = new Float64Array(N)
  const coastNoise = new Float64Array(N)
  const large = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
    large[i] = fbm(nBase, x, y, z, { octaves: 4, frequency: 1.4 })
    const ay = y < 0 ? -y : y
    crustSmooth[i] = cont[i] + 0.55 * large[i] - 0.8 * smoothstep(0.87, 0.995, ay)
    const wx = x + 0.2 * fbm(nWarp, x, y, z, { octaves: 3, frequency: 2.2 })
    const wy = y + 0.2 * fbm(nWarp, x + 19.1, y - 7.3, z + 3.7, { octaves: 3, frequency: 2.2 })
    const wz = z + 0.2 * fbm(nWarp, x - 5.9, y + 13.3, z - 29.1, { octaves: 3, frequency: 2.2 })
    coastNoise[i] = fbm(nCoast, wx, wy, wz, { octaves: 5, frequency: 4, gain: 0.55 })
  }
  // The coastal noise displaces the coastline by a roughly constant distance
  // in radians: it is scaled by the local crust gradient, so gentle crust
  // slopes do not dissolve into broad speckled archipelagos while steep plate
  // margins still get bays and peninsulas. How ragged a coast is varies
  // regionally (smooth beaches here, fjords and island chains there).
  const grad = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    let gmax = 0
    for (let k = off[i]; k < off[i + 1]; k++) {
      const j = nb[k]
      const d = crustSmooth[j] - crustSmooth[i]
      const gr = (d < 0 ? -d : d) / cellDistance(pos, i, j)
      if (gr > gmax) gmax = gr
    }
    grad[i] = gmax
  }
  blur(g, grad, scaledPasses(g, 2), 0.5)
  const crust = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
    const rag = 0.5 + 0.5 * fbm(nShelf, x + 41.3, y - 17.9, z + 8.1, { octaves: 2, frequency: 1.6 })
    const disp = 0.12 + 0.5 * rag * rag // radians per unit of noise
    crust[i] = crustSmooth[i] + coastNoise[i] * grad[i] * disp
  }
  // Threshold by quantile, then close enclosed water: tiny holes become plain
  // land, mid-sized enclosed water becomes a lake basin (land, sunk below its
  // shore so the depression fill floods it) instead of a shallow inland sea.
  // A second pass corrects the threshold for the land this adds.
  const land = new Uint8Array(N)
  const basin = new Uint8Array(N)
  const area2 = g.cellScale * g.cellScale
  let q = opts.oceanFraction
  let cThr = 0
  for (let pass = 0; pass < 2; pass++) {
    cThr = quantile(crust, q)
    for (let i = 0; i < N; i++) land[i] = crust[i] >= cThr ? 1 : 0
    basin.fill(0)
    closeEnclosedWater(g, land, basin, Math.max(2, Math.round(10 / area2)), Math.round((0.004 * N)))
    let landCount = 0
    for (let i = 0; i < N; i++) landCount += land[i]
    q += landCount / N - (1 - opts.oceanFraction)
  }

  // Continental-ness in [0, 1] per cell; drives which kind of boundary
  // feature forms (so mountains follow actual continents, not just the plate flag).
  const cc = new Float64Array(N)
  for (let i = 0; i < N; i++) cc[i] = smoothstep(cThr - 0.15, cThr + 0.15, crustSmooth[i])

  // --- 1. Boundary stress per boundary cell -------------------------------
  const isBoundary = new Uint8Array(N)
  const press = new Float64Array(N) // + convergent, - divergent
  const shear = new Float64Array(N)
  const otherCont = new Float64Array(N) // mean continental-ness of foreign neighbours
  const subducts = new Float64Array(N) // fraction of foreign neighbours this plate dives under
  const vi = [0, 0, 0]
  const vj = [0, 0, 0]
  for (let i = 0; i < N; i++) {
    const pi = plate[i]
    let cnt = 0
    for (let k = off[i]; k < off[i + 1]; k++) {
      const j = nb[k]
      const pj = plate[j]
      if (pj === pi) continue
      cnt++
      let nx = pos[j * 3] - pos[i * 3]
      let ny = pos[j * 3 + 1] - pos[i * 3 + 1]
      let nz = pos[j * 3 + 2] - pos[i * 3 + 2]
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz)
      nx *= inv; ny *= inv; nz *= inv
      plateVelocity(pl, g, pi, i, vi)
      plateVelocity(pl, g, pj, i, vj)
      const rx = vi[0] - vj[0], ry = vi[1] - vj[1], rz = vi[2] - vj[2]
      const closing = rx * nx + ry * ny + rz * nz
      const tx = rx - closing * nx, ty = ry - closing * ny, tz = rz - closing * nz
      press[i] += closing
      shear[i] += Math.sqrt(tx * tx + ty * ty + tz * tz)
      otherCont[i] += cc[j]
      subducts[i] += pl.density[pi] > pl.density[pj] ? 1 : 0
    }
    if (cnt > 0) {
      isBoundary[i] = 1
      press[i] /= cnt
      shear[i] /= cnt
      otherCont[i] /= cnt
      subducts[i] /= cnt
    }
  }
  // Smooth stress along each plate's boundary so the grid's jagged normals
  // don't stripe the mountain chains.
  {
    const tmpP = new Float64Array(N)
    const tmpS = new Float64Array(N)
    for (let pass = 0, passes = scaledPasses(g, 4); pass < passes; pass++) {
      for (let i = 0; i < N; i++) {
        if (!isBoundary[i]) continue
        let sp = press[i] * 2, ss = shear[i] * 2, w = 2
        for (let k = off[i]; k < off[i + 1]; k++) {
          const j = nb[k]
          if (!isBoundary[j] || plate[j] !== plate[i]) continue
          sp += press[j]; ss += shear[j]; w++
        }
        tmpP[i] = sp / w
        tmpS[i] = ss / w
      }
      for (let i = 0; i < N; i++) if (isBoundary[i]) { press[i] = tmpP[i]; shear[i] = tmpS[i] }
    }
  }
  // Relative speeds are up to ~2; map to roughly [-1, 1] with soft saturation.
  for (let i = 0; i < N; i++) {
    if (!isBoundary[i]) continue
    const p = press[i] * 1.1
    press[i] = p / (1 + Math.abs(p) * 0.6) * 1.6
    press[i] = clamp(press[i], -1, 1)
  }

  // --- 2. Distance to own plate's boundary (multi-source Dijkstra) ---------
  const dist = new Float64Array(N).fill(Infinity)
  const src = new Int32Array(N).fill(-1)
  const heap = new MinHeap(N * 2)
  for (let i = 0; i < N; i++) {
    if (isBoundary[i]) { dist[i] = 0; src[i] = i; heap.push(0, i) }
  }
  const maxReach = 0.45
  while (heap.size > 0) {
    const d0 = heap.topKey()
    const c = heap.pop()
    if (d0 > dist[c]) continue
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (plate[j] !== plate[c]) continue
      const d = d0 + cellDistance(pos, c, j)
      if (d > maxReach) continue
      if (d < dist[j] || (d === dist[j] && src[c] < src[j])) {
        dist[j] = d
        src[j] = src[c]
        heap.push(d, j)
      }
    }
  }

  // --- 3. Tectonic relief from the nearest boundary ------------------------
  const tect = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const s = src[i]
    if (s < 0) continue
    const d = dist[i]
    const P = press[s]
    const sc = cc[s]
    const oc = otherCont[s]
    let h = 0
    if (P > 0) {
      // Continental side: against a continent, a broad high range + plateau
      // (Himalaya); against ocean, an Andes-style coastal range.
      const ccRange = 0.6 * bump(d, W.ccCore) + 0.3 * bump(d, W.ccPlateau)
      const coRange = 0.55 * bump(d - W.andesOffset, W.andesCore) + 0.15 * bump(d, W.andesFoot)
      const contSide = oc * ccRange + (1 - oc) * coRange
      // Oceanic side: dives under continents (trench); against ocean, the
      // denser plate dives (trench) and the other grows a volcanic island arc.
      const sub = oc + (1 - oc) * subducts[s]
      const trench = -0.45 * bump(d, W.trench)
      const arc = 0.75 * bump(d - W.arcOffset, W.arc)
      const oceanSide = sub * trench + (1 - sub) * arc
      h = P * (sc * contSide + (1 - sc) * oceanSide)
    } else if (P < 0) {
      const D = -P
      const rift = -0.28 * bump(d, W.rift) + 0.08 * bump(d - W.riftShoulderOffset, W.riftShoulder)
      const ridge = 0.22 * bump(d, W.ridge)
      h = D * (sc * rift + (1 - sc) * ridge)
    }
    h += shear[s] * 0.04 * bump(d, W.transform)
    tect[i] = h
  }
  blur(g, tect, scaledPasses(g, 2), 0.5)

  // --- 4. Compose -------------------------------------------------------------
  const coastDist = distanceToCoast(g, land)
  const raw = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
    const detail = fbm(nDetail, x, y, z, { octaves: 6, frequency: 3.5, gain: 0.5 })
    const d = coastDist[i]
    let h: number
    if (land[i]) {
      const u = d / PROFILE.interiorScale
      const ramp = u / (1 + u)
      h = PROFILE.coastLow + PROFILE.interior * ramp * (1 + 0.6 * large[i])
      h += 0.08 * detail * (0.3 + 0.7 * ramp)
    } else {
      const sw = PROFILE.shelfMin + (PROFILE.shelfMax - PROFILE.shelfMin) * (0.5 + 0.5 * fbm(nShelf, x, y, z, { octaves: 3, frequency: 3 }))
      if (d < sw) {
        h = -0.012 - (PROFILE.shelfDepth - 0.012) * (d / sw) + 0.006 * detail
      } else {
        const t = smoothstep(0, PROFILE.slope, d - sw)
        h = -PROFILE.shelfDepth - (PROFILE.abyss - PROFILE.shelfDepth) * t + 0.08 * detail * t
      }
    }
    let t = tect[i]
    if (t > 0) {
      // Break mountain belts into ridges and peaks.
      const r = ridged(nRidge, x, y, z, { octaves: 5, frequency: 6, gain: 0.55 })
      t *= 0.45 + 1.1 * r
      // Uplift barely touches the sea right off the coast (it would otherwise
      // grow the land outward along smooth depth contours, or raise broad
      // shallow flats); farther out it may break the surface as island arcs.
      if (!land[i]) t *= 0.1 + 0.9 * smoothstep(0.08, 0.2, d)
    }
    h += t
    // The mask decides the coastline: rifts and trenches leave land as
    // (possibly enclosed, lake-forming) lowland instead of punching inland seas.
    if (land[i]) h = softFloor(h, PROFILE.landFloor)
    else if (h > -PROFILE.landFloor) {
      // Sea cells stay sea near the coast (soft ceiling just below sea
      // level); farther out the ceiling fades and arcs may surface as islands.
      const ceiled = -softFloor(-h, PROFILE.landFloor)
      const free = smoothstep(0.08, 0.2, d)
      h = ceiled + (h - ceiled) * free
    }
    raw[i] = h
  }

  // --- 5. Erosion ----------------------------------------------------------------
  erode(g, raw, { iterations: 12, k: 0.003 * g.cellScale, diffusion: 0.015 })
  // Enclosed water from the mask is sunk below its shore only now, so erosion
  // cannot cut an outlet and drain it; the depression fill turns it into a lake.
  for (let i = 0; i < N; i++) {
    if (!basin[i]) continue
    const b = 0.35 * PROFILE.landFloor * (1 + 0.5 * fbm(nDetail, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], { octaves: 2, frequency: 12 }))
    if (raw[i] > b) raw[i] = b
  }
  // Lake districts: rare blobs of sunken ground away from the coast, more
  // common at high latitude (glacial scour). Erosion would have drained small
  // pits, so these are carved afterwards; on slopes they simply drain, on
  // flats and plateaus the depression fill turns them into lakes.
  for (let i = 0; i < N; i++) {
    if (raw[i] < 0 || coastDist[i] < 0.05) continue
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
    const ay = y < 0 ? -y : y
    const thr = 0.42 - 0.12 * smoothstep(0.55, 0.85, ay)
    const n = fbm(nLakes, x, y, z, { octaves: 3, frequency: 7 })
    if (n <= thr) continue
    const floor = raw[i] < 0.5 * PROFILE.landFloor ? raw[i] : 0.5 * PROFILE.landFloor
    const sunk = raw[i] - 0.03 * smoothstep(thr, thr + 0.12, n)
    raw[i] = sunk > floor ? sunk : floor
  }

  // --- 6. Normalize to [-1, 1] --------------------------------------------------
  // Land: mildly concave s(x) = (1 + a) x / (x + a) on x = height / ref,
  // which lifts lowlands relative to the rare high peaks. ref is a high land
  // quantile (not the single highest cell, which made the whole land scale
  // swing with one outlier peak); it maps to LAND_REF_OUT and the few cells
  // above it are spread linearly up to exactly 1, so peaks stay at the top.
  // Sea: piecewise linear so the shelf (raw depth < shelfDepth) always maps
  // shallower than the Coast biome cut and the abyss spreads over the rest.
  let hi = 0, lo = 0, nLand = 0
  for (let i = 0; i < N; i++) {
    if (raw[i] > hi) hi = raw[i]
    if (raw[i] < lo) lo = raw[i]
    if (raw[i] >= 0) nLand++
  }
  const landSorted = new Float64Array(nLand)
  for (let i = 0, k = 0; i < N; i++) if (raw[i] >= 0) landSorted[k++] = raw[i]
  landSorted.sort()
  let ref = nLand > 0 ? landSorted[clamp(Math.round(0.995 * (nLand - 1)), 0, nLand - 1)] : 0
  if (!(ref > 0)) ref = hi > 0 ? hi : 1
  const aLand = 3
  const LAND_REF_OUT = 0.85
  const shelfOut = 0.09
  const deepIn = -lo > PROFILE.shelfDepth * 2 ? -lo : PROFILE.shelfDepth * 2
  const elevation = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const h = raw[i]
    if (h < 0) {
      const u = -h
      const e = u <= PROFILE.shelfDepth
        ? (shelfOut * u) / PROFILE.shelfDepth
        : shelfOut + ((1 - shelfOut) * (u - PROFILE.shelfDepth)) / (deepIn - PROFILE.shelfDepth)
      elevation[i] = e > 1 ? -1 : -e
    } else if (h <= ref) {
      const x = h / ref
      elevation[i] = (LAND_REF_OUT * (1 + aLand) * x) / (x + aLand)
    } else {
      const e = LAND_REF_OUT + ((1 - LAND_REF_OUT) * (h - ref)) / (hi - ref)
      elevation[i] = e > 1 ? 1 : e
    }
  }
  return { elevation, tectonic: tect, landMask: land, basin }
}

/**
 * Where two continental plates meet without converging hard, open a sea
 * between them (continental crust thins towards that boundary over a per-pair
 * random width), so continental plates do not automatically weld into one
 * landmass. Converging pairs stay joined and raise a collision range. How
 * readily pairs separate follows the world's dispersal tendency.
 */
function riftContinents(g: SimGrid, pl: Plates, rng: Rng, cont: Float64Array): void {
  const N = g.cellCount
  const { pos, neighborOffsets: off, neighbors: nb } = g
  const plate = pl.plate
  const C = pl.count
  const closeSum = new Float64Array(C * C)
  const closeCnt = new Float64Array(C * C)
  const vi = [0, 0, 0]
  const vj = [0, 0, 0]
  for (let i = 0; i < N; i++) {
    const pi = plate[i]
    if (!pl.continental[pi]) continue
    for (let k = off[i]; k < off[i + 1]; k++) {
      const j = nb[k]
      const pj = plate[j]
      if (pj === pi || !pl.continental[pj]) continue
      let nx = pos[j * 3] - pos[i * 3], ny = pos[j * 3 + 1] - pos[i * 3 + 1], nz = pos[j * 3 + 2] - pos[i * 3 + 2]
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz)
      nx *= inv; ny *= inv; nz *= inv
      plateVelocity(pl, g, pi, i, vi)
      plateVelocity(pl, g, pj, i, vj)
      closeSum[pi * C + pj] += (vi[0] - vj[0]) * nx + (vi[1] - vj[1]) * ny + (vi[2] - vj[2]) * nz
      closeCnt[pi * C + pj]++
    }
  }
  // Pair decisions are symmetric: use the pooled mean over both sides.
  const width = new Float64Array(C * C) // 0 = welded
  const cut = -0.15 + 0.75 * pl.dispersal
  for (let p = 0; p < C; p++) {
    for (let q = p + 1; q < C; q++) {
      const r = rng.next() // drawn for every pair so the stream does not depend on decisions
      const cnt = closeCnt[p * C + q] + closeCnt[q * C + p]
      if (cnt === 0) continue
      const close = (closeSum[p * C + q] + closeSum[q * C + p]) / cnt
      if (close >= cut) continue
      const w = 0.06 + 0.22 * r * r
      width[p * C + q] = w
      width[q * C + p] = w
    }
  }
  // Distance (within the plate) to the nearest separating boundary, measured
  // in units of that boundary's width.
  const dist = new Float64Array(N).fill(Infinity)
  const scale = new Float64Array(N)
  const heap = new MinHeap(N * 2)
  for (let i = 0; i < N; i++) {
    const pi = plate[i]
    if (!pl.continental[pi]) continue
    let best = Infinity
    for (let k = off[i]; k < off[i + 1]; k++) {
      const j = nb[k]
      const w = width[pi * C + plate[j]]
      if (w === 0) continue
      const d = (0.5 * cellDistance(pos, i, j)) / w
      if (d < best) { best = d; scale[i] = w }
    }
    if (best < Infinity) { dist[i] = best; heap.push(best, i) }
  }
  while (heap.size > 0) {
    const d0 = heap.topKey()
    const c = heap.pop()
    if (d0 > dist[c] || d0 >= 1) continue
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (plate[j] !== plate[c]) continue
      const d = d0 + cellDistance(pos, c, j) / scale[c]
      if (d < dist[j]) { dist[j] = d; scale[j] = scale[c]; heap.push(d, j) }
    }
  }
  for (let i = 0; i < N; i++) if (dist[i] < 1) cont[i] *= smoothstep(0, 1, dist[i])
}

/** Value below which a fraction q of the field lies. */
function quantile(field: Float64Array, q: number): number {
  const sorted = Float64Array.from(field).sort()
  return sorted[clamp(Math.round(q * field.length), 0, field.length - 1)]
}

/**
 * Enclosed water patches smaller than minHole cells become land; patches
 * smaller than maxBasin become land flagged as lake basin (both in place).
 */
function closeEnclosedWater(g: SimGrid, land: Uint8Array, basin: Uint8Array, minHole: number, maxBasin: number): void {
  const N = g.cellCount
  const { neighborOffsets: off, neighbors: nb } = g
  const seen = new Uint8Array(N)
  const stack = new Int32Array(N)
  const members = new Int32Array(N)
  for (let s = 0; s < N; s++) {
    if (land[s] || seen[s]) continue
    let sp = 0, m = 0
    stack[sp++] = s
    seen[s] = 1
    while (sp > 0) {
      const c = stack[--sp]
      members[m++] = c
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (!land[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j }
      }
    }
    if (m < maxBasin) {
      for (let t = 0; t < m; t++) {
        land[members[t]] = 1
        if (m >= minHole) basin[members[t]] = 1
      }
    }
  }
}

/**
 * Great-circle-ish distance from each cell to the coastline (the midpoint of
 * the nearest land-sea edge), measured within the cell's own side of the mask.
 */
function distanceToCoast(g: SimGrid, land: Uint8Array): Float64Array {
  const N = g.cellCount
  const { pos, neighborOffsets: off, neighbors: nb } = g
  const dist = new Float64Array(N).fill(Infinity)
  const heap = new MinHeap(N * 2)
  for (let i = 0; i < N; i++) {
    let best = Infinity
    for (let k = off[i]; k < off[i + 1]; k++) {
      const j = nb[k]
      if (land[j] !== land[i]) {
        const d = 0.5 * cellDistance(pos, i, j)
        if (d < best) best = d
      }
    }
    if (best < Infinity) { dist[i] = best; heap.push(best, i) }
  }
  while (heap.size > 0) {
    const d0 = heap.topKey()
    const c = heap.pop()
    if (d0 > dist[c]) continue
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (land[j] !== land[c]) continue
      const d = d0 + cellDistance(pos, c, j)
      if (d < dist[j]) { dist[j] = d; heap.push(d, j) }
    }
  }
  // A world that is all land or all sea has no coast; treat it as far from one.
  for (let i = 0; i < N; i++) if (dist[i] === Infinity) dist[i] = 1
  return dist
}
