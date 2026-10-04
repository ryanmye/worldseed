// Technology per people: levels in four fields (TechField: Farming, Seafaring,
// Metalworking, Crafts), all starting at 1 (History.technology).
//
// Advancement (every TECH.step years): a people's level in a field grows with
// the square root of its activity in that field (TECH: everyone farms;
// Seafaring grows with coastal and port towns, sea trade and voyages of
// settlement; Metalworking with the ore its settlements can mine; Crafts with
// towns and cities and trade), plus a share of the activity of the peoples it
// is closely linked with (ideas travel with neighbours and trade), times a bonus
// for its wealth per head, and slowing at high levels. So big, rich, connected
// peoples advance faster and small isolated ones slowly; a people's colonies
// share its technology.
//
// Diffusion: peoples in contact learn from those ahead of them. A people closes,
// in each field, the largest of rate * gap over the peoples it has met (not
// merely heard of through others) that are ahead: slowly from a people it has
// only met, faster when settlements of the two have seen each other
// (neighbours), and faster still the more they trade. A continent of peoples in
// contact advances together; an isolated one falls behind and catches up over a
// century or two after first contact.
//
// Effects (read through state.techOf / productivityOf by every system):
// Farming multiplies what land yields (food, sites judged by migrants and
// voyages); Seafaring fishing (population.ts), sea range and safety (voyages,
// migration, trade's sea legs, expeditions) and, with Crafts, sight; Metalworking
// ore output (trade.ts); Crafts the other goods, the needs for them, transport
// costs and trade reach, overland reach of migrants and expeditions, supply of
// expedition bases, and the chance to build ports and dams (structures.ts).
//
// TechAdvance is logged when a people first reaches each whole level in a
// field, at its largest settlement then. Draws nothing.

import { EventType, TECH_FIELD_COUNT, TechField } from '../../contract.ts'
import { smoothstep } from '../util.ts'
import { GOODS, TECH } from './params.ts'
import type { HistoryState } from './state.ts'
import { logEvent } from './state.ts'
import type { TradeState } from './trade.ts'

const F = TECH_FIELD_COUNT

export interface TechState {
  P: number
  /** Activity per people per field this year (scratch). */
  act: Float64Array
  /** Population and wealth per people this year; 1 while a people has a living settlement. */
  pop: Float64Array
  wealth: Float64Array
  alive: Uint8Array
  /** Largest living settlement per people this year (-1 if none). */
  largest: Int32Array
  /** Trade volume between peoples: this year's, and smoothed (symmetric), [a * P + b]. */
  yearVol: Float64Array
  pairVol: Float64Array
  /** Per route: 1 when its path crosses >= 2 sea cells (filled as routes appear). */
  routeSea: Uint8Array
  routeSeen: number
  /** Ore a settlement's base catchment could give at full labour (static per settlement, filled as settlements appear). */
  oreBase: Float64Array
  oreSeen: number
  /** Highest whole level logged per people per field. */
  level: Int32Array
  /** Diffusion gains this year (scratch). */
  gain: Float64Array
  /** Link strength (diffusion rate) between living peoples that have met, [a * P + b], 0 otherwise (this year). */
  link: Float64Array
  /** First year each people learned from each other people, -1 if never: firstLearn[learner * P + teacher] (diagnostics, tests). */
  firstLearn: Int16Array
}

export function createTech(s: HistoryState): TechState {
  const P = s.know.P
  return {
    P,
    act: new Float64Array(P * F),
    pop: new Float64Array(P),
    wealth: new Float64Array(P),
    alive: new Uint8Array(P).fill(1),
    largest: new Int32Array(P).fill(-1),
    yearVol: new Float64Array(P * P),
    pairVol: new Float64Array(P * P),
    routeSea: new Uint8Array(256),
    routeSeen: 0,
    oreBase: new Float64Array(256),
    oreSeen: 0,
    level: new Int32Array(P * F).fill(1),
    gain: new Float64Array(P * F),
    link: new Float64Array(P * P),
    firstLearn: new Int16Array(P * P).fill(-1),
  }
}

/** Static per-settlement and per-route figures for those that appeared since the last call. */
function catchUp(s: HistoryState, ts: TradeState, tk: TechState): void {
  const T = s.terrain
  if (tk.oreBase.length < s.count) {
    let size = tk.oreBase.length
    while (size < s.count) size *= 2
    const a = new Float64Array(size); a.set(tk.oreBase); tk.oreBase = a
  }
  for (let id = tk.oreSeen; id < s.count; id++) {
    const c = s.cell[id]
    let ore = 0
    for (let k = T.catchOff[c]; k < T.catchBase[c]; k++) ore += T.catchW[k] * T.ore[T.catchCell[k]]
    tk.oreBase[id] = ore
  }
  tk.oreSeen = s.count
  if (tk.routeSea.length < ts.routeCount) {
    let size = tk.routeSea.length
    while (size < ts.routeCount) size *= 2
    const a = new Uint8Array(size); a.set(tk.routeSea); tk.routeSea = a
  }
  for (let r = tk.routeSeen; r < ts.routeCount; r++) {
    const path = ts.rPath[r]
    let sea = 0
    for (let k = 0; k < path.length; k++) if (T.sea[path[k]]) sea++
    tk.routeSea[r] = sea >= 2 ? 1 : 0
  }
  tk.routeSeen = ts.routeCount
}

/** System (end of year, after exploration, every TECH.step years): activity, growth, diffusion, TechAdvance events. */
export function technologySystem(s: HistoryState, ts: TradeState, tk: TechState): void {
  const X = TECH
  if (s.year % X.step !== 0) return
  const dt = X.step
  const P = tk.P
  catchUp(s, ts, tk)
  const { act, pop, wealth, alive, largest, yearVol, pairVol } = tk
  act.fill(0)
  pop.fill(0)
  wealth.fill(0)
  largest.fill(-1)
  const T = s.terrain
  const workHalf = GOODS.workHalf
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const p = s.people[id]
    const x = s.pop[id]
    pop[p] += x
    wealth[p] += s.wealth[id]
    if (largest[p] < 0 || x > s.pop[largest[p]]) largest[p] = id
    const o = p * F
    let sea = 0
    if (T.seaCoast[s.cell[id]]) sea += X.coastal * x
    if (s.port[id] >= 0) sea += X.port * x
    act[o + TechField.Seafaring] += sea
    act[o + TechField.Metalworking] += X.ore * tk.oreBase[id] * (x / (x + workHalf))
    act[o + TechField.Crafts] += X.town * x * smoothstep(X.townLow, X.townHigh, x)
  }
  // Trade: loads on each people's routes (sea routes also count for Seafaring), and between pairs of peoples.
  yearVol.fill(0)
  const list = ts.openList
  for (let t = 0; t < list.length; t++) {
    const r = list[t]
    const v = ts.rVol[r]
    if (!(v > 0)) continue
    const pa = s.people[ts.rA[r]], pb = s.people[ts.rB[r]]
    act[pa * F + TechField.Crafts] += X.tradeLoad * v
    act[pb * F + TechField.Crafts] += X.tradeLoad * v
    if (tk.routeSea[r]) {
      act[pa * F + TechField.Seafaring] += X.seaTrade * v
      act[pb * F + TechField.Seafaring] += X.seaTrade * v
    }
    if (pa !== pb) { yearVol[pa * P + pb] += v; yearVol[pb * P + pa] += v }
  }
  const sm = X.tradeSmoothing * dt
  for (let i = 0; i < P * P; i++) pairVol[i] += sm * (yearVol[i] - pairVol[i])

  for (let p = 0; p < P; p++) {
    s.voyageAcc[p] *= 1 - X.voyageDecay * dt
    alive[p] = pop[p] > 0 ? 1 : 0
    if (!alive[p]) continue
    const o = p * F
    const x = pop[p]
    act[o + TechField.Farming] += X.share[0] * x
    act[o + TechField.Seafaring] += X.share[1] * x + X.voyage * s.voyageAcc[p]
    act[o + TechField.Metalworking] += X.share[2] * x
    act[o + TechField.Crafts] += X.share[3] * x
  }
  // How closely each pair of living peoples that has met is linked (0 if not): the diffusion rate, and the
  // share of the other's activity that counts toward one's own growth (ideas travel with the contact).
  const k = s.know
  const contact = k.contact, near = k.near
  const link = tk.link
  const linkMax = X.contact + X.near + X.tradeLearn
  for (let p = 0; p < P; p++) {
    for (let q = 0; q < P; q++) {
      let rate = 0
      if (q !== p && alive[p] && alive[q] && contact[p * P + q] >= 0) {
        const v = pairVol[p * P + q]
        rate = X.contact + (near[p * P + q] ? X.near : 0) + (X.tradeLearn * v) / (v + X.tradeHalf)
      }
      link[p * P + q] = rate
    }
  }

  // Growth from each people's own activity and part of that of the peoples it is linked with.
  const tech = s.tech
  const soft = 1 / X.soft
  const pool = X.pool / linkMax
  for (let p = 0; p < P; p++) {
    if (!alive[p]) continue
    const o = p * F
    const x = pop[p]
    const w = wealth[p] / x
    const rich = 1 + (X.wealth * w) / (w + X.wealthHalf)
    for (let f = 0; f < F; f++) {
      let a = act[o + f]
      for (let q = 0; q < P; q++) { const l = link[p * P + q]; if (l > 0) a += pool * l * act[q * F + f] }
      const L = tech[o + f]
      const u = (L - 1) * soft
      const u2 = u * u
      tech[o + f] = L + (dt * X.rate[f] * Math.sqrt(a + X.base[f]) * rich) / ((1 + X.slow * (L - 1)) * (1 + u2 * u2))
    }
  }

  // Diffusion: the largest gain from any people met that is ahead (all gains from this year's levels, then applied).
  const gain = tk.gain
  gain.fill(0)
  const teacher = tk.firstLearn
  for (let p = 0; p < P; p++) {
    if (!alive[p]) continue
    const o = p * F
    for (let q = 0; q < P; q++) {
      const rate = link[p * P + q] * dt
      if (rate <= 0) continue
      const oq = q * F
      let learned = false
      for (let f = 0; f < F; f++) {
        const d = tech[oq + f] - tech[o + f]
        if (d <= 0) continue
        const g = rate * d
        if (g > gain[o + f]) gain[o + f] = g
        learned = true
      }
      if (learned && teacher[p * P + q] < 0) teacher[p * P + q] = s.year
    }
  }
  for (let i = 0; i < P * F; i++) tech[i] += gain[i]

  // TechAdvance: each new whole level, at the people's largest settlement.
  for (let p = 0; p < P; p++) {
    if (!alive[p]) continue
    for (let f = 0; f < F; f++) {
      const lvl = Math.floor(tech[p * F + f])
      while (tk.level[p * F + f] < lvl) {
        tk.level[p * F + f]++
        logEvent(s, EventType.TechAdvance, largest[p], -1, f)
      }
    }
  }
}
