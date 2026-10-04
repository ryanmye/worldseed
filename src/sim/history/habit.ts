// Stimulants and narcotics (M11): habit, demand, harm and drain, per people and stimulant species (History.habit).
//
// Exposure: what a people's settlements consume of each stimulant (a trader its stock after the market, by species as
// tracked through each flow, cashCrops.ts stimFlow; any other settlement what it grows for itself). Every HABIT.step years
// habit h moves toward habit_s * e / (e + half), e = consumption per head over the base need (GOODS.need), at `up` a year
// when rising and `down` when falling: quick to form, slow to fade when supply stops. The habit total H of a people raises
// its need for Stimulant and the price it will pay (cashCrops.ts marketGoods: inelastic demand), so producers and the
// traders between them grow rich (the market's margins and tolls). Harm: at habit h a species takes harmEcon * h of the
// farm food (species.keep, cashCrops.ts; negative for mild ones: a small benefit) and harmDeath * h of the people a year.
// HabitSpreads is logged when a people's habit first passes HABIT.spreads (at its largest consumer; `other` the largest
// seller of another people that year, or -1 when the people grows most of it itself).
// Drain: the smoothed net value a people pays for a stimulant (bought minus sold, at the buyers' prices) against its
// smoothed trade income (wealth gained); above drainShare (and drainMin) for drainYears in a row: Drain, once per people
// and species, at its largest buyer, `other` the largest seller of another people. The running balance stays in
// SpeciesV2.balance (the hook for prohibition and drain-driven war in the polities system). No randomness.

import { EventType, GOOD_COUNT } from '../../contract.ts'
import { CASHCROP, GOODS, HABIT, WEALTH } from './params.ts'
import type { HistoryState } from './state.ts'
import { logEvent } from './state.ts'
import type { MarketView } from './species.ts'
import { SPECIES_TABLE, STIMULANTS } from './species.ts'
import type { SpeciesV2 } from './speciesV2.ts'

/** Per-people scratch (grown): consumption this year, net value, top importer / exporter settlements. */
let NET = new Float64Array(0), TOPI = new Int32Array(0), TOPIV = new Float64Array(0), PRODACC = new Float64Array(0)
let TOPC = new Int32Array(0), TOPCV = new Float64Array(0), INC = new Float64Array(0)
/** Per stimulant: the two largest sellers this year (settlement, value). */
const SELL1 = new Int32Array(16), SELL1V = new Float64Array(16), SELL2 = new Int32Array(16), SELL2V = new Float64Array(16)

/** Yearly: what the market moved (bought and sold per people and stimulant), the drain balance and Drain events. */
export function habitYear(s: HistoryState, v: SpeciesV2, tv: MarketView): void {
  void tv
  const P = v.P, NK = v.NK
  const n = P * NK
  if (NET.length < n) {
    NET = new Float64Array(n); TOPI = new Int32Array(n); TOPIV = new Float64Array(n); PRODACC = new Float64Array(n)
    TOPC = new Int32Array(n).fill(-1); TOPCV = new Float64Array(n); INC = new Float64Array(P); DEATH = new Float64Array(P)
  }
  NET.fill(0, 0, n); TOPI.fill(-1, 0, n); TOPIV.fill(0, 0, n)
  SELL1.fill(-1); SELL1V.fill(0); SELL2.fill(-1); SELL2V.fill(0)
  // Bought and sold this year (settlements the market touched: cashCrops.ts stimFlow).
  const touched = v.touched
  const payShare = CASHCROP.pay
  for (let t = 0; t < v.touchedN; t++) {
    const id = touched[t]
    v.touchedMark[id] = 0
    const paid = v.pay[id] * payShare
    v.pay[id] = 0
    if (s.abandoned[id] >= 0) { for (let k = 0; k < NK; k++) { v.imp[id * NK + k] = 0; v.exp[id * NK + k] = 0 } continue }
    // Buyers pay for luxuries and stimulants out of their wealth (at most payMax of it a year).
    if (paid > 0) { const w = s.wealth[id]; const most = CASHCROP.payMax * w; s.wealth[id] = w - (paid < most ? paid : most) }
    const p = s.people[id]
    const a = id * NK, b = p * NK
    for (let k = 0; k < NK; k++) {
      const im = v.imp[a + k], ex = v.exp[a + k]
      if (im === 0 && ex === 0) continue
      NET[b + k] += im - ex
      if (im > TOPIV[b + k]) { TOPIV[b + k] = im; TOPI[b + k] = id }
      if (ex > SELL1V[k]) { SELL2[k] = SELL1[k]; SELL2V[k] = SELL1V[k]; SELL1[k] = id; SELL1V[k] = ex } else if (ex > SELL2V[k]) { SELL2[k] = id; SELL2V[k] = ex }
      v.imp[a + k] = 0
      v.exp[a + k] = 0
    }
  }
  v.touchedN = 0
  const sm = HABIT.smooth
  for (let p = 0; p < P; p++) {
    for (let k = 0; k < NK; k++) {
      const i = p * NK + k
      v.balance[i] += sm * (NET[i] - v.balance[i])
      const bal = v.balance[i]
      const inc = v.income[p] > 0 ? v.income[p] : 0
      if (bal > HABIT.drainMin && bal > HABIT.drainShare * inc) v.drainRun[i]++
      else v.drainRun[i] = 0
      if (v.drainRun[i] >= HABIT.drainYears && !v.drainLogged[i] && TOPI[i] >= 0) {
        v.drainLogged[i] = 1
        logEvent(s, EventType.Drain, TOPI[i], seller(s, k, p), STIMULANTS[k])
        v.drainLog.push(s.year, p, STIMULANTS[k], bal, inc)
      }
    }
  }
}
let DEATH = new Float64Array(0)
const DEATH_K = STIMULANTS.map((x) => SPECIES_TABLE[x].harmDeath)

/**
 * Every HABIT.step years, per settlement: this year's consumption and production of each stimulant (standing for the
 * step), harm's deaths over the step, and the people's trade income (wealth gained) over the step.
 */
function sample(s: HistoryState, v: SpeciesV2, tv: MarketView): void {
  const P = v.P, NK = v.NK
  const dt = HABIT.step
  const harm = HABIT.harm
  for (let p = 0; p < P; p++) {
    let d = 0
    if (harm) for (let k = 0; k < NK; k++) d += DEATH_K[k] * v.habit[p * NK + k]
    DEATH[p] = 1 - dt * d
  }
  INC.fill(0, 0, P)
  const living = s.living
  const stimStock = tv.stock
  let keep = 1
  for (let k = 0; k < dt; k++) keep *= 1 - WEALTH.decay
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const p = s.people[id]
    const w = s.wealth[id]
    INC[p] += w - v.prevWealth[id] * keep
    v.prevWealth[id] = w
    if (DEATH[p] < 1) s.pop[id] *= DEATH[p]
    const trader = id < tv.trader.length && tv.trader[id] === 1
    const grows = v.coef[id * 3 + 2] > 0
    if (!grows && !(trader && stimStock[id * GOOD_COUNT + 8] > 0)) continue // (no stimulant grown or in stock) (goods: GOOD_COUNT 13)
    const ff = s.fishFrac[id], lf = s.liveFrac[id]
    let crop = s.expected[id] * (1 - ff - lf)
    if (crop < 0) crop = 0
    const left = 1 - v.cut[id]
    const pot = crop / (left > 0.05 ? left : 0.05)
    const a = id * NK, b = p * NK
    for (let k = 0; k < NK; k++) {
      const grown = grows ? v.stimCoef[a + k] * pot : 0
      const cons = trader ? v.amt[a + k] : grown
      if (grown > 0) PRODACC[b + k] += grown
      if (cons > 0) {
        v.consAcc[b + k] += cons
        v.access[b + k] = 1
        if (TOPC[b + k] < 0 || cons > TOPCV[b + k]) { TOPC[b + k] = id; TOPCV[b + k] = cons }
      }
    }
  }
  // (Income a year over the step: wealth now less what last step's wealth would have decayed to.)
  for (let p = 0; p < P; p++) v.income[p] = INC[p] / dt
}

/** The largest seller of stimulant k this year not of people p (-1). */
function seller(s: HistoryState, k: number, p: number): number {
  if (SELL1[k] >= 0 && s.people[SELL1[k]] !== p) return SELL1[k]
  if (SELL2[k] >= 0 && s.people[SELL2[k]] !== p) return SELL2[k]
  return -1
}

/** Every HABIT.step years: habit per people and stimulant from its consumption since the last step; HabitSpreads. */
export function habitStep(s: HistoryState, v: SpeciesV2, tv: MarketView): void {
  if (NET.length < v.P * v.NK) habitYear(s, v, tv)
  sample(s, v, tv)
  const P = v.P, NK = v.NK
  const pop = PPOP.length >= P ? PPOP : (PPOP = new Float64Array(P))
  pop.fill(0)
  for (let t = 0; t < s.living.length; t++) pop[s.people[s.living[t]]] += s.pop[s.living[t]]
  const dt = HABIT.step
  const need0 = GOODS.need[8]
  const n = P * NK
  for (let p = 0; p < P; p++) {
    let sum = 0
    for (let k = 0; k < NK; k++) {
      const i = p * NK + k
      const cons = v.consAcc[i] // (one year's, sampled)
      v.consAcc[i] = 0
      let h = v.habit[i]
      if (pop[p] > 0) {
        const e = cons / pop[p] / need0
        const target = SPECIES_TABLE[STIMULANTS[k]].habit * (e / (e + HABIT.half))
        h += dt * (target > h ? HABIT.up : HABIT.down) * (target - h)
        if (h < 0) h = 0
        if (h > 1) h = 1
        if (h < 1e-4 && target === 0) h = 0
        v.habit[i] = h
        if (h >= HABIT.spreads && !v.spreadLogged[i] && i < TOPC.length && TOPC[i] >= 0) {
          // At its largest consumer of the last few years (or its largest settlement now, if that one is gone).
          let at = TOPC[i]
          if (s.abandoned[at] >= 0) { at = -1; for (const id of s.living) if (s.people[id] === p && (at < 0 || s.pop[id] > s.pop[at])) at = id }
          if (at >= 0) {
            v.spreadLogged[i] = 1
            const home = PRODACC[i] >= 0.5 * cons
            logEvent(s, EventType.HabitSpreads, at, home ? -1 : seller(s, k, p), STIMULANTS[k])
          }
        }
      }
      sum += h
    }
    v.habitSum[p] = sum < CASHCROP.habitMax ? sum : CASHCROP.habitMax
  }
  if (TOPC.length >= n) { TOPC.fill(-1, 0, n); TOPCV.fill(0, 0, n); PRODACC.fill(0, 0, n) }
}
let PPOP = new Float64Array(0)
