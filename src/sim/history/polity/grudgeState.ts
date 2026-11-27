// grudges and oaths: the state of the three switches (HistoryOptions.oaths, balance, arms; grudges-and-oaths.md), kept apart from
// PolityState's literals (ps.og, null when all three are off). Per-relation, per-war and per-polity arrays grow lazily with
// defaults (-1 / 0), so no existing push site (ensureRelation, declare, newPolity) has to know about them, and a run with the
// switches off never touches them.

import type { Rng } from '../../rng.ts'
import { createRng } from '../../rng.ts'

export interface GrudgeDiag {
  grievances: number
  avenged: number
  inherited: number
  trucesBroken: number
  alliesAttacked: number
  betrayals: number
  separatePeace: number
  turned: number
  revengeWars: number
  /** Mean delta at oath decisions (sum and count) and at breaks; breaks with delta < 0.6. */
  deltaSum: number
  deltaN: number
  breakDeltaSum: number
  breakDeltaN: number
  breaksByLowDelta: number
  /** Oath checks (truce, ally attack, defection) with E > 0, and E's quartiles' sample (every 8th check, for tuning). */
  excessPos: number
  excessSample: number[]
  /** balance: alliances formed by the threat rule, those against the hegemon, bandwagons. */
  balancing: number
  coalitionAlliances: number
  bandwagonAlly: number
  bandwagonTribute: number
  /** arms: races opened, ended in war, eased; pair-steps at the cap (x >= 0.95 max) for more than 30 years. */
  races: number
  racesWar: number
  racesEased: number
  armsCapYears: number
}

export interface GrudgeState {
  oaths: boolean
  balance: boolean
  arms: boolean
  /** 'history-oaths' (oaths on), 'history-align' (balance on). */
  rng: Rng | null
  rngAlign: Rng | null

  // --- Grievance rows (grievances.ts), in order of recording ---
  gKind: number[]
  gWronged: number[]
  gOffender: number[]
  gYear: number[]
  /** Weight when recorded (grown by merging), and now. */
  gW0: number[]
  gW: number[]
  gEnd: number[]
  gEndCause: number[]
  gSite: number[]
  gWar: number[]
  gTowns: number[]
  gHeir: number[]
  /** Open rows, ascending. */
  gActive: number[]
  /** 1 for a row a successor took up (lazy). */
  gPassed: number[]
  /** Events already scanned for holy cities fallen. */
  gEvSeen: number
  /** Directed pair (wronged * 65536 + offender) -> G, and -> the open row of most weight. Lookup only, never iterated. */
  gSum: Map<number, number>
  gBest: Map<number, number>

  // --- Lazy per-relation arrays (index = relation) ---
  /** The war whose peace swore the truce in force (-1: a truce of secession, partition or civil war, or none). */
  relOath: number[]
  /** Trade loads a year between the pair (relationStep's v, this slow step), or null before the first. */
  relVol: Float64Array | null
  /** balance: cached theta(a -> b) and theta(b -> a) this slow step (relA = a). */
  relThrAB: number[]
  relThrBA: number[]
  /** arms: x (a against b), y (b against a), their values one slow step back, the open race (-1). */
  relX: number[]
  relY: number[]
  relPX: number[]
  relPY: number[]
  relRace: number[]
  /** arms: years both have sat at the cap (diag). */
  relCap: number[]

  // --- Lazy per-polity arrays (index = polity) ---
  /** The faithless score f (0..OATH.repMax). */
  faith: number[]
  /** balance: start years of the conquest wars it started (recent window). */
  aggrYears: number[][]
  /** arms: armament M_p. */
  pArms: number[]
  /** balance: the current hegemon (-1). */
  hegemon: number

  // --- Lazy per-war arrays (index = war) ---
  wCause: number[]
  wAlly: number[]
  wRace: number[]

  // --- Arms races ---
  raA: number[]
  raB: number[]
  raStart: number[]
  raEnd: number[]
  raCause: number[]
  raWar: number[]
  raPeak: number[]
  raPeakY: number[]
  raLevel: number[][]

  // --- Snapshots (ragged over polity ids: snapshot q holds ids [0, sCount[q]) from sOff[q]) ---
  snapFaith: Uint8Array<ArrayBuffer>
  snapArms: Uint8Array<ArrayBuffer>
  sUsed: number
  sOff: number[]
  sCount: number[]

  diag: GrudgeDiag
}

export function createGrudgeState(seed: number, oaths: boolean, balance: boolean, arms: boolean): GrudgeState {
  return {
    oaths, balance, arms,
    rng: oaths ? createRng(seed, 'history-oaths') : null,
    rngAlign: balance ? createRng(seed, 'history-align') : null,
    gKind: [], gWronged: [], gOffender: [], gYear: [], gW0: [], gW: [], gEnd: [], gEndCause: [], gSite: [], gWar: [], gTowns: [], gHeir: [],
    gActive: [], gPassed: [], gEvSeen: 0, gSum: new Map(), gBest: new Map(),
    relOath: [], relVol: null, relThrAB: [], relThrBA: [], relX: [], relY: [], relPX: [], relPY: [], relRace: [], relCap: [],
    faith: [], aggrYears: [], pArms: [], hegemon: -1,
    wCause: [], wAlly: [], wRace: [],
    raA: [], raB: [], raStart: [], raEnd: [], raCause: [], raWar: [], raPeak: [], raPeakY: [], raLevel: [],
    snapFaith: new Uint8Array(1024), snapArms: new Uint8Array(1024), sUsed: 0, sOff: [], sCount: [],
    diag: {
      grievances: 0, avenged: 0, inherited: 0, trucesBroken: 0, alliesAttacked: 0, betrayals: 0, separatePeace: 0, turned: 0, revengeWars: 0,
      deltaSum: 0, deltaN: 0, breakDeltaSum: 0, breakDeltaN: 0, breaksByLowDelta: 0, excessPos: 0, excessSample: [],
      balancing: 0, coalitionAlliances: 0, bandwagonAlly: 0, bandwagonTribute: 0,
      races: 0, racesWar: 0, racesEased: 0, armsCapYears: 0,
    },
  }
}

/** a[i], or `d` beyond its length. */
export function at(a: readonly number[], i: number, d: number): number {
  return i < a.length ? a[i] : d
}

/** Sets a[i] = v, growing a with `d`. */
export function put(a: number[], i: number, v: number, d: number): void {
  while (a.length <= i) a.push(d)
  a[i] = v
}

/** Directed pair key. */
export function dkey(p: number, q: number): number {
  return p * 65536 + q
}
