// governments: the contract tables (History.governments, governmentOffsets / governmentIds), copied out at assembly; every
// array owns its buffer (a resumed run assembles again from the same state).

import type { Governments } from '../../../contract.ts'
import type { GovState } from './state.ts'

export interface GovernmentHistory {
  governments: Governments
  governmentOffsets: Uint32Array
  governmentIds: Int32Array
}

export function emptyGovernmentHistory(): GovernmentHistory {
  return {
    governments: { count: 0, polity: new Int16Array(0), year: new Int16Array(0), form: new Uint8Array(0), cause: new Uint8Array(0), ruler: new Int32Array(0), settlement: new Int32Array(0), family: new Int32Array(0) },
    governmentOffsets: new Uint32Array(0),
    governmentIds: new Int32Array(0),
  }
}

/** The tables as of now; `P` polities. Rows per polity in order of change (row ids ascend with the year). */
export function assembleGovernments(G: GovState, P: number): GovernmentHistory {
  const N = G.gPolity.length
  const governments: Governments = {
    count: N, polity: Int16Array.from(G.gPolity), year: Int16Array.from(G.gYear), form: Uint8Array.from(G.gForm), cause: Uint8Array.from(G.gCause),
    ruler: Int32Array.from(G.gRuler), settlement: Int32Array.from(G.gSettlement), family: Int32Array.from(G.gFamily),
  }
  const governmentOffsets = new Uint32Array(P + 1)
  for (let k = 0; k < N; k++) governmentOffsets[G.gPolity[k] + 1]++
  for (let p = 0; p < P; p++) governmentOffsets[p + 1] += governmentOffsets[p]
  const governmentIds = new Int32Array(N)
  const fill = governmentOffsets.slice(0, P)
  for (let k = 0; k < N; k++) governmentIds[fill[G.gPolity[k]]++] = k
  return { governments, governmentOffsets, governmentIds }
}
