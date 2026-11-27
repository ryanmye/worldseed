// society: classes, elites and the secular cycle (society-secular-cycles.md): tables, invariants, events, shadow mode, hooks.
//
// With HistoryOptions.society false (the default) the tree is identical to main on every 8cabf09 History field (G0,
// scripts/g0.ts on seeds 1, 42, 1234 at 2000 years); with SOC.effects false (shadow mode) society on equals off there too.

import { describe, expect, it } from 'vitest'
import { EventType, SecularPhase } from '../../../contract.ts'
import type { History, HistoryOptions } from '../../../contract.ts'
import { generateWorld, simulateHistory } from '../../index.ts'
import { hashBase } from '../../../hashBase.ts'
import { logStreams } from '../../rng.ts'
import { SOC } from './params.ts'
import { hazardMul, wagesAt } from './system.ts'
import { createSociety, ensureSocPolities } from './state.ts'
import { socCivilMul, socContest, socCrisisPlus, socEliteLead, socOverthrowMul, socRevoltMul, psi } from './api.ts'
import type { HistoryState } from '../state.ts'

const worlds = new Map<number, ReturnType<typeof generateWorld>>()
const world = (seed: number) => { let w = worlds.get(seed); if (!w) { w = generateWorld(seed); worlds.set(seed, w) } return w }
const runs = new Map<string, History>()
function run(seed: number, o: HistoryOptions): History {
  const k = seed + JSON.stringify(o) + SOC.effects
  let h = runs.get(k)
  if (!h) { h = simulateHistory(world(seed), o); runs.set(k, h) }
  return h
}
const KEYS = ['socWage', 'socUrbanWage', 'socRent', 'socPsi', 'socMMP', 'socEMP', 'socSFD', 'socElite', 'socUrban', 'socClergy', 'socCoercion', 'socPhase'] as const
const isSoc = (t: number) => t >= 240 && t <= 249
const strip = (h: History): History => ({ ...h, events: h.events.filter((e) => !isSoc(e.type)) })

describe('society', () => {
  it('off: empty tables, no events, no stream', () => {
    const h = run(42, { years: 600 })
    for (const k of KEYS) expect(h[k].length).toBe(0)
    expect(h.events.some((e) => isSoc(e.type))).toBe(false)
    const log: string[] = []
    logStreams(log)
    simulateHistory(world(42), { years: 50, society: true })
    logStreams(null)
    expect(log.some((n) => n.includes('society'))).toBe(false)
  })

  it('shadow mode (SOC.effects false): society on equals off on every 8cabf09 field', () => {
    const was = SOC.effects
    SOC.effects = false
    try {
      const off = run(42, { years: 1200 })
      const on = run(42, { years: 1200, society: true })
      expect(on.events.some((e) => isSoc(e.type))).toBe(true)
      expect(hashBase(strip(on))).toBe(hashBase(off))
    } finally { SOC.effects = was }
  })

  it('on: shapes, ranges and event semantics', () => {
    const h = run(42, { years: 1500, society: true })
    const P = h.polities.length, Q = h.snapshotCount
    for (const k of KEYS) expect(h[k].length).toBe(Q * P)
    for (let i = 0; i < h.socPhase.length; i++) expect(h.socPhase[i] <= 3 || h.socPhase[i] === 255).toBe(true)
    let live = 0
    for (let i = 0; i < h.socPsi.length; i++) if (h.socPhase[i] !== 255) { live++; expect(h.socWage[i]).toBeGreaterThan(0) }
    expect(live).toBeGreaterThan(0)
    const ev = h.events
    const inst = (p: number, y0: number, y1: number) => ev.some((e) => e.year >= y0 && e.year <= y1 && (((e.type === EventType.SuccessionCrisis || e.type === EventType.Partitioned) && e.value === p) || e.type === EventType.Revolt || e.type === EventType.CivilWar || e.type === EventType.ReignEnded || e.type === EventType.PolityEnded))
    for (const e of ev) {
      if (!isSoc(e.type)) continue
      if (e.type !== EventType.Ennobled) { expect(e.value).toBeGreaterThanOrEqual(0); expect(e.value).toBeLessThan(P); expect(e.other === -1 || e.type === EventType.LabourDear).toBe(true) }
      if (e.type === EventType.SocialPhase) expect(e.extra === SecularPhase.Crisis || e.extra === SecularPhase.Expansion).toBe(true)
      if (e.type === EventType.SerfdomImposed || e.type === EventType.SerfdomEnded) { expect(e.extra!).toBeGreaterThanOrEqual(0); expect(e.extra!).toBeLessThanOrEqual(1) }
      if (e.type === EventType.EliteThinned) { expect(e.extra!).toBeGreaterThanOrEqual(SOC.thinEvent - 1e-3); expect(inst(e.value, e.year - SOC.thinYears - 5, e.year)).toBe(true) }
      if (e.type === EventType.LabourDear) expect(e.extra!).toBeGreaterThanOrEqual(SOC.dearRise - 1e-3)
      if (e.type === EventType.Ennobled) { expect(e.value).toBe(-1); expect(e.other).toBeGreaterThanOrEqual(0) }
    }
    // no alternation of bondage within 10 years in one realm
    const last = new Map<number, number>()
    for (const e of ev) if (e.type === EventType.SerfdomImposed || e.type === EventType.SerfdomEnded) {
      const y = last.get(e.value)
      if (y !== undefined) expect(e.year - y).toBeGreaterThanOrEqual(10)
      last.set(e.value, e.year)
    }
  })

  it('prefix-stable: a shorter run is a prefix of a longer one', () => {
    const a = run(7, { years: 900, society: true }), b = run(7, { years: 1200, society: true })
    const ea = a.events, eb = b.events
    for (let i = 0; i < ea.length; i++) expect(eb[i]).toEqual(ea[i])
    const Pa = a.polities.length, Pb = b.polities.length
    for (let q = 0; q < a.snapshotCount; q++) for (let p = 0; p < Pa; p++) expect(b.socPsi[q * Pb + p]).toBe(a.socPsi[q * Pa + p])
  })

  it('hand values: wages, rent, ε*, m(Ψ)', () => {
    const r = wagesAt(1, 0, 0, 0)
    expect(r.w).toBeCloseTo(1, 12); expect(r.r).toBeCloseTo(1, 12); expect(r.y).toBeCloseTo(2, 12); expect(r.wU).toBeCloseTo(SOC.urbPrem, 12)
    const c = wagesAt(1.25, 0.5, 0.06, 1)
    expect(c.w).toBeCloseTo((1 / 1.25) * (1 - SOC.chi * 0.5) * 0.94, 12)
    expect(c.r).toBeCloseTo(0.8 + 0.8 * SOC.chi * 0.5, 12)
    expect(c.wU).toBeCloseTo((SOC.urbPrem * c.w * (1 + SOC.urbShare * 0.5)) / (1 + SOC.urbCrowd * 0.25), 12)
    const m1 = SOC.mLow + (SOC.mHigh - SOC.mLow) / (1 + SOC.psiHalf * SOC.psiHalf)
    expect(hazardMul(1, 0)).toBeCloseTo(m1, 12)
    expect(hazardMul(1, 2)).toBeCloseTo(m1 * (1 - SOC.memDamp), 12)
  })

  it('hooks: with Ψ = 1, memory 0 and EMP = 1, h1-h5 are the reference values; off or unready they are neutral', () => {
    const soc = createSociety()
    ensureSocPolities(soc, 2)
    soc.init[0] = 1; soc.psi[0] = 1; soc.emp[0] = 1; soc.m[0] = hazardMul(1, 0)
    soc.init[1] = 1; soc.emp[1] = 1.5; soc.m[1] = hazardMul(2, 0)
    const s = { soc, pol: { P: 3, pEnded: Int32Array.from([-1, -1, -1]), polity: new Int32Array(0) } } as unknown as HistoryState
    expect(socRevoltMul(s, 0)).toBeCloseTo(hazardMul(1, 0), 12)
    expect(socCivilMul(s, 0)).toBeCloseTo(1 + SOC.civilPsi * (hazardMul(1, 0) - 1), 12)
    expect(socContest(s, 0)).toBe(0); expect(socCrisisPlus(s, 0)).toBe(0); expect(socEliteLead(s, 0)).toBe(1); expect(socOverthrowMul(s, 0)).toBe(1)
    expect(socContest(s, 1)).toBeCloseTo(SOC.contest * 0.5, 12); expect(socCrisisPlus(s, 1)).toBe(Math.floor(SOC.crisisPlus * 0.5))
    expect(socOverthrowMul(s, 1)).toBeCloseTo(1 + SOC.overthrow * 0.5, 12)
    // not yet stepped (p 2), and shadow mode: neutral or skipped
    expect(socRevoltMul(s, 2)).toBeUndefined(); expect(socCivilMul(s, 2)).toBe(1); expect(psi(s, 2)).toBe(0)
    const was = SOC.effects
    SOC.effects = false
    try { expect(socRevoltMul(s, 0)).toBeUndefined(); expect(socOverthrowMul(s, 1)).toBeUndefined(); expect(psi(s, 0)).toBe(1) } finally { SOC.effects = was }
  })
})
