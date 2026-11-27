// absentee: AI rulers who let the court decide (rulers/absentee.ts; HistoryOptions.absentee). Off is the history without it;
// on, the causes feed the shared deference (rulers/deference.ts), declines are told (CouncilRuled, RuledInPerson), the run
// replays exactly, and the chronicle has words for every event.
import { describe, expect, it } from 'vitest'
import { EventType } from '../../../contract.ts'
import { generateWorld, simulateHistory } from '../../index.ts'
import { hashAll } from '../seat/hashing.ts'
import { DeferenceCause } from './deference.ts'
import { describeAbsenteeEvent } from '../../../ui/absenteeFormat.ts'
import { rulerEpithet } from '../../../ui/sagas/epithets.ts'
import type { ReignFacts } from '../../../ui/sagas/epithets.ts'

const YEARS = 1300

describe('absentee rulers (seed 42)', () => {
  const w = generateWorld(42)
  const base = simulateHistory(w, { years: YEARS })
  const on = simulateHistory(w, { years: YEARS, absentee: true })

  it('off is the history without it (no deference, no 185-187)', () => {
    const off = simulateHistory(w, { years: YEARS, absentee: false })
    expect(hashAll(off)).toBe(hashAll(base))
    expect(off.deference).toBeUndefined()
    expect(base.events.some((e) => (e.type as number) >= 185 && (e.type as number) <= 187)).toBe(false)
  }, 900_000)

  it('feeds deference by AI causes only, tells declines, and replays exactly', () => {
    const D = on.deference!
    expect(D).toBeDefined()
    const fed = new Array(D.causes).fill(0)
    for (let p = 0; p < D.count; p++) for (let c = 0; c < D.causes; c++) fed[c] += D.fed[p * D.causes + c]
    expect(fed[DeferenceCause.Player]).toBe(0)
    expect(fed[DeferenceCause.Minor]).toBeGreaterThan(0)
    expect(fed[DeferenceCause.Infirm]).toBeGreaterThan(0)
    const ruled = on.events.filter((e) => (e.type as number) === EventType.CouncilRuled)
    expect(ruled.length).toBeGreaterThan(0)
    for (const e of ruled) {
      expect(e.extra).toBeGreaterThanOrEqual(1)
      expect(e.extra).toBeLessThanOrEqual(6)
      expect(on.rulers[e.other].polity).toBe(e.value)
    }
    expect(on.events.some((e) => (e.type as number) === EventType.RuledInPerson)).toBe(true)
    // (no seat: the player's events never come)
    expect(on.events.some((e) => (e.type as number) === EventType.SeatDeclined)).toBe(false)
    expect(hashAll(simulateHistory(w, { years: YEARS, absentee: true }))).toBe(hashAll(on))
  }, 900_000)

  it('has chronicle words for every absentee event', () => {
    for (const e of on.events) {
      const t = e.type as number
      if (t < 185 || t > 187) continue
      const s = describeAbsenteeEvent(on, e)
      expect(s).toBeTruthy()
      expect(s).not.toMatch(/undefined|NaN/)
    }
    expect(describeAbsenteeEvent(on, { year: 900, type: EventType.CouncilRuled, settlement: -1, other: -1, value: -1, extra: 4 })).toMatch(/governed .* in his name/)
  })

  it('epithets from the facts: the Captive, the Absent, the Idle, the Old', () => {
    const f = (absent: number, captive = false): ReignFacts => ({ r: 0, years: 10, founded: false, usurped: false, claimed: false, regency: 0, works: [], won: 0, lost: 0, ended: true, end: 1, traits: [], female: false, betrayals: 0, bondage: 0, rash: false, fox: false, absent, captive })
    expect(rulerEpithet(f(0, true))).toBe('the Captive')
    expect(rulerEpithet(f(DeferenceCause.Absent))).toBe('the Absent')
    expect(rulerEpithet(f(DeferenceCause.Union))).toBe('the Absent')
    expect(rulerEpithet(f(DeferenceCause.Indolent))).toBe('the Idle')
    expect(rulerEpithet(f(DeferenceCause.Infirm))).toBe('the Old')
  })
})
