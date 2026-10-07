// Per-history lookups about peoples: which people each settlement belongs to, a colour
// per people, what each people knows of the world (History.knownYear) and whom it has
// met (History.contactYear), and per-snapshot tallies of their settlements. Everything
// the UI shows at a year is a cheap function of that year (binary searches and array
// reads), so scrubbing in either direction is exact.
//
// All of it is optional at runtime: a history without valid `people`, `peoples`,
// `knownYear` or `contactYear` gets no PeoplesData and the features stay hidden.
//
// STAND_IN (the one switch below): for developing against histories that lack the fields,
// 'fallback' derives plausible values (people = root ancestor via `parent`; a people knows
// the cells within a few hops of its settlements from their founding, and the cells along
// its journeys and trade routes; two peoples meet when one first knows a living settlement
// of the other; contact shares knowledge; FirstContact events are synthesised) and
// 'force' does so even when the real fields are present. 'off' (the default) never does.

import { EventType, type History, type HistoryEvent, type World } from '../contract.ts'

type StandIn = 'off' | 'fallback' | 'force'
/** DEV STAND-IN SWITCH: 'off' in committed code (see the header). */
const STAND_IN = 'off' as StandIn

/** Selection value meaning "what any people knows" (the unexplored world is what nobody knows). */
export const ANYONE = -2
/** Year standing for "never" in per-cell and per-settlement year arrays. */
export const NEVER_YEAR = 1e9

export interface PeoplesData {
  /** Number of peoples. */
  count: number
  names: string[]
  /** Founder settlement of each people. */
  founder: Int32Array
  /** People of each settlement. */
  people: Int32Array
  /** Display colour per people: CSS hex, and sRGB 0..1 triplets (3 per people). */
  css: string[]
  rgb: Float32Array
  /** Year each people first knew each cell, -1 never: knownYear[p * cellCount + cell]. */
  knownYear: Int16Array
  /** Year each pair met, -1 never, diagonal 0: contactYear[a * count + b]. */
  contactYear: Int16Array
  cellCount: number
  landCellCount: number
  /** Per people (and, at index `count`, anyone): known years of land cells and of all cells, sorted ascending (never-known cells left out). */
  landSorted: Int16Array[]
  allSorted: Int16Array[]
  /** Living settlements (not counting expedition bases) and total population per snapshot per people: [s * count + p]. */
  alive: Uint32Array
  population: Float64Array
  /** The values were derived by the dev stand-in rather than read from the history. */
  standIn: boolean
}

/** Number of entries of the ascending `a` that are <= v. */
export function countAtMost(a: Int16Array, v: number): number {
  let lo = 0, hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (a[m] <= v) lo = m + 1
    else hi = m
  }
  return lo
}

/** Share of the land and of all cells known at `year` to people `p` (or ANYONE), each 0..1. */
export function knownShare(d: PeoplesData, p: number, year: number, out: { land: number; all: number }): { land: number; all: number } {
  const k = p === ANYONE ? d.count : p
  out.land = d.landCellCount > 0 ? countAtMost(d.landSorted[k], year) / d.landCellCount : 0
  out.all = d.cellCount > 0 ? countAtMost(d.allSorted[k], year) / d.cellCount : 0
  return out
}

/** Year people `a` met people `b` (0 for a === b), or -1. */
export function contactOf(d: PeoplesData, a: number, b: number): number {
  return d.contactYear[a * d.count + b]
}

/** Number of other peoples `p` has met by `year`. */
export function metCount(d: PeoplesData, p: number, year: number): number {
  let n = 0
  for (let b = 0; b < d.count; b++) {
    if (b === p) continue
    const y = d.contactYear[p * d.count + b]
    if (y >= 0 && y <= year) n++
  }
  return n
}

/** Per-cell year from which `sel` (a people or ANYONE) knows each cell, NEVER_YEAR if never, into `out` (length >= cellCount). */
export function cellKnownYears(d: PeoplesData, sel: number, out: Float32Array): Float32Array {
  const N = d.cellCount
  const K = d.knownYear
  if (sel === ANYONE) {
    out.fill(NEVER_YEAR, 0, N)
    for (let p = 0; p < d.count; p++) {
      const o = p * N
      for (let c = 0; c < N; c++) {
        const y = K[o + c]
        if (y >= 0 && y < out[c]) out[c] = y
      }
    }
  } else {
    const o = sel * N
    for (let c = 0; c < N; c++) {
      const y = K[o + c]
      out[c] = y >= 0 ? y : NEVER_YEAR
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// colours

/**
 * Mutually distinct hues bright enough for the dark globe that stay apart for the common
 * forms of colour blindness: the Okabe-Ito set (its blue and green lightened for the dark
 * background), then a lavender, a lime and a grey. Neighbouring peoples get the most
 * different ones (assignColours), and the order already alternates hue and lightness.
 */
const PALETTE = ['#e69f00', '#56b4e9', '#f0e442', '#cc79a7', '#2bb88a', '#4f8fdc', '#e3703a', '#b8a1ea', '#a6c94a', '#d9d9d9']

function hexRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

/** sRGB (0..1) to CIE Lab (D65). */
function lab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const R = lin(r), G = lin(g), B = lin(b)
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/**
 * A colour per people, stable for a world: peoples are coloured in id order, each taking the
 * unused palette colour that differs most from the colours of the peoples living nearest
 * it (by founder distance), so neighbours, who intermix most, are easiest to tell apart.
 * Past the palette's length colours repeat, darker.
 */
function assignColours(world: World, founderCells: number[]): { css: string[]; rgb: Float32Array } {
  const P = founderCells.length
  const pos = world.grid.positions
  const labs = PALETTE.map((h) => lab(hexRgb(h)))
  const pick: number[] = []
  const used = new Set<number>()
  for (let p = 0; p < P; p++) {
    if (used.size >= PALETTE.length) used.clear()
    let best = 0, bestCost = Infinity
    for (let c = 0; c < PALETTE.length; c++) {
      if (used.has(c)) continue
      if (c === PALETTE.length - 1 && used.size < PALETTE.length - 1) continue // the grey only when the hues run out
      let cost = 0
      for (let q = 0; q < p; q++) {
        const a = founderCells[p] * 3, b = founderCells[q] * 3
        const dot = pos[a] * pos[b] + pos[a + 1] * pos[b + 1] + pos[a + 2] * pos[b + 2]
        const near = Math.exp(-Math.acos(Math.max(-1, Math.min(1, dot))) / 0.35)
        const L1 = labs[c], L2 = labs[pick[q] % PALETTE.length]
        const de = Math.hypot(L1[0] - L2[0], L1[1] - L2[1], L1[2] - L2[2])
        cost = Math.max(cost, near / (de + 4))
      }
      if (cost < bestCost - 1e-12) {
        bestCost = cost
        best = c
      }
    }
    used.add(best)
    pick.push(best + PALETTE.length * Math.floor(p / PALETTE.length))
  }
  const css: string[] = []
  const rgb = new Float32Array(P * 3)
  for (let p = 0; p < P; p++) {
    const k = pick[p] % PALETTE.length
    const dim = Math.pow(0.74, Math.floor(pick[p] / PALETTE.length))
    const [r, g, b] = hexRgb(PALETTE[k])
    rgb[p * 3] = r * dim
    rgb[p * 3 + 1] = g * dim
    rgb[p * 3 + 2] = b * dim
    const h = (v: number) => Math.round(v * dim * 255).toString(16).padStart(2, '0')
    css.push(`#${h(r)}${h(g)}${h(b)}`)
  }
  return { css, rgb }
}

// ---------------------------------------------------------------------------
// building

interface Raw {
  names: string[]
  founder: number[]
  people: Int32Array
  knownYear: Int16Array
  contactYear: Int16Array
}

/** The history's own peoples fields, when present and consistent, else null. */
function readReal(h: History, N: number): Raw | null {
  const p = h as Partial<History>
  const peoples = p.peoples
  const K = p.knownYear
  const C = p.contactYear
  if (!Array.isArray(peoples) || peoples.length === 0 || !(K instanceof Int16Array) || !(C instanceof Int16Array)) return null
  const P = peoples.length
  if (K.length < P * N || C.length < P * P) return null
  const S = h.settlements.length
  const people = new Int32Array(S)
  for (let i = 0; i < S; i++) {
    const v = (h.settlements[i] as { people?: number }).people
    if (typeof v !== 'number' || !(v >= 0 && v < P)) return null
    people[i] = v
  }
  return {
    names: peoples.map((x, i) => (typeof x?.name === 'string' && x.name ? x.name : `People ${i + 1}`)),
    founder: peoples.map((x) => (typeof x?.founder === 'number' && x.founder >= 0 && x.founder < S ? x.founder : 0)),
    people,
    knownYear: K,
    contactYear: C,
  }
}

/**
 * DEV STAND-IN (see STAND_IN): plausible peoples, knowledge and contact derived from the
 * settlements, journeys and trade routes. Also appends FirstContact events to `h.events`
 * (a copy, kept in order) when the history has none.
 */
function deriveStandIn(world: World, h: History, N: number): Raw {
  const S = h.settlements.length
  const { neighborOffsets: off, neighbors: nb, positions: pos } = world.grid
  const people = new Int32Array(S).fill(-1)
  const founder: number[] = []
  for (let i = 0; i < S; i++) {
    const par = h.settlements[i].parent
    if (par >= 0 && par < i && people[par] >= 0) people[i] = people[par]
    else {
      people[i] = founder.length
      founder.push(i)
    }
  }
  const P = founder.length
  const K = new Int16Array(P * N).fill(-1)
  const learn = (p: number, c: number, y: number) => {
    const o = p * N + c
    const v = Math.max(0, Math.min(32767, Math.round(y)))
    if (K[o] < 0 || v < K[o]) K[o] = v
  }
  // sight: cells within a few hops of each settlement, from its founding
  const SIGHT = 4
  const stamp = new Int32Array(N).fill(-1)
  const queue = new Int32Array(N)
  const depth = new Int32Array(N)
  for (let i = 0; i < S; i++) {
    const s = h.settlements[i]
    let tail = 0
    queue[tail++] = s.cell
    stamp[s.cell] = i
    depth[s.cell] = 0
    for (let head = 0; head < tail; head++) {
      const c = queue[head]
      learn(people[i], c, s.foundedYear)
      if (depth[c] >= SIGHT) continue
      for (let k = off[c]; k < off[c + 1]; k++) {
        const n = nb[k]
        if (stamp[n] === i) continue
        stamp[n] = i
        depth[n] = depth[c] + 1
        queue[tail++] = n
      }
    }
  }
  // journeys and trade routes: the cells they pass
  const J = (h as Partial<History>).journeys
  if (J) {
    for (let j = 0; j < J.count; j++) {
      const from = J.from[j]
      if (from < 0 || from >= S) continue
      for (let k = J.pathOffsets[j]; k < J.pathOffsets[j + 1]; k++) learn(people[from], J.path[k], J.arriveYear[j])
    }
  }
  const T = (h as Partial<History>).trade
  if (T) {
    for (let r = 0; r < T.count; r++) {
      for (const end of [T.a[r], T.b[r]]) {
        if (end < 0 || end >= S) continue
        for (let k = T.pathOffsets[r]; k < T.pathOffsets[r + 1]; k++) learn(people[end], T.path[k], T.openedYear[r])
      }
    }
    // a way round danger: both ends' peoples learn it when the route takes it (History.trade's re-paths)
    for (let k = 0, n = T.repathCount ?? 0; k < n; k++) {
      const r = T.repathRoute[k]
      for (const end of [T.a[r], T.b[r]]) {
        if (end < 0 || end >= S) continue
        for (let q = T.repathOffsets[k]; q < T.repathOffsets[k + 1]; q++) learn(people[end], T.repathPath[q], T.repathYear[k])
      }
    }
  }
  // contact: when one first knows a living settlement of the other
  const C = new Int16Array(P * P).fill(-1)
  const via = new Int32Array(P * P * 2).fill(-1)
  for (let i = 0; i < S; i++) {
    const s = h.settlements[i]
    const b = people[i]
    for (let a = 0; a < P; a++) {
      if (a === b) continue
      const k = K[a * N + s.cell]
      if (k < 0) continue
      const y = Math.max(k, s.foundedYear)
      if (s.abandonedYear >= 0 && y >= s.abandonedYear) continue
      const lo = Math.min(a, b), hi = Math.max(a, b)
      const cur = C[lo * P + hi]
      if (cur < 0 || y < cur) {
        C[lo * P + hi] = C[hi * P + lo] = y
        via[(lo * P + hi) * 2] = i
        via[(lo * P + hi) * 2 + 1] = a
      }
    }
  }
  for (let p = 0; p < P; p++) C[p * P + p] = 0
  // peoples in contact share what they know (two rounds reach friends of friends)
  for (let round = 0; round < 2; round++) {
    for (let a = 0; a < P; a++) {
      for (let b = 0; b < P; b++) {
        const met = C[a * P + b]
        if (a === b || met < 0) continue
        for (let c = 0; c < N; c++) {
          const kb = K[b * N + c]
          if (kb >= 0) learn(a, c, Math.max(kb, met))
        }
      }
    }
  }
  // FirstContact events (if the history has none): through the settlement found, and the nearest living one of the finder
  if (!h.events.some((e) => e.type === EventType.FirstContact)) {
    const added: HistoryEvent[] = []
    for (let lo = 0; lo < P; lo++) {
      for (let hi = lo + 1; hi < P; hi++) {
        const y = C[lo * P + hi]
        if (y <= 0) continue
        const found = via[(lo * P + hi) * 2], finder = via[(lo * P + hi) * 2 + 1]
        if (found < 0) continue
        const fc = h.settlements[found].cell
        let near = -1, best = -2
        for (let i = 0; i < S; i++) {
          const s = h.settlements[i]
          if (people[i] !== finder || s.foundedYear > y || (s.abandonedYear >= 0 && s.abandonedYear <= y)) continue
          const d = pos[s.cell * 3] * pos[fc * 3] + pos[s.cell * 3 + 1] * pos[fc * 3 + 1] + pos[s.cell * 3 + 2] * pos[fc * 3 + 2]
          if (d > best) {
            best = d
            near = i
          }
        }
        if (near >= 0) added.push({ year: y, type: EventType.FirstContact, settlement: near, other: found, value: people[found] })
      }
    }
    if (added.length) h.events = [...h.events, ...added].sort((a, b) => a.year - b.year)
  }
  const names = founder.map((f) => (h.settlements[f].name || `People ${f}`).replace(/[aeiouy]+$/i, '') || `People ${f}`)
  return { names, founder, people, knownYear: K, contactYear: C }
}

/**
 * Peoples data for history `h` of `world`, or null when the history has none (and the stand-in
 * is off). With the stand-in on this may add FirstContact events to `h`: build it before the
 * history index that reads the events.
 */
export function buildPeoplesData(world: World, h: History, isWater: (cell: number) => boolean): PeoplesData | null {
  const N = world.grid.cellCount
  let raw: Raw | null = STAND_IN === 'force' ? null : readReal(h, N)
  let standIn = false
  if (!raw && STAND_IN !== 'off' && h.settlements.length > 0) {
    raw = deriveStandIn(world, h, N)
    standIn = true
  }
  if (!raw) return null
  const P = raw.names.length
  const S = h.settlements.length
  // known cells, sorted by year, per people and for anyone
  const isLand = new Uint8Array(N)
  let landCellCount = 0
  for (let c = 0; c < N; c++) if (!isWater(c)) { isLand[c] = 1; landCellCount++ }
  const landSorted: Int16Array[] = []
  const allSorted: Int16Array[] = []
  const anyone = new Int16Array(N).fill(-1)
  const collect = (row: (c: number) => number) => {
    let nl = 0, na = 0
    for (let c = 0; c < N; c++) if (row(c) >= 0) { na++; if (isLand[c]) nl++ }
    const land = new Int16Array(nl), all = new Int16Array(na)
    let il = 0, ia = 0
    for (let c = 0; c < N; c++) {
      const y = row(c)
      if (y < 0) continue
      all[ia++] = y
      if (isLand[c]) land[il++] = y
    }
    landSorted.push(land.sort())
    allSorted.push(all.sort())
  }
  for (let p = 0; p < P; p++) {
    const o = p * N
    collect((c) => raw.knownYear[o + c])
    for (let c = 0; c < N; c++) {
      const y = raw.knownYear[o + c]
      if (y >= 0 && (anyone[c] < 0 || y < anyone[c])) anyone[c] = y
    }
  }
  collect((c) => anyone[c])
  // settlements and people per snapshot per people
  const SN = h.snapshotCount
  const alive = new Uint32Array(SN * P)
  const population = new Float64Array(SN * P)
  const outpost = Uint8Array.from(h.settlements, (x) => ((x as { outpost?: boolean }).outpost === true ? 1 : 0))
  for (let s = 0; s < SN; s++) {
    const base = s * S
    for (let i = 0; i < S; i++) {
      const v = h.population[base + i]
      if (v > 0) {
        if (!outpost[i]) alive[s * P + raw.people[i]]++
        population[s * P + raw.people[i]] += v
      }
    }
  }
  const { css, rgb } = assignColours(world, raw.founder.map((f) => h.settlements[f]?.cell ?? 0))
  return {
    count: P,
    names: raw.names,
    founder: Int32Array.from(raw.founder),
    people: raw.people,
    css,
    rgb,
    knownYear: raw.knownYear,
    contactYear: raw.contactYear,
    cellCount: N,
    landCellCount,
    landSorted,
    allSorted,
    alive,
    population,
    standIn,
  }
}
