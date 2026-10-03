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
import { ViewMode, blendStyleFor, colorForMode, seaIceFactor, snowFactor, type ModeData } from './palette.ts'

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
  /** Per-cell carrying capacity for the Population view (null until history arrives). */
  setCapacity(capacity: Float32Array | null): void
  /**
   * Night-side settlement lights: per-cell intensity in 0..1 (null clears) and a global
   * multiplier. Lights only show on the night side, on land. Cheap: uploads one float
   * per cell to a texture, so it can be called whenever the snapshot changes.
   */
  setCityLights(perCell: Float32Array | null, intensity: number): void
  /**
   * Land use and degradation (0..255 per cell) of the two land snapshots bracketing the
   * current year: rows `row0` and `row1` of the row-major arrays (null clears). Uploads
   * one RGBA8 texel per cell, so call it only when the snapshot pair changes; the shader
   * interpolates by `setLandFrac`.
   */
  setLandRows(landUse: Uint8Array | null, degradation: Uint8Array | null, row0: number, row1: number): void
  /** Per frame: interpolation fraction between the two land rows. */
  setLandFrac(frac: number): void
  /** Draw cultivated and degraded land on the Terrain view. */
  setFarmlandVisible(show: boolean): void
  /**
   * Reservoirs: cells that hold water from the year in `built` until `lost` (-1 = never),
   * filling over a few decades and draining after; `strength` scales the pool (0..1).
   * Static per history (one upload); the shader derives the fill from `setYear`. Null clears.
   */
  setReservoirs(cells: ArrayLike<number> | null, built?: ArrayLike<number>, lost?: ArrayLike<number>, strength?: ArrayLike<number>): void
  setReservoirsVisible(show: boolean): void
  /** Per frame: the history year (reservoir fill). */
  setYear(year: number): void
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
    cellSurf[i * 4 + 3] = 0 // unused
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
  const corners = new Float32Array(vCount * 3) // the triangle's three cell indices, on every vertex
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
    corners[v * 3] = cellOfVertex[tri]
    corners[v * 3 + 1] = cellOfVertex[tri + 1]
    corners[v * 3 + 2] = cellOfVertex[tri + 2]
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  geometry.setAttribute('aSurf', new THREE.BufferAttribute(surf, 4))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4, true))
  geometry.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1))
  geometry.setAttribute('aCorners', new THREE.BufferAttribute(corners, 3))
  const corner = [0, 1, 2].map(() => new THREE.BufferAttribute(new Uint8Array(vCount * 4), 4, true))
  geometry.setAttribute('aC0', corner[0])
  geometry.setAttribute('aC1', corner[1])
  geometry.setAttribute('aC2', corner[2])
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), PLANET_RADIUS * (1 + RELIEF_SCALE) + 1e-3)

  // Per-cell city-light intensity, fetched by cell index in the vertex shader.
  const lightH = Math.ceil(cellCount / LIGHT_TEX_WIDTH)
  const lightData = new Float32Array(LIGHT_TEX_WIDTH * lightH)
  const lightTex = new THREE.DataTexture(lightData, LIGHT_TEX_WIDTH, lightH, THREE.RedFormat, THREE.FloatType)
  lightTex.minFilter = THREE.NearestFilter
  lightTex.magFilter = THREE.NearestFilter
  lightTex.generateMipmaps = false
  lightTex.needsUpdate = true
  // Cell centre positions (surface radius), so light glows can be radial around them.
  const cellPosData = new Float32Array(LIGHT_TEX_WIDTH * lightH * 4)
  for (let i = 0; i < cellCount; i++) {
    cellPosData[i * 4] = cellPos[i * 3]
    cellPosData[i * 4 + 1] = cellPos[i * 3 + 1]
    cellPosData[i * 4 + 2] = cellPos[i * 3 + 2]
  }
  const cellPosTex = new THREE.DataTexture(cellPosData, LIGHT_TEX_WIDTH, lightH, THREE.RGBAFormat, THREE.FloatType)
  cellPosTex.minFilter = THREE.NearestFilter
  cellPosTex.magFilter = THREE.NearestFilter
  cellPosTex.generateMipmaps = false
  cellPosTex.needsUpdate = true

  // Per-cell land use and degradation of two land snapshots (RGBA8: use0, use1, deg0, deg1).
  const landData = new Uint8Array(LIGHT_TEX_WIDTH * lightH * 4)
  const landTex = new THREE.DataTexture(landData, LIGHT_TEX_WIDTH, lightH, THREE.RGBAFormat, THREE.UnsignedByteType)
  landTex.minFilter = THREE.NearestFilter
  landTex.magFilter = THREE.NearestFilter
  landTex.generateMipmaps = false
  landTex.needsUpdate = true
  let hasLand = false
  let farmlandVisible = true
  // Per-cell reservoir life (built year, lost year, strength); a never-built cell has built = NEVER.
  const resData = new Float32Array(LIGHT_TEX_WIDTH * lightH * 4)
  const clearReservoirs = () => {
    for (let i = 0; i < resData.length; i += 4) {
      resData[i] = NEVER
      resData[i + 1] = NEVER
      resData[i + 2] = 0
      resData[i + 3] = 0
    }
  }
  clearReservoirs()
  const resTex = new THREE.DataTexture(resData, LIGHT_TEX_WIDTH, lightH, THREE.RGBAFormat, THREE.FloatType)
  resTex.minFilter = THREE.NearestFilter
  resTex.magFilter = THREE.NearestFilter
  resTex.generateMipmaps = false
  resTex.needsUpdate = true
  let hasReservoirs = false
  let reservoirsVisible = true

  const modeData: ModeData = { capacity: null, capacityMax: 0 }
  let currentMode = mode
  const cellColor = new Uint8Array(cellCount * 4)
  const applyColors = (m: ViewMode) => {
    currentMode = m
    for (let i = 0; i < cellCount; i++) {
      colorForMode(m, world, i, cellColor, i * 4, 255, modeData)
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
    syncLandUniforms()
  }
  const syncLandUniforms = () => {
    const u = material.uniforms
    u.uLandView.value = currentMode === ViewMode.LandUse ? 1 : 0
    u.uFarm.value = hasLand && farmlandVisible && currentMode === ViewMode.Terrain ? 1 : 0
    u.uLandOn.value = hasLand && (u.uFarm.value > 0 || u.uLandView.value > 0) ? 1 : 0
    u.uResOn.value = hasReservoirs && reservoirsVisible && currentMode === ViewMode.Terrain ? 1 : 0
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
      uLightTex: { value: lightTex },
      uCellPosTex: { value: cellPosTex },
      uLandTex: { value: landTex },
      uLandOn: { value: 0 },
      uLandFrac: { value: 0 },
      uFarm: { value: 0 },
      uLandView: { value: 0 },
      uResTex: { value: resTex },
      uResOn: { value: 0 },
      uYear: { value: 0 },
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
    setCapacity(capacity: Float32Array | null) {
      modeData.capacity = capacity && capacity.length === cellCount ? capacity : null
      let max = 0
      if (modeData.capacity) for (let i = 0; i < cellCount; i++) max = Math.max(max, modeData.capacity[i])
      modeData.capacityMax = max
      if (currentMode === ViewMode.Population) applyColors(currentMode)
    },
    setCityLights(perCell: Float32Array | null, intensity: number) {
      if (perCell) lightData.set(perCell.length > cellCount ? perCell.subarray(0, cellCount) : perCell)
      else lightData.fill(0)
      lightTex.needsUpdate = true
      material.uniforms.uCityLights.value = perCell ? intensity : 0
    },
    setLandRows(landUse: Uint8Array | null, degradation: Uint8Array | null, row0: number, row1: number) {
      const n = cellCount
      if (!landUse || !degradation || landUse.length < (Math.max(row0, row1) + 1) * n || degradation.length < (Math.max(row0, row1) + 1) * n) {
        if (hasLand) {
          landData.fill(0)
          landTex.needsUpdate = true
        }
        hasLand = false
      } else {
        const a = row0 * n, b = row1 * n
        for (let i = 0; i < n; i++) {
          landData[i * 4] = landUse[a + i]
          landData[i * 4 + 1] = landUse[b + i]
          landData[i * 4 + 2] = degradation[a + i]
          landData[i * 4 + 3] = degradation[b + i]
        }
        landTex.needsUpdate = true
        hasLand = true
      }
      syncLandUniforms()
    },
    setLandFrac(frac: number) {
      material.uniforms.uLandFrac.value = frac
    },
    setFarmlandVisible(show: boolean) {
      farmlandVisible = show
      syncLandUniforms()
    },
    setReservoirs(cells: ArrayLike<number> | null, built?: ArrayLike<number>, lost?: ArrayLike<number>, strength?: ArrayLike<number>) {
      clearReservoirs()
      hasReservoirs = false
      if (cells && built && lost) {
        for (let k = 0; k < cells.length; k++) {
          const c = cells[k]
          if (c < 0 || c >= cellCount) continue
          resData[c * 4] = built[k]
          resData[c * 4 + 1] = lost[k] >= 0 ? lost[k] : NEVER
          resData[c * 4 + 2] = strength ? strength[k] : 1
          hasReservoirs = true
        }
      }
      resTex.needsUpdate = true
      syncLandUniforms()
    },
    setReservoirsVisible(show: boolean) {
      reservoirsVisible = show
      syncLandUniforms()
    },
    setYear(year: number) {
      material.uniforms.uYear.value = year
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
      lightTex.dispose()
      cellPosTex.dispose()
      landTex.dispose()
      resTex.dispose()
    },
  }
}

const LIGHT_TEX_WIDTH = 512
const NEVER = 1e9
/** Years a reservoir takes to fill after its dam is built, and to drain after it is lost. */
const RESERVOIR_FILL_YEARS = 12
const RESERVOIR_DRAIN_YEARS = 40

const PLANET_VERT = /* glsl */ `
attribute vec4 aSurf;
attribute vec4 aSeed;
attribute vec4 aC0;
attribute vec4 aC1;
attribute vec4 aC2;
attribute float aDepth;
attribute vec3 aCorners;
uniform sampler2D uLightTex;
uniform sampler2D uCellPosTex;
uniform float uCityLights;
uniform sampler2D uLandTex;
uniform float uLandOn;
uniform float uLandFrac;
uniform sampler2D uResTex;
uniform float uResOn;
uniform float uYear;
flat varying vec3 vLand;
flat varying vec3 vDeg;
flat varying vec3 vRes;

varying float vDepth;
flat varying vec3 vLight;
flat varying vec3 vLP0;
flat varying vec3 vLP1;
flat varying vec3 vLP2;
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
  vLight = vec3(0.0);
  vLP0 = vLP1 = vLP2 = vec3(0.0);
  vLand = vDeg = vRes = vec3(0.0);
  ivec3 cc = ivec3(aCorners + 0.5);
  ivec3 cx = cc % ${LIGHT_TEX_WIDTH};
  ivec3 cy = cc / ${LIGHT_TEX_WIDTH};
  if (uLandOn > 0.0) {
    vec4 l0 = texelFetch(uLandTex, ivec2(cx.x, cy.x), 0);
    vec4 l1 = texelFetch(uLandTex, ivec2(cx.y, cy.y), 0);
    vec4 l2 = texelFetch(uLandTex, ivec2(cx.z, cy.z), 0);
    vLand = vec3(mix(l0.r, l0.g, uLandFrac), mix(l1.r, l1.g, uLandFrac), mix(l2.r, l2.g, uLandFrac));
    vDeg = vec3(mix(l0.b, l0.a, uLandFrac), mix(l1.b, l1.a, uLandFrac), mix(l2.b, l2.a, uLandFrac));
  }
  if (uResOn > 0.0) {
    vec4 r0 = texelFetch(uResTex, ivec2(cx.x, cy.x), 0);
    vec4 r1 = texelFetch(uResTex, ivec2(cx.y, cy.y), 0);
    vec4 r2 = texelFetch(uResTex, ivec2(cx.z, cy.z), 0);
    vec3 built = vec3(r0.x, r1.x, r2.x);
    vec3 lost = vec3(r0.y, r1.y, r2.y);
    vRes = vec3(r0.z, r1.z, r2.z)
      * smoothstep(built, built + ${RESERVOIR_FILL_YEARS.toFixed(1)}, vec3(uYear))
      * (1.0 - smoothstep(lost, lost + ${RESERVOIR_DRAIN_YEARS.toFixed(1)}, vec3(uYear)));
  }
  if (uCityLights > 0.0) {
    vLight = vec3(
      texelFetch(uLightTex, ivec2(cx.x, cy.x), 0).r,
      texelFetch(uLightTex, ivec2(cx.y, cy.y), 0).r,
      texelFetch(uLightTex, ivec2(cx.z, cy.z), 0).r);
    if (vLight.x > 0.0) vLP0 = texelFetch(uCellPosTex, ivec2(cx.x, cy.x), 0).xyz;
    if (vLight.y > 0.0) vLP1 = texelFetch(uCellPosTex, ivec2(cx.y, cy.y), 0).xyz;
    if (vLight.z > 0.0) vLP2 = texelFetch(uCellPosTex, ivec2(cx.z, cy.z), 0).xyz;
  }
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
uniform float uFarm;
uniform float uLandView;
uniform float uResOn;

flat varying vec3 vLand;
flat varying vec3 vDeg;
flat varying vec3 vRes;
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
flat varying vec3 vLight;
flat varying vec3 vLP0;
flat varying vec3 vLP1;
flat varying vec3 vLP2;

${NOISE_GLSL}

const vec3 SHELF = vec3(0.016, 0.150, 0.190);
const vec3 SHALLOW = vec3(0.007, 0.055, 0.120);
const vec3 DEEP = vec3(0.002, 0.010, 0.042);
const vec3 LAKE_SHORE = vec3(0.030, 0.180, 0.200);
const vec3 LAKE_DEEP = vec3(0.020, 0.140, 0.180);
const vec3 SEA_ICE = vec3(0.80, 0.86, 0.92);
const vec3 SNOW = vec3(0.86, 0.89, 0.93);
const vec3 SKY = vec3(0.30, 0.50, 0.95);
const vec3 CROP_GRAIN = vec3(0.320, 0.245, 0.080);
const vec3 CROP_GREEN = vec3(0.105, 0.175, 0.045);
const vec3 CROP_SOIL = vec3(0.165, 0.105, 0.058);
const vec3 CROP_HAY = vec3(0.225, 0.205, 0.085);
const vec3 BARE_SOIL = vec3(0.320, 0.215, 0.115);
const float FIELD_STRENGTH = 0.6;
const vec3 CITY = vec3(1.0, 0.56, 0.22);
const vec3 CITY_CORE = vec3(1.0, 0.82, 0.55);

// Anisotropic Ward-shaped lobe (T, B: tangent axes; ax, ay: RMS slopes along them), times
// N.L. Deliberately not energy-normalised: the peak stays bounded however calm the water,
// so the glint is shaped by lobe width and never clips to a flat white patch.
float glintLobe(vec3 N, vec3 H, vec3 T, vec3 B, float ax, float ay, float nl) {
  float hn = max(dot(H, N), 1e-3);
  float ht = dot(H, T) / ax;
  float hb = dot(H, B) / ay;
  return exp(-(ht * ht + hb * hb) / (hn * hn)) * nl;
}

// Cultivated and degraded land over albedo alb. lu and dg are land use and degradation
// in 0..1 (interpolated over the triangle and between land snapshots), clump a mid-scale
// noise (~[-0.6, 0.6]) that gathers fields into irregular patches. Fields are Voronoi cells
// in object space, each cultivated once land use passes its own random threshold, in one of
// a few crop tones with darker hedgerows between them. They resolve only when zoomed in; at
// globe scale the patchwork is replaced by its average, a soft warm tint.
vec3 farmland(vec3 alb, vec3 p, float lu, float dg, float clump, float footprint) {
  vec3 col = alb;
  if (lu > 0.002) {
    float cover = clamp(smoothstep(0.0, 0.8, lu) * (1.0 + 0.9 * clump), 0.0, 1.0);
    // Each field moves the wild colour part of the way toward its crop (FIELD_STRENGTH on
    // average), so the patchwork keeps the regional colour and its mean is a soft tint.
    vec3 cropMean = (CROP_GRAIN + CROP_GREEN + CROP_SOIL + CROP_HAY) * 0.25;
    vec3 far = mix(alb, cropMean, cover * FIELD_STRENGTH);
    float fieldFreq = uCellFreq * 7.0;
    float detail = ws_lod(fieldFreq, footprint);
    if (detail > 0.0) {
      vec3 rnd;
      vec2 F = ws_cells(p * fieldFreq, rnd);
      float on = smoothstep(rnd.x - 0.06, rnd.x + 0.06, cover);
      float pick = fract(rnd.y * 7.31 + rnd.z * 3.17);
      vec3 crop = rnd.y < 0.25 ? CROP_GRAIN : rnd.y < 0.5 ? CROP_GREEN : rnd.y < 0.75 ? CROP_HAY : CROP_SOIL;
      crop = mix(alb, crop, FIELD_STRENGTH * (0.55 + 0.9 * pick)) * (0.9 + 0.2 * rnd.z);
      float edgeW = max(0.06, footprint * fieldFreq * 1.5);
      float hedge = 1.0 - smoothstep(0.0, edgeW, F.y - F.x);
      crop = mix(crop, alb * 0.85, hedge * 0.4);
      far = mix(far, mix(alb, crop, on), detail);
    }
    col = far;
  }
  if (dg > 0.002) {
    float d = smoothstep(0.08, 0.95, dg);
    // worn: paler, browner, less green, with patches of bare soil where it is worst
    float lum = dot(col, vec3(0.30, 0.55, 0.15));
    vec3 worn = BARE_SOIL * (lum / dot(BARE_SOIL, vec3(0.30, 0.55, 0.15))) * 1.15;
    col = mix(col, worn, d * 0.5);
    // bare patches are small (a few per cell): at globe scale they average into a paler tone
    float patchN = ws_fbm(p + 53.0, uCellFreq * 5.0, 3, footprint);
    float bare = smoothstep(0.5, 0.95, d + patchN * 0.8);
    col = mix(col, BARE_SOIL * (0.9 + 0.3 * patchN), bare * 0.6);
  }
  return col;
}

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
    // Lakes: the same contour trick on the linearly interpolated lake flag (continuous
    // across triangles), so shores are organic curves rather than cell polygons.
    float lakeLin = dot(b, vec3(vC0.a, vC1.a, vC2.a));
    float aaLin = fwidth(lakeLin);
    float lakeF = -1.0;
    float lakeM = 0.0;
    if (max(vC0.a, max(vC1.a, vC2.a)) > 0.0) {
      lakeF = lakeLin - 0.5 + 0.55 * ws_fbm(p + 29.0, uCellFreq * 0.6, 5, footprint);
      float aaL = aaLin * 1.2 + footprint * uCellFreq * 0.25 + 1e-4;
      lakeM = smoothstep(-aaL, aaL, lakeF);
    }
    // Reservoirs behind dams: the same contour on the interpolated fill, with a finer,
    // weaker shore noise so the pool stays small and close to its dam.
    if (uResOn > 0.0 && max(vRes.x, max(vRes.y, vRes.z)) > 0.0) {
      float resLin = dot(b, vRes);
      float resF = resLin - 0.6 + 0.16 * ws_fbm(p + 37.0, uCellFreq * 1.6, 4, footprint);
      float aaR = fwidth(resLin) * 1.2 + footprint * uCellFreq * 0.25 + 1e-4;
      float resM = smoothstep(-aaR, aaR, resF);
      lakeF = max(lakeF, resF * 2.0);
      lakeM = max(lakeM, resM);
    }
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

      // people: cultivated fields and worn-out land (only where the data says so)
      if (uFarm > 0.0 && max(max(vLand.x, vLand.y), vLand.z) + max(max(vDeg.x, vDeg.y), vDeg.z) > 0.002) {
        alb = farmland(alb, p, dot(w, vLand), dot(w, vDeg), m2 - 0.4 * m1, footprint);
      }

      // high or steep ground gets ridged relief below (crisp crests, dark gullies)
      float elev = max(vSurf.x, 0.0);
      float steep = 1.0 - dot(N, up);
      float mtn = clamp(smoothstep(0.3, 0.68, elev) + 0.5 * smoothstep(0.06, 0.16, steep) * smoothstep(0.18, 0.4, elev), 0.0, 1.0);

      // small-scale bump on land normals, rougher in the mountains
      vec4 bump = ws_fbmd(p + 7.3, uCellFreq * 2.5, 4, footprint);
      vec3 g = (bump.yzw - dot(bump.yzw, up) * up) / uCellFreq;
      float rough = (0.012 + 0.09 * smoothstep(0.12, 0.6, elev)) * (1.0 - 0.55 * mtn);
      N = normalize(N - g * rough);

      float ridge = 0.5;
      if (mtn > 0.01) {
        float rf = uCellFreq * 1.5;
        vec3 warp = ws_noised(p * (rf * 0.35) + 3.7).yzw;
        vec4 rg = ws_ridged(p + 13.7 + warp * (0.35 / rf), rf, 3, footprint);
        vec3 gr = (rg.yzw - dot(rg.yzw, up) * up) / rf;
        N = normalize(N - gr * 0.2 * mtn);
        ridge = rg.x;
        alb *= mix(1.0, 0.76 + 0.45 * ridge, mtn);
      }

      // snow line from temperature, broken up by noise, slope and ridges
      if (vSurf.y > 0.08) {
        float slope = 1.0 - dot(N, up);
        float sn = vSurf.y + 0.28 * ws_fbm(p + 3.1, 25.0, 4, footprint) - slope * 1.2 + (ridge - 0.5) * 0.3 * mtn;
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
      float lakeW = lakeM * (1.0 - seaM);
      float depth = clamp(-mix(vDepth, vSurf.x, 0.35), 0.0, 1.0) * (1.0 - lakeW);
      float dn = ws_fbm(p + 11.0, 6.0, 3, footprint);
      float dn2 = ws_fbm(p + 13.0, uCellFreq * 0.5, 2, footprint);
      float dd = depth + dn * 0.06 + dn2 * 0.04;
      vec3 wcol = mix(SHELF, SHALLOW, smoothstep(0.0, 0.2, dd));
      wcol = mix(wcol, DEEP, smoothstep(0.15, 0.7, dd));
      vec3 lakeCol = mix(LAKE_SHORE, LAKE_DEEP, smoothstep(0.12, 0.6, lakeF + dn2 * 0.08));
      wcol = mix(wcol, lakeCol, lakeW);

      float ice = 0.0;
      if (vSurf.z > 0.08) ice = smoothstep(0.45, 0.55, vSurf.z + 0.3 * ws_fbm(p + 5.5, 18.0, 4, footprint));

      // Sun glint: an anisotropic lobe (stretched east-west, like wind-driven seas) whose
      // width follows a patchy roughness field, so the glint breaks into calm bright
      // streaks and rough dim patches. Resolved wave slopes tilt the normal; slopes too
      // fine for this zoom widen the lobe instead. Noise is only evaluated near the glint.
      vec3 H = normalize(L + V);
      float nv = max(dot(up, V), 0.0);
      float nl0 = max(dot(up, L), 0.0);
      float fresH = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
      float axBase = mix(0.085, 0.04, ws_lod(240.0, footprint));
      float sheen = glintLobe(up, H, east, north, axBase * 3.5, axBase * 2.2, nl0);
      float spec = 0.0;
      if (sheen * fresH > 2e-4) {
        vec3 S = vec3(1.0, 3.0, 1.0);
        float wind = ws_fbm(p * S + 7.0, 9.0, 2, footprint);
        float streak = ws_fbm(p * S + 4.0, 40.0, 2, footprint);
        float rough = 0.75 + 0.85 * smoothstep(-0.45, 0.45, wind + 0.6 * streak);
        vec4 sw = ws_fbmd(p * S + 2.0, 70.0, 2, footprint);
        vec4 ch = ws_fbmd(p + 9.0, 240.0, 3, footprint);
        vec3 gsw = sw.yzw * S;
        vec3 wslope = 0.035 * (gsw - dot(gsw, up) * up) / 70.0 + 0.12 * (ch.yzw - dot(ch.yzw, up) * up) / 240.0;
        vec3 Nw = normalize(up - wslope);
        float ax = axBase * rough;
        float nl = max(dot(Nw, L), 0.0);
        float glitter = 0.5 + 0.9 * smoothstep(-0.25, 0.35, streak + 0.5 * ch.x);
        spec = fresH * 15.0 * (glintLobe(Nw, H, east, north, ax, ax * 0.55, nl) * glitter + 0.12 * sheen);
      }
      spec *= dayFade * (1.0 - ice);
      float fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
      float wdiff = max(mu, 0.0) * dayFade;
      sea = wcol * (uSunColor * wdiff * 0.9 + skyAmb * 1.2);
      sea += uSunColor * spec;
      sea = mix(sea, SKY * 0.35 * dayFade, fres * 0.55);
      vec3 iceLit = SEA_ICE * (0.95 + 0.1 * dn) * (uSunColor * wdiff + skyAmb);
      sea = mix(sea, iceLit, ice);
    }

    color = mix(land, sea, water);

    // Night side: settlement lights, a radial glow around each lit cell centre (radius
    // and brightness grow with population), its outline warped by noise into an
    // irregular sprawl, plus street-level sparkle that only resolves when zoomed in.
    if (uCityLights > 0.0 && max(vLight.x, max(vLight.y, vLight.z)) > 0.0 && dayFade < 0.995) {
      float warp = 0.16 * ws_fbm(p + 41.0, uCellFreq * 2.2, 3, footprint);
      vec3 dist = vec3(length(p - vLP0), length(p - vLP1), length(p - vLP2)) * uCellFreq + warp;
      vec3 rad = 0.1 + 0.3 * vLight;
      vec3 x = dist / rad;
      vec3 core = exp(-x * x * 2.2);
      vec3 halo = exp(-x * x * 0.45);
      vec3 per = (core * (0.25 + 1.1 * vLight) + halo * 0.18 * vLight) * vLight * step(0.0001, vLight);
      float lum = per.x + per.y + per.z;
      lum *= 0.65 + 0.7 * (ws_fbm(p + 77.0, uCellFreq * 8.0, 2, footprint) + 0.5);
      vec3 lc = mix(CITY, CITY_CORE, clamp(dot(core, vLight * vLight), 0.0, 1.0));
      color += (1.0 - dayFade) * uCityLights * lum * lc * (1.0 - water);
    }
  } else {
    // ---------- data views: flat, legible lighting from the viewer ----------
    vec3 c = c0 * w.x + c1 * w.y + c2 * w.z;
    if (uLandView > 0.0) {
      // cultivated intensity green -> yellow, degradation toward red-brown, on land only
      float lu = dot(b, vLand);
      float dg = dot(b, vDeg);
      float landM = smoothstep(-1e-4, 1e-4 + fwidth(vSurf.x), vSurf.x) * (1.0 - dot(b, vec3(vC0.a, vC1.a, vC2.a)));
      if (lu + dg > 0.002 && landM > 0.0) {
        vec3 lo = ws_srgbToLinear(vec3(0.16, 0.40, 0.22));
        vec3 mid = ws_srgbToLinear(vec3(0.50, 0.72, 0.26));
        vec3 hi = ws_srgbToLinear(vec3(0.96, 0.86, 0.30));
        vec3 rc = lu < 0.5 ? mix(lo, mid, lu * 2.0) : mix(mid, hi, lu * 2.0 - 1.0);
        vec3 lc = mix(c, rc, smoothstep(0.0, 0.06, lu));
        lc = mix(lc, ws_srgbToLinear(vec3(0.62, 0.24, 0.13)), smoothstep(0.12, 0.85, dg) * 0.85);
        c = mix(c, lc, landM);
      }
    }
    vec3 Lv = normalize(V + 0.35 * cross(V, vec3(0.0, 1.0, 0.0)) + vec3(0.0, 0.3, 0.0));
    float lam = max(dot(N, Lv), 0.0);
    color = c * (0.32 + 0.78 * lam);
  }

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
