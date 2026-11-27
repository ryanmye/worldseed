// seat-mode step 12: the seat's words (seatFormat.ts): every DecisionKind × option key has a line in both registers, every
// option key a button word; a played session's decisions become saga facts; seat events have Chronicle lines.
import { describe, expect, it } from 'vitest'
import { DecisionKind, EventType, OrderKind, SeatKind, SeatOptionKey, decisionOrders } from '../../contract.ts'
import type { History, Order } from '../../contract.ts'
import { createHistoryRun, generateWorld } from '../../sim/index.ts'
import { CHOICE_PHRASES, OPTION_LABEL, choiceStory, decisionSituation, decisionTitle, describeSeatEvent, optionExpects, optionLabel, seatDecisionFacts } from './seatFormat.ts'

describe('seat words', () => {
  it('a phrase in both registers for every DecisionKind and its option keys; a label for every key', () => {
    for (const k of Object.values(DecisionKind)) {
      const row = CHOICE_PHRASES[k]
      expect(row, `kind ${k}`).toBeDefined()
      expect(Object.keys(row).length).toBeGreaterThanOrEqual(2)
      for (const [c, l] of Object.values(row)) { expect(c.length).toBeGreaterThan(10); expect(l.length).toBeGreaterThan(10) }
    }
    for (const key of Object.values(SeatOptionKey)) expect(OPTION_LABEL[key], `key ${key}`).toBeTruthy()
    // the Chronicle hedges: no line states a cause or a motive in so many words
    for (const row of Object.values(CHOICE_PHRASES)) for (const [c] of Object.values(row)) expect(/\bbecause\b|\bin order to\b/.test(c)).toBe(false)
  })

  it('a played session: cards have words, choices become saga facts and stories, seat events have lines', () => {
    const w = generateWorld(42)
    const seat = { kind: SeatKind.Polity, id: 2, from: 800 }
    const run = createHistoryRun(w, { seat })
    run.simulateTo(800)
    const orders: Order[] = []
    let h: History = run.advanceTo(800)
    for (let i = 0; i < 4; i++) {
      const y = run.playSeat!(950)
      h = run.advanceTo(y)
      const D = h.seat!.decisions
      for (let d = 0; d < D.count; d++) if (D.year[d] === y) {
        expect(decisionTitle(h, d).length).toBeGreaterThan(3)
        expect(decisionSituation(h, d)).not.toMatch(/undefined|\{/)
        const n = D.optStart[d + 1] - D.optStart[d]
        for (let o = 0; o < n; o++) { expect(optionLabel(h, d, o)).not.toBe('Choose'); expect(optionExpects(h, d, o).length).toBeGreaterThan(5) }
        // every option the watcher offers has its phrase
        for (let o = 0; o < n; o++) expect(CHOICE_PHRASES[D.kind[d]][D.optKey[D.optStart[d] + o]], `kind ${D.kind[d]} key ${D.optKey[D.optStart[d] + o]}`).toBeDefined()
        const add = decisionOrders(h, d, 0)
        orders.push(...add)
        run.addOrders!(add)
      }
    }
    h = run.advanceTo(run.year + 1)
    const facts = seatDecisionFacts(h, 2, h.years + 1)
    expect(facts.length).toBeGreaterThan(0)
    for (const f of facts) { expect(f.chronicle).not.toMatch(/undefined|\{/); expect(f.legend.length).toBeGreaterThan(5) }
    const ch = h.orders!.findIndex((o) => o.kind === OrderKind.Choice)
    expect(choiceStory(h, h.orders![ch].target!)).toBe(facts[0].chronicle)
    const taken = h.events.find((e) => e.type === EventType.SeatTaken)!
    expect(describeSeatEvent(h, taken)).toMatch(/takes/)
  }, 600_000)
})
