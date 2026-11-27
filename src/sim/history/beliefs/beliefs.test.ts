// beliefs: beliefs and deception (beliefs-and-deception.md): the exp/log/pow-free helpers, the off switch, shadow mode (beliefs
// tracked, every decision on the truth) equal to off, and the tables and events of a run with beliefs on.
//
// With HistoryOptions.beliefs false (the default) the tree was checked identical to main on every 8cabf09 History field (G0,
// scripts/g0.ts on seeds 1, 42, 1234 at 2000 years).

import { describe, expect, it } from 'vitest'
import { BondKind, EventType, WarMotive } from '../../../contract.ts'
import type { History, HistoryOptions } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import { createRng, logStreams } from '../../rng.ts'
import { withoutLater } from '../laterFields.ts'
import { hashValue } from '../../../historyCache.ts'
import { BELIEF } from './params.ts'
import { noise, rpow } from './system.ts'

const worlds = new Map<number, ReturnType<typeof generateWorld>>()
const world = (seed: number) => { let w = worlds.get(seed); if (!w) { w = generateWorld(seed); worlds.set(seed, w) } return w }
const runs = new Map<string, ReturnType<typeof runHistory>>()
function run(seed: number, o: HistoryOptions, shadow = false): ReturnType<typeof runHistory> {
  const k = seed + JSON.stringify(o) + shadow
  let h = runs.get(k)
  if (!h) {
    BELIEF.shadow = shadow
    try { h = runHistory(world(seed), o) } finally { BELIEF.shadow = false }
    runs.set(k, h)
  }
  return h
}

describe('beliefs: arithmetic', () => {
  it('rpow is close to Math.pow on [1/4, 4] and exact at k = 0, 1', () => {
    for (const r of [0.25, 0.5, 0.8, 1, 1.3, 2, 4]) {
      for (const k of [0, 0.2, 0.5, 0.8, 1]) {
        const a = rpow(r, k), b = Math.pow(r, k)
        expect(Math.abs(a / b - 1)).toBeLessThan(0.03)
      }
      expect(rpow(r, 0)).toBeCloseTo(1, 12)
      expect(rpow(r, 1)).toBeCloseTo(r, 12)
      expect(rpow(r, 0.5) * rpow(1 / r, 0.5)).toBeCloseTo(1, 12) // log-symmetric
    }
  })
  it('noise is log-symmetric with log-sd near sigma', () => {
    const rng = createRng(1, 'test-noise')
    let s = 0, s2 = 0
    const N = 20000
    for (let i = 0; i < N; i++) { const l = Math.log(noise(rng, 0.25)); s += l; s2 += l * l }
    expect(Math.abs(s / N)).toBeLessThan(0.01)
    expect(Math.sqrt(s2 / N)).toBeGreaterThan(0.22)
    expect(Math.sqrt(s2 / N)).toBeLessThan(0.28)
    // the [1/1] Pade map (2 + n) / (2 - n) against e^n
    for (const n of [-1, -0.5, 0, 0.5, 1]) expect(Math.abs((2 + n) / (2 - n) / Math.exp(n) - 1)).toBeLessThan(0.1)
  })
})

describe('beliefs', () => {
  it('off: empty tables, no events, no stream', () => {
    const log: string[] = []
    logStreams(log)
    let h: History
    try { h = runHistory(world(42), { years: 400 }).history } finally { logStreams(null) }
    expect(log.includes('history-beliefs')).toBe(false)
    expect(h.strength.length + h.beliefs.count + h.beliefEst.length + h.bluffShown.length + h.wars.believed.length + h.bonds.known.length).toBe(0)
    expect(h.events.some((e) => e.type >= 230 && e.type <= 239)).toBe(false)
  })

  it('shadow mode (beliefs tracked, decisions on the truth) equals off on every other field', () => {
    const off = run(42, { years: 1200 }).history
    const sh = run(42, { years: 1200, beliefs: true }, true)
    expect(sh.history.beliefs.count).toBeGreaterThan(0)
    expect(sh.diag.beliefs!.updates).toBeGreaterThan(0)
    expect(hashValue(withoutLater(sh.history))).toBe(hashValue(withoutLater(off)))
  }, 900000)

  it('on: tables, invariants of the events', () => {
    const { history: h, diag } = run(42, { years: 1500, beliefs: true })
    const d = diag.beliefs!
    const P = h.polities.length, B = h.beliefs, Q = Math.floor(1500 / BELIEF.snapStep) + 1
    expect(h.strength.length).toBe(h.snapshotCount * P)
    expect(h.beliefEst.length).toBe(Q * B.count)
    expect(h.beliefSd.length).toBe(Q * B.count)
    expect(h.bluffShown.length).toBe(Q * P)
    for (let k = 0; k < B.count; k++) { expect(B.observer[k]).not.toBe(B.target[k]); expect(B.observer[k]).toBeLessThan(P); expect(B.target[k]).toBeLessThan(P) }
    let formed = 0
    for (let i = 0; i < h.beliefEst.length; i++) { expect(h.beliefEst[i]).toBeGreaterThanOrEqual(0); if (h.beliefEst[i] > 0) { formed++; expect(h.beliefSd[i]).toBeGreaterThanOrEqual(Math.floor(Math.sqrt(BELIEF.vMin) * 100)) } }
    expect(formed).toBeGreaterThan(0)
    expect(d.battles).toBeGreaterThan(0)
    // Wars: believed >= 0 exactly for bargained wars (a motive), and both columns then.
    const W = h.wars
    expect(W.believed.length).toBe(W.count)
    let bargained = 0
    for (let w = 0; w < W.count; w++) {
      expect(W.believed[w] >= 0).toBe(W.motive[w] !== WarMotive.Other)
      expect(W.actual[w] >= 0).toBe(W.believed[w] >= 0)
      if (W.believed[w] >= 0) bargained++
    }
    expect(bargained).toBe(d.wars)
    expect(d.preventF).toBe(d.byMotive[WarMotive.Preventive])
    // Bonds: known in {start, -1, > start}; one Alliance or SecretAlliance event per alliance.
    const Bd = h.bonds
    let alliances = 0, secret = 0
    for (let k = 0; k < Bd.count; k++) {
      const kn = Bd.known[k]
      expect(kn === Bd.startYear[k] || kn === -1 || kn > Bd.startYear[k]).toBe(true)
      if (Bd.kind[k] === BondKind.Alliance) { alliances++; if (kn !== Bd.startYear[k]) secret++ }
      else expect(kn).toBe(Bd.startYear[k])
    }
    const ev = h.events
    const n = (t: number) => ev.filter((e) => e.type === t).length
    expect(n(EventType.Alliance) + n(EventType.SecretAlliance)).toBe(alliances)
    expect(n(EventType.SecretAlliance)).toBe(secret)
    expect(d.secret).toBe(secret)
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i]
      if (e.type === EventType.AllianceRevealed) {
        let ok = false
        for (let k = 0; k < Bd.count; k++) if (Bd.kind[k] === BondKind.Alliance && Bd.known[k] === e.year && e.year - Bd.startYear[k] === e.extra) ok = true
        expect(ok).toBe(true)
        if (e.value >= 0) expect(W.startYear[e.value]).toBe(e.year)
      }
      if (e.type === EventType.Coerced) {
        expect(e.value).toBeGreaterThanOrEqual(0)
        if ((e.extra ?? 0) > 0) {
          // the Joined towns that follow that year go to the coercer, never the yielding realm's capital, at most `extra`
          let joined = 0
          for (let j = i + 1; j < ev.length && ev[j].year === e.year && joined < 100; j++) {
            const f = ev[j]
            if (f.type !== EventType.Joined || f.value !== e.value) continue
            if (j > i + (e.extra ?? 0)) break
            expect(f.settlement).not.toBe(e.other)
            joined++
          }
          expect(joined).toBeLessThanOrEqual(e.extra ?? 0)
        } else {
          // tribute: a Tribute bond starts that year with the yielding realm as tributary
          let ok = false
          for (let k = 0; k < Bd.count; k++) if (Bd.kind[k] === BondKind.Tribute && Bd.startYear[k] === e.year) ok = true
          expect(ok).toBe(true)
        }
      }
      if (e.type === EventType.BluffExposed) {
        // a BluffBegun of the same polity (its capitals include the exposed one's seat) within bluffYears + 10
        let ok = false
        for (let j = i; j >= 0 && ev[j].year >= e.year - BELIEF.bluffYears - 10; j--) if (ev[j].type === EventType.BluffBegun && h.polities[ev[j].value].capitals.includes(e.settlement)) ok = true
        expect(ok).toBe(true)
        expect([8, 32, 64, 128]).toContain(e.extra)
      }
      if (e.type === EventType.SpyCaught) { expect(e.value).toBeGreaterThanOrEqual(0); expect(e.value).toBeLessThan(P) }
    }
    expect(n(EventType.Coerced)).toBe(d.coerced)
  }, 900000)
})
