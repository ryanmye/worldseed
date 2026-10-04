// rulers: the contract tables (History.rulers, dynasties, reignOffsets / reignIds, marriages, unions, successionWars), copied
// out at assembly with names (names/rulerNames.ts); every array owns its buffer.

import type { AccessionHow, Dynasty, Marriages, ReignEnd, Ruler, SuccessionLaw, Unions, World } from '../../../contract.ts'
import type { SettlementNaming } from '../../names/index.ts'
import { nameRulers } from '../../names/rulerNames.ts'
import type { RulerState } from './state.ts'

export interface RulerHistory {
  rulers: Ruler[]
  dynasties: Dynasty[]
  reignOffsets: Uint32Array
  reignIds: Int32Array
  marriages: Marriages
  unions: Unions
  successionWars: Int32Array
}

export function emptyRulerHistory(): RulerHistory {
  return {
    rulers: [], dynasties: [], reignOffsets: new Uint32Array(0), reignIds: new Int32Array(0),
    marriages: { count: 0, a: new Int16Array(0), b: new Int16Array(0), dynastyA: new Int32Array(0), dynastyB: new Int32Array(0), year: new Int16Array(0), endYear: new Int16Array(0) },
    unions: { count: 0, senior: new Int16Array(0), junior: new Int16Array(0), ruler: new Int32Array(0), startYear: new Int16Array(0), endYear: new Int16Array(0), end: new Uint8Array(0) },
    successionWars: new Int32Array(0),
  }
}

const r4 = (x: number): number => Math.round(x * 10000) / 10000

/** The tables as of now; `P` polities. */
export function assembleRulers(world: World, R: RulerState, P: number, naming: SettlementNaming): RulerHistory {
  const N = R.rPolity.length
  const D = R.dFounder.length
  const houses = []
  for (let d = 0; d < D; d++) houses.push({ capital: R.dFounder[d] >= 0 ? R.rCap[R.dFounder[d]] : 0 })
  const like = []
  for (let r = 0; r < N; r++) like.push({ polity: R.rPolity[r], dynasty: R.rDyn[r], female: R.rFemale[r] === 1, capital: R.rCap[r], parent: R.rParent[r], person: R.rPerson[r] })
  const { houseNames, names, regnal } = nameRulers(world, naming, houses, like)
  const rulers: Ruler[] = []
  for (let r = 0; r < N; r++) {
    rulers.push({
      id: r, name: names[r], regnal: regnal[r], female: R.rFemale[r] === 1, born: R.rBorn[r], acceded: R.rAcc[r], ended: R.rEnd[r], died: R.rDied[r],
      polity: R.rPolity[r], dynasty: R.rDyn[r], how: R.rHow[r] as AccessionHow, end: R.rCause[r] as ReignEnd, law: R.rLaw[r] as SuccessionLaw,
      predecessor: R.rPred[r], person: R.rPerson[r], parent: R.rParent[r],
      ability: r4(R.rAbility[r]), warlike: r4(R.rWar[r]), piety: r4(R.rPiety[r]), tolerance: r4(R.rTol[r]), faith: R.rFaith0[r],
    })
  }
  // (a person's death on one throne is a death on the other: unions' junior reigns)
  for (let r = 0; r < N; r++) { const x = rulers[r]; if (x.person !== r && x.died < 0 && rulers[x.person].died >= 0) x.died = rulers[x.person].died }
  const dynasties: Dynasty[] = []
  for (let d = 0; d < D; d++) dynasties.push({ id: d, name: houseNames[d], founder: R.dFounder[d], founded: R.dFounded[d], ended: R.dEnded[d], home: R.dHome[d], people: R.dPeople[d] })
  // Reigns per polity in order of accession (ids ascend with accession).
  const reignOffsets = new Uint32Array(P + 1)
  for (let r = 0; r < N; r++) reignOffsets[R.rPolity[r] + 1]++
  for (let p = 0; p < P; p++) reignOffsets[p + 1] += reignOffsets[p]
  const reignIds = new Int32Array(N)
  const fill = reignOffsets.slice(0, P)
  for (let r = 0; r < N; r++) reignIds[fill[R.rPolity[r]]++] = r
  const M = R.mA.length
  const marriages: Marriages = { count: M, a: Int16Array.from(R.mA), b: Int16Array.from(R.mB), dynastyA: Int32Array.from(R.mDA), dynastyB: Int32Array.from(R.mDB), year: Int16Array.from(R.mYear), endYear: Int16Array.from(R.mEnd) }
  const U = R.uSenior.length
  const unions: Unions = { count: U, senior: Int16Array.from(R.uSenior), junior: Int16Array.from(R.uJunior), ruler: Int32Array.from(R.uRuler), startYear: Int16Array.from(R.uStart), endYear: Int16Array.from(R.uEnd), end: Uint8Array.from(R.uCause) }
  return { rulers, dynasties, reignOffsets, reignIds, marriages, unions, successionWars: Int32Array.from(R.sWars) }
}
