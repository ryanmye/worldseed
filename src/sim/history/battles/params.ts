// battles: parameters (battles.md 3.6). Every value is a design default unless a source is named (see lanchester.ts).

/** HistoryOptions.battles default (false until the modifiers are tuned and the default flip PR lands: battles#14). */
export const BATTLES_ON = false

/**
 * The battles' sub-switches (MASTER-PLAN §3.3: params, not HistoryOptions), read once when a run's battle state is created.
 * Mutable so the tests and the harness can run the other modes (restore them after).
 *   neutral       record only: every modifier 1, equal breaks, the baseline toll; wars, pop, rulers bit-identical to battles off.
 *   toll          the population toll: 'baseline' (2% of the front towns, as off), 'split' (the same total, shared by
 *                 casualties: the loser pays more), 'escalate' (part of the toll scales with the armies: battles.md 3.12).
 *   tempo         war tempo (battles.md 3.12; C6 factors 1 and 4): a near-constant peace hazard and decisive battles end wars.
 *   navalDecides  a lost naval battle prevents the blockade that year (else naval battles are recorded, the blockade as today).
 *   pretenders    famous generals seize thrones (C3 factor 3), rise in civil wars and turn traitor (battles.md 3.9).
 */
export const BATTLE_MODE: { neutral: boolean; toll: 'baseline' | 'split' | 'escalate'; tempo: boolean; navalDecides: boolean; pretenders: boolean } = {
  neutral: false,
  toll: 'escalate',
  tempo: true,
  navalDecides: true,
  pretenders: true,
}

export const BATTLE = {
  /** Strength left when a side breaks (lost 20%) [design default; no fixed breakpoint in the data: Clark 1954, Dupuy 1990]. */
  break0: 0.8,
  /** Pursuit: share of what is left of the beaten side lost in the rout. */
  rout: 0.15,
  /** Hours per unit of tau (an even fight lasts about four hours). */
  hourScale: 30,
  minHours: 0.5,
  maxHours: 14,
  /** Approach cells (before the target) considered for a field battle. */
  reach: 3,
  /** T added to a defended river crossing in the defender's choice of ground. */
  fordBonus: 0.15,
  /** Surprise: base chance (x 3 in fog, x 2 with cover), and the share of the surprised side lost in the opening volley. */
  surprise: 0.06,
  surpriseLoss: 0.15,
  /** Weather: rain chance base (x (0.5 + rainfall) x 1.5 in a wet year), fog chance (x 2 by water), snow below this temperature (0..1 scale). */
  rain: 0.18,
  fog: 0.06,
  snowT: 0.35,
  /** Heat: a clear day on desert above this temperature. */
  heatT: 0.75,
  /** New general's skill = clamp(1 + skillSd * gauss, skillMin, skillMax); veterancy per battle survived, capped. */
  skillSd: 0.2,
  skillMin: 0.6,
  skillMax: 1.5,
  veteran: 0.02,
  veteranMax: 0.1,
  /** Chance a ruler leads a war's army himself, by Tier (Chiefdom, Kingdom, Empire), x (0.5 + warlike). */
  rulerLead: [0.2, 0.12, 0.06] as readonly number[],
  /** An appointed general is a kinsman of the ruling house. */
  kin: 0.25,
  /** A woman in command (a general). */
  female: 0.03,
  /** A general's age at appointment: 25 + U * 20; retirement age 55 + U * 17. */
  ageMin: 25,
  ageSpan: 20,
  retireMin: 55,
  retireSpan: 17,
  /** Per battle: a commander of the beaten side is killed with slainLoser + slainRout * rho, else taken with taken; the winners' with slainWinner. */
  slainLoser: 0.03,
  slainRout: 0.2,
  slainWinner: 0.01,
  taken: 0.02,
  /** A beaten general is relieved with dismiss * (1 - min(1, fame / renown)). */
  dismiss: 0.2,
  /** Fame: a win, doubled when decisive (the loser lost >= decisive), x sqrt(min(3, odds)), + capital, + famous enemy share; decays yearly. */
  fameWin: 1,
  decisive: 0.3,
  fameCapital: 2,
  fameEnemy: 0.5,
  fameDecay: 0.97,
  /** Fame of a saga's hero (CommanderRenowned). */
  renown: 15,
  /** BattleFought is logged when the armies together reach logMen (or a named commander fell, a walled town or capital fell, the war's first battle). */
  logMen: 1500,
  /** Flags: Pursuit when the rout took >= pursuitLog of the loser's men; Pyrrhic when the winners lost >= pyrrhic. */
  pursuitLog: 0.1,
  pyrrhic: 0.18,
  /** Flank: the winner's horse exceeds the loser's by flankHorse, or x' beyond flankRatio either way, or a surprise. */
  flankHorse: 0.2,
  flankRatio: 4,
  /** Defender's men: clamped to [armyMin * lo, armyMax * hi]. */
  menDLo: 0.5,
  menDHi: 3,
  // --- Modifiers (battles#6; not neutral): x = r^2 * M, M = ground * cmd * supply * sick * surprise * weather (battles.md 3.3) ---
  /** Supply: M = (supplyBase + (1 - supplyBase) fA) / (... fD), f = the front town's food (x the regional harvest, capped at 1, for the marching side). */
  supplyBase: 0.8,
  /** A stricken army (ArmyStricken against its side within sickYears) fights at sick of its strength. */
  sick: 0.8,
  sickYears: 2,
  /** The attackers' effectiveness in snow, in heat. */
  snowMul: 0.9,
  heatMul: 0.92,
  /** beliefs: an intelEdge (in [-1, 1]) of at least feintEdge lets the better-informed side choose the ground (a feint). */
  feintEdge: 0.5,
  /** Morale: b = clamp(break0 - asabK (asab - 0.5) - zeal - famed + exhK min(1, exh), breakMin, breakMax). */
  asabK: 0.1,
  zeal: 0.05,
  famed: 0.04,
  exhK: 0.03,
  breakMin: 0.6,
  breakMax: 0.92,
  // --- Toll (3.5, 3.12) ---
  /** Escalate: dead = (1 - realmShare) T_front + realmShare kill (lossA + lossD) C, C = 1 + coalition * linked wars (<= coalitionMax). */
  realmShare: 0.5,
  kill: 0.025,
  coalition: 0.5,
  coalitionMax: 4,
  /** Escalation: the realm toll x (1 + escalate)^(war-years so far), capped at escalateMax. */
  escalate: 0.4,
  escalateMax: 3000,
  /** A decisive defeat (x' beyond annihilateRatio either way) costs the loser annihilate of the men it had left. */
  annihilate: 0.15,
  annihilateRatio: 6,
  /** Realm deaths per side and battle are capped at realmCap of its people (two battles a war-year at most; tuned with kill and escalate against realism war.alpha, maxShare and the median war's dead). */
  realmCap: 0.03,
  // --- Tempo (3.12; C6) ---
  /** The tired-peace chance (C6 factor 1, replaces WAR.peaceChance), the years before it, and the exhaustion per war-year (replaces WAR.perYear). */
  peaceChance: 0.11,
  peaceAfter: 1,
  perYear: 0.04,
  /** A decisive battle (the beaten side lost decisiveLoss of its men: a rout or an annihilation; or a ruler slain or taken) adds decisivePeace to that year's peace chance (C6 factor 4). */
  decisivePeace: 0.3,
  decisiveLoss: 0.45,
  // --- Commanders (battles#7) ---
  /** Ruler battle deaths: RULERS.battle x this when not neutral (rulers in the field fall in the battles instead). */
  rulerBattleCut: 0.5,
  // --- Naval (battles#8) ---
  /** Ships per port x navy, clamped to [shipsMin, shipsMax]. */
  shipsPerPort: 12,
  shipsMin: 3,
  shipsMax: 300,
  // --- Pretenders (battles#9) ---
  /** Coup: the overthrow chance x (1 + coup min(2, fame / renown)) while a general of fame >= renown / 2 serves (C3 factor 3). */
  coup: 1,
  /** A famous general's base qualifies as a rival centre at riseBar x the usual bar. */
  riseBar: 0.6,
  /** A famous general passed over (dismissed while fame >= renown / 2) turns to the enemy with turn a year, his base on its border. */
  turn: 0.004,
} as const
