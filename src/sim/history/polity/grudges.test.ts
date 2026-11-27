// grudges and oaths, balance of threat, arms races (grudges-and-oaths.md): tables, invariants and off-switch identity.
//
// With HistoryOptions.oaths, balance and arms all false (the defaults) the tree was checked identical to main e95fa77 on every
// 8cabf09 History field (G0, scripts/g0.ts: hashBase on seeds 1, 42, 1234 at 2000 years).

import { describe, expect, it } from 'vitest'
import { EventType, GrievanceKind } from '../../../contract.ts'
import type { History, HistoryOptions } from '../../../contract.ts'
import { generateWorld, simulateHistory } from '../../index.ts'
import { logStreams } from '../../rng.ts'
import { ARMS, OATH, POLITY } from './params.ts'

const worlds = new Map<number, ReturnType<typeof generateWorld>>()
const world = (seed: number) => { let w = worlds.get(seed); if (!w) { w = generateWorld(seed); worlds.set(seed, w) } return w }
const runs = new Map<string, History>()
function run(seed: number, o: HistoryOptions): History {
  const k = seed + JSON.stringify(o)
  let h = runs.get(k)
  if (!h) { h = simulateHistory(world(seed), o); runs.set(k, h) }
  return h
}
const ALL: HistoryOptions = { oaths: true, balance: true, arms: true }

/** Checks the grievance table against the polities, wars and events. */
function checkGrievances(h: History): void {
  const g = h.grievances
  for (const a of [g.kind, g.wronged, g.offender, g.year, g.weight, g.endYear, g.endCause, g.settlement, g.war, g.towns, g.heir]) expect(a.length).toBe(g.count)
  const P = h.polities.length
  for (let i = 0; i < g.count; i++) {
    expect(g.wronged[i]).not.toBe(g.offender[i])
    expect(g.wronged[i]).toBeGreaterThanOrEqual(0); expect(g.wronged[i]).toBeLessThan(P)
    expect(g.offender[i]).toBeGreaterThanOrEqual(0); expect(g.offender[i]).toBeLessThan(P)
    expect(g.kind[i]).toBeLessThanOrEqual(GrievanceKind.CrownDefault)
    expect(g.weight[i]).toBeGreaterThan(0)
    if (g.endYear[i] >= 0) expect(g.endYear[i]).toBeGreaterThanOrEqual(g.year[i])
    if (g.war[i] >= 0) expect(g.war[i]).toBeLessThan(h.wars.count)
    if (g.settlement[i] >= 0) expect(g.settlement[i]).toBeLessThan(h.settlements.length)
    if (g.heir[i] >= 0) {
      const j = g.heir[i]
      expect(j).toBeLessThan(i)
      // An heir row takes up at most OATH.inherit of the parent row's weight (which only fades).
      expect(g.weight[i]).toBeLessThanOrEqual(OATH.inherit * g.weight[j] + 1e-4)
      expect(g.year[i]).toBeGreaterThanOrEqual(g.year[j])
    }
  }
  // Every sack of a town held by another polity's people has its row (wars of the polities).
  const sacks = h.events.filter((e) => e.type === EventType.Sacked)
  const rows = new Set<string>()
  for (let i = 0; i < g.count; i++) if (g.kind[i] === GrievanceKind.TownSacked) rows.add(g.settlement[i] + ':' + g.year[i])
  for (const e of sacks) expect(rows.has(e.settlement + ':' + e.year) || !h.polities.length).toBe(true)
}

describe('grudges and oaths', () => {
  it('the constants match their closed forms; arms are stable and monotone', () => {
    expect(Math.abs(OATH.keep - 0.5 ** (POLITY.slowStep / OATH.halfLife))).toBeLessThan(1e-12)
    expect(Math.abs(OATH.repKeep - 0.5 ** (POLITY.slowStep / OATH.repHalfLife))).toBeLessThan(1e-12)
    expect(ARMS.k * 1.5 * ARMS.k * 1.5).toBeLessThan(ARMS.a * ARMS.a)
    expect((POLITY.slowStep / ARMS.substeps) * (ARMS.a * (1 + ARMS.fatigue) + 1.5 * ARMS.k)).toBeLessThan(1)
  })

  it('off: empty tables, wars without causes, no new events or streams', () => {
    const h = run(42, { years: 600 })
    expect(h.grievances.count).toBe(0)
    expect(h.armsRaces.count).toBe(0)
    expect(h.faithless.length).toBe(h.snapshotCount * h.polities.length)
    expect(h.arms.length).toBe(h.snapshotCount * h.polities.length)
    expect(h.faithless.every((x) => x === 0)).toBe(true)
    expect(h.wars.cause.length).toBe(h.wars.count)
    expect(h.wars.cause.every((x) => x === -1) && h.wars.ally.every((x) => x === -1) && h.wars.race.every((x) => x === -1)).toBe(true)
    expect(h.events.some((e) => e.type >= 190 && e.type <= 199)).toBe(false)
  }, 300_000)

  it('on: the streams are history-oaths and history-align, each once', () => {
    const log: string[] = []
    logStreams(log)
    try { simulateHistory(world(1), { years: 300, ...ALL }) } finally { logStreams(null) }
    expect(log.filter((x) => x === 'history-oaths').length).toBe(1)
    expect(log.filter((x) => x === 'history-align').length).toBe(1)
  }, 300_000)

  it('grievances are valid rows: wronged and offender polities, weights, wars, inheritance, sacks', () => {
    const h = run(42, { years: 2000, oaths: true })
    expect(h.grievances.count).toBeGreaterThan(50)
    checkGrievances(h)
    // Revenge wars: the cause is a grievance of the attacker against the defender, recorded before the war.
    let revenge = 0
    for (let w = 0; w < h.wars.count; w++) {
      const c = h.wars.cause[w]
      if (c < 0) continue
      revenge++
      expect(h.grievances.wronged[c]).toBe(h.wars.attacker[w])
      expect(h.grievances.offender[c]).toBe(h.wars.defender[w])
      expect(h.grievances.year[c]).toBeLessThanOrEqual(h.wars.startYear[w])
    }
    expect(revenge).toBeGreaterThan(0)
  }, 600_000)
})
