// landmarks: chronicle and inspector lines for the landmark events (140-146) and the inspector's list of a town's landmarks
// with their state and builder ("Thesmu IV of Vashtar begins the Keep of Thesmu at Rilko"; "The Great Temple of Unlafa at
// Rilko falls into ruin"; "Keep of Thesmu (castle), built 1405-1432 by Thesmu IV of Vashtar, neglected since 1820"). Names
// and states come from History.landmarks; every function tolerates a history without them (null or '': the caller falls back).

import { CITY_POPULATION, EventType, LandmarkForm, LandmarkKind, LandmarkRank, LandmarkState, landmarkNameAt, landmarksAt, landmarkTownAt, settlementNameAt, type History, type HistoryEvent } from '../contract.ts'
import { settlementName } from './format.ts'
import { faithName, faithsOf } from './faithsData.ts'
import { capitalAt, polityAtYear, politiesOf } from './politiesData.ts'
import { rulersOf } from './rulersData.ts'
import './landmarks.css'

export const isLandmarkEvent = (t: number) => t >= EventType.LandmarkBegun && t <= EventType.LandmarkConverted

/** The landmark row of a landmark event (at its `settlement`: its town, or the heir town that restored it), or -1. */
function rowOf(h: History, e: HistoryEvent): number {
  const L = (h as Partial<History>).landmarks
  if (!isLandmarkEvent(e.type as number) || !L || !(e.value >= 0 && e.value < L.count)) return -1
  return L.settlement[e.value] === e.settlement || landmarkTownAt(h, e.value, e.year) === e.settlement ? e.value : -1
}

const TEMPLE_NOUN = ['church', 'domed temple', 'temple mound', 'temple', 'pagoda', 'stave church', 'stupa', 'shrine']
const GREAT_TEMPLE_NOUN = ['cathedral', 'great domed temple', 'ziggurat', 'great temple', 'great pagoda', 'great stave church', 'great stupa', 'great stone circle']

/** What a landmark is, in a word or two ("castle", "cathedral", "temple mound"). */
export function landmarkNoun(kind: number, form: number): string {
  const f = Math.max(0, Math.min(7, form))
  switch (kind) {
    case LandmarkKind.Castle: return 'castle'
    case LandmarkKind.Palace: return 'palace'
    case LandmarkKind.GreatTemple: return GREAT_TEMPLE_NOUN[f]
    case LandmarkKind.Monastery: return 'monastery'
    case LandmarkKind.MarketHall: return 'great market hall'
    case LandmarkKind.Guildhall: return 'guildhall'
    case LandmarkKind.Lighthouse: return 'lighthouse'
    case LandmarkKind.Library: return 'library'
    case LandmarkKind.Monument: return 'victory monument'
    case LandmarkKind.Mausoleum: return 'mausoleum'
    case LandmarkKind.Baths: return 'great baths'
    case LandmarkKind.CouncilHouse: return 'council house'
    case LandmarkKind.Temple: return TEMPLE_NOUN[f]
    case LandmarkKind.Shrine: return form === LandmarkForm.Circle ? 'stone circle' : 'shrine'
    default: return 'landmark'
  }
}

const ruler = (h: History, r: number): string | null => {
  if (r < 0) return null
  const rd = rulersOf(h)
  return rd && r < rd.title.length ? rd.title[r] : (h as Partial<History>).rulers?.[r]?.name ?? null
}
const polity = (h: History, p: number): string | null => {
  if (p < 0) return null
  const pd = politiesOf(h)
  return pd && p < pd.count ? pd.names[p] : (h as Partial<History>).polities?.[p]?.name ?? null
}
const faith = (h: History, f: number): string | null => {
  const fd = faithsOf(h)
  return fd && f >= 0 && f < fd.F ? faithName(fd, f) : null
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** "the Keep of Thesmu at Rilko" at `year` (its name then, landmarkNameAt; the town it belongs to then added unless the name holds it). */
function called(h: History, i: number, year: number, withTown = true): string {
  const n = landmarkNameAt(h, i, year)
  const town = settlementNameAt(h, landmarkTownAt(h, i, year), year)
  return withTown && town && !n.includes(town) ? `${n} at ${town}` : n
}

/** The change row of landmark i in year y to `state` (the last of its year), or -1. */
function changeRow(h: History, i: number, y: number, state: number): number {
  const L = h.landmarks
  let k = -1
  for (let c = 0; c < L.changeCount && L.changeYear[c] <= y; c++) if (L.changeLandmark[c] === i && L.changeYear[c] === y && L.changeState[c] === state) k = c
  return k
}

/** Chronicle line for a landmark event, or null. */
export function describeLandmarkEvent(h: History, e: HistoryEvent): string | null {
  const i = rowOf(h, e)
  if (i < 0) return null
  const L = h.landmarks
  const town = settlementName(h, e.settlement)
  const name = called(h, i, e.year)
  const who = ruler(h, L.ruler[i]), realm = polity(h, L.polity[i])
  switch (e.type as number) {
    case EventType.LandmarkBegun:
      return who ? `${who}${realm ? ` of ${realm}` : ''} begins ${name}` : realm ? `${realm} begins ${name}` : `Work begins on ${name}`
    case EventType.LandmarkCompleted: {
      const n = e.year - L.begunYear[i]
      return `${cap(name)} is finished` + (n >= 2 ? `, ${n} years after ${who ?? 'its builders'} began it` : '')
    }
    case EventType.LandmarkAbandoned:
      return `Work on ${name} is given up unfinished`
    case EventType.LandmarkNeglected:
      return `${cap(name)} falls into neglect`
    case EventType.LandmarkRuined:
      return e.other >= 0 ? `${cap(name)} is wrecked when ${settlementName(h, e.other)}'s army sacks ${town}` : h.settlements[e.settlement]?.abandonedYear === e.year ? `${cap(name)} is left to ruin as ${town} is abandoned` : `${cap(name)} falls into ruin`
    case EventType.LandmarkRestored: {
      const k = changeRow(h, i, e.year, LandmarkState.Restored)
      const by = k >= 0 ? polity(h, L.changePolity[k]) : null
      return `${cap(name)} is restored` + (by ? ` by ${by}` : '')
    }
    case EventType.LandmarkConverted: {
      const k = changeRow(h, i, e.year, LandmarkState.Converted)
      const f = k >= 0 ? faith(h, L.changeFaith[k]) : null
      return `${cap(name)} is rededicated` + (f ? ` to ${f}` : '')
    }
  }
  return null
}

/** Inspector line for a landmark event of settlement `id` (its own, or the capital of the realm behind it), or null. */
export function describeLandmarkEventFor(h: History, e: HistoryEvent, id: number): string | null {
  const i = rowOf(h, e)
  if (i < 0) return null
  if (id !== e.settlement) {
    return (e.type as number) === EventType.LandmarkBegun ? `Its realm began ${called(h, i, e.year)}` : (e.type as number) === EventType.LandmarkCompleted ? `Its realm finished ${called(h, i, e.year)}` : describeLandmarkEvent(h, e)
  }
  const L = h.landmarks
  const name = landmarkNameAt(h, i, e.year)
  const who = ruler(h, L.ruler[i])
  switch (e.type as number) {
    case EventType.LandmarkBegun: return `Work began on ${name}` + (who ? ` under ${who}` : '')
    case EventType.LandmarkCompleted: return `${cap(name)} was finished`
    case EventType.LandmarkAbandoned: return `Work on ${name} was given up`
    case EventType.LandmarkNeglected: return `${cap(name)} fell into neglect`
    case EventType.LandmarkRuined: return e.other >= 0 ? `${cap(name)} was wrecked in the sack` : `${cap(name)} fell into ruin`
    case EventType.LandmarkRestored: return `${cap(name)} was restored`
    case EventType.LandmarkConverted: {
      const k = changeRow(h, i, e.year, LandmarkState.Converted)
      const f = k >= 0 ? faith(h, L.changeFaith[k]) : null
      return `${cap(name)} was rededicated` + (f ? ` to ${f}` : '')
    }
  }
  return null
}

/** Headline landmark events: a great work finished in a city or a capital, and any castle, palace or great temple finished. */
export function isLandmarkHeadline(h: History, e: HistoryEvent): boolean {
  const i = rowOf(h, e)
  if (i < 0 || (e.type as number) !== EventType.LandmarkCompleted) return false
  const k = h.landmarks.kind[i]
  if (k === LandmarkKind.Castle || k === LandmarkKind.Palace || k === LandmarkKind.GreatTemple) return true
  const s = Math.min(h.snapshotCount - 1, Math.max(0, Math.floor(e.year / h.snapshotInterval)))
  if ((h.population[s * h.settlements.length + e.settlement] ?? 0) >= CITY_POPULATION) return true
  const pd = politiesOf(h)
  if (!pd) return false
  const p = polityAtYear(pd, e.settlement, e.year)
  return p >= 0 && capitalAt(pd, p, e.year) === e.settlement
}

/** Chronicle filter category of a landmark event: a rededication is the faiths', the rest the settlements'. */
export const landmarkEventIsFaith = (t: number) => t === EventType.LandmarkConverted

const STATE_WORDS = ['being built', 'in use', 'neglected', 'in ruins', 'restored', 'rededicated', 'left unfinished']

/**
 * The inspector's landmarks of settlement `id` at `year`, one line each: great ones first, then the town's temples and
 * shrines ([text, css class] pairs; [] when none).
 */
export function landmarkLines(h: History, id: number, year: number): [string, string][] {
  const L = (h as Partial<History>).landmarks
  if (!L || !(L.count > 0)) return []
  const out: [string, string][] = []
  const lesser: [string, string][] = []
  // (the town's at the year: a landmark an heir town restored on its ruins is listed under it)
  for (const x of landmarksAt(h, id, year)) {
    const i = x.id
    const st = x.state
    const since = x.since
    const done = L.completedYear[i] >= 0 && L.completedYear[i] <= year ? L.completedYear[i] : -1
    const noun = landmarkNoun(L.kind[i], L.form[i])
    const who = ruler(h, L.ruler[i]), realm = polity(h, L.polity[i])
    let s = `${landmarkNameAt(h, i, year)} (${noun})`
    if (st === LandmarkState.Building) s += `, being built since ${L.begunYear[i]}`
    else if (done >= 0) s += `, built ${L.begunYear[i]}–${done}`
    else s += `, begun ${L.begunYear[i]}`
    if (L.rank[i] === LandmarkRank.Great && (who || realm)) s += ` by ${who ? `${who}${realm ? ` of ${realm}` : ''}` : realm}`
    if (st === LandmarkState.Converted) { const f = faith(h, x.faith); s += `; rededicated${f ? ` to ${f}` : ''} in ${since}` }
    else if (st !== LandmarkState.InUse && st !== LandmarkState.Building) s += `; ${STATE_WORDS[st]} since ${since}`
    const cls = st === LandmarkState.Ruined || st === LandmarkState.Unfinished ? 'lost' : st === LandmarkState.Neglected ? 'worn' : ''
    ;(L.rank[i] === LandmarkRank.Great ? out : lesser).push([s, cls])
  }
  return out.concat(lesser)
}

/** State of landmark i at `year` (its change rows; Building before the first). */
function landmarkStateAt(h: History, i: number, year: number): number {
  const L = h.landmarks
  let st: number = LandmarkState.Building
  for (let k = 0; k < L.changeCount && L.changeYear[k] <= year; k++) if (L.changeLandmark[k] === i) st = L.changeState[k]
  return st
}

const CENTURIES = ['a century', 'two centuries', 'three centuries', 'four centuries', 'five centuries', 'six centuries', 'seven centuries', 'eight centuries', 'nine centuries', 'ten centuries']

/**
 * A landmark sight (SightKind.Landmark) as a phrase at `year`: "the ruined Keep of Kube", "the unfinished Sulunovel Palace",
 * "the Keep of Thimin" (its name then, landmarkNameAt); '' without landmarks.
 */
export function landmarkSightPhrase(h: History, i: number | undefined, year: number): string {
  const L = (h as Partial<History>).landmarks
  if (!L || i === undefined || !(i >= 0 && i < L.count)) return ''
  const n = landmarkNameAt(h, i, year)
  const st = landmarkStateAt(h, i, year)
  const adj = st === LandmarkState.Ruined ? 'ruined' : st === LandmarkState.Unfinished ? 'unfinished' : ''
  if (!adj) return n
  return n.startsWith('the ') ? `the ${adj} ${n.slice(4)}` : `${n}, ${st === LandmarkState.Ruined ? 'in ruins' : 'left unfinished'}`
}

/**
 * Chronicle line for a landmark become a sight in `year` (SightRecognised with `extra` 7): "The ruined Keep of Kube draws
 * visitors"; "The Cathedral of Rilko, three centuries old, is counted among the sights". Null without landmarks.
 */
export function describeLandmarkSight(h: History, i: number | undefined, year: number): string | null {
  const p = landmarkSightPhrase(h, i, year)
  if (!p || i === undefined) return null
  const L = h.landmarks
  const st = landmarkStateAt(h, i, year)
  if (st === LandmarkState.Ruined || st === LandmarkState.Unfinished) return `${cap(p)} draws visitors`
  const done = L.completedYear[i]
  const age = year - (done >= 0 && done <= year ? done : L.begunYear[i])
  const c = Math.min(CENTURIES.length, Math.floor(age / 100))
  return c >= 1 ? `${cap(p)}, ${CENTURIES[c - 1]} old, is counted among the sights` : `${cap(p)} is counted among the sights`
}
