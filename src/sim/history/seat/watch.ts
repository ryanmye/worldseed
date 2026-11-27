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
// Revolt (Fortify), Frontier (Settle, Explore), Crop, Idea. Seat steps 8-9 add the court kinds: Heir (Designate), Crisis and
// General (Placate, Purge), Match and Opening's match (Marry), AllianceMade (Repudiate), AllianceSought and WarOnUs's ally (Ally),
// Overlord (Defy), WarOnUs's tribute (Submit); step 13 the dependent ones: Credit (finance: Borrow, Levy, Repudiate of the
// debts) and Betrayal (oaths: Betray). Charter waits for city-states.
import { DECISION_KIND_COUNT, DecisionKind, EventType, FaithKind, OrderKind, OrderReason, SeatOptionKey } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { projAt } from '../polity/state.ts'
import { atWar } from '../polity/formation.ts'
import { relIdx } from '../polity/relations.ts'
import { bound } from '../polity/policy.ts'
import { WAR } from '../polity/params.ts'
import { ORDERS } from '../orders/params.ts'
import { orderCheck } from '../orders/system.ts'
import { allyWar } from '../orders/seatOrders.ts'
import { allied, overlordOf } from '../polity/bonds.ts'
import { relationOf } from '../polity/relations.ts'
import { ALLIANCE } from '../polity/params.ts'
import { MARRIAGE, RULERS } from '../rulers/params.ts'
import { tied, unionBond } from '../rulers/marriage.ts'
import { contestChance, eligibleHeirs, overthrowHazard, pickHeir } from '../rulers/hazards.ts'
import { finNeed } from '../finance/hooks.ts'
import { figureheadOf } from '../rulers/deference.ts'
import { polityFaith } from '../religion/system.ts'
import { chordCells } from '../orders/hooks.ts'
import type { SeatState } from './state.ts'
import { DIVISIVE, OPTION_RISK, PRIORITY, SEAT, URGENT } from './params.ts'
import { AmbitionKind } from '../../../contract.ts'
import { RULERS as RP } from '../rulers/params.ts'
import { HUD_N, hudRow } from './hud.ts'

/** An order of an option: kind, actor, target (-1 none). */
type O = [number, number, number]
interface Option { key: number; orders: O[] }
/** info: a kind's detail (lane N3: SeatState.dInfo). */
interface Card { kind: number; subject: number; place: number; options: Option[]; info?: number }

const RANK = new Int32Array(DECISION_KIND_COUNT).fill(99)
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
        const opts: Option[] = [
          { key: SeatOptionKey.FightOn, orders: [] },
          { key: SeatOptionKey.SuePeace, orders: [[OrderKind.Peace, p, q]] },
          { key: SeatOptionKey.OfferTribute, orders: [[OrderKind.Submit, p, q]] },
        ]
        const r = allyAgainst(s, ps, k, p, q)
        if (r >= 0) opts.push({ key: SeatOptionKey.SeekAlly, orders: [[OrderKind.Ally, p, r]] })
        cards.push({ kind: DecisionKind.WarOnUs, subject: q, place: cap, options: opts })
        break
      }
      case EventType.SuccessionCrisis: case EventType.CivilWar: case EventType.Regency: {
        if (ps === null || p < 0) break
        const q = x.type === EventType.SuccessionCrisis ? x.value : x.type === EventType.CivilWar ? (x.other >= 0 && x.other < ps.polity.length ? ps.polity[x.other] : -1) : (x.settlement >= 0 && x.settlement < ps.polity.length ? ps.polity[x.settlement] : -1)
        if (q === p && x.type !== EventType.CivilWar) {
          // Crisis: a succession crisis or a regency at home
          cards.push({ kind: DecisionKind.Crisis, subject: p, place: cap, info: x.type, options: [
            { key: SeatOptionKey.Placate, orders: [[OrderKind.Placate, p, -1]] },
            { key: SeatOptionKey.Endure, orders: [] },
            ...(figureheadOf(s, p) ? [{ key: SeatOptionKey.Reclaim, orders: [] as O[] }] : []), // (rulers: deference: take the power back, at a risk)
          ] })
          break
        }
        if (q < 0 || q === p || ps.pEnded[q] >= 0 || !contacted(s, ps, k, q)) break
        const r = relIdx(ps, p, q)
        if (r < 0 || ps.relEdges[r].length === 0 || s.year < ps.relTruce[r] || bound(ps, p, q) || atWar(ps, p, q) || ps.pWars[p] >= WAR.maxWars) break
        if (borderAdvantage(ps, p, q) < SEAT.openAdv) break
        cards.push({ kind: DecisionKind.Opening, subject: q, place: ps.pCapital[q], options: [
          { key: SeatOptionKey.Strike, orders: [[OrderKind.War, p, q]] },
          { key: SeatOptionKey.StayOut, orders: [] },
          ...(s.rul !== null ? [{ key: SeatOptionKey.OfferMatch, orders: [[OrderKind.Marry, p, q] as O] }] : []),
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
        // (lane N3: Crush is a real order now, a garrison: the risen town walled and held; the court's own course is Ignore)
        const crushed = e + 1 < E && ev[e + 1].type === EventType.RevoltCrushed && ev[e + 1].settlement === x.settlement ? 1 : 0
        cards.push({ kind: DecisionKind.Revolt, subject: x.settlement, place: x.settlement, info: crushed, options: [
          { key: SeatOptionKey.Placate, orders: [[OrderKind.Placate, p, -1]] },
          { key: SeatOptionKey.Fortify, orders: [[OrderKind.Fortify, cap, -1]] },
          { key: SeatOptionKey.Crush, orders: [[OrderKind.Fortify, x.settlement, -1]] },
          { key: SeatOptionKey.Ignore, orders: [] },
        ] })
        break
      }
      case EventType.Alliance: {
        // AllianceMade: an alliance with the realm as a party (not one the player sought this year)
        if (ps === null || p < 0) break
        const a = x.settlement >= 0 && x.settlement < ps.polity.length ? ps.polity[x.settlement] : -1
        const q = a === p ? x.value : x.value === p ? a : -1
        if (q < 0 || !contacted(s, ps, k, q) || soughtNow(s, OrderKind.Ally, p, q)) break
        cards.push({ kind: DecisionKind.AllianceMade, subject: q, place: ps.pCapital[q], options: [
          { key: SeatOptionKey.Honour, orders: [] },
          { key: SeatOptionKey.Renounce, orders: [[OrderKind.Repudiate, p, q]] },
        ] })
        break
      }
      case EventType.BecameVassal: {
        // Overlord: the realm became a vassal or tributary (extra 0)
        if (ps === null || p < 0 || x.extra !== 0 || x.settlement !== cap) break
        const o = overlordOf(ps, p)
        if (o >= 0) cards.push(overlordCard(s, ps, p, o))
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
  if (ps !== null && p >= 0) courtCards(s, st, ps, p, k, cap, cards)
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

/** WarOnUs: an ally to seek against q: the largest contacted realm (not p, not at war with p, not allied) with rivalry >= ALLIANCE.threat with q, -1. */
function allyAgainst(s: HistoryState, ps: PolityState, k: number, p: number, q: number): number {
  let best = -1
  for (let r = 0; r < ps.relA.length; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if ((a !== q && b !== q) || ps.relR[r] < ALLIANCE.threat) continue
    const x = a === q ? b : a
    if (x === p || ps.pEnded[x] >= 0 || atWar(ps, p, x) || allied(ps, p, x) || !contacted(s, ps, k, x)) continue
    if (best < 0 || ps.pPop[x] > ps.pPop[best]) best = x
  }
  return best
}

/** True when the orders given this year (a card's) asked for this: kind, actor a, target t. */
function soughtNow(s: HistoryState, kind: number, a: number, t: number): boolean {
  const ox = s.orders
  if (ox === null) return false
  for (let i = 0; i < ox.n; i++) if (ox.kind[i] === kind && ox.actor[i] === a && ox.target[i] === t && ox.year[i] <= s.year && ox.year[i] >= s.year - 30) return true
  return false
}

function overlordCard(s: HistoryState, ps: PolityState, p: number, o: number): Card {
  void s
  return { kind: DecisionKind.Overlord, subject: o, place: ps.pCapital[o], options: [
    { key: SeatOptionKey.Pay, orders: [] },
    { key: SeatOptionKey.Defy, orders: [[OrderKind.Defy, p, o]] },
  ] }
}

const HEIRS: number[] = []
const off = (st: SeatState, s: HistoryState, kind: number): boolean => s.year - st.lastKind[kind] < SEAT.cool[kind]
/** lane N3: a kind's cooldown for this seat (the first ambition declared drives the cadence: Unify, Opening every openCoolUnify years). */
export function coolOf(st: SeatState, kind: number): number {
  const a = st.opts.ambitions?.[0]
  if (kind === DecisionKind.Opening && a === AmbitionKind.Unify) return SEAT.openCoolUnify
  return SEAT.cool[kind]
}
const offFor = (st: SeatState, s: HistoryState, kind: number): boolean => s.year - st.lastKind[kind] < coolOf(st, kind)

/**
 * The court's state conditions (seat steps 8, 9, 13), each checked only when its cooldown has passed: Heir, General, Match,
 * AllianceSought, Overlord (again, while a vassal), Credit (finance), Betrayal (oaths). Reads only what a court could know: ages
 * from birth years, the heirs alive now, the hazards as the rulers system weighs them now, rivalries, sizes, the treasury.
 */
function courtCards(s: HistoryState, st: SeatState, ps: PolityState, p: number, k: number, cap: number, cards: Card[]): void {
  const R = s.rul
  const year = s.year
  if (R !== null && p < R.pcap && R.cur[p] >= 0 && R.rDyn[R.cur[p]] >= 0 && R.union[p] < 0) {
    const r = R.cur[p]
    // Heir: an old ruler, or a succession that may well be contested, with an heir of an age to be named (lane N3: no infant is
    // offered by name, SEAT.heirMinAge; once a reign unless the law's heir has changed since: no "grows old" card every 20 years)
    if (!off(st, s, DecisionKind.Heir) && (year - R.rBorn[r] >= SEAT.oldAge || contestChance(s, ps, R, p) >= SEAT.heirContest)) {
      const people = ps.pPeople[p]
      const cog = R.cognatic[people] === 1
      const n = eligibleHeirs(R, p, year, HEIRS, cog)
      const law = n >= 1 ? pickHeir(R, p, R.law[people], cog, year) : -1
      const o = p * RULERS.heirs
      const lawBorn = law >= 0 ? R.hBorn[o + law] : -1
      // (the same reign again only when the heir the last card named as the law's has died since: no "grows old" every 20 years)
      let lastAlive = false
      for (let j = 0; j < R.hN[p]; j++) if (R.hBorn[o + j] === st.heirLaw && R.hDeath[o + j] > year) lastAlive = true
      if (law >= 0 && !(st.heirReign === r && (st.heirLaw === lawBorn || lastAlive))) {
        const named = (i: number) => year - R.hBorn[o + i] >= SEAT.heirMinAge
        let other = -1
        for (let j = 0; j < n; j++) {
          const i = HEIRS[j]
          if (i === law || R.hBorn[o + i] === lawBorn || !named(i)) continue
          if (other < 0 || R.hLegit[o + i] > R.hLegit[o + other] || (R.hLegit[o + i] === R.hLegit[o + other] && R.hBorn[o + i] < R.hBorn[o + other])) other = i
        }
        const opts: Option[] = []
        if (named(law)) opts.push({ key: SeatOptionKey.NameHeir, orders: [[OrderKind.Designate, p, lawBorn]] })
        if (other >= 0) opts.push({ key: SeatOptionKey.NameHeir, orders: [[OrderKind.Designate, p, R.hBorn[o + other]]] })
        opts.push({ key: SeatOptionKey.LawDecides, orders: [] })
        if (other >= 0) cards.push({ kind: DecisionKind.Heir, subject: r, place: cap, info: lawBorn, options: opts })
      }
    }
    // General: a throne in danger of a coup, at war or after a lost war
    if (!off(st, s, DecisionKind.General) && (ps.pWars[p] > 0 || year - R.lost[p] <= SEAT.generalLost) && overthrowHazard(s, ps, R, p) >= SEAT.riseX) {
      cards.push({ kind: DecisionKind.General, subject: r, place: cap, options: [
        { key: SeatOptionKey.Honour, orders: [[OrderKind.Placate, p, -1]] },
        { key: SeatOptionKey.Purge, orders: [[OrderKind.Purge, p, -1]] },
        { key: SeatOptionKey.Ignore, orders: [] },
      ] })
    }
    // Match: an heir of marrying age and a contacted neighbour's house to marry into (every 5 years)
    if (!off(st, s, DecisionKind.Match) && year % 5 === 0) {
      let young = false
      for (let j = 0; j < R.hN[p]; j++) { const i = p * RULERS.heirs + j, age = year - R.hBorn[i]; if (R.hDeath[i] > year && age >= SEAT.matchAge[0] && age <= SEAT.matchAge[1]) young = true }
      if (young) {
        let best = -1
        const dp = R.rDyn[r]
        for (let x = 0; x < ps.relA.length; x++) {
          const a = ps.relA[x], b = ps.relB[x]
          if (a !== p && b !== p) continue
          const q = a === p ? b : a
          if (ps.pEnded[q] >= 0 || ps.relEdges[x].length === 0 || ps.relWar[x] >= 0 || ps.relR[x] >= MARRIAGE.maxR || q >= R.pcap || R.cur[q] < 0 || R.union[q] >= 0) continue
          const dq = R.rDyn[R.cur[q]]
          if (dq < 0 || dq === dp || tied(R, p, q) || !contacted(s, ps, k, q)) continue
          if (best < 0 || ps.pPop[q] > ps.pPop[best]) best = q
        }
        if (best >= 0) cards.push({ kind: DecisionKind.Match, subject: best, place: ps.pCapital[best], options: [
          { key: SeatOptionKey.Arrange, orders: [[OrderKind.Marry, p, best]] },
          { key: SeatOptionKey.Decline, orders: [] },
        ] })
      }
    }
  }
  // Opening (lane N3, a lever for the Unify ambition): every 5 years, a contacted neighbour at peace with us that we overmatch at
  // the border (SEAT.openAdvState) even without turmoil; with Unify as the first ambition the card comes more often
  if (!offFor(st, s, DecisionKind.Opening) && year % 5 === 0 && ps.pWars[p] < WAR.maxWars) {
    let best = -1, ba = 0
    for (let x = 0; x < ps.relA.length; x++) {
      const a = ps.relA[x], b = ps.relB[x]
      if (a !== p && b !== p) continue
      const q = a === p ? b : a
      if (ps.pEnded[q] >= 0 || ps.relEdges[x].length === 0 || year < ps.relTruce[x] || bound(ps, p, q) || atWar(ps, p, q) || allied(ps, p, q) || !contacted(s, ps, k, q)) continue
      const adv = borderAdvantage(ps, p, q)
      if (adv >= SEAT.openAdvState && adv > ba) { ba = adv; best = q }
    }
    if (best >= 0) cards.push({ kind: DecisionKind.Opening, subject: best, place: ps.pCapital[best], info: 1, options: [
      { key: SeatOptionKey.Strike, orders: [[OrderKind.War, p, best]] },
      { key: SeatOptionKey.StayOut, orders: [] },
      ...(R !== null ? [{ key: SeatOptionKey.OfferMatch, orders: [[OrderKind.Marry, p, best] as O] }] : []),
    ] })
  }
  // AllianceSought: a rival at least our size threatens us and a contacted neighbour too, who is calm with us (every 5 years)
  if (!off(st, s, DecisionKind.AllianceSought) && year % 5 === 0) {
    let best = -1, foe = -1
    for (let x = 0; x < ps.relA.length; x++) {
      const a = ps.relA[x], b = ps.relB[x]
      if ((a !== p && b !== p) || ps.relR[x] < ALLIANCE.threat) continue
      const c = a === p ? b : a
      if (ps.pEnded[c] >= 0 || ps.pPop[c] < ps.pPop[p]) continue
      for (let y = 0; y < ps.relA.length; y++) {
        const u = ps.relA[y], v = ps.relB[y]
        if ((u !== c && v !== c) || ps.relR[y] < ALLIANCE.threat) continue
        const q = u === c ? v : u
        if (q === p || ps.pEnded[q] >= 0 || allied(ps, p, q) || atWar(ps, p, q) || relationOf(ps, p, q) >= ALLIANCE.calm || !contacted(s, ps, k, q)) continue
        if (best < 0 || ps.pPop[q] > ps.pPop[best]) { best = q; foe = c }
      }
    }
    if (best >= 0 && foe >= 0) cards.push({ kind: DecisionKind.AllianceSought, subject: best, place: ps.pCapital[best], options: [
      { key: SeatOptionKey.SeekAlly, orders: [[OrderKind.Ally, p, best]] },
      { key: SeatOptionKey.Decline, orders: [] },
    ] })
  }
  // Overlord: again every SEAT.overlordEvery years while a vassal or tributary (not of a personal union)
  const sub = ps.pSub[p]
  if (sub >= 0 && year - st.lastKind[DecisionKind.Overlord] >= SEAT.overlordEvery && !(R !== null && unionBond(R, sub))) {
    const o = overlordOf(ps, p)
    if (o >= 0 && year - ps.bStart[sub] >= 1) cards.push(overlordCard(s, ps, p, o))
  }
  // Credit (finance): the crown's need is pressing
  if (s.fin !== null && !off(st, s, DecisionKind.Credit) && finNeed(s, ps, p) >= SEAT.creditNeed) {
    cards.push({ kind: DecisionKind.Credit, subject: p, place: cap, options: [
      { key: SeatOptionKey.Borrow, orders: [[OrderKind.Borrow, p, -1]] },
      { key: SeatOptionKey.Levy, orders: [[OrderKind.Levy, p, -1]] },
      { key: SeatOptionKey.RepudiateDebts, orders: [[OrderKind.Repudiate, p, p]] },
      { key: SeatOptionKey.Retrench, orders: [] },
    ] })
  }
  // Betrayal (oaths): worn down in an ally's war, the realm could make its own peace
  if (ps.og !== null && ps.og.oaths && !off(st, s, DecisionKind.Betrayal) && ps.pExh[p] >= SEAT.betrayCase) {
    for (const w of ps.activeWars) {
      const q = ps.wDef[w]
      if (q === p || allyWar(ps, p, q) < 0 || !contacted(s, ps, k, q)) continue
      cards.push({ kind: DecisionKind.Betrayal, subject: q, place: ps.pCapital[q], options: [
        { key: SeatOptionKey.SeparatePeace, orders: [[OrderKind.Betray, p, q]] },
        { key: SeatOptionKey.StandBy, orders: [] },
      ] })
      break
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
    if (s.year - st.lastKind[c.kind] < coolOf(st, c.kind)) continue
    if (repeats(st, s.year, c)) continue // (lane N3: the same matter again within SEAT.repeatYears)
    if (URGENT.indexOf(c.kind) < 0 && s.year - st.lastCard < SEAT.minGap) continue
    if (URGENT.indexOf(c.kind) < 0 && s.defer !== null && figureheadOf(s, st.polity)) continue // (rulers: deference: the deciding body rules; only urgent matters reach the throne)
    const opts = feasible(s, c.options)
    if (opts.length < 2 || opts.every((o) => o.orders.length > 0) || opts.length > 8) continue
    seenKind.add(c.kind)
    record(s, st, s.year, c, opts)
    st.newRows++
  }
  if (st.newRows > 0) st.lastCard = s.year
}

/**
 * lane N3: the same matter again (same kind, subject and detail) within SEAT.repeatYears is not put to the player again (a
 * Crisis: within SEAT.crisisRepeat, same cause): "A crisis at court" four times in 30 years with the same words was the
 * evaluator's loop.
 */
function repeats(st: SeatState, year: number, c: Card): boolean {
  const span = c.kind === DecisionKind.Crisis ? SEAT.crisisRepeat : SEAT.repeatYears
  for (let d = st.dYear.length - 1; d >= 0 && year - st.dYear[d] <= span; d--) {
    if (st.dKind[d] !== c.kind || st.dSubject[d] !== c.subject) continue
    if (c.kind === DecisionKind.Crisis || c.kind === DecisionKind.Heir || (st.dInfo[d] ?? -1) === (c.info ?? -1)) return true
  }
  return false
}

function record(s: HistoryState, st: SeatState, year: number, c: Card, opts: Option[]): void {
  st.dYear.push(year); st.dKind.push(c.kind); st.dPolity.push(st.polity); st.dSubject.push(c.subject); st.dPlace.push(c.place)
  st.dInfo.push(c.info ?? -1)
  // lane N3: the HUD row and the heirs of the house now (what the dashboard and the card's stakes read)
  const at = st.hud.length
  for (let i = 0; i < HUD_N; i++) st.hud.push(NaN)
  hudRow(s, st.polity, st.hud, at)
  const R = s.rul, p = st.polity
  if (R !== null && p >= 0 && p < R.pcap) {
    for (let j = 0; j < R.hN[p]; j++) {
      const i = p * RP.heirs + j
      if (R.hDeath[i] <= year) continue // (alive now: the court knows who lives, not who will die)
      st.heirBorn.push(R.hBorn[i]); st.heirFlags.push((R.hFemale[i] ? 1 : 0) | (R.hLegit[i] ? 2 : 0) | (R.hChild[i] ? 4 : 0))
    }
  }
  st.heirStart.push(st.heirBorn.length)
  if (c.kind === DecisionKind.Heir && R !== null && p >= 0) { st.heirReign = R.cur[p]; st.heirLaw = c.info ?? -1 }
  // how divisive (the kind's, a little more with more roads to choose from), and a cautious court's pick (the least risky option)
  const div = DIVISIVE[c.kind] + (opts.length >= 3 ? 0.05 : 0)
  st.dDiv.push(div > 1 ? 1 : div)
  let pick = 0
  for (let i = 1; i < opts.length; i++) if ((OPTION_RISK[opts[i].key] ?? 0.5) < (OPTION_RISK[opts[pick].key] ?? 0.5)) pick = i
  st.dCourt.push(pick)
  st.lastKind[c.kind] = year
  for (const o of opts) {
    st.optKey.push(o.key)
    for (const [k, a, t] of o.orders) { st.orderKind.push(k); st.orderActor.push(a); st.orderTarget.push(t) }
    st.orderStart.push(st.orderKind.length)
  }
  st.optStart.push(st.optKey.length)
}

