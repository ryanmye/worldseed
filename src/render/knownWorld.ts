// The known world: what one people (or anyone at all) knew of the planet at the current
// year, shown by covering everything else in a soft "terra incognita" mist.
//
// The mist is its own mesh, a shell a hair above the planet surface built from the same
// icosphere triangles: every vertex carries its triangle's three cell indices, the vertex
// shader fetches those cells' known years from a per-cell float texture (uploaded once per
// selection, see setCellYears), and the fragment shader blends the corners with noisy
// barycentric weights (continuous across triangles, as the planet blends its colours), so
// the frontier is a soft organic edge rather than hexagon steps. A cell fades in over
// FADE_YEARS after the year it became known, so the known area grows smoothly during
// playback and shrinks when scrubbing back: a pure function of the year and the selection.
// Triangles whose three corners are all known are culled in the vertex shader, so the
// known part of the world costs nothing.
//
// It is drawn after every flat overlay (routes, journeys, markers, icons, merchants) and
// before the atmosphere haze, depth-tested against the planet and the 3D models, so
// whatever lies in unknown cells is covered too (labels and models get CPU masks
// instead, see the history view). Unknown land and sea look alike: the coastlines of
// unknown lands are hidden, not faintly visible. The mist is lit by the sun (dark on the
// night side, so it also hides city lights there; even in "daylight everywhere").
//
// With nothing selected the mesh is invisible and costs nothing.
//
// Contact pulses: a brief two-coloured ring at the place of each first contact between
// two peoples, a function of the year like the founding pulses of the settlement markers.

import * as THREE from 'three'
import type { World } from '../contract.ts'
import { SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { sunUniforms } from './sun.ts'

/** Years over which a newly known cell clears. */
const FADE_YEARS = 14
/** Width of the per-cell year texture. */
const TEX_W = 512
const NEVER = 1e9

export interface KnownWorldFog {
  mesh: THREE.Mesh
  /** Per-cell year from which each cell is known (1e9: never), uploaded once; null hides the mist. */
  setCellYears(years: Float32Array | null): void
  /** Per frame: the history year. */
  setYear(year: number): void
  /** Per frame while visible: sun and lift for the camera. */
  update(camera: THREE.Camera): void
  dispose(): void
}

function hash01(i: number): number {
  let h = (i ^ 0x5bd1e995) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

const NOISE = /* glsl */ `
float kw_hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float kw_noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(kw_hash(i), kw_hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(kw_hash(i + vec3(0.0, 1.0, 0.0)), kw_hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(kw_hash(i + vec3(0.0, 0.0, 1.0)), kw_hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(kw_hash(i + vec3(0.0, 1.0, 1.0)), kw_hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
// fbm in about [-0.5, 0.5]; octaves finer than the pixel footprint fp (in units of p) fade out
float kw_fbm(vec3 p, float fp, int octaves) {
  float s = 0.0, a = 0.5, w = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    float k = 1.0 - smoothstep(0.2, 0.5, fp);
    s += a * k * (kw_noise(p) - 0.5);
    w += a;
    p = p * 2.03 + 17.1;
    fp *= 2.03;
    a *= 0.5;
  }
  return s / w * 1.6;
}
`

export function buildKnownWorldFog(world: World): KnownWorldFog {
  const { positions: P, triangles, cellCount } = world.grid
  const vCount = triangles.length
  const position = new Float32Array(vCount * 3)
  const corners = new Float32Array(vCount * 3)
  const seeds = new Uint8Array(vCount * 4)
  for (let v = 0; v < vCount; v++) {
    const c = triangles[v]
    const r = surfaceRadius(world, c)
    position[v * 3] = P[c * 3] * r
    position[v * 3 + 1] = P[c * 3 + 1] * r
    position[v * 3 + 2] = P[c * 3 + 2] * r
    const t = v - (v % 3)
    for (let k = 0; k < 3; k++) {
      corners[v * 3 + k] = triangles[t + k]
      seeds[v * 4 + k] = Math.floor(hash01(triangles[t + k]) * 256)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('aCorners', new THREE.BufferAttribute(corners, 3))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4, true))
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.03)

  const texH = Math.ceil(cellCount / TEX_W)
  const yearData = new Float32Array(TEX_W * texH).fill(NEVER)
  const yearTex = new THREE.DataTexture(yearData, TEX_W, texH, THREE.RedFormat, THREE.FloatType)
  yearTex.minFilter = THREE.NearestFilter
  yearTex.magFilter = THREE.NearestFilter
  yearTex.generateMipmaps = false
  yearTex.needsUpdate = true

  const uniforms = {
    uKnownTex: { value: yearTex },
    uYear: { value: 0 },
    uFade: { value: FADE_YEARS },
    uLift: { value: 0.001 },
    uCellFreq: { value: Math.sqrt(cellCount / (4 * Math.PI)) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aCorners;
      attribute vec4 aSeed;
      uniform sampler2D uKnownTex;
      uniform float uYear;
      uniform float uFade;
      uniform float uLift;
      flat varying vec3 vKY;
      flat varying vec3 vSeed;
      varying vec3 vBary;
      varying vec3 vObj;
      void main() {
        ivec3 cc = ivec3(aCorners + 0.5);
        vKY = vec3(
          texelFetch(uKnownTex, ivec2(cc.x % ${TEX_W}, cc.x / ${TEX_W}), 0).r,
          texelFetch(uKnownTex, ivec2(cc.y % ${TEX_W}, cc.y / ${TEX_W}), 0).r,
          texelFetch(uKnownTex, ivec2(cc.z % ${TEX_W}, cc.z / ${TEX_W}), 0).r);
        // all three corners known and cleared: nothing to draw (every vertex of the triangle agrees)
        if (max(vKY.x, max(vKY.y, vKY.z)) + uFade <= uYear) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        int k = gl_VertexID % 3;
        vBary = vec3(k == 0 ? 1.0 : 0.0, k == 1 ? 1.0 : 0.0, k == 2 ? 1.0 : 0.0);
        vSeed = aSeed.xyz;
        vec3 p = position + normalize(position) * uLift;
        vObj = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uYear;
      uniform float uFade;
      uniform float uCellFreq;
      uniform vec3 uSunObj;
      uniform float uDaylight;
      flat varying vec3 vKY;
      flat varying vec3 vSeed;
      varying vec3 vBary;
      varying vec3 vObj;
      ${NOISE}
      void main() {
        vec3 p = vObj;
        float footprint = length(fwidth(p));
        vec3 kn = smoothstep(vKY, vKY + uFade, vec3(uYear)); // 1: known
        float known = 0.0;
        float lo = min(kn.x, min(kn.y, kn.z)), hi = max(kn.x, max(kn.y, kn.z));
        if (hi - lo < 1e-3) known = lo;
        else {
          // frontier triangle: soft, noise-perturbed corner weights (continuous across triangles)
          vec3 b = clamp(vBary, 0.0, 1.0);
          vec3 q = p * uCellFreq * 1.15;
          float fp = footprint * uCellFreq * 1.15;
          vec3 n = vec3(
            kw_fbm(q + vSeed.x * vec3(173.3, 291.7, 117.1), fp, 3),
            kw_fbm(q + vSeed.y * vec3(173.3, 291.7, 117.1), fp, 3),
            kw_fbm(q + vSeed.z * vec3(173.3, 291.7, 117.1), fp, 3));
          vec3 w = pow(b, vec3(1.5)) * exp(n * 4.0);
          w /= max(w.x + w.y + w.z, 1e-6);
          known = dot(w, kn);
          // wisps along the edge
          known += 0.16 * kw_fbm(p * uCellFreq * 3.1 + 41.0, footprint * uCellFreq * 3.1, 3);
        }
        float fog = 1.0 - smoothstep(0.22, 0.78, known);
        if (fog < 0.003) discard;
        // the mist: a muted warm grey (no land, no sea), mottled at continent and cell scale
        float big = kw_fbm(p * 3.3 + 7.0, footprint * 3.3, 4);
        float fine = kw_fbm(p * uCellFreq * 0.9 + 3.0, footprint * uCellFreq * 0.9, 3);
        vec3 col = mix(vec3(0.120, 0.117, 0.112), vec3(0.290, 0.278, 0.256), clamp(0.5 + big * 0.9 + fine * 0.35, 0.0, 1.0));
        // a faint pale rim where the mist thins at the frontier
        float rim = fog * (1.0 - fog) * 4.0;
        col = mix(col, vec3(0.64, 0.60, 0.50), rim * 0.25);
        // lit by the sun; dark on the night side (daylight everywhere: lit from overhead)
        vec3 up = normalize(p);
        float ndl = uDaylight > 0.5 ? 0.8 : dot(up, normalize(uSunObj));
        float day = smoothstep(-0.12, 0.3, ndl);
        float light = mix(0.10, 0.55 + 0.5 * max(ndl, 0.0), day);
        col *= light;
        col += vec3(0.004, 0.006, 0.012) * (1.0 - day);
        gl_FragColor = vec4(col, fog);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 9.5 // over every flat overlay (markers 8, icons 8.5, merchants 8.8, groups 9), under the atmosphere (10)
  mesh.frustumCulled = false
  mesh.visible = false
  const tmpQ = new THREE.Quaternion()
  const tmpV = new THREE.Vector3()

  return {
    mesh,
    setCellYears(years: Float32Array | null) {
      mesh.visible = years !== null
      if (!years) return
      yearData.set(years.length > cellCount ? years.subarray(0, cellCount) : years)
      yearTex.needsUpdate = true
    },
    setYear(year: number) {
      uniforms.uYear.value = year
    },
    update(camera: THREE.Camera) {
      if (!mesh.visible) return
      mesh.updateWorldMatrix(true, false)
      mesh.getWorldQuaternion(tmpQ).invert()
      uniforms.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      // a hair above the ground, scaled with the altitude (depth precision far out, no parallax up close)
      const alt = camera.getWorldPosition(tmpV).length() - 1
      uniforms.uLift.value = Math.min(0.0025, Math.max(0.00012, alt * 0.0035))
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      yearTex.dispose()
    },
  }
}

// ---------------------------------------------------------------------------
// contact pulses

export interface ContactPulses {
  mesh: THREE.Mesh
  /** Per frame: year and pulse length in years (a first contact's ring lasts PULSE_SCALE times that). */
  setTime(year: number, pulseYears: number): void
  update(camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number): void
  dispose(): void
}

const PULSE_SCALE = 2.2

/** Rings at `cells` from `years`, in the two colours per contact `colA`, `colB` (sRGB 0..1, 3 per contact). Null when there are none. */
export function buildContactPulses(world: World, cells: ArrayLike<number>, years: ArrayLike<number>, colA: Float32Array, colB: Float32Array): ContactPulses | null {
  const n = cells.length
  if (n === 0) return null
  const P = world.grid.positions
  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  quad.setIndex([0, 1, 2, 0, 2, 3])
  const pos = new Float32Array(n * 3)
  const yr = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const c = cells[i]
    const r = surfaceRadius(world, c) + 0.004
    pos[i * 3] = P[c * 3] * r
    pos[i * 3 + 1] = P[c * 3 + 1] * r
    pos[i * 3 + 2] = P[c * 3 + 2] * r
    yr[i] = years[i]
  }
  quad.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3))
  quad.setAttribute('aYear', new THREE.InstancedBufferAttribute(yr, 1))
  quad.setAttribute('aColA', new THREE.InstancedBufferAttribute(colA.slice(0, n * 3), 3))
  quad.setAttribute('aColB', new THREE.InstancedBufferAttribute(colB.slice(0, n * 3), 3))
  quad.instanceCount = n
  const uniforms = {
    uYear: { value: 0 },
    uPulse: { value: 40 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aPos;
      attribute float aYear;
      attribute vec3 aColA;
      attribute vec3 aColB;
      uniform float uYear;
      uniform float uPulse;
      uniform vec2 uViewport;
      uniform float uPixelRatio;
      uniform vec3 uCamObj;
      varying vec2 vPx;
      varying float vT;
      varying float vAlpha;
      varying vec3 vA;
      varying vec3 vB;
      void main() {
        float age = uYear - aYear;
        vec3 up = normalize(aPos);
        float facing = dot(up, normalize(uCamObj - aPos));
        if (age < 0.0 || age > uPulse || facing <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vT = age / uPulse;
        float ext = 66.0;
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(aPos, 1.0);
        clip.xy += position.xy * ext * uPixelRatio * 2.0 / uViewport * clip.w;
        gl_Position = clip;
        vPx = position.xy * ext;
        vAlpha = smoothstep(0.0, 0.3, facing);
        vA = aColA;
        vB = aColB;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vPx;
      varying float vT;
      varying float vAlpha;
      varying vec3 vA;
      varying vec3 vB;
      void main() {
        float d = length(vPx);
        float ang = atan(vPx.y, vPx.x);
        // two rings chasing outward, dashed in the two peoples' colours
        float a = 0.0;
        vec3 c = vec3(0.0);
        for (int k = 0; k < 2; k++) {
          float t = clamp(vT * 1.25 - float(k) * 0.25, 0.0, 1.0);
          float r = 7.0 + 54.0 * sqrt(t);
          float ring = (1.0 - smoothstep(1.0, 2.6, abs(d - r))) * pow(1.0 - t, 1.2) * step(0.0, vT * 1.25 - float(k) * 0.25);
          float dash = step(0.5, fract(ang / 6.2831853 * 8.0 + float(k) * 0.25 + vT * 0.6));
          vec3 col = mix(vA, vB, dash);
          c = col * ring + c * (1.0 - ring);
          a = ring + a * (1.0 - ring);
        }
        // a bright core at the start
        float core = exp(-d * d / 40.0) * (1.0 - smoothstep(0.0, 0.3, vT)) * 0.9;
        c = vec3(1.0, 0.97, 0.9) * core + c * (1.0 - core);
        a = core + a * (1.0 - core);
        a *= vAlpha;
        c *= vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(c, a);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  })
  const mesh = new THREE.Mesh(quad, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 9.2 // over the markers, under the known-world mist
  return {
    mesh,
    setTime(year: number, pulseYears: number) {
      uniforms.uYear.value = year
      uniforms.uPulse.value = Math.max(1, pulseYears * PULSE_SCALE)
    },
    update(camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number) {
      mesh.updateWorldMatrix(true, false)
      camera.getWorldPosition(uniforms.uCamObj.value)
      mesh.worldToLocal(uniforms.uCamObj.value)
      uniforms.uViewport.value.copy(drawSize)
      uniforms.uPixelRatio.value = pixelRatio
    },
    dispose() {
      quad.dispose()
      material.dispose()
    },
  }
}
