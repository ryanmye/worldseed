// disease: tests of epidemics, endemic crowd diseases, plague, camp fever and place-bound fever (src/sim/history/disease).

import { describe, expect, it } from 'vitest'
import { CITY_POPULATION, DiseaseKind, DiseaseVia, EventType, JourneyKind, StructureType } from '../../../contract.ts'
import type { History, World } from '../../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../../index.ts'
import { runHistory } from '../index.ts'
import { DZ, FEVER } from './params.ts'

const DISEASE_KEYS = new Set(['diseases', 'epidemics', 'outbreaks', 'fever', 'feverTolerance', 'endemic', 'quarantines'])
const TOURISM_KEYS = new Set(['scenery', 'sceneryKind', 'sights', 'visitorFlows', 'renamings', 'ideas', 'ideaAdoptions', 'landmarks']) // tourism, renaming, ideas, landmarks: (later than the disease system; the golden runs have them off)

function fnvBytes(h: number, b: Uint8Array): number {
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) }
  return h
}
const enc = new TextEncoder()
/** Hash of any value: typed arrays by bytes, arrays and objects key by key (sorted), numbers as float64. */
function hv(h: number, v: unknown): number {
  if (v === null || v === undefined) return fnvBytes(h, enc.encode(String(v)))
  if (ArrayBuffer.isView(v)) { h = fnvBytes(h, enc.encode(v.constructor.name)); return fnvBytes(h, new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) }
  if (typeof v === 'number') return fnvBytes(h, new Uint8Array(new Float64Array([v]).buffer))
  if (typeof v === 'string' || typeof v === 'boolean') return fnvBytes(h, enc.encode(typeof v + String(v)))
  if (Array.isArray(v)) { h = fnvBytes(h, enc.encode('[' + v.length)); for (const x of v) h = hv(h, x); return h }
  if (typeof v === 'object') { for (const k of Object.keys(v as object).sort()) { h = fnvBytes(h, enc.encode(k)); h = hv(h, (v as Record<string, unknown>)[k]) } return h }
  return h
}
/** Hash of every History field that exists without the disease system (all of them, every key; the later tourism fields and resort flags left out). */
function hashPre(hi: History): string {
  const r = hi as unknown as Record<string, unknown>
  let h = 0x811c9dc5
  for (const k of Object.keys(r).filter((x) => !DISEASE_KEYS.has(x) && !TOURISM_KEYS.has(x)).sort()) h = hv(h, k === 'settlements' ? hi.settlements.map((s) => { const o: Record<string, unknown> = { ...s }; delete o.resort; return o }) : r[k])
  return (h >>> 0).toString(16)
}
/** Hash of the disease fields. */
function hashDisease(hi: History): string {
  const r = hi as unknown as Record<string, unknown>
  let h = 0x811c9dc5
  for (const k of [...DISEASE_KEYS].sort()) h = hv(h, r[k])
  return (h >>> 0).toString(16)
}

/**
 * Histories without the disease system: hashPre of simulateHistory with disease off equals the history without it (every key of
 * History but the disease fields): first the commit before it (7bdbe75); since the merge of rulers and religion, that code with
 * the disease system taken out, verified by hashing every field against it and recorded here. A later change outside the
 * disease system must regenerate these.
 */
// (Re-recorded with the far ventures, port gateways and danger siting: tourism-off runs checked on every field against f960f11
// plus this branch's diff; goods-off and polities-off runs against this tree with goods/ or polity/ and migration.ts as before.)
// (Re-recorded with the polities' claims (polity/claims.ts; nothing outside polity/ changed but the contract): runs with
// polities off checked on every field against 1375ac5 (equal but for the new, empty History.claimed, which every-key
// hashes take in); fixed-field hashes of runs with polities off keep their values.)
// (Re-recorded at the merge of the ideas: the merged tree with the ideas off checked on every field, on every golden
// configuration of every system, against main e1d2ae5 plus the fixes the merge made unconditional (a vassal passed to an
// overlord its people never met goes free; a useless technique is of no benefit however stale the crop multiplier; a resort
// is not given up the year new visitors came; a revived name's row); only the 42:2000 and 1:1500 histories changed.)
// (Re-recorded with the danger on the way of trade (polity/params.ts WAYRISK): with WAYRISK.on false the tree was checked
// bit-identical to main dcf64f7 on every History field in every off configuration (goods, disease, rulers, religion, tourism,
// renaming, ideas, landmarks, polities); only the entries with polities on changed.)
// (Re-recorded with the danger-trade and landmark fixes (re-paths round danger, the sea risk's scale, escorts for dear goods,
// the minimum forsaken spell, bandits living off the traffic; the landmarks' crowding, rededication on conquest, revival,
// templates and sights): with every new switch off (WAYRISK.reroute false, escortValue 0, minForsaken 0, seaScale false;
// BANDIT.traffic false; LANDMARK.sights false, crowdTo 0, convertConquest 0, revive 0) the tree was checked identical to main
// e06929d on every History field (the additive ones aside: trade.repath*, landmarks.nameTemplate, changeSettlement) in these
// configurations and in 150- and 50-year chunks; entries without polities changed only by the empty trade.repath* fields.)
const GOLDEN: [number, number, number | undefined, boolean, boolean, string][] = [
  [42, 2000, undefined, true, true, '2121914f'],
  [3, 600, undefined, true, true, 'e7d9247e'],
  [7, 900, undefined, false, false, 'a4cace18'],
  [1, 1500, undefined, true, false, '2294f24c'],
  [9, 800, 24, true, true, '9871c6dd'],
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

const aliveAt = (h: History, id: number, y: number): boolean => h.settlements[id].foundedYear <= y && (h.settlements[id].abandonedYear < 0 || h.settlements[id].abandonedYear >= y)

/** Structural invariants of the disease fields. */
function checkDisease(w: World, h: History): void {
  const S = h.settlements.length, P = h.peoples.length, D = h.diseases.length, N = w.grid.cellCount
  const O = h.outbreaks
  const G = w.grid.positions
  // (one hop between neighbouring cells is about 3.6 / n of chord at subdivision n)
  const hop = 3.6 / Math.sqrt((N - 2) / 10)
  const near2 = 16 * hop * hop
  // Shapes and buffers.
  expect(D).toBeGreaterThanOrEqual(4)
  expect(D).toBeLessThanOrEqual(8)
  expect(h.fever.length).toBe(N)
  expect(h.feverTolerance.length).toBe(h.snapshotCount * P)
  expect(h.endemic.length).toBe(h.snapshotCount * P)
  for (const a of [O.disease, O.settlement, O.year, O.mortality, O.source, O.via, O.epidemic, h.fever, h.feverTolerance, h.endemic, h.quarantines.settlement, h.quarantines.from, h.quarantines.to]) {
    expect(a.byteOffset).toBe(0)
    expect(a.buffer.byteLength).toBe(a.byteLength)
  }
  for (const a of [O.disease, O.settlement, O.year, O.mortality, O.source, O.via, O.epidemic]) expect(a.length).toBe(O.count)
  for (let c = 0; c < N; c++) if (w.elevation[c] < 0 && h.fever[c] !== 0) throw new Error(`fever at sea ${c}`)
  // Tolerance and endemic bits within range.
  for (let i = 0; i < h.feverTolerance.length; i++) if (h.feverTolerance[i] > FEVER.tolMax * 255 + 1) throw new Error(`tolerance ${h.feverTolerance[i]}`)
  for (let i = 0; i < h.endemic.length; i++) if (h.endemic[i] >> D) throw new Error(`endemic bits ${h.endemic[i]}`)
  for (let i = 0; i < h.endemic.length; i++) for (let d = 0; d < D; d++) if ((h.endemic[i] >> d) & 1) expect(h.diseases[d].kind).toBe(DiseaseKind.Crowd)
  // Diseases: names for those that appeared (unique), none for the rest.
  const names = new Set<string>() // (membership only)
  for (const d of h.diseases) {
    expect(d.id).toBe(h.diseases.indexOf(d))
    if (d.firstYear >= 0) {
      expect(d.name.length).toBeGreaterThanOrEqual(3)
      expect(names.has(d.name)).toBe(false)
      names.add(d.name)
      expect(aliveAt(h, d.firstSettlement, d.firstYear)).toBe(true)
      expect(h.settlements[d.firstSettlement].people).toBe(d.originPeople)
      expect(h.events.some((e) => e.type === EventType.DiseaseAppeared && e.value === d.id && e.year === d.firstYear && e.settlement === d.firstSettlement)).toBe(true)
    } else expect(d.name).toBe('')
    expect(d.placeBound).toBe(d.kind === DiseaseKind.Fever)
  }
  // Rows: in year order, of living settlements in the year struck, spread only along links that existed.
  const routesOf = new Map<number, number[]>() // (lookups only) cell -> routes whose path holds it
  const T = h.trade
  for (let r = 0; r < T.count; r++) for (let k = T.pathOffsets[r]; k < T.pathOffsets[r + 1]; k++) { const c = T.path[k]; const l = routesOf.get(c); if (l) l.push(r); else routesOf.set(c, [r]) }
  const L = h.longHaul
  const firstRow = new Int32Array(h.epidemics.length).fill(-1)
  const rowsOf = new Int32Array(h.epidemics.length)
  for (let i = 0; i < O.count; i++) {
    const id = O.settlement[i], y = O.year[i], d = O.disease[i], src = O.source[i], via = O.via[i], e = O.epidemic[i]
    if (i > 0 && y < O.year[i - 1]) throw new Error(`row ${i} out of order`)
    if (!aliveAt(h, id, y) || h.settlements[id].outpost) throw new Error(`row ${i}: settlement ${id} not living in ${y}`)
    expect(d < D && h.diseases[d].kind !== DiseaseKind.Fever).toBe(true)
    if (O.mortality[i] > DZ.maxToll * 255 + 1) throw new Error(`row ${i} toll ${O.mortality[i]}`)
    expect(e >= 0 && e < h.epidemics.length && h.epidemics[e].disease === d).toBe(true)
    if (firstRow[e] < 0) firstRow[e] = i
    rowsOf[e]++
    if (via === DiseaseVia.Origin || via === DiseaseVia.Focus) { expect(firstRow[e]).toBe(i); continue }
    if (src < 0) {
      // (camp fever's army home again with a new wave is the other side of a campaign row)
      expect(via).toBe(DiseaseVia.Army)
      continue
    }
    expect(aliveAt(h, src, y)).toBe(true)
    const ps = h.settlements[src].people, pt = h.settlements[id].people
    if (ps !== pt) { const m = h.contactYear[ps * P + pt]; if (!(m >= 0 && m <= y)) throw new Error(`row ${i}: peoples ${ps}, ${pt} not in contact in ${y}`) }
    const ca = h.settlements[src].cell, cb = h.settlements[id].cell
    if (via === DiseaseVia.Route || via === DiseaseVia.Sea) {
      // (a route's transit settlements are those it passes near: one end on the route's path, the other on or beside it)
      const near = (r: number, c: number): boolean => {
        for (let k = T.pathOffsets[r]; k < T.pathOffsets[r + 1]; k++) {
          const p = T.path[k]
          const dx = G[c * 3] - G[p * 3], dy = G[c * 3 + 1] - G[p * 3 + 1], dz = G[c * 3 + 2] - G[p * 3 + 2]
          if (dx * dx + dy * dy + dz * dz <= near2) return true
        }
        return false
      }
      const ra = routesOf.get(ca) ?? [], rb = routesOf.get(cb) ?? []
      let ok = ra.some((r) => T.openedYear[r] <= y && near(r, cb)) || rb.some((r) => T.openedYear[r] <= y && near(r, ca))
      for (let r = 0; r < T.count && !ok; r++) if (T.openedYear[r] <= y && near(r, ca) && near(r, cb)) ok = true // (two transit settlements beside the way)
      for (let k = 0; k < L.count && !ok; k++) if (L.openedYear[k] <= y && ((L.a[k] === src && L.b[k] === id) || (L.a[k] === id && L.b[k] === src))) ok = true
      if (!ok) throw new Error(`row ${i}: no route or leg between ${src} and ${id} by ${y}`)
    } else if (via === DiseaseVia.Near) {
      const dx = G[ca * 3] - G[cb * 3], dy = G[ca * 3 + 1] - G[cb * 3 + 1], dz = G[ca * 3 + 2] - G[cb * 3 + 2]
      if (dx * dx + dy * dy + dz * dz > near2) throw new Error(`row ${i}: neighbours ${src}, ${id} far apart`)
    } else if (via === DiseaseVia.Kin) {
      expect(h.settlements[id].parent === src || h.settlements[src].parent === id).toBe(true)
    } else if (via === DiseaseVia.Journey || via === DiseaseVia.Army) {
      const J = h.journeys
      let ok = false
      for (let j = 0; j < J.count && !ok; j++) {
        if (Math.abs(J.arriveYear[j] - y) > 1) continue
        if ((J.from[j] === src && J.to[j] === id) || (J.from[j] === id && J.to[j] === src)) ok = via === DiseaseVia.Army ? J.kind[j] === JourneyKind.Army : J.kind[j] !== JourneyKind.Army
      }
      if (!ok) throw new Error(`row ${i}: no journey between ${src} and ${id} in ${y} (via ${via})`)
    } else if (via === DiseaseVia.Contact) {
      expect(h.events.some((ev) => ev.type === EventType.FirstContact && ev.year === y && ((ev.settlement === src && ev.other === id) || (ev.settlement === id && ev.other === src)))).toBe(true)
    } else if (via === DiseaseVia.Visitors) {
      // (tourism: leisure travellers between their home town and the place they visited)
      const F = h.visitorFlows
      let ok = false
      for (let k = 0; k < F.count && !ok; k++) if (F.firstYear[k] <= y && ((F.from[k] === src && F.to[k] === id) || (F.from[k] === id && F.to[k] === src))) ok = true
      if (!ok) throw new Error(`row ${i}: no visitors between ${src} and ${id} by ${y}`)
    } else throw new Error(`row ${i}: via ${via}`)
  }
  // Epidemics agree with their rows.
  for (const e of h.epidemics) {
    expect(rowsOf[e.id]).toBe(e.outbreaks)
    const f = firstRow[e.id]
    expect(f).toBeGreaterThanOrEqual(0)
    expect(O.year[f]).toBe(e.startYear)
    expect(O.settlement[f]).toBe(e.origin)
    expect(e.deaths).toBeGreaterThanOrEqual(0)
    expect(e.network).toBeGreaterThan(0)
    expect(e.peoples.length).toBeGreaterThan(0)
    expect(new Set(e.peoples).size).toBe(e.peoples.length)
    if (e.endYear >= 0) expect(e.endYear).toBeGreaterThanOrEqual(e.startYear)
    // (great once it had killed DZ.great of the network reached so far; the network may grow after)
    expect(h.events.some((x) => x.type === EventType.GreatEpidemic && x.value === e.id)).toBe(e.great)
    if (e.great) expect(e.deaths).toBeGreaterThanOrEqual(DZ.greatMin)
  }
  for (let i = 0; i < O.count; i++) if (!h.epidemics[O.epidemic[i]].peoples.includes(h.settlements[O.settlement[i]].people)) throw new Error(`row ${i}: people not in its epidemic`)
  // Quarantine only at ports of polity members.
  const Q = h.quarantines
  for (let k = 0; k < Q.count; k++) {
    const id = Q.settlement[k], y = Q.from[k]
    expect(aliveAt(h, id, y)).toBe(true)
    expect(h.structures.some((x) => x.type === StructureType.Port && x.settlement === id && x.builtYear <= y && (x.lostYear < 0 || x.lostYear >= y))).toBe(true)
    const ev = h.events.find((e) => e.type === EventType.Quarantine && e.settlement === id && e.year === y)
    expect(ev).toBeDefined()
    if (ev) {
      const pol = h.polities[ev.value]
      expect(pol.foundedYear <= y && (pol.endedYear < 0 || pol.endedYear >= y)).toBe(true)
    }
    if (Q.to[k] >= 0) expect(Q.to[k]).toBeGreaterThanOrEqual(y)
  }
  // Events consistent with the tables.
  for (const e of h.events) {
    if (e.type === EventType.Epidemic) {
      const x = h.epidemics[e.extra ?? -1]
      expect(x).toBeDefined()
      expect([x.origin, x.source, x.startYear]).toEqual([e.settlement, e.other, e.year])
      expect(h.diseases[x.disease].kind).toBe(DiseaseKind.Crowd)
      continue
    }
    if (e.type < 66 || e.type > 79) continue
    expect(e.settlement >= 0 && e.settlement < S).toBe(true)
    switch (e.type) {
      case EventType.DiseaseAppeared: expect(h.diseases[e.value].firstYear).toBe(e.year); break
      case EventType.GreatEpidemic: { const x = h.epidemics[e.value]; expect(x.great).toBe(true); expect(x.origin).toBe(e.settlement); expect(x.disease).toBe(e.extra); expect(e.year).toBeGreaterThanOrEqual(x.startYear); break }
      case EventType.EpidemicEnded: { const x = h.epidemics[e.value]; expect(x.great).toBe(true); expect(x.endYear).toBe(e.year); expect(e.extra).toBeCloseTo(x.deaths / x.network, 6); break }
      case EventType.CityStricken: {
        let ok = false
        for (let i = 0; i < O.count && !ok; i++) if (O.year[i] === e.year && O.settlement[i] === e.settlement && O.epidemic[i] === e.value) ok = true
        expect(ok).toBe(true)
        const q = Math.floor(e.year / h.snapshotInterval)
        expect(h.population[q * S + e.settlement]).toBeGreaterThan(0.5 * CITY_POPULATION)
        break
      }
      case EventType.Quarantine: expect(Q.settlement.includes(e.settlement)).toBe(true); break
      case EventType.Endemic: expect(h.diseases[e.value].kind).toBe(DiseaseKind.Crowd); break
      case EventType.ArmyStricken: { const W = h.wars; expect(e.value >= 0 && e.value < W.count).toBe(true); expect(W.startYear[e.value]).toBeLessThanOrEqual(e.year); expect(e.extra ?? 0).toBeGreaterThanOrEqual(DZ.armyLog); break }
      default: throw new Error(`unknown disease event ${e.type}`)
    }
  }
}

describe('disease', () => {
  it('switched off, the history is the one from before the disease system, with the disease fields empty', () => {
    for (const [seed, years, n, pol, goods, hash] of GOLDEN) {
      const w = n ? generateWorld(seed, { subdivisions: n }) : world(seed)
      const h = simulateHistory(w, { years, polities: pol, goods, disease: false, tourism: false, renaming: false, ideas: false, landmarks: false }) // (ideas, landmarks: later, off here too)
      expect(hashPre(h)).toBe(hash)
      expect(h.diseases.length + h.epidemics.length + h.outbreaks.count + h.quarantines.count + h.fever.length + h.feverTolerance.length + h.endemic.length).toBe(0)
      expect(h.events.some((e) => e.type >= 66 && e.type <= 79)).toBe(false)
    }
  }, 240_000)

  it('is deterministic: the same world gives the same diseases, epidemics and outbreaks', () => {
    const a = history(42)
    const b = simulateHistory(generateWorld(42))
    expect(hashDisease(b)).toBe(hashDisease(a))
    expect(hashPre(b)).toBe(hashPre(a))
    expect(hashDisease(history(1))).not.toBe(hashDisease(a))
  }, 300_000)

  it('a longer run repeats a shorter one exactly; a resumed run equals runs from scratch, owning its arrays', () => {
    const w = world(9)
    const short = simulateHistory(w, { years: 1300 })
    const long = simulateHistory(w, { years: 1800 })
    // Diseases that appeared by the end of the shorter run: the same names, origins and years.
    expect(long.diseases.length).toBe(short.diseases.length)
    for (const d of short.diseases) {
      const e = long.diseases[d.id]
      expect([e.kind, e.archetype, e.mortality, e.crowd, e.criticalSize]).toEqual([d.kind, d.archetype, d.mortality, d.crowd, d.criticalSize])
      if (d.firstYear >= 0) expect([e.name, e.firstYear, e.firstSettlement, e.originPeople, e.originCell]).toEqual([d.name, d.firstYear, d.firstSettlement, d.originPeople, d.originCell])
    }
    // Outbreak rows: a prefix.
    const A = short.outbreaks, B = long.outbreaks
    expect(B.count).toBeGreaterThanOrEqual(A.count)
    for (let i = 0; i < A.count; i++) {
      if (A.disease[i] !== B.disease[i] || A.settlement[i] !== B.settlement[i] || A.year[i] !== B.year[i] || A.mortality[i] !== B.mortality[i] || A.source[i] !== B.source[i] || A.via[i] !== B.via[i] || A.epidemic[i] !== B.epidemic[i]) throw new Error(`outbreak row ${i} differs`)
    }
    for (const e of short.epidemics) {
      const f = long.epidemics[e.id]
      expect([f.disease, f.startYear, f.origin, f.source]).toEqual([e.disease, e.startYear, e.origin, e.source])
      expect(f.peoples.slice(0, e.peoples.length)).toEqual(e.peoples)
      if (e.endYear >= 0) expect([f.endYear, f.deaths, f.network, f.outbreaks, f.great]).toEqual([e.endYear, e.deaths, e.network, e.outbreaks, e.great])
    }
    expect(Array.from(long.fever)).toEqual(Array.from(short.fever))
    for (let i = 0; i < short.feverTolerance.length; i++) if (short.feverTolerance[i] !== long.feverTolerance[i] || short.endemic[i] !== long.endemic[i]) throw new Error(`snapshot ${i} differs`)
    for (let k = 0; k < short.quarantines.count; k++) expect([long.quarantines.settlement[k], long.quarantines.from[k]]).toEqual([short.quarantines.settlement[k], short.quarantines.from[k]])
    // Resumable.
    const run = createHistoryRun(w)
    const a = run.advanceTo(1300)
    expect(hashDisease(a)).toBe(hashDisease(short))
    const b = run.advanceTo(1800)
    expect(hashDisease(b)).toBe(hashDisease(long))
    expect(hashPre(b)).toBe(hashPre(long))
    expect(hashDisease(a)).toBe(hashDisease(short)) // (untouched by the extension)
    const bufs = (h: History) => [h.outbreaks.settlement, h.outbreaks.year, h.fever, h.feverTolerance, h.endemic, h.quarantines.settlement].map((x) => x.buffer)
    const seen = new Set(bufs(a))
    for (const x of bufs(b)) expect(seen.has(x)).toBe(false)
    expect(a.diseases[0]).not.toBe(b.diseases[0])
  }, 180_000)

  it('every history satisfies the disease invariants', () => {
    for (const seed of [1, 42, 9]) checkDisease(world(seed), history(seed))
    const w = generateWorld(9, { subdivisions: 24 })
    checkDisease(w, simulateHistory(w, { years: 1500 }))
  }, 240_000)

  it('dynamics: a few great epidemics, contact epidemics, endemic sickness, the fever belt, armies, quarantine', () => {
    const seeds = [1, 2, 3, 42, 1337, 2024]
    let great = 0, worldsWithGreat = 0, contact = 0, withContact = 0, endemic = 0, stricken = 0, withQuarantine = 0, worst = 0
    for (const seed of seeds) {
      const h = history(seed)
      const g = h.epidemics.filter((e) => e.great)
      great += g.length
      if (g.length > 0) worldsWithGreat++
      for (const e of g) worst = Math.max(worst, e.deaths / e.network)
      const c = h.events.filter((e) => e.type === EventType.Epidemic)
      contact += c.length
      if (c.length > 0) withContact++
      endemic += h.events.filter((e) => e.type === EventType.Endemic).length
      stricken += h.events.filter((e) => e.type === EventType.ArmyStricken).length
      if (h.quarantines.count > 0) withQuarantine++
      // No people dies out (a world must not die).
      const S = h.settlements.length, q = h.snapshotCount - 1, P = h.peoples.length
      const alive = new Uint8Array(P)
      for (let i = 0; i < S; i++) if (h.population[q * S + i] > 0) alive[h.settlements[i].people] = 1
      expect(alive.every((x) => x === 1)).toBe(true)
      // The appeared diseases: crowd diseases from herds and towns, plague from its reservoir (named), fever where it is hot and wet.
      expect(h.diseases.filter((d) => d.firstYear >= 0).length).toBeGreaterThanOrEqual(3)
      expect(c.length).toBeLessThanOrEqual(12)
    }
    const n = seeds.length
    expect(great / n).toBeGreaterThanOrEqual(2)
    expect(great / n).toBeLessThanOrEqual(12)
    expect(worldsWithGreat).toBeGreaterThanOrEqual(n - 1)
    expect(worst).toBeGreaterThan(0.08)
    expect(worst).toBeLessThan(0.4)
    expect(withContact).toBeGreaterThanOrEqual(n / 2)
    expect(endemic / n).toBeGreaterThan(3)
    expect(stricken / n).toBeGreaterThan(5)
    expect(withQuarantine).toBeGreaterThanOrEqual(2)
    // Against the same worlds without the system: the fever belt thinner, the world not much smaller (ideas off in both: the disease
    // system's own effect, not the different paths ideas would take in the two worlds).
    // (the fever belt summed over four worlds: on and off are two histories that part ways early, and one world's fever ground
    // can come out either way by chance — seeds 42 and 1 alone both did after the re-paths round danger — while over twelve
    // worlds it is thinner with the system in ten, before and after)
    let feverOn = 0, feverOff = 0
    for (const seed of [42, 1, 2, 3]) {
      const on = simulateHistory(world(seed), { ideas: false }), off = simulateHistory(world(seed), { disease: false, ideas: false })
      const fev = on.fever
      const at = (h: History, ground: boolean) => {
        const S = h.settlements.length, q = Math.floor(1500 / h.snapshotInterval)
        let t = 0
        for (let i = 0; i < S; i++) if ((fev[h.settlements[i].cell] >= FEVER.ground * 255) === ground) t += h.population[q * S + i]
        return t
      }
      feverOn += at(on, true); feverOff += at(off, true)
      expect(at(on, false) + at(on, true)).toBeGreaterThan(0.7 * (at(off, false) + at(off, true)))
    }
    expect(feverOn).toBeLessThan(0.9 * feverOff)
  }, 300_000)

  it('epidemics do not pile up in a long run', () => {
    const h = runHistory(world(3), { years: 5000 }).history
    const great = (a: number, b: number) => h.epidemics.filter((e) => e.great && e.startYear >= a && e.startYear < b).length
    // (great epidemics per millennium after trade has grown: no runaway)
    const late = [great(2000, 3000), great(3000, 4000), great(4000, 5001)]
    for (const x of late) expect(x).toBeLessThanOrEqual(15)
    expect(great(4000, 5001)).toBeLessThanOrEqual(great(2000, 3000) + 8)
    const S = h.settlements.length, last = h.snapshotCount - 1
    let total = 0
    for (let id = 0; id < S; id++) total += h.population[last * S + id]
    expect(Number.isFinite(total) && total > 0).toBe(true)
    expect(h.outbreaks.count).toBeLessThan(20000)
  }, 180_000)
})
