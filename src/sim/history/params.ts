// Tuning constants for the settlement history, in one place.
//
// Units: people, years, and "cell units" of travel cost (one n = 48 cell of
// easy grassland costs 1). Per-cell capacities are scaled by cell area, so
// totals are roughly resolution independent.

export const HISTORY_DEFAULTS = {
  years: 2000,
  snapshotInterval: 5,
  /** Years between land-use / degradation / road snapshots (three Uint8 matrices of cellCount each; ~7 MB at n = 48). */
  landInterval: 20,
  /** Years between trade-volume snapshots (Float32 per route per snapshot). */
  tradeInterval: 10,
}

export const CAPACITY = {
  /** People per n = 48 cell per unit of fertility, at year-0 productivity. */
  base: 60,
  /** Farming yield by biome id (Ocean, Coast, Ice, Tundra, Taiga, TemperateForest, Grassland, Desert, Savanna, Rainforest, Mountain). */
  agri: [0, 0, 0, 0.06, 0.2, 0.75, 0.9, 0.03, 0.65, 0.4, 0.05],
  /** River bonus per (flow / RIVER_FLOW_THRESHOLD)^0.75, capped at riverMax. */
  river: 0.45,
  riverMax: 20,
  /** Small streams below the river threshold: bonus per (flow / threshold). */
  creek: 0.2,
  /** Fishing bonus for land next to shallow sea, any open sea, or a lake. */
  fishShallow: 0.45,
  fishSea: 0.3,
  fishLake: 0.3,
  /** Cells with base capacity below this (people at n = 48) count as uninhabitable. */
  habitableMin: 3,
}

export const CATCHMENT = {
  /** Catchment distance of one hop along a river, across a lake, and between two coastal cells (else 1). */
  riverEdge: 0.5,
  lakeEdge: 0.6,
  coastEdge: 0.7,
  /** Every settlement feeds from cells within this distance (n = 48 hops). */
  hops: 2,
  /** Large settlements reach further for food (markets, tribute), up to this many hops. */
  maxHops: 4,
  /** Weight of a catchment cell by distance (interpolated; index 0 = own cell). */
  weights: [1, 0.6, 0.3, 0.2, 0.12],
  /** Reach grows from `hops` to `maxHops` as population goes from reachLow to reachHigh. */
  reachLow: 1000,
  reachHigh: 6000,
  /** No new settlement within this many hops of a living one (at n = 48). */
  exclusionHops: 1,
}


/** Productivity (technology stand-in): 1 + linear * y + quad * y^2. Reaches 4 at year 2000. */
export const PRODUCTIVITY = {
  linear: 0.0006,
  quad: 0.00000045,
}

export const POPULATION = {
  /** Intrinsic yearly growth rate when well fed. */
  growth: 0.018,
  /** Fraction of the food shortfall (people unfed) that dies in a year. */
  famineMortality: 0.5,
  /** A famine event is logged when the food ratio falls below this ... */
  famineRatio: 0.65,
  /** ... the settlement loses at least this fraction of its people ... */
  famineLoss: 0.15,
  /** ... it had at least this many people ... */
  famineMinPop: 300,
  /** ... and it has not had a logged famine in this many years. */
  famineCooldown: 30,
  /** Settlements below this are abandoned. */
  abandonPop: 15,
  /** Founding tribes: count range and size range. */
  tribesMin: 4,
  tribesMax: 8,
  tribePopMin: 40,
  tribePopMax: 100,
}

export const WEATHER = {
  /** Number of weather regions (Voronoi cells of random centres). */
  regions: 48,
  /** Regional anomaly: AR(1) persistence and innovation std dev. */
  regionalPersistence: 0.5,
  regionalSigma: 0.07,
  /** Regional drought: chance per region per year, severity range, duration range (years). */
  droughtChance: 1 / 90,
  droughtMin: 0.25,
  droughtMax: 0.6,
  droughtYearsMin: 1,
  droughtYearsMax: 3,
  /** Global anomaly: AR(1) persistence and innovation std dev. */
  globalPersistence: 0.6,
  globalSigma: 0.025,
  /** Global crisis (volcanic winter, climate swing): chance per year, severity, duration. */
  crisisChance: 1 / 130,
  crisisMin: 0.12,
  crisisMax: 0.3,
  crisisYearsMin: 2,
  crisisYearsMax: 6,
  /** Harvest multiplier is clamped to this range. */
  harvestMin: 0.15,
  harvestMax: 1.4,
}

export const MIGRATION = {
  /** Yearly chance of a group leaving at full population pressure (pop / expected food >= pressureHigh). */
  pressureChance: 0.06,
  pressureLow: 0.5,
  pressureHigh: 0.9,
  /** Yearly chance of a group leaving at deep hunger (food ratio <= hungerLow). */
  hungerChance: 0.25,
  hungerLow: 0.5,
  hungerHigh: 0.9,
  /** Group size as a fraction of the population. */
  groupMin: 0.12,
  groupMax: 0.3,
  /** Minimum headcount of a migrating group, and minimum population to send one. */
  minGroup: 20,
  minPop: 60,
  /** Smaller settlements leave all together instead, at this fraction of the hunger chance. */
  exodusChance: 0.5,
  /** Travel budget in cell units, scaled by (1 + budgetTech * (productivity - 1)) and a random factor. */
  budget: 8,
  budgetTech: 0.25,
  budgetJitterMin: 0.7,
  budgetJitterMax: 1.3,
  /** Deep-ocean cost per cell at productivity 1; divided by sqrt(productivity). */
  oceanCost: 14,
  /** Sea-cell cost multiplier (shallow and deep) for groups leaving a settlement without a port; see PORT for those with one. */
  seaNoPort: 1.4,
  /** Rare long voyages: chance, budget multiplier, ocean cost multiplier. */
  voyageChance: 0.01,
  voyageBudget: 2.5,
  voyageOcean: 0.5,
  /** Search stops after settling this many cells (bounds the cost of a search). */
  maxVisits: 500,
  /** After finding nowhere to go, a settlement waits this many years before sending colonists / refugees again. */
  retryColonists: 80,
  retryRefugees: 5,
  /** Score = value * (1 + emptyPull * free^2) * jitter / (1 + costPenalty * cost / budget), free = share of the site's land nobody else works. */
  costPenalty: 0.6,
  emptyPull: 1,
  /** A new site must offer at least this multiple of the group size in free capacity. */
  foundMinRatio: 2,
  /** Refugees join only a settlement below joinRoom * its expected food after they arrive, fed at least joinFood this year. */
  joinRoom: 0.85,
  joinFood: 0.95,
  /** Joining: weight on spare capacity, and pull of larger settlements (half-strength at this population). */
  joinBias: 1,
  urbanDraw: 0.6,
  urbanHalf: 3000,
}

/**
 * Land use: each settlement cultivates its catchment, nearest cells first,
 * until the cultivated share feeds its people; per-cell use moves toward that
 * target quickly when fields are cleared and slowly when they go wild.
 */
export const LAND = {
  /** Land use and degradation advance every `step` years (rates below are per year). */
  step: 2,
  /** Yearly fraction of the gap closed when use rises (clearing) and when it falls (fields going wild). */
  clearRate: 0.2,
  wildRate: 1 / 30,
  /** Unused land with use or degradation below this (half a Uint8 step) snaps back to exactly wild. */
  epsilon: 0.5 / 255,
}

/**
 * Degradation (soil exhaustion, erosion): yearly, with intensity e = clamp((use - onset) / (1 - onset), 0, 1)
 * and crowding c = (people / food the land gives them) of the settlements farming the cell,
 *   load = e^2 * fragility * (stressBase + (1 - stressBase) * smoothstep(crowdLow, crowdHigh, c))
 *   deg += rate * max(0, load - tolerance) * (1 - deg) - deg * (recovery * (1 - use) + renewal)
 * and a cell's farm capacity is multiplied by (1 - yieldLoss * deg). Sturdy land under moderate use
 * stays below the tolerance and keeps its soil; fragile land (steep, arid, thin forest soils) wears
 * even under moderate use, and any land wears when an over-crowded settlement (or a city living on
 * imports) works it to the bone. Floodplains are renewed by silt.
 */
export const DEGRADATION = {
  rate: 0.012,
  onset: 0.25,
  tolerance: 0.45,
  stressBase: 0.3,
  crowdLow: 0.8,
  crowdHigh: 1.1,
  /** Recovery of land left alone (forest regrowth), and the natural renewal that acts even under use. */
  recovery: 0.006,
  renewal: 0.0012,
  yieldLoss: 0.85,
  /** Fragility = 1 + slope * smoothstep(0.03, 0.15, slope) + arid * (1 - smoothstep(0.1, 0.4, rain)) + biome[b], times floodplain on rivers. */
  slope: 1.2,
  arid: 1.0,
  /** Extra fragility by biome id (cleared rainforest and taiga soils are thin). */
  biome: [0, 0, 0, 0.3, 0.8, 0, 0, 0.5, 0.2, 1.0, 0.5],
  /** River floodplains: silt renews them. Creeks get part of this, in proportion to flow / threshold. */
  floodplain: 0.1,
}

/** Ports: built by coastal settlements of some size; better fishing and cheaper sea travel. */
export const PORT = {
  /** Minimum population, and yearly chance of building once eligible. */
  pop: 400,
  chance: 0.05,
  /** Falls out of use when the owner drops below keep * pop. */
  keep: 0.5,
  /** The owner draws fish * (1 + fish) from coastal catchment cells. */
  fish: 1.2,
  /** Groups leaving a port: deep-ocean cost and shallow-water cost multipliers, voyage chance. */
  oceanMul: 0.4,
  seaMul: 0.5,
  voyageChance: 0.04,
  /** Coastal sites within this many sea hops (n = 48) of a living port score higher for founders. */
  range: 10,
  sitePref: 0.3,
}

/**
 * Voyages of settlement (voyages.ts): coastal settlements, ports far more often, send colonising
 * expeditions by sea. Ranges and costs are in n = 48 cell units of sea travel (a shallow cell costs 1).
 */
export const VOYAGE = {
  /** Senders: coastal settlements of at least minPop people. */
  minPop: 100,
  /** Yearly chance of an expedition from a coastal settlement without / with a port, at full drive. */
  coastChance: 0.012,
  portChance: 0.012,
  /** Drive = drive0 + (1 - drive0) * population pressure (as for colonists); wealth multiplies the chance by 1 + wealthChance * prosperity. */
  drive0: 0.2,
  wealthChance: 1,
  /** Chance multiplier while a known, still open land discovered from the sender's landmass lies within reach. */
  knownBoost: 2,
  /** Sea range: base (no port / port) * (1 + rangeTech * (productivity - 1)) * (1 + wealthRange * prosperity) * (1 + sizeRange * smoothstep(sizeLow, sizeHigh, pop)) * jitter. */
  coastRange: 7,
  portRange: 9,
  rangeTech: 1,
  wealthRange: 1,
  sizeRange: 0.5,
  sizeLow: 300,
  sizeHigh: 10000,
  jitterMin: 0.6,
  jitterMax: 1.4,
  /** Now and then (boldChance) an expedition sails boldRange times further. */
  boldChance: 0.1,
  boldRange: 1.8,
  /** Cost of a deep-ocean cell (shallow costs 1) without / with a port. Sea ice is impassable. */
  deep: 2,
  deepPort: 1.4,
  /** Sailing for a known land: range at least 1.1 * the discovery's cost, up to knownRangeMax * range. */
  knownRangeMax: 1.6,
  /** The search stops after this many sea cells, or after this many acceptable landfalls. */
  maxVisits: 4000,
  maxCandidates: 16,
  /** A landfall on the sender's own landmass counts this much toward maxCandidates. */
  homeCount: 0.5,
  /** Group: this share of the sender's people, clamped to [groupLow, groupHigh]. */
  groupMin: 0.06,
  groupMax: 0.15,
  groupLow: 25,
  groupHigh: 250,
  /** A landfall must leave the group at least this share of what the land would give it alone (sparsely settled at most). */
  freeMin: 0.6,
  /** Landfall value multipliers: river mouth, another landmass than the sender's, a landmass with nobody on it, a known open land. */
  riverMouth: 0.4,
  otherLand: 1,
  emptyLand: 1,
  knownPref: 1,
  /** Score = value * free share * jitter / (1 + costPenalty * cost / range). */
  costPenalty: 1.5,
  /** Loss at sea: 1 - 1 / (1 + lossBase + lossDeep * deep cells / (1 + lossTech * (productivity - 1))), times knownSafe on a known route. */
  lossBase: 0.1,
  lossDeep: 0.04,
  lossTech: 0.5,
  knownSafe: 0.6,
  /** Survivors on landing: group * (1 - U(0, attrition) * cost / range). */
  attrition: 0.3,
  /** Years before a settlement sends again: after finding no landfall (times the number of such searches in a row, at most retryMax), after a loss, after a colony. */
  retry: 40,
  retryMax: 4,
  /** A search from a weather region that found no landfall stops voyages of range up to newsMargin times its range from there for newsYears. */
  newsYears: 50,
  newsMargin: 1.25,
  retryLost: 15,
  cooldown: 10,
  /** Hard first years of a seaborne colony: for hardYears, a yearly chance of losing U(hardMin, hardMax) of its people. */
  hardYears: 25,
  hardChance: 0.04,
  hardMin: 0.15,
  hardMax: 0.5,
  /** A discovered landmass stays "open" (worth sailing for) while it has fewer than max(3, habitable cells / openPer) settlements. */
  openPer: 12,
  /** Travel time in years: travelBase + travelPerCell * path cells, at most travelMax. */
  travelBase: 0.4,
  travelPerCell: 0.05,
  travelMax: 3.5,
}

/** Dams: built by towns on sizeable rivers in dry or famine-struck places. */
export const DAM = {
  /** Minimum owner population, minimum river flow (multiples of RIVER_FLOW_THRESHOLD) at the dam. */
  pop: 3000,
  minFlow: 3,
  /** Falls out of use when the owner drops below keep * pop. */
  keep: 0.5,
  /** Yearly chance at full risk; risk = aridity at the owner + famineRisk if it had a famine in famineMemory years. */
  chance: 0.015,
  famineRisk: 0.3,
  famineMemory: 50,
  /** The dam sits at most this many river steps (n = 48) upstream of its settlement. */
  upHops: 4,
  /** Irrigation reaches this many river steps (n = 48) downstream of the dam, and the land cells beside them at half strength. */
  reach: 5,
  /** Farm capacity multiplier on irrigated cells: 1 + irrigation * (0.3 + 0.7 * aridity). */
  irrigation: 2.5,
  /** Share of the dam cell's farmland lost under the reservoir. */
  reservoirLoss: 0.5,
  /** Fraction of a harvest shortfall the owner's stored water makes good. */
  droughtDamp: 0.5,
}

/** Travel cost of entering a cell, by biome id (land and shallow water); deep ocean uses MIGRATION.oceanCost. */
export const MOVE_COST = {
  biome: [0, 2.4, 8, 1.8, 1.6, 1.4, 1, 3.2, 1.1, 2.2, 4.5],
  /** Extra cost on high ground: + highland * smoothstep(0.3, 0.7, elevation). */
  highland: 3,
  /** Rivers: cost becomes riverBase + riverScale * cost. */
  riverBase: 0.45,
  riverScale: 0.25,
  /** Coastal land multiplier. */
  coastal: 0.85,
  /** Lake cells (boats). */
  lake: 1,
}

/**
 * Goods. Food (Grain, Fish, Livestock) is what the food system grows, split by where it comes from;
 * Timber, Ore and Salt come from the catchment's forests, ore-rich highlands and arid shores, worked by
 * the settlement's people. Every good has a per-capita need; a settlement's price for a good rises as
 * its stock falls short of the need (food prices also rise steeply with hunger), and goods flow along
 * trade links from cheap to dear while the price gap beats the transport cost.
 * Order: Grain, Fish, Livestock, Timber, Ore, Salt.
 */
export const GOODS = {
  /** Worth of one unit (a unit of food feeds one person for a year). Trade volume is counted in loads: units * value. */
  value: [1, 1.2, 1.4, 2, 5, 6],
  /** Need per person per year (food needs sum to 1: the preferred diet). */
  need: [0.55, 0.15, 0.3, 0.08, 0.03, 0.025],
  /** Transport cost per unit per cell unit of route cost, at productivity 1. */
  transport: [0.035, 0.045, 0.04, 0.05, 0.06, 0.06],
  /** Transport gets cheaper with technology: divided by 1 + transportTech * (productivity - 1). */
  transportTech: 0.6,
  /** Non-food needs grow with technology: need * (1 + demandTech * (productivity - 1)). */
  demandTech: 0.5,
  /**
   * Food prices: dietWeight on the good's own scarcity (2 / (1 + stock / need)), the rest on hunger
   * h(y), y = food / people: 1 + hungerSlope * (1 - y) below 1 (up to hungerMax), 1 - surplusSlope * (y - 1)
   * above (down to hungerMin). Steep below: the hungry pay dearly; gentle above: the well fed keep a reserve.
   */
  dietWeight: 0.2,
  hungerSlope: 2.5,
  surplusSlope: 1.6,
  hungerMin: 0.3,
  hungerMax: 3,
  /** Non-food output = resource * productivity * pop / (pop + workHalf): it takes people to fell, mine and boil. */
  workHalf: 500,
  /** Share of a cell's farm capacity raised as livestock, by biome id. */
  livestock: [0, 0, 0, 0.85, 0.25, 0.25, 0.45, 0.7, 0.45, 0.1, 0.65],
  /** Share of the river part of a cell's farm capacity that is river fishing. */
  riverFish: 0.3,
  /** Timber per n = 48 cell of uncleared land, by biome id. */
  timber: [0, 0, 0, 3, 40, 40, 3, 0, 10, 35, 10],
  /** Ore per n = 48 highland cell at full richness; richness = smoothstep(oreLow, oreHigh, noise) * smoothstep(0.2, 0.45, elevation) (Mountain biome counts as high). */
  ore: 120,
  oreLow: 0.15,
  oreHigh: 0.6,
  /** Salt per n = 48 cell: arid sea shores (salt pans), arid lake shores and desert sinks. */
  salt: 35,
}

/** Trade links, routes and the yearly market. */
export const TRADE = {
  /** Settlements of at least this many people trade. */
  minPop: 400,
  /** Years between rebuilds of the link graph (a bounded multi-source travel-cost search from every trading settlement). */
  linkStep: 50,
  /** The link search reaches this far from each settlement (cell units); over water from a port, portSeaRadius times as far. */
  radius: 13,
  portSeaRadius: 1.6,
  /** Partners per trader: the `nearest` cheapest plus `gravity` with the best size / cost^2, searched up to `reach` (cell units, times 1 + transportTech * (productivity - 1)) over at most maxNodes settlements. */
  nearest: 2,
  gravity: 1,
  reach: 20,
  maxNodes: 40,
  /** Partner search reach multiplier for traders with a port. */
  portReach: 1.5,
  /** Market sweeps per year over all links, and the damping of each flow step (share of the price gap closed). */
  passes: 1,
  damping: 0.5,
  /** At most this share of a good's stock leaves in one flow step; gaps (net of transport) below minGap * value are not worth a trip. */
  maxShare: 0.35,
  minGap: 0.03,
  /** A pair without an open route needs a price gap above (1 + openHurdle) * transport cost to start trading; pairs that never traded are examined every probeStep years. */
  openHurdle: 1,
  probeStep: 3,
  /** A route closes after closeYears years in a row below closeMin loads. */
  closeYears: 30,
  closeMin: 3,
  /** Sea legs: shallow-water and deep-ocean cost multipliers for traders with a port / without. */
  seaPort: 0.2,
  seaNoPort: 1.3,
  oceanPort: 0.12,
  oceanNoPort: 1.5,
  /** Settlements a route passes through take a toll of this share of its volume as wealth. */
  toll: 0.03,
  /** For hub status, a settlement's own trade counts this much per load; trade passing through it counts fully. */
  ownWeight: 0.5,
  /** Exporters keep half the price gap they close, plus this margin on the value moved. */
  margin: 0.04,
}

/**
 * Wealth: accumulated trade income, decaying slowly. Per head (w = wealth / pop) it raises the
 * food a settlement gets from its land (tools, draught animals, granaries, specialists):
 * multiplier 1 + cap * w / (w + half). Being a hub adds min(hubCap, hubK * x), x = sqrt(t / hubRef),
 * t = smoothed loads a year passing through it plus TRADE.ownWeight times those on its own routes:
 * it keeps growing with traffic (no plateau that every busy town reaches), but sublinearly, so a
 * city's own trade feeding its size converges instead of running away and amplifies the advantages
 * of good sites. Prosperity f = max(w / (w + half), x / (1 + x)): prosperous settlements keep their
 * people (pressure emigration / (1 + stay * f)) and draw migrants (join score * (1 + draw * f));
 * colonists join instead of founding when the target's f >= joinMin; and they outbid others for food
 * (trade.ts), so hubs feed themselves from further afield.
 */
export const WEALTH = {
  decay: 0.02,
  cap: 0.4,
  half: 20,
  hubK: 0.85,
  hubRef: 3000,
  hubCap: 2.4,
  stay: 6,
  draw: 3,
  joinMin: 0.5,
  /** Food prices of a settlement are scaled by 1 + bid * prosperity: the prosperous outbid others for food. */
  bid: 0.7,
  /** A group may join a prosperous settlement (f >= joinMin, fed) if it is no larger than joinRoom * f * that settlement's population. */
  joinRoom: 0.03,
  /** Smoothing of the yearly net food imports that count toward a settlement's expected food. */
  importSmoothing: 0.2,
}

/**
 * Roads: overland trade wears roads into the cells its routes pass (not water). Every ROAD.step years the
 * level moves toward traffic / (traffic + half) (traffic in loads a year) at riseRate per year, and
 * fades at fadeRate per year once the traffic is below it. Travel cost on a road cell is multiplied by
 * (1 - discount * level), for trade and migration.
 */
export const ROAD = {
  /** Roads advance every `step` years (a multiple of LAND.step; rates below are per year). */
  step: 4,
  half: 400,
  riseRate: 0.05,
  fadeRate: 0.015,
  discount: 0.35,
  epsilon: 0.5 / 255,
}
