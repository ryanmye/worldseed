// The rendered ground: one height function for the planet mesh, its close-zoom detail
// tiles (terrainDetail.ts), the CPU surface probe (dioramas/surface.ts) and every layer
// placed on the land. Heights h are in elevation units (land elevation is 0..1); the
// ground sits at radius 1 + RELIEF_NEAR * h in the stored geometry and in every CPU
// placement, and the vertex shaders of the planet and of the layers on it rescale that
// radially to the zoom-dependent relief of the moment (relief.k, RELIEF_GLSL ws_relief):
// modest at globe zoom so the limb stays clean, the full RELIEF_NEAR from mid zoom in,
// where the 3D settlements show (so CPU placements up close are exact).
//
//   h(u) = b(u) + A(u) * (w(u) * T(u) + (1 - w(u)) * FLOOR)
//
//  - b: the cell elevations, interpolated over the icosphere triangle with Phong-style
//    curvature (each corner's tangent plane from the smoothed cell gradients, so ranges are
//    rounded rather than faceted), pinned to 0 at the shader's noisy coastline (the sea is
//    flat at radius 1 and the drawn shore is where the land starts).
//  - A: detail amplitude per cell, growing with elevation and with the cell's slope (plains
//    stay smooth, hills roll, mountains get ridges), 0 over the sea and lakes.
//  - T: multi-octave noise, smooth fBm-like on hills and ridged (crests where the noise
//    crosses zero) on mountains, domain-warped, centred on 0; anchored in object space
//    (seeded by the world through the per-cell data, identical every time).
//  - w: wildness, 1 in the wild; 0 at settlement footprints, along rivers and over
//    farmed land, where the detail flattens into a valley floor FLOOR (terraces and
//    valley bottoms for towns, fields, channels).
//
// The octaves of T are band-limited: geometry carries only the octaves its tessellation
// resolves at a vertex (`band`, a continuous function of the distance to the camera when
// the tiles were built; the base mesh carries none), the planet fragment shader adds the
// rest per pixel (normals, snow, rock and occlusion), with the same noise (DETAIL_GLSL,
// the GLSL twin of evalDetail). CPU placements use the full band.

import { RIVER_FLOW_THRESHOLD, type History, type World } from '../contract.ts'
import { townFootprint } from './dioramas/footprint.ts'

/** Relief (fraction of the planet radius per unit of h) of the stored ground and up close. */
export const RELIEF_NEAR = 0.028
/** Relief at globe zoom (the silhouette stays clean). */
export const RELIEF_FAR = 0.012
/** Shading relief at globe zoom (normals exaggerated beyond the geometry, as before). */
const SHADE_FAR = 0.07
/** Shading of the per-pixel detail octaves at globe zoom. */
const DETAIL_SHADE_FAR = 0.02
/** Camera altitudes (above sea level) between which the relief ramps from far to near. */
const ALT_FAR = 1.5
const ALT_NEAR = 0.34

/** Detail octaves (the last ones are per pixel only: no tessellation is fine enough). */
export const DETAIL_OCTAVES = 6
/** Lacunarity and gain of the detail octaves. */
const LAC = 2.03
const GAIN = 0.42
/** Valley floor of flattened ground, in units of T. */
const FLOOR = -0.22
/** Phong curvature of the base surface (0: flat triangles). */
const PHONG = 0.7

/** Current zoom-dependent relief (written once per frame by the globe). */
export const relief = {
  /** Rendered relief / stored relief (RELIEF_NEAR). */
  k: RELIEF_FAR / RELIEF_NEAR,
  /** Rendered relief (fraction of radius per unit h). */
  scale: RELIEF_FAR,
  /** Shading relief of the base and mesh detail gradients. */
  shade: SHADE_FAR,
  /** Shading relief of the per-pixel detail octaves. */
  detailShade: DETAIL_SHADE_FAR,
  /** 0 at globe zoom .. 1 from mid zoom in. */
  near: 0,
}

/** Shared uniform: reference it from a material's uniforms (do not clone). */
export const reliefUniforms = {
  uReliefK: { value: relief.k },
}

const smooth = (a: number, b: number, x: number) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a)
  return t * t * (3 - 2 * t)
}

/** Sets the relief for a camera altitude above sea level; true if it changed. */
export function setReliefAltitude(alt: number): boolean {
  const t = (Math.log(ALT_FAR) - Math.log(Math.max(alt, 1e-4))) / (Math.log(ALT_FAR) - Math.log(ALT_NEAR))
  const c = smooth(0, 1, t)
  if (Math.abs(c - relief.near) < 1e-5) return false
  relief.near = c
  relief.scale = RELIEF_FAR + (RELIEF_NEAR - RELIEF_FAR) * c
  relief.k = relief.scale / RELIEF_NEAR
  relief.shade = SHADE_FAR + (RELIEF_NEAR - SHADE_FAR) * c
  relief.detailShade = DETAIL_SHADE_FAR + (RELIEF_NEAR - DETAIL_SHADE_FAR) * c
  reliefUniforms.uReliefK.value = relief.k
  return true
}

/** Rendered radius of a point stored at radius r (CPU twin of ws_relief). */
export function reliefRadius(r: number): number {
  return 1 + (r - 1) * relief.k
}

/**
 * GLSL: `ws_relief(p)` moves a point stored at the RELIEF_NEAR ground (plus any lift) to the
 * relief of the moment (radially about sea level). Add `uReliefK: reliefUniforms.uReliefK`.
 */
export const RELIEF_GLSL = /* glsl */ `
uniform float uReliefK;
vec3 ws_relief(vec3 p) {
  float r = length(p);
  return r > 1.0 ? p * ((1.0 + (r - 1.0) * uReliefK) / r) : p;
}
`

// ---------- gradient noise (glsl.ts ws_noised), value and gradient ----------

const fract = (v: number) => v - Math.floor(v)
let HX = 0, HY = 0, HZ = 0
function hash33(px: number, py: number, pz: number) {
  px = fract(px * 0.1031)
  py = fract(py * 0.103)
  pz = fract(pz * 0.0973)
  const dd = px * (py + 33.33) + py * (px + 33.33) + pz * (pz + 33.33)
  px += dd
  py += dd
  pz += dd
  HX = -1 + 2 * fract((px + py) * pz)
  HY = -1 + 2 * fract((px + px) * py)
  HZ = -1 + 2 * fract((py + px) * px)
}

/** Noise derivative of the last noised() call (with respect to x, y, z). */
let NDX = 0, NDY = 0, NDZ = 0

/** ws_noised: value in ~[-0.7, 0.7]; the gradient lands in NDX, NDY, NDZ. */
function noised(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const fx = x - ix, fy = y - iy, fz = z - iz
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
  const dux = 30 * fx * fx * (fx * (fx - 2) + 1)
  const duy = 30 * fy * fy * (fy * (fy - 2) + 1)
  const duz = 30 * fz * fz * (fz * (fz - 2) + 1)
  hash33(ix, iy, iz); const gax = HX, gay = HY, gaz = HZ
  hash33(ix + 1, iy, iz); const gbx = HX, gby = HY, gbz = HZ
  hash33(ix, iy + 1, iz); const gcx = HX, gcy = HY, gcz = HZ
  hash33(ix + 1, iy + 1, iz); const gdx = HX, gdy = HY, gdz = HZ
  hash33(ix, iy, iz + 1); const gex = HX, gey = HY, gez = HZ
  hash33(ix + 1, iy, iz + 1); const gfx = HX, gfy = HY, gfz = HZ
  hash33(ix, iy + 1, iz + 1); const ggx = HX, ggy = HY, ggz = HZ
  hash33(ix + 1, iy + 1, iz + 1); const ghx = HX, ghy = HY, ghz = HZ
  const va = gax * fx + gay * fy + gaz * fz
  const vb = gbx * (fx - 1) + gby * fy + gbz * fz
  const vc = gcx * fx + gcy * (fy - 1) + gcz * fz
  const vd = gdx * (fx - 1) + gdy * (fy - 1) + gdz * fz
  const ve = gex * fx + gey * fy + gez * (fz - 1)
  const vf = gfx * (fx - 1) + gfy * fy + gfz * (fz - 1)
  const vg = ggx * fx + ggy * (fy - 1) + ggz * (fz - 1)
  const vh = ghx * (fx - 1) + ghy * (fy - 1) + ghz * (fz - 1)
  const k1 = vb - va, k2 = vc - va, k3 = ve - va
  const k4 = va - vb - vc + vd, k5 = va - vc - ve + vg, k6 = va - vb - ve + vf
  const k7 = -va + vb + vc - vd + ve - vf - vg + vh
  const v = va + ux * k1 + uy * k2 + uz * k3 + ux * uy * k4 + uy * uz * k5 + uz * ux * k6 + ux * uy * uz * k7
  // gradient: interpolated corner gradients plus the derivative of the blend
  const ix1 = gbx - gax, ix2 = gcx - gax, ix3 = gex - gax, ix4 = gax - gbx - gcx + gdx, ix5 = gax - gcx - gex + ggx, ix6 = gax - gbx - gex + gfx, ix7 = -gax + gbx + gcx - gdx + gex - gfx - ggx + ghx
  const iy1 = gby - gay, iy2 = gcy - gay, iy3 = gey - gay, iy4 = gay - gby - gcy + gdy, iy5 = gay - gcy - gey + ggy, iy6 = gay - gby - gey + gfy, iy7 = -gay + gby + gcy - gdy + gey - gfy - ggy + ghy
  const iz1 = gbz - gaz, iz2 = gcz - gaz, iz3 = gez - gaz, iz4 = gaz - gbz - gcz + gdz, iz5 = gaz - gcz - gez + ggz, iz6 = gaz - gbz - gez + gfz, iz7 = -gaz + gbz + gcz - gdz + gez - gfz - ggz + ghz
  const uxy = ux * uy, uyz = uy * uz, uzx = uz * ux, uxyz = uxy * uz
  NDX = gax + ux * ix1 + uy * ix2 + uz * ix3 + uxy * ix4 + uyz * ix5 + uzx * ix6 + uxyz * ix7
    + dux * (k1 + uy * k4 + uz * k6 + uyz * k7)
  NDY = gay + ux * iy1 + uy * iy2 + uz * iy3 + uxy * iy4 + uyz * iy5 + uzx * iy6 + uxyz * iy7
    + duy * (k2 + uz * k5 + ux * k4 + uzx * k7)
  NDZ = gaz + ux * iz1 + uy * iz2 + uz * iz3 + uxy * iz4 + uyz * iz5 + uzx * iz6 + uxyz * iz7
    + duz * (k3 + ux * k6 + uy * k5 + uxy * k7)
  return v
}

/** ws_fbm at full detail, value only (the shader's coast noise). */
export function fbm(x: number, y: number, z: number, freq: number, octaves: number): number {
  let sum = 0
  let amp = 0.5
  for (let o = 0; o < octaves; o++) {
    sum += amp * noised(x * freq, y * freq, z * freq)
    freq *= 2.03
    amp *= 0.5
  }
  return sum * 2
}

// Mean of one ridged and one smooth octave over space (measured once; the GLSL gets the same constants).
function octaveMeans(): [number, number] {
  let s = 0, r = 0
  let seed = 12345
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  const n = 20000
  for (let i = 0; i < n; i++) {
    const v = noised(rnd() * 97.3, rnd() * 97.3, rnd() * 97.3)
    const a = 1 - Math.min(Math.abs(v) * 1.6, 1)
    r += a * a
    s += 0.5 + 0.8 * v
  }
  return [s / n, r / n]
}
const [MEAN_S, MEAN_R] = octaveMeans()

/** Detail noise result: centred value and object-space gradient (of the octaves evaluated). */
export const detail = { t: 0, gx: 0, gy: 0, gz: 0 }

let DETAIL_NORM = 0
for (let o = 0, a = 1; o < DETAIL_OCTAVES; o++, a *= GAIN) DETAIL_NORM += a

/** Fine octaves are stronger on the crests of the first (ridged) octave than in its hollows. */
const CREST_LO = 0.35
const CREST_HI = 1.3

/**
 * T at unit direction (x, y, z): octaves o with weight clamp(band - o, 0, 1) (band 0: none,
 * DETAIL_OCTAVES: all), `ridge` 0 (rolling) .. 1 (ridged), `freq` the base frequency. The
 * octaves after the first are scaled by the first octave's crest value (rugged ridges,
 * smoother valley floors). Writes `detail`. The domain warp's own derivative is neglected
 * in the gradient (it is slow and small), exactly as in DETAIL_GLSL.
 */
export function evalDetail(x: number, y: number, z: number, freq: number, ridge: number, band: number): void {
  detail.t = detail.gx = detail.gy = detail.gz = 0
  if (band <= 0) return
  const wf = freq * 0.35
  noised(x * wf + 3.7, y * wf + 3.7, z * wf + 3.7)
  const ws = 0.2 / freq
  const qx = x + NDX * ws, qy = y + NDY * ws, qz = z + NDZ * ws
  const mean = MEAN_S + (MEAN_R - MEAN_S) * ridge
  let f = freq, amp = 1 / DETAIL_NORM
  let t = 0, gx = 0, gy = 0, gz = 0
  // crest factor from the first octave, and its gradient
  let crest = 1, cgx = 0, cgy = 0, cgz = 0
  // sum of the octaves after the first (unscaled), for the crest factor's gradient
  let hs = 0
  for (let o = 0; o < DETAIL_OCTAVES; o++) {
    const wo = band - o >= 1 ? 1 : band - o
    if (wo <= 0) break
    const n = noised(qx * f + o * 17.17, qy * f + o * 31.31, qz * f + o * 11.11)
    const an = Math.abs(n) * 1.6
    const c = an < 1 ? 1 - an : 0
    const dc = an < 1 ? -1.6 * (n < 0 ? -1 : 1) : 0
    // value: mix(smooth, ridged, ridge); derivative factor per unit of the noise gradient
    const v = (0.5 + 0.8 * n) * (1 - ridge) + c * c * ridge - mean
    const dv = (0.8 * (1 - ridge) + 2 * c * dc * ridge) * f
    if (o === 0) {
      crest = CREST_LO + (CREST_HI - CREST_LO) * c * c
      const k = (CREST_HI - CREST_LO) * 2 * c * dc * f
      cgx = k * NDX; cgy = k * NDY; cgz = k * NDZ
      const a = amp * wo
      t += a * v
      gx += a * dv * NDX; gy += a * dv * NDY; gz += a * dv * NDZ
    } else {
      const a = amp * wo
      hs += a * v
      t += crest * a * v
      gx += crest * a * dv * NDX; gy += crest * a * dv * NDY; gz += crest * a * dv * NDZ
    }
    f *= LAC
    amp *= GAIN
  }
  detail.t = t
  detail.gx = gx + hs * cgx
  detail.gy = gy + hs * cgy
  detail.gz = gz + hs * cgz
}

/**
 * GLSL twin of evalDetail for the per-pixel octaves: `ws_detail(p, freq, ridge, fromBand,
 * footprint)` returns vec4(T, gradient) of the octaves NOT already in the geometry (weight
 * 1 - clamp(fromBand - o, 0, 1)), each faded by the pixel footprint. Needs NOISE_GLSL.
 */
export const DETAIL_GLSL = /* glsl */ `
const float DETAIL_MEAN_S = ${MEAN_S.toFixed(6)};
const float DETAIL_MEAN_R = ${MEAN_R.toFixed(6)};
// the domain warp at p (object-space displacement) and the raw first octave at the warped point:
// slow fields, which the surface bake also stores (planetShaders.ts T4, T5)
vec3 ws_detailWarp(vec3 p, float freq) {
  return ws_noised(p * (freq * 0.35) + 3.7).yzw * (0.2 / freq);
}
vec4 ws_detailN0(vec3 q, float freq) {
  return ws_noised(q * freq);
}
// the octaves not already in the geometry, given the warped point q and the first octave n0
vec4 ws_detailHi(vec3 q, vec4 n0, float freq, float ridge, float fromBand, float footprint) {
  vec4 sum = vec4(0.0);
  float mean = mix(DETAIL_MEAN_S, DETAIL_MEAN_R, ridge);
  float amp = ${(1 / DETAIL_NORM).toFixed(6)};
  // first octave: its value (where not in the geometry) and the crest factor of the rest
  float an0 = abs(n0.x) * 1.6;
  float c0 = an0 < 1.0 ? 1.0 - an0 : 0.0;
  float dc0 = an0 < 1.0 ? -1.6 * sign(n0.x) : 0.0;
  float w0 = (1.0 - clamp(fromBand, 0.0, 1.0)) * ws_lod(freq, footprint);
  if (w0 > 0.0) {
    float v = (0.5 + 0.8 * n0.x) * (1.0 - ridge) + c0 * c0 * ridge - mean;
    float dv = (0.8 * (1.0 - ridge) + 2.0 * c0 * dc0 * ridge) * freq;
    sum += amp * w0 * vec4(v, dv * n0.yzw);
  }
  float crest = ${CREST_LO.toFixed(3)} + ${(CREST_HI - CREST_LO).toFixed(3)} * c0 * c0;
  vec3 cg = ${(CREST_HI - CREST_LO).toFixed(3)} * 2.0 * c0 * dc0 * freq * n0.yzw;
  float hs = 0.0;
  float f = freq * ${LAC.toFixed(2)};
  amp *= ${GAIN.toFixed(3)};
  for (int o = 1; o < ${DETAIL_OCTAVES}; o++) {
    float fo = float(o);
    float lod = ws_lod(f, footprint);
    if (lod <= 0.0) break;
    float wo = (1.0 - clamp(fromBand - fo, 0.0, 1.0)) * lod;
    if (wo > 0.0) {
      vec4 n = ws_noised(q * f + fo * vec3(17.17, 31.31, 11.11));
      float an = abs(n.x) * 1.6;
      float c = an < 1.0 ? 1.0 - an : 0.0;
      float dc = an < 1.0 ? -1.6 * sign(n.x) : 0.0;
      float v = (0.5 + 0.8 * n.x) * (1.0 - ridge) + c * c * ridge - mean;
      float dv = (0.8 * (1.0 - ridge) + 2.0 * c * dc * ridge) * f;
      hs += amp * wo * v;
      sum += crest * amp * wo * vec4(v, dv * n.yzw);
    }
    f *= ${LAC.toFixed(2)};
    amp *= ${GAIN.toFixed(3)};
  }
  sum.yzw += hs * cg;
  return sum;
}
// all of it, evaluated in place (procedural shader)
vec4 ws_detail(vec3 p, float freq, float ridge, float fromBand, float footprint) {
  if (ws_lod(freq, footprint) <= 0.0 || fromBand >= ${DETAIL_OCTAVES.toFixed(1)}) return vec4(0.0);
  vec3 q = p + ws_detailWarp(p, freq);
  return ws_detailHi(q, ws_detailN0(q, freq), freq, ridge, fromBand, footprint);
}
`

// ---------- the per-world field ----------

/** Town footprints flattened into valley floors, and river channels. */
interface Features {
  /** Sites: unit centre xyz, flat radius and blend width (object-space units). */
  site: Float32Array
  siteCount: number
  /** Per cell: sites near it (CSR). */
  siteOff: Uint32Array
  siteIdx: Uint32Array
}

export interface TerrainField {
  readonly world: World
  /** Bumped whenever the history-dependent part (flattening) changes. */
  version: number
  readonly cellFreq: number
  /** Base frequency of the detail octaves (object-space cycles per unit). */
  readonly detailFreq: number
  /** Signed elevation, land elevation (>= 0). */
  readonly eS: Float32Array
  readonly eL: Float32Array
  /** The shader's coast-noise slope per cell (quantised as aSeed.w). */
  readonly coastSlope: Float32Array
  /** Detail amplitude, ridge sharpness, wildness (history) per cell. */
  readonly amp: Float32Array
  readonly ridge: Float32Array
  wild: Float32Array
  /** Smoothed gradient of the land elevation per cell (object space, tangential; e per unit arc). */
  readonly grad: Float32Array
  /** Snow line per cell (in h units). */
  readonly snowLine: Float32Array
  /** Lake flag (or null). */
  readonly lake: Uint8Array | null
  /** River channels: segments (ax, ay, az, bx, by, bz, half width) and per-cell CSR. */
  readonly river: Float32Array
  readonly riverOff: Uint32Array
  readonly riverIdx: Uint32Array
  features: Features
  /** Ground radius at each cell centre (RELIEF_NEAR, full band), and an upper bound of the ground over the cell's fan. */
  cellRadius: Float32Array
  cellMaxRadius: Float32Array
}

const fields = new WeakMap<World, TerrainField>()

/**
 * Snow line (h units) for a sea-level temperature (sim/climate.ts: 0.04 + 0.96 cos^2 latitude
 * plus noise): at sea level in polar climates (~68 degrees and up), rising fast through the
 * high latitudes (~0.25 at 60, ~0.42 at 50, ~0.6 at 35 degrees) and levelling off at ~0.7 in
 * the tropics, so the high ranges of every zone carry white peaks and warm lowlands none.
 */
export function snowLineFor(tSeaLevel: number): number {
  return tSeaLevel <= 0.17 ? 0 : 0.74 * (1 - Math.exp(-(tSeaLevel - 0.17) * 3.2))
}

/** The world's terrain field (built on first use, cached per world). */
export function terrainOf(world: World): TerrainField {
  let f = fields.get(world)
  if (!f) {
    f = buildField(world)
    fields.set(world, f)
  }
  return f
}

function buildField(world: World): TerrainField {
  const { positions: P, cellCount: N, neighborOffsets: off, neighbors: nb, triangles } = world.grid
  const E = world.elevation
  const lakeRaw = (world as Partial<World>).lake
  const lake = lakeRaw && lakeRaw.length === N ? lakeRaw : null
  const eS = Float32Array.from(E)
  const eL = new Float32Array(N)
  const coastSlope = new Float32Array(N)
  const amp = new Float32Array(N)
  const ridge = new Float32Array(N)
  const wild = new Float32Array(N).fill(1)
  const snowLine = new Float32Array(N)
  const cellFreq = 1 / Math.sqrt((4 * Math.PI) / N)
  for (let i = 0; i < N; i++) {
    const e = Math.max(0, E[i])
    eL[i] = e
    let sum = 0
    for (let k = off[i]; k < off[i + 1]; k++) sum += Math.abs(E[nb[k]] - E[i])
    const mean = sum / Math.max(1, off[i + 1] - off[i])
    const q = Math.min(255, Math.round(mean * 2 * 255))
    coastSlope[i] = (q / 255) * 0.5
    const water = E[i] < 0 || (lake !== null && lake[i] === 1)
    amp[i] = water ? 0 : 0.05 * smooth(0.03, 0.25, e) + 0.3 * smooth(0.22, 0.8, e) + 0.6 * Math.min(mean, 0.3) * smooth(0.1, 0.35, e)
    ridge[i] = smooth(0.12, 0.45, e)
    // the simulation's temperature has a lapse rate of 0.45 per unit elevation (sim/climate.ts)
    snowLine[i] = snowLineFor(world.temperature[i] + 0.45 * e)
  }
  // smoothed gradient of the land elevation: area-weighted normals of a gently scaled relief mesh
  const S0 = 0.01
  const p = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    const r = 1 + eL[i] * S0
    p[i * 3] = P[i * 3] * r; p[i * 3 + 1] = P[i * 3 + 1] * r; p[i * 3 + 2] = P[i * 3 + 2] * r
  }
  const n = new Float32Array(N * 3)
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz
  }
  const grad = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    let x = n[i * 3], y = n[i * 3 + 1], z = n[i * 3 + 2]
    const l = Math.hypot(x, y, z) || 1
    x /= l; y /= l; z /= l
    const ux = P[i * 3], uy = P[i * 3 + 1], uz = P[i * 3 + 2]
    const d = x * ux + y * uy + z * uz
    const s = -1 / (Math.max(d, 0.2) * S0)
    grad[i * 3] = (x - d * ux) * s
    grad[i * 3 + 1] = (y - d * uy) * s
    grad[i * 3 + 2] = (z - d * uz) * s
  }
  const rivers = buildRiverChannels(world, lake)
  const f: TerrainField = {
    world,
    version: 0,
    cellFreq,
    detailFreq: cellFreq * 1.0,
    eS, eL, coastSlope, amp, ridge, wild, grad, snowLine, lake,
    river: rivers.seg, riverOff: rivers.off, riverIdx: rivers.idx,
    features: { site: new Float32Array(0), siteCount: 0, siteOff: new Uint32Array(N + 1), siteIdx: new Uint32Array(0) },
    cellRadius: new Float32Array(N),
    cellMaxRadius: new Float32Array(N),
  }
  computeCellRadii(f)
  return f
}

/** Half width of a river channel up close (rivers.ts riverHalfWidthNear, kept in step). */
function riverHalfWidth(flow: number, threshold: number): number {
  return Math.min(0.0011, 0.00014 + 0.00026 * Math.log(Math.max(flow, threshold) / threshold))
}

/**
 * The river ribbons' centre lines (rivers.ts: per river cell a quadratic Bezier from the
 * midpoint of its incoming segment, through the cell as control point, to the midpoint of
 * its outgoing one), as short segments listed under every cell they pass near.
 */
function buildRiverChannels(world: World, lake: Uint8Array | null): { seg: Float32Array; off: Uint32Array; idx: Uint32Array } {
  const { grid, flow, riverTo, elevation } = world
  const P = grid.positions
  const N = grid.cellCount
  const threshold = RIVER_FLOW_THRESHOLD
  const water = (i: number) => elevation[i] < 0 || (lake !== null && lake[i] === 1)
  const isRiver = (i: number) => flow[i] >= threshold && riverTo[i] >= 0 && !water(i)
  const main = new Int32Array(N).fill(-1)
  for (let i = 0; i < N; i++) {
    if (!isRiver(i)) continue
    const j = riverTo[i]
    if (main[j] < 0 || flow[i] > flow[main[j]]) main[j] = i
  }
  const seg: number[] = []
  const cellsOf: number[] = [] // owner cell per segment
  const unit = (i: number, o: number[]) => { o[0] = P[i * 3]; o[1] = P[i * 3 + 1]; o[2] = P[i * 3 + 2]; return o }
  const nrm = (o: number[]) => { const l = Math.hypot(o[0], o[1], o[2]) || 1; o[0] /= l; o[1] /= l; o[2] /= l; return o }
  const mid = (a: number, b: number) => nrm([P[a * 3] + P[b * 3], P[a * 3 + 1] + P[b * 3 + 1], P[a * 3 + 2] + P[b * 3 + 2]])
  const SAMPLES = 6
  const emit = (q0: number[], q1: number[], q2: number[], w0: number, w2: number, owner: number) => {
    let px = 0, py = 0, pz = 0
    for (let s = 0; s < SAMPLES; s++) {
      const t = s / (SAMPLES - 1), u = 1 - t
      let x = q0[0] * u * u + q1[0] * 2 * u * t + q2[0] * t * t
      let y = q0[1] * u * u + q1[1] * 2 * u * t + q2[1] * t * t
      let z = q0[2] * u * u + q1[2] * 2 * u * t + q2[2] * t * t
      const l = Math.hypot(x, y, z) || 1
      x /= l; y /= l; z /= l
      if (s > 0) {
        seg.push(px, py, pz, x, y, z, w0 + (w2 - w0) * t)
        cellsOf.push(owner)
      }
      px = x; py = y; pz = z
    }
  }
  for (let b = 0; b < N; b++) {
    if (!isRiver(b)) continue
    const c = riverTo[b]
    const wb = riverHalfWidth(flow[b], threshold)
    let end: number[]
    if (water(c)) {
      const eb = elevation[b], ec = elevation[c]
      const t = ec < 0 && eb > ec ? Math.min(0.8, Math.max(0.2, eb / (eb - ec))) : 0.5
      end = nrm([P[b * 3] * (1 - t) + P[c * 3] * t, P[b * 3 + 1] * (1 - t) + P[c * 3 + 1] * t, P[b * 3 + 2] * (1 - t) + P[c * 3 + 2] * t])
    } else end = mid(b, c)
    const up = main[b]
    const cb = unit(b, [0, 0, 0])
    if (up >= 0) {
      const start = mid(up, b)
      emit(start, cb, end, riverHalfWidth(flow[up], threshold), wb, b)
      // tributaries: from their midpoint toward the main curve near the cell
      const join = nrm([start[0] * 0.25 + cb[0] * 0.5 + end[0] * 0.25, start[1] * 0.25 + cb[1] * 0.5 + end[1] * 0.25, start[2] * 0.25 + cb[2] * 0.5 + end[2] * 0.25])
      for (let k = grid.neighborOffsets[b]; k < grid.neighborOffsets[b + 1]; k++) {
        const a = grid.neighbors[k]
        if (a === up || riverTo[a] !== b || !isRiver(a)) continue
        const s0 = mid(a, b)
        const m = nrm([s0[0] + join[0], s0[1] + join[1], s0[2] + join[2]])
        const wa = riverHalfWidth(flow[a], threshold)
        emit(s0, m, join, wa, wa, b)
      }
    } else {
      emit(cb, nrm([cb[0] + end[0], cb[1] + end[1], cb[2] + end[2]]), end, wb * 0.6, wb, b)
    }
  }
  // list every segment under its owner cell and the owner's neighbours (a segment never strays further)
  const S = cellsOf.length
  const count = new Uint32Array(N + 1)
  const { neighborOffsets: off, neighbors: nb } = grid
  for (let s = 0; s < S; s++) {
    const c = cellsOf[s]
    count[c]++
    for (let k = off[c]; k < off[c + 1]; k++) count[nb[k]]++
  }
  const o = new Uint32Array(N + 1)
  for (let i = 0; i < N; i++) o[i + 1] = o[i] + count[i]
  const fill = o.slice(0, N)
  const idx = new Uint32Array(o[N])
  for (let s = 0; s < S; s++) {
    const c = cellsOf[s]
    idx[fill[c]++] = s
    for (let k = off[c]; k < off[c + 1]; k++) idx[fill[nb[k]]++] = s
  }
  return { seg: Float32Array.from(seg), off: o, idx }
}

/**
 * The history's share of the ground: towns sit in valley floors and farmed cells are
 * smoothed, from every settlement and every land snapshot of the whole history (so the
 * ground is the same at every year: scrubbing never moves it). Null clears.
 */
export function setTerrainHistory(world: World, history: History | null): void {
  const f = terrainOf(world)
  const N = world.grid.cellCount
  const P = world.grid.positions
  f.wild = new Float32Array(N).fill(1)
  const siteList: number[] = []
  const siteCell: number[] = []
  if (history) {
    // farmed land: the highest land use over the history, per cell
    const lu = history.landUse
    const L = history.landSnapshotCount
    if (lu && L > 0 && lu.length >= L * N) {
      for (let i = 0; i < N; i++) {
        let m = 0
        for (let s = 0; s < L; s++) {
          const v = lu[s * N + i]
          if (v > m) m = v
        }
        // (high mountains keep their relief even where the history farms them)
        f.wild[i] = 1 - 0.85 * smooth(40, 170, m) * (1 - smooth(0.35, 0.62, f.eL[i]))
      }
    }
    // settlements: the largest population each ever had sets the footprint
    const S = history.settlements.length
    const pop = history.population
    const snaps = history.snapshotCount
    for (let id = 0; id < S; id++) {
      const s = history.settlements[id]
      if (!s || s.cell < 0 || s.cell >= N) continue
      let m = 0
      if (pop && pop.length >= snaps * S) for (let k = 0; k < snaps; k++) m = Math.max(m, pop[k * S + id])
      if (m <= 0) continue
      const outpost = (s as { outpost?: boolean }).outpost === true
      // a town plan is ~0.002 across for a village, ~0.006 for a city (dioramas/town.ts)
      let flat = (outpost ? 0.0012 : 0.0018) + 0.0011 * Math.log10(Math.max(1, m / 100) + 1)
      let reach = flat * 1.6 + 0.0015
      if (!outpost) {
        // the town plan's own size at its peak (dioramas/footprint.ts): flat under nine in ten
        // of its buildings, easing out past the farthest it grows along its roads
        const fp = townFootprint(m)
        flat = Math.max(flat, fp.radius * 1.1)
        reach = Math.max(reach, fp.reach + 0.002)
      }
      siteList.push(P[s.cell * 3], P[s.cell * 3 + 1], P[s.cell * 3 + 2], flat, reach)
      siteCell.push(s.cell)
    }
  }
  const siteCount = siteList.length / 5
  const site = Float32Array.from(siteList)
  // per cell: sites within reach (centre cell, its neighbours and theirs)
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const lists: number[][] = []
  const push = (c: number, s: number) => (lists[c] ??= []).push(s)
  for (let s = 0; s < siteCount; s++) {
    const best = siteCell[s]
    const seen = new Set<number>([best])
    let ring = [best]
    push(best, s)
    for (let k = 0; k < 2; k++) {
      const next: number[] = []
      for (const a of ring) for (let j = off[a]; j < off[a + 1]; j++) {
        const b = nb[j]
        if (seen.has(b)) continue
        seen.add(b)
        next.push(b)
        push(b, s)
      }
      ring = next
    }
  }
  const siteOff = new Uint32Array(N + 1)
  for (let i = 0; i < N; i++) siteOff[i + 1] = siteOff[i] + (lists[i]?.length ?? 0)
  const siteIdx = new Uint32Array(siteOff[N])
  for (let i = 0; i < N; i++) if (lists[i]) siteIdx.set(lists[i], siteOff[i])
  f.features = { site, siteCount, siteOff, siteIdx }
  f.version++
  computeCellRadii(f)
}

// ---------- evaluation ----------

/** One evaluated ground point (written by evalGround). */
export interface GroundSample {
  /** Height (elevation units; radius 1 + RELIEF_NEAR * h). */
  h: number
  /** Signed elevation, linearly interpolated (the shader's coast contour field). */
  e: number
  /** Detail amplitude times wildness (what the per-pixel octaves are scaled by). */
  aw: number
  /** The detail displacement included in h (elevation units). */
  d: number
  /** Ridge sharpness, interpolated. */
  ridge: number
  /** Snow line, interpolated. */
  snow: number
  /** Geometric gradient of h (object space, tangential; per unit arc): base plus detail. */
  gx: number
  gy: number
  gz: number
  /** Unit direction of the point. */
  ux: number
  uy: number
  uz: number
}

export function newGroundSample(): GroundSample {
  return { h: 0, e: 0, aw: 0, d: 0, ridge: 0, snow: 0, gx: 0, gy: 0, gz: 0, ux: 0, uy: 1, uz: 0 }
}

/** Distance (object space) from p to segment ab, both on the unit sphere (chordal, locally planar). */
function segDist(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const vx = bx - ax, vy = by - ay, vz = bz - az
  const wx = px - ax, wy = py - ay, wz = pz - az
  const vv = vx * vx + vy * vy + vz * vz
  let t = vv > 0 ? (wx * vx + wy * vy + wz * vz) / vv : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const dx = wx - vx * t, dy = wy - vy * t, dz = wz - vz * t
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Wildness from point features (towns, rivers) around corners a, b, c at unit direction u. */
function featureWild(f: TerrainField, a: number, b: number, c: number, ux: number, uy: number, uz: number): number {
  let w = 1
  const { site, siteOff, siteIdx } = f.features
  const { river, riverOff, riverIdx } = f
  for (let q = 0; q < 3; q++) {
    const cell = q === 0 ? a : q === 1 ? b : c
    for (let k = siteOff[cell]; k < siteOff[cell + 1]; k++) {
      const s = siteIdx[k] * 5
      const dx = ux - site[s], dy = uy - site[s + 1], dz = uz - site[s + 2]
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const r1 = site[s + 4]
      if (d < r1) {
        const v = smooth(site[s + 3], r1, d)
        if (v < w) w = v
      }
    }
    // a river segment is listed under its cell and that cell's neighbours
    for (let k = riverOff[cell]; k < riverOff[cell + 1]; k++) {
      const s = riverIdx[k] * 7
      const hw = river[s + 6] + 0.0005
      const reach = hw * 2 + 0.0035
      // cheap reject on the first endpoint (segments are short, ~0.005)
      const ex = ux - river[s], ey = uy - river[s + 1], ez = uz - river[s + 2]
      if (ex * ex + ey * ey + ez * ez > (reach + 0.008) * (reach + 0.008)) continue
      const d = segDist(ux, uy, uz, river[s], river[s + 1], river[s + 2], river[s + 3], river[s + 4], river[s + 5])
      if (d < reach) {
        const v = smooth(hw, reach, d)
        if (v < w) w = v
      }
    }
  }
  return w
}

/**
 * Evaluates the ground at barycentrics (la, lb, lc) of the triangle with corner cells
 * (a, b, c), with `band` detail octaves (DETAIL_OCTAVES: all). Writes `out`.
 */
export function evalGround(f: TerrainField, a: number, b: number, c: number, la: number, lb: number, lc: number, band: number, out: GroundSample): void {
  const P = f.world.grid.positions
  const a3 = a * 3, b3 = b * 3, c3 = c * 3
  let ux = la * P[a3] + lb * P[b3] + lc * P[c3]
  let uy = la * P[a3 + 1] + lb * P[b3 + 1] + lc * P[c3 + 1]
  let uz = la * P[a3 + 2] + lb * P[b3 + 2] + lc * P[c3 + 2]
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1
  ux /= ul; uy /= ul; uz /= ul
  out.ux = ux; out.uy = uy; out.uz = uz
  const { eS, eL, grad: G, amp, ridge, wild, snowLine, coastSlope } = f
  const e = la * eS[a] + lb * eS[b] + lc * eS[c]
  out.e = e
  out.snow = la * snowLine[a] + lb * snowLine[b] + lc * snowLine[c]
  // Phong-curved land elevation: blend of the corners' tangent planes
  const ga = G[a3] * (ux - P[a3]) + G[a3 + 1] * (uy - P[a3 + 1]) + G[a3 + 2] * (uz - P[a3 + 2])
  const gb = G[b3] * (ux - P[b3]) + G[b3 + 1] * (uy - P[b3 + 1]) + G[b3 + 2] * (uz - P[b3 + 2])
  const gc = G[c3] * (ux - P[c3]) + G[c3 + 1] * (uy - P[c3 + 1]) + G[c3 + 2] * (uz - P[c3 + 2])
  let base = la * eL[a] + lb * eL[b] + lc * eL[c] + PHONG * (la * ga + lb * gb + lc * gc)
  if (base < 0) base = 0
  // the shader's coast contour (planetShaders.ts): the land starts at the drawn shore
  const coastAmp = Math.max(la * coastSlope[a] + lb * coastSlope[b] + lc * coastSlope[c], 0.01) * 1.7
  let ec = e
  if (Math.abs(e) < coastAmp * 1.25) {
    const r = 1 + RELIEF_NEAR * Math.max(0, base)
    ec += fbm(ux * r + 17, uy * r + 17, uz * r + 17, f.cellFreq * 0.6, 5) * coastAmp
  }
  const land = smooth(0, 0.035, ec)
  base *= land
  // smoothed gradient of the base (shading): interpolated corner gradients
  let gx = (la * G[a3] + lb * G[b3] + lc * G[c3]) * land
  let gy = (la * G[a3 + 1] + lb * G[b3 + 1] + lc * G[c3 + 1]) * land
  let gz = (la * G[a3 + 2] + lb * G[b3 + 2] + lc * G[c3 + 2]) * land
  const A = (la * amp[a] + lb * amp[b] + lc * amp[c]) * smooth(0.02, 0.1, ec)
  const rk = la * ridge[a] + lb * ridge[b] + lc * ridge[c]
  out.ridge = rk
  let d = 0, aw = 0
  if (A > 1e-5) {
    let w = la * wild[a] + lb * wild[b] + lc * wild[c]
    if (w > 0) w *= featureWild(f, a, b, c, ux, uy, uz)
    aw = A * w
    if (band > 0 && w > 0) {
      evalDetail(ux, uy, uz, f.detailFreq, rk, band)
      d = aw * detail.t
      gx += aw * detail.gx
      gy += aw * detail.gy
      gz += aw * detail.gz
    }
    d += A * (1 - w) * FLOOR
  }
  out.aw = aw
  out.d = d
  out.h = base + d
  // tangential part of the gradient
  const gu = gx * ux + gy * uy + gz * uz
  out.gx = gx - gu * ux
  out.gy = gy - gu * uy
  out.gz = gz - gu * uz
}

/** The located triangle of the last locate() call: corner cells and barycentrics. */
export const located = { a: 0, b: 0, c: 0, la: 1, lb: 0, lc: 0, cell: 0 }

/** Nearest cell centre to unit direction (x, y, z), walking greedily from `start`. */
export function nearestCellFrom(world: World, x: number, y: number, z: number, start: number): number {
  const { positions: P, neighborOffsets: off, neighbors: nb, cellCount } = world.grid
  let cur = start >= 0 && start < cellCount ? start : 0
  let best = P[cur * 3] * x + P[cur * 3 + 1] * y + P[cur * 3 + 2] * z
  for (let iter = 0; iter < 4096; iter++) {
    let next = -1
    for (let k = off[cur]; k < off[cur + 1]; k++) {
      const c = nb[k]
      const d = P[c * 3] * x + P[c * 3 + 1] * y + P[c * 3 + 2] * z
      if (d > best) {
        best = d
        next = c
      }
    }
    if (next < 0) break
    cur = next
  }
  return cur
}

function fanLocate(world: World, c: number, x: number, y: number, z: number): boolean {
  const { positions: P, neighborOffsets: off, neighbors: nb } = world.grid
  const ax = P[c * 3], ay = P[c * 3 + 1], az = P[c * 3 + 2]
  const n0 = off[c], n1 = off[c + 1]
  for (let k = n0; k < n1; k++) {
    const b = nb[k]
    const d = nb[k + 1 < n1 ? k + 1 : n0]
    const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2]
    const dx = P[d * 3], dy = P[d * 3 + 1], dz = P[d * 3 + 2]
    const wA = x * (by * dz - bz * dy) + y * (bz * dx - bx * dz) + z * (bx * dy - by * dx)
    const wB = x * (dy * az - dz * ay) + y * (dz * ax - dx * az) + z * (dx * ay - dy * ax)
    const wD = x * (ay * bz - az * by) + y * (az * bx - ax * bz) + z * (ax * by - ay * bx)
    if (wA < -1e-12 || wB < -1e-12 || wD < -1e-12) continue
    const s = wA + wB + wD
    if (s <= 0) continue
    located.a = c; located.b = b; located.c = d
    located.la = wA / s; located.lb = wB / s; located.lc = wD / s
    return true
  }
  return false
}

/** Finds the icosphere triangle under unit direction (x, y, z) (into `located`); false: fell back to the nearest cell. */
export function locate(world: World, x: number, y: number, z: number, start: number): boolean {
  const c = nearestCellFrom(world, x, y, z, start)
  located.cell = c
  if (fanLocate(world, c, x, y, z)) return true
  const { neighborOffsets: off, neighbors: nb } = world.grid
  for (let k = off[c]; k < off[c + 1]; k++) if (fanLocate(world, nb[k], x, y, z)) return true
  located.a = located.b = located.c = c
  located.la = 1; located.lb = located.lc = 0
  return false
}

const scratch = newGroundSample()

/** Ground height (h) at unit direction (x, y, z), full detail; `start` is a cell near it. */
export function groundHeightAt(world: World, x: number, y: number, z: number, start: number, out: GroundSample = scratch): number {
  const f = terrainOf(world)
  locate(world, x, y, z, start)
  evalGround(f, located.a, located.b, located.c, located.la, located.lb, located.lc, DETAIL_OCTAVES, out)
  return out.h
}

function computeCellRadii(f: TerrainField): void {
  const { cellCount: N, neighborOffsets: off, neighbors: nb, triangles } = f.world.grid
  const s = newGroundSample()
  // a corner of any of its triangles: evaluate with that triangle's corners
  const triOf = new Int32Array(N).fill(-1)
  for (let t = 0; t < triangles.length; t++) if (triOf[triangles[t]] < 0) triOf[triangles[t]] = t - (t % 3)
  const h = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const t = triOf[i]
    if (t < 0) { h[i] = f.eL[i]; continue }
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2]
    evalGround(f, a, b, c, a === i ? 1 : 0, b === i ? 1 : 0, c === i ? 1 : 0, DETAIL_OCTAVES, s)
    h[i] = s.h
    f.cellRadius[i] = 1 + RELIEF_NEAR * s.h
  }
  // bound over the fan: the highest corner nearby plus the largest detail crest there
  for (let i = 0; i < N; i++) {
    let m = f.eL[i] + f.amp[i] * 0.75
    for (let k = off[i]; k < off[i + 1]; k++) {
      const j = nb[k]
      m = Math.max(m, f.eL[j] + f.amp[j] * 0.75, h[j])
    }
    f.cellMaxRadius[i] = 1 + RELIEF_NEAR * Math.max(m, h[i])
  }
}

/** Rendered ground radius (at the zoom's relief) under unit direction (x, y, z) in planet space. */
export function renderedGroundRadius(world: World, x: number, y: number, z: number, start: number): number {
  return reliefRadius(1 + RELIEF_NEAR * groundHeightAt(world, x, y, z, start))
}
