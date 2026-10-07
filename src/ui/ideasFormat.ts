// Chronicle and inspector lines for the ideas events (types 120-123: an idea conceived, taken up from another people, lost,
// refused), from ui/ideasData.ts, with the idea, people and settlement names (towns as named in the event's year: the chronicle
// renders inside withEventNames). The chronicle gathers a half-century's adoptions of one idea ("Iron spreads to the Leko,
// Temukun and 3 more peoples") and a half-century's refusals of one idea; an idea's first arrival in a network of peoples cut off
// from every holder until lately is a headline, and those of one network in one half-century are one line ("New contacts bring
// the Hunu writing, iron and 12 more ideas"). Conceptions are headlines (independent ones notable). Every function tolerates a
// history without ideas (null, '' or -1: the caller falls back).

import { EventType, IdeaHow, IdeaLoss, IdeaResist, type History, type HistoryEvent } from '../contract.ts'
import { peopleName, settlementName } from './format.ts'
import { ideaBehindAdvance, ideasOf, rowOfEvent, type IdeasData } from './ideasData.ts'

export const isIdeasEvent = (t: number) => t >= EventType.IdeaConceived && t <= EventType.IdeaResisted

/** Event types whose `other` is a settlement id: the first origin of an independent conception, where an adopted idea came from, where a refused one came from. */
export const ideasOtherIsSettlement = (t: number) => t === EventType.IdeaConceived || t === EventType.IdeaAdopted || t === EventType.IdeaResisted

/** Chronicle dot class of an ideas event ('idea'; 'ideaLost' for a loss or a refusal), or null. */
export function ideasEventKind(e: HistoryEvent): string | null {
  const t = e.type as number
  if (t === EventType.IdeaConceived || t === EventType.IdeaAdopted) return 'idea'
  return t === EventType.IdeaLost || t === EventType.IdeaResisted ? 'ideaLost' : null
}

/** Verbs per idea: what a people does when it first has it ("first set down writing"), the passive for "here" ("was first set down here"), and what it forgets ("forget how to write"). */
const VERBS: Record<string, readonly [string, string, string]> = {
  pottery: ['fire pottery', 'fired', 'fire pots'],
  sail: ['raise a sail', 'raised', 'rig a sail'],
  ard: ['yoke the plough', 'yoked', 'yoke the plough'],
  loom: ['weave on a loom', 'strung', 'weave on the loom'],
  irrigation: ['dig irrigation canals', 'dug', 'keep their canals'],
  calendar: ['reckon a calendar', 'reckoned', 'keep the calendar'],
  bronze: ['cast bronze', 'cast', 'cast bronze'],
  wheel: ['set carts on wheels', 'turned', 'make wheels'],
  riding: ['ride horses', 'mastered', 'ride'],
  potterWheel: ['throw pots on the wheel', 'spun', 'throw pots on the wheel'],
  iron: ['smelt iron', 'mastered', 'smelt iron'],
  writing: ['set down writing', 'set down', 'write'],
  keel: ['build keeled ships', 'built', 'build keeled ships'],
  coinage: ['strike coins', 'struck', 'strike coins'],
  chariot: ['drive chariots', 'driven', 'build chariots'],
  watermill: ['set a mill wheel in a stream', 'built', 'build watermills'],
  collar: ['harness horses with a collar', 'tried', 'harness with the collar'],
  alphabet: ['write with an alphabet', 'written', 'write their letters'],
  glass: ['blow glass', 'blown', 'make glass'],
  lawCode: ['write down their laws', 'written down', 'keep written laws'],
  roads: ['pave roads', 'laid', 'keep up their roads'],
  fortification: ['raise stone walls', 'practised', 'build walls'],
  mathematics: ['reckon with positional numbers', 'used', 'reckon with positional numbers'],
  stirrup: ['ride with stirrups', 'used', 'ride with stirrups'],
  paper: ['make paper', 'made', 'make paper'],
  terrace: ['terrace their hillsides', 'practised', 'keep their terraces'],
  castIron: ['fire a blast furnace', 'fired', 'run the blast furnace'],
  windmill: ['build windmills', 'built', 'build windmills'],
  heavyPlough: ['turn heavy soil with the heavy plough', 'yoked', 'work the heavy plough'],
  lateen: ['rig the lateen sail', 'rigged', 'rig the lateen sail'],
  rudder: ['steer by a stern rudder', 'hung', 'hang a stern rudder'],
  compass: ['steer by the compass', 'used', 'steer by the compass'],
  spinningWheel: ['spin on the wheel', 'turned', 'spin on the wheel'],
  cartography: ['draw true charts', 'practised', 'draw charts'],
  clock: ['build mechanical clocks', 'built', 'build clocks'],
  quarantine: ['hold ships in quarantine', 'imposed', 'keep quarantine'],
  banking: ['draw bills of exchange', 'drawn', 'draw bills of exchange'],
  gunpowder: ['mix gunpowder', 'mixed', 'mix gunpowder'],
  printing: ['print with movable type', 'practised', 'print'],
  navigation: ['navigate by the stars', 'practised', 'navigate by the stars'],
  rotation: ['rotate their crops', 'practised', 'rotate their crops'],
  breeding: ['breed their stock with care', 'practised', 'breed with care'],
  drainage: ['drain their fields', 'practised', 'drain their fields'],
  inoculation: ['inoculate against the pox', 'practised', 'inoculate'],
  science: ['put nature to the test', 'practised', 'test nature by experiment'],
}
/** Ideas whose names are plural ("law codes were"). */
const PLURAL = new Set(['lawCode', 'roads', 'mathematics', 'banking'])

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const sname = (h: History, id: number) => (id >= 0 && id < h.settlements.length ? settlementName(h, id) : '')
const pname = (h: History, p: number) => peopleName(h, p) ?? 'people'
const peopleOfSettlement = (h: History, id: number) => (id >= 0 && id < h.settlements.length ? h.settlements[id].people : -1)

/** The idea's name ("writing", "the plough"), or 'an idea'. */
export function ideaName(dd: IdeasData | null, i: number): string {
  return dd?.ideas[i]?.name ?? 'an idea'
}
const keyOf = (dd: IdeasData, i: number) => dd.ideas[i]?.key ?? ''
const verbs = (dd: IdeasData, i: number): readonly [string, string, string] => VERBS[keyOf(dd, i)] ?? [`hit upon ${ideaName(dd, i)}`, 'conceived', `keep up ${ideaName(dd, i)}`]
/** "is" or "are" for the idea's name. */
const isAre = (dd: IdeasData, i: number) => (PLURAL.has(keyOf(dd, i)) ? 'are' : 'is')
const reaches = (dd: IdeasData, i: number) => (PLURAL.has(keyOf(dd, i)) ? 'reach' : 'reaches')
const spreads = (dd: IdeasData, i: number) => (PLURAL.has(keyOf(dd, i)) ? 'spread' : 'spreads')
const wasWere = (dd: IdeasData, i: number) => (PLURAL.has(keyOf(dd, i)) ? 'were' : 'was')

/** "Writing was first set down here" (the inspector's line for an idea conceived at a settlement). */
export function conceivedHere(dd: IdeasData, i: number): string {
  return `${cap(ideaName(dd, i))} ${wasWere(dd, i)} first ${verbs(dd, i)[1]} here`
}

/** How an idea came, for a line about an adoption: "by trade from Sunsik", "from their neighbours the Chasi" (src a settlement or -1, from a people or -1). */
export function channelPhrase(h: History, how: number, src: number, from: number): string {
  const s = src >= 0 ? sname(h, src) : ''
  const fp = from >= 0 ? peopleName(h, from) : null
  const fromP = fp ? `the ${fp}` : s || 'another people'
  const at = s || fromP
  switch (how) {
    case IdeaHow.Contact: return fp ? `from envoys of the ${fp}` : `from strangers of ${at}`
    case IdeaHow.Neighbours: return fp ? `from their neighbours the ${fp}` : `from their neighbours at ${at}`
    case IdeaHow.Trade: return `by trade from ${at}`
    case IdeaHow.Lane: return `along the long-haul lane from ${at}`
    case IdeaHow.Post: return s ? `through the traders of ${s}` : `through a trading post of ${fromP}`
    case IdeaHow.Migration: return `with migrants from ${at}`
    case IdeaHow.Conquest: return `in the wake of conquest, from ${at}`
    case IdeaHow.Empire: return `under one rule with ${fromP}`
    case IdeaHow.Pilgrims: return `with pilgrims from ${at}`
    case IdeaHow.Visitors: return `with visitors from ${at}`
    case IdeaHow.Marriage: return `through a royal marriage with ${fromP}`
    case IdeaHow.Theft: return s && fp ? `stolen from the ${fp} at ${s}` : `stolen from ${fromP}`
    default: return fp ? `from the ${fp}` : s ? `from ${s}` : ''
  }
}

/** Why a people lost an idea, as the chronicle's opening ("Few and cut off, "), and briefly ("few and cut off"). */
function lossWords(cause: number): [string, string] {
  if (cause === IdeaLoss.Collapse) return ['Their numbers broken, ', 'their numbers broken']
  if (cause === IdeaLoss.Prerequisite) return ['', 'what it rested on was lost']
  return ['Few and cut off, ', 'few and cut off']
}
export const lossShort = (cause: number) => lossWords(cause)[1]
/** Who refused it: "their clergy", "their ruler", "the guilds". */
export function refusalShort(cause: number): string {
  return cause === IdeaResist.Ruler ? 'their ruler' : cause === IdeaResist.Guild ? 'the guilds' : 'their clergy'
}

/** The row of an adoption event and whether it is a first arrival in a network cut off until lately. */
function rowInfo(h: History, e: HistoryEvent): { dd: IdeasData; k: number } | null {
  const dd = ideasOf(h)
  if (!dd) return null
  return { dd, k: rowOfEvent(dd, e) }
}

/** Chronicle line for an ideas event (120-123), or null for other types or without ideas data. */
export function describeIdeasEvent(h: History, e: HistoryEvent): string | null {
  const t = e.type as number
  if (!isIdeasEvent(t)) return null
  const dd = ideasOf(h)
  if (!dd) return null
  const i = e.value
  const p = peopleOfSettlement(h, e.settlement)
  const P = pname(h, p)
  const name = ideaName(dd, i)
  const v = verbs(dd, i)
  if (t === EventType.IdeaConceived) {
    const first = !(typeof e.extra === 'number' && e.extra > 0)
    if (first) return `The ${P} of ${sname(h, e.settlement)} first ${v[0]}`
    const op = peopleOfSettlement(h, e.other)
    return `The ${P} of ${sname(h, e.settlement)} ${v[0]}, independently` + (op >= 0 && op !== p ? ` of the ${pname(h, op)}` : e.other >= 0 ? ` of ${sname(h, e.other)}` : '')
  }
  if (t === EventType.IdeaAdopted) {
    const k = rowOfEvent(dd, e)
    const from = k >= 0 ? dd.A.from[k] : peopleOfSettlement(h, e.other)
    const ch = channelPhrase(h, e.extra ?? 0, e.other, from)
    const line = `${cap(name)} ${reaches(dd, i)} the ${P} at ${sname(h, e.settlement)}` + (ch ? `, ${ch}` : '')
    return k >= 0 && dd.netFirst[k] ? `${line}: the first of their world to have it` : line
  }
  if (t === EventType.IdeaLost) {
    const c = e.extra ?? IdeaLoss.Isolated
    if (c === IdeaLoss.Prerequisite) return `With what it rested on gone, the ${P} lose ${name} too`
    return `${lossWords(c)[0]}the ${P} forget how to ${v[2]}`
  }
  // refused
  const c = e.extra ?? IdeaResist.Faith
  if (c === IdeaResist.Ruler) return `The ruler of the ${P} forbids ${name}`
  if (c === IdeaResist.Guild) return `The guilds of ${sname(h, e.settlement)} keep ${name} out`
  return `The clergy of the ${P} turn ${name} away`
}

/** Description of an ideas event from the point of view of settlement `id` (inspector's recent events), or null. */
export function describeIdeasEventFor(h: History, e: HistoryEvent, id: number): string | null {
  const t = e.type as number
  if (!isIdeasEvent(t)) return null
  const dd = ideasOf(h)
  if (!dd) return null
  const i = e.value
  const p = peopleOfSettlement(h, e.settlement)
  const P = pname(h, p)
  const name = ideaName(dd, i)
  if (t === EventType.IdeaConceived) {
    if (e.settlement === id) return conceivedHere(dd, i) + (typeof e.extra === 'number' && e.extra > 0 ? ', independently' : '')
    return `The ${P} at ${sname(h, e.settlement)} came upon ${name} again, independently`
  }
  if (t === EventType.IdeaAdopted) {
    const k = rowOfEvent(dd, e)
    const from = k >= 0 ? dd.A.from[k] : peopleOfSettlement(h, e.other)
    if (e.settlement === id) {
      const ch = channelPhrase(h, e.extra ?? 0, e.other, from)
      return `${cap(name)} entered the ${P} lands here` + (ch ? `, ${ch}` : '')
    }
    return `${cap(name)} went from here to the ${P} at ${sname(h, e.settlement)}`
  }
  if (t === EventType.IdeaLost) {
    const c = e.extra ?? IdeaLoss.Isolated
    return c === IdeaLoss.Prerequisite ? `The ${P} lost ${name} with what it rested on` : `The ${P} forgot how to ${verbs(dd, i)[2]} (${lossShort(c)})`
  }
  const c = e.extra ?? IdeaResist.Faith
  if (e.settlement !== id) return `${cap(name)} went from here to the ${P}, who turned it away`
  return c === IdeaResist.Ruler ? `The ruler of the ${P} forbade ${name}` : c === IdeaResist.Guild ? `Its guilds kept ${name} out` : `The clergy of the ${P} turned ${name} away`
}

/**
 * Whether an ideas event is the conception or adoption of an idea that is one of the species system's farming techniques
 * (terracing, the heavy plough, rotation, breeding), which the species lines already say: the inspector's events and the
 * chronicle's All view leave it out; the chronicle lists it under its Ideas filter only (chronicle.ts).
 */
export function ideasHiddenInChronicle(h: History, e: HistoryEvent): boolean {
  const t = e.type as number
  if (t !== EventType.IdeaConceived && t !== EventType.IdeaAdopted) return false
  const x = (h as Partial<History>).ideas?.[e.value]
  return !!x && x.technique >= 0 && Array.isArray((h as Partial<History>).techniques) && h.techniques.length > x.technique
}

/** Years per bucket of the chronicle's spread and refusal groups. */
export const IDEAS_BUCKET_YEARS = 50

/**
 * Grouping key of an ideas event for the chronicle, or -1 for a line of its own: an idea's adoptions per half-century; the first
 * arrivals of ideas in one network per half-century (keyed apart, see isNetworkGroupKey); an idea's refusals per half-century.
 */
export function ideasGroupKey(h: History, e: HistoryEvent): number {
  const t = e.type as number
  const b = Math.floor(e.year / IDEAS_BUCKET_YEARS)
  // a farming technique's: its own idea's groups only (never a network's first arrivals, which the All view shows)
  if (ideasHiddenInChronicle(h, e)) return t === EventType.IdeaAdopted ? 1e9 + e.value * 1000 + b : -1
  if (t === EventType.IdeaAdopted) {
    const r = rowInfo(h, e)
    if (r && r.k >= 0 && r.dd.netFirst[r.k]) return 3e9 + (r.dd.netOf[r.k] + 1) * 1000 + b
    return 1e9 + e.value * 1000 + b
  }
  if (t === EventType.IdeaResisted) return 2e9 + e.value * 1000 + b
  return -1
}
export const isNetworkGroupKey = (k: number) => k >= 3e9

/** Notable single lines: conceptions (headlines when first: see isIdeasHeadline), losses. */
export function isIdeasNotable(e: HistoryEvent): boolean {
  const t = e.type as number
  return t === EventType.IdeaConceived || t === EventType.IdeaLost
}

/** Headlines: an idea first conceived anywhere, an idea's first arrival in a network cut off from every holder until lately. */
export function isIdeasHeadline(h: History, e: HistoryEvent): boolean {
  const t = e.type as number
  if (t === EventType.IdeaConceived) return !(typeof e.extra === 'number' && e.extra > 0)
  if (t === EventType.IdeaAdopted) {
    const r = rowInfo(h, e)
    return !!r && r.k >= 0 && r.dd.netFirst[r.k] === 1
  }
  return false
}

/** "A", "A and B", "A, B and C", "A, B and 3 more" (`more` the noun after the count). */
function listOf(xs: readonly string[], more: string, max = 3): string {
  if (xs.length <= 1) return xs[0] ?? ''
  if (xs.length <= max) return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
  return `${xs.slice(0, max - 1).join(', ')} and ${xs.length - max + 1} more${more ? ` ${more}` : ''}`
}

/** Chronicle line for a group of ideas events of one key (ideasGroupKey; members chronological). */
export function describeIdeasGroup(h: History, members: readonly HistoryEvent[]): string {
  const dd = ideasOf(h)
  const last = members[members.length - 1]
  if (!dd || members.length === 1) return describeIdeasEvent(h, last) ?? ''
  const peoples: number[] = []
  const ideas: number[] = []
  for (const m of members) {
    const p = peopleOfSettlement(h, m.settlement)
    if (p >= 0 && !peoples.includes(p)) peoples.push(p)
    if (!ideas.includes(m.value)) ideas.push(m.value)
  }
  const names = peoples.map((p) => pname(h, p))
  const t = last.type as number
  if (t === EventType.IdeaResisted) {
    const i = last.value
    const c = last.extra ?? IdeaResist.Faith
    if (members.every((m) => (m.extra ?? IdeaResist.Faith) === c)) {
      const who = c === IdeaResist.Ruler ? 'rulers' : c === IdeaResist.Guild ? 'guilds' : 'clergy'
      return `The ${who} of the ${listOf(names, 'peoples')} turn ${ideaName(dd, i)} away`
    }
    return `${cap(ideaName(dd, i))} ${isAre(dd, i)} turned away by the ${listOf(names, 'peoples')}`
  }
  if (isNetworkGroupKey(ideasGroupKey(h, last))) {
    if (ideas.length === 1) return `${cap(ideaName(dd, ideas[0]))} ${reaches(dd, ideas[0])} the ${listOf(names, 'peoples')}, the first of their world to have it`
    return `New contacts bring the ${listOf(names, 'peoples')} ${listOf(ideas.map((i) => ideaName(dd, i)), 'ideas')}`
  }
  const i = last.value
  if (peoples.length === 1) return describeIdeasEvent(h, last) ?? ''
  return `${cap(ideaName(dd, i))} ${spreads(dd, i)} to the ${listOf(names, 'peoples')}`
}

/** Whether a group is a headline (a network's first arrivals). */
export function isIdeasGroupHeadline(h: History, members: readonly HistoryEvent[]): boolean {
  return members.length > 0 && isNetworkGroupKey(ideasGroupKey(h, members[members.length - 1]))
}

/** ", building on paper" for a technology advance (TechAdvance event) the people owes to an idea taken up lately ('' none). */
export function techAdvanceNote(h: History, e: HistoryEvent): string {
  const dd = ideasOf(h)
  if (!dd) return ''
  const i = ideaBehindAdvance(dd, peopleOfSettlement(h, e.settlement), e.value, e.year)
  return i >= 0 ? `, building on ${ideaName(dd, i)}` : ''
}
