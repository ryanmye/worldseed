// Camera controls of the flat map: drag to pan (east-west endlessly: the central meridian
// follows the view), wheel or pinch to zoom toward the pointer, a glide after a drag with the
// globe's damping, no tilt and no rotation.
//
// The map lies tangent to the globe under the camera (mapProjection.ts), so the camera is
// kept exactly where a globe camera looking at the map centre would be: on the ray through
// the centre (longitude lon0, latitude lat0 in planet space) at altitude D, north up. The
// controls own (lon0, lat0, D) and write the camera from them every frame (the planet may
// turn underneath, carrying the camera with it); sync() takes them back from the camera
// after something else moved it (a fly-to, the switch from the globe).

import * as THREE from 'three'
import { equalEarthKx, equalEarthLat, equalEarthY, X_EDGE, Y_POLE } from './mapProjection.ts'
import { getFreeViewportInset } from '../ui/overlay.ts'

export interface MapControls {
  /** Listening to input (map mode, not during the morph). */
  enabled: boolean
  /** Take the view from the camera (direction and distance), clamped to the map's limits. */
  sync(): void
  /** Per frame: input, glide and zoom easing; writes the camera. True if the view moved. */
  update(dt: number): boolean
  /** Write the camera from the current view (after the planet turned). */
  apply(): void
  /** Stop gliding and easing. */
  stop(): void
  /** Altitude at which the whole map fits the window (with a margin), and the current one. */
  fitAltitude(): number
  /**
   * Snap back to the whole-world fit, centred — but only if the view is still (close to)
   * that fit: a real user pan or zoom (or a sync() that lands away from it) marks the view
   * dirty and this becomes a no-op, so a panel opening or resizing never fights a view the
   * user chose. Called from main.ts when the free viewport rect changes.
   */
  refitWhole(): void
  readonly altitude: number
  /** The view's latitude and longitude (planet space, radians). */
  readonly lat: number
  readonly lon: number
}

/** Closest altitude over the map (the globe's closest zoom; no 3D towns on the map). */
export const MAP_MIN_ALT = 0.03
const MAX_LAT = THREE.MathUtils.degToRad(89.5)
const DAMPING_PER_60HZ_FRAME = 0.08
const ZOOM_EASE_PER_60HZ_FRAME = 0.28

export function createMapControls(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, planet: THREE.Object3D, onStart: () => void): MapControls {
  let lon0 = 0, lat0 = 0, alt = 2
  let altTarget = 2
  /** Zoom anchor: the pointer's offset from the screen centre (CSS px) and its latitude. */
  let anchorX = 0, anchorY = 0
  /** Glide velocity in screen px per second (x right, y down). */
  let vx = 0, vy = 0
  let moved = false
  /** Set by a real user pan/zoom (or a sync() landing away from the whole-world fit); see refitWhole. */
  let dirty = false
  const pointers = new Map<number, { x: number; y: number }>()
  let pinchDist = 0
  let lastMove = 0
  const q = new THREE.Quaternion()
  const m = new THREE.Matrix4()
  const e = new THREE.Vector3(), n = new THREE.Vector3(), u = new THREE.Vector3()

  const tanHalf = () => Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
  /** Map units per CSS pixel at altitude a. */
  const unitsPerPx = (a: number) => (2 * a * tanHalf()) / Math.max(1, canvas.clientHeight || window.innerHeight)
  /** Fraction of the window's width/height the side panels, top bar and timeline leave free (ui/overlay.ts). */
  const freeFractions = () => {
    const vw = canvas.clientWidth || window.innerWidth
    const vh = canvas.clientHeight || window.innerHeight
    const inset = getFreeViewportInset()
    return { w: Math.max(0.2, (vw - inset.left - inset.right) / vw), h: Math.max(0.2, (vh - inset.top - inset.bottom) / vh) }
  }
  const fit = () => {
    const t = tanHalf()
    const { w, h } = freeFractions()
    // (a little short of the free rect: the panels, and a margin, must not cover it)
    return Math.max((Y_POLE * 1.12) / (t * h), (X_EDGE * 1.04) / (t * camera.aspect * w))
  }
  const maxAlt = () => fit() * 1.3
  /** Map y the centre may reach: the map's top edge down to mid screen up close, less as the map shrinks, centred once it fits. */
  const yLimit = (a: number) => Math.min(equalEarthY(MAX_LAT), Math.max(0, 2 * (Y_POLE - a * tanHalf())))
  const clampLat = () => {
    const y = equalEarthY(lat0)
    const lim = yLimit(alt)
    if (Math.abs(y) > lim) lat0 = equalEarthLat(Math.sign(y) * lim)
  }
  const wrapLon = (l: number) => l - 2 * Math.PI * Math.floor((l + Math.PI) / (2 * Math.PI))

  /** Pan by screen pixels (x right, y down) at the pointer's screen offset py from the centre (for the east-west scale). */
  const panPx = (dx: number, dy: number, py: number) => {
    const k = unitsPerPx(alt)
    const y = equalEarthY(lat0)
    // north-south: map y; east-west: map x over the east-west scale at the pointer's latitude
    const yp = Math.max(-Y_POLE, Math.min(Y_POLE, y - py * k))
    const latP = Math.max(-1.25, Math.min(1.25, equalEarthLat(yp)))
    lat0 = equalEarthLat(Math.max(-Y_POLE, Math.min(Y_POLE, y + dy * k)))
    lon0 = wrapLon(lon0 - (dx * k) / equalEarthKx(latP))
    clampLat()
    moved = true
  }

  const apply = () => {
    const sl = Math.sin(lon0), cl = Math.cos(lon0), sp = Math.sin(lat0), cp = Math.cos(lat0)
    e.set(cl, 0, -sl)
    n.set(-sp * sl, cp, -sp * cl)
    u.set(cp * sl, sp, cp * cl)
    planet.updateWorldMatrix(true, false)
    planet.getWorldQuaternion(q)
    e.applyQuaternion(q)
    n.applyQuaternion(q)
    u.applyQuaternion(q)
    camera.position.copy(u).multiplyScalar(1 + alt).add(planet.getWorldPosition(tmpP))
    m.makeBasis(e, n, u)
    camera.quaternion.setFromRotationMatrix(m)
    camera.updateMatrixWorld()
  }
  const tmpP = new THREE.Vector3()

  /**
   * Screen point (canvas-relative CSS px) that (lon0, lat0) actually renders at: the canvas
   * centre, shifted by the same amount main.ts offsets the camera's view by (setViewOffset,
   * recentring it in the free rect left by the side panels). Pointer math (the zoom anchor,
   * the pinch midpoint) is relative to this, not the canvas centre, so it keeps tracking the
   * map point under the pointer rather than the point under the covered canvas centre.
   */
  const screenCenter = (r: { width: number; height: number }) => {
    const inset = getFreeViewportInset()
    return [r.width / 2 + (inset.left - inset.right) / 2, r.height / 2 + (inset.top - inset.bottom) / 2]
  }
  const local = (ev: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect()
    const [cx, cy] = screenCenter(r)
    return [ev.clientX - r.left - cx, ev.clientY - r.top - cy]
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (!api.enabled || ev.button !== 0 || ev.shiftKey) return
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
    canvas.setPointerCapture(ev.pointerId)
    vx = vy = 0
    altTarget = alt
    lastMove = performance.now()
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
    }
    dirty = true
    onStart()
  })
  canvas.addEventListener('pointermove', (ev) => {
    const p = pointers.get(ev.pointerId)
    if (!p || !api.enabled) return
    const dx = ev.clientX - p.x, dy = ev.clientY - p.y
    if (pointers.size >= 2) {
      // pinch: zoom about the midpoint, pan with it
      p.x = ev.clientX
      p.y = ev.clientY
      const [a, b] = [...pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const r = canvas.getBoundingClientRect()
      const [cx, cy] = screenCenter(r)
      const mx = (a.x + b.x) / 2 - r.left - cx, my = (a.y + b.y) / 2 - r.top - cy
      panPx(dx / 2, dy / 2, my)
      if (pinchDist > 0 && d > 0) zoomBy(pinchDist / d, mx, my, true)
      pinchDist = d
      return
    }
    p.x = ev.clientX
    p.y = ev.clientY
    const [, py] = local(ev)
    panPx(dx, dy, py)
    // glide velocity: a short running average of the drag
    const now = performance.now()
    const dt = Math.max(1, now - lastMove) / 1000
    lastMove = now
    const k = Math.min(1, dt / 0.05)
    vx += (dx / dt - vx) * k
    vy += (dy / dt - vy) * k
    anchorY = py
  })
  const end = (ev: PointerEvent) => {
    if (!pointers.delete(ev.pointerId)) return
    if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId)
    // a pause before letting go: no glide
    if (performance.now() - lastMove > 80) vx = vy = 0
    if (pointers.size < 2) pinchDist = 0
  }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  canvas.addEventListener(
    'wheel',
    (ev) => {
      if (!api.enabled) return
      ev.preventDefault()
      const dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY
      const [x, y] = local(ev)
      dirty = true
      onStart()
      // as the globe's wheel (OrbitControls, zoom speed 0.8): the camera's distance from the
      // planet's centre scales by 0.95^(0.8 per 100 px of wheel), so it slows down far out
      const d = Math.pow(0.95, (0.8 * dy) / 100)
      zoomBy(((1 + altTarget) / d - 1) / altTarget, x, y, false)
    },
    { passive: false },
  )

  /** Zoom by factor f about screen offset (x, y) from the centre: at once, or eased in update(). */
  function zoomBy(f: number, x: number, y: number, now: boolean) {
    anchorX = x
    anchorY = y
    altTarget = Math.min(maxAlt(), Math.max(MAP_MIN_ALT, altTarget * f))
    if (now) setAlt(altTarget)
    moved = true
  }
  /** Changes the altitude keeping the map point under the zoom anchor in place. */
  function setAlt(a: number) {
    const k0 = unitsPerPx(alt), k1 = unitsPerPx(a)
    alt = a
    // the anchor's map offset shrinks or grows with the zoom: move the centre by the difference
    // (in pixels at the new scale, as panPx takes them)
    const f = 1 - k0 / k1
    panPx(anchorX * f, anchorY * f, anchorY)
  }

  const api: MapControls = {
    enabled: false,
    sync() {
      planet.updateWorldMatrix(true, false)
      tmpP.copy(camera.position)
      planet.worldToLocal(tmpP)
      const d = tmpP.length() || 1
      lat0 = Math.max(-MAX_LAT, Math.min(MAX_LAT, Math.asin(Math.max(-1, Math.min(1, tmpP.y / d)))))
      lon0 = Math.abs(tmpP.x) + Math.abs(tmpP.z) < 1e-12 ? lon0 : Math.atan2(tmpP.x, tmpP.z)
      // (beyond the map's limits it eases back inside them: see update)
      alt = Math.max(MAP_MIN_ALT, d - 1)
      altTarget = Math.min(maxAlt(), alt)
      vx = vy = 0
      // a view taken from the camera counts as dirty unless it lands on the whole-world fit,
      // centred (e.g. the initial switch to the map, with no dist/lon/lat override). The
      // tolerance (10%) must clear the margin the default view's own distance is computed
      // with (fitAltitude() * 1.02, a 2% margin, in main.ts) by a wide floating-point-safe
      // gap, or the default view's own sync() call could register as dirty on rounding noise
      // alone and permanently defeat refitWhole() for a user who never touched the view.
      dirty = Math.abs(alt - fit()) > fit() * 0.1 || Math.abs(lat0) > 1e-3 || Math.abs(wrapLon(lon0)) > 1e-3
    },
    update(dt: number) {
      const was = moved
      moved = false
      let changed = was
      if (pointers.size === 0 && (vx !== 0 || vy !== 0)) {
        panPx(vx * dt, vy * dt, anchorY)
        const damp = Math.pow(1 - DAMPING_PER_60HZ_FRAME, Math.min(Math.max(dt * 60, 0.25), 6))
        vx *= damp
        vy *= damp
        if (Math.hypot(vx, vy) < 4) vx = vy = 0
        changed = true
        moved = false
      }
      if (Math.abs(altTarget - alt) > 1e-6 * alt) {
        const k = 1 - Math.pow(1 - ZOOM_EASE_PER_60HZ_FRAME, Math.min(Math.max(dt * 60, 0.25), 6))
        const a = Math.abs(altTarget - alt) < 1e-4 * alt ? altTarget : alt + (altTarget - alt) * k
        setAlt(a)
        moved = false
        changed = true
      }
      // outside the limits (the switch from a distant globe, a smaller window): ease inside
      const ease = 1 - Math.pow(1 - 0.16, Math.min(Math.max(dt * 60, 0.25), 6))
      const amax = maxAlt()
      if (alt > amax) {
        alt = alt - amax < 1e-4 ? amax : alt + (amax - alt) * ease
        altTarget = Math.min(altTarget, amax)
        changed = true
      }
      const y = equalEarthY(lat0)
      const lim = yLimit(alt)
      if (Math.abs(y) > lim) {
        const to = Math.sign(y) * lim
        lat0 = equalEarthLat(Math.abs(y - to) < 1e-5 ? to : y + (to - y) * ease)
        changed = true
      }
      apply()
      return changed
    },
    apply,
    stop() {
      vx = vy = 0
      altTarget = alt
    },
    fitAltitude: fit,
    refitWhole() {
      if (dirty) return
      altTarget = fit()
      alt = altTarget
      lat0 = 0
      lon0 = 0
      apply()
    },
    get altitude() {
      return alt
    },
    get lat() {
      return lat0
    },
    get lon() {
      return lon0
    },
  }
  return api
}
