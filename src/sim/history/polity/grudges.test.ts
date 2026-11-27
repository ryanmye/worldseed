// grudges and oaths, balance of threat, arms races (grudges-and-oaths.md): tables, invariants and off-switch identity.
//
// With HistoryOptions.oaths, balance and arms all false (the defaults) the tree was checked identical to main e95fa77 on every
// 8cabf09 History field (G0, scripts/g0.ts: hashBase on seeds 1, 42, 1234 at 2000 years).

import { describe, expect, it } from 'vitest'
import { BondEnd, BondKind, EventType, GrievanceKind } from '../../../contract.ts'
import type { History, HistoryOptions } from '../../../contract.ts'
import { generateWorld, simulateHistory } from '../../index.ts'
import { logStreams } from '../../rng.ts'
import { ALIGN, ARMS, OATH, POLITY, WAR } from './params.ts'

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
    expect(g.kind[i]).toBeLessThanOrEqual(GrievanceKind.GeneralTurned)
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

/** Checks the oath events against the wars, bonds, grievances and faithless scores. */
function checkOaths(h: History): { truces: number; allies: number; betrayals: number } {
  const W = h.wars, B = h.bonds, g = h.grievances, P = h.polities.length
  const declared = new Map<number, number>()
  for (const e of h.events) if (e.type === EventType.WarDeclared) declared.set(e.value, e.year)
  const betrayedIn = (x: number, y: number, year: number) => {
    for (let k = 0; k < B.count; k++) if (B.kind[k] === BondKind.Alliance && B.end[k] === BondEnd.Betrayed && B.endYear[k] === year && ((B.a[k] === x && B.b[k] === y) || (B.a[k] === y && B.b[k] === x))) return true
    return false
  }
  const rowFor = (kind: number, wronged: number, offender: number, year: number) => {
    for (let i = 0; i < g.count; i++) if (g.kind[i] === kind && (g.wronged[i] === wronged || g.offender[i] === offender) && g.year[i] === year) return true // (one side may since have been absorbed: its rows re-pointed)
    return false
  }
  let truces = 0, allies = 0, betrayals = 0
  for (const e of h.events) {
    if (e.type === EventType.OathBroken) {
      const w = e.value
      expect(declared.get(w)).toBe(e.year)
      const p = W.attacker[w], q = W.defender[w]
      if (e.extra === 0) {
        truces++
        // the previous war between the two ended less than WAR.truce years before
        let last = -1
        for (let v = 0; v < w; v++) if (((W.attacker[v] === p && W.defender[v] === q) || (W.attacker[v] === q && W.defender[v] === p)) && W.endYear[v] >= 0 && W.endYear[v] <= e.year) last = Math.max(last, W.endYear[v])
        expect(last).toBeGreaterThanOrEqual(0)
        expect(e.year - last).toBeLessThan(WAR.truce)
        expect(rowFor(GrievanceKind.TruceBroken, q, p, e.year), `truce row ${e.year} ${p}->${q}`).toBe(true)
      } else {
        allies++
        expect(betrayedIn(p, q, e.year), `ally attack ${e.year} ${p}->${q}`).toBe(true)
        expect(rowFor(GrievanceKind.AllyBetrayed, q, p, e.year), `ally row ${e.year}`).toBe(true)
      }
      const sn = Math.ceil(e.year / h.snapshotInterval)
      if (sn < h.snapshotCount && h.polities[p].endedYear < 0) expect(h.faithless[sn * P + p]).toBeGreaterThan(0)
    } else if (e.type === EventType.Betrayal) {
      betrayals++
      const w = e.value
      const x = W.attacker[w]
      expect(W.endYear[w]).toBe(e.year)
      expect(W.ally[w]).toBeGreaterThanOrEqual(0)
      expect(W.ally[w]).toBeLessThan(w)
      const q = W.defender[W.ally[w]]
      expect(betrayedIn(x, q, e.year), `betrayal bond ${e.year}`).toBe(true)
      expect(rowFor(GrievanceKind.AllyBetrayed, q, x, e.year), `betrayal row ${e.year}`).toBe(true)
      if (e.extra === 1) {
        let found = false
        for (let v = w + 1; v < W.count; v++) if (W.attacker[v] === x && W.defender[v] === q && W.startYear[v] === e.year) found = true
        expect(found, `turned war ${e.year}`).toBe(true)
      }
    }
  }
  // Wars.ally: the joined war's defender is the one the ally came to help (the joiner attacks the attacker).
  for (let w = 0; w < W.count; w++) {
    const j = W.ally[w]
    if (j < 0) continue
    expect(j).toBeLessThan(w)
    expect(W.defender[w]).toBe(W.attacker[j])
    expect(W.startYear[w]).toBe(W.startYear[j])
  }
  return { truces, allies, betrayals }
}

/** Bandwagons, alliance caps, arms races and Wars.race against the events and wars. */
function checkBalanceArms(h: History): { bandwagons: number; races: number } {
  const ev = h.events
  let bandwagons = 0
  for (let k = 0; k < ev.length; k++) {
    const e = ev[k]
    if (e.type !== EventType.Bandwagon) continue
    bandwagons++
    const next = ev.slice(k + 1).find((f) => f.year === e.year && (f.type === EventType.Alliance || f.type === EventType.BecameVassal))
    expect(next).toBeDefined()
    if (e.extra === 0) expect(next!.type).toBe(EventType.Alliance)
    else { expect(next!.type).toBe(EventType.BecameVassal); expect(next!.value).toBeGreaterThanOrEqual(1000) }
  }
  // no polity holds more than ALIGN.maxAlliances alliances at once
  const B = h.bonds
  for (let y = 0; y <= h.years; y += 50) {
    const n = new Map<number, number>()
    for (let k = 0; k < B.count; k++) if (B.kind[k] === BondKind.Alliance && B.startYear[k] <= y && (B.endYear[k] < 0 || B.endYear[k] > y)) for (const p of [B.a[k], B.b[k]]) n.set(p, (n.get(p) ?? 0) + 1)
    for (const v of n.values()) expect(v).toBeLessThanOrEqual(ALIGN.maxAlliances)
  }
  const R = h.armsRaces, W = h.wars
  for (let i = 0; i < R.count; i++) {
    expect(R.levelOff[i + 1] - R.levelOff[i]).toBeGreaterThanOrEqual(1)
    if (R.end[i] >= 0) {
      expect(R.end[i]).toBeGreaterThanOrEqual(R.start[i])
      // one level per slow step of the race (the closing step adds none)
      expect(R.levelOff[i + 1] - R.levelOff[i]).toBeLessThanOrEqual((R.end[i] - R.start[i]) / POLITY.slowStep + 1)
    }
    if (R.endCause[i] === 1) {
      const w = R.war[i]
      expect(w).toBeGreaterThanOrEqual(0)
      expect(W.startYear[w]).toBe(R.end[i])
      const pair = [W.attacker[w], W.defender[w]].sort((a, b) => a - b)
      expect(pair).toEqual([R.a[i], R.b[i]])
    }
  }
  for (const e of ev) if (e.type === EventType.ArmsRace && e.extra === 1) expect(ev.some((f) => f.type === EventType.WarDeclared && f.year === e.year && f.value === R.war[e.value])).toBe(true)
  for (let w = 0; w < W.count; w++) if (W.race[w] >= 0) expect(R.start[W.race[w]]).toBeLessThanOrEqual(W.startYear[w])
  return { bandwagons, races: R.count }
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

  it('arms: a 2 x 2 Richardson system converges monotonically to its closed form', () => {
    const dt = POLITY.slowStep / ARMS.substeps
    const ka = ARMS.k * 1.5, kb = ARMS.k * 0.5, fa = ARMS.a * 1.3, fb = ARMS.a, ga = 0.01, gb = 0.004
    const xs = (ga * fb + ka * gb) / (fa * fb - ka * kb), ys = (gb * fa + kb * ga) / (fa * fb - ka * kb)
    for (const [x0, y0] of [[0, 0], [1, 1], [0, 1], [0.9, 0.1]]) {
      let x = x0, y = y0, dprev = Infinity
      for (let k = 0; k < 400; k++) {
        const dx = ka * y - fa * x + ga, dy = kb * x - fb * y + gb
        x += dt * dx; y += dt * dy
        const d = Math.abs(x - xs) + Math.abs(y - ys)
        expect(d).toBeLessThanOrEqual(dprev + 1e-15)
        dprev = d
      }
      expect(Math.abs(x - xs)).toBeLessThan(1e-6)
      expect(Math.abs(y - ys)).toBeLessThan(1e-6)
    }
  })

  it('every on/off combination runs, with the tables in shape', () => {
    for (let m = 1; m < 8; m++) {
      const o = { years: 300, oaths: (m & 1) !== 0, balance: (m & 2) !== 0, arms: (m & 4) !== 0 }
      const h = simulateHistory(world(3), o)
      expect(h.faithless.length).toBe(h.snapshotCount * h.polities.length)
      expect(h.wars.cause.length).toBe(h.wars.count)
      if (!o.oaths) expect(h.grievances.count).toBe(0)
      if (!o.arms) expect(h.armsRaces.count).toBe(0)
    }
  }, 600_000)

  it('balance and arms: bandwagons, alliance caps, races and their wars agree', () => {
    let races = 0
    for (const seed of [42, 1]) races += checkBalanceArms(run(seed, { years: 2000, ...ALL })).races
    expect(races).toBeGreaterThan(0)
    checkGrievances(run(42, { years: 2000, ...ALL }))
    checkOaths(run(42, { years: 2000, ...ALL }))
  }, 900_000)

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

  it('broken oaths and betrayals agree with the wars, bonds, grievances and faithless scores', () => {
    let truces = 0, betrayals = 0
    for (const seed of [42, 1]) {
      const r = checkOaths(run(seed, { years: 2000, oaths: true }))
      truces += r.truces; betrayals += r.betrayals
    }
    expect(truces).toBeGreaterThan(0)
    expect(betrayals).toBeGreaterThan(0)
  }, 900_000)
})
