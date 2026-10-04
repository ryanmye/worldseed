// rulers: tests of rulers, houses, successions, marriages and unions (src/sim/history/rulers), and of the off switches.

import { describe, expect, it } from 'vitest'
import { AccessionHow, BondKind, EventType, PolityOrigin, ReignEnd, UnionEnd } from '../../../contract.ts'
import type { History, World } from '../../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../../index.ts'

// --- A hash of every History field of the history without rulers and religion ----------------------------------

function fnvBytes(h: number, b: Uint8Array): number { for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) } return h }
const F64 = new Float64Array(1), F64B = new Uint8Array(F64.buffer)
function hv(h: number, x: unknown): number {
  if (x === null || x === undefined) return fnvBytes(h, Uint8Array.of(0xee))
  if (ArrayBuffer.isView(x)) return fnvBytes(h, new Uint8Array(x.buffer, x.byteOffset, x.byteLength))
  if (typeof x === 'number') { F64[0] = x; return fnvBytes(h, F64B) }
  if (typeof x === 'boolean') return fnvBytes(h, Uint8Array.of(x ? 1 : 2))
  if (typeof x === 'string') { for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 0x01000193) } return fnvBytes(h, Uint8Array.of(0xfe)) }
  if (Array.isArray(x)) { for (const y of x) h = hv(h, y); return fnvBytes(h, Uint8Array.of(0xfd)) }
  const o = x as Record<string, unknown>
  for (const k of Object.keys(o).sort()) { h = hv(h, k); h = hv(h, o[k]) }
  return h
}
/** The History fields of the base commit (7bdbe75) and of the disease system (merged since), sorted. */
const BASE_KEYS = ['bonds', 'capacity', 'cash', 'contactYear', 'contraband', 'crop', 'danger', 'degradation', 'depositOutput', 'deposits', 'diseases', 'embargoes', 'endemic', 'epidemics', 'events', 'features', 'fever', 'feverTolerance', 'food', 'habit', 'herd', 'industry', 'journeys', 'knownYear', 'landCells', 'landInterval', 'landSnapshotCount', 'landUse', 'longHaul', 'longHaulVolume', 'mart', 'metal', 'outbreaks', 'peoples', 'piracy', 'polities', 'polity', 'population', 'posts', 'priceIndex', 'quarantines', 'raids', 'road', 'secretGuard', 'secretHolds', 'secrets', 'settlements', 'smuggleVolume', 'snapshotCount', 'snapshotInterval', 'species', 'speciesSource', 'speciesYear', 'stimulants', 'storable', 'structures', 'tariff', 'tariffRevenue', 'techniqueSource', 'techniqueYear', 'techniques', 'technology', 'territory', 'trade', 'tradeInterval', 'tradeLoss', 'tradeSnapshotCount', 'tradeVolume', 'traditionQuality', 'traditions', 'varieties', 'wars', 'wealth', 'years']
export function hashBaseFields(h: History): string {
  let x = 0x811c9dc5
  for (const k of BASE_KEYS) {
    x = hv(x, k)
    // (tourism, later than rulers and religion and off in the golden runs: settlements without their resort flag)
    x = hv(x, k === 'settlements' ? h.settlements.map((s) => { const o: Record<string, unknown> = { ...s }; delete o.resort; return o }) : (h as unknown as Record<string, unknown>)[k])
  }
  return (x >>> 0).toString(16)
}
/** hashBaseFields of the history without rulers and religion (the base commit 7bdbe75; since the merge, the disease system's main, verified by hashing every field against it; tourism, merged later, off): [seed, years, subdivisions, options, hash]. */
// (Re-recorded with the far ventures, port gateways and danger siting: tourism-off runs checked on every field against f960f11
// plus this branch's diff; goods-off and polities-off runs against this tree with goods/ or polity/ and migration.ts as before.)
const GOLDEN: [number, number, number | undefined, { polities?: boolean }, string][] = [
  [42, 2000, undefined, {}, '6377a0a8'],
  [3, 600, undefined, {}, 'e689b0cb'],
  [9, 800, 24, {}, '77e3dcab'],
  [7, 900, undefined, { polities: false }, '764a249'],
]

function hashRulers(h: History): string {
  let x = 0x811c9dc5
  for (const k of ['rulers', 'dynasties', 'reignOffsets', 'reignIds', 'marriages', 'unions', 'successionWars']) { x = hv(x, k); x = hv(x, (h as unknown as Record<string, unknown>)[k]) }
  const ev = h.events.filter((e) => e.type >= EventType.RulerAcceded && e.type <= EventType.SuccessionWar)
  x = hv(x, ev)
  return (x >>> 0).toString(16) + ':' + h.rulers.length
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

const aliveP = (h: History, p: number, y: number): boolean => {
  const x = h.polities[p]
  return y >= x.foundedYear && (x.endedYear < 0 || y <= x.endedYear)
}

/** The reign on p's throne at year y: the last acceded by then (-1). */
function rulerAt(h: History, p: number, y: number): number {
  let best = -1
  for (let k = h.reignOffsets[p]; k < h.reignOffsets[p + 1]; k++) { const r = h.reignIds[k]; if (h.rulers[r].acceded <= y) best = r }
  return best
}

/** Every structural invariant of the rulers fields. */
function checkRulers(h: History): void {
  const P = h.polities.length, N = h.rulers.length, D = h.dynasties.length, NP = h.peoples.length
  expect(h.reignOffsets.length).toBe(P + 1)
  expect(h.reignIds.length).toBe(N)
  expect(h.reignOffsets[P]).toBe(N)
  // Reigns.
  for (let r = 0; r < N; r++) {
    const x = h.rulers[r]
    expect(x.id).toBe(r)
    expect(x.name.length).toBeGreaterThan(0)
    expect(x.regnal).toBeGreaterThanOrEqual(1)
    if (r > 0) expect(x.acceded).toBeGreaterThanOrEqual(h.rulers[r - 1].acceded)
    expect(x.born).toBeLessThanOrEqual(x.acceded)
    expect(aliveP(h, x.polity, x.acceded)).toBe(true)
    if (x.ended >= 0) { expect(x.ended).toBeGreaterThanOrEqual(x.acceded); expect(x.end).not.toBe(ReignEnd.Reigning) } else expect(x.end).toBe(ReignEnd.Reigning)
    if (x.died >= 0) { expect(x.died).toBeGreaterThanOrEqual(x.acceded); expect(x.ended).toBeGreaterThanOrEqual(0) }
    if (x.dynasty >= 0) {
      expect(x.dynasty).toBeLessThan(D)
      expect(h.dynasties[x.dynasty].founded).toBeLessThanOrEqual(x.acceded)
    } else expect(h.polities[x.polity].origin).toBe(PolityOrigin.League)
    expect(x.person).toBeLessThanOrEqual(r)
    if (x.person !== r) { expect(x.how === AccessionHow.Union || x.how === AccessionHow.Inherited).toBe(true); expect(h.rulers[x.person].name).toBe(x.name) }
    if (x.predecessor >= 0) { expect(x.predecessor).toBeLessThan(r); expect(h.rulers[x.predecessor].polity).toBe(x.polity) }
    for (const t of [x.warlike, x.piety, x.tolerance]) expect(t >= 0 && t <= 1).toBe(true)
    expect(x.ability > 0.3 && x.ability < 2).toBe(true)
  }
  // Regnal numbers count the earlier reigns of the polity with the name.
  const seen = new Map<string, number>()
  for (const x of h.rulers) { const k = x.polity + ':' + x.name; const n = (seen.get(k) ?? 0) + 1; seen.set(k, n); expect(x.regnal).toBe(n) }
  // Reigns of a polity: in order, the first at its founding, each ending the year the next begins, the last with the realm.
  for (let p = 0; p < P; p++) {
    const x = h.polities[p]
    const a = h.reignOffsets[p], b = h.reignOffsets[p + 1]
    expect(b).toBeGreaterThan(a)
    expect(h.rulers[h.reignIds[a]].acceded).toBe(x.foundedYear)
    for (let k = a; k < b; k++) {
      const r = h.reignIds[k]
      expect(h.rulers[r].polity).toBe(p)
      if (k + 1 < b) {
        const n = h.rulers[h.reignIds[k + 1]]
        expect(h.rulers[r].ended).toBe(n.acceded)
        expect(n.predecessor).toBe(r)
      }
    }
    const last = h.rulers[h.reignIds[b - 1]]
    if (x.endedYear >= 0) expect(last.ended).toBe(x.endedYear)
    else expect(last.ended).toBe(-1)
  }
  // Every living polity has exactly one ruler at every snapshot.
  for (let q = 0; q < h.snapshotCount; q += 4) {
    const y = q * h.snapshotInterval
    for (let p = 0; p < P; p++) {
      const x = h.polities[p]
      if (y < x.foundedYear || (x.endedYear >= 0 && y >= x.endedYear)) continue
      const r = rulerAt(h, p, y)
      if (r < 0) throw new Error(`polity ${p} has no ruler at ${y}`)
      const z = h.rulers[r]
      if (z.ended >= 0 && z.ended < y) throw new Error(`polity ${p}'s ruler ${r} ended ${z.ended} before ${y}`)
    }
  }
  // Houses: unique names, founded with their founder.
  const names = new Set<string>()
  for (let d = 0; d < D; d++) {
    const x = h.dynasties[d]
    expect(x.id).toBe(d)
    expect(names.has(x.name.toLowerCase())).toBe(false)
    names.add(x.name.toLowerCase())
    const f = h.rulers[x.founder]
    expect(f.dynasty).toBe(d)
    expect(f.acceded).toBe(x.founded)
    if (x.ended >= 0) expect(x.ended).toBeGreaterThanOrEqual(x.founded)
    expect(x.people >= 0 && x.people < NP).toBe(true)
  }
  // A house reigning somewhere at the end has not ended.
  for (let p = 0; p < P; p++) {
    if (h.polities[p].endedYear >= 0) continue
    const r = h.reignIds[h.reignOffsets[p + 1] - 1]
    const d = h.rulers[r].dynasty
    if (d >= 0) expect(h.dynasties[d].ended).toBe(-1)
  }
  // Marriages and unions: between polities alive then whose peoples had met.
  const M = h.marriages
  for (let k = 0; k < M.count; k++) {
    const a = M.a[k], b = M.b[k]
    expect(a < b).toBe(true)
    for (const p of [a, b]) expect(aliveP(h, p, M.year[k])).toBe(true)
    const pa = h.polities[a].people, pb = h.polities[b].people
    if (pa !== pb) { const c = h.contactYear[pa * NP + pb]; expect(c >= 0 && c <= M.year[k]).toBe(true) }
    if (M.endYear[k] >= 0) expect(M.endYear[k]).toBeGreaterThanOrEqual(M.year[k])
  }
  const U = h.unions
  for (let k = 0; k < U.count; k++) {
    const s = U.senior[k], j = U.junior[k]
    expect(s).not.toBe(j)
    for (const p of [s, j]) expect(aliveP(h, p, U.startYear[k])).toBe(true)
    const r = h.rulers[U.ruler[k]]
    expect(r.polity).toBe(j)
    expect(r.how).toBe(AccessionHow.Union)
    expect(h.rulers[r.person].polity).toBe(s)
    let bond = false
    for (let b = 0; b < h.bonds.count; b++) if (h.bonds.kind[b] === BondKind.Vassal && h.bonds.a[b] === j && h.bonds.b[b] === s && h.bonds.startYear[b] === U.startYear[k]) bond = true
    expect(bond).toBe(true)
    if (U.endYear[k] >= 0) expect(U.end[k]).not.toBe(UnionEnd.Ongoing)
    else expect(U.end[k]).toBe(UnionEnd.Ongoing)
  }
  for (const w of h.successionWars) expect(w >= 0 && w < h.wars.count).toBe(true)
  // Events agree with the tables.
  for (const e of h.events) {
    switch (e.type) {
      case EventType.RulerAcceded: { const x = h.rulers[e.value]; expect(e.year).toBe(x.acceded); expect(e.extra).toBe(x.how); break }
      case EventType.ReignEnded: { const x = h.rulers[e.value]; expect(e.year).toBe(x.ended); expect(e.extra).toBe(x.end); break }
      case EventType.DynastyFounded: expect(e.year).toBe(h.dynasties[e.value].founded); break
      case EventType.DynastyEnded: expect(e.year).toBe(h.dynasties[e.value].ended); break
      case EventType.Regency: { const x = h.rulers[e.value]; expect(x.acceded - x.born).toBeLessThan(16); expect(e.year).toBe(x.acceded); break }
      case EventType.UnionFormed: expect(U.startYear[e.value]).toBe(e.year); break
      case EventType.UnionDissolved: expect(U.endYear[e.value]).toBe(e.year); expect(U.end[e.value]).toBe(e.extra); break
      case EventType.RoyalMarriage: expect(M.year[e.value]).toBe(e.year); break
      case EventType.SuccessionWar: expect(Array.from(h.successionWars)).toContain(e.value); expect(h.wars.startYear[e.value]).toBe(e.year); break
      default: break
    }
  }
}

describe('rulers', () => {
  it('switched off (rulers and religion), every field of the history is the one without them, and the new fields are empty', () => {
    for (const [seed, years, n, o, hash] of GOLDEN) {
      const w = n ? generateWorld(seed, { subdivisions: n }) : world(seed)
      const h = simulateHistory(w, { years, ...o, rulers: false, religion: false, tourism: false, renaming: false }) // (tourism, renaming: later, off here too)
      expect(hashBaseFields(h)).toBe(hash)
      expect(h.rulers.length + h.dynasties.length + h.reignIds.length + h.marriages.count + h.unions.count + h.successionWars.length).toBe(0)
      expect(h.faiths.length + h.faith.length + h.faithShare.length + h.stateFaith.length + h.holyWars.length).toBe(0)
      expect(h.events.some((e) => e.type >= EventType.RulerAcceded && e.type <= EventType.FaithReached)).toBe(false)
    }
  }, 180_000)

  it('is deterministic; a longer run repeats a shorter one, names included; a resumed run equals runs from scratch, owning its arrays', () => {
    const w = world(3)
    const a = history(3), b = simulateHistory(w)
    expect(hashRulers(b)).toBe(hashRulers(a))
    expect(hashRulers(history(42))).not.toBe(hashRulers(a))
    const short = simulateHistory(w, { years: 1200 })
    const long = simulateHistory(w, { years: 1700 })
    expect(short.rulers.length).toBeGreaterThan(10)
    for (const x of short.rulers) {
      const y = long.rulers[x.id]
      expect([y.name, y.regnal, y.female, y.born, y.acceded, y.polity, y.dynasty, y.how, y.law, y.predecessor, y.person, y.parent, y.ability, y.warlike, y.piety, y.tolerance, y.faith])
        .toEqual([x.name, x.regnal, x.female, x.born, x.acceded, x.polity, x.dynasty, x.how, x.law, x.predecessor, x.person, x.parent, x.ability, x.warlike, x.piety, x.tolerance, x.faith])
      if (x.ended >= 0) expect([y.ended, y.end, y.died]).toEqual([x.ended, x.end, x.died])
      else expect(y.ended === -1 || y.ended > short.years).toBe(true)
    }
    for (let k = short.rulers.length; k < long.rulers.length; k++) expect(long.rulers[k].acceded).toBeGreaterThan(short.years)
    for (const d of short.dynasties) {
      const e = long.dynasties[d.id]
      expect([e.name, e.founder, e.founded, e.home, e.people]).toEqual([d.name, d.founder, d.founded, d.home, d.people])
      if (d.ended >= 0) expect(e.ended).toBe(d.ended)
      else expect(e.ended === -1 || e.ended > short.years).toBe(true)
    }
    const M0 = short.marriages, M1 = long.marriages
    for (let k = 0; k < M0.count; k++) {
      expect([M1.a[k], M1.b[k], M1.dynastyA[k], M1.dynastyB[k], M1.year[k]]).toEqual([M0.a[k], M0.b[k], M0.dynastyA[k], M0.dynastyB[k], M0.year[k]])
      if (M0.endYear[k] >= 0) expect(M1.endYear[k]).toBe(M0.endYear[k])
    }
    const U0 = short.unions, U1 = long.unions
    for (let k = 0; k < U0.count; k++) {
      expect([U1.senior[k], U1.junior[k], U1.ruler[k], U1.startYear[k]]).toEqual([U0.senior[k], U0.junior[k], U0.ruler[k], U0.startYear[k]])
      if (U0.endYear[k] >= 0) expect([U1.endYear[k], U1.end[k]]).toEqual([U0.endYear[k], U0.end[k]])
    }
    expect(Array.from(long.successionWars).slice(0, short.successionWars.length)).toEqual(Array.from(short.successionWars))
    const ev = (h: History, y: number) => h.events.filter((e) => e.year <= y && e.type >= EventType.RulerAcceded && e.type <= EventType.SuccessionWar).map((e) => [e.year, e.type, e.settlement, e.other, e.value, e.extra ?? -1].join(','))
    expect(ev(long, 1200)).toEqual(ev(short, 1200))
    // Resumable.
    const run = createHistoryRun(w)
    const x = run.advanceTo(1200)
    expect(hashRulers(x)).toBe(hashRulers(short))
    const y = run.advanceTo(1700)
    expect(hashRulers(y)).toBe(hashRulers(long))
    expect(hashRulers(x)).toBe(hashRulers(short))
    const arrays = (h: History) => [h.reignOffsets, h.reignIds, h.marriages.a, h.marriages.year, h.unions.senior, h.unions.end, h.successionWars]
    const bufs = new Set(arrays(x).map((z) => z.buffer))
    for (const z of arrays(y)) {
      expect(bufs.has(z.buffer)).toBe(false)
      expect(z.byteOffset).toBe(0)
      expect(z.buffer.byteLength).toBe(z.byteLength)
    }
  }, 180_000)

  it('every history satisfies the rulers invariants', () => {
    for (const seed of [1, 42, 7]) checkRulers(history(seed))
    const w = generateWorld(9, { subdivisions: 24 })
    checkRulers(simulateHistory(w, { years: 1500 }))
  }, 180_000)

  it('reigns, houses and successions look like history; crises, civil wars, unions and wars of succession happen', () => {
    const seeds = [1, 2, 3, 42, 1337, 7]
    let unions = 0, ended = 0, wars = 0, civil = 0, partitions = 0
    const meds: number[] = [], houses: number[] = []
    for (const seed of seeds) {
      const h = history(seed)
      const reigns = h.rulers.filter((r) => r.dynasty >= 0 && r.ended >= 0).map((r) => r.ended - r.acceded).sort((a, b) => a - b)
      expect(reigns.length).toBeGreaterThan(100)
      meds.push(reigns[reigns.length >> 1])
      expect(reigns.filter((x) => x < 3).length).toBeGreaterThan(0) // (some very short)
      expect(reigns[Math.floor(0.95 * reigns.length)]).toBeGreaterThanOrEqual(40) // (a long tail)
      const lives = h.dynasties.map((d) => (d.ended >= 0 ? d.ended : h.years) - d.founded).sort((a, b) => a - b)
      houses.push(lives[lives.length >> 1])
      expect(lives[lives.length - 1]).toBeGreaterThanOrEqual(250) // (a few very long houses)
      const count = (t: number) => h.events.filter((e) => e.type === t).length
      for (const t of [EventType.Regency, EventType.SuccessionCrisis, EventType.DynastyEnded, EventType.RoyalMarriage]) expect(count(t)).toBeGreaterThan(0)
      // Most successions clean: crises are a minority of the reigns' ends.
      const succ = h.rulers.filter((r) => r.dynasty >= 0 && r.ended >= 0 && r.end !== ReignEnd.RealmEnded).length
      expect(count(EventType.SuccessionCrisis) / succ).toBeGreaterThan(0.05)
      expect(count(EventType.SuccessionCrisis) / succ).toBeLessThan(0.4)
      // Queens regnant somewhere; usurpers somewhere.
      expect(h.rulers.some((r) => r.female)).toBe(true)
      expect(h.rulers.some((r) => r.how === AccessionHow.Usurped)).toBe(true)
      unions += h.unions.count
      for (let k = 0; k < h.unions.count; k++) if (h.unions.end[k] !== UnionEnd.Ongoing) ended++
      wars += h.successionWars.length
      civil += count(EventType.CivilWar)
      partitions += count(EventType.Partitioned)
    }
    meds.sort((a, b) => a - b)
    houses.sort((a, b) => a - b)
    const m = meds[meds.length >> 1], hm = houses[houses.length >> 1]
    expect(m).toBeGreaterThanOrEqual(12)
    expect(m).toBeLessThanOrEqual(28)
    expect(hm).toBeGreaterThanOrEqual(25)
    expect(hm).toBeLessThanOrEqual(200)
    expect(unions).toBeGreaterThanOrEqual(seeds.length / 2)
    expect(ended).toBeGreaterThan(0)
    expect(wars).toBeGreaterThan(0)
    expect(civil).toBeGreaterThanOrEqual(3 * seeds.length)
    expect(civil).toBeLessThanOrEqual(25 * seeds.length)
    expect(partitions).toBeGreaterThan(0)
  }, 240_000)

  it('with rulers off the old succession timer runs (no rulers, crises still)', () => {
    const h = simulateHistory(world(42), { years: 1500, rulers: false })
    expect(h.rulers.length).toBe(0)
    expect(h.events.some((e) => e.type === EventType.SuccessionCrisis)).toBe(true)
    expect(h.faiths.length).toBeGreaterThan(0) // (religion runs without rulers)
  }, 120_000)
})
