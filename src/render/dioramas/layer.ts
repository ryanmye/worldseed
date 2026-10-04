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
// at a year all agree. Travelling groups are the one per-frame write (a handful of
// matrices, into preallocated buffers).

import * as THREE from 'three'
import { StructureType, type History, type Structure, type World } from '../../contract.ts'
import { requestRender } from '../invalidate.ts'
import { SUN_DIRECTION, surfaceRadius } from '../globe.ts'
import { createLayouts, crossing, GROUND_MODEL, NEVER, type GroundSet, type Layouts, type SlotSet } from './layout.ts'
import { createGroundMaterial, createModelMaterial, createShadowMaterial, createTownGroundMaterial, createUniforms } from './material.ts'
import { createShadows } from './shadows.ts'
import { closeDetailUniforms, TOWN_MASK_MAX, townMaskUniforms } from './townMask.ts'
import { isFarModel, loadModels, MODEL_COUNT, MODEL_SPECS, Model, type ModelLibrary } from './models.ts'
import { createSurface, type Probe } from './surface.ts'

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
/** Vertex attributes a batch shares with its model. */
const SHARED_ATTRIBUTES = ['position', 'normal', 'aColor', 'aFace']

/**
 * The ground of every settlement near the view in one triangle list (layout.ts GroundSet
 * pieces with their life years over the snapshot window), rebuilt with the instance set.
 * Interleaved per vertex: position, normal, colour, pattern uv, kind, appear, disappear.
 */
class TownGround {
  static readonly STRIDE = 14
  data: Float32Array
  buffer: THREE.InterleavedBuffer
  geometry = new THREE.BufferGeometry()
  mesh: THREE.Mesh
  count = 0
  constructor(material: THREE.Material, capacity = 8192) {
    this.data = new Float32Array(capacity * TownGround.STRIDE)
    this.buffer = new THREE.InterleavedBuffer(this.data, TownGround.STRIDE).setUsage(THREE.DynamicDrawUsage)
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
    this.geometry.setAttribute('aLife', new THREE.InterleavedBufferAttribute(b, 2, 12))
  }
  private reserve(n: number) {
    const S = TownGround.STRIDE
    if ((this.count + n) * S <= this.data.length) return
    let cap = this.data.length / S
    while (cap < this.count + n) cap *= 2
    const d = new Float32Array(cap * S)
    d.set(this.data.subarray(0, this.count * S))
    this.data = d
    // a new GPU buffer of the larger size
    this.geometry.dispose()
    this.buffer = new THREE.InterleavedBuffer(d, S).setUsage(THREE.DynamicDrawUsage)
    this.bind()
  }
  /**
   * Appends the triangles of g whose threshold the value crosses in the window (life from
   * `life(threshold)`, null: not shown); returns the farthest appended vertex from (cx, cy, cz).
   */
  append(g: GroundSet, life: (threshold: number) => Float64Array | null, cx: number, cy: number, cz: number): number {
    if (g.n === 0) return 0
    this.reserve(g.n)
    let far2 = 0
    const S = TownGround.STRIDE
    const d = this.data
    let lastT = NaN
    let lf: Float64Array | null = null
    for (let v = 0; v + 2 < g.n; v += 3) {
      const t = g.threshold[v]
      if (t !== lastT) {
        lastT = t
        lf = life(t)
      }
      if (!lf) continue
      const a = lf[0], b = lf[1]
      for (let k = v; k < v + 3; k++) {
        const o = this.count * S
        d[o] = g.pos[k * 3]; d[o + 1] = g.pos[k * 3 + 1]; d[o + 2] = g.pos[k * 3 + 2]
        d[o + 3] = g.nrm[k * 3]; d[o + 4] = g.nrm[k * 3 + 1]; d[o + 5] = g.nrm[k * 3 + 2]
        d[o + 6] = g.col[k * 3]; d[o + 7] = g.col[k * 3 + 1]; d[o + 8] = g.col[k * 3 + 2]
        d[o + 9] = g.uv[k * 2]; d[o + 10] = g.uv[k * 2 + 1]
        d[o + 11] = g.kind[k]
        d[o + 12] = a; d[o + 13] = b
        this.count++
      }
      const dx = g.pos[v * 3] - cx, dy = g.pos[v * 3 + 1] - cy, dz = g.pos[v * 3 + 2] - cz
      far2 = Math.max(far2, dx * dx + dy * dy + dz * dz)
    }
    return Math.sqrt(far2)
  }
  commit() {
    const n = this.count
    this.geometry.setDrawRange(0, n)
    this.mesh.visible = n > 0
    if (n === 0) return
    this.buffer.clearUpdateRanges()
    this.buffer.addUpdateRange(0, n * TownGround.STRIDE)
    this.buffer.needsUpdate = true
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
    this.capacity = cap
  }

  push(mat: ArrayLike<number>, matOffset: number, a: number, b: number, c: number, d: number, roof: ArrayLike<number> = ZERO4, ro = 0, wall: ArrayLike<number> = ZERO3, wo = 0, info: ArrayLike<number> = ZERO4, io = 0) {
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
    for (const [attr, size] of [[this.animAttr, 4], [this.roofAttr, 4], [this.wallAttr, 3], [this.infoAttr, 4]] as const) {
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
  const stats: Stats = { instances: 0, shadows: 0, batches: 0, triangles: 0, settlements: 0, farmCells: 0, pending: false, rebuildMs: 0, ships: 0, carts: 0, firstShip: [0, 0, 0], firstCart: [0, 0, 0], groundTriangles: 0, shadowRenders: 0, trees: 0, villages: 0, villageInstances: 0, farVillages: 0 }
  if (typeof location !== 'undefined' && /[?&]perf=1/.test(location.search)) {
    (globalThis as unknown as { __dioramaStats: Stats }).__dioramaStats = stats
    ;(globalThis as unknown as { __dioramaPlans: object }).__dioramaPlans = {}
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
      if (!isFarModel(m)) shadowSys.addCaster(batches[m]!.mesh)
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
  const pushSlots = (slots: SlotSet, k: number, appear: number, disappear: number, far = 0, blob = true) => {
    const model = slots.model[k]
    if (model === GROUND_MODEL) {
      ground?.push(slots.mat, k * 16, appear, disappear, 0, 0, ZERO4, 0, slots.wall, k * 3)
      return
    }
    const b = batches[model]
    if (!b) return
    const lit = MODEL_SPECS[model].lit ? 1 : 0
    b.push(slots.mat, k * 16, appear, disappear, slots.palette[k], lit + (far > 0 ? 2 * Math.round(far / 0.002) : 0), slots.roof, k * 4, slots.wall, k * 3, slots.info, k * 4)
    if (blob) shadows?.push(slots.blob, k * 16, appear, disappear, slots.height[k], 0)
  }

  function rebuild() {
    if (!lib || !layouts) return
    const t0 = performance.now()
    const deadline = t0 + LAYOUT_BUDGET_MS
    let pending = false
    for (const b of batches) if (b) b.count = 0
    if (shadows) shadows.count = 0
    if (ground) ground.count = 0
    townGround.count = 0
    pickCount = 0
    let masks = 0
    stats.settlements = 0
    stats.farmCells = 0
    stats.trees = 0
    stats.villages = 0
    stats.villageInstances = 0
    stats.farVillages = 0
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
        if (pA <= 0 && pB <= 0 && pP <= 0) continue
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
        const vg = layouts.villages(id, deadline)
        if (!vg) pending = true
        else {
          if (!vg.done) pending = true
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
        const got = layouts.settlement(id, Math.max(pA, pB, pP), deadline)
        if (!got) {
          pending = true
          continue
        }
        if (!got.done) pending = true
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
        for (let k = 0; k < slots.n; k++) {
          if (!crossing(slots.threshold[k], pP, pA, pB, yP, y0, y1, cross)) continue
          const appear = Math.max(cross[0], s.foundedYear)
          const disappear = Math.min(cross[1], end)
          if (appear >= disappear) continue
          pushSlots(slots, k, appear, disappear)
        }
        // the settlement's streets, squares and yards, with its houses; the road ribbons give way inside them
        if (got.ground.n > 0) {
          const gr = townGround.append(got.ground, (t) => {
            if (!crossing(t, pP, pA, pB, yP, y0, y1, cross)) return null
            cross[0] = Math.max(cross[0], s.foundedYear)
            cross[1] = Math.min(cross[1], end)
            return cross[0] < cross[1] ? cross : null
          }, slots.cx * r, slots.cy * r, slots.cz * r)
          if (gr > 0 && masks < TOWN_MASK_MAX) {
            townMaskUniforms.uTowns.value[masks].set(slots.cx * r, slots.cy * r, slots.cz * r, gr * 0.95)
            masks++
          }
          if (gr > 0 && pickCount > 0 && pickIds[pickCount - 1] === id) pickPos[(pickCount - 1) * 4 + 3] = Math.max(pickPos[(pickCount - 1) * 4 + 3], gr)
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
          const slots = layouts.farm(c, deadline)
          if (!slots) {
            pending = true
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
          const slots = layouts.forest(c, deadline)
          if (!slots) {
            pending = true
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
    townGround.commit()
    townMaskUniforms.uTownCount.value = masks
    instanceVersion++
    stats.groundTriangles = townGround.count / 3
    stats.instances = inst + (ground?.count ?? 0) + (bridgeBatch?.count ?? 0)
    stats.shadows = shadows?.count ?? 0
    stats.batches = used + (shadows && shadows.count > 0 ? 1 : 0) + (ground && ground.count > 0 ? 1 : 0) + (bridgeBatch && bridgeBatch.count > 0 ? 1 : 0)
    stats.triangles = tris + (shadows ? shadows.count * shadows.triangles : 0) + (ground ? ground.count * ground.triangles : 0)
    stats.pending = pending
    stats.rebuildMs = performance.now() - t0
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
