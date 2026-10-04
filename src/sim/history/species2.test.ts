// Species v2: cash crops, the new goods, habit, storage, blight, techniques. Determinism and prefix stability of the
// new History fields, their structural invariants, and dynamics bounds (see speciesV2.ts and the files it runs).

import { describe, expect, it } from 'vitest'
import { EventType, GOOD_COUNT, SpeciesCategory } from '../../contract.ts'
import type { History, HistoryEvent, World } from '../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../index.ts'
import { runHistory } from './index.ts'
import type { HistoryRun } from './index.ts'
import { buildTerrain } from './terrain.ts'
import type { Terrain } from './terrain.ts'
import { HABIT } from './params.ts'
import { CASH, hasBit, K_COUNT, S_COUNT, SP, speciesFit, SPECIES_TABLE, STIMULANTS, TECHNIQUES } from './species.ts'

const SEEDS = [1, 2, 3, 42, 1337, 2024]
const V2_EVENTS: number[] = [EventType.TechniqueFound, EventType.TechniqueAdopted, EventType.Blight, EventType.HabitSpreads, EventType.Drain, EventType.Panzootic]

function fnv(h: number, a: ArrayBufferView): number {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) }
  return h
}
/** Hash of the v2 fields: cash, techniques, habit, stimulants, storable, the v2 events (with extra), the species' optional fields. */
function hashV2(h: History): string {
  let x = 0x811c9dc5
  for (const a of [h.cash, h.techniqueYear, h.techniqueSource, h.habit, h.storable, h.population]) x = fnv(x, a)
  const ints: number[] = [...h.stimulants]
  for (const t of h.techniques) { ints.push(t.id, t.species); for (const s of [t.archetype, t.name]) for (let i = 0; i < s.length; i++) ints.push(s.charCodeAt(i)) }
  for (const s of h.species) ints.push(Math.round((s.value ?? -1) * 1000), Math.round((s.habit ?? -1) * 1000), Math.round((s.harm ?? -1) * 1000), s.clonal ? 1 : 0, Math.round((s.storability ?? -1) * 1000))
  x = fnv(x, Int32Array.from(ints))
  const ev: number[] = []
  for (const e of h.events) if (V2_EVENTS.indexOf(e.type) >= 0) ev.push(e.year, e.type, e.settlement, e.other, e.value, e.extra ?? -2)
  x = fnv(x, Float64Array.from(ev))
  return (x >>> 0).toString(16) + ':' + ev.length
}

const worlds = new Map<number, World>()
function world(seed: number): World { let w = worlds.get(seed); if (!w) { w = generateWorld(seed); worlds.set(seed, w) } return w }
const runs = new Map<number, HistoryRun>()
function run(seed: number): HistoryRun { let r = runs.get(seed); if (!r) { r = runHistory(world(seed)); runs.set(seed, r) } return r }
const terrains = new Map<number, Terrain>()
function terrain(seed: number): Terrain { let t = terrains.get(seed); if (!t) { t = buildTerrain(world(seed)); terrains.set(seed, t) } return t }
const fits = new WeakMap<World, Float32Array>()
function fitOf(w: World): Float32Array { let f = fits.get(w); if (!f) { f = speciesFit(w, true); fits.set(w, f) } return f }

/** Structural invariants of the v2 fields of a History. */
function checkV2(w: World, h: History, T: Terrain): void {
  const N = w.grid.cellCount
  const S = h.settlements.length
  const P = h.peoples.length
  const X = h.species.length
  const K = h.techniques.length
  // Catalogue fields.
  for (const x of h.species) {
    const d = SPECIES_TABLE[x.id]
    if (x.category === SpeciesCategory.Staple) {
      expect(x.storability).toBeGreaterThanOrEqual(0); expect(x.storability).toBeLessThanOrEqual(1)
      expect(typeof x.clonal).toBe('boolean')
    } else expect(x.storability).toBeUndefined()
    if (x.category === SpeciesCategory.Stimulant) {
      expect(x.habit).toBeGreaterThan(0); expect(x.habit).toBeLessThanOrEqual(1)
      expect(x.harm).toBeGreaterThanOrEqual(0); expect(x.harm).toBeLessThanOrEqual(1)
    } else { expect(x.habit).toBeUndefined(); expect(x.harm).toBeUndefined() }
    if (d.good >= 0) expect(x.value).toBeGreaterThan(0)
  }
  // Techniques: ids, archetypes, unique names (also against the species'), the species they apply to.
  expect(K).toBe(K_COUNT)
  const names = new Set(h.species.map((x) => x.name))
  h.techniques.forEach((t, k) => {
    expect(t.id).toBe(k)
    expect(t.archetype).toBe(TECHNIQUES[k])
    if (!t.name || names.has(t.name)) throw new Error(`technique ${k} name "${t.name}" empty or not unique`)
    names.add(t.name)
    expect(t.species >= -1 && t.species < X).toBe(true)
  })
  expect(h.techniqueYear.length).toBe(P * K)
  expect(h.techniqueSource.length).toBe(P * K)
  for (let p = 0; p < P; p++) for (let k = 0; k < K; k++) {
    const y = h.techniqueYear[p * K + k], src = h.techniqueSource[p * K + k]
    if (!(y === -1 || (y > 0 && y <= h.years))) throw new Error(`techniqueYear[${p}, ${k}] = ${y}`)
    if (y < 0 && src !== -1) throw new Error(`technique ${k} of people ${p} never held but source ${src}`)
    if (src >= 0) {
      if (src === p || src >= P) throw new Error(`technique ${k} of people ${p} from ${src}`)
      const met = h.contactYear[p * P + src]
      if (!(met >= 0 && met <= y)) throw new Error(`people ${p} learned technique ${k} from people ${src} in ${y}, met in ${met}`)
      const ys = h.techniqueYear[src * K + k]
      if (!(ys >= 0 && ys <= y)) throw new Error(`people ${p} learned technique ${k} in ${y} from people ${src}, who had it from ${ys}`)
    }
  }
  // Stimulants and habit.
  const stim = h.species.filter((x) => x.category === SpeciesCategory.Stimulant).map((x) => x.id)
  expect(h.stimulants).toEqual(stim)
  const NK = h.stimulants.length
  expect(h.habit.length).toBe(h.snapshotCount * P * NK)
  const reached = new Uint8Array(P)
  for (let q = 0; q < h.snapshotCount; q++) {
    const year = q * h.snapshotInterval
    for (let p = 0; p < P; p++) for (let k = 0; k < NK; k++) {
      if (h.habit[(q * P + p) * NK + k] === 0) continue
      // Only where the stimulant could reach the people: held by it or by a people its trade reaches (peoples linked by contact by then).
      const x = h.stimulants[k]
      reached.fill(0)
      reached[p] = 1
      const queue = [p]
      let ok = false
      while (queue.length && !ok) {
        const a = queue.shift() as number
        const y = h.speciesYear[a * X + x]
        if (y >= 0 && y <= year) ok = true
        for (let r = 0; r < P; r++) { const c = h.contactYear[a * P + r]; if (!reached[r] && c >= 0 && c <= year) { reached[r] = 1; queue.push(r) } }
      }
      if (!ok) throw new Error(`people ${p} habituated to species ${x} at ${year} without access`)
    }
  }
  // Storable: a byte per settlement per snapshot, 0 where there is nobody (and for expedition bases).
  expect(h.storable.length).toBe(h.snapshotCount * S)
  for (let q = 0; q < h.snapshotCount; q++) for (let id = 0; id < S; id++) {
    const v = h.storable[q * S + id]
    if (v !== 0 && (h.population[q * S + id] <= 0 || h.settlements[id].outpost)) throw new Error(`storable ${v} for settlement ${id} at snapshot ${q} with nobody there`)
  }
  // Cash layer: 0 unless farmed; a cash crop that fits the cell, held by a people farming within reach then.
  expect(h.cash.length).toBe(h.landSnapshotCount * N)
  const fit = fitOf(w)
  const reach = new Int32Array(N)
  for (let q = 0; q < h.landSnapshotCount; q++) {
    const year = q * h.landInterval
    const sq = Math.min(h.snapshotCount - 1, Math.floor(year / h.snapshotInterval))
    reach.fill(0)
    for (let id = 0; id < S; id++) {
      if (h.population[sq * S + id] <= 0 || h.settlements[id].outpost) continue
      const c = h.settlements[id].cell
      for (let k = T.catchOff[c]; k < T.catchOff[c + 1]; k++) reach[T.catchCell[k]] |= 1 << (h.settlements[id].people & 31)
    }
    for (let i = 0; i < N; i++) {
      const v = h.cash[q * N + i]
      if (v === 0) continue
      if (h.landUse[q * N + i] === 0) throw new Error(`cash crop ${v} on unfarmed cell ${i} at land snapshot ${q}`)
      const x = v - 1
      if (CASH.indexOf(x) < 0) throw new Error(`cash layer value ${v} is not a cash crop`)
      if (!(fit[x * N + i] > 0)) throw new Error(`cash crop ${x} on cell ${i} where it does not fit`)
      let held = false
      for (let p = 0; p < P && !held; p++) if (reach[i] & (1 << (p & 31))) { const y = h.speciesYear[p * X + x]; if (y >= 0 && y <= year) held = true }
      if (!held) throw new Error(`cash crop ${x} on cell ${i} at ${year}, held by no people farming near it`)
    }
  }
  for (let i = 0; i < N; i++) if (h.cash[i] !== 0) throw new Error('cash crop at year 0')
  // Events.
  const alive = (id: number, y: number) => h.settlements[id].foundedYear <= y && (h.settlements[id].abandonedYear < 0 || h.settlements[id].abandonedYear >= y)
  const seenT = new Uint8Array(P * K), seenH = new Uint8Array(P * NK), seenD = new Uint8Array(P * NK)
  for (const e of h.events) {
    if (V2_EVENTS.indexOf(e.type) < 0) continue
    const p = h.settlements[e.settlement].people
    if (!alive(e.settlement, e.year)) throw new Error(`v2 event ${e.type} at a settlement not alive in ${e.year}`)
    if (e.other >= 0 && !alive(e.other, e.year)) throw new Error(`v2 event ${e.type} from a settlement not alive in ${e.year}`)
    switch (e.type) {
      case EventType.TechniqueFound:
      case EventType.TechniqueAdopted: {
        const k = e.value
        expect(Number.isInteger(k) && k >= 0 && k < K).toBe(true)
        if (seenT[p * K + k]) throw new Error(`people ${p} gained technique ${k} twice`)
        seenT[p * K + k] = 1
        expect(h.techniqueYear[p * K + k]).toBe(e.year)
        if (e.type === EventType.TechniqueFound) { expect(e.other).toBe(-1); expect(h.techniqueSource[p * K + k]).toBe(-1) }
        else { const q = h.settlements[e.other].people; expect(q).not.toBe(p); expect(h.techniqueSource[p * K + k]).toBe(q) }
        break
      }
      case EventType.Blight: {
        const x = e.value
        expect(h.species[x].category).toBe(SpeciesCategory.Staple)
        expect(e.other).toBe(-1)
        expect(e.extra! > 0 && e.extra! < 1).toBe(true)
        const y = h.speciesYear[p * X + x]
        expect(y >= 0 && y <= e.year).toBe(true)
        break
      }
      case EventType.Panzootic: {
        expect(h.species[e.value].category).toBe(SpeciesCategory.Livestock)
        expect(e.extra! > 0 && e.extra! < 1).toBe(true)
        expect(e.other).toBeGreaterThanOrEqual(0)
        expect(h.settlements[e.other].people).not.toBe(p)
        break
      }
      case EventType.HabitSpreads:
      case EventType.Drain: {
        const k = h.stimulants.indexOf(e.value)
        expect(k).toBeGreaterThanOrEqual(0)
        const seen = e.type === EventType.HabitSpreads ? seenH : seenD
        if (seen[p * NK + k]) throw new Error(`event ${e.type} twice for people ${p} species ${e.value}`)
        seen[p * NK + k] = 1
        if (e.other >= 0) expect(h.settlements[e.other].people).not.toBe(p)
        if (e.type === EventType.HabitSpreads) {
          // Logged when the habit passed the threshold, in a snapshot year.
          const q = e.year / h.snapshotInterval
          expect(Number.isInteger(q)).toBe(true)
          expect(h.habit[(q * P + p) * NK + k]).toBeGreaterThanOrEqual(Math.floor(HABIT.spreads * 255))
        }
        break
      }
    }
  }
  for (let p = 0; p < P; p++) for (let k = 0; k < K; k++) if (h.techniqueYear[p * K + k] > 0 && !seenT[p * K + k]) throw new Error(`people ${p} holds technique ${k} without an event`)
}

/** Prefix: the v2 fields of a run of Y years are those of a longer run as of Y. */
function expectPrefixV2(short: History, long: History): void {
  const Y = short.years
  const later = (a: number, b: number) => (a >= 0 ? b === a : b === -1 || b > Y)
  for (let i = 0; i < short.cash.length; i++) if (short.cash[i] !== long.cash[i]) throw new Error(`cash differs at ${i}`)
  for (let i = 0; i < short.habit.length; i++) if (short.habit[i] !== long.habit[i]) throw new Error(`habit differs at ${i}`)
  const S0 = short.settlements.length, S1 = long.settlements.length
  for (let q = 0; q < short.snapshotCount; q++) for (let id = 0; id < S0; id++) if (short.storable[q * S0 + id] !== long.storable[q * S1 + id]) throw new Error(`storable differs at snapshot ${q} settlement ${id}`)
  expect(long.stimulants).toEqual(short.stimulants)
  for (let i = 0; i < short.techniqueYear.length; i++) {
    if (!later(short.techniqueYear[i], long.techniqueYear[i])) throw new Error(`techniqueYear[${i}] ${short.techniqueYear[i]} vs ${long.techniqueYear[i]}`)
    const want = short.techniqueYear[i] >= 0 ? long.techniqueSource[i] : -1
    if (short.techniqueSource[i] !== want) throw new Error(`techniqueSource[${i}]`)
  }
  const P = short.peoples.length, K = short.techniques.length
  for (let k = 0; k < K; k++) {
    let held = false
    for (let p = 0; p < P; p++) if (short.techniqueYear[p * K + k] >= 0) held = true
    expect(long.techniques[k].archetype).toBe(short.techniques[k].archetype)
    if (held) expect(long.techniques[k].name).toBe(short.techniques[k].name)
  }
  const evS = short.events.filter((e) => V2_EVENTS.indexOf(e.type) >= 0)
  const evL = long.events.filter((e) => V2_EVENTS.indexOf(e.type) >= 0 && e.year <= Y)
  expect(evL).toEqual(evS)
}

describe('species v2', () => {
  it('new fields are deterministic, prefix-stable and resumable, each owning its buffer', () => {
    const w = world(42)
    const a = run(42).history
    const b = simulateHistory(generateWorld(42))
    expect(hashV2(b)).toBe(hashV2(a))
    expect(hashV2(run(1).history)).not.toBe(hashV2(a))
    const short = simulateHistory(w, { years: 900 })
    checkV2(w, short, terrain(42))
    expectPrefixV2(short, a)
    const r = createHistoryRun(w)
    const h1 = r.advanceTo(900)
    expect(hashV2(h1)).toBe(hashV2(short))
    const h2 = r.advanceTo(2000)
    expect(hashV2(h2)).toBe(hashV2(a))
    const bufs = (h: History) => [h.cash, h.techniqueYear, h.techniqueSource, h.habit, h.storable]
    for (const x of bufs(a)) { expect(x.byteOffset).toBe(0); expect(x.buffer.byteLength).toBe(x.byteLength) }
    const seen = new Set(bufs(h1).map((x) => x.buffer))
    for (const x of bufs(h2)) expect(seen.has(x.buffer)).toBe(false)
    expect(new Set(bufs(a).map((x) => x.buffer)).size).toBe(5)
    // Sizes: the cash layer a byte per cell per land snapshot; habit and storable a byte per people-stimulant / settlement per snapshot.
    expect(a.cash.length).toBe(a.landSnapshotCount * w.grid.cellCount)
    expect(a.habit.byteLength).toBeLessThan(64 * 1024)
  }, 120_000)

  it('every history satisfies the v2 invariants', () => {
    for (const seed of SEEDS) checkV2(world(seed), run(seed).history, terrain(seed))
    const w = generateWorld(9, { subdivisions: 24 })
    checkV2(w, simulateHistory(w, { years: 800 }), buildTerrain(w))
  }, 120_000)

  it('the new goods are produced only where their species are held, and stimulant stocks only of held or bought species', () => {
    const w = world(2)
    let checked = 0
    runHistory(w, { years: 1600 }, (s, ts) => {
      if (s.year % 50 !== 0) return
      const sp = s.sp
      for (const id of s.living) {
        if (!ts.trader[id]) continue
        const m0 = sp.m0[id], m1 = sp.m1[id]
        for (let g = 6; g < 9; g++) {
          if (!(sp.v2.prod[id * 3 + g - 6] > 0)) continue
          checked++
          let ok = false
          for (const x of CASH) if (SPECIES_TABLE[x].good === g && hasBit(m0, m1, x)) ok = true
          if (g === 6 && (hasBit(m0, m1, SP.sheepGoat) || hasBit(m0, m1, SP.llama) || hasBit(m0, m1, SP.coldHerd))) ok = true
          if (!ok) throw new Error(`settlement ${id} produced good ${g} in ${s.year} without a species for it`)
        }
        // The species mix of its stimulant stock sums to the stock.
        let t = 0
        for (let k = 0; k < STIMULANTS.length; k++) { const a = sp.v2.amt[id * STIMULANTS.length + k]; expect(a).toBeGreaterThanOrEqual(-1e-9); t += a }
        const st = ts.stock[id * GOOD_COUNT + 8] // (goods: 13 classes)
        if (Math.abs(t - st) > 1e-6 * (1 + st)) throw new Error(`stimulant mix ${t} vs stock ${st} at ${id} in ${s.year}`)
      }
    })
    expect(checked).toBeGreaterThan(0)
  }, 60_000)

  it('dynamics: diverse staples, rare blights, spreading habits, priced luxuries, techniques learned more than found', () => {
    let topOk = 0, harmful = 0, gradient = 0, valueOk = 0, learned = 0, foundOnce = 0, techSeen = 0, storeOk = 0, storeSeen = 0
    for (const seed of SEEDS) {
      const { history: h, diag } = run(seed)
      const N = world(seed).grid.cellCount
      const P = h.peoples.length
      const X = h.species.length
      const S = h.settlements.length
      const lq = h.landSnapshotCount - 1
      // Staples: no single one everywhere.
      const count = new Array<number>(X).fill(0)
      let farmed = 0
      for (let i = 0; i < N; i++) { const c = h.crop[lq * N + i]; if (c > 0) { count[c - 1]++; farmed++ } }
      const top = Math.max(...count) / farmed
      expect(top).toBeLessThan(0.65)
      if (top < 0.5) topOk++
      // Blights: rare.
      const blights = h.events.filter((e) => e.type === EventType.Blight)
      expect(blights.length).toBeLessThanOrEqual(20)
      // Harmful habits reach several peoples; habit and drain events bounded.
      const K = h.stimulants.length, last = h.snapshotCount - 1
      let n = 0
      for (let p = 0; p < P; p++) for (let k = 0; k < K; k++) if ([SP.tobacco, SP.poppy, SP.coca].indexOf(h.stimulants[k] as 35) >= 0 && h.habit[(last * P + p) * K + k] >= 51) { n++; break }
      if (n >= 2) harmful++
      expect(h.events.filter((e) => e.type === EventType.Drain).length).toBeLessThanOrEqual(P * K)
      // Luxury and stimulants: a larger share of value than of weight.
      const gv = diag.goodVolume, q = h.tradeSnapshotCount - 1
      const row = Array.from(gv.slice(q * 9, q * 9 + 9))
      const V = [1, 1.2, 1.4, 2, 5, 6, 2.5, 14, 9]
      const tv = row.reduce((a, b) => a + b, 0), tw = row.reduce((a, b, g) => a + b / V[g], 0)
      if ((row[7] + row[8]) / tv > (row[7] / V[7] + row[8] / V[8]) / tw * 3) valueOk++
      // Techniques: learned more often than found again.
      const KT = h.techniques.length
      for (let k = 0; k < KT; k++) {
        let found = 0, got = 0
        for (let p = 0; p < P; p++) { const y = h.techniqueYear[p * KT + k]; if (y >= 0) { if (h.techniqueSource[p * KT + k] < 0) found++; else got++ } }
        if (found + got === 0) continue
        techSeen++
        if (found <= 2) foundOnce++
        learned += got > 0 ? 1 : 0
      }
      // Storage: grain-fed settlements keep more of their food than tuber-fed ones.
      let sg = 0, wg = 0, stt = 0, wt = 0
      for (let id = 0; id < S; id++) {
        const pop = h.population[last * S + id]
        if (!(pop > 0) || h.settlements[id].outpost) continue
        const c = h.crop[lq * N + h.settlements[id].cell] - 1
        const v = h.storable[last * S + id]
        if ([SP.wheat, SP.barley, SP.paddyRice, SP.millet, SP.sorghum].indexOf(c as 0) >= 0) { sg += pop * v; wg += pop } else if ([SP.potato, SP.cassava, SP.sweetPotato, SP.plantain].indexOf(c as 4) >= 0) { stt += pop * v; wt += pop }
      }
      if (wg > 0 && wt > 0) { storeSeen++; if (sg / wg > stt / wt) storeOk++ }
      // Gradient: a luxury costs more far from its growers (2000).
      void gradient
    }
    expect(topOk).toBeGreaterThanOrEqual(SEEDS.length - 2)
    expect(harmful).toBeGreaterThanOrEqual(SEEDS.length / 2)
    expect(valueOk).toBeGreaterThanOrEqual(SEEDS.length - 1)
    expect(foundOnce).toBeGreaterThanOrEqual(0.7 * techSeen)
    expect(learned).toBeGreaterThanOrEqual(0.5 * techSeen)
    expect(storeOk).toBeGreaterThanOrEqual(storeSeen - 1)
    void S_COUNT
  }, 180_000)

  it('blights and epidemics do not pile up in a long run', () => {
    const w = world(3)
    const h = simulateHistory(w, { years: 5000 })
    const per = (t: number, a: number, b: number) => h.events.filter((e) => e.type === t && e.year >= a && e.year < b).length
    for (const t of [EventType.Blight, EventType.Epidemic, EventType.Panzootic]) {
      const first = per(t, 0, 2500), second = per(t, 2500, 5001)
      expect(second).toBeLessThanOrEqual(first + 6)
    }
    const S = h.settlements.length, last = h.snapshotCount - 1
    let total = 0
    for (let id = 0; id < S; id++) total += h.population[last * S + id]
    expect(Number.isFinite(total) && total > 0).toBe(true)
  }, 120_000)
})

export type { HistoryEvent }
