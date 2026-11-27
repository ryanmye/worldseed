// families: parameters of the merchant families (merchant-families.md §2.5). Every number is a design default (the plan's
// References: none of them is taken from an outside source), tuned on seeds 1, 7, 42 and 1234 with the stats harness
// (familiesStats.ts). Thresholds are relative (shares, the median family) because merchant capital grows ~1000-fold from
// year 1000 to 2000; the absolute floors only decide while there are few families.

export const FAMILY = {
  /** Families on by default (HistoryOptions.families overrides; they need goods). Off: History.families empty, everything else identical. */
  on: false,
  /**
   * Phase 2 feedback: families lend to crowns as LenderKind.Family through finance (familyLend moves money out of the town
   * pools). Off (the default): a pure consequence layer; finance lends from the pools and families only mirror its losses.
   */
  feedback: false,
  // caps (performance; hard)
  maxAlive: 48, maxEver: 400, maxSeats: 8, perTown: 3,
  /** Sum of family shares at a town at most kappa (the lesser merchants keep the rest). */
  kappa: 0.9,
  // founding (decadal, year % 10 === 3)
  foundAbs: 200, foundRel: 0.5, foundChance: 0.12, foundTake: 0.4, ventureTake: 0.3,
  /** A town that is not a mart (no long-haul leg; its capital came by flight, gathering or an old trade) needs nonMart times the bar. */
  nonMart: 2,
  // capture: a share `own` of the profit of a lane it runs; a court family's weight at seats in its polity is (1 + court)
  own: 0.6, court: 0.3,
  /** Weight of the lesser merchants' free share against the families' (share x ability) in taking a town's inflow. */
  freeWeight: 0.6,
  // branches
  branchAbs: 300, branchRel: 1.0, branchChance: 0.4, branchTake: 0.15, branchHalfFree: 0.5, branchCloseShare: 0.01,
  // heads
  founderAge0: 28, founderAge1: 50, headAge: 18,
  /** Son, Brother, Nephew, Widow, SonInLaw, none (no heir). */
  howWeights: [0.635, 0.12, 0.10, 0.06, 0.067, 0.018],
  vig0: 1.1, vig1: 1.4, regress: 0.6, drift: 0.04, gen: 0.12, abilityNoise: 0.15, abilityMin: 0.5, abilityMax: 1.6,
  /** A Son or Nephew may be a daughter where the people's succession is cognatic (rulers on). */
  heiress: 0.08,
  split: 0.15, splitRel: 2.0, splitSeats: 3,
  // shocks and ruin
  fleetMul: 2.0, fleetMax: 0.6, sackLoss: 0.6, seize: 0.5, plagueCourt: 1.5, plagueLoss: 0.5,
  /** Plague toll at the home that counts (smaller outbreaks pass). */
  plagueMin: 0.02,
  loanShare: 0.5, defaultChance: 0.4, defaultShare: 1.0,
  peakDecay: 0.97, ruinRel: 0.65, ruinChance: 0.7,
  fadeRel: 0.1, fadeYears: 30,
  emigrate: 0.7,
  /** Years a bypassed family's capital keeps following it to its new home. */
  transitYears: 40,
  // marriage (year % 10 === 6), backing, patronage
  marryRel: 1.0, marryChance: 0.05, marryLoanMul: 2, marryYears: 60, marryTop: 2, marryDaughter: 0.7,
  backShare: 0.2, backGain: 0.5, confiscate: 0.3,
  patronRel: 0.3,
}
