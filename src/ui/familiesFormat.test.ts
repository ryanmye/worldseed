// families: chronicle and inspector lines (familiesFormat.ts), data helpers (familiesData.ts) and the family saga, on seed 42 with families on.
import { beforeAll, describe, expect, it } from 'vitest'
import { EventType, type History, type World } from '../contract.ts'
import { generateWorld } from '../sim/index.ts'
import { simulateHistory } from '../sim/history/index.ts'
import { describeFamilyEvent, describeFamilyEventFor, isFamilyEvent } from './familiesFormat.ts'
import { councilAt, familiesOf, liveFamilies } from './familiesData.ts'
import { housesAtLine } from './familiesPanel.ts'
import { entryCategory } from './chronicleFilter.ts'
import { EntryKind } from './historyIndex.ts'
import { describeEvent } from './format.ts'
import { generateSaga, sagaSubjectValid } from './sagas/index.ts'

describe('families UI (seed 42, 1500 years)', () => {
  let h: History, w: World
  beforeAll(() => {
    w = generateWorld(42)
    h = simulateHistory(w, { years: 1500, families: true })
  }, 900000)

  it('every family event has a chronicle and an inspector line with no placeholder left', () => {
    let n = 0
    for (const e of h.events) {
      if (!isFamilyEvent(e.type)) continue
      n++
      const a = describeFamilyEvent(h, e)
      expect(a, `type ${e.type}`).toBeTruthy()
      expect(a).not.toMatch(/undefined|NaN|\{/)
      expect(describeEvent(h, e)).toBe(a)
      const b = describeFamilyEventFor(h, e, e.settlement)
      expect(b).toBeTruthy()
      expect(b).not.toMatch(/undefined|NaN|\{/)
      const cat = entryCategory(h, EntryKind.Single, e)
      expect(cat).toBe(e.type === EventType.FamilyMarriage || e.type === EventType.FamilyBacked ? 1 : 3)
    }
    expect(n).toBeGreaterThan(20)
  })

  it('the council of a town and the inspector line', () => {
    const fd = familiesOf(h)!
    const live = liveFamilies(fd, 1500)
    expect(live.length).toBeGreaterThan(0)
    const home = h.families.firstHome[live[0].family]
    const council = councilAt(h, home, 1500, 3)
    for (const x of council) { expect(x.share).toBeGreaterThanOrEqual(0); expect(x.share).toBeLessThanOrEqual(0.9 + 1e-4) }
    const q = Math.floor(1500 / h.snapshotInterval)
    const mw = h.merchantWealth[q * h.settlements.length + home]
    if (council.length) expect(housesAtLine(h, home, 1500, mw)).toMatch(/^: /)
  })

  it('a saga generates for every family in both registers, with no slot left', () => {
    for (let f = 0; f < h.families.count; f++) {
      const s = { kind: 'family' as const, id: f }
      expect(sagaSubjectValid(h, s, 1500)).toBe(true)
      for (const legend of [false, true]) {
        const saga = generateSaga(h, w, s, legend, 1500)
        const text = [saga.title, saga.epigraph, ...saga.paragraphs, saga.closing].join(' ')
        expect(text).not.toMatch(/\{[a-zA-Z]+\??\}|undefined|NaN/)
        expect(saga.paragraphs.length).toBeGreaterThan(0)
      }
    }
  })
})
