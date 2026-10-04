// religion: state of the religion system: the faiths, each settlement's followers (RELIGION.slots faiths with shares),
// state religions and persecutions per polity, and the snapshots. Every draw comes from 'history-religion'.

import type { Rng } from '../../rng.ts'
import { createRng } from '../../rng.ts'
import type { HistoryState } from '../state.ts'
import { RELIGION } from './params.ts'

export const K = RELIGION.slots

export interface ReligionState {
  rng: Rng
  // --- Per settlement (capacity cap; ids [0, seen) set) ---
  cap: number
  seen: number
  fN: Uint8Array
  fId: Int16Array
  fSh: Float64Array
  /** Year a settlement first followed a universal faith in its majority (-1), for the stats. */
  firstUni: Int32Array
  /** Year of the last sack, conquest or plague (founding crises). */
  woe: Int32Array
  // --- Faiths ---
  kind: number[]
  parent: number[]
  people: number[]
  foundAt: number[]
  foundYear: number[]
  holy: number[]
  zeal: number[]
  org: number[]
  appeal: number[]
  endYear: number[]
  /** Followers at the last step, and the settlement holding most of them. */
  followers: number[]
  peak: number[]
  stronghold: number[]
  /** Pilgrims' income a year at the holy city (last step). */
  pilgrims: number[]
  /** 1 once a faith reached a people: reached[f * P + people] (grown with the faiths). */
  reached: Uint8Array
  // --- Per polity (capacity pcap) ---
  pcap: number
  state: Int32Array
  persUntil: Int32Array
  persFaith: Int32Array
  persRuler: Int32Array
  /** Majority universal faith of each people (monasteries), -1. */
  peopleFaith: Int32Array
  // --- Exposure scratch per settlement: up to E entries (faith, weight, source) ---
  eN: Uint8Array
  eF: Int32Array
  eV: Float64Array
  eSrc: Int32Array
  /** Events scanned (foundings, migrations, conquests); indices of our own flight Migration events (mixed already). */
  evSeen: number
  skip: number[]
  holyWars: number[]
  // --- Snapshots (ragged, like the polity snapshots) ---
  snF: Uint8Array
  snS: Uint8Array
  snUsed: number
  snOff: number[]
  snCount: number[]
  stF: Uint8Array
  stUsed: number
  stOff: number[]
  stCount: number[]
  diag: ReligionDiag
}

export interface ReligionDiag {
  conversions: number
  adopted: number
  schisms: number
  persecutions: number
  flights: number
  fled: number
  holyWars: number
  holyFell: number
  founded: number
}

export const E = 6

export function createReligion(s: HistoryState): ReligionState {
  const cap = 256, pcap = 64
  const P = s.know.P
  const a = {
    rng: createRng(s.world.seed, 'history-religion'),
    cap, seen: 0, fN: new Uint8Array(cap), fId: new Int16Array(cap * K), fSh: new Float64Array(cap * K), firstUni: new Int32Array(cap).fill(-1), woe: new Int32Array(cap).fill(-1000000),
    kind: [], parent: [], people: [], foundAt: [], foundYear: [], holy: [], zeal: [], org: [], appeal: [], endYear: [], followers: [], peak: [], stronghold: [], pilgrims: [],
    reached: new Uint8Array(64 * P),
  }
  const b = {
    pcap, state: new Int32Array(pcap).fill(-1), persUntil: new Int32Array(pcap).fill(-1000000), persFaith: new Int32Array(pcap).fill(-1), persRuler: new Int32Array(pcap).fill(-1),
    peopleFaith: new Int32Array(P).fill(-1),
    eN: new Uint8Array(cap), eF: new Int32Array(cap * E), eV: new Float64Array(cap * E), eSrc: new Int32Array(cap * E),
    evSeen: 0, skip: [], holyWars: [],
    snF: new Uint8Array(4096), snS: new Uint8Array(4096), snUsed: 0, snOff: [], snCount: [], stF: new Uint8Array(1024), stUsed: 0, stOff: [], stCount: [],
    diag: { conversions: 0, adopted: 0, schisms: 0, persecutions: 0, flights: 0, fled: 0, holyWars: 0, holyFell: 0, founded: 0 },
  }
  return Object.assign(a, b) as ReligionState
}

function grow<T extends Int32Array | Float64Array | Uint8Array | Int16Array>(a: T, size: number, fill = 0): T {
  const b = new (a.constructor as { new (n: number): T })(size)
  if (fill !== 0) b.fill(fill)
  b.set(a)
  return b
}

export function ensureReligionSettlements(rel: ReligionState, need: number): void {
  if (need <= rel.cap) return
  let size = rel.cap
  while (size < need) size *= 2
  rel.fN = grow(rel.fN, size)
  rel.fId = grow(rel.fId, size * K)
  rel.fSh = grow(rel.fSh, size * K)
  rel.firstUni = grow(rel.firstUni, size, -1)
  rel.woe = grow(rel.woe, size, -1000000)
  rel.eN = grow(rel.eN, size)
  rel.eF = grow(rel.eF, size * E)
  rel.eV = grow(rel.eV, size * E)
  rel.eSrc = grow(rel.eSrc, size * E)
  rel.cap = size
}

export function ensureReligionPolities(rel: ReligionState, need: number): void {
  if (need <= rel.pcap) return
  let size = rel.pcap
  while (size < need) size *= 2
  rel.state = grow(rel.state, size, -1)
  rel.persUntil = grow(rel.persUntil, size, -1000000)
  rel.persFaith = grow(rel.persFaith, size, -1)
  rel.persRuler = grow(rel.persRuler, size, -1)
  rel.pcap = size
}

export function growU8(a: Uint8Array, need: number): Uint8Array {
  if (need <= a.length) return a
  let size = a.length
  while (size < need) size *= 2
  const b = new Uint8Array(size)
  b.set(a)
  return b
}
