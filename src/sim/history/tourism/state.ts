// tourism: state of the tourism system (one object; set up once at the start from the planet: scenery and spots).

import type { World } from '../../../contract.ts'
import type { Rng } from '../../rng.ts'
import type { Terrain } from '../terrain.ts'
import { computeScenery } from './scenery.ts'

export interface TourismState {
  // --- Static (scenery.ts) ---
  N: number
  P: number
  scenery: Uint8Array
  sceneryKind: Uint16Array
  rng: Rng

  // --- Per settlement (capacity `cap`, ids [0, seen) initialised) ---
  cap: number
  seen: number
  /** 1 for a settlement founded as a resort (stays 1 after it is abandoned). */
  resort: Uint8Array
  /** True once any resort exists (the food system's hook looks only then). */
  anyResort: boolean
  /** Visitors a year at the settlement (this flow step) and their smoothed spending (a year). */
  visitors: Float64Array
  income: Float64Array
  incomeSm: Float64Array
  /** Peak population seen (sights), last year with income above RESORT.minIncome (resorts), destination hosted (-1). */
  peak: Float64Array
  lastGood: Int32Array
  hostOf: Int32Array
  /** 1 once a Boom was logged at the settlement; 1 once it is a sight (any kind). */
  boomed: Uint8Array
  sighted: Uint8Array
  /** Abandoned towns waiting to become ruins (settlement ids). */
  pendingRuins: number[]
  /** Settlements with visitor income (smoothed > 0) and every living resort, in order added. */
  hostList: number[]

  // --- Destinations (append-only; d indexes these) ---
  dCount: number
  dCell: number[]
  dHost: number[]
  /** Appeal from scenery, from sights' fame and from the holy-city hook. */
  dScenic: number[]
  dFame: number[]
  dExtra: number[]
  /** SightKind of the sight that made it a destination, -1 for a scenic spot. */
  dKind: number[]
  dTemp: number[]
  dHigh: number[]
  dCoast: number[]
  dSnow: number[]
  dPleasant: number[]
  dVogue: number[]
  /** Visitors a year (this step), wanted visitors for a place without a host, steps in a row it was wanted enough. */
  dVis: number[]
  dWant: number[]
  dWantSteps: number[]
  /** Smoothed visitors; peak (smoothed) of the current spell and the best ever; year it came into fashion; 1 while in fashion, year it declined (-1), 1 once it became a quaint sight. */
  dVisSm: number[]
  dBest: number[]
  dSince: number[]
  dPeak: number[]
  /** Leisure class of the sources that could come, at the peak. */
  dPeakL: number[]
  dFashion: number[]
  dDeclined: number[]
  dQuaint: number[]
  /** Smoothed visitors per destination per people: dPV[d * P + p] (grown with dCount). */
  dPV: Float64Array
  /** Destination at each cell (-1). */
  destAt: Int32Array

  // --- Sources (cached searches) ---
  srcIds: number[]
  /** Year of each source's last search; its options: destination, cost, path (cells) per option. */
  srcYear: number[]
  srcOpt: number[][]
  srcCost: number[][]
  srcPath: number[][][]
  /** Land cells of each option's way (for its danger), and the Crafts of the source's people at its last search. */
  srcLand: number[][][]
  srcCraft: number[]
  /** Source index of each settlement (-1); the town most visitors to each settlement came from at the last flow step (-1). */
  srcOf: Int32Array
  mainOf: Int32Array
  /** Leisure class a year (last flow step), and smoothed. */
  srcL: number[]
  srcLsm: number[]

  // --- Flows (this flow step; the yearly spending reads them) ---
  fFrom: number[]
  fTo: number[]
  fVis: number[]
  fSpend: number[]
  fPair: number[]
  /** Pairs in order of first travel (contract VisitorFlows) and their key -> index (lookup only). */
  pFrom: number[]
  pTo: number[]
  pFirst: number[]
  pPath: number[][]
  pIndex: Map<number, number>
  /** Rows per trade snapshot. */
  rSnap: number[]
  rPair: number[]
  rVis: number[]
  rSpend: number[]
  /** 1 once the people's first leisure travel was logged. */
  peopleStarted: Uint8Array

  // --- Sights ---
  sKind: number[]
  sCell: number[]
  sSettlement: number[]
  sFrom: number[]
  sFame: number[]
  /** Scanned positions: events, discoveries. */
  evSeen: number
  discSeen: number

  // --- Search scratch ---
  dist: Float64Array
  prev: Int32Array
  mark: Int32Array
  run: number

  diag: TourismDiag
}

/** Counters for the stats harness (not part of the contract). */
export interface TourismDiag {
  /** Spending by visitors per year, summed per decade (index year / 10). */
  spendDecade: number[]
  /** Searches made, cells visited. */
  searches: number
  visits: number
}

export function createTourism(world: World, T: Terrain, P: number, rngSprings: Rng, rng: Rng): TourismState {
  const N = T.cellCount
  const sc = computeScenery(world, T, rngSprings)
  const cap = 256
  const tz: TourismState = {
    N, P, scenery: sc.scenery, sceneryKind: sc.kind, rng,
    cap, seen: 0,
    resort: new Uint8Array(cap), anyResort: false,
    visitors: new Float64Array(cap), income: new Float64Array(cap), incomeSm: new Float64Array(cap),
    peak: new Float64Array(cap), lastGood: new Int32Array(cap), hostOf: new Int32Array(cap).fill(-1),
    boomed: new Uint8Array(cap), sighted: new Uint8Array(cap), pendingRuins: [], hostList: [],
    dCount: 0, dCell: [], dHost: [], dScenic: [], dFame: [], dExtra: [], dKind: [], dTemp: [], dHigh: [], dCoast: [], dSnow: [], dPleasant: [], dVogue: [],
    dVis: [], dWant: [], dWantSteps: [], dVisSm: [], dBest: [], dSince: [], dPeak: [], dPeakL: [], dFashion: [], dDeclined: [], dQuaint: [],
    dPV: new Float64Array(64 * P), destAt: new Int32Array(N).fill(-1),
    srcIds: [], srcYear: [], srcOpt: [], srcCost: [], srcPath: [], srcLand: [], srcCraft: [], srcOf: new Int32Array(cap).fill(-1), mainOf: new Int32Array(cap).fill(-1), srcL: [], srcLsm: [],
    fFrom: [], fTo: [], fVis: [], fSpend: [], fPair: [],
    pFrom: [], pTo: [], pFirst: [], pPath: [], pIndex: new Map<number, number>(),
    rSnap: [], rPair: [], rVis: [], rSpend: [],
    peopleStarted: new Uint8Array(P),
    sKind: [], sCell: [], sSettlement: [], sFrom: [], sFame: [], evSeen: 0, discSeen: 0,
    dist: new Float64Array(N).fill(Infinity), prev: new Int32Array(N).fill(-1), mark: new Int32Array(N), run: 0,
    diag: { spendDecade: [], searches: 0, visits: 0 },
  }
  for (let k = 0; k < sc.spots.length; k++) addDestination(world, T, tz, sc.spots[k], sc.spotView[k] / 255, 0, -1)
  return tz
}

/** Adds a destination at cell c (or adds fame to the one there); returns its index. */
export function addDestination(world: World, T: Terrain, tz: TourismState, c: number, scenic: number, fame: number, kind: number): number {
  const at = tz.destAt[c]
  if (at >= 0) {
    tz.dFame[at] += fame
    if (tz.dFame[at] > 1.5) tz.dFame[at] = 1.5
    if (tz.dKind[at] < 0) tz.dKind[at] = kind
    return at
  }
  const d = tz.dCount++
  const { neighborOffsets: off, neighbors: nb } = world.grid
  let coast = T.seaCoast[c] ? 1 : 0
  for (let k = off[c]; k < off[c + 1] && !coast; k++) if (T.seaCoast[nb[k]]) coast = 1
  const sk = tz.sceneryKind[c]
  tz.destAt[c] = d
  tz.dCell.push(c); tz.dHost.push(-1); tz.dScenic.push(scenic); tz.dFame.push(fame > 1.5 ? 1.5 : fame); tz.dExtra.push(0); tz.dKind.push(kind)
  tz.dTemp.push(world.temperature[c])
  tz.dHigh.push(world.elevation[c] >= 0.22 || (sk & 1) !== 0 ? 1 : 0)
  tz.dCoast.push(coast)
  tz.dSnow.push((sk & 64) !== 0 ? 1 : 0)
  tz.dPleasant.push((sk & 128) !== 0 ? 1 : 0)
  tz.dVogue.push(1)
  tz.dVis.push(0); tz.dWant.push(0); tz.dWantSteps.push(0); tz.dVisSm.push(0); tz.dBest.push(0); tz.dSince.push(-1); tz.dPeak.push(0); tz.dPeakL.push(0); tz.dFashion.push(0); tz.dDeclined.push(-1); tz.dQuaint.push(0)
  if (tz.dPV.length < tz.dCount * tz.P) { const b = new Float64Array(2 * tz.dCount * tz.P); b.set(tz.dPV); tz.dPV = b }
  return d
}

function growF(a: Float64Array, n: number): Float64Array { const b = new Float64Array(n); b.set(a); return b }
function growI(a: Int32Array, n: number, fill: number): Int32Array { const b = new Int32Array(n).fill(fill); b.set(a); return b }
function growU(a: Uint8Array, n: number): Uint8Array { const b = new Uint8Array(n); b.set(a); return b }

/** Per-settlement arrays sized for `count` settlements. */
export function ensureTourism(tz: TourismState, count: number): void {
  if (count > tz.cap) {
    let n = tz.cap
    while (n < count) n *= 2
    tz.resort = growU(tz.resort, n)
    tz.visitors = growF(tz.visitors, n)
    tz.income = growF(tz.income, n)
    tz.incomeSm = growF(tz.incomeSm, n)
    tz.peak = growF(tz.peak, n)
    tz.lastGood = growI(tz.lastGood, n, 0)
    tz.hostOf = growI(tz.hostOf, n, -1)
    tz.boomed = growU(tz.boomed, n)
    tz.sighted = growU(tz.sighted, n)
    tz.srcOf = growI(tz.srcOf, n, -1)
    tz.mainOf = growI(tz.mainOf, n, -1)
    tz.cap = n
  }
  tz.seen = count
}
