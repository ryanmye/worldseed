// Chronicle and inspector lines for the goods events (types 50-65: deposits, traditions, secrets,
// direct lanes, trading posts, bypassed marts, fleets, smuggled secrets), from ui/goodsData.ts.
// Every function tolerates a history without goods data (null: the caller falls back).

import { EventType, LeakChannel, PostKind, SecretKind, type History, type HistoryEvent } from '../contract.ts'
import { CRAFTSMEN, DEPOSIT_NOUNS, coastWord, goodsOf, secretNoun, seedWords, type GoodsData } from './goodsData.ts'
import { formatPopulation, peopleName, peopleOf, settlementName } from './format.ts'
import { politiesOf, polityAtYear, polityTitle, snapAfter } from './politiesData.ts'

export const isGoodsEvent = (t: number) => t >= 50 && t <= 65

/** Event types whose `other` is a settlement id. */
export function goodsOtherIsSettlement(t: number): boolean {
  return t === EventType.TraditionMoved || t === EventType.SecretGuarded || t === EventType.SecretLeaked || t === EventType.MonopolyBroken || t === EventType.DirectRoute ||
    t === EventType.PostFounded || t === EventType.PostLost || t === EventType.Bypassed || t === EventType.FleetLost || t === EventType.SecretSmuggled
}

/** Chronicle dot class of a goods event ('deposit', 'craft', 'secret', 'lane', 'post'), or null. */
export function goodsEventKind(e: HistoryEvent): string | null {
  switch (e.type as number) {
    case EventType.DepositFound:
    case EventType.MineExhausted:
    case EventType.Boom: return 'deposit'
    case EventType.TraditionBorn:
    case EventType.TraditionRenowned:
    case EventType.TraditionMoved:
    case EventType.TraditionLost: return 'craft'
    case EventType.SecretGuarded:
    case EventType.SecretLeaked:
    case EventType.MonopolyBroken:
    case EventType.SecretSmuggled: return 'secret'
    case EventType.DirectRoute:
    case EventType.Bypassed:
    case EventType.FleetLost: return 'lane'
    case EventType.PostFounded:
    case EventType.PostLost: return 'post'
    default: return null
  }
}

/** Notable goods events (headlines): lanes opened, a lord's first post, secrets leaking, bypassed marts, rushes, renowned traditions. */
export function isGoodsHeadline(h: History, e: HistoryEvent): boolean {
  const t = e.type as number
  if (t === EventType.DirectRoute || t === EventType.SecretLeaked || t === EventType.MonopolyBroken || t === EventType.Bypassed || t === EventType.Boom || t === EventType.TraditionRenowned || t === EventType.SecretSmuggled) return true
  if (t === EventType.PostFounded) {
    // an owner's first post
    const gd = goodsOf(h)
    if (!gd) return false
    const owned = gd.postsOwned.get(e.other) ?? []
    return owned.length > 0 && owned[0] === e.value
  }
  return false
}

const name = (h: History, id: number) => (id >= 0 && id < h.settlements.length ? settlementName(h, id) : 'a far place')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "in the hills of Hartulim" for deposit d (by its kind and the place its variety is named after). */
function depositPlace(gd: GoodsData, d: number, fallback: string): string {
  const x = gd.history.deposits[d]
  const v = x && x.variety >= 0 ? gd.history.varieties[x.variety] : undefined
  const where = v?.maker || fallback
  if (where === fallback) {
    // named after the finders' own town
    switch (x?.kind) {
      case 3: return 'on the shores nearby'
      case 4: return 'in the waters off its coast'
      case 5: return 'on its coast'
      default: return 'in the hills nearby'
    }
  }
  switch (x?.kind) {
    case 3: return `on the shores of ${where}`
    case 4: return `in the waters off ${where}`
    case 5: return `on the coast of ${where}`
    case 9: return `in the clay pits of ${where}`
    default: return `in the hills of ${where}`
  }
}
const depositNoun = (gd: GoodsData, d: number) => {
  const k = gd.history.deposits[d]?.kind ?? 0
  return k === 5 ? 'murex shells for purple' : DEPOSIT_NOUNS[k] ?? 'treasure'
}
/** "the silver of Venet" (the deposit's place name). */
function theDeposit(gd: GoodsData, d: number, fallback: string): string {
  const x = gd.history.deposits[d]
  const v = x && x.variety >= 0 ? gd.history.varieties[x.variety] : undefined
  const noun = x ? (x.kind === 5 ? 'murex' : DEPOSIT_NOUNS[x.kind] ?? 'treasure') : 'treasure'
  return `the ${noun} of ${v?.maker || fallback}`
}
const shareWords = (f: number) => (f >= 0.6 ? 'most' : f >= 0.42 ? 'half' : f >= 0.29 ? 'a third' : f >= 0.2 ? 'a quarter' : f >= 0.1 ? 'a tenth' : 'a little')

/** The polity title ruling settlement id at the year, or its name. */
function stateOf(h: History, id: number, year: number): string {
  const pd = politiesOf(h)
  const p = pd ? polityAtYear(pd, id, year) : -1
  return pd && p >= 0 ? `The ${polityTitle(pd, p, snapAfter(pd, year))}` : name(h, id)
}
function polityShort(h: History, id: number, year: number): string {
  const pd = politiesOf(h)
  const p = pd ? polityAtYear(pd, id, year) : -1
  return pd && p >= 0 ? pd.names[p] : name(h, id)
}

/** How a secret travelled (LeakChannel), as the end of "The secret of silk reaches Walu ...". */
function channelPhrase(gd: GoodsData, k: number, ch: number, from: string): string {
  const x = gd.secrets[k]
  switch (ch) {
    case LeakChannel.Contact: return `from ${from} through trade and contact`
    case LeakChannel.Espionage: return `from ${from} by espionage`
    case LeakChannel.Defection: return `by the hands of craftsmen defecting from ${from}`
    case LeakChannel.Smuggling: return x?.kind === SecretKind.Species ? `in ${seedWords(gd, k)} smuggled out of ${from}` : `smuggled out of ${from}`
    case LeakChannel.Conquest: return `by the conquest of ${from}`
    case LeakChannel.Rediscovery: return 'where it is worked out anew'
    case LeakChannel.Chart: return `from a chart copied at ${from}`
    default: return `from ${from}`
  }
}

/** Whether leg k's path crosses water (a sea lane) by the history's capacity (water has none). */
function bySea(h: History, gd: GoodsData, k: number): boolean {
  const L = gd.legs
  if (!L) return true
  for (let i = L.pathOffsets[k] + 1; i + 1 < L.pathOffsets[k + 1]; i++) if ((h.capacity[L.path[i]] ?? 1) <= 0) return true
  return false
}

/** Chronicle line for a goods event, or null for other types (or without goods data). */
export function describeGoodsEvent(h: History, e: HistoryEvent): string | null {
  const t = e.type as number
  if (!isGoodsEvent(t)) return null
  const gd = goodsOf(h)
  if (!gd) return null
  const S = name(h, e.settlement)
  const O = name(h, e.other)
  switch (t) {
    case EventType.DepositFound: {
      const d = e.value
      return e.extra === 1 ? `An expedition from ${S} finds ${depositNoun(gd, d)} ${depositPlace(gd, d, S)}` : `Prospectors from ${S} strike ${depositNoun(gd, d)} ${depositPlace(gd, d, S)}`
    }
    case EventType.MineExhausted: {
      const k = h.deposits[e.value]?.kind ?? 0
      const where = h.deposits[e.value]?.variety >= 0 ? h.varieties[h.deposits[e.value].variety]?.maker || S : S
      return k === 4 ? `The pearl beds off ${where} are fished out` : k === 5 || k === 3 ? `The ${k === 5 ? 'murex beds' : 'amber shores'} of ${where} give out` : `The mines of ${where} give out`
    }
    case EventType.Boom:
      return `A rush to ${theDeposit(gd, e.value, S)}: it floods the markets with ${shareWords(e.extra ?? 0)} of the world's treasure`
    case EventType.TraditionBorn: {
      const x = h.traditions[e.value]
      return x ? `The ${CRAFTSMEN[x.craft] ?? 'craftsmen'} of ${S} become known for ${gd.traditionNames[e.value]}` : null
    }
    case EventType.TraditionRenowned: {
      const n = gd.traditionNames[e.value] ?? 'Its craft'
      return `${n} is renowned: it is sought far beyond ${S}` + (e.extra ? ` (quality ${e.extra.toFixed(1)})` : '')
    }
    case EventType.TraditionMoved: {
      const x = h.traditions[e.value]
      const n = gd.traditionNames[e.value] ?? 'their craft'
      const who = x ? cap(CRAFTSMEN[x.craft] ?? 'craftsmen') : 'Craftsmen'
      const made = x ? (x.craft === 3 ? 'forged' : x.craft === 0 || x.craft === 2 || x.craft === 8 || x.craft === 9 ? 'woven' : 'made') : 'made'
      const daughter = x && x.parent >= 0 ? ` (a daughter of ${gd.traditionNames[x.parent] ?? 'the old craft'})` : ''
      if (e.extra === 1) return `${who} of ${O} are carried off to ${S}: ${n} is now ${made} there${daughter}`
      if (e.extra === 2) return `${who} flee ${O} for ${S}: ${n} is now ${made} in ${S}${daughter}`
      return `${who} from ${O} carry ${n} to ${S}${daughter}`
    }
    case EventType.TraditionLost:
      return `The last workshops of ${gd.traditionNames[e.value] ?? 'the craft'} at ${S} close: the craft is lost`
    case EventType.SecretGuarded: {
      const x = gd.secrets[e.value]
      const noun = secretNoun(gd, e.value)
      return x?.kind === SecretKind.Chart ? `${stateOf(h, e.settlement, e.year)} keeps its charts of ${noun} secret` : `${stateOf(h, e.settlement, e.year)} guards the secret of ${noun}`
    }
    case EventType.SecretLeaked: {
      const x = gd.secrets[e.value]
      if (x?.kind === SecretKind.Chart) return `The pilots of ${S} learn ${secretNoun(gd, e.value)} ${channelPhrase(gd, e.value, e.extra ?? 1, O)}`
      return `The secret of ${secretNoun(gd, e.value)} reaches ${S} ${channelPhrase(gd, e.value, e.extra ?? 1, O)}`
    }
    case EventType.MonopolyBroken:
      return `${polityShort(h, e.other, e.year - 1)}'s hold on ${secretNoun(gd, e.value)} is broken` + (e.extra ? ` after ${Math.round(e.extra)} years` : '') + `: ${S} makes it now`
    case EventType.DirectRoute: {
      const sea = bySea(h, gd, e.value)
      const v = e.extra ?? -1
      const word = v >= 0 ? coastWord(gd, v) : ''
      const land = word ? `the ${word} ${sea ? 'coast' : 'lands'} of ${O}` : O
      return sea ? `Sailors of ${S} reach ${land}: a sea lane is opened` : `Merchants of ${S} reach ${land} by a direct road`
    }
    case EventType.PostFounded: {
      const k = e.extra ?? h.posts[e.value]?.kind ?? 0
      if (k === PostKind.Factory) return `${O} founds a trading post at ${S}`
      if (k === PostKind.Fort) return `${O} builds a fort at ${S} to hold its lane`
      if (k === PostKind.Station) return `${O} sets up a victualling station at ${S} on its lane`
      return `${O} sets up a mining camp at ${S}`
    }
    case EventType.PostLost: {
      const k = h.posts[e.value]?.kind ?? 0
      const what = k === PostKind.Factory ? 'trading post' : k === PostKind.Fort ? 'fort' : k === PostKind.Station ? 'station' : 'camp'
      if (e.extra === 1) return `The ${what} of ${O} at ${S} falls to conquest`
      if (e.extra === 2) return `The merchants of ${O} are expelled from ${S}`
      return `${O} gives up its ${what} at ${S}`
    }
    case EventType.Bypassed: {
      const port = isPort(h, e.settlement)
      const how = bySea(h, gd, e.value) ? `trade goes by sea from ${O}` : `trade takes the direct road from ${O}`
      return `${port ? 'The port' : 'The caravan town'} of ${S} falls quiet as ${how}` + (e.extra ? ` (${shareWords(e.extra)} of its relay trade lost)` : '')
    }
    case EventType.FleetLost:
      return `A fleet of ${S} on the lane to ${O} is lost` + (e.extra && e.extra >= 1 ? ` with a cargo worth ${formatPopulation(e.extra)}` : '')
    case EventType.SecretSmuggled: {
      const x = gd.secrets[e.value]
      const from = peopleName(h, peopleOf(h, e.other)) ?? O
      return x?.kind === SecretKind.Species ? `Smugglers carry ${seedWords(gd, e.value)} out of ${from} to ${S}` : `Smugglers carry ${secretNoun(gd, e.value)} out of ${from} to ${S}`
    }
  }
  return null
}

/** "Fevet sinks a mine into the gems of Vufes" (a Built event of a Mine), or null. */
export function describeMineBuilt(h: History, e: HistoryEvent, forId: number): string | null {
  const gd = goodsOf(h)
  const st = h.structures?.[e.other]
  if (!gd || !st) return null
  const d = h.deposits.findIndex((x) => x.cell === st.cell)
  if (d < 0) return null
  return forId >= 0 ? `Sank a mine into ${theDeposit(gd, d, name(h, e.settlement))}` : `${name(h, e.settlement)} sinks a mine into ${theDeposit(gd, d, name(h, e.settlement))}`
}

/** Whether settlement id ever built a port. */
function isPort(h: History, id: number): boolean {
  for (const st of h.structures ?? []) if (st.settlement === id && st.type === 0) return true
  return false
}

/** Inspector line for a goods event from the point of view of settlement `id`, or null. */
export function describeGoodsEventFor(h: History, e: HistoryEvent, id: number): string | null {
  const t = e.type as number
  if (!isGoodsEvent(t)) return null
  const gd = goodsOf(h)
  if (!gd) return null
  const self = e.settlement === id
  const O = name(h, e.other)
  const S = name(h, e.settlement)
  switch (t) {
    case EventType.DepositFound:
      return `Its prospectors found ${depositNoun(gd, e.value)} ${depositPlace(gd, e.value, S)}`
    case EventType.MineExhausted:
      return `Its mine on ${theDeposit(gd, e.value, S)} gave out`
    case EventType.Boom:
      return `A rush to ${theDeposit(gd, e.value, S)}, which it works`
    case EventType.TraditionBorn:
      return `${gd.traditionNames[e.value] ?? 'A craft'} was born here`
    case EventType.TraditionRenowned:
      return `${gd.traditionNames[e.value] ?? 'Its craft'} became renowned` + (e.extra ? ` (quality ${e.extra.toFixed(1)})` : '')
    case EventType.TraditionMoved:
      return self ? `Craftsmen from ${O} brought ${gd.traditionNames[e.value] ?? 'their craft'} here` : `Its craftsmen carried ${gd.traditionNames[e.value] ?? 'their craft'} to ${S}`
    case EventType.TraditionLost:
      return `${gd.traditionNames[e.value] ?? 'Its craft'} died out here`
    case EventType.SecretGuarded:
      return self ? `Began to guard the secret of ${secretNoun(gd, e.value)}` : `The secret of ${secretNoun(gd, e.value)} made here was guarded by ${stateOf(h, e.settlement, e.year)}`
    case EventType.SecretLeaked:
      return self ? `The secret of ${secretNoun(gd, e.value)} arrived ${channelPhrase(gd, e.value, e.extra ?? 1, O)}` : `The secret of ${secretNoun(gd, e.value)} passed from here to ${S}`
    case EventType.MonopolyBroken:
      return self ? `Broke the hold on ${secretNoun(gd, e.value)}` : `Lost its hold on ${secretNoun(gd, e.value)}` + (e.extra ? ` after ${Math.round(e.extra)} years` : '')
    case EventType.DirectRoute:
      return self ? (bySea(h, gd, e.value) ? `Its ships opened a direct lane to ${O}` : `Its merchants opened a direct road to ${O}`) : `A direct lane from ${S} reached here`
    case EventType.PostFounded:
      return self ? (h.posts[e.value]?.kind === PostKind.Factory ? `${O} founded a trading post here` : `Founded as a ${['factory', 'fort', 'victualling station', 'mining camp'][h.posts[e.value]?.kind ?? 0]} of ${O}`) : `Founded a trading post at ${S}`
    case EventType.PostLost:
      return self ? `The post of ${O} here was ${e.extra === 1 ? 'taken' : e.extra === 2 ? 'expelled' : 'given up'}` : `Lost its post at ${S}`
    case EventType.Bypassed:
      return self ? `Bypassed: trade went ${bySea(h, gd, e.value) ? 'by sea' : 'by the direct road'} from ${O}` + (e.extra ? ` (lost ${shareWords(e.extra)} of its relay trade)` : '') : `Its lane bypassed ${S}`
    case EventType.FleetLost:
      return self ? `A fleet bound for ${O} was lost` : `A fleet of ${S} bound here was lost`
    case EventType.SecretSmuggled:
      if (gd.secrets[e.value]?.kind !== SecretKind.Species) return self ? `The secret of ${secretNoun(gd, e.value)} arrived with smugglers` : `Smugglers carried the secret of ${secretNoun(gd, e.value)} from here to ${S}`
      return self ? `Smuggled ${seedWords(gd, e.value)} arrived` : `Smugglers carried ${seedWords(gd, e.value)} from here to ${S}`
  }
  return null
}

/** Grouping key of a goods event for the chronicle (per decade: deposit finds; per leg: bypassed towns and lost fleets), or -1 for a line of its own. */
export function goodsGroupKey(e: HistoryEvent): number {
  const t = e.type as number
  const decade = Math.floor(e.year / 10)
  if (t === EventType.DepositFound) return (t * 100000 + 0) * 1000 + decade
  if (t === EventType.Bypassed || t === EventType.FleetLost) return (t * 100000 + Math.max(0, e.value) + 1) * 1000 + decade
  if (t === EventType.PostFounded || t === EventType.PostLost) return (t * 100000 + Math.max(0, e.other) + 1) * 1000 + decade
  return -1
}

/** Chronicle line for a group of goods events of one kind (goodsGroupKey). */
export function describeGoodsGroup(h: History, members: readonly HistoryEvent[]): string {
  const e = members[members.length - 1]
  const n = members.length
  const gd = goodsOf(h)
  const t = e.type as number
  if (!gd) return `${n} events`
  if (t === EventType.DepositFound) {
    const kinds = new Set(members.map((m) => DEPOSIT_NOUNS[h.deposits[m.value]?.kind ?? 0] ?? 'treasure'))
    const list = [...kinds]
    const what = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
    return `Prospectors find ${n} deposits of ${what}, among them ${depositNoun(gd, e.value)} ${depositPlace(gd, e.value, name(h, e.settlement))}`
  }
  if (t === EventType.Bypassed) return `${n} towns of the old relay trade fall quiet as trade goes ${bySea(h, gd, e.value) ? 'by sea' : 'by the direct road'} from ${name(h, e.other)}, among them ${name(h, e.settlement)}`
  if (t === EventType.FleetLost) return `${n} fleets of ${name(h, e.settlement)} are lost on the lane to ${name(h, e.other)}`
  if (t === EventType.PostFounded) return `${name(h, e.other)} founds ${n} trading posts, among them at ${name(h, e.settlement)}`
  if (t === EventType.PostLost) return `${name(h, e.other)} loses ${n} trading posts, among them at ${name(h, e.settlement)}`
  return `${n} events, among them: ${describeGoodsEvent(h, e) ?? ''}`
}

