// Partisan sagas through beliefs (experience-whatif-director-sagas §3.5, step 16): with beliefs-and-deception on, a
// partisan telling reports what its court believed (PartisanFacts in lens.ts), not the truth. Seeds 42 and 1234 at 2000
// years with HistoryOptions.beliefs on. A secret alliance aimed at the teller is not told before it came to light
// (Bonds.known), nor ever when it never did; our own secret pacts are never told in the chronicle; strength words are the
// belief row's estimate over the truth; the record's hindsight ("the records suggest") is never in a partisan telling of
// our own realm; no {slot} is left. Without beliefs, the proxies: plain strength, every bond known.

import { describe, expect, it } from 'vitest'
import { EventType, type History, type World } from '../../contract.ts'
import { generateWorld, simulateHistory } from '../../sim/index.ts'
import { generateSaga, sagaText } from './index.ts'
import { Ctx } from './facts.ts'
import { beliefAt, truthAt } from '../beliefsData.ts'

const runs = new Map<string, { world: World; h: History; top: number[] }>()
function run(seed: number, beliefs: boolean) {
  const key = `${seed}:${beliefs}`
  let r = runs.get(key)
  if (!r) {
    const world = generateWorld(seed)
    const h = simulateHistory(world, { years: 2000, beliefs })
    const c = new Ctx(h, world, h.years)
    const top = h.polities.map((p) => p.id).sort((a, b) => c.ppeak(b).pop - c.ppeak(a).pop || a - b).slice(0, 3)
    runs.set(key, (r = { world, h, top }))
  }
  return r
}
const tell = (r: { world: World; h: History }, p: number, legend: boolean, Y: number, pov = p) =>
  sagaText(generateSaga(r.h, r.world, { kind: 'state', id: p }, legend, Y, { kind: 'state', id: pov }))

let pactsTold = 0
for (const seed of [42, 1234]) {
  describe(`partisan through beliefs, seed ${seed}`, () => {
    it('a secret alliance against the teller is not told before it came to light', { timeout: 900_000 }, () => {
      const r = run(seed, true)
      const { h, world } = r
      const B = h.bonds
      const c0 = new Ctx(h, world, h.years)
      const pacts = c0.type(EventType.SecretAlliance).map((i) => c0.ev(i))
      expect(pacts.length).toBeGreaterThan(0)
      for (const e of pacts) {
        const t = e.extra ?? -1
        if (t < 0 || t >= h.polities.length || h.polities[t].foundedYear > e.year) continue
        const a = c0.polityOf(e.settlement, e.year), b = e.value
        let k = -1
        for (let j = 0; j < B.count; j++) if (B.startYear[j] === e.year && ((B.a[j] === a && B.b[j] === b) || (B.a[j] === b && B.b[j] === a))) { k = j; break }
        expect(k).toBeGreaterThanOrEqual(0)
        const known = B.known[k]
        const c = new Ctx(h, world, h.years, { kind: 'state', id: t })
        const F = c.lens!.facts
        expect(F.believes).toBe(true)
        // before it came to light (or ever, when it never did)
        const before = known < 0 ? h.years : known - 1
        if (before >= e.year) {
          expect(F.allianceKnown(k, before)).toBe(false)
          for (const legend of [false, true]) {
            const txt = tell(r, t, legend, before)
            expect(txt).not.toContain(`in secret since ${e.year}`)
            expect(txt).not.toContain(`since ${e.year} the`)
          }
        }
        if (known >= 0) {
          expect(F.allianceKnown(k, known)).toBe(true)
          const txt = tell(r, t, false, Math.max(known, h.polities[t].endedYear >= 0 ? Math.min(h.years, h.polities[t].endedYear) : h.years))
          if (txt.includes(`in secret since ${e.year}`)) pactsTold++
        }
      }
    })

    it('our own secret pacts are never told in the chronicle; no hindsight, no {slot}', { timeout: 900_000 }, () => {
      const r = run(seed, true)
      for (const p of r.top) {
        const chron = tell(r, p, false, r.h.years), leg = tell(r, p, true, r.h.years)
        expect(chron).not.toContain('never guessed')
        expect(chron).not.toContain('the records suggest')
        expect(chron).not.toMatch(/\{\w+\}/)
        expect(leg).not.toMatch(/\{\w+\}/)
        // told by its foes too
        for (const q of r.top) if (q !== p) expect(tell(r, p, false, r.h.years, q)).not.toMatch(/\{\w+\}/)
      }
    })

    it('strength words are the court\'s estimate over the truth', { timeout: 900_000 }, () => {
      const r = run(seed, true)
      const { h, world } = r
      let checked = 0
      for (const p of r.top) {
        const c = new Ctx(h, world, h.years, { kind: 'state', id: p })
        const F = c.lens!.facts
        for (let y = 100; y <= h.years; y += 100) {
          const o = F.observer(y)
          if (o < 0) continue
          for (let t = 0; t < h.polities.length; t++) {
            if (c.lens!.isUs(t) || F.foeShown(t, y)) continue
            const k = F.row(o, t)
            const b = k >= 0 ? beliefAt(h, k, y) : null
            const tr = truthAt(h, t, y)
            const want = !b || !(b.est > 0) || !(tr > 0) ? '' : b.est / tr >= 1.5 ? 'mighty ' : b.est / tr <= 0.67 ? 'feeble ' : ''
            expect(F.strengthWord(t, y)).toBe(want)
            if (want) checked++
          }
        }
      }
      expect(checked).toBeGreaterThan(0)
    })
  })
}

describe('partisan through beliefs: totals and the proxies', () => {
  it('at least one secret pact is told once it came to light', () => {
    expect(pactsTold).toBeGreaterThan(0)
  })
  it('without beliefs: plain strength, every bond known', { timeout: 900_000 }, () => {
    const r = run(42, false)
    const c = new Ctx(r.h, r.world, r.h.years, { kind: 'state', id: r.top[0] })
    const F = c.lens!.facts
    expect(F.believes).toBe(false)
    for (let t = 0; t < r.h.polities.length; t++) for (const y of [500, 1000, 1500, 2000]) expect(F.strengthWord(t, y)).toBe('')
    const B = r.h.bonds
    for (let k = 0; k < B.count; k++) expect(F.allianceKnown(k, B.startYear[k])).toBe(true)
  })
})
