// lane N4c (play-test 2): battles' deciding factors ranked with the numbers, battle names as said that year, the replay's
// side colours and end counter, Read more without the caption, the battle Why.
import { describe, expect, it } from 'vitest'
import { generateWorld, simulateHistory } from '../sim/index.ts'
import { BattleCourse, BattleKind, EventType, settlementNameAt } from '../contract.ts'
import { NUMBERS, battleSummary, rankedFactors, sideColours, standingWords } from './battleFormat.ts'
import { battleName, townAt } from './battlesData.ts'
import { withoutShown } from './story/captionText.ts'
import { explain } from './why/explain.ts'
import { plainText, whyProse } from './why/prose.ts'

describe('n4c: battles told consistently', () => {
  it('numbers outrank a factor they outweigh; names as said that year; the battle Why has causes', () => {
    const h = simulateHistory(generateWorld(1), { years: 2000, preset: 'dramatic', language: true })
    const B = h.battles
    let ranked = 0, byNumbers = 0
    for (let b = 0; b < B.count; b++) {
      if (!(B.course[b] & 0x3ff) || B.kind[b] === BattleKind.Naval) continue
      const fs = rankedFactors(h, b)
      for (let k = 1; k < fs.length; k++) expect(fs[k - 1].weight!).toBeGreaterThanOrEqual(fs[k].weight!)
      ranked++
      const r = B.menA[b] / Math.max(1, B.menD[b]), win = B.winner[b] === 0 ? r : 1 / r
      if (win >= 2.4) {
        // (2.4 to 1 for the victors: the square law gives the numbers more than any factor can, play-test 2)
        expect(fs.find((f) => f.forWinner)?.id, `battle ${b}`).toBe(NUMBERS)
        const dec = battleSummary(h, b).find((x) => x[0] === 'Decided by')?.[1] ?? ''
        expect(dec).toMatch(/numbers told/)
        expect(dec).not.toMatch(/outgeneralled/)
        byNumbers++
      }
    }
    expect(ranked).toBeGreaterThan(20)
    expect(byNumbers).toBeGreaterThan(0)
    // a siege's name carries its town as said that year (the chronicle's form)
    let sieges = 0
    for (let b = 0; b < B.count; b++) if (B.kind[b] === BattleKind.Siege && B.name[b].includes(settlementNameAt(h, B.target[b], B.year[b]))) { expect(battleName(h, b)).toContain(townAt(h, B.target[b], B.year[b])); sieges++ }
    expect(sieges).toBeGreaterThan(0)
    // a logged battle explains: its war and what decided it
    const i = h.events.findIndex((e) => e.type === EventType.BattleFought && (B.course[e.value] & BattleCourse.Factor) !== 0)
    const t = explain(h, `event:${i}`)
    expect(t.links.some((l) => l.via === 'R2')).toBe(true)
    expect(t.links.some((l) => l.via === 'rec:battles.course')).toBe(true)
    const text = plainText(whyProse(h, t))
    expect(text).not.toMatch(/does not say why|The event at|undefined/)
  }, 900000)

  it('the replay: distinct side colours, an end counter that shows the losses', () => {
    const [a, d] = sideColours('rgb(62, 218, 177)', 'rgb(66, 218, 62)') // (teal and green, sampled from play-test 2's replay)
    expect(d).not.toBe('rgb(66, 218, 62)')
    expect(a).toBe('rgb(62, 218, 177)')
    expect(sideColours('rgb(220, 60, 50)', 'rgb(60, 90, 220)')).toEqual(['rgb(220, 60, 50)', 'rgb(60, 90, 220)'])
    expect(standingWords(11364, 1 - 144 / 11364)).toBe('10,850')
    expect(standingWords(4638, 1)).toBe('4,600')
  })

  it('Read more leaves out what the caption says', () => {
    const cap = 'The Battle of X: some 4,600 met perhaps 11,000. The line broke. It was a winter campaign.'
    expect(withoutShown([cap, 'It was at its height in 1830.'], ['The Battle of X', cap])).toEqual(['It was at its height in 1830.'])
    expect(withoutShown(['The line broke. Then the town fell.'], ['', cap])).toEqual(['Then the town fell.'])
  })
})
