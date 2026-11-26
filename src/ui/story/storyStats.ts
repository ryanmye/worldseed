// Stats harness for the story director (experience-whatif-director-sagas §2.7): beats, gaps, category spread and
// notices per seed, with the top beats' factors for review. A Node script; the HistoryIndex reaches UI modules that
// import CSS, so run it with the CSS stub:
//   node --import ./scripts/css-register.mjs --experimental-strip-types src/ui/story/storyStats.ts [years] [seeds...]
// Targets (2000 years): beats at 1× 20–40, median gap ≥ 40 y, no gap > 250 y unless quiet; no category > 35%, ≥ 6
// categories; no more than 2 beats in a row about one polity; 4×: 8–15; 16×: 4–10; notices 60–150.

import { generateWorld, simulateHistory } from '../../sim/index.ts'
import { buildHistoryIndex } from '../historyIndex.ts'
import { buildStaticDrama, DRAMA_CAT_NAMES } from './drama.ts'
import { buildStoryPlan, keptCount, STORY } from './plan.ts'

const argv = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2).map(Number)
const years = argv[0] || 2000
const seeds = argv.length > 1 ? argv.slice(1) : [1, 7, 42, 1234]

for (const seed of seeds) {
  const t0 = performance.now()
  const h = simulateHistory(generateWorld(seed), { years })
  const t1 = performance.now()
  const ix = buildHistoryIndex(h)
  const t2 = performance.now()
  const sd = buildStaticDrama(ix)
  const plan = buildStoryPlan(sd, ix.notableYear)
  const t3 = performance.now()
  const B = plan.beatEntry.length
  const gaps: number[] = []
  for (let i = 1; i < B; i++) gaps.push(plan.beatYear[i] - plan.beatYear[i - 1])
  gaps.sort((a, b) => a - b)
  const cats = new Map<number, number>()
  for (const n of plan.beatEntry) cats.set(sd.cat[n], (cats.get(sd.cat[n]) ?? 0) + 1)
  let run = 1, maxRun = 1
  for (let i = 1; i < B; i++) {
    const a = plan.beatEntry[i - 1], b = plan.beatEntry[i]
    const same = sd.polA[a] >= 0 && (sd.polA[a] === sd.polA[b] || sd.polA[a] === sd.polB[b])
    run = same ? run + 1 : 1
    maxRun = Math.max(maxRun, run)
  }
  const scored = sd.score.reduce((n, s) => n + (s > 0 ? 1 : 0), 0)
  const maxCat = Math.max(...cats.values())
  console.log(`seed ${seed}: ${ix.notableKind.length} entries, ${scored} scored; sim ${(t1 - t0).toFixed(0)} ms, index ${(t2 - t1).toFixed(0)} ms, drama+plan ${(t3 - t2).toFixed(1)} ms`)
  console.log(`  beats 1×: ${B}  4×: ${keptCount(plan, 4)}  16×: ${keptCount(plan, 16)}  notices: ${plan.noteEntry.length}`)
  console.log(`  gaps: median ${gaps[gaps.length >> 1] ?? 0} y, max ${gaps[gaps.length - 1] ?? 0} y; first beat ${plan.beatYear[0] ?? '-'}; same polity in a row ≤ ${maxRun}`)
  console.log(`  categories (${cats.size}, top ${((100 * maxCat) / Math.max(1, B)).toFixed(0)}%): ${[...cats].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${DRAMA_CAT_NAMES[c]} ${n}`).join(', ')}`)
  const top = Array.from(plan.beatEntry.keys()).sort((a, b) => plan.beatScore[b] - plan.beatScore[a]).slice(0, 10)
  for (const i of top) {
    const n = plan.beatEntry[i]
    const e = h.events[sd.rep[n]]
    const f = (x: number) => x.toFixed(2)
    console.log(`    ${String(plan.beatYear[i]).padStart(5)}  S=${f(plan.beatScore[i])} S0=${f(sd.score[n])} B=${f(sd.fB[n])} M=${f(sd.fM[n])} U=${f(sd.fU[n])} R=${f(sd.fR[n])} F1=${f(sd.fF[n])}  ${DRAMA_CAT_NAMES[sd.cat[n]]} type ${e.type} prom ${plan.beatProminence[i]}`)
  }
}
console.log(`STORY = ${JSON.stringify(STORY)}`)
