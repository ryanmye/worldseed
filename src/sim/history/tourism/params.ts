// tourism: constants of scenery, sights, leisure travel and resort towns (tourism/*.ts; HistoryOptions.tourism).

/** Default of HistoryOptions.tourism. */
export const TOURISM_ON = true

/**
 * Scenery (static, scenery.ts): a raw scenic value per land cell, the weighted sum of the parts below (each 0..1), then
 * ranked: scenery = 255 * u^power for the cell's rank u among land cells.
 */
export const SCENERY = {
  /** Relief contrast: highest minus lowest elevation within two hops (water counts as 0), smoothstep(lo, hi). */
  reliefLo: 0.12,
  reliefHi: 0.5,
  wRelief: 1.0,
  /** Lake shore: weight, and the lake size (cells at n = 48) at which it counts in full (smaller from 0.5). */
  wLake: 0.9,
  lakeBig: 30,
  /** Sea coast: weight times (0.4 + water share within two hops: capes and peninsulas more); small islands. */
  wCoast: 0.55,
  wIsland: 0.35,
  islandCells: 60,
  /** Great river (flow smoothstep(lo, hi)) and its mouth. */
  wRiver: 0.35,
  riverLo: 8,
  riverHi: 80,
  wMouth: 0.25,
  /** Share of woodland around the cell. */
  wForest: 0.25,
  /** Snow within two hops (a mountain or ice cell colder than snowTemp) while the cell itself is not that cold. */
  snowTemp: 0.24,
  wSnow: 0.75,
  /** Pleasant climate: warmth in a bump [t0, t1, t2, t3], rainfall in [r0, r1, r2, r3]. */
  t0: 0.45, t1: 0.58, t2: 0.76, t3: 0.88,
  r0: 0.15, r1: 0.28, r2: 0.6, r3: 0.8,
  wPleasant: 0.55,
  /** Striking cold: colder than coldTemp, by ice or by the sea. */
  coldTemp: 0.24,
  wCold: 0.35,
  /** Hot springs on plate-boundary land at least springElev high: this chance per candidate ('history-tourism-springs'). */
  springChance: 0.12,
  springElev: 0.06,
  wSpring: 0.7,
  /** The largest lakes (top `famous` by size) and the highest range: bonus on their shores and slopes. */
  famous: 2,
  wFamous: 0.4,
  /** Rank curve. */
  power: 3,
  /** Spots (candidate destinations from scenery): habitable cells whose view (own scenery, or 0.9 of the best neighbour's) is at least spotMin, spotSpacing hops apart, at most spotMax (scaled by area). */
  spotMin: 205,
  spotSpacing: 4,
  spotMax: 70,
}

/**
 * Leisure class (system.ts): travellers a year from a living settlement of at least minPop people:
 *   L = rate * pop * smoothstep(wLo, wHi, wealth per head) * smoothstep(cLo, cHi, Crafts) * home   (cLoIdeas for cLo with the ideas on)
 * home: war (warMul), unrest (1 - unrest), an epidemic (epidemicMul), hunger (food), and roads or a port (roadMin + (1 - roadMin) * max(road, port)).
 * The capital of a kingdom or empire travels earlier: its Crafts gate eased by capitalEase, its reach capitalReach of the cost scale (villa coasts).
 */
export const LEISURE = {
  minPop: 1500,
  rate: 0.03,
  wLo: 2,
  wHi: 16,
  cLo: 3.6, // (3.3 before the merge with rulers, religion and the disease retune: their worlds reach Crafts and wealth sooner)
  /** cLo while the ideas are on (HistoryOptions.ideas): their worlds spread wider, the slowest reaching Crafts 3.5 only by 2000. */
  cLoIdeas: 3.4,
  cHi: 6.0,
  capitalEase: 0.5,
  capitalReach: 0.5,
  warMul: 0.5,
  /** Smoothing of a town's leisure class per flow step. */
  smooth: 0.5,
  epidemicMul: 0.3,
  roadMin: 0.4,
  /** Sources kept (largest leisure class first). */
  maxSources: 20,
}

/**
 * Travel (system.ts). Every destStep years each source searches (bounded, over cells its people knows: s.moveCost on land,
 * sea and ocean as migration costs them, all divided by 1 + budgetTech (Crafts - 1)) for the destinations within budget, keeping
 * the `keep` best by appeal * contrast / (1 + (cost / costHalf)^2). Every flowStep years each source splits its leisure class:
 *   U = appeal * contrast * safety * fashion * vogue * access / (1 + (cost / costHalf)^2),   visitors = L * U / (home + sum U)
 * (pairs under minFlow dropped). Searches are staggered: at most searchesPerYear sources renew theirs a year.
 */
export const TRAVEL = {
  destStep: 20,
  flowStep: 5,
  /** A source searches again after searchAge years if its people's Crafts rose by searchCrafts since, and after searchMax years anyway. */
  searchAge: 50,
  searchCrafts: 0.25,
  searchMax: 150,
  searchesPerYear: 2,
  budget: 9,
  budgetTech: 0.55,
  maxVisits: 1500,
  keep: 6,
  costHalf: 9,
  home: 1.2,
  minFlow: 2,
  /** Danger (cell danger along the way and at the place, pirates and bandits included): safety 1 - smoothstep(safeLo, safeHi, z). */
  safeLo: 0.36,
  safeHi: 0.75,
  /** Fever at the place shunned by those not used to it; an epidemic there keeps nearly everyone away. */
  feverAvoid: 0.9,
  epidemicMul: 0.05,
  /** Contrast: warm coasts draw from colder towns, snow and heights from hotter ones, heights from lowlands, cool places from fever ground. */
  warmPull: 2.5,
  coolPull: 2.5,
  highPull: 0.4,
  feverEscape: 3,
  pleasantPull: 0.25,
  /** Fashion: 1 + fashion * v / (v + fashionHalf), v the smoothed visitors from the same people (fame across peoples counts fameShare); smoothing per flow step. */
  fashion: 0.9,
  fashionHalf: 80,
  fameShare: 0.3,
  fashionUp: 0.5,
  fashionDown: 0.15,
  /** Vogue: a per-place whim redrawn every vogueStep years in [vogueLo, vogueHi] ('history-tourism'). */
  vogueStep: 60,
  vogueLo: 0.7,
  vogueHi: 1.35,
  /** Spending a year per visitor: spend * the home town's wealth per head, at most spendCap; at most spendMax of the home town's wealth a year. */
  spend: 0.08,
  spendCap: 2,
  spendMax: 0.03,
  /** Road wear (loads a year per visitor on land cells of the way). */
  roadW: 0.5,
  /** Demand for luxuries, finery and wares at a visited place: x (1 + luxury * visitors / pop), at most luxuryMax. */
  luxury: 1,
  luxuryMax: 1.5,
  /** Sickness carried by visitors (disease/system.ts): link weight diseaseW * v / (v + diseaseHalf) for v visitors a year. */
  diseaseW: 0.03,
  diseaseHalf: 200,
}

/**
 * Resort towns (system.ts). A place without a settlement whose wanted visitors reach foundVisitors at foundSteps flow steps
 * in a row gets a resort town (foundPop from its main source, at most foundShare of it). Visitor income (smoothed by incSmooth a
 * year) supports income / perHead people, fed with food bought at foodPrice per person a year: a resort's food all comes so
 * (or by trade). A resort without income above minIncome for
 * grace years is abandoned; while it fails, its people leave (its food is held at keepMin of its people).
 * (A town that hosts visitors grows on their money through its wealth, as any rich town does.)
 * Fashion: a place comes into fashion at fashionOn visitors (again once it fell below half), declines below declineFrac of its peak.
 * A declined place becomes a quaint sight after quaintYears.
 */
export const RESORT = {
  foundVisitors: 45,
  foundSteps: 2,
  foundPop: 120,
  foundShare: 0.03,
  incSmooth: 0.2,
  perHead: 0.3,
  foodPrice: 0.15,
  keepMin: 0.97,
  minIncome: 4,
  grace: 40,
  fashionOn: 100,
  declineFrac: 0.35,
  /** Smoothing of a place's visitors per flow step (for fashion and decline); years in fashion before it can decline, and after a decline before it comes back. */
  visSmooth: 0.3,
  minFashionYears: 20,
  backYears: 20,
  /** Back in fashion only at backFrac of the old peak (or fashionOn). */
  backFrac: 0.6,
  quaintYears: 100,
  /** A declined place is quaint only if its visitors stay below quaintFrac of its best ever. */
  quaintFrac: 0.25,
  /** A host within hostHops of a place (living, at least hostPop people); a resort site within siteHops. */
  hostHops: 1,
  hostPop: 30,
  siteHops: 2,
}

/**
 * Sights (system.ts; scanned every SIGHT.step years): ruins of places that reached ruinGone people, ruinAfter years after they
 * were abandoned, and of great towns (ruinPop) shrunk to ruinFrac of their peak; capitals held capitalYears or more by a town that reached capitalPop, once no longer the capital; summits first reached; expedition bases in the
 * polar cold (colder than polarTemp) once abandoned; mine towns that boomed, once their mine gave out. Fame 0..1.
 */
export const SIGHT = {
  step: 10,
  ruinPop: 4000,
  ruinFrac: 0.35,
  ruinGone: 1000,
  ruinAfter: 40,
  capitalYears: 150,
  capitalPop: 8000,
  polarTemp: 0.15,
  /** Holy-city hook scores (hooks.ts) at least this make a settlement a destination. */
  holyMin: 0.2,
  /** religion: a holy city's score is x / (x + holyHalf) for its pilgrims' income x a year (0.2 at 100, 0.5 at 400; hooks.ts). */
  holyHalf: 400,
}
