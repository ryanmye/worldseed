// Lane N3b (throne balance r2): the share link keeps only the reign's own choices; every option key has a risk and plain
// words; the surfacing lane's keys move the odds as the orders they give; the looming Overlord card is honest; new arcs are
// well formed on a seated run.
import { describe, expect, it } from 'vitest'
import { DecisionKind, SeatKind, SeatOptionKey, decodeOrders, decodeSeat, encodeOrders } from '../../../contract.ts'
import { resolveRun } from '../../../bots/presets.ts' // (the app's Dramatic link: lang=1)
import { OLD_POWER_START } from '../../onboardPolicy.ts'
import type { SeatOptions } from '../../../contract.ts'
import { OPTION_RISK } from '../../../sim/history/seat/params.ts'
import { OPTION_LABEL } from '../seatFormat.ts'
import { courtWords } from './stakes.ts'
import { shareLink } from './summary.ts'
import { generateWorld, simulateHistory } from '../../../sim/index.ts'
import { ArcKind, ARC_LABEL, findArcs } from '../../story/arcs.ts'
import { AMBITIONS } from './ambition.ts'

describe('throne balance r2 (lane N3b)', () => {
  it('a reign\'s share link drops the choices made after the reign', () => {
    const o = encodeOrders([{ year: 801, kind: 10, actor: 0, target: 8 }, { year: 905, kind: 10, actor: 0, target: 16 }, { year: 951, kind: 10, actor: 0, target: 24 }])
    const u = new URL(shareLink(`https://x.test/?seed=7&seat=polity:1:800&o=${o}`, 920))
    expect(u.searchParams.get('year')).toBe('920')
    expect(decodeOrders(u.searchParams.get('o')!).map((x) => x.year)).toEqual([801, 905])
    const none = new URL(shareLink(`https://x.test/?seed=7&seat=polity:1:800&o=${encodeOrders([{ year: 951, kind: 10, actor: 0, target: 24 }])}`, 920))
    expect(none.searchParams.has('o')).toBe(false)
  })

  it('every option key has a button word and a risk; the looming card\'s keep paying is the gravest course', () => {
    for (const k of Object.values(SeatOptionKey) as number[]) {
      expect(OPTION_LABEL[k], `key ${k}`).toBeTruthy()
      expect(OPTION_RISK[k], `key ${k}`).toBeGreaterThanOrEqual(0)
    }
    expect(OPTION_RISK[SeatOptionKey.KeepPaying]).toBeGreaterThan(OPTION_RISK[SeatOptionKey.Defy])
    expect(OPTION_RISK[SeatOptionKey.DefyWithAlly]).toBeLessThan(OPTION_RISK[SeatOptionKey.Defy])
    expect(courtWords(SeatOptionKey.KeepPaying, DecisionKind.Overlord)).toMatch(/take the realm whole/)
    expect(courtWords(SeatOptionKey.FightOn, DecisionKind.Battle)).toMatch(/war goes on/)
  })

  it('the ambitions say what they need (Unify by war, Monument raised in the seat\'s time)', () => {
    expect(AMBITIONS.find((a) => a.label === 'Unify the land')!.goal).toMatch(/towns in wars you declare/)
    expect(AMBITIONS.find((a) => a.label === 'A great monument')!.goal).toMatch(/in your time/)
  })

  it('the old great power start is alive at its year, and its first card is the overlord\'s warning (Dramatic)', () => {
    const seat = decodeSeat(OLD_POWER_START.seat)!
    const h = simulateHistory(generateWorld(OLD_POWER_START.seed, { subdivisions: 48 }), { ...resolveRun('dramatic').historyOptions, years: seat.from + 3, seat })
    expect(h.seat!.polityAt[0]).toBe(seat.id)
    expect(h.seat!.lostYear).toBe(-1)
    const D = h.seat!.decisions
    expect(D.count).toBeGreaterThan(0)
    expect(D.kind[0]).toBe(DecisionKind.Overlord)
    expect(D.info![0]).toBe(1)
    expect(Array.from({ length: D.optStart[1] - D.optStart[0] }, (_, i) => D.optKey[D.optStart[0] + i])).toContain(SeatOptionKey.KeepPaying)
  })

  it('the new arcs are well formed and labelled', () => {
    const w = generateWorld(42)
    const seat: SeatOptions = { kind: SeatKind.Polity, id: 0, from: 700 }
    const h = simulateHistory(w, { years: 1000, seat })
    const arcs = findArcs(h)
    expect(ARC_LABEL.length).toBe(Object.keys(ArcKind).length)
    const kinds = new Set(arcs.map((a) => a.kind))
    expect([ArcKind.Uncle, ArcKind.Regency, ArcKind.Rising].some((k) => kinds.has(k))).toBe(true)
    for (const a of arcs) {
      expect(a.events.length).toBe(a.phase.length)
      expect(a.phase[0]).toBe(0)
      for (let i = 1; i < a.events.length; i++) expect(h.events[a.events[i]].year).toBeGreaterThanOrEqual(h.events[a.events[0]].year - 0)
      if (a.complete) { expect(a.phase[a.phase.length - 1]).toBe(3); expect(a.end).toBeGreaterThanOrEqual(a.start) }
    }
  })
})
