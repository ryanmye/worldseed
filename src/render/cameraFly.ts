// Smoothly orbits the camera (around the origin, where OrbitControls targets)
// until it looks straight down at a given world-space direction.

import * as THREE from 'three'

export interface CameraFly {
  /**
   * Start flying so the camera ends up on `dirWorld` (normalised internally) at distance `dist`, over `seconds` (default:
   * the fly's own duration; 0 cuts there at once, for reduced motion).
   */
  flyTo(dirWorld: THREE.Vector3, dist: number, seconds?: number): void
  cancel(): void
  readonly active: boolean
  /** Advance; call once per frame before controls.update(). */
  update(dt: number): void
}

export function createCameraFly(camera: THREE.Camera, duration = 0.9): CameraFly {
  const from = new THREE.Vector3()
  const to = new THREE.Vector3()
  const rot = new THREE.Quaternion()
  const partial = new THREE.Quaternion()
  const identity = new THREE.Quaternion()
  let fromDist = 1
  let toDist = 1
  let t = 0
  let active = false
  let length = duration

  return {
    flyTo(dirWorld: THREE.Vector3, dist: number, seconds = duration) {
      length = Math.max(0, seconds)
      fromDist = camera.position.length()
      from.copy(camera.position).normalize()
      to.copy(dirWorld).normalize()
      toDist = dist
      rot.setFromUnitVectors(from, to)
      t = 0
      active = true
    },
    cancel() {
      active = false
    },
    get active() {
      return active
    },
    update(dt: number) {
      if (!active) return
      t = length > 0 ? Math.min(1, t + dt / length) : 1
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      partial.slerpQuaternions(identity, rot, e)
      camera.position.copy(from).applyQuaternion(partial).multiplyScalar(fromDist + (toDist - fromDist) * e)
      camera.lookAt(0, 0, 0)
      if (t >= 1) active = false
    },
  }
}
