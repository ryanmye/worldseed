// Headless tuning harness for the settlement history. Run with:
//   node src/sim/history/stats.ts [seed ...]          (Node >= 23, native type stripping)
//   node src/sim/history/stats.ts --map 42           (also print ASCII maps for the seeds)

import { Biome, CITY_POPULATION, EventType, RIVER_FLOW_THRESHOLD, StructureType, TOWN_POPULATION } from '../../contract.ts'
import type { History, World } from '../../contract.ts'
import { generateWorld } from '../index.ts'
import { LANDMASS_MIN_FRACTION } from '../stats.ts'
import { runHistory } from './index.ts'
import { productivityAt } from './state.ts'
import type { Terrain } from './terrain.ts'

export const STAT_YEARS = [0, 100, 250, 500, 1000, 1500, 2000]
export const HISTORY_STATS_SEEDS = [1, 2, 3, 42, 1337, 2024, 31337, 77, 99999, 123456, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]

export interface YearStats {
  year: number
  living: number
  total: number
  largest: number
  median: number
  /** Share of population in the 10 largest settlements. */
  top10: number
  /** Settled cells / habitable cells. */
  settledFrac: number
  /** Habitable cells inside a living settlement's catchment / habitable cells. */
  claimedFrac: number
  /** Total population / (productivity * total habitable capacity). */
  fill: number
  /** Mean land use and mean degradation over habitable cells (0..1), from the nearest land snapshot. */
  landUse: number
  degradation: number
  /** Living settlements at or above TOWN_POPULATION / CITY_POPULATION. */
  towns: number
  cities: number
  /** Ports and dams in use. */
  ports: number
  dams: number
}

export interface HistoryStats {
  seed: number
  worldMs: number
  ms: number
  settlementsEver: number
  byYear: YearStats[]
  events: number[]
  /** Landmasses with a settlement ever / at the end / landmasses with habitable land. */
  landmassesEver: number
  landmassesEnd: number
  landmassesHabitable: number
  /** Continent-sized landmasses (>= LANDMASS_MIN_FRACTION of the planet): settled at the end / existing. */
  bigSettled: number
  bigTotal: number
  /** Snapshot-to-snapshot drops of total population >= 3%, and the largest such drop (fraction). */
  dips: number
  worstDip: number
  /** Years when the total population was still within 90% of its final value, earliest. */
  /** Settlement size bins at the end: <300, 300-3k, 3k-30k, >=30k. */
  sizeBins: number[]
  /** End population share (%) by site: river cell, coastal (sea or lake) non-river, other; and the same for habitable land area. */
  popSite: number[]
  areaSite: number[]
  /** End population share (%) by biome of the settlement's cell. */
  popBiome: number[]
  /** First year a settlement stood on a continent-sized landmass other than the founders', or -1. */
  firstOverseas: number
  matrixBytes: number
  landBytes: number
  /** Ports / dams built, and lost. */
  portsBuilt: number
  portsLost: number
  damsBuilt: number
  damsLost: number
  /** Abandoned / founded (all foundings, tribes included). */
  abandonShare: number
  /** Abandoned settlements whose cell was later settled again. */
  resettled: number
  /** Land cells whose degradation peaked at >= 0.2 and later fell to half the peak or less. */
  recovered: number
  /** Land cells that ever reached degradation >= 0.2. */
  degradedEver: number
  /** Settlements whose 50-year average reached 300 and later fell below half its peak (while alive), and those of them later abandoned. */
  declined: number
  declinedAbandoned: number
  /** Settlements that ever became towns / cities (events). */
  townsEver: number
  citiesEver: number
  /** End populations of the three largest settlements. */
  top3: number[]
  /** Mean lifetime in years of abandoned settlements. */
  abandonedLife: number
  /**
   * Regions (15 x 15 degree lat/lon sectors holding >= 1% of the world's peak population):
   * how many, how many lost >= 25% of their peak population (50-year moving average) after year 300, and how many of those later regained 90% of that peak.
   */
  regions: number
  regionsDeclined: number
  regionsRecovered: number
  /** Sustained declines (as `declined`) during which the settlement's own cell was >= 40% degraded. */
  declinedDegraded: number
  /** Cells that degraded to >= 0.2, recovered to half of that peak, and later degraded to >= 0.2 again (a second cycle). */
  recycled: number
  /** Settler journeys through >= 2 sea cells, and how many of them left from a settlement with a port in use. */
  overseas: number
  overseasFromPort: number
  /** Mean aridity and mean flow / RIVER_FLOW_THRESHOLD over dam cells; dams on the owner's own cell. */
  damAridity: number
  damFlow: number
  damsAtOwner: number
  /** Coastal settlements at or above the port threshold at the end, and how many of them had a port in use. */
  portEligible: number
  portHas: number
  /** Mean aridity over habitable cells, for comparison with dam sites. */
  landAridity: number
}

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function snapshotTotal(h: History, snap: number): number {
  const S = h.settlements.length
  let t = 0
  for (let id = 0; id < S; id++) t += h.population[snap * S + id]
  return t
}

export function historyStats(world: World, h: History, terrain: Terrain, ms: number, worldMs: number): HistoryStats {
  const S = h.settlements.length
  const N = world.grid.cellCount
  let habitable = 0, habCap = 0
  for (let i = 0; i < N; i++) if (terrain.habitable[i]) { habitable++; habCap += terrain.capacity[i] }
  const claimed = new Int32Array(N).fill(-1)
  const byYear: YearStats[] = []
  for (const year of STAT_YEARS) {
    if (year > h.years) continue
    const snap = Math.floor(year / h.snapshotInterval)
    const pops: number[] = []
    let settled = 0, claimedCount = 0, towns = 0, cities = 0
    const lq = Math.min(h.landSnapshotCount - 1, Math.round(year / h.landInterval))
    let lu = 0, dg = 0
    for (let i = 0; i < N; i++) if (terrain.habitable[i]) { lu += h.landUse[lq * N + i]; dg += h.degradation[lq * N + i] }
    let ports = 0, dams = 0
    for (const st of h.structures) {
      if (st.builtYear > year || (st.lostYear >= 0 && st.lostYear <= year)) continue
      if (st.type === StructureType.Port) ports++
      else dams++
    }
    for (let id = 0; id < S; id++) {
      const p = h.population[snap * S + id]
      if (p <= 0) continue
      pops.push(p)
      if (p >= TOWN_POPULATION) towns++
      if (p >= CITY_POPULATION) cities++
      const c = h.settlements[id].cell
      if (terrain.habitable[c]) settled++
      for (let k = terrain.catchOff[c]; k < terrain.catchOff[c + 1]; k++) {
        const j = terrain.catchCell[k]
        if (terrain.habitable[j] && claimed[j] !== snap) { claimed[j] = snap; claimedCount++ }
      }
    }
    pops.sort((a, b) => b - a)
    let total = 0
    for (const p of pops) total += p
    let top = 0
    for (let i = 0; i < Math.min(10, pops.length); i++) top += pops[i]
    byYear.push({
      year,
      living: pops.length,
      total,
      largest: pops.length > 0 ? pops[0] : 0,
      median: pops.length > 0 ? pops[Math.floor(pops.length / 2)] : 0,
      top10: total > 0 ? top / total : 0,
      settledFrac: settled / habitable,
      claimedFrac: claimedCount / habitable,
      fill: total / (productivityAt(snap * h.snapshotInterval) * habCap),
      landUse: lu / (255 * habitable),
      degradation: dg / (255 * habitable),
      towns, cities, ports, dams,
    })
  }
  const events = [0, 0, 0, 0, 0, 0, 0, 0]
  for (const e of h.events) events[e.type]++

  const lmEver = new Uint8Array(terrain.landmassSize.length)
  const lmEnd = new Uint8Array(terrain.landmassSize.length)
  const lmHab = new Uint8Array(terrain.landmassSize.length)
  for (let i = 0; i < N; i++) if (terrain.habitable[i]) lmHab[terrain.landmass[i]] = 1
  const last = h.snapshotCount - 1
  for (let id = 0; id < S; id++) {
    const m = terrain.landmass[h.settlements[id].cell]
    lmEver[m] = 1
    if (h.population[last * S + id] > 0) lmEnd[m] = 1
  }
  const sum = (a: Uint8Array) => a.reduce((x, y) => x + y, 0)
  let bigSettled = 0, bigTotal = 0
  for (let m = 0; m < terrain.landmassSize.length; m++) {
    if (terrain.landmassSize[m] < LANDMASS_MIN_FRACTION * N) continue
    bigTotal++
    if (lmEnd[m]) bigSettled++
  }

  let dips = 0, worstDip = 0
  let prev = snapshotTotal(h, 0)
  for (let q = 1; q < h.snapshotCount; q++) {
    const t = snapshotTotal(h, q)
    if (prev > 0) {
      const drop = (prev - t) / prev
      if (drop >= 0.03) dips++
      if (drop > worstDip) worstDip = drop
    }
    prev = t
  }
  const sizeBins = [0, 0, 0, 0]
  for (let id = 0; id < S; id++) {
    const p = h.population[last * S + id]
    if (p <= 0) continue
    sizeBins[p < 300 ? 0 : p < 3000 ? 1 : p < 30000 ? 2 : 3]++
  }
  const endPops: number[] = []
  for (let id = 0; id < S; id++) if (h.population[last * S + id] > 0) endPops.push(h.population[last * S + id])
  endPops.sort((a, b) => b - a)
  const top3 = endPops.slice(0, 3)

  // Structures.
  let portsBuilt = 0, portsLost = 0, damsBuilt = 0, damsLost = 0
  for (const st of h.structures) {
    if (st.type === StructureType.Port) { portsBuilt++; if (st.lostYear >= 0) portsLost++ }
    else { damsBuilt++; if (st.lostYear >= 0) damsLost++ }
  }
  // Abandonment and resettlement.
  let abandonedCount = 0, life = 0, resettled = 0
  const lastFounded = new Int32Array(N).fill(-1)
  for (let id = 0; id < S; id++) lastFounded[h.settlements[id].cell] = h.settlements[id].foundedYear
  for (let id = 0; id < S; id++) {
    const st = h.settlements[id]
    if (st.abandonedYear < 0) continue
    abandonedCount++
    life += st.abandonedYear - st.foundedYear
    if (lastFounded[st.cell] >= st.abandonedYear && lastFounded[st.cell] > st.foundedYear) resettled++
  }
  // Land recovery: degradation peaked then fell to half.
  let recovered = 0, degradedEver = 0, recycled = 0
  const thresh = 0.2 * 255
  for (let i = 0; i < N; i++) {
    let peak = 0, done = false, again = false
    for (let q = 0; q < h.landSnapshotCount; q++) {
      const d = h.degradation[q * N + i]
      if (done) { if (d >= thresh) again = true; continue }
      if (d > peak) peak = d
      else if (peak >= thresh && d <= peak / 2) done = true
    }
    if (peak >= thresh) degradedEver++
    if (done) recovered++
    if (again) recycled++
  }
  // Sea crossings (settler journeys through >= 2 sea cells, shallow or deep) and ports.
  let overseas = 0, overseasFromPort = 0
  const J = h.journeys
  for (let j = 0; j < J.count; j++) {
    if (J.kind[j] !== 0) continue
    let deep = 0
    for (let k = J.pathOffsets[j]; k < J.pathOffsets[j + 1]; k++) if (world.elevation[J.path[k]] < 0) deep++
    if (deep < 2) continue
    overseas++
    const from = J.from[j], year = J.arriveYear[j]
    if (h.structures.some((x) => x.type === StructureType.Port && x.settlement === from && x.builtYear <= year && (x.lostYear < 0 || x.lostYear > year))) overseasFromPort++
  }
  let damAridity = 0, damFlow = 0, damsAtOwner = 0, damCount = 0
  for (const x of h.structures) {
    if (x.type !== StructureType.Dam) continue
    damCount++
    damAridity += 1 - smooth01(0.1, 0.45, world.rainfall[x.cell])
    damFlow += world.flow[x.cell] / RIVER_FLOW_THRESHOLD
    if (x.cell === h.settlements[x.settlement].cell) damsAtOwner++
  }
  if (damCount > 0) { damAridity /= damCount; damFlow /= damCount }
  let landAridity = 0
  for (let i = 0; i < N; i++) if (terrain.habitable[i]) landAridity += 1 - smooth01(0.1, 0.45, world.rainfall[i])
  landAridity /= habitable
  let portEligible = 0, portHas = 0
  for (let id = 0; id < S; id++) {
    const p = h.population[last * S + id]
    const c = h.settlements[id].cell
    if (p < 600) continue
    let coastal = false
    for (let k = world.grid.neighborOffsets[c]; k < world.grid.neighborOffsets[c + 1]; k++) {
      const j = world.grid.neighbors[k]
      if (world.elevation[j] < 0 && world.biome[j] !== Biome.Ice) coastal = true
    }
    if (!coastal) continue
    portEligible++
    if (h.structures.some((x) => x.type === StructureType.Port && x.settlement === id && x.lostYear < 0)) portHas++
  }
  // Sustained settlement decline: on 50-year moving averages (so famine dips don't count),
  // reached 300 and later fell below half of its peak average while alive.
  const win = Math.max(1, Math.round(50 / h.snapshotInterval))
  const smooth = (get: (q: number) => number): Float64Array => {
    const out = new Float64Array(h.snapshotCount)
    let acc = 0
    for (let q = 0; q < h.snapshotCount; q++) {
      acc += get(q)
      if (q >= win) acc -= get(q - win)
      out[q] = acc / Math.min(q + 1, win)
    }
    return out
  }
  let declined = 0, declinedAbandoned = 0, declinedDegraded = 0
  for (let id = 0; id < S; id++) {
    const st = h.settlements[id]
    const q0 = Math.ceil(st.foundedYear / h.snapshotInterval) + win
    const q1 = st.abandonedYear >= 0 ? Math.floor(st.abandonedYear / h.snapshotInterval) - 1 : h.snapshotCount - 1
    if (q1 <= q0) continue
    const sm = smooth((q) => h.population[q * S + id])
    let peak = 0, fell = false, peakQ = q0, fellQ = q0
    for (let q = q0; q <= q1; q++) {
      const p = sm[q]
      if (p > peak) { peak = p; peakQ = q }
      else if (peak >= 300 && p < 0.5 * peak) { fell = true; fellQ = q; break }
    }
    if (fell) {
      declined++
      if (st.abandonedYear >= 0) declinedAbandoned++
      let maxDeg = 0
      for (let lq = Math.floor((peakQ * h.snapshotInterval) / h.landInterval); lq <= Math.min(h.landSnapshotCount - 1, Math.ceil((fellQ * h.snapshotInterval) / h.landInterval)); lq++) {
        maxDeg = Math.max(maxDeg, h.degradation[lq * N + st.cell])
      }
      if (maxDeg >= 0.4 * 255) declinedDegraded++
    }
  }
  const site = (c: number): number => {
    if (world.flow[c] >= RIVER_FLOW_THRESHOLD) return 0
    const { neighborOffsets: off, neighbors: nb } = world.grid
    for (let k = off[c]; k < off[c + 1]; k++) if (world.elevation[nb[k]] < 0 || world.lake[nb[k]]) return 1
    return 2
  }
  const popSite = [0, 0, 0], areaSite = [0, 0, 0]
  const popBiome = new Array<number>(11).fill(0)
  let endTotal = 0
  for (let id = 0; id < S; id++) {
    const p = h.population[last * S + id]
    if (p <= 0) continue
    const c = h.settlements[id].cell
    popSite[site(c)] += p
    popBiome[world.biome[c]] += p
    endTotal += p
  }
  for (let i = 0; i < N; i++) if (terrain.habitable[i]) areaSite[site(i)]++
  const pct = (a: number[], t: number) => a.map((x) => (t > 0 ? (100 * x) / t : 0))
  const cradle = S > 0 ? terrain.landmass[h.settlements[0].cell] : -1
  let firstOverseas = -1
  for (let id = 0; id < S; id++) {
    const m = terrain.landmass[h.settlements[id].cell]
    if (m !== cradle && terrain.landmassSize[m] >= LANDMASS_MIN_FRACTION * N) { firstOverseas = h.settlements[id].foundedYear; break }
  }
  // Regional rise and decline: population per 15-degree sector per snapshot.
  const P = world.grid.positions
  const sector = (c: number): number => {
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2]
    const lon = Math.atan2(z, x), lat = Math.asin(Math.max(-1, Math.min(1, y)))
    return Math.min(11, Math.floor(((lat / Math.PI) + 0.5) * 12)) * 24 + Math.min(23, Math.floor(((lon / Math.PI) + 1) * 12))
  }
  const sec = new Int32Array(S)
  for (let id = 0; id < S; id++) sec[id] = sector(h.settlements[id].cell)
  const R = 288
  const regPop = new Float64Array(R * h.snapshotCount)
  for (let q = 0; q < h.snapshotCount; q++) for (let id = 0; id < S; id++) regPop[q * R + sec[id]] += h.population[q * S + id]
  let worldPeak = 0
  for (let q = 0; q < h.snapshotCount; q++) worldPeak = Math.max(worldPeak, snapshotTotal(h, q))
  let regions = 0, regionsDeclined = 0, regionsRecovered = 0
  const q300 = Math.ceil(300 / h.snapshotInterval)
  for (let r = 0; r < R; r++) {
    const sm = smooth((q) => regPop[q * R + r])
    let peak = 0
    for (let q = 0; q < h.snapshotCount; q++) peak = Math.max(peak, sm[q])
    if (peak < 0.01 * worldPeak) continue
    regions++
    let run = 0, declined = false, recovered = false, declinePeak = 0
    for (let q = q300; q < h.snapshotCount; q++) {
      const v = sm[q]
      if (!declined) {
        if (v > run) run = v
        else if (v < 0.75 * run) { declined = true; declinePeak = run }
      } else if (v >= 0.9 * declinePeak) { recovered = true; break }
    }
    if (declined) regionsDeclined++
    if (recovered) regionsRecovered++
  }

  return {
    regions, regionsDeclined, regionsRecovered, declinedDegraded, recycled, overseas, overseasFromPort,
    damAridity, damFlow, damsAtOwner, portEligible, portHas, landAridity,
    seed: world.seed, worldMs, ms, settlementsEver: S, byYear, events,
    popSite: pct(popSite, endTotal), areaSite: pct(areaSite, habitable), popBiome: pct(popBiome, endTotal), firstOverseas,
    landmassesEver: sum(lmEver), landmassesEnd: sum(lmEnd), landmassesHabitable: sum(lmHab), bigSettled, bigTotal,
    dips, worstDip, sizeBins,
    matrixBytes: h.population.byteLength + h.food.byteLength,
    landBytes: h.landUse.byteLength + h.degradation.byteLength,
    portsBuilt, portsLost, damsBuilt, damsLost,
    abandonShare: S > 0 ? abandonedCount / S : 0,
    resettled, recovered, degradedEver, declined, declinedAbandoned,
    townsEver: events[EventType.BecameTown], citiesEver: events[EventType.BecameCity], top3,
    abandonedLife: abandonedCount > 0 ? life / abandonedCount : 0,
  }
}

const pad = (s: string | number, n: number) => String(s).padStart(n)
const fmtPop = (p: number) => (p >= 1e6 ? (p / 1e6).toFixed(2) + 'M' : p >= 1e4 ? (p / 1e3).toFixed(0) + 'k' : p >= 1e3 ? (p / 1e3).toFixed(1) + 'k' : p.toFixed(0))

export function formatHistoryStats(rows: HistoryStats[]): string {
  const L: string[] = []
  L.push('per seed, per year: living settlements / total pop / largest / top-10 share / settled% of habitable cells / claimed% (in a catchment) / fill% (pop vs productivity * capacity)')
  for (const r of rows) {
    L.push(
      `seed ${r.seed}: ${r.ms.toFixed(0)} ms (world ${r.worldMs.toFixed(0)} ms), ${r.settlementsEver} settlements ever, ` +
        `events F/A/Fam/Mig/Built/Town/City/Lost ${r.events.join('/')}, landmasses settled ever/end/habitable ${r.landmassesEver}/${r.landmassesEnd}/${r.landmassesHabitable} (continents ${r.bigSettled}/${r.bigTotal}), ` +
        `dips>=3% ${r.dips} (worst ${(100 * r.worstDip).toFixed(1)}%), end sizes <300/<3k/<30k/30k+ ${r.sizeBins.join('/')}, ` +
        `end pop river/coast/inland ${r.popSite.map((x) => x.toFixed(0)).join('/')}% (of habitable area ${r.areaSite.map((x) => x.toFixed(0)).join('/')}%), ` +
        `first overseas continent ${r.firstOverseas}, matrices ${(r.matrixBytes / 1048576).toFixed(2)} MB + land ${(r.landBytes / 1048576).toFixed(2)} MB`,
    )
    L.push(
      `   ports built/lost ${r.portsBuilt}/${r.portsLost}, dams ${r.damsBuilt}/${r.damsLost}, abandoned ${(100 * r.abandonShare).toFixed(1)}% of foundings (mean life ${r.abandonedLife.toFixed(0)} y), ` +
        `${r.resettled} sites resettled, towns/cities ever ${r.townsEver}/${r.citiesEver}, top3 ${r.top3.map(fmtPop).join(' ')}, ` +
        `cells degraded>=0.2 ${r.degradedEver}, of which recovered to half ${r.recovered}; settlements >=300 whose 50y avg fell below half its peak ${r.declined} (later abandoned ${r.declinedAbandoned}); ` +
        `regions ${r.regions}, lost >=25% of 50y-avg peak ${r.regionsDeclined}, regained 90% ${r.regionsRecovered}; ` +
        `declines on >=40%-degraded own land ${r.declinedDegraded}, cells degraded-recovered-degraded again ${r.recycled}; ` +
        `sea crossings (settlers, >=2 sea cells) ${r.overseas} (from a port ${r.overseasFromPort}); dams: mean aridity ${r.damAridity.toFixed(2)}, mean flow ${r.damFlow.toFixed(1)}x, on owner cell ${r.damsAtOwner}; coastal settlements >=600 at end ${r.portEligible}, with a port ${r.portHas}`,
    )
    L.push('   year  living    total  largest   median  top10  settl%  claim%  fill%   use%   deg%  towns cities ports dams')
    for (const y of r.byYear) {
      L.push(
        `  ${pad(y.year, 5)} ${pad(y.living, 7)} ${pad(fmtPop(y.total), 8)} ${pad(fmtPop(y.largest), 8)} ${pad(fmtPop(y.median), 8)} ${pad((100 * y.top10).toFixed(0) + '%', 6)} ${pad((100 * y.settledFrac).toFixed(1), 7)} ${pad((100 * y.claimedFrac).toFixed(1), 7)} ${pad((100 * y.fill).toFixed(0), 6)} ${pad((100 * y.landUse).toFixed(1), 6)} ${pad((100 * y.degradation).toFixed(1), 6)} ${pad(y.towns, 6)} ${pad(y.cities, 6)} ${pad(y.ports, 5)} ${pad(y.dams, 4)}`,
      )
    }
  }
  // Cross-seed summary.
  L.push('')
  L.push('summary across seeds (median [min..max]):')
  const med = (xs: number[]) => {
    const a = [...xs].sort((x, y) => x - y)
    return a[Math.floor(a.length / 2)]
  }
  const range = (xs: number[], f: (x: number) => string) => (xs.length === 0 ? '-' : `${f(med(xs))} [${f(Math.min(...xs))}..${f(Math.max(...xs))}]`)
  L.push('   year         living                 total                largest               median          top10           claim%           fill%')
  for (let yi = 0; yi < STAT_YEARS.length; yi++) {
    const ys = rows.map((r) => r.byYear[yi]).filter((y) => y !== undefined)
    if (ys.length === 0) continue
    L.push(
      `  ${pad(STAT_YEARS[yi], 5)}  ${pad(range(ys.map((y) => y.living), (x) => x.toFixed(0)), 18)}  ${pad(range(ys.map((y) => y.total), fmtPop), 22)}  ${pad(range(ys.map((y) => y.largest), fmtPop), 20)}  ${pad(range(ys.map((y) => y.median), fmtPop), 20)}  ${pad(range(ys.map((y) => 100 * y.top10), (x) => x.toFixed(0)), 14)}  ${pad(range(ys.map((y) => 100 * y.claimedFrac), (x) => x.toFixed(0)), 14)}  ${pad(range(ys.map((y) => 100 * y.fill), (x) => x.toFixed(0)), 14)}`,
    )
  }
  L.push('   year           use%            deg%        towns        cities         ports          dams')
  for (let yi = 0; yi < STAT_YEARS.length; yi++) {
    const ys = rows.map((r) => r.byYear[yi]).filter((y) => y !== undefined)
    if (ys.length === 0) continue
    const f1 = (x: number) => x.toFixed(1)
    const f0 = (x: number) => x.toFixed(0)
    L.push(
      `  ${pad(STAT_YEARS[yi], 5)}  ${pad(range(ys.map((y) => 100 * y.landUse), f1), 14)}  ${pad(range(ys.map((y) => 100 * y.degradation), f1), 14)}  ${pad(range(ys.map((y) => y.towns), f0), 11)}  ${pad(range(ys.map((y) => y.cities), f0), 11)}  ${pad(range(ys.map((y) => y.ports), f0), 12)}  ${pad(range(ys.map((y) => y.dams), f0), 12)}`,
    )
  }
  const f0 = (x: number) => x.toFixed(0)
  L.push(
    `per seed (median [min..max]): ports built ${range(rows.map((r) => r.portsBuilt), f0)} lost ${range(rows.map((r) => r.portsLost), f0)}; dams built ${range(rows.map((r) => r.damsBuilt), f0)} lost ${range(rows.map((r) => r.damsLost), f0)}; ` +
      `abandoned % of foundings ${range(rows.map((r) => 100 * r.abandonShare), (x) => x.toFixed(1))}; sites resettled ${range(rows.map((r) => r.resettled), f0)}; ` +
      `towns ever ${range(rows.map((r) => r.townsEver), f0)}, cities ever ${range(rows.map((r) => r.citiesEver), f0)}; ` +
      `cells degraded>=0.2 ${range(rows.map((r) => r.degradedEver), f0)}, recovered to half ${range(rows.map((r) => r.recovered), f0)}; ` +
      `settlements >=300 with sustained (50y avg) fall below half of peak ${range(rows.map((r) => r.declined), f0)}, then abandoned ${range(rows.map((r) => r.declinedAbandoned), f0)}; ` +
      `15-degree regions with >=1% of peak pop ${range(rows.map((r) => r.regions), f0)}, that lost >=25% (50y avg) after year 300 ${range(rows.map((r) => r.regionsDeclined), f0)}, then regained 90% ${range(rows.map((r) => r.regionsRecovered), f0)}`,
  )
  L.push(
    `per seed (median [min..max]): declines on >=40%-degraded own land ${range(rows.map((r) => r.declinedDegraded), f0)}; cells degraded, recovered and degraded again ${range(rows.map((r) => r.recycled), f0)}; ` +
      `settler sea crossings (>=2 sea cells) ${range(rows.map((r) => r.overseas), f0)}, share from a port ${range(rows.map((r) => (r.overseas > 0 ? (100 * r.overseasFromPort) / r.overseas : 0)), f0)}%; ` +
      `coastal settlements >=600 with a port at end ${range(rows.map((r) => (r.portEligible > 0 ? (100 * r.portHas) / r.portEligible : 0)), f0)}%; ` +
      `dam cell aridity mean ${range(rows.filter((r) => r.damsBuilt > 0).map((r) => r.damAridity), (x) => x.toFixed(2))} (habitable land mean ${range(rows.map((r) => r.landAridity), (x) => x.toFixed(2))}), dam flow ${range(rows.filter((r) => r.damsBuilt > 0).map((r) => r.damFlow), (x) => x.toFixed(0))}x threshold`,
  )
  L.push(`largest 3 at end per seed: ${rows.map((r) => r.top3.map(fmtPop).join('/')).join('  ')}`)
  L.push(`seeds with a settlement >= 30k at end: ${rows.filter((r) => (r.top3[0] ?? 0) >= 30000).length}/${rows.length}, >= 20k: ${rows.filter((r) => (r.top3[0] ?? 0) >= 20000).length}/${rows.length}, with >= 2 cities: ${rows.filter((r) => (r.top3[1] ?? 0) >= CITY_POPULATION).length}/${rows.length}`)
  const extinct = rows.filter((r) => r.byYear[r.byYear.length - 1].living === 0).length
  const colonised = rows.filter((r) => r.landmassesEnd > 1).length
  const continents = rows.filter((r) => r.bigSettled > 1).length
  L.push(
    `extinctions ${extinct}/${rows.length}; seeds with >1 landmass settled at end ${colonised}/${rows.length}, with >1 continent-sized landmass settled ${continents}/${rows.length}; ` +
      `ms median ${med(rows.map((r) => r.ms)).toFixed(0)} max ${Math.max(...rows.map((r) => r.ms)).toFixed(0)}; ` +
      `settlements ever median ${med(rows.map((r) => r.settlementsEver))} max ${Math.max(...rows.map((r) => r.settlementsEver))}; ` +
      `matrices max ${(Math.max(...rows.map((r) => r.matrixBytes)) / 1048576).toFixed(2)} MB, land matrices max ${(Math.max(...rows.map((r) => r.landBytes)) / 1048576).toFixed(2)} MB`,
  )
  const bio = new Array<number>(11).fill(0)
  for (const r of rows) for (let b = 0; b < 11; b++) bio[b] += r.popBiome[b] / rows.length
  const names = Object.keys(Biome)
  L.push('end population by biome of the settlement cell (mean %): ' + names.map((n, b) => `${n} ${bio[b].toFixed(1)}`).filter((_, b) => b >= 3).join(', '))
  const site = [0, 0, 0], area = [0, 0, 0]
  for (const r of rows) for (let k = 0; k < 3; k++) { site[k] += r.popSite[k] / rows.length; area[k] += r.areaSite[k] / rows.length }
  L.push(`end population on river / coastal / other cells (mean %): ${site.map((x) => x.toFixed(0)).join(' / ')}  vs share of habitable cells ${area.map((x) => x.toFixed(0)).join(' / ')}`)
  const ov = rows.map((r) => r.firstOverseas)
  L.push(`first settlement on another continent-sized landmass, per seed: ${ov.map((y) => (y < 0 ? '-' : String(y))).join(' ')}`)
  const ev = [0, 0, 0, 0, 0, 0, 0, 0]
  for (const r of rows) for (let t = 0; t < 8; t++) ev[t] += r.events[t]
  const names8 = Object.keys(EventType)
  L.push(`events per seed (mean): ${names8.map((n, t) => `${n} ${(ev[t] / rows.length).toFixed(1)}`).join(', ')}`)
  return L.join('\n')
}

/** Total population curve as a compact sparkline row (one char per `step` snapshots). */
export function sparkline(h: History, step = 8): string {
  const chars = ' .:-=+*#%@'
  const vals: number[] = []
  for (let q = 0; q < h.snapshotCount; q += step) vals.push(snapshotTotal(h, q))
  const max = Math.max(...vals)
  return vals.map((v) => chars[Math.min(chars.length - 1, Math.floor((v / max) * (chars.length - 1)))]).join('')
}

/** Equirectangular ASCII map: settlements by size over terrain. */
export function asciiMap(world: World, h: History, year: number, W = 120, H = 40): string {
  const N = world.grid.cellCount
  const P = world.grid.positions
  const grid: string[] = new Array(W * H).fill(' ')
  const rank = new Float64Array(W * H).fill(-1)
  const at = (i: number): number => {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]
    const lon = Math.atan2(z, x), lat = Math.asin(Math.max(-1, Math.min(1, y)))
    const col = Math.min(W - 1, Math.floor(((lon / Math.PI + 1) / 2) * W))
    const row = Math.min(H - 1, Math.floor((1 - (lat / (Math.PI / 2) + 1) / 2) * H))
    return row * W + col
  }
  for (let i = 0; i < N; i++) {
    const p = at(i)
    const e = world.elevation[i], b = world.biome[i]
    let ch = ' ', r = 0
    if (e < 0) { ch = b === Biome.Ice ? '_' : ' '; r = 0 }
    else if (b === Biome.Ice) { ch = '#'; r = 1 }
    else if (world.lake[i]) { ch = 'L'; r = 1.5 }
    else if (world.flow[i] >= RIVER_FLOW_THRESHOLD) { ch = '~'; r = 2 }
    else if (b === Biome.Mountain) { ch = '^'; r = 1.2 }
    else if (b === Biome.Desert) { ch = ':'; r = 1.1 }
    else { ch = '.'; r = 1 }
    if (r > rank[p]) { rank[p] = r; grid[p] = ch }
  }
  const S = h.settlements.length
  const snap = Math.floor(year / h.snapshotInterval)
  for (let id = 0; id < S; id++) {
    const pop = h.population[snap * S + id]
    if (pop <= 0) continue
    const p = at(h.settlements[id].cell)
    const ch = pop >= 30000 ? '@' : pop >= 10000 ? '0' : pop >= 3000 ? 'O' : pop >= 300 ? 'o' : ','
    const r = 10 + pop
    if (r > rank[p]) { rank[p] = r; grid[p] = ch }
  }
  const lines: string[] = [`year ${year}: , <300  o <3k  O <10k  0 <30k  @ 30k+   (. land  ~ river  ^ mountain  : desert  L lake  # ice)`]
  for (let row = 0; row < H; row++) lines.push(grid.slice(row * W, row * W + W).join(''))
  return lines.join('\n')
}

export function runHistoryStats(seeds: number[] = HISTORY_STATS_SEEDS, maps = false): { rows: HistoryStats[]; text: string } {
  const rows: HistoryStats[] = []
  const extra: string[] = []
  // Warm up the JIT so timings reflect steady state.
  runHistory(generateWorld(0), { years: 300 })
  for (const seed of seeds) {
    const t0 = performance.now()
    const w = generateWorld(seed)
    const t1 = performance.now()
    const { history, terrain } = runHistory(w)
    const t2 = performance.now()
    rows.push(historyStats(w, history, terrain, t2 - t1, t1 - t0))
    extra.push(`seed ${pad(seed, 6)} total pop curve 0..${history.years}: |${sparkline(history)}|`)
    if (maps) for (const y of [250, 1000, 2000]) if (y <= history.years) extra.push(asciiMap(w, history, y))
  }
  return { rows, text: formatHistoryStats(rows) + '\n\n' + extra.join('\n') }
}

if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) {
  const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
  const args = argv.slice(2)
  const maps = args.includes('--map')
  const seeds = args.map(Number).filter((s) => Number.isFinite(s))
  console.log(runHistoryStats(seeds.length > 0 ? seeds : HISTORY_STATS_SEEDS, maps).text)
}
