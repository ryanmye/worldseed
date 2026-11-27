// disasters: the state of the natural shocks and climate regimes (HistoryOptions.disasters; disasters-climate.md §2.3), and
// its set-up from the world alone: the weather regions' climate (rT, rRain, rLat, rHemi, rMon, kT, kP), the big-river cells of
// each region, the volcano catalogue and the earthquake sources. Streams: 'history-volcanoes' (set-up), 'history-climate'
// (fixed draws a year), 'history-shocks-<century>' (fixed draws a year), 'history-disaster-damage' (who and what falls).

import { RIVER_FLOW_THRESHOLD } from '../../../contract.ts'
import type { World } from '../../../contract.ts'
import type { Rng } from '../../rng.ts'
import { createRng } from '../../rng.ts'
import { smoothstep } from '../../util.ts'
import type { Terrain } from '../terrain.ts'
import { gauss } from '../weather.ts'
import { DX, RUPTURE_L7, RUPTURE_STEP, volcBias } from './params.ts'

/** VolcanoKind: where a volcano stands. */
export const VolcanoKind = { Arc: 0, Rift: 1, Hotspot: 2 } as const

/** The History.disasters table being built (parallel arrays, one entry per row). */
export interface DisasterRows {
  kind: number[]; year: number[]; endYear: number[]; cell: number[]; region: number[]; size: number[]; dT: number[]
  settlement: number[]; deaths: number[]; struck: number[]; cause: number[]; volcano: number[]
  /** Living settlement nearest the volcano when it erupted (-1): the namer of the volcano. */
  witness: number[]
  /** Worst loss in people so far (picks `settlement`). */
  worst: number[]
}

/** Counters for the stats harness. */
export interface DisasterDiag {
  eruptions: number[] // by VEI 5/6/7
  quakes: number // drawn (M >= 7)
  quakeRows: number
  tsunamis: number
  floods: number // drawn
  floodRows: number
  destroyed: number
  /** Years in which a region's climate deviation hit maxRegionLoss / maxRegionGain (region-years). */
  clampLoss: number; clampGain: number; regionYears: number
  /** Region-years where the volcanic cooling hit maxVolcanicDT. */
  clampVolc: number
  /** Years when a VolcanicWinter was logged (or would have been, with no settlement). */
  winterYears: number[]
}

export interface DisasterState {
  rngVolc: Rng; rngClimate: Rng; rngDamage: Rng
  /** Century stream of the shocks, recreated at each century ('history-shocks-<c>'). */
  rngShock: Rng | null; shockCentury: number
  seed: number
  R: number
  /** Weather region per cell (shared with the history state). */
  region: Uint16Array
  // --- volcano catalogue (set-up) ---
  vCell: Int32Array; vCum: Float64Array; vKind: Uint8Array
  // --- quake sources (set-up) ---
  qCell: Int32Array; qCum: Float64Array; qConv: Uint8Array
  /** M >= 7 a year on this world's boundary network. */
  rate7: number
  /** Rupture length by tenth of magnitude from M 7.0 (km). */
  rupture: Float64Array
  // --- regions (set-up) ---
  rT: Float64Array; rRain: Float64Array; rLat: Float64Array; rHemi: Int8Array; rMon: Float64Array
  /** Land cells per region (area weight; 0 for an all-sea region). */
  rLand: Float64Array; landTotal: number
  kT: Float64Array; kP: Float64Array
  /** Big-river cells per region (flood exposure): CSR. */
  fOff: Int32Array; fCell: Int32Array
  // --- climate regime (yearly) ---
  gPhi: Float64Array; gC: Float64Array; gT: Float64Array
  rPhi: number; rC: number; pPhi: number; pC: number
  rTa: Float64Array; rPa: Float64Array
  /** The mean volcanic cooling added back to the temperature (volcBias, degC). */
  bias: number
  /** Volcanic growing-season anomaly per region this year, degC (<= 0). */
  rTv: Float64Array
  /** Harvest deviation of the climate per region this year (added to the weather's harvest). */
  D: Float64Array
  /** Eruptions still forcing the climate: rows, and their sulfur factor S (degC). */
  forcing: number[]; forcingS: number[]
  /** This year's drawn schedule (century stream), evaluated in shockYear. */
  eruptVolc: number; eruptVei: number; eruptS: number; eruptRow: number
  quakeCell: number[]; quakeM10: number[]
  floodU: Float64Array
  /** Drought detection per region: years below on / above off, the open row or -1, first year below. */
  dBelow: Int16Array; dAbove: Int16Array; dRow: Int32Array; dFirst: Int32Array
  /** Epoch detection: the global slow anomaly of recent years (ring), current epoch (-1 / 0 / +1) and its row. */
  slowRing: Float64Array; slowSum: number; epoch: number; epochRow: number
  // --- per settlement (grown with s.count) ---
  cap: number
  /** Extra harvest multiplier on a settlement's own fields (ash, flood), 1 = none; years left. */
  local: Float64Array; localLeft: Int16Array; localList: number[]
  /** Last disaster row that struck the settlement, its loss share and year. */
  struckRow: Int32Array; struckLoss: Float32Array; struckYear: Int16Array
  /** This year's strikes: settlement, share, 1 for a flood (read by the landmarks at the end of the year). */
  yearStruck: number[]; yearShare: number[]; yearFlood: number[]
  rows: DisasterRows
  tempSeries: number[]; volcSeries: number[]; harvestSeries: number[]
  diag: DisasterDiag
  /** BFS scratch. */
  mark: Int32Array; markGen: number; queue: Int32Array
}

function emptyRows(): DisasterRows {
  return { kind: [], year: [], endYear: [], cell: [], region: [], size: [], dT: [], settlement: [], deaths: [], struck: [], cause: [], volcano: [], witness: [], worst: [] }
}

/** Plate-change hops per cell (0 on a cell with a neighbour of another plate), up to `maxHops` (larger: maxHops + 1). */
function boundaryHops(world: World, maxHops: number): Int32Array {
  const N = world.grid.cellCount
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const plate = world.plate
  const hops = new Int32Array(N).fill(maxHops + 1)
  const q: number[] = []
  for (let i = 0; i < N; i++) {
    for (let k = off[i]; k < off[i + 1]; k++) if (plate[nb[k]] !== plate[i]) { hops[i] = 0; q.push(i); break }
  }
  for (let h = 0; h < q.length; h++) {
    const c = q[h]
    if (hops[c] >= maxHops) continue
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (hops[j] > hops[c] + 1) { hops[j] = hops[c] + 1; q.push(j) }
    }
  }
  return hops
}

/** Cells within `h` hops of `c` (c included), into `out`. */
function within(world: World, c: number, h: number, mark: Int32Array, gen: number, out: number[]): void {
  const { neighborOffsets: off, neighbors: nb } = world.grid
  out.length = 0
  out.push(c); mark[c] = gen
  let lo = 0
  for (let d = 0; d < h; d++) {
    const hi = out.length
    for (let t = lo; t < hi; t++) {
      const x = out[t]
      for (let k = off[x]; k < off[x + 1]; k++) { const j = nb[k]; if (mark[j] !== gen) { mark[j] = gen; out.push(j) } }
    }
    lo = hi
  }
}

export function createDisasters(world: World, terrain: Terrain, region: Uint16Array, R: number): DisasterState {
  const seed = world.seed
  const N = world.grid.cellCount
  const P = world.grid.positions
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const elev = world.elevation, tect = world.tectonic, temp = world.temperature, rain = world.rainfall
  const rngVolc = createRng(seed, 'history-volcanoes')
  const rngClimate = createRng(seed, 'history-climate')
  const rngDamage = createRng(seed, 'history-disaster-damage')

  // --- regions ---
  const rT = new Float64Array(R), rRain = new Float64Array(R), rLat = new Float64Array(R), rMon = new Float64Array(R), rLand = new Float64Array(R)
  const rHemiSum = new Float64Array(R), arid = new Float64Array(R), aridN = new Float64Array(R)
  const allT = new Float64Array(R), allRain = new Float64Array(R), allLat = new Float64Array(R), allN = new Float64Array(R)
  for (let i = 0; i < N; i++) {
    const r = region[i]
    const y = P[i * 3 + 1]
    const lat = y < 0 ? -y : y
    allT[r] += temp[i]; allRain[r] += rain[i]; allLat[r] += lat; allN[r]++
    if (elev[i] < 0) continue
    rLand[r]++
    rT[r] += temp[i]; rRain[r] += rain[i]; rLat[r] += lat; rHemiSum[r] += y
    rMon[r] += smoothstep(0.7, 0.9, temp[i]) * smoothstep(0.5, 0.8, rain[i])
    if (terrain.capacity[i] > 0) { arid[r] += terrain.aridity[i]; aridN[r]++ }
  }
  const rHemi = new Int8Array(R), kT = new Float64Array(R), kP = new Float64Array(R)
  let landTotal = 0
  for (let r = 0; r < R; r++) {
    const n = rLand[r]
    landTotal += n
    if (n > 0) { rT[r] /= n; rRain[r] /= n; rLat[r] /= n; rMon[r] /= n }
    else if (allN[r] > 0) { rT[r] = allT[r] / allN[r]; rRain[r] = allRain[r] / allN[r]; rLat[r] = allLat[r] / allN[r] }
    rHemi[r] = rHemiSum[r] >= 0 ? 1 : -1
    const cold = 1 - smoothstep(0.35, 0.65, rT[r]), hot = smoothstep(0.8, 0.95, rT[r])
    kT[r] = DX.kBase + DX.kCold * cold - DX.kHot * hot
    kP[r] = 0.5 + (aridN[r] > 0 ? arid[r] / aridN[r] : 0)
  }

  // --- big rivers per region ---
  const flows: number[] = []
  for (let i = 0; i < N; i++) if (elev[i] >= 0 && world.flow[i] >= RIVER_FLOW_THRESHOLD) flows.push(world.flow[i])
  flows.sort((a, b) => a - b)
  const fq = flows.length > 0 ? flows[Math.min(flows.length - 1, Math.floor(DX.floodFlowQ * flows.length))] : Infinity
  const fCount = new Int32Array(R)
  for (let i = 0; i < N; i++) if (elev[i] >= 0 && world.lake[i] === 0 && world.flow[i] >= fq) fCount[region[i]]++
  const fOff = new Int32Array(R + 1)
  for (let r = 0; r < R; r++) fOff[r + 1] = fOff[r] + fCount[r]
  const fCell = new Int32Array(fOff[R])
  const fFill = fOff.slice(0, R)
  for (let i = 0; i < N; i++) if (elev[i] >= 0 && world.lake[i] === 0 && world.flow[i] >= fq) fCell[fFill[region[i]]++] = i

  // --- volcano catalogue ---
  const hops = boundaryHops(world, DX.arcHops)
  const cand: number[] = [], score: number[] = [], kind: number[] = []
  for (let i = 0; i < N; i++) {
    const t = tect[i]
    let coast = elev[i] >= 0
    if (!coast) for (let k = off[i]; k < off[i + 1]; k++) if (elev[nb[k]] >= 0) { coast = true; break }
    if (coast && t >= DX.arcStress && hops[i] <= DX.arcHops) { cand.push(i); score.push(t * (1 + (elev[i] > 0 ? elev[i] : 0))); kind.push(VolcanoKind.Arc) }
    else if (elev[i] >= 0 && t <= -DX.arcStress && hops[i] === 0) { cand.push(i); score.push(0.3 * -t); kind.push(VolcanoKind.Rift) }
  }
  const nHot = rngVolc.int(DX.hotspotsMin, DX.hotspotsMax)
  for (let h = 0; h < nHot; h++) { cand.push(Math.min(N - 1, Math.floor(rngVolc.next() * N))); score.push(1); kind.push(VolcanoKind.Hotspot) }
  const order = cand.map((_, i) => i)
  order.sort((a, b) => score[b] - score[a] || cand[a] - cand[b])
  const mark = new Int32Array(N)
  let gen = 0
  const taken = new Uint8Array(N)
  const near: number[] = []
  const vc: number[] = [], vw: number[] = [], vk: number[] = []
  for (const o of order) {
    if (vc.length >= DX.maxVolcanoes) break
    const c = cand[o]
    within(world, c, DX.volcSpacing, mark, ++gen, near)
    let clash = false
    for (const j of near) if (taken[j]) { clash = true; break }
    if (clash) continue
    taken[c] = 1
    vc.push(c); vw.push(score[o]); vk.push(kind[o])
  }
  const vCum = new Float64Array(vc.length)
  let acc = 0
  for (let v = 0; v < vc.length; v++) { acc += vw[v]; vCum[v] = acc }
  for (let v = 0; v < vc.length; v++) vCum[v] /= acc

  // --- quake sources ---
  const qc: number[] = [], qw: number[] = [], qv: number[] = []
  for (let i = 0; i < N; i++) {
    const t = tect[i], a = t < 0 ? -t : t
    if (hops[i] === 0 && a >= DX.quakeMinStress) { qc.push(i); qw.push(a); qv.push(t > DX.quakeConv ? 1 : 0) }
  }
  const qCum = new Float64Array(qc.length)
  acc = 0
  for (let q = 0; q < qc.length; q++) { acc += qw[q]; qCum[q] = acc }
  for (let q = 0; q < qc.length; q++) qCum[q] /= acc
  const nScale = terrain.n / 48
  const rate7 = Math.min(DX.quakeSlots, (DX.rate7 * qc.length) / (DX.refBoundaryCells * nScale * nScale))
  const rupture = new Float64Array(26)
  rupture[0] = RUPTURE_L7
  for (let k = 1; k < 26; k++) rupture[k] = rupture[k - 1] * RUPTURE_STEP

  // --- climate regime: AR(1) coefficients, started from their stationary spread ---
  const G = DX.gTau.length
  const gPhi = new Float64Array(G), gC = new Float64Array(G), gT = new Float64Array(G)
  for (let k = 0; k < G; k++) {
    const phi = 1 - 1 / DX.gTau[k]
    gPhi[k] = phi; gC[k] = DX.gSd[k] * Math.sqrt(1 - phi * phi)
    gT[k] = DX.gSd[k] * gauss(rngClimate)
  }
  const rPhi = 1 - 1 / DX.rTau, pPhi = 1 - 1 / DX.pTau
  const rTa = new Float64Array(R), rPa = new Float64Array(R)
  for (let r = 0; r < R; r++) { rTa[r] = DX.rSd * gauss(rngClimate); rPa[r] = DX.pSd * gauss(rngClimate) }

  const cap = 256
  return {
    rngVolc, rngClimate, rngDamage, rngShock: null, shockCentury: -1, seed, R, region,
    vCell: Int32Array.from(vc), vCum, vKind: Uint8Array.from(vk),
    qCell: Int32Array.from(qc), qCum, qConv: Uint8Array.from(qv), rate7, rupture,
    rT, rRain, rLat, rHemi, rMon, rLand, landTotal, kT, kP, fOff, fCell,
    gPhi, gC, gT, rPhi, rC: DX.rSd * Math.sqrt(1 - rPhi * rPhi), pPhi, pC: DX.pSd * Math.sqrt(1 - pPhi * pPhi),
    rTa, rPa, bias: volcBias(), rTv: new Float64Array(R), D: new Float64Array(R), forcing: [], forcingS: [],
    eruptVolc: -1, eruptVei: 0, eruptS: 0, eruptRow: -1, quakeCell: [], quakeM10: [], floodU: new Float64Array(R),
    dBelow: new Int16Array(R), dAbove: new Int16Array(R), dRow: new Int32Array(R).fill(-1), dFirst: new Int32Array(R),
    slowRing: new Float64Array(DX.epochWindow), slowSum: 0, epoch: 0, epochRow: -1,
    cap, local: new Float64Array(cap).fill(1), localLeft: new Int16Array(cap), localList: [],
    struckRow: new Int32Array(cap).fill(-1), struckLoss: new Float32Array(cap), struckYear: new Int16Array(cap).fill(-1),
    yearStruck: [], yearShare: [], yearFlood: [],
    rows: emptyRows(), tempSeries: [0], volcSeries: [0], harvestSeries: [1],
    diag: { eruptions: [0, 0, 0], quakes: 0, quakeRows: 0, tsunamis: 0, floods: 0, floodRows: 0, destroyed: 0, clampLoss: 0, clampGain: 0, regionYears: 0, clampVolc: 0, winterYears: [] },
    mark: new Int32Array(N), markGen: 0, queue: new Int32Array(N),
  }
}

/** Grows the per-settlement arrays to hold `n` settlements. */
export function ensureDisasterCap(dx: DisasterState, n: number): void {
  if (n <= dx.cap) return
  let size = dx.cap
  while (size < n) size *= 2
  const local = new Float64Array(size).fill(1); local.set(dx.local); dx.local = local
  const left = new Int16Array(size); left.set(dx.localLeft); dx.localLeft = left
  const row = new Int32Array(size).fill(-1); row.set(dx.struckRow); dx.struckRow = row
  const loss = new Float32Array(size); loss.set(dx.struckLoss); dx.struckLoss = loss
  const yr = new Int16Array(size).fill(-1); yr.set(dx.struckYear); dx.struckYear = yr
  dx.cap = size
}

/** The extra harvest multiplier on settlement `id`'s own fields this year (1 = none). */
export function dxLocal(dx: DisasterState, id: number): number {
  return id < dx.cap ? dx.local[id] : 1
}

/** Appends a row; returns its id. */
export function addRow(dx: DisasterState, kind: number, year: number, cell: number, region: number, size: number): number {
  const r = dx.rows
  const id = r.kind.length
  r.kind.push(kind); r.year.push(year); r.endYear.push(year); r.cell.push(cell); r.region.push(region); r.size.push(size); r.dT.push(0)
  r.settlement.push(-1); r.deaths.push(0); r.struck.push(0); r.cause.push(-1); r.volcano.push(-1); r.witness.push(-1); r.worst.push(0)
  return id
}
