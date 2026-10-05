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
  /**
   * Formation: a stateless settlement of at least formQuant times the formTop-quantile of the living settlements' people,
   * within [formPopMin, formPop] (formation.ts formPopOf), grain share >= formGrain, formRatio times its largest stateless
   * neighbour, with formDependents neighbours that would submit.
   */
  formPop: 1500,
  formPopMin: 800,
  formTop: 0.9,
  formQuant: 4,
  formGrain: 0.4,
  formRatio: 1.5,
  formDependents: 2,
  /** Grain share gamma = (1 - fishFrac - liveWeight * liveFrac) * storable (the tax base; state.ts storableOf: species v2's per-settlement storable share of the crop). */
  liveWeight: 0.6,
  /** Taxable share of the crop: storeFloor + (1 - storeFloor) * min(1, storable / storeRef), storable species v2's storable share of the crop (state.ts storableOf). */
  storeFloor: 0.5,
  storeRef: 0.85,
  /** Submission: Proj * (subBase + (1 - subBase) * gamma) >= submit * Local * (1 + foreign * [other people]). */
  submit: 3.2,
  subBase: 0.3,
  foreign: 0.5,
  /** Accretion: at most this many settlements join a polity per slow step, the most dominated first. */
  accreteMax: 8,
  /** A chiefdom (fewer than absorbMembers members) whose capital would submit (at submit) to a larger neighbour joins it whole. */
  absorbMembers: 6,
  /** Reach: lambda = lambda0 * (1 + reachCrafts * (Crafts - 1)) / sqrt(1 + members / overload). */
  lambda0: 9,
  reachCrafts: 0.5,
  overload: 250,
  /** Power b = pop * q * (1 + prosperityPower * prosperity); q = 1 + qMetal (Metalworking - 1) + qCrafts (Crafts - 1). */
  prosperityPower: 0.5,
  qMetal: 0.3,
  qCrafts: 0.15,
  /** Overstretch: a realm with more than `great` of the world's people has its mass divided by 1 + (share - great) / stretch (0: off). */
  great: 0.2,
  stretch: 0.1,
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
  /**
   * Tiers (derived, see tierOf), relative to the world's people W (living settlements, outposts excepted): Kingdom >= kingdomMembers
   * members and max(kingdomPop, kingdomShare * W) people; Empire >= max(empirePop, empireShare * W) people, or two peoples each >=
   * multiShare of its people with >= multiMembers members and >= empirePop people.
   */
  kingdomMembers: 6,
  kingdomPop: 2000,
  kingdomShare: 0.008,
  empirePop: 20000,
  empireShare: 0.08,
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
  /** Whether a member next to a fellow member of another people is on a frontier (false: only foreigners outside the realm, rivals and enemies are). */
  subjects: false,
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
  /**
   * Flight: extra refugee chance flee * smoothstep(fleeLow, fleeHigh, z), z the smoothed danger (or the present one if lower);
   * under persistent danger the outlying fields go untilled: harvest * (1 - fieldsLost * smoothstep(fleeLow, fleeHigh, smoothed danger)).
   */
  fieldsLost: 0.18,
  flee: 0.06,
  fleeLow: 0.35,
  fleeHigh: 0.8,
  /**
   * Site and join scores: * (1 - site * zCell * (1 - D)), D = defensibility 0..1; walled towns pull the threatened: * (1 + z_from * wall).
   * New sites: * max(siteMin, 1 - siteNew * max(0, zCell - siteFree) * (1 - D)) (raided borderlands and pirate coasts, not a quiet frontier).
   */
  site: 1.0,
  siteNew: 5,
  siteFree: 0.15,
  siteMin: 0.05,
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

// --- polities v2 (design 5, 6.2, 6.5, 8.4, 9.1-9.3, 9.5, 9.7, 2.5) ---------------------------------

/** Trade policy (policy.ts): tariffs on imports crossing a border, embargoes against rivals short of war. */
export const TARIFF = {
  /** Target rate by tier (Chiefdom, Kingdom, Empire), plus war while at war, plus need * treasury need, plus rivalry * the worst rivalry with a neighbour. */
  base: [0.03, 0.06, 0.08],
  war: 0.06,
  need: 0.05,
  rivalry: 0.05,
  /** Treasury need: smoothstep(needHigh, needLow, capital wealth / (needRef * mass)). */
  needLow: 0.02,
  needHigh: 0.2,
  needRef: 1,
  /** Food (grain, fish, livestock) pays this share of the rate (cities must eat); an embargo short of war stops other goods only. */
  food: 0.2,
  /** Merchants pass most of a duty on to the buyers: only this share of it enters the price gap a flow must beat. */
  wedge: 0.3,
  /** goods: the high-value classes (Luxury to Wares, and the long-haul legs) pay this share of the rate (with the goods system off, Luxury and Stimulant pay it all). */
  hv: 0.5,
  /** The rate moves this share of the way to its target a year; at most max. */
  rate: 0.1,
  max: 0.6,
  /** Embargo between rivals short of war: from rivalry embargoOn, lifted below embargoOff. */
  embargoOn: 1.2,
  embargoOff: 0.85,
  /** Revenue (and seized contraband) is smoothed at this rate a year for the stats. */
  smooth: 0.1,
}

/**
 * Danger on the way of trade (policy.ts, trade.ts, goods/longhaul.ts, goods/routes.ts). The merchants' risk of a cell (0..1):
 * on land max((z - free) / (1 - free), outlaw danger) times (1 - peace * the owner state's enforcement there, a fort's town
 * fortBonus more: the king's peace), z the cell's danger (territory.ts zCell: war, battles, sacks, raids, revolt; a rival's
 * border, even its hostile edge (0.45), and the quiet frontier are free: merchants cross them), the outlaw danger outlaw.ts's
 * (pirates on coasts, bandits on roads); at sea the pirates' reach (dangerZ * pi fading over dangerHops sea hops of a haven).
 * Paths: the link search and the trade expeditions' searches price a cell at (1 + path * risk) of its travel cost (escorts,
 * tolls, detours), so new routes bend round dangerous ground and
 * merchants pick safer partners (the market then pays the way's own cost). Loss: a pair's way risk R is the worst cell
 * risk on its way; a share loss * R of what it carries is lost on the way (on top of the pirates' and bandits' own share, at
 * most maxLoss), and escorts raise its transport cost by escort * R: merchants price the loss as a share of the goods'
 * worth at the buyer's and the escorts per unit carried, so cheap bulk leaves a dangerous way first and dear goods run it
 * at a premium. A way that steps from one polity's land straight into its enemy's at war is closed to all but contraband
 * (a war front; warFront false switches that off).
 * Events: a route that carried at least majorLoads a year closing while its way risk is at least forsake (or across a war
 * front) is TradeForsaken; when it opens again, TradeRestored.
 */
export const WAYRISK = {
  /** false: the trade of before (no danger on the way; the polities' pirates, bandits, duties and embargoes as they were). */
  on: true,
  free: 0.45,
  path: 2,
  loss: 0.2,
  escort: 0.3,
  maxLoss: 0.6,
  peace: 0.6,
  fortBonus: 0.5,
  forsake: 0.2,
  majorLoads: 1000,
  warFront: true,
}

/** Smuggling (policy.ts, trade.ts): a share of the flow held back by duties or embargo moves as contraband. */
export const SMUGGLE = {
  /**
   * sigma = share * hide * (1 - enforcement) * incentive; hide = hideBase + hideSea [sea leg or coastal end] + hideRough * D of the ends +
   * hideTransit [stateless or outpost on the way]. Under a duty, sigma of each legal flow evades it; under an embargo, contraband is sigma of
   * what the market would move, at premium times the transport.
   */
  share: 1.5,
  hideBase: 0.3,
  hideSea: 0.3,
  hideRough: 0.4,
  hideTransit: 0.2,
  /** Incentive: tariffs tau / (tau + tauHalf); embargo and blockade embargo (1) and blockade. */
  tauHalf: 0.15,
  blockade: 0.6,
  /** Smugglers pay premium times the transport cost (no duty); a share seize * enforcement of the contraband is seized (to the enforcing capital). */
  premium: 1.3,
  seize: 0.3,
  /** The smugglers' cut: hubCut of the net gap they close goes to the hub (the least policed place on the way), untaxed by duties. */
  hubCut: 0.5,
  /** Enforcement = grip * A / (A + enfA) * (crisis ? crisisEnf : 1) * (1 - corruptEnf * corruption). */
  enfA: 0.2,
  crisisEnf: 0.6,
  corruptEnf: 0.5,
  /** Corruption moves corruptRate a year toward the contraband share of a settlement's income; it adds corruptUnrest * corruption to grievance. */
  corruptRate: 0.05,
  corruptUnrest: 0.15,
  /** A hub: contraband at least ringShare of its smoothed income and ringMin wealth a year (logged once per settlement: SmugglingRing). */
  ringShare: 0.7,
  ringMin: 150,
  /** Smoothing of incomes for the hub measure, a year. */
  smooth: 0.2,
}

/** Piracy and privateering, naval blockade (outlaw.ts). */
export const PIRACY = {
  /** The outlaw step (pirates, routes' losses, outlaw danger) runs every `step` years (a multiple of POLITY.slowStep); lanes are mapped every laneStep years (a multiple of POLITY.mapStep). */
  step: 20,
  laneStep: 40,
  /** Lanes: sea cells within reachHops sea hops of a coastal settlement; havens hit routes passing within reachHops. */
  reachHops: 3,
  /** Haven candidates: coastal, Seafaring >= seafaring, stateless or enforcement <= weakEnf. */
  seafaring: 1.4,
  weakEnf: 0.3,
  /**
   * pi moves rate a year toward pi* = D * lane / (lane + laneHalf) * (1 - navy) * (poor ? 1 : rich) * (1 + ban * tariff on the lanes),
   * D the haven's defensibility (islands, headlands, crags: open beaches make no pirate nests), poor: food < poorFood or prosperity < poorWealth.
   */
  rate: 0.03,
  /** A nest that took no lane at the last outlaw step aims at rival times pi*. */
  rival: 0.4,
  laneHalf: 2500,
  poorFood: 0.95,
  poorWealth: 0.25,
  rich: 0.5,
  ban: 2,
  /** Suppression: navy >= suppress decays pi by suppressRate a year. Navy of a polity with ports >= navyPorts: min(1, (Seafaring - 1) / navySea) * Proj / (Proj + Local of the haven). */
  suppress: 0.6,
  suppressRate: 0.2,
  navyPorts: 2,
  navySea: 1.5,
  /** Routes passing a haven lose lose * pi of their cargo (as cost: lossCost per unit share; the plunder to the haven). */
  lose: 0.15,
  lossCost: 1.2,
  /** Coastal danger: dangerZ * pi on coasts within dangerHops sea hops of a haven, fading with hops. */
  dangerZ: 0.7,
  dangerHops: 6,
  /** Coastal raids: a settlement in reach loses raidWealth * z of its wealth and raidPop * z of its people a year (to the haven). */
  raidWealth: 0.02,
  raidPop: 0.002,
  /** Settlements smaller than this lose no captives. */
  raidMinPop: 300,
  /** Events: PiratesRise when pi first reaches rise; suppressed below suppressed after it rose. */
  rise: 0.45,
  suppressed: 0.1,
  /** Privateering: a belligerent with navyPorts ports raids the enemy's sea routes, loss privateer; blockade (Seafaring >= the enemy's): the enemy's sea routes cost * (1 + lossCost * blockade). */
  privateer: 0.08,
  blockade: 0.6,
}

/** Banditry on overland routes (outlaw.ts). */
export const BANDIT = {
  /** Route cost * (1 + cost * max lawlessness over its land ends and transit settlements); lawless members as danger.ts, stateless next to a state stateless. */
  cost: 0.35,
  stateless: 0.06,
  /** Above toll, the route loses tollShare of its cargo to the most lawless settlement on it (protection money). */
  toll: 0.1,
  tollShare: 0.1,
  /** Bandit roads: danger roadZ * lawlessness on the land cells of such routes. */
  roadZ: 0.6,
}

/** Civil war, partition and reunification (civil.ts). */
export const CIVIL = {
  /** Rival centre: a member of at least rivalRatio times the capital's people (and rivalPop; see sizeRef), at least rivalDist * lambda from it. */
  rivalRatio: 0.3,
  rivalPop: 1000,
  rivalDist: 0.4,
  /** The rival centre's bar falls with the realm's size: / (1 + members / sizeRef); the civil war chance rises: * (1 + members / sizeCrisis). */
  sizeRef: 40,
  sizeCrisis: 200,
  /** Members at least this many for a civil war or a partition. */
  minMembers: 8,
  /** At a succession crisis with a rival centre: civil war with chance crisis; low cohesion (A < lowA): chance per step lowChance * (1 - A / lowA). */
  crisis: 0.25,
  lowA: 0.3,
  lowChance: 0.01,
  /** Sides: affinity sameFolk for the centre's own people, times route for an open route to it. */
  sameFolk: 1.3,
  route: 1.2,
  /** The winner of a civil war takes back every member of the loser that would submit at alpha. */
  alpha: 1.6,
  /** Partition: a crisis in a Kingdom or Empire with >= 2 heirs (towns of heirRatio times the capital's people, heirPop): chance partition. */
  partition: 0.15,
  heirRatio: 0.3,
  heirPop: 1000,
  /** The heirs' bar falls with the realm's size as the rival centre's does (/ (1 + members / sizeRef)). */
  heirSize: true,
  /** Reunification of kin (polities of one lineage and people, adjacent, at peace): the larger's Proj at the other's capital >= alphaKin * its defence, chance kinChance per slow step. */
  alphaKin: 1.2,
  kinChance: 0.1,
  kinRatio: 2,
}

/** Tribute, vassals, alliances (bonds.ts). */
export const VASSAL = {
  /** At peace: attacker advantage at the defender's capital >= vassalAdv (and the defender large: >= vassalMembers members, or of another people) makes it a vassal; tributeAdv..vassalAdv with nothing taken: tribute. */
  vassalAdv: 1.2,
  vassalMembers: 8,
  tributeAdv: 0.6,
  /** A realm too big to absorb whose capital would submit (at overawe) to a neighbour with overaweRatio times its people becomes its vassal. */
  overawe: 1.2,
  overaweRatio: 2,
  /** The vassal pays share of the grain tax its capital receives (as wealth) and share of its capital's wealth income; tribute pays tribute of it for tributeYears. */
  share: 0.15,
  tribute: 0.1,
  tributeYears: 30,
  /** It throws off the bond when the overlord's Proj at its capital falls below rebel * its mass. */
  rebel: 1,
  /** It is absorbed after absorbYears when the overlord's Proj at its capital >= absorb * its mass (and same people or assimilated). */
  absorbYears: 80,
  absorb: 3.5,
  /** When a large realm's capital falls to a foreign conqueror (>= vassalMembers members), its rump becomes the conqueror's vassal with chance fall instead of the shock submissions. */
  fall: 0.7,
}

export const ALLIANCE = {
  /** Two polities ally when a third has rivalry >= threat with both and theirs is < calm; an ally joins a defensive war with chance join; the bond lapses when both rivalries with the threat fall below lapse. */
  threat: 0.7,
  calm: 0.3,
  join: 0.5,
  lapse: 0.35,
  /** Alliances bind realms (Kingdom or larger) against a rival at least as large as each; chance per slow step. */
  chance: 0.25,
  /** Buffer states: attacking a small polity (< buffer times the attacker's people) between two rivals raises the other rival's rivalry with the attacker by bufferR. */
  buffer: 0.5,
  bufferR: 0.3,
}

/** City leagues (formation.ts leagues, design 2.5): stateless trading towns of comparable size bind together. */
export const LEAGUE = {
  /** Towns of minPop people linked by an open route of at least minVol loads a year, pop ratio below ratio, threatened (danger >= danger) or next to a polity of strong times their people. */
  minPop: 2000,
  minVol: 100,
  ratio: 2,
  danger: 0.3,
  strong: 3,
  /** A league whose members' mean danger stays below calm for calmYears loses a member each step (Hanseatic decline). */
  calm: 0.15,
  calmYears: 50,
}

/** Forts on passes and hostile borders (danger.ts wallStep). */
export const FORT = {
  /** Forts are planned every `step` years (a multiple of POLITY.slowStep). */
  step: 20,
  /** A member of a Kingdom or larger on a hostile border with smoothed danger >= danger builds a fort (chance per year chance * skill) on its most defensible hostile border cell; Local * (1 + bonus); lost below keep people or when sacked. */
  danger: 0.25,
  chance: 0.02,
  bonus: 0.5,
  minPop: 600,
  keep: 300,
}

/** Refugees of another people carry technology to the town that takes them in (migration.ts, design 9.5). */
export const REFUGEE = {
  /** gain = rate * group / people's population * max(0, L_from - L_to), capped at max per field; only groups fleeing danger >= danger. */
  rate: 0.3,
  max: 0.05,
  danger: 0.25,
}

/**
 * Claims (claims.ts): land a state claims beyond its settlements' own land, redrawn every POLITY.mapStep years after the
 * step. From its members' land a claim spreads over nobody's land at a step cost of sqrt(terrain move cost / cellScale)
 * (rough land is claimed more cheaply than it is crossed) out to a reach of share[tier] * lambda / cellScale times
 * 1 -/+ popBoost over smoothstep(popLow, popHigh, the state's people); a member's land starts with 1 - grip(its distance
 * from the capital) of that reach spent (remote members claim little). Where two claims meet a cell goes to the one that
 * has spent the smaller share of its reach (the stronger and the nearer). Natural limits: a claim never crosses the sea,
 * ice or anyone's land; it takes a great river (flow >= greatRiver * RIVER_FLOW_THRESHOLD) and goes no farther; it
 * does not step out of a desert (it ends at the desert's far edge); once it has crossed ground above crestElev it does
 * not descend more than crestDrop below the highest ground it crossed (it ends at the crest). Then the pockets: nobody's
 * land whose border (sea and ice aside) is at least `enclose` one state's land or claims is that state's, up to
 * `pocket` times its held cells and pocketShape * B^2 cells, B its border cells (an enclosure, not a coast's strip
 * behind one outpost: a round pocket is about 0.08 B^2), a chiefdom's only up to pocketChief cells.
 */
export const CLAIM = {
  /** Reach as a share of lambda, by tier (Chiefdom, Kingdom, Empire). */
  share: [0.08, 0.3, 0.4],
  popLow: 2000,
  popHigh: 50000,
  popBoost: 0.2,
  greatRiver: 6,
  crestElev: 0.45,
  crestDrop: 0.08,
  enclose: 0.85,
  pocket: 1,
  pocketShape: 0.25,
  pocketChief: 4,
  /** Siting (system.ts siteFactor): a site on a state's claims scores * (1 - deter) for anyone's settlers but the state's own. */
  deter: 0.15,
  /**
   * Border disputes: cells both of two neighbours' claims reach (where their claims meet) count as `dispute` contested
   * cells each in the pair's rivalry (relations.ts: claim * c / (c + claimHalf)); a pair whose claims meet over disputeMin
   * cells or more logs BorderDispute (once, until they meet over fewer).
   */
  dispute: 0.2,
  disputeMin: 4,
}
