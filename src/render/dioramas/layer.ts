// The diorama layer: oversized low-poly models standing on the globe when the camera is
// close (one cell is ~150 km, so true scale would be invisible). Settlement clusters,
// farm props on cultivated land, docks and moored ships at ports, dams, and ships or carts
// for groups under way.
//
// Draw calls: one InstancedMesh per model (plus one for the contact shadows and two for
// travelling ships and carts), all sharing one material, whatever the settlement count.
//
// Work per frame is uniform updates only. The instance set (which slots of which nearby
// settlements, farms and structures exist, with their appear / disappear years over the
// current snapshot window) is rebuilt only when the population snapshot or land snapshot
// changes, the camera moves by a fraction of its altitude, or a toggle flips. Within a
// window the shader animates pop-ins and removals from the year alone, so playback,
// scrubbing back and a direct load at a year all agree. Travelling groups are the one
// per-frame write (a handful of matrices, into preallocated buffers).

import * as THREE from 'three'
import { StructureType, type History, type Structure, type World } from '../../contract.ts'
import { requestRender } from '../invalidate.ts'
import { SUN_DIRECTION, surfaceRadius } from '../globe.ts'
import { createLayouts, crossing, NEVER, type Layouts, type SlotSet } from './layout.ts'
import { createModelMaterial, createShadowMaterial, createUniforms } from './material.ts'
import { loadModels, MODEL_COUNT, MODEL_SPECS, Model, type ModelLibrary } from './models.ts'

/** Camera distance at which models are full size, and where they are gone. */
export const DIORAMA_NEAR = 0.24
export const DIORAMA_FAR = 0.42

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
  /** Whether models are loaded and showing (the flat layers should then yield up close). */
  readonly active: boolean
  /**
   * Settlement whose building cluster is under CSS pixel (x, y) (canvas-relative), or -1:
   * up close the cluster, not just its small marker, is the click target.
   */
  pick(camera: THREE.PerspectiveCamera, x: number, y: number, width: number, height: number): number
  dispose(): void
}

class Batch {
  mesh: THREE.InstancedMesh
  geometry: THREE.BufferGeometry
  anim: Float32Array
  animAttr: THREE.InstancedBufferAttribute
  count = 0
  capacity: number

  constructor(source: THREE.BufferGeometry, material: THREE.Material, capacity: number) {
    // share the model's vertex buffers; only the per-instance attribute is this batch's own
    this.geometry = new THREE.BufferGeometry()
    for (const name of ['position', 'normal', 'aColor']) {
      const a = source.getAttribute(name)
      if (a) this.geometry.setAttribute(name, a)
    }
    this.geometry.setIndex(source.getIndex())
    this.capacity = capacity
    this.anim = new Float32Array(capacity * 4)
    this.animAttr = new THREE.InstancedBufferAttribute(this.anim, 4).setUsage(THREE.DynamicDrawUsage)
    this.geometry.setAttribute('aAnim', this.animAttr)
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
    this.capacity = cap
  }

  push(mat: ArrayLike<number>, matOffset: number, a: number, b: number, c: number, d: number, scale = 1) {
    if (this.count >= this.capacity) this.grow()
    const i = this.count++
    const dst = this.mesh.instanceMatrix.array as Float32Array
    const o = i * 16
    if (scale === 1) for (let k = 0; k < 16; k++) dst[o + k] = mat[matOffset + k]
    else {
      for (let k = 0; k < 12; k++) dst[o + k] = mat[matOffset + k] * scale
      for (let k = 12; k < 16; k++) dst[o + k] = mat[matOffset + k]
    }
    this.anim[i * 4] = a
    this.anim[i * 4 + 1] = b
    this.anim[i * 4 + 2] = c
    this.anim[i * 4 + 3] = d
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
    this.animAttr.clearUpdateRanges()
    this.animAttr.addUpdateRange(0, n * 4)
    this.animAttr.needsUpdate = true
  }

  dispose() {
    this.mesh.dispose()
    // the shared vertex buffers belong to the library: detach them, then free only our own
    for (const name of ['position', 'normal', 'aColor']) this.geometry.deleteAttribute(name)
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
}

export function createDioramaLayer(inputs: DioramaInputs): DioramaLayer {
  const { world, history: h, land, structures } = inputs
  const N = h.settlements.length
  const P = world.grid.positions
  const cellCount = world.grid.cellCount
  const object = new THREE.Group()
  object.name = 'dioramas'
  const uniforms = createUniforms()
  uniforms.uFade.value.set(DIORAMA_NEAR, DIORAMA_FAR)
  const modelMaterial = createModelMaterial(uniforms)
  const shadowMaterial = createShadowMaterial(uniforms)

  let lib: ModelLibrary | null = null
  let layouts: Layouts | null = null
  const batches: (Batch | null)[] = new Array(MODEL_COUNT).fill(null)
  let shadows: Batch | null = null
  let travelShips: Batch | null = null
  let travelCarts: Batch | null = null
  let disposed = false

  let visible = true
  let structuresVisible = true
  let travellers: (() => TravelGroups) | null = null
  let travellersVisible = true
  let traders: (() => TravelGroups) | null = null
  let tradersVisible = true
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
    layouts = createLayouts(world, h.settlements, l)
    for (let m = 0; m < MODEL_COUNT; m++) {
      const entry = l.models[m]
      if (!entry) continue
      batches[m] = new Batch(entry.geometry, modelMaterial, 64)
      object.add(batches[m]!.mesh)
    }
    shadows = new Batch(l.blob, shadowMaterial, 256)
    shadows.mesh.renderOrder = 1
    object.add(shadows.mesh)
    const ship = l.models[Model.Ship], cart = l.models[Model.Cart]
    if (ship) {
      travelShips = new Batch(ship.geometry, modelMaterial, 32)
      object.add(travelShips.mesh)
    }
    if (cart) {
      travelCarts = new Batch(cart.geometry, modelMaterial, 32)
      object.add(travelCarts.mesh)
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
  }

  // ---------- snapshot rows ----------
  const interval = h.snapshotInterval
  const lastSnap = h.snapshotCount - 1
  const snapOf = (y: number) => Math.min(lastSnap, Math.max(0, Math.floor(y / interval)))
  const landSnapOf = (y: number) => (land ? Math.min(land.count - 1, Math.max(0, Math.floor(y / land.interval))) : 0)

  /** Whether the point (object space) can be on screen and within the fade distance. */
  const inView = (x: number, y: number, z: number, radius: number) => {
    const dx = x - camObj.x, dy = y - camObj.y, dz = z - camObj.z
    if (Math.hypot(dx, dy, dz) > DIORAMA_FAR + radius) return false
    // in front of the horizon
    if (x * dx + y * dy + z * dz > 0.02) return false
    v4.set(x, y, z, 1).applyMatrix4(objToClip)
    if (v4.w <= 0) return false
    const m = 1.6 * v4.w
    return Math.abs(v4.x) < m && Math.abs(v4.y) < m
  }

  const pushSlots = (slots: SlotSet, k: number, appear: number, disappear: number) => {
    const model = slots.model[k]
    const b = batches[model]
    if (!b) return
    const lit = MODEL_SPECS[model].lit ? 1 : 0
    b.push(slots.mat, k * 16, appear, disappear, slots.palette[k], lit)
    shadows?.push(slots.blob, k * 16, appear, disappear, slots.height[k], 0)
  }

  function rebuild() {
    if (!lib || !layouts) return
    for (const b of batches) if (b) b.count = 0
    if (shadows) shadows.count = 0
    pickCount = 0
    const alt = camObj.length() - 1
    if (visible && alt < DIORAMA_FAR) {
      const s0 = snapOf(year)
      const s1 = Math.min(lastSnap, s0 + 1)
      const sP = Math.max(0, s0 - 1)
      const y0 = s0 * interval, y1 = s1 * interval, yP = sP * interval
      const pop = h.population
      // ---- settlements ----
      for (let id = 0; id < N; id++) {
        const pA = pop[s0 * N + id], pB = pop[s1 * N + id], pP = pop[sP * N + id]
        if (pA <= 0 && pB <= 0 && pP <= 0) continue
        const s = h.settlements[id]
        const c = s.cell
        const r = surfaceRadius(world, c)
        if (!inView(P[c * 3] * r, P[c * 3 + 1] * r, P[c * 3 + 2] * r, 0.02)) continue
        const slots = layouts.settlement(id, Math.max(pA, pB, pP))
        const end = s.abandonedYear >= 0 ? s.abandonedYear : NEVER
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
          pickPos[pickCount * 4 + 3] = slots.radius
          pickCount++
        }
        for (let k = 0; k < slots.n; k++) {
          if (!crossing(slots.threshold[k], pP, pA, pB, yP, y0, y1, cross)) continue
          const appear = Math.max(cross[0], s.foundedYear)
          const disappear = Math.min(cross[1], end)
          if (appear >= disappear) continue
          pushSlots(slots, k, appear, disappear)
        }
      }
      // ---- farm props on cultivated land ----
      if (land) {
        const l0 = landSnapOf(year)
        const l1 = Math.min(land.count - 1, l0 + 1)
        const lP = Math.max(0, l0 - 1)
        const ly0 = l0 * land.interval, ly1 = l1 * land.interval, lyP = lP * land.interval
        const U = land.landUse
        for (let c = 0; c < cellCount; c++) {
          const uA = U[l0 * cellCount + c], uB = U[l1 * cellCount + c], uP = U[lP * cellCount + c]
          if (uA < 40 && uB < 40 && uP < 40) continue
          if (layouts.settlementCell[c]) continue
          const r = surfaceRadius(world, c)
          if (!inView(P[c * 3] * r, P[c * 3 + 1] * r, P[c * 3 + 2] * r, 0.015)) continue
          const slots = layouts.farm(c)
          for (let k = 0; k < slots.n; k++) {
            if (!crossing(slots.threshold[k], uP, uA, uB, lyP, ly0, ly1, cross)) continue
            pushSlots(slots, k, cross[0], cross[1])
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
          if (!inView(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], 0.015)) continue
          const isPort = st.type === StructureType.Port
          const slots = isPort ? layouts.port(st.id, st.settlement, pos, k * 3, dir, k * 3) : layouts.dam(st.id, st.cell, pos, k * 3, dir, k * 3)
          const owner = st.settlement >= 0 && st.settlement < N ? st.settlement : -1
          for (let q = 0; q < slots.n; q++) {
            let appear = st.builtYear
            let disappear = lost
            const t = slots.threshold[q]
            if (t > 0) {
              // the second ship waits for its owner to grow into a town
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
          if (!inView(B.pos[k * 3], B.pos[k * 3 + 1], B.pos[k * 3 + 2], 0.01)) continue
          if (!crossing(B.threshold, B.level(k, bP), B.level(k, b0), B.level(k, b1), bP * B.interval, b0 * B.interval, b1 * B.interval, cross)) continue
          bridgeBatch.push(B.mat, k * 16, cross[0], cross[1], 0, 0)
        }
      }
      bridgeBatch.commit()
    }
    for (const b of batches) b?.commit()
    shadows?.commit()
    lastCam.copy(camObj)
    dirty = false
    travelDirty = true
    requestRender()
  }

  const fwd = new THREE.Vector3()
  const up = new THREE.Vector3()
  const side = new THREE.Vector3()
  const mat = new Float32Array(16)

  /** Ships at sea, carts on land: one matrix per group near the camera. */
  function writeTravellers() {
    if (!travelShips && !travelCarts) return
    if (travelShips) travelShips.count = 0
    if (travelCarts) travelCarts.count = 0
    const alt = camObj.length() - 1
    if (visible && travellers && travellersVisible && alt < DIORAMA_FAR) writeGroups(travellers(), false)
    if (visible && traders && tradersVisible && alt < DIORAMA_FAR) writeGroups(traders(), true)
    travelShips?.commit()
    travelCarts?.commit()
  }

  /** One matrix per group near the camera; `ownPalette`: info[0] is the group's palette index. */
  function writeGroups(g: TravelGroups, ownPalette: boolean) {
    {
      for (let i = 0; i < g.count; i++) {
        const x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2]
        if (Math.hypot(x - camObj.x, y - camObj.y, z - camObj.z) > DIORAMA_FAR) continue
        const sea = g.info[i * 4 + 2] > 0.5
        const batch = sea ? travelShips : travelCarts
        if (!batch) continue
        const model = sea ? Model.Ship : Model.Cart
        const spec = MODEL_SPECS[model]
        const entry = lib!.models[model]!
        up.set(x, y, z).normalize()
        fwd.set(g.dir[i * 3], g.dir[i * 3 + 1], g.dir[i * 3 + 2])
        fwd.addScaledVector(up, -fwd.dot(up))
        if (fwd.lengthSq() < 1e-12) continue
        fwd.normalize()
        // model forward is +z: X = Y x Z
        side.crossVectors(up, fwd)
        const sc = spec.scale * Math.max(0, Math.min(1, g.info[i * 4 + 3])) * (sea ? 0.85 + 0.3 * g.info[i * 4 + 1] : 1)
        // the route floats a little above the ground; ships sit at their waterline, carts on the road
        const r = Math.hypot(x, y, z) - 0.0032 - (sea ? entry.height * 0.1 : 0)
        mat[0] = side.x * sc; mat[1] = side.y * sc; mat[2] = side.z * sc; mat[3] = 0
        mat[4] = up.x * sc; mat[5] = up.y * sc; mat[6] = up.z * sc; mat[7] = 0
        mat[8] = fwd.x * sc; mat[9] = fwd.y * sc; mat[10] = fwd.z * sc; mat[11] = 0
        mat[12] = up.x * r; mat[13] = up.y * r; mat[14] = up.z * r; mat[15] = 1
        batch.push(mat, 0, -NEVER, NEVER, ownPalette ? g.info[i * 4] : TRAVEL_PALETTE, 0)
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
        // only where the models are well grown (the flat marker handles the rest)
        if (dist > (DIORAMA_NEAR + DIORAMA_FAR) / 2) continue
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
    update(camera: THREE.PerspectiveCamera) {
      if (!visible) return
      if (!lib) {
        startLoading()
        return
      }
      object.updateWorldMatrix(true, false)
      object.getWorldQuaternion(tmpQ).invert()
      uniforms.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      camera.getWorldPosition(camObj)
      object.worldToLocal(camObj)
      uniforms.uCamObj.value.copy(camObj)
      const alt = Math.max(0.02, camObj.length() - 1)
      const wasNear = lastCam.length() - 1 < DIORAMA_FAR
      const near = alt < DIORAMA_FAR
      if (near || wasNear) {
        if (camObj.distanceTo(lastCam) > 0.14 * alt) dirty = true
      }
      if (dirty) {
        objToClip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(object.matrixWorld)
        rebuild()
      }
      if (travelDirty) {
        writeTravellers()
        travelDirty = false
        requestRender()
      }
    },
    dispose() {
      disposed = true
      for (const b of batches) b?.dispose()
      shadows?.dispose()
      travelShips?.dispose()
      travelCarts?.dispose()
      bridgeBatch?.dispose()
      modelMaterial.dispose()
      shadowMaterial.dispose()
    },
  }
}
