// Seeded PRNG (sfc32) plus hashing helpers.
//
// Every subsystem draws from its own stream, derived from (worldSeed, streamName),
// so adding draws to one subsystem never shifts the numbers another one sees.
// Only 32-bit integer ops (Math.imul, shifts) and sqrt are used, so streams
// are bit-identical across JS engines. The whole sim sticks to + - * / sqrt
// (no exp/sin/pow), which IEEE-754 pins down exactly.

/** murmur3 finalizer: good avalanche for a 32-bit integer. */
export function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

/** FNV-1a over the UTF-16 code units of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Fold an arbitrary JS number into a 32-bit seed. Integers up to 2^53 keep
 * both halves; non-integers hash their fractional part too, so 1 and 1.5 differ.
 */
export function seedToU32(seed: number): number {
  if (!Number.isFinite(seed)) seed = 0
  const ip = Math.trunc(seed)
  const lo = ip >>> 0
  const hi = Math.floor(ip / 4294967296) >>> 0
  const frac = seed - ip
  let h = mix32(lo ^ 0x9e3779b9)
  h = mix32(h ^ hi)
  if (frac !== 0) h = mix32(h ^ (Math.floor(frac * 4294967296) >>> 0))
  return h
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform uint32. */
  u32(): number
  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number
  /** Uniform integer in [lo, hi] (inclusive). */
  int(lo: number, hi: number): number
  /** Uniform random unit vector written into out[0..2]. */
  unitVector(out: Float64Array | number[]): void
  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(arr: T[]): void
}

/** sfc32 generator with a 4-word state. */
export function sfc32(a: number, b: number, c: number, d: number): Rng {
  a >>>= 0
  b >>>= 0
  c >>>= 0
  d >>>= 0
  const u32 = (): number => {
    let t = (a + b) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) | 0
    t = (t + d) | 0
    c = (c + t) | 0
    return t >>> 0
  }
  // Warm up so nearby seeds decorrelate.
  for (let i = 0; i < 15; i++) u32()

  const next = (): number => u32() / 4294967296
  const rng: Rng = {
    next,
    u32,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    unitVector: (out) => {
      // Rejection sampling in the cube: no trig, so engine-independent.
      for (;;) {
        const x = next() * 2 - 1
        const y = next() * 2 - 1
        const z = next() * 2 - 1
        const r2 = x * x + y * y + z * z
        if (r2 > 1e-6 && r2 <= 1) {
          const inv = 1 / Math.sqrt(r2)
          out[0] = x * inv
          out[1] = y * inv
          out[2] = z * inv
          return
        }
      }
    },
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const t = arr[i]
        arr[i] = arr[j]
        arr[j] = t
      }
    },
  }
  return rng
}

/** Independent stream for one subsystem of one world. */
export function createRng(worldSeed: number, stream: string): Rng {
  const s = seedToU32(worldSeed)
  const k = hashString(stream)
  return sfc32(mix32(s ^ k), mix32(s + 0x6d2b79f5), mix32(k + 0x1b873593), mix32(s ^ (k >>> 1) ^ 0xcc9e2d51))
}
