// renaming: constants of the renaming system (see system.ts for the rules they enter).

/** Default of HistoryOptions.renaming. */
export const RENAMING_ON = true

export const RENAME = {
  /** Importance of a town: (pop - popLow) / (popFull - popLow) clamped to 0..1, times capitalMul for a seat of government (now or before). */
  popLow: 400,
  popFull: 2000,
  capitalMul: 1.6,
  /** Population at which a town counts as a city (importance x cityMul). */
  cityPop: 4000,
  cityMul: 1.3,

  // --- Conquest: a town of another people held by its conqueror ---
  /** Years of unbroken holding before the conquerors' name takes hold (drawn uniformly at the conquest). */
  holdMin: 15,
  holdMax: 60,
  /** Chance at the end of the holding, times importance. */
  conquest: 0.42,
  /** Shares of the forms for a conquest: adapted, named for the ruler, named for the house (the rest a new name). */
  adapt: 0.6,
  ruler: 0.12,
  house: 0.08,
  /** A town sacked when it fell is refounded (RenameCause.Refounded, never adapted) at this chance times importance instead. */
  refound: 0.55,
  /** A holy city of another faith taken by a state with a state religion is rededicated to that faith (RenameCause.Faith) at this share of its renamings. */
  holyTaken: 0.6,

  // --- Cession: towns taken in a war that ended in a treaty (AttackerGains, DefenderGains, Tribute, Vassalage) ---
  /** Chance at the treaty, times importance; renamed 1..cedeDelay years later if still held. */
  cede: 0.16,
  cedeDelay: 3,
  cedeAdapt: 0.45,
  cedeRuler: 0.25,

  // --- New capitals and imperial seats (Kingdom tier or above) ---
  /** Chance a new capital of its ruling people is renamed (1..capitalDelay years on), and one of another people (the conquerors' new seat). */
  capital: 0.16,
  foreignSeat: 0.6,
  capitalDelay: 10,
  /** Chance the capital is renamed when its realm first becomes an empire (checked every empireStep years). */
  imperial: 0.18,
  empireStep: 5,
  /** Forms of a capital's renaming: for the ruler, for the house (the rest a new royal name; always new without rulers). */
  capRuler: 0.5,
  capHouse: 0.2,

  // --- Faith: a change of state religion (from one faith to another) ---
  /** Chance the royal city (the capital, Kingdom tier or above) is renamed for the new faith, and the old faith's holy city if it is in the realm (a town is renamed for a faith once at most). */
  faithCapital: 0.1,
  faithHoly: 0.3,
  faithDelay: 6,

  // --- Trade: a port hosting a foreign factory for generations ---
  tradeYears: 120,
  tradeStep: 10,
  tradePop: 1000,
  trade: 0.3,

  // --- Restoration: the town under a state of the people whose earlier name it bore (or stateless among its own people) ---
  /** Chance on liberation, times the stickiness factor max(0, 1 - years borne / stickYears): a name that lasted generations sticks. */
  restore: 0.7,
  stickYears: 250,
  /** A name imposed by foreigners (not of the town's own people) brought back by its reconquerors, times restore; stateless among its own people (no liberator: the locals' name simply returns), times restore. */
  reimpose: 0.5,
  stateless: 0.4,
  restoreDelay: 8,
  /** The honoured house lost the throne of the realm that named the town for it: the name is dropped at this chance times stickiness. */
  houseFell: 0.4,

  // --- Revival: a town grown on the site of a ruin takes the ruin's name ---
  /** A ruin counts if its settlement once had ruinPeak people; the newcomer must stand on its cell or a neighbour, reach revivePop, at least ruinAge years after the abandonment. */
  ruinPeak: 300,
  ruinAge: 30,
  revivePop: 300,
  revive: 0.5,
}
