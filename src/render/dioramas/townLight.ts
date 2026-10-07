// The town's light in the city view, from the sun's elevation over the town (degrees): the
// colour and strength of the direct sun, the colour of the sky's ambient light, and how
// much of the day there is (0 at night: windows and street lamps on). Evaluated on the CPU
// once per sun change (layer.ts), written to four uniforms (material.ts uCity*). The elevation
// thresholds are shared with the city sky (sunRamps.ts).
//
//  - Sun: white-yellow and full above ~15 degrees; below, it warms toward orange and
//    weakens (the light crosses more air), and fades out just below the horizon.
//  - Sky: blue-grey by day, violet-orange at dusk (sun a few degrees either side of the
//    horizon), deep blue at night. In the units of the models' sky term (material.ts SKY
//    x 0.08 by day), so the day value matches the globe's look.
//  - Day: 1 above ~3 degrees, 0 below ~-4 (windows, lamps).

import * as THREE from 'three'
import { SUN_COLOR } from '../sun.ts'
import { DAY, DUSK, LAMPS, WARM, WARM_POW } from '../sunRamps.ts'

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Direct sun near the horizon (linear RGB, before strength). */
const SUN_LOW = new THREE.Color(1.0, 0.48, 0.2)
/** Sky ambient by day, at dusk and at night (linear RGB, models' sky units). */
const SKY_DAY = new THREE.Color(0.026, 0.04, 0.07)
const SKY_DUSK = new THREE.Color(0.05, 0.032, 0.045)
const SKY_NIGHT = new THREE.Color(0.014, 0.022, 0.062)

export interface TownLight {
  /** Direct sun colour x strength (0 at night). */
  sun: THREE.Color
  /** The same without the fade at the horizon (for a surface whose own terminator does that: the globe). */
  sunHigh: THREE.Color
  /** Sky ambient colour. */
  sky: THREE.Color
  /** 1 by day, 0 at night. */
  day: number
}

export function newTownLight(): TownLight {
  return { sun: SUN_COLOR.clone(), sunHigh: SUN_COLOR.clone(), sky: SKY_DAY.clone(), day: 1 }
}

/** The town's light for a sun `elevDeg` degrees above its horizon. */
export function townLight(elevDeg: number, out: TownLight): TownLight {
  const e = elevDeg
  // warming: none above 15 degrees, nearly all of it at the horizon
  const warm = Math.pow(1 - smooth(WARM[0], WARM[1], e), WARM_POW)
  out.sunHigh.copy(SUN_COLOR).lerp(tmp.copy(SUN_LOW).multiplyScalar(SUN_COLOR.r), warm).multiplyScalar(1 - 0.45 * warm)
  out.sun.copy(out.sunHigh).multiplyScalar(smooth(-1.2, 2.5, e))
  // sky: night -> dusk -> day
  out.sky.copy(SKY_NIGHT).lerp(SKY_DUSK, smooth(DUSK[0], DUSK[1], e)).lerp(SKY_DAY, smooth(DAY[0], DAY[1], e))
  out.day = smooth(LAMPS[0], LAMPS[1], e)
  return out
}

const tmp = new THREE.Color()
