// beliefs: tuning constants for beliefs and deception (beliefs-and-deception.md §3.12). Every value is a design default, not
// a sourced fact (Fearon 1995 gives no numbers); the noise and cost scales are textbook-style guesses, tuned on seeds 1, 7,
// 42, 1234 toward the plan's §7 targets (beliefs#12; the plan's first guesses in brackets where tuning moved them: vDrift [0.03],
// iBorder [0.6], iTrade [2], iMarriage [2], iSpy [4], trendRate [0.3], optimism [0.4], pressMul [2], cWar [0.12], prevent [0.6],
// bluffChance [0.15], caughtK [0.15]). Precisions I are 1/sigma^2 in log-strength units per slow step.

export const BELIEF = {
  /** Beliefs off by default (HistoryOptions.beliefs overrides it; the coordinator flips defaults, MASTER-PLAN R29). */
  enabled: false,
  /** Shadow mode (tests): track beliefs but decide everything on the truth (no bluffs, spies, secrets, bargains or events). */
  shadow: false,
  /** Log-variance of a first impression; its growth per slow step unwatched; its bounds; added when a successor inherits its parent's view. */
  sigma0Sq: 0.6,
  vDrift: 0.1,
  vMin: 0.01,
  vMax: 1.5,
  vInherit: 0.1,
  /** Channel precisions (§3.2): peoples in contact, a shared border (full at 6 border edges), trade (saturating at RELATION.tradeHalf), a marriage tie, a shared state faith, envoys (allies, vassal or tribute bonds), spies. */
  iContact: 0.4,
  iBorder: 0.4,
  borderFull: 6,
  iTrade: 3,
  iMarriage: 3,
  iFaith: 0.8,
  iAlly: 4,
  iSpy: 1,
  /** Counter-espionage blunts spies: I_spy * (1 - counterK * counter of the target). */
  counterK: 0.7,
  /** Ruler ability multiplies the total precision, clamped to [abilityLo, abilityHi]. */
  abilityLo: 0.6,
  abilityHi: 1.5,
  /** Smoothing of the believed growth ratio per slow step; slow steps ahead for the commitment problem (F = ratio^3, by multiplication). */
  trendRate: 0.15,
  horizon: 3,
  /** Ruler bias: a warlike ruler overrates its own side by 1 + optimism * (warlike - 0.5). */
  optimism: 1,
  /** The press chance relative to today's declaration chance (a calibration constant outside the C1 clamp; hard stop above 3). */
  pressMul: 1.1,
  /** War costs in pie shares (§3.4): the challenger cWar * (1 + E) * fundMul, the defender cWar * cDef * (1 + E) * fundMul; fundMul = 1 + fundK * (1 - smoothstep(fundLo, fundHi, fundYears)); the poor-capital proxy multiplies by poorMul. */
  cWar: 0.08,
  cDef: 0.8,
  fundK: 1,
  fundLo: 0.5,
  fundHi: 4,
  poorMul: 1.5,
  /** A holy city at stake lowers what the defender will yield by holyK (indivisibility). */
  holyK: 0.15,
  /** The pie: at most cedeMax border towns; tribute when no town fits and the defender would yield >= tributeX (worth tributeVal). */
  cedeMax: 3,
  tributeX: 0.25,
  tributeVal: 0.3,
  /** After a coerced cession: a truce of cedeTruce years, rivalry * coercePeace (and + coerceR without grudges). */
  cedeTruce: 15,
  coerceR: 0.2,
  coercePeace: 0.8,
  /** The crisis itself is a look: the challenger takes one cheap observation of the other's muster (its show of strength included) at this precision, and backs down when it no longer believes itself the stronger (Deterred). */
  iCrisis: 1,
  /** Weight of the preventive motive in the press drive. */
  prevent: 0.4,
  /** Ruler failure of a bargain that would hold (x 2 * warlike with rulers). */
  settleFail: 0.15,
  /** War reveals: per battle each side observes the other at sigmaBattle (I = 16); at the peace at sigmaPeace. */
  sigmaBattle: 0.25,
  sigmaPeace: 0.15,
  /** Convergence (Slantchev): the tired-peace chance * (1 + converge * max(0, 1 - gap / max(gap at start, 0.05))). */
  converge: 1,
  /** Bluffs (§3.6): chance per slow step bluffChance * smoothstep(bluffLo, bluffHi, fear) (* ability); shown strength 1 + bluffSize; years; yearly cost bluffCost * bluff * unit. */
  bluffChance: 0.03,
  bluffLo: 1.3,
  bluffHi: 3,
  bluffSize: 0.6,
  bluffYears: 30,
  bluffCost: 0.15,
  /** No bluff below this credibility; exposure chance exposeK * Ih / (Ih + 1) per hard-channel observer; credibility * credHit on exposure, recovering by credRecover * (1 - cred) per slow step. */
  credMin: 0.4,
  exposeK: 0.25,
  exposeGain: 0.8,
  secondHandI: 2,
  credHit: 0.5,
  credRecover: 0.13,
  /** Secret alliances (§3.7): share secret = secretShare * smoothstep(1, 2, threat mass / allies' mass); discovery by the threat's spies discoverK * spy * (1 - counterK * counter). */
  secretShare: 0.5,
  discoverK: 0.3,
  /** Spies (§3.9): a rival (relR >= spyR) is spied on; yearly cost spyCost * spy * unit; caught with caughtK * spy * counter; rivalry + caughtR; a spy service of spyMin or more can be caught; goods espionage * (1 + spyLeak * spy). */
  spyR: 0.5,
  spyCost: 0.08,
  spyMin: 0.2,
  caughtK: 0.01,
  caughtR: 0.15,
  spyLeak: 1,
  spyWar: 0.3,
  spyRate: 0.5,
  counterEmpire: 0.3,
  /** Cost unit without finances (or for an unmonetised crown): unitMass * pMass. */
  unitMass: 0.002,
  /** Grievance weights (grudges): a ceded town (capped per crisis), caught spies, an exposed forged claim. */
  wCeded: 0.08,
  capCeded: 0.4,
  wSpy: 0.2,
  wForged: 0.4,
  /** What a lost war costs the challenger, in pie shares: it presses on to war only when pi_p - c_p - (1 - pi_p) * deterLoss > 0 (else Deterred). */
  deterLoss: 1,
  /** Deterred is logged only between two Kingdom+ realms (the rest are counted in the diagnostics). */
  /** Forged claims (§3.10, off until tuned). */
  forgery: false,
  forgeK: 0.05,
  forgeW: 0.04,
  forgeDecay: 0.8,
  forgeLo: 0.3,
  /** Belief snapshot cadence (years; the slow step). */
  snapStep: 10,
}
