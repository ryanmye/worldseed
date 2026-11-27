// The story plan (experience-whatif-director-sagas §2.8): deterministic, beats at least G_MIN apart and scoring at
// least θ, the prominence filter monotone in speed, a longer run of the same world leaving the older beats alone, and a
// golden plan for a fixed seed and length (re-record GOLDEN only for an intended change of the sim or the weights, and
// say so in the commit).

import { describe, expect, it } from 'vitest'
import type { History } from '../../contract.ts'
import { generateWorld, simulateHistory } from '../../sim/index.ts'
import { buildHistoryIndex, type HistoryIndex } from '../historyIndex.ts'
import { buildStaticDrama, type StaticDrama } from './drama.ts'
import { beatKept, buildStoryPlan, keptCount, nextBeat, STORY, type StoryPlan } from './plan.ts'

const SEED = 7
const YEARS = 1200
const SHORT = 1000

let cache: { h: History; ix: HistoryIndex; sd: StaticDrama; plan: StoryPlan } | null = null
function seeded() {
  if (!cache) {
    const h = simulateHistory(generateWorld(SEED), { years: YEARS })
    const ix = buildHistoryIndex(h)
    const sd = buildStaticDrama(ix)
    cache = { h, ix, sd, plan: buildStoryPlan(sd, ix.notableYear) }
  }
  return cache
}

/** Seed 7 at 1200 years, default options: the beats as `year:entry`. */
const GOLDEN = ['31:18', '174:32', '396:92', '500:138', '590:193', '645:260', '700:304', '751:332', '778:356', '825:402', '911:524', '970:637', '1028:729', '1070:797', '1140:911', '1190:1044'] // (re-recorded, surfacing lane: the freshness term and the floor)

describe('story plan', () => {
  it('is deterministic', { timeout: 300_000 }, () => {
    const { ix, sd, plan } = seeded()
    const again = buildStoryPlan(buildStaticDrama(ix), ix.notableYear)
    expect(Array.from(again.beatEntry)).toEqual(Array.from(plan.beatEntry))
    expect(Array.from(again.beatProminence)).toEqual(Array.from(plan.beatProminence))
    expect(Array.from(again.noteEntry)).toEqual(Array.from(plan.noteEntry))
    expect(Array.from(buildStoryPlan(sd, ix.notableYear).beatScore)).toEqual(Array.from(plan.beatScore))
  })

  it('golden plan for a fixed seed and length', { timeout: 300_000 }, () => {
    const { plan } = seeded()
    const got = Array.from(plan.beatEntry, (n, i) => `${plan.beatYear[i]}:${n}`)
    expect(got).toEqual(GOLDEN)
  })

  it('beats are more than G_MIN apart and score at least θ; notices at least θ_n and never beats', { timeout: 300_000 }, () => {
    const { plan } = seeded()
    expect(plan.beatEntry.length).toBeGreaterThan(5)
    for (let i = 1; i < plan.beatYear.length; i++) expect(plan.beatYear[i] - plan.beatYear[i - 1]).toBeGreaterThan(STORY.gMin)
    for (const s of plan.beatScore) expect(s).toBeGreaterThanOrEqual(STORY.theta)
    for (const s of plan.noteScore) expect(s).toBeGreaterThanOrEqual(STORY.thetaNote)
    const beats = new Set(plan.beatEntry)
    for (const n of plan.noteEntry) expect(beats.has(n)).toBe(false)
    for (let i = 1; i < plan.noteYear.length; i++) expect(plan.noteYear[i]).toBeGreaterThanOrEqual(plan.noteYear[i - 1])
  })

  it('the prominence filter is monotone in speed: 16× ⊆ 4× ⊆ 1×, and 1× keeps every beat', { timeout: 300_000 }, () => {
    const { plan } = seeded()
    const at = (k: number) => new Set(Array.from(plan.beatEntry.keys()).filter((b) => beatKept(plan, b, k)))
    const s1 = at(1), s4 = at(4), s16 = at(16)
    expect(s1.size).toBe(plan.beatEntry.length)
    expect(at(0.25).size).toBe(plan.beatEntry.length)
    for (const b of s4) expect(s1.has(b)).toBe(true)
    for (const b of s16) expect(s4.has(b)).toBe(true)
    expect(keptCount(plan, 16)).toBeGreaterThan(0) // the top beat has infinite prominence
    expect(keptCount(plan, 16)).toBeLessThanOrEqual(keptCount(plan, 4))
    // nextBeat finds the first kept beat at or after a year
    const b = nextBeat(plan, plan.beatYear[2], 1)
    expect(b).toBe(2)
    expect(nextBeat(plan, plan.beatYear[plan.beatYear.length - 1] + 1, 1)).toBe(-1)
  })

  it('focus raises the selected polity\'s stories', { timeout: 300_000 }, () => {
    const { ix, sd, plan } = seeded()
    // the polity of the plan's top beat, focused: its stories are at least as present
    let p = -1
    for (const n of plan.beatEntry) if (sd.polA[n] >= 0) { p = sd.polA[n]; break }
    expect(p).toBeGreaterThanOrEqual(0)
    const focused = buildStoryPlan(sd, ix.notableYear, { focus: new Set([p]) })
    const about = (pl: StoryPlan) => Array.from(pl.beatEntry).filter((n) => sd.polA[n] === p || sd.polB[n] === p).length
    expect(about(focused)).toBeGreaterThanOrEqual(about(plan))
  })

  it('a longer run of the same world leaves the older beats unchanged', { timeout: 300_000 }, () => {
    const { ix: long, sd: sdLong } = seeded()
    const hShort = simulateHistory(generateWorld(SEED), { years: SHORT })
    const ixShort = buildHistoryIndex(hShort)
    const pShort = buildStoryPlan(buildStaticDrama(ixShort), ixShort.notableYear)
    const pLong = buildStoryPlan(sdLong, long.notableYear)
    // (magnitudes look ahead at most PEAK_HORIZON years, and a window at the old end can choose differently)
    const cut = SHORT - 250
    const old = (p: StoryPlan) => Array.from(p.beatEntry).filter((_, i) => p.beatYear[i] < cut).map((n, i) => `${p.beatYear[i]}:${n}`)
    expect(old(pShort).length).toBeGreaterThan(3)
    expect(old(pLong)).toEqual(old(pShort))
  })
})
