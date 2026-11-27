// Stats harness for the story director (experience-whatif-director-sagas §2.7): beats, gaps, category spread and
// notices per seed, with the top beats' factors for review, and (surfacing lane, EVALUATION §4 Lane 1) the beat mix: the
// share of beats from the merged systems (battles, disasters, finance, beliefs, oaths, society, families, cold wars,
// absentee, governments) and a per-type funnel (events → chronicle entries → scored → beats) that says where a type is lost.
// A Node script; the HistoryIndex reaches UI modules that import CSS, so run it with the CSS stub:
//   node --import ./scripts/css-register.mjs --experimental-strip-types src/ui/story/storyStats.ts [years] [seeds...]
//   ... storyStats.ts --preset dramatic --years 2000 --seeds 1,42 [--out runs.jsonl] [--funnel]
// Every UI module that registers drama rules is loaded first (bots/metrics.ts loadDramaRules), as the browser loads them.
// --out appends one JSON line per seed and preset and skips those already there (a rerun resumes).
// Targets (2000 years): beats at 1× 20–40, median gap ≥ 40 y, no gap > 250 y unless quiet; no category > 35%, ≥ 6
// categories; no more than 2 beats in a row about one polity; 4×: 8–15; 16×: 4–10; notices 60–150.

import { EventType, type PresetName } from '../../contract.ts'
import { generateWorld, simulateHistory } from '../../sim/index.ts'
import { buildHistoryIndex } from '../historyIndex.ts'
import { buildStaticDrama, DRAMA_CAT_NAMES, dramaRule, systemOf } from './drama.ts'
export { MERGED_SYSTEMS, systemOf } from './drama.ts'
import { buildStoryPlan, keptCount, STORY } from './plan.ts'
import { loadDramaRules } from '../../bots/metrics.ts'

const ETYPE = new Map(Object.entries(EventType).map(([k, v]) => [v as number, k]))

const raw = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
const flagArg = (k: string) => { const i = raw.indexOf(`--${k}`); return i >= 0 ? raw[i + 1] : undefined }
const positional = raw.filter((a, i) => !a.startsWith('--') && !(i > 0 && raw[i - 1].startsWith('--') && raw[i - 1] !== '--funnel'))
const years = Number(flagArg('years') ?? positional[0]) || 2000
const seeds = flagArg('seeds')?.split(',').map(Number) ?? (positional.length > 1 ? positional.slice(1).map(Number) : [1, 7, 42, 1234])
const preset = (flagArg('preset') ?? 'realistic') as PresetName
const out = flagArg('out')
const funnel = raw.includes('--funnel')

export interface BeatMixRow {
  seed: number; years: number; preset: string
  beats: number; beats4: number; beats16: number; notices: number; firstBeat: number | null
  medianGap: number; maxGap: number; topCatShare: number; cats: Record<string, number>
  /** Beats whose representative event is a merged system's, by system; their share of the beats. */
  newBeats: number; newShare: number; bySystem: Record<string, number>
  /** Systems with events in the run but no beat. */
  silentSystems: string[]
  /** The top-scored battle (by S0) is a beat. */
  topBattleBeat: boolean | null
  beatTypes: Record<string, number>
}

async function main() {
  await loadDramaRules()
  const nodeMod = (name: string) => import(/* @vite-ignore */ name)
  const fs = out ? await nodeMod('node:fs') : null
  const done = fs && fs.existsSync(out) ? String(fs.readFileSync(out, 'utf8')) : ''
  for (const seed of seeds) {
    if (done.includes(`"seed":${seed},"years":${years},"preset":"${preset}"`)) {
      console.log(`seed ${seed} ${preset}: already in ${out}`)
      continue
    }
    const t0 = performance.now()
    const h = simulateHistory(generateWorld(seed), { years, language: true, preset })
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
    const maxCat = Math.max(0, ...cats.values())
    console.log(`seed ${seed} (${preset}): ${h.events.length} events, ${ix.notableKind.length} entries, ${scored} scored; sim ${(t1 - t0).toFixed(0)} ms, index ${(t2 - t1).toFixed(0)} ms, drama+plan ${(t3 - t2).toFixed(1)} ms`)
    console.log(`  beats 1×: ${B}  4×: ${keptCount(plan, 4)}  16×: ${keptCount(plan, 16)}  notices: ${plan.noteEntry.length}`)
    console.log(`  gaps: median ${gaps[gaps.length >> 1] ?? 0} y, max ${gaps[gaps.length - 1] ?? 0} y; first beat ${plan.beatYear[0] ?? '-'}; same polity in a row ≤ ${maxRun}`)
    console.log(`  categories (${cats.size}, top ${((100 * maxCat) / Math.max(1, B)).toFixed(0)}%): ${[...cats].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${DRAMA_CAT_NAMES[c]} ${n}`).join(', ')}`)
    // the beat mix
    const bySystem: Record<string, number> = {}
    const beatTypes: Record<string, number> = {}
    let newBeats = 0
    for (const n of plan.beatEntry) {
      const t = h.events[sd.rep[n]]?.type as number
      const name = ETYPE.get(t) ?? String(t)
      beatTypes[name] = (beatTypes[name] ?? 0) + 1
      const sys = systemOf(t)
      if (sys) { newBeats++; bySystem[sys] = (bySystem[sys] ?? 0) + 1 }
    }
    const present = new Set<string>()
    for (const e of h.events) { const s = systemOf(e.type as number); if (s) present.add(s) }
    const silentSystems = [...present].filter((s) => !bySystem[s]).sort()
    // the top battle by S0 (entries whose representative is a BattleFought)
    let topB = -1
    for (let n = 0; n < sd.score.length; n++) if (sd.rep[n] >= 0 && h.events[sd.rep[n]].type === EventType.BattleFought && (topB < 0 || sd.score[n] > sd.score[topB])) topB = n
    const topBattleBeat = topB < 0 ? null : Array.from(plan.beatEntry).includes(topB)
    console.log(`  new-system beats: ${newBeats}/${B} (${((100 * newBeats) / Math.max(1, B)).toFixed(0)}%) ${JSON.stringify(bySystem)}; silent: ${silentSystems.join(', ') || '-'}; top battle a beat: ${topBattleBeat}`)
    console.log(`  beat types: ${Object.entries(beatTypes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`)
    if (funnel) {
      // per type: events, events in a chronicle entry, entries it represents with S0 > 0, the best S0, beats
      const ev = new Map<number, number>(), inEntry = new Map<number, number>(), repd = new Map<number, number>(), best = new Map<number, number>(), beatN = new Map<number, number>()
      const inc = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) ?? 0) + 1)
      for (const e of h.events) inc(ev, e.type as number)
      for (const i of ix.notableMembers) if (i >= 0) inc(inEntry, h.events[i].type as number)
      for (let n = 0; n < sd.score.length; n++) {
        if (sd.rep[n] < 0 || sd.score[n] <= 0) continue
        const t = h.events[sd.rep[n]].type as number
        inc(repd, t)
        best.set(t, Math.max(best.get(t) ?? 0, sd.score[n]))
      }
      for (const n of plan.beatEntry) inc(beatN, h.events[sd.rep[n]].type as number)
      console.log(`  funnel (merged systems): type events→entries→scored(best S0, θ=${STORY.theta})→beats`)
      for (const [t, c] of [...ev].sort((a, b) => a[0] - b[0])) {
        if (!systemOf(t)) continue
        const r = dramaRule(t)
        console.log(`    ${String(t).padStart(3)} ${(ETYPE.get(t) ?? '?').padEnd(20)} ${String(c).padStart(5)} → ${String(inEntry.get(t) ?? 0).padStart(5)} → ${String(repd.get(t) ?? 0).padStart(4)} (${(best.get(t) ?? 0).toFixed(1).padStart(5)}) → ${beatN.get(t) ?? 0}${r ? `  [B ${r.base}, ${DRAMA_CAT_NAMES[r.cat]}]` : '  [ignored]'}`)
      }
    }
    const top = Array.from(plan.beatEntry.keys()).sort((a, b) => plan.beatScore[b] - plan.beatScore[a]).slice(0, 10)
    for (const i of top) {
      const n = plan.beatEntry[i]
      const e = h.events[sd.rep[n]]
      const f = (x: number) => x.toFixed(2)
      console.log(`    ${String(plan.beatYear[i]).padStart(5)}  S=${f(plan.beatScore[i])} S0=${f(sd.score[n])} B=${f(sd.fB[n])} M=${f(sd.fM[n])} U=${f(sd.fU[n])} R=${f(sd.fR[n])} F1=${f(sd.fF[n])}  ${DRAMA_CAT_NAMES[sd.cat[n]]} ${ETYPE.get(e.type as number) ?? e.type} prom ${plan.beatProminence[i]}`)
    }
    if (fs) {
      const row: BeatMixRow = {
        seed, years, preset, beats: B, beats4: keptCount(plan, 4), beats16: keptCount(plan, 16), notices: plan.noteEntry.length, firstBeat: plan.beatYear[0] ?? null,
        medianGap: gaps[gaps.length >> 1] ?? 0, maxGap: gaps[gaps.length - 1] ?? 0, topCatShare: +(maxCat / Math.max(1, B)).toFixed(3),
        cats: Object.fromEntries([...cats].map(([c, k]) => [DRAMA_CAT_NAMES[c], k])), newBeats, newShare: +(newBeats / Math.max(1, B)).toFixed(3), bySystem, silentSystems, topBattleBeat, beatTypes,
      }
      fs.appendFileSync(out, JSON.stringify(row) + '\n')
    }
  }
  console.log(`STORY = ${JSON.stringify(STORY)}`)
}
if ((globalThis as { process?: { argv: string[] } }).process?.argv[1]?.endsWith('storyStats.ts')) await main()
