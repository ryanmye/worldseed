// rulers, religion: chronicle and inspector lines for the rulers events (80-88: accessions, reigns
// ended, houses founded and ended, regencies, personal unions, royal marriages, wars of succession)
// and the faith events (89-97: faiths founded, rulers converted, state religions, schisms,
// persecutions, holy wars, holy cities fallen, faiths dying out, faiths reaching a people), with
// ruler, house and faith names (rulersData.ts, faithsData.ts), and their grouping in the chronicle:
// a succession's events (the old reign's end, the accession, a regency, a new house) make one line;
// routine successions are gathered per state per quarter-century (chiefdoms all together); contested
// and dynastic successions, unions, wars of succession, holy wars, faiths founded, schisms and holy
// cities fallen are headlines. Every function tolerates a history without the tables (null: the
// caller falls back to what it said before).

import { AccessionHow, EventType, FaithKind, ReignEnd, UnionEnd, type History, type HistoryEvent } from '../contract.ts'
import { capitalAt, polityAtYear } from './politiesData.ts'
import { peopleName, peopleOf, settlementName } from './format.ts'
import { faithName, faithsOf, type FaithsData } from './faithsData.ts'
import {
  GroupClass, groupClassOf, his, houseName, isCadet, isFaithEvent, isRulersEvent, kinWordOfPredecessor, marriagePartner, rulerAt, rulersOf, rulerWord, type RulersData,
} from './rulersData.ts'

/** Whether an event type is one of these (80-97). */
export const isRulersOrFaithEvent = (t: number) => isRulersEvent(t) || isFaithEvent(t)

/** Chronicle dot class: 'ruler' (80-88) or 'faith' (89-97), or null. */
export function rulersEventKind(e: HistoryEvent): string | null {
  const t = e.type as number
  return isRulersEvent(t) ? 'ruler' : isFaithEvent(t) ? 'faith' : null
}

/** Grouping key of event index i in the chronicle (rulersData.ts groupKey), or -1 for a line of its own. */
export function rulersGroupKey(h: History, i: number): number {
  return rulersOf(h)?.groupKey.get(i) ?? -1
}
/** Whether a grouping key gathers faith events (else rulers). */
export const isFaithGroupKey = (key: number) => groupClassOf(key) === GroupClass.Faith || groupClassOf(key) === GroupClass.Reached || groupClassOf(key) === GroupClass.HolyWar

/** Event types whose `other` is a settlement id: the senior realm's capital, the marriage partner's, the claimant's target, the parent faith's holy city, the enemy's capital, the army's base, where a faith came from. */
export function rulersOtherIsSettlement(t: number): boolean {
  return t === EventType.UnionFormed || t === EventType.UnionDissolved || t === EventType.RoyalMarriage || t === EventType.SuccessionWar ||
    t === EventType.Schism || t === EventType.HolyWar || t === EventType.HolyCityFell || t === EventType.FaithReached
}

/** Whether event index i is left out of the chronicle (a reign or a house ended with its realm: the realm's end says it). */
export function rulersDropped(h: History, i: number): boolean {
  return rulersOf(h)?.dropped.has(i) ?? false
}

/** Whether event index i is left out of its settlement's own event list (the accession line of the same year says it). */
export function rulersHiddenInList(h: History, i: number): boolean {
  return rulersOf(h)?.hideInList.has(i) ?? false
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const sname = (h: History, id: number) => (id >= 0 && id < h.settlements.length ? settlementName(h, id) : 'a far place')
const pname = (rd: RulersData, q: number) => (q >= 0 && q < rd.P ? rd.pd.names[q] : 'the realm')
/** The polity ruled from capital `id` at `year` (-1). */
function polityOfCapital(rd: RulersData, id: number, year: number): number {
  if (id < 0 || id >= rd.pd.settlementCount) return -1
  const q = polityAtYear(rd.pd, id, year)
  if (q >= 0) return q
  for (let p = 0; p < rd.P; p++) if (capitalAt(rd.pd, p, year) === id && rd.pd.list[p].foundedYear <= year) return p
  return -1
}
const fname = (fd: FaithsData | null, f: number | undefined) => (fd && typeof f === 'number' && f >= 0 ? faithName(fd, f) : 'another faith')
/** "the Unlafa faith" or, for a people's own, "the old Lurakufa ways". */
const fname2 = (fd: FaithsData | null, f: number | undefined) => (fd && typeof f === 'number' && f >= 0 ? faithName(fd, f, false) : 'another faith')

/** "Narun II of House Rilkoik" (no house for a league's head). */
function rname(rd: RulersData, r: number, house = true): string {
  if (r < 0 || r >= rd.R) return 'a new ruler'
  const hn = house ? houseName(rd, r) : ''
  return hn ? `${rd.title[r]} of ${hn}` : rd.title[r]
}

/** The participle for how a reign ended, for "succeeds his father, fallen in battle", or ''. */
function endNote(rd: RulersData, o: number): string {
  if (o < 0) return ''
  switch (rd.rulers[o].end) {
    case ReignEnd.Battle: return 'fallen in battle'
    case ReignEnd.Sack: return 'killed as the capital fell'
    case ReignEnd.Plague: return 'dead of plague'
    case ReignEnd.Overthrown: return 'overthrown and killed'
    case ReignEnd.Deposed: return 'deposed'
  }
  return ''
}

interface SuccessionParts {
  acc: number
  end: number
  newHouse: boolean
  houseEnded: number
  regency: number
  crisis: boolean
  union: number
}

/** One line for a succession: the new reign `r` (and the old one, its house, a regency, a crisis). */
function successionLine(rd: RulersData, x: SuccessionParts, forId = -1): string {
  const h = rd.history
  const r = x.acc
  const o = r >= 0 ? rd.rulers[r].predecessor : x.end
  const q = r >= 0 ? rd.rulers[r].polity : o >= 0 ? rd.rulers[o].polity : -1
  const here = forId >= 0
  const where = here ? 'here' : `in ${pname(rd, q)}`
  const throne = here ? 'the throne' : `the throne of ${pname(rd, q)}`
  if (r < 0) {
    // only the end of a reign
    if (o < 0) return 'A reign ends'
    const y = rd.rulers[o]
    const name = rname(rd, o, false)
    const years = y.ended >= 0 ? y.ended - y.acceded : 0
    const at = here ? '' : ` of ${pname(rd, q)}`
    switch (y.end) {
      case ReignEnd.Natural: return `${name}${at} dies after ${years} ${years === 1 ? 'year' : 'years'} on the throne`
      case ReignEnd.Battle: return `${name}${at} falls in battle`
      case ReignEnd.Sack: return `${name}${at} is killed as the capital falls`
      case ReignEnd.Overthrown: return `${name}${at} is overthrown and killed`
      case ReignEnd.Deposed: return `${name}${at} is deposed`
      case ReignEnd.Plague: return `${name}${at} dies of plague`
      case ReignEnd.RealmEnded: return `The reign of ${name} ends with the realm${here ? '' : ` of ${pname(rd, q)}`}`
      case ReignEnd.TermEnded: return `The term of ${name} as head${at} ends`
    }
    return `The reign of ${name}${at} ends`
  }
  const z = rd.rulers[r]
  const name = rname(rd, r, !x.newHouse)
  const hn = houseName(rd, r)
  const kin = kinWordOfPredecessor(rd, r)
  const note = endNote(rd, o)
  let s: string
  switch (z.how) {
    case AccessionHow.Inherited:
      if (kin) s = `${name} succeeds ${his(z)} ${kin}${note ? `, ${note},` : ''} ${where}`
      else if (isCadet(rd, r)) s = `${rd.title[r]}, ${z.female ? 'a kinswoman' : 'a kinsman'} from a cadet line of ${hn || 'the house'}, takes ${throne}`
      else s = `${name} inherits ${throne}`
      break
    case AccessionHow.Elected:
      if (z.dynasty < 0) s = `${rd.title[r]} is elected head of the league${here ? '' : ` of ${pname(rd, q)}`}`
      else if (x.newHouse) s = `The great men ${here ? 'here ' : ''}raise ${rd.title[r]} of ${hn} to ${throne}`
      else s = `The great men ${here ? 'here ' : `of ${pname(rd, q)} `}elect ${name}`
      break
    case AccessionHow.Usurped:
      s = `${name} seizes ${throne}` + (o >= 0 ? ` from ${rd.title[o]}` + (rd.rulers[o].end === ReignEnd.Overthrown ? ', who is killed' : rd.rulers[o].end === ReignEnd.Deposed ? ', who is deposed' : '') : '')
      break
    case AccessionHow.Conquered:
      s = `Conquerors set ${name} on ${throne}`
      break
    case AccessionHow.Union: {
      const U = h.unions
      const senior = x.union >= 0 && U ? U.senior[x.union] : -1
      s = `${rd.title[r]}${senior >= 0 ? ` of ${pname(rd, senior)}` : ''} also takes ${throne} through a marriage claim: a personal union`
      break
    }
    case AccessionHow.Claimed:
      s = `${name} rises as a rival claimant` + (here ? ' here' : ` at ${sname(h, rd.pd.list[q]?.capitals?.[0] ?? -1)}`)
      break
    default:
      s = o < 0 ? `${name} rules the new realm${here ? '' : ` of ${pname(rd, q)}`}` : `${name} comes to ${throne}`
  }
  if (x.crisis && z.how !== AccessionHow.Usurped) s += ' after a contested succession'
  if (x.newHouse && z.how !== AccessionHow.Elected) s += o >= 0 ? `: ${hn} comes to the throne` : `, founding ${hn}`
  if (x.houseEnded >= 0 && x.houseEnded < rd.D) s += `; House ${rd.dynasties[x.houseEnded].name} has lost its last throne`
  if (x.regency > 0) s += `; a regency rules for the ${rulerWord(rd, r, z.acceded).toLowerCase()}, aged ${Math.max(0, z.acceded - z.born)}`
  return s
}

/** The succession parts of a set of events (one state, one year, or a single event). */
function partsOf(rd: RulersData, members: readonly HistoryEvent[]): SuccessionParts {
  const x: SuccessionParts = { acc: -1, end: -1, newHouse: false, houseEnded: -1, regency: 0, crisis: false, union: -1 }
  for (const e of members) {
    const t = e.type as number
    if (t === EventType.RulerAcceded) x.acc = e.value
    else if (t === EventType.ReignEnded) x.end = e.value
    else if (t === EventType.DynastyFounded) x.newHouse = true
    else if (t === EventType.DynastyEnded) x.houseEnded = e.value
    else if (t === EventType.Regency) x.regency = e.extra ?? 1
    else if (t === EventType.SuccessionCrisis) x.crisis = true
    else if (t === EventType.UnionFormed) x.union = e.value
  }
  // an accession's own new house (DynastyFounded may have been left in another group)
  if (x.acc >= 0 && !x.newHouse) {
    const z = rd.rulers[x.acc]
    const d = z.dynasty >= 0 ? rd.dynasties[z.dynasty] : null
    if (d && d.founder === x.acc) x.newHouse = true
  }
  if (x.acc >= 0 && x.regency === 0) x.regency = rd.regency[x.acc]
  return x
}

/** Why house d lost its last throne (from its last reign's end and what came after). */
function houseEndWords(rd: RulersData, d: number, last: number): string {
  if (last < 0 || last >= rd.R) return ''
  const y = rd.rulers[last]
  const h = rd.history
  const next = (() => {
    for (let k = h.reignOffsets[y.polity]; k < h.reignOffsets[y.polity + 1]; k++) if (rd.rulers[h.reignIds[k]].predecessor === last) return h.reignIds[k]
    return -1
  })()
  if (y.end === ReignEnd.RealmEnded || next < 0) return 'its realm gone'
  const z = rd.rulers[next]
  if (z.how === AccessionHow.Usurped) return 'overthrown'
  if (z.how === AccessionHow.Conquered) return 'by conquest'
  if (z.how === AccessionHow.Union) return 'the throne passed to a foreign king'
  if (z.how === AccessionHow.Elected) return 'no heir: the great men chose another house'
  return d >= 0 ? 'no heir' : ''
}

const FOUNDING_WOE_YEARS = 25
const woeOfFounding = new WeakMap<HistoryEvent, string>()
/** "after the great plague", "in the hungry years after a famine", "after the city was sacked", or '' (the founding crises of faiths). */
function foundingWoe(h: History, e: HistoryEvent): string {
  const c = woeOfFounding.get(e)
  if (c !== undefined) return c
  const id = e.settlement
  let best = '', by = -1e9
  const O = h.outbreaks
  if (O && O.count > 0) for (let i = 0; i < O.count; i++) {
    if (O.settlement[i] !== id || O.year[i] > e.year || O.year[i] < e.year - FOUNDING_WOE_YEARS) continue
    if (O.year[i] > by) {
      by = O.year[i]
      best = h.epidemics?.[O.epidemic[i]]?.great ? 'after the great plague' : 'after a plague'
    }
  }
  for (const x of h.events) {
    if (x.settlement !== id || x.year > e.year || x.year < e.year - FOUNDING_WOE_YEARS) continue
    const t = x.type as number
    if (t === EventType.Famine && x.year >= by) {
      by = x.year
      best = 'in the hungry years after a famine'
    } else if ((t === EventType.Sacked || t === EventType.Conquered) && x.year >= by) {
      by = x.year
      best = t === EventType.Sacked ? 'after the city was sacked' : 'after the city fell to conquerors'
    }
  }
  woeOfFounding.set(e, best)
  return best
}

/** Chronicle line for a rulers or faith event (80-97), or null for other types (or without the tables). */
export function describeRulersEvent(h: History, e: HistoryEvent): string | null {
  return describeFor(h, e, -1)
}

/** Inspector line for a rulers or faith event from the point of view of settlement `id` (in the past tense, as the inspector's other lines), or null. */
export function describeRulersEventFor(h: History, e: HistoryEvent, id: number): string | null {
  const s = describeFor(h, e, id)
  return s ? past(s) : null
}

const PAST: [RegExp, string][] = [
  [/\bsucceeds\b/g, 'succeeded'], [/\balso takes\b/g, 'also took'], [/\btakes\b/g, 'took'], [/\bseizes\b/g, 'seized'], [/\binherits\b/g, 'inherited'],
  [/\braise\b/g, 'raised'], [/\belect\b/g, 'elected'], [/\bis elected\b/g, 'was elected'], [/\brises\b/g, 'rose'], [/\brules\b/g, 'ruled'], [/\bcomes\b/g, 'came'],
  [/\bdies\b/g, 'died'], [/\bfalls\b/g, 'fell'], [/\bis killed\b/g, 'was killed'], [/\bis overthrown\b/g, 'was overthrown'], [/\bis deposed\b/g, 'was deposed'],
  [/\bends\b/g, 'ended'], [/\bloses\b/g, 'lost'], [/\bhas lost\b/g, 'had lost'], [/\bgoes\b/g, 'went'], [/\bmakes\b/g, 'made'], [/\bbegins\b/g, 'began'],
  [/\bdeclares\b/g, 'declared'], [/\bsplits\b/g, 'split'], [/\breaches\b/g, 'reached'], [/\bjoins\b/g, 'joined'], [/\bbreaks apart\b/g, 'broke apart'],
  [/\bis merged\b/g, 'was merged'], [/\bis founded\b/g, 'was founded'], [/\bSchism: /g, ''],
]
/** The inspector's tense: "Narun II succeeded his father here". */
function past(s: string): string {
  let o = s
  for (const [re, w] of PAST) o = o.replace(re, w)
  return o.charAt(0).toUpperCase() + o.slice(1)
}

function describeFor(h: History, e: HistoryEvent, id: number): string | null {
  const t = e.type as number
  if (!isRulersOrFaithEvent(t)) return null
  const rd = rulersOf(h)
  const fd = faithsOf(h)
  if (isRulersEvent(t) && !rd) return null
  if (isFaithEvent(t) && !fd) return null
  const self = id >= 0 && e.settlement === id
  const S = sname(h, e.settlement)
  switch (t) {
    case EventType.RulerAcceded:
    case EventType.ReignEnded:
    case EventType.Regency:
      return successionLine(rd!, partsOf(rd!, [e]), self ? id : -1)
    case EventType.DynastyFounded: {
      const d = rd!.dynasties[e.value]
      const r = e.extra ?? -1
      const q = r >= 0 && r < rd!.R ? rd!.rulers[r].polity : -1
      return `House ${d?.name ?? ''} comes to the throne${self ? '' : ` of ${pname(rd!, q)}`} with ${r >= 0 && r < rd!.R ? rd!.title[r] : 'a new ruler'}`
    }
    case EventType.DynastyEnded: {
      const d = rd!.dynasties[e.value]
      const why = houseEndWords(rd!, e.value, e.extra ?? -1)
      return `House ${d?.name ?? ''} loses its last throne` + (self || e.extra === undefined ? '' : `, in ${pname(rd!, rd!.rulers[e.extra]?.polity ?? -1)}`) + (why ? ` (${why})` : '')
    }
    case EventType.UnionFormed: {
      const U = h.unions
      const r = e.extra ?? -1
      const sen = U && e.value >= 0 && e.value < U.count ? U.senior[e.value] : -1
      const jun = U && e.value >= 0 && e.value < U.count ? U.junior[e.value] : -1
      if (id >= 0 && !self) return `Its ruler ${r >= 0 && r < rd!.R ? rd!.title[r] : ''} also took the throne of ${pname(rd!, jun)}: a personal union`
      return `${r >= 0 && r < rd!.R ? rd!.title[r] : 'The ruler'} of ${pname(rd!, sen)} also takes the throne of ${pname(rd!, jun)} through a marriage claim: a personal union`
    }
    case EventType.UnionDissolved: {
      const U = h.unions
      const sen = U && e.value >= 0 && e.value < U.count ? U.senior[e.value] : -1
      const jun = U && e.value >= 0 && e.value < U.count ? U.junior[e.value] : -1
      const a = pname(rd!, sen), b = pname(rd!, jun)
      if (e.extra === UnionEnd.Merged) return `${b} is merged into ${a}, ending their personal union`
      if (e.extra === UnionEnd.Split) return `The personal union of ${a} and ${b} breaks apart`
      return `The personal union of ${a} and ${b} ends with the realm`
    }
    case EventType.RoyalMarriage: {
      const M = h.marriages
      const k = e.value
      if (!M || k < 0 || k >= M.count) return 'A royal marriage'
      const a = M.a[k], b = M.b[k]
      const da = rd!.dynasties[M.dynastyA[k]]?.name, db = rd!.dynasties[M.dynastyB[k]]?.name
      if (id >= 0) {
        const q = polityOfCapital(rd!, id, e.year)
        const o = q === a ? b : q === b ? a : marriagePartner(rd!, k, q)
        return `Its ruling house married into that of ${pname(rd!, o)}`
      }
      return `A royal marriage joins the houses of ${pname(rd!, a)} and ${pname(rd!, b)}` + (da && db ? ` (House ${da} and House ${db})` : '')
    }
    case EventType.SuccessionWar: {
      const W = h.wars
      const w = e.value
      const att = W && w >= 0 && w < W.count ? W.attacker[w] : polityOfCapital(rd!, e.settlement, e.year)
      const def = W && w >= 0 && w < W.count ? W.defender[w] : polityOfCapital(rd!, e.other, e.year)
      return `${pname(rd!, att)} goes to war for the throne of ${pname(rd!, def)}, pressing a claim by marriage: a war of succession`
    }
    // ---- faiths ----
    case EventType.FaithFounded: {
      const woe = foundingWoe(h, e)
      return self ? `${cap(fname(fd, e.value))} was founded here${woe ? ` ${woe}` : ''}: the town became its holy city` : `${cap(fname(fd, e.value))} is founded at ${S}${woe ? ` ${woe}` : ''}`
    }
    case EventType.RulerConverted: {
      const q = rd ? polityOfCapital(rd, e.settlement, e.year) : -1
      const r = rd && q >= 0 ? rulerAt(rd, q, e.year) : -1
      const who = rd && r >= 0 ? `${rd.title[r]} of ${pname(rd, q)}` : `The ruler at ${S}`
      return `${self ? (rd && r >= 0 ? rd.title[r] : 'Its ruler') : who} takes up ${fname(fd, e.value)}` + (typeof e.extra === 'number' && e.extra >= 0 ? `, leaving ${fname2(fd, e.extra)}` : '')
    }
    case EventType.StateReligion: {
      const q = rd ? polityOfCapital(rd, e.settlement, e.year) : -1
      const who = rd && q >= 0 ? pname(rd, q) : S
      return `${self ? 'The state' : who} makes ${fname(fd, e.value)} its state religion` + (typeof e.extra === 'number' && e.extra >= 0 ? ` in place of ${fname2(fd, e.extra)}` : '')
    }
    case EventType.Schism: {
      const f = fd!.faiths[e.value]
      const parent = f && f.parent >= 0 ? fd!.faiths[f.parent]?.name : ''
      const q = typeof e.extra === 'number' ? e.extra : -1
      const led = rd && q >= 0 ? `, led by ${(() => { const r = rulerAt(rd, q, e.year); return r >= 0 ? `${rd.title[r]} of ${pname(rd, q)}` : `the ruler of ${pname(rd, q)}` })()}` : ''
      return self ? `${cap(fname(fd, e.value))} split from ${parent || 'its parent faith'} here${led}` : `Schism: ${fname(fd, e.value)} splits from ${parent || 'its parent faith'}, with its seat at ${S}${led}`
    }
    case EventType.Persecution: {
      const q = rd ? polityOfCapital(rd, e.settlement, e.year) : -1
      const who = rd && q >= 0 ? pname(rd, q) : S
      const minor = typeof e.extra === 'number' && e.extra >= 0 ? fd!.faiths[e.extra] : undefined
      const them = minor ? (minor.kind === FaithKind.Universal ? `the followers of ${fname(fd, e.extra)}` : `those of ${fname2(fd, e.extra)}`) : 'its minorities'
      return `${self ? 'The state' : who} begins to persecute ${them}, in the name of ${fname(fd, e.value)}`
    }
    case EventType.HolyWar: {
      const W = h.wars
      const w = e.value
      const pd = rd?.pd
      const att = W && w >= 0 && w < W.count ? W.attacker[w] : -1
      const def = W && w >= 0 && w < W.count ? W.defender[w] : -1
      const an = pd && att >= 0 ? pd.names[att] : S, dn = pd && def >= 0 ? pd.names[def] : sname(h, e.other)
      if (id >= 0 && !self) return `${an} declared a holy war on it, in the name of ${fname(fd, e.extra)}`
      return `${an} declares a holy war on ${dn}, in the name of ${fname(fd, e.extra)}`
    }
    case EventType.HolyCityFell: {
      const q = rd ? polityOfCapital(rd, e.other, e.year) : -1
      const by = rd && q >= 0 ? `the army of ${pname(rd, q)}` : e.other >= 0 ? `an army from ${sname(h, e.other)}` : 'unbelievers'
      return self ? `The holy city of ${fname(fd, e.value)} fell to ${by}` : `${S}, holy city of ${fname(fd, e.value)}, falls to ${by}`
    }
    case EventType.FaithDied: {
      const f = fd!.faiths[e.value]
      if (f && f.kind !== FaithKind.Universal) return `The old ${f.name} ways die out` + (self ? ' here, among their last followers' : `; the last held to them at ${S}`)
      return `${cap(fname(fd, e.value))} dies out` + (self ? ': its last followers were here' : `; its last followers were at ${S}`)
    }
    case EventType.FaithReached: {
      const pn = peopleName(h, typeof e.extra === 'number' ? e.extra : peopleOf(h, e.settlement))
      if (self) return `${cap(fname(fd, e.value))} reached the ${pn ?? 'people'} here` + (e.other >= 0 ? `, from ${sname(h, e.other)}` : '')
      if (id >= 0) return `${cap(fname(fd, e.value))} went from here to the ${pn ?? 'people'} of ${S}`
      return `${cap(fname(fd, e.value))} reaches the ${pn ?? 'people'} at ${S}` + (e.other >= 0 ? `, from ${sname(h, e.other)}` : '')
    }
  }
  return null
}

/** Chronicle line for a group of rulers or faith events (members chronological, `members.length` >= 2). */
export function describeRulersGroup(h: History, members: readonly HistoryEvent[], key: number): string {
  const rd = rulersOf(h)
  const fd = faithsOf(h)
  const e = members[members.length - 1]
  const cls = groupClassOf(key)
  if (cls === GroupClass.War || cls === GroupClass.HolyWar) {
    const m = members.find((x) => (x.type as number) === EventType.HolyWar || (x.type as number) === EventType.SuccessionWar) ?? e
    return describeRulersEvent(h, m) ?? `${members.length} events`
  }
  if (cls === GroupClass.Faith) {
    const conv = members.find((x) => (x.type as number) === EventType.RulerConverted)
    const state = members.find((x) => (x.type as number) === EventType.StateReligion)
    const pers = members.find((x) => (x.type as number) === EventType.Persecution)
    let s = ''
    if (conv) s = describeRulersEvent(h, conv) ?? ''
    if (state) {
      if (s) s += conv && state.value === conv.value ? ', and makes it the state religion' : `; ${describeRulersEvent(h, state)}`
      else s = describeRulersEvent(h, state) ?? ''
    }
    if (pers) s = s ? `${s}; it begins to persecute ${(describeRulersEvent(h, pers) ?? '').replace(/^.* begins to persecute /, '')}` : describeRulersEvent(h, pers) ?? ''
    return s || `${members.length} events`
  }
  if (cls === GroupClass.Reached && fd) {
    const ps: string[] = []
    for (const m of members) {
      const n = peopleName(h, typeof m.extra === 'number' ? m.extra : peopleOf(h, m.settlement))
      if (n && !ps.includes(n)) ps.push(n)
    }
    const list = ps.length <= 1 ? ps[0] ?? 'new peoples' : `${ps.slice(0, -1).join(', ')} and ${ps[ps.length - 1]}`
    return `${cap(fname(fd, e.value))} reaches the ${list}${ps.length > 1 ? ' peoples' : ''}`
  }
  if (!rd) return `${members.length} events`
  if (cls === GroupClass.Succession) {
    const p = partsOf(rd, members)
    let s = successionLine(rd, p)
    const crisis = members.some((x) => (x.type as number) === EventType.SuccessionCrisis)
    if (crisis && !p.crisis) s += ' after a contested succession'
    const dis = members.find((x) => (x.type as number) === EventType.UnionDissolved)
    if (dis && p.acc < 0) s = describeRulersEvent(h, dis) ?? s
    return s
  }
  // routine successions: one state per quarter-century, or the chiefdoms together
  const acc = members.filter((x) => (x.type as number) === EventType.RulerAcceded).map((x) => x.value)
  if (acc.length === 0) return describeRulersEvent(h, e) ?? `${members.length} events`
  if (acc.length === 1) {
    const sameYear = members.filter((x) => x.year === rd.rulers[acc[0]].acceded)
    return successionLine(rd, partsOf(rd, sameYear))
  }
  if (cls === GroupClass.Chiefdoms) {
    const states = new Set(acc.map((r) => rd.rulers[r].polity))
    const last = acc[acc.length - 1]
    return `New rulers in ${states.size} ${states.size === 1 ? 'chiefdom' : 'chiefdoms'} (${acc.length} successions), the latest ${rd.title[last]} of ${pname(rd, rd.rulers[last].polity)}`
  }
  const q = rd.rulers[acc[0]].polity
  const houses = [...new Set(acc.map((r) => rd.rulers[r].dynasty))]
  const names = acc.map((r) => rd.title[r])
  const list = names.length <= 4 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : `${names.length} reigns, ${names[0]} to ${names[names.length - 1]}`
  const hn = houses.length === 1 && houses[0] >= 0 ? ` of House ${rd.dynasties[houses[0]].name}` : ''
  const fell = acc.filter((r) => { const o = rd.rulers[r].predecessor; return o >= 0 && (rd.rulers[o].end === ReignEnd.Battle || rd.rulers[o].end === ReignEnd.Plague || rd.rulers[o].end === ReignEnd.Sack) })
  let s = `${pname(rd, q)}: ${list}${hn} ${names.length <= 4 ? 'succeed in turn' : 'in turn'}`
  if (fell.length) {
    const o = rd.rulers[fell[0]].predecessor
    s += `; ${rd.title[o]} ${rd.rulers[o].end === ReignEnd.Battle ? 'fell in battle' : rd.rulers[o].end === ReignEnd.Plague ? 'died of plague' : 'was killed as the capital fell'}`
  }
  const reg = acc.find((r) => rd.regency[r] > 0)
  if (reg !== undefined) s += `; ${rd.title[reg]} came to the throne a child`
  return s
}

/** Whether a chronicle entry (its first m members from members[lo]) is a rulers or faith headline. */
export function isRulersEntryHeadline(h: History, members: Int32Array, lo: number, m: number): boolean {
  const rd = rulersOf(h)
  if (!rd) return false
  for (let q = lo; q < lo + m; q++) if (rd.headline.has(members[q])) return true
  return false
}
