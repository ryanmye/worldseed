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
import { ViewMode, blendStyleFor, colorForMode, seaIceFactor, snowFactor, type ModeData } from './palette.ts'
import { BAKE_TARGETS, bakeFrag, bakedFrag, bakeTargetSize, LIGHT_TEX_WIDTH, NEVER, PLANET_FRAG, PLANET_VERT } from './planetShaders.ts'
import { createCubeBake, type CubeBake } from './surfaceBake.ts'
import { SUN_COLOR, SUN_DIRECTION, sunUniforms } from './sun.ts'

export const PLANET_RADIUS = 1
/** Geometric displacement of land (fraction of radius). Kept subtle: no lumpy limb. */
export const RELIEF_SCALE = 0.011
/** Exaggerated displacement used only to derive shading normals. */
const NORMAL_RELIEF_SCALE = 0.065

/** Sun direction in world space (shared, mutable: see sun.ts) and colour. */
export { SUN_COLOR, SUN_DIRECTION }

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
  /**
   * Bake the static Terrain surface into cube maps of face size `size` (0: no bake, the
   * procedural shader draws every frame). The bake runs progressively in bakeStep().
   */
  setBakeSize(size: number): void
  /** Draw up to `maxFaces` bake faces; returns true while a bake is in progress. */
  bakeStep(renderer: THREE.WebGLRenderer, maxFaces: number, sync?: boolean): boolean
  readonly bakeInfo: { ready: boolean; pending: boolean; count: number; lastMs: number; bytes: number; size: number }
  /** Debug: output noise calls per pixel instead of colour (see glsl.ts). */
  setNoiseCount(on: boolean): void
  /** Debug: false draws the procedural shader even when the bake is ready (A/B timing). */
  setBakeUse(on: boolean): void
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
    if (bakedMaterial) pickMaterial()
  }
  const syncLandUniforms = () => {
    const u = material.uniforms
    u.uLandView.value = currentMode === ViewMode.LandUse ? 1 : 0
    u.uFarm.value = hasLand && farmlandVisible && currentMode === ViewMode.Terrain ? 1 : 0
    u.uLandOn.value = hasLand && (u.uFarm.value > 0 || u.uLandView.value > 0) ? 1 : 0
    u.uResOn.value = hasReservoirs && reservoirsVisible && currentMode === ViewMode.Terrain ? 1 : 0
  }

  const cellSpacing = Math.sqrt((4 * Math.PI) / cellCount)
  const uniforms = {
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
    uDaylight: sunUniforms.uDaylight,
  }
  // procedural: data views, and the Terrain view until its bake is ready
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG })

  const mesh = new THREE.Mesh(geometry, material)
  const tmpQ = new THREE.Quaternion()

  // ----- surface bake (Terrain view) -----
  let bake: CubeBake | null = null
  let bakedMaterial: THREE.ShaderMaterial | null = null
  let bakeSize = 0
  let bakeCount = 0
  let countNoise = false
  let useBakeWhenReady = true
  const bakeUniforms = {
    uCellFreq: uniforms.uCellFreq,
    uLandOn: { value: 0 },
    uResOn: { value: 0 },
    uCityLights: { value: 0 },
  }
  const disposeBake = () => {
    bake?.dispose()
    bakedMaterial?.dispose()
    bake = null
    bakedMaterial = null
  }
  const applyNoiseDefine = (m: THREE.ShaderMaterial) => {
    if (countNoise) m.defines = { ...m.defines, WS_COUNT_NOISE: '' }
    else if (m.defines && 'WS_COUNT_NOISE' in m.defines) {
      const d = { ...m.defines }
      delete d.WS_COUNT_NOISE
      m.defines = d
    }
    m.needsUpdate = true
  }
  const pickMaterial = () => {
    const useBake = useBakeWhenReady && currentMode === ViewMode.Terrain && bake !== null && bake.ready && bakedMaterial !== null
    mesh.material = useBake ? (bakedMaterial as THREE.ShaderMaterial) : material
  }
  applyColors(mode)

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
      pickMaterial()
      mesh.updateWorldMatrix(true, false)
      mesh.getWorldQuaternion(tmpQ).invert()
      ;(material.uniforms.uSunObj.value as THREE.Vector3).copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      const cam = material.uniforms.uCamObj.value as THREE.Vector3
      camera.getWorldPosition(cam)
      mesh.worldToLocal(cam)
    },
    setBakeSize(size: number) {
      if (size === bakeSize && (bake || size <= 0)) return
      disposeBake()
      bakeSize = size
      if (size <= 0) {
        pickMaterial()
        return
      }
      const passes = []
      for (let t = 0; t < BAKE_TARGETS; t++) {
        passes.push({
          size: bakeTargetSize(t, size),
          format: t === BAKE_TARGETS - 1 ? THREE.RedFormat : THREE.RGBAFormat,
          material: new THREE.ShaderMaterial({
            uniforms: bakeUniforms,
            vertexShader: PLANET_VERT,
            fragmentShader: bakeFrag(t, size),
            side: THREE.BackSide,
            depthTest: false,
            depthWrite: false,
          }),
        })
      }
      bake = createCubeBake(geometry, passes, 0.2, 4)
      const tex = bake.textures
      bakedMaterial = new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uBake0: { value: tex[0] }, uBake1: { value: tex[1] }, uBake2: { value: tex[2] }, uBake3: { value: tex[3] }, uBake4: { value: tex[4] } },
        vertexShader: PLANET_VERT,
        fragmentShader: bakedFrag(size),
      })
      if (countNoise) applyNoiseDefine(bakedMaterial)
      bake.start()
      pickMaterial()
    },
    bakeStep(renderer: THREE.WebGLRenderer, maxFaces: number, sync = false) {
      // the bake reads the Terrain corner colours from the vertex attributes
      if (!bake || !bake.pending || currentMode !== ViewMode.Terrain) return false
      const more = bake.step(renderer, maxFaces, sync)
      if (!more) {
        bakeCount++
        pickMaterial()
      }
      return more
    },
    get bakeInfo() {
      return {
        ready: bake?.ready ?? false,
        pending: bake?.pending ?? false,
        count: bakeCount,
        lastMs: bake?.lastMs ?? 0,
        bytes: bake?.bytes ?? 0,
        size: bakeSize,
      }
    },
    setBakeUse(on: boolean) {
      useBakeWhenReady = on
      pickMaterial()
    },
    setNoiseCount(on: boolean) {
      countNoise = on
      applyNoiseDefine(material)
      if (bakedMaterial) applyNoiseDefine(bakedMaterial)
    },
    dispose() {
      disposeBake()
      geometry.dispose()
      material.dispose()
      lightTex.dispose()
      cellPosTex.dispose()
      landTex.dispose()
      resTex.dispose()
    },
  }
}
