// Cash crops (M10): fibre, luxury and stimulant species grown for trade on part of a settlement's fields.
//
// Every CASHCROP.step years for every settlement, the share x_c of its crop land under each cash crop c it
// holds and that fits its land (catchment fit >= CASHCROP.minFit) moves toward
//   x*_c = xMax * t_c / max(1, sum t),  t_c = smoothstep(0, 1, price_g * cashYield_c * fit_c / max(grain price, minFoodPrice) - 1),
// with price_g the price of c's good at the settlement after last year's trade (trade.ts): a crop pays where what the
// land yields of it fetches more than grain would; where the settlement's own crop already gluts its market (nobody it
// trades with buys), the price falls and so does the share. xMax = base + prosperous * prosperity, times smoothstep of
// the food ratio (a hungry settlement grows food). Settlements that do not trade grow only a home share of stimulants.
// The land so used is taken from food (species.keep, applied by population.ts) and wears its soil at the crop's wear
// (wearPass: per cell, land.ts). Output (marketGoods, called by the market when it stocks a trader): x_c * potential
// crop food * cashYield_c * fit_c units of the good a year (silk and sugar only with craft skill); wool-bearing herds add
// Cloth from the livestock part. Needs: Cloth for everyone (more with wealth), Luxury mostly in large and rich towns,
// Stimulant growing with habit (habit.ts), all with Crafts; the rich bid more for Luxury, the habituated for Stimulant.
//
// Each trader's stimulant stock is tracked per species as it moves (stimFlow), for habit and drain (habit.ts), and
// buyers of Luxury and Stimulant pay CASHCROP.pay of their value out of their wealth: luxuries are a sink of wealth,
// producers and the traders between them grow rich, and a habit's drain is a real outflow. No randomness.

import { GOOD_COUNT, SpeciesCategory, TECH_FIELD_COUNT, TechField } from '../../contract.ts'
import { smoothstep } from '../util.ts'
import { CASHCROP, GOODS, HABIT, SPECIES2, TECHNIQUE2, WEALTH } from './params.ts'
import type { HistoryState } from './state.ts'
import type { MarketView } from './species.ts'
import { CASH, hasBit, NST, prosperityOf, SP, SPECIES_TABLE, STAPLE_IDS, STIM_INDEX, STIMULANTS, TECH_BIT, TQ } from './species.ts'
import type { SpeciesV2 } from './speciesV2.ts'
import { cashCoefReset, cashCoefSet, cashMinFit, cashPrice } from './goods/hooks.ts' // goods:

const G = GOOD_COUNT // (goods: 13 classes now)

/** Recomputes settlement `id`'s cash-crop shares, outputs per unit of land and food multiplier (see the header). */
export function cashUpdate(s: HistoryState, v: SpeciesV2, tv: MarketView, id: number): void {
  const sp = s.sp
  const N = sp.N
  const c = s.cell[id]
  const m0 = sp.m0[id], m1 = sp.m1[id]
  const X = CASHCROP
  const NC = CASH.length
  const co = id * NC
  const fed = smoothstep(X.fedLow, X.fedHigh, s.food[id])
  const trader = id < tv.trader.length && tv.trader[id] === 1
  const p = s.people[id]
  const crafts = s.tech[p * TECH_FIELD_COUNT + TechField.Crafts]
  const o = id * G
  const pf = trader && tv.price[o] > SPECIES2.minFoodPrice ? tv.price[o] : SPECIES2.minFoodPrice
  const tgt = TGT
  const gx = s.goods // goods: Luxury in class units by relative worth, silk as Finery, rarer luxury crops
  let sum = 0
  // The cash crops it holds (a species once held is never lost, so no other has a share).
  let nh = 0
  for (let m = (m0 & CASH0) >>> 0; m !== 0; m &= m - 1) HELDQ[nh++] = CASH_Q[31 - Math.clz32(m & -m)]
  for (let m = (m1 & CASH1) >>> 0; m !== 0; m &= m - 1) HELDQ[nh++] = CASH_Q[63 - Math.clz32(m & -m)]
  for (let h = 0; h < nh; h++) {
    const q = HELDQ[h]
    tgt[q] = 0
    const x = CASH[q]
    const fc = sp.fitCatch[x * N + c]
    if (fc < (gx !== null ? cashMinFit(gx, x) : X.minFit)) continue
    const d = SPECIES_TABLE[x]
    let t: number
    if (trader) t = smoothstep(0, 1, ((gx !== null ? cashPrice(gx, tv.price, o, x) : tv.price[o + d.good]) * d.cashYield * fc * skill(d.crafts, crafts)) / pf - 1)
    else t = d.category === SpeciesCategory.Stimulant ? 1 : 0
    tgt[q] = t
    sum += t
  }
  const xMax = sum > 0 ? (trader ? (X.base + X.prosperous * prosperityOf(s, id)) * fed : X.home * fed) : 0
  const norm = sum > 1 ? 1 / sum : 1
  if (RATE < 0) { let r = 1; for (let k = 0; k < X.step; k++) r *= 1 - X.rate; RATE = 1 - r }
  const rate = RATE
  const v0 = id * 3
  v.coef[v0] = 0; v.coef[v0 + 1] = 0; v.coef[v0 + 2] = 0
  const NK = v.NK
  for (let k = 0; k < NK; k++) v.stimCoef[id * NK + k] = 0
  if (gx !== null) cashCoefReset(gx, id, s.count, NC) // goods:
  let tot = 0
  for (let h = 0; h < nh; h++) {
    const q = HELDQ[h]
    let x = sp.cashX[co + q]
    const want = xMax * tgt[q] * norm
    if (x === 0 && want === 0) continue
    x += rate * (want - x)
    if (want === 0 && x < 1e-4) x = 0
    sp.cashX[co + q] = x
    if (x <= 0) continue
    tot += x
    const sx = CASH[q]
    const d = SPECIES_TABLE[sx]
    const out = x * d.cashYield * sp.fitCatch[sx * N + c] * skill(d.crafts, crafts)
    v.coef[v0 + d.good - 6] += out
    if (gx !== null) cashCoefSet(gx, id, NC, q, out) // goods: per crop, for its variety
    const k = STIM_INDEX[sx]
    if (k >= 0) v.stimCoef[id * NK + k] += out
  }
  sp.cashTot[id] = tot
  // Wool: the best wool-bearing herd held that fits.
  let wool = 0
  if (hasBit(m0, m1, SP.sheepGoat) || hasBit(m0, m1, SP.llama) || hasBit(m0, m1, SP.coldHerd)) {
    for (const h of WOOL) if (hasBit(m0, m1, h)) { const w = SPECIES_TABLE[h].wool * sp.fitCatch[h * N + c]; if (w > wool) wool = w }
  }
  v.wool[id] = wool
  // Food multiplier: fields under cash crops (of the crop part of the farm food), pellagra, habit harm.
  const ff = s.fishFrac[id], lf = s.liveFrac[id]
  const farm = 1 - ff
  const cropFrac = farm > 0 ? (1 - ff - lf) / farm : 0
  const cut = tot * (cropFrac > 0 ? cropFrac : 0)
  v.cut[id] = cut
  let keep = 1 - cut
  if (!hasBit(m0, m1, TECH_BIT + TQ.nixtamal) && hasBit(m0, m1, SP.maize)) {
    const maize = sp.share[id * NST + MAIZE_T] * (1 - ff - lf)
    const T2 = TECHNIQUE2
    if (maize >= T2.pellagraLow) {
      keep *= 1 - T2.pellagra * smoothstep(T2.pellagraLow, T2.pellagraHigh, maize)
      if (v.pellagra[p] < 0) v.pellagra[p] = s.year
    }
  }
  if (HABIT.harm) {
    let h = 0
    for (let k = 0; k < NK; k++) h += SPECIES_TABLE[STIMULANTS[k]].harmEcon * v.habit[p * NK + k]
    keep *= 1 - h
  }
  sp.keep[id] = keep
}
const TGT = new Float64Array(64)
let RATE = -1
const WOOL = [SP.sheepGoat, SP.llama, SP.coldHerd]
/** Mask words of the cash crops, each species' index in CASH, scratch of the held ones. */
let CASH0 = 0, CASH1 = 0
const CASH_Q = new Int32Array(64).fill(-1)
CASH.forEach((x, q) => { CASH_Q[x] = q; if (x < 32) CASH0 |= 1 << x; else CASH1 |= 1 << (x - 32) })
const HELDQ = new Int32Array(64)
const WEAR1 = CASH.map((x) => SPECIES_TABLE[x].wear - 1)
const MAIZE_T = STAPLE_IDS.indexOf(SP.maize)

/** Craft skill a crop needs (silk, sugar): 1 without need, else smoothstep(need - 0.4, need + 0.2, Crafts). */
function skill(need: number, crafts: number): number {
  return need > 0 ? smoothstep(need - 0.4, need + 0.2, crafts) : 1
}

/** The market's view of the new goods' arrays (trade.ts TradeState, structurally). */
export interface CashMarket {
  stock: Float64Array
  demand: Float64Array
  worth: Float64Array
  bid: Float64Array
}

/**
 * Market hook (trade.ts, stocking trader `id` at offset o = id * GOOD_COUNT): output, needs and worth of Cloth,
 * Luxury and Stimulant, the species mix of its stimulant stock, and bamboo's timber. `demTech` is its needs' Crafts factor.
 */
export function marketGoods(s: HistoryState, m: CashMarket, id: number, o: number, demTech: number): void {
  const sp = s.sp
  const v = sp.v2
  const X = CASHCROP
  const p = s.pop[id]
  const ff = s.fishFrac[id], lf = s.liveFrac[id]
  const exp = s.expected[id]
  let cropFood = exp * (1 - ff - lf)
  if (cropFood < 0) cropFood = 0
  const left = 1 - v.cut[id]
  const pot = cropFood / (left > 0.05 ? left : 0.05)
  if (s.goods !== null) s.goods.pot[id] = pot // goods: (the crops' class units are reckoned on it)
  const v0 = id * 3
  const cloth = v.coef[v0] * pot + v.wool[id] * exp * lf
  const lux = v.coef[v0 + 1] * pot
  const stim = v.coef[v0 + 2] * pot
  m.stock[o + 6] = cloth
  m.stock[o + 7] = lux
  m.stock[o + 8] = stim
  v.prod[v0] = cloth; v.prod[v0 + 1] = lux; v.prod[v0 + 2] = stim
  const NK = v.NK
  for (let k = 0; k < NK; k++) v.amt[id * NK + k] = v.stimCoef[id * NK + k] * pot
  // Bamboo groves: timber that regrows.
  if (hasBit(sp.m0[id], sp.m1[id], SP.bamboo)) m.stock[o + 3] *= 1 + SPECIES2.bambooTimber * sp.fitCatch[SP.bamboo * sp.N + s.cell[id]]
  const w = p > 0 ? s.wealth[id] / p : 0
  const wf = w / (w + WEALTH.half)
  const H = v.habitSum[s.people[id]]
  const need = GOODS.need
  m.demand[o + 6] = need[6] * p * (1 + X.clothWealth * wf) * demTech
  m.demand[o + 7] = need[7] * p * (X.luxBase + X.luxTown * smoothstep(X.luxTownLow, X.luxTownHigh, p) + X.luxWealth * wf) * demTech
  m.demand[o + 8] = need[8] * p * (X.stimBase + X.stimWealth * wf) * (1 + X.stimHabit * H) * demTech
  const V = GOODS.value
  m.worth[o + 6] = V[6]
  m.worth[o + 7] = V[7] * m.bid[id]
  m.worth[o + 8] = V[8] * (1 + X.premium * H)
}

/**
 * Market hook (trade.ts): q units of Luxury (g = 7) or Stimulant (g = 8) moved from settlement `from` (which had
 * `before` in stock) to `to`, at the buyer's price `price`. The buyer pays CASHCROP.pay of their value out of its
 * wealth (habit.ts habitYear: luxuries are a sink of wealth, and a habit's drain is real); for a stimulant the species
 * mix moves with it, and its value counts as bought and sold (habit.ts drain).
 */
export function stimFlow(v: SpeciesV2, g: number, from: number, to: number, q: number, before: number, price: number): void {
  if (!(before > 0)) return
  if (!v.touchedMark[from]) { v.touchedMark[from] = 1; v.touched[v.touchedN++] = from }
  if (!v.touchedMark[to]) { v.touchedMark[to] = 1; v.touched[v.touchedN++] = to }
  v.pay[to] += q * price
  if (g !== 8) return
  const f = q / before
  const NK = v.NK
  const a = from * NK, b = to * NK
  const amt = v.amt
  for (let k = 0; k < NK; k++) {
    const x = amt[a + k]
    if (x === 0) continue
    const moved = x * f
    amt[a + k] = x - moved
    amt[b + k] += moved
    const val = moved * price
    v.imp[b + k] += val
    v.exp[a + k] += val
  }
}

/**
 * Every TECHNIQUE2.step years: soil wear per farmed cell, the claim-weighted mean over the settlements farming it of
 * (1 + sum x_c (wear_c - 1)) * (1 + stapleWear * sum share_t (wear_t - 1)) * manure (land.ts multiplies degradation's load by it).
 */
export function wearPass(s: HistoryState): void {
  const sp = s.sp
  const T = s.terrain
  const N = sp.N
  if (WA.length < N) { WA = new Float64Array(N); WD = new Float64Array(N); WS = new Int32Array(N).fill(-1) }
  const run = ++WRUN
  const { catchOff, catchBase, catchCell, catchW } = T
  const living = s.living
  const NC = CASH.length
  const X = CASHCROP
  const list = WL.length >= N ? WL : (WL = new Int32Array(N))
  let n = 0
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const m0 = sp.m0[id], m1 = sp.m1[id]
    let cash = 1
    if (sp.cashTot[id] > 0) {
      for (let m = (m0 & CASH0) >>> 0; m !== 0; m &= m - 1) { const q = CASH_Q[31 - Math.clz32(m & -m)]; cash += sp.cashX[id * NC + q] * WEAR1[q] }
      for (let m = (m1 & CASH1) >>> 0; m !== 0; m &= m - 1) { const q = CASH_Q[63 - Math.clz32(m & -m)]; cash += sp.cashX[id * NC + q] * WEAR1[q] }
    }
    const rot = hasBit(m0, m1, TECH_BIT + TQ.rotation)
    let st = 0
    const so = id * NST
    for (let k = 0; k < NST; k++) {
      const sh = sp.share[so + k]
      if (sh <= 0) continue
      const d = SPECIES_TABLE[STAPLE_IDS[k]]
      st += sh * (d.wear * (rot && d.cereal ? 0.75 : 1) - 1)
    }
    let wf = cash * (1 + X.stapleWear * st)
    if (hasBit(m0, m1, SP.cattle) || hasBit(m0, m1, SP.buffalo)) wf *= 1 - X.manure
    const pw = Math.sqrt(s.pop[id] * Math.sqrt(s.pop[id]))
    const c = s.cell[id]
    for (let k = catchOff[c]; k < catchBase[c]; k++) {
      const j = catchCell[k]
      const w = catchW[k] * pw
      if (WS[j] !== run) { WS[j] = run; WA[j] = 0; WD[j] = 0; list[n++] = j }
      WA[j] += w * wf
      WD[j] += w
    }
  }
  const wear = sp.wear
  for (let t = 0; t < n; t++) { const j = list[t]; wear[j] = WD[j] > 0 ? WA[j] / WD[j] : 1 }
}
let WA = new Float64Array(0), WD = new Float64Array(0), WS = new Int32Array(0), WL = new Int32Array(0)
let WRUN = 0
