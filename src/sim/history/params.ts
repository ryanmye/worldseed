// Tuning constants for the settlement history, in one place.
//
// Units: people, years, and "cell units" of travel cost (one n = 48 cell of
// easy grassland costs 1). Per-cell capacities are scaled by cell area, so
// totals are roughly resolution independent.

export const HISTORY_DEFAULTS = {
  years: 2000,
  snapshotInterval: 5,
  /** Years between land-use / degradation snapshots (two Uint8 matrices of cellCount each; ~4.7 MB at n = 48). */
  landInterval: 20,
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

/** Larger settlements farm their land more intensively: food multiplier 1 + bonus * pop / (pop + half). */
export const URBAN = {
  bonus: 2.5,
  half: 6000,
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
  /** Score = value * jitter / (1 + costPenalty * cost / budget). */
  costPenalty: 0.6,
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
 * Degradation (soil exhaustion, erosion): yearly, with intensity e = clamp((use - onset) / (1 - onset), 0, 1),
 *   deg += rate * fragility * e^2 * (1 - deg) - deg * (recovery * (1 - use) + renewal)
 * and a cell's farm capacity is multiplied by (1 - yieldLoss * deg). Light use barely harms the land;
 * a fully worked core settles near rate*f / (rate*f + renewal) (~0.77 on average land, ~0.25 on a floodplain).
 */
export const DEGRADATION = {
  rate: 0.004,
  onset: 0.25,
  /** Recovery of land left alone (forest regrowth), and the natural renewal that acts even under use. */
  recovery: 0.006,
  renewal: 0.0012,
  yieldLoss: 0.8,
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
