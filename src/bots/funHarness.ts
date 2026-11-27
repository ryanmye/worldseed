// Fun harness CLI (EVALUATION §4 Lane 2): bots play throne mode through the real seat path (headless.ts) and the run is
// measured (metrics.ts). Run with the CSS stub (the history index reaches UI modules that import CSS):
//
//   node --import ./scripts/css-register.mjs --experimental-strip-types --no-warnings src/bots/funHarness.ts \
//     [--seeds 1,42] [--personas cautious,aggressive,always-defer,random,greedy:1] [--from 700] [--span 300] \
//     [--preset realistic|dramatic] [--opts '{"battles":true}'] [--seat polity:3:700] [--write docs/fun-baseline.jsonl] \
//     [--snapshot docs/bots/metrics-v1.json] [--replay] [--json out.json] [--null N]
//
// The seat (when --seat is not given) is chosen the way a player picks one from the Factions panel: the realm at the top of
// its list (the most people) alive at --from in the unseated history. --replay also checks each run against a fresh replay
// of its URL (seat= and o=: simulateHistory with the same seat and orders). --null N re-runs `random` with N generator seeds
// on each world to measure the metrics' noise.
import { AmbitionKind, decodeSeat, decodeOrders, AMBITION_KIND_COUNT } from '../contract.ts'
import type { SeatOptions } from '../contract.ts'
import { generateWorld, simulateHistory } from '../sim/index.ts'
import { hashAll } from '../sim/history/seat/hashing.ts'
import { pickSeat, runBot, type BotRun } from './headless.ts'
import { measure, type RunMetrics } from './metrics.ts'
import { personaOf, PERSONA_VERSION } from './personas.ts'
import { resolveRun } from './presets.ts'
import { PRIMER_VERSION } from './primer.ts'

// (Node only; untyped: the app's tsconfig has no node types)
const proc = (globalThis as unknown as { process: { argv: string[]; exit(c: number): never } }).process
const nodeMod = (name: string) => import(/* @vite-ignore */ name)
const { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync } = await nodeMod('node:fs')
const { dirname } = await nodeMod('node:path')
const argv = proc.argv.slice(2)
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const flag = (k: string) => argv.includes(`--${k}`)

function table(rows: RunMetrics[]): string {
  const cols: [string, (m: RunMetrics) => string | number][] = [
    ['persona', (m) => m.persona], ['seed', (m) => m.seed], ['cards', (m) => m.cards], ['ttfc s', (m) => m.ttfcS], ['visible', (m) => m.visibleConsequence],
    ['rep k+s', (m) => m.repeatKindSubject], ['rep text', (m) => m.repeatText], ['kinds/reign', (m) => m.distinctKindsPerReign], ['kinds', (m) => m.distinctKinds], ['arcs done', (m) => `${m.arcsDone}/${m.arcs}`], ['rare/h', (m) => m.rarePerHour],
    ['dead air s', (m) => m.deadAirS], ['beats', (m) => m.beats], ['unsurf', (m) => m.unsurfaced], ['unsurf merged', (m) => m.unsurfacedMerged],
    ['blind', (m) => m.blind], ['levers', (m) => m.levers], ['defers', (m) => m.defers], ['wars (ours)', (m) => `${m.warsFought} (${m.warsStarted})`],
    ['amb met', (m) => m.ambitionsMet.join('.') || '-'], ['lost', (m) => (m.lost ? 'y' : '')], ['wall s', (m) => m.wallS],
  ]
  const head = `| ${cols.map((c) => c[0]).join(' | ')} |\n|${cols.map(() => '---').join('|')}|`
  return head + '\n' + rows.map((m) => `| ${cols.map((c) => c[1](m)).join(' | ')} |`).join('\n')
}

async function main() {
  const seeds = (arg('seeds', '1,42') ?? '').split(',').map(Number)
  const personas = (arg('personas', 'cautious,aggressive,always-defer,random,greedy:1') ?? '').split(',')
  const from = Number(arg('from', '700')), span = Number(arg('span', '300'))
  const preset = arg('preset', 'realistic')!
  const run = resolveRun(preset, JSON.parse(arg('opts', '{}')!))
  const seatArg = arg('seat')
  const nulls = Number(arg('null', '0'))
  const rows: RunMetrics[] = []
  const replays: string[] = []
  const t0 = performance.now()
  // resumable: one line per finished run in --out (default /home/claude/runs/bots/<preset>-p<v>.jsonl); runs already there are skipped
  const outFile = arg('out', `/home/claude/runs/bots/${preset}-p${PERSONA_VERSION}-from${from}-span${span}.jsonl`)!
  mkdirSync(dirname(outFile), { recursive: true })
  const done = new Map<string, RunMetrics & { replay?: string }>()
  if (existsSync(outFile)) for (const line of String(readFileSync(outFile, 'utf8')).split('\n')) if (line.trim()) { const x = JSON.parse(line); done.set(`${x.seed}|${x.persona}`, x) }
  for (const seed of seeds) {
    let base: SeatOptions | null = seatArg ? decodeSeat(seatArg)! : null
    const jobs: { spec: string; rngSeed?: number }[] = personas.map((spec) => ({ spec }))
    for (let k = 0; k < nulls; k++) jobs.push({ spec: 'random', rngSeed: 1000 + k })
    for (const job of jobs) {
      const name = job.rngSeed !== undefined ? `random#${job.rngSeed}` : job.spec
      const prev = done.get(`${seed}|${name}`)
      if (prev) { rows.push(prev); if (prev.replay) replays.push(prev.replay); console.error(`seed ${seed} ${name}: done (skipped)`); continue }
      if (!base) base = pickSeat(seed, from, run.historyOptions)
      const { persona, ambition } = personaOf(job.spec)
      // every persona declares every ambition (judged only; it changes nothing in the run), so each run says which it met;
      // greedy declares its own first
      const amb = ambition !== null ? [ambition, ...Array.from({ length: AMBITION_KIND_COUNT }, (_, i) => i).filter((i) => i !== ambition)] : Array.from({ length: AMBITION_KIND_COUNT }, (_, i) => i)
      const seat = { ...base, ambitions: amb }
      const r: BotRun = await runBot({ seed, seat, persona, span, historyOptions: run.historyOptions, rngSeed: job.rngSeed })
      const m = await measure(r, preset)
      m.persona = name
      rows.push(m)
      console.error(`seed ${seed} ${m.persona}: ${m.cards} cards to ${r.history.years}${r.lost ? ' (lost)' : ''}, ${m.wallS} s; seat=${r.seatParam}`)
      if (flag('replay')) {
        const fresh = simulateHistory(generateWorld(seed, { subdivisions: 48 }), { ...run.historyOptions, years: r.history.years, seat, orders: decodeOrders(r.o) })
        const a = hashAll(r.history), b = hashAll(fresh)
        replays.push(`${seed} ${m.persona}: bot ${a} replay ${b} ${a === b ? 'EQUAL' : 'DIFFERENT'}`)
        ;(m as RunMetrics & { replay?: string }).replay = replays[replays.length - 1]
      }
      appendFileSync(outFile, JSON.stringify({ date: new Date().toISOString().slice(0, 10), personaVersion: PERSONA_VERSION, primerVersion: PRIMER_VERSION, seat: r.seatParam, o: r.o, ...m }) + '\n')
      if (flag('json')) writeFileSync(arg('json')!.replace('.json', `-${seed}-${m.persona.replace(/[:#]/g, '_')}.json`), JSON.stringify({ seat: r.seatParam, o: r.o, years: r.history.years, hash: hashAll(r.history), cards: r.cards.map((c) => ({ year: c.model.year, title: c.model.title, situation: c.model.situation, news: c.model.news, callbacks: c.model.callbacks.map((x) => x.text), odds: c.model.hud?.oddsText, options: c.model.options.map((o) => o.label), notes: c.model.options.map((o) => o.note + ' [' + o.stakes.risk + (o.stakes.odds ? '; ' + o.stakes.odds : '') + ']'), picked: c.decision.option, why: c.decision.why })) }, null, 1))
    }
  }
  const stamp = { date: new Date().toISOString().slice(0, 10), personaVersion: PERSONA_VERSION, primerVersion: PRIMER_VERSION, preset, from, span }
  console.log(`\n## Fun harness (${preset}, from ${from}, ${span} y; personas v${PERSONA_VERSION}, primer v${PRIMER_VERSION})\n`)
  console.log(table(rows))
  // coverage gaps: outcomes no persona reached on any seed
  const reached = (f: (m: RunMetrics) => boolean) => rows.some(f)
  const outcomes: [string, (m: RunMetrics) => boolean][] = [
    ['a usurper takes our throne', (m) => m.rare.usurpedFromUs > 0], ['a general\'s coup', (m) => m.rare.coup > 0],
    ['a bankruptcy war (ours)', (m) => m.rare.bankruptWar > 0], ['our realm dies', (m) => m.rare.realmDeath > 0],
    ['we end another realm', (m) => m.rare.weConquered > 0], ['we win a hopeless war', (m) => m.rare.hopelessWarWon > 0],
    ['the seat is lost', (m) => m.lost], ['we start a war', (m) => m.warsStarted > 0],
    ...Object.entries(AmbitionKind).map(([k, v]) => [`ambition ${k}`, (m: RunMetrics) => m.ambitionsMet.includes(v)] as [string, (m: RunMetrics) => boolean]),
  ]
  console.log('\n### Outcomes no persona reached\n')
  for (const [name, f] of outcomes) if (!reached(f)) console.log(`- ${name}`)
  console.log('\n### Competence (bot weak vs no lever)\n')
  for (const m of rows) {
    if (m.persona.startsWith('greedy')) {
      const a = Number(m.persona.split(':')[1] ?? AmbitionKind.Unify)
      const met = m.ambitionsMet.includes(a), other = rows.some((x) => x.seed === m.seed && x !== m && x.ambitionsMet.includes(a))
      console.log(`- seed ${m.seed} ${m.persona}: ambition ${met ? 'MET' : 'not met'}; ${m.levers}/${m.cards} cards offered a lever, ${m.blind} blind. ${met ? '' : m.levers === 0 ? 'Verdict: the game gave no lever.' : other ? 'Verdict: bot weak (another persona met it).' : 'Verdict: levers offered but too weak (no persona met it).'}`)
    }
    if (m.persona === 'aggressive') console.log(`- seed ${m.seed} aggressive: started ${m.warsStarted} of ${m.warsFought} wars; ${m.levers}/${m.cards} cards had a warlike option, ${m.blind} blind. ${m.warsStarted > 0 ? '' : m.levers === 0 ? 'Verdict: the game gave no lever.' : 'Verdict: levers taken but no war followed.'}`)
  }
  if (replays.length) console.log('\n### Replay equivalence (bot run vs fresh replay of its URL)\n\n' + replays.map((x) => `- ${x}`).join('\n'))
  if (nulls > 0) {
    console.log('\n### Null-run noise (random persona, different generator seeds, same world)\n')
    const keys: (keyof RunMetrics)[] = ['cards', 'ttfcS', 'visibleConsequence', 'repeatKindSubject', 'repeatText', 'distinctKindsPerReign', 'rarePerHour', 'deadAirS', 'unsurfaced']
    for (const seed of seeds) {
      const xs = rows.filter((m) => m.seed === seed && m.persona.startsWith('random'))
      console.log(`- seed ${seed} (n=${xs.length}): ` + keys.map((k) => { const v = xs.map((m) => m[k] as number); const mu = v.reduce((a, b) => a + b, 0) / v.length; const sd = Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, v.length - 1)); return `${k} ${mu.toFixed(2)}±${sd.toFixed(2)}` }).join(', '))
    }
  }
  console.log(`\nruntime ${((performance.now() - t0) / 1000).toFixed(0)} s`)
  const w = arg('write')
  if (w) { mkdirSync(dirname(w), { recursive: true }); writeFileSync(w, rows.map((m) => JSON.stringify({ ...stamp, ...m })).join('\n') + '\n') } // (the whole table, rewritten: reruns never duplicate)
  const snap = arg('snapshot')
  if (snap) { mkdirSync(dirname(snap), { recursive: true }); writeFileSync(snap, JSON.stringify({ ...stamp, rows }, null, 1) + '\n') }
  proc.exit(0)
}
if (proc.argv[1]?.endsWith('funHarness.ts')) await main()
