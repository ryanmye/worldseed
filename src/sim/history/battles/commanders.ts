// battles: the commanders of the armies (battles.md 3.9), record only while BATTLE.neutral.
//
// Appointment at a war side's first battle (and again when its commander is gone): the ruler leads in person with chance
// BATTLE.rulerLead[tier] * (0.5 + warlike) (rulers on; one commander row per reign that led), else the realm's veteran
// (its best surviving general) is recalled, else a new general is appointed: skill clamp(1 + skillSd * gauss), age
// 25 + U * 20, a woman with BATTLE.female, a kinsman of the ruling house with BATTLE.kin, retirement age 55 + U * 17.
// A ruler's skill comes from his traits, no draw: clamp(0.85 + 0.3 (ability - 1) + 0.3 (warlike - 0.5), skillMin, skillMax).
// Draws ('history-battles', fixed order): [lead] (rulers on) then, for a new general, [skill x 4, age, female, kin, retire].
//
// After a battle: veterancy (skill + veteran per battle survived, capped), fame (fameOf), a general of the beaten side may
// be slain or taken, a beaten general may be relieved. While neutral, rulers are never killed here (their deaths in battle
// are the rulers system's own draw, linked at assembly), so nothing outside History.battles/commanders changes.

import { CommanderFate } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { tierOf } from '../polity/state.ts'
import { gauss } from '../weather.ts'
import { BATTLE } from './params.ts'
import type { BattleState } from './state.ts'

function clampSkill(x: number): number {
  return x < BATTLE.skillMin ? BATTLE.skillMin : x > BATTLE.skillMax ? BATTLE.skillMax : x
}

function newRow(bs: BattleState, s: HistoryState, ps: PolityState, p: number, reign: number, dyn: number, born: number, female: number, skill: number, retire: number): number {
  const c = bs.cPolity.length
  bs.cPolity.push(p); bs.cPeople.push(ps.pPeople[p]); bs.cReign.push(reign); bs.cDyn.push(dyn); bs.cBorn.push(born); bs.cFemale.push(female)
  bs.cSkill.push(skill); bs.cSkill0.push(skill); bs.cFirst.push(s.year); bs.cLast.push(s.year); bs.cBattles.push(0); bs.cWins.push(0)
  bs.cFame.push(0); bs.cFameYear.push(s.year); bs.cPeak.push(0); bs.cPeakYear.push(s.year)
  bs.cFate.push(CommanderFate.Serving); bs.cFateYear.push(-1); bs.cFateBattle.push(-1); bs.cFateWar.push(-1); bs.cReignAfter.push(-1)
  bs.cRetire.push(retire); bs.cBase.push(-1); bs.cLastBattle.push(-1); bs.cRenowned.push(0)
  bs.diag.commanders++
  return c
}

/** Fame of commander c now (decayed to this year). */
export function fameNow(bs: BattleState, c: number, year: number): number {
  let f = bs.cFame[c]
  for (let y = bs.cFameYear[c]; y < year; y++) f *= BATTLE.fameDecay
  bs.cFame[c] = f
  bs.cFameYear[c] = year
  return f
}

/** Whether commander c can still lead p's army this year. */
function fit(s: HistoryState, bs: BattleState, c: number, p: number): boolean {
  if (c < 0 || bs.cFate[c] !== CommanderFate.Serving || bs.cPolity[c] !== p) return false
  const reign = bs.cReign[c]
  if (reign >= 0) return s.rul !== null && s.rul.cur[p] === reign
  if (s.year - bs.cBorn[c] >= bs.cRetire[c]) { bs.cFate[c] = CommanderFate.Retired; bs.cFateYear[c] = s.year; return false }
  return true
}

/** The commander of polity p's side (0 the war's attacker, 1 its defender) in war w, appointed if need be. */
export function commanderOf(s: HistoryState, bs: BattleState, ps: PolityState, w: number, side: number, p: number): number {
  while (bs.wCmd.length < 2 * (w + 1)) bs.wCmd.push(-1)
  const cur = bs.wCmd[2 * w + side]
  if (fit(s, bs, cur, p)) return cur
  const rng = bs.rng
  const R = s.rul
  let c = -1
  const reign = R !== null && p < R.pcap ? R.cur[p] : -1
  if (R !== null && reign >= 0) {
    const tier = tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop)
    const lead = BATTLE.rulerLead[tier] * (0.5 + R.rWar[reign])
    if (rng.next() < lead) {
      const old = bs.reignCmd.get(reign)
      if (old !== undefined) c = old
      else {
        c = newRow(bs, s, ps, p, reign, R.rDyn[reign], R.rBorn[reign], R.rFemale[reign], clampSkill(0.85 + 0.3 * (R.rAbility[reign] - 1) + 0.3 * (R.rWar[reign] - 0.5)), 999)
        bs.reignCmd.set(reign, c)
      }
    }
  }
  if (c < 0) {
    while (bs.pVeteran.length <= p) bs.pVeteran.push(-1)
    const vet = bs.pVeteran[p]
    if (vet >= 0 && bs.cReign[vet] < 0 && fit(s, bs, vet, p)) c = vet
  }
  if (c < 0) {
    const skill = clampSkill(1 + BATTLE.skillSd * gauss(rng))
    const age = BATTLE.ageMin + Math.floor(rng.next() * BATTLE.ageSpan)
    const female = rng.next() < BATTLE.female ? 1 : 0
    const kin = rng.next() < BATTLE.kin
    const retire = BATTLE.retireMin + Math.floor(rng.next() * BATTLE.retireSpan)
    c = newRow(bs, s, ps, p, -1, kin && R !== null && reign >= 0 ? R.rDyn[reign] : -1, s.year - age, female, skill, retire)
  }
  bs.wCmd[2 * w + side] = c
  return c
}

/** Fame won by the victor of a battle (before decay): battles.md 3.9. */
export function fameGain(lossLoser: number, menLoser: number, menWinner: number, capital: boolean, enemyFame: number): number {
  let odds = menWinner > 0 ? menLoser / menWinner : 1
  if (odds > 3) odds = 3
  return BATTLE.fameWin * (lossLoser >= BATTLE.decisive ? 2 : 1) * Math.sqrt(odds) + (capital ? BATTLE.fameCapital : 0) + (BATTLE.fameEnemy * enemyFame) / BATTLE.renown
}
