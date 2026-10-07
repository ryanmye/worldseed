// Danger on the way of trade: chronicle and inspector lines for a major route forsaken because its way grew too
// dangerous (TradeForsaken, 150: `extra` the cause, 0 danger on land, 1 pirates at sea, 2 a war front) and for one
// trodden again (TradeRestored, 151: `extra` the years it lay forsaken). `settlement` and `other` are the route's
// ends, `value` the route id. ("Merchants forsake the road from Rilko to Fanfin: bandits on the way"; "The road from
// Rilko to Fanfin is trodden again after 12 years".) A restored route is called a sea way when it was forsaken to pirates.

import { EventType, type History, type HistoryEvent } from '../contract.ts'
import { settlementName } from './format.ts'

export const isTradeDangerEvent = (t: number) => t === EventType.TradeForsaken || t === EventType.TradeRestored

const CAUSE = ['bandits on the way', 'pirates', 'the war front']
const cause = (e: HistoryEvent) => CAUSE[e.extra ?? 0] ?? CAUSE[0]
const years = (n: number) => (n === 1 ? '1 year' : `${Math.max(1, Math.round(n))} years`)

/** Per history, the forsakings of each route (route id -> [year, cause, year, cause, ...]), to name a restored one's way. */
const forsakings = new WeakMap<History, Map<number, number[]>>()
/** The cause a TradeRestored event's route was forsaken for (the forsaking `extra` years before it). */
function forsakenCause(h: History, e: HistoryEvent): number {
  let m = forsakings.get(h)
  if (!m) {
    m = new Map()
    for (const x of h.events) {
      if (x.type !== EventType.TradeForsaken) continue
      const l = m.get(x.value)
      if (l) l.push(x.year, x.extra ?? 0)
      else m.set(x.value, [x.year, x.extra ?? 0])
    }
    forsakings.set(h, m)
  }
  const l = m.get(e.value)
  if (!l) return 0
  const at = e.year - (e.extra ?? 0)
  let c = 0
  for (let k = 0; k < l.length; k += 2) if (l[k] <= at) c = l[k + 1]
  return c
}

/** "road" or "sea way" for the route of a TradeForsaken or TradeRestored event. */
function way(h: History, e: HistoryEvent): string {
  return (e.type === EventType.TradeForsaken ? e.extra ?? 0 : forsakenCause(h, e)) === 1 ? 'sea way' : 'road'
}

export function describeTradeDangerEvent(h: History, e: HistoryEvent): string | null {
  const from = settlementName(h, e.settlement), to = settlementName(h, e.other)
  if (e.type === EventType.TradeForsaken) return `Merchants forsake the ${way(h, e)} from ${from} to ${to}: ${cause(e)}`
  if (e.type === EventType.TradeRestored) {
    const w = way(h, e)
    return `The ${w} from ${from} to ${to} is ${w === 'road' ? 'trodden' : 'sailed'} again after ${years(e.extra ?? 0)}`
  }
  return null
}

/** The same from the point of view of one end (inspector): "Merchants forsook the road to Fanfin: bandits on the way". */
export function describeTradeDangerEventFor(h: History, e: HistoryEvent, id: number): string | null {
  const partner = settlementName(h, e.settlement === id ? e.other : e.settlement)
  if (e.type === EventType.TradeForsaken) return `Merchants forsook the ${way(h, e)} to ${partner}: ${cause(e)}`
  if (e.type === EventType.TradeRestored) {
    const w = way(h, e)
    return `The ${w} to ${partner} was ${w === 'road' ? 'trodden' : 'sailed'} again after ${years(e.extra ?? 0)}`
  }
  return null
}

/**
 * Chronicle line for several routes forsaken (or restored) in one decade (`members`, one type), naming the one between
 * the largest pair (`example`): "Merchants forsake 4 roads, among them Rilko to Fanfin (bandits on the way)"; "3 forsaken
 * roads and sea ways are travelled again, among them Rilko to Fanfin (after 12 years)".
 */
export function describeTradeDangerGroup(h: History, example: HistoryEvent, members: readonly HistoryEvent[]): string {
  const pair = `${settlementName(h, example.settlement)} to ${settlementName(h, example.other)}`
  let roads = 0, seas = 0
  for (const e of members) if (way(h, e) === 'road') roads++
  else seas++
  const ways = roads && seas ? 'roads and sea ways' : roads ? 'roads' : 'sea ways'
  const n = members.length
  if (example.type === EventType.TradeForsaken) return `Merchants forsake ${n} ${ways}, among them ${pair} (${cause(example)})`
  return `${n} forsaken ${ways} are ${seas ? 'travelled' : 'trodden'} again, among them ${pair} (after ${years(example.extra ?? 0)})`
}
