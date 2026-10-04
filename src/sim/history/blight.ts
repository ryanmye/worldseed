// Blight and monoculture (M12), and livestock plague (M13).
//
// Blight: every BLIGHT.step years (year % 10 === 5) per people and staple, with share = the staple's share of the
// people's crop food (population-weighted over its settlements), chance
//   base * clone * share^3 * (1 + v / (v + tradeHalf)) * (pests ? 1 : release) / strains
// (clone 2 for crops grown from cuttings, 2.5 for plantain; v the people's trade with other peoples: pathogens travel
// with goods; pests are present where the staple is native, on the landmasses of its origins, and arrive with contact
// with a people that grows it there: enemy release otherwise; strains = 1 + blights the people has survived on it, its
// resistant strains). The cube makes mixed farming nearly immune: diversity protects, and a second staple carries the
// food (cropOf's best-of on each cell). A blight takes `loss` of the staple's harvest in all the people's settlements
// for a few years (species.bmul, read by cropOf), so where it was most of the food, famine and flight follow through the
// food, population and migration systems. It jumps once to each people in contact growing the crop, with chance
// share * (jump + jumpTrade * v / (v + tradeHalf)), v their trade. Logged as Blight (first settlement struck: the
// people's largest growing it; value the species, extra the share of the harvest lost).
// Livestock plague: a people taking up a herd animal from another people that has kept it at least panzooticAge
// years loses, with chance `panzootic`, U(herdLow, herdHigh) of its herds (species.herdKeep: the livestock part above
// hunting), regrowing over herdYears; logged as Panzootic at the adopting settlement, `other` the source.
// Draws: 'history-species-hazard'.

import { EventType, SpeciesCategory } from '../../contract.ts'
import { smoothstep } from '../util.ts'
import { BLIGHT } from './params.ts'
import type { HistoryState } from './state.ts'
import type { MarketView } from './species.ts'
import { cropOf, hasBit, ITEMS, NST, SPECIES_TABLE, STAPLE_IDS } from './species.ts'
import type { SpeciesV2 } from './speciesV2.ts'
import { logEventExtra } from './speciesV2.ts'

/** Livestock plague: new SpeciesAdopted events of herd animals since the last call. */
export function plagueFromEvents(s: HistoryState, v: SpeciesV2): void {
  const ev = s.events
  const sp = s.sp
  for (let i = v.evSeen; i < ev.length; i++) {
    const e = ev[i]
    if (e.type !== EventType.SpeciesAdopted) continue
    const x = e.value
    if (SPECIES_TABLE[x].category !== SpeciesCategory.Livestock || e.other < 0) continue
    const q = s.people[e.settlement], src = s.people[e.other]
    const ys = sp.year[src * ITEMS + x]
    if (ys < 0 || s.year - ys < BLIGHT.panzooticAge || v.herdLeft[q] > 0) continue
    if (v.rngHazard.next() >= BLIGHT.panzootic) continue
    const loss = v.rngHazard.range(BLIGHT.herdLow, BLIGHT.herdHigh)
    v.herdLoss[q] = loss
    v.herdLeft[q] = BLIGHT.herdYears
    sp.herdKeep[q] = 1 - loss
    refreshPeople(s, q, -1)
    logEventExtra(s, EventType.Panzootic, e.settlement, e.other, x, loss)
    v.plagueLog.push(s.year, q, x, loss, src)
  }
  v.evSeen = ev.length
}

/** Crop multipliers of people p's living settlements (those holding species x, or all for x < 0) after a change of blight or herds. */
function refreshPeople(s: HistoryState, p: number, x: number): void {
  const sp = s.sp
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    if (s.people[id] !== p) continue
    if (x >= 0 && !hasBit(sp.m0[id], sp.m1[id], x)) continue
    cropOf(s, id, sp.m0[id], sp.m1[id], true)
  }
}

/** Yearly: blights and plagues run their course. */
export function blightYear(s: HistoryState, v: SpeciesV2): void {
  const sp = s.sp
  const P = v.P
  for (let p = 0; p < P; p++) {
    for (let t = 0; t < NST; t++) {
      const i = p * NST + t
      if (v.blightLeft[i] <= 0) continue
      if (--v.blightLeft[i] > 0) continue
      sp.bmul[i] = 1
      v.strains[i]++
      refreshPeople(s, p, STAPLE_IDS[t])
    }
    if (v.herdLeft[p] > 0) {
      const left = --v.herdLeft[p]
      sp.herdKeep[p] = 1 - (v.herdLoss[p] * left) / BLIGHT.herdYears
      if (left % 3 === 0) refreshPeople(s, p, -1)
    }
  }
}

let PPOP = new Float64Array(0), PW = new Float64Array(0), SH = new Float64Array(0), VOL = new Float64Array(0), VEXT = new Float64Array(0)
let ON = new Uint8Array(0)
/** Decades per blight step (the chances in BLIGHT are per decade). */
const DEC = BLIGHT.step / 10
let ORIGIN_LM: number[][] | null = null
let ORIGIN_WORLD: unknown = null

/** Every BLIGHT.step years: blights strike (see the header). */
export function blightPass(s: HistoryState, v: SpeciesV2, tv: MarketView): void {
  const sp = s.sp
  const P = v.P
  const T = s.terrain
  if (PPOP.length < P) { PPOP = new Float64Array(P); PW = new Float64Array(P); VEXT = new Float64Array(P) }
  if (SH.length < P * NST) SH = new Float64Array(P * NST)
  if (VOL.length < P * P) VOL = new Float64Array(P * P)
  const LMN = T.landmassSize.length
  if (ON.length < P * LMN) ON = new Uint8Array(P * LMN)
  if (ORIGIN_WORLD !== s.world || !ORIGIN_LM) {
    ORIGIN_LM = []
    for (let t = 0; t < NST; t++) ORIGIN_LM.push(sp.origins[STAPLE_IDS[t]].map((c) => T.landmass[c]))
    ORIGIN_WORLD = s.world
  }
  PPOP.fill(0, 0, P); PW.fill(0, 0, P); VEXT.fill(0, 0, P); SH.fill(0, 0, P * NST); VOL.fill(0, 0, P * P); ON.fill(0, 0, P * LMN)
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const p = s.people[id]
    PPOP[p] += s.pop[id]
    let cf = 1 - s.fishFrac[id] - s.liveFrac[id]
    if (cf < 0) cf = 0
    const w = s.pop[id] * cf
    PW[p] += w
    const so = id * NST
    for (let k = 0; k < NST; k++) { const sh = sp.share[so + k]; if (sh > 0) SH[p * NST + k] += w * sh }
    ON[p * LMN + T.landmass[s.cell[id]]] = 1
  }
  for (let p = 0; p < P; p++) if (PW[p] > 0) { const inv = 1 / PW[p]; for (let k = 0; k < NST; k++) SH[p * NST + k] *= inv }
  for (const r of tv.openList) {
    const pa = s.people[tv.rA[r]], pb = s.people[tv.rB[r]]
    if (pa === pb) continue
    const vol = tv.rVol[r]
    VOL[pa * P + pb] += vol; VOL[pb * P + pa] += vol
    VEXT[pa] += vol; VEXT[pb] += vol
  }
  const contact = s.know.contact
  // Pests present: native landmass, or contact with a people growing it on one.
  const native = (p: number, t: number): boolean => { for (const lm of (ORIGIN_LM as number[][])[t]) if (lm >= 0 && ON[p * LMN + lm]) return true; return false }
  for (let p = 0; p < P; p++) {
    if (PPOP[p] <= 0) continue
    for (let t = 0; t < NST; t++) {
      const i = p * NST + t
      if (v.pest[i] || SH[i] <= 0) continue
      if (native(p, t)) { v.pest[i] = 1; continue }
      for (let q = 0; q < P; q++) if (q !== p && PPOP[q] > 0 && contact[p * P + q] >= 0 && SH[q * NST + t] > 0 && native(q, t)) { v.pest[i] = 1; break }
    }
  }
  const B = BLIGHT
  const rng = v.rngHazard
  for (let p = 0; p < P; p++) {
    if (PPOP[p] <= 0) continue
    const ve = VEXT[p]
    for (let t = 0; t < NST; t++) {
      const i = p * NST + t
      const sh = SH[i]
      if (sh < 0.15 || v.blightLeft[i] > 0) continue
      const d = SPECIES_TABLE[STAPLE_IDS[t]]
      let res = 1
      for (let k = 1; k < v.strains[i]; k++) res *= B.resist
      const crowd = smoothstep(B.cropLow, B.cropHigh, PW[p] * sh)
      const risk = (DEC * B.base * (d.clone > 1 ? d.clone : B.seed) * sh * sh * sh * crowd * (1 + ve / (ve + B.tradeHalf)) * (v.pest[i] ? 1 : B.release)) / res
      if (rng.next() >= risk) continue
      strike(s, v, p, t, false)
      // It jumps to peoples in contact growing the crop.
      for (let q = 0; q < P; q++) {
        if (q === p || PPOP[q] <= 0 || contact[p * P + q] < 0) continue
        const j = q * NST + t
        if (SH[j] < 0.05 || v.blightLeft[j] > 0) continue
        const vq = VOL[p * P + q]
        if (rng.next() < SH[j] * (B.jump + (B.jumpTrade * vq) / (vq + B.tradeHalf))) strike(s, v, q, t, true) // (once per outbreak)
      }
    }
  }
}

/** A blight strikes people p's staple t. */
function strike(s: HistoryState, v: SpeciesV2, p: number, t: number, jumped: boolean): void {
  const sp = s.sp
  const B = BLIGHT
  const rng = v.rngHazard
  const x = STAPLE_IDS[t]
  const d = SPECIES_TABLE[x]
  const loss = d.clone > 1 ? rng.range(B.lossLow, B.lossHigh) : rng.range(B.seedLow, B.seedHigh)
  const years = rng.int(B.yearsLow, B.yearsHigh)
  const i = p * NST + t
  sp.bmul[i] = 1 - loss
  v.blightLeft[i] = years
  let at = -1
  for (let k = 0; k < s.living.length; k++) {
    const id = s.living[k]
    if (s.people[id] === p && hasBit(sp.m0[id], sp.m1[id], x) && (at < 0 || s.pop[id] > s.pop[at])) at = id
  }
  // The people's food (population-weighted crop multiplier) before and after: what the blight costs it.
  let before = 0, after = 0
  for (let k = 0; k < s.living.length; k++) { const id = s.living[k]; if (s.people[id] === p) before += s.pop[id] * sp.cropMul[id] }
  refreshPeople(s, p, x)
  for (let k = 0; k < s.living.length; k++) { const id = s.living[k]; if (s.people[id] === p) after += s.pop[id] * sp.cropMul[id] }
  if (at >= 0) logEventExtra(s, EventType.Blight, at, -1, x, loss)
  v.blightLog.push(s.year, p, x, loss, SH[i], PPOP[p], years, jumped ? 1 : 0, before > 0 ? 1 - after / before : 0)
}
