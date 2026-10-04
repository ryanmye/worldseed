// polities: tuning constants for states, war, danger and unrest (design: polities/design.md, v1).
//
// Units as in ../params.ts: people, years, and n = 48 cell units of travel cost (multiplied by the
// grid's cellScale wherever they meet a cost). Every rate is per year unless it says otherwise.
// Population enters only through ratios (submission, odds) and a few size gates (formPop, minState,
// wall sizes), so a retune of food yields moves the clock of states, not their rules.

export const POLITY = {
  /** Polity system on by default (HistoryOptions.polities overrides it). */
  enabled: true,
  /** Control, danger, cohesion, unrest, revolts and successions run every `step` years; rivalry, declarations, formation, accretion, absorption, raids and walls every `slowStep` years (a multiple of step). */
  step: 5,
  slowStep: 10,
  /** Territory map pass (and the settlement graph) every mapStep years: aligned with the land snapshots (HISTORY_DEFAULTS.landInterval). */
  mapStep: 20,
  /** Territory radius of a settlement in cost units: mapR0 + mapR1 * smoothstep(mapPopLow, mapPopHigh, pop). */
  mapR0: 2.5,
  mapR1: 3.5,
  mapPopLow: 300,
  mapPopHigh: 10000,
  /** The capital's grip passes foreign or stateless settlements (one at a time) at this multiple of the cost. */
  transit: 2,
  /** Armies cost more than freight on sea legs: sea edge cost = trade route cost * seaArmy. */
  seaArmy: 1.5,
  /** Formation: a stateless settlement of formPop people, grain share >= formGrain, formRatio times its largest stateless neighbour, with formDependents neighbours that would submit. */
  formPop: 1500,
  formGrain: 0.4,
  formRatio: 2,
  formDependents: 2,
  /** Grain share gamma = (1 - fishFrac - liveWeight * liveFrac) * storable (the tax base; state.ts storableOf). */
  liveWeight: 0.6,
  /** Storable share of the crop where the main staple is a tuber (potato, cassava), and where no held staple fits (species-v2: replaced by its per-settlement `storable`). */
  storeTuber: 0.7,
  storeWild: 0.8,
  /** Submission: Proj * (subBase + (1 - subBase) * gamma) >= submit * Local * (1 + foreign * [other people]). */
  submit: 2.8,
  subBase: 0.3,
  foreign: 0.5,
  /** Accretion: at most this many settlements join a polity per slow step, the most dominated first. */
  accreteMax: 8,
  /** A chiefdom (fewer than absorbMembers members) whose capital would submit (at submit) to a larger neighbour joins it whole. */
  absorbMembers: 6,
  /** Reach: lambda = lambda0 * (1 + reachCrafts * (Crafts - 1)) / sqrt(1 + members / overload). */
  lambda0: 6,
  reachCrafts: 0.5,
  overload: 250,
  /** Power b = pop * q * (1 + prosperityPower * prosperity); q = 1 + qMetal (Metalworking - 1) + qCrafts (Crafts - 1). */
  prosperityPower: 0.5,
  qMetal: 0.3,
  qCrafts: 0.15,
  /** Mass in a succession crisis, and projection loss per war beyond the first and per unit of exhaustion. */
  crisisMass: 0.6,
  multiWar: 0.5,
  exhaustionProj: 0.5,
  /** Walls: Local * (1 + wall + wallRing * (rings - 1)), and a walled capital's citadel adds wallCapital. */
  wall: 0.8,
  wallRing: 0.3,
  wallCapital: 0.4,
  /** Below minState people a rump or a rebel cluster is no state; a polity below dwindlePop ends. */
  minState: 1500,
  dwindlePop: 300,
  /** Tiers (derived, see tierOf): Kingdom >= kingdomMembers and kingdomPop; Empire >= empirePop, or multiPeoples peoples each >= multiShare with >= multiMembers members. */
  kingdomMembers: 6,
  kingdomPop: 5000,
  empirePop: 60000,
  multiShare: 0.15,
  multiMembers: 25,
  /** Overseas colonies of a member join its polity if the sender has a port and the polity is at least a Kingdom; others join when inside its territory or within newReach * lambda of its capital. */
  newReach: 2,
  /** Tax: each member sends tax * supply * gamma * g / T of its food to the capital, and wealthTax * WEALTH.decay * wealth * g of its wealth. */
  tax: 0.06,
  wealthTax: 0.05,
  /** Grain tax counts as loads through the capital (the capital as a hub) times this. */
  taxThrough: 0.5,
  /** Successor founded: members' cohesion rises by this; a state formed: the same. */
  foundAsab: 0.1,
}

export const COHESION = {
  /** Asabiya a in [min, max]: on a frontier a += grow * a (1 - a) (times steppe on a horse-raider frontier), else a -= decay * a. */
  min: 0.02,
  max: 0.98,
  grow: 0.03,
  decay: 0.005,
  steppe: 1.5,
  /** Founders of the first tribes start at this. */
  start: 0.1,
  /** Rivalry at which a neighbouring polity counts as a frontier. */
  frontierR: 0.5,
  /** Events: war won (members), capital sacked or lost (members), revolt crushed (rebels). */
  warWon: 0.03,
  capitalLost: -0.05,
  crushed: -0.05,
}

export const RELATION = {
  /** dR per year: claim * claim_pq + differ * [peoples differ] + hunger * hunger_pq + recentWar * [war within recentYears] - trade * v / (v + tradeHalf) - decay * R. */
  claim: 0.04,
  claimHalf: 6,
  differ: 0.01,
  hunger: 0.02,
  recentWar: 0.03,
  recentYears: 50,
  trade: 0.01,
  tradeHalf: 200,
  decay: 0.02,
  /** A successor state starts with this rivalry towards its parent, and a truce of truceSecede years. */
  secedeR: 0.7,
  truceSecede: 15,
}

export const WAR = {
  /** Declaration chance per year: declare * smoothstep(rLow, rHigh, R) * smoothstep(advLow, advHigh, adv) * (crisis of the target ? crisisMul : 1) * (1 - E). */
  declare: 0.01,
  rLow: 0.6,
  rHigh: 1.2,
  advLow: 1.0,
  advHigh: 2.0,
  crisisMul: 2,
  /** At most this many wars at once per polity (as attacker). */
  maxWars: 2,
  /** Battle losses per front settlement per war-year (both sides). */
  battle: 0.02,
  /** Ravage of the front settlement, danger at the front and around it; land use there falls to fields times this. */
  ravage: 0.3,
  ravageDecay: 0.2,
  frontDanger: 0.6,
  nearDanger: 0.4,
  fields: 0.7,
  /** Sack on capture: chance (times sackCapital for a foreign conqueror's capture of the capital), loss of people and wealth, walls slighted, dam broken. */
  sack: 0.35,
  sackCapital: 2,
  sackPop: 0.12,
  sackWealth: 0.5,
  slight: 0.5,
  damLost: 0.3,
  sackDanger: 0.9,
  /** Walls also multiply the realm's field army defending the town (design 6.3); off: walls shelter only the town's own defenders. */
  fieldWall: false,
  /** At its own capital the defender's field army counts at this share (1: the whole realm's mass defends it). */
  capitalField: 0.5,
  /** A failed year of siege makes the next year's odds this much better for the besiegers. */
  siegeAttrition: 1.15,
  /** After its capital falls, the defender's members submit to the conqueror at this alpha (shock); a rump survives only with rumpShare of the realm's people (and POLITY.minState). */
  shock: 1.0,
  rumpShare: 0.4,
  /** Momentum: each settlement taken lowers the taker's exhaustion by this; a sack carries plunder (this share of the wealth lost) to the taker's capital. */
  momentum: 0.1,
  plunder: 0.5,
  /** The defender counterattacks in a war-year when its odds on its best front reach counter. */
  counter: 0.5,
  /** Exhaustion: + perYear per war-year + deaths * (war deaths / pop) + poor (capital wealth below poorShare * mass); decays at peace. */
  perYear: 0.08,
  deaths: 3,
  poor: 0.1,
  poorShare: 0.02,
  exhaustDecay: 0.1,
  /** Target choice: a front is worth win * value, value 1 for a province, 1 + capitalValue * members for the capital (decapitation). */
  capitalValue: 0.25,
  /** Peace: exhaustion >= 1 on either side, or the defender ended, or a yearly chance after peaceAfter years (not while the attacker took ground in the last `winning` years). */
  winning: 2,
  peaceChance: 0.08,
  peaceAfter: 5,
  truce: 30,
  peaceR: 0.5,
  /** Army size: share of the attacker's mass in men, clamped. Cell path search budget: pathBudget times the edge cost. */
  army: 0.05,
  armyMin: 50,
  armyMax: 5000,
  pathBudget: 3,
  /** Raids: chance per year step * raid * drive; drive = hungry * (1 - food) + richer + R + steppe * horse + herders * [liveFrac > herdFrac]. */
  raid: 0.004,
  hungry: 2,
  steppe: 0.5,
  herders: 0.5,
  herdFrac: 0.4,
  raidWealth: 0.2,
  raidPop: 0.01,
  raidFail: 0.02,
  raidDanger: 0.4,
  /** Raids on settlements of at least raidLog people are logged as events; the rest are summarised per decade. */
  raidLog: 1000,
  /** Settlements smaller than this neither raid nor are raided. */
  raidMinPop: 60,
}

export const DANGER = {
  /** Danger z decays by decay a year; ongoing sources keep it up (see danger.ts). */
  decay: 0.03,
  rival: 0.3,
  enemy: 0.5,
  raider: 0.3,
  frontier: 0.15,
  lawless: 0.3,
  lawlessHigh: 0.35,
  lawlessLow: 0.1,
  revolt: 0.4,
  /** Smoothed danger for walls: avg += avgRate * (z - avg) a year. */
  avgRate: 0.05,
  /** Cell danger: owner's z plus hostileEdge on a hostile border; unowned cells wild + half the largest neighbouring owner's z. */
  hostileEdge: 0.15,
  wild: 0.1,
  /** Flight: extra refugee chance flee * smoothstep(fleeLow, fleeHigh, z). */
  flee: 0.06,
  fleeLow: 0.35,
  fleeHigh: 0.8,
  /** Site and join scores: * (1 - site * zCell * (1 - D)), D = defensibility 0..1; walled towns pull the threatened: * (1 + z_from * wall). */
  site: 1.0,
  /** Refuge: in danger, defensible sites are sought after: * (1 + refuge * z * D). */
  refuge: 6,
  /** The threatened also prefer to join towns on defensible sites: join * (1 + z_from * refugeJoin * D). */
  refugeJoin: 3,
  /** A group's own danger counts this much toward the danger of the sites it weighs. */
  fear: 1.0,
}

export const WALLS = {
  /** Built when pop >= pop (capital capitalPop) and smoothed danger >= danger: yearly chance chance * building skill. */
  pop: 1000,
  capitalPop: 600,
  danger: 0.3,
  chance: 0.04,
  /** Another ring when pop >= ringGrowth * pop at the last ring and (smoothed danger >= ringDanger or a capital of ringCapital). */
  ringGrowth: 2.2,
  ringDanger: 0.2,
  ringCapital: 8000,
  maxRings: 3,
  /** Walls fall out of use below keep people (never merely because peace returned). */
  keep: 400,
}

export const UNREST = {
  /** h = distance (1 - g) + foreign (1 - assim) + conquest * fade(60 y) + famine [10 y] + crowding * smoothstep(0.85, 1, pop / food) + exhaustion * E + crisis + colony + badTax. */
  distance: 0.4,
  foreign: 0.3,
  conquest: 0.4,
  conquestYears: 60,
  famine: 0.3,
  famineYears: 10,
  crowding: 0.2,
  exhaustion: 0.2,
  crisis: 0.2,
  colony: 0.2,
  badTax: 0.1,
  badHarvest: 0.8,
  /** Assimilation under the ruling people's rule, a year. */
  assim: 0.004,
  /** u += rate * (h - u) a year. */
  rate: 0.1,
  /** Revolt: members with u >= revolt rise with chance chance per step; the cluster spreads to members with u >= spread (at most cluster). */
  revolt: 0.55,
  chance: 0.06,
  spread: 0.4,
  cluster: 15,
  /** Crushed: rebels lose pop and wealth, unrest falls to after, the centre's exhaustion rises. */
  crushPop: 0.03,
  crushWealth: 0.3,
  crushAfter: 0.2,
  crushExhaust: 0.1,
  crisisSupport: 0.4,
  /** Succession: first at founded + first + U(0, spread), then + U(next, next + spread). */
  first: 15,
  next: 15,
  spreadYears: 25,
  /** Crisis chance 0.15 + 0.3 (1 - A) + 0.1 [>= 2 peoples]; lasts U(crisisMin, crisisMax) years. */
  crisisBase: 0.15,
  crisisAsab: 0.3,
  crisisMulti: 0.1,
  crisisMin: 5,
  crisisMax: 15,
  /** Cohesion below this in a crisis: the realm fragments (every member's unrest + fragment, revolts resolved at once). */
  acrit: 0.06,
  fragment: 0.3,
  /** Capital move (b): a member with moveRatio times the capital's people for moveYears and lower smoothed danger. */
  moveRatio: 1.6,
  moveYears: 30,
}

/** Static defensibility of cells (defense.ts): feature weights of the raw score, and its rank-based mapping to D. */
export const DEFENSE = {
  /** Relief relative to the cells within two hops: full hill weight from the hillHigh quantile (among habitable cells), none below hillLow. */
  hill: 1,
  hillLow: 0.7,
  hillHigh: 0.97,
  island: 0.8,
  /** Sea share within two hops: smoothstep(penLow, penHigh). */
  peninsula: 0.6,
  penLow: 0.4,
  penHigh: 0.7,
  bend: 0.5,
  confluence: 0.4,
  pass: 0.4,
  passRise: 0.08,
  marsh: 0.3,
  mountain: 0.2,
  river: 0.05,
  /** Share of the habitable cells with any defensibility (D > 0), and with full D = 1. */
  share: 0.2,
  fullShare: 0.03,
}
