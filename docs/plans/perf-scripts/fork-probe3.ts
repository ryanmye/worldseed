// Bytes a checkpoint of the mutable sim state would hold at several years (seed 42), split by
// top-level key, excluding s.terrain (read-only, shareable); and the time to copy them.
import { generateWorld } from '/home/claude/worldseed-perf/src/sim/index.ts'
import { runHistory } from '/home/claude/worldseed-perf/src/sim/history/index.ts'
const world = generateWorld(42)
const at = new Set([300, 1000, 2000])
runHistory(world, { years: 2000 }, (s, t, k) => {
  if (!at.has(s.year)) return
  const seen = new Set<unknown>([s.terrain])
  const arrays: ArrayBufferView[] = []
  const size = (v: unknown, d = 0): number => {
    if (v === null || typeof v !== 'object' || seen.has(v) || d > 14) return 0
    seen.add(v)
    if (ArrayBuffer.isView(v)) { arrays.push(v); return v.byteLength }
    let b = 0
    if (v instanceof Map || v instanceof Set) for (const x of (v as Map<unknown, unknown>).values()) b += size(x, d + 1)
    else for (const x of Object.values(v as object)) b += size(x, d + 1)
    if (Array.isArray(v)) b += v.length * 8
    return b
  }
  const parts: [string, number][] = []
  for (const [kk, v] of Object.entries(s)) parts.push([`s.${kk}`, size(v)])
  parts.push(['trade', size(t)], ['tech', size(k)])
  parts.sort((a, b) => b[1] - a[1])
  const total = parts.reduce((a, b) => a + b[1], 0)
  const t0 = performance.now()
  for (const a of arrays) (a as unknown as { slice(): unknown }).slice()
  console.log(JSON.stringify({ year: s.year, totalMB: +(total / 1e6).toFixed(1), terrainMB: +(size.call(null, s.terrain) / 1e6).toFixed(1), copyMs: Math.round(performance.now() - t0), top: parts.slice(0, 12).map(([a, b]) => `${a}=${(b / 1e6).toFixed(1)}`) }))
})
