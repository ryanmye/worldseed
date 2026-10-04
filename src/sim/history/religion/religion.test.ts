// religion: tests of faiths, their spread, conversion, state religions, schisms and holy war (src/sim/history/religion).

import { describe, expect, it } from 'vitest'
import { EventType, FaithKind, TOWN_POPULATION } from '../../../contract.ts'
import type { History, World } from '../../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../../index.ts'

function fnv(h: number, a: ArrayBufferView): number {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) }
  return h
}

function hashReligion(hi: History): string {
  let h = 0x811c9dc5
  for (const a of [hi.faith, hi.faithShare, hi.stateFaith, hi.holyWars]) h = fnv(h, a)
  const ints: number[] = []
  for (const f of hi.faiths) {
    ints.push(f.id, f.kind, f.parent, f.people, f.foundedAt, f.foundedYear, f.holyCity, f.endedYear, Math.round(f.zeal * 1e4), Math.round(f.organisation * 1e4), Math.round(f.appeal * 1e4))
    for (let i = 0; i < f.name.length; i++) ints.push(f.name.charCodeAt(i))
  }
  for (const e of hi.events) if (e.type >= EventType.FaithFounded && e.type <= EventType.FaithReached) ints.push(e.year, e.type, e.settlement, e.other, e.value, e.extra ?? -1)
  h = fnv(h, Int32Array.from(ints))
  return (h >>> 0).toString(16) + ':' + hi.faiths.length
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

/** Every structural invariant of the religion fields. */
function checkReligion(h: History): void {
  const S = h.settlements.length, P = h.polities.length, NP = h.peoples.length, F = h.faiths.length
  const Q = h.snapshotCount
  expect(h.faith.length).toBe(Q * S)
  expect(h.faithShare.length).toBe(Q * S)
  expect(h.stateFaith.length).toBe(Q * P)
  expect(F).toBeLessThan(255)
  // The table: each people's traditional faith first; universal faiths with a holy city; schisms of an earlier universal faith.
  const names = new Set<string>()
  for (let f = 0; f < F; f++) {
    const x = h.faiths[f]
    expect(x.id).toBe(f)
    expect(x.name.length).toBeGreaterThan(0)
    expect(names.has(x.name.toLowerCase())).toBe(false)
    names.add(x.name.toLowerCase())
    if (f < NP) { expect(x.kind).toBe(FaithKind.Traditional); expect(x.people).toBe(f); expect(x.foundedYear).toBe(0); expect(x.holyCity).toBe(-1) }
    else {
      expect(x.kind).toBe(FaithKind.Universal)
      expect(x.holyCity >= 0 && x.holyCity < S).toBe(true)
      expect(x.foundedAt).toBe(x.holyCity)
      const st = h.settlements[x.holyCity]
      expect(st.foundedYear).toBeLessThanOrEqual(x.foundedYear)
      if (f > NP) expect(x.foundedYear).toBeGreaterThanOrEqual(h.faiths[f - 1].foundedYear)
      if (x.parent >= 0) { expect(x.parent).toBeLessThan(f); expect(h.faiths[x.parent].kind).toBe(FaithKind.Universal); expect(h.faiths[x.parent].foundedYear).toBeLessThan(x.foundedYear) }
    }
    if (x.endedYear >= 0) expect(x.endedYear).toBeGreaterThanOrEqual(x.foundedYear)
    for (const t of [x.zeal, x.organisation, x.appeal]) expect(t >= 0 && t <= 1).toBe(true)
  }
  // Every living settlement follows a faith founded by then; the dead none.
  for (let q = 0; q < Q; q++) {
    const y = q * h.snapshotInterval
    for (let i = 0; i < S; i++) {
      const f = h.faith[q * S + i], sh = h.faithShare[q * S + i]
      if (h.population[q * S + i] <= 0) {
        if (f !== 255 && !(h.settlements[i].outpost && y >= h.settlements[i].foundedYear)) throw new Error(`dead settlement ${i} has faith ${f} at ${y}`)
        continue
      }
      if (f === 255 || f >= F) throw new Error(`living settlement ${i} without a faith at ${y}`)
      if (h.faiths[f].foundedYear > y) throw new Error(`settlement ${i} follows faith ${f} before its founding at ${y}`)
      if (!(sh > 0)) throw new Error(`settlement ${i} majority share ${sh} at ${y}`)
    }
    // State religions only for living polities, and universal faiths founded by then.
    for (let p = 0; p < P; p++) {
      const v = h.stateFaith[q * P + p]
      if (v === 0) continue
      const x = h.polities[p]
      if (y < x.foundedYear || (x.endedYear >= 0 && y >= x.endedYear)) throw new Error(`state religion of polity ${p} at ${y} outside its life`)
      const g = h.faiths[v - 1]
      expect(g.kind).toBe(FaithKind.Universal)
      expect(g.foundedYear).toBeLessThanOrEqual(y)
    }
  }
  // Holy wars are wars.
  for (const w of h.holyWars) expect(w >= 0 && w < h.wars.count).toBe(true)
  // Events agree with the tables.
  for (const e of h.events) {
    switch (e.type) {
      case EventType.FaithFounded: { const x = h.faiths[e.value]; expect(x.foundedYear).toBe(e.year); expect(x.holyCity).toBe(e.settlement); expect(x.parent).toBe(-1); break }
      case EventType.Schism: { const x = h.faiths[e.value]; expect(x.foundedYear).toBe(e.year); expect(x.parent).toBeGreaterThanOrEqual(0); expect(e.other).toBe(h.faiths[x.parent].holyCity); break }
      case EventType.RulerConverted: { expect(h.faiths[e.value].kind).toBe(FaithKind.Universal); if (e.other >= 0) { const r = h.rulers[e.other]; expect(r.acceded).toBeLessThanOrEqual(e.year); expect(r.ended < 0 || r.ended >= e.year).toBe(true) } break }
      case EventType.StateReligion: { const x = h.polities[e.other]; expect(e.year >= x.foundedYear && (x.endedYear < 0 || e.year <= x.endedYear)).toBe(true); expect(h.faiths[e.value].kind).toBe(FaithKind.Universal); break }
      case EventType.HolyWar: expect(Array.from(h.holyWars)).toContain(e.value); expect(h.wars.startYear[e.value]).toBe(e.year); break
      case EventType.HolyCityFell: expect(h.faiths[e.value].holyCity).toBe(e.settlement); break
      case EventType.FaithDied: expect(h.faiths[e.value].endedYear).toBe(e.year); break
      case EventType.FaithReached: expect(h.settlements[e.settlement].people).toBe(e.extra); break
      case EventType.Persecution: { const x = h.polities[e.other]; expect(e.year >= x.foundedYear && (x.endedYear < 0 || e.year <= x.endedYear)).toBe(true); break }
      default: break
    }
  }
}

describe('religion', () => {
  it('is deterministic; a longer run repeats a shorter one, names included; a resumed run equals runs from scratch, owning its arrays', () => {
    const w = world(3)
    const a = history(3), b = simulateHistory(w)
    expect(hashReligion(b)).toBe(hashReligion(a))
    expect(hashReligion(history(42))).not.toBe(hashReligion(a))
    const short = simulateHistory(w, { years: 1200 })
    const long = simulateHistory(w, { years: 1700 })
    const S0 = short.settlements.length, S1 = long.settlements.length, P0 = short.polities.length, P1 = long.polities.length
    for (let q = 0; q < short.snapshotCount; q++) {
      for (let i = 0; i < S0; i++) if (short.faith[q * S0 + i] !== long.faith[q * S1 + i] || short.faithShare[q * S0 + i] !== long.faithShare[q * S1 + i]) throw new Error(`faith differs at snapshot ${q}, settlement ${i}`)
      for (let p = 0; p < P0; p++) if (short.stateFaith[q * P0 + p] !== long.stateFaith[q * P1 + p]) throw new Error(`state faith differs at snapshot ${q}, polity ${p}`)
    }
    for (const f of short.faiths) {
      const g = long.faiths[f.id]
      expect([g.name, g.kind, g.parent, g.people, g.foundedAt, g.foundedYear, g.holyCity, g.zeal, g.organisation, g.appeal]).toEqual([f.name, f.kind, f.parent, f.people, f.foundedAt, f.foundedYear, f.holyCity, f.zeal, f.organisation, f.appeal])
      if (f.endedYear >= 0) expect(g.endedYear).toBe(f.endedYear)
    }
    for (let k = short.faiths.length; k < long.faiths.length; k++) expect(long.faiths[k].foundedYear).toBeGreaterThan(short.years)
    expect(Array.from(long.holyWars).slice(0, short.holyWars.length)).toEqual(Array.from(short.holyWars))
    const run = createHistoryRun(w)
    const x = run.advanceTo(1200)
    expect(hashReligion(x)).toBe(hashReligion(short))
    const y = run.advanceTo(1700)
    expect(hashReligion(y)).toBe(hashReligion(long))
    expect(hashReligion(x)).toBe(hashReligion(short))
    const arrays = (h: History) => [h.faith, h.faithShare, h.stateFaith, h.holyWars]
    const bufs = new Set(arrays(x).map((z) => z.buffer))
    for (const z of arrays(y)) {
      expect(bufs.has(z.buffer)).toBe(false)
      expect(z.byteOffset).toBe(0)
      expect(z.buffer.byteLength).toBe(z.byteLength)
    }
  }, 180_000)

  it('every history satisfies the religion invariants', () => {
    for (const seed of [1, 42, 7]) checkReligion(history(seed))
    const w = generateWorld(9, { subdivisions: 24 })
    checkReligion(simulateHistory(w, { years: 1500 }))
    checkReligion(simulateHistory(world(7), { years: 1200, polities: false })) // (faiths spread without states too)
  }, 180_000)

  it('universal faiths arise late and spread along trade; old faiths keep the isolated; states adopt churches; schisms and holy wars happen', () => {
    const seeds = [1, 2, 3, 42, 1337, 7]
    let schisms = 0, holy = 0, wars = 0, states = 0, converted = 0, worldsUni = 0
    const counts: number[] = []
    for (const seed of seeds) {
      const h = history(seed)
      const S = h.settlements.length, q = h.snapshotCount - 1
      const founded = h.faiths.filter((f) => f.kind === FaithKind.Universal && f.parent < 0)
      counts.push(founded.length)
      if (founded.length > 0) { worldsUni++; expect(founded[0].foundedYear).toBeGreaterThanOrEqual(300) }
      schisms += h.faiths.filter((f) => f.parent >= 0).length
      // Connected settlements (with an open route at the end) follow a universal faith more often than the isolated.
      const RC = h.trade.count, TQ = h.tradeSnapshotCount - 1
      const deg = new Int32Array(S)
      for (let r = 0; r < RC; r++) if (h.tradeVolume[TQ * RC + r] > 0) { deg[h.trade.a[r]]++; deg[h.trade.b[r]]++ }
      let cn = 0, cu = 0, inn = 0, iu = 0
      for (let i = 0; i < S; i++) {
        const f = h.faith[q * S + i]
        if (f === 255 || h.settlements[i].outpost) continue
        const u = h.faiths[f].kind === FaithKind.Universal
        if (deg[i] > 0) { cn++; if (u) cu++ } else { inn++; if (u) iu++ }
      }
      if (founded.length > 0 && cn > 0 && inn > 0) expect(cu / cn).toBeGreaterThan(iu / inn)
      if (cn > 0 && cu / cn > 0.5) converted++
      // Some traditional faith survives somewhere at the end.
      let trad = 0
      for (let i = 0; i < S; i++) { const f = h.faith[q * S + i]; if (f !== 255 && h.faiths[f].kind === FaithKind.Traditional) trad++ }
      expect(trad).toBeGreaterThan(0)
      // Holy cities are towns of some wealth while their faith lives.
      for (const f of founded) if (f.endedYear < 0 && h.population[q * S + f.holyCity] > 0) expect(h.wealth[q * S + f.holyCity]).toBeGreaterThan(0)
      holy += h.holyWars.length
      wars += h.wars.count
      states += h.events.filter((e) => e.type === EventType.StateReligion).length
    }
    counts.sort((a, b) => a - b)
    expect(worldsUni).toBeGreaterThanOrEqual(seeds.length - 1)
    expect(counts[counts.length >> 1]).toBeGreaterThanOrEqual(1)
    expect(counts[counts.length >> 1]).toBeLessThanOrEqual(7)
    expect(converted).toBeGreaterThanOrEqual(seeds.length / 2)
    expect(schisms).toBeGreaterThan(0)
    expect(states).toBeGreaterThan(seeds.length)
    expect(holy).toBeGreaterThan(0)
    expect(holy / wars).toBeLessThan(0.4)
    void TOWN_POPULATION
  }, 240_000)

  it('switched off alone, the faith fields are empty and rulers hold no faith', () => {
    const h = simulateHistory(world(42), { years: 1200, religion: false })
    expect(h.faiths.length + h.faith.length + h.stateFaith.length + h.holyWars.length).toBe(0)
    expect(h.rulers.length).toBeGreaterThan(0)
    expect(h.rulers.every((r) => r.faith === -1)).toBe(true)
  }, 120_000)
})
