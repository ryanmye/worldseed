// Why: the CauseIndex (causal-explorer.md §4.4), built once per History, lazily, on the first "why". It reuses the sagas'
// index (events by settlement and by type) and the polity index the panels build (both cached per History), and adds the
// few lookups the rules need: the events of each war, each polity's founding and end, events by polity pair, the rows of
// History.why per event, and each reign's accession and end. Everything is O(events).

import { EventType as E, settlementNameAt } from '../../contract.ts'
import type { CauseRecords, History, HistoryEvent } from '../../contract.ts'
import { politiesOf, polityAtYear } from '../politiesData.ts'
import type { PolitiesData } from '../politiesData.ts'
import { sagaIndexOf } from '../sagas/facts.ts'
import type { SagaIndex } from '../sagas/facts.ts'

/** Event types whose `value` is a war id. */
export const WAR_VALUE_TYPES: readonly number[] = [E.WarDeclared, E.PeaceMade, E.Conquered, E.SiegeLifted, E.Blockade, E.ArmyStricken, E.CivilWar, E.SuccessionWar, E.HolyWar]

export interface CauseIndex {
  h: History
  /** History.why when it holds records (causes on), else null: the rules then work alone. */
  why: CauseRecords | null
  sx: SagaIndex
  pd: PolitiesData | null
  /** Per war: its declaration (WarDeclared or CivilWar), its PeaceMade (-1), and every event whose value is it. */
  warDecl: Int32Array
  warPeace: Int32Array
  warEvents: number[][]
  /** HolyWar and SuccessionWar events per war (-1). */
  warHoly: Int32Array
  warSucc: Int32Array
  /** Per polity: PolityFounded and PolityEnded event (-1). */
  polFound: Int32Array
  polEnd: Int32Array
  /** BorderDispute, Alliance and BecameVassal events per unordered polity pair (pairKey). */
  byPair: Map<number, number[]>
  /** Events per polity: those whose `value` is the polity (founding, end, crisis, ...) and those at its capitals while it ruled them. */
  ofPolity: number[][]
  /** Row of History.why per event index (revolts, famines, abandons, crises, absorbed). */
  revoltRow: Map<number, number>
  famineRow: Map<number, number>
  abandonRow: Map<number, number>
  crisisRow: Map<number, number>
  absorbedRow: Map<number, number>
  /** Per ruler: RulerAcceded and ReignEnded event (-1). */
  rulerAcc: Int32Array
  rulerEnd: Int32Array
  /** Order index -> OrderGiven event (-1). */
  orderGiven: Map<number, number>
}

export const pairKey = (p: number, q: number) => (p < q ? p * 65536 + q : q * 65536 + p)

const cache = new WeakMap<History, CauseIndex>()

/** True when the history carries the causes records (HistoryOptions.causes was on). */
export function hasWhy(h: History): boolean {
  const w = h.why
  return !!w && (w.wars.rivalry.length > 0 || w.weather.regions > 0 || w.revolts.count > 0)
}

export function causeIndexOf(h: History): CauseIndex {
  let ix = cache.get(h)
  if (ix) return ix
  ix = build(h)
  cache.set(h, ix)
  return ix
}

function build(h: History): CauseIndex {
  const W = h.wars?.count ?? 0
  const P = h.polities?.length ?? 0
  const R = h.rulers?.length ?? 0
  const warDecl = new Int32Array(W).fill(-1), warPeace = new Int32Array(W).fill(-1), warHoly = new Int32Array(W).fill(-1), warSucc = new Int32Array(W).fill(-1)
  const warEvents: number[][] = Array.from({ length: W }, () => [])
  const polFound = new Int32Array(P).fill(-1), polEnd = new Int32Array(P).fill(-1)
  const ofPolity: number[][] = Array.from({ length: P }, () => [])
  const byPair = new Map<number, number[]>()
  const rulerAcc = new Int32Array(R).fill(-1), rulerEnd = new Int32Array(R).fill(-1)
  const orderGiven = new Map<number, number>()
  const pd = politiesOf(h)
  const warTypes = new Set(WAR_VALUE_TYPES)
  const addPair = (p: number, q: number, i: number) => {
    if (p < 0 || q < 0) return
    const k = pairKey(p, q)
    let a = byPair.get(k)
    if (!a) byPair.set(k, (a = []))
    a.push(i)
  }
  const evs = h.events
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i]
    const t = e.type
    if (warTypes.has(t) && e.value >= 0 && e.value < W) {
      const w = e.value
      warEvents[w].push(i)
      if ((t === E.WarDeclared || t === E.CivilWar) && warDecl[w] < 0) warDecl[w] = i
      else if (t === E.PeaceMade) warPeace[w] = i
      else if (t === E.HolyWar) warHoly[w] = i
      else if (t === E.SuccessionWar) warSucc[w] = i
    }
    if (t === E.HolyCityFell && e.extra !== undefined && e.extra >= 0 && e.extra < W) warEvents[e.extra].push(i)
    if (t === E.PolityFounded && e.value >= 0 && e.value < P) polFound[e.value] = i
    if (t === E.PolityEnded && e.value >= 0 && e.value < P) polEnd[e.value] = i
    if ((t >= E.PolityFounded && t <= E.Partitioned && t !== E.WarDeclared && t !== E.PeaceMade && t !== E.Conquered && t !== E.Sacked && t !== E.SiegeLifted && t !== E.Raid && t !== E.Revolt && t !== E.RevoltCrushed) && e.value >= 0 && e.value < P) ofPolity[e.value].push(i)
    if (t === E.BorderDispute && pd) addPair(polityAtYear(pd, e.settlement, e.year), e.value, i)
    if (t === E.Alliance) { if (pd) addPair(polityAtYear(pd, e.settlement, e.year), e.value, i) }
    if (t === E.BecameVassal && pd) addPair(polityAtYear(pd, e.settlement, e.year), e.value % 1000, i)
    if (t === E.RulerAcceded && e.value >= 0 && e.value < R) rulerAcc[e.value] = i
    if (t === E.ReignEnded && e.value >= 0 && e.value < R) rulerEnd[e.value] = i
    if (t === E.OrderGiven) orderGiven.set(e.value, i)
  }
  const why = hasWhy(h) ? h.why! : null
  const rows = (ev?: Int32Array) => { const m = new Map<number, number>(); if (ev) for (let k = 0; k < ev.length; k++) m.set(ev[k], k); return m }
  return {
    h, why, sx: sagaIndexOf(h), pd, warDecl, warPeace, warEvents, warHoly, warSucc, polFound, polEnd, byPair, ofPolity,
    revoltRow: rows(why?.revolts.event), famineRow: rows(why?.famines.event), abandonRow: rows(why?.abandons.event),
    crisisRow: rows(why?.crises.event), absorbedRow: rows(why?.absorbed.event), rulerAcc, rulerEnd, orderGiven,
  }
}

// ---- small lookups the rules share ----

export function ev(ix: CauseIndex, i: number): HistoryEvent {
  return ix.h.events[i]
}

/** Polity of settlement `id` at year `y` (-1). */
export function polAt(ix: CauseIndex, id: number, y: number): number {
  return ix.pd && id >= 0 ? polityAtYear(ix.pd, id, y) : -1
}

/** Events at settlement `id` of the given types in years [y0, y1], latest first. */
export function atPlace(ix: CauseIndex, id: number, types: readonly number[], y0: number, y1: number): number[] {
  const a = id >= 0 && id < ix.sx.bySettlement.length ? ix.sx.bySettlement[id] : []
  const out: number[] = []
  for (let k = a.length - 1; k >= 0; k--) {
    const e = ix.h.events[a[k]]
    if (e.year > y1) continue
    if (e.year < y0) break
    if (types.includes(e.type)) out.push(a[k])
  }
  return out
}

/** Events of a type in years [y0, y1] (chronological), optionally filtered. */
export function ofType(ix: CauseIndex, type: number, y0: number, y1: number, f?: (e: HistoryEvent, i: number) => boolean): number[] {
  const a = ix.sx.byType.get(type)
  if (!a) return []
  const yrs = ix.sx.years
  let lo = 0, hi = a.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (yrs[a[m]] < y0) lo = m + 1; else hi = m }
  const out: number[] = []
  for (let k = lo; k < a.length && yrs[a[k]] <= y1; k++) if (!f || f(ix.h.events[a[k]], a[k])) out.push(a[k])
  return out
}

/** Name of settlement `id` at `y`. */
export function placeName(ix: CauseIndex, id: number, y: number): string {
  return id >= 0 && id < ix.h.settlements.length ? settlementNameAt(ix.h, id, y) : 'a far place'
}

/** Short name of polity p ("North Vashtar"). */
export function polName(ix: CauseIndex, p: number): string {
  return ix.pd && p >= 0 && p < ix.pd.count ? ix.pd.names[p] : 'a forgotten realm'
}
