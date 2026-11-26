// Registry tests (MASTER-PLAN §3, §4.2): EventType names and ids are unique. A duplicate key in the EventType literal is a
// tsc error, but a duplicate *id* is not, and a name repeated in another block (R4b RegimeChanged, R4c Concession) only
// shows up as one entry silently replacing the other; this test reads the source too, so neither can slip through.
import { describe, expect, it } from 'vitest'
import contractSource from './contract.ts?raw'
import { EventType } from './contract.ts'

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
