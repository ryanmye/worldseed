// Ideas of a History (contract: History.ideas, History.ideaAdoptions, events 120-123), indexed for the UI: per idea its rows
// (conceptions, adoptions and losses, in order) with the holders after each, per people its rows, per settlement the rows that
// entered or went out there, the refusals and the causes of losses (from the events), and for each adoption whether it was the
// idea's first arrival in a network of peoples that had been cut off from every holder (a chronicle headline). Built once per
// history (ideasOf caches it); a history without ideas (older histories, or `ideas: false`) gives null and the UI shows nothing.
//
// Everything at a year is a binary search or a short walk over a people's rows: the panels key their DOM writes on rowsUpTo (the
// number of rows and refusals by the year), which only moves when the year crosses one.

import { EventType, IdeaHow, type History, type IdeaAdoptions, type IdeaInfo } from '../contract.ts'
import { IDEA_DEFS } from '../sim/history/ideas/params.ts'

/** Short words for each IdeaHow (pips' titles, the journey list). */
export const HOW_SHORT: readonly string[] = ['conceived', 'contact', 'neighbours', 'trade', 'long-haul lane', 'trading post', 'migrants', 'conquest', 'empire', 'pilgrims', 'visitors', 'royal marriage', 'theft', 'lost']

/** Colour of each IdeaHow (sRGB 0..1): the channel's pip, ribbon and arrival pulse. Conceived gold; trade amber and the lanes cyan (as their own layers); conquest red. */
export const HOW_RGB: readonly (readonly [number, number, number])[] = [
  [1.0, 0.82, 0.36], // invented: gold
  [0.72, 0.77, 0.86], // contact: pale slate
  [0.56, 0.83, 0.42], // neighbours: green
  [0.95, 0.63, 0.29], // trade: amber
  [0.29, 0.78, 0.9], // lane: cyan
  [0.25, 0.72, 0.64], // post: teal
  [0.85, 0.71, 0.54], // migration: tan
  [0.89, 0.34, 0.3], // conquest: red
  [0.66, 0.55, 0.94], // empire: violet
  [0.95, 0.89, 0.69], // pilgrims: parchment
  [1.0, 0.5, 0.74], // visitors: pink (as the Travel layer)
  [1.0, 0.62, 0.5], // marriage: coral
  [0.69, 0.72, 0.42], // theft: olive
  [0.5, 0.5, 0.52], // lost: grey
]
export const HOW_CSS: readonly string[] = HOW_RGB.map((c) => `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`)

/** Eras of the catalogue (IdeaDef.era), as the panel groups it. */
export const ERA_LABELS: readonly string[] = ['The first villages', 'The first towns', 'The first states', 'The high middle ages', 'The early modern centuries']

/** Kind words (IdeaKind order). */
export const KIND_WORDS: readonly string[] = ['farming', 'crafts', 'transport', 'seafaring', 'war', 'rule', 'learning', 'health']
/** Kind colours (IdeaKind order): the dot before an idea's name. */
export const KIND_CSS: readonly string[] = ['#9fd36b', '#e0b070', '#d9c48a', '#5ec4e6', '#e36b5c', '#b49af0', '#f2e6b4', '#7fe0c4']

/** Years before an adoption whose network is compared with the holders' (a people met within this span counts as newly joined). */
const NETWORK_LEAD = 25

export interface IdeasData {
  history: History
  /** Ideas, peoples, settlements, rows. */
  I: number
  P: number
  N: number
  R: number
  ideas: IdeaInfo[]
  A: IdeaAdoptions
  /** Era 0..4 and technology caps (Farming, Seafaring, Metalworking, Crafts) per idea, from the catalogue (era 0 and no caps for an unknown key). */
  era: Uint8Array
  caps: Float32Array
  /** Rows per idea (CSR, chronological), their years, and the number of peoples holding the idea after each. */
  ideaOff: Uint32Array
  ideaRows: Int32Array
  ideaRowYear: Float64Array
  holdersAfter: Int16Array
  /** Rows per people (CSR, chronological). */
  peopleOff: Uint32Array
  peopleRows: Int32Array
  /** Rows whose entry (or conception, or loss) settlement is a settlement, and rows that came from it. */
  viaRows: Map<number, number[]>
  sourceRows: Map<number, number[]>
  /** Per row: 1 when it is the idea's first arrival in a network of peoples cut off from every holder until lately. */
  netFirst: Uint8Array
  /** Per row: the network (lowest people id) of its people NETWORK_LEAD years before, -1 for conceptions and losses. */
  netOf: Int32Array
  /** Loss cause (IdeaLoss) per row (-1 not a loss or unknown). */
  lossCause: Int8Array
  /** Refusals (IdeaResisted events), chronological. */
  refusals: Refusal[]
  /** Years of every row and refusal, sorted: rowsUpTo counts them. */
  changeYears: Float64Array
  /** Years of the conceptions (rows with how Invented), sorted. */
  conceptionYears: Float64Array
  /** First year a people held each idea, [p * I + i] (-1 never). */
  firstHeld: Int16Array
  /** Row of an event (adoption, conception or loss) by key (eventKey), and the refusal of an IdeaResisted event. */
  rowOfKey: Map<number, number>
  refusalOfEvent: Map<number, number>
  /** Latest row year (for the time ramp's end) per idea, -1 none. */
  lastYear: Int16Array
}

export interface Refusal {
  year: number
  idea: number
  people: number
  /** Its capital or largest settlement, and the settlement the idea had reached it from (-1). */
  settlement: number
  from: number
  /** IdeaResist. */
  cause: number
  event: number
}

const cache = new WeakMap<History, IdeasData | null>()

/** The ideas data of a history, or null when it has none (cached). */
export function ideasOf(h: History | null | undefined): IdeasData | null {
  if (!h) return null
  if (cache.has(h)) return cache.get(h) ?? null
  let d: IdeasData | null = null
  try {
    d = buildIdeasData(h)
  } catch (err) {
    console.warn('ideas: data unusable, hidden', err)
    d = null
  }
  cache.set(h, d)
  return d
}

/** Key of a row for its events: idea, people, year, and whether it is a loss. */
const rowKey = (idea: number, people: number, year: number, lost: boolean) => ((idea * 8192 + people) * 16384 + year + 4096) * 2 + (lost ? 1 : 0)

/** The ideas-table row of an IdeaConceived / IdeaAdopted / IdeaLost event, or -1. */
export function rowOfEvent(dd: IdeasData, e: { type: number; settlement: number; value: number; year: number }): number {
  const t = e.type as number
  if (t !== EventType.IdeaConceived && t !== EventType.IdeaAdopted && t !== EventType.IdeaLost) return -1
  const s = dd.history.settlements[e.settlement]
  if (!s) return -1
  return dd.rowOfKey.get(rowKey(e.value, s.people, e.year, t === EventType.IdeaLost)) ?? -1
}

function buildIdeasData(h: History): IdeasData | null {
  const p = h as Partial<History>
  const ideas = Array.isArray(p.ideas) ? p.ideas : []
  const A = p.ideaAdoptions
  if (!ideas.length || !A || !(A.count > 0) || !A.idea || A.idea.length < A.count || !A.people || !A.year || !A.how || !A.from || !A.via || !A.source) return null
  const I = ideas.length
  const P = h.peoples.length
  const N = h.settlements.length
  const R = A.count
  for (let k = 0; k < R; k++) if (A.idea[k] >= I || A.people[k] < 0 || A.people[k] >= P || (k > 0 && A.year[k] < A.year[k - 1])) {
    console.warn('ideas: adoption rows out of range or order; ideas hidden')
    return null
  }
  // the catalogue's era and caps (the same in every world; by key, so a renumbered catalogue still reads)
  const defs = new Map(IDEA_DEFS.map((d) => [d.key, d]))
  const era = new Uint8Array(I), caps = new Float32Array(I * 4)
  for (let i = 0; i < I; i++) {
    const d = defs.get(ideas[i].key)
    if (!d) continue
    era[i] = d.era
    for (let f = 0; f < 4; f++) caps[i * 4 + f] = d.caps[f] ?? 0
  }
  // CSR per idea and per people
  const csr = (n: number, of: (k: number) => number) => {
    const off = new Uint32Array(n + 1)
    for (let k = 0; k < R; k++) off[of(k) + 1]++
    for (let i = 0; i < n; i++) off[i + 1] += off[i]
    const cur = off.slice(0, n)
    const rows = new Int32Array(R)
    for (let k = 0; k < R; k++) rows[cur[of(k)]++] = k
    return { off, rows }
  }
  const byIdea = csr(I, (k) => A.idea[k])
  const byPeople = csr(P, (k) => A.people[k])
  const ideaRowYear = Float64Array.from(byIdea.rows, (k) => A.year[k])
  // holders after each row (in idea order)
  const holdersAfter = new Int16Array(R)
  const lastYear = new Int16Array(I).fill(-1)
  {
    const holds = new Uint8Array(P)
    for (let i = 0; i < I; i++) {
      holds.fill(0)
      let n = 0
      for (let j = byIdea.off[i]; j < byIdea.off[i + 1]; j++) {
        const k = byIdea.rows[j]
        const q = A.people[k]
        if (A.how[k] === IdeaHow.Lost) {
          if (holds[q]) n--
          holds[q] = 0
        } else {
          if (!holds[q]) n++
          holds[q] = 1
        }
        holdersAfter[j] = n
        lastYear[i] = A.year[k]
      }
    }
  }
  const firstHeld = new Int16Array(P * I).fill(-1)
  for (let k = 0; k < R; k++) {
    const o = A.people[k] * I + A.idea[k]
    if (A.how[k] !== IdeaHow.Lost && firstHeld[o] < 0) firstHeld[o] = A.year[k]
  }
  const viaRows = new Map<number, number[]>(), sourceRows = new Map<number, number[]>()
  const push = (m: Map<number, number[]>, key: number, k: number) => {
    if (key < 0 || key >= N) return
    const a = m.get(key)
    if (a) a.push(k)
    else m.set(key, [k])
  }
  const rowOfKey = new Map<number, number>()
  for (let k = 0; k < R; k++) {
    push(viaRows, A.via[k], k)
    if (A.how[k] !== IdeaHow.Invented && A.how[k] !== IdeaHow.Lost) push(sourceRows, A.source[k], k)
    const key = rowKey(A.idea[k], A.people[k], A.year[k], A.how[k] === IdeaHow.Lost)
    if (!rowOfKey.has(key)) rowOfKey.set(key, k)
  }
  // networks of peoples NETWORK_LEAD years before each adoption (contacts made by then), cached per year
  const C = p.contactYear instanceof Int16Array && p.contactYear.length >= P * P ? p.contactYear : null
  const labelsAt = new Map<number, Int32Array>()
  const lab = (year: number): Int32Array => {
    const hit = labelsAt.get(year)
    if (hit) return hit
    const L = new Int32Array(P)
    for (let q = 0; q < P; q++) L[q] = q
    const find = (x: number): number => {
      while (L[x] !== x) x = L[x] = L[L[x]]
      return x
    }
    if (C) for (let a = 0; a < P; a++) for (let b = a + 1; b < P; b++) {
      const y = C[a * P + b]
      if (y < 0 || y > year) continue
      const ra = find(a), rb = find(b)
      if (ra !== rb) {
        if (ra < rb) L[rb] = ra
        else L[ra] = rb
      }
    }
    for (let q = 0; q < P; q++) L[q] = find(q)
    labelsAt.set(year, L)
    return L
  }
  const netFirst = new Uint8Array(R)
  const netOf = new Int32Array(R).fill(-1)
  if (C) {
    for (let k = 0; k < R; k++) {
      const how = A.how[k]
      if (how === IdeaHow.Invented || how === IdeaHow.Lost) continue
      const y = A.year[k], i = A.idea[k], q = A.people[k]
      const L = lab(y - NETWORK_LEAD)
      const net = L[q]
      netOf[k] = net
      const f = A.from[k]
      if (f >= 0 && f < P && L[f] === net) continue
      let any = false
      for (let r = 0; r < P && !any; r++) if (L[r] === net && firstHeld[r * I + i] >= 0 && firstHeld[r * I + i] < y) any = true
      if (!any) netFirst[k] = 1
    }
  }
  // causes of losses and the refusals, from the events
  const lossCause = new Int8Array(R).fill(-1)
  const refusals: Refusal[] = []
  const refusalOfEvent = new Map<number, number>()
  h.events.forEach((e, ei) => {
    const t = e.type as number
    if (t === EventType.IdeaLost) {
      const s = h.settlements[e.settlement]
      const k = s ? rowOfKey.get(rowKey(e.value, s.people, e.year, true)) : undefined
      if (k !== undefined) lossCause[k] = e.extra ?? -1
    } else if (t === EventType.IdeaResisted) {
      const s = h.settlements[e.settlement]
      if (!s || e.value < 0 || e.value >= I) return
      refusalOfEvent.set(ei, refusals.length)
      refusals.push({ year: e.year, idea: e.value, people: s.people, settlement: e.settlement, from: e.other, cause: e.extra ?? 0, event: ei })
    }
  })
  refusals.sort((a, b) => a.year - b.year || a.event - b.event)
  refusals.forEach((x, j) => refusalOfEvent.set(x.event, j))
  const changeYears = new Float64Array(R + refusals.length)
  for (let k = 0; k < R; k++) changeYears[k] = A.year[k]
  refusals.forEach((x, j) => (changeYears[R + j] = x.year))
  changeYears.sort()
  const cy: number[] = []
  for (let k = 0; k < R; k++) if (A.how[k] === IdeaHow.Invented) cy.push(A.year[k])
  return {
    history: h, I, P, N, R, ideas, A, era, caps,
    ideaOff: byIdea.off, ideaRows: byIdea.rows, ideaRowYear, holdersAfter, peopleOff: byPeople.off, peopleRows: byPeople.rows,
    viaRows, sourceRows, netFirst, netOf, lossCause, refusals, changeYears, conceptionYears: Float64Array.from(cy), firstHeld, rowOfKey, refusalOfEvent, lastYear,
  }
}

/** Entries of the sorted `a` that are <= year. */
export function upTo(a: Float64Array, year: number, lo = 0, hi = a.length): number {
  let x = lo, y = hi
  while (x < y) {
    const m = (x + y) >>> 1
    if (a[m] <= year) x = m + 1
    else y = m
  }
  return x - lo
}

/** Rows and refusals by the year (the panels' key: it moves only when the year crosses one). */
export const rowsUpTo = (dd: IdeasData, year: number) => upTo(dd.changeYears, Math.floor(year + 1e-6))

/** Whether idea i has been conceived by anyone by the year. */
export const isKnown = (dd: IdeasData, i: number, year: number) => {
  const f = dd.ideas[i].firstYear
  return f >= 0 && f <= Math.floor(year + 1e-6)
}

/** Ideas conceived by anyone by the year. */
export function knownCount(dd: IdeasData, year: number): number {
  let n = 0
  for (let i = 0; i < dd.I; i++) if (isKnown(dd, i, year)) n++
  return n
}

/** The idea conceived last by the year (-1 none). */
export function latestKnown(dd: IdeasData, year: number): number {
  let best = -1
  for (let i = 0; i < dd.I; i++) if (isKnown(dd, i, year) && (best < 0 || dd.ideas[i].firstYear >= dd.ideas[best].firstYear)) best = i
  return best
}

/** Peoples holding idea i at the year. */
export function holdersAt(dd: IdeasData, i: number, year: number): number {
  const lo = dd.ideaOff[i], hi = dd.ideaOff[i + 1]
  const n = upTo(dd.ideaRowYear, Math.floor(year + 1e-6), lo, hi)
  return n > 0 ? dd.holdersAfter[lo + n - 1] : 0
}

/** Rows of idea i by the year (chronological). */
export function ideaRowsUpTo(dd: IdeasData, i: number, year: number): number {
  return upTo(dd.ideaRowYear, Math.floor(year + 1e-6), dd.ideaOff[i], dd.ideaOff[i + 1])
}

/**
 * What people p holds at the year: out[i] = the row it came by (its latest adoption or conception), -1 not held, -2 lost
 * (held once, lost by then). Returns the number held.
 */
export function heldBy(dd: IdeasData, p: number, year: number, out: Int32Array): number {
  out.fill(-1)
  const y = Math.floor(year + 1e-6)
  const A = dd.A
  for (let j = dd.peopleOff[p]; j < dd.peopleOff[p + 1]; j++) {
    const k = dd.peopleRows[j]
    if (A.year[k] > y) break
    out[A.idea[k]] = A.how[k] === IdeaHow.Lost ? -2 : k
  }
  let n = 0
  for (let i = 0; i < dd.I; i++) if (out[i] >= 0) n++
  return n
}

/** Ideas people p holds at the year, and of them conceived by itself. */
export function heldCounts(dd: IdeasData, p: number, year: number, scratch: Int32Array): { held: number; own: number } {
  const held = heldBy(dd, p, year, scratch)
  let own = 0
  for (let i = 0; i < dd.I; i++) if (scratch[i] >= 0 && dd.A.how[scratch[i]] === IdeaHow.Invented) own++
  return { held, own }
}

/** Per people, the first year it took up (or conceived) idea i, -1 never; and the year it lost it after that (-1 never). */
export function adoptionYears(dd: IdeasData, i: number, outAdopt: Int16Array, outLost: Int16Array): void {
  outAdopt.fill(-1)
  outLost.fill(-1)
  const A = dd.A
  for (let j = dd.ideaOff[i]; j < dd.ideaOff[i + 1]; j++) {
    const k = dd.ideaRows[j]
    const q = A.people[k]
    if (A.how[k] === IdeaHow.Lost) {
      if (outLost[q] < 0) outLost[q] = A.year[k]
    } else if (outAdopt[q] < 0) outAdopt[q] = A.year[k]
    else if (outLost[q] >= 0) outLost[q] = -1 // taken up again after a loss: count it held from the first time (the gap is in the journey)
  }
}

/**
 * The idea behind a technology advance of people p in field f (TechField) at the year: of the ideas it took up in the 120 years
 * before with a real share in that field's cap, the one whose share weighs most against how long ago it came (half-life about 28
 * years), or -1.
 */
export function ideaBehindAdvance(dd: IdeasData, p: number, f: number, year: number): number {
  if (p < 0 || p >= dd.P || f < 0 || f > 3) return -1
  const A = dd.A
  let best = -1, bestScore = 0
  for (let j = dd.peopleOff[p]; j < dd.peopleOff[p + 1]; j++) {
    const k = dd.peopleRows[j]
    const y = A.year[k]
    if (y > year) break
    if (y < year - 120 || A.how[k] === IdeaHow.Lost) continue
    const c = dd.caps[A.idea[k] * 4 + f]
    if (c < 0.04) continue
    const score = c * Math.exp(-(year - y) / 40)
    if (score > bestScore) {
      best = A.idea[k]
      bestScore = score
    }
  }
  return best
}
