// Headless tuning harness for the settlement history. Run with:
//   node src/sim/history/stats.ts [seed ...]          (Node >= 23, native type stripping)
//   node src/sim/history/stats.ts --map 42           (also print ASCII maps for the seeds, and a road / route map at the end)
// Reports population, towns and cities, land use and degradation (overall and of farmed cells), trade
// (open routes, volume, sea share, route length, share of each good), roads (cells, connected corridors),
// famine rates with and without trade, how city size correlates with trade, and where the largest cities sit;
// peoples and contact; technology per people and expeditions (techStats.ts).

import { Biome, CITY_POPULATION, EventType, GOOD_COUNT, Good, RIVER_FLOW_THRESHOLD, StructureType, TOWN_POPULATION } from '../../contract.ts'
import type { History, World } from '../../contract.ts'
import { generateWorld } from '../index.ts'
import { LANDMASS_MIN_FRACTION } from '../stats.ts'
import { runHistory } from './index.ts'
import type { HistoryDiagnostics, KnowledgeDiag } from './index.ts'
import { productivityAt } from './state.ts'
import { asciiExploreMap, exploreStats, formatExploreStats, formatTechStats, techStats, techTable } from './techStats.ts'
import type { ExploreStats, TechStats } from './techStats.ts'

/** One past the largest event type id. */
const EVENT_TYPES = Math.max(...Object.values(EventType)) + 1
import type { Terrain } from './terrain.ts'

export const STAT_YEARS = [0, 100, 250, 500, 750, 1000, 1500, 2000]
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
  /** Trade routes open (by TradeOpened / TradeClosed events), total volume on them, share of it on routes crossing >= 2 sea cells, mean path length (cells) of open routes. */
  routes: number
  volume: number
  seaShare: number
  routeLen: number
  /** Share of total volume per good (internal diagnostics; zeros when unavailable). */
  goodShare: number[]
  /** Land cells with road >= ROAD_STAT (of 255). */
  roadCells: number
  /** Farmed cells (land use >= FARMED of 255): count, mean degradation and 90th percentile (0..1), share degraded >= 0.3. */
  farmed: number
  farmDegMean: number
  farmDegP90: number
  farmDeg30: number
}

/** Road level (of 255) that counts as a road in the stats, and land use (of 255) that counts as farmed. */
export const ROAD_STAT = 32
export const FARMED = 51

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
  /** Trade: routes ever, and the bytes of the trade volume, wealth and road matrices. */
  routesEver: number
  tradeBytes: number
  /** Famine events per 100 settlement-decades for settlements >= 300 after year 500, with / without an open route at the start of the decade. */
  famineConnected: number
  famineUnconnected: number
  /** Spearman rank correlation at the end, over living settlements >= 300, of population with open route count and with through-volume. */
  rhoRoutes: number
  rhoThrough: number
  /** Top-5 settlements at the end by site: river mouth, port (coastal with a port), other coast, inland river, inland. */
  top5Sites: number[]
  /** Road network at the end (cells >= ROAD_STAT): connected components, share of road cells in the largest, share in components of >= 10 cells. */
  roadComponents: number
  roadLargest: number
  roadInBig: number
  /** Living settlements at the end that are not trading (no open route) / with >= 1 route, and the wealth share of the top 10. */
  wealthTop10: number
  /** Overseas settlement and the spread over landmasses (see overseasStats). */
  sea: OverseasStats
  /** Peoples, cradles, contact and knowledge (see peopleStats). */
  peoples: PeopleStats
  /** Technology per people (see techStats). */
  tech: TechStats
  /** Expeditions, bases, discoveries (see exploreStats). */
  explore: ExploreStats
}

/** Years at which the contact and knowledge figures are taken. */
export const KNOW_YEARS = [0, 250, 500, 1000, 1500, 2000]

export interface PeopleStats {
  peoples: number
  /** Cradles, the distinct landmasses they lie on, and tribes per cradle. */
  cradles: number
  cradleLandmasses: number
  tribesPerCradle: number[]
  /** Contact networks (connected components of the contact graph among peoples) per KNOW_YEARS. */
  networks: number[]
  /** Year of first contact between peoples of the same cradle: median, max over pairs that met, and pairs that never met / pairs. */
  innerMedian: number
  innerMax: number
  innerNever: number
  innerPairs: number
  /** First contact between each pair of cradles (min over their peoples' pairs), -1 if never: "i-j:year". */
  cradleContacts: string[]
  /** Year the last pair of cradles met (or -1 if some never did). */
  allMetYear: number
  /** Land known to each network, % of land cells, largest first, per KNOW_YEARS (e.g. "62/30/8"). */
  knownByNet: string[]
  /** Share of land cells and of sea cells known to nobody, per KNOW_YEARS. */
  unknownLand: number[]
  unknownSea: number[]
  /** Cradles whose peoples all died out, and the year of the first such extinction (-1 if none). */
  cradlesExtinct: number
  firstExtinct: number
  /** Events. */
  firstContacts: number
  voyagesLost: number
  landfalls: number
  /** Shadow-decision counters (diag.knowledge), or undefined. */
  diag?: KnowledgeDiag
  /** How pairs first met (sight, journey, voyage, trade, expedition; diag.contactVia), within a cradle and between cradles. */
  viaInner: number[]
  viaCross: number[]
  /** Knowledge chains: a people knowing a settled cell of a people it had not met, learned through a third it had met. Count of such (knower, owner) pairs, and examples. */
  chains: number
  chainExamples: string[]
}

/** Years at which the landmass-level figures are taken. */
export const SEA_YEARS = [250, 500, 750, 1000, 1500, 2000]
/** A landmass counts as continent-sized at >= LANDMASS_MIN_FRACTION of the planet's cells and with at least this many habitable cells; any other with habitable land is a small island. */
export const CONTINENT_HABITABLE = 50

export interface OverseasStats {
  /** Continent-sized landmasses other than the cradles (the founding tribes' landmasses), and small habitable islands. */
  continents: number
  islands: number
  /** Continents other than the cradles with a living settlement, per SEA_YEARS. */
  continentsSettled: number[]
  /** Share of habitable cells on continent-sized landmasses (cradle included) inside a living settlement's catchment (full reach), per SEA_YEARS; and the same for the cradle alone and for the other continents. */
  claimAll: number[]
  claimCradle: number[]
  claimOther: number[]
  /** Share of small habitable islands settled (a living settlement) at the end, and ever. */
  islandsEnd: number
  islandsEver: number
  /** Share of the total population living off the cradle, per SEA_YEARS. */
  popOffCradle: number[]
  /** First founding on another continent / on any other landmass (-1 if none). */
  firstContinent: number
  firstLandmass: number
  /** Founding journeys (settlers with a parent) and those crossing >= 2 sea cells (seaborne). */
  foundings: number
  seaFoundings: number
  /** Seaborne foundings per era (0-500, 500-1000, 1000-1500, 1500-2000): count, median and max sea cells crossed. */
  eraCount: number[]
  eraMedian: number[]
  eraMax: number[]
  /** Seaborne foundings whose sender had a port in use; median sender population (at the nearest earlier snapshot). */
  seaFromPort: number
  seaSenderPop: number
  /** Seaborne colonies later abandoned (share). */
  seaAbandoned: number
  /** Voyages from the sim's internal records (-1 when unavailable): attempted (launched with a landfall chosen), founded, lost at sea, found no landfall. */
  voyLaunched: number
  voyFounded: number
  voyLost: number
  voyNothing: number
  /** Of launched voyages: share from a port, median sender population, share by sender size (< 300, 300-3k, >= 3k), share sent from off the cradle (onward voyages, island hopping). */
  voyPortShare: number
  voySenderPop: number
  voySize: number[]
  voyOffCradle: number
  /** Founded voyages: sea cost per era (median, 90th percentile, max) and share landing on another landmass than the sender's. */
  voyCost: string
  voyOtherLand: number
  /** Population share per landmass at SEA_YEARS for the largest landmasses (label = habitable cells; c marks the cradle). */
  lmShares: string
  /** At the end: traders (>= 400) off the cradle, and the share of them joined by open routes (through any chain) to a cradle settlement; seaborne colonies that ever traded directly with their mother settlement / eligible pairs (both reached 400 by the end). */
  offTraders: number
  offLinked: number
  motherRoutes: number
  motherPairs: number
}

/** 1 for each landmass a founding tribe lived on (a cradle's landmass). */
export function cradleLandmasses(h: History, terrain: Terrain): Uint8Array {
  const out = new Uint8Array(terrain.landmassSize.length)
  for (const st of h.settlements) if (st.parent < 0) out[terrain.landmass[st.cell]] = 1
  return out
}

/** Settlement spread over landmasses, seaborne foundings and voyages. */
export function overseasStats(world: World, h: History, terrain: Terrain, diag?: HistoryDiagnostics): OverseasStats {
  const N = world.grid.cellCount
  const S = h.settlements.length
  const M = terrain.landmassSize.length
  const lmHab = new Int32Array(M)
  for (let i = 0; i < N; i++) if (terrain.habitable[i]) lmHab[terrain.landmass[i]]++
  // Cradles: the landmasses the founding tribes lived on.
  const isCradle = cradleLandmasses(h, terrain)
  const isCont = (m: number) => terrain.landmassSize[m] >= LANDMASS_MIN_FRACTION * N && lmHab[m] >= CONTINENT_HABITABLE
  let continents = 0, islands = 0
  for (let m = 0; m < M; m++) {
    if (lmHab[m] === 0) continue
    if (isCont(m)) { if (!isCradle[m]) continents++ } else if (!isCradle[m]) islands++
  }
  const continentsSettled: number[] = [], claimAll: number[] = [], claimCradle: number[] = [], claimOther: number[] = [], popOffCradle: number[] = []
  const claimed = new Int32Array(N).fill(-1)
  const lmPop = new Float64Array(M)
  const shareRows: number[][] = []
  const topLm = [...Array(M).keys()].filter((m) => lmHab[m] > 0).sort((a, b) => lmHab[b] - lmHab[a] || a - b).slice(0, 6)
  for (const year of SEA_YEARS) {
    if (year > h.years) continue
    const q = Math.floor(year / h.snapshotInterval)
    lmPop.fill(0)
    const alive = new Uint8Array(M)
    let total = 0
    for (let id = 0; id < S; id++) {
      const p = h.population[q * S + id]
      if (p <= 0) continue
      const c = h.settlements[id].cell
      const m = terrain.landmass[c]
      lmPop[m] += p
      total += p
      alive[m] = 1
      for (let k = terrain.catchOff[c]; k < terrain.catchOff[c + 1]; k++) claimed[terrain.catchCell[k]] = q
    }
    let cs = 0
    for (let m = 0; m < M; m++) if (!isCradle[m] && isCont(m) && alive[m]) cs++
    continentsSettled.push(cs)
    let ha = 0, ca = 0, hc = 0, cc = 0, ho = 0, co = 0
    for (let i = 0; i < N; i++) {
      if (!terrain.habitable[i]) continue
      const m = terrain.landmass[i]
      if (!isCont(m)) continue
      const yes = claimed[i] === q ? 1 : 0
      ha++; ca += yes
      if (isCradle[m]) { hc++; cc += yes } else { ho++; co += yes }
    }
    claimAll.push(ha > 0 ? ca / ha : 0)
    claimCradle.push(hc > 0 ? cc / hc : 0)
    claimOther.push(ho > 0 ? co / ho : 0)
    let onCradle = 0
    for (let m = 0; m < M; m++) if (isCradle[m]) onCradle += lmPop[m]
    popOffCradle.push(total > 0 ? 1 - onCradle / total : 0)
    shareRows.push(topLm.map((m) => (total > 0 ? lmPop[m] / total : 0)))
  }
  const last = h.snapshotCount - 1
  const everLm = new Uint8Array(M), endLm = new Uint8Array(M)
  let firstContinent = -1, firstLandmass = -1
  for (let id = 0; id < S; id++) {
    const st = h.settlements[id]
    const m = terrain.landmass[st.cell]
    everLm[m] = 1
    if (h.population[last * S + id] > 0) endLm[m] = 1
    if (!isCradle[m]) {
      if (firstLandmass < 0) firstLandmass = st.foundedYear
      if (firstContinent < 0 && isCont(m)) firstContinent = st.foundedYear
    }
  }
  let ie = 0, iv = 0
  for (let m = 0; m < M; m++) if (lmHab[m] > 0 && !isCradle[m] && !isCont(m)) { ie += endLm[m]; iv += everLm[m] }
  // Seaborne foundings from the journeys.
  const J = h.journeys
  let foundings = 0, seaFoundings = 0, seaFromPort = 0, seaAband = 0
  const eras: number[][] = [[], [], [], []]
  const senderPops: number[] = []
  for (let j = 0; j < J.count; j++) {
    if (J.kind[j] !== 0) continue
    foundings++
    let sea = 0
    for (let k = J.pathOffsets[j]; k < J.pathOffsets[j + 1]; k++) if (world.elevation[J.path[k]] < 0) sea++
    if (sea < 2) continue
    seaFoundings++
    const year = J.arriveYear[j], from = J.from[j]
    eras[Math.min(3, Math.floor(year / 500))].push(sea)
    if (h.structures.some((x) => x.type === StructureType.Port && x.settlement === from && x.builtYear <= year && (x.lostYear < 0 || x.lostYear > year))) seaFromPort++
    senderPops.push(h.population[Math.floor(year / h.snapshotInterval) * S + from])
    if (h.settlements[J.to[j]].abandonedYear >= 0) seaAband++
  }
  const median = (xs: number[]) => { if (xs.length === 0) return 0; const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)] }
  const v = diag?.voyages
  let voyLaunched = -1, voyFounded = -1, voyLost = -1, voyNothing = -1, voyPortShare = 0, voySenderPop = 0, voyOffCradle = 0, voyOtherLand = 0
  const voySize = [0, 0, 0]
  let voyCost = ''
  if (v) {
    voyLaunched = 0; voyFounded = 0; voyLost = 0; voyNothing = 0
    let port = 0, off = 0, other = 0
    const pops: number[] = []
    const costs: number[][] = [[], [], [], []]
    for (let k = 0; k < v.outcome.length; k++) {
      const o = v.outcome[k]
      if (o === 0) { voyNothing++; continue }
      voyLaunched++
      const fromLm = terrain.landmass[h.settlements[v.from[k]].cell]
      if (o === 1) {
        voyFounded++
        costs[Math.min(3, Math.floor(v.year[k] / 500))].push(v.cost[k])
        if (v.toLandmass[k] !== fromLm) other++
      } else voyLost++
      if (v.port[k]) port++
      if (!isCradle[fromLm]) off++
      const p = v.senderPop[k]
      voySize[p < 300 ? 0 : p < 3000 ? 1 : 2]++
      pops.push(p)
    }
    voyPortShare = voyLaunched > 0 ? port / voyLaunched : 0
    voySenderPop = median(pops)
    voyOffCradle = voyLaunched > 0 ? off / voyLaunched : 0
    voyOtherLand = voyFounded > 0 ? other / voyFounded : 0
    for (let i = 0; i < 3; i++) voySize[i] = voyLaunched > 0 ? voySize[i] / voyLaunched : 0
    voyCost = costs.map((c) => {
      if (c.length === 0) return '-'
      const a = [...c].sort((x, y) => x - y)
      return `${a[Math.floor(a.length / 2)].toFixed(0)}/${a[Math.floor(0.9 * (a.length - 1))].toFixed(0)}/${a[a.length - 1].toFixed(0)}`
    }).join(' ')
  }
  // Trade reach: route components at the end.
  const tr = h.trade
  const parentOf = new Int32Array(S).fill(-1)
  for (let id = 0; id < S; id++) parentOf[id] = id
  const findRoot = (x: number): number => { while (parentOf[x] !== x) { parentOf[x] = parentOf[parentOf[x]]; x = parentOf[x] } return x }
  const isOpenEnd = new Uint8Array(tr.count)
  for (const e of h.events) {
    if (e.type === EventType.TradeOpened) isOpenEnd[e.value] = 1
    else if (e.type === EventType.TradeClosed) isOpenEnd[e.value] = 0
  }
  const pairKey = new Set<number>()
  for (let r = 0; r < tr.count; r++) {
    pairKey.add(tr.a[r] * S + tr.b[r])
    if (isOpenEnd[r]) { const ra = findRoot(tr.a[r]), rb = findRoot(tr.b[r]); if (ra !== rb) parentOf[ra] = rb }
  }
  const cradleRoot = new Uint8Array(S)
  for (let id = 0; id < S; id++) if (h.population[last * S + id] > 0 && isCradle[terrain.landmass[h.settlements[id].cell]]) cradleRoot[findRoot(id)] = 1
  let offTraders = 0, offLinked = 0
  for (let id = 0; id < S; id++) {
    if (h.population[last * S + id] < 400 || isCradle[terrain.landmass[h.settlements[id].cell]]) continue
    offTraders++
    if (cradleRoot[findRoot(id)]) offLinked++
  }
  let motherRoutes = 0, motherPairs = 0
  for (let j = 0; j < J.count; j++) {
    if (J.kind[j] !== 0) continue
    const a = J.from[j], b = J.to[j]
    let sea = 0
    for (let k = J.pathOffsets[j]; k < J.pathOffsets[j + 1]; k++) if (world.elevation[J.path[k]] < 0) sea++
    if (sea < 2) continue
    let ra = false, rb = false
    for (let q = 0; q <= last; q++) { if (h.population[q * S + a] >= 400) ra = true; if (h.population[q * S + b] >= 400) rb = true }
    if (!ra || !rb) continue
    motherPairs++
    if (pairKey.has(Math.min(a, b) * S + Math.max(a, b))) motherRoutes++
  }
  const lmShares = topLm.map((m, i) => `${isCradle[m] ? 'c' : ''}${lmHab[m]}h:${shareRows.map((r) => (100 * r[i]).toFixed(0)).join('/')}`).join('  ')
  return {
    continents, islands, continentsSettled, claimAll, claimCradle, claimOther,
    islandsEnd: islands > 0 ? ie / islands : 0, islandsEver: islands > 0 ? iv / islands : 0, popOffCradle,
    firstContinent, firstLandmass, foundings, seaFoundings,
    eraCount: eras.map((e) => e.length), eraMedian: eras.map(median), eraMax: eras.map((e) => (e.length > 0 ? Math.max(...e) : 0)),
    seaFromPort, seaSenderPop: median(senderPops), seaAbandoned: seaFoundings > 0 ? seaAband / seaFoundings : 0,
    voyLaunched, voyFounded, voyLost, voyNothing, voyPortShare, voySenderPop, voySize, voyOffCradle, voyCost, voyOtherLand, lmShares,
    offTraders, offLinked: offTraders > 0 ? offLinked / offTraders : 0, motherRoutes, motherPairs,
  }
}

export function formatOverseasStats(rows: HistoryStats[]): string {
  const L: string[] = []
  const pc = (x: number) => (100 * x).toFixed(0)
  const yrs = SEA_YEARS.join('/')
  L.push(`overseas, per seed: other continents settled at ${yrs} of total; claim% of continent habitable land (all / cradle / others) at ${yrs}; islands settled end (ever); pop% off the cradle at ${yrs}`)
  for (const r of rows) {
    const o = r.sea
    L.push(
      `  seed ${pad(r.seed, 6)}: cont ${o.continentsSettled.join('/')} of ${o.continents}; claim all ${o.claimAll.map(pc).join('/')} cradle ${o.claimCradle.map(pc).join('/')} other ${o.claimOther.map(pc).join('/')}; ` +
        `islands ${pc(o.islandsEnd)}% (${pc(o.islandsEver)}%) of ${o.islands}; off-cradle pop ${o.popOffCradle.map(pc).join('/')}%; first other landmass ${o.firstLandmass}, continent ${o.firstContinent}`,
    )
    L.push(
      `      sea foundings ${o.seaFoundings} of ${o.foundings} (${o.foundings > 0 ? pc(o.seaFoundings / o.foundings) : 0}%), per era count ${o.eraCount.join('/')} median sea cells ${o.eraMedian.join('/')} max ${o.eraMax.join('/')}; from a port ${o.seaFromPort}, median sender pop ${o.seaSenderPop.toFixed(0)}, later abandoned ${pc(o.seaAbandoned)}%` +
        (o.voyLaunched >= 0 ? `; voyages launched ${o.voyLaunched} founded ${o.voyFounded} lost ${o.voyLost} (no landfall found ${o.voyNothing}), from ports ${pc(o.voyPortShare)}%, median sender pop ${o.voySenderPop.toFixed(0)}, ` +
          `senders <300/<3k/3k+ ${o.voySize.map(pc).join('/')}%, sent from off the cradle ${pc(o.voyOffCradle)}%, colonies on another landmass ${pc(o.voyOtherLand)}%, sea cost of colonising voyages per era median/p90/max ${o.voyCost}` : ''),
    )
    L.push(`      pop share % by landmass (habitable cells) at ${yrs}: ${o.lmShares}; traders off the cradle ${o.offTraders}, ${pc(o.offLinked)}% linked to the cradle by routes; colony-mother routes ${o.motherRoutes} of ${o.motherPairs} eligible`)
  }
  const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a.length > 0 ? a[Math.floor(a.length / 2)] : 0 }
  const withCont = rows.filter((r) => r.sea.continents > 0)
  const second = withCont.filter((r) => r.sea.continentsSettled[r.sea.continentsSettled.length - 1] > 0).length
  const firsts = withCont.map((r) => r.sea.firstContinent)
  const firstSorted = firsts.map((x) => (x < 0 ? 1e9 : x))
  L.push(
    `overseas summary: seeds with another continent ${withCont.length}/${rows.length}, of which a second continent settled by the end ${second}; ` +
      `first other continent per seed ${firsts.map((x) => (x < 0 ? '-' : x)).join(' ')} (median ${med(firstSorted) >= 1e9 ? 'never' : med(firstSorted)}); first other landmass median ${med(rows.map((r) => (r.sea.firstLandmass < 0 ? 1e9 : r.sea.firstLandmass)))}`,
  )
  const endClaim = rows.map((r) => r.sea.claimAll[r.sea.claimAll.length - 1])
  L.push(
    `  continent claim% at 2000 per seed: ${endClaim.map(pc).join(' ')} (median ${pc(med(endClaim))}, seeds >= 80%: ${endClaim.filter((x) => x >= 0.8).length}/${rows.length}); ` +
      `other-continent claim% at 1000 / 1500 / 2000 median ${pc(med(withCont.map((r) => r.sea.claimOther[3])))} / ${pc(med(withCont.map((r) => r.sea.claimOther[4])))} / ${pc(med(withCont.map((r) => r.sea.claimOther[5])))}; ` +
      `small islands settled at end median ${pc(med(rows.map((r) => r.sea.islandsEnd)))}% (ever ${pc(med(rows.map((r) => r.sea.islandsEver)))}%)`,
  )
  const tot = (f: (o: OverseasStats) => number) => rows.reduce((a, r) => a + f(r.sea), 0)
  L.push(
    `  seaborne foundings per seed median ${med(rows.map((r) => r.sea.seaFoundings))} (share of foundings ${pc(tot((o) => o.seaFoundings) / Math.max(1, tot((o) => o.foundings)))}%), per era (all seeds) ${[0, 1, 2, 3].map((e) => tot((o) => o.eraCount[e])).join('/')}, ` +
      `median sea cells per era (median over seeds) ${[0, 1, 2, 3].map((e) => med(rows.filter((r) => r.sea.eraCount[e] > 0).map((r) => r.sea.eraMedian[e]))).join('/')}, max ${[0, 1, 2, 3].map((e) => Math.max(0, ...rows.map((r) => r.sea.eraMax[e]))).join('/')}; ` +
      `from ports ${pc(tot((o) => o.seaFromPort) / Math.max(1, tot((o) => o.seaFoundings)))}%, later abandoned ${pc(med(rows.map((r) => r.sea.seaAbandoned)))}% (median)` +
      `; off-cradle traders linked to the cradle (median) ${pc(med(rows.filter((r) => r.sea.offTraders > 0).map((r) => r.sea.offLinked)))}%, colony-mother routes ${tot((o) => o.motherRoutes)} of ${tot((o) => o.motherPairs)} eligible pairs` +
      (rows[0]?.sea.voyLaunched >= 0 ? `; voyages per seed launched ${med(rows.map((r) => r.sea.voyLaunched))} founded ${med(rows.map((r) => r.sea.voyFounded))} lost ${med(rows.map((r) => r.sea.voyLost))} (${pc(tot((o) => o.voyLost) / Math.max(1, tot((o) => o.voyLaunched)))}% of launched) no landfall ${med(rows.map((r) => r.sea.voyNothing))}, ` +
        `from ports ${pc(med(rows.map((r) => r.sea.voyPortShare)))}%, senders <300/<3k/3k+ ${[0, 1, 2].map((i) => pc(med(rows.map((r) => r.sea.voySize[i])))).join('/')}% (medians), from off the cradle ${pc(med(rows.map((r) => r.sea.voyOffCradle)))}%, colonies on another landmass ${pc(med(rows.map((r) => r.sea.voyOtherLand)))}%` : ''),
  )
  return L.join('\n')
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

/** Open-route count per settlement after replaying trade events up to and including `year`. */
function openRoutesAt(h: History, year: number, out: Int32Array): void {
  out.fill(0)
  for (const e of h.events) {
    if (e.year > year) break
    if (e.type === EventType.TradeOpened) { out[e.settlement]++; out[e.other]++ }
    else if (e.type === EventType.TradeClosed) { out[e.settlement]--; out[e.other]-- }
  }
}

/** Ranks with ties averaged. */
function ranks(xs: number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b] || a - b)
  const r = new Array<number>(xs.length)
  for (let i = 0; i < idx.length; ) {
    let j = i
    while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++
    for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2
    i = j + 1
  }
  return r
}

export function spearman(xs: number[], ys: number[]): number {
  if (xs.length < 3) return 0
  const a = ranks(xs), b = ranks(ys)
  const n = a.length
  let ma = 0, mb = 0
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n
  let sab = 0, saa = 0, sbb = 0
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2 }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0
}

export function historyStats(world: World, h: History, terrain: Terrain, ms: number, worldMs: number, diag?: HistoryDiagnostics): HistoryStats {
  const S = h.settlements.length
  const N = world.grid.cellCount
  const tr = h.trade
  const R = tr ? tr.count : 0
  // Route geometry: sea cells per route and path length.
  const routeSea = new Uint8Array(R)
  const routeLenA = new Int32Array(R)
  for (let r = 0; r < R; r++) {
    let sea = 0
    for (let k = tr.pathOffsets[r]; k < tr.pathOffsets[r + 1]; k++) if (world.elevation[tr.path[k]] < 0) sea++
    routeSea[r] = sea >= 2 ? 1 : 0
    routeLenA[r] = tr.pathOffsets[r + 1] - tr.pathOffsets[r]
  }
  const openNow = new Int32Array(S)
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
      if (p <= 0 || h.settlements[id].outpost) continue // (expedition bases are counted apart: exploreStats)
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
    // Trade at this year.
    let routes = 0, volume = 0, seaVol = 0, lenSum = 0
    const goodShare = new Array<number>(GOOD_COUNT).fill(0)
    if (tr && h.tradeSnapshotCount > 0) {
      const tq = Math.min(h.tradeSnapshotCount - 1, Math.round(year / h.tradeInterval))
      const isOpen = new Uint8Array(R)
      for (const e of h.events) {
        if (e.year > year) break
        if (e.type === EventType.TradeOpened) isOpen[e.value] = 1
        else if (e.type === EventType.TradeClosed) isOpen[e.value] = 0
      }
      for (let r = 0; r < R; r++) {
        if (isOpen[r]) { routes++; lenSum += routeLenA[r] }
        const v = h.tradeVolume[tq * R + r]
        volume += v
        if (routeSea[r]) seaVol += v
      }
      if (diag) {
        let gt = 0
        for (let g = 0; g < GOOD_COUNT; g++) gt += diag.goodVolume[tq * GOOD_COUNT + g]
        for (let g = 0; g < GOOD_COUNT; g++) goodShare[g] = gt > 0 ? diag.goodVolume[tq * GOOD_COUNT + g] / gt : 0
      }
    }
    let roadCells = 0
    if (h.road) for (let i = 0; i < N; i++) if (h.road[lq * N + i] >= ROAD_STAT) roadCells++
    const fdeg: number[] = []
    for (let i = 0; i < N; i++) if (h.landUse[lq * N + i] >= FARMED) fdeg.push(h.degradation[lq * N + i] / 255)
    fdeg.sort((a, b) => a - b)
    let fsum = 0, f30 = 0
    for (const d of fdeg) { fsum += d; if (d >= 0.3) f30++ }
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
      routes, volume, seaShare: volume > 0 ? seaVol / volume : 0, routeLen: routes > 0 ? lenSum / routes : 0, goodShare, roadCells,
      farmed: fdeg.length, farmDegMean: fdeg.length > 0 ? fsum / fdeg.length : 0, farmDegP90: fdeg.length > 0 ? fdeg[Math.floor(0.9 * (fdeg.length - 1))] : 0,
      farmDeg30: fdeg.length > 0 ? f30 / fdeg.length : 0,
    })
  }
  const events = new Array<number>(EVENT_TYPES).fill(0)
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
  const isCradle = cradleLandmasses(h, terrain)
  let firstOverseas = -1
  for (let id = 0; id < S; id++) {
    const m = terrain.landmass[h.settlements[id].cell]
    if (!isCradle[m] && terrain.landmassSize[m] >= LANDMASS_MIN_FRACTION * N) { firstOverseas = h.settlements[id].foundedYear; break }
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
  const RG = 288
  const regPop = new Float64Array(RG * h.snapshotCount)
  for (let q = 0; q < h.snapshotCount; q++) for (let id = 0; id < S; id++) regPop[q * RG + sec[id]] += h.population[q * S + id]
  let worldPeak = 0
  for (let q = 0; q < h.snapshotCount; q++) worldPeak = Math.max(worldPeak, snapshotTotal(h, q))
  let regions = 0, regionsDeclined = 0, regionsRecovered = 0
  const q300 = Math.ceil(300 / h.snapshotInterval)
  for (let r = 0; r < RG; r++) {
    const sm = smooth((q) => regPop[q * RG + r])
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

  // Famine and trade: per decade from year 500, settlements >= 300 at the decade start, by whether they had an open route then.
  let famC = 0, famU = 0, expC = 0, expU = 0
  {
    const open = new Int32Array(S)
    const famineAt = new Int32Array(S).fill(-1)
    let ei = 0
    const evs = h.events
    for (let y0 = 0; y0 + 10 <= h.years; y0 += 10) {
      while (ei < evs.length && evs[ei].year < y0) {
        const e = evs[ei++]
        if (e.type === EventType.TradeOpened) { open[e.settlement]++; open[e.other]++ }
        else if (e.type === EventType.TradeClosed) { open[e.settlement]--; open[e.other]-- }
      }
      if (y0 < 500) continue
      const q = Math.floor(y0 / h.snapshotInterval)
      const conn = new Int8Array(S).fill(-1)
      for (let id = 0; id < S; id++) {
        if (h.population[q * S + id] < 300) continue
        conn[id] = open[id] > 0 ? 1 : 0
        if (conn[id]) expC++
        else expU++
      }
      for (let k = ei; k < evs.length && evs[k].year < y0 + 10; k++) {
        const e = evs[k]
        if (e.type !== EventType.Famine || famineAt[e.settlement] === y0) continue
        famineAt[e.settlement] = y0
        if (conn[e.settlement] === 1) famC++
        else if (conn[e.settlement] === 0) famU++
      }
    }
  }
  // Pop vs routes / through-volume at the end.
  openRoutesAt(h, h.years, openNow)
  const xs: number[] = [], yr: number[] = [], yt: number[] = []
  for (let id = 0; id < S; id++) {
    const p = h.population[last * S + id]
    if (p < 300) continue
    xs.push(p)
    yr.push(openNow[id])
    yt.push(diag ? diag.through[id] : 0)
  }
  // Top-5 sites.
  const top5Sites = [0, 0, 0, 0, 0]
  {
    const { neighborOffsets: off, neighbors: nb } = world.grid
    const ids: number[] = []
    for (let id = 0; id < S; id++) if (h.population[last * S + id] > 0) ids.push(id)
    ids.sort((a, b) => h.population[last * S + b] - h.population[last * S + a] || a - b)
    for (const id of ids.slice(0, 5)) {
      const c = h.settlements[id].cell
      let seaAdj = false, riverNear = world.flow[c] >= RIVER_FLOW_THRESHOLD
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (world.elevation[j] < 0 && world.biome[j] !== Biome.Ice) seaAdj = true
        else if (world.flow[j] >= RIVER_FLOW_THRESHOLD) riverNear = true
      }
      const port = h.structures.some((x) => x.type === StructureType.Port && x.settlement === id && x.lostYear < 0)
      top5Sites[seaAdj && riverNear ? 0 : seaAdj && port ? 1 : seaAdj ? 2 : riverNear ? 3 : 4]++
    }
  }
  // Road components at the end.
  let roadComponents = 0, roadLargest = 0, roadInBig = 0
  if (h.road) {
    const lq = h.landSnapshotCount - 1
    const comp = new Int32Array(N).fill(-1)
    const stack: number[] = []
    let total = 0, largest = 0, inBig = 0
    const { neighborOffsets: off, neighbors: nb } = world.grid
    for (let i = 0; i < N; i++) {
      if (h.road[lq * N + i] < ROAD_STAT || comp[i] >= 0) continue
      let size = 0
      comp[i] = roadComponents
      stack.push(i)
      while (stack.length > 0) {
        const c = stack.pop() as number
        size++
        for (let k = off[c]; k < off[c + 1]; k++) {
          const j = nb[k]
          if (comp[j] < 0 && h.road[lq * N + j] >= ROAD_STAT) { comp[j] = roadComponents; stack.push(j) }
        }
      }
      roadComponents++
      total += size
      if (size > largest) largest = size
      if (size >= 10) inBig += size
    }
    roadLargest = total > 0 ? largest / total : 0
    roadInBig = total > 0 ? inBig / total : 0
  }
  let wealthTop10 = 0
  if (h.wealth) {
    const ws: number[] = []
    for (let id = 0; id < S; id++) if (h.wealth[last * S + id] > 0) ws.push(h.wealth[last * S + id])
    ws.sort((a, b) => b - a)
    let t = 0, t10 = 0
    for (let i = 0; i < ws.length; i++) { t += ws[i]; if (i < 10) t10 += ws[i] }
    wealthTop10 = t > 0 ? t10 / t : 0
  }

  return {
    routesEver: R,
    tradeBytes: (h.tradeVolume ? h.tradeVolume.byteLength : 0) + (h.wealth ? h.wealth.byteLength : 0) + (h.road ? h.road.byteLength : 0),
    famineConnected: expC > 0 ? (100 * famC) / expC : 0,
    famineUnconnected: expU > 0 ? (100 * famU) / expU : 0,
    rhoRoutes: spearman(xs, yr), rhoThrough: spearman(xs, yt), top5Sites, roadComponents, roadLargest, roadInBig, wealthTop10,
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
    sea: overseasStats(world, h, terrain, diag),
    peoples: peopleStats(world, h, terrain, diag),
    tech: techStats(h),
    explore: exploreStats(world, h, terrain, diag),
  }
}

/** Contact networks (component label per people, the smallest member) as of `year`. */
export function networksAt(h: History, year: number): Int32Array {
  const P = h.peoples.length
  const lab = new Int32Array(P)
  for (let p = 0; p < P; p++) lab[p] = p
  const find = (x: number): number => { while (lab[x] !== x) x = lab[x]; return x }
  for (let a = 0; a < P; a++) {
    for (let b = a + 1; b < P; b++) {
      const y = h.contactYear[a * P + b]
      if (y < 0 || y > year) continue
      const ra = find(a), rb = find(b)
      if (ra !== rb) { if (ra < rb) lab[rb] = ra; else lab[ra] = rb }
    }
  }
  for (let p = 0; p < P; p++) lab[p] = find(p)
  return lab
}

export function peopleStats(world: World, h: History, terrain: Terrain, diag?: HistoryDiagnostics): PeopleStats {
  const P = h.peoples.length
  const N = world.grid.cellCount
  const S = h.settlements.length
  const cradleOf = diag?.cradles?.cradle ?? h.peoples.map((_, i) => i)
  const K = cradleOf.length > 0 ? Math.max(...cradleOf) + 1 : 0
  const tribesPerCradle = new Array<number>(K).fill(0)
  for (const k of cradleOf) tribesPerCradle[k]++
  const lms = new Set<number>()
  for (const p of h.peoples) lms.add(terrain.landmass[h.settlements[p.founder].cell])
  const networks: number[] = []
  const knownByNet: string[] = []
  const unknownLand: number[] = [], unknownSea: number[] = []
  let land = 0, sea = 0
  for (let i = 0; i < N; i++) { if (world.elevation[i] < 0) sea++; else land++ }
  for (const year of KNOW_YEARS) {
    if (year > h.years) continue
    const lab = networksAt(h, year)
    const roots: number[] = []
    for (let p = 0; p < P; p++) if (lab[p] === p) roots.push(p)
    networks.push(roots.length)
    const count = new Array<number>(roots.length).fill(0)
    let ul = 0, us = 0
    for (let i = 0; i < N; i++) {
      let any = false
      const isLand = world.elevation[i] >= 0
      for (let r = 0; r < roots.length; r++) {
        let k = false
        for (let p = 0; p < P && !k; p++) if (lab[p] === roots[r]) { const y = h.knownYear[p * N + i]; if (y >= 0 && y <= year) k = true }
        if (k) { any = true; if (isLand) count[r]++ }
      }
      if (!any) { if (isLand) ul++; else us++ }
    }
    knownByNet.push(count.sort((a, b) => b - a).map((c) => ((100 * c) / land).toFixed(0)).join('/'))
    unknownLand.push(ul / land)
    unknownSea.push(us / sea)
  }
  // First contacts within and between cradles.
  const inner: number[] = []
  let innerNever = 0, innerPairs = 0
  const viaInner = [0, 0, 0, 0, 0], viaCross = [0, 0, 0, 0, 0]
  const via = diag?.contactVia
  const cc = new Array<number>(K * K).fill(-1)
  for (let a = 0; a < P; a++) {
    for (let b = a + 1; b < P; b++) {
      const y = h.contactYear[a * P + b]
      const ka = cradleOf[a], kb = cradleOf[b]
      const how = via ? via[a * P + b] : -1
      if (how >= 0) (ka === kb ? viaInner : viaCross)[how]++
      if (ka === kb) { innerPairs++; if (y < 0) innerNever++; else inner.push(y) }
      else if (y >= 0) {
        const i = Math.min(ka, kb) * K + Math.max(ka, kb)
        if (cc[i] < 0 || y < cc[i]) cc[i] = y
      }
    }
  }
  inner.sort((x, y) => x - y)
  const cradleContacts: string[] = []
  let allMetYear = 0
  for (let i = 0; i < K; i++) {
    for (let j = i + 1; j < K; j++) {
      const y = cc[i * K + j]
      cradleContacts.push(`${i}-${j}:${y < 0 ? 'never' : y}`)
      if (y < 0) allMetYear = -1
      else if (allMetYear >= 0 && y > allMetYear) allMetYear = y
    }
  }
  // Extinct cradles: no living settlement of any of their peoples at some snapshot.
  let cradlesExtinct = 0, firstExtinct = -1
  for (let k = 0; k < K; k++) {
    for (let q = 0; q < h.snapshotCount; q++) {
      let alive = false
      for (let id = 0; id < S && !alive; id++) if (h.population[q * S + id] > 0 && cradleOf[h.settlements[id].people] === k) alive = true
      if (!alive) {
        cradlesExtinct++
        const y = q * h.snapshotInterval
        if (firstExtinct < 0 || y < firstExtinct) firstExtinct = y
        break
      }
    }
  }
  let firstContacts = 0, voyagesLost = 0, landfalls = 0
  for (const e of h.events) {
    if (e.type === EventType.FirstContact) firstContacts++
    else if (e.type === EventType.VoyageLost) voyagesLost++
    else if (e.type === EventType.Landfall) landfalls++
  }
  // Chains: people A knows the cell of a settlement of people C before A and C met (or never met),
  // and at that time A had met some B that had met C.
  let chains = 0
  const chainExamples: string[] = []
  for (let a = 0; a < P; a++) {
    for (let c = 0; c < P; c++) {
      if (a === c) continue
      const met = h.contactYear[a * P + c]
      let first = -1, firstId = -1
      for (let id = 0; id < S; id++) {
        const st = h.settlements[id]
        if (st.people !== c) continue
        const y = h.knownYear[a * N + st.cell]
        if (y < 0) continue
        const when = Math.max(y, st.foundedYear) // A knows the place once both are true
        if (st.abandonedYear >= 0 && when >= st.abandonedYear) continue
        if (met >= 0 && when >= met) continue
        if (first < 0 || when < first) { first = when; firstId = id }
      }
      if (first < 0) continue
      let via = -1
      for (let b = 0; b < P && via < 0; b++) {
        if (b === a || b === c) continue
        const ab = h.contactYear[a * P + b], bc = h.contactYear[b * P + c]
        if (ab >= 0 && ab <= first && bc >= 0 && bc <= first) via = b
      }
      if (via < 0) continue
      chains++
      if (chainExamples.length < 4) {
        chainExamples.push(`${h.peoples[a].name}(${a}) knew ${h.settlements[firstId].name} of the ${h.peoples[c].name}(${c}) in ${first} through the ${h.peoples[via].name}(${via}); met them ${met < 0 ? 'never' : met}`)
      }
    }
  }
  return {
    peoples: P, cradles: K, cradleLandmasses: lms.size, tribesPerCradle, networks,
    innerMedian: inner.length > 0 ? inner[inner.length >> 1] : -1, innerMax: inner.length > 0 ? inner[inner.length - 1] : -1, innerNever, innerPairs,
    cradleContacts, allMetYear, knownByNet, unknownLand, unknownSea, cradlesExtinct, firstExtinct,
    firstContacts, voyagesLost, landfalls, diag: diag?.knowledge, chains, chainExamples, viaInner, viaCross,
  }
}

export function formatPeopleStats(rows: HistoryStats[]): string {
  const L: string[] = []
  const pc = (x: number) => (100 * x).toFixed(0)
  const yrs = KNOW_YEARS.join('/')
  L.push(`peoples and contact, per seed: peoples, cradles (landmasses) [tribes per cradle]; contact networks at ${yrs}; in-cradle first contact median/max (never of pairs); cradle-pair first contacts; land % known per network at ${yrs}; land / sea % known to nobody at ${yrs}`)
  for (const r of rows) {
    const o = r.peoples
    L.push(
      `  seed ${pad(r.seed, 6)}: ${o.peoples} peoples, ${o.cradles} cradles (${o.cradleLandmasses} landmasses) [${o.tribesPerCradle.join(',')}]; networks ${o.networks.join('/')}; in-cradle ${o.innerMedian}/${o.innerMax} (${o.innerNever} of ${o.innerPairs} never); ` +
        `cradles ${o.cradleContacts.join(' ')}; events FirstContact ${o.firstContacts} VoyageLost ${o.voyagesLost} Landfall ${o.landfalls}${o.cradlesExtinct > 0 ? `; cradles extinct ${o.cradlesExtinct} (first ${o.firstExtinct})` : ''}`,
    )
    L.push(`      known land % per network ${o.knownByNet.join(' | ')}; unknown land ${o.unknownLand.map(pc).join('/')}% sea ${o.unknownSea.map(pc).join('/')}%; met by sight/journey/voyage/trade/expedition within cradles ${o.viaInner.join('/')}, between ${o.viaCross.join('/')}`)
    const d = o.diag
    if (d) {
      L.push(
        `      knowledge changed: migrations ${d.migRedirected + d.migBlocked} of ${d.migrations} (${pc((d.migRedirected + d.migBlocked) / Math.max(1, d.migrations))}%: redirected ${d.migRedirected}, blocked ${d.migBlocked}; reach cut short by the known world ${pc(d.migFrontier / Math.max(1, d.migrations))}%); ` +
          `trade partners lost ${d.tradeLost} of ${d.tradePartners} (${pc(d.tradeLost / Math.max(1, d.tradePartners))}%) over ${d.tradeSearches} searches; voyages whose known-land target differs from the old landmass rule ${d.voyTargetDiffers} of ${d.voyages} (${pc(d.voyTargetDiffers / Math.max(1, d.voyages))}%), voyage searches sighting strangers ${d.voySightings}`,
      )
    }
    L.push(`      chains ${o.chains}${o.chainExamples.length > 0 ? ': ' + o.chainExamples.join('; ') : ''}`)
  }
  const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a.length > 0 ? a[Math.floor(a.length / 2)] : 0 }
  const ny = KNOW_YEARS.filter((y) => rows.every((r) => y <= (r.byYear[r.byYear.length - 1]?.year ?? 0)))
  L.push(`peoples summary: peoples per seed ${rows.map((r) => r.peoples.peoples).join(' ')}; cradles ${rows.map((r) => r.peoples.cradles).join(' ')}; seeds with cradles on >= 2 landmasses ${rows.filter((r) => r.peoples.cradleLandmasses >= 2).length}/${rows.length}`)
  L.push(`  networks at ${ny.join('/')} (median [min..max]): ${ny.map((_, i) => { const xs = rows.map((r) => r.peoples.networks[i]); return `${med(xs)} [${Math.min(...xs)}..${Math.max(...xs)}]` }).join('  ')}; seeds with >= 2 networks at ${ny.join('/')}: ${ny.map((_, i) => rows.filter((r) => r.peoples.networks[i] >= 2).length).join('/')}; with <= 2 at the end ${rows.filter((r) => r.peoples.networks[r.peoples.networks.length - 1] <= 2).length}/${rows.length}`)
  const allPairs = rows.flatMap((r) => r.peoples.cradleContacts.map((x) => x.split(':')[1]))
  const met = allPairs.filter((x) => x !== 'never').map(Number).sort((a, b) => a - b)
  L.push(`  cradle-pair first contacts: ${met.length} of ${allPairs.length} pairs met; years median ${med(met)}, quartiles ${met[Math.floor(met.length / 4)] ?? '-'}..${met[Math.floor((3 * met.length) / 4)] ?? '-'}; pairs met before 600 ${met.filter((y) => y < 600).length}, 600-1600 ${met.filter((y) => y >= 600 && y <= 1600).length}, after 1600 ${met.filter((y) => y > 1600).length}, never ${allPairs.length - met.length}; seeds where every cradle met every other: ${rows.filter((r) => r.peoples.allMetYear >= 0).length}/${rows.length}`)
  const sumV = (f: (o: PeopleStats) => number[]) => [0, 1, 2, 3, 4].map((i) => rows.reduce((a, r) => a + f(r.peoples)[i], 0)).join('/')
  L.push(`  pairs met by sight/journey/voyage/trade/expedition (all seeds): within cradles ${sumV((o) => o.viaInner)}, between cradles ${sumV((o) => o.viaCross)}`)
  L.push(`  in-cradle first contact median per seed ${rows.map((r) => r.peoples.innerMedian).join(' ')}; max ${rows.map((r) => r.peoples.innerMax).join(' ')}; in-cradle pairs never met ${rows.reduce((a, r) => a + r.peoples.innerNever, 0)} of ${rows.reduce((a, r) => a + r.peoples.innerPairs, 0)}`)
  L.push(`  land known to nobody at ${ny.join('/')} (median %): ${ny.map((_, i) => pc(med(rows.map((r) => r.peoples.unknownLand[i])))).join('/')}; sea ${ny.map((_, i) => pc(med(rows.map((r) => r.peoples.unknownSea[i])))).join('/')}; cradles extinct ${rows.reduce((a, r) => a + r.peoples.cradlesExtinct, 0)} in ${rows.filter((r) => r.peoples.cradlesExtinct > 0).length} seeds`)
  const ds = rows.map((r) => r.peoples.diag).filter((d) => d !== undefined) as KnowledgeDiag[]
  if (ds.length > 0) {
    const sum = (f: (d: KnowledgeDiag) => number) => ds.reduce((a, d) => a + f(d), 0)
    L.push(
      `  knowledge changed decisions (all seeds): migrations ${pc((sum((d) => d.migRedirected) + sum((d) => d.migBlocked)) / sum((d) => d.migrations))}% (redirected ${pc(sum((d) => d.migRedirected) / sum((d) => d.migrations))}%, blocked ${pc(sum((d) => d.migBlocked) / sum((d) => d.migrations))}%; searches whose reach the known world cut short ${pc(sum((d) => d.migFrontier) / sum((d) => d.migrations))}%), ` +
        `trade partners ${pc(sum((d) => d.tradeLost) / sum((d) => d.tradePartners))}% of full-knowledge partners not chosen, voyage known-land targets ${pc(sum((d) => d.voyTargetDiffers) / sum((d) => d.voyages))}% differ from the old landmass rule; chains per seed ${rows.map((r) => r.peoples.chains).join(' ')}`,
    )
  }
  return L.join('\n')
}

/** Equirectangular ASCII map of which contact network knows each cell at `year`: a, b, ... known land, 1, 2, ... known sea, '*' / '+' known to several, '.' unknown land, blank unknown sea; settlements as their network's capital letter. */
export function asciiKnowledgeMap(world: World, h: History, year: number, W = 120, H = 40): string {
  const N = world.grid.cellCount
  const P = world.grid.positions
  const lab = networksAt(h, year)
  const roots: number[] = []
  for (let p = 0; p < h.peoples.length; p++) if (lab[p] === p) roots.push(p)
  const netIndex = new Int32Array(h.peoples.length)
  for (let p = 0; p < h.peoples.length; p++) netIndex[p] = roots.indexOf(lab[p])
  const grid: string[] = new Array(W * H).fill(' ')
  const rank = new Float64Array(W * H).fill(-1)
  const at = (i: number): number => {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]
    const lon = Math.atan2(z, x), lat = Math.asin(Math.max(-1, Math.min(1, y)))
    const col = Math.min(W - 1, Math.floor(((lon / Math.PI + 1) / 2) * W))
    const row = Math.min(H - 1, Math.floor((1 - (lat / (Math.PI / 2) + 1) / 2) * H))
    return row * W + col
  }
  const put = (q: number, ch: string, r: number) => { if (r > rank[q]) { rank[q] = r; grid[q] = ch } }
  const letters = 'abcdefghijklmnop'
  for (let i = 0; i < N; i++) {
    let net = -1, several = false
    for (let p = 0; p < h.peoples.length; p++) {
      const y = h.knownYear[p * N + i]
      if (y < 0 || y > year) continue
      if (net < 0) net = netIndex[p]
      else if (net !== netIndex[p]) several = true
    }
    const isLand = world.elevation[i] >= 0
    if (isLand) put(at(i), net < 0 ? '.' : several ? '*' : letters[net], net < 0 ? 1 : 2)
    else put(at(i), net < 0 ? ' ' : several ? '+' : String(net + 1), net < 0 ? 0 : 0.5)
  }
  const S = h.settlements.length
  const snap = Math.floor(year / h.snapshotInterval)
  for (let id = 0; id < S; id++) {
    if (h.population[snap * S + id] <= 0) continue
    put(at(h.settlements[id].cell), letters[netIndex[h.settlements[id].people]].toUpperCase(), 10 + h.population[snap * S + id])
  }
  const names = roots.map((r, k) => `${letters[k]}: ${h.peoples.filter((_, p) => lab[p] === r).map((x) => x.name).join('+')}`).join('  ')
  const lines: string[] = [`year ${year} knowledge by contact network (land a.., sea 1.., several * +, unknown land '.', settlements capitals): ${names}`]
  for (let row = 0; row < H; row++) lines.push(grid.slice(row * W, row * W + W).join(''))
  return lines.join('\n')
}

const pad = (s: string | number, n: number) => String(s).padStart(n)
const fmtPop = (p: number) => (p >= 1e6 ? (p / 1e6).toFixed(2) + 'M' : p >= 1e4 ? (p / 1e3).toFixed(0) + 'k' : p >= 1e3 ? (p / 1e3).toFixed(1) + 'k' : p.toFixed(0))

export function formatHistoryStats(rows: HistoryStats[]): string {
  const L: string[] = []
  L.push('per seed, per year: living settlements / total pop / largest / top-10 share / settled% of habitable cells / claimed% (in a catchment) / fill% (pop vs productivity * capacity)')
  for (const r of rows) {
    L.push(
      `seed ${r.seed}: ${r.ms.toFixed(0)} ms (world ${r.worldMs.toFixed(0)} ms), ${r.settlementsEver} settlements ever, ` +
        `events F/A/Fam/Mig/Built/Town/City/Lost/TradeOpened/TradeClosed ${r.events.join('/')}, landmasses settled ever/end/habitable ${r.landmassesEver}/${r.landmassesEnd}/${r.landmassesHabitable} (continents ${r.bigSettled}/${r.bigTotal}), ` +
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
    L.push(
      `   trade: routes ever ${r.routesEver}, famines per 100 settlement-decades (>=300, after 500) with route ${r.famineConnected.toFixed(1)} / without ${r.famineUnconnected.toFixed(1)}, ` +
        `spearman(pop, routes) ${r.rhoRoutes.toFixed(2)}, (pop, through-volume) ${r.rhoThrough.toFixed(2)}, top5 sites mouth/port/coast/river/inland ${r.top5Sites.join('/')}, ` +
        `road components ${r.roadComponents} (largest ${(100 * r.roadLargest).toFixed(0)}%, in >=10-cell ${(100 * r.roadInBig).toFixed(0)}%), wealth top10 ${(100 * r.wealthTop10).toFixed(0)}%, trade+wealth+road ${(r.tradeBytes / 1048576).toFixed(2)} MB`,
    )
    L.push('   year  living    total  largest   median  top10  settl%  claim%  fill%   use%   deg%  towns cities ports dams | routes  volume sea%  len | farmed fdeg% p90% >=30% | roads  goods G/F/L/T/O/S %')
    for (const y of r.byYear) {
      L.push(
        `  ${pad(y.year, 5)} ${pad(y.living, 7)} ${pad(fmtPop(y.total), 8)} ${pad(fmtPop(y.largest), 8)} ${pad(fmtPop(y.median), 8)} ${pad((100 * y.top10).toFixed(0) + '%', 6)} ${pad((100 * y.settledFrac).toFixed(1), 7)} ${pad((100 * y.claimedFrac).toFixed(1), 7)} ${pad((100 * y.fill).toFixed(0), 6)} ${pad((100 * y.landUse).toFixed(1), 6)} ${pad((100 * y.degradation).toFixed(1), 6)} ${pad(y.towns, 6)} ${pad(y.cities, 6)} ${pad(y.ports, 5)} ${pad(y.dams, 4)}` +
          ` | ${pad(y.routes, 6)} ${pad(fmtPop(y.volume), 7)} ${pad((100 * y.seaShare).toFixed(0), 4)} ${pad(y.routeLen.toFixed(1), 4)} | ${pad(y.farmed, 6)} ${pad((100 * y.farmDegMean).toFixed(1), 5)} ${pad((100 * y.farmDegP90).toFixed(0), 4)} ${pad((100 * y.farmDeg30).toFixed(0), 5)} | ${pad(y.roadCells, 5)}  ${y.goodShare.map((x) => (100 * x).toFixed(0)).join('/')}`,
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
  L.push('   year         routes             volume       sea%        len      farmed deg%      p90 deg%      >=30% deg      road cells')
  for (let yi = 0; yi < STAT_YEARS.length; yi++) {
    const ys = rows.map((r) => r.byYear[yi]).filter((y) => y !== undefined)
    if (ys.length === 0) continue
    const f1 = (x: number) => x.toFixed(1)
    const f0 = (x: number) => x.toFixed(0)
    L.push(
      `  ${pad(STAT_YEARS[yi], 5)}  ${pad(range(ys.map((y) => y.routes), f0), 14)}  ${pad(range(ys.map((y) => y.volume), fmtPop), 18)}  ${pad(range(ys.map((y) => 100 * y.seaShare), f0), 12)}  ${pad(range(ys.map((y) => y.routeLen), f1), 16)}  ${pad(range(ys.map((y) => 100 * y.farmDegMean), f1), 16)}  ${pad(range(ys.map((y) => 100 * y.farmDegP90), f0), 12)}  ${pad(range(ys.map((y) => 100 * y.farmDeg30), f0), 12)}  ${pad(range(ys.map((y) => y.roadCells), f0), 14)}`,
    )
  }
  const goodNames = Object.keys(Good)
  L.push('   year   share of trade volume by good, mean % across seeds')
  for (let yi = 0; yi < STAT_YEARS.length; yi++) {
    const ys = rows.map((r) => r.byYear[yi]).filter((y) => y !== undefined && y.volume > 0)
    if (ys.length === 0) continue
    const sh = goodNames.map((_, g) => ys.reduce((a, y) => a + y.goodShare[g], 0) / ys.length)
    const maxShare = Math.max(...ys.map((y) => Math.max(...y.goodShare)))
    L.push(`  ${pad(STAT_YEARS[yi], 5)}   ${goodNames.map((n, g) => `${n} ${(100 * sh[g]).toFixed(0)}`).join(', ')}   (largest single-good share in any seed ${(100 * maxShare).toFixed(0)}%)`)
  }
  const f0 = (x: number) => x.toFixed(0)
  const f2 = (x: number) => x.toFixed(2)
  const sites = [0, 0, 0, 0, 0]
  for (const r of rows) for (let k = 0; k < 5; k++) sites[k] += r.top5Sites[k]
  L.push(
    `trade per seed (median [min..max]): routes ever ${range(rows.map((r) => r.routesEver), f0)}; famines per 100 settlement-decades with a route ${range(rows.map((r) => r.famineConnected), (x) => x.toFixed(1))} vs without ${range(rows.map((r) => r.famineUnconnected), (x) => x.toFixed(1))}; ` +
      `spearman(pop, routes) ${range(rows.map((r) => r.rhoRoutes), f2)}, (pop, through-volume) ${range(rows.map((r) => r.rhoThrough), f2)}; ` +
      `road components ${range(rows.map((r) => r.roadComponents), f0)}, largest share ${range(rows.map((r) => 100 * r.roadLargest), f0)}%, in >=10-cell components ${range(rows.map((r) => 100 * r.roadInBig), f0)}%; wealth top-10 share ${range(rows.map((r) => 100 * r.wealthTop10), f0)}%; ` +
      `trade+wealth+road matrices max ${(Math.max(...rows.map((r) => r.tradeBytes)) / 1048576).toFixed(2)} MB`,
  )
  L.push(`top-5 settlements at the end, all seeds: river mouth ${sites[0]}, port ${sites[1]}, coast (no port) ${sites[2]}, inland river ${sites[3]}, inland ${sites[4]}`)
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
  L.push(`seeds with a settlement >= 30k at end: ${rows.filter((r) => (r.top3[0] ?? 0) >= 30000).length}/${rows.length}, >= 20k: ${rows.filter((r) => (r.top3[0] ?? 0) >= 20000).length}/${rows.length}, > 80k: ${rows.filter((r) => (r.top3[0] ?? 0) > 80000).length}/${rows.length}, with >= 2 cities: ${rows.filter((r) => (r.top3[1] ?? 0) >= CITY_POPULATION).length}/${rows.length}; end settlements >= 30k per seed: ${rows.map((r) => r.sizeBins[3]).join(' ')}`)
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
  const evNames = Object.keys(EventType) as (keyof typeof EventType)[]
  L.push(`events per seed (mean): ${evNames.map((n) => `${n} ${(rows.reduce((a, r) => a + (r.events[EventType[n]] ?? 0), 0) / rows.length).toFixed(1)}`).join(', ')}`)
  L.push('')
  L.push(formatOverseasStats(rows))
  L.push('')
  L.push(formatPeopleStats(rows))
  L.push('')
  L.push(formatTechStats(rows))
  L.push('')
  L.push(formatExploreStats(rows))
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

/** Equirectangular ASCII map of roads and trade routes at `year`. */
export function asciiTradeMap(world: World, h: History, year: number, W = 120, H = 40): string {
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
  const put = (p: number, ch: string, r: number) => { if (r > rank[p]) { rank[p] = r; grid[p] = ch } }
  const lq = Math.min(h.landSnapshotCount - 1, Math.round(year / h.landInterval))
  for (let i = 0; i < N; i++) {
    const e = world.elevation[i], b = world.biome[i]
    if (e < 0) put(at(i), ' ', 0)
    else if (b === Biome.Ice) put(at(i), '#', 1)
    else if (b === Biome.Mountain) put(at(i), '^', 1.2)
    else put(at(i), '.', 1)
    const rd = h.road ? h.road[lq * N + i] : 0
    if (rd >= ROAD_STAT) put(at(i), rd >= 150 ? 'H' : rd >= 80 ? '=' : '-', 3 + rd / 255)
  }
  const tr = h.trade
  if (tr && h.tradeSnapshotCount > 0) {
    const tq = Math.min(h.tradeSnapshotCount - 1, Math.round(year / h.tradeInterval))
    for (let r = 0; r < tr.count; r++) {
      if (h.tradeVolume[tq * tr.count + r] <= 0) continue
      for (let k = tr.pathOffsets[r]; k < tr.pathOffsets[r + 1]; k++) {
        const c = tr.path[k]
        if (world.elevation[c] < 0) put(at(c), '~', 2)
      }
    }
  }
  const S = h.settlements.length
  const snap = Math.floor(year / h.snapshotInterval)
  for (let id = 0; id < S; id++) {
    const pop = h.population[snap * S + id]
    if (pop < 300) continue
    put(at(h.settlements[id].cell), pop >= 30000 ? '@' : pop >= 10000 ? '0' : pop >= 3000 ? 'O' : 'o', 10 + pop)
  }
  const lines: string[] = [`year ${year} roads and routes: - road  = busy road  H highway  ~ sea lane in use   o 300+  O 3k+  0 10k+  @ 30k+   (. land  ^ mountain)`]
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
    const run = runHistory(w, undefined, undefined, true)
    const { history, terrain } = run
    const t2 = performance.now()
    rows.push(historyStats(w, history, terrain, t2 - t1, t1 - t0, run.diag))
    extra.push(`seed ${pad(seed, 6)} total pop curve 0..${history.years}: |${sparkline(history)}|`)
    if (maps) {
      for (const y of [500, 1000, 1500, 2000]) if (y <= history.years) extra.push(asciiMap(w, history, y))
      for (const y of [500, 1000, 1500, 2000]) if (y <= history.years) extra.push(asciiKnowledgeMap(w, history, y))
      if (history.road) extra.push(asciiTradeMap(w, history, history.years))
      extra.push(techTable(history))
      extra.push(asciiExploreMap(w, history, history.years, run.diag))
    }
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
