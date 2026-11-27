// families: History.families from the families' state (names are given at assembly: names/familyNames.ts).

import type { MerchantFamilies } from '../../../contract.ts'
import type { FamilyState } from './state.ts'

/** The empty table (families or goods off). */
export function emptyFamilyHistory(): MerchantFamilies {
  return {
    count: 0, name: [], founded: new Int16Array(0), ended: new Int16Array(0), end: new Uint8Array(0), ruin: new Uint8Array(0), cause: new Uint8Array(0),
    firstHome: new Int32Array(0), parent: new Int32Array(0), people: new Int16Array(0), peakCapital: new Float32Array(0), peakYear: new Int16Array(0),
    seatCount: 0, seatFamily: new Int32Array(0), seatTown: new Int32Array(0), seatKind: new Uint8Array(0), seatFrom: new Int16Array(0), seatTo: new Int16Array(0),
    seatOpen: new Uint8Array(0), seatClose: new Uint8Array(0), seatLeg: new Int32Array(0), seatPost: new Int32Array(0),
    headCount: 0, headFamily: new Int32Array(0), headName: [], headFemale: new Uint8Array(0), headBorn: new Int16Array(0), headFrom: new Int16Array(0),
    headTo: new Int16Array(0), headDied: new Int16Array(0), how: new Uint8Array(0), headAbility: new Uint8Array(0),
    laneCount: 0, laneFamily: new Int32Array(0), laneLeg: new Int32Array(0), laneFrom: new Int16Array(0), laneTo: new Int16Array(0),
    marriageCount: 0, marriageFamily: new Int32Array(0), marriageDynasty: new Int32Array(0), marriagePolity: new Int16Array(0), marriageRuler: new Int32Array(0),
    marriageDaughter: new Uint8Array(0), marriageYear: new Int16Array(0), marriageEnd: new Int16Array(0),
    backCount: 0, backFamily: new Int32Array(0), backWar: new Int32Array(0), backSide: new Uint8Array(0), backOutcome: new Uint8Array(0), backStake: new Float32Array(0),
    patronCount: 0, patronFamily: new Int32Array(0), patronLandmark: new Int32Array(0), patronYear: new Int16Array(0),
    famSnapOffsets: new Uint32Array(1), famSnapFamily: new Int32Array(0), famSnapCapital: new Float32Array(0),
    seatSnapOffsets: new Uint32Array(1), seatSnapSeat: new Int32Array(0), seatSnapCapital: new Float32Array(0),
  }
}

/** History.families up to snapshot Q-1 (`names` from nameFamilies: surnames per family, personal names per head). */
export function assembleFamilies(F: FamilyState, Q: number, names: { family: string[]; head: string[] }): MerchantFamilies {
  const n = F.fFounded.length, S = F.sFam.length, H = F.hFam.length
  const fo = new Uint32Array(Q + 1), so = new Uint32Array(Q + 1)
  for (let q = 0; q < Q; q++) { fo[q] = F.snapFamOff[q]; so[q] = F.snapSeatOff[q] }
  fo[Q] = Q < F.snapFamOff.length ? F.snapFamOff[Q] : F.snapFam.length
  so[Q] = Q < F.snapSeatOff.length ? F.snapSeatOff[Q] : F.snapSeat.length
  const i16 = (a: number[]) => Int16Array.from(a)
  const i32 = (a: number[]) => Int32Array.from(a)
  const u8 = (a: number[]) => Uint8Array.from(a)
  return {
    count: n, name: names.family.slice(0, n), founded: i16(F.fFounded), ended: i16(F.fEnded), end: u8(F.fEnd), ruin: u8(F.fRuin), cause: u8(F.fCause),
    firstHome: i32(F.fFirstHome), parent: i32(F.fParent), people: i16(F.fPeople), peakCapital: Float32Array.from(F.fPeakCap), peakYear: i16(F.fPeakYear),
    seatCount: S, seatFamily: i32(F.sFam), seatTown: i32(F.sTown), seatKind: u8(F.sKind), seatFrom: i16(F.sFrom), seatTo: i16(F.sTo),
    seatOpen: u8(F.sOpen), seatClose: u8(F.sClose), seatLeg: i32(F.sLeg), seatPost: i32(F.sPost),
    headCount: H, headFamily: i32(F.hFam), headName: names.head.slice(0, H), headFemale: u8(F.hFemale), headBorn: i16(F.hBorn), headFrom: i16(F.hFrom),
    headTo: i16(F.hTo), headDied: i16(F.hDied), how: u8(F.hHow), headAbility: Uint8Array.from(F.hAbility, (a) => Math.round(a * 100)),
    laneCount: F.lnFam.length, laneFamily: i32(F.lnFam), laneLeg: i32(F.lnLeg), laneFrom: i16(F.lnFrom), laneTo: i16(F.lnTo),
    marriageCount: F.mgFam.length, marriageFamily: i32(F.mgFam), marriageDynasty: i32(F.mgDyn), marriagePolity: i16(F.mgPolity), marriageRuler: i32(F.mgRuler),
    marriageDaughter: u8(F.mgDaughter), marriageYear: i16(F.mgYear), marriageEnd: i16(F.mgEnd),
    backCount: F.bkFam.length, backFamily: i32(F.bkFam), backWar: i32(F.bkWar), backSide: u8(F.bkSide), backOutcome: u8(F.bkOut), backStake: Float32Array.from(F.bkStake),
    patronCount: F.ptFam.length, patronFamily: i32(F.ptFam), patronLandmark: i32(F.ptLandmark), patronYear: i16(F.ptYear),
    famSnapOffsets: fo, famSnapFamily: Int32Array.from(F.snapFam.slice(0, fo[Q])), famSnapCapital: Float32Array.from(F.snapFamCap.slice(0, fo[Q])),
    seatSnapOffsets: so, seatSnapSeat: Int32Array.from(F.snapSeat.slice(0, so[Q])), seatSnapCapital: Float32Array.from(F.snapSeatCap.slice(0, so[Q])),
  }
}
