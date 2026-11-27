// governments: forms of government and city-states (city-states.md §8 steps 1-8). One long run per case is shared by the
// tests of a describe.
import { beforeAll, describe, expect, it } from 'vitest'
import { generateWorld } from '../../index.ts'
import { createRunner, simulateHistory } from '../index.ts'
import { AccessionHow, BondEnd, BondKind, EventType, Government, PolityOrigin } from '../../../contract.ts'
import type { History } from '../../../contract.ts'
import { hashValue } from '../../../historyCache.ts'
import { formAt } from './governmentStats.ts'
import { hashBase } from '../../../hashBase.ts'

const isGov = (t: number) => t >= EventType.CharterBought && t <= EventType.CharterRevoked

describe('governments: off', () => {
  it('empty by default (GOV_ON false), with polities off, and the base fields the same as without the option', () => {
    const w = generateWorld(3)
    const a = simulateHistory(w, { years: 400 })
    const b = simulateHistory(w, { years: 400, governments: false })
    const c = simulateHistory(w, { years: 400, polities: false, governments: true })
    for (const h of [a, b, c]) {
      expect(h.governments.count).toBe(0)
      expect(h.governmentOffsets.length).toBe(0)
      expect(h.governmentIds.length).toBe(0)
      expect(h.events.some((e) => isGov(e.type))).toBe(false)
    }
    expect(hashBase(b)).toBe(hashBase(a))
  }, 900000)
})

describe('governments: on (seed 1234, 2000 years; and shorter, resumed)', () => {
  let h: History, short: History, resumed: History, noRul: History
  beforeAll(() => {
    const w = generateWorld(1234)
    h = simulateHistory(w, { years: 2000, governments: true })
    short = simulateHistory(w, { years: 1300, governments: true })
    const run = createRunner(w, { governments: true })
    run.advance(900)
    resumed = run.advance(1300).history
    noRul = simulateHistory(w, { years: 1300, governments: true, rulers: false })
  }, 900000)

  it('every polity has a founding row in its founding year; rows per polity in year order; offsets consistent', () => {
    const G = h.governments, o = h.governmentOffsets
    expect(o.length).toBe(h.polities.length + 1)
    expect(o[h.polities.length]).toBe(G.count)
    for (const P of h.polities) {
      expect(o[P.id + 1]).toBeGreaterThan(o[P.id])
      const r0 = h.governmentIds[o[P.id]]
      expect(G.year[r0]).toBe(P.foundedYear)
      expect(G.polity[r0]).toBe(P.id)
      for (let k = o[P.id] + 1; k < o[P.id + 1]; k++) {
        const a = h.governmentIds[k - 1], b = h.governmentIds[k]
        expect(G.year[b]).toBeGreaterThanOrEqual(G.year[a])
        expect(G.polity[b]).toBe(P.id)
        if (k > o[P.id] + 1) expect(G.year[b]).toBeGreaterThan(G.year[a]) // (a form never changes twice in a year, the founding row aside)
      }
      if (P.origin === PolityOrigin.League) expect(G.form[r0]).toBe(Government.League)
      if (P.origin === PolityOrigin.Charter) expect(G.form[r0]).toBe(Government.FreeCity)
      if (P.origin === PolityOrigin.CityState) expect([Government.Republic, Government.Theocracy]).toContain(G.form[r0])
    }
    expect(G.count).toBeGreaterThan(h.polities.length) // (some changes happen)
  })

  it('prefix-stable, and a resumed run equals one from scratch', () => {
    const A = short.governments, B = h.governments
    expect(B.count).toBeGreaterThanOrEqual(A.count)
    for (let k = 0; k < A.count; k++) { expect(B.polity[k]).toBe(A.polity[k]); expect(B.year[k]).toBe(A.year[k]); expect(B.form[k]).toBe(A.form[k]); expect(B.cause[k]).toBe(A.cause[k]); expect(B.ruler[k]).toBe(A.ruler[k]) }
    expect(hashValue(resumed)).toBe(hashValue(short))
  })

  it('reigns: elected heads only under elected forms; every row ruler is a reign of that polity acceded that year', () => {
    for (const x of h.rulers) {
      const f = formAt(h, x.polity, x.acceded)
      if (x.dynasty < 0) expect([Government.Republic, Government.FreeCity, Government.Theocracy, Government.League]).toContain(f)
      else expect([Government.Monarchy, Government.Signoria, Government.Confederation]).toContain(f)
    }
    const G = h.governments
    for (let k = 0; k < G.count; k++) {
      const r = G.ruler[k]
      if (r < 0) continue
      expect(h.rulers[r].polity).toBe(G.polity[k])
      expect(h.rulers[r].acceded).toBe(G.year[k])
    }
    expect(noRul.governments.count).toBeGreaterThan(0)
    for (let k = 0; k < noRul.governments.count; k++) expect(noRul.governments.ruler[k]).toBe(-1)
  })

  it('charters: a Charter bond from the year; FreeCity intervals hold one; Freed bonds have their CommuneProclaimed extra 2', () => {
    const B = h.bonds, G = h.governments
    for (const e of h.events) {
      if (e.type !== EventType.CharterBought) continue
      let found = false
      for (let k = 0; k < B.count; k++) if (B.kind[k] === BondKind.Charter && B.a[k] === e.value && B.startYear[k] === e.year) found = true
      expect(found).toBe(true)
    }
    for (let k = 0; k < G.count; k++) {
      if (G.form[k] !== Government.FreeCity) continue
      const p = G.polity[k], y = G.year[k]
      let held = false
      for (let b = 0; b < B.count; b++) if (B.kind[b] === BondKind.Charter && B.a[b] === p && B.startYear[b] <= y && (B.endYear[b] < 0 || B.endYear[b] > y)) held = true
      expect(held).toBe(true)
    }
    for (let b = 0; b < B.count; b++) {
      if (B.kind[b] !== BondKind.Charter || B.end[b] !== BondEnd.Freed) continue
      expect(h.events.some((e) => e.type === EventType.CommuneProclaimed && e.value === B.a[b] && e.year === B.endYear[b] && e.extra === 2)).toBe(true)
    }
    // city-state origins only through the governments rows, contado small at founding
    const S = h.settlements.length
    for (const P of h.polities) {
      if (P.origin !== PolityOrigin.Charter && P.origin !== PolityOrigin.CityState) continue
      const q = Math.floor(P.foundedYear / h.snapshotInterval) + 1
      if (q >= h.snapshotCount) continue
      const cap = P.capitals[0]
      for (let i = 0; i < S; i++) if (i !== cap && h.polity[q * S + i] === P.id && h.settlements[i].foundedYear < P.foundedYear) expect(h.population[q * S + i]).toBeLessThanOrEqual(0.5 * h.population[q * S + cap] + 200)
    }
  })

  it('signoria: SignoriaSeized is followed the same year by its lord RulerAcceded (Usurped); theocracies rule the holy city of their faith', () => {
    for (const e of h.events) {
      if (e.type === EventType.SignoriaSeized) expect(h.events.some((f) => f.type === EventType.RulerAcceded && f.year === e.year && h.rulers[f.value].polity === e.value && f.extra === AccessionHow.Usurped)).toBe(true)
      if (e.type === EventType.TheocracyProclaimed) expect(h.faiths[e.extra ?? -1]?.holyCity).toBe(e.settlement)
    }
  })
})

describe('governments: religion off', () => {
  it('no theocracies', () => {
    const h = simulateHistory(generateWorld(7), { years: 1200, governments: true, religion: false })
    expect(h.events.some((e) => e.type === EventType.TheocracyProclaimed)).toBe(false)
    for (let k = 0; k < h.governments.count; k++) expect(h.governments.form[k]).not.toBe(Government.Theocracy)
  }, 900000)
})
