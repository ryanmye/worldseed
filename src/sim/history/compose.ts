// compose: the composition stacks C1–C10 (MASTER-PLAN §2.3), one function per shared draw or quantity. Phase 0 creates
// them as pass-throughs: every call site passes only its 8cabf09 inputs, and each function then returns the 8cabf09
// expression verbatim (same operands, same float order), so G0 (hashBase, src/hashBase.ts) is unchanged.
//
// Shared rule (§2.3), for every stack:
// - Factors apply in the fixed order listed here (fixed float order, deterministic). An absent system contributes no
//   factor: its field is left undefined and is **skipped, not ×1**.
// - The product of the non-order factors is clamped to [lo, hi]. The clamp applies only when at least one new factor is
//   present, so the neutral case is the 8cabf09 expression, unclamped.
// - Player-order factors (seat, character, divine) apply **after** the clamp (R33): player intent is never clamped, and
//   Purge = 0 stays a hard veto.
// - Each stack has a semantic owner, who sets the order and the clamp. Other plans add their factor here in one line, plus
//   a causal recorder line (causal §0.3). Never inline a new multiplier at the call site (§8.5).
// - Where §2.3 lists the base quantity itself as "factor 1" (C3 finOverthrow is not; C7 ALLIANCE.chance is), the clamp
//   bounds the product of the multipliers relative to the 8cabf09 base, not the base itself: a chance of 0.25 is not
//   clamped up to 0.1 or down to 4 (reading of §2.3 recorded in the scaffold PR).
//
// Hot loops: the factor objects are optional; callers that pass one should reuse a module-level scratch object rather than
// allocate per call.

/** The product of the defined factors in order (undefined: the system is absent, skipped); NaN-free inputs assumed. */
function prod(n: number, a?: number, b?: number, c?: number, d?: number, e?: number, f?: number): { v: number; any: boolean } {
  let v = n, any = false
  if (a !== undefined) { v *= a; any = true }
  if (b !== undefined) { v *= b; any = true }
  if (c !== undefined) { v *= c; any = true }
  if (d !== undefined) { v *= d; any = true }
  if (e !== undefined) { v *= e; any = true }
  if (f !== undefined) { v *= f; any = true }
  return { v, any }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

// ---------- C1. War declaration (war.ts declarations). Owner: grudges. ----------

/** Clamp of the non-order product (ruler · form · grudge · money · dyad · ideology). */
export const C1_CLAMP = [0.1, 5] as const
/** Clamp of factor 7 (restraint) itself. */
export const C1_RESTRAINT = [0.3, 1] as const
export interface C1Factors {
  /** 1. court's winning-faction war(q): replaces `ruler` (never both; court §6.4). */
  courtWar?: number
  /** 2. form: GOV.war · (1 + GOV.tradeWar · compete) (city-states §4.11; MIR §7.1, FP §7.1 columns). */
  form?: number
  /** 3. grudge: 1 + OATH.drive · g(p, q) (grudges §3.5). */
  grudge?: number
  /** 4. money: finWarDrive (finances §2.4.6). */
  money?: number
  /** 5. dyad: MIR pairPeace × future-tech deterMul (MIR §4, FT §2.5.6). */
  dyad?: number
  /** 6. ideology: 1 + IDEO.intervene · relR (MIR §4.6). */
  ideology?: number
  /** 7. restraint (owner ruling D-CW1, cold-wars lane): between great powers, clamp(1 − RS.k · welfare · voice, 0.3, 1); 1 for a conquest power. */
  restraint?: number
}
/**
 * The declaration multiplier: clamp(ruler · form · grudge · money · dyad · ideology) · holy · order. 8cabf09:
 * ruler (rulerWar or 1) · holy (holyDrive or 1; its own path, outside the stack) · order (ORDERS.warMul or 1, a player
 * order). beliefs' pressMul is a calibration constant outside the clamp, applied by beliefs to the drive. Truce, bond and
 * maxWars are gates, not factors.
 */
export function c1WarDeclare(ruler: number, holy: number, order: number, f?: C1Factors): number {
  if (f === undefined) return ruler * holy * order
  const r = f.courtWar !== undefined ? f.courtWar : ruler
  const m = prod(r, f.form, f.grudge, f.money, f.dyad, f.ideology, f.restraint)
  const v = m.any || f.courtWar !== undefined ? clamp(m.v, C1_CLAMP[0], C1_CLAMP[1]) : m.v
  return v * holy * order
}

// ---------- C2. Revolt (unrest.ts). Owner: riots (society holds the h1 multiplier until riots lands). ----------

/** Clamps: D <= 1 (with a form multiplier present); the yearly hazard mu <= 0.5 per town. */
export const C2_D_MAX = 1
export const C2_MU_MAX = 0.5
export interface C2GrievanceFactors {
  /**
   * The one form multiplier on the grievance sum: GOV.unrest (city-states, MIR and FP columns), or court REGIME.grief for
   * Monarchy/Signoria with court on (R11); never MIR REGIME_MODS.grief (R12).
   */
  form?: number
}
/**
 * Discontent D of a member from its grievance sum. D is additive: new terms (5 Taxes, 6 Urban, 7–12 riots, 13 Displaced,
 * 14 Generations; disasters into term 0) are added to `sum` by their owners through riots' CAUSE_OF_TERM table, never
 * multiplied here. 8cabf09: the sum, as is.
 */
export function c2Grievance(sum: number, f?: C2GrievanceFactors): number {
  if (f === undefined || f.form === undefined) return sum
  const d = sum * f.form
  return d > C2_D_MAX ? C2_D_MAX : d
}
export interface C2HazardFactors {
  /** riots on: mu = lambda0 · D² · socRevoltMul + triggers (riots §4.4); replaces the 8cabf09 chance. */
  riotsMu?: number
  /** riots off: society h1 m(Psi), the only multiplicative hazard term (Psi once). */
  psiMul?: number
}
/** The revolt chance of a member above UNREST.revolt. 8cabf09: UNREST.chance per step. */
export function c2RevoltChance(chance: number, f?: C2HazardFactors): number {
  if (f === undefined) return chance
  if (f.riotsMu !== undefined) return f.riotsMu > C2_MU_MAX ? C2_MU_MAX : f.riotsMu
  if (f.psiMul === undefined) return chance
  const x = chance * f.psiMul
  return x > C2_MU_MAX ? C2_MU_MAX : x
}

// ---------- C3. Ruler overthrow (rulerYear x; rulers/hazards.ts overthrowHazard). Owner: state-finances. ----------

export const C3_CLAMP = [0.2, 4] as const
export interface C3Factors {
  /** 1. finOverthrow (finances §2.4.6). */
  fin?: number
  /** 2. society h5 EMP (society §2.7). */
  emp?: number
  /** 3. battles coup (battles §3.6). */
  coup?: number
  /** 4. form: court REGIME.overthrow · (1 + plotHeat) for Monarchy/Signoria, or MIR REGIME_MODS.overthrow (7–11; FP via mods); exclusive by Government. */
  form?: number
  /** 5. riots' fear after NoblesExecuted (×0.5). */
  fear?: number
  // Order factors (after the clamp):
  /** seat Placate ×0.35, Purge = 0 (a hard veto). */
  seat?: number
  /** divine Portent ×0.8 / ×1.3, Bless ×0.7, Curse ×1.4 (their product). */
  divine?: number
  /** character general: 1 + I. */
  general?: number
}
/** The yearly overthrow chance from the 8cabf09 x. Court coups are a separate path under court's guard (court §6.5). */
export function c3Overthrow(x: number, f?: C3Factors): number {
  if (f === undefined) return x
  const m = prod(1, f.fin, f.emp, f.coup, f.form, f.fear)
  let v = m.any ? x * clamp(m.v, C3_CLAMP[0], C3_CLAMP[1]) : x
  if (f.seat !== undefined) v *= f.seat
  if (f.divine !== undefined) v *= f.divine
  if (f.general !== undefined) v *= f.general
  return v
}

// ---------- C4. Empire reach lambda (control.ts controlOf via state.ts reachOf). Owner: infrastructure. ----------

export const C4_CLAMP = [0.5, 3] as const
export interface C4Factors {
  /** 1. form: GOV.reach, or court REGIME.reach (R11). */
  form?: number
  /** 2. court Chancellor 0.97 + 0.03c (court §5.4). */
  chancellor?: number
  /**
   * 3. network: future-tech's 1 + FUT.reachK · (futReach − 1) (with sqrt(L_p) replaced by 1 + reachRail · infraHeld when
   * infrastructure is on), or without future-tech infrastructure's 1 + reachRail · held + reachWire · wired. battles adds nothing.
   */
  network?: number
}
/** Reach from the 8cabf09 lambda (lambda0 · scale · crafts / sqrt(1 + members / overload) · ideaAdmin). */
export function c4Reach(lam: number, f?: C4Factors): number {
  if (f === undefined) return lam
  const m = prod(1, f.form, f.chancellor, f.network)
  return m.any ? lam * clamp(m.v, C4_CLAMP[0], C4_CLAMP[1]) : lam
}

// ---------- C5. Population growth (population.ts). Owner: future-tech §2.5.3 until demography.md exists (R16). ----------

export interface C5HarvestFactors {
  /** Replaces the weather harvest: disasters' ClimateSeries (FT's anthropogenic T added inside it). */
  climate?: number
  // Order factors (divine), capped at `max`:
  /** divine Feed: floor 1. */
  feed?: boolean
  /** divine Bounty ×1.15, Storm ×0.8 (their product). */
  divine?: number
  /** The system's max harvest (world-builder-divine §3.3). */
  max?: number
}
/** The regional harvest h before storage (disasters §3.8 damp and the 8cabf09 stores apply after). 8cabf09: the weather's h. */
export function c5Harvest(h: number, f?: C5HarvestFactors): number {
  if (f === undefined) return h
  let v = f.climate !== undefined ? f.climate : h
  if (f.feed === true && v < 1) v = 1
  if (f.divine !== undefined) v *= f.divine
  if (f.max !== undefined && v > f.max) v = f.max
  return v
}
export interface C5SupplyFactors {
  /** tech-tree yield (ideaFarm with future-tech's yield rows: one lever, tech-tree §2.3). */
  yield?: number
  /** society h7: 1 − disorder · D. */
  disorder?: number
  /** future-tech's land-free urban food (added after the factors), and the arcology cap. */
  urbanFood?: number
  cap?: number
}
/** A settlement's food supply. 8cabf09: expected · h · harvestLeft (ideaFarm already inside expected via farmT). */
export function c5Supply(supply: number, f?: C5SupplyFactors): number {
  if (f === undefined) return supply
  let v = prod(supply, f.yield, f.disorder).v
  if (f.urbanFood !== undefined) v += f.urbanFood
  if (f.cap !== undefined && v > f.cap) v = f.cap
  return v
}
export const C5_GROWTH_CLAMP = [0.15, 1.3] as const
export interface C5GrowthFactors {
  /** The fertility slot F_p (future-tech §2.5.3). */
  fertility?: number
  /** religious faithFertility (multiplies into F; dormant unless future-tech or demography is on, R16). */
  faith?: number
}
/** The growth rate g. 8cabf09: POPULATION.growth. The product F · faith is clamped to [0.15, 1.3]. */
export function c5Growth(g: number, f?: C5GrowthFactors): number {
  if (f === undefined) return g
  const m = prod(1, f.fertility, f.faith)
  return m.any ? g * clamp(m.v, C5_GROWTH_CLAMP[0], C5_GROWTH_CLAMP[1]) : g
}
export const C5_SHORTFALL_CLAMP = [0.3, 1] as const
export interface C5ShortfallFactors {
  /** migration relief (welfare regime and future-tech relief, R20). */
  relief?: number
  /** tech-tree ideaFamine. */
  famine?: number
}
/** The shortfall death rate. 8cabf09: POPULATION.famineMortality. The product relief · famine is clamped to [0.3, 1]. */
export function c5Shortfall(rate: number, f?: C5ShortfallFactors): number {
  if (f === undefined) return rate
  const m = prod(1, f.relief, f.famine)
  return m.any ? rate * clamp(m.v, C5_SHORTFALL_CLAMP[0], C5_SHORTFALL_CLAMP[1]) : rate
}

// ---------- C6. War end (peace) hazard (war.ts warYear). Owner: battles (tempo). ----------

export const C6_MAX = 0.6
export interface C6Factors {
  /** 1. battles tempo: replaces WAR.peaceChance. */
  tempo?: number
  /** 2. finances: 1 + peaceDebt · … (finances §2.4.6). */
  debt?: number
  /** 3. court faction tired-peace factor (court §6.4). */
  court?: number
  /** 3b. beliefs convergence: 1 + converge · max(0, 1 − gap/gap0) (beliefs §3.5; Slantchev 2003). */
  converge?: number
  /** 4. battles decisivePeace (additive). */
  decisive?: number
}
/** The yearly chance of a tired peace. 8cabf09: WAR.peaceChance. WarBankrupt ends wars directly; it is not a factor. */
export function c6Peace(chance: number, f?: C6Factors): number {
  if (f === undefined) return chance
  let v = prod(f.tempo !== undefined ? f.tempo : chance, f.debt, f.court, f.converge).v
  if (f.decisive !== undefined) v += f.decisive
  return f.tempo !== undefined || f.debt !== undefined || f.court !== undefined || f.converge !== undefined || f.decisive !== undefined ? (v > C6_MAX ? C6_MAX : v) : v
}

// ---------- C7. Alliance chance (bonds.ts allianceStep). Owner: grudges (balance). ----------

export const C7_CLAMP = [0.1, 4] as const
export interface C7Factors {
  /** 1. balance's theta ramp and coalition bonus on ALLIANCE.chance (grudges §3.10). */
  balance?: number
  /** 2. ÷ (1 + repAlliance · f) (grudges §3.6), passed as the quotient's factor. */
  reputation?: number
  /** 3. MIR 1 + AFF (MIR §4.7). */
  affinity?: number
  /** 4. court Chancellor 0.8 + 0.2c and the faction policy (court §5.4, §6.4). */
  court?: number
  /** 5. barriers `talk` 0.6 + 0.4 e_elite (barriers-coldwar §2.5; not built yet). */
  talk?: number
  /** 6. cold wars `sphere` 1 + CW.sphere · kappa: a principal courting a partner against the rival principal (barriers-coldwar §3.3). */
  sphere?: number
  // Order factor (after the clamp):
  /** seat Ally ×4. */
  seat?: number
}
/** The alliance chance per slow step. 8cabf09: ALLIANCE.chance · marriage (MARRIAGE.alliance when the houses are tied, else 1). */
export function c7Alliance(chance: number, marriage: number, f?: C7Factors): number {
  if (f === undefined) return chance * marriage
  const m = prod(1, f.balance, f.reputation, f.affinity, f.court, f.talk, f.sphere)
  let v = m.any ? chance * marriage * clamp(m.v, C7_CLAMP[0], C7_CLAMP[1]) : chance * marriage
  if (f.seat !== undefined) v *= f.seat
  return v
}

// ---------- CB. Battle odds x = r² (war.ts battle; battles battleFought). Owner: battles. ----------
// New stack (cold wars lane): battles §3.3 builds x = r² · M_ground · M_cmd · M_supply · M_sick · M_surprise · M_weather; while
// BATTLE.neutral those are all 1 and live inside battles. The cold-war aid ratio M_aid (battles addendum "barriers & cold
// war") is the first factor shared by another plan, so it enters here; battles' own modifiers join this stack when tuned.

export const CB_CLAMP = [0.25, 4] as const
export interface CBFactors {
  /** 1. cold wars M_aid = (1 + CW.aidK · aid_A) / (1 + CW.aidK · aid_D) (battles addendum; barriers-coldwar §3.2). */
  aid?: number
}
/** The battle odds x (the striker wins with x / (x + 1)). 8cabf09: r · r. */
export function cbBattleX(r: number, f?: CBFactors): number {
  if (f === undefined) return r * r
  const m = prod(1, f.aid)
  return m.any ? r * r * clamp(m.v, CB_CLAMP[0], CB_CLAMP[1]) : r * r
}

// ---------- J. Defensive join chance (war.ts declare, the protector path). Owner: cold wars (coordinator ruling on D-CW1). ----------

export const J_CLAMP = [0.3, 1] as const
export interface JFactors {
  /** 1. restraint: a great power joining against another, 1 − 0.5 · (1 − rho) (treaty-bound: half the declaration's strength). */
  restraint?: number
}
/** The chance an ally or overlord comes to a defence. 8cabf09: joinChance (oaths) or ALLIANCE.join. */
export function jJoin(chance: number, f?: JFactors): number {
  if (f === undefined) return chance
  const m = prod(1, f.restraint)
  return m.any ? chance * clamp(m.v, J_CLAMP[0], J_CLAMP[1]) : chance
}

// ---------- C8. Tax take (polity/system.ts taxSystem, the wealth tax w). Owner: state-finances. ----------

export const C8_CLAMP = [0.3, 3] as const
export interface C8Factors {
  /** 1. pressure: finances taxMul · assessR, or riots TAXMUL[taxLvl] when finances is off (riots §0.3); exclusive. */
  pressure?: number
  /** 2. form: court courtTaxEff (REGIME.tax × Treasurer) for Monarchy/Signoria, or MIR tax for 7–11; exclusive. */
  form?: number
  /** 3. capacity: tech-tree ideaFisc (with future-tech's fisc rows). */
  capacity?: number
}
/** A member's wealth tax. 8cabf09: wealthTax · WEALTH.decay · grip · wealth. */
export function c8Tax(w: number, f?: C8Factors): number {
  if (f === undefined) return w
  const m = prod(1, f.pressure, f.form, f.capacity)
  return m.any ? w * clamp(m.v, C8_CLAMP[0], C8_CLAMP[1]) : w
}

// ---------- C9. Borrowing rate multiplier rateMul_p. Owner: state-finances. ----------
// TODO(state-finances): no 8cabf09 call site (no borrowing before finances). Wire at finances' rate (§2.4) when it lands.

export const C9_CLAMP = [0.5, 2] as const
export interface C9Factors {
  /** city-states setRateMul. */
  gov?: number
  court?: number
  ideo?: number
  fp?: number
  /** religious §4.2. */
  usury?: number
  /** tech-tree ideaCredit. */
  credit?: number
}
/** rateMul_p = clamp(govRate · courtRate · ideoRate · fpRate · usuryRate · ideaCredit); 1 when no system is on. */
export function c9RateMul(f?: C9Factors): number {
  if (f === undefined) return 1
  const m = prod(1, f.gov, f.court, f.ideo, f.fp, f.usury, f.credit)
  return m.any ? clamp(m.v, C9_CLAMP[0], C9_CLAMP[1]) : 1
}

// ---------- C10. Movement spread beta. Owner: riots §4.8. ----------
// TODO(riots): no 8cabf09 call site (no movements before riots). Wire at riots' movement spread (§4.8) when it lands.
// infrastructure's wireW is a Hawkes kernel weight inside riots' normalisation, not a beta factor.

export const C10_CLAMP = [0.2, 3] as const
export interface C10Factors {
  /** tech-tree: 1 + 0.5 · a(newspaper) (tech-tree §0.5). */
  press?: number
  /** MIR regime climate (MIR §4). */
  climate?: number
  /** FP surveillance (FP §6.4). */
  surveillance?: number
}
/** beta = beta_k (the ideology row, MIR) · clamp(press · climate · surveillance). */
export function c10Spread(beta: number, f?: C10Factors): number {
  if (f === undefined) return beta
  const m = prod(1, f.press, f.climate, f.surveillance)
  return m.any ? beta * clamp(m.v, C10_CLAMP[0], C10_CLAMP[1]) : beta
}
