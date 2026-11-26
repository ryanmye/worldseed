// language: constants of language drift (docs/plans language-drift.md §3.4). Every value but `lambda` is a design default
// (tagged [A] in the plan); `lambda` is Swadesh's (1955) 100-list retention of 0.86 per millennium, a contested textbook rate.

/**
 * Default of HistoryOptions.language for code that does not say. Off: a history without the flag keeps the names it always had
 * (MASTER-PLAN R32: the option is on only for new worlds, which the app writes as `lang=1`).
 */
export const LANGUAGE_ON = false

export const LANG = {
  // --- Sound change (names/soundChange.ts) ---
  /** Regular sound changes per millennium at rate 1 (a renewal process per language; driftProto measured 64% of names visibly changed after 1000 y). */
  mu: 7,
  /** Spread of each language's pace: rate = exp(N(0, rateSpread)) (lognormal, after relaxed clocks, Drummond et al. 2006). */
  rateSpread: 0.35,
  /** Fewest letters a settlement name may wear down to (a single word of a name keeps at least 2). */
  minNameLetters: 3,

  // --- Core vocabulary (names/lexicon.ts) ---
  /** Core replacement per meaning per millennium: -ln 0.86 (Swadesh 1955; contested, see the plan §2). */
  lambda: 0.151,
  /** Gamma shape for per-meaning rate heterogeneity (0: every meaning alike). */
  meaningShape: 0,
  /** Meanings on the core list, and how many of them names are made of (8 site affixes, 10 geographic words, the derive ending, 2 city endings). */
  core: 100,
  visible: 21,

  // --- The tree (names/languageTree.ts) ---
  /** A lineage's k-th town on another landmass makes the settlers there a daughter language. */
  overseasK: 3,
  /** Towns of a lineage in another region of its own landmass before that region parts. */
  regionK: 4,
  /** Years since a language's own split before one of its regions may part. */
  regionAge: 300,
  /** World regions (farthest-point centres on land). */
  regions: 48,
  /** Most languages a history has (no splits beyond). */
  maxNodes: 160,

  // --- Contact (names/contact.ts) ---
  /** Years of unbroken foreign rule before a town can take up its rulers' tongue. */
  shiftMin: 150,
  /** Shift hazard per 5-year snapshot, times share² (share: the rulers' own people in the realm's population). */
  shiftRate: 0.02,
  /** Hazard factor for a town its rulers renamed (Adapted, Ruler, House), and for a capital. */
  shiftRenamed: 1.5,
  shiftCapital: 1.3,
  /** Loans per visible meaning per millennium under full exposure to a donor. */
  loanRate: 0.6,
  /** Loan rate of the rest of the core list, relative to the visible words (basic meanings resist borrowing; Tadmor et al. 2010). */
  coreLoanMul: 0.25,
  /** Weight of a state faith's holy-city tongue in exposure. */
  faithLoanMul: 0.3,
  /** Years per exposure bin. */
  bin: 50,
  /** A LoanWave: at least waveLoans visible loans from one donor within waveYears (logged once per pair per waveGap years). */
  waveLoans: 4,
  waveYears: 100,
  waveGap: 300,

  // --- Presentation ---
  /** "Old X" within oldYears of a language's start, "Middle X" until middleYears. */
  oldYears: 450,
  middleYears: 900,
} as const
