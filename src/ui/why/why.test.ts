// Why (causal-explorer.md §10.2): graph properties on four seeds, the golden chains (structure), prose without unfilled
// slots in both registers, and the rule-only fallback on a History without its causes records.
import { describe, expect, it } from 'vitest'
import { EventType as E, PolityEnd, ReignEnd, RevoltCause } from '../../contract.ts'
import type { History } from '../../contract.ts'
import { generateWorld, simulateHistory } from '../../sim/index.ts'
import { explain } from './explain.ts'
import { WhyTier, causesIn, parseKey } from './graph.ts'
import type { WhyTree } from './graph.ts'
import { plainText, whyProse } from './prose.ts'
import { precision, whyStats, withoutWhy } from './whyStats.ts'
import { RULE_CONF } from './rules/base.ts'

const YEARS = 1000
const KEY_TYPES: number[] = [E.PolityEnded, E.WarDeclared, E.Revolt, E.Famine, E.Abandoned, E.ReignEnded, E.Conquered]
const runs = new Map<number, History>()
const run = (seed: number) => {
  let h = runs.get(seed)
  if (!h) runs.set(seed, (h = simulateHistory(generateWorld(seed), { years: YEARS, causes: true })))
  return h
}

function yearOf(t: WhyTree, key: string): number {
  return t.nodes.get(key)?.year ?? -1
}

function checkTree(h: History, t: WhyTree): void {
  // causes come no later than effects (same year: earlier in the log)
  for (const l of t.links) {
    const yc = yearOf(t, l.cause), ye = yearOf(t, l.effect)
    expect(yc).toBeLessThanOrEqual(ye)
    const a = parseKey(l.cause), b = parseKey(l.effect)
    expect(a).not.toBeNull()
    if (a!.kind === 'event') expect(a!.id).toBeLessThan(h.events.length)
    if (a!.kind === 'war') expect(a!.id).toBeLessThan(h.wars.count)
    if (yc === ye && a!.kind === 'event' && b && (b.kind === 'event' || b.kind === 'cond')) expect(a!.id).toBeLessThan(b.id)
    expect(l.conf).toBeGreaterThan(0)
    expect(l.conf).toBeLessThanOrEqual(1)
  }
  // no cycles; depth <= 8
  const kids = causesIn(t)
  const depth = (k: string, seen: Set<string>): number => {
    expect(seen.has(k)).toBe(false)
    let d = 0
    for (const l of kids.get(k) ?? []) {
      if (seen.size > 20) break
      const s2 = new Set(seen); s2.add(k)
      d = Math.max(d, 1 + depth(l.cause, s2))
    }
    return d
  }
  expect(depth(t.root, new Set())).toBeLessThanOrEqual(8)
}

describe('why: graph properties (seeds 1, 7, 42, 1234 at 1000 y)', () => {
  for (const seed of [1, 7, 42, 1234]) {
    it(`seed ${seed}: every key event explains; order, range, depth, conf; prose has no unfilled slot`, () => {
      const h = run(seed)
      let n = 0, said = 0
      for (let i = 0; i < h.events.length; i++) {
        if (!KEY_TYPES.includes(h.events[i].type)) continue
        const t = explain(h, `event:${i}`)
        checkTree(h, t)
        if (n % 7 === 0) {
          for (const legend of [false, true]) {
            const s = plainText(whyProse(h, t, legend, seed))
            expect(s).not.toMatch(/\{\w+\??\}/)
            expect(s.length).toBeGreaterThan(10)
          }
        }
        if (t.links.some((l) => l.effect === t.root)) said++
        n++
      }
      expect(n).toBeGreaterThan(100)
      expect(said / n).toBeGreaterThan(0.9) // ("the record does not say why" stays rare)
    }, 900_000)
  }
})

describe('why: golden chains (structure), seed 42 and 1234 at 1000 y', () => {
  for (const seed of [42, 1234]) {
    it(`seed ${seed}`, () => {
      const h = run(seed)
      const first = (f: (i: number) => boolean) => { for (let i = 0; i < h.events.length; i++) if (f(i)) return i; return -1 }
      // (a) the first PolityEnded(Conquered): R1 -> R2 -> R3 -> R4a conditions
      const a = first((i) => h.events[i].type === E.PolityEnded && h.polities[h.events[i].value].endCause === PolityEnd.Conquered)
      if (a >= 0) {
        const t = explain(h, `event:${a}`)
        const via = t.links.map((l) => l.via)
        expect(via).toContain('R1')
        expect(via).toContain('R2')
        expect(via).toContain('R3')
        expect(t.links.some((l) => l.tier === WhyTier.Condition && (l.via === 'cond:odds' || l.via.startsWith('cond:rivalry.')))).toBe(true)
        const s = plainText(whyProse(h, t, false, seed))
        expect(s).toMatch(/came to an end/)
      }
      // (b) the deadliest war: a rolled declaration has its drive's conditions
      let dw = -1
      for (let w = 0; w < h.wars.count; w++) if (h.why!.wars.odds[w] > 0 && (dw < 0 || h.wars.dead[w] > h.wars.dead[dw])) dw = w
      expect(dw).toBeGreaterThanOrEqual(0)
      const tb = explain(h, `war:${dw}`)
      expect(tb.links.filter((l) => l.tier === WhyTier.Condition).length).toBeGreaterThan(0)
      // (c) the first Ethnic revolt: the parts, conquest or foreign rule among them
      const c = first((i) => h.events[i].type === E.Revolt && h.events[i].value === RevoltCause.Ethnic)
      if (c >= 0) expect(explain(h, `event:${c}`).links.some((l) => l.via === 'cond:unrest.Conquest' || l.via === 'cond:unrest.Foreign')).toBe(true)
      // (d) a famine in a burst year: the harvest is a factor, and the weather row backs it
      const yearsN = new Map<number, number>()
      for (const e of h.events) if (e.type === E.Famine) yearsN.set(e.year, (yearsN.get(e.year) ?? 0) + 1)
      const d = first((i) => h.events[i].type === E.Famine && (yearsN.get(h.events[i].year) ?? 0) >= 3)
      if (d >= 0) {
        const t = explain(h, `event:${d}`)
        expect(t.links.some((l) => l.via === 'cond:famine.Harvest')).toBe(true)
      }
      // (e) a dwindled abandonment: its decline, with a migration where one is recorded
      const e = first((i) => h.events[i].type === E.Abandoned)
      expect(explain(h, `event:${e}`).links.some((l) => l.via === 'rec:why.abandons' || l.via === 'R17')).toBe(true)
      // (f) a ReignEnded(Sack): R13 -> a Conquered or Sacked of the capital
      const f = first((i) => h.events[i].type === E.ReignEnded && h.events[i].extra === ReignEnd.Sack)
      if (f >= 0) {
        const t = explain(h, `event:${f}`)
        if (t.links.length) expect(t.links[0].via).toBe('R13Sack')
      }
    }, 900_000)
  }
})

describe('why: fallback without records', () => {
  it('a History without why gives rule-only trees: no record-tier conditions, nothing crashes', () => {
    const h = withoutWhy(run(42))
    let n = 0
    for (let i = 0; i < h.events.length; i++) {
      if (!KEY_TYPES.includes(h.events[i].type)) continue
      const t = explain(h, `event:${i}`)
      checkTree(h, t)
      for (const l of t.links) expect(l.via.startsWith('rec:why')).toBe(false)
      if (n++ % 11 === 0) expect(plainText(whyProse(h, t))).not.toMatch(/\{\w+\??\}/)
    }
    expect(n).toBeGreaterThan(100)
  }, 900_000)

  it('entities resolve to their events; bad keys give an empty tree', () => {
    const h = run(42)
    const p = h.polities.findIndex((x) => x.endedYear >= 0)
    const t = explain(h, `polity:${p}`)
    expect(parseKey(t.root)?.kind).toBe('event')
    expect(explain(h, 'event:99999999').links.length).toBe(0)
    expect(explain(h, 'nonsense').links.length).toBe(0)
  })
})

describe('why: rule calibration (stats; seeds 42 and 1234 at 1000 y)', () => {
  it('no rule shown as likely (conf >= 0.66) measures below 0.6 where it has 20 hits or more', () => {
    const pr = precision([whyStats(run(42)), whyStats(run(1234))])
    for (const [id, v] of Object.entries(pr)) if (v.hits >= 20 && (RULE_CONF[id] ?? 0) >= 0.66) expect(v.precision, id).toBeGreaterThanOrEqual(0.6)
  }, 900_000)
})
