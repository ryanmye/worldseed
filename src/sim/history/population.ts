// Food and population systems.
//
// Food: every living settlement claims the cells of its catchment with weight
// w (falling with distance) times its claim strength (population^0.75). Each
// cell is split among its claimants in proportion to their claims, so close
// settlements compete for shared fields and larger ones take the larger share;
// a claimant gets capacity * w of its share (distant fields are worked less
// efficiently), so a settlement alone on its land expects sum(w * capacity)
// over its catchment, times its people's technology and its trade factor (wealth and
// being a hub let a settlement get more from its land; see trade.ts). Farming
// technology multiplies the land's yield and Seafaring the fishing part of it
// (technology.ts). Capacity here
// is the effective one (degradation, irrigation, reservoirs; see land.ts);
// a port adds fishing on coastal cells and a dam damps the owner's bad harvests.
// The species a settlement holds (species.ts) multiply the farm part of its
// land (its crop multiplier: which staples and herds suit the land, and how
// well), not the fishing part.
// In land years the same pass records which fields feed each settlement
// (nearest first), the target the land-use system moves cultivation toward,
// how crowded the people working them are (for degradation), and what the
// food is made of (grain, fish, livestock; for trade).

import { CITY_POPULATION, EventType, TECH_FIELD_COUNT, TOWN_POPULATION, TechField } from '../../contract.ts'
import { smoothstep } from '../util.ts'
import { CATCHMENT, DAM, PORT, POPULATION } from './params.ts'
import type { HistoryState } from './state.ts'
import { abandon, logEvent } from './state.ts'
import { foodBase } from './migration.ts'

/**
 * Strength of a settlement's claim on shared land: population^0.75 (from
 * square roots), so larger settlements take the larger share of contested
 * cells but less than in proportion to their size.
 */
export function claimStrength(pop: number): number {
  return Math.sqrt(pop * Math.sqrt(pop))
}

/** Reach of a settlement's fields in n = 48 hops: CATCHMENT.hops, growing to maxHops with size. */
export function reachOf(pop: number): number {
  const C = CATCHMENT
  return C.hops + (C.maxHops - C.hops) * smoothstep(C.reachLow, C.reachHigh, pop)
}

/** System: claims per cell, then expected food, actual supply and food ratio per settlement. */
export function foodSystem(s: HistoryState): void {
  const T = s.terrain
  const { catchOff, catchBase, catchCell, catchW, catchDist, capFish } = T
  const capacity = s.effCap
  const claim = s.claim
  // Last year's claimed cells back to 0 (every other cell already is), then this year's claims,
  // listing each cell the first time it is claimed.
  const claimed = s.claimed
  for (let t = 0; t < s.claimedCount; t++) claim[claimed[t]] = 0
  let nClaimed = 0
  const living = s.living
  const smallPop = CATCHMENT.reachLow
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const c = s.cell[id]
    const p = s.pop[id]
    const st = claimStrength(p)
    if (p <= smallPop) {
      // Base catchment only: the common case, kept tight.
      for (let k = catchOff[c], e = catchBase[c]; k < e; k++) {
        const j = catchCell[k]
        if (claim[j] === 0) claimed[nClaimed++] = j
        claim[j] += catchW[k] * st
      }
      continue
    }
    const r1 = reachOf(p) + 1
    const base = catchBase[c]
    for (let k = catchOff[c], e = catchOff[c + 1]; k < e; k++) {
      let f = 1
      if (k >= base) {
        // Beyond the base catchment: claims fade to 0 over the hop past reach.
        f = r1 - catchDist[k]
        if (f <= 0) break
        if (f > 1) f = 1
      }
      const j = catchCell[k]
      if (claim[j] === 0) claimed[nClaimed++] = j
      claim[j] += f * catchW[k] * st
    }
  }
  s.claimedCount = nClaimed
  // Inverse claims, once per claimed cell (the same quotient each claimant would compute).
  const invClaim = s.invClaim
  for (let t = 0; t < nClaimed; t++) {
    const j = claimed[t]
    invClaim[j] = 1 / claim[j]
  }
  // Expected food per settlement. Along the way, record which fields feed its
  // people this year: nearest catchment cells first, each up to the
  // settlement's share of the cell, until the food covers the population.
  // The land-use system (land.ts) moves cultivation toward these targets; it
  // runs every LAND.step years, and fields are recorded only in those years.
  const tech = s.tech, peopleOf = s.people
  const portFish = PORT.fish
  const target = s.landTarget
  const stressAcc = s.stressAcc
  const recordFields = s.landYear
  const active = s.active
  const isActive = s.isActive
  const { liveFrac, riverFishFrac } = T
  const sp = s.sp
  const cropMul = sp.cropMul, rawMul = sp.raw, liveAdj = sp.liveAdj
  let activeCount = s.activeCount
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const c = s.cell[id]
    const p = s.pop[id]
    // Farming tech and the crop multiplier cm multiply the whole catchment; the fishing part is instead worth
    // (1 + port bonus) * Seafaring, written as capacity * farm + capFish * fish * farm with farm = Farming * cm and
    // fish = (1 + port bonus) * sea / farm - 1 (exact).
    const to = peopleOf[id] * TECH_FIELD_COUNT
    const cm = cropMul[id]
    const farmT = tech[to + TechField.Farming] * cm
    const fish = ((s.port[id] >= 0 ? 1 + portFish : 1) * tech[to + TechField.Seafaring]) / farmT - 1
    const st = claimStrength(p)
    const mul = farmT * s.econ[id]
    const riverAdj = recordFields ? 1 / rawMul[id] : 0 // river fishing is not a crop
    const lAdj = recordFields ? liveAdj[id] : 0
    const stm = st * mul
    const big = p > smallPop
    const r1 = big ? reachOf(p) + 1 : 0
    const base = catchBase[c]
    const end = big ? catchOff[c + 1] : base
    let need = recordFields ? p : 0
    // Crowding of the people working these fields: people per unit of the food they can count on
    // (last year's local food plus smoothed imports; exports do not count against it).
    const crowd = recordFields ? p / foodBase(s, id) : 0
    let perStrength = 0 // food per unit of claim strength
    let perFish = 0, perLive = 0 // the fish and livestock parts of it (land years only)
    // A cell's food (per unit of Farming) is its capacity plus fish * its fishing part.
    if (!recordFields && !big) {
      // The common case (no fields to record, base catchment only), kept tight.
      for (let k = catchOff[c]; k < base; k++) {
        const j = catchCell[k]
        const w = catchW[k]
        const cj = capacity[j] + fish * capFish[j]
        perStrength += cj * (w * w * invClaim[j])
      }
    } else for (let k = catchOff[c]; k < end; k++) {
      let w = catchW[k]
      if (k >= base) {
        // Beyond the base catchment: fades to 0 over the hop past reach, as the claims do.
        const f = r1 - catchDist[k]
        if (f <= 0) break
        if (f < 1) w *= f
      }
      const j = catchCell[k]
      const ic = invClaim[j]
      const cj = capacity[j] + fish * capFish[j]
      const ww = w * w * ic
      const term = cj * ww
      perStrength += term
      if (recordFields) {
        const farm = capacity[j] - capFish[j]
        const cf = cj - farm
        perFish += (cf + farm * riverFishFrac[j] * riverAdj) * ww
        perLive += farm * liveFrac[j] * lAdj * ww
      }
      if (need > 0) {
        // Fields worked this year: up to this settlement's share of the cell.
        const avail = term * stm
        if (avail <= 0) continue
        if (isActive[j] === 0) { isActive[j] = 1; active[activeCount++] = j }
        const share = w * st * ic
        const used = need >= avail ? share : (share * need) / avail
        target[j] += used
        stressAcc[j] += used * crowd
        need = need >= avail ? need - avail : 0
      }
    }
    if (recordFields && perStrength > 0) {
      s.fishFrac[id] = perFish / perStrength
      s.liveFrac[id] = perLive / perStrength
    }
    const expected = perStrength * stm
    let h = s.harvest[s.weatherRegion[c]]
    if (h < 1 && s.dam[id] >= 0) h = 1 - (1 - h) * (1 - DAM.droughtDamp)
    const supply = expected * h
    s.expected[id] = expected
    s.supply[id] = supply
    s.food[id] = supply >= p ? 1 : supply / p
  }
  s.activeCount = activeCount
}

/** System: logistic growth when fed, deaths from the shortfall when not; logs severe famines. */
export function populationSystem(s: HistoryState): void {
  const P = POPULATION
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const p = s.pop[id]
    const sup = s.supply[id]
    if (sup >= p) {
      s.pop[id] = p + P.growth * p * (1 - p / sup)
    } else {
      const lost = P.famineMortality * (p - sup)
      s.pop[id] = p - lost
      const frac = lost / p
      if (s.food[id] < P.famineRatio && frac >= P.famineLoss && p >= P.famineMinPop && s.year - s.lastFamine[id] >= P.famineCooldown) {
        s.lastFamine[id] = s.year
        logEvent(s, EventType.Famine, id, -1, frac)
      }
    }
  }
}

/** System: settlements that dwindled below the threshold are abandoned. */
export function abandonmentSystem(s: HistoryState): void {
  const living = s.living
  let w = 0
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    if (s.pop[id] < POPULATION.abandonPop) abandon(s, id)
    else living[w++] = id
  }
  living.length = w
}

/**
 * System: logs BecameTown / BecameCity the first time a settlement's
 * population reaches the thresholds. Runs last in the year, on the values the
 * snapshot records (compared in float32, as stored).
 */
export function milestoneSystem(s: HistoryState): void {
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const m = s.milestone[id]
    if (m === 3) continue
    const p = Math.fround(s.pop[id])
    if (!(m & 1) && p >= TOWN_POPULATION) { s.milestone[id] |= 1; logEvent(s, EventType.BecameTown, id, -1, p) }
    if (!(m & 2) && p >= CITY_POPULATION) { s.milestone[id] |= 2; logEvent(s, EventType.BecameCity, id, -1, p) }
  }
}
