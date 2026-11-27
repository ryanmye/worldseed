// typology: writing systems at assembly (language-typology-scripts.md §10 step 10). Heavy: two 1600-year runs (seed 7).
import { describe, expect, it } from 'vitest'
import { generateWorld, simulateHistory } from '../../index.ts'
import { createRunner } from '../index.ts'
import { EventType, IdeaHow, ScriptCause, ScriptOrigin, scriptAt, type History } from '../../../contract.ts'
import { SCRIPT } from '../../names/typology/params.ts'
import { describeLanguageEvent } from '../../../ui/languageFormat.ts'

/** People holding the writing idea at `year`. */
function literate(h: History, year: number): Set<number> {
  const W = h.ideas.findIndex((x) => x.key === 'writing')
  const A = h.ideaAdoptions
  const held = new Map<number, boolean>()
  for (let k = 0; k < A.count && A.year[k] <= year; k++) if (A.idea[k] === W) held.set(A.people[k], A.how[k] !== IdeaHow.Lost)
  return new Set([...held].filter(([, v]) => v).map(([p]) => p))
}

describe('typology: writing systems (History.scripts, scriptUse, events 400-404)', () => {
  const w = generateWorld(7)
  const years = 1600

  it('absent without typology; a script iff writing is held; well-formed events; prefix-stable', () => {
    const off = simulateHistory(w, { years: 300, language: true })
    expect(off.scripts).toBeUndefined()
    expect(off.scriptUse).toBeUndefined()
    expect(off.events.some((e) => e.type >= 400 && e.type <= 409)).toBe(false)
    const r = createRunner(w, { language: true, typology: true })
    const h9 = r.advance(900).history
    const h = r.advance(years).history
    const S = h.scripts!, U = h.scriptUse!
    expect(U.start.length).toBe(h.peoples.length + 1)
    for (const y of [600, 1000, 1300, years]) {
      const lit = literate(h, y)
      for (let p = 0; p < h.peoples.length; p++) expect(scriptAt(h, p, y) >= 0, `people ${p} at ${y}`).toBe(lit.has(p))
    }
    for (let s = 0; s < S.count; s++) {
      expect(S.parent[s]).toBeLessThan(s)
      expect(S.family[s]).toBeLessThanOrEqual(s)
      if (S.parent[s] >= 0 && S.origin[s] !== ScriptOrigin.Stimulus) expect(S.family[s]).toBe(S.family[S.parent[s]])
      expect(S.name[s].length).toBeGreaterThan(0)
    }
    const evs = h.events.filter((e) => e.type >= EventType.ScriptInvented && e.type <= EventType.ScriptLost)
    for (const e of evs) {
      expect(e.value).toBeGreaterThanOrEqual(0)
      expect(e.value).toBeLessThan(S.count)
      if (e.type !== EventType.ScriptLost) expect(S.year[e.value]).toBe(e.year)
      expect(describeLanguageEvent(h, e)).toBeTruthy()
    }
    expect(evs.filter((e) => e.type === EventType.ScriptInvented || e.type === EventType.ScriptAdopted || e.type === EventType.ScriptReformed || e.type === EventType.ScriptReplaced).length).toBe(S.count)
    // replacement by rule or faith only after shiftMin exposure: never in the first four bins of a people's writing
    for (let p = 0; p < h.peoples.length; p++) {
      for (let k = U.start[p] + 1; k < U.start[p + 1]; k++) {
        if (U.cause[k] !== ScriptCause.Rule && U.cause[k] !== ScriptCause.Faith) continue
        expect(U.year[k] - U.year[U.start[p]]).toBeGreaterThanOrEqual(3 * SCRIPT.bin)
      }
    }
    // prefix: the scripts of the 900-year history are the first ones of the longer
    const A = h9.scripts!
    for (let s = 0; s < A.count; s++) expect([S.type[s], S.parent[s], S.people[s], S.year[s], S.direction[s]]).toEqual([A.type[s], A.parent[s], A.people[s], A.year[s], A.direction[s]])
    const e9 = h9.events.filter((e) => e.type >= 400 && e.type <= 404)
    expect(evs.filter((e) => e.year <= 900).slice(0, e9.length)).toEqual(e9)
  })
})
