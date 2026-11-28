// Pacing harness (onboarding, EVALUATION §4 Lane 4): the first minutes of Follow the story on a real-hardware clock.
// The story plan of each seed is played by the real director (director.ts) on a fake timeline at 60 frames per second,
// with the timeline's eased slow factor, from year 0 at 1×, pacing on and off. Per seed: real seconds to the first
// caption, the longest stretch with no caption in the first 120 s ("dead air"; notices not counted, so it is an upper
// bound), the year reached at 120 s, and the real minutes to play the whole run. One JSON line per seed and setting is
// appended to the output file; entries already there are skipped (a rerun resumes).
//   node --import ./scripts/css-register.mjs --experimental-strip-types src/ui/story/pacingStats.ts <out.jsonl> [years] [seeds...]

import { generateWorld, simulateHistory } from '../../sim/index.ts'
import { buildHistoryIndex } from '../historyIndex.ts'
import { buildStaticDrama } from './drama.ts'
import { buildStoryPlan, type StoryPlan } from './plan.ts'
import { createDirector, DIRECTOR, type PacingTune } from './director.ts'
import { loadDramaRules } from '../../bots/metrics.ts'

export interface PacingRun {
  firstCaption: number | null
  deadAir120: number
  yearAt120: number
  minutesToEnd: number
  captions120: number
  /** lane N4d: the longest stretch with no caption over the whole play (from `from`), and captions in all. */
  deadAirAll: number
  captions: number
}

/** Play `plan` from year `from` (0) at 1× (60 fps) until `years`; pacing on or off (lane N4d: `tune`, a realm's pacing). */
export function playPlan(plan: StoryPlan, years: number, pacing: boolean, tune?: PacingTune, from = 0): PacingRun {
  const YPS = DIRECTOR.yps1x
  const tl = {
    year: from, playing: true, speed: 1, intro: false, slow: 1, target: 1, rate: 0,
    get yearsPerSecond() {
      return this.speed * this.slow * YPS
    },
    setSlow(k: number, ease: number) {
      this.target = Math.max(0.01, k)
      this.rate = ease > 0 ? Math.abs(this.target - this.slow) / ease : 0
      if (this.rate === 0) this.slow = this.target
    },
  }
  let caption = false
  const d = createDirector({
    timeline: tl, flyTo() {}, inView: () => false, pulse() {}, reducedMotion: () => false, cityEngaged: () => false,
    showCaption: () => (caption = true), hideCaption: () => (caption = false),
  })
  d.setPlan(plan)
  d.setPacing(pacing, tune)
  d.setOn(true)
  const dt = 1 / 60
  let t = 0, first: number | null = null, lastBusy = 0, dead = 0, deadAll = 0, yearAt120 = 0, captions = 0, all = 0, was = false
  while (tl.year < years && t < 3600) {
    if (tl.slow !== tl.target) tl.slow = tl.slow < tl.target ? Math.min(tl.target, tl.slow + tl.rate * dt) : Math.max(tl.target, tl.slow - tl.rate * dt)
    tl.year += dt * tl.speed * tl.slow * YPS
    d.tick(dt)
    t += dt
    if (caption) {
      if (first === null) first = t
      if (t <= 120) dead = Math.max(dead, t - lastBusy)
      deadAll = Math.max(deadAll, t - lastBusy)
      lastBusy = t
      if (!was && t <= 120) captions++
      if (!was) all++
    }
    was = caption
    if (t <= 120) yearAt120 = tl.year
  }
  if (t > 120 && lastBusy < 120) dead = Math.max(dead, 120 - lastBusy)
  deadAll = Math.max(deadAll, t - lastBusy)
  return { firstCaption: first === null ? null : +first.toFixed(1), deadAir120: +dead.toFixed(1), yearAt120: Math.round(yearAt120), minutesToEnd: +(t / 60).toFixed(1), captions120: captions, deadAirAll: +deadAll.toFixed(1), captions: all }
}

async function main() {
const args = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
const out = args[0] ?? '/tmp/pacing.jsonl'
const years = Number(args[1]) || 2000
const seeds = args.length > 2 ? args.slice(2).map(Number) : [61343, 1, 42, 1234]
// (node:fs on the CLI path only; tsconfig has no node types)
const fs = (await import('node:' + 'fs')) as { appendFileSync(p: string, d: string): void; existsSync(p: string): boolean; readFileSync(p: string, e: string): string }
const done = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : ''
// (surfacing lane: every *Format.ts drama rule, as the browser loads them)
await loadDramaRules()
for (const seed of seeds) {
  if (done.includes(`"seed":${seed},"years":${years},`)) {
    console.log(`seed ${seed}: already in ${out}`)
    continue
  }
  const h = simulateHistory(generateWorld(seed), { years, language: true })
  const ix = buildHistoryIndex(h)
  const plan = buildStoryPlan(buildStaticDrama(ix), ix.notableYear, { until: h.years })
  const row = { seed, years, beats: plan.beatYear.length, firstBeatYear: plan.beatYear[0] ?? null, off: playPlan(plan, h.years, false), on: playPlan(plan, h.years, true) }
  console.log(JSON.stringify(row))
  fs.appendFileSync(out, JSON.stringify(row) + '\n')
}
}
// (lane N4d: the CLI only when run itself, so realmStats.ts can import playPlan)
if ((globalThis as { process?: { argv: string[] } }).process?.argv[1]?.endsWith('pacingStats.ts')) await main()
