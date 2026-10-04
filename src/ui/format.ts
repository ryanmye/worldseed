// Text formatting shared by the timeline, inspector and chronicle.

import { EventType, FeatureKind, StructureType, type GeoFeature, type History, type HistoryEvent } from '../contract.ts'
import { describePolityEvent, describePolityEventFor, isWallEvent, polityEventKind } from './polityFormat.ts'
import { describeSpeciesV2Event, tameVerb } from './speciesFormat.ts'
import { describeGoodsEvent, describeGoodsEventFor, describeMineBuilt, goodsEventKind } from './goodsFormat.ts'
import { describeDiseaseEvent, describeDiseaseEventFor, diseaseEventKind } from './diseaseFormat.ts'
import { describeTourismEvent, describeTourismEventFor, tourismEventKind } from './tourismFormat.ts'

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

export type EventKind = 'founded' | 'abandoned' | 'famine' | 'migration' | 'built' | 'town' | 'city' | 'lost' | 'trade' | 'tradeEnd' | 'contact' | 'landfall' | 'voyage' | 'expedition' | 'discovery' | 'tech' | 'species' | 'epidemic'
  // species, second version (speciesFormat.ts)
  | 'technique' | 'blight' | 'habit' | 'plague'
  // polities (polityFormat.ts)
  | 'polity' | 'joined' | 'war' | 'peace' | 'conquest' | 'sack' | 'raid' | 'revolt' | 'walls'
  // polities, second version: civil wars, bonds, the outlaw economy, forts
  | 'civilwar' | 'vassal' | 'alliance' | 'smuggle' | 'pirate' | 'blockade' | 'fort'
  // goods (goodsFormat.ts): deposits and mines, craft traditions, secrets, lanes, trading posts
  | 'deposit' | 'craft' | 'secret' | 'lane' | 'post' | 'mine'
  // disease (diseaseFormat.ts): epidemics, a sickness become endemic, armies struck; ports in quarantine
  | 'sickness' | 'quarantine'
  // tourism (tourismFormat.ts): leisure travel, resorts and fashion, sights
  | 'travel' | 'resort' | 'sight'

// ---- peoples, voyages, expeditions, technology and species (event types 10..19; all optional at runtime)

/** Event types of the peoples and exploration step (numbers, so histories from before they existed still type-check). */
export const PeoplesEvent = { VoyageLost: 10, Landfall: 11, FirstContact: 12, ExpeditionSent: 13, ExpeditionReturned: 14, Discovery: 15, TechAdvance: 16, Domesticated: 17, SpeciesAdopted: 18, Epidemic: 19 } as const
/** The last event type the chronicle and inspector know how to describe. */
export const LAST_SHOWN_EVENT = 19

/** Field names of History.technology (TechField order). */
export const TECH_FIELD_NAMES: readonly string[] = ['farming', 'seafaring', 'metalworking', 'crafts']

/** Name of people `p`, or null when the history has no such people. */
export function peopleName(h: History, p: number): string | null {
  const ps = (h as Partial<History>).peoples
  const x = Array.isArray(ps) ? ps[p] : undefined
  return x && typeof x.name === 'string' && x.name ? x.name : null
}

/** Whether settlement `id` is an expedition base. */
export function isOutpost(h: History, id: number): boolean {
  return (h.settlements[id] as { outpost?: boolean } | undefined)?.outpost === true
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

/**
 * Where each Discovery event's expedition got to, as worked out from its journey
 * (expeditionsData.ts: "the south pole", "the heart of the great desert"); events of a
 * history are fixed objects, so the text is keyed by the event.
 */
const discoveryPlaces = new WeakMap<HistoryEvent, string>()
export function setDiscoveryPlace(e: HistoryEvent, place: string): void {
  discoveryPlaces.set(e, place)
}

/** Chronicle line for `count` landfalls on small islands in one decade, naming `example`'s sender, or all senders when there is one. */
export function describeLandfallBurst(h: History, example: HistoryEvent, count: number, oneSender: boolean): string {
  const from = example.other >= 0 ? settlementName(h, example.other) : settlementName(h, example.settlement)
  return oneSender ? `Settlers from ${from} reach ${count} more islands` : `Settlers reach ${count} more islands, among them from ${from}`
}

/** Where a Discovery event's expedition got to: "the sea Oru Tal", "the southern ice" (`southern` null: "the polar ice"). */
function discoveryPlace(h: History, e: HistoryEvent, southern: boolean | null): string {
  const f = e.value >= 0 ? (h as Partial<History>).features?.[e.value] : undefined
  if (f) return `the ${featureNoun(f.kind)} ${f.name}`
  return discoveryPlaces.get(e) ?? `the ${southern === null ? 'polar' : southern ? 'southern' : 'northern'} ice`
}

// ---- species (History.species; optional at runtime)

/** Short descriptions by archetype (the real-world model a species is patterned on), for "Pallu, a highland tuber". */
const ARCHETYPE_GLOSS: Record<string, string> = {
  wheat: 'a grassland grain', barley: 'a hardy grain', paddyrice: 'a paddy grain', dryrice: 'an upland rice', sheepgoat: 'a flock of hardy browsers', rye: 'a cold-country grain', oats: 'a damp-country grain', rice: 'a paddy grain',
  maize: 'a tall-stalked grain', corn: 'a tall-stalked grain', millet: 'a dry-country grain', sorghum: 'a savanna grain', teff: 'a highland grass grain',
  quinoa: 'a mountain seed crop', buckwheat: 'a quick cold-country seed', amaranth: 'a seed crop of the uplands',
  potato: 'a highland tuber', taro: 'a wetland tuber', yam: 'a forest tuber', cassava: 'a tropical root', manioc: 'a tropical root', sweetpotato: 'a warm-country root',
  'sweet potato': 'a warm-country root', banana: 'a tropical fruit', plantain: 'a tropical fruit', breadfruit: 'a tree-grown staple', sago: 'a palm starch', coconut: 'a shore palm',
  beans: 'a climbing pulse', bean: 'a climbing pulse', lentil: 'a dry-country pulse', chickpea: 'a dry-country pulse', pea: 'a cool-country pulse', soybean: 'an oil-rich pulse', peanut: 'a ground nut',
  squash: 'a trailing gourd', dates: 'a desert palm fruit', date: 'a desert palm fruit', olive: 'an oil tree', grape: 'a vine fruit', fig: 'a dry-country fruit tree',
  sheep: 'a wool-bearing grazer', goat: 'a hardy browser', cattle: 'a great grazer', cow: 'a great grazer', ox: 'a great grazer', pig: 'a forest rooter',
  camel: 'a desert beast of burden', dromedary: 'a desert beast of burden', llama: 'a mountain pack animal', alpaca: 'a mountain wool beast', yak: 'a highland ox',
  reindeer: 'a tundra herd deer', caribou: 'a tundra herd deer', horse: 'a steppe runner', donkey: 'a sure-footed pack animal', buffalo: 'a wetland ox', 'water buffalo': 'a wetland ox',
  chicken: 'a yard fowl', duck: 'a pond fowl', goose: 'a grazing fowl', turkey: 'a woodland fowl', 'guinea pig': 'a small house beast', rabbit: 'a small burrower', dog: 'a hunting companion',
  cotton: 'a fibre shrub', flax: 'a fibre plant', hemp: 'a fibre plant', silk: 'a thread-spinning grub', silkworm: 'a thread-spinning grub', wool: 'a fibre beast',
  tea: 'a leaf for brewing', coffee: 'a bean for brewing', cacao: 'a bitter bean', tobacco: 'a smoking leaf', spice: 'a fragrant spice', pepper: 'a fiery spice', cinnamon: 'a fragrant bark',
  sugarcane: 'a sweet cane', 'sugar cane': 'a sweet cane', saffron: 'a precious spice', indigo: 'a dye plant', rose: 'a garden flower', tulip: 'a garden bulb',
}
const CATEGORY_GLOSS = ['a staple crop', 'a herd animal', 'a fibre crop', 'a luxury', 'a stimulant', 'an ornamental']
export const SPECIES_CATEGORY_NAMES: readonly string[] = ['staple', 'livestock', 'fibre', 'luxury', 'stimulant', 'ornamental']

/** "a highland tuber" for a species patterned on the potato (a category word for an archetype not listed). */
export function speciesGloss(archetype: string, category: number): string {
  // keys as "potato", "paddyRice" or "sheep goat"
  const k = archetype.toLowerCase()
  return ARCHETYPE_GLOSS[k] ?? ARCHETYPE_GLOSS[k.replace(/[\s_-]+/g, '')] ?? CATEGORY_GLOSS[category] ?? 'a useful species'
}

/** The species of a history (empty when it has none). */
export function speciesOf(h: History): readonly { id: number; name: string; archetype: string; category: number }[] {
  const sp = (h as Partial<History>).species
  return Array.isArray(sp) ? sp : []
}

/** Display name of species `id` ("Pallu"), or null. */
export function speciesName(h: History, id: number): string | null {
  const x = speciesOf(h)[id]
  return x && typeof x.name === 'string' && x.name ? x.name.charAt(0).toUpperCase() + x.name.slice(1) : null
}

/** "one in four die", "half die", "most die" for a fraction of a people lost. */
export function fractionWords(f: number): string {
  if (!(f > 0)) return 'few die'
  if (f >= 0.62) return 'most die'
  if (f >= 0.42) return 'half die'
  if (f >= 0.36) return 'two in five die'
  const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']
  const n = Math.round(1 / f)
  return n > 20 ? 'a few die' : `one in ${words[n]} die`
}

/** "The Eitebo first tame the kerrow near Tesh", and the other species lines (null for other types). */
function describeSpeciesEvent(h: History, e: HistoryEvent, forId: number): string | null {
  const t = e.type as number
  if (t !== PeoplesEvent.Domesticated && t !== PeoplesEvent.SpeciesAdopted && t !== PeoplesEvent.Epidemic) return describeSpeciesV2Event(h, e, forId)
  // (with the disease system on, a contact epidemic names its sickness: diseaseFormat.ts)
  if (t === PeoplesEvent.Epidemic && typeof e.extra === 'number') {
    const d = forId < 0 ? describeDiseaseEvent(h, e) : describeDiseaseEventFor(h, e, forId)
    if (d) return d
  }
  const p = peopleOf(h, e.settlement)
  const pn = peopleName(h, p) ?? 'people'
  const q = e.other >= 0 && e.other < h.settlements.length ? peopleOf(h, e.other) : -1
  const qn = q >= 0 ? peopleName(h, q) : null
  const sp = speciesOf(h)[e.value]
  const name = sp ? sp.name.toLowerCase() : 'a new species'
  const the = sp ? `the ${name}` : name
  const tame = sp ? tameVerb(sp.category) : 'cultivate'
  if (forId < 0) {
    if (t === PeoplesEvent.Domesticated) return `The ${pn} first ${tame} ${the} near ${settlementName(h, e.settlement)}`
    if (t === PeoplesEvent.SpeciesAdopted) return `The ${pn} take up ${the}` + (qn ? ` from the ${qn}` : '')
    return `Sickness new to the ${pn} follows contact` + (qn ? ` with the ${qn}` : '') + `: ${fractionWords(e.value)}`
  }
  if (t === PeoplesEvent.Domesticated) return `The ${pn} first ${tame === 'tame' ? 'tamed' : 'cultivated'} ${the} here`
  if (t === PeoplesEvent.SpeciesAdopted) return e.settlement === forId ? `Took up ${the}` + (qn ? ` from the ${qn}` : '') : `The ${pn} took up ${the} from here`
  return e.settlement === forId ? `A sickness new to the ${pn} struck` + (qn ? ` after contact with the ${qn}` : '') + `: ${fractionWords(e.value).replace(/ dies?$/, ' died')}` : `A sickness spread from here to the ${pn}`
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
      return describeSpeciesEvent(h, e, -1)
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
      return describeSpeciesEvent(h, e, id)
  }
}

/** Good names (lower case), indexed by Good. */
export const GOOD_NAMES: readonly string[] = ['grain', 'fish', 'livestock', 'timber', 'ore', 'salt', 'cloth', 'luxuries', 'stimulants', 'metalware', 'finery', 'treasure', 'wares']

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
    case EventType.Built: return (e.value as number) === StructureType.Fort ? 'fort' : (e.value as number) === StructureType.Mine ? 'mine' : (e.value as number) === StructureType.Factory ? 'post' : 'built'
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
    case PeoplesEvent.Domesticated:
    case PeoplesEvent.SpeciesAdopted: return 'species'
    case PeoplesEvent.Epidemic: return 'epidemic'
    case EventType.TechniqueFound:
    case EventType.TechniqueAdopted: return 'technique'
    case EventType.Blight: return 'blight'
    case EventType.HabitSpreads:
    case EventType.Drain: return 'habit'
    case EventType.Panzootic: return 'plague'
    default: return (goodsEventKind(e) as EventKind | null) ?? (diseaseEventKind(e) as EventKind | null) ?? (tourismEventKind(e) as EventKind | null) ?? (polityEventKind(null, e) as EventKind | null) ?? 'migration'
  }
}

/** Type of the structure an event refers to: `value` carries it, `other` is the structure id. */
function structureTypeOf(h: History, e: HistoryEvent): number {
  const st = (h as Partial<History>).structures?.[e.other]
  return st ? st.type : e.value
}

export function structureName(type: number): string {
  return type === StructureType.Dam ? 'dam' : type === StructureType.Fort ? 'fort' : type === StructureType.Mine ? 'mine' : type === StructureType.Factory ? 'factory' : 'port'
}

/** One-line description of an event for the global chronicle. */
export function describeEvent(h: History, e: HistoryEvent): string {
  const name = settlementName(h, e.settlement)
  switch (e.type) {
    case EventType.Founded:
      if (isOutpost(h, e.settlement)) return `An expedition from ${settlementName(h, e.other)} sets up the base ${name}`
      return e.other >= 0 ? `${name} founded from ${settlementName(h, e.other)}` : `${name} founded by an original tribe`
    case EventType.Abandoned:
      return `${name} abandoned`
    case EventType.Famine:
      return `Famine in ${name}` + (e.value > 0 ? ` (−${Math.round(e.value * 100)}%)` : '')
    case EventType.Built:
      if (isWallEvent(h, e)) return describePolityEvent(h, e) ?? `${name} raises walls`
      if (structureTypeOf(h, e) === StructureType.Fort) return `${name} builds a fort on its border`
      if (structureTypeOf(h, e) === StructureType.Mine) return describeMineBuilt(h, e, -1) ?? `${name} sinks a mine`
      if (structureTypeOf(h, e) === StructureType.Factory) return `${name} opens a merchants' quarter abroad`
      return structureTypeOf(h, e) === StructureType.Dam ? `${name} dams the river` : `${name} builds a port`
    case EventType.BecameTown:
      return `${name} grows into a town`
    case EventType.BecameCity:
      return `${name} becomes a city`
    case EventType.StructureLost:
      if (isWallEvent(h, e)) return describePolityEvent(h, e) ?? `The walls of ${name} fall into ruin`
      if (structureTypeOf(h, e) === StructureType.Fort) return `The fort of ${name} is abandoned`
      if (structureTypeOf(h, e) === StructureType.Mine) return `The mine of ${name} is abandoned`
      if (structureTypeOf(h, e) === StructureType.Factory) return `The merchants' quarter of ${name} abroad is closed`
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
      return describePeoplesEvent(h, e) ?? describeGoodsEvent(h, e) ?? describeDiseaseEvent(h, e) ?? describeTourismEvent(h, e) ?? describePolityEvent(h, e) ?? `${formatInt(e.value)} migrated from ${name} to ${settlementName(h, e.other)}`
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
      if (isOutpost(h, e.settlement)) return e.settlement === id ? `Set up by an expedition from ${settlementName(h, e.other)}` : `Set up the expedition base ${settlementName(h, e.settlement)}`
      if (e.settlement === id) return e.other >= 0 ? `Founded by migrants from ${settlementName(h, e.other)}` : 'Founded by an original tribe'
      return `Founded the colony ${settlementName(h, e.settlement)}`
    case EventType.Abandoned:
      return 'Abandoned'
    case EventType.Famine:
      return 'Famine' + (e.value > 0 ? `, lost ${Math.round(e.value * 100)}% of its people` : '')
    case EventType.Built:
      if (isWallEvent(h, e)) return describePolityEventFor(h, e, id) ?? 'Raised walls'
      if (structureTypeOf(h, e) === StructureType.Fort) return 'Built a fort on its border'
      if (structureTypeOf(h, e) === StructureType.Mine) return describeMineBuilt(h, e, id) ?? 'Sank a mine'
      if (structureTypeOf(h, e) === StructureType.Factory) return "Opened a merchants' quarter abroad"
      return structureTypeOf(h, e) === StructureType.Dam ? 'Dammed the river' : 'Built a port'
    case EventType.BecameTown:
      return `Grew into a town (${formatInt(e.value)} people)`
    case EventType.BecameCity:
      return `Became a city (${formatInt(e.value)} people)`
    case EventType.StructureLost:
      if (isWallEvent(h, e)) return describePolityEventFor(h, e, id) ?? 'Its walls fell into ruin'
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
      return describePeoplesEventFor(h, e, id) ?? describeGoodsEventFor(h, e, id) ?? describeDiseaseEventFor(h, e, id) ?? describeTourismEventFor(h, e, id) ?? describePolityEventFor(h, e, id) ?? (e.settlement === id
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
