// Real sun shadows for the diorama layer up close: one shadow map (a single cascade) fitted
// to the ground around the point at the centre of the view, so buildings cast onto the
// ground, the town's streets and each other.
//
//  - The map is an orthographic depth render along the sun of every caster (the model
//    batches) with a depth-only copy of their instanced vertex shader (same life and
//    camera fade, so the shadow grows and shrinks with its house).
//  - It is drawn from inside the main render, by a hook mesh that the opaque pass draws
//    first (the pattern of three's Reflector): nothing else in the frame loop changes.
//  - It is redrawn only when its inputs change: the region (snapped to whole texels and to
//    steps of a quarter octave in size, so panning and zooming do not make edges crawl),
//    the sun, the instance set, or the year (houses grow and shrink with it). Rendering is
//    on demand, so an idle view redraws nothing.
//  - In the city view (layer.ts setCity) the map is fitted to the whole town instead of the
//    view: it then does not depend on the camera, so orbiting redraws nothing (only the
//    sun, the instance set, the year in steps, or a large camera move do).
//  - Receivers: the models (material.ts shadowAt), and the planet surface with the town
//    ground on it via a second, darkening draw of the globe mesh (createReceiverMaterial).
//    Outside the map the soft blob shadows remain.
// At night, or with the sun near the horizon, shadows are off.

import * as THREE from 'three'
import { createDepthMaterial, createReceiverMaterial, type DioramaUniforms } from './material.ts'
import { traceAdd } from '../perfTrace.ts'

const SIZE = 2048
/** Layer of the shadow casters (the main camera sees layer 0 only). */
const CASTER_LAYER = 1

/** City view: the town the map covers (object space centre on the ground, radius in world units). */
export interface ShadowFit {
  x: number
  y: number
  z: number
  r: number
}

export interface ShadowSystem {
  /** Add to the diorama group (draws the map first in the frame when due). */
  readonly hook: THREE.Mesh
  /** The shadow on the planet surface (add to the group; drawn when shadows are on). */
  readonly receiver: THREE.Mesh
  /** A mesh whose shadow is cast (its material is swapped for the depth pass). */
  addCaster(mesh: THREE.Mesh): void
  removeCaster(mesh: THREE.Mesh): void
  /** The globe geometry (object space) to receive the shadow; null until known. */
  setGround(geometry: THREE.BufferGeometry | null): void
  readonly hasGround: boolean
  /**
   * Per frame: fit the map to the view. `camObj` and `fwdObj` are the camera position and
   * view direction in the layer's object space, `sunObj` the light direction there,
   * `objectWorld` the layer's world matrix; `version` changes whenever the instance set
   * does. `on`: models are showing near the camera.
   */
  update(on: boolean, camObj: THREE.Vector3, fwdObj: THREE.Vector3, sunObj: THREE.Vector3, daylight: boolean, objectWorld: THREE.Matrix4, year: number, version: number, maxRadius: number, fit?: ShadowFit | null): void
  /** Draws of the map so far (perf=1). */
  readonly renders: number
  dispose(): void
}

export function createShadows(uniforms: DioramaUniforms): ShadowSystem {
  const depthTexture = new THREE.DepthTexture(SIZE, SIZE)
  depthTexture.type = THREE.UnsignedIntType
  depthTexture.compareFunction = THREE.LessEqualCompare
  depthTexture.minFilter = THREE.LinearFilter
  depthTexture.magFilter = THREE.LinearFilter
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { depthTexture, depthBuffer: true, format: THREE.RedFormat, type: THREE.UnsignedByteType, generateMipmaps: false })
  const depthMaterial = createDepthMaterial(uniforms)
  const receiverMaterial = createReceiverMaterial(uniforms)
  uniforms.uShadowMap.value = depthTexture
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 1)
  cam.layers.set(CASTER_LAYER)
  const casters = new Set<THREE.Mesh>()
  const saved = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()

  // the hook: an empty draw, first in the opaque pass
  const hookGeometry = new THREE.BufferGeometry()
  hookGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3))
  hookGeometry.setDrawRange(0, 0)
  const hookMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
  const hook = new THREE.Mesh(hookGeometry, hookMaterial)
  hook.frustumCulled = false
  hook.renderOrder = -1e9
  hook.name = 'diorama shadow map'

  const receiver = new THREE.Mesh(new THREE.BufferGeometry(), receiverMaterial)
  receiver.frustumCulled = false
  receiver.renderOrder = 1.5 // over the town ground and blob shadows, under rivers and roads
  receiver.visible = false
  receiver.name = 'diorama shadow receiver'
  let hasGround = false

  let due = false
  let renders = 0
  // last state drawn
  const last = { cx: NaN, cy: NaN, cz: NaN, r: NaN, sx: NaN, sy: NaN, sz: NaN, year: NaN, version: -1, camX: NaN, camY: NaN, camZ: NaN }

  const centre = new THREE.Vector3()
  const L = new THREE.Vector3()
  const ax = new THREE.Vector3()
  const ay = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const tmp2 = new THREE.Vector3()
  const view = new THREE.Matrix4()
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
  const objToLight = new THREE.Matrix4()
  const worldPos = new THREE.Vector3()
  const worldQ = new THREE.Quaternion()
  const objQ = new THREE.Quaternion()
  const objS = new THREE.Vector3()
  const objP = new THREE.Vector3()
  const rot = new THREE.Matrix4()

  let initialised = false
  let lastRenderer: THREE.WebGLRenderer | null = null
  hook.onBeforeRender = (renderer) => {
    // the map's depth texture must exist before any material samples it (an unset shadow
    // sampler binds an empty texture GL rejects for shadow lookups)
    if (!initialised) {
      renderer.initRenderTarget(target)
      initialised = true
    }
    lastRenderer = renderer
    if (!due) return
    due = false
    drawMap(renderer)
  }
  const drawMap = (renderer: THREE.WebGLRenderer) => {
    const prev = renderer.getRenderTarget()
    const prevAuto = renderer.autoClear
    for (const m of casters) {
      saved.set(m, m.material)
      m.material = depthMaterial
    }
    renderer.setRenderTarget(target)
    renderer.autoClear = true
    // the group as the root: the casters keep their world matrices
    const root = hook.parent
    if (root) renderer.render(root, cam)
    renderer.setRenderTarget(prev)
    renderer.autoClear = prevAuto
    for (const [m, mat] of saved) m.material = mat
    saved.clear()
    renders++
    traceAdd('shadow.renders', 1)
  }
  // perf=1: GPU ms of one draw of the map, alone (n draws inside one timer query)
  if (typeof location !== 'undefined' && /[?&]perf=1/.test(location.search)) {
    ;(globalThis as unknown as { __dioramaShadowTime: unknown }).__dioramaShadowTime = async (n = 20) => {
      const r = lastRenderer
      if (!r || !uniforms.uShadowOn.value) return null
      const gl = r.getContext() as WebGL2RenderingContext
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number } | null
      if (!ext) return null
      drawMap(r)
      gl.finish()
      const q = gl.createQuery() as WebGLQuery
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q)
      for (let i = 0; i < n; i++) drawMap(r)
      gl.endQuery(ext.TIME_ELAPSED_EXT)
      for (let k = 0; k < 120 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise((res) => requestAnimationFrame(res))
      const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / n
      gl.deleteQuery(q)
      renders -= n + 1
      return { ms: +ms.toFixed(3), size: SIZE, casters: casters.size }
    }
  }

  return {
    hook,
    receiver,
    addCaster(mesh) {
      casters.add(mesh)
      mesh.layers.enable(CASTER_LAYER)
    },
    removeCaster(mesh) {
      casters.delete(mesh)
    },
    setGround(g) {
      receiver.geometry = g ?? new THREE.BufferGeometry()
      hasGround = g !== null
    },
    get hasGround() {
      return hasGround
    },
    get renders() {
      return renders
    },
    update(on, camObj, fwdObj, sunObj, daylight, objectWorld, year, version, maxRadius, fit) {
      let d = 0
      if (fit) centre.set(fit.x, fit.y, fit.z)
      else {
        // the ground point at the centre of the view (or below the camera)
        const b = camObj.dot(fwdObj)
        const c = camObj.lengthSq() - 1.0
        const disc = b * b - c
        if (disc > 0 && -b - Math.sqrt(disc) > 0) centre.copy(camObj).addScaledVector(fwdObj, -b - Math.sqrt(disc))
        else centre.copy(camObj).normalize()
        d = centre.distanceTo(camObj)
      }
      // the light at the centre (daylight everywhere: leaned off the zenith, as the materials do)
      const up = tmp.copy(centre).normalize()
      L.copy(sunObj).normalize()
      if (daylight) {
        const t = tmp2.copy(L).addScaledVector(up, -L.dot(up))
        const tl = t.length()
        L.copy(up).addScaledVector(tl > 1e-4 ? t.multiplyScalar(1 / tl) : t.set(0, 0, 0), 0.6).normalize()
      }
      const mu = L.dot(up)
      const show = on && hasGround && mu > 0.03
      uniforms.uShadowOn.value = show ? 1 : 0
      receiver.visible = show
      if (!show) return
      // region: the town (city view), else ~1.4 view distances round the centre, in quarter-octave steps
      let R: number
      if (fit) R = fit.r
      else {
        R = Math.min(maxRadius, Math.max(0.006, 1.4 * d))
        R = Math.pow(2, Math.ceil(Math.log2(R) * 4) / 4)
      }
      // light basis: ay toward the sun's azimuth on the ground (the ground disc is foreshortened by mu along it)
      ay.copy(up).addScaledVector(L, -up.dot(L))
      if (ay.lengthSq() < 1e-10) ay.set(0, 1, 0).addScaledVector(L, -L.y)
      ay.normalize()
      ax.crossVectors(ay, L).normalize()
      // (the town's casters stand up to ~0.002 above its ground, which itself rises and falls with the land)
      const halfX = R, halfY = Math.min(R, R * Math.max(mu, 0.05) + (fit ? 0.0025 : 0.003))
      // snap the centre to whole texels in the light's plane
      const tx = (2 * halfX) / SIZE, ty = (2 * halfY) / SIZE
      const u = Math.round(centre.dot(ax) / tx) * tx, v = Math.round(centre.dot(ay) / ty) * ty, w = centre.dot(L)
      centre.set(0, 0, 0).addScaledVector(ax, u).addScaledVector(ay, v).addScaledVector(L, w)
      const D = R * 2 + 0.05
      // object-space light view: right ax, up ay, looking along -L
      view.makeBasis(ax, ay, L).setPosition(tmp.copy(centre).addScaledVector(L, D))
      // to world for the camera itself
      rot.multiplyMatrices(objectWorld, view)
      rot.decompose(worldPos, worldQ, objS)
      cam.position.copy(worldPos)
      cam.quaternion.copy(worldQ)
      cam.scale.set(1, 1, 1)
      cam.left = -halfX
      cam.right = halfX
      cam.top = halfY
      cam.bottom = -halfY
      // world scale of the group is 1 (the planet group only rotates)
      objectWorld.decompose(objP, objQ, objS)
      const sc = objS.x || 1
      cam.left *= sc; cam.right *= sc; cam.top *= sc; cam.bottom *= sc
      cam.near = (D - R - 0.02) * sc
      cam.far = (D + R + 0.02) * sc
      cam.updateProjectionMatrix()
      cam.updateMatrixWorld(true)
      // object space -> shadow texture space
      objToLight.copy(view).invert()
      uniforms.uShadowMat.value.multiplyMatrices(cam.projectionMatrix, objToLight).premultiply(bias)
      uniforms.uShadowMap.value = depthTexture
      uniforms.uShadowTexel.value = 1 / SIZE
      // ~1.5 texels of depth bias (depth units: 1 = far - near), and the normal offset in world units
      uniforms.uShadowWorld.value = Math.max(tx, ty)
      uniforms.uShadowBias.value = (Math.max(tx, ty) * 0.8) / (cam.far / sc - cam.near / sc)
      // (perf=1 measurement: window.__dioramaShadowEvery = true redraws the map every frame)
      if ((globalThis as { __dioramaShadowEvery?: boolean }).__dioramaShadowEvery) last.version = -1
      // (fitted to the town: the year in steps of a twentieth of the houses' growth time, and the
      // camera only when it moved far enough to change the casters' distance fade)
      const yearDue = fit ? Math.abs(year - last.year) >= Math.max(0.05, uniforms.uAnimYears.value * 0.05) : year !== last.year
      const camDue = fit ? Math.hypot(camObj.x - last.camX, camObj.y - last.camY, camObj.z - last.camZ) > 0.04 || Number.isNaN(last.camX) : false
      if (centre.x !== last.cx || centre.y !== last.cy || centre.z !== last.cz || R !== last.r || L.x !== last.sx || L.y !== last.sy || L.z !== last.sz || yearDue || camDue || version !== last.version) {
        last.cx = centre.x; last.cy = centre.y; last.cz = centre.z; last.r = R
        last.camX = camObj.x; last.camY = camObj.y; last.camZ = camObj.z
        last.sx = L.x; last.sy = L.y; last.sz = L.z
        last.year = year
        last.version = version
        due = true
      }
    },
    dispose() {
      target.dispose()
      depthTexture.dispose()
      depthMaterial.dispose()
      receiverMaterial.dispose()
      hookGeometry.dispose()
      hookMaterial.dispose()
    },
  }
}
