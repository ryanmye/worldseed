// seat-mode step 4: the seat's contract (encodeSeat / decodeSeat, the decision table).
import { describe, expect, it } from 'vitest'
import { DecisionKind, SeatKind, decodeSeat, describeDecisionKinds, encodeSeat } from '../../../contract.ts'
import type { SeatOptions } from '../../../contract.ts'

describe('seat contract', () => {
  it('encodes and decodes seats', () => {
    const cases: SeatOptions[] = [
      { kind: SeatKind.Polity, id: 12, from: 800 },
      { kind: SeatKind.House, id: 3, from: 1180, ambitions: [0, 1] },
      { kind: SeatKind.People, id: 0, from: 0, ambitions: [5] },
    ]
    for (const c of cases) expect(decodeSeat(encodeSeat(c))).toEqual(c)
    expect(encodeSeat(cases[1])).toBe('house:3:1180:amb=0.1')
    expect(/^[0-9a-z:.=]*$/.test(encodeSeat(cases[1]))).toBe(true)
    for (const bad of ['', 'polity:1', 'king:1:2', 'polity:x:2', 'polity:1:2.5', 'polity:-1:3', 'family:1:2', 'polity:1:2:foo']) expect(decodeSeat(bad)).toBeNull()
    expect(decodeSeat('polity:1:2:amb=1.1.99.x')).toEqual({ kind: SeatKind.Polity, id: 1, from: 2, ambitions: [1] })
  })
  it('has a live row with a unique key for every seat DecisionKind', () => {
    const D = describeDecisionKinds()
    const keys = Object.values(DecisionKind).map((k) => D[k].key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of Object.values(DecisionKind)) expect(D[k].label.length).toBeGreaterThan(0)
  })
})
