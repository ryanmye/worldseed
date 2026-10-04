// Chronicle and inspector lines for the disease events (types 66-72: a new sickness, a great
// epidemic beginning and passing, a city struck, a port in quarantine, a sickness become endemic,
// an army broken by sickness) and the first-contact Epidemic (19) once it carries an epidemic id,
// from ui/diseaseData.ts. Every function tolerates a history without disease data (null: the
// caller falls back).

import { CITY_POPULATION, EventType, type History, type HistoryEvent } from '../contract.ts'
import { diseaseOf, epidemicNoun, shareWords, type DiseaseData } from './diseaseData.ts'
import { fractionWords, peopleName, peopleOf, settlementName } from './format.ts'
import { politiesOf } from './politiesData.ts'

export const isDiseaseEvent = (t: number) => t >= EventType.DiseaseAppeared && t <= EventType.ArmyStricken

/** Event types whose `other` is a settlement id. */
export function diseaseOtherIsSettlement(t: number): boolean {
  return t === EventType.GreatEpidemic || t === EventType.CityStricken || t === EventType.Quarantine || t === EventType.ArmyStricken
}

/** Chronicle dot class of a disease event ('sickness', 'quarantine'), or null. */
export function diseaseEventKind(e: HistoryEvent): string | null {
  const t = e.type as number
  if (t === EventType.Quarantine) return 'quarantine'
  return isDiseaseEvent(t) ? 'sickness' : null
}

/** A city of this many people or more struck makes a headline of its own. */
const BIG_CITY = 2 * CITY_POPULATION

function popAt(h: History, id: number, year: number): number {
  if (id < 0 || id >= h.settlements.length) return 0
  const s = Math.max(0, Math.min(h.snapshotCount - 1, Math.round(year / h.snapshotInterval)))
  return h.population[s * h.settlements.length + id] ?? 0
}

/** Headlines: great epidemics beginning and ending, big cities struck (and an epidemic's group of city strikes). */
export function isDiseaseHeadline(h: History, e: HistoryEvent): boolean {
  const t = e.type as number
  if (t === EventType.GreatEpidemic || t === EventType.EpidemicEnded) return true
  if (t === EventType.CityStricken) return popAt(h, e.settlement, e.year) >= BIG_CITY
  return false
}

const name = (h: History, id: number) => (id >= 0 && id < h.settlements.length ? settlementName(h, id) : 'a far place')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const dname = (dd: DiseaseData, d: number) => dd.diseases[d]?.name || 'a sickness'
const pct = (f: number) => `${Math.round(f * 100)}%`

/** "the war of Vashtar on Kepia", or "a war". */
function warWords(h: History, w: number): string {
  const pd = politiesOf(h)
  const W = h.wars
  if (!pd || !W || !(w >= 0 && w < W.count)) return 'a war'
  const a = pd.names[W.attacker[w]], b = pd.names[W.defender[w]]
  return a && b ? `the war of ${a} on ${b}` : 'a war'
}

/** The first-contact Epidemic (19) with its new fields, or null. */
function describeContact(h: History, e: HistoryEvent, forId: number): string | null {
  const dd = diseaseOf(h)
  const x = dd && typeof e.extra === 'number' ? dd.epidemics[e.extra] : undefined
  if (!dd || !x) return null
  const pn = peopleName(h, peopleOf(h, e.settlement)) ?? 'people'
  const q = e.other >= 0 && e.other < h.settlements.length ? peopleOf(h, e.other) : -1
  const qn = q >= 0 ? peopleName(h, q) : null
  const n = dname(dd, x.disease)
  if (forId < 0) return `${cap(n)}, new to the ${pn}, follows contact` + (qn ? ` with the ${qn}` : '') + `: ${fractionWords(e.value)}`
  if (e.settlement === forId) return `${cap(n)}, new to the ${pn}, struck after contact` + (qn ? ` with the ${qn}` : '') + `: ${fractionWords(e.value).replace(/ dies?$/, ' died')}`
  return `${cap(n)} spread from here to the ${pn}`
}

/** Chronicle line for a disease event (or a first-contact epidemic), or null for other types (or without disease data). */
export function describeDiseaseEvent(h: History, e: HistoryEvent): string | null {
  const t = e.type as number
  if (t === EventType.Epidemic) return describeContact(h, e, -1)
  if (!isDiseaseEvent(t)) return null
  const dd = diseaseOf(h)
  if (!dd) return null
  const S = name(h, e.settlement)
  const O = name(h, e.other)
  switch (t) {
    case EventType.DiseaseAppeared: {
      const g = dd.gloss[e.value]
      return `A new sickness, ${dname(dd, e.value)}${g ? ` (${g})` : ''}, first strikes ${S}`
    }
    case EventType.GreatEpidemic:
      return `${cap(epidemicNoun(dd, e.value))} spreads from ${S}` + (e.other >= 0 ? `, brought from ${O}` : '')
    case EventType.EpidemicEnded:
      return `${cap(epidemicNoun(dd, e.value))} has passed: it took ${shareWords(e.extra ?? 0)} of the peoples it reached`
    case EventType.CityStricken:
      return `${cap(epidemicNoun(dd, e.value))} reaches the city of ${S}` + (e.other >= 0 ? ` from ${O}` : '') + (e.extra ? ` (${pct(e.extra)} will die)` : '')
    case EventType.Quarantine:
      return `${S} holds ships from sick ports in quarantine`
    case EventType.Endemic: {
      const pn = peopleName(h, peopleOf(h, e.settlement))
      return `${cap(dname(dd, e.value))} becomes a childhood sickness among the ${pn ?? `people of ${S}`}`
    }
    case EventType.ArmyStricken:
      return `Sickness breaks the army that marched from ${O} on ${S}`
  }
  return null
}

/** Inspector line for a disease event from the point of view of settlement `id`, or null. */
export function describeDiseaseEventFor(h: History, e: HistoryEvent, id: number): string | null {
  const t = e.type as number
  if (t === EventType.Epidemic) return describeContact(h, e, id)
  if (!isDiseaseEvent(t)) return null
  const dd = diseaseOf(h)
  if (!dd) return null
  const self = e.settlement === id
  const S = name(h, e.settlement)
  const O = name(h, e.other)
  switch (t) {
    case EventType.DiseaseAppeared:
      return `A new sickness, ${dname(dd, e.value)}, first struck here`
    case EventType.GreatEpidemic:
      return self ? `${cap(epidemicNoun(dd, e.value))} began here` : `${cap(epidemicNoun(dd, e.value))} came from here to ${S}`
    case EventType.EpidemicEnded:
      return `${cap(epidemicNoun(dd, e.value))}, begun here, passed: it took ${shareWords(e.extra ?? 0)} of the peoples it reached`
    case EventType.CityStricken:
      return self ? `${cap(epidemicNoun(dd, e.value))} reached the city` + (e.other >= 0 ? ` from ${O}` : '') + (e.extra ? `: ${pct(e.extra)} to die` : '') : `${cap(epidemicNoun(dd, e.value))} went from here to the city of ${S}`
    case EventType.Quarantine:
      return self ? 'Began to hold ships from sick ports in quarantine' : `Its port of ${S} began to hold ships in quarantine`
    case EventType.Endemic:
      return `${cap(dname(dd, e.value))} became a childhood sickness of its people`
    case EventType.ArmyStricken:
      return self ? `Sickness broke the army of ${O} marching on it` : `Its army marching on ${S} was broken by sickness`
  }
  return null
}

/**
 * Grouping key of a disease event for the chronicle, or -1 for a line of its own: cities struck
 * per epidemic, armies struck per war, ports in quarantine per decade, sicknesses become endemic
 * per disease and decade.
 */
export function diseaseGroupKey(e: HistoryEvent): number {
  const t = e.type as number
  const decade = Math.floor(e.year / 10)
  if (t === EventType.CityStricken) return (t * 100000 + Math.max(0, e.value) + 1) * 1000
  if (t === EventType.ArmyStricken) return (t * 100000 + Math.max(0, e.value) + 1) * 1000
  if (t === EventType.Quarantine) return (t * 100000) * 1000 + decade
  if (t === EventType.Endemic) return (t * 100000 + Math.max(0, e.value) + 1) * 1000 + decade
  return -1
}

/** Chronicle line for a group of disease events of one kind (diseaseGroupKey). */
export function describeDiseaseGroup(h: History, members: readonly HistoryEvent[]): string {
  const e = members[members.length - 1]
  const n = members.length
  const t = e.type as number
  const dd = diseaseOf(h)
  if (!dd) return `${n} events`
  if (t === EventType.CityStricken) {
    // the worst: the largest toll times the city's people
    let worst = members[0]
    let wv = -1
    for (const m of members) {
      const v = (m.extra ?? 0) * popAt(h, m.settlement, m.year)
      if (v > wv) {
        wv = v
        worst = m
      }
    }
    return `${cap(epidemicNoun(dd, e.value))} strikes ${n} cities, worst at ${name(h, worst.settlement)}`
  }
  if (t === EventType.ArmyStricken) return `Sickness breaks ${n} armies in ${warWords(h, e.value)}, the last marching from ${name(h, e.other)} on ${name(h, e.settlement)}`
  if (t === EventType.Quarantine) return `${n} ports begin to hold ships from sick harbours in quarantine, among them ${name(h, e.settlement)}`
  if (t === EventType.Endemic) {
    const ps = [...new Set(members.map((m) => peopleName(h, peopleOf(h, m.settlement))).filter((x): x is string => !!x))]
    const list = ps.length <= 1 ? ps[0] ?? 'several peoples' : `${ps.slice(0, -1).join(', ')} and ${ps[ps.length - 1]}`
    return `${cap(dname(dd, e.value))} becomes a childhood sickness among the ${list}`
  }
  return `${n} events, among them: ${describeDiseaseEvent(h, e) ?? ''}`
}

/** Whether a group (by its kind of member) is a headline: an epidemic's cities struck. */
export function isDiseaseGroupHeadline(e: HistoryEvent): boolean {
  return (e.type as number) === EventType.CityStricken
}
