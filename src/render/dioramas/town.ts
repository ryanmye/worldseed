// The procedural settlement generator: one unique plan per settlement, deterministic from
// (world seed, settlement id) and shaped by its site. The approach follows the ideas of
// ward-based medieval town generators (patches -> wards -> lots), reimplemented here:
//
//  1. Patches: seed points on a jittered spiral out from the centre, a Voronoi tessellation
//     (convex cells by half-plane clipping, each edge tagged with the neighbouring cell),
//     two relaxation passes on the inner patches only, so the core is regular and the
//     outskirts irregular. Patches on water are dropped; the spiral goes on until it holds
//     enough dry patches for the town at its peak, so a town on a shore or a river mouth
//     spreads along the shore and inland instead of losing its houses to the water.
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
//     wards). Each lot gets one generated building fitted to it at its street front (a main
//     street's first), its door to the street: terraces wall to wall in the dense wards
//     and the core, courtyard blocks in a city's core, set back with a front yard further
//     out, free-standing on farms; more storeys toward the centre, the more so the larger
//     the city. Built patches lay their ground: the patch as street, its block as yard (so
//     streets show between the blocks), squares paved, kitchen gardens and fruit trees on
//     the empty lots of the leafy and outer wards.
//  5. Growth (census.ts): every building houses its roof units times its storeys in
//     households of HOUSEHOLD people. Lots are ranked by distance from the centre blended
//     with their patch's, so the town fills patch by patch outward along the streets; a
//     building shows once the town's share of the population (urbanPopulation) reaches the
//     households of the buildings before it plus half its own. Landmarks appear once their
//     ward is reached and the population passes their own minimum; walls enclose the
//     patches built when the population first passes the wall threshold (a second ring
//     later).
//
// The plan is computed lazily and incrementally (lot validity needs ground probes, the
// costly part): `advance(need, deadline)` first runs the set-up (patches, streets, wards,
// lots) in stages of a millisecond or two, then validates lots in rank order until the
// plan covers population `need` or the time budget runs out. Whatever has been computed
// is final: further work only appends items and ground.

import { CITY_POPULATION, TOWN_POPULATION } from '../../contract.ts'
import { HOUSEHOLD, households, STOREY as STOREY_H, storeys, urbanPopulation, urbanThreshold } from './census.ts'
import { houseFacade, Kind, roofUnits, Style, type Style as StyleT } from './shapes.ts'
import { hash4, rand4 } from './surface.ts'

/** Mean patch spacing (KayKit units). */
const PATCH = 1.75
/** Households of the town at peak population p (census.ts). */
const townHouseholds = (p: number) => urbanPopulation(p) / HOUSEHOLD
/**
 * Households an inner patch of a plan for peak p is expected to hold (its dry share aside):
 * detached one-storey houses in a village, two-storey rows in a town, three- and four-storey
 * terraces and courtyard blocks in a city core. Only sizes the plan; the lots decide.
 */
export function householdsPerPatch(p: number): number {
  if (p >= CITY_POPULATION * 0.85) return 13 + 9 * Math.min(1, Math.max(0, p - CITY_POPULATION) / 60000)
  if (p >= TOWN_POPULATION * 0.8) return 8
  return 5
}
/** Whether a patch seed stands on buildable ground: dry land, off the river (rivers as drawn up close are wide). */
const seedDry = (site: Site, x: number, y: number) => !site.wet(x, y, 0.05) && site.clear(x, y, PATCH * 0.3)
/** Expected radius of the town of peak population p on open dry land (KayKit units). */
export function townRadius(p: number): number {
  return (PATCH * Math.sqrt(townHouseholds(p) / householdsPerPatch(p) + 1.2) * 1.05 + 0.6) * planScale(p)
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
  /** Households it houses (census.ts; 0 for landmarks and everything else). */
  homes: number
  /** A terrace: the houses that stand for it, side by side (each its own instance and colours). */
  units?: PlanItem[]
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
  /** Farthest a patch seed may lie from the centre (KayKit units): the plan stays near its own cell. */
  maxRadius: number
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
  /** Street-facing edge: start point and length (along ux, uy). */
  fx: number
  fy: number
  fl: number
  /** Whether the street front is a main street. */
  main: boolean
  cx: number
  cy: number
  key: number
  patch: number
  empty: boolean
}

/** What a piece of town ground is (layout.ts colours and the ground shader texture it). */
export const GroundKind = {
  /** Packed earth or cobbles: the whole of a built patch, under its block (so streets show between blocks). */
  Street: 0,
  /** Paved square: plaza, market, cathedral close, citadel yard. */
  Plaza: 1,
  /** Worn ground of a built block (yards and gardens behind the houses). */
  Yard: 2,
  /** Kitchen garden or small field in crop rows (along ux, uy). */
  Garden: 3,
} as const

/** A ground polygon (convex, CCW, KayKit units in the settlement's tangent frame) that shows with its patch. */
export interface GroundPiece {
  kind: number
  poly: number[]
  threshold: number
  /** Row direction (Garden). */
  ux: number
  uy: number
}

export interface TownPlan {
  /** Items in the order they were added (thresholds are not sorted). */
  items: PlanItem[]
  /** Ground pieces in the order they were added (streets before the blocks on them). */
  ground: GroundPiece[]
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

const CITY_MIN_AREA: Record<number, number> = { [Ward.Craftsmen]: 0.8, [Ward.Merchant]: 0.95, [Ward.Patrician]: 1.5, [Ward.Harbour]: 0.9 }
const CITY_EMPTY_SHARE: Record<number, number> = { [Ward.Craftsmen]: 0.02, [Ward.Merchant]: 0.02, [Ward.Patrician]: 0.1, [Ward.Harbour]: 0.06 }

/** House kinds: half width (x) and half depth (z) of the base mesh (shapes.ts, Temperate; the other styles are close). */
const KIND_HALF: readonly [number, number][] = [[0.3, 0.22], [0.4, 0.27], [0.6, 0.27], [0.27, 0.33], [0, 0], [0, 0], [0, 0], [0.42, 0.36], [0.54, 0.26], [0.55, 0.55]]

/** Whether (x, y) is inside convex CCW polygon p (with margin m inside every edge). */
function insideConvex(p: number[], x: number, y: number, m: number): boolean {
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

/**
 * The plan of a site. Setting it up (the patches, streets, wards and lots) is split into
 * stages of a millisecond or two that run under the deadlines of the first advance()
 * calls, so a big city never stalls a frame; the plan is the same however it is split.
 */
export function createTownPlan(site: Site): TownPlan {
  // the plan is laid out in plan units and handed out at the town's footprint scale
  const U = planScale(site.peak), UL = Math.sqrt(U)
  // a city's monuments are larger than a town's (a cathedral, not a chapel)
  const monument = 1 + 0.3 * Math.min(1.2, Math.max(0, Math.log10(Math.max(1, site.peak) / 4000)))
  const raw: PlanItem[] = [], rawGround: GroundPiece[] = []
  const items: PlanItem[] = []
  const ground: GroundPiece[] = []
  const stages = planStages(scaledSite(site, U), raw, rawGround, UL)
  let plan: TownPlan | null = null
  const perf = globalThis as { __dioramaPlanMs?: number[] }
  const flush = () => {
    for (let k = items.length; k < raw.length; k++) {
      const it = raw[k]
      const o: PlanItem = { ...it, x: it.x * U, y: it.y * U }
      if (it.role === Role.House) { o.sx = it.sx * U; o.sz = it.sz * U; o.sy = it.sy * UL }
      else if (it.role === Role.WallSeg || it.role === Role.Bridge) { o.sx = it.sx * U; o.sz = it.sz * UL }
      else if (MONUMENT[it.role]) { o.sx = it.sx * monument; o.sz = it.sz * monument; o.sy = it.sy * monument }
      else { o.sx = it.sx * UL; o.sz = it.sz * UL; o.sy = it.sy * UL }
      items.push(o)
    }
    for (let k = ground.length; k < rawGround.length; k++) {
      const g = rawGround[k]
      ground.push({ ...g, poly: g.poly.map((v) => v * U) })
    }
  }
  return {
    items,
    ground,
    get radius() {
      return plan ? plan.radius * U : 0
    },
    advance(need: number, deadline: number): boolean {
      while (!plan) {
        if (performance.now() > deadline) return false
        const t0 = performance.now()
        const r = stages.next()
        if (perf.__dioramaPlanMs) perf.__dioramaPlanMs.push(+(performance.now() - t0).toFixed(2))
        if (r.done) plan = r.value
      }
      const done = plan.advance(need, deadline)
      flush()
      return done
    },
  }
}

/** Landmarks that grow with the town (temples, halls, the citadel, markets, towers, barracks). */
const MONUMENT: Record<number, boolean> = { [Role.Church]: true, [Role.Hall]: true, [Role.Castle]: true, [Role.Market]: true, [Role.Tower]: true, [Role.Barracks]: true }

/**
 * Footprint scale of the town of peak population p: a village's houses at full size, a
 * town's and a city's narrower and closer (0.7 from 10,000 up), so a city is a dense
 * fabric of many buildings rather than a village blown up. Heights shrink by its square
 * root only (storeys stay readable).
 */
export function planScale(p: number): number {
  const t = Math.min(1, Math.max(0, Math.log10(Math.max(1, p) / 1000)))
  return 1 - 0.3 * t
}

/** The site seen in plan units (scaled by 1/U). */
function scaledSite(site: Site, U: number): Site {
  if (U === 1) return site
  return {
    ...site,
    wet: (x, y, m) => site.wet(x * U, y * U, m),
    height: (x, y) => site.height(x * U, y * U),
    clear: (x, y, r) => site.clear(x * U, y * U, r * U),
    riverSegs: site.riverSegs.map((v) => v / U),
    maxRadius: site.maxRadius / U,
  }
}

/** `hScale`: the height the plan's buildings are handed out at (storeys are counted at it). */
function* planStages(site: Site, items: PlanItem[], ground: GroundPiece[], hScale: number): Generator<void, TownPlan, void> {
  const { seed, id } = site
  const rnd = (a: number, b: number) => rand4(seed, id, a, b)
  const T = TOWN_POPULATION, C = CITY_POPULATION
  const peak = Math.max(1, site.peak)
  const isTown = peak >= T * 0.8
  const isCity = peak >= C * 0.85
  const rot = rnd(1, 0) * Math.PI * 2
  const seedX = (i: number) => {
    const r = i === 0 ? 0 : PATCH * Math.sqrt(i + 0.3) * (0.92 + 0.16 * rnd(i, 2))
    return r * Math.cos(rot + i * GOLDEN + (rnd(i, 3) - 0.5) * 0.5)
  }
  const seedY = (i: number) => {
    const r = i === 0 ? 0 : PATCH * Math.sqrt(i + 0.3) * (0.92 + 0.16 * rnd(i, 2))
    return r * Math.sin(rot + i * GOLDEN + (rnd(i, 3) - 0.5) * 0.5)
  }

  // ---- 1. patches ----
  // the spiral goes on until it holds the inner patches the peak needs on dry land, and a
  // ring of outskirts round them (water takes its share on a shore)
  const landmarkWards = isTown ? 2 + (peak >= 6000 ? 1 : 0) + (isCity ? 2 : 0) + Math.floor(site.trade * 2) : 0
  const wantInner = Math.max(1, Math.ceil((townHouseholds(peak) * 1.2) / householdsPerPatch(peak))) + landmarkWards
  const wantDry = wantInner + Math.ceil(2.2 * Math.sqrt(wantInner)) + 4
  let nSeeds = 0
  let innerReach = 0
  {
    let dry = 0
    for (let i = 0; ; i++) {
      if (i % 64 === 63) yield
      const x = seedX(i), y = seedY(i)
      if (Math.hypot(x, y) > site.maxRadius && i >= 12) { nSeeds = i; break }
      if (i === 0 || seedDry(site, x, y)) dry++
      if (dry <= wantInner) innerReach = i + 1
      if (dry >= wantDry && i >= 11) { nSeeds = i + 1; break }
    }
    // a closing ring, so the outermost dry patches are bounded by neighbours, not the rim
    nSeeds += Math.ceil(2 * Math.sqrt(nSeeds)) + 2
  }
  const sx: number[] = [], sy: number[] = []
  for (let i = 0; i < nSeeds; i++) {
    sx.push(seedX(i))
    sy.push(seedY(i))
  }
  const bound = PATCH * Math.sqrt(nSeeds) * 1.08 + PATCH * 0.6
  // seeds bucketed on a grid, for the neighbours of each cell
  const G = PATCH * 1.2
  const gN = Math.ceil((bound * 2) / G) + 1
  const gridOf = (v: number) => Math.min(gN - 1, Math.max(0, Math.floor((v + bound) / G)))
  let buckets: number[][] = []
  const rebucket = () => {
    buckets = Array.from({ length: gN * gN }, () => [])
    for (let i = 0; i < nSeeds; i++) buckets[gridOf(sy[i]) * gN + gridOf(sx[i])].push(i)
  }
  const cand: number[] = []
  const candD: number[] = []
  const candOrder: number[] = []
  /** The Voronoi cell of seed i: the bounding 12-gon clipped by the half-planes of the seeds nearby, nearest rings first. */
  const cellOf = (i: number): Poly => {
    const p: number[] = [], t: number[] = []
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      p.push(Math.cos(a) * bound, Math.sin(a) * bound)
      t.push(-1)
    }
    let poly: Poly = { p, t }
    const xi = sx[i], yi = sy[i]
    const gx = gridOf(xi), gy = gridOf(yi)
    let reach = Infinity
    for (let ring = 0; ring < gN; ring++) {
      // every seed in this ring of grid cells is at least (ring - 1) * G away
      if ((ring - 1) * G > 2 * reach) break
      cand.length = 0
      candD.length = 0
      for (let qy = gy - ring; qy <= gy + ring; qy++) {
        if (qy < 0 || qy >= gN) continue
        for (let qx = gx - ring; qx <= gx + ring; qx++) {
          if (qx < 0 || qx >= gN) continue
          if (Math.max(Math.abs(qx - gx), Math.abs(qy - gy)) !== ring) continue
          for (const j of buckets[qy * gN + qx]) {
            if (j === i) continue
            cand.push(j)
            candD.push((sx[j] - xi) ** 2 + (sy[j] - yi) ** 2)
          }
        }
      }
      candOrder.length = 0
      for (let k = 0; k < cand.length; k++) candOrder.push(k)
      candOrder.sort((a, b) => candD[a] - candD[b] || cand[a] - cand[b])
      for (const k of candOrder) {
        const j = cand[k]
        const dx = sx[j] - xi, dy = sy[j] - yi
        if (Math.sqrt(candD[k]) > 2 * reach) break
        // keep points nearer to i: (p - m) . (sj - si) <= 0
        const mx = (sx[j] + xi) / 2, my = (sy[j] + yi) / 2
        poly = clip(poly, dx, dy, dx * mx + dy * my, j)
        if (poly.p.length < 6) return poly
        reach = 0
        for (let q = 0; q < poly.p.length / 2; q++) reach = Math.max(reach, Math.hypot(poly.p[q * 2] - xi, poly.p[q * 2 + 1] - yi))
      }
    }
    return poly
  }
  const cells: Poly[] = new Array(nSeeds)
  const cc = [0, 0]
  for (let pass = 0; pass < 3; pass++) {
    if (pass > 0) {
      // relax the inner seeds (a regular core), the outskirts stay irregular
      for (let i = 1; i < Math.min(nSeeds, innerReach + 2); i++) {
        if (cells[i].p.length < 6) continue
        centroid(cells[i].p, cc)
        sx[i] = cc[0]
        sy[i] = cc[1]
      }
    }
    rebucket()
    for (let i = 0; i < nSeeds; i++) {
      if (i % 24 === 23) yield
      cells[i] = cellOf(i)
    }
    yield
  }
  /** Whether (x, y) lies on a river as drawn up close (its channel and a margin for the houses' footprints). */
  const onRiver = (x: number, y: number) => {
    const S = site.riverSegs
    for (let k = 0; k < S.length; k += 5) {
      const ax = S[k], ay = S[k + 1], dx = S[k + 2] - ax, dy = S[k + 3] - ay
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
      if (Math.hypot(x - ax - dx * t, y - ay - dy * t) < S[k + 4] + 0.3) return true
    }
    return false
  }
  const patches: Patch[] = []
  for (let i = 0; i < cells.length; i++) {
    if (i % 8 === 7) yield
    const poly = cells[i]
    centroid(poly.p, cc)
    let r = 0
    for (let k = 0; k < poly.p.length / 2; k++) r = Math.max(r, Math.hypot(poly.p[k * 2] - cc[0], poly.p[k * 2 + 1] - cc[1]))
    const wetC = poly.p.length < 6 || site.wet(cc[0], cc[1], 0.05)
    // water if the centre and most of the rim are wet
    let wetRim = 0, riverRim = 0
    const nv = poly.p.length / 2
    for (let k = 0; k < nv; k++) {
      const x = cc[0] + (poly.p[k * 2] - cc[0]) * 0.7, y = cc[1] + (poly.p[k * 2 + 1] - cc[1]) * 0.7
      if (site.wet(x, y, 0)) wetRim++
      else if (onRiver(x, y)) riverRim++
    }
    const water = wetC && wetRim >= nv * 0.5
    // the share of it that can be built on (the rim samples off the sea, lakes and river; the centre counts twice)
    const dry = (nv - wetRim - riverRim + (wetC || onRiver(cc[0], cc[1]) ? 0 : 2)) / (nv + 2)
    patches.push({ poly, cx: cc[0], cy: cc[1], r, water, dry, ward: Ward.Outskirts as Ward, key: Math.hypot(cc[0], cc[1]) + (i === 0 ? -1 : 0), inner: false })
  }
  yield
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
    if (i % 128 === 127) yield
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
  const heapD: number[] = [], heapV: number[] = []
  const heapPush = (d: number, v: number) => {
    let i = heapD.length
    heapD.push(d)
    heapV.push(v)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heapD[p] < d || (heapD[p] === d && heapV[p] <= v)) break
      heapD[i] = heapD[p]; heapV[i] = heapV[p]
      i = p
    }
    heapD[i] = d; heapV[i] = v
  }
  const heapPop = (): number => {
    const top = heapV[0]
    const d = heapD.pop()!, v = heapV.pop()!
    const n = heapD.length
    if (n > 0) {
      let i = 0
      for (;;) {
        const l = i * 2 + 1, r = l + 1
        let m = i, md = d, mv = v
        if (l < n && (heapD[l] < md || (heapD[l] === md && heapV[l] < mv))) { m = l; md = heapD[l]; mv = heapV[l] }
        if (r < n && (heapD[r] < md || (heapD[r] === md && heapV[r] < mv))) { m = r; md = heapD[r]; mv = heapV[r] }
        if (m === i) break
        heapD[i] = heapD[m]; heapV[i] = heapV[m]
        i = m
      }
      heapD[i] = d; heapV[i] = v
    }
    return top
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
    // Dijkstra from the plaza's corners (a binary heap of (distance, vertex))
    const dist = new Float64Array(vx.length).fill(Infinity)
    const prev = new Int32Array(vx.length).fill(-1)
    const done = new Uint8Array(vx.length)
    heapD.length = 0
    heapV.length = 0
    for (const v of plazaVerts) { dist[v] = 0; heapPush(0, v) }
    while (heapV.length) {
      const du = heapD[0], u = heapPop()
      if (done[u] || du > dist[u]) continue
      if (u === target) break
      done[u] = 1
      for (const w of adj[u]) {
        // prefer edges heading the right way (straighter main streets)
        const ex = vx[w] - vx[u], ey = vy[w] - vy[u]
        const l = Math.hypot(ex, ey)
        const cost = l * (1.25 - 0.35 * ((ex * dx + ey * dy) / (l || 1)))
        if (du + cost < dist[w]) { dist[w] = du + cost; prev[w] = u; heapPush(du + cost, w) }
      }
    }
    for (let v = target; prev[v] >= 0; v = prev[v]) mainEdges.add(edgeKey(v, prev[v]))
    yield
  }

  // ---- 3. wards ----
  const order: number[] = []
  for (let i = 0; i < P; i++) if (!patches[i].water) order.push(i)
  order.sort((a, b) => patches[a].key - patches[b].key)
  yield
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
    return { items, ground, radius: 0, advance: () => true }
  }
  // inner patches: in rank order until their estimated room (dry share, rivers) holds the
  // peak's households with a margin, plus the plaza and landmark wards of a town
  const target = townHouseholds(peak)
  const perPatch = householdsPerPatch(peak) / (Math.PI * PATCH * PATCH)
  const innerSet: number[] = []
  {
    let room = 0
    for (const i of order) {
      if (room >= target * 1.15 + 1 && innerSet.length >= 1 + landmarkWards * 0.5) break
      innerSet.push(i)
      const pa = patches[i]
      const a = Math.abs(area(pa.poly.p))
      room += a * perPatch * pa.dry
      if (innerSet.length > 1600) break
    }
    // the landmark wards hold no houses: make room for them too
    for (let k = 0, j = innerSet.length; k < landmarkWards && j < order.length; k++, j++) innerSet.push(order[j])
  }
  for (const i of innerSet) patches[i].inner = true
  yield
  const touchesWater = (i: number) => patches[i].poly.t.some((t) => t >= 0 && patches[t].water) || patches[i].poly.t.some((t) => t === -1) && site.wet(patches[i].cx * 1.3, patches[i].cy * 1.3, 0)
  const onMain = (i: number) => {
    const ids = patchEdgeVerts[i]
    for (let k = 0; k < ids.length; k++) if (mainEdges.has(edgeKey(ids[k], ids[(k + 1) % ids.length]))) return true
    return false
  }
  // the inner town's radius (a town on a shore is lopsided: its farthest inner patches)
  let Rin = PATCH * Math.sqrt(innerSet.length + 1)
  {
    const ds = innerSet.map((i) => Math.hypot(patches[i].cx, patches[i].cy)).sort((a, b) => a - b)
    Rin = Math.max(Rin, ds[Math.floor(ds.length * 0.9)] ?? 0)
  }
  // the pool of ward types for the inner patches beyond the plaza
  const pool: Ward[] = []
  if (!isTown) {
    for (let k = 0; k < innerSet.length; k++) pool.push(Ward.Village)
  } else {
    const n = innerSet.length - 1
    const add = (w: Ward, count: number) => { for (let k = 0; k < count; k++) pool.push(w) }
    // a big city has its parish churches and several markets
    add(Ward.Cathedral, (peak >= 12000 + 8000 * rnd(4, 1) ? 2 : 1) + Math.min(5, Math.floor(n / 60)))
    if (peak >= 6000) add(Ward.Admin, 1)
    add(Ward.Market, Math.min(3, Math.floor(site.trade * 3 + rnd(4, 2) * 0.8 + (n > 12 ? 1 : 0))) + Math.min(3, Math.floor(n / 90)))
    if (isCity) add(Ward.Military, 1)
    if (site.port) add(Ward.Harbour, Math.max(1, Math.min(Math.round(n * 0.12), 6 + Math.round(n * 0.04))))
    add(Ward.Park, n > 14 && rnd(4, 3) < 0.6 ? 1 + Math.floor(n / 150) : 0)
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
  // each patch takes the best rated ward type left in the pool (a little noise per type)
  const left = new Int32Array(Ward.Farm + 1)
  for (const w of pool) left[w]++
  for (let k = isTown ? 1 : 0; k < innerSet.length; k++) {
    if (k % 32 === 31) yield
    const i = innerSet[k]
    if (patches[i].ward === Ward.Citadel) continue
    let bw = -1, bs = -Infinity
    for (let w = 0; w < left.length; w++) {
      if (left[w] <= 0) continue
      const s = rating(w as Ward, i) + rnd(i, w + 40) * 0.3
      if (s > bs) { bs = s; bw = w }
    }
    if (bw >= 0) left[bw]--
    patches[i].ward = bw >= 0 ? (bw as Ward) : Ward.Craftsmen
  }
  for (const i of order) if (!patches[i].inner) patches[i].ward = Math.hypot(patches[i].cx, patches[i].cy) < Rin + PATCH * 1.2 ? Ward.Outskirts : Ward.Farm

  // ---- 4. lots ----
  const lots: Lot[] = []
  const dense = (w: Ward) => w === Ward.Merchant || w === Ward.Slum || w === Ward.Craftsmen
  /** Per patch: neighbour tags across a main street; the block (lots' area) of the patch. */
  const mainNb: Set<number>[] = patches.map(() => new Set<number>())
  const blocks: (Poly | null)[] = patches.map(() => null)
  for (let i = 0; i < P; i++) {
    const ids = patchEdgeVerts[i]
    for (let k = 0; k < ids.length; k++) if (mainEdges.has(edgeKey(ids[k], ids[(k + 1) % ids.length]))) mainNb[i].add(patches[i].poly.t[k])
  }
  let lotStage = 0
  for (const i of order) {
    if (++lotStage % 6 === 0) yield
    const pa = patches[i]
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
    blocks[i] = block
    // a city's dense wards are cut into wider lots, for terraces and courtyard blocks
    const minA = (isCity ? CITY_MIN_AREA[w] : undefined) ?? MIN_AREA[w] ?? 0.6
    const emptyP = (isCity ? CITY_EMPTY_SHARE[w] : undefined) ?? EMPTY_SHARE[w] ?? 0.2
    const stack: { poly: Poly; depth: number }[] = [{ poly: block, depth: 0 }]
    let li = 0
    while (stack.length) {
      const { poly, depth } = stack.pop()!
      const a = area(poly.p)
      const jitterA = 0.8 + 0.6 * rnd(i * 977 + li, 8)
      if (a < minA * 2 * jitterA || depth > 9) {
        if (a < minA * 0.45) continue
        // street front: the longest edge that is not a lot cut (a main street's first)
        const nv = poly.p.length / 2
        let ux = 0, uy = 0, bl = 0, ax = 0, ay = 0, al = 0, fk = -1, ak = 0
        for (let k = 0; k < nv; k++) {
          const j = (k + 1) % nv
          const ex = poly.p[j * 2] - poly.p[k * 2], ey = poly.p[j * 2 + 1] - poly.p[k * 2 + 1]
          const l = Math.hypot(ex, ey)
          if (l > al) { al = l; ax = ex / l; ay = ey / l; ak = k }
          const t = poly.t[k]
          const lw = t !== -2 && mainNb[i].has(t) ? l * 1.8 : l
          if (t !== -2 && lw > bl) { bl = lw; ux = ex / l; uy = ey / l; fk = k }
        }
        if (fk < 0) { ux = ax; uy = ay; fk = ak }
        const fl = Math.hypot(poly.p[((fk + 1) % nv) * 2] - poly.p[fk * 2], poly.p[((fk + 1) % nv) * 2 + 1] - poly.p[fk * 2 + 1])
        centroid(poly.p, cc)
        const d = Math.hypot(cc[0], cc[1])
        const e = rnd(i * 977 + li, 9) < emptyP
        lots.push({ poly: poly.p, ux, uy, fx: poly.p[fk * 2], fy: poly.p[fk * 2 + 1], fl, main: poly.t[fk] !== -2 && mainNb[i].has(poly.t[fk]), cx: cc[0], cy: cc[1], key: d * 0.55 + pa.key * 0.45 + rnd(i * 977 + li, 10) * 0.25, patch: i, empty: e })
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
  yield

  // ---- 5. landmarks with their keys (ranked into the lot order later) ----
  interface Pending { item: PlanItem; key: number; minPop: number; r: number }
  const pend: Pending[] = []
  const style = site.style
  const mk = (role: Role, x: number, y: number, yaw: number, key: number, minPop: number, r: number, scale = 1, kind = 0, ward: number = -1) => {
    pend.push({ item: { role, kind, style, x, y, yaw, sx: scale, sz: scale, sy: scale, threshold: 0, roof: hash4(seed, id, 0x33, 0) % 5, wall: hash4(seed, id, 0x34, 0) % 4, jitter: rnd(pend.length, 0x35), ward, homes: 0 }, key, minPop, r })
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
  // bridges where main streets cross the river: square to the stream at the crossing,
  // spanning the channel and a little of each bank; one per crossing place (the busiest
  // street's), so streets that meet at the river share it
  if (site.riverSegs.length) {
    const S = site.riverSegs
    const kept: number[] = []
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
        let dup = false
        for (let q = 0; q < kept.length && !dup; q += 2) if (Math.hypot(kept[q] - px, kept[q + 1] - py) < 2.6) dup = true
        if (dup) continue
        kept.push(px, py)
        // (the bridge model is 1.2 units long overall: the channel and a short ramp each side)
        const span = (S[k + 4] * 2.1 + 0.36) / 1.2
        // deck along x, across the stream
        mk(Role.Bridge, px, py, Math.atan2(d2y, d2x) + Math.PI / 2, Math.hypot(px, py), 600, 0.1, 1)
        const it = pend[pend.length - 1].item
        it.sx = span
        it.sz = 0.42
        it.sy = 1
      }
    }
  }

  yield
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
    // each ring encloses the town built when the population first passes it; the older
    // rings stay inside as relics
    let t = t1
    for (let ring = 1; ring < 5; ring++) {
      t = ring === 1 ? Math.max(t1 * 2.4, 22000 + 6000 * rnd(10, 2)) : t * (2.1 + 0.3 * rnd(10, 2 + ring))
      if (peak >= t * 1.05) walls.push({ threshold: t, done: false })
    }
  }
  let coveredPop = 0
  let smithy = false, inn = false

  // lots by patch (for the gardens and yard trees of a patch when its ground is laid)
  const lotsOf: Lot[][] = patches.map(() => [])
  for (const l of lots) lotsOf[l.patch].push(l)
  const paved = (w: Ward) => w === Ward.Plaza || w === Ward.Market || w === Ward.Cathedral || w === Ward.Admin || w === Ward.Citadel
  const leafy = (w: Ward) => w === Ward.Patrician || w === Ward.Park || w === Ward.Village || w === Ward.Outskirts || w === Ward.Farm
  const addGround = (i: number, threshold: number) => {
    if (groundDone[i]) return
    groundDone[i] = 1
    const pa = patches[i]
    const w = pa.ward
    if (paved(w)) {
      ground.push({ kind: GroundKind.Plaza, poly: pa.poly.p, threshold, ux: 1, uy: 0 })
      return
    }
    // the whole patch is street (the half of each street on this side), its block yards
    ground.push({ kind: GroundKind.Street, poly: pa.poly.p, threshold, ux: 1, uy: 0 })
    // main streets are laid full width even where the far side is not built yet
    const ids = patchEdgeVerts[i]
    const n = ids.length
    for (let k = 0; k < n; k++) {
      const t = pa.poly.t[k]
      if (!mainNb[i].has(t) || (t >= 0 && (groundDone[t] || patches[t].water))) continue
      const a = ids[k], b = ids[(k + 1) % n]
      const ex = vx[b] - vx[a], ey = vy[b] - vy[a]
      const l = Math.hypot(ex, ey)
      if (l < 1e-6) continue
      // outward normal of a CCW edge
      const ox = (ey / l) * 0.26, oy = (-ex / l) * 0.26
      const sx0 = (ex / l) * 0.1, sy0 = (ey / l) * 0.1
      ground.push({ kind: GroundKind.Street, poly: [vx[a] - sx0, vy[a] - sy0, vx[b] + sx0, vy[b] + sy0, vx[b] + sx0 + ox, vy[b] + sy0 + oy, vx[a] - sx0 + ox, vy[a] - sy0 + oy], threshold, ux: 1, uy: 0 })
    }
    const block = blocks[i]
    if (!block) return
    ground.push({ kind: GroundKind.Yard, poly: block.p, threshold, ux: 1, uy: 0 })
    // kitchen gardens on the empty lots of the outer and leafy wards (not the fields round a
    // town: the planet's own fields stand for its farmland); a fruit tree or two in some
    if (!leafy(w)) return
    const gardens = !(isTown && (w === Ward.Farm || w === Ward.Outskirts))
    for (const l of lotsOf[i]) {
      if (!l.empty) continue
      const u = rand4(seed, id, Math.round(l.cx * 977 + l.cy * 131), 0x5a)
      if (w !== Ward.Park && u < 0.62) { if (gardens) ground.push({ kind: GroundKind.Garden, poly: l.poly, threshold, ux: l.ux, uy: l.uy }) }
      else if ((u < 0.9 || w === Ward.Park) && site.clear(l.cx, l.cy, 0.22)) items.push({ role: Role.Grove, kind: 0, style, x: l.cx, y: l.cy, yaw: u * 40, sx: 0.42 + 0.2 * u, sz: 0.42 + 0.2 * u, sy: 0.42 + 0.2 * u, threshold, roof: 0, wall: 0, jitter: u, ward: w, homes: 0 })
    }
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
        items.push({ role: Role.WallSeg, kind: 0, style, x: mx, y: my, yaw: Math.atan2(uy, ux), sx: pl * 1.02, sz: 1, sy: 1, threshold, roof: 0, wall: 0, jitter: 0, ward: -1, homes: 0 })
      }
    }
    // towers at every corner of the circuit (regularly spaced along it), gate towers where a
    // main street passes through; none crowding another
    // a gatehouse is a pair of towers flanking the street at the gap in the wall
    const spots: number[] = [] // x, y, gate
    for (const [a, b] of segs) {
      const l = Math.hypot(vx[b] - vx[a], vy[b] - vy[a])
      if (l < 0.2) continue
      const ux = (vx[b] - vx[a]) / l, uy = (vy[b] - vy[a]) / l
      if (gateVerts.has(a)) spots.push(vx[a] + ux * 0.3, vy[a] + uy * 0.3, 1)
      if (gateVerts.has(b)) spots.push(vx[b] - ux * 0.3, vy[b] - uy * 0.3, 1)
    }
    for (const v of towerVerts) if (!gateVerts.has(v)) spots.push(vx[v], vy[v], 0)
    const placed: number[] = []
    for (let q = 0; q < spots.length; q += 3) {
      const x = spots[q], y = spots[q + 1], gate = spots[q + 2] > 0
      let crowded = false
      for (let r = 0; r < placed.length && !crowded; r += 2) if (Math.hypot(placed[r] - x, placed[r + 1] - y) < (gate ? 0.3 : 0.8)) crowded = true
      if (crowded) continue
      if (!site.clear(x, y, 0.2)) continue
      placed.push(x, y)
      const h = gate ? 1.2 : 1
      items.push({ role: Role.WallTower, kind: 0, style, x, y, yaw: 0, sx: h, sz: h, sy: h, threshold, roof: hash4(seed, id, 0x33, 0) % 5, wall: 0, jitter: 0, ward: -1, homes: 0 })
      radius = Math.max(radius, Math.hypot(x, y) + 0.3)
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

  /** Savanna and rainforest towns build rectangular houses, compounds and terraces; huts stay in the villages and slums. */
  const hutStyle = (st: StyleT) => st === Style.Savanna || st === Style.Rainforest
  /**
   * A building for lot l: kind by ward, footprint fitted to the lot and set at its street
   * front (terraces and row houses wall to wall in the dense wards, courtyard blocks in a
   * city's core, set back with a front yard further out, standing free in the middle of a
   * farm lot); storeys by ward and nearness to the centre. The model's +z face (its door)
   * faces the street. Its households: roof units times storeys (census.ts).
   */
  const fitHouse = (l: Lot, k: number): PlanItem | null => {
    const ward = patches[l.patch].ward
    const hs = HOUSE_STYLE(k)
    const r = rnd(k, 0x51), r2 = rnd(k, 0x56)
    const dCore = Math.hypot(l.cx, l.cy) / Math.max(1, Rin)
    const outer = ward === Ward.Farm || ward === Ward.Outskirts || ward === Ward.Village
    let kind: number
    if (ward === Ward.Harbour) kind = Kind.Long
    else if (ward === Ward.Merchant) kind = r < 0.7 ? Kind.Tall : Kind.House
    else if (ward === Ward.Slum) kind = Kind.Small
    else if (ward === Ward.Patrician) kind = r < 0.45 ? Kind.Ell : r < 0.65 ? Kind.Tall : Kind.House
    else if (ward === Ward.Farm || ward === Ward.Outskirts) kind = r < 0.22 ? Kind.Long : r < 0.36 ? Kind.Ell : Kind.Small
    else if (ward === Ward.Craftsmen) kind = r < 0.25 ? Kind.Long : r < 0.55 ? Kind.Tall : Kind.House
    else kind = r < 0.35 ? Kind.Small : r < 0.8 ? Kind.House : r < 0.9 ? Kind.Ell : Kind.Long
    // the dry south builds round a courtyard
    if (hs === Style.Desert && kind !== Kind.Small && r2 < (ward === Ward.Patrician ? 0.8 : 0.4)) kind = Kind.Ell
    // the dense core: narrow, tall, gable to the street
    if (isTown && dCore < 0.45 && (kind === Kind.House || kind === Kind.Small) && ward !== Ward.Slum && r2 < 0.6) kind = Kind.Tall
    // terraces along the streets of a town's dense wards, where the frontage holds three houses
    const rowWard = ward === Ward.Craftsmen || ward === Ward.Merchant || ward === Ward.Harbour || (isCity && ward === Ward.Patrician)
    if (isTown && rowWard && l.fl >= 0.92 && r2 < (isCity ? 0.9 : 0.6) && !(ward === Ward.Harbour && r < 0.35)) kind = Kind.Row
    // courtyard blocks on the deep lots of a city's core
    if (isCity && (ward === Ward.Merchant || ward === Ward.Patrician || (ward === Ward.Craftsmen && dCore < 0.35)) && dCore < 0.65 && l.fl >= 0.95 && rnd(k, 0x57) < 0.45) kind = Kind.Block
    // huts only in the villages, the outskirts and the slums
    if (hutStyle(hs) && isTown && !outer && ward !== Ward.Slum && (kind === Kind.Small || kind === Kind.Long || kind === Kind.Ell)) kind = ward === Ward.Harbour ? Kind.Row : r < 0.5 ? Kind.Tall : Kind.House
    // street front: start point f, direction u along the street, v into the lot
    const ux = l.ux, uy = l.uy
    let vxd = -uy, vyd = ux
    if ((l.cx - l.fx) * vxd + (l.cy - l.fy) * vyd < 0) { vxd = -vxd; vyd = -vyd }
    const farm = ward === Ward.Farm || (ward === Ward.Outskirts && r2 > 0.6)
    const along = (l.cx - l.fx) * ux + (l.cy - l.fy) * uy
    // a wide frontage in the core: a broader house, ridge along the street
    if (kind === Kind.Tall && (l.fl * 0.985) / (2 * KIND_HALF[Kind.Tall][0]) > 1.75) kind = Kind.House
    let fillK = -1
    for (let tries = 0; tries < 6; tries++) {
      const multi = kind === Kind.Row || kind === Kind.Block
      const rowHouses = multi || dense(ward) || ward === Ward.Harbour || (isTown && (l.main || dCore < 0.55))
      const fill = rowHouses ? 0.985 : ward === Ward.Patrician ? 0.78 : 0.72
      const setback = rowHouses ? 0.012 : ward === Ward.Patrician ? 0.16 : 0.05 + 0.18 * r2
      if (fillK < 0) fillK = fill
      const [hw, hd] = KIND_HALF[kind]
      // lot depth behind the front, at the projection of the centroid
      const t0 = Math.min(Math.max(along, 0.05), l.fl - 0.05)
      const mx0 = l.fx + ux * t0 + vxd * 0.005, my0 = l.fy + uy * t0 + vyd * 0.005
      const depth = rayExtent(l.poly, mx0, my0, vxd, vyd)
      let sxk: number, szk: number, cx: number, cy: number
      if (farm && !multi) {
        // free-standing in the lot, as before
        const hu = Math.min(rayExtent(l.poly, l.cx, l.cy, ux, uy), rayExtent(l.poly, l.cx, l.cy, -ux, -uy))
        const hv = Math.min(rayExtent(l.poly, l.cx, l.cy, vxd, vyd), rayExtent(l.poly, l.cx, l.cy, -vxd, -vyd))
        sxk = (hu * fillK) / hw
        szk = (hv * fillK) / hd
        cx = l.cx
        cy = l.cy
      } else {
        const width = l.fl * fillK
        const deep = kind === Kind.Block ? 1.2 : rowHouses ? 2.6 : 1.9
        const d = Math.min(depth - setback - 0.03, deep * hd * Math.min(1.45, width / (2 * hw)))
        sxk = width / (2 * hw)
        szk = d / (2 * hd)
        const t = Math.min(Math.max(along, width / 2), l.fl - width / 2)
        const dd = setback + Math.min(szk, 1.45) * hd
        cx = l.fx + ux * t + vxd * dd
        cy = l.fy + uy * t + vyd * dd
      }
      const maxX = kind === Kind.Long ? 1.5 : kind === Kind.Tall ? 1.75 : kind === Kind.Row ? 1.6 : kind === Kind.Block ? 1.4 : 1.8
      const minS = kind === Kind.Block ? 0.78 : kind === Kind.Row ? 0.7 : 0.6
      if (sxk >= minS && szk >= minS) {
        sxk = Math.min(sxk, maxX)
        szk = Math.min(szk, kind === Kind.Block ? 1.3 : 1.45)
        // the footprint's corners must lie in the lot
        const ex = hw * sxk, ez = hd * szk
        let ok = true
        for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          if (!insideConvex(l.poly, cx + ux * ex * a + vxd * ez * b, cy + uy * ex * a + vyd * ez * b, -0.03)) { ok = false; break }
        }
        if (ok) {
          const fac = houseFacade(hs, kind as Kind)
          // storeys: one out of town and in the slums; in a town two, three in its core; in a
          // city two to four from its edge to its core, a storey more in a metropolis, the
          // merchants' and patricians' a storey above their neighbours; detached houses at
          // most two. The height is set so the facade shows just that many rows of windows.
          let st = 1
          if (isTown && !(ward === Ward.Slum || farm || outer)) {
            const zone = dCore < 0.38 ? 2 : dCore < 0.72 ? 1 : 0
            st = (isCity ? [1.2, 1.8, 2.4][zone] + (peak >= 40000 ? 0.7 : 0) : [1, 1, 1.5][zone]) + (ward === Ward.Merchant || ward === Ward.Patrician ? (isCity ? 0.4 : 0.2) : 0)
            const r3 = rnd(k, 0x58)
            st = Math.max(1, Math.floor(st + (r3 < 0.15 ? -1 : r3 > 0.9 ? 1 : 0) + rnd(k, 0x59) * 0.99))
            // detached houses: two storeys at most (the hut styles' one), their roofs not drawn out into spires
            const detached = kind === Kind.Small || kind === Kind.House || kind === Kind.Long || kind === Kind.Ell
            st = Math.min(st, detached ? (hutStyle(hs) ? 1 : 2) : 4, hutStyle(hs) ? 3 : 4)
          }
          let sy = (0.92 + 0.16 * rnd(k, 0x52)) * Math.min(1.2, Math.max(0.88, Math.sqrt(Math.min(sxk, szk))))
          if (ward === Ward.Slum || farm || ward === Ward.Village || ward === Ward.Outskirts) sy *= 0.9
          if (st >= 2 && fac[1] > fac[0]) sy = Math.min(kind === Kind.Tall || kind === Kind.Row || kind === Kind.Block ? 2.3 : 1.55, (STOREY_H * st + 0.025 + 0.07 * rnd(k, 0x5a)) / (fac[1] - fac[0]) / hScale)
          // yaw: x along the street; +z (the door) toward the street (z = x turned -90 degrees)
          let yaw = Math.atan2(uy, ux)
          if (Math.sin(yaw) * vxd - Math.cos(yaw) * vyd > 0) yaw += Math.PI
          const homes = households(roofUnits(hs, kind as Kind), storeys(fac[0], fac[1], sy * hScale))
          const item: PlanItem = { role: Role.House, kind, style: hs, x: cx, y: cy, yaw, sx: sxk, sz: szk, sy, threshold: 0, roof: hash4(seed, id, k, 0x53) % 5, wall: hash4(seed, id, k, 0x54) % 4, jitter: rnd(k, 0x55), ward, homes }
          if (kind === Kind.Row) {
            // a terrace is three narrow houses wall to wall, each its own height and colours,
            // so its houses can be counted
            const W = 2 * KIND_HALF[Kind.Row][0] * sxk, D = 2 * KIND_HALF[Kind.Row][1] * szk
            const [thw, thd] = KIND_HALF[Kind.Tall]
            const ft = houseFacade(hs, Kind.Tall)
            const cu = Math.cos(yaw), su = Math.sin(yaw)
            const units: PlanItem[] = []
            let total = 0
            for (let q = 0; q < 3; q++) {
              const kq = k * 3 + q
              const o = ((q - 1) * W) / 3
              const r4 = rnd(kq, 0x5b)
              const stq = Math.max(1, Math.min(hutStyle(hs) ? 3 : 4, st + (r4 < 0.22 ? -1 : r4 > 0.82 ? 1 : 0)))
              const syq = Math.min(2.3, (STOREY_H * stq + 0.12 - 0.06 * rnd(kq, 0x5d)) / (ft[1] - ft[0]) / hScale)
              const hq = households(1, storeys(ft[0], ft[1], syq * hScale))
              units.push({ ...item, kind: Kind.Tall, x: cx + cu * o, y: cy + su * o, sx: (W / 3) / (2 * thw), sz: D / (2 * thd), sy: syq, roof: hash4(seed, id, kq, 0x53) % 5, wall: hash4(seed, id, kq, 0x54) % 4, jitter: rnd(kq, 0x55), homes: hq })
              total += hq
            }
            item.units = units
            item.homes = total
          }
          return item
        }
      }
      // narrower first (a terrace twice), then a smaller kind, then free-standing
      fillK *= 0.84
      if (tries === 0 && kind === Kind.Block) { kind = Kind.Row; fillK = -1 }
      else if (tries === 1 && kind !== Kind.Row) kind = kind !== Kind.House && kind !== Kind.Small ? Kind.House : Kind.Small
      else if (tries === 2) kind = kind === Kind.Row ? (isTown && !hutStyle(hs) ? Kind.Tall : Kind.House) : hutStyle(hs) && isTown && !outer && ward !== Ward.Slum ? Kind.House : Kind.Small
      else if (tries === 3 && kind !== Kind.Small) kind = hutStyle(hs) && isTown && !outer && ward !== Ward.Slum ? Kind.House : Kind.Small
      if (tries >= 4 && !farm) return fitFree(l, k, hs, ward)
    }
    return null
  }

  /** The original centred fit (a lot too odd for a street-front house). */
  const fitFree = (l: Lot, k: number, hs: StyleT, ward: Ward): PlanItem | null => {
    const vxd = -l.uy, vyd = l.ux
    const hu = Math.min(rayExtent(l.poly, l.cx, l.cy, l.ux, l.uy), rayExtent(l.poly, l.cx, l.cy, -l.ux, -l.uy))
    const hv = Math.min(rayExtent(l.poly, l.cx, l.cy, vxd, vyd), rayExtent(l.poly, l.cx, l.cy, -vxd, -vyd))
    const kind = hutStyle(hs) && isTown && ward !== Ward.Slum && ward !== Ward.Village && ward !== Ward.Outskirts && ward !== Ward.Farm ? Kind.House : Kind.Small
    const [hw, hd] = KIND_HALF[kind]
    const fx = (hu * 0.8) / hw, fz = (hv * 0.8) / hd
    if (fx < 0.6 || fz < 0.6) return null
    const sxk = Math.min(fx, 1.5), szk = Math.min(fz, 1.4)
    const sy = 0.9 + 0.15 * rnd(k, 0x52)
    const fac = houseFacade(hs, kind)
    const homes = households(roofUnits(hs, kind), storeys(fac[0], fac[1], sy * hScale))
    return { role: Role.House, kind, style: hs, x: l.cx, y: l.cy, yaw: Math.atan2(l.uy, l.ux), sx: sxk, sz: szk, sy, threshold: 0, roof: hash4(seed, id, k, 0x53) % 5, wall: hash4(seed, id, k, 0x54) % 4, jitter: rnd(k, 0x55), ward, homes }
  }

  // (perf=1 diagnostics: window.__dioramaPlans[id])
  const diag = { peak, needHomes: Math.round(townHouseholds(peak)), seeds: nSeeds, patches: P, dryPatches: order.length, inner: innerSet.length, lots: lots.length, emptyLots: lots.filter((l) => l.empty).length, lotsUsed: 0, noFit: 0, notClear: 0, built: 0, homes: 0, exhausted: false, byWard: [] as number[], wardPatches: [] as number[], byKind: [] as number[] }
  for (const i of order) diag.wardPatches[patches[i].ward] = (diag.wardPatches[patches[i].ward] ?? 0) + 1
  const diagAll = (globalThis as { __dioramaPlans?: Record<number, typeof diag> }).__dioramaPlans
  if (diagAll) diagAll[id] = diag
  // the next building in lot order, fitted and validated but not yet standing
  let nextIt: PlanItem | null = null
  let nextKey = 0
  let nextR = 0
  let nextPatch = 0
  /** Households in the buildings standing so far. */
  let homes = 0
  let lastPop = 1

  return {
    items,
    ground,
    get radius() {
      return radius
    },
    advance(need: number, deadline: number): boolean {
      if (need <= coveredPop) return true
      const lim = Math.min(need, peak)
      for (;;) {
        if (!nextIt) {
          if (nextLot >= lots.length) break
          if (performance.now() > deadline) return false
          const l = lots[nextLot++]
          if (l.empty) continue
          const it = fitHouse(l, nextLot)
          if (!it) { diag.noFit++; continue }
          const [hw, hd] = KIND_HALF[it.kind]
          const rr = Math.max(hw * it.sx, hd * it.sz) * 0.8
          if (!site.clear(it.x, it.y, rr)) { diag.notClear++; continue }
          // it stands once the town holds the households before it and half its own
          it.threshold = Math.max(1, urbanThreshold(HOUSEHOLD * (homes + it.homes / 2)))
          nextIt = it
          nextKey = l.key
          nextR = rr
          nextPatch = l.patch
        }
        if (nextIt.threshold > lim) break
        const it = nextIt
        nextIt = null
        const pop = it.threshold
        flushPending(nextKey, pop)
        // walls enclose what stands when the population first passes their threshold
        for (const w of walls) if (!w.done && pop >= w.threshold) { w.done = true; placeWall(w.threshold) }
        // the first craftsman's lot becomes the smithy, the first merchant's (or a big village's) the inn
        if (it.units) { /* a terrace stays houses */ }
        else if (!smithy && pop >= 1200 && (it.ward === Ward.Craftsmen || (it.ward === Ward.Village && peak >= 1500))) {
          smithy = true
          it.role = Role.Blacksmith
          it.sx = it.sz = it.sy = 0.72
          it.homes = 0
        } else if (!inn && pop >= 1800 && (it.ward === Ward.Merchant || it.ward === Ward.Market || it.ward === Ward.Village)) {
          inn = true
          it.role = Role.Tavern
          it.sx = it.sz = it.sy = 0.7
          it.homes = 0
        }
        if (it.units) for (const u of it.units) { u.threshold = it.threshold; items.push(u) }
        else items.push(it)
        homes += it.homes
        diag.byWard[it.ward] = (diag.byWard[it.ward] ?? 0) + it.homes
        diag.byKind[it.kind] = (diag.byKind[it.kind] ?? 0) + (it.units ? it.units.length : 1)
        lastPop = pop
        built++
        builtPerPatch[nextPatch]++
        if (builtPerPatch[nextPatch] === 2 || (lotsPerPatch[nextPatch] <= 2 && builtPerPatch[nextPatch] === 1)) addGround(nextPatch, pop)
        radius = Math.max(radius, Math.hypot(it.x, it.y) + nextR)
      }
      // everything up to `need` is placed; the landmarks ranked before the next building
      // come with it (or, the lots used up, all that are left), as an unbroken run places them
      if (nextIt) flushPending(nextKey, nextIt.threshold)
      else flushPending(Infinity, lastPop)
      for (const w of walls) if (!w.done && (nextIt ? nextIt.threshold >= w.threshold : lim >= w.threshold)) { w.done = true; placeWall(w.threshold) }
      coveredPop = need
      diag.built = built
      diag.homes = homes
      diag.lotsUsed = nextLot
      diag.exhausted = nextIt === null && nextLot >= lots.length
      return true
    },
  }
}

/**
 * How far the town of a site reaches at its peak (KayKit units from its centre), for the
 * countryside to keep clear: the patch seeds walked as the plan walks them, to the dry ones
 * its inner town and a margin of outskirts need. Cheap (one ground probe per seed) and
 * the same however often it is asked.
 */
export function townExtent(site: Site): number {
  const U = planScale(site.peak)
  return U * planExtent(scaledSite(site, U))
}
function planExtent(site: Site): number {
  const peak = Math.max(1, site.peak)
  const rnd = (a: number, b: number) => rand4(site.seed, site.id, a, b)
  const rot = rnd(1, 0) * Math.PI * 2
  const isTown = peak >= TOWN_POPULATION * 0.8, isCity = peak >= CITY_POPULATION * 0.85
  const landmarkWards = isTown ? 2 + (peak >= 6000 ? 1 : 0) + (isCity ? 2 : 0) + Math.floor(site.trade * 2) : 0
  const want = (Math.max(1, Math.ceil((townHouseholds(peak) * 1.2) / householdsPerPatch(peak))) + landmarkWards) * 1.3
  let dry = 0, reach = PATCH
  for (let i = 0; dry < want; i++) {
    const r = i === 0 ? 0 : PATCH * Math.sqrt(i + 0.3) * (0.92 + 0.16 * rnd(i, 2))
    if (r > site.maxRadius) break
    const a = rot + i * GOLDEN + (rnd(i, 3) - 0.5) * 0.5
    // (one probe a seed: the river's share is allowed for by a wider margin)
    if (i === 0 || !site.wet(r * Math.cos(a), r * Math.sin(a), 0.05)) {
      dry++
      reach = Math.max(reach, r)
    }
  }
  return reach * (site.river ? 1.12 : 1) + PATCH * 1.1
}
