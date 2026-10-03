// Pointer input on the globe canvas: the terrain readout follows the cursor, the
// settlement marker under it is highlighted, and a click (press and release without
// dragging) selects the nearest marker near the pointer or deselects when there is none.
// Shift-drag or right-drag places the sun over the point under the pointer.
// Hover work (terrain pick, marker pick, readout) runs at most once per animation frame,
// and the readout is rewritten only when the cell under the pointer changes.
//
// Terrain picking: ray vs. the unit sphere in planet space, then a greedy walk over
// the cell graph to the nearest cell centre (cheap even at 100k+ cells).

import * as THREE from 'three'
import type { World } from '../contract.ts'
import { lakeArray, type GlobeMesh } from '../render/globe.ts'
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
    if (!localRay.intersectSphere(planetSphere, hitPoint)) {
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
