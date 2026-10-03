// Small shared helpers: a deterministic binary min-heap and scalar utilities.

import type { SimGrid } from './grid.ts'

/**
 * Min-heap of (key, id) pairs. Ties on key break on smaller id, so pop order
 * is a pure function of the pushed pairs.
 */
export class MinHeap {
  keys: Float64Array
  ids: Int32Array
  size = 0

  constructor(capacity: number) {
    this.keys = new Float64Array(Math.max(16, capacity))
    this.ids = new Int32Array(Math.max(16, capacity))
  }

  private less(a: number, b: number): boolean {
    const ka = this.keys[a], kb = this.keys[b]
    return ka < kb || (ka === kb && this.ids[a] < this.ids[b])
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = k
    const v = this.ids[a]; this.ids[a] = this.ids[b]; this.ids[b] = v
  }

  push(key: number, id: number): void {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.keys.length * 2); k.set(this.keys); this.keys = k
      const v = new Int32Array(this.ids.length * 2); v.set(this.ids); this.ids = v
    }
    let i = this.size++
    this.keys[i] = key
    this.ids[i] = id
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(i, p)) break
      this.swap(i, p)
      i = p
    }
  }

  /** Key of the top element (call only when size > 0). */
  topKey(): number {
    return this.keys[0]
  }

  /** Removes the top element and returns its id (call only when size > 0). */
  pop(): number {
    const id = this.ids[0]
    const last = --this.size
    if (last > 0) {
      this.keys[0] = this.keys[last]
      this.ids[0] = this.ids[last]
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < last && this.less(l, m)) m = l
        if (r < last && this.less(r, m)) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return id
  }
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Compact bump: 1 at d = 0, 0 for |d| >= w, smooth (C1) in between. */
export function bump(d: number, w: number): number {
  const t = d / w
  if (t >= 1 || t <= -1) return 0
  const u = 1 - t * t
  return u * u
}

/**
 * Pass count giving the same blur radius (in radians) at this grid's
 * resolution as `passesAt48` passes give at n = 48 (radius ~ sqrt(passes) / n).
 */
export function scaledPasses(g: SimGrid, passesAt48: number): number {
  const s = 1 / g.cellScale
  return Math.max(1, Math.round(passesAt48 * s * s))
}

/** In-place neighbour-average blur: x <- (1 - a) x + a mean(neighbours), `passes` times. */
export function blur(g: SimGrid, field: Float64Array, passes: number, a = 0.5): void {
  const tmp = new Float64Array(field.length)
  const { neighborOffsets: off, neighbors: nb } = g
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < g.cellCount; i++) {
      let s = 0
      const o0 = off[i], o1 = off[i + 1]
      for (let k = o0; k < o1; k++) s += field[nb[k]]
      tmp[i] = (1 - a) * field[i] + (a * s) / (o1 - o0)
    }
    field.set(tmp)
  }
}
