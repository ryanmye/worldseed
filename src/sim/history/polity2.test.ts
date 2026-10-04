// polities v2: tests of trade policy, the outlaw economy, civil wars, partitions and bonds between states.

import { describe, expect, it } from 'vitest'
import { BondEnd, BondKind, EventType, GOOD_COUNT, PolityEnd, PolityOrigin, StructureType, WarKind, WarOutcome } from '../../contract.ts'
import type { History, World } from '../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../index.ts'

function fnv(h: number, a: ArrayBufferView): number {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) }
  return h
}

/** Hash of the v2 fields. */
function hashV2(hi: History): string {
  let h = 0x811c9dc5
  for (const a of [hi.tariff, hi.tariffRevenue, hi.smuggleVolume, hi.tradeLoss, hi.contraband, hi.piracy]) h = fnv(h, a)
  const b = hi.bonds
  for (const a of [b.kind, b.a, b.b, b.startYear, b.endYear, b.end]) h = fnv(h, a)
  const em = hi.embargoes
  for (const a of [em.a, em.b, em.startYear, em.endYear]) h = fnv(h, a)
  const ev: number[] = []
  for (const e of hi.events) if (e.type >= EventType.CivilWar && e.type <= EventType.Blockade) ev.push(e.year, e.type, e.settlement, e.other, e.value, e.extra ?? -1)
  h = fnv(h, Float64Array.from(ev))
  const forts: number[] = []
  for (const x of hi.structures) if (x.type === StructureType.Fort) forts.push(x.id, x.cell, x.settlement, x.builtYear, x.lostYear)
  h = fnv(h, Int32Array.from(forts))
  return (h >>> 0).toString(16) + ':' + b.count
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

/** Every structural invariant of the v2 fields. */
function checkV2(w: World, h: History): void {
  const S = h.settlements.length, P = h.polities.length, NP = h.peoples.length
  const Q = h.snapshotCount
  const RC = h.trade.count, TQ = h.tradeSnapshotCount
  expect(h.tariff.length).toBe(Q * P)
  expect(h.tariffRevenue.length).toBe(Q * P)
  expect(h.contraband.length).toBe(Q * S)
  expect(h.piracy.length).toBe(Q * S)
  expect(h.smuggleVolume.length).toBe(TQ * RC)
  expect(h.tradeLoss.length).toBe(TQ * RC)
  // Tariffs: only while a polity lives; revenue never negative.
  for (let q = 0; q < Q; q++) {
    const y = q * h.snapshotInterval
    for (let p = 0; p < P; p++) {
      const t = h.tariff[q * P + p], r = h.tariffRevenue[q * P + p]
      if (!(r >= 0)) throw new Error(`revenue ${r} of polity ${p} at ${y}`)
      const x = h.polities[p]
      if ((y < x.foundedYear || (x.endedYear >= 0 && y >= x.endedYear)) && (t !== 0 || r !== 0)) throw new Error(`tariff of polity ${p} at ${y} outside its life`)
    }
  }
  // Contraband and pirates only at living settlements; pirates only on coasts.
  const { neighborOffsets: off, neighbors: nb } = w.grid
  const coastal = (c: number): boolean => { for (let k = off[c]; k < off[c + 1]; k++) if (w.elevation[nb[k]] < 0) return true; return false }
  for (let q = 0; q < Q; q++) {
    for (let i = 0; i < S; i++) {
      const c = h.contraband[q * S + i], x = h.piracy[q * S + i]
      if (c === 0 && x === 0) continue
      if (h.population[q * S + i] <= 0) throw new Error(`contraband or pirates at dead settlement ${i} in snapshot ${q}`)
      if (x > 0 && !coastal(h.settlements[i].cell)) throw new Error(`pirates inland at ${i}`)
    }
  }
  // Contraband and losses only on routes that carry trade; contraband is part of the volume.
  for (let k = 0; k < TQ * RC; k++) {
    const v = h.tradeVolume[k], s = h.smuggleVolume[k], l = h.tradeLoss[k]
    if (!(s >= 0)) throw new Error(`smuggle volume ${s}`)
    if ((s > 0 || l > 0) && !(v > 0)) throw new Error(`contraband or losses on idle route ${k % RC} at trade snapshot ${Math.floor(k / RC)}`)
    if (s > v * 1.0001 + 1e-3) throw new Error(`contraband ${s} above the route's volume ${v}`)
  }
  // Bonds: between polities alive over the bond, whose peoples are in contact; a polity is the subject of at most one
  // vassal or tribute bond at a time, and an overlord is never itself a vassal (no chains).
  const B = h.bonds
  for (const a of [B.kind, B.a, B.b, B.startYear, B.endYear, B.end]) expect(a.length).toBe(B.count)
  for (let k = 0; k < B.count; k++) {
    const a = B.a[k], b = B.b[k]
    expect(a !== b && a >= 0 && a < P && b >= 0 && b < P).toBe(true)
    expect(B.kind[k] <= BondKind.Alliance).toBe(true)
    if (k > 0) expect(B.startYear[k]).toBeGreaterThanOrEqual(B.startYear[k - 1])
    for (const p of [a, b]) expect(aliveP(h, p, B.startYear[k])).toBe(true)
    if (B.endYear[k] >= 0) {
      expect(B.endYear[k]).toBeGreaterThanOrEqual(B.startYear[k])
      expect(B.end[k]).not.toBe(BondEnd.Ongoing)
      for (const p of [a, b]) expect(aliveP(h, p, B.endYear[k]) || h.polities[p].endedYear === B.endYear[k]).toBe(true)
    } else {
      expect(B.end[k]).toBe(BondEnd.Ongoing)
      for (const p of [a, b]) expect(h.polities[p].endedYear).toBe(-1)
    }
    const pa = h.polities[a].people, pb = h.polities[b].people
    if (pa !== pb) { const c = h.contactYear[pa * NP + pb]; expect(c >= 0 && c <= B.startYear[k]).toBe(true) }
  }
  // Embargoes: between two polities alive when declared, a < b, never between a subject and its overlord; an embargo in
  // force at the end is between living polities; one pair has at most one in force at a time.
  const E = h.embargoes
  for (const a of [E.a, E.b, E.startYear, E.endYear]) expect(a.length).toBe(E.count)
  for (let k = 0; k < E.count; k++) {
    const a = E.a[k], b = E.b[k]
    expect(a < b && a >= 0 && b < P).toBe(true)
    if (k > 0) expect(E.startYear[k]).toBeGreaterThanOrEqual(E.startYear[k - 1])
    for (const p of [a, b]) expect(aliveP(h, p, E.startYear[k])).toBe(true)
    if (E.endYear[k] >= 0) expect(E.endYear[k]).toBeGreaterThanOrEqual(E.startYear[k])
    else for (const p of [a, b]) expect(h.polities[p].endedYear).toBe(-1)
    for (let j = 0; j < k; j++) if (E.a[j] === a && E.b[j] === b) expect(E.endYear[j] >= 0 && E.endYear[j] <= E.startYear[k]).toBe(true)
    for (let j = 0; j < B.count; j++) {
      if (B.kind[j] === BondKind.Alliance || B.startYear[j] >= E.startYear[k] || (B.endYear[j] >= 0 && B.endYear[j] <= E.startYear[k])) continue
      if ((B.a[j] === a && B.b[j] === b) || (B.a[j] === b && B.b[j] === a)) throw new Error(`embargo ${k} between a subject and its overlord (bond ${j})`)
    }
  }
  for (let y = 0; y <= h.years; y += 25) {
    const over = new Int32Array(P).fill(-1)
    for (let k = 0; k < B.count; k++) {
      if (B.kind[k] === BondKind.Alliance || B.startYear[k] > y || (B.endYear[k] >= 0 && B.endYear[k] <= y)) continue
      if (over[B.a[k]] >= 0) throw new Error(`polity ${B.a[k]} subject of two bonds at ${y}`)
      over[B.a[k]] = B.b[k]
    }
    for (let p = 0; p < P; p++) if (over[p] >= 0 && over[over[p]] >= 0) throw new Error(`chain of bonds at ${y}: ${p} -> ${over[p]} -> ${over[over[p]]}`)
  }
  // Civil wars: the pretender's state is a successor of the realm it rose against; partitions likewise.
  const W = h.wars
  for (let k = 0; k < W.count; k++) {
    if (W.kind[k] !== WarKind.CivilWar) continue
    const a = W.attacker[k], d = W.defender[k]
    expect(h.polities[a].origin).toBe(PolityOrigin.CivilWar)
    expect(h.polities[a].parent).toBe(d)
    expect(W.startYear[k]).toBe(h.polities[a].foundedYear)
    if (W.outcome[k] === WarOutcome.Reunified) expect(h.polities[a].endedYear === W.endYear[k] || h.polities[d].endedYear === W.endYear[k]).toBe(true)
  }
  for (const x of h.polities) {
    if (x.origin !== PolityOrigin.CivilWar && x.origin !== PolityOrigin.Partition) continue
    expect(x.parent).toBeGreaterThanOrEqual(0)
    expect(aliveP(h, x.parent, x.foundedYear)).toBe(true)
    // Its first capital was a member of the parent at the snapshot before it rose (or came to the parent since: taken in a war, joined, defected).
    const q = Math.floor((x.foundedYear - 1) / h.snapshotInterval)
    const c0 = x.capitals[0], y0 = q * h.snapshotInterval
    if (q >= 0 && y0 >= h.polities[x.parent].foundedYear && h.polity[q * S + c0] !== x.parent) {
      const came = h.events.some((e) => e.settlement === c0 && e.year > y0 && e.year <= x.foundedYear && (e.type === EventType.Conquered || e.type === EventType.Joined || e.type === EventType.Defected))
      if (!came) throw new Error(`polity ${x.id} (origin ${x.origin}) rose at ${c0}, not a member of its parent ${x.parent} at ${y0}`)
    }
    if (x.origin === PolityOrigin.CivilWar) expect(W.kind.some((kd, k) => kd === WarKind.CivilWar && W.attacker[k] === x.id)).toBe(true)
  }
  // Forts: on land, on their builder's territory when built.
  const L = h.landCells.length
  const landIdx = new Map<number, number>()
  for (let k = 0; k < L; k++) landIdx.set(h.landCells[k], k)
  for (const x of h.structures) {
    if (x.type !== StructureType.Fort) continue
    const k = landIdx.get(x.cell)
    expect(k).toBeDefined()
    const lq = Math.floor(x.builtYear / h.landInterval)
    expect(h.territory[lq * L + (k as number)]).toBe(x.settlement + 1)
    expect(h.polity[Math.floor(x.builtYear / h.snapshotInterval) * S + x.settlement]).toBeGreaterThanOrEqual(0)
  }
  // Events agree with the tables.
  const capAt = (p: number, y: number): number => { const x = h.polities[p]; let c = x.capitals[0]; for (let i = 0; i < x.capitals.length; i++) if (x.capitalYears[i] <= y) c = x.capitals[i]; return c }
  for (const e of h.events) {
    switch (e.type) {
      case EventType.CivilWar:
        expect(W.kind[e.value]).toBe(WarKind.CivilWar)
        expect(e.settlement).toBe(h.polities[W.attacker[e.value]].capitals[0])
        break
      case EventType.Partitioned: {
        expect(aliveP(h, e.value, e.year)).toBe(true)
        expect(h.polities.some((x) => x.origin === PolityOrigin.Partition && x.parent === e.value && x.foundedYear === e.year)).toBe(true)
        break
      }
      case EventType.Reunified: {
        const x = h.polities[e.value]
        expect(x.endedYear).toBe(e.year)
        expect(x.endCause).toBe(PolityEnd.Reunified)
        break
      }
      case EventType.BecameVassal: {
        const tribute = e.value >= 1000
        const b = tribute ? e.value - 1000 : e.value
        const kind = tribute ? BondKind.Tribute : BondKind.Vassal
        let found = false
        for (let k = 0; k < B.count && !found; k++) {
          if (B.kind[k] !== kind || B.b[k] !== b) continue
          if (e.extra === 0 && B.startYear[k] === e.year && capAt(B.a[k], e.year) === e.settlement) found = true
          if (e.extra === 1 && B.endYear[k] === e.year && B.end[k] === BondEnd.Freed) found = true
        }
        if (!found) throw new Error(`BecameVassal at ${e.year} (${e.settlement} -> ${e.value}, extra ${e.extra}) without its bond`)
        break
      }
      case EventType.Alliance: {
        let found = false
        for (let k = 0; k < B.count && !found; k++) if (B.kind[k] === BondKind.Alliance && B.startYear[k] === e.year && B.b[k] === e.value) found = true
        expect(found).toBe(true)
        break
      }
      case EventType.SmugglingRing: case EventType.PiratesRise: case EventType.PiratesSuppressed: {
        const st = h.settlements[e.settlement]
        expect(e.year >= st.foundedYear && (st.abandonedYear < 0 || e.year <= st.abandonedYear)).toBe(true)
        if (e.type !== EventType.SmugglingRing) expect(coastal(st.cell)).toBe(true)
        if (e.type === EventType.SmugglingRing) expect(e.value >= 0 && e.value < GOOD_COUNT).toBe(true)
        break
      }
      case EventType.Blockade:
        expect(e.year).toBeGreaterThanOrEqual(W.startYear[e.value])
        if (W.endYear[e.value] >= 0) expect(e.year).toBeLessThanOrEqual(W.endYear[e.value])
        expect(h.polities[W.attacker[e.value]].capitals).toContain(e.other) // (its capital that year; it may move later the same year)
        break
      default:
        break
    }
  }
}

describe('polities v2', () => {
  it('is deterministic; a longer run repeats a shorter one; a resumed run equals runs from scratch, owning its arrays', () => {
    const w = world(3)
    const a = history(3), b = simulateHistory(w)
    expect(hashV2(b)).toBe(hashV2(a))
    expect(hashV2(history(42))).not.toBe(hashV2(a))
    const short = simulateHistory(w, { years: 1200 })
    const long = simulateHistory(w, { years: 1700 })
    const S0 = short.settlements.length, S1 = long.settlements.length
    const P0 = short.polities.length, P1 = long.polities.length
    for (let q = 0; q < short.snapshotCount; q++) {
      for (let i = 0; i < S0; i++) if (short.contraband[q * S0 + i] !== long.contraband[q * S1 + i] || short.piracy[q * S0 + i] !== long.piracy[q * S1 + i]) throw new Error(`contraband or piracy differ at snapshot ${q}, settlement ${i}`)
      for (let p = 0; p < P0; p++) if (short.tariff[q * P0 + p] !== long.tariff[q * P1 + p] || short.tariffRevenue[q * P0 + p] !== long.tariffRevenue[q * P1 + p]) throw new Error(`tariff differs at snapshot ${q}, polity ${p}`)
    }
    const R0 = short.trade.count, R1 = long.trade.count
    for (let q = 0; q < short.tradeSnapshotCount; q++) for (let r = 0; r < R0; r++) if (short.smuggleVolume[q * R0 + r] !== long.smuggleVolume[q * R1 + r] || short.tradeLoss[q * R0 + r] !== long.tradeLoss[q * R1 + r]) throw new Error(`smuggle volume or losses differ at trade snapshot ${q}, route ${r}`)
    const B0 = short.bonds, B1 = long.bonds
    for (let k = 0; k < B0.count; k++) {
      expect([B1.kind[k], B1.a[k], B1.b[k], B1.startYear[k]]).toEqual([B0.kind[k], B0.a[k], B0.b[k], B0.startYear[k]])
      if (B0.endYear[k] >= 0) expect([B1.endYear[k], B1.end[k]]).toEqual([B0.endYear[k], B0.end[k]])
      else expect(B1.endYear[k] === -1 || B1.endYear[k] > short.years).toBe(true)
    }
    const E0 = short.embargoes, E1 = long.embargoes
    expect(E1.count).toBeGreaterThanOrEqual(E0.count)
    for (let k = 0; k < E0.count; k++) {
      expect([E1.a[k], E1.b[k], E1.startYear[k]]).toEqual([E0.a[k], E0.b[k], E0.startYear[k]])
      if (E0.endYear[k] >= 0) expect(E1.endYear[k]).toBe(E0.endYear[k])
      else expect(E1.endYear[k] === -1 || E1.endYear[k] > short.years).toBe(true)
    }
    for (let k = E0.count; k < E1.count; k++) expect(E1.startYear[k]).toBeGreaterThan(short.years)
    const ev = (h: History, y: number) => h.events.filter((e) => e.year <= y && e.type >= EventType.CivilWar && e.type <= EventType.Blockade).map((e) => [e.year, e.type, e.settlement, e.other, e.value, e.extra ?? -1].join(','))
    expect(ev(long, 1200)).toEqual(ev(short, 1200))
    // Resumable.
    const run = createHistoryRun(w)
    const x = run.advanceTo(1200)
    expect(hashV2(x)).toBe(hashV2(short))
    const y = run.advanceTo(1700)
    expect(hashV2(y)).toBe(hashV2(long))
    expect(hashV2(x)).toBe(hashV2(short))
    const arrays = (h: History) => [h.tariff, h.tariffRevenue, h.smuggleVolume, h.tradeLoss, h.contraband, h.piracy, h.bonds.kind, h.bonds.a, h.bonds.b, h.bonds.startYear, h.bonds.endYear, h.bonds.end, h.embargoes.a, h.embargoes.b, h.embargoes.startYear, h.embargoes.endYear]
    const seen = new Set(arrays(x).map((z) => z.buffer))
    for (const z of arrays(y)) {
      expect(seen.has(z.buffer)).toBe(false)
      expect(z.byteOffset).toBe(0)
      expect(z.buffer.byteLength).toBe(z.byteLength)
    }
  }, 300_000)

  it('every history satisfies the v2 invariants', () => {
    for (const seed of [1, 42, 7]) checkV2(world(seed), history(seed))
    const w = generateWorld(9, { subdivisions: 24 })
    checkV2(w, simulateHistory(w, { years: 1500 }))
  }, 180_000)

  it('states tax trade and smugglers evade them; pirates rise and fall; realms split and reunite; vassals and allies bind them', () => {
    const seeds = [1, 2, 3, 42, 1337, 7]
    let civil = 0, partitions = 0, reunified = 0, vassals = 0, alliances = 0, havens = 0, suppressed = 0, rings = 0, blockades = 0, forts = 0, worldsWithPirates = 0, embargoes = 0
    for (const seed of seeds) {
      const h = history(seed)
      const P = h.polities.length, Q = h.snapshotCount
      // Tariffs a tenth or so of the goods' value, revenue reaching the capitals.
      let tsum = 0, tn = 0, rev = 0
      for (let p = 0; p < P; p++) { const t = h.tariff[(Q - 1) * P + p]; if (t > 0) { tsum += t / 255; tn++ } rev += h.tariffRevenue[(Q - 1) * P + p] }
      expect(tn).toBeGreaterThan(0)
      expect(tsum / tn).toBeGreaterThan(0.03)
      expect(tsum / tn).toBeLessThan(0.3)
      expect(rev).toBeGreaterThan(0)
      // Contraband: noticeable but minor.
      const RC = h.trade.count
      let sv = 0, tv = 0
      for (let q = Math.floor(1500 / h.tradeInterval); q < h.tradeSnapshotCount; q++) for (let r = 0; r < RC; r++) { sv += h.smuggleVolume[q * RC + r]; tv += h.tradeVolume[q * RC + r] }
      expect(sv / tv).toBeGreaterThan(0.002)
      expect(sv / tv).toBeLessThan(0.15)
      const count = (t: number) => h.events.filter((e) => e.type === t).length
      civil += count(EventType.CivilWar); partitions += count(EventType.Partitioned); reunified += count(EventType.Reunified)
      embargoes += h.embargoes.count
      havens += count(EventType.PiratesRise); suppressed += count(EventType.PiratesSuppressed); rings += count(EventType.SmugglingRing); blockades += count(EventType.Blockade)
      if (count(EventType.PiratesRise) > 0) worldsWithPirates++
      for (let k = 0; k < h.bonds.count; k++) { if (h.bonds.kind[k] === BondKind.Vassal) vassals++; else if (h.bonds.kind[k] === BondKind.Alliance) alliances++ }
      forts += h.structures.filter((x) => x.type === StructureType.Fort).length
      // A handful of havens and hubs, not a flood.
      expect(count(EventType.PiratesRise)).toBeLessThanOrEqual(40)
      expect(count(EventType.SmugglingRing)).toBeLessThanOrEqual(40)
    }
    expect(embargoes).toBeGreaterThan(0)
    expect(civil).toBeGreaterThan(0)
    expect(partitions).toBeGreaterThan(0)
    expect(reunified).toBeGreaterThan(0)
    expect(vassals).toBeGreaterThan(seeds.length)
    expect(alliances).toBeGreaterThan(0)
    expect(havens).toBeGreaterThan(0)
    expect(suppressed).toBeGreaterThan(0)
    expect(rings).toBeGreaterThan(0)
    expect(blockades).toBeGreaterThan(0)
    expect(forts).toBeGreaterThan(0)
    expect(worldsWithPirates).toBeGreaterThanOrEqual(seeds.length - 2)
  }, 240_000)
})
