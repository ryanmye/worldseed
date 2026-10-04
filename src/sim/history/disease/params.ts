// disease: tuning constants of the disease system (disease/system.ts). Units: people, years; shares in [0, 1].

import { DiseaseKind } from '../../../contract.ts'

/** The disease system on by default (HistoryOptions.disease). */
export const DISEASE_ON = true

/** One kind of disease in the catalogue: a pool of 4-8 is drawn per world from these (setup.ts). */
export interface DiseaseDef {
  archetype: string
  kind: DiseaseKind
  /** Share of those infected who die (case fatality), before the town, famine and first-exposure factors. */
  mortality: number
  /** Share of a town's susceptibles infected in an outbreak (villages: DZ.village of it). */
  attack: number
  /** Transmission a year along a link of weight 1 from a fully infectious settlement to a fully susceptible one. */
  beta: number
  /** Years a struck settlement stays sick and infectious. */
  duration: number
  /** Susceptible people a settlement needs to pass it on at full strength (crowd diseases need towns). */
  crowd: number
  /** Weight of sea links (0 never by ship); seaTech: the Seafaring level from which ships carry it at all (fast passages). */
  sea: number
  seaTech: number
  /** Survivors' immunity fading a year (0 for life). */
  fade: number
  /** Below this susceptible share a settlement cannot take an outbreak (herd immunity, 1 / R0). */
  susMin: number
  /** Crowd: critical community size (people of the people and its trade partners), endemic death rate a year, and the herd-and-town load (species.ts) at which it can emerge. */
  ccs: number
  endemicDeath: number
  load: number
}

export const DISEASE_DEFS: Record<string, DiseaseDef> = {
  pox: { archetype: 'pox', kind: DiseaseKind.Crowd, mortality: 0.3, attack: 0.8, beta: 0.55, duration: 2, crowd: 800, sea: 1, seaTech: 0, fade: 0, susMin: 0.25, ccs: 14000, endemicDeath: 0.00009, load: 0.1 },
  measles: { archetype: 'measles', kind: DiseaseKind.Crowd, mortality: 0.12, attack: 0.95, beta: 0.8, duration: 1, crowd: 1500, sea: 1, seaTech: 2.4, fade: 0, susMin: 0.12, ccs: 24000, endemicDeath: 0.00006, load: 0.16 },
  flux: { archetype: 'flux', kind: DiseaseKind.Crowd, mortality: 0.09, attack: 0.7, beta: 0.6, duration: 1, crowd: 600, sea: 0.8, seaTech: 0, fade: 0.02, susMin: 0.3, ccs: 10000, endemicDeath: 0.00005, load: 0.22 },
  plague: { archetype: 'plague', kind: DiseaseKind.Plague, mortality: 0.46, attack: 0.85, beta: 0.6, duration: 2, crowd: 400, sea: 1.3, seaTech: 0, fade: 0.004, susMin: 0.35, ccs: 0, endemicDeath: 0, load: 0 },
  fever: { archetype: 'fever', kind: DiseaseKind.Fever, mortality: 0, attack: 0, beta: 0, duration: 1, crowd: 0, sea: 0, seaTech: 0, fade: 0, susMin: 0, ccs: 0, endemicDeath: 0, load: 0 },
  typhus: { archetype: 'typhus', kind: DiseaseKind.Camp, mortality: 0.15, attack: 0.6, beta: 0.08, duration: 1, crowd: 2500, sea: 0.5, seaTech: 0, fade: 0.01, susMin: 0.3, ccs: 0, endemicDeath: 0, load: 0 },
}

export const DZ = {
  /** Years between the coarse passes (susceptibles renewed, endemic status, emergence from herds, fever tolerance) and link rebuilds. */
  step: 5,
  /** Share of a settlement's people renewed by births a year: new susceptibles. */
  birth: 0.025,
  /** Pool: chance of a third crowd disease, and of a second plague (a second reservoir on another landmass). */
  thirdCrowd: 0.5,
  secondPlague: 0.2,
  /** Crowd-disease load thresholds are drawn within +-loadJitter of the catalogue's. */
  loadJitter: 0.2,
  /** Link weights: a route of v loads a year weighs v / (v + routeHalf), a long-haul leg of v class units v / (v + legHalf); neighbours and kin. */
  routeHalf: 40,
  legHalf: 15,
  near: 0.12,
  kin: 0.08,
  /** Journeys (History.journeys kinds Settlers, Migrants, Expedition, Army, Fleet): chance weight that carriers travel with them. */
  journey: [0.35, 0.5, 0.25, 0.8, 0.6],
  /** An army marching on a sick town brings it home with this weight. */
  armyHome: 0.6,
  /** Outbreak toll = mortality * attack(pop) * susceptible * (virgin the first time a people meets it) * (1 + famine * (1 - food)), at most maxToll. */
  virgin: 1.4,
  famine: 0.6,
  /** Hygiene: toll * (1 - min(hygieneMax, hygiene * (Crafts - hygieneFrom))): brick and stone, cleaner water, nursing, inoculation late in a run. */
  hygiene: 0.25,
  hygieneFrom: 2.5,
  hygieneMax: 0.5,
  village: 0.35,
  townHalf: 3000,
  maxToll: 0.6,
  /** Crowd diseases: emergence from herds and towns, a chance per step for a people at the load threshold with at least emergePop of ccs and a town of emergeTown. */
  emerge: 0.04,
  emergePop: 0.5,
  emergeTown: 1500,
  /** Endemic: susceptible share held in an endemic people's settlements; lost below burnOut * ccs; partners count with trade volume v / (v + partnerHalf). */
  endemicSus: 0.1,
  burnOut: 0.6,
  partnerHalf: 30,
  /** Endemic peoples seed outbreaks in others along their links (every other year) at this force. */
  endemicForce: 0.25,
  /** A first contact passes each crowd disease of the one people to the other with this chance (Epidemic event for a sickness new to it). */
  contact: 0.85,
  /** A first-contact Epidemic event's value: the expected share of the people lost, reach * the population-weighted toll, at most maxContact (species DISEASE.max). */
  contactReach: 0.8,
  maxContact: 0.4,
  /** Plague: spill from the reservoir a year (when settlements of spillPop trade there); a returning focus after a great wave. */
  spill: 1 / 700,
  spillPop: 800,
  /** Spills reach traders in the reservoir's region or within a chord of its centre that widens from spillReach to spillFar
   * between the years spillFrom and spillFull (smoothstep: trade reaches farther); the busiest is struck, nearer ones first
   * (weight 1 / (1 + (d / spillReach)^2)). */
  spillReach: 0.25,
  spillFar: 0.5,
  spillFrom: 800,
  spillFull: 1400,
  focusDecay: 0.985,
  focusChance: 0.015,
  focusMax: 1,
  focusTowns: 24,
  focusPop: 2000,
  /** Great epidemic: at least great of its network and greatMin deaths. */
  great: 0.05,
  greatMin: 800,
  /** Labour: the year's food multiplier (econ) falls by min(labourMax, labour * yearly death rate) in a struck settlement. */
  labour: 1,
  labourMax: 0.35,
  /** Trade: a struck settlement's pairs cost tradeHit times more while it is sick and tradeYears after. */
  tradeHit: 1.25,
  tradeYears: 1,
  /** Flight: from a struck place of fleeMin or more, flee * toll of its people (at most fleeMax) go to a neighbour of the same people, with the sickness. */
  flee: 0.2,
  fleeMax: 0.05,
  fleeMin: 800,
  /** Deserted: a place under desertPop that loses desertLoss or more is left with chance desert (the survivors go to its mother or a neighbour). */
  desertPop: 200,
  desertLoss: 0.3,
  desert: 0.35,
  /** Recovery: once an outbreak has passed, a settlement that is fed (food >= 1) regains rebound of the gap to its people before
   * it, a year, until it is back (the survivors marry younger and fill the empty land: waves, not a lasting tax). */
  rebound: 0.03,
  /** Unrest in a polity member: += unrest * toll. */
  unrest: 1.2,
  /** rulers: an outbreak at a capital takes its ruler (and each heir) with chance toll * court (rulers/system.ts rulerPlague). */
  court: 0.5,
  /** religion: a town (TOWN_POPULATION) struck with a toll of at least woeToll counts as a woe (religion/system.ts religionPlague). */
  woeToll: 0.04,
  /** Armies: exhaustion += armyExhaust * toll at a sick target; camp fever chance per campaign (twice at a siege) and its exhaustion. */
  armyExhaust: 2,
  camp: 0.03,
  campExhaust: 0.35,
  campFirst: 0.25,
  /** ArmyStricken is logged when a campaign's added exhaustion reaches this. */
  armyLog: 0.1,
}

/** Place-bound fever: intensity per cell and its burden (disease/setup.ts feverMap; system.ts). */
export const FEVER = {
  /** Heat, wetness and lowland: smoothstep(heat0, heat1, temperature) * smoothstep(wet0, wet1, rainfall) * (1 - smoothstep(low0, low1, elevation)). */
  heat0: 0.62,
  heat1: 0.85,
  wet0: 0.35,
  wet1: 0.7,
  low0: 0.03,
  low1: 0.22,
  /** Standing water: times (1 + lake + river + delta), at most waterMax, over waterMax. */
  lake: 0.5,
  river: 0.35,
  delta: 0.5,
  waterMax: 1.6,
  /** Base intensity without standing water (share of waterMax it reaches). */
  /** Paddy rice or irrigated fields: times paddy. */
  paddy: 1.25,
  /** Extra deaths a year at intensity 1 with no tolerance (residual for the fully tolerant: mort * (1 - tolMax)). */
  mort: 0.001,
  /** Tolerance per people: += step * adapt * exposure * (tolMax - tol); a people founded on fever ground (deep-time natives) starts at tolMax * min(1, start * exposure). */
  tolMax: 0.8,
  adapt: 0.004,
  start: 2.5,
  /** Drainage at high Farming: intensity * (1 - min(drainMax, drain * (Farming - drainFrom))). */
  drainFrom: 3.5,
  drain: 0.4,
  drainMax: 0.6,
  /** A settlement counts as on fever ground (stats, the first fever strike) from this intensity. */
  ground: 0.25,
  /** Armies: an attacker campaigning on fever ground gains army * intensity * (1 - tolerance) exhaustion. */
  army: 0.25,
  /** Migrants judge a new site on fever ground at 1 - site * intensity * (1 - their people's tolerance) of its worth ('bad air'). */
  site: 0.2,
}

/** Quarantine (Venice 1377 trentino, Ragusa): wealthy, well-governed ports of polity members, from a Crafts level. */
export const QUARANTINE = {
  crafts: 3.0,
  /** Wealth a head at least this (prosperity proxy), unrest at most unrestMax; a great epidemic within memory years among its people. */
  wealthHead: 4,
  unrestMax: 0.3,
  memory: 150,
  /** Chance a decade for an eligible port. */
  chance: 0.35,
  /** Sea-borne arrivals pass with this share of their chance (overland ones with cordon); the port's trade pairs cost cost times more. */
  block: 0.15,
  cordon: 0.6,
  cost: 1.08,
}
