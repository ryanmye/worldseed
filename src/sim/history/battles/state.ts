// battles: state of the battles system: the battles fought (ragged rows, prefix-stable, the rulers style), the commanders,
// and per war the commander of each side. Every draw comes from 'history-battles' (battles.md 3.7, 3.9).

import type { Rng } from '../../rng.ts'
import { createRng } from '../../rng.ts'
import type { HistoryState } from '../state.ts'
import { BATTLE } from './params.ts'

export interface BattleDiag {
  battles: number
  byKind: number[]
  byWeather: number[]
  surprises: number
  /** Battles whose ground the defenders chose. */
  groundByDefender: number
  commanders: number
  rulerLed: number
  slain: number
  taken: number
  dismissed: number
  renowned: number
}

export interface BattleState {
  rng: Rng
  /** BATTLE.neutral at creation: record only. */
  neutral: boolean
  // --- Battles (History.battles) ---
  bWar: number[]
  bYear: number[]
  bKind: number[]
  bCounter: number[]
  bSite: number[]
  bTarget: number[]
  bFrom: number[]
  bAtt: number[]
  bDef: number[]
  bCmdA: number[]
  bCmdD: number[]
  bMenA: number[]
  bMenD: number[]
  bLossA: number[]
  bLossD: number[]
  bDead: number[]
  bWinner: number[]
  bHours: number[]
  bWeather: number[]
  bFlags: number[]
  bRatio: number[]
  bBreakA: number[]
  bBreakD: number[]
  bSiegeYear: number[]
  // --- Per war (grown to the war count): the commander of each side (2 w: the war's attacker, 2 w + 1: its defender), battles so far ---
  wCmd: number[]
  wBattles: number[]
  // --- Per polity: the best surviving general, recalled for the next war (-1) ---
  pVeteran: number[]
  // --- Commanders (History.commanders) ---
  cPolity: number[]
  cPeople: number[]
  cReign: number[]
  cDyn: number[]
  cBorn: number[]
  cFemale: number[]
  cSkill: number[]
  /** Skill at appointment (veterancy is capped above it). */
  cSkill0: number[]
  cFirst: number[]
  cLast: number[]
  cBattles: number[]
  cWins: number[]
  /** Fame now (as of cFameYear: decay is applied lazily), its peak and the peak's year. */
  cFame: number[]
  cFameYear: number[]
  cPeak: number[]
  cPeakYear: number[]
  cFate: number[]
  cFateYear: number[]
  cFateBattle: number[]
  cFateWar: number[]
  cReignAfter: number[]
  /** Age at which a general retires; his last base town; his last battle; 1 once renowned. */
  cRetire: number[]
  cBase: number[]
  cLastBattle: number[]
  cRenowned: number[]
  /** A ruler's commander row per reign. */
  reignCmd: Map<number, number>
  diag: BattleDiag
}

export function createBattles(s: HistoryState): BattleState {
  return {
    rng: createRng(s.world.seed, 'history-battles'),
    neutral: BATTLE.neutral,
    bWar: [], bYear: [], bKind: [], bCounter: [], bSite: [], bTarget: [], bFrom: [], bAtt: [], bDef: [], bCmdA: [], bCmdD: [],
    bMenA: [], bMenD: [], bLossA: [], bLossD: [], bDead: [], bWinner: [], bHours: [], bWeather: [], bFlags: [], bRatio: [],
    bBreakA: [], bBreakD: [], bSiegeYear: [],
    wCmd: [], wBattles: [], pVeteran: [],
    cPolity: [], cPeople: [], cReign: [], cDyn: [], cBorn: [], cFemale: [], cSkill: [], cSkill0: [], cFirst: [], cLast: [], cBattles: [], cWins: [],
    cFame: [], cFameYear: [], cPeak: [], cPeakYear: [], cFate: [], cFateYear: [], cFateBattle: [], cFateWar: [], cReignAfter: [],
    cRetire: [], cBase: [], cLastBattle: [], cRenowned: [],
    reignCmd: new Map(),
    diag: { battles: 0, byKind: [0, 0, 0, 0, 0, 0], byWeather: [0, 0, 0, 0, 0], surprises: 0, groundByDefender: 0, commanders: 0, rulerLed: 0, slain: 0, taken: 0, dismissed: 0, renowned: 0 },
  }
}
