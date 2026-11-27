// disasters: the end of the year (disasters-climate.md §3.7), before the snapshots: persistent droughts from the regional
// rain regime (open after DX.droughtOnYears below DX.droughtOn sd, back-dated to the first year below; closed after
// DX.droughtOffYears above DX.droughtOff), climate epochs from the decadal mean of the global slow anomaly and the volcanic
// cooling (with hysteresis), the climate series, and the decay of the local ash and flood multipliers. Draws nothing.

import { DisasterKind, EventType } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { logDx, regionTowns } from './climate.ts'
import { dxBadRun } from './feedback.ts'
import { DX } from './params.ts'
import { addRow } from './state.ts'
import type { DisasterState } from './state.ts'

let best = new Int32Array(0), rpop = new Float64Array(0)

export function disasterYearEnd(s: HistoryState, dx: DisasterState): void {
  const R = dx.R
  const year = s.year
  const rows = dx.rows
  if (best.length < R) { best = new Int32Array(R); rpop = new Float64Array(R) }
  regionTowns(s, dx, best, rpop)

  // droughts
  for (let r = 0; r < R; r++) {
    if (dx.rLand[r] === 0) continue
    const z = dx.rPa[r] / DX.pSd
    const open = dx.dRow[r]
    if (open < 0) {
      if (z < DX.droughtOn) { if (dx.dBelow[r] === 0) dx.dFirst[r] = year; dx.dBelow[r]++ }
      else dx.dBelow[r] = 0
      if (dx.dBelow[r] >= DX.droughtOnYears) {
        const row = addRow(dx, DisasterKind.Drought, dx.dFirst[r], -1, r, year - dx.dFirst[r] + 1)
        rows.endYear[row] = -1
        dx.dRow[r] = row; dx.dAbove[r] = 0; dx.dBelow[r] = 0
        if (best[r] >= 0 && rpop[r] >= DX.droughtMinPop) {
          rows.settlement[row] = best[r]
          logDx(s, EventType.DroughtBegan, best[r], -1, row, r)
        }
      }
    } else {
      if (z > DX.droughtOff) dx.dAbove[r]++
      else dx.dAbove[r] = 0
      if (dx.dAbove[r] >= DX.droughtOffYears) {
        const last = year - dx.dAbove[r]
        rows.endYear[open] = last
        rows.size[open] = last - rows.year[open] + 1
        dx.dRow[r] = -1; dx.dAbove[r] = 0
        const began = rows.settlement[open]
        const at = began >= 0 && s.abandoned[began] < 0 ? began : best[r]
        if (at >= 0 && rpop[r] >= DX.droughtMinPop) logDx(s, EventType.DroughtEnded, at, -1, open, rows.size[open])
      } else rows.size[open] = year - rows.year[open] + 1
    }
  }

  // the global slow anomaly and the volcanic cooling (area means)
  let slow = 0
  for (let k = 0; k < dx.gT.length; k++) slow += dx.gT[k]
  let ta = 0, tv = 0
  for (let r = 0; r < R; r++) { ta += dx.rLand[r] * dx.rTa[r]; tv += dx.rLand[r] * dx.rTv[r] }
  const L = dx.landTotal > 0 ? dx.landTotal : 1
  ta /= L; tv /= L

  // epochs: the decadal mean of slow + volcanic crosses +-epochOn; ends back inside +-epochOff
  const W = DX.epochWindow
  const k = year % W
  dx.slowSum += slow + tv - dx.slowRing[k]
  dx.slowRing[k] = slow + tv
  if (year >= W) {
    const m = dx.slowSum / W
    if (dx.epoch === 0) {
      if (m >= DX.epochOn || m <= -DX.epochOn) {
        dx.epoch = m > 0 ? 1 : -1
        const row = addRow(dx, dx.epoch > 0 ? DisasterKind.WarmEpoch : DisasterKind.ColdEpoch, year, -1, -1, 0)
        rows.endYear[row] = -1
        rows.dT[row] = m
        dx.epochRow = row
        let big = -1
        for (let r = 0; r < R; r++) if (best[r] >= 0 && (big < 0 || s.pop[best[r]] > s.pop[big])) big = best[r]
        if (big >= 0) { rows.settlement[row] = big; logDx(s, EventType.ClimateTurned, big, -1, row, dx.epoch) }
      }
    } else {
      const row = dx.epochRow
      if (dx.epoch > 0 ? m > rows.dT[row] : m < rows.dT[row]) rows.dT[row] = m
      rows.size[row] = year - rows.year[row] + 1
      if (dx.epoch * m < DX.epochOff) { rows.endYear[row] = year; dx.epoch = 0; dx.epochRow = -1 }
    }
  }

  // series
  let wp = 0, wh = 0
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const p = s.pop[id]
    wp += p
    wh += p * s.harvest[dx.region[s.cell[id]]] * (id < dx.cap ? dx.local[id] : 1)
  }
  dx.tempSeries.push(slow + ta + tv)
  dx.volcSeries.push(tv)
  dx.harvestSeries.push(wp > 0 ? wh / wp : 1)

  dxBadRun(s, dx) // feedback: the regions' runs of bad harvests (no-op off)

  // local multipliers wear off
  let w = 0
  const list = dx.localList
  for (let t = 0; t < list.length; t++) {
    const id = list[t]
    if (--dx.localLeft[id] <= 0) { dx.localLeft[id] = 0; dx.local[id] = 1 }
    else list[w++] = id
  }
  list.length = w
}
