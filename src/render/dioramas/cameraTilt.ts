// A gentle Civilization-style tilt when the camera is close to the ground, so the 3D
// settlements show their walls and roofs instead of a map of roof tops.
//
// OrbitControls keeps the camera looking straight down at the planet centre. After each
// controls.update() the camera is swung about its own right axis around the ground point
// at the screen centre, which stays put: the view leans back toward the horizon by an
// angle that grows as the camera descends (none above TILT_START). Before the next
// update the untilted pose is restored, so the controls, the fly-to and the zoom limits
// all keep working on the untilted camera; if something else moved the camera in the
// meantime (a fly-to), that pose simply becomes the new base. Between frames the camera
// is tilted, so picking matches what is on screen.

import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { requestRender } from '../invalidate.ts'

/** Altitude (planet radii above the surface) where the tilt starts, and where it is full. */
const TILT_START = 0.6
const TILT_FULL = 0.14
const MAX_TILT = THREE.MathUtils.degToRad(40)
/** Below TILT_FULL the view leans further, toward the horizon, down to the closest zoom. */
const LOW_TILT_START = 0.1
const LOW_TILT_FULL = 0.03
const LOW_EXTRA_TILT = THREE.MathUtils.degToRad(14)

/** Closest the tilted camera comes to the ground under it (planet radii). */
const TILT_CLEARANCE = 0.008

/**
 * `enabled` is polled on every update (the tilt belongs to the 3D buildings: off with them).
 * `ground(x, y, z)`: radius of the rendered ground under a world-space point (the pivot sits
 * on it, and the tilted camera stays above it); default the unit sphere.
 */
export function installCameraTilt(camera: THREE.PerspectiveCamera, controls: OrbitControls, enabled: () => boolean = () => true, ground: (x: number, y: number, z: number) => number = () => 1): void {
  const basePos = new THREE.Vector3()
  const baseQuat = new THREE.Quaternion()
  const tiltPos = new THREE.Vector3()
  const tiltQuat = new THREE.Quaternion()
  const right = new THREE.Vector3()
  const pivot = new THREE.Vector3()
  const q = new THREE.Quaternion()
  let applied = false

  const restore = () => {
    if (applied && camera.position.equals(tiltPos) && camera.quaternion.equals(tiltQuat)) {
      camera.position.copy(basePos)
      camera.quaternion.copy(baseQuat)
    }
    applied = false
  }

  const apply = () => {
    if (!enabled()) return
    const dist = camera.position.length()
    const pivotR = Math.min(dist - 1e-4, ground(camera.position.x, camera.position.y, camera.position.z))
    const alt = dist - 1
    const k = THREE.MathUtils.clamp((TILT_START - alt) / (TILT_START - TILT_FULL), 0, 1)
    if (k <= 0) return
    const k2 = THREE.MathUtils.clamp((LOW_TILT_START - alt) / (LOW_TILT_START - LOW_TILT_FULL), 0, 1)
    const tilt = MAX_TILT * k * k * (3 - 2 * k) + LOW_EXTRA_TILT * k2 * k2 * (3 - 2 * k2)
    basePos.copy(camera.position)
    baseQuat.copy(camera.quaternion)
    pivot.copy(camera.position).multiplyScalar(pivotR / dist)
    right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    q.setFromAxisAngle(right, tilt)
    camera.position.sub(pivot).applyQuaternion(q).add(pivot)
    // swung back over higher ground: lift it clear
    const r = camera.position.length()
    const under = ground(camera.position.x, camera.position.y, camera.position.z) + TILT_CLEARANCE
    if (r < under) camera.position.multiplyScalar(under / r)
    camera.quaternion.premultiply(q)
    camera.updateMatrixWorld()
    tiltPos.copy(camera.position)
    tiltQuat.copy(camera.quaternion)
    applied = true
  }

  const update = controls.update.bind(controls)
  controls.update = (deltaTime?: number | null) => {
    const wasTilted = applied
    restore()
    const changed = update(deltaTime)
    apply()
    if ((changed && applied) || wasTilted !== applied) requestRender()
    return changed
  }
}
