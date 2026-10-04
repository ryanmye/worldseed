// ideas: the ideas system's place in the yearly tick (index.ts), when HistoryOptions.ideas is on.
//
//   ... -> exploration -> ideasYear (events of the year: migrants, conquests, royal marriages as pulses; long-haul lane volumes;
//   every IDEA.step years: the context, the channels between peoples, conception, learning, resistance, loss, the effects)
//   -> technology (its levels follow the caps of the ideas held: ideas/hooks.ts) -> ...
// The species techniques that are also ideas (terracing, crop rotation, the heavy plough) are found and spread by the species
// system; species.ts gainItem tells this one (hooks.ts ideaTechnique). See params.ts for the rules and the catalogue.
// Every draw comes from 'history-ideas' (IdeasState.rng), in fixed people and idea order; no Map or Set is iterated.

import { Biome, CITY_POPULATION, DiseaseKind, EventType, IdeaHow, IdeaKind, IdeaLoss, IdeaResist, TOWN_POPULATION } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import type { TradeState } from '../trade.ts'
import type { TechState } from '../technology.ts'
import { hasBit, SP } from '../species.ts'
import { POLITY } from '../polity/params.ts'
import { tierOf } from '../polity/state.ts'
import { atWar } from '../polity/formation.ts'
import { IDEA, IDEA_DEFS, R_FAITH, R_GUILD, R_RULER } from './params.ts'
import type { IdeasState } from './state.ts'
import { CH, createIdeas, ensureIdeas, PRE } from './state.ts'
import { recompute, record } from './hooks.ts'

const DEFS = IDEA_DEFS

/** Where an idea is conceived: the people's largest settlement with this site flag (its largest otherwise). */
const SITE_NONE = 0, SITE_COAST = 1, SITE_PORT = 2, SITE_RIVER = 3, SITE_DRY_RIVER = 4, SITE_ORE = 5, SITE_OPEN = 6
const SITES = 7
const SITE_OF: Record<string, number> = { // (lookup only, at module load)
  sail: SITE_COAST, keel: SITE_PORT, rudder: SITE_PORT, lateen: SITE_PORT, compass: SITE_PORT, navigation: SITE_PORT, quarantine: SITE_PORT, cartography: SITE_PORT,
  irrigation: SITE_DRY_RIVER, watermill: SITE_RIVER, bronze: SITE_ORE, iron: SITE_ORE, castIron: SITE_ORE, wheel: SITE_OPEN, riding: SITE_OPEN, windmill: SITE_OPEN,
}
const SITE = Int32Array.from(DEFS.map((d) => SITE_OF[d.key] ?? SITE_NONE))
/** Ore of a settlement's catchment (technology.ts oreBase) that counts in full for the ore share. */
const ORE_FULL = 0.5

/** Creates the ideas system at year 0 (after the tribes): every people holds nothing; its caps are 1 + IDEA.capBase. */
export function createIdeasSystem(s: HistoryState): IdeasState {
  const ix = createIdeas(s)
  recompute(s, ix)
  return ix
}

/** Scratch per people and per pair (sized on first use). */
let BEST = new Int32Array(0), BESTV = new Float64Array(0), ROUTEV = new Float64Array(0), ROUTEQ = new Int32Array(0), ROUTEH = new Int32Array(0)
let RSUM = new Float64Array(0), PSUM = new Float64Array(0), VIS = new Float64Array(0), VISQ = new Int32Array(0), VISH = new Int32Array(0), LANEBEST = new Float64Array(0)
let PCOUNT = new Float64Array(0), BACK = new Float64Array(0)
const ACCW = new Float64Array(CH)

function scratch(P: number): void {
  if (RSUM.length >= P * P) return
  BEST = new Int32Array(P * SITES); BESTV = new Float64Array(P * SITES)
  ROUTEV = new Float64Array(P * P); ROUTEQ = new Int32Array(P * P); ROUTEH = new Int32Array(P * P)
  RSUM = new Float64Array(P * P); PSUM = new Float64Array(P * P)
  VIS = new Float64Array(P * P); VISQ = new Int32Array(P * P); VISH = new Int32Array(P * P); LANEBEST = new Float64Array(P * P)
  PCOUNT = new Float64Array(P); BACK = new Float64Array(P)
}

/** A pulse of `x` years-equivalent on channel c: q learns from h, coming in at settlement gq from settlement gh. */
function addPulse(ix: IdeasState, q: number, h: number, c: number, x: number, gq: number, gh: number): void {
  if (q === h || !(x > 0)) return
  const k = (q * ix.P + h) * CH + c
  ix.pulse[k] += x
  ix.pgQ[k] = gq
  ix.pgH[k] = gh
}

/** The events of this year that carry ideas at once: migrants of another people, conquests, royal marriages. */
function scanEvents(s: HistoryState, ix: IdeasState): void {
  const ev = s.events
  const end = ev.length
  const X = IDEA
  const ps = s.pol
  for (let k = ix.evSeen; k < end; k++) {
    const e = ev[k]
    if (e.type === EventType.Migration) {
      const from = e.settlement, to = e.other
      if (from < 0 || to < 0) continue
      const h = s.people[from], q = s.people[to]
      if (h !== q) addPulse(ix, q, h, IdeaHow.Migration, (X.pulseMig * e.value) / (e.value + X.migHalf), to, from)
    } else if (e.type === EventType.Conquered) {
      const v = e.settlement
      let u = e.other
      if (u < 0 && ps !== null && v < ps.seen && ps.polity[v] >= 0) u = ps.pCapital[ps.polity[v]]
      if (u < 0) continue
      const pv = s.people[v], pu = s.people[u]
      if (pv === pu) continue
      addPulse(ix, pu, pv, IdeaHow.Conquest, X.pulseConquest, v, v) // (the conquerors learn in the town they took)
      addPulse(ix, pv, pu, IdeaHow.Conquest, X.pulseConquest, v, u)
    } else if (e.type === EventType.RoyalMarriage) {
      const a = e.settlement, b = e.other
      if (a < 0 || b < 0) continue
      const pa = s.people[a], pb = s.people[b]
      if (pa === pb) continue
      addPulse(ix, pa, pb, IdeaHow.Marriage, X.pulseMarriage, a, b)
      addPulse(ix, pb, pa, IdeaHow.Marriage, X.pulseMarriage, b, a)
    }
  }
  ix.evSeen = end
}

/** Smoothed long-haul leg volume between peoples (every year), and the ends of each pair's busiest leg this year. */
function laneYear(s: HistoryState, ix: IdeasState): void {
  const g = s.goods
  if (g === null) return
  const P = ix.P
  const a = IDEA.laneSmooth
  const lv = ix.laneVol
  for (let i = 0; i < P * P; i++) lv[i] *= 1 - a
  LANEBEST.fill(0, 0, P * P)
  for (let k = 0; k < g.legCount; k++) {
    if (!g.legOpen[k]) continue
    const v = g.legVol[k]
    if (!(v > 0)) continue
    const x = g.legA[k], y = g.legB[k]
    const px = s.people[x], py = s.people[y]
    if (px === py) continue
    lv[px * P + py] += a * v
    lv[py * P + px] += a * v
    if (v > LANEBEST[px * P + py]) {
      LANEBEST[px * P + py] = v; LANEBEST[py * P + px] = v
      ix.laneQ[px * P + py] = x; ix.laneH[px * P + py] = y
      ix.laneQ[py * P + px] = y; ix.laneH[py * P + px] = x
    }
  }
}

/** System (yearly, before the technology system): see the header. */
export function ideasYear(s: HistoryState, ix: IdeasState, ts: TradeState, tk: TechState): void {
  ensureIdeas(ix, s.count)
  scanEvents(s, ix)
  laneYear(s, ix)
  if (s.year % IDEA.step !== 0) return
  scratch(ix.P)
  context(s, ix, ts, tk)
  channels(s, ix, ts, tk)
  learnAndConceive(s, ix)
  losses(s, ix)
  ix.pulse.fill(0)
  recompute(s, ix)
}

/** The per-people context of the preconditions, and the best site of each kind per people. */
function context(s: HistoryState, ix: IdeasState, ts: TradeState, tk: TechState): void {
  const P = ix.P
  const c = ix.ctx
  const T = s.terrain
  const W = s.world
  const ps = s.pol
  const dz = s.dz
  for (const a of [c.pop, c.big, c.towns, c.cities, c.coast, c.port, c.river, c.dry, c.dryRiver, c.open, c.ore, c.trade, c.lanes, c.danger, c.met]) a.fill(0)
  c.tier.fill(-1)
  ix.largest.fill(-1)
  BEST.fill(-1, 0, P * SITES)
  BESTV.fill(0, 0, P * SITES)
  const living = s.living
  const site = (p: number, k: number, id: number, x: number): void => { const j = p * SITES + k; if (x > BESTV[j]) { BESTV[j] = x; BEST[j] = id } }
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const p = s.people[id]
    const x = s.pop[id]
    const cell = s.cell[id]
    c.pop[p] += x
    if (x > c.big[p]) { c.big[p] = x; ix.largest[p] = id }
    if (x >= TOWN_POPULATION) c.towns[p]++
    if (x >= CITY_POPULATION) c.cities[p]++
    if (T.seaCoast[cell]) { c.coast[p] += x; site(p, SITE_COAST, id, x) }
    if (s.port[id] >= 0) { c.port[p] += x; site(p, SITE_PORT, id, x) }
    const river = T.river[cell] === 1 || T.riverCap[cell] > 0
    const dry = T.aridity[cell] >= 0.35
    if (river) { c.river[p] += x; site(p, SITE_RIVER, id, x) }
    if (dry) c.dry[p] += x
    if (dry && river) { c.dryRiver[p] += x; site(p, SITE_DRY_RIVER, id, x) }
    const b = W.biome[cell]
    if (b === Biome.Grassland || b === Biome.Savanna || b === Biome.Desert) { c.open[p] += x; site(p, SITE_OPEN, id, x) }
    if (id < tk.oreSeen) {
      const o = tk.oreBase[id]
      if (o > 0) { const f = o >= ORE_FULL ? 1 : o / ORE_FULL; c.ore[p] += x * f; site(p, SITE_ORE, id, x * f) }
    }
    c.trade[p] += 0.2 * s.through[id]
    if (ps !== null && id < ps.seen) {
      c.danger[p] += x * ps.danger[id]
      const q = ps.polity[id]
      if (q >= 0) {
        const tr = tierOf(ps.pPop[q], ps.pMembers[q], ps.pMulti[q] === 1, ps.worldPop)
        if (tr > c.tier[p]) c.tier[p] = tr
      }
    }
  }
  const sp = s.sp
  const k = s.know
  for (let p = 0; p < P; p++) {
    const x = c.pop[p]
    if (x > ix.peak[p]) ix.peak[p] = x
    else ix.peak[p] *= 1 - IDEA.peakDecay * IDEA.step
    ix.recent[p] *= 1 - IDEA.cardDecay * IDEA.step
    if (!(x > 0)) continue
    for (const a of [c.coast, c.port, c.river, c.dry, c.dryRiver, c.open, c.ore, c.danger]) a[p] /= x
    const m0 = sp.pm0[p], m1 = sp.pm1[p]
    c.horse[p] = hasBit(m0, m1, SP.horse) ? 1 : 0
    c.draught[p] = hasBit(m0, m1, SP.cattle) || hasBit(m0, m1, SP.horse) || hasBit(m0, m1, SP.camel) || hasBit(m0, m1, SP.buffalo) ? 1 : 0
    c.fibre[p] = hasBit(m0, m1, SP.cotton) || hasBit(m0, m1, SP.flax) || hasBit(m0, m1, SP.hemp) || hasBit(m0, m1, SP.silk) || hasBit(m0, m1, SP.sheepGoat) ? 1 : 0
    const o = p * 4
    c.farm[p] = s.tech[o]; c.sea[p] = s.tech[o + 1]; c.metal[p] = s.tech[o + 2]; c.crafts[p] = s.tech[o + 3]
    let met = 0
    for (let h = 0; h < P; h++) {
      if (h === p || k.contact[p * P + h] < 0) continue
      const v = tk.pairVol[p * P + h]
      c.trade[p] += v
      if (k.near[p * P + h] || v > 10) met++
    }
    c.met[p] = met
    c.plague[p] = dz !== null && s.year - dz.lastGreat[p] <= 200 ? 1 : 0
    let crowd = 0
    if (dz !== null) for (let d = 0; d < dz.D; d++) if (dz.kind[d] === DiseaseKind.Crowd && dz.endemic[p * dz.D + d]) crowd = 1
    c.crowd[p] = crowd
    // Capital: the polity capital of its largest settlement, else the largest.
    const L = ix.largest[p]
    ix.capital[p] = L
    if (ps !== null && L >= 0 && L < ps.seen && ps.polity[L] >= 0) ix.capital[p] = ps.pCapital[ps.polity[L]]
  }
  const g = s.goods
  if (g !== null) {
    for (let j = 0; j < g.legCount; j++) {
      if (!g.legOpen[j]) continue
      const pa = s.people[g.legA[j]], pb = s.people[g.legB[j]]
      c.lanes[pa]++
      if (pb !== pa) c.lanes[pb]++
    }
  }
  void ts
}

/** Channel rates between every learner q and teacher h this step (see params.ts), and their gateways. */
function channels(s: HistoryState, ix: IdeasState, ts: TradeState, tk: TechState): void {
  const P = ix.P
  const X = IDEA
  const ch = X.ch
  const rate = ix.rate, gwQ = ix.gwQ, gwH = ix.gwH
  rate.fill(0)
  const c = ix.ctx
  const k = s.know
  // Busiest route between each pair of peoples (its ends).
  ROUTEV.fill(0, 0, P * P)
  const list = ts.openList
  for (let t = 0; t < list.length; t++) {
    const r = list[t]
    const v = ts.rVol[r]
    if (!(v > 0)) continue
    const a = ts.rA[r], b = ts.rB[r]
    const pa = s.people[a], pb = s.people[b]
    if (pa === pb || v <= ROUTEV[pa * P + pb]) continue
    ROUTEV[pa * P + pb] = v; ROUTEV[pb * P + pa] = v
    ROUTEQ[pa * P + pb] = a; ROUTEH[pa * P + pb] = b
    ROUTEQ[pb * P + pa] = b; ROUTEH[pb * P + pa] = a
  }
  // Visitors (tourism): q's travellers to h's towns.
  VIS.fill(0, 0, P * P)
  const tz = s.tz
  if (tz !== null) {
    for (let f = 0; f < tz.fFrom.length; f++) {
      const a = tz.fFrom[f], b = tz.fTo[f]
      const q = s.people[a], h = s.people[b]
      if (q === h) continue
      const v = tz.fVis[f]
      if (v > VIS[q * P + h]) { VISQ[q * P + h] = a; VISH[q * P + h] = b }
      VIS[q * P + h] += v
    }
  }
  const ps = s.pol, g = s.goods, rel = s.rel
  for (let q = 0; q < P; q++) {
    if (!(c.pop[q] > 0)) continue
    for (let h = 0; h < P; h++) {
      if (h === q || !(c.pop[h] > 0) || k.contact[q * P + h] < 0) continue
      const o = (q * P + h) * CH
      const Lq = ix.largest[q], Lh = ix.largest[h]
      const set = (cc: number, r: number, a: number, b: number): void => { rate[o + cc] = r; gwQ[o + cc] = a; gwH[o + cc] = b }
      set(IdeaHow.Contact, ch[IdeaHow.Contact], Lq, Lh)
      if (k.near[q * P + h]) set(IdeaHow.Neighbours, ch[IdeaHow.Neighbours], Lq, Lh)
      const v = tk.pairVol[q * P + h]
      if (v > 0) set(IdeaHow.Trade, (ch[IdeaHow.Trade] * v) / (v + X.tradeHalf), ROUTEV[q * P + h] > 0 ? ROUTEQ[q * P + h] : Lq, ROUTEV[q * P + h] > 0 ? ROUTEH[q * P + h] : Lh)
      const lv = ix.laneVol[q * P + h]
      if (lv > 0.01) set(IdeaHow.Lane, (ch[IdeaHow.Lane] * lv) / (lv + X.laneHalf), ix.laneQ[q * P + h] >= 0 ? ix.laneQ[q * P + h] : Lq, ix.laneH[q * P + h] >= 0 ? ix.laneH[q * P + h] : Lh)
      const vis = VIS[q * P + h]
      if (vis > 0) set(IdeaHow.Visitors, (ch[IdeaHow.Visitors] * vis) / (vis + X.visitorHalf), VISQ[q * P + h], VISH[q * P + h])
      // Theft: a kingdom or empire, twice as keen at war (applied only to the ideas that can be stolen).
      if (c.tier[q] >= 1) {
        let war = false
        const cq = ix.capital[q], chh = ix.capital[h]
        if (ps !== null && cq >= 0 && chh >= 0 && cq < ps.seen && chh < ps.seen) { const a = ps.polity[cq], b = ps.polity[chh]; if (a >= 0 && b >= 0 && atWar(ps, a, b)) war = true }
        set(IdeaHow.Theft, ch[IdeaHow.Theft] * (war ? 2 : 1), cq, chh)
      }
    }
  }
  // Posts: one people's post hosted among the other (both ways).
  if (g !== null) {
    for (let j = 0; j < g.postCount; j++) {
      if (g.pEnded[j] >= 0) continue
      const own = g.pOwner[j]
      const at = g.pHost[j] >= 0 ? g.pHost[j] : g.pSettlement[j]
      if (own < 0 || at < 0) continue
      const a = s.people[own], b = s.people[at]
      if (a === b || !(c.pop[a] > 0) || !(c.pop[b] > 0) || k.contact[a * P + b] < 0) continue
      const step = ch[IdeaHow.Post] / X.postMax
      for (const [q, h, gq, gh] of [[a, b, own, at], [b, a, at, own]]) {
        const o = (q * P + h) * CH + IdeaHow.Post
        if (rate[o] < ch[IdeaHow.Post] - 1e-12) { rate[o] += step; gwQ[o] = gq; gwH[o] = gh }
      }
    }
  }
  // Empire: two peoples each at least POLITY.multiShare of one polity's members.
  if (ps !== null) {
    for (const pol of ps.alive) {
      if (pol + 1 >= ps.memOff.length) continue
      const m0 = ps.memOff[pol], m1 = ps.memOff[pol + 1]
      const n = m1 - m0
      if (n < 2) continue
      PCOUNT.fill(0, 0, P)
      for (let j = m0; j < m1; j++) PCOUNT[s.people[ps.memList[j]]]++
      const cap = ps.pCapital[pol]
      for (let a = 0; a < P; a++) {
        const sa = PCOUNT[a] / n
        if (sa < POLITY.multiShare) continue
        for (let b = 0; b < P; b++) {
          const sb = PCOUNT[b] / n
          if (b === a || sb < POLITY.multiShare || k.contact[a * P + b] < 0) continue
          let e = (sa < sb ? sa : sb) / 0.15
          if (e > 1) e = 1
          const o = (a * P + b) * CH + IdeaHow.Empire
          if (ch[IdeaHow.Empire] * e > rate[o]) { rate[o] = ch[IdeaHow.Empire] * e; gwQ[o] = cap; gwH[o] = ix.largest[b] }
        }
      }
    }
  }
  // Pilgrims and clergy: q's universal faith has its holy city among h; both follow one universal faith.
  if (rel !== null) {
    const pf = rel.peopleFaith
    for (let q = 0; q < P; q++) {
      const f = pf[q]
      if (f < 0 || !(c.pop[q] > 0)) continue
      const holy = rel.holy[f]
      const hp = holy >= 0 && holy < s.count && s.abandoned[holy] < 0 ? s.people[holy] : -1
      for (let h = 0; h < P; h++) {
        if (h === q || !(c.pop[h] > 0) || k.contact[q * P + h] < 0) continue
        let r = 0
        if (h === hp) { const x = rel.pilgrims[f]; if (x > 0) r += x / (x + X.pilgrimHalf) }
        if (pf[h] === f) r += X.faith
        if (r > 0) {
          const o = (q * P + h) * CH + IdeaHow.Pilgrims
          rate[o] = ch[IdeaHow.Pilgrims] * r; gwQ[o] = ix.largest[q]; gwH[o] = h === hp ? holy : ix.largest[h]
        }
      }
    }
  }
  // Sums per pair (theft apart) and of the pulses.
  for (let i = 0; i < P * P; i++) {
    let r = 0, u = 0
    const o = i * CH
    for (let cc = 1; cc < CH; cc++) { if (cc !== IdeaHow.Theft) r += rate[o + cc]; u += ix.pulse[o + cc] }
    RSUM[i] = r
    PSUM[i] = u
  }
}

/** Resistance of people q to idea i (0..1) and its main cause (IdeaResist). */
function resistance(s: HistoryState, ix: IdeasState, q: number, i: number): [number, number] {
  const d = DEFS[i]
  const X = IDEA
  let keep = 1, best = 0, cause = -1
  const add = (r: number, why: number): void => { if (!(r > 0)) return; keep *= 1 - r; if (r > best) { best = r; cause = why } }
  const rel = s.rel
  if ((d.resist & R_FAITH) && rel !== null) { const f = rel.peopleFaith[q]; if (f >= 0) add(X.faithResist * rel.zeal[f], IdeaResist.Faith) }
  const rul = s.rul, ps = s.pol
  if ((d.resist & R_RULER) && rul !== null && ps !== null) {
    const cap = ix.capital[q]
    const pol = cap >= 0 && cap < ps.seen ? ps.polity[cap] : -1
    if (pol >= 0 && pol < rul.pcap) {
      const r = rul.cur[pol]
      if (r >= 0) add(X.rulerResist * (1 - rul.rTol[r]) * (d.kind === IdeaKind.War ? 1 - rul.rWar[r] : rul.rPiety[r]), IdeaResist.Ruler)
    }
  }
  const g = s.goods
  if ((d.resist & R_GUILD) && g !== null) {
    let n = 0
    for (let t = 0; t < g.tCount; t++) if (g.tPeople[t] === q && g.tEnd[t] < 0 && g.tRenowned[t]) n++
    if (n > 0) add((X.guildResist * n) / (n + 1), IdeaResist.Guild)
  }
  return [1 - keep, cause]
}

/** Learning, adoption, resistance and conception for every living people and idea (see params.ts). */
function learnAndConceive(s: HistoryState, ix: IdeasState): void {
  const P = ix.P, I = ix.I
  const X = IDEA
  const dt = X.step
  const c = ix.ctx
  const held = ix.held, prog = ix.prog, acc = ix.acc, rate = ix.rate, pulse = ix.pulse
  const rng = ix.rng
  const k = s.know
  for (let q = 0; q < P; q++) {
    if (!(c.pop[q] > 0)) continue
    const learn = ix.fx.learn[q]
    // Ideas beget ideas (recombination), more people conceive more, and a people far behind learns eagerly from those ahead.
    let nHeld = 0
    for (let i = 0; i < I; i++) nHeld += held[q * I + i]
    let scale = Math.sqrt(c.pop[q] / X.popRef)
    if (scale < X.scaleMin) scale = X.scaleMin
    else if (scale > X.scaleMax) scale = X.scaleMax
    const boost = (1 + X.combo * nHeld) * scale
    const tq = c.farm[q] + c.sea[q] + c.metal[q] + c.crafts[q]
    for (let h = 0; h < P; h++) {
      const th = c.farm[h] + c.sea[h] + c.metal[h] + c.crafts[h]
      const r = tq > 0 ? th / tq - 1 : 0
      BACK[h] = r > 0 ? 1 + X.backward * r : 1
    }
    for (let i = 0; i < I; i++) {
      const qi = q * I + i
      if (held[qi]) continue
      const d = DEFS[i]
      if (d.technique >= 0) continue // (the species system's)
      const pre = PRE[i]
      let ok = true
      for (let j = 0; j < pre.length; j++) if (!held[q * I + pre[j]]) { ok = false; break }
      if (!ok) continue
      // Exposure from the living holders q has met.
      let E = 0, bestS = 0, bestH = -1, met = false
      ACCW.fill(0)
      for (let h = 0; h < P; h++) {
        if (h === q || !held[h * I + i] || !(c.pop[h] > 0) || k.contact[q * P + h] < 0) continue
        met = true
        const pp = q * P + h
        const o = pp * CH
        const th = d.theft ? rate[o + IdeaHow.Theft] : 0
        const sc = ((RSUM[pp] + th) * dt + PSUM[pp]) * BACK[h]
        if (sc > bestS) { bestS = sc; bestH = h }
        E += sc
        for (let cc = 1; cc < CH; cc++) {
          if (cc === IdeaHow.Theft && !d.theft) continue
          ACCW[cc] += (rate[o + cc] * dt + pulse[o + cc]) * BACK[h]
        }
      }
      if (met) {
        const u = d.use ? d.use(c, q) : 1
        if (!(u > 0)) continue
        const add = (E * learn) / d.teach
        prog[qi] += add
        const ao = qi * CH
        for (let cc = 1; cc < CH; cc++) acc[ao + cc] += ACCW[cc]
        if (!(E > 0)) prog[qi] *= 1 - X.forget * dt
        if (prog[qi] < 1) continue
        const chance = X.adopt * u
        const [r, why] = d.resist ? resistance(s, ix, q, i) : [0, -1]
        const x = rng.next()
        if (x < chance * (1 - r)) {
          // How: the channel that carried most of the progress; from the strongest source; via that channel's gateway.
          let how: number = IdeaHow.Contact, hv = -1
          for (let cc = 1; cc < CH; cc++) if (acc[ao + cc] > hv) { hv = acc[ao + cc]; how = cc }
          const o = (q * P + bestH) * CH + how
          const isPulse = pulse[o] > 0 && pulse[o] >= rate[o] * dt
          let via = isPulse ? ix.pgQ[o] : ix.gwQ[o], src = isPulse ? ix.pgH[o] : ix.gwH[o]
          if (via < 0 || s.abandoned[via] >= 0) via = ix.largest[q]
          if (src >= 0 && s.abandoned[src] >= 0) src = ix.largest[bestH]
          record(s, ix, i, q, how, bestH, via, src)
        } else if (x < chance && r > 0 && !ix.refused[qi]) {
          ix.refused[qi] = 1
          ix.diag.resisted++
          const at = ix.capital[q] >= 0 ? ix.capital[q] : ix.largest[q]
          s.events.push({ year: s.year, type: EventType.IdeaResisted, settlement: at, other: ix.largest[bestH], value: i, extra: why })
        }
        continue
      }
      // No holder met: it may be conceived here (an independent origin if someone far away has it).
      if (!(d.chance > 0)) continue
      const w = d.cond(c, q)
      if (!(w > 0)) continue
      let mix = c.met[q]
      if (mix > X.mixMax) mix = X.mixMax
      const chance = ((((X.conceive * d.chance) / 100) * dt * w * (1 + X.mix * mix)) / (1 + X.cardwell * ix.recent[q])) * boost
      if (rng.next() >= chance) continue
      const sk = SITE[i]
      const at = sk !== SITE_NONE && BEST[q * SITES + sk] >= 0 ? BEST[q * SITES + sk] : ix.largest[q]
      record(s, ix, i, q, IdeaHow.Invented, -1, at, -1)
    }
  }
}

/** Losses of fragile ideas by small, isolated or collapsed peoples, and of the ideas resting on them. */
function losses(s: HistoryState, ix: IdeasState): void {
  const P = ix.P, I = ix.I
  const X = IDEA
  const c = ix.ctx
  const held = ix.held
  const k = s.know
  const rng = ix.rng
  for (let q = 0; q < P; q++) {
    const x = c.pop[q]
    if (!(x > 0)) continue
    const small = 1 - smoothstep(X.lossLow, X.lossHigh, x)
    const collapse = x < X.collapseShare * ix.peak[q] ? X.collapseMul : 0
    if (!(small + collapse > 0)) continue
    for (let i = 0; i < I; i++) {
      if (!held[q * I + i]) continue
      const d = DEFS[i]
      if (!(d.fragile > 0) || d.technique >= 0) continue
      let support = 0
      for (let h = 0; h < P; h++) if (h !== q && held[h * I + i] && c.pop[h] > 0 && k.contact[q * P + h] >= 0) support += RSUM[q * P + h]
      const risk = ((X.fragile * d.fragile / 100) * X.step * (small + collapse)) / (1 + support / X.supportHalf)
      if (rng.next() >= risk) continue
      lose(s, ix, q, i, collapse > 0 && small < 0.5 ? IdeaLoss.Collapse : IdeaLoss.Isolated)
      // Ideas resting on it go with it (prerequisites come earlier, so one pass forward is enough).
      for (let j = i + 1; j < I; j++) {
        if (!held[q * I + j]) continue
        const pre = PRE[j]
        for (let t = 0; t < pre.length; t++) if (!held[q * I + pre[t]]) { lose(s, ix, q, j, IdeaLoss.Prerequisite); break }
      }
    }
  }
}

/** People q loses idea i this year. */
function lose(s: HistoryState, ix: IdeasState, q: number, i: number, cause: number): void {
  const qi = q * ix.I + i
  ix.held[qi] = 0
  ix.since[qi] = -1
  ix.prog[qi] = 0
  ix.acc.fill(0, qi * CH, (qi + 1) * CH)
  const at = ix.largest[q]
  ix.aIdea.push(i); ix.aPeople.push(q); ix.aYear.push(s.year); ix.aHow.push(IdeaHow.Lost); ix.aFrom.push(-1); ix.aVia.push(at); ix.aSource.push(-1)
  ix.diag.lost++
  s.events.push({ year: s.year, type: EventType.IdeaLost, settlement: at, other: -1, value: i, extra: cause })
}
