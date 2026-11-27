// Shared contract between the simulation (src/sim) and the renderer (src/render).
// Neither side imports anything from the other except through these types and
// the `generateWorld` entry point exported by src/sim/index.ts.

/**
 * The planet surface as a graph of cells. Cells are the vertices of a
 * subdivided icosahedron projected onto the unit sphere, so every cell has
 * 5 or 6 neighbours and cells are near-uniform in area.
 */
export interface Grid {
  cellCount: number
  /** Unit-sphere xyz per cell, length 3 * cellCount. +Y is the north pole. */
  positions: Float32Array
  /** Triangle list over cell indices (the icosphere faces), length 3 * triangleCount. Counter-clockwise seen from outside. */
  triangles: Uint32Array
  /**
   * CSR adjacency: neighbours of cell i are neighbors[neighborOffsets[i] .. neighborOffsets[i + 1]).
   * Each ring is ordered counter-clockwise seen from outside.
   */
  neighborOffsets: Uint32Array
  neighbors: Uint32Array
}

export const Biome = {
  Ocean: 0,
  Coast: 1, // shallow water
  Ice: 2,
  Tundra: 3,
  Taiga: 4,
  TemperateForest: 5,
  Grassland: 6,
  Desert: 7,
  Savanna: 8,
  Rainforest: 9,
  Mountain: 10,
} as const
export type Biome = (typeof Biome)[keyof typeof Biome]
export const BIOME_COUNT = 11

/** A generated planet. All per-cell arrays have length grid.cellCount. */
export interface World {
  seed: number
  grid: Grid
  plateCount: number
  /** Tectonic plate id per cell, in [0, plateCount). */
  plate: Uint16Array
  /** Elevation in [-1, 1]; sea level is 0. */
  elevation: Float32Array
  /** Mean temperature in [0, 1]; 0 is polar cold, 1 is equatorial hot. */
  temperature: Float32Array
  /** Annual rainfall in [0, 1]. */
  rainfall: Float32Array
  /** Biome id per cell, see `Biome`. */
  biome: Uint8Array
  /** Downstream cell for land drainage, or -1 for ocean cells and sinks. */
  riverTo: Int32Array
  /** Accumulated drainage flow per cell (>= 0); cells at or above RIVER_FLOW_THRESHOLD are rivers. */
  flow: Float32Array
  /** 1 where a land cell is covered by a lake (a filled depression), else 0. Lake cells keep a land biome. */
  lake: Uint8Array
  /**
   * disasters: plate-boundary stress per cell after propagation from the boundaries, in about [-1, 1]: > 0 convergent (mountain
   * belts, island arcs, trenches), < 0 divergent (rifts, ridges), near 0 within plates. The elevation stage's own field (no new
   * draws: every other field is unchanged); history uses it to place volcanoes and earthquakes.
   */
  tectonic: Float32Array
}

/** Flow at or above this is a river. Flow is scaled to be independent of grid resolution. */
export const RIVER_FLOW_THRESHOLD = 6

export interface WorldOptions {
  /** Icosphere subdivision frequency; cellCount = 10 * n^2 + 2. Default 48 (~23k cells). */
  subdivisions?: number
}

/** Signature of the entry point exported by src/sim/index.ts. Must be deterministic in (seed, options). */
export type GenerateWorld = (seed: number, options?: WorldOptions) => World

// ---------------------------------------------------------------------------
// History: settlements over time, precomputed for the whole run so the UI can
// scrub freely. Produced by `simulateHistory` exported from src/sim/index.ts.

export interface Settlement {
  /** Index into History.settlements; ids are assigned in founding order. */
  id: number
  cell: number
  foundedYear: number
  /** Settlement the founders migrated from, or -1 for an original tribe. */
  parent: number
  /** Year the settlement was abandoned, or -1 if it survives to the end of the run. */
  abandonedYear: number
  /** Procedurally generated name, unique within a world. */
  name: string
  /** The people this settlement descends from: index into History.peoples. */
  people: number
  /** True for an expedition base: a small supplied outpost in land that cannot feed it, kept up by its parent. */
  outpost: boolean
  /** goods: true for a trading post's own settlement (a fort or a victualling station founded for a long-haul lane; see TradingPost). */
  post: boolean
  /** tourism: true for a resort town founded for its visitors (it farms nothing and buys its food with their money; see History.visitorFlows). */
  resort: boolean
}

export const EventType = {
  Founded: 0, // settlement founded; `other` is the parent settlement or -1; `value` is the founding group size
  Abandoned: 1, // settlement abandoned; `value` is the remaining headcount
  Famine: 2, // severe food shortfall; `value` is the fraction of population lost
  Migration: 3, // people moved from `settlement` to existing settlement `other`; `value` is headcount
  Built: 4, // `settlement` built a structure; `other` is the structure id; `value` is the StructureType
  BecameTown: 5, // population first reached TOWN_POPULATION; `value` is the population
  BecameCity: 6, // population first reached CITY_POPULATION; `value` is the population
  StructureLost: 7, // a structure fell out of use; `other` is the structure id; `value` is the StructureType
  TradeOpened: 8, // a trade route opened; `settlement` and `other` are its two ends; `value` is the route id
  TradeClosed: 9, // a trade route closed; `settlement` and `other` are its two ends; `value` is the route id
  VoyageLost: 10, // a colonising voyage or a sea expedition from `settlement` was lost at sea; `other` is -1; `value` is the people lost
  Landfall: 11, // first settlement on a previously empty landmass; `settlement` is the new colony, `other` its sender; `value` is the landmass size in cells
  ExpeditionSent: 13, // an expedition set out from `settlement` to explore (logged in the year it ends; its journey's departYear is earlier); `other` is -1; `value` is its headcount
  ExpeditionReturned: 14, // an expedition came home to `settlement` with news; `other` is the outpost it founded or -1; `value` is the number of cells newly known
  Discovery: 15, // an expedition from `settlement` reached a notable place for the first time by anyone; `other` is the cell reached; `value` is the id of the History.features entry, or -1 for a pole
  TechAdvance: 16, // the people of `settlement` reached a new whole level in a field of technology there; `other` is -1; `value` is the TechField
  Domesticated: 17, // the people of `settlement` first tamed or cultivated a wild species there; `other` is -1; `value` is the species id
  SpeciesAdopted: 18, // the people of `settlement` first took up a species from another people; `other` is the settlement it came from; `value` is the species id
  Epidemic: 19, // a sickness new to the people of `settlement` struck after contact; `other` is the settlement of the people it came from; `value` is the fraction of that people lost
  // 20-43 are polities, war and unrest (below).
  TechniqueFound: 44, // the people of `settlement` first worked out a farming technique or bred a strain there; `other` is -1; `value` is the technique id
  TechniqueAdopted: 45, // the people of `settlement` first took up a technique from another people; `other` is the settlement it came from; `value` is the technique id
  Blight: 46, // a crop disease struck the people of `settlement`, first there; `other` is -1; `value` is the species id; `extra` is the fraction of the harvest lost
  HabitSpreads: 47, // a habit-forming plant took hold among the people of `settlement`; `other` is the settlement it came from or -1; `value` is the species id
  Drain: 48, // wealth is flowing out of the people of `settlement` to pay for a habit-forming good; `other` is the largest exporter's settlement; `value` is the species id
  Panzootic: 49, // a livestock plague struck the herds of the people of `settlement`; `other` is the settlement it came from or -1; `value` is the species id; `extra` is the fraction of herds lost
  FirstContact: 12, // two peoples met for the first time; `settlement` and `other` are the settlements through which they met; `value` is the other people's id (that of `other`)
  // polities: ids 20-43 are polities (20-34 v1, 35-43 v2); 17-19 are the species events above.
  PolityFounded: 20, // a state was founded at its capital `settlement`; `other` is the parent polity's capital (successor states) or -1; `value` is the polity id
  PolityEnded: 21, // a polity ended (cause in History.polities); `settlement` is its last capital; `other` is the conqueror's capital or -1; `value` is the polity id
  CapitalMoved: 22, // `settlement` became the capital; `other` is the old capital (-1 if it was abandoned); `value` is the polity id
  Joined: 23, // a town (>= TOWN_POPULATION) submitted to a polity peacefully; `other` is the capital; `value` is the polity id
  WarDeclared: 24, // `settlement` is the attacker's capital, `other` the defender's; `value` is the war id (History.wars)
  PeaceMade: 25, // a war ended; `settlement` is the attacker's capital, `other` the defender's; `value` is the war id
  Conquered: 26, // `settlement` was taken in a war; `other` is the settlement the army came from (-1 if it submitted after its capital fell); `value` is the war id
  Sacked: 27, // `settlement` was sacked after it fell; `other` is the settlement the army came from; `value` is the fraction of its people lost
  SiegeLifted: 28, // a siege of `settlement` (walled or a capital) ended without its fall; `other` is the besiegers' base; `value` is the war id
  Raid: 29, // raiders from `other` struck `settlement` (logged only for settlements of 1,000 or more; see History.raids); `value` is the wealth taken
  Revolt: 30, // a revolt broke out at `settlement` against the capital `other`; `value` is the cause (RevoltCause)
  RevoltCrushed: 31, // the revolt seated at `settlement` was put down by the capital `other`; `value` is the number of settlements that rose
  Seceded: 32, // `settlement` became the capital of a new state that broke away from the one ruled from `other`; `value` is the new polity id
  Defected: 33, // `settlement` left its polity for the one ruled from `other`; `value` is that polity's id
  SuccessionCrisis: 34, // the death of a ruler at the capital `settlement` left the succession contested; `other` is -1; `value` is the polity id
  // polities v2 (35-43).
  CivilWar: 35, // a rival centre rose against its capital: `settlement` is the pretender's seat, now the capital of a new polity (origin CivilWar, parent the old realm), `other` the capital it rose against; `value` is the war id (History.wars, kind CivilWar). A civil war opens with this event instead of WarDeclared and ends with PeaceMade
  Partitioned: 36, // a realm was divided among heirs: `settlement` is its capital (it keeps the capital's share), `other` is -1; `value` is its polity id. Each heir's share is a new polity (origin Partition), logged as Seceded the same year
  Reunified: 37, // the polity ruled from `settlement` took back a realm of its own lineage (a civil war won, or a kindred successor state brought back); `other` is the absorbed realm's last capital; `value` is the absorbed polity's id (it ends with PolityEnd.Reunified)
  BecameVassal: 38, // the polity ruled from `settlement` bowed to the one ruled from `other`: `value` is the overlord's polity id, or 1000 + it when it only pays tribute (see History.bonds); `extra` is 0 when the bond was made, 1 when the vassal threw it off
  Alliance: 39, // the polities ruled from `settlement` and `other` allied against a common rival: `value` is the polity id of `other`'s polity; `extra` is the rival's polity id
  SmugglingRing: 40, // `settlement` became a smugglers' hub (much of its income from contraband); `other` is the capital of the polity whose duties or embargo it evades most (-1 if none); `value` is the good mostly smuggled through it (Good)
  PiratesRise: 41, // pirates based at `settlement` (a pirate haven) began to prey on the sea lanes nearby; `other` is -1; `value` is the route id of the busiest lane they strike (-1 if none)
  PiratesSuppressed: 42, // the pirates of `settlement` were put down by the fleets of the polity ruled from `other`; `value` is -1
  Blockade: 43, // the fleets of the polity ruled from `other` blockaded the ports of an enemy in war; `settlement` is the enemy's main port; `value` is the war id
  // goods: worked goods, specialities, state secrets and long-distance trade (50-65; 35-43 are polities, 44-49 species).
  DepositFound: 50, // a rare deposit was found by prospectors of `settlement` (or an expedition it sent); `other` -1; `value` the deposit id (History.deposits); `extra` 1 if by an expedition
  MineExhausted: 51, // the deposit worked by `settlement` gave out; `other` -1; `value` the deposit id
  Boom: 52, // the deposit worked by `settlement` floods the world's markets; `other` -1; `value` the deposit id; `extra` its share of the world's Treasure output
  TraditionBorn: 53, // a named craft tradition was born at its seat `settlement`; `other` -1; `value` the tradition id (History.traditions)
  TraditionRenowned: 54, // the tradition became renowned; `settlement` its largest seat; `other` -1; `value` the tradition id; `extra` its quality
  TraditionMoved: 55, // craftsmen carried a tradition from `other` to the new seat `settlement`; `value` the tradition id (the daughter's when a new one); `extra` the cause: 0 migration, 1 deportation, 2 defection
  TraditionLost: 56, // a tradition lost its last seat `settlement`; `other` -1; `value` the tradition id
  SecretGuarded: 57, // the state ruled from `settlement` began to guard a secret held at its producer `other`; `value` the secret id (History.secrets); `extra` its guard 0..1
  SecretLeaked: 58, // a secret passed to the people of `settlement` from the source settlement `other`; `value` the secret id; `extra` the LeakChannel
  MonopolyBroken: 59, // the first holders' hold on a secret's trade is broken; `settlement` the largest new producer; `other` the old holder's capital (or largest settlement); `value` the secret id; `extra` years held
  DirectRoute: 60, // a trade expedition from the mart `settlement` opened a direct lane to the far mart `other`; `value` the leg id (History.longHaul); `extra` the variety sought
  PostFounded: 61, // a trading post was founded: `settlement` is the post's own settlement, or the host of a factory; `other` its owner; `value` the post id (History.posts); `extra` the PostKind
  PostLost: 62, // a trading post was lost: `settlement` its settlement or host; `other` its owner; `value` the post id; `extra` the cause: 0 upkeep, 1 conquest, 2 expelled
  Bypassed: 63, // the mart `settlement`, which lived on the relay trade, lost it to a lane from the home mart `other`; `value` the leg id; `extra` the share of its relay income lost
  FleetLost: 64, // a fleet on the lane from the home mart `settlement` to the far mart `other` was lost; `value` the leg id; `extra` the cargo value
  SecretSmuggled: 65, // contraband in a secret's goods (duties or an embargo evaded, or its monopoly rent: smuggling is polities v2's, SmugglingRing 40) first reached the people of `settlement` (its largest settlement) in earnest; `other` the settlement where the secret began; `value` the secret id; `extra` the contraband value a year. The smuggled seeds' leak channel (LeakChannel.Smuggling) grows with it
  // disease: epidemics and place-bound fever (66-79; all absent when HistoryOptions.disease is false). Epidemic (19) is kept for a sickness new to a people
  // brought by a first contact: with the disease system on, its `extra` is the epidemic id (History.epidemics) and `value` the expected share of the people lost.
  DiseaseAppeared: 66, // a disease of History.diseases first struck: `settlement` is the first place struck; `other` -1; `value` the disease id
  GreatEpidemic: 67, // an epidemic became a great one (it has killed at least 5% of the peoples it reached); `settlement` is where it began; `other` the settlement of another people it came from, or -1; `value` the epidemic id (History.epidemics); `extra` the disease id
  EpidemicEnded: 68, // a great epidemic died out: `settlement` is where it began; `other` -1; `value` the epidemic id; `extra` the share of the people of the peoples it reached who died of it
  CityStricken: 69, // an epidemic reached a city (>= CITY_POPULATION): `settlement` the city; `other` the settlement it came from, or -1; `value` the epidemic id; `extra` the share of the city expected to die of it
  Quarantine: 70, // the port `settlement` began to hold incoming ships in quarantine; `other` the capital of its polity; `value` the polity id
  Endemic: 71, // a crowd disease settled among the people of `settlement` (its largest settlement) as a steady childhood sickness; `other` -1; `value` the disease id
  ArmyStricken: 72, // sickness struck the army that marched from `other` on `settlement` (camp fever, an epidemic at the target, or fever ground); `value` the war id (History.wars); `extra` the war exhaustion it added
  // rulers: named rulers, dynasties, marriages and unions (80-88; empty when HistoryOptions.rulers is false).
  RulerAcceded: 80, // ruler `value` (History.rulers) took the throne at the capital `settlement`; `other` -1; `extra` how (AccessionHow)
  ReignEnded: 81, // the reign of ruler `value` ended at the capital `settlement`; `other` -1; `extra` the cause (ReignEnd): death by age, battle, the fall of the capital, overthrow, plague; deposition; the realm's end; a league head's term
  DynastyFounded: 82, // a house (History.dynasties `value`) came to the throne for the first time at the capital `settlement`; `other` -1; `extra` the founder's ruler id
  DynastyEnded: 83, // house `value` lost its last throne at the capital `settlement` (no heir, overthrown, passed over, or its realm gone); `other` -1; `extra` the house's last ruler id
  Regency: 84, // ruler `value` came to the throne a minor: a regency rules from the capital `settlement`; `other` -1; `extra` the years until the ruler comes of age
  UnionFormed: 85, // a personal union (History.unions `value`): the ruler of the senior realm (capital `other`) also took the throne of the junior realm (capital `settlement`) through a marriage claim; `extra` the ruler id
  UnionDissolved: 86, // union `value` ended: `settlement` the junior's capital, `other` the senior's; `extra` the UnionEnd (merged into one realm, split at a contested succession or a revolt, or a realm ended)
  RoyalMarriage: 87, // a marriage tie (History.marriages `value`) between the ruling houses of two realms of Kingdom tier or larger, with capitals `settlement` and `other`; `extra` -1
  SuccessionWar: 88, // a claimant passed over pressed its claim by war: `settlement` the claimant's capital, `other` the target's; `value` the war id (History.wars); `extra` the marriage tie of the claim
  // religion: faiths, conversion, state churches, schism and holy war (89-97; empty when HistoryOptions.religion is false).
  FaithFounded: 89, // a universal faith (History.faiths `value`) was founded at `settlement`, its holy city; `other` -1; `extra` -1
  RulerConverted: 90, // the ruler of the polity ruled from `settlement` (History.rulers: its reign at the year) took up faith `value`; `other` -1; `extra` the faith left
  StateReligion: 91, // faith `value` became the state religion of the polity ruled from `settlement`; `other` -1; `extra` the faith it replaced, or -1
  Schism: 92, // faith `value` split from its parent (History.faiths[value].parent) with its seat at `settlement`; `other` the parent's holy city; `extra` the polity whose ruler led it, or -1
  Persecution: 93, // the state ruled from `settlement` began to persecute its minorities; `other` -1; `value` the state faith; `extra` the largest faith persecuted
  HolyWar: 94, // war `value` (History.wars) was declared as a holy war by the state ruled from `settlement` on the one ruled from `other`; `extra` the attacker's faith
  HolyCityFell: 95, // the holy city `settlement` of faith `value` fell to the army from `other` of a polity of another faith; `extra` the war id
  FaithDied: 96, // faith `value` lost its last followers (a remnant under RELIGION.dieBelow folds into its neighbours' faiths); `settlement` its last stronghold (or, when that is gone, the oldest living settlement); `other` -1
  FaithReached: 97, // faith `value` first reached a people (that of `settlement`) in earnest; `other` the settlement it came from (-1 by conversion of its rulers or none known); `extra` the people id
  // tourism: leisure travel and resort towns (none when HistoryOptions.tourism is false).
  LeisureTravel: 100, // the first leisure travellers of a people set out: `settlement` is the town they came from, `other` the settlement they visited; `value` the people id
  ResortFounded: 101, // a resort town was founded for visitors at `settlement`; `other` is the town most of them came from (its parent); `value` visitors a year; `extra` the SightKind of the place, or -1 for scenery alone
  ResortInFashion: 102, // `settlement` came into fashion: its visitors crossed RESORT.fashionOn a year (again after a decline); `other` the town most of them came from; `value` visitors a year
  ResortDeclined: 103, // `settlement`, once in fashion, lost most of its visitors; `other` -1; `value` visitors a year left; `extra` the cause: 0 fashion moved, 1 war or danger on the way, 2 an epidemic, 3 the towns it drew on declined
  ResortAbandoned: 104, // the resort town `settlement` was given up when its visitors failed for good (the Abandoned event follows); `other` -1; `value` years without visitors
  SightRecognised: 105, // a place became a sight worth the journey: `settlement` the living settlement by it (its own, the town that hosts its visitors, or the nearest); `other` the sight's own settlement (a ruin's abandoned one) or -1; `value` the sight id (History.sights, which has its cell); `extra` the SightKind
  // renaming: places renamed by history (110-119; none when HistoryOptions.renaming is false).
  PlaceRenamed: 110, // `settlement` took the name History.renamings.name[`value`] (`value` the renaming id); `other` the capital of the polity behind it at the time, the ruin whose name it revived (RenameCause.Revived), or -1; `extra` the RenameCause
  // ideas: inventions and practices conceived, carried by trade and other contact, resisted and lost (120-129; none when HistoryOptions.ideas is false).
  IdeaConceived: 120, // idea `value` (History.ideas) was first conceived by the people of `settlement`, there; `other` the settlement of its first origin elsewhere when this is a later independent origin, else -1; `extra` the origin's number (0 the first, 1 a second independent origin, ...)
  IdeaAdopted: 121, // the people of `settlement` took up idea `value` from another people: `settlement` is where it came in (a trade route's end, a mart, the town migrants joined, the conquered town...), `other` the settlement it came from (-1 if none is known); `extra` how (IdeaHow)
  IdeaLost: 122, // the people of `settlement` (its largest settlement) lost idea `value`; `other` -1; `extra` the cause (IdeaLoss)
  IdeaResisted: 123, // the people of `settlement` (its capital or largest settlement) refused idea `value`, which had reached it from `other`; `extra` the cause (IdeaResist)
  // claims (polities): 130.
  BorderDispute: 130, // the claims of the polities ruled from `settlement` and `other` came to meet over a stretch of unsettled land (History.claimed), a cause of rivalry between them; `value` is the polity id of `other`'s polity; `extra` the number of land cells both claim. Logged when the dispute begins (again after it lapsed)
  // landmarks: great buildings raised as a consequence of history (140-149; none when HistoryOptions.landmarks is false). Logged for the
  // great landmarks only (LandmarkRank.Great); the lesser houses of worship and shrines record their changes in History.landmarks alone.
  // In each, `value` is the landmark id (History.landmarks row), `settlement` its town, `extra` its LandmarkKind.
  LandmarkBegun: 140, // work began on landmark `value` at `settlement`; `other` the builder polity's capital, or -1
  LandmarkCompleted: 141, // landmark `value` was finished at `settlement`; `other` the builder polity's capital, or -1
  LandmarkAbandoned: 142, // work on landmark `value` was given up unfinished (the town fell, was sacked or abandoned, or the builder's realm ended); `other` -1
  LandmarkNeglected: 143, // landmark `value` fell into neglect (its town far below its peak, or no longer the seat it was built for); `other` -1
  LandmarkRuined: 144, // landmark `value` fell into ruin (sacked, its town abandoned, or neglected for centuries); `other` the settlement of the army that sacked it, or -1
  LandmarkRestored: 145, // landmark `value` was restored and in use again; `other` the restoring polity's capital, or -1
  LandmarkConverted: 146, // landmark `value` (a house of worship) was rededicated to another faith (its change row says which); `other` the converting polity's capital, or -1
  // danger on the way of trade (polities; 150-159; none when HistoryOptions.polities is false).
  TradeForsaken: 150, // a major trade route (History.trade `value`, ends `settlement` and `other`) closed because its way had grown too dangerous; follows its TradeClosed; `extra` the cause: 0 danger on land (war, raids, bandits), 1 pirates at sea (a strait or coast closed by them), 2 a war front across the way
  // goods: merchant capital (160-169).
  MerchantsMoved: 160, // the merchant houses of the bypassed mart `settlement` began to leave for the ends of the lane that took its trade (`other` one of them, -1 if both are gone); `value` their capital then
  // goods: merchant families (161-169; none when HistoryOptions.families or goods is false). In each, `value` is the family id (History.families).
  FamilyFounded: 161, // family `value` was founded at its home `settlement`; `other` the far mart of the lane whose venture made it (FamilyCause.Venture), the parent family's home (Split), or -1; `extra` the FamilyCause
  FamilyBranch: 162, // family `value` opened a factor (branch) at `settlement`; `other` its home; `extra` the seat id (History.families.seat*)
  BranchClosed: 163, // the factor of family `value` at `settlement` closed; `other` its home; `extra` the FamilySeatClose cause
  FamilyHead: 164, // a new head took over family `value` at its home `settlement`; `other` -1; `extra` the head id (History.families.head*: who and how)
  FamilyMoved: 165, // family `value` moved its home to `settlement` from `other`; `extra` the FamilyMoveCause (bypassed, the town lost, the entrepot)
  FamilyMarriage: 166, // family `value` (home `settlement`) married into the ruling house of the polity ruled from `other`; `extra` the marriage row (History.families.marriage*)
  FamilyBacked: 167, // family `value` (home `settlement`) backed a side in the civil war `extra` (History.wars) whose pretender's seat is `other`; its row says which side and how it ended
  FamilyPatron: 168, // family `value` paid for the great landmark `extra` (History.landmarks row) at `settlement`; `other` -1
  FamilyFell: 169, // family `value` ended at its home `settlement`; `other` the capital of the defaulting polity, the sackers' base, or -1; `extra` FamilyEnd * 16 + FamilyRuin
  TradeRestored: 151, // a route forsaken for danger (TradeForsaken) opened again: `value` the route id, `settlement` and `other` its ends; follows its TradeOpened; `extra` the years it lay forsaken
  // orders: the player's nudges (HistoryOptions.orders; 170-179; none without orders). In each, `value` is the order's index in
  // History.orders and `extra` as noted; `settlement` is where the story is told (the people's largest town, the polity's capital,
  // the town itself, or where the order came to pass).
  OrderGiven: 170, // order `value` was given: `settlement` the actor's seat; `other` the target settlement (or -1); `extra` the OrderKind
  OrderFulfilled: 171, // order `value` came to pass at `settlement`; `other` a related settlement (an expedition's sender, a war's defender's capital...) or -1; `extra` the OrderOutcome.product
  OrderFailed: 172, // order `value` failed: `settlement` the actor's seat (or -1); `other` -1; `extra` the OrderReason
  OrderLapsed: 173, // order `value` ran out of time (OrderStatus.Expired, or Partly when something was done toward it): `settlement` the actor's seat; `other` -1; `extra` the OrderReason
  // battles (220-229; none when HistoryOptions.battles is false). `value` is the History.battles or History.commanders row.
  BattleFought: 220, // battle `value` was fought for `settlement` (its target; Naval: the enemy's main port); `other` the settlement the attackers came from; `extra` kind | winner << 3 (0 the attackers won). Logged when menA + menD >= BATTLE.logMen, or a named commander fell, or a walled town or capital fell, or it is the first battle of its war
  SiegeLaid: 221, // a siege of `settlement` began (the first assault of a siege); `other` the besiegers' base; `value` the war id. (SiegeLifted 28 or Conquered 26 ends it)
  CommanderFell: 222, // commander `value` was killed (extra 0) or taken (extra 1) in battle at `settlement` (the battle's target); `other` -1. Logged for named commanders with >= 2 battles
  CommanderRenowned: 223, // commander `value` won the fame of a saga's hero (fame reached BATTLE.renown) with the battle for `settlement`; `other` the capital he served
  GeneralSeized: 224, // general `value` overthrew the ruler of the polity ruled from `settlement` and took its throne; `other` the town he came from (his last base); `extra` the new reign (History.rulers)
  GeneralRose: 225, // general `value` led a rising from `settlement` against the realm ruled from `other` (a CivilWar event follows); `extra` the war id
  GeneralTurned: 226, // general `value` went over to the enemy ruled from `other` with the town he held, `settlement` (Defected follows); `extra` the war id
  CommanderDismissed: 227, // commander `value` (a general) was relieved after a defeat at `settlement`; `other` the capital; logged for commanders with fame >= BATTLE.renown / 2 only
  // cradle wishes: the player planted where a people began (HistoryOptions.cradles; 180; none without a wish).
  // seat: deference (182-183, from the unassigned 182-189; none unless the player lets matters be decided without them).
  SeatDeclined: 182, // the seat's realm, ruled from `settlement`, came to be ruled in all but name by the body that decides without the player (seat/decider): `value` the polity id; `other` -1; `extra` the deference x 100
  DeferBlamed: 184, // the body that decided a divisive matter for the ruler of the realm ruled from `settlement` bore the blame for it: `value` the polity id; `other` -1; `extra` the DecisionKind (seat: a matter left to it), or an absentee blame (BLAME_LOST_WAR 100: a lost war; BLAME_DEFAULT 101: the crown's default; an AI court that governed)
  SeatReasserted: 183, // the player took the seat's power back in the realm ruled from `settlement`: `value` the polity id; `other` -1; `extra` 0 by decisions taken in a row, 1 by reclaiming it (a risky act: the throne is less safe for years)
  // absentee: absentee and do-nothing rulers of the AI realms (185-187, from the unassigned 182-189; none unless HistoryOptions.absentee).
  CouncilRuled: 185, // the realm ruled from `settlement` came to be governed in its ruler's name by the body that decides without him (a regent's council, a viceroy, the court): `value` the polity id; `other` the reign (History.rulers); `extra` the DeferenceCause that weighed most (1 Minor, 2 Absent, 3 Union, 4 Indolent, 5 Infirm, 6 Captive)
  RuledInPerson: 186, // the realm ruled from `settlement` was ruled in person again after a CouncilRuled: `value` the polity id; `other` the reign whose rule it was; `extra` how: 0 the reign ended, 1 the ruler came of age (the regent handed over), 2 the ruler came home (campaign or captivity over), 3 the union ended
  RulerTaken: 187, // the ruler leading the realm ruled from `other` in person was taken captive in the battle for `settlement`: `value` the reign (History.rulers); `extra` the years of captivity (battles)
  // seat: the player's seat (seat-mode §3.7; 270-279; none when HistoryOptions.seat is undefined).
  SeatTaken: 270, // the player took the seat (HistoryOptions.seat) at its year: `settlement` the seat polity's capital (or the people's largest town); `other` -1; `value` the seat's id; `extra` the SeatKind
  SeatPassed: 271, // the seat passed to the polity `value` ruled from `settlement`: `other` the old capital (-1); `extra` how: 0 the house's other throne, 1 a partition heir's share, 2 the pretender's realm (civil war), 3 a seceded realm of the same house
  SeatLost: 272, // the seat ended: `settlement` its last capital; `other` the conqueror's capital or -1; `value` the seat's id; `extra` the SeatEnd (0 realm conquered or absorbed, 1 house ended, 2 people gone, 3 overthrown with no throne left)
  AmbitionFulfilled: 273, // the seat achieved ambition `value` (AmbitionKind) at `settlement` (its capital then); `other` -1; `extra` the years since the seat was taken
  HeirNamed: 274, // the ruler `value` (History.rulers) of the polity ruled from `settlement` named an heir by order; `other` -1; `extra` the heir's birth year (seat step 8)
  CourtPlacated: 275, // the court ruled from `settlement` bought off its restive (a general, magnates, rebels): `other` -1; `value` the polity id; `extra` the wealth spent (seat step 8)
  GeneralPurged: 276, // the ruler of the polity ruled from `settlement` moved against a too-popular general: `value` the polity id; `other` -1; `extra` 0 purged, 1 the general struck first (seat step 8)
  BondRenounced: 277, // the polity ruled from `settlement` renounced its bond with the one ruled from `other` by order: `value` the other polity's id; `extra` the BondKind (+16 when a marriage tie was ended with it) (seat step 9)
  TributeOffered: 278, // the polity ruled from `settlement` bought peace in war `value` (History.wars) with tribute to the one ruled from `other`; `extra` the years of tribute (seat step 9)
  LevyRaised: 279, // the crown ruled from `settlement` raised an extraordinary levy by order (the proxy without finances): `value` the polity id; `other` -1; `extra` the wealth raised (seat step 13)
  CradlePlaced: 180, // year 0, right after the people's first settlement (`settlement`) is founded, for each people with a wish: `value` the people; `other` -1; `extra` the CradleOutcome (Placed, Moved or Rejected)
  // oaths (polities; grudges-and-oaths): broken truces, betrayed allies, bandwagoning and arms races (190-199; none when
  // HistoryOptions.oaths, balance and arms are false).
  Betrayal: 190, // the polity ruled from `settlement` broke faith with its ally ruled from `other` in a war they fought together (the bond ends BondEnd.Betrayed): `value` is the war the betrayer left (History.wars; its attacker the betrayer, its defender the common enemy); `extra` is 0 when it made a separate peace, 1 when it also turned on its ally (a WarDeclared follows that year). Towns the enemy ceded follow as Joined
  OathBroken: 191, // the polity ruled from `settlement` declared war on the one ruled from `other` against its oath: `value` is the war (WarDeclared the same year, just before); `extra` is 0 when a truce sworn at the end of an earlier war still held, 1 when the two were allies (the bond ends BondEnd.Betrayed)
  Avenged: 192, // the polity ruled from `settlement` took back or repaid the wrong of grievance `value` (History.grievances) done by the one ruled from `other` (-1 if it has ended); `extra` the GrievanceKind (logged for broken truces, betrayals, holy cities and capitals only)
  Bandwagon: 193, // the polity ruled from `settlement`, too weak to balance, sided with the far stronger one ruled from `other` (HistoryOptions.balance): `value` the stronger polity; `extra` 0 an alliance against the stronger one's rival (Alliance follows), 1 tribute offered unasked (BecameVassal, value + 1000, follows)
  ArmsRace: 194, // the polities ruled from `settlement` and `other` armed against each other (HistoryOptions.arms): `value` the race (History.armsRaces); `extra` 0 it began, 1 it ended in war (WarDeclared the same year, just before), 2 it eased
  // finance: crown treasuries, loans, default and bankruptcy (210-219; none when HistoryOptions.finance is false). 215 Debasement,
  // 216 CoinageRestored and 218 PricesRose are reserved for the deferred debasement and money layers (D-S4).
  LoanTaken: 210, // the crown of the polity ruled from `settlement` first borrowed from a lender seated at `other` (a mart's merchant houses, or a rich town): `value` the loan account (History.loans); `extra` the interest rate, a year's share (0.08)
  CrownDefault: 211, // the crown of the polity ruled from `settlement` stopped its payments and wrote down its debts: `other` the seat of the lender that lost most (-1); `value` the polity id; `extra` the share of the debt written off (0..1)
  Repudiation: 212, // a new ruler of the polity ruled from `settlement` (an usurper, a conqueror's choice or a new house) refused the crown's debts outright: `other` the seat of the largest lender; `value` the polity id; `extra` the debt repudiated (wealth units)
  ArmyUnpaid: 213, // the soldiers of the polity ruled from `settlement` went unpaid in war `value` (History.wars): its treasury empty and its credit gone; `other` the enemy's capital; `extra` -1
  WarBankrupt: 214, // war `value` ended because the polity ruled from `settlement` could no longer pay its armies (its PeaceMade follows the same year); `other` the enemy's capital; `extra` the years its soldiers had gone unpaid
  HousesRuined: 217, // the merchant houses of `settlement` (a town pool) lost much of their capital when the crown ruled from `other` defaulted, repudiated or fell; `value` the loan account; `extra` the share of their capital lost
  // beliefs: states act on what they believe of each other: coerced cessions, bluffs, spies, secret alliances (230-239; none
  // when HistoryOptions.beliefs is false; 237-238 only with BELIEF.forgery; 239 spare).
  Coerced: 230, // the polity ruled from `settlement` pressed the one ruled from `other` and it yielded without war: `value` the pressing polity's id; `extra` the towns ceded (their Joined events follow that year), 0 when it agreed to pay tribute instead (a Tribute bond)
  Deterred: 231, // the polity ruled from `settlement` pressed the one ruled from `other` and backed down, judging war not worth it: `value` the other's polity id; `extra` 1 when the other's show of strength was a bluff (BluffBegun), else 0
  BluffBegun: 232, // the polity ruled from `settlement` began to show more strength than it had (musters, parades, rumours): `other` -1; `value` its polity id; `extra` the strength shown, as a multiple of its own (1.6)
  BluffExposed: 233, // the polity ruled from `other` saw through the bluff of the one ruled from `settlement`: `value` the other's polity id; `extra` how (BeliefSource bit: 8 marriage, 32 envoys or allies, 64 spies, 128 war)
  SecretAlliance: 234, // the polities ruled from `settlement` and `other` allied in secret (History.bonds, known -1) against the polity `extra`; `value` the other's polity id. No Alliance event is logged for it
  AllianceRevealed: 235, // the secret alliance of the polity ruled from `settlement` with the one ruled from `other` came to light: `value` the war it joined (History.wars), or -1 when the threat's spies found it out; `extra` the years it had been secret
  SpyCaught: 236, // the polity ruled from `settlement` caught the spies of the one ruled from `other`: `value` the spying polity's id; `extra` 0
  ClaimForged: 237, // the polity ruled from `settlement` put forward a forged claim to the town `other` of another polity: `value` that polity's id; `extra` 0
  ClaimExposed: 238, // the forged claim of the polity ruled from `settlement` to the town `other` was exposed: `value` the exposing polity's id; `extra` the years it stood
  // disasters: natural shocks and climate epochs (260-269; none when HistoryOptions.disasters is false). In each, `value` is the
  // History.disasters row and `settlement` a settlement living that year (no living settlement qualifies: no event; the row stays).
  Eruption: 260, // a volcano erupted near `settlement` (the living settlement nearest it, within DX.witnessHops); `other` -1; `extra` the VEI
  VolcanicWinter: 261, // the harvest failed after an eruption: `settlement` the largest town of the region that cooled most; `other` the settlement nearest the volcano, or -1; `extra` the peak cooling in degC (< 0)
  Earthquake: 262, // an earthquake struck `settlement` (the one that lost most people); `other` -1; `extra` the magnitude
  Tsunami: 263, // a great wave struck the port `settlement` (the one that lost most); `other` the settlement struck worst by its earthquake, or -1; `extra` the number of coastal settlements struck
  CityDestroyed: 264, // `settlement` (>= TOWN_POPULATION) lost at least DX.destroyedShare of its people at once to an eruption, quake, wave or flood (row `value`); `other` -1; `extra` the share lost
  Flood: 265, // a great flood of the river struck `settlement` (the largest river town struck); `other` -1; `extra` the share of its people lost
  DroughtBegan: 266, // a persistent drought settled on the region of `settlement` (its largest town); `other` -1; `extra` the weather region
  DroughtEnded: 267, // the drought broke; `settlement` the region's largest town (or the one where it began, if still alive); `other` -1; `extra` its years
  ClimateTurned: 268, // the world's slow climate entered an epoch: `settlement` the world's largest town; `other` -1; `extra` +1 warm, -1 cold
  // governments: charters, communes, signorie and theocracies (200-209; none when HistoryOptions.governments is false; 206-209 spare).
  CharterBought: 200, // the town `settlement` bought its liberties from the polity ruled from `other` and is now the free city `value` (a new polity, origin Charter, bound to it by a Charter bond); `extra` the price paid (wealth)
  CommuneProclaimed: 201, // `settlement` became the capital of a republic: `value` the polity id (a new one for a rising or a stateless town, else its own); `other` the capital of the lord it rose against or stopped paying (-1 otherwise); `extra` how: 0 a rising won, 1 a free town constituted itself, 2 a free city stopped paying its due, 3 the council abolished the throne (or a league shrank to its head town), 4 the lords driven out and the republic restored
  SignoriaSeized: 202, // a strongman made himself lord of the republic ruled from `settlement`: `value` the polity id; `other` -1; `extra` how: 0 a war captain (condottiere), 1 the leading merchant family, 2 a demagogue in a time of strife. The new lord's RulerAcceded (AccessionHow.Usurped) follows when rulers are on
  TheocracyProclaimed: 203, // the clergy of faith `extra` (History.faiths) took the rule of its holy city `settlement`: `value` the polity id (a new one when the city broke away or was stateless); `other` the capital of the realm it broke from, or -1
  GovernmentChanged: 204, // the polity `value` ruled from `settlement` took the form of government `extra` (Government) for a cause that has no event of its own (GovernmentCause Crowned, Secularised or Settled: History.governments says which); `other` -1
  CharterRevoked: 205, // the polity ruled from `other` revoked the liberties of the free city `settlement` (its polity `value` ends Absorbed; the Charter bond ends Absorbed)
  // society: classes, wages and rents, elites and the secular cycle (240-249; none when HistoryOptions.society is false).
  SocialPhase: 240, // the polity `value` ruled from `settlement` entered a secular phase: `extra` the phase (SecularPhase: 2 a crisis of the social order, 0 a new expansion); `other` -1
  LabourDear: 241, // labour grew dear in the polity `value` ruled from `settlement` (its people fewer than its land wants): `other` the settlement of the epidemic that thinned it, or -1; `extra` the rise of the real wage (2 = doubled)
  SerfdomImposed: 242, // the lords of the polity `value` ruled from `settlement` bound its peasants to the land (labour scarce, the lords strong); `other` -1; `extra` the coercion now (0..1)
  SerfdomEnded: 243, // the peasants of the polity `value` ruled from `settlement` threw off their bondage (labour scarce, the lords weak); `other` -1; `extra` the coercion before (0..1)
  EliteFactions: 244, // the great families of the polity `value` ruled from `settlement` divided into factions (too many for the offices and lands; History.socElite); `other` -1; `extra` the elite pressure (EMP, 1 = reference)
  Ennobled: 245, // merchants of `settlement` bought land and titles among the nobility of the polity ruled from `other`: `value` the merchant family (History.families), -1 for the town's merchants; `extra` the elite share bought in (a share of the people)
  EliteThinned: 246, // the nobility of the polity `value` ruled from `settlement` was thinned by its wars and risings: `other` -1; `extra` the share of it lost since its peak (0..1)
  // language: the languages of the world (250-259; none when HistoryOptions.language is off).
  LanguageSplit: 250, // a language parted from its parent: `settlement` the daughter's seat (its first town), `other` the parent's seat; `value` the language id (History.languages); `extra` the LanguageSplitCause
  LanguageShift: 251, // the people of `settlement` (a town) took up the tongue of their rulers: `other` the capital of the polity whose people's language it took; `value` the language now spoken there; `extra` the language given up
  LoanWave: 252, // the language spoken at `settlement` (its largest town then) took many words from another (at least LANG.waveLoans of its visible words in LANG.waveYears): `other` the donor's seat (its largest town then); `value` the recipient language id; `extra` the donor language id
  LanguageDied: 253, // the last town that spoke language `value` (`settlement`) gave it up or was abandoned; `other` -1; `extra` the language that replaced it there, or -1
  // cold wars (barriers-coldwar §3; 393-398; none when HistoryOptions.coldWars is false; 390-392 are barriers', 399 spare).
  ColdWarBegan: 393, // the polities ruled from `settlement` and `other`, great rivals deterred from war, entered a cold war: `value` the cold war (History.coldWars); `extra` 1 when ideological (Phase 4), else 0
  ProxyWar: 394, // the polity ruled from `settlement` backed a side in a war it did not fight: `other` the backed side's capital; `value` the war (History.wars); `extra` the cold war (History.coldWars)
  ClientDefected: 395, // the client polity ruled from `settlement` left its patron for the rival principal ruled from `other`: `value` the cold war; `extra` the old patron's polity id
  Crisis: 396, // a crisis between the cold-war principals ruled from `settlement` and `other`: `value` the cold war; `extra` the CrisisOutcome (0 the first backed down, 1 the second, 2 a compromise, 3 war: WarDeclared follows)
  Detente: 397, // the cold war `value` between the polities ruled from `settlement` and `other` eased (extra 0: its intensity fell below half its peak) or froze again (extra 1)
  ColdWarEnded: 398, // the cold war `value` between the polities ruled from `settlement` and `other` ended: `extra` the ColdWarEnd (0 thaw, 1 hot war, 2 one side collapsed, 3 one side eclipsed, 4 one side ended)
  // typology: writing (400-409; none when HistoryOptions.typology is false; 405-409 spare). History.scripts / scriptUse.
  ScriptInvented: 400, // a people made writing of its own: `settlement` where (the IdeaAdoptions via), `other` the settlement it heard of writing from (Stimulus) or -1; `value` the script id (History.scripts); `extra` the ScriptOrigin (Invented or Stimulus)
  ScriptAdopted: 401, // a people learned to write another's script, fitted to its tongue: `settlement` where, `other` the source settlement; `value` the new (adapted) script id; `extra` the script it was adapted from
  ScriptReformed: 402, // a people made a new script out of its own (the alphabet idea, invented): `settlement` its largest town; `other` -1; `value` the new script; `extra` the old
  ScriptReplaced: 403, // a people gave up its script for another's: `settlement` its largest town, `other` the donor's capital or holy city; `value` the script now used; `extra` the ScriptCause (Rule, Faith, Idea)
  ScriptLost: 404, // the last people writing a script of the line of script `value` (its family) lost writing or left it for another line: `settlement` its largest town then; `other` -1; `extra` the people
} as const
export type EventType = (typeof EventType)[keyof typeof EventType]

export interface HistoryEvent {
  year: number
  type: EventType
  settlement: number
  /** Related settlement id, or -1. For Built and StructureLost it is a structure id instead. */
  other: number
  value: number
  /** A second number for the few event types that need one (see their comments); absent otherwise. */
  extra?: number
}

export interface History {
  /** The run covers years 0..years inclusive. */
  years: number
  /** Years between snapshots; snapshot s is year s * snapshotInterval. */
  snapshotInterval: number
  snapshotCount: number
  settlements: Settlement[]
  /**
   * Population per snapshot per settlement, row-major:
   * population[s * settlements.length + id]. 0 before founding and after abandonment.
   */
  population: Float32Array
  /** Food supply ratio in [0, 1] per snapshot per settlement (1 = fully fed), same layout as `population`. */
  food: Float32Array
  /** Per-cell carrying capacity in people at year 0 (0 for water), length grid.cellCount. Productivity growth raises the effective value over the run. */
  capacity: Float32Array
  /** All events in chronological order. */
  events: HistoryEvent[]
  journeys: Journeys
  /** Ports, dams and other things people build, indexed by Structure.id. */
  structures: Structure[]
  /** Years between land snapshots; land snapshot s is year s * landInterval. */
  landInterval: number
  landSnapshotCount: number
  /**
   * How intensively each cell is farmed, 0 (wild) to 255 (fully cultivated), per land snapshot per cell,
   * row-major: landUse[s * grid.cellCount + cell]. Cultivated forest is cleared forest.
   */
  landUse: Uint8Array
  /** Soil exhaustion and erosion from over-use, 0 (pristine) to 255 (ruined), same layout as `landUse`. Recovers when land is left alone. */
  degradation: Uint8Array
  /** Roads worn by overland trade, 0 (none) to 255 (major highway), same layout as `landUse`. Fades when traffic stops. */
  road: Uint8Array
  /**
   * Accumulated wealth per snapshot per settlement, in arbitrary units >= 0, same layout as `population`. The town's own;
   * its merchant houses' capital is `merchantWealth` (goods): a town's wealth a head is (wealth + merchantWealth) / population.
   */
  wealth: Float32Array
  trade: TradeRoutes
  /** Named geographic features, in order of naming. */
  features: GeoFeature[]
  /** The founding peoples; every settlement descends from exactly one. */
  peoples: People[]
  /**
   * Year each people first knew of each cell, or -1 if never by the end of the run, row-major:
   * knownYear[people * grid.cellCount + cell]. Knowledge is never lost, and peoples in contact share it.
   */
  knownYear: Int16Array
  /**
   * Year each pair of peoples first made contact, or -1 if never, row-major and symmetric:
   * contactYear[a * peoples.length + b]. The diagonal is 0.
   */
  contactYear: Int16Array
  /** The useful plants and animals of this world, indexed by SpeciesInfo.id. */
  species: SpeciesInfo[]
  /**
   * Year each people first held each species, or -1 if never, row-major:
   * speciesYear[people * species.length + species]. 0 for a people's founding set.
   */
  speciesYear: Int16Array
  /**
   * Which people each people got each species from, same layout as `speciesYear`:
   * the source people's id, or -1 if it was in their founding set, tamed from the wild, or never held.
   */
  speciesSource: Int8Array
  /**
   * Main staple crop grown in each cell per land snapshot (same layout as `landUse`): species id + 1, or 0 where nothing is farmed.
   */
  crop: Uint8Array
  /** Main herd animal kept in each cell per land snapshot, same encoding and layout as `crop`. */
  herd: Uint8Array
  /** Main cash crop (fibre, luxury or stimulant species) grown in each cell per land snapshot, same encoding and layout as `crop`. */
  cash: Uint8Array
  /** Farming techniques and improved strains, indexed by TechniqueInfo.id. */
  techniques: TechniqueInfo[]
  /** Year each people first had each technique, or -1 if never: techniqueYear[people * techniques.length + technique]. */
  techniqueYear: Int16Array
  /** Which people each people learned each technique from, same layout; -1 if worked out at home or never held. */
  techniqueSource: Int8Array
  /**
   * How habituated each people is to each stimulant species per snapshot, 0 to 255, row-major:
   * habit[(s * peoples.length + people) * stimulantCount + k], where k indexes `stimulants`.
   */
  habit: Uint8Array
  /** Species ids of the stimulant species, in the order used by `habit`. */
  stimulants: number[]
  /** Share of each settlement's food that keeps in store, 0 to 255, per snapshot per settlement (same layout as `population`). */
  storable: Uint8Array
  /**
   * Technology level per snapshot per people per field (see `TechField`), row-major:
   * technology[(s * peoples.length + people) * TECH_FIELD_COUNT + field]. Levels start near 1 and grow;
   * peoples in contact learn from each other. 0 once a people has died out.
   */
  technology: Float32Array
  /** Years between trade snapshots; trade snapshot s is year s * tradeInterval. */
  tradeInterval: number
  tradeSnapshotCount: number
  /**
   * Goods moved per year on each route per trade snapshot, row-major: tradeVolume[s * trade.count + route].
   * In value-weighted loads (one load is about a person-year of grain), both directions summed. 0 while the route is not open.
   */
  tradeVolume: Float32Array

  // polities: states, borders, war and danger (all empty when HistoryOptions.polities is false).
  /** States in order of founding (Polity.id is the index). */
  polities: Polity[]
  /**
   * Polity per snapshot per settlement, same layout as `population`: polity[s * settlements.length + id],
   * -1 when stateless or not alive. Expedition bases belong to their parent's polity.
   */
  polity: Int16Array
  /** Land cells (elevation >= 0, lakes included), ascending; static. The compact per-cell layers below index into it. */
  landCells: Uint32Array
  /**
   * Territory per land snapshot: the settlement whose land each cell is, plus 1 (0 = nobody's: wilderness, sea never),
   * row-major: territory[q * landCells.length + k] for cell landCells[k]. The cell's polity at a year is
   * polity[snapshot, owner]: borders move with membership every snapshot, territory shapes every land snapshot.
   * Land no settlement holds but a state claims (see `claimed`) is written as the claiming member settlement's.
   */
  territory: Uint16Array
  /**
   * 1 where the cell is claimed but not held: no settlement's own land, but inside a state's claims (enclosed pockets,
   * gaps between its members, hinterland out to a crest, a great river, a coast or a desert's far edge), so `territory`
   * names the member whose claim it lies in; 0 for held land and for nobody's land. Same layout as `territory`. Draw it
   * as the state's but lighter or hatched; claims lapse with the state (redrawn every land snapshot).
   */
  claimed: Uint8Array
  /** Danger (raids, war, lawlessness) 0..255 per land snapshot per land cell, same layout as `territory`. */
  danger: Uint8Array
  wars: Wars
  /** Raids on settlements below 1,000 people (not logged as events), summed per decade and settlement. */
  raids: RaidSummary

  // polities v2: trade policy, the outlaw economy and bonds between states (all empty when polities are off).
  /**
   * Tariff (import duty) rate of each polity per snapshot, 0..255 for 0..1 of the goods' value at the importer's price,
   * row-major: tariff[s * polities.length + id]; 0 outside the polity's life. Members' imports from settlements of other polities or
   * stateless ones pay it (food a fifth of it); a vassal and its overlord trade duty-free.
   */
  tariff: Uint8Array
  /** Duty revenue and seized contraband reaching each polity's capital, wealth a year (smoothed), same layout as `tariff`. */
  tariffRevenue: Float32Array
  /** Contraband loads a year on each route per trade snapshot, same layout as `tradeVolume` (and included in it): black-market routes. */
  smuggleVolume: Float32Array
  /**
   * Share of each route's cargo lost a year to pirates, privateers, a blockade or bandits per trade snapshot, 0..255 for 0..1,
   * same layout as `tradeVolume` (sea lanes struck by pirates, bandit roads), and to the other dangers of its way (war, raids:
   * the merchants' risk). 0 while the route is not open.
   */
  tradeLoss: Uint8Array
  /** Share of each settlement's income from smuggling per snapshot, 0..255 for 0..1, same layout as `population`: smugglers' hubs are high. */
  contraband: Uint8Array
  /** Strength of the pirates based at each settlement per snapshot, 0..255 for 0..1 (0: no pirate haven), same layout as `population`. */
  piracy: Uint8Array
  /** Vassalage, tribute and alliances between polities. */
  bonds: Bonds
  /** Embargoes between polities short of war. */
  embargoes: Embargoes
  /** oaths: wrongs one polity holds against another (empty when HistoryOptions.oaths or polities is false). */
  grievances: Grievances
  /**
   * oaths: each polity's name for faithlessness per snapshot, 0..255 for 0..OATH.repMax, row-major like `tariff`
   * (faithless[s * polities.length + id]); all 0 when oaths is off.
   */
  faithless: Uint8Array
  /** arms: each polity's armament M_p per snapshot, 0..255 for 0..1, laid out like `tariff`; all 0 when HistoryOptions.arms is false. */
  arms: Uint8Array
  /** arms: arms races between rival polities (empty when HistoryOptions.arms is false). */
  armsRaces: ArmsRaces
  /** cold wars: cold wars between great rivals (empty when HistoryOptions.coldWars is false). */
  coldWars: ColdWars

  // finance: crown treasuries and credit (all empty when HistoryOptions.finance is false).
  /** Coin in each polity's treasury per snapshot (wealth units; negative: bills in arrears), row-major like `tariff`; 0 outside its life. */
  treasury: Float32Array
  /** Principal each polity's crown owed per snapshot, same layout. */
  crownDebt: Float32Array
  /** Ordinary revenue (coin a year at peace, smoothed) and spending a year (smoothed: court, garrisons, works, war, tribute, interest), same layout. */
  crownRevenue: Float32Array
  crownSpending: Float32Array
  /** Interest rate the crown could borrow at per snapshot, 0..255 for 0..0.5 (255 also: no credit), same layout. */
  creditRate: Uint8Array
  /** Silver content of each polity's coin per snapshot, 0..255 for 0..1 (255 sound; 0 outside its life), same layout (always sound until debasement lands). */
  coinage: Uint8Array
  /** State fiscal distress per snapshot (finSFD), 0..255 for 0..FIN.sfdMax, same layout. */
  fiscalDistress: Uint8Array
  loans: Loans
  /** Principal outstanding per trade snapshot per loan account: loanBalance[q * loans.count + k] (0 before it opened and after it closed). */
  loanBalance: Float32Array

  // society: classes and the secular cycle (all empty when HistoryOptions.society is false). Row-major x[q * polities.length + id]
  // per snapshot like `tariff`, 0 outside the polity's life.
  /** Real wage of each polity's peasants and townsfolk per snapshot, 0..255 for 0..4 (64 = subsistence). */
  socWage: Uint8Array
  socUrbanWage: Uint8Array
  /** Rent index (1 = reference), 0..255 for 0..4. */
  socRent: Uint8Array
  /** Political stress Ψ and its factors MMP, EMP, SFD, 0..255 for 0..8 (32 = 1). */
  socPsi: Uint8Array
  socMMP: Uint8Array
  socEMP: Uint8Array
  socSFD: Uint8Array
  /** Shares of the people: elites 0..255 for 0..0.128, townsfolk 0..255 for 0..1, clergy 0..255 for 0..0.032; coercion 0..255 for 0..1. Peasants are the rest. */
  socElite: Uint8Array
  socUrban: Uint8Array
  socClergy: Uint8Array
  socCoercion: Uint8Array
  /** Secular phase (SecularPhase; 255 outside the polity's life). */
  socPhase: Uint8Array
  // beliefs: what states believed of each other (all empty when HistoryOptions.beliefs is false).
  /** Each polity's true strength (mass) per snapshot, laid out like `tariff`: strength[s * polities.length + id]; 0 outside its life. */
  strength: Float32Array
  beliefs: Beliefs
  /** The belief of each row per slow snapshot (every BELIEF.snapStep = 10 years: q = floor(year / 10)): the observer's estimate of the target's strength (mass units; 0 none yet), beliefEst[q * beliefs.count + k]. */
  beliefEst: Float32Array
  /** Its uncertainty: log standard deviation, 0..255 for 0..2.55, same layout. */
  beliefSd: Uint8Array
  /** The channels that informed it at that step (BeliefSource bits), same layout. */
  beliefSource: Uint8Array
  /** Per slow snapshot per polity (beliefStrength-like layout: q * polities.length + id): the shown strength factor minus 1 (0..255 for 0..1), the spy service (0..255 for 0..1) and the credibility (0..255 for 0..1). */
  bluffShown: Uint8Array
  spyService: Uint8Array
  credibility: Uint8Array

  // goods: worked goods, specialities, state secrets and long-distance trade (all empty when HistoryOptions.goods is false).
  /** Named kinds of goods within the market classes (Variety.id is the index; 0 is the unnamed Common variety). */
  varieties: Variety[]
  /** Rare deposits placed by geology (Deposit.id is the index). */
  deposits: Deposit[]
  /** Output per trade snapshot per deposit, in class units a year: depositOutput[q * deposits.length + d]. */
  depositOutput: Float32Array
  /** Named craft traditions in order of birth (Tradition.id is the index). */
  traditions: Tradition[]
  /** Quality per trade snapshot per tradition, 0 when not alive, else round(Q * 64): traditionQuality[q * traditions.length + t]. */
  traditionQuality: Uint8Array
  /** Industries per trade snapshot per settlement (bits, see IndustryBit): industry[q * settlements.length + id]. */
  industry: Uint16Array
  /**
   * Tools and arms per head per trade snapshot, log-coded (byte b > 0 means 2^((b - 160) / 16) units a head; 0 none):
   * metal[(q * settlements.length + id) * 2 + k], k 0 tools, 1 arms.
   */
  metal: Uint8Array
  /** Mart-to-mart legs of the long-haul trade. */
  longHaul: LongHaul
  /** Class units a year per leg per trade snapshot (both ways): longHaulVolume[q * longHaul.count + leg]. */
  longHaulVolume: Float32Array
  /**
   * Price index of the classes Luxury, Stimulant, Metalware, Finery, Treasure (PRICE_INDEX_GOODS order) per trade snapshot per
   * settlement, log-coded: byte b > 0 means price / worth = 2^((b - 128) / 16); 0 where it does not trade.
   * priceIndex[(q * settlements.length + id) * 5 + k].
   */
  priceIndex: Uint8Array
  /** 1 where a settlement is a mart (an entrepot of the long-haul trade) at a trade snapshot: mart[q * settlements.length + id]. */
  mart: Uint8Array
  /** State secrets and monopolies (Secret.id is the index). */
  secrets: Secret[]
  /** Who held which secret when. */
  secretHolds: SecretHolds
  /** Guard 0..255 of each secret by its main holder per trade snapshot: secretGuard[q * secrets.length + k]. */
  secretGuard: Uint8Array
  /** Trading posts in order of founding (TradingPost.id is the index). */
  posts: TradingPost[]
  /**
   * Merchant capital per snapshot per settlement (the merchant houses of the marts, from the long-haul trade; kept apart from
   * the town's `wealth`, which it feeds), same layout as `population`. High at an entrepot where legs meet; it leaves a
   * bypassed mart for the ends of the lane that took its trade (MerchantsMoved). Empty when goods are off.
   */
  merchantWealth: Float32Array
  // families: merchant families (empty when HistoryOptions.families or goods is false; then every other field is as without them, events aside).
  /** Named merchant families: their seats (home and factors), heads, lanes, marriages into ruling houses, backings and patronage. */
  families: MerchantFamilies
  // governments: forms of government (all empty when HistoryOptions.governments or polities is false).
  /** Forms of government over time (see Governments). */
  governments: Governments
  /** The rows of each polity: those of polity p are governmentIds[governmentOffsets[p] .. governmentOffsets[p + 1]). */
  governmentOffsets: Uint32Array
  governmentIds: Int32Array

  // disease: epidemics, endemic sickness and fever (all empty when HistoryOptions.disease is false).
  /** The diseases of this world (DiseaseInfo.id is the index); one that never appeared by the end of the run has firstYear -1 and no name. */
  diseases: DiseaseInfo[]
  /** Epidemics in order of their beginning (EpidemicInfo.id is the index): chains of outbreaks from one origin. */
  epidemics: EpidemicInfo[]
  /** Every outbreak (one settlement struck by one epidemic), in order of the year struck. */
  outbreaks: Outbreaks
  /**
   * Natural fever intensity per cell (malaria-like, place-bound), 0..255, length grid.cellCount (0 at sea); static. A settlement there
   * suffers fever * (1.25 if it grows paddy rice or has irrigated fields) * (1 - drainage at high Farming) * (1 - its people's tolerance).
   */
  fever: Uint8Array
  /** Acquired fever tolerance of each people per snapshot, 0..255 for 0..1: feverTolerance[s * peoples.length + people]. */
  feverTolerance: Uint8Array
  /** Diseases endemic among each people per snapshot, bit d for disease id d: endemic[s * peoples.length + people]. */
  endemic: Uint8Array
  /** Ports holding ships in quarantine. */
  quarantines: Quarantines

  // rulers: rulers, houses, marriages and unions (all empty when HistoryOptions.rulers or HistoryOptions.polities is false).
  /** Reigns in order of accession (Ruler.id is the index). A person ruling two realms in a union has one reign in each (see Ruler.person). */
  rulers: Ruler[]
  /** Ruling houses in order of founding (Dynasty.id is the index). */
  dynasties: Dynasty[]
  /**
   * The reigns of each polity in order of accession: those of polity p are reignIds[reignOffsets[p] .. reignOffsets[p + 1]).
   * The ruler of p at year y is the last of them with acceded <= y (reigns of one polity do not overlap; a reign that ended
   * the year the next began counts as the next's).
   */
  reignOffsets: Uint32Array
  reignIds: Int32Array
  /** Marriage ties between ruling houses. */
  marriages: Marriages
  /** Personal unions: two realms under one ruler. */
  unions: Unions
  /** War ids (History.wars) of the wars of succession, ascending. */
  successionWars: Int32Array

  // religion: faiths and their followers (all empty when HistoryOptions.religion is false).
  /** Faiths in order of founding (Faith.id is the index): each people's traditional faith first (faith id = people id), then universal faiths and schisms. */
  faiths: Faith[]
  /** Majority faith per snapshot per settlement, same layout as `population`: the Faith id, 255 when not alive. Expedition bases take their parent's. */
  faith: Uint8Array
  /** Share of its people that follow the majority faith, 0..255 for 0..1, same layout as `faith` (0 when not alive). */
  faithShare: Uint8Array
  /** State religion of each polity per snapshot, faith id + 1 (0: none, or outside the polity's life), same layout as `tariff`. */
  stateFaith: Uint8Array
  /** War ids (History.wars) of the holy wars, ascending (each also logged as EventType.HolyWar). */
  holyWars: Int32Array
  // tourism: scenery, sights, leisure travel and resort towns (all empty when HistoryOptions.tourism is false).
  /**
   * Scenery per cell, 0..255, length grid.cellCount (0 at sea and on lakes); static. Rank-based over land: 255 * u^3 for the
   * cell's rank u in [0, 1] among land cells by raw scenic value, so only a minority of cells are truly scenic (u 0.9 is 186).
   */
  scenery: Uint8Array
  /** What makes each cell scenic (SceneryBit flags), length grid.cellCount; static. */
  sceneryKind: Uint16Array
  /** Sights: places worth the journey that history made (ruins, old capitals, first ascents, ...), in order of recognition (Sight.id is the index). */
  sights: Sight[]
  /** Leisure travel between towns and the places their people visit. */
  visitorFlows: VisitorFlows
  // renaming: places renamed by history (empty when HistoryOptions.renaming is false).
  /**
   * Every renaming of a settlement, in chronological order (each also logged as EventType.PlaceRenamed). Settlement.name stays
   * the founding name; the name in use at a year is settlementNameAt(history, id, year).
   */
  renamings: Renamings
  // ideas: inventions and practices, who conceived them and how they travelled (empty when HistoryOptions.ideas is false).
  /** The catalogue of ideas (IdeaInfo.id is the index); the same in every world, with this world's first origin filled in. */
  ideas: IdeaInfo[]
  /**
   * Every adoption and loss of an idea by a people, in chronological order (each also an IdeaConceived, IdeaAdopted or IdeaLost event):
   * the ideas a people holds at a year are those whose last row for it by then is not a loss (ideasHeldAt).
   */
  ideaAdoptions: IdeaAdoptions
  // landmarks: great buildings (castles, palaces, temples, ...) and the lesser houses of worship, raised as a consequence of history
  // (empty when HistoryOptions.landmarks is false). Never removed: a landmark outlives its town's fortunes in its states.
  landmarks: Landmarks
  // language: languages that split and drift (absent when HistoryOptions.language is off: older histories and links without lang=1).
  /** The language tree (Languages). */
  languages?: Languages
  /** What each settlement speaks over time (Speech). */
  speech?: Speech
  /** Names as underlying forms, and exonyms (NameForms); the name said at a year is spokenNameAt (names/spoken.ts). */
  nameForms?: NameForms
  // typology: writing systems (absent when HistoryOptions.typology is off, or without ideas).
  /** The writing systems of the world (Scripts). */
  scripts?: Scripts
  /** Which script each people writes over time (ScriptUse). */
  scriptUse?: ScriptUse
  // orders: (absent when HistoryOptions.orders is undefined or empty).
  /** The orders as given (HistoryOptions.orders, a copy, in the given order). */
  orders?: Order[]
  /** What became of each order: orderOutcomes[k] is for orders[k]. */
  orderOutcomes?: OrderOutcome[]
  // cradle wishes: (absent when HistoryOptions.cradles holds no wish for any people, i.e. undefined, [], or only -1 there).
  /** Per people: the cell the player wished it to begin on (HistoryOptions.cradles[p], when a whole number >= 0), or -1. */
  cradleWish?: Int32Array
  /** Per people: the cell it actually began on (the cell of its first settlement, settlements[peoples[p].founder].cell, also without wishes). */
  cradleCell?: Int32Array
  /** Per people: the CradleOutcome. */
  cradlePlaced?: Uint8Array
  /** Per people: 1 when another wished people began within sight of it (kept, but noted), else 0. */
  cradleCrowded?: Uint8Array
  // disasters: natural shocks and climate (empty when HistoryOptions.disasters is false).
  /** Every eruption, recorded earthquake, tsunami, great flood, persistent drought and climate epoch, in order of recording. */
  disasters: Disasters
  /** The world's climate per year (zero-length arrays when off). */
  climate: ClimateSeries
  /** Weather region per cell (the harvest regions), for drawing droughts and floods; empty when off. */
  weatherRegion: Uint16Array

  // battles: the battles of the wars and their commanders (all empty when HistoryOptions.battles or polities is false).
  battles: Battles
  commanders: Commanders
  // causes: why things happened, for the causal explorer (HistoryOptions.causes). Recording only: every other field is the same
  // with it on or off. Empty (counts 0) when it is off; absent in histories cached before it existed.
  why?: CauseRecords
  /** seat: the player's seat, the polity it held year by year and the decisions offered (absent when HistoryOptions.seat is undefined). */
  seat?: SeatHistory
  /** rulers: deference, how far realms grew used to being ruled without their rulers (rulers/deference.ts); absent when nothing fed it. */
  deference?: DeferenceHistory
}

/**
 * cradle wishes: what became of a people's wished start cell (History.cradlePlaced, the `extra` of EventType.CradlePlaced).
 * The rule: a wished cell must be land a founding tribe can live on (not sea, ice, bare rock or dry waste: the simulation's own
 * test for tribe sites) and not already taken by an earlier wish; else the nearest such cell within 3 hops of it (at the default
 * grid, scaled with the grid; over land or sea) is used; else the wish is rejected and the simulation chooses.
 */
export const CradleOutcome = {
  Chosen: 0, // no wish: the simulation chose (it may have moved this people off a wished one)
  Placed: 1, // begun on the wished cell
  Moved: 2, // the wished cell was unlivable (or taken): begun on the nearest livable land
  Rejected: 3, // no livable land near the wish (or a cell outside the world): the simulation chose
} as const
export type CradleOutcome = (typeof CradleOutcome)[keyof typeof CradleOutcome]

/** The wishes of HistoryOptions.cradles as text: cell ids (or -1) joined by `;` (e.g. `12345;-1;9981`); decodeCradles reverses it. */
export function encodeCradles(cells: readonly number[]): string {
  return cells.map((c) => (Number.isInteger(c) && c >= 0 ? String(c) : '-1')).join(';')
}

/** Parses encodeCradles text; an item that is not a whole number >= 0 reads as -1 (the position is kept). Empty text: []. */
export function decodeCradles(text: string): number[] {
  const t = text.trim()
  if (t === '') return []
  return t.split(';').map((x) => {
    const v = x.trim()
    return /^\d{1,10}$/.test(v) && Number(v) <= 0x7fffffff ? Number(v) : -1
  })
}

/** The canonical form of a wish list (for cache keys and URLs): anything but a whole number >= 0 as -1, trailing -1s dropped ([] when there is no wish). Gives the same History as the list itself. */
export function canonicalCradles(cells: readonly number[]): number[] {
  const out = decodeCradles(encodeCradles(cells))
  let n = out.length
  while (n > 0 && out[n - 1] < 0) n--
  out.length = n
  return out
}

// ---------------------------------------------------------------------------
// renaming: places renamed as a consequence of history.

/** language: why a language parted from its parent (Languages.cause). */
export const LanguageSplitCause = { Proto: 0, Overseas: 1, Distance: 2 } as const
export type LanguageSplitCause = (typeof LanguageSplitCause)[keyof typeof LanguageSplitCause]

/**
 * language: the kinds of regular sound change (SOUND_CHANGES in names/soundChange.ts is the catalogue; Languages.ruleKind
 * indexes it). Each is a rewrite on phoneme units with a context; a word whose result would not be euphonic keeps its form.
 */
export const SoundChangeKind = {
  Lenition: 0, // a stop or fricative softens between vowels (t > d, k > g, p > b)
  Palatalisation: 1, // a consonant before i or e becomes palatal (k > ch, s > sh, g > y)
  VowelShift: 2, // a vowel moves everywhere (a > o, e > i), sometimes as a chain
  Raising: 3, // a vowel rises before a nasal that closes its syllable (a > o, e > i)
  Umlaut: 4, // a back vowel fronts when i follows in the next syllable (a > e, o > e, u > i)
  Syncope: 5, // the vowel of the second (or the next-to-last) syllable falls between consonants in a word of 3+ syllables
  Apocope: 6, // a final vowel falls in a word of 3+ syllables
  FinalLoss: 7, // a final consonant falls after a vowel (or a final nasal after an unstressed vowel, the vowel opening to a)
  ClusterSimplify: 8, // the first of two consonants assimilates to the second (kt > t, nd > n)
  Monophthong: 9, // a diphthong becomes one vowel (ai > e, au > o)
  HLoss: 10, // h falls (initially, between vowels)
  Depalatalise: 11, // a palatal turns back (sh > s, ch > t, y > l)
  Fortition: 12, // a word-initial w, y or v hardens (w > v, y > g before back vowels, v > b)
  Prothesis: 13, // a vowel is put before an initial s-cluster (sp > esp)
  // typology: phoneme model only (names/soundChangeF.ts FEATURE_CHANGES; kinds 0-13 have feature versions there too). Next free 26.
  Tonogenesis: 14, // a final stop falls and leaves a contour tone on the vowel (falling after a voiceless one, rising after a voiced or glottal)
  Nasalise: 15, // a vowel before a nasal that closes its syllable takes on nasality and the nasal falls (aN > ã)
  Deaspirate: 16, // aspirated stops merge with plain ones
  Deglottalise: 17, // ejectives (or implosives) become plain stops
  UvularMerge: 18, // uvulars move to velar (q > k, χ > x)
  RetroflexMerge: 19, // retroflexes merge with alveolars
  Debuccalise: 20, // s > h, or a final k/t > ʔ
  LengthChange: 21, // long vowels shorten, or a lost coda lengthens the vowel (compensatory lengthening)
  ToneMerge: 22, // two tone levels merge (M and L, rising and high, falling and low)
  HarmonyLoss: 23, // vowel harmony stops applying to new suffixes (inherited words keep their vowels)
  Prenasal: 24, // prenasalised stops become plain voiced stops, or nasals
  ClusterBreak: 25, // an echo vowel breaks a cluster the template does not allow (CC > CVC)
} as const
export type SoundChangeKind = (typeof SoundChangeKind)[keyof typeof SoundChangeKind]

/** typology: kinds of writing system (Daniels & Bright 1996; 'featural' after Sampson). */
export const ScriptType = { Logosyllabic: 0, Syllabary: 1, Abugida: 2, Abjad: 3, Alphabet: 4, Featural: 5 } as const
export type ScriptType = (typeof ScriptType)[keyof typeof ScriptType]
export const ScriptDirection = { LTR: 0, RTL: 1, Vertical: 2, Boustrophedon: 3 } as const
export type ScriptDirection = (typeof ScriptDirection)[keyof typeof ScriptDirection]
/** Where a script came from (Scripts.origin). */
export const ScriptOrigin = { Invented: 0, Stimulus: 1, Adapted: 2, Reformed: 3 } as const
export type ScriptOrigin = (typeof ScriptOrigin)[keyof typeof ScriptOrigin]
/** Why a people writes the script it writes (ScriptUse.cause; the `extra` of ScriptReplaced). */
export const ScriptCause = { Own: 0, Learned: 1, Rule: 2, Faith: 3, Idea: 4, Lost: 5 } as const
export type ScriptCause = (typeof ScriptCause)[keyof typeof ScriptCause]

/**
 * typology: the writing systems of the world (only with HistoryOptions.typology; absent otherwise). Row i is script i in order
 * of appearance (a parent before its daughters). Glyph shapes are not stored: they are a pure function of (world seed, family,
 * script id) (language-typology-scripts.md §6).
 */
export interface Scripts {
  count: number
  /** ScriptType, ScriptDirection and ScriptOrigin of each. */
  type: Uint8Array
  direction: Uint8Array
  origin: Uint8Array
  /** Script it came from (-1 for an invention), and the root of its line (stroke primitives are the family's). */
  parent: Int16Array
  family: Int16Array
  /** People that made it, the language (History.languages) its signs were fitted to, the year and the town. */
  people: Int16Array
  language: Int16Array
  year: Int16Array
  settlement: Int32Array
  /** "Ashkari": its makers' name (plain), shown as "the Ashkari script"; a reform "New Ashkari". */
  name: string[]
}

/** typology: which script each people writes over time. Rows by people, years ascending: start[p] .. start[p + 1] - 1. */
export interface ScriptUse {
  start: Int32Array
  year: Int16Array
  /** Script written from that year, -1: writing lost. */
  script: Int16Array
  /** ScriptCause. */
  cause: Uint8Array
}

/** typology: the script people `p` writes at `year` (History.scripts id), or -1 (unwritten, or no scripts in this history). */
export function scriptAt(h: Pick<History, 'scriptUse'>, p: number, year: number): number {
  const u = h.scriptUse
  if (!u || p < 0 || p + 1 >= u.start.length) return -1
  let s = -1
  for (let k = u.start[p]; k < u.start[p + 1] && u.year[k] <= year; k++) s = u.script[k]
  return s
}

/** typology: how a language builds names (Languages.typo bits 8-10; names/typology/profile.ts Style mirrors it; WALS 26A/20A priors). */
export const MorphStyle = { Isolating: 0, Suffixing: 1, Prefixing: 2, Compounding: 3, RootPattern: 4 } as const
export type MorphStyle = (typeof MorphStyle)[keyof typeof MorphStyle]

/**
 * language: the language tree (absent when HistoryOptions.language is off). Row i is language i, in order of appearance (a
 * parent before its daughters; a people's proto-language when its first town is founded). A language is not a people: a people
 * speaks one or more languages over time, and a town may shift to another people's (History.speech).
 */
export interface Languages {
  count: number
  /** Language it parted from, or -1 for a people's proto-language. */
  parent: Int16Array
  /** People whose tongue it is by descent (the proto-language's people), index into History.peoples. */
  people: Int16Array
  /** Year it parted from its parent (the founding year of its people's first town for a proto-language). */
  splitYear: Int16Array
  cause: Uint8Array
  /** First settlement that spoke it (the daughter's seat; the founder for a proto-language). */
  seat: Int32Array
  /** Its name as its speakers say it at the end of the run ("Vashtari", "Kepian"). */
  name: string[]
  /** Relative pace of change (1 typical; drawn once, LANG.rateSpread). */
  rate: Float32Array
  /** Sound changes of language i: rows ruleStart[i] .. ruleStart[i + 1] - 1 of the rule columns, in date order (length count + 1). */
  ruleStart: Int32Array
  /** Rule columns: the year it took hold, its SoundChangeKind and its catalogue variant (SOUND_CHANGES[kind][variant]). */
  ruleYear: Int16Array
  ruleKind: Uint8Array
  ruleVariant: Uint8Array
  /**
   * Core vocabulary (LANG.core meanings; 0 .. LANG.visible - 1 the words names are made of): the rows of each language by
   * meaning, lexStart[i * core + m] .. lexStart[i * core + m + 1] - 1 of the lex columns (length count * core + 1): the year a
   * word took the meaning (the proto-language's inherited words at its start), the donor language (-1 a native word) and the
   * word's form (a native word's underlying form; a loan's form as borrowed).
   */
  lexStart: Int32Array
  lexYear: Int16Array
  lexDonor: Int16Array
  lexForm: string[]
  /**
   * typology: 1 when the forms (here, NameForms and the rule catalogue) are phoneme strings (names/typology/phoneme.ts: one
   * Private Use Area code unit per phoneme) and names are spelt by `ortho` (HistoryOptions.typology). Absent, not empty, without
   * it, so letter histories hash as before; then model, typo and ortho are all absent.
   */
  model?: number
  /**
   * typology: the packed profile per language (inherited at a split, unchanged; names/typology/inventory.ts packTypo): bits 0-1
   * onsetMax, 2-3 codaMax, 4-6 tones, 7 harmony, 8-10 MorphStyle, 11 head-initial compounds, 12 class prefixes, 13-14 syllable
   * class, 15 CV only, 16-17 finalMax, 18 nasal vowels, 19 length. The sound-change gate reads it (no Rng in the UI).
   */
  typo?: Uint32Array
  /** typology: the spelling tradition per language (names/typology/orthography.ts; 16 slots of 2 bits). */
  ortho?: Uint32Array
}

/**
 * language: what each settlement speaks over time (absent when off). Each settlement has a founding row; a row is added when
 * its region parts as a daughter language (LanguageSplit) or it shifts (LanguageShift). Rows by settlement, years ascending:
 * rows start[id] .. start[id + 1] - 1 (start has length settlements + 1).
 */
export interface Speech {
  start: Int32Array
  year: Int16Array
  language: Int16Array
}

/**
 * language: names as underlying forms (absent when off). A settlement's founding name, and each renaming's name, was coined as
 * an underlying form in a language; the name said in a year is that form through the sound changes of the speakers' line up to
 * the year (spokenNameAt). Settlement.name stays the name as said at the founding, and Renamings.name the name as said at the
 * renaming.
 */
export interface NameForms {
  /** Underlying form (lower case) and coining language of each settlement's founding name. */
  form: string[]
  language: Int16Array
  /** Per renaming row (History.renamings), its underlying form and coining language (a restored name: its earlier row's). */
  renamingForm: string[]
  renamingLanguage: Int16Array
  /**
   * Exonyms: what another people calls a town, borrowed once (`year`) from the name said then, into language `language` (the
   * form as borrowed, worn on from then by that language's changes). Towns that reached TOWN_POPULATION, for each people in
   * contact with the town's. Sorted by (settlement, people).
   */
  exoSettlement: Int32Array
  exoPeople: Int16Array
  exoYear: Int16Array
  exoLanguage: Int16Array
  exoForm: string[]
}

/** Why a settlement was renamed (History.renamings.cause, the `extra` of EventType.PlaceRenamed). */
export const RenameCause = {
  Conquest: 0, // held for some years by a conqueror of another people, whose tongue adapted the name or replaced it (Smyrna to Izmir, New Amsterdam to New York)
  Cession: 1, // passed to a state of another people at a peace treaty and renamed by its new masters (Koenigsberg to Kaliningrad, Pressburg to Bratislava)
  Capital: 2, // made a capital or imperial seat and renamed for the ruler or the house, or given a new royal name (Byzantium to Constantinople, Edo to Tokyo, Ahmedabad)
  Refounded: 3, // sacked, then rebuilt by its conquerors under a new name (Jerusalem to Aelia Capitolina, Carthage refounded)
  Faith: 4, // rededicated to a faith: a new state religion renaming the royal city or the old faith's holy city, or a holy city taken by a state of another faith (Yathrib to Medina, Prayag to Allahabad)
  Trade: 5, // the name foreign traders used for a port that hosted their factory for generations stuck (Bombay, Canton, Madras)
  Restored: 6, // an earlier name back on liberation, secession or the fall of the conqueror: the town under a state of the people whose name it bore (Chennai, Mumbai, Gdansk; Christiania to Oslo)
  Revived: 7, // a town grown on the site of a ruin took the old town's name (the revived ancient names of modern Greece and Israel)
  HouseFell: 8, // the house it was named for lost the throne: the previous name back, or a neutral new one (Leningrad to St Petersburg, Stalingrad to Volgograd)
  Distinguished: 9, // founded with a name another town already bore: known from its founding by a qualified form (Newcastle-under-Lyme); logged in its founding year
} as const
export type RenameCause = (typeof RenameCause)[keyof typeof RenameCause]

/** What a new name is made of (History.renamings.form). */
export const RenameForm = {
  Adapted: 0, // the old name in the new masters' tongue: its sounds fitted to their language, perhaps clipped or with one of their endings
  New: 1, // a fresh name in the new masters' language
  Ruler: 2, // named for the reigning ruler (History.renamings.ruler): the ruler's name with a city ending of the language
  House: 3, // named for the ruling house (History.renamings.dynasty)
  Faith: 4, // named for a faith (History.renamings.faith)
  Restored: 5, // an earlier name of the town (History.renamings.restored says which)
  Revived: 6, // the name of the ruin it stands on (History.renamings.source)
  Qualified: 7, // its founding name with an ending of its own language (Distinguished)
} as const
export type RenameForm = (typeof RenameForm)[keyof typeof RenameForm]

/** `restored` of a renaming that gives a name not borne before. */
export const NEW_NAME = -2

/**
 * Renamings, struct-of-arrays in chronological order (a year's renamings in the order they happened; a longer run repeats a
 * shorter one's table exactly). The name in use at year y is that of the last renaming of the settlement with year <= y, else
 * Settlement.name. No two living settlements bear the same name at any year; a name is never borne by two settlements over the
 * run, except that a revived name passes from the abandoned ruin to the town on its site.
 */
export interface Renamings {
  count: number
  settlement: Int32Array
  year: Int16Array
  /** The new name. */
  name: string[]
  cause: Uint8Array
  form: Uint8Array
  /** The polity behind it (the conqueror, the realm whose capital it became, the liberator, the trading power; for a revived name the town's own), -1 (none: Distinguished, stateless). */
  polity: Int16Array
  /** The ruler of that polity at the year (History.rulers; the one honoured when the form is Ruler), -1 (none, or rulers off). */
  ruler: Int32Array
  /** That ruler's house (History.dynasties; the one honoured when the form is House), -1. */
  dynasty: Int32Array
  /** The faith it was named for (form Faith), or the holy city's faith a Faith renaming took from it, -1. */
  faith: Int16Array
  /** The people whose language the new name is in. */
  people: Int16Array
  /** The renaming whose name this one replaces, -1 for the founding name (Settlement.name). */
  previous: Int32Array
  /** Restored, Revived, HouseFell back to an old name: the renaming that first gave the name now borne again, -1 for a founding name (of `settlement`, or of `source` when revived); NEW_NAME (-2) for a new name. */
  restored: Int32Array
  /** Revived: the abandoned settlement whose name it took; else -1. */
  source: Int32Array
  /** The people who kept the previous name in use (the town's own people under a name imposed by foreigners who persecute them, or while a state of their own stands), -1. */
  keptBy: Int16Array
}

/** Index into History.renamings of the renaming in force for settlement `id` at `year` (its last with year <= `year`), or -1 for the founding name. */
export function renamingAt(h: Pick<History, 'renamings'>, id: number, year: number): number {
  const R = h.renamings
  let k = -1
  if (!R) return k
  for (let i = 0; i < R.count && R.year[i] <= year; i++) if (R.settlement[i] === id) k = i
  return k
}

/** Name in use of settlement `id` at `year` (Settlement.name until its first renaming). */
export function settlementNameAt(h: Pick<History, 'settlements' | 'renamings'>, id: number, year: number): string {
  const k = renamingAt(h, id, year)
  return k < 0 ? h.settlements[id].name : h.renamings.name[k]
}

/** Earlier names of settlement `id` before the one in use at `year`, most recent first, each once ("formerly ..."). */
export function formerNamesAt(h: Pick<History, 'settlements' | 'renamings'>, id: number, year: number): string[] {
  const R = h.renamings
  const now = settlementNameAt(h, id, year)
  const seq: string[] = []
  if (R) for (let i = 0; i < R.count && R.year[i] <= year; i++) if (R.settlement[i] === id) { if (seq.length === 0 && R.cause[i] !== RenameCause.Distinguished) seq.push(h.settlements[id].name); seq.push(R.name[i]) }
  const out: string[] = []
  for (let i = seq.length - 2; i >= 0; i--) if (seq[i] !== now && out.indexOf(seq[i]) < 0) out.push(seq[i])
  return out
}

// ---------------------------------------------------------------------------
// tourism: scenery, sights, leisure travel and resorts.

/** What makes a cell scenic (History.sceneryKind bits). */
export const SceneryBit = {
  Relief: 1, // mountains beside lowland or water
  Lake: 2, // a lake shore
  Coast: 4, // a sea coast (capes and peninsulas score more)
  Island: 8, // a small island
  River: 16, // a great river or its mouth
  Forest: 32, // woodland
  Snow: 64, // snowy peaks or glaciers within reach
  Pleasant: 128, // mild climate: moderate warmth and rainfall
  Cold: 256, // a striking cold place (ice, fjord, tundra coast)
  Spring: 512, // hot springs (volcanic or plate-boundary ground)
  GreatLake: 1024, // shore of the world's largest lakes
  GreatRange: 2048, // beside the world's highest range
} as const
export type SceneryBit = (typeof SceneryBit)[keyof typeof SceneryBit]

/** Kind of sight (History.sights). */
export const SightKind = {
  Ruin: 0, // the ruins of a town that was once large
  OldCapital: 1, // a former capital (held for a century or more), perhaps walled, with its old palaces
  Summit: 2, // a summit first reached by an expedition (a famous ascent)
  PolarBase: 3, // a former expedition base in the polar cold
  MineTown: 4, // a mining boom town gone quiet
  FormerResort: 5, // a resort that went out of fashion long ago: quaint
  Holy: 6, // a holy city (pilgrimage; from the religion system)
  Landmark: 7, // landmarks: a great landmark ruined, left unfinished, or centuries old (Sight.landmark is its row in History.landmarks: show landmarkNameAt)
} as const
export type SightKind = (typeof SightKind)[keyof typeof SightKind]

export interface Sight {
  /** Index into History.sights. */
  id: number
  kind: SightKind
  cell: number
  /** The settlement it belongs to (a ruin's abandoned settlement, the old capital, the mine town), or -1. */
  settlement: number
  /** Year it became a sight. */
  fromYear: number
  /** How famous, 0..1 (the pull it adds to the place). */
  fame: number
  /** Its settlement's name, or the name of the feature it is on (a summit's range), or '' (a Landmark sight's too: its own name is landmarkNameAt(h, landmark, year)). */
  name: string
  /** landmarks: a Landmark sight's row in History.landmarks (absent on the other kinds). */
  landmark?: number
}

/**
 * Leisure travel: pairs (home town `from`, visited settlement `to`) in order of first travel, struct-of-arrays, and their
 * visitors per trade snapshot as sparse rows sorted by snapshot then pair (pairs without visitors at a snapshot have no
 * row). Pair k's travellers follow cells path[pathOffsets[k] .. pathOffsets[k + 1]) from `from` to `to`.
 */
export interface VisitorFlows {
  count: number
  from: Int32Array
  to: Int32Array
  firstYear: Int16Array
  pathOffsets: Uint32Array
  path: Uint32Array
  rowCount: number
  /** Trade snapshot index of each row (year rowSnapshot * tradeInterval). */
  rowSnapshot: Uint16Array
  /** Pair index of each row. */
  rowPair: Int32Array
  /** Visitors a year, and the wealth they spend there a year. */
  visitors: Float32Array
  spend: Float32Array
}

// ---------------------------------------------------------------------------
// disease: epidemics, endemic sickness and fever.

export const DiseaseKind = {
  Crowd: 0, // a sickness of herds and towns (smallpox, measles): passes person to person, needs towns to keep going, endemic in large networks
  Plague: 1, // a sickness with a wild rodent reservoir: spills over near the reservoir, travels with trade and ships, returns in waves
  Fever: 2, // place-bound fever of hot, wet lowlands (malaria): does not pass along routes; burdens whoever lives there
  Camp: 3, // camp fever (typhus): born in armies and sieges, carried by soldiers
} as const
export type DiseaseKind = (typeof DiseaseKind)[keyof typeof DiseaseKind]

export interface DiseaseInfo {
  /** Index into History.diseases (also the bit in History.endemic). */
  id: number
  kind: DiseaseKind
  /** The real-world model, as a stable key: 'pox', 'measles', 'flux', 'plague', 'fever', 'typhus'. */
  archetype: string
  /** Its name in this world, a word from the language of the people it first struck ('' if it never appeared). */
  name: string
  /** Year it first struck, -1 if never. */
  firstYear: number
  /** Settlement first struck, and its people; -1 if never. */
  firstSettlement: number
  originPeople: number
  /** Cell of its origin: the centre of the reservoir (Plague, known from the start), else the first settlement's cell; -1 if never. */
  originCell: number
  /** Share of those who catch it who die, before the town, famine and first-exposure factors. */
  mortality: number
  /** Years a settlement stays sick (and infectious) once struck. */
  duration: number
  /** Survivors' immunity fading a year (0: for life). */
  fade: number
  /** Travels by ship: weight of sea links (0 never, 1 like land). */
  sea: number
  /** People (susceptible) a place needs to pass it on in full: towns more than villages. 0 for fever. */
  crowd: number
  /** Critical community size: a people (with the peoples it trades with) of at least this many keeps it endemic; 0 if it never becomes endemic. */
  criticalSize: number
  /** True for a place-bound fever (never passes along routes). */
  placeBound: boolean
}

/** One epidemic: outbreaks chained from one origin (a spill from the reservoir or herds, a returning focus, an arrival from another people). */
export interface EpidemicInfo {
  /** Index into History.epidemics. */
  id: number
  disease: number
  startYear: number
  /** Last year a settlement was still sick of it; -1 while it is still going at the end of the run. */
  endYear: number
  /** Settlement where it began. */
  origin: number
  /** Settlement of another people (or the returning focus) it came from, -1 for a spill from the reservoir or herds. */
  source: number
  /** Expected deaths (people) and the people of the peoples it reached (each counted when first reached). */
  deaths: number
  network: number
  /** Outbreaks (History.outbreaks rows) and the ids of the peoples it reached, in order. */
  outbreaks: number
  peoples: number[]
  /** True once it has killed at least 5% of its network (GreatEpidemic). */
  great: boolean
}

/** How an outbreak reached its settlement. */
export const DiseaseVia = {
  Origin: 0, // the epidemic began here (spill from the reservoir or herds)
  Route: 1, // along a trade route (or a long-haul leg) overland
  Sea: 2, // along a sea route or lane, by ship
  Near: 3, // from a neighbouring settlement (fields, markets, flight)
  Kin: 4, // between a settlement and its mother or daughters
  Journey: 5, // with settlers, migrants, an expedition or a fleet (History.journeys)
  Army: 6, // with an army on the march, or home again
  Contact: 7, // at the first contact between two peoples
  Focus: 8, // returned from where it lingered (a plague focus)
  Visitors: 9, // tourism: with leisure travellers, between their home town and the resort they visited
} as const
export type DiseaseVia = (typeof DiseaseVia)[keyof typeof DiseaseVia]

/** Outbreaks, struct-of-arrays in order of the year struck: settlement[i] was struck in year[i] and sick for its disease's duration. */
export interface Outbreaks {
  count: number
  disease: Uint8Array
  settlement: Int32Array
  year: Int16Array
  /** Share of the settlement's people expected to die of it, 0..255 for 0..1 (spread over its duration). */
  mortality: Uint8Array
  /** Settlement it came from, -1 at the origin. */
  source: Int32Array
  /** DiseaseVia. */
  via: Uint8Array
  /** Epidemic (History.epidemics). */
  epidemic: Int32Array
}

/** Ports in quarantine: settlement[i] held ships from year from[i] to year to[i] (-1: still at the end). */
export interface Quarantines {
  count: number
  settlement: Int32Array
  from: Int16Array
  to: Int16Array
}

// ---------------------------------------------------------------------------
// rulers: named rulers, ruling houses, marriages and personal unions.

/** How a ruler came to the throne. */
export const AccessionHow = {
  Founded: 0, // founded the realm (or came to power with it: a revolt's leader, a successor state's first ruler)
  Inherited: 1, // by the realm's law of succession (or a share of a realm divided among heirs)
  Elected: 2, // chosen by the great men of the realm (an elective throne, a new house raised when the old died out, a league's, republic's, free city's or theocracy's head)
  Usurped: 3, // seized the throne (a general or a magnate overthrowing the ruler, or prevailing in a disputed succession)
  Conquered: 4, // set on the throne by a conqueror after the capital fell
  Union: 5, // inherited through a marriage claim while ruling another realm (a personal union)
  Claimed: 6, // a rival claimant who rose against the capital (the first ruler of a civil war's pretender state)
} as const
export type AccessionHow = (typeof AccessionHow)[keyof typeof AccessionHow]

/** How a reign ended. */
export const ReignEnd = {
  Reigning: 0, // still on the throne at the end of the run
  Natural: 1, // died of age or illness
  Battle: 2, // fell in battle
  Sack: 3, // killed when the capital fell
  Overthrown: 4, // killed by a usurper
  Deposed: 5, // driven from the throne alive (a usurper, a lost disputed succession, a union split)
  Plague: 6, // died of an epidemic (disease system)
  RealmEnded: 7, // the realm itself ended (conquered, reunified, absorbed, fragmented, dwindled)
  TermEnded: 8, // an elected head's term ran out (a league, republic or free city)
} as const
export type ReignEnd = (typeof ReignEnd)[keyof typeof ReignEnd]

/** Law of succession of a people (it may change over time; Ruler.law is the one in force at the accession). */
export const SuccessionLaw = {
  Primogeniture: 0, // the eldest son (daughters after sons where women may inherit)
  Partible: 1, // the eldest takes the capital; the realm may be divided among adult sons
  Elective: 2, // the great men choose among the house (or another)
  Seniority: 3, // the eldest of the house: brothers before sons (tanistry, rota)
} as const
export type SuccessionLaw = (typeof SuccessionLaw)[keyof typeof SuccessionLaw]

/** One reign: a ruler on one throne. */
export interface Ruler {
  /** Index into History.rulers; ids in order of accession. */
  id: number
  /** Personal name in the language of the house (the UI adds the regnal number and title: "Queen Vashtara II"). */
  name: string
  /** Regnal number: 1 + the number of earlier reigns of the same polity with the same name. */
  regnal: number
  female: boolean
  born: number
  acceded: number
  /** Year the reign ended, -1 while reigning at the end of the run. */
  ended: number
  /** Year of death, -1 if alive at the end of the run or the reign ended without a death (deposed, realm gone, term ended). */
  died: number
  polity: number
  /** Ruling house (History.dynasties), -1 for an elected head: a league's, a republic's or free city's (for a term), or a theocracy's (for life; governments). */
  dynasty: number
  how: AccessionHow
  end: ReignEnd
  /** Law of succession of the polity's ruling people at the accession. */
  law: SuccessionLaw
  /** Previous reign of the same polity, -1 for its first. */
  predecessor: number
  /** The person: the id of this person's first reign (itself, unless it took a second throne in a union). */
  person: number
  /** Parent's reign if the ruler was a child of a ruler of the house, else -1. */
  parent: number
  /** Traits, as fed to the simulation: ability ~0.5..1.5 (scales the realm's power and how weak rule invites overthrow; 1 average), warlike, piety and tolerance 0..1. */
  ability: number
  warlike: number
  piety: number
  tolerance: number
  /** Faith at the accession (History.faiths), -1 when religion is off. Conversions are RulerConverted events. */
  faith: number
}

/** A ruling house. */
export interface Dynasty {
  /** Index into History.dynasties. */
  id: number
  /** House name in the language of its first capital (the UI says "House of Mera"). */
  name: string
  /** First ruler of the house (History.rulers). */
  founder: number
  founded: number
  /** Year it lost its last throne, -1 while it reigns somewhere at the end of the run. */
  ended: number
  /** Polity it first ruled. */
  home: number
  people: number
}

/** Marriage ties between the ruling houses of two polities, struct-of-arrays in order of making. */
export interface Marriages {
  count: number
  /** Polity ids, a < b. */
  a: Int16Array
  b: Int16Array
  /** Houses ruling a and b at the marriage. */
  dynastyA: Int32Array
  dynastyB: Int32Array
  year: Int16Array
  /** Year the tie lapsed (a house lost its throne, war, or a generation passed), -1 while in force at the end. */
  endYear: Int16Array
}

export const UnionEnd = { Ongoing: 0, Merged: 1, Split: 2, Ended: 3 } as const
export type UnionEnd = (typeof UnionEnd)[keyof typeof UnionEnd]

/**
 * Personal unions, struct-of-arrays in order of forming: the junior realm is bound to the senior's ruler (as a vassal in
 * History.bonds) until it merges into the senior, splits away at a contested succession or a revolt, or a realm ends.
 */
export interface Unions {
  count: number
  senior: Int16Array
  junior: Int16Array
  /** The reign (in the junior) that began the union. */
  ruler: Int32Array
  startYear: Int16Array
  /** -1 while ongoing at the end of the run. */
  endYear: Int16Array
  end: Uint8Array
}

// ---------------------------------------------------------------------------
// religion: traditional and universal faiths.

export const FaithKind = { Traditional: 0, Universal: 1 } as const
export type FaithKind = (typeof FaithKind)[keyof typeof FaithKind]

export interface Faith {
  /** Index into History.faiths; the first peoples.length are the peoples' traditional faiths (id = people id). */
  id: number
  /** Proper name in the language of its people or its founding town (the UI says "the Ashai faith"). */
  name: string
  kind: FaithKind
  /** Faith it split from (a schism), -1. Always lower than id. */
  parent: number
  /** People it arose among. */
  people: number
  /** Settlement where it was founded (a traditional faith: the people's founder); -1 never. */
  foundedAt: number
  foundedYear: number
  /** Its holy city (universal faiths: where it was founded, or a schism's seat), -1 for a traditional faith. */
  holyCity: number
  /** Traits 0..1: zeal (how fast it spreads and how intolerant its states are), organisation (a church allied to rulers; missionaries' reach), appeal (0 the countryside, 1 the towns). */
  zeal: number
  organisation: number
  appeal: number
  /** Year it lost its last followers, -1. */
  endedYear: number
}

// ---------------------------------------------------------------------------
// goods: worked goods, specialities, state secrets and long-distance trade.

/** The classes whose prices History.priceIndex records, in its order (Luxury, Stimulant, Metalware, Finery, Treasure). */
export const PRICE_INDEX_GOODS = [7, 8, 9, 10, 11] as const

export const VarietyKind = { Common: 0, Crop: 1, Deposit: 2, Tradition: 3, Wild: 4 } as const
export type VarietyKind = (typeof VarietyKind)[keyof typeof VarietyKind]

/** A named kind of goods within a class: what a flow says about where it was grown, dug or made ("Kepian silk"). */
export interface Variety {
  /** Index into History.varieties; 0 is the Common (unnamed) variety of every class. */
  id: number
  good: Good
  kind: VarietyKind
  /** Species id (Crop), Deposit id (Deposit), Tradition id (Tradition), or -1. */
  source: number
  /** Grower or maker people, or -1 (Common). */
  people: number
  /** Name root from the world's languages (a people's or a settlement's name); the UI adds the English noun ("pepper", "silver", "silk"). */
  maker: string
  /** Worth per unit relative to grain (traditions: at quality 1). */
  value: number
  /** Year it first came to market. */
  firstYear: number
}

export const DepositKind = { Gold: 0, Silver: 1, Gems: 2, Amber: 3, Pearls: 4, Murex: 5, Copper: 6, Tin: 7, FineIron: 8, Kaolin: 9 } as const
export type DepositKind = (typeof DepositKind)[keyof typeof DepositKind]

export interface Deposit {
  /** Index into History.deposits. */
  id: number
  kind: DepositKind
  cell: number
  /** 1 typical; a bonanza about 5. */
  richness: number
  /** Year found, -1 never. */
  foundYear: number
  /** Settlement whose prospectors (or expedition) found it, -1. */
  foundBy: number
  /** Year it gave out, -1 while yielding (or inexhaustible). */
  exhaustedYear: number
  /** Its variety (History.varieties), -1 until found. */
  variety: number
}

export const CraftKind = { Silk: 0, Dyeing: 1, FineCloth: 2, Blades: 3, Bronze: 4, Glass: 5, Porcelain: 6, Paper: 7, Carpets: 8, Shawls: 9, Sugar: 10, Wine: 11 } as const
export type CraftKind = (typeof CraftKind)[keyof typeof CraftKind]

/** A named workshop culture: a craft of one people at its seats, with a quality that grows with practice. */
export interface Tradition {
  /** Index into History.traditions. */
  id: number
  craft: CraftKind
  good: Good
  /** Its variety (History.varieties). */
  variety: number
  people: number
  /** Name root: the seat settlement's name at birth; the UI forms the adjective and adds the craft noun ("Kepian silk"). */
  maker: string
  bornYear: number
  /** First seat. */
  bornAt: number
  /** Year it lost its last seat, -1 if alive at the end. */
  endYear: number
  /** Tradition it was carried from (a daughter), -1. */
  parent: number
  /** Seat history: seats[k] joined at seatFrom[k] and was lost at seatTo[k] (-1 still a seat). */
  seats: number[]
  seatFrom: number[]
  seatTo: number[]
}

/** Industry bits (History.industry). */
export const IndustryBit = {
  Mine: 1, Forge: 2, Weaving: 4, Dyeworks: 8, Bladesmiths: 16, Kilns: 32, Glasshouse: 64, Paper: 128,
  Warehouses: 256, // a mart with merchant stock
  GuildHall: 512, // a renowned tradition's seat
  Mint: 1024, // Treasure of at least twice the desired holding at a capital
  Factory: 2048, // hosts a foreign factory
  Shipyard: 4096, // a lane's home port
} as const
export type IndustryBit = (typeof IndustryBit)[keyof typeof IndustryBit]

export const LegKind = { Relay: 0, Lane: 1 } as const
export type LegKind = (typeof LegKind)[keyof typeof LegKind]

/**
 * Mart-to-mart legs of the long-haul trade, struct-of-arrays, in order of opening. A relay leg follows the
 * settlement links between two marts; a lane is a direct way opened by a trade expedition.
 * Leg k follows cells path[pathOffsets[k] .. pathOffsets[k + 1]) from mart a to mart b.
 * Each entry is one spell of a leg on one way, so a longer history repeats a shorter one exactly: when the merchants
 * between two marts take another way (the towns along it changed), or a relay leg that closed is found again, the
 * old entry closes that year and a new entry for the same pair opens the same year. A lane is one entry all its life.
 */
export interface LongHaul {
  count: number
  /** The two ends; for a lane, a is its home (sponsor) mart. */
  a: Int32Array
  b: Int32Array
  kind: Uint8Array
  openedYear: Int16Array
  /** -1 while open at the end. */
  closedYear: Int16Array
  /** Lanes: the secret id of its chart (History.secrets), else -1. */
  chart: Int16Array
  /** Main class carried a to b and b to a over the entry's spell (for one still open at the end: so far). */
  goodAB: Uint8Array
  goodBA: Uint8Array
  pathOffsets: Uint32Array
  path: Uint32Array
}

export const SecretKind = { Species: 0, Craft: 1, Chart: 2, Arms: 3 } as const
export type SecretKind = (typeof SecretKind)[keyof typeof SecretKind]
export const LeakChannel = { Founded: 0, Contact: 1, Espionage: 2, Defection: 3, Smuggling: 4, Conquest: 5, Rediscovery: 6, Chart: 7 } as const
export type LeakChannel = (typeof LeakChannel)[keyof typeof LeakChannel]

/** A state secret or monopoly: a secret species, a craft secret, or the chart of a lane. */
export interface Secret {
  /** Index into History.secrets. */
  id: number
  kind: SecretKind
  /** Species id (Species), CraftKind (Craft), or LongHaul leg id (Chart). */
  subject: number
  foundYear: number
  /** Settlement where it began (a founding people's founder for a species held from the start). */
  foundAt: number
  /** Year the last holder lost it (a lost art), -1. */
  lostYear: number
}

/** Who held which secret when, struct-of-arrays sorted by from-year: a holding by a people and the polity it was gained in (-1 stateless). */
export interface SecretHolds {
  count: number
  secret: Uint16Array
  people: Int8Array
  polity: Int16Array
  from: Int16Array
  /** -1: still held at the end. */
  to: Int16Array
  /** LeakChannel by which it was gained. */
  channel: Uint8Array
  /** Settlement it came through, -1. */
  via: Int32Array
}

export const PostKind = { Factory: 0, Fort: 1, Station: 2, Camp: 3 } as const
export type PostKind = (typeof PostKind)[keyof typeof PostKind]

/** A trading post: a factory (a quarter in a foreign host town), a fort, a victualling station or a mining camp. */
export interface TradingPost {
  /** Index into History.posts. */
  id: number
  kind: PostKind
  /** Sponsor settlement. */
  owner: number
  /** Factory: the foreign host settlement; else -1. */
  host: number
  /** Fort, Station, Camp: its own settlement; else -1. */
  settlement: number
  /** Lane served (History.longHaul leg), -1 (Camp). */
  leg: number
  foundedYear: number
  /** -1 while it lasts. */
  endedYear: number
}

// ---------------------------------------------------------------------------
// polities: states that form, grow, fight, rebel and split.

export const PolityOrigin = {
  Formed: 0, // a dominant town gathered its neighbours
  Revolt: 1, // provinces that rose and broke away
  Fragment: 2, // a successor of a state that fell apart (its capital taken, or its cohesion gone)
  Colonial: 3, // overseas colonies that broke away
  Partition: 4, // an heir's share of a realm divided at a succession
  CivilWar: 5, // a rival centre that rose against its capital (see EventType.CivilWar)
  League: 6, // a league of trading towns of comparable size that bound together against a threat (the UI calls it a League whatever its size)
  Charter: 7, // governments: a town (and its villages) that bought its liberties from its overlord: a free city, bound to it by a Charter bond
  CityState: 8, // governments: a single city (and its villages) that made itself a state: it rose against its lord, a stateless trading town governed itself, or a holy city's clergy took it (see History.governments)
} as const
export type PolityOrigin = (typeof PolityOrigin)[keyof typeof PolityOrigin]

export const PolityEnd = {
  Alive: 0,
  Conquered: 1, // its capital fell and no rump was left
  Fragmented: 2, // it broke into successor states with no rump left
  Dwindled: 3, // its people died out or left
  Reunified: 4, // taken back by a polity of its own lineage (a civil war lost, or a kindred successor state absorbed it)
  Absorbed: 5, // a small chiefdom that submitted whole to a larger neighbour
} as const
export type PolityEnd = (typeof PolityEnd)[keyof typeof PolityEnd]

/** English qualifier the UI puts before a successor state's inherited name ("North Vashtar", "New Vashtar"). */
export const PolityQualifier = { None: 0, North: 1, South: 2, East: 3, West: 4, New: 5, Upper: 6, Lower: 7, Restored: 8 } as const
export type PolityQualifier = (typeof PolityQualifier)[keyof typeof PolityQualifier]

/** Cause of a revolt (the value of a Revolt event): the largest group of grievances. */
export const RevoltCause = { Peasant: 0, Provincial: 1, Ethnic: 2, Colonial: 3, Religious: 4, Taxes: 5, Burghers: 6, Urban: 7 } as const // (governments: Burghers, the burghers of a rich trading town rose for their liberties; religion: Religious, a ruler of another faith or persecution; finance: Taxes, the heavy taxes of a crown in want; 6 Burghers is city-states'; society: Urban, townsfolk rising over dear bread and low wages)
/** society: phase of a polity's secular cycle (Turchin & Nefedov's four phases; History.socPhase). */
export const SecularPhase = { Expansion: 0, Stagflation: 1, Crisis: 2, Depression: 3 } as const
export type SecularPhase = (typeof SecularPhase)[keyof typeof SecularPhase]
export type RevoltCause = (typeof RevoltCause)[keyof typeof RevoltCause]

/**
 * Tier is derived, not stored (see tierOf in the sim), relative to the world's people W at the same time: the sum of
 * History.population over living settlements that are not outposts. Empire at >= max(20,000, 0.08 W) people, or at
 * >= 20,000 people with >= 25 members where two peoples each hold >= 15% of its people; Kingdom at >= 6 members and
 * >= max(2,000, 0.008 W) people; else Chiefdom. A polity's people and members are those of its living member settlements (History.polity).
 */
export interface Polity {
  /** Index into History.polities; ids in founding order. */
  id: number
  /** Proper name in the founding capital's language (no tier word: the UI adds it, "Kingdom of Vashtar"). */
  name: string
  /** For a successor that kept its parent's name: the English qualifier the UI puts first; else None. */
  qualifier: PolityQualifier
  foundedYear: number
  /** Year it ended, or -1 if it survives to the end of the run. */
  endedYear: number
  origin: PolityOrigin
  endCause: PolityEnd
  /** Polity it split from (successor states), or -1. Always lower than id. */
  parent: number
  /** Ruling people (index into History.peoples): the founding capital's. */
  people: number
  /** Capital history: capitals[k] is the capital from capitalYears[k] on (ascending; capitalYears[0] = foundedYear). */
  capitals: number[]
  capitalYears: number[]
  /** Stable 0..1 hue seed; a successor starts near its parent's hue. */
  hue: number
}

/** Kind of war. (Blockade is not used as a kind: a blockade is an act within a war, see EventType.Blockade.) */
export const WarKind = { Conquest: 0, CivilWar: 1, Blockade: 2 } as const
export type WarKind = (typeof WarKind)[keyof typeof WarKind]
/**
 * Outcome of a war at its end. Tribute: the defender pays tribute to the attacker for a term (History.bonds); Vassalage: one
 * side (usually the defender, or its rump after its capital fell) became the other's vassal (History.bonds says which);
 * Reunified: a civil war won by either side (the loser ended).
 */
export const WarOutcome = { Ongoing: 0, WhitePeace: 1, AttackerGains: 2, DefenderGains: 3, Conquest: 4, Tribute: 5, Vassalage: 6, Reunified: 7 } as const
export type WarOutcome = (typeof WarOutcome)[keyof typeof WarOutcome]

/** Wars, struct-of-arrays, in order of declaration (the war id is the index). */
export interface Wars {
  count: number
  kind: Uint8Array
  /** Polity ids. */
  attacker: Int16Array
  defender: Int16Array
  startYear: Int16Array
  /** -1 while ongoing at the end of the run. */
  endYear: Int16Array
  outcome: Uint8Array
  /** Settlements that changed hands either way, and people killed on both sides (battles, sieges, sacks). */
  taken: Uint16Array
  dead: Float32Array
  /**
   * oaths: the grievance row (History.grievances) that drove the declaration (the strongest of the attacker's grudges against
   * the defender when its grudge g >= OATH.revengeMin), or -1: a revenge war has cause >= 0. All -1 when HistoryOptions.oaths is false.
   */
  cause: Int32Array
  /** oaths: for a war an ally joined in defence of its ally, the war it joined (whose defender it came to help); otherwise -1. */
  ally: Int32Array
  /** arms: the arms race (History.armsRaces) between the two sides open at the declaration, or ended <= ARMS.precede years before it; -1 otherwise. */
  race: Int32Array
  /** beliefs: the attacker's perceived front advantage at the declaration (-1 for a war not bargained); empty when HistoryOptions.beliefs is false. */
  believed: Float32Array
  /** beliefs: the true front advantage at the declaration (-1 likewise); empty when beliefs is off. */
  actual: Float32Array
  /** beliefs: why the bargain failed (WarMotive; Other for a war not bargained); empty when beliefs is off. */
  motive: Uint8Array
}

/** beliefs: why a declared war was not settled by a bargain (Wars.motive). */
export const WarMotive = {
  Other: 0, // not a bargained war (an ally joining, a civil or kin war, a player's order, a broken oath)
  Optimism: 1, // the two disagreed about who would win by more than war would cost them (Blainey; Fearon's private information)
  Preventive: 2, // the attacker feared the other's rising power: no bargain could bind the future (a commitment problem)
  Indivisible: 3, // a holy city was at stake, and no division of it would do
  Discrete: 4, // a bargain existed in principle, but no town or tribute fit it
  Ruler: 5, // the bargain failed for the ruler's will (a warlike king), though a peace was there to be had
  Crisis: 6, // (barriers & cold war) a crisis between rival blocs escalated into war
} as const
export type WarMotive = (typeof WarMotive)[keyof typeof WarMotive]

/** beliefs: how an observer knew of a target (bits; History.beliefSource, BluffExposed extra). */
export const BeliefSource = { Contact: 1, Border: 2, Trade: 4, Marriage: 8, Faith: 16, Envoys: 32, Spies: 64, War: 128 } as const

/** beliefs: one row per ordered pair of polities that ever formed a belief of the other (observer of target), in order of first forming. */
export interface Beliefs {
  count: number
  observer: Int16Array
  target: Int16Array
  /** Year the observer first formed it. */
  from: Int16Array
}

// ---------------------------------------------------------------------------
// battles: the battles of the wars (HistoryOptions.battles; all empty when it or polities is false).

/** Kinds of battle (History.battles). */
export const BattleKind = {
  Field: 0, // two field armies met on the way to the town struck (`target`), at `site` on the approach
  Siege: 1, // an assault on a walled town or a capital (`siegeYear` the year of the siege it was made in, 0 the first)
  Relief: 2, // the besieged side's army struck the besiegers' base or lines (a counterstroke while the enemy besieged one of its towns)
  Naval: 3, // fleets fought for the sea off the enemy's main port (before a blockade); men are ships
  Ambush: 4, // a field battle the defenders opened by surprise from cover (wood, hills, a pass)
  Landing: 5, // an army come over the sea fought at the shore where it landed
} as const
export type BattleKind = (typeof BattleKind)[keyof typeof BattleKind]

/** Weather on the day of a battle. */
export const BattleWeather = { Clear: 0, Rain: 1, Fog: 2, Snow: 3, Heat: 4 } as const
export type BattleWeather = (typeof BattleWeather)[keyof typeof BattleWeather]

/** What a battle's ground and course were (History.battles flags, bits). */
export const BattleFlag = {
  Ford: 1, // the attackers crossed a river at `site`
  Pass: 2, // a narrow way between heights
  Hill: 4, // high ground at `site` (held by the side that chose the ground: GroundByDefender)
  Wood: 8, // in or beside a forest
  Marsh: 16,
  Coast: 32, // on the shore (a landing) or, for a naval battle, within sight of land
  Surprise: 64, // one side was caught unready (SurpriseByDefender says which)
  SurpriseByDefender: 128,
  GroundByDefender: 256, // the defenders chose where to stand
  Flank: 512, // the winners turned a flank (cavalry or a second line)
  Pursuit: 1024, // the beaten side was cut down in flight (rout losses at least BATTLE.pursuitLog of its men)
  Pyrrhic: 2048, // the winners lost at least BATTLE.pyrrhic of their men
  Outnumbered: 4096, // the winners had fewer men
  TargetFell: 8192, // `target` was taken as a result (Conquered follows)
  RulerLed: 16384, // a ruler led one of the armies in person (cmdA or cmdD is a ruler: Commanders.reign >= 0)
  Feint: 32768, // the better-informed side drew the other onto ground of its choosing (beliefs: intelEdge)
} as const

/**
 * What decided a battle (History.battles `course`, two slots): the modifier of the odds that moved them most, and the
 * largest terrain or weather term of at least 15% (else the next largest), each with the side it favoured. Recorded only
 * when the battles are not neutral (battles#6); 0 (None) in neutral runs and for naval battles.
 */
export const BattleFactor = {
  None: 0,
  Ground: 1, // the ground (the site's defensibility against the town's: wood, hills, a pass, marsh)
  Ford: 2, // a river crossing the defenders held (the ford bonus)
  Command: 3, // the commanders' skill
  Supply: 4, // food: the marching side's stores against the defenders' (hunger in the ranks)
  Sickness: 5, // an army stricken by disease
  Surprise: 6, // one side caught unready (in fog, from cover)
  Rain: 7, // rain or snow blunting the stronger side (x -> x^3/4)
  Snow: 8, // the attackers in the snow
  Heat: 9, // the attackers in the desert heat
  Morale: 10, // the breaking points (cohesion, zeal, a famous captain, exhaustion)
  Height: 11, // the higher ground (battle terms: height)
  Winter: 12, // a winter campaign (battle terms: season)
} as const
export type BattleFactor = (typeof BattleFactor)[keyof typeof BattleFactor]

/**
 * History.battles `course` (Uint16; BattleFlag is full): bits 0-3 the first deciding factor (BattleFactor), bit 4 it
 * favoured the defenders, bits 5-8 the second, bit 9 it favoured the defenders; then the course of the day (battle terms,
 * battles-fiction §3.1.2 `course`): Winter (fought in the winter months: season), Mud (the field was mud after rain: the
 * battle slowed, the pursuit bogged down), Frozen (the river froze: the crossing gave the defenders nothing). Bits 13-15 spare.
 */
export const BattleCourse = { Factor: 15, DefFavoured: 16, Factor2Shift: 5, DefFavoured2: 512, Winter: 1024, Mud: 2048, Frozen: 4096 } as const

/**
 * Battles, struct-of-arrays in the order they were fought (the battle id is the index). Every contest of a war-year is
 * one battle: the attacker's strike on its best front, the defender's counterstroke. The battle's attacker is the side
 * that struck (for a counterstroke the war's defender: `counter` 1). The armies' figures are men under arms; `lossA` and
 * `lossD` are their casualties (killed, wounded, taken and scattered) from the Lanchester solution (`ratio`, `breakA`,
 * `breakD`), while `dead` is the people the front towns lost, counted in Wars.dead (the chronicler's casualties are not
 * the realm's dead).
 */
export interface Battles {
  count: number
  /** History.wars id, and the year. */
  war: Int32Array
  year: Int16Array
  kind: Uint8Array
  counter: Uint8Array
  /** Cell where it was fought; the town struck (Siege: the besieged); where the attackers marched from. */
  site: Int32Array
  target: Int32Array
  from: Int32Array
  /** Polity ids of the battle's attacker and defender. */
  attacker: Int16Array
  defender: Int16Array
  /** History.commanders ids, or -1 (no named commander: a levy, a garrison). */
  cmdA: Int32Array
  cmdD: Int32Array
  menA: Float32Array
  menD: Float32Array
  lossA: Float32Array
  lossD: Float32Array
  dead: Float32Array
  /** 0 the attacker won (the defenders broke), 1 the defender won. */
  winner: Uint8Array
  /** Hours from the first clash to the break (about 0.5 to 14). */
  hours: Float32Array
  weather: Uint8Array
  flags: Uint16Array
  /** Lanchester terms as fought: x' = alpha A0^2 / (beta D0^2) with the day's luck, and the break fractions (strength left when each side would break). */
  ratio: Float32Array
  breakA: Float32Array
  breakD: Float32Array
  siegeYear: Uint8Array
  /** What decided it and the course of the day (BattleCourse bits; 0 when neutral). Absent in histories cached before n5. */
  course: Uint16Array
  /** "the Battle of Vebena Ford", "the Siege of Kubeta", "the Second Battle of Ashtar Field" (names at the battle's year). */
  name: string[]
}

/** How a commander's career ended (History.commanders). */
export const CommanderFate = {
  Serving: 0, // still in command (or in the realm's service) at the end of the run
  Slain: 1, // killed in battle (`fateBattle`)
  Taken: 2, // captured in battle and never heard of in command again
  Dismissed: 3, // relieved after a defeat
  Retired: 4, // old age, death in bed, or (a ruler) the end of his reign
  Seized: 5, // overthrew the ruler and took the throne (History.rulers reign `reignAfter`)
  Rose: 6, // led a rising against the realm (a civil war, Wars id in `fateWar`)
  Turned: 7, // went over to the enemy with the town he held (grudges: a betrayal)
  RealmEnded: 8,
} as const
export type CommanderFate = (typeof CommanderFate)[keyof typeof CommanderFate]

/**
 * Commanders of armies, struct-of-arrays in order of first command. A commander is the realm's ruler leading in person
 * (`reign` >= 0, one row per reign that led) or a general appointed for a war (`reign` -1; `dynasty` >= 0 when a kinsman of
 * the ruling house). `skill` (about 0.6..1.5, mean 1) multiplies his army's effectiveness (Lanchester alpha; recorded only
 * while BATTLE.neutral); `fame` grows with victories (more for a decisive one, against odds, over a famous enemy, a capital
 * taken) and fades slowly; a commander of BATTLE.renown fame is a saga subject (CommanderRenowned).
 */
export interface Commanders {
  count: number
  polity: Int16Array
  people: Int16Array
  reign: Int32Array
  dynasty: Int32Array
  born: Int16Array
  female: Uint8Array
  skill: Float32Array
  firstYear: Int16Array
  lastYear: Int16Array
  battles: Uint16Array
  wins: Uint16Array
  /** Fame at its peak, the year of the peak. */
  fame: Float32Array
  fameYear: Int16Array
  fate: Uint8Array
  fateYear: Int16Array
  /** Battle he fell or was taken in; war he rose in; reign he founded (-1 each when not so). */
  fateBattle: Int32Array
  fateWar: Int32Array
  reignAfter: Int32Array
  /** Personal name (a ruler's: his name as ruler); epithets are the UI's. */
  name: string[]
}

/** Kinds of bond between two polities (History.bonds). */
export const BondKind = {
  Vassal: 0, // `a` is the vassal of overlord `b`: it keeps its own government, pays part of its revenue, never fights `b`
  Tribute: 1, // `a` pays tribute to `b` for a term of years after a lost war
  Alliance: 2, // `a` and `b` are allies against a common rival (they may come to each other's defence)
  Charter: 3, // governments: `a` is a free city chartered by its overlord `b`: it governs itself, pays a yearly due, owes no levy and never fights `b`; it is Freed when it stops paying, Absorbed when `b` revokes the charter
} as const
export type BondKind = (typeof BondKind)[keyof typeof BondKind]
/** How a bond ended. */
export const BondEnd = {
  Ongoing: 0,
  Freed: 1, // the vassal or tributary threw it off
  Absorbed: 2, // the vassal was absorbed into its overlord (PolityEnded with PolityEnd.Absorbed)
  Lapsed: 3, // the tribute's term ran out, or the common threat faded, or the allies fell out (with oaths on, allies who fight each other end Betrayed instead)
  Ended: 4, // one of the two polities ended, or the vassal passed to its overlord's overlord
  Betrayed: 5, // oaths: one ally broke faith: made a separate peace with the common enemy, turned on its ally, or attacked it (EventType.Betrayal / OathBroken extra 1); bA or bB, the one whose capital is the event's `settlement`, is the betrayer
  Renounced: 6, // seat: renounced by order (OrderKind.Repudiate; EventType.BondRenounced): bA or bB, the one whose capital is the event's `settlement`, renounced it
} as const
export type BondEnd = (typeof BondEnd)[keyof typeof BondEnd]

/** families: how a merchant family began (History.families.cause, the `extra` of FamilyFounded). */
export const FamilyCause = {
  Capital: 0, // a trader's fortune at a town with merchant capital (a mart, or a town its legs or flight made rich)
  Venture: 1, // a trade expedition that opened a lane
  Split: 2, // a cadet line took a branch as its home at a succession (it keeps the parent's surname: "the Veckin of Osk")
} as const
export type FamilyCause = (typeof FamilyCause)[keyof typeof FamilyCause]
/** families: how a family ended (History.families.end). */
export const FamilyEnd = { Alive: 0, Bankrupt: 1, Faded: 2, NoHeir: 3, TownLost: 4 } as const
export type FamilyEnd = (typeof FamilyEnd)[keyof typeof FamilyEnd]
/** families: what ruined a bankrupt family (History.families.ruin; 0 unless Bankrupt). */
export const FamilyRuin = { None: 0, Fleet: 1, Venture: 2, Default: 3, War: 4, Plague: 5 } as const
export type FamilyRuin = (typeof FamilyRuin)[keyof typeof FamilyRuin]
/** families: a seat is the family's home or a factor's house (branch) (MASTER-PLAN R4: not seat-mode's SeatKind). */
export const FamilySeatKind = { Home: 0, Branch: 1 } as const
export type FamilySeatKind = (typeof FamilySeatKind)[keyof typeof FamilySeatKind]
/** families: how a seat opened (founded with the family, at the far end of a lane it runs, a factory post, a relay partner, a home move, a cadet split). */
export const FamilySeatOpen = { Founded: 0, Lane: 1, Factory: 2, Relay: 3, Moved: 4, Split: 5 } as const
export type FamilySeatOpen = (typeof FamilySeatOpen)[keyof typeof FamilySeatOpen]
/** families: how a seat closed (riots and migration read Expelled = 4). */
export const FamilySeatClose = { Open: 0, Withdrawn: 1, Bankrupt: 2, Seized: 3, Expelled: 4, Sacked: 5, TownLost: 6, Ended: 7 } as const
export type FamilySeatClose = (typeof FamilySeatClose)[keyof typeof FamilySeatClose]
/** families: how a head came to lead the family. */
export const HeadHow = { Founder: 0, Son: 1, Brother: 2, Nephew: 3, Widow: 4, SonInLaw: 5 } as const
export type HeadHow = (typeof HeadHow)[keyof typeof HeadHow]
/** families: why a family moved its home. */
export const FamilyMoveCause = { Bypassed: 0, TownLost: 1, Entrepot: 2 } as const
export type FamilyMoveCause = (typeof FamilyMoveCause)[keyof typeof FamilyMoveCause]


// ---------------------------------------------------------------------------
// governments: forms of government and city-states (all empty when HistoryOptions.governments or polities is false).

/** Form of government of a polity (History.governments: it may change over the polity's life). */
export const Government = {
  Monarchy: 0, // a hereditary ruler and court (king, chief, emperor): the ruling house of History.rulers
  Republic: 1, // a merchant republic: a council of the great houses rules and elects a head for a term (no house; History.rulers.dynasty -1)
  FreeCity: 2, // a self-governing city under a nominal overlord (History.bonds kind Charter): its own council and elected head, a yearly due, no levy
  Signoria: 3, // a republic taken by a strongman or a family, who rule through its old council and pass it to their heirs (a house again)
  Theocracy: 4, // ruled by the clergy of a faith from its holy city: a head chosen for life by the priests (no house)
  Confederation: 5, // a confederation of herding chiefs who choose a paramount chief from among their houses (elective among houses)
  League: 6, // a league of trading towns (PolityOrigin.League): its diet elects a head for a term
} as const
export type Government = (typeof Government)[keyof typeof Government]

/** Why a polity's form of government became what it is (History.governments.cause). */
export const GovernmentCause = {
  Founded: 0, // the form it was founded with (a new state's first row)
  Charter: 1, // a town bought its liberties from its overlord (EventType.CharterBought): a free city
  Rising: 2, // the burghers rose against their lord and won (EventType.CommuneProclaimed, extra 0)
  Free: 3, // a stateless trading town constituted itself (CommuneProclaimed, extra 1)
  Freed: 4, // a free city stopped paying its due to its overlord (CommuneProclaimed, extra 2; its Charter bond ends Freed)
  Council: 5, // the great houses abolished an extinct or fallen throne, or a league shrank to its head town (CommuneProclaimed, extra 3)
  Restored: 6, // a signoria's lords were driven out and the republic restored (CommuneProclaimed, extra 4)
  Strongman: 7, // a war captain or a demagogue made himself lord of a republic (EventType.SignoriaSeized, extra 0 / 2)
  Family: 8, // the leading merchant family made itself master of a republic (SignoriaSeized, extra 1)
  Crowned: 9, // a signoria's lords took a crown, or a confederation's khans became kings (EventType.GovernmentChanged)
  Clergy: 10, // the clergy of a holy city took its rule (EventType.TheocracyProclaimed)
  Secularised: 11, // the clergy lost the rule (the holy city's faith gone or the city of another faith now) (GovernmentChanged)
  Settled: 12, // a confederation of herders settled into a kingdom (GovernmentChanged)
} as const
export type GovernmentCause = (typeof GovernmentCause)[keyof typeof GovernmentCause]

/**
 * governments: the form of government of every polity over time, struct-of-arrays in order of change (a polity's founding
 * row first: every polity has one when the system is on). The form of polity p at year y is that of the last of its rows
 * with year <= y (governmentIds[governmentOffsets[p] .. governmentOffsets[p + 1]), in year order). A change and the
 * founding in one year: the later row wins.
 */
export interface Governments {
  count: number
  polity: Int16Array
  year: Int16Array
  /** Government. */
  form: Uint8Array
  /** GovernmentCause. */
  cause: Uint8Array
  /** The reign (History.rulers) that began with the change (a new elected head or lord), -1 if none (rulers off, or the head stayed). */
  ruler: Int32Array
  /** The settlement whose story it is (the capital, the town that rose or bought its charter). */
  settlement: Int32Array
  /** The merchant family (History.families) the head or lord came from (the capital's leading family; a Family signoria's house), -1 none or families off. */
  family: Int32Array
}

/**
 * families: named merchant families, struct-of-arrays in order of founding (row = family id; prefix-stable: a longer run repeats a
 * shorter one's rows, except the ended / end / ruin / peak fields set later and the open rows' To columns). A family owns shares of
 * its towns' merchant capital (History.merchantWealth): its capital at a town at a snapshot is in seatSnap*, and never exceeds that
 * town's merchant capital.
 */
export interface MerchantFamilies {
  count: number
  /** Surname in the language of its first home (the UI says "House Veckin", a cadet line "the Veckin of Osk"); unique among families and ruling houses (a cadet keeps its parent's). */
  name: string[]
  founded: Int16Array
  /** Year it ended, -1 while it trades at the end of the run. */
  ended: Int16Array
  end: Uint8Array // FamilyEnd
  ruin: Uint8Array // FamilyRuin
  cause: Uint8Array // FamilyCause
  firstHome: Int32Array
  /** Parent family (a cadet line split off at a succession), -1. */
  parent: Int32Array
  people: Int16Array
  /** Largest capital it held at a snapshot, and the snapshot's year (-1 none). */
  peakCapital: Float32Array
  peakYear: Int16Array
  // Seats: a home or a factor at a town, in order of opening. A family's home at year y is its Home seat open at y (moves close one and open another).
  seatCount: number
  seatFamily: Int32Array
  seatTown: Int32Array
  seatKind: Uint8Array // FamilySeatKind
  seatFrom: Int16Array
  /** -1 while open at the end. */
  seatTo: Int16Array
  seatOpen: Uint8Array // FamilySeatOpen
  seatClose: Uint8Array // FamilySeatClose
  /** Lane it serves (History.longHaul record), -1; factory post (History.posts), -1. */
  seatLeg: Int32Array
  seatPost: Int32Array
  // Heads, in order of accession (head id = index); a family's heads are consecutive in time, not in id.
  headCount: number
  headFamily: Int32Array
  /** Personal name in the family's language (the UI adds the surname: "Taro Veckin"). */
  headName: string[]
  headFemale: Uint8Array
  headBorn: Int16Array
  headFrom: Int16Array
  /** -1 while head at the end. */
  headTo: Int16Array
  /** Year of death (-1 alive at the end, or still living after the family ended). */
  headDied: Int16Array
  how: Uint8Array // HeadHow
  /** Ability 0.5..1.6, x100 (100 average). */
  headAbility: Uint8Array
  // Lanes operated: family laneFamily ran the lane (History.longHaul record) laneLeg from laneFrom to laneTo (-1 still).
  laneCount: number
  laneFamily: Int32Array
  laneLeg: Int32Array
  laneFrom: Int16Array
  laneTo: Int16Array
  // Marriages into ruling houses (History.dynasties), in order of making.
  marriageCount: number
  marriageFamily: Int32Array
  marriageDynasty: Int32Array
  marriagePolity: Int16Array
  /** The reign (History.rulers) at the marriage; 1 when a daughter of the family married into the house, 0 a son wed one of its women. */
  marriageRuler: Int32Array
  marriageDaughter: Uint8Array
  marriageYear: Int16Array
  /** Year the tie lapsed, -1 in force at the end. */
  marriageEnd: Int16Array
  // Backing of sides in civil wars.
  backCount: number
  backFamily: Int32Array
  backWar: Int32Array
  /** 0 the crown, 1 the pretender; outcome 0 ongoing, 1 won, 2 lost; stake: capital put in. */
  backSide: Uint8Array
  backOutcome: Uint8Array
  backStake: Float32Array
  // Patronage of landmarks (History.landmarks rows).
  patronCount: number
  patronFamily: Int32Array
  patronLandmark: Int32Array
  patronYear: Int16Array
  // Capital per population snapshot, sparse: snapshot q holds families famSnapFamily[famSnapOffsets[q] .. famSnapOffsets[q+1]) (alive, ascending) with famSnapCapital.
  famSnapOffsets: Uint32Array
  famSnapFamily: Int32Array
  famSnapCapital: Float32Array
  // The same per open seat (the city-states' "wealth of each family in this city").
  seatSnapOffsets: Uint32Array
  seatSnapSeat: Int32Array
  seatSnapCapital: Float32Array
}

/** finance: who lent (History.loans.lenderKind): a town's merchant pool (lender = settlement); a merchant family (lender = family id); a town's own wealth when goods are off (lender = settlement). */
export const LenderKind = { Pool: 0, Family: 1, Town: 2 } as const
export type LenderKind = (typeof LenderKind)[keyof typeof LenderKind]
/**
 * finance: how a loan account ended. Defaulted: written to nothing at defaults (an account written down only in part stays open,
 * its `lost` counting it); Lost: the crown ended; LenderGone: the lender's seat abandoned (the crown kept the money); Seized: the
 * crown took the lender's seat; Assumed: the realm was absorbed or reunified and its debts passed to the absorber (a new account
 * there); Charter: cancelled in exchange for a town's charter (city-states).
 */
export const LoanEnd = { Ongoing: 0, Repaid: 1, Defaulted: 2, Repudiated: 3, Lost: 4, LenderGone: 5, Seized: 6, Assumed: 7, Charter: 8 } as const
export type LoanEnd = (typeof LoanEnd)[keyof typeof LoanEnd]

/** finance: crown loan accounts, struct-of-arrays in order of opening: one account per borrower and lender, opened at its first loan, closed when repaid or ended (a later loan from the same lender opens a new account). */
export interface Loans {
  count: number
  /** Borrowing polity; lender kind (LenderKind) and id; the lender's seat (settlement) when the account opened. */
  polity: Int16Array
  lenderKind: Uint8Array
  lender: Int32Array
  seat: Int32Array
  startYear: Int16Array
  /** -1 while open at the end of the run. */
  endYear: Int16Array
  end: Uint8Array
  /** Largest principal outstanding; rate at opening and the highest it reached (a year's share); interest paid; principal written off. */
  peak: Float32Array
  rate0: Float32Array
  rateMax: Float32Array
  paid: Float32Array
  lost: Float32Array
}

/** oaths: kinds of grievance one polity holds against another (History.grievances). Other plans add theirs (MASTER-PLAN §3.2). */
export const GrievanceKind = {
  TruceBroken: 0, // the offender declared war while a truce sworn after a war between them held (EventType.OathBroken, extra 0)
  AllyBetrayed: 1, // the offender, its ally, made a separate peace with their common enemy or turned on it (EventType.Betrayal), or attacked it while allied (OathBroken, extra 1)
  BondThrownOff: 2, // the offender, its vassal or tributary, threw off the bond (BecameVassal, extra 1); the overlord holds it
  TownConquered: 3, // the offender took `settlement` from it in war (the Conquered towns of one war merged: `towns`)
  TownSacked: 4, // the offender sacked `settlement` (Sacked)
  HolyCityTaken: 5, // the offender, of another faith, took the holy city `settlement` (HolyCityFell); the polity that lost it holds it
  CapitalTaken: 6, // the offender took its capital `settlement`
  CrownDefault: 7, // (state-finances) the offender's crown defaulted on a loan from a lender seated in the wronged polity
  TownCeded: 8, // (beliefs) the offender took `settlement` from the wronged under threat, without war (EventType.Coerced; the towns of one crisis merged: `towns`)
  SpyCaught: 9, // (beliefs) the wronged caught the offender's spies (EventType.SpyCaught)
  ClaimForged: 10, // (beliefs) the offender's forged claim on the wronged was exposed (EventType.ClaimExposed)
  GeneralTurned: 11, // (battles) a famous general of the wronged polity went over to the offender with the town `settlement` he held (GeneralTurned 226)
  // 12-16 reserved (MASTER-PLAN §3.2: riots, court, MIR, FP, infrastructure)
  ProxyAid: 17, // (cold wars) the offender, a cold-war principal, backed the wronged's enemy in a war it did not fight (EventType.ProxyWar)
} as const
export type GrievanceKind = (typeof GrievanceKind)[keyof typeof GrievanceKind]

/**
 * oaths: grievances between polities, struct-of-arrays in order of recording (one row per wrong; the towns one war took from one
 * polity merge into one TownConquered row). A grievance's weight w0 fades with age: w(y) = w0 * 0.5^((y - year) / halfLife),
 * applied every POLITY.slowStep years, and it is put aside (endYear) once w < OATH.forget, when it is avenged (the town taken
 * back, or a won revenge war: the weight * OATH.avenged), or when either polity ends. A successor state inherits its parent's
 * grievances at OATH.inherit of their weight (`heir` is the row it came from); a realm that absorbs or reunifies another takes up
 * its quarrels. The grudge of p against q is G = the sum of w over p's open rows against q; it raises rivalry and p's will to
 * make war on q (g = G / (G + OATH.half)).
 */
export interface Grievances {
  count: number
  kind: Uint8Array
  /** Polity ids: the wronged and the offender. */
  wronged: Int16Array
  offender: Int16Array
  year: Int16Array
  /** Weight when recorded (after merging), and the year it was put aside (-1: still held at the end of the run). */
  weight: Float32Array
  endYear: Int16Array
  /** 0 faded, 1 avenged, 2 a polity ended, 3 passed to an heir (see `heir`), 4 the two became one realm. */
  endCause: Uint8Array
  /** Settlement it concerns (town, capital, holy city) or -1; the war it came from (History.wars) or -1; towns merged. */
  settlement: Int32Array
  war: Int32Array
  towns: Uint16Array
  /** Row this one was inherited from, or -1. */
  heir: Int32Array
  /** OATH.halfLife (years), for readers that compute w(y). */
  halfLife: number
}

/** arms: how an arms race between two polities ended (History.armsRaces). */
export const ArmsRaceEnd = {
  Ongoing: 0,
  War: 1, // one declared war on the other
  Eased: 2, // both fell back below ARMS.raceOff
  Ended: 3, // a polity ended or became the other's vassal
} as const
export type ArmsRaceEnd = (typeof ArmsRaceEnd)[keyof typeof ArmsRaceEnd]

/**
 * arms: arms races, struct-of-arrays in order of starting. Each pair of rival polities carries two arms levels x (a against b)
 * and y (b against a) in 0..1, a share of the realm's strength kept under arms against that rival, moving by Richardson's
 * equations every POLITY.slowStep years: dx/dt = k_a * y - a_a * x + g_a (reaction, fatigue, grievance). A race is open from
 * the step min(x, y) >= ARMS.raceOn with both rising until min(x, y) < ARMS.raceOff, war, or the end of either. `level` holds
 * min(x, y) at each slow step of the race, 0..255 for 0..1 (level[levelOff[i] .. levelOff[i + 1])).
 */
export interface ArmsRaces {
  count: number
  /** Polity ids. */
  a: Int16Array
  b: Int16Array
  start: Int16Array
  /** Year it ended (-1 open at the end of the run), how (ArmsRaceEnd), and the war it ended in (History.wars) or -1. */
  end: Int16Array
  endCause: Uint8Array
  war: Int32Array
  /** Peak of min(x, y), 0..255, and its year. */
  peak: Uint8Array
  peakYear: Int16Array
  levelOff: Int32Array
  level: Uint8Array
}

/** cold wars: how a cold war ended (History.coldWars.endCause; barriers-coldwar §3.5). */
export const ColdWarEnd = {
  Thaw: 0, // rivalry fell below CW.thawR for CW.thawYears
  HotWar: 1, // a war was declared between the two
  Collapsed: 2, // one side fell into crisis (default, civil war, a contested throne) and lost a third of its strength, or broke apart
  Eclipsed: 3, // the balance tipped: the weaker had under CW.eclipse of the stronger's strength for CW.eclipseYears
  Ended: 4, // a side ended otherwise (conquered, dwindled, absorbed)
} as const
export type ColdWarEnd = (typeof ColdWarEnd)[keyof typeof ColdWarEnd]
/** cold wars: how a crisis between the principals was resolved (EventType.Crisis extra). */
export const CrisisOutcome = { BackdownA: 0, BackdownB: 1, Compromise: 2, Escalated: 3 } as const
export type CrisisOutcome = (typeof CrisisOutcome)[keyof typeof CrisisOutcome]

/**
 * cold wars (barriers-coldwar §3): cold wars between two great rivals deterred from fighting each other, struct-of-arrays in
 * order of starting. A cold war is open from ColdWarBegan until ColdWarEnded; meanwhile its principals back sides in other
 * wars (proxies), court and lose clients, spy, and face crises. `kappa` is its intensity at each slow step, 0..255 for 0..1
 * (kappa[kappaOff[i] .. kappaOff[i + 1])). Empty when HistoryOptions.coldWars is false.
 */
export interface ColdWars {
  count: number
  /** Polity ids of the principals. */
  a: Int16Array
  b: Int16Array
  start: Int16Array
  /** Year it ended (-1 open at the end of the run), how (ColdWarEnd), and the war that ended it (HotWar) or -1. */
  end: Int16Array
  endCause: Uint8Array
  war: Int32Array
  /** 1 when ideological (Phase 4; always 0 for now). */
  ideological: Uint8Array
  /** Proxy interventions, crises, client defections. */
  proxies: Uint16Array
  crises: Uint16Array
  defections: Uint16Array
  /** Peak intensity (0..255) and its year. */
  peak: Uint8Array
  peakYear: Int16Array
  kappaOff: Int32Array
  kappa: Uint8Array
}

/**
 * Embargoes short of war, struct-of-arrays in order of declaration (one entry per embargo; the same pair may embargo
 * each other again later as a new entry). An embargo is declared when the rivalry of two polities reaches
 * TARIFF.embargoOn (never between a vassal or tributary and its overlord) and lifted when it falls below embargoOff;
 * while it is in force all goods but food stop between the two states' members (only contraband moves; food pays a
 * duty), and if they go to war all trade stops anyway. It also ends when either polity ends (endYear its end year).
 */
export interface Embargoes {
  count: number
  /** Polity ids, a < b. */
  a: Int16Array
  b: Int16Array
  startYear: Int16Array
  /** -1 while still in force at the end of the run. */
  endYear: Int16Array
}

/**
 * Bonds between polities, struct-of-arrays in order of making (one entry per bond; the same pair may bond again
 * later as a new entry). At any year a polity is the `a` of at most one ongoing Vassal or Tribute bond, and an
 * overlord is never itself a vassal (no chains), so "overlord of p at year y" is unique.
 */
export interface Bonds {
  count: number
  kind: Uint8Array
  /** Polity ids (see BondKind). */
  a: Int16Array
  b: Int16Array
  startYear: Int16Array
  /** -1 while ongoing at the end of the run. */
  endYear: Int16Array
  end: Uint8Array
  /** beliefs: the year each bond became known to other polities (startYear for a public bond; -1 never revealed); empty when HistoryOptions.beliefs is false. */
  known: Int16Array
}

/** Small raids per decade and settlement raided, struct-of-arrays, sorted by decade then settlement (only nonzero entries). */
export interface RaidSummary {
  count: number
  /** Decade d covers years [10 d, 10 d + 10). */
  decade: Int16Array
  settlement: Int32Array
  /** Raids that struck it in that decade, and the wealth they took. */
  raids: Uint16Array
  wealth: Float32Array
}

export const Good = {
  Grain: 0,
  Fish: 1,
  Livestock: 2,
  Timber: 3,
  Ore: 4,
  Salt: 5,
  Cloth: 6, // from fibre plants and wool
  Luxury: 7, // spices, dyes, wine, sugar and the like (goods: raw luxuries only: spices, sugar, wine, incense, dyes, furs, amber, pearls)
  Stimulant: 8, // habit-forming plants: mild ones such as tea, and harmful ones such as tobacco and poppy
  // goods: worked goods and treasure (empty when HistoryOptions.goods is false).
  Metalware: 9, // tools and arms
  Finery: 10, // fine textiles: silk, dyed and fine cloth
  Treasure: 11, // gold, silver, gems
  Wares: 12, // glass, porcelain, paper, lacquer (later versions; empty until then)
} as const
export type Good = (typeof Good)[keyof typeof Good]
export const GOOD_COUNT = 13

/**
 * Trade routes between pairs of settlements, struct-of-arrays, in order of first opening.
 * A route keeps its id for the whole run; a pair that stops and later resumes trading reuses its route.
 * Route r opened along cells path[pathOffsets[r] .. pathOffsets[r + 1]) from settlement a to settlement b. With polities a route
 * may later change its way round danger, and back once the danger falls (the re-paths below, in order); routePathAt gives its
 * way at a year (draw that; `path` alone is the way it opened along).
 */
export interface TradeRoutes {
  count: number
  /** The two ends, lower settlement id first. */
  a: Int32Array
  b: Int32Array
  /** Year the route first opened. */
  openedYear: Float32Array
  /** Main good carried from a to b, and from b to a (see `Good`). */
  goodAB: Uint8Array
  goodBA: Uint8Array
  pathOffsets: Uint32Array
  /** Cell ids along each route, a's cell first, b's cell last; consecutive cells are neighbours. May include water cells. */
  path: Uint32Array
  /**
   * polities: re-paths, in order of year (a longer run repeats a shorter one's rows): from year repathYear[k] (inclusive) route
   * repathRoute[k] follows cells repathPath[repathOffsets[k] .. repathOffsets[k + 1]) (a's cell first, b's last, neighbours),
   * until its next re-path. A route goes round newly dangerous ground (war, raids, a war front, pirates' waters, bandits) and
   * back to the way it opened along when the danger there falls. Empty (repathCount 0) without polities. Its traffic in
   * tradeVolume and History.road follows the way it had at the time.
   */
  repathCount: number
  repathRoute: Int32Array
  repathYear: Int16Array
  repathOffsets: Uint32Array
  repathPath: Uint32Array
}

/**
 * The way trade route r followed at `year`: its cells are arr[from .. to). The way it opened along (`path`) unless it had
 * re-pathed by then (its last re-path at or before `year`). For a trade snapshot q pass year q * tradeInterval.
 */
export function routePathAt(t: TradeRoutes, r: number, year: number): { arr: Uint32Array; from: number; to: number } {
  let k = -1
  const n = t.repathCount ?? 0
  for (let i = 0; i < n && t.repathYear[i] <= year; i++) if (t.repathRoute[i] === r) k = i
  if (k < 0) return { arr: t.path, from: t.pathOffsets[r], to: t.pathOffsets[r + 1] }
  return { arr: t.repathPath, from: t.repathOffsets[k], to: t.repathOffsets[k + 1] }
}

/** Population at which a settlement counts as a town, and as a city. */
export const TOWN_POPULATION = 3000
export const CITY_POPULATION = 10000

export const StructureType = {
  Port: 0, // on a coastal settlement's cell; makes sea travel and fishing easier
  Dam: 1, // on a river cell near its settlement; irrigates land downstream and forms a reservoir
  Walls: 2, // polities: town walls on the settlement's cell, raised against danger; a town may have several rings in use (one Structure per ring, oldest first)
  Fort: 3, // polities v2: a fort on a land cell of the settlement's territory at a hostile border (a pass or the most defensible border cell); one in use per settlement
  Mine: 4, // goods: on a worked deposit's cell; `settlement` works it; lost when the deposit gives out or its settlement is abandoned
  Factory: 5, // goods: a foreign merchants' quarter on its host's cell; `settlement` is the sponsor (see TradingPost)
} as const
export type StructureType = (typeof StructureType)[keyof typeof StructureType]

export interface Structure {
  /** Index into History.structures; ids are assigned in building order. */
  id: number
  type: StructureType
  cell: number
  /** Settlement that built it. */
  settlement: number
  builtYear: number
  /** Year it fell out of use (e.g. its settlement was abandoned), or -1 if it lasts to the end of the run. */
  lostYear: number
}

/**
 * A named bundle of switches (src/sim/history/presets.ts; URL `preset=`, link version `v=`): realistic is the default (the
 * merged systems that pass the noise-aware realism ratchet), dramatic every merged system on, off the history before the
 * presets (every post-8cabf09 system off: what a link without `v=` replays).
 */
export type PresetName = 'off' | 'realistic' | 'dramatic'

export interface HistoryOptions {
  /**
   * preset (EVALUATION.md §3 P1; owner decision (b), 2026-11-27): fills the switches this object leaves undefined (explicit
   * values win; expandPreset) and sets the preset's params for the run (DX.feedback; BATTLE_MODE.neutral). Default 'realistic'
   * (PRESET_DEFAULT): grudges (oaths, balance, arms), finance, beliefs and barriers, battles with their modifiers, society and
   * disasters with DX.feedback. 'off' is every post-8cabf09 system off (the G0-off identity; old links, without `v=`, replay
   * with it). 'dramatic' adds families, cold wars with war restraint, and causes.
   */
  preset?: PresetName
  /** realism null ensemble only (realismStats --noise): discard `draws` draws of the migration (or structures) stream at `year`: the same model, another realisation of the trajectory. Default none: no draws. */
  jitter?: { year: number; draws: number; stream?: 'migration' | 'structures' }
  /** Length of the run in years. Default 2000. */
  years?: number
  /** Years between snapshots. Default 5. */
  snapshotInterval?: number
  /** polities: simulate states, war and danger. Default true; false gives the history without them (the new History fields empty). */
  polities?: boolean
  /** goods: simulate worked goods, rare deposits, craft traditions, stocks and merchants, long-haul lanes, trading posts, secrets and smuggling. Default true; false gives the history without them (the goods fields empty). */
  goods?: boolean
  /** disease: simulate epidemics (crowd diseases, plague, camp fever) and place-bound fever. Default true; false gives the history without them (the disease fields empty; first contacts bring the species system's own epidemics). */
  disease?: boolean
  /** rulers: named rulers with traits, ruling houses, successions by law and heirs, marriages and personal unions (needs polities). Default true; false runs the old succession timer and leaves the rulers fields empty. */
  rulers?: boolean
  /** religion: traditional and universal faiths, their spread, conversion of rulers, state churches, schism, persecution and holy war. Default true; false leaves the religion fields empty. */
  religion?: boolean
  /** tourism: simulate scenery, sights, leisure travel and resort towns. Default true; false gives the history without them (the tourism fields empty). */
  tourism?: boolean
  /** renaming: places renamed by history (conquest, cession, new capitals, faith, trade, restoration, revival; History.renamings). Default true; false leaves History.renamings empty. A pure consequence layer: on or off, every other field is the same (events aside, which gain PlaceRenamed). */
  renaming?: boolean
  /**
   * ideas: discrete inventions and practices (History.ideas), conceived by one people where their preconditions are met and carried to
   * others by trade, lanes, migrants, conquest, pilgrims, visitors, marriages and theft; the technology levels follow the ideas a people
   * holds. Default true; false gives the history without them (the ideas fields empty, technology the old smooth curves).
   */
  ideas?: boolean
  /**
   * landmarks: great buildings and houses of worship raised as a consequence of history (History.landmarks), with their states over
   * time (in use, neglected, ruined, restored, converted). Default true; false leaves History.landmarks empty. A pure consequence layer:
   * on or off, every other field is the same (events aside, which gain the landmark events 140-146).
   */
  landmarks?: boolean
  /**
   * orders: the player's nudges, part of the simulation's input like the seed (see Order). Each raises a drive, a weight or a chance
   * for a while from its year; the systems' own rules decide, and an order can fail. Default none: undefined or [] gives exactly the
   * history without orders (History.orders and orderOutcomes absent). Applied in year order (ties in list order); an order changes
   * nothing before its year. encodeOrders / decodeOrders give a compact URL-safe text form.
   */
  orders?: Order[]
  /**
   * cradle wishes: the player plants where civilisations start, part of the input like the seed. cradles[p] is the cell people p
   * is wished to begin on, -1 to let the simulation choose; entries beyond the world's people count (cradleCount) are ignored, and
   * missing ones are -1. The number of peoples never changes. A wish is placed, moved to nearby livable land or rejected
   * (CradleOutcome); the peoples the simulation places keep away from the wished ones. Everything after year 0 follows the rules.
   * Default none: undefined, [] or only -1 give exactly the history without wishes (History.cradleWish etc. absent).
   * encodeCradles / decodeCradles give a URL-safe text form, canonicalCradles the canonical list.
   */
  cradles?: number[]
  /**
   * oaths (grudges-and-oaths; needs polities): grievances between polities that fade over generations and feed rivalry and revenge
   * wars, truces sworn as oaths that may be broken, allies who desert or turn on each other, a name for faithlessness, and the
   * ruler's shadow of the future (old, heirless or embattled rulers keep faith less). Default false; false leaves
   * History.grievances empty, faithless 0 and wars.cause / wars.ally -1, and every other field as without it.
   */
  oaths?: boolean
  /** balance (grudges-and-oaths; needs polities): alliances weighed by threat (power, proximity and intent), coalitions against the hegemon, and weak states that bandwagon. Default false. */
  balance?: boolean
  /**
   * families (merchant-families; needs goods): named houses of trade owning shares of the merchant capital of their towns
   * (History.families), with heads, factors, lanes, marriages into ruling houses, backings of civil wars and patronage. Default false.
   * A pure consequence layer while FAMILY.feedback is false: on or off, every other field is the same (events aside, which gain 161-169).
   */
  families?: boolean
  /**
   * governments (city-states; needs polities; rulers optional): forms of government (History.governments): monarchies, merchant
   * republics, free cities under a nominal overlord, signorie, theocracies, tribal confederations and leagues, with the transitions
   * wealth and force drive (charters bought, burghers' risings, strongmen) and their effects on war, trade, succession and unrest.
   * Default false (GOV_ON); false gives History.governments empty and every other field as without it.
   */
  governments?: boolean
  /** finance (state-finances; needs polities): crown treasuries, borrowing from merchant capital, default and bankruptcy wars. Default false; false leaves the finance fields empty and the history exactly the one without them. */
  finance?: boolean
  /** society (society-secular-cycles; needs polities): classes, wages and rents, elite overproduction and political stress (Ψ) feeding revolts, civil wars and successions. Default false; false leaves the society fields empty and the history exactly the one without them. */
  society?: boolean
  /**
   * beliefs (beliefs-and-deception; needs polities): states judge each other's strength from what they see, trade, marry, spy
   * and fight, and may bluff, ally in secret and misjudge; crises are bargained (towns ceded or tribute agreed without war,
   * or the challenger backs down). Default false; false leaves the belief fields empty and the history exactly the one without them.
   */
  beliefs?: boolean
  /**
   * barriers (barriers-coldwar.md, communication part; needs beliefs): what states learn of each other passes through their
   * tongues (mutual intelligibility of the capitals' languages from the language tree advanced in the run, B-R1; with language
   * off the same people understand each other and others need interpreters) and arrives late with distance (news lag).
   * Default false; false gives the history exactly as without it.
   */
  barriers?: boolean
  /** arms (grudges-and-oaths; needs polities): Richardson arms races between rivals, raising war power and costing wealth. Default false; false leaves History.arms 0, armsRaces empty and wars.race -1. */
  arms?: boolean
  /**
   * coldWars (barriers-coldwar §3, owner grudges; needs polities): two great rivals at parity, long hostile and arming, but
   * deterred from fighting, wage a cold war: proxy aid to sides in others' wars, courting and stealing clients, spies, crises
   * that may escalate, and endings by thaw, hot war, collapse or eclipse. Default false; false gives the history exactly as
   * without it (History.coldWars empty).
   */
  coldWars?: boolean
  /**
   * warRestraint (owner ruling D-CW1; only with coldWars, which it defaults to): great powers' public welfare and the weight of
   * their people's voice restrain their wars on each other (C1 factor 7, clamped to [0.3, 1]; a stylised audience-cost model),
   * unless one holds an ideology of total conquest; mutual restraint slowly calms their rivalry. Default: as coldWars.
   */
  warRestraint?: boolean
  /**
   * disasters: volcanic eruptions and volcanic winters, slow climate epochs (warm ages, little ice ages), megadroughts,
   * earthquakes, tsunamis and great river floods, drawn from the world alone (the same seed has the same shocks, whatever the
   * orders or cradle wishes) and felt through the harvest, deaths and ruin. Default false (DX.enabled); false gives the history
   * without them (the anonymous harvest crises of the weather instead; History.disasters, climate and weatherRegion empty).
   */
  disasters?: boolean
  /**
   * battles: every contest of a war is a recorded battle (History.battles) with its site, armies, commanders, weather and
   * Lanchester resolution, and the commanders of the armies (History.commanders) (needs polities). On in the realistic and
   * dramatic presets (BATTLES_ON, the module default, is false: preset 'off' and old links). BATTLE_MODE.neutral is false on
   * main, so `battles: true` has the modifiers (terrain, weather, supply, surprise, sickness, rout), the escalating toll, war
   * tempo, naval blockades and pretenders; only with BATTLE_MODE.neutral (a test/harness param) are the battles recorded
   * without changing anything else (events aside, which gain 220-227).
   */
  battles?: boolean
  /**
   * language: languages that split with their speakers (overseas settlers, distant regions) and change by regular sound change,
   * lexical replacement and contact (loans, language shift), with exonyms (History.languages, speech, nameForms); names are said
   * as in the year shown. Default false (MASTER-PLAN R32: on only for new worlds, which write lang=1; a link without the flag keeps
   * the names it always had). A pure consequence layer at assembly: on or off, every non-name field is the same (events aside,
   * which gain 250-253); off, the history is exactly the one without it.
   */
  language?: boolean
  /**
   * typology: languages drawn from typological profiles (phoneme inventories, syllable templates, tone, morphology styles) with
   * romanization traditions (Languages.model, typo and ortho; names spelt plain in Settlement.name and the like). Needs
   * `language` (ignored without it). Default false; new worlds write lang=2 (drift + typology) once the owner signs off (D-TS1).
   * A pure consequence layer at assembly like `language`: every non-name field is the same with it on or off; off, the history
   * is exactly the one without it.
   */
  typology?: boolean
  /**
   * causes: record why things happened (the drive behind each war declared and the parts of the rivalry behind it, the parts
   * of each revolt's unrest, the harvest of each weather region and year and the factors of each famine, why each town was
   * abandoned, each chiefdom absorbed and each succession contested) in History.why, for the causal explorer. Recording only:
   * every other field is the same with it on or off (no draws; nothing the simulation reads). Default false.
   */
  causes?: boolean
  /**
   * seat: the player's seat (seat-mode), part of the simulation's input like the seed and the orders (see SeatOptions). Default
   * none: undefined gives exactly the history without a seat (History.seat absent). With a seat and no orders, every field but
   * History.seat and the seat events 270-279 is identical to the run without one: the seat follows history and the watcher that
   * offers decisions reads the state and draws nothing. The player's choices come in as orders (OrderKind.Choice and the kinds of
   * the option chosen). encodeSeat / decodeSeat give the URL form.
   */
  seat?: SeatOptions
  /**
   * absentee (absentee-rulers.md; needs rulers): AI rulers who let the court decide. A child on the throne (the regent's
   * council), a junior realm of a personal union (a viceroy), a ruler on campaign far from home or a captive, an idle ruler (low
   * ability and little warlike), an old one: each feeds the realm's deference (rulers/deference.ts, the seat's "let the court
   * decide"), whose shared effects weaken the throne; past the decline threshold the court governs in his name (CouncilRuled)
   * until the reign ends, the regent hands over or the ruler comes home (RuledInPerson). A court that decides bears the blame
   * for lost wars and defaults (DeferBlamed). The player's own seat realm is left to the player. Default false; false gives
   * the history exactly as without it. No draws (captivity uses hash01).
   */
  absentee?: boolean
}

// ---------------------------------------------------------------------------
// causes: why things happened, recorded for the causal explorer (HistoryOptions.causes; all empty when it is false). Recording
// only: the history is the same with it on or off, but for History.why. Rows refer to History.events by index (stable under
// extension: a longer run's tables begin with the shorter run's).

/**
 * The parts of the rivalry between two polities (WarWhy.parts): each one an accumulator of one term of relations.ts' rule (or of
 * one of the few other writers of rivalry), so that they sum to the rivalry.
 */
export const RivalryPart = {
  Claim: 0, // contested farmland: cells in both states' base catchments (Carneiro's squeeze)
  Dispute: 1, // their claims meeting over unsettled land (BorderDispute)
  Differ: 2, // ruling peoples that differ
  Hunger: 3, // hunger on the border
  RecentWar: 4, // a war between them within RELATION.recentYears
  Trade: 5, // trade between their members (negative: it calms)
  Marriage: 6, // a marriage tie between their houses (negative; rulers)
  Faith: 7, // faiths opposed (positive) or shared (negative), and a schism between their churches (religion)
  Grudge: 8, // grievances (grudges-and-oaths)
  Arms: 9, // an arms race (grudges-and-oaths), if it feeds rivalry
  TradeRival: 10, // trade rivalry between city-states (city-states)
  Bloc: 11, // ideological blocs (modern ideologies)
  Reputation: 12, // reputation for faithlessness (grudges)
  Secession: 13, // a break: a province seceded, a civil war or partition split them, a vassal threw off its overlord
  Alarm: 14, // alarm at the other's attack on a small neighbour (bonds: buffer states)
  ColdWar: 15, // a cold war between them (barriers-coldwar §3): a crisis compromise (negative)
} as const
export type RivalryPart = (typeof RivalryPart)[keyof typeof RivalryPart]
export const RIVALRY_PARTS = 16

/** What else drove a declaration (WarWhy.flags, bits). */
export const WarWhyFlag = {
  Crisis: 1, // the defender was in crisis (a contested succession, a regency, a civil war: WAR.crisisMul)
  Holy: 2, // the religion system's holy-war drive was above 1
  Order: 4, // a player's order urged it (OrderKind.War, or a seat card)
  Warlike: 8, // the ruler's warlike multiplier was above 1.25
  Joined: 16, // an ally or protector came to a defence; WarWhy.parts are then those of its own rivalry with the attacker
  Civil: 32, // a civil war (CivilWar): see History.why.crises for the contested succession behind it
  Bargained: 64, // beliefs: the war followed a failed bargain
  Oath: 128, // grudges: declared against an oath (OathBroken)
} as const

/** Why a settlement was abandoned (CauseRecords.abandons.cause). */
export const AbandonCause = {
  Dwindled: 0, // its people fell below POPULATION.abandonPop (died, or left for other towns: Migration events)
  Outpost: 1, // an expedition base given up (exploration)
  Supply: 2, // a fort or station whose supply failed (goods)
  Resort: 3, // a resort town whose visitors failed for good (tourism)
} as const
export type AbandonCause = (typeof AbandonCause)[keyof typeof AbandonCause]

/** What made a succession contested (CauseRecords.crises.bits). Extinct: the house died out (no heir), the contest a fixed chance. */
export const CrisisBit = { Minor: 1, Woman: 2, Bastard: 4, WeakPredecessor: 8, LowCohesion: 16, ManyPeoples: 32, Law: 64, RivalCentre: 128, Extinct: 256, Deference: 512 } as const // (Deference, absentee: the court had governed in the dead ruler's name)

/** The parts of a settlement's unrest (RevoltWhy), finer than RevoltCause: each one an accumulator of one term of unrest.ts' grievance(). */
export const UnrestPart = {
  Famine: 0, Crowding: 1, BadTax: 2, // Peasant
  Distance: 3, Exhaustion: 4, Crisis: 5, Corruption: 6, // Provincial
  Foreign: 7, Conquest: 8, // Ethnic
  Colony: 9, // Colonial
  Faith: 10, // Religious (religion)
  Taxes: 11, // state-finances
  Burghers: 12, // city-states
  Urban: 13, // society
  // 14-20 riots-uprisings (Tyranny, Conscription, Hunger, Persecution, Usurpation, Ideology, Mutiny), 21 court-politics (Estates)
  Displaced: 22, // future-tech
  Generations: 23, // future politics
  Disaster: 24, // disasters
  Immiseration: 25, Coercion: 26, // society
  Deference: 28, // seat: a realm grown used to being ruled without its ruler (the player's deference; a Provincial term)
  Shock: 27, // a jump not made by grievance: the bitterness left by a crushed revolt, a realm breaking up (UNREST.crushAfter, fragment)
} as const
export type UnrestPart = (typeof UnrestPart)[keyof typeof UnrestPart]
export const UNREST_PARTS = 32
/** The RevoltCause group of each UnrestPart (-1: none; parts of later plans keep -1 until they say). */
export const UNREST_PART_GROUP: readonly number[] = [0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 4]

/**
 * Why each war was declared (one entry per History.wars id). The drive of the declaration roll is the product
 * smoothstep(rivalry) · smoothstep(odds) · crisis · (1 − exhaustion) · mul (polity/war.ts declarations); its numbers at the
 * roll are kept here, with the parts of the rivalry (RivalryPart order, each a signed share of the rivalry, -127..127 for
 * -1..1: parts[w * RIVALRY_PARTS + k]). A war that was not rolled for (an ally joining, a civil war, a war of succession) has
 * odds 0, keeps the rivalry and its parts at its declaration, and says what it was in `flags`.
 */
export interface WarWhy {
  /** Rivalry the roll read (with an order, as the order made it read), 0..255 for 0..2. */
  rivalry: Uint8Array
  parts: Int8Array
  /** Front advantage (attacker projection / defender projection at the front), log-coded: b means 2^((b - 128) / 32); 0 when not rolled. */
  odds: Uint8Array
  /** Attacker's war exhaustion, 0..255 for 0..1. */
  exhaustion: Uint8Array
  /** The C1 multiplier (ruler · holy · order), log-coded like `odds`. */
  mul: Uint8Array
  flags: Uint8Array
  /** The front town of the defender the attacker saw most exposed, -1. */
  front: Int32Array
}

/**
 * Why each Revolt (History.events index `event`) broke out: its seat's unrest at the roll (0..255 for 0..2), the four largest
 * parts of it (UnrestPart part[k * 4 + j] and share[k * 4 + j] 0..255 for 0..1; part 255: none), and the rebels' odds
 * against the capital's support (0..255 for 0..1).
 */
export interface RevoltWhy { count: number; event: Int32Array; unrest: Uint8Array; part: Uint8Array; share: Uint8Array; odds: Uint8Array }

/** What a famine row splits the shortfall into (FamineWhy columns). */
export const FamineFactor = { Harvest: 0, Stored: 1, Ravaged: 2, Crowded: 3, Imports: 4 } as const

/**
 * Why each Famine (History.events index `event`) happened: the region's harvest multiplier (0..255 for 0..1.4), what storage
 * and dams left of it (same scale), the share of the fields ravaged by war or left for danger (0..255 for 0..1), people per
 * food expected at an average harvest (0..255 for 0..2: crowding), the share of the year's usual food imports that did not
 * come (0..255 for 0..1), and the weather region.
 */
export interface FamineWhy { count: number; event: Int32Array; harvest: Uint8Array; stored: Uint8Array; ravaged: Uint8Array; crowded: Uint8Array; imports: Uint8Array; region: Uint8Array }

/**
 * The weather as the harvest felt it, per year and weather region (weather.ts; the same whatever the settlements do):
 * harvest[y * regions + r] 0..255 for 0..1.4, drought[y * regions + r] the regional drought's severity 0..255 for 0..1 (0 none),
 * crisis[y] the world's harvest crisis 0..255 for 0..1 (year 0 is all 0), region[cell] the weather region of each cell.
 */
export interface WeatherRecord { regions: number; harvest: Uint8Array; drought: Uint8Array; crisis: Uint8Array; region: Uint8Array }

/** Everything the causes switch records (History.why). */
export interface CauseRecords {
  wars: WarWhy
  revolts: RevoltWhy
  famines: FamineWhy
  weather: WeatherRecord
  /** Abandoned events: event index and AbandonCause. */
  abandons: { count: number; event: Int32Array; cause: Uint8Array }
  /** PolityEnded events with PolityEnd.Absorbed: event index, the absorber's people over its own (log-coded like WarWhy.odds), and 1 when it had been the absorber's vassal. */
  absorbed: { count: number; event: Int32Array; ratio: Uint8Array; bound: Uint8Array }
  /** SuccessionCrisis events: event index, CrisisBit, and the contest chance 0..255 for 0..1. */
  crises: { count: number; event: Int32Array; bits: Uint16Array; chance: Uint8Array }
}

/** An empty CauseRecords (causes off; also for histories cached before it existed). */
export function emptyCauseRecords(): CauseRecords {
  const i32 = () => new Int32Array(0), u8 = () => new Uint8Array(0)
  return {
    wars: { rivalry: u8(), parts: new Int8Array(0), odds: u8(), exhaustion: u8(), mul: u8(), flags: u8(), front: i32() },
    revolts: { count: 0, event: i32(), unrest: u8(), part: u8(), share: u8(), odds: u8() },
    famines: { count: 0, event: i32(), harvest: u8(), stored: u8(), ravaged: u8(), crowded: u8(), imports: u8(), region: u8() },
    weather: { regions: 0, harvest: u8(), drought: u8(), crisis: u8(), region: u8() },
    abandons: { count: 0, event: i32(), cause: u8() },
    absorbed: { count: 0, event: i32(), ratio: u8(), bound: u8() },
    crises: { count: 0, event: i32(), bits: new Uint16Array(0), chance: u8() },
  }
}

/** Decodes a log-coded byte (WarWhy.odds, .mul, absorbed.ratio): 2^((b - 128) / 32); 0 for 0 (not recorded). */
export function decodeLog2(b: number): number {
  return b === 0 ? 0 : Math.pow(2, (b - 128) / 32)
}

/**
 * cradle wishes: the number of peoples a world gets (History.peoples.length of any history of it, whatever the options): it depends
 * only on the world. Exported by src/sim/index.ts as `cradleCount` (it builds the world's terrain: a fraction of a second), with
 * `previewCradles(world, cradles)`, which tells, without simulating, what the History will record for those wishes.
 */
export type CradleCount = (world: World) => number

/** Signature of the history entry point exported by src/sim/index.ts. Must be deterministic in (world, options) and must not mutate `world`. Years are capped at 32767. */
export type SimulateHistory = (world: World, options?: HistoryOptions) => History

/**
 * A resumable run, exported by src/sim/index.ts as `createHistoryRun`. `advanceTo(years)` returns a History
 * identical to `simulateHistory(world, { ...options, years })`, costing only the years added since the last call.
 * Each returned History owns its arrays.
 */
export interface HistoryRun {
  /** Years simulated so far. */
  readonly year: number
  advanceTo(years: number): History
  /**
   * Simulates up to `years` without assembling a History (assembling copies and names the whole run, which costs more
   * the longer it is), and returns `year`; years at or below `year` do nothing. For cheap progress steps: call it for
   * each chunk short of the target, then advanceTo(target) once. Absent from older simulations.
   */
  simulateTo?(years: number): number
  /**
   * Live append (seat-mode §3.2): adds orders to the run without re-simulating. addOrders(o) after advancing to Y - 1 gives
   * exactly the history of a run created with the orders given so far followed by o, as long as every order of o is for year
   * Y or later; an order for a year at or before `year` throws a RangeError (and nothing is added). Absent from older simulations.
   */
  addOrders?(orders: Order[]): void
  /**
   * seat (HistoryOptions.seat): steps the run on one year at a time until the seat's watcher records a decision (the run then
   * stands at that year: its rows are those of History.seat.decisions with year === it), the seat is lost, or `maxYear`; returns
   * `year`. Nothing is assembled (advanceTo(year) does). The same run without pauses gives the same History.
   */
  playSeat?(maxYear: number): number
}
export type CreateHistoryRun = (world: World, options?: HistoryOptions) => HistoryRun

// ---------------------------------------------------------------------------
// Journeys: groups of people travelling between settlements, for display.
// One per Founded event that has a parent and one per Migration event.

export const JourneyKind = {
  Settlers: 0, // founded settlement `to`
  Migrants: 1, // joined existing settlement `to`
  Expedition: 2, // explorers; `to` is the outpost founded, or `from` again if they came home, or -1 if lost
  Army: 3, // polities: a campaign's army marching from the staging settlement `from` on the target `to` (arriving the year of the battle); size is men
  Fleet: 4, // goods (later versions): a merchant fleet on a lane from its home mart `from` to the far mart `to`
} as const
export type JourneyKind = (typeof JourneyKind)[keyof typeof JourneyKind]

/** Longest a journey takes (History.journeys: arriveYear - departYear), in years (a migration on foot: migration.ts travelYears). */
export const JOURNEY_MAX_TRAVEL = 10

/**
 * Struct-of-arrays in order of arrival (arriveYear ascending; journeys of one year in the order they happened), so a
 * longer history's table begins with a shorter one's exactly: a journey index means the same journey after an
 * extension. departYear is NOT sorted; it lies at most JOURNEY_MAX_TRAVEL years before arriveYear, so the journeys
 * under way at year y are among those with arriveYear in [y, y + JOURNEY_MAX_TRAVEL] (a binary search on arriveYear).
 * Journey j follows cells path[pathOffsets[j] .. pathOffsets[j + 1]).
 */
export interface Journeys {
  count: number
  /** Fractional year the group sets out; arriveYear - departYear grows with route length. */
  departYear: Float32Array
  /** Year the group arrives: the year of the corresponding Founded or Migration event. */
  arriveYear: Float32Array
  /** Origin settlement id. */
  from: Int32Array
  /** Destination settlement id (the one founded or joined). */
  to: Int32Array
  /** Headcount. */
  size: Float32Array
  kind: Uint8Array
  pathOffsets: Uint32Array
  /** Cell ids along each route, origin cell first, destination cell last; consecutive cells are neighbours. May include water cells for sea crossings. */
  path: Uint32Array
}

// ---------------------------------------------------------------------------
// Named geography: continents, seas, rivers and so on get a name when a people
// first settles on or beside them, in that people's language.

export const FeatureKind = {
  Continent: 0,
  Island: 1,
  Ocean: 2,
  Sea: 3, // enclosed or marginal sea, large bay, strait
  Lake: 4,
  River: 5,
  MountainRange: 6,
  Desert: 7,
  Forest: 8,
} as const
export type FeatureKind = (typeof FeatureKind)[keyof typeof FeatureKind]

export interface GeoFeature {
  /** Index into History.features. */
  id: number
  kind: FeatureKind
  name: string
  /** Year it was named; it has no name before this. */
  namedYear: number
  /** Settlement whose people named it. */
  namedBy: number
  /** Cell to anchor a label at, near the feature's visual centre (for a river, a cell on its lower course). */
  anchorCell: number
  /** Extent in cells (for a river, its length in cells), for sizing and prioritising labels. */
  size: number
  /** Cells along the feature's main axis for curved labels (river course, range crest), or empty. */
  spine: number[]
}

export const TechField = {
  Farming: 0, // food yield
  Seafaring: 1, // ship range and safety, fishing
  Metalworking: 2, // ore use, tools
  Crafts: 3, // trade value, building
} as const
export type TechField = (typeof TechField)[keyof typeof TechField]
export const TECH_FIELD_COUNT = 4

/** A founding people: the descendants of one original tribe. */
export interface People {
  /** Index into History.peoples. */
  id: number
  /** Which cradle of civilisation the people began in; peoples sharing a cradle are neighbours. */
  cradle: number
  /** The original tribe's settlement. */
  founder: number
  name: string
}

export const SpeciesCategory = {
  Staple: 0,
  Livestock: 1,
  Fibre: 2,
  Luxury: 3,
  Stimulant: 4,
  Ornamental: 5,
} as const
export type SpeciesCategory = (typeof SpeciesCategory)[keyof typeof SpeciesCategory]

/** A plant or animal that is native to one or two places and spreads through contact, trade and colonisation. */
export interface SpeciesInfo {
  /** Index into History.species. */
  id: number
  /** The real-world model it is patterned on, as a stable key such as "potato" or "camel"; for looks and descriptions, not shown as its name. */
  archetype: string
  category: SpeciesCategory
  /** Its name in this world: a word from the language of the people who first held it. */
  name: string
  /** Cells at the centre of each place it is native to (one or two). */
  origins: number[]
  /** Staples: food yield relative to the baseline grain where it grows well. 0 for other categories. */
  yield: number
  /** Trade worth per unit relative to grain, for fibre, luxury and stimulant species. 0 or absent otherwise. */
  value?: number
  /** Stimulants: how strongly demand becomes a habit, 0 to 1. */
  habit?: number
  /** Stimulants: harm to the health and work of users, 0 (mild, like tea) to 1 (ruinous). */
  harm?: number
  /** True for crops grown from cuttings, which are far more exposed to blight. */
  clonal?: boolean
  /** Staples: how well the harvest keeps, 0 (rots in weeks) to 1 (stores for years). */
  storability?: number
}

/** A farming technique or improved strain that a people works out and others can learn. */
export interface TechniqueInfo {
  /** Index into History.techniques. */
  id: number
  /** The real-world model, as a stable key such as "earlyRice", "rotation" or "heavyPlough". */
  archetype: string
  /** Its name in this world, from the language of the people who first had it. */
  name: string
  /** The species it applies to, or -1 if it is general. */
  species: number
}

// ---------------------------------------------------------------------------
// ideas: inventions and practices (History.ideas, History.ideaAdoptions).

/** What an idea is about (IdeaInfo.kind). */
export const IdeaKind = { Farming: 0, Crafts: 1, Transport: 2, Seafaring: 3, War: 4, Administration: 5, Knowledge: 6, Health: 7 } as const
export type IdeaKind = (typeof IdeaKind)[keyof typeof IdeaKind]

/**
 * How a people came by an idea (IdeaAdoptions.how, the `extra` of EventType.IdeaAdopted): conceived itself; from a people it had
 * met (envoys, travellers); from neighbours; along trade routes; along the long-haul lanes and relays between marts; through a
 * trading post; with migrants; by conquest (either way); by living under one ruler; with pilgrims or clergy of a shared faith;
 * with visitors (leisure travel); through a marriage of ruling houses; by theft (spies, captured craftsmen); Lost marks a loss.
 */
export const IdeaHow = { Invented: 0, Contact: 1, Neighbours: 2, Trade: 3, Lane: 4, Post: 5, Migration: 6, Conquest: 7, Empire: 8, Pilgrims: 9, Visitors: 10, Marriage: 11, Theft: 12, Lost: 13 } as const
export type IdeaHow = (typeof IdeaHow)[keyof typeof IdeaHow]

/** Why a people lost an idea (the `extra` of EventType.IdeaLost): too few and too isolated to keep it up; its numbers collapsed; an idea it rests on was lost. */
export const IdeaLoss = { Isolated: 0, Collapse: 1, Prerequisite: 2 } as const
export type IdeaLoss = (typeof IdeaLoss)[keyof typeof IdeaLoss]

/** Why a people refused an idea (the `extra` of EventType.IdeaResisted): its faith, its ruler, its guilds. */
export const IdeaResist = { Faith: 0, Ruler: 1, Guild: 2 } as const
export type IdeaResist = (typeof IdeaResist)[keyof typeof IdeaResist]

/** An invention or practice. */
export interface IdeaInfo {
  /** Index into History.ideas. */
  id: number
  /** Stable key such as "wheel", "writing" or "compass". */
  key: string
  /** Its name, such as "the wheel" or "bills of exchange". */
  name: string
  kind: IdeaKind
  /** Ideas a people must hold before it can conceive or take up this one. */
  prerequisites: number[]
  /** The farming technique (History.techniques id) this idea is, when it is one of them (the species system finds and spreads it), else -1. */
  technique: number
  /** How readily it is taken up once seen, 0 (needs teachers for generations, like writing) to 1 (copied on sight, like the stirrup). */
  ease: number
  /** What it changes, in a few words (for the UI). */
  effect: string
  /** First year anyone conceived it (-1 if never in this run), the people and the settlement where; independent origins (IdeaConceived events). */
  firstYear: number
  firstPeople: number
  firstSettlement: number
  origins: number
}

/** Adoptions and losses of ideas, struct of arrays in chronological order (row k). */
export interface IdeaAdoptions {
  count: number
  idea: Uint8Array
  people: Int16Array
  year: Int16Array
  /** IdeaHow (Lost for a loss). */
  how: Uint8Array
  /** The people it came from (-1 for Invented and Lost). */
  from: Int16Array
  /** The settlement where it came in or was conceived (the people's largest for a loss), and the settlement it came from (-1). */
  via: Int32Array
  source: Int32Array
}

/** The ideas people `p` holds at `year` (ascending ids), from History.ideaAdoptions. */
export function ideasHeldAt(h: Pick<History, 'ideas' | 'ideaAdoptions'>, p: number, year: number): number[] {
  const A = h.ideaAdoptions
  const held = new Uint8Array(h.ideas.length)
  for (let k = 0; k < A.count && A.year[k] <= year; k++) if (A.people[k] === p) held[A.idea[k]] = A.how[k] === IdeaHow.Lost ? 0 : 1
  const out: number[] = []
  for (let i = 0; i < held.length; i++) if (held[i]) out.push(i)
  return out
}

// ---------------------------------------------------------------------------
// landmarks: lasting great buildings, a consequence of history.

/** What a landmark is (History.landmarks.kind, the `extra` of the landmark events). */
export const LandmarkKind = {
  Castle: 0, // a keep or citadel: the seat of a kingdom, or a frontier fortress town (stone keep, mud-brick citadel, timber stronghold by culture)
  Palace: 1, // a royal or imperial palace: the long-held capital of a kingdom or empire, and rich
  GreatTemple: 2, // a great temple or cathedral: a holy city, the seat of a state faith, a rich and pious city
  Monastery: 3, // a monastery or great religious house outside the walls (a faith of organisation, a pious ruler)
  MarketHall: 4, // a great market hall or exchange: a mart of the long-haul trade, an entrepot
  Guildhall: 5, // a guildhall: the seat of a renowned craft tradition
  Lighthouse: 6, // a lighthouse or great harbour mole: a major port on an ocean lane
  Library: 7, // a university or great library: a city of a people that holds writing, paper or printing
  Monument: 8, // a triumphal monument (column, arch, obelisk): a victorious ruler
  Mausoleum: 9, // a mausoleum: the founder of a ruling house, or a great ruler, buried at the capital
  Baths: 10, // great baths: a resort at hot springs
  CouncilHouse: 11, // a senate or council house: the seat of a league or of an elective state
  Temple: 12, // (lesser) a town's large church or temple of its majority faith (big cities have several)
  Shrine: 13, // (lesser) a folk shrine, stone circle or sacred grove of a traditional faith
} as const
export type LandmarkKind = (typeof LandmarkKind)[keyof typeof LandmarkKind]
export const LANDMARK_KIND_COUNT = 14

/** Great (one of a world's few dozen named landmarks, with events) or lesser (a town's ordinary house of worship or shrine, no events). */
export const LandmarkRank = { Great: 0, Lesser: 1 } as const
export type LandmarkRank = (typeof LandmarkRank)[keyof typeof LandmarkRank]

/**
 * The building form of a house of worship (History.landmarks.form for GreatTemple, Monastery, Temple and Shrine; 0 for the other kinds,
 * whose shape the renderer takes from the town's building style). Each faith has a building tradition fixed at its founding
 * (History.landmarks.faithForm): from its founding people's lands and a seeded draw, kept wherever it spreads; a schism inherits its
 * parent's form with another variant; a universal faith never has the Ziggurat or Circle tradition (those are folk faiths'). A
 * great temple of a Steepled, Domed or Pagoda tradition raised before its builders hold the mathematics for vaults and domes is
 * built in the tradition's early form (a ziggurat where the faith's homeland is hot and dry, else a columned temple); a town's
 * temple and a monastery take the tradition as it is; a shrine is always a Circle.
 */
export const LandmarkForm = {
  Steepled: 0, // a church or cathedral: a long nave with a steepled tower
  Domed: 1, // a domed temple or mosque-like hall with minarets or corner towers
  Ziggurat: 2, // a stepped pyramid or ziggurat (hot dry lands, early eras)
  Columned: 3, // a columned classical temple on a stepped base
  Pagoda: 4, // a pagoda or tiered tower
  Stave: 5, // a stave or timber hall with stacked steep roofs (cold forests)
  Stupa: 6, // a stupa or great mound with a spire
  Circle: 7, // an open-air stone circle or sacred grove shrine (folk practice)
} as const
export type LandmarkForm = (typeof LandmarkForm)[keyof typeof LandmarkForm]
export const LANDMARK_FORM_COUNT = 8

/** State of a landmark (its change rows; landmarksAt gives the state at a year). */
export const LandmarkState = {
  Building: 0, // under construction (from its begun year until completed)
  InUse: 1, // finished and in use
  Neglected: 2, // its town far below its peak, or no longer the seat it was built for: shabby, outbuildings roofless
  Ruined: 3, // broken walls, no roof, rubble (sacked, its town abandoned, or neglected for centuries)
  Restored: 4, // rebuilt by a later ruler or a revival: in use again
  Converted: 5, // a house of worship rededicated to another faith (the change row's faith): in use, its form kept with new trim
  Unfinished: 6, // work given up before it was finished (the town fell, was sacked or abandoned): a stump that weathers like a ruin
} as const
export type LandmarkState = (typeof LandmarkState)[keyof typeof LandmarkState]

/**
 * Landmarks, struct-of-arrays in the order they were begun (row = landmark id; a longer run repeats a shorter one's rows exactly, except
 * that completedYear may be set later for a work still building at the shorter run's end). A landmark is never removed: when its town
 * shrinks, loses its status or is abandoned it changes state instead (the change rows: chronological, also a prefix in a longer run).
 */
export interface Landmarks {
  count: number
  kind: Uint8Array
  rank: Uint8Array
  /** LandmarkForm (houses of worship), else 0. */
  form: Uint8Array
  /** Variant 0..3 of the form (a schism's variation, the builder's taste): proportions and trim. */
  variant: Uint8Array
  settlement: Int32Array
  cell: Int32Array
  begunYear: Int16Array
  /** Year it was finished, -1 if not (still building at the end of the run, or given up unfinished). */
  completedYear: Int16Array
  /** The builder: polity, its ruler at the begun year (History.rulers), that ruler's house; -1 for none. */
  polity: Int16Array
  ruler: Int32Array
  dynasty: Int32Array
  /** The faith it was raised for (houses of worship; for others the builder's state faith), -1. */
  faith: Int16Array
  /** The people whose language named it (the builders'). */
  people: Int16Array
  /** Its name ("the Keep of Thesmu", "Unlafa's Great Temple at Rilko"); unique within the world. The town's name in it is the one in use at its begun year. */
  name: string[]
  /**
   * The same with `{town}` where its town's name stands ("the Keep of {town}"; without a town part, the name itself): substitute
   * the name its town bears at the year shown (landmarkNameAt), so a landmark follows its town's renamings.
   */
  nameTemplate: string[]
  /** State changes in chronological order (a year's in the order they happened): the landmark, the year, the new LandmarkState. */
  changeCount: number
  changeLandmark: Int32Array
  changeYear: Int16Array
  changeState: Uint8Array
  /** The faith after a Converted change (and the faith restored to on a restoration), else -1. */
  changeFaith: Int16Array
  /** The polity behind the change (the restorer, the converting state, the sacker), -1. */
  changePolity: Int16Array
  /**
   * The landmark's town after the change: `settlement` unless a town refounded on or beside its ruins (founded there after the
   * old town was given up) restored it and took it over (a Restored change; landmarkTownAt).
   */
  changeSettlement: Int32Array
  /** Building tradition of each faith (LandmarkForm by faith id; 255 for a faith never seen), and its variant 0..3. */
  faithForm: Uint8Array
  faithVariant: Uint8Array
}

/** A landmark as it stands at a year (landmarksAt). */
export interface LandmarkAt {
  /** Row in History.landmarks. */
  id: number
  kind: LandmarkKind
  rank: LandmarkRank
  form: LandmarkForm
  state: LandmarkState
  /** Year it entered that state. */
  since: number
  /** The faith it serves at the year (after conversions), -1. */
  faith: number
}

/**
 * The landmarks of settlement `settlement` begun by `year`, each with its state at that year (from the change rows), in the order
 * they were begun. A landmark begun later is not listed; one ruined or unfinished still is.
 */
export function landmarksAt(h: Pick<History, 'landmarks'>, settlement: number, year: number): LandmarkAt[] {
  const L = h.landmarks
  const out: LandmarkAt[] = []
  if (!L) return out
  // (landmarks that passed to another town by the year: the town they belong to then)
  const cs = L.changeSettlement
  const moved = new Map<number, number>()
  if (cs) for (let k = 0; k < L.changeCount && L.changeYear[k] <= year; k++) { const id = L.changeLandmark[k]; if (cs[k] >= 0 && (cs[k] !== L.settlement[id] || moved.has(id))) moved.set(id, cs[k]) }
  for (let i = 0; i < L.count && L.begunYear[i] <= year; i++) {
    if ((moved.get(i) ?? L.settlement[i]) !== settlement) continue
    out.push({ id: i, kind: L.kind[i] as LandmarkKind, rank: L.rank[i] as LandmarkRank, form: L.form[i] as LandmarkForm, state: LandmarkState.Building, since: L.begunYear[i], faith: L.faith[i] })
  }
  if (out.length === 0) return out
  for (let k = 0; k < L.changeCount && L.changeYear[k] <= year; k++) {
    const id = L.changeLandmark[k]
    for (const x of out) {
      if (x.id !== id) continue
      x.state = L.changeState[k] as LandmarkState
      x.since = L.changeYear[k]
      if (L.changeFaith[k] >= 0) x.faith = L.changeFaith[k]
    }
  }
  return out
}

/** The town landmark `id` belongs to at `year`: its `settlement`, or the town that restored its ruins and took it over (changeSettlement). */
export function landmarkTownAt(h: Pick<History, 'landmarks'>, id: number, year: number): number {
  const L = h.landmarks
  let v = L.settlement[id]
  const cs = L.changeSettlement
  if (cs) for (let k = 0; k < L.changeCount && L.changeYear[k] <= year; k++) if (L.changeLandmark[k] === id && cs[k] >= 0) v = cs[k]
  return v
}

/** Landmark `id`'s name at `year`: its nameTemplate with the name its town bears then (settlementNameAt), else its name. */
export function landmarkNameAt(h: Pick<History, 'landmarks' | 'settlements' | 'renamings'>, id: number, year: number): string {
  const L = h.landmarks
  const t = L.nameTemplate ? L.nameTemplate[id] : undefined
  if (!t || t.indexOf('{town}') < 0) return L.name[id]
  return t.split('{town}').join(settlementNameAt(h, landmarkTownAt(h, id, year), year))
}

// ---------------------------------------------------------------------------
// orders: the player's nudges (HistoryOptions.orders). Light steering that obeys the rules: an order raises the relevant drive,
// weight or chance for a while (OrderKindInfo.years) and the systems decide; it can fail. Not a game: no goals, no score.

/** What an order asks. The actor and target of each are in describeOrderKinds(). */
export const OrderKind = {
  Explore: 0, // a people (actor) is urged to explore toward a cell (target): its towns send expeditions sooner, aimed that way
  Settle: 1, // a people is urged to settle toward a cell: its settlers prefer sites that way
  Crop: 2, // a people is urged to take up a species (target: History.species id) from neighbours, its own towns or the wild
  Idea: 3, // a people is urged to seek an idea (target: History.ideas id): it learns it faster from those it has met, or conceives it sooner
  War: 4, // a polity (actor) is urged to make war on a neighbouring polity (target)
  Peace: 5, // a polity is urged to make peace in its war with another polity (target)
  Seat: 6, // a polity is urged to move its capital to one of its towns (target: settlement id)
  Faith: 7, // a polity's ruler is urged to take up a universal faith (target: History.faiths id)
  Fortify: 8, // a town (actor: settlement id) is urged to raise walls
  Quarantine: 9, // a port (actor: settlement id) is urged to hold incoming ships in quarantine
  // seat-mode (10-22, §3.6; the rest reserved until their steps land)
  Choice: 10, // seat: records the player's choice on a decision card (actor: the seat's people; target: decision row * 8 + option); no effect, Fulfilled at give
  Repudiate: 11, // seat: a polity renounces its alliance (and any marriage tie) with another polity (target); target = the actor itself: with finance, the crown's debts
  Defy: 12, // seat: a vassal or tributary throws off its bond to its overlord (target)
  Submit: 13, // seat: a polity at war offers its enemy (target) tribute for peace
  Ally: 14, // seat: a polity seeks an alliance with another polity (target)
  Marry: 15, // seat: a polity's ruling house seeks a marriage tie with another polity's (target)
  Designate: 16, // seat: a polity's ruler names an heir (target: the heir's birth year)
  Placate: 17, // seat: a polity's court buys off its restive (magnates, a general, rebels); no target
  Purge: 18, // seat: a polity's ruler moves against a too-popular general; no target
  Borrow: 19, // seat (finance): a polity's crown borrows to keep a war chest even in peace; no target
  Levy: 20, // seat: a polity's crown raises an extraordinary levy (with finance: taxes pushed to their highest); no target
  // 21 Charter: reserved until city-states lands
  Betray: 22, // seat (oaths): a polity makes a separate peace in an alliance war, deserting its ally (target)
} as const
export type OrderKind = (typeof OrderKind)[keyof typeof OrderKind]
/**
 * Rows in the order-kind table (describeOrderKinds), live and reserved: 0–20 and 22 live (10–22 seat-mode's, given by
 * decision cards only), 21 and 23–83 reserved placeholders that later plans replace in place (MASTER-PLAN §3.2, R40). The table is array-indexed by kind, so it stays contiguous.
 */
export const ORDER_KIND_COUNT = 84

/** One nudge. `year` >= 1 (earlier years act at year 1); `target` per kind (describeOrderKinds), absent or -1 when the kind takes none. */
export interface Order {
  year: number
  kind: OrderKind
  actor: number
  target?: number
}

/** What an actor or a target is. */
export const OrderRole = { None: 0, People: 1, Polity: 2, Settlement: 3, Cell: 4, Species: 5, Idea: 6, Faith: 7, /** seat: a decision card's option, row * 8 + option (History.seat.decisions; 8-10 are reserved: registry §3.2) */ Decision: 11, /** seat: an heir of the actor polity's ruler, by birth year (Designate) */ Heir: 12 } as const
export type OrderRole = (typeof OrderRole)[keyof typeof OrderRole]

/** What became of an order. */
export const OrderStatus = {
  Pending: 0, // its year is after the end of the run
  Active: 1, // given, still in force at the end of the run
  Fulfilled: 2,
  Partly: 3, // ran out of time with something done toward it (an expedition sent that way that did not reach the target)
  Failed: 4, // impossible when given, or made impossible (its actor or target gone)
  Expired: 5, // ran out of time with nothing done: the rules never let it happen
} as const
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus]

/** Why an order came out as it did (OrderOutcome.reason; the `extra` of OrderFailed and OrderLapsed). */
export const OrderReason = {
  None: 0,
  NoActor: 1, // no such people, polity or town alive at the order's year
  NoTarget: 2, // no such target, or not one this kind takes (a farming technique for Idea, a traditional faith for Faith, the polity itself)
  SystemOff: 3, // the system it needs is switched off (polities, ideas, religion, disease)
  AlreadyDone: 4, // already so: the cell known, the species or idea held, at war, the capital, the ruler's faith, walls up, in quarantine
  ActorGone: 5, // the actor died out or ended while the order was in force
  TargetGone: 6, // the target ended (the other polity, the town)
  Unknown: 7, // Settle: the people does not know the land that way (its settlers go only where it knows)
  Unfit: 8, // Crop: the species grows at none of the people's settlements; Settle: the target is sea
  NoSource: 9, // Crop: nobody it knows, nor the wild near its fields, has the species; Idea: no holder met and it cannot conceive it
  Prerequisite: 10, // Idea: an idea it rests on is not held
  NoBorder: 11, // War: no common frontier between the two
  Truce: 12, // War: a truce holds, or the two are vassal and overlord
  TooWeak: 13, // War: never strong enough at the front to dare it; Fortify, Seat: too small a town
  NotAtWar: 14, // Peace: the two are not at war
  NotMember: 15, // Seat: the town is not in the realm
  Refused: 16, // the ruler, the council or the faithful would not (Seat, Faith, a resisted idea)
  NotPort: 17, // Quarantine: the town has no port, or is not in a polity
  Unskilled: 18, // Quarantine: its people lacks the idea of quarantine or the craft
  Absent: 19, // Faith: too few of the realm follow it for the ruler to turn
  Reached: 20, // Explore: an expedition reached the target (Fulfilled), or set out that way (Partly)
  NoExpedition: 21, // Explore: no town of the people was able to send one (too poor, too hungry, nothing unknown near)
  Done: 22, // fulfilled by the systems' own rules
  Busy: 23, // War: already at as many wars as it can fight
  OutOfReach: 24, // Explore: its expeditions found nothing unknown within reach that way
  NoRoom: 25, // Settle: its settlers found no free land within reach that way (or joined towns instead)
  NoBond: 26, // seat: no such bond (Repudiate: no alliance or tie, or no debts; Defy: not its overlord; Betray: not allies in a war)
  NoHeir: 27, // seat: Designate: no such heir in the ruler's family, or the heir died first
  NoGeneral: 28, // seat: Purge, Placate: nothing threatens the throne (a hint for the UI only: the order may still be given)
} as const
export type OrderReason = (typeof OrderReason)[keyof typeof OrderReason]

/**
 * The outcome of History.orders[k] (orderOutcomes[k]). `product` per kind: Explore the journey id (History.journeys) of the expedition
 * that reached the target (or the last one sent that way); Settle the new settlement; Crop the settlement that took the species up;
 * Idea the settlement where it came in; War and Peace the war id (History.wars); Seat the new capital; Faith the ruler id
 * (History.rulers, -1 without rulers); Fortify the structure id of the walls; Quarantine the port. seat kinds: Repudiate and Defy the
 * bond id (History.bonds; -1 for a marriage tie alone or the crown's debts); Submit the war; Ally the alliance bond; Marry the
 * marriage tie (History.marriages); Designate the designee's reign (History.rulers); Placate the wealth spent; Purge 0 (purged) or
 * 1 (the general struck first); Levy the wealth raised (the proxy; -1 with finance); Betray the war it left. -1 when nothing was produced.
 */
export interface OrderOutcome {
  status: OrderStatus
  reason: OrderReason
  /** The year it was resolved (fulfilled, failed, lapsed), -1 while pending or active. */
  year: number
  /** The first year something was done toward it (an expedition sent that way...), -1 if never. */
  acted: number
  product: number
  /** Where it came to pass (or the actor's seat when it failed or lapsed), a settlement id or -1. */
  place: number
}

export interface OrderKindInfo {
  kind: OrderKind
  /** Short key used in the text encoding ("explore", "war", ...). */
  key: string
  /** Human label, such as "Explore toward". */
  label: string
  actor: OrderRole
  target: OrderRole
  /** Years the nudge stays in force. */
  years: number
  /** What it does, in a sentence (for the UI). */
  effect: string
  /**
   * A reserved placeholder (MASTER-PLAN R40): no encode key, years 0, never offered by the UI; given, it fails at once with
   * OrderReason.SystemOff. Its owner replaces the row (the only allowed edit of the table, §8.6).
   */
  reserved?: true
  /** The plan and the name it reserves the row for (registry §3.2), on reserved rows only. */
  reservedFor?: string
  /** seat-mode: given only by a decision card (never offered by the Nudge panel). */
  seatOnly?: true
}

/** The reserved order-kind rows 23–83 by owner (11–22 are seat-mode's: live but 21 Charter, reserved below) and planned name (MASTER-PLAN §3.2; "" where the owner has not named it). */
const RESERVED_ORDER_KINDS: readonly (readonly [string, readonly string[]])[] = [
  ['seat-mode (Family seat follow-ups)', ['', '', '', '', '', '', '']], // 23–29
  ['riots', ['Crackdown', 'Relief', 'Tolerate']], // 30–32
  ['court-politics', ['SummonEstates', 'Appoint', 'Dismiss', 'Favour', 'Arrest', 'Reform']], // 33–38
  ['tech-tree', ['BanIdea', 'InviteExperts']], // 39–40
  ['character-mode', ['PChoice', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']], // 41–58
  ['migration', ['Gates', 'Asylum', 'Amnesty']], // 59–61
  ['modern-ideologies', ['Franchise', 'Sponsor', 'Censor']], // 62–64
  ['future-politics', ['Constitute', 'Unplug', '']], // 65–67
  ['infrastructure', ['BuildLine', 'FundWaterworks', 'Nationalise']], // 68–70
  ['world-builder-divine', ['Portent', 'Heal', 'Feed', 'Bounty', 'Storm', 'Flood', 'Pestilence', 'Strike', 'Inspire', 'Prophet', 'Bless', 'Curse']], // 71–82
  ['religious-evolution', ['Council']], // 83
]

function reservedRows<T>(first: number, groups: readonly (readonly [string, readonly string[]])[], row: (kind: number, reservedFor: string) => T): T[] {
  const out: T[] = []
  let k = first
  for (const [owner, names] of groups) for (const n of names) out.push(row(k++, n ? `${owner}: ${n}` : owner))
  return out
}

const ORDER_KINDS: readonly OrderKindInfo[] = [
  { kind: OrderKind.Explore, key: 'explore', label: 'Explore toward', actor: OrderRole.People, target: OrderRole.Cell, years: 40, effect: 'Its towns fit out expeditions sooner and aim them toward the place, if they can afford it and reach it.' },
  { kind: OrderKind.Settle, key: 'settle', label: 'Settle toward', actor: OrderRole.People, target: OrderRole.Cell, years: 50, effect: 'Its settlers prefer sites toward the place, through land the people knows.' },
  { kind: OrderKind.Crop, key: 'crop', label: 'Take up a crop or herd', actor: OrderRole.People, target: OrderRole.Species, years: 50, effect: 'Its towns take the species up readily from whoever has it, where it grows.' },
  { kind: OrderKind.Idea, key: 'idea', label: 'Seek an idea', actor: OrderRole.People, target: OrderRole.Idea, years: 50, effect: 'It learns the idea faster from the peoples it has met, or conceives it sooner where it could.' },
  { kind: OrderKind.War, key: 'war', label: 'Make war on', actor: OrderRole.Polity, target: OrderRole.Polity, years: 25, effect: 'Rivalry rises and the ruler is eager: war comes if the realm is strong enough at the border.' },
  { kind: OrderKind.Peace, key: 'peace', label: 'Make peace with', actor: OrderRole.Polity, target: OrderRole.Polity, years: 15, effect: 'Envoys seek terms: the war ends sooner.' },
  { kind: OrderKind.Seat, key: 'seat', label: 'Move the capital to', actor: OrderRole.Polity, target: OrderRole.Settlement, years: 20, effect: 'The court may move to a large town of the realm, if the ruler agrees.' },
  { kind: OrderKind.Faith, key: 'faith', label: 'Take up a faith', actor: OrderRole.Polity, target: OrderRole.Faith, years: 40, effect: 'The ruler leans toward a universal faith already followed in the realm.' },
  { kind: OrderKind.Fortify, key: 'fortify', label: 'Fortify', actor: OrderRole.Settlement, target: OrderRole.None, years: 30, effect: 'The town raises walls even without danger, if it has the people.' },
  { kind: OrderKind.Quarantine, key: 'quarantine', label: 'Quarantine', actor: OrderRole.Settlement, target: OrderRole.None, years: 30, effect: 'The port holds incoming ships in quarantine, if its people knows how and can pay.' },
  // seat-mode (§3.6): 10–20 and 22 live (given only by decision cards); 21 Charter reserved until city-states lands
  { kind: OrderKind.Choice, key: 'choice', label: 'Choose', actor: OrderRole.People, target: OrderRole.Decision, years: 0, effect: 'Records the choice made on a decision card; the orders of the option do the rest.', seatOnly: true },
  { kind: OrderKind.Repudiate, key: 'renounce', label: 'Renounce', actor: OrderRole.Polity, target: OrderRole.Polity, years: 1, effect: 'The alliance and any marriage tie with them end at once; they will remember it.', seatOnly: true },
  { kind: OrderKind.Defy, key: 'defy', label: 'Defy the overlord', actor: OrderRole.Polity, target: OrderRole.Polity, years: 1, effect: 'The tribute stops and the bond is thrown off; the overlord may come to collect.', seatOnly: true },
  { kind: OrderKind.Submit, key: 'submit', label: 'Offer tribute', actor: OrderRole.Polity, target: OrderRole.Polity, years: 10, effect: 'Envoys offer tribute for peace: if the enemy accepts, the war ends and the tribute is paid for years.', seatOnly: true },
  { kind: OrderKind.Ally, key: 'ally', label: 'Seek an alliance', actor: OrderRole.Polity, target: OrderRole.Polity, years: 20, effect: 'Envoys seek an alliance against a common rival: it comes far more readily, if both are realms of standing.', seatOnly: true },
  { kind: OrderKind.Marry, key: 'marry', label: 'Seek a match', actor: OrderRole.Polity, target: OrderRole.Polity, years: 15, effect: 'A marriage between the two houses is sought, even across old rivalry; their court may still say no.', seatOnly: true },
  { kind: OrderKind.Designate, key: 'designate', label: 'Name an heir', actor: OrderRole.Polity, target: OrderRole.Heir, years: 40, effect: 'The heir named succeeds if alive and lawful; against the law, the lords may contest it.', seatOnly: true },
  { kind: OrderKind.Placate, key: 'placate', label: 'Placate the court', actor: OrderRole.Polity, target: OrderRole.None, years: 15, effect: 'Gold for the restive: the throne is safer for a while, an open crisis ends and the towns calm, at a price.', seatOnly: true },
  { kind: OrderKind.Purge, key: 'purge', label: 'Purge the general', actor: OrderRole.Polity, target: OrderRole.None, years: 12, effect: 'No general will rise against the throne while the order holds, but the army is weaker, and he may strike first.', seatOnly: true },
  { kind: OrderKind.Borrow, key: 'borrow', label: 'Borrow', actor: OrderRole.Polity, target: OrderRole.None, years: 10, effect: 'The treasury borrows to keep a war chest even in peace, if lenders will lend.', seatOnly: true },
  { kind: OrderKind.Levy, key: 'levy', label: 'Raise a levy', actor: OrderRole.Polity, target: OrderRole.None, years: 10, effect: 'Coin is squeezed from the towns into the crown’s hands; the towns grumble.', seatOnly: true },
  ...reservedRows(21, [['seat-mode', ['Charter']]], (kind, reservedFor): OrderKindInfo => ({
    kind: kind as OrderKind, key: '', label: '', actor: OrderRole.None, target: OrderRole.None, years: 0, effect: '', reserved: true, reservedFor,
  })),
  { kind: OrderKind.Betray, key: 'betray', label: 'Make a separate peace', actor: OrderRole.Polity, target: OrderRole.Polity, years: 5, effect: 'Terms are sought with the common enemy behind the ally’s back: the war ends for us, and the ally is left alone.', seatOnly: true },
  // (23–83: reserved placeholders, R40; a plan replaces its own rows with live ones)
  ...reservedRows(23, RESERVED_ORDER_KINDS, (kind, reservedFor): OrderKindInfo => ({
    kind: kind as OrderKind, key: '', label: '', actor: OrderRole.None, target: OrderRole.None, years: 0, effect: '', reserved: true, reservedFor,
  })),
]

/** The order kinds with their labels, the roles of actor and target, and how long each stays in force (a fresh copy; reserved rows included, flagged). */
export function describeOrderKinds(): OrderKindInfo[] {
  return ORDER_KINDS.map((x) => ({ ...x }))
}

/** True for a kind with a reserved placeholder row (MASTER-PLAN R40), or no row at all. */
export function orderKindReserved(kind: number): boolean {
  const info = ORDER_KINDS[kind]
  return info === undefined || info.reserved === true
}

// ---------------------------------------------------------------------------
// seat: "Take a throne" (seat-mode). The player holds a seat; after each year a watcher (pure reads, no draws) looks for a
// decision point and records a decision with 2-4 options, each a list of orders for the next year. The run pauses there (the
// worker), the player picks, and the orders are appended live (HistoryRun.addOrders). A URL replay (seed, seat, orders) is one
// run from year 0 that gives the same decisions.

/** What the player rules in seat mode (HistoryOptions.seat). */
export const SeatKind = {
  People: 0, // a people (History.peoples id): its largest polity when it has one, else its towns (people orders only)
  Polity: 1, // a polity (History.polities id); passes to a successor of its own house when it ends (SeatPassed), else is lost
  House: 2, // a ruling house (History.dynasties id): the largest realm it rules; lost when the house ends (DynastyEnded)
  Family: 3, // a merchant family (merchant-families plan): later (seat step 15)
  Person: 4, // a person (character-mode): later
} as const
export type SeatKind = (typeof SeatKind)[keyof typeof SeatKind]

/** How a seat ended (the `extra` of SeatLost). */
export const SeatEnd = {
  Conquered: 0, // its realm was conquered or absorbed, with no throne of the house left
  HouseEnded: 1, // the house ended (DynastyEnded)
  PeopleGone: 2, // the people died out
  Overthrown: 3, // the house was overthrown and holds no throne
} as const
export type SeatEnd = (typeof SeatEnd)[keyof typeof SeatEnd]

/** Ambitions the player may set (SeatOptions.ambitions), judged yearly while the seat is held; they change nothing in the run. */
export const AmbitionKind = {
  Endure: 0, // hold the seat for SEAT.endureYears (300) years from its year
  Unify: 1, // rule >= 60% (lane N3; was 80%) of the settled people of the capital's landmass, with >= 5 member towns, for 10 years running
  Faith: 2, // a universal faith founded in a member town, or the state faith's holy city in the realm
  Riches: 3, // the richest realm (the sum of member wealth) for 25 years running
  Union: 4, // the house holds two thrones at once (a personal union, or two realms ruled by it)
  Monument: 5, // a great landmark, or a town's great temple, finished by the realm while the seat is held (lane N3: judged; was never judged)
} as const
export type AmbitionKind = (typeof AmbitionKind)[keyof typeof AmbitionKind]
/** AmbitionKind rows 0-5 (seat); 6-15 character-mode (registry §3.2). */
export const AMBITION_KIND_COUNT = 6

/** seat: the player's seat, part of the simulation's input like the seed and the orders (HistoryOptions.seat). */
export interface SeatOptions {
  kind: SeatKind
  id: number
  /** The year the player takes the seat (decisions from the year after it; nothing changes before). */
  from: number
  /** AmbitionKind values the player set out to achieve (judged only; they change nothing in the run). */
  ambitions?: number[]
}

/** The kinds of decision a seat is offered (the rows of describeDecisionKinds; History.seat.decisions.kind). */
export const DecisionKind = {
  WarOnUs: 0, // a neighbour declared war on the seat's realm
  Opening: 1, // a contacted neighbour is weak (a succession crisis, civil war or regency) and the realm is stronger at the border
  Heir: 2, // the ruler is old, or the succession may be contested (seat step 8)
  Crisis: 3, // a succession crisis or a regency at home (seat step 8)
  AllianceMade: 4, // an alliance was made with the realm as a party (seat step 9)
  AllianceSought: 5, // a common threat: an alliance could be sought (seat step 9)
  Overlord: 6, // the realm became a vassal or a tributary (seat step 9)
  Match: 7, // a royal match is possible (seat step 8)
  General: 8, // a too-popular general (seat step 8)
  Plague: 9, // a great epidemic struck a town of the realm
  Faith: 10, // a universal faith holds a large share of the realm but not the ruler
  Revolt: 11, // a revolt broke out in a town of the realm
  Credit: 12, // the treasury is short (state-finances; seat step 13)
  Charter: 13, // a town demands a charter (city-states; seat step 13)
  Betrayal: 14, // an ally could make a separate peace (grudges; seat step 13)
  Frontier: 15, // an expedition came home with news of new land
  Crop: 16, // a contacted people holds a crop or herd the seat's people lacks and could grow
  Idea: 17, // a contacted people took up or conceived an idea the seat's people lacks and could hold
  // surfacing (EVALUATION §4 Lane 1; 102-112, the registry's next free values: cards for the merged systems, existing orders only)
  Default: 102, // finance: the realm's crown defaulted on its debts or refused them (CrownDefault, Repudiation)
  WarChest: 103, // finance: a war the realm fights must be paid for (it declared one), or its soldiers went unpaid (ArmyUnpaid)
  Battle: 104, // battles: a great battle the realm's army fought (BattleFought), won or lost
  Bluff: 105, // beliefs: a bluff exposed, a rival's seen through by the realm or the realm's own (BluffExposed)
  Intelligence: 106, // beliefs: a secret alliance of rivals came to light, or a rival's spies were caught (AllianceRevealed, SpyCaught)
  Disaster: 107, // disasters: an eruption, quake, wave or flood struck a town of the realm (or a volcanic winter its region)
  AllyCalls: 108, // oaths: an ally of the realm is at war and the realm is not (WarDeclared): honour the alliance or break it
  Betrayed: 109, // oaths: an ally deserted the realm in a war they fought together (Betrayal)
  Commune: 110, // city-states: a town of the realm made itself a republic or bought its liberties (CommuneProclaimed, CharterBought)
  ColdWar: 111, // cold wars: the realm entered a cold war with a great rival (ColdWarBegan)
  Houses: 112, // families: a merchant house backed a side in the realm's civil war (FamilyBacked)
} as const
export type DecisionKind = (typeof DecisionKind)[keyof typeof DecisionKind]

/** The options a decision offers (History.seat.decisions.optKey). */
export const SeatOptionKey = {
  FightOn: 0, SuePeace: 1, OfferTribute: 2, SeekAlly: 3, Strike: 4, StayOut: 5, OfferMatch: 6, NameHeir: 7, LawDecides: 8,
  Placate: 9, CrushPretender: 10, Endure: 11, Honour: 12, Renounce: 13, Pay: 14, Defy: 15, Arrange: 16, Decline: 17, Purge: 18,
  Ignore: 19, Quarantine: 20, MoveCourt: 21, Embrace: 22, KeepWays: 23, Fortify: 24, Crush: 25, Borrow: 26, Levy: 27,
  Retrench: 28, Grant: 29, Refuse: 30, SeparatePeace: 31, StandBy: 32, Settle: 33, ExploreOn: 34, Stay: 35, TakeUp: 36, Seek: 37,
  /** Credit (finance): refuse the crown's debts (Repudiate with the realm itself as target). */
  RepudiateDebts: 38,
  /** Crisis, while the deciding body rules in all but name: take the power back (Choice option DEFER_OPTIONS.reclaim; risky). */
  Reclaim: 39,
  // surfacing (EVALUATION §4 Lane 1; 160-166, the registry's next free values): words for existing orders on the new cards
  /** Disaster: Placate as relief (gold for the stricken, unrest eased). */
  SendRelief: 160,
  /** Battle (lost): Purge, the beaten general recalled. */
  RecallGeneral: 161,
  /** AllyCalls: War on the ally's enemy. */
  JoinWar: 162,
  /** Betrayed: War on the ally who deserted. */
  Avenge: 163,
  /** Bluff (theirs seen through): War on the bluffer. */
  CallBluff: 164,
  /** Battle (won): Peace from strength. */
  OfferTerms: 165,
  /** Battle (won): Placate as the army's reward (the throne safer from its generals). */
  RewardArmy: 166,
} as const
export type SeatOptionKey = (typeof SeatOptionKey)[keyof typeof SeatOptionKey]

/** seat: the decisions offered to the player, struct-of-arrays in order (History.seat.decisions). */
export interface SeatDecisions {
  count: number
  /** Year of the decision (its orders act from year + 1); the DecisionKind; the seat polity then (-1); the subject (polity, town, faith, species, idea or cell, per kind); the settlement it is told at. */
  year: Int32Array
  kind: Uint8Array
  polity: Int32Array
  subject: Int32Array
  place: Int32Array
  /** Options of decision d: optStart[d] .. optStart[d + 1] - 1, each an option key (SeatOptionKey) and its orders orderStart[o] .. orderStart[o + 1] - 1 (kind, actor, target; year is year[d] + 1). */
  optStart: Uint32Array
  optKey: Uint8Array
  orderStart: Uint32Array
  orderKind: Uint8Array
  orderActor: Int32Array
  orderTarget: Int32Array
  /** The option chosen (from the Choice orders given at year + 1), -1 when none was (no card answered: the court's own course). */
  chosen: Int8Array
  /** How divisive the matter is, 0..1 (every course angers someone: a succession, a schism, a revolt, taxes; low for a new crop): a deferral of it costs less authority, and its blame falls on the deciding body. */
  divisive: Float32Array
  /** The option a cautious court takes when the matter is left to it (DEFER_OPTIONS.defer): the least risky. */
  courtPick: Int8Array
  /** 1 where the player left the matter to the deciding body (a deferral; `chosen` is then courtPick). */
  deferred: Uint8Array
  /** lane N3 (throne slice): a kind's detail (Crisis: the event type behind it; Revolt: 1 put down; Opening: 1 a plain weakness;
   * Heir: the law's heir's birth year; -1), the throne HUD row at the decision (count * SEAT_HUD_N floats, sim/history/seat/hud.ts
   * HUD columns; NaN where a system is off), and the house's living heirs then (heirStart ragged: birth year; flags bit 0 a
   * woman, 1 legitimate, 2 the ruler's child). */
  info?: Int32Array
  hud?: Float32Array
  heirStart?: Uint32Array
  heirBorn?: Int32Array
  heirFlags?: Uint8Array
}

/** rulers: deference per polity at the end of the run (rulers/deference.ts). */
export interface DeferenceHistory {
  count: number
  /** Per polity: the value (0 none; SEAT.deferDecline and over: the deciding body rules in all but name) and 1 while in decline. */
  value: Float32Array
  figurehead: Uint8Array
  /** Per polity x cause (DeferenceCause: 0 Player, 1 Minor, 2 Absent, 3 Union, 4 Indolent, 5 Infirm, 6 Captive): the total fed. */
  fed: Float32Array
  causes: number
}

/** seat: (absent when HistoryOptions.seat is undefined). */
export interface SeatHistory {
  seat: SeatOptions
  /** Per year from seat.from to years: the polity the seat held (-1 none): polityAt[y - seat.from]. */
  polityAt: Int32Array
  /** Per year from seat.from to years: the people of the seat (its capital's, or the People seat itself; -1 gone): the fog's knower. */
  peopleAt: Int32Array
  decisions: SeatDecisions
  /** Per AmbitionKind asked (seat.ambitions, in order): the year fulfilled, -1 not (yet). */
  ambitionYear: Int32Array
  /** The year the seat was lost, -1 while held. */
  lostYear: number
}

/**
 * seat: the Choice option indices with a meaning of their own (target row * 8 + index): `defer`, the matter left to the body
 * that decides without the player (the court's own course; "Let ... decide", Esc, a timeout); `reclaim`, the Reclaim option.
 * Both act on the seat's deference (orders/system.ts); every other index is the option's own.
 */
export const DEFER_OPTIONS = { reclaim: 6, defer: 7 } as const

/**
 * The orders of option o of decision d (year d's year + 1), with the Choice record first (actor: the seat's people, target
 * d * 8 + option). `option` DEFER_OPTIONS.defer: the matter left to the deciding body, recorded as a deferral, with the
 * orders of the option a cautious court takes (decisions.courtPick).
 */
export function decisionOrders(h: History, d: number, option: number): Order[] {
  const D = h.seat?.decisions
  if (!D || d < 0 || d >= D.count) return []
  const o0 = D.optStart[d], o1 = D.optStart[d + 1]
  const year = D.year[d] + 1
  const people = h.seat!.peopleAt[D.year[d] - h.seat!.seat.from] ?? -1
  const defer = option === DEFER_OPTIONS.defer
  if (defer) option = D.courtPick[d] // (the matter left to the deciding body: a cautious court's pick, with its orders)
  if (option < 0 || o0 + option >= o1) return []
  if (D.optKey[o0 + option] === SeatOptionKey.Reclaim) return [{ year, kind: OrderKind.Choice, actor: people, target: d * 8 + DEFER_OPTIONS.reclaim }]
  const out: Order[] = [{ year, kind: OrderKind.Choice, actor: people, target: d * 8 + (defer ? DEFER_OPTIONS.defer : option) }]
  const o = o0 + option
  for (let k = D.orderStart[o]; k < D.orderStart[o + 1]; k++) {
    const x: Order = { year, kind: D.orderKind[k] as OrderKind, actor: D.orderActor[k] }
    if (D.orderTarget[k] >= 0) x.target = D.orderTarget[k]
    out.push(x)
  }
  return out
}

const SEAT_KEYS = ['people', 'polity', 'house', 'family', 'person']

/** URL form of a seat: `kind:id:from[:amb=a.b.c]`, e.g. `house:12:1180:amb=0.1`. */
export function encodeSeat(seat: SeatOptions): string {
  const head = `${SEAT_KEYS[seat.kind] ?? String(seat.kind)}:${Math.floor(seat.id)}:${Math.floor(seat.from)}`
  return seat.ambitions && seat.ambitions.length > 0 ? `${head}:amb=${seat.ambitions.map((a) => Math.floor(a)).join('.')}` : head
}

/** Parses encodeSeat text; null when it does not parse (unknown kind, not whole numbers). */
export function decodeSeat(text: string): SeatOptions | null {
  const f = text.trim().split(':')
  const int = /^-?\d+$/
  if (f.length < 3 || f.length > 4 || !int.test(f[1]) || !int.test(f[2])) return null
  const kind = SEAT_KEYS.indexOf(f[0].toLowerCase())
  if (kind < 0 || kind > SeatKind.House) return null // (Family and Person seats are later steps)
  const seat: SeatOptions = { kind: kind as SeatKind, id: Number(f[1]), from: Number(f[2]) }
  if (seat.id < 0 || seat.from < 0) return null
  if (f.length === 4) {
    if (!f[3].startsWith('amb=')) return null
    const a = f[3].slice(4).split('.').filter((x) => /^\d+$/.test(x)).map(Number).filter((x) => x < AMBITION_KIND_COUNT)
    if (a.length > 0) seat.ambitions = [...new Set(a)]
  }
  return seat
}

/** A row of the seat-decision table (seat-mode §3.5 `DecisionKind`), array-indexed by kind. */
export interface DecisionKindInfo {
  kind: number
  /** Short key and label (filled by the owning plan). */
  key: string
  label: string
  /** A reserved placeholder (MASTER-PLAN R40): never triggered. Its owner replaces the row (§8.6). */
  reserved?: true
  /** The plan and the name it reserves the row for (registry §3.2), on reserved rows only. */
  reservedFor?: string
}

/** The reserved decision-kind rows 0–54 by owner and planned name (MASTER-PLAN §3.2). */
const RESERVED_DECISION_KINDS: readonly (readonly [string, readonly string[]])[] = [
  ['court-politics', ['Estates', 'Council', 'Office', 'Plot', 'Reform', 'Regency', 'Exile']], // 18–24
  ['tech-tree', ['BanIdea', 'InviteExperts']], // 25–26
  ['character-mode', ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']], // 27–44
  ['migration', ['Borders', 'Refugees']], // 45–46
  ['modern-ideologies', ['Franchise', 'RevolutionAbroad', 'ArmyDemands']], // 47–49
  ['future-politics', ['Mandate', 'Exit', '']], // 50–52
  ['infrastructure', ['Infrastructure']], // 53
  ['religious-evolution', ['Doctrine']], // 54
]

/** The reserved rows 55–101 (docs/REGISTRY.md): Brink, shadow-network, throne arcs (Lane 3 fills them), battles-fiction. */
const RESERVED_DECISION_KINDS_2: readonly (readonly [string, readonly string[]])[] = [
  ['barriers', ['Brink']], // 55
  ['shadow-network', Array.from({ length: 24 }, () => '')], // 56–79
  ['throne arcs', ['', '', '', '', '', '']], // 80–85
  ['shadow-network', ['NetConfide', 'NetKin', 'NetMarriage', 'NetBooks', 'NetGoOpen', 'NetCrown', 'NetRising', 'NetRestore']], // 86–93
  ['battles-fiction', ['Relief', 'Recall', 'Defector', 'Companies', 'Retreat', 'Stand', 'Gate', 'EmptyWalls']], // 94–101
]

/** Rows in the decision-kind table: 0–112; 0–17 seat-mode's, 18–101 reserved until their owners fill them (R40), 102–112 the surfacing lane's. */
export const DECISION_KIND_COUNT = 113

const DECISION_KINDS: readonly DecisionKindInfo[] = [
  // seat-mode (0–17, §3.5): live rows (the watcher offers those whose order kinds exist; see seat/watch.ts)
  { kind: DecisionKind.WarOnUs, key: 'warOnUs', label: 'War is declared on us' },
  { kind: DecisionKind.Opening, key: 'opening', label: 'A neighbour is weak' },
  { kind: DecisionKind.Heir, key: 'heir', label: 'The succession' },
  { kind: DecisionKind.Crisis, key: 'crisis', label: 'A crisis at court' },
  { kind: DecisionKind.AllianceMade, key: 'allianceMade', label: 'An alliance is made' },
  { kind: DecisionKind.AllianceSought, key: 'allianceSought', label: 'A common enemy' },
  { kind: DecisionKind.Overlord, key: 'overlord', label: 'An overlord' },
  { kind: DecisionKind.Match, key: 'match', label: 'A royal match' },
  { kind: DecisionKind.General, key: 'general', label: 'A popular general' },
  { kind: DecisionKind.Plague, key: 'plague', label: 'Plague' },
  { kind: DecisionKind.Faith, key: 'faith', label: 'A new faith' },
  { kind: DecisionKind.Revolt, key: 'revolt', label: 'Revolt' },
  { kind: DecisionKind.Credit, key: 'credit', label: 'The treasury' },
  { kind: DecisionKind.Charter, key: 'charter', label: 'A town asks for a charter' },
  { kind: DecisionKind.Betrayal, key: 'betrayal', label: 'A separate peace' },
  { kind: DecisionKind.Frontier, key: 'frontier', label: 'News from the frontier' },
  { kind: DecisionKind.Crop, key: 'crop', label: 'A new crop' },
  { kind: DecisionKind.Idea, key: 'idea', label: 'A new idea' },
  // (18–54: reserved placeholders, R40)
  ...reservedRows(18, RESERVED_DECISION_KINDS, (kind, reservedFor): DecisionKindInfo => ({ kind, key: '', label: '', reserved: true, reservedFor })),
  // (55–101: reserved placeholders, docs/REGISTRY.md)
  ...reservedRows(55, RESERVED_DECISION_KINDS_2, (kind, reservedFor): DecisionKindInfo => ({ kind, key: '', label: '', reserved: true, reservedFor })),
  // surfacing (102–112, EVALUATION §4 Lane 1)
  { kind: DecisionKind.Default, key: 'default', label: 'The crown defaults' },
  { kind: DecisionKind.WarChest, key: 'warChest', label: 'The war chest' },
  { kind: DecisionKind.Battle, key: 'battle', label: 'After the battle' },
  { kind: DecisionKind.Bluff, key: 'bluff', label: 'A bluff exposed' },
  { kind: DecisionKind.Intelligence, key: 'intelligence', label: 'An intelligence report' },
  { kind: DecisionKind.Disaster, key: 'disaster', label: 'Disaster' },
  { kind: DecisionKind.AllyCalls, key: 'allyCalls', label: 'An ally calls' },
  { kind: DecisionKind.Betrayed, key: 'betrayed', label: 'Betrayed by an ally' },
  { kind: DecisionKind.Commune, key: 'commune', label: 'A city breaks free' },
  { kind: DecisionKind.ColdWar, key: 'coldWar', label: 'A cold war' },
  { kind: DecisionKind.Houses, key: 'houses', label: 'The merchant houses take sides' },
]

/** The seat-decision kinds (a fresh copy; reserved rows included, flagged). */
export function describeDecisionKinds(): DecisionKindInfo[] {
  return DECISION_KINDS.map((x) => ({ ...x }))
}

/** Orders sorted by year (ties keep their list order): the order the simulation applies them in. A new array of the same objects. */
export function sortOrders(orders: readonly Order[]): Order[] {
  const idx = orders.map((_, i) => i)
  idx.sort((a, b) => (orders[a].year - orders[b].year) || (a - b))
  return idx.map((i) => orders[i])
}

/**
 * Compact URL-safe text of an order list: `year:key:actor[:target]` joined by `;` (e.g. `1500:explore:3:12345;1600:war:7:9`),
 * keys from describeOrderKinds(). The same list (as given, not sorted) always gives the same text; decodeOrders reverses it.
 */
export function encodeOrders(orders: readonly Order[]): string {
  return orders.map((o) => {
    const k = ORDER_KINDS[o.kind]
    const head = `${Math.floor(o.year)}:${k && k.key ? k.key : String(o.kind)}:${Math.floor(o.actor)}`
    return o.target !== undefined && o.target >= 0 ? `${head}:${Math.floor(o.target)}` : head
  }).join(';')
}

/** Parses encodeOrders text; items that do not parse (unknown kind, not whole numbers, a missing target) are skipped. */
export function decodeOrders(text: string): Order[] {
  const out: Order[] = []
  const int = /^-?\d+$/
  for (const item of text.split(';')) {
    const f = item.trim().split(':')
    if (f.length < 3 || f.length > 4 || !int.test(f[0]) || !int.test(f[2]) || (f.length === 4 && !int.test(f[3]))) continue
    const key = f[1].toLowerCase()
    const info = key ? ORDER_KINDS.find((k) => k.key === key && !k.reserved) : undefined
    if (!info) continue
    const o: Order = { year: Number(f[0]), kind: info.kind, actor: Number(f[2]) }
    if (f.length === 4 && info.target !== OrderRole.None) o.target = Number(f[3])
    if (info.target !== OrderRole.None && (o.target === undefined || o.target < 0)) continue
    out.push(o)
  }
  return out
}

/**
 * A cheap check, from a History (one without the order, or with it: they agree before its year), whether `order` could act if
 * given at `year` (judged, as the simulation does, on the world at the end of the year before): OrderReason.None when it might (it may still fail), else why not (the UI greys it out). Checks that the actor and the
 * target exist and live then, and the plain facts (cell already known, species or idea already held, prerequisites, at war or not,
 * town in the realm, a port, a universal faith); not the drives the systems weigh.
 */
export function orderFeasible(h: History, order: Order, year: number): OrderReason {
  const info = ORDER_KINDS[order.kind]
  if (!info) return OrderReason.NoTarget
  if (info.reserved) return OrderReason.SystemOff // (a reserved kind, R40: no plan fills it yet)
  const y = (year < 1 ? 1 : year) - 1 // (an order given at a year acts on the world as it stood at the end of the year before)
  const N = h.capacity.length
  const S = h.settlements.length
  const alive = (id: number): boolean => id >= 0 && id < S && h.settlements[id].foundedYear <= y && (h.settlements[id].abandonedYear < 0 || h.settlements[id].abandonedYear > y)
  const peopleAlive = (p: number): boolean => { for (const x of h.settlements) if (x.people === p && !x.outpost && alive(x.id)) return true; return false }
  const polAlive = (p: number): boolean => p >= 0 && p < h.polities.length && h.polities[p].foundedYear <= y && (h.polities[p].endedYear < 0 || h.polities[p].endedYear > y)
  const capitalAt = (p: number): number => { const P = h.polities[p]; let c = -1; for (let k = 0; k < P.capitals.length && P.capitalYears[k] <= y; k++) c = P.capitals[k]; return c }
  const atWar = (p: number, q: number): boolean => {
    const W = h.wars
    for (let w = 0; w < W.count; w++) if (((W.attacker[w] === p && W.defender[w] === q) || (W.attacker[w] === q && W.defender[w] === p)) && W.startYear[w] <= y && (W.endYear[w] < 0 || W.endYear[w] >= y)) return true
    return false
  }
  const t = order.target ?? -1
  const a = order.actor
  switch (order.kind) {
    case OrderKind.Choice: return OrderReason.None // (a record: always given)
    case OrderKind.Explore: case OrderKind.Settle: {
      if (a < 0 || a >= h.peoples.length || !peopleAlive(a)) return OrderReason.NoActor
      if (t < 0 || t >= N) return OrderReason.NoTarget
      const k = h.knownYear[a * N + t]
      if (order.kind === OrderKind.Explore) return k >= 0 && k <= y ? OrderReason.AlreadyDone : OrderReason.None
      if (!(h.capacity[t] > 0)) return OrderReason.Unfit
      return k >= 0 && k <= y ? OrderReason.None : OrderReason.Unknown
    }
    case OrderKind.Crop: {
      if (a < 0 || a >= h.peoples.length || !peopleAlive(a)) return OrderReason.NoActor
      if (t < 0 || t >= h.species.length) return OrderReason.NoTarget
      const k = h.speciesYear[a * h.species.length + t]
      return k >= 0 && k <= y ? OrderReason.AlreadyDone : OrderReason.None
    }
    case OrderKind.Idea: {
      if (h.ideas.length === 0) return OrderReason.SystemOff
      if (a < 0 || a >= h.peoples.length || !peopleAlive(a)) return OrderReason.NoActor
      if (t < 0 || t >= h.ideas.length || h.ideas[t].technique >= 0) return OrderReason.NoTarget
      const held = ideasHeldAt(h, a, y)
      if (held.indexOf(t) >= 0) return OrderReason.AlreadyDone
      for (const q of h.ideas[t].prerequisites) if (held.indexOf(q) < 0) return OrderReason.Prerequisite
      return OrderReason.None
    }
    case OrderKind.War: case OrderKind.Peace: case OrderKind.Seat: case OrderKind.Faith: {
      if (h.polities.length === 0) return OrderReason.SystemOff
      if (!polAlive(a)) return OrderReason.NoActor
      if (order.kind === OrderKind.Seat) {
        if (!alive(t)) return OrderReason.NoTarget
        if (capitalAt(a) === t) return OrderReason.AlreadyDone
        const q = Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval))
        return h.polity[q * S + t] === a ? OrderReason.None : OrderReason.NotMember
      }
      if (order.kind === OrderKind.Faith) {
        if (h.faiths.length === 0) return OrderReason.SystemOff
        if (t < 0 || t >= h.faiths.length || h.faiths[t].kind !== FaithKind.Universal || h.faiths[t].foundedYear > y) return OrderReason.NoTarget
        return OrderReason.None
      }
      if (t === a || !polAlive(t)) return OrderReason.NoTarget
      const w = atWar(a, t)
      if (order.kind === OrderKind.War) return w ? OrderReason.AlreadyDone : OrderReason.None
      return w ? OrderReason.None : OrderReason.NotAtWar
    }
    // seat-mode's court kinds (given by decision cards, which check them on the simulation's state: orders/system.ts orderCheck)
    case OrderKind.Repudiate: case OrderKind.Defy: case OrderKind.Submit: case OrderKind.Ally: case OrderKind.Marry: case OrderKind.Betray:
    case OrderKind.Designate: case OrderKind.Placate: case OrderKind.Purge: case OrderKind.Borrow: case OrderKind.Levy: {
      if (h.polities.length === 0) return OrderReason.SystemOff
      if (!polAlive(a)) return OrderReason.NoActor
      if (info.target !== OrderRole.Polity || (order.kind === OrderKind.Repudiate && t === a)) return OrderReason.None
      if (t === a || !polAlive(t)) return OrderReason.NoTarget
      if (order.kind === OrderKind.Submit || order.kind === OrderKind.Betray) return atWar(a, t) || order.kind === OrderKind.Betray ? OrderReason.None : OrderReason.NotAtWar
      return OrderReason.None
    }
    case OrderKind.Fortify: case OrderKind.Quarantine: {
      if (!alive(a) || h.settlements[a].outpost) return OrderReason.NoActor
      if (h.polities.length === 0) return OrderReason.SystemOff
      if (order.kind === OrderKind.Fortify) {
        for (const x of h.structures) if (x.type === StructureType.Walls && x.settlement === a && x.builtYear <= y && (x.lostYear < 0 || x.lostYear > y)) return OrderReason.AlreadyDone
        return OrderReason.None
      }
      if (h.diseases.length === 0) return OrderReason.SystemOff
      let port = false
      for (const x of h.structures) if (x.type === StructureType.Port && x.settlement === a && x.builtYear <= y && (x.lostYear < 0 || x.lostYear > y)) port = true
      if (!port) return OrderReason.NotPort
      const Q = h.quarantines
      for (let i = 0; i < Q.settlement.length; i++) if (Q.settlement[i] === a && Q.from[i] <= y && (Q.to[i] < 0 || Q.to[i] > y)) return OrderReason.AlreadyDone
      // (its people must hold the idea of quarantine, and Crafts 3: disease/params.ts QUARANTINE.crafts)
      const p = h.settlements[a].people
      const qi = h.ideas.findIndex((x) => x.key === 'quarantine')
      if (qi >= 0 && ideasHeldAt(h, p, y).indexOf(qi) < 0) return OrderReason.Unskilled
      const sq = Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval))
      if (h.technology[(sq * h.peoples.length + p) * TECH_FIELD_COUNT + TechField.Crafts] < 3) return OrderReason.Unskilled
      return OrderReason.None
    }
  }
  return OrderReason.NoTarget
}

// ---------- disasters: natural shocks and climate regimes (HistoryOptions.disasters; disasters-climate.md) ----------

/** What a History.disasters row is. */
export const DisasterKind = {
  Eruption: 0, // a volcano erupted (VEI >= 5): `size` the VEI, `dT` its peak growing-season cooling (degC, <= 0)
  Earthquake: 1, // `size` the magnitude (Mw, in tenths)
  Tsunami: 2, // a great wave raised by the earthquake in row `cause`; `size` its reach in km
  Flood: 3, // a great river flood in a region; `size` the share of that region's big-river settlements struck
  Drought: 4, // a persistent drought over a weather region; `size` its years (so far, if endYear is -1); a megadrought when >= DX.megaYears
  ColdEpoch: 5, // the world's slow climate turned cold: `dT` the lowest decadal anomaly reached
  WarmEpoch: 6, // ... turned warm: `dT` the highest
} as const
export type DisasterKind = (typeof DisasterKind)[keyof typeof DisasterKind]

/**
 * Natural disasters and climate epochs, struct-of-arrays in order of recording (each row with the year it began; the table of a
 * longer run begins with a shorter one's exactly, though a row still open at the end of the shorter run (endYear -1, a drought's
 * or epoch's size) may be closed in the longer one). Shocks are drawn from the world alone, so the same seed always has the same
 * eruptions, earthquakes, floods and climate, whatever the orders or cradle wishes; what they do depends on who lives there.
 * Eruptions are all listed (VEI >= 5); earthquakes only when they killed someone in a settlement or reached M 8.5.
 */
export interface Disasters {
  count: number
  kind: Uint8Array
  year: Int16Array
  /** Last year of a drought or epoch (-1 while it lasts at the end of the run); the year itself for sudden shocks. */
  endYear: Int16Array
  /** Cell of the volcano, epicentre or flood's largest town; -1 for droughts and epochs. */
  cell: Int32Array
  /** Weather region (History.weatherRegion) for droughts and floods; -1 otherwise. */
  region: Int16Array
  /** VEI, magnitude, reach km, share, or years, by kind (see DisasterKind). */
  size: Float32Array
  /** Peak growing-season temperature anomaly it caused, degC (eruptions, epochs); 0 otherwise. */
  dT: Float32Array
  /** The settlement struck worst (largest loss in people), or -1 if none was struck. */
  settlement: Int32Array
  /** People killed outright (eruption, quake, wave, flood); famine deaths that followed are not counted here. */
  deaths: Float32Array
  /** Settlements that lost people to it outright. */
  struck: Int32Array
  /** Row of the event it followed from (a tsunami's earthquake), or -1. */
  cause: Int32Array
  /** Volcano id of an eruption (-1 otherwise): the same volcano erupts again under the same id. */
  volcano: Int32Array
  /** Volcano's name (eruptions of named volcanoes; '' otherwise). */
  name: string[]
}

/** The world's climate per year (index = year, 0..years), derived from the world alone except `harvest`. */
export interface ClimateSeries {
  /** Global growing-season temperature anomaly, degC (slow regime + volcanic), area mean over the regions. */
  temp: Float32Array
  /** Its volcanic part alone (<= 0). */
  volcanic: Float32Array
  /** Population-weighted mean harvest multiplier (1 = average year). */
  harvest: Float32Array
}
