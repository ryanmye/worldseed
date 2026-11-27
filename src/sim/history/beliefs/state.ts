// beliefs: the state of what polities believe of each other (beliefs-and-deception.md §3.1). Pair rows are k = 2 r + dir per
// relation r (dir 0: relA observes relB; 1: relB observes relA), grown lazily with ps.relA (ensureRelation is not touched);
// per-polity arrays grow by doubling with ps.P. HistoryState.bel is null when HistoryOptions.beliefs is off.

import type { Rng } from '../../rng.ts'
import { createRng } from '../../rng.ts'

export interface BeliefDiag {
  /** Crises pressed (beliefs-driven draws that hit), and how they ended. */
  crises: number
  coerced: number
  tributes: number
  deterred: number
  deterredLogged: number
  wars: number
  /** Wars by WarMotive (index = motive). */
  byMotive: number[]
  bluffs: number
  bluffsExposed: number
  bluffsUnpaid: number
  spiesCaught: number
  secret: number
  revealedJoin: number
  revealedSpies: number
  doubleDealt: number
  forged: number
  forgedExposed: number
  /** Battles observed, Kalman updates made. */
  battles: number
  updates: number
  /** Preventive wars whose believed future ratio F was > 1 (all of them should be). */
  preventF: number
  /** Overawe vassalages taken on belief (counted when a bluff was showing). */
  overaweBluff: number
}

export interface BeliefState {
  /** 'history-beliefs'. */
  rng: Rng
  // --- Per directed pair (row k = 2 r + dir), grown with ps.relA ---
  /** Estimate of the target's mass (0: not yet formed), log-variance, smoothed growth ratio per slow step, its last estimate. */
  est: number[]; varL: number[]; trend: number[]; prev: number[]
  /** Year of the last observation; BeliefSource bits that informed it at the last belief step; this step's hard precision. */
  seen: number[]; src: number[]; hard: number[]
  /** Year the observer's spies were last caught at the target (spies are blind there the next step). */
  caught: number[]
  /** History.beliefs row of the pair (-1 not formed). */
  hrow: number[]
  /** Trade loads a year between the two of each relation (relationStep's vol, stored; null before the first step). */
  vol: Float64Array | null
  /** Forged claims per relation (dir 0: relA's claim on relB; 1: relB's on relA), year the oldest stood. */
  forged: number[]; forgedAt: number[]
  // --- Per polity ---
  pcap: number
  /** Bluff: shown strength factor minus 1 (0 none), the year it ends, the year it began. */
  bluff: Float64Array; bluffUntil: Int32Array; bluffFrom: Int32Array
  /** Credibility 0..1 (1 trusted). */
  cred: Float64Array
  /** Spy service 0..1 and counter-espionage 0..1. */
  spy: Float64Array; counter: Float64Array
  /** Mass at the last belief step (the realm's own growth ratio, for the commitment problem). */
  massPrev: Float64Array
  // --- Per bond: -2 public (known from its start), -1 secret, else the year it became known ---
  bKnown: number[]
  // --- Per war (by war id; -1 / 0 when not bargained) ---
  wBel: number[]; wTrue: number[]; wMotive: number[]; wGap0: number[]
  // --- History.beliefs rows ---
  hObs: number[]; hTgt: number[]; hFrom: number[]
  // --- Snapshots: slow (every snapStep years, q = year / snapStep), ragged over rows / polities; strength at main snapshots ---
  snEst: Float32Array<ArrayBuffer>; snSd: Uint8Array<ArrayBuffer>; snSrc: Uint8Array<ArrayBuffer>; snOff: number[]; snN: number[]; snQ: number[]; snUsed: number
  spBluff: Uint8Array<ArrayBuffer>; spSpy: Uint8Array<ArrayBuffer>; spCred: Uint8Array<ArrayBuffer>; spOff: number[]; spN: number[]; spUsed: number
  stMass: Float32Array<ArrayBuffer>; stOff: number[]; stN: number[]; stUsed: number
  diag: BeliefDiag
}

function growF(a: Float64Array, size: number, fill: number): Float64Array {
  const b = new Float64Array(size)
  b.set(a)
  if (fill !== 0) b.fill(fill, a.length)
  return b
}
function growI(a: Int32Array, size: number, fill: number): Int32Array {
  const b = new Int32Array(size)
  b.set(a)
  if (fill !== 0) b.fill(fill, a.length)
  return b
}

export function createBeliefs(seed: number): BeliefState {
  const pcap = 64
  return {
    rng: createRng(seed, 'history-beliefs'),
    est: [], varL: [], trend: [], prev: [], seen: [], src: [], hard: [], caught: [], hrow: [], vol: null, forged: [], forgedAt: [],
    pcap,
    bluff: new Float64Array(pcap), bluffUntil: new Int32Array(pcap), bluffFrom: new Int32Array(pcap), cred: new Float64Array(pcap).fill(1),
    spy: new Float64Array(pcap), counter: new Float64Array(pcap), massPrev: new Float64Array(pcap),
    bKnown: [], wBel: [], wTrue: [], wMotive: [], wGap0: [], hObs: [], hTgt: [], hFrom: [],
    snEst: new Float32Array(1024), snSd: new Uint8Array(1024), snSrc: new Uint8Array(1024), snOff: [], snN: [], snQ: [], snUsed: 0,
    spBluff: new Uint8Array(1024), spSpy: new Uint8Array(1024), spCred: new Uint8Array(1024), spOff: [], spN: [], spUsed: 0,
    stMass: new Float32Array(1024), stOff: [], stN: [], stUsed: 0,
    diag: {
      crises: 0, coerced: 0, tributes: 0, deterred: 0, deterredLogged: 0, wars: 0, byMotive: [0, 0, 0, 0, 0, 0, 0], bluffs: 0, bluffsExposed: 0, bluffsUnpaid: 0,
      spiesCaught: 0, secret: 0, revealedJoin: 0, revealedSpies: 0, doubleDealt: 0, forged: 0, forgedExposed: 0, battles: 0, updates: 0, preventF: 0, overaweBluff: 0,
    },
  }
}

/** Per-polity arrays cover ids < need. */
export function ensureBelPolities(bel: BeliefState, need: number): void {
  if (need <= bel.pcap) return
  let size = bel.pcap
  while (size < need) size *= 2
  bel.bluff = growF(bel.bluff, size, 0)
  bel.bluffUntil = growI(bel.bluffUntil, size, 0)
  bel.bluffFrom = growI(bel.bluffFrom, size, 0)
  bel.cred = growF(bel.cred, size, 1)
  bel.spy = growF(bel.spy, size, 0)
  bel.counter = growF(bel.counter, size, 0)
  bel.massPrev = growF(bel.massPrev, size, 0)
  bel.pcap = size
}

/** Pair rows cover relations < R. */
export function ensureBelRows(bel: BeliefState, R: number): void {
  const n = 2 * R
  while (bel.est.length < n) {
    bel.est.push(0); bel.varL.push(0); bel.trend.push(1); bel.prev.push(0); bel.seen.push(-1); bel.src.push(0); bel.hard.push(0); bel.caught.push(-100000); bel.hrow.push(-1)
  }
  while (bel.forged.length < n) { bel.forged.push(0); bel.forgedAt.push(-1) }
}
