// goods: the market's new rules (trade.ts calls these while HistoryState.goods is on).
//
// Stocking (goodsStock, as each trader is stocked at the start of the market): what it held from last year joins this
// year's output; Luxury is counted in class units by each crop's relative worth (a unit of clove, worth 60, is 60 / 14
// units of Luxury) and silk yields Finery; furs, the new classes' demand (tools and arms, fine cloth, a desired holding of
// Treasure, the courts of capitals) and the workshops' demand for their inputs.
// High-value classes (hvPrice, hvPair): scarcity prices worth * (1 + k) / (k + S / D), up to 6x worth; transport per class
// unit falls with the value density of the sender's mix; every trading settlement the goods pass through takes its cut as
// a real cost (middlemen); a mart buys at its forward price (merchants who see two markets ahead) until its warehouses are
// full; the variety mix moves with each flow.
// Carry-over (goodsSettle, after the market): workshops work the inputs at hand (smithing, dyeing, fine cloth) and their
// output keeps for next year; each class is consumed up to its demand (Treasure only wears), Metalware into tools and
// arms stocks; the rest keeps (a share a year, up to some years of demand plus a mart's merchant capital).

import { GOOD_COUNT, Good, TECH_FIELD_COUNT, TechField, VarietyKind } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import { CASHCROP, GOODS, TRADE, WEALTH } from '../params.ts'
import type { HistoryState } from '../state.ts'
import type { TradeState } from '../trade.ts'
import { CASH, SP, SPECIES_TABLE } from '../species.ts'
import { stimFlow } from '../cashCrops.ts'
import { Tier, tierOf } from '../polity/state.ts'
import { CLASS, DEMAND, FLAGS, FURS, METAL, MIDDLE, STOCK, TRADITION, WORKSHOP } from './params.ts'
import type { GoodsState } from './state.ts'
import { K, M, MIX_OF, Maker, density, ensureGoods, mixAdd, mixFlow, mixScale, newVariety, noteIncome } from './state.ts'

const G = GOOD_COUNT
const NC = CASH.length
const W = CLASS.worth
const HVG = CLASS.hv
/** Cash crops index (CASH order) of silk, and whether each cash crop is a raw luxury (class Luxury in class units). */
const SILK_Q = CASH.indexOf(SP.silk)
const LUX_Q: number[] = []
for (let q = 0; q < NC; q++) if (SPECIES_TABLE[CASH[q]].good === Good.Luxury && CASH[q] !== SP.silk) LUX_Q.push(q)
const DYE_SPECIES: number[] = [SP.indigo, SP.cochineal]
/** Workshop input classes with an input demand (scratch index): Ore, Timber, Cloth, Luxury. */
const IN_CLASSES = [Good.Ore, Good.Timber, Good.Cloth, Good.Luxury]
const IN_INDEX: Int32Array = (() => { const a = new Int32Array(G).fill(-1); IN_CLASSES.forEach((c, i) => { a[c] = i }); return a })()

/** Per-settlement scratch of this year's market (grown): artisans, input demand per input class, tools and arms demand. */
let ART = new Float64Array(0), INDEM = new Float64Array(0), DTOOLS = new Float64Array(0), DARMS = new Float64Array(0)
function scratch(n: number): void {
  if (ART.length >= n) return
  let m = Math.max(256, ART.length)
  while (m < n) m *= 2
  ART = new Float64Array(m); INDEM = new Float64Array(m * 4); DTOOLS = new Float64Array(m); DARMS = new Float64Array(m)
}

/** Crop variety of species x grown by people p (created the first time that people brings it to market). */
function cropVariety(s: HistoryState, g: GoodsState, p: number, x: number): number {
  const i = p * g.spClass.length + x
  let v = g.cropVar[i]
  if (v < 0) {
    const d = SPECIES_TABLE[x]
    v = newVariety(s, g, g.spClass[x], VarietyKind.Crop, x, p, Maker.People, p, d.value, g.spRel[x], DYE_SPECIES.indexOf(x) >= 0)
    g.cropVar[i] = v
  }
  return v
}

/** Wild furs of people p. */
function furVariety(s: HistoryState, g: GoodsState, p: number): number {
  let v = g.furVar[p]
  if (v < 0) { v = newVariety(s, g, Good.Luxury, VarietyKind.Wild, -1, p, Maker.People, p, 20, FURS.rel); g.furVar[p] = v }
  return v
}

/** Court factor of settlement id's demand for luxuries: 1 + courtK * [capital] * tier index. */
function courtOf(s: HistoryState, id: number): number {
  const ps = s.pol
  if (ps === null || id >= ps.seen) return 1
  const p = ps.polity[id]
  if (p < 0 || ps.pCapital[p] !== id) return 1
  const t = tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1)
  return 1 + DEMAND.courtK * (t === Tier.Empire ? 2 : t === Tier.Kingdom ? 1 : 0)
}

/** Arms demand of settlement id: members of a state buy more, capitals and border towns twice, three times at war. */
function armsDemand(s: HistoryState, id: number, p: number): number {
  const X = METAL
  const ps = s.pol
  let d = X.arms * p
  if (ps === null || id >= ps.seen) return d * X.stateless
  const q = ps.polity[id]
  if (q < 0) return d * X.stateless
  let front = ps.pCapital[q] === id
  if (!front) {
    const T = s.terrain
    const c = s.cell[id]
    for (let k = T.catchOff[c]; k < T.catchBase[c] && !front; k++) if (ps.hostile[T.catchCell[k]]) front = true
  }
  if (front) d *= X.front
  if (ps.pWars[q] > 0) d *= X.war
  return d
}

/** Tradition seat factor of settlement id for craft c: [variety, class-unit multiplier] in SEAT. */
const SEAT = { v: 0, mul: 1 }
function seat(g: GoodsState, id: number, c: number): void {
  const t = g.seatOf[id * 4 + c]
  if (t < 0) { SEAT.v = 0; SEAT.mul = 1; return }
  const Q = g.tQ[t]
  SEAT.v = g.tVar[t]
  SEAT.mul = TRADITION.base[c] * (0.6 + 0.4 * Q) * (0.8 + 0.2 * Q)
}

/**
 * Market hook (trade.ts, stocking trader id at offset o, after cashCrops.ts marketGoods): held stock, Luxury and silk in
 * class units by variety, furs, the new classes' demand and worth, workshop input demand. `demTech` is the needs' Crafts factor.
 */
export function goodsStock(s: HistoryState, ts: TradeState, g: GoodsState, id: number, o: number, demTech: number): void {
  ensureGoods(g, s.count)
  scratch(s.count)
  const { stock, demand, worth } = ts
  const p = s.pop[id]
  const people = s.people[id]
  const held = g.held
  const ho = id * G
  // Bulk classes: this year's output plus what was kept.
  for (let c = 3; c <= 6; c++) stock[o + c] += held[ho + c]
  // Raw luxuries in class units, by grower; silk as Finery.
  const pot = g.pot[id]
  const co = id * NC
  let lux = held[ho + Good.Luxury]
  for (let t = 0; t < LUX_Q.length; t++) {
    const q = LUX_Q[t]
    const raw = g.cashCoef[co + q] * pot
    if (!(raw > 0)) continue
    const x = CASH[q]
    const units = raw * g.spRel[x]
    lux += units
    const v = cropVariety(s, g, people, x)
    mixAdd(g, id, MIX_OF[Good.Luxury], v, units)
    g.vOut[v] += units
    if (units > g.vOriginOut[v]) { g.vOriginOut[v] = units; g.vOrigin[v] = id }
  }
  // Furs of the far north.
  const y = s.world.grid.positions[s.cell[id] * 3 + 1]
  if (y >= FURS.polarY || y <= -FURS.polarY) {
    const b = s.world.biome[s.cell[id]]
    if (b === 3 || b === 4) {
      const units = FURS.perHead * p
      lux += units
      const v = furVariety(s, g, people)
      mixAdd(g, id, MIX_OF[Good.Luxury], v, units)
      g.vOut[v] += units
    }
  }
  stock[o + Good.Luxury] = lux
  let fin = held[ho + Good.Finery]
  g.silkOut[id] = 0
  if (SILK_Q >= 0) {
    const raw = g.cashCoef[co + SILK_Q] * pot
    if (raw > 0) {
      seat(g, id, 0)
      const units = raw * g.spRel[SP.silk] * (SEAT.v > 0 ? SEAT.mul / TRADITION.base[0] : 1)
      fin += units
      g.silkOut[id] = units
      const v = SEAT.v > 0 ? SEAT.v : cropVariety(s, g, people, SP.silk)
      mixAdd(g, id, MIX_OF[Good.Finery], v, units)
      g.vOut[v] += units
      if (units > g.vOriginOut[v]) { g.vOriginOut[v] = units; g.vOrigin[v] = id }
    }
  }
  stock[o + Good.Finery] = fin
  stock[o + Good.Metalware] = held[ho + Good.Metalware]
  stock[o + Good.Treasure] = held[ho + Good.Treasure]
  stock[o + Good.Wares] = held[ho + Good.Wares]
  // Stimulants kept by species.
  const v2 = s.sp.v2
  const NK = v2.NK
  let stim = held[ho + Good.Stimulant]
  if (stim > 0) for (let k = 0; k < NK; k++) v2.amt[id * NK + k] += g.heldAmt[id * NK + k]
  stock[o + Good.Stimulant] += stim
  // Demand: courts, fine cloth, tools and arms, the desired holding of Treasure.
  const w = p > 0 ? s.wealth[id] / p : 0
  const wf = w / (w + WEALTH.half)
  const court = courtOf(s, id)
  const X = CASHCROP
  demand[o + Good.Luxury] *= court
  demand[o + Good.Finery] = DEMAND.finery * p * (X.luxBase + X.luxTown * smoothstep(X.luxTownLow, X.luxTownHigh, p) + X.luxWealth * wf) * demTech * court
  const dt = DEMAND.tools * p * demTech
  const da = armsDemand(s, id, p)
  DTOOLS[id] = dt
  DARMS[id] = da
  demand[o + Good.Metalware] = dt + da
  demand[o + Good.Treasure] = DEMAND.treasure * p * (DEMAND.treasureBase + wf) * court
  demand[o + Good.Wares] = GOODS.need[Good.Wares] * p
  worth[o + Good.Metalware] = W[Good.Metalware]
  worth[o + Good.Finery] = W[Good.Finery] * ts.bid[id]
  worth[o + Good.Treasure] = W[Good.Treasure]
  worth[o + Good.Wares] = W[Good.Wares]
  // Workshops: artisans, shares (toward the margin each recipe earns at last year's prices), input demand.
  const io = id * 4
  INDEM[io] = 0; INDEM[io + 1] = 0; INDEM[io + 2] = 0; INDEM[io + 3] = 0
  const X2 = WORKSHOP
  const pt = p > 0 ? g.tools[id] / p : 0
  const tf = pt / (pt + METAL.toolHalf)
  const art = FLAGS.workshops ? X2.craftShare * p * smoothstep(X2.artLow, X2.artHigh, p) * (1 + METAL.toolArtisan * tf) : 0
  ART[id] = art
  if (!(art > 0)) return
  const tech = s.tech
  const to = people * TECH_FIELD_COUNT
  const price = ts.price
  let sum = 0
  for (let r = 0; r < 3; r++) {
    const f = tech[to + X2.field[r]]
    const out = X2.out[r]
    let cost = X2.need1[r] * price[o + X2.in1[r]]
    if (X2.in2[r] >= 0) cost += X2.need2[r] * price[o + X2.in2[r]]
    const pOut = price[o + out] > 0 ? price[o + out] : W[out]
    const margin = pOut - cost
    let want = smoothstep(0, 1, margin / (W[out] * X2.marginRef)) * smoothstep(X2.gate[r] - 0.4, X2.gate[r] + 0.2, f)
    if (r === 1 && !(dyeIn(g, id) > 0)) want = 0 // (no dye in stock)
    TGT[r] = want
    sum += want
  }
  const norm = sum > 1 ? 1 / sum : 1
  for (let r = 0; r < 3; r++) {
    const sh = g.wShare[id * 3 + r] + X2.rate * (TGT[r] * norm - g.wShare[id * 3 + r])
    g.wShare[id * 3 + r] = sh < 1e-4 && TGT[r] === 0 ? 0 : sh
    const f = tech[to + X2.field[r]]
    const outN = g.wShare[id * 3 + r] * art * X2.prod[r] * f * smoothstep(X2.gate[r] - 0.4, X2.gate[r] + 0.2, f)
    if (!(outN > 0)) continue
    INDEM[io + IN_INDEX[X2.in1[r]]] += X2.need1[r] * outN
    if (X2.in2[r] >= 0) INDEM[io + IN_INDEX[X2.in2[r]]] += X2.need2[r] * outN
  }
  for (let j = 0; j < 4; j++) if (INDEM[io + j] > 0) demand[o + IN_CLASSES[j]] += INDEM[io + j]
}
const TGT = new Float64Array(3)

/** Dye in trader id's Luxury stock (named dye varieties). */
function dyeIn(g: GoodsState, id: number): number {
  const ol = (id * M + MIX_OF[Good.Luxury]) * K
  let a = 0
  for (let k = 0; k < K; k++) { const v = g.mixV[ol + k]; if (v > 0 && g.vDye[v]) a += g.mixA[ol + k] }
  return a
}

/** Scarcity price of an HV class at index k = id * G + g (S / D = x): worth * (1 + k) / (k + x), and its derivative in stock. */
export function hvPrice(ts: TradeState, k: number, D0: number): void {
  const D = D0 > 1e-9 ? D0 : 1e-9
  const x = ts.stock[k] / D
  const kk = STOCK.k
  const den = kk + x
  const V = ts.worth[k]
  const pr = (V * (1 + kk)) / den
  ts.price[k] = pr
  ts.deriv[k] = pr / den / D
}

/** Merchant appetite theta of mart id for class g: 1 / (1 + merchant stock / merchant capital). */
function theta(s: HistoryState, ts: TradeState, id: number, g: number): number {
  const k = id * G + g
  const ms = ts.stock[k] - STOCK.capYearsHV * ts.demand[k]
  if (!(ms > 0)) return 1
  const cap = (STOCK.kappa * s.wealth[id]) / W[g]
  return cap > 0 ? 1 / (1 + ms / cap) : 0
}

/** Buying price of class g at settlement id from `seller`: its price, or at a mart its forward price times its appetite if higher (not from the mart its forward price comes through). */
export function buyPrice(s: HistoryState, ts: TradeState, g: GoodsState, id: number, gd: number, seller: number): number {
  const p = ts.price[id * G + gd]
  if (!g.isMart[id] || g.fwdVia[id * G + gd] === seller) return p
  const f = g.fwd[id * G + gd] * theta(s, ts, id, gd)
  return f > p ? f : p
}

/** Reservation price of class gd at settlement id: what its merchants would get for it elsewhere (a mart's forward price times its appetite), or its own price. */
export function sellPrice(s: HistoryState, ts: TradeState, g: GoodsState, id: number, gd: number): number {
  const p = ts.price[id * G + gd]
  if (!g.isMart[id]) return p
  const f = g.fwd[id * G + gd] * theta(s, ts, id, gd)
  return f > p ? f : p
}

/**
 * Market hook (trade.ts, the pair loop): HV class gd on local pair pi between a and b, at the pair's transport factor c
 * (route cost with hurdle, pack animals and Crafts). Moves goods from cheap to dear as the bulk rule does, at the buyers'
 * bids, with value density, middlemen's cuts and the variety mix; buyers of Luxury, Stimulant and Finery pay for them.
 */
export function hvPair(s: HistoryState, ts: TradeState, g: GoodsState, pi: number, a: number, b: number, gd: number, c: number): void {
  const stock = ts.stock, price = ts.price, deriv = ts.deriv
  const oa = a * G + gd, ob = b * G + gd
  const m = MIX_OF[gd]
  const pa = price[oa], pb = price[ob]
  const Pa = buyPrice(s, ts, g, a, gd, b), Pb = buyPrice(s, ts, g, b, gd, a)
  // Sellers hold out for what their merchants would get elsewhere: goods move only up the merchants' expectations (no cycles).
  const ra = sellPrice(s, ts, g, a, gd), rb = sellPrice(s, ts, g, b, gd)
  const mu = g.pairMu[pi]
  const tu = CLASS.transport[gd] * c
  const minGap = TRADE.minGap * GOODS.value[gd]
  const sa = stock[oa], sb = stock[ob]
  const gAB = Pb - ra, gBA = Pa - rb
  let nAB = -1, nBA = -1
  if (gAB > minGap && sa > 0) nAB = gAB - tu * (m >= 0 ? density(g, a, m, sa) : 1) - mu * pa - minGap
  if (gBA > minGap && sb > 0) nBA = gBA - tu * (m >= 0 ? density(g, b, m, sb) : 1) - mu * pb - minGap
  let from: number, to: number, net: number, dir: number
  if (nAB > 0 && nAB >= nBA) { from = a; to = b; net = nAB + minGap; dir = 0 }
  else if (nBA > 0) { from = b; to = a; net = nBA + minGap; dir = 1 }
  else return
  // Income on the realised gap (to the buyer's own price; a merchant's forward bid earns only when the goods sell on).
  const real = (dir === 0 ? pb - pa - tu * (m >= 0 ? density(g, a, m, sa) : 1) - mu * pa : pa - pb - tu * (m >= 0 ? density(g, b, m, sb) : 1) - mu * pb)
  const kf = from * G + gd, kt = to * G + gd
  let q = (TRADE.damping * net) / (deriv[kf] + deriv[kt])
  const cap = CASHCROP.maxShare * stock[kf]
  if (q > cap) q = cap
  if (!(q > 1e-6)) return
  const before = stock[kf]
  const pFrom = price[kf]
  stock[kf] = before - q
  stock[kt] += q
  if (m >= 0) mixFlow(g, from, to, m, q, before)
  if (gd === Good.Luxury || gd === Good.Stimulant || (gd === Good.Finery && DEMAND.fineryPays)) stimFlow(s.sp.v2, gd, from, to, q, before, price[kt])
  const cap1 = STOCK.incomeGap * ts.worth[kt]
  const earn = q * (0.5 * (real > 0 ? (real < cap1 ? real : cap1) : 0) + TRADE.margin * GOODS.value[gd])
  ts.income[from] += earn
  noteIncome(s, g, gd, earn)
  ts.pairFlow[(pi * G + gd) * 2 + dir] += q
  g.pairHv[pi] += q * pFrom
  hvPrice(ts, kf, ts.demand[kf])
  hvPrice(ts, kt, ts.demand[kt])
}

/** Cut mu_x of transit settlement x (merchant's return on capital for a season plus the toll). */
export function cutOf(s: HistoryState, x: number): number {
  const cr = s.tech[s.people[x] * TECH_FIELD_COUNT + TechField.Crafts]
  return (MIDDLE.r0 / (1 + MIDDLE.rTech * (cr - 1))) * MIDDLE.season + MIDDLE.toll
}

/** Transit cuts of every local pair (sum over its trading transit settlements), reckoned again every MIDDLE.refresh years or when the pairs change. */
export function pairCuts(s: HistoryState, ts: TradeState, g: GoodsState): void {
  const P = ts.pairCount
  if (g.pairFor === ts.pairA && s.year - g.pairYear < MIDDLE.refresh) { g.pairHv.fill(0, 0, P); return }
  if (g.pairMu.length < P) { g.pairMu = new Float64Array(P); g.pairHv = new Float64Array(P) }
  g.pairHv.fill(0, 0, P)
  for (let p = 0; p < P; p++) {
    const r = ts.pairRoute[p]
    let mu = 0
    if (r >= 0) {
      const tr = ts.rTransit[r]
      for (let k = 0; k < tr.length; k++) { const x = tr[k]; if (s.abandoned[x] < 0 && ts.trader[x]) mu += cutOf(s, x) }
    } else {
      const ch = ts.pairChain[p]
      for (let k = 1; k + 1 < ch.length; k++) { const x = ch[k]; if (s.abandoned[x] < 0 && ts.trader[x]) mu += cutOf(s, x) }
    }
    g.pairMu[p] = FLAGS.middlemen ? mu : 0
  }
  g.pairFor = ts.pairA
  g.pairYear = s.year
}

/** Value of HV goods moved on pair p this year in loads (for the bulk toll, which no longer applies to them). */
export function hvLoads(ts: TradeState, p: number): number {
  let v = 0
  const o = p * G * 2
  for (let gd = 7; gd < G; gd++) if (HVG[gd]) v += (ts.pairFlow[o + gd * 2] + ts.pairFlow[o + gd * 2 + 1]) * GOODS.value[gd]
  return v
}

/**
 * Market hook (trade.ts, after the market and the food it fed): workshops work their inputs; each class is consumed up to its
 * demand (Metalware into tools and arms, Treasure only wears); what is left keeps for next year, up to its cap; tools and arms wear.
 */
export function goodsSettle(s: HistoryState, ts: TradeState, g: GoodsState): void {
  const living = s.living
  const { stock, demand, trader } = ts
  const tech = s.tech
  const X2 = WORKSHOP
  const v2 = s.sp.v2
  const NK = v2.NK
  const smithAct = g.smithAct, workAct = g.workAct
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const ho = id * G
    if (!trader[id]) {
      // Non-traders keep nothing but what a mine they work brings up (held by the deposit system).
      g.wOut[id * 3] = 0; g.wOut[id * 3 + 1] = 0; g.wOut[id * 3 + 2] = 0
      g.tools[id] *= 1 - METAL.toolWear
      g.arms[id] *= 1 - METAL.armsWear
      const p0 = s.pop[id]
      const pt = p0 > 0 ? g.tools[id] / p0 : 0
      g.toolMul[id] = 1 + METAL.toolFarm * (pt / (pt + METAL.toolHalf))
      for (let c = 3; c < G; c++) if (c !== Good.Treasure && c !== Good.Luxury) g.held[ho + c] = 0
      continue
    }
    const o = id * G
    const p = s.pop[id]
    const people = s.people[id]
    const to = people * TECH_FIELD_COUNT
    // Workshops.
    const art = ART[id]
    for (let r = 0; r < 3; r++) {
      g.wOut[id * 3 + r] = 0
      const sh = g.wShare[id * 3 + r]
      if (!(art > 0) || !(sh > 0)) continue
      const f = tech[to + X2.field[r]]
      const n = sh * art * X2.prod[r] * f * smoothstep(X2.gate[r] - 0.4, X2.gate[r] + 0.2, f)
      if (!(n > 0)) continue
      const i1 = o + X2.in1[r]
      let use = stock[i1] / (X2.need1[r] * n)
      let dye = 0
      if (X2.in2[r] === Good.Luxury) { dye = dyeIn(g, id); const u2 = dye / (X2.need2[r] * n); if (u2 < use) use = u2 }
      else if (X2.in2[r] >= 0) { const u2 = stock[o + X2.in2[r]] / (X2.need2[r] * n); if (u2 < use) use = u2 }
      if (use > 1) use = 1
      if (!(use > 0)) continue
      const made = n * use
      stock[i1] -= X2.need1[r] * made
      let purple = 0
      if (X2.in2[r] === Good.Luxury) {
        const need = X2.need2[r] * made
        purple = useDye(s, g, id, need, dye, people)
        stock[o + Good.Luxury] -= need
      } else if (X2.in2[r] >= 0) stock[o + X2.in2[r]] -= X2.need2[r] * made
      // Output, by tradition (a seat) or Common.
      let units = made
      let named = 0
      let v = 0
      if (r === 0) {
        seat(g, id, 3)
        smithAct[people] += made
        if (SEAT.v > 0) {
          const fine = made * X2.bladeShare * smoothstep(X2.bladeGate - 0.4, X2.bladeGate + 0.2, f)
          named = fine * SEAT.mul
          units = made - fine + named
          v = SEAT.v
          g.tOut[g.seatOf[id * 4 + 3]] += named
        }
      } else {
        const craft = r === 1 ? 1 : 2
        seat(g, id, craft)
        units = made * (1 + purple * (TRADITION.purpleRel - 1)) * SEAT.mul
        workAct[people] += units
        if (SEAT.v > 0) { v = SEAT.v; named = units; g.tOut[g.seatOf[id * 4 + craft]] += units }
      }
      g.wOut[id * 3 + r] = units
      OUTBUF[r] = units
      OUTV[r] = v
      OUTN[r] = named
      if (v > 0) g.vOut[v] += named
    }
    // Consumption and carry-over.
    const io = id * 4
    for (let c = 3; c < G; c++) {
      const k = o + c
      const S = stock[k]
      if (!(S > 0)) { g.held[ho + c] = 0; if (c === Good.Stimulant) for (let j = 0; j < NK; j++) g.heldAmt[id * NK + j] = 0; continue }
      const ii = IN_INDEX[c]
      let D = demand[k] - (ii >= 0 ? INDEM[io + ii] : 0)
      if (D < 0) D = 0
      const C = c === Good.Treasure ? STOCK.treasureWear * S : S < D ? S : D
      if (c === Good.Metalware && C > 0) {
        const dtl = DTOOLS[id], dar = DARMS[id]
        const tot = dtl + dar
        if (tot > 0) {
          g.tools[id] += (C * dtl) / tot
          const rel = armsRel(g, id, S)
          const add = (C * dar) / tot
          const before = g.arms[id]
          g.arms[id] = before + add
          g.armsRel[id] = g.arms[id] > 0 ? (g.armsRel[id] * before + rel * add) / g.arms[id] : 1
        }
      }
      const L = S - C
      const hv = HVG[c] === 1
      let cap = (hv ? STOCK.capYearsHV : STOCK.capYearsBulk) * demand[k]
      if (g.isMart[id] && hv) cap += (STOCK.kappa * s.wealth[id]) / W[c]
      let h = STOCK.keep[c] * L
      if (h > cap) h = cap
      if (!FLAGS.carry) h = 0
      if (!(h > 0)) h = 0
      g.held[ho + c] = h
      const m = MIX_OF[c]
      if (m >= 0) mixScale(g, id, m, h / S)
      if (c === Good.Stimulant) {
        const fh = h / S, fc = C / S
        for (let j = 0; j < NK; j++) { const x = v2.amt[id * NK + j]; g.heldAmt[id * NK + j] = x * fh; v2.amt[id * NK + j] = x * fc }
      }
    }
    // Workshop output keeps for next year, its named part in the mix.
    for (let r = 0; r < 3; r++) {
      if (OUTBUF[r] > 0) {
        g.held[ho + X2.out[r]] += OUTBUF[r]
        if (OUTV[r] > 0) mixAdd(g, id, MIX_OF[X2.out[r]], OUTV[r], OUTN[r])
      }
      OUTBUF[r] = 0; OUTV[r] = 0; OUTN[r] = 0
    }
    // Tools and arms wear; the farm factor.
    g.tools[id] *= 1 - METAL.toolWear
    g.arms[id] *= 1 - METAL.armsWear
    const pt = p > 0 ? g.tools[id] / p : 0
    g.toolMul[id] = 1 + METAL.toolFarm * (pt / (pt + METAL.toolHalf))
  }
}
/** This trader's workshop output per recipe: class units, named variety (0 Common), named units. */
const OUTBUF = new Float64Array(3), OUTV = new Int32Array(3), OUTN = new Float64Array(3)

/** Arms quality of the Metalware in trader id's stock S: 1 + (rel - 1) * share for its named fine blades. */
function armsRel(g: GoodsState, id: number, S: number): number {
  const o = (id * M + MIX_OF[Good.Metalware]) * K
  let r = 1
  for (let k = 0; k < K; k++) { const v = g.mixV[o + k]; if (v > 0) r += (g.vRel[v] - 1) * (g.mixA[o + k] / S) }
  return r
}

/**
 * Uses `need` units of dye from trader id's Luxury stock (named dye slots, `avail` of them in all), in proportion. Returns the
 * share that was murex purple dyed by a people that may use it (holders of the purple secret, or anyone before it exists).
 */
function useDye(s: HistoryState, g: GoodsState, id: number, need: number, avail: number, people: number): number {
  if (!(avail > 0)) return 0
  const f = need / avail
  const ol = (id * M + MIX_OF[Good.Luxury]) * K
  let purple = 0
  for (let k = 0; k < K; k++) {
    const v = g.mixV[ol + k]
    if (v <= 0 || !g.vDye[v]) continue
    const used = g.mixA[ol + k] * f
    if (g.vKind[v] === VarietyKind.Deposit && (g.purple < 0 || g.sHeld[g.purple][people])) purple += used
    g.mixA[ol + k] -= used
    if (!(g.mixA[ol + k] > 1e-6)) { g.mixV[ol + k] = 0; g.mixA[ol + k] = 0 }
  }
  void s
  return need > 0 ? purple / need : 0
}
