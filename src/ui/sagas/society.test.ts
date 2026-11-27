// society sagas: both registers fill every phrase (society-secular-cycles.md §4.4).
import { describe, expect, it } from 'vitest'
import { SOC_T } from './society.ts'

describe('society sagas', () => {
  it('every phrase has a chronicle and a legend form with the same slots', () => {
    const slots = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1].toLowerCase()).filter((k, i, a) => a.indexOf(k) === i).sort()
    for (const [k, [chron, legend]] of Object.entries(SOC_T)) {
      expect(chron.length, k).toBeGreaterThan(0)
      expect(legend.length, k).toBeGreaterThan(0)
      for (const s of [...chron, ...legend]) expect(s.trim().length, k).toBeGreaterThan(0)
      // the legend may drop a number (heightened), but never asks for a slot the chronicle lacks
      const c = slots(chron[0])
      for (const sl of slots(legend[0])) if (!['times', 'n'].includes(sl)) expect(c, `${k}: ${sl}`).toContain(sl)
    }
  })
})
