// The sun: one shared, mutable light direction for every lit layer.
//
// SUN_DIRECTION is the effective world-space direction toward the sun. It is mutated in
// place (never reassigned), so any layer that copies it into its uniforms each frame
// (planet, clouds, atmosphere, rivers, markers, journeys, structures, the 3D models in
// src/render/dioramas) follows it without further wiring. `sunUniforms.uDaylight` is a
// shared uniform object (put the same object into a material's `uniforms`): 1 means
// "daylight everywhere", where shaders light each point from just off its own zenith
// and drop the night side (no terminator, no city lights).
//
// Modes:
//  - fixed:  the sun stays put in world space (longitude/latitude below); the planet turns beneath it.
//  - follow: the sun sits behind the camera, a little up and to the left, so whatever you look at is lit.
//  - full:   daylight everywhere (SUN_DIRECTION follows the camera as in `follow`, for layers
//            that only read the direction).
//
// `sunState.version` increments whenever the effective direction or mode changes, so a
// consumer can tell cheaply whether it needs to redraw or re-upload.

import * as THREE from 'three'

export const SunMode = {
  Fixed: 'fixed',
  Follow: 'follow',
  Full: 'full',
} as const
export type SunMode = (typeof SunMode)[keyof typeof SunMode]

export function isSunMode(s: string | null): s is SunMode {
  return s === SunMode.Fixed || s === SunMode.Follow || s === SunMode.Full
}

/** The original fixed sun (upper left of the default view). */
const DEFAULT_DIRECTION = new THREE.Vector3(-0.95, 0.38, 0.8).normalize()

/** Effective world-space direction toward the sun. Mutated in place; read it every frame. */
export const SUN_DIRECTION = DEFAULT_DIRECTION.clone()
export const SUN_COLOR = new THREE.Color(1.0, 0.96, 0.9).multiplyScalar(1.15)

/** Shared uniforms: reference these objects from a material's `uniforms` (do not clone). */
export const sunUniforms = {
  uDaylight: { value: 0 },
}

/** Sun latitude range of the fixed sun (degrees). */
export const SUN_LAT_LIMIT = 30

export interface SunState {
  mode: SunMode
  /** Fixed-sun longitude in degrees (0..360), as the camera's `az` (azimuth around world +Y from +Z). */
  lon: number
  /** Fixed-sun latitude in degrees (-SUN_LAT_LIMIT..SUN_LAT_LIMIT). */
  lat: number
  /** Increments whenever the effective direction or mode changes. */
  version: number
}

const toDeg = THREE.MathUtils.radToDeg
const toRad = THREE.MathUtils.degToRad

export const sunState: SunState = {
  mode: SunMode.Fixed,
  lon: (toDeg(Math.atan2(DEFAULT_DIRECTION.x, DEFAULT_DIRECTION.z)) + 360) % 360,
  lat: toDeg(Math.asin(DEFAULT_DIRECTION.y)),
  version: 0,
}

/** Fixed-mode world direction from longitude/latitude (degrees). */
export function sunDirectionFromLonLat(lonDeg: number, latDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const lo = toRad(lonDeg), la = toRad(latDeg)
  return out.set(Math.sin(lo) * Math.cos(la), Math.sin(la), Math.cos(lo) * Math.cos(la))
}

const fixedDir = DEFAULT_DIRECTION.clone()
let fixedIsDefault = true

function setDirection(v: THREE.Vector3) {
  if (SUN_DIRECTION.distanceToSquared(v) < 1e-12) return
  SUN_DIRECTION.copy(v)
  sunState.version++
}

/** Fixed sun at longitude/latitude (degrees); switches to fixed mode. */
export function setSunLonLat(lonDeg: number, latDeg: number) {
  sunState.lon = ((lonDeg % 360) + 360) % 360
  sunState.lat = Math.max(-SUN_LAT_LIMIT, Math.min(SUN_LAT_LIMIT, latDeg))
  sunDirectionFromLonLat(sunState.lon, sunState.lat, fixedDir)
  fixedIsDefault = false
  setSunMode(SunMode.Fixed)
  setDirection(fixedDir)
}

/** Fixed sun pointing along a world direction (latitude clamped to the allowed range). */
export function setSunToward(dirWorld: THREE.Vector3) {
  const d = tmp.copy(dirWorld).normalize()
  setSunLonLat(toDeg(Math.atan2(d.x, d.z)), toDeg(Math.asin(Math.max(-1, Math.min(1, d.y)))))
}

export function setSunMode(mode: SunMode) {
  if (mode === sunState.mode) return
  sunState.mode = mode
  sunUniforms.uDaylight.value = mode === SunMode.Full ? 1 : 0
  if (mode === SunMode.Fixed) setDirection(fixedDir)
  sunState.version++
}

/** True if the fixed sun is still the original default (no URL or user change). */
export function sunIsDefault(): boolean {
  return fixedIsDefault
}

const tmp = new THREE.Vector3()
const right = new THREE.Vector3()
const up = new THREE.Vector3()

/**
 * Per frame, before drawing: in follow/full mode, place the sun behind the camera (a
 * little up and to the left). Returns true if the effective direction changed.
 */
export function updateSun(camera: THREE.Camera): boolean {
  if (sunState.mode === SunMode.Fixed) return false
  const v0 = sunState.version
  camera.updateMatrixWorld()
  const e = camera.matrixWorld.elements
  right.set(e[0], e[1], e[2])
  up.set(e[4], e[5], e[6])
  camera.getWorldPosition(tmp).normalize()
  tmp.addScaledVector(up, 0.42).addScaledVector(right, -0.36).normalize()
  setDirection(tmp)
  return sunState.version !== v0
}
