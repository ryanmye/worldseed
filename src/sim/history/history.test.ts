import { describe, expect, it } from 'vitest'
import { Biome, CITY_POPULATION, EventType, GOOD_COUNT, JourneyKind, RIVER_FLOW_THRESHOLD, StructureType, TOWN_POPULATION } from '../../contract.ts'
import type { History, World } from '../../contract.ts'
import { generateWorld, simulateHistory } from '../index.ts'

const SEEDS = [1, 2, 3, 42, 1337, 2024, 31337, 77, 99999, 123456]

function fnv(h: number, a: ArrayBufferView): number {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return h
}

function hashWorld(w: World): string {
  let h = 0x811c9dc5
  for (const a of [w.grid.positions, w.grid.triangles, w.grid.neighborOffsets, w.grid.neighbors, w.plate, w.elevation, w.temperature, w.rainfall, w.biome, w.riverTo, w.flow, w.lake]) h = fnv(h, a)
  return (h >>> 0).toString(16) + ':' + w.seed + ':' + w.plateCount
}

/** FNV-1a over every History array, the settlement and structure tables and the event list. */
function hashHistory(hi: History): string {
  let h = 0x811c9dc5
  h = fnv(h, hi.population)
  h = fnv(h, hi.food)
  h = fnv(h, hi.capacity)
  h = fnv(h, hi.landUse)
  h = fnv(h, hi.degradation)
  h = fnv(h, hi.road)
  h = fnv(h, hi.wealth)
  h = fnv(h, hi.tradeVolume)
  const t = hi.trade
  for (const a of [t.a, t.b, t.openedYear, t.goodAB, t.goodBA, t.pathOffsets, t.path]) h = fnv(h, a)
  const ints: number[] = [hi.years, hi.snapshotInterval, hi.snapshotCount, hi.landInterval, hi.landSnapshotCount, hi.tradeInterval, hi.tradeSnapshotCount, t.count]
  for (const s of hi.settlements) {
    ints.push(s.id, s.cell, s.foundedYear, s.parent, s.abandonedYear)
    for (let i = 0; i < s.name.length; i++) ints.push(s.name.charCodeAt(i))
  }
  for (const s of hi.structures) ints.push(s.id, s.type, s.cell, s.settlement, s.builtYear, s.lostYear)
  h = fnv(h, Int32Array.from(ints))
  const ev = new Float64Array(hi.events.length * 5)
  hi.events.forEach((e, i) => ev.set([e.year, e.type, e.settlement, e.other, e.value], i * 5))
  h = fnv(h, ev)
  const j = hi.journeys
  h = fnv(h, j.departYear)
  h = fnv(h, j.arriveYear)
  h = fnv(h, j.from)
  h = fnv(h, j.to)
  h = fnv(h, j.size)
  h = fnv(h, j.kind)
  h = fnv(h, j.pathOffsets)
  h = fnv(h, j.path)
  return (h >>> 0).toString(16) + ':' + hi.settlements.length + ':' + hi.events.length + ':' + j.count + ':' + hi.structures.length + ':' + t.count
}

const worlds = new Map<number, World>()
function world(seed: number): World {
  let w = worlds.get(seed)
  if (!w) { w = generateWorld(seed); worlds.set(seed, w) }
  return w
}
const histories = new Map<number, History>()
function history(seed: number): History {
  let h = histories.get(seed)
  if (!h) { h = simulateHistory(world(seed)); histories.set(seed, h) }
  return h
}

/** Checks every structural invariant of a History against its World. */
function checkInvariants(w: World, h: History): void {
  const S = h.settlements.length
  const N = w.grid.cellCount
  expect(h.snapshotCount).toBe(Math.floor(h.years / h.snapshotInterval) + 1)
  expect(h.population.length).toBe(h.snapshotCount * S)
  expect(h.food.length).toBe(h.snapshotCount * S)
  expect(h.capacity.length).toBe(N)
  expect(h.landInterval).toBeGreaterThanOrEqual(1)
  expect(h.landSnapshotCount).toBe(Math.floor(h.years / h.landInterval) + 1)
  expect(h.landUse.length).toBe(h.landSnapshotCount * N)
  expect(h.degradation.length).toBe(h.landSnapshotCount * N)
  expect(h.road.length).toBe(h.landSnapshotCount * N)
  expect(h.wealth.length).toBe(h.snapshotCount * S)
  expect(h.tradeInterval).toBeGreaterThanOrEqual(1)
  expect(h.tradeSnapshotCount).toBe(Math.floor(h.years / h.tradeInterval) + 1)
  const R = h.trade.count
  expect(h.tradeVolume.length).toBe(h.tradeSnapshotCount * R)
  for (const a of [h.trade.a, h.trade.b, h.trade.openedYear, h.trade.goodAB, h.trade.goodBA]) expect(a.length).toBe(R)
  expect(h.trade.pathOffsets.length).toBe(R + 1)
  expect(h.trade.pathOffsets[0]).toBe(0)
  expect(h.trade.pathOffsets[R]).toBe(h.trade.path.length)

  for (let i = 0; i < N; i++) {
    const c = h.capacity[i]
    if (!(c >= 0 && Number.isFinite(c))) throw new Error(`capacity[${i}] = ${c}`)
    if ((w.elevation[i] < 0 || w.lake[i]) && c !== 0) throw new Error(`water cell ${i} has capacity ${c}`)
    // Land use and degradation only ever touch land that can be farmed: never water (or ice).
    if (c === 0) {
      for (let q = 0; q < h.landSnapshotCount; q++) {
        if (h.landUse[q * N + i] !== 0 || h.degradation[q * N + i] !== 0) throw new Error(`cell ${i} without capacity has land use / degradation at land snapshot ${q}`)
      }
    }
    // Roads are worn into land only: never on sea or lake cells.
    if (w.elevation[i] < 0 || w.lake[i]) {
      for (let q = 0; q < h.landSnapshotCount; q++) if (h.road[q * N + i] !== 0) throw new Error(`road on water cell ${i} at land snapshot ${q}`)
    }
  }
  // Year 0: nothing farmed yet, no roads.
  for (let i = 0; i < N; i++) if (h.landUse[i] !== 0 || h.degradation[i] !== 0 || h.road[i] !== 0) throw new Error(`cell ${i} farmed or roaded at year 0`)

  const seenNames = new Set<string>()
  for (let id = 0; id < S; id++) {
    const st = h.settlements[id]
    expect(st.id).toBe(id)
    expect(st.name.length).toBeGreaterThan(0)
    const nameKey = st.name.toLowerCase()
    expect(seenNames.has(nameKey)).toBe(false)
    seenNames.add(nameKey)
    if (w.elevation[st.cell] < 0 || w.lake[st.cell]) throw new Error(`settlement ${id} on water cell ${st.cell}`)
    expect(h.capacity[st.cell]).toBeGreaterThan(0)
    expect(st.foundedYear).toBeGreaterThanOrEqual(0)
    expect(st.foundedYear).toBeLessThanOrEqual(h.years)
    if (st.abandonedYear >= 0) expect(st.abandonedYear).toBeGreaterThan(st.foundedYear)
    if (id > 0) expect(st.foundedYear).toBeGreaterThanOrEqual(h.settlements[id - 1].foundedYear) // ids in founding order
    if (st.parent === -1) {
      expect(st.foundedYear).toBe(0)
    } else {
      expect(st.parent).toBeGreaterThanOrEqual(0)
      expect(st.parent).toBeLessThan(id)
      const p = h.settlements[st.parent]
      expect(p.foundedYear).toBeLessThan(st.foundedYear)
      // The parent was alive when it sent the founders.
      if (p.abandonedYear >= 0) expect(p.abandonedYear).toBeGreaterThanOrEqual(st.foundedYear)
    }
    for (let s = 0; s < h.snapshotCount; s++) {
      const year = s * h.snapshotInterval
      const pop = h.population[s * S + id]
      const food = h.food[s * S + id]
      if (!(food >= 0 && food <= 1)) throw new Error(`food ${food} of ${id} at year ${year}`)
      const alive = year >= st.foundedYear && (st.abandonedYear < 0 || year < st.abandonedYear)
      const wealth = h.wealth[s * S + id]
      if (!(wealth >= 0 && Number.isFinite(wealth))) throw new Error(`wealth ${wealth} of ${id} at year ${year}`)
      if (alive) {
        if (!(pop > 0 && Number.isFinite(pop))) throw new Error(`settlement ${id} alive at ${year} with population ${pop}`)
      } else if (pop !== 0 || food !== 0 || wealth !== 0) {
        throw new Error(`settlement ${id} not alive at ${year} but population ${pop}, food ${food}, wealth ${wealth}`)
      }
    }
  }

  // At most one living settlement per cell at every snapshot.
  const owner = new Int32Array(N).fill(-1)
  for (let s = 0; s < h.snapshotCount; s++) {
    for (let id = 0; id < S; id++) {
      if (h.population[s * S + id] <= 0) continue
      const c = h.settlements[id].cell
      if (owner[c] === s) throw new Error(`two living settlements on cell ${c} at snapshot ${s}`)
      owner[c] = s
    }
  }

  // Events: chronological, valid ids, consistent with the settlement and structure tables.
  const founded = new Int32Array(S)
  const abandoned = new Int32Array(S)
  const T = h.structures.length
  const built = new Int32Array(T)
  const lost = new Int32Array(T)
  const townYear = new Int32Array(S).fill(-1)
  const cityYear = new Int32Array(S).fill(-1)
  for (let i = 0; i < h.events.length; i++) {
    const e = h.events[i]
    if (i > 0) expect(e.year).toBeGreaterThanOrEqual(h.events[i - 1].year)
    expect(e.year).toBeGreaterThanOrEqual(0)
    expect(e.year).toBeLessThanOrEqual(h.years)
    expect(e.settlement).toBeGreaterThanOrEqual(0)
    expect(e.settlement).toBeLessThan(S)
    expect(e.other).toBeGreaterThanOrEqual(-1)
    const structureEvent = e.type === EventType.Built || e.type === EventType.StructureLost
    expect(e.other).toBeLessThan(structureEvent ? T : S)
    const st = h.settlements[e.settlement]
    expect(e.year).toBeGreaterThanOrEqual(st.foundedYear)
    if (st.abandonedYear >= 0) expect(e.year).toBeLessThanOrEqual(st.abandonedYear)
    switch (e.type) {
      case EventType.Founded:
        founded[e.settlement]++
        expect(e.year).toBe(st.foundedYear)
        expect(e.other).toBe(st.parent)
        expect(e.value).toBeGreaterThan(0)
        break
      case EventType.Abandoned:
        abandoned[e.settlement]++
        expect(e.year).toBe(st.abandonedYear)
        break
      case EventType.Famine:
        expect(e.value).toBeGreaterThan(0)
        expect(e.value).toBeLessThanOrEqual(1)
        break
      case EventType.Migration:
        expect(e.other).toBeGreaterThanOrEqual(0)
        expect(e.other).not.toBe(e.settlement)
        expect(e.value).toBeGreaterThan(0)
        expect(h.settlements[e.other].foundedYear).toBeLessThan(e.year)
        if (h.settlements[e.other].abandonedYear >= 0) expect(h.settlements[e.other].abandonedYear).toBeGreaterThanOrEqual(e.year)
        break
      case EventType.Built: {
        const x = h.structures[e.other]
        built[e.other]++
        expect(x.settlement).toBe(e.settlement)
        expect(x.builtYear).toBe(e.year)
        expect(e.value).toBe(x.type)
        break
      }
      case EventType.StructureLost: {
        const x = h.structures[e.other]
        lost[e.other]++
        expect(x.settlement).toBe(e.settlement)
        expect(x.lostYear).toBe(e.year)
        expect(e.value).toBe(x.type)
        break
      }
      case EventType.BecameTown:
        if (townYear[e.settlement] >= 0) throw new Error(`settlement ${e.settlement} became a town twice`)
        townYear[e.settlement] = e.year
        expect(e.value).toBeGreaterThanOrEqual(TOWN_POPULATION)
        break
      case EventType.TradeOpened:
      case EventType.TradeClosed: {
        // Checked against the routes below.
        expect(e.other).toBeGreaterThanOrEqual(0)
        expect(e.other).not.toBe(e.settlement)
        expect(Number.isInteger(e.value) && e.value >= 0 && e.value < h.trade.count).toBe(true)
        const o = h.settlements[e.other]
        expect(e.year).toBeGreaterThanOrEqual(o.foundedYear)
        if (o.abandonedYear >= 0) expect(e.year).toBeLessThanOrEqual(o.abandonedYear)
        break
      }
      case EventType.BecameCity:
        if (cityYear[e.settlement] >= 0) throw new Error(`settlement ${e.settlement} became a city twice`)
        cityYear[e.settlement] = e.year
        expect(e.value).toBeGreaterThanOrEqual(CITY_POPULATION)
        // A city was a town first (possibly in the same year).
        expect(townYear[e.settlement]).toBeGreaterThanOrEqual(0)
        expect(townYear[e.settlement]).toBeLessThanOrEqual(e.year)
        break
      default:
        throw new Error(`unknown event type ${e.type}`)
    }
  }
  for (let id = 0; id < S; id++) {
    expect(founded[id]).toBe(1)
    expect(abandoned[id]).toBe(h.settlements[id].abandonedYear >= 0 ? 1 : 0)
  }

  // Towns and cities: the milestone events agree with the population matrix.
  for (let id = 0; id < S; id++) {
    for (const [threshold, year] of [[TOWN_POPULATION, townYear[id]], [CITY_POPULATION, cityYear[id]]]) {
      for (let q = 0; q < h.snapshotCount; q++) {
        const y = q * h.snapshotInterval
        const pop = h.population[q * S + id]
        if (year < 0 || y < year) {
          if (pop >= threshold) throw new Error(`settlement ${id} has ${pop} >= ${threshold} at year ${y} without a milestone by then (event year ${year})`)
        }
      }
    }
  }

  // Structures: ids in building order, valid cells, lifetimes inside the owner's.
  const { neighborOffsets: noff0, neighbors: nnb0 } = w.grid
  const portInUse: number[][] = []
  for (let k = 0; k < T; k++) {
    const x = h.structures[k]
    expect(x.id).toBe(k)
    if (k > 0) expect(x.builtYear).toBeGreaterThanOrEqual(h.structures[k - 1].builtYear)
    expect(x.settlement).toBeGreaterThanOrEqual(0)
    expect(x.settlement).toBeLessThan(S)
    expect(built[k]).toBe(1)
    expect(lost[k]).toBe(x.lostYear >= 0 ? 1 : 0)
    const owner = h.settlements[x.settlement]
    expect(x.builtYear).toBeGreaterThanOrEqual(owner.foundedYear)
    expect(x.builtYear).toBeLessThanOrEqual(h.years)
    if (x.lostYear >= 0) expect(x.lostYear).toBeGreaterThan(x.builtYear)
    if (owner.abandonedYear >= 0) {
      expect(x.builtYear).toBeLessThan(owner.abandonedYear)
      // Everything a settlement built falls out of use by the time it is abandoned.
      expect(x.lostYear).toBeGreaterThanOrEqual(0)
      expect(x.lostYear).toBeLessThanOrEqual(owner.abandonedYear)
    }
    if (x.type === StructureType.Port) {
      expect(x.cell).toBe(owner.cell)
      let coastal = false
      for (let e = noff0[x.cell]; e < noff0[x.cell + 1]; e++) {
        const j = nnb0[e]
        if (w.elevation[j] < 0 && w.biome[j] !== Biome.Ice) coastal = true
      }
      if (!coastal) throw new Error(`port ${k} on non-coastal cell ${x.cell}`)
    } else if (x.type === StructureType.Dam) {
      if (!(w.flow[x.cell] >= RIVER_FLOW_THRESHOLD) || w.elevation[x.cell] < 0 || w.lake[x.cell]) throw new Error(`dam ${k} not on a river cell (${x.cell}, flow ${w.flow[x.cell]})`)
      const to = w.riverTo[x.cell]
      if (to < 0 || w.elevation[to] < 0) throw new Error(`dam ${k} at a river mouth`)
    } else {
      throw new Error(`unknown structure type ${x.type}`)
    }
    portInUse.push([x.type, x.settlement, x.cell, x.builtYear, x.lostYear < 0 ? h.years + 1 : x.lostYear])
  }
  // At most one port and one dam in use per settlement, and one dam per cell, at any time.
  for (let a = 0; a < portInUse.length; a++) {
    for (let b = a + 1; b < portInUse.length; b++) {
      const [ta, sa, ca, ba, la] = portInUse[a]
      const [tb, sb, cb, bb, lb] = portInUse[b]
      if (ta !== tb || !(ba < lb && bb < la)) continue
      if (sa === sb) throw new Error(`settlement ${sa} has two structures of type ${ta} in use at once`)
      if (ta === StructureType.Dam && ca === cb) throw new Error(`two dams in use on cell ${ca}`)
    }
  }

  // Journeys: one per Founded event with a real parent, one per Migration event.
  const J = h.journeys
  const expectedJourneys = h.events.filter((e) => (e.type === EventType.Founded && e.other >= 0) || e.type === EventType.Migration).length
  expect(J.count).toBe(expectedJourneys)
  for (const a of [J.departYear, J.arriveYear, J.from, J.to, J.size, J.kind]) expect(a.length).toBe(J.count)
  expect(J.pathOffsets.length).toBe(J.count + 1)
  expect(J.pathOffsets[0]).toBe(0)
  expect(J.pathOffsets[J.count]).toBe(J.path.length)
  const { neighborOffsets: noff, neighbors: nnb } = w.grid
  const isNeighbor = (a: number, b: number): boolean => {
    for (let k = noff[a]; k < noff[a + 1]; k++) if (nnb[k] === b) return true
    return false
  }
  for (let j = 0; j < J.count; j++) {
    if (j > 0) expect(J.departYear[j]).toBeGreaterThanOrEqual(J.departYear[j - 1])
    expect(J.departYear[j]).toBeLessThanOrEqual(J.arriveYear[j])
    expect(J.departYear[j]).toBeGreaterThanOrEqual(h.settlements[J.from[j]].foundedYear)
    expect(J.size[j]).toBeGreaterThan(0)
    expect(J.kind[j] === JourneyKind.Settlers || J.kind[j] === JourneyKind.Migrants).toBe(true)
    const off0 = J.pathOffsets[j], off1 = J.pathOffsets[j + 1]
    expect(off1).toBeGreaterThan(off0)
    expect(J.path[off0]).toBe(h.settlements[J.from[j]].cell)
    expect(J.path[off1 - 1]).toBe(h.settlements[J.to[j]].cell)
    for (let k = off0 + 1; k < off1; k++) {
      expect(isNeighbor(J.path[k - 1], J.path[k])).toBe(true)
    }
  }

  // Trade routes: distinct, valid ends; one route per pair; paths from a's cell to b's cell through neighbours.
  const tr = h.trade
  const pairs = new Set<number>()
  const alive = (id: number, year: number): boolean => {
    const st = h.settlements[id]
    return year >= st.foundedYear && (st.abandonedYear < 0 || year < st.abandonedYear)
  }
  for (let r = 0; r < R; r++) {
    const a = tr.a[r], b = tr.b[r]
    if (!(a >= 0 && a < S && b >= 0 && b < S && a !== b)) throw new Error(`route ${r} has ends ${a}, ${b}`)
    const key = Math.min(a, b) * S + Math.max(a, b)
    if (pairs.has(key)) throw new Error(`two routes between ${a} and ${b}`)
    pairs.add(key)
    expect(tr.goodAB[r]).toBeLessThan(GOOD_COUNT)
    expect(tr.goodBA[r]).toBeLessThan(GOOD_COUNT)
    expect(tr.openedYear[r]).toBeGreaterThanOrEqual(1)
    expect(tr.openedYear[r]).toBeLessThanOrEqual(h.years)
    if (r > 0) expect(tr.openedYear[r]).toBeGreaterThanOrEqual(tr.openedYear[r - 1]) // ids in order of first opening
    const p0 = tr.pathOffsets[r], p1 = tr.pathOffsets[r + 1]
    expect(p1 - p0).toBeGreaterThanOrEqual(2)
    if (tr.path[p0] !== h.settlements[a].cell || tr.path[p1 - 1] !== h.settlements[b].cell) throw new Error(`route ${r} path does not run from ${a}'s cell to ${b}'s`)
    for (let k = p0 + 1; k < p1; k++) if (!isNeighbor(tr.path[k - 1], tr.path[k])) throw new Error(`route ${r} path jumps between ${tr.path[k - 1]} and ${tr.path[k]}`)
  }
  // Events open and close each route alternately, first opening at openedYear; volume only while open, with both ends alive.
  const open = new Uint8Array(R)
  const opens = new Int32Array(R)
  const evs = h.events
  let ei = 0
  for (let q = 0; q < h.tradeSnapshotCount; q++) {
    const year = q * h.tradeInterval
    for (; ei < evs.length && evs[ei].year <= year; ei++) {
      const e = evs[ei]
      if (e.type !== EventType.TradeOpened && e.type !== EventType.TradeClosed) continue
      const r = e.value
      if (!((e.settlement === tr.a[r] && e.other === tr.b[r]) || (e.settlement === tr.b[r] && e.other === tr.a[r]))) throw new Error(`trade event for route ${r} names ${e.settlement}, ${e.other}`)
      if (e.type === EventType.TradeOpened) {
        if (open[r]) throw new Error(`route ${r} opened twice in a row (year ${e.year})`)
        if (opens[r] === 0) expect(e.year).toBe(tr.openedYear[r])
        open[r] = 1
        opens[r]++
      } else {
        if (!open[r]) throw new Error(`route ${r} closed while not open (year ${e.year})`)
        open[r] = 0
      }
    }
    for (let r = 0; r < R; r++) {
      const v = h.tradeVolume[q * R + r]
      if (!(v >= 0 && Number.isFinite(v))) throw new Error(`route ${r} volume ${v} at year ${year}`)
      if (year < tr.openedYear[r] && v !== 0) throw new Error(`route ${r} has volume ${v} at ${year}, before it opened in ${tr.openedYear[r]}`)
      if (v > 0) {
        if (!open[r]) throw new Error(`route ${r} has volume ${v} at ${year} while closed`)
        if (!alive(tr.a[r], year) || !alive(tr.b[r], year)) throw new Error(`route ${r} has volume at ${year} but an end is not alive`)
      }
    }
  }
  for (; ei < evs.length; ei++) {
    const e = evs[ei]
    if (e.type === EventType.TradeOpened) { if (open[e.value]) throw new Error(`route ${e.value} opened twice`); open[e.value] = 1; opens[e.value]++ }
    else if (e.type === EventType.TradeClosed) { if (!open[e.value]) throw new Error(`route ${e.value} closed while not open`); open[e.value] = 0 }
  }
  for (let r = 0; r < R; r++) {
    expect(opens[r]).toBeGreaterThanOrEqual(1)
    // A route still open at the end has both ends alive at the end.
    if (open[r]) expect(h.settlements[tr.a[r]].abandonedYear < 0 && h.settlements[tr.b[r]].abandonedYear < 0).toBe(true)
  }
}

describe('simulateHistory', () => {
  it('is deterministic: same world gives a bit-identical history; different seeds differ', () => {
    const a = hashHistory(simulateHistory(world(42)))
    const b = hashHistory(simulateHistory(generateWorld(42)))
    expect(b).toBe(a)
    expect(hashHistory(history(1))).not.toBe(a)
    expect(hashHistory(history(2))).not.toBe(hashHistory(history(1)))
  }, 60_000)

  it('does not mutate the world', () => {
    const w = generateWorld(77)
    const before = hashWorld(w)
    simulateHistory(w, { years: 600 })
    expect(hashWorld(w)).toBe(before)
  })

  it('matrices have contract shapes and own their buffers', () => {
    const h = history(42)
    expect(h.years).toBe(2000)
    expect(h.snapshotInterval).toBe(5)
    expect(h.snapshotCount).toBe(401)
    expect(h.population.length).toBe(401 * h.settlements.length)
    const J = h.journeys
    expect(h.landInterval).toBe(20)
    expect(h.landSnapshotCount).toBe(101)
    expect(h.landUse.length).toBe(101 * h.capacity.length)
    // The three land matrices together stay under 8 MB at the default grid; trade volumes under 4 MB.
    expect(h.road.length).toBe(101 * h.capacity.length)
    expect(h.landUse.byteLength + h.degradation.byteLength + h.road.byteLength).toBeLessThan(8 * 1024 * 1024)
    expect(h.tradeInterval).toBe(10)
    expect(h.tradeSnapshotCount).toBe(201)
    expect(h.tradeVolume.byteLength).toBeLessThan(4 * 1024 * 1024)
    expect(h.wealth.length).toBe(401 * h.settlements.length)
    const t = h.trade
    const arrays = [h.population, h.food, h.capacity, h.landUse, h.degradation, h.road, h.wealth, h.tradeVolume, J.departYear, J.arriveYear, J.from, J.to, J.size, J.kind, J.pathOffsets, J.path,
      t.a, t.b, t.openedYear, t.goodAB, t.goodBA, t.pathOffsets, t.path]
    const buffers = new Set<ArrayBufferLike>()
    for (const a of arrays) {
      expect(a.byteOffset).toBe(0)
      expect(a.buffer.byteLength).toBe(a.byteLength)
      buffers.add(a.buffer)
    }
    expect(buffers.size).toBe(arrays.length)
  })

  it('respects options and shorter runs replay the same start', () => {
    const w = world(3)
    const h = simulateHistory(w, { years: 303, snapshotInterval: 7 })
    expect(h.years).toBe(303)
    expect(h.snapshotInterval).toBe(7)
    expect(h.snapshotCount).toBe(44)
    checkInvariants(w, h)
    // The first years do not depend on the run length.
    const full = history(3)
    const short = simulateHistory(w, { years: 200 })
    const S0 = short.settlements.length
    for (let s = 0; s < short.snapshotCount; s++) {
      for (let id = 0; id < S0; id++) expect(short.population[s * S0 + id]).toBe(full.population[s * full.settlements.length + id])
    }
    // Land snapshots of the short run match the full run's.
    const N = w.grid.cellCount
    for (let q = 0; q < short.landSnapshotCount; q++) {
      for (let i = 0; i < N; i++) {
        if (short.landUse[q * N + i] !== full.landUse[q * N + i] || short.degradation[q * N + i] !== full.degradation[q * N + i]) throw new Error(`land snapshot ${q} differs at cell ${i}`)
      }
    }
    // Trade, wealth and roads of the short run match the full run's.
    const R0 = short.trade.count
    expect(R0).toBeLessThanOrEqual(full.trade.count)
    for (let r = 0; r < R0; r++) {
      expect(short.trade.a[r]).toBe(full.trade.a[r])
      expect(short.trade.b[r]).toBe(full.trade.b[r])
      expect(short.trade.openedYear[r]).toBe(full.trade.openedYear[r])
    }
    for (let q = 0; q < short.tradeSnapshotCount; q++) {
      for (let r = 0; r < R0; r++) expect(short.tradeVolume[q * R0 + r]).toBe(full.tradeVolume[q * full.trade.count + r])
    }
    for (let s = 0; s < short.snapshotCount; s++) {
      for (let id = 0; id < S0; id++) expect(short.wealth[s * S0 + id]).toBe(full.wealth[s * full.settlements.length + id])
    }
    for (let q = 0; q < short.landSnapshotCount; q++) {
      for (let i = 0; i < N; i++) if (short.road[q * N + i] !== full.road[q * N + i]) throw new Error(`road snapshot ${q} differs at cell ${i}`)
    }
    const zero = simulateHistory(w, { years: 0 })
    expect(zero.snapshotCount).toBe(1)
    expect(zero.landSnapshotCount).toBe(1)
    expect(zero.tradeSnapshotCount).toBe(1)
    expect(zero.trade.count).toBe(0)
    expect(zero.structures.length).toBe(0)
    checkInvariants(w, zero)
  })

  it('runs at other resolutions', () => {
    const w = generateWorld(9, { subdivisions: 24 })
    const h = simulateHistory(w, { years: 800 })
    checkInvariants(w, h)
    expect(h.settlements.length).toBeGreaterThan(4)
  })

  it('every history satisfies the structural invariants', () => {
    for (const seed of SEEDS) checkInvariants(world(seed), history(seed))
  }, 60_000)

  it('no extinction, no early saturation, setbacks happen, sizes are heavy-tailed', () => {
    let heavy = 0, joined = 0
    for (const seed of SEEDS) {
      const h = history(seed)
      const S = h.settlements.length
      const total = (s: number) => { let t = 0; for (let id = 0; id < S; id++) t += h.population[s * S + id]; return t }
      const living = (s: number) => { let n = 0; for (let id = 0; id < S; id++) if (h.population[s * S + id] > 0) n++; return n }
      const last = h.snapshotCount - 1
      const at = (year: number) => Math.floor(year / h.snapshotInterval)
      // Founders: a handful of tribes.
      expect(living(0)).toBeGreaterThanOrEqual(3)
      expect(living(0)).toBeLessThanOrEqual(8)
      // Nobody goes extinct; settlements keep spreading but stay bounded.
      for (let s = 0; s <= last; s += 20) if (living(s) === 0) throw new Error(`seed ${seed}: extinct at year ${s * h.snapshotInterval}`)
      expect(living(last)).toBeGreaterThan(100)
      expect(S).toBeLessThan(4000)
      // Gradual: far from the final population at year 500, still growing in the last 500 years.
      expect(total(at(500))).toBeLessThan(0.25 * total(last))
      expect(total(last)).toBeGreaterThan(1.2 * total(at(1500)))
      expect(living(at(500))).toBeLessThan(0.6 * living(last))
      // Setbacks: some famine events and at least one visible dip in the total.
      expect(h.events.filter((e) => e.type === EventType.Famine).length).toBeGreaterThan(0)
      let dips = 0
      for (let s = 1; s <= last; s++) if (total(s) < 0.97 * total(s - 1)) dips++
      expect(dips).toBeGreaterThan(0)
      // Heavy tail: the largest settlement dwarfs the median one.
      const pops: number[] = []
      for (let id = 0; id < S; id++) if (h.population[last * S + id] > 0) pops.push(h.population[last * S + id])
      pops.sort((a, b) => a - b)
      if (pops[pops.length - 1] > 20 * pops[pops.length >> 1]) heavy++
      if (h.events.some((e) => e.type === EventType.Migration)) joined++
    }
    expect(heavy).toBeGreaterThanOrEqual(SEEDS.length - 1)
    expect(joined).toBe(SEEDS.length)
  }, 60_000)

  it('trade emerges late, grows into networks, feeds hubs that become the big cities, and wears roads', () => {
    let hubTop = 0, bigCity = 0, mixed = 0
    for (const seed of SEEDS) {
      const w = world(seed)
      const h = history(seed)
      const S = h.settlements.length
      const N = w.grid.cellCount
      const R = h.trade.count
      const last = h.snapshotCount - 1
      const tq = h.tradeSnapshotCount - 1
      const at = (year: number) => Math.floor(year / h.tradeInterval)
      const openAt = (year: number): number => {
        let n = 0
        for (const e of h.events) {
          if (e.year > year) break
          if (e.type === EventType.TradeOpened) n++
          else if (e.type === EventType.TradeClosed) n--
        }
        return n
      }
      // Negligible early, networks by the end: hundreds of routes, not tens of thousands.
      expect(openAt(250)).toBeLessThanOrEqual(10)
      expect(openAt(h.years)).toBeGreaterThan(50)
      expect(openAt(h.years)).toBeLessThan(2000)
      expect(R).toBeLessThan(5000)
      let vol500 = 0, volEnd = 0
      for (let r = 0; r < R; r++) { vol500 += h.tradeVolume[at(500) * R + r]; volEnd += h.tradeVolume[tq * R + r] }
      expect(volEnd).toBeGreaterThan(10 * vol500)
      // Several goods carry the trade (by each route's main goods, weighted by volume).
      const byGood = new Float64Array(GOOD_COUNT)
      for (let r = 0; r < R; r++) { const v = h.tradeVolume[tq * R + r]; byGood[h.trade.goodAB[r]] += v / 2; byGood[h.trade.goodBA[r]] += v / 2 }
      let big = 0
      for (let g = 0; g < GOOD_COUNT; g++) if (byGood[g] > 0.08 * volEnd) big++
      if (big >= 3 && Math.max(...byGood) < 0.6 * volEnd) mixed++
      // The largest settlement at the end trades widely.
      let top = 0
      for (let id = 1; id < S; id++) if (h.population[last * S + id] > h.population[last * S + top]) top = id
      let topRoutes = 0, topVol = 0
      const vol = new Float64Array(S)
      for (let r = 0; r < R; r++) {
        const v = h.tradeVolume[tq * R + r]
        vol[h.trade.a[r]] += v
        vol[h.trade.b[r]] += v
        if (v > 0 && (h.trade.a[r] === top || h.trade.b[r] === top)) topRoutes++
      }
      topVol = vol[top]
      let rank = 0
      for (let id = 0; id < S; id++) if (vol[id] > topVol) rank++
      if (topRoutes >= 3 && rank < 10) hubTop++
      if (h.population[last * S + top] >= 15000) bigCity++
      // Wealth accrues to traders.
      expect(h.wealth[last * S + top]).toBeGreaterThan(0)
      // Roads: worn along busy routes, forming connected corridors.
      const lq = h.landSnapshotCount - 1
      const comp = new Int32Array(N).fill(-1)
      let roads = 0, largest = 0
      for (let i = 0; i < N; i++) {
        if (h.road[lq * N + i] < 32 || comp[i] >= 0) continue
        let size = 0
        const stack = [i]
        comp[i] = i
        while (stack.length > 0) {
          const c = stack.pop() as number
          size++
          for (let k = w.grid.neighborOffsets[c]; k < w.grid.neighborOffsets[c + 1]; k++) {
            const j = w.grid.neighbors[k]
            if (comp[j] < 0 && h.road[lq * N + j] >= 32) { comp[j] = i; stack.push(j) }
          }
        }
        roads += size
        largest = Math.max(largest, size)
      }
      expect(roads).toBeGreaterThan(50)
      expect(largest).toBeGreaterThanOrEqual(20)
    }
    expect(mixed).toBeGreaterThanOrEqual(SEEDS.length - 2)
    expect(hubTop).toBeGreaterThanOrEqual(SEEDS.length - 2)
    // Most worlds grow a trade city well beyond what the best land alone feeds (~2-8k without trade).
    expect(bigCity).toBeGreaterThanOrEqual(SEEDS.length - 3)
  }, 60_000)

  it('people change the land: farming, exhaustion and recovery, abandonment and resettlement, ports, dams, cities', () => {
    let withCity = 0, dams = 0, recoveredSeeds = 0, resettledSeeds = 0, biggest = 0
    for (const seed of SEEDS) {
      const w = world(seed)
      const h = history(seed)
      const S = h.settlements.length
      const N = w.grid.cellCount
      const last = h.snapshotCount - 1
      const lastLand = h.landSnapshotCount - 1
      let hab = 0, use = 0, deg = 0
      for (let i = 0; i < N; i++) {
        if (h.capacity[i] <= 0) continue
        hab++
        use += h.landUse[lastLand * N + i]
        deg += h.degradation[lastLand * N + i]
      }
      // A visible share of the land is farmed and worn by the end, but not all of it.
      expect(use / (255 * hab)).toBeGreaterThan(0.05)
      expect(use / (255 * hab)).toBeLessThan(0.8)
      expect(deg / (255 * hab)).toBeGreaterThan(0.02)
      expect(deg / (255 * hab)).toBeLessThan(0.5)
      // Abandonment is a real part of history, not a collapse.
      const abandoned = h.settlements.filter((st) => st.abandonedYear >= 0).length
      expect(abandoned / S).toBeGreaterThan(0.06)
      expect(abandoned / S).toBeLessThan(0.25)
      // Some abandoned site is settled again later.
      const lastFounded = new Int32Array(N).fill(-1)
      for (const st of h.settlements) lastFounded[st.cell] = st.foundedYear
      if (h.settlements.some((st) => st.abandonedYear >= 0 && lastFounded[st.cell] >= st.abandonedYear && lastFounded[st.cell] > st.foundedYear)) resettledSeeds++
      // Some cell degraded, then recovered to half of its peak.
      let recovered = false
      for (let i = 0; i < N && !recovered; i++) {
        let peak = 0
        for (let q = 0; q < h.landSnapshotCount; q++) {
          const d = h.degradation[q * N + i]
          if (d > peak) peak = d
          else if (peak >= 51 && d <= peak / 2) { recovered = true; break }
        }
      }
      if (recovered) recoveredSeeds++
      // Ports are common; dams uncommon.
      const ports = h.structures.filter((x) => x.type === StructureType.Port).length
      const nd = h.structures.filter((x) => x.type === StructureType.Dam).length
      expect(ports).toBeGreaterThan(5)
      expect(nd).toBeLessThanOrEqual(40)
      dams += nd
      if (h.events.some((e) => e.type === EventType.BecameCity)) withCity++
      for (let id = 0; id < S; id++) biggest = Math.max(biggest, h.population[last * S + id])
    }
    expect(resettledSeeds).toBe(SEEDS.length)
    expect(recoveredSeeds).toBe(SEEDS.length)
    expect(dams).toBeGreaterThan(0)
    expect(withCity).toBeGreaterThanOrEqual(SEEDS.length - 3)
    // The best sites (irrigated, fishing ports) outgrow the old ~25k ceiling somewhere.
    expect(biggest).toBeGreaterThan(30000)
  }, 60_000)
})
