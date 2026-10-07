// The city view: a flight from wherever the camera is down to a low, angled view over one
// town, a street-level orbit around it, and the flight back up to where the user was.
//
// Everything is worked out in the planet's object space (planetGroup), where the globe, the
// detail tiles and the dioramas live, and written to the camera in world space each frame;
// the planet does not turn while the view is engaged (main.ts stops the spin).
//
// Flight: a path over the sphere between two camera poses. The direction of the camera from
// the planet centre is slerped (mostly while high up), the altitude follows a curve in log
// space that rises to a cruise height for long flights and settles on the destination's, and
// the orientation turns from the start pose to looking straight down at the planet centre
// (the globe camera's pose) and on to the destination pose, so a long flight looks like the
// globe's own fly-to and the last part is a descent that tilts toward the horizon.
// Pre-build: from the first frame of a fly-in the detail tiles (globe.ts setDetailFocus) and
// the diorama layer (layer.ts setFocus) plan their work from a stand-in camera at the
// destination pose, so the town, its villages, its fields and the fine ground are laid out a
// few milliseconds per frame while the flight is high up; the last part of the flight waits
// (slows to a crawl) until both are done, so nothing pops in on arrival.
//
// Orbit: the camera circles a pivot on the ground (the town centre, or a building
// double-clicked) at a horizontal distance (scroll) and a height (keys, a vertical drag, the
// card's buttons), looking at the pivot. Drags rotate directly; a released drag glides on
// briefly; the distance, height and pivot ease toward their targets. Each of these ends, and
// update() then reports no motion, so the render loop goes back to sleep at rest.

import * as THREE from 'three'
import type { History, World } from '../contract.ts'
import type { GlobeMesh } from './globe.ts'
import { activeDioramaLayer, type CityAim, type LandmarkSpot } from './dioramas/layer.ts'
import { renderedGroundRadius, located } from './terrainHeight.ts'
import { SUN_DIRECTION } from './globe.ts'
import { requestRender } from './invalidate.ts'
import { traceAdd } from './perfTrace.ts'

export const CityState = { Off: 0, In: 1, Orbit: 2, Out: 3 } as const
export type CityState = (typeof CityState)[keyof typeof CityState]

export interface CityViewDeps {
  camera: THREE.PerspectiveCamera
  canvas: HTMLCanvasElement
  planetGroup: THREE.Group
  getWorld(): World | null
  getHistory(): History | null
  getGlobe(): GlobeMesh | null
  /** The state changed (the card shows or hides; the globe controls are handed back at Off). */
  onState(state: CityState, id: number): void
  wake(): void
}

export interface CityView {
  readonly state: CityState
  /** Engaged: flying in, orbiting or flying out (the globe controls are off). */
  readonly engaged: boolean
  readonly settlement: number
  /** What the camera looks toward ('castle', 'harbour', ...; '' the centre). */
  readonly focus: string
  /** Fly down into settlement id (false if it cannot: no world, history or models yet). */
  flyIn(id: number): boolean
  /** Fly back up to where the view was before the fly-in. */
  flyOut(): void
  /** Leave at once, the camera where it is (something else took it over: a panel's fly-to). */
  abort(): void
  /** Per animation frame; true if the camera moved. */
  update(dt: number): boolean
  /** Orbit controls: turn by `rad`, raise (`k` > 1) or lower the view, move closer (`k` < 1) or further. */
  turn(rad: number): void
  raise(k: number): void
  zoom(k: number): void
  /** Landmarks standing near the pivot (refreshed when the pivot or the year's snapshot changes). */
  landmarks(): LandmarkSpot[]
  /** Landmark under CSS pixel (x, y) of the canvas, or null. */
  landmarkAt(x: number, y: number): LandmarkSpot | null
  /** Ids of the landmarks on screen, nearest first (orbit only). */
  inView(): number[]
  /** Longest frame interval during the last flight, its frame count and duration (perf=1). */
  readonly lastFlight: { maxMs: number; frames: number; seconds: number; heldSeconds: number; prebuilt: boolean }
}

/** Closest the camera comes to the ground under it in the orbit (planet radii). */
const CLEARANCE = 0.0012
/** Pitch of the view (radians below the horizontal toward the pivot): default, and its bounds. */
const PITCH0 = THREE.MathUtils.degToRad(17)
const PITCH_MIN = THREE.MathUtils.degToRad(6)
const PITCH_MAX = THREE.MathUtils.degToRad(70)
/** Horizontal distance bounds (world units). */
const DIST_MIN = 0.0022
const DIST_MAX = 0.06
/** The flight waits at most this long (seconds) near its end for the destination to be built. */
const HOLD_MAX = 3

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

interface Pose {
  pos: THREE.Vector3
  quat: THREE.Quaternion
}

export function createCityView(deps: CityViewDeps): CityView {
  const { camera, canvas, planetGroup } = deps
  let state: CityState = CityState.Off
  let id = -1
  let aim: CityAim | null = null
  let focusWord = ''

  // ---- orbit parameters (object space) ----
  const pivot = new THREE.Vector3()
  const pivotTarget = new THREE.Vector3()
  let az = 0
  let dist = 0.01
  let distTarget = 0.01
  let pitch = PITCH0
  let pitchTarget = PITCH0
  let azVel = 0
  let dragging = false

  // ---- flight ----
  const from: Pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }
  const to: Pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }
  /** The pose before the fly-in, in world space, exactly (the globe controls and the tilt pick it up again). */
  const savedPos = new THREE.Vector3()
  const savedQuat = new THREE.Quaternion()
  let t = 0
  let duration = 2.5
  let useDown = true
  let held = 0
  let flightMax = 0
  let flightFrames = 0
  let flightSeconds = 0
  let prebuilt = false
  const lastFlight = { maxMs: 0, frames: 0, seconds: 0, heldSeconds: 0, prebuilt: false }
  /** Stand-in camera at the destination pose: the detail tiles and the dioramas plan from it during a fly-in. */
  const focusCam = new THREE.PerspectiveCamera()

  // scratch
  const tmpV = new THREE.Vector3()
  const tmpV2 = new THREE.Vector3()
  const up = new THREE.Vector3()
  const east = new THREE.Vector3()
  const north = new THREE.Vector3()
  const fwd = new THREE.Vector3()
  const m4 = new THREE.Matrix4()
  const qA = new THREE.Quaternion()
  const qB = new THREE.Quaternion()
  const groupQ = new THREE.Quaternion()
  const groupQInv = new THREE.Quaternion()
  let groundStart = 0

  /** Rendered ground radius under object-space point p (any length). */
  const groundAt = (x: number, y: number, z: number) => {
    const w = deps.getWorld()
    if (!w) return 1
    const l = Math.hypot(x, y, z) || 1
    const r = renderedGroundRadius(w, x / l, y / l, z / l, groundStart)
    groundStart = located.cell
    return r
  }

  const syncGroup = () => {
    planetGroup.updateWorldMatrix(true, false)
    planetGroup.getWorldQuaternion(groupQ)
    groupQInv.copy(groupQ).invert()
  }

  /** Tangent frame at unit direction u: east, north (stable away from the poles). */
  const frameAt = (u: THREE.Vector3) => {
    east.set(-u.z, 0, u.x)
    if (east.lengthSq() < 1e-10) east.set(1, 0, 0)
    east.normalize()
    north.crossVectors(u, east).normalize()
  }

  /** The orbit pose from the parameters (object space), lifted clear of the ground. */
  const orbitPose = (out: Pose, pv: THREE.Vector3, azimuth: number, d: number, p: number) => {
    up.copy(pv).normalize()
    frameAt(up)
    fwd.copy(east).multiplyScalar(Math.cos(azimuth)).addScaledVector(north, Math.sin(azimuth))
    const hgt = d * Math.tan(p)
    out.pos.copy(pv).addScaledVector(up, hgt).addScaledVector(fwd, -d)
    // over higher ground (a hill behind the camera): lift it clear
    const r = out.pos.length()
    const g = groundAt(out.pos.x, out.pos.y, out.pos.z) + CLEARANCE
    if (r < g) out.pos.multiplyScalar(g / r)
    // look at the pivot, a little above the ground; horizon level (up: the local vertical)
    tmpV.copy(pv).addScaledVector(up, d * 0.03)
    m4.lookAt(out.pos, tmpV, up)
    out.quat.setFromRotationMatrix(m4)
  }

  /** Writes an object-space pose to the camera (world space). */
  const applyPose = (p: Pose) => {
    camera.position.copy(p.pos).applyMatrix4(planetGroup.matrixWorld)
    camera.quaternion.copy(groupQ).multiply(p.quat)
    camera.updateMatrixWorld()
  }

  /** The current camera pose in object space. */
  const readPose = (out: Pose) => {
    out.pos.copy(camera.position)
    planetGroup.worldToLocal(out.pos)
    out.quat.copy(groupQInv).multiply(camera.quaternion)
  }

  /** Orbit start parameters for the aim: the camera across the town from its point of interest. */
  const setupOrbit = (a: CityAim) => {
    pivot.set(a.cx, a.cy, a.cz)
    up.copy(pivot).normalize()
    frameAt(up)
    tmpV.set(a.fx - a.cx, a.fy - a.cy, a.fz - a.cz)
    tmpV.addScaledVector(up, -tmpV.dot(up))
    const span = tmpV.length()
    if (span > a.extent * 0.08) {
      az = Math.atan2(tmpV.dot(north), tmpV.dot(east))
      // the orbit centre a little toward the point of interest: it sits in the middle distance
      pivot.addScaledVector(tmpV, Math.min(0.35, (a.extent * 0.5) / span))
    } else {
      // nothing in particular: look away from the sun, a little across it (lit fronts, shadows to one side)
      tmpV2.copy(SUN_DIRECTION).applyQuaternion(groupQInv)
      tmpV2.addScaledVector(up, -tmpV2.dot(up))
      az = tmpV2.lengthSq() > 1e-6 ? Math.atan2(-tmpV2.dot(north), -tmpV2.dot(east)) + 0.6 : 0.4
    }
    // pivot on the ground
    const g = groundAt(pivot.x, pivot.y, pivot.z)
    pivot.normalize().multiplyScalar(g)
    pivotTarget.copy(pivot)
    // the town fills the frame: its reach across a little more than the view's half width
    dist = distTarget = THREE.MathUtils.clamp(a.extent * 1.55, 0.004, 0.035)
    pitch = pitchTarget = PITCH0
    azVel = 0
  }

  /** Destination of the fly-in and the stand-in camera at it. */
  const setupDestination = () => {
    if (!aim) return
    setupOrbit(aim)
    orbitPose(to, pivot, az, dist, pitch)
    focusCam.copy(camera, false)
    focusCam.projectionMatrix.copy(camera.projectionMatrix)
    focusCam.projectionMatrixInverse.copy(camera.projectionMatrixInverse)
    focusCam.position.copy(to.pos).applyMatrix4(planetGroup.matrixWorld)
    focusCam.quaternion.copy(groupQ).multiply(to.quat)
    focusCam.updateMatrixWorld(true)
  }

  const startFlight = (dest: Pose) => {
    readPose(from)
    to.pos.copy(dest.pos)
    to.quat.copy(dest.quat)
    planFlight()
  }
  const planFlight = () => {
    const a0 = Math.max(1e-4, from.pos.length() - 1), a1 = Math.max(1e-4, to.pos.length() - 1)
    const ang = tmpV.copy(from.pos).normalize().angleTo(tmpV2.copy(to.pos).normalize())
    useDown = ang > 0.04 || Math.max(a0, a1) > 0.2
    duration = THREE.MathUtils.clamp(1.5 + (1.2 * ang) / Math.PI + 0.22 * (Math.abs(Math.log(a0 / a1)) / Math.LN10), 1.4, 4)
    t = 0
    held = 0
    flightMax = 0
    flightFrames = 0
    flightSeconds = 0
  }

  const pathPos = new THREE.Vector3()
  const pathQuat = new THREE.Quaternion()
  const d0 = new THREE.Vector3()
  const d1 = new THREE.Vector3()
  const downUp = new THREE.Vector3()
  /** Pose along the flight at s (0..1), object space. */
  const pathAt = (s: number) => {
    const a0 = Math.max(1e-4, from.pos.length() - 1), a1 = Math.max(1e-4, to.pos.length() - 1)
    d0.copy(from.pos).normalize()
    d1.copy(to.pos).normalize()
    const ang = d0.angleTo(d1)
    // altitude: log-space blend, with a rise to a cruise height for long flights
    const l0 = Math.log(a0), l1 = Math.log(a1)
    const cruise = Math.log(Math.max(a0, a1, Math.min(1.5, ang * 0.8)))
    const bump = Math.max(0, cruise - Math.max(l0, l1))
    const sa = s * s * s * (s * (s * 6 - 15) + 10)
    const la = l0 + (l1 - l0) * sa + bump * 4 * s * (1 - s)
    const alt = Math.exp(la)
    // direction: mostly while high up; the last part is a descent
    const sd = smooth(0.04, 0.78, s)
    if (ang > 1e-6) {
      const k0 = Math.sin((1 - sd) * ang) / Math.sin(ang), k1 = Math.sin(sd * ang) / Math.sin(ang)
      pathPos.copy(d0).multiplyScalar(k0).addScaledVector(d1, k1).normalize()
    } else pathPos.copy(d1)
    pathPos.multiplyScalar(1 + alt)
    // orientation: start pose -> looking down at the centre -> destination pose
    if (useDown) {
      downUp.set(0, 1, 0).applyQuaternion(groupQInv)
      m4.lookAt(pathPos, tmpV.set(0, 0, 0), downUp)
      qA.setFromRotationMatrix(m4)
      qB.copy(from.quat).slerp(qA, smooth(0, 0.3, s))
      pathQuat.copy(qB).slerp(to.quat, smooth(0.5, 1, s))
    } else pathQuat.copy(from.quat).slerp(to.quat, sa)
  }

  // ---- landmarks near the pivot (for the card and hovering) ----
  let spots: LandmarkSpot[] = []
  const spotsKey = { x: NaN, y: NaN, z: NaN, snap: -1, layerYear: NaN }
  const refreshSpots = () => {
    const layer = activeDioramaLayer()
    const h = deps.getHistory()
    if (!layer || !h) {
      spots = []
      return spots
    }
    const snap = Math.floor(layer.year / h.snapshotInterval)
    if (spotsKey.snap === snap && Math.hypot(spotsKey.x - pivot.x, spotsKey.y - pivot.y, spotsKey.z - pivot.z) < dist * 0.3 && spots.length > 0) return spots
    spotsKey.x = pivot.x; spotsKey.y = pivot.y; spotsKey.z = pivot.z; spotsKey.snap = snap
    spots = layer.landmarksNear(pivot.x, pivot.y, pivot.z, Math.max(0.03, dist * 5), layer.year)
    return spots
  }
  const proj = new THREE.Vector3()
  /** CSS px of object-space point (x, y, z) lifted by `lift`, or null behind the camera. */
  const screenOf = (s: LandmarkSpot, lift: number, out: number[]) => {
    proj.set(s.x, s.y, s.z)
    const l = proj.length()
    proj.multiplyScalar((l + lift) / l).applyMatrix4(planetGroup.matrixWorld)
    tmpV.copy(proj).applyMatrix4(camera.matrixWorldInverse)
    if (tmpV.z > -1e-5) return false
    proj.project(camera)
    const rect = canvas.getBoundingClientRect()
    out[0] = ((proj.x + 1) / 2) * rect.width
    out[1] = ((1 - proj.y) / 2) * rect.height
    out[2] = -tmpV.z
    return true
  }
  const scr = [0, 0, 0]

  // ---- input (orbit only) ----
  let dragX = 0, dragY = 0, dragT = 0, dragId = -1
  const onDown = (e: PointerEvent) => {
    if (state !== CityState.Orbit || e.button !== 0 || e.shiftKey) return
    dragging = true
    dragId = e.pointerId
    dragX = e.clientX
    dragY = e.clientY
    dragT = performance.now()
    azVel = 0
  }
  const onMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragId) return
    const dx = e.clientX - dragX, dy = e.clientY - dragY
    dragX = e.clientX
    dragY = e.clientY
    const now = performance.now()
    const dtm = Math.max(1, now - dragT)
    dragT = now
    const rad = -dx * 0.006
    az += rad
    azVel = (rad / dtm) * 1000
    pitch = pitchTarget = THREE.MathUtils.clamp(pitch + dy * 0.004, PITCH_MIN, PITCH_MAX)
    requestRender()
    deps.wake()
  }
  const onUp = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragId) return
    dragging = false
    // a drag held still before release does not glide
    if (performance.now() - dragT > 80) azVel = 0
    requestRender()
    deps.wake()
  }
  const onWheel = (e: WheelEvent) => {
    if (state !== CityState.Orbit) return
    e.preventDefault()
    const k = Math.exp(THREE.MathUtils.clamp(e.deltaY, -200, 200) * 0.0015)
    distTarget = THREE.MathUtils.clamp(distTarget * k, DIST_MIN, DIST_MAX)
    requestRender()
    deps.wake()
  }
  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const onDbl = (e: MouseEvent) => {
    if (state !== CityState.Orbit) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    // a landmark under the cursor, else the ground the ray meets
    const lm = api.landmarkAt(x, y)
    if (lm) {
      pivotTarget.set(lm.x, lm.y, lm.z)
    } else {
      ndc.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const o = tmpV.copy(ray.ray.origin), dir = tmpV2.copy(ray.ray.direction)
      planetGroup.worldToLocal(o)
      dir.applyQuaternion(groupQInv)
      // march to the ground, then bisect
      let a = 0, b = -1
      const step = Math.max(2e-4, dist * 0.02)
      for (let s = step; s < Math.max(0.15, dist * 12); s += step) {
        const px = o.x + dir.x * s, py = o.y + dir.y * s, pz = o.z + dir.z * s
        if (Math.hypot(px, py, pz) <= groundAt(px, py, pz)) {
          b = s
          break
        }
        a = s
      }
      if (b < 0) return
      for (let k = 0; k < 12; k++) {
        const m = (a + b) / 2
        const px = o.x + dir.x * m, py = o.y + dir.y * m, pz = o.z + dir.z * m
        if (Math.hypot(px, py, pz) <= groundAt(px, py, pz)) b = m
        else a = m
      }
      pivotTarget.set(o.x + dir.x * b, o.y + dir.y * b, o.z + dir.z * b)
    }
    const g = groundAt(pivotTarget.x, pivotTarget.y, pivotTarget.z)
    pivotTarget.normalize().multiplyScalar(g)
    // a building is looked at from a little closer
    distTarget = THREE.MathUtils.clamp(Math.min(distTarget, Math.max(DIST_MIN * 1.5, dist * 0.7)), DIST_MIN, DIST_MAX)
    requestRender()
    deps.wake()
  }
  canvas.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('dblclick', onDbl)

  const setState = (s: CityState) => {
    state = s
    deps.onState(s, id)
    requestRender()
    deps.wake()
  }
  const clearFocus = () => {
    deps.getGlobe()?.setDetailFocus(null)
    activeDioramaLayer()?.setFocus(null)
  }
  const endFlightStats = () => {
    lastFlight.maxMs = +flightMax.toFixed(1)
    lastFlight.frames = flightFrames
    lastFlight.seconds = +flightSeconds.toFixed(2)
    lastFlight.heldSeconds = +held.toFixed(2)
    lastFlight.prebuilt = prebuilt
  }

  const pose: Pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }
  let lastFrameTs = 0

  const api: CityView = {
    get state() {
      return state
    },
    get engaged() {
      return state !== CityState.Off
    },
    get settlement() {
      return id
    },
    get focus() {
      return focusWord
    },
    get lastFlight() {
      return lastFlight
    },
    flyIn(sid: number) {
      const h = deps.getHistory()
      const layer = activeDioramaLayer()
      if (!h || !deps.getWorld() || !layer || sid < 0 || sid >= h.settlements.length) return false
      syncGroup()
      const a = layer.cityAim(sid, layer.year)
      if (!a) return false
      if (state === CityState.Off) {
        savedPos.copy(camera.position)
        savedQuat.copy(camera.quaternion)
      }
      id = sid
      aim = a
      focusWord = a.focus
      setupDestination()
      startFlight(to)
      deps.getGlobe()?.setDetailFocus(focusCam)
      layer.setFocus(focusCam)
      prebuilt = false
      lastFrameTs = 0
      setState(CityState.In)
      return true
    },
    flyOut() {
      if (state === CityState.Off || state === CityState.Out) return
      clearFocus()
      syncGroup()
      to.pos.copy(savedPos)
      planetGroup.worldToLocal(to.pos)
      to.quat.copy(groupQInv).multiply(savedQuat)
      readPose(from)
      planFlight()
      dragging = false
      azVel = 0
      lastFrameTs = 0
      setState(CityState.Out)
    },
    abort() {
      if (state === CityState.Off) return
      clearFocus()
      dragging = false
      setState(CityState.Off)
      id = -1
    },
    turn(rad: number) {
      if (state !== CityState.Orbit) return
      azVel = 0
      az += rad
      requestRender()
      deps.wake()
    },
    raise(k: number) {
      if (state !== CityState.Orbit) return
      pitchTarget = THREE.MathUtils.clamp(pitchTarget + Math.log(k), PITCH_MIN, PITCH_MAX)
      requestRender()
      deps.wake()
    },
    zoom(k: number) {
      if (state !== CityState.Orbit) return
      distTarget = THREE.MathUtils.clamp(distTarget * k, DIST_MIN, DIST_MAX)
      requestRender()
      deps.wake()
    },
    landmarks() {
      return state === CityState.Orbit ? refreshSpots() : []
    },
    landmarkAt(x: number, y: number) {
      if (state !== CityState.Orbit) return null
      const rect = canvas.getBoundingClientRect()
      const fy = rect.height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
      let best: LandmarkSpot | null = null
      let bestD = Infinity
      for (const s of refreshSpots()) {
        if (!screenOf(s, s.height * 0.45, scr)) continue
        // its footprint on screen (half its height across, at least a finger's width)
        const r = Math.max(14, ((s.height * 0.6) / scr[2]) * fy)
        const d = Math.hypot(scr[0] - x, scr[1] - y)
        if (d < r && d / r < bestD) {
          bestD = d / r
          best = s
        }
      }
      return best
    },
    inView() {
      if (state !== CityState.Orbit) return []
      const rect = canvas.getBoundingClientRect()
      const list: [number, number][] = []
      for (const sp of refreshSpots()) {
        if (!screenOf(sp, sp.height * 0.45, scr)) continue
        if (scr[0] < 0 || scr[1] < 0 || scr[0] > rect.width || scr[1] > rect.height) continue
        list.push([scr[2], sp.lm])
      }
      list.sort((a, b) => a[0] - b[0])
      return list.map((e) => e[1])
    },
    update(dt: number) {
      if (state === CityState.Off) return false
      syncGroup()
      const now = performance.now()
      if (state === CityState.In || state === CityState.Out) {
        if (lastFrameTs > 0) {
          const iv = now - lastFrameTs
          flightMax = Math.max(flightMax, iv)
        }
        lastFrameTs = now
        flightFrames++
        flightSeconds += dt
        // the destination's aim settles once its plan is set up (the point of interest is a landmark in it)
        if (state === CityState.In && aim && !aim.final && t < 0.6) {
          const layer = activeDioramaLayer()
          const a = layer?.cityAim(id, layer.year)
          if (a && a.final) {
            aim = a
            focusWord = a.focus
            setupDestination()
          }
        }
        // near the end of a fly-in: wait (crawl) for the destination's ground and models
        let rate = 1
        if (state === CityState.In && t > 0.82) {
          const ready = !(deps.getGlobe()?.detailPending ?? false) && !(activeDioramaLayer()?.pending ?? false)
          if (ready) prebuilt = prebuilt || held === 0
          else if (held < HOLD_MAX) {
            rate = 0.08
            held += dt
          }
        }
        t = Math.min(1, t + (dt * rate) / duration)
        pathAt(t)
        pose.pos.copy(pathPos)
        pose.quat.copy(pathQuat)
        if (t >= 1) {
          if (state === CityState.In) {
            applyPose(to)
            clearFocus()
            endFlightStats()
            traceAdd('city.arrive', 1)
            setState(CityState.Orbit)
          } else {
            // exactly the pose the view had (the globe controls and the tilt take it up from there)
            camera.position.copy(savedPos)
            camera.quaternion.copy(savedQuat)
            camera.updateMatrixWorld()
            endFlightStats()
            const was = id
            id = -1
            state = CityState.Off
            deps.onState(CityState.Off, was)
            requestRender()
          }
          return true
        }
        applyPose(pose)
        return true
      }
      // ---- orbit ----
      let moving = false
      const k = 1 - Math.exp(-dt * 10)
      if (!dragging && Math.abs(azVel) > 0.02) {
        az += azVel * dt
        azVel *= Math.exp(-dt * 5)
        moving = true
      } else if (!dragging) azVel = 0
      if (Math.abs(distTarget - dist) > dist * 2e-3) {
        dist += (distTarget - dist) * k
        moving = true
      } else dist = distTarget
      if (Math.abs(pitchTarget - pitch) > 1e-3) {
        pitch += (pitchTarget - pitch) * k
        moving = true
      } else pitch = pitchTarget
      const pd = pivot.distanceTo(pivotTarget)
      if (pd > dist * 1e-3) {
        pivot.lerp(pivotTarget, k)
        moving = true
      } else pivot.copy(pivotTarget)
      orbitPose(pose, pivot, az, dist, pitch)
      readPose(to) // (reuse: the current camera pose, to compare)
      const changed = to.pos.distanceToSquared(pose.pos) > 1e-16 || Math.abs(to.quat.dot(pose.quat)) < 1 - 1e-12
      if (changed) applyPose(pose)
      return changed || moving
    },
  }
  return api
}
