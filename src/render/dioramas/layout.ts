// Deterministic placement of every model: settlement plans (town.ts), their satellite
// villages and hamlets (census.ts: the countryside share of a settlement's people), the
// countryside (farmsteads, mills and groves), and the pieces at ports and dams. Each layout is a list
// of slots computed lazily, then cached, from (world.seed, settlement or cell, slot) and
// never from the current year: the year only decides which slots are filled. A slot
// carries its instance matrix (on the ground, upright along the local vertical), a matrix
// for its contact shadow, its colours, and the population (or land-use) threshold at
// which it shows.
//
// Settlement plans are expensive (hundreds of ground probes for a city), so they advance
// under a time budget: settlement() returns what is ready and says whether it is done.

import { Biome, CITY_POPULATION, EventType, RIVER_FLOW_THRESHOLD, StructureType, TOWN_POPULATION, type History, type World } from '../../contract.ts'
import { isWaterCell, lakeArray } from '../globe.ts'
import { riverHalfWidthNear } from '../rivers.ts'
import { cachedTerritories, CLUSTER_HOUSES, HOUSEHOLD, ruralHouses, ruralThreshold, territories, territorySteps, villageClusters, villageTarget, type Territories } from './census.ts'
import { floraModel, HOUSE_WIDTH, KK, Model, MODEL_SPECS, styleKindOf, styleModel, type ModelLibrary } from './models.ts'
import { Flora, hamletKind, houseFacade, isFarKind, isHouseKind, Kind, Style, type Style as StyleT } from './shapes.ts'
import { cellRandX, createSurface, fbm, hash4, rand4, type Probe } from './surface.ts'
import { floraOf, GROUND, GROUND_KINDS, kaykitFits, roofSnow, ROOFS, srgbToLinear, styleOfCell, WALL_STONE, WALLS, WHITEWASH, windmillsFit } from './styles.ts'
import { createTownPlan, GroundKind, Role, townExtent, townRadius, type GroundPiece, type PlanItem, type Site, type TownPlan } from './town.ts'
import { RELIEF_NEAR, terrainOf } from '../terrainHeight.ts'

export const NEVER = 1e9
/** Model id of the packed-earth ground decal under built-up patches (drawn by the ground batch). */
export const GROUND_MODEL = 255
const NO_INFO: readonly number[] = [0, 0, 0, 0]
/** Facade flags (SlotSet.info.w, integer part). */
export const FACADE_TIMBER = 1

/** A list of slots (struct of arrays), in fill order. */
export interface SlotSet {
  n: number
  /** Instance matrices (16 floats each, column-major). */
  mat: Float32Array
  /** Contact-shadow matrices (16 floats each). */
  blob: Float32Array
  model: Uint8Array
  /** Population (or land-use) threshold; negative: shows while the value is below -threshold. */
  threshold: Float32Array
  /** Model height (world units), for the shadow length. */
  height: Float32Array
  /** KayKit team palette index (0: own colours). */
  palette: Uint8Array
  /** Roof colour (linear rgb) and snow, per slot. */
  roof: Float32Array
  /** Wall colour (linear rgb), per slot. */
  wall: Float32Array
  /**
   * Facade of a generated building, per slot (material.ts): style + 1 (0: none), floor of
   * the lowest storey and eave height (model units), flags (1: timber framing) + a 0..1 seed.
   */
  info: Float32Array
  /** Radius of the whole cluster around its centre (world units). */
  radius: number
  /** Unit direction of the cluster centre. */
  cx: number
  cy: number
  cz: number
}

const EMPTY: SlotSet = {
  n: 0,
  mat: new Float32Array(0),
  blob: new Float32Array(0),
  model: new Uint8Array(0),
  threshold: new Float32Array(0),
  height: new Float32Array(0),
  palette: new Uint8Array(0),
  roof: new Float32Array(0),
  wall: new Float32Array(0),
  info: new Float32Array(0),
  radius: 0,
  cx: 0,
  cy: 1,
  cz: 0,
}

class SlotWriter {
  mat: number[] = []
  blob: number[] = []
  model: number[] = []
  threshold: number[] = []
  height: number[] = []
  palette: number[] = []
  roof: number[] = []
  wall: number[] = []
  info: number[] = []
  radius = 0
  cx = 0
  cy = 1
  cz = 0
  finish(): SlotSet {
    if (this.model.length === 0) return { ...EMPTY, radius: this.radius, cx: this.cx, cy: this.cy, cz: this.cz }
    return {
      n: this.model.length,
      mat: Float32Array.from(this.mat),
      blob: Float32Array.from(this.blob),
      model: Uint8Array.from(this.model),
      threshold: Float32Array.from(this.threshold),
      height: Float32Array.from(this.height),
      palette: Uint8Array.from(this.palette),
      roof: Float32Array.from(this.roof),
      wall: Float32Array.from(this.wall),
      info: Float32Array.from(this.info),
      radius: this.radius,
      cx: this.cx,
      cy: this.cy,
      cz: this.cz,
    }
  }
}

/**
 * The ground of a settlement (streets, squares, yards, gardens) as a triangle list on the
 * rendered surface, in fill order. Per vertex: object-space position (just above the
 * ground), ground normal, linear colour, pattern coordinates (KayKit units; gardens: along
 * and across their rows), ground kind (town.ts GroundKind) and the population threshold.
 */
export interface GroundSet {
  n: number
  pos: Float32Array
  nrm: Float32Array
  col: Float32Array
  uv: Float32Array
  kind: Float32Array
  threshold: Float32Array
}

const EMPTY_GROUND: GroundSet = { n: 0, pos: new Float32Array(0), nrm: new Float32Array(0), col: new Float32Array(0), uv: new Float32Array(0), kind: new Float32Array(0), threshold: new Float32Array(0) }

class GroundWriter {
  pos: number[] = []
  nrm: number[] = []
  col: number[] = []
  uv: number[] = []
  kind: number[] = []
  threshold: number[] = []
  finish(): GroundSet {
    const n = this.kind.length
    if (n === 0) return EMPTY_GROUND
    return { n, pos: Float32Array.from(this.pos), nrm: Float32Array.from(this.nrm), col: Float32Array.from(this.col), uv: Float32Array.from(this.uv), kind: Float32Array.from(this.kind), threshold: Float32Array.from(this.threshold) }
  }
}

export interface Layouts {
  /**
   * A longer run of the same world (same settlements first, more after): facts for the new
   * settlements come from it; those already known keep theirs, and every cached layout stays.
   */
  setHistory(h: History): void
  /**
   * Slots of settlement `id`, laid out at least as far as population `need` requires if
   * the time budget (performance.now() deadline) allows; `done` says whether it did.
   */
  settlement(id: number, need: number, deadline: number): { set: SlotSet; ground: GroundSet; done: boolean } | null
  /** Whether settlement `id` is laid out as far as `need` (no work). */
  settlementReady(id: number, need: number): boolean
  /**
   * The satellite villages of settlement `id` (census.ts), laid out as far as the time
   * budget allows (in founding order; `done` once all its peak needs are), or null if not
   * started and past the deadline.
   */
  villages(id: number, deadline: number): { set: VillageSet; done: boolean } | null
  /** Countryside slots of `cell` (cached; empty for water); null if not computed and past the deadline. */
  farm(cell: number, deadline: number): SlotSet | null
  /** Forest stands of `cell` (cached; groves with negative thresholds, cleared as the land is farmed); null if not computed and past the deadline. */
  forest(cell: number, deadline: number): SlotSet | null
  /** Pieces of port `structureId` built by settlement `owner`, at `pos` on the shore facing seaward `dir` (cached). */
  port(structureId: number, owner: number, pos: ArrayLike<number>, posOffset: number, dir: ArrayLike<number>, dirOffset: number): SlotSet
  /** Dam at `pos` across a river flowing along `dir` (cached by structure id). */
  dam(structureId: number, cell: number, pos: ArrayLike<number>, posOffset: number, dir: ArrayLike<number>, dirOffset: number): SlotSet
}

/**
 * The satellite villages and hamlets of a settlement: per village its centre (unit vector),
 * radius (world units), cell, and its slots in the near set (houses in clusters, landmarks,
 * yards) and the far set (low-detail clusters and landmarks), as [start, end) ranges.
 * Thresholds are the settlement's population (census.ts ruralThreshold).
 */
export interface VillageSet {
  n: number
  centre: Float32Array
  radius: Float32Array
  cell: Int32Array
  near: Int32Array
  far: Int32Array
  nearSet: SlotSet
  farSet: SlotSet
}

/** Where a settlement's port stands: shore position (object space) and seaward direction, or null. */
export type PortSite = (id: number) => readonly [number, number, number, number, number, number] | null

export function createLayouts(world: World, h: History, lib: ModelLibrary, reservoir: Float32Array | null = null, portSite: PortSite | null = null): Layouts {
  let settlements = h.settlements
  const { positions: GP, neighborOffsets: off, neighbors: nb, cellCount } = world.grid
  const seed = world.seed | 0
  const surface = createSurface(world, reservoir)
  const lake = lakeArray(world)
  const water = (i: number) => isWaterCell(world, lake, i)
  const isRiver = (i: number) => world.flow[i] >= RIVER_FLOW_THRESHOLD && world.riverTo[i] >= 0 && !water(i)
  // the river as rivers.ts draws it up close (bridges span it, houses stand on its banks)
  const riverHalfWidth = riverHalfWidthNear
  const spacing = Math.sqrt((4 * Math.PI) / cellCount)
  let N = settlements.length

  const footprint = (m: number) => lib.models[m]?.footprint ?? 0
  const heightOf = (m: number) => lib.models[m]?.height ?? 0
  const has = (m: number) => lib.models[m] != null

  // ---------- what the simulation says about each settlement ----------
  // Recomputed by setHistory for a longer run of the same world; settlements already known
  // keep their values (their plans are cached and must not change under the viewer).
  let peak = new Float32Array(0)
  let wealthRank = new Float32Array(0)
  let famine = new Uint8Array(0)
  let linkCells: number[][] = []
  let linkWeights: number[][] = []
  let routeCount = new Uint16Array(0)
  let portOf = new Int32Array(0)
  let styleCache = new Int8Array(0)
  let root = new Int32Array(0)
  let settlementCell = new Int32Array(cellCount).fill(-1)
  /** Settlements whose plan, villages or extent exist: their peak stays as it was. */
  let frozen = new Uint8Array(0)
  let hist = h

  /** Per-settlement facts from history `h`; ids below `keep` keep their current values (the peak only once laid out). */
  function computeFacts(h: History, keep: number) {
    const S = h.snapshotCount
    const old = { peak, wealthRank, famine, linkCells, linkWeights, routeCount, portOf, styleCache, root }
    const nPeak = new Float32Array(N)
    for (let s = 0; s < S; s++) for (let i = 0; i < N; i++) nPeak[i] = Math.max(nPeak[i], h.population[s * N + i])
    const peakWealth = new Float32Array(N)
    if (h.wealth) for (let s = 0; s < S; s++) for (let i = 0; i < N; i++) peakWealth[i] = Math.max(peakWealth[i], h.wealth[s * N + i])
    const nRank = new Float32Array(N)
    {
      const ids = Array.from({ length: N }, (_, i) => i).sort((a, b) => peakWealth[a] - peakWealth[b])
      ids.forEach((id, r) => (nRank[id] = N > 1 ? r / (N - 1) : 0.5))
    }
    const nFamine = new Uint8Array(N)
    for (const e of h.events) if (e.type === EventType.Famine && e.settlement >= 0 && e.settlement < N && nFamine[e.settlement] < 255) nFamine[e.settlement]++
    // directions out of each settlement: trade routes (weighted by their busiest year), founding and colonising journeys
    const nLinkCells: number[][] = Array.from({ length: N }, () => [])
    const nLinkWeights: number[][] = Array.from({ length: N }, () => [])
    const nRouteCount = new Uint16Array(N)
    const T = h.trade
    if (T && T.count > 0) {
      const peakVol = new Float32Array(T.count)
      const vol = h.tradeVolume
      if (vol) for (let s = 0; s < h.tradeSnapshotCount; s++) for (let r = 0; r < T.count; r++) peakVol[r] = Math.max(peakVol[r], vol[s * T.count + r])
      for (let r = 0; r < T.count; r++) {
        const o0 = T.pathOffsets[r], o1 = T.pathOffsets[r + 1]
        if (o1 - o0 < 2) continue
        const w = 1 + Math.sqrt(peakVol[r])
        const a = T.a[r], b = T.b[r]
        if (a >= 0 && a < N) { nLinkCells[a].push(T.path[Math.min(o1 - 1, o0 + 2)]); nLinkWeights[a].push(w); nRouteCount[a]++ }
        if (b >= 0 && b < N) { nLinkCells[b].push(T.path[Math.max(o0, o1 - 3)]); nLinkWeights[b].push(w); nRouteCount[b]++ }
      }
    }
    for (let i = 0; i < N; i++) {
      const p = settlements[i].parent
      if (p >= 0 && p < N) {
        nLinkCells[i].push(settlements[p].cell); nLinkWeights[i].push(0.8)
        nLinkCells[p].push(settlements[i].cell); nLinkWeights[p].push(0.5)
      }
    }
    const nPortOf = new Int32Array(N).fill(-1)
    for (const st of h.structures) if (st.type === StructureType.Port && st.settlement >= 0 && st.settlement < N && nPortOf[st.settlement] < 0) nPortOf[st.settlement] = st.cell
    const nStyle = new Int8Array(N).fill(-1)
    // lineage: the root ancestor picks the settlement's favourite roof (culture travels with settlers)
    const nRoot = new Int32Array(N)
    for (let i = 0; i < N; i++) {
      const p = settlements[i].parent
      nRoot[i] = p >= 0 && p < i ? nRoot[p] : i
    }
    const k = Math.min(keep, old.peak.length, N)
    // a longer run may raise a peak: settlements not laid out yet take the new one
    for (let i = 0; i < k; i++) if (frozen[i]) nPeak[i] = old.peak[i]
    const nFrozen = new Uint8Array(N)
    nFrozen.set(frozen.subarray(0, Math.min(frozen.length, N)))
    frozen = nFrozen
    nRank.set(old.wealthRank.subarray(0, k))
    nFamine.set(old.famine.subarray(0, k))
    nRouteCount.set(old.routeCount.subarray(0, k))
    nPortOf.set(old.portOf.subarray(0, k))
    nStyle.set(old.styleCache.subarray(0, k))
    nRoot.set(old.root.subarray(0, k))
    for (let i = 0; i < k; i++) {
      nLinkCells[i] = old.linkCells[i]
      nLinkWeights[i] = old.linkWeights[i]
    }
    peak = nPeak
    wealthRank = nRank
    famine = nFamine
    linkCells = nLinkCells
    linkWeights = nLinkWeights
    routeCount = nRouteCount
    portOf = nPortOf
    styleCache = nStyle
    root = nRoot
    settlementCell = new Int32Array(cellCount).fill(-1)
    for (const s of settlements) if (settlementCell[s.cell] < 0 || peak[s.id] > peak[settlementCell[s.cell]]) settlementCell[s.cell] = s.id
  }
  computeFacts(h, 0)

  const styleOf = (id: number): StyleT => {
    if (styleCache[id] < 0) styleCache[id] = styleOfCell(world, settlements[id].cell)
    return styleCache[id] as StyleT
  }

  // ---------- geometry helpers ----------
  const probe: Probe = { radius: 1, nx: 0, ny: 1, nz: 0, elev: 0, lake: 0, cell: 0 }
  /**
   * Whether a tree may stand at the point last probed (u: its 0..1 draw): none above the tree
   * line, 0.16 below the snow line, where the planet shader bares the rock (planetShaders.ts:
   * alpine = smoothstep(treeLine - 0.01, treeLine + 0.06, h)), thinning over the last stretch below it.
   */
  const snowLine = terrainOf(world).snowLine
  const treeFits = (u: number) => {
    const h = (probe.radius - 1) / RELIEF_NEAR
    const tl = snowLine[probe.cell] - 0.16
    const t = Math.min(1, Math.max(0, (h - (tl - 0.06)) / 0.09))
    return u >= t * t * (3 - 2 * t)
  }
  const fr = { ux: 0, uy: 0, uz: 0, ex: 0, ey: 0, ez: 0, nx: 0, ny: 0, nz: 0 }
  const frameAt = (x: number, y: number, z: number) => {
    const l = Math.hypot(x, y, z)
    fr.ux = x / l; fr.uy = y / l; fr.uz = z / l
    let ex = fr.uz, ey = 0, ez = -fr.ux
    let el = Math.hypot(ex, ey, ez)
    if (el < 1e-6) { ex = 1; ey = 0; ez = 0; el = 1 }
    fr.ex = ex / el; fr.ey = ey / el; fr.ez = ez / el
    fr.nx = fr.uy * fr.ez - fr.uz * fr.ey
    fr.ny = fr.uz * fr.ex - fr.ux * fr.ez
    fr.nz = fr.ux * fr.ey - fr.uy * fr.ex
  }

  /**
   * River segments near cell c in the tangent frame at (o, e, n), world units: x, y, x, y,
   * half width. They follow the ribbons as rivers.ts draws them: a quadratic Bezier per
   * river cell from the midpoint of its incoming segment, through the cell as control
   * point, to the midpoint of its outgoing one.
   */
  const riverSegs: number[] = []
  const collectRivers = (c: number, ox: number, oy: number, oz: number, ex: number, ey: number, ez: number, nx: number, ny: number, nz: number) => {
    riverSegs.length = 0
    const tx = (x: number, y: number, z: number) => (x - ox) * ex + (y - oy) * ey + (z - oz) * ez
    const ty = (x: number, y: number, z: number) => (x - ox) * nx + (y - oy) * ny + (z - oz) * nz
    const bez = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, hw: number) => {
      let px = ax, py = ay
      for (let k = 1; k <= 4; k++) {
        const t = k / 4, u = 1 - t
        const qx = u * u * ax + 2 * u * t * bx + t * t * cx, qy = u * u * ay + 2 * u * t * by + t * t * cy
        riverSegs.push(px, py, qx, qy, hw)
        px = qx
        py = qy
      }
    }
    const add = (q: number) => {
      if (!isRiver(q)) return
      const d = world.riverTo[q]
      const hw = riverHalfWidth(world.flow[q])
      const qx = tx(GP[q * 3], GP[q * 3 + 1], GP[q * 3 + 2]), qy = ty(GP[q * 3], GP[q * 3 + 1], GP[q * 3 + 2])
      const dx = tx(GP[d * 3], GP[d * 3 + 1], GP[d * 3 + 2]), dy = ty(GP[d * 3], GP[d * 3 + 1], GP[d * 3 + 2])
      // into the sea or a lake: straight on to the shore
      const ex1 = water(d) ? dx : (qx + dx) / 2, ey1 = water(d) ? dy : (qy + dy) / 2
      let ups = 0
      for (let k = off[q]; k < off[q + 1]; k++) {
        const u = nb[k]
        if (world.riverTo[u] !== q || !isRiver(u)) continue
        ups++
        const ux = (tx(GP[u * 3], GP[u * 3 + 1], GP[u * 3 + 2]) + qx) / 2, uy = (ty(GP[u * 3], GP[u * 3 + 1], GP[u * 3 + 2]) + qy) / 2
        bez(ux, uy, qx, qy, ex1, ey1, hw)
      }
      if (ups === 0) riverSegs.push(qx, qy, ex1, ey1, hw)
    }
    add(c)
    for (let k = off[c]; k < off[c + 1]; k++) add(nb[k])
  }
  const riverClear = (segs: ArrayLike<number>, x: number, y: number, r: number) => {
    for (let i = 0; i < segs.length; i += 5) {
      const ax = segs[i], ay = segs[i + 1], bx = segs[i + 2], by = segs[i + 3]
      const dx = bx - ax, dy = by - ay
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
      if (Math.hypot(x - ax - dx * t, y - ay - dy * t) < r * 0.85 + segs[i + 4] + 0.0002) return false
    }
    return true
  }

  /** Probe the ground at tangent offset (x, y) from unit vector o (frame e, n); moves the frame there. */
  const probeAt = (ox: number, oy: number, oz: number, ex: number, ey: number, ez: number, nx: number, ny: number, nz: number, x: number, y: number, start: number) => {
    const px = ox + ex * x + nx * y, py = oy + ey * x + ny * y, pz = oz + ez * x + nz * y
    const l = Math.hypot(px, py, pz)
    surface.probe(px / l, py / l, pz / l, start, probe)
    frameAt(px, py, pz)
  }

  /** Footprint of radius r at tangent offset (x, y) is dry land as the planet shader draws it. Leaves the probe at the centre. */
  const dryFootprint = (ox: number, oy: number, oz: number, ex: number, ey: number, ez: number, nx: number, ny: number, nz: number, x: number, y: number, r: number, start: number) => {
    const k = r * 0.8
    for (let i = 0; i < 4; i++) {
      const dx = i === 0 ? k : i === 1 ? -k : 0, dy = i === 2 ? k : i === 3 ? -k : 0
      probeAt(ox, oy, oz, ex, ey, ez, nx, ny, nz, x + dx, y + dy, start)
      if (surface.wet(probe, 0.05)) return false
    }
    probeAt(ox, oy, oz, ex, ey, ez, nx, ny, nz, x, y, start)
    // (the corners already keep off the water: a wide margin here would empty whole flat lowlands)
    return !surface.wet(probe, 0.06)
  }

  /** Sink a model on a slope so no corner floats: footprint times the ground's tilt. */
  const sinkFor = (r: number) => {
    const cosT = Math.max(0.2, probe.nx * fr.ux + probe.ny * fr.uy + probe.nz * fr.uz)
    const tanT = Math.sqrt(Math.max(0, 1 - cosT * cosT)) / cosT
    return r * Math.min(tanT, 0.6) * 0.95 + 0.00001
  }

  const lin = (c: readonly [number, number, number], k = 1): [number, number, number] => [srgbToLinear(c[0]) * k, srgbToLinear(c[1]) * k, srgbToLinear(c[2]) * k]

  /**
   * Writes a slot at the point last probed (probe and frame filled by probeAt), x axis at
   * yaw (radians from east toward north), sunk by `sink`, scaled (sx, sy, sz) on the
   * model's base scale.
   */
  const writeSlot = (w: SlotWriter, model: number, threshold: number, yaw: number, sink: number, sx: number, sy: number, sz: number, roof: readonly number[], wall: readonly number[], palette = 0, blobScale = 1.2, info: readonly number[] = NO_INFO) => {
    const s = model === GROUND_MODEL ? KK : MODEL_SPECS[model].scale
    const cx = Math.cos(yaw), cy = Math.sin(yaw)
    const Xx = fr.ex * cx + fr.nx * cy, Xy = fr.ey * cx + fr.ny * cy, Xz = fr.ez * cx + fr.nz * cy
    const Yx = fr.ux, Yy = fr.uy, Yz = fr.uz
    const Zx = Xy * Yz - Xz * Yy, Zy = Xz * Yx - Xx * Yz, Zz = Xx * Yy - Xy * Yx
    const r = probe.radius - sink
    if (model === GROUND_MODEL) {
      // a flat disc on the ground triangle (the blob mesh), radius sx model units
      const gx = probe.nx, gy = probe.ny, gz = probe.nz
      const f = s * sx
      w.mat.push(Xx * f, Xy * f, Xz * f, 0, gx * f, gy * f, gz * f, 0, Zx * f, Zy * f, Zz * f, 0, Yx * (probe.radius + 1e-5), Yy * (probe.radius + 1e-5), Yz * (probe.radius + 1e-5), 1)
      for (let k = 0; k < 16; k++) w.blob.push(0)
      w.height.push(0)
    } else {
      w.mat.push(Xx * s * sx, Xy * s * sx, Xz * s * sx, 0, Yx * s * sy, Yy * s * sy, Yz * s * sy, 0, Zx * s * sz, Zy * s * sz, Zz * s * sz, 0, Yx * r, Yy * r, Yz * r, 1)
      // shadow: a disk on the ground triangle, slightly larger than the footprint
      const f = footprint(model) * Math.max(sx, sz) * blobScale
      const gx = probe.nx, gy = probe.ny, gz = probe.nz
      let bx = Xx - gx * (Xx * gx + Xy * gy + Xz * gz), by = Xy - gy * (Xx * gx + Xy * gy + Xz * gz), bz = Xz - gz * (Xx * gx + Xy * gy + Xz * gz)
      const bl = Math.hypot(bx, by, bz) || 1
      bx /= bl; by /= bl; bz /= bl
      const cxz = by * gz - bz * gy, cyz = bz * gx - bx * gz, czz = bx * gy - by * gx
      const gr = probe.radius + 2e-5
      w.blob.push(bx * f, by * f, bz * f, 0, gx * f, gy * f, gz * f, 0, cxz * f, cyz * f, czz * f, 0, Yx * gr, Yy * gr, Yz * gr, 1)
      w.height.push(heightOf(model) * sy - sink)
    }
    w.model.push(model)
    w.threshold.push(threshold)
    w.palette.push(palette)
    w.roof.push(roof[0], roof[1], roof[2], roof[3])
    w.wall.push(wall[0], wall[1], wall[2])
    w.info.push(info[0], info[1], info[2], info[3])
  }

  /** Facade info (SlotSet.info) of a model: generated buildings get their style's wall textures, houses windows by storey. */
  const infoTmp = [0, 0, 0, 0]
  const infoFor = (model: number, seed01: number, timber: boolean, style: StyleT = Style.Temperate): readonly number[] => {
    const sk = styleKindOf(model)
    const sd = Math.min(0.999, Math.max(0, seed01))
    if (sk && isFarKind(sk[1])) return NO_INFO
    if (sk) {
      const [st, kind] = sk
      const f = isHouseKind(kind) ? houseFacade(st, kind) : [0, 0]
      infoTmp[0] = st + 1; infoTmp[1] = f[0]; infoTmp[2] = f[1]; infoTmp[3] = (timber && isHouseKind(kind) ? FACADE_TIMBER : 0) + sd
      return infoTmp
    }
    if (model === Model.WallSeg || model === Model.WallTower) {
      infoTmp[0] = style + 1; infoTmp[1] = 0; infoTmp[2] = 0; infoTmp[3] = sd
      return infoTmp
    }
    return NO_INFO
  }

  // ---------- settlements ----------
  interface SettlementState {
    plan: TownPlan
    ox: number; oy: number; oz: number
    ex: number; ey: number; ez: number
    nx: number; ny: number; nz: number
    segs: Float64Array
    written: number
    writer: SlotWriter
    set: SlotSet | null
    snow: number
    favRoof: number
    whitewash: number
    gw: GroundWriter
    groundWritten: number
    gset: GroundSet | null
  }
  const states = new Map<number, SettlementState>()
  const COAST_SHIFT = 0.12

  const origins = new Map<number, Float64Array>()
  /** Centre of settlement id's plan (unit vector) and whether its cell is coastal. */
  const originOf = (id: number): Float64Array => {
    let o = origins.get(id)
    if (o) return o
    const c = settlements[id].cell
    // a coastal settlement's centre moves a little inland (its cell centre is often right
    // on the shore), toward the higher of its dry neighbours
    let ox = GP[c * 3], oy = GP[c * 3 + 1], oz = GP[c * 3 + 2]
    let coastal = false
    let vx = 0, vy = 0, vz = 0
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (water(j)) { coastal = true; continue }
      const wgt = Math.max(world.elevation[j], 0.002)
      vx += (GP[j * 3] - ox) * wgt
      vy += (GP[j * 3 + 1] - oy) * wgt
      vz += (GP[j * 3 + 2] - oz) * wgt
    }
    // the centre is the point nearest the cell centre (leaning toward the higher dry
    // neighbours) whose surroundings are mostly dry land as drawn: on the coast the town
    // hugs the shore, but stands on land
    const vl = Math.hypot(vx, vy, vz)
    surface.probe(ox, oy, oz, c, probe)
    if (coastal || surface.wet(probe, 0.25)) {
      frameAt(ox, oy, oz)
      const ex = fr.ex, ey = fr.ey, ez = fr.ez, nx = fr.nx, ny = fr.ny, nz = fr.nz
      const lx = vl > 0 ? (vx * ex + vy * ey + vz * ez) / vl : 0, ly = vl > 0 ? (vx * nx + vy * ny + vz * nz) / vl : 0
      const c0x = ox, c0y = oy, c0z = oz
      const ring = HOUSE_WIDTH * 2.2
      let need = 4
      const dryAround = (x: number, y: number) => {
        probeAt(c0x, c0y, c0z, ex, ey, ez, nx, ny, nz, x, y, c)
        if (surface.wet(probe, need >= 4 ? 0.12 : 0)) return false
        let dry = 0
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2
          probeAt(c0x, c0y, c0z, ex, ey, ez, nx, ny, nz, x + Math.cos(a) * ring, y + Math.sin(a) * ring, c)
          if (!surface.wet(probe, 0.1)) dry++
        }
        return dry >= need
      }
      let bx = lx * COAST_SHIFT * spacing * 0.4, by = ly * COAST_SHIFT * spacing * 0.4
      // (a settlement whose cell is drawn as sea moves to the nearest land, up to ~3/4 of a cell)
      // a second pass settles for any spit of land (a small island)
      search: for (let pass = 0, i = 0; pass < 2; i++) {
        if (i > 25) { pass++; i = 0; need = 1; if (pass >= 2) break }
        const r = i * spacing * 0.03
        const n = i === 0 ? 1 : 16
        // directions ordered by how well they lean inland
        for (let q = 0; q < n; q++) {
          const a = Math.atan2(ly, lx) + (q % 2 ? 1 : -1) * Math.ceil(q / 2) * ((Math.PI * 2) / 16)
          const x = lx * COAST_SHIFT * spacing * 0.4 + Math.cos(a) * r, y = ly * COAST_SHIFT * spacing * 0.4 + Math.sin(a) * r
          if (dryAround(x, y)) { bx = x; by = y; break search }
        }
      }
      const px = c0x + ex * bx + nx * by, py = c0y + ey * bx + ny * by, pz = c0z + ez * bx + nz * by
      const l = Math.hypot(px, py, pz)
      ox = px / l; oy = py / l; oz = pz / l
    }
    // a port town comes down to its harbour: its centre sits inland of the port by about
    // half the town's radius, so the waterfront wards (and the quay) meet the water
    const ps = portOf[id] >= 0 && portSite ? portSite(id) : null
    if (ps) {
      const pl = Math.hypot(ps[0], ps[1], ps[2])
      const px0 = ps[0] / pl, py0 = ps[1] / pl, pz0 = ps[2] / pl
      frameAt(px0, py0, pz0)
      const ex = fr.ex, ey = fr.ey, ez = fr.ez, nx = fr.nx, ny = fr.ny, nz = fr.nz
      let dx = ps[3] * ex + ps[4] * ey + ps[5] * ez, dy = ps[3] * nx + ps[4] * ny + ps[5] * nz
      const dl = Math.hypot(dx, dy) || 1
      dx /= dl; dy /= dl
      const R = Math.min(spacing * 0.5, Math.max(HOUSE_WIDTH * 2.5, townRadius(peak[id]) * KK * 0.5))
      const ring = HOUSE_WIDTH * 2
      for (let i = 0; i < 8; i++) {
        const t = R + i * HOUSE_WIDTH
        const x = -dx * t, y = -dy * t
        probeAt(px0, py0, pz0, ex, ey, ez, nx, ny, nz, x, y, c)
        if (surface.wet(probe, 0.12)) continue
        let dry = 0
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2
          probeAt(px0, py0, pz0, ex, ey, ez, nx, ny, nz, x + Math.cos(a) * ring, y + Math.sin(a) * ring, c)
          if (!surface.wet(probe, 0.1)) dry++
        }
        if (dry < 4) continue
        const qx = px0 + ex * x + nx * y, qy = py0 + ey * x + ny * y, qz = pz0 + ez * x + nz * y
        const ql = Math.hypot(qx, qy, qz)
        // (still the settlement's own place: within a cell of its centre)
        if (Math.hypot(qx / ql - GP[c * 3], qy / ql - GP[c * 3 + 1], qz / ql - GP[c * 3 + 2]) > spacing * 0.9) break
        ox = qx / ql; oy = qy / ql; oz = qz / ql
        coastal = true
        break
      }
    }
    o = Float64Array.of(ox, oy, oz, coastal ? 1 : 0)
    origins.set(id, o)
    return o
  }

  /** A settlement's site as the town generator sees it, with its frame (cached; the peak freezes with it). */
  interface SiteFrame {
    site: Site
    ox: number; oy: number; oz: number
    ex: number; ey: number; ez: number
    nx: number; ny: number; nz: number
    segs: Float64Array
    style: StyleT
    coastal: boolean
  }
  const sites = new Map<number, SiteFrame>()
  const siteFor = (id: number): SiteFrame => {
    let sf = sites.get(id)
    if (sf) return sf
    frozen[id] = 1
    const c = settlements[id].cell
    const org = originOf(id)
    const ox = org[0], oy = org[1], oz = org[2]
    const coastal = org[3] > 0
    frameAt(ox, oy, oz)
    const ex = fr.ex, ey = fr.ey, ez = fr.ez, nx = fr.nx, ny = fr.ny, nz = fr.nz
    collectRivers(c, ox, oy, oz, ex, ey, ez, nx, ny, nz)
    const segs = Float64Array.from(riverSegs)
    const segsKK = Array.from(segs, (v) => v / KK)
    const style = styleOf(id)
    // route directions in this frame, merged within ~30 degrees, busiest first
    const dirs: { a: number; w: number }[] = []
    for (let k = 0; k < linkCells[id].length; k++) {
      const j = linkCells[id][k]
      if (j === c) continue
      const tx = (GP[j * 3] - ox) * ex + (GP[j * 3 + 1] - oy) * ey + (GP[j * 3 + 2] - oz) * ez
      const ty = (GP[j * 3] - ox) * nx + (GP[j * 3 + 1] - oy) * ny + (GP[j * 3 + 2] - oz) * nz
      const a = Math.atan2(ty, tx)
      const m = dirs.find((d) => Math.abs(Math.atan2(Math.sin(d.a - a), Math.cos(d.a - a))) < 0.5)
      if (m) m.w += linkWeights[id][k]
      else dirs.push({ a, w: linkWeights[id][k] })
    }
    dirs.sort((p, q) => q.w - p.w)
    const routes = dirs.map((d) => d.a)
    // at least two streets: add some away from the existing ones
    for (let k = 0; routes.length < 2 && k < 4; k++) {
      const a = (routes.length ? routes[0] + Math.PI * (0.7 + 0.6 * rand4(seed, id, 0x90, k)) : rand4(seed, id, 0x91, k) * Math.PI * 2)
      routes.push(a)
    }
    // houses blend in the styles of neighbouring land cells and of the parent settlement
    const mix: { s: StyleT; w: number }[] = [{ s: style, w: 1 }]
    const addMix = (s: StyleT, w: number) => {
      const m = mix.find((q) => q.s === s)
      if (m) m.w += w
      else mix.push({ s, w })
    }
    for (let k = off[c]; k < off[c + 1]; k++) if (!water(nb[k])) addMix(styleOfCell(world, nb[k]), 0.09)
    const par = settlements[id].parent
    if (par >= 0 && par < N) addMix(styleOf(par), 0.12)
    const mixTotal = mix.reduce((a, q) => a + q.w, 0)
    const b = world.biome[c]
    const site: Site = {
      seed,
      id,
      peak: peak[id],
      style,
      houseStyle(u) {
        let acc = 0
        for (const q of mix) {
          acc += q.w / mixTotal
          if (u < acc) return q.s
        }
        return style
      },
      routes,
      port: portOf[id] >= 0,
      portAngle: 0,
      river: segs.length > 0,
      wealth: wealthRank[id],
      trade: Math.min(1, routeCount[id] / 12),
      hardship: Math.min(1, famine[id] / 3),
      forest: b === 5 || b === 4 || b === 9,
      windmills: windmillsFit(style),
      wet(x, y, margin) {
        probeAt(ox, oy, oz, ex, ey, ez, nx, ny, nz, x * KK, y * KK, c)
        return surface.wet(probe, margin)
      },
      height(x, y) {
        probeAt(ox, oy, oz, ex, ey, ez, nx, ny, nz, x * KK, y * KK, c)
        return probe.radius
      },
      unit: KK,
      clear(x, y, r) {
        if (!riverClear(segs, x * KK, y * KK, r * KK)) return false
        return dryFootprint(ox, oy, oz, ex, ey, ez, nx, ny, nz, x * KK, y * KK, r * KK, c)
      },
      riverSegs: segsKK,
      // the town stays within about a cell of its centre
      maxRadius: (spacing * 1.2) / KK,
    }
    sf = { site, ox, oy, oz, ex, ey, ez, nx, ny, nz, segs, style, coastal }
    sites.set(id, sf)
    return sf
  }
  /** How far settlement id's town reaches at its peak (world units; cached). */
  const extents = new Map<number, number>()
  const extentOf = (id: number): number => {
    let e = extents.get(id)
    if (e === undefined) {
      e = townExtent(siteFor(id).site) * KK
      extents.set(id, e)
    }
    return e
  }

  // (perf=1: the centre of a settlement's plan, for aiming test shots)
  if (typeof location !== 'undefined' && /[?&]perf=1/.test(location.search)) (globalThis as unknown as { __dioramaOrigin: (id: number) => number[] }).__dioramaOrigin = (id) => [...Array.from(originOf(id)), extentOf(id), states.get(id)?.writer.radius ?? 0]

  const stateOf = (id: number): SettlementState => {
    let st = states.get(id)
    if (st) return st
    const c = settlements[id].cell
    const sf = siteFor(id)
    const { site, ox, oy, oz, ex, ey, ez, nx, ny, nz, segs, style, coastal } = sf
    const w = new SlotWriter()
    w.cx = ox; w.cy = oy; w.cz = oz
    const T0 = world.temperature[c]
    let coastalWarm = 0
    if (coastal && T0 > 0.55 && (style === Style.Temperate || style === Style.Desert)) coastalWarm = 0.7
    st = {
      plan: createTownPlan(site),
      ox, oy, oz, ex, ey, ez, nx, ny, nz,
      segs,
      written: 0,
      writer: w,
      set: null,
      snow: roofSnow(world, c),
      favRoof: hash4(seed, root[id], 0x51, 0) % 5,
      whitewash: coastalWarm,
      gw: new GroundWriter(),
      groundWritten: 0,
      gset: null,
    }
    states.set(id, st)
    return st
  }

  const roofTmp = [0, 0, 0, 0]
  const wallTmp = [0, 0, 0]
  const setColours = (st: SettlementState, id: number, it: PlanItem, k: number) => {
    const s = it.style
    // most roofs in the settlement's favourite colour, a few others; slight jitter
    const ri = rand4(seed, id, k, 0x71) < 0.6 ? st.favRoof : it.roof
    const jr = 0.9 + 0.2 * it.jitter
    const r = lin(ROOFS[s][ri % ROOFS[s].length], jr)
    roofTmp[0] = r[0]; roofTmp[1] = r[1]; roofTmp[2] = r[2]; roofTmp[3] = st.snow
    let wc = WALLS[s][it.wall % WALLS[s].length]
    if (it.ward === 10 /* harbour */) wc = WALLS[s][3]
    if (st.whitewash > 0 && rand4(seed, id, k, 0x72) < st.whitewash) wc = WHITEWASH
    const jw = 0.93 + 0.14 * rand4(seed, id, k, 0x73)
    const wl = lin(wc, jw)
    wallTmp[0] = wl[0]; wallTmp[1] = wl[1]; wallTmp[2] = wl[2]
  }

  /** The model standing for a plan item, by role and style (KayKit landmarks only where they fit). */
  const modelFor = (it: PlanItem): number => {
    const s = it.style
    const kk = kaykitFits(s)
    switch (it.role) {
      case Role.House: return styleModel(s, it.kind as Kind)
      case Role.Church: return kk && has(Model.Church) ? Model.Church : styleModel(s, Kind.Hall)
      case Role.Hall: return kk && has(Model.Tavern) ? Model.Tavern : styleModel(s, Kind.Hall)
      case Role.Market: return kk && has(Model.Market) ? Model.Market : Model.Stalls
      case Role.Well: return kk && has(Model.Well) ? Model.Well : Model.SmallWell
      case Role.Tavern: return kk && has(Model.Tavern) ? Model.Tavern : styleModel(s, Kind.Long)
      case Role.Blacksmith: return kk && has(Model.Blacksmith) ? Model.Blacksmith : styleModel(s, Kind.Long)
      case Role.Castle: return kk && has(Model.Castle) ? Model.Castle : styleModel(s, Kind.Fort)
      case Role.Tower: return kk && has(Model.Tower) ? Model.Tower : styleModel(s, Kind.Tower)
      case Role.Barracks: return kk && has(Model.Barracks) ? Model.Barracks : styleModel(s, Kind.Long)
      case Role.WallSeg: return Model.WallSeg
      case Role.WallTower: return Model.WallTower
      case Role.Windmill: return has(Model.Windmill) ? Model.Windmill : -1
      case Role.Watermill: return (kk || s === Style.Cold) && has(Model.Watermill) ? Model.Watermill : styleModel(s, Kind.Small)
      case Role.Lumbermill: return (kk || s === Style.Cold) && has(Model.Lumbermill) ? Model.Lumbermill : styleModel(s, Kind.Long)
      case Role.Bridge: return Model.TownBridge
      case Role.Ground: return GROUND_MODEL
      case Role.Grove: {
        // a garden tree of the climate
        const f = s === Style.Desert ? Flora.Palm : s === Style.Rainforest ? Flora.Jungle : s === Style.Savanna ? Flora.Acacia : s === Style.Cold || s === Style.Mountain ? Flora.Conifer : Flora.Broadleaf
        return has(floraModel(f)) ? floraModel(f) : -1
      }
      default: return -1
    }
  }

  function writeItems(id: number, st: SettlementState) {
    const items = st.plan.items
    const w = st.writer
    const c = settlements[id].cell
    const { ox, oy, oz, ex, ey, ez, nx, ny, nz } = st
    for (; st.written < items.length; st.written++) {
      const it = items[st.written]
      const model = modelFor(it)
      if (model < 0) continue
      probeAt(ox, oy, oz, ex, ey, ez, nx, ny, nz, it.x * KK, it.y * KK, c)
      if (it.role === Role.Grove && !treeFits(it.jitter)) continue
      const style = it.style
      if (model === GROUND_MODEL) {
        const g = lin(GROUND[style])
        roofTmp[0] = roofTmp[1] = roofTmp[2] = 0; roofTmp[3] = 0
        writeSlot(w, model, it.threshold, 0, 0, it.sx, 1, it.sx, roofTmp, g)
        continue
      }
      setColours(st, id, it, st.written)
      if (it.role === Role.WallSeg || it.role === Role.WallTower) {
        const g = lin(WALL_STONE[style], 0.94 + 0.12 * it.jitter)
        wallTmp[0] = g[0]; wallTmp[1] = g[1]; wallTmp[2] = g[2]
      }
      let sx = it.sx, sz = it.sz, sy = it.sy
      if (it.role === Role.Barracks && model !== Model.Barracks) { sx *= 1.3; sz *= 1.3; sy *= 1.2 }
      const r = footprint(model) * Math.max(sx, sz)
      // half-timbering on many temperate houses (more in the old core than out of town)
      const timber = style === Style.Temperate && rand4(seed, id, st.written, 0x74) < (it.ward === 12 || it.ward === 13 || it.ward === 14 ? 0.3 : 0.6)
      const info = infoFor(model, it.jitter, timber, style)
      // the plan's yaw is the model's x axis; KayKit models face +z: put their long side along the street too
      writeSlot(w, model, it.threshold, it.yaw, it.role === Role.Bridge ? 0 : sinkFor(r), sx, sy, sz, roofTmp, wallTmp, 0, it.role === Role.WallSeg ? 0.6 : 1.2, info)
      w.radius = Math.max(w.radius, Math.hypot(it.x, it.y) * KK + footprint(model) * Math.max(sx, sz))
    }
  }

  // ---------- the town's ground: streets, squares, yards and gardens ----------
  const GROUND_LIFT = 0.000025
  const gx: number[] = [], gy: number[] = [], gz: number[] = [], gnx: number[] = [], gny: number[] = [], gnz: number[] = []
  const gColTmp = [0, 0, 0]
  /** Linear colour of a ground kind in a style (with a per-piece shade jitter). */
  const groundColour = (kind: number, style: StyleT, jit: number) => {
    const c = GROUND_KINDS[kind]?.[style] ?? GROUND[style]
    const k = 0.92 + 0.16 * jit
    gColTmp[0] = srgbToLinear(c[0]) * k; gColTmp[1] = srgbToLinear(c[1]) * k; gColTmp[2] = srgbToLinear(c[2]) * k
    return gColTmp
  }
  /** One plan-space point onto the ground: fills gx.. at index i. */
  const groundPoint = (st: SettlementState, c: number, x: number, y: number, i: number) => {
    const { ox, oy, oz, ex, ey, ez, nx, ny, nz } = st
    const px = ox + ex * x * KK + nx * y * KK, py = oy + ey * x * KK + ny * y * KK, pz = oz + ez * x * KK + nz * y * KK
    const l = Math.hypot(px, py, pz)
    surface.probe(px / l, py / l, pz / l, c, probe)
    const r = probe.radius + GROUND_LIFT
    gx[i] = (px / l) * r; gy[i] = (py / l) * r; gz[i] = (pz / l) * r
    gnx[i] = probe.nx; gny[i] = probe.ny; gnz[i] = probe.nz
  }
  /** Tessellates a convex plan polygon onto the ground (fans from its centre, subdivided), dropping bits over the sea or lakes. */
  function writePiece(st: SettlementState, c: number, piece: GroundPiece, style: StyleT, jit: number) {
    const p = piece.poly
    const n = p.length / 2
    if (n < 3) return
    let cx = 0, cy = 0
    for (let i = 0; i < n; i++) { cx += p[i * 2]; cy += p[i * 2 + 1] }
    cx /= n; cy /= n
    const gw = st.gw
    const col = groundColour(piece.kind, style, jit)
    const cr = col[0], cg = col[1], cb = col[2]
    const garden = piece.kind === GroundKind.Garden
    const { ox, oy, oz, ex, ey, ez, nx, ny, nz } = st
    const push = (i: number, x: number, y: number) => {
      gw.pos.push(gx[i], gy[i], gz[i])
      gw.nrm.push(gnx[i], gny[i], gnz[i])
      gw.col.push(cr, cg, cb)
      if (garden) gw.uv.push(x * piece.ux + y * piece.uy, -x * piece.uy + y * piece.ux)
      else gw.uv.push(x, y)
      gw.kind.push(piece.kind)
      gw.threshold.push(piece.threshold)
    }
    const qx: number[] = [], qy: number[] = []
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const ax = p[i * 2] - cx, ay = p[i * 2 + 1] - cy, bx = p[j * 2] - cx, by = p[j * 2 + 1] - cy
      const L = Math.max(Math.hypot(ax, ay), Math.hypot(bx, by), Math.hypot(bx - ax, by - ay))
      if (L < 1e-4) continue
      const k = Math.min(5, Math.max(1, Math.ceil(L / 0.55)))
      // grid points c + a/k (A - c) + b/k (B - c), a + b <= k
      const idx = (a: number, b: number) => (a * (2 * k + 3 - a)) / 2 + b
      qx.length = 0; qy.length = 0
      for (let a = 0; a <= k; a++) for (let b = 0; a + b <= k; b++) {
        const x = cx + (ax * a + bx * b) / k, y = cy + (ay * a + by * b) / k
        const q = idx(a, b)
        qx[q] = x; qy[q] = y
        groundPoint(st, c, x, y, q)
      }
      const tri = (i0: number, i1: number, i2: number) => {
        // over the sea or a lake as drawn: leave it out
        const mx = (qx[i0] + qx[i1] + qx[i2]) / 3, my = (qy[i0] + qy[i1] + qy[i2]) / 3
        probeAt(ox, oy, oz, ex, ey, ez, nx, ny, nz, mx * KK, my * KK, c)
        if (surface.wet(probe, 0.04)) return
        push(i0, qx[i0], qy[i0]); push(i1, qx[i1], qy[i1]); push(i2, qx[i2], qy[i2])
      }
      for (let a = 0; a < k; a++) for (let b = 0; a + b < k; b++) {
        tri(idx(a, b), idx(a + 1, b), idx(a, b + 1))
        if (a + b + 1 < k) tri(idx(a + 1, b), idx(a + 1, b + 1), idx(a, b + 1))
      }
    }
  }
  /** Lays the plan's new ground pieces until the deadline; whether all are laid. */
  function writeGround(id: number, st: SettlementState, deadline: number): boolean {
    const pieces = st.plan.ground
    if (st.groundWritten >= pieces.length) return true
    const c = settlements[id].cell
    for (; st.groundWritten < pieces.length; st.groundWritten++) {
      if (performance.now() > deadline) break
      const pc = pieces[st.groundWritten]
      writePiece(st, c, pc, styleOf(id), rand4(seed, id, st.groundWritten, 0x75))
    }
    st.gset = null
    return st.groundWritten >= pieces.length
  }

  function getSettlement(id: number, need: number, deadline: number): { set: SlotSet; ground: GroundSet; done: boolean } | null {
    // a new plan is the costly part: none past the deadline
    if (!states.has(id) && performance.now() > deadline) return null
    const st = stateOf(id)
    let done = st.plan.advance(need, deadline)
    if (st.written < st.plan.items.length) {
      writeItems(id, st)
      st.set = null
    }
    if (!writeGround(id, st, deadline)) done = false
    if (!st.set) st.set = st.writer.finish()
    if (!st.gset) st.gset = st.gw.finish()
    return { set: st.set, ground: st.gset, done }
  }

  // ---------- satellite villages and hamlets (census.ts) ----------
  // The countryside share of a settlement's people lives in villages over its territory:
  // sites chosen one after another, each the best of a dozen candidates on dry land in the
  // territory by its distance from the town and the villages before it (so they spread
  // over the land) and the land (early-cultivated fields, a river near); then each village's
  // clusters of houses on a spiral round its centre, stretched along a lane, with a well,
  // a church and a market as it grows. Everything is in the settlement's tangent frame and
  // its thresholds are the settlement's population.
  let ownerCell: Int32Array | null = null
  let territoryGen: Generator<void, Territories, void> | null = null
  /** The territories (census.ts), computed in steps until the deadline; null while not done. */
  const territoriesReady = (deadline: number): Territories | null => {
    const t = cachedTerritories(hist)
    if (t) return t
    territoryGen ??= territorySteps(world, hist)
    while (performance.now() <= deadline) {
      const r = territoryGen.next()
      if (r.done) {
        territoryGen = null
        return r.value
      }
    }
    return null
  }
  /** The settlement whose territory holds land cell c, or -1 (territories ready). */
  const ownerOf = (c: number): number => {
    if (!ownerCell) {
      ownerCell = new Int32Array(cellCount).fill(-1)
      const T = territories(world, hist)
      for (let id = 0; id < T.cells.length; id++) for (const q of T.cells[id]) if (ownerCell[q] < 0) ownerCell[q] = id
    }
    return ownerCell[c]
  }
  interface VillageState {
    gen: Generator<void, void, void>
    sitesDone: boolean
    done: boolean
    /** Village sites: settlement-frame x, y (world units), radius, unit-vector centre, cell. */
    vx: number[]; vy: number[]; vr: number[]
    ux: number[]; uy: number[]; uz: number[]
    vcell: number[]
    near: SlotWriter
    far: SlotWriter
    nearR: number[]
    farR: number[]
    placed: number
    set: VillageSet | null
  }
  const villageStates = new Map<number, VillageState>()
  const villageStateOf = (id: number): VillageState => {
    let vs = villageStates.get(id)
    if (vs) return vs
    frozen[id] = 1
    vs = { gen: null as unknown as Generator<void, void, void>, sitesDone: false, done: false, vx: [], vy: [], vr: [], ux: [], uy: [], uz: [], vcell: [], near: new SlotWriter(), far: new SlotWriter(), nearR: [], farR: [], placed: 0, set: null }
    vs.gen = villageStages(id, vs)
    villageStates.set(id, vs)
    return vs
  }
  /** Runs settlement id's village layout until `stop` holds or the deadline passes; whether it holds. */
  const perfMs = globalThis as { __dioramaVillageMs?: number[] }
  const driveVillages = (vs: VillageState, deadline: number, stop: (vs: VillageState) => boolean): boolean => {
    while (!stop(vs) && !vs.done) {
      if (performance.now() > deadline) return false
      const t0 = performance.now()
      if (vs.gen.next().done) {
        vs.done = true
        vs.sitesDone = true
      }
      if (perfMs.__dioramaVillageMs) perfMs.__dioramaVillageMs.push(+(performance.now() - t0).toFixed(2))
    }
    return true
  }
  /** Whether the village sites of every settlement whose territory reaches cell c or its neighbours are known (working on them until the deadline). */
  const sitesReadyAround = (c: number, deadline: number): boolean => {
    if (!territoriesReady(deadline)) return false
    let ok = true
    const check = (q: number) => {
      const id = ownerOf(q)
      if (id < 0 || peak[id] <= 300) return
      const vs = villageStates.get(id)
      if (vs && vs.sitesDone) return
      if (performance.now() > deadline) { ok = false; return }
      if (!driveVillages(villageStateOf(id), deadline, (v) => v.sitesDone)) ok = false
    }
    check(c)
    for (let k = off[c]; k < off[c + 1]; k++) check(nb[k])
    return ok
  }
  /** Adds the villages near cell c (sites known) to an avoid list in the frame (o, e, n) at c: x, y, radius + margin. */
  function avoidVillages(c: number, ox: number, oy: number, oz: number, ex: number, ey: number, ez: number, nx: number, ny: number, nz: number, avoid: number[], margin: number) {
    const seen: number[] = []
    const add = (q: number) => {
      const id = ownerOf(q)
      if (id < 0 || seen.includes(id)) return
      seen.push(id)
      const vs = villageStates.get(id)
      if (!vs) return
      for (let v = 0; v < vs.vx.length; v++) {
        const dx = vs.ux[v] - ox, dy = vs.uy[v] - oy, dz = vs.uz[v] - oz
        if (dx * dx + dy * dy + dz * dz > (spacing * 1.4) ** 2) continue
        avoid.push(dx * ex + dy * ey + dz * ez, dx * nx + dy * ny + dz * nz, vs.vr[v] + margin)
      }
    }
    add(c)
    for (let k = off[c]; k < off[c + 1]; k++) add(nb[k])
  }

  /** Spacing of the clusters of a village (world units). */
  const CLUSTER_STEP = 2.15 * KK
  /** Footprint radius of a cluster (world units). */
  const CLUSTER_R = 1.05 * KK
  const HOP_WEIGHT = [1.5, 1.0, 0.7, 0.45]

  function* villageStages(id: number, vs: VillageState): Generator<void, void, void> {
    const T = territories(world, hist)
    const terr = T.cells[id] ?? new Int32Array(0), hops = T.hops[id] ?? new Uint8Array(0)
    const pk = peak[id]
    const cap = terr.length ? ruralHouses(pk, terr.length) : 0
    if (cap <= 0 || settlements[id].outpost) return
    const sf = siteFor(id)
    const { ox, oy, oz, ex, ey, ez, nx, ny, nz } = sf
    // the villages the peak needs: whole clusters in order, up to the cap
    const plan: { clusters: number[]; before: number[]; target: number }[] = []
    {
      let cum = 0
      const tmp: number[] = []
      for (let v = 0; cum < cap && v < 20000; v++) {
        villageClusters(seed, id, v, tmp)
        const cl: number[] = [], bf: number[] = []
        for (const k of tmp) {
          const hh = CLUSTER_HOUSES[k]
          if (cum + hh / 2 > cap) break
          cl.push(k)
          bf.push(cum)
          cum += hh
        }
        if (!cl.length) break
        plan.push({ clusters: cl, before: bf, target: villageTarget(seed, id, v) })
      }
    }
    // towns to keep clear of: its own and those of the settlements in and around its territory
    const towns: number[] = [0, 0, extentOf(id)]
    {
      const ids = new Set<number>()
      for (const c of terr) {
        const sid = settlementCell[c]
        if (sid >= 0 && sid !== id) ids.add(sid)
        for (let k = off[c]; k < off[c + 1]; k++) { const q = settlementCell[nb[k]]; if (q >= 0 && q !== id) ids.add(q) }
      }
      for (const sid of ids) {
        if (settlements[sid].outpost) continue
        const o = originOf(sid)
        towns.push((o[0] - ox) * ex + (o[1] - oy) * ey + (o[2] - oz) * ez, (o[0] - ox) * nx + (o[1] - oy) * ny + (o[2] - oz) * nz, extentOf(sid))
        yield
      }
    }
    yield
    // the territory's cells in this frame, weighted for picking (nearer hops more)
    const cw: number[] = []
    let wsum = 0
    for (let i = 0; i < terr.length; i++) {
      wsum += HOP_WEIGHT[Math.min(3, hops[i])] * (world.biome[terr[i]] === 10 ? 0.4 : 1)
      cw.push(wsum)
    }
    const rivers = new Map<number, Float64Array>()
    const riversOf = (c: number) => {
      let r = rivers.get(c)
      if (!r) {
        collectRivers(c, ox, oy, oz, ex, ey, ez, nx, ny, nz)
        r = Float64Array.from(riverSegs)
        rivers.set(c, r)
      }
      return r
    }
    const nearRiver = (segs: Float64Array, x: number, y: number, d: number) => !riverClear(segs, x, y, d)
    const pt = [0, 0, 0]
    const toUnit = (x: number, y: number) => {
      const px = ox + ex * x + nx * y, py = oy + ey * x + ny * y, pz = oz + ez * x + nz * y
      const l = Math.hypot(px, py, pz)
      pt[0] = px / l; pt[1] = py / l; pt[2] = pz / l
    }
    const clearOfTowns = (x: number, y: number, r: number) => {
      for (let q = 0; q < towns.length; q += 3) if (Math.hypot(x - towns[q], y - towns[q + 1]) < towns[q + 2] + r) return false
      return true
    }

    // ---- 1. the sites ----
    for (let v = 0; v < plan.length; v++) {
      const nc = plan[v].clusters.length + (plan[v].target >= 12 ? 1 : 0) + (plan[v].target >= 40 ? 1 : 0)
      const vr = CLUSTER_STEP * 0.62 * Math.sqrt(nc + 0.4) * 1.15 + CLUSTER_R
      let best = -Infinity, bx = 0, by = 0, bc = -1
      for (let pass = 0; pass < 3 && bc < 0; pass++) {
        const gap = pass === 0 ? 1 : pass === 1 ? 0.6 : 0.3
        for (let att = 0; att < (pass === 0 ? 12 : 20); att++) {
          const salt = v * 64 + att + pass * 20
          // a cell of the territory, a point in it
          const u = rand4(seed, id, salt, 0xa1) * wsum
          let lo = 0, hi = cw.length - 1
          while (lo < hi) { const m = (lo + hi) >> 1; if (cw[m] < u) lo = m + 1; else hi = m }
          const c = terr[lo]
          const ccx = (GP[c * 3] - ox) * ex + (GP[c * 3 + 1] - oy) * ey + (GP[c * 3 + 2] - oz) * ez
          const ccy = (GP[c * 3] - ox) * nx + (GP[c * 3 + 1] - oy) * ny + (GP[c * 3 + 2] - oz) * nz
          const a = rand4(seed, id, salt, 0xa2) * Math.PI * 2, rr = spacing * 0.55 * Math.sqrt(rand4(seed, id, salt, 0xa3))
          const x = ccx + Math.cos(a) * rr, y = ccy + Math.sin(a) * rr
          if (!clearOfTowns(x, y, vr * 0.8 + HOUSE_WIDTH)) continue
          let spread = Infinity
          for (let q = 0; q < towns.length; q += 3) spread = Math.min(spread, Math.hypot(x - towns[q], y - towns[q + 1]) - towns[q + 2])
          let ok = true
          for (let q = 0; q < vs.vx.length && ok; q++) {
            const d = Math.hypot(x - vs.vx[q], y - vs.vy[q]) - vs.vr[q]
            if (d < (vr + HOUSE_WIDTH * 1.2) * gap) ok = false
            spread = Math.min(spread, d)
          }
          if (!ok) continue
          toUnit(x, y)
          const cell = surface.nearestCell(pt[0], pt[1], pt[2], c)
          if (ownerOf(cell) !== id) continue
          const segs = riversOf(cell)
          if (!riverClear(segs, x, y, vr * 0.45)) continue
          if (!dryFootprint(ox, oy, oz, ex, ey, ez, nx, ny, nz, x, y, vr * 0.6, cell)) continue
          // land worked early (its field cleared first), a river near, spread out from the rest
          const r = probe.radius
          const q = 1 - Math.min(255, clearedAt(pt[0] * r, pt[1] * r, pt[2] * r)) / 255
          const score = Math.sqrt(Math.max(0, Math.min(spread, spacing)) / spacing) * (0.45 + q + (nearRiver(segs, x, y, 4 * KK) ? 0.35 : 0)) + rand4(seed, id, salt, 0xa4) * 0.02
          if (score > best) { best = score; bx = x; by = y; bc = cell }
        }
        yield
      }
      if (bc < 0) break // no room left in the territory
      vs.vx.push(bx); vs.vy.push(by); vs.vr.push(vr)
      toUnit(bx, by)
      vs.ux.push(pt[0]); vs.uy.push(pt[1]); vs.uz.push(pt[2])
      vs.vcell.push(bc)
    }
    vs.sitesDone = true
    yield

    // ---- 2. the clusters, landmarks and yards of each village ----
    const favRoof = hash4(seed, root[id], 0x51, 0) % 5
    const placed: number[] = [] // cluster x, y
    const free = (x: number, y: number, r: number) => {
      for (let q = 0; q < placed.length; q += 2) if (Math.hypot(x - placed[q], y - placed[q + 1]) < r) return false
      return true
    }
    const near = vs.near, far = vs.far
    near.cx = far.cx = ox; near.cy = far.cy = oy; near.cz = far.cz = oz
    const colours = (style: StyleT, snow: number, k: number, roofI: number) => {
      const roofs = ROOFS[style], walls = WALLS[style]
      const rc = lin(roofs[(rand4(seed, id, k, 0xb1) < 0.6 ? favRoof : roofI) % roofs.length], 0.9 + 0.2 * rand4(seed, id, k, 0xb2))
      const wc = lin(walls[hash4(seed, id, k, 0xb3) % walls.length], 0.93 + 0.14 * rand4(seed, id, k, 0xb4))
      roofTmp[0] = rc[0]; roofTmp[1] = rc[1]; roofTmp[2] = rc[2]; roofTmp[3] = snow
      wallTmp[0] = wc[0]; wallTmp[1] = wc[1]; wallTmp[2] = wc[2]
    }
    for (let v = 0; v < vs.vx.length; v++) {
      const pv = plan[v]
      const cx0 = vs.vx[v], cy0 = vs.vy[v], vcell = vs.vcell[v]
      const style = styleOfCell(world, vcell)
      const snow = roofSnow(world, vcell)
      const segs = riversOf(vcell)
      const nStart = near.model.length, fStart = far.model.length
      // a street village: stretched along the lane to the town, or across it
      const axis = Math.atan2(cy0, cx0) + (rand4(seed, id, v, 0xb5) < 0.5 ? 0 : Math.PI / 2) + (rand4(seed, id, v, 0xb6) - 0.5) * 0.6
      const ca = Math.cos(axis), sa = Math.sin(axis)
      const base = rand4(seed, id, v, 0xb7) * Math.PI * 2
      const slotXY = (k: number): [number, number] => {
        if (k === 0) return [cx0, cy0]
        const r = CLUSTER_STEP * 0.62 * Math.sqrt(k + 0.4), a = base + k * 2.39996
        const lx = Math.cos(a) * r * 1.3, ly = Math.sin(a) * r * 0.78
        return [cx0 + lx * ca - ly * sa, cy0 + lx * sa + ly * ca]
      }
      const slotOk = (x: number, y: number, r: number) =>
        free(x, y, CLUSTER_R * 1.75) && clearOfTowns(x, y, r) && riverClear(segs, x, y, r) && dryFootprint(ox, oy, oz, ex, ey, ez, nx, ny, nz, x, y, r, vcell)
      // threshold of the cluster with index j standing
      const thrOf = (j: number) => ruralThreshold(HOUSEHOLD * Math.ceil(pv.before[j] + CLUSTER_HOUSES[pv.clusters[j]] / 2))
      let slot = 0
      const landmark = (role: number, model: number, x: number, y: number, yaw: number, threshold: number, sc: number) => {
        if (model < 0 || !has(model)) return
        probeAt(ox, oy, oz, ex, ey, ez, nx, ny, nz, x, y, vcell)
        colours(style, snow, v * 131 + role, hash4(seed, id, v, 0xb8) % 5)
        const r = footprint(model) * sc
        const info = infoFor(model, rand4(seed, id, v, 0xb9), false, style)
        writeSlot(near, model, threshold, yaw, sinkFor(r), sc, sc, sc, roofTmp, wallTmp, 0, 1.2, info)
        writeSlot(far, model, threshold, yaw, sinkFor(r), sc, sc, sc, roofTmp, wallTmp, 0, 1.2, NO_INFO)
        placed.push(x, y)
      }
      // the centre: a church for a large village, a well for a smaller one
      if (pv.target >= 12) {
        const [x, y] = slotXY(0)
        slot = 1
        if (slotOk(x, y, CLUSTER_R * 0.8)) {
          const big = pv.target >= 25
          const it = { role: big ? Role.Church : Role.Well, style } as PlanItem
          const m = modelFor(it)
          const j = big ? Math.min(pv.clusters.length - 1, Math.ceil(pv.clusters.length * 0.5)) : Math.min(pv.clusters.length - 1, 1)
          landmark(it.role, m, x, y, axis, thrOf(j), big ? 0.85 : 1)
        }
      }
      if (pv.target >= 40) {
        const [x, y] = slotXY(1)
        slot = 2
        if (slotOk(x, y, CLUSTER_R * 0.7)) landmark(Role.Market, Model.Stalls, x, y, axis, thrOf(Math.min(pv.clusters.length - 1, Math.ceil(pv.clusters.length * 0.75))), 0.9)
      }
      let maxR = CLUSTER_R
      for (let j = 0; j < pv.clusters.length; j++) {
        const n = CLUSTER_HOUSES[pv.clusters[j]]
        let x = 0, y = 0, ok = false
        for (let tries = 0; tries < 8 && !ok; tries++, slot++) {
          ;[x, y] = slotXY(slot)
          ok = slotOk(x, y, CLUSTER_R)
        }
        if (!ok) continue
        placed.push(x, y)
        const k = v * 4096 + j
        const yaw = rand4(seed, id, k, 0xba) * Math.PI * 2
        const thr = thrOf(j)
        probeAt(ox, oy, oz, ex, ey, ez, nx, ny, nz, x, y, vcell)
        // its yard of packed earth
        const g = lin(GROUND[style], 0.92)
        roofTmp[0] = roofTmp[1] = roofTmp[2] = roofTmp[3] = 0
        writeSlot(near, GROUND_MODEL, thr, 0, 0, 1.3, 1, 1.3, roofTmp, g)
        const model = styleModel(style, hamletKind(n)), farModel = styleModel(style, hamletKind(n, true))
        colours(style, snow, k, hash4(seed, id, k, 0xbb) % 5)
        const r = footprint(model)
        const timber = style === Style.Temperate && rand4(seed, id, k, 0xbc) < 0.3
        writeSlot(near, model, thr, yaw, sinkFor(r * 0.6), 1, 0.92 + 0.16 * rand4(seed, id, k, 0xbd), 1, roofTmp, wallTmp, 0, 1.0, infoFor(model, rand4(seed, id, k, 0xbe), timber, style))
        writeSlot(far, farModel, thr, yaw, sinkFor(r * 0.6), 1, 1, 1, roofTmp, wallTmp, 0, 1.0, NO_INFO)
        maxR = Math.max(maxR, Math.hypot(x - cx0, y - cy0) + CLUSTER_R)
        if (j % 3 === 2) yield
      }
      // a windmill on the edge of a grain village
      if (windmillsFit(style) && pv.target >= 18 && rand4(seed, id, v, 0xbf) < 0.6) {
        const x = cx0 + ca * (maxR + 0.9 * KK), y = cy0 + sa * (maxR + 0.9 * KK)
        if (slotOk(x, y, footprint(Model.Windmill))) landmark(Role.Windmill, Model.Windmill, x, y, rand4(seed, id, v, 0xc0) * 6.28, thrOf(Math.min(pv.clusters.length - 1, Math.ceil(pv.clusters.length * 0.4))), 1)
      }
      vs.nearR.push(nStart, near.model.length)
      vs.farR.push(fStart, far.model.length)
      vs.vr[v] = Math.max(vs.vr[v], maxR)
      vs.placed = v + 1
      vs.set = null
      yield
    }
  }

  const NO_VILLAGES = { set: { n: 0, centre: new Float32Array(0), radius: new Float32Array(0), cell: new Int32Array(0), near: new Int32Array(0), far: new Int32Array(0), nearSet: EMPTY, farSet: EMPTY } as VillageSet, done: true }
  function getVillages(id: number, deadline: number): { set: VillageSet; done: boolean } | null {
    if (peak[id] <= 300 || settlements[id].outpost) return NO_VILLAGES
    let vs = villageStates.get(id)
    if (!vs) {
      if (performance.now() > deadline || !territoriesReady(deadline)) return null
      vs = villageStateOf(id)
    }
    const before = vs.placed
    driveVillages(vs, deadline, () => false)
    if (vs.placed !== before) vs.set = null
    if (!vs.set) {
      const n = vs.placed
      const centre = new Float32Array(n * 3), radius = new Float32Array(n), cell = new Int32Array(n)
      for (let v = 0; v < n; v++) {
        centre[v * 3] = vs.ux[v]; centre[v * 3 + 1] = vs.uy[v]; centre[v * 3 + 2] = vs.uz[v]
        radius[v] = vs.vr[v]
        cell[v] = vs.vcell[v]
      }
      vs.set = { n, centre, radius, cell, near: Int32Array.from(vs.nearR), far: Int32Array.from(vs.farR), nearSet: vs.near.finish(), farSet: vs.far.finish() }
    }
    return { set: vs.set, done: vs.done }
  }

  // ---------- countryside ----------
  const farmCache = new Map<number, SlotSet>()
  /** Land-use thresholds of a cell's farmsteads. */
  const FARM_THRESHOLDS = [45, 80, 115, 150, 185, 220]
  function layoutFarm(cell: number): SlotSet {
    if (water(cell)) return EMPTY
    const ox = GP[cell * 3], oy = GP[cell * 3 + 1], oz = GP[cell * 3 + 2]
    frameAt(ox, oy, oz)
    const ex = fr.ex, ey = fr.ey, ez = fr.ez, nx = fr.nx, ny = fr.ny, nz = fr.nz
    collectRivers(cell, ox, oy, oz, ex, ey, ez, nx, ny, nz)
    const segs = riverSegs.slice()
    // keep clear of settlement plans in and around the cell
    const avoid: number[] = []
    const addAvoid = (j: number) => {
      const sid = settlementCell[j]
      if (sid < 0) return
      const o = originOf(sid)
      const tx = (o[0] - ox) * ex + (o[1] - oy) * ey + (o[2] - oz) * ez
      const ty = (o[0] - ox) * nx + (o[1] - oy) * ny + (o[2] - oz) * nz
      avoid.push(tx, ty, extentOf(sid) + HOUSE_WIDTH)
    }
    addAvoid(cell)
    for (let k = off[cell]; k < off[cell + 1]; k++) addAvoid(nb[k])
    avoidVillages(cell, ox, oy, oz, ex, ey, ez, nx, ny, nz, avoid, HOUSE_WIDTH * 0.5)
    const style = styleOfCell(world, cell)
    const snow = roofSnow(world, cell)
    const w = new SlotWriter()
    const px: number[] = [], py: number[] = [], pr: number[] = []
    const roofs = ROOFS[style], walls = WALLS[style]
    const fits = (x: number, y: number, r: number) => {
      for (let q = 0; q < px.length; q++) if (Math.hypot(x - px[q], y - py[q]) < r + pr[q] + HOUSE_WIDTH * 0.3) return false
      for (let q = 0; q < avoid.length; q += 3) if (Math.hypot(x - avoid[q], y - avoid[q + 1]) < r + avoid[q + 2]) return false
      return riverClear(segs, x, y, r)
    }
    const spot = (k: number, salt: number, r: number, inner = 0.05, outer = 0.5): [number, number] | null => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const a = rand4(seed, cell, k * 16 + attempt, salt) * Math.PI * 2
        const rr = spacing * (inner + (outer - inner) * Math.sqrt(rand4(seed, cell, k * 16 + attempt, salt + 1)))
        const x = rr * Math.cos(a), y = rr * Math.sin(a)
        if (!fits(x, y, r)) continue
        if (!dryFootprint(ox, oy, oz, ex, ey, ez, nx, ny, nz, x, y, r, cell)) continue
        return [x, y]
      }
      return null
    }
    const put = (model: number, threshold: number, x: number, y: number, yaw: number, roofI: number, wallI: number, sc = 1) => {
      probeAt(ox, oy, oz, ex, ey, ez, nx, ny, nz, x, y, cell)
      const rc = lin(roofs[roofI % roofs.length], 0.9 + 0.2 * rand4(seed, cell, px.length, 0x81))
      const wc = lin(walls[wallI % walls.length], 0.93 + 0.14 * rand4(seed, cell, px.length, 0x82))
      roofTmp[0] = rc[0]; roofTmp[1] = rc[1]; roofTmp[2] = rc[2]; roofTmp[3] = snow
      wallTmp[0] = wc[0]; wallTmp[1] = wc[1]; wallTmp[2] = wc[2]
      const r = footprint(model) * sc
      writeSlot(w, model, threshold, yaw, sinkFor(r), sc, sc, sc, roofTmp, wallTmp)
      px.push(x); py.push(y); pr.push(r)
    }
    const favRoof = hash4(seed, cell, 0x83, 0)
    // farmsteads: a house and a barn (a haystack in grain country), the odd windmill
    const small = styleModel(style, Kind.Small), barn = styleModel(style, Kind.Long)
    const hay = style === Style.Temperate || style === Style.Savanna
    let windmills = 0
    // in a settlement's territory its villages hold the countryside's people (census.ts):
    // the lone farmsteads stand only on land no settlement claims
    const ownedBy = ownerOf(cell)
    const nFarms = ownedBy >= 0 && !settlements[ownedBy].outpost ? 0 : FARM_THRESHOLDS.length
    for (let k = 0; k < nFarms; k++) {
      const t = FARM_THRESHOLDS[k] + (rand4(seed, cell, k, 0x84) - 0.5) * 20
      const r = footprint(small) * 2.4
      const p = spot(k, 0x85, r, 0.08, 0.52)
      if (!p) continue
      const yaw = rand4(seed, cell, k, 0x86) * Math.PI * 2
      const ca = Math.cos(yaw), sa = Math.sin(yaw)
      const d = HOUSE_WIDTH * 0.95
      put(small, t, p[0] - (ca * d) / 2, p[1] - (sa * d) / 2, yaw, favRoof + (k & 1), k)
      put(barn, t, p[0] + (ca * d) / 2 - sa * d * 0.5, p[1] + (sa * d) / 2 + ca * d * 0.5, yaw + Math.PI / 2, 3, 3, 0.85)
      if (hay && rand4(seed, cell, k, 0x87) < 0.5 && has(Model.Haystack)) put(Model.Haystack, t, p[0] + sa * d * 0.9, p[1] - ca * d * 0.9, yaw, 0, 0, 0.8)
      if (windmillsFit(style) && windmills === 0 && k >= 2 && rand4(seed, cell, k, 0x88) < 0.3 && has(Model.Windmill)) {
        const q = spot(k, 0x89, footprint(Model.Windmill), 0.15, 0.5)
        if (q) { put(Model.Windmill, t + 10, q[0], q[1], rand4(seed, cell, k, 0x8a) * 6.28, 0, 0); windmills++ }
      }
    }
    if (isRiver(cell) && segs.length >= 5 && (kaykitFits(style) || style === Style.Cold) && has(Model.Watermill) && settlementCell[cell] < 0) {
      const ax = segs[0], ay = segs[1], bx = segs[2], by = segs[3], hw = segs[4]
      const dx = bx - ax, dy = by - ay, dl = Math.hypot(dx, dy) || 1
      const side = rand4(seed, cell, 0, 0x8b) < 0.5 ? -1 : 1
      const r = footprint(Model.Watermill)
      const o = hw + r * 0.8
      const x = ax + dx * 0.3 + (-dy / dl) * o * side, y = ay + dy * 0.3 + (dx / dl) * o * side
      if (fits(x, y, r * 0.8) && dryFootprint(ox, oy, oz, ex, ey, ez, nx, ny, nz, x, y, r, cell)) put(Model.Watermill, 100, x, y, Math.atan2(dy, dx) + (side > 0 ? Math.PI : 0), 0, 0)
    }
    // groves of the biome, cleared as the land is farmed (shown while land use is below their threshold)
    const fl = floraOf(world, cell)
    for (let k = 0; k < fl.count && fl.kinds.length; k++) {
      const kind = fl.kinds[Math.floor(rand4(seed, cell, k, 0x8c) * fl.kinds.length)]
      const m = floraModel(kind)
      if (!has(m)) continue
      const sc = 0.8 + 0.5 * rand4(seed, cell, k, 0x8d)
      const p = spot(k + 8, 0x8e, footprint(m) * sc, 0.05, 0.55)
      if (!p) continue
      probeAt(ox, oy, oz, ex, ey, ez, nx, ny, nz, p[0], p[1], cell)
      if (!treeFits(rand4(seed, cell, k, 0x91))) continue
      const t = 70 + 150 * rand4(seed, cell, k, 0x8f)
      put(m, -t, p[0], p[1], rand4(seed, cell, k, 0x90) * 6.28, 0, 0, sc)
    }
    return w.finish()
  }

  // ---------- forest stands ----------
  // Dense groves on a jittered hex lattice over the cell's own Voronoi region (so
  // neighbouring cells tile without overlap), clear of towns, farmsteads, rivers and water.
  // Each grove stands while the cell's land use is below the level at which the planet
  // shader switches on the field under it (farmland(): field cell random rnd.x against the
  // cover from land use and its clump noise), so the forest is cleared field by field
  // exactly where the fields appear.
  const forestCache = new Map<number, SlotSet>()
  const FIELD_FREQ = 7 / spacing
  const invSmooth = (y: number) => 0.5 - Math.sin(Math.asin(Math.max(-1, Math.min(1, 1 - 2 * y))) / 3)
  /** Land use (0..255) at which the field at (x, y, z) (object space) is cultivated, or 256 if never. */
  const clearedAt = (x: number, y: number, z: number) => {
    const rx = cellRandX(x, y, z, FIELD_FREQ)
    const m1 = fbm(x, y, z, 9, 4), m2 = fbm(x + 31.7, y + 31.7, z + 31.7, 40, 3)
    const clump = m2 - 0.4 * m1
    const target = (rx - 0.06) / Math.max(0.05, 1 + 0.9 * clump)
    if (target >= 1) return 256
    if (target <= 0) return 0
    return Math.min(255, invSmooth(target) * 0.8 * 255)
  }
  const FOREST: Partial<Record<number, { d: number; kinds: Flora[] }>> = {
    [Biome.TemperateForest]: { d: 0.8, kinds: [Flora.Broadleaf, Flora.Broadleaf, Flora.Broadleaf, Flora.Conifer] },
    [Biome.Taiga]: { d: 0.82, kinds: [Flora.Conifer] },
    [Biome.Rainforest]: { d: 0.95, kinds: [Flora.Jungle, Flora.Jungle, Flora.Palm] },
    [Biome.Savanna]: { d: 0.1, kinds: [Flora.Acacia] },
    [Biome.Grassland]: { d: 0.08, kinds: [Flora.Broadleaf] },
    [Biome.Mountain]: { d: 0.3, kinds: [Flora.Conifer] },
  }
  function layoutForest(cell: number): SlotSet {
    if (water(cell)) return EMPTY
    const fo = FOREST[world.biome[cell]]
    if (!fo) return EMPTY
    // no trees above the snow line
    const snow = roofSnow(world, cell)
    if (snow > 0.85) return EMPTY
    // the cell's farmsteads keep their ground (laid out first, whatever the frame timing)
    let farm = farmCache.get(cell)
    if (!farm) {
      farm = layoutFarm(cell)
      farmCache.set(cell, farm)
    }
    const ox = GP[cell * 3], oy = GP[cell * 3 + 1], oz = GP[cell * 3 + 2]
    frameAt(ox, oy, oz)
    const ex = fr.ex, ey = fr.ey, ez = fr.ez, nx = fr.nx, ny = fr.ny, nz = fr.nz
    collectRivers(cell, ox, oy, oz, ex, ey, ez, nx, ny, nz)
    const segs = riverSegs.slice()
    const avoid: number[] = []
    const addAvoid = (j: number) => {
      const sid = settlementCell[j]
      if (sid < 0) return
      const o = originOf(sid)
      const tx = (o[0] - ox) * ex + (o[1] - oy) * ey + (o[2] - oz) * ez
      const ty = (o[0] - ox) * nx + (o[1] - oy) * ny + (o[2] - oz) * nz
      avoid.push(tx, ty, extentOf(sid) * 1.05 + HOUSE_WIDTH)
    }
    addAvoid(cell)
    for (let k = off[cell]; k < off[cell + 1]; k++) addAvoid(nb[k])
    avoidVillages(cell, ox, oy, oz, ex, ey, ez, nx, ny, nz, avoid, HOUSE_WIDTH)
    const G = 1.7 * KK
    const R = spacing * 0.75
    const n = Math.ceil(R / G)
    const w = new SlotWriter()
    const roofZ = [0, 0, 0, snow * 0.8]
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const h = hash4(seed, cell, (i + 512) * 1024 + j + 512, 0x92)
        if (h / 4294967296 >= fo.d) continue
        const jx = rand4(seed, cell, i * 7919 + j, 0x93) - 0.5, jy = rand4(seed, cell, i * 7919 + j, 0x94) - 0.5
        const x = (i + (j & 1) * 0.5 + jx * 0.7) * G, y = (j * 0.866 + jy * 0.6) * G
        if (x * x + y * y > R * R) continue
        // only this cell's own ground
        const px = ox + ex * x + nx * y, py = oy + ey * x + ny * y, pz = oz + ez * x + nz * y
        const l = Math.hypot(px, py, pz)
        if (surface.nearestCell(px / l, py / l, pz / l, cell) !== cell) continue
        let ok = true
        for (let q = 0; q < avoid.length && ok; q += 3) if (Math.hypot(x - avoid[q], y - avoid[q + 1]) < avoid[q + 2]) ok = false
        if (!ok || !riverClear(segs, x, y, 0.75 * KK)) continue
        {
          for (let q = 0; q < farm.n && ok; q++) {
            if (farm.threshold[q] < 0) continue
            const o = q * 16
            const fx = farm.mat[o + 12], fy = farm.mat[o + 13], fz = farm.mat[o + 14]
            const fl = Math.hypot(fx, fy, fz) || 1
            const dx = fx / fl - px / l, dy = fy / fl - py / l, dz = fz / fl - pz / l
            if (dx * dx + dy * dy + dz * dz < (1.3 * KK) ** 2) ok = false
          }
          if (!ok) continue
        }
        probeAt(ox, oy, oz, ex, ey, ez, nx, ny, nz, x, y, cell)
        if (surface.wet(probe, 0.08)) continue
        if (!treeFits(rand4(seed, cell, i * 7919 + j, 0x97))) continue
        const r = probe.radius
        const t = clearedAt((px / l) * r, (py / l) * r, (pz / l) * r)
        if (t <= 2) continue
        const kind = fo.kinds[h % fo.kinds.length]
        const m = floraModel(kind)
        if (!has(m)) continue
        const sc = 0.85 + 0.4 * rand4(seed, cell, i * 7919 + j, 0x95)
        writeSlot(w, m, t >= 256 ? -256 : -t, rand4(seed, cell, i * 7919 + j, 0x96) * 6.283, sinkFor(footprint(m) * sc * 0.5), sc, sc * (0.9 + 0.2 * rand4(seed, cell, i, j)), sc, roofZ, NO_INFO)
      }
    }
    return w.finish()
  }

  // ---------- ports and dams ----------
  const structCache = new Map<number, SlotSet>()

  function layoutPort(pos: ArrayLike<number>, po: number, dir: ArrayLike<number>, d0: number, owner: number): SlotSet {
    const ox = pos[po], oy = pos[po + 1], oz = pos[po + 2]
    const ol = Math.hypot(ox, oy, oz)
    let ux = ox / ol, uy = oy / ol, uz = oz / ol
    frameAt(ux, uy, uz)
    // seaward, as a direction on the globe (kept while the pier's place moves below)
    let dX = dir[d0], dY = dir[d0 + 1], dZ = dir[d0 + 2]
    let ex = fr.ex, ey = fr.ey, ez = fr.ez, nx = fr.nx, ny = fr.ny, nz = fr.nz
    let start = surface.nearestCell(ux, uy, uz, settlements[owner]?.cell ?? 0)
    const w = new SlotWriter()
    const style = owner >= 0 ? styleOf(owner) : Style.Temperate
    const dockLen = (lib.models[Model.Dock]?.size.z ?? 2.5) * MODEL_SPECS[Model.Dock].scale
    const wetAt = (x: number, y: number) => {
      probeAt(ux, uy, uz, ex, ey, ez, nx, ny, nz, x, y, start)
      return surface.wet(probe, 0)
    }
    const stepS = spacing * 0.012
    // the town's own waterfront: where the port's place lies across the water from the
    // town (over a bay, a lake or an estuary), the pier moves to the shore the town stands
    // on, on the line from the town toward the port, and reaches out from there
    if (owner >= 0 && owner < N && !settlements[owner].outpost) {
      const o = originOf(owner)
      const tx = (o[0] - ux) * ex + (o[1] - uy) * ey + (o[2] - uz) * ez
      const ty = (o[0] - ux) * nx + (o[1] - uy) * ny + (o[2] - uz) * nz
      const td = Math.hypot(tx, ty)
      if (td > stepS * 3) {
        const dx = -tx / td, dy = -ty / td
        const h = stepS * 0.5
        let firstWet = -1, dryAgain = false
        for (let s = 0; s <= td; s += h) {
          const wet = wetAt(tx + dx * s, ty + dy * s)
          if (firstWet < 0) { if (wet) firstWet = s }
          else if (!wet && s < td - h * 2) { dryAgain = true; break }
        }
        if (firstWet > 0 && dryAgain) {
          const bx = tx + dx * (firstWet - h), by = ty + dy * (firstWet - h)
          const px = ux + ex * bx + nx * by, py = uy + ey * bx + ny * by, pz = uz + ez * bx + nz * by
          const pl = Math.hypot(px, py, pz)
          dX = ex * dx + nx * dy; dY = ey * dx + ny * dy; dZ = ez * dx + nz * dy
          ux = px / pl; uy = py / pl; uz = pz / pl
          frameAt(ux, uy, uz)
          ex = fr.ex; ey = fr.ey; ez = fr.ez; nx = fr.nx; ny = fr.ny; nz = fr.nz
          start = surface.nearestCell(ux, uy, uz, settlements[owner].cell)
          const pm = (globalThis as { __dioramaPierMoved?: Record<number, number> }).__dioramaPierMoved
          if (pm) pm[owner] = +(td / spacing).toFixed(3)
        }
      }
    }
    const sx = dX * ex + dY * ey + dZ * ez
    const sy = dX * nx + dY * ny + dZ * nz
    const sl = Math.hypot(sx, sy) || 1
    let fx = sx / sl, fy = sy / sl // seaward
    // the pier starts at the drawn shoreline nearest the port position and reaches out
    let shore = 0
    if (wetAt(0, 0)) {
      search: for (let i = 1; i <= 60; i++) {
        for (let a = 0; a <= 8; a++) {
          const ang = Math.atan2(-fy, -fx) + (a % 2 ? 1 : -1) * Math.ceil(a / 2) * 0.35
          const x = Math.cos(ang) * i * stepS, y = Math.sin(ang) * i * stepS
          if (!wetAt(x, y)) {
            fx = -Math.cos(ang)
            fy = -Math.sin(ang)
            shore = -(i - 0.5) * stepS
            break search
          }
        }
      }
    } else {
      for (let i = 1; i <= 50; i++) if (wetAt(fx * i * stepS, fy * i * stepS)) { shore = (i - 0.5) * stepS; break }
    }
    const gx = -fy, gy = fx
    const seaYaw = Math.atan2(fy, fx)
    const zero4 = [0, 0, 0, 0], zero3 = [0, 0, 0]
    const ownerPeak = owner >= 0 ? peak[owner] : 0
    const big = ownerPeak >= TOWN_POPULATION, city = ownerPeak >= CITY_POPULATION
    /** Seaward distance of the drawn shoreline on the line through along-shore offset t (null: none near). */
    const shoreAt = (t: number): number | null => {
      const bx = gx * t, by = gy * t
      const h = stepS * 0.5
      if (wetAt(bx + fx * shore, by + fy * shore)) {
        for (let i = 1; i <= 40; i++) if (!wetAt(bx + fx * (shore - i * h), by + fy * (shore - i * h))) return shore - (i - 0.5) * h
      } else {
        for (let i = 1; i <= 40; i++) if (wetAt(bx + fx * (shore + i * h), by + fy * (shore + i * h))) return shore + (i - 0.5) * h
      }
      return null
    }
    // a quay along the shore (towns and cities): dock pieces with their long side on the water's edge
    const quayN = city ? 5 : big ? 3 : 0
    const quay: number[] = []
    for (let q = 0; q < quayN; q++) {
      const k = q % 2 ? -Math.ceil(q / 2) : Math.ceil(q / 2)
      const t = k * dockLen * 0.92
      const a = shoreAt(t)
      if (a === null || Math.abs(a - shore) > dockLen * 1.2) continue
      probeAt(ux, uy, uz, ex, ey, ez, nx, ny, nz, gx * t + fx * (a + dockLen * 0.08), gy * t + fy * (a + dockLen * 0.08), start)
      writeSlot(w, Model.Dock, q < 3 ? TOWN_POPULATION * 0.8 : CITY_POPULATION * 0.8, seaYaw, heightOf(Model.Dock) * 0.45, 1, 1, 1, zero4, zero3)
      quay.push(t, a)
    }
    // short piers reaching out: one for a village, more as the port grows
    const piers: [number, number, number][] = [[0, big ? 2 : 1, 0], [-1.7, 2, 1500], [1.7, city ? 3 : 2, 6000], [3.4, 1, 12000]]
    const pierBase: number[] = []
    for (const [tk, len, threshold] of piers) {
      if (threshold > 0 && threshold > ownerPeak) continue
      const t = tk * dockLen
      const a = tk === 0 ? shore : shoreAt(t)
      if (a === null) continue
      for (let i = 0; i < len; i++) {
        const along = a + dockLen * (0.4 + i * 0.92)
        probeAt(ux, uy, uz, ex, ey, ez, nx, ny, nz, gx * t + fx * along, gy * t + fy * along, start)
        if (i > 0 && !surface.wet(probe, 0.2)) break
        // the dock's long axis is its z: yaw puts model x along the shore
        writeSlot(w, Model.Dock, threshold, seaYaw - Math.PI / 2, heightOf(Model.Dock) * 0.45, 1, 1, 1, zero4, zero3)
      }
      pierBase.push(t, a, len)
    }
    // ships moored alongside the piers, more as the owner grows
    const pal = 1 + (hash4(seed, owner, 0x51, 0) % 7)
    const ships: [number, number, number, number, number][] = [
      [0, 0.9, 1, Model.Ship, 0],
      [0, 1.6, -1, Model.ShipMedium, 1500],
      [1, 1.2, 1, Model.Ship, TOWN_POPULATION],
      [2, 1.4, -1, Model.Ship, 6000],
      [2, 2.2, 1, Model.ShipMedium, 12000],
    ]
    for (const [pi, along0, side, model, threshold] of ships) {
      if (!has(model) || pi * 3 >= pierBase.length) continue
      if (threshold > ownerPeak && threshold > 0) continue
      const t = pierBase[pi * 3], a = pierBase[pi * 3 + 1]
      const beam = footprint(model) * 0.35 + dockLen * 0.6
      for (let push = 0; push < 4; push++) {
        const al = a + dockLen * (along0 + push * 0.5)
        const x = gx * t + fx * al + gx * beam * side, y = gy * t + fy * al + gy * beam * side
        probeAt(ux, uy, uz, ex, ey, ez, nx, ny, nz, x, y, start)
        if (!surface.wet(probe, 0.3) && push < 3) continue
        // boats lie along the pier, bow out to sea; hulls sink to their waterline
        writeSlot(w, model, threshold, seaYaw - Math.PI / 2, heightOf(model) * 0.08, 1, 1, 1, zero4, zero3, style === Style.Temperate ? pal : 0, 0.9)
        break
      }
    }
    // small boats: rowing boats tied up along the quay and the piers, fishing boats out on the water
    const nRow = city ? 6 : big ? 4 : 2
    for (let k = 0; k < nRow; k++) {
      const u = rand4(seed, owner, k, 0x9a)
      let x: number, y: number
      if (quay.length && k % 2 === 0) {
        const q = Math.floor(u * (quay.length / 2)) * 2
        const t = quay[q] + (rand4(seed, owner, k, 0x9b) - 0.5) * dockLen * 0.8, a = quay[q + 1] + dockLen * 0.42
        x = gx * t + fx * a; y = gy * t + fy * a
      } else if (pierBase.length) {
        const q = Math.floor(u * (pierBase.length / 3)) * 3
        const side = k & 2 ? 1 : -1
        const al = pierBase[q + 1] + dockLen * (0.3 + 0.9 * rand4(seed, owner, k, 0x9b) * pierBase[q + 2])
        x = gx * pierBase[q] + fx * al + gx * dockLen * 0.42 * side; y = gy * pierBase[q] + fy * al + gy * dockLen * 0.42 * side
      } else continue
      probeAt(ux, uy, uz, ex, ey, ez, nx, ny, nz, x, y, start)
      if (!surface.wet(probe, 0.15)) continue
      // moored side-on to the quay or the pier
      const yaw = seaYaw + (quay.length && k % 2 === 0 ? 0 : Math.PI / 2) + (rand4(seed, owner, k, 0x9c) - 0.5) * 0.4
      writeSlot(w, Model.Boat, k < 2 ? 0 : 300 * k, yaw, KK * 0.02, 1, 1, 1, zero4, zero3, 0, 0.8)
    }
    const nFish = city ? 6 : big ? 4 : 2
    for (let k = 0; k < nFish; k++) {
      const t = (rand4(seed, owner, k, 0x9d) - 0.5) * dockLen * 7
      const a = shore + dockLen * (1.6 + 3.2 * rand4(seed, owner, k, 0x9e))
      probeAt(ux, uy, uz, ex, ey, ez, nx, ny, nz, gx * t + fx * a, gy * t + fy * a, start)
      if (!surface.wet(probe, 0.6)) continue
      writeSlot(w, Model.FishingBoat, k === 0 ? 0 : 200 + 400 * k, seaYaw + Math.PI / 2 + (rand4(seed, owner, k, 0x9f) - 0.5) * 2.4, KK * 0.02, 1, 1, 1, zero4, zero3, 0, 0.8)
    }
    return w.finish()
  }

  function layoutDam(cell: number, pos: ArrayLike<number>, po: number, dir: ArrayLike<number>, d0: number): SlotSet {
    const ox = pos[po], oy = pos[po + 1], oz = pos[po + 2]
    const ol = Math.hypot(ox, oy, oz)
    const ux = ox / ol, uy = oy / ol, uz = oz / ol
    surface.probe(ux, uy, uz, cell, probe)
    frameAt(ux, uy, uz)
    const sx = dir[d0] * fr.ex + dir[d0 + 1] * fr.ey + dir[d0 + 2] * fr.ez
    const sy = dir[d0] * fr.nx + dir[d0 + 1] * fr.ny + dir[d0 + 2] * fr.nz
    // local z runs downstream: x across the river
    const yaw = Math.atan2(sy, sx) - Math.PI / 2
    const hw = riverHalfWidth(world.flow[cell])
    const width = Math.max(HOUSE_WIDTH * 2, hw * 2.8)
    const w = new SlotWriter()
    writeSlot(w, Model.Dam, 0, yaw, 0.00003, width / MODEL_SPECS[Model.Dam].scale, 1, 1.2, [0, 0, 0, 0], [0, 0, 0])
    return w.finish()
  }

  return {
    setHistory(next: History) {
      if (next.settlements.length < N) return
      const keep = N
      settlements = next.settlements
      N = settlements.length
      hist = next
      ownerCell = null
      territoryGen = null
      computeFacts(next, keep)
    },
    settlement: getSettlement,
    settlementReady(id, need) {
      const st = states.get(id)
      if (!st) return false
      // advance() with a past deadline only reports coverage
      return st.plan.advance(need, -1) && st.written >= st.plan.items.length && st.groundWritten >= st.plan.ground.length
    },
    villages: getVillages,
    farm(cell: number, deadline: number) {
      let s = farmCache.get(cell)
      if (!s) {
        if (performance.now() > deadline) return null
        // farmsteads keep clear of the villages: their sites first
        if (!sitesReadyAround(cell, deadline)) return null
        s = layoutFarm(cell)
        farmCache.set(cell, s)
      }
      return s
    },
    forest(cell: number, deadline: number) {
      let s = forestCache.get(cell)
      if (!s) {
        if (performance.now() > deadline) return null
        if (!sitesReadyAround(cell, deadline)) return null
        s = layoutForest(cell)
        forestCache.set(cell, s)
      }
      return s
    },
    port(structureId, owner, pos, po, dir, d0) {
      let s = structCache.get(structureId)
      if (!s) {
        s = layoutPort(pos, po, dir, d0, owner)
        structCache.set(structureId, s)
      }
      return s
    },
    dam(structureId, cell, pos, po, dir, d0) {
      let s = structCache.get(structureId)
      if (!s) {
        s = layoutDam(cell, pos, po, dir, d0)
        structCache.set(structureId, s)
      }
      return s
    },
  }
}

/**
 * When a slot with `threshold` shows over the snapshot window: the value (population or
 * land use) is linear between snapshots (yP, vP) -> (y0, vA) -> (y1, vB). Writes the
 * appear / disappear years of the crossing nearest the window into out[0..1] and returns
 * whether the slot shows (or is animating) anywhere in [y0, y1].
 */
export function crossing(threshold: number, vP: number, vA: number, vB: number, yP: number, y0: number, y1: number, out: Float64Array): boolean {
  const lerpYear = (ya: number, yb: number, va: number, vb: number) => ya + ((threshold - va) / (vb - va)) * (yb - ya)
  let appear = -NEVER
  let disappear = NEVER
  if (vA >= threshold) {
    if (vP < threshold && y0 > yP) appear = lerpYear(yP, y0, vP, vA)
    if (vB < threshold) disappear = lerpYear(y0, y1, vA, vB)
  } else if (vB >= threshold) {
    appear = lerpYear(y0, y1, vA, vB)
  } else if (vP >= threshold && y0 > yP) {
    appear = -NEVER
    disappear = lerpYear(yP, y0, vP, vA)
  } else return false
  out[0] = appear
  out[1] = disappear
  return true
}
