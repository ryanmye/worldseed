// Where exactly the rendered ground is. The globe is a flat-shaded triangulation of
// the cell centres lifted to surfaceRadius (see globe.ts), so a model placed between
// cell centres must sit on the plane of the triangle under it, not on a sphere.
// probe() casts a ray from the planet centre through a unit direction and returns the
// hit radius, the triangle's outward normal and the barycentric blend of elevation and
// the lake flag there (to keep models out of the sea and lakes).

import type { World } from '../../contract.ts'
import { lakeArray, surfaceRadius } from '../globe.ts'

export interface Probe {
  /** Distance of the ground from the planet centre along the probed direction. */
  radius: number
  /** Outward normal of the ground triangle. */
  nx: number
  ny: number
  nz: number
  /** Elevation blended over the triangle (negative over the sea). */
  elev: number
  /** Lake flag blended over the triangle (0..1). */
  lake: number
  /** Nearest cell. */
  cell: number
}

export interface Surface {
  /** Probe the ground along unit direction (x, y, z); `start` is a cell near it. False if no triangle was found. */
  probe(x: number, y: number, z: number, start: number, out: Probe): boolean
  /** Nearest cell to unit direction (x, y, z), walking greedily from `start`. */
  nearestCell(x: number, y: number, z: number, start: number): number
  /**
   * Whether the planet shader draws sea or lake water at the point last probed (or
   * within `margin` of its shore, in units of the local coast noise amplitude). This
   * replays the shader's noisy coast and lake contours on the CPU (see globe.ts).
   */
  wet(p: Probe, margin: number): boolean
}

/** `reservoir`: per-cell reservoir strength (0 = none), the fill the planet shader floods behind dams. */
export function createSurface(world: World, reservoir: Float32Array | null = null): Surface {
  const { positions: P, neighborOffsets: off, neighbors: nb } = world.grid
  const lake = lakeArray(world)
  const E = world.elevation

  const nearestCell = (x: number, y: number, z: number, start: number): number => {
    let cur = start
    let best = P[cur * 3] * x + P[cur * 3 + 1] * y + P[cur * 3 + 2] * z
    for (let iter = 0; iter < 64; iter++) {
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

  // per-cell inputs of the shader's coast noise: mean elevation step to the neighbours,
  // quantised like the vertex attribute (aSeed.w), and the lake flag
  const { cellCount } = world.grid
  const slope = new Float32Array(cellCount)
  for (let i = 0; i < cellCount; i++) {
    let sum = 0
    for (let k = off[i]; k < off[i + 1]; k++) sum += Math.abs(E[nb[k]] - E[i])
    const q = Math.min(255, Math.round((sum / Math.max(1, off[i + 1] - off[i])) * 2 * 255))
    slope[i] = (q / 255) * 0.5
  }
  const cellFreq = 1 / Math.sqrt((4 * Math.PI) / cellCount)
  const tri = { a: 0, b: 0, d: 0, la: 0, lb: 0, ld: 0, x: 0, y: 0, z: 0 }

  /** Tests the fan of triangles around cell c; fills out on a hit. */
  const fan = (c: number, x: number, y: number, z: number, out: Probe): boolean => {
    const ra = surfaceRadius(world, c)
    const ax = P[c * 3] * ra, ay = P[c * 3 + 1] * ra, az = P[c * 3 + 2] * ra
    const n0 = off[c], n1 = off[c + 1]
    for (let k = n0; k < n1; k++) {
      const b = nb[k]
      const d = nb[k + 1 < n1 ? k + 1 : n0]
      const rb = surfaceRadius(world, b), rd = surfaceRadius(world, d)
      const bx = P[b * 3] * rb, by = P[b * 3 + 1] * rb, bz = P[b * 3 + 2] * rb
      const dx = P[d * 3] * rd, dy = P[d * 3 + 1] * rd, dz = P[d * 3 + 2] * rd
      // signed volumes of (u, edge) wedges: all >= 0 inside (triangle a, b, d is CCW from outside)
      const wA = x * (by * dz - bz * dy) + y * (bz * dx - bx * dz) + z * (bx * dy - by * dx) // u . (B x D)
      const wB = x * (dy * az - dz * ay) + y * (dz * ax - dx * az) + z * (dx * ay - dy * ax) // u . (D x A)
      const wD = x * (ay * bz - az * by) + y * (az * bx - ax * bz) + z * (ax * by - ay * bx) // u . (A x B)
      if (wA < -1e-12 || wB < -1e-12 || wD < -1e-12) continue
      const s = wA + wB + wD
      if (s <= 0) continue
      const la = wA / s, lb = wB / s, ld = wD / s
      const hx = la * ax + lb * bx + ld * dx, hy = la * ay + lb * by + ld * dy, hz = la * az + lb * bz + ld * dz
      out.radius = Math.hypot(hx, hy, hz)
      // normal of the triangle (B - A) x (D - A)
      const ux = bx - ax, uy = by - ay, uz = bz - az
      const vx = dx - ax, vy = dy - ay, vz = dz - az
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      const l = Math.hypot(nx, ny, nz) || 1
      const sgn = nx * x + ny * y + nz * z < 0 ? -1 : 1
      nx *= sgn / l; ny *= sgn / l; nz *= sgn / l
      out.nx = nx; out.ny = ny; out.nz = nz
      out.elev = la * E[c] + lb * E[b] + ld * E[d]
      out.lake = lake ? la * lake[c] + lb * lake[b] + ld * lake[d] : 0
      out.cell = c
      tri.a = c; tri.b = b; tri.d = d
      tri.la = la; tri.lb = lb; tri.ld = ld
      tri.x = hx; tri.y = hy; tri.z = hz
      return true
    }
    return false
  }

  return {
    nearestCell,
    probe(x, y, z, start, out) {
      const c = nearestCell(x, y, z, start)
      if (fan(c, x, y, z, out)) return true
      for (let k = off[c]; k < off[c + 1]; k++) if (fan(nb[k], x, y, z, out)) return true
      out.radius = surfaceRadius(world, c)
      out.nx = x; out.ny = y; out.nz = z
      out.elev = E[c]
      out.lake = lake ? lake[c] : 0
      out.cell = c
      tri.a = tri.b = tri.d = c
      tri.la = 1; tri.lb = tri.ld = 0
      tri.x = x * out.radius; tri.y = y * out.radius; tri.z = z * out.radius
      return false
    },
    wet(p: Probe, margin: number) {
      const { a, b, d, la, lb, ld } = tri
      // sea: the zero contour of interpolated elevation, pushed around by noise scaled to the slope
      const amp = Math.max(la * slope[a] + lb * slope[b] + ld * slope[d], 0.01) * 1.7
      let e = p.elev
      if (Math.abs(e) < amp * 1.25 + margin * amp) e += fbm(tri.x + 17, tri.y + 17, tri.z + 17, cellFreq * 0.6, 5) * amp
      if (e < margin * amp) return true
      if (reservoir && (reservoir[a] > 0 || reservoir[b] > 0 || reservoir[d] > 0)) {
        // the reservoir contour at its fullest (planetShaders.ts: resLin - 0.6 + 0.16 fbm)
        const f = la * reservoir[a] + lb * reservoir[b] + ld * reservoir[d] - 0.6 + 0.16 * fbm(tri.x + 37, tri.y + 37, tri.z + 37, cellFreq * 1.6, 4)
        if (f > -0.12 * margin - 0.03) return true
      }
      if (lake && (lake[a] | lake[b] | lake[d])) {
        const f = la * lake[a] + lb * lake[b] + ld * lake[d] - 0.5 + 0.55 * fbm(tri.x + 29, tri.y + 29, tri.z + 29, cellFreq * 0.6, 5)
        if (f > -0.12 * margin - 0.04) return true
      }
      return false
    },
  }
}

// ---------- the shader's gradient noise (glsl.ts), value only ----------

const fract = (v: number) => v - Math.floor(v)
const G = new Float64Array(3)
function hash33(px: number, py: number, pz: number) {
  px = fract(px * 0.1031)
  py = fract(py * 0.103)
  pz = fract(pz * 0.0973)
  const dd = px * (py + 33.33) + py * (px + 33.33) + pz * (pz + 33.33)
  px += dd
  py += dd
  pz += dd
  G[0] = -1 + 2 * fract((px + py) * pz)
  G[1] = -1 + 2 * fract((px + px) * py)
  G[2] = -1 + 2 * fract((py + px) * px)
}

function noise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const fx = x - ix, fy = y - iy, fz = z - iz
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
  const corner = (dx: number, dy: number, dz: number) => {
    hash33(ix + dx, iy + dy, iz + dz)
    return G[0] * (fx - dx) + G[1] * (fy - dy) + G[2] * (fz - dz)
  }
  const va = corner(0, 0, 0), vb = corner(1, 0, 0), vc = corner(0, 1, 0), vd = corner(1, 1, 0)
  const ve = corner(0, 0, 1), vf = corner(1, 0, 1), vg = corner(0, 1, 1), vh = corner(1, 1, 1)
  return va + ux * (vb - va) + uy * (vc - va) + uz * (ve - va)
    + ux * uy * (va - vb - vc + vd) + uy * uz * (va - vc - ve + vg)
    + uz * ux * (va - vb - ve + vf) + ux * uy * uz * (-va + vb + vc - vd + ve - vf - vg + vh)
}

/** ws_fbm at full detail (the close-up view resolves every octave). */
function fbm(x: number, y: number, z: number, freq: number, octaves: number): number {
  let sum = 0
  let amp = 0.5
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq, z * freq)
    freq *= 2.03
    amp *= 0.5
  }
  return sum * 2
}

/** 32-bit integer hash of up to four integers (deterministic, well mixed). */
export function hash4(a: number, b: number, c: number, d: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d) ^ Math.imul(d | 0, 0x27d4eb2f)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return h >>> 0
}

/** Uniform in [0, 1) from hash4. */
export function rand4(a: number, b: number, c: number, d: number): number {
  return hash4(a, b, c, d) / 4294967296
}
