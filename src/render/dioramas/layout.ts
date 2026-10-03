// Deterministic placement of every model: settlement plans (town.ts), the countryside
// (farmsteads, mills and groves), and the pieces at ports and dams. Each layout is a list
// of slots computed lazily, then cached, from (world.seed, settlement or cell, slot) and
// never from the current year: the year only decides which slots are filled. A slot
// carries its instance matrix (on the ground, upright along the local vertical), a matrix
// for its contact shadow, its colours, and the population (or land-use) threshold at
// which it shows.
//
// Settlement plans are expensive (hundreds of ground probes for a city), so they advance
// under a time budget: settlement() returns what is ready and says whether it is done.

import { CITY_POPULATION, EventType, RIVER_FLOW_THRESHOLD, StructureType, TOWN_POPULATION, type History, type World } from '../../contract.ts'
import { isWaterCell, lakeArray } from '../globe.ts'
import { floraModel, HOUSE_WIDTH, KK, Model, MODEL_SPECS, styleModel, type ModelLibrary } from './models.ts'
import { Kind, Style, type Style as StyleT } from './shapes.ts'
import { createSurface, hash4, rand4, type Probe } from './surface.ts'
import { floraOf, GROUND, kaykitFits, roofSnow, ROOFS, srgbToLinear, styleOfCell, WALL_STONE, WALLS, WHITEWASH, windmillsFit } from './styles.ts'
import { createTownPlan, Role, townRadius, type PlanItem, type Site, type TownPlan } from './town.ts'

export const NEVER = 1e9
/** Model id of the packed-earth ground decal under built-up patches (drawn by the ground batch). */
export const GROUND_MODEL = 255

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
      radius: this.radius,
      cx: this.cx,
      cy: this.cy,
      cz: this.cz,
    }
  }
}

export interface Layouts {
  /**
   * Slots of settlement `id`, laid out at least as far as population `need` requires if
   * the time budget (performance.now() deadline) allows; `done` says whether it did.
   */
  settlement(id: number, need: number, deadline: number): { set: SlotSet; done: boolean } | null
  /** Whether settlement `id` is laid out as far as `need` (no work). */
  settlementReady(id: number, need: number): boolean
  /** Countryside slots of `cell` (cached; empty for water); null if not computed and past the deadline. */
  farm(cell: number, deadline: number): SlotSet | null
  /** Pieces of port `structureId` built by settlement `owner`, at `pos` on the shore facing seaward `dir` (cached). */
  port(structureId: number, owner: number, pos: ArrayLike<number>, posOffset: number, dir: ArrayLike<number>, dirOffset: number): SlotSet
  /** Dam at `pos` across a river flowing along `dir` (cached by structure id). */
  dam(structureId: number, cell: number, pos: ArrayLike<number>, posOffset: number, dir: ArrayLike<number>, dirOffset: number): SlotSet
}

export function createLayouts(world: World, h: History, lib: ModelLibrary, reservoir: Float32Array | null = null): Layouts {
  const settlements = h.settlements
  const { positions: GP, neighborOffsets: off, neighbors: nb, cellCount } = world.grid
  const seed = world.seed | 0
  const surface = createSurface(world, reservoir)
  const lake = lakeArray(world)
  const water = (i: number) => isWaterCell(world, lake, i)
  const isRiver = (i: number) => world.flow[i] >= RIVER_FLOW_THRESHOLD && world.riverTo[i] >= 0 && !water(i)
  const riverHalfWidth = (f: number) => Math.min(0.0032, 0.0006 + 0.00075 * Math.log(Math.max(f, RIVER_FLOW_THRESHOLD) / RIVER_FLOW_THRESHOLD))
  const spacing = Math.sqrt((4 * Math.PI) / cellCount)
  const N = settlements.length

  const footprint = (m: number) => lib.models[m]?.footprint ?? 0
  const heightOf = (m: number) => lib.models[m]?.height ?? 0
  const has = (m: number) => lib.models[m] != null

  // ---------- what the simulation says about each settlement ----------
  const S = h.snapshotCount
  const peak = new Float32Array(N)
  for (let s = 0; s < S; s++) for (let i = 0; i < N; i++) peak[i] = Math.max(peak[i], h.population[s * N + i])
  const peakWealth = new Float32Array(N)
  if (h.wealth) for (let s = 0; s < S; s++) for (let i = 0; i < N; i++) peakWealth[i] = Math.max(peakWealth[i], h.wealth[s * N + i])
  const wealthRank = new Float32Array(N)
  {
    const ids = Array.from({ length: N }, (_, i) => i).sort((a, b) => peakWealth[a] - peakWealth[b])
    ids.forEach((id, r) => (wealthRank[id] = N > 1 ? r / (N - 1) : 0.5))
  }
  const famine = new Uint8Array(N)
  for (const e of h.events) if (e.type === EventType.Famine && e.settlement >= 0 && e.settlement < N && famine[e.settlement] < 255) famine[e.settlement]++
  // directions out of each settlement: trade routes (weighted by their busiest year), founding and colonising journeys
  const linkCells: number[][] = Array.from({ length: N }, () => [])
  const linkWeights: number[][] = Array.from({ length: N }, () => [])
  const routeCount = new Uint16Array(N)
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
      if (a >= 0 && a < N) { linkCells[a].push(T.path[Math.min(o1 - 1, o0 + 2)]); linkWeights[a].push(w); routeCount[a]++ }
      if (b >= 0 && b < N) { linkCells[b].push(T.path[Math.max(o0, o1 - 3)]); linkWeights[b].push(w); routeCount[b]++ }
    }
  }
  for (let i = 0; i < N; i++) {
    const p = settlements[i].parent
    if (p >= 0 && p < N) {
      linkCells[i].push(settlements[p].cell); linkWeights[i].push(0.8)
      linkCells[p].push(settlements[i].cell); linkWeights[p].push(0.5)
    }
  }
  const portOf = new Int32Array(N).fill(-1)
  for (const st of h.structures) if (st.type === StructureType.Port && st.settlement >= 0 && st.settlement < N && portOf[st.settlement] < 0) portOf[st.settlement] = st.cell

  const styleCache = new Int8Array(N).fill(-1)
  const styleOf = (id: number): StyleT => {
    if (styleCache[id] < 0) styleCache[id] = styleOfCell(world, settlements[id].cell)
    return styleCache[id] as StyleT
  }
  // lineage: the root ancestor picks the settlement's favourite roof (culture travels with settlers)
  const root = new Int32Array(N)
  for (let i = 0; i < N; i++) {
    const p = settlements[i].parent
    root[i] = p >= 0 && p < i ? root[p] : i
  }

  const settlementCell = new Int32Array(cellCount).fill(-1)
  for (const s of settlements) if (settlementCell[s.cell] < 0 || peak[s.id] > peak[settlementCell[s.cell]]) settlementCell[s.cell] = s.id

  // ---------- geometry helpers ----------
  const probe: Probe = { radius: 1, nx: 0, ny: 1, nz: 0, elev: 0, lake: 0, cell: 0 }
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
    return !surface.wet(probe, 0.12)
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
  const writeSlot = (w: SlotWriter, model: number, threshold: number, yaw: number, sink: number, sx: number, sy: number, sz: number, roof: readonly number[], wall: readonly number[], palette = 0, blobScale = 1.2) => {
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
    o = Float64Array.of(ox, oy, oz, coastal ? 1 : 0)
    origins.set(id, o)
    return o
  }

  const stateOf = (id: number): SettlementState => {
    let st = states.get(id)
    if (st) return st
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
      clear(x, y, r) {
        if (!riverClear(segs, x * KK, y * KK, r * KK)) return false
        return dryFootprint(ox, oy, oz, ex, ey, ez, nx, ny, nz, x * KK, y * KK, r * KK, c)
      },
      riverSegs: segsKK,
    }
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
      // the plan's yaw is the model's x axis; KayKit models face +z: put their long side along the street too
      writeSlot(w, model, it.threshold, it.yaw, it.role === Role.Bridge ? 0 : sinkFor(r), sx, sy, sz, roofTmp, wallTmp, 0, it.role === Role.WallSeg ? 0.6 : 1.2)
      w.radius = Math.max(w.radius, Math.hypot(it.x, it.y) * KK + footprint(model) * Math.max(sx, sz))
    }
  }

  function getSettlement(id: number, need: number, deadline: number): { set: SlotSet; done: boolean } | null {
    // a new plan is the costly part: none past the deadline
    if (!states.has(id) && performance.now() > deadline) return null
    const st = stateOf(id)
    const done = st.plan.advance(need, deadline)
    if (st.written < st.plan.items.length) {
      writeItems(id, st)
      st.set = null
    }
    if (!st.set) st.set = st.writer.finish()
    return { set: st.set, done }
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
      avoid.push(tx, ty, townRadius(peak[sid]) * KK + HOUSE_WIDTH)
    }
    addAvoid(cell)
    for (let k = off[cell]; k < off[cell + 1]; k++) addAvoid(nb[k])
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
    for (let k = 0; k < FARM_THRESHOLDS.length; k++) {
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
      const t = 70 + 150 * rand4(seed, cell, k, 0x8f)
      put(m, -t, p[0], p[1], rand4(seed, cell, k, 0x90) * 6.28, 0, 0, sc)
    }
    return w.finish()
  }

  // ---------- ports and dams ----------
  const structCache = new Map<number, SlotSet>()

  function layoutPort(pos: ArrayLike<number>, po: number, dir: ArrayLike<number>, d0: number, owner: number): SlotSet {
    const ox = pos[po], oy = pos[po + 1], oz = pos[po + 2]
    const ol = Math.hypot(ox, oy, oz)
    const ux = ox / ol, uy = oy / ol, uz = oz / ol
    frameAt(ux, uy, uz)
    const sx = dir[d0] * fr.ex + dir[d0 + 1] * fr.ey + dir[d0 + 2] * fr.ez
    const sy = dir[d0] * fr.nx + dir[d0 + 1] * fr.ny + dir[d0 + 2] * fr.nz
    const sl = Math.hypot(sx, sy) || 1
    let fx = sx / sl, fy = sy / sl // seaward
    const ex = fr.ex, ey = fr.ey, ez = fr.ez, nx = fr.nx, ny = fr.ny, nz = fr.nz
    const start = surface.nearestCell(ux, uy, uz, settlements[owner]?.cell ?? 0)
    const w = new SlotWriter()
    const style = owner >= 0 ? styleOf(owner) : Style.Temperate
    const dockLen = (lib.models[Model.Dock]?.size.z ?? 2.5) * MODEL_SPECS[Model.Dock].scale
    const wetAt = (x: number, y: number) => {
      probeAt(ux, uy, uz, ex, ey, ez, nx, ny, nz, x, y, start)
      return surface.wet(probe, 0)
    }
    // the pier starts at the drawn shoreline nearest the port position and reaches out
    let shore = 0
    const stepS = spacing * 0.012
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
    const platforms = ownerPeak >= CITY_POPULATION ? 4 : ownerPeak >= TOWN_POPULATION ? 3 : 2
    // the dock's long axis is its z: yaw puts model x along the shore
    for (let i = 0; i < platforms; i++) {
      const along = shore + dockLen * (0.4 + i * 0.92)
      probeAt(ux, uy, uz, ex, ey, ez, nx, ny, nz, fx * along, fy * along, start)
      writeSlot(w, Model.Dock, 0, seaYaw - Math.PI / 2, heightOf(Model.Dock) * 0.45, 1, 1, 1, zero4, zero3)
    }
    // boats moored alongside, more as the owner grows
    const boats: [number, number, number, number][] = [
      [0.9, 1, Model.Ship, 0],
      [1.6, -1, Model.Ship, 1500],
      [2.4, 1, Model.ShipMedium, TOWN_POPULATION],
      [0.8, -1, Model.Ship, 6000],
      [3.1, -1, Model.ShipMedium, 12000],
    ]
    const pal = 1 + (hash4(seed, owner, 0x51, 0) % 7)
    for (const [along0, side, model, threshold] of boats) {
      if (!has(model)) continue
      if (threshold > ownerPeak && threshold > 0) continue
      const beam = footprint(model) * 0.35 + dockLen * 0.6
      for (let push = 0; push < 4; push++) {
        const a = shore + dockLen * (along0 + push * 0.5)
        const x = fx * a + gx * beam * side, y = fy * a + gy * beam * side
        probeAt(ux, uy, uz, ex, ey, ez, nx, ny, nz, x, y, start)
        if (!surface.wet(probe, 0.3) && push < 3) continue
        // boats lie along the pier, bow out to sea; hulls sink to their waterline
        writeSlot(w, model, threshold, seaYaw - Math.PI / 2, heightOf(model) * 0.08, 1, 1, 1, zero4, zero3, style === Style.Temperate ? pal : 0, 0.9)
        break
      }
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
    settlement: getSettlement,
    settlementReady(id, need) {
      const st = states.get(id)
      if (!st) return false
      // advance() with a past deadline only reports coverage
      return st.plan.advance(need, -1) && st.written >= st.plan.items.length
    },
    farm(cell: number, deadline: number) {
      let s = farmCache.get(cell)
      if (!s) {
        if (performance.now() > deadline) return null
        s = layoutFarm(cell)
        farmCache.set(cell, s)
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
