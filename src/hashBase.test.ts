// G0 (MASTER-PLAN §2.1 R2): hashBase of the default 2000-year history equals the 8cabf09 goldens on seeds 1, 42 and 1234,
// and the projection drops added fields and narrows widened ones back to their 8cabf09 types.
import { describe, expect, it } from 'vitest'
import { generateWorld, simulateHistory } from './sim/index.ts'
import { hashValue } from './historyCache.ts'
import { G0_GOLDENS, G0_YEARS, hashBase, project, projectBase } from './hashBase.ts'
import type { History } from './contract.ts'

describe('hashBase', () => {
  it('projection: added keys dropped (top level and nested), widened typed arrays narrowed, events kept', () => {
    const shape = { o: { a: 'Uint8Array', r: { o: { x: 0 } }, l: { a: { o: { y: 0 } } }, events: 0 } } as const
    const v = { a: new Uint16Array([1, 2, 255]), r: { x: 1, added: 2 }, l: [{ y: 1, z: 2 }], events: [{ q: 1 }], extra: new Float32Array(3) }
    expect(project(v, shape)).toEqual({ a: new Uint8Array([1, 2, 255]), r: { x: 1 }, l: [{ y: 1 }], events: [{ q: 1 }] })
    expect(hashValue(project(v, shape))).toBe(hashValue({ a: new Uint8Array([1, 2, 255]), r: { x: 1 }, l: [{ y: 1 }], events: [{ q: 1 }] }))
    expect(v.r).toEqual({ x: 1, added: 2 }) // never mutates
  })

  it('a field added to a History leaves hashBase unchanged', () => {
    const h = simulateHistory(generateWorld(5), { years: 200 })
    const base = hashBase(h)
    expect(base).toBe(hashValue(h)) // identity on the 8cabf09 shape
    const widened = { ...h, plannedField: new Float32Array(4), wars: { ...h.wars, plannedColumn: new Int32Array(h.wars.count) } } as unknown as History
    expect(hashBase(widened)).toBe(base)
    expect(hashValue(widened)).not.toBe(base)
    expect(Object.keys(projectBase(widened) as object)).not.toContain('plannedField')
  })

  for (const seed of [1, 42, 1234]) {
    it(`G0: seed ${seed} at ${G0_YEARS} years is ${G0_GOLDENS[seed]}`, () => {
      expect(hashBase(simulateHistory(generateWorld(seed), { years: G0_YEARS }))).toBe(G0_GOLDENS[seed])
    }, 300_000)
  }
})
