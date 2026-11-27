import { describe, expect, it } from 'vitest'
import { BattleFlag, BattleKind, CommanderFate, EventType } from '../../../contract.ts'
import type { History } from '../../../contract.ts'
import { generateWorld, simulateHistory } from '../../index.ts'
import { hashBase } from '../../../hashBase.ts'
import { BATTLE_MODE } from './params.ts'

/** hashBase with the battles' events (220-229) left out: the neutral record must change nothing else. */
const baseOf = (h: History) => hashBase({ ...h, events: h.events.filter((e) => (e.type as number) < 220 || (e.type as number) > 229) })

describe('battles (neutral record)', () => {
  for (const seed of [1, 42]) {
    it(`seed ${seed}: on (neutral) equals off on every 8cabf09 field, and records every contest`, () => {
      const w = generateWorld(seed)
      const off = simulateHistory(w, { years: 600 })
      const saved = BATTLE_MODE.neutral
      BATTLE_MODE.neutral = true
      let on: History
      try { on = simulateHistory(w, { years: 600, battles: true }) } finally { BATTLE_MODE.neutral = saved }
      expect(off.battles.count).toBe(0)
      expect(off.events.some((e) => (e.type as number) >= 220 && (e.type as number) <= 229)).toBe(false)
      expect(baseOf(on)).toBe(hashBase(off))
      const B = on.battles, C = on.commanders
      // every conquest in a war comes after a battle won the same year for its target
      const conq = on.events.filter((e) => e.type === EventType.Conquered && e.other >= 0)
      for (const e of conq) {
        let found = false
        for (let b = 0; b < B.count && !found; b++) if (B.year[b] === e.year && B.target[b] === e.settlement && B.winner[b] === 0) found = true
        expect(found).toBe(true)
      }
      for (let b = 0; b < B.count; b++) {
        // the winner is the side the closed form says broke the other first, and the winner lost less than the loser's break
        if (B.winner[b] === 0) expect(B.ratio[b]).toBeGreaterThanOrEqual(0.9999)
        else expect(B.ratio[b]).toBeLessThanOrEqual(1.0001)
        expect((B.flags[b] & BattleFlag.TargetFell) !== 0).toBe(B.winner[b] === 0)
        expect(B.lossA[b]).toBeLessThanOrEqual(B.menA[b] + 1e-3)
        expect(B.lossD[b]).toBeLessThanOrEqual(B.menD[b] + 1e-3)
        expect(B.hours[b]).toBeGreaterThanOrEqual(0.5)
        expect(B.hours[b]).toBeLessThanOrEqual(14)
        expect(B.kind[b]).toBeLessThanOrEqual(BattleKind.Landing)
        expect(B.cmdA[b]).toBeLessThan(C.count)
        expect(B.cmdD[b]).toBeLessThan(C.count)
        expect(B.war[b]).toBeLessThan(on.wars.count)
        expect(B.name[b].length).toBeGreaterThan(0)
      }
      for (let c = 0; c < C.count; c++) {
        expect(C.wins[c]).toBeLessThanOrEqual(C.battles[c])
        if (C.fate[c] === CommanderFate.Slain || C.fate[c] === CommanderFate.Taken) expect(C.fateBattle[c]).toBeGreaterThanOrEqual(0)
      }
      for (const e of on.events) if (e.type === EventType.BattleFought) expect(B.target[e.value]).toBe(e.settlement)
    }, 900000)
  }
})
