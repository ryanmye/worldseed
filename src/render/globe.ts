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
// Relief: the ground is the shared height function of terrainHeight.ts (cell elevations
// with rounded, Phong-style interpolation, plus band-limited ridged detail that grows with
// elevation and slope, flattened at towns, fields and rivers). The base mesh carries it
// at the cell centres; near the camera the land triangles are replaced by finer detail
// tiles (terrainDetail.ts) in the same geometry, index range after the base triangles, so
// the planet stays one draw call (and the diorama shadow receiver, which redraws this
// geometry, gets the same ground). Positions are stored at the close-zoom relief and
// moved to the zoom's relief in the vertex shader (ws_relief); shading normals come from
// the gradient attribute with a zoom-dependent exaggeration. All noise is evaluated on
// the stored object-space positions (seamless, anchored, unchanged by the zoom).

import * as THREE from 'three'
import type { World } from '../contract.ts'
import { ViewMode, blendStyleFor, colorForMode, seaIceFactor, type ModeData } from './palette.ts'
import { BAKE_TARGETS, bakeFrag, bakedFrag, bakeTargetSize, LIGHT_TEX_WIDTH, NEVER, PLANET_FRAG, PLANET_VERT } from './planetShaders.ts'
import { createCubeBake, type CubeBake } from './surfaceBake.ts'
import { SUN_COLOR, SUN_DIRECTION, sunUniforms } from './sun.ts'
import { closeDetailUniforms } from './dioramas/townMask.ts'
import { evalGround, newGroundSample, relief, RELIEF_NEAR, reliefUniforms, setReliefAltitude, terrainOf } from './terrainHeight.ts'
import { createDetailPatch } from './terrainDetail.ts'
import { traceAdd } from './perfTrace.ts'
import { requestRender } from './invalidate.ts'
import { cellDirTexture, flatUniforms, seamCopy } from './mapProjection.ts'

export const PLANET_RADIUS = 1
/** Stored relief of the ground (fraction of radius per unit of height; terrainHeight.ts): CPU placements use it. */
export const RELIEF_SCALE = RELIEF_NEAR

/** Sun direction in world space (shared, mutable: see sun.ts) and colour. */
export { SUN_COLOR, SUN_DIRECTION }

/** Sea of the Factions view on the flat map (sRGB). */
const MAP_FACTIONS_SEA = [44, 70, 100]

export function lakeArray(world: World): Uint8Array | null {
  const lake = (world as Partial<World>).lake
  return lake && lake.length === world.grid.cellCount ? lake : null
}

export function isWaterCell(world: World, lake: Uint8Array | null, i: number): boolean {
  return world.elevation[i] < 0 || (lake !== null && lake[i] === 1)
}

/**
 * Radius of the ground at cell centre i, at the stored relief (terrainHeight.ts: the sea is
 * flat at sea level, lakes keep their land height, towns sit in their valley floors). Layer
 * shaders move it to the zoom's relief with ws_relief (RELIEF_GLSL); CPU code with reliefRadius.
 */
export function surfaceRadius(world: World, i: number): number {
  return terrainOf(world).cellRadius[i]
}

export interface GlobeMesh {
  mesh: THREE.Mesh
  geometry: THREE.BufferGeometry
  /** Cell index of each (non-indexed) vertex. */
  cellOfVertex: Uint32Array
  setMode(mode: ViewMode): void
  /** Per-cell carrying capacity for the Capacity view (null until history arrives). */
  setCapacity(capacity: Float32Array | null): void
  /**
   * Per-cell population density and its fixed colour-scale maximum for the Population view
   * (null until history arrives). Call it whenever the shown snapshot changes, not per frame.
   */
  setDensity(density: Float32Array | null, max: number): void
  /**
   * Per-cell colours of the Crops and Herds views (sRGB 0..255, 3 per cell; null: all land
   * neutral). Rewrites the corner colours while one of those views shows: call it when the
   * land snapshot or the selection changes, not per frame.
   */
  setSpeciesColors(rgb: Uint8Array | null): void
  /** Per-cell colours of the Faiths view (sRGB 0..255, 3 per cell; null: all land neutral); rewrites the corner colours while it shows. */
  setFaithColors(rgb: Uint8Array | null): void
  /** Per-cell colours of the Fever view (sRGB 0..255, 3 per cell; null: all land neutral); rewrites the corner colours while it shows. */
  setFeverColors(rgb: Uint8Array | null): void
  /** Per-cell colours of the Scenery view (sRGB 0..255, 3 per cell; null: all land neutral); rewrites the corner colours while it shows. */
  setSceneryColors(rgb: Uint8Array | null): void
  /** ideas: per-cell colours of the Ideas view (sRGB 0..255, 3 per cell; null: all land neutral); rewrites the corner colours while it shows. */
  setIdeaColors(rgb: Uint8Array | null): void
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
  /** Close-zoom detail tiles (perf=1): vertices and triangles drawn for them, tiles, finest level, last build ms, builds. */
  readonly detailInfo: { vertices: number; triangles: number; tiles: number; maxLevel: number; buildMs: number; builds: number; relief: number }
  /** The flat map's colours (a lighter atlas sea on the Factions view): on while the map shows. */
  setMapStyle(on: boolean): void
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
  const field = terrainOf(world)
  let fieldVersion = field.version
  const cellSurf = new Float32Array(cellCount * 4) // signed elevation, snow line, sea ice, detail displacement
  const cellTerr = new Float32Array(cellCount * 4) // h, detail amplitude x wildness, octaves (0: none), ridge
  const cellGrad = new Float32Array(cellCount * 3)
  const cellSeed = new Uint8Array(cellCount)
  const cellSlope = new Uint8Array(cellCount)
  const cellSeaIce = new Float32Array(cellCount)
  const { neighborOffsets: off, neighbors: nb } = world.grid
  for (let i = 0; i < cellCount; i++) {
    // mean elevation step to neighbours: scales coastline noise so it moves the shore by ~a fraction of a cell
    let sum = 0
    for (let k = off[i]; k < off[i + 1]; k++) sum += Math.abs(world.elevation[nb[k]] - world.elevation[i])
    cellSlope[i] = Math.min(255, Math.round((sum / Math.max(1, off[i + 1] - off[i])) * 2 * 255))
    cellSeaIce[i] = seaIceFactor(world, i)
    cellSeed[i] = Math.floor(hash01(i) * 256)
  }
  const cellDepth = smoothedElevation(world, 2)
  /** The ground at every cell centre (no detail octaves: the base mesh carries none). */
  const fillCells = () => {
    const g = newGroundSample()
    const done = new Uint8Array(cellCount)
    for (let t = 0; t < triangles.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const c = triangles[t + k]
        if (done[c]) continue
        done[c] = 1
        evalGround(field, triangles[t], triangles[t + 1], triangles[t + 2], k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0, 0, g)
        cellSurf[c * 4] = world.elevation[c]
        cellSurf[c * 4 + 1] = g.snow
        cellSurf[c * 4 + 2] = cellSeaIce[c]
        cellSurf[c * 4 + 3] = g.d
        cellTerr[c * 4] = g.h
        cellTerr[c * 4 + 1] = g.aw
        cellTerr[c * 4 + 2] = 0
        cellTerr[c * 4 + 3] = g.ridge
        cellGrad[c * 3] = g.gx
        cellGrad[c * 3 + 1] = g.gy
        cellGrad[c * 3 + 2] = g.gz
      }
    }
  }
  fillCells()

  // ----- geometry: the base triangles (three vertices each, indices 0..vCount-1), then the detail tiles -----
  let cap = vCount + 65536 // vertex capacity (grows with the detail patch)
  let icap = vCount + 3 * 131072 // index capacity
  const geometry = new THREE.BufferGeometry()
  const attr = (array: Float32Array | Uint8Array, size: number, normalized = false) => {
    const a = new THREE.BufferAttribute(array, size, normalized)
    a.setUsage(THREE.DynamicDrawUsage)
    return a
  }
  let aPosition = attr(new Float32Array(cap * 3), 3)
  let aGrad = attr(new Float32Array(cap * 3), 3)
  let aBary = attr(new Float32Array(cap * 3), 3)
  let aSurf = attr(new Float32Array(cap * 4), 4)
  let aTerr = attr(new Float32Array(cap * 4), 4)
  let aSeed = attr(new Uint8Array(cap * 4), 4, true)
  let aDepth = attr(new Float32Array(cap), 1)
  let aCorners = attr(new Float32Array(cap * 3), 3)
  let corner = [0, 1, 2].map(() => attr(new Uint8Array(cap * 4), 4, true))
  let indexAttr = new THREE.BufferAttribute(new Uint32Array(icap), 1)
  indexAttr.setUsage(THREE.DynamicDrawUsage)
  /** Base triangle of each detail-tile vertex (its corner colours). */
  let patchTri = new Uint32Array(0)
  let patchVerts = 0
  let patchIndices = 0
  let patchTiles = 0
  let patchMaxLevel = 0
  const hidden = new Uint8Array(vCount / 3)
  const bindAttributes = () => {
    geometry.setAttribute('position', aPosition)
    geometry.setAttribute('aGrad', aGrad)
    geometry.setAttribute('aBary', aBary)
    geometry.setAttribute('aSurf', aSurf)
    geometry.setAttribute('aTerr', aTerr)
    geometry.setAttribute('aSeed', aSeed)
    geometry.setAttribute('aDepth', aDepth)
    geometry.setAttribute('aCorners', aCorners)
    geometry.setAttribute('aC0', corner[0])
    geometry.setAttribute('aC1', corner[1])
    geometry.setAttribute('aC2', corner[2])
    geometry.setIndex(indexAttr)
  }
  {
    const idx = indexAttr.array as Uint32Array
    for (let v = 0; v < vCount; v++) idx[v] = v
  }
  /** Writes the base vertices (all, or restores the ones the patch no longer hides). */
  const writeBase = () => {
    const position = aPosition.array as Float32Array, grad = aGrad.array as Float32Array, bary = aBary.array as Float32Array
    const surf = aSurf.array as Float32Array, terr = aTerr.array as Float32Array, seeds = aSeed.array as Uint8Array
    const depth = aDepth.array as Float32Array, corners = aCorners.array as Float32Array
    for (let v = 0; v < vCount; v++) {
      const c = cellOfVertex[v]
      const r = PLANET_RADIUS + RELIEF_NEAR * cellTerr[c * 4]
      position[v * 3] = positions[c * 3] * r
      position[v * 3 + 1] = positions[c * 3 + 1] * r
      position[v * 3 + 2] = positions[c * 3 + 2] * r
      grad[v * 3] = cellGrad[c * 3]
      grad[v * 3 + 1] = cellGrad[c * 3 + 1]
      grad[v * 3 + 2] = cellGrad[c * 3 + 2]
      const k = v % 3
      bary[v * 3] = k === 0 ? 1 : 0
      bary[v * 3 + 1] = k === 1 ? 1 : 0
      bary[v * 3 + 2] = k === 2 ? 1 : 0
      for (let q = 0; q < 4; q++) {
        surf[v * 4 + q] = cellSurf[c * 4 + q]
        terr[v * 4 + q] = cellTerr[c * 4 + q]
      }
      depth[v] = cellDepth[c]
      const tri = v - k
      seeds[v * 4] = cellSeed[cellOfVertex[tri]]
      seeds[v * 4 + 1] = cellSeed[cellOfVertex[tri + 1]]
      seeds[v * 4 + 2] = cellSeed[cellOfVertex[tri + 2]]
      seeds[v * 4 + 3] = cellSlope[c]
      corners[v * 3] = cellOfVertex[tri]
      corners[v * 3 + 1] = cellOfVertex[tri + 1]
      corners[v * 3 + 2] = cellOfVertex[tri + 2]
    }
    // triangles the detail patch replaces collapse to a point (nothing to rasterise)
    for (let t = 0; t < hidden.length; t++) if (hidden[t]) collapse(t)
    for (const a of [aPosition, aGrad, aBary, aSurf, aTerr, aSeed, aDepth, aCorners]) {
      a.clearUpdateRanges()
      a.addUpdateRange(0, vCount * a.itemSize)
      a.needsUpdate = true
    }
  }
  const collapse = (t: number) => {
    const position = aPosition.array as Float32Array
    for (let k = 1; k < 3; k++) {
      position[(t * 3 + k) * 3] = position[t * 9]
      position[(t * 3 + k) * 3 + 1] = position[t * 9 + 1]
      position[(t * 3 + k) * 3 + 2] = position[t * 9 + 2]
    }
  }
  writeBase()
  bindAttributes()
  geometry.setDrawRange(0, vCount)
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), PLANET_RADIUS + RELIEF_NEAR * 1.6 + 1e-3)

  const patch = createDetailPatch(world, field, { seaIce: cellSeaIce, depth: cellDepth, seed: cellSeed })
  /** Grows every attribute (and the index) to hold `nv` vertices and `ni` indices; rebinds them. */
  const ensureCapacity = (nv: number, ni: number) => {
    if (nv <= cap && ni <= icap) return
    const ncap = Math.max(cap, nv) === cap ? cap : Math.ceil(Math.max(nv, cap * 1.5))
    const nicap = Math.max(icap, ni) === icap ? icap : Math.ceil(Math.max(ni, icap * 1.5))
    const regrow = (a: THREE.BufferAttribute, normalized = false) => {
      const old = a.array as Float32Array | Uint8Array
      const arr = new (old.constructor as { new (n: number): Float32Array | Uint8Array })(ncap * a.itemSize)
      arr.set(old.subarray(0, Math.min(old.length, arr.length)))
      return attr(arr, a.itemSize, normalized)
    }
    if (ncap !== cap) {
      aPosition = regrow(aPosition); aGrad = regrow(aGrad); aBary = regrow(aBary); aSurf = regrow(aSurf); aTerr = regrow(aTerr)
      aSeed = regrow(aSeed, true); aDepth = regrow(aDepth); aCorners = regrow(aCorners)
      corner = corner.map((c) => regrow(c, true))
      cap = ncap
    }
    if (nicap !== icap) {
      const arr = new Uint32Array(nicap)
      arr.set((indexAttr.array as Uint32Array).subarray(0, Math.min(icap, nicap)))
      indexAttr = new THREE.BufferAttribute(arr, 1)
      indexAttr.setUsage(THREE.DynamicDrawUsage)
      icap = nicap
    }
    bindAttributes()
    for (const a of [aPosition, aGrad, aBary, aSurf, aTerr, aSeed, aDepth, aCorners, ...corner]) {
      a.clearUpdateRanges()
      a.needsUpdate = true
    }
    indexAttr.clearUpdateRanges()
    indexAttr.needsUpdate = true
  }
  /** Swaps a finished detail patch into the geometry (one upload of the used ranges). */
  const commitPatch = () => {
    const r = patch.result
    ensureCapacity(vCount + r.vertexCount, vCount + r.indexCount)
    const nv = r.vertexCount, ni = r.indexCount
    ;(aPosition.array as Float32Array).set(r.position.subarray(0, nv * 3), vCount * 3)
    ;(aGrad.array as Float32Array).set(r.grad.subarray(0, nv * 3), vCount * 3)
    ;(aBary.array as Float32Array).set(r.bary.subarray(0, nv * 3), vCount * 3)
    ;(aSurf.array as Float32Array).set(r.surf.subarray(0, nv * 4), vCount * 4)
    ;(aTerr.array as Float32Array).set(r.terr.subarray(0, nv * 4), vCount * 4)
    ;(aSeed.array as Uint8Array).set(r.seed.subarray(0, nv * 4), vCount * 4)
    ;(aDepth.array as Float32Array).set(r.depth.subarray(0, nv), vCount)
    ;(aCorners.array as Float32Array).set(r.corners.subarray(0, nv * 3), vCount * 3)
    const idx = indexAttr.array as Uint32Array
    const src = r.index
    for (let i = 0; i < ni; i++) idx[vCount + i] = src[i] + vCount
    if (patchTri.length < nv) patchTri = new Uint32Array(Math.max(nv, patchTri.length * 2))
    patchTri.set(r.tri.subarray(0, nv))
    patchVerts = nv
    patchIndices = ni
    patchTiles = r.tiles
    patchMaxLevel = r.maxLevel
    writePatchColors()
    // base triangles: restore the ones no longer covered, collapse the newly covered
    let baseChanged = false
    const position = aPosition.array as Float32Array
    for (let t = 0; t < hidden.length; t++) {
      if (hidden[t] === r.hidden[t]) continue
      baseChanged = true
      hidden[t] = r.hidden[t]
      if (hidden[t]) collapse(t)
      else {
        for (let k = 0; k < 3; k++) {
          const v = t * 3 + k
          const c = cellOfVertex[v]
          const rr = PLANET_RADIUS + RELIEF_NEAR * cellTerr[c * 4]
          position[v * 3] = positions[c * 3] * rr
          position[v * 3 + 1] = positions[c * 3 + 1] * rr
          position[v * 3 + 2] = positions[c * 3 + 2] * rr
        }
      }
    }
    for (const a of [aPosition, aGrad, aBary, aSurf, aTerr, aSeed, aDepth, aCorners, ...corner]) {
      a.clearUpdateRanges()
      if (a === aPosition && baseChanged) a.addUpdateRange(0, (vCount + nv) * 3)
      else if (nv > 0) a.addUpdateRange(vCount * a.itemSize, nv * a.itemSize)
      a.needsUpdate = nv > 0 || (a === aPosition && baseChanged)
    }
    indexAttr.clearUpdateRanges()
    if (ni > 0) {
      indexAttr.addUpdateRange(vCount, ni)
      indexAttr.needsUpdate = true
    }
    geometry.setDrawRange(0, vCount + ni)
    requestRender()
  }
  /** Corner colours of the detail-tile vertices, from the current view's cell colours. */
  const writePatchColors = () => {
    if (patchVerts === 0) return
    const arrays = corner.map((a) => a.array as Uint8Array)
    for (let v = 0; v < patchVerts; v++) {
      const t = patchTri[v] * 3
      for (let k = 0; k < 3; k++) {
        const c = cellOfVertex[t + k] * 4
        const o = (vCount + v) * 4
        const dst = arrays[k]
        dst[o] = cellColor[c]
        dst[o + 1] = cellColor[c + 1]
        dst[o + 2] = cellColor[c + 2]
        dst[o + 3] = cellColor[c + 3]
      }
    }
  }

  // Per-cell city-light intensity, fetched by cell index in the vertex shader.
  const lightH = Math.ceil(cellCount / LIGHT_TEX_WIDTH)
  const lightData = new Float32Array(LIGHT_TEX_WIDTH * lightH)
  const lightTex = new THREE.DataTexture(lightData, LIGHT_TEX_WIDTH, lightH, THREE.RedFormat, THREE.FloatType)
  lightTex.minFilter = THREE.NearestFilter
  lightTex.magFilter = THREE.NearestFilter
  lightTex.generateMipmaps = false
  lightTex.needsUpdate = true
  // Cell centre positions (on the ground), so light glows can be radial around them.
  const cellPosData = new Float32Array(LIGHT_TEX_WIDTH * lightH * 4)
  const writeCellPos = () => {
    for (let i = 0; i < cellCount; i++) {
      const r = PLANET_RADIUS + RELIEF_NEAR * cellTerr[i * 4]
      cellPosData[i * 4] = positions[i * 3] * r
      cellPosData[i * 4 + 1] = positions[i * 3 + 1] * r
      cellPosData[i * 4 + 2] = positions[i * 3 + 2] * r
    }
  }
  writeCellPos()
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

  const modeData: ModeData = { capacity: null, capacityMax: 0, density: null, densityMax: 0 }
  let currentMode = mode
  let mapStyle = false
  const cellColor = new Uint8Array(cellCount * 4)
  const applyColors = (m: ViewMode) => {
    currentMode = m
    // the political map on the flat map: an atlas sea, lighter than the globe's (the plate stands off its surround)
    const atlasSea = mapStyle && m === ViewMode.Factions
    for (let i = 0; i < cellCount; i++) {
      colorForMode(m, world, i, cellColor, i * 4, 255, modeData)
      if (atlasSea && isWaterCell(world, lake, i)) {
        cellColor[i * 4] = MAP_FACTIONS_SEA[0]
        cellColor[i * 4 + 1] = MAP_FACTIONS_SEA[1]
        cellColor[i * 4 + 2] = MAP_FACTIONS_SEA[2]
      }
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
    writePatchColors()
    for (const a of corner) {
      a.clearUpdateRanges()
      a.addUpdateRange(0, (vCount + patchVerts) * 4)
      a.needsUpdate = true
    }
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
    // close-zoom field detail, on while the 3D layer shows (dioramas/townMask.ts)
    uFieldDetail: closeDetailUniforms.uFieldDetail,
    // the zoom's relief (terrainHeight.ts), set in update()
    uReliefK: reliefUniforms.uReliefK,
    uShade: { value: relief.shade },
    uDetailShade: { value: relief.detailShade },
    uDetailFreq: { value: field.detailFreq },
    // the flat map (mapProjection.ts)
    ...flatUniforms,
  }
  flatUniforms.uWsCellDir.value = cellDirTexture(world)
  // procedural: data views, and the Terrain view until its bake is ready
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG })

  const mesh = new THREE.Mesh(geometry, material)
  // on the flat map, the triangles across the antimeridian drawn again a world over
  seamCopy(mesh)
  const tmpQ = new THREE.Quaternion()
  const camDir = new THREE.Vector3()
  /** Wall-clock budget per frame for building detail tiles (ms). */
  const PATCH_BUDGET_MS = 6

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
    uReliefK: { value: 1 },
    uDetailFreq: { value: field.detailFreq },
    // (always the globe: no uFlat)
    uWsCellDir: flatUniforms.uWsCellDir,
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
      if (currentMode === ViewMode.Capacity) applyColors(currentMode)
    },
    setDensity(density: Float32Array | null, max: number) {
      modeData.density = density && density.length === cellCount ? density : null
      modeData.densityMax = modeData.density ? max : 0
      if (currentMode === ViewMode.Population) applyColors(currentMode)
    },
    setSpeciesColors(rgb: Uint8Array | null) {
      modeData.speciesRgb = rgb && rgb.length >= cellCount * 3 ? rgb : null
      if (currentMode === ViewMode.Crops || currentMode === ViewMode.Herds || currentMode === ViewMode.Cash) applyColors(currentMode)
    },
    setFaithColors(rgb: Uint8Array | null) {
      modeData.faithRgb = rgb && rgb.length >= cellCount * 3 ? rgb : null
      if (currentMode === ViewMode.Faiths) applyColors(currentMode)
    },
    setFeverColors(rgb: Uint8Array | null) {
      modeData.feverRgb = rgb && rgb.length >= cellCount * 3 ? rgb : null
      if (currentMode === ViewMode.Fever) applyColors(currentMode)
    },
    setSceneryColors(rgb: Uint8Array | null) {
      modeData.sceneryRgb = rgb && rgb.length >= cellCount * 3 ? rgb : null
      if (currentMode === ViewMode.Scenery) applyColors(currentMode)
    },
    setIdeaColors(rgb: Uint8Array | null) { modeData.ideasRgb = rgb && rgb.length >= cellCount * 3 ? rgb : null; if (currentMode === ViewMode.Ideas) applyColors(currentMode) },
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
      // the zoom's relief (shared with every layer on the ground through reliefUniforms)
      setReliefAltitude(cam.length() - PLANET_RADIUS)
      material.uniforms.uShade.value = relief.shade
      material.uniforms.uDetailShade.value = relief.detailShade
      // the history reshaped the ground (towns, fields): base vertices again, and a new patch
      if (field.version !== fieldVersion) {
        fieldVersion = field.version
        fillCells()
        writeBase()
        writeCellPos()
        cellPosTex.needsUpdate = true
        patch.invalidate()
      }
      // close-zoom detail tiles: plan when the view has moved enough (built in bakeStep)
      camera.getWorldDirection(camDir).applyQuaternion(tmpQ)
      const persp = camera as THREE.PerspectiveCamera
      const halfFov = persp.isPerspectiveCamera ? Math.atan(Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2) * Math.hypot(1, persp.aspect)) : 0.6
      patch.update(cam.x, cam.y, cam.z, camDir.x, camDir.y, camDir.z, halfFov)
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
          format: THREE.RGBAFormat,
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
        uniforms: { ...uniforms, uBake0: { value: tex[0] }, uBake1: { value: tex[1] }, uBake2: { value: tex[2] }, uBake3: { value: tex[3] }, uBake4: { value: tex[4] }, uBake5: { value: tex[5] } },
        vertexShader: PLANET_VERT,
        fragmentShader: bakedFrag(size),
      })
      if (countNoise) applyNoiseDefine(bakedMaterial)
      bake.start()
      pickMaterial()
    },
    bakeStep(renderer: THREE.WebGLRenderer, maxFaces: number, sync = false) {
      // close-zoom detail tiles first, a few milliseconds per frame (any view)
      if (patch.pending) {
        const tp = performance.now()
        const done = patch.step(tp + PATCH_BUDGET_MS)
        const tc = performance.now()
        traceAdd('patch.build', tc - tp)
        if (done) {
          commitPatch()
          traceAdd('patch.commit', performance.now() - tc)
        }
        if (patch.pending) return true
      }
      // the bake reads the Terrain corner colours from the vertex attributes
      if (!bake || !bake.pending || currentMode !== ViewMode.Terrain) return false
      const more = bake.step(renderer, maxFaces, sync)
      if (!more) {
        bakeCount++
        pickMaterial()
      }
      return more
    },
    get detailInfo() {
      const st = patch.stats
      return { vertices: patchVerts, triangles: patchIndices / 3, tiles: patchTiles, maxLevel: patchMaxLevel, buildMs: +st.ms.toFixed(1), builds: st.builds, relief: +relief.scale.toFixed(4) }
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
    setMapStyle(on: boolean) {
      if (on === mapStyle) return
      mapStyle = on
      if (currentMode === ViewMode.Factions) applyColors(currentMode)
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
