// ideas: constants and the catalogue of ideas (ideas/*.ts; HistoryOptions.ideas).
//
// The catalogue is grounded in the real history of each invention: who had it first (several were invented more than
// once, far apart), what it needed, and how fast it moved. The years below are real-world ones; the sim's own clock runs
// from the first villages (year 0) to about the industrial threshold (year 2000), and nothing is scheduled: an idea is
// conceived where its preconditions are met, by chance, and moves with contact.

import { IdeaKind } from '../../../contract.ts'
import { smoothstep as ss } from '../../util.ts'

/** The species techniques mirrored as ideas (species.ts TQ; not imported, so species.ts can import the ideas hooks: checked by the tests). */
export const TQ_ROTATION = 1, TQ_HEAVY_PLOUGH = 2, TQ_TERRACE = 3, TQ_BREEDING = 8

/** Default of HistoryOptions.ideas. */
export const IDEAS_ON = true

/**
 * Per-people figures the preconditions read (recomputed every IDEA.step years; shares are of the people's population).
 * tier: highest polity tier among its settlements (-1 stateless, 0 chiefdom, 1 kingdom, 2 empire).
 */
export interface IdeaCtx {
  pop: Float64Array
  big: Float64Array
  towns: Float64Array
  cities: Float64Array
  coast: Float64Array
  port: Float64Array
  river: Float64Array
  dry: Float64Array
  dryRiver: Float64Array
  open: Float64Array
  ore: Float64Array
  draught: Float64Array
  horse: Float64Array
  fibre: Float64Array
  trade: Float64Array
  lanes: Float64Array
  tier: Float64Array
  danger: Float64Array
  plague: Float64Array
  crowd: Float64Array
  /** Technology levels this step (Farming, Seafaring, Metalworking, Crafts). */
  farm: Float64Array
  sea: Float64Array
  metal: Float64Array
  crafts: Float64Array
  /** Peoples it is in contact with through neighbours or trade (the right neighbours: crossroads conceive more). */
  met: Float64Array
}

/** Resistance flags of an idea (IdeaDef.resist). */
export const R_FAITH = 1, R_RULER = 2, R_GUILD = 4

export interface IdeaDef {
  key: string
  name: string
  kind: IdeaKind
  /** Keys of the prerequisites. */
  pre: string[]
  /** The species technique (TQ) this idea is, else -1: found and spread by the species system, mirrored here. */
  technique: number
  /** Era 0..4 (the first villages, towns, states, the high middle ages, the early modern centuries): its weight in the general cap (IDEA.eraWeight). */
  era: number
  /** Its own weight in the general cap (times the era's; absent: 1): the plough, bronze, iron and writing counted most. */
  weight?: number
  /** Conceptions per century by a people meeting the preconditions in full (weight 1), times IDEA.conceive. */
  chance: number
  /** Precondition weight 0..1 of people p. */
  cond: (c: IdeaCtx, p: number) => number
  /** Years of a strong link (channel rate 1) a people needs to learn it: copied on sight (5) to generations of teachers (150). */
  teach: number
  /** Share of people p for whom it is of any use (local materials or conditions), 0..1; absent: 1. */
  use?: (c: IdeaCtx, p: number) => number
  /** Chance per century of losing it when small and isolated (or collapsed); 0 never. */
  fragile: number
  /** R_FAITH | R_RULER | R_GUILD: who may refuse it. */
  resist: number
  /** 1 when spies and captured craftsmen can steal it (the Theft channel). */
  theft: number
  /** Contributions to the technology caps (Farming, Seafaring, Metalworking, Crafts), times IDEA.capMul. */
  caps: [number, number, number, number]
  /** Other levers (each a share: 0.1 = 10%): food on dry river land, overland transport (trade reach), sea costs, ship range, war
   * strength, defence of walls, reach of rule (tax and cohesion of large states), crowd-disease toll (negative: less), workshop
   * output, and learning (how fast it learns other ideas). */
  farm?: number
  land?: number
  seaCost?: number
  range?: number
  war?: number
  defence?: number
  admin?: number
  toll?: number
  craft?: number
  learn?: number
  /** Quarantine: lets its ports hold ships in quarantine (the disease system's Quarantine). */
  quarantine?: boolean
  /** Short description for the UI. */
  effect: string
  /** Historical grounding (documentation only). */
  history: string
}

const towns = (c: IdeaCtx, p: number, n: number): number => ss(0, n, c.towns[p])

/**
 * The catalogue (ids are indices; prerequisites always come earlier). Roughly in the order a typical world conceives them:
 * the first villages, the first towns, the first states, the high middle ages, the early modern centuries. caps are absolute
 * additions to the technology caps (times IDEA.capMul), chosen so that a people holding everything conceived by a year sits near
 * the reference curve (PRODUCTIVITY) then; chance is relative (times IDEA.conceive).
 */
export const IDEA_DEFS: IdeaDef[] = [
  // --- The first villages ---
  {
    key: 'pottery', name: 'pottery', kind: IdeaKind.Crafts, pre: [], technique: -1, era: 0, weight: 0.4, chance: 5,
    cond: (c, p) => ss(200, 800, c.big[p]), teach: 15, fragile: 0.4, resist: 0, theft: 0,
    caps: [0.04, 0, 0.02, 0.12], craft: 0.03, effect: 'storage and cooking; Crafts, Farming',
    history: 'Fired clay vessels arose independently in Jomon Japan and China (c. 16000-14000 BCE), in the Sahara and Near East (c. 9000-7000 BCE) and the Americas; Tasmanians and some Polynesians lost it.',
  },
  {
    key: 'sail', name: 'the sail', kind: IdeaKind.Seafaring, pre: [], technique: -1, era: 0, weight: 0.6, chance: 2,
    cond: (c, p) => ss(0.05, 0.4, c.coast[p] + 0.5 * c.river[p]) * ss(300, 1500, c.pop[p]), teach: 15, fragile: 0.3, resist: 0, theft: 0,
    use: (c, p) => ss(0, 0.2, c.coast[p] + 0.5 * c.river[p]), caps: [0, 0.3, 0, 0.02], seaCost: 0.06, range: 0.05,
    effect: 'Seafaring, sea costs, range',
    history: 'Sails drove Nile boats by c. 3200 BCE and Austronesian outriggers later; Mesoamerica had none until Europeans came.',
  },
  {
    key: 'ard', name: 'the plough', kind: IdeaKind.Farming, pre: [], technique: -1, era: 0, weight: 1.6, chance: 0.8,
    cond: (c, p) => c.draught[p] * ss(500, 2500, c.pop[p]), teach: 15, fragile: 0.2, resist: 0, theft: 0,
    use: (c, p) => c.draught[p], caps: [0.3, 0, 0.02, 0], effect: 'Farming (needs draught animals)',
    history: 'The ard was drawn by oxen in Mesopotamia by c. 4000 BCE and spread across Eurasia and North Africa; without draught animals the Americas never used it.',
  },
  {
    key: 'loom', name: 'the loom', kind: IdeaKind.Crafts, pre: [], technique: -1, era: 0, weight: 0.5, chance: 1.2,
    cond: (c, p) => c.fibre[p] * ss(400, 2000, c.big[p]), teach: 20, fragile: 0.3, resist: 0, theft: 0,
    caps: [0, 0, 0, 0.1], craft: 0.06, effect: 'cloth workshops; Crafts',
    history: 'Warp-weighted and backstrap looms are Neolithic; the treadle loom came from China to Europe by the 11th century.',
  },
  {
    key: 'irrigation', name: 'canal irrigation', kind: IdeaKind.Farming, pre: [], technique: -1, era: 0, weight: 1.3, chance: 0.8,
    cond: (c, p) => ss(0.02, 0.15, c.dryRiver[p]) * ss(800, 3000, c.pop[p]), teach: 25, fragile: 0.3, resist: 0, theft: 0,
    use: (c, p) => ss(0, 0.15, c.dryRiver[p] + 0.3 * c.dry[p]), caps: [0.2, 0, 0, 0.02], farm: 0.15,
    effect: 'food on dry river land (+15%); Farming',
    history: 'Canals fed the fields of Mesopotamia (c. 6000 BCE), Egypt, the Indus, the Yellow River and coastal Peru, each worked out apart where dry plains met great rivers.',
  },
  {
    key: 'calendar', name: 'the calendar', kind: IdeaKind.Knowledge, pre: [], technique: -1, era: 0, weight: 0.6, chance: 1,
    cond: (c, p) => ss(1500, 6000, c.pop[p]) * ss(800, 3000, c.big[p]), teach: 40, fragile: 0.2, resist: 0, theft: 0,
    caps: [0.04, 0.05, 0, 0.04], learn: 0.05, effect: 'the farming year and the stars; Farming, Seafaring',
    history: 'Egyptian, Babylonian, Chinese and Maya calendars were each worked out by watching the sky over the farming year.',
  },
  {
    key: 'bronze', name: 'bronze', kind: IdeaKind.Crafts, pre: ['pottery'], technique: -1, era: 0, weight: 1.6, chance: 0.5,
    cond: (c, p) => ss(0.05, 0.4, c.ore[p]) * ss(1000, 4000, c.pop[p]), teach: 40, fragile: 0.5, resist: 0, theft: 1,
    use: (c, p) => 0.5 + 0.5 * ss(0, 0.3, c.ore[p] + 0.2 * c.lanes[p]), caps: [0.03, 0.02, 0.35, 0.08], war: 0.06,
    effect: 'Metalworking, war; needs tin and copper',
    history: 'Arsenical then tin bronze in the Near East (c. 3300 BCE), China (c. 2000 BCE) and the Andes; when tin trade failed after 1200 BCE bronze-working towns fell back.',
  },
  {
    key: 'wheel', name: 'the wheel', kind: IdeaKind.Transport, pre: [], technique: -1, era: 0, weight: 1.2, chance: 0.4,
    cond: (c, p) => c.draught[p] * ss(1500, 6000, c.pop[p]) * (0.4 + 0.6 * ss(0.1, 0.5, c.open[p])), teach: 12, fragile: 0.2, resist: 0, theft: 0,
    use: (c, p) => 0.1 + 0.9 * c.draught[p], caps: [0.04, 0, 0.04, 0.1], land: 0.12,
    effect: 'carts: overland trade reach; Crafts (little use without draught animals)',
    history: 'Wheeled carts appear around 3500 BCE from Mesopotamia to the Pontic steppe and spread within a few centuries; Mesoamericans put wheels on toys only, having no draught animals.',
  },
  // --- The first towns ---
  {
    key: 'riding', name: 'horse riding', kind: IdeaKind.War, pre: [], technique: -1, era: 1, weight: 0.7, chance: 1,
    cond: (c, p) => c.horse[p] * ss(0.1, 0.5, c.open[p]), teach: 20, fragile: 0.1, resist: 0, theft: 0,
    use: (c, p) => c.horse[p], caps: [0.02, 0, 0, 0.02], war: 0.07, land: 0.05, effect: 'cavalry and couriers (needs horses)',
    history: 'Riding began on the Eurasian steppe (c. 3500 BCE, Botai and after); horsemen carried it wherever horses went.',
  },
  {
    key: 'potterWheel', name: "the potter's wheel", kind: IdeaKind.Crafts, pre: ['pottery'], technique: -1, era: 1, weight: 0.7, chance: 0.8,
    cond: (c, p) => towns(c, p, 1) * ss(1500, 4000, c.big[p]), teach: 20, fragile: 0.3, resist: 0, theft: 0,
    caps: [0, 0, 0, 0.08], craft: 0.05, effect: 'workshop output; Crafts',
    history: 'Mesopotamia c. 4500-3500 BCE, then Egypt, the Indus and China; unknown in the pre-Columbian Americas.',
  },
  {
    key: 'iron', name: 'iron smelting', kind: IdeaKind.Crafts, pre: ['pottery'], technique: -1, era: 1, weight: 1.6, chance: 0.35,
    cond: (c, p) => ss(0.05, 0.4, c.ore[p]) * ss(1.2, 1.45, c.metal[p]) * ss(2000, 8000, c.pop[p]), teach: 50, fragile: 0.3, resist: 0, theft: 1,
    caps: [0.2, 0.02, 0.45, 0.06], war: 0.1, effect: 'iron tools and arms; Metalworking, Farming, war',
    history: 'Smelted in Anatolia and the Levant by 1200 BCE, perhaps independently in West Africa (Nok, c. 900 BCE); China cast it by 500 BCE. Smiths kept the craft close and it spread with them.',
  },
  {
    key: 'writing', name: 'writing', kind: IdeaKind.Administration, pre: ['calendar'], technique: -1, era: 1, weight: 1.5, chance: 0.4,
    cond: (c, p) => towns(c, p, 2) * (0.3 + 0.7 * ss(-1, 1, c.tier[p])) * ss(50, 400, c.trade[p] + c.big[p] / 50), teach: 150, fragile: 0.5, resist: 0, theft: 0,
    caps: [0.05, 0.05, 0.05, 0.15], admin: 0.15, learn: 0.2, effect: 'records, accounts, rule at a distance; learning; Crafts',
    history: 'Invented at least four times: Sumer (c. 3200 BCE), Egypt, China (c. 1200 BCE) and Mesoamerica (c. 600 BCE). It took scribes schooled for years; Mycenaean Greece lost Linear B in its collapse.',
  },
  {
    key: 'keel', name: 'the keeled ship', kind: IdeaKind.Seafaring, pre: ['sail'], technique: -1, era: 1, chance: 0.5,
    cond: (c, p) => ss(0.02, 0.2, c.port[p]) * ss(1.2, 1.4, c.sea[p]), teach: 30, fragile: 0.3, resist: 0, theft: 0,
    use: (c, p) => ss(0, 0.15, c.port[p] + 0.3 * c.coast[p]), caps: [0, 0.45, 0.02, 0.02], seaCost: 0.1, range: 0.1,
    effect: 'sea costs, range; Seafaring',
    history: 'Planked keeled hulls carried Bronze Age trade (the Uluburun wreck, c. 1300 BCE); Norse keels opened the North Atlantic.',
  },
  {
    key: 'coinage', name: 'coinage', kind: IdeaKind.Administration, pre: ['bronze'], technique: -1, era: 1, chance: 0.5,
    cond: (c, p) => ss(150, 800, c.trade[p]) * ss(-1, 1, c.tier[p]), teach: 15, fragile: 0.2, resist: 0, theft: 0,
    caps: [0, 0, 0.05, 0.08], land: 0.05, admin: 0.06, effect: 'cheaper trade, taxes; Crafts',
    history: 'Lydia struck electrum coins c. 630 BCE and China its spade money about then, independently; coins spread with every army and merchant within two centuries.',
  },
  {
    key: 'chariot', name: 'the chariot', kind: IdeaKind.War, pre: ['wheel', 'bronze'], technique: -1, era: 1, chance: 0.8,
    cond: (c, p) => c.horse[p] * ss(-1, 0.5, c.tier[p]), teach: 20, fragile: 0.3, resist: 0, theft: 1,
    use: (c, p) => c.horse[p], caps: [0, 0, 0.04, 0.02], war: 0.08, effect: 'war (needs horses)',
    history: 'Spoked-wheel chariots at Sintashta (c. 2000 BCE) reached Egypt, India and Shang China within a few centuries.',
  },
  {
    key: 'watermill', name: 'the watermill', kind: IdeaKind.Farming, pre: ['wheel'], technique: -1, era: 1, chance: 0.5,
    cond: (c, p) => ss(0.05, 0.3, c.river[p]) * towns(c, p, 1) * ss(1.3, 1.6, c.crafts[p]), teach: 25, fragile: 0.2, resist: 0, theft: 0,
    use: (c, p) => ss(0, 0.2, c.river[p]), caps: [0.16, 0, 0.04, 0.1], craft: 0.05, effect: 'milling and power; Farming, Crafts (on rivers)',
    history: 'Greek mills of the 3rd century BCE and Han China\'s; by the Domesday survey (1086) England had some 5,600.',
  },
  {
    key: 'collar', name: 'the horse collar', kind: IdeaKind.Transport, pre: ['ard'], technique: -1, era: 1, chance: 0.4,
    cond: (c, p) => c.horse[p] * ss(1.4, 1.7, c.farm[p]), teach: 12, fragile: 0.1, resist: 0, theft: 0,
    use: (c, p) => c.horse[p], caps: [0.18, 0, 0, 0.02], land: 0.08, effect: 'horses at the plough and cart; Farming, overland trade (needs horses)',
    history: 'The padded collar of 5th-century China reached Europe by the 10th, letting horses plough and haul at full strength.',
  },
  {
    key: 'alphabet', name: 'the alphabet', kind: IdeaKind.Knowledge, pre: ['writing'], technique: -1, era: 1, chance: 0.5,
    cond: (c, p) => ss(100, 600, c.trade[p]) * ss(0.05, 0.3, c.coast[p] + c.lanes[p] * 0.1), teach: 25, fragile: 0.2, resist: 0, theft: 0,
    caps: [0, 0.04, 0, 0.06], admin: 0.05, learn: 0.15, effect: 'writing for merchants: learning, rule',
    history: 'The Phoenicians\' merchants carried their 22 letters (c. 1050 BCE) to the Greeks, Etruscans and Aramaeans; few scripts were ever invented again.',
  },
  {
    key: 'glass', name: 'glass', kind: IdeaKind.Crafts, pre: ['potterWheel'], technique: -1, era: 1, chance: 0.5,
    cond: (c, p) => towns(c, p, 2) * ss(1.35, 1.6, c.crafts[p]), teach: 60, fragile: 0.4, resist: 0, theft: 1,
    caps: [0, 0.02, 0.02, 0.05], craft: 0.04, effect: 'workshop output; Crafts',
    history: 'Glass beads in Mesopotamia c. 2500 BCE; glassblowing in Syria (1st century BCE) spread through the Roman world; Venice later guarded its Murano secrets.',
  },
  // --- The first states ---
  {
    key: 'lawCode', name: 'law codes', kind: IdeaKind.Administration, pre: ['writing'], technique: -1, era: 2, chance: 0.6,
    cond: (c, p) => ss(0, 1, c.tier[p]) * towns(c, p, 3), teach: 60, fragile: 0.3, resist: 0, theft: 0,
    caps: [0.02, 0, 0, 0.04], admin: 0.12, effect: 'cohesion and reach of large states (+12%)',
    history: 'Ur-Nammu (c. 2100 BCE) and Hammurabi (c. 1754 BCE); Roman, Chinese and Indian codes followed their states.',
  },
  {
    key: 'roads', name: 'paved roads', kind: IdeaKind.Transport, pre: [], technique: -1, era: 2, chance: 0.4,
    cond: (c, p) => ss(0, 1.5, c.tier[p]) * ss(8000, 40000, c.pop[p]), teach: 50, fragile: 0.2, resist: 0, theft: 0,
    caps: [0.03, 0, 0, 0.06], land: 0.12, admin: 0.05, effect: 'overland trade reach, rule at a distance',
    history: 'Persia\'s Royal Road, Rome\'s viae and the Inca qhapaq nan (built without the wheel) were each the work of large states.',
  },
  {
    key: 'fortification', name: 'fortification', kind: IdeaKind.War, pre: [], technique: -1, era: 2, chance: 0.6,
    cond: (c, p) => towns(c, p, 1) * ss(0.05, 0.4, c.danger[p]), teach: 30, fragile: 0.1, resist: 0, theft: 0,
    caps: [0, 0, 0.04, 0.08], defence: 0.15, effect: 'walls hold out longer (+15%); Crafts',
    history: 'Walls ring Jericho and Uruk; the angled bastion (trace italienne, c. 1500 CE) answered the cannon and spread across Europe within a century.',
  },
  {
    key: 'mathematics', name: 'positional numbers', kind: IdeaKind.Knowledge, pre: ['writing'], technique: -1, era: 2, chance: 0.4,
    cond: (c, p) => ss(0, 1, c.cities[p]) * ss(1.5, 1.9, c.crafts[p]), teach: 120, fragile: 0.3, resist: R_GUILD, theft: 0,
    use: (c, p) => ss(0, 2, c.cities[p]), caps: [0.04, 0.1, 0.06, 0.16], learn: 0.1, effect: 'reckoning: learning; Crafts, Seafaring',
    history: 'Indian numerals with zero (by c. 500 CE) reached Baghdad by 825 (al-Khwarizmi) and Europe with Fibonacci (1202); Florence\'s money-changers banned them from account books in 1299, and they were in wide use only by 1500.',
  },
  {
    key: 'stirrup', name: 'the stirrup', kind: IdeaKind.War, pre: ['riding'], technique: -1, era: 2, chance: 0.4,
    cond: (c, p) => c.horse[p] * ss(0.05, 0.3, c.danger[p]) * ss(1.3, 1.6, c.metal[p]), teach: 5, fragile: 0.1, resist: 0, theft: 0,
    use: (c, p) => c.horse[p], caps: [0, 0, 0.04, 0], war: 0.1, effect: 'heavy cavalry (+10% war); copied on sight',
    history: 'Paired stirrups in China c. 322 CE; Avar horsemen brought them to Europe by the 8th century, copied wherever they were seen.',
  },
  {
    key: 'paper', name: 'paper', kind: IdeaKind.Crafts, pre: ['writing'], technique: -1, era: 2, chance: 0.4,
    cond: (c, p) => c.fibre[p] * towns(c, p, 3) * ss(1.6, 2.0, c.crafts[p]), teach: 80, fragile: 0.2, resist: 0, theft: 1,
    caps: [0, 0, 0, 0.1], admin: 0.06, craft: 0.03, learn: 0.1, effect: 'cheap records: rule, learning; Crafts',
    history: 'Cai Lun\'s paper (105 CE) stayed Chinese for six centuries; papermakers taken at Talas (751) brought it to Samarkand, then Baghdad (794), Spain (c. 1150) and Italy (1276).',
  },
  {
    key: 'terrace', name: 'terracing', kind: IdeaKind.Farming, pre: [], technique: TQ_TERRACE, era: 2, chance: 0,
    cond: () => 0, teach: 30, fragile: 0, resist: 0, theft: 0, caps: [0.12, 0, 0, 0.02],
    effect: 'hill fields (species technique); Farming',
    history: 'Built independently in the Andes, Southeast Asia, the Mediterranean and Ethiopia where crowded people farmed hills.',
  },
  {
    key: 'castIron', name: 'the blast furnace', kind: IdeaKind.Crafts, pre: ['iron'], technique: -1, era: 2, chance: 0.3,
    cond: (c, p) => ss(0, 1, c.cities[p]) * ss(1.7, 2.1, c.metal[p]), teach: 100, fragile: 0.2, resist: 0, theft: 1,
    caps: [0.1, 0, 0.4, 0.06], war: 0.05, craft: 0.04, effect: 'cast iron: Metalworking, tools',
    history: 'Chinese furnaces cast iron by the 5th century BCE; Europe\'s first blast furnaces (Sweden, the Rhineland) date from c. 1150-1350 CE.',
  },
  // --- The high middle ages ---
  {
    key: 'windmill', name: 'the windmill', kind: IdeaKind.Farming, pre: ['watermill'], technique: -1, era: 3, chance: 0.4,
    cond: (c, p) => ss(0.1, 0.4, c.dry[p] + c.open[p] * 0.5) * towns(c, p, 2), teach: 20, fragile: 0.1, resist: 0, theft: 0,
    caps: [0.14, 0, 0, 0.06], craft: 0.03, effect: 'power where rivers are few; Farming, Crafts',
    history: 'Persian windmills of Sistan (9th century) and the post mills of 12th-century England and Flanders.',
  },
  {
    key: 'heavyPlough', name: 'the heavy plough', kind: IdeaKind.Farming, pre: [], technique: TQ_HEAVY_PLOUGH, era: 3, chance: 0,
    cond: () => 0, teach: 40, fragile: 0, resist: 0, theft: 0, caps: [0.2, 0, 0.04, 0],
    effect: 'wet clay soils (species technique); Farming',
    history: 'The wheeled mouldboard plough turned the heavy clays of northern Europe (Slavic lands by the 6th century, the Rhineland and England by the 10th); useless on light soils.',
  },
  {
    key: 'lateen', name: 'the lateen sail', kind: IdeaKind.Seafaring, pre: ['sail'], technique: -1, era: 3, chance: 0.4,
    cond: (c, p) => ss(0.05, 0.3, c.port[p]) * ss(100, 600, c.trade[p]), teach: 8, fragile: 0.1, resist: 0, theft: 0,
    use: (c, p) => ss(0, 0.15, c.port[p] + 0.3 * c.coast[p]), caps: [0, 0.25, 0, 0], seaCost: 0.05, effect: 'sailing into the wind: sea costs',
    history: 'Rigged in the Indian Ocean and the eastern Mediterranean by late antiquity, taken up by every Mediterranean shipwright.',
  },
  {
    key: 'rudder', name: 'the stern rudder', kind: IdeaKind.Seafaring, pre: ['keel'], technique: -1, era: 3, chance: 0.4,
    cond: (c, p) => ss(0.05, 0.3, c.port[p]) * ss(1.5, 1.8, c.sea[p]), teach: 15, fragile: 0.1, resist: 0, theft: 0,
    use: (c, p) => ss(0, 0.15, c.port[p] + 0.3 * c.coast[p]), caps: [0, 0.25, 0, 0], seaCost: 0.05, range: 0.05,
    effect: 'bigger ships: sea costs, range',
    history: 'Han Chinese junks steered by stern rudders in the 1st century CE; they appear in Europe c. 1180.',
  },
  {
    key: 'compass', name: 'the compass', kind: IdeaKind.Seafaring, pre: ['iron', 'sail'], technique: -1, era: 3, chance: 0.25,
    cond: (c, p) => ss(0.05, 0.3, c.port[p]) * ss(1.7, 2.1, c.sea[p]) * ss(1.6, 2.0, c.metal[p]), teach: 6, fragile: 0.1, resist: 0, theft: 0,
    use: (c, p) => ss(0, 0.1, c.port[p]), caps: [0, 0.4, 0.02, 0], range: 0.15, seaCost: 0.06, effect: 'open-sea range (+15%); copied on sight by seafarers',
    history: 'Described by Shen Kuo (1088) and in use on Chinese ships by 1117; in Europe by Neckam\'s day (c. 1190) and among Arab pilots by 1232. It was of use only to those who sailed out of sight of land.',
  },
  {
    key: 'spinningWheel', name: 'the spinning wheel', kind: IdeaKind.Crafts, pre: ['loom'], technique: -1, era: 3, chance: 0.4,
    cond: (c, p) => c.fibre[p] * towns(c, p, 2) * ss(1.5, 1.9, c.crafts[p]), teach: 15, fragile: 0.1, resist: 0, theft: 0,
    caps: [0.02, 0, 0, 0.08], craft: 0.06, effect: 'yarn for the looms: workshop output; Crafts',
    history: 'Spun in India by c. 500-1000 CE, in Baghdad by the 13th century and in Europe by c. 1280 (the Speyer guild rules of 1280).',
  },
  {
    key: 'cartography', name: 'cartography', kind: IdeaKind.Knowledge, pre: ['writing', 'mathematics'], technique: -1, era: 3, chance: 0.4,
    cond: (c, p) => ss(0, 2, c.lanes[p] + c.port[p] * 5) * ss(1.6, 2.0, c.sea[p] + 0.2 * c.crafts[p]), teach: 40, fragile: 0.2, resist: 0, theft: 1,
    caps: [0, 0.2, 0, 0.06], range: 0.05, effect: 'charts: range; Seafaring',
    history: 'Ptolemy\'s Geography, Pei Xiu\'s grids (3rd century) and the portolan charts of 13th-century Genoa and Majorca.',
  },
  {
    key: 'clock', name: 'the mechanical clock', kind: IdeaKind.Knowledge, pre: ['watermill', 'mathematics'], technique: -1, era: 3, chance: 0.3,
    cond: (c, p) => ss(0, 2, c.cities[p]) * ss(2.0, 2.5, c.crafts[p]), teach: 40, fragile: 0.1, resist: 0, theft: 0,
    use: (c, p) => ss(0, 2, c.cities[p]), caps: [0, 0.15, 0.12, 0.35], learn: 0.05, effect: 'gearing and time: Crafts, Metalworking, Seafaring',
    history: 'Su Song\'s astronomical clock tower (1088) stood alone; Europe\'s verge-and-foliot clocks (c. 1280-1300) filled every town square within a century.',
  },
  {
    key: 'quarantine', name: 'quarantine', kind: IdeaKind.Health, pre: ['lawCode'], technique: -1, era: 3, chance: 0.4,
    cond: (c, p) => c.plague[p] * ss(0.02, 0.2, c.port[p]) * ss(0, 1, c.tier[p]), teach: 20, fragile: 0.2, resist: 0, theft: 0,
    use: (c, p) => ss(0, 0.1, c.port[p]), caps: [0, 0, 0, 0.02], quarantine: true, effect: 'ports may hold ships in quarantine',
    history: 'Ragusa (1377) and Venice (1423, the lazaretto) held ships forty days after the Black Death; Mediterranean ports copied them.',
  },
  // --- The early modern centuries ---
  {
    key: 'banking', name: 'bills of exchange', kind: IdeaKind.Administration, pre: ['coinage', 'mathematics'], technique: -1, era: 4, chance: 0.3,
    cond: (c, p) => ss(0, 2, c.lanes[p]) * ss(400, 2000, c.trade[p]) * ss(0, 2, c.cities[p]), teach: 60, fragile: 0.2, resist: R_FAITH, theft: 0,
    use: (c, p) => ss(0, 3, c.cities[p] + c.lanes[p]), caps: [0, 0.06, 0, 0.6], land: 0.06, seaCost: 0.04, admin: 0.05, effect: 'credit for long-haul trade: trade costs, Crafts',
    history: 'The Islamic suftaja and Tang China\'s flying money (9th century); Genoese and Florentine bills of exchange from the 12th-13th centuries, slowed where usury was condemned.',
  },
  {
    key: 'gunpowder', name: 'gunpowder', kind: IdeaKind.War, pre: ['iron', 'writing'], technique: -1, era: 4, chance: 0.2,
    cond: (c, p) => ss(0, 1, c.cities[p]) * ss(2.0, 2.5, c.crafts[p]) * ss(1.9, 2.3, c.metal[p]), teach: 40, fragile: 0.1, resist: R_RULER, theft: 1,
    caps: [0, 0.04, 0.35, 0.06], war: 0.3, effect: 'firearms (+30% war); Metalworking',
    history: 'Chinese alchemists\' mixture (9th century) became fire-lances and bombs; the Mongol conquests carried it west, and Europe had cannon by the 1320s. Tokugawa Japan later all but gave up the gun.',
  },
  {
    key: 'printing', name: 'printing', kind: IdeaKind.Knowledge, pre: ['paper', 'writing'], technique: -1, era: 4, chance: 0.2,
    cond: (c, p) => ss(0, 2, c.cities[p]) * ss(2.2, 2.7, c.crafts[p]), teach: 30, fragile: 0.1, resist: R_FAITH | R_GUILD, theft: 0,
    use: (c, p) => ss(0, 3, c.cities[p]), caps: [0, 0.06, 0.1, 0.85], admin: 0.05, learn: 0.35, effect: 'books: learning (ideas travel faster), Crafts',
    history: 'Block printing in Tang China, movable type by Bi Sheng (c. 1040); Gutenberg\'s press (c. 1450) reached some 270 European towns by 1500, while Ottoman scribes and clergy kept it out until 1727.',
  },
  {
    key: 'navigation', name: 'celestial navigation', kind: IdeaKind.Seafaring, pre: ['keel', 'mathematics'], technique: -1, era: 4, chance: 0.25,
    cond: (c, p) => ss(0.05, 0.3, c.port[p]) * ss(2.0, 2.5, c.sea[p]), teach: 100, fragile: 0.2, resist: 0, theft: 0,
    use: (c, p) => ss(0, 0.1, c.port[p]), caps: [0, 0.9, 0, 0], range: 0.2, effect: 'ocean range (+20%); Seafaring',
    history: 'Polynesian wayfinders read stars and swells; the astrolabe and quadrant let 15th-century Portuguese pilots find their latitude, a skill taught in schools for years.',
  },
  {
    key: 'rotation', name: 'crop rotation', kind: IdeaKind.Farming, pre: [], technique: TQ_ROTATION, era: 4, chance: 0,
    cond: () => 0, teach: 40, fragile: 0, resist: 0, theft: 0, caps: [0.2, 0, 0, 0],
    effect: 'cereal and legume in turn (species technique); Farming',
    history: 'Legume rotations in Han China and Rome; the three-field system spread across Carolingian Europe in the 8th-9th centuries, the Norfolk four-course in the 18th.',
  },
  {
    key: 'breeding', name: 'selective breeding', kind: IdeaKind.Farming, pre: [], technique: TQ_BREEDING, era: 4, chance: 0,
    cond: () => 0, teach: 40, fragile: 0, resist: 0, theft: 0, caps: [0.15, 0, 0, 0.02],
    effect: 'better herds (species technique); Farming',
    history: 'Bred stock from Roman agronomists to Bakewell\'s Leicester sheep (1760s); herders everywhere kept their best.',
  },
  {
    key: 'drainage', name: 'field drainage', kind: IdeaKind.Farming, pre: ['windmill'], technique: -1, era: 4, chance: 0.3,
    cond: (c, p) => ss(0.05, 0.3, c.river[p] + c.coast[p] * 0.5) * ss(0, 2, c.cities[p]) * ss(1.9, 2.4, c.farm[p]), teach: 50, fragile: 0.1, resist: 0, theft: 0,
    caps: [0.32, 0, 0, 0.04], effect: 'wet lowlands won for the plough; Farming',
    history: 'Dutch polders pumped by windmills (15th-17th centuries), the draining of the Fens (1630s) and the embanked fields of the Yangzi delta.',
  },
  {
    key: 'inoculation', name: 'inoculation', kind: IdeaKind.Health, pre: ['writing'], technique: -1, era: 4, chance: 0.2,
    cond: (c, p) => c.crowd[p] * ss(0, 2, c.cities[p]) * ss(2.2, 2.7, c.crafts[p]), teach: 40, fragile: 0.1, resist: R_FAITH, theft: 0,
    caps: [0, 0, 0, 0.03], toll: -0.4, effect: 'crowd diseases take 40% fewer',
    history: 'Variolation in China (16th century), India and the Ottoman lands; Lady Montagu brought it to England in 1721 against clerical objection.',
  },
  {
    key: 'science', name: 'the experimental method', kind: IdeaKind.Knowledge, pre: ['printing', 'mathematics'], technique: -1, era: 4, chance: 0.2,
    cond: (c, p) => ss(1, 4, c.cities[p]) * ss(2.6, 3.2, c.crafts[p]), teach: 60, fragile: 0.1, resist: R_FAITH, theft: 0,
    use: (c, p) => ss(0, 4, c.cities[p]), caps: [0.15, 0.25, 0.5, 0.7], learn: 0.3, effect: 'organised discovery: learning, every field',
    history: 'Ibn al-Haytham\'s optics (11th century) and Bacon, Galileo and the Royal Society (1660) in the age of print; their journals carried it.',
  },
]

/** Contract ease of an idea: 10 / (10 + teach). */
export function easeOf(d: IdeaDef): number {
  return 10 / (10 + d.teach)
}

/**
 * Rules. Every IDEA.step years (in years with year % step === 0, before the technology system):
 *
 * Conception: a people that holds an idea's prerequisites and is not in contact with any living people holding it conceives it
 * with chance conceive * chance / 100 * step * cond * (1 + mix * min(mixMax, met)) / (1 + cardwell * r) (r: the ideas it conceived
 * lately, decaying by cardDecay a year; Cardwell's law: no people stays the most inventive for long) * (1 + combo * ideas held)
 * * sqrt(pop / popRef) (ideas beget ideas, more people more ideas) at its largest settlement that meets the idea's local
 * condition (its largest otherwise). A people in contact with a holder learns it instead (below), so most peoples originate
 * few of the ideas they hold; one isolated from every holder may conceive it again (an independent origin).
 *
 * Learning: a people q not holding an idea whose prerequisites it holds, and for which it has some use, learns it from the
 * living peoples h holding it that it has met: its progress grows by sum_h (step * R(q, h) + pulses) * back(q, h) * learn / teach
 * (back: 1 + backward * (x - 1) when h's summed technology is x > 1 times q's: the advantage of backwardness; learn: 1 + the learn of its ideas), R the
 * sum of the channel rates below (each times its knob in CH), pulses those of the year's events; with no exposure it forgets
 * (progress * (1 - forget * step)). From progress 1 it takes it up with chance adopt * use each step, times (1 - resistance):
 * a draw that resistance alone turned down is logged as IdeaResisted (once until the idea is taken up).
 *   Contact: met at all; Neighbours: settlements of the two have seen each other;
 *   Trade: v / (v + tradeHalf) of their smoothed trade volume v (technology.ts pairVol); Lane: lv / (lv + laneHalf) of the
 *   smoothed volume of the long-haul legs between their marts; Post: posts of one hosted by the other (at most postMax);
 *   Empire: both at least POLITY.multiShare of one polity's members (min share / 0.15, at most 1);
 *   Pilgrims: q's universal faith has its holy city among h, x / (x + pilgrimHalf) of its pilgrims' income, plus clergy (faith)
 *   when both follow one universal faith; Visitors: q's visitors to h's towns, x / (x + visitorHalf);
 *   Theft (ideas with theft): q a kingdom or empire, twice at war with h.
 *   Pulses (events): Migration (migrants of h joining a town of q: size / (size + migHalf)), Conquest (a town of one taken by an army of
 *   the other: both ways), Marriage (a royal marriage between their houses: both ways).
 * The adoption's how is a channel drawn in proportion to the progress each carried; from the holder met that carries most on it
 * then (else the strongest source); via the settlement of q through which that channel ran (its largest if none of its own is known).
 *
 * Resistance (ideas with resist flags): faith = faithResist * zeal of q's universal faith; ruler = rulerResist * (1 - tolerance) *
 * (warlike ideas: 1 - warlike; others: piety) of the ruler of q's largest settlement's polity; guild = guildResist * n / (n + 1), n the
 * renowned craft traditions of q; combined 1 - prod(1 - r).
 *
 * Loss (ideas with fragile > 0, not techniques): chance IDEA.fragile * fragile / 100 * step * (small + collapse) / (1 + support / supportHalf),
 * small = 1 - smoothstep(lossLow, lossHigh, pop), collapse = collapseMul when pop < collapseShare * peak (peak: the highest
 * population, falling by peakDecay a year), support the sum of R over the holders q has met. Ideas resting on a lost one go too.
 *
 * Effects (each held idea times useFloor + (1 - useFloor) * use, use the most it has had since taken up): the technology caps 1 + capBase + capMul * sum of caps + general * sqrt(sum of eraWeight[era]);
 * the levers as multipliers 1 + lever * sum of the shares (toll 1 + sum, at least tollMin; farm per settlement). The technology system slows growth above the
 * cap: practice * growth / (1 + ((L - C) / soft)^2) (below it practice * growth + catchUp * (C - L)), gains by diffusion at most up to C + slack, and a level above C + slack
 * whose cap fell below its peak (ideas lost) falls back by decay * (L - C - slack) a year; otherwise levels never fall.
 */
export const IDEA = {
  step: 5,
  /**
   * Multipliers of every idea's caps and chance; general: every field's cap also rises by general * sqrt(score), score the sum
   * of eraWeight[era] over the ideas held (a people that knows more can do more, with diminishing returns; the first ideas weigh most).
   */
  capMul: 0.5,
  /** The field caps of an idea by era, times capMul (the early ideas made the most difference). (Era 3 0.9 and era 4 2 before the
   * merge with the claims: with soft wider, the leading worlds ran ahead of main in the last centuries.) */
  capEra: [2, 1.4, 0.6, 0.75, 1.5],
  general: 0.15,
  eraWeight: [3.2, 1, 0.6, 0.8, 1],
  /** Share of the general part per field (Farming, Seafaring, Metalworking, Crafts). */
  generalField: [1, 0.95, 0.85, 0.95],
  /** Multiplier of the levers (land, seaCost, range, war, defence, admin, craft; not toll or farm). */
  lever: 0.2,
  conceive: 0.05,
  /** Growth from practice (technology.ts) times this while ideas are on: the caps, not practice, set the pace; below the cap a level
   * also closes catchUp of the distance a year (the practice of ideas newly held). */
  practice: 1.5,
  catchUp: 0.05,
  capBase: 0.05,
  /** (0.12 before the merge with the claims: the slowest worlds, a few peoples of a few thousand each, came to no leisure travel or
   * ocean lane by 2000; wider, a level runs a little further above its cap, and those worlds catch up enough.) */
  soft: 0.16,
  slack: 0.05,
  decay: 0.004,
  useFloor: 0.4,
  mix: 0.12,
  mixMax: 4,
  /** Cardwell's law: conception chance / (1 + cardwell * r), r the ideas the people conceived lately (decaying by cardDecay a year). */
  cardwell: 0.25,
  cardDecay: 0.004,
  /** Recombination: conception chance * (1 + combo * ideas held); scale: * sqrt(pop / popRef) within [scaleMin, scaleMax]. */
  combo: 0.3,
  /** Scale linear in population (else its square root). */
  scaleLinear: true,
  popRef: 10000,
  scaleMin: 0.2,
  scaleMax: 2.5,
  /** Backwardness: learning from a people whose summed technology is x times one's own, times 1 + backward * (x - 1) (x > 1). */
  backward: 8,
  forget: 0.01,
  adopt: 0.6,
  /** Channel knobs, by IdeaHow (Invented and Lost unused). */
  ch: [0, 0.12, 0.4, 1.0, 1.4, 0.4, 0.6, 1.0, 0.6, 0.5, 0.4, 0.5, 0.25, 0],
  tradeHalf: 150,
  laneHalf: 40,
  postMax: 2,
  pilgrimHalf: 30,
  faith: 0.3,
  visitorHalf: 40,
  migHalf: 150,
  /** Pulses in years of a strong link: migrants (times size / (size + migHalf)), a conquest (each way), a royal marriage (each way). */
  pulseMig: 10,
  pulseConquest: 15,
  pulseMarriage: 10,
  /** Lane volume smoothing a year. */
  laneSmooth: 0.2,
  faithResist: 0.85,
  rulerResist: 0.8,
  guildResist: 0.7,
  lossLow: 200,
  lossHigh: 3000,
  /** Multiplier of every idea's fragile. */
  fragile: 0.5,
  collapseShare: 0.4,
  collapseMul: 1,
  peakDecay: 0.003,
  supportHalf: 0.3,
  tollMin: 0.4,
}
