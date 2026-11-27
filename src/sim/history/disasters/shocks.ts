// disasters: what this year's shocks do where people live (disasters-climate.md §3.3-3.6), right after the weather and
// before the harvest: eruptions (ash in the volcano's cell and rings, the witness), earthquakes (by distance within the
// rupture's reach), tsunamis (over the sea from the epicentre: land blocks the wave), and great river floods. Every strike
// goes through strikeTown (§3.4): people killed outright, wealth and merchant capital lost, ports and dams lost, a town
// destroyed. Who dies and what falls draws from 'history-disaster-damage' only; the schedule was drawn in climateYear.

import { CITY_POPULATION, DisasterKind, EventType, TOWN_POPULATION } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import { loseStructure } from '../state.ts'
import type { Weather } from '../weather.ts'
import { logDx } from './climate.ts'
import { dxRelief } from './feedback.ts'
import { DX, R_KM, TENTHS } from './params.ts'
import { addRow, ensureDisasterCap } from './state.ts'
import type { DisasterState } from './state.ts'

/** A living (non-outpost) settlement on cell c, or -1. */
function livingAt(s: HistoryState, c: number): number {
  const id = s.occupant[c]
  return id >= 0 && s.abandoned[id] < 0 && s.outpost[id] === 0 ? id : -1
}

function km(s: HistoryState, a: number, b: number): number {
  const P = s.world.grid.positions
  const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz) * R_KM
}

/** Piecewise-linear table lookup, constant beyond the ends. */
export function lerpTable(t: readonly (readonly [number, number])[], x: number): number {
  if (x <= t[0][0]) return t[0][1]
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) }
  }
  return t[t.length - 1][1]
}

/** 10^(m10 / 10 - 8) from literals (the tsunami reach: 400 km at M 8, 4000 km at M 9). */
function pow10From8(m10: number): number {
  let e = m10 - 80, v = 1
  while (e >= 10) { v *= 10; e -= 10 }
  while (e < 0) { v /= 10; e += 10 }
  return v / TENTHS[e]
}

/** Cells by hops from `start` while within `maxKm` of `centre` (start included), into dx.queue; returns the count. Land and sea, or sea only. */
function reach(s: HistoryState, dx: DisasterState, starts: number[], centre: number, maxKm: number, seaOnly: boolean): number {
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const sea = s.terrain.sea
  const q = dx.queue, mark = dx.mark
  const gen = ++dx.markGen
  let n = 0
  for (const c of starts) if (mark[c] !== gen) { mark[c] = gen; q[n++] = c }
  for (let h = 0; h < n; h++) {
    const c = q[h]
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (mark[j] === gen) continue
      mark[j] = gen
      if (seaOnly && sea[j] === 0) continue
      if (km(s, centre, j) > maxKm) continue
      q[n++] = j
    }
  }
  return n
}

/**
 * The consequences of a direct strike on settlement `id` (§3.4): `share` of its people killed (at most DX.maxShare), as much
 * of its wealth and merchant capital lost (times DX.wealthMul), its port and dam lost by chance, CityDestroyed for a town that
 * lost DX.destroyedShare at once. Returns the people killed.
 */
export function strikeTown(s: HistoryState, dx: DisasterState, id: number, share: number, row: number, flood: boolean): number {
  if (share <= 0) return 0
  if (share > DX.maxShare) share = DX.maxShare
  const before = s.pop[id]
  const lost = share * before
  s.pop[id] = before - lost
  const rows = dx.rows
  rows.deaths[row] += lost
  rows.struck[row]++
  if (lost > rows.worst[row]) { rows.worst[row] = lost; rows.settlement[row] = id }
  const keep = 1 - Math.min(0.9, DX.wealthMul * share)
  s.wealth[id] *= keep
  const g = s.goods
  if (g !== null && id < g.ext.merch.cap) g.ext.merch.mw[id] *= keep
  const rng = dx.rngDamage
  if (s.port[id] >= 0 && rng.next() < Math.min(1, DX.portLoss * share)) loseStructure(s, s.port[id])
  if (s.dam[id] >= 0 && rng.next() < (flood ? DX.damFail : Math.min(1, DX.damLoss * share))) loseStructure(s, s.dam[id])
  dx.struckRow[id] = row; dx.struckLoss[id] = share; dx.struckYear[id] = s.year
  dx.yearStruck.push(id); dx.yearShare.push(share); dx.yearFlood.push(flood ? 1 : 0)
  if (before >= TOWN_POPULATION && share >= DX.destroyedShare) {
    dx.diag.destroyed++
    logDx(s, EventType.CityDestroyed, id, -1, row, share)
  }
  return lost
}

/** Sets a local harvest multiplier on `id` for `years` (the harsher one wins). */
function setLocal(dx: DisasterState, id: number, mul: number, years: number): void {
  if (dx.localLeft[id] <= 0) dx.localList.push(id)
  if (mul < dx.local[id] || dx.localLeft[id] <= 0) dx.local[id] = mul
  if (years > dx.localLeft[id]) dx.localLeft[id] = years
}

function eruption(s: HistoryState, dx: DisasterState): void {
  if (dx.eruptVolc < 0) return
  const row = dx.eruptRow // written in climateYear this year
  const v = dx.eruptVei, vi = v - 5
  const c = dx.vCell[dx.eruptVolc]
  const rng = dx.rngDamage
  const rings = v === 7 ? 2 : vi >= 1 ? 1 : 0
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  // rings by hops
  const q = dx.queue, mark = dx.mark
  const gen = ++dx.markGen
  let n = 0
  q[n++] = c; mark[c] = gen
  let lo = 0
  const ringEnd: number[] = [1]
  for (let d = 0; d < rings; d++) {
    const hi = n
    for (let t = lo; t < hi; t++) for (let k = off[q[t]]; k < off[q[t] + 1]; k++) { const j = nb[k]; if (mark[j] !== gen) { mark[j] = gen; q[n++] = j } }
    lo = hi
    ringEnd.push(n)
  }
  let ring = 0
  for (let t = 0; t < n; t++) {
    while (t >= ringEnd[ring]) ring++
    const id = livingAt(s, q[t])
    if (id < 0) continue
    const lr = DX.ashLoss[vi]
    const share = ring === 0 ? lr[0] + (lr[1] - lr[0]) * rng.next() : ring === 1 ? DX.ashRing[vi] : DX.ashRing[2] / 6
    if (share > 0) strikeTown(s, dx, id, share, row, false)
    setLocal(dx, id, DX.ashHarvest[vi], DX.ashYears[vi])
  }
  // the witness: the nearest living settlement within DX.witnessHops (by hops, then id)
  let wit = -1
  {
    const gen2 = ++dx.markGen
    let m = 0
    q[m++] = c; mark[c] = gen2
    let l = 0
    for (let d = 0; d <= DX.witnessHops && wit < 0; d++) {
      const hi = m
      for (let t = l; t < hi; t++) { const id = livingAt(s, q[t]); if (id >= 0 && (wit < 0 || id < wit)) wit = id }
      if (wit >= 0 || d === DX.witnessHops) break
      for (let t = l; t < hi; t++) for (let k = off[q[t]]; k < off[q[t] + 1]; k++) { const j = nb[k]; if (mark[j] !== gen2) { mark[j] = gen2; q[m++] = j } }
      l = hi
    }
  }
  dx.rows.witness[row] = wit
  if (wit >= 0) logDx(s, EventType.Eruption, wit, -1, row, v)
}

function earthquakes(s: HistoryState, dx: DisasterState): void {
  const ids: number[] = [], shares: number[] = []
  for (let k = 0; k < dx.quakeCell.length; k++) {
    dx.diag.quakes++
    const c = dx.quakeCell[k], m10 = dx.quakeM10[k], M = m10 / 10
    const L = dx.rupture[Math.min(dx.rupture.length - 1, m10 - 70)]
    const Rk = L / 2 + DX.quakeReachAdd
    const n = reach(s, dx, [c], c, Rk, false)
    const base = lerpTable(DX.quakeLoss, M)
    ids.length = 0; shares.length = 0
    for (let t = 0; t < n; t++) {
      const cell = dx.queue[t]
      const id = livingAt(s, cell)
      if (id < 0) continue
      const p = s.pop[id]
      const vul = p >= CITY_POPULATION ? DX.cityVuln : p < TOWN_POPULATION ? DX.villageVuln : 1
      const share = base * (1 - smoothstep(0, Rk, km(s, c, cell))) * vul
      if (share >= DX.minShare) { ids.push(id); shares.push(share) }
    }
    const conv = s.world.tectonic[c] > DX.quakeConv
    const wave = conv && m10 >= Math.round(DX.tsunamiM * 10) && (s.terrain.sea[c] === 1 || s.terrain.seaCoast[c] === 1) ? waveHits(s, dx, c, m10) : null
    if (ids.length === 0 && m10 < 85 && wave === null) continue
    const row = addRow(dx, DisasterKind.Earthquake, s.year, c, -1, M)
    dx.diag.quakeRows++
    for (let i = 0; i < ids.length; i++) strikeTown(s, dx, ids[i], shares[i], row, false)
    if (dx.rows.settlement[row] >= 0) logDx(s, EventType.Earthquake, dx.rows.settlement[row], -1, row, M)
    if (wave !== null) tsunami(s, dx, c, wave, row)
  }
}

interface Wave { reach: number; ids: number[]; shares: number[] }

/** The coastal settlements a great wave from `c` reaches over the sea (land blocks it), with their shares; null if none. */
function waveHits(s: HistoryState, dx: DisasterState, c: number, m10: number): Wave | null {
  const sea = s.terrain.sea, coast = s.terrain.seaCoast
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const starts: number[] = []
  if (sea[c] === 1) starts.push(c)
  else for (let k = off[c]; k < off[c + 1]; k++) if (sea[nb[k]] === 1) starts.push(nb[k])
  if (starts.length === 0) return null
  const Rt = DX.tsunamiReach8 * pow10From8(m10)
  const n = reach(s, dx, starts, c, Rt, true)
  const hit: number[] = []
  const seen = new Set<number>()
  for (let t = 0; t < n; t++) {
    const x = dx.queue[t]
    for (let k = off[x]; k < off[x + 1]; k++) {
      const j = nb[k]
      if (coast[j] !== 1 || seen.has(j)) continue
      seen.add(j)
      const id = livingAt(s, j)
      if (id >= 0) hit.push(id)
    }
  }
  hit.sort((a, b) => a - b)
  const base = lerpTable(DX.tsunamiLoss, m10 / 10)
  const ids: number[] = [], shares: number[] = []
  for (const id of hit) {
    const share = base * (1 - smoothstep(0, Rt, km(s, c, s.cell[id])))
    if (share >= DX.minShare) { ids.push(id); shares.push(share) }
  }
  return ids.length > 0 ? { reach: Rt, ids, shares } : null
}

function tsunami(s: HistoryState, dx: DisasterState, c: number, wave: Wave, cause: number): void {
  const row = addRow(dx, DisasterKind.Tsunami, s.year, c, -1, wave.reach)
  dx.rows.cause[row] = cause
  dx.diag.tsunamis++
  for (let i = 0; i < wave.ids.length; i++) strikeTown(s, dx, wave.ids[i], wave.shares[i], row, false)
  if (dx.rows.settlement[row] >= 0) logDx(s, EventType.Tsunami, dx.rows.settlement[row], dx.rows.settlement[cause], row, dx.rows.struck[row])
}

function floods(s: HistoryState, dx: DisasterState, weather: Weather): void {
  const rng = dx.rngDamage
  for (let r = 0; r < dx.R; r++) {
    const a = dx.fOff[r], b = dx.fOff[r + 1]
    if (a === b) continue
    const wet = weather.regional[r] + dx.kP[r] * dx.rPa[r]
    const p = DX.floodBase * (1 + DX.floodWet * smoothstep(DX.floodWetLo, DX.floodWetHi, wet))
    if (!(dx.floodU[r] < p)) continue
    dx.diag.floods++
    let row = -1, largest = -1, sum = 0
    for (let k = a; k < b; k++) {
      const id = livingAt(s, dx.fCell[k])
      if (id < 0) continue
      if (row < 0) { row = addRow(dx, DisasterKind.Flood, s.year, s.cell[id], r, 0); dx.diag.floodRows++ }
      if (largest < 0 || s.pop[id] > s.pop[largest]) largest = id
      const share = DX.floodLoss[0] + (DX.floodLoss[1] - DX.floodLoss[0]) * rng.next()
      sum += share
      strikeTown(s, dx, id, share, row, true)
      setLocal(dx, id, DX.floodHarvest, 1)
    }
    if (row < 0) continue
    dx.rows.cell[row] = s.cell[largest]
    dx.rows.size[row] = sum / dx.rows.struck[row]
    logDx(s, EventType.Flood, largest, -1, row, dx.struckLoss[largest])
  }
}

/** System (right after the weather): this year's eruptions, earthquakes, tsunamis and floods where people live. */
export function shockYear(s: HistoryState, dx: DisasterState, weather: Weather): void {
  ensureDisasterCap(dx, s.count)
  dx.yearStruck.length = 0; dx.yearShare.length = 0; dx.yearFlood.length = 0
  eruption(s, dx)
  earthquakes(s, dx)
  floods(s, dx, weather)
  dxRelief(s, dx) // feedback: relief for the struck member towns (no-op off)
}
