// rulers: state of the rulers system: reigns, houses, heirs per realm, laws per people, marriage ties and unions.
//
// Reigns and houses are ragged JS arrays in order of creation (ids never reused, so prefix-stable); per-polity arrays are
// typed and grown by doubling with the polity count; the heir pool is RULERS.heirs slots per polity. Every draw comes
// from 'history-rulers'.

import type { Rng } from '../../rng.ts'
import { createRng } from '../../rng.ts'
import type { HistoryState } from '../state.ts'
import { RULERS } from './params.ts'

/** Context for the next polity founded (set around civil wars and partitions; Ctx.None otherwise). */
export const Ctx = { None: 0, Partition: 1, Civil: 2 } as const

export interface RulerState {
  rng: Rng
  // --- Reigns ---
  rPolity: number[]
  rDyn: number[]
  rFemale: number[]
  rBorn: number[]
  rAcc: number[]
  rEnd: number[]
  rDied: number[]
  rHow: number[]
  rCause: number[]
  rLaw: number[]
  rPred: number[]
  rPerson: number[]
  rParent: number[]
  rAbility: number[]
  rWar: number[]
  rPiety: number[]
  rTol: number[]
  /** Faith at the accession, and now (religion; -1 without it). */
  rFaith0: number[]
  rFaith: number[]
  /** Capital at the accession (naming). */
  rCap: number[]
  /** Scheduled year of a natural death (a league head: the end of the term). */
  rDeath: number[]
  // --- Houses ---
  dFounder: number[]
  dFounded: number[]
  dEnded: number[]
  dHome: number[]
  dPeople: number[]
  /** Vigour of the house's present generation (the dynastic cycle), its temperament (warlike), and its reigns now on a throne. */
  dVigour: number[]
  dWar: number[]
  dThrones: number[]
  // --- Per polity (capacity pcap) ---
  pcap: number
  cur: Int32Array
  /** A cause of death waiting for the next rulers' year (the capital fell, plague), 0 none. */
  kill: Int32Array
  /** The union in which the polity is the junior realm, -1. */
  union: Int32Array
  /** Year of the last war it lost (overthrow). */
  lost: Int32Array
  /** Heir pool: count and slots [p * H + k]: birth and death year, legitimate, woman, child of the present ruler (else a sibling or cousin), the parent's reign. */
  hN: Int32Array
  hBorn: Int32Array
  hDeath: Int32Array
  hLegit: Uint8Array
  hFemale: Uint8Array
  hChild: Uint8Array
  hParent: Int32Array
  // --- Per people ---
  law: Int32Array
  cognatic: Uint8Array
  // --- Marriage ties (in order of making) and the ones in force ---
  mA: number[]
  mB: number[]
  mDA: number[]
  mDB: number[]
  mYear: number[]
  mEnd: number[]
  mActive: number[]
  // --- Personal unions ---
  uSenior: number[]
  uJunior: number[]
  uRuler: number[]
  uStart: number[]
  uEnd: number[]
  uCause: number[]
  uBond: number[]
  uActive: number[]
  /** Wars of succession (war ids, ascending). */
  sWars: number[]
  // --- Context for the next newPolity (civil wars, partitions) ---
  ctx: number
  ctxSrc: number
  ctxDyn: number
  ctxBorn: number
  ctxFemale: number
  ctxDead: number
  /** Events already scanned (lost wars). */
  evSeen: number
  /** Mortality: survival to each whole age (0..MAX_AGE). */
  surv: Float64Array
  diag: RulerDiag
}

export interface RulerDiag {
  successions: number
  clean: number
  regencies: number
  contested: number
  extinct: number
  usurped: number
  partible: number
  civil: number
  partitions: number
  unions: number
  passedOver: number
  wars: number
  marriages: number
}

export const MAX_AGE = 110

/** Survival to each whole age from the hazards of RULERS (multiplication only). */
function survival(): Float64Array {
  const X = RULERS
  const S = new Float64Array(MAX_AGE + 2)
  S[0] = 1
  let g = X.gompertz
  for (let a = 0; a <= MAX_AGE; a++) {
    let h = a === 0 ? X.infant : a < 5 ? X.child : a < 15 ? X.youth : X.adult
    if (a >= 20) { h += g; g *= X.gompertzRate }
    else if (a >= 15) h += X.gompertz * 0.5
    if (h > 1) h = 1
    S[a + 1] = S[a] * (1 - h)
  }
  S[MAX_AGE + 1] = 0
  return S
}

export function createRulers(s: HistoryState): RulerState {
  const P = s.know.P
  const rng = createRng(s.world.seed, 'history-rulers')
  const law = new Int32Array(P), cognatic = new Uint8Array(P)
  for (let p = 0; p < P; p++) { law[p] = drawLaw(rng); cognatic[p] = rng.next() < RULERS.cognatic ? 1 : 0 }
  const pcap = 64, H = RULERS.heirs
  const a = {
    rng,
    rPolity: [], rDyn: [], rFemale: [], rBorn: [], rAcc: [], rEnd: [], rDied: [], rHow: [], rCause: [], rLaw: [], rPred: [], rPerson: [], rParent: [],
    rAbility: [], rWar: [], rPiety: [], rTol: [], rFaith0: [], rFaith: [], rCap: [], rDeath: [],
    dFounder: [], dFounded: [], dEnded: [], dHome: [], dPeople: [], dVigour: [], dWar: [], dThrones: [],
    pcap, cur: new Int32Array(pcap).fill(-1), kill: new Int32Array(pcap), union: new Int32Array(pcap).fill(-1), lost: new Int32Array(pcap).fill(-1000000),
    hN: new Int32Array(pcap), hBorn: new Int32Array(pcap * H), hDeath: new Int32Array(pcap * H), hLegit: new Uint8Array(pcap * H), hFemale: new Uint8Array(pcap * H), hChild: new Uint8Array(pcap * H), hParent: new Int32Array(pcap * H),
    law, cognatic,
    mA: [], mB: [], mDA: [], mDB: [], mYear: [], mEnd: [], mActive: [],
    uSenior: [], uJunior: [], uRuler: [], uStart: [], uEnd: [], uCause: [], uBond: [], uActive: [], sWars: [],
    ctx: Ctx.None, ctxSrc: -1, ctxDyn: -1, ctxBorn: 0, ctxFemale: 0, ctxDead: -1, evSeen: 0,
    surv: survival(),
    diag: { successions: 0, clean: 0, regencies: 0, contested: 0, extinct: 0, usurped: 0, partible: 0, civil: 0, partitions: 0, unions: 0, passedOver: 0, wars: 0, marriages: 0 },
  }
  // (one literal: under 128 properties it stays in fast mode; two joined with Object.assign would not, at this size)
  return a as RulerState
}

/** A law of succession by RULERS.lawWeights. */
export function drawLaw(rng: Rng): number {
  const w = RULERS.lawWeights
  let x = rng.next() * (w[0] + w[1] + w[2] + w[3])
  for (let k = 0; k < 3; k++) { x -= w[k]; if (x < 0) return k }
  return 3
}

function growI32(a: Int32Array, n: number, fill: number): Int32Array {
  const b = new Int32Array(n)
  if (fill !== 0) b.fill(fill)
  b.set(a)
  return b
}
function growU8(a: Uint8Array, n: number): Uint8Array {
  const b = new Uint8Array(n)
  b.set(a)
  return b
}

/** Grows the per-polity arrays to hold `need` polities. */
export function ensureRulerPolities(R: RulerState, need: number): void {
  if (need <= R.pcap) return
  let size = R.pcap
  while (size < need) size *= 2
  const H = RULERS.heirs
  R.cur = growI32(R.cur, size, -1)
  R.kill = growI32(R.kill, size, 0)
  R.union = growI32(R.union, size, -1)
  R.lost = growI32(R.lost, size, -1000000)
  R.hN = growI32(R.hN, size, 0)
  R.hBorn = growI32(R.hBorn, size * H, 0)
  R.hDeath = growI32(R.hDeath, size * H, 0)
  R.hParent = growI32(R.hParent, size * H, 0)
  R.hLegit = growU8(R.hLegit, size * H)
  R.hFemale = growU8(R.hFemale, size * H)
  R.hChild = growU8(R.hChild, size * H)
  R.pcap = size
}

/** Year of death of a person born in `born`, alive in `year`, from one uniform u (at least year + 1: nobody dies the year they are drawn). */
export function deathYear(R: RulerState, born: number, year: number, u: number): number {
  const S = R.surv
  let a0 = year - born
  if (a0 < 0) a0 = 0
  if (a0 > MAX_AGE) return year + 1
  const target = S[a0] * u
  let a = a0
  while (a <= MAX_AGE && S[a + 1] > target) a++
  const y = born + a
  return y > year ? y : year + 1
}
