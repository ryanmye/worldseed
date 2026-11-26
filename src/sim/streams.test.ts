// The stream-list test (MASTER-PLAN §3.4, §4.2): the RNG streams a run creates with every new option off must equal the
// 8cabf09 list. Each fixed-name stream is created exactly once per run (a second createRng of the same name would replay
// the same numbers); per-id streams (`names-<family>-...`, `landmarks-faith-<id>`) only from the 8cabf09 families.
// A plan that adds a stream creates it only when its option is on, so this list never changes; the plan's own test
// lists its streams with the option on.
import { describe, expect, it } from 'vitest'
import { generateWorld, simulateHistory } from './index.ts'
import { logStreams } from './rng.ts'
import { OrderKind } from '../contract.ts'

/** generateWorld's streams at 8cabf09, each once. */
const WORLD_STREAMS = ['climate', 'elevation', 'plates', 'world']

/** simulateHistory's fixed-name streams at 8cabf09 (default options, no orders), each once. */
const HISTORY_STREAMS = [
  'history-cradles', 'history-disease', 'history-disease-pool', 'history-expeditions', 'history-frontier', 'history-goods',
  'history-ideas', 'history-landmarks', 'history-migration', 'history-ore', 'history-polities', 'history-religion',
  'history-renaming', 'history-rulers', 'history-species-hazard', 'history-species-origins', 'history-species-spread',
  'history-species-techniques', 'history-structures', 'history-tourism', 'history-tourism-springs', 'history-voyages',
  'history-war', 'history-weather', 'names-draw',
]

/** Per-id stream families at 8cabf09 (`names-<family>-<...>`; `landmarks-faith-<faith id>`). */
const NAME_FAMILIES = [
  'cityaffix', 'disease', 'faith', 'faithaffix', 'feature', 'fem', 'fluent', 'geo', 'house', 'houseaffix', 'landmark', 'lang',
  'people', 'place', 'placequal', 'polaffix', 'polity', 'rename', 'ruler', 'shift', 'species', 'technique',
]

function split(log: string[]): { fixed: Map<string, number>; families: Set<string>; other: string[] } {
  const fixed = new Map<string, number>()
  const families = new Set<string>()
  const other: string[] = []
  for (const x of log) {
    const m = /^names-([a-z]+)-/.exec(x)
    if (m) families.add(m[1])
    else if (/^landmarks-faith-\d+$/.test(x)) families.add('landmarks-faith')
    else if (/^[a-z]+(-[a-z]+)*$/.test(x)) fixed.set(x, (fixed.get(x) ?? 0) + 1)
    else other.push(x)
  }
  return { fixed, families, other }
}

function streamsOf(run: () => void): string[] {
  const log: string[] = []
  logStreams(log)
  try { run() } finally { logStreams(null) }
  return log
}

describe('RNG streams', () => {
  it('generateWorld creates the 8cabf09 streams, each once', () => {
    expect(streamsOf(() => generateWorld(7)).slice().sort()).toEqual(WORLD_STREAMS)
  })

  it('simulateHistory with default options creates the 8cabf09 streams: each fixed name once, per-id streams from known families', () => {
    const w = generateWorld(1)
    const { fixed, families, other } = split(streamsOf(() => simulateHistory(w, { years: 600 })))
    expect(other).toEqual([])
    expect([...fixed.keys()].sort()).toEqual(HISTORY_STREAMS)
    for (const [name, n] of fixed) expect(n, name).toBe(1)
    for (const f of families) expect([...NAME_FAMILIES, 'landmarks-faith'], f).toContain(f)
  }, 120_000)

  it('orders add exactly history-orders, once', () => {
    const w = generateWorld(1)
    const { fixed } = split(streamsOf(() => simulateHistory(w, { years: 60, orders: [{ year: 30, kind: OrderKind.Explore, actor: 0, target: 0 }] })))
    expect([...fixed.keys()].sort()).toEqual([...HISTORY_STREAMS, 'history-orders'].sort())
    for (const [name, n] of fixed) expect(n, name).toBe(1)
  }, 120_000)
})
