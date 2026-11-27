// n5: battle terms (season, height, mud, frozen) and the recorded deciding factors (History.battles course).
import { describe, expect, it } from 'vitest'
import { BattleCourse, BattleFactor, BattleKind, BattleWeather } from '../../../contract.ts'
import type { History } from '../../../contract.ts'
import { generateWorld, simulateHistory } from '../../index.ts'
import { logStreams } from '../../rng.ts'
import { hashBase } from '../../../hashBase.ts'
import { BATTLE_MODE, BATTLE_TERMS } from './params.ts'
import type { BattleTerms } from './params.ts'

const YEARS = 700
function run(terms: Partial<BattleTerms>, neutral = false): { h: History; streams: string[] } {
  const savedT = { ...BATTLE_TERMS }, savedN = BATTLE_MODE.neutral
  Object.assign(BATTLE_TERMS, terms)
  BATTLE_MODE.neutral = neutral
  const streams: string[] = []
  logStreams(streams)
  try { return { h: simulateHistory(generateWorld(1), { years: YEARS, battles: true }), streams } } finally { logStreams(null); Object.assign(BATTLE_TERMS, savedT); BATTLE_MODE.neutral = savedN }
}
const count = (h: History, bit: number) => { let n = 0; for (let b = 0; b < h.battles.count; b++) if (h.battles.course[b] & bit) n++; return n }

describe('battles: deciding factors and terms', () => {
  it('neutral records no course; not neutral names valid factors, naval battles none', () => {
    const neu = run({ season: true, height: true, mud: true, frozen: true }, true).h
    expect(neu.battles.count).toBeGreaterThan(0)
    expect(neu.battles.course.every((c) => c === 0)).toBe(true)
    const { h, streams } = run({})
    expect(streams).not.toContain('history-battles-course')
    const B = h.battles
    expect(B.course.length).toBe(B.count)
    let named = 0
    for (let b = 0; b < B.count; b++) {
      const c = B.course[b]
      const f1 = c & BattleCourse.Factor, f2 = (c >> BattleCourse.Factor2Shift) & BattleCourse.Factor
      expect(f1).toBeLessThanOrEqual(BattleFactor.Winter)
      expect(f2).toBeLessThanOrEqual(BattleFactor.Winter)
      if (f2 !== 0) expect(f1).not.toBe(0)
      if (B.kind[b] === BattleKind.Naval) expect(c).toBe(0)
      if (f1 !== 0) named++
      // terms off: no term factor or course bit
      expect(f1 === BattleFactor.Height || f1 === BattleFactor.Winter || f2 === BattleFactor.Height || f2 === BattleFactor.Winter).toBe(false)
      expect(c & (BattleCourse.Winter | BattleCourse.Mud | BattleCourse.Frozen)).toBe(0)
    }
    expect(named / B.count).toBeGreaterThan(0.5)
  }, 900000)

  it('each term marks its battles and only its own; season draws from its own stream; runs are deterministic', () => {
    const base = run({}).h
    const season = run({ season: true }), season2 = run({ season: true })
    expect(season.streams.filter((x) => x === 'history-battles-course').length).toBe(1)
    expect(hashBase(season.h)).toBe(hashBase(season2.h))
    expect(count(season.h, BattleCourse.Winter)).toBeGreaterThan(0)
    expect(count(season.h, BattleCourse.Mud | BattleCourse.Frozen)).toBe(0)
    // winter battles avoid deep cold (winter quarters) and fall as snow more often
    const S = season.h.battles, w = generateWorld(1)
    let wSnow = 0, wN = 0, sSnow = 0, sN = 0
    for (let b = 0; b < S.count; b++) {
      if (S.kind[b] === BattleKind.Naval) continue
      const winter = (S.course[b] & BattleCourse.Winter) !== 0
      if (winter) expect(w.temperature[S.site[b]]).toBeGreaterThan(0.2)
      if (winter) { wN++; if (S.weather[b] === BattleWeather.Snow) wSnow++ } else { sN++; if (S.weather[b] === BattleWeather.Snow) sSnow++ }
    }
    expect(wSnow / Math.max(1, wN)).toBeGreaterThanOrEqual(sSnow / Math.max(1, sN))
    const mud = run({ mud: true }).h
    expect(count(mud, BattleCourse.Mud)).toBeGreaterThan(0)
    expect(count(mud, BattleCourse.Winter | BattleCourse.Frozen)).toBe(0)
    for (let b = 0; b < mud.battles.count; b++) if (mud.battles.course[b] & BattleCourse.Mud) expect(mud.battles.kind[b]).not.toBe(BattleKind.Siege)
    const height = run({ height: true }).h
    let hNamed = 0
    for (let b = 0; b < height.battles.count; b++) { const c = height.battles.course[b]; if ((c & 15) === BattleFactor.Height || ((c >> 5) & 15) === BattleFactor.Height) hNamed++ }
    expect(hNamed).toBeGreaterThan(0)
    // a term changes the history only through the battles it touches: the first battle rows before any term applies agree
    expect(height.battles.count).toBeGreaterThan(0)
    expect(base.battles.year[0]).toBe(height.battles.year[0])
  }, 900000)
})
