// seat: which polity the player's seat holds, yearly at the end of the step (index.ts, after ordersEnd, before the snapshots;
// seat-mode §3.4). Pure reads of the state; it pushes only the seat events 270-273 and draws nothing.
//
//   People seat: the polity with the most people whose capital is of the people (-1 none: its towns only); lost when the people dies out.
//   Polity seat: itself while it lives. When it ends: a living realm whose ruler is of the house of its last ruler (the house's
//     other throne, a partition heir's share, the pretender's realm, a seceded realm of the house), the largest; without
//     rulers, the largest partition share of it; else lost.
//   House seat: the realm with the most people ruled by the house; lost when the house rules none.
import { EventType, PolityOrigin, SeatEnd, SeatKind } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import type { SeatState } from './state.ts'
import { seatAmbitions } from './ambitions.ts'
import { DEFER_OPTIONS, OrderKind } from '../../../contract.ts'
import { DeferenceCause, addDeference, deferBlame, deferenceTaken, reclaimPower } from '../rulers/deference.ts'
import { SEAT } from './params.ts'

/**
 * The year's Choice records (given this year): a deferral feeds the decision polity's deference (less for a divisive matter,
 * whose blame the deciding body bears); a decision taken lowers it; Reclaim takes the power back (rulers/deference.ts).
 */
function seatChoices(s: HistoryState, st: SeatState): void {
  const ox = s.orders
  const ev = s.events
  const E = ev.length
  const from = st.chSeen
  st.chSeen = E
  if (ox === null) return
  for (let e = from; e < E; e++) {
    const x = ev[e]
    if ((x.type as number) !== EventType.OrderGiven || x.extra !== OrderKind.Choice || x.value < 0 || x.value >= ox.n) continue
    const t = ox.target[x.value]
    const d = t >= 0 ? t >> 3 : -1
    if (d < 0 || d >= st.dYear.length) continue
    const p = st.dPolity[d], o = t & 7
    if (o === DEFER_OPTIONS.defer) {
      addDeference(s, p, 1 - SEAT.deferDivisive * st.dDiv[d], DeferenceCause.Player)
      if (st.dDiv[d] >= 0.5) deferBlame(s, p, st.dDiv[d], st.dKind[d])
    } else if (o === DEFER_OPTIONS.reclaim) reclaimPower(s, p)
    else deferenceTaken(s, p)
  }
}

function push(s: HistoryState, type: number, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type: type as EventType, settlement, other, value, extra })
}

/** The house of p's ruler now, -1 (no rulers, or none on the throne). */
export function houseOf(s: HistoryState, p: number): number {
  const R = s.rul
  if (R === null || p < 0 || p >= R.pcap) return -1
  const r = R.cur[p]
  return r >= 0 ? R.rDyn[r] : -1
}

/** The living polity with the most people that `ok` accepts, -1 none. */
function largest(ps: PolityState, ok: (p: number) => boolean): number {
  let best = -1
  for (const p of ps.alive) if (ok(p) && (best < 0 || ps.pPop[p] > ps.pPop[best])) best = p
  return best
}

/** The people's largest living town (not a base), -1 when it has none. */
export function peopleTown(s: HistoryState, k: number): number {
  let best = -1
  for (const id of s.living) if (s.people[id] === k && !s.outpost[id] && (best < 0 || s.pop[id] > s.pop[best])) best = id
  return best
}

/** The seat's polity this year (and the cause when it passed on: SeatPassed extra), or -1 with the SeatEnd when lost. */
function resolve(s: HistoryState, st: SeatState): { polity: number; passed: number; end: number } {
  const ps = s.pol
  const { kind, id } = st.opts
  if (kind === SeatKind.People) {
    if (peopleTown(s, id) < 0) return { polity: -1, passed: -1, end: SeatEnd.PeopleGone }
    const p = ps === null ? -1 : largest(ps, (q) => ps.pCapital[q] >= 0 && s.people[ps.pCapital[q]] === id)
    return { polity: p, passed: -1, end: -1 }
  }
  if (ps === null) return { polity: -1, passed: -1, end: SeatEnd.Conquered }
  if (kind === SeatKind.House) {
    const p = largest(ps, (q) => houseOf(s, q) === id)
    if (p >= 0) return { polity: p, passed: -1, end: -1 }
    const R = s.rul
    return { polity: -1, passed: -1, end: R !== null && id < R.dEnded.length && R.dEnded[id] >= 0 ? SeatEnd.HouseEnded : SeatEnd.Overthrown }
  }
  // Polity: the one held so far (the seat's own at first).
  const cur = st.taken ? st.polity : id
  if (cur >= 0 && cur < ps.pcap && ps.pEnded[cur] < 0 && ps.pFounded[cur] <= s.year) return { polity: cur, passed: -1, end: -1 }
  if (cur < 0 || cur >= ps.pcap) return { polity: -1, passed: -1, end: SeatEnd.Conquered }
  const house = st.house
  const heir = house >= 0 ? largest(ps, (q) => houseOf(s, q) === house) : s.rul === null ? largest(ps, (q) => ps.pParent[q] === cur && ps.pOrigin[q] === PolityOrigin.Partition) : -1
  if (heir < 0) return { polity: -1, passed: -1, end: SeatEnd.Conquered }
  const o = ps.pParent[heir] === cur ? ps.pOrigin[heir] : -1
  const how = o === PolityOrigin.Partition ? 1 : o === PolityOrigin.CivilWar ? 2 : o === PolityOrigin.Revolt ? 3 : 0
  return { polity: heir, passed: how, end: -1 }
}

/** The year's seat: resolution, SeatTaken / SeatPassed / SeatLost, the year's polity and people, ambitions. */
export function seatYear(s: HistoryState, st: SeatState): void {
  seatChoices(s, st)
  if (s.year < st.opts.from || st.lostYear >= 0) {
    if (st.lostYear >= 0) { st.polityAt.push(-1); st.peopleAt.push(-1) }
    return
  }
  const ps = s.pol
  const capOf = (p: number): number => (ps !== null && p >= 0 && p < ps.pcap ? ps.pCapital[p] : -1)
  const old = st.polity
  const r = resolve(s, st)
  if (r.end >= 0) {
    const at = old >= 0 ? capOf(old) : st.opts.kind === SeatKind.People ? -1 : capOf(old)
    const by = ps !== null && old >= 0 && old < ps.pcap && ps.pEnded[old] >= 0 ? ps.pEndBy[old] : -1
    if (!st.taken) push(s, EventType.SeatTaken, at, -1, st.opts.id, st.opts.kind)
    push(s, EventType.SeatLost, at, by, st.opts.id, r.end)
    st.taken = true
    st.lostYear = s.year
    st.polity = -1; st.people = -1; st.house = -1
    st.polityAt.push(-1); st.peopleAt.push(-1)
    return
  }
  const p = r.polity
  const cap = capOf(p)
  if (!st.taken) {
    push(s, EventType.SeatTaken, cap >= 0 ? cap : st.opts.kind === SeatKind.People ? peopleTown(s, st.opts.id) : -1, -1, st.opts.id, st.opts.kind)
    st.taken = true
  } else if (r.passed >= 0 && p !== old) push(s, EventType.SeatPassed, cap, capOf(old), p, r.passed)
  st.polity = p
  st.people = st.opts.kind === SeatKind.People ? st.opts.id : cap >= 0 ? s.people[cap] : -1
  const h = houseOf(s, p)
  if (h >= 0 || p < 0) st.house = h // (a throne empty for a year keeps the house it had)
  st.polityAt.push(p); st.peopleAt.push(st.people)
  seatAmbitions(s, st)
}
