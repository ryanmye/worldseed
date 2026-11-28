// lane N4d: follow one realm (realmFollow.ts): the realm's story is deterministic, its beats are the realm's own (or a few
// meanwhile notes), denser than the world's over the same years, with small events among them; the successor is a realm
// alive after the end; the address parses; the world's plan is unchanged by the tune option.

import { describe, expect, it } from 'vitest'
import type { History } from '../../contract.ts'
import { generateWorld, simulateHistory } from '../../sim/index.ts'
import { buildHistoryIndex, type HistoryIndex } from '../historyIndex.ts'
import { politiesOf } from '../politiesData.ts'
import { buildStaticDrama, type StaticDrama } from './drama.ts'
import { beatKept, buildStoryPlan, promUnitOf, STORY, type StoryPlan } from './plan.ts'
import { buildRealmStory, defaultRealm, EntryKindR, parseFollowRealm, REALM_AUTO, REALM_STORY, successorOf } from './realmFollow.ts'
import { playPlan } from './pacingStats.ts'
import { REALM_PACE } from './realmFollow.ts'
import { followByDefault } from '../onboardPolicy.ts'

let cache: { h: History; ix: HistoryIndex; sd: StaticDrama; plan: StoryPlan } | null = null
function seeded() {
  if (!cache) {
    const h = simulateHistory(generateWorld(7), { years: 1200 })
    const ix = buildHistoryIndex(h)
    const sd = buildStaticDrama(ix)
    cache = { h, ix, sd, plan: buildStoryPlan(sd, ix.notableYear) }
  }
  return cache
}

describe('follow a realm', () => {
  it('parses follow=realm:<id> and follows by default with it', () => {
    expect(parseFollowRealm('realm:3')).toBe(3)
    expect(parseFollowRealm('realm:auto')).toBe(REALM_AUTO)
    expect(parseFollowRealm('1')).toBe(null)
    expect(parseFollowRealm(null)).toBe(null)
    expect(followByDefault(new URLSearchParams('follow=realm:0'), false)).toBe(true)
  })
  it('tells the realm its own smaller story', { timeout: 600_000 }, () => {
    const { h, ix, sd, plan } = seeded()
    const pd = politiesOf(h)!
    const p = defaultRealm(pd, 0, h.years)
    expect(p).toBeGreaterThanOrEqual(0)
    const rs = buildRealmStory(ix, p, { drama: sd, plan })!
    const again = buildRealmStory(ix, p, { drama: sd, plan })!
    expect(Array.from(again.plan.beatEntry)).toEqual(Array.from(rs.plan.beatEntry))
    const x = pd.list[p]
    const end = Math.min(rs.endYear, h.years)
    // years ascending, beats in the realm's life, scoring at least θ, kept monotone in speed
    for (let n = 1; n < rs.years.length; n++) expect(rs.years[n]).toBeGreaterThanOrEqual(rs.years[n - 1])
    const B = rs.plan.beatEntry.length
    expect(B).toBeGreaterThan(5)
    let small = 0
    for (let b = 0; b < B; b++) {
      const n = rs.plan.beatEntry[b]
      expect(rs.plan.beatYear[b]).toBeGreaterThanOrEqual(x.foundedYear)
      expect(rs.plan.beatYear[b]).toBeLessThanOrEqual(end)
      if (rs.kind[n] === EntryKindR.Small) small++
      if (rs.kind[n] !== EntryKindR.Meanwhile) {
        expect(rs.drama.polA[n]).toBe(p)
        expect(rs.drama.rep[n]).toBeGreaterThanOrEqual(0)
      } else expect(rs.drama.cell[n]).toBe(-1)
      if (beatKept(rs.plan, b, 16)) expect(beatKept(rs.plan, b, 4)).toBe(true)
    }
    expect(rs.plan.promUnit).toBe(Math.min(REALM_STORY.gMin!, REALM_STORY.promPerSpeed!))
    expect(promUnitOf(plan)).toBe(Math.min(STORY.gMin, STORY.promPerSpeed))
    // denser than the world's story over the same years, with small events among the beats
    let world = 0
    for (const y of plan.beatYear) if (y >= x.foundedYear && y <= end) world++
    expect(B).toBeGreaterThan(world)
    expect(small).toBeGreaterThan(0)
    // the chronicle's filter: ascending world entries
    for (let i = 1; i < rs.chronicleEntries.length; i++) expect(rs.chronicleEntries[i]).toBeGreaterThan(rs.chronicleEntries[i - 1])
    // pacing: dead air at most 20 s over the realm's life at 1×
    const run = playPlan(rs.plan, end, true, REALM_PACE, x.foundedYear)
    expect(run.deadAirAll).toBeLessThanOrEqual(20)
    expect(run.firstCaption).not.toBeNull()
  })
  it('passes the story to a realm alive after the end', { timeout: 600_000 }, () => {
    const { h } = seeded()
    const pd = politiesOf(h)!
    let checked = 0
    for (let p = 0; p < pd.count && checked < 20; p++) {
      const s = successorOf(h, pd, p)
      if (pd.list[p].endedYear < 0) expect(s).toBe(null)
      if (!s) continue
      checked++
      expect(s.polity).not.toBe(p)
      expect(s.polity).toBeLessThan(pd.count)
      if (s.why !== 'heir') expect(pd.list[s.polity].foundedYear).toBeLessThanOrEqual(pd.list[p].endedYear + 12)
    }
    expect(checked).toBeGreaterThan(0)
  })
  it('leaves the world plan alone without a tune', { timeout: 600_000 }, () => {
    const { ix, sd, plan } = seeded()
    expect(Array.from(buildStoryPlan(sd, ix.notableYear).beatEntry)).toEqual(Array.from(plan.beatEntry))
    expect(plan.promUnit).toBeUndefined()
  })
})
