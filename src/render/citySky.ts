// The sky seen from low down (the city view, the closest zoom): a dome drawn behind
// everything, coloured by a cheap analytic model of the sun's height at the camera.
//
// Model (CITY_SKY_GLSL, shared with the atmosphere's ground haze and the clouds seen from
// below, so all three agree): for a view direction `rd`, the local up `up` (the camera's
// direction from the planet centre: the town's vertical) and the sun `sun`, with
//   sunH = dot(up, sun)  (sine of the sun's elevation)
//   e    = dot(rd, up)   (sine of the view's elevation)
//   tw   = how far toward the sun's azimuth the view looks (0 opposite .. 1 toward it)
// a few smoothstep ramps on sunH set the day amount (deep blue zenith, paler horizon), the
// warmth of sunset and sunrise (below about 15 degrees: an orange-pink band toward the sun,
// violet opposite, a reddening horizon), the twilight and the night (the app's dark, with a
// faint glow low where the sun went down). No scattering integral: a handful of mixes.
//
// The dome is display-referred (not tone-mapped), kept a little darker than the sunlit ground
// the planet shader draws. Its uniforms (sun, strength) are set on drawn frames only, in
// update() from main.ts's draw; nothing runs between them. It is off (no draw call) above
// the low-altitude range, on the flat map, and on the start page.

import * as THREE from 'three'
import { PLANET_RADIUS } from './globe.ts'
import { SUN_DIRECTION, sunUniforms } from './sun.ts'
import { DUSK, LAMPS, SUN_RAMPS_GLSL } from './sunRamps.ts'

/**
 * citySkyColor(rd, up, sun): linear sky colour (display-referred) along unit view direction rd.
 * citySkyHorizon(rd, up, sun): the colour at the horizon below rd (the haze's colour).
 * citySkyLight(up, sun): the overall sky brightness, 0 at night .. 1 by day.
 */
export const CITY_SKY_GLSL = /* glsl */ `
${SUN_RAMPS_GLSL}
float citySkyLight(vec3 up, vec3 sun) {
  // the twilight sky (a third as bright) from just below the horizon, full day once the lamps go out
  float E = sunElevDeg(dot(up, sun));
  return rampDusk(E) * mix(0.3, 1.0, rampLamps(E));
}
vec3 citySkyColor(vec3 rd, vec3 up, vec3 sun) {
  float sunH = dot(up, sun);
  float e = clamp(dot(rd, up), 0.0, 1.0);
  // toward the sun's azimuth (0 opposite .. 1 toward it)
  vec3 rh = rd - up * dot(rd, up);
  vec3 sh = sun - up * sunH;
  float az = dot(rh, sh) * inversesqrt(max(dot(rh, rh) * dot(sh, sh), 1e-8));
  float tw = 0.5 + 0.5 * az;
  float cosT = dot(rd, sun);
  // ramps on the sun's elevation (degrees; the town's light uses the same, sunRamps.ts)
  float E = sunElevDeg(sunH);
  float day = rampDay(E);                             // blue: full day above 12 deg
  float warm = rampWarm(E) * rampDusk(E);             // sunset colours below 16 deg, gone by deep twilight
  float lit = citySkyLight(up, sun);                  // sky light at all
  // day: deep blue at the zenith, paler toward the horizon
  vec3 zen = vec3(0.035, 0.12, 0.42);
  vec3 hor = vec3(0.3, 0.45, 0.66);
  // sunset: the horizon band orange toward the sun, pink above it, violet opposite
  vec3 horWarm = mix(vec3(0.3, 0.16, 0.34), mix(vec3(0.7, 0.24, 0.2), vec3(0.62, 0.17, 0.03), smoothstep(0.6, 1.0, tw)), smoothstep(0.25, 0.9, tw));
  vec3 zenWarm = mix(vec3(0.04, 0.05, 0.2), vec3(0.08, 0.08, 0.24), tw);
  vec3 z = mix(zen * mix(0.5, 1.0, day), zenWarm, warm * 0.85);
  vec3 h = mix(hor * mix(0.7, 1.0, day), horWarm, warm);
  // the horizon band: thin and red at sunset (wider toward the sun), broad and pale by day
  float bw = mix(0.55, mix(0.06, 0.13, tw * tw), warm);
  float band = exp(-e / bw);
  vec3 col = mix(z, h, band);
  // a pink layer above the band, toward the sun and (fainter) opposite: the belt of Venus
  col += vec3(0.5, 0.2, 0.3) * warm * exp(-abs(e - 0.12) / 0.1) * (0.25 + 0.45 * tw) * 0.5;
  // brightening around the sun (forward scattering): white by day, golden low down
  float ct = max(cosT, 0.0);
  float fwd = mix(0.12 * pow(ct, 6.0), 0.24 * pow(ct, 48.0) + 0.1 * pow(ct, 5.0), warm);
  col += mix(vec3(0.9, 0.85, 0.75), vec3(1.0, 0.45, 0.12), warm) * fwd * rampDusk(E);
  col *= lit;
  // night: the app's dark, and a faint glow low where the sun went down
  float glow = smoothstep(-24.0, -2.0, E) * (1.0 - lit) * pow(tw, 4.0) * exp(-e / 0.06);
  col += vec3(0.11, 0.045, 0.03) * glow;
  return max(col, vec3(0.0003, 0.0006, 0.0015));
}
vec3 citySkyHorizon(vec3 rd, vec3 up, vec3 sun) {
  vec3 rh = rd - up * dot(rd, up);
  float l = length(rh);
  vec3 dir = l > 1e-5 ? normalize(rh / l + up * 0.03) : up;
  return citySkyColor(dir, up, sun);
}
`

/** 0 from space .. 1 near the ground, by the camera's height above sea level (as the atmosphere's low sky). */
export function lowAmount(cameraAltitude: number): number {
  const k = Math.min(1, Math.max(0, (0.1 - cameraAltitude) / (0.1 - 0.035)))
  return k * k * (3 - 2 * k)
}

export interface CitySky {
  mesh: THREE.Mesh
  /** 0 from space .. 1 near the ground (last update). */
  readonly low: number
  /** Star visibility in 0..1 (1 in space and at night; 0 under a daylit sky), last update. */
  readonly stars: number
  /** Per drawn frame, after the sun and the camera are placed. `fade` 0 hides the sky (the flat map, the start page). */
  update(camera: THREE.Camera, fade: number): void
  dispose(): void
}

export function buildCitySky(): CitySky {
  // a coarse sphere around the camera (the shader puts it there): its direction is the view ray
  const geometry = new THREE.SphereGeometry(10, 32, 16)
  const uniforms = {
    uSun: { value: SUN_DIRECTION.clone() },
    uStrength: { value: 1 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
        gl_Position.z = gl_Position.w * 0.99999; // (at the far plane: behind everything)
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      uniform float uStrength;
      varying vec3 vDir;
      ${CITY_SKY_GLSL}
      void main() {
        vec3 rd = normalize(vDir);
        vec3 up = normalize(cameraPosition);
        vec3 c = citySkyColor(rd, up, uSun);
        // (fading out with height: toward the space background)
        gl_FragColor = vec4(mix(vec3(0.0003, 0.0006, 0.0015), c, uStrength), 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'citySky'
  mesh.frustumCulled = false
  // opaque and first: the background everything else draws over
  mesh.renderOrder = -1e6
  mesh.visible = false
  const camPos = new THREE.Vector3()
  const up = new THREE.Vector3()
  let low = 0
  let stars = 1
  const smooth = THREE.MathUtils.smoothstep
  return {
    mesh,
    get low() {
      return low
    },
    get stars() {
      return stars
    },
    update(camera, fade) {
      camera.getWorldPosition(camPos)
      const d = camPos.length()
      low = lowAmount(d - PLANET_RADIUS) * fade
      // daylight everywhere: the sun overhead
      const sun = sunUniforms.uDaylight.value > 0.5 ? up.copy(camPos).normalize() : SUN_DIRECTION
      const sunH = sun.dot(up.copy(camPos).divideScalar(Math.max(d, 1e-6)))
      // the stars come out once the lamps are lit, all of them by deep twilight (and stay in space)
      const elev = THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, sunH))))
      stars = 1 - low * smooth(elev, DUSK[0], LAMPS[0])
      mesh.visible = low > 0.001
      if (!mesh.visible) return
      uniforms.uSun.value.copy(sun)
      uniforms.uStrength.value = low
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
