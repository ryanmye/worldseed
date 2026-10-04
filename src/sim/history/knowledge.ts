// Knowledge and contact: what each people knows of the world, and whom it has met.
//
// Every settlement belongs to a people (the descendants of one original tribe,
// state.found). A people knows a cell once one of its settlements has seen it,
// one of its journeys, voyages or trade routes has passed it, or a people it is
// in contact with has told it; knowledge is never lost (History.knownYear).
//
// Sight: a settlement sees the cells within a radius of a few hops over land,
// further along coasts and rivers and out to sea (much further over water from a
// port), the radius growing with its size and with its people's technology
// (Crafts and Seafaring; see sightRadius). It looks when founded and again whenever its radius
// has grown by KNOW.regrow hops or it built a port (checked every KNOW.sightStep
// years), so the cost is a bounded search per settlement now and then, not a
// recomputation of everything every year.
//
// Contact: two peoples meet when a settlement of one sees a settlement of the
// other (either way round: the new settlement sees an old one, or is founded on
// a cell an old one's sight covers), when a journey of one passes land settled
// by the other, when a colonising voyage of one lands after sighting their
// settlements (voyages.ts), or when a trade partner search links them
// (trade.ts). The first meeting of a pair is logged as FirstContact with
// the two settlements through which it happened. Peoples in contact form a
// network (the connected components of the contact graph). gradual-knowledge:
// at first contact each side learns only what the other knows near the
// meeting; afterwards what one people knows reaches each people it has met as
// a spreading front, fast between trading partners and slowly by bare contact
// (knowledgeSpread.ts). So contact is transitive only through sharing: A meets
// B, learns of C's lands from B (later than B did), and may sail there, which
// makes its own first contact with C.
//
// Decisions are limited by knowledge (migration.ts: groups move only through
// cells their people knows, and join only settlements of their own people or
// of peoples they are in contact with; trade.ts: partners are searched among
// known settlements; voyages.ts: expeditions explore at the edge, and what they
// see becomes known when they come home).
//
// Everything is deterministic (fixed orders, no randomness).

import { EventType, TECH_FIELD_COUNT, TechField } from '../../contract.ts'
import { smoothstep } from '../util.ts'
import { KNOW, SPECIES } from './params.ts'
import type { HistoryState } from './state.ts'
import { logEvent } from './state.ts'
import { hasHorse, speciesOnContact, speciesSight } from './species.ts'
import { createSpread, revealNear } from './knowledgeSpread.ts' // gradual-knowledge:
import type { SpreadState } from './knowledgeSpread.ts'

/** How a pair of peoples first met (Knowledge.via; for the stats harness). */
export const ContactVia = {
  Sight: 0, // a settlement saw one of the other's (or was founded where one of theirs could see it)
  Path: 1, // a journey passed their land
  Voyage: 2, // a colonising expedition sighted their settlements on its way and landed
  Trade: 3, // a trade partner search linked them
  Expedition: 4, // an exploring expedition (exploration.ts) passed their land, or an expedition base saw them
} as const
export type ContactVia = (typeof ContactVia)[keyof typeof ContactVia]

export interface Knowledge {
  /** Number of peoples and cells. */
  P: number
  N: number
  /** Year each people first knew each cell, -1 if not yet: known[p * N + cell] (becomes History.knownYear). */
  known: Int16Array
  /** Year each pair of peoples first met, -1 if not yet; symmetric, diagonal 0 (becomes History.contactYear). */
  contact: Int16Array
  /** How each pair first met (ContactVia), -1 if not yet: via[a * P + b], symmetric. */
  via: Int8Array
  /** 1 once a settlement of one people has seen a settlement of the other with its own eyes (neighbours), symmetric (technology.ts learns faster from neighbours). */
  near: Uint8Array
  /** Contact network per people: the smallest people id of its connected component. */
  net: Int32Array
  /** Cells each people learned since the last spread step (gradual-knowledge: they feed the fronts of knowledgeSpread.ts). */
  fresh: number[][]
  /** Last settlement whose sight covered each cell, or -1 (to tell when a new settlement is founded where an old one can see it). */
  seenFrom: Int32Array
  /** Radius of each settlement's last look, and whether it had a port then. */
  sightR: Float64Array
  sightPort: Uint8Array
  /** Static per-cell flags for sight costs: land next to open sea; river cells. */
  coastal: Uint8Array
  // Search buffers. Sight costs are whole tenths of a hop (steps: land, coast, river, shallow and
  // deep sea without a port, the same from a port), searched with a bucket queue over tenths.
  dist: Int32Array
  stamp: Int32Array
  run: number
  steps: Int32Array
  buckets: Int32Array[]
  bucketLen: Int32Array
  queue: Int32Array
  depth: Int32Array
  /** Plain hops of the margin around journeys and routes at this resolution. */
  marginHops: number
  /** gradual-knowledge: fronts of knowledge between peoples in contact (knowledgeSpread.ts). */
  spread: SpreadState
}

export function createKnowledge(s: HistoryState, P: number): Knowledge {
  const T = s.terrain
  const N = T.cellCount
  const contact = new Int16Array(P * P).fill(-1)
  for (let p = 0; p < P; p++) contact[p * P + p] = 0
  const net = new Int32Array(P)
  for (let p = 0; p < P; p++) net[p] = p
  const fresh: number[][] = []
  for (let p = 0; p < P; p++) fresh.push([])
  const K = KNOW
  const tenths = (x: number): number => Math.max(1, Math.round(10 * x * T.cellScale))
  const steps = Int32Array.from([K.land, K.coast, K.river, K.seaShallow, K.seaDeep, K.portShallow, K.portDeep].map(tenths))
  let maxStep = 0
  for (let i = 0; i < steps.length; i++) if (steps[i] > maxStep) maxStep = steps[i]
  const buckets: Int32Array[] = []
  for (let b = 0; b <= maxStep; b++) buckets.push(new Int32Array(32)) // more buckets than the dearest step: never wraps onto the one being emptied
  return {
    P, N,
    known: new Int16Array(P * N).fill(-1),
    contact, net, fresh,
    via: new Int8Array(P * P).fill(-1),
    near: new Uint8Array(P * P),
    seenFrom: new Int32Array(N).fill(-1),
    sightR: new Float64Array(256),
    sightPort: new Uint8Array(256),
    coastal: T.seaCoast,
    dist: new Int32Array(N),
    stamp: new Int32Array(N),
    run: 0,
    steps, buckets,
    bucketLen: new Int32Array(buckets.length),
    queue: new Int32Array(N),
    depth: new Int32Array(N),
    marginHops: Math.max(1, Math.round((KNOW.margin * T.n) / 48)),
    spread: createSpread(P, N, T.n), // gradual-knowledge:
  }
}

/** Grows the per-settlement buffers to cover `count` settlements. */
function ensureSettlements(k: Knowledge, count: number): void {
  if (count <= k.sightR.length) return
  let size = k.sightR.length
  while (size < count) size *= 2
  const r = new Float64Array(size); r.set(k.sightR); k.sightR = r
  const p = new Uint8Array(size); p.set(k.sightPort); k.sightPort = p
}

/** True when people p knows cell c. */
export function knows(s: HistoryState, p: number, c: number): boolean {
  return s.know.known[p * s.know.N + c] >= 0
}

/** True when peoples a and b are the same or have met. */
export function inContact(s: HistoryState, a: number, b: number): boolean {
  return a === b || s.know.contact[a * s.know.P + b] >= 0
}

/** People p learns cell c this year (for itself: it is shared with its network later). */
export function learn(s: HistoryState, p: number, c: number): void {
  const k = s.know
  const i = p * k.N + c
  if (k.known[i] >= 0) return
  k.known[i] = s.year
  k.fresh[p].push(c)
}

/**
 * Settlements a and b (of different peoples) meet this year: logs FirstContact the first time
 * their peoples meet, and merges their networks. gradual-knowledge: the two peoples learn what the
 * other knows near the meeting (knowledgeSpread.ts revealNear); the rest reaches them later.
 */
export function meet(s: HistoryState, a: number, b: number, how: ContactVia): void {
  const k = s.know
  const pa = s.people[a], pb = s.people[b]
  if (pa === pb || k.contact[pa * k.P + pb] >= 0) return
  k.contact[pa * k.P + pb] = s.year
  k.contact[pb * k.P + pa] = s.year
  k.via[pa * k.P + pb] = how
  k.via[pb * k.P + pa] = how
  logEvent(s, EventType.FirstContact, a, b, pb)
  speciesOnContact(s, a, b) // (a people with far heavier crowd diseases brings an epidemic)
  speciesSight(s, a, b) // (the two settlements through which they met can exchange species)
  revealNear(s, a, b) // gradual-knowledge: (was: both networks pooled everything they knew)
  const na = k.net[pa], nb = k.net[pb]
  if (na === nb) return // already in one network
  const lo = na < nb ? na : nb
  for (let p = 0; p < k.P; p++) if (k.net[p] === na || k.net[p] === nb) k.net[p] = lo
}

/** Settlements a and b of different peoples see each other: their peoples are neighbours. */
function neighbours(s: HistoryState, a: number, b: number): void {
  const k = s.know
  const pa = s.people[a], pb = s.people[b]
  k.near[pa * k.P + pb] = 1
  k.near[pb * k.P + pa] = 1
}

/**
 * Sight radius of settlement `id` in n = 48 hop units: grows with its size and with its people's technology
 * (the mean of Crafts and Seafaring: roads, towers, boats), and a little with horses; a look reaches whole tenths of it.
 */
export function sightRadius(s: HistoryState, id: number): number {
  const K = KNOW
  const o = s.people[id] * TECH_FIELD_COUNT
  const tech = 0.5 * (s.tech[o + TechField.Crafts] + s.tech[o + TechField.Seafaring])
  const horse = hasHorse(s, id) ? SPECIES.horseSight : 0
  return (K.sight + horse + K.sightSize * smoothstep(K.sizeLow, K.sizeHigh, s.pop[id])) * (1 + K.sightTech * (tech - 1))
}

/**
 * Settlement `id` looks around: every cell within its sight radius becomes known to its people,
 * and it meets any settlement of another people it sees.
 */
function look(s: HistoryState, id: number, radius: number): void {
  const k = s.know
  const T = s.terrain
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const riverTo = s.world.riverTo
  const steps = k.steps
  const port = s.port[id] >= 0
  const cLand = steps[0], cCoast = steps[1], cRiver = steps[2]
  const cShallow = port ? steps[5] : steps[3]
  const cDeep = port ? steps[6] : steps[4]
  const { dist, stamp, coastal, seenFrom, buckets, bucketLen } = k
  const sea = T.sea, deep = T.deep, river = T.river
  const p = s.people[id]
  const occupant = s.occupant, peopleOf = s.people
  const known = k.known
  const base = p * k.N
  const year = s.year
  const fresh = k.fresh[p]
  const how = s.outpost[id] ? ContactVia.Expedition : ContactVia.Sight // (an expedition base's lookouts)
  const run = ++k.run
  const origin = s.cell[id]
  const maxD = Math.floor(10 * radius + 1e-9)
  const B = buckets.length
  bucketLen.fill(0)
  buckets[0][0] = origin
  bucketLen[0] = 1
  let pending = 1
  stamp[origin] = run
  dist[origin] = 0
  for (let d = 0; pending > 0 && d <= maxD; d++) {
    const bk = d % B
    const items = buckets[bk]
    for (let i = 0; i < bucketLen[bk]; i++) {
      const c = items[i]
      pending--
      if (dist[c] !== d) continue // improved since it was queued
      if (known[base + c] < 0) { known[base + c] = year; fresh.push(c) }
      seenFrom[c] = id
      const o = occupant[c]
      if (o >= 0 && o !== id && peopleOf[o] !== p) { meet(s, id, o, how); neighbours(s, id, o); speciesSight(s, id, o) }
      const seaC = sea[c]
      for (let e = off[c]; e < off[c + 1]; e++) {
        const j = nb[e]
        let step: number
        if (sea[j]) step = deep[j] ? cDeep : cShallow
        else if (seaC) step = cShallow // landing back on a shore
        else if (river[c] && river[j] && (riverTo[c] === j || riverTo[j] === c)) step = cRiver
        else if (coastal[c] && coastal[j]) step = cCoast
        else step = cLand
        const nd = d + step
        if (nd > maxD || (stamp[j] === run && nd >= dist[j])) continue
        stamp[j] = run
        dist[j] = nd
        const nbk = nd % B
        let arr = buckets[nbk]
        if (bucketLen[nbk] === arr.length) {
          const g = new Int32Array(arr.length * 2)
          g.set(arr)
          buckets[nbk] = arr = g
        }
        arr[bucketLen[nbk]++] = j
        pending++
      }
    }
    bucketLen[bk] = 0
  }
}

/** A settlement was just founded (state.found): it is seen by whoever could see its cell, and looks around. */
export function onFounded(s: HistoryState, id: number): void {
  const k = s.know
  ensureSettlements(k, s.count)
  const c = s.cell[id]
  const w = k.seenFrom[c]
  if (w >= 0 && s.abandoned[w] < 0 && s.people[w] !== s.people[id]) { meet(s, w, id, s.outpost[w] || s.outpost[id] ? ContactVia.Expedition : ContactVia.Sight); neighbours(s, w, id); speciesSight(s, w, id) }
  const r = sightRadius(s, id)
  k.sightR[id] = r
  k.sightPort[id] = s.port[id] >= 0 ? 1 : 0
  look(s, id, r)
}

/**
 * People of settlement `via` learns a path (journey, voyage, trade route) and the cells within the
 * margin of it (KNOW.margin hops, or `hops` plain hops at this grid's resolution); with `meetAll`, it meets
 * the settlements of other peoples on or beside the path (first contact made `how`). Returns how many cells
 * it learned.
 */
export function learnPath(s: HistoryState, via: number, path: readonly number[], meetAll: boolean, hops = s.know.marginHops, how: ContactVia = ContactVia.Path): number {
  const k = s.know
  const p = s.people[via]
  const fresh0 = k.fresh[p].length
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const { queue, depth, stamp } = k
  const run = ++k.run
  let head = 0, tail = 0
  for (let i = 0; i < path.length; i++) {
    const c = path[i]
    if (stamp[c] === run) continue
    stamp[c] = run
    depth[c] = 0
    queue[tail++] = c
  }
  while (head < tail) {
    const c = queue[head++]
    learn(s, p, c)
    if (meetAll) {
      const o = s.occupant[c]
      if (o >= 0 && s.people[o] !== p) meet(s, via, o, how)
    }
    if (depth[c] >= hops) continue
    for (let e = off[c]; e < off[c + 1]; e++) {
      const j = nb[e]
      if (stamp[j] === run) continue
      stamp[j] = run
      depth[j] = depth[c] + 1
      queue[tail++] = j
    }
  }
  return k.fresh[p].length - fresh0
}

/** Settlement `id` looks again if its sight grew by KNOW.regrow hops or it built a port since its last look. */
function relook(s: HistoryState, id: number): void {
  const k = s.know
  const r = sightRadius(s, id)
  const port = s.port[id] >= 0 ? 1 : 0
  if (r < k.sightR[id] + KNOW.regrow && (port === 0 || k.sightPort[id] === 1)) return
  k.sightR[id] = r
  k.sightPort[id] = port
  look(s, id, r)
}

/** System (end of year): settlements and expedition bases look again as their sight grows (gradual-knowledge: sharing is knowledgeSpread.ts). */
export function knowledgeSystem(s: HistoryState): void {
  const K = KNOW
  const k = s.know
  if (s.year % K.sightStep === 0) {
    ensureSettlements(k, s.count)
    const living = s.living
    for (let t = 0; t < living.length; t++) relook(s, living[t])
    const outposts = s.outposts
    for (let t = 0; t < outposts.length; t++) relook(s, outposts[t])
  }
}
