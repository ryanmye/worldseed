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
//     waterfront and keeps off hillsides: an outline that grew, not a disc. A wall ring
//     encloses the patches that held the town of a population (by size without polity
//     data: a ring per threshold, older rings left inside; with it the rings the history
//     builds, each round the town of its building year, placed by the layout at their
//     years: wallRing, ruinRing), follows that outline, smoothed off the patch edges
//     wherever it can pass without coming onto the lots, with gates where main streets
//     leave and towers evenly spaced along it. Gaps the growth went round (a steep or wet
//     patch with town on every side) become commons, gardens and parks.
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
//     in a town's dense wards a terrace of narrow houses along the whole frontage, wall to
//     wall with the next lot's, courtyard blocks in a city's core, set back with a front yard
//     further out; out of town ribbons along the roads and farmsteads square to the fields
//     (a rick or an orchard tree behind); more storeys
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

import { CITY_POPULATION, LandmarkKind, TOWN_POPULATION } from '../../contract.ts'
import { HOUSEHOLD, households, STOREY as STOREY_H, storeys, urbanPopulation, urbanThreshold } from './census.ts'
import { householdsPerPatch, PATCH, planScale, townHouseholds } from './footprint.ts'
import { area, centroid, compactness, createAlleys, CUT, inset, insideConvex, lineDistance, radialCut, rayExtent, ringCut, type AlleyParams, type Poly } from './plan/geom.ts'
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
  /** A capital's palace or hall (polity data), by the plaza. */
  Palace: 16,
  /** Commons and gardens in a gap the town grew round (a steep or wet patch it skipped). */
  Green: 17,
  /** (tourism) A resort quarter's pieces (TownPlan.resort); never a patch's ward. */
  Resort: 18,
  /** (landmarks data) A patch kept by the plaza for a great hall of the history: a guildhall, a library, great baths. */
  Landmark: 19,
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
  Palace: 19, // a capital's palace (a large courtyard range)
  Banner: 20, // a faction banner on a pole (its colour is set when drawn); `lift`: on top of a tower
  Rubble: 21, // a slighted wall's rubble
  Stockade: 22, // a garrison's stockade (the style's fort)
  Boat: 23, // (tourism) a pleasure boat on the water: `kind` 0 a rowing boat, 1 a small sailing boat
  Landmark: 24, // (landmarks data) a piece of a landmark atlas: `kind` the sacred piece, or LANDMARK_CIVIC + the civic piece (landmarkShapes.ts)
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
  /** Height above the ground of its foot (KayKit units, at the item's scale): a banner on a tower. */
  lift?: number
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
  /**
   * Polity data (ui/politiesData.ts townPolityState): the wall rings the history builds, as
   * the population each encloses (ascending; known when the plan is made: they shape the
   * gate wards and the wall roads). Absent: no polity data, walls by size as before.
   */
  walls?: number[]
  /** Polity data: it is a capital at some time (room for a palace by the plaza). */
  palace?: boolean
  /**
   * Landmarks data (History.landmarks): the kinds (LandmarkKind) of the town's landmarks known when the plan is made, in the
   * order they were begun. The plan keeps room for them (a citadel, a palace ward, temple closes, halls by the plaza) and
   * gives up the generic church, castle, council hall and market hall they stand for.
   */
  landmarks?: number[]
}

/** (landmarks data) Radius (plan units) of the open ground round a great landmark in the patch the plan keeps for it, by LandmarkKind: several houses across. */
const LM_CLEAR: Record<number, number> = { [LandmarkKind.Castle]: 2.6, [LandmarkKind.Palace]: 2.4, [LandmarkKind.GreatTemple]: 2.4, [LandmarkKind.MarketHall]: 1.7, [LandmarkKind.CouncilHouse]: 1.7, [LandmarkKind.Library]: 1.6, [LandmarkKind.Guildhall]: 1.4, [LandmarkKind.Baths]: 1.7, [LandmarkKind.Temple]: 1.15 }
/** The open ground round it beyond the building's own reach (plan units): a bailey, a square, a precinct. */
const LM_MARGIN = 1.0

/** Role.Landmark kinds from this up are civic pieces (kind - LANDMARK_CIVIC); below, sacred ones. */
export const LANDMARK_CIVIC = 32
/** Role.Landmark kinds from this up are the KayKit pieces of landmarks.glb (kind - LANDMARK_PACK: landmarkShapes.ts PackPiece). */
export const LANDMARK_PACK = 64


/** What TownPlan.landmark places: the landmark's kind and its number among the town's landmarks of that kind, and its pieces. */
export interface LandmarkSpec {
  kind: number
  ord: number
  /** Role.Landmark kind of its main piece (a sacred piece, or LANDMARK_CIVIC + a civic piece). */
  code: number
  /** Half sizes along x and z and the height of the piece (model units, at scale 1). */
  hx: number
  hz: number
  h: number
  great: boolean
  /** A second piece beside it (a monastery's cloister: its Role.Landmark kind and half sizes), or -1. */
  extra: number
  ehx: number
  ehz: number
  /** The Role.Landmark kind of the construction scaffold. */
  scaffold: number
  /** Pieces beside it (Role.Landmark kinds, footprint 2 model units across, or -1): the builders' yard while it is building, a roofless outbuilding while it is neglected or ruined, a tower that stands with it. */
  yard: number
  outbuilding: number
  tower: number
}

/**
 * Parts of a landmark's slot set, in their threshold: the building (its states: rising, standing, worn, ruined), the
 * scaffold (while building), the debris of a ruin (rubble, a tree grown through it), and works that stand with the
 * finished building (a citadel's wall round its bailey).
 */
export const LandmarkPart = { Building: 0, Scaffold: 1, Debris: 2, Works: 3, Outbuilding: 4 } as const

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
  /** Whether the front is on a street at all (not a cut between lots). */
  street: boolean
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
  /**
   * Polity data (null until the plan is set up): the pieces of a wall ring round the town as
   * it stood at population `pop` (the patches the growth order had reached), smoothed, with
   * gates, evenly spaced towers and faction banners on the gatehouses. Thresholds are each
   * piece's place in the build order (0..1, for the build-up). Worked out in steps until the
   * deadline (performance.now() ms): null until done.
   */
  wallRing(pop: number, deadline: number): PlanItem[] | null
  /** The same ring slighted: broken stretches, stumps and rubble; thresholds 0..1 the order they weather away. */
  ruinRing(pop: number, deadline: number): PlanItem[] | null
  /** A capital's palace (tier: 0 chiefdom hall, 1 kingdom, 2 empire) with its banner; empty without room for one. */
  palace(tier: number): PlanItem[] | null
  /** Barracks and a stockade on open ground outside the main gate of the ring for `pop` (the town's edge for 0); threshold k: the k-th to stand (k + 1 garrison units). */
  camp(pop: number, n: number): PlanItem[] | null
  /**
   * Goods (ui/goodsData.ts townGoodsState): works on empty lots (lots that never hold a house) of the town as
   * it stood at population `pop`: `kind` a WorksKind, `n` units (threshold k: the k-th unit; a compound's
   * pieces share theirs), `angle` the direction (radians in the plan frame) of a mine's deposit, `kinds` the
   * kinds this town ever has (bits 1 << WorksKind: a kind keeps its best lots from the kinds after it).
   */
  works(kind: number, pop: number, n: number, angle: number, kinds: number): PlanItem[] | null
  /**
   * Tourism (resort.ts): a resort quarter on empty lots (never a house: no household moves) of the town as it
   * stood at population `pop`, toward the water (a promenade along the shore, pleasure boats off it) or, with no
   * shore in reach, toward the view (a terrace on the high ground at the town's edge): lodges, villas in their
   * gardens and (spec.bath) a bath house over the hot springs. `kinds` as for works (their lots are kept for
   * them). Thresholds 0..1: each piece's place in the build order. Worked out in steps until the deadline
   * (performance.now() ms): null until done.
   */
  resort(pop: number, spec: ResortSpec, kinds: number, deadline: number): PlanItem[] | null
  /**
   * Landmarks data: the pieces of one landmark (LandmarkPart in each threshold) at its place in the town: a castle on the
   * citadel's high ground with the citadel's wall round its bailey, a palace in its ward by the plaza, the great temple in the
   * main temple close and the town's temples in the others, a market hall in the market, a council house in the
   * administration's ward, guildhalls, libraries and baths in the halls kept by the plaza, a monument on the plaza, a
   * lighthouse on the shore toward the open water, a monastery, a shrine and a tomb out of town (high ground, the main road).
   * Deterministic in the plan and the spec alone: the same landmark stands in the same place whatever else the town builds.
   */
  landmark(spec: LandmarkSpec): PlanItem[] | null
}

/** What a resort quarter holds (resort.ts sizes it by its visitors). */
export interface ResortSpec {
  lodges: number
  villas: number
  boats: number
  /** Hot springs in the town's cell or next to it: a bath house. */
  bath: boolean
  /** A sea or lake shore in the town's cell or next to it (the quarter looks for it beyond the plan's patches too). */
  shore: boolean
}

/** What townGoodsState puts into a town (TownPlan.works). */
export const WorksKind = {
  /** Smiths' quarter: forges with their chimneys by the river (water power), else at the town's edge. */
  Forge: 0,
  /** Weavers' lofts and dyers' works by the river. */
  Textile: 1,
  /** Warehouses by the harbour, else by the market. */
  Warehouses: 2,
  /** A guild hall by the plaza. */
  Guild: 3,
  /** A walled foreign merchants' compound by the harbour or the main gate, its banner in the owner's colour. */
  Factory: 4,
  /** Mine workings: headframes and spoil heaps at the edge toward the deposit. */
  Mine: 5,
  /** A mint by the plaza (a strong stone hall). */
  Mint: 6,
} as const

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
  /** A plan item handed out at the town's footprint scale. */
  const scaled = (it: PlanItem): PlanItem => {
    const o: PlanItem = { ...it, x: it.x * U, y: it.y * U }
    if (it.role === Role.House || it.role === Role.Palace || it.role === Role.Landmark) { o.sx = it.sx * U; o.sz = it.sz * U; o.sy = it.sy * UL }
    else if (it.role === Role.WallSeg || it.role === Role.Bridge) { o.sx = it.sx * U; o.sz = it.sz * UL }
    else if (MONUMENT[it.role]) { o.sx = it.sx * monument; o.sz = it.sz * monument; o.sy = it.sy * monument }
    else { o.sx = it.sx * UL; o.sz = it.sz * UL; o.sy = it.sy * UL }
    if (it.lift) o.lift = it.lift * UL
    return o
  }
  const scaledAll = (list: PlanItem[] | null) => (list ? list.map(scaled) : null)
  const flush = () => {
    for (let k = items.length; k < raw.length; k++) items.push(scaled(raw[k]))
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
    wallRing: (pop, deadline) => (plan ? scaledAll(plan.wallRing(pop, deadline)) : null),
    ruinRing: (pop, deadline) => (plan ? scaledAll(plan.ruinRing(pop, deadline)) : null),
    palace: (tier) => (plan ? scaledAll(plan.palace(tier)) : null),
    camp: (pop, n) => (plan ? scaledAll(plan.camp(pop, n)) : null),
    works: (kind, pop, n, angle, kinds) => (plan ? scaledAll(plan.works(kind, pop, n, angle, kinds)) : null),
    landmark: (spec) => (plan ? scaledAll(plan.landmark(spec)) : null),
    resort: (pop, spec, kinds, deadline) => (plan ? scaledAll(plan.resort(pop, spec, kinds, deadline)) : null),
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

/** A wall circuit as found on the patch edges: its vertex ids and corners, shore edges (no wall) and gates. */
interface RawLoop {
  vs: number[]
  x: number[]
  y: number[]
  shore: boolean[]
  gate: boolean[]
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
  // (landmarks data) the town's landmarks known now: room for them
  const LK = LandmarkKind
  const lmList = site.landmarks ?? []
  const lmN = (k: number) => { let c = 0; for (const x of lmList) if (x === k) c++; return c }
  const lmTemples = Math.min(6, lmN(LK.Temple)), lmGreatTemple = lmN(LK.GreatTemple) > 0
  const lmWorship = lmTemples > 0 || lmGreatTemple
  const lmHalls = Math.min(4, lmN(LK.Guildhall) + lmN(LK.Library) + lmN(LK.Baths))
  const lmCastle = lmN(LK.Castle) > 0, lmPalace = lmN(LK.Palace) > 0, lmCouncil = lmN(LK.CouncilHouse) > 0, lmMarket = lmN(LK.MarketHall) > 0
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
  const landmarkWards = isTown ? 2 + (peak >= 6000 ? 1 : 0) + (isCity ? 2 : 0) + Math.floor(site.trade * 2) + (site.palace ? 1 : 0) + lmHalls + lmTemples + (lmCouncil ? 1 : 0) + (lmPalace && !site.palace ? 1 : 0) + (lmCastle && !isCity ? 1 : 0) : 0
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
    return { items, ground, radius: 0, advance: () => true, wallRing: () => [], ruinRing: () => [], palace: () => [], camp: () => [], works: () => [], resort: () => [], landmark: () => [] }
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

  // ---- walls: rings round the patches that held the town of a given population ----
  stageAt = 'walls'
  // Without polity data a ring per size threshold, placed when the population first passes it;
  // with it the rings the history builds (site.walls: the population each encloses), placed
  // by the layout at their own years (wallRing). Either way a ring encloses a prefix of the
  // growth order: the patches that held the town of its population.
  const wallTs = site.walls ? [] : wallThresholds(peak, rnd)
  const ringPops = site.walls ? site.walls.slice().sort((a, b) => a - b) : wallTs
  /** Position of each dry patch in the growth order (water: P). */
  const rankOf = new Int32Array(P).fill(P)
  for (let k = 0; k < order.length; k++) rankOf[order[k]] = k
  /** Patches of the growth order a ring round the town of population pop encloses (by size: within the inner town). */
  const ringReach = (pop: number) => {
    const need = urbanPopulation(pop) / HOUSEHOLD
    const cap = site.walls ? order.length : innerSet.length
    let room = 0, k = 0
    for (; k < cap && room < need; k++) room += roomOf(order[k])
    // (a walled village still walls in its green and the houses round it)
    return site.walls ? Math.min(order.length, Math.max(k, 4)) : k
  }
  /** Per patch: the first ring that encloses it (ringPops.length: none). */
  const ringOf = new Uint8Array(P).fill(ringPops.length)
  const wallEdges = new Set<number>()
  const gateVerts = new Set<number>()
  /**
   * Watabou's findCircumference for the first k patches of the growth order: the edges of
   * the walled patches not shared with another, chained into circuits (anticlockwise round
   * the town; holes left out), with gates at the corners where a main street leaves them.
   */
  const rawCache = new Map<number, RawLoop[]>()
  const rawLoops = (k: number): RawLoop[] => {
    const hit = rawCache.get(k)
    if (hit) return hit
    const inS = (i: number) => i >= 0 && rankOf[i] < k && !patches[i].water
    const members = order.slice(0, k).sort((a, b) => a - b)
    const ea: number[] = [], eb: number[] = [], es: boolean[] = []
    const fromV = new Map<number, number[]>()
    for (const i of members) {
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
    const loops: RawLoop[] = []
    for (let e0 = 0; e0 < ea.length; e0++) {
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
      loops.push({ vs, x: lx, y: ly, shore: sh, gate })
    }
    rawCache.set(k, loops)
    return loops
  }
  const ringK: number[] = []
  for (let r = 0; r < ringPops.length; r++) {
    const k = ringReach(ringPops[r])
    ringK.push(k)
    for (let q = 0; q < k; q++) if (ringOf[order[q]] === ringPops.length) ringOf[order[q]] = r
    for (const L of rawLoops(k)) {
      const n = L.vs.length
      for (let q = 0; q < n; q++) {
        if (!L.shore[q]) wallEdges.add(edgeKey(L.vs[q], L.vs[(q + 1) % n]))
        if (L.gate[q]) gateVerts.add(L.vs[q])
      }
    }
    yield
  }
  const outerRing = ringPops.length - 1
  const walled = (i: number) => ringPops.length > 0 && ringOf[i] <= outerRing
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
    // (landmarks data: a close for each of the town's temples instead)
    add(Ward.Cathedral, lmWorship ? Math.max(1, Math.min(7, lmTemples + (lmGreatTemple ? 1 : 0))) : (peak >= 12000 + 8000 * rnd(4, 1) ? 2 : 1) + Math.min(5, Math.floor(n / 60)))
    if (peak >= 6000 || lmCouncil) add(Ward.Admin, 1)
    // (polity data) a capital's palace by the plaza
    if (site.palace || lmPalace) add(Ward.Palace, 1)
    add(Ward.Market, Math.max(lmMarket ? 1 : 0, Math.min(3, Math.floor(site.trade * 3 + rnd(4, 2) * 0.8 + (n > 12 ? 1 : 0))) + Math.min(3, Math.floor(n / 90))))
    add(Ward.Landmark, lmHalls)
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
  if (isCity || (isTown && lmCastle)) {
    let hb = -Infinity
    for (let k = Math.floor(innerSet.length * 0.4); k < Math.max(Math.floor(innerSet.length * 0.4) + 1, Math.floor(innerSet.length * 0.75)); k++) {
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
  const placed = new Int32Array(Ward.Landmark + 1)
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
      // (landmarks data) the great halls by the plaza, spread round it, on dry even ground
      case Ward.Landmark: return (bordersPatch(i, plaza) ? -0.4 : d) + (isNeighbour(i, Ward.Landmark) ? 0.6 : 0) + (1 - patches[i].dry) * 4 + (riverNear[i] ? 1.5 : 0) + Math.min(2, slope[i] * 12)
      // (on dry, even ground, off the river: a large building)
      case Ward.Palace: return (bordersPatch(i, plaza) ? -1 : d) - Math.min(1.5, Math.abs(area(patches[i].poly.p)) / meanArea) * 0.3 - inradiusOf(patches[i]) * 0.1 + (1 - patches[i].dry) * 4 + (riverNear[i] ? 3 : 0) + Math.min(2, slope[i] * 12)
      // markets never touch another, nor are much larger than the plaza; ours by the main streets
      case Ward.Market:
        if (isNeighbour(i, Ward.Market) || bordersPatch(i, plaza)) return Infinity
        return (Math.abs(area(patches[i].poly.p)) / plazaArea) * 0.5 - (onMain(i) ? 0.6 : 0) - (placed[w] > 0 ? nearestOf(i, Ward.Market) : -d)
      case Ward.Merchant: return d - (onMain(i) ? 0.25 : 0)
      // patricians border parks, not slums; ours prefer the higher ground a little
      case Ward.Patrician: return countNeighbours(i, Ward.Slum) - countNeighbours(i, Ward.Park) + Math.abs(d - 0.45) * 0.5
      case Ward.Slum: return -d - (touchesWater(i) ? 0.2 : 0) + (isNeighbour(i, Ward.Patrician) ? 0.3 : 0)
      case Ward.Military: return citadel >= 0 && bordersPatch(i, citadel) ? 0 : bordersWall(i) ? 1 : citadel < 0 && ringPops.length === 0 ? d : Infinity
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
    const counts = new Int32Array(Ward.Landmark + 1)
    for (const w of pool) counts[w]++
    const OFFSET: Record<number, number> = { [Ward.Palace]: 0.01, [Ward.Cathedral]: 0.02, [Ward.Landmark]: 0.03, [Ward.Merchant]: 0.04, [Ward.Admin]: 0.12, [Ward.Harbour]: 0.06, [Ward.Market]: 0.2, [Ward.Slum]: 0.3, [Ward.Patrician]: 0.35, [Ward.Military]: 0.45, [Ward.Park]: 0.55 }
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
  // gaps the growth went round (a steep or wet patch with the town on every side): commons,
  // gardens and orchards, laid out once the town round them stands (no farmland showing
  // through the middle of a town)
  if (isTown) {
    for (const i of order) {
      const pa = patches[i]
      if (pa.inner || pa.dry < 0.35) continue
      const nb = neighbours(i)
      if (nb.length < 3 || !nb.every((j) => patches[j].inner)) continue
      pa.inner = true
      pa.ward = rnd(i, 0x8b) < 0.45 ? Ward.Park : Ward.Green
    }
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
  /** Per patch: the way its fields and plots run (along its longest road, else its longest edge), for the houses out of town. */
  const fieldX = new Float64Array(P), fieldY = new Float64Array(P)
  for (let i = 0; i < P; i++) {
    const ids = patchEdgeVerts[i]
    const p = patches[i].poly.p
    const n = p.length / 2
    let bl = -1
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n
      const ex = p[k1 * 2] - p[k * 2], ey = p[k1 * 2 + 1] - p[k * 2 + 1]
      const l = Math.hypot(ex, ey) * (mainEdges.has(edgeKey(ids[k], ids[k1])) ? 4 : 1)
      if (l > bl && l > 1e-9) { bl = l; const ll = Math.hypot(ex, ey); fieldX[i] = ex / ll; fieldY[i] = ey / ll }
    }
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
      // (outskirts and fields cut square to their patch's long edge: plots along the lanes and field edges)
      case Ward.Outskirts: return q(35 + 50 * r(0) * r(1), 0.2, 0.6, 0.25)
      case Ward.Green: return q(40 + 40 * r(0) * r(1), 0.3, 0.6, 1)
      default: return q(60 + 70 * r(0) * r(1), 0.25, 0.7, 0.8)
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
    if (w === Ward.Plaza || w === Ward.Admin || w === Ward.Market || w === Ward.Citadel || w === Ward.Palace || w === Ward.Landmark) continue
    // (a close round a temple of the history's is left open: the temple stands in its middle)
    if (w === Ward.Cathedral && (lmWorship || !(isTown && inradiusOf(pa) > 1.3 && rnd(i, 0x84) < 0.45))) continue
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
      lots.push({ poly: pp, ux, uy, fx: pp[fk * 2], fy: pp[fk * 2 + 1], fl, main, street: poly.t[fk] !== CUT, cx: cc[0], cy: cc[1], key, patch: i, empty: e })
    }
  }
  lots.sort((a, b) => a.key - b.key)
  yield

  // ---- landmarks with their keys (ranked into the lot order later) ----
  stageAt = 'landmarks'
  // ---- (landmarks data) each landmark at a place of its own ----
  /** Patches kept for the landmarks known when the plan was made: per (kind, number) key, -1 none (a lot or the open country then). */
  const lmSlot = new Map<number, number>()
  /** Radius of the open ground kept round a great landmark (plan units), by its key. */
  const lmClearAt = new Map<number, number>()
  {
    const cath = placedAt[Ward.Cathedral] ?? [], markets = placedAt[Ward.Market] ?? []
    const halls = order.filter((i) => patches[i].ward === Ward.Landmark)
    const admin = order.find((i) => patches[i].ward === Ward.Admin) ?? -1
    const seen = new Int32Array(32)
    let hall = 0
    for (const k of lmList) {
      const ord = seen[k]++
      let p = -1
      if (k === LK.Castle && ord === 0) p = citadel
      else if (k === LK.Palace && ord === 0) p = order.find((i) => patches[i].ward === Ward.Palace) ?? -1
      else if (k === LK.GreatTemple && ord === 0) p = cath[0] ?? -1
      else if (k === LK.Temple) p = cath[ord + (lmGreatTemple ? 1 : 0)] ?? -1
      else if (k === LK.MarketHall && ord === 0) p = markets[0] ?? -1
      else if (k === LK.CouncilHouse && ord === 0) p = admin
      else if ((k === LK.Guildhall || k === LK.Library || k === LK.Baths) && ord === 0) p = halls[hall++] ?? -1
      lmSlot.set(k * 64 + ord, p)
      // a great building's open ground: a bailey, a square, a precinct round it, kept clear of houses
      const r = p < 0 ? 0 : LM_CLEAR[k] ?? 0
      if (r > 0) { lmClearAt.set(k * 64 + ord, r); for (const l of lots) if (!l.empty && Math.hypot(l.cx - patches[p].cx, l.cy - patches[p].cy) < r + (k === LK.Temple ? 0.45 : LM_MARGIN)) l.empty = true }
    }
  }
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
        // (landmarks data: the history's temples stand here instead)
        if (lmWorship) { churches++; break }
        mk(Role.Church, pa.cx, pa.cy, yaw, pa.key, churches === 0 ? 1500 + 1500 * rnd(6, 1) : 9000 + 6000 * rnd(6, 2), 0.8, fitScale(i, 0.85) * (churches === 0 ? 1.15 : 1))
        // a bell tower beside the main church of a large town
        if (churches === 0 && peak >= 5000) {
          const o = Math.min(1.0, inradius(i) * 0.75)
          mk(Role.Tower, pa.cx + Math.cos(yaw) * o, pa.cy + Math.sin(yaw) * o, yaw, pa.key + 0.01, 5000 + 3000 * rnd(6, 6), 0.4, 0.8)
        }
        churches++
        break
      case Ward.Admin:
        if (lmCouncil) break
        mk(Role.Hall, pa.cx, pa.cy, yaw, pa.key, 6000 + 3000 * rnd(6, 3), 0.9, fitScale(i, 0.9))
        if (isCity) {
          const o = Math.min(1.0, inradius(i) * 0.75)
          mk(Role.Tower, pa.cx - Math.cos(yaw) * o, pa.cy - Math.sin(yaw) * o, yaw, pa.key + 0.01, C * (0.95 + 0.3 * rnd(6, 7)), 0.4, 0.9)
        }
        break
      case Ward.Market:
        if (lmMarket && (placedAt[Ward.Market] ?? [])[0] === i) break
        mk(Role.Market, pa.cx, pa.cy, yaw, pa.key, T + 2000 * rnd(i, 61), 0.9, fitScale(i, 0.9))
        break
      case Ward.Citadel:
        if (lmCastle) break
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
  if (!isTown && peak >= 1200 && !lmWorship && lmN(LK.Shrine) === 0) {

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
  const paved = (w: Ward) => w === Ward.Plaza || w === Ward.Market || w === Ward.Cathedral || w === Ward.Admin || w === Ward.Citadel || w === Ward.Palace || w === Ward.Landmark
  const leafy = (w: Ward) => w === Ward.Patrician || w === Ward.Park || w === Ward.Village || w === Ward.Outskirts || w === Ward.Farm || w === Ward.Green
  /** Outer wards lay no street ground of their own: their houses stand on the fields, each with its yard. */
  const openWard = (i: number) => !patches[i].inner && patches[i].ward !== Ward.Gate
  const layGround = (i: number, threshold: number) => {
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
  /**
   * A patch's ground; then that of the town's patches that never get a building of their own
   * (parks, greens, a palace's court, a block too odd for lots) once most of the town round
   * them is laid, so the town has no holes where the planet's fields show through.
   */
  const spread: number[] = []
  const addGround = (i: number, threshold: number) => {
    if (groundDone[i]) return
    layGround(i, threshold)
    spread.push(i)
    while (spread.length) {
      const u = spread.pop()!
      for (const j of neighbours(u)) {
        if (groundDone[j] || !patches[j].inner || lotsPerPatch[j] > 0) continue
        const nb = neighbours(j)
        let laid = 0
        for (const q of nb) if (groundDone[q] || patches[q].water) laid++
        if (laid < Math.ceil(nb.length * 0.6)) continue
        layGround(j, threshold)
        spread.push(j)
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

  // ---- wall circuits: smoothed off the patch edges, kept off the lots ----
  /** The lots that may hold a building, bucketed (the wall line keeps off them). */
  const LG = 1.0
  let lotGrid: Map<number, number[]> | null = null
  const lotBox = new Float32Array(lots.length * 4)
  const lotsNear = (x: number, y: number): number[] | undefined => {
    if (!lotGrid) {
      lotGrid = new Map()
      for (let li = 0; li < lots.length; li++) {
        const l = lots[li]
        if (l.empty) continue
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (let v = 0; v < l.poly.length; v += 2) {
          x0 = Math.min(x0, l.poly[v]); x1 = Math.max(x1, l.poly[v])
          y0 = Math.min(y0, l.poly[v + 1]); y1 = Math.max(y1, l.poly[v + 1])
        }
        lotBox[li * 4] = x0; lotBox[li * 4 + 1] = y0; lotBox[li * 4 + 2] = x1; lotBox[li * 4 + 3] = y1
        for (let gx = Math.floor((x0 - 0.15) / LG); gx <= Math.floor((x1 + 0.15) / LG); gx++) {
          for (let gy = Math.floor((y0 - 0.15) / LG); gy <= Math.floor((y1 + 0.15) / LG); gy++) {
            const key = gx * 65536 + gy
            let b = lotGrid.get(key)
            if (!b) lotGrid.set(key, (b = []))
            b.push(li)
          }
        }
      }
    }
    return lotGrid.get(Math.floor(x / LG) * 65536 + Math.floor(y / LG))
  }
  /** Half the wall's thickness, less the lots' own margin (plan units). */
  const WALL_CLEAR = 0.07
  const onLot = (x: number, y: number, r: number) => {
    const b = lotsNear(x, y)
    if (b) {
      for (const li of b) {
        const o = li * 4
        if (x < lotBox[o] - r || y < lotBox[o + 1] - r || x > lotBox[o + 2] + r || y > lotBox[o + 3] + r) continue
        if (insideConvex(lots[li].poly, x, y, -r)) return true
      }
    }
    return false
  }
  /** Sample points of segment a-b that stand on a lot. */
  const segHits = (ax: number, ay: number, bx: number, by: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.2))
    let c = 0
    for (let k = 0; k <= n; k++) if (onLot(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, WALL_CLEAR)) c++
    return c
  }
  /**
   * A circuit off the patch edges as a smooth wall line: its long edges divided, then
   * smoothed (Taubin's two-step, so it does not shrink) wherever a corner can move without
   * the wall coming onto more of the lots than before (across a street, a yard or the
   * fields, not through the houses); gates stay where the main streets leave.
   */
  const smoothCache = new Map<RawLoop, WallLoop>()
  /** Runs a resumable job to its end. */
  const drain = <T,>(g: Generator<void, T, void>): T => {
    for (;;) {
      const r = g.next()
      if (r.done) return r.value
    }
  }
  function* smoothWall(R: RawLoop): Generator<void, WallLoop, void> {
    const hit = smoothCache.get(R)
    if (hit) return hit
    const n0 = R.x.length
    const x: number[] = [], y: number[] = [], shore: boolean[] = [], gate: boolean[] = [], lock: boolean[] = []
    for (let q = 0; q < n0; q++) {
      const b = (q + 1) % n0
      const sh = R.shore[q], shPrev = R.shore[(q + n0 - 1) % n0]
      x.push(R.x[q]); y.push(R.y[q]); shore.push(sh); gate.push(R.gate[q]); lock.push(R.gate[q] || sh || shPrev)
      const m = Math.floor(Math.hypot(R.x[b] - R.x[q], R.y[b] - R.y[q]) / 0.85)
      for (let j = 1; j <= m; j++) {
        const t = j / (m + 1)
        x.push(R.x[q] + (R.x[b] - R.x[q]) * t); y.push(R.y[q] + (R.y[b] - R.y[q]) * t)
        shore.push(sh); gate.push(false); lock.push(sh)
      }
    }
    const n = x.length
    const hits = new Int32Array(n) // per edge i -> i + 1
    for (let i = 0; i < n; i++) { const b = (i + 1) % n; hits[i] = segHits(x[i], y[i], x[b], y[b]) }
    for (let pass = 0; pass < 8; pass++) {
      const f = pass % 2 === 0 ? 0.5 : -0.53
      for (let i = 0; i < n; i++) {
        if ((i & 31) === 31) yield
        if (lock[i]) continue
        const a = (i + n - 1) % n, b = (i + 1) % n
        const tx = x[i] + f * ((x[a] + x[b]) / 2 - x[i]), ty = y[i] + f * ((y[a] + y[b]) / 2 - y[i])
        for (let t = 1; t >= 0.49; t *= 0.5) {
          const cx = x[i] + (tx - x[i]) * t, cy = y[i] + (ty - y[i]) * t
          const h0 = segHits(x[a], y[a], cx, cy), h1 = segHits(cx, cy, x[b], y[b])
          if (h0 + h1 > hits[a] + hits[i]) continue
          x[i] = cx; y[i] = cy; hits[a] = h0; hits[i] = h1
          break
        }
      }
    }
    const L = { x, y, shore, gate }
    smoothCache.set(R, L)
    return L
  }
  /** Spacing of a town wall's towers along its line (plan units). */
  const TOWER_STEP = 2.3
  /**
   * Wall pieces, towers and gatehouses of a circuit (on dry land clear of rivers) into `out`.
   * `threshold`: the population it shows from, or (< 0) each piece's place along the circuit
   * (0..1) as its threshold, for the layout's build-up. Town walls get towers at an even
   * spacing along the line (and where it turns sharply), a citadel's at its corners; a
   * gatehouse of two towers flanks each gate, with a banner on each (`banners`).
   */
  function* placeLoop(L: WallLoop, threshold: number, castle: boolean, out: PlanItem[], banners = false): Generator<void, void, void> {
    const n = L.x.length
    // (a gate as wide as the main street through it)
    const GATE = castle ? 0.22 : Math.max(0.3, mainHalf + 0.06)
    let total = 0
    for (let q = 0; q < n; q++) if (!L.shore[q]) total += Math.hypot(L.x[(q + 1) % n] - L.x[q], L.y[(q + 1) % n] - L.y[q])
    total = Math.max(total, 1e-6)
    const thr = (s: number) => (threshold >= 0 ? threshold : Math.min(1, s / total))
    let s0 = 0
    const along: number[] = [] // arc position of each corner
    for (let q = 0; q < n; q++) {
      along.push(s0)
      if (!L.shore[q]) s0 += Math.hypot(L.x[(q + 1) % n] - L.x[q], L.y[(q + 1) % n] - L.y[q])
    }
    for (let q = 0; q < n; q++) {
      if (L.shore[q]) continue
      const b = (q + 1) % n
      let x0 = L.x[q], y0 = L.y[q], x1 = L.x[b], y1 = L.y[b]
      const l = Math.hypot(x1 - x0, y1 - y0)
      if (l < 0.12) continue
      const ux = (x1 - x0) / l, uy = (y1 - y0) / l
      // leave a gap at gates
      if (L.gate[q]) { x0 += ux * GATE; y0 += uy * GATE }
      if (L.gate[b]) { x1 -= ux * GATE; y1 -= uy * GATE }
      const len = Math.hypot(x1 - x0, y1 - y0)
      if (len < 0.1) continue
      // in pieces of about a unit, each only on dry land clear of rivers (a hair longer, so a
      // bending line has no chinks)
      const m = Math.max(1, Math.ceil(len / 1.0))
      const pl = len / m
      if ((q & 3) === 3) yield
      for (let k = 0; k < m; k++) {
        const mx = x0 + ux * pl * (k + 0.5), my = y0 + uy * pl * (k + 0.5)
        if (site.wet(x0 + ux * pl * k, y0 + uy * pl * k, 0.2) || site.wet(x0 + ux * pl * (k + 1), y0 + uy * pl * (k + 1), 0.2)) continue
        if (!site.clear(mx, my, 0.12)) continue
        out.push({ role: Role.WallSeg, kind: 0, style, x: mx, y: my, yaw: Math.atan2(uy, ux), sx: pl * 1.02 + (castle ? 0 : 0.05), sz: castle ? 1.2 : 1.3, sy: castle ? 1.2 : 1.1, threshold: thr(along[q] + pl * (k + 0.5)), roof: 0, wall: 0, jitter: 0, ward: -1, homes: 0 })
      }
    }
    const spots: number[] = [] // x, y, gate, arc position
    for (let q = 0; q < n; q++) {
      if (!L.gate[q]) continue
      const a = (q + n - 1) % n, b = (q + 1) % n
      for (const [o, sh] of [[a, L.shore[a]], [b, L.shore[q]]] as [number, boolean][]) {
        if (sh) continue
        const dx = L.x[o] - L.x[q], dy = L.y[o] - L.y[q]
        const l = Math.hypot(dx, dy)
        if (l < 0.4) continue
        spots.push(L.x[q] + (dx / l) * GATE, L.y[q] + (dy / l) * GATE, 1, along[q])
      }
    }
    if (castle) {
      // towers at the corners (Watabou's buildTowers)
      for (let q = 0; q < n; q++) if (!L.gate[q] && !(L.shore[q] && L.shore[(q + n - 1) % n])) spots.push(L.x[q], L.y[q], 0, along[q])
    } else {
      // evenly spaced along each stretch of wall, and at its sharp turns and ends
      let next = TOWER_STEP * 0.5
      for (let q = 0; q < n; q++) {
        const b = (q + 1) % n, a = (q + n - 1) % n
        if (!L.shore[q] && L.shore[a]) spots.push(L.x[q], L.y[q], 0, along[q])
        if (!L.shore[a] && L.shore[q]) spots.push(L.x[q], L.y[q], 0, along[q])
        if (!L.shore[q] && !L.shore[a] && !L.gate[q]) {
          const e0x = L.x[q] - L.x[a], e0y = L.y[q] - L.y[a], e1x = L.x[b] - L.x[q], e1y = L.y[b] - L.y[q]
          const c = (e0x * e1x + e0y * e1y) / Math.max(1e-9, Math.hypot(e0x, e0y) * Math.hypot(e1x, e1y))
          if (c < 0.62) spots.push(L.x[q], L.y[q], 0, along[q])
        }
        if (L.shore[q]) { next = along[q] + TOWER_STEP * 0.5; continue }
        const l = Math.hypot(L.x[b] - L.x[q], L.y[b] - L.y[q])
        while (next < along[q] + l) {
          const t = (next - along[q]) / Math.max(l, 1e-9)
          spots.push(L.x[q] + (L.x[b] - L.x[q]) * t, L.y[q] + (L.y[b] - L.y[q]) * t, 0, next)
          next += TOWER_STEP
        }
      }
    }
    const placedT: number[] = []
    for (let q = 0; q < spots.length; q += 4) {
      if ((q & 31) === 28) yield
      const x = spots[q], y = spots[q + 1], gate = spots[q + 2] > 0
      let crowded = false
      for (let r = 0; r < placedT.length && !crowded; r += 2) if (Math.hypot(placedT[r] - x, placedT[r + 1] - y) < (gate ? 0.3 : castle ? 0.5 : 0.9)) crowded = true
      if (crowded) continue
      if (!site.clear(x, y, 0.2)) continue
      placedT.push(x, y)
      const h = gate ? 1.2 : castle ? 1.25 : 1
      out.push({ role: Role.WallTower, kind: 0, style, x, y, yaw: 0, sx: h, sz: h, sy: h, threshold: thr(spots[q + 3]), roof: hash4(seed, id, 0x33, 0) % 5, wall: 0, jitter: 0, ward: -1, homes: 0 })
      // a faction banner over each gatehouse tower (on its drum, the pole through the cap)
      if (gate && banners) out.push({ role: Role.Banner, kind: 0, style, x, y, yaw: rnd(Math.round(x * 97 + y * 13), 0x3b) * 0.6 + 0.4, sx: 1, sz: 1, sy: 1.25, threshold: thr(spots[q + 3]), roof: 0, wall: 0, jitter: 0, ward: -1, homes: 0, lift: 0.56 * h })
      if (out === items) radius = Math.max(radius, Math.hypot(x, y) + 0.3)
    }
  }
  const placeWall = (ring: number, threshold: number) => {
    const n0 = items.length
    const loops = rawLoops(ringK[ring])
    for (const R of loops) drain(placeLoop(drain(smoothWall(R)), threshold, false, items))
    diag.wallItems.push(items.length - n0, loops.reduce((s, L) => s + L.x.length, 0), Math.round(threshold))
  }
  /** Resumable jobs of the polity data (wall rings), by key: run until a deadline, finished ones kept. */
  const jobs = new Map<string, Generator<void, PlanItem[], void>>()
  const jobsDone = new Map<string, PlanItem[]>()
  const runJob = (key: string, make: () => Generator<void, PlanItem[], void>, deadline: number): PlanItem[] | null => {
    const hit = jobsDone.get(key)
    if (hit) return hit
    let g = jobs.get(key)
    if (!g) jobs.set(key, (g = make()))
    for (;;) {
      const r = g.next()
      if (r.done) {
        jobs.delete(key)
        jobsDone.set(key, r.value)
        return r.value
      }
      if (performance.now() > deadline) return null
    }
  }
  /** (polity data) The pieces of the ring round the town of population pop, in build order. */
  function* wallRingJob(pop: number): Generator<void, PlanItem[], void> {
    const out: PlanItem[] = []
    for (const R of rawLoops(ringReach(pop))) yield* placeLoop(yield* smoothWall(R), -1, false, out, true)
    return out
  }
  const wallRing = (pop: number, deadline: number) => runJob(`w${ringReach(pop)}`, () => wallRingJob(pop), deadline)
  /** (polity data) That ring slighted: breaches, stumps of wall and tower, rubble; thresholds the order they weather away. */
  const ruinRing = (pop: number, deadline: number): PlanItem[] | null => {
    const ring = wallRing(pop, deadline)
    if (!ring) return null
    const out: PlanItem[] = []
    for (const it of ring) {
      if (it.role === Role.Banner) continue
      const k = Math.round(it.x * 977 + it.y * 131)
      const u = rnd(k, 0x3c), v = rnd(k, 0x3d)
      if (it.role === Role.WallTower) {
        // a tower slighted to a stump in its rubble
        out.push({ ...it, role: Role.Rubble, sx: 0.55, sz: 0.55, sy: 0.9, yaw: u * 6.28, threshold: v })
        if (u < 0.6) out.push({ ...it, role: Role.WallSeg, sx: 0.32, sz: 2.2, sy: 0.55 + 0.4 * v, yaw: u * 3, threshold: v * 0.8 })
        continue
      }
      if (u < 0.32) {
        // a breach: the stones scattered
        out.push({ ...it, role: Role.Rubble, sx: 0.5 + 0.3 * v, sz: 0.5 + 0.3 * v, sy: 0.8, yaw: it.yaw + v, threshold: v * 0.7 })
        continue
      }
      // a broken stretch: shorter and lower, ragged
      out.push({ ...it, sx: it.sx * (0.55 + 0.35 * v), sy: it.sy * (0.32 + 0.4 * u), x: it.x + Math.cos(it.yaw) * it.sx * (v - 0.5) * 0.25, y: it.y + Math.sin(it.yaw) * it.sx * (v - 0.5) * 0.25, threshold: 0.3 + 0.7 * v })
    }
    return out
  }
  /** (polity data) A capital's palace in its ward by the plaza: a hall for a chiefdom, a great courtyard range for a kingdom, flanked by towers for an empire; a banner before it. */
  const palacePatch = order.find((i) => patches[i].ward === Ward.Palace) ?? -1
  const palace = (tier: number): PlanItem[] => {
    const out: PlanItem[] = []
    const base = { kind: 0, style, threshold: 0, roof: hash4(seed, id, 0x33, 0) % 5, wall: hash4(seed, id, 0x34, 0) % 4, jitter: 0.5, ward: Ward.Palace as number, homes: 0 }
    const banner = (x: number, y: number, h: number) => out.push({ ...base, role: Role.Banner, x, y, yaw: 0.5, sx: 1.2, sz: 1.2, sy: h })
    if (palacePatch < 0) {
      // no room kept for one (a village, or a capital only in a longer run): its banner on the green
      if (!isTown) banner(0.42, 0.18, 1.5)
      return out
    }
    const pa = patches[palacePatch]
    const yaw = longestEdgeYaw(palacePatch)
    const ir = inradius(palacePatch)
    // the door side (+z) is the model's x turned -90 degrees
    const fx = Math.sin(yaw), fy = -Math.cos(yaw)
    if (tier <= 0) {
      const sc = fitScale(palacePatch, 0.9)
      if (!site.clear(pa.cx, pa.cy, 0.7 * sc)) return out
      out.push({ ...base, role: Role.Hall, x: pa.cx, y: pa.cy, yaw, sx: sc, sz: sc, sy: sc })
      banner(pa.cx + fx * (0.75 * sc + 0.2), pa.cy + fy * (0.75 * sc + 0.2), 1.6)
      return out
    }
    // a courtyard range (half a unit across per unit of scale), as large as the ward allows on dry ground
    let sc = Math.max(0.9, Math.min(tier >= 2 ? 2.1 : 1.6, (ir - 0.15) / 0.58))
    while (sc > 0.7 && !site.clear(pa.cx, pa.cy, 0.62 * sc)) sc *= 0.85
    if (!site.clear(pa.cx, pa.cy, 0.62 * sc)) return out
    out.push({ ...base, role: Role.Palace, x: pa.cx, y: pa.cy, yaw, sx: sc, sz: sc, sy: tier >= 2 ? 1.3 : 1.15 })
    const h = 0.55 * sc
    if (tier >= 2) {
      for (const sgn of [-1, 1]) {
        const x = pa.cx + Math.cos(yaw) * h * sgn + fx * h, y = pa.cy + Math.sin(yaw) * h * sgn + fy * h
        if (site.clear(x, y, 0.25)) out.push({ ...base, role: Role.Tower, x, y, yaw, sx: 0.75, sz: 0.75, sy: 0.9 })
      }
    }
    banner(pa.cx + fx * (h + 0.22), pa.cy + fy * (h + 0.22), 1.8)
    if (tier >= 2) for (const sgn of [-1, 1]) banner(pa.cx + fx * (h + 0.22) + Math.cos(yaw) * h * 0.5 * sgn, pa.cy + fy * (h + 0.22) + Math.sin(yaw) * h * 0.5 * sgn, 1.4)
    return out
  }
  /** (polity data) A garrison's quarters on open ground (lots that never get a house) outside the main gate of the ring for pop, or at the town's edge on its busiest road. */
  const camp = (pop: number, n: number): PlanItem[] => {
    const out: PlanItem[] = []
    const k = pop > 0 ? ringReach(pop) : innerSet.length
    const ra = site.routes[0] ?? 0
    const rdx = Math.cos(ra), rdy = Math.sin(ra)
    let gx = 0, gy = 0, best = -Infinity
    for (const L of pop > 0 ? rawLoops(k) : []) {
      for (let q = 0; q < L.x.length; q++) {
        if (!L.gate[q]) continue
        const d = Math.hypot(L.x[q], L.y[q]) || 1
        const sc = (L.x[q] * rdx + L.y[q] * rdy) / d
        if (sc > best) { best = sc; gx = L.x[q]; gy = L.y[q] }
      }
    }
    if (best === -Infinity) {
      // the town's farthest patch toward the road out
      for (let q = 0; q < k; q++) {
        const pa = patches[order[q]]
        const sc = pa.cx * rdx + pa.cy * rdy
        if (sc > best) { best = sc; gx = pa.cx; gy = pa.cy }
      }
    }
    const gd = Math.hypot(gx, gy) || 1
    const tx = gx + (gx / gd) * 1.6, ty = gy + (gy / gd) * 1.6
    const cand: { l: Lot; d: number }[] = []
    for (const l of lots) {
      // (an empty lot is never built on; in the leafy wards it has a garden or an orchard)
      const w = patches[l.patch].ward
      if (!l.empty || rankOf[l.patch] < k || (patches[l.patch].inner && leafy(w)) || paved(w)) continue
      const a = Math.abs(area(l.poly))
      if (a < 0.45) continue
      const d = Math.hypot(l.cx - tx, l.cy - ty)
      if (d < 8) cand.push({ l, d })
    }
    cand.sort((a, b) => a.d - b.d)
    const taken: number[] = []
    for (const { l } of cand) {
      if (out.length >= n) break
      let near = false
      for (let q = 0; q < taken.length && !near; q += 2) if (Math.hypot(taken[q] - l.cx, taken[q + 1] - l.cy) < 1.15) near = true
      if (near || !site.clear(l.cx, l.cy, 0.32)) continue
      taken.push(l.cx, l.cy)
      const j = out.length
      const sc = Math.max(0.55, Math.min(0.95, Math.sqrt(Math.abs(area(l.poly))) * 0.5))
      out.push({ role: j === 0 && n >= 3 ? Role.Stockade : Role.Barracks, kind: 0, style, x: l.cx, y: l.cy, yaw: Math.atan2(l.uy, l.ux), sx: sc, sz: sc, sy: sc, threshold: j, roof: hash4(seed, id, 0x33, 0) % 5, wall: hash4(seed, id, 0x34, 0) % 4, jitter: rnd(j, 0x3e), ward: Ward.Military, homes: 0 })
    }
    diag.camp = [out.length, cand.length, +tx.toFixed(2), +ty.toFixed(2)]
    return out
  }
  /**
   * (goods) Works on empty lots (never a house: no household moves) of the town as it stood at population pop,
   * chosen by kind: by the river or the water for forges and dyers, by the harbour or the market for warehouses,
   * by the plaza for a guild hall or a mint, by the harbour or the main gate for a foreign compound, just past the
   * town's edge toward the deposit for mine workings. Deterministic in its arguments (cached by the layout).
   */
  /** (goods) How well an empty lot suits works of a kind (lower is better), from its place in the plan only. */
  const worksScore = (kind: number, l: Lot): number => {
    const pi = l.patch
    const w = patches[pi].ward
    const dPlaza = Math.hypot(l.cx - plazaX, l.cy - plazaY)
    const river = nearRiverPatch(pi), water = touchesWater(pi)
    const ra = site.routes[0] ?? 0
    const dn = Math.hypot(l.cx, l.cy) || 1
    if (kind === WorksKind.Forge) return (river ? 0 : 3) + (6 - Math.min(6, dPlaza)) * 0.4
    if (kind === WorksKind.Textile) return (river ? 0 : water ? 1.5 : 3) + dPlaza * 0.15
    if (kind === WorksKind.Warehouses) return (w === Ward.Harbour ? 0 : water && site.port ? 0.8 : w === Ward.Merchant ? 1.6 : 3) + dPlaza * 0.2
    if (kind === WorksKind.Factory) return site.port ? (w === Ward.Harbour || water ? 0 : 3) + dPlaza * 0.1 : (1 - (l.cx * Math.cos(ra) + l.cy * Math.sin(ra)) / dn) * 3 + dPlaza * 0.1
    return dPlaza
  }
  /** (goods) Kinds in order of who gets a contested lot first, and how many lots each keeps from the kinds after it. */
  const WORKS_PRIORITY = [WorksKind.Factory, WorksKind.Guild, WorksKind.Mint, WorksKind.Warehouses, WorksKind.Forge, WorksKind.Textile]
  const WORKS_KEEP = 3
  /** (goods) Empty lots of the town within reach k that suit works of a kind, best first, without the lots the kinds before it keep (memoised: deterministic in kind and k). */
  const worksLots = new Map<number, number[]>()
  const lotsFor = (kind: number, k: number, kinds: number): number[] => {
    const key = (kinds * 8 + kind) * 100000 + k
    const hit = worksLots.get(key)
    if (hit) return hit
    const kept = new Set<number>()
    for (const o of WORKS_PRIORITY) {
      if (o === kind) break
      if (kinds & (1 << o)) for (const q of lotsFor(o, k, kinds).slice(0, WORKS_KEEP)) kept.add(q)
    }
    const c: { q: number; d: number }[] = []
    for (let q = 0; q < lots.length; q++) {
      const l = lots[q]
      // (forges, dyers and warehouses may stand just past the edge, as works do; the halls and the compound within)
      const edge = kind === WorksKind.Forge || kind === WorksKind.Textile || kind === WorksKind.Warehouses ? 3 : 0
      if (!l.empty || kept.has(q) || rankOf[l.patch] >= k + edge) continue
      const w = patches[l.patch].ward
      if (paved(w) || w === Ward.Park || w === Ward.Green) continue
      if (Math.abs(area(l.poly)) < (kind === WorksKind.Factory ? 0.5 : 0.25)) continue
      c.push({ q, d: worksScore(kind, l) + 0.3 * rnd(q, 0x50 + kind) + (rankOf[l.patch] >= k ? 1.5 : 0) })
    }
    c.sort((a, b) => a.d - b.d || a.q - b.q)
    const out = c.map((x) => x.q)
    worksLots.set(key, out)
    return out
  }
  /**
   * (goods) Works on empty lots (never a house: no household moves) of the town as it stood at population pop,
   * chosen by kind: by the river or the water for forges and dyers, by the harbour or the market for warehouses,
   * by the plaza for a guild hall or a mint, by the harbour or the main gate for a foreign compound, just past the
   * town's edge toward the deposit for mine workings. Each lot is kept for one kind (ownerOfLot). Deterministic in
   * its arguments (cached by the layout).
   */
  const works = (kind: number, pop: number, n: number, angle: number, kinds: number): PlanItem[] => {
    const out: PlanItem[] = []
    const k = Math.max(1, ringReach(Math.max(pop, 1)))
    const adx = Math.cos(angle), ady = Math.sin(angle)
    const cand: { l: Lot; d: number }[] = []
    for (let q = 0; q < lots.length; q++) {
      const l = lots[q]
      if (!l.empty) continue
      const pi = l.patch
      const w = patches[pi].ward
      if (paved(w) || (patches[pi].inner && leafy(w))) continue
      const a = Math.abs(area(l.poly))
      if (a < (kind === WorksKind.Factory ? 0.6 : 0.35)) continue
      const rank = rankOf[pi]
      let d: number
      if (kind === WorksKind.Mine) {
        // just beyond the town toward the deposit
        if (rank < k || rank > k + 24) continue
        const dn = Math.hypot(l.cx, l.cy) || 1
        d = (1 - (l.cx * adx + l.cy * ady) / dn) * 6 + (rank - k) * 0.08
      } else continue
      cand.push({ l, d })
    }
    if (kind !== WorksKind.Mine) lotsFor(kind, k, kinds).forEach((q, i) => cand.push({ l: lots[q], d: i }))
    cand.sort((a, b) => a.d - b.d || a.l.key - b.l.key)
    const taken: number[] = []
    const base = { kind: 0, style, roof: hash4(seed, id, 0x35, kind) % 5, wall: hash4(seed, id, 0x36, kind) % 4, homes: 0 }
    let j = 0
    for (const { l } of cand) {
      if (j >= n) break
      let near = false
      for (let q = 0; q < taken.length && !near; q += 2) if (Math.hypot(taken[q] - l.cx, taken[q + 1] - l.cy) < (kind === WorksKind.Factory ? 1.6 : 0.9)) near = true
      if (near || !site.clear(l.cx, l.cy, kind === WorksKind.Factory ? 0.5 : 0.3)) continue
      taken.push(l.cx, l.cy)
      const yaw = Math.atan2(l.uy, l.ux)
      const sc = Math.max(0.55, Math.min(0.95, Math.sqrt(Math.abs(area(l.poly))) * 0.5))
      const jit = rnd(j, 0x3f + kind)
      const at = { ...base, x: l.cx, y: l.cy, yaw, threshold: j, jitter: jit }
      if (kind === WorksKind.Forge) {
        // a forge, and a tall chimney stack beside it
        out.push({ ...at, role: Role.Blacksmith, sx: sc, sz: sc, sy: sc, ward: Ward.Craftsmen })
        const cx = l.cx + Math.cos(yaw) * sc * 0.55, cy = l.cy + Math.sin(yaw) * sc * 0.55
        if (site.clear(cx, cy, 0.12)) out.push({ ...at, role: Role.Tower, x: cx, y: cy, sx: 0.16, sz: 0.16, sy: 0.95 + 0.3 * jit, ward: Ward.Craftsmen })
      } else if (kind === WorksKind.Textile) {
        // a mill race works the looms and fulling stocks; drying racks (haystack-like bales) beside
        out.push({ ...at, role: nearRiverPatch(l.patch) ? Role.Watermill : Role.House, kind: Kind.Long, sx: sc, sz: sc, sy: sc, ward: Ward.Craftsmen })
        const bx = l.cx - Math.sin(yaw) * sc * 0.6, by = l.cy + Math.cos(yaw) * sc * 0.6
        if (site.clear(bx, by, 0.12)) out.push({ ...at, role: Role.Haystack, x: bx, y: by, sx: 0.45, sz: 0.45, sy: 0.5, ward: Ward.Craftsmen })
      } else if (kind === WorksKind.Warehouses) {
        // long warehouse ranges along the street
        out.push({ ...at, role: Role.House, kind: Kind.Long, sx: sc * 1.15, sz: sc * 1.15, sy: sc * 1.1, ward: Ward.Harbour })
      } else if (kind === WorksKind.Guild || kind === WorksKind.Mint) {
        out.push({ ...at, role: kind === WorksKind.Mint ? Role.Castle : Role.Hall, sx: sc * (kind === WorksKind.Mint ? 0.55 : 1.05), sz: sc * (kind === WorksKind.Mint ? 0.55 : 1.05), sy: sc * (kind === WorksKind.Mint ? 0.55 : 1.05), ward: Ward.Admin })
        if (kind === WorksKind.Guild) out.push({ ...at, role: Role.Banner, x: l.cx + Math.sin(yaw) * (sc * 0.7), y: l.cy - Math.cos(yaw) * (sc * 0.7), sx: 1, sz: 1, sy: 1.3, ward: Ward.Admin })
      } else if (kind === WorksKind.Factory) {
        // a walled compound: a hall and a warehouse inside a square wall, the owner's banner at its gate
        // (houses, not the style's great hall: they scale with the plan like the wall round them)
        const h = 0.62
        const ux = Math.cos(yaw), uy = Math.sin(yaw), vx = -uy, vy = ux
        // its paved yard
        out.push({ ...at, role: Role.Ground, kind: GroundKind.Plaza, sx: h * 2.1, sz: h * 2.1, sy: 1, ward: Ward.Merchant })
        out.push({ ...at, role: Role.House, kind: Kind.Tall, x: l.cx + vx * h * 0.35, y: l.cy + vy * h * 0.35, yaw: yaw + Math.PI, sx: 0.8, sz: 0.8, sy: 1.2, ward: Ward.Merchant })
        out.push({ ...at, role: Role.House, kind: Kind.Long, x: l.cx - vx * h * 0.25 + ux * h * 0.3, y: l.cy - vy * h * 0.25 + uy * h * 0.3, sx: 0.65, sz: 0.65, sy: 0.8, ward: Ward.Harbour })
        for (const [ox, oy, len, along] of [[0, 1, 2, 1], [0, -1, 2, 1], [1, 0, 2, 0], [-1, 0, 2, 0]] as const) {
          const mx = l.cx + (ux * ox + vx * oy) * h, my = l.cy + (uy * ox + vy * oy) * h
          // the gate side (toward the street, -v) has a gap for the gate
          if (oy === -1) {
            for (const sgn of [-1, 1]) out.push({ ...at, role: Role.WallSeg, x: mx + ux * h * 0.6 * sgn, y: my + uy * h * 0.6 * sgn, yaw, sx: h * 0.75, sz: 0.7, sy: 0.75, ward: -1 })
            out.push({ ...at, role: Role.Banner, x: mx - vx * 0.18, y: my - vy * 0.18, sx: 1.2, sz: 1.2, sy: 1.7, ward: -1 })
            continue
          }
          out.push({ ...at, role: Role.WallSeg, x: mx, y: my, yaw: along ? yaw : yaw + Math.PI / 2, sx: h * len, sz: 0.7, sy: 0.75, ward: -1 })
        }
      } else {
        // a headframe over the shaft and spoil heaps round it
        out.push({ ...at, role: Role.Tower, sx: 0.5, sz: 0.5, sy: 0.75 + 0.25 * jit, ward: Ward.Outskirts })
        for (let q = 0; q < 3; q++) {
          const a = yaw + q * 2.1 + jit, rr = 0.45 + 0.2 * rnd(j * 3 + q, 0x4e)
          const x = l.cx + Math.cos(a) * rr, y = l.cy + Math.sin(a) * rr
          if (site.clear(x, y, 0.12)) out.push({ ...at, role: Role.Rubble, x, y, yaw: a, sx: 0.9 + 0.4 * rnd(q, 0x4f), sz: 0.9, sy: 1.1, ward: Ward.Outskirts })
        }
      }
      j++
    }
    return out
  }
  /** Watabou's Castle: the citadel's own wall round its patch, a gate on the side toward the plaza. */
  const placeCitadelWall = (threshold: number) => placeCitadelWallInto(threshold, items)
  const placeCitadelWallInto = (threshold: number, into: PlanItem[]) => {
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
    drain(placeLoop({ x, y, shore, gate }, threshold, true, into))
  }

  /** Largest scale (up to smax) at which a box of half sizes hx, hz turned to yaw fits round (x, y) inside convex polygon p, less margin m. */
  const fitBox = (p: number[], x: number, y: number, yaw: number, hx: number, hz: number, smax: number, m: number): number => {
    const ux = Math.cos(yaw), uy = Math.sin(yaw)
    let s = smax
    for (let t = 0; t < 14; t++) {
      let ok = true
      for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const px = x + (ux * a * hx - uy * b * hz) * s, py = y + (uy * a * hx + ux * b * hz) * s
        if (!insideConvex(p, px, py, m)) { ok = false; break }
      }
      if (ok) return s
      s *= 0.88
    }
    return s
  }
  /** The outermost patches round the town's edge (beyond the inner town, within reach), for the works out of town. */
  const outerPatches = (): number[] => {
    const out: number[] = []
    for (const i of order) {
      const pa = patches[i]
      if (pa.inner || pa.dry < 0.8 || rankOf[i] < innerSet.length || rankOf[i] > innerSet.length + 40) continue
      if (pa.ward !== Ward.Outskirts && pa.ward !== Ward.Farm) continue
      out.push(i)
    }
    return out
  }
  /** Empty lots of the town (not paved, not a park) large enough for a hall, nearest the plaza first. */
  let freeLots: number[] | null = null
  const freeLotList = (): number[] => {
    if (freeLots) return freeLots
    const c: { q: number; d: number }[] = []
    for (let q = 0; q < lots.length; q++) {
      const l = lots[q]
      const w = patches[l.patch].ward
      if (!l.empty || paved(w) || w === Ward.Park || w === Ward.Green || !patches[l.patch].inner) continue
      if (Math.abs(area(l.poly)) < 0.45) continue
      c.push({ q, d: Math.hypot(l.cx - plazaX, l.cy - plazaY) + 0.4 * rnd(q, 0x6c) })
    }
    c.sort((a, b) => a.d - b.d || a.q - b.q)
    freeLots = c.map((x) => x.q)
    return freeLots
  }
  const landmark = (spec: LandmarkSpec): PlanItem[] => {
    const out: PlanItem[] = []
    const { kind, ord } = spec
    const salt = kind * 64 + ord
    const base = { kind: spec.code, style, roof: hash4(seed, id, 0x6a, salt) % 5, wall: hash4(seed, id, 0x6b, salt) % 4, jitter: rnd(salt, 0x6d), homes: 0 }
    let x = 0, y = 0, yaw = 0, s = 0, ward: number = Ward.Plaza
    let patch = lmSlot.get(salt) ?? -1
    const smax = spec.great ? 1.5 : 1.05
    // (taller than its footprint alone would make it: a landmark rises over the roofs; the more so in a city of tall houses)
    const inPatch = (i: number, m = 0.14) => {
      const pa = patches[i]
      x = pa.cx; y = pa.cy
      yaw = longestEdgeYaw(i)
      s = fitBox(pa.poly.p, x, y, yaw, spec.hx, spec.hz, smax, m)
      ward = pa.ward
    }
    if (patch < 0 && (kind === LK.Monastery || kind === LK.Shrine || kind === LK.Mausoleum)) {
      // out of town: a monastery on high ground off the roads, a shrine on a rise or in a wood, a tomb by the main road
      const cand = outerPatches()
      const ra = site.routes[ord % Math.max(1, site.routes.length)] ?? 0
      const score = (i: number) => {
        const pa = patches[i]
        const d = Math.hypot(pa.cx, pa.cy) / Math.max(1, Rin)
        if (kind === LK.Mausoleum) return (1 - (pa.cx * Math.cos(ra) + pa.cy * Math.sin(ra)) / (Math.hypot(pa.cx, pa.cy) || 1)) * 3 + d * 0.5 - (onMain(i) ? 1 : 0)
        const h = (hgt[i] - hgt[0]) / site.unit
        return -h * (kind === LK.Monastery ? 2 : 1) + d * 0.6 + (onMain(i) ? 1.5 : 0) + slope[i] * 6 + 0.3 * rnd(i, 0x6e + kind)
      }
      const ranked = cand.map((i) => ({ i, v: score(i) })).sort((a, b) => a.v - b.v || a.i - b.i)
      // the ord-th of its kind, each well apart from those before it
      const taken: number[] = []
      for (const { i } of ranked) {
        if (taken.some((j) => Math.hypot(patches[j].cx - patches[i].cx, patches[j].cy - patches[i].cy) < PATCH * 1.5)) continue
        taken.push(i)
        if (taken.length > ord) break
      }
      patch = taken[ord] ?? taken[taken.length - 1] ?? -1
    }
    if (kind === LK.Lighthouse) {
      // on the shore toward open water: the dry patch edge facing water farthest out from the plaza
      let bx = 0, by = 0, bv = -Infinity, bn = 0
      const reach = Math.min(order.length, innerSet.length + 30)
      for (let q = 0; q < reach; q++) {
        const i = order[q]
        const pa = patches[i]
        const p = pa.poly.p, nv = p.length / 2
        for (let k = 0; k < nv; k++) {
          const t = pa.poly.t[k]
          if (!(t >= 0 && patches[t].water)) continue
          const k1 = (k + 1) % nv
          const mx = (p[k * 2] + p[k1 * 2]) / 2, my = (p[k * 2 + 1] + p[k1 * 2 + 1]) / 2
          const dx = mx - pa.cx, dy = my - pa.cy, dl = Math.hypot(dx, dy) || 1
          const px = mx - (dx / dl) * 0.45, py = my - (dy / dl) * 0.45
          const v = Math.hypot(px - plazaX, py - plazaY) + 0.5 * rnd(i * 16 + k, 0x6f) - (ord > 0 ? 0 : 0)
          if (v > bv && site.clear(px, py, 0.3) && !site.wet(px, py, 0.02)) { bv = v; bx = px; by = py; bn = Math.atan2(dy, dx) }
        }
      }
      if (bv > -Infinity) {
        x = bx; y = by; yaw = bn + Math.PI / 2; s = smax * 0.85; ward = Ward.Harbour
        patch = -2
      }
    }
    if (kind === LK.Monument && patch < 0 && isTown && ord === 0) {
      // on the plaza, across from the market stalls
      const pl = patches[plaza]
      const a = Math.atan2(pl.cy * 0.3 - pl.cy, pl.cx * 0.3 - pl.cx)
      const r = Math.min(0.7, inradiusOf(pl) * 0.55)
      x = pl.cx - Math.cos(a) * r * 0.2 + Math.cos(a + Math.PI * 0.6) * r; y = pl.cy - Math.sin(a) * r * 0.2 + Math.sin(a + Math.PI * 0.6) * r
      yaw = longestEdgeYaw(plaza)
      s = Math.min(smax, Math.max(0.5, (r * 0.9) / Math.max(spec.hx, spec.hz)))
      ward = Ward.Plaza
      patch = -2
    }
    if (patch >= 0) {
      inPatch(patch, kind === LK.Castle ? 0.12 : 0.06)
      // a great one fills the open ground kept round it
      const r = lmClearAt.get(salt) ?? 0
      if (r > 0) s = Math.max(s, Math.min(spec.great ? 2.6 : 1.3, (r - 0.1) / Math.hypot(spec.hx, spec.hz)))
    }
    // a landmark the plan kept no room for (or whose place is wet): the empty lot it fits best near the plaza, each lot tried
    // on dry clear ground (village patches: one of the inner ones)
    const elsewhere = () => {
      if (!isTown) {
        for (let t = 0; t < innerSet.length; t++) {
          const k = Math.min(innerSet.length - 1, 1 + ((salt * 7 + t) % Math.max(1, innerSet.length - 1)))
          inPatch(innerSet[k], 0.1)
          if (site.clear(x, y, 0.3) && !site.wet(x, y, 0.02)) return
        }
        return
      }
      const fl = freeLotList()
      let best = -1, bs = 0
      const start = fl.length ? hash4(seed, id, 0x70, salt) % Math.min(6, fl.length) : 0
      for (let t = 0; t < Math.min(40, fl.length); t++) {
        const q = fl[(start + t) % fl.length]
        const l = lots[q]
        if (!site.clear(l.cx, l.cy, 0.3) || site.wet(l.cx, l.cy, 0.02)) continue
        const yw = Math.atan2(l.uy, l.ux)
        const sc = fitBox(l.poly, l.cx, l.cy, yw, spec.hx, spec.hz, smax, 0.02)
        if (sc > bs * 1.25) { bs = sc; best = q }
        if (sc >= smax * 0.6) break
      }
      if (best >= 0) {
        const l = lots[best]
        x = l.cx; y = l.cy; yaw = Math.atan2(l.uy, l.ux); s = bs; ward = patches[l.patch].ward
      } else inPatch(innerSet[Math.min(innerSet.length - 1, 1)], 0.1)
    }
    if (patch === -1) elsewhere()
    else if (site.wet(x, y, 0.02) || !site.clear(x, y, 0.3)) elsewhere()
    s = Math.max(spec.great ? 0.6 : 0.45, s)
    // (on wet ground or over a river: smaller, then where it may)
    for (let t = 0; t < 4 && !site.clear(x, y, Math.min(spec.hx, spec.hz) * s * 0.7); t++) s *= 0.85
    // its height: its own proportions, raised (at most by half) until it stands well over the roofs, twice a city's houses
    // (a great one; a temple half again, its tower or dome above them)
    const minH = (spec.great ? 2.3 : 2.0) * (isCity ? 1.25 : 1)
    // (a broad building, a temple on its podium, a ziggurat, a market hall, keeps its proportions: only towers and spires are raised)
    const tall = spec.h > 1.25 * Math.min(spec.hx, spec.hz) * 2
    const lift = kind === LK.Monument || kind === LK.Shrine || !tall ? 1 : Math.min(1.6, Math.max(1, minH / Math.max(0.1, spec.h * s)))
    out.push({ ...base, role: Role.Landmark, x, y, yaw, sx: s, sz: s, sy: s * lift, threshold: LandmarkPart.Building, ward })
    const ux = Math.cos(yaw), uy = Math.sin(yaw)
    // the plan's yaw is the model's x axis; its front (+z) faces (sin yaw, -cos yaw)
    const fx = Math.sin(yaw), fy = -Math.cos(yaw)
    if (spec.extra >= 0) {
      // a monastery's cloister behind its church
      const o = (spec.hz + spec.ehz) * s * 0.95
      out.push({ ...base, kind: spec.extra, role: Role.Landmark, x: x - fx * o, y: y - fy * o, yaw, sx: s, sz: s, sy: s, threshold: LandmarkPart.Building, ward })
    }
    // the scaffold round the works, a little larger than the building
    out.push({ ...base, kind: spec.scaffold, role: Role.Landmark, x, y, yaw, sx: spec.hx * 2.1 * s, sz: spec.hz * 2.1 * s, sy: spec.h * 0.75 * s * lift, threshold: LandmarkPart.Scaffold, ward })
    // beside it: the builders' yard while it goes up, a roofless outbuilding of its neglect, a tower standing with it
    const side = (code: number, part: number, along: number, across: number, sc: number) => {
      if (code < 0) return
      for (const sg of [1, -1]) {
        const px = x + (ux * along * sg + fx * across) * 1, py = y + (uy * along * sg + fy * across) * 1
        if (!site.clear(px, py, sc * 0.8)) continue
        out.push({ ...base, kind: code, role: Role.Landmark, x: px, y: py, yaw: yaw + (sg < 0 ? Math.PI : 0), sx: sc, sz: sc, sy: sc, threshold: part, ward })
        return
      }
    }
    side(spec.yard, LandmarkPart.Scaffold, spec.hx * s + 0.45, spec.hz * s * 0.3, Math.max(0.32, 0.42 * Math.min(1, s)))
    side(spec.outbuilding, LandmarkPart.Outbuilding, spec.hx * s * 0.55, -(spec.hz * s + 0.38), Math.max(0.28, 0.34 * Math.min(1, s)))
    side(spec.tower, LandmarkPart.Works, spec.hx * s + 0.32, -spec.hz * s * 0.6, Math.max(0.3, 0.36 * s))
    // a ruin's debris: tumbled stones along its walls, a tree or two grown up through it

    for (let q = 0; q < 4; q++) {
      const a = rnd(salt * 8 + q, 0x71) * 2 - 1, b = q % 2 ? 1 : -1
      const px = x + (ux * a * spec.hx * 0.9 + fx * b * spec.hz * 1.05) * s, py = y + (uy * a * spec.hx * 0.9 + fy * b * spec.hz * 1.05) * s
      out.push({ ...base, kind: 0, role: Role.Rubble, x: px, y: py, yaw: a * 3, sx: 0.55 + 0.35 * rnd(q, 0x72), sz: 0.55, sy: 0.7, threshold: LandmarkPart.Debris, ward })
    }
    for (let q = 0; q < 2; q++) {
      const a = (rnd(salt * 8 + q, 0x73) * 2 - 1) * 0.7, b = q ? 0.6 : -0.5
      out.push({ ...base, kind: 0, role: Role.Grove, x: x + (ux * a * spec.hx + fx * b * spec.hz) * s, y: y + (uy * a * spec.hx + fy * b * spec.hz) * s, yaw: q * 2.3, sx: 0.5, sz: 0.5, sy: 0.55, threshold: LandmarkPart.Debris, ward })
    }
    return out
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
  /** Height scale at which a narrow house standing alone stays a house rather than a spire: its ridge at most 3.6 times its narrower side. */
  const spireCap = (kind: number, sx: number, sz: number) => {
    const [hw, hd] = KIND_HALF[kind]
    return (3.6 * Math.min(2 * hw * sx, 2 * hd * sz) * hScale) / 1.05
  }
  /** Storeys of a town house by ward and nearness to the core (as fitHouse counts them; one out of town and in the slums). */
  const storeysOf = (ward: Ward, dCore: number, kind: number, hs: StyleT, k: number): number => {
    if (!isTown || ward === Ward.Slum || ward === Ward.Farm || ward === Ward.Outskirts || ward === Ward.Village) return 1
    const zone = dCore < 0.38 ? 2 : dCore < 0.72 ? 1 : 0
    let st = (isCity ? [1.2, 1.8, 2.4][zone] + (peak >= 40000 ? 0.7 : 0) : [1, 1, 1.5][zone]) + (ward === Ward.Merchant || ward === Ward.Patrician ? (isCity ? 0.4 : 0.2) : 0)
    const r3 = rnd(k, 0x58)
    st = Math.max(1, Math.floor(st + (r3 < 0.15 ? -1 : r3 > 0.9 ? 1 : 0) + rnd(k, 0x59) * 0.99))
    const detached = kind === Kind.Small || kind === Kind.House || kind === Kind.Long || kind === Kind.Ell
    return Math.min(st, detached ? (hutStyle(hs) ? 1 : 2) : 4, hutStyle(hs) ? 3 : 4)
  }
  /**
   * A continuous street front for a lot of a town's dense ward: a terrace of narrow houses
   * wall to wall along its whole frontage, at the street line, the yard behind (so the
   * houses of neighbouring lots, a party wall's width apart, make one row along the street).
   * Each house is its own instance and household count; null if the lot will not take one.
   */
  const terraceFit = (l: Lot, k: number, ward: Ward, hs: StyleT, dCore: number, vxd: number, vyd: number): PlanItem | null => {
    const ux = l.ux, uy = l.uy
    const width = l.fl - 0.02
    if (width < 0.48) return null
    let depth = Infinity
    for (const t of [0.07, l.fl / 2, l.fl - 0.07]) depth = Math.min(depth, rayExtent(l.poly, l.fx + ux * t + vxd * 0.005, l.fy + uy * t + vyd * 0.005, vxd, vyd))
    const D = Math.min(depth - 0.06, (ward === Ward.Slum ? 0.56 : 0.72) + 0.24 * rnd(k, 0x5f))
    if (D < 0.38) return null
    const unit = (ward === Ward.Merchant ? 0.6 : ward === Ward.Slum ? 0.44 : 0.52) * (0.88 + 0.24 * rnd(k, 0x60))
    const n = Math.max(1, Math.min(9, Math.round(width / unit)))
    const w = width / n
    const uk = hutStyle(hs) || w < 0.7 ? Kind.Tall : Kind.House
    const [hw, hd] = KIND_HALF[uk]
    const sx = w / (2 * hw), sz = D / (2 * hd)
    if (sx < 0.55 || sx > 1.8 || sz < 0.55 || sz > 1.7) return null
    const s0 = 0.012
    for (const [a, b] of [[0.01, s0], [width + 0.01, s0], [0.01, s0 + D], [width + 0.01, s0 + D]]) if (!insideConvex(l.poly, l.fx + ux * a + vxd * b, l.fy + uy * a + vyd * b, -0.03)) return null
    let yaw = Math.atan2(uy, ux)
    if (Math.sin(yaw) * vxd - Math.cos(yaw) * vyd > 0) yaw += Math.PI
    const fac = houseFacade(hs, uk)
    const st0 = storeysOf(ward, dCore, Kind.Row, hs, k)
    const units: PlanItem[] = []
    let total = 0
    for (let q = 0; q < n; q++) {
      const kq = k * 16 + q
      const r4 = rnd(kq, 0x61)
      const stq = Math.max(1, Math.min(hutStyle(hs) ? 3 : 4, st0 + (st0 > 1 && r4 < 0.2 ? -1 : r4 > 0.86 ? 1 : 0)))
      let syq = (0.92 + 0.16 * rnd(kq, 0x52)) * Math.min(1.2, Math.max(0.88, Math.sqrt(Math.min(sx, sz))))
      if (ward === Ward.Slum) syq *= 0.9
      if (stq >= 2 && fac[1] > fac[0]) syq = Math.min(uk === Kind.Tall ? 2.3 : 1.55, (STOREY_H * stq + 0.025 + 0.07 * rnd(kq, 0x62)) / (fac[1] - fac[0]) / hScale)
      const homes = households(roofUnits(hs, uk), storeys(fac[0], fac[1], syq * hScale))
      const o = w * (q + 0.5) + 0.01
      units.push({ role: Role.House, kind: uk, style: hs, x: l.fx + ux * o + vxd * (s0 + D / 2), y: l.fy + uy * o + vyd * (s0 + D / 2), yaw, sx, sz, sy: syq, threshold: 0, roof: hash4(seed, id, kq, 0x53) % 5, wall: hash4(seed, id, kq, 0x54) % 4, jitter: rnd(kq, 0x55), ward, homes })
      total += homes
    }
    const mid = width / 2 + 0.01
    return { ...units[0], x: l.fx + ux * mid + vxd * (s0 + D / 2), y: l.fy + uy * mid + vyd * (s0 + D / 2), sx: sx * n, units, homes: total }
  }
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
    let ux = l.ux, uy = l.uy
    let vxd = -uy, vyd = ux
    if ((l.cx - l.fx) * vxd + (l.cy - l.fy) * vyd < 0) { vxd = -vxd; vyd = -vyd }
    // out of town: along a road the houses front it (a ribbon); elsewhere they stand in their
    // plots square to the patch's fields and lanes, a farmhouse with its rick or orchard
    const outskirt = ward === Ward.Farm || ward === Ward.Outskirts
    const farm = outskirt && !l.main && (ward === Ward.Farm || r2 > 0.6 || !l.street)
    if (farm) {
      const fdx = fieldX[l.patch], fdy = fieldY[l.patch]
      if (r < 0.5) { ux = fdx; uy = fdy } else { ux = -fdy; uy = fdx }
      vxd = -uy; vyd = ux
    }
    const along = (l.cx - l.fx) * ux + (l.cy - l.fy) * uy
    // continuous street fronts in a town's dense wards: a terrace wall to wall along the frontage
    const terraceWard = ward === Ward.Craftsmen || ward === Ward.Merchant || ward === Ward.Slum || ward === Ward.Cathedral || (ward === Ward.Gate && patches[l.patch].inner) || (ward === Ward.Harbour && r >= 0.55)
    if (isTown && terraceWard && l.street && kind !== Kind.Block && rnd(k, 0x5e) < 0.9) {
      const t = terraceFit(l, k, ward, hs, dCore, vxd, vyd)
      if (t) return t
    }
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
          if (kind === Kind.Tall) sy = Math.min(sy, Math.max(0.7, spireCap(Kind.Tall, sxk, szk)))
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
          } else if (farm && !multi && (ward === Ward.Farm || r2 > 0.8)) {
            // a farmstead: its rick (or an orchard tree) behind the house, square to it
            const back = hd * szk + 0.24
            const hx = cx - vxd * back, hy = cy - vyd * back
            if (insideConvex(l.poly, hx, hy, 0.05) && site.clear(hx, hy, 0.18)) {
              const hay = hs === Style.Temperate || hs === Style.Cold || hs === Style.Savanna
              const extra: PlanItem = hay
                ? { ...item, role: Role.Haystack, kind: 0, x: hx, y: hy, sx: 0.75, sz: 0.75, sy: 0.75, homes: 0 }
                : { ...item, role: Role.Grove, kind: 0, x: hx, y: hy, sx: 0.4, sz: 0.4, sy: 0.4, homes: 0 }
              item.units = [{ ...item }, extra]
            }
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

  // ---- tourism: a resort quarter (resort.ts says which towns and from when) ----
  /** Shore edges of the dry patches: x0, y0, x1, y1, patch, inward normal x, y (7 numbers each); computed once. */
  let shoreEdges: number[] | null = null
  const shoreOf = (): number[] => {
    if (shoreEdges) return shoreEdges
    const out: number[] = []
    for (const i of order) {
      const p = patches[i].poly.p
      const n = p.length / 2
      for (let q = 0; q < n; q++) {
        const t = patches[i].poly.t[q]
        if (!(t >= 0 && patches[t].water)) continue
        const q1 = (q + 1) % n
        const x0 = p[q * 2], y0 = p[q * 2 + 1], x1 = p[q1 * 2], y1 = p[q1 * 2 + 1]
        const l = Math.hypot(x1 - x0, y1 - y0)
        if (l < 0.2) continue
        // (CCW: inward is the edge turned a quarter left)
        out.push(x0, y0, x1, y1, i, -(y1 - y0) / l, (x1 - x0) / l)
      }
    }
    shoreEdges = out
    return out
  }
  /** Distance from (x, y) to segment (ax, ay)-(bx, by), and the nearest point into segNear. */
  const segNear = [0, 0]
  const segDist = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
    segNear[0] = ax + dx * t
    segNear[1] = ay + dy * t
    return Math.hypot(x - segNear[0], y - segNear[1])
  }
  /** Margin (surface.ts wet) of the shore as the quarter reads it: the drawn shore, a little inland of the contour on a flat coast. */
  const SHORE_M = 0.03
  /** Height scale for a building of kind in style hs with st storeys (as fitHouse sets it), capped. */
  const storeyScale = (hs: StyleT, kind: number, st: number, r: number, cap: number) => {
    const fac = houseFacade(hs, kind as Kind)
    if (st < 2 || fac[1] <= fac[0]) return 0.95 + 0.1 * r
    return Math.min(cap, (STOREY_H * st + 0.025 + 0.07 * r) / (fac[1] - fac[0]) / hScale)
  }
  /**
   * The quarter, on the town's empty lots within reach of the town at pop and a little past its edge. By the
   * water (a sea or lake shore near the town's patches): the shore as drawn is found off the lots nearest the
   * water patches and followed both ways; the lots are ranked by nearness to it; the bath house, the lodges and
   * the villas take the best lots their footprints fit, their doors toward the water; then the promenade along
   * the shore by them (paving a little inland, where no house lot comes down to it, trees on its landward
   * side) and pleasure boats off it. Elsewhere the lots are ranked by height and the open view at the town's
   * edge, the buildings face out from the town, and a terrace (paving, a low parapet, two trees) lies before
   * the first lodge.
   */
  function* resortJob(pop: number, spec: ResortSpec, kinds: number): Generator<void, PlanItem[], void> {
    const out: PlanItem[] = []
    const k = Math.max(1, ringReach(Math.max(pop, 1)))
    let reach = k + 4
    // the water patches' edges near the town (a resort on the shore may reach a few patches out to it)
    const shore = shoreOf()
    const near: number[] = []
    for (let q = 0; q < shore.length; q += 7) if (rankOf[shore[q + 4]] < reach + 2) near.push(q)
    if (!near.length) {
      let r0 = Infinity
      for (let q = 0; q < shore.length; q += 7) r0 = Math.min(r0, rankOf[shore[q + 4]])
      if (r0 < k + 10) {
        reach = r0 + 3
        for (let q = 0; q < shore.length; q += 7) if (rankOf[shore[q + 4]] < reach + 2) near.push(q)
      }
    }
    const shoreDist = (x: number, y: number) => {
      let m = Infinity
      for (const q of near) m = Math.min(m, segDist(x, y, shore[q], shore[q + 1], shore[q + 2], shore[q + 3]))
      return m
    }
    let h0 = Infinity, h1 = -Infinity
    for (let q = 0; q < Math.min(order.length, reach); q++) { h0 = Math.min(h0, hgt[order[q]]); h1 = Math.max(h1, hgt[order[q]]) }
    const hr = h1 > h0 ? h1 - h0 : 1
    // the lots the town's works keep
    const kept = new Set<number>()
    for (const o of WORKS_PRIORITY) if (kinds & (1 << o)) for (const q of lotsFor(o, k, kinds).slice(0, WORKS_KEEP)) kept.add(q)
    const cand: { q: number; d: number }[] = []
    for (let q = 0; q < lots.length; q++) {
      if ((q & 63) === 63) yield
      const l = lots[q]
      if (!l.empty || kept.has(q)) continue
      const pi = l.patch
      const w = patches[pi].ward
      if (rankOf[pi] >= reach || paved(w) || w === Ward.Park || w === Ward.Green) continue
      // (an orchard tree stands on it)
      if (patches[pi].inner && leafy(w)) {
        const u = rand4(seed, id, Math.round(l.cx * 977 + l.cy * 131), 0x5a)
        if (u >= 0.62 && u < 0.9) continue
      }
      if (Math.abs(area(l.poly)) < 0.32) continue
      const dp = Math.hypot(l.cx - plazaX, l.cy - plazaY) / Math.max(1, Rin)
      const past = rankOf[pi] >= k ? 0.5 : 0
      let d: number
      if (near.length) d = shoreDist(l.cx, l.cy) + 0.25 * dp + past
      else {
        const edge = neighbours(pi).some((j) => rankOf[j] >= k) ? 1 : 0
        d = -2.2 * ((hgt[pi] - h0) / hr) - 0.6 * edge + 0.4 * dp + past * 0.4 - (riverNear[pi] ? 0.5 : 0)
      }
      cand.push({ q, d: d + 0.25 * rnd(q, 0x6a) })
    }
    cand.sort((a, b) => a.d - b.d || a.q - b.q)
    yield
    // ---- the shore as drawn: x, y (dry ground just short of the water), nx, ny (toward the water), in order along it ----
    const trace: number[] = []
    let start = 0
    if (near.length || spec.shore) {
      let sx0 = 0, sy0 = 0, nx0 = 0, ny0 = 0, best = Infinity
      /** The nearest water along n rays from (x0, y0) out to reach (step apart): best and the dry point before it. */
      function* rays(x0: number, y0: number, n: number, reach: number, step: number): Generator<void, void, void> {
        if (site.wet(x0, y0, SHORE_M)) return
        for (let r = 0; r < n; r++) {
          if ((r & 7) === 7) yield
          const ang = (r / n) * Math.PI * 2, dx = Math.cos(ang), dy = Math.sin(ang)
          for (let d = step; d < Math.min(best, reach); d += step) {
            if (!site.wet(x0 + dx * d, y0 + dy * d, SHORE_M)) continue
            best = d
            sx0 = x0 + dx * (d - step); sy0 = y0 + dy * (d - step); nx0 = dx; ny0 = dy
            break
          }
        }
      }
      // off the lots nearest the water patches, else (a shore the plan's patches do not reach) out from the town's middle
      if (near.length) for (let c = 0; c < Math.min(cand.length, 3); c++) yield* rays(lots[cand[c].q].cx, lots[cand[c].q].cy, 12, 3.6, 0.15)
      if (best === Infinity) yield* rays(plazaX, plazaY, 24, Rin * 1.1 + 3.5, 0.3)
      /** Dry ground just short of the shore near (x, y), looking toward the water along (nx, ny), into shoreAt; false if no shore there. */
      const shoreAt = [0, 0]
      const findShore = (x: number, y: number, nx: number, ny: number) => {
        let prevDry = !site.wet(x - nx * 1.3, y - ny * 1.3, SHORE_M)
        for (let s = -1.2; s <= 0.9; s += 0.1) {
          const wet = site.wet(x + nx * s, y + ny * s, SHORE_M)
          if (wet && prevDry) {
            // back inland to ground paving stands on: dry where it lies and on its seaward side, off any river
            for (let back = 0.12; back <= 0.8; back += 0.08) {
              const px = x + nx * (s - back), py = y + ny * (s - back)
              if (site.wet(px, py, SHORE_M) || site.wet(px + nx * 0.18, py + ny * 0.18, SHORE_M) || onRiver(px, py)) continue
              shoreAt[0] = px; shoreAt[1] = py
              return true
            }
            return false
          }
          prevDry = !wet
        }
        return false
      }
      const STEP = 0.3
      const back: number[] = []
      for (const dir of best < Infinity && findShore(sx0, sy0, nx0, ny0) ? [1, -1] : []) {
        let x = shoreAt[0], y = shoreAt[1], nx = nx0, ny = ny0
        const into = dir > 0 ? trace : back
        if (dir > 0) into.push(x, y, nx, ny)
        for (let s = 0; s < 14; s++) {
          if ((s & 3) === 3) yield
          // along the shore (the normal turned a quarter), then back onto it
          if (!findShore(x - ny * STEP * dir, y + nx * STEP * dir, nx, ny)) break
          const tx = (shoreAt[0] - x) * dir, ty = (shoreAt[1] - y) * dir, tl = Math.hypot(tx, ty)
          if (tl < 0.05) break
          x = shoreAt[0]; y = shoreAt[1]
          // the new normal: the step turned back a quarter, toward the water
          nx = ty / tl; ny = -tx / tl
          into.push(x, y, nx, ny)
        }
      }
      // one line, from the far end of the backward run on
      start = back.length / 4
      const line: number[] = []
      for (let q = back.length - 4; q >= 0; q -= 4) line.push(back[q], back[q + 1], back[q + 2], back[q + 3])
      for (const v of trace) line.push(v)
      trace.length = 0
      for (const v of line) trace.push(v)
    }
    const water = trace.length > 0
    /** Nearest point of the traced shore (its index into trace) and the distance to it. */
    let nearT = 0
    const traceDist = (x: number, y: number) => {
      let m = Infinity
      for (let q = 0; q < trace.length; q += 4) {
        const d = Math.hypot(trace[q] - x, trace[q + 1] - y)
        if (d < m) { m = d; nearT = q }
      }
      return m
    }
    if (water) {
      // ranked again by the shore itself
      for (const c of cand) {
        const l = lots[c.q]
        const dp = Math.hypot(l.cx - plazaX, l.cy - plazaY) / Math.max(1, Rin)
        c.d = traceDist(l.cx, l.cy) + 0.25 * dp + (rankOf[l.patch] >= k ? 0.4 : 0) + 0.25 * rnd(c.q, 0x6a)
      }
      cand.sort((a, b) => a.d - b.d || a.q - b.q)
      yield
    }
    /** Placed footprints: x, y, radius. */
    const taken: number[] = []
    const free = (x: number, y: number, r: number) => {
      for (let q = 0; q < taken.length; q += 3) if (Math.hypot(taken[q] - x, taken[q + 1] - y) < r + taken[q + 2]) return false
      return true
    }
    const used = new Set<number>()
    const base = { kind: 0, style, threshold: 0, roof: hash4(seed, id, 0x37, 0) % 5, wall: hash4(seed, id, 0x38, 0) % 4, jitter: 0.5, ward: Ward.Resort as number, homes: 0, x: 0, y: 0, yaw: 0, sx: 1, sz: 1, sy: 1 }
    const fitT = { x: 0, y: 0, yaw: 0, s: 0 }
    /** The largest scale from big down to small at which kind stands in lot l, door (+z) toward (fx, fy), else along or across its street front. */
    const fitOn = (l: Lot, kind: number, big: number, small: number, fx: number, fy: number): boolean => {
      const [hw, hd] = KIND_HALF[kind]
      const yaws = [Math.atan2(fx, -fy), Math.atan2(l.uy, l.ux), Math.atan2(l.uy, l.ux) + Math.PI / 2]
      for (let s = big; s >= small - 1e-9; s *= 0.9) {
        for (const yaw of yaws) {
          const ux = Math.cos(yaw), uy = Math.sin(yaw), vx = uy, vy = -ux
          const ex = hw * s, ez = hd * s
          let ok = true
          for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            if (!insideConvex(l.poly, l.cx + ux * ex * a + vx * ez * b, l.cy + uy * ex * a + vy * ez * b, -0.03)) { ok = false; break }
          }
          if (!ok) continue
          if (!free(l.cx, l.cy, Math.max(ex, ez) * 0.9) || !site.clear(l.cx, l.cy, Math.max(ex, ez) * 0.75)) return false
          fitT.x = l.cx; fitT.y = l.cy; fitT.yaw = yaw; fitT.s = s
          return true
        }
      }
      return false
    }
    /** Which way a lot looks (into o): out over the water, else out from the town. */
    const facing = (l: Lot, o: number[]) => {
      if (water) {
        traceDist(l.cx, l.cy)
        o[0] = trace[nearT + 2]; o[1] = trace[nearT + 3]
        return
      }
      o[0] = l.cx - plazaX; o[1] = l.cy - plazaY
      const n = Math.hypot(o[0], o[1]) || 1
      o[0] /= n; o[1] /= n
    }
    const look = [0, 0]
    const hut = style === Style.Savanna || style === Style.Rainforest
    /** Takes the best free lot of at least minArea that kind fits (its fit in fitT), or null. */
    const take = (kind: number, big: number, small: number, minArea: number): Lot | null => {
      for (const { q } of cand) {
        if (used.has(q)) continue
        const l = lots[q]
        if (Math.abs(area(l.poly)) < minArea) continue
        facing(l, look)
        if (!fitOn(l, kind, big, small, look[0], look[1])) continue
        used.add(q)
        return l
      }
      return null
    }
    const anchors: number[] = [] // x, y of the quarter's buildings (the promenade runs by them)
    let firstLodge: { x: number; y: number; yaw: number; ez: number } | null = null
    // the bath house over the springs: ranges round a pool court, the spring's fountain before its door
    if (spec.bath) {
      const l = take(Kind.Block, 0.9, 0.55, 0.5)
      if (l) {
        const { x, y, yaw, s } = fitT
        const ez = KIND_HALF[Kind.Block][1] * s
        out.push({ ...base, role: Role.Ground, kind: GroundKind.Plaza, x, y, sx: ez * 2.4, sz: ez * 2.4 })
        out.push({ ...base, role: Role.House, kind: Kind.Block, x, y, yaw, sx: s, sz: s, sy: hut ? 0.8 : 0.72, jitter: rnd(1, 0x6b) })
        const fx = Math.sin(yaw), fy = -Math.cos(yaw)
        const wx = x + fx * (ez + 0.2), wy = y + fy * (ez + 0.2)
        if (site.clear(wx, wy, 0.12)) out.push({ ...base, role: Role.Well, x: wx, y: wy, yaw, sx: 0.9, sz: 0.9, sy: 0.9 })
        taken.push(x, y, ez * 1.3)
        anchors.push(x, y)
      }
      yield
    }
    /** Clear of the main streets and roads and of the wall lines (a building off the lots). */
    const offRoad = (x: number, y: number, r: number) => {
      for (const ek of mainEdges) {
        const a = Math.floor(ek / 100000), b = ek % 100000
        if (segDist(x, y, vx[a], vy[a], vx[b], vy[b]) < r + mainHalf + 0.05) return false
      }
      for (const ek of wallEdges) {
        const a = Math.floor(ek / 100000), b = ek % 100000
        if (segDist(x, y, vx[a], vy[a], vx[b], vy[b]) < r + WALL_HALF + 0.2) return false
      }
      return true
    }
    /** Seafront lodges stand along the traced shore itself (off the lots, its door to the water), the nearest the town first. */
    const fronts: number[] = []
    for (let q = 0; q < trace.length / 4; q += 2) fronts.push(q)
    fronts.sort((a, b) => Math.abs(a - start) - Math.abs(b - start) || a - b)
    const seafront = (kind: number, big: number, small: number): boolean => {
      const [hw, hd] = KIND_HALF[kind]
      for (const q of fronts) {
        const x0 = trace[q * 4], y0 = trace[q * 4 + 1], nx = trace[q * 4 + 2], ny = trace[q * 4 + 3]
        for (let s = big; s >= small - 1e-9; s *= 0.88) {
          const ex = hw * s, ez = hd * s
          const cx = x0 - nx * (ez + 0.14), cy = y0 - ny * (ez + 0.14)
          const ux = -ny, uy = nx
          let ok = !onRiver(cx, cy) && offRoad(cx, cy, ez) && !onLot(cx, cy, 0.03)
          for (let e = -1; e <= 1 && ok; e++) if (!free(cx + ux * e * (ex - ez), cy + uy * e * (ex - ez), ez * 0.9)) ok = false
          for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            if (!ok) break
            const px = cx + ux * ex * a - nx * ez * b, py = cy + uy * ex * a - ny * ez * b
            if (site.wet(px, py, SHORE_M) || onLot(px, py, 0.03)) ok = false
          }
          if (!ok) continue
          fitT.x = cx; fitT.y = cy; fitT.yaw = Math.atan2(nx, -ny); fitT.s = s
          return true
        }
      }
      return false
    }
    // the lodges: long ranges of two storeys (one in the hut styles), a grand hotel round a court first in a large
    // resort; on the seafront where it has room, else on the lots nearest the water (or the view)
    for (let j = 0; j < spec.lodges; j++) {
      const grand = j === 0 && spec.lodges >= 3 && !hut
      const kind = grand ? Kind.Block : Kind.Long
      const big = grand ? 0.95 : 1.4, small = grand ? 0.7 : 0.8
      const front = water && seafront(kind, big, small)
      if (!front && !take(kind, big, small, grand ? 0.6 : 0.45)) break
      const { x, y, yaw, s } = fitT
      const r = rnd(j, 0x6c)
      const sy = grand ? 0.95 + 0.1 * r : storeyScale(style, kind, hut ? 1 : 2, r, 1.55)
      out.push({ ...base, role: Role.House, kind, x, y, yaw, sx: s, sz: s * (grand ? 1 : 1.12), sy, roof: hash4(seed, id, 0x39, j) % 5, wall: hash4(seed, id, 0x3a, j) % 4, jitter: r })
      const [hw, hd] = KIND_HALF[kind]
      if (front) {
        // (as three discs along its length, so the promenade passes before it)
        const ux = Math.cos(yaw), uy = Math.sin(yaw), ex = hw * s, ez = hd * s * 1.12
        for (let e = -1; e <= 1; e++) taken.push(x + ux * e * Math.max(0, ex - ez), y + uy * e * Math.max(0, ex - ez), ez)
      } else taken.push(x, y, Math.max(hw, hd) * s)
      anchors.push(x, y)
      if (!firstLodge) firstLodge = { x, y, yaw, ez: hd * s * (grand ? 1 : 1.12) }
      yield
    }
    // the villas: an L-shaped house (a plain one in the north and the hut styles) in its garden, a lawn and a tree or two
    for (let j = 0; j < spec.villas; j++) {
      const hs = site.houseStyle(rnd(j, 0x6d))
      const hh = hs === Style.Savanna || hs === Style.Rainforest
      const kind = hs === Style.Cold || hh ? Kind.House : Kind.Ell
      const l = take(kind, 1.25, 0.72, 0.42)
      if (!l) break
      const { x, y, yaw, s } = fitT
      const r = rnd(j, 0x6e)
      const [hw, hd] = KIND_HALF[kind]
      const lawn = Math.min(1.1, Math.sqrt(Math.abs(area(l.poly))) * 0.62)
      out.push({ ...base, role: Role.Ground, kind: GroundKind.Yard, x, y, sx: lawn, sz: lawn })
      out.push({ ...base, role: Role.House, kind, style: hs, x, y, yaw, sx: s, sz: s, sy: storeyScale(hs, kind, hh ? 1 : 2, r, 1.55), roof: hash4(seed, id, 0x3b, j) % 5, wall: hash4(seed, id, 0x3c, j) % 4, jitter: r })
      taken.push(x, y, Math.max(hw, hd) * s)
      anchors.push(x, y)
      // garden trees toward the lot's corners, clear of the house
      const nv = l.poly.length / 2
      let trees = 0
      for (let v = 0; v < nv && trees < 2; v++) {
        const c = (v + Math.floor(r * nv)) % nv
        const tx = l.cx + (l.poly[c * 2] - l.cx) * 0.62, ty = l.cy + (l.poly[c * 2 + 1] - l.cy) * 0.62
        if (Math.hypot(tx - x, ty - y) < Math.max(hw, hd) * s + 0.16 || !insideConvex(l.poly, tx, ty, 0.06) || !site.clear(tx, ty, 0.12)) continue
        const z = 0.36 + 0.14 * rnd(j * 8 + v, 0x6f)
        out.push({ ...base, role: Role.Grove, x: tx, y: ty, yaw: r * 40 + v, sx: z, sz: z, sy: z, jitter: rnd(j * 8 + v, 0x70) })
        trees++
      }
      yield
    }
    let pieces = 0
    if (water && anchors.length) {
      // the promenade: along the traced shore where it passes the quarter
      let trees = 0, boats = 0, run = 0
      const boatAt: number[] = []
      for (let q = 0; q < trace.length && pieces < 34; q += 4) {
        if ((q & 15) === 12) yield
        const x = trace[q], y = trace[q + 1], nx = trace[q + 2], ny = trace[q + 3]
        let close = false
        for (let a = 0; a < anchors.length && !close; a += 2) if (Math.hypot(anchors[a] - x, anchors[a + 1] - y) < 2.6) close = true
        if (!close || onLot(x, y, 0.02) || !free(x, y, 0.1)) { run = 0; continue }
        out.push({ ...base, role: Role.Ground, kind: GroundKind.Plaza, x, y, sx: 0.46, sz: 0.46, jitter: rnd(q, 0x71) })
        pieces++
        // its sea wall: a low kerb along the water's side from the piece before
        if (run > 0) {
          const ax = trace[q - 4] + trace[q - 2] * 0.14, ay = trace[q - 3] + trace[q - 1] * 0.14, bx = x + nx * 0.14, by = y + ny * 0.14
          const len = Math.hypot(bx - ax, by - ay)
          if (len > 0.05) out.push({ ...base, role: Role.WallSeg, x: (ax + bx) / 2, y: (ay + by) / 2, yaw: Math.atan2(by - ay, bx - ax), sx: len * 1.06, sz: 0.75, sy: 0.32 })
        }
        // (a second row a little inland: the paving reads as a broad walk)
        const ix = x - nx * 0.2, iy = y - ny * 0.2
        if (!onLot(ix, iy, 0.02) && free(ix, iy, 0.1) && !site.wet(ix, iy, SHORE_M)) out.push({ ...base, role: Role.Ground, kind: GroundKind.Plaza, x: ix, y: iy, sx: 0.46, sz: 0.46, jitter: rnd(q, 0x77) })
        run++
        // trees along its landward side
        if (run % 3 === 2 && trees < 10) {
          const tx = x - nx * 0.5, ty = y - ny * 0.5
          if (!onLot(tx, ty, 0.06) && free(tx, ty, 0.12) && !site.wet(tx, ty, SHORE_M) && !onRiver(tx, ty)) {
            const z = 0.34 + 0.1 * rnd(q, 0x72)
            out.push({ ...base, role: Role.Grove, x: tx, y: ty, yaw: q, sx: z, sz: z, sy: z, jitter: rnd(q, 0x73) })
            taken.push(tx, ty, 0.1)
            trees++
          }
        }
        // a pleasure boat off every few pieces, out on open water
        if (run % 3 === 1 && boats < spec.boats) {
          for (let d = 0.5; d <= 3.0; d += 0.25) {
            const wx = x + nx * d, wy = y + ny * d
            if (!site.wet(wx, wy, -0.3)) continue
            let crowded = false
            for (let b = 0; b < boatAt.length && !crowded; b += 2) if (Math.hypot(boatAt[b] - wx, boatAt[b + 1] - wy) < 0.8) crowded = true
            if (crowded) break
            const u = rnd(q, 0x74)
            out.push({ ...base, role: Role.Boat, kind: boats % 2, x: wx, y: wy, yaw: Math.atan2(ny, nx) + (u - 0.5) * 2.2 + (u < 0.5 ? Math.PI : 0), sx: 1, sz: 1, sy: 1, jitter: u })
            boatAt.push(wx, wy)
            boats++
            break
          }
        }
      }
    }
    if (pieces === 0 && firstLodge) {
      // the terrace before the first lodge, toward the view: paving and a low parapet along its outer edge
      const { x, y, yaw, ez } = firstLodge
      const fx = Math.sin(yaw), fy = -Math.cos(yaw), ux = Math.cos(yaw), uy = Math.sin(yaw)
      const d = ez + 0.32
      let laid = 0
      for (let s = -2; s <= 2; s++) {
        const tx = x + fx * d + ux * s * 0.26, ty = y + fy * d + uy * s * 0.26
        if (!site.clear(tx, ty, 0.1) || onLot(tx, ty, 0.02)) continue
        out.push({ ...base, role: Role.Ground, kind: GroundKind.Plaza, x: tx, y: ty, sx: 0.4, sz: 0.4, jitter: rnd(s + 2, 0x75) })
        laid++
      }
      const px = x + fx * (d + 0.24), py = y + fy * (d + 0.24)
      if (laid >= 3 && site.clear(px, py, 0.1) && !onLot(px, py, 0.02)) out.push({ ...base, role: Role.WallSeg, x: px, y: py, yaw, sx: 1.2, sz: 0.55, sy: 0.5 })
      for (const sgn of [-1, 1]) {
        const tx = x + fx * d + ux * sgn * 0.8, ty = y + fy * d + uy * sgn * 0.8
        if (laid >= 3 && site.clear(tx, ty, 0.12) && !onLot(tx, ty, 0.04) && free(tx, ty, 0.1)) out.push({ ...base, role: Role.Grove, x: tx, y: ty, yaw: sgn, sx: 0.4, sz: 0.4, sy: 0.4, jitter: rnd(sgn + 3, 0x76) })
      }
    }
    // build order: the buildings first, as listed; boats come and go with the visitors (layer.ts)
    const n = out.length
    out.forEach((it, j) => (it.threshold = n > 1 ? j / (n - 1) : 0))
    let ax = 0, ay = 0
    for (let q = 0; q < anchors.length; q += 2) { ax += anchors[q]; ay += anchors[q + 1] }
    const na = Math.max(1, anchors.length / 2)
    diag.resort = [water ? 1 : 0, cand.length, n, +(ax / na).toFixed(2), +(ay / na).toFixed(2), trace.length / 4, pieces]
    return out
  }
  const resort = (pop: number, spec: ResortSpec, kinds: number, deadline: number) =>
    runJob(`t${Math.round(pop / 250)}:${spec.lodges}:${spec.villas}:${spec.boats}:${spec.bath ? 1 : 0}${spec.shore ? 1 : 0}:${kinds}`, () => resortJob(pop, spec, kinds), deadline)

  yield
  // (perf=1 diagnostics: window.__dioramaPlans[id])
  const slopes = order.map((i) => slope[i]).sort((a, b) => a - b)
  const diag = { peak, needHomes: Math.round(townHouseholds(peak)), seeds: nSeeds, patches: P, dryPatches: order.length, inner: innerSet.length, lots: lots.length, emptyLots: lots.filter((l) => l.empty).length, lotsUsed: 0, noFit: 0, notClear: 0, built: 0, homes: 0, exhausted: false, byWard: [] as number[], wardPatches: [] as number[], byKind: [] as number[], rings: ringK.map((k) => rawLoops(k).length), gates: gateVerts.size, slope50: slopes[slopes.length >> 1] ?? 0, slope90: slopes[Math.floor(slopes.length * 0.9)] ?? 0, noFitWard: [] as number[], noFitArea: 0, innerBuilt: 0, capRatio: 0, wallItems: [] as number[], bareGround: [] as number[], noBlock: [] as number[], camp: [] as number[], resort: [] as number[], palace: palacePatch >= 0 ? [+patches[palacePatch].cx.toFixed(2), +patches[palacePatch].cy.toFixed(2)] : [] }
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
    wallRing,
    ruinRing,
    palace,
    camp,
    works,
    resort,
    landmark,
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
