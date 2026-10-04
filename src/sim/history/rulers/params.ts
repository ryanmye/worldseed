// rulers: tuning constants for rulers, heirs, successions, houses, marriages and unions (rulers/*.ts).
//
// Years and yearly rates. Mortality is a per-year hazard by age (childhood, a flat adult risk and a Gompertz rise),
// tabulated once by multiplication only (no exp); a person's year of death is drawn from it in one draw.

export const RULERS = {
  /** Rulers on by default (HistoryOptions.rulers overrides it; they need polities). */
  enabled: true,
  /** Yearly hazard of death: infant (age 0), child (1-4), youth (5-14), then adult + gompertz * gompertzRate^(age - 20). */
  infant: 0.12,
  child: 0.03,
  youth: 0.008,
  adult: 0.018,
  gompertz: 0.0012,
  gompertzRate: 1.09,
  /** Births: a yearly chance while the ruler is fertileFrom..fertileTo (a woman: ..fertileToF); legitimate with chance legit. */
  birth: 0.26,
  fertileFrom: 18,
  fertileTo: 50,
  fertileToF: 42,
  legit: 0.9,
  /** Heirs kept per realm (children of the ruler first, then the ruler's siblings and cousins). */
  heirs: 6,
  /** Brothers of a new house's founder: up to this many, born within siblingSpread years of the founder. */
  siblings: 2,
  siblingSpread: 12,
  /** Of age at this; a minor's reign opens with a regency. */
  majority: 16,
  /** A regency weakens the realm as a crisis does (POLITY.crisisMass, UNREST.crisis, WAR.crisisMul) for at most regencyMax years. */
  regencyMax: 4,
  /** Founders of polities and new houses: age U(founderAge0, founderAge1). Elected league heads: age U(40, 65), terms U(termMin, termMax). */
  founderAge0: 28,
  founderAge1: 48,
  termMin: 3,
  termMax: 12,
  /** Ability: house vigour times U(1 - abilityNoise, 1 + abilityNoise), within [abilityMin, abilityMax]. */
  abilityNoise: 0.18,
  abilityMin: 0.45,
  abilityMax: 1.6,
  /** House vigour (the dynastic cycle): a founder's U(founder0, founder1); each new generation 1 + regress (V - 1) - drift + U(-gen, gen). */
  founder0: 1.12,
  founder1: 1.42,
  regress: 0.72,
  drift: 0.04,
  gen: 0.1,
  /** Mass of a realm * (1 + mass * (ability - 1)) (control pass); declarations * (warBase + warlike) (mean 1). */
  mass: 0.3,
  warBase: 0.5,
  /** War deaths: a yearly chance per realm at war, battle * (0.4 + warlike) (a woman: * womanBattle); the fall of the capital kills the ruler with chance sack. */
  battle: 0.012,
  womanBattle: 0.25,
  sack: 0.35,
  /** After a capital fell and its ruler died, the conqueror sets a new house on the throne with chance puppet. */
  puppet: 0.5,
  /**
   * Overthrow (a yearly chance): overthrow * max(0, overthrowAbility - ability) * (1 + exhaustion + crisis + lost * [lost a war lately]),
   * by a general (at war or lately) or a magnate; the old ruler is killed with chance overthrowKill, else deposed.
   */
  overthrow: 0.012,
  overthrowAbility: 1.05,
  overthrowLost: 2,
  overthrowKill: 0.55,
  /** Chiefdoms: at a chief's death the next chief comes from another family with chance chiefHouse. */
  chiefHouse: 0.3,
  /** Elective thrones: the electors pass over the house with chance electOther. */
  electOther: 0.1,
  /** Women may inherit (after sons) among a share `cognatic` of peoples; daughters are passed over among the rest. */
  cognatic: 0.45,
  /** Laws of succession: a people's first law is drawn with these weights (Primogeniture, Partible, Elective, Seniority). */
  lawWeights: [0.4, 0.25, 0.15, 0.2],
  /** A people's law changes at a succession of one of its realms with chance lawChange (a new law drawn by the weights; after a partition, primogeniture with chance afterPartition). */
  lawChange: 0.01,
  afterPartition: 0.3,
}

export const SUCCESSION = {
  /** Contested: chance base[law] + cohesion * (1 - A) + multi [several peoples] + minor + bastard + woman + weak * max(0, 1 - ability of the dead). */
  base: [0.05, 0.06, 0.1, 0.14],
  cohesion: 0.18,
  multi: 0.08,
  minor: 0.12,
  bastard: 0.3,
  woman: 0.1,
  weak: 0.2,
  /** Seniority and elective thrones: each adult rival of the house beyond the first adds rival (at most rivalMax). */
  rival: 0.04,
  rivalMax: 0.12,
  /** A crisis (contested succession) lasts U(crisisMin, crisisMax) years (UNREST's crisis). */
  crisisMin: 5,
  crisisMax: 15,
  /** In a crisis of a realm of CIVIL.minMembers or more with a rival centre: civil war with chance civil * (1 + members / CIVIL.sizeCrisis); else a partition (Kingdom+) with chance partition. */
  civil: 0.32,
  partition: 0.12,
  /** The capital's claimant wins the crisis with chance heirWins; else another claimant: a brother or cousin (if any), or a new house (usurper). */
  heirWins: 0.72,
  /** Partible law: a Kingdom or larger with adult sons beyond the heir is divided among them with chance partible. */
  partible: 0.25,
  /** No heir at all: the throne passes to a new house; contested with chance extinctContested. */
  extinctContested: 0.4,
  /** No heir in the pool and no marriage claim: a kinsman of a cadet line carries the house on with chance cadet. */
  cadet: 0.7,
}

export const MARRIAGE = {
  /** Every POLITY.slowStep years: neighbouring realms at peace (rivalry < maxR), both ruled by houses, marry with chance chance. */
  chance: 0.035,
  maxR: 0.6,
  /** A tie lasts at most years, or until a house loses its throne or the two go to war. */
  years: 60,
  /** While tied, rivalry falls by rivalry a year (relations); alliances * alliance. */
  rivalry: 0.012,
  alliance: 2,
  /** When the house of one dies out: the tied ruler inherits the throne (a personal union) with chance union * claim (claim 1 - age / years); passed over, it presses its claim by war with chance war * claim. */
  union: 0.75,
  war: 0.7,
  /** A union merges into one realm after mergeYears (same or long-met peoples), and splits at the senior's contested succession or when the junior throws off the bond. */
  mergeYears: 40,
}
