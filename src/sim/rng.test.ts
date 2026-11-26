// hash01 (MASTER-PLAN D-dup 10, riots §0.5): counter-based noise in [0, 1), the riots formula exactly, roughly uniform.
import { describe, expect, it } from 'vitest'
import { hash01, mix32, seedToU32 } from './rng.ts'

describe('hash01', () => {
  it('is the riots §0.5 formula, deterministic, in [0, 1)', () => {
    const seed = seedToU32(42)
    for (let r = 0; r < 1000; r++) {
      const x = hash01(seed, r)
      expect(x).toBe(mix32(seed ^ mix32(r + 0x9e3779b9)) / 2 ** 32)
      expect(x).toBe(hash01(seed, r))
      expect(x >= 0 && x < 1).toBe(true)
    }
    expect(hash01(seed, 1)).not.toBe(hash01(seed, 2))
    expect(hash01(seed, 1)).not.toBe(hash01(seedToU32(43), 1))
  })

  it('is roughly uniform (10 bins over 20000 keys within 10% of the mean)', () => {
    const bins = new Array<number>(10).fill(0)
    const seed = seedToU32(1)
    for (let k = 0; k < 20000; k++) bins[Math.floor(hash01(seed ^ (k * 7919), k >> 3) * 10)]++
    for (const b of bins) expect(Math.abs(b - 2000)).toBeLessThan(200)
  })
})
