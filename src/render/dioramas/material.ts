// The two materials of the diorama layer, shared by every batch:
//  - models: instanced, lit by the same sun as the planet (sun.ts: same day/night
//    terminator, same sky ambient), team colour from a small palette, warm lit windows
//    on the night side. Each instance carries its appear/disappear years, so the
//    pop-in (a short overshoot) and the shrink-away are pure functions of the year.
//    A camera-distance fade grows the models out of the ground as you zoom in.
//  - shadows: a soft dark blob under each model, stretched away from the sun.
// Both collapse instances outside their life or beyond the fade to nothing in the
// vertex shader, so instance sets only change on snapshot or camera steps.

import * as THREE from 'three'
import { SUN_COLOR, SUN_DIRECTION } from '../globe.ts'
import { sunUniforms } from '../sun.ts'

/** Team colours (linear RGB); index 0 keeps the model's own colours. */
export const PALETTE: readonly [number, number, number][] = [
  [0, 0, 0],
  [0.55, 0.16, 0.08], // terracotta
  [0.27, 0.33, 0.45], // slate blue
  [0.55, 0.36, 0.1], // ochre
  [0.22, 0.32, 0.12], // moss
  [0.45, 0.1, 0.1], // brick red
  [0.12, 0.3, 0.32], // teal
  [0.38, 0.3, 0.24], // thatch brown
]

export interface DioramaUniforms {
  uYear: { value: number }
  uAnimYears: { value: number }
  uCamObj: { value: THREE.Vector3 }
  uSunObj: { value: THREE.Vector3 }
  /** Camera distance where models are full size (x) and gone (y). */
  uFade: { value: THREE.Vector2 }
  uSunColor: { value: THREE.Color }
  uPalette: { value: THREE.Vector3[] }
  /** Shared with every lit layer (sun.ts): 1 = daylight everywhere. */
  uDaylight: { value: number }
}

export function createUniforms(): DioramaUniforms {
  return {
    uYear: { value: 0 },
    uAnimYears: { value: 10 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uFade: { value: new THREE.Vector2(0.3, 0.5) },
    uSunColor: { value: SUN_COLOR.clone() },
    uPalette: { value: PALETTE.map(([r, g, b]) => new THREE.Vector3(r, g, b)) },
    uDaylight: sunUniforms.uDaylight,
  }
}

/** Shared by both vertex shaders: the instance's size factor from its life and the camera fade. */
const LIFE_GLSL = /* glsl */ `
  attribute vec4 aColor;
  attribute vec4 aAnim; // appear year, disappear year, palette index | shadow height, flags
  uniform float uYear;
  uniform float uAnimYears;
  uniform vec3 uCamObj;
  uniform vec2 uFade;
  float easeOutBack(float t) {
    float e = t - 1.0;
    return 1.0 + 2.2 * e * e * e + 1.2 * e * e;
  }
  /** 0 = hidden; 1 = full size. */
  float instanceSize(vec3 origin) {
    if (uYear < aAnim.x) return 0.0;
    vec3 toCam = uCamObj - origin;
    float dist = length(toCam);
    float facing = dot(normalize(origin), toCam) / dist;
    float near = 1.0 - smoothstep(uFade.x, uFade.y, dist);
    float grow = clamp((uYear - aAnim.x) / uAnimYears, 0.0, 1.0);
    float shrink = clamp((uYear - aAnim.y) / uAnimYears, 0.0, 1.0);
    float life = easeOutBack(grow) * (1.0 - shrink * shrink);
    return life * near * near * (3.0 - 2.0 * near) * smoothstep(0.0, 0.12, facing);
  }
`

const SKY = 'vec3(0.30, 0.50, 0.95)'

/** Light direction at a point: the sun, or (daylight everywhere) the sun leaned to just off the local zenith. */
const SUN_AT_GLSL = /* glsl */ `
  uniform float uDaylight;
  vec3 sunAt(vec3 up, vec3 sunObj) {
    vec3 L = normalize(sunObj);
    if (uDaylight < 0.5) return L;
    vec3 t = L - up * dot(L, up);
    float tl = length(t);
    return normalize(up + (tl > 1e-4 ? t / tl : vec3(0.0)) * 0.6);
  }
`

export function createModelMaterial(uniforms: DioramaUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${LIFE_GLSL}
      uniform vec3 uPalette[${PALETTE.length}];
      varying vec3 vAlb;
      varying vec3 vN;
      varying vec3 vUp;
      varying vec3 vLocal;
      varying vec3 vLocalN;
      varying float vLit;
      varying float vSeed;
      vec3 srgbToLinear(vec3 c) {
        return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
      }
      void main() {
        vec3 origin = instanceMatrix[3].xyz;
        float s = instanceSize(origin);
        if (s <= 0.002) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec4 wp = instanceMatrix * vec4(position * s, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * wp;
        vN = normalize(mat3(instanceMatrix) * normal);
        vUp = normalize(origin);
        vec3 c = srgbToLinear(aColor.rgb);
        int pi = int(aAnim.z + 0.5);
        if (aColor.a > 0.5 && pi > 0) {
          // team colour, keeping the pack's shading gradient (its blue has luminance ~0.13)
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = uPalette[pi] * clamp(l / 0.13, 0.5, 1.8);
        }
        // a touch less saturated and bright than the packs, closer to the planet's albedos
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vAlb = mix(vec3(lum), c, 0.85) * 0.9;
        vLocal = position;
        vLocalN = normal;
        vLit = mod(aAnim.w, 2.0);
        vSeed = fract(sin(dot(origin * 1000.0, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunObj;
      uniform vec3 uSunColor;
      ${SUN_AT_GLSL}
      varying vec3 vAlb;
      varying vec3 vN;
      varying vec3 vUp;
      varying vec3 vLocal;
      varying vec3 vLocalN;
      varying float vLit;
      varying float vSeed;
      float hash12(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233)) + vSeed * 91.7) * 43758.5453);
      }
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 L = sunAt(vUp, uSunObj);
        float mu = dot(vUp, L);
        float day = smoothstep(-0.12, 0.12, mu);
        float diff = max(dot(N, L), 0.0) * day;
        vec3 sky = mix(vec3(0.030, 0.040, 0.070), ${SKY} * 0.08, smoothstep(-0.25, 0.4, mu));
        float up = dot(N, vUp);
        // sky from above, a warm bounce from the sunlit ground below, so faces turned away
        // from the sun stay readable instead of sinking into the planet's deep shade
        vec3 fill = sky * (2.4 + 1.2 * up) + uSunColor * day * (0.2 + 0.08 * up) * vec3(1.0, 0.94, 0.85);
        // at night: darker, but lived-in buildings catch a little warm light from the streets
        fill *= mix(0.5, 1.0, day);
        vec3 col = vAlb * (uSunColor * diff + fill + (1.0 - day) * vLit * vec3(0.10, 0.06, 0.025));
        // night: a scatter of warm windows on the walls of lived-in buildings
        if (vLit > 0.5 && day < 0.98) {
          vec3 ln = normalize(vLocalN);
          float wall = 1.0 - smoothstep(0.15, 0.35, abs(ln.y));
          vec2 h = normalize(ln.xz + vec2(1e-5));
          float u = dot(vLocal.xz, vec2(-h.y, h.x));
          vec2 g = vec2(u / 0.16, (vLocal.y - 0.06) / 0.22);
          vec2 f = fract(g);
          float win = step(0.3, f.x) * step(f.x, 0.7) * step(0.28, f.y) * step(f.y, 0.78);
          float on = step(0.42, hash12(floor(g)));
          float band = step(0.1, vLocal.y) * (1.0 - step(1.6, vLocal.y));
          col += (1.0 - day) * wall * win * on * band * vec3(1.0, 0.58, 0.24) * 1.4;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}

export function createShadowMaterial(uniforms: DioramaUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    vertexShader: /* glsl */ `
      ${LIFE_GLSL}
      uniform vec3 uSunObj;
      ${SUN_AT_GLSL}
      varying float vA;
      void main() {
        vec3 origin = instanceMatrix[3].xyz;
        float s = instanceSize(origin);
        if (s <= 0.002) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec3 up = normalize(origin);
        vec3 L = sunAt(up, uSunObj);
        float mu = dot(up, L);
        vec3 sunT = L - up * mu;
        float lt = length(sunT);
        vec3 sd = lt > 1e-4 ? -sunT / lt : vec3(0.0);
        // the blob leans away from the sun, longer when it is low (and none at night)
        float lean = min(lt / max(mu, 0.25), 2.0) * smoothstep(-0.05, 0.2, mu);
        vec3 q = mat3(instanceMatrix) * position;
        float along = dot(q, sd);
        q += sd * (max(along, 0.0) * lean * 0.7 + aAnim.z * lean * 0.3);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(origin + q * s, 1.0);
        vA = aColor.a * min(s, 1.0) * mix(0.16, 0.4, smoothstep(-0.1, 0.25, mu));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        gl_FragColor = vec4(0.0, 0.0, 0.0, vA);
      }
    `,
  })
}
