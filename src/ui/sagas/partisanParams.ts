// Partisan sagas (experience-whatif-director-sagas §3.3): the rhetoric of a partisan telling, UI presentation constants
// (design defaults, not historical estimates). Grounds: inflated figures in pre-modern narrative sources (Delbrück 1900,
// 1913: Herodotus' 5,100,000 for Xerxes' army); formulaic round numbers (Greek myrioi "ten thousand, countless";
// Chinese 万 wàn; age heaping, Whipple's index, UN DYB 2023); defeat blamed on treachery (the Dolchstoßlegende,
// Hindenburg's 1919 testimony, GHDI). The factors themselves are not taken from those sources.

export const PARTISAN = {
  /** Our people's dead at the hands of a foe, told as this multiple (chronicle, legend): suffering is remembered large. */
  ourDeadByFoe: [1.5, 3],
  /** The foe's dead at our hands: minimised in the chronicle, unspoken in the legend (0: omit the number). */
  foeDeadByUs: [0.6, 0],
  /** Our own dead at our own hands (a revolt crushed, a civil war won): omitted in both. */
  ourDeadByUs: [0, 0],
  /** A lost war is left out of the chronicle when it cost fewer than this many dead and at most one town and no capital fell. */
  omitLostDead: 2000,
  /** The legend leaves out every lost war in which no capital of ours fell. */
  legendOmitLost: true,
  /** A white peace is told as a victory in the legend. */
  legendWhitePeaceWon: true,
  /** Chronicle numbers: two significant figures, "some". Legend numbers snap to the formulaic set, nearest in log space. */
  legendNumbers: [100, 300, 1000, 3000, 10000, 30000, 100000],
  /** Years a war between the two lineages keeps them foes (the proxy without grudges). */
  foeYears: 150,
  /** Standing grudge weight (grudges-and-oaths standingGrudges) that makes a foe. */
  grudgeFoe: 0.3,
  /** beliefs: the court's estimate over the truth at or above which a foe is "the mighty", at or below which "the feeble". */
  mightyAt: 1.5,
  feebleAt: 0.67,
  /** beliefs: years a foe's bluff that turned us back keeps it told at its shown strength. */
  shownYears: 10,
} as const
