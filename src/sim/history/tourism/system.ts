// tourism: sights, leisure travel and resort towns (HistoryOptions.tourism; 'history-tourism', 'history-tourism-springs').
//
// Sights (every SIGHT.step years): ruins of towns that were once large, old capitals, summits first reached, polar bases
// given up, mining boom towns gone quiet; later resorts gone out of fashion; and holy cities through the hook in hooks.ts.
// Each becomes a destination beside the scenic spots (scenery.ts).
// Leisure class (every TRAVEL.flowStep years): a share of a wealthy town's people travels for pleasure, gated by wealth per
// head and the Crafts of its people (none below the floors, so the first travel comes late), cut at home by war, unrest,
// an epidemic or hunger, and needing roads or a port; a kingdom's or empire's capital starts a little earlier but goes only
// near (villa coasts).
// Searches (staggered, every TRAVEL.searchAge years per source): the destinations within reach over cells its people knows,
// the best few kept with their ways. Flows: each source splits its travellers among them by appeal (scenery, fame, holy),
// contrast with home (warm coasts from cold towns, snow and heights from hot ones and from lowlands, cool places from fever
// ground), safety (danger along the way and there, pirates and bandits included; fever; an epidemic), fashion (the place's
// popularity with the same people, a small rich-get-richer term that decays) and vogue (a whim redrawn every
// TRAVEL.vogueStep years), and access (no travel into a state at war or under embargo with theirs, nor to an unmet people),
// falling with the cost of the way (cheaper with roads and Crafts).
// Resorts: a visited settlement gets the visitors' money (wealth from the home towns), and food bought with it supports
// more people (a resort quarter); a scenic place without a settlement that is wanted enough for two flow steps gets a
// resort town founded by its main source. A resort farms nothing (the food system's hook): its food comes by trade or is
// bought with visitor income; it is given up when its visitors fail for RESORT.grace years.
// Effects elsewhere (small hooks): wealth to scenic backwaters; road wear along the ways; luxury and finery demand where
// visitors are (trade.ts); sickness carried by visitors (disease/system.ts, DiseaseVia.Visitors).

import { EventType, JourneyKind, SightKind, TECH_FIELD_COUNT, TechField } from '../../../contract.ts'
import type { HistoryEvent } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import { Heap } from '../heap.ts'
import { MIGRATION, PORT } from '../params.ts'
import type { HistoryState } from '../state.ts'
import { abandon, canSettle, found, logEvent, logJourney } from '../state.ts'
import type { TradeState } from '../trade.ts'
import { tradeAbandonSystem } from '../trade.ts'
import type { ExploreState } from '../exploration.ts'
import { Place } from '../exploration.ts'
import { atWar } from '../polity/formation.ts'
import { embargoCode } from '../polity/policy.ts'
import { Tier, tierOf } from '../polity/state.ts'
import { LEISURE, RESORT, SIGHT, TRAVEL } from './params.ts'
import type { TourismState } from './state.ts'
import { addDestination, ensureTourism } from './state.ts'
import { tourismExtraScores } from './hooks.ts'

function logExtra(s: HistoryState, type: HistoryEvent['type'], settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

const HEAP = new Heap(4096)
let EXTRA = new Float64Array(0)
let CUR = new Float64Array(0)
let WANTFROM: number[] = []
let DL: number[] = []
let DSAFE: number[] = []
let DSAFEN: number[] = []
let DWAR: number[] = []
let MAINV = new Float64Array(0)

const alive = (s: HistoryState, id: number): boolean => id >= 0 && s.abandoned[id] < 0 && s.outpost[id] === 0

/** Polity of settlement id (-1 stateless or polities off). */
function polOf(s: HistoryState, id: number): number {
  const ps = s.pol
  return ps !== null && id < ps.polity.length ? ps.polity[id] : -1
}

// --- Sights ---------------------------------------------------------------------------------------------------------

/** A new sight (at its settlement's cell, if any); its fame goes to the destination its settlement hosts, else to one at its cell. */
function addSight(s: HistoryState, tz: TourismState, kind: number, cell: number, settlement: number, fame: number): void {
  const k = tz.sKind.length
  tz.sKind.push(kind); tz.sCell.push(cell); tz.sSettlement.push(settlement); tz.sFrom.push(s.year); tz.sFame.push(fame)
  if (settlement >= 0) tz.sighted[settlement] = 1
  logExtra(s, EventType.SightRecognised, nearestLiving(s, tz, cell, settlement), settlement, k, kind)
  const d = settlement >= 0 && alive(s, settlement) ? tz.hostOf[settlement] : -1
  if (d >= 0) { tz.dFame[d] += fame; if (tz.dFame[d] > 1.5) tz.dFame[d] = 1.5 }
  else addDestination(s.world, s.terrain, tz, cell, tz.scenery[cell] / 510, fame, kind)
}

/** The living settlement by a sight: its own, else the host of the destination at its cell, else the nearest (chord) living one. */
function nearestLiving(s: HistoryState, tz: TourismState, cell: number, own: number): number {
  if (own >= 0 && alive(s, own)) return own
  const d = tz.destAt[cell]
  if (d >= 0 && tz.dHost[d] >= 0 && alive(s, tz.dHost[d])) return tz.dHost[d]
  const P = s.world.grid.positions
  const x = P[cell * 3], y = P[cell * 3 + 1], z = P[cell * 3 + 2]
  let best = -1, bd = Infinity
  for (const id of s.living) {
    const c = s.cell[id]
    const dx = P[c * 3] - x, dy = P[c * 3 + 1] - y, dz = P[c * 3 + 2] - z
    const dd = dx * dx + dy * dy + dz * dz
    if (dd < bd) { bd = dd; best = id }
  }
  return best
}

/** Every SIGHT.step years: peaks, then new sights from events, discoveries and polities' capitals. */
function sightScan(s: HistoryState, tz: TourismState, es: ExploreState): void {
  const X = SIGHT
  for (const id of s.living) {
    const p = s.pop[id]
    if (p > tz.peak[id]) tz.peak[id] = p
    // A great town shrunk to a fraction of itself: the ruins of its old quarters around what is left.
    else if (tz.peak[id] >= X.ruinPop && p <= X.ruinFrac * tz.peak[id] && !tz.sighted[id]) addSight(s, tz, SightKind.Ruin, s.cell[id], id, 0.3 + 0.7 * smoothstep(X.ruinPop, 40000, tz.peak[id]))
  }
  const E = s.events
  const n = E.length
  for (let i = tz.evSeen; i < n; i++) {
    const e = E[i]
    const t = e.type
    if (t === EventType.Abandoned) {
      const id = e.settlement
      if (s.outpost[id] === 1) { if (s.world.temperature[s.cell[id]] < X.polarTemp && !tz.sighted[id]) addSight(s, tz, SightKind.PolarBase, s.cell[id], id, 0.45) }
      else if (tz.peak[id] >= X.ruinGone) tz.pendingRuins.push(id)
    } else if (t === EventType.Boom) tz.boomed[e.settlement] = 1
    else if (t === EventType.MineExhausted) {
      const id = e.settlement
      if (id >= 0 && tz.boomed[id] && !tz.sighted[id]) addSight(s, tz, SightKind.MineTown, s.cell[id], id, 0.35)
    }
  }
  tz.evSeen = s.events.length
  // Ruins, ruinAfter years after the town was given up.
  const pr = tz.pendingRuins
  let w = 0
  for (let k = 0; k < pr.length; k++) {
    const id = pr[k]
    if (s.year - s.abandoned[id] >= X.ruinAfter) { if (!tz.sighted[id]) addSight(s, tz, SightKind.Ruin, s.cell[id], id, 0.2 + 0.8 * smoothstep(X.ruinGone, 40000, tz.peak[id])); continue }
    pr[w++] = id
  }
  pr.length = w
  // Summits first reached.
  for (let k = tz.discSeen; k < es.discKind.length; k++) if (es.discKind[k] === Place.Summit) addSight(s, tz, SightKind.Summit, es.discCell[k], -1, 0.45)
  tz.discSeen = es.discKind.length
  // Old capitals: held capitalYears or more, no longer the capital.
  const ps = s.pol
  if (ps !== null) {
    for (let p = 0; p < ps.pCapIds.length; p++) {
      const ids = ps.pCapIds[p], ys = ps.pCapYears[p]
      const ended = ps.pEnded[p] >= 0
      for (let k = 0; k < ids.length; k++) {
        const c = ids[k]
        if (c < 0 || c >= tz.seen || tz.sighted[c]) continue
        const last = k === ids.length - 1
        if (last && !ended) continue
        const held = (last ? ps.pEnded[p] : ys[k + 1]) - ys[k]
        if (held < X.capitalYears || tz.peak[c] < X.capitalPop) continue
        const walls = c < ps.walls.length && ps.walls[c] >= 2 ? 0.15 : 0
        addSight(s, tz, SightKind.OldCapital, s.cell[c], c, 0.25 + 0.25 * smoothstep(X.capitalYears, 400, held) + 0.3 * smoothstep(X.capitalPop, 30000, tz.peak[c]) + walls)
      }
    }
  }
}

// --- Destinations ---------------------------------------------------------------------------------------------------

/** The host of destination d: a living settlement within hostHops of its cell (the largest), or -1. */
function findHost(s: HistoryState, tz: TourismState, d: number): number {
  const c = tz.dCell[d]
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const run = ++tz.run
  const mark = tz.mark
  let best = -1
  const q = [c], dq = [0]
  mark[c] = run
  for (let h = 0; h < q.length; h++) {
    const x = q[h]
    const o = s.occupant[x]
    if (o >= 0 && alive(s, o) && s.pop[o] >= RESORT.hostPop && (tz.hostOf[o] < 0 || tz.hostOf[o] === d) && (best < 0 || s.pop[o] > s.pop[best] || (s.pop[o] === s.pop[best] && o < best))) best = o
    if (dq[h] >= RESORT.hostHops) continue
    for (let k = off[x]; k < off[x + 1]; k++) { const j = nb[k]; if (mark[j] !== run) { mark[j] = run; q.push(j); dq.push(dq[h] + 1) } }
  }
  return best
}

/** Destination d's host becomes h (-1 none); a new host starts its own spell of fashion (a lost host's ends without an event). */
function setHost(tz: TourismState, d: number, h: number): void {
  const old = tz.dHost[d]
  if (old === h) return
  if (old >= 0 && tz.hostOf[old] === d) tz.hostOf[old] = -1
  tz.dHost[d] = h
  if (h >= 0) tz.hostOf[h] = d
  if (old >= 0) { tz.dFashion[d] = 0; tz.dSince[d] = -1; tz.dPeak[d] = 0; tz.dPeakL[d] = 0; tz.dVisSm[d] = 0; if (tz.dDeclined[d] >= 0 || h >= 0) tz.dDeclined[d] = -1 }
}

/** Every destStep years: hosts, holy cities (hook), vogue. */
function refreshDestinations(s: HistoryState, tz: TourismState): void {
  // Holy cities and other extra scores (hooks.ts: the religion system's holy cities, by their pilgrims).
  if (EXTRA.length < s.count) EXTRA = new Float64Array(2 * s.count)
  EXTRA.fill(0, 0, s.count)
  if (tourismExtraScores(s, EXTRA)) {
    for (let d = 0; d < tz.dCount; d++) tz.dExtra[d] = 0
    for (const id of s.living) {
      const x = EXTRA[id]
      if (!(x >= SIGHT.holyMin)) continue
      let d = tz.hostOf[id]
      if (d < 0) {
        if (!tz.sighted[id]) addSight(s, tz, SightKind.Holy, s.cell[id], id, 0)
        d = tz.destAt[s.cell[id]]
        if (d >= 0 && tz.dHost[d] < 0) setHost(tz, d, id)
      }
      if (d >= 0) tz.dExtra[d] = x
    }
  }
  for (let d = 0; d < tz.dCount; d++) {
    const h = tz.dHost[d]
    if (h >= 0 && alive(s, h)) continue
    setHost(tz, d, findHost(s, tz, d))
  }
}

// --- Leisure class and searches -------------------------------------------------------------------------------------

/** Leisure travellers a year from settlement id now (0 below the floors); sets ELITE when only the capital's elite travel (near). */
let ELITE = false
function leisureOf(s: HistoryState, tz: TourismState, id: number): number {
  const X = LEISURE
  ELITE = false
  const pop = s.pop[id]
  if (pop < X.minPop || tz.resort[id]) return 0
  const crafts = s.tech[s.people[id] * TECH_FIELD_COUNT + TechField.Crafts]
  const ps = s.pol
  const pz = polOf(s, id)
  let ease = 0
  if (ps !== null && pz >= 0 && ps.pCapital[pz] === id && crafts > X.cLo - X.capitalEase && tierOf(ps.pPop[pz], ps.pMembers[pz], ps.pMulti[pz] === 1, ps.worldPop) >= Tier.Kingdom) ease = X.capitalEase
  const cg = smoothstep(X.cLo - ease, X.cHi, crafts)
  if (cg <= 0) return 0
  const wg = smoothstep(X.wLo, X.wHi, s.wealth[id] / pop)
  if (wg <= 0) return 0
  let home = s.food[id]
  if (ps !== null && pz >= 0) {
    if (ps.pWars[pz] > 0) home *= X.warMul
    const u = ps.unrest[id]
    home *= u > 1 ? 0 : 1 - u
  }
  const dz = s.dz
  if (dz !== null && id < dz.act.length && dz.act[id] !== 0) home *= X.epidemicMul
  const road = s.road[s.cell[id]]
  const ac = s.port[id] >= 0 ? 1 : road
  const access = X.roadMin + (1 - X.roadMin) * ac
  ELITE = ease > 0 && crafts < X.cLo
  return X.rate * pop * cg * wg * home * access
}

/** Searches from source i's town for destinations within reach over known cells; keeps the best TRAVEL.keep with their ways. */
function search(s: HistoryState, tz: TourismState, i: number): void {
  const X = TRAVEL
  const id = tz.srcIds[i]
  const T = s.terrain
  const N = tz.N
  const p = s.people[id]
  const o = p * TECH_FIELD_COUNT
  const speed = 1 + X.budgetTech * (s.tech[o + TechField.Crafts] - 1)
  const budget = X.budget * speed
  const hasPort = s.port[id] >= 0
  const ocean = (MIGRATION.oceanCost * T.cellScale) / Math.sqrt(s.tech[o + TechField.Seafaring]) * (hasPort ? PORT.oceanMul : MIGRATION.seaNoPort)
  const seaMul = hasPort ? PORT.seaMul : MIGRATION.seaNoPort
  const known = s.know.known
  const kb = p * N
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const { deep, sea } = T
  const seaCost = T.moveCost, moveCost = s.moveCost
  const dist = tz.dist, prev = tz.prev, mark = tz.mark
  const run = ++tz.run
  const start = s.cell[id]
  const heap = HEAP
  heap.size = 0
  dist[start] = 0; prev[start] = -1; mark[start] = run
  heap.push(0, start)
  const foundD: number[] = [], foundC: number[] = [], foundCell: number[] = []
  let visits = 0
  const destAt = tz.destAt
  while (heap.size > 0) {
    const dc = heap.topKey()
    const x = heap.pop()
    if (dc > dist[x]) continue
    if (++visits > X.maxVisits) break
    const d = destAt[x]
    if (d >= 0 && tz.dHost[d] !== id) { foundD.push(d); foundC.push(dc / speed); foundCell.push(x) }
    for (let k = off[x]; k < off[x + 1]; k++) {
      const j = nb[k]
      if (known[kb + j] < 0) continue
      const nd = dc + (deep[j] ? ocean : sea[j] ? seaCost[j] * seaMul : moveCost[j])
      if (nd > budget) continue
      if (mark[j] !== run) { mark[j] = run; dist[j] = nd; prev[j] = x; heap.push(nd, j) }
      else if (nd < dist[j]) { dist[j] = nd; prev[j] = x; heap.push(nd, j) }
    }
  }
  tz.diag.searches++
  tz.diag.visits += visits
  // The best few by static score.
  const order: number[] = []
  const score: number[] = []
  for (let k = 0; k < foundD.length; k++) {
    const d = foundD[k]
    const r = foundC[k] / X.costHalf
    score.push((tz.dScenic[d] + tz.dFame[d] + tz.dExtra[d] + 0.05) * contrast(s, tz, id, d) / (1 + r * r))
    order.push(k)
  }
  order.sort((a, b) => score[b] - score[a] || foundD[a] - foundD[b])
  const opt: number[] = [], cost: number[] = [], paths: number[][] = [], lands: number[][] = []
  for (let t = 0; t < order.length && t < X.keep; t++) {
    const k = order[t]
    opt.push(foundD[k])
    cost.push(foundC[k])
    const path: number[] = []
    for (let c = foundCell[k]; c >= 0; c = prev[c]) path.push(c)
    path.reverse()
    paths.push(path)
    const land: number[] = []
    for (let t = 1; t < path.length; t++) if (!sea[path[t]]) land.push(path[t])
    lands.push(land)
  }
  tz.srcOpt[i] = opt
  tz.srcCost[i] = cost
  tz.srcPath[i] = paths
  tz.srcLand[i] = lands
  tz.srcCraft[i] = s.tech[o + TechField.Crafts]
  tz.srcYear[i] = s.year
}

/** Contrast of destination d with the home of settlement id: warm coasts from cold towns, snow and heights from hot ones and lowlands, cool places from fever ground. */
function contrast(s: HistoryState, tz: TourismState, id: number, d: number): number {
  const X = TRAVEL
  const c = s.cell[id]
  const th = s.world.temperature[c], td = tz.dTemp[d]
  let m = 1
  if (tz.dCoast[d] && td > th) m *= 1 + X.warmPull * (td - th)
  if ((tz.dSnow[d] || tz.dHigh[d]) && th > td) m *= 1 + X.coolPull * (th - td)
  if (tz.dHigh[d] && s.world.elevation[c] < 0.1) m *= 1 + X.highPull
  if (tz.dPleasant[d]) m *= 1 + X.pleasantPull
  const dz = s.dz
  if (dz !== null) {
    const fh = dz.fever[c]
    if (fh > 0 && dz.fever[tz.dCell[d]] < 0.5 * fh && td < th) m *= 1 + X.feverEscape * fh * (1 - dz.tol[s.people[id]])
  }
  return m
}

// --- Flows ----------------------------------------------------------------------------------------------------------

function pairOf(s: HistoryState, tz: TourismState, from: number, to: number, path: number[]): number {
  const key = from * 1048576 + to
  const k = tz.pIndex.get(key)
  if (k !== undefined) return k
  const n = tz.pFrom.length
  tz.pIndex.set(key, n)
  tz.pFrom.push(from); tz.pTo.push(to); tz.pFirst.push(s.year)
  tz.pPath.push(extendTo(s, path, s.cell[to]))
  return n
}

/** The path continued from its last cell to `cell` (a few hops, breadth first). */
function extendTo(s: HistoryState, path: readonly number[], cell: number): number[] {
  const last = path[path.length - 1]
  if (last === cell) return path.slice()
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const q = [last], prev = [-1]
  const seen = new Set<number>([last]) // (membership only)
  let at = -1
  for (let i = 0; i < q.length && i < 400; i++) {
    if (q[i] === cell) { at = i; break }
    for (let k = off[q[i]]; k < off[q[i] + 1]; k++) { const j = nb[k]; if (!seen.has(j)) { seen.add(j); q.push(j); prev.push(i) } }
  }
  const tail: number[] = []
  for (let i = at; i > 0; i = prev[i]) tail.push(q[i])
  tail.reverse()
  return path.concat(tail)
}

/** Every flowStep years: leisure classes, searches, the split of travellers, fashion, resorts founded, events. */
function flowStep(s: HistoryState, tz: TourismState): void {
  const X = TRAVEL
  const P = tz.P
  // Leisure class of every town; the largest maxSources keep a source entry.
  const cand: number[] = [], candL: number[] = [], elite: number[] = []
  for (const id of s.living) {
    const L = leisureOf(s, tz, id)
    if (L > 0.5) { cand.push(id); candL.push(L); elite.push(ELITE ? 1 : 0) }
  }
  const ord = cand.map((_, k) => k).sort((a, b) => candL[b] - candL[a] || cand[a] - cand[b])
  // Old sources: zero leisure unless listed again; abandoned ones dropped.
  for (let i = 0; i < tz.srcIds.length; i++) tz.srcL[i] = 0
  const isElite: number[] = new Array<number>(tz.srcIds.length).fill(0)
  for (let t = 0; t < ord.length && t < LEISURE.maxSources; t++) {
    const k = ord[t]
    const id = cand[k]
    let i = tz.srcOf[id]
    if (i < 0) {
      i = tz.srcIds.length
      tz.srcIds.push(id); tz.srcYear.push(-1000000); tz.srcOpt.push([]); tz.srcCost.push([]); tz.srcPath.push([]); tz.srcLand.push([]); tz.srcCraft.push(0); tz.srcL.push(0); tz.srcLsm.push(0)
      isElite.push(0)
      tz.srcOf[id] = i
    }
    tz.srcL[i] = candL[k]
    isElite[i] = elite[k]
  }
  for (let i = 0; i < tz.srcIds.length; i++) {
    const x = tz.srcLsm[i] + LEISURE.smooth * (tz.srcL[i] - tz.srcLsm[i])
    tz.srcLsm[i] = x < 0.25 ? 0 : x
  }
  // Searches: never searched first (largest leisure first), then the stalest; at most searchesPerYear * flowStep.
  {
    const due: number[] = []
    for (let i = 0; i < tz.srcIds.length; i++) {
      const id = tz.srcIds[i]
      if (!(tz.srcLsm[i] > 0) || !alive(s, id)) continue
      const age = s.year - tz.srcYear[i]
      if (age >= X.searchMax || (age >= X.searchAge && s.tech[s.people[id] * TECH_FIELD_COUNT + TechField.Crafts] - tz.srcCraft[i] >= X.searchCrafts)) due.push(i)
    }
    due.sort((a, b) => tz.srcYear[a] - tz.srcYear[b] || tz.srcLsm[b] - tz.srcLsm[a] || a - b)
    const cap = X.searchesPerYear * X.flowStep
    for (let t = 0; t < due.length && t < cap; t++) search(s, tz, due[t])
  }
  // Last step's visitors cleared.
  for (let f = 0; f < tz.fTo.length; f++) { tz.visitors[tz.fTo[f]] = 0; tz.mainOf[tz.fTo[f]] = -1 }
  if (MAINV.length < tz.cap) MAINV = new Float64Array(tz.cap)
  tz.fFrom.length = 0; tz.fTo.length = 0; tz.fVis.length = 0; tz.fSpend.length = 0; tz.fPair.length = 0
  const D = tz.dCount
  if (CUR.length < D * P) CUR = new Float64Array(2 * D * P)
  CUR.fill(0, 0, D * P)
  WANTFROM = new Array<number>(D).fill(-1)
  const wantBest: number[] = new Array<number>(D).fill(0)
  DL = new Array<number>(D).fill(0)
  DSAFE = new Array<number>(D).fill(0)
  DSAFEN = new Array<number>(D).fill(0)
  DWAR = new Array<number>(D).fill(0)
  for (let d = 0; d < D; d++) { tz.dVis[d] = 0; tz.dWant[d] = 0 }
  const ps = s.pol, dz = s.dz
  const U: number[] = []
  for (let i = 0; i < tz.srcIds.length; i++) {
    const L = tz.srcLsm[i]
    const id = tz.srcIds[i]
    if (!(L > 0) || !alive(s, id)) continue
    const opt = tz.srcOpt[i], cost = tz.srcCost[i], paths = tz.srcPath[i]
    const p = s.people[id]
    const pz = polOf(s, id)
    const wph = s.wealth[id] / s.pop[id]
    let per = X.spend * wph
    if (per > X.spendCap) per = X.spendCap
    U.length = 0
    let sum = 0
    for (let k = 0; k < opt.length; k++) {
      const d = opt[k]
      let u = 0
      const h = tz.dHost[d]
      const hostOk = h >= 0 && alive(s, h) && h !== id
      const r = cost[k] / X.costHalf
      if (isElite[i] && cost[k] > X.costHalf * LEISURE.capitalReach * 2) { U.push(0); continue }
      DL[d] += L
      if (ps !== null && pz >= 0 && ps.pWars[pz] > 0) DWAR[d] += L
      // Access: an unmet people's town, a state at war or under embargo with theirs.
      let ok = true
      if (hostOk) {
        if (s.know.contact[p * s.know.P + s.people[h]] < 0) ok = false
        else if (s.know.known[p * tz.N + s.cell[h]] < 0) ok = false
        else if (ps !== null && pz >= 0) {
          const q = polOf(s, h)
          if (q >= 0 && q !== pz && (atWar(ps, pz, q) || embargoCode(ps, pz, q) !== 0)) ok = false
        }
      }
      if (ok) {
        // Safety: the worst danger on the way and there.
        let z = 0
        if (ps !== null) {
          const land = tz.srcLand[i][k]
          const cz = ps.cellZ
          for (let t = 0; t < land.length; t++) { const v = cz[land[t]]; if (v > z) z = v }
          if (hostOk && h < ps.danger.length && ps.danger[h] > z) z = ps.danger[h]
        }
        let safe = 1 - smoothstep(X.safeLo, X.safeHi, z)
        if (dz !== null) {
          const f = dz.fever[tz.dCell[d]]
          if (f > 0) safe *= 1 - X.feverAvoid * f * (1 - dz.tol[p])
          if (hostOk && h < dz.act.length && dz.act[h] !== 0) safe *= X.epidemicMul
        }
        DSAFE[d] += safe; DSAFEN[d]++
        const v = tz.dPV[d * P + p] + X.fameShare * tz.dVisSm[d]
        const fashion = 1 + X.fashion * v / (v + X.fashionHalf)
        u = (tz.dScenic[d] + tz.dFame[d] + tz.dExtra[d] + 0.05) * contrast(s, tz, id, d) * safe * fashion * tz.dVogue[d] / (1 + r * r)
      }
      U.push(u)
      sum += u
    }
    if (!(sum > 0)) continue
    const scale = L / (X.home + sum)
    for (let k = 0; k < opt.length; k++) {
      const V = U[k] * scale
      if (!(V > 0)) continue
      const d = opt[k]
      const h = tz.dHost[d]
      if (h >= 0 && alive(s, h) && h !== id) {
        if (V < X.minFlow) continue
        const pr = pairOf(s, tz, id, h, paths[k])
        // (two places with the same host merge into one pair)
        let f = -1
        for (let t = tz.fFrom.length - 1; t >= 0 && tz.fFrom[t] === id; t--) if (tz.fPair[t] === pr) { f = t; break }
        if (f < 0) { f = tz.fFrom.length; tz.fFrom.push(id); tz.fTo.push(h); tz.fVis.push(0); tz.fSpend.push(0); tz.fPair.push(pr) }
        tz.fVis[f] += V
        tz.fSpend[f] += V * per
        tz.visitors[h] += V
        tz.dVis[d] += V
        CUR[d * P + p] += V
        if (!tz.peopleStarted[p]) { tz.peopleStarted[p] = 1; logEvent(s, EventType.LeisureTravel, id, h, p) }
      } else if (h < 0 || !alive(s, h)) {
        tz.dWant[d] += V
        if (V > wantBest[d]) { wantBest[d] = V; WANTFROM[d] = i }
      }
    }
  }
  for (let f = 0; f < tz.fTo.length; f++) { const h = tz.fTo[f]; const m = tz.mainOf[h]; if (m < 0 || tz.fVis[f] > MAINV[h]) { tz.mainOf[h] = tz.fFrom[f]; MAINV[h] = tz.fVis[f] } }
  for (let d = 0; d < D; d++) tz.dVisSm[d] += RESORT.visSmooth * (tz.dVis[d] - tz.dVisSm[d])
  // Fashion: smoothed visitors per place and people.
  for (let x = 0; x < D * P; x++) {
    const c = CUR[x], v = tz.dPV[x]
    if (c === 0 && v === 0) continue
    tz.dPV[x] = v + (c > v ? X.fashionUp : X.fashionDown) * (c - v)
    if (tz.dPV[x] < 1e-3) tz.dPV[x] = 0
  }
  // Resorts founded where a place without a settlement is wanted enough; fashion and decline.
  for (let d = 0; d < D; d++) {
    const h = tz.dHost[d]
    if (h < 0 || !alive(s, h)) {
      if (tz.dWant[d] >= RESORT.foundVisitors) tz.dWantSteps[d]++
      else tz.dWantSteps[d] = 0
      if (tz.dWantSteps[d] >= RESORT.foundSteps && WANTFROM[d] >= 0) foundResort(s, tz, d, WANTFROM[d])
      continue
    }
    fashionOf(s, tz, d)
  }
}

/** Main source (most visitors) of the settlement h at the last flow step, or -1. */
function mainSource(tz: TourismState, h: number): number {
  return h < tz.cap ? tz.mainOf[h] : -1
}

/** Fashion events of destination d (with a living host), on its smoothed visitors. */
function fashionOf(s: HistoryState, tz: TourismState, d: number): void {
  const X = RESORT
  const h = tz.dHost[d]
  const V = tz.dVisSm[d]
  if (V > tz.dBest[d]) tz.dBest[d] = V
  if (!tz.dFashion[d]) {
    const back = tz.dDeclined[d] < 0 || (s.year - tz.dDeclined[d] >= X.backYears && V >= X.backFrac * tz.dPeak[d])
    if (V >= X.fashionOn && back) {
      tz.dFashion[d] = 1
      tz.dPeak[d] = V
      tz.dPeakL[d] = DL[d]
      tz.dSince[d] = s.year
      logEvent(s, EventType.ResortInFashion, h, mainSource(tz, h), V)
    }
    return
  }
  if (V > tz.dPeak[d]) { tz.dPeak[d] = V; tz.dPeakL[d] = DL[d] }
  if (V >= X.declineFrac * tz.dPeak[d] || s.year - tz.dSince[d] < X.minFashionYears) return
  // Declined: why (an epidemic there; war there, at the main home towns, or danger on the way; the home towns' decline; else fashion).
  let cause = 0
  const dz = s.dz, ps = s.pol
  const safe = DSAFEN[d] > 0 ? DSAFE[d] / DSAFEN[d] : 1
  const pz = polOf(s, h)
  if (dz !== null && h < dz.act.length && (dz.act[h] !== 0 || dz.actEnd[h] >= s.year - 15)) cause = 2
  else if ((ps !== null && pz >= 0 && ps.pWars[pz] > 0) || safe < 0.5 || DWAR[d] > 0.5 * DL[d]) cause = 1
  else if (DL[d] < 0.5 * tz.dPeakL[d]) cause = 3
  tz.dFashion[d] = 0
  tz.dDeclined[d] = s.year
  logExtra(s, EventType.ResortDeclined, h, -1, V, cause)
}

/** A resort town for destination d, founded by source i's town at the best free cell by the place. */
function foundResort(s: HistoryState, tz: TourismState, d: number, i: number): void {
  const X = RESORT
  const src = tz.srcIds[i]
  if (!alive(s, src)) return
  const c = tz.dCell[d]
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const run = ++tz.run
  const mark = tz.mark
  let site = -1
  const q = [c], dq = [0]
  mark[c] = run
  const p = s.people[src]
  for (let h = 0; h < q.length; h++) {
    const x = q[h]
    if (canSettle(s, x) && s.know.known[p * tz.N + x] >= 0 && (site < 0 || tz.scenery[x] > tz.scenery[site] || (tz.scenery[x] === tz.scenery[site] && x < site))) site = x
    if (dq[h] >= X.siteHops) continue
    for (let k = off[x]; k < off[x + 1]; k++) { const j = nb[k]; if (mark[j] !== run) { mark[j] = run; q.push(j); dq.push(dq[h] + 1) } }
  }
  if (site < 0) { tz.dWantSteps[d] = 0; return }
  let n = Math.floor(X.foundShare * s.pop[src])
  if (n > X.foundPop) n = X.foundPop
  if (n < 20) return
  const k = tz.srcOpt[i].indexOf(d)
  const path = k >= 0 ? extendTo(s, tz.srcPath[i][k], site) : [s.cell[src], site]
  s.pop[src] -= n
  const id = found(s, site, n, src)
  ensureTourism(tz, s.count)
  tz.resort[id] = 1
  tz.anyResort = true
  tz.lastGood[id] = s.year
  tz.incomeSm[id] = 0
  tz.hostList.push(id)
  setHost(tz, d, id)
  tz.dWantSteps[d] = 0
  logJourney(s, { departYear: Math.max(s.founded[src], s.year - 0.5), arriveYear: s.year, from: src, to: id, size: n, kind: JourneyKind.Settlers, path })
  logExtra(s, EventType.ResortFounded, id, src, tz.dWant[d], tz.dKind[d])
  if (!tz.peopleStarted[p]) { tz.peopleStarted[p] = 1; logEvent(s, EventType.LeisureTravel, src, id, p) }
}

// --- Yearly ---------------------------------------------------------------------------------------------------------

/** Yearly: visitors spend (wealth from home towns to the places they visit); smoothed income; resorts that failed given up (their routes close the same year). */
function spending(s: HistoryState, tz: TourismState, ts: TradeState): void {
  const X = TRAVEL
  let total = 0
  const F = tz.fFrom.length
  for (let a = 0; a < F;) {
    const src = tz.fFrom[a]
    let b = a, want = 0
    while (b < F && tz.fFrom[b] === src) { want += tz.fSpend[b]; b++ }
    if (alive(s, src) && want > 0) {
      const cap = X.spendMax * s.wealth[src]
      const k = want > cap ? cap / want : 1
      for (let f = a; f < b; f++) {
        const h = tz.fTo[f]
        if (!alive(s, h)) continue
        const x = tz.fSpend[f] * k
        s.wealth[src] -= x
        s.wealth[h] += x
        if (!(x > 0)) continue
        if (tz.incomeSm[h] === 0 && tz.income[h] === 0 && !tz.resort[h]) tz.hostList.push(h)
        tz.income[h] += x
        total += x
      }
    }
    a = b
  }
  const dec = (s.year / 10) | 0
  while (tz.diag.spendDecade.length <= dec) tz.diag.spendDecade.push(0)
  tz.diag.spendDecade[dec] += total
  // Smoothed income per host; resorts without visitors given up after the grace years.
  const L = tz.hostList
  let w = 0
  for (let t = 0; t < L.length; t++) {
    const h = L[t]
    const inc = tz.incomeSm[h] + RESORT.incSmooth * (tz.income[h] - tz.incomeSm[h])
    tz.income[h] = 0
    tz.incomeSm[h] = inc
    if (s.abandoned[h] >= 0) { tz.incomeSm[h] = 0; continue }
    if (tz.resort[h]) {
      if (inc >= RESORT.minIncome) tz.lastGood[h] = s.year
      else if (s.year - tz.lastGood[h] >= RESORT.grace) {
        logEvent(s, EventType.ResortAbandoned, h, -1, s.year - tz.lastGood[h])
        const idx = s.living.indexOf(h)
        abandon(s, h)
        if (idx >= 0) s.living.splice(idx, 1)
        tradeAbandonSystem(s, ts)
        tz.incomeSm[h] = 0
        continue
      }
    } else if (inc < 0.01) { tz.incomeSm[h] = 0; continue }
    L[w++] = h
  }
  L.length = w
}

/** System (yearly, after the goods system): sights, destinations, flows, spending, resorts. */
export function tourismYear(s: HistoryState, tz: TourismState, ts: TradeState, es: ExploreState): void {
  ensureTourism(tz, s.count)
  const year = s.year
  if (year % SIGHT.step === 0) sightScan(s, tz, es)
  if (year % TRAVEL.vogueStep === 0) for (let d = 0; d < tz.dCount; d++) tz.dVogue[d] = tz.rng.range(TRAVEL.vogueLo, TRAVEL.vogueHi)
  if (year % TRAVEL.destStep === 0) refreshDestinations(s, tz)
  if (year % TRAVEL.flowStep === 0) flowStep(s, tz)
  if (tz.fFrom.length > 0 || tz.hostList.length > 0) spending(s, tz, ts)
  // Places long out of fashion become quaint sights.
  if (year % SIGHT.step === 0) {
    for (let d = 0; d < tz.dCount; d++) {
      if (tz.dQuaint[d] || tz.dFashion[d] || tz.dDeclined[d] < 0 || year - tz.dDeclined[d] < RESORT.quaintYears || tz.dVisSm[d] > RESORT.quaintFrac * tz.dBest[d]) continue
      tz.dQuaint[d] = 1
      const h = tz.dHost[d]
      const ok = h >= 0 && alive(s, h)
      if (ok && tz.sighted[h]) continue // (an old capital or other sight already)
      addSight(s, tz, SightKind.FormerResort, ok ? s.cell[h] : tz.dCell[d], ok ? h : -1, 0.25)
    }
  }
}

/**
 * Yearly between the market and the population system: visitor income buys food for resorts. A resort's people are fed by
 * trade, or with food bought with it, up to income / perHead, and leave slowly (food held at keepMin of them) when it falls
 * short. Resorts short of hands draw staff from the town most of their visitors come from. (An older town hosting visitors
 * grows on their money through its wealth, as any rich town does.)
 */
export function tourismProvision(s: HistoryState, tz: TourismState): void {
  const X = RESORT
  const L = tz.hostList
  for (let t = 0; t < L.length; t++) {
    const h = L[t]
    if (s.abandoned[h] >= 0) continue
    const K = tz.incomeSm[h] / X.perHead
    const pop = s.pop[h]
    if (tz.resort[h]) {
      // (fed up to income / perHead, with room to grow by a tenth; held at keepMin while income falls short)
      const low = X.keepMin * pop
      const top = K < 1.1 * pop ? K : 1.1 * pop
      const want = top > low ? top : low
      const need = want - s.supply[h]
      const src = mainSource(tz, h)
      if (need > 0) {
        let cost = need * X.foodPrice
        if (cost > s.wealth[h]) cost = s.wealth[h] > 0 ? s.wealth[h] : 0
        s.wealth[h] -= cost
        s.supply[h] += need
        // (bought from the town most visitors come from: its food, paid for)
        if (src >= 0 && alive(s, src)) {
          let x = need
          if (x > 0.05 * s.supply[src]) x = 0.05 * s.supply[src]
          s.supply[src] -= x
          s.wealth[src] += cost
          s.food[src] = s.supply[src] >= s.pop[src] ? 1 : s.supply[src] / s.pop[src]
        }
      }
      // Staff from the main source (silently: hands for the inns and lodges).
      if (K > pop * 1.05) {
        if (src >= 0 && alive(s, src) && s.pop[src] > 2000) {
          let n = 0.06 * (K - pop)
          if (n > 0.01 * s.pop[src]) n = 0.01 * s.pop[src]
          s.pop[src] -= n
          s.pop[h] += n
        }
      }
      s.food[h] = s.supply[h] >= s.pop[h] ? 1 : s.supply[h] / s.pop[h]
    }
  }
}

/** Every ROAD.step years before the road system: visitors wear the land cells of their ways (as trade loads do). */
export function tourismRoads(s: HistoryState, tz: TourismState, ts: TradeState): void {
  const T = s.terrain
  const lake = s.world.lake
  const { traffic, isRoad, roadCells } = ts
  let count = ts.roadCount
  for (let f = 0; f < tz.fFrom.length; f++) {
    if (!alive(s, tz.fFrom[f]) || !alive(s, tz.fTo[f])) continue
    const per = tz.fVis[f] * TRAVEL.roadW
    const path = tz.pPath[tz.fPair[f]]
    for (let k = 0; k < path.length; k++) {
      const c = path[k]
      if (T.sea[c] || lake[c]) continue
      traffic[c] += per
      if (!isRoad[c]) { isRoad[c] = 1; roadCells[count++] = c }
    }
  }
  ts.roadCount = count
}

/** Trade (each trader, each year): visitors raise the demand for luxuries, finery and wares where they stay. */
export function tourismDemand(tz: TourismState, id: number, pop: number, demand: Float64Array, o: number): void {
  const v = tz.visitors[id]
  if (!(v > 0) || !(pop > 0)) return
  let m = 1 + TRAVEL.luxury * v / pop
  if (m > TRAVEL.luxuryMax) m = TRAVEL.luxuryMax
  demand[o + 7] *= m
  demand[o + 10] *= m
  demand[o + 12] *= m
}

/** Trade snapshot q: a row per pair with visitors now (sorted by pair). */
export function tourismSnapshot(s: HistoryState, tz: TourismState, q: number): void {
  const F = tz.fFrom.length
  if (F === 0) return
  const idx: number[] = []
  for (let f = 0; f < F; f++) if (alive(s, tz.fFrom[f]) && alive(s, tz.fTo[f])) idx.push(f)
  idx.sort((a, b) => tz.fPair[a] - tz.fPair[b])
  for (const f of idx) { tz.rSnap.push(q); tz.rPair.push(tz.fPair[f]); tz.rVis.push(tz.fVis[f]); tz.rSpend.push(tz.fSpend[f]) }
}
