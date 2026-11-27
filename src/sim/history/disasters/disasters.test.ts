// disasters: tests of the natural shocks and climate regimes (disasters-climate.md §4): the off switch, the world-only shock
// schedule, the prefix property, the invariants of the table and the events, and the arithmetic-only rule.

import { describe, expect, it } from 'vitest'
import { DisasterKind, EventType, OrderKind, TOWN_POPULATION } from '../../../contract.ts'
import type { History, World } from '../../../contract.ts'
import { hashBase } from '../../../hashBase.ts'
import { hashValue } from '../../../historyCache.ts'
import { generateWorld, simulateHistory } from '../../index.ts'
import { logStreams } from '../../rng.ts'
import { buildTerrain } from '../terrain.ts'
import { createWeather } from '../weather.ts'
import { createRng } from '../../rng.ts'
import { DX } from './params.ts'
import { createDisasters } from './state.ts'

const worlds = new Map<number, World>()
const world = (seed: number, n?: number): World => {
  const k = seed * 100 + (n ?? 0)
  let w = worlds.get(k)
  if (!w) { w = generateWorld(seed, n ? { subdivisions: n } : undefined); worlds.set(k, w) }
  return w
}

/** The parts of the table and series that come from the world alone (who was struck aside). */
function worldOnly(h: History): unknown {
  const d = h.disasters
  const rows: number[][] = []
  for (let i = 0; i < d.count; i++) {
    const k = d.kind[i]
    if (k === DisasterKind.Eruption) rows.push([k, d.year[i], d.cell[i], d.size[i], d.dT[i], d.volcano[i]])
    if (k === DisasterKind.Drought) rows.push([k, d.year[i], d.endYear[i], d.region[i], d.size[i]])
    if (k === DisasterKind.ColdEpoch || k === DisasterKind.WarmEpoch) rows.push([k, d.year[i], d.endYear[i], d.dT[i]])
  }
  return { rows, temp: Array.from(h.climate.temp), volcanic: Array.from(h.climate.volcanic) }
}

function checkTable(w: World, h: History): void {
  const d = h.disasters
  const S = h.settlements.length
  expect(h.climate.temp.length).toBe(h.years + 1)
  expect(h.weatherRegion.length).toBe(w.grid.cellCount)
  let lastYear = 0
  for (let i = 0; i < d.count; i++) {
    // rows in order of recording: sudden shocks and epochs by year (a drought's row is back-dated to its first dry year)
    if (d.kind[i] !== DisasterKind.Drought) { expect(d.year[i]).toBeGreaterThanOrEqual(lastYear); lastYear = d.year[i] }
    expect(d.year[i]).toBeLessThanOrEqual(h.years)
    expect(d.settlement[i]).toBeLessThan(S)
    expect(d.deaths[i]).toBeGreaterThanOrEqual(0)
    switch (d.kind[i]) {
      case DisasterKind.Eruption:
        expect(d.size[i]).toBeGreaterThanOrEqual(5)
        expect(d.size[i]).toBeLessThanOrEqual(7)
        if (d.year[i] < DX.graceYear) expect(d.size[i]).toBeLessThanOrEqual(6)
        expect(d.dT[i]).toBeLessThanOrEqual(0)
        expect(d.volcano[i]).toBeGreaterThanOrEqual(0)
        break
      case DisasterKind.Earthquake:
        expect(d.size[i]).toBeGreaterThanOrEqual(7)
        expect(d.size[i]).toBeLessThanOrEqual(DX.mmaxConv + 1e-6)
        if (d.year[i] < DX.graceYear) expect(d.size[i]).toBeLessThan(8.5)
        break
      case DisasterKind.Tsunami:
        expect(d.cause[i]).toBeGreaterThanOrEqual(0)
        expect(d.kind[d.cause[i]]).toBe(DisasterKind.Earthquake)
        expect(d.year[d.cause[i]]).toBe(d.year[i])
        expect(d.struck[i]).toBeGreaterThan(0)
        break
      case DisasterKind.Drought:
        expect(d.region[i]).toBeGreaterThanOrEqual(0)
        if (d.endYear[i] >= 0) expect(d.size[i]).toBe(d.endYear[i] - d.year[i] + 1)
        break
    }
  }
  for (const x of h.climate.volcanic) expect(x).toBeGreaterThanOrEqual(-DX.maxVolcanicDT - 1e-6)
  for (const e of h.events) {
    if (e.type < 260 || e.type > 269) continue
    expect(e.value).toBeGreaterThanOrEqual(0)
    expect(e.value).toBeLessThan(d.count)
    const st = h.settlements[e.settlement]
    expect(st.foundedYear).toBeLessThanOrEqual(e.year)
    if (st.abandonedYear >= 0) expect(st.abandonedYear).toBeGreaterThanOrEqual(e.year)
    const k = d.kind[e.value]
    switch (e.type) {
      case EventType.Eruption: expect(k).toBe(DisasterKind.Eruption); expect(e.extra).toBe(d.size[e.value]); break
      case EventType.VolcanicWinter: expect(k).toBe(DisasterKind.Eruption); expect(e.extra!).toBeLessThanOrEqual(DX.winterAt); expect(e.year).toBe(d.year[e.value] + 1); break
      case EventType.Earthquake: expect(k).toBe(DisasterKind.Earthquake); expect(d.settlement[e.value]).toBe(e.settlement); break
      case EventType.Tsunami: expect(k).toBe(DisasterKind.Tsunami); break
      case EventType.CityDestroyed: expect(e.extra!).toBeGreaterThanOrEqual(DX.destroyedShare); break
      case EventType.Flood: expect(k).toBe(DisasterKind.Flood); break
      case EventType.DroughtBegan: case EventType.DroughtEnded: expect(k).toBe(DisasterKind.Drought); break
      case EventType.ClimateTurned: expect(k === DisasterKind.ColdEpoch || k === DisasterKind.WarmEpoch).toBe(true); expect(Math.abs(e.extra!)).toBe(1); break
      default: throw new Error(`unexpected event ${e.type}`)
    }
  }
}

describe('disasters', () => {
  it('off by default: the history equals the one with disasters false, its fields empty, and no disaster stream is created', () => {
    const w = world(3)
    const log: string[] = []
    logStreams(log)
    let a: History
    try { a = simulateHistory(w, { years: 300 }) } finally { logStreams(null) }
    expect(log.some((x) => /volcano|shocks|climate|disaster/.test(x))).toBe(false)
    const b = simulateHistory(w, { years: 300, disasters: false })
    expect(hashValue(a)).toBe(hashValue(b))
    expect(a.disasters.count).toBe(0)
    expect(a.climate.temp.length).toBe(0)
    expect(a.weatherRegion.length).toBe(0)
    expect(a.events.some((e) => e.type >= 260 && e.type <= 269)).toBe(false)
  }, 900_000)

  it('on: adds exactly its own streams (volcanoes, climate, damage once; a shock stream per century; volcano names)', () => {
    const w = world(3)
    const log: string[] = []
    logStreams(log)
    try { simulateHistory(w, { years: 350, disasters: true }) } finally { logStreams(null) }
    const off: string[] = []
    logStreams(off)
    try { simulateHistory(w, { years: 350 }) } finally { logStreams(null) }
    const extra = log.slice()
    for (const x of off) { const i = extra.indexOf(x); if (i >= 0) extra.splice(i, 1) }
    const fixed = extra.filter((x) => !x.startsWith('names-') && !x.startsWith('landmarks-faith-')).sort() // (a different history names other things)
    expect(fixed).toEqual(['history-climate', 'history-disaster-damage', 'history-shocks-0', 'history-shocks-1', 'history-shocks-2', 'history-shocks-3', 'history-volcanoes'])
  }, 900_000)

  it('the catalogue: 20-60 volcanoes and 1000-3000 quake sources on the four seeds; tsunamis need convergent sources', () => {
    for (const seed of [1, 7, 42, 1234]) {
      const w = world(seed)
      const t = buildTerrain(w)
      const we = createWeather(w, createRng(seed, 'history-weather'))
      const dx = createDisasters(w, t, we.region, we.regionCount)
      expect(dx.vCell.length).toBeGreaterThanOrEqual(20)
      expect(dx.vCell.length).toBeLessThanOrEqual(DX.maxVolcanoes)
      expect(dx.qCell.length).toBeGreaterThanOrEqual(1000)
      expect(dx.qCell.length).toBeLessThanOrEqual(3000)
      expect(dx.vCum[dx.vCum.length - 1]).toBeCloseTo(1, 9)
      expect(dx.rate7).toBeGreaterThan(3)
      expect(dx.rate7).toBeLessThan(DX.quakeSlots)
    }
  }, 900_000)

  it('on: the table and events keep their invariants; the shocks change the history', () => {
    const w = world(42)
    const h = simulateHistory(w, { years: 900, disasters: true })
    checkTable(w, h)
    expect(h.disasters.count).toBeGreaterThan(0)
    expect(hashBase(h)).not.toBe(hashBase(simulateHistory(w, { years: 900 })))
    // a town destroyed is a town
    for (const e of h.events) if (e.type === EventType.CityDestroyed) expect(h.settlements[e.settlement]).toBeDefined()
    expect(TOWN_POPULATION).toBeGreaterThan(0)
  }, 900_000)

  it('the shock schedule and the climate come from the world alone: orders, cradle wishes and other systems cannot move them', () => {
    const w = world(9, 24)
    const base = simulateHistory(w, { years: 500, disasters: true })
    const ref = worldOnly(base)
    const others = [
      simulateHistory(w, { years: 500, disasters: true, polities: false, goods: false, disease: false }),
      simulateHistory(w, { years: 500, disasters: true, cradles: [base.settlements[5].cell] }),
      simulateHistory(w, { years: 500, disasters: true, orders: [{ year: 100, kind: OrderKind.Explore, actor: 0, target: 0 }] }),
    ]
    for (const h of others) expect(worldOnly(h)).toEqual(ref)
  }, 900_000)

  it('prefix: a shorter run is the start of a longer one (rows, events and series), and resuming changes nothing', () => {
    const w = world(9, 24)
    const a = simulateHistory(w, { years: 400, disasters: true })
    const b = simulateHistory(w, { years: 650, disasters: true })
    const da = a.disasters, db = b.disasters
    expect(db.count).toBeGreaterThanOrEqual(da.count)
    for (let i = 0; i < da.count; i++) {
      const open = da.endYear[i] < 0
      expect([db.kind[i], db.year[i], db.cell[i], db.region[i], db.settlement[i], db.deaths[i], db.struck[i], db.cause[i], db.volcano[i], db.name[i]]).toEqual(
        [da.kind[i], da.year[i], da.cell[i], da.region[i], da.settlement[i], da.deaths[i], da.struck[i], da.cause[i], da.volcano[i], da.name[i]])
      if (!open) expect([db.endYear[i], db.size[i], db.dT[i]]).toEqual([da.endYear[i], da.size[i], da.dT[i]])
    }
    expect(Array.from(b.climate.temp.subarray(0, 401))).toEqual(Array.from(a.climate.temp))
    expect(Array.from(b.climate.harvest.subarray(0, 401))).toEqual(Array.from(a.climate.harvest))
    expect(b.events.filter((e) => e.year <= 400)).toEqual(a.events)
  }, 900_000)

  it('uses only + - * / sqrt floor at run time (no Math.log, exp or pow under disasters/)', () => {
    const sources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    let n = 0
    for (const [f, src] of Object.entries(sources)) {
      if (f.endsWith('.test.ts') || f.endsWith('disasterStats.ts')) continue
      n++
      expect(/Math\.(log|exp|pow)\b/.test(src), f).toBe(false)
    }
    expect(n).toBeGreaterThanOrEqual(6)
  })
})
