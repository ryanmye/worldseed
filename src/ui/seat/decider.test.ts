// seat: who decides when the player lets a matter be (decider.ts): each case reachable on main today, on hand-made Histories.
import { describe, expect, it } from 'vitest'
import { PolityOrigin, SeatKind } from '../../contract.ts'
import type { History, SeatOptions } from '../../contract.ts'
import { DECIDER, deciderButton, deciderName } from './decider.ts'

/** A History of one polity (0) over `towns` towns of `pop` people each, plus one outside town of 100 people. */
function fake(opt: { towns: number; pop: number; origin?: number; dynasty?: number; regency?: boolean; born?: number }): History {
  const N = opt.towns + 1
  const settlements = Array.from({ length: N }, (_, i) => ({ id: i, outpost: false, people: 0 }))
  const population = new Float32Array(N).map((_, i) => (i < opt.towns ? opt.pop : 100))
  const polity = new Int32Array(N).map((_, i) => (i < opt.towns ? 0 : -1))
  return {
    settlements, population, polity, snapshotCount: 1, snapshotInterval: 1000,
    polities: [{ id: 0, name: 'Vashtar', qualifier: 0, origin: opt.origin ?? PolityOrigin.Formed }],
    rulers: [{ id: 0, polity: 0, acceded: 400, ended: -1, dynasty: opt.dynasty ?? 3, born: opt.born ?? (opt.regency ? 490 : 350) }],
    events: opt.regency ? [{ year: 495, type: 84, settlement: 0, other: -1, value: 0, extra: 12 }] : [],
  } as unknown as History
}
const polity: SeatOptions = { kind: SeatKind.Polity, id: 0, from: 450 }

describe('deciderName', () => {
  it('a House seat: the family; a People without a realm: the elders', () => {
    expect(deciderName(fake({ towns: 8, pop: 5000 }), { kind: SeatKind.House, id: 3, from: 450 }, 500)).toBe(DECIDER.family)
    expect(deciderName(fake({ towns: 8, pop: 5000 }), { kind: SeatKind.People, id: 0, from: 450 }, 500)).toBe(DECIDER.elders)
  })
  it('a chiefdom: the elders; a kingdom: your court', () => {
    expect(deciderName(fake({ towns: 2, pop: 300 }), polity, 500)).toBe(DECIDER.elders)
    expect(deciderName(fake({ towns: 8, pop: 5000 }), polity, 500)).toBe(DECIDER.court)
    expect(deciderButton(fake({ towns: 8, pop: 5000 }), polity, 500)).toBe('Do nothing — let your court decide')
  })
  it('a league (or an elected head): the league’s council; a regency: the regent’s council', () => {
    expect(deciderName(fake({ towns: 8, pop: 5000, origin: PolityOrigin.League }), polity, 500)).toBe(DECIDER.league)
    expect(deciderName(fake({ towns: 8, pop: 5000, dynasty: -1 }), polity, 500)).toBe(DECIDER.league)
    expect(deciderName(fake({ towns: 8, pop: 5000, regency: true }), polity, 500)).toBe(DECIDER.regency)
    expect(deciderName(fake({ towns: 8, pop: 5000, regency: true }), polity, 520)).toBe(DECIDER.court) // (the regency over)
    // lane N3: a Regency record never makes an adult ruler's body "the regent's council" (EVALUATION §1c)
    expect(deciderName(fake({ towns: 8, pop: 5000, regency: true, born: 450 }), polity, 500)).toBe(DECIDER.court)
  })
})
