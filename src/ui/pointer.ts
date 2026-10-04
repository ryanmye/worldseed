// Pointer input on the globe canvas: the terrain readout follows the cursor, the
// settlement marker under it is highlighted, and a click (press and release without
// dragging) selects the nearest marker near the pointer or deselects when there is none.
// Shift-drag or right-drag places the sun over the point under the pointer.
// Hover work (terrain pick, marker pick, readout) runs at most once per animation frame,
// and the readout is rewritten only when the cell under the pointer changes.
//
// Terrain picking: the ray is marched against the rendered ground (terrainHeight.ts, at
// the zoom's relief: mountains up close stand well above the sea-level sphere), then a
// greedy walk over the cell graph finds the nearest cell centre (cheap even at 100k+ cells).
// On the flat map the ray meets the map's plane and the inverse projection gives the point
// on the sphere (mapProjection.ts mapRayHit); the same walk follows.

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
  /** Settlement under canvas CSS pixel (x, y), or -1. */
  pickSettlement(x: number, y: number): number
  hoverSettlement(id: number): void
  selectSettlement(id: number): void
  /** Sun drag: the world-space direction under the pointer (the sun goes overhead there). */
  dragSun?(dirWorld: THREE.Vector3): void
}

export interface PointerInput {
  /** Forget per-world state (call when the world changes). */
  reset(): void
}

const CLICK_SLOP_PX = 5

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
  const press = { x: 0, y: 0, down: false, moved: false }
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

  canvas.addEventListener('pointerdown', (e) => {
    press.x = e.clientX
    press.y = e.clientY
    press.down = true
    press.moved = false
    if (deps.dragSun && (e.shiftKey || e.button === 2)) {
      sunDrag.active = true
      canvas.setPointerCapture(e.pointerId)
      placeSun(e.clientX, e.clientY)
    }
  })
  canvas.addEventListener('pointermove', (e) => {
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
    press.down = false
    if (sunDrag.active) {
      sunDrag.active = false
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    }
  }
  window.addEventListener('pointerup', endPress)
  window.addEventListener('pointercancel', endPress)
  canvas.addEventListener('click', (e) => {
    updateReadout(e.clientX, e.clientY)
    if (press.moved) return
    const [x, y] = local(e)
    deps.selectSettlement(deps.pickSettlement(x, y))
  })
  canvas.addEventListener('pointerleave', () => {
    move.pending = false
    hideReadout()
    deps.hoverSettlement(-1)
  })

  return {
    reset() {
      hoverCell = 0
      shownCell = -1
      shownWorld = null
    },
  }
}
