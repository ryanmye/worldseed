// seat: who decides when the player does nothing ("Do nothing — let <body> decide"), from what the History says of the seat's
// realm at a year. One table, keyed on what exists on main today: the seat's kind (a House: the family; a People without a
// realm: the elders), a league of towns or an elected head (the league's council), a regency (the regent's council, from the
// Regency event and its years), the realm's tier (a chiefdom: the elders; a kingdom or an empire: your court). Later plans add
// their regimes at the marked extension points, ahead of the tier rule; the fallback is "your court".
import { PolityOrigin, SeatKind } from '../../contract.ts'
import type { History, SeatOptions } from '../../contract.ts'
import { tierOf } from '../politiesData.ts'

/** The bodies (the button's and the Chronicle's words). */
export const DECIDER = {
  family: 'the family',
  elders: 'the elders',
  court: 'your court',
  regency: 'the regent’s council',
  league: 'the league’s council',
  viceroy: 'the viceroy', // absentee: a junior realm of a personal union (its ruler reigns from the senior throne)
  // extension points (their words; no main-today rule reaches them yet):
  priests: 'the priests', // a theocracy (religious-evolution / modern-ideologies regime)
  council: 'the council', // city-states: a merchant republic or free city
  signoria: 'the signoria', // city-states: a signoria
  estates: 'the estates', // court-politics: the estates summoned
  parliament: 'parliament', // modern-ideologies: parliamentary or constitutional rule
  party: 'the party', // modern-ideologies: a party state
  generals: 'the generals', // modern-ideologies: a junta
  assembly: 'the assembly', // modern-ideologies: a democracy
} as const

/**
 * Extension points: each later plan returns its body for polity p at `year` from its own History fields, or null when it
 * has nothing to say (absent system, or a regime it does not own). Checked in order before the tier rule.
 * - city-states: History.cityStates (government: Republic -> council, Signoria -> signoria, FreeCity -> council)
 * - court-politics: estates in session -> estates
 * - modern-ideologies: History regime (Theocracy -> priests, Parliamentary/Constitutional -> parliament, PartyState -> party,
 *   Junta -> generals, Democracy -> assembly)
 */
export const DECIDER_RULES: ((h: History, p: number, year: number) => string | null)[] = []

/** The seat's polity at `year` (-1: none). */
function seatPolity(h: History, seat: SeatOptions, year: number): number {
  const S = h.seat
  if (S && year >= S.seat.from) { const i = Math.min(S.polityAt.length - 1, year - S.seat.from); if (i >= 0) return S.polityAt[i] }
  return seat.kind === SeatKind.Polity ? seat.id : -1
}

/** Polity p's tier at `year` from the snapshot (0 chiefdom, 1 kingdom, 2 empire; the UI's rule, politiesData.ts tierOf). */
function tierAtYear(h: History, p: number, year: number): number {
  const N = h.settlements.length
  const s = Math.max(0, Math.min(h.snapshotCount - 1, Math.floor(year / h.snapshotInterval)))
  let pop = 0, members = 0, world = 0
  const byPeople = new Map<number, number>()
  for (let i = 0; i < N; i++) {
    if (h.settlements[i].outpost) continue
    const x = h.population[s * N + i]
    world += x
    if (h.polity[s * N + i] !== p) continue
    pop += x; members++
    const k = h.settlements[i].people
    byPeople.set(k, (byPeople.get(k) ?? 0) + x)
  }
  let shares = 0
  for (const v of byPeople.values()) if (pop > 0 && v >= 0.15 * pop) shares++
  return tierOf(pop, members, shares, world)
}

/** Who decides for the seat at `year` when the player lets the matter be (see DECIDER). */
export function deciderName(h: History, seat: SeatOptions, year: number): string {
  if (seat.kind === SeatKind.House) return DECIDER.family
  return deciderNameOf(h, seatPolity(h, seat, year), year)
}

/** Who decides for polity p at `year` when its ruler does not (any realm, the seat's or an AI's: absentee rulers). */
export function deciderNameOf(h: History, p: number, year: number): string {
  if (p < 0 || !h.polities || p >= h.polities.length) return DECIDER.elders // (a people without a realm: its towns' elders)
  for (const rule of DECIDER_RULES) { const b = rule(h, p, year); if (b) return b }
  if (h.polities[p].origin === PolityOrigin.League) return DECIDER.league
  const R = h.rulers ?? []
  let cur: (typeof R)[number] | null = null
  for (const r of R) if (r.polity === p && r.acceded <= year && (r.ended < 0 || r.ended > year)) cur = r
  if (cur && cur.dynasty < 0) return DECIDER.league // (an elected head of a league)
  if (cur) for (const e of h.events) if ((e.type as number) === 84 && e.value === cur.id && e.year <= year && year < e.year + (e.extra ?? 0)) return DECIDER.regency
  return tierAtYear(h, p, year) === 0 ? DECIDER.elders : DECIDER.court
}

/** The button's words: "Do nothing — let your court decide". */
export function deciderButton(h: History, seat: SeatOptions, year: number): string {
  return `Do nothing — let ${deciderName(h, seat, year)} decide`
}

/** The Chronicle's words for the body (third person: "its court"). */
export function deciderChronicle(h: History, seat: SeatOptions, year: number): string {
  const b = deciderName(h, seat, year)
  return b === DECIDER.court ? 'its court' : b
}
