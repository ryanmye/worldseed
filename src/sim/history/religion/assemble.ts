// religion: the contract tables (History.faiths, faith, faithShare, stateFaith, holyWars) copied out at assembly with names
// (names/rulerNames.ts nameFaiths); every array owns its buffer.

import type { Faith, FaithKind, World } from '../../../contract.ts'
import type { SettlementNaming } from '../../names/index.ts'
import { nameFaiths } from '../../names/rulerNames.ts'
import type { ReligionState } from './state.ts'

export interface ReligionHistory {
  faiths: Faith[]
  faith: Uint8Array
  faithShare: Uint8Array
  stateFaith: Uint8Array
  holyWars: Int32Array
}

export function emptyReligionHistory(): ReligionHistory {
  return { faiths: [], faith: new Uint8Array(0), faithShare: new Uint8Array(0), stateFaith: new Uint8Array(0), holyWars: new Int32Array(0) }
}

const r4 = (x: number): number => Math.round(x * 10000) / 10000

/** The tables as of now: snapshotCount snapshots of S settlements and P polities. */
export function assembleReligion(world: World, rel: ReligionState, naming: SettlementNaming, peopleNames: readonly string[], snapshotCount: number, S: number, P: number): ReligionHistory {
  const F = rel.kind.length
  const like = []
  for (let f = 0; f < F; f++) like.push({ traditional: rel.kind[f] === 0, people: rel.people[f], foundedAt: rel.foundAt[f] })
  const names = nameFaiths(world, naming, like, peopleNames)
  const faiths: Faith[] = []
  for (let f = 0; f < F; f++) {
    faiths.push({
      id: f, name: names[f], kind: rel.kind[f] as FaithKind, parent: rel.parent[f], people: rel.people[f], foundedAt: rel.foundAt[f], foundedYear: rel.foundYear[f],
      holyCity: rel.holy[f], zeal: r4(rel.zeal[f]), organisation: r4(rel.org[f]), appeal: r4(rel.appeal[f]), endedYear: rel.endYear[f],
    })
  }
  const faith = new Uint8Array(snapshotCount * S).fill(255), faithShare = new Uint8Array(snapshotCount * S)
  for (let q = 0; q < snapshotCount; q++) {
    faith.set(rel.snF.subarray(rel.snOff[q], rel.snOff[q] + rel.snCount[q]), q * S)
    faithShare.set(rel.snS.subarray(rel.snOff[q], rel.snOff[q] + rel.snCount[q]), q * S)
  }
  const stateFaith = new Uint8Array(snapshotCount * P)
  for (let q = 0; q < snapshotCount; q++) stateFaith.set(rel.stF.subarray(rel.stOff[q], rel.stOff[q] + rel.stCount[q]), q * P)
  const hw = rel.holyWars.slice().sort((a, b) => a - b)
  return { faiths, faith, faithShare, stateFaith, holyWars: Int32Array.from(hw) }
}
