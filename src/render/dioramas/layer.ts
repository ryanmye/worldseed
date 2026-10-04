// The diorama layer: small low-poly models standing on the globe when the camera is close
// (one cell is ~150 km, so true scale would be invisible; these are some 400x true scale).
// Settlement plans (town.ts) and their satellite villages (census.ts: how many people
// the picture shows where; layout.ts villages, each culled on its own and drawn as
// low-detail clusters without facades or shadow-map casting beyond VILLAGE_NEAR), the
// countryside (farmsteads, mills, groves), piers and moored boats at ports, dams,
// bridges, and ships or caravans for groups under way.
//
// Draw calls: one InstancedMesh per model in use (plus one each for the contact shadows,
// travelling ships and carts, and bridges), all sharing one material, whatever the
// settlement count; one merged triangle list for the ground of every town near the view
// (streets, squares, yards, gardens: layout.ts GroundSet); forest stands near the camera
// (groves cleared field by field as the land is farmed); and up close the sun's shadow map
// (shadows.ts: a depth pass of the same batches, redrawn only when the view, sun, year or
// instance set changes, plus one darkening draw of the globe mesh). Empty batches are not
// drawn.
//
// Work per frame is uniform updates only. The instance set (which slots of which nearby
// settlements, farms and structures exist, with their appear / disappear years over the
// current snapshot window) is rebuilt only when the population snapshot or land snapshot
// changes, the camera moves by a fraction of its altitude, a toggle flips, or layout work
// left over from a previous rebuild (plans are computed nearest first under a time budget
// of a few milliseconds per frame) is still pending. Within a window the shader animates
// pop-ins and removals from the year alone, so playback, scrubbing back and a direct load
// at a year all agree. With polity data (ui/politiesData.ts townPolityState, sampled at the
// window's snapshot years) the walls are the history's: rings built and lost in their years,
// slighted rings as weathering ruins, a sack's burnt-out houses (a per-instance year range
// the shader reads), scorched ground and smoke in its year, a capital's palace and banners in
// its polity's colour, a garrison's quarters by the gate. Travelling groups are the one per-frame write (a handful of
// matrices, into preallocated buffers).

import * as THREE from 'three'
import { StructureType, type History, type Structure, type World } from '../../contract.ts'
import { requestRender } from '../invalidate.ts'
import { SUN_DIRECTION, surfaceRadius } from '../globe.ts'
import { createLayouts, crossing, GROUND_MODEL, NEVER, type GroundSet, type Layouts, type SlotSet } from './layout.ts'
import { createGroundMaterial, createModelMaterial, createShadowMaterial, createTownGroundMaterial, createUniforms } from './material.ts'
import { createShadows } from './shadows.ts'
import { closeDetailUniforms, TOWN_MASK_MAX, townMaskUniforms } from './townMask.ts'
import { isFarModel, loadModels, MODEL_COUNT, MODEL_SPECS, Model, styleKindOf, type ModelLibrary } from './models.ts'
import { createSurface, rand4, type Probe } from './surface.ts'
import { FACADE_PACK, FACADE_RISING, FACADE_SMOKE, FACADE_STEADY, FACADE_WORN } from './material.ts'
import { LandmarkPart } from './town.ts'
import { LANDMARK_NEVER, landmarkInUse, landmarkRuined, landmarksOf } from '../../ui/landmarksData.ts'
import { faithsOf } from '../../ui/faithsData.ts'
import { LandmarkKind, LandmarkState } from '../../contract.ts'
import { isHouseKind } from './shapes.ts'
import { politiesOf, SACK_YEARS, tierAt, townPolityState, wallSlighted, type TownPolityState } from '../../ui/politiesData.ts'
import { goodsOf, ownerRgb } from '../../ui/goodsData.ts'
import { WorksKind } from './town.ts'
import { resortQuarters } from './resort.ts'
import { traceAdd } from '../perfTrace.ts'

/**
 * Camera distance (to each instance) at which models are full size, and where they are
 * gone: a house is ~2 px tall at DIORAMA_FAR on an 800 px tall view, so models arrive as
 * tiny hints and grow with the approach rather than popping in large.
 */
export const DIORAMA_NEAR = 0.2
export const DIORAMA_FAR = 0.3
/** Camera distance over which the flat markers step back for the models (models readable: a house ~4-8 px). */
export const DIORAMA_YIELD_NEAR = 0.08
export const DIORAMA_YIELD_FAR = 0.15
/** Milliseconds of layout work per rebuild (nearest settlements and fields first). */
const LAYOUT_BUDGET_MS = 5
/** Camera distance within which forest stands are drawn (they shrink away toward it). */
const FOREST_DIST = 0.075
/** Satellite villages (census.ts): full detail within this camera distance, low-detail clusters beyond. */
const VILLAGE_NEAR = 0.045
/** How far a settlement's villages reach from its cell (world units: its territory, up to 5 hops). */
const VILLAGE_REACH = 0.12
/** Most village instances per rebuild (nearest settlements first). */
const VILLAGE_CAP = 24000

/** Positions of travelling groups, as written each frame by the journey layer (see JourneyLayer.groups). */
export interface TravelGroups {
  count: number
  /** xyz per group (object space, just above the ground). */
  pos: Float32Array
  /** Unit direction of travel per group. */
  dir: Float32Array
  /** kind, size (0..1), at sea (0|1), opacity, per group. */
  info: Float32Array
}

/** Port and dam placements as computed by the structure layer (see StructureLayer.placements). */
export interface StructurePlacements {
  list: Structure[]
  /** xyz per structure: a port at the shore, a dam across its river. */
  pos: Float32Array
  /** Unit tangent: seaward for a port, downstream for a dam. */
  dir: Float32Array
}

export interface LandRows {
  interval: number
  count: number
  landUse: Uint8Array
}

/** Bridges where roads cross rivers, as computed by the road layer (see roads.ts BridgePlacements). */
export interface BridgeInstances {
  count: number
  /** Bridge model (same attributes as the library models; owned by the caller). */
  geometry: THREE.BufferGeometry
  /** Instance matrix (16 floats) per bridge. */
  mat: Float32Array
  /** Ground position per bridge (xyz), for culling. */
  pos: Float32Array
  /** Road level of bridge k at road snapshot s; the bridge stands while it is >= threshold. */
  level(k: number, s: number): number
  threshold: number
  interval: number
  snapshots: number
}

export interface DioramaLayer {
  object: THREE.Group
  setVisible(show: boolean): void
  setStructuresVisible(show: boolean): void
  /** Draw ships and carts for these groups (null or hidden: none). */
  setTravellers(groups: (() => TravelGroups) | null, visible: boolean): void
  /** Draw carts and ships for merchants too; their info[0] is the palette index (null or hidden: none). */
  setTraders(groups: (() => TravelGroups) | null, visible: boolean): void
  /** Bridges to stand up close (null or hidden: none). */
  setBridges(bridges: BridgeInstances | null, visible: boolean): void
  /** Per frame: continuous year and pop-in length in years. */
  setTime(year: number, animYears: number): void
  /** Per frame (cheap unless a rebuild is due). */
  update(camera: THREE.PerspectiveCamera): void
  /**
   * A longer run of the same world replaces the history (same settlements first, more after):
   * the layouts already made are kept, so nothing visible changes at the swap.
   */
  setHistory(inputs: DioramaInputs): void
  /** Whether models are loaded and showing (the flat layers should then yield up close). */
  readonly active: boolean
  /**
   * Settlement whose building cluster is under CSS pixel (x, y) (canvas-relative), or -1:
   * up close the cluster, not just its small marker, is the click target.
   */
  pick(camera: THREE.PerspectiveCamera, x: number, y: number, width: number, height: number): number
  /**
   * Known-world mask (peoples): per cell, the year from which models there stand (1e9 never);
   * null shows all. Applied when the instance set is rebuilt (at least every snapshot).
   */
  setKnownMask(cellYear: Float32Array | null): void
  dispose(): void
}

const ZERO4 = new Float32Array(4)
const ZERO3 = new Float32Array(3)
/** Facade info of a model from the packs (material.ts FACADE_PACK: toned down). */
const PACK_INFO = Float32Array.of(0, 0, 0, FACADE_PACK)
/** A column of smoke's facade info (material.ts FACADE_SMOKE: shown only in its aRuin years). */
const SMOKE_INFO = Float32Array.of(0, 0, 0, FACADE_SMOKE)
/** Polity data: a wall ring builds up over a few years; a slighted ring's ruins weather away over three times the years a sack shows. */
const BUILD_YEARS = 3
const RUIN_YEARS = SACK_YEARS * 3
/** Garrison (men) from which each of a camp's quarters stands. */
const CAMP_MEN = [250, 700, 1500, 3000]
/** Tourism: years over which a resort quarter goes up, piece by piece. */
const RESORT_BUILD_YEARS = 12
/** Generated house models (a sack burns them out). */
const HOUSE_MODEL = new Uint8Array(MODEL_COUNT)
for (let m = 0; m < MODEL_COUNT; m++) {
  const sk = styleKindOf(m)
  if (sk && isHouseKind(sk[1])) HOUSE_MODEL[m] = 1
}
/** Vertex attributes a batch shares with its model. */
const SHARED_ATTRIBUTES = ['position', 'normal', 'aColor', 'aFace', 'aPiece']

/**
 * The ground of every settlement near the view in one triangle list (layout.ts GroundSet
 * pieces with their life years over the snapshot window), rebuilt with the instance set.
 * Interleaved per vertex: position, normal, colour, pattern uv, kind, sack; the life years
 * (appear, disappear) are an attribute of their own.
 *
 * Each settlement keeps its own range of the buffer from one rebuild to the next, whatever
 * order the rebuild visits them in (nearest first, which changes as the camera moves), with
 * every triangle of its set: one not shown in the window has the life (NEVER, NEVER), which
 * the shader drops. So a camera move copies and uploads only the ground of settlements that
 * came into view, and a new snapshot window (playback, scrubbing) rewrites only the life
 * years. A settlement that left the view leaves a hole (hidden by its life years) that is
 * closed up when holes make up much of the buffer. A new history lays everything again.
 */
class TownGround {
  static readonly STRIDE = 14
  data: Float32Array
  life: Float32Array
  buffer: THREE.InterleavedBuffer
  lifeAttr: THREE.BufferAttribute
  geometry = new THREE.BufferGeometry()
  mesh: THREE.Mesh
  /** Vertices in the draw range (live ranges and holes). */
  count = 0
  /** Vertices of live ranges. */
  live = 0
  // per settlement: its range (first vertex, vertex count), what it was laid from, the
  // window its life years are for, its farthest shown vertex, and the rebuild that last kept it
  private entries = new Map<number, { off: number; len: number; n: number; sc: number; window: number; gr: number; pass: number }>()
  /** Room a new range gets beyond its set (a town that grows is laid again in place). */
  static readonly SLACK = 0.25
  private pass = 0
  private epoch = -1
  private window = -1
  /** Vertex ranges written since the last upload (start, end pairs): all attributes, and the life years only. */
  private dirty: number[] = []
  private lifeDirty: number[] = []
  constructor(material: THREE.Material, capacity = 8192) {
    this.data = new Float32Array(capacity * TownGround.STRIDE)
    this.life = new Float32Array(capacity * 2)
    this.buffer = new THREE.InterleavedBuffer(this.data, TownGround.STRIDE).setUsage(THREE.DynamicDrawUsage)
    this.lifeAttr = new THREE.BufferAttribute(this.life, 2).setUsage(THREE.DynamicDrawUsage)
    this.bind()
    this.mesh = new THREE.Mesh(this.geometry, material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 0.5
    this.mesh.visible = false
    this.mesh.name = 'town ground'
  }
  private bind() {
    const b = this.buffer
    this.geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(b, 3, 0))
    this.geometry.setAttribute('aNrm', new THREE.InterleavedBufferAttribute(b, 3, 3))
    this.geometry.setAttribute('aCol', new THREE.InterleavedBufferAttribute(b, 3, 6))
    this.geometry.setAttribute('aUv', new THREE.InterleavedBufferAttribute(b, 2, 9))
    this.geometry.setAttribute('aKind', new THREE.InterleavedBufferAttribute(b, 1, 11))
    this.geometry.setAttribute('aScorch', new THREE.InterleavedBufferAttribute(b, 2, 12))
    this.geometry.setAttribute('aLife', this.lifeAttr)
  }
  private reserve(n: number) {
    const S = TownGround.STRIDE
    if ((this.count + n) * S <= this.data.length) return
    let cap = this.data.length / S
    while (cap < this.count + n) cap *= 2
    const d = new Float32Array(cap * S)
    d.set(this.data.subarray(0, this.count * S))
    this.data = d
    const l = new Float32Array(cap * 2)
    l.set(this.life.subarray(0, this.count * 2))
    this.life = l
    // new GPU buffers of the larger size: everything uploads again
    this.geometry.dispose()
    this.buffer = new THREE.InterleavedBuffer(d, S).setUsage(THREE.DynamicDrawUsage)
    this.lifeAttr = new THREE.BufferAttribute(l, 2).setUsage(THREE.DynamicDrawUsage)
    this.bind()
    this.dirty.length = 0
    this.dirty.push(0, this.count)
  }
  /** Writes the life years of g's triangles at vertex `off` (NEVER, NEVER: not shown); returns the farthest shown vertex from (cx, cy, cz). */
  private writeLife(off: number, g: GroundSet, life: (threshold: number) => Float64Array | null, cx: number, cy: number, cz: number): number {
    let far2 = 0
    const L = this.life
    let lastT = NaN
    let lf: Float64Array | null = null
    for (let v = 0; v + 2 < g.n; v += 3) {
      const t = g.threshold[v]
      if (t !== lastT) {
        lastT = t
        lf = life(t)
      }
      const a = lf ? lf[0] : NEVER, b = lf ? lf[1] : NEVER
      const o = (off + v) * 2
      L[o] = L[o + 2] = L[o + 4] = a
      L[o + 1] = L[o + 3] = L[o + 5] = b
      if (!lf) continue
      const dx = g.pos[v * 3] - cx, dy = g.pos[v * 3 + 1] - cy, dz = g.pos[v * 3 + 2] - cz
      far2 = Math.max(far2, dx * dx + dy * dy + dz * dz)
    }
    return Math.sqrt(far2)
  }
  /**
   * Writes every triangle of g at vertex `off` (the life years from `life(threshold)`, null:
   * not shown) and hides the rest of the range up to `len`; returns the farthest shown vertex from (cx, cy, cz).
   */
  private writeAt(off: number, len: number, g: GroundSet, life: (threshold: number) => Float64Array | null, cx: number, cy: number, cz: number, scorchYear: number, scorch: number): number {
    const n = g.n - (g.n % 3)
    const S = TownGround.STRIDE
    const d = this.data
    this.life.fill(NEVER, (off + n) * 2, (off + len) * 2)
    for (let k = 0; k < n; k++) {
      const o = (off + k) * S
      d[o] = g.pos[k * 3]; d[o + 1] = g.pos[k * 3 + 1]; d[o + 2] = g.pos[k * 3 + 2]
      d[o + 3] = g.nrm[k * 3]; d[o + 4] = g.nrm[k * 3 + 1]; d[o + 5] = g.nrm[k * 3 + 2]
      d[o + 6] = g.col[k * 3]; d[o + 7] = g.col[k * 3 + 1]; d[o + 8] = g.col[k * 3 + 2]
      d[o + 9] = g.uv[k * 2]; d[o + 10] = g.uv[k * 2 + 1]
      d[o + 11] = g.kind[k]
      d[o + 12] = scorchYear; d[o + 13] = scorch
    }
    return this.writeLife(off, g, life, cx, cy, cz)
  }
  /** Starts a rebuild (`epoch`: bumped when the history changes; `window`: the snapshot window the lives are for). */
  begin(epoch: number, window: number) {
    if (epoch !== this.epoch) {
      this.epoch = epoch
      this.entries.clear()
      this.count = 0
      this.live = 0
      this.dirty.length = 0
      this.lifeDirty.length = 0
    }
    this.window = window
    this.pass++
  }
  /** Settlement id's ground for this rebuild: kept where the buffer already holds it (its life years rewritten for a new window), else appended. */
  appendFor(id: number, g: GroundSet, life: (threshold: number) => Float64Array | null, cx: number, cy: number, cz: number, scorchYear = 0, scorch = 0): number {
    const sc = scorchYear * 4 + scorch
    const e = this.entries.get(id)
    if (e && e.n === g.n && e.sc === sc) {
      e.pass = this.pass
      if (e.window !== this.window) {
        e.window = this.window
        e.gr = this.writeLife(e.off, g, life, cx, cy, cz)
        if (e.len > 0) this.lifeDirty.push(e.off, e.off + e.len)
        traceAdd('tg.relife', 1)
      } else traceAdd('tg.kept', 1)
      return e.gr
    }
    const n = g.n - (g.n % 3)
    if (e && n <= e.len) {
      // laid again in its own range
      traceAdd('tg.relaid', 1)
      e.gr = this.writeAt(e.off, e.len, g, life, cx, cy, cz, scorchYear, scorch)
      e.n = g.n
      e.sc = sc
      e.window = this.window
      e.pass = this.pass
      if (e.len > 0) this.dirty.push(e.off, e.off + e.len)
      return e.gr
    }
    traceAdd(e ? 'tg.moved' : 'tg.new', 1)
    if (e) this.free(e)
    const len = n + 3 * Math.floor((n * TownGround.SLACK) / 3)
    this.reserve(len)
    const off = this.count
    this.count += len
    const gr = this.writeAt(off, len, g, life, cx, cy, cz, scorchYear, scorch)
    this.entries.set(id, { off, len, n: g.n, sc, window: this.window, gr, pass: this.pass })
    this.live += len
    if (len > 0) this.dirty.push(off, off + len)
    return gr
  }
  /** Hides a range (its life years: never) and counts it as a hole. */
  private free(e: { off: number; len: number }) {
    this.life.fill(NEVER, e.off * 2, (e.off + e.len) * 2)
    this.live -= e.len
    if (e.len > 0) this.lifeDirty.push(e.off, e.off + e.len)
  }
  /** Ends a rebuild: drops what was not appended again, closes up holes if many, and uploads what changed. */
  end() {
    let tail = 0
    for (const [id, e] of this.entries) {
      if (e.pass !== this.pass) {
        this.free(e)
        this.entries.delete(id)
      } else tail = Math.max(tail, e.off + e.len)
    }
    // holes at the end are simply cut off
    this.count = tail
    if (this.count - this.live > Math.max(24576, this.live)) {
      traceAdd('tg.compact', 1)
      this.compact()
    }
    const n = this.count
    this.geometry.setDrawRange(0, n)
    this.mesh.visible = this.live > 0
    TownGround.upload(this.dirty, n, this.buffer, TownGround.STRIDE)
    TownGround.upload(this.lifeDirty, n, this.lifeAttr, 2)
  }
  /** Uploads the written vertex ranges below n (merged where they overlap or nearly touch). */
  private static upload(D: number[], n: number, target: THREE.InterleavedBuffer | THREE.BufferAttribute, stride: number) {
    const pairs: [number, number][] = []
    for (let i = 0; i < D.length; i += 2) if (D[i] < n) pairs.push([D[i], Math.min(n, D[i + 1])])
    D.length = 0
    if (pairs.length === 0) return
    pairs.sort((a, b) => a[0] - b[0])
    target.clearUpdateRanges()
    let [s0, e0] = pairs[0]
    for (let i = 1; i < pairs.length; i++) {
      const [s, e] = pairs[i]
      if (s <= e0 + 256) e0 = Math.max(e0, e)
      else {
        target.addUpdateRange(s0 * stride, (e0 - s0) * stride)
        s0 = s
        e0 = e
      }
    }
    target.addUpdateRange(s0 * stride, (e0 - s0) * stride)
    target.needsUpdate = true
  }
  /** Moves the live ranges down over the holes (keeping their order) and uploads the lot. */
  private compact() {
    const S = TownGround.STRIDE
    const d = this.data, L = this.life
    const list = [...this.entries.values()].sort((a, b) => a.off - b.off)
    let w = 0
    for (const e of list) {
      if (e.off !== w) {
        d.copyWithin(w * S, e.off * S, (e.off + e.len) * S)
        L.copyWithin(w * 2, e.off * 2, (e.off + e.len) * 2)
      }
      e.off = w
      w += e.len
    }
    this.count = w
    this.live = w
    this.dirty.length = 0
    this.dirty.push(0, w)
    this.lifeDirty.length = 0
    this.lifeDirty.push(0, w)
  }
  dispose() {
    this.geometry.dispose()
  }
}

class Batch {
  mesh: THREE.InstancedMesh
  geometry: THREE.BufferGeometry
  anim: Float32Array
  animAttr: THREE.InstancedBufferAttribute
  roof: Float32Array
  roofAttr: THREE.InstancedBufferAttribute
  wall: Float32Array
  wallAttr: THREE.InstancedBufferAttribute
  info: Float32Array
  infoAttr: THREE.InstancedBufferAttribute
  /** Years a sacked house stands burnt out (0, 0: never). */
  ruin: Float32Array
  ruinAttr: THREE.InstancedBufferAttribute
  count = 0
  capacity: number
  triangles: number

  constructor(source: THREE.BufferGeometry, material: THREE.Material, capacity: number) {
    // share the model's vertex buffers; only the per-instance attributes are this batch's own
    this.geometry = new THREE.BufferGeometry()
    for (const name of SHARED_ATTRIBUTES) {
      const a = source.getAttribute(name)
      if (a) this.geometry.setAttribute(name, a)
    }
    const idx = source.getIndex()
    this.geometry.setIndex(idx)
    this.triangles = (idx ? idx.count : source.getAttribute('position').count) / 3
    this.capacity = capacity
    this.anim = new Float32Array(capacity * 4)
    this.animAttr = new THREE.InstancedBufferAttribute(this.anim, 4).setUsage(THREE.DynamicDrawUsage)
    this.roof = new Float32Array(capacity * 4)
    this.roofAttr = new THREE.InstancedBufferAttribute(this.roof, 4).setUsage(THREE.DynamicDrawUsage)
    this.wall = new Float32Array(capacity * 3)
    this.wallAttr = new THREE.InstancedBufferAttribute(this.wall, 3).setUsage(THREE.DynamicDrawUsage)
    this.info = new Float32Array(capacity * 4)
    this.infoAttr = new THREE.InstancedBufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage)
    this.ruin = new Float32Array(capacity * 2)
    this.ruinAttr = new THREE.InstancedBufferAttribute(this.ruin, 2).setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute('aRuin', this.ruinAttr)
    this.geometry.setAttribute('aAnim', this.animAttr)
    this.geometry.setAttribute('aRoof', this.roofAttr)
    this.geometry.setAttribute('aWall', this.wallAttr)
    this.geometry.setAttribute('aInfo', this.infoAttr)
    this.mesh = new THREE.InstancedMesh(this.geometry, material, capacity)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.visible = false
  }

  /** Room for one more instance (grows rarely, by doubling). */
  private grow() {
    const cap = this.capacity * 2
    const m = new Float32Array(cap * 16)
    m.set(this.mesh.instanceMatrix.array as Float32Array)
    this.mesh.instanceMatrix = new THREE.InstancedBufferAttribute(m, 16).setUsage(THREE.DynamicDrawUsage)
    const a = new Float32Array(cap * 4)
    a.set(this.anim)
    this.anim = a
    this.animAttr = new THREE.InstancedBufferAttribute(a, 4).setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute('aAnim', this.animAttr)
    const r = new Float32Array(cap * 4)
    r.set(this.roof)
    this.roof = r
    this.roofAttr = new THREE.InstancedBufferAttribute(r, 4).setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute('aRoof', this.roofAttr)
    const w = new Float32Array(cap * 3)
    w.set(this.wall)
    this.wall = w
    this.wallAttr = new THREE.InstancedBufferAttribute(w, 3).setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute('aWall', this.wallAttr)
    const f = new Float32Array(cap * 4)
    f.set(this.info)
    this.info = f
    this.infoAttr = new THREE.InstancedBufferAttribute(f, 4).setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute('aInfo', this.infoAttr)
    const ru = new Float32Array(cap * 2)
    ru.set(this.ruin)
    this.ruin = ru
    this.ruinAttr = new THREE.InstancedBufferAttribute(ru, 2).setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute('aRuin', this.ruinAttr)
    this.capacity = cap
  }

  push(mat: ArrayLike<number>, matOffset: number, a: number, b: number, c: number, d: number, roof: ArrayLike<number> = ZERO4, ro = 0, wall: ArrayLike<number> = ZERO3, wo = 0, info: ArrayLike<number> = ZERO4, io = 0, ruinFrom = 0, ruinTo = 0) {
    if (this.count >= this.capacity) this.grow()
    const i = this.count++
    const dst = this.mesh.instanceMatrix.array as Float32Array
    const o = i * 16
    for (let k = 0; k < 16; k++) dst[o + k] = mat[matOffset + k]
    this.anim[i * 4] = a
    this.anim[i * 4 + 1] = b
    this.anim[i * 4 + 2] = c
    this.anim[i * 4 + 3] = d
    for (let k = 0; k < 4; k++) this.roof[i * 4 + k] = roof[ro + k]
    for (let k = 0; k < 3; k++) this.wall[i * 3 + k] = wall[wo + k]
    for (let k = 0; k < 4; k++) this.info[i * 4 + k] = info[io + k]
    this.ruin[i * 2] = ruinFrom
    this.ruin[i * 2 + 1] = ruinTo
  }

  commit() {
    const n = this.count
    this.mesh.count = n
    this.mesh.visible = n > 0
    if (n === 0) return
    const im = this.mesh.instanceMatrix
    im.clearUpdateRanges()
    im.addUpdateRange(0, n * 16)
    im.needsUpdate = true
    for (const [attr, size] of [[this.animAttr, 4], [this.roofAttr, 4], [this.wallAttr, 3], [this.infoAttr, 4], [this.ruinAttr, 2]] as const) {
      attr.clearUpdateRanges()
      attr.addUpdateRange(0, n * size)
      attr.needsUpdate = true
    }
  }

  dispose() {
    this.mesh.dispose()
    // the shared vertex buffers belong to the library: detach them, then free only our own
    for (const name of SHARED_ATTRIBUTES) this.geometry.deleteAttribute(name)
    this.geometry.setIndex(null)
    this.geometry.dispose()
  }
}

export interface DioramaInputs {
  world: World
  history: History
  /** Land-use rows, or null when the history has none. */
  land: LandRows | null
  structures: StructurePlacements | null
  /** Cells flooded behind dams (structures.ts ReservoirCells): kept free of buildings. */
  reservoirs?: { cells: ArrayLike<number>; strength: ArrayLike<number> } | null
}

/** Per-rebuild counts for perf=1 (window.__dioramaStats). */
interface Stats {
  instances: number
  shadows: number
  batches: number
  triangles: number
  settlements: number
  farmCells: number
  pending: boolean
  rebuildMs: number
  /** Travelling ships and carts drawn, and the first of each (object space), for aiming test shots. */
  ships: number
  carts: number
  firstShip: number[]
  firstCart: number[]
  /** Town ground triangles, shadow map draws so far. */
  groundTriangles: number
  shadowRenders: number
  trees: number
  /** Satellite villages drawn, their instances, and how many of those villages were low detail. */
  villages: number
  villageInstances: number
  farVillages: number
  /** Polity data: wall rings and slighted rings drawn, palaces, garrison quarters, burnt-out houses and smoke columns. */
  walls: number
  ruins: number
  palaces: number
  camps: number
  /** Goods: works sets drawn (forges, dyers, warehouses, guild halls, mints, foreign compounds, mine workings) and their pieces. */
  works: number
  workPieces: number
  burnt: number
  smoke: number
  /** Tourism: resort quarters drawn and their pieces. */
  resorts: number
  resortPieces: number
  /** Landmarks: drawn (of them, in a settlement abandoned or empty in the window) and their instances. */
  landmarks: number
  landmarkRuins: number
  landmarkPieces: number
}

export function createDioramaLayer(inputs: DioramaInputs): DioramaLayer {
  const { world } = inputs
  // (not `inputs` itself: a swapped-out history must not stay reachable)
  let { history: h, land, structures, reservoirs } = inputs
  let N = h.settlements.length
  const P = world.grid.positions
  const cellCount = world.grid.cellCount
  const object = new THREE.Group()
  object.name = 'dioramas'
  const uniforms = createUniforms()
  uniforms.uFade.value.set(DIORAMA_NEAR, DIORAMA_FAR)
  const modelMaterial = createModelMaterial(uniforms)
  const shadowMaterial = createShadowMaterial(uniforms)
  const groundMaterial = createGroundMaterial(uniforms)
  const townGroundMaterial = createTownGroundMaterial(uniforms)
  const surface = createSurface(world)
  const townGround = new TownGround(townGroundMaterial)
  object.add(townGround.mesh)
  const shadowSys = createShadows(uniforms)
  object.add(shadowSys.hook)
  object.add(shadowSys.receiver)
  /** Bumped whenever the instance set changes (the shadow map redraws). */
  let instanceVersion = 0
  /** Bumped when the history changes (the town ground is laid again). */
  let groundEpoch = 0

  let lib: ModelLibrary | null = null
  let layouts: Layouts | null = null
  const batches: (Batch | null)[] = new Array(MODEL_COUNT).fill(null)
  let shadows: Batch | null = null
  let ground: Batch | null = null
  let travelShips: Batch | null = null
  let travelCarts: Batch | null = null
  let disposed = false

  let visible = true
  let structuresVisible = true
  let travellers: (() => TravelGroups) | null = null
  let travellersVisible = true
  let traders: (() => TravelGroups) | null = null
  let tradersVisible = true
  /** Known-world mask (see setKnownMask), or null. */
  let knownCells: Float32Array | null = null
  let bridges: BridgeInstances | null = null
  let bridgesVisible = true
  let bridgeBatch: Batch | null = null
  let shownB0 = -1
  let year = 0
  let dirty = true
  let travelDirty = true
  let shownS0 = -1
  let shownL0 = -1
  const lastCam = new THREE.Vector3(1e9, 0, 0)
  const camObj = new THREE.Vector3()
  const fwdObj = new THREE.Vector3()
  const tmpQ = new THREE.Quaternion()
  const objToClip = new THREE.Matrix4()
  const cross = new Float64Array(2)
  const v4 = new THREE.Vector4()
  // settlements with buildings in the current instance set, for picking
  let pickCount = 0
  let pickIds = new Int32Array(64)
  let pickPos = new Float32Array(64 * 4)
  const pickV = new THREE.Vector3()
  const pickR = new THREE.Vector3()
  const pickMvp = new THREE.Matrix4()
  // nearest-first work lists (reused)
  let visIds = new Int32Array(N)
  let visD = new Float32Array(Math.max(N, cellCount))
  const visCells = new Int32Array(cellCount)
  /** Per settlement in the work list: whether its town (not just its villages) can be in view. */
  let visTown = new Uint8Array(N)
  const byDist = (a: number, b: number) => visD[a] - visD[b]
  /** (perf=1) What kept the last rebuild pending. */
  const pendWhy = { vnull: 0, vgen: 0, snull: 0, sgen: 0, farm: 0, forest: 0 }
  const stats: Stats = { instances: 0, shadows: 0, batches: 0, triangles: 0, settlements: 0, farmCells: 0, pending: false, rebuildMs: 0, ships: 0, carts: 0, firstShip: [0, 0, 0], firstCart: [0, 0, 0], groundTriangles: 0, shadowRenders: 0, trees: 0, villages: 0, villageInstances: 0, farVillages: 0, walls: 0, ruins: 0, palaces: 0, camps: 0, works: 0, workPieces: 0, burnt: 0, smoke: 0, resorts: 0, resortPieces: 0, landmarks: 0, landmarkRuins: 0, landmarkPieces: 0 }
  const perfOn = typeof location !== 'undefined' && /[?&]perf=1/.test(location.search)
  // (perf=1: the history, for console expressions over it)
  if (perfOn) (globalThis as unknown as { __dioramaHistory: History }).__dioramaHistory = h
  if (perfOn) {
    (globalThis as unknown as { __dioramaStats: Stats }).__dioramaStats = stats
    ;(globalThis as unknown as { __dioramaPlans: object }).__dioramaPlans = {}
    ;(globalThis as unknown as { __dioramaPending: object }).__dioramaPending = pendWhy
    ;(globalThis as unknown as { __dioramaPierMoved: object }).__dioramaPierMoved = {}
    // (perf=1: latitude and azimuth, as the URL takes them, of landmark lm of settlement id, once its plan is set up)
    ;(globalThis as unknown as { __dioramaLandmarkAim: (id: number, lm: number) => number[] | null }).__dioramaLandmarkAim = (id, lm) => {
      const set = layouts?.landmark(id, lm)
      if (!set || set.n === 0) return null
      const x = set.mat[12], y = set.mat[13], z = set.mat[14], l = Math.hypot(x, y, z)
      return [+((Math.asin(y / l) * 180) / Math.PI).toFixed(4), +((Math.atan2(x / l, z / l) * 180) / Math.PI).toFixed(4)]
    }
    // (perf=1: where landmark lm of settlement id stands on screen, CSS px [x, y], or null off the view)
    ;(globalThis as unknown as { __dioramaLandmarkScreen: (id: number, lm: number) => number[] | null }).__dioramaLandmarkScreen = (id, lm) => {
      const set = layouts?.landmark(id, lm)
      if (!set || set.n === 0) return null
      const p = new THREE.Vector4(set.mat[12], set.mat[13], set.mat[14], 1).applyMatrix4(objToClip)
      if (p.w <= 0) return null
      return [((p.x / p.w + 1) / 2) * innerWidth, ((1 - p.y / p.w) / 2) * innerHeight]
    }


  }

  // owner palette for travelling groups: the journey's origin is not exposed per group, so use a neutral team colour
  const TRAVEL_PALETTE = 2

  let loading = false
  /** Models load on first use, so `models=0` never fetches them. */
  const startLoading = () => {
    if (loading) return
    loading = true
    loadModels().then(onLoaded, (err) => console.warn('dioramas disabled:', err))
  }
  const onLoaded = (l: ModelLibrary) => {
    if (disposed) return
    lib = l
    let res: Float32Array | null = null
    if (reservoirs && reservoirs.cells.length > 0) {
      res = new Float32Array(cellCount)
      const { cells, strength } = reservoirs
      for (let k = 0; k < cells.length; k++) if (cells[k] >= 0 && cells[k] < cellCount) res[cells[k]] = Math.max(res[cells[k]], strength[k] ?? 1)
    }
    // a port town's plan comes down to its harbour (the first port it built)
    const portSite = (id: number) => {
      if (!structures) return null
      const { list, pos, dir } = structures
      for (let k = 0; k < list.length; k++) {
        const st = list[k]
        if (st.type === StructureType.Port && st.settlement === id) return [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], dir[k * 3], dir[k * 3 + 1], dir[k * 3 + 2]] as const
      }
      return null
    }
    layouts = createLayouts(world, h, l, res, portSite)
    ground = new Batch(l.blob, groundMaterial, 128)
    ground.mesh.renderOrder = 0.5
    object.add(ground.mesh)
    for (let m = 0; m < MODEL_COUNT; m++) {
      const entry = l.models[m]
      if (!entry) continue
      batches[m] = new Batch(entry.geometry, modelMaterial, 64)
      object.add(batches[m]!.mesh)
      // (far-away village clusters stay out of the shadow map)
      if (!isFarModel(m) && m !== Model.Smoke) shadowSys.addCaster(batches[m]!.mesh)
    }
    shadows = new Batch(l.blob, shadowMaterial, 256)
    shadows.mesh.renderOrder = 1
    object.add(shadows.mesh)
    const ship = l.models[Model.Ship], cart = l.models[Model.Cart]
    if (ship) {
      travelShips = new Batch(ship.geometry, modelMaterial, 32)
      object.add(travelShips.mesh)
      shadowSys.addCaster(travelShips.mesh)
    }
    if (cart) {
      travelCarts = new Batch(cart.geometry, modelMaterial, 64)
      object.add(travelCarts.mesh)
      shadowSys.addCaster(travelCarts.mesh)
    }
    ensureBridgeBatch()
    dirty = true
    requestRender()
  }

  /** The bridge batch, once the models (and so the shared material's purpose) are live and bridges are known. */
  function ensureBridgeBatch() {
    if (!lib || !bridges || bridgeBatch) return
    bridgeBatch = new Batch(bridges.geometry, modelMaterial, 32)
    object.add(bridgeBatch.mesh)
    shadowSys.addCaster(bridgeBatch.mesh)
  }

  // ---------- snapshot rows ----------
  const interval = h.snapshotInterval
  let lastSnap = h.snapshotCount - 1
  const snapOf = (y: number) => Math.min(lastSnap, Math.max(0, Math.floor(y / interval)))
  const landSnapOf = (y: number) => (land ? Math.min(land.count - 1, Math.max(0, Math.floor(y / land.interval))) : 0)

  /** Distance from the camera if the point (object space) can be on screen within the fade distance, else -1. */
  const viewDist = (x: number, y: number, z: number, radius: number) => {
    const dx = x - camObj.x, dy = y - camObj.y, dz = z - camObj.z
    const d = Math.hypot(dx, dy, dz)
    if (d > DIORAMA_FAR + radius) return -1
    // in front of the horizon
    if (x * dx + y * dy + z * dz > 0.02) return -1
    v4.set(x, y, z, 1).applyMatrix4(objToClip)
    if (v4.w <= -radius) return -1
    const m = 1.6 * Math.max(v4.w, 1e-4) + radius * 4
    if (Math.abs(v4.x) > m || Math.abs(v4.y) > m) return -1
    return d
  }

  /** `far`: a nearer camera distance where the instance is gone (0: the layer's); `blob`: a soft shadow under it. */
  const pushSlots = (slots: SlotSet, k: number, appear: number, disappear: number, far = 0, blob = true, ruinFrom = 0, ruinTo = 0, wall: ArrayLike<number> | null = null) => {
    const model = slots.model[k]
    if (model === GROUND_MODEL) {
      ground?.push(slots.mat, k * 16, appear, disappear, 0, 0, ZERO4, 0, slots.wall, k * 3)
      return
    }
    const b = batches[model]
    if (!b) return
    const spec = MODEL_SPECS[model]
    const lit = spec.lit ? 1 : 0
    const pack = spec.name !== null
    b.push(slots.mat, k * 16, appear, disappear, slots.palette[k], lit + (far > 0 ? 2 * Math.round(far / 0.002) : 0), slots.roof, k * 4, wall ?? slots.wall, wall ? 0 : k * 3, pack ? PACK_INFO : slots.info, pack ? 0 : k * 4, ruinFrom, ruinTo)
    if (blob) shadows?.push(slots.blob, k * 16, appear, disappear, slots.height[k], 0)
  }

  // ---------- polity data (ui/politiesData.ts townPolityState): walls, sacks, capitals, garrisons ----------
  // Sampled at the snapshot years of the window (sP, s0, s1) and combined with the exact years
  // of the structures and events, so the instance set is a pure function of the window: a
  // scrub back, playback and a direct load agree.
  let polStates = new Map<number, TownPolityState | null>()
  const polAt = (id: number, s: number) => {
    const key = id * 8192 + s
    let v = polStates.get(key)
    if (v === undefined) {
      if (polStates.size > 50000) polStates.clear()
      v = townPolityState(h, id, s * interval)
      polStates.set(key, v)
    }
    return v
  }
  /** Where the army that sacked settlement id in a year came from (-1 unknown). */
  let sackFrom: Map<number, number> | null = null
  const sackOrigin = (id: number, year: number) => {
    if (!sackFrom) {
      sackFrom = new Map()
      for (const e of h.events) if ((e.type as number) === 27) sackFrom.set(e.settlement * 8192 + Math.round(e.year), e.other)
    }
    return sackFrom.get(id * 8192 + Math.round(year)) ?? -1
  }
  /**
   * A capital's palace over the years: [year, tier, ...], the palace from each year on at that
   * tier (the largest its polity has reached while ruled from there); it stays, an old
   * palace, when the capital moves on.
   */
  let palaces = new Map<number, number[]>()
  const palaceOf = (id: number): number[] => {
    let out = palaces.get(id)
    if (out) return out
    out = []
    const pd = politiesOf(h)
    if (pd) {
      const periods: [number, number, number][] = []
      for (const x of pd.list) {
        const caps = x.capitals ?? []
        for (let k = 0; k < caps.length; k++) {
          if (caps[k] !== id) continue
          const to = k + 1 < caps.length ? x.capitalYears[k + 1] : x.endedYear >= 0 ? x.endedYear : h.years + 1
          periods.push([x.capitalYears[k], to, x.id])
        }
      }
      periods.sort((a, b) => a[0] - b[0])
      let tier = -1
      for (const [from, to, p] of periods) {
        for (let sn = Math.floor(from / interval); sn * interval < to && sn <= lastSnap; sn++) {
          const t = tierAt(pd, p, sn)
          if (t > tier) {
            out.push(tier < 0 ? from : Math.max(from, sn * interval), t)
            tier = t
          }
        }
      }
    }
    palaces.set(id, out)
    return out
  }
  /** A polity's colour (linear rgb) for banners, or null. */
  const bannerRgb = new Float32Array(3)
  const polColour = (q: number): Float32Array | null => {
    const pd = politiesOf(h)
    if (!pd || q < 0 || q >= pd.count) return null
    for (let c = 0; c < 3; c++) {
      const v = pd.rgb[q * 3 + c]
      bannerRgb[c] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return bannerRgb
  }
  // ---------- goods (ui/goodsData.ts, the tables behind townGoodsState): works in the towns ----------
  // The years each work stands come from the history exactly (industry bits per trade snapshot,
  // the mines and the posts), so the instance set is a pure function of the window like the walls.
  interface Works { kind: number; from: number; to: number; n: number; pop: number; rgb: Float32Array | null; cell: number }
  let worksMap = new Map<number, Works[]>()
  const worksOf = (id: number): Works[] => {
    let out = worksMap.get(id)
    if (out) return out
    out = []
    const gd = goodsOf(h)
    if (gd) {
      const popYear = (y: number) => {
        const sn = Math.max(0, Math.min(lastSnap, Math.round(y / interval)))
        return h.population[sn * N + id]
      }
      // industries: the spans of trade snapshots with a bit set, merged over gaps under 30 years
      const spans = (mask: number, extra: number): [number, number, boolean][] => {
        const res: [number, number, boolean][] = []
        if (!gd.industry) return res
        let from = -1, more = false
        for (let q = 0; q <= gd.TS; q++) {
          const b = q < gd.TS ? gd.industry[q * N + id] : 0
          if (b & mask) {
            if (from < 0) from = q * gd.TI
            if (b & extra) more = true
          } else if (from >= 0) {
            const to = q < gd.TS ? q * gd.TI : NEVER
            const last = res[res.length - 1]
            if (last && from - last[1] < 30) {
              last[1] = to
              last[2] = last[2] || more
            } else res.push([from, to, more])
            from = -1
            more = false
          }
        }
        return res
      }
      for (const [from, to, blades] of spans(2 | 16, 16)) out.push({ kind: WorksKind.Forge, from, to, n: 1 + (blades ? 1 : 0) + (popYear(from) > 8000 ? 1 : 0), pop: popYear(from), rgb: null, cell: -1 })
      for (const [from, to, dye] of spans(4 | 8, 8)) out.push({ kind: WorksKind.Textile, from, to, n: 1 + (dye ? 1 : 0), pop: popYear(from), rgb: null, cell: -1 })
      for (const [from, to] of spans(256, 0)) out.push({ kind: WorksKind.Warehouses, from, to, n: 2, pop: popYear(from), rgb: null, cell: -1 })
      for (const [from, to] of spans(512, 0)) out.push({ kind: WorksKind.Guild, from, to, n: 1, pop: popYear(from), rgb: null, cell: -1 })
      for (const [from, to] of spans(1024, 0)) out.push({ kind: WorksKind.Mint, from, to, n: 1, pop: popYear(from), rgb: null, cell: -1 })
      for (const st of h.structures) if (st.type === StructureType.Mine && st.settlement === id) out.push({ kind: WorksKind.Mine, from: st.builtYear, to: st.lostYear >= 0 ? st.lostYear : NEVER, n: 1, pop: popYear(st.builtYear), rgb: null, cell: st.cell })
      for (const x of gd.postsHosted.get(id) ?? []) {
        const p = gd.posts[x]
        if (p.kind !== 0) continue
        const c = ownerRgb(gd, p.owner, p.foundedYear)
        const rgb = new Float32Array(3)
        for (let k = 0; k < 3; k++) rgb[k] = c[k] <= 0.04045 ? c[k] / 12.92 : Math.pow((c[k] + 0.055) / 1.055, 2.4)
        out.push({ kind: WorksKind.Factory, from: p.foundedYear, to: p.endedYear >= 0 ? p.endedYear : NEVER, n: 1, pop: popYear(p.foundedYear), rgb, cell: -1 })
      }
    }
    worksMap.set(id, out)
    return out
  }
  const GUILD_GOLD = new Float32Array([0.95, 0.62, 0.12])

  // ---------- landmarks (ui/landmarksData.ts): their state spans as instances ----------
  /** Whether settlement id has a landmark begun by year y. */
  const hasLandmarkBy = (d: NonNullable<ReturnType<typeof landmarksOf>>, id: number, y: number) => {
    const ids = d.bySettlement.get(id)
    return !!ids && d.L.begunYear[ids[0]] <= y
  }
  /** The year the first great palace of the history's was begun at settlement id (the polity data's palace gives way to it), else NEVER. */
  const greatPalaceFrom = (d: NonNullable<ReturnType<typeof landmarksOf>>, id: number) => {
    for (const i of d.bySettlement.get(id) ?? []) if (d.L.kind[i] === LandmarkKind.Palace) return d.L.begunYear[i]
    return NEVER
  }
  const lmInfo = new Float32Array(4)
  const lmTrim = new Float32Array(3)
  /** A landmark's trim colour through a span (6 bits a channel, linear, as the material decodes it): its faith's, else its builder's realm's; 0 for none. */
  const trimCode = (d: NonNullable<ReturnType<typeof landmarksOf>>, li: number, faith: number): number => {
    const L = d.L
    const k = L.kind[li]
    const worship = k === LandmarkKind.GreatTemple || k === LandmarkKind.Monastery || k === LandmarkKind.Temple || k === LandmarkKind.Shrine
    let rgb: ArrayLike<number> | null = null
    if (worship && faith >= 0) {
      const fd = faithsOf(h)
      if (fd && faith < fd.F) {
        for (let c = 0; c < 3; c++) { const v = fd.rgb[faith * 3 + c]; lmTrim[c] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
        rgb = lmTrim
      }
    } else if (!worship) rgb = polColour(L.polity[li]) ?? GUILD_GOLD
    if (!rgb) return 0
    const q = (v: number) => Math.max(0, Math.min(63, Math.round(Math.sqrt(Math.max(0, v)) * 63)))
    // (stored as the square root: the material squares it back, for more steps in the darks)
    return Math.max(1, q(rgb[0]) * 4096 + q(rgb[1]) * 64 + q(rgb[2]))
  }
  /**
   * Pushes landmark li's slot set for the window: the building in each state span (rising, standing, worn, ruined; steady, so
   * the spans join without a pop), the scaffold while it is building, the debris of a ruin, and the works (a citadel's wall)
   * from its completion. Its contact shadow once, for its whole life.
   */
  function pushLandmark(d: NonNullable<ReturnType<typeof landmarksOf>>, li: number, set: SlotSet) {
    const L = d.L
    const o0 = d.spanOff[li], o1 = d.spanOff[li + 1]
    const lo = (Math.floor(year / interval) - 1) * interval - 2, hi = (Math.floor(year / interval) + 1) * interval + interval
    const begun = L.begunYear[li]
    const done = L.completedYear[li]
    for (let k = 0; k < set.n; k++) {
      const part = set.threshold[k]
      const model = set.model[k]
      const b = batches[model]
      if (!b) continue
      if (part === LandmarkPart.Building || part === LandmarkPart.Scaffold) {
        for (let o = o0; o < o1; o++) {
          const from = d.spanFrom[o], to = d.spanTo[o], st = d.spanState[o]
          if (to < lo || from > hi) continue
          const building = st === LandmarkState.Building
          if (part === LandmarkPart.Scaffold && !building) continue
          lmInfo[0] = set.info[k * 4]; lmInfo[1] = 0; lmInfo[2] = set.info[k * 4 + 2]
          let flags = FACADE_STEADY, ra = 0, rb = 0
          if (part === LandmarkPart.Building) {
            if (building) {
              flags |= FACADE_RISING
              ra = from; rb = to
              const end = done >= 0 ? done : o + 1 < o1 ? d.spanFrom[o + 1] : begun + 25
              lmInfo[1] = Math.max(1, end - begun)
            } else if (landmarkRuined(st)) { ra = from; rb = to }
            else {
              if (st === LandmarkState.Neglected) flags |= FACADE_WORN
              lmInfo[1] = trimCode(d, li, d.spanFaith[o])
            }
          }
          lmInfo[3] = flags + set.info[k * 4 + 3]
          const lit = landmarkInUse(d.spanState[o]) ? 1 : 0
          b.push(set.mat, k * 16, from, to, 0, lit, set.roof, k * 4, set.wall, k * 3, lmInfo, 0, ra, rb)
          stats.landmarkPieces++
        }
        if (part === LandmarkPart.Building) shadows?.push(set.blob, k * 16, begun, LANDMARK_NEVER, set.height[k], 0)
      } else if (part === LandmarkPart.Outbuilding) {
        // a roofless outbuilding of its neglect (and of its ruin)
        for (let o = o0; o < o1; o++) {
          const from = d.spanFrom[o], to = d.spanTo[o], st = d.spanState[o]
          if ((st !== LandmarkState.Neglected && st !== LandmarkState.Ruined) || to < lo || from > hi) continue
          lmInfo[0] = set.info[k * 4]; lmInfo[1] = 0; lmInfo[2] = set.info[k * 4 + 2]; lmInfo[3] = FACADE_STEADY + set.info[k * 4 + 3]
          b.push(set.mat, k * 16, from, to, 0, 0, set.roof, k * 4, set.wall, k * 3, lmInfo, 0, 0, 0)
          stats.landmarkPieces++
        }
      } else if (part === LandmarkPart.Debris) {

        for (let o = o0; o < o1; o++) {
          const from = d.spanFrom[o], to = d.spanTo[o]
          if (!landmarkRuined(d.spanState[o]) || to < lo || from > hi) continue
          pushSlots(set, k, from + 2, to, 0, false)
          stats.landmarkPieces++
        }
      } else {
        // the works stand from the completion, broken down while the building is a ruin (its first ruin)
        if (done < 0 || done > hi) continue
        let ra = 0, rb = 0
        for (let o = o0; o < o1; o++) if (landmarkRuined(d.spanState[o]) && d.spanFrom[o] >= done) { ra = d.spanFrom[o]; rb = d.spanTo[o]; break }
        pushSlots(set, k, done, LANDMARK_NEVER, 0, true, ra, rb)
        stats.landmarkPieces++
      }
    }
  }


  const smokeMat = new Float32Array(16)
  const sackY = new Float64Array(2), sackShare = new Float64Array(2), sackA = new Float64Array(6)
  const ringIds: number[] = []

  function rebuild() {
    if (!lib || !layouts) return
    const t0 = performance.now()
    // the layout budget counts layout work only (not the instance and ground writes between)
    let spent = 0
    const budget = () => performance.now() + Math.max(0, LAYOUT_BUDGET_MS - spent)
    let tl = 0
    let pending = false
    pendWhy.vnull = pendWhy.vgen = pendWhy.snull = pendWhy.sgen = pendWhy.farm = pendWhy.forest = 0
    for (const b of batches) if (b) b.count = 0
    if (shadows) shadows.count = 0
    if (ground) ground.count = 0
    townGround.begin(groundEpoch, snapOf(year))
    pickCount = 0
    let masks = 0
    stats.settlements = 0
    stats.farmCells = 0
    stats.trees = 0
    stats.villages = 0
    stats.villageInstances = 0
    stats.farVillages = 0
    stats.walls = stats.ruins = stats.palaces = stats.camps = stats.burnt = stats.smoke = stats.works = stats.workPieces = stats.resorts = stats.resortPieces = 0
    stats.landmarks = stats.landmarkRuins = stats.landmarkPieces = 0
    const lmd = landmarksOf(h)
    const alt = camObj.length() - 1
    if (visible && alt < DIORAMA_FAR) {
      const s0 = snapOf(year)
      const s1 = Math.min(lastSnap, s0 + 1)
      const sP = Math.max(0, s0 - 1)
      const y0 = s0 * interval, y1 = s1 * interval, yP = sP * interval
      const pop = h.population
      // ---- settlements, nearest first ----
      let nv = 0
      for (let id = 0; id < N; id++) {
        const pA = pop[s0 * N + id], pB = pop[s1 * N + id], pP = pop[sP * N + id]
        // (an empty or abandoned site still shows its landmarks: the ruin alone in the landscape)
        if (pA <= 0 && pB <= 0 && pP <= 0 && !(lmd && hasLandmarkBy(lmd, id, y1 + interval))) continue
        if ((h.settlements[id] as { outpost?: boolean }).outpost === true) continue // an expedition base is a camp (outposts.ts), not a town
        const c = h.settlements[id].cell
        if (knownCells && knownCells[c] > year) continue // unknown to the people whose world is shown
        const r = surfaceRadius(world, c)
        // the town near its cell; its villages over its territory
        const dT = viewDist(P[c * 3] * r, P[c * 3 + 1] * r, P[c * 3 + 2] * r, 0.02)
        const dV = Math.max(pA, pB, pP) > 300 ? viewDist(P[c * 3] * r, P[c * 3 + 1] * r, P[c * 3 + 2] * r, VILLAGE_REACH) : -1
        if (dT < 0 && dV < 0) continue
        visIds[nv++] = id
        visD[id] = dT >= 0 ? dT : dV
        visTown[id] = dT >= 0 ? 1 : 0
      }
      visIds.subarray(0, nv).sort(byDist)
      for (let q = 0; q < nv; q++) {
        const id = visIds[q]
        const pA = pop[s0 * N + id], pB = pop[s1 * N + id], pP = pop[sP * N + id]
        const s = h.settlements[id]
        const r = surfaceRadius(world, s.cell)
        const end = s.abandonedYear >= 0 ? s.abandonedYear : NEVER
        // its satellite villages and hamlets (census.ts): each culled on its own, low detail far away
        tl = performance.now()
        const vg = layouts.villages(id, budget())
        spent += performance.now() - tl
        if (!vg) { pending = true; pendWhy.vnull++ } else {
          if (!vg.done) { pending = true; pendWhy.vgen++ }
          const V = vg.set
          for (let v = 0; v < V.n && stats.villageInstances < VILLAGE_CAP; v++) {
            const vc = V.cell[v]
            if (knownCells && knownCells[vc] > year) continue
            const vr = surfaceRadius(world, vc)
            const d = viewDist(V.centre[v * 3] * vr, V.centre[v * 3 + 1] * vr, V.centre[v * 3 + 2] * vr, V.radius[v])
            if (d < 0) continue
            const close = d < VILLAGE_NEAR
            const set = close ? V.nearSet : V.farSet
            const range = close ? V.near : V.far
            let any = false
            for (let k = range[v * 2]; k < range[v * 2 + 1]; k++) {
              if (!crossing(set.threshold[k], pP, pA, pB, yP, y0, y1, cross)) continue
              const appear = Math.max(cross[0], s.foundedYear)
              const disappear = Math.min(cross[1], end)
              if (appear >= disappear) continue
              pushSlots(set, k, appear, disappear, 0, close)
              stats.villageInstances++
              any = true
            }
            if (any) {
              stats.villages++
              if (!close) stats.farVillages++
            }
          }
        }
        if (!visTown[id]) continue
        tl = performance.now()
        const got = layouts.settlement(id, Math.max(pA, pB, pP), budget())
        spent += performance.now() - tl
        if (!got) {
          { pending = true; pendWhy.snull++ }
          continue
        }
        if (!got.done) { pending = true; pendWhy.sgen++ }
        const slots = got.set
        stats.settlements++
        if (slots.n > 0) {
          if (pickCount === pickIds.length) {
            const ids = new Int32Array(pickCount * 2)
            ids.set(pickIds)
            pickIds = ids
            const pp = new Float32Array(pickCount * 8)
            pp.set(pickPos)
            pickPos = pp
          }
          pickIds[pickCount] = id
          pickPos[pickCount * 4] = slots.cx * r
          pickPos[pickCount * 4 + 1] = slots.cy * r
          pickPos[pickCount * 4 + 2] = slots.cz * r
          pickPos[pickCount * 4 + 3] = Math.max(slots.radius, 0.0015)
          pickCount++
        }
        // ---- polity data: the town's state at the window's snapshot years ----
        const pd = politiesOf(h)
        const stP = pd ? polAt(id, sP) : null, st0 = pd ? polAt(id, s0) : null, st1 = pd ? polAt(id, s1) : null
        // sacks showing in the window (newest last): a share of the houses standing then burns,
        // more on the side the army came from, and they are rebuilt one by one over the years after
        let nSack = 0
        if (st1) {
          for (const st of [stP, st1]) {
            if (!st || st.sackedYear < 0 || st.sackedYear + SACK_YEARS <= yP) continue
            if (nSack > 0 && sackY[nSack - 1] === st.sackedYear) continue
            const Y = st.sackedYear
            sackY[nSack] = Y
            sackShare[nSack] = Math.min(0.8, 0.2 + 1.8 * Math.max(0, st.sackLoss))
            sackA[nSack * 3] = sackA[nSack * 3 + 1] = sackA[nSack * 3 + 2] = 0
            const o = sackOrigin(id, Y)
            if (o >= 0 && o < N && o !== id) {
              const oc = h.settlements[o].cell
              let ax = P[oc * 3] - slots.cx, ay = P[oc * 3 + 1] - slots.cy, az = P[oc * 3 + 2] - slots.cz
              const d = ax * slots.cx + ay * slots.cy + az * slots.cz
              ax -= slots.cx * d; ay -= slots.cy * d; az -= slots.cz * d
              const l = Math.hypot(ax, ay, az)
              if (l > 1e-9) { sackA[nSack * 3] = ax / l; sackA[nSack * 3 + 1] = ay / l; sackA[nSack * 3 + 2] = az / l }
            }
            nSack++
          }
        }
        const smokeBatch = batches[Model.Smoke]
        let smokes = 0
        for (let k = 0; k < slots.n; k++) {
          if (!crossing(slots.threshold[k], pP, pA, pB, yP, y0, y1, cross)) continue
          const appear = Math.max(cross[0], s.foundedYear)
          const disappear = Math.min(cross[1], end)
          if (appear >= disappear) continue
          let ra = 0, rb = 0
          if (nSack > 0 && HOUSE_MODEL[slots.model[k]]) {
            const o = k * 16
            const mx = slots.mat[o + 12], my = slots.mat[o + 13], mz = slots.mat[o + 14]
            const ml = Math.hypot(mx, my, mz)
            const dx = mx / ml - slots.cx, dy = my / ml - slots.cy, dz = mz / ml - slots.cz
            const dl = Math.hypot(dx, dy, dz) || 1
            for (let q = 0; q < nSack; q++) {
              const Y = sackY[q]
              if (appear > Y || disappear <= Y) continue
              const bias = (dx * sackA[q * 3] + dy * sackA[q * 3 + 1] + dz * sackA[q * 3 + 2]) / dl
              const u = rand4(world.seed | 0, id, k, Y)
              const pb = sackShare[q] * (1 + 0.75 * bias)
              if (u >= pb) continue
              ra = Y
              rb = Y + SACK_YEARS * (0.12 + 0.88 * rand4(world.seed | 0, id, k, Y + 4099))
              // smoke over a few of them in the year of the sack
              if (smokeBatch && u < pb * 0.14 && smokes < 8 && Y >= yP - 2 && Y <= y1 + interval) {
                const up = [mx / ml, my / ml, mz / ml]
                let xx = slots.mat[o], xy = slots.mat[o + 1], xz = slots.mat[o + 2]
                const xl = Math.hypot(xx, xy, xz) || 1
                xx /= xl; xy /= xl; xz /= xl
                const zx = xy * up[2] - xz * up[1], zy = xz * up[0] - xx * up[2], zz = xx * up[1] - xy * up[0]
                const sc = MODEL_SPECS[Model.Smoke].scale * (0.9 + 0.5 * rand4(world.seed | 0, id, k, 0x5a0))
                smokeMat.set([xx * sc, xy * sc, xz * sc, 0, up[0] * sc, up[1] * sc, up[2] * sc, 0, zx * sc, zy * sc, zz * sc, 0, mx, my, mz, 1])
                smokeBatch.push(smokeMat, 0, -NEVER, NEVER, 0, 0, ZERO4, 0, ZERO3, 0, SMOKE_INFO, 0, Y, Y + 1.2)
                smokes++
              }
            }
            if (rb > yP) stats.burnt++
          }
          pushSlots(slots, k, appear, disappear, 0, true, ra, rb)
        }
        stats.smoke += smokes
        // the settlement's streets, squares and yards, with its houses; the road ribbons give way inside them
        if (got.ground.n > 0) {
          const gr = townGround.appendFor(id, got.ground, (t) => {
            if (!crossing(t, pP, pA, pB, yP, y0, y1, cross)) return null
            cross[0] = Math.max(cross[0], s.foundedYear)
            cross[1] = Math.min(cross[1], end)
            return cross[0] < cross[1] ? cross : null
          }, slots.cx * r, slots.cy * r, slots.cz * r, nSack > 0 ? sackY[nSack - 1] : 0, nSack > 0 ? Math.min(1, sackShare[nSack - 1] * 2.2) : 0)
          if (gr > 0 && masks < TOWN_MASK_MAX) {
            townMaskUniforms.uTowns.value[masks].set(slots.cx * r, slots.cy * r, slots.cz * r, gr * 0.95)
            masks++
          }
          if (gr > 0 && pickCount > 0 && pickIds[pickCount - 1] === id) pickPos[(pickCount - 1) * 4 + 3] = Math.max(pickPos[(pickCount - 1) * 4 + 3], gr)
        }
        if (st1 && pd) {
          // banners in the colour of the town's polity, changing with it within the window
          const q1 = st1.polity, qP = stP ? stP.polity : q1
          let change = NEVER
          if (qP !== q1) {
            change = y0
            for (const y of pd.changesOf.get(id) ?? []) if (y > yP && y <= y1) { change = y; break }
          }
          const push = (set: SlotSet, k: number, appear: number, disappear: number) => {
            appear = Math.max(appear, s.foundedYear)
            disappear = Math.min(disappear, end)
            if (appear >= disappear) return
            if (set.model[k] !== Model.Banner) { pushSlots(set, k, appear, disappear); return }
            const a = polColour(qP)
            if (a && appear < Math.min(change, disappear)) pushSlots(set, k, appear, Math.min(change, disappear), 0, false, 0, 0, a)
            const b = change < NEVER ? polColour(q1) : null
            if (b && Math.max(appear, change) < disappear) pushSlots(set, k, Math.max(appear, change), disappear, 0, false, 0, 0, b)
          }
          // wall rings: built (a few years' build-up) and lost when the history says; a slighted
          // ring's ruins weather away; each round the town as it stood the year it was built
          ringIds.length = 0
          for (const st of [stP, st0, st1]) {
            if (!st) continue
            for (const w of st.walls) if (!ringIds.includes(w.id)) ringIds.push(w.id)
            for (const w of st.ruinedWalls) if (!ringIds.includes(w.id)) ringIds.push(w.id)
          }
          let outer = -1, outerPop = 0
          for (const sid of ringIds) {
            const S = h.structures[sid]
            const pop = layouts.wallPop(id, sid)
            if (!S || pop <= 0) continue
            const lost = S.lostYear >= 0 ? S.lostYear : NEVER
            tl = performance.now()
            const ring = layouts.townExtra(id, `w${sid}:${Math.round(pop)}`, (p) => p.wallRing(pop, budget()))
            spent += performance.now() - tl
            if (!ring) { pending = true; continue }
            if (lost > yP - 2) {
              for (let k = 0; k < ring.n; k++) push(ring, k, S.builtYear + ring.threshold[k] * BUILD_YEARS, lost)
              stats.walls++
            }
            if (lost < NEVER && lost <= y1 + interval && lost + RUIN_YEARS > yP && wallSlighted(pd, id, S.lostYear)) {
              tl = performance.now()
              const ruin = layouts.townExtra(id, `r${sid}:${Math.round(pop)}`, (p) => p.ruinRing(pop, budget()))
              spent += performance.now() - tl
              if (!ruin) { pending = true; continue }
              for (let k = 0; k < ruin.n; k++) push(ruin, k, lost, lost + RUIN_YEARS * (0.2 + 0.8 * ruin.threshold[k]))
              stats.ruins++
            }
            if (S.builtYear <= y1 && lost > y1 && pop > outerPop) { outer = sid; outerPop = pop }
          }
          // a capital's palace, from the year it became one (an old palace once the capital moves), until a great palace
          // of the history's (landmarks data) is begun in its ward
          const pal = palaceOf(id)
          const palEnd = lmd ? greatPalaceFrom(lmd, id) : NEVER
          for (let q = 0; q < pal.length; q += 2) {
            const from = pal[q], to = Math.min(palEnd, q + 2 < pal.length ? pal[q + 2] : NEVER)
            if (from >= to) continue
            if (from > y1 + interval || to < yP - 2) continue
            const tier = pal[q + 1]
            tl = performance.now()
            const set = layouts.townExtra(id, `p${tier}`, (p) => p.palace(tier))
            spent += performance.now() - tl
            if (!set) { pending = true; continue }
            for (let k = 0; k < set.n; k++) push(set, k, from, to)
            stats.palaces++
          }
          // a garrison's quarters outside the main gate of its outermost wall (or at the town's edge), one more for each step in its size
          const gP = stP ? stP.garrison : 0, g0 = st0 ? st0.garrison : 0, g1 = st1.garrison
          if (Math.max(gP, g0, g1) >= CAMP_MEN[0]) {
            tl = performance.now()
            const set = layouts.townExtra(id, `c${outer}:${Math.round(outerPop)}`, (p) => p.camp(outerPop, CAMP_MEN.length))
            spent += performance.now() - tl
            if (!set) pending = true
            else {
              // (a village staging an army keeps it in a quarter or two by the road)
              const most = pA < 1000 ? 1 : pA < 3000 ? 2 : CAMP_MEN.length
              for (let k = 0; k < set.n; k++) {
                const j = Math.min(CAMP_MEN.length - 1, Math.round(set.threshold[k]))
                if (j >= most || !crossing(CAMP_MEN[j], gP, g0, g1, yP, y0, y1, cross)) continue
                push(set, k, cross[0], cross[1])
                stats.camps++
              }
            }
          }
        }
        // ---- goods: forges, dyers, warehouses, a guild hall, a mint, a foreign compound, mine workings ----
        const allWorks = worksOf(id)
        let kinds = 0
        for (const wk of allWorks) kinds |= 1 << wk.kind
        for (const wk of allWorks) {
          const from = Math.max(wk.from, s.foundedYear), to = Math.min(wk.to, end)
          if (from >= to || from > y1 + interval || to < yP - 2) continue
          const angle = wk.cell >= 0 ? layouts.angleTo(id, wk.cell) : 0
          tl = performance.now()
          const set = layouts.townExtra(id, `g${wk.kind}:${kinds}:${Math.round(wk.pop / 250)}:${wk.n}:${wk.cell >= 0 ? Math.round(angle * 20) : 0}`, (p) => p.works(wk.kind, wk.pop, wk.n, angle, kinds))
          spent += performance.now() - tl
          if (!set) { pending = true; continue }
          stats.works++
          stats.workPieces += set.n
          for (let k = 0; k < set.n; k++) {
            if (set.model[k] === Model.Banner) pushSlots(set, k, from, to, 0, false, 0, 0, wk.rgb ?? GUILD_GOLD)
            else pushSlots(set, k, from, to)
          }
        }
        // ---- landmarks (ui/landmarksData.ts): each at its place, in its state over the years; it outlives the town's fortunes ----
        if (lmd) {
          const ids = lmd.bySettlement.get(id)
          if (ids) for (const li of ids) {
            const L = lmd.L
            if (L.begunYear[li] > y1 + interval) break
            tl = performance.now()
            const set = layouts.landmark(id, li)
            spent += performance.now() - tl
            if (!set) { pending = true; continue }
            stats.landmarks++
            if (pA <= 0 && pB <= 0) stats.landmarkRuins++
            pushLandmark(lmd, li, set)
          }
        }
        // ---- tourism (resort.ts): a resort quarter from the year it became one; its boats out while visitors come ----
        const rq = resortQuarters(world, h)[id]
        const rFrom = rq ? Math.max(rq.from, s.foundedYear) : NEVER
        if (rq && rFrom < end && rFrom <= y1 + interval) {
          tl = performance.now()
          const set = layouts.townExtra(id, `t${Math.round(rq.pop / 250)}:${rq.lodges}:${rq.villas}:${rq.boats}:${rq.bath ? 1 : 0}${rq.shore ? 1 : 0}:${kinds}`, (p) => p.resort(rq.pop, rq, kinds, budget()))
          spent += performance.now() - tl
          if (!set) pending = true
          else {
            stats.resorts++
            for (let k = 0; k < set.n; k++) {
              const m = set.model[k]
              if (m === Model.Boat || m === Model.FishingBoat) {
                const B = rq.busy
                for (let b = 0; b < B.length; b += 2) {
                  const a = Math.max(B[b], rFrom), z = Math.min(B[b + 1], end)
                  if (a >= z || a > y1 + interval || z < yP - 2) continue
                  pushSlots(set, k, a, z)
                  stats.resortPieces++
                }
              } else {
                pushSlots(set, k, rFrom + set.threshold[k] * RESORT_BUILD_YEARS, end)
                stats.resortPieces++
              }
            }
          }
        }
      }
      // ---- the countryside: farmsteads on cultivated land, groves on wild land ----
      {
        const l0 = landSnapOf(year)
        const l1 = land ? Math.min(land.count - 1, l0 + 1) : 0
        const lP = Math.max(0, l0 - 1)
        const li = land ? land.interval : 1
        const ly0 = l0 * li, ly1 = l1 * li, lyP = lP * li
        const U = land ? land.landUse : null
        let nc = 0
        for (let c = 0; c < cellCount; c++) {
          if (world.elevation[c] < 0) continue
          if (knownCells && knownCells[c] > year) continue
          const r = surfaceRadius(world, c)
          const d = viewDist(P[c * 3] * r, P[c * 3 + 1] * r, P[c * 3 + 2] * r, 0.014)
          if (d < 0) continue
          visCells[nc++] = c
          visD[c] = d
        }
        visCells.subarray(0, nc).sort(byDist)
        for (let q = 0; q < nc; q++) {
          const c = visCells[q]
          tl = performance.now()
          const slots = layouts.farm(c, budget())
          spent += performance.now() - tl
          if (!slots) {
            { pending = true; pendWhy.farm++ }
            continue
          }
          stats.farmCells++
          const uA = U ? U[l0 * cellCount + c] : 0, uB = U ? U[l1 * cellCount + c] : 0, uP = U ? U[lP * cellCount + c] : 0
          for (let k = 0; k < slots.n; k++) {
            const t = slots.threshold[k]
            // negative thresholds: groves, standing while the land is wilder than -t
            const ok = t >= 0 ? crossing(t, uP, uA, uB, lyP, ly0, ly1, cross) : crossing(255 + t, 255 - uP, 255 - uA, 255 - uB, lyP, ly0, ly1, cross)
            if (!ok) continue
            pushSlots(slots, k, cross[0], cross[1])
          }
        }
        // forest stands close to the camera (nearest cells first), fading out by FOREST_DIST
        for (let q = 0; q < nc; q++) {
          const c = visCells[q]
          if (visD[c] > FOREST_DIST + 0.018) break
          tl = performance.now()
          const slots = layouts.forest(c, budget())
          spent += performance.now() - tl
          if (!slots) {
            { pending = true; pendWhy.forest++ }
            continue
          }
          const uA = U ? U[l0 * cellCount + c] : 0, uB = U ? U[l1 * cellCount + c] : 0, uP = U ? U[lP * cellCount + c] : 0
          for (let k = 0; k < slots.n; k++) {
            const t = slots.threshold[k]
            if (!crossing(255 + t, 255 - uP, 255 - uA, 255 - uB, lyP, ly0, ly1, cross)) continue
            pushSlots(slots, k, cross[0], cross[1], FOREST_DIST, false)
            stats.trees++
          }
        }
      }
      // ---- ports and dams ----
      if (structures && structuresVisible) {
        const { list, pos, dir } = structures
        for (let k = 0; k < list.length; k++) {
          const st = list[k]
          // only ports and dams here (walls belong to the town: see ui/politiesData.ts townPolityState)
          if (st.type !== StructureType.Port && st.type !== StructureType.Dam) continue
          if (st.builtYear > y1 + interval) continue
          const lost = st.lostYear >= 0 ? st.lostYear : NEVER
          if (lost < yP) continue
          if (knownCells && knownCells[st.cell] > year) continue
          if (viewDist(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], 0.006) < 0) continue
          const isPort = st.type === StructureType.Port
          const slots = isPort ? layouts.port(st.id, st.settlement, pos, k * 3, dir, k * 3) : layouts.dam(st.id, st.cell, pos, k * 3, dir, k * 3)
          const owner = st.settlement >= 0 && st.settlement < N ? st.settlement : -1
          for (let q = 0; q < slots.n; q++) {
            let appear = st.builtYear
            let disappear = lost
            const t = slots.threshold[q]
            if (t > 0) {
              // further boats wait for their owner to grow
              if (owner < 0) continue
              if (!crossing(t, pop[sP * N + owner], pop[s0 * N + owner], pop[s1 * N + owner], yP, y0, y1, cross)) continue
              appear = Math.max(appear, cross[0])
              disappear = Math.min(disappear, cross[1])
              if (appear >= disappear) continue
            }
            pushSlots(slots, q, appear, disappear)
          }
        }
      }
    }
    // ---- bridges where roads cross rivers (road level as farms use land use) ----
    if (bridgeBatch) {
      bridgeBatch.count = 0
      if (visible && bridges && bridgesVisible && alt < DIORAMA_FAR) {
        const B = bridges
        const b0 = Math.min(B.snapshots - 1, Math.max(0, Math.floor(year / B.interval)))
        const b1 = Math.min(B.snapshots - 1, b0 + 1)
        const bP = Math.max(0, b0 - 1)
        for (let k = 0; k < B.count; k++) {
          if (viewDist(B.pos[k * 3], B.pos[k * 3 + 1], B.pos[k * 3 + 2], 0.004) < 0) continue
          // inside a town its own bridges stand (and the road gives way to its streets)
          let inTown = false
          for (let q = 0; q < pickCount && !inTown; q++) {
            const dx = B.pos[k * 3] - pickPos[q * 4], dy = B.pos[k * 3 + 1] - pickPos[q * 4 + 1], dz = B.pos[k * 3 + 2] - pickPos[q * 4 + 2]
            if (dx * dx + dy * dy + dz * dz < (pickPos[q * 4 + 3] + 0.001) ** 2) inTown = true
          }
          if (inTown) continue
          if (!crossing(B.threshold, B.level(k, bP), B.level(k, b0), B.level(k, b1), bP * B.interval, b0 * B.interval, b1 * B.interval, cross)) continue
          bridgeBatch.push(B.mat, k * 16, cross[0], cross[1], 0, 0)
        }
      }
      bridgeBatch.commit()
    }
    let inst = 0, used = 0, tris = 0
    for (const b of batches) {
      if (!b) continue
      b.commit()
      if (b.count > 0) {
        inst += b.count
        used++
        tris += b.count * b.triangles
      }
    }
    shadows?.commit()
    ground?.commit()
    townGround.end()
    townMaskUniforms.uTownCount.value = masks
    instanceVersion++
    stats.groundTriangles = townGround.live / 3
    stats.instances = inst + (ground?.count ?? 0) + (bridgeBatch?.count ?? 0)
    stats.shadows = shadows?.count ?? 0
    stats.batches = used + (shadows && shadows.count > 0 ? 1 : 0) + (ground && ground.count > 0 ? 1 : 0) + (bridgeBatch && bridgeBatch.count > 0 ? 1 : 0)
    stats.triangles = tris + (shadows ? shadows.count * shadows.triangles : 0) + (ground ? ground.count * ground.triangles : 0)
    stats.pending = pending
    stats.rebuildMs = performance.now() - t0
    traceAdd('dio.rebuild', stats.rebuildMs)
    traceAdd('dio.layout', spent)
    traceAdd('dio.rebuilds', 1)
    ;(globalThis as { __dioramaRebuildMs?: number[] }).__dioramaRebuildMs?.push(+stats.rebuildMs.toFixed(2))
    lastCam.copy(camObj)
    // leftover layout work: continue next frame (each rebuild spends at most the budget on it)
    dirty = pending
    travelDirty = true
    requestRender()
  }

  const fwd = new THREE.Vector3()
  const up = new THREE.Vector3()
  const side = new THREE.Vector3()
  const mat = new Float32Array(16)
  const probe: Probe = { radius: 1, nx: 0, ny: 1, nz: 0, elev: 0, lake: 0, cell: 0 }
  // coarse lat/lon -> cell lookup, a start for the ground probe under each traveller
  const LUT_W = 128, LUT_H = 64
  let lut: Int32Array | null = null
  const startCell = (x: number, y: number, z: number) => {
    if (!lut) {
      lut = new Int32Array(LUT_W * LUT_H)
      let prev = 0
      for (let j = 0; j < LUT_H; j++) {
        for (let i = 0; i < LUT_W; i++) {
          const lat = ((j + 0.5) / LUT_H - 0.5) * Math.PI, lon = ((i + 0.5) / LUT_W) * Math.PI * 2
          prev = surface.nearestCell(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon), prev)
          lut[j * LUT_W + i] = prev
        }
      }
    }
    const l = Math.hypot(x, y, z)
    const lat = Math.asin(Math.max(-1, Math.min(1, y / l)))
    let lon = Math.atan2(z, x)
    if (lon < 0) lon += Math.PI * 2
    const j = Math.min(LUT_H - 1, Math.max(0, Math.floor((lat / Math.PI + 0.5) * LUT_H)))
    const i = Math.min(LUT_W - 1, Math.max(0, Math.floor((lon / (Math.PI * 2)) * LUT_W)))
    return lut[j * LUT_W + i]
  }

  /** Ships at sea, caravans of carts on land: matrices per group near the camera. */
  function writeTravellers() {
    if (!travelShips && !travelCarts) return
    if (travelShips) travelShips.count = 0
    if (travelCarts) travelCarts.count = 0
    const alt = camObj.length() - 1
    if (visible && travellers && travellersVisible && alt < DIORAMA_FAR) writeGroups(travellers(), false)
    if (visible && traders && tradersVisible && alt < DIORAMA_FAR) writeGroups(traders(), true)
    travelShips?.commit()
    travelCarts?.commit()
    stats.ships = travelShips?.count ?? 0
    stats.carts = travelCarts?.count ?? 0
    const im = (b: Batch | null, out: number[]) => {
      if (!b || b.count === 0) return
      const a = b.mesh.instanceMatrix.array as Float32Array
      out[0] = a[12]; out[1] = a[13]; out[2] = a[14]
    }
    im(travelShips, stats.firstShip)
    im(travelCarts, stats.firstCart)
  }

  /** Puts the matrix of one ship or cart at (x, y, z) facing fwd (scale sc), on the ground or the water. */
  const placeTraveller = (batch: Batch, x: number, y: number, z: number, sc: number, sea: boolean, palette: number) => {
    const l = Math.hypot(x, y, z)
    surface.probe(x / l, y / l, z / l, startCell(x, y, z), probe)
    up.set(x / l, y / l, z / l)
    side.crossVectors(up, fwd)
    const hgt = sea ? lib!.models[Model.Ship]!.height * 0.08 * (sc / MODEL_SPECS[Model.Ship].scale) : 0
    // the sea is drawn at radius 1, land on its triangles
    const r = (sea ? Math.max(1, probe.radius) : probe.radius) - hgt
    mat[0] = side.x * sc; mat[1] = side.y * sc; mat[2] = side.z * sc; mat[3] = 0
    mat[4] = up.x * sc; mat[5] = up.y * sc; mat[6] = up.z * sc; mat[7] = 0
    mat[8] = fwd.x * sc; mat[9] = fwd.y * sc; mat[10] = fwd.z * sc; mat[11] = 0
    mat[12] = up.x * r; mat[13] = up.y * r; mat[14] = up.z * r; mat[15] = 1
    batch.push(mat, 0, -NEVER, NEVER, palette, 0)
  }

  /** One ship, or a string of two or three carts, per group near the camera; `ownPalette`: info[0] is the group's palette index. */
  function writeGroups(g: TravelGroups, ownPalette: boolean) {
    for (let i = 0; i < g.count; i++) {
      const x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2]
      if (Math.hypot(x - camObj.x, y - camObj.y, z - camObj.z) > DIORAMA_FAR) continue
      const sea = g.info[i * 4 + 2] > 0.5
      const batch = sea ? travelShips : travelCarts
      if (!batch) continue
      up.set(x, y, z).normalize()
      fwd.set(g.dir[i * 3], g.dir[i * 3 + 1], g.dir[i * 3 + 2])
      fwd.addScaledVector(up, -fwd.dot(up))
      if (fwd.lengthSq() < 1e-12) continue
      fwd.normalize()
      const fade = Math.max(0, Math.min(1, g.info[i * 4 + 3]))
      const size = g.info[i * 4 + 1]
      if (sea) {
        const sc = MODEL_SPECS[Model.Ship].scale * 1.1 * fade * (0.85 + 0.3 * size)
        placeTraveller(batch, x, y, z, sc, true, ownPalette ? g.info[i * 4] : TRAVEL_PALETTE)
      } else {
        // a caravan: carts one behind the other along the road (own colours, no team tint)
        const sc = MODEL_SPECS[Model.Cart].scale * fade
        const len = (lib!.models[Model.Cart]!.size.z ?? 1.3) * MODEL_SPECS[Model.Cart].scale * 1.35
        const n = size > 0.45 ? 3 : 2
        for (let k = 0; k < n; k++) placeTraveller(batch, x - fwd.x * len * k, y - fwd.y * len * k, z - fwd.z * len * k, sc, false, 0)
      }
    }
  }

  return {
    object,
    get active() {
      return lib !== null && visible
    },
    pick(camera: THREE.PerspectiveCamera, x: number, y: number, width: number, height: number) {
      if (!lib || !visible || pickCount === 0) return -1
      object.updateWorldMatrix(true, false)
      pickMvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(object.matrixWorld)
      camera.getWorldPosition(pickR)
      object.worldToLocal(pickR)
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
      let best = -1
      let bestD = Infinity
      for (let i = 0; i < pickCount; i++) {
        const px = pickPos[i * 4], py = pickPos[i * 4 + 1], pz = pickPos[i * 4 + 2]
        const dist = Math.hypot(px - pickR.x, py - pickR.y, pz - pickR.z)
        // only where the models are readable (the flat marker handles the rest)
        if (dist > DIORAMA_YIELD_FAR) continue
        if ((pickR.x - px) * px + (pickR.y - py) * py + (pickR.z - pz) * pz <= 0) continue
        pickV.set(px, py, pz).applyMatrix4(pickMvp)
        const sx = ((pickV.x + 1) / 2) * width
        const sy = ((1 - pickV.y) / 2) * height
        // cluster radius on screen (CSS px), a little generous
        const rPx = (pickPos[i * 4 + 3] / (dist * tanHalf)) * (height / 2) * 0.9
        const d = Math.hypot(sx - x, sy - y)
        if (d <= rPx && d / rPx < bestD) {
          bestD = d / rPx
          best = pickIds[i]
        }
      }
      return best
    },
    setVisible(show: boolean) {
      if (show === visible) return
      visible = show
      object.visible = show
      if (!show) {
        townMaskUniforms.uTownCount.value = 0
        closeDetailUniforms.uFieldDetail.value = 0
      }
      dirty = true
      requestRender()
    },
    setStructuresVisible(show: boolean) {
      if (show === structuresVisible) return
      structuresVisible = show
      dirty = true
    },
    setTravellers(groups, show) {
      travellers = groups
      if (show !== travellersVisible) travelDirty = true
      travellersVisible = show
    },
    setTraders(groups, show) {
      if (show !== tradersVisible || (groups === null) !== (traders === null)) travelDirty = true
      traders = groups
      tradersVisible = show
    },
    setBridges(b, show) {
      if (b !== bridges) {
        if (bridgeBatch) {
          object.remove(bridgeBatch.mesh)
          shadowSys.removeCaster(bridgeBatch.mesh)
          bridgeBatch.dispose()
          bridgeBatch = null
        }
        bridges = b
        ensureBridgeBatch()
        dirty = true
      }
      if (show !== bridgesVisible) dirty = true
      bridgesVisible = show
    },
    setTime(y: number, animYears: number) {
      if (y !== year) travelDirty = true
      year = y
      uniforms.uYear.value = y
      uniforms.uAnimYears.value = Math.max(0.05, animYears)
      if (snapOf(y) !== shownS0 || landSnapOf(y) !== shownL0) {
        shownS0 = snapOf(y)
        shownL0 = landSnapOf(y)
        dirty = true
      }
      const b0 = bridges ? Math.min(bridges.snapshots - 1, Math.max(0, Math.floor(y / bridges.interval))) : -1
      if (b0 !== shownB0) {
        shownB0 = b0
        dirty = true
      }
    },
    setKnownMask(cellYear: Float32Array | null) {
      knownCells = cellYear && cellYear.length >= cellCount ? cellYear : null
      dirty = true
      requestRender()
    },
    setHistory(next: DioramaInputs) {
      if (next.history.snapshotInterval !== interval || next.history.settlements.length < N) return
      h = next.history
      land = next.land
      structures = next.structures
      reservoirs = next.reservoirs
      N = h.settlements.length
      lastSnap = h.snapshotCount - 1
      if (visIds.length < N) visIds = new Int32Array(N)
      if (visTown.length < N) visTown = new Uint8Array(N)
      if (visD.length < Math.max(N, cellCount)) visD = new Float32Array(Math.max(N, cellCount))
      layouts?.setHistory(h)
      polStates = new Map()
      sackFrom = null
      palaces = new Map()
      worksMap = new Map()
      if (perfOn) (globalThis as unknown as { __dioramaHistory: History }).__dioramaHistory = h
      groundEpoch++
      shownS0 = -1
      shownL0 = -1
      dirty = true
    },
    update(camera: THREE.PerspectiveCamera) {
      if (!visible) return
      if (!lib) {
        startLoading()
        return
      }
      closeDetailUniforms.uFieldDetail.value = 1
      object.updateWorldMatrix(true, false)
      object.getWorldQuaternion(tmpQ).invert()
      uniforms.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      camera.getWorldPosition(camObj)
      object.worldToLocal(camObj)
      uniforms.uCamObj.value.copy(camObj)
      const alt = Math.max(0.005, camObj.length() - 1)
      const wasNear = lastCam.length() - 1 < DIORAMA_FAR
      const near = alt < DIORAMA_FAR
      if (near || wasNear) {
        if (camObj.distanceTo(lastCam) > 0.14 * alt) dirty = true
      }
      if (dirty) {
        objToClip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(object.matrixWorld)
        rebuild()
      }
      // sun shadows near the view: the globe mesh beside this layer receives them
      if (!shadowSys.hasGround && object.parent) {
        for (const o of object.parent.children) {
          const m = o as THREE.Mesh
          if (m.isMesh && m.geometry?.getAttribute('aSurf')) {
            shadowSys.setGround(m.geometry)
            break
          }
        }
      }
      camera.getWorldDirection(fwdObj).applyQuaternion(tmpQ)
      shadowSys.update(near, camObj, fwdObj, uniforms.uSunObj.value, uniforms.uDaylight.value > 0.5, object.matrixWorld, year, instanceVersion, DIORAMA_NEAR)
      stats.shadowRenders = shadowSys.renders
      if (travelDirty) {
        writeTravellers()
        travelDirty = false
        requestRender()
      }
    },
    dispose() {
      disposed = true
      townMaskUniforms.uTownCount.value = 0
      closeDetailUniforms.uFieldDetail.value = 0
      for (const b of batches) b?.dispose()
      shadows?.dispose()
      ground?.dispose()
      travelShips?.dispose()
      travelCarts?.dispose()
      bridgeBatch?.dispose()
      modelMaterial.dispose()
      shadowMaterial.dispose()
      groundMaterial.dispose()
      townGround.dispose()
      townGroundMaterial.dispose()
      shadowSys.dispose()
    },
  }
}
