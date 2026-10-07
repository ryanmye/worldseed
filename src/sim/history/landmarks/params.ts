// landmarks: constants of the landmarks system (see system.ts for the rules they enter).

/** Default of HistoryOptions.landmarks. */
export const LANDMARKS_ON = true

export const LANDMARK = {
  /** Years between the scans of the towns (new works, neglect, restoration, conversion); a multiple of the snapshot interval's default. */
  step: 5,
  /** Below this many people a settlement is passed over at the scans (resorts aside): at most shrinePop, templePop and every great work's minimum but bathsPop. */
  minPop: 700,
  /**
   * Ranks: a great work also needs its town among the world's largest (the ...Rank-th largest living town's population at the
   * scan, at most TOP_TOWNS), so that a crowded world of many towns raises no more of them than a sparse one.
   */
  castleRank: 8,
  palaceRank: 8,
  holyRank: 12,
  templeRank: 6,
  monkRank: 24,
  martRank: 10,
  hubRank: 4,
  guildRank: 10,
  lightRank: 10,
  libraryRank: 6,
  monumentRank: 8,
  tombRank: 8,
  springRank: 24,
  councilRank: 6,
  /**
   * The world's crowding: every great work but the capital's guarantee has its chance times
   * clamp(1 - (n - crowdFrom) / (crowdTo - crowdFrom), 0, 1), n the great landmarks begun so far: a world that has raised many
   * raises the next more rarely (patrons and masons are drawn to what is famous already), so a long-lived crowded world keeps
   * a few dozen. crowdTo <= crowdFrom: no crowding.
   */
  crowdFrom: 18,
  crowdTo: 36,
  /** "Rich": wealth per head at least richMul times the mean of the world's towns (pop >= 1000) at the scan. */
  richMul: 1.2,

  // --- Castle: the seat of a realm, or a frontier fortress ---
  /** A capital of Kingdom tier or more, held as capital castleYears, with castlePop people: castle per scan. */
  castleYears: 20,
  castlePop: 3500,
  castle: 0.1,
  /** The guarantee: a capital of any tier held forceYears with forcePop people begins one at once (if it has no castle or palace). */
  forceYears: 25,
  forcePop: 10000,
  /** Frontier fortress: a town of fortPop people taken in war or besieged in the last fortWindow years, held by a realm of Kingdom tier or more. */
  fortPop: 5000,
  fortWindow: 40,
  fort: 0.02,

  // --- Palace: the long-held capital of a kingdom or empire, and rich ---
  palaceYears: 40,
  palaceEmpireYears: 20,
  palacePop: 5000,
  palace: 0.15,

  // --- Great temple: a holy city, the seat of a state faith, a rich and pious city ---
  /** A universal faith's holy city (its founding seat or a schism's) with holyPop people. */
  holyPop: 3000,
  holy: 0.05,
  /** The capital of a realm (Kingdom tier or more) with a state faith that its majority follows, with seatTemplePop people. */
  seatTemplePop: 6000,
  seatTemple: 0.03,
  /** A rich city of piousPop people whose majority faith holds piousShare of it, under a ruler of piety piousRuler. */
  piousPop: 8000,
  piousShare: 0.7,
  piousRuler: 0.6,
  pious: 0.03,

  // --- Monastery: a faith of organisation, a pious ruler (one per reign at most), in a town of the realm ---
  monkOrg: 0.35,
  monkPiety: 0.85,
  monkPop: 3000,
  monastery: 0.01,

  // --- Market hall: a mart of the long-haul trade, or a rich trade hub ---
  martPop: 4000,
  mart: 0.02,
  hubPop: 8000,
  hubRich: 2.5,
  hub: 0.015,

  // --- Guildhall: the seat of a renowned craft tradition (TraditionRenowned) ---
  guildPop: 3000,
  guild: 0.1,
  /** Years after the renown within which the hall is begun (if at all): judged at the scans until then. */
  guildWindow: 30,

  // --- Lighthouse: a port on an ocean lane (a long-haul lane with oceanCells deep-sea cells) ---
  lightPop: 6000,
  oceanCells: 5,
  light: 0.02,

  // --- Library: a large rich city of a people that holds writing (more likely with paper, printing) ---
  libraryPop: 6000,
  library: 0.015,
  libPaper: 2,
  libPrinting: 4,
  /** Without the ideas system: Crafts technology level standing for writing. */
  libTech: 2.5,

  // --- Monument: a victorious warlike ruler (a conquest, or a war won that took monumentTaken towns), at the capital of a realm of monumentTier; one per town ---
  monumentWar: 0.7,
  monumentTaken: 3,
  monumentTier: 1,
  monumentPop: 4000,
  monument: 0.2,

  // --- Mausoleum: at the ruler's death, at the capital (one per town): the founder of a house who reigned tombFounderReign years over an
  // empire, or a long great reign (tombReign years, ability tombAbility) over a kingdom or more ---
  tombPop: 4000,
  tombFounderReign: 20,
  tombReign: 30,
  tombAbility: 1.25,
  tombFounder: 0.3,
  tombGreat: 0.3,

  // --- Baths: a resort at hot springs, or a town of note by springs ---
  bathsPop: 300,
  baths: 0.08,
  springTownPop: 2500,
  springTown: 0.03,

  // --- Council house: the seat of a league or of an elective state ---
  councilYears: 30,
  councilPop: 3000,
  council: 0.04,

  // --- Lesser: temples and shrines ---
  /** A town of templePop people for templeYears gets a temple of its majority faith; one more per templeStep people, at most templeMax. */
  templePop: 1500,
  templeYears: 10,
  templeStep: 6000,
  templeMax: 5,
  temple: 0.12,
  /** A settlement of shrinePop people for shrineYears whose majority holds a traditional faith gets a folk shrine (one). */
  shrinePop: 700,
  shrineYears: 20,
  shrine: 0.025,

  // --- Build times (years, drawn uniformly at the start), by LandmarkKind ---
  buildMin: [10, 15, 20, 10, 5, 5, 10, 10, 3, 10, 5, 5, 5, 2],
  buildMax: [30, 40, 80, 30, 15, 15, 25, 30, 10, 25, 15, 15, 15, 6],

  // --- States ---
  /** Neglect: the town under neglectShare of its peak since completion for neglectYears; a seat no longer a capital for seatYears. */
  neglectShare: 0.38,
  neglectYears: 25,
  seatYears: 40,
  /** A castle that was a seat is neglected for the lost seat only when its town is also under castleKeep of its peak. */
  castleKeep: 0.6,
  /** A neglected landmark falls into ruin ruinMin..ruinMax years on (drawn at the neglect). */
  ruinMin: 150,
  ruinMax: 400,
  /** Sacked: a standing great landmark is ruined at sackGreat (castles sackCastle), a lesser at sackLesser. */
  sackGreat: 0.25,
  sackCastle: 0.4,
  sackLesser: 0.15,
  /** Restored per scan: the town back over restoreShare of the peak and rich, a seat a capital again, a house of worship under a pious ruler. */
  restoreShare: 0.75,
  /** A seat (a capital again) is restored when its town has restoreSeat of its peak. */
  restoreSeat: 0.5,
  restore: 0.15,
  /** A ruin is restored at this share of the chance. */
  ruinRestore: 0.4,
  /** Pious restoration: a ruler of piety restorePiety, the town at restorePious of its peak. */
  restorePiety: 0.7,
  restorePious: 0.5,
  /** Conversion when the town's majority faith (holding convertShare) is another: per scan, lesser and great; on a change of state faith, great. */
  convertShare: 0.5,
  convertLesser: 0.25,
  convertGreat: 0.06,
  convertState: 0.4,
  /** A conqueror with a state faith rededicates a great house of worship of another faith in a town it takes, with this chance (at the conquest). */
  convertConquest: 0.3,
  /**
   * Revival: the ruins of an abandoned town are restored by its heir (the first settlement founded on or beside its cell after it
   * was given up) once the heir is reviveYears old and has max(revivePop, reviveShare of the old town's peak) people, with chance
   * revive per scan (a great one if the heir has none of its kind, a temple if it has fewer than templeMax); the landmark becomes
   * the heir's.
   */
  reviveYears: 30,
  revivePop: 1500,
  reviveShare: 0.4,
  revive: 0.08,
  /** Years after a change before another (sack and abandonment excepted). */
  minGap: 10,
}
