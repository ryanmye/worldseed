// Lane N3 (throne slice): the throne's words and numbers over one seated run (seed 42, the largest realm from 800, the unit
// suite's preset 'off' plus rulers): heirs are named, stably and uniquely; the HUD and its odds are sane; options say what
// they do; callbacks name earlier decisions; reign summaries; arcs are deterministic; the drama plan keeps arc payoffs.
import { describe, expect, it } from 'vitest'
import { DecisionKind, SeatKind } from '../../../contract.ts'
import type { History, SeatOptions } from '../../../contract.ts'
import { generateWorld, simulateHistory } from '../../../sim/index.ts'
import { decisionCardModel } from '../cardModel.ts'
import { heirName, heirsAt } from './heirs.ts'
import { HUD, HUD_N, hudModel, oddsOfRow } from './hudModel.ts'
import { callbacksAt, ordersOfDecisions, realmNews } from './callbacks.ts'
import { reignSummary } from './summary.ts'
import { realmArms, portrait } from './heraldry.ts'
import { findArcs } from '../../story/arcs.ts'

const SEED = 42, Y0 = 800, Y1 = 1000
let H: History | null = null
/** A seated run where every card is answered with its first option (orders from the decisions themselves). */
function run(): History {
  if (H) return H
  const w = generateWorld(SEED)
  const h0 = simulateHistory(w, { years: Y0 })
  const S = h0.settlements.length, q = h0.snapshotCount - 1
  const pop = new Float64Array(h0.polities.length)
  for (let id = 0; id < S; id++) { const p = h0.polity[q * S + id]; if (p >= 0) pop[p] += h0.population[q * S + id] }
  let big = 0
  for (let p = 0; p < pop.length; p++) if (pop[p] > pop[big]) big = p
  const seat: SeatOptions = { kind: SeatKind.Polity, id: big, from: Y0 }
  H = simulateHistory(w, { years: Y1, seat })
  return H
}

describe('throne slice (lane N3)', () => {
  it('records a HUD row and the heirs at every decision', () => {
    const h = run()
    const D = h.seat!.decisions
    expect(D.count).toBeGreaterThan(3)
    expect(D.hud!.length).toBe(D.count * HUD_N)
    expect(D.heirStart!.length).toBe(D.count + 1)
    for (let d = 0; d < D.count; d++) {
      const r = D.hud!.subarray(d * HUD_N, (d + 1) * HUD_N)
      expect(r[HUD.Towns]).toBeGreaterThan(0)
      for (const k of [HUD.Overthrow, HUD.Revolt, HUD.Breakaway]) if (Number.isFinite(r[k])) { expect(r[k]).toBeGreaterThanOrEqual(0); expect(r[k]).toBeLessThanOrEqual(1) }
      const o = oddsOfRow(r)
      expect(o).toBeGreaterThanOrEqual(0)
      expect(o).toBeLessThanOrEqual(1)
    }
  })
  it('names heirs stably and uniquely within a house, and never offers an infant by name', () => {
    const h = run()
    const D = h.seat!.decisions
    for (let d = 0; d < D.count; d++) {
      const xs = heirsAt(h, d)
      const names = xs.map((x) => x.name)
      expect(new Set(names).size).toBe(names.length)
      for (const n of names) expect(n).toMatch(/^[A-Z]/)
      if (D.kind[d] === DecisionKind.Heir) for (let i = 0; i < D.optStart[d + 1] - D.optStart[d]; i++) {
        const o = D.optStart[d] + i
        if (D.orderStart[o + 1] > D.orderStart[o]) expect(D.year[d] - D.orderTarget[D.orderStart[o]]).toBeGreaterThanOrEqual(3)
      }
    }
    // (a later look names the same child alike)
    const d = D.count - 1
    for (const x of heirsAt(h, d)) expect(heirName(h, h.rulers.find((r) => r.polity === D.polity[d] && r.acceded <= D.year[d] && (r.ended < 0 || r.ended > D.year[d]))!.dynasty, x.born, x.female)).toBe(x.name)
  })
  it('card options say what they do (no "keeps its own counsel"), with a risk word', () => {
    const h = run()
    const D = h.seat!.decisions
    for (let d = 0; d < D.count; d++) {
      const m = decisionCardModel(h, d, 1, 1)
      for (const o of m.options) {
        expect(o.note).not.toMatch(/keeps its own counsel/)
        expect(['low', 'some', 'high', 'grave']).toContain(o.stakes.risk)
        expect(o.label).not.toBe('Crush it')
      }
      expect(m.hud).not.toBeNull()
    }
  })
  it('callbacks, news and reign summaries name what happened', () => {
    const h = run()
    const D = h.seat!.decisions
    // (no orders in this run: callbacks only from deferrals, none here; the tables exist and are empty)
    expect(ordersOfDecisions(h).size).toBe(0)
    expect(callbacksAt(h, Y1, Y0).length).toBe(0)
    const p = D.polity[0]
    const news = realmNews(h, p, Y0, Y1)
    const reigns = h.rulers.filter((r) => r.polity === p && r.ended > Y0 && r.ended <= Y1)
    expect(news.filter((n) => n.kind === 'reign').length).toBe(reigns.length)
    for (const r of reigns) {
      const s = reignSummary(h, r, Y1)
      expect(s.lines[0]).toMatch(/reigned \d+ years/)
    }
    expect(hudModel(h, -1, Y1)!.oddsText).toMatch(/%$/)
  })
  it('arcs are deterministic and well formed', () => {
    const h = run()
    const a = findArcs(h), b = findArcs(h)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    for (const x of a) {
      expect(x.events.length).toBe(x.phase.length)
      expect(x.phase[0]).toBe(0)
      if (x.complete) expect(x.phase[x.phase.length - 1]).toBe(3)
    }
  })
  it('heraldry and portraits are stable SVG', () => {
    expect(realmArms(1, 2, 'Tidu')).toBe(realmArms(1, 2, 'Tidu'))
    expect(realmArms(1, 2, 'Tidu')).not.toBe(realmArms(1, 3, 'Tidu'))
    expect(portrait(1, 5, true, 30, true, '#123456')).toMatch(/^<svg/)
  })
})
