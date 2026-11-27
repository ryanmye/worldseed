// Registry tests (MASTER-PLAN §3, §4.2): EventType names and ids are unique. A duplicate key in the EventType literal is a
// tsc error, but a duplicate *id* is not, and a name repeated in another block (R4b RegimeChanged, R4c Concession) only
// shows up as one entry silently replacing the other; this test reads the source too, so neither can slip through.
import { describe, expect, it } from 'vitest'
import contractSource from './contract.ts?raw'
import {
  DECISION_KIND_COUNT, EventType, ORDER_KIND_COUNT, OrderKind, decodeOrders, describeDecisionKinds, describeOrderKinds, encodeOrders, orderKindReserved,
  type Order,
} from './contract.ts'

function literalKeys(src: string, name: string): string[] {
  const start = src.indexOf(`export const ${name} = {`)
  if (start < 0) throw new Error(`${name} not found`)
  const end = src.indexOf('} as const', start)
  const body = src.slice(start, end)
  return [...body.matchAll(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1])
}

describe('EventType registry', () => {
  it('every EventType name appears once in the source literal', () => {
    const keys = literalKeys(contractSource, 'EventType')
    const seen = new Set<string>()
    const dup = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)))
    expect(dup).toEqual([])
    expect(keys.slice().sort()).toEqual(Object.keys(EventType).sort())
  })

  it('every EventType id is used by one name only, and ids are non-negative integers', () => {
    const byId = new Map<number, string[]>()
    for (const [k, v] of Object.entries(EventType)) {
      expect(Number.isInteger(v) && v >= 0, k).toBe(true)
      byId.set(v, [...(byId.get(v) ?? []), k])
    }
    expect([...byId.values()].filter((names) => names.length > 1)).toEqual([])
  })
})

describe('reserved order and decision rows (R40)', () => {
  it('ORDER_KINDS is contiguous 0..83: 0–20 and 22 live, 21 and 23–83 reserved placeholders with no encode key', () => {
    const K = describeOrderKinds()
    expect(K.length).toBe(ORDER_KIND_COUNT)
    expect(ORDER_KIND_COUNT).toBe(84)
    K.forEach((k, i) => expect(k.kind).toBe(i))
    expect(K.filter((k) => !k.reserved).map((k) => k.kind)).toEqual(Object.values(OrderKind))
    for (const k of K.filter((x) => x.reserved)) {
      expect(k.key).toBe('')
      expect(k.years).toBe(0)
      expect(orderKindReserved(k.kind)).toBe(true)
      expect(k.reservedFor?.length).toBeGreaterThan(0)
    }
    // registry spot checks (§3.2)
    expect(K[10].key).toBe('choice') // (seat-mode step 3: live)
    expect(K[11].key).toBe('renounce') // (seat-mode steps 8, 9, 13: live)
    expect(K[22].key).toBe('betray')
    expect(K[21].reservedFor).toBe('seat-mode: Charter') // (until city-states lands)
    expect(K[30].reservedFor).toBe('riots: Crackdown')
    expect(K[41].reservedFor).toBe('character-mode: PChoice')
    expect(K[59].reservedFor).toBe('migration: Gates')
    expect(K[62].reservedFor).toBe('modern-ideologies: Franchise')
    expect(K[68].reservedFor).toBe('infrastructure: BuildLine')
    expect(K[71].reservedFor).toBe('world-builder-divine: Portent')
    expect(K[82].reservedFor).toBe('world-builder-divine: Curse')
    expect(K[83].reservedFor).toBe('religious-evolution: Council')
  })

  it('a reserved kind never encodes to a key, never decodes, and is SystemOff', () => {
    const o: Order = { year: 10, kind: 30 as Order['kind'], actor: 1, target: 2 }
    expect(encodeOrders([o])).toBe('10:30:1:2')
    expect(decodeOrders('10:30:1:2')).toEqual([])
    expect(decodeOrders('10::1:2')).toEqual([])
  })

  it('DecisionKind table is contiguous 0..54: 0–17 seat-mode (live), the rest reserved', () => {
    const D = describeDecisionKinds()
    expect(D.length).toBe(DECISION_KIND_COUNT)
    expect(DECISION_KIND_COUNT).toBe(55)
    D.forEach((d, i) => { expect(d.kind).toBe(i); if (i < 18) { expect(d.reserved).toBeUndefined(); expect(d.key.length).toBeGreaterThan(0) } else { expect(d.reserved).toBe(true); expect(d.reservedFor?.length).toBeGreaterThan(0) } })
    expect(D[0].key).toBe('warOnUs')
    expect(D[17].key).toBe('idea')
    expect(D[18].reservedFor).toBe('court-politics: Estates')
    expect(D[25].reservedFor).toBe('tech-tree: BanIdea')
    expect(D[45].reservedFor).toBe('migration: Borders')
    expect(D[47].reservedFor).toBe('modern-ideologies: Franchise')
    expect(D[50].reservedFor).toBe('future-politics: Mandate')
    expect(D[53].reservedFor).toBe('infrastructure: Infrastructure')
    expect(D[54].reservedFor).toBe('religious-evolution: Doctrine')
  })
})
