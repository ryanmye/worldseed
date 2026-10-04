// renaming: chronicle and inspector lines for EventType.PlaceRenamed (110), by cause and form, with the ruler, house, faith
// and people the name honours or comes from ("Rolto, sacked and refounded by Thoselunoye, is renamed Thesmuvul for Thesmu IV";
// "Tiboi takes back its old name after 116 years as Ilchanak"), and the inspector's "formerly ..." line. The town's old and new
// names come from the table (History.renamings.previous and .name), never from the year shown. Every function tolerates a
// history without renamings (null or '': the caller falls back).

import { CITY_POPULATION, EventType, RenameCause, RenameForm, type History, type HistoryEvent } from '../contract.ts'
import { peopleName } from './format.ts'
import { capitalAt, polityAtYear, politiesOf } from './politiesData.ts'
import { rulersOf } from './rulersData.ts'
import { formerNames, renamingRowAt, renamingsOf } from './renamingData.ts'
import './renaming.css'

export const isRenamingEvent = (t: number) => t === EventType.PlaceRenamed

/** The table row of a PlaceRenamed event, or -1 when the history has no such row. */
function rowOf(h: History, e: HistoryEvent): number {
  const R = (h as Partial<History>).renamings
  return (e.type as number) === EventType.PlaceRenamed && R && e.value >= 0 && e.value < R.count && R.settlement[e.value] === e.settlement ? e.value : -1
}

/** The name a renaming replaced (the founding name for the first). */
function oldName(h: History, i: number): string {
  const R = h.renamings
  const p = R.previous[i]
  return p >= 0 && p < R.count ? R.name[p] : h.settlements[R.settlement[i]]?.name || `Settlement #${R.settlement[i]}`
}

/** The year the replaced name came in (the founding year for the founding name). */
function oldSince(h: History, i: number): number {
  const R = h.renamings
  const p = R.previous[i]
  return p >= 0 && p < R.count ? R.year[p] : h.settlements[R.settlement[i]]?.foundedYear ?? R.year[i]
}

function polName(h: History, p: number): string | null {
  if (p < 0) return null
  const pd = politiesOf(h)
  if (pd && p < pd.count) return pd.names[p]
  return (h as Partial<History>).polities?.[p]?.name ?? null
}

function rulerTitle(h: History, r: number): string | null {
  if (r < 0) return null
  const rd = rulersOf(h)
  if (rd && r < rd.title.length) return rd.title[r]
  return (h as Partial<History>).rulers?.[r]?.name ?? null
}

const houseName = (h: History, d: number): string | null => (d >= 0 ? (h as Partial<History>).dynasties?.[d]?.name ?? null : null)
const faithName = (h: History, f: number): string | null => (f >= 0 ? (h as Partial<History>).faiths?.[f]?.name ?? null : null)

/** What a new name honours: " for Thesmu IV", " for the house of Mera", " for Ashet" ('' for a plain name). */
function honours(h: History, i: number): string {
  const R = h.renamings
  const f = R.form[i]
  if (f === RenameForm.Ruler) { const r = rulerTitle(h, R.ruler[i]); return r ? ` for ${r}` : '' }
  if (f === RenameForm.House) { const d = houseName(h, R.dynasty[i]); return d ? ` for the house of ${d}` : '' }
  if (f === RenameForm.Faith) { const x = faithName(h, R.faith[i]); return x ? ` for ${x}` : '' }
  return ''
}

/** The house the replaced name honoured (a HouseFell renaming), or null. */
function fallenHouse(h: History, i: number): string | null {
  const R = h.renamings
  const p = R.previous[i]
  if (p >= 0 && p < R.count && R.form[p] === RenameForm.House) return houseName(h, R.dynasty[p])
  return houseName(h, R.dynasty[i])
}

/** "; the Leko still call it Tiboi" ('' when no people kept the old name). */
function keptWords(h: History, i: number, past: boolean): string {
  const R = h.renamings
  const k = R.keptBy[i]
  const n = k >= 0 ? peopleName(h, k) : null
  return n ? `; the ${n} ${past ? 'kept calling' : 'still call'} it ${oldName(h, i)}` : ''
}

/** Chronicle line for a PlaceRenamed event, or null for other events (or without the table). */
export function describeRenamingEvent(h: History, e: HistoryEvent): string | null {
  const i = rowOf(h, e)
  if (i < 0) return null
  const R = h.renamings
  const was = oldName(h, i), now = R.name[i]
  const pol = polName(h, R.polity[i])
  const people = R.people[i] >= 0 ? peopleName(h, R.people[i]) : null
  const form = R.form[i]
  let s: string
  switch (R.cause[i]) {
    case RenameCause.Conquest:
      s = form === RenameForm.Adapted && people
        ? `${was}${pol ? `, held by ${pol},` : ''} takes the ${people} form of its name, ${now}`
        : `${was}${pol ? `, held by ${pol},` : ''} is renamed ${now}${honours(h, i)}`
      break
    case RenameCause.Cession:
      s = form === RenameForm.Adapted && people
        ? `${was}${pol ? `, ceded to ${pol},` : ', ceded,'} becomes ${now} in the ${people} tongue`
        : `${was}${pol ? `, ceded to ${pol},` : ', ceded,'} is renamed ${now}${honours(h, i)}`
      break
    case RenameCause.Capital:
      s = form === RenameForm.Ruler || form === RenameForm.House
        ? `${was}${pol ? `, the new seat of ${pol},` : ''} is renamed ${now}${honours(h, i)}`
        : `${was}${pol ? `, the new seat of ${pol},` : ''} is given the royal name ${now}`
      break
    case RenameCause.Refounded:
      s = `${was}, sacked and refounded${pol ? ` by ${pol}` : ''}, is renamed ${now}${honours(h, i)}`
      break
    case RenameCause.Faith: {
      const f = faithName(h, R.faith[i])
      s = form === RenameForm.Faith && f
        ? `${was} is rededicated to ${f} as ${now}`
        : f ? `${was}, a holy city of ${f}${pol ? ` taken by ${pol}` : ''}, is renamed ${now}` : `${was} is renamed ${now}${honours(h, i)}`
      break
    }
    case RenameCause.Trade:
      s = `${was} comes to be known as ${now}, the name ${people ? `the ${people} traders` : 'its foreign traders'} gave it`
      break
    case RenameCause.Restored:
      s = `${now} takes back its old name after ${Math.max(1, R.year[i] - oldSince(h, i))} years as ${was}`
      break
    case RenameCause.Revived: {
      const src = R.source[i] >= 0 ? h.settlements[R.source[i]] : undefined
      s = `${was}, grown on the ruins of ${now}${src && src.abandonedYear >= 0 ? ` (abandoned ${src.abandonedYear})` : ''}, takes up the old town's name`
      break
    }
    case RenameCause.HouseFell: {
      const d = fallenHouse(h, i)
      const lead = d ? `With the house of ${d} fallen, ` : 'With the house it was named for fallen, '
      s = form === RenameForm.Restored || R.restored[i] >= -1 ? `${lead}${was} is ${now} again` : `${lead}${was} is renamed ${now}`
      break
    }
    case RenameCause.Distinguished:
      s = `${was} is known as ${now}, another town bearing its name`
      break
    default:
      s = `${was} is renamed ${now}`
  }
  return s + keptWords(h, i, false)
}

/** Inspector line for a PlaceRenamed event from the point of view of settlement `id` (the town itself, the realm's capital, or the ruin), or null. */
export function describeRenamingEventFor(h: History, e: HistoryEvent, id: number): string | null {
  const i = rowOf(h, e)
  if (i < 0) return null
  const R = h.renamings
  const was = oldName(h, i), now = R.name[i]
  if (id !== e.settlement) {
    // the ruin whose name was revived, or the capital of the realm behind the renaming
    if (R.cause[i] === RenameCause.Revived && R.source[i] === id) return `Its name was taken up by ${was}, grown on its ruins`
    return `Its realm renamed ${was} ${now}`
  }
  const pol = polName(h, R.polity[i])
  const people = R.people[i] >= 0 ? peopleName(h, R.people[i]) : null
  const form = R.form[i]
  let s: string
  switch (R.cause[i]) {
    case RenameCause.Conquest:
      s = form === RenameForm.Adapted && people ? `Came to be called ${now}, the ${people} form of its name` : `Renamed ${now}${honours(h, i)}${pol ? ` by ${pol}, which held it` : ''}`
      break
    case RenameCause.Cession:
      s = `Ceded${pol ? ` to ${pol}` : ''} and renamed ${now}${honours(h, i)}`
      break
    case RenameCause.Capital:
      s = `Made the seat${pol ? ` of ${pol}` : ''} and renamed ${now}${honours(h, i)}`
      break
    case RenameCause.Refounded:
      s = `Sacked and refounded${pol ? ` by ${pol}` : ''} as ${now}${honours(h, i)}`
      break
    case RenameCause.Faith: {
      const f = faithName(h, R.faith[i])
      s = form === RenameForm.Faith && f ? `Rededicated to ${f} as ${now}` : `Renamed ${now}${pol ? ` by ${pol}` : ''}${f ? `, taken from ${f}` : ''}`
      break
    }
    case RenameCause.Trade:
      s = `Came to be known as ${now}, the name ${people ? `the ${people} traders` : 'its foreign traders'} gave it`
      break
    case RenameCause.Restored:
      s = `Took back the name ${now} after ${Math.max(1, R.year[i] - oldSince(h, i))} years as ${was}`
      break
    case RenameCause.Revived:
      s = `Took up the name of the ruin it grew on, ${now}`
      break
    case RenameCause.HouseFell: {
      const d = fallenHouse(h, i)
      s = `${form === RenameForm.Restored || R.restored[i] >= -1 ? `Named ${now} again` : `Renamed ${now}`}${d ? ` when the house of ${d} fell` : ''}`
      break
    }
    case RenameCause.Distinguished:
      s = `Known as ${now} from its founding, another town bearing the name ${was}`
      break
    default:
      s = `Renamed ${now}`
  }
  return s + keptWords(h, i, true)
}

/** Whether the chronicle leaves a renaming out: a Distinguished name, given at the founding (the inspector still says it). */
export function renamingHiddenInChronicle(h: History, e: HistoryEvent): boolean {
  const i = rowOf(h, e)
  return i >= 0 && h.renamings.cause[i] === RenameCause.Distinguished
}

/** Headline renamings: of a capital (at the year, or made one by it) or a city. */
export function isRenamingHeadline(h: History, e: HistoryEvent): boolean {
  const i = rowOf(h, e)
  if (i < 0) return false
  const R = h.renamings
  if (R.cause[i] === RenameCause.Distinguished) return false
  if (R.cause[i] === RenameCause.Capital) return true
  const id = e.settlement, y = e.year
  const s = Math.min(h.snapshotCount - 1, Math.max(0, Math.floor(y / h.snapshotInterval)))
  if ((h.population[s * h.settlements.length + id] ?? 0) >= CITY_POPULATION) return true
  const pd = politiesOf(h)
  if (!pd) return false
  const p = polityAtYear(pd, id, y)
  return p >= 0 && capitalAt(pd, p, y) === id
}

/**
 * The inspector's names line for settlement `id` at `year`: "Formerly Ilchanak (until 1202) · the Leko still call it Tiboi";
 * '' when it bears its founding name (or a Distinguished one with no other).
 */
export function namesLine(h: History, id: number, year: number): string {
  if (!renamingsOf(h)) return ''
  const former = formerNames(h, id, year)
  const parts: string[] = []
  if (former.length) parts.push('Formerly ' + former.map((f) => `${f.name} (until ${f.until})`).join(', '))
  const i = renamingRowAt(h, id, year)
  if (i >= 0) {
    const R = h.renamings
    const k = R.keptBy[i]
    const n = k >= 0 ? peopleName(h, k) : null
    if (n) parts.push(`called ${oldName(h, i)} by the ${n}`)
  }
  const s = parts.join(' · ')
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}
