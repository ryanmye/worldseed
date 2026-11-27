// battles: state of the battles system: the battles fought (ragged rows, prefix-stable, the rulers style), the commanders,
// and per war the commander of each side. Every draw comes from 'history-battles' (battles.md 3.7, 3.9).

import type { Rng } from '../../rng.ts'
import { createRng } from '../../rng.ts'
import type { HistoryState } from '../state.ts'
import { BATTLE_MODE, BATTLE_TERMS } from './params.ts'
import type { BattleTerms } from './params.ts'

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
  /** Not neutral: per battle the raw factors [ground, cmd, supply, sick, surprise, weather, xs, rain (x after / before the compression)] (battleStats takes the logs: the sim may not). */
  factors: number[]
  /** Battle terms: battles fought in winter, in mud, at a frozen river, with a height term beyond 5%. */
  winter: number
  mud: number
  frozen: number
  height: number
  /** Not neutral: per battle the terms' raw factors [winter, height] (1 when off). */
  terms: number[]
  /** Naval battles, those the blockaders lost; coups, risings, turncoats; rulers slain or taken in the field. */
  naval: number
  navalLost: number
  seized: number
  rose: number
  turned: number
  rulersFell: number
  /** Decisive battles (C6 factor 4) and the realm deaths of the escalated toll. */
  decisive: number
  realmDead: number
}

export interface BattleState {
  rng: Rng
  /** BATTLE_MODE at creation: record only (neutral); the toll; war tempo; naval battles decide blockades; pretenders. */
  neutral: boolean
  toll: 'baseline' | 'split' | 'escalate'
  tempo: boolean
  navalDecides: boolean
  pretenders: boolean
  /** Battle terms (lane N5; all off when neutral) and the course stream ('history-battles-course', created only with season). */
  terms: BattleTerms
  crng: Rng | null
  /** The last battle's population toll (not neutral; war.ts deducts it): the front towns u and v, the realm levies beyond them per side (already deducted). */
  tollU: number
  tollV: number
  realmP: number
  realmQ: number
  /** Events scanned for ArmyStricken; religion's holy wars seen (holy: the war ids). */
  evSeen: number
  holySeen: number
  holy: Set<number>
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
  /** History.battles course (BattleCourse bits). */
  bCourse: number[]
  // --- Per war (grown to the war count): the commander of each side (2 w: the war's attacker, 2 w + 1: its defender), battles so far ---
  wCmd: number[]
  wBattles: number[]
  /** Per war side (2 w + side): the last year an ArmyStricken struck it (-9999). Per war: the year of its last decisive battle (-1). */
  wSick: number[]
  wDecisive: number[]
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
  /** The town he first fought from (his name's language). */
  cHome: number[]
  cLastBattle: number[]
  cRenowned: number[]
  /** The war of his last battle (-1). */
  cWar: number[]
  /** A ruler's commander row per reign. */
  reignCmd: Map<number, number>
  diag: BattleDiag
}

export function createBattles(s: HistoryState, neutralIn?: boolean, termsIn?: Partial<BattleTerms>): BattleState {
  const neutral = neutralIn ?? BATTLE_MODE.neutral // (a preset's battleNeutral, else the shared param)
  const t = { ...BATTLE_TERMS, ...(termsIn ?? {}) } // (a preset's battleTerms, else the defaults)
  const terms: BattleTerms = neutral ? { season: false, height: false, mud: false, frozen: false } : t
  return {
    rng: createRng(s.world.seed, 'history-battles'),
    neutral,
    toll: neutral ? 'baseline' : BATTLE_MODE.toll,
    tempo: !neutral && BATTLE_MODE.tempo,
    navalDecides: !neutral && BATTLE_MODE.navalDecides,
    pretenders: !neutral && BATTLE_MODE.pretenders,
    terms,
    crng: terms.season ? createRng(s.world.seed, 'history-battles-course') : null,
    tollU: 0, tollV: 0, realmP: 0, realmQ: 0, evSeen: 0, holySeen: 0, holy: new Set(),
    bWar: [], bYear: [], bKind: [], bCounter: [], bSite: [], bTarget: [], bFrom: [], bAtt: [], bDef: [], bCmdA: [], bCmdD: [],
    bMenA: [], bMenD: [], bLossA: [], bLossD: [], bDead: [], bWinner: [], bHours: [], bWeather: [], bFlags: [], bRatio: [],
    bBreakA: [], bBreakD: [], bSiegeYear: [], bCourse: [],
    wCmd: [], wBattles: [], wSick: [], wDecisive: [], pVeteran: [],
    cPolity: [], cPeople: [], cReign: [], cDyn: [], cBorn: [], cFemale: [], cSkill: [], cSkill0: [], cFirst: [], cLast: [], cBattles: [], cWins: [],
    cFame: [], cFameYear: [], cPeak: [], cPeakYear: [], cFate: [], cFateYear: [], cFateBattle: [], cFateWar: [], cReignAfter: [],
    cRetire: [], cBase: [], cHome: [], cLastBattle: [], cRenowned: [], cWar: [],
    reignCmd: new Map(),
    diag: { battles: 0, byKind: [0, 0, 0, 0, 0, 0], byWeather: [0, 0, 0, 0, 0], surprises: 0, groundByDefender: 0, commanders: 0, rulerLed: 0, slain: 0, taken: 0, dismissed: 0, renowned: 0, factors: [], winter: 0, mud: 0, frozen: 0, height: 0, terms: [], naval: 0, navalLost: 0, seized: 0, rose: 0, turned: 0, rulersFell: 0, decisive: 0, realmDead: 0 },
  }
}
