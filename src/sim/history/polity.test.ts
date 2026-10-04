// polities: tests of states, borders, war and danger (the polity system, src/sim/history/polity).

import { describe, expect, it } from 'vitest'
import { EventType, JourneyKind, PolityEnd, PolityOrigin, StructureType, WarKind, WarOutcome } from '../../contract.ts'
import type { History, World } from '../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../index.ts'

function fnv(h: number, a: ArrayBufferView): number {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) }
  return h
}

/** Hash of every History field that exists without polities (species included; see GOLDEN). */
function hashBase(hi: History): string {
  let h = 0x811c9dc5
  for (const a of [hi.population, hi.food, hi.capacity, hi.landUse, hi.degradation, hi.road, hi.wealth, hi.tradeVolume, hi.knownYear, hi.contactYear, hi.technology, hi.speciesYear, hi.speciesSource, hi.crop, hi.herd]) h = fnv(h, a)
  for (const a of [hi.cash, hi.techniqueYear, hi.techniqueSource, hi.habit, hi.storable]) h = fnv(h, a) // species v2
  const t = hi.trade
  for (const a of [t.a, t.b, t.openedYear, t.goodAB, t.goodBA, t.pathOffsets, t.path]) h = fnv(h, a)
  const ints: number[] = [hi.years, hi.snapshotInterval, hi.snapshotCount, hi.landInterval, hi.landSnapshotCount, hi.tradeInterval, hi.tradeSnapshotCount, t.count]
  for (const s of hi.settlements) { ints.push(s.id, s.cell, s.foundedYear, s.parent, s.abandonedYear, s.people, s.outpost ? 1 : 0); for (let i = 0; i < s.name.length; i++) ints.push(s.name.charCodeAt(i)) }
  for (const p of hi.peoples) { ints.push(p.id, p.founder, p.cradle); for (let i = 0; i < p.name.length; i++) ints.push(p.name.charCodeAt(i)) }
  for (const s of hi.structures) ints.push(s.id, s.type, s.cell, s.settlement, s.builtYear, s.lostYear)
  for (const x of hi.species) {
    ints.push(x.id, x.category, Math.round(x.yield * 1e6), ...x.origins)
    ints.push(Math.round((x.value ?? -1) * 1e6), Math.round((x.habit ?? -1) * 1e6), Math.round((x.harm ?? -1) * 1e6), x.clonal === undefined ? -1 : x.clonal ? 1 : 0, Math.round((x.storability ?? -1) * 1e6))
    for (const str of [x.archetype, x.name]) for (let i = 0; i < str.length; i++) ints.push(str.charCodeAt(i))
  }
  for (const x of hi.techniques) { ints.push(x.id, x.species); for (const str of [x.archetype, x.name]) for (let i = 0; i < str.length; i++) ints.push(str.charCodeAt(i)) }
  ints.push(...hi.stimulants)
  for (const f of hi.features) { ints.push(f.id, f.kind, f.namedYear, f.namedBy, f.anchorCell, f.size, ...f.spine); for (let i = 0; i < f.name.length; i++) ints.push(f.name.charCodeAt(i)) }
  h = fnv(h, Int32Array.from(ints))
  const ev = new Float64Array(hi.events.length * 6)
  hi.events.forEach((e, i) => ev.set([e.year, e.type, e.settlement, e.other, e.value, e.extra ?? -1], i * 6))
  h = fnv(h, ev)
  const j = hi.journeys
  for (const a of [j.departYear, j.arriveYear, j.from, j.to, j.size, j.kind, j.pathOffsets, j.path]) h = fnv(h, a)
  return (h >>> 0).toString(16)
}

/**
 * Pre-polity histories: hashBase of simulateHistory with polities off must stay equal to the history without the
 * polity system. Recorded on main with species version 2 (e6816c1) plus the frontier changes only (main and the
 * frontier merge b41d41c's own diff on species v1), before polities were merged; the merged code with polities off was
 * checked field by field (every History field) against it. (A later merge or retune that changes the simulation
 * outside the polity system must regenerate these from its own pre-polity state.)
 */
// (Re-recorded with the far ventures, port gateways and danger siting: tourism-off runs checked on every field against f960f11
// plus this branch's diff; goods-off and polities-off runs against this tree with goods/ or polity/ and migration.ts as before.)
const GOLDEN: [number, number, number | undefined, string][] = [
  [42, 2000, undefined, '54f42444'],
  [3, 600, undefined, '65b6ea87'],
  [9, 800, 24, '32f53d06'],
]

/** Hash of the polity fields. */
function hashPolity(hi: History): string {
  let h = 0x811c9dc5
  for (const a of [hi.polity, hi.landCells, hi.territory, hi.claimed, hi.danger]) h = fnv(h, a)
  const w = hi.wars
  for (const a of [w.kind, w.attacker, w.defender, w.startYear, w.endYear, w.outcome, w.taken, w.dead]) h = fnv(h, a)
  const r = hi.raids
  for (const a of [r.decade, r.settlement, r.raids, r.wealth]) h = fnv(h, a)
  const ints: number[] = [w.count, r.count]
  const hues: number[] = []
  for (const p of hi.polities) {
    ints.push(p.id, p.qualifier, p.foundedYear, p.endedYear, p.origin, p.endCause, p.parent, p.people, ...p.capitals, -1, ...p.capitalYears, -2)
    for (let i = 0; i < p.name.length; i++) ints.push(p.name.charCodeAt(i))
    hues.push(p.hue)
  }
  h = fnv(h, Int32Array.from(ints))
  h = fnv(h, Float64Array.from(hues))
  return (h >>> 0).toString(16) + ':' + hi.polities.length
}

const worlds = new Map<number, World>()
function world(seed: number): World {
  let w = worlds.get(seed)
  if (!w) { w = generateWorld(seed); worlds.set(seed, w) }
  return w
}
const runs = new Map<number, History>()
function history(seed: number): History {
  let h = runs.get(seed)
  if (!h) { h = simulateHistory(world(seed)); runs.set(seed, h) }
  return h
}

const alive = (h: History, id: number, year: number): boolean => {
  const st = h.settlements[id]
  return year >= st.foundedYear && (st.abandonedYear < 0 || year < st.abandonedYear)
}

/** Every structural invariant of the polity fields. */
function checkPolities(w: World, h: History): void {
  const S = h.settlements.length
  const P = h.polities.length
  const L = h.landCells.length
  const NP = h.peoples.length
  expect(h.polity.length).toBe(h.snapshotCount * S)
  expect(h.territory.length).toBe(h.landSnapshotCount * L)
  expect(h.claimed.length).toBe(h.landSnapshotCount * L)
  expect(h.danger.length).toBe(h.landSnapshotCount * L)
  let land = 0
  for (let c = 0; c < w.grid.cellCount; c++) if (w.elevation[c] >= 0) land++
  expect(L).toBe(land)
  for (let k = 0; k < L; k++) {
    if (k > 0 && !(h.landCells[k] > h.landCells[k - 1])) throw new Error('landCells not ascending')
    if (w.elevation[h.landCells[k]] < 0) throw new Error(`landCells[${k}] is sea`)
  }
  // The table.
  for (let p = 0; p < P; p++) {
    const x = h.polities[p]
    expect(x.id).toBe(p)
    expect(x.name.length).toBeGreaterThan(0)
    if (p > 0) expect(x.foundedYear).toBeGreaterThanOrEqual(h.polities[p - 1].foundedYear) // ids in founding order
    expect(x.foundedYear).toBeLessThanOrEqual(h.years)
    if (x.parent >= 0) {
      expect(x.parent).toBeLessThan(p)
      expect(h.polities[x.parent].foundedYear).toBeLessThanOrEqual(x.foundedYear)
    } else expect(x.parent).toBe(-1)
    if (x.endedYear >= 0) { expect(x.endedYear).toBeGreaterThanOrEqual(x.foundedYear); expect(x.endCause).not.toBe(PolityEnd.Alive) }
    else expect(x.endCause).toBe(PolityEnd.Alive)
    expect(x.people >= 0 && x.people < NP).toBe(true)
    expect(x.capitals.length).toBe(x.capitalYears.length)
    expect(x.capitalYears[0]).toBe(x.foundedYear)
    expect(h.settlements[x.capitals[0]].people).toBe(x.people)
    for (let k = 1; k < x.capitals.length; k++) expect(x.capitalYears[k]).toBeGreaterThan(x.capitalYears[k - 1])
    expect(x.hue >= 0 && x.hue < 1).toBe(true)
    if (x.qualifier !== 0) expect(x.parent).toBeGreaterThanOrEqual(0)
  }
  // Membership per snapshot: only the living; capitals are living members while a polity lives; none after its end.
  const members = new Int32Array(P)
  for (let q = 0; q < h.snapshotCount; q++) {
    const y = q * h.snapshotInterval
    members.fill(0)
    for (let i = 0; i < S; i++) {
      const p = h.polity[q * S + i]
      if (h.population[q * S + i] <= 0) { if (p !== -1) throw new Error(`dead settlement ${i} in polity ${p} at ${y}`); continue }
      if (p < -1 || p >= P) throw new Error(`settlement ${i} has polity ${p} at ${y}`)
      if (p < 0) continue
      const x = h.polities[p]
      if (y < x.foundedYear || (x.endedYear >= 0 && y >= x.endedYear)) throw new Error(`settlement ${i} in polity ${p} at ${y}, outside ${x.foundedYear}-${x.endedYear}`)
      members[p]++
    }
    for (let p = 0; p < P; p++) {
      const x = h.polities[p]
      if (y < x.foundedYear || (x.endedYear >= 0 && y >= x.endedYear)) continue
      let k = 0
      while (k + 1 < x.capitals.length && x.capitalYears[k + 1] <= y) k++
      const cap = x.capitals[k]
      if (h.polity[q * S + cap] !== p) throw new Error(`polity ${p}'s capital ${cap} is not its member at ${y} (polity ${h.polity[q * S + cap]})`)
      if (!alive(h, cap, y)) throw new Error(`polity ${p}'s capital ${cap} not alive at ${y}`)
    }
  }
  // Territory: owners alive at the land snapshot.
  for (let q = 0; q < h.landSnapshotCount; q++) {
    const y = q * h.landInterval
    for (let k = 0; k < L; k++) {
      const o = h.territory[q * L + k]
      if (o === 0) continue
      if (o - 1 >= S) throw new Error(`territory owner ${o - 1} out of range`)
      if (!alive(h, o - 1, y)) throw new Error(`cell ${h.landCells[k]} owned by ${o - 1}, not alive at ${y}`)
    }
  }
  // Wars: valid polities alive at the start, peoples in contact by then; ended wars ended after they began.
  const W = h.wars
  for (const a of [W.kind, W.attacker, W.defender, W.startYear, W.endYear, W.outcome, W.taken, W.dead]) expect(a.length).toBe(W.count)
  for (let k = 0; k < W.count; k++) {
    const a = W.attacker[k], d = W.defender[k]
    expect(a !== d && a >= 0 && a < P && d >= 0 && d < P).toBe(true)
    for (const p of [a, d]) {
      const x = h.polities[p]
      expect(x.foundedYear).toBeLessThanOrEqual(W.startYear[k])
      if (x.endedYear >= 0) expect(x.endedYear).toBeGreaterThanOrEqual(W.startYear[k])
    }
    const pa = h.polities[a].people, pd = h.polities[d].people
    if (pa !== pd) { const c = h.contactYear[pa * NP + pd]; expect(c >= 0 && c <= W.startYear[k]).toBe(true) }
    if (k > 0) expect(W.startYear[k]).toBeGreaterThanOrEqual(W.startYear[k - 1])
    if (W.endYear[k] < 0) expect(W.outcome[k]).toBe(WarOutcome.Ongoing)
    else { expect(W.endYear[k]).toBeGreaterThanOrEqual(W.startYear[k]); expect(W.outcome[k]).not.toBe(WarOutcome.Ongoing) }
    expect(W.dead[k]).toBeGreaterThanOrEqual(0)
  }
  // Events agree with the tables.
  const founded = new Int32Array(P), ended = new Int32Array(P), declared = new Int32Array(W.count), peace = new Int32Array(W.count)
  for (const e of h.events) {
    switch (e.type) {
      case EventType.PolityFounded:
        founded[e.value]++
        expect(e.year).toBe(h.polities[e.value].foundedYear)
        expect(e.settlement).toBe(h.polities[e.value].capitals[0])
        break
      case EventType.PolityEnded:
        ended[e.value]++
        expect(e.year).toBe(h.polities[e.value].endedYear)
        break
      case EventType.WarDeclared: case EventType.CivilWar: // (v2: a civil war opens with CivilWar instead)
        declared[e.value]++
        expect(e.year).toBe(W.startYear[e.value])
        expect(W.kind[e.value]).toBe(e.type === EventType.CivilWar ? WarKind.CivilWar : WarKind.Conquest)
        break
      case EventType.PeaceMade:
        peace[e.value]++
        expect(e.year).toBe(W.endYear[e.value])
        break
      case EventType.Conquered: case EventType.SiegeLifted: {
        const k = e.value
        expect(k >= 0 && k < W.count).toBe(true)
        expect(e.year).toBeGreaterThanOrEqual(W.startYear[k])
        if (W.endYear[k] >= 0) expect(e.year).toBeLessThanOrEqual(W.endYear[k])
        break
      }
      case EventType.Seceded: case EventType.Defected: case EventType.Joined: case EventType.CapitalMoved: case EventType.SuccessionCrisis: {
        const x = h.polities[e.value]
        expect(x).toBeDefined()
        expect(e.year).toBeGreaterThanOrEqual(x.foundedYear)
        if (x.endedYear >= 0) expect(e.year).toBeLessThanOrEqual(x.endedYear)
        if (e.type === EventType.Seceded) {
          expect([PolityOrigin.Revolt, PolityOrigin.Colonial, PolityOrigin.Fragment, PolityOrigin.Partition]).toContain(x.origin)
          expect(x.parent).toBeGreaterThanOrEqual(0)
          expect(e.settlement).toBe(x.capitals[0])
        }
        if (e.type === EventType.CapitalMoved) expect(x.capitals.some((c, i) => c === e.settlement && x.capitalYears[i] === e.year)).toBe(true)
        break
      }
      case EventType.Revolt:
        expect(e.value >= 0 && e.value <= 4).toBe(true) // (religion: RevoltCause.Religious 4)
        break
      default:
        break
    }
  }
  for (let p = 0; p < P; p++) { expect(founded[p]).toBe(1); expect(ended[p]).toBe(h.polities[p].endedYear >= 0 ? 1 : 0) }
  for (let k = 0; k < W.count; k++) { expect(declared[k]).toBe(1); expect(peace[k]).toBe(W.endYear[k] >= 0 ? 1 : 0) }
  // Walls on their town's cell; armies march to living targets.
  for (const x of h.structures) if (x.type === StructureType.Walls) expect(x.cell).toBe(h.settlements[x.settlement].cell)
  const J = h.journeys
  for (let j = 0; j < J.count; j++) {
    if (J.kind[j] !== JourneyKind.Army) continue
    expect(J.to[j]).toBeGreaterThanOrEqual(0)
    expect(J.size[j]).toBeGreaterThan(0)
    if (!alive(h, J.to[j], J.arriveYear[j]) && h.settlements[J.to[j]].abandonedYear !== J.arriveYear[j]) throw new Error(`army ${j} marches on ${J.to[j]}, not alive in ${J.arriveYear[j]}`)
  }
  // Raids: complete decades, ascending, valid settlements.
  const R = h.raids
  for (let k = 0; k < R.count; k++) {
    expect(R.raids[k]).toBeGreaterThan(0)
    expect(R.settlement[k] >= 0 && R.settlement[k] < S).toBe(true)
    expect(10 * R.decade[k] + 9).toBeLessThanOrEqual(h.years)
    if (k > 0) expect(R.decade[k] > R.decade[k - 1] || (R.decade[k] === R.decade[k - 1] && R.settlement[k] > R.settlement[k - 1])).toBe(true)
  }
}

describe('polities', () => {
  it('switched off, the history is the one from before polities, with the new fields empty', () => {
    for (const [seed, years, n, hash] of GOLDEN) {
      const w = n ? generateWorld(seed, { subdivisions: n }) : world(seed)
      const h = simulateHistory(w, { years, polities: false, goods: false, disease: false, rulers: false, religion: false, tourism: false, renaming: false }) // (goods, disease, rulers, religion, tourism, renaming: the pre-polity history has none of them)
      expect(hashBase(h)).toBe(hash)
      expect(h.polities.length).toBe(0)
      expect(h.polity.length + h.landCells.length + h.territory.length + h.claimed.length + h.danger.length + h.wars.count + h.raids.count).toBe(0)
      expect(h.structures.some((x) => x.type === StructureType.Walls)).toBe(false)
      // (Polity events are 20-43; species v2's are 44 and up.)
      expect(h.events.some((e) => e.type >= EventType.PolityFounded && e.type <= EventType.Blockade)).toBe(false)
      // (v2 fields empty too.)
      expect(h.tariff.length + h.tariffRevenue.length + h.smuggleVolume.length + h.tradeLoss.length + h.contraband.length + h.piracy.length + h.bonds.count + h.embargoes.count).toBe(0)
      expect(h.structures.some((x) => x.type === StructureType.Fort)).toBe(false)
    }
  }, 60_000)

  it('is deterministic: the same world gives the same states, wars and borders', () => {
    const a = history(42)
    const b = simulateHistory(generateWorld(42))
    expect(hashPolity(b)).toBe(hashPolity(a))
    expect(hashBase(b)).toBe(hashBase(a))
    expect(hashPolity(history(1))).not.toBe(hashPolity(a))
  }, 60_000)

  it('a longer run repeats a shorter one exactly; a resumed run equals runs from scratch, owning its arrays', () => {
    const w = world(3)
    const short = simulateHistory(w, { years: 1200 })
    const long = simulateHistory(w, { years: 1700 })
    const S0 = short.settlements.length, S1 = long.settlements.length
    for (let q = 0; q < short.snapshotCount; q++) for (let i = 0; i < S0; i++) if (short.polity[q * S0 + i] !== long.polity[q * S1 + i]) throw new Error(`polity differs at snapshot ${q}, settlement ${i}`)
    const L = short.landCells.length
    expect(Array.from(long.landCells)).toEqual(Array.from(short.landCells))
    for (let k = 0; k < short.landSnapshotCount * L; k++) if (short.territory[k] !== long.territory[k] || short.claimed[k] !== long.claimed[k] || short.danger[k] !== long.danger[k]) throw new Error(`land layer differs at ${k}`)
    expect(short.polities.length).toBeGreaterThan(0)
    for (const p of short.polities) {
      const q = long.polities[p.id]
      expect([q.name, q.qualifier, q.foundedYear, q.origin, q.parent, q.people, q.hue]).toEqual([p.name, p.qualifier, p.foundedYear, p.origin, p.parent, p.people, p.hue])
      expect(q.capitals.slice(0, p.capitals.length)).toEqual(p.capitals)
      expect(q.capitalYears.slice(0, p.capitalYears.length)).toEqual(p.capitalYears)
      if (p.endedYear >= 0) expect([q.endedYear, q.endCause]).toEqual([p.endedYear, p.endCause])
      else expect(q.endedYear === -1 || q.endedYear > short.years).toBe(true)
    }
    const W0 = short.wars, W1 = long.wars
    for (let k = 0; k < W0.count; k++) {
      expect([W1.kind[k], W1.attacker[k], W1.defender[k], W1.startYear[k]]).toEqual([W0.kind[k], W0.attacker[k], W0.defender[k], W0.startYear[k]])
      if (W0.endYear[k] >= 0) expect([W1.endYear[k], W1.outcome[k], W1.taken[k], W1.dead[k]]).toEqual([W0.endYear[k], W0.outcome[k], W0.taken[k], W0.dead[k]])
    }
    let r1 = 0
    for (let k = 0; k < short.raids.count; k++) {
      while (long.raids.decade[r1] < short.raids.decade[k] || (long.raids.decade[r1] === short.raids.decade[k] && long.raids.settlement[r1] < short.raids.settlement[k])) r1++
      expect([long.raids.decade[r1], long.raids.settlement[r1], long.raids.raids[r1], long.raids.wealth[r1]]).toEqual([short.raids.decade[k], short.raids.settlement[k], short.raids.raids[k], short.raids.wealth[k]])
    }
    // Resumable.
    const run = createHistoryRun(w)
    const a = run.advanceTo(1200)
    expect(hashPolity(a)).toBe(hashPolity(short))
    const b = run.advanceTo(1700)
    expect(hashPolity(b)).toBe(hashPolity(long))
    expect(hashPolity(a)).toBe(hashPolity(short)) // (untouched by the extension)
    const bufs = (h: History) => [h.polity, h.landCells, h.territory, h.claimed, h.danger, h.wars.attacker, h.wars.dead, h.raids.decade, h.raids.wealth].map((x) => x.buffer)
    const seen = new Set(bufs(a))
    for (const x of bufs(b)) expect(seen.has(x)).toBe(false)
    for (const arr of [b.polity, b.landCells, b.territory, b.claimed, b.danger, b.wars.kind, b.wars.attacker, b.wars.defender, b.wars.startYear, b.wars.endYear, b.wars.outcome, b.wars.taken, b.wars.dead, b.raids.decade, b.raids.settlement, b.raids.raids, b.raids.wealth]) {
      expect(arr.byteOffset).toBe(0)
      expect(arr.buffer.byteLength).toBe(arr.byteLength)
    }
    expect(a.polities[0]).not.toBe(b.polities[0])
  }, 60_000)

  it('every history satisfies the polity invariants', () => {
    for (const seed of [1, 42, 7]) checkPolities(world(seed), history(seed))
    const w = generateWorld(9, { subdivisions: 24 })
    checkPolities(w, simulateHistory(w, { years: 1500 }))
  }, 120_000)

  it('states form late, grow, fight, rebel and split; most people end up in states, not all; war costs little', () => {
    const seeds = [1, 2, 3, 42, 1337, 7]
    let fragmented = 0
    for (const seed of seeds) {
      const h = history(seed)
      const S = h.settlements.length, q = h.snapshotCount - 1
      // The first state comes with the first towns, centuries in (the world's clock).
      expect(h.polities.length).toBeGreaterThan(5)
      expect(h.polities[0].foundedYear).toBeGreaterThanOrEqual(250)
      expect(h.polities[0].foundedYear).toBeLessThanOrEqual(1300)
      // At the end: several states (no world state), most settlements inside one, some outside.
      const pop = new Float64Array(h.polities.length), mem = new Int32Array(h.polities.length)
      let living = 0, inside = 0, total = 0
      for (let i = 0; i < S; i++) {
        const x = h.population[q * S + i]
        if (x <= 0 || h.settlements[i].outpost) continue
        living++; total += x
        const p = h.polity[q * S + i]
        if (p >= 0) { inside++; pop[p] += x; mem[p]++ }
      }
      let states = 0, largest = 0
      for (let p = 0; p < pop.length; p++) { if (mem[p] >= 2) states++; if (pop[p] > largest) largest = pop[p] }
      expect(states).toBeGreaterThanOrEqual(8)
      expect(states).toBeLessThanOrEqual(80)
      expect(inside / living).toBeGreaterThan(0.5)
      expect(inside / living).toBeLessThan(0.98)
      expect(largest / total).toBeLessThan(0.6)
      // Wars, conquests, revolts, secessions, raids, walls and armies all happen.
      expect(h.wars.count).toBeGreaterThanOrEqual(10)
      const count = (t: number) => h.events.filter((e) => e.type === t).length
      for (const t of [EventType.Conquered, EventType.Revolt, EventType.Seceded, EventType.SuccessionCrisis, EventType.PeaceMade]) expect(count(t)).toBeGreaterThan(0)
      expect(h.polities.some((p) => p.endCause === PolityEnd.Conquered)).toBe(true)
      expect(h.polities.some((p) => p.parent >= 0)).toBe(true)
      expect(h.structures.some((x) => x.type === StructureType.Walls)).toBe(true)
      expect(h.raids.count + count(EventType.Raid)).toBeGreaterThan(0)
      let armies = 0
      for (let j = 0; j < h.journeys.count; j++) if (h.journeys.kind[j] === JourneyKind.Army) armies++
      expect(armies).toBeGreaterThan(0)
      // Wars are bounded: most end within 30 years; states live for generations.
      const lens: number[] = []
      for (let k = 0; k < h.wars.count; k++) if (h.wars.endYear[k] >= 0) lens.push(h.wars.endYear[k] - h.wars.startYear[k])
      expect(lens.filter((x) => x > 30).length).toBeLessThanOrEqual(0.1 * lens.length)
      const lives = h.polities.map((p) => (p.endedYear >= 0 ? p.endedYear : h.years) - p.foundedYear).sort((a, b) => a - b)
      expect(lives[lives.length >> 1]).toBeGreaterThanOrEqual(50)
      // Successor states: a large state that broke into two or more.
      for (const p of h.polities) if (h.polities.filter((c) => c.parent === p.id).length >= 2) { fragmented++; break }
      // Danger is somewhere, not everywhere.
      const L = h.landCells.length, lq = h.landSnapshotCount - 1
      let dz = 0
      for (let k = 0; k < L; k++) dz += h.danger[lq * L + k]
      expect(dz / L / 255).toBeGreaterThan(0.02)
      expect(dz / L / 255).toBeLessThan(0.5)
    }
    expect(fragmented).toBeGreaterThanOrEqual(seeds.length - 1)
    // The cost in people stays within bounds against the same worlds without states.
    for (const seed of [42, 3]) {
      const on = simulateHistory(world(seed), { disease: false }), off = simulateHistory(world(seed), { polities: false, disease: false }) // (disease: off in both, so the late pandemics' timing does not blur the cost of states)
      const tot = (h: History) => { const S = h.settlements.length, q = h.snapshotCount - 1; let t = 0; for (let i = 0; i < S; i++) t += h.population[q * S + i]; return t }
      expect(tot(on) / tot(off)).toBeGreaterThanOrEqual(0.85)
    }
  }, 180_000)
})
