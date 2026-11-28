// Lane N3c (patronage): the "A full treasury" card offers Commission; the work is begun the year the order is given (the
// landmarks' table), the card says what it costs and the odds it is finished, the feed tells its progress and a later card's
// "Because you…" line its end; a finished work of the player's own order meets Monument, the court's pick never does; the bot
// run replays from its URL.
import { describe, expect, it } from 'vitest'
import { AmbitionKind, DecisionKind, EventType, OrderKind, OrderStatus, SeatOptionKey, decodeOrders, decodeSeat } from '../../../contract.ts'
import type { History } from '../../../contract.ts'
import { generateWorld, simulateHistory } from '../../../sim/index.ts'
import { hashAll } from '../../../sim/history/seat/hashing.ts'
import { runBot, type BotRun } from '../../../bots/headless.ts'
import { personaOf, type Persona } from '../../../bots/personas.ts'
import { resolveRun } from '../../../bots/presets.ts'
import { callbacksAt, realmNews, worksInProgress } from './callbacks.ts'

const SEED = 61343
const run = resolveRun('realistic')
const seat = { ...decodeSeat('polity:0:700')!, ambitions: [AmbitionKind.Monument] }
/** Commission whenever it is offered, else leave the matter to the court. */
const patron: Persona = { ...personaOf('always-defer').persona, choose(card, mem, rng) {
  const o = card.options.find((x) => x.key === SeatOptionKey.Commission)
  return o ? { option: o.option, why: 'commission', blind: false, lever: true } : personaOf('always-defer').persona.choose(card, mem, rng)
} }
const commissions = (h: History) => (h.orders ?? []).map((o, k) => ({ o, r: h.orderOutcomes![k], k })).filter((x) => x.o.kind === OrderKind.Commission)
const monument = (h: History) => h.events.some((e) => e.type === EventType.AmbitionFulfilled && e.value === AmbitionKind.Monument)

describe('patronage (lane N3c)', () => {
  let P: BotRun | null = null
  it('the card offers a named work with its cost and odds; the work is begun, rises in the feed, is finished, and meets Monument', async () => {
    P = await runBot({ seed: SEED, seat, persona: patron, span: 40, historyOptions: run.historyOptions })
    const h = P.history
    const card = P.cards.find((c) => c.model.title.startsWith('A full treasury'))
    expect(card, 'no Patronage card in 40 years').toBeTruthy()
    const opt = card!.model.options.find((o) => o.key === SeatOptionKey.Commission)!
    expect(opt.label).toMatch(/^Commission (a victory monument|a great temple|a great library|a market hall) at /)
    expect(opt.stakes.likely).toMatch(/war halts it/)
    expect(opt.stakes.odds).toMatch(/^Odds the work is finished: \d+%/)
    expect(card!.model.situation).toMatch(/years of work/)
    const D = h.seat!.decisions
    expect(D.kind[card!.model.d]).toBe(DecisionKind.Patronage)
    const cs = commissions(h)
    expect(cs.length).toBeGreaterThan(0)
    const { o, r } = cs[0]
    expect(o.year).toBe(card!.model.year + 1)
    expect(r.product).toBeGreaterThanOrEqual(0)
    const L = h.landmarks
    expect(L.begunYear[r.product]).toBe(o.year)
    expect(L.settlement[r.product]).toBe(o.target)
    expect(r.status).toBe(OrderStatus.Fulfilled)
    expect(L.completedYear[r.product]).toBe(r.year)
    expect(monument(h)).toBe(true)
    // on the way the masons asked for more, and were paid (a second Commission, done the year it was given)
    const ask = P.cards.find((c) => /masons at work on/.test(c.model.situation))
    expect(ask?.model.options.map((x) => x.label)).toContain('Pay the masons')
    expect(cs.some((x) => x.k !== cs[0].k && x.r.status === OrderStatus.Fulfilled && x.r.year === x.o.year && x.r.product === r.product)).toBe(true)
    // the feed: begun, rising (at a year while it was building), and the "Because you…" line of its end
    const p = D.polity[card!.model.d]
    expect(realmNews(h, p, seat.from, h.years).some((n) => n.kind === 'works' && /the masons begin/.test(n.text))).toBe(true)
    expect(worksInProgress(h, p, o.year + 2)[0]?.text).toMatch(/is rising: 2 years of work so far/)
    expect(callbacksAt(h, r.year + 1, r.year - 1).some((c) => /was finished after/.test(c.text))).toBe(true)
  }, 900_000)

  it('the bot run equals a fresh replay of its URL', () => {
    const r = P!
    const fresh = simulateHistory(generateWorld(SEED, { subdivisions: 48 }), { ...run.historyOptions, years: r.history.years, seat, orders: decodeOrders(r.o) })
    expect(hashAll(fresh)).toBe(hashAll(r.history))
  }, 900_000)

  it('left to the court, nothing is commissioned and Monument is not met', async () => {
    const r = await runBot({ seed: SEED, seat, persona: personaOf('always-defer').persona, span: 40, historyOptions: run.historyOptions })
    expect(r.cards.some((c) => c.model.title.startsWith('A full treasury'))).toBe(true)
    expect(commissions(r.history).length).toBe(0)
    expect(monument(r.history)).toBe(false)
  }, 900_000)

  it('a Commission given after a deferral (as if the court had picked it) builds, but does not meet Monument', () => {
    const o = decodeOrders(P!.o)
    const k = o.findIndex((x) => x.kind === OrderKind.Commission)
    const choice = o.slice(0, k).reverse().find((x) => x.kind === OrderKind.Choice)!
    let k2 = -1 // (the masons' pay: the last Commission of the run)
    o.forEach((x, i) => { if (x.kind === OrderKind.Commission) k2 = i })
    const forged = o.map((x) => (x === choice ? { ...x, target: Math.floor(x.target! / 8) * 8 + 7 } : x)).filter((_, i) => i <= (k2 >= 0 ? k2 : k))
    const h = simulateHistory(generateWorld(SEED, { subdivisions: 48 }), { ...run.historyOptions, years: P!.history.years, seat, orders: forged })
    const c = commissions(h)
    expect(c.length).toBeGreaterThanOrEqual(1)
    expect(c[0].r.status).toBe(OrderStatus.Fulfilled)
    expect(monument(h)).toBe(false)
  }, 900_000)
})
