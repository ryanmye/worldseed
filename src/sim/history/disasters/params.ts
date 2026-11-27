// disasters: parameters of the natural shocks and climate regimes (disasters-climate.md §2.5). Every value is a design
// default (tuned in step 9, the stats harness disasterStats.ts) unless its comment ties it to a source:
//   - pVei5, pStep: the VEI periodicity table (Wikipedia "Volcanic explosivity index", after Newhall & Self 1982,
//     https://doi.org/10.1029/JC087iC02p01231): VEI >= 5 every ~12 y, each step up ~10^-0.9 as often (a fit of that table).
//   - bStep: Gutenberg-Richter b = 1 (Gutenberg & Richter 1944, https://doi.org/10.1785/BSSA0340040185).
//   - rupture length: Wells & Coppersmith (1994) Table 2A, RLD all slip types, log10 L = -2.44 + 0.59 M (fitted on M 4.8-8.1;
//     larger M is an extrapolation).
//   - rate7: about 15 M >= 7 a year worldwide (USGS 2000-2021: 13.8 M7-7.9 and 1.2 M8+), set lower because most are offshore.
// The climate amplitudes (gSd, rSd, pSd) are about 1.3x what the reconstructions suggest, so that epochs read in a 2000-year
// story (PAGES 2k Consortium 2019; Neukom et al. 2019 for the regional timing; the amplitudes themselves are [unverified]).
// Powers and logarithms are written out as literals (the sim uses only + - * / sqrt floor).
//
// Step 9 (disasterStats.ts, seeds 1 / 7 / 42 / 1234, 2000 y, on vs off on the same world), measured with these values:
//   eruptions VEI 5/6/7: 125/21/5, 143/14/4, 139/15/3, 125/16/0 (targets 120-220 / 10-35 / 0-6); volcanic winters 22, 15, 14, 14
//   famine rate in volcanic-winter years 12.9x, 19.9x, 3.4x, 6.0x (target >= 3x); famine events on/off 1.05, 0.89, 0.97, 0.90
//   starvation on/off 0.82, 1.00, 0.90, 0.97; harvest mean on-off +0.004, +0.006, -0.011, +0.001; sd30 0.023-0.034 (off 0.016-0.022)
//   megadroughts 3, 7, 6, 11; most regions in drought at once <= 6 %; largest single event <= 0.81 % of the world's people
//   earthquake rows with deaths 260-700 and tsunamis with deaths 107-142 a run: far above the plan's 30-150 / 1-8, kept so (the
//     rate is the USGS-scaled one; the deaths are small: quakes 4-15k, waves 6-30k a run); CityDestroyed 0-1 (plan 2-15)
//   world pop at 2000 on/off 1.29, 1.22, 0.60, 0.96 (chaotic: single-seed ratios swing both ways)

export const DX = {
  /** Default for HistoryOptions.disasters (ships off; the flip is its own PR, MASTER-PLAN §8.7). */
  enabled: false,
  /** Phase 2 feedback hooks (storage exhaustion, disaster grievance, relief): step 10, not built yet. */
  feedback: false,
  /** No shock of the great class (VEI 7, a quake of M >= 8.5) before this year (lets cradles take root). */
  graceYear: 200,

  // --- climate regime (§3.2): global components, e-folding years / stationary sd degC ---
  gTau: [4, 40, 250], gSd: [0.12, 0.18, 0.25],
  rTau: 20, rSd: 0.15, // regional temperature
  pTau: 30, pSd: 0.07, // regional rain regime (harvest units at kP = 1)
  // harvest per degC: kT = kBase + kCold * cold - kHot * hot; monsoon weakening by volcanic cooling kMon
  // step 9: kBase 0.03 -> 0.06, kCold 0.10 -> 0.20 (at the plan's values a volcanic winter left the famine rate below that of
  // other years, the anonymous crisis it replaces being 0.12-0.3 off every harvest; now 1.2-10x on seeds 42, 1, 7, 1234)
  kBase: 0.06, kCold: 0.20, kHot: 0.05, kMon: 0.06,
  maxRegionLoss: 0.45, maxRegionGain: 0.12,
  /**
   * The climatological mean of the volcanic cooling, degC, added back to the temperature so an average year includes average
   * volcanism (the reference climate of the harvest): pVei5 * sum_v P(v) sulfur[v] * mean U * sum(shape) with hemiW about 1.
   * Without it, eruptions (which only cool) would lower the mean harvest. Recomputed from the params at set-up (volcBias()).
   */
  volcBiasOn: true,

  // --- eruptions (§3.3) ---
  maxVolcanoes: 60, hotspotsMin: 2, hotspotsMax: 5, arcStress: 0.05, arcHops: 3, volcSpacing: 2,
  pVei5: 1 / 12, // VEI >= 5 a year
  pStep: 0.126, // P(VEI >= v+1 | >= v) = 10^-0.9
  /** Base peak growing-season cooling by VEI 5/6/7, degC, times U(sulfurLo, sulfurHi) (VEI is a poor proxy for sulfur). */
  sulfur: [0.2, 1.0, 2.8], sulfurLo: 0.4, sulfurHi: 1.6, // step 9: from [0.15, 0.6, 1.6]
  /** Forcing by years after the eruption (peak a year after; e-folding about a year). */
  shape: [0.6, 1.0, 0.37, 0.14],
  tropicLat: 0.34, // |sin lat| < 0.34 (20 deg): both hemispheres alike
  ownHemi: 1.4, otherHemi: 0.3, // extratropical: more in its own hemisphere (Toohey et al. 2019)
  maxVolcanicDT: 3,
  /** VEI 5/6/7: share killed in the volcano's cell (uniform range), in ring 1, and ring 2 (VEI 7: ring-1 share / 6). */
  ashLoss: [[0.05, 0.10], [0.15, 0.35], [0.40, 0.60]],
  ashRing: [0, 0.04, 0.15],
  /** Local harvest multiplier on the struck cells, and its years. */
  ashHarvest: [0.7, 0.4, 0.15], ashYears: [1, 2, 3],
  witnessHops: 6,
  /** VolcanicWinter: area-mean volcanic cooling at its peak year at or below this, degC. */
  winterAt: -0.7, // step 9: from -0.5 (with the larger sulfur, 10-21 winters per 2000 y)

  // --- earthquakes (§3.5) ---
  quakeSlots: 16,
  rate7: 10, // M >= 7 a year on an Earth-length boundary network
  /**
   * Quake-source cells (|tectonic| >= quakeMinStress next to a plate change) of the reference world (n = 48): re-measured in
   * step 3 as the mean of seeds 1, 7, 42, 1234 (2231, 1949, 1905, 1813), so rate7 averages DX.rate7 over those worlds.
   */
  refBoundaryCells: 1975,
  quakeMinStress: 0.02, quakeConv: 0.05,
  mmaxConv: 9.5, mmaxOther: 8.0,
  /** Share killed at the epicentre by magnitude (piecewise-linear; constant beyond the ends). */
  quakeLoss: [[7.0, 0.04], [7.5, 0.12], [8.0, 0.22], [8.5, 0.30]] as [number, number][], // step 9: top from 0.20/0.25 (a city at an M 8 epicentre can be destroyed)
  quakeReachAdd: 40, // km added to half the rupture length
  cityVuln: 1.3, villageVuln: 0.6,
  // step 9: tsunamiM 8.0 -> 8.5, reach at M 8 400 -> 150 km (M 9: 1500 km), loss 0.05/0.20 -> 0.01/0.08 at M 8/9: at the plan's
  // values tsunamis were 200+ a run and killed 120k on seed 42 (one wave 3.8 % of the world's people, over the 3 % cap)
  tsunamiM: 8.5, tsunamiReach8: 150,
  tsunamiLoss: [[8.0, 0.01], [9.0, 0.08]] as [number, number][],

  // --- floods (§3.6) ---
  floodFlowQ: 0.9, // big river: flow in the top 10 % of land river cells
  floodBase: 1 / 150, floodWet: 4, floodWetLo: 0.05, floodWetHi: 0.15,
  floodLoss: [0.01, 0.05], floodHarvest: 0.7, damFail: 0.3,

  // --- drought / epoch detection (§3.7) ---
  // step 9: on -1.2 -> -2.8 sd, off -0.4 -> -1.0 (at the plan's values, with 48 regions and the tau-30 regime, 300+ droughts
  // and 270 megadroughts a run; now 13-17 droughts, 11-17 of them mega). Labels only: the harvest follows rPa either way.
  droughtOn: -2.8, droughtOff: -1.0, droughtOnYears: 5, droughtOffYears: 3, megaYears: 15, droughtMinPop: 300,
  // step 9: epochOn 0.35 -> 0.5, epochOff 0.1 -> 0.17 (13-18 epochs a run at the plan's values; now 6-8 on seeds 1, 7, 42, 1234)
  epochOn: 0.5, epochOff: 0.17, epochWindow: 10,

  // --- consequences of a strike (§3.4) ---
  maxShare: 0.6, minShare: 0.005, // a share below minShare is no strike (the edge of a quake's or wave's reach)
  destroyedShare: 0.25, wealthMul: 1.5, portLoss: 2, damLoss: 2,
  /** Landmark ruin chance at a loss of 0.25 (scaled linearly below; half for floods). */
  quakeLandmark: 0.6,
}

/** The mean volcanic cooling the eruption schedule gives (degC, >= 0; see DX.volcBiasOn). */
export function volcBias(): number {
  if (!DX.volcBiasOn) return 0
  const p6 = DX.pStep, p7 = DX.pStep * DX.pStep
  const meanS = (1 - p6) * DX.sulfur[0] + (p6 - p7) * DX.sulfur[1] + p7 * DX.sulfur[2]
  let sh = 0
  for (const x of DX.shape) sh += x
  return DX.pVei5 * meanS * ((DX.sulfurLo + DX.sulfurHi) / 2) * sh
}

/** 10^(-k/10), k = 0..9. */
export const TENTHS = [1, 0.7943, 0.6310, 0.5012, 0.3981, 0.3162, 0.2512, 0.1995, 0.1585, 0.1259]
/** 10^0.059: the rupture length's growth per 0.1 of magnitude (Wells & Coppersmith 1994, b = 0.59). */
export const RUPTURE_STEP = 1.1455
/** Rupture length at M 7.0, km: 10^(-2.44 + 0.59 * 7) = 10^1.69. */
export const RUPTURE_L7 = 48.978
/** Mean Earth radius, km (cell distances are chords of the unit sphere times this). */
export const R_KM = 6371
