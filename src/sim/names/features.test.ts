import { describe, expect, it } from 'vitest'
import { Biome, FeatureKind, RIVER_FLOW_THRESHOLD } from '../../contract.ts'
import type { GeoFeature, World } from '../../contract.ts'
import { generateWorld } from '../index.ts'
import { runHistory } from '../history/index.ts'
import { detectFeatures, featuresAt } from './features.ts'
import { nameFeatures } from './featureNames.ts'
import type { NamedSettlementLike } from './featureNames.ts'
import { isEuphonic } from './words.ts'

const SEEDS = [1, 2, 3, 42, 1337, 2024, 31337, 77, 99999, 12345]
/** Seeds that also get a full history run (slower). */
const HISTORY_SEEDS = [42, 12345, 3, 2024]

const worlds = new Map<number, World>()
function world(seed: number): World {
  let w = worlds.get(seed)
  if (!w) { w = generateWorld(seed); worlds.set(seed, w) }
  return w
}
const tables = new Map<number, NamedSettlementLike[]>()
const featureLists = new Map<number, GeoFeature[]>()
function table(seed: number): NamedSettlementLike[] {
  let t = tables.get(seed)
  if (!t) {
    const h = runHistory(world(seed)).history
    t = h.settlements
    tables.set(seed, t)
    featureLists.set(seed, h.features)
  }
  return t
}
function features(seed: number): GeoFeature[] {
  table(seed)
  return featureLists.get(seed)!
}

const KIND_NAMES = ['continent', 'island', 'ocean', 'sea', 'lake', 'river', 'range', 'desert', 'forest']
const LAND_KINDS: number[] = [FeatureKind.Continent, FeatureKind.Island, FeatureKind.MountainRange, FeatureKind.Desert, FeatureKind.Forest, FeatureKind.River, FeatureKind.Lake]

describe('detectFeatures', () => {
  it('is deterministic', () => {
    const a = detectFeatures(world(42))
    const b = detectFeatures(generateWorld(42))
    expect(b.features).toEqual(a.features)
    expect(Array.from(b.water)).toEqual(Array.from(a.water))
  })

  it('finds a readable number of each kind of feature', () => {
    for (const seed of SEEDS) {
      const m = detectFeatures(world(seed))
      const count = new Array<number>(9).fill(0)
      for (const f of m.features) count[f.kind]++
      const msg = `seed ${seed}: ${count.map((c, k) => `${KIND_NAMES[k]} ${c}`).join(', ')}`
      expect(count[FeatureKind.Continent], msg).toBeGreaterThanOrEqual(1)
      expect(count[FeatureKind.Continent] + count[FeatureKind.Island], msg).toBeGreaterThanOrEqual(3)
      expect(count[FeatureKind.Continent] + count[FeatureKind.Island], msg).toBeLessThanOrEqual(16)
      expect(count[FeatureKind.Ocean], msg).toBeGreaterThanOrEqual(2)
      expect(count[FeatureKind.Ocean], msg).toBeLessThanOrEqual(6)
      expect(count[FeatureKind.Sea], msg).toBeGreaterThanOrEqual(4)
      expect(count[FeatureKind.Sea], msg).toBeLessThanOrEqual(15)
      expect(count[FeatureKind.River], msg).toBeGreaterThanOrEqual(12)
      expect(count[FeatureKind.River], msg).toBeLessThanOrEqual(40)
      expect(count[FeatureKind.MountainRange], msg).toBeGreaterThanOrEqual(3)
      expect(count[FeatureKind.MountainRange], msg).toBeLessThanOrEqual(15)
      expect(count[FeatureKind.Desert] + count[FeatureKind.Forest], msg).toBeGreaterThanOrEqual(2)
      expect(count[FeatureKind.Desert], msg).toBeLessThanOrEqual(5)
      expect(count[FeatureKind.Forest], msg).toBeLessThanOrEqual(6)
      expect(count[FeatureKind.Lake], msg).toBeLessThanOrEqual(12)
    }
  }, 60_000)

  it('anchors and spines are valid cells of the right type', () => {
    for (const seed of SEEDS) {
      const w = world(seed)
      const m = detectFeatures(w)
      const N = w.grid.cellCount
      const { neighborOffsets: off, neighbors: nb } = w.grid
      const adjacent = (a: number, b: number) => {
        for (let k = off[a]; k < off[a + 1]; k++) if (nb[k] === b) return true
        return false
      }
      m.features.forEach((f, i) => {
        const where = `seed ${seed} feature ${i} (${KIND_NAMES[f.kind]})`
        expect(f.anchorCell >= 0 && f.anchorCell < N, where).toBe(true)
        expect(f.size, where).toBeGreaterThan(0)
        for (const c of f.spine) expect(c >= 0 && c < N, where).toBe(true)
        const a = f.anchorCell
        if (LAND_KINDS.indexOf(f.kind) >= 0) expect(w.elevation[a], where).toBeGreaterThanOrEqual(0)
        switch (f.kind) {
          case FeatureKind.Continent:
          case FeatureKind.Island:
            expect(m.land[a], where).toBe(i)
            expect(f.spine.length).toBe(0)
            break
          case FeatureKind.Ocean:
          case FeatureKind.Sea:
            expect(w.elevation[a], where).toBeLessThan(0)
            expect(m.water[a], where).toBe(i)
            break
          case FeatureKind.Lake:
            expect(w.lake[a], where).toBe(1)
            expect(m.lake[a], where).toBe(i)
            break
          case FeatureKind.River:
            expect(f.spine.length, where).toBe(f.size)
            expect(f.spine.indexOf(a), where).toBeGreaterThanOrEqual(0)
            for (let k = 0; k < f.spine.length; k++) {
              const c = f.spine[k]
              expect(w.elevation[c], where).toBeGreaterThanOrEqual(0)
              expect(w.flow[c], where).toBeGreaterThanOrEqual(RIVER_FLOW_THRESHOLD)
              expect(m.river[c] === i || m.river2[c] === i, where).toBe(true)
              if (k + 1 < f.spine.length) expect(w.riverTo[c], where).toBe(f.spine[k + 1])
            }
            break
          case FeatureKind.MountainRange:
            expect(f.spine.length, where).toBeGreaterThanOrEqual(2)
            expect(f.spine.indexOf(a), where).toBeGreaterThanOrEqual(0)
            for (let k = 0; k < f.spine.length; k++) {
              const c = f.spine[k]
              expect(m.relief[c], where).toBe(i)
              expect(w.elevation[c], where).toBeGreaterThanOrEqual(0.2)
              if (k + 1 < f.spine.length) expect(adjacent(c, f.spine[k + 1]), where).toBe(true)
            }
            break
          case FeatureKind.Desert:
            expect(w.biome[a], where).toBe(Biome.Desert)
            expect(m.cover[a], where).toBe(i)
            break
          case FeatureKind.Forest:
            expect([Biome.TemperateForest, Biome.Taiga, Biome.Rainforest].indexOf(w.biome[a] as 4 | 5 | 9), where).toBeGreaterThanOrEqual(0)
            expect(m.cover[a], where).toBe(i)
            break
        }
      })
      // every water cell of the world ocean belongs to an ocean or sea; per-cell maps point at features of the right kind
      for (let c = 0; c < N; c++) {
        if (m.water[c] >= 0) {
          const k = m.features[m.water[c]].kind
          expect(k === FeatureKind.Ocean || k === FeatureKind.Sea).toBe(true)
          expect(w.elevation[c]).toBeLessThan(0)
        }
        if (m.land[c] >= 0) expect(w.elevation[c]).toBeGreaterThanOrEqual(0)
      }
    }
  }, 60_000)

  it('is fast: a few milliseconds per world', () => {
    const w = world(42)
    detectFeatures(w) // warm up
    const t0 = performance.now()
    for (let i = 0; i < 5; i++) detectFeatures(w)
    expect((performance.now() - t0) / 5).toBeLessThan(150)
  })

  it('featuresAt reports a settlement cell\'s landmass and nearby features once each', () => {
    const w = world(12345)
    const m = detectFeatures(w)
    for (const s of table(12345).slice(0, 200)) {
      const fs = featuresAt(m, w, s.cell)
      expect(new Set(fs).size).toBe(fs.length)
      if (m.land[s.cell] >= 0) expect(fs).toContain(m.land[s.cell])
    }
  })
})

describe('nameFeatures', () => {
  it('is deterministic, and the history carries exactly what it computes', () => {
    for (const seed of [42, 12345]) {
      const a = nameFeatures(world(seed), table(seed))
      const b = nameFeatures(generateWorld(seed), table(seed).map((s) => ({ ...s })))
      expect(b).toEqual(a)
      expect(features(seed)).toEqual(a)
    }
  }, 60_000)

  it('names reached features only, in order, by a settlement founded that year on or beside them', () => {
    for (const seed of HISTORY_SEEDS) {
      const w = world(seed)
      const m = detectFeatures(w)
      const t = table(seed)
      const fs = features(seed)
      expect(fs.length).toBeGreaterThan(10)
      fs.forEach((f, i) => {
        expect(f.id).toBe(i)
        if (i > 0) expect(f.namedYear).toBeGreaterThanOrEqual(fs[i - 1].namedYear)
        const by = t[f.namedBy]
        expect(by.foundedYear).toBe(f.namedYear)
        const d = m.features.findIndex((x) => x.kind === f.kind && x.anchorCell === f.anchorCell)
        expect(d).toBeGreaterThanOrEqual(0)
        expect(featuresAt(m, w, by.cell)).toContain(d)
        // nobody founded earlier touched it
        for (const s of t) {
          if (s.foundedYear >= f.namedYear) break
          expect(featuresAt(m, w, s.cell).indexOf(d)).toBe(-1)
        }
      })
    }
  }, 120_000)

  it('names are unique across settlements and features, well formed and euphonious', () => {
    for (const seed of HISTORY_SEEDS) {
      const seen = new Set<string>()
      for (const s of table(seed)) {
        expect(seen.has(s.name.toLowerCase())).toBe(false)
        seen.add(s.name.toLowerCase())
      }
      for (const f of features(seed)) {
        expect(seen.has(f.name.toLowerCase()), f.name).toBe(false)
        seen.add(f.name.toLowerCase())
        expect(f.name).toMatch(/^[A-Z][a-z']*(?: [A-Z][a-z']*)?$/)
        const letters = f.name.replace(/[^A-Za-z]/g, '').length
        expect(letters).toBeGreaterThanOrEqual(3)
        expect(letters).toBeLessThanOrEqual(14)
        for (const word of f.name.toLowerCase().split(' ')) expect(isEuphonic(word), f.name).toBe(true)
      }
    }
  }, 120_000)

  it('settlement names pass the euphony rules and stay short', () => {
    for (const seed of HISTORY_SEEDS) {
      const names = table(seed).map((s) => s.name)
      const lengths = names.map((n) => n.replace(/[^A-Za-z]/g, '').length).sort((a, b) => a - b)
      const median = lengths[Math.floor(lengths.length / 2)]
      expect(median).toBeGreaterThanOrEqual(5)
      expect(median).toBeLessThanOrEqual(8)
      expect(lengths.filter((l) => l > 10).length).toBeLessThan(names.length * 0.03)
      let separators = 0
      for (const n of names) {
        if (/[-']/.test(n)) separators++
        const words = n.toLowerCase().split(/[ -]/)
        for (const word of words) expect(isEuphonic(word), n).toBe(true)
        if (words.length > 1) expect(n.replace(/[^A-Za-z]/g, '').length, n).toBeLessThanOrEqual(11)
      }
      // hyphens and apostrophes are rare
      expect(separators).toBeLessThan(names.length * 0.06)
    }
  }, 120_000)

  it('names given by year 2000 do not depend on what happens later (2000- vs 2500-year runs)', () => {
    for (const seed of [12345, 42]) {
      const short = runHistory(world(seed)).history
      const long = runHistory(world(seed), { years: 2500 }).history
      for (let id = 0; id < short.settlements.length; id++) expect(long.settlements[id].name).toBe(short.settlements[id].name)
      const fl = long.features.filter((f) => f.namedYear <= 2000)
      expect(fl.length).toBe(short.features.length)
      for (let i = 0; i < fl.length; i++) expect([fl[i].name, fl[i].namedBy]).toEqual([short.features[i].name, short.features[i].namedBy])
      expect(long.peoples).toEqual(short.peoples)
    }
  }, 120_000)

  it('is fast', () => {
    const w = world(42)
    const t = table(42)
    nameFeatures(w, t)
    const t0 = performance.now()
    nameFeatures(w, t)
    expect(performance.now() - t0).toBeLessThan(150)
  }, 60_000)
})

describe('euphony gate', () => {
  it('rejects the awkward shapes the old generator made', () => {
    for (const bad of ['thaznufnuz', 'moththathis', 'sfazaz', 'ufvu', 'aotguchat', 'utvuaitit', 'choang', 'kekk', 'mumo']) expect(isEuphonic(bad), bad).toBe(false)
    for (const good of ['kepia', 'kephia', 'hingara', 'oru', 'lovodreno', 'tarsen', 'meliora', 'brandok']) expect(isEuphonic(good), good).toBe(true)
  })
})
