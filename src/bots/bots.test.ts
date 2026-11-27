// Fun harness equivalence (EVALUATION §4 Lane 2): for each persona on 2 seeds, the headless bot's run (the real worker and
// seat controller, orders through decisionOrders and seatChoose) equals a fresh replay of its URL (seat= and o=: one
// simulateHistory with that seat and those orders), and each card the bot saw is the decision screen's model of that row.
import { describe, expect, it } from 'vitest'
import { decodeOrders } from '../contract.ts'
import { generateWorld, simulateHistory } from '../sim/index.ts'
import { hashAll } from '../sim/history/seat/hashing.ts'
import { pickSeat, runBot } from './headless.ts'
import { PERSONA_IDS, personaOf } from './personas.ts'
import { resolveRun } from './presets.ts'

describe('fun harness: bot run = fresh replay of its URL', () => {
  const run = resolveRun('realistic')
  for (const seed of [42, 7]) {
    it(`seed ${seed}: every persona`, async () => {
      const seat = pickSeat(seed, 700, run.historyOptions)
      for (const id of PERSONA_IDS) {
        const r = await runBot({ seed, seat, persona: personaOf(id).persona, span: 60, historyOptions: run.historyOptions })
        expect(r.cards.length, `${id}: no cards in 60 years`).toBeGreaterThan(0)
        const fresh = simulateHistory(generateWorld(seed, { subdivisions: 48 }), { ...run.historyOptions, years: r.history.years, seat, orders: decodeOrders(r.o) })
        expect(hashAll(r.history), `${id} on seed ${seed}`).toBe(hashAll(fresh))
        // the bot's choices are in the run: each card's row records the option it chose (or the court's pick when it deferred)
        const D = r.history.seat!.decisions
        for (const c of r.cards) {
          const want = c.decision.option === c.model.defer.option ? D.courtPick[c.model.d] : c.decision.option
          expect(D.chosen[c.model.d], `${id}: ${c.model.title} ${c.model.year}`).toBe(want)
          if (c.decision.option === c.model.defer.option) expect(D.deferred[c.model.d]).toBe(1)
        }
      }
    }, 900_000)
  }
})
