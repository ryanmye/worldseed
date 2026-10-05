import { describe, expect, it } from 'vitest'
import { Biome, CITY_POPULATION, EventType, GOOD_COUNT, JourneyKind, RIVER_FLOW_THRESHOLD, SpeciesCategory, StructureType, TECH_FIELD_COUNT, TOWN_POPULATION, IdeaHow } from '../../contract.ts'
import type { History, HistoryEvent, World } from '../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../index.ts'
import { runHistory } from './index.ts'
import type { HistoryRun } from './index.ts'
import { buildTerrain } from './terrain.ts'
import type { Terrain } from './terrain.ts'
import { CAPACITY, DISEASE, EXPLORE, OUTPOST, POPULATION } from './params.ts'
import { K_COUNT, S_COUNT, speciesFit, SPECIES_TABLE } from './species.ts'
import { speciesProbe } from './speciesStats.ts'
import type { SpeciesProbe } from './speciesStats.ts'

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
    ints.push(s.id, s.cell, s.foundedYear, s.parent, s.abandonedYear, s.people, s.outpost ? 1 : 0)
    for (let i = 0; i < s.name.length; i++) ints.push(s.name.charCodeAt(i))
  }
  for (const p of hi.peoples) {
    ints.push(p.id, p.founder, p.cradle)
    for (let i = 0; i < p.name.length; i++) ints.push(p.name.charCodeAt(i))
  }
  h = fnv(h, hi.knownYear)
  h = fnv(h, hi.contactYear)
  h = fnv(h, hi.technology)
  h = fnv(h, hi.speciesYear)
  h = fnv(h, hi.speciesSource)
  h = fnv(h, hi.crop)
  h = fnv(h, hi.herd)
  for (const x of hi.species) {
    ints.push(x.id, x.category, Math.round(x.yield * 1000), ...x.origins)
    for (const str of [x.name, x.archetype]) for (let i = 0; i < str.length; i++) ints.push(str.charCodeAt(i))
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
const terrains = new Map<number, Terrain>()
function terrain(seed: number): Terrain {
  let t = terrains.get(seed)
  if (!t) { t = buildTerrain(world(seed)); terrains.set(seed, t) }
  return t
}
const runs = new Map<number, HistoryRun>()
/** The default run of a seed, with the internal diagnostics (its history is what simulateHistory returns). */
function run(seed: number): HistoryRun {
  let r = runs.get(seed)
  if (!r) { r = runHistory(world(seed)); runs.set(seed, r) }
  return r
}
function history(seed: number): History {
  return run(seed).history
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
    if (st.outpost) {
      // An expedition base: founded by a settlement, where nobody could farm (below the habitable capacity).
      if (!(h.capacity[st.cell] < CAPACITY.habitableMin * (23042 / N))) throw new Error(`base ${id} on farmable cell ${st.cell} (capacity ${h.capacity[st.cell]})`)
      expect(st.parent).toBeGreaterThanOrEqual(0)
      expect(h.settlements[st.parent].outpost).toBe(false)
      const par = h.settlements[st.parent]
      if (par.abandonedYear >= 0 && !(st.abandonedYear >= 0 && st.abandonedYear <= par.abandonedYear)) throw new Error(`base ${id} outlives its parent ${st.parent}`)
    } else expect(h.capacity[st.cell]).toBeGreaterThan(0)
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
        if (st.outpost && !(h.population[s * S + st.parent] > 0)) throw new Error(`base ${id} alive at ${year} without a living parent`)
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
  const lostVoyages: HistoryEvent[] = [], landfalls: HistoryEvent[] = [], contacts: HistoryEvent[] = [], sent: HistoryEvent[] = [], returned: HistoryEvent[] = [], advances: HistoryEvent[] = [], speciesEvents: HistoryEvent[] = []
  for (let i = 0; i < h.events.length; i++) {
    const e = h.events[i]
    if (i > 0) expect(e.year).toBeGreaterThanOrEqual(h.events[i - 1].year)
    expect(e.year).toBeGreaterThanOrEqual(0)
    expect(e.year).toBeLessThanOrEqual(h.years)
    expect(e.settlement).toBeGreaterThanOrEqual(0)
    expect(e.settlement).toBeLessThan(S)
    expect(e.other).toBeGreaterThanOrEqual(-1)
    const structureEvent = e.type === EventType.Built || e.type === EventType.StructureLost
    expect(e.other).toBeLessThan(structureEvent ? T : e.type === EventType.Discovery ? N : S) // (a Discovery's `other` is a cell)
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
      case EventType.VoyageLost:
        // From a coastal settlement alive that year; checked further below.
        expect(e.other).toBe(-1)
        expect(e.value).toBeGreaterThan(0)
        lostVoyages.push(e)
        break
      case EventType.Landfall:
        landfalls.push(e)
        break
      case EventType.FirstContact:
        contacts.push(e)
        break
      case EventType.ExpeditionSent:
        expect(e.other).toBe(-1)
        expect(e.value).toBeGreaterThan(0)
        expect(st.outpost).toBe(false)
        sent.push(e)
        break
      case EventType.ExpeditionReturned:
        expect(e.value).toBeGreaterThanOrEqual(0)
        if (e.other >= 0) {
          // The base it founded, this year (or a goods fort at the far end of a lane: goods/routes.ts logs it here too).
          const b = h.settlements[e.other]
          expect(b.outpost || b.post).toBe(true)
          expect(b.parent).toBe(e.settlement)
          expect(b.foundedYear).toBe(e.year)
        }
        returned.push(e)
        break
      case EventType.Discovery:
        expect(e.other).toBeGreaterThanOrEqual(0) // the cell reached
        if (e.value !== -1) {
          expect(Number.isInteger(e.value) && e.value >= 0 && e.value < h.features.length).toBe(true)
          expect(h.features[e.value].namedYear).toBeLessThanOrEqual(e.year)
        }
        break
      case EventType.TechAdvance:
        expect(e.other).toBe(-1)
        expect(Number.isInteger(e.value) && e.value >= 0 && e.value < TECH_FIELD_COUNT).toBe(true)
        expect(st.outpost).toBe(false)
        advances.push(e)
        break
      case EventType.Domesticated:
      case EventType.SpeciesAdopted:
      case EventType.Epidemic:
        // Checked with the species below.
        speciesEvents.push(e)
        break
      case EventType.TechniqueFound:
      case EventType.TechniqueAdopted:
      case EventType.Blight:
      case EventType.HabitSpreads:
      case EventType.Drain:
      case EventType.Panzootic:
        // species-v2: checked in species2.test.ts.
      // polities: states, war and danger (checked against History.polities and History.wars in polity.test.ts).
      case EventType.PolityFounded: case EventType.PolityEnded: case EventType.CapitalMoved: case EventType.Joined:
      case EventType.WarDeclared: case EventType.PeaceMade: case EventType.Conquered: case EventType.Sacked: case EventType.SiegeLifted:
      case EventType.Raid: case EventType.Revolt: case EventType.RevoltCrushed: case EventType.Seceded: case EventType.Defected:
      case EventType.SuccessionCrisis:
      // polities v2: checked in polity2.test.ts.
      case EventType.CivilWar: case EventType.Partitioned: case EventType.Reunified: case EventType.BecameVassal: case EventType.Alliance:
      case EventType.SmugglingRing: case EventType.PiratesRise: case EventType.PiratesSuppressed: case EventType.Blockade:
        break
      // goods: deposits, traditions, secrets, lanes, posts, smuggling (checked against their tables in goods/goods.test.ts).
      case EventType.DepositFound: case EventType.MineExhausted: case EventType.Boom: case EventType.TraditionBorn: case EventType.TraditionRenowned:
      case EventType.TraditionMoved: case EventType.TraditionLost: case EventType.SecretGuarded: case EventType.SecretLeaked: case EventType.MonopolyBroken:
      case EventType.DirectRoute: case EventType.PostFounded: case EventType.PostLost: case EventType.Bypassed: case EventType.FleetLost: case EventType.SecretSmuggled:
        break
      // disease: epidemics, endemic sickness, quarantine, armies (checked against their tables in disease/disease.test.ts).
      case EventType.DiseaseAppeared: case EventType.GreatEpidemic: case EventType.EpidemicEnded: case EventType.CityStricken:
      case EventType.Quarantine: case EventType.Endemic: case EventType.ArmyStricken:
      // rulers and religion (checked against their tables in rulers/rulers.test.ts and religion/religion.test.ts).
      case EventType.RulerAcceded: case EventType.ReignEnded: case EventType.DynastyFounded: case EventType.DynastyEnded: case EventType.Regency:
      case EventType.UnionFormed: case EventType.UnionDissolved: case EventType.RoyalMarriage: case EventType.SuccessionWar:
      case EventType.FaithFounded: case EventType.RulerConverted: case EventType.StateReligion: case EventType.Schism: case EventType.Persecution:
      case EventType.HolyWar: case EventType.HolyCityFell: case EventType.FaithDied: case EventType.FaithReached:
        break
      // tourism: leisure travel, resorts and sights (checked against their tables in tourism/tourism.test.ts).
      case EventType.LeisureTravel: case EventType.ResortFounded: case EventType.ResortInFashion: case EventType.ResortDeclined:
      case EventType.ResortAbandoned: case EventType.SightRecognised:
        break
      // renaming: places renamed (checked against History.renamings in renaming/renaming.test.ts).
      case EventType.PlaceRenamed:
        break
      // ideas: conceived, taken up, lost, refused (checked against History.ideaAdoptions in ideas/ideas.test.ts).
      case EventType.IdeaConceived: case EventType.IdeaAdopted: case EventType.IdeaLost: case EventType.IdeaResisted:
        expect(e.value >= 0 && e.value < h.ideas.length).toBe(true)
        break
      // landmarks: great landmarks begun, finished, given up, neglected, ruined, restored, rededicated (checked against History.landmarks in landmarks/landmarks.test.ts).
      case EventType.LandmarkBegun: case EventType.LandmarkCompleted: case EventType.LandmarkAbandoned: case EventType.LandmarkNeglected:
      case EventType.LandmarkRuined: case EventType.LandmarkRestored: case EventType.LandmarkConverted:
        expect(e.value >= 0 && e.value < h.landmarks.count).toBe(true)
        break
      // claims: border disputes (checked against History.polities in claims.test.ts).
      case EventType.BorderDispute:
        break
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
    } else if (x.type === StructureType.Walls) {
      expect(x.cell).toBe(owner.cell) // polities: walls on their town's cell
    } else if (x.type === StructureType.Fort) {
      if (w.elevation[x.cell] < 0) throw new Error(`fort ${k} at sea (cell ${x.cell})`) // polities v2: on land (polity2.test.ts checks the territory)
    } else if (x.type === StructureType.Mine || x.type === StructureType.Factory) {
      // goods: a mine on a worked deposit's cell, a factory on its host's (checked in goods/goods.test.ts)
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
      if (ta !== tb || ta === StructureType.Walls || ta === StructureType.Mine || ta === StructureType.Factory || !(ba < lb && bb < la)) continue // (polities: a town may have several rings of walls; goods: work several mines, sponsor several factories)
      if (sa === sb) throw new Error(`settlement ${sa} has two structures of type ${ta} in use at once`)
      if (ta === StructureType.Dam && ca === cb) throw new Error(`two dams in use on cell ${ca}`)
    }
  }

  // Journeys: one per Founded event with a real parent (an expedition's for a base), one per Migration event, one per expedition.
  const J = h.journeys
  const expectedJourneys = h.events.filter((e) => (e.type === EventType.Founded && e.other >= 0 && !h.settlements[e.settlement].outpost) || e.type === EventType.Migration).length
  let settlerJourneys = 0, expeditionJourneys = 0
  for (let j = 0; j < J.count; j++) { if (J.kind[j] === JourneyKind.Expedition) expeditionJourneys++; else if (J.kind[j] !== JourneyKind.Army) settlerJourneys++ } // (polities: armies are not settlers)
  expect(settlerJourneys).toBe(expectedJourneys)
  expect(expeditionJourneys).toBe(sent.length)
  // Every expedition is sent and comes home (or founds a base and the rest come home) in one year, or is lost.
  expect(returned.length).toBeLessThanOrEqual(sent.length)
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
    expect(J.kind[j] === JourneyKind.Settlers || J.kind[j] === JourneyKind.Migrants || J.kind[j] === JourneyKind.Expedition || J.kind[j] === JourneyKind.Army).toBe(true) // (polities: Army)
    const off0 = J.pathOffsets[j], off1 = J.pathOffsets[j + 1]
    expect(off1).toBeGreaterThan(off0)
    expect(J.path[off0]).toBe(h.settlements[J.from[j]].cell)
    if (J.kind[j] === JourneyKind.Expedition) {
      // `to`: the base founded, the sender again (came home, the path out and back), or -1 (lost).
      const to = J.to[j]
      expect(h.settlements[J.from[j]].outpost).toBe(false)
      if (to >= 0) expect(J.path[off1 - 1]).toBe(h.settlements[to].cell)
      if (to >= 0 && to !== J.from[j]) {
        expect(h.settlements[to].outpost).toBe(true)
        expect(h.settlements[to].parent).toBe(J.from[j])
        expect(h.settlements[to].foundedYear).toBe(J.arriveYear[j])
      }
      expect(sent.some((e) => e.year === J.arriveYear[j] && e.settlement === J.from[j] && e.value === J.size[j])).toBe(true)
      // (a goods trade expedition that came home may name the fort it founded at the far end: goods/routes.ts)
      if (to >= 0) expect(returned.some((e) => e.year === J.arriveYear[j] && e.settlement === J.from[j] && (e.other === (to === J.from[j] ? -1 : to) || (to === J.from[j] && e.other >= 0 && h.settlements[e.other].post)))).toBe(true)
    } else expect(J.path[off1 - 1]).toBe(h.settlements[J.to[j]].cell)
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

  // Named geography (names/featureNames.ts): valid, in naming order, named by a settlement founded by then, names unique.
  const names = new Set(h.settlements.map((s) => s.name.toLowerCase()))
  h.features.forEach((f, i) => {
    if (f.id !== i) throw new Error(`feature ${i} has id ${f.id}`)
    if (i > 0 && f.namedYear < h.features[i - 1].namedYear) throw new Error(`feature ${i} named out of order`)
    if (!(f.namedBy >= 0 && f.namedBy < S) || h.settlements[f.namedBy].foundedYear > f.namedYear) throw new Error(`feature ${i} named by ${f.namedBy} before its founding`)
    if (!(f.anchorCell >= 0 && f.anchorCell < N) || !(f.size > 0) || f.spine.some((c) => !(c >= 0 && c < N))) throw new Error(`feature ${i} has bad cells`)
    if (!f.name || names.has(f.name.toLowerCase())) throw new Error(`feature ${i} name "${f.name}" is empty or not unique`)
    names.add(f.name.toLowerCase())
  })
  checkPeoples(w, h, { lostVoyages, landfalls, contacts })
  checkTechnology(h, advances)
  checkSpecies(w, h, speciesEvents)
}

const fits = new WeakMap<World, Float32Array>()
function fitOf(w: World): Float32Array {
  let f = fits.get(w)
  if (!f) { f = speciesFit(w, true); fits.set(w, f) }
  return f
}
const baseFits = new WeakMap<World, Float32Array>()
const worldTerrain = new WeakMap<World, Terrain>()
function terrainOf(w: World): Terrain {
  let t = worldTerrain.get(w)
  if (!t) { t = buildTerrain(w); worldTerrain.set(w, t) }
  return t
}

/**
 * Species: the catalogue (origins on land where they fit, names unique), possession years and sources consistent
 * with contact and with the events, every people holding a staple from the start, the crop and herd layers.
 */
function checkSpecies(w: World, h: History, events: HistoryEvent[]): void {
  const N = w.grid.cellCount
  const P = h.peoples.length
  const S = h.settlements.length
  const X = h.species.length
  const fit = fitOf(w) // (improved strains included: the crop layer)
  const baseFit = baseFits.get(w) ?? speciesFit(w)
  baseFits.set(w, baseFit)
  expect(X).toBe(S_COUNT)
  const names = new Set<string>()
  h.species.forEach((x, i) => {
    expect(x.id).toBe(i)
    expect(x.archetype).toBe(SPECIES_TABLE[i].archetype)
    expect(Object.values(SpeciesCategory)).toContain(x.category)
    if (!x.name || names.has(x.name.toLowerCase())) throw new Error(`species ${i} name "${x.name}" is empty or not unique`)
    names.add(x.name.toLowerCase())
    if (!(x.origins.length >= 1 && x.origins.length <= 2)) throw new Error(`species ${i} has ${x.origins.length} origins`)
    for (const c of x.origins) {
      if (!(c >= 0 && c < N) || w.elevation[c] < 0) throw new Error(`species ${i} origin ${c} is not land`)
      if (!(baseFit[i * N + c] > 0)) throw new Error(`species ${i} (${x.archetype}) native to cell ${c} where it does not grow`)
    }
    if (x.category === SpeciesCategory.Staple) expect(x.yield).toBeGreaterThan(0)
    else expect(x.yield).toBe(0)
  })
  // Possession: years and sources.
  expect(h.speciesYear.length).toBe(P * X)
  expect(h.speciesSource.length).toBe(P * X)
  for (let p = 0; p < P; p++) {
    let staple = false
    for (let x = 0; x < X; x++) {
      const y = h.speciesYear[p * X + x], src = h.speciesSource[p * X + x]
      if (!(y === -1 || (y >= 0 && y <= h.years))) throw new Error(`speciesYear[${p}, ${x}] = ${y}`)
      if (y === 0 && h.species[x].category === SpeciesCategory.Staple) staple = true
      if (y <= 0 && src !== -1) throw new Error(`people ${p} has species ${x} (year ${y}) from people ${src}`)
      if (src >= 0) {
        if (!(src < P) || src === p) throw new Error(`people ${p} got species ${x} from people ${src}`)
        // Only from a people met by then.
        const met = h.contactYear[p * P + src]
        if (!(met >= 0 && met <= y)) throw new Error(`people ${p} got species ${x} from people ${src} in ${y}, met in ${met}`)
      }
    }
    if (!staple) throw new Error(`people ${p} holds no staple from the start`)
  }
  // Events: one per people and species gained after the start, matching the years and sources.
  const seen = new Uint8Array(P * X)
  for (const e of events) {
    const p = h.settlements[e.settlement].people
    const alive = (id: number) => h.settlements[id].foundedYear <= e.year && (h.settlements[id].abandonedYear < 0 || h.settlements[id].abandonedYear >= e.year)
    if (e.type === EventType.Epidemic) {
      expect(e.other).toBeGreaterThanOrEqual(0)
      const q = h.settlements[e.other].people
      expect(q).not.toBe(p)
      if (!alive(e.other)) throw new Error(`epidemic in ${e.year} from settlement ${e.other}, not alive then`)
      const met = h.contactYear[p * P + q]
      if (!(met >= 0 && met <= e.year)) throw new Error(`epidemic among people ${p} from people ${q} in ${e.year}, met in ${met}`)
      if (!(e.value > 0 && e.value <= DISEASE.max + 1e-9)) throw new Error(`epidemic mortality ${e.value}`)
      continue
    }
    const x = e.value
    if (!(Number.isInteger(x) && x >= 0 && x < X)) throw new Error(`species event value ${x}`)
    if (seen[p * X + x]) throw new Error(`people ${p} gained species ${x} twice`)
    seen[p * X + x] = 1
    expect(h.speciesYear[p * X + x]).toBe(e.year)
    expect(e.year).toBeGreaterThan(0)
    if (e.type === EventType.Domesticated) {
      expect(e.other).toBe(-1)
      expect(h.speciesSource[p * X + x]).toBe(-1)
    } else {
      expect(e.other).toBeGreaterThanOrEqual(0)
      if (!alive(e.other)) throw new Error(`species ${x} adopted in ${e.year} from settlement ${e.other}, not alive then`)
      const q = h.settlements[e.other].people
      expect(q).not.toBe(p)
      expect(h.speciesSource[p * X + x]).toBe(q)
      // The source people held it by then.
      const yq = h.speciesYear[q * X + x]
      if (!(yq >= 0 && yq <= e.year)) throw new Error(`people ${p} adopted species ${x} in ${e.year} from people ${q}, who held it from ${yq}`)
    }
  }
  for (let p = 0; p < P; p++) for (let x = 0; x < X; x++) {
    const y = h.speciesYear[p * X + x]
    if (y > 0 && !seen[p * X + x]) throw new Error(`people ${p} holds species ${x} from ${y} without an event`)
  }
  // Crop and herd layers: 0 where nothing is farmed, else a staple / an animal that suits the cell, held by the people of
  // a settlement farming within reach of it at that time.
  expect(h.crop.length).toBe(h.landSnapshotCount * N)
  expect(h.herd.length).toBe(h.landSnapshotCount * N)
  const T = terrainOf(w)
  const reach = new Int32Array(N)
  for (let q = 0; q < h.landSnapshotCount; q++) {
    const year = q * h.landInterval
    const sq = Math.min(h.snapshotCount - 1, Math.floor(year / h.snapshotInterval))
    // Peoples farming within reach of each cell (bits; at most 31 peoples tracked, enough here).
    reach.fill(0)
    for (let id = 0; id < S; id++) {
      // (living at the land snapshot's year: with a snapshot interval that does not divide it, the population snapshot is earlier)
      const st = h.settlements[id]
      if ((h.population[sq * S + id] <= 0 && !(st.foundedYear <= year && (st.abandonedYear < 0 || st.abandonedYear > year))) || st.outpost) continue
      const c = h.settlements[id].cell
      for (let k = T.catchOff[c]; k < T.catchOff[c + 1]; k++) reach[T.catchCell[k]] |= 1 << (h.settlements[id].people & 31)
    }
    for (let i = 0; i < N; i++) {
      for (const [layer, cat] of [[h.crop, SpeciesCategory.Staple], [h.herd, SpeciesCategory.Livestock]] as const) {
        const v = layer[q * N + i]
        if (v === 0) continue
        if (h.landUse[q * N + i] === 0) throw new Error(`cell ${i} unfarmed at land snapshot ${q} but crop / herd ${v}`)
        const x = v - 1
        if (!(x < X) || h.species[x].category !== cat) throw new Error(`cell ${i} layer value ${v} is not a ${cat === SpeciesCategory.Staple ? 'staple' : 'herd'}`)
        if (!(fit[x * N + i] > 0)) throw new Error(`cell ${i} grows species ${x} where it does not fit (land snapshot ${q})`)
        let held = false
        for (let p = 0; p < P && !held; p++) {
          if (!(reach[i] & (1 << (p & 31)))) continue
          const y = h.speciesYear[p * X + x]
          if (y >= 0 && y <= year) held = true
        }
        if (!held) throw new Error(`cell ${i} grows species ${x} at year ${year} but no people farming near it holds it`)
      }
    }
  }
  // Year 0: nothing farmed yet.
  for (let i = 0; i < N; i++) if (h.crop[i] !== 0 || h.herd[i] !== 0) throw new Error(`cell ${i} has a crop or herd at year 0`)
}

/** Technology: layout, bounds, 0 for peoples that died out, non-decreasing (ideas: but for a people that had lost an idea), TechAdvance once per whole level. */
function checkTechnology(h: History, advances: HistoryEvent[]): void {
  const P = h.peoples.length
  const lostBy = new Int32Array(P).fill(1 << 30) // ideas: the first year each people lost an idea
  for (let k = 0; k < h.ideaAdoptions.count; k++) if (h.ideaAdoptions.how[k] === IdeaHow.Lost) lostBy[h.ideaAdoptions.people[k]] = Math.min(lostBy[h.ideaAdoptions.people[k]], h.ideaAdoptions.year[k])
  const S = h.settlements.length
  const Fc = TECH_FIELD_COUNT
  expect(h.technology.length).toBe(h.snapshotCount * P * Fc)
  const alive = new Uint8Array(P)
  for (let q = 0; q < h.snapshotCount; q++) {
    alive.fill(0)
    for (let id = 0; id < S; id++) if (h.population[q * S + id] > 0 && !h.settlements[id].outpost) alive[h.settlements[id].people] = 1
    for (let p = 0; p < P; p++) {
      for (let f = 0; f < Fc; f++) {
        const v = h.technology[(q * P + p) * Fc + f]
        if (!Number.isFinite(v)) throw new Error(`technology not finite at snapshot ${q}, people ${p}, field ${f}`)
        if (!alive[p]) { if (v !== 0) throw new Error(`people ${p} has no living settlement at snapshot ${q} but technology ${v}`); continue }
        if (!(v >= 1 - 1e-6 && v < 20)) throw new Error(`technology ${v} out of bounds at snapshot ${q}, people ${p}, field ${f}`)
        if (q > 0) {
          const before = h.technology[((q - 1) * P + p) * Fc + f]
          if (before > 0 && v < before - 1e-5 && lostBy[p] > q * h.snapshotInterval) throw new Error(`technology fell from ${before} to ${v} (snapshot ${q}, people ${p}, field ${f})`)
        }
      }
    }
  }
  // TechAdvance: the k-th event of a people in a field marks level k + 1, reached that year (seen at the next snapshot, not at the one before).
  const seen = new Int32Array(P * Fc)
  for (const e of advances) {
    const p = h.settlements[e.settlement].people
    const level = 2 + seen[p * Fc + e.value]++
    const after = Math.ceil(e.year / h.snapshotInterval)
    if (after < h.snapshotCount) expect(h.technology[(after * P + p) * Fc + e.value]).toBeGreaterThanOrEqual(level - 1e-4)
    const prior = Math.ceil(e.year / h.snapshotInterval) - 1
    if (prior >= 0) expect(h.technology[(prior * P + p) * Fc + e.value]).toBeLessThan(level + 1e-4)
  }
  // Every whole level a living people holds was announced.
  const last = h.snapshotCount - 1
  for (let p = 0; p < P; p++) for (let f = 0; f < Fc; f++) {
    const v = h.technology[(last * P + p) * Fc + f]
    if (!(v > 0)) continue
    expect(seen[p * Fc + f]).toBeGreaterThanOrEqual(Math.floor(v - 1e-4) - 1)
    expect(seen[p * Fc + f]).toBeLessThanOrEqual(Math.floor(v + 1e-4) - 1)
  }
}

/** Landmass label per cell (land connected through land neighbours), -1 for sea. */
function landmasses(w: World): { label: Int32Array; size: number[] } {
  const N = w.grid.cellCount
  const { neighborOffsets: off, neighbors: nb } = w.grid
  const label = new Int32Array(N).fill(-1)
  const size: number[] = []
  for (let s = 0; s < N; s++) {
    if (w.elevation[s] < 0 || label[s] >= 0) continue
    const id = size.length
    const stack = [s]
    label[s] = id
    let n = 0
    while (stack.length > 0) {
      const c = stack.pop() as number
      n++
      for (let k = off[c]; k < off[c + 1]; k++) {
        const j = nb[k]
        if (w.elevation[j] >= 0 && label[j] < 0) { label[j] = id; stack.push(j) }
      }
    }
    size.push(n)
  }
  return { label, size }
}

/** Peoples, knowledge, contact and the events that go with them. */
function checkPeoples(w: World, h: History, ev: { lostVoyages: HistoryEvent[]; landfalls: HistoryEvent[]; contacts: HistoryEvent[] }): void {
  const N = w.grid.cellCount
  const P = h.peoples.length
  const { neighborOffsets: off, neighbors: nb } = w.grid
  // Peoples: one per original tribe, in founding order; every settlement in its parent's people.
  const tribes = h.settlements.filter((st) => st.parent === -1)
  expect(P).toBe(tribes.length)
  const peopleNames = new Set<string>()
  h.peoples.forEach((p, i) => {
    expect(p.id).toBe(i)
    expect(Number.isInteger(p.cradle) && p.cradle >= 0 && p.cradle < 4).toBe(true)
    if (i > 0) expect(p.cradle).toBeGreaterThanOrEqual(h.peoples[i - 1].cradle) // tribes are planned cradle by cradle
    expect(p.founder).toBe(tribes[i].id)
    expect(h.settlements[p.founder].people).toBe(i)
    if (!p.name || peopleNames.has(p.name.toLowerCase())) throw new Error(`people ${i} name "${p.name}" is empty or not unique`)
    peopleNames.add(p.name.toLowerCase())
  })
  for (const st of h.settlements) {
    if (!(Number.isInteger(st.people) && st.people >= 0 && st.people < P)) throw new Error(`settlement ${st.id} has people ${st.people}`)
    if (st.parent >= 0 && st.people !== h.settlements[st.parent].people) throw new Error(`settlement ${st.id} is not of its parent's people`)
  }
  // Knowledge: -1 or a year of the run; every settlement's cell known to its people from its founding.
  expect(h.knownYear.length).toBe(P * N)
  for (let i = 0; i < h.knownYear.length; i++) {
    const y = h.knownYear[i]
    if (!(y === -1 || (y >= 0 && y <= h.years))) throw new Error(`knownYear[${i}] = ${y}`)
  }
  for (const st of h.settlements) {
    const y = h.knownYear[st.people * N + st.cell]
    if (!(y >= 0 && y <= st.foundedYear)) throw new Error(`settlement ${st.id}'s cell known to its people in ${y}, founded ${st.foundedYear}`)
  }
  // Every journey's path is known to the travelling people by its arrival.
  const J = h.journeys
  for (let j = 0; j < J.count; j++) {
    if (J.kind[j] === JourneyKind.Expedition && J.to[j] < 0) continue // a lost expedition brought nothing home
    const p = h.settlements[J.from[j]].people
    for (let k = J.pathOffsets[j]; k < J.pathOffsets[j + 1]; k++) {
      const y = h.knownYear[p * N + J.path[k]]
      if (!(y >= 0 && y <= J.arriveYear[j])) throw new Error(`journey ${j} passes cell ${J.path[k]}, known to its people in ${y}, arriving ${J.arriveYear[j]}`)
    }
  }
  // Contact: symmetric, 0 on the diagonal, -1 or a year of the run; one FirstContact per pair that met, in that year.
  expect(h.contactYear.length).toBe(P * P)
  for (let a = 0; a < P; a++) {
    expect(h.contactYear[a * P + a]).toBe(0)
    for (let b = 0; b < P; b++) {
      const y = h.contactYear[a * P + b]
      if (y !== h.contactYear[b * P + a]) throw new Error(`contactYear not symmetric for ${a}, ${b}`)
      if (a !== b && !(y === -1 || (y >= 0 && y <= h.years))) throw new Error(`contactYear[${a}, ${b}] = ${y}`)
    }
  }
  const seenPair = new Set<number>()
  const alive = (id: number, year: number): boolean => {
    const st = h.settlements[id]
    return year >= st.foundedYear && (st.abandonedYear < 0 || year <= st.abandonedYear)
  }
  for (const e of ev.contacts) {
    const pa = h.settlements[e.settlement].people
    expect(e.other).toBeGreaterThanOrEqual(0)
    const pb = h.settlements[e.other].people
    expect(e.value).toBe(pb)
    expect(pa).not.toBe(pb)
    if (!alive(e.other, e.year)) throw new Error(`FirstContact in ${e.year} through settlement ${e.other}, not alive then`)
    const key = Math.min(pa, pb) * P + Math.max(pa, pb)
    if (seenPair.has(key)) throw new Error(`peoples ${pa} and ${pb} met twice`)
    seenPair.add(key)
    expect(h.contactYear[pa * P + pb]).toBe(e.year)
  }
  let pairsMet = 0
  for (let a = 0; a < P; a++) for (let b = a + 1; b < P; b++) if (h.contactYear[a * P + b] >= 0) pairsMet++
  expect(seenPair.size).toBe(pairsMet)
  // Trade only between peoples that had met by the route's opening.
  const tr = h.trade
  for (let r = 0; r < tr.count; r++) {
    const pa = h.settlements[tr.a[r]].people, pb = h.settlements[tr.b[r]].people
    if (pa === pb) continue
    const y = h.contactYear[pa * P + pb]
    if (!(y >= 0 && y <= tr.openedYear[r])) throw new Error(`route ${r} opened in ${tr.openedYear[r]} between peoples ${pa} and ${pb} who met in ${y}`)
  }
  // Landfall: the first settlement ever on a landmass, unless an original tribe; exactly one per such landmass.
  const lm = landmasses(w)
  const first = new Int32Array(lm.size.length).fill(-1)
  for (const st of h.settlements) if (first[lm.label[st.cell]] < 0) first[lm.label[st.cell]] = st.id
  const landfallAt = new Int32Array(lm.size.length).fill(-1)
  for (const e of ev.landfalls) {
    const st = h.settlements[e.settlement]
    const m = lm.label[st.cell]
    if (landfallAt[m] >= 0) throw new Error(`two Landfall events on landmass ${m}`)
    landfallAt[m] = e.settlement
    expect(first[m]).toBe(e.settlement)
    expect(st.parent).toBeGreaterThanOrEqual(0)
    expect(e.other).toBe(st.parent)
    expect(e.year).toBe(st.foundedYear)
    expect(e.value).toBe(lm.size[m])
  }
  for (let m = 0; m < lm.size.length; m++) if (first[m] >= 0 && h.settlements[first[m]].parent >= 0) expect(landfallAt[m]).toBe(first[m])
  // VoyageLost: from a coastal settlement alive that year.
  for (const e of ev.lostVoyages) {
    if (!alive(e.settlement, e.year)) throw new Error(`VoyageLost from ${e.settlement}, not alive in ${e.year}`)
    const c = h.settlements[e.settlement].cell
    let coastal = false
    for (let k = off[c]; k < off[c + 1]; k++) if (w.elevation[nb[k]] < 0) coastal = true
    if (!coastal) throw new Error(`VoyageLost from inland settlement ${e.settlement}`)
  }
}

/**
 * `short` is the start of `long` (same world, shorter run): every field agrees up to short.years.
 * "First year" values beyond short.years in the long run (knownYear, contactYear, abandonedYear,
 * lostYear) are -1 in the short one.
 */
function expectPrefix(short: History, long: History): void {
  const Y = short.years
  const S0 = short.settlements.length
  const S1 = long.settlements.length
  expect(S0).toBeLessThanOrEqual(S1)
  const later = (a: number, b: number) => a === b || (a === -1 && b > Y)
  for (let id = 0; id < S0; id++) {
    const a = short.settlements[id], b = long.settlements[id]
    expect([b.id, b.cell, b.foundedYear, b.parent, b.name, b.people, b.outpost]).toEqual([a.id, a.cell, a.foundedYear, a.parent, a.name, a.people, a.outpost])
    if (!later(a.abandonedYear, b.abandonedYear)) throw new Error(`settlement ${id} abandoned ${a.abandonedYear} vs ${b.abandonedYear}`)
  }
  for (let id = S0; id < S1; id++) expect(long.settlements[id].foundedYear).toBeGreaterThan(Y)
  for (let q = 0; q < short.snapshotCount; q++) {
    for (let id = 0; id < S0; id++) {
      for (const [x, y] of [[short.population, long.population], [short.food, long.food], [short.wealth, long.wealth]]) {
        if (x[q * S0 + id] !== y[q * S1 + id]) throw new Error(`snapshot ${q} differs for settlement ${id}`)
      }
    }
  }
  const N = short.capacity.length
  expect(Array.from(long.capacity)).toEqual(Array.from(short.capacity))
  for (const [x, y] of [[short.landUse, long.landUse], [short.degradation, long.degradation], [short.road, long.road]]) {
    for (let i = 0; i < short.landSnapshotCount * N; i++) if (x[i] !== y[i]) throw new Error(`land snapshot differs at ${i}`)
  }
  // Events up to Y in the same order; journeys arriving by Y in the same order.
  const evL = long.events.filter((e) => e.year <= Y)
  expect(evL.length).toBe(short.events.length)
  for (let i = 0; i < evL.length; i++) expect(evL[i]).toEqual(short.events[i])
  const J0 = short.journeys, J1 = long.journeys
  let j1 = 0
  for (let j = 0; j < J0.count; j++) {
    while (J1.arriveYear[j1] > Y) j1++
    expect([J1.departYear[j1], J1.arriveYear[j1], J1.from[j1], J1.to[j1], J1.size[j1], J1.kind[j1]]).toEqual([J0.departYear[j], J0.arriveYear[j], J0.from[j], J0.to[j], J0.size[j], J0.kind[j]])
    expect(Array.from(J1.path.subarray(J1.pathOffsets[j1], J1.pathOffsets[j1 + 1]))).toEqual(Array.from(J0.path.subarray(J0.pathOffsets[j], J0.pathOffsets[j + 1])))
    j1++
  }
  for (; j1 < J1.count; j1++) if (!(J1.arriveYear[j1] > Y)) throw new Error(`long run has an extra journey arriving in ${J1.arriveYear[j1]}`)
  // Structures, trade routes and volumes.
  for (let k = 0; k < short.structures.length; k++) {
    const a = short.structures[k], b = long.structures[k]
    expect([b.id, b.type, b.cell, b.settlement, b.builtYear]).toEqual([a.id, a.type, a.cell, a.settlement, a.builtYear])
    if (!later(a.lostYear, b.lostYear)) throw new Error(`structure ${k} lost ${a.lostYear} vs ${b.lostYear}`)
  }
  for (let k = short.structures.length; k < long.structures.length; k++) expect(long.structures[k].builtYear).toBeGreaterThan(Y)
  const R0 = short.trade.count, R1 = long.trade.count
  for (let r = 0; r < R0; r++) {
    expect([long.trade.a[r], long.trade.b[r], long.trade.openedYear[r]]).toEqual([short.trade.a[r], short.trade.b[r], short.trade.openedYear[r]])
    expect(Array.from(long.trade.path.subarray(long.trade.pathOffsets[r], long.trade.pathOffsets[r + 1]))).toEqual(Array.from(short.trade.path.subarray(short.trade.pathOffsets[r], short.trade.pathOffsets[r + 1])))
  }
  for (let r = R0; r < R1; r++) expect(long.trade.openedYear[r]).toBeGreaterThan(Y)
  for (let q = 0; q < short.tradeSnapshotCount; q++) for (let r = 0; r < R0; r++) if (short.tradeVolume[q * R0 + r] !== long.tradeVolume[q * R1 + r]) throw new Error(`trade snapshot ${q} differs on route ${r}`)
  // Peoples; knowledge and contact years as of Y.
  expect(long.peoples).toEqual(short.peoples)
  expect(long.knownYear.length).toBe(short.knownYear.length)
  for (let i = 0; i < short.knownYear.length; i++) if (!later(short.knownYear[i], long.knownYear[i])) throw new Error(`knownYear[${i}] ${short.knownYear[i]} vs ${long.knownYear[i]}`)
  for (let i = 0; i < short.contactYear.length; i++) if (!later(short.contactYear[i], long.contactYear[i])) throw new Error(`contactYear[${i}] ${short.contactYear[i]} vs ${long.contactYear[i]}`)
  // Species: the same catalogue (names of species held by Y alike), possession as of Y, crop and herd layers.
  expect(long.species.length).toBe(short.species.length)
  const X = short.species.length
  for (let x = 0; x < X; x++) {
    const a = short.species[x], b = long.species[x]
    expect([b.id, b.archetype, b.category, b.yield, b.origins]).toEqual([a.id, a.archetype, a.category, a.yield, a.origins])
    let held = false
    for (let p = 0; p < short.peoples.length; p++) if (short.speciesYear[p * X + x] >= 0) held = true
    if (held) expect(b.name).toBe(a.name)
  }
  for (let i = 0; i < short.speciesYear.length; i++) {
    if (!later(short.speciesYear[i], long.speciesYear[i])) throw new Error(`speciesYear[${i}] ${short.speciesYear[i]} vs ${long.speciesYear[i]}`)
    const want = short.speciesYear[i] >= 0 ? long.speciesSource[i] : -1
    if (short.speciesSource[i] !== want) throw new Error(`speciesSource[${i}] ${short.speciesSource[i]} vs ${long.speciesSource[i]}`)
  }
  for (const [x, y] of [[short.crop, long.crop], [short.herd, long.herd]]) {
    for (let i = 0; i < short.landSnapshotCount * N; i++) if (x[i] !== y[i]) throw new Error(`crop / herd snapshot differs at ${i}`)
  }
  // Technology snapshots up to Y.
  expect(long.technology.length).toBeGreaterThanOrEqual(short.technology.length)
  for (let i = 0; i < short.technology.length; i++) if (short.technology[i] !== long.technology[i]) throw new Error(`technology differs at ${i}`)
  // Named geography up to Y: same features in the same order, named by the same settlements, alike.
  const fL = long.features.filter((f) => f.namedYear <= Y)
  expect(fL.length).toBe(short.features.length)
  for (let i = 0; i < fL.length; i++) expect([fL[i].kind, fL[i].name, fL[i].namedYear, fL[i].namedBy, fL[i].anchorCell, fL[i].size]).toEqual([short.features[i].kind, short.features[i].name, short.features[i].namedYear, short.features[i].namedBy, short.features[i].anchorCell, short.features[i].size])
}

describe('simulateHistory', () => {
  it('is deterministic: same world gives a bit-identical history; different seeds differ', () => {
    const a = hashHistory(simulateHistory(world(42)))
    const b = hashHistory(simulateHistory(generateWorld(42)))
    expect(b).toBe(a)
    expect(hashHistory(history(1))).not.toBe(a)
    expect(hashHistory(history(2))).not.toBe(hashHistory(history(1)))
  }, 300_000)

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
    // Knowledge: an Int16 per people per cell (under 1 MB at the default grid).
    expect(h.knownYear.byteLength).toBeLessThan(1024 * 1024)
    expect(h.wealth.length).toBe(401 * h.settlements.length)
    const t = h.trade
    // Crop and herd layers: a byte per cell per land snapshot each (under 5 MB together).
    expect(h.crop.length).toBe(101 * h.capacity.length)
    expect(h.crop.byteLength + h.herd.byteLength).toBeLessThan(5 * 1024 * 1024)
    expect(h.speciesYear.length).toBe(h.peoples.length * h.species.length)
    const arrays = [h.population, h.food, h.capacity, h.landUse, h.degradation, h.road, h.wealth, h.tradeVolume, J.departYear, J.arriveYear, J.from, J.to, J.size, J.kind, J.pathOffsets, J.path,
      t.a, t.b, t.openedYear, t.goodAB, t.goodBA, t.pathOffsets, t.path, h.knownYear, h.contactYear, h.technology, h.speciesYear, h.speciesSource, h.crop, h.herd]
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
    // Peoples, knowledge and contact as of year 200.
    expectPrefix(short, full)
    const zero = simulateHistory(w, { years: 0 })
    expect(zero.snapshotCount).toBe(1)
    expect(zero.landSnapshotCount).toBe(1)
    expect(zero.tradeSnapshotCount).toBe(1)
    expect(zero.trade.count).toBe(0)
    expect(zero.structures.length).toBe(0)
    checkInvariants(w, zero)
  })

  it('a longer run reproduces the first 2000 years exactly, stays finite and alive to year 3000', () => {
    for (const seed of [3, 42]) {
      const w = world(seed)
      const short = history(seed)
      const long = simulateHistory(w, { years: 3000 })
      expect(long.years).toBe(3000)
      checkInvariants(w, long)
      expectPrefix(short, long)
      // Finite everywhere, people alive at the end, no runaway.
      const S = long.settlements.length
      const last = long.snapshotCount - 1
      for (const a of [long.population, long.food, long.wealth, long.tradeVolume]) for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) throw new Error(`seed ${seed}: non-finite value at ${i}`)
      let total = 0, living = 0, total2000 = 0
      for (let id = 0; id < S; id++) {
        const p = long.population[last * S + id]
        if (p > 0) { living++; total += p }
        total2000 += long.population[400 * S + id]
      }
      expect(living).toBeGreaterThan(100)
      expect(total).toBeGreaterThan(total2000)
      expect(total).toBeLessThan(5 * total2000)
    }
  }, 300_000)

  it('a resumable run gives the same histories as runs from scratch, each owning its arrays', () => {
    const w = world(42)
    const run = createHistoryRun(w)
    const a = run.advanceTo(2000)
    expect(run.year).toBe(2000)
    const hashA = hashHistory(a)
    expect(hashA).toBe(hashHistory(history(42)))
    const b = run.advanceTo(2400)
    expect(hashHistory(b)).toBe(hashHistory(simulateHistory(w, { years: 2400 })))
    // The first history is untouched by the extension; going back reruns from scratch.
    expect(hashHistory(a)).toBe(hashA)
    expect(hashHistory(run.advanceTo(300))).toBe(hashHistory(simulateHistory(w, { years: 300 })))
    expect(run.year).toBe(2400)
    // No array is shared between the two histories (each may be transferred on its own).
    const buffers = (h: History) => [h.population, h.food, h.wealth, h.capacity, h.landUse, h.degradation, h.road, h.tradeVolume, h.knownYear, h.contactYear, h.technology, h.speciesYear, h.speciesSource, h.crop, h.herd,
      h.trade.a, h.trade.path, h.journeys.path, h.journeys.departYear].map((x) => x.buffer)
    const seen = new Set(buffers(a))
    for (const buf of buffers(b)) expect(seen.has(buf)).toBe(false)
    expect(a.events).not.toBe(b.events)
    expect(a.structures[0]).not.toBe(b.structures[0])
  }, 300_000)

  it('runs at other resolutions', () => {
    const w = generateWorld(9, { subdivisions: 24 })
    const h = simulateHistory(w, { years: 800 })
    checkInvariants(w, h)
    expect(h.settlements.length).toBeGreaterThan(4)
  })

  it('every history satisfies the structural invariants', () => {
    for (const seed of SEEDS) checkInvariants(world(seed), history(seed))
  }, 300_000)

  it('no extinction, no early saturation, setbacks happen, sizes are heavy-tailed', () => {
    let heavy = 0, joined = 0
    for (const seed of SEEDS) {
      const h = history(seed)
      const S = h.settlements.length
      const total = (s: number) => { let t = 0; for (let id = 0; id < S; id++) t += h.population[s * S + id]; return t }
      const living = (s: number) => { let n = 0; for (let id = 0; id < S; id++) if (h.population[s * S + id] > 0) n++; return n }
      const last = h.snapshotCount - 1
      const at = (year: number) => Math.floor(year / h.snapshotInterval)
      // Founders: several tribes in a few cradles.
      expect(living(0)).toBeGreaterThanOrEqual(4)
      expect(living(0)).toBeLessThanOrEqual(12)
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
  }, 300_000)

  it('peoples: several cradles; neighbours meet early, other cradles later; knowledge spreads', () => {
    let sep500 = 0, sep1000 = 0, merged2000 = 0, extinctEarly = 0
    const inner: number[] = [], cross: number[] = [], unknown500: number[] = [], unknown2000: number[] = []
    let innerPairs = 0, crossPairs = 0
    for (const seed of SEEDS) {
      const w = world(seed)
      const { history: h, diag } = run(seed)
      const P = h.peoples.length
      const N = w.grid.cellCount
      const S = h.settlements.length
      const cradle = diag.cradles?.cradle ?? []
      expect(cradle.length).toBe(P)
      const K = Math.max(...cradle) + 1
      expect(K).toBeGreaterThanOrEqual(2)
      expect(K).toBeLessThanOrEqual(4)
      for (let k = 0; k < K; k++) {
        const n = cradle.filter((c) => c === k).length
        expect(n).toBeGreaterThanOrEqual(1)
        expect(n).toBeLessThanOrEqual(4)
      }
      // Contact networks (components of the contact graph) as of a year.
      const networks = (year: number): number => {
        const lab = h.peoples.map((_, i) => i)
        const find = (x: number): number => { while (lab[x] !== x) x = lab[x]; return x }
        for (let a = 0; a < P; a++) for (let b = a + 1; b < P; b++) {
          const y = h.contactYear[a * P + b]
          if (y >= 0 && y <= year) { const ra = find(a), rb = find(b); if (ra !== rb) lab[Math.max(ra, rb)] = Math.min(ra, rb) }
        }
        let n = 0
        for (let p = 0; p < P; p++) if (find(p) === p) n++
        return n
      }
      if (networks(500) >= 2) sep500++
      if (networks(1000) >= 2) sep1000++
      if (networks(2000) <= 2) merged2000++
      const best = new Map<number, number>()
      for (let a = 0; a < P; a++) for (let b = a + 1; b < P; b++) {
        const y = h.contactYear[a * P + b]
        if (cradle[a] === cradle[b]) { innerPairs++; if (y >= 0) inner.push(y) }
        else {
          const key = Math.min(cradle[a], cradle[b]) * 8 + Math.max(cradle[a], cradle[b])
          const cur = best.get(key)
          if (cur === undefined || (y >= 0 && (cur < 0 || y < cur))) best.set(key, y)
        }
      }
      for (const key of [...best.keys()].sort((x, y) => x - y)) { crossPairs++; const y = best.get(key) as number; if (y >= 0) cross.push(y) }
      // Land known to nobody.
      const unknownAt = (year: number): number => {
        let land = 0, unk = 0
        for (let i = 0; i < N; i++) {
          if (w.elevation[i] < 0) continue
          land++
          let k = false
          for (let p = 0; p < P && !k; p++) { const y = h.knownYear[p * N + i]; if (y >= 0 && y <= year) k = true }
          if (!k) unk++
        }
        return unk / land
      }
      unknown500.push(unknownAt(500))
      unknown2000.push(unknownAt(2000))
      // Lost expeditions and landfalls on empty land happen.
      expect(h.events.some((e) => e.type === EventType.VoyageLost)).toBe(true)
      expect(h.events.some((e) => e.type === EventType.Landfall)).toBe(true)
      // A whole cradle dying out before year 1000 is rare.
      for (let k = 0; k < K; k++) {
        for (let q = 0; q <= 1000 / h.snapshotInterval; q++) {
          let alive = false
          for (let id = 0; id < S && !alive; id++) if (h.population[q * S + id] > 0 && cradle[h.settlements[id].people] === k) alive = true
          if (!alive) { extinctEarly++; break }
        }
      }
    }
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]
    // Separate civilisations for a long stretch, mostly one or two networks by the end.
    expect(sep500).toBe(SEEDS.length)
    expect(sep1000).toBeGreaterThanOrEqual(SEEDS.length / 2)
    expect(merged2000).toBeGreaterThanOrEqual(SEEDS.length - 2)
    // Neighbours within a cradle meet within the first centuries; cradles meet later, mostly 600-1600.
    expect(inner.length).toBeGreaterThanOrEqual(0.9 * innerPairs)
    expect(med(inner)).toBeLessThan(600)
    expect(cross.length).toBeGreaterThanOrEqual(0.8 * crossPairs)
    expect(med(cross)).toBeGreaterThan(600)
    expect(med(cross)).toBeLessThan(1600)
    // Most of the world is unknown to everyone at first, nearly none of it by the end.
    expect(med(unknown500)).toBeGreaterThan(0.4)
    expect(med(unknown2000)).toBeLessThan(0.1)
    expect(extinctEarly).toBeLessThanOrEqual(1)
  }, 300_000)

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
  }, 300_000)

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
      expect(abandoned / S).toBeLessThan(0.27) // (goods: was 0.25; trade towns and posts draw people a little more from villages)
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
      expect(nd).toBeLessThanOrEqual(40) // (frontier alone needed 45 and polities alone 50 on their old base; merged with species v1 the most is 31, seed 1337)
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
  }, 300_000)

  it('seaborne foundings sail over water from a coastal origin to a coastal landfall, longer voyages taking longer', () => {
    for (const seed of SEEDS) {
      const w = world(seed)
      const h = history(seed)
      const T = terrain(seed)
      const J = h.journeys
      let voyages = 0, overseas = 0
      const len: number[] = [], dur: number[] = []
      for (let j = 0; j < J.count; j++) {
        if (J.kind[j] !== JourneyKind.Settlers) continue
        const a = J.pathOffsets[j], b = J.pathOffsets[j + 1]
        const inner = b - a - 2
        let sea = 0
        for (let k = a + 1; k < b - 1; k++) if (w.elevation[J.path[k]] < 0) sea++
        if (inner < 3 || sea < inner) continue // voyages: every cell between origin and landfall is water
        voyages++
        const from = J.path[a], to = J.path[b - 1]
        // A coastal origin and a coastal landfall: land cells, the route leaving and arriving over water.
        if (w.elevation[from] < 0 || w.elevation[to] < 0 || !T.seaCoast[from] || !T.seaCoast[to]) throw new Error(`seed ${seed}: voyage ${j} does not run coast to coast`)
        const d = J.arriveYear[j] - J.departYear[j]
        if (!(d > 0 && d <= 5)) throw new Error(`seed ${seed}: voyage ${j} over ${inner} sea cells takes ${d} years`)
        if (T.landmass[from] !== T.landmass[to]) overseas++
        len.push(inner)
        dur.push(d)
      }
      expect(voyages).toBeGreaterThan(20)
      expect(overseas).toBeGreaterThan(10)
      // Longer voyages take longer (unless the departure is clipped to the sender's founding).
      const order = len.map((_, i) => i).sort((x, y) => len[x] - len[y] || x - y)
      const half = order.length >> 1
      let short = 0, long = 0
      for (let i = 0; i < half; i++) { short += dur[order[i]]; long += dur[order[order.length - 1 - i]] }
      expect(long).toBeGreaterThan(short)
    }
  }, 300_000)

  it('voyages carry settlers to continents without a cradle, which fill up after the cradles, and to most islands', () => {
    let eligible = 0, second = 0, early = 0, frontier = 0, lag = 0, filled = 0, islandSeeds = 0
    for (const seed of SEEDS) {
      const h = history(seed)
      const T = terrain(seed)
      const N = T.cellCount
      const S = h.settlements.length
      const M = T.landmassSize.length
      const hab = new Int32Array(M)
      for (let i = 0; i < N; i++) if (T.habitable[i]) hab[T.landmass[i]]++
      // Cradles: the landmasses the founding tribes lived on.
      const isCradle = new Uint8Array(M)
      for (const st of h.settlements) if (st.parent < 0) isCradle[T.landmass[st.cell]] = 1
      // Continent-sized: >= 0.5% of the planet's cells with >= 50 habitable cells (as the stats harness counts them).
      const continent = (m: number) => T.landmassSize[m] >= 0.005 * N && hab[m] >= 50
      let others = 0
      for (let m = 0; m < M; m++) if (!isCradle[m] && continent(m)) others++
      // Share of habitable continent cells inside a living settlement's catchment, cradle and the others.
      const claim = (year: number): [number, number] => {
        const q = Math.floor(year / h.snapshotInterval)
        const mark = new Uint8Array(N)
        for (let id = 0; id < S; id++) {
          if (h.population[q * S + id] <= 0) continue
          const c = h.settlements[id].cell
          for (let k = T.catchOff[c]; k < T.catchOff[c + 1]; k++) mark[T.catchCell[k]] = 1
        }
        let all = 0, allIn = 0, oth = 0, othIn = 0
        for (let i = 0; i < N; i++) {
          const m = T.landmass[i]
          if (!T.habitable[i] || !continent(m)) continue
          all++; allIn += mark[i]
          if (!isCradle[m]) { oth++; othIn += mark[i] }
        }
        return [allIn / all, oth > 0 ? othIn / oth : 0]
      }
      const offCradle = (year: number): number => {
        const q = Math.floor(year / h.snapshotInterval)
        let t = 0, off = 0
        for (let id = 0; id < S; id++) {
          const p = h.population[q * S + id]
          t += p
          if (!isCradle[T.landmass[h.settlements[id].cell]]) off += p
        }
        return off / t
      }
      if (claim(2000)[0] >= 0.8) filled++
      // Newly reached lands lag the cradle: little of the population lives off it by year 750.
      if (offCradle(750) < 0.2) lag++
      // Small islands: most of them settled by the end.
      const islandAlive = new Uint8Array(M)
      const last = h.snapshotCount - 1
      for (let id = 0; id < S; id++) if (h.population[last * S + id] > 0) islandAlive[T.landmass[h.settlements[id].cell]] = 1
      let islands = 0, settledIslands = 0
      for (let m = 0; m < M; m++) if (!isCradle[m] && hab[m] > 0 && !continent(m)) { islands++; settledIslands += islandAlive[m] }
      if (settledIslands >= 0.5 * islands) islandSeeds++
      if (others === 0) continue
      eligible++
      let first = -1
      for (let id = 0; id < S && first < 0; id++) {
        const m = T.landmass[h.settlements[id].cell]
        if (!isCradle[m] && continent(m)) first = h.settlements[id].foundedYear
      }
      let aliveElsewhere = false
      for (let id = 0; id < S; id++) {
        const m = T.landmass[h.settlements[id].cell]
        if (!isCradle[m] && continent(m) && h.population[last * S + id] > 0) aliveElsewhere = true
      }
      if (aliveElsewhere) second++
      if (first >= 0 && first < 1000) early++
      // The far side is still a frontier at year 1000.
      if (claim(1000)[1] < 0.5) frontier++
    }
    expect(eligible).toBeGreaterThanOrEqual(6)
    expect(second).toBeGreaterThanOrEqual(eligible - 1)
    // (eligible - 4: with Seafaring per people, a world whose peoples are poor seafarers reaches the next continent later.)
    expect(early).toBeGreaterThanOrEqual(eligible - 4)
    expect(frontier).toBeGreaterThanOrEqual(eligible - 1)
    expect(lag).toBe(SEEDS.length)
    expect(filled).toBeGreaterThanOrEqual(SEEDS.length - 3)
    expect(islandSeeds).toBeGreaterThanOrEqual(SEEDS.length - 2)
  }, 300_000)
  it('technology differs by people: grows from its own activity, is learned only from peoples met, follows the old curve on average', () => {
    const P0: number[] = [], med1000: number[] = [], med2000: number[] = [], within: number[] = []
    let separate1000 = 0, visible1000 = 0
    for (const seed of SEEDS) {
      const { history: h, diag } = run(seed)
      const P = h.peoples.length
      const Fc = TECH_FIELD_COUNT
      P0.push(P)
      // Diffusion only between peoples in contact by then.
      const learn = diag.firstLearn as Int16Array
      expect(learn.length).toBe(P * P)
      for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) {
        const y = learn[a * P + b]
        if (y < 0) continue
        const met = h.contactYear[a * P + b]
        if (!(a !== b && met >= 0 && met <= y)) throw new Error(`seed ${seed}: people ${a} learned from ${b} in ${y}, met ${met}`)
      }
      // People.cradle is the founding plan's.
      expect(h.peoples.map((x) => x.cradle)).toEqual(diag.cradles?.cradle)
      const at = (year: number, p: number, f: number) => h.technology[((year / h.snapshotInterval) * P + p) * Fc + f]
      const levels = (year: number, f: number) => h.peoples.map((_, p) => at(year, p, f)).filter((v) => v > 0).sort((x, y) => x - y)
      const m = (xs: number[]) => xs[xs.length >> 1]
      med1000.push(m(levels(1000, 0)))
      med2000.push(m(levels(2000, 0)))
      // Nobody stalls: every living people has advanced in every field by 2000.
      for (let p = 0; p < P; p++) for (let f = 0; f < Fc; f++) { const v = at(2000, p, f); if (v > 0) expect(v).toBeGreaterThan(1.6) }
      // Networks at 1000: within a network little spread; between networks visible differences in some worlds.
      const lab = h.peoples.map((_, i) => i)
      const find = (x: number): number => { while (lab[x] !== x) x = lab[x]; return x }
      for (let a = 0; a < P; a++) for (let b = a + 1; b < P; b++) { const y = h.contactYear[a * P + b]; if (y >= 0 && y <= 1000) { const ra = find(a), rb = find(b); if (ra !== rb) lab[Math.max(ra, rb)] = Math.min(ra, rb) } }
      const roots = [...new Set(h.peoples.map((_, p) => find(p)))]
      if (roots.length >= 2) separate1000++
      let bestGap = 1
      for (let f = 0; f < Fc; f++) {
        const tops = roots.map((r) => Math.max(...h.peoples.map((_, p) => (find(p) === r ? at(1000, p, f) : 0))))
        const live = tops.filter((v) => v > 0)
        if (live.length >= 2) bestGap = Math.max(bestGap, Math.max(...live) / Math.min(...live))
        for (const r of roots) {
          const xs = h.peoples.map((_, p) => (find(p) === r ? at(1000, p, f) : 0)).filter((v) => v > 0)
          if (xs.length >= 2) within.push(Math.max(...xs) / Math.min(...xs))
        }
      }
      if (bestGap > 1.1) visible1000++
    }
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]
    // About the old global curve on average (2 at year 1000, 4 at 2000), with variance between worlds.
    expect(med(med1000)).toBeGreaterThan(1.7)
    expect(med(med1000)).toBeLessThan(2.4)
    expect(med(med2000)).toBeGreaterThan(3.4)
    expect(med(med2000)).toBeLessThan(4.8)
    expect(Math.max(...med2000)).toBeLessThan(6)
    // Separate networks differ visibly in a good share of the worlds where they exist; within a network the spread is small.
    expect(separate1000).toBeGreaterThanOrEqual(SEEDS.length / 2)
    expect(visible1000).toBeGreaterThanOrEqual(3)
    expect(med(within)).toBeLessThan(1.05)
  }, 300_000)

  it('species: unequal cradles, none doomed; exchange after contact; diverse staples; marginal land; bounded epidemics', () => {
    // Founding endowments (crop multiplier per cradle at the start) from a short run's probe.
    let unequal = 0
    for (const seed of [1, 2, 42, 2024]) {
      const probe: SpeciesProbe = { pop: [], crop: [], herd: [], popP: [], cmP: [], marginal: [] }
      runHistory(world(seed), { years: 260 }, speciesProbe(probe))
      const c0 = probe.crop[0]
      for (const c of c0) expect(c).toBeGreaterThan(0.45) // poor, never doomed
      for (const c of c0) expect(c).toBeLessThan(1.6)
      if (Math.max(...c0) / Math.min(...c0) >= 1.15) unequal++
    }
    expect(unequal).toBeGreaterThanOrEqual(2)
    let crossAdopt = 0, diverse = 0, marginal = 0, withEpidemic = 0, riceHeld = 0, riceBred = 0
    const tops = new Set<number>()
    for (const seed of SEEDS) {
      const w = world(seed)
      const { history: h, diag } = run(seed)
      const T = terrain(seed)
      const N = w.grid.cellCount
      const S = h.settlements.length
      const P = h.peoples.length
      const X = h.species.length
      // Every cradle lives to the end.
      const last = h.snapshotCount - 1
      const cradles = new Set(h.peoples.map((p) => p.cradle))
      for (const k of cradles) {
        let alive = false
        for (let id = 0; id < S && !alive; id++) if (h.population[last * S + id] > 0 && h.peoples[h.settlements[id].people].cradle === k) alive = true
        if (!alive) throw new Error(`seed ${seed}: cradle ${k} died out`)
      }
      // Species taken up from another cradle's people.
      const ev = h.events.filter((e) => e.type === EventType.SpeciesAdopted || e.type === EventType.Domesticated)
      expect(ev.length).toBeLessThanOrEqual(P * X)
      if (ev.some((e) => e.type === EventType.SpeciesAdopted && h.peoples[h.settlements[e.settlement].people].cradle !== h.peoples[h.settlements[e.other].people].cradle)) crossAdopt++
      // Staples of the farmed land at the end: no single one everywhere.
      const lq = h.landSnapshotCount - 1
      const count = new Array<number>(X).fill(0)
      let farmed = 0
      for (let i = 0; i < N; i++) { const c = h.crop[lq * N + i]; if (c > 0) { count[c - 1]++; farmed++ } }
      expect(farmed).toBeGreaterThan(0)
      let top = 0
      for (let x = 0; x < X; x++) if (count[x] > count[top]) top = x
      tops.add(top)
      expect(count[top] / farmed).toBeLessThan(0.6)
      if (count.filter((c) => c >= 0.05 * farmed).length >= 3) diverse++
      // Marginal land (habitable only with the right species) settled somewhere at some time.
      if (h.settlements.some((st) => !st.outpost && !T.baseHabitable[st.cell])) marginal++
      // Epidemics: a handful at most, capped.
      const epi = h.events.filter((e) => e.type === EventType.Epidemic)
      expect(epi.length).toBeLessThanOrEqual(12)
      if (epi.length > 0) withEpidemic++
      // Early-ripening rice is bred where paddy has long been grown.
      const TY = diag.techYear as Int16Array
      expect(TY.length).toBe(P * K_COUNT)
      let longRice = false, bred = false
      for (let p = 0; p < P; p++) {
        const y = h.speciesYear[p * X + 2]
        if (y >= 0 && y <= h.years - 600) longRice = true
        if (TY[p * K_COUNT] >= 0) { bred = true; expect(y).toBeGreaterThanOrEqual(0); expect(TY[p * K_COUNT]).toBeGreaterThanOrEqual(y) }
      }
      if (longRice) { riceHeld++; if (bred) riceBred++ }
    }
    expect(crossAdopt).toBeGreaterThanOrEqual(SEEDS.length - 2)
    expect(diverse).toBeGreaterThanOrEqual(SEEDS.length - 2)
    expect(tops.size).toBeGreaterThanOrEqual(2)
    expect(marginal).toBeGreaterThanOrEqual(SEEDS.length / 2)
    expect(withEpidemic).toBeGreaterThanOrEqual(SEEDS.length / 2)
    expect(riceBred).toBeGreaterThanOrEqual(riceHeld / 2)
  }, 300_000)

  it('expeditions set out from prosperous settlements, reach the poles, and leave bases where nobody farms', () => {
    let withBases = 0, withPole = 0, poleInWindow = 0, lateHeavy = 0
    for (const seed of SEEDS) {
      const w = world(seed)
      const { history: h, diag } = run(seed)
      const S = h.settlements.length
      const N = w.grid.cellCount
      const sent = h.events.filter((e) => e.type === EventType.ExpeditionSent)
      // Tens to low hundreds, not thousands.
      expect(sent.length).toBeGreaterThanOrEqual(5)
      expect(sent.length).toBeLessThan(400)
      // Senders were fed and of some size at the snapshot before.
      for (const e of sent) {
        const q = Math.floor(e.year / h.snapshotInterval)
        expect(h.population[q * S + e.settlement]).toBeGreaterThan(0.8 * EXPLORE.minPop)
      }
      const L = diag.expeditions
      expect(L?.year.length).toBe(sent.filter((e) => e.extra === undefined).length) // (goods: trade expeditions carry the variety sought in `extra`)
      // More of them as technology grows: the later half of the run sends most.
      if (sent.filter((e) => e.year > 1000).length > 0.6 * sent.length) lateHeavy++
      // Poles.
      const kinds = diag.discoveryKind ?? []
      const disc = h.events.filter((e) => e.type === EventType.Discovery)
      expect(disc.length).toBe(kinds.length)
      const poleYears = disc.filter((_, i) => kinds[i] <= 1).map((e) => e.year)
      for (let i = 0; i < disc.length; i++) if (kinds[i] <= 1) expect(disc[i].value).toBe(-1)
      for (const k of [0, 1, 3, 4]) expect(kinds.filter((x) => x === k).length).toBeLessThanOrEqual(1) // each pole, the summit and the desert once at most
      if (poleYears.length > 0) { withPole++; if (Math.min(...poleYears) >= 1100 && Math.min(...poleYears) <= 1950) poleInWindow++ }
      // Bases: small, few, on land nobody farms, supplied by a living parent (checked in the invariants).
      const bases = h.settlements.filter((x) => x.outpost)
      if (bases.length > 0) withBases++
      const scale = N / 23042
      for (let q = 0; q < h.snapshotCount; q += 20) {
        let n = 0
        for (const b of bases) {
          const p = h.population[q * S + b.id]
          if (p <= 0) continue
          n++
          expect(p).toBeGreaterThan(POPULATION.abandonPop)
          expect(p).toBeLessThanOrEqual(OUTPOST.pop + 1e-3)
        }
        expect(n).toBeLessThanOrEqual(Math.max(4, Math.round(OUTPOST.maxAlive * scale)))
      }
    }
    expect(withBases).toBeGreaterThanOrEqual(SEEDS.length - 3)
    expect(withPole).toBeGreaterThanOrEqual(SEEDS.length - 2)
    expect(poleInWindow).toBeGreaterThanOrEqual(SEEDS.length / 2)
    expect(lateHeavy).toBeGreaterThanOrEqual(SEEDS.length - 2)
  }, 300_000)
})
