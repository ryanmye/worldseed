// Text formatting shared by the timeline, inspector and chronicle.

import { EventType, FeatureKind, StructureType, type GeoFeature, type History, type HistoryEvent } from '../contract.ts'

/** Display name of a settlement (its procedural name; a numbered fallback for histories without names). */
export function settlementName(history: History, id: number): string {
  const s = history.settlements[id] as { name?: string } | undefined
  return s?.name || `Settlement #${id}`
}

/** 812, 4.3k, 56k, 1.2M */
export function formatPopulation(n: number): string {
  const v = Math.max(0, n)
  if (v < 1000) return String(Math.round(v))
  if (v < 1e6) return (v / 1e3).toFixed(v < 1e4 ? 1 : 0) + 'k'
  if (v < 1e9) return (v / 1e6).toFixed(v < 1e7 ? 1 : 0) + 'M'
  return (v / 1e9).toFixed(1) + 'B'
}

/** 12,345 */
export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export type EventKind = 'founded' | 'abandoned' | 'famine' | 'migration' | 'built' | 'town' | 'city' | 'lost' | 'trade' | 'tradeEnd' | 'contact' | 'landfall' | 'voyage' | 'expedition' | 'discovery' | 'tech'

// ---- peoples, voyages, expeditions and technology (event types 10..16; all optional at runtime)

/** Event types of the peoples and exploration step (numbers, so histories from before they existed still type-check). */
export const PeoplesEvent = { VoyageLost: 10, Landfall: 11, FirstContact: 12, ExpeditionSent: 13, ExpeditionReturned: 14, Discovery: 15, TechAdvance: 16 } as const

/** Field names of History.technology (TechField order). */
export const TECH_FIELD_NAMES: readonly string[] = ['farming', 'seafaring', 'metalworking', 'crafts']

/** Name of people `p`, or null when the history has no such people. */
export function peopleName(h: History, p: number): string | null {
  const ps = (h as Partial<History>).peoples
  const x = Array.isArray(ps) ? ps[p] : undefined
  return x && typeof x.name === 'string' && x.name ? x.name : null
}

/** People of settlement `id`, or -1. */
export function peopleOf(h: History, id: number): number {
  const v = (h.settlements[id] as { people?: number } | undefined)?.people
  return typeof v === 'number' && v >= 0 ? v : -1
}

/** "the Kepian people" (or "another people" without names). */
function thePeople(h: History, p: number): string {
  const n = peopleName(h, p)
  return n ? `the ${n} people` : 'another people'
}

/** "The Kepian and Esrian peoples meet at Hinga". */
export function describeFirstContact(h: History, e: HistoryEvent): string {
  const a = peopleName(h, peopleOf(h, e.settlement)), b = peopleName(h, e.value >= 0 ? e.value : peopleOf(h, e.other))
  const at = settlementName(h, e.settlement)
  return a && b ? `The ${a} and ${b} peoples meet at ${at}` : `Two peoples meet at ${at}`
}

/** "Settlers from Pifur make landfall on the unsettled continent of Roneka"; `land` is the landmass's name and kind word ("continent of Roneka") or null. */
export function describeLandfall(h: History, e: HistoryEvent, land: string | null): string {
  const from = e.other >= 0 ? settlementName(h, e.other) : settlementName(h, e.settlement)
  // (`value` is the landmass size in cells: most unnamed landfalls are on islets)
  return `Settlers from ${from} make landfall on ${land ? `the unsettled ${land}` : e.value > 0 && e.value <= 8 ? 'a small unnamed island' : 'an unknown land'}`
}

/** Where a Discovery event's expedition got to: "the sea Oru Tal", "the southern ice" (`southern` null: "the polar ice"). */
function discoveryPlace(h: History, e: HistoryEvent, southern: boolean | null): string {
  const f = e.value >= 0 ? (h as Partial<History>).features?.[e.value] : undefined
  return f ? `the ${featureNoun(f.kind)} ${f.name}` : `the ${southern === null ? 'polar' : southern ? 'southern' : 'northern'} ice`
}

function describeDiscovery(h: History, e: HistoryEvent, southern: boolean): string {
  return `An expedition from ${settlementName(h, e.settlement)} reaches ${discoveryPlace(h, e, southern)}`
}

/** Chronicle line for a peoples / exploration event (types 10..16), or null for other types. `southern`: the settlement lies south of the equator (for pole discoveries). */
export function describePeoplesEvent(h: History, e: HistoryEvent, southern = false): string | null {
  const name = settlementName(h, e.settlement)
  switch (e.type as number) {
    case PeoplesEvent.VoyageLost:
      return `An expedition from ${name} is lost at sea` + (e.value > 0 ? ` (${formatInt(e.value)} people)` : '')
    case PeoplesEvent.Landfall:
      return describeLandfall(h, e, null)
    case PeoplesEvent.FirstContact:
      return describeFirstContact(h, e)
    case PeoplesEvent.ExpeditionSent:
      return `An expedition sets out from ${name}` + (e.value > 0 ? ` (${formatInt(e.value)} people)` : '')
    case PeoplesEvent.ExpeditionReturned:
      return e.value > 0 ? `An expedition returns to ${name} with news of new lands` : `An expedition returns to ${name} with nothing new`
    case PeoplesEvent.Discovery:
      return describeDiscovery(h, e, southern)
    case PeoplesEvent.TechAdvance: {
      const p = peopleOf(h, e.settlement)
      const t = thePeople(h, p)
      return `${t.charAt(0).toUpperCase()}${t.slice(1)} advance in ${TECH_FIELD_NAMES[e.value] ?? 'learning'}`
    }
    default:
      return null
  }
}

/** Chronicle line for `count` events of one of these types in one decade, naming `example` (the largest, where size matters) and `people` in all. */
export function describePeoplesBurst(h: History, example: HistoryEvent, count: number, people: number): string {
  const name = settlementName(h, example.settlement)
  switch (example.type as number) {
    case PeoplesEvent.VoyageLost:
      return `${count} expeditions lost at sea (${formatInt(people)} people), the largest from ${name}`
    case PeoplesEvent.ExpeditionSent:
      return `${count} expeditions set out, the largest from ${name}`
    case PeoplesEvent.ExpeditionReturned:
      return `${count} expeditions return, among them to ${name}`
    case PeoplesEvent.TechAdvance:
      return `${count} advances in technology, among them ${thePeople(h, peopleOf(h, example.settlement))} in ${TECH_FIELD_NAMES[example.value] ?? 'learning'}`
    default:
      return `${count} events, among them at ${name}`
  }
}

/** Description of a peoples / exploration event from the point of view of settlement `id` (inspector), or null for other types. */
function describePeoplesEventFor(h: History, e: HistoryEvent, id: number): string | null {
  switch (e.type as number) {
    case PeoplesEvent.VoyageLost:
      return 'Lost an expedition at sea' + (e.value > 0 ? ` (${formatInt(e.value)} people)` : '')
    case PeoplesEvent.Landfall:
      return e.settlement === id ? 'The first settlement on this land' : `Its settlers made the first landfall at ${settlementName(h, e.settlement)}`
    case PeoplesEvent.FirstContact: {
      const partner = e.settlement === id ? e.other : e.settlement
      const p = peopleOf(h, partner)
      return `Met ${thePeople(h, p)} through ${settlementName(h, partner)}`
    }
    case PeoplesEvent.ExpeditionSent:
      return 'Sent out an expedition' + (e.value > 0 ? ` (${formatInt(e.value)} people)` : '')
    case PeoplesEvent.ExpeditionReturned:
      return e.value > 0 ? `An expedition came home with news of new lands` : 'An expedition came home'
    case PeoplesEvent.Discovery:
      return `Its expedition reached ${discoveryPlace(h, e, null)}`
    case PeoplesEvent.TechAdvance:
      return `Advanced in ${TECH_FIELD_NAMES[e.value] ?? 'learning'}`
    default:
      return null
  }
}

/** Good names (lower case), indexed by Good. */
export const GOOD_NAMES: readonly string[] = ['grain', 'fish', 'livestock', 'timber', 'ore', 'salt']

export function goodName(g: number): string {
  return GOOD_NAMES[g] ?? 'goods'
}

/** Goods of route r: what its end a sends to b, and what b sends back (null without trade data). */
function routeGoods(h: History, r: number): [number, number] | null {
  const T = (h as Partial<History>).trade
  if (!T || !(r >= 0 && r < T.count)) return null
  return [T.goodAB[r], T.goodBA[r]]
}

/** "fish for timber" from the point of view of `from` (the settlement sending the first good). */
function exchange(h: History, e: HistoryEvent, from: number): string {
  const g = routeGoods(h, e.value)
  if (!g) return ''
  const T = h.trade
  // the event's ends are the route's ends; goodAB goes from the lower id (a) to b
  const sendsFirst = T.a[e.value] === from
  const out = sendsFirst ? g[0] : g[1]
  const back = sendsFirst ? g[1] : g[0]
  return out === back ? goodName(out) : `${goodName(out)} for ${goodName(back)}`
}

export function eventKind(e: HistoryEvent): EventKind {
  switch (e.type as number) {
    case EventType.Founded: return 'founded'
    case EventType.Abandoned: return 'abandoned'
    case EventType.Famine: return 'famine'
    case EventType.Built: return 'built'
    case EventType.BecameTown: return 'town'
    case EventType.BecameCity: return 'city'
    case EventType.StructureLost: return 'lost'
    case EventType.TradeOpened: return 'trade'
    case EventType.TradeClosed: return 'tradeEnd'
    case PeoplesEvent.FirstContact: return 'contact'
    case PeoplesEvent.Landfall: return 'landfall'
    case PeoplesEvent.VoyageLost: return 'voyage'
    case PeoplesEvent.ExpeditionSent:
    case PeoplesEvent.ExpeditionReturned: return 'expedition'
    case PeoplesEvent.Discovery: return 'discovery'
    case PeoplesEvent.TechAdvance: return 'tech'
    default: return 'migration'
  }
}

/** Type of the structure an event refers to: `value` carries it, `other` is the structure id. */
function structureTypeOf(h: History, e: HistoryEvent): number {
  const st = (h as Partial<History>).structures?.[e.other]
  return st ? st.type : e.value
}

export function structureName(type: number): string {
  return type === StructureType.Dam ? 'dam' : 'port'
}

/** One-line description of an event for the global chronicle. */
export function describeEvent(h: History, e: HistoryEvent): string {
  const name = settlementName(h, e.settlement)
  switch (e.type) {
    case EventType.Founded:
      return e.other >= 0 ? `${name} founded from ${settlementName(h, e.other)}` : `${name} founded by an original tribe`
    case EventType.Abandoned:
      return `${name} abandoned`
    case EventType.Famine:
      return `Famine in ${name}` + (e.value > 0 ? ` (−${Math.round(e.value * 100)}%)` : '')
    case EventType.Built:
      return structureTypeOf(h, e) === StructureType.Dam ? `${name} dams the river` : `${name} builds a port`
    case EventType.BecameTown:
      return `${name} grows into a town`
    case EventType.BecameCity:
      return `${name} becomes a city`
    case EventType.StructureLost:
      return structureTypeOf(h, e) === StructureType.Dam ? `The dam of ${name} falls into ruin` : `The port of ${name} falls into ruin`
    case EventType.TradeOpened: {
      const x = exchange(h, e, e.settlement)
      return `${name} and ${settlementName(h, e.other)} begin trading` + (x ? ` ${x}` : '')
    }
    case EventType.TradeClosed:
      return `${name} and ${settlementName(h, e.other)} stop trading`
    case EventType.Migration:
      return `${formatInt(e.value)} migrated from ${name} to ${settlementName(h, e.other)}`
    default:
      return describePeoplesEvent(h, e) ?? `${formatInt(e.value)} migrated from ${name} to ${settlementName(h, e.other)}`
  }
}

/** Chronicle line for `count` large migrations in one decade (`people` in all), `largest` being the biggest group. */
export function describeMigrations(h: History, largest: HistoryEvent, count: number, people: number): string {
  return `${count} large migrations (${formatInt(people)} people), the largest from ${settlementName(h, largest.settlement)} to ${settlementName(h, largest.other)}`
}

/** Chronicle line for `count` trade routes opened (or closed) in one decade, naming one of them. */
export function describeTradeBurst(h: History, example: HistoryEvent, count: number, opened: boolean): string {
  const pair = `${settlementName(h, example.settlement)} and ${settlementName(h, example.other)}`
  if (!opened) return `${count} trade routes close, among them ${pair}`
  const x = exchange(h, example, example.settlement)
  return `${count} new trade routes, among them ${pair}` + (x ? ` (${x})` : '')
}

/** Chronicle line for `count` famines in one year, `worst` being the most severe. */
export function describeFamineBurst(h: History, worst: HistoryEvent, count: number): string {
  return `Famine across ${count} settlements, worst in ${settlementName(h, worst.settlement)}` + (worst.value > 0 ? ` (−${Math.round(worst.value * 100)}%)` : '')
}

/**
 * Chronicle line for `count` foundings in one decade; `largest` is the founding with the
 * largest party and `sameParent` whether all came from its parent.
 */
export function describeFoundings(h: History, largest: HistoryEvent, count: number, sameParent: boolean): string {
  const parent = settlementName(h, largest.other)
  return sameParent ? `${parent} founded ${count} new settlements` : `${count} new settlements founded, largest from ${parent}`
}

/** "exports fish, imports timber" (or "trades grain both ways"). */
export function describeExchange(exports: number, imports: number): string {
  return exports === imports ? `${goodName(exports)} both ways` : `exports ${goodName(exports)}, imports ${goodName(imports)}`
}

/** Description of an event from the point of view of settlement `id` (inspector). */
export function describeEventFor(h: History, e: HistoryEvent, id: number): string {
  switch (e.type) {
    case EventType.Founded:
      if (e.settlement === id) return e.other >= 0 ? `Founded by migrants from ${settlementName(h, e.other)}` : 'Founded by an original tribe'
      return `Founded the colony ${settlementName(h, e.settlement)}`
    case EventType.Abandoned:
      return 'Abandoned'
    case EventType.Famine:
      return 'Famine' + (e.value > 0 ? `, lost ${Math.round(e.value * 100)}% of its people` : '')
    case EventType.Built:
      return structureTypeOf(h, e) === StructureType.Dam ? 'Dammed the river' : 'Built a port'
    case EventType.BecameTown:
      return `Grew into a town (${formatInt(e.value)} people)`
    case EventType.BecameCity:
      return `Became a city (${formatInt(e.value)} people)`
    case EventType.StructureLost:
      return `Its ${structureName(structureTypeOf(h, e))} fell into ruin`
    case EventType.TradeOpened: {
      const partner = e.settlement === id ? e.other : e.settlement
      const g = routeGoods(h, e.value)
      if (!g) return `Began trading with ${settlementName(h, partner)}`
      const isA = h.trade.a[e.value] === id
      return `Began trading with ${settlementName(h, partner)}: ${describeExchange(isA ? g[0] : g[1], isA ? g[1] : g[0])}`
    }
    case EventType.TradeClosed:
      return `Stopped trading with ${settlementName(h, e.settlement === id ? e.other : e.settlement)}`
    default:
      return describePeoplesEventFor(h, e, id) ?? (e.settlement === id
        ? `${formatInt(e.value)} left for ${settlementName(h, e.other)}`
        : `${formatInt(e.value)} arrived from ${settlementName(h, e.settlement)}`)
  }
}

/** Plain noun for a kind of named feature, as the chronicle says it ("the river Kephia"). */
export function featureNoun(kind: number): string {
  return ['land', 'island', 'ocean', 'sea', 'lake', 'river', 'mountains', 'desert', 'forest'][kind] ?? 'land'
}

/** Kinds in the order a place is described, most local first: river, lake, range, desert, forest, sea, ocean, island, continent. */
const PLACE_ORDER = [8, 7, 6, 5, 1, 0, 2, 3, 4]

/** "Kephia river, Oru Tal sea, Hingara continent": the named features a place lies on or beside. */
export function describePlaces(features: readonly GeoFeature[]): string {
  const sorted = features.slice().sort((a, b) => (PLACE_ORDER[a.kind] ?? 9) - (PLACE_ORDER[b.kind] ?? 9) || a.id - b.id)
  return sorted.map((f) => `${f.name} ${f.kind === FeatureKind.Continent ? 'continent' : featureNoun(f.kind)}`).join(', ')
}

/** Chronicle line for features named together by one settlement ("The people of Kepia name the sea Oru Tal and the river Kephia"). */
export function describeNaming(h: History, featureIds: readonly number[]): string {
  const fs = featureIds.map((id) => h.features[id]).filter((f) => f !== undefined)
  if (!fs.length) return ''
  const items = fs.map((f) => `the ${featureNoun(f.kind)} ${f.name}`)
  const list = items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
  return `The people of ${settlementName(h, fs[0].namedBy)} name ${list}`
}
