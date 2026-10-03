// Smooth curves along cell paths, shared by the trade layer (the same approach as the
// journey trails in journeys.ts, factored out so trade routes and settler routes look
// alike without touching that layer).
//
// A cell path on the hex grid drawn cell to cell runs in three fixed directions; instead
// each path becomes a centripetal Catmull-Rom curve through a decimated subset of its
// cells (every KNOT_STRIDE-th, both cells of every land/sea transition, and the
// endpoints). Each stretch between two knots is checked against the grid: a land stretch
// whose curve strays over water (a bay), or a sea stretch that strays over land (a cape),
// gets the skipped cells back as knots until it fits. Every sample records whether it
// lies over water, so land legs stay on land and sea legs at sea.

import * as THREE from 'three'
import type { World } from '../contract.ts'
import { isWaterCell, lakeArray, surfaceRadius } from './globe.ts'

const KNOT_STRIDE = 3
const SAMPLES_PER_CELL = 3

export interface PathSamples {
  /** Paths in the input. */
  count: number
  /** Samples of path i are [offsets[i], offsets[i + 1]); fewer than 2 means nothing to draw. */
  offsets: Uint32Array
  /** xyz per sample, `lift` above the ground. */
  pos: Float32Array
  /** Unit sideways direction per sample (in the tangent plane, perpendicular to the curve). */
  side: Float32Array
  /** Arc length from the path start (world units) per sample. */
  arc: Float32Array
  /** arc / total length per sample. */
  frac: Float32Array
  /** 1 where the sample lies over water. */
  water: Uint8Array
  /** Total arc length per path. */
  length: Float32Array
}

/** Centripetal Catmull-Rom (alpha 0.5) between p1 and p2 at u in [0, 1]. */
function centripetal(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, u: number, out: THREE.Vector3) {
  const t1 = Math.sqrt(Math.max(p0.distanceTo(p1), 1e-9))
  const t2 = t1 + Math.sqrt(Math.max(p1.distanceTo(p2), 1e-9))
  const t3 = t2 + Math.sqrt(Math.max(p2.distanceTo(p3), 1e-9))
  const t = t1 + (t2 - t1) * u
  const lerp = (a: number, b: number, ta: number, tb: number) => ((tb - t) / (tb - ta)) * a + ((t - ta) / (tb - ta)) * b
  const coord = (a: number, b: number, c: number, d: number) => {
    const A1 = lerp(a, b, 0, t1), A2 = lerp(b, c, t1, t2), A3 = lerp(c, d, t2, t3)
    const B1 = lerp(A1, A2, 0, t2), B2 = lerp(A2, A3, t1, t3)
    return lerp(B1, B2, t1, t2)
  }
  return out.set(coord(p0.x, p1.x, p2.x, p3.x), coord(p0.y, p1.y, p2.y, p3.y), coord(p0.z, p1.z, p2.z, p3.z))
}

/** Smoothed samples of the paths path[offsets[i] .. offsets[i + 1]). */
export function smoothPaths(world: World, pathOffsets: Uint32Array, path: Uint32Array, count: number, lift: number): PathSamples {
  const P = world.grid.positions
  const nbOff = world.grid.neighborOffsets
  const nbList = world.grid.neighbors
  const cellCount = world.grid.cellCount
  const lake = lakeArray(world)
  const knots: number[] = []
  const tmpKnots: number[] = []
  const ka = new THREE.Vector3(), kb = new THREE.Vector3(), kc = new THREE.Vector3(), kd = new THREE.Vector3()
  const q = new THREE.Vector3(), t = new THREE.Vector3()
  const unit = (cell: number, out: THREE.Vector3) => out.set(P[cell * 3], P[cell * 3 + 1], P[cell * 3 + 2])
  const isWater = (cell: number) => isWaterCell(world, lake, cell)

  function curvePoint(p0: number, i0: number, i1: number, i2: number, i3: number, u: number, out: THREE.Vector3) {
    unit(path[p0 + i1], kb)
    unit(path[p0 + i2], kc)
    if (i0 >= 0) unit(path[p0 + i0], ka)
    else ka.copy(kb).multiplyScalar(2).sub(kc)
    if (i3 >= 0) unit(path[p0 + i3], kd)
    else kd.copy(kc).multiplyScalar(2).sub(kb)
    centripetal(ka, kb, kc, kd, u, out)
    return out.normalize()
  }

  function nearestCell(v: THREE.Vector3, start: number): number {
    let cur = start
    let best = P[cur * 3] * v.x + P[cur * 3 + 1] * v.y + P[cur * 3 + 2] * v.z
    for (let iter = 0; iter < 64; iter++) {
      let next = -1
      for (let k = nbOff[cur]; k < nbOff[cur + 1]; k++) {
        const c = nbList[k]
        const d = P[c * 3] * v.x + P[c * 3 + 1] * v.y + P[c * 3 + 2] * v.z
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

  const samplesOf = (span: number) => Math.max(2, span * SAMPLES_PER_CELL)

  function chooseKnots(p0: number, n: number) {
    knots.length = 0
    let last = 0
    knots.push(0)
    for (let k = 1; k < n; k++) {
      const transition = isWater(path[p0 + k]) !== isWater(path[p0 + k - 1])
      const before = k + 1 < n && isWater(path[p0 + k + 1]) !== isWater(path[p0 + k])
      if (k === n - 1 || transition || before || k - last >= KNOT_STRIDE) {
        knots.push(k)
        last = k
      }
    }
    for (let round = 0; round < 6; round++) {
      let changed = false
      tmpKnots.length = 0
      for (let i = 0; i + 1 < knots.length; i++) {
        tmpKnots.push(knots[i])
        const i1 = knots[i], i2 = knots[i + 1]
        if (i2 - i1 < 2) continue
        const w = isWater(path[p0 + i1])
        const m = samplesOf(i2 - i1)
        let ok = true
        for (let s = 1; s < m && ok; s++) {
          const u = s / m
          curvePoint(p0, i > 0 ? knots[i - 1] : -1, i1, i2, i + 2 < knots.length ? knots[i + 2] : -1, u, q)
          const guess = path[p0 + Math.min(i2, i1 + Math.round(u * (i2 - i1)))]
          if (isWater(nearestCell(q, guess)) !== w) ok = false
        }
        if (!ok) {
          if (i2 - i1 <= 3) for (let k = i1 + 1; k < i2; k++) tmpKnots.push(k)
          else tmpKnots.push((i1 + i2) >> 1)
          changed = true
        }
      }
      tmpKnots.push(knots[knots.length - 1])
      knots.length = 0
      for (const k of tmpKnots) knots.push(k)
      if (!changed) break
    }
  }

  const validPath = (p0: number, p1: number) => {
    for (let k = p0; k < p1; k++) if (path[k] >= cellCount) return false
    return true
  }

  let cap = 0
  for (let j = 0; j < count; j++) {
    const n = pathOffsets[j + 1] - pathOffsets[j]
    if (n >= 2) cap += (n - 1) * SAMPLES_PER_CELL + 1
  }
  const sPos = new Float32Array(cap * 3)
  const sSide = new Float32Array(cap * 3)
  const sFrac = new Float32Array(cap)
  const sArc = new Float32Array(cap)
  const sWater = new Uint8Array(cap)
  const length = new Float32Array(count)
  const offsets = new Uint32Array(count + 1)
  let ns = 0

  for (let j = 0; j < count; j++) {
    offsets[j] = ns
    const p0 = pathOffsets[j], p1 = pathOffsets[j + 1]
    const n = p1 - p0
    if (n < 2 || !validPath(p0, p1)) continue
    chooseKnots(p0, n)
    let cell = path[p0]
    for (let i = 0; i + 1 < knots.length; i++) {
      const i1 = knots[i], i2 = knots[i + 1]
      const r1 = surfaceRadius(world, path[p0 + i1]), r2 = surfaceRadius(world, path[p0 + i2])
      const m = samplesOf(i2 - i1)
      const lastPiece = i + 2 === knots.length
      for (let s = 0; s < m + (lastPiece ? 1 : 0); s++) {
        const u = s / m
        curvePoint(p0, i > 0 ? knots[i - 1] : -1, i1, i2, i + 2 < knots.length ? knots[i + 2] : -1, u, q)
        cell = nearestCell(q, cell)
        const w = u === 0 ? isWater(path[p0 + i1]) : u === 1 ? isWater(path[p0 + i2]) : isWater(cell)
        const r = r1 + (r2 - r1) * u + lift
        sPos[ns * 3] = q.x * r
        sPos[ns * 3 + 1] = q.y * r
        sPos[ns * 3 + 2] = q.z * r
        sWater[ns] = w ? 1 : 0
        ns++
      }
    }
    const s0 = offsets[j]
    for (let s = s0; s < ns; s++) {
      const a = Math.max(s0, s - 1), b = Math.min(ns - 1, s + 1)
      t.set(sPos[b * 3] - sPos[a * 3], sPos[b * 3 + 1] - sPos[a * 3 + 1], sPos[b * 3 + 2] - sPos[a * 3 + 2])
      q.set(sPos[s * 3], sPos[s * 3 + 1], sPos[s * 3 + 2]).normalize()
      t.crossVectors(q, t).normalize()
      sSide[s * 3] = t.x
      sSide[s * 3 + 1] = t.y
      sSide[s * 3 + 2] = t.z
    }
    let len = 0
    sArc[s0] = 0
    for (let s = s0 + 1; s < ns; s++) {
      len += Math.hypot(sPos[s * 3] - sPos[s * 3 - 3], sPos[s * 3 + 1] - sPos[s * 3 - 2], sPos[s * 3 + 2] - sPos[s * 3 - 1])
      sArc[s] = len
    }
    for (let s = s0; s < ns; s++) sFrac[s] = len > 0 ? sArc[s] / len : (s - s0) / Math.max(1, ns - 1 - s0)
    length[j] = len
  }
  offsets[count] = ns
  return { count, offsets, pos: sPos, side: sSide, arc: sArc, frac: sFrac, water: sWater, length }
}
