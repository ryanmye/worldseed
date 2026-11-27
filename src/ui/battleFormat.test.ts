import { describe, expect, it } from 'vitest'
import { generateWorld, simulateHistory } from '../sim/index.ts'
import { describeEvent, describeEventFor, eventKind } from './format.ts'
import { CHRONICLE_FILTERS, entryCategory } from './chronicleFilter.ts'
import { EntryKind } from './historyIndex.ts'
import { battlesOf, notableBattlesOfWar } from './battlesData.ts'
import { battleShortLine, describeBattle } from './battleFormat.ts'
import { generateSaga, sagaText } from './sagas/index.ts'

describe('battles: chronicle text', () => {
  it('every battles event and battle row reads as prose, under the Battles filter', () => {
    const h = simulateHistory(generateWorld(1), { years: 900, battles: true })
    const bd = battlesOf(h)
    expect(bd).not.toBeNull()
    const evs = h.events.filter((e) => (e.type as number) >= 220 && (e.type as number) <= 229)
    expect(evs.length).toBeGreaterThan(0)
    const battlesFilter = CHRONICLE_FILTERS.indexOf('Battles')
    for (const e of evs) {
      const t = describeEvent(h, e)
      expect(t.length).toBeGreaterThan(10)
      expect(t).not.toMatch(/undefined|NaN/)
      expect(describeEventFor(h, e, e.settlement)).not.toMatch(/undefined|NaN/)
      expect(eventKind(e)).toBe('battle')
      expect(entryCategory(h, EntryKind.Single, e)).toBe(battlesFilter)
    }
    for (let b = 0; b < h.battles.count; b++) {
      expect(describeBattle(h, b)).not.toMatch(/undefined|NaN/)
      expect(battleShortLine(h, b)).toContain(String(h.battles.year[b]))
    }
    for (let w = 0; w < h.wars.count; w++) for (const b of notableBattlesOfWar(h, w)) expect(h.battles.war[b]).toBe(w)
    // sagas: a commander's saga, and battle and siege scenes in the state, city and world sagas, read cleanly in both registers
    const w = generateWorld(1)
    const C = h.commanders
    let top = 0
    for (let k = 1; k < C.count; k++) if (C.fame[k] > C.fame[top]) top = k
    const texts: string[] = []
    for (const legend of [false, true]) {
      texts.push(sagaText(generateSaga(h, w, { kind: 'commander', id: top }, legend, h.years)))
      texts.push(sagaText(generateSaga(h, w, { kind: 'world', id: 0 }, legend, h.years)))
      texts.push(sagaText(generateSaga(h, w, { kind: 'state', id: h.commanders.polity[top] }, legend, h.years)))
      const tgt = h.battles.target[0]
      texts.push(sagaText(generateSaga(h, w, { kind: 'city', id: tgt }, legend, h.years)))
    }
    for (const t of texts) { expect(t).not.toMatch(/undefined|NaN|\{[a-zA-Z0-9]+\??\}/) }
    // an off history has no battles index
    expect(battlesOf({ ...h, battles: { ...h.battles, count: 0 } })).toBeNull()
  }, 900000)
})
