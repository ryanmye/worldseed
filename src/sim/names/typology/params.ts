// typology: constants (language-typology-scripts.md §4). The category priors are WALS shares (Maddieson; Hajek; Dryer; Bickel &
// Nichols; WALS Online, Dryer & Haspelmath eds.); every value tagged [A] is a design default to tune in typologyStats.ts.

/** Default of HistoryOptions.typology for code that does not say (R32: new worlds only, via lang=2). */
export const TYPOLOGY_ON = false

export const TYPO = {
  /** WALS 1A consonant inventory classes: 6-14, 15-18, 19-25, 26-33, 34+ (89/122/201/94/57 of 563). Capped at 48 for names. */
  invPrior: [0.158, 0.217, 0.357, 0.167, 0.101],
  invRange: [[6, 14], [15, 18], [19, 25], [26, 33], [34, 48]] as ReadonlyArray<readonly [number, number]>,
  /** WALS 2A vowel quality classes: 2-4, 5-6, 7-14 (93/287/184 of 564); within 5-6, five alone is 188 of 287. */
  vowPrior: [0.165, 0.509, 0.326],
  /** WALS 12A syllable structure: simple, moderate, complex (61/274/151 of 486). */
  sylPrior: [0.126, 0.564, 0.311],
  /** WALS 13A tone: none, simple, complex (307/132/88 of 527). */
  tonePrior: [0.583, 0.25, 0.167],
  /** MorphStyle: Isolating, Suffixing, Prefixing, Compounding, RootPattern (mapped from WALS 26A and 20A; the split is [A]). */
  stylePrior: [0.14, 0.47, 0.15, 0.2, 0.04],
  /** Series switched on, each its own Bernoulli (WALS 7A, 6A, 19A, 10A; the last five are design defaults [A]). */
  ejective: 0.168,
  implosive: 0.134,
  uvular: 0.171,
  labialVelar: 0.079,
  pharyngeal: 0.042,
  dentalFric: 0.076,
  clicks: 0.018,
  nasalVowels: 0.262,
  retroflex: 0.15,
  aspiration: 0.2,
  prenasal: 0.08,
  length: 0.35,
  harmony: 0.15,
  /** P(harmony) multiplier with 7+ vowels (WALS ch. 2 ties large inventories to harmony) [A]. */
  harmonyLargeMul: 2.5,
  /** Complexity factor: inventory and syllable classes share z with this weight [A] (WALS ch. 12 note). */
  rho: 0.4,
  /** Chance a people keeps each feature group of its cradle (areal clustering) [A]. */
  arealKeep: 0.65,
  /** A cradle within this arc (radians) of an earlier one copies a group with chance nearCopy [A]. */
  nearArc: 0.35,
  nearCopy: 0.3,
  /** Rare-series phonemes per word, clicks per word, click chance per syllable [A]. */
  markedPerWord: 2,
  clicksPerWord: 1,
  clickRate: 0.12,
  /** Share of simple-syllable languages that require an onset (CV only) [A]. */
  cvOnly: 0.05,
  /** Labialised velars, lateral fricatives/affricates (no WALS chapter; design defaults [A]). */
  labialised: 0.12,
  lateralFric: 0.08,
  /** Voicing series (b d g) [A]. */
  voicing: 0.67,
  /** Most letters of a plain word, and of a whole plain name. */
  maxPlainWord: 12,
  /** A daughter redraws 1-2 spelling slots at its split with this chance [A]. */
  orthoRedraw: 0.3,
} as const

/** typology: writing systems (history/language/scripts.ts; language-typology-scripts.md §5.5). Every value is [A] unless noted. */
export const SCRIPT = {
  /** A people's first script when none exists anywhere is logosyllabic with this chance (after the four commonly recognised independent inventions, each with logograms plus phonetic signs; a design default, not a measured rate). */
  firstLogo: 0.85,
  /** A later independent invention is logosyllabic with this chance (else by phonology fit). */
  laterLogo: 0.6,
  /** A learned script is a stimulus invention (only the idea spreads; Sequoyah's syllabary the best-documented case). */
  stimulus: 0.12,
  /** A borrowed logosyllabic script becomes a syllabary in a non-isolating language (logograms used for their sound). */
  logoToSyllabary: 0.5,
  /** A reform makes a featural script (Sampson's term for Hangul). */
  featural: 0.04,
  /** Weight of the state faith's holy-city script in exposure. */
  faithMul: 0.4,
  /** Replacement hazard per bin: shiftRate x E^2 when the mean exposure over the last 4 bins reaches shiftMin. */
  shiftRate: 0.08,
  shiftMin: 0.6,
  /** Years per exposure bin (as LANG.bin). */
  bin: 50,
  /** A daughter keeps its parent's direction with this chance. */
  keepDirection: 0.85,
  /** A new family's direction: LTR, RTL, vertical, boustrophedon. */
  direction: [0.45, 0.35, 0.15, 0.05],
} as const
