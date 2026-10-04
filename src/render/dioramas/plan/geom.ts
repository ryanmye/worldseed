// Plane geometry for the town plans (town.ts): convex polygons as flat xy arrays (CCW) with
// a tag per edge, Sutherland-Hodgman clipping, insetting by per-edge street widths, and the
// lot and ward cutters.
//
// Portions ported from TownGeneratorOS by Oleg Dolya (watabou), GPL-3.0,
// https://github.com/watabou/TownGeneratorOS : the alley cutter (Ward.createAlleys with
// Cutter.bisect and Polygon.cut's gap), the radial cut of parks (Cutter.radial), the ring
// cut of temple closes (Cutter.ring), vertex smoothing (Polygon.smoothVertex) and
// compactness (Polygon.compactness). Watabou's polygons are arrays of shared Point objects
// and its randomness a global generator; here they are flat arrays, the cuts are half-plane
// clips that carry each edge's tag through, every random draw comes from the caller's
// seeded hash, and the recursion is an explicit stack.

/** A polygon (flat xy, CCW) and a tag per edge i (p[i] -> p[i+1]): a neighbouring patch, -1 the outer bound, -2 a lot cut. */
export interface Poly {
  p: number[]
  t: number[]
}

/** Tag of an edge made by a cut inside a block. */
export const CUT = -2

/** Keep the part with a*x + b*y <= c; the new edge gets `tag`. */
export function clip(poly: Poly, a: number, b: number, c: number, tag: number): Poly {
  const { p, t } = poly
  const n = p.length / 2
  const out: number[] = []
  const ot: number[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const x0 = p[i * 2], y0 = p[i * 2 + 1], x1 = p[j * 2], y1 = p[j * 2 + 1]
    const d0 = a * x0 + b * y0 - c, d1 = a * x1 + b * y1 - c
    if (d0 <= 0) {
      out.push(x0, y0)
      if (d1 > 0) {
        const s = d0 / (d0 - d1)
        out.push(x0 + (x1 - x0) * s, y0 + (y1 - y0) * s)
        ot.push(t[i], tag)
      } else ot.push(t[i])
    } else if (d1 <= 0) {
      const s = d0 / (d0 - d1)
      out.push(x0 + (x1 - x0) * s, y0 + (y1 - y0) * s)
      ot.push(t[i])
    }
  }
  // the edge tags pair up with the points: point k starts edge k
  const m = out.length / 2
  if (ot.length !== m) {
    ot.length = Math.min(ot.length, m)
    while (ot.length < m) ot.push(CUT)
  }
  return { p: out, t: ot }
}

export function area(p: number[]): number {
  let s = 0
  const n = p.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    s += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]
  }
  return s / 2
}

export function perimeter(p: number[]): number {
  let s = 0
  const n = p.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    s += Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1])
  }
  return s
}

/** 1 for a circle, 0.79 a square, 0.6 a triangle (Watabou's Polygon.compactness). */
export function compactness(p: number[]): number {
  const l = perimeter(p)
  return l > 0 ? (4 * Math.PI * Math.abs(area(p))) / (l * l) : 0
}

export function centroid(p: number[], out: number[]) {
  let cx = 0, cy = 0, a = 0
  const n = p.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const cr = p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]
    a += cr
    cx += (p[i * 2] + p[j * 2]) * cr
    cy += (p[i * 2 + 1] + p[j * 2 + 1]) * cr
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sy = 0
    for (let i = 0; i < n; i++) { sx += p[i * 2]; sy += p[i * 2 + 1] }
    out[0] = sx / Math.max(1, n)
    out[1] = sy / Math.max(1, n)
    return
  }
  out[0] = cx / (3 * a)
  out[1] = cy / (3 * a)
}

/** Distance from (cx, cy) along unit (dx, dy) to the boundary of convex p. */
export function rayExtent(p: number[], cx: number, cy: number, dx: number, dy: number): number {
  let best = Infinity
  const n = p.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ex = p[j * 2] - p[i * 2], ey = p[j * 2 + 1] - p[i * 2 + 1]
    // outward normal of a CCW edge: (ey, -ex)
    const nx = ey, ny = -ex
    const den = nx * dx + ny * dy
    if (den <= 1e-12) continue
    const s = (nx * (p[i * 2] - cx) + ny * (p[i * 2 + 1] - cy)) / den
    if (s >= 0 && s < best) best = s
  }
  return best
}

/** Inset convex p: edge i moves inward by w[i] (Watabou's Polygon.shrink, as half-plane clips that keep the tags). */
export function inset(poly: Poly, w: number[]): Poly | null {
  let q: Poly = { p: poly.p.slice(), t: poly.t.slice() }
  const n = poly.p.length / 2
  for (let i = 0; i < n; i++) {
    if (w[i] <= 0) continue
    const j = (i + 1) % n
    const x0 = poly.p[i * 2], y0 = poly.p[i * 2 + 1], x1 = poly.p[j * 2], y1 = poly.p[j * 2 + 1]
    const ex = x1 - x0, ey = y1 - y0
    const l = Math.hypot(ex, ey)
    if (l < 1e-9) continue
    // outward normal (ey, -ex)/l; keep o . p <= o . p0 - w
    const ox = ey / l, oy = -ex / l
    q = clip(q, ox, oy, ox * x0 + oy * y0 - w[i], poly.t[i])
    if (q.p.length < 6) return null
  }
  return q
}

/** Whether (x, y) is inside convex CCW polygon p (with margin m inside every edge). */
export function insideConvex(p: number[], x: number, y: number, m: number): boolean {
  const n = p.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ex = p[j * 2] - p[i * 2], ey = p[j * 2 + 1] - p[i * 2 + 1]
    const l = Math.hypot(ex, ey)
    if (l < 1e-9) continue
    // left of a CCW edge is inside
    if ((ex * (y - p[i * 2 + 1]) - ey * (x - p[i * 2])) / l < m) return false
  }
  return true
}

/** Distance from (x, y) to the line through (ax, ay) along (dx, dy). */
export function lineDistance(ax: number, ay: number, dx: number, dy: number, x: number, y: number): number {
  const l = Math.hypot(dx, dy) || 1
  return Math.abs((x - ax) * dy - (y - ay) * dx) / l
}

/**
 * Watabou's Cutter.bisect with Polygon.cut's gap: cuts poly through the point at `ratio`
 * along edge k, across that edge turned by `angle`, leaving a gap of `gap` between the
 * halves. The new edges get tag CUT. Either half may come back empty (fewer than three points).
 */
export function bisect(poly: Poly, k: number, ratio: number, angle: number, gap: number, out: Poly[]): void {
  const p = poly.p
  const n = p.length / 2
  const j = (k + 1) % n
  const x0 = p[k * 2], y0 = p[k * 2 + 1]
  const dx = p[j * 2] - x0, dy = p[j * 2 + 1] - y0
  const l = Math.hypot(dx, dy) || 1
  const mx = x0 + dx * ratio, my = y0 + dy * ratio
  // the cut runs across the edge direction turned by `angle`: its normal is that direction
  const c0 = Math.cos(angle), s0 = Math.sin(angle)
  const ex = (dx * c0 - dy * s0) / l, ey = (dy * c0 + dx * s0) / l
  const c = ex * mx + ey * my
  out.length = 0
  out.push(clip(poly, ex, ey, c - gap / 2, CUT), clip(poly, -ex, -ey, -c - gap / 2, CUT))
}

/** Index of the longest edge of p. */
export function longestEdge(p: number[]): number {
  const n = p.length / 2
  let bk = 0, bl = -1
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n
    const l = Math.hypot(p[j * 2] - p[k * 2], p[j * 2 + 1] - p[k * 2 + 1])
    if (l > bl) { bl = l; bk = k }
  }
  return bk
}

/** Lot parameters of a ward (Watabou's CommonWard: minSq, gridChaos, sizeChaos, emptyProb). */
export interface AlleyParams {
  /** Typical lot area (plan units squared). */
  minSq: number
  /** 0 a regular grid of straight cuts at the middle, 1 cuts anywhere and askew (up to 30 degrees). */
  gridChaos: number
  /** How much lot areas vary (0..1). */
  sizeChaos: number
  /** Share of lots left empty (yards, gardens). */
  emptyProb: number
  /** The width of an alley left between the halves of a large cut. */
  alley: number
  /** Smallest lot worth a house (ours: our houses have a least size; Watabou's polygons have none). */
  minLot: number
}

/**
 * Watabou's Ward.createAlleys: the block is bisected across its longest edge, at a point
 * and an angle spread by the ward's grid chaos (square cuts in small pieces, so houses
 * stay rectangular), the halves again until each is smaller than the ward's lot size
 * (spread by its size chaos); a large piece's halves are parted by an alley, a small one's
 * share a wall. `rnd(n)` is the caller's seeded stream (n counts the draws). Lots are
 * pushed to `lots` with `empty` per lot, in a fixed order.
 */
export function createAlleys(block: Poly, q: AlleyParams, rnd: (n: number) => number, lots: Poly[], empty: boolean[]): void {
  let n = 0
  const R = () => rnd(n++)
  const stack: { poly: Poly; split: boolean; depth: number }[] = [{ poly: block, split: true, depth: 0 }]
  const halves: Poly[] = []
  while (stack.length) {
    const { poly, split, depth } = stack.pop()!
    const a = Math.abs(area(poly.p))
    const k = longestEdge(poly.p)
    const spread = 0.8 * q.gridChaos
    const ratio = (1 - spread) / 2 + R() * spread
    // trying to keep buildings rectangular even in chaotic wards
    const angleSpread = (Math.PI / 6) * q.gridChaos * (a < q.minSq * 4 ? 0 : 1)
    const b = (R() - 0.5) * angleSpread
    bisect(poly, k, ratio, b, split ? q.alley : 0.012, halves)
    // (the second half first onto the stack, so lots come out in cut order)
    const pair = halves.slice()
    const next: { poly: Poly; split: boolean; depth: number }[] = []
    for (const half of pair) {
      if (half.p.length < 6) continue
      const ha = Math.abs(area(half.p))
      if (ha < Math.max(q.minSq * Math.pow(2, 4 * q.sizeChaos * (R() - 0.5)), q.minLot * 2.2) || depth >= 12) {
        lots.push(half)
        empty.push(R() < q.emptyProb)
      } else {
        const u = R() * R()
        next.push({ poly: half, split: ha > q.minSq / Math.max(1e-6, u), depth: depth + 1 })
      }
    }
    for (let i = next.length - 1; i >= 0; i--) stack.push(next[i])
  }
}

/** Watabou's Cutter.radial: sectors from the centroid to each edge, parted by paths of width gap (a park's lawns). */
export function radialCut(poly: Poly, gap: number, out: Poly[]): void {
  const c = [0, 0]
  centroid(poly.p, c)
  const p = poly.p
  const n = p.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    let sector: Poly = { p: [c[0], c[1], p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1]], t: [CUT, poly.t[i], CUT] }
    const sh = inset(sector, [gap / 2, 0, gap / 2])
    if (!sh) continue
    sector = sh
    out.push(sector)
  }
}

/**
 * Watabou's Cutter.ring: peels strips of `thickness` off each edge of the block (the short
 * edges first), leaving the middle open: the buildings round a temple close or a castle yard.
 * Returns the middle that is left (or null).
 */
export function ringCut(poly: Poly, thickness: number, out: Poly[]): Poly | null {
  const p = poly.p
  const n = p.length / 2
  const order: number[] = []
  for (let i = 0; i < n; i++) order.push(i)
  const len = (i: number) => Math.hypot(p[((i + 1) % n) * 2] - p[i * 2], p[((i + 1) % n) * 2 + 1] - p[i * 2 + 1])
  order.sort((a, b) => len(a) - len(b) || a - b)
  let rest: Poly = poly
  for (const i of order) {
    const j = (i + 1) % n
    const ex = p[j * 2] - p[i * 2], ey = p[j * 2 + 1] - p[i * 2 + 1]
    const l = Math.hypot(ex, ey)
    if (l < 1e-6) continue
    // inward normal of a CCW edge: (-ey, ex)
    const ix = -ey / l, iy = ex / l
    const c = ix * p[i * 2] + iy * p[i * 2 + 1] + thickness
    // the strip: i . x <= c ; the rest: i . x >= c
    const strip = clip(rest, ix, iy, c, CUT)
    const keep = clip(rest, -ix, -iy, -c, CUT)
    if (strip.p.length >= 6 && Math.abs(area(strip.p)) > thickness * thickness * 0.3) out.push(strip)
    if (keep.p.length < 6) return null
    rest = keep
  }
  return rest
}

/** Watabou's Polygon.smoothVertex on a closed loop: (prev + v f + next) / (2 + f) for every vertex at once. */
export function smoothLoop(xs: number[], ys: number[], f: number, fixed: (i: number) => boolean, ox: number[], oy: number[]): void {
  const n = xs.length
  ox.length = n
  oy.length = n
  for (let i = 0; i < n; i++) {
    if (fixed(i)) { ox[i] = xs[i]; oy[i] = ys[i]; continue }
    const a = (i + n - 1) % n, b = (i + 1) % n
    ox[i] = (xs[a] + xs[i] * f + xs[b]) / (2 + f)
    oy[i] = (ys[a] + ys[i] * f + ys[b]) / (2 + f)
  }
}
