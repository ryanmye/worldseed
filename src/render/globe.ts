// The planet surface mesh and its shader.
//
// Geometry is non-indexed (three vertices per icosphere triangle) so every
// vertex can carry all three corner colours of its triangle. The fragment
// shader blends corners with noise-perturbed barycentric weights, so
// categorical boundaries (lakes, plates, biomes view) are crisp organic
// curves instead of hexagon steps; they stay continuous across triangle
// edges because a corner's weight vanishes wherever its barycentric does.
// Coastlines are the zero iso-line of the interpolated elevation, displaced
// by noise scaled to the local slope.
//
// Relief comes from lighting: normals are computed from an exaggerated
// elevation mesh, while the rendered geometry is only displaced slightly.
// All noise is evaluated on object-space positions (seamless, anchored).

import * as THREE from 'three'
import type { World } from '../contract.ts'
import { NOISE_GLSL } from './glsl.ts'
import { blendStyleFor, colorForMode, seaIceFactor, snowFactor, type ViewMode } from './palette.ts'

export const PLANET_RADIUS = 1
/** Geometric displacement of land (fraction of radius). Kept subtle: no lumpy limb. */
export const RELIEF_SCALE = 0.008
/** Exaggerated displacement used only to derive shading normals. */
const NORMAL_RELIEF_SCALE = 0.05

/** Sun direction in world space; fixed, the planet turns beneath it. */
export const SUN_DIRECTION = new THREE.Vector3(-0.95, 0.38, 0.8).normalize()
export const SUN_COLOR = new THREE.Color(1.0, 0.96, 0.9).multiplyScalar(1.15)

export function lakeArray(world: World): Uint8Array | null {
  const lake = (world as Partial<World>).lake
  return lake && lake.length === world.grid.cellCount ? lake : null
}

export function isWaterCell(world: World, lake: Uint8Array | null, i: number): boolean {
  return world.elevation[i] < 0 || (lake !== null && lake[i] === 1)
}

/** Radius of the rendered surface at cell i (the sea is flat at sea level; lakes keep their land height). */
export function surfaceRadius(world: World, i: number): number {
  return PLANET_RADIUS + Math.max(0, world.elevation[i]) * RELIEF_SCALE
}

export interface GlobeMesh {
  mesh: THREE.Mesh
  geometry: THREE.BufferGeometry
  /** Cell index of each (non-indexed) vertex. */
  cellOfVertex: Uint32Array
  setMode(mode: ViewMode): void
  /**
   * Night-side settlement lights (hook for a later milestone): per-cell intensity in 0..1
   * (null clears) and a global multiplier. Lights only show on the night side, on land.
   */
  setCityLights(perCell: Float32Array | null, intensity: number): void
  /** Update per-frame uniforms (sun and camera in object space). */
  update(camera: THREE.Camera): void
  dispose(): void
}

function hash01(i: number): number {
  let h = (i ^ 0x9e3779b9) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h / 4294967296
}

/** Area-weighted vertex normals of the exaggerated relief surface (triangles are CCW from outside). */
function reliefNormals(world: World): Float32Array {
  const { positions, triangles, cellCount } = world.grid
  const p = new Float32Array(cellCount * 3)
  for (let i = 0; i < cellCount; i++) {
    const h = Math.max(0, world.elevation[i])
    const r = PLANET_RADIUS + h * NORMAL_RELIEF_SCALE
    p[i * 3] = positions[i * 3] * r
    p[i * 3 + 1] = positions[i * 3 + 1] * r
    p[i * 3 + 2] = positions[i * 3 + 2] * r
  }
  const n = new Float32Array(cellCount * 3)
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const k of [a, b, c]) {
      n[k] += nx; n[k + 1] += ny; n[k + 2] += nz
    }
  }
  for (let i = 0; i < cellCount; i++) {
    const x = n[i * 3], y = n[i * 3 + 1], z = n[i * 3 + 2]
    const l = Math.hypot(x, y, z) || 1
    n[i * 3] = x / l; n[i * 3 + 1] = y / l; n[i * 3 + 2] = z / l
  }
  return n
}

/** Elevation blurred over the cell graph (used for soft sea-floor colour, not for the coastline). */
function smoothedElevation(world: World, passes: number): Float32Array {
  const { cellCount, neighborOffsets: off, neighbors: nb } = world.grid
  let src = Float32Array.from(world.elevation)
  let dst = new Float32Array(cellCount)
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < cellCount; i++) {
      let sum = src[i] * 2
      for (let k = off[i]; k < off[i + 1]; k++) sum += src[nb[k]]
      dst[i] = sum / (2 + off[i + 1] - off[i])
    }
    ;[src, dst] = [dst, src]
  }
  return src
}

export function buildGlobeMesh(world: World, mode: ViewMode): GlobeMesh {
  const { positions, triangles, cellCount } = world.grid
  const lake = lakeArray(world)
  const vCount = triangles.length
  const cellOfVertex = triangles

  // ----- per-cell data -----
  const cellPos = new Float32Array(cellCount * 3)
  const cellSurf = new Float32Array(cellCount * 4)
  const cellSeed = new Uint8Array(cellCount)
  const cellSlope = new Uint8Array(cellCount)
  const { neighborOffsets: off, neighbors: nb } = world.grid
  for (let i = 0; i < cellCount; i++) {
    // mean elevation step to neighbours: scales coastline noise so it moves the shore by ~a fraction of a cell
    let sum = 0
    for (let k = off[i]; k < off[i + 1]; k++) sum += Math.abs(world.elevation[nb[k]] - world.elevation[i])
    cellSlope[i] = Math.min(255, Math.round((sum / Math.max(1, off[i + 1] - off[i])) * 2 * 255))
    const r = surfaceRadius(world, i)
    cellPos[i * 3] = positions[i * 3] * r
    cellPos[i * 3 + 1] = positions[i * 3 + 1] * r
    cellPos[i * 3 + 2] = positions[i * 3 + 2] * r
    cellSurf[i * 4] = world.elevation[i]
    cellSurf[i * 4 + 1] = snowFactor(world, i)
    cellSurf[i * 4 + 2] = seaIceFactor(world, i)
    cellSurf[i * 4 + 3] = 0 // night-lights intensity: driven by settlements in a later milestone
    cellSeed[i] = Math.floor(hash01(i) * 256)
  }
  const cellNormal = reliefNormals(world)
  const cellDepth = smoothedElevation(world, 2)

  // ----- expand to non-indexed vertices -----
  const position = new Float32Array(vCount * 3)
  const normal = new Float32Array(vCount * 3)
  const surf = new Float32Array(vCount * 4)
  const seeds = new Uint8Array(vCount * 4)
  const depth = new Float32Array(vCount)
  for (let v = 0; v < vCount; v++) {
    const c = cellOfVertex[v]
    depth[v] = cellDepth[c]
    position[v * 3] = cellPos[c * 3]
    position[v * 3 + 1] = cellPos[c * 3 + 1]
    position[v * 3 + 2] = cellPos[c * 3 + 2]
    normal[v * 3] = cellNormal[c * 3]
    normal[v * 3 + 1] = cellNormal[c * 3 + 1]
    normal[v * 3 + 2] = cellNormal[c * 3 + 2]
    surf[v * 4] = cellSurf[c * 4]
    surf[v * 4 + 1] = cellSurf[c * 4 + 1]
    surf[v * 4 + 2] = cellSurf[c * 4 + 2]
    surf[v * 4 + 3] = cellSurf[c * 4 + 3]
    const tri = v - (v % 3)
    seeds[v * 4] = cellSeed[cellOfVertex[tri]]
    seeds[v * 4 + 1] = cellSeed[cellOfVertex[tri + 1]]
    seeds[v * 4 + 2] = cellSeed[cellOfVertex[tri + 2]]
    seeds[v * 4 + 3] = cellSlope[c]
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  geometry.setAttribute('aSurf', new THREE.BufferAttribute(surf, 4))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4, true))
  geometry.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1))
  const corner = [0, 1, 2].map(() => new THREE.BufferAttribute(new Uint8Array(vCount * 4), 4, true))
  geometry.setAttribute('aC0', corner[0])
  geometry.setAttribute('aC1', corner[1])
  geometry.setAttribute('aC2', corner[2])
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), PLANET_RADIUS * (1 + RELIEF_SCALE) + 1e-3)

  const cellColor = new Uint8Array(cellCount * 4)
  const applyColors = (m: ViewMode) => {
    for (let i = 0; i < cellCount; i++) {
      colorForMode(m, world, i, cellColor, i * 4, 255)
      cellColor[i * 4 + 3] = lake !== null && lake[i] === 1 ? 255 : 0
    }
    const arrays = corner.map((a) => a.array as Uint8Array)
    for (let t = 0; t < vCount; t += 3) {
      for (let k = 0; k < 3; k++) {
        const c = cellOfVertex[t + k] * 4
        const dst = arrays[k]
        for (let v = t; v < t + 3; v++) {
          dst[v * 4] = cellColor[c]
          dst[v * 4 + 1] = cellColor[c + 1]
          dst[v * 4 + 2] = cellColor[c + 2]
          dst[v * 4 + 3] = cellColor[c + 3]
        }
      }
    }
    for (const a of corner) a.needsUpdate = true
    material.uniforms.uStyle.value = blendStyleFor(m)
  }

  const cellSpacing = Math.sqrt((4 * Math.PI) / cellCount)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uStyle: { value: 0 },
      uSunObj: { value: SUN_DIRECTION.clone() },
      uCamObj: { value: new THREE.Vector3(0, 0, 3) },
      uSunColor: { value: SUN_COLOR.clone() },
      uCellFreq: { value: 1 / cellSpacing },
      uCityLights: { value: 0 },
    },
    vertexShader: PLANET_VERT,
    fragmentShader: PLANET_FRAG,
  })
  applyColors(mode)

  const mesh = new THREE.Mesh(geometry, material)
  const tmpQ = new THREE.Quaternion()

  return {
    mesh,
    geometry,
    cellOfVertex,
    setMode: applyColors,
    setCityLights(perCell: Float32Array | null, intensity: number) {
      const attr = geometry.getAttribute('aSurf') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      for (let v = 0; v < vCount; v++) arr[v * 4 + 3] = perCell ? perCell[cellOfVertex[v]] ?? 0 : 0
      attr.needsUpdate = true
      material.uniforms.uCityLights.value = perCell ? intensity : 0
    },
    update(camera: THREE.Camera) {
      mesh.updateWorldMatrix(true, false)
      mesh.getWorldQuaternion(tmpQ).invert()
      ;(material.uniforms.uSunObj.value as THREE.Vector3).copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      const cam = material.uniforms.uCamObj.value as THREE.Vector3
      camera.getWorldPosition(cam)
      mesh.worldToLocal(cam)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

const PLANET_VERT = /* glsl */ `
attribute vec4 aSurf;
attribute vec4 aSeed;
attribute vec4 aC0;
attribute vec4 aC1;
attribute vec4 aC2;
attribute float aDepth;

varying float vDepth;
varying vec3 vObjPos;
varying vec3 vNormal;
varying vec3 vBary;
varying vec4 vSurf;
flat varying vec4 vC0;
flat varying vec4 vC1;
flat varying vec4 vC2;
flat varying vec3 vSeed;
varying float vSlope;

void main() {
  int k = gl_VertexID % 3;
  vBary = vec3(k == 0 ? 1.0 : 0.0, k == 1 ? 1.0 : 0.0, k == 2 ? 1.0 : 0.0);
  vObjPos = position;
  vNormal = normal;
  vSurf = aSurf;
  vC0 = aC0;
  vC1 = aC1;
  vC2 = aC2;
  vSeed = aSeed.xyz;
  vSlope = aSeed.w * 0.5;
  vDepth = aDepth;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const PLANET_FRAG = /* glsl */ `
uniform int uStyle;
uniform vec3 uSunObj;
uniform vec3 uCamObj;
uniform vec3 uSunColor;
uniform float uCellFreq;
uniform float uCityLights;

varying vec3 vObjPos;
varying vec3 vNormal;
varying vec3 vBary;
varying vec4 vSurf;
flat varying vec4 vC0;
flat varying vec4 vC1;
flat varying vec4 vC2;
flat varying vec3 vSeed;
varying float vSlope;
varying float vDepth;

${NOISE_GLSL}

const vec3 SHELF = vec3(0.016, 0.150, 0.190);
const vec3 SHALLOW = vec3(0.007, 0.055, 0.120);
const vec3 DEEP = vec3(0.002, 0.010, 0.042);
const vec3 SEA_ICE = vec3(0.80, 0.86, 0.92);
const vec3 SNOW = vec3(0.86, 0.89, 0.93);
const vec3 SKY = vec3(0.30, 0.50, 0.95);

void main() {
  vec3 p = vObjPos;
  vec3 up = normalize(p);
  vec3 V = normalize(uCamObj - p);
  vec3 L = normalize(uSunObj);
  float footprint = length(fwidth(p));

  // ----- corner blend weights -----
  vec3 b = clamp(vBary, 0.0, 1.0);
  vec3 w = b;   // linear: smooth data
  vec3 ws = b;  // sharp, noise-perturbed: lakes and categorical data
  if (uStyle != 1) {
    vec3 q = p * uCellFreq * 1.1;
    float fp = footprint * uCellFreq * 1.1;
    vec3 n = vec3(
      ws_fbm(q + vSeed.x * vec3(173.3, 291.7, 117.1), 1.0, 3, fp),
      ws_fbm(q + vSeed.y * vec3(173.3, 291.7, 117.1), 1.0, 3, fp),
      ws_fbm(q + vSeed.z * vec3(173.3, 291.7, 117.1), 1.0, 3, fp));
    ws = pow(b, vec3(6.0)) * exp(n * 16.0);
    ws /= max(ws.x + ws.y + ws.z, 1e-6);
    // terrain albedo: soft but irregular blending (climate colours are continuous already)
    w = uStyle == 0 ? pow(b, vec3(1.6)) * exp(n * 5.0) : ws;
  }
  w /= max(w.x + w.y + w.z, 1e-6);

  vec3 c0 = ws_srgbToLinear(vC0.rgb);
  vec3 c1 = ws_srgbToLinear(vC1.rgb);
  vec3 c2 = ws_srgbToLinear(vC2.rgb);

  vec3 N = normalize(vNormal);
  float mu = dot(up, L);
  float dayFade = smoothstep(-0.12, 0.12, mu);

  vec3 color;
  if (uStyle == 0) {
    // ---------- terrain ----------
    // Sea: iso-line of the interpolated elevation, pushed around by noise scaled to the
    // local slope. Noise is only evaluated where it could move the shoreline.
    float coastAmp = max(vSlope, 0.01) * 1.7;
    float e = vSurf.x;
    if (abs(e) < coastAmp * 1.25) e += ws_fbm(p + 17.0, uCellFreq * 0.6, 5, footprint) * coastAmp;
    float aaE = fwidth(vSurf.x) * 1.2 + 1e-5;
    float seaM = 1.0 - smoothstep(-aaE, aaE, e);
    // Lakes: flagged land cells, blended with the sharp perturbed corner weights.
    float lakeW = dot(ws, vec3(vC0.a, vC1.a, vC2.a));
    float aaL = fwidth(lakeW) * 0.75 + 1e-3;
    float lakeM = smoothstep(0.5 - aaL, 0.5 + aaL, lakeW);
    float water = max(seaM, lakeM);

    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), up) + vec3(1e-5, 0.0, 0.0));
    vec3 north = cross(up, east);
    vec3 skyAmb = mix(vec3(0.030, 0.040, 0.070), SKY * 0.08, smoothstep(-0.25, 0.4, mu));

    vec3 land = vec3(0.0);
    if (water < 0.999) {
      vec3 alb = c0 * w.x + c1 * w.y + c2 * w.z;

      // multi-scale albedo mottling, anchored to the surface
      float m1 = ws_fbm(p, 9.0, 4, footprint);
      float m2 = ws_fbm(p + 31.7, 40.0, 3, footprint);
      alb *= 1.0 + 0.22 * m1 + 0.12 * m2;
      alb = mix(alb, alb * vec3(1.10, 1.02, 0.80), clamp(m2 * 1.5, 0.0, 1.0) * 0.5);

      // small-scale bump on land normals, rougher in the mountains
      float elev = max(vSurf.x, 0.0);
      vec4 bump = ws_fbmd(p + 7.3, uCellFreq * 2.5, 4, footprint);
      vec3 g = (bump.yzw - dot(bump.yzw, up) * up) / uCellFreq;
      float rough = 0.012 + 0.09 * smoothstep(0.12, 0.6, elev);
      N = normalize(N - g * rough);

      // snow line from temperature, broken up by noise and slope
      if (vSurf.y > 0.08) {
        float slope = 1.0 - dot(N, up);
        float sn = vSurf.y + 0.28 * ws_fbm(p + 3.1, 25.0, 4, footprint) - slope * 1.2;
        float snow = smoothstep(0.42, 0.58, sn);
        alb = mix(alb, SNOW * (0.94 + 0.08 * m2), snow);
      }

      // cartographic hillshade (light from the local north-west) layered on the sun
      vec3 Lhs = normalize(up + 0.75 * (north - east));
      float hs = clamp(dot(N, Lhs) / dot(up, Lhs), 0.35, 1.6);
      float diff = max(dot(N, L), 0.0) * dayFade;
      float shade = diff * mix(1.0, hs, 0.5);
      land = alb * (uSunColor * shade + skyAmb * mix(1.0, hs, 0.4));
    }

    vec3 sea = vec3(0.0);
    if (water > 0.001) {
      float depth = clamp(-mix(vDepth, vSurf.x, 0.35), 0.0, 1.0) * (1.0 - lakeM);
      float dn = ws_fbm(p + 11.0, 6.0, 3, footprint);
      float dn2 = ws_fbm(p + 13.0, uCellFreq * 0.5, 2, footprint);
      float dd = depth + dn * 0.06 + dn2 * 0.04;
      vec3 wcol = mix(SHELF, SHALLOW, smoothstep(0.0, 0.2, dd));
      wcol = mix(wcol, DEEP, smoothstep(0.15, 0.7, dd));

      float ice = 0.0;
      if (vSurf.z > 0.08) ice = smoothstep(0.45, 0.55, vSurf.z + 0.3 * ws_fbm(p + 5.5, 18.0, 4, footprint));

      vec4 wave = ws_fbmd(p + 2.0, 220.0, 3, footprint);
      vec3 Nw = normalize(up - 0.0004 * (wave.yzw - dot(wave.yzw, up) * up));
      vec3 H = normalize(L + V);
      float ndh = max(dot(Nw, H), 0.0);
      float nv = max(dot(up, V), 0.0);
      float fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
      float spec = (pow(ndh, 600.0) * 0.45 + pow(ndh, 90.0) * 0.07 + pow(ndh, 16.0) * 0.02) * (0.35 + fres) * dayFade * (1.0 - ice);
      float wdiff = max(mu, 0.0) * dayFade;
      sea = wcol * (uSunColor * wdiff * 0.9 + skyAmb * 1.2);
      sea += uSunColor * spec;
      sea = mix(sea, SKY * 0.35 * dayFade, fres * 0.55);
      vec3 iceLit = SEA_ICE * (0.95 + 0.1 * dn) * (uSunColor * wdiff + skyAmb);
      sea = mix(sea, iceLit, ice);
    }

    color = mix(land, sea, water);

    // night side: hook for settlement lights (vSurf.w), off until a later milestone
    color += (1.0 - dayFade) * uCityLights * vSurf.w * vec3(1.0, 0.72, 0.38) * (1.0 - water);
  } else {
    // ---------- data views: flat, legible lighting from the viewer ----------
    vec3 c = c0 * w.x + c1 * w.y + c2 * w.z;
    vec3 Lv = normalize(V + 0.35 * cross(V, vec3(0.0, 1.0, 0.0)) + vec3(0.0, 0.3, 0.0));
    float lam = max(dot(N, Lv), 0.0);
    color = c * (0.32 + 0.78 * lam);
  }

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
