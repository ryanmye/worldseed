// seat: the state of the player's seat in a run (HistoryOptions.seat; seat-mode §3.4): which polity it holds year by year, and
// the decisions the watcher (watch.ts) recorded, struct-of-arrays as History.seat.decisions. Kept by the runner (index.ts), not
// in HistoryState: no system reads it.
import { DECISION_KIND_COUNT } from '../../../contract.ts'
import type { SeatOptions } from '../../../contract.ts'

export interface SeatState {
  opts: SeatOptions
  /** The seat was taken (year >= opts.from), and lost (lostYear >= 0). */
  taken: boolean
  lostYear: number
  /** This year: the polity held (-1), its people (the fog's knower; -1 gone), the house of its ruler (-1). */
  polity: number
  people: number
  house: number
  /** Per year from opts.from: polity and people. */
  polityAt: number[]
  peopleAt: number[]
  /** Decisions (see SeatDecisions). */
  dYear: number[]
  dKind: number[]
  dPolity: number[]
  dSubject: number[]
  dPlace: number[]
  optStart: number[]
  optKey: number[]
  orderStart: number[]
  orderKind: number[]
  orderActor: number[]
  orderTarget: number[]
  /** Per decision: how divisive (0..1), and the option a cautious court takes (seat/watch.ts). */
  dDiv: number[]
  dCourt: number[]
  /** lane N3: per decision a kind's detail (Crisis: the event type behind it; Revolt: 1 put down; Opening: 1 a plain weakness,
   * 0 turmoil; Heir: the law's heir's birth year), the HUD row (seat/hud.ts, HUD_N each) and the heirs of the house then
   * (heirStart ragged: birth year, flags bit 0 woman, 1 legitimate, 2 the ruler's child). */
  dInfo: number[]
  hud: number[]
  heirStart: number[]
  heirBorn: number[]
  heirFlags: number[]
  /** lane N3: the reign an Heir card was last given for and the law's heir it named (re-offered only when that changes). */
  heirReign: number
  heirLaw: number
  /** Events looked at for the year's Choice records (the deference pass, seat/system.ts). */
  chSeen: number
  /** Decision rows recorded this year (the pause test of HistoryRunner.playSeat). */
  newRows: number
  /** Year of the last decision; per DecisionKind the year of its last decision. */
  lastCard: number
  lastKind: Int32Array
  /** Epidemics already put to the player (Plague: once each). */
  epidemics: Set<number>
  /** Events looked at up to here (the watcher's scan). */
  evSeen: number
  /** Per ambition asked (opts.ambitions order): year fulfilled (-1), and the years running of its condition. */
  ambitionYear: number[]
  ambitionRun: number[]
}

export function createSeatState(opts: SeatOptions): SeatState {
  const amb = opts.ambitions ?? []
  return {
    opts: copySeat(opts),
    taken: false, lostYear: -1, polity: -1, people: -1, house: -1, polityAt: [], peopleAt: [],
    dYear: [], dKind: [], dPolity: [], dSubject: [], dPlace: [], optStart: [0], optKey: [], orderStart: [0], orderKind: [], orderActor: [], orderTarget: [], dDiv: [], dCourt: [], dInfo: [], hud: [], heirStart: [0], heirBorn: [], heirFlags: [], heirReign: -1, heirLaw: -1, chSeen: 0,
    newRows: 0, lastCard: -1000000, lastKind: new Int32Array(DECISION_KIND_COUNT).fill(-1000000), epidemics: new Set(), evSeen: 0,
    ambitionYear: amb.map(() => -1), ambitionRun: amb.map(() => 0),
  }
}

/** A copy of seat options (ambitions only when given). */
export function copySeat(o: SeatOptions): SeatOptions {
  const c: SeatOptions = { kind: o.kind, id: o.id, from: o.from }
  if (o.ambitions) c.ambitions = o.ambitions.slice()
  return c
}
