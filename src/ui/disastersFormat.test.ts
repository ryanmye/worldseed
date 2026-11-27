// disasters: the chronicle lines, names and climate marks of the natural shocks (disastersFormat.ts), on a hand-made history.
import { describe, expect, it } from 'vitest'
import { DisasterKind, EventType, type History, type HistoryEvent } from '../contract.ts'
import { climateMarks, describeDisasterEvent, describeDisasterEventFor, disasterTitle, isDisasterEvent } from './disastersFormat.ts'
import { describeEvent, eventKind } from './format.ts'
import { entryCategory } from './chronicleFilter.ts'
import { EntryKind } from './historyIndex.ts'

function fake(): History {
  const rows = [
    // kind, year, end, cell, region, size, dT, settlement, deaths, struck, cause, volcano, name
    [DisasterKind.Eruption, 1257, 1257, 10, -1, 7, -1.8, 0, 120, 1, -1, 3, 'Mount Ushtaan'],
    [DisasterKind.Earthquake, 1402, 1402, 11, -1, 7.8, 0, 1, 700, 1, -1, -1, ''],
    [DisasterKind.Tsunami, 1402, 1402, 11, -1, 600, 0, 2, 300, 7, 1, -1, ''],
    [DisasterKind.ColdEpoch, 1300, 1450, -1, -1, 151, -0.5, 0, 0, 0, -1, -1, ''],
    [DisasterKind.Drought, 1500, 1522, -1, 4, 23, 0, 0, 0, 0, -1, -1, ''],
    [DisasterKind.Eruption, 1600, 1600, 10, -1, 7, -1.2, 0, 10, 1, -1, 3, 'Mount Ushtaan'],
  ] as const
  const col = (k: number) => rows.map((r) => r[k] as number)
  const d = {
    count: rows.length, kind: Uint8Array.from(col(0)), year: Int16Array.from(col(1)), endYear: Int16Array.from(col(2)), cell: Int32Array.from(col(3)),
    region: Int16Array.from(col(4)), size: Float32Array.from(col(5)), dT: Float32Array.from(col(6)), settlement: Int32Array.from(col(7)),
    deaths: Float32Array.from(col(8)), struck: Int32Array.from(col(9)), cause: Int32Array.from(col(10)), volcano: Int32Array.from(col(11)), name: rows.map((r) => r[12] as string),
  }
  return {
    years: 2000, snapshotInterval: 5, snapshotCount: 401,
    settlements: [{ id: 0, name: 'Varn', people: 0 }, { id: 1, name: 'Tessa', people: 0 }, { id: 2, name: 'Lisk', people: 0 }],
    peoples: [{ id: 0, name: 'Ushtaani' }], population: new Float32Array(401 * 3).fill(4000), events: [], disasters: d,
  } as unknown as History
}
const ev = (type: number, settlement: number, value: number, extra: number, year = 1402): HistoryEvent => ({ year, type: type as HistoryEvent['type'], settlement, other: -1, value, extra })

describe('disastersFormat', () => {
  const h = fake()
  it('describes each event in the chronicle and the inspector', () => {
    expect(describeDisasterEvent(h, ev(EventType.Eruption, 0, 0, 7, 1257))).toBe('Mount Ushtaan erupted near Varn (VEI 7): the Year Without Summer')
    expect(describeDisasterEvent(h, ev(EventType.VolcanicWinter, 0, 0, -1.8, 1258))).toBe('A volcanic winter: harvests failed round Varn (−1.8 °C summers)')
    expect(describeDisasterEvent(h, ev(EventType.Earthquake, 1, 1, 7.8))).toMatch(/^Earthquake \(M 7\.8\) at Tessa: \d+% of its people killed$/)
    expect(describeDisasterEvent(h, ev(EventType.Tsunami, 2, 2, 7))).toBe('A great wave struck Lisk and 6 other ports')
    expect(describeDisasterEvent(h, ev(EventType.CityDestroyed, 1, 1, 0.31))).toBe('Tessa destroyed (−31%)')
    expect(describeDisasterEvent(h, ev(EventType.Flood, 0, 0, 0.04))).toBe('The river flooded at Varn (−4%)')
    expect(describeDisasterEvent(h, ev(EventType.DroughtBegan, 0, 4, 4))).toBe('Drought settled on the land of Varn')
    expect(describeDisasterEvent(h, ev(EventType.DroughtEnded, 0, 4, 23))).toBe('The drought round Varn broke after 23 years (the Great Drought of the Ushtaani)')
    expect(describeDisasterEvent(h, ev(EventType.ClimateTurned, 0, 3, -1))).toBe('The world turned colder')
    expect(describeDisasterEvent(h, ev(EventType.ClimateTurned, 0, 3, 1))).toBe('A warm age began')
    expect(describeDisasterEventFor(h, ev(EventType.CityDestroyed, 1, 1, 0.31), 1)).toBe('Destroyed: lost 31% of its people at once')
    expect(describeDisasterEvent(h, ev(EventType.Famine, 0, 0, 0))).toBeNull()
    // through the chronicle's own entry points
    expect(describeEvent(h, ev(EventType.Flood, 0, 0, 0.04))).toBe('The river flooded at Varn (−4%)')
    expect(eventKind(ev(EventType.Tsunami, 2, 2, 7))).toBe('disaster')
    expect(entryCategory(h, EntryKind.Single, ev(EventType.Earthquake, 1, 1, 7.8))).toBe(4) // Nature and crops
  })
  it('names: the first great eruption is the Year Without Summer, later ones Ash Winters; epochs and megadroughts', () => {
    expect(disasterTitle(h, 0)).toBe('the Year Without Summer')
    expect(disasterTitle(h, 5)).toBe('the Ash Winter of 1600')
    expect(disasterTitle(h, 1)).toBeNull()
    expect(disasterTitle(h, 3)).toBe('the Long Winter')
    expect(disasterTitle(h, 4)).toBe('the Great Drought of the Ushtaani')
    expect(isDisasterEvent(EventType.Eruption) && isDisasterEvent(EventType.ClimateTurned) && !isDisasterEvent(269)).toBe(true)
  })
  it('climate marks: epochs as spans, VEI 6-7 eruptions as ticks; empty without the table', () => {
    const m = climateMarks(h)
    expect(m.map((x) => [x.from, x.to])).toEqual([[1257, 1258], [1300, 1450], [1600, 1601]])
    expect(climateMarks({ years: 10 } as unknown as History)).toEqual([])
  })
})
