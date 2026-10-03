// Icosphere cell graph: an icosahedron with each face subdivided at frequency
// n, vertices deduplicated (12 corners, 30 shared edges, 20 face interiors),
// projected to the unit sphere. cellCount = 10 n^2 + 2, triangleCount = 20 n^2.
//
// Orientation: +Y is north; a cell sits on each pole. Triangles wind
// counter-clockwise seen from outside the sphere. Each cell's neighbour list in
// the CSR adjacency is ordered counter-clockwise (seen from outside), starting
// at the lowest-index neighbour, so the dual (hex/pent) polygons can be built
// by walking it.

import type { Grid } from '../contract.ts'

export const DEFAULT_SUBDIVISIONS = 48

/** Grid plus float64 positions used internally by the sim. */
export interface SimGrid extends Grid {
  pos: Float64Array
  /** Subdivision frequency n. */
  n: number
  /** DEFAULT_SUBDIVISIONS / n: converts per-cell rates tuned at n = 48 to other resolutions. */
  cellScale: number
}

function baseIcosahedron(): { verts: Float64Array; faces: number[] } {
  // Pole, upper ring of 5, lower ring of 5 (rotated by pi/5), pole.
  const verts = new Float64Array(12 * 3)
  verts[0] = 0
  verts[1] = 1
  verts[2] = 0
  const ry = 1 / Math.sqrt(5)
  const rr = 2 / Math.sqrt(5)
  // cos/sin of multiples of 36 degrees in closed form (no trig: engine-independent).
  const s5 = Math.sqrt(5)
  const c1 = (1 + s5) / 4, s1 = Math.sqrt(10 - 2 * s5) / 4
  const c2 = (s5 - 1) / 4, s2 = Math.sqrt(10 + 2 * s5) / 4
  const COS = [1, c1, c2, -c2, -c1, -1, -c1, -c2, c2, c1]
  const SIN = [0, s1, s2, s2, s1, 0, -s1, -s2, -s2, -s1]
  for (let k = 0; k < 5; k++) {
    verts[(1 + k) * 3] = rr * COS[2 * k]
    verts[(1 + k) * 3 + 1] = ry
    verts[(1 + k) * 3 + 2] = rr * SIN[2 * k]
    verts[(6 + k) * 3] = rr * COS[2 * k + 1]
    verts[(6 + k) * 3 + 1] = -ry
    verts[(6 + k) * 3 + 2] = rr * SIN[2 * k + 1]
  }
  verts[33] = 0
  verts[34] = -1
  verts[35] = 0

  const faces: number[] = []
  for (let k = 0; k < 5; k++) {
    const u0 = 1 + k
    const u1 = 1 + ((k + 1) % 5)
    const l0 = 6 + k
    const l1 = 6 + ((k + 1) % 5)
    faces.push(0, u0, u1)
    faces.push(u0, l0, u1)
    faces.push(u1, l0, l1)
    faces.push(l0, 11, l1)
  }
  // Fix winding so every face is CCW from outside (normal . centroid > 0).
  for (let f = 0; f < 20; f++) {
    const a = faces[f * 3] * 3
    const b = faces[f * 3 + 1] * 3
    const c = faces[f * 3 + 2] * 3
    const abx = verts[b] - verts[a], aby = verts[b + 1] - verts[a + 1], abz = verts[b + 2] - verts[a + 2]
    const acx = verts[c] - verts[a], acy = verts[c + 1] - verts[a + 1], acz = verts[c + 2] - verts[a + 2]
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    const d = nx * (verts[a] + verts[b] + verts[c]) + ny * (verts[a + 1] + verts[b + 1] + verts[c + 1]) + nz * (verts[a + 2] + verts[b + 2] + verts[c + 2])
    if (d < 0) {
      const t = faces[f * 3 + 1]
      faces[f * 3 + 1] = faces[f * 3 + 2]
      faces[f * 3 + 2] = t
    }
  }
  return { verts, faces }
}

export function buildGrid(n: number = DEFAULT_SUBDIVISIONS): SimGrid {
  if (!Number.isInteger(n) || n < 1) throw new Error(`subdivisions must be a positive integer, got ${n}`)
  const { verts, faces } = baseIcosahedron()
  const cellCount = 10 * n * n + 2
  const pos = new Float64Array(cellCount * 3)
  const written = new Uint8Array(cellCount)

  // Edge table: edge (lo, hi) of the base icosahedron -> base index of its n-1 interior points.
  const edgeBase = new Int32Array(12 * 12).fill(-1)
  let next = 12
  for (let f = 0; f < 20; f++) {
    for (let e = 0; e < 3; e++) {
      const a = faces[f * 3 + e]
      const b = faces[f * 3 + ((e + 1) % 3)]
      const lo = a < b ? a : b
      const hi = a < b ? b : a
      if (edgeBase[lo * 12 + hi] < 0) {
        edgeBase[lo * 12 + hi] = next
        next += n - 1
      }
    }
  }
  // Point t steps (0 < t < n) along base edge u->v.
  const edgePoint = (u: number, v: number, t: number): number => {
    if (u < v) return edgeBase[u * 12 + v] + t - 1
    return edgeBase[v * 12 + u] + (n - t) - 1
  }

  const interiorPerFace = ((n - 1) * (n - 2)) / 2
  const faceInteriorBase = next
  const triangles = new Uint32Array(20 * n * n * 3)
  let tri = 0
  const rowIdx = new Int32Array((n + 1) * (n + 1))

  for (let f = 0; f < 20; f++) {
    const A = faces[f * 3]
    const B = faces[f * 3 + 1]
    const C = faces[f * 3 + 2]
    const ax = verts[A * 3], ay = verts[A * 3 + 1], az = verts[A * 3 + 2]
    const bx = verts[B * 3], by = verts[B * 3 + 1], bz = verts[B * 3 + 2]
    const cx = verts[C * 3], cy = verts[C * 3 + 1], cz = verts[C * 3 + 2]
    let interior = faceInteriorBase + f * interiorPerFace
    // Barycentric lattice: i steps along AB, j along AC.
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j + i <= n; j++) {
        const k = n - i - j
        let idx: number
        if (i === 0 && j === 0) idx = A
        else if (i === n) idx = B
        else if (j === n) idx = C
        else if (j === 0) idx = edgePoint(A, B, i)
        else if (i === 0) idx = edgePoint(A, C, j)
        else if (k === 0) idx = edgePoint(B, C, j)
        else idx = interior++
        rowIdx[i * (n + 1) + j] = idx
        if (!written[idx]) {
          written[idx] = 1
          let x: number, y: number, z: number
          // Compute shared points from their canonical owner so they are identical.
          if (idx < 12) {
            x = verts[idx * 3]; y = verts[idx * 3 + 1]; z = verts[idx * 3 + 2]
          } else {
            const wa = k / n, wb = i / n, wc = j / n
            x = ax * wa + bx * wb + cx * wc
            y = ay * wa + by * wb + cy * wc
            z = az * wa + bz * wb + cz * wc
          }
          const inv = 1 / Math.sqrt(x * x + y * y + z * z)
          pos[idx * 3] = x * inv
          pos[idx * 3 + 1] = y * inv
          pos[idx * 3 + 2] = z * inv
        }
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j + i < n; j++) {
        const p00 = rowIdx[i * (n + 1) + j]
        const p10 = rowIdx[(i + 1) * (n + 1) + j]
        const p01 = rowIdx[i * (n + 1) + j + 1]
        triangles[tri++] = p00
        triangles[tri++] = p10
        triangles[tri++] = p01
        if (i + j < n - 1) {
          const p11 = rowIdx[(i + 1) * (n + 1) + j + 1]
          triangles[tri++] = p10
          triangles[tri++] = p11
          triangles[tri++] = p01
        }
      }
    }
  }

  // Edge points are shared by two faces and written by whichever face came
  // first; the interpolation along a shared edge is symmetric up to rounding,
  // so recompute every edge point canonically (lo -> hi) to be safe.
  for (let lo = 0; lo < 12; lo++) {
    for (let hi = lo + 1; hi < 12; hi++) {
      const base = edgeBase[lo * 12 + hi]
      if (base < 0) continue
      for (let t = 1; t < n; t++) {
        const w = t / n
        const x = verts[lo * 3] * (1 - w) + verts[hi * 3] * w
        const y = verts[lo * 3 + 1] * (1 - w) + verts[hi * 3 + 1] * w
        const z = verts[lo * 3 + 2] * (1 - w) + verts[hi * 3 + 2] * w
        const inv = 1 / Math.sqrt(x * x + y * y + z * z)
        const idx = base + t - 1
        pos[idx * 3] = x * inv
        pos[idx * 3 + 1] = y * inv
        pos[idx * 3 + 2] = z * inv
      }
    }
  }

  const { neighborOffsets, neighbors } = buildAdjacency(cellCount, triangles)
  const positions = new Float32Array(pos)
  return { cellCount, positions, triangles, neighborOffsets, neighbors, pos, n, cellScale: DEFAULT_SUBDIVISIONS / n }
}

/**
 * CSR adjacency from a closed, consistently wound triangle mesh. Each ring is
 * ordered CCW around the cell by walking the triangle fan (purely topological,
 * no floating point), starting from the lowest-index neighbour.
 */
function buildAdjacency(cellCount: number, triangles: Uint32Array): { neighborOffsets: Uint32Array; neighbors: Uint32Array } {
  const triCount = triangles.length / 3
  // For a closed manifold triangle mesh, valence = number of incident triangles.
  const deg = new Uint32Array(cellCount)
  for (let t = 0; t < triCount * 3; t++) deg[triangles[t]]++
  const neighborOffsets = new Uint32Array(cellCount + 1)
  for (let i = 0; i < cellCount; i++) neighborOffsets[i + 1] = neighborOffsets[i] + deg[i]
  // For each cell, store the (a, b) pairs of incident CCW triangles (cell, a, b).
  const pairA = new Uint32Array(neighborOffsets[cellCount])
  const pairB = new Uint32Array(neighborOffsets[cellCount])
  const fill = new Uint32Array(cellCount)
  for (let t = 0; t < triCount; t++) {
    const v0 = triangles[t * 3], v1 = triangles[t * 3 + 1], v2 = triangles[t * 3 + 2]
    let s = neighborOffsets[v0] + fill[v0]++
    pairA[s] = v1; pairB[s] = v2
    s = neighborOffsets[v1] + fill[v1]++
    pairA[s] = v2; pairB[s] = v0
    s = neighborOffsets[v2] + fill[v2]++
    pairA[s] = v0; pairB[s] = v1
  }
  const neighbors = new Uint32Array(neighborOffsets[cellCount])
  for (let i = 0; i < cellCount; i++) {
    const o = neighborOffsets[i]
    const d = deg[i]
    let start = pairA[o]
    for (let k = 1; k < d; k++) if (pairA[o + k] < start) start = pairA[o + k]
    let cur = start
    for (let k = 0; k < d; k++) {
      neighbors[o + k] = cur
      // Next neighbour CCW: the triangle (i, cur, b) gives b.
      let found = -1
      for (let m = 0; m < d; m++) {
        if (pairA[o + m] === cur) { found = pairB[o + m]; break }
      }
      if (found < 0) throw new Error(`non-manifold grid at cell ${i}`)
      cur = found
    }
    if (cur !== start) throw new Error(`open fan at cell ${i}`)
  }
  return { neighborOffsets, neighbors }
}

/** Mean distance between adjacent cells (~radians). */
export function meanEdgeLength(g: SimGrid): number {
  let sum = 0
  let cnt = 0
  const { pos, neighborOffsets, neighbors } = g
  for (let i = 0; i < g.cellCount; i++) {
    for (let k = neighborOffsets[i]; k < neighborOffsets[i + 1]; k++) {
      const j = neighbors[k]
      sum += cellDistance(pos, i, j)
      cnt++
    }
  }
  return sum / cnt
}

/** Chord distance between cells i and j (~= great-circle angle for neighbours). */
export function cellDistance(pos: Float64Array, i: number, j: number): number {
  const dx = pos[i * 3] - pos[j * 3]
  const dy = pos[i * 3 + 1] - pos[j * 3 + 1]
  const dz = pos[i * 3 + 2] - pos[j * 3 + 2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
