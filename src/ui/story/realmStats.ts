// lane N4d: stats for Follow this realm (realmFollow.ts), the realm-follow mode of storyStats.ts / pacingStats.ts. Per case
// (seed, preset, realm): beats over the realm's life (per century; at 4× and 16×), the share of beats that are small (local)
// events, the meanwhile notes, gaps, categories and beat types, and the real director's pacing from the realm's founding
// at 1× (first caption, dead air over the whole life and in the first 120 s, minutes), with the realm's pacing and, for
// comparison, the world's. Runs the realm's successors on (the story passes to them) when --chain is given.
//   node --import ./scripts/css-register.mjs --experimental-strip-types src/ui/story/realmStats.ts \
//     --out runs/n4d/realm.jsonl --cases 61343:realistic:0,1:dramatic:1,42:realistic:auto [--years 2000] [--tag t]
// One JSON line per case and tag; a rerun skips those already in --out.

import type { PresetName } from '../../contract.ts'
import { generateWorld, simulateHistory } from '../../sim/index.ts'
import { buildHistoryIndex } from '../historyIndex.ts'
import { politiesOf } from '../politiesData.ts'
import { buildStaticDrama, createDramaCtx, DRAMA_CAT_NAMES } from './drama.ts'
import { buildStoryPlan, keptCount } from './plan.ts'
import { buildRealmStory, defaultRealm, EntryKindR, REALM_PACE, REALM_STORY } from './realmFollow.ts'
import { playPlan } from './pacingStats.ts'
import { EventType } from '../../contract.ts'
import { loadDramaRules } from '../../bots/metrics.ts'

const ETYPE = new Map(Object.entries(EventType).map(([k, v]) => [v as number, k]))
const raw = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
const flag = (k: string) => { const i = raw.indexOf(`--${k}`); return i >= 0 ? raw[i + 1] : undefined }

async function main() {
  await loadDramaRules()
  const out = flag('out') ?? '/tmp/realm.jsonl'
  const years = Number(flag('years')) || 2000
  const tag = flag('tag') ?? 'default'
  const cases = (flag('cases') ?? '61343:realistic:0,1:dramatic:1,42:realistic:auto').split(',').map((c) => c.split(':'))
  const fs = (await import('node:' + 'fs')) as { appendFileSync(p: string, d: string): void; existsSync(p: string): boolean; readFileSync(p: string, e: string): string }
  const done = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : ''
  for (const [seedS, preset, realmS] of cases) {
    const seed = Number(seedS)
    const key = `"seed":${seed},"preset":"${preset}","realmArg":"${realmS}","years":${years},"tag":"${tag}"`
    if (done.includes(key)) { console.log(`${seed} ${preset} ${realmS}: already in ${out}`); continue }
    const t0 = performance.now()
    const h = simulateHistory(generateWorld(seed), { years, language: true, preset: preset as PresetName })
    const ix = buildHistoryIndex(h)
    const ctx = createDramaCtx(h)
    const sd = buildStaticDrama(ix, ctx)
    const plan = buildStoryPlan(sd, ix.notableYear, { until: h.years })
    const pd = politiesOf(h)!
    const p = realmS === 'auto' ? defaultRealm(pd, 0, h.years) : Number(realmS)
    const t1 = performance.now()
    const rs = buildRealmStory(ix, p, { drama: sd, plan }, ctx)!
    const t2 = performance.now()
    const x = pd.list[p]
    const from = x.foundedYear, end = Math.min(rs.endYear, h.years)
    const B = rs.plan.beatEntry.length
    let small = 0, mw = 0
    const cats: Record<string, number> = {}, types: Record<string, number> = {}
    const gaps: number[] = []
    for (let b = 0; b < B; b++) {
      const n = rs.plan.beatEntry[b]
      if (rs.kind[n] === EntryKindR.Small) small++
      if (rs.kind[n] === EntryKindR.Meanwhile) mw++
      const c = DRAMA_CAT_NAMES[rs.drama.cat[n]]
      cats[c] = (cats[c] ?? 0) + 1
      const ty = rs.kind[n] === EntryKindR.Meanwhile ? 'meanwhile' : ETYPE.get(h.events[rs.drama.rep[n]].type as number) ?? '?'
      types[ty] = (types[ty] ?? 0) + 1
      if (b > 0) gaps.push(rs.plan.beatYear[b] - rs.plan.beatYear[b - 1])
    }
    gaps.sort((a, b) => a - b)
    const realmBeats = B - mw
    const life = Math.max(1, end - from)
    const pace = playPlan(rs.plan, end, true, REALM_PACE, from)
    const paceWorld = playPlan(rs.plan, end, true, undefined, from)
    // the world's story over the same years, for comparison
    let worldBeats = 0
    for (let b = 0; b < plan.beatYear.length; b++) if (plan.beatYear[b] >= from && plan.beatYear[b] <= end) worldBeats++
    const row = {
      seed, preset, realmArg: realmS, years, tag, polity: p, name: x.name, from, end: rs.endYear === Infinity ? null : rs.endYear,
      successor: rs.successor, entries: rs.years.length, beats: B, beats4: keptCount(rs.plan, 4), beats16: keptCount(rs.plan, 16),
      beatsPerCentury: +((100 * B) / life).toFixed(2), smallShare: +(small / Math.max(1, realmBeats)).toFixed(3), meanwhile: mw,
      worldBeatsSameYears: worldBeats, medianGap: gaps[gaps.length >> 1] ?? 0, maxGap: gaps[gaps.length - 1] ?? 0,
      chronicleEntries: rs.chronicleEntries.length, cats, types, pace, paceWorldTune: paceWorld, buildMs: +(t2 - t1).toFixed(1), simMs: Math.round(t1 - t0),
      tune: REALM_STORY,
    }
    console.log(`${seed} ${preset} realm ${p} ${x.name} ${from}–${row.end ?? 'end'}: ${B} beats (${row.beatsPerCentury}/century; 4× ${row.beats4}, 16× ${row.beats16}), small ${(100 * row.smallShare).toFixed(0)}%, meanwhile ${mw}; world beats then ${worldBeats}; gaps med ${row.medianGap} max ${row.maxGap}; pace first ${pace.firstCaption}s dead ${pace.deadAirAll}s (120: ${pace.deadAir120}) ${pace.minutesToEnd} min [world tune: dead ${paceWorld.deadAirAll}s, ${paceWorld.minutesToEnd} min]; build ${row.buildMs} ms`)
    console.log(`  cats ${JSON.stringify(cats)}`)
    console.log(`  types ${JSON.stringify(types)}; successor ${JSON.stringify(rs.successor)}`)
    fs.appendFileSync(out, JSON.stringify(row) + '\n')
  }
}
if ((globalThis as { process?: { argv: string[] } }).process?.argv[1]?.endsWith('realmStats.ts')) await main()
