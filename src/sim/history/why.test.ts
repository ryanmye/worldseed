// causes (causal-explorer.md §10): the recorders change nothing but History.why (D1), and what they record is what the sim
// used: rivalry parts sum to the rivalry, the decoded drive is the roll's, the trigger group is causeOf's, the weather row is
// the harvest, and every Famine, Abandoned, SuccessionCrisis and absorbed PolityEnded has its row.
import { describe, expect, it } from 'vitest'
import { EventType, PolityEnd, RIVALRY_PARTS, decodeLog2 } from '../../contract.ts'
import type { History } from '../../contract.ts'
import { hashValue } from '../../historyCache.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../index.ts'
import { runHistory } from './index.ts'
import { smoothstep } from '../util.ts'
import { WAR } from './polity/params.ts'
import type { WhyRec } from './why.ts'

const YEARS = 800

function withoutWhy(h: History): string {
  const { why: _w, ...rest } = h
  return hashValue(rest)
}

describe('causes: recording only (D1)', () => {
  for (const seed of [42, 1234]) {
    it(`seed ${seed}, ${YEARS} y: every field but why is the same with causes on and off`, () => {
      const w = generateWorld(seed)
      const off = simulateHistory(w, { years: YEARS })
      const on = simulateHistory(w, { years: YEARS, causes: true })
      expect(off.why?.wars.rivalry.length).toBe(0)
      expect(on.why!.wars.rivalry.length).toBe(on.wars.count)
      expect(withoutWhy(on)).toBe(withoutWhy(off))
    }, 900_000)
  }
})

describe('causes: invariants (seed 42, 1500 y)', () => {
  let maxRel = 0, relChecks = 0, weatherBad = 0
  let rec: WhyRec | null = null
  const run = runHistory(generateWorld(42), { years: 1500, causes: true }, (s) => {
    const ps = s.pol, w = s.why
    if (!ps || !w) return
    rec = w
    for (let r = 0; r < ps.relA.length; r++) {
      if ((r + 1) * RIVALRY_PARTS > w.rel.length) { if (ps.relR[r] !== 0) maxRel = Math.max(maxRel, ps.relR[r]); continue }
      let sum = 0
      for (let k = 0; k < RIVALRY_PARTS; k++) sum += w.rel[r * RIVALRY_PARTS + k]
      const d = Math.abs(sum - ps.relR[r])
      if (d > maxRel) maxRel = d
      relChecks++
    }
    const R = w.regions
    for (let r = 0; r < R; r++) {
      const b = w.wh[s.year * R + r]
      if (Math.abs((b / 255) * 1.4 - s.harvest[r]) > 1.4 / 255) weatherBad++
    }
  })
  const h = run.history
  const W = h.why!

  it('rivalry parts sum to the rivalry at every year end', () => {
    expect(relChecks).toBeGreaterThan(1000)
    expect(maxRel).toBeLessThan(1e-9)
  })

  it('the weather row is the harvest the sim used', () => {
    expect(weatherBad).toBe(0)
    expect(W.weather.harvest.length).toBe((1500 + 1) * W.weather.regions)
    expect(W.weather.region.length).toBe(h.capacity.length)
  })

  it('the decoded drive is the drive the roll used (coding error only)', () => {
    const w = rec!
    let n = 0
    for (let k = 0; k < h.wars.count; k++) {
      if (W.wars.odds[k] === 0) continue
      const rv = smoothstep(WAR.rLow, WAR.rHigh, (W.wars.rivalry[k] / 255) * 2)
      const adv = smoothstep(WAR.advLow, WAR.advHigh, decodeLog2(W.wars.odds[k]))
      const crisis = W.wars.flags[k] & 1 ? WAR.crisisMul : 1
      const drive = rv * adv * crisis * (1 - W.wars.exhaustion[k] / 255) * decodeLog2(W.wars.mul[k])
      const exact = w.wDrive[k]
      expect(exact).toBeGreaterThan(0)
      expect(Math.abs(drive - exact)).toBeLessThan(0.08 * exact + 0.01)
      n++
    }
    expect(n).toBeGreaterThan(10)
  })

  it('war rows: one per war; parts are shares of the rivalry', () => {
    expect(W.wars.parts.length).toBe(h.wars.count * RIVALRY_PARTS)
    for (let k = 0; k < h.wars.count; k++) {
      if (W.wars.rivalry[k] < 20) continue
      let sum = 0, clamped = false
      for (let j = 0; j < RIVALRY_PARTS; j++) { const x = W.wars.parts[k * RIVALRY_PARTS + j]; sum += x; if (x === 127 || x === -127) clamped = true }
      if (clamped) continue // (a share beyond ±1 is clipped)
      expect(Math.abs(sum - 127)).toBeLessThan(RIVALRY_PARTS + 2) // (rounding per part)
    }
  })

  it('every Revolt has its row; the trigger group is the event cause', () => {
    const w = rec!
    const revolts = h.events.map((e, i) => (e.type === EventType.Revolt ? i : -1)).filter((i) => i >= 0)
    expect(W.revolts.count).toBe(revolts.length)
    expect(Array.from(W.revolts.event)).toEqual(revolts)
    for (let k = 0; k < W.revolts.count; k++) {
      expect(w.rInstant[k]).toBe(h.events[W.revolts.event[k]].value)
      let share = 0
      for (let j = 0; j < 4; j++) share += W.revolts.share[k * 4 + j]
      expect(share).toBeLessThanOrEqual(255 + 4)
      expect(W.revolts.part[k * 4]).not.toBe(255)
    }
  })

  it('every Famine, Abandoned and SuccessionCrisis has its row, aligned; absorbed ends too', () => {
    const idx = (t: number) => h.events.map((e, i) => (e.type === t ? i : -1)).filter((i) => i >= 0)
    expect(Array.from(W.famines.event)).toEqual(idx(EventType.Famine))
    expect(Array.from(W.abandons.event)).toEqual(idx(EventType.Abandoned))
    expect(Array.from(W.crises.event)).toEqual(idx(EventType.SuccessionCrisis))
    const absorbed = h.polities.filter((p) => p.endCause === PolityEnd.Absorbed).length
    expect(W.absorbed.count).toBe(absorbed)
    for (let k = 0; k < W.absorbed.count; k++) expect(h.events[W.absorbed.event[k]].type).toBe(EventType.PolityEnded)
    expect(W.famines.count).toBeGreaterThan(0)
  })
})

describe('causes: extension', () => {
  it('a longer run begins with the shorter run\'s rows', () => {
    const w = generateWorld(7)
    const run = createHistoryRun(w, { causes: true })
    const a = run.advanceTo(300).why!
    const b = run.advanceTo(450).why!
    const prefix = (x: ArrayLike<number>, y: ArrayLike<number>) => Array.from(y).slice(0, x.length).join() === Array.from(x).join()
    expect(prefix(a.revolts.event, b.revolts.event)).toBe(true)
    expect(prefix(a.famines.event, b.famines.event)).toBe(true)
    expect(prefix(a.abandons.event, b.abandons.event)).toBe(true)
    expect(prefix(a.wars.rivalry, b.wars.rivalry)).toBe(true)
    expect(prefix(a.weather.harvest, b.weather.harvest)).toBe(true)
  }, 900_000)
})
