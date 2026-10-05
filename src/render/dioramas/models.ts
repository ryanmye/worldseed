// The model set: a few CC0 meshes packed into two .glb files (see tools/buildModels.mjs and
// public/models/CREDITS.md) for the landmarks, ships, pier and cart, plus generated
// low-poly geometry (shapes.ts) for the bulk houses of every building style, the
// landmarks of the non-European styles, walls, trees, haystacks, the dam and the contact
// shadow. Every geometry carries the same attributes (position, normal and an RGBA8
// `aColor`: sRGB albedo plus a mask in alpha), so one material draws them all. Loading is
// asynchronous and failure-tolerant: until the promise resolves (or if it rejects) the
// diorama layer simply draws nothing; generated models never depend on the files.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PACK_PIECES, CIVIC_PIECES, civicPieceGeometry,
 mergeAtlas, SACRED_PIECES, sacredPieceGeometry, type PieceGeometry } from './landmarkShapes.ts'
import {
  buildBanner, buildBlob, buildBoat, buildDam, buildHaystacks, buildRubble, buildSmoke, buildStalls, buildTownBridge, buildWallSegment, buildWallTower, buildWell, FLORA_COUNT, floraGeometry,
  isFarKind, KIND_COUNT, STYLE_COUNT, styleGeometry, type Flora, type Kind, type Style,
} from './shapes.ts'

/**
 * World units per KayKit model unit. A generated house (0.8 units wide) is ~0.0006 wide on
 * the globe: 0.026 of a cell (~150 km), still some 400 times true scale, but small enough
 * that settlements sit in the landscape instead of covering it.
 */
export const KK = 0.00075
/** Width of a common house on the globe (world units). */
export const HOUSE_WIDTH = 0.8 * KK

export const Model = {
  Church: 0,
  Market: 1,
  Tavern: 2,
  Well: 3,
  Blacksmith: 4,
  Windmill: 5,
  Watermill: 6,
  Castle: 7,
  Tower: 8,
  Barracks: 9,
  Lumbermill: 10,
  Ship: 11,
  ShipMedium: 12,
  Dock: 13,
  Cart: 14,
  Haystack: 15,
  Dam: 16,
  WallSeg: 17,
  WallTower: 18,
  Stalls: 19,
  SmallWell: 20,
  TownBridge: 21,
  Boat: 22,
  FishingBoat: 23,
  /** A banner on a pole, in its instance's wall colour (a faction's colour). */
  Banner: 24,
  /** Rubble of a slighted wall or a burnt-out house. */
  Rubble: 25,
  /** Smoke over a sacked town. */
  Smoke: 26,
  /** Landmarks (landmarkShapes.ts): the houses of worship of every building tradition, one atlas (the instance picks its piece). */
  LandmarkSacred: 27,
  /** Landmarks: keeps, palaces, halls, lighthouses, monuments, the scaffold and the cloister, one atlas. */
  LandmarkCivic: 28,
  /** Landmarks: the KayKit pieces of landmarks.glb (builders' yard, construction stages, ruined house, towers), one atlas. */
  LandmarkPack: 29,
} as const
export type Model = (typeof Model)[keyof typeof Model]
const FLORA_BASE = 30
const STYLE_BASE = FLORA_BASE + FLORA_COUNT
export const MODEL_COUNT = STYLE_BASE + STYLE_COUNT * KIND_COUNT

/** Model of a generated grove. */
export const floraModel = (f: Flora) => FLORA_BASE + f
/** Model of a generated building of a style. */
export const styleModel = (s: Style, k: Kind) => STYLE_BASE + s * KIND_COUNT + k
export const isStyleModel = (m: number) => m >= STYLE_BASE
/** Whether a model is a low-detail village cluster (drawn far away: no facade, no shadow map). */
export const isFarModel = (m: number) => m >= STYLE_BASE && m < MODEL_COUNT && isFarKind((m - STYLE_BASE) % KIND_COUNT)
/** Style and kind of a generated building model (or null). */
export const styleKindOf = (m: number): [Style, Kind] | null => (m >= STYLE_BASE && m < MODEL_COUNT ? [Math.floor((m - STYLE_BASE) / KIND_COUNT) as Style, ((m - STYLE_BASE) % KIND_COUNT) as Kind] : null)

interface ModelSpec {
  /** Mesh name in the .glb, or null for generated geometry. */
  name: string | null
  /** World units per model unit. */
  scale: number
  /** Lit windows on the night side. */
  lit: boolean
}

const S = (name: string | null, scale: number, lit = false): ModelSpec => ({ name, scale, lit })

/**
 * KayKit landmarks are a little larger than the generated houses (a church ~1.3 houses
 * wide); ships and boats are smaller than a church; the pier is a few house widths.
 */
export const MODEL_SPECS: readonly ModelSpec[] = (() => {
  const specs: ModelSpec[] = [
    S('church', KK * 1.3, true),
    S('market', KK * 1.05, true),
    S('tavern', KK * 1.05, true),
    S('well', KK * 0.8),
    S('blacksmith', KK * 1.0, true),
    S('windmill', KK * 1.25, true),
    S('watermill', KK * 1.1, true),
    S('castle', KK * 0.85, true),
    S('tower_A', KK * 1.05, true),
    S('barracks', KK * 0.95, true),
    S('lumbermill', KK * 0.95, true),
    S('ship', KK * 0.14), // ~8.8 units long: 1.2 KayKit units, about a long house
    S('ship_medium', KK * 0.13),
    S('dock', KK * 0.24),
    S('cart', KK * 0.26),
    S(null, KK * 0.9), // haystacks
    S(null, KK), // dam (x is scaled to the river per instance)
    S(null, KK), // wall section (x scaled per instance)
    S(null, KK), // wall tower
    S(null, KK * 1.1), // market stalls
    S(null, KK), // small well
    S(null, KK), // town bridge (x scaled per instance)
    S(null, KK), // rowing boat
    S(null, KK), // fishing boat
    S(null, KK), // banner
    S(null, KK), // rubble
    S(null, KK), // smoke
    S(null, KK, true), // landmarks: sacred atlas
    S(null, KK, true), // landmarks: civic atlas
    S(null, KK, true), // landmarks: KayKit atlas
  ]
  for (let f = 0; f < FLORA_COUNT; f++) specs.push(S(null, KK))
  for (let s = 0; s < STYLE_COUNT; s++) for (let k = 0; k < KIND_COUNT; k++) specs.push(S(null, KK, true))
  return specs
})()

export interface ModelEntry {
  geometry: THREE.BufferGeometry
  /** Bounding box size in model units. */
  size: THREE.Vector3
  /** Footprint radius on the globe (world units). */
  footprint: number
  /** Height on the globe (world units). */
  height: number
  /** Triangles. */
  triangles: number
}

/** A piece of a landmark atlas (model units): footprint radius, height, and the height its walls reach (ruins break them below it). */
export interface PieceInfo {
  footprint: number
  height: number
  eave: number
  /** Half sizes along x and z. */
  hx: number
  hz: number
}

export interface ModelLibrary {
  models: (ModelEntry | null)[]
  /** Pieces of the landmark atlases (Model.LandmarkSacred, Model.LandmarkCivic), by piece number. */
  sacredPieces: PieceInfo[]
  civicPieces: PieceInfo[]
  packPieces: PieceInfo[]
  blob: THREE.BufferGeometry
  dispose(): void
}

const BASE = import.meta.env?.BASE_URL ?? '/'
const FILES = [`${BASE}models/kaykit/kaykit-medieval.glb`, `${BASE}models/kenney/kenney-ships.glb`, `${BASE}models/landmarks/landmarks.glb`]
/** Meshes of the packs by name while the library is made (the civic atlas takes its KayKit pieces from them). */
let packed: Map<string, THREE.BufferGeometry> = new Map()

let pending: Promise<ModelLibrary> | null = null

/** Starts loading (once) and resolves with the library; rejects only if nothing usable exists. */
export function loadModels(): Promise<ModelLibrary> {
  if (!pending) pending = load()
  return pending
}

function generated(id: number): THREE.BufferGeometry | null {
  switch (id) {
    case Model.Haystack: return buildHaystacks()
    case Model.Dam: return buildDam()
    case Model.WallSeg: return buildWallSegment()
    case Model.WallTower: return buildWallTower()
    case Model.Stalls: return buildStalls()
    case Model.SmallWell: return buildWell()
    case Model.TownBridge: return buildTownBridge()
    case Model.Boat: return buildBoat(false)
    case Model.FishingBoat: return buildBoat(true)
    case Model.Banner: return buildBanner()
    case Model.Rubble: return buildRubble()
    case Model.Smoke: return buildSmoke()
    case Model.LandmarkSacred: return atlas(SACRED_PIECES, sacredPieceGeometry, atlasInfo.sacred)
    case Model.LandmarkCivic: return atlas(CIVIC_PIECES, civicPieceGeometry, atlasInfo.civic)
    case Model.LandmarkPack: return atlas(PACK_PIECES.length, packedPiece, atlasInfo.pack)
  }
  if (id >= STYLE_BASE) {
    const k = id - STYLE_BASE
    return styleGeometry(Math.floor(k / KIND_COUNT) as Style, (k % KIND_COUNT) as Kind)
  }
  if (id >= FLORA_BASE) return floraGeometry((id - FLORA_BASE) as Flora)
  return null
}

/** A KayKit piece of landmarks.glb (PackPiece p); an empty piece if the file did not load. */
function packedPiece(p: number): PieceGeometry {
  const g = packed.get(PACK_PIECES[p])
  if (!g) {
    const e = new THREE.BufferGeometry()
    e.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 0, -1, 0, 0, -1, 0], 3))
    e.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
    e.setAttribute('aColor', new THREE.BufferAttribute(new Uint8Array(12), 4, true))
    return { geometry: e, size: [0, 0, 0] }
  }
  const c = g.clone()
  c.computeBoundingBox()
  const bb = c.boundingBox!
  return { geometry: c, size: [bb.max.x - bb.min.x, bb.max.y, bb.max.z - bb.min.z] }
}

/** Pieces of the two landmark atlases as built (generated), and their merged geometries. */
const atlasInfo = { sacred: [] as PieceInfo[], civic: [] as PieceInfo[], pack: [] as PieceInfo[] }
function atlas(n: number, make: (p: number) => PieceGeometry, out: PieceInfo[]): THREE.BufferGeometry {
  const gs: THREE.BufferGeometry[] = []
  out.length = 0
  for (let p = 0; p < n; p++) {
    const { geometry, size } = make(p)
    gs.push(geometry)
    out.push({ footprint: 0.5 * Math.max(size[0], size[2]), height: size[1], eave: size[1] * 0.8, hx: size[0] / 2, hz: size[2] / 2 })
  }
  const g = mergeAtlas(gs)
  for (const x of gs) x.dispose()
  return g
}

async function load(): Promise<ModelLibrary> {
  const loader = new GLTFLoader()
  const results = await Promise.allSettled(FILES.map((f) => loader.loadAsync(f)))
  const byName = new Map<string, THREE.BufferGeometry>()
  for (const r of results) {
    if (r.status !== 'fulfilled') {
      console.warn('diorama models failed to load:', r.reason)
      continue
    }
    r.value.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const g = mesh.geometry as THREE.BufferGeometry
      const color = g.getAttribute('color')
      if (!color) return
      g.setAttribute('aColor', color)
      g.deleteAttribute('color')
      byName.set(mesh.name, g)
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) m.dispose()
    })
  }
  packed = byName
  const models: (ModelEntry | null)[] = MODEL_SPECS.map((spec, id) => {
    const g = spec.name ? byName.get(spec.name) : generated(id)
    if (!g) return null
    g.computeBoundingBox()
    const size = new THREE.Vector3()
    g.boundingBox!.getSize(size)
    const idx = g.getIndex()
    const triangles = (idx ? idx.count : g.getAttribute('position').count) / 3
    // height above the ground (generated walls reach below y = 0)
    const top = g.boundingBox!.max.y
    return { geometry: g, size, footprint: 0.5 * Math.max(size.x, size.z) * spec.scale, height: top * spec.scale, triangles }
  })
  // unused meshes of the packs
  for (const [name, g] of byName) if (!MODEL_SPECS.some((s) => s.name === name)) g.dispose()
  packed = new Map()
  const blob = buildBlob()
  return {
    models,
    sacredPieces: atlasInfo.sacred,
    civicPieces: atlasInfo.civic,
    packPieces: atlasInfo.pack,

    blob,
    dispose() {
      for (const m of models) m?.geometry.dispose()
      blob.dispose()
    },
  }
}
