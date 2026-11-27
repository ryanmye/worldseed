// disasters: Phase 2 feedback (disasters-climate.md §3.8, step 10; DX.feedback, read once at set-up as dx.feedback). Every
// hook here returns its neutral value when dx.feedback is false, so the history with disasters but without feedback is
// unchanged. Draws nothing.
//   - storage exhaustion (food, population.ts): a region's bad years in a row (badRun, harvest < DX.badRunAt) run its stores
//     down: the shortfall damping `damp` of a settlement's staples fades to none over DX.exhaustYears,
//     damp_eff = damp + (1 - damp) * min(1, badRun / exhaustYears). The Great Famine of 1315-17 was two to three failed
//     harvests in a row (Wikipedia "Great Famine of 1315-1317"; the count is uncited there).
//   - malnutrition (disease/system.ts strike): the famine factor of an outbreak's toll reads the region's run of bad years as
//     well as this year's food, 1 + DZ.famine * max(1 - food, malnutK * m), and susceptibility is up DX.malnutSus while the
//     region's volcanic cooling is at or below DX.malnutTv. The Justinianic plague of 541 after the 536/540 eruptions (Sigl
//     et al. 2015) is suggestive; the causal link is contested (Mordechai et al. 2019 argue its impact was small).
//   - disaster grievance (polity/unrest.ts, the peasant term, C2; UnrestPart.Disaster): a town struck by an eruption,
//     quake, wave or flood is restless for DX.disasterYears, by the share it lost; halved if its polity sent relief. "Mandate
//     of Heaven" style (Wikipedia "Mandate of Heaven"; the causal weight in dynastic collapse is contested).
//   - relief (shockYear, after the strikes): the struck member town's polity spends DX.reliefShare x its people through
//     finSpend(..., 'welfare') with finances on, else from its capital's wealth if it has that much (R20: riots' GrainDole
//     concession when riots lands; it is not on main yet).
//   - volcanic memory (climate.ts): DX.volcMemory > 0 feeds the area-mean volcanic cooling (mean-free) into a slow global
//     component (Miller et al. 2012, contested), so clusters of eruptions leave cold decades. World-only like the rest of
//     the climate.

import { smoothstep } from '../../util.ts'
import { finSpend } from '../finance/hooks.ts'
import type { HistoryState } from '../state.ts'
import { DX } from './params.ts'
import type { DisasterState } from './state.ts'

/** Storage exhaustion: the shortfall weight of settlement `id`'s stores after its region's run of bad years. */
export function dxDamp(dx: DisasterState, cell: number, damp: number): number {
  if (!dx.feedback || damp >= 1) return damp
  const run = dx.badRun[dx.region[cell]]
  if (run <= 0) return damp
  const f = run >= DX.exhaustYears ? 1 : run / DX.exhaustYears
  return damp + (1 - damp) * f
}

/** Malnutrition: the famine factor of an epidemic's toll at settlement `id` whose food is `food` (1 + DZ.famine x this). */
export function dxMalnut(s: HistoryState, dx: DisasterState, id: number, food: number): number {
  const hunger = food < 1 ? 1 - food : 0
  if (!dx.feedback) return hunger
  const r = dx.region[s.cell[id]]
  const run = dx.badRun[r]
  let m = run >= DX.exhaustYears ? 1 : run / DX.exhaustYears
  if (dx.rTv[r] <= DX.malnutTv && m < DX.malnutWinter) m = DX.malnutWinter
  const v = DX.malnutK * m
  return v > hunger ? v : hunger
}

/** Malnutrition: the susceptibility factor of an outbreak at settlement `id` (>= 1; 1 off or outside the forcing years). */
export function dxMalnutSus(s: HistoryState, dx: DisasterState, id: number): number {
  if (!dx.feedback) return 1
  return dx.rTv[dx.region[s.cell[id]]] <= DX.malnutTv ? 1 + DX.malnutSus : 1
}

/** Disaster grievance of settlement `id` this year (0 off, never struck, or longer ago than DX.disasterYears). */
export function dxGrief(s: HistoryState, dx: DisasterState, id: number): number {
  if (!dx.feedback || id >= dx.cap) return 0
  const y = dx.struckYear[id]
  if (y < 0 || s.year - y > DX.disasterYears) return 0
  const g = DX.disasterGrievance * smoothstep(DX.griefLo, DX.griefHi, dx.struckLoss[id])
  return dx.relieved[id] === 1 ? 0.5 * g : g
}

/** Relief (after this year's strikes): each struck member town's polity pays DX.reliefShare x its people, if it can. */
export function dxRelief(s: HistoryState, dx: DisasterState): void {
  if (!dx.feedback) return
  const ps = s.pol
  for (let k = 0; k < dx.yearStruck.length; k++) {
    const id = dx.yearStruck[k]
    dx.relieved[id] = 0
    if (ps === null || dx.yearShare[k] <= DX.griefLo) continue
    const p = ps.polity[id]
    if (p < 0) continue
    const amount = DX.reliefShare * s.pop[id]
    if (!(amount > 0)) continue
    let paid = false
    if (s.fin !== null) paid = finSpend(s, p, amount, 'welfare')
    else {
      const cap = ps.pCapital[p]
      if (cap >= 0 && s.wealth[cap] >= amount) { s.wealth[cap] -= amount; paid = true }
    }
    if (paid) { dx.relieved[id] = 1; dx.diag.fbRelief++ } else dx.diag.fbUnpaid++
  }
}

/** End of the year: the bad-harvest run of each region (read by next year's food and epidemics). */
export function dxBadRun(s: HistoryState, dx: DisasterState): void {
  if (!dx.feedback) return
  const h = s.harvest
  const d = dx.diag
  for (let r = 0; r < dx.R; r++) {
    dx.badRun[r] = h[r] < DX.badRunAt ? (dx.badRun[r] < 32000 ? dx.badRun[r] + 1 : 32000) : 0
    if (dx.rLand[r] > 0 && dx.badRun[r] > 0) { d.fbBad++; if (dx.badRun[r] >= DX.exhaustYears) d.fbExhausted++ }
  }
}
