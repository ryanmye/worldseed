// goods: tuning constants of worked goods, specialities, stocks and merchants, long-haul trade, trading posts,
// secrets and smuggling (goods/design.md). Kept apart from params.ts so the goods milestone merges cleanly; every
// constant here acts only while HistoryOptions.goods is on.
//
// Units as in params.ts: people, years, n = 48 cell units of travel cost, wealth in the trade system's units. Goods are
// counted in class units: one unit of a class is worth CLASS.worth[g] (grain 1); a variety of relative worth rel counts
// rel class units per unit (a unit of clove, worth 60, is 60 / 14 units of Luxury).

import { Good } from '../../../contract.ts'

/** Master switch default (HistoryOptions.goods). */
export const GOODS_ON = true

/** Parts of the system that can be switched off one by one (stats harness ablations only; all true in a normal run). */
export const FLAGS = {
  tools: true,
  arms: true,
  carry: true,
  longhaul: true,
  routes: true,
  workshops: true,
  techAct: true,
  brake: true,
  middlemen: true,
}

/**
 * Market classes (contract Good, GOOD_COUNT 13). HV: high-value classes (stocks kept with scarcity pricing, transit cuts,
 * a variety mix, the long-haul layer). Index order of the HV list is the priceIndex order (PRICE_INDEX_GOODS).
 */
export const CLASS = {
  /** Worth of a class unit (index Good): Grain .. Stimulant as GOODS.value; Metalware 10, Finery 20, Treasure 50, Wares 25. */
  worth: [1, 1.2, 1.4, 2, 5, 6, 2.5, 14, 9, 10, 20, 50, 25],
  /** Transport per class unit per cell unit (Metalware, Finery, Treasure, Wares appended to GOODS.transport). */
  transport: [0.035, 0.045, 0.04, 0.05, 0.06, 0.06, 0.05, 0.06, 0.055, 0.06, 0.05, 0.03, 0.05],
  /** High-value classes. */
  hv: [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
  /** Classes with a variety mix (Luxury, Metalware, Finery, Treasure; Wares later), and each one's mix index. */
  mixed: [Good.Luxury, Good.Metalware, Good.Finery, Good.Treasure] as readonly number[],
}

/** Variety mix: K named slots per trader per mixed class (the rest is the unnamed Common remainder). */
export const MIX = {
  K: 4,
  /** At most this many varieties in a world (ids below it; the rumour table is peoples * maxVarieties). */
  maxVarieties: 1024,
  /** Below this a slot is dropped (its amount goes to Common). */
  epsilon: 1e-6,
}

/**
 * Stocks carried over (3.2) and scarcity pricing (3.3). After the market each trader consumes C = min(S, D) (Treasure: wear
 * of its stock), and keeps min(keep * (S - C), capYears * D + [mart] * kappa * wealth / worth) for next year.
 * HV prices: worth * (1 + k) / (k + S / D); bulk prices keep 2 / (1 + S / D).
 */
export const STOCK = {
  /** Share of the leftover that keeps a year, per class (food 0: storage.ts decides what food keeps). */
  keep: [0, 0, 0, 0, 0, 0, 0, 0.85, 0.8, 0.95, 0.9, 0.98, 0.95], // (bulk classes keep nothing: as before goods)
  /** Years of demand a trader keeps at most (bulk 1, HV 2). */
  capYearsBulk: 1,
  capYearsHV: 2,
  k: 0.2,
  /** Merchant capital: a mart can hold kappa * wealth / worth class units beyond its own needs. */
  kappa: 0.05,
  /** Treasure wear a year (hoards, temples, burial): its only consumption. */
  treasureWear: 0.02,
  /** Price cap of an HV class as a multiple of worth (at no stock: (1 + k) / k = 6). */
  maxRatio: 6,
  /** The gap a trader earns on (half of it, as for bulk goods) is counted up to incomeGap * worth a unit: scarcity moves goods
   *  far, but a glutted source and a starved buyer do not mint wealth beyond what the old two-times price let them. */
  incomeGap: 0.25,
  /** Exporters' margin on HV goods: this share of TRADE.margin * worth (bulk goods keep the whole margin). */
  hvMargin: 0.5,
  /** Local merchants deal in the HV classes on each pair every hvEvery years (pairs staggered by their index). */
  hvEvery: 2,
}

/**
 * Middlemen (3.4): each trading transit settlement x of a chained local pair takes mu_x = r_x * season + toll of the
 * sender's price on HV classes, as a real cost to the pair and as its own income; r_x = r0 / (1 + rTech * (Crafts_x - 1)).
 */
export const MIDDLE = {
  r0: 0.25,
  rTech: 0.5,
  season: 0.25,
  toll: 0.03,
  /** Pairs' transit cuts are reckoned again every this many years. */
  refresh: 10,
}

/**
 * Demand of the new classes (per person a year, times 1 + GOODS.demandTech * (Crafts - 1)):
 *   Metalware: tools * pop + arms demand (below);
 *   Finery: finery * pop * (luxTown * smoothstep(luxTownLow, luxTownHigh, pop) + luxWealth * w / (w + half)) * court;
 *   Treasure (a desired holding): treasure * pop * (treasureBase + w / (w + half)) * court;
 *   Luxury: as cash crops reckon it, times court.
 * court = 1 + courtK * [capital] * tierIndex (chiefdom 0, kingdom 1, empire 2).
 */
export const DEMAND = {
  tools: 0.004,
  finery: 0.004,
  treasure: 0.002,
  treasureBase: 0.2,
  courtK: 1.5,
  /** Raw ore's own demand (GOODS.need Ore) is mostly worked into Metalware now: this share of it remains. */
  oreRaw: 0.3,
  /** Bog iron: every base catchment cell (weight w) yields bogIron * w units of ore a year at full labour and Metalworking 1. */
  bogIron: 0.4,
  /** Buyers of Finery pay CASHCROP.pay of its value out of their wealth, as for Luxury. */
  fineryPays: true,
}

/**
 * Tools and arms (1.6). Consumed Metalware goes into the tools stock T and the arms stock A in proportion to the two demands;
 * T wears toolWear a year, A armsWear. toolFactor = t / (t + toolHalf), t = T / pop: farm food * (1 + toolFarm * toolFactor),
 * artisans * (1 + toolArtisan * toolFactor). Arms: military quality * (1 + armsQ * a / (a + armsHalf)), a = A / pop
 * (fine-blade varieties count rel times), with POLITY.qMetal lowered to qMetal.
 * Arms demand = arms * pop * (member ? 1 : stateless) * (capital or hostile border ? front : 1) * (at war ? war : 1).
 */
export const METAL = {
  toolWear: 0.05,
  armsWear: 0.03,
  toolHalf: 0.04,
  toolFarm: 0.08,
  toolArtisan: 0.3,
  armsQ: 0.4,
  armsHalf: 0.03,
  qMetal: 0.15,
  arms: 0.0015,
  stateless: 0.3,
  front: 2,
  war: 3,
}

/**
 * Workshops (1.5), like cash crops with artisans in place of fields:
 *   artisans = craftShare * pop * smoothstep(artLow, artHigh, pop) * (1 + toolArtisan * toolFactor)
 *   share*_r = smoothstep(0, 1, margin_r / (worth_out * marginRef)), normalised; share_r moves `rate` a year toward it
 *   output_r = share_r * artisans * prod_r * skill_r * min(1, held inputs / need)
 * Recipes (index): 0 smithing (Ore + 0.5 Timber -> Metalware, prod 0.4 * Metalworking, gate M 1.3), 1 dyeing (Cloth + 0.15
 * dye -> Finery, 0.5 * Crafts, gate C 1.5), 2 fine cloth (1.6 Cloth -> Finery, 0.4 * Crafts, gate C 1.8). Fine blades are
 * the smithing of a Blades tradition's seats (gate M bladeGate).
 */
export const WORKSHOP = {
  craftShare: 0.03,
  artLow: 400,
  artHigh: 5000,
  marginRef: 0.25,
  rate: 0.1,
  /** Per recipe: output class, inputs (class, units per unit out) x2, prod per artisan per field level, field, gate. */
  out: [Good.Metalware, Good.Finery, Good.Finery],
  in1: [Good.Ore, Good.Cloth, Good.Cloth],
  need1: [1, 1, 1.6],
  in2: [Good.Timber, Good.Luxury, -1],
  need2: [0.5, 0.15, 0],
  prod: [0.4, 0.1, 0.08],
  field: [2, 3, 3], // TechField: Metalworking, Crafts, Crafts
  gate: [1.3, 1.5, 1.8],
  /** Fine blades: gate on Metalworking, and the share of a seat's smithing that is fine work. */
  bladeGate: 2.4,
  bladeShare: 0.5,
  /** Technology: Metalworking activity += smith * smithing output, Crafts += work * other workshop output * (1 + renowned * renowned seats of the people). */
  smith: 10,
  work: 10,
  renowned: 0.2,
}

/**
 * Deposits (1.4), placed once by geology from the 'history-goods' stream (counts at n = 48, scaled by area; at least spacing
 * hops between two of a kind). Kinds: Gold placer and lode (both DepositKind.Gold), Silver (one bonanza), Gems, Amber, Pearls,
 * Murex. Per kind (index order placer, lode, silver, gems, amber, pearls, murex):
 */
export const DEPOSIT = {
  count: [2, 3, 4, 3, 2, 2, 2],
  /** Relative worth (value / class worth): gold 60 / 50, silver 40 / 50, gems 80 / 50, amber 30 / 14, pearls 40 / 14, murex 50 / 14. */
  rel: [1.2, 1.2, 0.8, 1.6, 2.1, 2.9, 3.6],
  /** Yield a year at richness 1 and full labour (class units, before Metalworking). */
  yield: [3, 2, 4, 1, 2, 1.5, 0.5],
  /** Reserve in years of yield at richness 1 (0: inexhaustible). */
  reserve: [140, 1200, 900, 1500, 0, 0, 0],
  /** Gate: technology field and level (-1: none). */
  gateField: [2, 2, 2, 2, -1, 1, 3],
  gateLevel: [1.0, 1.6, 1.6, 1.3, 0, 1.4, 1.5],
  bonanza: 5,
  /** The bonanza's reserve in years of its yield (it gives out in about this long). */
  bonanzaYears: 250,
  spacing: 12,
  /** Prospecting every 10 years: chance smoothstep(prospLow, prospHigh, Metalworking) * (placer ? placerFind : find). */
  find: 0.25,
  placerFind: 0.6,
  /** Prospectors of a settlement within rushHops whose fields do not reach it find it at this share of the chance. */
  farFind: 0.4,
  prospLow: 0.8,
  prospHigh: 1.6,
  /** Output = yield * richness * lab * (1 + techMul * (M - 1)) * sqrt(R / R0), lab = pop / (pop + workHalf) (a camp counts campPop). */
  workHalf: 500,
  campPop: 600,
  techMul: 0.5,
  /** A deposit gives out (MineExhausted) when output falls below `exhausted` of its peak. */
  exhausted: 0.05,
  /** The rush: for rushYears after a find, migration site and join scores within rushHops * (1 + rushK * treasure share). */
  rushYears: 30,
  rushHops: 3,
  rushK: 2,
  /** Boom: a find whose output passes boom of the world's Treasure output. */
  boom: 0.25,
  /** A small working settlement (not trading) sells what it mines to the nearest trader within sinkHops hops. */
  sinkHops: 12,
  /** Mining camp: people sent with the camp (from the finder), and its supply cost per person per route cost unit. */
  campFound: 40,
}

/** Furs (2.1): settlements and bases on Taiga or Tundra beyond |y| >= polarY yield furs a head (outposts: perBase a year) as Luxury of their people. */
export const FURS = {
  polarY: 0.8,
  perHead: 0.0015,
  perBase: 1.5,
  rel: 20 / 14,
}

/** Cash crops (2.1): the fit a Luxury species needs to be grown for trade (CASHCROP.minFit for the rest). */
export const CROPS = {
  luxMinFit: 0.45,
}

/**
 * Traditions (2.2), every 10 years at year % 10 = 5. Practice moves `practice` a decade toward the recipe output of its kind;
 * birth at pop >= birthPop when practice >= birthShare * pop, chance birth * smoothstep(1, 3, practice / (birthShare * pop)),
 * no living tradition of the kind of the same people within spacing hops. Quality dQ = up * (Qcap - Q) * u - down * Q * (1 - u)
 * a decade, u = out / (out + birthShare * pop), Qcap = 1 + capField * (field - gate) + capSeat * min(2, seats - 1) + bonus.
 */
export const TRADITION = {
  practice: 0.2,
  birthPop: 2000,
  birthShare: [0.004, 0.004, 0.005, 0.011], // (per craft: Silk, Dyeing, FineCloth, Blades)
  birth: 0.25,
  spacing: 12,
  up: 0.15,
  down: 0.03,
  capField: 0.4,
  capSeat: 0.3,
  qMin: 0.5,
  qMax: 3,
  renowned: 2,
  /** Seats: a settlement of the same people within clusterHops whose output of the kind is >= clusterShare of the birth threshold, chance cluster a decade. */
  clusterHops: 4,
  clusterShare: 0.5,
  cluster: 0.25,
  /** Craftsmen: on a Migration from a seat, chance carry * (group / pop) * push * (1 - 0.7 pi); daughters start at Q * daughter. */
  carry: 0.25,
  daughter: 0.6,
  farHops: 12,
  /** Deportation after a Sack: chance, quality kept. */
  deport: 0.3,
  deportQ: 0.7,
  /** A seat is lost after deadYears with u below deadU. */
  deadYears: 30,
  deadU: 0.1,
  /** Relative worth of a tradition's variety at quality 1 (Silk, Dyeing, FineCloth, Blades): rel = base * (0.6 + 0.4 Q); output * (0.8 + 0.2 Q). */
  base: [1.5, 1.2, 1.3, 2],
  /** Steel (the Blades secret): Qcap bonus. Purple (the Dyeing secret with murex): rel. */
  steelBonus: 0.5,
  purpleRel: 3.6,
}

/**
 * Marts and the long-haul layer (3.5). Rebuilt every 10 years at year % 10 = 1: traders of pop >= minPop scored by
 * through + port * hubRef * [port] + capital * hubRef * [capital of a kingdom or more], best first, up to maxMarts (scaled by
 * area), with the forced members. Relay legs: from each mart a search over the settlement links (reach * TRADE.reach, at most
 * maxNodes settlements) keeps the `relay` nearest marts. Forward prices: H rounds over the legs.
 */
export const MART = {
  minPop: 800,
  maxMarts: 96,
  port: 2,
  capital: 1,
  reach: 2.5,
  maxNodes: 150,
  relay: 3,
  H: 2,
  /** Carrier's share of the net gap on a leg (the seller keeps the rest). */
  carrier: 0.7,
  /** One year a leg (the relay hop's capital is tied up a season). */
  legYears: 1,
  /** Risk of a relay hop (per hop, a share of value). */
  risk: 0.03,
  /** polities v2: the smugglers' hub of a leg is the least policed settlement on its way (else the importer). */
  hubTransit: true,
}

/**
 * Rumour, the route-seeking urge, trade expeditions and lanes (4.1-4.3), every 10 years at year % 10 = 7 per mart.
 */
export const LANE = {
  /** A mart of people p hears of a variety at share >= hear of a class in its stock. */
  hear: 0.05,
  /** Urge: U += 10 * urge * Pi / (Pi + half * worth) * smoothstep(0.3, 0.7, prosperity) * (1 + tech * (driveTech - 1)). */
  urge: 0.06,
  half: 12,
  tech: 0.5,
  /** Guess of the direct cost: transport * great-circle cells * guess * ocean factor. */
  guess: 1.3,
  /** Gates: Seafaring for an open-ocean lane, for a coastal one; overland lanes need Crafts and pack animals. */
  oceanSea: 2.2,
  coastSea: 1.6,
  landCrafts: 1.8,
  /** Cost of the expedition: costMul * EXPLORE.cost * group * (1 + cells / costCells); a kingdom's capital pays with polityMul times it. */
  costMul: 2,
  polityMul: 2,
  /** Range: rangeMul times the exploration range; the search stops after maxVisits cells. */
  rangeMul: 1.5,
  maxVisits: 4000,
  /** Targets: cells within targetHops of the source, or of a mart holding the variety at >= martShare. */
  targetHops: 2,
  martShare: 0.2,
  /** No target in range: wait retry years with the urge at retryUrge. */
  retry: 20,
  retryUrge: 0.5,
  /** Capacity: starts at cap0 * home demand; * grow a year above highUse, * shrink below lowUse; at most capMax * pop * Seafaring. */
  cap0: 0.2,
  grow: 1.1,
  shrink: 0.95,
  highUse: 0.8,
  lowUse: 0.4,
  capMax: 0.02,
  /** Risk: loss = risk * h / (1 + h) / (1 + sailed / riskYears); FleetLost at chance loss * fleetLost a year. */
  risk: 0.5,
  riskYears: 10,
  fleetLost: 0.3,
  /** A lane longer than season * the sea range gets a victualling station near its midpoint. */
  season: 0.5,
  /** A lane closes after idle years without cargo. */
  idle: 50,
  /** A source reached by this many open lanes (of others) draws no new venture. */
  rivals: 2,
  /** Weight of each class in the urge (spices, silk and fine cloth were what lanes were opened for; bullion followed). */
  classWeight: [0, 0, 0, 0, 0, 0, 0, 1, 1, 0.3, 1, 0.15, 1],
  /** The lane's urge only for varieties whose saving Pi exceeds minSave * worth, from a source at least minCells hops away (great circle). */
  minSave: 2,
  minCells: 25,
}

/** Trading posts (4.4). */
export const POST = {
  /** Factory: a lane end at a foreign trader of at least factoryPop in contact, at peace with the sponsor. */
  factoryPop: 1000,
  /** Fort / station: people sent, supply years, self-sufficient at pop and food. */
  fortPop: 60,
  supplyYears: 60,
  selfPop: 1000,
  selfFood: 0.9,
  /** Supply cost a year: supply * pop * route cost of the post (like an outpost), from the owner's wealth; strikes before it is lost.
   *  A supplied post's food is topped up to fed * its people (from the owner), and every colonyStep years the owner sends
   *  colonists: colonyShare of its people (at most colonyMax) while it has at least colonyPop. */
  supply: 0.05,
  strikes: 8,
  fed: 1.05,
  colonyStep: 10,
  colonyShare: 0.02,
  colonyMax: 250,
  colonyPop: 2000,
  /** A factory's host takes muShare of its usual cut on the sponsor's goods. */
  muShare: 1 / 3,
  /** A factory is expelled after relation R >= expel for expelYears. */
  expel: 0.8,
  expelYears: 20,
}

/** Bypassed (4.6): logged when the 20-year relay income falls below share of its peak (peak after peakYear) within lanes years of a lane carrying >= varShare of its relay value. */
export const BYPASS = {
  share: 0.4,
  peakYear: 500,
  lanes: 60,
  varShare: 0.3,
  smoothing: 0.05,
}

/**
 * Secrets (5), every 10 years at year % 10 = 9. Guard psi* = smoothstep(rentLow, rentHigh, rent / income), psi moves halfway;
 * cost 0.4 * psi * producers' pop / 1000 from the capital (psi halves if unpaid). Stateless holders psi = stateless.
 * Leak rates per decade, per channel (5.4).
 */
export const SECRET = {
  rentLow: 0.03,
  rentHigh: 0.2,
  cost: 0.4,
  stateless: 0.15,
  /** Monopoly rent: rho = rent * psi of the sender's price on the secret varieties leaving the holder polity. */
  rent: 0.3,
  contact: 0.02,
  /** Craft secrets pass by contact at this share of the rate (tacit skill travels with craftsmen, not goods). */
  craftContact: 0.1,
  contactHalf: 200,
  espionage: 0.06,
  spyLow: 0.05,
  spyHigh: 0.3,
  spyCost: 0.5,
  protect: 0.85,
  /** Smuggled seeds or tools: smuggling * sv / (sv + smuggleHalf), sv the contraband value of the secret's goods reaching the people a year (polities v2's smuggling). */
  smuggling: 0.02,
  smuggleHalf: 200,
  /** The monopoly rent's smuggled share: SMUGGLE.share * hide * (1 - the holder's enforcement) * rho / (rho + rentHalf) (polity/params.ts SMUGGLE). */
  rentHalf: 0.5,
  /** SecretSmuggled is logged once per secret and people when its contraband reaching the people first reaches smuggledMin a year. */
  smuggledMin: 20,
  rediscovery: 0.005,
  chart: 0.008,
  chartGuard: 0.6,
  chartWar: 0.03,
  /** Inside a holder polity, other ports gain a chart after chartYears * psi years. */
  chartYears: 30,
  /** Defection: push per event (Sacked, Famine, Revolt; a Migration to another people: migration * group / pop * 50). */
  pushSack: 0.3,
  pushFamine: 0.05,
  pushRevolt: 0.05,
  pushMigration: 0.01,
  /** MonopolyBroken: the original holder's share of world output falls below `broken`. */
  broken: 0.5,
  /** The four secret species (archetypes). */
  species: ['silk', 'tea', 'cloveNutmeg', 'cochineal'] as readonly string[],
}

/**
 * Technology (Q4 brake): what a people gains by diffusion is capped at its own level (grown from its own and its partners'
 * activity) plus `cap`.
 */
export const DIFFUSION = {
  cap: 0.5,
}
