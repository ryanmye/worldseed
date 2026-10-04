// disease: state of the disease system and its set-up: the world's pool of diseases (drawn at year 0 from
// 'history-disease-pool'), the plague reservoirs (weather regions of steppe or highland) and the fever map.

import { Biome, RIVER_FLOW_THRESHOLD } from '../../../contract.ts'
import type { World } from '../../../contract.ts'
import type { Rng } from '../../rng.ts'
import { smoothstep } from '../../util.ts'
import type { Terrain } from '../terrain.ts'
import type { DiseaseDef } from './params.ts'
import { DISEASE_DEFS, DZ, FEVER } from './params.ts'

export interface DiseaseState {
  /** Pool size, peoples, cells. */
  D: number
  P: number
  N: number
  defs: DiseaseDef[]
  kind: Uint8Array
  /** Crowd: herd-and-town load at which it can emerge (jittered per world); Plague: reservoir weather region (else -1). */
  load: Float64Array
  region: Int32Array
  originCell: Int32Array
  firstYear: Int32Array
  firstSettlement: Int32Array
  originPeople: Int32Array
  /** Plague: strength of the foci left by great waves (decaying) and the towns they linger in. */
  focusW: Float64Array
  foci: number[][]
  /** Pool index of the fever and of camp fever (-1 if none). */
  feverId: number
  campId: number
  /** Fever intensity per cell (natural, static). */
  fever: Float32Array
  rng: Rng

  // Per settlement (grown with the settlement count; `seen` initialised).
  cap: number
  seen: number
  /** Susceptible share per settlement per disease, 0..255: sus[id * D + d]. */
  sus: Uint8Array
  /** Last epidemic of each disease that struck each settlement (an epidemic passes a place once): lastEpi[id * D + d]. */
  lastEpi: Int32Array
  /** Active outbreak: disease + 1 (0 none), its last sick year, yearly loss, epidemic, force of infection (crowd: susceptibles / crowd). */
  act: Uint8Array
  actEnd: Int32Array
  actRate: Float64Array
  actEpi: Int32Array
  actForce: Float64Array
  /** Trade disrupted through this year. */
  tradeUntil: Int32Array
  /** Quarantine row (index into the quarantine table) of a port in quarantine, else -1. */
  quar: Int32Array
  /** Settlements with an active outbreak, in order struck. */
  active: number[]
  /** Trade cost multiplier per settlement (1 where untouched); null-like when tmulOn is false (no settlement touched this year). */
  tmul: Float64Array
  tmulOn: boolean
  tmulList: number[]

  // Per people.
  /** Fever tolerance 0..tolMax. */
  tol: Float64Array
  /** Endemic flag, ever struck flag, last year struck, per people per disease [p * D + d]. */
  endemic: Uint8Array
  ever: Uint8Array
  lastIn: Int32Array
  /** Last year a great epidemic struck each people; steady endemic death rate a year. */
  lastGreat: Int32Array
  endRate: Float64Array

  // Links (rebuilt every DZ.step years): CSR over settlement ids [0, linkN): weight and 1 for sea.
  linkN: number
  lOff: Int32Array
  lTo: Int32Array
  lW: Float64Array
  lSea: Uint8Array
  linkYear: number
  /** Links between settlements of different peoples, flattened (a, b, weight, sea). */
  cross: number[]
  /** Settlements struck lately (their trade is disrupted through tradeUntil). */
  hit: number[]
  /** Journeys already looked at; first contacts this year (pairs a, b). */
  jSeen: number
  contacts: number[]

  // Epidemics.
  eDisease: number[]
  eStart: number[]
  eEnd: number[]
  eOrigin: number[]
  eSource: number[]
  eDeaths: number[]
  eNet: number[]
  eMask: number[]
  ePeoples: number[][]
  eActive: number[]
  eGreat: number[]
  eRows: number[]
  eTownDeaths: number[]
  eTownPop: number[]
  /** Plague: towns of each epidemic where it may linger (foci, if it is great and came from the reservoir). */
  eFoci: number[][]
  /** How each epidemic began (DiseaseVia of its first outbreak). */
  eVia: number[]
  /** Epidemics with settlements still sick. */
  eOpen: number[]

  // Outbreak rows.
  oDisease: number[]
  oSettlement: number[]
  oYear: number[]
  oToll: number[]
  oSource: number[]
  oVia: number[]
  oEpi: number[]

  // Quarantine rows.
  qSettlement: number[]
  qFrom: number[]
  qTo: number[]

  // Snapshots (per snapshot per people).
  snapTol: Uint8Array
  snapEnd: Uint8Array
  snapUsed: number

  diag: DiseaseDiag
}

/** Counters for the stats harness (not part of the contract). */
export interface DiseaseDiag {
  /** ArmyStricken: (year, war, cause 0 epidemic at the target / 1 camp fever / 2 fever ground, exhaustion added) flattened. */
  army: number[]
  /** Wars whose attacker the sickness exhausted (exhaustion crossing 1, so the war ends at the next campaign): (year, war) flattened. */
  spent: number[]
  /** Deaths a year summed per decade: epidemics, endemic, fever. */
  epiDead: number[]
  endDead: number[]
  feverDead: number[]
  /** Introductions blocked by quarantine. */
  blocked: number
  /** Refugees moved and places deserted. */
  fled: number
  deserted: number
}

/** Natural fever intensity per cell: hot, wet, low-lying, more with standing water (lakes, rivers, deltas). */
export function feverMap(world: World, T: Terrain): Float32Array {
  const N = world.grid.cellCount
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const f = new Float32Array(N)
  const F = FEVER
  for (let c = 0; c < N; c++) {
    const e = world.elevation[c]
    if (e < 0 || world.lake[c] || world.biome[c] === Biome.Ice) continue
    const base = smoothstep(F.heat0, F.heat1, world.temperature[c]) * smoothstep(F.wet0, F.wet1, world.rainfall[c]) * (1 - smoothstep(F.low0, F.low1, e))
    if (base <= 0) continue
    let lake = 0, sea = 0
    for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (world.elevation[j] < 0) sea = 1
      else if (world.lake[j]) lake = 1
    }
    const river = world.flow[c] >= RIVER_FLOW_THRESHOLD ? 1 : 0
    let water = 1 + F.lake * lake + F.river * river + F.delta * river * sea
    if (water > F.waterMax) water = F.waterMax
    f[c] = (base * water) / F.waterMax
  }
  void T
  return f
}

/** Weather regions that can hold a plague reservoir: steppe (dry grassland) or temperate highland; a score per region. */
function reservoirScores(world: World, T: Terrain, region: Uint16Array, regionCount: number): { score: Float64Array; landmass: Int32Array; centre: Int32Array } {
  const N = world.grid.cellCount
  const land = new Float64Array(regionCount), steppe = new Float64Array(regionCount), high = new Float64Array(regionCount)
  const cx = new Float64Array(regionCount), cy = new Float64Array(regionCount), cz = new Float64Array(regionCount)
  const lmCount = new Map<number, number>() // (lookups only)
  const lmBest = new Int32Array(regionCount).fill(-1)
  const lmBestN = new Int32Array(regionCount)
  const P = world.grid.positions
  for (let c = 0; c < N; c++) {
    if (world.elevation[c] < 0 || world.lake[c]) continue
    const r = region[c]
    land[r]++
    const b = world.biome[c]
    if ((b === Biome.Grassland || b === Biome.Desert) && world.rainfall[c] < 0.45 && world.temperature[c] > 0.3) steppe[r]++
    if ((b === Biome.Mountain || world.elevation[c] > 0.3) && world.temperature[c] > 0.3 && world.temperature[c] < 0.8) high[r]++
    cx[r] += P[c * 3]; cy[r] += P[c * 3 + 1]; cz[r] += P[c * 3 + 2]
    const key = r * 65536 + T.landmass[c]
    const n = (lmCount.get(key) ?? 0) + 1
    lmCount.set(key, n)
    if (n > lmBestN[r]) { lmBestN[r] = n; lmBest[r] = T.landmass[c] }
  }
  const score = new Float64Array(regionCount)
  for (let r = 0; r < regionCount; r++) {
    if (land[r] < 8) continue
    const sh = steppe[r] / land[r], hh = high[r] / land[r]
    const x = sh > hh ? sh : hh
    score[r] = x >= 0.3 ? x * (land[r] < 16 ? land[r] / 16 : 1) : 0
  }
  // Centre: the region's land cell nearest its mean position.
  const centre = new Int32Array(regionCount).fill(-1)
  const best = new Float64Array(regionCount).fill(1e9)
  for (let c = 0; c < N; c++) {
    if (world.elevation[c] < 0 || world.lake[c]) continue
    const r = region[c]
    if (score[r] <= 0) continue
    const n = land[r]
    const dx = P[c * 3] - cx[r] / n, dy = P[c * 3 + 1] - cy[r] / n, dz = P[c * 3 + 2] - cz[r] / n
    const d = dx * dx + dy * dy + dz * dz
    if (d < best[r]) { best[r] = d; centre[r] = c }
  }
  return { score, landmass: lmBest, centre }
}

function pick(rng: Rng, w: Float64Array): number {
  let tot = 0
  for (let i = 0; i < w.length; i++) tot += w[i]
  if (tot <= 0) return -1
  let u = rng.next() * tot
  for (let i = 0; i < w.length; i++) { u -= w[i]; if (u < 0 && w[i] > 0) return i }
  for (let i = w.length - 1; i >= 0; i--) if (w[i] > 0) return i
  return -1
}

/** The world's diseases and the empty per-settlement state. P peoples (fixed from the founding). */
export function createDisease(world: World, T: Terrain, region: Uint16Array, regionCount: number, P: number, rngPool: Rng, rng: Rng): DiseaseState {
  const N = world.grid.cellCount
  const fever = feverMap(world, T)
  const defs: DiseaseDef[] = []
  const loads: number[] = []
  const regions: number[] = []
  const cells: number[] = []
  const jit = (x: number): number => x * rngPool.range(1 - DZ.loadJitter, 1 + DZ.loadJitter)
  const crowd = (key: string): void => {
    const d = DISEASE_DEFS[key]
    defs.push({ ...d, mortality: d.mortality * rngPool.range(0.85, 1.15) })
    loads.push(jit(d.load)); regions.push(-1); cells.push(-1)
  }
  crowd('pox')
  crowd('measles')
  if (rngPool.next() < DZ.thirdCrowd) crowd('flux')
  // Plague reservoirs.
  const res = reservoirScores(world, T, region, regionCount)
  const r0 = pick(rngPool, res.score)
  if (r0 >= 0) {
    const d = DISEASE_DEFS.plague
    defs.push({ ...d, mortality: d.mortality * rngPool.range(0.85, 1.15) })
    loads.push(0); regions.push(r0); cells.push(res.centre[r0])
    const other = new Float64Array(regionCount)
    for (let r = 0; r < regionCount; r++) if (res.score[r] > 0 && res.landmass[r] !== res.landmass[r0]) other[r] = res.score[r]
    const u = rngPool.next()
    const r1 = pick(rngPool, other)
    if (u < DZ.secondPlague && r1 >= 0) {
      defs.push({ ...d, mortality: d.mortality * rngPool.range(0.7, 1.0), beta: d.beta * 0.9 })
      loads.push(0); regions.push(r1); cells.push(res.centre[r1])
    }
  }
  let feverId = -1
  let anyFever = false
  for (let c = 0; c < N; c++) if (fever[c] >= FEVER.ground) { anyFever = true; break }
  if (anyFever) { feverId = defs.length; defs.push({ ...DISEASE_DEFS.fever }); loads.push(0); regions.push(-1); cells.push(-1) }
  const campId = defs.length
  { const d = DISEASE_DEFS.typhus; defs.push({ ...d, mortality: d.mortality * rngPool.range(0.85, 1.15) }); loads.push(0); regions.push(-1); cells.push(-1) }
  const D = defs.length
  const cap = 256
  const kind = new Uint8Array(D)
  for (let d = 0; d < D; d++) kind[d] = defs[d].kind
  return {
    D, P, N, defs, kind,
    load: Float64Array.from(loads), region: Int32Array.from(regions), originCell: Int32Array.from(cells),
    firstYear: new Int32Array(D).fill(-1), firstSettlement: new Int32Array(D).fill(-1), originPeople: new Int32Array(D).fill(-1),
    focusW: new Float64Array(D), foci: defs.map(() => []),
    feverId, campId, fever, rng,
    cap, seen: 0,
    sus: new Uint8Array(cap * D), lastEpi: new Int32Array(cap * D).fill(-1), act: new Uint8Array(cap), actEnd: new Int32Array(cap), actRate: new Float64Array(cap), actEpi: new Int32Array(cap).fill(-1), actForce: new Float64Array(cap),
    tradeUntil: new Int32Array(cap).fill(-1), quar: new Int32Array(cap).fill(-1), active: [],
    tmul: new Float64Array(cap).fill(1), tmulOn: false, tmulList: [],
    tol: new Float64Array(P), endemic: new Uint8Array(P * D), ever: new Uint8Array(P * D), lastIn: new Int32Array(P * D).fill(-1000000), lastGreat: new Int32Array(P).fill(-1000000), endRate: new Float64Array(P),
    linkN: 0, lOff: new Int32Array(1), lTo: new Int32Array(0), lW: new Float64Array(0), lSea: new Uint8Array(0), linkYear: -1, cross: [], hit: [],
    jSeen: 0, contacts: [],
    eDisease: [], eStart: [], eEnd: [], eOrigin: [], eSource: [], eDeaths: [], eNet: [], eMask: [], ePeoples: [], eActive: [], eGreat: [], eRows: [], eTownDeaths: [], eTownPop: [], eFoci: [], eVia: [], eOpen: [],
    oDisease: [], oSettlement: [], oYear: [], oToll: [], oSource: [], oVia: [], oEpi: [],
    qSettlement: [], qFrom: [], qTo: [],
    snapTol: new Uint8Array(64 * P), snapEnd: new Uint8Array(64 * P), snapUsed: 0,
    diag: { army: [], spent: [], epiDead: [], endDead: [], feverDead: [], blocked: 0, fled: 0, deserted: 0 },
  }
}

/** Grows the per-settlement arrays to hold `count` settlements. */
export function ensureDisease(dz: DiseaseState, count: number): void {
  if (count <= dz.cap) return
  let size = dz.cap
  while (size < count) size *= 2
  const D = dz.D
  const sus = new Uint8Array(size * D); sus.set(dz.sus); dz.sus = sus
  const le = new Int32Array(size * D).fill(-1); le.set(dz.lastEpi); dz.lastEpi = le
  const u8 = (a: Uint8Array): Uint8Array => { const b = new Uint8Array(size); b.set(a); return b }
  const i32 = (a: Int32Array, fill: number): Int32Array => { const b = new Int32Array(size).fill(fill); b.set(a); return b }
  const f64 = (a: Float64Array, fill: number): Float64Array => { const b = new Float64Array(size).fill(fill); b.set(a); return b }
  dz.act = u8(dz.act)
  dz.actEnd = i32(dz.actEnd, 0)
  dz.actRate = f64(dz.actRate, 0)
  dz.actEpi = i32(dz.actEpi, -1)
  dz.actForce = f64(dz.actForce, 0)
  dz.tradeUntil = i32(dz.tradeUntil, -1)
  dz.quar = i32(dz.quar, -1)
  dz.tmul = f64(dz.tmul, 1)
  dz.cap = size
}
