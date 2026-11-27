// disasters: the shock schedule and the climate regime of a year (disasters-climate.md §3.2, §3.3 schedule), run before the
// weather. Both come from the world alone: the century stream 'history-shocks-<c>' and 'history-climate' make a fixed number
// of draws every year, whatever happens, so orders and cradle wishes can never move an eruption, a quake, a flood or the
// climate; they only change who lives where it strikes.
//
// Climate: three global AR(1) temperature components (tau 4, 40, 250 years; a sum of AR(1) processes at spread time scales
// gives an approximately 1/f spectrum, Keshner 1982), a regional temperature and a regional rain regime per weather region,
// and the volcanic cooling of recent eruptions. The deviation they make in a region's harvest, D[r], is added to the
// weather's harvest in place of its anonymous crisis (weather.ts).

import { EventType } from '../../../contract.ts'
import type { EventType as EventTypeT } from '../../../contract.ts'
import { createRng } from '../../rng.ts'
import { clamp } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import { gauss } from '../weather.ts'
import { DX, TENTHS } from './params.ts'
import { addRow } from './state.ts'
import type { DisasterState } from './state.ts'
import { DisasterKind } from '../../../contract.ts'

/** Logs an event with an `extra`. */
export function logDx(s: HistoryState, type: EventTypeT, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

/** Index of the first cumulative weight above u (binary search). */
export function pickCum(cum: Float64Array, u: number): number {
  let lo = 0, hi = cum.length - 1
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (cum[m] > u) hi = m
    else lo = m + 1
  }
  return lo
}

/** P(tenth >= k | the whole step not taken) for the Gutenberg-Richter tenths within one magnitude unit. */
const TENTH_CUT = TENTHS.map((t) => (t - 0.1) / 0.9)

/** Volcanic weight of eruption at cell `c` on region r: 1 in the tropics, else more in its own hemisphere. */
export function hemiW(s: HistoryState, dx: DisasterState, c: number, r: number): number {
  const y = s.world.grid.positions[c * 3 + 1]
  const lat = y < 0 ? -y : y
  if (lat < DX.tropicLat) return 1
  return (y >= 0 ? 1 : -1) === dx.rHemi[r] ? DX.ownHemi : DX.otherHemi
}

/** The year's fixed draws of the shock schedule (eruption 4, quakes slots x 4, floods 1 per region). */
function drawShocks(s: HistoryState, dx: DisasterState): void {
  const c = Math.floor(s.year / 100)
  if (c !== dx.shockCentury || dx.rngShock === null) { dx.rngShock = createRng(dx.seed, `history-shocks-${c}`); dx.shockCentury = c }
  const rng = dx.rngShock
  // eruption
  const u1 = rng.next(), u2 = rng.next(), u3 = rng.next(), u4 = rng.next()
  dx.eruptVolc = -1
  if (u1 < DX.pVei5 && dx.vCell.length > 0) {
    let v = 5
    if (u3 < DX.pStep) { v = 6; if (u3 < DX.pStep * DX.pStep) v = 7 }
    if (v === 7 && s.year < DX.graceYear) v = 6
    dx.eruptVolc = pickCum(dx.vCum, u2)
    dx.eruptVei = v
    dx.eruptS = DX.sulfur[v - 5] * (DX.sulfurLo + (DX.sulfurHi - DX.sulfurLo) * u4)
  }
  // earthquakes (M >= 7): whole magnitudes by comparison with literal powers of 0.1, tenths against TENTHS
  dx.quakeCell.length = 0; dx.quakeM10.length = 0
  const p = dx.rate7 / DX.quakeSlots
  for (let k = 0; k < DX.quakeSlots; k++) {
    const a = rng.next(), b = rng.next(), cc = rng.next(), d = rng.next()
    if (!(a < p) || dx.qCell.length === 0) continue
    const q = pickCum(dx.qCum, b)
    const conv = dx.qConv[q] === 1
    const mmax10 = Math.round((conv ? DX.mmaxConv : DX.mmaxOther) * 10)
    let m10 = 70
    if (cc < 0.1) { m10 = 80; if (cc < 0.01) { m10 = 90; if (cc < 0.001) m10 = 100 } }
    let t = 0
    for (let j = 9; j >= 1; j--) if (d < TENTH_CUT[j]) { t = j; break }
    m10 += t
    if (m10 > mmax10) m10 = mmax10
    if (s.year < DX.graceYear && m10 >= 85) m10 = 84
    dx.quakeCell.push(dx.qCell[q]); dx.quakeM10.push(m10)
  }
  // floods: one draw per region (evaluated after the weather, shocks.ts)
  for (let r = 0; r < dx.R; r++) dx.floodU[r] = rng.next()
}

/** The year's living settlement of most people in each region (-1), and the region's people. */
export function regionTowns(s: HistoryState, dx: DisasterState, best: Int32Array, pop: Float64Array): void {
  best.fill(-1); pop.fill(0)
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const r = dx.region[s.cell[id]]
    pop[r] += s.pop[id]
    if (best[r] < 0 || s.pop[id] > s.pop[best[r]]) best[r] = id
  }
}

let scratchBest = new Int32Array(0), scratchPop = new Float64Array(0)

/** System (before the weather): this year's shock schedule, the climate regime, the volcanic forcing and D[r]. */
export function climateYear(s: HistoryState, dx: DisasterState): void {
  drawShocks(s, dx)
  const R = dx.R
  const year = s.year
  // a new eruption starts forcing this year (its row is written now; its local effects come in shockYear)
  if (dx.eruptVolc >= 0) {
    const c = dx.vCell[dx.eruptVolc]
    const row = addRow(dx, DisasterKind.Eruption, year, c, -1, dx.eruptVei)
    dx.rows.volcano[row] = dx.eruptVolc
    dx.eruptRow = row
    let m = 0
    for (let r = 0; r < R; r++) m += dx.rLand[r] * hemiW(s, dx, c, r)
    dx.rows.dT[row] = dx.landTotal > 0 ? -dx.eruptS * DX.shape[1] * (m / dx.landTotal) : 0
    dx.forcing.push(row); dx.forcingS.push(dx.eruptS)
    dx.diag.eruptions[dx.eruptVei - 5]++
  }
  // climate draws: a fixed count a year (3 + 2R gauss)
  const rng = dx.rngClimate
  for (let k = 0; k < dx.gT.length; k++) dx.gT[k] = dx.gPhi[k] * dx.gT[k] + dx.gC[k] * gauss(rng)
  for (let r = 0; r < R; r++) dx.rTa[r] = dx.rPhi * dx.rTa[r] + dx.rC * gauss(rng)
  for (let r = 0; r < R; r++) dx.rPa[r] = dx.pPhi * dx.rPa[r] + dx.pC * gauss(rng)
  // volcanic forcing of the eruptions of the last DX.shape.length years
  const rTv = dx.rTv
  rTv.fill(0)
  let w = 0
  for (let i = 0; i < dx.forcing.length; i++) {
    const row = dx.forcing[i]
    const t = year - dx.rows.year[row]
    if (t >= DX.shape.length) continue
    dx.forcing[w] = row; dx.forcingS[w] = dx.forcingS[i]; w++
    const c = dx.rows.cell[row], S = dx.forcingS[i] * DX.shape[t]
    for (let r = 0; r < R; r++) rTv[r] -= S * hemiW(s, dx, c, r)
  }
  dx.forcing.length = w; dx.forcingS.length = w
  let slow = dx.bias
  for (let k = 0; k < dx.gT.length; k++) slow += dx.gT[k]
  for (let r = 0; r < R; r++) {
    if (rTv[r] < -DX.maxVolcanicDT) { rTv[r] = -DX.maxVolcanicDT; dx.diag.clampVolc++ }
    const T = slow + dx.rTa[r] + rTv[r]
    let D = dx.kT[r] * T + dx.kP[r] * dx.rPa[r] + DX.kMon * dx.rMon[r] * rTv[r]
    if (dx.rLand[r] > 0) dx.diag.regionYears++
    if (D < -DX.maxRegionLoss) { D = -DX.maxRegionLoss; if (dx.rLand[r] > 0) dx.diag.clampLoss++ }
    else if (D > DX.maxRegionGain) { D = DX.maxRegionGain; if (dx.rLand[r] > 0) dx.diag.clampGain++ }
    dx.D[r] = D
  }
  // a volcanic winter: the peak year (t = 1) of an eruption whose area-mean cooling reaches DX.winterAt
  for (let i = 0; i < dx.forcing.length; i++) {
    const row = dx.forcing[i]
    if (year - dx.rows.year[row] !== 1) continue
    let m = 0
    for (let r = 0; r < R; r++) m += dx.rLand[r] * rTv[r]
    m = dx.landTotal > 0 ? m / dx.landTotal : 0
    if (m > DX.winterAt) continue
    dx.diag.winterYears.push(year)
    if (scratchBest.length < R) { scratchBest = new Int32Array(R); scratchPop = new Float64Array(R) }
    regionTowns(s, dx, scratchBest, scratchPop)
    let br = -1
    for (let r = 0; r < R; r++) if (scratchBest[r] >= 0 && (br < 0 || rTv[r] < rTv[br])) br = r
    if (br < 0) continue
    const wit = dx.rows.witness[row]
    const other = wit >= 0 && s.abandoned[wit] < 0 ? wit : -1
    logDx(s, EventType.VolcanicWinter, scratchBest[br], other, row, clamp(m, -9, 0))
  }
}
