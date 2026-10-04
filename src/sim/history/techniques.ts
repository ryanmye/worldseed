// Techniques and improved strains (M9): History.techniques, techniqueYear, techniqueSource.
//
// Found every TECHNIQUE2.step years per people, by trigger, at the largest settlement (of at least TECHNIQUE2.minPop)
// that meets it, with the chance per decade below times the step in decades:
//   earlyRice       paddy grown TECHNIQUE.riceHeld years; riceChance * share of the people in hot paddy settlements
//   rotation        a cereal and the legume (pulse) held, Farming >= rotationFarming; rotationChance
//   heavyPlough     cattle on moist temperate fields, Metalworking >= ploughMetal; ploughChance * share
//   terrace         Farming >= terraceFarming; terraceChance * share in crowded hill settlements
//   paddyIrrigation paddy and a dam; irrigationChance
//   nixtamal        only a people that tamed maize or had it from the start, held nixHeld years; nixChance
//   freezeDrying    potato on cold highland; chunoChance * share
//   grafting        a vine or orchard species, Crafts >= graftCrafts; graftChance
//   breeding        two herd animals or more, Farming >= breedFarming; breedChance
//   hardyGrain      barley held hardyHeld years on cold margins; hardyChance * share
// A people that has met one holding it finds it only at contactFactor of the chance: it learns it instead. Held
// techniques spread as species do (species.ts spreadAt): inherited by colonies, taken up over links where they help,
// slowly within a people (TECHNIQUE2.inPeople) and between peoples mostly with trade (TECHNIQUE2.cross, crossTrade),
// so a technique is worked out once or twice in a world and travels the trade network, slower than plants; isolated
// peoples lag. Effects (species.ts cropOf, storage.ts, cashCrops.ts): see TECHNIQUE and SPECIES2.
// Draws: 'history-species-techniques'.

import { TECH_FIELD_COUNT, TechField } from '../../contract.ts'
import { TECHNIQUE, TECHNIQUE2 } from './params.ts'
import type { HistoryState } from './state.ts'
import { gainItem, hasBit, HERD_IDS, ITEMS, K_COUNT, NST, S_COUNT, SP, STAPLE_INDEX, TECH_BIT, TQ } from './species.ts'
import type { SpeciesV2 } from './speciesV2.ts'

const PADDY_T = STAPLE_INDEX[SP.paddyRice]
/** Decades per step (the chances are per decade). */
const DEC = TECHNIQUE2.step / 10
let SHARE = new Float64Array(0), BEST = new Int32Array(0), POP = new Float64Array(0), HELD = new Uint8Array(0)
/** A settlement meets technique k's trigger: its people's weight and best settlement. */
function cand(s: HistoryState, p: number, k: number, id: number, w: number): void {
  const i = p * K_COUNT + k
  SHARE[i] += w
  if (BEST[i] < 0 || s.pop[id] > s.pop[BEST[i]]) BEST[i] = id
}

/** Every TECHNIQUE2.step years: techniques found (see the header). */
export function techniquePass(s: HistoryState, v: SpeciesV2): void {
  const sp = s.sp
  const P = sp.P
  const K = K_COUNT
  if (POP.length < P) { POP = new Float64Array(P); SHARE = new Float64Array(P * K); BEST = new Int32Array(P * K); HELD = new Uint8Array(P * K) }
  POP.fill(0, 0, P); SHARE.fill(0, 0, P * K); BEST.fill(-1, 0, P * K)
  const world = s.world
  const living = s.living
  const X = TECHNIQUE, Y = TECHNIQUE2
  // Candidates per people and technique: weight (people meeting the trigger) and the best settlement.
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const p = s.people[id]
    const x = s.pop[id]
    POP[p] += x
    if (x < Y.minPop) continue // (villages weigh little in a people's share and are skipped)
    const c = s.cell[id]
    const m0 = sp.m0[id], m1 = sp.m1[id]
    const tb = m1 >>> (TECH_BIT - 32) // (technique bits)
    if (!((tb >>> TQ.earlyRice) & 1) && sp.hot[c] && sp.share[id * NST + PADDY_T] >= 0.3) cand(s, p, TQ.earlyRice, id, x)
    if (!((tb >>> TQ.rotation) & 1) && hasBit(m0, m1, SP.pulse) && (hasBit(m0, m1, SP.wheat) || hasBit(m0, m1, SP.barley) || hasBit(m0, m1, SP.sorghum) || hasBit(m0, m1, SP.millet))) cand(s, p, TQ.rotation, id, x)
    if (!((tb >>> TQ.heavyPlough) & 1) && hasBit(m0, m1, SP.cattle) && sp.plough[c]) cand(s, p, TQ.heavyPlough, id, x)
    if (!((tb >>> TQ.terrace) & 1) && s.terrain.relief[c] < Y.hill && s.expected[id] > 0 && x / s.expected[id] >= Y.crowd) cand(s, p, TQ.terrace, id, x)
    if (!((tb >>> TQ.irrigation) & 1) && hasBit(m0, m1, SP.paddyRice) && s.dam[id] >= 0) cand(s, p, TQ.irrigation, id, x)
    if (!((tb >>> TQ.nixtamal) & 1) && hasBit(m0, m1, SP.maize)) cand(s, p, TQ.nixtamal, id, x)
    if (!((tb >>> TQ.freezeDrying) & 1) && hasBit(m0, m1, SP.potato) && world.temperature[c] < Y.coldT && world.elevation[c] > Y.coldE) cand(s, p, TQ.freezeDrying, id, x)
    if (!((tb >>> TQ.grafting) & 1) && (hasBit(m0, m1, SP.grape) || hasBit(m0, m1, SP.cherry) || hasBit(m0, m1, SP.tulip))) cand(s, p, TQ.grafting, id, x)
    if (!((tb >>> TQ.breeding) & 1)) { let h = 0; for (const y of HERD_IDS) if (hasBit(m0, m1, y)) h++; if (h >= 2) cand(s, p, TQ.breeding, id, x) }
    if (!((tb >>> TQ.hardyGrain) & 1) && hasBit(m0, m1, SP.barley) && world.temperature[c] < Y.hardyT) cand(s, p, TQ.hardyGrain, id, x)
  }
  // Held by some people met (then found only at contactFactor of the chance).
  const contact = s.know.contact
  HELD.fill(0, 0, P * K)
  for (let p = 0; p < P; p++) {
    for (let q = 0; q < P; q++) {
      if (q === p || contact[p * P + q] < 0) continue
      for (let k = 0; k < K; k++) if (sp.year[q * ITEMS + S_COUNT + k] >= 0) HELD[p * K + k] = 1
    }
  }
  const rng = v.rngTech
  for (let p = 0; p < P; p++) {
    if (POP[p] <= 0) continue
    const tech = p * TECH_FIELD_COUNT
    const farming = s.tech[tech + TechField.Farming], metal = s.tech[tech + TechField.Metalworking], crafts = s.tech[tech + TechField.Crafts]
    const yr = (x: number) => sp.year[p * ITEMS + x]
    for (let k = 0; k < K; k++) {
      const i = p * K + k
      if (BEST[i] < 0 || yr(S_COUNT + k) >= 0) continue
      let share = (SHARE[i] / POP[p]) * 5 // (full chance once a fifth of the people meets the trigger)
      if (share > 1) share = 1
      let chance = 0
      switch (k) {
        case TQ.earlyRice: if (yr(SP.paddyRice) >= 0 && s.year - yr(SP.paddyRice) >= X.riceHeld) chance = X.riceChance * share; break
        case TQ.rotation: if (farming >= X.rotationFarming) chance = X.rotationChance; break
        case TQ.heavyPlough: if (metal >= X.ploughMetal) chance = X.ploughChance * share; break
        case TQ.terrace: if (farming >= Y.terraceFarming) chance = Y.terraceChance * share; break
        case TQ.irrigation: chance = Y.irrigationChance; break
        case TQ.nixtamal: if (sp.source[p * ITEMS + SP.maize] < 0 && yr(SP.maize) >= 0 && s.year - yr(SP.maize) >= Y.nixHeld) chance = Y.nixChance; break
        case TQ.freezeDrying: chance = Y.chunoChance * share; break
        case TQ.grafting: if (crafts >= Y.graftCrafts) chance = Y.graftChance; break
        case TQ.breeding: if (farming >= Y.breedFarming) chance = Y.breedChance; break
        case TQ.hardyGrain: if (yr(SP.barley) >= 0 && s.year - yr(SP.barley) >= Y.hardyHeld) chance = Y.hardyChance * share; break
      }
      if (chance <= 0) continue
      if (HELD[i]) chance *= Y.contactFactor
      if (rng.next() < chance * DEC) gainItem(s, BEST[i], S_COUNT + k, -1)
    }
  }
}
