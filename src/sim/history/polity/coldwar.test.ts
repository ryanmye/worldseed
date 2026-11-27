// cold wars (barriers-coldwar.md §3): the table, its events, aid and grievances, the stream, the CB and C7 stacks, off identity.
//
// With HistoryOptions.coldWars false (the default) G0 (scripts/g0.ts: hashBase on seeds 1, 42, 1234 at 2000 years) is unchanged.

import { describe, expect, it } from 'vitest'
import { ColdWarEnd, CrisisOutcome, EventType, GrievanceKind } from '../../../contract.ts'
import type { History, HistoryOptions } from '../../../contract.ts'
import { generateWorld, simulateHistory } from '../../index.ts'
import { logStreams } from '../../rng.ts'
import { cbBattleX, c7Alliance } from '../compose.ts'
import { withoutLater } from '../laterFields.ts'

const FULL: HistoryOptions = { oaths: true, balance: true, arms: true, finance: true, beliefs: true }
const worlds = new Map<number, ReturnType<typeof generateWorld>>()
const world = (seed: number) => { let w = worlds.get(seed); if (!w) { w = generateWorld(seed); worlds.set(seed, w) } return w }

/** Checks the cold-war table against the polities, wars and events. */
function check(h: History): { cw: number; proxies: number; crises: number } {
  const C = h.coldWars, P = h.polities.length
  for (const a of [C.a, C.b, C.start, C.end, C.endCause, C.war, C.ideological, C.proxies, C.crises, C.defections, C.peak, C.peakYear]) expect(a.length).toBe(C.count)
  expect(C.kappaOff.length).toBe(C.count + 1)
  const ev = (t: number) => h.events.filter((e) => e.type === t)
  const began = ev(EventType.ColdWarBegan), ended = ev(EventType.ColdWarEnded), prox = ev(EventType.ProxyWar), cri = ev(EventType.Crisis), def = ev(EventType.ClientDefected)
  expect(began.length).toBe(C.count)
  let proxies = 0, crises = 0, defections = 0, closed = 0
  for (let i = 0; i < C.count; i++) {
    expect(C.a[i]).not.toBe(C.b[i])
    expect(C.a[i]).toBeLessThan(P); expect(C.b[i]).toBeLessThan(P)
    expect(began[i].value).toBe(i)
    expect(began[i].year).toBe(C.start[i])
    expect(C.peakYear[i]).toBeGreaterThanOrEqual(C.start[i])
    expect(C.kappaOff[i + 1]).toBeGreaterThanOrEqual(C.kappaOff[i] + 1)
    if (C.end[i] >= 0) {
      closed++
      expect(C.end[i]).toBeGreaterThanOrEqual(C.start[i])
      expect(C.endCause[i]).toBeLessThanOrEqual(ColdWarEnd.Ended)
      const e = ended.find((x) => x.value === i)!
      expect(e.extra).toBe(C.endCause[i])
      if (C.endCause[i] === ColdWarEnd.HotWar) {
        const w = C.war[i]
        expect(w).toBeGreaterThanOrEqual(0)
        const pq = [h.wars.attacker[w], h.wars.defender[w]].sort().join()
        expect(pq).toBe([C.a[i], C.b[i]].sort().join())
        expect(h.wars.startYear[w]).toBe(C.end[i])
      } else expect(C.war[i]).toBe(-1)
    }
    // the pair never at war while it lasts
    const en = C.end[i] >= 0 ? C.end[i] : h.years + 1
    for (let w = 0; w < h.wars.count; w++) {
      const p = h.wars.attacker[w], q = h.wars.defender[w]
      if (!((p === C.a[i] && q === C.b[i]) || (p === C.b[i] && q === C.a[i]))) continue
      if (h.wars.startYear[w] > C.start[i] && h.wars.startYear[w] < en) throw new Error(`war ${w} inside cold war ${i}`)
    }
    proxies += C.proxies[i]; crises += C.crises[i]; defections += C.defections[i]
  }
  expect(ended.length).toBe(closed)
  expect(prox.length).toBe(proxies)
  expect(cri.length).toBe(crises)
  expect(def.length).toBe(defections)
  for (const e of prox) {
    const i = e.extra!
    expect(i).toBeLessThan(C.count)
    const w = e.value
    // the sponsor is a principal that does not fight the war
    expect(h.wars.startYear[w]).toBeLessThanOrEqual(e.year)
    expect(e.year).toBeGreaterThanOrEqual(C.start[i])
  }
  for (const e of cri) expect(e.extra).toBeLessThanOrEqual(CrisisOutcome.Escalated)
  return { cw: C.count, proxies, crises }
}

describe('cold wars', () => {
  it('off: no table, no events, no stream', () => {
    const log: string[] = []
    logStreams(log)
    let h: History
    try { h = simulateHistory(world(1), { years: 600, ...FULL }) } finally { logStreams(null) }
    expect(h!.coldWars.count).toBe(0)
    expect(h!.events.some((e) => e.type >= 393 && e.type <= 398)).toBe(false)
    expect(log.includes('history-coldwar')).toBe(false)
  }, 600_000)

  it('on with grudges, finances and beliefs: valid table, events, aid, grievances; one stream; deterministic', () => {
    const log: string[] = []
    logStreams(log)
    let h: History
    try { h = simulateHistory(world(1), { years: 2000, ...FULL, coldWars: true }) } finally { logStreams(null) }
    expect(log.filter((x) => x === 'history-coldwar').length).toBe(1)
    const r = check(h!)
    expect(r.cw).toBeGreaterThan(0)
    expect(r.crises).toBeGreaterThan(0)
    // every ProxyAid grievance has its ProxyWar
    const g = h!.grievances
    let pa = 0
    for (let i = 0; i < g.count; i++) if (g.kind[i] === GrievanceKind.ProxyAid) { pa++; expect(g.war[i]).toBeGreaterThanOrEqual(0) }
    expect(pa).toBeLessThanOrEqual(r.proxies)
    const h2 = simulateHistory(world(1), { years: 2000, ...FULL, coldWars: true })
    expect(h2.coldWars.count).toBe(h!.coldWars.count)
    expect(Array.from(h2.coldWars.kappa)).toEqual(Array.from(h!.coldWars.kappa))
    expect(h2.events.length).toBe(h!.events.length)
  }, 900_000)

  it('on alone (no grudges, finances or beliefs): valid', () => {
    check(simulateHistory(world(42), { years: 2000, coldWars: true }))
  }, 600_000)

  it('explicit false equals the default', () => {
    const a = simulateHistory(world(7), { years: 400 }), b = simulateHistory(world(7), { years: 400, coldWars: false })
    expect(b.events.length).toBe(a.events.length)
    expect(Object.keys(withoutLater(b)).sort()).toEqual(Object.keys(withoutLater(a)).sort())
    expect(Array.from(b.population)).toEqual(Array.from(a.population))
  }, 600_000)

  it('stacks: CB is r*r without factors and clamps M_aid; C7 sphere multiplies within the clamp', () => {
    expect(cbBattleX(1.3)).toBe(1.3 * 1.3)
    expect(cbBattleX(1.3, {})).toBe(1.3 * 1.3)
    expect(cbBattleX(2, { aid: 1.25 })).toBeCloseTo(5, 12)
    expect(cbBattleX(1, { aid: 100 })).toBe(4)
    expect(c7Alliance(0.1, 1, { sphere: 1.5 })).toBeCloseTo(0.15, 12)
    expect(c7Alliance(0.1, 1, { sphere: 1.5, reputation: 0.5 })).toBeCloseTo(0.075, 12)
    expect(c7Alliance(0.1, 1, { sphere: 1.5, balance: 10 })).toBeCloseTo(0.4, 12)
  })
})
