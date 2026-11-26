// Simulation benchmark (Node): world generation vs history time per seed, a History hash
// (historyCache.ts hashValue) to check determinism across changes, the History's size by field,
// and the cost of re-simulating after a nudge. Run: node --experimental-strip-types scripts/bench-sim.ts [years] [seeds...]
// (or npx tsx scripts/bench-sim.ts). BENCH_JSON=path writes the results as JSON.
import { writeFileSync } from 'node:fs'
import { generateWorld, simulateHistory, createHistoryRun } from '/home/claude/worldseed-perf/src/sim/index.ts'
import { hashValue } from '/home/claude/worldseed-perf/src/historyCache.ts'

const args = process.argv.slice(2).map(Number)
const years = args[0] || 2000
const seeds = args.length > 1 ? args.slice(1) : [1, 42, 1234]
const only = process.env.BENCH_ONLY // 'hash' skips the size and nudge parts

function sizeOf(v: unknown, seen = new Set<unknown>()): number {
  if (v === null || typeof v !== 'object') return typeof v === 'string' ? v.length * 2 : 8
  if (seen.has(v)) return 0
  seen.add(v)
  if (ArrayBuffer.isView(v)) return v.byteLength
  let s = 0
  if (Array.isArray(v)) for (const x of v) s += sizeOf(x, seen)
  else for (const x of Object.values(v as object)) s += sizeOf(x, seen)
  return s
}

const out: Record<string, unknown>[] = []
for (const seed of seeds) {
  const t0 = performance.now()
  const world = generateWorld(seed)
  const t1 = performance.now()
  const history = simulateHistory(world, { years })
  const t2 = performance.now()
  const hash = hashValue(history)
  const row: Record<string, unknown> = { seed, years, worldMs: Math.round(t1 - t0), historyMs: Math.round(t2 - t1), hash }
  if (only !== 'hash') {
    const fields = Object.entries(history as unknown as Record<string, unknown>).map(([k, v]) => [k, sizeOf(v)] as [string, number]).sort((a, b) => b[1] - a[1])
    row.historyBytes = fields.reduce((s, f) => s + f[1], 0)
    row.top = fields.slice(0, 15).map(([k, b]) => `${k}=${(b / 1e6).toFixed(2)}MB`)
    row.worldBytes = sizeOf(world)
    // a nudge: a fresh run from year 0 with one order (the worker's reorder path)
    const order = (history as unknown as { orders?: unknown }).orders
    void order
    const t3 = performance.now()
    const run = createHistoryRun(world, { years })
    run.advanceTo(years)
    row.resimMs = Math.round(performance.now() - t3)
  }
  out.push(row)
  console.log(JSON.stringify(row))
}
if (process.env.BENCH_JSON) writeFileSync(process.env.BENCH_JSON, JSON.stringify(out, null, 1))
