// The procedural settlement generator: one unique plan per settlement, deterministic from
// (world seed, settlement id) and shaped by its site. The approach follows the ideas of
// ward-based medieval town generators (patches -> wards -> lots), reimplemented here:
//
//  1. Patches: seed points on a jittered spiral out from the centre, a Voronoi tessellation
//     (convex cells by half-plane clipping, each edge tagged with the neighbouring cell),
//     two relaxation passes on the inner patches only, so the core is regular and the
//     outskirts irregular. Patches on water are dropped.
//  2. Streets: the patch edges. Main streets run from the central plaza out along the
//     settlement's actual route directions (trade routes, founding and colonising
//     journeys), shortest paths over the patch-edge graph; they are wider, and where one
//     crosses a river it gets a bridge.
//  3. Wards: the inner patches take ward types from a pool by location rating (cathedral and
//     administration near the centre, merchants and markets on the main streets, harbour
//     on the waterfront of a port, craftsmen by the river, slums far out, the citadel on
//     the highest ground of a city's edge, military next to it). The pool is weighted by
//     the settlement's wealth, trade and famines. Outer patches are outskirts and farms.
//  4. Lots: each patch is inset from its streets, then recursively bisected across its
//     longest edge into lots (minimum area and empty share by ward type, alleys in dense
//     wards). Each lot gets one generated house fitted to it, aligned to its street front.
//  5. Growth: lots are ranked by distance from the centre blended with their patch's, so
//     the town fills patch by patch outward along the streets. A settlement of population
//     p shows the first houseCount(p) valid lots; landmarks appear once their ward is
//     reached and the population passes their own minimum; walls enclose the patches built
//     when the population first passes the wall threshold (a second ring later).
//
// The plan is computed lazily and incrementally (lot validity needs ground probes, the
// costly part): `advance(need, deadline)` validates lots in rank order until the plan
// covers population `need` or the time budget runs out. Whatever has been computed is
// final: further work only appends items.

import { CITY_POPULATION, TOWN_POPULATION } from '../../contract.ts'
import { Kind, type Style as StyleT } from './shapes.ts'
import { hash4, rand4 } from './surface.ts'

/** Houses shown at population p (monotone, continuous; log-log between anchors). */
const ANCHORS: readonly [number, number][] = [
  [1, 1], [15, 3], [50, 4], [125, 6], [250, 8], [600, 11], [1000, 14], [2000, 22], [3000, 40], [5000, 62],
  [8000, 96], [10000, 125], [15000, 185], [26000, 300], [40000, 420], [80000, 600],
]
export function houseCount(p: number): number {
  if (p < 1) return 0
  for (let i = 1; i < ANCHORS.length; i++) {
    const [p1, h1] = ANCHORS[i]
    if (p <= p1) {
      const [p0, h0] = ANCHORS[i - 1]
      const t = Math.log(p / p0) / Math.log(p1 / p0)
      return Math.floor(Math.exp(Math.log(h0) + t * (Math.log(h1) - Math.log(h0))) + 1e-6)
    }
  }
  return 600
}
/** Smallest population at which house k (0-based) shows. */
export function houseThreshold(k: number): number {
  const n = k + 1
  for (let i = 1; i < ANCHORS.length; i++) {
    const [p1, h1] = ANCHORS[i]
    if (n <= h1) {
      const [p0, h0] = ANCHORS[i - 1]
      if (n <= h0) return p0
      const t = (Math.log(n) - Math.log(h0)) / (Math.log(h1) - Math.log(h0))
      let p = Math.exp(Math.log(p0) + t * (Math.log(p1) - Math.log(p0)))
      // the floor() in houseCount: nudge up until it agrees
      for (let g = 0; g < 8 && houseCount(p) < n; g++) p *= 1.002
      return p
    }
  }
  return 1e9
}

/** Mean patch spacing (KayKit units). */
const PATCH = 1.75
/** Inner patches a plan for peak population p has (lots per patch ~10). */
const innerPatches = (p: number) => Math.max(1, Math.ceil(houseCount(p) / 9))
/** Expected radius of a settlement of peak population p (KayKit units), for the countryside to keep clear. */
export function townRadius(p: number): number {
  return PATCH * Math.sqrt(innerPatches(p) + 1.2) * 1.05 + 0.6
}

export const Ward = {
  Plaza: 0,
  Craftsmen: 1,
  Merchant: 2,
  Patrician: 3,
  Slum: 4,
  Market: 5,
  Cathedral: 6,
  Admin: 7,
  Military: 8,
  Park: 9,
  Harbour: 10,
  Citadel: 11,
  Village: 12,
  Outskirts: 13,
  Farm: 14,
} as const
type Ward = (typeof Ward)[keyof typeof Ward]

/** Roles an item can play; layout.ts maps (role, style) to a model. */
export const Role = {
  House: 0, // kind in `kind`
  Church: 1,
  Market: 2,
  Well: 3,
  Tavern: 4,
  Blacksmith: 5,
  Castle: 6,
  Tower: 7,
  Barracks: 8,
  Hall: 9, // administration
  WallSeg: 10,
  WallTower: 11,
  Windmill: 12,
  Watermill: 13,
  Lumbermill: 14,
  Grove: 15,
  Haystack: 16,
  Bridge: 17,
  Ground: 18, // packed earth under a built patch
} as const
export type Role = (typeof Role)[keyof typeof Role]

export interface PlanItem {
  role: Role
  /** House kind (Role.House), else unused. */
  kind: number
  style: StyleT
  /** Centre in the tangent frame (KayKit units). */
  x: number
  y: number
  /** Facing (radians from east toward north) of the model's x axis. */
  yaw: number
  /** Scale along the model's x, z and y (relative to the role's base scale). */
  sx: number
  sz: number
  sy: number
  /** Population at which it shows. */
  threshold: number
  /** Index into the style's roof and wall colour lists (layout.ts), and a 0..1 jitter. */
  roof: number
  wall: number
  jitter: number
  /** Ward of the item (for colours: harbour warehouses, slums). */
  ward: number
}

/** What the generator needs to know about the site (all coordinates in KayKit units in the settlement's tangent frame). */
export interface Site {
  seed: number
  id: number
  /** Peak population over the run (sizes the plan, never the year). */
  peak: number
  style: StyleT
  /** Building style of a house (biome mixing across the settlement's edge, the parents' culture): pick by u in [0, 1). */
  houseStyle(u: number): StyleT
  /** Main street directions (radians), busiest first. */
  routes: number[]
  port: boolean
  /** Direction of the port's pier from the centre (radians), when there is a port. */
  portAngle: number
  river: boolean
  /** 0..1: wealth rank, trade, famines, soil wear (ward mix). */
  wealth: number
  trade: number
  hardship: number
  forest: boolean
  windmills: boolean
  /** Sea or lake (as drawn) at (x, y), within `margin` of the shore (units of the coast noise). */
  wet(x: number, y: number, margin: number): boolean
  /** Ground height at (x, y), for high ground. */
  height(x: number, y: number): number
  /** Footprint of radius r at (x, y) is dry land and clear of rivers. */
  clear(x: number, y: number, r: number): boolean
  /** Distance to the nearest river centreline minus its half width, or Infinity; and river segments for bridges. */
  riverSegs: number[]
}

// ---------- convex polygons (flat xy arrays, CCW) with per-edge tags ----------

interface Poly {
  p: number[]
  /** Tag per edge i (p[i] -> p[i+1]): neighbouring patch, -1 the outer bound, -2 a lot cut. */
  t: number[]
}

/** Keep the part with a*x + b*y <= c; the new edge gets `tag`. */
function clip(poly: Poly, a: number, b: number, c: number, tag: number): Poly {
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
  return { p: out, t: fixTags(out, ot) }
}

/** clip() pushes one tag per kept edge start; this keeps the arrays aligned. */
function fixTags(p: number[], t: number[]): number[] {
  const n = p.length / 2
  if (t.length === n) return t
  const r = t.slice(0, n)
  while (r.length < n) r.push(-2)
  return r
}

function area(p: number[]): number {
  let s = 0
  const n = p.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    s += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]
  }
  return s / 2
}

function centroid(p: number[], out: number[]) {
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
function rayExtent(p: number[], cx: number, cy: number, dx: number, dy: number): number {
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

/** Inset convex p: edge i moves inward by w[i]. */
function inset(poly: Poly, w: number[]): Poly | null {
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

// ---------- the plan ----------

interface Patch {
  poly: Poly
  cx: number
  cy: number
  r: number
  water: boolean
  /** Share of the patch that is dry land (rim samples). */
  dry: number
  ward: Ward
  /** Rank key (distance from centre). */
  key: number
  inner: boolean
}

interface Lot {
  poly: number[]
  /** Street-facing edge direction (unit) or 0,0. */
  ux: number
  uy: number
  cx: number
  cy: number
  key: number
  patch: number
  empty: boolean
}

export interface TownPlan {
  /** Items in the order they were added (thresholds are not sorted). */
  items: PlanItem[]
  /** Radius of everything placed so far (KayKit units). */
  radius: number
  /** Whether the plan covers population `need` (computing more within the deadline, performance.now() ms). */
  advance(need: number, deadline: number): boolean
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

const MIN_AREA: Record<number, number> = {
  [Ward.Craftsmen]: 0.5, [Ward.Merchant]: 0.5, [Ward.Patrician]: 1.0, [Ward.Slum]: 0.3, [Ward.Harbour]: 0.75,
  [Ward.Village]: 0.6, [Ward.Outskirts]: 0.9, [Ward.Farm]: 1.4, [Ward.Military]: 0.7, [Ward.Park]: 1.2,
}
const EMPTY_SHARE: Record<number, number> = {
  [Ward.Craftsmen]: 0.05, [Ward.Merchant]: 0.03, [Ward.Patrician]: 0.18, [Ward.Slum]: 0.02, [Ward.Harbour]: 0.12,
  [Ward.Village]: 0.3, [Ward.Outskirts]: 0.55, [Ward.Farm]: 0.8, [Ward.Military]: 0.3, [Ward.Park]: 0.6,
}

/** House kinds: half width (x) and half depth (z) of the base mesh (shapes.ts, Temperate; the other styles are close). */
const KIND_HALF: readonly [number, number][] = [[0.3, 0.22], [0.4, 0.27], [0.6, 0.27], [0.27, 0.33]]

export function createTownPlan(site: Site): TownPlan {
  const { seed, id } = site
  const rnd = (a: number, b: number) => rand4(seed, id, a, b)
  const items: PlanItem[] = []
  const T = TOWN_POPULATION, C = CITY_POPULATION
  const peak = Math.max(1, site.peak)
  const nInner = innerPatches(peak)
  const isTown = peak >= T * 0.8
  const isCity = peak >= C * 0.85
  const nSeeds = Math.max(12, Math.ceil(nInner * 3.2) + 10)
  const rot = rnd(1, 0) * Math.PI * 2

  // ---- 1. patches ----
  const sx: number[] = [], sy: number[] = []
  for (let i = 0; i < nSeeds; i++) {
    const r = i === 0 ? 0 : PATCH * Math.sqrt(i + 0.3) * (0.92 + 0.16 * rnd(i, 2))
    const a = rot + i * GOLDEN + (rnd(i, 3) - 0.5) * 0.5
    sx.push(r * Math.cos(a))
    sy.push(r * Math.sin(a))
  }
  const bound = PATCH * Math.sqrt(nSeeds) * 1.08 + PATCH * 0.6
  const voronoi = (): Poly[] => {
    const cells: Poly[] = []
    const order: number[] = []
    for (let i = 0; i < nSeeds; i++) order.push(i)
    for (let i = 0; i < nSeeds; i++) {
      // a 12-gon around the town
      const p: number[] = [], t: number[] = []
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2
        p.push(Math.cos(a) * bound, Math.sin(a) * bound)
        t.push(-1)
      }
      let poly: Poly = { p, t }
      const xi = sx[i], yi = sy[i]
      order.sort((a, b) => (sx[a] - xi) ** 2 + (sy[a] - yi) ** 2 - ((sx[b] - xi) ** 2 + (sy[b] - yi) ** 2))
      let reach = 0
      for (let k = 0; k < poly.p.length / 2; k++) reach = Math.max(reach, Math.hypot(poly.p[k * 2] - xi, poly.p[k * 2 + 1] - yi))
      for (const j of order) {
        if (j === i) continue
        const dx = sx[j] - xi, dy = sy[j] - yi
        const d = Math.hypot(dx, dy)
        if (d > 2 * reach) break
        // keep points nearer to i: (p - m) . (sj - si) <= 0
        const mx = (sx[j] + xi) / 2, my = (sy[j] + yi) / 2
        poly = clip(poly, dx, dy, dx * mx + dy * my, j)
        if (poly.p.length < 6) break
        reach = 0
        for (let k = 0; k < poly.p.length / 2; k++) reach = Math.max(reach, Math.hypot(poly.p[k * 2] - xi, poly.p[k * 2 + 1] - yi))
      }
      cells.push(poly)
    }
    return cells
  }
  let cells = voronoi()
  const cc = [0, 0]
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < Math.min(nSeeds, nInner + 2); i++) {
      if (cells[i].p.length < 6) continue
      centroid(cells[i].p, cc)
      sx[i] = cc[0]
      sy[i] = cc[1]
    }
    cells = voronoi()
  }
  const patches: Patch[] = cells.map((poly, i) => {
    centroid(poly.p, cc)
    let r = 0
    for (let k = 0; k < poly.p.length / 2; k++) r = Math.max(r, Math.hypot(poly.p[k * 2] - cc[0], poly.p[k * 2 + 1] - cc[1]))
    const wetC = poly.p.length < 6 || site.wet(cc[0], cc[1], 0.05)
    // water if the centre and most of the rim are wet
    let wetRim = 0
    const nv = poly.p.length / 2
    for (let k = 0; k < nv; k++) if (site.wet(cc[0] + (poly.p[k * 2] - cc[0]) * 0.7, cc[1] + (poly.p[k * 2 + 1] - cc[1]) * 0.7, 0)) wetRim++
    const water = wetC && wetRim >= nv * 0.5
    return { poly, cx: cc[0], cy: cc[1], r, water, dry: 1 - wetRim / Math.max(1, nv), ward: Ward.Outskirts as Ward, key: Math.hypot(cc[0], cc[1]) + (i === 0 ? -1 : 0), inner: false }
  })
  const P = patches.length
  const neighbours = (i: number) => patches[i].poly.t.filter((t) => t >= 0)

  // ---- 2. main streets over the patch-edge graph ----
  // vertices snapped to a fine grid so neighbouring cells share them
  const vKey = new Map<string, number>()
  const vx: number[] = [], vy: number[] = []
  const adj: number[][] = []
  const vid = (x: number, y: number) => {
    const k = `${Math.round(x * 50)},${Math.round(y * 50)}`
    let v = vKey.get(k)
    if (v === undefined) {
      v = vx.length
      vKey.set(k, v)
      vx.push(x)
      vy.push(y)
      adj.push([])
    }
    return v
  }
  const edgeKey = (a: number, b: number) => (a < b ? a * 100000 + b : b * 100000 + a)
  const patchEdgeVerts: number[][] = []
  for (let i = 0; i < P; i++) {
    const { p } = patches[i].poly
    const n = p.length / 2
    const ids: number[] = []
    for (let k = 0; k < n; k++) ids.push(vid(p[k * 2], p[k * 2 + 1]))
    patchEdgeVerts.push(ids)
    if (patches[i].water) continue
    for (let k = 0; k < n; k++) {
      const a = ids[k], b = ids[(k + 1) % n]
      if (a === b) continue
      if (!adj[a].includes(b)) adj[a].push(b)
      if (!adj[b].includes(a)) adj[b].push(a)
    }
  }
  const mainEdges = new Set<number>()
  const routes = site.routes.slice(0, isCity ? 6 : isTown ? 4 : 2)
  const plazaVerts = new Set(patchEdgeVerts[0])
  const outerR = bound * 0.92
  for (const ang of routes) {
    // target: the graph vertex farthest out near this direction
    const dx = Math.cos(ang), dy = Math.sin(ang)
    let target = -1, best = -Infinity
    for (let v = 0; v < vx.length; v++) {
      if (adj[v].length === 0) continue
      const r = Math.hypot(vx[v], vy[v])
      if (r > outerR) continue
      const along = vx[v] * dx + vy[v] * dy
      const off = Math.abs(-vx[v] * dy + vy[v] * dx)
      const score = along - off * 1.6
      if (score > best) { best = score; target = v }
    }
    if (target < 0) continue
    // Dijkstra from the plaza's corners
    const dist = new Float64Array(vx.length).fill(Infinity)
    const prev = new Int32Array(vx.length).fill(-1)
    const done = new Uint8Array(vx.length)
    for (const v of plazaVerts) dist[v] = 0
    for (;;) {
      let u = -1, du = Infinity
      for (let v = 0; v < vx.length; v++) if (!done[v] && dist[v] < du) { du = dist[v]; u = v }
      if (u < 0 || u === target) break
      done[u] = 1
      for (const w of adj[u]) {
        // prefer edges heading the right way (straighter main streets)
        const ex = vx[w] - vx[u], ey = vy[w] - vy[u]
        const l = Math.hypot(ex, ey)
        const cost = l * (1.25 - 0.35 * ((ex * dx + ey * dy) / (l || 1)))
        if (du + cost < dist[w]) { dist[w] = du + cost; prev[w] = u }
      }
    }
    for (let v = target; prev[v] >= 0; v = prev[v]) mainEdges.add(edgeKey(v, prev[v]))
  }

  // ---- 3. wards ----
  const order: number[] = []
  for (let i = 0; i < P; i++) if (!patches[i].water) order.push(i)
  order.sort((a, b) => patches[a].key - patches[b].key)
  const nearRiverPatch = (i: number) => {
    const S = site.riverSegs
    for (let k = 0; k < S.length; k += 5) {
      const ax = S[k], ay = S[k + 1], bx = S[k + 2], by = S[k + 3]
      const ddx = bx - ax, ddy = by - ay
      const t = Math.min(1, Math.max(0, ((patches[i].cx - ax) * ddx + (patches[i].cy - ay) * ddy) / (ddx * ddx + ddy * ddy || 1)))
      if (Math.hypot(patches[i].cx - ax - ddx * t, patches[i].cy - ay - ddy * t) < patches[i].r * 0.8 + S[k + 4]) return true
    }
    return false
  }
  if (order.length === 0) {
    // all water as drawn (a settlement on a lake shore cell, say): nothing to build on
    return { items, radius: 0, advance: () => true }
  }
  // inner patches: in rank order until their estimated room (dry share, rivers, empty lots)
  // holds the peak's houses with a margin, plus the plaza and landmark wards of a town
  const target = houseCount(peak)
  const landmarkWards = isTown ? 2 + (peak >= 6000 ? 1 : 0) + (isCity ? 2 : 0) + Math.floor(site.trade * 2) : 0
  const innerSet: number[] = []
  {
    let room = 0
    for (const i of order) {
      if (room >= target * 1.25 + 1 && innerSet.length >= nInner * 0.5 + landmarkWards) break
      innerSet.push(i)
      const pa = patches[i]
      const a = Math.abs(area(pa.poly.p))
      room += (a * 0.78 * pa.dry * (nearRiverPatch(i) ? 0.65 : 1)) / 0.75 * 0.85
      if (innerSet.length > 400) break
    }
    // the landmark wards hold no houses: make room for them too
    for (let k = 0, j = innerSet.length; k < landmarkWards && j < order.length; k++, j++) innerSet.push(order[j])
  }
  for (const i of innerSet) patches[i].inner = true
  const touchesWater = (i: number) => patches[i].poly.t.some((t) => t >= 0 && patches[t].water) || patches[i].poly.t.some((t) => t === -1) && site.wet(patches[i].cx * 1.3, patches[i].cy * 1.3, 0)
  const onMain = (i: number) => {
    const ids = patchEdgeVerts[i]
    for (let k = 0; k < ids.length; k++) if (mainEdges.has(edgeKey(ids[k], ids[(k + 1) % ids.length]))) return true
    return false
  }
  const Rin = PATCH * Math.sqrt(innerSet.length + 1)
  // the pool of ward types for the inner patches beyond the plaza
  const pool: Ward[] = []
  if (!isTown) {
    for (let k = 0; k < innerSet.length; k++) pool.push(Ward.Village)
  } else {
    const n = innerSet.length - 1
    const add = (w: Ward, count: number) => { for (let k = 0; k < count; k++) pool.push(w) }
    add(Ward.Cathedral, peak >= 12000 + 8000 * rnd(4, 1) ? 2 : 1)
    if (peak >= 6000) add(Ward.Admin, 1)
    add(Ward.Market, Math.min(3, Math.floor(site.trade * 3 + rnd(4, 2) * 0.8 + (n > 12 ? 1 : 0))))
    if (isCity) add(Ward.Military, 1)
    if (site.port) add(Ward.Harbour, Math.max(1, Math.round(n * 0.12)))
    add(Ward.Park, n > 14 && rnd(4, 3) < 0.6 ? 1 : 0)
    const rest = Math.max(0, n - pool.length)
    const wMerchant = 0.14 + 0.18 * site.wealth + 0.1 * site.trade
    const wPatrician = 0.06 + 0.12 * site.wealth
    const wSlum = 0.08 + 0.25 * site.hardship
    for (let k = 0; k < rest; k++) {
      const u = rnd(k, 5) * (1 + wMerchant + wPatrician + wSlum)
      pool.push(u < 1 ? Ward.Craftsmen : u < 1 + wMerchant ? Ward.Merchant : u < 1 + wMerchant + wPatrician ? Ward.Patrician : Ward.Slum)
    }
  }
  // citadel: on a city's edge, the highest inner patch
  let citadel = -1
  if (isCity) {
    let hb = -Infinity
    for (let k = Math.floor(innerSet.length * 0.55); k < innerSet.length; k++) {
      const i = innerSet[k]
      const h = site.height(patches[i].cx, patches[i].cy) + rnd(i, 6) * 1e-4
      if (h > hb) { hb = h; citadel = i }
    }
    if (citadel >= 0) patches[citadel].ward = Ward.Citadel
  }
  const isNeighbour = (i: number, w: Ward) => neighbours(i).some((j) => patches[j].ward === w)
  const rating = (w: Ward, i: number): number => {
    const d = Math.hypot(patches[i].cx, patches[i].cy) / Math.max(1, Rin)
    switch (w) {
      case Ward.Cathedral: return 2 - d * 2 + (isNeighbour(i, Ward.Cathedral) ? -3 : 0)
      case Ward.Admin: return 1.6 - d * 2
      case Ward.Market: return 1.2 - d * 1.2 + (onMain(i) ? 1 : 0) + (isNeighbour(i, Ward.Market) ? -2 : 0)
      case Ward.Merchant: return 0.8 - d + (onMain(i) ? 0.8 : 0)
      case Ward.Patrician: return 0.6 - Math.abs(d - 0.5) + (isNeighbour(i, Ward.Slum) ? -1.5 : 0) + (isNeighbour(i, Ward.Park) ? 0.5 : 0)
      case Ward.Slum: return d * 1.2 - 0.6 + (touchesWater(i) ? 0.3 : 0)
      case Ward.Military: return (isNeighbour(i, Ward.Citadel) ? 2 : 0) + d
      case Ward.Harbour: return touchesWater(i) ? 3 - d * 0.5 : -5
      case Ward.Park: return 0.2 + rnd(i, 7) * 0.5 - Math.abs(d - 0.6)
      case Ward.Craftsmen: return 0.3 + (nearRiverPatch(i) ? 0.6 : 0) + (onMain(i) ? 0.2 : 0)
      default: return 0
    }
  }
  if (isTown) patches[innerSet[0]].ward = Ward.Plaza
  for (let k = isTown ? 1 : 0; k < innerSet.length; k++) {
    const i = innerSet[k]
    if (patches[i].ward === Ward.Citadel) continue
    let bi = -1, bs = -Infinity
    for (let q = 0; q < pool.length; q++) {
      const s = rating(pool[q], i) + rnd(i, q + 40) * 0.3
      if (s > bs) { bs = s; bi = q }
    }
    patches[i].ward = bi >= 0 ? pool.splice(bi, 1)[0] : Ward.Craftsmen
  }
  for (const i of order) if (!patches[i].inner) patches[i].ward = Math.hypot(patches[i].cx, patches[i].cy) < Rin + PATCH * 1.2 ? Ward.Outskirts : Ward.Farm

  // ---- 4. lots ----
  const lots: Lot[] = []
  const lotPatchFirst: number[] = []
  const dense = (w: Ward) => w === Ward.Merchant || w === Ward.Slum || w === Ward.Craftsmen
  for (const i of order) {
    const pa = patches[i]
    lotPatchFirst[i] = lots.length
    const w = pa.ward
    if (w === Ward.Plaza || w === Ward.Cathedral || w === Ward.Admin || w === Ward.Market || w === Ward.Citadel) continue
    const ids = patchEdgeVerts[i]
    const n = ids.length
    const widths: number[] = []
    for (let k = 0; k < n; k++) {
      const t = pa.poly.t[k]
      const main = mainEdges.has(edgeKey(ids[k], ids[(k + 1) % n]))
      widths.push(t >= 0 && patches[t].water ? 0.06 : main ? 0.24 : t < 0 ? 0.08 : w === Ward.Farm || w === Ward.Outskirts ? 0.14 : 0.13)
    }
    const block = inset(pa.poly, widths)
    if (!block) continue
    const minA = MIN_AREA[w] ?? 0.6
    const emptyP = EMPTY_SHARE[w] ?? 0.2
    const stack: { poly: Poly; depth: number }[] = [{ poly: block, depth: 0 }]
    let li = 0
    while (stack.length) {
      const { poly, depth } = stack.pop()!
      const a = area(poly.p)
      const jitterA = 0.8 + 0.6 * rnd(i * 977 + li, 8)
      if (a < minA * 2 * jitterA || depth > 9) {
        if (a < minA * 0.45) continue
        // street front: the longest edge that is not a lot cut
        const nv = poly.p.length / 2
        let ux = 0, uy = 0, bl = 0, ax = 0, ay = 0, al = 0
        for (let k = 0; k < nv; k++) {
          const j = (k + 1) % nv
          const ex = poly.p[j * 2] - poly.p[k * 2], ey = poly.p[j * 2 + 1] - poly.p[k * 2 + 1]
          const l = Math.hypot(ex, ey)
          if (l > al) { al = l; ax = ex / l; ay = ey / l }
          if (poly.t[k] !== -2 && l > bl) { bl = l; ux = ex / l; uy = ey / l }
        }
        if (bl === 0) { ux = ax; uy = ay }
        centroid(poly.p, cc)
        const d = Math.hypot(cc[0], cc[1])
        const e = rnd(i * 977 + li, 9) < emptyP
        lots.push({ poly: poly.p, ux, uy, cx: cc[0], cy: cc[1], key: d * 0.55 + pa.key * 0.45 + rnd(i * 977 + li, 10) * 0.25, patch: i, empty: e })
        li++
        continue
      }
      // cut across the longest edge, near its middle
      const nv = poly.p.length / 2
      let lk = 0, ll = 0
      for (let k = 0; k < nv; k++) {
        const j = (k + 1) % nv
        const l = Math.hypot(poly.p[j * 2] - poly.p[k * 2], poly.p[j * 2 + 1] - poly.p[k * 2 + 1])
        if (l > ll) { ll = l; lk = k }
      }
      const j = (lk + 1) % nv
      const s = 0.38 + 0.24 * rnd(i * 977 + li, 11 + depth)
      const mx = poly.p[lk * 2] + (poly.p[j * 2] - poly.p[lk * 2]) * s
      const my = poly.p[lk * 2 + 1] + (poly.p[j * 2 + 1] - poly.p[lk * 2 + 1]) * s
      let ex = (poly.p[j * 2] - poly.p[lk * 2]) / ll, ey = (poly.p[j * 2 + 1] - poly.p[lk * 2 + 1]) / ll
      const tw = (rnd(i * 977 + li, 21 + depth) - 0.5) * 0.3
      const c0 = Math.cos(tw), s0 = Math.sin(tw)
      ;[ex, ey] = [ex * c0 - ey * s0, ex * s0 + ey * c0]
      const alley = dense(w) && depth >= 1 && depth <= 2 && rnd(i * 977 + li, 31 + depth) < 0.3 ? 0.06 : 0.015
      const c = ex * mx + ey * my
      const A = clip(poly, ex, ey, c - alley, -2)
      const B = clip(poly, -ex, -ey, -c - alley, -2)
      if (A.p.length >= 6) stack.push({ poly: A, depth: depth + 1 })
      if (B.p.length >= 6) stack.push({ poly: B, depth: depth + 1 })
      li++
    }
  }
  lots.sort((a, b) => a.key - b.key)

  // ---- 5. landmarks with their keys (ranked into the lot order later) ----
  interface Pending { item: PlanItem; key: number; minPop: number; r: number }
  const pend: Pending[] = []
  const style = site.style
  const mk = (role: Role, x: number, y: number, yaw: number, key: number, minPop: number, r: number, scale = 1, kind = 0, ward: number = -1) => {
    pend.push({ item: { role, kind, style, x, y, yaw, sx: scale, sz: scale, sy: scale, threshold: 0, roof: hash4(seed, id, 0x33, 0) % 5, wall: hash4(seed, id, 0x34, 0) % 4, jitter: rnd(pend.length, 0x35), ward }, key, minPop, r })
  }
  const longestEdgeYaw = (i: number) => {
    const p = patches[i].poly.p
    const n = p.length / 2
    let bl = 0, yaw = 0
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n
      const l = Math.hypot(p[j * 2] - p[k * 2], p[j * 2 + 1] - p[k * 2 + 1])
      if (l > bl) { bl = l; yaw = Math.atan2(p[j * 2 + 1] - p[k * 2 + 1], p[j * 2] - p[k * 2]) }
    }
    return yaw
  }
  const inradius = (i: number) => {
    const p = patches[i]
    let m = Infinity
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      m = Math.min(m, rayExtent(p.poly.p, p.cx, p.cy, Math.cos(a), Math.sin(a)))
    }
    return m
  }
  const fitScale = (i: number, need: number) => Math.max(0.65, Math.min(1, (inradius(i) - 0.15) / need))
  // the village green: a well at the centre
  {
    const a = rnd(5, 1) * Math.PI * 2
    const o = isTown ? 0.75 : 0.0
    mk(Role.Well, Math.cos(a) * o, Math.sin(a) * o, a, -1, 60, 0.25)
  }
  if (isTown) {
    const pl = innerSet[0]
    mk(Role.Market, patches[pl].cx * 0.3, patches[pl].cy * 0.3, longestEdgeYaw(pl), -0.5, T * (0.9 + 0.2 * rnd(5, 2)), 1.0, fitScale(pl, 1.0))
  }
  let churches = 0
  for (const i of innerSet) {
    const pa = patches[i]
    const yaw = longestEdgeYaw(i)
    switch (pa.ward) {
      case Ward.Cathedral:
        mk(Role.Church, pa.cx, pa.cy, yaw, pa.key, churches === 0 ? 1500 + 1500 * rnd(6, 1) : 9000 + 6000 * rnd(6, 2), 0.8, fitScale(i, 0.85) * (churches === 0 ? 1.15 : 1))
        // a bell tower beside the main church of a large town
        if (churches === 0 && peak >= 5000) {
          const o = Math.min(1.0, inradius(i) * 0.75)
          mk(Role.Tower, pa.cx + Math.cos(yaw) * o, pa.cy + Math.sin(yaw) * o, yaw, pa.key + 0.01, 5000 + 3000 * rnd(6, 6), 0.4, 0.8)
        }
        churches++
        break
      case Ward.Admin:
        mk(Role.Hall, pa.cx, pa.cy, yaw, pa.key, 6000 + 3000 * rnd(6, 3), 0.9, fitScale(i, 0.9))
        if (isCity) {
          const o = Math.min(1.0, inradius(i) * 0.75)
          mk(Role.Tower, pa.cx - Math.cos(yaw) * o, pa.cy - Math.sin(yaw) * o, yaw, pa.key + 0.01, C * (0.95 + 0.3 * rnd(6, 7)), 0.4, 0.9)
        }
        break
      case Ward.Market:
        mk(Role.Market, pa.cx, pa.cy, yaw, pa.key, T + 2000 * rnd(i, 61), 0.9, fitScale(i, 0.9))
        break
      case Ward.Citadel:
        mk(Role.Castle, pa.cx, pa.cy, yaw, pa.key, C * (0.9 + 0.3 * rnd(6, 4)), 1.1, fitScale(i, 1.1))
        break
      case Ward.Military:
        mk(Role.Barracks, pa.cx, pa.cy, yaw, pa.key, C, 0.8, fitScale(i, 0.8))
        break
      default:
        break
    }
  }
  // a village without a town yet still gets its chapel once it is large
  if (!isTown && peak >= 1200) {
    const i = innerSet[Math.min(innerSet.length - 1, 1)]
    const pa = patches[i]
    mk(Role.Church, (pa.cx + 0) * 0.5, pa.cy * 0.5, longestEdgeYaw(i), pa.key * 0.5, 1200 + 800 * rnd(6, 5), 0.8, 0.85)
  }
  // mills and lumber outside the core
  const outskirts = order.filter((i) => !patches[i].inner)
  if (site.windmills && outskirts.length) {
    const nMills = peak >= 4000 ? 2 : peak >= 400 ? 1 : 0
    for (let m = 0; m < nMills; m++) {
      let best = -1, hb = -Infinity
      for (const i of outskirts) {
        const h = site.height(patches[i].cx, patches[i].cy) + rnd(i, 70 + m) * 0.002
        if (h > hb && !pend.some((q) => q.item.role === Role.Windmill && Math.hypot(q.item.x - patches[i].cx, q.item.y - patches[i].cy) < 1.5)) { hb = h; best = i }
      }
      if (best >= 0) mk(Role.Windmill, patches[best].cx, patches[best].cy, rnd(best, 71) * 6.28, patches[best].key, m === 0 ? 400 + 600 * rnd(7, 1) : 4000 + 2000 * rnd(7, 2), 0.6)
    }
  }
  if (site.river && site.riverSegs.length >= 5) {
    // beside the river segment nearest the centre, wheel toward the water
    const S = site.riverSegs
    let bk = 0, bd = Infinity
    for (let k = 0; k < S.length; k += 5) {
      const d = Math.hypot((S[k] + S[k + 2]) / 2, (S[k + 1] + S[k + 3]) / 2)
      if (d > Rin * 0.6 && d < bd) { bd = d; bk = k }
    }
    const ax = S[bk], ay = S[bk + 1], bx = S[bk + 2], by = S[bk + 3], hw = S[bk + 4]
    const dx = bx - ax, dy = by - ay, dl = Math.hypot(dx, dy) || 1
    const side = rnd(8, 1) < 0.5 ? -1 : 1
    const o = hw + 0.55
    const t = 0.5
    mk(Role.Watermill, ax + dx * t + (-dy / dl) * o * side, ay + dy * t + (dx / dl) * o * side, Math.atan2(dy, dx) + (side > 0 ? Math.PI : 0), bd, 800 + 800 * rnd(8, 2), 0.55)
  }
  if (site.forest && peak >= 4000 && outskirts.length) {
    const i = outskirts[Math.floor(rnd(9, 1) * Math.min(outskirts.length, 4))]
    mk(Role.Lumbermill, patches[i].cx, patches[i].cy, longestEdgeYaw(i), patches[i].key, 4500 + 2000 * rnd(9, 2), 0.7)
  }
  // bridges where main streets cross the river
  if (site.riverSegs.length) {
    const S = site.riverSegs
    for (const ek of mainEdges) {
      const a = Math.floor(ek / 100000), b = ek % 100000
      const x0 = vx[a], y0 = vy[a], x1 = vx[b], y1 = vy[b]
      for (let k = 0; k < S.length; k += 5) {
        const ax = S[k], ay = S[k + 1], bx = S[k + 2], by = S[k + 3]
        const d1x = x1 - x0, d1y = y1 - y0, d2x = bx - ax, d2y = by - ay
        const den = d1x * d2y - d1y * d2x
        if (Math.abs(den) < 1e-9) continue
        const t = ((ax - x0) * d2y - (ay - y0) * d2x) / den
        const u = ((ax - x0) * d1y - (ay - y0) * d1x) / den
        if (t < 0 || t > 1 || u < 0 || u > 1) continue
        const px = x0 + d1x * t, py = y0 + d1y * t
        const span = (S[k + 4] * 2 + 0.5)
        // deck along the street: x along the street
        mk(Role.Bridge, px, py, Math.atan2(d1y, d1x), Math.hypot(px, py), 600, 0.1, 1)
        const it = pend[pend.length - 1].item
        it.sx = span
        it.sz = 0.36
        it.sy = 1
      }
    }
  }

  // ---- 6. incremental validation and growth ----
  const HOUSE_STYLE = (k: number) => site.houseStyle(rnd(k, 0x50))
  let nextLot = 0
  let built = 0
  const builtPerPatch = new Int32Array(P)
  const lotsPerPatch = new Int32Array(P)
  for (const l of lots) if (!l.empty) lotsPerPatch[l.patch]++
  let nextPend = 0
  pend.sort((a, b) => a.key - b.key)
  const groundDone = new Uint8Array(P)
  let radius = 0
  const walls: { threshold: number; done: boolean }[] = []
  if (isCity || (isTown && peak >= 7000)) {
    const t1 = 7000 + 3000 * rnd(10, 1)
    if (peak >= t1 * 1.05) walls.push({ threshold: t1, done: false })
    const t2 = Math.max(t1 * 2.4, 22000 + 6000 * rnd(10, 2))
    if (peak >= t2 * 1.05) walls.push({ threshold: t2, done: false })
  }
  let coveredPop = 0
  let smithy = false, inn = false

  const addGround = (i: number, threshold: number) => {
    if (groundDone[i]) return
    groundDone[i] = 1
    const pa = patches[i]
    const s = pa.r * 0.8
    items.push({ role: Role.Ground, kind: 0, style, x: pa.cx, y: pa.cy, yaw: 0, sx: s, sz: s, sy: 1, threshold, roof: 0, wall: 0, jitter: 0, ward: pa.ward })
  }

  const placeWall = (threshold: number) => {
    // boundary edges between built land patches and the rest (not along water)
    // a compact enclosure: patches in rank order until they hold what stands now
    const builtSet = new Uint8Array(P)
    let held = 0
    for (const i of order) {
      if (held >= built) break
      builtSet[i] = 1
      held += Math.max(lotsPerPatch[i], 0)
    }
    const gateVerts = new Set<number>()
    const towerVerts = new Set<number>()
    const segs: [number, number][] = []
    for (let i = 0; i < P; i++) {
      if (!builtSet[i]) continue
      const ids = patchEdgeVerts[i]
      const n = ids.length
      for (let k = 0; k < n; k++) {
        const t = patches[i].poly.t[k]
        if (t >= 0 && (builtSet[t] || patches[t].water)) continue
        const a = ids[k], b = ids[(k + 1) % n]
        if (a === b) continue
        // not along the shore
        const mx = (vx[a] + vx[b]) / 2, my = (vy[a] + vy[b]) / 2
        if (site.wet(mx, my, 0.3)) continue
        segs.push([a, b])
        towerVerts.add(a)
        towerVerts.add(b)
      }
    }
    for (const ek of mainEdges) {
      const a = Math.floor(ek / 100000), b = ek % 100000
      if (towerVerts.has(a)) gateVerts.add(a)
      if (towerVerts.has(b)) gateVerts.add(b)
    }
    for (const [a, b] of segs) {
      let x0 = vx[a], y0 = vy[a], x1 = vx[b], y1 = vy[b]
      const l = Math.hypot(x1 - x0, y1 - y0)
      if (l < 0.2) continue
      const ux = (x1 - x0) / l, uy = (y1 - y0) / l
      // leave a gap at gates
      if (gateVerts.has(a)) { x0 += ux * 0.3; y0 += uy * 0.3 }
      if (gateVerts.has(b)) { x1 -= ux * 0.3; y1 -= uy * 0.3 }
      const L = Math.hypot(x1 - x0, y1 - y0)
      if (L < 0.15) continue
      // in pieces of about a unit, each only on dry land clear of rivers
      const n = Math.max(1, Math.ceil(L / 1.0))
      const pl = L / n
      for (let q = 0; q < n; q++) {
        const mx = x0 + ux * pl * (q + 0.5), my = y0 + uy * pl * (q + 0.5)
        if (site.wet(x0 + ux * pl * q, y0 + uy * pl * q, 0.2) || site.wet(x0 + ux * pl * (q + 1), y0 + uy * pl * (q + 1), 0.2)) continue
        if (!site.clear(mx, my, 0.12)) continue
        items.push({ role: Role.WallSeg, kind: 0, style, x: mx, y: my, yaw: Math.atan2(uy, ux), sx: pl * 1.02, sz: 1, sy: 1, threshold, roof: 0, wall: 0, jitter: 0, ward: -1 })
      }
    }
    for (const v of towerVerts) {
      const gate = gateVerts.has(v)
      if (!gate && hash4(seed, id, v, 0x61) % 3 !== 0) continue
      if (!site.clear(vx[v], vy[v], 0.2)) continue
      const h = gate ? 1.15 : 1
      items.push({ role: Role.WallTower, kind: 0, style, x: vx[v], y: vy[v], yaw: 0, sx: h, sz: h, sy: h, threshold, roof: hash4(seed, id, 0x33, 0) % 5, wall: 0, jitter: 0, ward: -1 })
      radius = Math.max(radius, Math.hypot(vx[v], vy[v]) + 0.3)
    }
  }

  const flushPending = (key: number, pop: number) => {
    while (nextPend < pend.length && pend[nextPend].key <= key) {
      const q = pend[nextPend++]
      const it = q.item
      if (it.role !== Role.Bridge && !site.clear(it.x, it.y, q.r * Math.max(0.7, it.sx) * 0.75)) continue
      it.threshold = Math.max(q.minPop, pop)
      if (it.threshold > peak * 1.0001 && it.role !== Role.Well) continue
      items.push(it)
      radius = Math.max(radius, Math.hypot(it.x, it.y) + q.r)
      // the landmark's ward gets its packed ground too
      for (const i of innerSet) if (Math.hypot(patches[i].cx - it.x, patches[i].cy - it.y) < 0.05) addGround(i, it.threshold)
    }
  }

  const fitHouse = (l: Lot, k: number): PlanItem | null => {
    const ward = patches[l.patch].ward
    const vxd = -l.uy, vyd = l.ux
    const hu = Math.min(rayExtent(l.poly, l.cx, l.cy, l.ux, l.uy), rayExtent(l.poly, l.cx, l.cy, -l.ux, -l.uy))
    const hv = Math.min(rayExtent(l.poly, l.cx, l.cy, vxd, vyd), rayExtent(l.poly, l.cx, l.cy, -vxd, -vyd))
    const r = rnd(k, 0x51)
    let kind: number
    if (ward === Ward.Harbour) kind = Kind.Long
    else if (ward === Ward.Merchant) kind = r < 0.6 ? Kind.Tall : Kind.House
    else if (ward === Ward.Slum) kind = Kind.Small
    else if (ward === Ward.Patrician) kind = r < 0.35 ? Kind.Tall : Kind.House
    else if (ward === Ward.Farm || ward === Ward.Outskirts) kind = r < 0.25 ? Kind.Long : Kind.Small
    else if (ward === Ward.Craftsmen) kind = r < 0.25 ? Kind.Long : r < 0.45 ? Kind.Tall : Kind.House
    else kind = r < 0.35 ? Kind.Small : r < 0.85 ? Kind.House : Kind.Long
    const fill = ward === Ward.Farm || ward === Ward.Outskirts || ward === Ward.Village ? 0.7 : ward === Ward.Patrician ? 0.75 : 0.92
    // swap to a variant that fits the lot's proportions
    for (let tries = 0; tries < 3; tries++) {
      const [hw, hd] = KIND_HALF[kind]
      const fx = (hu * fill) / hw, fz = (hv * fill) / hd
      if (fx >= 0.6 && fz >= 0.6) {
        const sxk = Math.min(fx, kind === Kind.Long ? 1.5 : 1.7)
        const szk = Math.min(fz, 1.45)
        const hScale = ward === Ward.Slum ? 0.85 : ward === Ward.Merchant || ward === Ward.Patrician ? 1.12 : 1
        const sy = hScale * (0.9 + 0.2 * rnd(k, 0x52)) * Math.min(1.25, Math.max(0.85, Math.sqrt(Math.min(sxk, szk))))
        return { role: Role.House, kind, style: HOUSE_STYLE(k), x: l.cx, y: l.cy, yaw: Math.atan2(l.uy, l.ux), sx: sxk, sz: szk, sy, threshold: 0, roof: hash4(seed, id, k, 0x53) % 5, wall: hash4(seed, id, k, 0x54) % 4, jitter: rnd(k, 0x55), ward }
      }
      kind = fx < 0.6 && fz >= 0.6 ? Kind.Small : fz < 0.6 && fx >= 0.6 ? (hu > 0.5 ? Kind.Long : Kind.Small) : Kind.Small
      if (tries === 1) kind = Kind.Small
    }
    return null
  }

  return {
    items,
    get radius() {
      return radius
    },
    advance(need: number, deadline: number): boolean {
      if (need <= coveredPop) return true
      const target = Math.min(houseCount(Math.min(need, peak)), 100000)
      while (built < target && nextLot < lots.length) {
        if (performance.now() > deadline) return false
        const l = lots[nextLot++]
        if (l.empty) continue
        const it = fitHouse(l, nextLot)
        if (!it) continue
        const [hw, hd] = KIND_HALF[it.kind]
        const rr = Math.max(hw * it.sx, hd * it.sz) * 0.8
        if (!site.clear(l.cx, l.cy, rr)) continue
        const pop = houseThreshold(built)
        flushPending(l.key, pop)
        // walls enclose what stands when the population first passes their threshold
        for (const w of walls) if (!w.done && pop >= w.threshold) { w.done = true; placeWall(w.threshold) }
        // the first craftsman's lot becomes the smithy, the first merchant's (or a big village's) the inn
        if (!smithy && pop >= 1200 && (it.ward === Ward.Craftsmen || (it.ward === Ward.Village && peak >= 1500))) {
          smithy = true
          it.role = Role.Blacksmith
          it.sx = it.sz = it.sy = 0.72
        } else if (!inn && pop >= 1800 && (it.ward === Ward.Merchant || it.ward === Ward.Market || it.ward === Ward.Village)) {
          inn = true
          it.role = Role.Tavern
          it.sx = it.sz = it.sy = 0.7
        }
        it.threshold = pop
        items.push(it)
        built++
        builtPerPatch[l.patch]++
        if (builtPerPatch[l.patch] === 2 || (lotsPerPatch[l.patch] <= 2 && builtPerPatch[l.patch] === 1)) addGround(l.patch, pop)
        radius = Math.max(radius, Math.hypot(l.cx, l.cy) + rr)
      }
      // ran out of lots, or reached the target: everything up to `need` is placed
      const popNow = Math.min(need, peak)
      flushPending(built >= target && nextLot < lots.length ? lots[nextLot].key : Infinity, built > 0 ? houseThreshold(built - 1) : 1)
      for (const w of walls) if (!w.done && popNow >= w.threshold) { w.done = true; placeWall(w.threshold) }
      coveredPop = need
      return true
    },
  }
}
