// Lane N3d (throne fixes from AI play-test #2): a seated run's cards are honest (no After the battle card once its war is over,
// a coup or a ruler fallen in battle told as such, sentences and plurals), the odds' big moves are explained, routine business
// costs less to leave than a grave matter, and the seat's realm gets the story director's stronger focus.
import { describe, expect, it } from 'vitest'
import { DecisionKind, ReignEnd, decodeSeat } from '../../../contract.ts'
import type { History } from '../../../contract.ts'
import { resolveRun } from '../../../bots/presets.ts'
import { generateWorld, simulateHistory } from '../../../sim/index.ts'
import { DIVISIVE, deferCost } from '../../../sim/history/seat/params.ts'
import { HUD, HUD_N } from '../../../sim/history/seat/hud.ts'
import { STORY } from '../../story/plan.ts'
import { decisionCardModel } from '../cardModel.ts'
import { decisionTitle } from '../seatFormat.ts'
import { oddsWhy } from './hudModel.ts'
import { realmNews } from './callbacks.ts'
import { reignSummary } from './summary.ts'

describe('throne fixes (lane N3d)', () => {
  it('routine business costs less authority to leave than a grave matter', () => {
    expect(deferCost(DIVISIVE[DecisionKind.Idea])).toBeLessThan(deferCost(DIVISIVE[DecisionKind.Crisis]))
    expect(deferCost(DIVISIVE[DecisionKind.Crop])).toBeLessThan(deferCost(DIVISIVE[DecisionKind.Heir]))
    expect(deferCost(0)).toBeGreaterThan(0)
    expect(deferCost(1)).toBeLessThanOrEqual(1)
  })

  it('a move of the odds by 10 points or more is explained by the hazard that moved most', () => {
    const row = () => new Array<number>(HUD_N).fill(0)
    const a = row(), b = row()
    a[HUD.Contest] = 0.2; a[HUD.DeathYear] = 0.005
    b[HUD.Contest] = 0.9; b[HUD.DeathYear] = 0.03
    expect(oddsWhy(b, a, 61)).toMatch(/^Why the odds fell \(\d+% → \d+%\): mostly the chance of a contested succession \(the ruler is 61\)\.$/)
    expect(oddsWhy(a, a, 61)).toBe('')
  })

  it('the seat realm\'s stories get a stronger focus than a selection', () => {
    expect(STORY.seatFocus).toBeGreaterThan(STORY.focus)
    expect(STORY.seatNote).toBeLessThan(1)
  })

  it('a seated Dramatic run (seed 7, Tokotaubau from 1000): honest cards and news', () => {
    const seat = decodeSeat('polity:2:1000')!
    const h: History = simulateHistory(generateWorld(7, { subdivisions: 48 }), { ...resolveRun('dramatic').historyOptions, years: 1120, seat })
    const D = h.seat!.decisions
    expect(D.count).toBeGreaterThan(5)
    const texts: string[] = []
    for (let d = 0; d < D.count; d++) {
      const y = D.year[d]
      const n = d > 0 && D.year[d - 1] === y ? 2 : 1
      const m = decisionCardModel(h, d, n, n)
      texts.push(m.title, m.situation, ...m.news, ...m.callbacks.map((c) => c.text), ...m.options.map((o) => o.note))
      if (D.kind[d] === DecisionKind.WarChest) for (const o of m.options) expect(o.note).not.toMatch(/even in peace/)
      // decision 2 of 2 does not repeat the news box
      if (n === 2) { expect(m.news).toEqual([]); expect(m.callbacks).toEqual([]) }
      if (D.kind[d] === DecisionKind.Battle) {
        // no After the battle card once its war is over (the play-test's card after "the war … ends in our favour")
        const w = h.battles!.war[D.subject[d]]
        expect(h.wars.endYear[w] < 0 || h.wars.endYear[w] > y, `battle card ${y}: war ${w} ended ${h.wars.endYear[w]}`).toBe(true)
      }
      if (D.kind[d] === DecisionKind.Crisis && (D.info![d] ?? -1) >= 1000) {
        const cause = D.info![d] - 1000
        expect((h.rulers ?? []).some((r) => r.polity === D.polity[d] && r.ended === y && r.end === cause)).toBe(true)
        expect(decisionTitle(h, d)).toMatch(cause === ReignEnd.Battle ? /^Fallen in battle/ : /^A new house seizes the throne/)
      }
    }
    const p = h.seat!.polityAt[h.seat!.polityAt.length - 1]
    texts.push(...realmNews(h, p, seat.from, h.years).map((x) => x.text))
    for (const r of (h.rulers ?? []).filter((x) => x.polity === p && x.ended > seat.from)) texts.push(...reignSummary(h, r, h.years).lines)
    for (const t of texts) {
      expect(t, t).not.toMatch(/\b1 (years|towns)\b/)
      expect(t, t).not.toMatch(/some 0 dead/)
      expect(t, t).not.toMatch(/\. (you|because) /) // (each sentence capitalised)
      expect(t, t).not.toMatch(/; the towns grumble\. Coin now; the towns grumble/)
    }
  }, 900000)
})
