// The story director's drama score (experience-whatif-director-sagas §2.8, §0.1): every EventType is scored or
// explicitly ignored (the coverage test, which reads the live EventType), the factors behave, and the score is a
// deterministic function of the History. drama.ts and plan.ts stay CSS-free so Node scripts can import them.

import { describe, expect, it } from 'vitest'
import { EventType, type HistoryEvent } from '../../contract.ts'
import { generateWorld, simulateHistory } from '../../sim/index.ts'
import { buildHistoryIndex, EntryKind, isShownType } from '../historyIndex.ts'
import type { PolitiesData } from '../politiesData.ts'
import { MERGED_SYSTEMS, buildStaticDrama, DRAMA, DRAMA_IGNORED, dramaRule, ENTRY_FAMINE_BURST, ENTRY_SINGLE, isReservedEventId, magnitude, provisionalDrama, registerDrama, ignoreDrama, upsetOf, type DramaCtx } from './drama.ts'

describe('drama coverage', () => {
  it('every EventType has a drama rule or is explicitly ignored (and not both)', () => {
    const missing: string[] = []
    const both: string[] = []
    for (const [name, id] of Object.entries(EventType)) {
      const ruled = DRAMA[id] !== undefined
      const ignored = DRAMA_IGNORED.has(id)
      if (!ruled && !ignored) missing.push(`${name} (${id})`)
      if (ruled && ignored) both.push(`${name} (${id})`)
    }
    expect(missing, 'add a rule with registerDrama(type, rule) in the plan\'s *Format.ts, or ignoreDrama(type)').toEqual([])
    expect(both).toEqual([])
  })

  it('every merged system\'s event type with a drama rule can be a chronicle entry (surfacing lane: society, disasters and cold wars were not)', () => {
    const hidden = Object.entries(EventType).filter(([, id]) => MERGED_SYSTEMS.some(([, f]) => f(id)) && DRAMA[id] !== undefined && !isShownType(id)).map(([n, id]) => `${n} (${id})`)
    expect(hidden, 'historyIndex.ts isShownType must list it, or the director never sees it').toEqual([])
  })

  it('every merged system has a scored headline type (MERGED_SYSTEMS)', () => {
    for (const [name, inSys] of MERGED_SYSTEMS) {
      const ruled = Object.values(EventType).filter((id) => inSys(id) && (DRAMA[id]?.base ?? 0) >= 4)
      expect(ruled.length, `${name}: no rule of base >= 4`).toBeGreaterThan(0)
    }
  })

  it('rules and ignores name only live event types', () => {
    const live = new Set<number>(Object.values(EventType))
    const stale = [...Object.keys(DRAMA).map(Number), ...DRAMA_IGNORED].filter((t) => !live.has(t))
    expect(stale).toEqual([])
  })

  it('every rule has a category and a base weight in 0..10', () => {
    for (const [t, r] of Object.entries(DRAMA)) {
      expect(r!.base, `type ${t}`).toBeGreaterThan(0)
      expect(r!.base, `type ${t}`).toBeLessThanOrEqual(10)
      expect(r!.cat, `type ${t}`).toBeGreaterThanOrEqual(0)
    }
  })

  it('reserved blocks of later plans (MASTER-PLAN §3.1, through 419) have provisional rules until their owners register', () => {
    const blocks = [[161, 169], [190, 199], [200, 209], [210, 219], [220, 229], [230, 239], [240, 249], [250, 259], [260, 269], [270, 279], [280, 289], [290, 299], [300, 309], [310, 319], [320, 329], [330, 339], [340, 349], [350, 359], [360, 369], [380, 389], [410, 419]]
    for (const [lo, hi] of blocks) for (let t = lo; t <= hi; t++) {
      expect(isReservedEventId(t), `id ${t}`).toBe(true)
      // (base 0 is the owner's "ignore": migration 348, divine 381-382)
      if (![348, 381, 382].includes(t)) expect(provisionalDrama(t), `id ${t}`).not.toBeNull()
    }
    expect(isReservedEventId(185)).toBe(false) // 182-189 unassigned
    expect(isReservedEventId(400)).toBe(false) // 390-409 unassigned
    // a registered rule replaces the provisional one, and an ignore drops it
    registerDrama(220, { cat: 0, base: 9 })
    expect(dramaRule(220)?.base).toBe(9)
    ignoreDrama(220)
    expect(dramaRule(220)).toBeNull()
    DRAMA_IGNORED.delete(220)
    expect(dramaRule(220)?.base).toBe(5)
  })

  it('the entry kinds drama.ts special-cases match historyIndex.ts', () => {
    expect(ENTRY_SINGLE).toBe(EntryKind.Single)
    expect(ENTRY_FAMINE_BURST).toBe(EntryKind.FamineBurst)
  })
})

describe('drama factors', () => {
  it('M is 1 at zero and monotone in X', () => {
    expect(magnitude(0)).toBe(1)
    let prev = magnitude(0)
    for (const x of [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7]) {
      const m = magnitude(x)
      expect(m).toBeGreaterThan(prev)
      prev = m
    }
    expect(magnitude(-5)).toBe(1)
  })

  const fakeCtx = (pop: Record<number, number>, extra: Partial<DramaCtx> = {}): DramaCtx => ({
    h: { settlements: [], population: new Float32Array(0) } as never,
    pd: null,
    N: 0,
    snap: () => 0,
    popBefore: () => 0,
    polityPop: (p) => pop[p] ?? 0,
    polityPeak: () => 0,
    tier: () => -1,
    polityBefore: () => -1,
    polityAfter: () => -1,
    peoplePop: () => 0,
    ...extra,
  })

  it('U = 1 when the stronger side wins, in (1, 3] when the weaker does', () => {
    const c = fakeCtx({ 0: 1000, 1: 4000, 2: 1e6 })
    expect(upsetOf(c, 1, 0, 100)).toBe(1)
    expect(upsetOf(c, 0, 1, 100)).toBeCloseTo(2)
    expect(upsetOf(c, 0, 2, 100)).toBe(3)
    expect(upsetOf(c, 0, 0, 100)).toBe(1)
    expect(upsetOf(c, -1, 0, 100)).toBe(1)
  })

  it('a capital that falls scores more than a plain town taken', () => {
    // town 5 is (or is not) polity 0's capital; polity 1 takes it
    const conquered: HistoryEvent = { year: 300, type: EventType.Conquered, settlement: 5, other: 9, value: 0 }
    const pd = (capital: number) => ({ list: [{ capitals: [capital], capitalYears: [0] }, { capitals: [9], capitalYears: [0] }], count: 2 }) as unknown as PolitiesData
    const ctx = (capital: number) => fakeCtx({ 0: 5000, 1: 8000 }, { pd: pd(capital), polityBefore: () => 0, polityAfter: () => 1, popBefore: () => 4000 })
    const rule = DRAMA[EventType.Conquered]!
    const s0 = (c: DramaCtx) => rule.base * (rule.boost?.(c, conquered) ?? 1) * (rule.upset?.(c, conquered) ?? 1)
    expect(s0(ctx(5))).toBeGreaterThan(s0(ctx(7)))
    expect(rule.boost!(ctx(5), conquered)).toBe(2.5)
    expect(rule.boost!(ctx(7), conquered)).toBe(1)
  })

  it('a reign scores only when it ended in battle or by plague', () => {
    const r = DRAMA[EventType.ReignEnded]!
    const c = fakeCtx({})
    const e = (extra: number): HistoryEvent => ({ year: 1, type: EventType.ReignEnded, settlement: 0, other: -1, value: 0, extra })
    expect(r.gate!(c, e(1))).toBe(false)
    expect(r.gate!(c, e(2))).toBe(true)
    expect(r.gate!(c, e(6))).toBe(true)
  })
})

describe('static drama over a History', () => {
  it('is deterministic, and scores only entries with a scored representative', { timeout: 300_000 }, () => {
    const h = simulateHistory(generateWorld(7), { years: 900 })
    const ix = buildHistoryIndex(h)
    const a = buildStaticDrama(ix)
    const b = buildStaticDrama(ix)
    expect(Array.from(a.score)).toEqual(Array.from(b.score))
    expect(Array.from(a.key)).toEqual(Array.from(b.key))
    expect(a.score.length).toBe(ix.notableKind.length)
    let scored = 0
    for (let k = 0; k < a.score.length; k++) {
      if (a.score[k] <= 0) {
        expect(a.rep[k]).toBe(-1)
        continue
      }
      scored++
      const e = h.events[a.rep[k]]
      expect(dramaRule(e.type as number), `entry ${k} type ${e.type}`).not.toBeNull()
      expect(a.cell[k]).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(a.score[k])).toBe(true)
    }
    expect(scored).toBeGreaterThan(50)
  })
})

describe('drama.ts and plan.ts are CSS-free (Node scripts import them)', () => {
  it('no value import reachable from them loads a .css file', () => {
    // every source file as text, keyed by its path relative to src/ui/story ('../../contract.ts', './plan.ts', ...)
    const sources = import.meta.glob('../../**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const norm = (path: string) => {
      const out: string[] = []
      for (const part of path.split('/')) {
        if (part === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop()
        else if (part !== '.') out.push(part)
      }
      return out[0] === '..' ? out.join('/') : `./${out.join('/')}`
    }
    const dir = (path: string) => path.slice(0, path.lastIndexOf('/'))
    const seen = new Set<string>()
    const css: string[] = []
    const walk = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const src = sources[file]
      expect(src, file).toBeTypeOf('string')
      // value imports only: `import type` is erased at run time
      for (const m of src.matchAll(/^import\s+(?!type\b)[^'"]*?['"]([^'"]+)['"]/gm)) {
        const spec = m[1]
        if (spec.endsWith('.css')) css.push(`${file} -> ${spec}`)
        else if (spec.startsWith('.')) walk(norm(`${dir(file)}/${spec}`))
      }
    }
    walk('./drama.ts')
    walk('./plan.ts')
    walk('./director.ts')
    expect(css).toEqual([])
    expect([...seen].some((f) => f.endsWith('historyIndex.ts'))).toBe(false)
    expect(seen.has('../../contract.ts')).toBe(true)
  })
})
