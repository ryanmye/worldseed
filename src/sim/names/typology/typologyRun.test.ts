// typology: wiring (language-typology-scripts.md §10 step 7). Heavy: whole runs (seed 7, 700 years).
import { describe, expect, it } from 'vitest'
import { generateWorld, simulateHistory } from '../../index.ts'
import { createRunner } from '../../history/index.ts'
import { hashValue } from '../../../historyCache.ts'
import type { History } from '../../../contract.ts'
import { logStreams } from '../../rng.ts'
import { spokenNameAt } from '../spoken.ts'
import { hasPhonemes } from './phoneme.ts'
import { plainOk } from './orthography.ts'
import { blocked } from './blocklist.ts'

/** h without names: every string (and string array) dropped, the language tables and events left out (as language.test.ts). */
function stripNames(h: History): unknown {
  const strip = (v: unknown): unknown => {
    if (typeof v === 'string') return ''
    if (Array.isArray(v)) return v.every((x) => typeof x === 'string') ? [] : v.map(strip)
    if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) {
      const o: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) if (k !== 'languages' && k !== 'speech' && k !== 'nameForms') o[k] = strip(x)
      return o
    }
    return v
  }
  const { events, ...rest } = h
  return { ...(strip(rest) as object), events: events.filter((e) => (e.type < 250 || e.type > 259) && (e.type < 400 || e.type > 409)) }
}
/** Every display string of a history (not the underlying forms). */
function displayStrings(h: History): string[] {
  const out: string[] = []
  const walk = (v: unknown): void => {
    if (typeof v === 'string') { out.push(v); return }
    if (Array.isArray(v)) { for (const x of v) walk(x); return }
    if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) for (const [k, x] of Object.entries(v)) if (k !== 'languages' && k !== 'nameForms') walk(x)
  }
  walk(h)
  if (h.languages) out.push(...h.languages.name)
  return out
}

describe('typology wiring (HistoryOptions.typology, lang=2)', () => {
  const w = generateWorld(7)
  const years = 700

  it('off: lang=1 is exactly the history without the option (no model/typo/ortho columns, no typo streams)', () => {
    const log: string[] = []
    logStreams(log)
    let h: History
    try { h = simulateHistory(w, { years: 300, language: true }) } finally { logStreams(null) }
    expect(h.languages!.model).toBeUndefined()
    expect(h.languages!.typo).toBeUndefined()
    expect(h.languages!.ortho).toBeUndefined()
    expect('model' in h.languages!).toBe(false)
    expect(log.filter((x) => x.startsWith('names-typo') || x.startsWith('names-ortho'))).toEqual([])
    expect(hashValue(simulateHistory(w, { years: 300, language: true, typology: false }))).toBe(hashValue(h))
    // typology without language does nothing
    expect(hashValue(simulateHistory(w, { years: 300, typology: true }))).toBe(hashValue(simulateHistory(w, { years: 300 })))
  })

  it('on: every non-name field as lang=1; the same tree and split years; names spelt plain, unique, fluent; prefix-stable', () => {
    const l1 = simulateHistory(w, { years, language: true })
    const r = createRunner(w, { language: true, typology: true })
    const h4 = r.advance(450).history
    const h = r.advance(years).history
    expect(hashValue(stripNames(h))).toBe(hashValue(stripNames(l1)))
    const A = l1.languages!, B = h.languages!
    expect(B.model).toBe(1)
    expect(B.count).toBe(A.count)
    expect(Array.from(B.parent)).toEqual(Array.from(A.parent))
    expect(Array.from(B.splitYear)).toEqual(Array.from(A.splitYear))
    expect(Array.from(B.seat)).toEqual(Array.from(A.seat))
    expect(Array.from(h.speech!.language)).toEqual(Array.from(l1.speech!.language))
    // no phoneme code shown anywhere; plain names pronounceable and not blocked
    const shown = displayStrings(h)
    expect(shown.filter(hasPhonemes)).toEqual([])
    const S = h.settlements.length
    const seen = new Set<string>()
    let bad = 0
    for (let id = 0; id < S; id++) {
      const n = h.settlements[id].name
      expect(seen.has(n.toLowerCase()), n).toBe(false)
      seen.add(n.toLowerCase())
      if (!plainOk(n) || blocked(n)) bad++
      expect(hasPhonemes(h.nameForms!.form[id])).toBe(true)
      expect(spokenNameAt(h, id, years, -1, 'scholarly').length).toBeGreaterThan(0)
    }
    expect(bad / S).toBeLessThan(0.02)
    for (const p of h.peoples) expect(plainOk(p.name) && !blocked(p.name), p.name).toBe(true)
    // prefix stability: names at years <= 450 agree
    for (let id = 0; id < h4.settlements.length; id++) {
      expect(h.settlements[id].name).toBe(h4.settlements[id].name)
      for (const y of [300, 450]) if (y >= h4.settlements[id].foundedYear) expect(spokenNameAt(h, id, y)).toBe(spokenNameAt(h4, id, y))
    }
    expect(h4.peoples.map((p) => p.name)).toEqual(h.peoples.map((p) => p.name))
    expect(Array.from(h4.languages!.ortho!)).toEqual(Array.from(h.languages!.ortho!.subarray(0, h4.languages!.count)))
    // the sound differs from lang=1
    let same = 0
    for (let id = 0; id < S; id++) if (h.settlements[id].name === l1.settlements[id].name) same++
    expect(same / S).toBeLessThan(0.05)
  })
})
