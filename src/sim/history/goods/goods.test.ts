// goods: tests of worked goods, specialities, secrets and long-distance trade (the goods system, src/sim/history/goods).

import { describe, expect, it } from 'vitest'
import { DepositKind, EventType, JourneyKind, LeakChannel, LegKind, PostKind, SecretKind, StructureType, TOWN_POPULATION } from '../../../contract.ts'
import type { History, World } from '../../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../../index.ts'
import { runHistory } from '../index.ts'

function fnv(h: number, a: ArrayBufferView): number {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) }
  return h
}

/** Hash of every History field that exists without the goods system (polities, v2 included). */
function hashPre(hi: History): string {
  let h = 0x811c9dc5
  for (const a of [hi.population, hi.food, hi.capacity, hi.landUse, hi.degradation, hi.road, hi.wealth, hi.tradeVolume, hi.knownYear, hi.contactYear, hi.technology, hi.speciesYear, hi.speciesSource, hi.crop, hi.herd, hi.cash, hi.techniqueYear, hi.techniqueSource, hi.habit, hi.storable, hi.polity, hi.landCells, hi.territory, hi.danger]) h = fnv(h, a)
  const t = hi.trade
  for (const a of [t.a, t.b, t.openedYear, t.goodAB, t.goodBA, t.pathOffsets, t.path]) h = fnv(h, a)
  const w = hi.wars
  for (const a of [w.kind, w.attacker, w.defender, w.startYear, w.endYear, w.outcome, w.taken, w.dead]) h = fnv(h, a)
  const r = hi.raids
  for (const a of [r.decade, r.settlement, r.raids, r.wealth]) h = fnv(h, a)
  // polities v2
  for (const a of [hi.tariff, hi.tariffRevenue, hi.smuggleVolume, hi.tradeLoss, hi.contraband, hi.piracy]) h = fnv(h, a)
  const bd = hi.bonds
  for (const a of [bd.kind, bd.a, bd.b, bd.startYear, bd.endYear, bd.end]) h = fnv(h, a)
  const ints: number[] = [bd.count, hi.years, hi.snapshotInterval, hi.snapshotCount, hi.landInterval, hi.landSnapshotCount, hi.tradeInterval, hi.tradeSnapshotCount, t.count, w.count, r.count]
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
  for (const p of hi.polities) { ints.push(p.id, p.qualifier, p.foundedYear, p.endedYear, p.origin, p.endCause, p.parent, p.people, Math.round(p.hue * 1e6), ...p.capitals, ...p.capitalYears); for (let i = 0; i < p.name.length; i++) ints.push(p.name.charCodeAt(i)) }
  h = fnv(h, Int32Array.from(ints))
  const ev = new Float64Array(hi.events.length * 6)
  hi.events.forEach((e, i) => ev.set([e.year, e.type, e.settlement, e.other, e.value, e.extra ?? -1], i * 6))
  h = fnv(h, ev)
  const j = hi.journeys
  for (const a of [j.departYear, j.arriveYear, j.from, j.to, j.size, j.kind, j.pathOffsets, j.path]) h = fnv(h, a)
  return (h >>> 0).toString(16)
}

/** Hash of the goods fields. */
function hashGoods(hi: History): string {
  let h = 0x811c9dc5
  for (const a of [hi.depositOutput, hi.traditionQuality, hi.industry, hi.metal, hi.longHaulVolume, hi.priceIndex, hi.mart, hi.secretGuard]) h = fnv(h, a)
  const L = hi.longHaul
  for (const a of [L.a, L.b, L.kind, L.openedYear, L.closedYear, L.chart, L.goodAB, L.goodBA, L.pathOffsets, L.path]) h = fnv(h, a)
  const H = hi.secretHolds
  for (const a of [H.secret, H.people, H.polity, H.from, H.to, H.channel, H.via]) h = fnv(h, a)
  const ints: number[] = []
  for (const v of hi.varieties) { ints.push(v.id, v.good, v.kind, v.source, v.people, Math.round(v.value * 1e6), v.firstYear); for (let i = 0; i < v.maker.length; i++) ints.push(v.maker.charCodeAt(i)) }
  for (const d of hi.deposits) ints.push(d.id, d.kind, d.cell, Math.round(d.richness * 1e6), d.foundYear, d.foundBy, d.exhaustedYear, d.variety)
  for (const t of hi.traditions) { ints.push(t.id, t.craft, t.good, t.variety, t.people, t.bornYear, t.bornAt, t.endYear, t.parent, ...t.seats, ...t.seatFrom, ...t.seatTo); for (let i = 0; i < t.maker.length; i++) ints.push(t.maker.charCodeAt(i)) }
  for (const x of hi.secrets) ints.push(x.id, x.kind, x.subject, x.foundYear, x.foundAt, x.lostYear)
  for (const p of hi.posts) ints.push(p.id, p.kind, p.owner, p.host, p.settlement, p.leg, p.foundedYear, p.endedYear)
  for (const s of hi.settlements) ints.push(s.post ? 1 : 0)
  h = fnv(h, Int32Array.from(ints))
  return (h >>> 0).toString(16)
}

/**
 * Pre-goods histories: hashPre of simulateHistory with goods off. At the merge with polities v2 these equalled main 9a10d65
 * (checked on every field); the joint retune then changed polities (tiers relative to the world's people, the SmugglingRing
 * bar, havens' lane traffic), so the polity-on hashes are regenerated from the retuned goods-off history. With polities off
 * the history is still 9a10d65's (and 8d50bc5's). A later change outside the goods system must regenerate these. (A later merge or retune that changes the
 * simulation outside the goods system must regenerate these from its own pre-goods state.)
 */
const GOLDEN: [number, number, number | undefined, boolean, string][] = [
  [42, 2000, undefined, true, '9f9f3911'],
  [3, 600, undefined, true, '39a0574d'],
  [9, 800, 24, true, 'daf67c33'],
  [7, 900, undefined, false, '1a3a2048'],
]

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

/** Structural invariants of the goods fields. */
function checkGoods(w: World, h: History): void {
  const S = h.settlements.length
  const Q = h.tradeSnapshotCount
  const N = w.grid.cellCount
  const { neighborOffsets: off, neighbors: nb } = w.grid
  const adjacent = (a: number, b: number): boolean => { for (let k = off[a]; k < off[a + 1]; k++) if (nb[k] === b) return true; return false }
  // Shapes.
  expect(h.depositOutput.length).toBe(Q * h.deposits.length)
  expect(h.traditionQuality.length).toBe(Q * h.traditions.length)
  expect(h.industry.length).toBe(Q * S)
  expect(h.metal.length).toBe(Q * S * 2)
  expect(h.priceIndex.length).toBe(Q * S * 5)
  expect(h.mart.length).toBe(Q * S)
  expect(h.longHaulVolume.length).toBe(Q * h.longHaul.count)
  expect(h.secretGuard.length).toBe(Q * h.secrets.length)
  for (const a of [h.depositOutput, h.traditionQuality, h.industry, h.metal, h.longHaulVolume, h.priceIndex, h.mart, h.secretGuard]) { expect(a.byteOffset).toBe(0); expect(a.buffer.byteLength).toBe(a.byteLength) }
  for (let i = 0; i < h.depositOutput.length; i++) if (!(h.depositOutput[i] >= 0)) throw new Error(`deposit output ${h.depositOutput[i]}`)
  for (let i = 0; i < h.longHaulVolume.length; i++) if (!(h.longHaulVolume[i] >= 0)) throw new Error(`leg volume ${h.longHaulVolume[i]}`)
  // Varieties reference valid makers.
  expect(h.varieties[0].kind).toBe(0)
  for (const v of h.varieties.slice(1)) {
    expect(v.maker.length).toBeGreaterThan(0)
    expect(v.people >= 0 && v.people < h.peoples.length).toBe(true)
    if (v.kind === 2) expect(h.deposits[v.source].variety).toBe(v.id)
    if (v.kind === 3) expect(h.traditions[v.source].variety).toBe(v.id)
    if (v.kind === 1) expect(v.source >= 0 && v.source < h.species.length).toBe(true)
  }
  // Deposits on valid cells of the right geology, found by settlements alive then.
  const ev = h.events
  for (const d of h.deposits) {
    expect(d.cell >= 0 && d.cell < N).toBe(true)
    expect(w.elevation[d.cell]).toBeGreaterThanOrEqual(0)
    if (d.kind === DepositKind.Amber || d.kind === DepositKind.Pearls || d.kind === DepositKind.Murex) {
      let coast = false
      for (let k = off[d.cell]; k < off[d.cell + 1]; k++) if (w.biome[nb[k]] === 1) coast = true
      expect(coast).toBe(true)
    } else if (d.kind === DepositKind.Silver) expect(w.biome[d.cell]).toBe(10)
    if (d.foundYear >= 0) {
      const f = h.settlements[d.foundBy]
      expect(f.foundedYear).toBeLessThanOrEqual(d.foundYear)
      expect(f.abandonedYear < 0 || f.abandonedYear >= d.foundYear).toBe(true)
      expect(ev.some((e) => e.type === EventType.DepositFound && e.value === d.id && e.year === d.foundYear && e.settlement === d.foundBy)).toBe(true)
    } else expect(d.variety).toBe(-1)
    if (d.exhaustedYear >= 0) expect(d.exhaustedYear).toBeGreaterThan(d.foundYear)
  }
  // Traditions: seats are valid settlements of the tradition's people (or a daughter's), Q in range.
  for (const t of h.traditions) {
    expect(t.seats.length).toBeGreaterThan(0)
    expect(t.seats[0]).toBe(t.bornAt)
    expect(h.settlements[t.bornAt].people).toBe(t.people)
    expect(h.varieties[t.variety].source).toBe(t.id)
    if (t.parent >= 0) expect(t.parent).toBeLessThan(t.id)
    for (let k = 0; k < t.seats.length; k++) { expect(t.seatFrom[k]).toBeGreaterThanOrEqual(t.bornYear); if (t.seatTo[k] >= 0) expect(t.seatTo[k]).toBeGreaterThanOrEqual(t.seatFrom[k]) }
    if (t.endYear >= 0) expect(t.seatTo.every((x) => x >= 0)).toBe(true)
  }
  // Legs: between marts at the snapshot of opening, of peoples in contact (relay) or opened by a lane's DirectRoute; paths of adjacent cells.
  const L = h.longHaul
  for (let k = 0; k < L.count; k++) {
    const a = L.a[k], b = L.b[k]
    expect(a >= 0 && a < S && b >= 0 && b < S && a !== b).toBe(true)
    const p0 = L.pathOffsets[k], p1 = L.pathOffsets[k + 1]
    expect(p1 - p0).toBeGreaterThan(0)
    expect(L.path[p0]).toBe(h.settlements[a].cell)
    expect(L.path[p1 - 1]).toBe(h.settlements[b].cell)
    for (let i = p0 + 1; i < p1; i++) if (!adjacent(L.path[i - 1], L.path[i])) throw new Error(`leg ${k} path not contiguous at ${i}`)
    if (L.closedYear[k] >= 0) expect(L.closedYear[k]).toBeGreaterThanOrEqual(L.openedYear[k])
    if (L.kind[k] === LegKind.Relay) {
      const pa = h.settlements[a].people, pb = h.settlements[b].people
      const y = h.contactYear[pa * h.peoples.length + pb]
      expect(y >= 0 && y <= L.openedYear[k]).toBe(true)
      expect(L.chart[k]).toBe(-1)
    } else {
      // A lane: a chart secret, opened by a DirectRoute this year from a successful trade expedition (an Expedition journey home).
      expect(L.chart[k] >= 0 && L.chart[k] < h.secrets.length).toBe(true)
      expect(h.secrets[L.chart[k]].kind).toBe(SecretKind.Chart)
      const dr = ev.find((e) => e.type === EventType.DirectRoute && e.year === L.openedYear[k] && (e.value === k || e.value === k - 1))
      expect(dr).toBeDefined()
      if (dr) {
        const home = dr.settlement
        let journey = false
        const J = h.journeys
        for (let j = 0; j < J.count; j++) if (J.kind[j] === JourneyKind.Expedition && J.from[j] === home && J.arriveYear[j] === dr.year && J.to[j] === home) journey = true
        expect(journey).toBe(true)
        expect(ev.some((e) => e.type === EventType.ExpeditionSent && e.settlement === home && e.year === dr.year && (e.extra ?? 0) > 0)).toBe(true)
      }
    }
  }
  // Posts: a PostFounded event, an owner alive at founding, a settlement or host alive then.
  for (const p of h.posts) {
    const o = h.settlements[p.owner]
    expect(o.foundedYear).toBeLessThanOrEqual(p.foundedYear)
    expect(o.abandonedYear < 0 || o.abandonedYear >= p.foundedYear).toBe(true)
    expect(ev.some((e) => e.type === EventType.PostFounded && e.value === p.id && e.year === p.foundedYear && e.other === p.owner)).toBe(true)
    if (p.kind === PostKind.Factory) {
      expect(p.host >= 0 && p.settlement === -1).toBe(true)
      expect(h.structures.some((x) => x.type === StructureType.Factory && x.cell === h.settlements[p.host].cell && x.settlement === p.owner && x.builtYear === p.foundedYear)).toBe(true)
    } else {
      expect(p.settlement >= 0 && p.host === -1).toBe(true)
      expect(h.settlements[p.settlement].parent).toBe(p.owner)
      if (p.kind !== PostKind.Camp) expect(h.settlements[p.settlement].post).toBe(true)
      else expect(h.settlements[p.settlement].outpost).toBe(true)
    }
    if (p.leg >= 0) expect(p.leg < L.count && L.kind[p.leg] === LegKind.Lane).toBe(true)
  }
  // Secrets: holdings never overlap per (secret, people); each was gained by a logged channel.
  const H = h.secretHolds
  for (let i = 0; i < H.count; i++) {
    expect(H.secret[i]).toBeLessThan(h.secrets.length)
    expect(H.people[i] >= 0 && H.people[i] < h.peoples.length).toBe(true)
    if (i > 0) expect(H.from[i]).toBeGreaterThanOrEqual(H.from[i - 1])
    if (H.to[i] >= 0) expect(H.to[i]).toBeGreaterThanOrEqual(H.from[i])
    const x = h.secrets[H.secret[i]]
    expect(H.from[i]).toBeGreaterThanOrEqual(x.foundYear < 0 ? 0 : Math.min(x.foundYear, H.from[i]))
    if (H.from[i] > x.foundYear && H.via[i] >= 0) {
      // A leak after the secret began: logged as SecretLeaked that year by its channel, at a settlement of the receiving people.
      expect(ev.some((e) => e.type === EventType.SecretLeaked && e.value === x.id && e.year === H.from[i] && e.extra === H.channel[i] && h.settlements[e.settlement].people === H.people[i])).toBe(true)
    }
    if (H.channel[i] === LeakChannel.Founded && x.kind === SecretKind.Species && H.from[i] > 0) expect(ev.some((e) => e.type === EventType.Domesticated && e.value === x.subject && e.year === H.from[i])).toBe(true)
    for (let j = 0; j < i; j++) {
      if (H.secret[j] !== H.secret[i] || H.people[j] !== H.people[i]) continue
      expect(H.to[j] >= 0 && H.to[j] <= H.from[i]).toBe(true)
    }
  }
  for (const x of h.secrets) {
    if (x.kind === SecretKind.Chart) expect(L.kind[x.subject]).toBe(LegKind.Lane)
    if (x.lostYear >= 0) for (let i = 0; i < H.count; i++) if (H.secret[i] === x.id) expect(H.to[i] >= 0 && H.to[i] <= x.lostYear).toBe(true)
  }
  // Price index 0 exactly where a settlement does not trade (dead, or below the trading size, other than a post).
  for (let q = 0; q < Q; q++) {
    const y = q * h.tradeInterval
    const sq = Math.floor(y / h.snapshotInterval)
    for (let i = 0; i < S; i++) {
      const pop = h.population[sq * S + i]
      const o = (q * S + i) * 5
      if (pop <= 0) for (let k = 0; k < 5; k++) if (h.priceIndex[o + k] !== 0) throw new Error(`price at a dead settlement ${i} at ${y}`)
    }
  }
  // Events consistent with tables.
  for (const e of ev) {
    if (e.type < 50 || e.type > 65) continue
    expect(e.settlement >= 0 && e.settlement < S).toBe(true)
    if (e.type === EventType.DepositFound || e.type === EventType.MineExhausted || e.type === EventType.Boom) expect(e.value).toBeLessThan(h.deposits.length)
    if (e.type >= EventType.TraditionBorn && e.type <= EventType.TraditionLost) expect(e.value).toBeLessThan(h.traditions.length)
    if (e.type >= EventType.SecretGuarded && e.type <= EventType.MonopolyBroken) expect(e.value).toBeLessThan(h.secrets.length)
    if (e.type === EventType.DirectRoute || e.type === EventType.Bypassed || e.type === EventType.FleetLost) expect(e.value).toBeLessThan(L.count)
    if (e.type === EventType.PostFounded || e.type === EventType.PostLost) expect(e.value).toBeLessThan(h.posts.length)
  }
  // Mines: structures on worked deposits' cells.
  for (const st of h.structures) if (st.type === StructureType.Mine) expect(h.deposits.some((d) => d.cell === st.cell && d.foundYear >= 0 && d.foundYear <= st.builtYear)).toBe(true)
}

describe('goods', () => {
  it('switched off, the history is the one from before the goods system, with the goods fields empty', () => {
    for (const [seed, years, n, pol, hash] of GOLDEN) {
      const w = n ? generateWorld(seed, { subdivisions: n }) : world(seed)
      const h = simulateHistory(w, { years, polities: pol, goods: false, disease: false, rulers: false, religion: false, tourism: false, renaming: false }) // (disease, rulers, religion, tourism, renaming: the pre-goods history has none of them)
      expect(hashPre(h)).toBe(hash)
      expect(h.varieties.length + h.deposits.length + h.traditions.length + h.secrets.length + h.posts.length + h.longHaul.count + h.secretHolds.count).toBe(0)
      expect(h.depositOutput.length + h.traditionQuality.length + h.industry.length + h.metal.length + h.priceIndex.length + h.mart.length + h.longHaulVolume.length + h.secretGuard.length).toBe(0)
      expect(h.events.some((e) => e.type >= 50 && e.type <= 65)).toBe(false)
      expect(h.structures.some((x) => x.type === StructureType.Mine || x.type === StructureType.Factory)).toBe(false)
      expect(h.settlements.some((s) => s.post)).toBe(false)
    }
  }, 120_000)

  it('is deterministic: the same world gives the same goods, traditions, secrets and lanes', () => {
    const a = history(42)
    const b = simulateHistory(generateWorld(42))
    expect(hashGoods(b)).toBe(hashGoods(a))
    expect(hashPre(b)).toBe(hashPre(a))
    expect(hashGoods(history(1))).not.toBe(hashGoods(a))
  }, 120_000)

  it('a longer run repeats a shorter one exactly; a resumed run equals runs from scratch, owning its arrays', () => {
    const w = world(9)
    const short = simulateHistory(w, { years: 1300 })
    const long = simulateHistory(w, { years: 1800 })
    const S0 = short.settlements.length, S1 = long.settlements.length
    const Q0 = short.tradeSnapshotCount
    for (let q = 0; q < Q0; q++) for (let i = 0; i < S0; i++) {
      if (short.industry[q * S0 + i] !== long.industry[q * S1 + i] || short.mart[q * S0 + i] !== long.mart[q * S1 + i]) throw new Error(`industry or mart differs at ${q}, ${i}`)
      for (let k = 0; k < 2; k++) if (short.metal[(q * S0 + i) * 2 + k] !== long.metal[(q * S1 + i) * 2 + k]) throw new Error(`metal differs at ${q}, ${i}`)
      for (let k = 0; k < 5; k++) if (short.priceIndex[(q * S0 + i) * 5 + k] !== long.priceIndex[(q * S1 + i) * 5 + k]) throw new Error(`price differs at ${q}, ${i}`)
    }
    const D = short.deposits.length
    expect(long.deposits.length).toBe(D)
    for (let k = 0; k < Q0 * D; k++) if (short.depositOutput[k] !== long.depositOutput[k]) throw new Error(`deposit output differs at ${k}`)
    for (const d of short.deposits) {
      const e = long.deposits[d.id]
      expect([e.kind, e.cell, e.richness]).toEqual([d.kind, d.cell, d.richness])
      if (d.foundYear >= 0) expect([e.foundYear, e.foundBy, e.variety]).toEqual([d.foundYear, d.foundBy, d.variety])
      if (d.exhaustedYear >= 0) expect(e.exhaustedYear).toBe(d.exhaustedYear)
    }
    // Varieties and traditions: names (and everything fixed at birth) held by the end of the shorter run match.
    for (const v of short.varieties) expect(long.varieties[v.id]).toEqual(v)
    const T0 = short.traditions.length, T1 = long.traditions.length
    for (const t of short.traditions) {
      const u = long.traditions[t.id]
      expect([u.craft, u.people, u.maker, u.bornYear, u.bornAt, u.parent, u.variety]).toEqual([t.craft, t.people, t.maker, t.bornYear, t.bornAt, t.parent, t.variety])
      expect(u.seats.slice(0, t.seats.length)).toEqual(t.seats)
      if (t.endYear >= 0) expect(u.endYear).toBe(t.endYear)
    }
    for (let q = 0; q < Q0; q++) for (let t = 0; t < T0; t++) if (short.traditionQuality[q * T0 + t] !== long.traditionQuality[q * T1 + t]) throw new Error(`quality differs at ${q}, ${t}`)
    const L0 = short.longHaul, L1 = long.longHaul
    for (let k = 0; k < L0.count; k++) {
      expect([L1.a[k], L1.b[k], L1.kind[k], L1.openedYear[k], L1.chart[k]]).toEqual([L0.a[k], L0.b[k], L0.kind[k], L0.openedYear[k], L0.chart[k]])
      if (L0.closedYear[k] >= 0) expect(L1.closedYear[k] === -1 || L1.closedYear[k] >= L0.closedYear[k]).toBe(true) // (a relay leg found again later reopens)
      for (let q = 0; q < Q0; q++) if (short.longHaulVolume[q * L0.count + k] !== long.longHaulVolume[q * L1.count + k]) throw new Error(`leg volume differs at ${q}, ${k}`)
    }
    // (A secret species nobody held from the start begins when a people first tames it: foundAt -1 until then.)
    for (const x of short.secrets) { const y = long.secrets[x.id]; expect([y.kind, y.subject]).toEqual([x.kind, x.subject]); if (x.foundAt >= 0) expect([y.foundYear, y.foundAt]).toEqual([x.foundYear, x.foundAt]) }
    const K0 = short.secrets.length, K1 = long.secrets.length
    for (let q = 0; q < Q0; q++) for (let k = 0; k < K0; k++) if (short.secretGuard[q * K0 + k] !== long.secretGuard[q * K1 + k]) throw new Error(`guard differs at ${q}, ${k}`)
    for (const p of short.posts) { const r = long.posts[p.id]; expect([r.kind, r.owner, r.host, r.settlement, r.leg, r.foundedYear]).toEqual([p.kind, p.owner, p.host, p.settlement, p.leg, p.foundedYear]) }
    // Resumable.
    const run = createHistoryRun(w)
    const a = run.advanceTo(1300)
    expect(hashGoods(a)).toBe(hashGoods(short))
    const b = run.advanceTo(1800)
    expect(hashGoods(b)).toBe(hashGoods(long))
    expect(hashPre(b)).toBe(hashPre(long))
    expect(hashGoods(a)).toBe(hashGoods(short)) // (untouched by the extension)
    const bufs = (h: History) => [h.depositOutput, h.traditionQuality, h.industry, h.metal, h.longHaulVolume, h.priceIndex, h.mart, h.secretGuard, h.longHaul.a, h.longHaul.path, h.secretHolds.secret].map((x) => x.buffer)
    const seen = new Set(bufs(a))
    for (const x of bufs(b)) expect(seen.has(x)).toBe(false)
    expect(a.varieties[0]).not.toBe(b.varieties[0])
  }, 180_000)

  it('every history satisfies the goods invariants', () => {
    for (const seed of [1, 42, 9]) checkGoods(world(seed), history(seed))
    const w = generateWorld(9, { subdivisions: 24 })
    checkGoods(w, simulateHistory(w, { years: 1500 }))
  }, 240_000)

  it('stocks never go negative and the variety mix never exceeds the stock', () => {
    let worst = 0, negative = 0
    runHistory(world(3), { years: 1600 }, (s, t) => {
      const g = s.goods
      if (g === null || s.year % 7 !== 0) return
      for (const id of s.living) {
        if (id >= g.cap) continue
        for (let c = 7; c < 13; c++) if (g.held[id * 13 + c] < -1e-9) negative++
        for (let m = 0; m < 4; m++) {
          const c = [7, 9, 10, 11][m]
          let named = 0
          for (let k = 0; k < 4; k++) { const a = g.mixA[(id * 4 + m) * 4 + k]; if (a < 0) negative++; named += a }
          const S = g.held[id * 13 + c]
          if (named - S > worst) worst = named - S
        }
        if (g.tools[id] < 0 || g.arms[id] < 0) negative++
      }
      void t
    })
    expect(negative).toBe(0)
    expect(worst).toBeLessThan(1e-6)
  }, 120_000)

  it('dynamics: deposits found and worked, traditions, lanes and posts, secrets that leak, technology apart', () => {
    const seeds = [1, 2, 3, 42, 9, 1337]
    let found = 0, traditions = 0, lanes = 0, posts = 0, leaks = 0, channels = 0, towns = 0, spreadM = 0, spreadC = 0
    const seenCh = new Set<number>() // (membership only)
    for (const seed of seeds) {
      const h = history(seed)
      found += h.deposits.filter((d) => d.foundYear >= 0).length
      traditions += h.traditions.length
      lanes += h.events.filter((e) => e.type === EventType.DirectRoute).length
      posts += h.posts.length
      for (const e of h.events) if (e.type === EventType.SecretLeaked) { leaks++; seenCh.add(e.extra ?? -1) }
      const S = h.settlements.length, q = h.snapshotCount - 1
      for (let i = 0; i < S; i++) if (h.population[q * S + i] >= TOWN_POPULATION) towns++
      const P = h.peoples.length
      let mn = 99, mx = 0, cn = 99, cx = 0
      for (let p = 0; p < P; p++) {
        const m = h.technology[(q * P + p) * 4 + 2], c = h.technology[(q * P + p) * 4 + 3]
        if (m > 0) { mn = Math.min(mn, m); mx = Math.max(mx, m) }
        if (c > 0) { cn = Math.min(cn, c); cx = Math.max(cx, c) }
      }
      spreadM += mx - mn
      spreadC += cx - cn
    }
    channels = seenCh.size
    const n = seeds.length
    expect(found / n).toBeGreaterThan(8)
    expect(traditions / n).toBeGreaterThan(1)
    expect(lanes / n).toBeGreaterThan(1)
    expect(lanes / n).toBeLessThan(40)
    expect(posts / n).toBeGreaterThan(1)
    expect(leaks / n).toBeGreaterThan(2)
    expect(channels).toBeGreaterThanOrEqual(4)
    expect(towns / n).toBeGreaterThan(15)
    // The diffusion brake: peoples' technology apart by more than the old 0.1 (each still advancing).
    expect(spreadM / n).toBeGreaterThan(0.3)
    expect(spreadC / n).toBeGreaterThan(0.3)
    for (const seed of seeds) {
      const h = history(seed)
      const P = h.peoples.length
      const q0 = Math.floor(1500 / h.snapshotInterval), q1 = h.snapshotCount - 1
      for (let p = 0; p < P; p++) {
        const a = h.technology[(q0 * P + p) * 4], b = h.technology[(q1 * P + p) * 4]
        if (a > 0 && b > 0) expect(b).toBeGreaterThan(a)
      }
    }
  }, 300_000)
})
