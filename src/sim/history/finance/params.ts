// finance: tuning constants for crown treasuries, loans, default and bankruptcy (state-finances.md §2.3). Every number is a
// design default (the models are cited in system.ts), tuned on seeds 1, 7, 42, 1234 toward state-finances.md §6. Costs are in
// multiples of ordinary revenue R° (coin a year at peace), so they hold across eras. Rates are a year's share.

export const FIN = {
  /** Finance off by default (HistoryOptions.finance overrides it; the coordinator flips defaults, MASTER-PLAN R29). */
  enabled: false,
  /** Shadow mode (tests, step 2): false keeps every coin flow where it was and only books the ledger (no effects). */
  divert: true,
  /** Below this R° a realm is unmonetised: no war-cost, drive, bankruptcy or tax-pressure effects. */
  minRev: 5,
  /** EMA rate of taxSm, mineSm, revOrd, spendSm a year. */
  revSmooth: 0.1,
  /** court = court * R° * clamp(sqrt(members / courtRef), courtMin, courtMax). */
  court: 0.25,
  courtRef: 20,
  courtMin: 0.6,
  courtMax: 1.6,
  /** garrison = garrison * R° * (1 + rivalArmy * min(1, max rivalry with a bordering polity)); with arms on (1 + ARMS.costMul * M_p) instead. */
  garrison: 0.2,
  rivalArmy: 0.6,
  /** works = R° * (ring * sum(rings * pop) / pPop + fortW * forts). */
  ring: 0.03,
  fortW: 0.02,
  /** War cost per active war in R° a year: attacker, defender, + siege while it besieges, civil wars * civil. */
  warAtt: 0.6,
  warDef: 0.4,
  siege: 0.3,
  civil: 1,
  /** Share of peace spending and of war spending that returns to the capital's wealth (the rest is consumed). */
  home: 0.8,
  warHome: 0.3,
  /** Treasury above reserveCap * R° is spent into the capital (splendour). */
  reserveCap: 8,
  /** At war, borrow to keep chest * this year's war cost in hand. */
  chest: 1,
  /** In arrears borrow the shortfall + cushion * spending; skip loans below minLoan * R°. */
  cushion: 0.25,
  minLoan: 0.2,
  /** Credit limit: rate * debt <= dsMax * R° * (1 + warlikeDs * (rWar - 0.5)). */
  dsMax: 0.5,
  warlikeDs: 0.3,
  /** A Pool lender lends at most this share of its assets (mw + exposure); also families' lendShare. */
  lendCap: 0.5,
  /** Town lenders (goods off): share of wealth; minimum wealth. */
  townCap: 0.1,
  townMin: 2000,
  /** Rate (2.4.4): rateMul * rBase + rStain * stain + rLoad * max(0, debt / R° - loadFree) + rWar [at war] + rCoin * (1 - coin) - rAble * (ability - 1), in [rMin, rMax]; foreign lenders + rForeign. */
  rBase: 0.05,
  rStain: 0.06,
  rLoad: 0.01,
  loadFree: 2,
  rWar: 0.03,
  rCoin: 0.1,
  rAble: 0.03,
  rForeign: 0.015,
  rMin: 0.02,
  rMax: 0.4,
  /** No lender lends at or above this rate. */
  refuse: 0.3,
  /** At peace with treasury > repayAbove * R°, repay this share of the excess, dearest account first. */
  repayAbove: 2,
  repay: 0.5,
  /** Default when interest due > dsBreak * R°, or arrears for arrearYears with debt. */
  dsBreak: 1.5,
  arrearYears: 3,
  /** The haircut leaves interest at dsAfter * R°, at least hMin; no second default within defaultGap years. */
  dsAfter: 0.1,
  hMin: 0.3,
  defaultGap: 30,
  /** stain += stainDefault * h; repudiation += stainRepudiate; * stainKeep a year (0.5^(1/40), literal). */
  stainDefault: 2,
  stainRepudiate: 3,
  stainKeep: 0.983,
  /** After a usurpation, a conqueror's accession or a new house: chance repudiate * (0.5 + rWar) when debt > repudiateMin * R°. */
  repudiate: 0.25,
  repudiateMin: 1.5,
  /** HousesRuined when a Pool lender loses >= this share of its assets. */
  ruinShare: 0.25,
  /** Grievance (oaths) of a foreign lender's polity: grudgeW * OATH-scale * min(1, lost / R° of the wronged). */
  grudgeW: 1,
  /** Unpaid army: proj * (1 - unpaidProj * min(1, unpaid / unpaidFull)); E += unpaidExh * min(unpaid, 3); the war ends after mutinyYears unpaid. */
  unpaidProj: 0.3,
  unpaidFull: 2,
  unpaidExh: 0.25,
  mutinyYears: 3,
  /** Declaration drive (2.4.6): declFloor + (1 - declFloor) * smoothstep(fundLow, fundHigh, fundYears) * (fundYears > chestYears ? chestMul : 1) * (after a default ? afterDefault : 1). */
  fundLow: 0.5,
  fundHigh: 4,
  declFloor: 0.35,
  chestYears: 6,
  chestMul: 1.2,
  afterDefault: 0.5,
  afterYears: 20,
  /** Tired-peace chance * (1 + peaceDebt * min(2, the more indebted side's debt / R°)) (C6 factor 2). */
  peaceDebt: 0.5,
  /** Overthrow chance * (1 + unpaidOverthrow * min(unpaid, 3)) (C3 factor 1). */
  unpaidOverthrow: 0.5,
  /** Tax pressure (2.4.7): taxMul += taxRate * ((1 + taxUp * min(1, deficit / R°)) - taxMul), in [1, taxMax]; grievance taxGrief * (taxMul - 1). */
  taxUp: 0.6,
  taxMax: 1.6,
  taxRate: 0.2,
  taxGrief: 0.04,
  /** Tariff need reads the treasury in years of R° (replaces capital wealth / mass when on). */
  needLow: 0.5,
  needHigh: 3,
  /** finNeed and finDefaulted (city-states). */
  needDebtLow: 0.5,
  needDebtHigh: 4,
  defaultedYears: 20,
  /** Crown share of the worth of Treasure mined by members (the "royal fifth"). */
  royalty: 0.2,
  /** Share of the conqueror's plunder that goes to the treasury (the rest to the capital as before). */
  plunderCrown: 0.6,
  /** Debasement (step 8; deferred, D-S4): off. */
  debase: false,
  /** Money layer (step 8b; deferred, D-S4): off; the price level stays 1. */
  money: false,
  /** Patronage (society on only): court * clamp(patronBase + patronK * overproduction, patronBase, patronMax). */
  patronBase: 0.7,
  patronK: 0.3,
  patronMax: 1.6,
  /** finSFD (2.8): 1 + sfdLoad * max(0, debt / R° - needDebtLow) + sfdDef * max(0, defSm) + sfdArr * min(unpaid, 3) + sfdDefault [defaulted] - sfdReserve * reserve share, in [sfdMin, sfdMax]; defSm's EMA rate. */
  sfdLoad: 0.25,
  sfdDef: 1,
  sfdArr: 0.3,
  sfdDefault: 0.5,
  sfdReserve: 0.3,
  sfdMin: 0.5,
  sfdMax: 6,
  sfdSmooth: 0.05,
}
