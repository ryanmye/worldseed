// religion: tuning constants for faiths, their spread, conversion of rulers, state churches, schism, persecution and holy war.
//
// Years and yearly rates unless noted. Shares are of a settlement's people (0..1).

export const RELIGION = {
  /** Religion on by default (HistoryOptions.religion overrides it). */
  enabled: true,
  /** Spread, pilgrims and faith deaths every `step` years; rulers' conversions, state religions, persecution and new faiths every slowStep; schisms every schismStep. */
  step: 10,
  slowStep: 10,
  schismStep: 20,
  /** Faiths a settlement keeps track of (the rest fold into these). Shares below minShare are dropped. */
  slots: 3,
  minShare: 0.005,
  /**
   * Exposure of a settlement to a universal faith f (summed): trade * v / (v + tradeHalf) per open route (lane * w / (w + laneHalf) per
   * long-haul leg) times f's share at the other end, near times f's share at each neighbour on the link graph, state (1 + zeal) where f is
   * the state religion of its polity, ruler where f is only its ruler's faith; each source times pull = pullBase + zeal + pullOrg * organisation
   * (missionaries, monasteries). Gain a year: rate * exposure * fit * (1 - share); a faith already present grows by bandwagon * share * (ceiling - share) * fit.
   */
  trade: 1,
  tradeHalf: 150,
  lane: 1.5,
  laneHalf: 300,
  near: 0.02,
  state: 0.35,
  ruler: 0.15,
  pullBase: 0.3,
  pullOrg: 0.5,
  rate: 0.008,
  bandwagon: 0.018,
  /** A gain at most maxGain a step. */
  maxGain: 0.3,
  /** Fit: towns (>= TOWN_POPULATION) * (townBase + townAppeal * appeal); villages below villagePop * (villageBase - villageAppeal * appeal); ceilings for the bandwagon. */
  townBase: 0.6,
  townAppeal: 0.8,
  villagePop: 500,
  villageBase: 0.9,
  villageAppeal: 0.5,
  ceilingTown: 1,
  ceilingVillage: 0.45,
  /** A persecuting state presses conversion on its members: exposure + persecuteConvert to its faith. */
  persecuteConvert: 1.2,
  /** Pilgrims: a holy city earns pilgrim * followers * safety a year (safety 1 - danger, * hostileHoly when held by a ruler of another faith), at most pilgrimCap * its people. */
  pilgrim: 0.012,
  hostileHoly: 0.4,
  pilgrimCap: 1,
  /** A faith reaches a people in earnest when one of its settlements holds reach of it. */
  reach: 0.25,
  /** A faith dies out when its followers fall below dieBelow (having once had dieOnce): its last followers fold into their neighbours' faiths. */
  dieBelow: 60,
  dieOnce: 600,
}

export const FOUNDING = {
  /** A universal faith arises (every RELIGION.slowStep years) with chance found * (1 + crisis * crisis share) / (1 + crowd * universal faiths so far), at a town picked by people * (1 + crisis [woe]). */
  found: 0.065,
  crowd: 1,
  crisis: 1.5,
  /** Candidate towns: people >= pop (or the world's largest few, >= popMin), the people's Crafts >= crafts, at least `routes` open routes; woe: famine, sack, conquest or plague within woeYears. */
  pop: 2500,
  popMin: 1200,
  crafts: 1.45,
  routes: 2,
  woeYears: 25,
  /** The founding town starts with this share. */
  share: 0.35,
  /** At most this many faiths in a world (one byte per settlement). */
  max: 250,
}

export const CONVERT = {
  /** A ruler of faith a converts to the largest other universal faith f in the realm with chance convert * smoothstep(low, high, x) * (pietyBase + piety) * (a universal ? switch : 1) a slow step, x = capital * f's share at the capital + realm * its share among the members. */
  convert: 0.35,
  low: 0.1,
  high: 0.6,
  capital: 0.55,
  realm: 0.45,
  pietyBase: 0.4,
  switch: 0.3,
  /** The ruler's universal faith becomes the state religion with chance adopt * (adoptBase + organisation) a slow step. */
  adopt: 0.35,
  adoptBase: 0.2,
}

export const EFFECTS = {
  /** Grievance of a member under a ruler of a universal faith (folk faiths are not exclusive; foreign rule is the ethnic grievance): grievance * (1 - share of the ruler's faith) * (1 - sync * assimilation) (* stateChurch under a state church); persecution adds persecute * (1 - share). */
  grievance: 0.05,
  sync: 0.7,
  stateChurch: 1.15,
  persecute: 0.25,
  /** Rivalry a year: + differ * zeal between realms of different faiths (one universal), - same between realms of one universal faith, + schism between a faith and its schism. */
  differ: 0.008,
  same: 0.01,
  schism: 0.012,
  /** Holy war: a state religion multiplies declarations on a realm of another faith by 1 + holy * zeal (a traditional faith's realm: * heathen), + crusade when it holds one of the faith's holy cities. Logged as a holy war at zeal >= holyZeal (and a pious ruler: piety >= holyPiety). */
  holy: 0.6,
  heathen: 1.3,
  crusade: 1.5,
  holyZeal: 0.5,
  holyPiety: 0.45,
  /** Monasteries: peoples whose majority shares a universal faith learn from each other faster (technology link + monastery). */
  monastery: 0.004,
}

export const PERSECUTION = {
  /** A state whose state religion has zeal >= zeal, under a ruler of tolerance < tolerance, with minorities >= minority of its members' people, begins to persecute with chance chance * zeal * (1 - tolerance) a slow step; it lasts U(min, max) years or until the ruler changes. */
  zeal: 0.6,
  tolerance: 0.3,
  minority: 0.1,
  chance: 0.03,
  min: 20,
  max: 50,
  /** Flight: each step a member of >= fleeMin people whose largest other faith holds >= fleeShare sends flee * that share * its people to the best trade partner outside the persecution (food >= 0.9), along the route; they carry their faith, crafts and skills (rate * group / their new people's population * the gap, at most maxSkill). */
  fleeMin: 400,
  fleeShare: 0.15,
  flee: 0.04,
  rate: 0.3,
  maxSkill: 0.03,
}

export const SCHISM = {
  /** A universal faith at least age years old with followers >= followers may split (chance chance a schism step) in the largest realm of its faith ruled by another people than its founders' or a rival (rivalry >= rival) of its holy city's holder. */
  age: 150,
  followers: 40000,
  chance: 0.1,
  /** A faith that split (or was born of a split) splits again no sooner than gap years after. */
  gap: 250,
  rival: 0.5,
  /** In the seceding realm its share moves to the new faith: capital share at the capital, members elsewhere. */
  capital: 0.8,
  members: 0.55,
  /** Rivalry between the schism's realm and the parent's states jumps by rivalry. */
  rivalry: 0.3,
}
