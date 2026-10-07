// Tourism of a History (contract: History.scenery .. visitorFlows, Settlement.resort, events
// 100-105), indexed for the UI: visitors and their spending per destination per trade snapshot
// (dense, destinations only), the rows of each snapshot (CSR, for the home towns of a place and
// the flows active at a year), the sights by settlement and by cell, the resorts with their
// founding, fashion spans and declines, and words for scenery, sights and decline causes. Built
// once per history (tourismOf caches it); all of it is optional at runtime: a history without
// tourism data (older histories, or `tourism: false`) gives null and the UI hides what it would
// show. A history with scenery but no travel yet still gives the data (the Scenery view works).
//
// Values at a year interpolate between the two trade snapshots around it (map sizes, hover);
// lists (the panel, the inspector's home towns) take the snapshot at or before the year.

import { EventType, SceneryBit, SightKind, type History, type Sight, type VisitorFlows } from '../contract.ts'
import { settlementName } from './format.ts'
import { landmarkSightPhrase } from './landmarksFormat.ts'

/** A resort town: founded for visitors, perhaps abandoned; fashion spans from the events. */
export interface ResortInfo {
  id: number
  founded: number
  /** Year given up (ResortAbandoned, or the settlement's abandonedYear), -1 alive. */
  abandoned: number
  /** The town most of its first visitors came from (ResortFounded `other`), -1 unknown. */
  from: number
  /** Visitors a year when founded, and the SightKind it was founded for (-1 for scenery alone). */
  foundVisitors: number
  foundSight: number
}

export interface TourismData {
  history: History
  N: number
  /** Trade snapshots and their interval (years). */
  Q: number
  interval: number
  F: VisitorFlows
  /** Rows of each trade snapshot: qOff[q] .. qOff[q + 1] (rows are sorted by snapshot then pair). */
  qOff: Uint32Array
  /** Destinations (settlements with visitors at some snapshot, or resorts), by peak visitors (largest first). */
  dests: Int32Array
  /** Destination index of each settlement, -1 none. */
  destOf: Int32Array
  D: number
  /** Visitors a year and their spending a year per destination per trade snapshot: [d * Q + q]. */
  destVis: Float32Array
  destSpend: Float32Array
  /** Peak visitors a year per destination, and the snapshot of the peak. */
  peakVis: Float32Array
  peakQ: Int32Array
  /** Peak visitors a year per pair. */
  pairPeak: Float32Array
  /** Visitors sent a year per home town (settlement) at its best snapshot (for "a home town of travellers"). */
  sentPeak: Map<number, number>
  /** Settlements whose people travel for pleasure at some point (home towns of any pair). */
  isHome: Uint8Array
  sights: Sight[]
  /** Sights per settlement: their own (a ruin's abandoned town, the old capital) and those hosted (SightRecognised `settlement`). */
  sightsOf: Map<number, number[]>
  /** The living settlement hosting each sight's visitors (from SightRecognised), else the sight's own settlement. */
  sightHost: Int32Array
  /** Sights per cell. */
  sightsAt: Map<number, number[]>
  /** Resorts by founding year, and per settlement. */
  resorts: ResortInfo[]
  resortOf: Map<number, ResortInfo>
  /** In-fashion spans per settlement: [on, off) pairs (off = Infinity while in fashion at the end), and the declines [year, cause]. */
  fashion: Map<number, number[]>
  declines: Map<number, [number, number][]>
  /** Tourism events (indices into History.events) per settlement (as `settlement`). */
  eventsOf: Map<number, number[]>
  /** First leisure travel (year, -1 none). */
  firstTravel: number
  /** Static per-cell scenery (0..255) and its bits, or null without them. */
  scenery: Uint8Array | null
  sceneryKind: Uint16Array | null
}

const cache = new WeakMap<History, TourismData | null>()

/** The tourism data of a history, or null when it has none (cached). */
export function tourismOf(h: History | null | undefined): TourismData | null {
  if (!h) return null
  if (cache.has(h)) return cache.get(h) ?? null
  let d: TourismData | null = null
  try {
    d = buildTourismData(h)
  } catch (err) {
    console.warn('tourism: data unusable, hidden', err)
    d = null
  }
  cache.set(h, d)
  return d
}

const isTourismEventType = (t: number) => t >= EventType.LeisureTravel && t <= EventType.SightRecognised

function buildTourismData(h: History): TourismData | null {
  const p = h as Partial<History>
  const cells = h.capacity.length
  const scenery = p.scenery instanceof Uint8Array && p.scenery.length >= cells && cells > 0 ? p.scenery : null
  const sceneryKind = p.sceneryKind instanceof Uint16Array && p.sceneryKind.length >= cells && cells > 0 ? p.sceneryKind : null
  const F = p.visitorFlows
  const sights = Array.isArray(p.sights) ? p.sights : []
  const flowsOk = !!F && F.count >= 0 && !!F.from && !!F.to && !!F.rowSnapshot && !!F.rowPair && !!F.visitors && F.from.length >= F.count && F.rowSnapshot.length >= F.rowCount
  const anyResort = h.settlements.some((s) => s.resort === true)
  if (!scenery && !(flowsOk && F!.count > 0) && !sights.length && !anyResort) return null
  const flows: VisitorFlows = flowsOk ? F! : {
    count: 0, from: new Int32Array(0), to: new Int32Array(0), firstYear: new Int16Array(0), pathOffsets: new Uint32Array(1), path: new Uint32Array(0),
    rowCount: 0, rowSnapshot: new Uint16Array(0), rowPair: new Int32Array(0), visitors: new Float32Array(0), spend: new Float32Array(0),
  }
  const N = h.settlements.length
  const interval = Math.max(1, h.tradeInterval || 10)
  const Q = Math.max(1, h.tradeSnapshotCount || Math.floor(h.years / interval) + 1)
  const R = flows.rowCount
  // rows per snapshot (sorted by the contract; checked)
  const qOff = new Uint32Array(Q + 1)
  for (let r = 0; r < R; r++) {
    const q = flows.rowSnapshot[r]
    if (r > 0 && q < flows.rowSnapshot[r - 1]) {
      console.warn('tourism: visitor rows are not in snapshot order; travel hidden')
      return null
    }
    if (q < Q) qOff[q + 1]++
  }
  for (let q = 0; q < Q; q++) qOff[q + 1] += qOff[q]
  // destinations
  const destOf = new Int32Array(N).fill(-1)
  const list: number[] = []
  const addDest = (id: number) => {
    if (id < 0 || id >= N || destOf[id] >= 0) return
    destOf[id] = list.length
    list.push(id)
  }
  for (let r = 0; r < R; r++) addDest(flows.to[flows.rowPair[r]])
  for (let id = 0; id < N; id++) if (h.settlements[id].resort) addDest(id)
  let D = list.length
  let vis = new Float32Array(D * Q), spend = new Float32Array(D * Q)
  const pairPeak = new Float32Array(flows.count)
  const sentAt = new Map<number, Float64Array>()
  const isHome = new Uint8Array(N)
  for (let r = 0; r < R; r++) {
    const k = flows.rowPair[r], q = flows.rowSnapshot[r]
    if (q >= Q) continue
    const d = destOf[flows.to[k]]
    const v = flows.visitors[r]
    vis[d * Q + q] += v
    spend[d * Q + q] += flows.spend?.[r] ?? 0
    if (v > pairPeak[k]) pairPeak[k] = v
    const from = flows.from[k]
    if (from >= 0 && from < N) {
      isHome[from] = 1
      let a = sentAt.get(from)
      if (!a) sentAt.set(from, (a = new Float64Array(Q)))
      a[q] += v
    }
  }
  const sentPeak = new Map<number, number>()
  for (const [id, a] of sentAt) {
    let m = 0
    for (let q = 0; q < Q; q++) m = Math.max(m, a[q])
    sentPeak.set(id, m)
  }
  // order by peak (largest first): re-pack
  const peak0 = new Float32Array(D), peakQ0 = new Int32Array(D)
  for (let d = 0; d < D; d++) {
    let m = 0, mq = 0
    for (let q = 0; q < Q; q++) if (vis[d * Q + q] > m) {
      m = vis[d * Q + q]
      mq = q
    }
    peak0[d] = m
    peakQ0[d] = mq
  }
  const order = Array.from({ length: D }, (_, i) => i).sort((a, b) => peak0[b] - peak0[a] || list[a] - list[b])
  const dests = Int32Array.from(order, (i) => list[i])
  {
    const v2 = new Float32Array(D * Q), s2 = new Float32Array(D * Q)
    order.forEach((old, nu) => {
      v2.set(vis.subarray(old * Q, old * Q + Q), nu * Q)
      s2.set(spend.subarray(old * Q, old * Q + Q), nu * Q)
      destOf[list[old]] = nu
    })
    vis = v2
    spend = s2
  }
  const peakVis = Float32Array.from(order, (i) => peak0[i])
  const peakQ = Int32Array.from(order, (i) => peakQ0[i])
  D = dests.length
  // events: resorts, fashion, sights' hosts
  const resortOf = new Map<number, ResortInfo>()
  const fashion = new Map<number, number[]>()
  const declines = new Map<number, [number, number][]>()
  const eventsOf = new Map<number, number[]>()
  const sightHost = Int32Array.from(sights, (x) => x.settlement)
  let firstTravel = -1
  h.events.forEach((e, i) => {
    const t = e.type as number
    if (!isTourismEventType(t)) return
    const id = e.settlement
    if (id >= 0 && id < N) {
      const a = eventsOf.get(id)
      if (a) a.push(i)
      else eventsOf.set(id, [i])
    }
    if (t === EventType.LeisureTravel && firstTravel < 0) firstTravel = e.year
    else if (t === EventType.ResortFounded && id >= 0 && id < N && !resortOf.has(id)) {
      resortOf.set(id, { id, founded: e.year, abandoned: -1, from: e.other, foundVisitors: e.value, foundSight: typeof e.extra === 'number' ? e.extra : -1 })
    } else if (t === EventType.ResortAbandoned) {
      const r = resortOf.get(id)
      if (r) r.abandoned = e.year
    } else if (t === EventType.ResortInFashion) {
      const a = fashion.get(id)
      if (!a) fashion.set(id, [e.year, Infinity])
      else if (a[a.length - 1] !== Infinity) a.push(e.year, Infinity)
    } else if (t === EventType.ResortDeclined) {
      const a = fashion.get(id)
      if (a && a[a.length - 1] === Infinity) a[a.length - 1] = e.year
      const b = declines.get(id)
      const c: [number, number] = [e.year, typeof e.extra === 'number' ? e.extra : 0]
      if (b) b.push(c)
      else declines.set(id, [c])
    } else if (t === EventType.SightRecognised) {
      const k = e.value
      if (k >= 0 && k < sights.length && id >= 0 && id < N) sightHost[k] = id
    }
  })
  // resorts without a founding event (should not happen): from the settlement itself
  for (let id = 0; id < N; id++) {
    const s = h.settlements[id]
    if (!s.resort) continue
    let r = resortOf.get(id)
    if (!r) {
      r = { id, founded: s.foundedYear, abandoned: -1, from: s.parent, foundVisitors: 0, foundSight: -1 }
      resortOf.set(id, r)
    }
    if (r.abandoned < 0 && s.abandonedYear >= 0) r.abandoned = s.abandonedYear
  }
  const resorts = [...resortOf.values()].sort((a, b) => a.founded - b.founded || a.id - b.id)
  const sightsOf = new Map<number, number[]>()
  const sightsAt = new Map<number, number[]>()
  const push = (m: Map<number, number[]>, k: number, v: number) => {
    const a = m.get(k)
    if (!a) m.set(k, [v])
    else if (!a.includes(v)) a.push(v)
  }
  sights.forEach((x, k) => {
    if (x.settlement >= 0 && x.settlement < N) push(sightsOf, x.settlement, k)
    if (sightHost[k] >= 0 && sightHost[k] < N) push(sightsOf, sightHost[k], k)
    if (x.cell >= 0 && x.cell < cells) push(sightsAt, x.cell, k)
  })
  return {
    history: h, N, Q, interval, F: flows, qOff, dests, destOf, D, destVis: vis, destSpend: spend, peakVis, peakQ, pairPeak, sentPeak, isHome,
    sights, sightsOf, sightHost, sightsAt, resorts, resortOf, fashion, declines, eventsOf, firstTravel, scenery, sceneryKind,
  }
}

// ---------------------------------------------------------------------------
// queries (all cheap functions of the year)

/** Trade snapshot at or before the year (clamped). */
export function snapAt(td: TourismData, year: number): number {
  return Math.max(0, Math.min(td.Q - 1, Math.floor(year / td.interval + 1e-6)))
}

/** The two trade snapshots around the year and the fraction between them. */
export function snapPair(td: TourismData, year: number, out: { q0: number; q1: number; frac: number }): { q0: number; q1: number; frac: number } {
  const x = Math.max(0, Math.min(td.Q - 1, year / td.interval))
  out.q0 = Math.floor(x + 1e-6)
  out.q1 = Math.min(td.Q - 1, out.q0 + 1)
  out.frac = out.q1 > out.q0 ? Math.max(0, Math.min(1, x - out.q0)) : 0
  return out
}

const tmpPair = { q0: 0, q1: 0, frac: 0 }

/** Visitors a year at settlement id at the year (interpolated between trade snapshots; 0 for none). */
export function visitorsAt(td: TourismData, id: number, year: number): number {
  const d = id >= 0 && id < td.N ? td.destOf[id] : -1
  if (d < 0) return 0
  const { q0, q1, frac } = snapPair(td, year, tmpPair)
  return td.destVis[d * td.Q + q0] * (1 - frac) + td.destVis[d * td.Q + q1] * frac
}

/** What visitors spend a year at settlement id at the year (interpolated). */
export function spendAt(td: TourismData, id: number, year: number): number {
  const d = id >= 0 && id < td.N ? td.destOf[id] : -1
  if (d < 0) return 0
  const { q0, q1, frac } = snapPair(td, year, tmpPair)
  return td.destSpend[d * td.Q + q0] * (1 - frac) + td.destSpend[d * td.Q + q1] * frac
}

/** Visitors a year at settlement id at trade snapshot q. */
export function visitorsAtSnap(td: TourismData, id: number, q: number): number {
  const d = id >= 0 && id < td.N ? td.destOf[id] : -1
  return d < 0 || q < 0 || q >= td.Q ? 0 : td.destVis[d * td.Q + q]
}

/** Home towns of the visitors to settlement id at trade snapshot q, largest first: [home, visitors a year]. */
export function sourcesAt(td: TourismData, id: number, q: number, max = 3): [number, number][] {
  const out: [number, number][] = []
  if (q < 0 || q >= td.Q) return out
  const F = td.F
  for (let r = td.qOff[q]; r < td.qOff[q + 1]; r++) {
    const k = F.rowPair[r]
    if (F.to[k] === id) out.push([F.from[k], F.visitors[r]])
  }
  out.sort((a, b) => b[1] - a[1] || a[0] - b[0])
  return out.slice(0, max)
}

/** Where the people of home town id travel at trade snapshot q, largest first: [destination, visitors a year]. */
export function tripsFrom(td: TourismData, id: number, q: number, max = 3): [number, number][] {
  const out: [number, number][] = []
  if (q < 0 || q >= td.Q) return out
  const F = td.F
  for (let r = td.qOff[q]; r < td.qOff[q + 1]; r++) {
    const k = F.rowPair[r]
    if (F.from[k] === id) out.push([F.to[k], F.visitors[r]])
  }
  out.sort((a, b) => b[1] - a[1] || a[0] - b[0])
  return out.slice(0, max)
}

/** Home towns over the whole run up to snapshot q (visitor-years), largest first. */
export function sourcesUpTo(td: TourismData, id: number, q: number, max = 3): [number, number][] {
  const m = new Map<number, number>()
  const F = td.F
  const hi = td.qOff[Math.max(0, Math.min(td.Q, q + 1))]
  for (let r = 0; r < hi; r++) {
    const k = F.rowPair[r]
    if (F.to[k] === id) m.set(F.from[k], (m.get(F.from[k]) ?? 0) + F.visitors[r])
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, max)
}

/** Places with visitors at trade snapshot q, most visited first: [settlement, visitors a year]. */
export function placesAt(td: TourismData, q: number): [number, number][] {
  const out: [number, number][] = []
  if (q < 0 || q >= td.Q) return out
  for (let d = 0; d < td.D; d++) {
    const v = td.destVis[d * td.Q + q]
    if (v > 0) out.push([td.dests[d], v])
  }
  return out.sort((a, b) => b[1] - a[1] || a[0] - b[0])
}

/** Visitors a year in all the world at trade snapshot q, and the places they go. */
export function worldVisitors(td: TourismData, q: number): { visitors: number; places: number } {
  let v = 0, n = 0
  if (q >= 0 && q < td.Q) for (let d = 0; d < td.D; d++) {
    const x = td.destVis[d * td.Q + q]
    if (x > 0) {
      v += x
      n++
    }
  }
  return { visitors: v, places: n }
}

/** Whether settlement id is in fashion at the year. */
export function inFashion(td: TourismData, id: number, year: number): boolean {
  const a = td.fashion.get(id)
  if (!a) return false
  for (let k = 0; k < a.length; k += 2) if (year >= a[k] && year < a[k + 1]) return true
  return false
}

/** The latest decline of settlement id by the year ([year, cause]), or null. */
export function lastDecline(td: TourismData, id: number, year: number): [number, number] | null {
  const a = td.declines.get(id)
  let out: [number, number] | null = null
  if (a) for (const x of a) if (x[0] <= year) out = x
  return out
}

/** Sights recognised by the year, in order of recognition. */
export function sightsBy(td: TourismData, year: number): number[] {
  const out: number[] = []
  for (let k = 0; k < td.sights.length; k++) if (td.sights[k].fromYear <= year) out.push(k)
  return out
}

/** The resort of settlement id at the year: 'alive', 'abandoned', or '' (not a resort, or not yet). */
export function resortState(td: TourismData, id: number, year: number): '' | 'alive' | 'abandoned' {
  const r = td.resortOf.get(id)
  if (!r || year < r.founded) return ''
  return r.abandoned >= 0 && year >= r.abandoned ? 'abandoned' : 'alive'
}

// ---------------------------------------------------------------------------
// words

export const sname = (td: TourismData, id: number) => (id >= 0 && id < td.N ? settlementName(td.history, id) : 'a far place')

/** Kind of sight as a noun ("ruins", "old capital"). */
export const SIGHT_WORDS: readonly string[] = ['ruins', 'old capital', 'famous summit', 'old polar base', 'old mining town', 'faded resort', 'holy city', 'great landmark']
/** Kind of sight as a short label for lists. */
export const SIGHT_SHORT: readonly string[] = ['Ruins', 'Old capital', 'Summit', 'Polar base', 'Mine town', 'Old resort', 'Holy city', 'Landmark']
/** A glyph per kind for the panel (as the map draws them: render/tourism.ts). */
export const SIGHT_GLYPH: readonly string[] = ['∏', '♛', '▲', '✻', '⚒', '☂', '✦', '⌶']
/** Colours per sight kind (CSS and 0..1), as the map tints their glyphs. */
export const SIGHT_RGB: readonly (readonly [number, number, number])[] = [
  [0.88, 0.8, 0.66], // ruins: weathered stone
  [1.0, 0.82, 0.36], // old capital: gold
  [0.86, 0.94, 1.0], // summit: snow
  [0.58, 0.86, 1.0], // polar base: ice
  [0.92, 0.6, 0.4], // mine town: rust
  [0.86, 0.66, 0.82], // faded resort: faded pink
  [1.0, 0.95, 0.72], // holy city: pale gold
  [0.74, 0.9, 0.66], // great landmark: mossy stone
]
export const SIGHT_CSS: readonly string[] = SIGHT_RGB.map(([r, g, b]) => `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`)
/** The travellers' colour (flows, visited places, resorts): a holiday pink apart from trade's cyan and amber and the disease kinds. */
export const TRAVEL_RGB: readonly [number, number, number] = [1.0, 0.5, 0.74]
export const TRAVEL_CSS = '#ff80bd'

/**
 * "the ruins of Kuniden", "the old capital Razu", "the summit of the Nozuhus", "a holy city"; a landmark sight by its own name
 * at `year` (default the year it became a sight) with history `h` ("the ruined Keep of Kube": landmarksFormat.ts), else "a great landmark".
 */
export function sightPhrase(x: Sight | undefined, h?: History, year?: number): string {
  if (!x) return 'a sight'
  if (x.kind === SightKind.Landmark) return (h ? landmarkSightPhrase(h, x.landmark, year ?? x.fromYear) : '') || 'a great landmark'
  const n = x.name
  switch (x.kind) {
    case SightKind.Ruin: return n ? `the ruins of ${n}` : 'old ruins'
    case SightKind.OldCapital: return n ? `the old capital ${n}` : 'an old capital'
    case SightKind.Summit: return n ? `the summit of the ${n}` : 'a famous summit'
    case SightKind.PolarBase: return n ? `the old polar base ${n}` : 'an old polar base'
    case SightKind.MineTown: return n ? `the old mining town ${n}` : 'an old mining town'
    case SightKind.FormerResort: return n ? `the faded resort of ${n}` : 'a faded resort'
    case SightKind.Holy: return n ? `the holy city ${n}` : 'a holy city'
  }
  return n || 'a sight'
}

/** How famous a sight is (fame 0..1). */
export function fameWords(f: number): string {
  if (f >= 0.75) return 'world-famous'
  if (f >= 0.5) return 'famous'
  if (f >= 0.3) return 'well known'
  return 'known locally'
}

/** Why a place fell out of fashion (ResortDeclined `extra`). */
export function causeWords(c: number): string {
  switch (c) {
    case 0: return 'fashion moved elsewhere'
    case 1: return 'war and danger on the way'
    case 2: return 'an epidemic kept visitors away'
    case 3: return 'the towns it drew on declined'
  }
  return 'its visitors stayed away'
}

/** How fine a cell's scenery is (0..255, rank-based: 186 is the top tenth of land), or '' for plain land. */
export function sceneryGrade(v: number): string {
  if (v >= 235) return 'among the finest views'
  if (v >= 186) return 'fine scenery'
  if (v >= 90) return 'pleasant country'
  return ''
}

/**
 * Why a place is scenic, from its SceneryBit flags: "snowy heights of the great range above a lake
 * shore", "a mild sea coast, with hot springs", "hot springs". '' for no bits.
 */
export function sceneryWords(bits: number): string {
  const B = SceneryBit
  const has = (b: number) => (bits & b) !== 0
  const heights = has(B.Relief) || has(B.Snow) || has(B.GreatRange)
  const mild = has(B.Pleasant) && !has(B.Cold)
  let water = ''
  if (has(B.GreatLake)) water = 'the shore of a great lake'
  else if (has(B.Lake)) water = 'a lake shore'
  else if (has(B.Island)) water = 'a small island'
  else if (has(B.Coast)) water = has(B.Cold) ? 'a cold, striking coast' : 'a sea coast'
  else if (has(B.River)) water = 'a great river'
  let main = ''
  if (heights) {
    const adj = has(B.Snow) ? 'snowy ' : has(B.Forest) ? 'wooded ' : ''
    main = `${adj || (water || has(B.GreatRange) || mild ? '' : 'rugged ')}heights${has(B.GreatRange) ? ' of the great range' : ''}`
    if (water) main += `${water === 'a small island' ? ' on' : ' above'} ${water}`
    if (mild && !has(B.Snow)) main += ' in a mild climate'
  } else if (water) {
    if (water === 'a small island') main = has(B.Forest) ? 'a small wooded island' : mild ? 'a small, mild island' : water
    else {
      const adj = has(B.Forest) ? 'wooded' : mild ? 'mild' : ''
      main = adj ? water.replace(/^(a|the) /, (m) => `${m}${adj} `) : water
    }
  } else if (has(B.Cold)) main = 'striking cold country of ice and tundra'
  else if (has(B.Forest)) main = mild ? 'mild woodland' : 'woodland'
  else if (mild) main = 'a mild, pleasant land'
  if (water && has(B.River) && !water.includes('river')) main += ' by a great river'
  if (has(B.Spring)) main = main ? `${main}, with hot springs` : 'hot springs'
  return main
}

/** "Fine scenery: snowy heights above a lake shore" for a cell, or '' for plain land. */
export function sceneryPhrase(td: TourismData, cell: number): string {
  if (!td.scenery || cell < 0 || cell >= td.scenery.length) return ''
  const v = td.scenery[cell]
  const g = sceneryGrade(v)
  if (!g) return ''
  const w = td.sceneryKind ? sceneryWords(td.sceneryKind[cell]) : ''
  const G = g.charAt(0).toUpperCase() + g.slice(1)
  return w ? `${G}: ${w}` : G
}

/** Visitors a year in words: "about 240 visitors a year". */
export function visitorWords(v: number): string {
  if (v < 1) return 'hardly any visitors'
  if (v < 10) return `a handful of visitors a year`
  const r = v < 100 ? Math.round(v / 5) * 5 : v < 1000 ? Math.round(v / 10) * 10 : Math.round(v / 100) * 100
  return `about ${r.toLocaleString('en-US')} visitors a year`
}
