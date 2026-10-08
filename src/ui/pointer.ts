// Pointer input on the globe canvas: the terrain readout follows the cursor, the
// settlement marker under it is highlighted, and a click (press and release without
// dragging) selects the nearest marker near the pointer or deselects when there is none.
// A click that hits no marker falls back to selecting the faction owning the cell under
// it, through deps.selectFactionAt (a no-op off the Factions view or over unclaimed land).
// Shift-drag or right-drag places the sun over the point under the pointer.
// Hover work (terrain pick, marker pick, readout) runs at most once per animation frame,
// and the readout is rewritten only when the cell under the pointer changes.
//
// Terrain picking: the ray is marched against the rendered ground (terrainHeight.ts, at
// the zoom's relief: mountains up close stand well above the sea-level sphere), then a
// greedy walk over the cell graph finds the nearest cell centre (cheap even at 100k+ cells).
// On the flat map the ray meets the map's plane and the inverse projection gives the point
// on the sphere (mapProjection.ts mapRayHit); the same walk follows.
//
// Touch (pointerType 'touch'; mouse and pen keep the paths above): there is no hover, so a
// moving finger shows no readout and highlights nothing. A tap (press and release within
// TOUCH_SLOP_PX, one finger) selects the town within TOUCH_PICK_SLOP_PX of it; a tap on empty
// ground shows the readout of the place tapped, and the next tap hides it. A long press
// (LONG_PRESS_MS without moving) shows the readout there too, and its release is no tap.
// The pick modes (hearths, the Nudge panel) take a tap as their pick, as a click.

import * as THREE from 'three'
import type { World } from '../contract.ts'
import { lakeArray, type GlobeMesh } from '../render/globe.ts'
import { located, RELIEF_NEAR, reliefRadius, renderedGroundRadius } from '../render/terrainHeight.ts'
import { flat, mapRayHit } from '../render/mapProjection.ts'
import type { Readout } from './overlay.ts'

export interface PointerDeps {
  canvas: HTMLCanvasElement
  camera: THREE.Camera
  getWorld(): World | null
  getGlobe(): GlobeMesh | null
  setReadout(r: Readout | null): void
  /** Settlement under canvas CSS pixel (x, y), or -1; `slopPx`: how far beyond a marker still counts (default: the mouse's). */
  pickSettlement(x: number, y: number, slopPx?: number): number
  hoverSettlement(id: number): void
  /** Taps (touch) belong to another view just now (the city view): no selection, no readout. */
  tapsElsewhere?(): boolean
  selectSettlement(id: number): void
  /**
   * A click hit no settlement marker and landed on cell `cell`: offer it as a faction
   * territory pick (selects or deselects the polity owning it, if any and if the Factions
   * layer or view is on; a no-op otherwise). Optional: without it, such clicks only deselect.
   */
  selectFactionAt?(cell: number): void
  /** A place is being chosen (the Nudge panel's pick mode): the click on cell `cell` goes there instead; true if it took it. */
  pickCell?(cell: number): boolean
  /** Sun drag: the world-space direction under the pointer (the sun goes overhead there). */
  dragSun?(dirWorld: THREE.Vector3): void
}

export interface PointerInput {
  /** Forget per-world state (call when the world changes). */
  reset(): void
}

const CLICK_SLOP_PX = 5
/** A finger moves a little while tapping: up to this far is still a tap. */
export const TOUCH_SLOP_PX = 10
/** How far beyond a marker a tap still picks it (a fingertip is ~10 mm across). */
export const TOUCH_PICK_SLOP_PX = 20
const LONG_PRESS_MS = 500

function nearestCell(world: World, x: number, y: number, z: number, start: number): number {
  const { positions: P, neighborOffsets: off, neighbors: nb } = world.grid
  let cur = start < world.grid.cellCount ? start : 0
  let best = P[cur * 3] * x + P[cur * 3 + 1] * y + P[cur * 3 + 2] * z
  for (let iter = 0; iter < 4096; iter++) {
    let next = -1
    for (let k = off[cur]; k < off[cur + 1]; k++) {
      const j = nb[k]
      const d = P[j * 3] * x + P[j * 3 + 1] * y + P[j * 3 + 2] * z
      if (d > best) {
        best = d
        next = j
      }
    }
    if (next < 0) break
    cur = next
  }
  return cur
}

export function attachPointer(deps: PointerDeps): PointerInput {
  const { canvas } = deps
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const planetSphere = new THREE.Sphere(new THREE.Vector3(), 1)
  const invMatrix = new THREE.Matrix4()
  const localRay = new THREE.Ray()
  const hitPoint = new THREE.Vector3()
  let hoverCell = 0
  /** Cell shown in the readout, -1 = hidden (avoids rewriting identical HTML). */
  let shownCell = -1
  let shownWorld: World | null = null
  const press = { x: 0, y: 0, down: false, moved: false, touch: false, longPressed: false }
  /** Fingers on the canvas (a second one makes the press a gesture, not a tap). */
  const touches = new Set<number>()
  let longTimer = 0
  /** The readout shows for a tap or a long press (hidden by the next tap, not by the finger leaving). */
  let touchReadout = false
  const sunDrag = { active: false }
  const move = { x: 0, y: 0, scheduled: false, pending: false }
  const worldSphere = new THREE.Sphere(new THREE.Vector3(), 1)

  const hideReadout = () => {
    if (shownCell >= 0) deps.setReadout(null)
    shownCell = -1
  }

  const outerSphere = new THREE.Sphere(new THREE.Vector3(), 1)
  const tmpA = new THREE.Vector3()
  /** First point where the ray meets the rendered ground (into `out`); false if it misses the planet. */
  function groundHit(w: World, ray: THREE.Ray, out: THREE.Vector3): boolean {
    outerSphere.radius = reliefRadius(1 + RELIEF_NEAR * 1.4)
    // from where the ray enters the shell the ground can reach (or from the camera, inside it)
    let t0 = 0
    if (ray.origin.length() > outerSphere.radius) {
      if (!ray.intersectSphere(outerSphere, tmpA)) return false
      t0 = Math.max(0, tmpA.sub(ray.origin).dot(ray.direction))
    }
    // beyond the sea-level sphere nothing can be hit; a grazing ray may miss it and still meet a peak
    const t1 = ray.intersectSphere(planetSphere, out) ? out.sub(ray.origin).dot(ray.direction) : t0 + 2 * outerSphere.radius
    let start = hoverCell
    const above = (t: number) => {
      ray.at(t, tmpA)
      const r = tmpA.length()
      const g = renderedGroundRadius(w, tmpA.x / r, tmpA.y / r, tmpA.z / r, start)
      start = located.cell
      return r - g
    }
    const STEPS = 40
    let a = t0
    if (above(t0) <= 0) { ray.at(t0, out); return true }
    for (let k = 1; k <= STEPS; k++) {
      const b = t0 + ((t1 - t0) * k) / STEPS
      const fb = above(b)
      if (fb <= 0) {
        // refine between a (above) and b (below)
        let lo = a, hi = b
        for (let i = 0; i < 10; i++) {
          const m = (lo + hi) / 2
          if (above(m) > 0) lo = m
          else hi = m
        }
        ray.at(hi, out)
        return true
      }
      a = b
    }
    if (t1 < t0 + 2 * outerSphere.radius) { ray.at(t1, out); return true }
    return false
  }

  function setRay(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, deps.camera)
  }

  /** Sun overhead at the point under the pointer (or the nearest point of the limb). */
  function placeSun(clientX: number, clientY: number) {
    if (!deps.dragSun) return
    setRay(clientX, clientY)
    const ray = raycaster.ray
    if (flat.t > 0) {
      // the point of the map under the pointer, as a direction in world space
      const globe = deps.getGlobe()
      if (!globe) return
      globe.mesh.updateWorldMatrix(true, false)
      invMatrix.copy(globe.mesh.matrixWorld).invert()
      localRay.copy(ray).applyMatrix4(invMatrix)
      if (!mapRayHit(localRay, hitPoint)) return
      deps.dragSun(hitPoint.transformDirection(globe.mesh.matrixWorld))
      return
    }
    if (!ray.intersectSphere(worldSphere, hitPoint)) ray.closestPointToPoint(worldSphere.center, hitPoint)
    if (hitPoint.lengthSq() < 1e-8) return
    deps.dragSun(hitPoint.normalize())
  }

  function updateReadout(clientX: number, clientY: number) {
    const globe = deps.getGlobe()
    const w = deps.getWorld()
    if (!globe || !w) return
    setRay(clientX, clientY)
    globe.mesh.updateWorldMatrix(true, false)
    invMatrix.copy(globe.mesh.matrixWorld).invert()
    localRay.copy(raycaster.ray).applyMatrix4(invMatrix)
    if (flat.t > 0 ? !mapRayHit(localRay, hitPoint) : !groundHit(w, localRay, hitPoint)) {
      hideReadout()
      return
    }
    hitPoint.normalize()
    const cell = nearestCell(w, hitPoint.x, hitPoint.y, hitPoint.z, hoverCell)
    hoverCell = cell
    if (cell === shownCell && w === shownWorld) return
    shownCell = cell
    shownWorld = w
    const lake = lakeArray(w)
    deps.setReadout({
      biome: w.biome[cell] as Readout['biome'],
      elevation: w.elevation[cell],
      temperature: w.temperature[cell],
      rainfall: w.rainfall[cell],
      lake: lake !== null && lake[cell] === 1,
      cell,
    })
  }

  const local = (e: MouseEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  /** Coalesced hover: the latest pointer position, processed once per animation frame. */
  function processMove() {
    move.scheduled = false
    if (!move.pending) return
    move.pending = false
    updateReadout(move.x, move.y)
    if (press.down) return
    const rect = canvas.getBoundingClientRect()
    deps.hoverSettlement(deps.pickSettlement(move.x - rect.left, move.y - rect.top))
  }

  const cancelLongPress = () => {
    if (longTimer) window.clearTimeout(longTimer)
    longTimer = 0
  }
  canvas.addEventListener('pointerdown', (e) => {
    const touch = e.pointerType === 'touch'
    if (touch) {
      touches.add(e.pointerId)
      if (touches.size > 1) {
        // a pinch or a two-finger drag
        press.moved = true
        cancelLongPress()
        return
      }
    }
    press.x = e.clientX
    press.y = e.clientY
    press.down = true
    press.moved = false
    press.touch = touch
    press.longPressed = false
    if (touch) {
      cancelLongPress()
      const x = e.clientX, y = e.clientY
      longTimer = window.setTimeout(() => {
        longTimer = 0
        if (!press.down || press.moved || touches.size !== 1) return
        press.longPressed = true
        hideReadout()
        updateReadout(x, y)
        touchReadout = shownCell >= 0
      }, LONG_PRESS_MS)
      return
    }
    if (deps.dragSun && (e.shiftKey || e.button === 2)) {
      sunDrag.active = true
      canvas.setPointerCapture(e.pointerId)
      placeSun(e.clientX, e.clientY)
    }
  })
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      // (no hover on touch: a moving finger only turns or pans the view)
      if (press.down && press.touch && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TOUCH_SLOP_PX) {
        press.moved = true
        cancelLongPress()
      }
      return
    }
    if (press.down && Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP_PX) press.moved = true
    if (sunDrag.active) {
      placeSun(e.clientX, e.clientY)
      return
    }
    move.x = e.clientX
    move.y = e.clientY
    move.pending = true
    if (!move.scheduled) {
      move.scheduled = true
      requestAnimationFrame(processMove)
    }
  })
  const endPress = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId)
      cancelLongPress()
      // (the last finger of a gesture lifting is no tap either)
      if (touches.size > 0) return
    }
    press.down = false
    if (sunDrag.active) {
      sunDrag.active = false
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    }
  }
  window.addEventListener('pointerup', endPress)
  window.addEventListener('pointercancel', endPress)
  /** A tap (touch): see the header. */
  function tap(e: MouseEvent) {
    if (press.moved || press.longPressed) return
    if (deps.tapsElsewhere?.()) {
      touchReadout = false
      hideReadout()
      return
    }
    const hadReadout = touchReadout
    touchReadout = false
    hideReadout()
    updateReadout(e.clientX, e.clientY)
    const cell = shownCell
    if (cell >= 0 && deps.pickCell?.(cell)) {
      hideReadout()
      return
    }
    const [x, y] = local(e)
    const id = deps.pickSettlement(x, y, TOUCH_PICK_SLOP_PX)
    deps.selectSettlement(id)
    if (id < 0 && cell >= 0) deps.selectFactionAt?.(cell)
    // on empty ground the readout stays up (unless this tap was the one closing it)
    if (id >= 0 || hadReadout) hideReadout()
    else touchReadout = shownCell >= 0
  }
  canvas.addEventListener('contextmenu', (e) => {
    // (a long press: the readout, not the browser's menu)
    if (press.touch) e.preventDefault()
  })
  canvas.addEventListener('click', (e) => {
    if (press.touch) return tap(e)
    updateReadout(e.clientX, e.clientY)
    if (press.moved) return
    if (shownCell >= 0 && deps.pickCell?.(shownCell)) return
    const [x, y] = local(e)
    const id = deps.pickSettlement(x, y)
    deps.selectSettlement(id)
    // no marker under the click: offer the cell under it (if the ray hit one) as a faction pick
    if (id < 0 && shownCell >= 0) deps.selectFactionAt?.(shownCell)
  })
  canvas.addEventListener('pointerleave', (e) => {
    // (a finger leaves at every lift: the tap's readout stays)
    if (e.pointerType === 'touch') return
    move.pending = false
    hideReadout()
    deps.hoverSettlement(-1)
  })

  return {
    reset() {
      hoverCell = 0
      shownCell = -1
      shownWorld = null
      touchReadout = false
    },
  }
}
