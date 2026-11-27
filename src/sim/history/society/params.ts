// society: tuning constants for classes, wages and rents, elite overproduction and political stress Ψ (society-secular-cycles.md
// §2.3). Every number is a design default [A] unless its comment says otherwise; the model forms are cited in system.ts. Wages
// are in multiples of subsistence, incomes in loads (a person-year of grain at worth 1). Rates are a year's unless "a step".

export const SOC = {
  /** Society off by default (HistoryOptions.society overrides it; the coordinator flips defaults, MASTER-PLAN R29). */
  enabled: false,
  /** Shadow mode (tests): false computes and snapshots everything but applies no hook (h1-h8); the history is then the one without society. */
  effects: false,
  /** Ring length (steps) of the population and overproduction memory: 8 steps = 40 years (youth bulge, lagged o). */
  ring: 8,
  /** K̄ += step · kRate · (Σ foodBase − K̄): a 20-year memory of the land (it does not vanish when hands die). */
  kRate: 0.05,
  /** Crowding L / K̄ at which the peasant wage is subsistence (≈ p75 of measured polity crowding 0.55-0.90, plan §1.2 [M]). */
  cRef: 0.8,
  /** Labour share of farm output (Cobb-Douglas form, Cobb & Douglas 1928; ½ is a design default). Output a head y = (1/ĉ)^η / α with η = 1 (calibration: the sim's crowding range is compressed). */
  alpha: 0.5,
  /** At κ = 1 the lords take chi of the peasants' share by coercion (labour services, fixed wages). */
  chi: 0.4,
  /** Urban wage = urbPrem · w · (1 + urbShare · ι / (ι + 1)) / (1 + urbCrowd · max(0, ĉ − 1)) (bread dearer when the land is full). */
  urbPrem: 1.3,
  urbShare: 0.5,
  urbCrowd: 0.5,
  /** Tithe share of farm output · (0.5 + org_f); clergy share of the people clergy0 · (0.5 + org_f) (no religion: org 0.5). */
  tithe: 0.06,
  clergy0: 0.008,
  /** Elite take of trade income ι; share of crown revenue spent on offices (finRevenue, else 0.02 · wealth of the capital). */
  urbTake: 0.3,
  office: 0.5,
  /** Customary income of an elite head in loads (≈ 40× subsistence): ε* = σ / (σ + e0) ≈ 2-3 % at reference. */
  e0: 40,
  /** Elite share at reference; a new state (no parent) starts at epsNew · eps0; hard bounds. */
  eps0: 0.02,
  epsNew: 0.6,
  epsMin: 0.002,
  epsMax: 0.12,
  /** Yearly ε growth γ = gUp · max(0, 1 − o_lag) + gFloor − gDown · max(0, o − 1) + mobility; o_lag lagSteps steps back (a generation). */
  gUp: 0.02,
  gFloor: 0.004,
  gDown: 0.01,
  lagSteps: 4,
  /** Yearly upward mobility from trade: mob · ι / (ι + mobHalf) (merchants buying land and titles). */
  mob: 0.002,
  mobHalf: 2,
  /** ε *= 1 − thin per event (§2.6): a won revolt, a succession crisis, a civil war (parent), an overthrow, a partition, a lost war, a fragmentation. */
  thinRevolt: 0.03,
  thinCrisis: 0.02,
  thinCivil: 0.15,
  thinOverthrow: 0.02,
  thinPartition: 0.05,
  thinLost: 0.03,
  thinFrag: 0.2,
  /** A civil war's pretender polity starts at ε_parent · (1 + factionTake) (the disaffected faction left with him). */
  factionTake: 0.3,
  /** MMP urban factor clamp(1 + mmpUrb · (u − uRef), 0.6, 2). */
  uRef: 0.15,
  mmpUrb: 1.5,
  /** Youth bulge clamp(1 + mmpYouth · max(0, L(t−20) / L(t−40) − 1) / youthRef, 1, 2). */
  youthRef: 0.05,
  mmpYouth: 1,
  /** EMP = o · clamp(1 + empAsab · (aRef − A), 0.5, 1.6) (cohesive elites compete less). */
  empAsab: 0.8,
  aRef: 0.4,
  /** Distrust (1 − T) ≈ clamp(1 + sfdAsab · (aRef − A), 0.6, 1.5) on the fiscal part of SFD. */
  sfdAsab: 0.6,
  /** Unmonetised realms (finSFD's proxy): + sfdOver · max(0, o − 1) (more claimants for offices and pensions). */
  sfdOver: 0.4,
  /** Hazard multiplier m(Ψ) = mLow + (mHigh − mLow) · Ψ² / (Ψ² + psiHalf²). */
  mLow: 0.5,
  mHigh: 3.0,
  psiHalf: 1.6,
  /** Violence memory M += memGain · inst a step; M *= memKeep a step (half-life ≈ 25 y); hazard × (1 − memDamp · min(1, M)) (fathers and sons). */
  memGain: 0.15,
  memKeep: 0.87,
  memDamp: 0.6,
  /** Disorder D = min(1, disKeep · D + disGain · inst) a step; supply × (1 − disorder · D) (h7). */
  disGain: 0.08,
  disKeep: 0.8,
  disorder: 0.25,
  /** Asabiya erosion a year: a −= erode · max(0, EMP − 1) · a (elite infighting; h6). */
  erode: 0.02,
  /** Grievance terms (h2): immiseration immis · max(0, 1/w − 1); failed coercion coerceGrief · κ · scar; townsfolk urban · (max(0, 1/wU − 1) + max(0, ĉ_town − 1)). */
  immis: 0.25,
  coerceGrief: 0.3,
  urban: 0.35,
  /** Rebels' strength × (1 + eliteLead · min(1, max(0, EMP − 1))) (disaffected elites lead; h2b). */
  eliteLead: 0.5,
  /** h3 civil-war chance × (1 + civilPsi · max(0, m(Ψ) − 1)); h4 contested chance + contest · e, crisis length + floor(crisisPlus · e); h5 overthrow × (1 + overthrow · e), e = min(1, max(0, EMP − 1)). */
  civilPsi: 1,
  contest: 0.15,
  crisisPlus: 10,
  overthrow: 1,
  /** Labour-scarcity drive smoothstep(scarLow, scarHigh, ĉ) (Domar's "free land"). */
  scarLow: 0.85,
  scarHigh: 0.65,
  /** Coercion (Brenner 1976; Domar 1970): κ* = clamp(κ + kUp · scar · (λ − π)) when labour is scarce, else κ (1 − kDown); κ += kRate2 · step · (κ* − κ). Serf regime hysteresis on and off. */
  kUp: 0.6,
  kDown: 0.15,
  kRate2: 0.1,
  serfOn: 0.5,
  serfOff: 0.2,
  /** LabourDear when w / wSm >= dearRise (at most every dearGap years); wSm's EMA rate a year. */
  dearRise: 1.3,
  dearGap: 50,
  wSmRate: 0.1,
  /** Phases (§2.8): Stagflation at o >= 1 and Ψ >= psiLow; Crisis at Ψ >= psiHigh or D >= dCrisis; Expansion again at Ψ < psiLow and D < dLow. */
  psiLow: 0.9,
  psiHigh: 1.8,
  dLow: 0.1,
  dCrisis: 0.5,
  /** EliteFactions hysteresis on EMP. */
  factOn: 1.5,
  factOff: 1.1,
  /** EliteThinned when ε <= (1 − thinEvent) · its peak within thinYears. */
  thinEvent: 0.3,
  thinYears: 40,
  /** Ennobled when the mobility accumulator reaches nobleAcc (a share of the people). */
  nobleAcc: 0.002,
  /** Won revolts' memory for the peasants' power π (kept a step; ≈ 50-year mean). */
  wonKeep: 0.9,
  /** city-states amendment (§0.3): rising chance × (1 + cityRise · socUrban). */
  cityRise: 1,
}
