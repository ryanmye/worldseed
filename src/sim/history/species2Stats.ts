// Stats harness, species v2 (run by speciesStats.ts): cash crops and the new goods (trade value and weight by good,
// how far goods travel, price gradients by distance from the producers, wealth of producers and of hubs on luxury
// routes), stimulants (habit spread, harm against a run with harm off, drains), storage, blight (dependence against
// loss), techniques (found, spread, laggards), staple shares and yields, the cold north, long-run event rates; and the
// per-seed printouts (species table, adoption timelines, blights and drains, technique spread, trade value, prices).

import { Biome, EventType, GOOD_COUNT, Good, SpeciesCategory } from '../../contract.ts'
import type { History, World } from '../../contract.ts'
import type { HistoryDiagnostics } from './index.ts'
import type { HistoryState } from './state.ts'
import type { TradeState } from './trade.ts'
import type { Terrain } from './terrain.ts'
import { GOODS } from './params.ts'
import { CASH, FOOD_COUNT, NST, S_COUNT, SP, speciesFit, SPECIES_TABLE, STAPLE_IDS, STIMULANTS } from './species.ts'

const G = GOOD_COUNT // (goods: 13)
const KM = 6371
/** Distance bins for price gradients: 0 the growers themselves, then up to each edge (km), and beyond the last. */
const EDGES = [300, 1000, 2000, 4000]
const NB = EDGES.length + 2
function binOf(d: number): number { if (d === 0) return 0; let b = 1; for (const e of EDGES) if (d >= e) b++; return b }
const BIN_NAMES = ['grower', '<300', '300-1000', '1000-2000', '2000-4000', '4000+']
const SPICES: number[] = [SP.pepper, SP.cloveNutmeg, SP.incense]
const HARMFUL: number[] = [SP.tobacco, SP.poppy, SP.coca]
const CEREALS: number[] = [SP.wheat, SP.barley, SP.paddyRice, SP.maize, SP.sorghum, SP.millet]
const TUBERS: number[] = [SP.potato, SP.sweetPotato, SP.cassava, SP.yamTaro, SP.plantain]
export const GRADIENT_YEARS = [1500, 2000]

function km(P: Float32Array, a: number, b: number): number {
  const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]
  const c = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return 2 * Math.asin(Math.min(1, c / 2)) * KM
}

/** What the probe records. */
export interface Species2Probe {
  /** Per gradient year: [good][bin] prices (traders), for Luxury from spice producers, Luxury from any, Stimulant from harmful growers, Stimulant from any. */
  gradient: number[][][][]
  /** Per sample year (every 100 from 1000): mean leg (km, quantity-weighted) and unit-km per unit produced, per good. */
  legKm: number[][]
  travel: number[][]
  /** Consumption-weighted distance (km) from the nearest producer at 2000, for Luxury and Stimulant: median and 90th percentile. */
  consKm: number[][]
  /** At 2000: wealth per head of luxury / stimulant producers, of hubs luxury routes pass through, of hubs only other routes pass through (medians). */
  wealthProducers: number
  wealthOnRoutes: number
  wealthOthers: number
  wealthAll: number
  /** Mean food multiplier (keep) per 500 years, and per people at 2000. */
  keep: number[]
  /** Population per people every 10 years. */
  popP: number[][]
  /** Trade value by good per 250 years (from the market's goodYear). */
  value: number[][]
}

export function newProbe2(): Species2Probe {
  return { gradient: [], legKm: [], travel: [], consKm: [], wealthProducers: NaN, wealthOnRoutes: NaN, wealthOthers: NaN, wealthAll: NaN, keep: [], popP: [], value: [] }
}

const median = (a: number[]): number => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1] }
const pct = (a: number[], q: number): number => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))] }

/** A probe for runHistory recording Species2Probe. */
export function species2Probe(out: Species2Probe): (s: HistoryState, ts: TradeState) => void {
  return (s, ts) => {
    const y = s.year
    const sp = s.sp
    const P = s.world.grid.positions
    if (y % 10 === 0) {
      const row = new Array<number>(sp.P).fill(0)
      for (const id of s.living) row[s.people[id]] += s.pop[id]
      while (out.popP.length < y / 10) out.popP.push(row.slice())
      out.popP.push(row)
    }
    if (y % 250 === 0) out.value.push(Array.from(ts.goodYear))
    if (y % 500 === 0) { let k = 0, n = 0; for (const id of s.living) { k += sp.keep[id]; n++ } out.keep.push(n ? k / n : 1) }
    const traders = s.living.filter((id) => ts.trader[id] === 1)
    const NC = CASH.length
    const grows = (id: number, xs: number[]): boolean => { for (const x of xs) if (sp.cashX[id * NC + CASH.indexOf(x)] >= 0.01) return true; return false }
    if (GRADIENT_YEARS.indexOf(y) >= 0) {
      const sets: [number, (id: number) => boolean][] = [
        [7, (id) => grows(id, SPICES)], [7, (id) => sp.v2.prod[id * 3 + 1] > 0.01],
        [8, (id) => grows(id, HARMFUL)], [8, (id) => sp.v2.prod[id * 3 + 2] > 0.01],
      ]
      const g4: number[][][] = []
      for (const [g, isProd] of sets) {
        const prods = s.living.filter(isProd)
        const bins: number[][] = []
        for (let b = 0; b < NB; b++) bins.push([])
        if (prods.length) for (const id of traders) {
          let d = 1e9
          if (isProd(id)) d = 0
          else for (const q of prods) { const e = km(P, s.cell[id], s.cell[q]); if (e < d) d = e }
          bins[binOf(d)].push(ts.price[id * G + g])
        }
        g4.push(bins)
      }
      out.gradient.push(g4)
    }
    if (y >= 1000 && y % 100 === 0) {
      const sq = new Array<number>(G).fill(0), sqk = new Array<number>(G).fill(0)
      for (let p = 0; p < ts.pairCount; p++) {
        const d = km(P, s.cell[ts.pairA[p]], s.cell[ts.pairB[p]])
        for (let g = 0; g < G; g++) { const q = ts.pairFlow[(p * G + g) * 2] + ts.pairFlow[(p * G + g) * 2 + 1]; if (q > 0) { sq[g] += q; sqk[g] += q * d } }
      }
      const prod = new Array<number>(G).fill(0)
      for (const id of traders) {
        const F = s.supply[id]
        prod[0] += F * (1 - s.fishFrac[id] - s.liveFrac[id]); prod[1] += F * s.fishFrac[id]; prod[2] += F * s.liveFrac[id]
        for (let g = 6; g < 9; g++) prod[g] += sp.v2.prod[id * 3 + g - 6]
      }
      out.legKm.push(sq.map((q, g) => (q > 0 ? sqk[g] / q : NaN)))
      out.travel.push(prod.map((x, g) => (x > 0 ? sqk[g] / x : NaN)))
    }
    if (y === 2000) {
      const cons: number[][] = []
      for (const g of [7, 8]) {
        const prods = s.living.filter((id) => sp.v2.prod[id * 3 + g - 6] > 0.01)
        const ds: number[] = []
        for (const id of traders) {
          const c = ts.stock[id * G + g]
          if (!(c > 0)) continue
          let d = 1e9
          if (sp.v2.prod[id * 3 + g - 6] > 0.01) d = 0
          else for (const q of prods) { const e = km(P, s.cell[id], s.cell[q]); if (e < d) d = e }
          if (d >= 1e9) continue
          const w = Math.max(1, Math.round(c))
          for (let k = 0; k < Math.min(w, 50); k++) ds.push(d)
        }
        cons.push([median(ds), pct(ds, 0.9)])
      }
      out.consKm = cons
      // Wealth per head: luxury / stimulant producers, settlements on luxury routes, other traders.
      // (Hubs: settlements routes pass through; luxury routes carry at least a quarter of their value as Luxury or Stimulant.)
      const onRoute = new Uint8Array(s.count)
      for (const r of ts.openList) {
        let v = 0, lux = 0
        for (let g = 0; g < G; g++) { const q = ts.rGood[(r * G + g) * 2] + ts.rGood[(r * G + g) * 2 + 1]; v += q * GOODS.value[g]; if (g >= 7) lux += q * GOODS.value[g] }
        const lx = v > 0 && lux / v >= 0.25
        for (const x of ts.rTransit[r]) if (lx) onRoute[x] = 2; else if (!onRoute[x]) onRoute[x] = 1
      }
      const a: number[] = [], b: number[] = [], c: number[] = []
      for (const id of traders) {
        const w = s.wealth[id] / s.pop[id]
        if (sp.v2.prod[id * 3 + 1] + sp.v2.prod[id * 3 + 2] > 0.5) a.push(w)
        if (onRoute[id] === 2) b.push(w)
        else if (onRoute[id] === 1) c.push(w)
      }
      out.wealthProducers = median(a); out.wealthOnRoutes = median(b); out.wealthOthers = median(c)
      out.wealthAll = median(traders.map((id) => s.wealth[id] / s.pop[id]))
    }
  }
}

export interface Species2SeedStats {
  seed: number
  /** Trade value shares (%) per good at 1000 / 1500 / 2000, and weight shares (value / worth) at 2000. */
  valueShare: number[][]
  weightShare: number[]
  gradient: number[][][][]
  legKm: number[]
  travel: number[]
  consKm: number[][]
  wealth: number[]
  wealthAll: number
  /** Peoples with a harmful habit >= 0.2 at 2000; peoples with any habit >= 0.2; HabitSpreads and Drain events. */
  harmfulPeoples: number
  habitPeoples: number
  habitEvents: number
  drains: number
  /** Population at 2000 with harm over without (whole world, and the peoples habituated to a harmful one); NaN without that run. */
  harmPop: number
  harmPopHabituated: number
  keep: number[]
  /** Blights: [year, people, species, share, loss planned, population loss within 20 years, farm food lost at the strike], and plagues count. */
  blights: number[][]
  plagues: number
  /** Techniques per technique: peoples that found it themselves, peoples holding it, median years from the first find to a holder's adoption, laggards (in contact with a holder 300+ years without it). */
  techFound: number[]
  techHeld: number[]
  techLag: number[]
  techLaggards: number[]
  /** Staples at 2000 (% of farmed cells with a staple): top share, cereals, tubers; farmed cells with no staple (%), of them in the cold (|lat| > 50 deg) (%). */
  topShare: number
  cereals: number
  tubers: number
  noCrop: number
  noCropCold: number
  /** Of them, where no staple at all grows (herding tundra, bare desert, high mountain) (%). */
  noCropNothing: number
  /** Mean yield (yield * fit) of the main staple on its cells, potato / sweet potato vs wheat / barley (NaN where none). */
  yieldTuber: number
  yieldGrain: number
  /** Farmed tundra / taiga cells with a herd, % with coldHerd. */
  coldHerd: number
  /** Cash layer: farmed cells with a cash crop at 2000 (%), and cash-crop share of the farmland at the main producers. */
  cashCells: number
  /** Storable share of food, population-weighted mean at 2000 (0..1), for grain-fed and tuber-fed settlements. */
  storeGrain: number
  storeTuber: number
}

export function species2SeedStats(world: World, h: History, terrain: Terrain, diag: HistoryDiagnostics, probe: Species2Probe, harmOff?: Species2Probe): Species2SeedStats {
  const N = world.grid.cellCount
  const P = h.peoples.length
  const S = h.settlements.length
  const d2 = diag.speciesV2!
  const tq = h.tradeSnapshotCount - 1
  const gv = diag.goodVolume
  const valueShare: number[][] = []
  for (const y of [1000, 1500, 2000]) {
    const q = Math.min(tq, y / h.tradeInterval)
    const row = Array.from(gv.slice(q * G, q * G + G))
    const t = row.reduce((a, b) => a + b, 0)
    valueShare.push(row.map((x) => (t > 0 ? (100 * x) / t : 0)))
  }
  const wrow = Array.from(gv.slice(tq * G, tq * G + G)).map((x, g) => x / GOODS.value[g])
  const wt = wrow.reduce((a, b) => a + b, 0)
  const weightShare = wrow.map((x) => (wt > 0 ? (100 * x) / wt : 0))
  const last = h.snapshotCount - 1
  const K = h.stimulants.length
  let harmfulPeoples = 0, habitPeoples = 0
  const habituated = new Uint8Array(P)
  for (let p = 0; p < P; p++) {
    let any = false, harm = false
    for (let k = 0; k < K; k++) {
      const v = h.habit[(last * P + p) * K + k] / 255
      if (v >= 0.2) { any = true; if (HARMFUL.indexOf(h.stimulants[k]) >= 0) harm = true }
    }
    if (any) habitPeoples++
    if (harm) { harmfulPeoples++; habituated[p] = 1 }
  }
  let habitEvents = 0, drains = 0
  for (const e of h.events) { if (e.type === EventType.HabitSpreads) habitEvents++; else if (e.type === EventType.Drain) drains++ }
  let harmPop = NaN, harmPopHabituated = NaN
  if (harmOff && harmOff.popP.length && probe.popP.length) {
    const q = Math.min(probe.popP.length, harmOff.popP.length) - 1
    let a = 0, b = 0, c = 0, d = 0
    for (let p = 0; p < P; p++) { a += probe.popP[q][p]; b += harmOff.popP[q][p]; if (habituated[p]) { c += probe.popP[q][p]; d += harmOff.popP[q][p] } }
    harmPop = b > 0 ? a / b : NaN
    harmPopHabituated = d > 0 ? c / d : NaN
  }
  // Blights with the population lost within 20 years.
  const blights: number[][] = []
  const L = d2.blightLog
  const popAt = (p: number, y: number) => probe.popP[Math.min(probe.popP.length - 1, Math.max(0, Math.round(y / 10)))][p]
  for (let i = 0; i + 8 < L.length; i += 9) {
    const y = L[i], p = L[i + 1]
    const before = popAt(p, y - 10)
    let low = before
    for (let t = y; t <= y + 20 && t <= h.years; t += 10) low = Math.min(low, popAt(p, t))
    blights.push([y, p, L[i + 2], L[i + 4], L[i + 3], before > 0 ? 1 - low / before : 0, L[i + 8]])
  }
  // Techniques.
  const KT = h.techniques.length
  const techFound: number[] = [], techHeld: number[] = [], techLag: number[] = [], techLaggards: number[] = []
  for (let k = 0; k < KT; k++) {
    let found = 0, held = 0, first = 1e9
    for (let p = 0; p < P; p++) { const y = h.techniqueYear[p * KT + k]; if (y >= 0) { held++; if (h.techniqueSource[p * KT + k] < 0) found++; if (y < first) first = y } }
    const lags: number[] = []
    let laggards = 0
    for (let p = 0; p < P; p++) {
      const y = h.techniqueYear[p * KT + k]
      const src = h.techniqueSource[p * KT + k]
      // Years from when it could first be learned (the source had it and the two had met) to the learning.
      if (y >= 0 && src >= 0) lags.push(y - Math.max(h.techniqueYear[src * KT + k], h.contactYear[p * P + src]))
      if (y < 0) {
        // In contact with a holder for 300+ years?
        let since = 1e9
        for (let q = 0; q < P; q++) { const yq = h.techniqueYear[q * KT + k]; const c = h.contactYear[p * P + q]; if (q !== p && yq >= 0 && c >= 0) since = Math.min(since, Math.max(yq, c)) }
        if (since <= h.years - 300) laggards++
      }
    }
    techFound.push(found); techHeld.push(held); techLag.push(median(lags)); techLaggards.push(laggards)
  }
  // Staples, crop 0, yields.
  const lq = h.landSnapshotCount - 1
  const count = new Array<number>(S_COUNT).fill(0)
  let farmed = 0, none = 0, noneCold = 0, noneAny = 0, cashCells = 0, used = 0
  const Pos = world.grid.positions
  const sinCold = Math.sin((50 * Math.PI) / 180)
  let yt = 0, nt = 0, yg = 0, ng = 0
  for (let i = 0; i < N; i++) {
    if (h.landUse[lq * N + i] === 0) continue
    used++
    if (h.cash[lq * N + i] > 0) cashCells++
    const c = h.crop[lq * N + i]
    if (c === 0) {
      none++
      if (Math.abs(Pos[i * 3 + 1]) > sinCold) noneCold++
      let any = false
      for (const x of STAPLE_IDS) if (terrainFit(world, x, i) > 0) { any = true; break }
      if (!any) noneAny++
      continue
    }
    count[c - 1]++
    farmed++
    const x = c - 1
    if (x === SP.potato || x === SP.sweetPotato) { yt += SPECIES_TABLE[x].yield * terrainFit(world, x, i); nt++ }
    if (x === SP.wheat || x === SP.barley) { yg += SPECIES_TABLE[x].yield * terrainFit(world, x, i); ng++ }
  }
  let top = 0
  for (let x = 0; x < S_COUNT; x++) if (count[x] > count[top]) top = x
  const sum = (xs: number[]) => xs.reduce((a, x) => a + count[x], 0)
  // Cold herding.
  let coldH = 0, coldN = 0
  for (let i = 0; i < N; i++) {
    const b = world.biome[i]
    if ((b !== Biome.Tundra && b !== Biome.Taiga) || h.landUse[lq * N + i] === 0 || h.herd[lq * N + i] === 0) continue
    coldN++
    if (h.herd[lq * N + i] - 1 === SP.coldHerd) coldH++
  }
  // Storable share by main staple kind (from the storable snapshot and the crop on the settlement's cell).
  let sg = 0, wg = 0, st = 0, wtb = 0
  for (let id = 0; id < S; id++) {
    const pop = h.population[last * S + id]
    if (!(pop > 0) || h.settlements[id].outpost) continue
    const c = h.crop[lq * N + h.settlements[id].cell] - 1
    const v = h.storable[last * S + id] / 255
    if (CEREALS.indexOf(c) >= 0) { sg += pop * v; wg += pop }
    else if (TUBERS.indexOf(c) >= 0) { st += pop * v; wtb += pop }
  }
  void terrain
  return {
    seed: world.seed, valueShare, weightShare, gradient: probe.gradient,
    legKm: meanRows(probe.legKm.slice(-6)), travel: meanRows(probe.travel.slice(-6)), consKm: probe.consKm,
    wealth: [probe.wealthProducers, probe.wealthOnRoutes, probe.wealthOthers], wealthAll: probe.wealthAll,
    harmfulPeoples, habitPeoples, habitEvents, drains, harmPop, harmPopHabituated, keep: probe.keep,
    blights, plagues: d2.plagueLog.length / 5,
    techFound, techHeld, techLag, techLaggards,
    topShare: farmed > 0 ? (100 * count[top]) / farmed : 0, cereals: farmed > 0 ? (100 * sum(CEREALS)) / farmed : 0, tubers: farmed > 0 ? (100 * sum(TUBERS)) / farmed : 0,
    noCrop: used > 0 ? (100 * none) / used : 0, noCropCold: none > 0 ? (100 * noneCold) / none : 0, noCropNothing: none > 0 ? (100 * noneAny) / none : 0,
    yieldTuber: nt > 0 ? yt / nt : NaN, yieldGrain: ng > 0 ? yg / ng : NaN,
    coldHerd: coldN > 0 ? (100 * coldH) / coldN : NaN, cashCells: used > 0 ? (100 * cashCells) / used : 0,
    storeGrain: wg > 0 ? sg / wg : NaN, storeTuber: wtb > 0 ? st / wtb : NaN,
  }
}

const FITS = new WeakMap<World, Float32Array>()
function terrainFit(world: World, x: number, i: number): number {
  let f = FITS.get(world)
  if (!f) { f = speciesFit(world, true); FITS.set(world, f) }
  return f[x * world.grid.cellCount + i]
}

function meanRows(rows: number[][]): number[] {
  if (!rows.length) return []
  const out: number[] = []
  for (let g = 0; g < rows[0].length; g++) { let t = 0, n = 0; for (const r of rows) if (Number.isFinite(r[g])) { t += r[g]; n++ } out.push(n ? t / n : NaN) }
  return out
}

const rng = (xs: number[], f: (x: number) => string): string => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  return v.length ? `${f(v[v.length >> 1])} [${f(v[0])}..${f(v[v.length - 1])}]` : '-'
}
const f0 = (x: number): string => x.toFixed(0)
const f1 = (x: number): string => x.toFixed(1)
const f2 = (x: number): string => x.toFixed(2)
const GOOD_NAMES = Object.keys(Good)

export function formatSpecies2Stats(rows: Species2SeedStats[]): string {
  const L: string[] = []
  L.push('species v2: trade value share by good (% of value moved; mean over seeds) at 1000 / 1500 / 2000; weight share at 2000')
  for (let t = 0; t < 3; t++) L.push(`  ${[1000, 1500, 2000][t]}: ` + GOOD_NAMES.map((n, g) => `${n} ${f1(rows.reduce((a, r) => a + r.valueShare[t][g], 0) / rows.length)}`).join(', '))
  L.push('  weight 2000: ' + GOOD_NAMES.map((n, g) => `${n} ${f1(rows.reduce((a, r) => a + r.weightShare[g], 0) / rows.length)}`).join(', '))
  L.push(`  Luxury + Stimulant share of value at 2000 ${rng(rows.map((r) => r.valueShare[2][7] + r.valueShare[2][8]), f1)}%, of weight ${rng(rows.map((r) => r.weightShare[7] + r.weightShare[8]), f1)}%; Cloth value share ${rng(rows.map((r) => r.valueShare[2][6]), f1)}% (seeds >= 3%: ${rows.filter((r) => r.valueShare[2][6] >= 3).length}/${rows.length})`)
  L.push('  mean trade leg (km, quantity-weighted, 1500-2000): ' + GOOD_NAMES.map((n, g) => `${n} ${rng(rows.map((r) => r.legKm[g]), f0)}`).join(', '))
  L.push('  unit-km moved per unit produced (1500-2000): ' + GOOD_NAMES.map((n, g) => `${n} ${rng(rows.map((r) => r.travel[g]), f0)}`).join(', '))
  L.push(`  consumption distance from the nearest producer at 2000 (km, median / 90th pct): Luxury ${rng(rows.map((r) => r.consKm[0]?.[0]), f0)} / ${rng(rows.map((r) => r.consKm[0]?.[1]), f0)}, Stimulant ${rng(rows.map((r) => r.consKm[1]?.[0]), f0)} / ${rng(rows.map((r) => r.consKm[1]?.[1]), f0)}`)
  L.push(`  wealth per head at 2000 (medians): luxury / stimulant producers ${rng(rows.map((r) => r.wealth[0]), f1)}, hubs luxury routes pass through ${rng(rows.map((r) => r.wealth[1]), f1)}, hubs only other routes pass through ${rng(rows.map((r) => r.wealth[2]), f1)}; all traders ${rng(rows.map((r) => r.wealthAll), f1)}`)
  const names = ['Luxury vs spice growers', 'Luxury vs any grower', 'Stimulant vs harmful growers', 'Stimulant vs any grower']
  for (let yi = 0; yi < GRADIENT_YEARS.length; yi++) {
    L.push(`  price gradients at ${GRADIENT_YEARS[yi]} (median over seeds of each seed's median price (count of traders), by km from the nearest grower: ${BIN_NAMES.join(' | ')}):`)
    for (let gi = 0; gi < 4; gi++) {
      const cells: string[] = []
      for (let b = 0; b < NB; b++) {
        const meds = rows.map((r) => median(r.gradient[yi]?.[gi]?.[b] ?? [])).filter((x) => Number.isFinite(x))
        const n = rows.reduce((a, r) => a + (r.gradient[yi]?.[gi]?.[b]?.length ?? 0), 0)
        cells.push(meds.length ? `${f1(median(meds))} (${n})` : '-')
      }
      L.push(`    ${names[gi]}: ${cells.join(' | ')}`)
    }
  }
  L.push(`stimulants: peoples with a harmful habit >= 0.2 at 2000 ${rng(rows.map((r) => r.harmfulPeoples), f0)} (seeds with >= 2: ${rows.filter((r) => r.harmfulPeoples >= 2).length}/${rows.length}), with any ${rng(rows.map((r) => r.habitPeoples), f0)}; HabitSpreads ${rng(rows.map((r) => r.habitEvents), f0)}, Drain ${rng(rows.map((r) => r.drains), f0)} per world`)
  L.push(`  population at 2000 with harm / without: world ${rng(rows.map((r) => r.harmPop), f2)}, habituated peoples ${rng(rows.map((r) => r.harmPopHabituated), f2)}; mean food multiplier (cash land, pellagra, harm) per 500 y ${[0, 1, 2, 3, 4].map((t) => rng(rows.map((r) => r.keep[t]), f2)).join(' / ')}`)
  const all = rows.flatMap((r) => r.blights)
  L.push(`blights: per world ${rng(rows.map((r) => r.blights.length), f0)}; livestock plagues ${rng(rows.map((r) => r.plagues), f0)}; by the crop's share of the people's crop food, farm food lost at the strike / population lost within 20 y: ` +
    [[0, 0.5], [0.5, 0.8], [0.8, 1.01]].map(([a, b]) => { const s = all.filter((x) => x[3] >= a && x[3] < b); return `share ${a}-${b > 1 ? 1 : b}: ${rng(s.map((x) => x[6]), f2)} / ${rng(s.map((x) => x[5]), f2)} (${s.length})` }).join('; '))
  L.push(`  worst blights: ` + all.slice().sort((a, b) => b[5] - a[5]).slice(0, 8).map((x) => `${x[0]} ${SPECIES_TABLE[x[2]].archetype} share ${f2(x[3])} lost ${f2(x[5])}`).join('; '))
  L.push('techniques (median over seeds): peoples that found it themselves / holding at the end / years from when it could be learned (source had it, peoples met) to learning it / laggards in contact 300+ y without it')
  const KT = rows[0]?.techFound.length ?? 0
  for (let k = 0; k < KT; k++) L.push(`  ${k}: found ${rng(rows.map((r) => r.techFound[k]), f0)}, held ${rng(rows.map((r) => r.techHeld[k]), f0)}, lag ${rng(rows.map((r) => r.techLag[k]), f0)}, laggards ${rng(rows.map((r) => r.techLaggards[k]), f0)}`)
  L.push(`staples at 2000: top share ${rng(rows.map((r) => r.topShare), f0)}% (seeds < 50%: ${rows.filter((r) => r.topShare < 50).length}/${rows.length}); cereals ${rng(rows.map((r) => r.cereals), f0)}%, tubers ${rng(rows.map((r) => r.tubers), f0)}%; main-crop yield potato/sweet potato ${rng(rows.map((r) => r.yieldTuber), f2)} vs wheat/barley ${rng(rows.map((r) => r.yieldGrain), f2)}`)
  L.push(`  farmed cells with no staple ${rng(rows.map((r) => r.noCrop), f1)}% (of them above 50 deg ${rng(rows.map((r) => r.noCropCold), f0)}%, where no staple grows at all ${rng(rows.map((r) => r.noCropNothing), f0)}%); farmed tundra / taiga cells with a herd: coldHerd ${rng(rows.map((r) => r.coldHerd), f0)}%; farmed cells with a cash crop ${rng(rows.map((r) => r.cashCells), f1)}%`)
  L.push(`  storable share of food at 2000, grain-fed ${rng(rows.map((r) => r.storeGrain), f2)} vs tuber-fed ${rng(rows.map((r) => r.storeTuber), f2)} settlements`)
  return L.join('\n')
}

/** Per-seed printout: species table, cash and stimulant adoption per people, blights, drains, techniques, staple shares, trade value, prices. */
export function species2Detail(world: World, h: History, diag: HistoryDiagnostics, st: Species2SeedStats): string {
  const L: string[] = []
  const P = h.peoples.length
  const X = h.species.length
  const Pos = world.grid.positions
  const lat = (c: number) => ((Math.asin(Math.max(-1, Math.min(1, Pos[c * 3 + 1]))) * 180) / Math.PI).toFixed(0)
  L.push(`seed ${world.seed}: species (id archetype category "name" origins@lat yield/value/habit/harm/storability, peoples holding at the end, first year held):`)
  const cat = ['staple', 'herd', 'fibre', 'luxury', 'stimulant', 'ornamental']
  for (const x of h.species) {
    let n = 0, first = 1e9
    for (let p = 0; p < P; p++) { const y = h.speciesYear[p * X + x.id]; if (y >= 0) { n++; if (y < first) first = y } }
    const extra = [x.yield ? `Y ${x.yield}` : '', x.value ? `value ${x.value}` : '', x.habit !== undefined ? `habit ${x.habit} harm ${x.harm}` : '', x.storability !== undefined ? `store ${x.storability}${x.clonal ? ' clonal' : ''}` : ''].filter(Boolean).join(' ')
    L.push(`  ${x.id} ${x.archetype} ${cat[x.category]} "${x.name}" ${x.origins.map((c) => `${c}@${lat(c)}`).join(',')} ${extra}; held by ${n}${n ? ` from ${first}` : ''}`)
  }
  L.push('  cash and stimulant species per people (year from people, or * tamed / founding):')
  for (let p = 0; p < P; p++) {
    const items: string[] = []
    for (let x = FOOD_COUNT; x < X; x++) {
      const c = h.species[x].category
      if (c !== SpeciesCategory.Fibre && c !== SpeciesCategory.Luxury && c !== SpeciesCategory.Stimulant) continue
      const y = h.speciesYear[p * X + x]
      if (y < 0) continue
      const src = h.speciesSource[p * X + x]
      items.push(`${h.species[x].archetype} ${y}${src >= 0 ? ` p${src}` : '*'}`)
    }
    const K = h.stimulants.length
    const last = h.snapshotCount - 1
    const hab = h.stimulants.map((x, k) => { const v = h.habit[(last * P + p) * K + k] / 255; return v >= 0.05 ? `${h.species[x].archetype} ${v.toFixed(2)}` : '' }).filter(Boolean).join(', ')
    L.push(`    p${p} ${h.peoples[p].name} (cradle ${h.peoples[p].cradle}): ${items.join(', ') || '-'}; habit at the end: ${hab || '-'}`)
  }
  L.push('  blights (year people species share-of-crop-food harvest-lost food-lost population-lost-in-20y): ' + (st.blights.map((b) => `${b[0]} p${b[1]} ${SPECIES_TABLE[b[2]].archetype} ${f2(b[3])} ${f2(b[4])} ${f2(b[6])} ${f2(b[5])}`).join('; ') || 'none'))
  const PL = diag.speciesV2!.plagueLog
  L.push('  livestock plagues: ' + (Array.from({ length: PL.length / 5 }, (_, i) => `${PL[i * 5]} p${PL[i * 5 + 1]} ${SPECIES_TABLE[PL[i * 5 + 2]].archetype} lost ${f2(PL[i * 5 + 3])} (from p${PL[i * 5 + 4]})`).join('; ') || 'none'))
  const DL = diag.speciesV2!.drainLog
  L.push('  drains: ' + (Array.from({ length: DL.length / 5 }, (_, i) => `${DL[i * 5]} p${DL[i * 5 + 1]} ${SPECIES_TABLE[DL[i * 5 + 2]].archetype} paying ${f0(DL[i * 5 + 3])}/y of trade income ${f0(DL[i * 5 + 4])}/y`).join('; ') || 'none'))
  const pel = diag.speciesV2!.pellagra
  L.push('  pellagra (first year per people): ' + (Array.from(pel).map((y, p) => (y >= 0 ? `p${p}@${y}` : '')).filter(Boolean).join(' ') || 'none'))
  const KT = h.techniques.length
  L.push('  techniques (name; people@year, * found there, else <-source people):')
  for (let k = 0; k < KT; k++) {
    const ys: string[] = []
    const order = Array.from({ length: P }, (_, p) => p).filter((p) => h.techniqueYear[p * KT + k] >= 0).sort((a, b) => h.techniqueYear[a * KT + k] - h.techniqueYear[b * KT + k])
    for (const p of order) { const src = h.techniqueSource[p * KT + k]; ys.push(`p${p}@${h.techniqueYear[p * KT + k]}${src < 0 ? '*' : `<p${src}`}`) }
    L.push(`    ${h.techniques[k].archetype} "${h.techniques[k].name}": ${ys.join(' ') || 'never'}`)
  }
  const ln = diag.speciesV2!.localNames
  const W = X + KT
  const loans: string[] = []
  for (let x = 0; x < W && loans.length < 10; x++) for (let p = 0; p < P; p++) { const s = ln[p * W + x]; const base = x < X ? h.species[x].name : h.techniques[x - X].name; if (s && s !== base) { loans.push(`${x < X ? h.species[x].archetype : h.techniques[x - X].archetype}: ${base} -> p${p} ${s}`); break } }
  L.push('  loanwords (first holders\' word -> a borrower\'s): ' + (loans.join('; ') || 'none'))
  L.push('  staple shares of farmed cells over time (%), and cash crops of farmed cells (%):')
  const N = world.grid.cellCount
  for (const year of [500, 1000, 1500, 2000]) {
    if (year > h.years) continue
    const q = year / h.landInterval
    const count = new Array<number>(X).fill(0), cash = new Array<number>(X).fill(0)
    let farmed = 0, used = 0
    for (let i = 0; i < N; i++) {
      if (h.landUse[q * N + i] === 0) continue
      used++
      const c = h.crop[q * N + i]
      if (c > 0) { count[c - 1]++; farmed++ }
      const k = h.cash[q * N + i]
      if (k > 0) cash[k - 1]++
    }
    L.push(`    ${year}: ` + count.map((c, i) => (c > 0 ? `${h.species[i].archetype} ${((100 * c) / farmed).toFixed(0)}` : '')).filter(Boolean).join(', ') + ' | cash ' + (cash.map((c, i) => (c > 0 ? `${h.species[i].archetype} ${((100 * c) / used).toFixed(1)}` : '')).filter(Boolean).join(', ') || '-'))
  }
  L.push('  trade value by good (loads a year, value-weighted) per 250 years: ' + [500, 1000, 1500, 2000].map((y) => { const q = Math.min(h.tradeSnapshotCount - 1, y / h.tradeInterval); return `${y}: ` + GOOD_NAMES.map((n, g) => `${n[0]}${n[1]} ${f0(diag.goodVolume[q * G + g])}`).join(' ') }).join(' | '))
  const names = ['Luxury vs spice growers', 'Luxury vs any grower', 'Stimulant vs harmful growers', 'Stimulant vs any grower']
  for (let yi = 0; yi < st.gradient.length; yi++) {
    L.push(`  price gradient at ${GRADIENT_YEARS[yi]} (median price (traders) by km from the nearest grower: ${BIN_NAMES.join(' | ')}):`)
    for (let gi = 0; gi < 4; gi++) L.push(`    ${names[gi]}: ` + st.gradient[yi][gi].map((b) => (b.length ? `${f1(median(b))} (${b.length})` : '-')).join(' | '))
  }
  L.push(`  how far goods go (mean leg km / unit-km per unit produced): ` + GOOD_NAMES.map((n, g) => `${n} ${f0(st.legKm[g])}/${f0(st.travel[g])}`).join(', '))
  void NST; void STAPLE_IDS; void STIMULANTS
  return L.join('\n')
}
