// The model set: CC0 meshes packed into two .glb files (see tools/buildModels.mjs and
// public/models/CREDITS.md) plus a few generated pieces (haystacks, a dam, the soft
// contact shadow). Every geometry carries the same attributes (position, normal and an
// RGBA8 `aColor`: sRGB albedo plus a "team colour" mask in alpha), so one material
// draws them all. Loading is asynchronous and failure-tolerant: until the promise
// resolves (or if it rejects) the diorama layer simply draws nothing.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** Width of a KayKit house on the globe (world units; the planet radius is 1, a cell ~0.023). */
export const HOUSE_WIDTH = 0.0031
/** World units per KayKit model unit (a KayKit house is ~0.8 units wide). */
export const KK = HOUSE_WIDTH / 0.8

export const Model = {
  HomeA: 0,
  HomeB: 1,
  Church: 2,
  Market: 3,
  Tavern: 4,
  Well: 5,
  Blacksmith: 6,
  Windmill: 7,
  Watermill: 8,
  Castle: 9,
  Tower: 10,
  Barracks: 11,
  Lumbermill: 12,
  Trees: 13,
  Ship: 14,
  ShipMedium: 15,
  Dock: 16,
  Cart: 17,
  Haystack: 18,
  Dam: 19,
} as const
export type Model = (typeof Model)[keyof typeof Model]
export const MODEL_COUNT = 20

interface ModelSpec {
  /** Mesh name in the .glb, or null for generated geometry. */
  name: string | null
  /** World units per model unit. */
  scale: number
  /** Lit windows on the night side. */
  lit: boolean
}

const S = (name: string | null, scale: number, lit = false): ModelSpec => ({ name, scale, lit })

/** Per model: source mesh, scale on the globe, night windows. Kenney models are rescaled to sit with the KayKit ones. */
export const MODEL_SPECS: readonly ModelSpec[] = [
  S('home_A', KK, true),
  S('home_B', KK, true),
  S('church', KK, true),
  S('market', KK * 0.9, true),
  S('tavern', KK * 0.9, true),
  S('well', KK * 0.8),
  S('blacksmith', KK * 0.9, true),
  S('windmill', KK, true),
  S('watermill', KK, true),
  S('castle', KK * 0.7, true),
  S('tower_A', KK * 0.9, true),
  S('barracks', KK * 0.85, true),
  S('lumbermill', KK * 0.85, true),
  S('trees', KK * 0.8),
  S('ship', KK * 0.2), // ~1.8 KayKit units long: two houses
  S('ship_medium', KK * 0.19),
  S('dock', KK * 0.34),
  S('cart', KK * 0.45),
  S(null, KK), // haystack
  S(null, KK), // dam (x is scaled to the river per instance)
]

export interface ModelEntry {
  geometry: THREE.BufferGeometry
  /** Bounding box size in model units. */
  size: THREE.Vector3
  /** Footprint radius on the globe (world units). */
  footprint: number
  /** Height on the globe (world units). */
  height: number
}

export interface ModelLibrary {
  models: (ModelEntry | null)[]
  blob: THREE.BufferGeometry
  dispose(): void
}

const BASE = import.meta.env?.BASE_URL ?? '/'
const FILES = [`${BASE}models/kaykit/kaykit-medieval.glb`, `${BASE}models/kenney/kenney-ships.glb`]

let pending: Promise<ModelLibrary> | null = null

/** Starts loading (once) and resolves with the library; rejects if nothing usable loaded. */
export function loadModels(): Promise<ModelLibrary> {
  if (!pending) pending = load()
  return pending
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
  if (byName.size === 0) throw new Error('no diorama models loaded')
  const generated: Partial<Record<Model, THREE.BufferGeometry>> = {
    [Model.Haystack]: buildHaystacks(),
    [Model.Dam]: buildDam(),
  }
  const models: (ModelEntry | null)[] = MODEL_SPECS.map((spec, id) => {
    const g = spec.name ? byName.get(spec.name) : generated[id as Model]
    if (!g) return null
    g.computeBoundingBox()
    const size = new THREE.Vector3()
    g.boundingBox!.getSize(size)
    return { geometry: g, size, footprint: 0.5 * Math.max(size.x, size.z) * spec.scale, height: size.y * spec.scale }
  })
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

// ---------- generated geometry ----------

class Builder {
  pos: number[] = []
  col: number[] = []
  tri(a: number[], b: number[], c: number[], rgb: number[]) {
    this.pos.push(...a, ...b, ...c)
    for (let i = 0; i < 3; i++) this.col.push(rgb[0], rgb[1], rgb[2], 0)
  }
  quad(a: number[], b: number[], c: number[], d: number[], rgb: number[]) {
    this.tri(a, b, c, rgb)
    this.tri(a, c, d, rgb)
  }
  /** Frustum of a cone around the y axis (r0 at y0, r1 at y1), with caps. */
  frustum(cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, seg: number, side: number[], cap: number[]) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2
      const p = (r: number, a: number, y: number) => [cx + r * Math.cos(a), y, cz + r * Math.sin(a)]
      if (r1 > 0) this.quad(p(r0, a0, y0), p(r1, a0, y1), p(r1, a1, y1), p(r0, a1, y0), side)
      else this.tri(p(r0, a0, y0), [cx, y1, cz], p(r0, a1, y0), side)
      if (r1 > 0) this.tri([cx, y1, cz], p(r1, a1, y1), p(r1, a0, y1), cap)
    }
  }
  /** Axis-aligned box. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, rgb: number[], top = rgb) {
    const v = (x: number, y: number, z: number) => [x, y, z]
    this.quad(v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0), top)
    this.quad(v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1), rgb)
    this.quad(v(x1, y0, z0), v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), rgb)
    this.quad(v(x1, y0, z1), v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), rgb)
    this.quad(v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0), rgb)
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(new Uint8Array(this.col), 4, true))
    g.computeVertexNormals() // non-indexed: flat facets, the low-poly look of the packs
    return g
  }
}

/** Three haystacks: a squat drum under a rounded cone each. */
function buildHaystacks(): THREE.BufferGeometry {
  const b = new Builder()
  const hay = [214, 172, 84], hayTop = [196, 150, 66], dark = [168, 128, 58]
  const stacks: [number, number, number][] = [[0, 0, 1], [0.27, 0.12, 0.8], [-0.12, 0.26, 0.7]]
  for (const [x, z, s] of stacks) {
    b.frustum(x, z, 0, 0.13 * s, 0.13 * s, 0.135 * s, 9, hay, hayTop)
    b.frustum(x, z, 0.13 * s, 0.2 * s, 0.135 * s, 0.1 * s, 9, hayTop, hayTop)
    b.frustum(x, z, 0.2 * s, 0.29 * s, 0.1 * s, 0, 9, dark, dark)
  }
  return b.build()
}

/**
 * A gently curved concrete dam, 1 unit wide along x (scaled per instance to the river),
 * bowed upstream (-z; +z is downstream), with a darker spillway face.
 */
function buildDam(): THREE.BufferGeometry {
  const b = new Builder()
  const concrete = [186, 180, 168], top = [206, 201, 190], face = [140, 136, 128], spill = [120, 160, 175]
  const seg = 8
  const H = 0.5, T = 0.14, bow = 0.14
  const zAt = (x: number) => -bow * (1 - 4 * x * x)
  for (let i = 0; i < seg; i++) {
    const xa = -0.5 + i / seg, xb = -0.5 + (i + 1) / seg
    const za = zAt(xa), zb = zAt(xb)
    const mid = i === seg / 2 - 1 || i === seg / 2
    // upstream face, top, downstream face (sloped buttress)
    b.quad([xa, -0.05, za - T * 0.5], [xa, H, za - T * 0.5], [xb, H, zb - T * 0.5], [xb, -0.05, zb - T * 0.5], concrete)
    b.quad([xa, H, za - T * 0.5], [xa, H, za + T * 0.5], [xb, H, zb + T * 0.5], [xb, H, zb - T * 0.5], top)
    b.quad([xb, -0.05, zb + T * 1.6], [xb, H, zb + T * 0.5], [xa, H, za + T * 0.5], [xa, -0.05, za + T * 1.6], mid ? spill : face)
  }
  // abutments
  b.box(-0.62, -0.05, -0.12, -0.48, H + 0.05, 0.22, concrete, top)
  b.box(0.48, -0.05, -0.12, 0.62, H + 0.05, 0.22, concrete, top)
  return b.build()
}

/** Unit disk in the xz plane; alpha 1 at the centre falling to 0 at the rim. */
function buildBlob(): THREE.BufferGeometry {
  const seg = 20
  const pos = [0, 0, 0]
  const col = [0, 0, 0, 255]
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2
    for (const [r, alpha] of [[0.55, 170], [1, 0]] as const) {
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r)
      col.push(0, 0, 0, alpha)
    }
  }
  const index: number[] = []
  for (let i = 0; i < seg; i++) {
    const a = 1 + i * 2, b = 1 + (i + 1) * 2
    index.push(0, b, a) // inner fan (CCW seen from +y)
    index.push(a, b, b + 1, a, b + 1, a + 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  g.setAttribute('aColor', new THREE.BufferAttribute(new Uint8Array(col), 4, true))
  g.setIndex(index)
  return g
}
