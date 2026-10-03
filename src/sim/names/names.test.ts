import { describe, expect, it } from 'vitest'
import { generateWorld } from '../index.ts'
import { runHistory } from '../history/index.ts'
import type { World } from '../../contract.ts'
import { nameSettlements } from './index.ts'
import type { SettlementLike } from './index.ts'

const SEEDS = [1, 2, 3, 42, 1337, 2024, 31337, 77, 99999, 123456]

const worlds = new Map<number, World>()
function world(seed: number): World {
  let w = worlds.get(seed)
  if (!w) { w = generateWorld(seed); worlds.set(seed, w) }
  return w
}
const tables = new Map<number, SettlementLike[]>()
function table(seed: number): SettlementLike[] {
  let t = tables.get(seed)
  if (!t) { t = runHistory(world(seed)).history.settlements; tables.set(seed, t) }
  return t
}

/** Digraph-aware consonant run check, matching the generator's own definition. */
const DIGRAPHS = ['ng', 'sh', 'th', 'ch']
function maxConsonantRun(name: string): number {
  const s = name.toLowerCase()
  let i = 0
  let run = 0
  let best = 0
  while (i < s.length) {
    const two = s.slice(i, i + 2)
    if (DIGRAPHS.indexOf(two) >= 0) { run++; i += 2; best = Math.max(best, run); continue }
    const c = s[i]
    if (c === "'" || c === '-' || c === ' ') { run = 0; i++; continue }
    if ('aeiou'.indexOf(c) >= 0) run = 0
    else { run++; best = Math.max(best, run) }
    i++
  }
  return best
}

describe('nameSettlements', () => {
  it('is deterministic: same world and table give the same names; a different seed differs', () => {
    const t = table(42)
    const a = nameSettlements(world(42), t)
    const b = nameSettlements(world(42), t)
    expect(b).toEqual(a)
    // Re-deriving the world object (same seed) must not change anything either.
    const c = nameSettlements(generateWorld(42), table(42))
    expect(c).toEqual(a)
    const other = nameSettlements(world(1), table(1))
    expect(other.slice(0, 20)).not.toEqual(a.slice(0, 20))
  })

  it('names are unique within a world, across many seeds', () => {
    for (const seed of SEEDS) {
      const names = nameSettlements(world(seed), table(seed))
      const seen = new Set<string>()
      for (const n of names) {
        const key = n.toLowerCase()
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
  }, 30_000)

  it('stays within character set and length bounds', () => {
    for (const seed of SEEDS) {
      const names = nameSettlements(world(seed), table(seed))
      for (const n of names) {
        expect(n).toMatch(/^[A-Za-z][A-Za-z'-]*(?: [A-Za-z][A-Za-z'-]*)?$/)
        const letters = n.replace(/[^A-Za-z]/g, '')
        expect(letters.length).toBeGreaterThanOrEqual(3)
        expect(letters.length).toBeLessThanOrEqual(12)
        // Capitalised: first letter of the name, and of a second word, are uppercase.
        expect(n[0]).toBe(n[0].toUpperCase())
        const sp = n.indexOf(' ')
        if (sp >= 0) expect(n[sp + 1]).toBe(n[sp + 1].toUpperCase())
      }
    }
  })

  it('is pronounceable by rule: no 3+ consonant runs (phoneme-aware), no 3+ identical letters', () => {
    for (const seed of SEEDS) {
      const names = nameSettlements(world(seed), table(seed))
      for (const n of names) {
        expect(maxConsonantRun(n)).toBeLessThan(3)
        expect(n).not.toMatch(/(.)\1\1/)
      }
    }
  })

  it('naming a prefix of the settlement table matches the corresponding prefix of the full table', () => {
    for (const seed of [42, 1337]) {
      const full = table(seed)
      const names = nameSettlements(world(seed), full)
      const k = Math.floor(full.length / 3)
      const prefixNames = nameSettlements(world(seed), full.slice(0, k))
      expect(prefixNames).toEqual(names.slice(0, k))
    }
  })

  it('names in a lineage share phonological flavor more than across unrelated tribes', () => {
    const seed = 42
    const settlements = table(seed)
    const names = nameSettlements(world(seed), settlements)
    const tribeOf = new Int32Array(settlements.length)
    for (let id = 0; id < settlements.length; id++) {
      const p = settlements[id].parent
      tribeOf[id] = p < 0 ? id : tribeOf[p]
    }
    const tribes = [...new Set(Array.from(tribeOf))]
    expect(tribes.length).toBeGreaterThanOrEqual(3)
    // A rough phonological fingerprint: which letters appear anywhere in a tribe's names.
    const letterSet = (ids: number[]): Set<string> => {
      const s = new Set<string>()
      for (const id of ids) for (const ch of names[id].toLowerCase()) if (/[a-z]/.test(ch)) s.add(ch)
      return s
    }
    const jaccard = (a: Set<string>, b: Set<string>): number => {
      let inter = 0
      for (const x of a) if (b.has(x)) inter++
      return inter / (a.size + b.size - inter)
    }
    const idsByTribe = tribes.map((t) => {
      const ids: number[] = []
      for (let id = 0; id < settlements.length; id++) if (tribeOf[id] === t) ids.push(id)
      return ids
    })
    // Within-tribe similarity (first half vs second half of the same tribe's names) should
    // usually be at least as high as similarity to a different, unrelated tribe.
    let atLeastAsSimilar = 0
    for (let i = 0; i < idsByTribe.length; i++) {
      const ids = idsByTribe[i]
      if (ids.length < 6) continue
      const half = Math.floor(ids.length / 2)
      const within = jaccard(letterSet(ids.slice(0, half)), letterSet(ids.slice(half)))
      const other = idsByTribe[(i + 1) % idsByTribe.length]
      const across = jaccard(letterSet(ids.slice(0, half)), letterSet(other))
      if (within >= across - 0.15) atLeastAsSimilar++
    }
    expect(atLeastAsSimilar).toBeGreaterThan(0)
  })

  it('is fast: naming ~1500 settlements takes a few milliseconds', () => {
    const seed = 42
    const w = world(seed)
    const base = table(seed)
    // Pad out to ~1500 settlements by chaining synthetic children, to exercise a larger table.
    const padded: SettlementLike[] = base.slice()
    let i = 0
    while (padded.length < 1500) {
      const src = base[i % base.length]
      padded.push({ id: padded.length, cell: src.cell, parent: Math.min(src.id, padded.length - 1), foundedYear: src.foundedYear + 1 })
      i++
    }
    const t0 = performance.now()
    nameSettlements(w, padded)
    const t1 = performance.now()
    expect(t1 - t0).toBeLessThan(50)
  })

  it('every settlement in a run gets a name and the wiring round-trips through runHistory', () => {
    for (const seed of [7, 2024]) {
      const h = runHistory(world(seed)).history
      expect(h.settlements.length).toBeGreaterThan(0)
      for (const s of h.settlements) {
        expect(typeof s.name).toBe('string')
        expect(s.name.length).toBeGreaterThan(0)
      }
      const names = h.settlements.map((s) => s.name)
      expect(new Set(names).size).toBe(names.length)
    }
  })
})
