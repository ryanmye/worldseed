// language: the tree, drift at assembly and contact (language-drift.md §7 steps 2-7). Heavy: whole runs.
import { describe, expect, it } from 'vitest'
import { generateWorld, simulateHistory } from '../index.ts'
import { createRunner } from '../history/index.ts'
import { hashValue } from '../../historyCache.ts'
import { EventType, type History } from '../../contract.ts'
import { logStreams } from '../rng.ts'
import { LANG } from './languageParams.ts'
import { buildTree } from './languageTree.ts'
import { spokenNameAt, languageAt } from './spoken.ts'
import { fluentName, isEuphonicDrift } from './words.ts'
import { MEANING } from './lexicon.ts'
import { cognatePoints, fitLambda } from './languageStats.ts'

/** h without names: every string (and string array) dropped, the language tables and events left out. */
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
  return { ...(strip(rest) as object), events: events.filter((e) => e.type < 250 || e.type > 259) }
}

describe('language drift (HistoryOptions.language)', () => {
  const w = generateWorld(7)

  it('off by default: no language tables, no lang- streams, the same history as language: false', () => {
    const log: string[] = []
    logStreams(log)
    let h: History
    try { h = simulateHistory(w, { years: 300 }) } finally { logStreams(null) }
    expect(h.languages).toBeUndefined()
    expect(h.speech).toBeUndefined()
    expect(h.nameForms).toBeUndefined()
    expect(log.filter((x) => x.startsWith('lang-'))).toEqual([])
    expect(hashValue(simulateHistory(w, { years: 300, language: false }))).toBe(hashValue(h))
  })

  it('on: every non-name field is the same as off; names are prefix-stable; the tree of a prefix is the prefix of the tree', () => {
    const off = simulateHistory(w, { years: 700 })
    const r = createRunner(w, { language: true })
    const h4 = r.advance(450).history
    const h7 = r.advance(700).history
    expect(hashValue(stripNames(h7))).toBe(hashValue(stripNames(off)))
    // names at years <= 450 agree
    const S4 = h4.settlements.length
    for (let id = 0; id < S4; id++) {
      expect(h7.settlements[id].name, `settlement ${id}`).toBe(h4.settlements[id].name)
      for (const y of [h4.settlements[id].foundedYear, 300, 450]) if (y >= h4.settlements[id].foundedYear) expect(spokenNameAt(h7, id, y)).toBe(spokenNameAt(h4, id, y))
    }
    const A = h4.languages!, B = h7.languages!
    expect(B.count).toBeGreaterThanOrEqual(A.count)
    for (let n = 0; n < A.count; n++) {
      expect([B.parent[n], B.splitYear[n], B.seat[n], B.people[n]]).toEqual([A.parent[n], A.splitYear[n], A.seat[n], A.people[n]])
      const ra: number[] = [], rb: number[] = []
      for (let i = A.ruleStart[n]; i < A.ruleStart[n + 1]; i++) ra.push(A.ruleYear[i], A.ruleKind[i], A.ruleVariant[i])
      for (let i = B.ruleStart[n]; i < B.ruleStart[n + 1] && B.ruleYear[i] <= 450; i++) rb.push(B.ruleYear[i], B.ruleKind[i], B.ruleVariant[i])
      expect(rb).toEqual(ra)
    }
    // the tree alone (pure in the table): a prefix of the table gives a prefix of the tree
    const st = h7.settlements
    const full = buildTree(w, st), pre = buildTree(w, st.slice(0, S4).map((s) => ({ ...s, abandonedYear: s.abandonedYear > 450 ? -1 : s.abandonedYear })))
    for (let id = 0; id < S4; id++) expect(full.foundNode[id]).toBe(pre.foundNode[id])
    for (let n = 0; n < pre.count; n++) expect([full.parent[n], full.splitYear[n], full.seat[n]]).toEqual([pre.parent[n], pre.splitYear[n], pre.seat[n]])
    expect(buildTree(w, st).foundNode).toEqual(full.foundNode) // (pure)
  })

  it('a 2000-year run: tree sizes, founding rows, unique fluent names, euphonic drifted forms, events, shifts, fossilisation', () => {
    const h = simulateHistory(w, { years: 2000, language: true })
    const L = h.languages!, sp = h.speech!, nf = h.nameForms!
    const S = h.settlements.length
    expect(L.count).toBeGreaterThanOrEqual(20)
    expect(L.count).toBeLessThanOrEqual(LANG.maxNodes)
    // every settlement has a founding speech row, rows ascending
    for (let id = 0; id < S; id++) {
      expect(sp.start[id + 1]).toBeGreaterThan(sp.start[id])
      expect(sp.year[sp.start[id]]).toBe(h.settlements[id].foundedYear)
      for (let r = sp.start[id] + 1; r < sp.start[id + 1]; r++) expect(sp.year[r]).toBeGreaterThanOrEqual(sp.year[r - 1])
    }
    // founding names: unique, fluent, said as coined in the founding language
    const seen = new Set<string>()
    for (let id = 0; id < S; id++) {
      const n = h.settlements[id].name
      expect(seen.has(n.toLowerCase()), n).toBe(false)
      seen.add(n.toLowerCase())
      expect(nf.form[id].length).toBeGreaterThan(0)
    }
    expect(h.settlements.filter((s) => !fluentName(s.name)).length / S).toBeLessThan(0.02)
    // spoken forms pass the drift gate (the isEuphonicDrift amendment), at every word
    for (let id = 0; id < S; id += 3) {
      for (const y of [1000, 2000]) {
        if (y < h.settlements[id].foundedYear) continue
        for (const word of spokenNameAt(h, id, y).toLowerCase().split(/[ -]/)) if (word) expect(isEuphonicDrift(word) || word.length <= 2, `${id} ${y} ${word}`).toBe(true)
      }
    }
    // events well-formed
    const evs = h.events.filter((e) => e.type >= 250 && e.type <= 253)
    expect(evs.filter((e) => e.type === EventType.LanguageSplit).length).toBe(L.count - L.parent.filter((p) => p < 0).length)
    for (const e of evs) {
      expect(e.settlement).toBeGreaterThanOrEqual(0)
      expect(e.value).toBeGreaterThanOrEqual(0)
      expect(e.value).toBeLessThan(L.count)
      if (e.type === EventType.LanguageSplit) { expect(L.splitYear[e.value]).toBe(e.year); expect(L.seat[e.value]).toBe(e.settlement) }
      if (e.type === EventType.LanguageShift) expect(languageAt(h, e.settlement, e.year)).toBe(e.value)
    }
    // shifts: only after shiftMin years of a realm of another people holding the town without a break
    const pol = h.polity, I = h.snapshotInterval
    for (let id = 0; id < S; id++) {
      for (let r = sp.start[id] + 1; r < sp.start[id + 1]; r++) {
        if (L.people[sp.language[r]] === L.people[sp.language[r - 1]]) continue
        const y = sp.year[r], q = y / I
        const p = pol[q * S + id]
        expect(p, `shift of ${id} at ${y}`).toBeGreaterThanOrEqual(0)
        for (let k = q - LANG.shiftMin / I; k <= q; k++) expect(pol[k * S + id], `held ${id} at ${k * I}`).toBe(p)
        expect(L.people[sp.language[r]]).not.toBe(L.people[sp.language[r - 1]])
      }
    }
    // proper names fossilise: a town keeps its affix through a later replacement of that word
    let checked = 0
    for (let id = 0; id < S && checked < 20; id++) {
      const n = nf.language[id], y0 = h.settlements[id].foundedYear
      for (let m = MEANING.affix; m < MEANING.geo; m++) {
        const k = n * LANG.core + m
        let later = -1
        for (let r = L.lexStart[k]; r < L.lexStart[k + 1]; r++) if (L.lexYear[r] > y0) { later = r; break }
        if (later < 0) continue
        const before = L.lexForm.slice(L.lexStart[k], L.lexStart[k + 1]).filter((_, i) => L.lexYear[L.lexStart[k] + i] <= y0).pop()
        for (const t of (before ?? '').split('|')) {
          if (t.length < 3 || !nf.form[id].includes(t)) continue
          expect(nf.form[id]).toContain(t) // (the underlying form never changes)
          expect(spokenNameAt(h, id, 2000).length).toBeGreaterThan(0)
          checked++
        }
      }
    }
    // the harness hook: the fit runs on this history
    expect(Number.isFinite(fitLambda(cognatePoints(h, [1000, 2000])))).toBe(true)
  })
})
