// absentee: chronicle and inspector lines for the absentee and do-nothing rulers of the AI realms (EventType 185-187:
// CouncilRuled, RuledInPerson, RulerTaken; HistoryOptions.absentee) and the story director's rules for them (the sagas'
// epithets, the Absent, the Idle, the Old, the Captive, are in sagas/epithets.ts). DOM-free; null for other events, so the
// caller falls back to its own words.
import { EventType } from '../contract.ts'
import type { History } from '../contract.ts'
import { DramaCat, registerDrama } from './story/drama.ts'
import { rulersOf, rulerWord, his } from './rulersData.ts'
import { politiesOf } from './politiesData.ts'
import { polityName } from './polityFormat.ts'
import { renamedName } from './renamingData.ts'
import { DECIDER, deciderNameOf } from './seat/decider.ts'

// The story director's rules (ui/story/drama.ts; base weights a design default [A]): a realm governed in its ruler's name is
// politics, a ruler taken captive in battle a war story.
// (surfacing lane: weighed by the realm, and a captive ruler is the world's first such story once)
registerDrama(185, { cat: DramaCat.Politics, base: 4, polities: (_c, e) => [e.value], mag: (c, e) => c.polityPop(e.value, e.year) }) // CouncilRuled
registerDrama(186, { cat: DramaCat.Politics, base: 2 }) // RuledInPerson
registerDrama(187, { cat: DramaCat.War, base: 7, first: true, polities: (c, e) => [e.other >= 0 ? c.polityBefore(e.other, e.year) : -1, c.polityBefore(e.settlement, e.year)], mag: (c, e) => (e.other >= 0 ? c.polityPop(c.polityBefore(e.other, e.year), e.year) : 0) }) // RulerTaken

/** Whether an event type is an absentee event (185-187). */
export const isAbsenteeEvent = (t: number): boolean => t >= 185 && t <= 187

/** Whether `other` of an absentee event is a settlement id (RulerTaken: the captive's capital; the others carry the reign). */
export const absenteeOtherIsSettlement = (t: number): boolean => t === EventType.RulerTaken

/** Why the ruler did not rule (CouncilRuled extra: DeferenceCause 1-6). */
const REASON: Record<number, string> = { 1: 'a child', 2: 'campaigning far from home', 3: 'ruling from afar', 4: 'taking little part in affairs', 5: 'old and failing', 6: 'a captive' }

const townName = (h: History, id: number): string => (id >= 0 && id < h.settlements.length ? renamedName(h, id) ?? (h.settlements[id].name || `Settlement #${id}`) : 'a town')
const capFirst = (t: string): string => (t ? t[0].toUpperCase() + t.slice(1) : t)

/** "King Narun II" for reign r at `year` ('its ruler' without the tables). */
function rulerTitle(h: History, r: number, year: number): string {
  const rd = rulersOf(h)
  if (!rd || r < 0 || r >= rd.R) return 'its ruler'
  return `${rulerWord(rd, r, year)} ${rd.title[r]}`
}
function polityWord(h: History, p: number): string {
  const pd = politiesOf(h)
  return pd ? polityName(pd, p, 'the realm') : 'the realm'
}
function hisOf(h: History, r: number): string {
  const x = h.rulers?.[r]
  return x ? his(x) : 'his'
}

/** The body that governed (third person) for a decline of cause `cause`: the regent's council, a viceroy, or the realm's court. */
export function absenteeBody(h: History, p: number, year: number, cause: number): string {
  if (cause === 1) return DECIDER.regency
  if (cause === 3) return DECIDER.viceroy
  const b = deciderNameOf(h, p, year)
  return b === DECIDER.court ? 'the court' : b
}

/** Chronicle line of an absentee event (185-187), or null. */
export function describeAbsenteeEvent(h: History, e: { year: number; type: number; settlement: number; other: number; value: number; extra?: number }): string | null {
  if (!isAbsenteeEvent(e.type)) return null
  const x = e.extra ?? 0
  switch (e.type) {
    case EventType.CouncilRuled: {
      const who = rulerTitle(h, e.other, e.year)
      return `With ${who} ${REASON[x] ?? 'absent'}, ${absenteeBody(h, e.value, e.year, x)} governed ${polityWord(h, e.value)} in ${hisOf(h, e.other)} name`
    }
    case EventType.RuledInPerson: {
      const who = rulerTitle(h, e.other, e.year)
      if (x === 1) return `${capFirst(who)} came of age, and the regent’s council gave up the government of ${polityWord(h, e.value)}`
      if (x === 2) return `${capFirst(who)} came home, and ruled ${polityWord(h, e.value)} in person again`
      if (x === 3) return `With the union ended, ${polityWord(h, e.value)} was ruled in person again`
      return `The rule of the council in ${polityWord(h, e.value)} ended with the reign of ${who}`
    }
    case EventType.RulerTaken: {
      const pd = politiesOf(h)
      const S = h.settlements.length
      const q = Math.max(0, Math.min(h.snapshotCount - 1, Math.floor(e.year / h.snapshotInterval)))
      const p = h.polity && e.other >= 0 && e.other < S ? h.polity[q * S + e.other] : -1
      const realm = pd && p >= 0 ? ` of ${polityName(pd, p, 'the realm')}` : ''
      return `${capFirst(rulerTitle(h, e.value, e.year))}${realm} was taken captive in the fighting for ${townName(h, e.settlement)}, and held for ${x === 1 ? 'a year' : `${x} years`}`
    }
  }
  return null
}
