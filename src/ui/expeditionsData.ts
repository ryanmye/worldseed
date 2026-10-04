// Per-history lookups about exploration: the expedition bases (Settlement.outpost) and the
// routes that supply them, the last points of lost expeditions, and where each Discovery
// event happened. Everything is a pure function of the history (and the world), built once
// per history; what the globe shows at a year is then a function of that year alone.
//
// A Discovery event carries no cell (and `value` is a feature id only when the place has a
// name), so the place is worked out from the expedition that made it: the Expedition
// journey from the same settlement arriving that year. The simulation logs the notable
// places an expedition reached first in a fixed order (north pole, south pole, the highest
// summit, the heart of the largest desert, then any landmass nobody had seen), each only
// once per world, so the same order and the same tests on the journey's cells recover
// which event is which: the pole is the journey's highest-latitude cell; a landmass is
// the farthest cell it reached on land other than its home's.

import { Biome, JourneyKind, type History, type HistoryEvent, type Journeys, type World } from '../contract.ts'
import { featureNoun, PeoplesEvent, setDiscoveryPlace, settlementName } from './format.ts'
import { withEventNames } from './renamingData.ts'

/** What a discovery was. */
export const DiscoveryKind = { NorthPole: 0, SouthPole: 1, Summit: 2, Desert: 3, Land: 4, Feature: 5 } as const
export type DiscoveryKind = (typeof DiscoveryKind)[keyof typeof DiscoveryKind]

export interface Discovery {
  year: number
  cell: number
  kind: DiscoveryKind
  /** Settlement whose expedition got there. */
  sender: number
  /** "the north pole", "the heart of the great desert", "the island Oru". */
  place: string
}

export interface ExpeditionData {
  /** Settlement ids of the expedition bases, in founding order. */
  outposts: Int32Array
  /** Per base (index into outposts): the cells of its supply route from its parent's cell to its own (CSR). */
  routeOffsets: Uint32Array
  routeCells: Int32Array
  /** Last point and year of each lost expedition, and its sender. */
  lostCell: Int32Array
  lostYear: Float32Array
  lostFrom: Int32Array
  discoveries: Discovery[]
  /** Discoveries by cell (for readouts): cell -> indices into discoveries. */
  discoveryAt: Map<number, number[]>
}

/** Latitude (unit-sphere y) beyond which a cell counts as at a pole, as in the simulation. */
const POLE_Y = 0.995

function placeName(kind: DiscoveryKind): string {
  switch (kind) {
    case DiscoveryKind.NorthPole: return 'the north pole'
    case DiscoveryKind.SouthPole: return 'the south pole'
    case DiscoveryKind.Summit: return 'the highest summit in the world'
    case DiscoveryKind.Desert: return 'the heart of the great desert'
    default: return 'an unsettled land'
  }
}

/** The highest land cell and the heart of the largest desert (the cell farthest in from its edge), as the simulation finds them. */
function landmarks(world: World): { summit: number; desertHeart: number } {
  const N = world.grid.cellCount
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const sea = (i: number) => world.elevation[i] < 0
  let summit = -1
  for (let i = 0; i < N; i++) if (!sea(i) && !world.lake[i] && (summit < 0 || world.elevation[i] > world.elevation[summit])) summit = i
  const comp = new Int32Array(N).fill(-1)
  const queue = new Int32Array(N)
  let bestComp = -1, bestSize = 0
  for (let i = 0; i < N; i++) {
    if (comp[i] >= 0 || sea(i) || world.biome[i] !== Biome.Desert) continue
    let head = 0, tail = 0
    queue[tail++] = i
    comp[i] = i
    while (head < tail) {
      const c = queue[head++]
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (comp[j] < 0 && !sea(j) && world.biome[j] === Biome.Desert) { comp[j] = i; queue[tail++] = j }
      }
    }
    if (tail > bestSize) { bestSize = tail; bestComp = i }
  }
  let desertHeart = -1
  if (bestComp >= 0) {
    const depth = new Int32Array(N).fill(-1)
    let head = 0, tail = 0
    for (let i = 0; i < N; i++) {
      if (comp[i] !== bestComp) continue
      let edge = false
      for (let k = off[i]; k < off[i + 1]; k++) if (comp[nb[k]] !== bestComp) edge = true
      if (edge) { depth[i] = 0; queue[tail++] = i }
    }
    while (head < tail) {
      const c = queue[head++]
      if (desertHeart < 0 || depth[c] > depth[desertHeart]) desertHeart = c
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (comp[j] === bestComp && depth[j] < 0) { depth[j] = depth[c] + 1; queue[tail++] = j }
      }
    }
  }
  return { summit, desertHeart }
}

/** Landmass id per cell (connected land, lakes included), -1 for sea. */
function landmassIds(world: World): Int32Array {
  const N = world.grid.cellCount
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const id = new Int32Array(N).fill(-1)
  const queue = new Int32Array(N)
  let next = 0
  for (let i = 0; i < N; i++) {
    if (id[i] >= 0 || world.elevation[i] < 0) continue
    let head = 0, tail = 0
    queue[tail++] = i
    id[i] = next
    while (head < tail) {
      const c = queue[head++]
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (id[j] < 0 && world.elevation[j] >= 0) { id[j] = next; queue[tail++] = j }
      }
    }
    next++
  }
  return id
}

/** Where an expedition base stands, for its inspector: "on the southern ice", "in the desert". */
export function describeOutpostSite(world: World, cell: number): string {
  const y = world.grid.positions[cell * 3 + 1]
  const hemi = y < 0 ? 'southern' : 'northern'
  const { neighborOffsets: off, neighbors: nb } = world.grid
  let coast = false
  for (let k = off[cell]; k < off[cell + 1]; k++) if (world.elevation[nb[k]] < 0) coast = true
  switch (world.biome[cell]) {
    case Biome.Ice: return Math.abs(y) > 0.8 ? `on the ${hemi} ice` : 'on a glacier'
    case Biome.Tundra: return coast ? `on a ${hemi} polar coast` : `on the ${hemi} tundra`
    case Biome.Desert: return coast ? 'on a desert coast' : 'in the desert'
    case Biome.Mountain: return 'in the mountains'
    case Biome.Taiga: return `in the ${hemi} forests`
    default: return coast ? 'on a remote coast' : 'in the wilds'
  }
}

/** Expedition data for history `h`; `J` is the history's journeys (expeditions are never thinned), or null. */
export function buildExpeditionData(world: World, h: History, J: Journeys | null): ExpeditionData {
  const S = h.settlements.length
  const P = world.grid.positions
  const outposts: number[] = []
  for (let i = 0; i < S; i++) if ((h.settlements[i] as { outpost?: boolean }).outpost === true) outposts.push(i)

  // each base's founding expedition (its journey runs from the parent to the base)
  const journeyOf = new Map<number, number>()
  const lostCell: number[] = [], lostYear: number[] = [], lostFrom: number[] = []
  /** Expedition journeys by (sender, arrival year), for the discoveries. */
  const byArrival = new Map<string, number>()
  if (J) {
    for (let j = 0; j < J.count; j++) {
      if (J.kind[j] !== JourneyKind.Expedition) continue
      const a = J.pathOffsets[j], b = J.pathOffsets[j + 1]
      if (b <= a) continue
      if (J.to[j] < 0) {
        lostCell.push(J.path[b - 1])
        lostYear.push(J.arriveYear[j])
        lostFrom.push(J.from[j])
      } else if (J.to[j] !== J.from[j]) journeyOf.set(J.to[j], j)
      byArrival.set(J.from[j] + ':' + Math.round(J.arriveYear[j]), j)
    }
  }
  const routeOffsets = new Uint32Array(outposts.length + 1)
  const route: number[] = []
  outposts.forEach((id, k) => {
    const j = journeyOf.get(id)
    const s = h.settlements[id]
    if (J && j !== undefined) for (let q = J.pathOffsets[j]; q < J.pathOffsets[j + 1]; q++) route.push(J.path[q])
    else {
      if (s.parent >= 0 && s.parent < S) route.push(h.settlements[s.parent].cell)
      route.push(s.cell)
    }
    routeOffsets[k + 1] = route.length
  })

  // ---- discoveries ----
  const discoveries: Discovery[] = []
  const evs = h.events
  const { summit, desertHeart } = landmarks(world)
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const near = (c: number, target: number) => {
    if (target < 0) return false
    if (c === target) return true
    for (let k = off[target]; k < off[target + 1]; k++) if (nb[k] === c) return true
    return false
  }
  let lm: Int32Array | null = null
  const reached = new Uint8Array(4)
  const features = (h as Partial<History>).features
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i]
    if ((e.type as number) !== PeoplesEvent.Discovery) continue
    // the events of one expedition come together: the same sender and year
    const group: HistoryEvent[] = [e]
    while (i + 1 < evs.length && (evs[i + 1].type as number) === PeoplesEvent.Discovery && evs[i + 1].settlement === e.settlement && evs[i + 1].year === e.year) group.push(evs[++i])
    const j = J ? byArrival.get(e.settlement + ':' + e.year) : undefined
    const home = e.settlement >= 0 && e.settlement < S ? h.settlements[e.settlement].cell : -1
    const cells: number[] = []
    if (J && j !== undefined) for (let q = J.pathOffsets[j]; q < J.pathOffsets[j + 1]; q++) cells.push(J.path[q])
    // the candidates, in the simulation's order
    const cand: { kind: DiscoveryKind; cell: number }[] = []
    if (cells.length) {
      let north = -1, south = -1
      for (const c of cells) {
        const y = P[c * 3 + 1]
        if (y >= POLE_Y && (north < 0 || y > P[north * 3 + 1])) north = c
        if (y <= -POLE_Y && (south < 0 || y < P[south * 3 + 1])) south = c
      }
      if (north >= 0 && !reached[0]) cand.push({ kind: DiscoveryKind.NorthPole, cell: north })
      if (south >= 0 && !reached[1]) cand.push({ kind: DiscoveryKind.SouthPole, cell: south })
      if (!reached[2] && cells.some((c) => near(c, summit))) cand.push({ kind: DiscoveryKind.Summit, cell: summit })
      if (!reached[3] && cells.some((c) => near(c, desertHeart))) cand.push({ kind: DiscoveryKind.Desert, cell: desertHeart })
      // unseen landmasses: the farthest cell reached on each land other than home's, in order along the way
      lm ??= landmassIds(world)
      const homeLm = home >= 0 ? lm[home] : -1
      const far = new Map<number, number>()
      const hx = home >= 0 ? P[home * 3] : 0, hy = home >= 0 ? P[home * 3 + 1] : 0, hz = home >= 0 ? P[home * 3 + 2] : 0
      const dot = (c: number) => P[c * 3] * hx + P[c * 3 + 1] * hy + P[c * 3 + 2] * hz
      for (const c of cells) {
        const m = lm[c]
        if (m < 0 || m === homeLm) continue
        const cur = far.get(m)
        if (cur === undefined || dot(c) < dot(cur)) far.set(m, c)
      }
      for (const c of far.values()) cand.push({ kind: DiscoveryKind.Land, cell: c })
      if (!far.size) {
        // nothing but home's land: the farthest point of the way
        let best = cells[0]
        for (const c of cells) if (dot(c) < dot(best)) best = c
        cand.push({ kind: DiscoveryKind.Land, cell: best })
      }
    }
    for (let k = 0; k < group.length; k++) {
      const ev = group[k]
      const f = ev.value >= 0 && Array.isArray(features) ? features[ev.value] : undefined
      let kind: DiscoveryKind
      let cell: number
      if (f) {
        kind = DiscoveryKind.Feature
        cell = f.anchorCell
      } else if (cand.length) {
        const c = cand[Math.min(k, cand.length - 1)]
        kind = c.kind
        cell = c.cell
      } else {
        kind = DiscoveryKind.Land
        cell = home
      }
      if (cell < 0) continue
      if (kind < 4) reached[kind] = 1
      const place = f ? `the ${featureNoun(f.kind)} ${f.name}` : placeName(kind)
      if (!f) setDiscoveryPlace(ev, place)
      discoveries.push({ year: ev.year, cell, kind, sender: ev.settlement, place })
    }
  }
  const discoveryAt = new Map<number, number[]>()
  discoveries.forEach((d, k) => {
    const list = discoveryAt.get(d.cell)
    if (list) list.push(k)
    else discoveryAt.set(d.cell, [k])
  })
  return {
    outposts: Int32Array.from(outposts),
    routeOffsets,
    routeCells: Int32Array.from(route),
    lostCell: Int32Array.from(lostCell),
    lostYear: Float32Array.from(lostYear),
    lostFrom: Int32Array.from(lostFrom),
    discoveries,
    discoveryAt,
  }
}

/** "First reached in 1485 by an expedition from Tesh" lines for the discoveries at or next to `cell` by `year`, or ''. */
export function discoveryNote(d: ExpeditionData, world: World, h: History, cell: number, year: number): string {
  if (!d.discoveries.length) return ''
  const { neighborOffsets: off, neighbors: nb } = world.grid
  const lines: string[] = []
  const add = (c: number) => {
    for (const k of d.discoveryAt.get(c) ?? []) {
      const x = d.discoveries[k]
      if (x.year > year) continue
      const what = x.place.charAt(0).toUpperCase() + x.place.slice(1)
      // (renaming: the sender named as it was then)
      lines.push(`${what}: first reached in ${x.year} by an expedition from ${withEventNames(x.year, () => settlementName(h, x.sender))}`)
    }
  }
  add(cell)
  for (let k = off[cell]; k < off[cell + 1]; k++) add(nb[k])
  return lines.join('; ')
}
