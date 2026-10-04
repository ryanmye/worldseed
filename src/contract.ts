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
  /** Accumulated wealth per snapshot per settlement, in arbitrary units >= 0, same layout as `population`. */
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
   * same layout as `tradeVolume` (sea lanes struck by pirates, bandit roads). 0 while the route is not open.
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
}

// ---------------------------------------------------------------------------
// renaming: places renamed as a consequence of history.

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
  /** Its settlement's name, or the name of the feature it is on (a summit's range), or ''. */
  name: string
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
  Elected: 2, // chosen by the great men of the realm (an elective throne, a new house raised when the old died out, a league's head)
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
  TermEnded: 8, // a league head's term ran out
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
  /** Ruling house (History.dynasties), -1 for a league's elected head. */
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
 * Mart-to-mart legs of the long-haul trade, struct-of-arrays, in order of first opening. A relay leg follows the
 * settlement links between two marts; a lane is a direct way opened by a trade expedition.
 * Leg k follows cells path[pathOffsets[k] .. pathOffsets[k + 1]) from mart a to mart b.
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
  /** Main class carried a to b and b to a over the run. */
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
export const RevoltCause = { Peasant: 0, Provincial: 1, Ethnic: 2, Colonial: 3, Religious: 4 } as const // (religion: Religious, a ruler of another faith or persecution)
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
}

/** Kinds of bond between two polities (History.bonds). */
export const BondKind = {
  Vassal: 0, // `a` is the vassal of overlord `b`: it keeps its own government, pays part of its revenue, never fights `b`
  Tribute: 1, // `a` pays tribute to `b` for a term of years after a lost war
  Alliance: 2, // `a` and `b` are allies against a common rival (they may come to each other's defence)
} as const
export type BondKind = (typeof BondKind)[keyof typeof BondKind]
/** How a bond ended. */
export const BondEnd = {
  Ongoing: 0,
  Freed: 1, // the vassal or tributary threw it off
  Absorbed: 2, // the vassal was absorbed into its overlord (PolityEnded with PolityEnd.Absorbed)
  Lapsed: 3, // the tribute's term ran out, or the common threat faded, or the allies fell out
  Ended: 4, // one of the two polities ended, or the vassal passed to its overlord's overlord
} as const
export type BondEnd = (typeof BondEnd)[keyof typeof BondEnd]

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
 * Route r follows cells path[pathOffsets[r] .. pathOffsets[r + 1]) from settlement a to settlement b.
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

export interface HistoryOptions {
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
}

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

/** Struct-of-arrays, sorted by departYear. Journey j follows cells path[pathOffsets[j] .. pathOffsets[j + 1]). */
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
