// Deterministic placement of every model: settlement clusters, farm props and the
// pieces at ports and dams. Each layout is a fixed list of slots, computed once (lazily,
// then cached) from (world.seed, settlement or cell, slot index) and never from the
// current year: the year only decides how many slots are filled. A slot carries its
// instance matrix (on the ground, upright along the local vertical), a matrix for its
// contact shadow, and the population (or land-use) threshold at which it appears.
//
// Settlements follow one building programme: slot k appears once the population reaches
// PROGRAMME[k].threshold, so growth adds buildings in a fixed order and decline (or
// scrubbing back) removes them in reverse. Thresholds jump at TOWN_POPULATION (church,
// market, tavern) and CITY_POPULATION (castle, tower, barracks). Space is handed out in a
// different order (LAYOUT_ORDER: well, then church and market next to it, then houses in
// growth order, then the rest) along a jittered golden-angle spiral, first fit, so a
// village's green is already reserved for the church it may one day build.

import { CITY_POPULATION, RIVER_FLOW_THRESHOLD, TOWN_POPULATION, type Settlement, type World } from '../../contract.ts'
import { isWaterCell, lakeArray } from '../globe.ts'
import { HOUSE_WIDTH, MODEL_SPECS, Model, type ModelLibrary } from './models.ts'
import { createSurface, hash4, rand4, type Probe } from './surface.ts'
import { PALETTE } from './material.ts'

interface ProgrammeItem {
  model: Model
  threshold: number
}

const P = (model: Model, threshold: number): ProgrammeItem => ({ model, threshold })
const T = TOWN_POPULATION
const C = CITY_POPULATION

/** Building programme in growth order; ~5 buildings at the median village, 11 at the largest, 29 for a 10k city. */
export const PROGRAMME: readonly ProgrammeItem[] = [
  P(Model.HomeA, 1),
  P(Model.HomeB, 30),
  P(Model.HomeA, 60),
  P(Model.Well, 100),
  P(Model.HomeB, 160),
  P(Model.HomeA, 260),
  P(Model.HomeA, 420),
  P(Model.HomeB, 660),
  P(Model.HomeA, 1000),
  P(Model.HomeB, 1500),
  P(Model.HomeA, 2200),
  P(Model.Church, T),
  P(Model.Market, T),
  P(Model.Tavern, T),
  P(Model.HomeB, T),
  P(Model.HomeA, 3600),
  P(Model.Blacksmith, 4200),
  P(Model.HomeB, 5000),
  P(Model.HomeA, 5800),
  P(Model.HomeB, 6700),
  P(Model.Lumbermill, 7600),
  P(Model.HomeA, 8600),
  P(Model.HomeB, 9300),
  P(Model.Castle, C),
  P(Model.Tower, C),
  P(Model.Barracks, C),
  P(Model.HomeA, C),
  P(Model.HomeB, 11500),
  P(Model.HomeA, 13000),
  P(Model.Tower, 15000),
  P(Model.HomeB, 17000),
  P(Model.HomeA, 20000),
  P(Model.HomeB, 24000),
  P(Model.HomeA, 29000),
  P(Model.HomeB, 35000),
  P(Model.Church, 42000),
]

/** Order in which programme items claim ground (indices into PROGRAMME). */
const LAYOUT_ORDER: readonly number[] = (() => {
  // well, church, market, the village's houses, tavern, then the city's castle, tower and
  // barracks just outside the village core, then everything else in growth order
  const first = [3, 11, 12, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 13, 23, 24, 25]
  const rest: number[] = []
  for (let k = 0; k < PROGRAMME.length; k++) if (!first.includes(k)) rest.push(k)
  return [...first, ...rest]
})()

/** Land-use thresholds (0..255) of the farm prop slots of a cell. */
const FARM_THRESHOLDS = [70, 170]
const GOLDEN = Math.PI * (3 - Math.sqrt(5))
export const NEVER = 1e9

/** A fixed list of slots (struct of arrays), in fill order. */
export interface SlotSet {
  n: number
  /** Instance matrices (16 floats each, column-major). */
  mat: Float32Array
  /** Contact-shadow matrices (16 floats each). */
  blob: Float32Array
  model: Uint8Array
  threshold: Float32Array
  /** Model height (world units), for the shadow length. */
  height: Float32Array
  palette: Uint8Array
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
  radius = 0
  cx = 0
  cy = 1
  cz = 0
  finish(): SlotSet {
    if (this.model.length === 0) return EMPTY
    return {
      n: this.model.length,
      mat: Float32Array.from(this.mat),
      blob: Float32Array.from(this.blob),
      model: Uint8Array.from(this.model),
      threshold: Float32Array.from(this.threshold),
      height: Float32Array.from(this.height),
      palette: Uint8Array.from(this.palette),
      radius: this.radius,
      cx: this.cx,
      cy: this.cy,
      cz: this.cz,
    }
  }
}

export interface PortPieces {
  /** Dock, ship (always) and second ship (once its settlement is a town). */
  slots: SlotSet
}

export interface Layouts {
  /** Slots of settlement `id`, laid out at least as far as population `need` requires (cached). */
  settlement(id: number, need: number): SlotSet
  /** Farm prop slots of `cell` (cached; empty for water and settlement cells). */
  farm(cell: number): SlotSet
  /** Pieces of port `structureId` built by settlement `owner`, placed at `pos` on the shore facing seaward `dir` (cached). */
  port(structureId: number, owner: number, pos: ArrayLike<number>, posOffset: number, dir: ArrayLike<number>, dirOffset: number): SlotSet
  /** Dam at `pos` across a river flowing along `dir` (cached by structure id). */
  dam(structureId: number, cell: number, pos: ArrayLike<number>, posOffset: number, dir: ArrayLike<number>, dirOffset: number): SlotSet
  /** Team colour of a settlement (by its founding lineage). */
  paletteOf(id: number): number
  /** Cells that are home to some settlement at some time. */
  settlementCell: Uint8Array
}

export function createLayouts(world: World, settlements: Settlement[], lib: ModelLibrary): Layouts {
  const { positions: GP, neighborOffsets: off, neighbors: nb, cellCount } = world.grid
  const seed = world.seed | 0
  const surface = createSurface(world)
  const lake = lakeArray(world)
  const water = (i: number) => isWaterCell(world, lake, i)
  const isRiver = (i: number) => world.flow[i] >= RIVER_FLOW_THRESHOLD && world.riverTo[i] >= 0 && !water(i)
  const riverHalfWidth = (f: number) => Math.min(0.0032, 0.0006 + 0.00075 * Math.log(Math.max(f, RIVER_FLOW_THRESHOLD) / RIVER_FLOW_THRESHOLD))
  const spacing = Math.sqrt((4 * Math.PI) / cellCount)
  /** Settlement clusters stay inside this radius of their cell centre (neighbours are >= 1.35 spacings apart). */
  const maxClusterRadius = 0.6 * spacing
  const spreadClusterRadius = 0.9 * spacing

  const footprint = (m: number) => lib.models[m]?.footprint ?? 0
  const heightOf = (m: number) => lib.models[m]?.height ?? 0

  // lineage colour: the root ancestor's hash picks a palette entry
  const N = settlements.length
  const root = new Int32Array(N)
  for (let i = 0; i < N; i++) {
    const p = settlements[i].parent
    root[i] = p >= 0 && p < i ? root[p] : i
  }
  const paletteOf = (id: number) => 1 + (hash4(seed, root[id], 0x51, 0) % (PALETTE.length - 1))

  const settlementCell = new Uint8Array(cellCount)
  for (const s of settlements) settlementCell[s.cell] = 1

  const probe: Probe = { radius: 1, nx: 0, ny: 1, nz: 0, elev: 0, lake: 0, cell: 0 }
  // tangent frame scratch
  const fr = { ux: 0, uy: 0, uz: 0, ex: 0, ey: 0, ez: 0, nx: 0, ny: 0, nz: 0 }
  const frameAt = (x: number, y: number, z: number) => {
    const l = Math.hypot(x, y, z)
    fr.ux = x / l; fr.uy = y / l; fr.uz = z / l
    // east = Y x up (fallback near the poles)
    let ex = fr.uz, ey = 0, ez = -fr.ux
    let el = Math.hypot(ex, ey, ez)
    if (el < 1e-6) { ex = 1; ey = 0; ez = 0; el = 1 }
    fr.ex = ex / el; fr.ey = ey / el; fr.ez = ez / el
    // north = up x east
    fr.nx = fr.uy * fr.ez - fr.uz * fr.ey
    fr.ny = fr.uz * fr.ex - fr.ux * fr.ez
    fr.nz = fr.ux * fr.ey - fr.uy * fr.ex
  }


  /** River segments near cell c, in its tangent frame (x, y, x, y, halfWidth). */
  const riverSegs: number[] = []
  const collectRivers = (c: number) => {
    riverSegs.length = 0
    frameAt(GP[c * 3], GP[c * 3 + 1], GP[c * 3 + 2])
    const tx = (i: number) => (GP[i * 3] - fr.ux) * fr.ex + (GP[i * 3 + 1] - fr.uy) * fr.ey + (GP[i * 3 + 2] - fr.uz) * fr.ez
    const ty = (i: number) => (GP[i * 3] - fr.ux) * fr.nx + (GP[i * 3 + 1] - fr.uy) * fr.ny + (GP[i * 3 + 2] - fr.uz) * fr.nz
    const add = (q: number) => {
      if (!isRiver(q)) return
      const d = world.riverTo[q]
      riverSegs.push(tx(q), ty(q), tx(d), ty(d), riverHalfWidth(world.flow[q]))
    }
    add(c)
    for (let k = off[c]; k < off[c + 1]; k++) add(nb[k])
  }
  const riverClear = (x: number, y: number, r: number) => {
    for (let i = 0; i < riverSegs.length; i += 5) {
      const ax = riverSegs[i], ay = riverSegs[i + 1], bx = riverSegs[i + 2], by = riverSegs[i + 3]
      const dx = bx - ax, dy = by - ay
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
      if (Math.hypot(x - ax - dx * t, y - ay - dy * t) < r * 0.85 + riverSegs[i + 4] + 0.0003) return false
    }
    return true
  }

  /**
   * Writes a slot (model, threshold) at the point last probed (probe and frame filled by
   * probeAt), facing yaw (radians from east toward north), sunk by `sink` into the ground.
   * `sx` scales the model's x.
   */
  const writeSlot = (w: SlotWriter, model: number, threshold: number, palette: number, yaw: number, sink: number, sx = 1, lift = 0) => {
    const spec = MODEL_SPECS[model]
    const s = spec.scale
    // up = probed direction (frame is at the probe point)
    const cx = Math.cos(yaw), cy = Math.sin(yaw)
    const Xx = fr.ex * cx + fr.nx * cy, Xy = fr.ey * cx + fr.ny * cy, Xz = fr.ez * cx + fr.nz * cy
    const Yx = fr.ux, Yy = fr.uy, Yz = fr.uz
    // Z = X x Y
    const Zx = Xy * Yz - Xz * Yy, Zy = Xz * Yx - Xx * Yz, Zz = Xx * Yy - Xy * Yx
    const r = probe.radius - sink + lift
    w.mat.push(Xx * s * sx, Xy * s * sx, Xz * s * sx, 0, Yx * s, Yy * s, Yz * s, 0, Zx * s, Zy * s, Zz * s, 0, Yx * r, Yy * r, Yz * r, 1)
    // shadow: a disk on the ground triangle, slightly larger than the footprint
    const f = footprint(model) * Math.max(1, sx) * 1.25
    const gx = probe.nx, gy = probe.ny, gz = probe.nz
    let bx = Xx - gx * (Xx * gx + Xy * gy + Xz * gz), by = Xy - gy * (Xx * gx + Xy * gy + Xz * gz), bz = Xz - gz * (Xx * gx + Xy * gy + Xz * gz)
    const bl = Math.hypot(bx, by, bz) || 1
    bx /= bl; by /= bl; bz /= bl
    const cxz = by * gz - bz * gy, cyz = bz * gx - bx * gz, czz = bx * gy - by * gx
    const gr = probe.radius + lift + 2e-5
    w.blob.push(bx * f, by * f, bz * f, 0, gx * f, gy * f, gz * f, 0, cxz * f, cyz * f, czz * f, 0, Yx * gr, Yy * gr, Yz * gr, 1)
    w.model.push(model)
    w.threshold.push(threshold)
    w.height.push(heightOf(model) - sink)
    w.palette.push(palette)
  }

  /** Probe the ground at tangent offset (x, y) from unit vector o (frame e, n); moves the frame there. */
  const probeAt = (ox: number, oy: number, oz: number, ex: number, ey: number, ez: number, nx: number, ny: number, nz: number, x: number, y: number, start: number) => {
    const px = ox + ex * x + nx * y, py = oy + ey * x + ny * y, pz = oz + ez * x + nz * y
    const l = Math.hypot(px, py, pz)
    surface.probe(px / l, py / l, pz / l, start, probe)
    frameAt(px, py, pz)
  }

  /**
   * Whether a footprint of radius r at tangent offset (x, y) is dry land as the planet
   * shader draws it (centre and four points at its rim). Leaves the probe at the centre.
   */
  const dryFootprint = (ox: number, oy: number, oz: number, ex: number, ey: number, ez: number, nx: number, ny: number, nz: number, x: number, y: number, r: number, start: number) => {
    const k = r * 0.8
    for (let i = 0; i < 4; i++) {
      const dx = i === 0 ? k : i === 1 ? -k : 0, dy = i === 2 ? k : i === 3 ? -k : 0
      probeAt(ox, oy, oz, ex, ey, ez, nx, ny, nz, x + dx, y + dy, start)
      if (surface.wet(probe, 0.05)) return false
    }
    probeAt(ox, oy, oz, ex, ey, ez, nx, ny, nz, x, y, start)
    return !surface.wet(probe, 0.15)
  }

  /** Sink a model on a slope so no corner floats: footprint times the ground's tilt. */
  const sinkFor = (model: number) => {
    const cosT = Math.max(0.2, probe.nx * fr.ux + probe.ny * fr.uy + probe.nz * fr.uz)
    const tanT = Math.sqrt(Math.max(0, 1 - cosT * cosT)) / cosT
    return footprint(model) * Math.min(tanT, 0.6) * 0.9 + 0.00004
  }

  // ---------- settlements ----------
  // Layouts grow incrementally: items are placed strictly in LAYOUT_ORDER, and only as far
  // as the largest population asked for so far needs, so a hamlet never pays for the city
  // it might become, and the result is the same however far it has been computed.
  interface SettlementState {
    next: number
    ox: number; oy: number; oz: number
    ex: number; ey: number; ez: number
    nx: number; ny: number; nz: number
    rot: number
    placedX: number[]
    placedY: number[]
    placedR: number[]
    slotModel: Int32Array
    slotX: Float64Array
    slotY: Float64Array
    set: SlotSet | null
  }
  const states = new Map<number, SettlementState>()

  const stateOf = (id: number): SettlementState => {
    let st = states.get(id)
    if (st) return st
    const c = settlements[id].cell
    // a coastal settlement's cluster is centred a little inland (its cell centre is
    // often right on the shore), toward the higher of its dry neighbours
    let ox = GP[c * 3], oy = GP[c * 3 + 1], oz = GP[c * 3 + 2]
    let coastal = false
    let vx = 0, vy = 0, vz = 0
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (water(j)) {
        coastal = true
        continue
      }
      const wgt = Math.max(world.elevation[j], 0.002)
      vx += (GP[j * 3] - ox) * wgt
      vy += (GP[j * 3 + 1] - oy) * wgt
      vz += (GP[j * 3 + 2] - oz) * wgt
    }
    const vl = Math.hypot(vx, vy, vz)
    if (coastal && vl > 0) {
      const k = (COAST_SHIFT * spacing) / vl
      ox += vx * k
      oy += vy * k
      oz += vz * k
      const l = Math.hypot(ox, oy, oz)
      ox /= l
      oy /= l
      oz /= l
    }
    frameAt(ox, oy, oz)
    st = {
      next: 0,
      ox, oy, oz,
      ex: fr.ex, ey: fr.ey, ez: fr.ez, nx: fr.nx, ny: fr.ny, nz: fr.nz,
      rot: rand4(seed, id, 1, 0) * Math.PI * 2,
      placedX: [], placedY: [], placedR: [],
      slotModel: new Int32Array(PROGRAMME.length).fill(-1),
      slotX: new Float64Array(PROGRAMME.length),
      slotY: new Float64Array(PROGRAMME.length),
      set: null,
    }
    states.set(id, st)
    return st
  }

  /** First fit along the spiral within maxR; true if placed. */
  const placeItem = (id: number, st: SettlementState, k: number, maxR: number): boolean => {
    const model = PROGRAMME[k].model
    const c = settlements[id].cell
    const r = footprint(model) * 0.92
    const step = HOUSE_STEP
    const { ox, oy, oz, ex, ey, ez, nx, ny, nz, placedX, placedY, placedR } = st
    for (let j = 0; j < 4000; j++) {
      const rr = step * Math.sqrt(j) * (0.9 + 0.2 * rand4(seed, id, k, j + 7))
      if (rr + r > maxR) break
      const th = st.rot + j * GOLDEN
      const x = rr * Math.cos(th) + (rand4(seed, id, k, j + 11) - 0.5) * step * 0.3
      const y = rr * Math.sin(th) + (rand4(seed, id, k, j + 13) - 0.5) * step * 0.3
      let ok = true
      for (let q = 0; q < placedX.length && ok; q++) if (Math.hypot(x - placedX[q], y - placedY[q]) < r + placedR[q] + HOUSE_GAP) ok = false
      if (!ok || !riverClear(x, y, r)) continue
      if (!dryFootprint(ox, oy, oz, ex, ey, ez, nx, ny, nz, x, y, r, c)) continue
      placedX.push(x)
      placedY.push(y)
      placedR.push(r)
      st.slotModel[k] = model
      st.slotX[k] = x
      st.slotY[k] = y
      return true
    }
    return false
  }

  function getSettlement(id: number, need: number): SlotSet {
    const st = stateOf(id)
    let last = -1
    for (let p = LAYOUT_ORDER.length - 1; p >= 0; p--) {
      if (PROGRAMME[LAYOUT_ORDER[p]].threshold <= need) {
        last = p
        break
      }
    }
    if (st.next <= last) {
      collectRivers(settlements[id].cell)
      for (; st.next <= last; st.next++) {
        const k = LAYOUT_ORDER[st.next]
        if (!lib.models[PROGRAMME[k].model]) continue
        // a cramped site (coast, river mouth) may spread a little further out
        if (!placeItem(id, st, k, maxClusterRadius)) placeItem(id, st, k, spreadClusterRadius)
      }
      st.set = null
    }
    if (!st.set) st.set = writeSettlement(id, st)
    return st.set
  }

  function writeSettlement(id: number, st: SettlementState): SlotSet {
    const c = settlements[id].cell
    const palette = paletteOf(id)
    const { ox, oy, oz, ex, ey, ez, nx, ny, nz } = st
    const w = new SlotWriter()
    w.cx = ox
    w.cy = oy
    w.cz = oz
    for (let k = 0; k < PROGRAMME.length; k++) {
      const model = st.slotModel[k]
      if (model < 0) continue
      const x = st.slotX[k], y = st.slotY[k]
      probeAt(ox, oy, oz, ex, ey, ez, nx, ny, nz, x, y, c)
      // face the centre, loosely (the centre piece faces anywhere)
      const toward = Math.hypot(x, y) > 1e-6 ? Math.atan2(-y, -x) : rand4(seed, id, k, 3) * Math.PI * 2
      const yaw = toward + Math.PI / 2 + (rand4(seed, id, k, 5) - 0.5) * 0.7
      writeSlot(w, model, PROGRAMME[k].threshold, palette, yaw, sinkFor(model))
      w.radius = Math.max(w.radius, Math.hypot(x, y) + footprint(model))
    }
    return w.finish()
  }

  // ---------- farm props ----------
  const farmCache = new Map<number, SlotSet>()
  function layoutFarm(cell: number): SlotSet {
    if (water(cell) || settlementCell[cell]) return EMPTY
    const ox = GP[cell * 3], oy = GP[cell * 3 + 1], oz = GP[cell * 3 + 2]
    collectRivers(cell)
    frameAt(ox, oy, oz)
    const ex = fr.ex, ey = fr.ey, ez = fr.ez, nx = fr.nx, ny = fr.ny, nz = fr.nz
    // keep clear of neighbouring settlement clusters (positions in this cell's tangent frame)
    const avoid: number[] = []
    for (let k = off[cell]; k < off[cell + 1]; k++) {
      const j = nb[k]
      if (!settlementCell[j]) continue
      const tx = (GP[j * 3] - ox) * ex + (GP[j * 3 + 1] - oy) * ey + (GP[j * 3 + 2] - oz) * ez
      const ty = (GP[j * 3] - ox) * nx + (GP[j * 3 + 1] - oy) * ny + (GP[j * 3 + 2] - oz) * nz
      avoid.push(tx, ty, maxClusterRadius)
    }
    const river = isRiver(cell)
    const w = new SlotWriter()
    const px: number[] = [], py: number[] = [], pr: number[] = []
    let windmills = 0
    for (let k = 0; k < FARM_THRESHOLDS.length; k++) {
      let model: number
      const pick = rand4(seed, cell, k, 0x77)
      // haystacks, the odd windmill and grove: countryside, not more villages (no houses)
      if (k === 0 && river) model = Model.Watermill
      else if (pick < 0.24 && windmills === 0) model = Model.Windmill
      else if (pick < 0.86) model = Model.Haystack
      else model = Model.Trees
      if (!lib.models[model]) continue
      const r = footprint(model)
      let placed = false
      for (let attempt = 0; attempt < 10 && !placed; attempt++) {
        let x: number, y: number, yaw: number
        if (model === Model.Watermill && riverSegs.length > 0) {
          // beside this cell's own river segment, wheel toward the water
          const ax = riverSegs[0], ay = riverSegs[1], bx = riverSegs[2], by = riverSegs[3], hw = riverSegs[4]
          const t = 0.18 + 0.25 * rand4(seed, cell, attempt, 0x79)
          const dx = bx - ax, dy = by - ay
          const dl = Math.hypot(dx, dy) || 1
          const side = rand4(seed, cell, attempt, 0x7a) < 0.5 ? -1 : 1
          const o = hw + r * 0.75 + spacing * 0.02
          x = ax + dx * t + (-dy / dl) * o * side
          y = ay + dy * t + (dx / dl) * o * side
          yaw = Math.atan2(dy, dx) + (side > 0 ? Math.PI : 0)
        } else {
          const a = rand4(seed, cell, k * 16 + attempt, 0x7b) * Math.PI * 2
          const rr = spacing * (0.1 + 0.36 * Math.sqrt(rand4(seed, cell, k * 16 + attempt, 0x7c)))
          x = rr * Math.cos(a)
          y = rr * Math.sin(a)
          yaw = rand4(seed, cell, k * 16 + attempt, 0x7d) * Math.PI * 2
          if (!riverClear(x, y, r)) continue
        }
        let ok = true
        for (let q = 0; q < px.length && ok; q++) if (Math.hypot(x - px[q], y - py[q]) < r + pr[q] + HOUSE_GAP * 2) ok = false
        for (let q = 0; q < avoid.length && ok; q += 3) if (Math.hypot(x - avoid[q], y - avoid[q + 1]) < r + avoid[q + 2] + HOUSE_GAP * 2) ok = false
        if (!ok) continue
        if (!dryFootprint(ox, oy, oz, ex, ey, ez, nx, ny, nz, x, y, r, cell)) continue
        writeSlot(w, model, FARM_THRESHOLDS[k], 1 + (hash4(seed, cell, 0x7e, 0) % (PALETTE.length - 1)), yaw, sinkFor(model))
        px.push(x)
        py.push(y)
        pr.push(r)
        placed = true
        if (model === Model.Windmill) windmills++
      }
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
    // tangent coordinates of the seaward direction
    const sx = dir[d0] * fr.ex + dir[d0 + 1] * fr.ey + dir[d0 + 2] * fr.ez
    const sy = dir[d0] * fr.nx + dir[d0 + 1] * fr.ny + dir[d0 + 2] * fr.nz
    const sl = Math.hypot(sx, sy) || 1
    let fx = sx / sl, fy = sy / sl // seaward
    const ex = fr.ex, ey = fr.ey, ez = fr.ez, nx = fr.nx, ny = fr.ny, nz = fr.nz
    const start = surface.nearestCell(ux, uy, uz, settlements[owner]?.cell ?? 0)
    const w = new SlotWriter()
    const pal = owner >= 0 ? paletteOf(owner) : 1
    const dockLen = (lib.models[Model.Dock]?.size.z ?? 2.5) * MODEL_SPECS[Model.Dock].scale
    // The pier starts at the drawn shoreline nearest the port position (searched over a fan
    // of directions landward) and reaches straight out from it, past the port position.
    const wetAt = (x: number, y: number) => {
      probeAt(ux, uy, uz, ex, ey, ez, nx, ny, nz, x, y, start)
      return surface.wet(probe, 0)
    }
    let shore = 0
    if (wetAt(0, 0)) {
      const stepS = spacing * 0.025
      search: for (let i = 1; i <= 36; i++) {
        for (let a = 0; a <= 8; a++) {
          const ang = Math.atan2(-fy, -fx) + (a % 2 ? 1 : -1) * Math.ceil(a / 2) * 0.35
          const x = Math.cos(ang) * i * stepS, y = Math.sin(ang) * i * stepS
          if (!wetAt(x, y)) {
            // re-aim the pier from that shore point out through the port position
            fx = -Math.cos(ang)
            fy = -Math.sin(ang)
            shore = -(i - 0.5) * stepS
            break search
          }
        }
      }
    } else {
      for (let i = 1; i <= 30; i++) if (wetAt(fx * i * spacing * 0.025, fy * i * spacing * 0.025)) { shore = (i - 0.5) * spacing * 0.025; break }
    }
    const gx = -fy, gy = fx // along the shore
    const seaYaw = Math.atan2(fy, fx)
    // a pier of two platforms reaching out from the shore
    for (let i = 0; i < 2; i++) {
      const along = shore + dockLen * (0.35 + i * 0.95)
      probeAt(ux, uy, uz, ex, ey, ez, nx, ny, nz, fx * along, fy * along, start)
      writeSlot(w, Model.Dock, 0, 0, seaYaw, heightOf(Model.Dock) * 0.45)
    }
    // ships moored alongside (the second one once the owner is a town)
    const ships: [number, number, number, number][] = [
      [shore + dockLen * 1.3, 1, Model.Ship, 0],
      [shore + dockLen * 0.9, -1, Model.ShipMedium, TOWN_POPULATION],
    ]
    for (const [along, side, model, threshold] of ships) {
      if (!lib.models[model]) continue
      const beam = footprint(model) * 0.45 + dockLen * 0.55
      for (let push = 0; push < 4; push++) {
        const a = along + push * dockLen * 0.5
        const x = fx * a + gx * beam * side, y = fy * a + gy * beam * side
        probeAt(ux, uy, uz, ex, ey, ez, nx, ny, nz, x, y, start)
        if (!surface.wet(probe, 0.3) && push < 3) continue
        // ships lie along the pier, bow out to sea; hulls sink to their waterline
        writeSlot(w, model, threshold, pal, seaYaw + Math.PI / 2, heightOf(model) * 0.1)
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
    // local z runs downstream: yaw puts X across the river
    const yaw = Math.atan2(sy, sx) - Math.PI / 2
    const hw = riverHalfWidth(world.flow[cell])
    const width = Math.max(HOUSE_WIDTH * 1.5, hw * 3.4)
    const w = new SlotWriter()
    writeSlot(w, Model.Dam, 0, 0, yaw, 0.0001, width / MODEL_SPECS[Model.Dam].scale)
    return w.finish()
  }

  return {
    settlement: getSettlement,
    farm(cell: number) {
      let s = farmCache.get(cell)
      if (!s) {
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
    paletteOf,
    settlementCell,
  }
}

/** Spiral step and the gap kept between neighbouring buildings (world units). */
const HOUSE_STEP = 0.00045
const HOUSE_GAP = 0.0002
/** How far inland (in cell spacings) a coastal settlement's cluster is centred. */
const COAST_SHIFT = 0.2

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
    // dropped below just before this window: still shrinking away
    appear = -NEVER
    disappear = lerpYear(yP, y0, vP, vA)
  } else return false
  out[0] = appear
  out[1] = disappear
  return true
}
