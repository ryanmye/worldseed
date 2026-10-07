// The first hearths the player planted (cradlesContract.ts), in the plain words of the chronicle and the inspector:
// the year-0 CradlePlaced lines and the origin line of a placed people's first settlement. Every line comes from the
// event's outcome (or History.cradlePlaced); peoples whose cradle the simulation chose keep the old wording (no line).
// The sagas tell the same facts as divine placement (sagas/omens.ts DIVINE_T).

import type { History, HistoryEvent } from '../contract.ts'
import { settlementName } from './format.ts'
import { CRADLE_PLACED, cradlesOf, Hearth, hearthOf } from './cradlesContract.ts'

export const isCradleEvent = (t: number) => t === (CRADLE_PLACED as number)

/** Whether an event is shown: a CradlePlaced for a wish (the simulation's own choices are not news). */
export const isShownCradleEvent = (e: Pick<HistoryEvent, 'extra'> & { type: number }) => isCradleEvent(e.type as number) && (e.extra ?? 0) !== Hearth.Chosen

const peopleWords = (h: History, p: number) => `the ${h.peoples[p]?.name ?? 'first people'}`

/** The chronicle's line for a CradlePlaced event (null for another event). */
export function describeCradleEvent(h: History, e: HistoryEvent): string | null {
  if (!isCradleEvent(e.type as number)) return null
  const who = peopleWords(h, e.value)
  const at = e.settlement >= 0 && e.settlement < h.settlements.length ? settlementName(h, e.settlement) : ''
  switch (e.extra ?? 0) {
    case Hearth.Placed: return `The first hearth of ${who} is kindled at the chosen place${at ? `, ${at}` : ''}`
    case Hearth.Moved: return `The first hearth of ${who} is kindled${at ? ` at ${at}` : ''}, moved from the chosen place to the nearest living land`
    case Hearth.Rejected: return `The first hearth of ${who}: the place chosen could not be lived in; they began elsewhere${at ? `, at ${at}` : ''}`
  }
  return `The first hearth of ${who} is kindled${at ? ` at ${at}` : ''}`
}

/** The inspector's line for a CradlePlaced event of settlement `id` (null for another event). */
export function describeCradleEventFor(h: History, e: HistoryEvent, _id: number): string | null {
  if (!isCradleEvent(e.type as number)) return null
  const who = peopleWords(h, e.value)
  switch (e.extra ?? 0) {
    case Hearth.Placed: return `The first hearth of ${who}, kindled at the chosen place`
    case Hearth.Moved: return `The first hearth of ${who}, kindled at the nearest living land to the chosen place`
    case Hearth.Rejected: return `The place chosen for ${who} could not be lived in; they began here instead`
  }
  return `The first hearth of ${who}`
}

/** "Original tribe" and, for a placed people's first settlement, how it came there (the inspector's origin line). */
export function originWords(h: History, id: number): string {
  const s = h.settlements[id]
  const p = s?.people ?? -1
  if (!s || s.parent >= 0 || p < 0 || h.peoples[p]?.founder !== id) return 'Original tribe'
  switch (hearthOf(cradlesOf(h), p)) {
    case Hearth.Placed: return 'Original tribe · planted at the chosen place'
    case Hearth.Moved: return 'Original tribe · planted at the nearest land to the place chosen'
    case Hearth.Rejected: return 'Original tribe · the place chosen could not be lived in'
  }
  return 'Original tribe'
}
