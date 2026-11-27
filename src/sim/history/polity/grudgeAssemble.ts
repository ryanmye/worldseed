// grudges and oaths, balance, arms: snapshots during the run and the History tables at assembly (grievances, faithless, arms,
// armsRaces, and the Wars columns cause / ally / race). Empty or -1 when the switches are off.

import type { ArmsRaces, Grievances } from '../../../contract.ts'
import { OATH } from './params.ts'
import type { PolityState } from './state.ts'
import type { GrudgeState } from './grudgeState.ts'
import { at } from './grudgeState.ts'
import { assembleGrievances } from './grievances.ts'

const byte = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0)

function growU8(a: Uint8Array<ArrayBuffer>, need: number): Uint8Array<ArrayBuffer> {
  if (need <= a.length) return a
  let size = a.length
  while (size < need) size *= 2
  const b = new Uint8Array(size)
  b.set(a)
  return b
}

/** Snapshot hook (with polSnapshot): each polity's faithless score and armament. */
export function grudgeSnapshot(ps: PolityState, og: GrudgeState): void {
  const P = ps.P
  og.snapFaith = growU8(og.snapFaith, og.sUsed + P)
  og.snapArms = growU8(og.snapArms, og.sUsed + P)
  const o = og.sUsed
  for (let p = 0; p < P; p++) {
    const live = ps.pEnded[p] < 0
    og.snapFaith[o + p] = live ? byte(at(og.faith, p, 0) / OATH.repMax) : 0
    og.snapArms[o + p] = live ? byte(at(og.pArms, p, 0)) : 0
  }
  og.sOff.push(o)
  og.sCount.push(P)
  og.sUsed += P
}

export interface GrudgeHistory {
  grievances: Grievances
  faithless: Uint8Array
  arms: Uint8Array
  armsRaces: ArmsRaces
}

function racesOf(og: GrudgeState | null): ArmsRaces {
  const n = og === null ? 0 : og.raA.length
  const levelOff = new Int32Array(n + 1)
  let L = 0
  for (let i = 0; i < n; i++) { levelOff[i] = L; L += og!.raLevel[i].length }
  levelOff[n] = L
  const level = new Uint8Array(L)
  const r: ArmsRaces = {
    count: n, a: new Int16Array(n), b: new Int16Array(n), start: new Int16Array(n), end: new Int16Array(n), endCause: new Uint8Array(n),
    war: new Int32Array(n), peak: new Uint8Array(n), peakYear: new Int16Array(n), levelOff, level,
  }
  if (og === null) return r
  for (let i = 0; i < n; i++) {
    r.a[i] = og.raA[i]; r.b[i] = og.raB[i]; r.start[i] = og.raStart[i]; r.end[i] = og.raEnd[i]; r.endCause[i] = og.raCause[i]
    r.war[i] = og.raWar[i]; r.peak[i] = og.raPeak[i]; r.peakYear[i] = og.raPeakY[i]
    level.set(og.raLevel[i], levelOff[i])
  }
  return r
}

/** The tables at assembly (`snapshotCount` snapshots of ps.P polities). */
export function assembleGrudges(ps: PolityState | null, snapshotCount: number): GrudgeHistory {
  const og = ps !== null ? ps.og : null
  const PP = ps !== null ? ps.P : 0
  const faithless = new Uint8Array(ps !== null ? snapshotCount * PP : 0)
  const arms = new Uint8Array(ps !== null ? snapshotCount * PP : 0)
  if (og !== null) {
    for (let q = 0; q < snapshotCount && q < og.sOff.length; q++) {
      faithless.set(og.snapFaith.subarray(og.sOff[q], og.sOff[q] + og.sCount[q]), q * PP)
      arms.set(og.snapArms.subarray(og.sOff[q], og.sOff[q] + og.sCount[q]), q * PP)
    }
  }
  return { grievances: assembleGrievances(og), faithless, arms, armsRaces: racesOf(og) }
}

/** Wars.cause, ally and race (-1 where unset). */
export function warLinks(ps: PolityState, W: number): { cause: Int32Array; ally: Int32Array; race: Int32Array } {
  const cause = new Int32Array(W).fill(-1), ally = new Int32Array(W).fill(-1), race = new Int32Array(W).fill(-1)
  const og = ps.og
  if (og !== null) for (let w = 0; w < W; w++) { cause[w] = at(og.wCause, w, -1); ally[w] = at(og.wAlly, w, -1); race[w] = at(og.wRace, w, -1) }
  return { cause, ally, race }
}
