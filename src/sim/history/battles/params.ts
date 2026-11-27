// battles: parameters (battles.md 3.6). Every value is a design default unless a source is named (see lanchester.ts).

/** HistoryOptions.battles default (false until the modifiers are tuned and the default flip PR lands: battles#14). */
export const BATTLES_ON = false

export const BATTLE = {
  /** Record only: every modifier 1, equal breaks, the baseline toll; wars, pop, rulers are bit-identical to battles off. */
  neutral: true,
  /** Strength left when a side breaks (lost 20%) [design default; no fixed breakpoint in the data: Clark 1954, Dupuy 1990]. */
  break0: 0.8,
  /** Pursuit: share of what is left of the beaten side lost in the rout. */
  rout: 0.15,
  /** Hours per unit of tau (an even fight lasts about four hours). */
  hourScale: 25,
  minHours: 0.5,
  maxHours: 14,
  /** Approach cells (before the target) considered for a field battle. */
  reach: 3,
  /** T added to a defended river crossing in the defender's choice of ground. */
  fordBonus: 0.3,
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
  pyrrhic: 0.15,
  /** Flank: the winner's horse exceeds the loser's by flankHorse, or x' beyond flankRatio either way, or a surprise. */
  flankHorse: 0.2,
  flankRatio: 4,
  /** Defender's men: clamped to [armyMin * lo, armyMax * hi]. */
  menDLo: 0.5,
  menDHi: 3,
} as const
