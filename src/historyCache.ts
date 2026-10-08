// Cache of generated worlds and simulated histories in IndexedDB, used by the worker only
// (it reads, writes and transfers; the main thread never serialises a history for it).
//
// Key: the simulation's code version (vite.config.ts: a hash of src/sim/**, src/contract.ts,
// src/worker.ts and this file; null, i.e. no cache, when it cannot be known), the seed, the
// world options, the history options other than `years`, and `years`. A history is stored at
// exactly the length it was simulated to (the initial run and every extension); it is never
// sliced, because a resumable run cannot be persisted (it is live simulation state).
//
// Format: the value as structured clone stores it, except that every typed array of 4 KB or
// more is gzipped (CompressionStream; about 13x smaller: a 2000-year history is ~31 MB raw,
// ~2.4 MB stored). Budget: the most recent MAX_ENTRIES entries within MAX_BYTES (stored size),
// or within a third of the origin's storage quota where that is smaller (a phone's, a private
// window's); entries of other code versions are deleted. A write the quota refuses halves the
// budget, makes room and is tried once more.
//
// Everything is best effort: no IndexedDB (private modes, blocked storage), quota errors or a
// corrupt entry make a lookup miss and a write a no-op, so the app works the same without it.

const DB_NAME = 'worldseed-cache'
const DB_VERSION = 1
const DATA = 'data'
const META = 'meta'
/** Most entries (worlds and histories) kept, and the most stored bytes. */
const MAX_ENTRIES = 24
const MAX_BYTES = 200e6
/** Typed arrays at least this large are compressed. */
const COMPRESS_MIN_BYTES = 4096

declare const __WORLDSEED_SIM_VERSION__: string | undefined

interface Meta {
  key: string
  /** History group (version, seed, options) for histories; '' for worlds. */
  group: string
  years: number
  version: string
  bytes: number
  used: number
}

/** A compressed typed array. */
interface Packed {
  __wsz: 1
  type: string
  length: number
  data: Uint8Array
}

export interface CacheKeys {
  world: string
  group: string
  history(years: number): string
}

export interface HistoryCache {
  readonly version: string
  getWorld<T>(key: string): Promise<T | null>
  /** The cached history of `group` that is `years` long, else the longest shorter one (null: none). */
  getHistory<T>(keys: CacheKeys, years: number): Promise<{ years: number; value: T } | null>
  /** Store `value`, which the cache then owns (pass a snapshot(), see below); resolves to whether it was written. */
  put(key: string, group: string, years: number, value: unknown): Promise<boolean>
}

/** The simulation's code version, or null when unknown (then nothing is cached). */
async function codeVersion(): Promise<string | null> {
  if (typeof __WORLDSEED_SIM_VERSION__ === 'string') return __WORLDSEED_SIM_VERSION__
  if (!import.meta.env.DEV) return null
  try {
    const res = await fetch(new URL('/__worldseed/sim-version', self.location.origin), { cache: 'no-store' })
    const text = res.ok ? (await res.text()).trim() : ''
    return /^dev-[0-9a-f]+$/.test(text) ? text : null
  } catch {
    return null
  }
}

/** JSON with sorted keys (so equal options give equal keys). */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
}

export function cacheKeys(version: string, seed: number, worldOptions: object | undefined, historyOptions: object | undefined): CacheKeys {
  const w = `${version}|${seed}|${stable(worldOptions ?? {})}`
  const { years: _years, ...rest } = (historyOptions ?? {}) as { years?: number }
  const group = `${w}|${stable(rest)}`
  return { world: `w|${w}`, group, history: (years) => `h|${group}|${years}` }
}

/** `p`, or `fallback` if it takes longer than `ms` (a storage that never answers must not hold up the page). */
const within = <T>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))])

const req = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  r.onsuccess = () => resolve(r.result)
  r.onerror = () => reject(r.error)
})
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve()
  tx.onerror = () => reject(tx.error)
  tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
})

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const r = indexedDB.open(DB_NAME, DB_VERSION)
      r.onupgradeneeded = () => {
        const db = r.result
        if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA)
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' })
      }
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => resolve(null)
      r.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

// ---------- typed-array packing ----------

const isView = (v: unknown): v is ArrayBufferView & { length: number } => ArrayBuffer.isView(v) && !(v instanceof DataView)

/**
 * A copy of `value` that owns its typed arrays (each sliced), sharing everything else. Call it
 * before the original's arrays are transferred away; the copy can then be packed and stored.
 */
export function snapshot<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v
    if (isView(v)) return (v as unknown as { slice(): unknown }).slice()
    if (Array.isArray(v)) {
      let out: unknown[] | null = null
      for (let i = 0; i < v.length; i++) {
        const x = v[i]
        if (x === null || typeof x !== 'object') continue
        const y = walk(x)
        if (y !== x) (out ??= v.slice())[i] = y
      }
      return out ?? v
    }
    let out: Record<string, unknown> | null = null
    for (const k in v as Record<string, unknown>) {
      const x = (v as Record<string, unknown>)[k]
      if (x === null || typeof x !== 'object') continue
      const y = walk(x)
      if (y !== x) (out ??= { ...(v as Record<string, unknown>) })[k] = y
    }
    return out ?? v
  }
  return walk(value) as T
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = await new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream)).arrayBuffer()
  return new Uint8Array(out)
}

/** Replace large typed arrays by gzipped copies (structure otherwise shared); also returns the stored size. */
async function pack(value: unknown): Promise<{ packed: unknown; bytes: number }> {
  let bytes = 0
  const jobs: Promise<void>[] = []
  const canCompress = typeof CompressionStream === 'function'
  const walk = (v: unknown, set: (x: unknown) => void) => {
    if (v === null || typeof v !== 'object') return
    if (isView(v)) {
      if (!canCompress || v.byteLength < COMPRESS_MIN_BYTES) {
        bytes += v.byteLength
        return
      }
      const raw = new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
      jobs.push(pipe(raw, new CompressionStream('gzip')).then((data) => {
        bytes += data.byteLength
        set({ __wsz: 1, type: v.constructor.name, length: v.length, data } satisfies Packed)
      }))
      return
    }
    if (Array.isArray(v)) {
      bytes += 8 * v.length
      for (let i = 0; i < v.length; i++) walk(v[i], (x) => (v[i] = x))
      return
    }
    const o = v as Record<string, unknown>
    for (const k in o) {
      bytes += 16
      walk(o[k], (x) => (o[k] = x))
    }
  }
  // (packs in place: the caller's value is a snapshot() of its own, or a world kept nowhere else)
  const root = { v: value }
  walk(root, () => {})
  await Promise.all(jobs)
  return { packed: root.v, bytes }
}

const CTORS: Record<string, new (b: ArrayBuffer) => ArrayBufferView> = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array,
}

async function unpack<T>(value: unknown): Promise<T> {
  const jobs: Promise<void>[] = []
  const walk = (v: unknown, set: (x: unknown) => void) => {
    if (v === null || typeof v !== 'object' || isView(v)) return
    const p = v as Packed
    if (p.__wsz === 1) {
      const C = CTORS[p.type]
      if (!C) throw new Error(`history cache: unknown array type ${p.type}`)
      jobs.push(pipe(p.data, new DecompressionStream('gzip')).then((raw) => {
        const a = new C(raw.buffer as ArrayBuffer)
        if ((a as unknown as { length: number }).length !== p.length) throw new Error('history cache: bad array length')
        set(a)
      }))
      return
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) walk(v[i], (x) => (v[i] = x))
      return
    }
    const o = v as Record<string, unknown>
    for (const k in o) walk(o[k], (x) => (o[k] = x))
  }
  const root = { v: value }
  walk(root, () => {})
  await Promise.all(jobs)
  return root.v as T
}

/** Every distinct ArrayBuffer under `value` (for a transfer list). */
export function buffersOf(value: unknown): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>()
  const walk = (v: unknown) => {
    if (v === null || typeof v !== 'object') return
    if (ArrayBuffer.isView(v)) {
      if (v.buffer instanceof ArrayBuffer && v.buffer.byteLength > 0) out.add(v.buffer)
      return
    }
    if (Array.isArray(v)) {
      for (const x of v) if (x !== null && typeof x === 'object') walk(x)
      return
    }
    for (const k in v as Record<string, unknown>) walk((v as Record<string, unknown>)[k])
  }
  walk(value)
  return [...out]
}

// ---------- the cache ----------

/** Open the cache (null: none available, or the code version is unknown). Never throws. */
export async function openHistoryCache(): Promise<HistoryCache | null> {
  try {
    const [version, db] = await within(Promise.all([codeVersion(), openDb()]), 3000, [null, null])
    if (!version || !db) {
      db?.close()
      return null
    }
    return makeCache(db, version, await within(quotaBudget(), 1000, MAX_BYTES))
  } catch {
    return null
  }
}

/** The byte budget: MAX_BYTES, or a third of the origin's quota where the browser tells it and it is smaller. */
async function quotaBudget(): Promise<number> {
  try {
    const est = await navigator.storage?.estimate?.()
    const quota = est?.quota ?? 0
    return quota > 0 ? Math.min(MAX_BYTES, quota / 3) : MAX_BYTES
  } catch {
    return MAX_BYTES
  }
}

const isQuotaError = (err: unknown) => err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')

function makeCache(db: IDBDatabase, version: string, initialBudget: number): HistoryCache {
  /** Stored bytes allowed (shrinks when the quota refuses a write). */
  let budget = initialBudget
  /** Bump an entry's last use (best effort, not awaited by readers). */
  const touch = (key: string) => {
    try {
      const tx = db.transaction(META, 'readwrite')
      const store = tx.objectStore(META)
      const r = store.get(key)
      r.onsuccess = () => {
        const m = r.result as Meta | undefined
        if (m) store.put({ ...m, used: Date.now() })
      }
    } catch {
      /* ignore */
    }
  }

  async function read<T>(key: string): Promise<T | null> {
    const tx = db.transaction(DATA, 'readonly')
    const v = await req(tx.objectStore(DATA).get(key))
    if (v === undefined) return null
    const out = await unpack<T>(v)
    touch(key)
    return out
  }

  /** Delete entries of other code versions and the least recently used beyond the budget. */
  async function evict() {
    const tx = db.transaction([META, DATA], 'readwrite')
    const meta = tx.objectStore(META)
    const data = tx.objectStore(DATA)
    const all = (await req(meta.getAll())) as Meta[]
    all.sort((a, b) => b.used - a.used)
    let n = 0
    let bytes = 0
    for (const m of all) {
      const keep = m.version === version && n < MAX_ENTRIES && bytes + m.bytes <= budget
      if (keep) {
        n++
        bytes += m.bytes
      } else {
        meta.delete(m.key)
        data.delete(m.key)
      }
    }
    await done(tx)
  }

  return {
    version,
    async getWorld<T>(key: string) {
      try {
        return await within(read<T>(key), 5000, null)
      } catch {
        return null
      }
    },
    async getHistory<T>(keys: CacheKeys, years: number) {
      try {
        const tx = db.transaction(META, 'readonly')
        const metas = (await req(tx.objectStore(META).getAll(IDBKeyRange.bound(`h|${keys.group}|`, `h|${keys.group}|￿`)))) as Meta[]
        let best: Meta | null = null
        for (const m of metas) if (m.group === keys.group && m.years <= years && (!best || m.years > best.years)) best = m
        if (!best) return null
        const value = await within(read<T>(best.key), 10000, null)
        return value ? { years: best.years, value } : null
      } catch {
        return null
      }
    },
    async put(key: string, group: string, years: number, value: unknown) {
      try {
        const { packed, bytes } = await pack(value)
        if (bytes > budget) return false
        const write = async () => {
          const tx = db.transaction([META, DATA], 'readwrite')
          tx.objectStore(DATA).put(packed, key)
          tx.objectStore(META).put({ key, group, years, version, bytes, used: Date.now() } satisfies Meta)
          await done(tx)
        }
        try {
          await write()
        } catch (err) {
          if (!isQuotaError(err)) throw err
          // the quota is smaller than the budget assumed: halve it, make room, once more
          budget = Math.max(bytes, budget / 2)
          await evict()
          await write()
        }
        await evict()
        return true
      } catch (err) {
        // quota exceeded or storage gone: drop this entry, and make room for the next
        console.info('history cache: not stored:', err instanceof Error ? `${err.name} ${err.message}` : String(err))
        try {
          await evict()
        } catch {
          /* ignore */
        }
        return false
      }
    },
  }
}

// ---------- verification (cachecheck=1) ----------

/** A hash of every field of `value` (typed arrays by type and bytes; objects by sorted keys). */
export function hashValue(value: unknown): string {
  let h1 = 0x811c9dc5 | 0
  let h2 = 0x1b873593 | 0
  const mix = (x: number) => {
    h1 = Math.imul(h1 ^ x, 0x01000193)
    h2 = Math.imul(h2 ^ x, 0x5bd1e995) ^ (h2 >>> 13)
  }
  const str = (s: string) => {
    mix(s.length)
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i))
  }
  const f64 = new Float64Array(1)
  const i32 = new Int32Array(f64.buffer)
  const walk = (v: unknown) => {
    if (v === null) return mix(1)
    switch (typeof v) {
      case 'undefined': return mix(2)
      case 'boolean': return mix(v ? 3 : 4)
      case 'number':
        f64[0] = v
        mix(5)
        mix(i32[0])
        return mix(i32[1])
      case 'string':
        mix(6)
        return str(v)
      case 'object':
        break
      default:
        mix(7)
        return str(String(v))
    }
    if (ArrayBuffer.isView(v)) {
      str(v.constructor.name)
      const n = v.byteLength
      mix(n)
      const b = new Uint8Array(v.buffer, v.byteOffset, n)
      const words = n >> 2
      const w = (v.byteOffset & 3) === 0 ? new Int32Array(v.buffer, v.byteOffset, words) : null
      if (w) for (let i = 0; i < words; i++) mix(w[i])
      for (let i = w ? words * 4 : 0; i < n; i++) mix(b[i])
      return
    }
    if (Array.isArray(v)) {
      mix(8)
      mix(v.length)
      for (const x of v) walk(x)
      return
    }
    mix(9)
    const o = v as Record<string, unknown>
    for (const k of Object.keys(o).sort()) {
      str(k)
      walk(o[k])
    }
  }
  walk(value)
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}
