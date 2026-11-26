// G0, the programme's golden gate (MASTER-PLAN §2.1 R2): `hashBase(h)` is `hashValue` over the projection of a History
// onto the 8cabf09 History, so a plan that adds a field (even an empty one) keeps G0 with its feature off.
//
// - Plain objects keep only their 8cabf09 keys, recursively (nested records such as `wars` and `bonds`, and the elements
//   of object arrays such as `settlements`).
// - A typed array whose type a plan widened is copied back to its 8cabf09 type (e.g. `IdeaAdoptions.idea` Uint16 → Uint8,
//   exact while every id is < 256).
// - `events` are kept as they are: with every new option off, no new event exists.
// - Anything the 8cabf09 shape did not see (an array that was empty in every sampled run, a primitive) is kept as is.
//
// On 8cabf09 the projection is the identity, so hashBase equals hashValue there and G0 is the three perf goldens
// (seed 1 923881e7cd3fe59b, 42 3bac8db3dfd723b5, 1234 2bb9f72e9e99433d at 2000 years, default options).
// The shape (`BASE_SHAPE`) was recorded once on 8cabf09 by `scripts/g0.ts --schema` and is frozen: never regenerate it on a
// later tree (that would fold new fields into the base).
import type { History } from './contract.ts'
import { hashValue } from './historyCache.ts'
import { BASE_SHAPE } from './hashBaseShape.ts'

/** A recorded shape: 0 anything (kept as is), a typed array's constructor name, an object's keys, or an array's element shape. */
export type Shape = 0 | string | { o: Record<string, Shape> } | { a: Shape }

/** The goldens of G0: hashBase of simulateHistory(generateWorld(seed), { years: 2000 }) with every new option false. */
export const G0_GOLDENS: Readonly<Record<number, string>> = { 1: '923881e7cd3fe59b', 42: '3bac8db3dfd723b5', 1234: '2bb9f72e9e99433d' }
export const G0_YEARS = 2000

type TypedCtor = new (src: ArrayLike<number>) => ArrayBufferView
const CTORS: Record<string, TypedCtor> = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array,
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v)
}

/** `v` projected onto `shape` (see the file comment). Never mutates `v`. */
export function project(v: unknown, shape: Shape): unknown {
  if (shape === 0) return v
  if (typeof shape === 'string') {
    if (ArrayBuffer.isView(v) && v.constructor.name !== shape) {
      const C = CTORS[shape]
      if (C) return new C(v as unknown as ArrayLike<number>)
    }
    return v
  }
  if ('a' in shape) return Array.isArray(v) ? v.map((x) => project(x, shape.a)) : v
  if (!isPlain(v)) return v
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(v)) {
    const s = shape.o[k]
    if (s !== undefined) out[k] = project(v[k], s)
  }
  return out
}

/** The History projected onto the 8cabf09 History (events as they are). */
export function projectBase(h: History): unknown {
  return project(h, BASE_SHAPE as Shape)
}

/** G0's hash: hashValue over the 8cabf09 fields of `h`. */
export function hashBase(h: History): string {
  return hashValue(projectBase(h))
}

// ---------- recording the shape (scripts/g0.ts --schema; only ever on 8cabf09) ----------

function mergeShape(a: Shape | undefined, b: Shape | undefined): Shape | undefined {
  if (a === undefined || a === 0) return b ?? a
  if (b === undefined || b === 0) return a
  if (typeof a === 'string' || typeof b === 'string') {
    if (a !== b) throw new Error(`hashBase shape conflict: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
    return a
  }
  if ('o' in a && 'o' in b) {
    const o: Record<string, Shape> = { ...a.o }
    for (const k of Object.keys(b.o)) o[k] = mergeShape(o[k], b.o[k]) ?? 0
    return { o }
  }
  if ('a' in a && 'a' in b) return { a: mergeShape(a.a, b.a) ?? 0 }
  throw new Error('hashBase shape conflict: object vs array')
}

function shapeOfValue(v: unknown): Shape {
  if (v === null || typeof v !== 'object') return 0
  if (ArrayBuffer.isView(v)) return v.constructor.name
  if (Array.isArray(v)) {
    let e: Shape | undefined
    for (const x of v) e = mergeShape(e, shapeOfValue(x))
    return { a: e ?? 0 }
  }
  const o: Record<string, Shape> = {}
  for (const k of Object.keys(v)) o[k] = shapeOfValue((v as Record<string, unknown>)[k])
  return { o }
}

/** The union of the shapes of these Histories, with `events` kept as is. */
export function shapeOf(hs: History[]): Shape {
  let s: Shape | undefined
  for (const h of hs) s = mergeShape(s, shapeOfValue(h))
  if (s === undefined || typeof s !== 'object' || !('o' in s)) throw new Error('hashBase: not a History')
  return { o: { ...s.o, events: 0 } }
}
