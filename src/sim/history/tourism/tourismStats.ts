// tourism: stats harness for scenery, sights, leisure travel and resorts. Per seed: the first leisure travel, destinations
// with meaningful flows and resorts over time, the kinds of places visited and how scenic they are by rank, visitor
// spending against the world's income, resort economies, global aggregates; with --off also the aggregates without the
// system. --detail prints per seed the top scenic places, the sights, the destinations and resorts with their visitor
// histories and source towns, worked examples of declines, and an ASCII map of scenery with resorts marked.
//   node src/sim/history/tourism/tourismStats.ts [--off] [--json] [--detail] [--years N] seeds...

import { CITY_POPULATION, EventType, SceneryBit, SightKind, TOWN_POPULATION } from '../../../contract.ts'
import type { History, World } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import type { HistoryState } from '../state.ts'
import { HISTORY_STATS_SEEDS } from '../stats.ts'
import { RESORT } from './params.ts'

/** A destination counts at a snapshot when it has at least this many visitors a year. */
const MEANINGFUL = 20
const AT = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000]

export interface TourismRow {
  seed: number
  years: number
  ms: number
  msOff: number
  /** Year of the first leisure travel (-1 none) and peoples travelling by the end. */
  first: number
  peoples: number
  peoplesAll: number
  /** At each AT year (NaN past the run): destinations with >= MEANINGFUL visitors, visitors a year, resorts alive, resorts founded so far, spending / world income. */
  dests: number[]
  visitors: number[]
  resorts: number[]
  founded: number[]
  share: number[]
  /** Aggregates at AT years and the end's towns and cities; the same with the system off (NaN without --off). */
  pop: number[]
  living: number[]
  routes: number[]
  towns: number
  cities: number
  popOff: number[]
  livingOff: number[]
  routesOff: number[]
  townsOff: number
  citiesOff: number
  extinct: number
  /** Meaningful destinations at the end by kind (scenery bits of the host cell or sight kinds), and their mean scenery rank (u). */
  kinds: Record<string, number>
  meanRank: number
  /** Events. */
  inFashion: number
  declined: number
  abandoned: number
  sights: number
  /** Resorts: share of their food bought with visitor money (vs trade), and visitor income / their total wealth gain. */
  resortBought: number
  /** Sights by kind (SightKind order). */
  sightKinds: number[]
  pairs: number
  rows: number
  bytes: number
}

const BIT_NAMES: [number, string][] = [[SceneryBit.Relief, 'relief'], [SceneryBit.Lake, 'lake'], [SceneryBit.Coast, 'coast'], [SceneryBit.Island, 'island'], [SceneryBit.River, 'river'], [SceneryBit.Forest, 'forest'], [SceneryBit.Snow, 'snow'], [SceneryBit.Pleasant, 'pleasant'], [SceneryBit.Cold, 'cold'], [SceneryBit.Spring, 'spring'], [SceneryBit.GreatLake, 'greatLake'], [SceneryBit.GreatRange, 'greatRange']]
const SIGHT_NAMES = ['ruin', 'oldCapital', 'summit', 'polarBase', 'mineTown', 'formerResort', 'holy']
export function bitsOf(b: number): string {
  const out: string[] = []
  for (const [k, n] of BIT_NAMES) if (b & k) out.push(n)
  return out.join('+') || '-'
}

/** Scenery rank u (0..1) per cell from the Uint8 value (inverse of 255 u^3). */
function rankOf(v: number): number { return Math.cbrt(v / 255) }

/** Visitors per settlement at trade snapshot q (sum over rows). */
function visitorsAt(h: History, q: number): Map<number, number> {
  const F = h.visitorFlows
  const m = new Map<number, number>()
  for (let r = 0; r < F.rowCount; r++) if (F.rowSnapshot[r] === q) { const to = F.to[F.rowPair[r]]; m.set(to, (m.get(to) ?? 0) + F.visitors[r]) }
  return m
}

function aggregates(h: History, years: number): { pop: number[]; living: number[]; routes: number[]; towns: number; cities: number; extinct: number } {
  const S = h.settlements.length
  const pop: number[] = [], living: number[] = [], routes: number[] = []
  for (const y of AT) {
    if (y > years) { pop.push(NaN); living.push(NaN); routes.push(NaN); continue }
    const q = Math.floor(y / h.snapshotInterval)
    let p = 0, l = 0
    for (let id = 0; id < S; id++) { const st = h.settlements[id]; if (st.outpost || st.foundedYear > y || (st.abandonedYear >= 0 && st.abandonedYear <= y)) continue; const x = h.population[q * S + id]; if (x > 0) { p += x; l++ } }
    pop.push(p); living.push(l)
    const qt = Math.floor(y / h.tradeInterval)
    let r = 0
    for (let k = 0; k < h.trade.count; k++) if (h.tradeVolume[qt * h.trade.count + k] > 0) r++
    routes.push(r)
  }
  const q = h.snapshotCount - 1
  let towns = 0, cities = 0
  for (let id = 0; id < S; id++) { const x = h.population[q * S + id]; if (x >= CITY_POPULATION) cities++; else if (x >= TOWN_POPULATION) towns++ }
  const alive = new Set<number>()
  for (let id = 0; id < S; id++) if (h.settlements[id].abandonedYear < 0 && !h.settlements[id].outpost) alive.add(h.settlements[id].people)
  return { pop, living, routes, towns, cities, extinct: h.peoples.length - alive.size }
}

/** World income per decade and resort food bought, measured by a probe during the run (tourismSeedStats; pass it to runHistory to reuse a run). */
export interface TourismProbe {
  probe: (s: HistoryState) => void
  incDecade: number[]
  bought: number
  resortSupply: number
}
export function newTourismProbe(): TourismProbe {
  // World income: positive yearly wealth gains (after the 2% decay) of living settlements, per decade.
  let prevW = new Float64Array(0)
  const tp: TourismProbe = {
    incDecade: [], bought: 0, resortSupply: 0,
    probe: (s: HistoryState): void => {
      let inc = 0
      for (const id of s.living) { const pw = id < prevW.length ? prevW[id] : 0; const d = s.wealth[id] - pw * 0.98; if (d > 0) inc += d }
      const dec = (s.year / 10) | 0
      while (tp.incDecade.length <= dec) tp.incDecade.push(0)
      tp.incDecade[dec] += inc
      if (prevW.length < s.count) prevW = new Float64Array(2 * s.count)
      for (const id of s.living) prevW[id] = s.wealth[id]
      const tz = s.tz
      if (tz && tz.anyResort) for (const id of s.living) if (tz.resort[id]) { tp.resortSupply += s.pop[id]; tp.bought += Math.min(s.pop[id], tz.incomeSm[id] / RESORT.perHead) }
    },
  }
  return tp
}

/** One seed's row; `pre` reuses a finished run made with `pre.tp.probe` (one run per seed for all harnesses). */
export function tourismSeedStats(seed: number, years: number, off: boolean, detail: boolean, pre?: { w: World; run: ReturnType<typeof runHistory>; ms: number; tp: TourismProbe }): TourismRow {
  const w = pre ? pre.w : generateWorld(seed)
  const tp = pre ? pre.tp : newTourismProbe()
  const t0 = performance.now()
  const run = pre ? pre.run : runHistory(w, { years }, tp.probe)
  const ms = pre ? pre.ms : performance.now() - t0
  const incDecade = tp.incDecade
  const h = run.history
  let msOff = NaN
  let agOff: ReturnType<typeof aggregates> | null = null
  if (off) {
    const t1 = performance.now()
    const ho = runHistory(w, { years, tourism: false }).history
    msOff = performance.now() - t1
    agOff = aggregates(ho, years)
  }
  const ag = aggregates(h, years)
  const S = h.settlements.length
  const ev = h.events
  let first = -1
  const peoples = new Set<number>()
  for (const e of ev) if (e.type === EventType.LeisureTravel) { if (first < 0) first = e.year; peoples.add(e.value) }
  const spendDec = run.diag.tourism?.spendDecade ?? []
  const dests: number[] = [], visitors: number[] = [], resorts: number[] = [], founded: number[] = [], share: number[] = []
  for (const y of AT) {
    if (y > years) { dests.push(NaN); visitors.push(NaN); resorts.push(NaN); founded.push(NaN); share.push(NaN); continue }
    const m = visitorsAt(h, Math.floor(y / h.tradeInterval))
    let n = 0, v = 0
    for (const [, x] of m) { v += x; if (x >= MEANINGFUL) n++ }
    dests.push(n); visitors.push(v)
    let ra = 0, rf = 0
    for (const st of h.settlements) if (st.resort && st.foundedYear <= y) { rf++; if (st.abandonedYear < 0 || st.abandonedYear > y) ra++ }
    resorts.push(ra); founded.push(rf)
    // Spending / income over the century before y.
    let a = 0, b = 0
    for (let d = Math.max(0, y / 10 - 10); d < y / 10; d++) { a += spendDec[d] ?? 0; b += incDecade[d] ?? 0 }
    share.push(b > 0 ? a / b : 0)
  }
  // Kinds of the meaningful destinations at the end.
  const kinds: Record<string, number> = {}
  const end = visitorsAt(h, h.tradeSnapshotCount - 1)
  const sightAt = new Map<number, number>()
  for (const x of h.sights) { if (x.settlement >= 0) sightAt.set(x.settlement, x.kind); sightAt.set(-1 - x.cell, x.kind) }
  let rk = 0, rn = 0
  const G = w.grid
  const ids = [...end.keys()].sort((a, b) => a - b)
  for (const id of ids) {
    if ((end.get(id) ?? 0) < MEANINGFUL) continue
    const c = h.settlements[id].cell
    // Best scenery within one hop: the view.
    let best = c
    for (let k = G.neighborOffsets[c]; k < G.neighborOffsets[c + 1]; k++) { const j = G.neighbors[k]; if (h.scenery[j] > h.scenery[best]) best = j }
    rk += rankOf(h.scenery[best]); rn++
    const sk = sightAt.get(id)
    let label = bitsOf(h.sceneryKind[best]).split('+').slice(0, 2).join('+')
    if (sk !== undefined) label = 'sight:' + SIGHT_NAMES[sk]
    if (h.settlements[id].resort) label = 'resort ' + label
    kinds[label] = (kinds[label] ?? 0) + 1
  }
  const F = h.visitorFlows
  const bytes = h.scenery.byteLength + h.sceneryKind.byteLength + F.from.byteLength * 2 + F.firstYear.byteLength + F.pathOffsets.byteLength + F.path.byteLength + F.rowSnapshot.byteLength + F.rowPair.byteLength + F.visitors.byteLength + F.spend.byteLength
  const row: TourismRow = {
    seed, years, ms, msOff, first, peoples: peoples.size, peoplesAll: h.peoples.length, dests, visitors, resorts, founded, share,
    pop: ag.pop, living: ag.living, routes: ag.routes, towns: ag.towns, cities: ag.cities,
    popOff: agOff ? agOff.pop : AT.map(() => NaN), livingOff: agOff ? agOff.living : AT.map(() => NaN), routesOff: agOff ? agOff.routes : AT.map(() => NaN),
    townsOff: agOff ? agOff.towns : NaN, citiesOff: agOff ? agOff.cities : NaN, extinct: ag.extinct,
    kinds, meanRank: rn > 0 ? rk / rn : NaN,
    inFashion: ev.filter((e) => e.type === EventType.ResortInFashion).length, declined: ev.filter((e) => e.type === EventType.ResortDeclined).length,
    abandoned: ev.filter((e) => e.type === EventType.ResortAbandoned).length, sights: h.sights.length,
    resortBought: tp.resortSupply > 0 ? tp.bought / tp.resortSupply : NaN, sightKinds: SIGHT_NAMES.map((_, k) => h.sights.filter((x) => x.kind === k).length), pairs: F.count, rows: F.rowCount, bytes,
  }
  if (detail) console.log(detailText(w, h, row))
  void S
  return row
}

/** Equirectangular ASCII map: scenery shades, R resorts, o visited places, C source towns (at the end). */
function asciiMap(w: World, h: History): string {
  const W = 120, H = 44
  const P = w.grid.positions, off = w.grid.neighborOffsets, nb = w.grid.neighbors
  const S = h.settlements.length
  const mark = new Map<number, string>()
  const end = visitorsAt(h, h.tradeSnapshotCount - 1)
  const F = h.visitorFlows
  for (let r = 0; r < F.rowCount; r++) if (F.rowSnapshot[r] === h.tradeSnapshotCount - 1) mark.set(h.settlements[F.from[F.rowPair[r]]].cell, 'C')
  for (const [id, v] of end) if (v >= MEANINGFUL) mark.set(h.settlements[id].cell, 'o')
  for (let id = 0; id < S; id++) { const st = h.settlements[id]; if (st.resort) mark.set(st.cell, st.abandonedYear < 0 ? 'R' : 'r') }
  const lines: string[] = []
  let cur = 0
  const cellMark = new Map<string, string>()
  // Marks go to the pixel of their cell.
  for (const [c, ch] of mark) {
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2]
    const lat = Math.asin(Math.max(-1, Math.min(1, y))), lon = Math.atan2(z, x)
    const row = Math.min(H - 1, Math.floor(((Math.PI / 2 - lat) / Math.PI) * H)), col = Math.min(W - 1, Math.floor(((lon + Math.PI) / (2 * Math.PI)) * W))
    const k = row + ':' + col
    const old = cellMark.get(k)
    if (!old || 'RroC'.indexOf(ch) < 'RroC'.indexOf(old)) cellMark.set(k, ch)
  }
  for (let r = 0; r < H; r++) {
    const lat = Math.PI / 2 - ((r + 0.5) / H) * Math.PI
    let line = ''
    for (let c = 0; c < W; c++) {
      const lon = -Math.PI + ((c + 0.5) / W) * 2 * Math.PI
      const x = Math.cos(lat) * Math.cos(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(lon)
      for (;;) {
        let best = cur, bd = P[cur * 3] * x + P[cur * 3 + 1] * y + P[cur * 3 + 2] * z
        for (let k = off[cur]; k < off[cur + 1]; k++) { const j = nb[k]; const d = P[j * 3] * x + P[j * 3 + 1] * y + P[j * 3 + 2] * z; if (d > bd) { bd = d; best = j } }
        if (best === cur) break
        cur = best
      }
      const m = cellMark.get(r + ':' + c)
      if (m) { line += m; continue }
      if (w.elevation[cur] < 0) { line += ' '; continue }
      if (w.lake[cur]) { line += '~'; continue }
      const v = h.scenery[cur]
      line += v < 32 ? '.' : v < 90 ? ',' : v < 160 ? ':' : v < 205 ? '+' : v < 235 ? '*' : '#'
    }
    lines.push(line.replace(/\s+$/, ''))
  }
  return lines.join('\n') + '\n   scenery: . <32  , <90  : <160  + <205  * <235  # top;  R resort (r abandoned)  o visited place (>= ' + MEANINGFUL + ' a year)  C home town of travellers  ~ lake'
}

function detailText(w: World, h: History, row: TourismRow): string {
  const out: string[] = []
  const S = h.settlements.length
  const name = (id: number): string => id >= 0 ? `${h.settlements[id].name}#${id}` : '-'
  out.push(`==== seed ${row.seed}, ${row.years} years ====`)
  // Top scenic places (one per 3-hop neighbourhood).
  const N = w.grid.cellCount
  const cells: number[] = []
  for (let c = 0; c < N; c++) if (h.scenery[c] >= 240) cells.push(c)
  cells.sort((a, b) => h.scenery[b] - h.scenery[a] || a - b)
  const taken = new Uint8Array(N)
  const top: number[] = []
  for (const c of cells) {
    if (taken[c] || top.length >= 12) continue
    top.push(c)
    const q = [c], dq = [0]
    taken[c] = 1
    for (let i = 0; i < q.length; i++) { if (dq[i] >= 3) continue; for (let k = w.grid.neighborOffsets[q[i]]; k < w.grid.neighborOffsets[q[i] + 1]; k++) { const j = w.grid.neighbors[k]; if (!taken[j]) { taken[j] = 1; q.push(j); dq.push(dq[i] + 1) } } }
  }
  out.push('top scenic places (cell scenery: what makes it scenic; temperature, elevation; nearest settlement at the end):')
  for (const c of top) {
    let near = -1, nd = Infinity
    const P = w.grid.positions
    for (let id = 0; id < S; id++) { const st = h.settlements[id]; if (st.abandonedYear >= 0 || st.outpost) continue; const e = st.cell; const dx = P[e * 3] - P[c * 3], dy = P[e * 3 + 1] - P[c * 3 + 1], dz = P[e * 3 + 2] - P[c * 3 + 2]; const d = dx * dx + dy * dy + dz * dz; if (d < nd) { nd = d; near = id } }
    const hops = Math.sqrt(nd) / (3.6 / Math.sqrt((N - 2) / 10))
    out.push(`  cell ${c} ${h.scenery[c]}: ${bitsOf(h.sceneryKind[c])}; t ${w.temperature[c].toFixed(2)} e ${w.elevation[c].toFixed(2)}; ${name(near)} ~${hops.toFixed(1)} hops`)
  }
  out.push(`sights (${h.sights.length}):`)
  for (const x of h.sights) out.push(`  #${x.id} ${x.fromYear} ${SIGHT_NAMES[x.kind]} "${x.name}" cell ${x.cell} (scenery ${h.scenery[x.cell]}) settlement ${name(x.settlement)} fame ${x.fame.toFixed(2)}`)
  // Destinations: settlements with visitors at any snapshot, by peak.
  const F = h.visitorFlows
  const Q = h.tradeSnapshotCount
  const per = new Map<number, Float64Array>()
  const srcV = new Map<number, Map<number, number>>()
  for (let r = 0; r < F.rowCount; r++) {
    const k = F.rowPair[r], to = F.to[k]
    let a = per.get(to)
    if (!a) { a = new Float64Array(Q); per.set(to, a) }
    a[F.rowSnapshot[r]] += F.visitors[r]
    let m = srcV.get(to)
    if (!m) { m = new Map(); srcV.set(to, m) }
    m.set(F.from[k], (m.get(F.from[k]) ?? 0) + F.visitors[r])
  }
  const order = [...per.keys()].sort((a, b) => Math.max(...per.get(b)!) - Math.max(...per.get(a)!) || a - b)
  out.push('destinations and resorts (visitors a year every 50 years from 1500; cell scenery and kind; main home towns):')
  for (const id of order.slice(0, 16)) {
    const a = per.get(id)!
    const st = h.settlements[id]
    const c = st.cell
    const hist: string[] = []
    for (let y = 1500; y <= row.years; y += 50) hist.push(String(Math.round(a[Math.floor(y / h.tradeInterval)] ?? 0)))
    const srcs = [...srcV.get(id)!.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, 3).map(([s, v]) => `${name(s)}(${h.peoples[h.settlements[s].people].name}, t ${w.temperature[h.settlements[s].cell].toFixed(2)}) ${Math.round(v * h.tradeInterval)}`)
    const sk = h.sights.filter((x) => x.settlement === id).map((x) => SIGHT_NAMES[x.kind]).join(',')
    out.push(`  ${st.resort ? 'RESORT ' : ''}${name(id)} [${h.peoples[st.people].name}] founded ${st.foundedYear}${st.abandonedYear >= 0 ? ' abandoned ' + st.abandonedYear : ''} cell ${c} scenery ${h.scenery[c]} (u ${rankOf(h.scenery[c]).toFixed(2)}) ${bitsOf(h.sceneryKind[c])}${sk ? ' sight ' + sk : ''} t ${w.temperature[c].toFixed(2)} e ${w.elevation[c].toFixed(2)}`)
    out.push(`      visitors: ${hist.join(' ')}`)
    out.push(`      from: ${srcs.join('; ')}`)
  }
  out.push('tourism events:')
  const T: Record<number, string> = { 100: 'LeisureTravel', 101: 'ResortFounded', 102: 'InFashion', 103: 'Declined', 104: 'ResortAbandoned' }
  const CAUSE = ['fashion moved', 'war or danger', 'epidemic', 'home towns declined']
  for (const e of h.events) {
    if (e.type < 100 || e.type > 104) continue
    const extra = e.type === EventType.ResortDeclined ? ` (${CAUSE[e.extra ?? 0]})` : e.type === EventType.LeisureTravel ? ` people ${h.peoples[e.value].name}` : ` value ${Math.round(e.value)}`
    out.push(`  ${e.year} ${T[e.type]} ${name(e.settlement)} other ${name(e.other)}${extra}`)
  }
  out.push(asciiMap(w, h))
  return out.join('\n')
}

const med = (x: number[]): number => { const s = x.filter((v) => Number.isFinite(v)).sort((a, b) => a - b); if (!s.length) return NaN; return s.length % 2 ? s[s.length >> 1] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]) }
const mm = (x: number[]): string => { const s = x.filter((v) => Number.isFinite(v)); return s.length ? `${fmt(med(s))} [${fmt(Math.min(...s))}..${fmt(Math.max(...s))}]` : '-' }
function fmt(v: number): string { if (!Number.isFinite(v)) return '-'; const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e4 ? (v / 1e3).toFixed(0) + 'k' : a >= 1000 ? (v / 1e3).toFixed(1) + 'k' : a >= 10 ? v.toFixed(0) : a >= 1 ? v.toFixed(1) : v.toFixed(3) }

export function tourismTable(rows: TourismRow[]): string {
  const out: string[] = []
  out.push('per seed: first leisure travel, peoples travelling / all, destinations >= ' + MEANINGFUL + ' visitors (2000/2500/3000), resorts alive (2000/2500/3000), founded, in-fashion/declined/abandoned events, sights, spend share of income (century to 2000/3000), resort food bought, meaningful destinations\' mean scenery rank, kinds at the end, ms')
  for (const r of rows) {
    const i2 = AT.indexOf(2000), i25 = AT.indexOf(2500), i3 = AT.indexOf(3000)
    out.push(`seed ${String(r.seed).padStart(6)} y${r.years}: first ${r.first} peoples ${r.peoples}/${r.peoplesAll} dests ${r.dests[i2]}/${fmt(r.dests[i25])}/${fmt(r.dests[i3])} resorts ${r.resorts[i2]}/${fmt(r.resorts[i25])}/${fmt(r.resorts[i3])} founded ${r.founded[AT.findIndex((y) => y >= r.years)] ?? '-'} ev ${r.inFashion}/${r.declined}/${r.abandoned} sights ${r.sights} share ${(100 * r.share[i2]).toFixed(2)}%/${Number.isFinite(r.share[i3]) ? (100 * r.share[i3]).toFixed(2) + '%' : '-'} bought ${fmt(r.resortBought)} rank ${fmt(r.meanRank)} pairs ${r.pairs} rows ${r.rows} ${(r.bytes / 1024).toFixed(0)}KB ms ${r.ms.toFixed(0)}${Number.isFinite(r.msOff) ? '/' + r.msOff.toFixed(0) : ''} extinct ${r.extinct}`)
    out.push(`      kinds: ${Object.entries(r.kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ')}`)
  }
  out.push('summary (median [min..max]):')
  out.push('   year  dests            visitors            resorts          founded          spend/income        pop                 living            routes        |  off: pop          living         routes')
  for (let i = 0; i < AT.length; i++) {
    if (!rows.some((r) => Number.isFinite(r.dests[i]))) continue
    out.push(`   ${String(AT[i]).padStart(4)}  ${mm(rows.map((r) => r.dests[i])).padEnd(16)} ${mm(rows.map((r) => r.visitors[i])).padEnd(19)} ${mm(rows.map((r) => r.resorts[i])).padEnd(16)} ${mm(rows.map((r) => r.founded[i])).padEnd(16)} ${mm(rows.map((r) => 100 * r.share[i])).padEnd(19)} ${mm(rows.map((r) => r.pop[i])).padEnd(19)} ${mm(rows.map((r) => r.living[i])).padEnd(17)} ${mm(rows.map((r) => r.routes[i])).padEnd(13)} | ${mm(rows.map((r) => r.popOff[i])).padEnd(16)} ${mm(rows.map((r) => r.livingOff[i])).padEnd(14)} ${mm(rows.map((r) => r.routesOff[i]))}`)
  }
  if (rows.some((r) => Number.isFinite(r.popOff[0]))) {
    out.push('per-seed change on vs off (median [min..max] %): pop / living / routes')
    const pc = (a: number, b: number): number => 100 * (a / b - 1)
    for (let i = 0; i < AT.length; i++) {
      if (!rows.some((r) => Number.isFinite(r.popOff[i]))) continue
      out.push(`   ${String(AT[i]).padStart(4)}  ${mm(rows.map((r) => pc(r.pop[i], r.popOff[i]))).padEnd(24)} ${mm(rows.map((r) => pc(r.living[i], r.livingOff[i]))).padEnd(24)} ${mm(rows.map((r) => pc(r.routes[i], r.routesOff[i])))}`)
    }
  }
  const firsts = rows.map((r) => r.first).filter((x) => x >= 0)
  out.push(`first leisure travel: median ${fmt(med(firsts))} [${Math.min(...firsts)}..${Math.max(...firsts)}], none in ${rows.length - firsts.length}; by 2000 in ${rows.filter((r) => r.first >= 0 && r.first <= 2000).length}/${rows.length}`)
  out.push(`towns/cities at the end: ${mm(rows.map((r) => r.towns))} / ${mm(rows.map((r) => r.cities))}; off ${mm(rows.map((r) => r.townsOff))} / ${mm(rows.map((r) => r.citiesOff))}; extinct peoples ${rows.reduce((a, r) => a + r.extinct, 0)}`)
  out.push(`sights by kind (median [min..max]): ${SIGHT_NAMES.map((n, k) => n + ' ' + mm(rows.map((r) => r.sightKinds[k]))).join(', ')}`)
  out.push(`resort people supported by visitor income: ${mm(rows.map((r) => r.resortBought))}; mean scenery rank of meaningful destinations ${mm(rows.map((r) => r.meanRank))}; KB ${mm(rows.map((r) => r.bytes / 1024))}`)
  return out.join('\n')
}

if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) {
  const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
  const args = argv.slice(2)
  const off = args.includes('--off'), json = args.includes('--json'), detail = args.includes('--detail')
  const yi = args.indexOf('--years')
  const years = yi >= 0 ? Number(args[yi + 1]) : 2000
  const seeds = args.filter((a: string, i: number) => !a.startsWith('--') && (yi < 0 || i !== yi + 1)).map(Number)
  const use = seeds.length ? seeds : HISTORY_STATS_SEEDS
  const rows = use.map((s: number) => tourismSeedStats(s, years, off, detail))
  if (json) console.log(JSON.stringify(rows))
  else console.log(tourismTable(rows))
  void SightKind
}
