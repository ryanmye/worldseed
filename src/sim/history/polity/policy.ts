// polities v2: trade policy (design 9.1). Tariffs on imports crossing a border, embargoes between rivals short of
// war, and what the market (trade.ts) needs to price every candidate pair: duties, the smuggling channel, and the
// costs of pirates, privateers, blockades and bandits on the way (refreshed every POLITY.slowStep years, when the
// pairs are rebuilt, and for the pairs whose war or embargo changed when a war begins or ends).
//
// Tariff of polity p (every step): it moves TARIFF.rate a year toward
//   target = base[tier] + war [at war] + need * smoothstep(needHigh, needLow, capital wealth / mass) + rivalry * max R
// (empires tax more; war and an empty treasury raise duties; so does hostility to the neighbours: protection).
// A member's imports from a settlement of another polity (or a stateless one) pay its polity's rate on their value at
// the importer's price (food TARIFF.food of it); the duty goes to the importer's capital. Merchants pass most of it on:
// only TARIFF.wedge of the duty enters the price gap a flow must beat (trade.ts), so duties thin trade at the margin
// without strangling it. Vassals and their overlord trade duty-free.
// Embargo: a pair of polities whose rivalry reaches TARIFF.embargoOn stops trading in all but food (until it falls below
// embargoOff); polities at war stop trading altogether (v1).
//
// Smuggling: on every pair under a duty or an embargo
//   sigma = share * hide * (1 - enforcement) * incentive
//   hide = 0.3 + 0.3 [a sea leg or a coastal end] + 0.4 * mean defensibility of the ends + 0.2 [a stateless place or
//          an expedition base on the way]           (rough borders, quiet coasts, shatter zones)
//   enforcement = grip(dist) * A / (A + 0.2) * (crisis ? 0.6 : 1) * (1 - 0.5 corruption) of the importer's polity at the
//          importer (embargo: the stronger of the two sides)
//   incentive = tau / (tau + 0.15) for a duty (high duties breed smuggling), 1 for an embargo
// Under a duty, sigma of what crosses evades it as contraband; under an embargo or at war contraband is sigma of what
// the market would move, at SMUGGLE.premium times the transport. A share seize * enforcement of the contraband is
// seized (its worth to the enforcing capital); the smugglers' cut goes to the hub: the least policed settlement on the
// way (stateless ones first), or the importer. Its share of the hub's income is the hub's contraband share
// (History.contraband). Duties, seizures, cuts and plunder are summed per pair and paid out every outlaw.ts ACCOUNTS years.

import { TECH_FIELD_COUNT, TechField } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import type { TradeState } from '../trade.ts'
import { BANDIT, PIRACY, POLITY, SMUGGLE, TARIFF } from './params.ts'
import { FAR, grip, inCrisis, tierOf } from './state.ts'
import type { PolityState } from './state.ts'

/** What the market reads per candidate pair this year (index = trade pair). Directions: AB = goods from a to b (b imports). */
export interface PairPolicy {
  n: number
  /** 1 when the pair needs the restricted market path (a duty or an embargo). */
  code: Uint8Array
  /** 1: no legal trade (war); 2: no legal trade but in food (an embargo short of war). */
  block: Uint8Array
  /** Duty rate on the importer's side. */
  dAB: Float64Array
  dBA: Float64Array
  /** Smuggling share and the enforcement against it. */
  sAB: Float64Array
  sBA: Float64Array
  eAB: Float64Array
  eBA: Float64Array
  /** Hub (smugglers' cut), duty / seizure collector's capital and its polity. */
  hAB: Int32Array
  hBA: Int32Array
  cAB: Int32Array
  cBA: Int32Array
  qAB: Int32Array
  qBA: Int32Array
  /** Transport cost multiplier (pirates, privateers, blockade, bandits), share of the cargo lost and who takes it. */
  cost: Float64Array
  loss: Float64Array
  lossTo: Int32Array
  /** Contraband loads this year (filled by the market). */
  smug: Float64Array
  /** Polity of each end (this year), for the market's accounts. */
  pa: Int32Array
  pb: Int32Array
  /** Pairs between two different polities (as of the last full refresh). */
  cross: number[]
  /** Since the last flush (paid out by flushAccounts): duties and seizures for the collector, the smugglers' cut for the hub, its largest single part and good. */
  revAB: Float64Array
  revBA: Float64Array
  cutAB: Float64Array
  cutBA: Float64Array
  bestAB: Float64Array
  bestBA: Float64Array
  gAB: Int32Array
  gBA: Int32Array
  /** Route of each pair (-1 until it carried something), its cargo lost (loads, since the last flush), and the legal flows of embargoed pairs (food). */
  route: Int32Array
  lossV: Float64Array
  legal: Float64Array
  /** Duty pairs since the last flush: value (loads), value at the importer's price, the same weighted by the food share of the duty, and net gap times quantity. */
  vAB: Float64Array
  vBA: Float64Array
  pvAB: Float64Array
  pvBA: Float64Array
  dbAB: Float64Array
  dbBA: Float64Array
  nbAB: Float64Array
  nbBA: Float64Array
  /** War epoch of the last embargo refresh. */
  epoch: number
  /** How hidden the way is (pairs under a duty or an embargo; goods: the smuggled share of a secret's monopoly rent). */
  hide: Float64Array
}

export function makePolicy(n: number): PairPolicy {
  return {
    n: 0, code: new Uint8Array(n), block: new Uint8Array(n), dAB: new Float64Array(n), dBA: new Float64Array(n), sAB: new Float64Array(n), sBA: new Float64Array(n),
    eAB: new Float64Array(n), eBA: new Float64Array(n), hAB: new Int32Array(n), hBA: new Int32Array(n), cAB: new Int32Array(n), cBA: new Int32Array(n),
    qAB: new Int32Array(n), qBA: new Int32Array(n), cost: new Float64Array(n), loss: new Float64Array(n), lossTo: new Int32Array(n), smug: new Float64Array(n),
    pa: new Int32Array(n), pb: new Int32Array(n), cross: [],
    revAB: new Float64Array(n), revBA: new Float64Array(n), cutAB: new Float64Array(n), cutBA: new Float64Array(n), bestAB: new Float64Array(n), bestBA: new Float64Array(n),
    gAB: new Int32Array(n), gBA: new Int32Array(n), epoch: -1, route: new Int32Array(n).fill(-1), lossV: new Float64Array(n), legal: new Float64Array(n),
    vAB: new Float64Array(n), vBA: new Float64Array(n), pvAB: new Float64Array(n), pvBA: new Float64Array(n), dbAB: new Float64Array(n), dbBA: new Float64Array(n), nbAB: new Float64Array(n), nbBA: new Float64Array(n),
    hide: new Float64Array(n),
  }
}

/** Enforcement of polity p's laws at its member x (0..1). */
export function enforcement(s: HistoryState, ps: PolityState, x: number, p: number): number {
  const X = SMUGGLE
  const d = ps.dist[x]
  if (!(d < FAR)) return 0
  const A = ps.pAsab[p]
  const e = (grip(d, ps.pReach[p]) * A) / (A + X.enfA) * (inCrisis(s, ps, p) ? X.crisisEnf : 1) * (1 - X.corruptEnf * ps.corrupt[x])
  return e > 0 ? e : 0
}

/** True when p and q are vassal (or tributary) and overlord: they trade duty-free and never fight. */
export function bound(ps: PolityState, p: number, q: number): boolean {
  const bp = ps.pSub[p], bq = ps.pSub[q]
  return (bp >= 0 && ps.bB[bp] === q) || (bq >= 0 && ps.bB[bq] === p)
}

/** System part (every step): tariff rates and embargoes. */
export function tariffStep(s: HistoryState, ps: PolityState): void {
  const X = TARIFF
  const step = POLITY.step
  const maxR = ps.scratchPol
  for (const p of ps.alive) maxR[p] = 0
  const R = ps.relA.length
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0) {
      // (an embargo in force ends with either polity: History.embargoes)
      const k = ps.relEmbRec[r]
      if (k >= 0) { const ea = ps.pEnded[a], eb = ps.pEnded[b]; ps.embEnd[k] = ea >= 0 && (eb < 0 || ea <= eb) ? ea : eb; ps.relEmbRec[r] = -1 }
      continue
    }
    const x = ps.relR[r]
    if (ps.relEdges[r].length > 0) { if (x > maxR[a]) maxR[a] = x; if (x > maxR[b]) maxR[b] = x }
    // Embargo short of war (with hysteresis); never between a vassal and its overlord. Recorded in History.embargoes.
    if (ps.relEmb[r] === 0) {
      if (x >= X.embargoOn && !bound(ps, a, b)) {
        ps.relEmb[r] = 1
        ps.relEmbRec[r] = ps.embA.length
        ps.embA.push(a); ps.embB.push(b); ps.embStart.push(s.year); ps.embEnd.push(-1)
      }
    } else if (x < X.embargoOff || bound(ps, a, b)) {
      ps.relEmb[r] = 0
      const k = ps.relEmbRec[r]
      if (k >= 0) { ps.embEnd[k] = s.year; ps.relEmbRec[r] = -1 }
    }
  }
  const k = step * X.rate < 1 ? step * X.rate : 1
  for (const p of ps.alive) {
    const tier = tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop)
    const w = s.wealth[ps.pCapital[p]] / (X.needRef * ps.pMass[p] + 1e-9)
    let mr = maxR[p]
    if (mr > 1) mr = 1
    let target = X.base[tier] + (ps.pWars[p] > 0 ? X.war : 0) + X.need * smoothstep(X.needHigh, X.needLow, w) + X.rivalry * mr
    if (target > X.max) target = X.max
    ps.pTariff[p] += k * (target - ps.pTariff[p])
  }
}

/** Embargo between polities p and q: 1 at war (no trade), 2 rivals short of war (no trade but in food), else 0. */
export function embargoCode(ps: PolityState, p: number, q: number): number {
  if (p < 0 || q < 0 || p === q) return 0
  const lo = p < q ? p : q, hi = p < q ? q : p
  const r = ps.relIndex.get(lo * 65536 + hi)
  if (r === undefined) return 0
  return ps.relWar[r] >= 0 ? 1 : ps.relEmb[r] === 1 ? 2 : 0
}

/** Sea cells on route r's path (counted once). */
export function routeSea(s: HistoryState, ps: PolityState, ts: TradeState, r: number): number {
  let n = ps.rSea[r]
  if (n >= 0) return n
  n = 0
  const path = ts.rPath[r], sea = s.terrain.sea
  for (let k = 0; k < path.length; k++) if (sea[path[k]]) n++
  ps.rSea[r] = n
  return n
}

/** Per polity this year: the capital of an enemy at war raiding its sea routes with privateers (-1 none). */
export function privateers(s: HistoryState, ps: PolityState, out: Int32Array): void {
  for (const p of ps.alive) out[p] = -1
  for (const w of ps.activeWars) {
    const p = ps.wAtt[w], q = ps.wDef[w]
    if (navyOf(s, ps, p) > 0 && out[q] < 0) out[q] = ps.pCapital[p]
    if (navyOf(s, ps, q) > 0 && out[p] < 0) out[p] = ps.pCapital[q]
  }
}

/** Naval strength of polity p from its ports and Seafaring (0 without PIRACY.navyPorts ports), 0..1. */
export function navyOf(s: HistoryState, ps: PolityState, p: number): number {
  if (ps.pPorts[p] < PIRACY.navyPorts) return 0
  const sea = s.tech[ps.pPeople[p] * TECH_FIELD_COUNT + TechField.Seafaring]
  const x = (sea - 1) / PIRACY.navySea
  return x <= 0 ? 0 : x > 1 ? 1 : x
}

/**
 * The market's view of every candidate pair this year (trade.ts, after the pairs are rebuilt): duties, embargo,
 * smuggling, costs of pirates, privateers, blockades and bandits. Also closes last year's accounts (revenue smoothing).
 */
export function pairPolicy(s: HistoryState, ps: PolityState, ts: TradeState): PairPolicy {
  const P = ts.pairCount
  let pc = ps.policy as PairPolicy | null
  let full = pc === null || pc.n !== P || ts.linkYear === s.year || s.year % POLITY.slowStep === 0
  if (pc === null || pc.code.length < P) { let n = pc === null ? 1024 : pc.code.length; while (n < P) n *= 2; pc = makePolicy(n); ps.policy = pc; full = true }
  pc.n = P
  // The capitals' incomes are watched (for the stats' revenue share).
  const capMark = ps.capMark
  for (let k = 0; k < ps.capList.length; k++) capMark[ps.capList[k]] = 0
  ps.capList.length = 0
  for (const p of ps.alive) {
    const c = ps.pCapital[p]
    if (c < ps.seen) { capMark[c] = 1; ps.capList.push(c); if (ps.watch[c] === 0) watch(ps, c) }
  }
  // (the accumulators below are emptied by flushAccounts, which runs before the pairs change)
  if (full) {
    // Every step (and when the pairs are rebuilt): the whole policy; the pairs between two polities are listed.
    const priv = ps.scratchPol2
    privateers(s, ps, priv)
    const anyState = ps.alive.length > 0
    if (ts.linkYear === s.year) for (let i = 0; i < P; i++) pc.route[i] = -1 // (new pairs)
    pc.epoch = ps.warEpoch
    const cross = pc.cross
    cross.length = 0
    for (let i = 0; i < P; i++) {
      pairOne(s, ps, ts, pc, i, priv, anyState)
      const x = pc.pa[i], y = pc.pb[i]
      if (x >= 0 && y >= 0 && x !== y) cross.push(i)
    }
  } else if (pc.epoch !== ps.warEpoch) {
    // Between steps, after a war began or ended: the pairs whose embargo changed.
    pc.epoch = ps.warEpoch
    const { pa, pb, block, cross } = pc
    let priv: Int32Array | null = null
    for (let k = 0; k < cross.length; k++) {
      const i = cross[k]
      if (embargoCode(ps, pa[i], pb[i]) === block[i]) continue
      if (priv === null) { priv = ps.scratchPol2; privateers(s, ps, priv) }
      pairOne(s, ps, ts, pc, i, priv, true)
    }
  }
  return pc
}

/** The policy of trade pair i this year (see pairPolicy). */
function pairOne(s: HistoryState, ps: PolityState, ts: TradeState, pc: PairPolicy, i: number, priv: Int32Array, anyState: boolean): void {
  const { polity, lawless, defenseD } = ps
  const X = SMUGGLE
  const a = ts.pairA[i], b = ts.pairB[i]
  const r = ts.pairRoute[i]
  const pa = a < ps.seen ? polity[a] : -1, pb = b < ps.seen ? polity[b] : -1
  pc.pa[i] = pa; pc.pb[i] = pb
  pc.code[i] = 0; pc.block[i] = 0
  // Costs on the way: pirates and privateers (sea), bandits (land), a blockade.
  let cost = 1, loss = 0, lossTo = -1
  let band = 0, bandBy = -1
  if (r >= 0 && r < ps.rBand.length) { band = ps.rBand[r]; bandBy = ps.rBandBy[r] } else if (anyState) {
    const la = a < ps.seen ? lawless[a] : 0, lb = b < ps.seen ? lawless[b] : 0
    band = la > lb ? la : lb
    bandBy = la > lb ? a : b
  }
  if (band > 0) {
    cost += BANDIT.cost * band
    if (band >= BANDIT.toll) { loss += BANDIT.tollShare; lossTo = bandBy }
  }
  let sea = 0
  if (r >= 0 && r < ps.rPir.length) {
    sea = routeSea(s, ps, ts, r)
    if (sea > 0) {
      let pir = ps.rPir[r], by = ps.rPirBy[r]
      // Privateers of an enemy at war.
      if (pa >= 0 && priv[pa] >= 0) { pir += PIRACY.privateer; if (by < 0) by = priv[pa] }
      else if (pb >= 0 && priv[pb] >= 0) { pir += PIRACY.privateer; if (by < 0) by = priv[pb] }
      if (pir > 0) { cost += PIRACY.lossCost * pir; loss += pir; if (by >= 0) lossTo = by }
      if (sea >= 2 && ((pa >= 0 && ps.pBlockade[pa] >= 0) || (pb >= 0 && ps.pBlockade[pb] >= 0))) { cost += PIRACY.lossCost * PIRACY.blockade; loss += PIRACY.blockade }
    }
  }
  pc.cost[i] = cost
  pc.loss[i] = loss > 0.9 ? 0.9 : loss
  pc.lossTo[i] = lossTo
  if (pa === pb || (pa >= 0 && pb >= 0 && bound(ps, pa, pb))) return
  // A border: duties and embargo (war: everything; rivalry short of war: all but food).
  const emb = pa >= 0 && pb >= 0 ? embargoCode(ps, pa, pb) : 0
  pc.block[i] = emb
  const block = emb !== 0
  const dAB = pb >= 0 ? ps.pTariff[pb] : 0, dBA = pa >= 0 ? ps.pTariff[pa] : 0
  if (!block && !(dAB > 0) && !(dBA > 0)) return
  pc.code[i] = 1
  pc.dAB[i] = emb === 1 ? 0 : dAB
  pc.dBA[i] = emb === 1 ? 0 : dBA
  // Smuggling: how hidden the way is, and how well each side polices it.
  const T = s.terrain
  const ca = s.cell[a], cb = s.cell[b]
  const coastal = sea > 0 || T.seaCoast[ca] === 1 || T.seaCoast[cb] === 1
  const transit = r >= 0 ? ts.rTransit[r] : ts.pairChain[i]
  const t0 = r >= 0 ? 0 : 1, t1 = r >= 0 ? transit.length : transit.length - 1
  let hub = -1, hubE = 2, outlaw = false
  for (let k = t0; k < t1; k++) {
    const x = transit[k]
    if (s.abandoned[x] >= 0 || x >= ps.seen) continue
    const px = polity[x]
    if (px < 0 || s.outpost[x]) outlaw = true
    const e = px < 0 ? 0 : enforcement(s, ps, x, px)
    if (e < hubE) { hubE = e; hub = x }
  }
  const hide = X.hideBase + (coastal ? X.hideSea : 0) + X.hideRough * 0.5 * (defenseD[ca] + defenseD[cb]) + (outlaw ? X.hideTransit : 0)
  pc.hide[i] = hide
  const ea = pa >= 0 ? enforcement(s, ps, a, pa) : 0, eb = pb >= 0 ? enforcement(s, ps, b, pb) : 0
  if (block) {
    const e = ea > eb ? ea : eb
    const sig = X.share * hide * (1 - e)
    pc.sAB[i] = sig > 0.9 ? 0.9 : sig; pc.sBA[i] = pc.sAB[i]
    pc.eAB[i] = e; pc.eBA[i] = e
    const enforcer = ea > eb ? pa : pb
    pc.qAB[i] = enforcer; pc.qBA[i] = enforcer
    pc.cAB[i] = ps.pCapital[enforcer]; pc.cBA[i] = ps.pCapital[enforcer]
  } else {
    const sab = dAB > 0 ? X.share * hide * (1 - eb) * (dAB / (dAB + X.tauHalf)) : 0
    const sba = dBA > 0 ? X.share * hide * (1 - ea) * (dBA / (dBA + X.tauHalf)) : 0
    pc.sAB[i] = sab > 0.9 ? 0.9 : sab; pc.sBA[i] = sba > 0.9 ? 0.9 : sba
    pc.eAB[i] = eb; pc.eBA[i] = ea
    pc.qAB[i] = pb; pc.qBA[i] = pa
    pc.cAB[i] = pb >= 0 ? ps.pCapital[pb] : -1; pc.cBA[i] = pa >= 0 ? ps.pCapital[pa] : -1
  }
  pc.hAB[i] = hub >= 0 && hubE < eb ? hub : b
  pc.hBA[i] = hub >= 0 && hubE < ea ? hub : a
}

/** Settlement id's income is watched from now on (a capital, or a smugglers' hub). */
export function watch(ps: PolityState, id: number): void {
  ps.watch[id] = 1
  ps.watchList.push(id)
}

/**
 * The market's year closed (trade.ts settle, `income` final): smoothed income and contraband income of the watched
 * settlements (capitals and hubs); those no longer either leave the list.
 */
export function incomeWatch(s: HistoryState, ps: PolityState, income: Float64Array): void {
  const k = SMUGGLE.smooth
  const list = ps.watchList
  let w = 0
  for (let t = 0; t < list.length; t++) {
    const id = list[t]
    if (s.abandoned[id] < 0) {
      ps.incSm[id] += k * (income[id] - ps.incSm[id])
      const sy = ps.smugYear[id]
      if (sy > 0 || ps.smugSm[id] > 0) {
        let x = ps.smugSm[id] + k * (sy - ps.smugSm[id])
        if (x < 1e-6) x = 0
        ps.smugSm[id] = x
        ps.smugYear[id] = 0
        ps.hubBest[id] = 0
      }
      if (ps.capMark[id] === 1 || ps.smugSm[id] > 0) { list[w++] = id; continue }
    }
    ps.watch[id] = 0
  }
  list.length = w
}
