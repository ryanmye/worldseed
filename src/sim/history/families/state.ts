// families: the state of the merchant families (merchant-families.md §2.4). Kept in GoodsState.ext.fam (null when off: every
// hook is then a no-op). Per-settlement and per-leg arrays are typed and grow by doubling; the family, seat and head tables are
// ragged JS arrays, append-only, ids in order of creation (prefix-stable).

import type { HistoryEvent } from '../../../contract.ts'
import { createRng } from '../../rng.ts'
import type { Rng } from '../../rng.ts'
import { survival } from '../rulers/state.ts'

export interface FamilyDiag {
  founded: number[] // by FamilyCause
  ended: number[] // by FamilyEnd
  ruin: number[] // by FamilyRuin
  splits: number
  marriages: number
  backings: number
  emigrations: number
  branches: number
  capHits: number
  nonMart: number
  /** Breaches of sum(share) > kappa + 1e-9 or a negative share found by the pass (must stay 0). */
  breaches: number
  /** Milliseconds in familiesYear (performance.now; tuning only). */
  ms: number
}

export interface FamilyState {
  rng: Rng
  // --- per settlement (grown with s.count) ---
  cap: number
  /** This year's hooks: merchant inflow, the part of a venture paid from the pool, capital arrived from other pools. */
  inY: Float64Array
  payY: Float64Array
  movInY: Float64Array
  /** feedback: capital lent out of (positive) or repaid into (negative) the town's pool this year by its families (api.ts), and per seat. */
  lendY: Float64Array
  seatLendY: Map<number, number>
  /** feedback: (family, other) pairs a crown default wrote down this year; their ruin checks run at the pass. */
  pendingRuin: number[]
  /** Towns whose hook arrays (or lendY) were written this year, and their marks (the pass clears only those). */
  touched: number[]
  tmark: Uint8Array
  /** mw at the last pass (towns with a seat). */
  m0: Float64Array
  /** Open seats at each town, ascending seat id (undefined: none). */
  atTown: (number[] | undefined)[]
  // --- per sim leg (grown with g.legCount) ---
  lcap: number
  inLegA: Float64Array
  inLegB: Float64Array
  /** Family operating leg k, -1. */
  laneOwner: Int32Array
  /** Lane row (lnFam...) of the owner's spell on leg k, -1. */
  laneRow: Int32Array
  // --- families ---
  fFounded: number[]; fEnded: number[]; fEnd: number[]; fRuin: number[]; fCause: number[]
  fFirstHome: number[]; fHome: number[]; fParent: number[]; fPeople: number[]
  /** Seat id of the home. */
  fHomeSeat: number[]
  /** Open seats of the family, ascending. */
  fSeats: number[][]
  /** Sim legs it operates. */
  fLanes: number[][]
  fVigour: number[]
  fHead: number[]
  /** Decaying peak capital (pk = max(c, pk * peakDecay)). */
  fPeak: number[]
  fPeakYear: number[]; fPeakCap: number[]
  /** Years in a row under the fade bar. */
  fLow: number[]
  /** Capital still on its way to a new home (emigration), the town it comes from and the year it ends. */
  fTransit: number[]; fTransitFrom: number[]; fTransitUntil: number[]
  /** Polity whose court it is tied to (a marriage), -1; the marriage row in force, -1. */
  fCourt: number[]; fMarriage: number[]
  /** Notional crown loan (pure mode) and its polity (-1). */
  fLoan: number[]; fLoanP: number[]
  /** Capital lent to crowns through finance (feedback), outstanding. */
  fLent: number[]
  /** Capital this pass (sum of its seats); refreshed by capitals(). */
  fCap: number[]
  alive: number[]
  // --- seats ---
  sFam: number[]; sTown: number[]; sKind: number[]; sFrom: number[]; sTo: number[]; sOpen: number[]; sClose: number[]; sLeg: number[]; sPost: number[]
  /** Share of the town pool (open seats; 0 once closed). */
  sSig: number[]
  // --- heads ---
  hFam: number[]; hBorn: number[]; hFrom: number[]; hTo: number[]; hDied: number[]; hDeath: number[]; hHow: number[]; hAbility: number[]; hFemale: number[]; hPrev: number[]
  // --- rows ---
  lnFam: number[]; lnLeg: number[]; lnFrom: number[]; lnTo: number[]
  mgFam: number[]; mgDyn: number[]; mgPolity: number[]; mgRuler: number[]; mgYear: number[]; mgEnd: number[]; mgDaughter: number[]
  bkFam: number[]; bkWar: number[]; bkSide: number[]; bkStake: number[]; bkOut: number[]
  ptFam: number[]; ptLandmark: number[]; ptYear: number[]
  /** Lent to (family, polity): key f * 65536 + p (lookup only). */
  outTo: Map<number, number>
  events: HistoryEvent[]
  // --- snapshots (sparse, per population snapshot) ---
  snapFamOff: number[]; snapFam: number[]; snapFamCap: number[]
  snapSeatOff: number[]; snapSeat: number[]; snapSeatCap: number[]
  evSeen: number; lmSeen: number; dzSeen: number
  /** finance on: written-off principal of each loan account already charged to the families (mirrorFinance), and the first account not yet settled. */
  finLost: number[]; finLow: number
  surv: Float64Array
  /** This year's marks from the event scan: the year's venture sponsors (seat ids), plague tolls at homes (family -> toll). */
  sponsor: number[]
  plague: Map<number, number>
  diag: FamilyDiag
}

export function createFamilies(seed: number, count: number, legs: number): FamilyState {
  let cap = 64
  while (cap < count) cap *= 2
  let lcap = 64
  while (lcap < legs) lcap *= 2
  const F = {
    rng: createRng(seed, 'history-merchants'),
    cap, inY: new Float64Array(cap), payY: new Float64Array(cap), movInY: new Float64Array(cap), lendY: new Float64Array(cap), seatLendY: new Map<number, number>(), pendingRuin: [] as number[], m0: new Float64Array(cap), touched: [] as number[], tmark: new Uint8Array(cap), atTown: [] as (number[] | undefined)[],
    lcap, inLegA: new Float64Array(lcap), inLegB: new Float64Array(lcap), laneOwner: new Int32Array(lcap).fill(-1), laneRow: new Int32Array(lcap).fill(-1),
    fFounded: [], fEnded: [], fEnd: [], fRuin: [], fCause: [], fFirstHome: [], fHome: [], fParent: [], fPeople: [], fHomeSeat: [], fSeats: [], fLanes: [],
    fVigour: [], fHead: [], fPeak: [], fPeakYear: [], fPeakCap: [], fLow: [], fTransit: [], fTransitFrom: [], fTransitUntil: [], fCourt: [], fMarriage: [],
    fLoan: [], fLoanP: [], fLent: [], fCap: [], alive: [],
    sFam: [], sTown: [], sKind: [], sFrom: [], sTo: [], sOpen: [], sClose: [], sLeg: [], sPost: [], sSig: [],
    hFam: [], hBorn: [], hFrom: [], hTo: [], hDied: [], hDeath: [], hHow: [], hAbility: [], hFemale: [], hPrev: [],
    lnFam: [], lnLeg: [], lnFrom: [], lnTo: [],
    mgFam: [], mgDyn: [], mgPolity: [], mgRuler: [], mgYear: [], mgEnd: [], mgDaughter: [],
    bkFam: [], bkWar: [], bkSide: [], bkStake: [], bkOut: [],
    ptFam: [], ptLandmark: [], ptYear: [],
    outTo: new Map<number, number>(),
    events: [] as HistoryEvent[],
    snapFamOff: [], snapFam: [], snapFamCap: [], snapSeatOff: [], snapSeat: [], snapSeatCap: [],
    evSeen: 0, lmSeen: 0, dzSeen: 0, finLost: [] as number[], finLow: 0,
    surv: survival(),
    sponsor: [] as number[], plague: new Map<number, number>(),
    diag: { founded: [0, 0, 0], ended: [0, 0, 0, 0, 0], ruin: [0, 0, 0, 0, 0, 0], splits: 0, marriages: 0, backings: 0, emigrations: 0, branches: 0, capHits: 0, nonMart: 0, breaches: 0, ms: 0 },
  }
  // (one literal: see the V8 note in rulers/state.ts createRulers)
  return F as FamilyState
}

/** Grows the per-settlement arrays to hold `count` settlements. */
export function ensureFamTowns(F: FamilyState, count: number): void {
  if (count <= F.cap) return
  let n = F.cap
  while (n < count) n *= 2
  const g = (a: Float64Array): Float64Array => { const b = new Float64Array(n); b.set(a); return b }
  F.inY = g(F.inY); F.payY = g(F.payY); F.movInY = g(F.movInY); F.lendY = g(F.lendY); F.m0 = g(F.m0)
  const t = new Uint8Array(n); t.set(F.tmark); F.tmark = t
  F.cap = n
}

/** Grows the per-leg arrays to hold `legs` legs. */
export function ensureFamLegs(F: FamilyState, legs: number): void {
  if (legs <= F.lcap) return
  let n = F.lcap
  while (n < legs) n *= 2
  const a = new Float64Array(n); a.set(F.inLegA); F.inLegA = a
  const b = new Float64Array(n); b.set(F.inLegB); F.inLegB = b
  const o = new Int32Array(n).fill(-1); o.set(F.laneOwner); F.laneOwner = o
  const r = new Int32Array(n).fill(-1); r.set(F.laneRow); F.laneRow = r
  F.lcap = n
}

/** Year of death of someone born in `born`, alive in `year`, from one uniform u (a copy of rulers' deathYear on the table). */
export function famDeathYear(S: Float64Array, born: number, year: number, u: number): number {
  const MAX = S.length - 2
  let a0 = year - born
  if (a0 < 0) a0 = 0
  if (a0 > MAX) return year + 1
  const target = S[a0] * u
  let a = a0
  while (a <= MAX && S[a + 1] > target) a++
  const y = born + a
  return y > year ? y : year + 1
}
