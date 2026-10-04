// goods: the drive to open routes (design 4): rumour, the route-seeking urge, trade expeditions, lanes, trading posts,
// and the decline of bypassed marts.
//
// Every 10 years (year % 10 = 7): a mart's people hears of the varieties in its marts' stocks (rumour: where they come
// from, not the way there). A mart that sells a rumoured good dear, while its source sells it cheap far away, builds an
// urge to go there directly (the value a direct way would save each year, against what it is worth, with prosperity and
// technology); when it is full and the mart (or its kingdom's capital) can pay, a trade expedition sets out: the search of
// exploration.ts, 1.5 times as far, for the cells near the source or near a mart that holds the good. If it is not lost,
// a lane opens between the home mart and the far end (DirectRoute; a chart secret held by its people), with a factory in a
// foreign host town, or a fort where no town will do; a long lane gets a victualling station halfway (two legs). Lanes start
// small with large margins and grow with use (longhaul.ts). Posts are supplied by their owner for a time; a fort may grow
// into a colony. A mart whose relay income falls far below its peak after a lane took its goods logs Bypassed.

import { EventType, GOOD_COUNT, JourneyKind, LegKind, PostKind, SecretKind, StructureType, TECH_FIELD_COUNT, TechField, LeakChannel } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import { EXPLORE, EXPEDITION_COST, MIGRATION, TRADE } from '../params.ts'
import type { HistoryState } from '../state.ts'
import { abandon, canSettle, found, logEvent, logJourney } from '../state.ts'
import type { TradeState } from '../trade.ts'
import type { ExploreState } from '../exploration.ts'
import { driveTech, rangeOf } from '../exploration.ts'
import { ContactVia, learnPath } from '../knowledge.ts'
import { prosperity } from '../migration.ts'
import { hasHorse, speciesExpedition } from '../species.ts'
import { Tier, tierOf } from '../polity/state.ts'
import { atWar } from '../polity/formation.ts'
import { BYPASS, CLASS, LANE, MIDDLE, POST } from './params.ts'
import type { GoodsState } from './state.ts'
import { K, M, MIXED, MIX_OF, addPost, ensureGoods, logGoods, losePost } from './state.ts'
import { openLeg, pathCost } from './longhaul.ts'
import { grantHold, newSecret } from './secrets.ts'
import { expeditionFinds } from './deposits.ts'

const G = GOOD_COUNT

/** Chord between two cells. */
function chord(s: HistoryState, a: number, b: number): number {
  const P = s.world.grid.positions
  const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Polity of settlement id, -1. */
function polityOf(s: HistoryState, id: number): number {
  const ps = s.pol
  return ps !== null && id >= 0 && id < ps.seen ? ps.polity[id] : -1
}

/** True when varieties a and b come from the same source (one id, or one species of one people, or one deposit or tradition). */
function sameSource(g: GoodsState, a: number, b: number): boolean {
  return a === b || (a > 0 && b > 0 && g.vKind[a] === g.vKind[b] && g.vSource[a] === g.vSource[b] && g.vPeople[a] === g.vPeople[b])
}

/** True when settlement a may use (or reach) a lane to variety v already: an open lane from a's polity's marts (or from a) for v's source. */
function laneFor(s: HistoryState, g: GoodsState, a: number, v: number): boolean {
  const pa = polityOf(s, a)
  for (const k of g.lanes) {
    if (!g.legOpen[k]) continue
    const lv = g.legVariety[k]
    if (lv !== v && !(lv > 0 && g.vKind[lv] === g.vKind[v] && g.vSource[lv] === g.vSource[v] && g.vPeople[lv] === g.vPeople[v])) continue
    const h = g.legA[k]
    if (h === a || (pa >= 0 && polityOf(s, h) === pa) || s.people[h] === s.people[a] && pa < 0) return true
  }
  return false
}

/** Every 10 years (year % 10 = 7): rumour, the urge, trade expeditions (see the header). */
export function routePass(s: HistoryState, g: GoodsState, ts: TradeState, es: ExploreState): void {
  ensureGoods(g, s.count)
  const living = s.living
  const VM = g.rumour.length / g.P
  const P = g.P
  // Rumour: a mart's people hears of what its marts hold.
  for (let t = 0; t < living.length; t++) {
    const m = living[t]
    if (!g.isMart[m]) continue
    const pb = s.people[m] * VM
    for (let mi = 0; mi < M; mi++) {
      const S = g.held[m * G + MIXED[mi]]
      if (!(S > 0)) continue
      const o = (m * M + mi) * K
      for (let k = 0; k < K; k++) {
        const v = g.mixV[o + k]
        if (v > 0 && g.rumour[pb + v] < 0 && g.mixA[o + k] >= LANE.hear * S) g.rumour[pb + v] = s.year
      }
    }
  }
  void P
  // The urge, per mart, toward its best rumoured source.
  const T = s.terrain
  const hop = 1.12 / T.n
  for (let t = 0; t < living.length; t++) {
    const h = living[t]
    if (!g.isMart[h] || !ts.trader[h] || s.outpost[h]) continue
    const people = s.people[h]
    const sea = s.tech[people * TECH_FIELD_COUNT + TechField.Seafaring]
    const crafts = s.tech[people * TECH_FIELD_COUNT + TechField.Crafts]
    const port = s.port[h] >= 0
    const byLand = !port && crafts >= LANE.landCrafts && hasHorse(s, h)
    if (!(port && sea >= LANE.coastSea) && !byLand && g.urgeChart[h] === 0) { g.urge[h] *= 0.5; continue }
    let best = 0, bv = -1
    const pb = people * VM
    const ocean = ((MIGRATION.oceanCost * T.cellScale) / Math.sqrt(sea)) * (port ? TRADE.oceanPort : TRADE.oceanNoPort)
    const tf = 1 / (1 + 0.6 * (crafts - 1))
    const mu1 = (MIDDLE.r0 / (1 + MIDDLE.rTech * (crafts - 1))) * MIDDLE.season + MIDDLE.toll
    for (let v = 1; v < g.vCount; v++) {
      if (g.rumour[pb + v] < 0) continue
      const gd = g.vGood[v]
      const mi = MIX_OF[gd]
      if (mi < 0) continue
      const o = g.vOrigin[v]
      if (o < 0 || o === h || s.abandoned[o] >= 0 || !ts.trader[o]) continue
      if (laneFor(s, g, h, v)) continue
      // Share of v at h, and what h takes of the class a year.
      const S = g.held[h * G + gd]
      let share = 0
      const oo = (h * M + mi) * K
      for (let k = 0; k < K; k++) if (g.mixV[oo + k] === v) share = S > 0 ? g.mixA[oo + k] / S : 0
      if (share < LANE.hear) continue // (it must reach h already, through the middlemen)
      const cells = chord(s, s.cell[h], s.cell[o]) / hop
      if (cells < LANE.minCells) continue // (a direct way is for a far source)
      const Q = share * ts.demand[h * G + gd]
      const tGuess = (CLASS.transport[gd] * cells * LANE.guess * (byLand ? 1.5 : ocean) * tf) / g.vRel[v]
      const save = Q * (ts.price[h * G + gd] - (1 + mu1) * (ts.price[o * G + gd] + tGuess))
      const pi = save / CLASS.worth[gd]
      if (pi > best && save > LANE.minSave * CLASS.worth[gd]) { best = pi; bv = v }
    }
    if (bv >= 0) {
      const gd = g.vGood[bv]
      const Pi = best * CLASS.worth[gd]
      const half = LANE.half * CLASS.worth[gd]
      g.urge[h] += 10 * LANE.urge * (Pi / (Pi + half)) * smoothstep(0.3, 0.7, prosperity(s, h)) * (1 + LANE.tech * (driveTech(s, h) - 1))
    }
    if (g.urge[h] < 1 || s.year < g.urgeNext[h]) continue
    tradeExpedition(s, g, ts, es, h, bv, port || !byLand)
  }
}

/** Searches, pays for and sends a trade expedition from mart h for variety v (or along a chart it was given). */
function tradeExpedition(s: HistoryState, g: GoodsState, ts: TradeState, es: ExploreState, h: number, v: number, bySea: boolean): void {
  const X = LANE
  const T = s.terrain
  const rng = g.rng
  let ck = g.urgeChart[h] - 1
  // A chart given to it (a leak) is sailed by when it is for the variety sought.
  if (ck >= 0 && (v < 0 || !sameSource(g, g.legVariety[g.sSubject[ck]], v))) ck = -1
  else g.urgeChart[h] = 0
  // The source and the target cells: near the source, or near a mart holding the variety at martShare.
  let srcCell = -1
  let targetMart = -1
  if (ck >= 0) {
    const leg = g.sSubject[ck]
    const far = g.legB[leg]
    if (s.abandoned[far] >= 0) { g.urge[h] = 0; return }
    srcCell = s.cell[far]
    targetMart = far
    v = g.legVariety[leg]
  } else {
    if (v < 0) { g.urge[h] = 0; return }
    const o = g.vOrigin[v]
    if (o < 0) { g.urge[h] = 0; return }
    srcCell = s.cell[o]
  }
  const { dist, prev, stamp, src, buckets, bucketLen } = es
  const run = ++es.run
  const f = prosperity(s, h)
  const sea = bySea && s.port[h] >= 0
  const people = s.people[h]
  const seaT = s.tech[people * TECH_FIELD_COUNT + TechField.Seafaring]
  const ocean = seaT >= X.oceanSea
  const range = X.rangeMul * rangeOf(s, h, sea, f) * rng.range(0.85, 1.15) * (sea ? EXPEDITION_COST.portRange : 1)
  const stepOf = sea ? es.stepSea : es.stepLand
  // Targets.
  const tmark = TMARK.length >= T.cellCount ? TMARK : (TMARK = new Int32Array(T.cellCount))
  const trun = ++TRUN
  const mark = (c0: number, hops: number): void => {
    const { neighborOffsets: off, neighbors: nb } = s.world.grid
    const q = [c0]
    const dep = [0]
    tmark[c0] = trun
    for (let i = 0; i < q.length; i++) {
      if (dep[i] >= hops) continue
      for (let k = off[q[i]]; k < off[q[i] + 1]; k++) { const j = nb[k]; if (tmark[j] !== trun) { tmark[j] = trun; q.push(j); dep.push(dep[i] + 1) } }
    }
  }
  mark(srcCell, X.targetHops)
  if (ck < 0) {
    const mi = MIX_OF[g.vGood[v]]
    for (let t = 0; t < s.living.length; t++) {
      const m = s.living[t]
      if (!g.isMart[m] || m === h || s.people[m] === people) continue
      const S = g.held[m * G + g.vGood[v]]
      if (!(S > 0)) continue
      const o = (m * M + mi) * K
      for (let k = 0; k < K; k++) if (g.mixV[o + k] === v && g.mixA[o + k] >= X.martShare * S) { mark(s.cell[m], X.targetHops); break }
    }
  }
  // Dijkstra over whole tenths of expedition cost (as exploration.ts), from home and its posts.
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const B = buckets.length
  const rangeI = Math.floor(10 * range)
  bucketLen.fill(0)
  let pending = 0
  const push = (c: number, d: number): void => {
    const bk = d % B
    let arr = buckets[bk]
    if (bucketLen[bk] === arr.length) { const a = new Int32Array(arr.length * 2); a.set(arr); buckets[bk] = arr = a }
    arr[bucketLen[bk]++] = c
    pending++
  }
  const origin = s.cell[h]
  stamp[origin] = run; dist[origin] = 0; prev[origin] = -1; src[origin] = -1
  push(origin, 0)
  let best = -1, bestD = Infinity, visits = 0
  search: for (let cur = 0; pending > 0 && cur <= rangeI; cur++) {
    const bk = cur % B
    const items = buckets[bk]
    for (let i = 0; i < bucketLen[bk]; i++) {
      const c = items[i]
      pending--
      if (dist[c] !== cur) continue
      if (visits >= 12000) break search
      visits++
      if (tmark[c] === trun && c !== origin) {
        const dd = chord(s, c, srcCell)
        if (dd < bestD) { bestD = dd; best = c }
      }
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        const step = stepOf[j]
        if (step < 0) continue
        if (T.deep[j] && !ocean && ck < 0) continue // (no open-ocean lane before the Seafaring gate)
        const nd = cur + step
        if (nd > rangeI || (stamp[j] === run && nd >= dist[j])) continue
        stamp[j] = run; dist[j] = nd; prev[j] = c; src[j] = -1
        push(j, nd)
      }
    }
    bucketLen[bk] = 0
  }
  const D = g.diag
  if (best < 0) {
    g.urge[h] = X.retryUrge
    g.urgeNext[h] = s.year + X.retry
    D.expYear.push(s.year); D.expFrom.push(h); D.expOutcome.push(0); D.expVariety.push(v); D.expCells.push(0); D.expSea.push(sea ? 1 : 0)
    return
  }
  const path: number[] = []
  for (let c = best; c >= 0; c = prev[c]) path.push(c)
  path.reverse()
  // Cost: the mart pays, or its kingdom's capital.
  let gsz = Math.floor(s.pop[h] * EXPLORE.groupShare)
  if (gsz < EXPLORE.groupLow) gsz = EXPLORE.groupLow
  if (gsz > EXPLORE.groupHigh) gsz = EXPLORE.groupHigh
  const cost = X.costMul * EXPLORE.cost * gsz * (1 + path.length / EXPLORE.costCells)
  let payer = -1
  if (s.wealth[h] >= cost) payer = h
  else {
    const ps = s.pol
    const p = polityOf(s, h)
    if (ps !== null && p >= 0) {
      const cap = ps.pCapital[p]
      if (tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1) >= Tier.Kingdom && s.wealth[cap] >= X.polityMul * cost) payer = cap
    }
  }
  if (payer < 0) { g.urge[h] = 1; if (ck >= 0) g.urgeChart[h] = ck + 1; return }
  s.wealth[payer] -= cost
  g.urge[h] = 0
  g.urgeNext[h] = s.year + X.retry
  logGoods(s, EventType.ExpeditionSent, h, -1, gsz, v + 1)
  // Hazard and loss.
  let hz = 0
  for (let k = 1; k < path.length; k++) hz += es.hazard[path[k]]
  const tech = sea ? seaT : s.tech[people * TECH_FIELD_COUNT + TechField.Crafts]
  hz = (hz * T.cellScale * (1 + EXPLORE.back)) / (1 + EXPLORE.hazardTech * (tech - 1))
  if (ck >= 0) hz *= 0.3 // (sailing by a chart)
  const years = Math.min(EXPLORE.travelMax, EXPLORE.travelBase + EXPLORE.travelPerCell * path.length)
  const depart = Math.max(s.founded[h], s.year - years)
  D.expYear.push(s.year); D.expFrom.push(h); D.expVariety.push(v); D.expCells.push(path.length); D.expSea.push(sea ? 1 : 0)
  if (rng.next() < 1 - 1 / (1 + hz)) {
    s.pop[h] -= gsz
    if (sea) logEvent(s, EventType.VoyageLost, h, -1, gsz)
    logJourney(s, { departYear: depart, arriveYear: s.year, from: h, to: -1, size: gsz, kind: JourneyKind.Expedition, path: path.slice(0, Math.max(1, Math.floor(path.length * rng.range(0.5, 1)))) })
    D.expOutcome.push(2)
    return
  }
  D.expOutcome.push(1)
  const cells = learnPath(s, h, path, true, es.marginHops, ContactVia.Expedition)
  speciesExpedition(s, h, path)
  expeditionFinds(s, g, h, path)
  // The far end: a trader by the target, else a fort.
  const endCell = path[path.length - 1]
  let e = targetMart
  if (e < 0 || s.abandoned[e] >= 0) {
    e = -1
    let bd = Infinity
    const { neighborOffsets: o2, neighbors: n2 } = s.world.grid
    const q = [endCell], dep = [0]
    const seen = new Set<number>([endCell]) // (membership only)
    for (let i = 0; i < q.length; i++) {
      const c = q[i]
      const occ = s.occupant[c]
      if (occ >= 0 && occ !== h && s.abandoned[occ] < 0 && !s.outpost[occ] && ts.trader[occ]) { const dd = chord(s, c, srcCell); if (dd < bd) { bd = dd; e = occ } }
      if (dep[i] >= X.targetHops + 1) continue
      for (let k = o2[c]; k < o2[c + 1]; k++) { const j = n2[k]; if (!seen.has(j)) { seen.add(j); q.push(j); dep.push(dep[i] + 1) } }
    }
  }
  const hp = polityOf(s, h)
  let post = -1, postKind = -1
  const ps = s.pol
  const hostile = e >= 0 && ps !== null && hp >= 0 && polityOf(s, e) >= 0 && atWar(ps, hp, polityOf(s, e))
  if (e < 0 || hostile) {
    // A fort beside the source, on the best free coastal cell within two hops.
    const site = siteNear(s, endCell, 2)
    if (site >= 0) {
      const n = Math.min(POST.fortPop, Math.floor(s.pop[h] * 0.05))
      if (n >= 20) {
        s.pop[h] -= n
        e = found(s, site, n, h)
        ensureGoods(g, s.count)
        postKind = PostKind.Fort
      } else e = -1
    } else e = -1
  } else if (s.people[e] !== people && s.pop[e] >= POST.factoryPop) postKind = PostKind.Factory
  logEvent(s, EventType.ExpeditionReturned, h, postKind === PostKind.Fort ? e : -1, cells)
  const round = path.slice()
  for (let k = path.length - 2; k >= 0; k--) round.push(path[k])
  logJourney(s, { departYear: depart, arriveYear: s.year, from: h, to: h, size: gsz, kind: JourneyKind.Expedition, path: round })
  if (e < 0) return
  // The lane (two legs through a victualling station when it is longer than a season's sailing).
  let full = path
  if (full[full.length - 1] !== s.cell[e]) full = full.concat([s.cell[e]])
  const legs: number[] = []
  const season = X.season * rangeOf(s, h, sea, f)
  let station = -1
  if (sea && routeCostOf(es, full) > season && full.length > 8) {
    for (let i = Math.floor(full.length * 0.4); i < Math.floor(full.length * 0.7) && station < 0; i++) {
      const c = full[i]
      const { neighborOffsets: o2, neighbors: n2 } = s.world.grid
      for (let k = o2[c]; k < o2[c + 1]; k++) {
        const j = n2[k]
        if (canSettle(s, j) && T.seaCoast[j]) {
          const n = Math.min(POST.fortPop, Math.floor(s.pop[h] * 0.05))
          if (n < 20) break
          s.pop[h] -= n
          station = found(s, j, n, h)
          ensureGoods(g, s.count)
          const p1 = full.slice(0, i + 1).concat([j])
          const p2 = [j].concat(full.slice(i))
          legs.push(openLeg(s, g, h, station, LegKind.Lane, p1, pathCost(s, p1, h, station)))
          legs.push(openLeg(s, g, station, e, LegKind.Lane, p2, pathCost(s, p2, station, e)))
          break
        }
      }
    }
  }
  if (legs.length === 0) legs.push(openLeg(s, g, h, e, LegKind.Lane, full, pathCost(s, full, h, e)))
  // Chart: a new secret, or the one sailed by.
  const k = ck >= 0 ? ck : newSecret(s, g, SecretKind.Chart, legs[0], h)
  if (ck < 0) grantHold(s, g, k, people, LeakChannel.Founded, h, -1)
  const gd = g.vGood[v]
  const risk = (X.risk * hz) / (1 + hz)
  for (const leg of legs) {
    g.legChart[leg] = k
    g.legVariety[leg] = v
    g.legCap[leg] = X.cap0 * (ts.demand[h * G + gd] > 0 ? ts.demand[h * G + gd] : 1)
    g.legHazard[leg] = risk / legs.length
    g.legRisk0[leg] = risk / legs.length
    g.lanes.push(leg)
    g.isMart[g.legA[leg]] = 1
    g.isMart[g.legB[leg]] = 1
  }
  g.legOrder = g.legOrder.concat(legs)
  g.legOrder.sort((x, y) => g.legCost[x] - g.legCost[y] || x - y)
  logGoods(s, EventType.DirectRoute, h, e, legs[0], v)
  if (postKind === PostKind.Factory) {
    post = addPost(s, g, PostKind.Factory, h, e, -1, legs[legs.length - 1])
    const sid = s.structures.length
    s.structures.push({ id: sid, type: StructureType.Factory, cell: s.cell[e], settlement: h, builtYear: s.year, lostYear: -1 })
    logEvent(s, EventType.Built, h, sid, StructureType.Factory)
    g.pCost[post] = sid // (the factory's structure id)
  } else if (postKind === PostKind.Fort) {
    post = addPost(s, g, PostKind.Fort, h, -1, e, legs[legs.length - 1])
    g.pCost[post] = routeCostOf(es, full)
  }
  if (station >= 0) { const sp = addPost(s, g, PostKind.Station, h, -1, station, legs[0]); g.pCost[sp] = routeCostOf(es, full) * 0.5 }
}
let TMARK = new Int32Array(0)
let TRUN = 0

/** Expedition cost of a path. */
function routeCostOf(es: ExploreState, path: readonly number[]): number {
  let c = 0
  for (let k = 1; k < path.length; k++) { const x = es.costSea[path[k]]; c += x > 0 ? x : 0 }
  return c
}

/** The best free coastal habitable cell within `hops` of c (by potential), -1. */
function siteNear(s: HistoryState, c: number, hops: number): number {
  const T = s.terrain
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const q = [c], dep = [0]
  const seen = new Set<number>([c]) // (membership only)
  let best = -1, bv = 0
  for (let i = 0; i < q.length; i++) {
    const x = q[i]
    if (canSettle(s, x) && T.seaCoast[x] && T.potential[x] > bv) { bv = T.potential[x]; best = x }
    if (dep[i] >= hops) continue
    for (let k = off[x]; k < off[x + 1]; k++) { const j = nb[k]; if (!seen.has(j)) { seen.add(j); q.push(j); dep.push(dep[i] + 1) } }
  }
  return best
}

/** A rival people q was given chart k (chart leak, conquest): its best port mart may sail it (urge full, next route pass). */
export function chartedExpedition(s: HistoryState, g: GoodsState, k: number, q: number): void {
  let best = -1
  for (let t = 0; t < s.living.length; t++) {
    const m = s.living[t]
    if (s.people[m] !== q || !g.isMart[m] || s.port[m] < 0) continue
    if (best < 0 || s.through[m] > s.through[best]) best = m
  }
  if (best < 0 || g.legA[g.sSubject[k]] === best) return
  g.urgeChart[best] = k + 1
}

/** Yearly: posts are supplied by their owners (or lost), factories expelled in war, forts grow self-sufficient. */
export function postYear(s: HistoryState, g: GoodsState): void {
  const ps = s.pol
  for (let i = 0; i < g.postCount; i++) {
    if (g.pEnded[i] >= 0) continue
    const owner = g.pOwner[i]
    const kind = g.pKind[i]
    const x = g.pSettlement[i]
    if (kind === PostKind.Camp) { if (x >= 0 && s.abandoned[x] >= 0) losePost(s, g, i, 0); continue }
    if (kind === PostKind.Factory) {
      const host = g.pHost[i]
      const leg = g.pLeg[i]
      if (s.abandoned[host] >= 0 || s.abandoned[owner] >= 0 || (leg >= 0 && !g.legOpen[leg])) { endFactory(s, g, i, 0); continue }
      const a = polityOf(s, owner), b = polityOf(s, host)
      if (ps !== null && a >= 0 && b >= 0 && atWar(ps, a, b)) endFactory(s, g, i, 2)
      continue
    }
    // Fort or station.
    if (s.abandoned[x] >= 0) { losePost(s, g, i, 0); continue }
    if (s.year - g.pFounded[i] >= POST.supplyYears || (s.pop[x] >= POST.selfPop && s.food[x] >= POST.selfFood)) {
      // Self-sufficient (a colony) or the supply years are over: an ordinary settlement now.
      g.pEnded[i] = s.year
      g.postOf[x] = -1
      continue
    }
    if (s.abandoned[owner] >= 0) { failPost(s, g, i); continue }
    const cost = POST.supply * s.pop[x] * g.pCost[i] / (1 + 0.5 * (s.tech[s.people[owner] * TECH_FIELD_COUNT + TechField.Crafts] - 1))
    if (s.wealth[owner] >= cost) { s.wealth[owner] -= cost; g.pStrikes[i] = 0 }
    else if (++g.pStrikes[i] >= POST.strikes) failPost(s, g, i)
  }
}

/** A factory ends (cause 0 the lane or a party gone, 2 expelled): its structure falls out of use. */
function endFactory(s: HistoryState, g: GoodsState, i: number, cause: number): void {
  const sid = g.pCost[i]
  if (sid >= 0 && sid < s.structures.length && s.structures[sid].type === StructureType.Factory && s.structures[sid].lostYear < 0) {
    s.structures[sid].lostYear = s.year
    logEvent(s, EventType.StructureLost, g.pOwner[i], sid, StructureType.Factory)
  }
  losePost(s, g, i, cause)
}

/** A fort or station whose supply failed is abandoned. */
function failPost(s: HistoryState, g: GoodsState, i: number): void {
  const x = g.pSettlement[i]
  losePost(s, g, i, 0)
  if (s.abandoned[x] >= 0) return
  const idx = s.living.indexOf(x)
  if (idx < 0) return
  abandon(s, x)
  s.living.splice(idx, 1)
}

/** A post's settlement or host was conquered by a state other than its owner's: lost (cause 1). */
export function postConquered(s: HistoryState, g: GoodsState, v: number): void {
  for (let i = 0; i < g.postCount; i++) {
    if (g.pEnded[i] >= 0) continue
    if (g.pSettlement[i] !== v && g.pHost[i] !== v) continue
    if (polityOf(s, v) === polityOf(s, g.pOwner[i]) && polityOf(s, v) >= 0) continue
    if (g.pKind[i] === PostKind.Factory) endFactory(s, g, i, 1)
    else { losePost(s, g, i, 1); g.postOf[v] = -1 }
  }
}

/** Yearly: relay income smoothed and its peak; every 10 years the variety behind it and Bypassed (see the header). */
export function relayYear(s: HistoryState, g: GoodsState): void {
  const living = s.living
  const X = BYPASS
  const decade = s.year % 10 === 0
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const r = g.relayYear[id]
    g.relayYear[id] = 0
    g.relayDec[id] += r
    const sm = g.relaySm[id] + X.smoothing * (r - g.relaySm[id])
    g.relaySm[id] = sm
    if (sm > g.relayPeak[id]) { g.relayPeak[id] = sm; g.relayPeakYear[id] = s.year }
    if (!decade) continue
    // The variety behind most of the decade's relay income, while near the peak.
    if (g.relayDec[id] > 0 && sm >= 0.8 * g.relayPeak[id] && g.relayVarYear[id] > 0) {
      g.relayTopVar[id] = g.relayVarYear[id]
      g.relayTopShare[id] = g.relayVarAmt[id] / g.relayDec[id]
    }
    g.relayDec[id] = 0
    g.relayVarYear[id] = -1
    g.relayVarAmt[id] = 0
    if (g.bypassed[id] || g.relayPeakYear[id] < X.peakYear || sm >= X.share * g.relayPeak[id] || g.relayTopShare[id] < X.varShare) continue
    const tv = g.relayTopVar[id]
    if (tv <= 0) continue
    for (const k of g.lanes) {
      if (s.year - g.legOpened[k] > X.lanes || g.legA[k] === id || g.legB[k] === id) continue
      const lv = g.legVariety[k]
      if (lv !== tv && !(lv > 0 && g.vKind[lv] === g.vKind[tv] && g.vSource[lv] === g.vSource[tv])) continue
      g.bypassed[id] = 1
      logGoods(s, EventType.Bypassed, id, g.legA[k], k, 1 - sm / g.relayPeak[id])
      break
    }
  }
}
