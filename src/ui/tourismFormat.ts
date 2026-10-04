// Chronicle and inspector lines for the tourism events (types 100-105: a people's first leisure
// travel, a resort town founded, a place come into fashion and fallen out of it, a resort given up,
// a sight recognised), from ui/tourismData.ts. The chronicle gathers the comings into and goings
// out of fashion of all places per half-century, and the sights recognised in one decade, so that
// fashion does not flood it. Every function tolerates a history without tourism data (null: the
// caller falls back).

import { EventType, type History, type HistoryEvent } from '../contract.ts'
import { peopleName, settlementName } from './format.ts'
import { SIGHT_WORDS, sceneryWords, sightPhrase, tourismOf } from './tourismData.ts'

export const isTourismEvent = (t: number) => t >= EventType.LeisureTravel && t <= EventType.SightRecognised

/** Event types whose `other` is a settlement id. */
export function tourismOtherIsSettlement(t: number): boolean {
  return t === EventType.LeisureTravel || t === EventType.ResortFounded || t === EventType.ResortInFashion || t === EventType.SightRecognised
}

/** Chronicle dot class of a tourism event ('travel', 'resort', 'sight'), or null. */
export function tourismEventKind(e: HistoryEvent): string | null {
  const t = e.type as number
  if (t === EventType.LeisureTravel) return 'travel'
  if (t === EventType.SightRecognised) return 'sight'
  return isTourismEvent(t) ? 'resort' : null
}

/** Notable lines: a people's first leisure travel, a resort town founded. */
export function isTourismHeadline(e: HistoryEvent): boolean {
  const t = e.type as number
  return t === EventType.LeisureTravel || t === EventType.ResortFounded
}

const name = (h: History, id: number) => (id >= 0 && id < h.settlements.length ? settlementName(h, id) : 'a far place')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const round = (v: number) => (v < 100 ? Math.round(v) : Math.round(v / 10) * 10)

/** Why a place fell out of fashion, briefly (ResortDeclined `extra`). */
export function causeShort(c: number): string {
  switch (c) {
    case 0: return 'fashion moved on'
    case 1: return 'war on the way'
    case 2: return 'an epidemic'
    case 3: return 'its home towns declined'
  }
  return 'its visitors stayed away'
}
function causeLong(c: number): string {
  switch (c) {
    case 0: return 'fashion moved elsewhere'
    case 1: return 'war and danger on the way kept visitors off'
    case 2: return 'an epidemic kept visitors away'
    case 3: return 'the towns it drew on declined'
  }
  return 'its visitors stayed away'
}

/** What drew the first visitors to a resort: its sight kind, else the scenery of its cell ("the snowy heights"). */
function drawnBy(h: History, e: HistoryEvent): string {
  const k = typeof e.extra === 'number' ? e.extra : -1
  if (k >= 0 && k < SIGHT_WORDS.length) return `its ${SIGHT_WORDS[k]}`
  const td = tourismOf(h)
  const c = e.settlement >= 0 && e.settlement < h.settlements.length ? h.settlements[e.settlement].cell : -1
  const w = td?.sceneryKind && c >= 0 ? sceneryWords(td.sceneryKind[c]) : ''
  return w ? w.replace(/^(a|an) /, 'the ').replace(/ in a mild climate/, '') : 'the view'
}

function sightOf(h: History, e: HistoryEvent) {
  const s = (h as Partial<History>).sights
  return Array.isArray(s) ? s[e.value] : undefined
}

/** Chronicle line for a tourism event, or null for other types (or without tourism data). */
export function describeTourismEvent(h: History, e: HistoryEvent): string | null {
  const t = e.type as number
  if (!isTourismEvent(t)) return null
  if (!tourismOf(h)) return null
  const S = name(h, e.settlement)
  const O = name(h, e.other)
  switch (t) {
    case EventType.LeisureTravel: {
      const pn = peopleName(h, e.value)
      return `The ${pn ?? 'people of ' + S} begin to travel for pleasure: the first set out from ${S} for ${O}`
    }
    case EventType.ResortFounded:
      return `A resort town, ${S}, is founded for visitors from ${O}, drawn by ${drawnBy(h, e)}` + (e.value > 0 ? ` (${round(e.value)} a year)` : '')
    case EventType.ResortInFashion:
      return `${S} comes into fashion: ${round(e.value)} visitors a year` + (e.other >= 0 ? `, most from ${O}` : '')
    case EventType.ResortDeclined:
      return `${S} falls out of fashion: ${causeLong(e.extra ?? 0)}`
    case EventType.ResortAbandoned:
      return `The resort of ${S} is given up after ${Math.round(e.value)} years without visitors`
    case EventType.SightRecognised: {
      const x = sightOf(h, e)
      const own = e.other >= 0 && e.other !== e.settlement
      return `${cap(sightPhrase(x))} ${x && x.kind === 0 ? 'become' : 'becomes'} a sight worth the journey` + (own ? `; its visitors stay at ${S}` : '')
    }
  }
  return null
}

/** Inspector line for a tourism event from the point of view of settlement `id`, or null. */
export function describeTourismEventFor(h: History, e: HistoryEvent, id: number): string | null {
  const t = e.type as number
  if (!isTourismEvent(t)) return null
  if (!tourismOf(h)) return null
  const self = e.settlement === id
  const S = name(h, e.settlement)
  const O = name(h, e.other)
  switch (t) {
    case EventType.LeisureTravel: {
      const pn = peopleName(h, e.value) ?? 'its people'
      return self ? `The first of the ${pn} to travel for pleasure set out from here, for ${O}` : `The first ${pn} to travel for pleasure came here, from ${S}`
    }
    case EventType.ResortFounded:
      return self ? `Founded as a resort for visitors from ${O}, drawn by ${drawnBy(h, e)}` : `Its people's visits led to the resort town of ${S}`
    case EventType.ResortInFashion:
      return self ? `Came into fashion: ${round(e.value)} visitors a year` + (e.other >= 0 ? `, most from ${O}` : '') : `Its people made ${S} fashionable`
    case EventType.ResortDeclined:
      return `Fell out of fashion: ${causeLong(e.extra ?? 0)}`
    case EventType.ResortAbandoned:
      return `Given up as a resort after ${Math.round(e.value)} years without visitors`
    case EventType.SightRecognised: {
      const x = sightOf(h, e)
      if (self && (e.other < 0 || e.other === id)) return `${cap(sightPhrase(x))} became a sight worth the journey`
      if (self) return `${cap(sightPhrase(x))} nearby became a sight; its visitors stay here`
      return `${cap(sightPhrase(x))} became a sight; its visitors stay at ${S}`
    }
  }
  return null
}

/** Years per bucket of the chronicle's fashion lines (all places together; labelled like the island landfalls, "2950s"). */
export const FASHION_BUCKET_YEARS = 50

/**
 * Grouping key of a tourism event for the chronicle, or -1 for a line of its own: the comings into
 * and goings out of fashion of all places per FASHION_BUCKET_YEARS, the sights recognised per decade.
 */
export function tourismGroupKey(e: HistoryEvent): number {
  const t = e.type as number
  if (t === EventType.ResortInFashion || t === EventType.ResortDeclined) return 1e9 + Math.floor(e.year / FASHION_BUCKET_YEARS)
  if (t === EventType.SightRecognised) return 2e9 + Math.floor(e.year / 10)
  return -1
}

/** Whether a group is one of sights (dated by decade) rather than of fashion (dated by half-century). */
export const isSightGroup = (e: HistoryEvent) => (e.type as number) === EventType.SightRecognised

/** "A", "A and B", "A, B and C", "A, B and 3 more". */
function listOf(xs: readonly string[], max = 3): string {
  if (xs.length <= 1) return xs[0] ?? ''
  if (xs.length <= max) return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
  return `${xs.slice(0, max - 1).join(', ')} and ${xs.length - max + 1} more`
}

/** Chronicle line for a group of tourism events of one key (tourismGroupKey). */
export function describeTourismGroup(h: History, members: readonly HistoryEvent[]): string {
  const e = members[members.length - 1]
  if (members.length === 1) return describeTourismEvent(h, e) ?? ''
  if (isSightGroup(e)) return `New sights worth the journey: ${listOf(members.map((m) => sightPhrase(sightOf(h, m))))}`
  // fashion: per place, in order: in, out, back, a brief vogue
  const order: number[] = []
  const seq = new Map<number, HistoryEvent[]>()
  for (const m of members) {
    const a = seq.get(m.settlement)
    if (a) a.push(m)
    else {
      seq.set(m.settlement, [m])
      order.push(m.settlement)
    }
  }
  const ins: string[] = [], outs: string[] = []
  for (const id of order) {
    const a = seq.get(id)!
    const last = a[a.length - 1]
    const lastOut = [...a].reverse().find((m) => (m.type as number) === EventType.ResortDeclined)
    const nm = name(h, id)
    if ((last.type as number) === EventType.ResortInFashion) ins.push(lastOut ? `${nm} (back after ${causeShort(lastOut.extra ?? 0)})` : nm)
    else outs.push(a.length > 1 ? `${nm} (after a brief vogue: ${causeShort(last.extra ?? 0)})` : `${nm} (${causeShort(last.extra ?? 0)})`)
  }
  const inPart = ins.length ? `${listOf(ins)} ${ins.length === 1 ? 'comes' : 'come'} into fashion` : ''
  const outPart = outs.length ? `${listOf(outs, 2)} ${outs.length === 1 ? 'falls' : 'fall'} out of ${ins.length ? 'it' : 'fashion'}` : ''
  return `Fashions change: ${[inPart, outPart].filter((x) => x).join('; ')}`
}
