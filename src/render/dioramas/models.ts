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
import {
  buildBlob, buildBoat, buildDam, buildHaystacks, buildStalls, buildTownBridge, buildWallSegment, buildWallTower, buildWell, FLORA_COUNT, floraGeometry,
  KIND_COUNT, STYLE_COUNT, styleGeometry, type Flora, type Kind, type Style,
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
} as const
export type Model = (typeof Model)[keyof typeof Model]
const FLORA_BASE = 24
const STYLE_BASE = FLORA_BASE + FLORA_COUNT
export const MODEL_COUNT = STYLE_BASE + STYLE_COUNT * KIND_COUNT

/** Model of a generated grove. */
export const floraModel = (f: Flora) => FLORA_BASE + f
/** Model of a generated building of a style. */
export const styleModel = (s: Style, k: Kind) => STYLE_BASE + s * KIND_COUNT + k
export const isStyleModel = (m: number) => m >= STYLE_BASE
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

export interface ModelLibrary {
  models: (ModelEntry | null)[]
  blob: THREE.BufferGeometry
  dispose(): void
}

const BASE = import.meta.env?.BASE_URL ?? '/'
const FILES = [`${BASE}models/kaykit/kaykit-medieval.glb`, `${BASE}models/kenney/kenney-ships.glb`]

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
  }
  if (id >= STYLE_BASE) {
    const k = id - STYLE_BASE
    return styleGeometry(Math.floor(k / KIND_COUNT) as Style, (k % KIND_COUNT) as Kind)
  }
  if (id >= FLORA_BASE) return floraGeometry((id - FLORA_BASE) as Flora)
  return null
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
  const blob = buildBlob()
  return {
    models,
    blob,
    dispose() {
      for (const m of models) m?.geometry.dispose()
      blob.dispose()
    },
  }
}
