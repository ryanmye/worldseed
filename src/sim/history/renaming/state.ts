// renaming: state of the renaming system (one object, made once: per-settlement typed arrays grown by doubling, the
// decisions in order as plain arrays). Names are not strings here: a name is an identity (a decision's index k >= 0, or
// -(id + 2) for settlement id's founding name), and the strings are made at assembly (assemble.ts).

import type { Rng } from '../../rng.ts'
import { createRng } from '../../rng.ts'
import type { HistoryState } from '../state.ts'

/** Identity of settlement id's founding name. */
export const foundingIdent = (id: number): number => -(id + 2)
/** No name (restoreIdent of a decision that gives a new one). */
export const NO_IDENT = -1

/** Kinds of a pending seat candidate. */
export const Seat = { Moved: 0, Imperial: 1, FaithCapital: 2, FaithHoly: 3 } as const

export interface RenamingState {
  rng: Rng
  // --- Per settlement (capacity `cap`; ids [0, seen) set) ---
  cap: number
  seen: number
  /** People whose language the name in use is in; year it was given; the decision that gave it (-1 the founding name) and its identity. */
  lang: Int32Array
  since: Int32Array
  rec: Int32Array
  ident: Int32Array
  /** 1 once the settlement has been a seat of government. */
  capEver: Uint8Array
  /** Peak population (ruins). */
  peak: Float64Array
  /** Pending conquest: year due (-1 none), the conqueror, the year of the conquest, the war, flags (CF_*), the holy city's faith taken (-1). */
  cDue: Int32Array
  cPol: Int32Array
  cYear: Int32Array
  cWar: Int32Array
  cFlags: Uint8Array
  cHoly: Int32Array
  inPend: Uint8Array
  /** Restoration: 1 while liberated (edge-triggered roll); the year due (-1), the name to restore, the liberator (-1). */
  freed: Uint8Array
  rDue: Int32Array
  rIdent: Int32Array
  rPol: Int32Array
  /** 1 once the fall of the honoured house was judged for the name in use. */
  hfDone: Uint8Array
  inRenamed: Uint8Array
  /** Revival: the ruin a newcomer stands on (-1), and 1 once a ruin's name was taken. */
  rvRuin: Int32Array
  rvTaken: Uint8Array
  // --- Per cell ---
  /** Last abandoned settlement of note on the cell, -1. */
  ruinAt: Int32Array
  // --- Per polity (capacity pcap) ---
  pcap: number
  empire: Uint8Array
  // --- Lists ---
  /** Settlements with a pending conquest, renamed settlements (alive), newcomers on ruins, in order added. */
  pend: number[]
  renamed: number[]
  revive: number[]
  /** Pending seat candidates: settlement, polity, year due, Seat kind, faith. */
  sId: number[]
  sPol: number[]
  sDue: number[]
  sKind: number[]
  sFaith: number[]
  /** Trading posts already judged for a trade name (by post id). */
  tradeDone: Uint8Array
  /** Events already scanned. */
  evSeen: number
  // --- Decisions, in order (History.renamings before the Distinguished entries are woven in) ---
  ySettlement: number[]
  yYear: number[]
  yCause: number[]
  yForm: number[]
  yPolity: number[]
  yRuler: number[]
  yDynasty: number[]
  yFaith: number[]
  /** Settlement whose language the name is made in (the polity's seat of its ruling people, the traders' home), -1 (restored, revived). */
  yLang: number[]
  yPeople: number[]
  /** Decision whose name this replaces (-1 the founding name), the identity of the new name, the identity restored (NO_IDENT a new name). */
  yPrev: number[]
  yIdent: number[]
  yRestore: number[]
  ySource: number[]
  yKept: number[]
  /** Settlement of the event's `other`: the polity's capital at the year, the ruin, -1. */
  yOther: number[]
  diag: RenamingDiag
}

export interface RenamingDiag {
  /** Conquest candidates scheduled, and those judged while still held. */
  conquests: number
  judged: number
  treaties: number
  seats: number
  liberations: number
  houseFalls: number
  ruinsFound: number
  factoriesJudged: number
}

export function createRenamingState(s: HistoryState): RenamingState {
  const cap = 256, pcap = 64
  const st = {
    rng: createRng(s.world.seed, 'history-renaming'),
    cap, seen: 0,
    lang: new Int32Array(cap), since: new Int32Array(cap), rec: new Int32Array(cap).fill(-1), ident: new Int32Array(cap), capEver: new Uint8Array(cap), peak: new Float64Array(cap),
    cDue: new Int32Array(cap).fill(-1), cPol: new Int32Array(cap).fill(-1), cYear: new Int32Array(cap), cWar: new Int32Array(cap).fill(-1), cFlags: new Uint8Array(cap), cHoly: new Int32Array(cap).fill(-1), inPend: new Uint8Array(cap),
    freed: new Uint8Array(cap), rDue: new Int32Array(cap).fill(-1), rIdent: new Int32Array(cap).fill(-1), rPol: new Int32Array(cap).fill(-1), hfDone: new Uint8Array(cap), inRenamed: new Uint8Array(cap),
    rvRuin: new Int32Array(cap).fill(-1), rvTaken: new Uint8Array(cap),
    ruinAt: new Int32Array(s.terrain.cellCount).fill(-1),
    pcap, empire: new Uint8Array(pcap),
    pend: [] as number[], renamed: [] as number[], revive: [] as number[],
    sId: [] as number[], sPol: [] as number[], sDue: [] as number[], sKind: [] as number[], sFaith: [] as number[],
    tradeDone: new Uint8Array(64), evSeen: 0,
    ySettlement: [] as number[], yYear: [] as number[], yCause: [] as number[], yForm: [] as number[], yPolity: [] as number[], yRuler: [] as number[], yDynasty: [] as number[], yFaith: [] as number[],
    yLang: [] as number[], yPeople: [] as number[], yPrev: [] as number[], yIdent: [] as number[], yRestore: [] as number[], ySource: [] as number[], yKept: [] as number[], yOther: [] as number[],
    diag: { conquests: 0, judged: 0, treaties: 0, seats: 0, liberations: 0, houseFalls: 0, ruinsFound: 0, factoriesJudged: 0 },
  }
  return st
}

function grow<T extends Int32Array | Float64Array | Uint8Array>(a: T, size: number, fill = 0): T {
  const b = new (a.constructor as { new (n: number): T })(size)
  if (fill !== 0) b.fill(fill)
  b.set(a)
  return b
}

export function ensureRenamingSettlements(rn: RenamingState, need: number): void {
  if (need <= rn.cap) return
  let size = rn.cap
  while (size < need) size *= 2
  rn.lang = grow(rn.lang, size)
  rn.since = grow(rn.since, size)
  rn.rec = grow(rn.rec, size, -1)
  rn.ident = grow(rn.ident, size)
  rn.capEver = grow(rn.capEver, size)
  rn.peak = grow(rn.peak, size)
  rn.cDue = grow(rn.cDue, size, -1)
  rn.cPol = grow(rn.cPol, size, -1)
  rn.cYear = grow(rn.cYear, size)
  rn.cWar = grow(rn.cWar, size, -1)
  rn.cFlags = grow(rn.cFlags, size)
  rn.cHoly = grow(rn.cHoly, size, -1)
  rn.inPend = grow(rn.inPend, size)
  rn.freed = grow(rn.freed, size)
  rn.rDue = grow(rn.rDue, size, -1)
  rn.rIdent = grow(rn.rIdent, size, -1)
  rn.rPol = grow(rn.rPol, size, -1)
  rn.hfDone = grow(rn.hfDone, size)
  rn.inRenamed = grow(rn.inRenamed, size)
  rn.rvRuin = grow(rn.rvRuin, size, -1)
  rn.rvTaken = grow(rn.rvTaken, size)
  rn.cap = size
}

export function ensureRenamingPolities(rn: RenamingState, need: number): void {
  if (need <= rn.pcap) return
  let size = rn.pcap
  while (size < need) size *= 2
  rn.empire = grow(rn.empire, size)
  rn.pcap = size
}

export function ensureTradeDone(rn: RenamingState, need: number): void {
  if (need <= rn.tradeDone.length) return
  let size = rn.tradeDone.length
  while (size < need) size *= 2
  rn.tradeDone = grow(rn.tradeDone, size)
}
