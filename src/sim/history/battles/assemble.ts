// battles: the contract tables (History.battles, History.commanders), copied out at assembly; every array owns its buffer.

import type { Battles, Commanders, Ruler } from '../../../contract.ts'
import { CommanderFate, ReignEnd } from '../../../contract.ts'
import type { BattleState } from './state.ts'

export interface BattleHistory {
  battles: Battles
  commanders: Commanders
}

export function emptyBattleHistory(): BattleHistory {
  return {
    battles: {
      count: 0, war: new Int32Array(0), year: new Int16Array(0), kind: new Uint8Array(0), counter: new Uint8Array(0), site: new Int32Array(0),
      target: new Int32Array(0), from: new Int32Array(0), attacker: new Int16Array(0), defender: new Int16Array(0), cmdA: new Int32Array(0),
      cmdD: new Int32Array(0), menA: new Float32Array(0), menD: new Float32Array(0), lossA: new Float32Array(0), lossD: new Float32Array(0),
      dead: new Float32Array(0), winner: new Uint8Array(0), hours: new Float32Array(0), weather: new Uint8Array(0), flags: new Uint16Array(0),
      ratio: new Float32Array(0), breakA: new Float32Array(0), breakD: new Float32Array(0), siegeYear: new Uint8Array(0), course: new Uint16Array(0), name: [],
    },
    commanders: {
      count: 0, polity: new Int16Array(0), people: new Int16Array(0), reign: new Int32Array(0), dynasty: new Int32Array(0), born: new Int16Array(0),
      female: new Uint8Array(0), skill: new Float32Array(0), firstYear: new Int16Array(0), lastYear: new Int16Array(0), battles: new Uint16Array(0),
      wins: new Uint16Array(0), fame: new Float32Array(0), fameYear: new Int16Array(0), fate: new Uint8Array(0), fateYear: new Int16Array(0),
      fateBattle: new Int32Array(0), fateWar: new Int32Array(0), reignAfter: new Int32Array(0), name: [],
    },
  }
}

/**
 * The tables as of `year` (the run's end so far). Fates the run settles lazily are settled here, on the copies (the state is
 * not touched, so a longer run assembles alike): a ruler's command ends with his reign (Slain when he fell in battle the
 * year of his last battle), a general past his retirement age retires, one whose realm ended goes with it.
 * `pEnded` the polities' end years (-1), `rulers` History.rulers, `names` the battles' and commanders' names (step 5).
 */
export function assembleBattles(bs: BattleState, year: number, pEnded: Int32Array, rulers: readonly Ruler[], battleNames: string[], commanderNames: string[]): BattleHistory {
  const B = bs.bWar.length
  const battles: Battles = {
    count: B, war: Int32Array.from(bs.bWar), year: Int16Array.from(bs.bYear), kind: Uint8Array.from(bs.bKind), counter: Uint8Array.from(bs.bCounter),
    site: Int32Array.from(bs.bSite), target: Int32Array.from(bs.bTarget), from: Int32Array.from(bs.bFrom), attacker: Int16Array.from(bs.bAtt),
    defender: Int16Array.from(bs.bDef), cmdA: Int32Array.from(bs.bCmdA), cmdD: Int32Array.from(bs.bCmdD), menA: Float32Array.from(bs.bMenA),
    menD: Float32Array.from(bs.bMenD), lossA: Float32Array.from(bs.bLossA), lossD: Float32Array.from(bs.bLossD), dead: Float32Array.from(bs.bDead),
    winner: Uint8Array.from(bs.bWinner), hours: Float32Array.from(bs.bHours), weather: Uint8Array.from(bs.bWeather), flags: Uint16Array.from(bs.bFlags),
    ratio: Float32Array.from(bs.bRatio), breakA: Float32Array.from(bs.bBreakA), breakD: Float32Array.from(bs.bBreakD), siegeYear: Uint8Array.from(bs.bSiegeYear),
    course: Uint16Array.from({ length: B }, (_, i) => bs.bCourse[i] ?? 0),
    name: Array.from({ length: B }, (_, i) => battleNames[i] ?? ''),
  }
  const C = bs.cPolity.length
  const fate = Uint8Array.from(bs.cFate), fateYear = Int16Array.from(bs.cFateYear), fateBattle = Int32Array.from(bs.cFateBattle)
  for (let c = 0; c < C; c++) {
    if (fate[c] !== CommanderFate.Serving) continue
    const reign = bs.cReign[c]
    if (reign >= 0) {
      const r = rulers[reign]
      if (!r || r.ended < 0 || r.ended > year) continue
      fateYear[c] = r.ended
      if (r.end === ReignEnd.Battle && bs.cLast[c] === r.ended) { fate[c] = CommanderFate.Slain; fateBattle[c] = bs.cLastBattle[c] }
      else fate[c] = r.end === ReignEnd.RealmEnded ? CommanderFate.RealmEnded : CommanderFate.Retired
      continue
    }
    const out = bs.cBorn[c] + bs.cRetire[c]
    const end = pEnded[bs.cPolity[c]]
    if (end >= 0 && end <= year && end < out) { fate[c] = CommanderFate.RealmEnded; fateYear[c] = end }
    else if (out <= year) { fate[c] = CommanderFate.Retired; fateYear[c] = out }
  }
  const fame = new Float32Array(C), fameYear = new Int16Array(C)
  for (let c = 0; c < C; c++) { fame[c] = bs.cPeak[c]; fameYear[c] = bs.cPeakYear[c] }
  const commanders: Commanders = {
    count: C, polity: Int16Array.from(bs.cPolity), people: Int16Array.from(bs.cPeople), reign: Int32Array.from(bs.cReign), dynasty: Int32Array.from(bs.cDyn),
    born: Int16Array.from(bs.cBorn), female: Uint8Array.from(bs.cFemale), skill: Float32Array.from(bs.cSkill), firstYear: Int16Array.from(bs.cFirst),
    lastYear: Int16Array.from(bs.cLast), battles: Uint16Array.from(bs.cBattles), wins: Uint16Array.from(bs.cWins), fame, fameYear, fate, fateYear, fateBattle,
    fateWar: Int32Array.from(bs.cFateWar), reignAfter: Int32Array.from(bs.cReignAfter), name: Array.from({ length: C }, (_, i) => commanderNames[i] ?? ''),
  }
  return { battles, commanders }
}
