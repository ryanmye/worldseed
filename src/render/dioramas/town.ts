// The procedural settlement generator: one unique plan per settlement, deterministic from
// (world seed, settlement id) and shaped by its site.
//
// Portions ported from TownGeneratorOS by Oleg Dolya (watabou), GPL-3.0,
// https://github.com/watabou/TownGeneratorOS : junction optimisation and the smoothing of
// the arteries (Model.optimizeJunctions, Model.buildStreets), the curtain wall built on the
// outline of the walled patches, smoothed, with gates where the streets leave it and towers
// at its corners (CurtainWall, Model.findCircumference), the citadel with its own wall
// (Castle), the ward set and their location ratings (wards/*.hx rateLocation: temple and
// administration overlooking the plaza, merchants near it, slums far from it, patricians
// by parks and away from slums, military by the citadel or the wall, gate wards at the
// gates, markets apart), the insetting of blocks from their streets by street width
// (Ward.getCityBlock), the alley and lot cutter with each ward's lot size, grid chaos,
// size chaos and empty share (Ward.createAlleys, CommonWard and its subclasses: plan/geom.ts),
// parks cut radially and temple closes as a ring (Park, Cathedral) and the thinning of the
// lots of unenclosed and outer wards toward the roads and the town (Ward.filterOutskirts).
// Watabou's model has no water, no growth over time and no population; those are ours:
//
//  1. Patches: seed points on a jittered spiral out from the centre, a Voronoi tessellation
//     (convex cells by half-plane clipping, each edge tagged with the neighbouring cell),
//     two relaxation passes on the inner patches only, so the core is regular and the
//     outskirts irregular. Patches on water are dropped; the spiral goes on until it holds
//     room for the town at its peak and as much again to grow into. Short patch edges are
//     merged into one junction (Watabou's optimizeJunctions).
//  2. Streets: the patch edges. Main streets run from the central plaza out along the
//     settlement's actual route directions (trade routes, founding and colonising
//     journeys), shortest paths over the patch-edge graph, then smoothed (the blocks follow);
//     they are wider, they run on beyond the town as its roads, and where one crosses a
//     river it gets a bridge.
//  3. Growth: the patches are ranked by a growth distance from the plaza (Dijkstra over the
//     patches): cheap along the main streets, the river and a port's shore, dear on steep or
//     wet ground, with a little noise per patch. The town is the patches nearest in that
//     measure that hold its peak's households, so it reaches out along its roads and
//     waterfront and keeps off hillsides: an outline that grew, not a disc. Walls enclose
//     the patches that hold the town of each wall threshold (a ring per threshold, older
//     rings left inside), follow that outline, smoothed, with gates where main streets leave
//     and towers at the corners.
//  4. Wards: Watabou's ward set and ratings, the pool weighted by the settlement's wealth,
//     trade and famines (merchants and markets for trade, slums for hardship, a harbour on a
//     port's waterfront, craftsmen by the river), the citadel on the highest compact patch
//     of a city's edge with its own wall, gate wards by the gates inside and out. Patches
//     beyond the town are outskirts (thinned to ribbons along the roads and the town's edge)
//     and farms.
//  5. Lots: each block is the patch inset from its streets (main streets and the wall's
//     inner road wider than lanes), cut by the alley cutter with its ward's parameters into
//     lots: long narrow plots for the craftsmen and merchants, large regular ones for the
//     patricians, small chaotic ones for the slums. Each lot gets one generated building
//     fitted to it at its street front (a main street's first), its door to the street:
//     terraces wall to wall in the dense wards and the core, courtyard blocks in a city's
//     core, set back with a front yard further out, free-standing on farms; more storeys
//     toward the centre, the more so the larger the city. Built patches lay their ground:
//     the patch as street, each built lot its yard (so lanes and alleys show between the
//     lots), squares paved, quays along a harbour's water, kitchen gardens and fruit trees on
//     the empty lots of the leafy wards.
//  6. Growth over time (census.ts): every building houses its roof units times its storeys
//     in households of HOUSEHOLD people. Lots are ranked by their patch's growth distance and
//     their distance from where the town came into the patch, so the town fills patch by
//     patch outward along the streets; a building shows once the town's share of the
//     population (urbanPopulation) reaches the households of the buildings before it plus
//     half its own. Landmarks appear once their ward is reached and the population passes
//     their own minimum; walls when the population first passes their threshold.
//
// The plan is computed lazily and incrementally (lot validity needs ground probes, the
// costly part): `advance(need, deadline)` first runs the set-up (patches, streets, wards,
// lots) in stages of a millisecond or two, then validates lots in rank order until the
// plan covers population `need` or the time budget runs out. Whatever has been computed
// is final: further work only appends items and ground.

import { CITY_POPULATION, TOWN_POPULATION } from '../../contract.ts'
import { HOUSEHOLD, households, STOREY as STOREY_H, storeys, urbanPopulation, urbanThreshold } from './census.ts'
import { householdsPerPatch, PATCH, planScale, townHouseholds } from './footprint.ts'
import { area, centroid, compactness, createAlleys, CUT, inset, insideConvex, lineDistance, radialCut, rayExtent, ringCut, smoothLoop, type AlleyParams, type Poly } from './plan/geom.ts'
import { houseFacade, Kind, roofUnits, Style, type Style as StyleT } from './shapes.ts'
import { hash4, rand4 } from './surface.ts'

export { householdsPerPatch, planScale, townRadius } from './footprint.ts'

/** Patches the spiral holds per inner patch the town needs: the room it can grow into. */
const fieldShare = (p: number) => (p >= TOWN_POPULATION * 0.8 ? 1.8 : 1.5)
/** Whether a patch seed stands on buildable ground: dry land, off the river (rivers as drawn up close are wide). */
const seedDry = (site: Site, x: number, y: number) => !site.wet(x, y, 0.05) && site.clear(x, y, PATCH * 0.3)
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
  /** By a gate, inside or outside the wall: inns, stables, carters. */
  Gate: 15,
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
  /** Ground height at (x, y) (world units from the planet's centre), for high ground and slopes. */
  height(x: number, y: number): number
  /** World units per unit of x and y (for slopes). */
  unit: number
  /** Footprint of radius r at (x, y) is dry land and clear of rivers. */
  clear(x: number, y: number, r: number): boolean
  /** Distance to the nearest river centreline minus its half width, or Infinity; and river segments for bridges. */
  riverSegs: number[]
  /** Farthest a patch seed may lie from the centre (KayKit units): the plan stays near its own cell. */
  maxRadius: number
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
  /** Rank key (growth distance from the plaza). */
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
  /** Its yard is laid. */
  yard?: boolean
}

/** What a piece of town ground is (layout.ts colours and the ground shader texture it). */
export const GroundKind = {
  /** Packed earth or cobbles: the whole of a built patch, under its lots (so lanes and alleys show between them). */
  Street: 0,
  /** Paved square: plaza, market, cathedral close, citadel yard, quays. */
  Plaza: 1,
  /** Worn ground of a built lot (the yard and garden behind its house). */
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
  /** Ground pieces in the order they were added (streets before the lots on them). */
  ground: GroundPiece[]
  /** Radius of everything placed so far (KayKit units). */
  radius: number
  /** Whether the plan covers population `need` (computing more within the deadline, performance.now() ms). */
  advance(need: number, deadline: number): boolean
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/**
 * Watabou's lot areas are in his map units, where a patch is ~460 square units and a main
 * street 2 wide; ours ~9.6 square plan units: his areas divide by about 47 (lengths by ~6.9).
 */
const WS = 47
const WL = Math.sqrt(WS)
/** Street widths (Ward.MAIN_STREET, REGULAR_STREET, ALLEY) in plan units, and the half widths blocks are inset by. */
const MAIN_HALF = 0.3
const STREET_HALF = 0.12
const LANE_HALF = 0.08
const WALL_HALF = 0.22
const ALLEY = 0.6 / WL

/** House kinds: half width (x) and half depth (z) of the base mesh (shapes.ts, Temperate; the other styles are close). */
const KIND_HALF: readonly [number, number][] = [[0.3, 0.22], [0.4, 0.27], [0.6, 0.27], [0.27, 0.33], [0, 0], [0, 0], [0, 0], [0.42, 0.36], [0.54, 0.26], [0.55, 0.55]]

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
  const perf = globalThis as { __dioramaPlanMs?: number[]; __dioramaPlanSlow?: string[] }
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
        stageStart = t0
        const r = stages.next()
        if (perf.__dioramaPlanMs) {
          const ms = performance.now() - t0
          perf.__dioramaPlanMs.push(+ms.toFixed(2))
          if (ms > 2 && perf.__dioramaPlanSlow) perf.__dioramaPlanSlow.push(`${stageAt} ${ms.toFixed(2)}`)
        }
        if (r.done) plan = r.value
      }
      const done = plan.advance(need, deadline)
      flush()
      return done
    },
  }
}

/** The stage last entered (perf=1 diagnostics of slow stages). */
let stageAt = ''
/** When the running set-up stage began (performance.now() ms): a stage yields once it has run OVER ms. */
let stageStart = 0
const OVER = 1.0
const over = () => performance.now() - stageStart > OVER

/** Landmarks that grow with the town (temples, halls, the citadel, markets, towers, barracks). */
const MONUMENT: Record<number, boolean> = { [Role.Church]: true, [Role.Hall]: true, [Role.Castle]: true, [Role.Market]: true, [Role.Tower]: true, [Role.Barracks]: true }

/** The site seen in plan units (scaled by 1/U). */
function scaledSite(site: Site, U: number): Site {
  if (U === 1) return site
  return {
    ...site,
    wet: (x, y, m) => site.wet(x * U, y * U, m),
    height: (x, y) => site.height(x * U, y * U),
    unit: site.unit * U,
    clear: (x, y, r) => site.clear(x * U, y * U, r * U),
    riverSegs: site.riverSegs.map((v) => v / U),
    maxRadius: site.maxRadius / U,
  }
}

/** Population thresholds of the wall rings of a plan for peak p (rnd: the plan's hash). */
function wallThresholds(peak: number, rnd: (a: number, b: number) => number): number[] {
  const out: number[] = []
  const isTown = peak >= TOWN_POPULATION * 0.8, isCity = peak >= CITY_POPULATION * 0.85
  if (!(isCity || (isTown && peak >= 7000))) return out
  const t1 = 7000 + 3000 * rnd(10, 1)
  if (peak >= t1 * 1.05) out.push(t1)
  // each ring encloses the town of its threshold; the older rings stay inside as relics
  let t = t1
  for (let ring = 1; ring < 5; ring++) {
    t = ring === 1 ? Math.max(t1 * 2.4, 22000 + 6000 * rnd(10, 2)) : t * (2.1 + 0.3 * rnd(10, 2 + ring))
    if (peak >= t * 1.05) out.push(t)
  }
  return out
}

/** A closed wall circuit: its corners, which edges run along the shore (no wall), which corners are gates. */
interface WallLoop {
  x: number[]
  y: number[]
  shore: boolean[]
  gate: boolean[]
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
  stageAt = 'seeds'
  // the spiral goes on until it holds the inner patches the peak needs on dry land and as
  // much again to grow into (water takes its share on a shore)
  const landmarkWards = isTown ? 2 + (peak >= 6000 ? 1 : 0) + (isCity ? 2 : 0) + Math.floor(site.trade * 2) : 0
  const wantInner = Math.max(1, Math.ceil((townHouseholds(peak) * 1.2) / householdsPerPatch(peak))) + landmarkWards
  const wantDry = Math.ceil(wantInner * fieldShare(peak)) + Math.ceil(2.2 * Math.sqrt(wantInner)) + 4
  let nSeeds = 0
  let innerReach = 0
  {
    let dry = 0
    for (let i = 0; ; i++) {
      if (over()) yield
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
        poly = clipCell(poly, dx, dy, dx * mx + dy * my, j)
        if (poly.p.length < 6) return poly
        reach = 0
        for (let q = 0; q < poly.p.length / 2; q++) reach = Math.max(reach, Math.hypot(poly.p[q * 2] - xi, poly.p[q * 2 + 1] - yi))
      }
    }
    return poly
  }
  const cells: Poly[] = new Array(nSeeds)
  stageAt = 'cells'
  const cc = [0, 0]
  // relaxing the inner seeds (Watabou relaxes the central wards: a regular core, irregular
  // outskirts); only their cells are needed for it
  const relaxN = Math.min(nSeeds, innerReach + 2)
  for (let pass = 0; pass < 3; pass++) {
    if (pass > 0) {
      for (let i = 1; i < relaxN; i++) {
        if (cells[i].p.length < 6) continue
        centroid(cells[i].p, cc)
        sx[i] = cc[0]
        sy[i] = cc[1]
      }
    }
    rebucket()
    const upto = pass < 2 ? relaxN : nSeeds
    for (let i = 0; i < upto; i++) {
      if (over()) yield
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
  stageAt = 'classify'
  for (let i = 0; i < cells.length; i++) {
    if (over()) yield
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
    patches.push({ poly, cx: cc[0], cy: cc[1], r, water, dry, ward: Ward.Farm as Ward, key: 0, inner: false })
  }
  yield
  const P = patches.length

  // ---- 2. the patch-edge graph: shared vertices, junctions merged ----
  stageAt = 'graph'
  // vertices snapped to a fine grid so neighbouring cells share them
  const vKey = new Map<string, number>()
  const vx: number[] = [], vy: number[] = []
  const vid = (x: number, y: number) => {
    const k = `${Math.round(x * 50)},${Math.round(y * 50)}`
    let v = vKey.get(k)
    if (v === undefined) {
      v = vx.length
      vKey.set(k, v)
      vx.push(x)
      vy.push(y)
    }
    return v
  }
  const edgeKey = (a: number, b: number) => (a < b ? a * 100000 + b : b * 100000 + a)
  let patchEdgeVerts: number[][] = []
  for (let i = 0; i < P; i++) {
    if (over()) yield
    const { p } = patches[i].poly
    const n = p.length / 2
    const ids: number[] = []
    for (let k = 0; k < n; k++) ids.push(vid(p[k * 2], p[k * 2 + 1]))
    patchEdgeVerts.push(ids)
  }
  /** Each patch's polygon again from its vertex ids (after vertices moved or merged): edges that collapsed drop out, with their tags. */
  const alias = new Int32Array(vx.length)
  for (let v = 0; v < alias.length; v++) alias[v] = v
  function* rebuildPolys(): Generator<void, void, void> {
    const out: number[][] = []
    for (let i = 0; i < P; i++) {
      if (over()) yield
      const ids = patchEdgeVerts[i]
      const t = patches[i].poly.t
      const n = ids.length
      const ni: number[] = [], nt: number[] = [], np: number[] = []
      for (let k = 0; k < n; k++) {
        const a = alias[ids[k]], b = alias[ids[(k + 1) % n]]
        if (a === b) continue
        ni.push(a)
        nt.push(t[k])
        np.push(vx[a], vy[a])
      }
      if (ni.length < 3) patches[i].water = true
      patches[i].poly = { p: np, t: nt }
      out.push(ni)
    }
    patchEdgeVerts = out
  }
  // Watabou's optimizeJunctions: an edge much shorter than a street's block is merged into
  // one junction at its middle (each vertex merged once), so streets meet cleanly
  {
    const JUNC = PATCH * 0.24
    const merged = new Uint8Array(vx.length)
    for (let i = 0; i < P; i++) {
      if (patches[i].water) continue
      const ids = patchEdgeVerts[i]
      const n = ids.length
      for (let k = 0; k < n; k++) {
        const a = alias[ids[k]], b = alias[ids[(k + 1) % n]]
        if (a === b || merged[a] || merged[b]) continue
        if (Math.hypot(vx[b] - vx[a], vy[b] - vy[a]) >= JUNC) continue
        vx[a] = (vx[a] + vx[b]) / 2
        vy[a] = (vy[a] + vy[b]) / 2
        alias[b] = a
        merged[a] = merged[b] = 1
      }
    }
    yield
    yield* rebuildPolys()
  }
  yield
  const adj: number[][] = vx.map(() => [])
  for (let i = 0; i < P; i++) {
    if (over()) yield
    if (patches[i].water) continue
    const ids = patchEdgeVerts[i]
    const n = ids.length
    for (let k = 0; k < n; k++) {
      const a = ids[k], b = ids[(k + 1) % n]
      if (!adj[a].includes(b)) adj[a].push(b)
      if (!adj[b].includes(a)) adj[b].push(a)
    }
  }
  /** Patches round each vertex. */
  const vPatches: number[][] = vx.map(() => [])
  for (let i = 0; i < P; i++) for (const v of patchEdgeVerts[i]) vPatches[v].push(i)
  // dry neighbours of each patch (the tags survive the smoothing below)
  const nbrs: number[][] = patches.map((pa) => pa.poly.t.filter((t) => t >= 0 && !patches[t].water))
  const neighbours = (i: number) => nbrs[i]
  yield

  // ---- main streets over the patch-edge graph ----
  stageAt = 'streets'
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
  const mainVerts = new Uint8Array(vx.length)
  const streetPaths: number[][] = []
  const routes = site.routes.slice(0, isCity ? 6 : isTown ? 4 : 2)
  const plazaVerts = new Set(patchEdgeVerts[0])
  const outerR = bound * 0.92
  for (const ang of routes) {
    // target: the graph vertex farthest out near this direction
    const dx = Math.cos(ang), dy = Math.sin(ang)
    let target = -1, best = -Infinity
    for (let v = 0; v < vx.length; v++) {
      if ((v & 255) === 0 && over()) yield
      if (adj[v].length === 0 || alias[v] !== v) continue
      const r = Math.hypot(vx[v], vy[v])
      if (r > outerR) continue
      const along = vx[v] * dx + vy[v] * dy
      const off = Math.abs(-vx[v] * dy + vy[v] * dx)
      const score = along - off * 1.6
      if (score > best) { best = score; target = v }
    }
    if (target < 0) continue
    yield
    // Dijkstra from the plaza's corners (a binary heap of (distance, vertex))
    const dist = new Float64Array(vx.length).fill(Infinity)
    const prev = new Int32Array(vx.length).fill(-1)
    const done = new Uint8Array(vx.length)
    heapD.length = 0
    heapV.length = 0
    for (const v of plazaVerts) { dist[v] = 0; heapPush(0, v) }
    while (heapV.length) {
      if (over()) yield
      const du = heapD[0], u = heapPop()
      if (done[u] || du > dist[u]) continue
      if (u === target) break
      done[u] = 1
      for (const w of adj[u]) {
        // prefer edges heading the right way (straighter main streets); reuse streets already laid
        const ex = vx[w] - vx[u], ey = vy[w] - vy[u]
        const l = Math.hypot(ex, ey)
        const cost = l * (1.25 - 0.35 * ((ex * dx + ey * dy) / (l || 1))) * (mainEdges.has(edgeKey(u, w)) ? 0.7 : 1)
        if (du + cost < dist[w]) { dist[w] = du + cost; prev[w] = u; heapPush(du + cost, w) }
      }
    }
    const path: number[] = []
    for (let v = target; v >= 0; v = prev[v]) {
      path.push(v)
      mainVerts[v] = 1
      if (prev[v] >= 0) mainEdges.add(edgeKey(v, prev[v]))
    }
    if (path.length >= 2) streetPaths.push(path)
    yield
  }
  // Watabou's smoothStreet: the arteries' inner corners pulled toward their neighbours
  // (prev + 3 v + next) / 5, moving the patches' shared vertices with them
  {
    const nxs = new Float64Array(vx.length), nys = new Float64Array(vx.length)
    const moved = new Uint8Array(vx.length)
    for (const path of streetPaths) {
      for (let q = 1; q < path.length - 1; q++) {
        const v = path[q]
        if (moved[v] || plazaVerts.has(v)) continue
        const a = path[q - 1], b = path[q + 1]
        nxs[v] = (vx[a] + vx[v] * 3 + vx[b]) / 5
        nys[v] = (vy[a] + vy[v] * 3 + vy[b]) / 5
        moved[v] = 1
      }
    }
    for (let v = 0; v < vx.length; v++) if (moved[v]) { vx[v] = nxs[v]; vy[v] = nys[v] }
    yield* rebuildPolys()
  }
  yield
  const onMain = (i: number) => {
    const ids = patchEdgeVerts[i]
    for (let k = 0; k < ids.length; k++) if (mainEdges.has(edgeKey(ids[k], ids[(k + 1) % ids.length]))) return true
    return false
  }
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
  const touchesWater = (i: number) => patches[i].poly.t.some((t) => t >= 0 && patches[t].water) || (patches[i].poly.t.some((t) => t === -1) && site.wet(patches[i].cx * 1.3, patches[i].cy * 1.3, 0))
  if (patches[0].water || patches.every((p) => p.water)) {
    // all water as drawn (a settlement on a lake shore cell, say): nothing to build on
    return { items, ground, radius: 0, advance: () => true }
  }

  // ---- 3. growth: the patches ranked by their distance from the plaza as a town grows ----
  stageAt = 'growth'
  // steepness of each dry patch (world rise over run to its neighbours)
  const hgt = new Float64Array(P)
  for (let i = 0; i < P; i++) {
    if (over()) yield
    if (!patches[i].water) hgt[i] = site.height(patches[i].cx, patches[i].cy)
  }
  const slope = new Float64Array(P)
  const factor = new Float64Array(P)
  const riverNear = new Uint8Array(P)
  for (let i = 0; i < P; i++) {
    if (over()) yield
    const pa = patches[i]
    if (pa.water) continue
    let s = 0
    for (const j of neighbours(i)) {
      const d = Math.hypot(patches[j].cx - pa.cx, patches[j].cy - pa.cy) * site.unit
      if (d > 0) s = Math.max(s, Math.abs(hgt[j] - hgt[i]) / d)
    }
    slope[i] = s
    riverNear[i] = site.riverSegs.length && nearRiverPatch(i) ? 1 : 0
    let f = 0.8 + 0.4 * rnd(i, 0x80)
    if (onMain(i)) f *= 0.6
    if (riverNear[i]) f *= 0.85
    if (site.port && touchesWater(i)) f *= 0.75
    f *= 1 + 1.6 * (1 - pa.dry)
    // a slope of 1 in 8 doubles the cost of building up it, 1 in 4 quadruples it
    f *= 1 + Math.min(6, Math.max(0, s - 0.03) * 12)
    factor[i] = f
  }
  yield
  const pred = new Int32Array(P).fill(-1)
  {
    const dist = new Float64Array(P).fill(Infinity)
    const done = new Uint8Array(P)
    heapD.length = 0
    heapV.length = 0
    dist[0] = 0
    heapPush(0, 0)
    while (heapV.length) {
      if (over()) yield
      const du = heapD[0], u = heapPop()
      if (done[u] || du > dist[u]) continue
      done[u] = 1
      for (const w of neighbours(u)) {
        const cost = Math.hypot(patches[w].cx - patches[u].cx, patches[w].cy - patches[u].cy) * (factor[u] + factor[w]) * 0.5
        if (du + cost < dist[w]) { dist[w] = du + cost; pred[w] = u; heapPush(du + cost, w) }
      }
    }
    for (let i = 0; i < P; i++) patches[i].key = i === 0 ? -1 : Number.isFinite(dist[i]) ? dist[i] : 1e6 + Math.hypot(patches[i].cx, patches[i].cy)
  }
  // where the town came into each patch: the middle of the edge it shares with the patch it grew from
  const entryX = new Float64Array(P), entryY = new Float64Array(P)
  for (let i = 0; i < P; i++) {
    const pa = patches[i]
    entryX[i] = pa.cx
    entryY[i] = pa.cy
    const j = pred[i]
    if (j < 0) continue
    const k = pa.poly.t.indexOf(j)
    if (k < 0) { entryX[i] = patches[j].cx; entryY[i] = patches[j].cy; continue }
    const n = pa.poly.p.length / 2, k1 = (k + 1) % n
    entryX[i] = (pa.poly.p[k * 2] + pa.poly.p[k1 * 2]) / 2
    entryY[i] = (pa.poly.p[k * 2 + 1] + pa.poly.p[k1 * 2 + 1]) / 2
  }
  yield
  const order: number[] = []
  for (let i = 0; i < P; i++) if (!patches[i].water) order.push(i)
  order.sort((a, b) => patches[a].key - patches[b].key || a - b)
  yield
  // inner patches: in growth order until their estimated room (dry share, rivers) holds the
  // peak's households with a margin, plus the plaza and landmark wards of a town
  const target = townHouseholds(peak)
  const perPatch = householdsPerPatch(peak) / (Math.PI * PATCH * PATCH)
  const roomOf = (i: number) => Math.abs(area(patches[i].poly.p)) * perPatch * patches[i].dry
  const innerSet: number[] = []
  {
    let room = 0
    for (const i of order) {
      if (room >= target * 1.15 + 1 && innerSet.length >= 1 + landmarkWards * 0.5) break
      innerSet.push(i)
      room += roomOf(i)
      if (innerSet.length > 1600) break
    }
    // the landmark wards hold no houses: make room for them too
    for (let k = 0, j = innerSet.length; k < landmarkWards && j < order.length; k++, j++) innerSet.push(order[j])
  }
  for (const i of innerSet) patches[i].inner = true
  const innerMaxKey = patches[innerSet[innerSet.length - 1]].key
  // the inner town's radius (a town on a shore or along a road is lopsided: its farthest inner patches)
  let Rin = PATCH * Math.sqrt(innerSet.length + 1)
  {
    const ds = innerSet.map((i) => Math.hypot(patches[i].cx, patches[i].cy)).sort((a, b) => a - b)
    Rin = Math.max(Rin * 0.8, ds[Math.floor(ds.length * 0.9)] ?? 0)
  }
  yield

  // ---- walls: a ring per threshold round the patches that hold the town of that day ----
  stageAt = 'walls'
  const wallTs = wallThresholds(peak, rnd)
  /** Per patch: the first ring that encloses it (wallTs.length: none). */
  const ringOf = new Uint8Array(P).fill(wallTs.length)
  const ringLoops: WallLoop[][] = []
  const wallEdges = new Set<number>()
  const gateVerts = new Set<number>()
  {
    let room = 0, k = 0
    for (let r = 0; r < wallTs.length; r++) {
      const need = urbanPopulation(wallTs[r]) / HOUSEHOLD
      for (; k < innerSet.length && room < need; k++) {
        const i = innerSet[k]
        if (ringOf[i] === wallTs.length) ringOf[i] = r
        room += roomOf(i)
      }
    }
    for (let r = 0; r < wallTs.length; r++) {
      const inS = (i: number) => i >= 0 && ringOf[i] <= r && !patches[i].water
      // Watabou's findCircumference: the edges of the walled patches not shared with another,
      // chained into circuits (anticlockwise round the town; holes left out)
      const ea: number[] = [], eb: number[] = [], es: boolean[] = []
      const fromV = new Map<number, number[]>()
      for (let i = 0; i < P; i++) {
        if (over()) yield
        if (!inS(i)) continue
        const ids = patchEdgeVerts[i]
        const n = ids.length
        for (let q = 0; q < n; q++) {
          const t = patches[i].poly.t[q]
          if (inS(t)) continue
          const a = ids[q], b = ids[(q + 1) % n]
          const e = ea.length
          ea.push(a)
          eb.push(b)
          es.push(t >= 0 && patches[t].water)
          let l = fromV.get(a)
          if (!l) fromV.set(a, (l = []))
          l.push(e)
        }
      }
      const used = new Uint8Array(ea.length)
      const loops: WallLoop[] = []
      for (let e0 = 0; e0 < ea.length; e0++) {
        if (over()) yield
        if (used[e0]) continue
        const vs: number[] = [], sh: boolean[] = []
        let e = e0
        for (let guard = 0; guard < ea.length + 1; guard++) {
          used[e] = 1
          vs.push(ea[e])
          sh.push(es[e])
          const nxt = fromV.get(eb[e])?.find((f) => !used[f])
          if (nxt === undefined) break
          e = nxt
        }
        if (vs.length < 3) continue
        const lx = vs.map((v) => vx[v]), ly = vs.map((v) => vy[v])
        const la = area(lx.flatMap((x, q) => [x, ly[q]]))
        if (la <= 0) continue
        // gates: corners where a main street leaves the walled patches (Watabou's are the
        // corners shared by several walled patches, a street then built to each), no two
        // within two corners of each other
        const gate: boolean[] = vs.map(() => false)
        const n = vs.length
        for (let q = 0; q < n; q++) {
          const v = vs[q]
          if (!mainVerts[v]) continue
          let out = false
          for (const w of adj[v]) if (mainEdges.has(edgeKey(v, w)) && vPatches[w].every((j) => !inS(j))) out = true
          if (!out) continue
          let near = false
          for (let d = -2; d <= 2; d++) if (d !== 0 && gate[(q + d + n) % n]) near = true
          if (!near && !sh[q] && !sh[(q + n - 1) % n]) gate[q] = true
        }
        // the circuit smoothed (Watabou smooths a large town's wall hard; ours keeps close to
        // its patches, so it never crosses a block), gates a little more
        const ox: number[] = [], oy: number[] = []
        smoothLoop(lx, ly, 2, () => false, ox, oy)
        for (let q = 0; q < n; q++) {
          const dx = ox[q] - lx[q], dy = oy[q] - ly[q]
          const d = Math.hypot(dx, dy)
          const lim = gate[q] ? 0.2 : 0.14
          if (d > lim) { ox[q] = lx[q] + (dx / d) * lim; oy[q] = ly[q] + (dy / d) * lim }
        }
        for (let q = 0; q < n; q++) {
          if (!sh[q]) wallEdges.add(edgeKey(vs[q], vs[(q + 1) % n]))
          if (gate[q]) gateVerts.add(vs[q])
        }
        loops.push({ x: ox, y: oy, shore: sh, gate })
      }
      ringLoops.push(loops)
      yield
    }
  }
  const outerRing = wallTs.length - 1
  const walled = (i: number) => wallTs.length > 0 && ringOf[i] <= outerRing
  const bordersWall = (i: number) => {
    const ids = patchEdgeVerts[i]
    for (let k = 0; k < ids.length; k++) if (wallEdges.has(edgeKey(ids[k], ids[(k + 1) % ids.length]))) return true
    return false
  }

  // ---- 4. wards ----
  stageAt = 'wards'
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
  const plaza = isTown ? innerSet[0] : -1
  if (isTown) patches[plaza].ward = Ward.Plaza
  const plazaX = isTown ? patches[plaza].cx : 0, plazaY = isTown ? patches[plaza].cy : 0
  // citadel: Watabou's castle stands on the city's edge, on a compact patch; ours on the
  // highest such patch of the outer part of a city's inner town
  let citadel = -1
  if (isCity) {
    let hb = -Infinity
    for (let k = Math.floor(innerSet.length * 0.4); k < Math.floor(innerSet.length * 0.75); k++) {
      const i = innerSet[k]
      const pa = patches[i]
      const edge = neighbours(i).some((j) => !patches[j].inner)
      const comp = compactness(pa.poly.p)
      const h = hgt[i] + rnd(i, 6) * 1e-5 + (edge ? 1 : 0) + (comp >= 0.72 ? 1 : 0)
      if (h > hb) { hb = h; citadel = i }
    }
    if (citadel >= 0) patches[citadel].ward = Ward.Citadel
  }
  const isNeighbour = (i: number, w: Ward) => neighbours(i).some((j) => patches[j].ward === w)
  const countNeighbours = (i: number, w: Ward) => neighbours(i).filter((j) => patches[j].ward === w).length
  const bordersPatch = (i: number, j: number) => j >= 0 && patches[i].poly.t.includes(j)
  const meanArea = innerSet.reduce((s, i) => s + Math.abs(area(patches[i].poly.p)), 0) / Math.max(1, innerSet.length)
  const plazaArea = isTown ? Math.abs(area(patches[plaza].poly.p)) : meanArea
  const dPlaza = (i: number) => Math.hypot(patches[i].cx - plazaX, patches[i].cy - plazaY) / Math.max(1, Rin)
  /** Patches given each landmark ward type so far (for spreading them out). */
  const placedAt: number[][] = []
  const nearestOf = (i: number, w: Ward) => {
    let m = Infinity
    for (const j of placedAt[w] ?? []) m = Math.min(m, Math.hypot(patches[j].cx - patches[i].cx, patches[j].cy - patches[i].cy))
    return m / Math.max(1, Rin)
  }
  const placed = new Int32Array(Ward.Gate + 1)
  /** Watabou's rateLocation per ward type (lower is better; Infinity: not here), with our own terms for the site. */
  const rating = (w: Ward, i: number): number => {
    const d = dPlaza(i)
    const aN = Math.abs(area(patches[i].poly.p)) / meanArea
    switch (w) {
      // the main temple overlooks the plaza (the larger patch the better), parish churches spread out
      case Ward.Cathedral:
        if (placed[w] === 0) return bordersPatch(i, plaza) ? -1 / aN : d * aN
        return -nearestOf(i, Ward.Cathedral) + d * 0.5 + (isNeighbour(i, Ward.Cathedral) ? 3 : 0)
      case Ward.Admin: return bordersPatch(i, plaza) ? 0 : d
      // markets never touch another, nor are much larger than the plaza; ours by the main streets
      case Ward.Market:
        if (isNeighbour(i, Ward.Market) || bordersPatch(i, plaza)) return Infinity
        return (Math.abs(area(patches[i].poly.p)) / plazaArea) * 0.5 - (onMain(i) ? 0.6 : 0) - (placed[w] > 0 ? nearestOf(i, Ward.Market) : -d)
      case Ward.Merchant: return d - (onMain(i) ? 0.25 : 0)
      // patricians border parks, not slums; ours prefer the higher ground a little
      case Ward.Patrician: return countNeighbours(i, Ward.Slum) - countNeighbours(i, Ward.Park) + Math.abs(d - 0.45) * 0.5
      case Ward.Slum: return -d - (touchesWater(i) ? 0.2 : 0) + (isNeighbour(i, Ward.Patrician) ? 0.3 : 0)
      case Ward.Military: return citadel >= 0 && bordersPatch(i, citadel) ? 0 : bordersWall(i) ? 1 : citadel < 0 && wallTs.length === 0 ? d : Infinity
      case Ward.Harbour: return touchesWater(i) ? d * 0.3 : Infinity
      default: return 0
    }
  }
  /** Ward types picked at random (Watabou's craftsmen and parks have no preference). */
  const randomPick = (w: Ward) => w === Ward.Craftsmen || w === Ward.Park || w === Ward.Village
  // gate wards: Watabou gives each patch at a gate even odds (a fifth without a wall)
  const unassigned: number[] = []
  for (let k = isTown ? 1 : 0; k < innerSet.length; k++) {
    const i = innerSet[k]
    if (patches[i].ward === Ward.Citadel) continue
    if (isTown && patchEdgeVerts[i].some((v) => gateVerts.has(v)) && rnd(i, 0x81) < 0.5) { patches[i].ward = Ward.Gate; continue }
    patches[i].ward = -1 as Ward
    unassigned.push(i)
  }
  // the pool in a fixed interleaved order (each type spread through it, the landmarks
  // early, as in Watabou's WARDS list): each in turn takes its best rated free patch
  {
    const counts = new Int32Array(Ward.Gate + 1)
    for (const w of pool) counts[w]++
    const OFFSET: Record<number, number> = { [Ward.Cathedral]: 0.02, [Ward.Merchant]: 0.04, [Ward.Admin]: 0.12, [Ward.Harbour]: 0.06, [Ward.Market]: 0.2, [Ward.Slum]: 0.3, [Ward.Patrician]: 0.35, [Ward.Military]: 0.45, [Ward.Park]: 0.55 }
    const seq: { w: Ward; at: number }[] = []
    for (let w = 0; w < counts.length; w++) {
      const n = counts[w]
      for (let k = 0; k < n; k++) seq.push({ w: w as Ward, at: (k + (OFFSET[w] ?? 0.5 * rnd(w, 0x82))) / n })
    }
    seq.sort((a, b) => a.at - b.at || a.w - b.w)
    let free = unassigned.length
    let step = 0
    for (const { w } of seq) {
      if (free === 0) break
      ++step
      if (over()) yield
      let bi = -1
      if (!randomPick(w)) {
        let bs = Infinity
        let scan = 0
        for (const i of unassigned) {
          if ((++scan & 31) === 0 && over()) yield
          if ((patches[i].ward as number) !== -1) continue
          const s = rating(w, i) + rnd(i, w + 40) * 0.12
          if (s < bs) { bs = s; bi = i }
        }
      }
      if (bi < 0) {
        // at random among the free patches
        let k = Math.floor(rnd(step, 0x83) * free)
        for (const i of unassigned) {
          if ((patches[i].ward as number) !== -1) continue
          if (k-- === 0) { bi = i; break }
        }
      }
      if (bi < 0) break
      patches[bi].ward = w
      placed[w]++
      if (w === Ward.Cathedral || w === Ward.Market) (placedAt[w] ??= []).push(bi)
      free--
    }
    for (const i of unassigned) if ((patches[i].ward as number) === -1) patches[i].ward = isTown ? Ward.Craftsmen : Ward.Village
  }
  // beyond the town: gate wards outside each gate of the outer wall, outskirts round the
  // town, farms further out
  for (const i of order) {
    if (patches[i].inner) continue
    const atGate = outerRing >= 0 && patchEdgeVerts[i].some((v) => gateVerts.has(v)) && neighbours(i).some((j) => walled(j))
    patches[i].ward = atGate ? Ward.Gate : patches[i].key < innerMaxKey + PATCH * 1.3 || neighbours(i).some((j) => patches[j].inner) ? Ward.Outskirts : Ward.Farm
  }
  yield

  // ---- 5. lots ----
  stageAt = 'lots'
  /** Half a main street: wider the larger the town (a city's arteries carry its traffic). */
  const mainHalf = isCity ? MAIN_HALF * 1.15 : isTown ? MAIN_HALF : MAIN_HALF * 0.8
  const lots: Lot[] = []
  const dense = (w: Ward) => w === Ward.Merchant || w === Ward.Slum || w === Ward.Craftsmen || w === Ward.Gate
  /** Per patch: neighbour tags across a main street; the block (lots' area) of the patch. */
  const mainNb: Set<number>[] = patches.map(() => new Set<number>())
  const blocks: (Poly | null)[] = patches.map(() => null)
  for (let i = 0; i < P; i++) {
    const ids = patchEdgeVerts[i]
    for (let k = 0; k < ids.length; k++) if (mainEdges.has(edgeKey(ids[k], ids[(k + 1) % ids.length]))) mainNb[i].add(patches[i].poly.t[k])
  }
  /** Within the town for the lot thinning: inner patches and the outer gate wards. */
  const cityish = (i: number) => i >= 0 && !patches[i].water && (patches[i].inner || patches[i].ward === Ward.Gate)
  /** Watabou's isEnclosed: within the walls, or with only town round it. */
  const enclosed = (i: number) => cityish(i) && (walled(i) || neighbours(i).every((j) => cityish(j)))
  /** Lot parameters per ward (Watabou's, his areas in our units; a city's lots larger, for its terraces and blocks). */
  const lotScale = isCity ? 1.45 : isTown ? 1.05 : 1.1
  const paramsOf = (w: Ward, i: number, blockArea: number): AlleyParams => {
    const r = (k: number) => rnd(i, 0x90 + k)
    const minLot = (w === Ward.Slum ? 0.3 : 0.42) * (isCity ? 1.25 : 1)
    const q = (minSq: number, gridChaos: number, sizeChaos: number, emptyProb: number): AlleyParams => ({ minSq: (minSq / WS) * lotScale, gridChaos, sizeChaos, emptyProb, alley: ALLEY, minLot })
    switch (w) {
      case Ward.Craftsmen: return q(10 + 80 * r(0) * r(1), 0.5 + r(2) * 0.2, 0.6, 0.04)
      case Ward.Merchant: return q(50 + 60 * r(0) * r(1), 0.5 + r(2) * 0.3, 0.7, 0.15)
      case Ward.Patrician: return q(80 + 30 * r(0) * r(1), 0.5 + r(2) * 0.3, 0.8, 0.2)
      case Ward.Slum: return q(10 + 30 * r(0) * r(1), 0.6 + r(2) * 0.4, 0.8, 0.03)
      case Ward.Gate: return q(10 + 50 * r(0) * r(1), 0.5 + r(2) * 0.3, 0.7, 0.04)
      case Ward.Military: return q(Math.sqrt(blockArea * WS) * (1 + r(0)), 0.1 + r(2) * 0.3, 0.3, 0.25)
      // ours: warehouses on the quays, a village's crofts, the scattered houses of the outskirts and farms
      case Ward.Harbour: return q(60 + 50 * r(0) * r(1), 0.3 + r(2) * 0.2, 0.5, 0.1)
      case Ward.Village: return q(25 + 50 * r(0) * r(1), 0.6 + r(2) * 0.3, 0.7, 0.3)
      case Ward.Outskirts: return q(35 + 50 * r(0) * r(1), 0.7, 0.8, 0.25)
      default: return q(60 + 70 * r(0) * r(1), 0.6, 0.8, 0.8)
    }
  }
  const pieces: Poly[] = [], pieceEmpty: boolean[] = []
  const tmpPolys: Poly[] = []
  /** Lots that make a ring round a temple close. */
  const closeLots = new Uint8Array(P)
  for (const i of order) {
    if (over()) yield
    const pa = patches[i]
    const w = pa.ward
    if (w === Ward.Plaza || w === Ward.Admin || w === Ward.Market || w === Ward.Citadel) continue
    if (w === Ward.Cathedral && !(isTown && inradiusOf(pa) > 1.3 && rnd(i, 0x84) < 0.45)) continue
    const ids = patchEdgeVerts[i]
    const n = ids.length
    const widths: number[] = []
    const outer = !pa.inner && w !== Ward.Gate
    for (let k = 0; k < n; k++) {
      const t = pa.poly.t[k]
      const ek = edgeKey(ids[k], ids[(k + 1) % n])
      // Watabou's getCityBlock: half a main street along the arteries and the wall, half a
      // street inside the town, half an alley outside it
      widths.push(t >= 0 && patches[t].water ? 0.06 : mainEdges.has(ek) ? mainHalf : wallEdges.has(ek) ? WALL_HALF : t < 0 || outer ? LANE_HALF : STREET_HALF)
    }
    const block = inset(pa.poly, widths)
    if (!block) continue
    blocks[i] = block
    pieces.length = 0
    pieceEmpty.length = 0
    const base = i * 4099
    const stream = (k: number) => rnd(base + k, 0x85)
    if (w === Ward.Park) {
      // Watabou's park: lawns cut radially from the middle, paths between
      radialCut(block, ALLEY * 1.4, pieces)
      for (let k = 0; k < pieces.length; k++) pieceEmpty.push(true)
    } else if (w === Ward.Cathedral) {
      // Watabou's temple close: a ring of buildings round the block, the temple in its open middle
      tmpPolys.length = 0
      if (!ringCut(block, 0.42 + 0.18 * rnd(i, 0x86), tmpPolys)) continue
      closeLots[i] = 1
      for (const strip of tmpPolys) createAlleys(strip, { minSq: 0.55 * lotScale, gridChaos: 0.3, sizeChaos: 0.5, emptyProb: 0.1, alley: ALLEY, minLot: 0.42 }, (k) => stream(k + pieces.length * 31), pieces, pieceEmpty)
    } else {
      createAlleys(block, paramsOf(w, i, Math.abs(area(block.p))), stream, pieces, pieceEmpty)
    }
    // Watabou's filterOutskirts: the lots of a ward the town does not enclose thin out away
    // from its roads and the town (the edge a ward shares with it), and where its corners
    // meet the open country; so the town frays into ribbons along its roads
    const thin = !isTown ? !pa.inner || !neighbours(i).every((j) => patches[j].inner) : w === Ward.Outskirts || w === Ward.Gate || (pa.inner && !enclosed(i) && w !== Ward.Park && w !== Ward.Cathedral)
    let popE: number[] = []
    let dens: number[] = []
    if (thin) {
      popE = []
      const p = pa.poly.p
      const nv = p.length / 2
      for (let k = 0; k < nv; k++) {
        const k1 = (k + 1) % nv
        const t = pa.poly.t[k]
        const road = mainEdges.has(edgeKey(ids[k], ids[k1]))
        const f = road ? 1 : cityish(t) || (!isTown && t >= 0 && patches[t].inner) ? (enclosed(t) ? 1 : 0.4) : 0
        if (f <= 0) continue
        const ax = p[k * 2], ay = p[k * 2 + 1], dx = p[k1 * 2] - ax, dy = p[k1 * 2 + 1] - ay
        let dd = 0
        for (let q = 0; q < nv; q++) dd = Math.max(dd, lineDistance(ax, ay, dx, dy, p[q * 2], p[q * 2 + 1]) * f)
        if (dd > 1e-6) popE.push(ax, ay, dx, dy, dd)
      }
      dens = ids.map((v, q) => gateVerts.has(v) || mainVerts[v] ? 1 : vPatches[v].every((j) => j === i || cityish(j) || (!isTown && patches[j].inner)) ? 2 * rnd(base + q, 0x87) : 0)
    }
    const cut = closeLots[i] ? 0.0 : 0
    for (let li = 0; li < pieces.length; li++) {
      if ((li & 7) === 7 && over()) yield
      const poly = pieces[li]
      const pp = poly.p
      const a = Math.abs(area(pp))
      if (a < 0.05 + cut) continue
      let e = pieceEmpty[li]
      if (thin && !e) {
        let minDist = 1
        for (let q = 0; q < popE.length; q += 5) {
          for (let v = 0; v < pp.length; v += 2) minDist = Math.min(minDist, lineDistance(popE[q], popE[q + 1], popE[q + 2], popE[q + 3], pp[v], pp[v + 1]) / popE[q + 4])
        }
        centroid(pp, cc)
        // the corners' density, weighted by inverse distance (Watabou's Polygon.interpolate)
        let sw = 0, sp = 0
        const p = pa.poly.p
        for (let q = 0; q < dens.length; q++) {
          const wq = 1 / Math.max(1e-4, Math.hypot(p[q * 2] - cc[0], p[q * 2 + 1] - cc[1]))
          sw += wq
          sp += wq * dens[q]
        }
        const dn = sw > 0 ? sp / sw : 0
        const fz = (rnd(base + li, 0x88) + rnd(base + li, 0x89) + rnd(base + li, 0x8a)) / 3
        if (!(dn > 0 && fz > minDist / dn)) e = true
      }
      // street front: the longest edge that is not a lot cut (a main street's first)
      const nv = pp.length / 2
      let ux = 0, uy = 0, bl = 0, ax = 0, ay = 0, al = 0, fk = -1, ak = 0
      for (let k = 0; k < nv; k++) {
        const j = (k + 1) % nv
        const ex = pp[j * 2] - pp[k * 2], ey = pp[j * 2 + 1] - pp[k * 2 + 1]
        const l = Math.hypot(ex, ey)
        if (l < 1e-9) continue
        if (l > al) { al = l; ax = ex / l; ay = ey / l; ak = k }
        const t = poly.t[k]
        const lw = t !== CUT && mainNb[i].has(t) ? l * 1.8 : l
        if (t !== CUT && lw > bl) { bl = lw; ux = ex / l; uy = ey / l; fk = k }
      }
      if (fk < 0) { ux = ax; uy = ay; fk = ak }
      const fl = Math.hypot(pp[((fk + 1) % nv) * 2] - pp[fk * 2], pp[((fk + 1) % nv) * 2 + 1] - pp[fk * 2 + 1])
      centroid(pp, cc)
      const main = poly.t[fk] !== CUT && mainNb[i].has(poly.t[fk])
      // the town fills a patch from where it came in, its main street fronts first; the
      // outskirts and the gate wards outside follow the town a little behind its edge
      const kp = w === Ward.Outskirts || (w === Ward.Gate && !pa.inner) ? pa.key * 0.86 : pa.key
      const key = kp + 0.5 * Math.hypot(cc[0] - entryX[i], cc[1] - entryY[i]) + 0.3 * rnd(base + li, 10) - (main ? 0.3 : 0)
      lots.push({ poly: pp, ux, uy, fx: pp[fk * 2], fy: pp[fk * 2 + 1], fl, main, cx: cc[0], cy: cc[1], key, patch: i, empty: e })
    }
  }
  lots.sort((a, b) => a.key - b.key)
  yield

  // ---- landmarks with their keys (ranked into the lot order later) ----
  stageAt = 'landmarks'
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
  const inradius = (i: number) => inradiusOf(patches[i]) - (closeLots[i] ? 0.6 : 0)
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
  const outskirts = order.filter((i) => !patches[i].inner && patches[i].key < innerMaxKey + PATCH * 3)
  if (site.windmills && outskirts.length) {
    const nMills = peak >= 4000 ? 2 : peak >= 400 ? 1 : 0
    for (let m = 0; m < nMills; m++) {
      let best = -1, hb = -Infinity
      for (const i of outskirts) {
        const h = hgt[i] + rnd(i, 70 + m) * 2e-6
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
        // deck along x, across the stream; it comes with the town's growth past the crossing
        const near = Math.min(patches[vPatches[a][0]]?.key ?? 0, patches[vPatches[b][0]]?.key ?? 0)
        mk(Role.Bridge, px, py, Math.atan2(d2y, d2x) + Math.PI / 2, near, 600, 0.1, 1)
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
  const homesPerPatch = new Float64Array(P)
  const lotsPerPatch = new Int32Array(P)
  for (const l of lots) if (!l.empty) lotsPerPatch[l.patch]++
  let nextPend = 0
  pend.sort((a, b) => a.key - b.key)
  const groundDone = new Uint8Array(P)
  let radius = 0
  const walls = wallTs.map((threshold, ring) => ({ threshold, ring, done: false }))
  let coveredPop = 0
  let smithy = false, inn = false

  // lots by patch (for the gardens and yard trees of a patch when its ground is laid)
  const lotsOf: Lot[][] = patches.map(() => [])
  for (const l of lots) lotsOf[l.patch].push(l)
  /** Lots built before their patch's ground was laid (their yards wait for it). */
  const waiting: Lot[][] = patches.map(() => [])
  const paved = (w: Ward) => w === Ward.Plaza || w === Ward.Market || w === Ward.Cathedral || w === Ward.Admin || w === Ward.Citadel
  const leafy = (w: Ward) => w === Ward.Patrician || w === Ward.Park || w === Ward.Village || w === Ward.Outskirts || w === Ward.Farm
  /** Outer wards lay no street ground of their own: their houses stand on the fields, each with its yard. */
  const openWard = (i: number) => !patches[i].inner && patches[i].ward !== Ward.Gate
  const addGround = (i: number, threshold: number) => {
    if (groundDone[i]) return
    groundDone[i] = 1
    const pa = patches[i]
    const w = pa.ward
    const ids = patchEdgeVerts[i]
    const n = ids.length
    if (paved(w)) {
      ground.push({ kind: GroundKind.Plaza, poly: pa.poly.p, threshold, ux: 1, uy: 0 })
    } else if (!openWard(i)) {
      // the whole patch is street (the half of each street on this side), its lots' yards over it
      ground.push({ kind: GroundKind.Street, poly: pa.poly.p, threshold, ux: 1, uy: 0 })
    }
    // the main streets: paved in a town (the arteries read from afar, as on Watabou's
    // maps), this side's half and the far side's too where that is not built yet; a road
    // of packed earth through the open country
    for (let k = 0; k < n; k++) {
      const t = pa.poly.t[k]
      if (!mainNb[i].has(t)) continue
      const a = ids[k], b = ids[(k + 1) % n]
      const ex = vx[b] - vx[a], ey = vy[b] - vy[a]
      const l = Math.hypot(ex, ey)
      if (l < 1e-6) continue
      const far = !(t >= 0 && (groundDone[t] || patches[t].water))
      // outward normal of a CCW edge (toward the far side), inward the other way
      const o = far ? mainHalf + 0.02 : 0, ix = mainHalf + 0.02
      const ox = (ey / l) * o, oy = (-ex / l) * o
      const sx0 = (ex / l) * 0.06, sy0 = (ey / l) * 0.06
      const jx = (-ey / l) * ix, jy = (ex / l) * ix
      ground.push({ kind: isTown && !openWard(i) ? GroundKind.Plaza : GroundKind.Street, poly: [vx[a] - sx0 + jx, vy[a] - sy0 + jy, vx[b] + sx0 + jx, vy[b] + sy0 + jy, vx[b] + sx0 + ox, vy[b] + sy0 + oy, vx[a] - sx0 + ox, vy[a] - sy0 + oy], threshold, ux: 1, uy: 0 })
    }
    // quays along a harbour's water: a paved strip on the water side of its block
    if (w === Ward.Harbour) {
      const p = pa.poly.p
      const nv = p.length / 2
      for (let k = 0; k < nv; k++) {
        const t = pa.poly.t[k]
        if (!(t >= 0 && patches[t].water)) continue
        const k1 = (k + 1) % nv
        const ex = p[k1 * 2] - p[k * 2], ey = p[k1 * 2 + 1] - p[k * 2 + 1]
        const l = Math.hypot(ex, ey)
        if (l < 0.2) continue
        const ix = (-ey / l) * 0.3, iy = (ex / l) * 0.3
        ground.push({ kind: GroundKind.Plaza, poly: [p[k * 2], p[k * 2 + 1], p[k1 * 2], p[k1 * 2 + 1], p[k1 * 2] + ix, p[k1 * 2 + 1] + iy, p[k * 2] + ix, p[k * 2 + 1] + iy], threshold, ux: 1, uy: 0 })
      }
    }
    for (const l of waiting[i]) ground.push({ kind: GroundKind.Yard, poly: l.poly, threshold, ux: l.ux, uy: l.uy })
    waiting[i].length = 0
    if (openWard(i)) return
    // the rest of the patch's plots, laid out as the town reaches it (their houses follow)
    for (const l of lotsOf[i]) if (!l.empty && !l.yard) { l.yard = true; ground.push({ kind: GroundKind.Yard, poly: l.poly, threshold, ux: l.ux, uy: l.uy }) }
    // the empty lots: kitchen gardens and fruit trees in the leafy wards (not the fields round
    // a town: the planet's own fields stand for its farmland), courtyards and squares elsewhere
    const gardens = !(isTown && (w === Ward.Farm || w === Ward.Outskirts))
    for (const l of lotsOf[i]) {
      if (!l.empty) continue
      const u = rand4(seed, id, Math.round(l.cx * 977 + l.cy * 131), 0x5a)
      if (!leafy(w)) { if (!paved(w)) ground.push({ kind: GroundKind.Yard, poly: l.poly, threshold, ux: l.ux, uy: l.uy }); continue }
      if (w !== Ward.Park && u < 0.62) { if (gardens) ground.push({ kind: GroundKind.Garden, poly: l.poly, threshold, ux: l.ux, uy: l.uy }) }
      else {
        if (w === Ward.Park) ground.push({ kind: GroundKind.Yard, poly: l.poly, threshold, ux: l.ux, uy: l.uy })
        if ((u < 0.9 || w === Ward.Park) && site.clear(l.cx, l.cy, 0.22)) items.push({ role: Role.Grove, kind: 0, style, x: l.cx, y: l.cy, yaw: u * 40, sx: 0.42 + 0.2 * u, sz: 0.42 + 0.2 * u, sy: 0.42 + 0.2 * u, threshold, roof: 0, wall: 0, jitter: u, ward: w, homes: 0 })
      }
    }
  }
  /** A built lot's yard: now if its patch's ground is down (or it has none), else with it. */
  const addYard = (l: Lot, threshold: number) => {
    if (l.yard) return
    l.yard = true
    if (groundDone[l.patch] || openWard(l.patch)) ground.push({ kind: GroundKind.Yard, poly: l.poly, threshold, ux: l.ux, uy: l.uy })
    else waiting[l.patch].push(l)
  }

  /** Wall pieces, towers and gatehouses of a circuit (on dry land clear of rivers), showing from `threshold`. */
  const placeLoop = (L: WallLoop, threshold: number, castle: boolean) => {
    const n = L.x.length
    // (a gate as wide as the main street through it)
    const GATE = castle ? 0.22 : Math.max(0.3, mainHalf + 0.06)
    for (let q = 0; q < n; q++) {
      if (L.shore[q]) continue
      const b = (q + 1) % n
      let x0 = L.x[q], y0 = L.y[q], x1 = L.x[b], y1 = L.y[b]
      const l = Math.hypot(x1 - x0, y1 - y0)
      if (l < 0.2) continue
      const ux = (x1 - x0) / l, uy = (y1 - y0) / l
      // leave a gap at gates
      if (L.gate[q]) { x0 += ux * GATE; y0 += uy * GATE }
      if (L.gate[b]) { x1 -= ux * GATE; y1 -= uy * GATE }
      const len = Math.hypot(x1 - x0, y1 - y0)
      if (len < 0.15) continue
      // in pieces of about a unit, each only on dry land clear of rivers
      const m = Math.max(1, Math.ceil(len / 1.0))
      const pl = len / m
      for (let k = 0; k < m; k++) {
        const mx = x0 + ux * pl * (k + 0.5), my = y0 + uy * pl * (k + 0.5)
        if (site.wet(x0 + ux * pl * k, y0 + uy * pl * k, 0.2) || site.wet(x0 + ux * pl * (k + 1), y0 + uy * pl * (k + 1), 0.2)) continue
        if (!site.clear(mx, my, 0.12)) continue
        items.push({ role: Role.WallSeg, kind: 0, style, x: mx, y: my, yaw: Math.atan2(uy, ux), sx: pl * 1.02, sz: castle ? 1.2 : 1.3, sy: castle ? 1.2 : 1.1, threshold, roof: 0, wall: 0, jitter: 0, ward: -1, homes: 0 })
      }
    }
    // towers at the corners (Watabou's buildTowers), a gatehouse of two towers flanking each
    // gate; none crowding another
    const spots: number[] = [] // x, y, gate
    for (let q = 0; q < n; q++) {
      if (!L.gate[q]) continue
      const a = (q + n - 1) % n, b = (q + 1) % n
      for (const [o, sh] of [[a, L.shore[a]], [b, L.shore[q]]] as [number, boolean][]) {
        if (sh) continue
        const dx = L.x[o] - L.x[q], dy = L.y[o] - L.y[q]
        const l = Math.hypot(dx, dy)
        if (l < 0.4) continue
        spots.push(L.x[q] + (dx / l) * GATE, L.y[q] + (dy / l) * GATE, 1)
      }
    }
    for (let q = 0; q < n; q++) if (!L.gate[q] && !(L.shore[q] && L.shore[(q + n - 1) % n])) spots.push(L.x[q], L.y[q], 0)
    const placedT: number[] = []
    for (let q = 0; q < spots.length; q += 3) {
      const x = spots[q], y = spots[q + 1], gate = spots[q + 2] > 0
      let crowded = false
      for (let r = 0; r < placedT.length && !crowded; r += 2) if (Math.hypot(placedT[r] - x, placedT[r + 1] - y) < (gate ? 0.3 : castle ? 0.5 : 0.8)) crowded = true
      if (crowded) continue
      if (!site.clear(x, y, 0.2)) continue
      placedT.push(x, y)
      const h = gate ? 1.2 : castle ? 1.25 : 1
      items.push({ role: Role.WallTower, kind: 0, style, x, y, yaw: 0, sx: h, sz: h, sy: h, threshold, roof: hash4(seed, id, 0x33, 0) % 5, wall: 0, jitter: 0, ward: -1, homes: 0 })
      radius = Math.max(radius, Math.hypot(x, y) + 0.3)
    }
  }
  const placeWall = (ring: number, threshold: number) => {
    const n0 = items.length
    for (const L of ringLoops[ring]) placeLoop(L, threshold, false)
    diag.wallItems.push(items.length - n0, ringLoops[ring].reduce((s, L) => s + L.x.length, 0), Math.round(threshold))
  }
  /** Watabou's Castle: the citadel's own wall round its patch, a gate on the side toward the plaza. */
  const placeCitadelWall = (threshold: number) => {
    if (citadel < 0) return
    const p = patches[citadel].poly.p
    const n = p.length / 2
    const cx = patches[citadel].cx, cy = patches[citadel].cy
    const x: number[] = [], y: number[] = [], shore: boolean[] = [], gate: boolean[] = []
    let gk = -1, gd = Infinity
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n
      const d = Math.hypot((p[k * 2] + p[k1 * 2]) / 2 - plazaX, (p[k * 2 + 1] + p[k1 * 2 + 1]) / 2 - plazaY)
      if (d < gd) { gd = d; gk = k }
    }
    const pull = (v: number, c: number) => c + (v - c) * 0.86
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n
      x.push(pull(p[k * 2], cx)); y.push(pull(p[k * 2 + 1], cy)); shore.push(false); gate.push(false)
      if (k === gk) { x.push(pull((p[k * 2] + p[k1 * 2]) / 2, cx)); y.push(pull((p[k * 2 + 1] + p[k1 * 2 + 1]) / 2, cy)); shore.push(false); gate.push(true) }
    }
    placeLoop({ x, y, shore, gate }, threshold, true)
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
      if (it.role === Role.Castle) placeCitadelWall(it.threshold)
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
    else if (ward === Ward.Gate) kind = r < 0.35 ? Kind.Long : r < 0.7 ? Kind.House : Kind.Tall
    else if (ward === Ward.Military) kind = r < 0.6 ? Kind.Long : Kind.House
    else kind = r < 0.35 ? Kind.Small : r < 0.8 ? Kind.House : r < 0.9 ? Kind.Ell : Kind.Long
    // the dry south builds round a courtyard
    if (hs === Style.Desert && kind !== Kind.Small && r2 < (ward === Ward.Patrician ? 0.8 : 0.4)) kind = Kind.Ell
    // the dense core: narrow, tall, gable to the street
    if (isTown && dCore < 0.45 && (kind === Kind.House || kind === Kind.Small) && ward !== Ward.Slum && r2 < 0.6) kind = Kind.Tall
    // terraces along the streets of a town's dense wards, where the frontage holds three houses
    const rowWard = ward === Ward.Craftsmen || ward === Ward.Merchant || ward === Ward.Harbour || ward === Ward.Cathedral || (isCity && ward === Ward.Patrician)
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
      const rowHouses = multi || dense(ward) || ward === Ward.Harbour || ward === Ward.Cathedral || (isTown && (l.main || dCore < 0.55))
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

  yield
  // (perf=1 diagnostics: window.__dioramaPlans[id])
  const slopes = order.map((i) => slope[i]).sort((a, b) => a - b)
  const diag = { peak, needHomes: Math.round(townHouseholds(peak)), seeds: nSeeds, patches: P, dryPatches: order.length, inner: innerSet.length, lots: lots.length, emptyLots: lots.filter((l) => l.empty).length, lotsUsed: 0, noFit: 0, notClear: 0, built: 0, homes: 0, exhausted: false, byWard: [] as number[], wardPatches: [] as number[], byKind: [] as number[], rings: ringLoops.map((r) => r.length), gates: gateVerts.size, slope50: slopes[slopes.length >> 1] ?? 0, slope90: slopes[Math.floor(slopes.length * 0.9)] ?? 0, noFitWard: [] as number[], noFitArea: 0, innerBuilt: 0, capRatio: 0, wallItems: [] as number[], bareGround: [] as number[], noBlock: [] as number[] }
  for (const i of order) diag.wardPatches[patches[i].ward] = (diag.wardPatches[patches[i].ward] ?? 0) + 1
  const diagAll = (globalThis as { __dioramaPlans?: Record<number, typeof diag> }).__dioramaPlans
  if (diagAll) diagAll[id] = diag
  // the next building in lot order, fitted and validated but not yet standing
  let nextIt: PlanItem | null = null
  let nextKey = 0
  let nextR = 0
  let nextL: Lot | null = null
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
          if (!it) { diag.noFit++; const w = patches[l.patch].ward; diag.noFitWard[w] = (diag.noFitWard[w] ?? 0) + 1; diag.noFitArea += Math.abs(area(l.poly)); continue }
          const [hw, hd] = KIND_HALF[it.kind]
          const rr = Math.max(hw * it.sx, hd * it.sz) * 0.8
          if (!site.clear(it.x, it.y, rr)) { diag.notClear++; continue }
          // it stands once the town holds the households before it and half its own
          it.threshold = Math.max(1, urbanThreshold(HOUSEHOLD * (homes + it.homes / 2)))
          nextIt = it
          nextKey = l.key
          nextR = rr
          nextL = l
        }
        if (nextIt.threshold > lim) break
        const it = nextIt
        const l = nextL!
        nextIt = null
        const pop = it.threshold
        flushPending(nextKey, pop)
        // walls enclose the town of their day when the population first passes their threshold
        for (const w of walls) if (!w.done && pop >= w.threshold) { w.done = true; placeWall(w.ring, w.threshold) }
        // the first craftsman's lot becomes the smithy, the first merchant's (or a big village's) the inn
        if (it.units) { /* a terrace stays houses */ }
        else if (!smithy && pop >= 1200 && (it.ward === Ward.Craftsmen || (it.ward === Ward.Village && peak >= 1500))) {
          smithy = true
          it.role = Role.Blacksmith
          it.sx = it.sz = it.sy = 0.72
          it.homes = 0
        } else if (!inn && pop >= 1800 && (it.ward === Ward.Merchant || it.ward === Ward.Market || it.ward === Ward.Village || it.ward === Ward.Gate)) {
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
        const pi = l.patch
        builtPerPatch[pi]++
        homesPerPatch[pi] += it.homes
        if (builtPerPatch[pi] === 2 || (lotsPerPatch[pi] <= 2 && builtPerPatch[pi] === 1) || (openWard(pi) && builtPerPatch[pi] === 1)) addGround(pi, pop)
        addYard(l, pop)
        radius = Math.max(radius, Math.hypot(it.x, it.y) + nextR)
      }
      // everything up to `need` is placed; the landmarks ranked before the next building
      // come with it (or, the lots used up, all that are left), as an unbroken run places them
      if (nextIt) flushPending(nextKey, nextIt.threshold)
      else flushPending(Infinity, lastPop)
      for (const w of walls) if (!w.done && (nextIt ? nextIt.threshold >= w.threshold : lim >= w.threshold)) { w.done = true; placeWall(w.ring, w.threshold) }
      coveredPop = need
      diag.built = built
      diag.homes = homes
      diag.lotsUsed = nextLot
      diag.exhausted = nextIt === null && nextLot >= lots.length
      diag.innerBuilt = innerSet.filter((i) => builtPerPatch[i] > 0).length
      {
        // households the fully grown inner patches hold, over the plan's estimate of their room
        const lastLot = new Int32Array(P).fill(-1)
        for (let k = 0; k < lots.length; k++) lastLot[lots[k].patch] = k
        let h = 0, r = 0
        for (const i of innerSet) if (lastLot[i] >= 0 && lastLot[i] < nextLot && builtPerPatch[i] > 0) { h += homesPerPatch[i]; r += roomOf(i) }
        diag.capRatio = r > 0 ? +(h / r).toFixed(2) : 0
      }
      diag.bareGround = []
      diag.noBlock = []
      for (const i of order) {
        if (groundDone[i] && builtPerPatch[i] === 0 && !paved(patches[i].ward)) diag.bareGround[patches[i].ward] = (diag.bareGround[patches[i].ward] ?? 0) + 1
        if (patches[i].inner && !blocks[i] && !paved(patches[i].ward)) diag.noBlock[patches[i].ward] = (diag.noBlock[patches[i].ward] ?? 0) + 1
      }
      return true
    },
  }
}

/** Radius of the largest circle round a patch's centre inside it (eight directions). */
function inradiusOf(p: Patch): number {
  let m = Infinity
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2
    m = Math.min(m, rayExtent(p.poly.p, p.cx, p.cy, Math.cos(a), Math.sin(a)))
  }
  return m
}

/** Voronoi cell clipping (the cell keeps the neighbour as the new edge's tag). */
function clipCell(poly: Poly, a: number, b: number, c: number, tag: number): Poly {
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
  const m = out.length / 2
  if (ot.length !== m) {
    ot.length = Math.min(ot.length, m)
    while (ot.length < m) ot.push(CUT)
  }
  return { p: out, t: ot }
}

/**
 * How far the town of a site reaches at its peak (KayKit units from its centre), for the
 * countryside to keep clear: the patch seeds walked as the plan walks them, to the dry ones
 * its town needs and the room it may grow into along its roads. Cheap (one ground probe
 * per seed) and the same however often it is asked.
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
  const inner = Math.max(1, Math.ceil((townHouseholds(peak) * 1.2) / householdsPerPatch(peak))) + landmarkWards
  // the town proper and part of the room it grows into (it reaches out along a road or two, not all round)
  const want = inner * (1 + (fieldShare(peak) - 1) * 0.6)
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
