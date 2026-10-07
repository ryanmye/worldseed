// landmarks: state of the landmarks system (one object, made once in a single literal so it keeps fast properties:
// per-settlement and per-polity typed arrays grown by doubling, the landmarks and their changes as plain arrays in order).
// Names are not made here: assemble.ts names each landmark from what was known at its begun year.

import type { Rng } from '../../rng.ts'
import { createRng } from '../../rng.ts'
import type { HistoryState } from '../state.ts'

export const NEVER = -1000000
/** How many of the world's largest towns the scans rank (LANDMARK's ...Rank thresholds are at most this). */
export const TOP_TOWNS = 32

export interface LandmarksState {
  rng: Rng
  // --- Per settlement (capacity `cap`; ids [0, seen) set) ---
  cap: number
  seen: number
  /** The settlement's landmarks as a list in begun order: first and last landmark (-1), lNext links them. */
  head: Int32Array
  tail: Int32Array
  /** Bit per great LandmarkKind: one begun there and not given up unfinished (a town has one of each kind at most; monuments and tombs aside). */
  has: Int32Array
  /** Year since which it has had LANDMARK.templePop people (-1), and LANDMARK.shrinePop people under a traditional faith (-1). */
  bigSince: Int32Array
  shrineSince: Int32Array
  /** Last year it was taken in war or besieged; last scan year it was a capital. */
  warYear: Int32Array
  lastCap: Int32Array
  /** Year a craft tradition seated there became renowned (-1), and the tradition. */
  renowned: Int32Array
  renownT: Int32Array
  /** Scratch: the faith whose holy city it is at this scan (-1); the scan year it was an end of an ocean lane. */
  holyAt: Int32Array
  laneMark: Int32Array
  /** An abandoned town with landmarks: the first settlement founded on or beside its cell after it was given up (-1): its heir. */
  heir: Int32Array
  // --- Per polity (capacity pcap) ---
  pcap: number
  /** The ruler who founded a monastery (one per reign), who raised a victory monument (one per reign). */
  monkRuler: Int32Array
  monuRuler: Int32Array
  /** Scratch per scan: tier, and the largest town eligible for a monastery (-1). */
  tierP: Int32Array
  monkBest: Int32Array
  // --- Per faith: building tradition (LandmarkForm, 255 unseen), variant, 1 for a hot dry homeland ---
  faithForm: number[]
  faithVariant: number[]
  faithHot: number[]
  /** Holy cities marked at the last scan (to clear). */
  holyList: number[]
  // --- Per cell: the abandoned town with landmarks there (-1), for a town founded on or beside its ruins ---
  ruinAt: Int32Array
  // --- Per long-haul leg: deep-sea cells on its path (-1 not counted) ---
  legOcean: number[]
  // --- Landmarks, in begun order (History.landmarks rows) ---
  lKind: number[]
  lRank: number[]
  lForm: number[]
  lVariant: number[]
  /** Its town now (lHome until a town refounded on or beside its ruin took it over), and the town it was begun in. */
  lSett: number[]
  lHome: number[]
  lCell: number[]
  lBegun: number[]
  /** Year finished (-1). */
  lDone: number[]
  lPol: number[]
  lRuler: number[]
  lDyn: number[]
  lFaith: number[]
  lPeople: number[]
  /** Settlement whose language names it (the builders' seat, or the town itself). */
  lLang: number[]
  /** What it honours beyond the builder: the tradition (Guildhall), -1. */
  lSubject: number[]
  /** State now, the year it entered it, the faith it serves now. */
  lState: number[]
  lSince: number[]
  lCur: number[]
  /** Peak of its town's people since it was finished (neglect); year since its town has been far below it (-1). */
  lRef: number[]
  lLow: number[]
  /** Year due: completion while building, ruin while neglected. */
  lDue: number[]
  /** 1 for a seat of government (a capital's castle, a palace, a council house): neglected when its town stops being a capital. */
  lSeat: number[]
  lNext: number[]
  /** Works in progress (landmark ids, in begun order). */
  building: number[]
  // --- Changes, in order (History.landmarks change rows) ---
  cLm: number[]
  cYear: number[]
  cState: number[]
  cFaith: number[]
  cPol: number[]
  /** The event's `other` (great landmarks). */
  cOther: number[]
  /** The landmark's town after the change (its town then, or the heir that took it over). */
  cTown: number[]
  /** Events already scanned. */
  evSeen: number
  /** Mean wealth per head of the world's towns at the last scan. */
  worldWpc: number
  /** Great landmarks begun so far (the world's crowding: LANDMARK.crowdFrom, crowdTo). */
  greatN: number
  /** Populations of the world's TOP_TOWNS largest living towns at the last scan, descending (0 where fewer). */
  top: Float64Array
  diag: LandmarksDiag
}

export interface LandmarksDiag {
  scans: number
  forced: number
  fortTowns: number
  monkChances: number
  sackRolls: number
  stateConversions: number
  conquestConversions: number
  revived: number
}

export function createLandmarksState(s: HistoryState): LandmarksState {
  const cap = 256, pcap = 64
  const st = {
    rng: createRng(s.world.seed, 'history-landmarks'),
    cap, seen: 0,
    head: new Int32Array(cap).fill(-1), tail: new Int32Array(cap).fill(-1), has: new Int32Array(cap),
    bigSince: new Int32Array(cap).fill(-1), shrineSince: new Int32Array(cap).fill(-1), warYear: new Int32Array(cap).fill(NEVER), lastCap: new Int32Array(cap).fill(NEVER),
    renowned: new Int32Array(cap).fill(-1), renownT: new Int32Array(cap).fill(-1), holyAt: new Int32Array(cap).fill(-1), laneMark: new Int32Array(cap).fill(NEVER), heir: new Int32Array(cap).fill(-1),
    ruinAt: new Int32Array(s.terrain.cellCount).fill(-1),
    pcap, monkRuler: new Int32Array(pcap).fill(-1), monuRuler: new Int32Array(pcap).fill(-1), tierP: new Int32Array(pcap), monkBest: new Int32Array(pcap).fill(-1),
    faithForm: [] as number[], faithVariant: [] as number[], faithHot: [] as number[], holyList: [] as number[],
    legOcean: [] as number[],
    lKind: [] as number[], lRank: [] as number[], lForm: [] as number[], lVariant: [] as number[], lSett: [] as number[], lHome: [] as number[], lCell: [] as number[], lBegun: [] as number[], lDone: [] as number[],
    lPol: [] as number[], lRuler: [] as number[], lDyn: [] as number[], lFaith: [] as number[], lPeople: [] as number[], lLang: [] as number[], lSubject: [] as number[],
    lState: [] as number[], lSince: [] as number[], lCur: [] as number[], lRef: [] as number[], lLow: [] as number[], lDue: [] as number[], lSeat: [] as number[], lNext: [] as number[],
    building: [] as number[],
    cLm: [] as number[], cYear: [] as number[], cState: [] as number[], cFaith: [] as number[], cPol: [] as number[], cOther: [] as number[], cTown: [] as number[],
    evSeen: 0, greatN: 0, worldWpc: 0, top: new Float64Array(TOP_TOWNS),
    diag: { scans: 0, forced: 0, fortTowns: 0, monkChances: 0, sackRolls: 0, stateConversions: 0, conquestConversions: 0, revived: 0 },
  }
  return st
}

function grow<T extends Int32Array | Float64Array>(a: T, size: number, fill = 0): T {
  const b = new (a.constructor as { new (n: number): T })(size)
  if (fill !== 0) b.fill(fill)
  b.set(a)
  return b
}

export function ensureLandmarkSettlements(lm: LandmarksState, need: number): void {
  if (need <= lm.cap) return
  let size = lm.cap
  while (size < need) size *= 2
  lm.head = grow(lm.head, size, -1)
  lm.tail = grow(lm.tail, size, -1)
  lm.has = grow(lm.has, size)
  lm.bigSince = grow(lm.bigSince, size, -1)
  lm.shrineSince = grow(lm.shrineSince, size, -1)
  lm.warYear = grow(lm.warYear, size, NEVER)
  lm.lastCap = grow(lm.lastCap, size, NEVER)
  lm.renowned = grow(lm.renowned, size, -1)
  lm.renownT = grow(lm.renownT, size, -1)
  lm.holyAt = grow(lm.holyAt, size, -1)
  lm.laneMark = grow(lm.laneMark, size, NEVER)
  lm.heir = grow(lm.heir, size, -1)
  lm.cap = size
}

export function ensureLandmarkPolities(lm: LandmarksState, need: number): void {
  if (need <= lm.pcap) return
  let size = lm.pcap
  while (size < need) size *= 2
  lm.monkRuler = grow(lm.monkRuler, size, -1)
  lm.monuRuler = grow(lm.monuRuler, size, -1)
  lm.tierP = grow(lm.tierP, size)
  lm.monkBest = grow(lm.monkBest, size, -1)
  lm.pcap = size
}
