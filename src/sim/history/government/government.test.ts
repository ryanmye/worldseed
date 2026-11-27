// governments: forms of government and city-states (city-states.md §8 steps 1-8). One long run per case is shared by the
// tests of a describe.
import { describe, expect, it } from 'vitest'
import { generateWorld } from '../../index.ts'
import { simulateHistory } from '../index.ts'
import { EventType } from '../../../contract.ts'
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
