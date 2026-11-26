// Cost of the worker's cache write for one 2000-year History (seed 42): snapshot() copy and gzip
// (CompressionStream, as historyCache.ts pack) of every typed array >= 4 KB; raw vs stored bytes.
// Also how much of the six Uint8 land-snapshot arrays is ocean (always 0).
import { generateWorld, simulateHistory } from '/home/claude/worldseed-perf/src/sim/index.ts'
import { snapshot } from '/home/claude/worldseed-perf/src/historyCache.ts'
const world = generateWorld(42)
const h = simulateHistory(world, { years: 2000 }) as unknown as Record<string, unknown>
let t0 = performance.now()
const snap = snapshot(h)
const snapMs = performance.now() - t0
const views: ArrayBufferView[] = []
const seen = new Set<unknown>()
const walk = (v: unknown) => { if (!v || typeof v !== 'object' || seen.has(v)) return; seen.add(v); if (ArrayBuffer.isView(v)) { if (v.byteLength >= 4096) views.push(v); return } for (const x of Object.values(v as object)) walk(x) }
walk(snap)
t0 = performance.now()
let raw = 0, stored = 0
for (const v of views) {
  raw += v.byteLength
  const out = await new Response(new Blob([new Uint8Array(v.buffer, v.byteOffset, v.byteLength)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
  stored += out.byteLength
}
const gzMs = performance.now() - t0
const N = world.grid.cellCount
let land = 0
for (let i = 0; i < N; i++) if (world.elevation[i] >= 0) land++
console.log(JSON.stringify({ snapshotCopyMs: Math.round(snapMs), gzipMs: Math.round(gzMs), rawMB: +(raw / 1e6).toFixed(1), storedMB: +(stored / 1e6).toFixed(2), cells: N, landCellShare: +(land / N).toFixed(2) }))
