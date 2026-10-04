// Per-history lookups about the useful plants and animals of a world (History.species):
// a colour and a short description per species, which peoples held which species since
// when and from whom (speciesYear, speciesSource), the main staple and herd animal of each
// cell per land snapshot (crop, herd) with per-snapshot tallies, the exchange web (who
// passed which species to whom, and where), and the epidemics. Everything the UI shows at a
// year is a cheap function of that year, so scrubbing in either direction is exact.
//
// All of it is optional at runtime: without valid species fields there is no SpeciesData
// and the species views, panel, chips and lines stay hidden. Each field is checked on its
// own: a history with species but no crop or herd layers still gets the panel and chips.
//
// STAND_IN (the one switch below): for developing before the simulation produces these
// fields, 'fallback' fabricates plausible ones when they are missing (a dozen species with
// origins at the founders of peoples whose homeland suits them, spread along first
// contacts with a delay where the climate suits them, crop and herd layers from the land
// use and each cell's nearest settlement's people, and Domesticated, SpeciesAdopted and
// Epidemic events) and 'force' does so even when real fields are present. 'off' (the
// default) never does.

import { EventType, type History, type HistoryEvent, type SpeciesCategory, type SpeciesInfo, type World } from '../contract.ts'
import { PeoplesEvent, speciesGloss } from './format.ts'
import type { PeoplesData } from './peoplesData.ts'

type StandIn = 'off' | 'fallback' | 'force'
/** DEV STAND-IN SWITCH: 'off' in committed code (see the header). */
const STAND_IN = 'off' as StandIn

export interface SpeciesData {
  count: number
  list: readonly SpeciesInfo[]
  /** Display colour per species: CSS hex and sRGB 0..1 triplets. */
  css: string[]
  rgb: Float32Array
  /** "Pallu" (capitalised world name) and "a highland tuber". */
  names: string[]
  gloss: string[]
  /** Number of peoples (rows of year and source). */
  peoples: number
  /** Year people p first held species s, -1 never: year[p * count + s]. */
  year: Int16Array
  /** The people it came from, -1 own (founding set or tamed): source[p * count + s]. */
  source: Int8Array
  /** Main staple / herd animal per land snapshot per cell (species id + 1, 0 none), or null when the history has none. */
  crop: Uint8Array | null
  herd: Uint8Array | null
  cellCount: number
  landInterval: number
  landCount: number
  /** Cells whose main crop (herd) is species s at land snapshot l: [l * count + s]; cells with any crop (herd) per land snapshot. */
  cropCells: Uint32Array
  herdCells: Uint32Array
  farmedCells: Uint32Array
  pastureCells: Uint32Array
  /** The exchange web: one arc per adoption, from the giver's place to the taker's, from its year (sorted by year). */
  arcSpecies: Int32Array
  arcFrom: Int32Array
  arcTo: Int32Array
  arcYear: Float32Array
  /** Epidemic pulses: cells of the stricken people's larger settlements, and the year. */
  epidemicCells: Int32Array
  epidemicYears: Float32Array
  standIn: boolean
}

// ---------------------------------------------------------------------------
// colours

/** Distinct hues for a dark map, in assignment order (staples first, then livestock, then the rest). */
const PALETTE = [
  '#e6b422', '#6fbf4a', '#e0703a', '#5aa9e6', '#c86fc9', '#ece27c', '#3fb8a8', '#e05a6e',
  '#9b8ce0', '#a8c64a', '#b8875a', '#7ad1e8', '#f09bc0', '#5f7fd9', '#dcc08f', '#4d9e5f',
  '#ef9a6a', '#c3aaf0', '#c4c44a', '#8ecfb0', '#d65f9a', '#8fa3b8', '#f2c36b', '#6a9e9e',
]

function hexRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

// ---------------------------------------------------------------------------
// reading the history

function readFields(h: History, P: number, N: number) {
  const p = h as Partial<History>
  const list = p.species
  if (!Array.isArray(list) || list.length === 0) return null
  const S = list.length
  const Y = p.speciesYear, Src = p.speciesSource
  if (!(Y instanceof Int16Array) || Y.length < P * S) return null
  const source = Src instanceof Int8Array && Src.length >= P * S ? Src : new Int8Array(P * S).fill(-1)
  const L = p.landSnapshotCount ?? 0
  const okLayer = (a: unknown) => (a instanceof Uint8Array && L > 0 && a.length >= L * N ? a : null)
  return { list, year: Y, source, crop: okLayer(p.crop), herd: okLayer(p.herd) }
}

/** Largest living settlement (not a base) of people `p` at `year`, else its founder; -1 without peoples data. */
function largestOf(h: History, pd: PeoplesData, p: number, year: number): number {
  const N = h.settlements.length
  const s = Math.max(0, Math.min(h.snapshotCount - 1, Math.round(year / h.snapshotInterval)))
  let best = -1, bestPop = 0
  for (let i = 0; i < N; i++) {
    if (pd.people[i] !== p || (h.settlements[i] as { outpost?: boolean }).outpost === true) continue
    const v = h.population[s * N + i]
    if (v > bestPop) {
      bestPop = v
      best = i
    }
  }
  return best >= 0 ? best : pd.founder[p] ?? -1
}

/** Species data for history `h`, or null when it has none. Run applySpeciesStandIn first (when developing without the real fields). */
export function buildSpeciesData(world: World, h: History, pd: PeoplesData | null, standIn = false): SpeciesData | null {
  if (!pd) return null
  const N = world.grid.cellCount
  const P = pd.count
  const f = readFields(h, P, N)
  if (!f) return null
  const S = f.list.length
  const order = f.list.map((_, i) => i).sort((a, b) => f.list[a].category - f.list[b].category || a - b)
  const css: string[] = new Array(S)
  const rgb = new Float32Array(S * 3)
  order.forEach((sp, k) => {
    const hex = PALETTE[k % PALETTE.length]
    const dim = Math.pow(0.78, Math.floor(k / PALETTE.length))
    const [r, g, b] = hexRgb(hex)
    rgb.set([r * dim, g * dim, b * dim], sp * 3)
    const hh = (v: number) => Math.round(v * dim * 255).toString(16).padStart(2, '0')
    css[sp] = `#${hh(r)}${hh(g)}${hh(b)}`
  })
  const names = f.list.map((x, i) => (x.name ? x.name.charAt(0).toUpperCase() + x.name.slice(1) : `Species ${i + 1}`))
  const gloss = f.list.map((x) => speciesGloss(x.archetype ?? '', x.category))
  const L = h.landSnapshotCount ?? 0
  const cropCells = new Uint32Array(Math.max(1, L) * S)
  const herdCells = new Uint32Array(Math.max(1, L) * S)
  const farmedCells = new Uint32Array(Math.max(1, L))
  const pastureCells = new Uint32Array(Math.max(1, L))
  for (let l = 0; l < L; l++) {
    const o = l * N
    if (f.crop) for (let c = 0; c < N; c++) { const v = f.crop[o + c]; if (v > 0 && v <= S) { cropCells[l * S + v - 1]++; farmedCells[l]++ } }
    if (f.herd) for (let c = 0; c < N; c++) { const v = f.herd[o + c]; if (v > 0 && v <= S) { herdCells[l * S + v - 1]++; pastureCells[l]++ } }
  }
  // the exchange web: from the SpeciesAdopted events when there are any, else from the sources between the peoples' founders
  const arcs: { s: number; a: number; b: number; y: number }[] = []
  const NS = h.settlements.length
  for (const e of h.events) {
    if ((e.type as number) !== PeoplesEvent.SpeciesAdopted) continue
    if (e.value < 0 || e.value >= S || e.settlement < 0 || e.settlement >= NS || e.other < 0 || e.other >= NS) continue
    arcs.push({ s: e.value, a: h.settlements[e.other].cell, b: h.settlements[e.settlement].cell, y: e.year })
  }
  if (!arcs.length) {
    for (let p = 0; p < P; p++) {
      for (let s = 0; s < S; s++) {
        const q = f.source[p * S + s], y = f.year[p * S + s]
        if (q < 0 || q >= P || y < 0) continue
        const fa = pd.founder[q], fb = pd.founder[p]
        if (fa < 0 || fb < 0) continue
        arcs.push({ s, a: largestCell(h, pd, q, y), b: largestCell(h, pd, p, y), y })
      }
    }
  }
  arcs.sort((x, y) => x.y - y.y)
  // epidemics: pulses at the stricken people's larger settlements
  const eCells: number[] = [], eYears: number[] = []
  for (const e of h.events) {
    if ((e.type as number) !== PeoplesEvent.Epidemic || e.settlement < 0 || e.settlement >= NS) continue
    const p = pd.people[e.settlement]
    const sn = Math.max(0, Math.min(h.snapshotCount - 1, Math.round(e.year / h.snapshotInterval)))
    const mine: number[] = []
    for (let i = 0; i < NS; i++) if (pd.people[i] === p && h.population[sn * NS + i] > 0 && (h.settlements[i] as { outpost?: boolean }).outpost !== true) mine.push(i)
    mine.sort((a, b) => h.population[sn * NS + b] - h.population[sn * NS + a])
    for (const i of mine.slice(0, 6)) {
      eCells.push(h.settlements[i].cell)
      eYears.push(e.year + (i === e.settlement ? 0 : 0.6))
    }
  }
  return {
    count: S,
    list: f.list,
    css,
    rgb,
    names,
    gloss,
    peoples: P,
    year: f.year,
    source: f.source,
    crop: f.crop,
    herd: f.herd,
    cellCount: N,
    landInterval: h.landInterval ?? 20,
    landCount: L,
    cropCells,
    herdCells,
    farmedCells,
    pastureCells,
    arcSpecies: Int32Array.from(arcs, (a) => a.s),
    arcFrom: Int32Array.from(arcs, (a) => a.a),
    arcTo: Int32Array.from(arcs, (a) => a.b),
    arcYear: Float32Array.from(arcs, (a) => a.y),
    epidemicCells: Int32Array.from(eCells),
    epidemicYears: Float32Array.from(eYears),
    standIn,
  }
}

function largestCell(h: History, pd: PeoplesData, p: number, year: number): number {
  const id = largestOf(h, pd, p, year)
  return id >= 0 ? h.settlements[id].cell : 0
}

/** Species people `p` holds at `year`, in id order (into `out`). */
export function heldAt(d: SpeciesData, p: number, year: number, out: number[]): number[] {
  out.length = 0
  if (p < 0 || p >= d.peoples) return out
  for (let s = 0; s < d.count; s++) {
    const y = d.year[p * d.count + s]
    if (y >= 0 && y <= year) out.push(s)
  }
  return out
}

/** Number of peoples holding species `s` at `year`. */
export function holdersAt(d: SpeciesData, s: number, year: number): number {
  let n = 0
  for (let p = 0; p < d.peoples; p++) {
    const y = d.year[p * d.count + s]
    if (y >= 0 && y <= year) n++
  }
  return n
}

/** Land snapshot whose crop and herd layers show at `year` (they switch at the snapshot year). */
export function cropSnapshotAt(d: SpeciesData, year: number): number {
  return Math.max(0, Math.min(d.landCount - 1, Math.floor(year / Math.max(1, d.landInterval) + 1e-6)))
}

// ---------------------------------------------------------------------------
// DEV STAND-IN (see STAND_IN)

interface Arch { a: string; c: number; t: number; r: number; hi: number }
const STAND_IN_SPECIES: Arch[] = [
  { a: 'wheat', c: 0, t: 0.55, r: 0.36, hi: 0 },
  { a: 'rice', c: 0, t: 0.82, r: 0.78, hi: 0 },
  { a: 'potato', c: 0, t: 0.38, r: 0.5, hi: 1 },
  { a: 'maize', c: 0, t: 0.7, r: 0.52, hi: 0 },
  { a: 'millet', c: 0, t: 0.78, r: 0.24, hi: 0 },
  { a: 'taro', c: 0, t: 0.88, r: 0.86, hi: 0 },
  { a: 'barley', c: 0, t: 0.42, r: 0.3, hi: 0 },
  { a: 'sheep', c: 1, t: 0.45, r: 0.34, hi: 0 },
  { a: 'cattle', c: 1, t: 0.6, r: 0.5, hi: 0 },
  { a: 'goat', c: 1, t: 0.62, r: 0.24, hi: 1 },
  { a: 'camel', c: 1, t: 0.8, r: 0.1, hi: 0 },
  { a: 'llama', c: 1, t: 0.4, r: 0.42, hi: 1 },
]

function hashf(a: number, b: number, c = 0): number {
  let x = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b) ^ Math.imul(c + 13, 0xc2b2ae35)) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39) >>> 0
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296
}

function fitOf(world: World, c: number, k: Arch): number {
  const T = world.temperature[c], R = world.rainfall[c], E = Math.max(0, world.elevation[c])
  const base = Math.exp(-(((T - k.t) / 0.2) ** 2) - (((R - k.r) / 0.28) ** 2))
  const s = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
  return base * (k.hi ? 0.55 + 0.9 * s(0.12, 0.42, E) : 1 - 0.55 * s(0.3, 0.6, E))
}

/**
 * Fabricates History.species, speciesYear, speciesSource, crop and herd and the species
 * events when STAND_IN asks for it (see the header), writing them into `h` (its events
 * replaced by a sorted copy). Run it after buildPeoplesData and before the history index.
 * Returns whether it did.
 */
export function applySpeciesStandIn(world: World, h: History, pd: PeoplesData | null): boolean {
  if (STAND_IN === 'off' || !pd || pd.count === 0) return false
  const N = world.grid.cellCount
  if (STAND_IN === 'fallback' && readFields(h, pd.count, N)) return false
  const P = pd.count
  const S = STAND_IN_SPECIES.length
  const NS = h.settlements.length
  const fcell = (p: number) => h.settlements[pd.founder[p]]?.cell ?? 0
  const cradle = (p: number) => ((h as Partial<History>).peoples?.[p] as { cradle?: number } | undefined)?.cradle ?? p
  // origins: the people whose homeland suits it best (spread over peoples), sometimes a second in another cradle
  const load = new Int32Array(P)
  const origins: number[][] = []
  for (let s = 0; s < S; s++) {
    const k = STAND_IN_SPECIES[s]
    const score = (p: number) => fitOf(world, fcell(p), k) * (0.65 + 0.7 * hashf(p, s, world.seed)) / (1 + load[p])
    let best = 0
    for (let p = 1; p < P; p++) if (score(p) > score(best)) best = p
    load[best]++
    const o = [best]
    if (s % 3 === 1) {
      let second = -1
      for (let p = 0; p < P; p++) if (cradle(p) !== cradle(best) && fitOf(world, fcell(p), k) > 0.25 && (second < 0 || score(p) > score(second))) second = p
      if (second >= 0) { o.push(second); load[second]++ }
    }
    origins.push(o)
  }
  // names in the language of the first people to hold it: a piece of one of its place names
  const used = new Set<string>()
  const species: SpeciesInfo[] = STAND_IN_SPECIES.map((k, s) => {
    const p = origins[s][0]
    const own = h.settlements.filter((x) => pd.people[x.id] === p)
    let name = ''
    for (let t = 0; t < 8 && (!name || used.has(name)); t++) {
      const src = (own[Math.floor(hashf(s, t, 3) * own.length)]?.name ?? 'kala').toLowerCase().replace(/[^a-z]/g, '')
      const cut = 3 + Math.floor(hashf(s, t, 5) * 2)
      const ends = ['u', 'i', 'el', 'an', 'o', 'ra', 'ek', 'ish']
      name = src.slice(0, cut).replace(/[aeiou]+$/, '') + ends[Math.floor(hashf(s, t, 9) * ends.length)]
    }
    used.add(name)
    return { id: s, archetype: k.a, category: k.c as SpeciesCategory, name, origins: origins[s].map(fcell), yield: k.c === 0 ? 0.8 + 0.5 * hashf(s, 1) : 0 }
  })
  // who holds what from when: the origins from the start or a domestication, then along contacts
  const Y = new Int16Array(P * S).fill(-1)
  const Src = new Int8Array(P * S).fill(-1)
  const added: HistoryEvent[] = []
  const C = pd.contactYear
  for (let s = 0; s < S; s++) {
    const k = STAND_IN_SPECIES[s]
    const tent = new Float64Array(P).fill(Infinity)
    const from = new Int32Array(P).fill(-1)
    for (const p of origins[s]) {
      const tamed = hashf(s, p, 11) < 0.5 ? 0 : Math.round(150 + hashf(s, p, 12) * 750)
      tent[p] = tamed
      if (tamed > 0) {
        const at = largestOf(h, pd, p, tamed)
        if (at >= 0) added.push({ year: tamed, type: PeoplesEvent.Domesticated as EventType, settlement: at, other: -1, value: s })
      }
    }
    const done = new Uint8Array(P)
    for (let it = 0; it < P; it++) {
      let p = -1
      for (let q = 0; q < P; q++) if (!done[q] && tent[q] < Infinity && (p < 0 || tent[q] < tent[p])) p = q
      if (p < 0) break
      done[p] = 1
      Y[p * S + s] = Math.round(tent[p])
      Src[p * S + s] = from[p]
      for (let q = 0; q < P; q++) {
        const met = C[p * P + q]
        if (done[q] || q === p || met < 0) continue
        if (fitOf(world, fcell(q), k) < 0.16) continue // its homeland does not suit it
        const y = Math.max(tent[p], met) + 25 + hashf(s, p * 31 + q, 13) * 110
        if (y > h.years) continue
        if (y < tent[q]) { tent[q] = y; from[q] = p }
      }
    }
    for (let q = 0; q < P; q++) {
      const src = Src[q * S + s], y = Y[q * S + s]
      if (src < 0 || y < 0) continue
      const at = largestOf(h, pd, q, y), by = largestOf(h, pd, src, y)
      if (at >= 0 && by >= 0) added.push({ year: y, type: PeoplesEvent.SpeciesAdopted as EventType, settlement: at, other: by, value: s })
    }
  }
  // epidemics: the first contact across cradles often brings a sickness new to the smaller people (one each at most)
  const struck = new Uint8Array(P)
  for (let a = 0; a < P; a++) {
    for (let b = a + 1; b < P; b++) {
      const met = C[a * P + b]
      if (met <= 0 || (cradle(a) === cradle(b) && hashf(a, b, 21) > 0.25) || hashf(a, b, 22) > 0.6) continue
      const sn = Math.max(0, Math.min(h.snapshotCount - 1, Math.round(met / h.snapshotInterval)))
      const victim = pd.population[sn * P + a] < pd.population[sn * P + b] ? a : b
      if (struck[victim]) continue
      struck[victim] = 1
      const y = Math.min(h.years, met + 2 + Math.floor(hashf(a, b, 23) * 10))
      const at = largestOf(h, pd, victim, y), by = largestOf(h, pd, victim === a ? b : a, y)
      if (at >= 0 && by >= 0) added.push({ year: y, type: PeoplesEvent.Epidemic as EventType, settlement: at, other: by, value: 0.1 + hashf(a, b, 24) * 0.25 })
    }
  }
  // crop and herd layers: per land snapshot, each farmed cell grows the best-suited staple its nearest settlement's people holds
  const L = h.landSnapshotCount ?? 0
  const LI = h.landInterval ?? 20
  const U = (h as Partial<History>).landUse
  const crop = new Uint8Array(Math.max(0, L) * N)
  const herd = new Uint8Array(Math.max(0, L) * N)
  if (U instanceof Uint8Array && U.length >= L * N) {
    const { neighborOffsets: off, neighbors: nb } = world.grid
    const owner = new Int32Array(N)
    const depth = new Int8Array(N)
    const queue = new Int32Array(N)
    const fits = new Float32Array(N * S)
    for (let c = 0; c < N; c++) if (world.elevation[c] >= 0) for (let s = 0; s < S; s++) fits[c * S + s] = fitOf(world, c, STAND_IN_SPECIES[s]) * (0.85 + 0.3 * hashf(c, s, 31))
    for (let l = 0; l < L; l++) {
      const year = l * LI
      const sn = Math.max(0, Math.min(h.snapshotCount - 1, Math.round(year / h.snapshotInterval)))
      owner.fill(-1)
      let tail = 0
      for (let i = 0; i < NS; i++) {
        if (h.population[sn * NS + i] <= 0 || (h.settlements[i] as { outpost?: boolean }).outpost === true) continue
        const c = h.settlements[i].cell
        if (owner[c] >= 0) continue
        owner[c] = pd.people[i]
        depth[c] = 0
        queue[tail++] = c
      }
      for (let head = 0; head < tail; head++) {
        const c = queue[head]
        if (depth[c] >= 6) continue
        for (let k = off[c]; k < off[c + 1]; k++) {
          const j = nb[k]
          if (owner[j] >= 0 || world.elevation[j] < 0) continue
          owner[j] = owner[c]
          depth[j] = depth[c] + 1
          queue[tail++] = j
        }
      }
      for (let c = 0; c < N; c++) {
        const u = U[l * N + c]
        const p = owner[c]
        if (p < 0 || u < 12) continue
        let bc = -1, bh = -1, fc = 0.04, fh = 0.04
        for (let s = 0; s < S; s++) {
          const y = Y[p * S + s]
          if (y < 0 || y > year) continue
          const v = fits[c * S + s]
          if (STAND_IN_SPECIES[s].c === 0) { if (u >= 30 && v > fc) { fc = v; bc = s } } else if (v > fh) { fh = v; bh = s }
        }
        crop[l * N + c] = bc + 1
        herd[l * N + c] = bh + 1
      }
    }
  }
  const hw = h as unknown as Record<string, unknown>
  hw.species = species
  hw.speciesYear = Y
  hw.speciesSource = Src
  hw.crop = crop
  hw.herd = herd
  const kept = h.events.filter((e) => (e.type as number) < PeoplesEvent.Domesticated || (e.type as number) > PeoplesEvent.Epidemic)
  h.events = [...kept, ...added].sort((a, b) => a.year - b.year)
  return true
}
