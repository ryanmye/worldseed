// governments: state of the government system (city-states.md §4.1): the form of every polity now, the change rows in order,
// and the context of the next newPolity. Stored as HistoryState.gov (null when HistoryOptions.governments or polities is off).

import type { Rng } from '../../rng.ts'
import { createRng } from '../../rng.ts'

export interface GovDiag {
  charters: number
  risings: number
  risingsCrushed: number
  freeTowns: number
  freed: number
  revoked: number
  council: number
  signorie: number
  restored: number
  crowned: number
  theocracies: number
  secularised: number
  confederations: number
  settled: number
  strife: number
  mercPaid: number
  /** Polity-steps with an elected head's term ended (the strife draws). */
  terms: number
}

export interface GovState {
  rng: Rng
  pcap: number
  /** Form of each polity now (Government), and the year it took it. */
  form: Uint8Array
  since: Int32Array
  /** The year a league fell to one member (-1), or a confederation began to look settled (-1). */
  lone: Int32Array
  /** A signoria's house at its seizure (the house that must hold it crownYears to be crowned), -1. */
  house: Int32Array
  /** Year of the last government act (a charter or rising tried) at the polity: one per step. */
  acted: Int32Array
  /** The polity's latest row (for the ruler of the row). */
  last: Int32Array
  /** T_x: through-traffic of the polity's port members this step (the trade-rival measure). */
  trade: Float64Array
  /** Change rows (ragged, in order of change). */
  gPolity: number[]
  gYear: number[]
  gForm: number[]
  gCause: number[]
  gRuler: number[]
  gSettlement: number[]
  gFamily: number[]
  /** Context for the next newPolity (set around cityState): the form and cause of its first row, the settlement and family; -1 none. */
  ctxForm: number
  ctxCause: number
  ctxSettlement: number
  ctxFamily: number
  diag: GovDiag
}

export function createGovernment(seed: number): GovState {
  const pcap = 64
  return {
    rng: createRng(seed, 'history-government'),
    pcap,
    form: new Uint8Array(pcap), since: new Int32Array(pcap), lone: new Int32Array(pcap).fill(-1), house: new Int32Array(pcap).fill(-1),
    acted: new Int32Array(pcap).fill(-1), last: new Int32Array(pcap).fill(-1), trade: new Float64Array(pcap),
    gPolity: [], gYear: [], gForm: [], gCause: [], gRuler: [], gSettlement: [], gFamily: [],
    ctxForm: -1, ctxCause: -1, ctxSettlement: -1, ctxFamily: -1,
    diag: { charters: 0, risings: 0, risingsCrushed: 0, freeTowns: 0, freed: 0, revoked: 0, council: 0, signorie: 0, restored: 0, crowned: 0, theocracies: 0, secularised: 0, confederations: 0, settled: 0, strife: 0, mercPaid: 0, terms: 0 },
  }
}

function grow<T extends Int32Array | Float64Array | Uint8Array>(a: T, size: number, fill = 0): T {
  const b = new (a.constructor as { new (n: number): T })(size)
  if (fill !== 0) b.fill(fill)
  b.set(a)
  return b
}

/** Grows the per-polity arrays to hold `need` polities. */
export function ensureGovPolities(G: GovState, need: number): void {
  if (need <= G.pcap) return
  let size = G.pcap
  while (size < need) size *= 2
  G.form = grow(G.form, size)
  G.since = grow(G.since, size)
  G.lone = grow(G.lone, size, -1)
  G.house = grow(G.house, size, -1)
  G.acted = grow(G.acted, size, -1)
  G.last = grow(G.last, size, -1)
  G.trade = grow(G.trade, size)
  G.pcap = size
}
