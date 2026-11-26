// Where the years' cost goes (per 250-year chunk), the History assembly cost, and a nudge's
// re-simulation (the worker's reorder path: a fresh run from year 0 with one order at year Y).
// What resuming from a checkpoint at Y would save = the chunks before Y.
// Run: node --experimental-strip-types bench-nudge.ts [seed] [Y]
import { generateWorld, createHistoryRun } from '/home/claude/worldseed-perf/src/sim/index.ts'
import { hashValue } from '/home/claude/worldseed-perf/src/historyCache.ts'
const seed = Number(process.argv[2] ?? 42), Y = Number(process.argv[3] ?? 1000), years = 2000
const world = generateWorld(seed)
// warm-up (JIT) on a short run so the chunk times are not dominated by compilation
createHistoryRun(world).advanceTo(200)
const run = createHistoryRun(world)
const chunks: number[] = []
for (let y = 250; y <= years; y += 250) { const t0 = performance.now(); run.simulateTo(y); chunks.push(Math.round(performance.now() - t0)) }
let t0 = performance.now()
const h = run.advanceTo(years)
const assembleMs = Math.round(performance.now() - t0)
t0 = performance.now()
const nudged = createHistoryRun(world, { orders: [{ year: Y, kind: 0, actor: 0 }] as never })
nudged.advanceTo(years)
const resimMs = Math.round(performance.now() - t0)
const beforeY = chunks.slice(0, Math.floor(Y / 250)).reduce((a, b) => a + b, 0)
console.log(JSON.stringify({ seed, chunkMsPer250y: chunks, simMs: chunks.reduce((a, b) => a + b, 0), assembleMs, nudgeYear: Y, resimFromZeroMs: resimMs, savedByResumeAtYMs: beforeY, hash: hashValue(h) }))
