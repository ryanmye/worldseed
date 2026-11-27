// beliefs: the History tables at assembly (beliefs-and-deception.md §3.11). All empty when beliefs is off.

import type { Beliefs } from '../../../contract.ts'
import { BELIEF } from './params.ts'
import type { BeliefState } from './state.ts'

export interface BeliefHistory {
  strength: Float32Array
  beliefs: Beliefs
  beliefEst: Float32Array
  beliefSd: Uint8Array
  beliefSource: Uint8Array
  bluffShown: Uint8Array
  spyService: Uint8Array
  credibility: Uint8Array
}

export function emptyBeliefHistory(): BeliefHistory {
  return {
    strength: new Float32Array(0), beliefs: { count: 0, observer: new Int16Array(0), target: new Int16Array(0), from: new Int16Array(0) },
    beliefEst: new Float32Array(0), beliefSd: new Uint8Array(0), beliefSource: new Uint8Array(0), bluffShown: new Uint8Array(0), spyService: new Uint8Array(0), credibility: new Uint8Array(0),
  }
}

/** The belief tables up to year `years` (P polities, snapshotCount main snapshots). */
export function assembleBeliefs(bel: BeliefState, P: number, years: number, snapshotCount: number): BeliefHistory {
  const strength = new Float32Array(snapshotCount * P)
  for (let q = 0; q < snapshotCount && q < bel.stOff.length; q++) strength.set(bel.stMass.subarray(bel.stOff[q], bel.stOff[q] + bel.stN[q]), q * P)
  const n = bel.hObs.length
  const beliefs: Beliefs = { count: n, observer: Int16Array.from(bel.hObs), target: Int16Array.from(bel.hTgt), from: Int16Array.from(bel.hFrom) }
  const Q = Math.floor(years / BELIEF.snapStep) + 1
  const beliefEst = new Float32Array(Q * n), beliefSd = new Uint8Array(Q * n), beliefSource = new Uint8Array(Q * n)
  for (let i = 0; i < bel.snQ.length; i++) {
    const q = bel.snQ[i]
    if (q >= Q) continue
    const o = bel.snOff[i], m = bel.snN[i]
    beliefEst.set(bel.snEst.subarray(o, o + m), q * n)
    beliefSd.set(bel.snSd.subarray(o, o + m), q * n)
    beliefSource.set(bel.snSrc.subarray(o, o + m), q * n)
  }
  const bluffShown = new Uint8Array(Q * P), spyService = new Uint8Array(Q * P), credibility = new Uint8Array(Q * P)
  for (let i = 0; i < bel.snQ.length; i++) {
    const q = bel.snQ[i]
    if (q >= Q) continue
    const o = bel.spOff[i], m = bel.spN[i]
    bluffShown.set(bel.spBluff.subarray(o, o + m), q * P)
    spyService.set(bel.spSpy.subarray(o, o + m), q * P)
    credibility.set(bel.spCred.subarray(o, o + m), q * P)
  }
  return { strength, beliefs, beliefEst, beliefSd, beliefSource, bluffShown, spyService, credibility }
}

/** Wars.believed / actual / motive (empty when off). */
export function beliefWarCols(bel: BeliefState | null, W: number): { believed: Float32Array; actual: Float32Array; motive: Uint8Array } {
  if (bel === null) return { believed: new Float32Array(0), actual: new Float32Array(0), motive: new Uint8Array(0) }
  const believed = new Float32Array(W).fill(-1), actual = new Float32Array(W).fill(-1), motive = new Uint8Array(W)
  for (let w = 0; w < W && w < bel.wBel.length; w++) { believed[w] = bel.wBel[w]; actual[w] = bel.wTrue[w]; motive[w] = bel.wMotive[w] }
  return { believed, actual, motive }
}

/** Bonds.known (empty when off): the start year for a public bond, -1 for a secret never revealed, else the year revealed. */
export function beliefBondKnown(bel: BeliefState | null, start: readonly number[]): Int16Array {
  if (bel === null) return new Int16Array(0)
  const B = start.length
  const known = new Int16Array(B)
  for (let k = 0; k < B; k++) known[k] = k < bel.bKnown.length && bel.bKnown[k] !== -2 ? bel.bKnown[k] : start[k]
  return known
}
