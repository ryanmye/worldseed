// seat: the watcher (seat-mode §3.5). After seatYear, it scans the year's events and a few state conditions for the seat's
// polity p and people k and records decisions (rows of History.seat.decisions), each with 2-4 options whose orders act from
// the next year. Pure reads of HistoryState: it draws nothing (no stream is touched) and pushes no event, so the run is the
// same with it or without it; the orders a player picks are what changes history.
//
// Rules:
// - Fog: a polity it names must be of a people k has met (contact >= 0); a place must be known to k.
// - Only what a court could know: events, sizes, borders, walls, faiths, ages; never a pre-drawn value (rDeath, R.kill, the
//   length of a crisis). The test greps this file for those names.
// - Options pass the orders' own check at give (orders/system.ts orderCheck); a card left with fewer than 2 options is dropped.
//   The option with no orders is the court's own course ("let the court decide"); a Choice order records every pick.
// - Cadence: at most SEAT.maxCards a year (PRIORITY), none within SEAT.minGap years of the last unless urgent, a cooldown
//   per kind (SEAT.cool), Plague once per epidemic, nothing in the seat's first year.
//
// v1 (seat step 6) offers the kinds whose orders exist: WarOnUs (Peace), Opening (War), Plague (Quarantine, Seat), Faith,
// Revolt (Fortify), Frontier (Settle, Explore), Crop, Idea. The court kinds come with seat steps 8-9 (their order kinds).
import { DecisionKind, EventType, FaithKind, OrderKind, OrderReason, SeatOptionKey } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { projAt } from '../polity/state.ts'
import { atWar } from '../polity/formation.ts'
import { relIdx } from '../polity/relations.ts'
import { bound } from '../polity/policy.ts'
import { WAR } from '../polity/params.ts'
import { ORDERS } from '../orders/params.ts'
import { orderCheck } from '../orders/system.ts'
import { polityFaith } from '../religion/system.ts'
import { chordCells } from '../orders/hooks.ts'
import type { SeatState } from './state.ts'
import { PRIORITY, SEAT, URGENT } from './params.ts'

/** An order of an option: kind, actor, target (-1 none). */
type O = [number, number, number]
interface Option { key: number; orders: O[] }
interface Card { kind: number; subject: number; place: number; options: Option[] }

const RANK = new Int32Array(18).fill(99)
PRIORITY.forEach((k, i) => { RANK[k] = i })

/** The options among `opts` whose orders all pass the check now (a court option, with none, always does). */
function feasible(s: HistoryState, opts: Option[]): Option[] {
  return opts.filter((o) => o.orders.every(([k, a, t]) => orderCheck(s, k, a, t) === OrderReason.None))
}

/** The people of polity q (its capital's), -1. */
function peopleOfPolity(s: HistoryState, ps: PolityState, q: number): number {
  const c = q >= 0 && q < ps.pcap ? ps.pCapital[q] : -1
  return c >= 0 ? s.people[c] : -1
}

/** Polity q is of a people k has met (or k's own). */
function contacted(s: HistoryState, ps: PolityState, k: number, q: number): boolean {
  const pq = peopleOfPolity(s, ps, q)
  return pq >= 0 && (pq === k || s.know.contact[k * s.know.P + pq] >= 0)
}

/** Settlement id is known to people k (its cell). */
function knownTown(s: HistoryState, k: number, id: number): boolean {
  return id >= 0 && id < s.count && s.know.known[k * s.terrain.cellCount + s.cell[id]] >= 0
}

const memberOf = (ps: PolityState, id: number, p: number): boolean => id >= 0 && id < ps.polity.length && ps.polity[id] === p

/** p's best advantage at the border over q: its projected power at its best front over q's there (as war.ts weighs a declaration). */
export function borderAdvantage(ps: PolityState, p: number, q: number): number {
  const r = relIdx(ps, p, q)
  if (r < 0) return 0
  const edges = ps.relEdges[r]
  let best = 0
  for (let e = 0; e < edges.length; e += 3) {
    const a = edges[e], b = edges[e + 1], c = edges[e + 2]
    const u = ps.polity[a] === p ? a : b, v = u === a ? b : a
    if (ps.polity[u] !== p || ps.polity[v] !== q) continue
    const x = projAt(ps, p, ps.dist[u] + c) / (projAt(ps, q, ps.dist[v]) + 1e-9)
    if (x > best) best = x
  }
  return best
}

/** The year's cards (before cadence), from the year's events and the state. */
function candidates(s: HistoryState, st: SeatState, from: number, cards: Card[]): void {
  const ps = s.pol
  const p = st.polity, k = st.people
  if (k < 0) return
  const ev = s.events
  const E = ev.length
  const cap = ps !== null && p >= 0 ? ps.pCapital[p] : -1
  for (let e = from; e < E; e++) {
    const x = ev[e]
    switch (x.type) {
      case EventType.WarDeclared: {
        if (ps === null || p < 0 || ps.wDef[x.value] !== p) break
        const q = ps.wAtt[x.value]
        if (!contacted(s, ps, k, q)) break
        cards.push({ kind: DecisionKind.WarOnUs, subject: q, place: cap, options: [
          { key: SeatOptionKey.FightOn, orders: [] },
          { key: SeatOptionKey.SuePeace, orders: [[OrderKind.Peace, p, q]] },
        ] })
        break
      }
      case EventType.SuccessionCrisis: case EventType.CivilWar: case EventType.Regency: {
        if (ps === null || p < 0) break
        const q = x.type === EventType.SuccessionCrisis ? x.value : x.type === EventType.CivilWar ? (x.other >= 0 && x.other < ps.polity.length ? ps.polity[x.other] : -1) : (x.settlement >= 0 && x.settlement < ps.polity.length ? ps.polity[x.settlement] : -1)
        if (q < 0 || q === p || ps.pEnded[q] >= 0 || !contacted(s, ps, k, q)) break
        const r = relIdx(ps, p, q)
        if (r < 0 || ps.relEdges[r].length === 0 || s.year < ps.relTruce[r] || bound(ps, p, q) || atWar(ps, p, q) || ps.pWars[p] >= WAR.maxWars) break
        if (borderAdvantage(ps, p, q) < SEAT.openAdv) break
        cards.push({ kind: DecisionKind.Opening, subject: q, place: ps.pCapital[q], options: [
          { key: SeatOptionKey.Strike, orders: [[OrderKind.War, p, q]] },
          { key: SeatOptionKey.StayOut, orders: [] },
        ] })
        break
      }
      case EventType.GreatEpidemic: case EventType.CityStricken: {
        if (ps === null || p < 0 || !memberOf(ps, x.settlement, p) || !knownTown(s, k, x.settlement) || st.epidemics.has(x.value)) break
        // (once per epidemic, offered or not: recorded at the cadence pass)
        const opts: Option[] = []
        const ports: number[] = []
        for (const id of s.living) if (memberOf(ps, id, p) && s.port[id] >= 0 && !s.outpost[id] && orderCheck(s, OrderKind.Quarantine, id, -1) === OrderReason.None) ports.push(id)
        ports.sort((a, b) => s.pop[b] - s.pop[a] || a - b)
        if (ports.length > 0) opts.push({ key: SeatOptionKey.Quarantine, orders: ports.slice(0, SEAT.plagueQuarantine).map((id): O => [OrderKind.Quarantine, id, -1]) })
        let move = -1
        for (const id of s.living) if (memberOf(ps, id, p) && id !== cap && id !== x.settlement && !s.outpost[id] && (cap < 0 || s.pop[id] >= ORDERS.seatShare * s.pop[cap]) && (move < 0 || s.pop[id] > s.pop[move])) move = id
        if (move >= 0 && x.settlement === cap) opts.push({ key: SeatOptionKey.MoveCourt, orders: [[OrderKind.Seat, p, move]] })
        opts.push({ key: SeatOptionKey.Endure, orders: [] })
        cards.push({ kind: DecisionKind.Plague, subject: x.value, place: x.settlement, options: opts })
        break
      }
      case EventType.Revolt: {
        if (ps === null || p < 0 || !memberOf(ps, x.settlement, p) || !knownTown(s, k, x.settlement) || cap < 0) break
        cards.push({ kind: DecisionKind.Revolt, subject: x.settlement, place: x.settlement, options: [
          { key: SeatOptionKey.Fortify, orders: [[OrderKind.Fortify, cap, -1]] },
          { key: SeatOptionKey.Crush, orders: [] },
        ] })
        break
      }
      case EventType.ExpeditionReturned: {
        if (x.value < SEAT.frontierCells || x.settlement < 0 || s.people[x.settlement] !== k) break
        const opts: Option[] = []
        const settle = frontierSite(s, k)
        if (settle >= 0) opts.push({ key: SeatOptionKey.Settle, orders: [[OrderKind.Settle, k, settle]] })
        const far = frontierBeyond(s, k, settle >= 0 ? settle : s.cell[x.settlement])
        if (far >= 0) opts.push({ key: SeatOptionKey.ExploreOn, orders: [[OrderKind.Explore, k, far]] })
        opts.push({ key: SeatOptionKey.Stay, orders: [] })
        cards.push({ kind: DecisionKind.Frontier, subject: settle >= 0 ? settle : far, place: x.settlement, options: opts })
        break
      }
      case EventType.SpeciesAdopted: case EventType.Domesticated: {
        const q = x.settlement >= 0 ? s.people[x.settlement] : -1
        if (q < 0 || q === k || s.know.contact[k * s.know.P + q] < 0 || !knownTown(s, k, x.settlement)) break
        cards.push({ kind: DecisionKind.Crop, subject: x.value, place: x.settlement, options: [
          { key: SeatOptionKey.TakeUp, orders: [[OrderKind.Crop, k, x.value]] },
          { key: SeatOptionKey.Ignore, orders: [] },
        ] })
        break
      }
      case EventType.IdeaAdopted: case EventType.IdeaConceived: {
        const q = x.settlement >= 0 ? s.people[x.settlement] : -1
        if (q < 0 || q === k || s.know.contact[k * s.know.P + q] < 0 || !knownTown(s, k, x.settlement)) break
        cards.push({ kind: DecisionKind.Idea, subject: x.value, place: x.settlement, options: [
          { key: SeatOptionKey.Seek, orders: [[OrderKind.Idea, k, x.value]] },
          { key: SeatOptionKey.Ignore, orders: [] },
        ] })
        break
      }
    }
  }
  // Faith (a state condition, checked when its cooldown has passed): a universal faith holding a large share of the realm, not the ruler's.
  const rel = s.rel
  if (rel !== null && s.rul !== null && ps !== null && p >= 0 && s.year - st.lastKind[DecisionKind.Faith] >= SEAT.cool[DecisionKind.Faith]) {
    const K = rel.fId.length / rel.cap
    const share = new Map<number, number>()
    let total = 0
    for (const id of s.living) {
      if (!memberOf(ps, id, p) || s.outpost[id]) continue
      total += s.pop[id]
      if (id >= rel.cap) continue
      for (let j = 0; j < rel.fN[id]; j++) {
        const f = rel.fId[id * K + j]
        if (f >= 0 && rel.kind[f] === FaithKind.Universal) share.set(f, (share.get(f) ?? 0) + rel.fSh[id * K + j] * s.pop[id])
      }
    }
    const rf = polityFaith(s, rel, p)
    let best = -1, bs = 0
    for (const [f, v] of share) if (f !== rf && v > bs) { bs = v; best = f }
    if (best >= 0 && total > 0 && bs >= SEAT.faithShare * total) {
      const holy = rel.holy[best]
      cards.push({ kind: DecisionKind.Faith, subject: best, place: holy >= 0 && knownTown(s, k, holy) ? holy : cap, options: [
        { key: SeatOptionKey.Embrace, orders: [[OrderKind.Faith, p, best]] },
        { key: SeatOptionKey.KeepWays, orders: [] },
      ] })
    }
  }
}

/** Frontier: the newly known (this year) free land cell of best capacity with no town within SEAT.frontierClear hops of it, -1. */
function frontierSite(s: HistoryState, k: number): number {
  const N = s.terrain.cellCount
  const hop = 1.12 / s.terrain.n
  const known = s.know.known
  let best = -1, bc = 0
  for (let c = 0; c < N; c++) {
    if (known[k * N + c] !== s.year || s.terrain.sea[c] || !(s.terrain.capacity[c] > bc)) continue
    let clear = true
    for (const id of s.living) if (chordCells(s, s.cell[id], c) <= SEAT.frontierClear * hop) { clear = false; break }
    if (clear) { best = c; bc = s.terrain.capacity[c] }
  }
  return best
}

/** Frontier: the unknown land cell nearest to cell `c` (where to explore further), -1. */
function frontierBeyond(s: HistoryState, k: number, c: number): number {
  const N = s.terrain.cellCount
  const known = s.know.known
  let best = -1, bd = Infinity
  for (let x = 0; x < N; x++) {
    if (known[k * N + x] >= 0 || s.terrain.sea[x]) continue
    const d = chordCells(s, c, x)
    if (d < bd) { bd = d; best = x }
  }
  return best
}

/**
 * The year's decisions (after seatYear): candidates, feasible options, cadence; recorded in st. st.newRows is the number
 * recorded this year (the pause test). Draws nothing.
 */
export function seatWatch(s: HistoryState, st: SeatState): void {
  st.newRows = 0
  const from = st.evSeen
  st.evSeen = s.events.length
  if (s.year <= st.opts.from || st.lostYear >= 0) return
  const cards: Card[] = []
  candidates(s, st, from, cards)
  if (cards.length === 0) return
  // stable by priority (then the order found in)
  const order = cards.map((_, i) => i).sort((a, b) => RANK[cards[a].kind] - RANK[cards[b].kind] || a - b)
  const seenKind = new Set<number>()
  for (const i of order) {
    const c = cards[i]
    if (c.kind === DecisionKind.Plague) { if (st.epidemics.has(c.subject)) continue; st.epidemics.add(c.subject) }
    if (st.newRows >= SEAT.maxCards || seenKind.has(c.kind)) continue
    if (s.year - st.lastKind[c.kind] < SEAT.cool[c.kind]) continue
    if (URGENT.indexOf(c.kind) < 0 && s.year - st.lastCard < SEAT.minGap) continue
    const opts = feasible(s, c.options)
    if (opts.length < 2 || opts.every((o) => o.orders.length > 0) || opts.length > 8) continue
    seenKind.add(c.kind)
    record(st, s.year, c, opts)
    st.newRows++
  }
  if (st.newRows > 0) st.lastCard = s.year
}

function record(st: SeatState, year: number, c: Card, opts: Option[]): void {
  st.dYear.push(year); st.dKind.push(c.kind); st.dPolity.push(st.polity); st.dSubject.push(c.subject); st.dPlace.push(c.place)
  st.lastKind[c.kind] = year
  for (const o of opts) {
    st.optKey.push(o.key)
    for (const [k, a, t] of o.orders) { st.orderKind.push(k); st.orderActor.push(a); st.orderTarget.push(t) }
    st.orderStart.push(st.orderKind.length)
  }
  st.optStart.push(st.optKey.length)
}

