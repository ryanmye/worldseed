// Every non-RNG function (closure) reachable from the HistoryState at year 300 (seed 42), and the
// byte size of its typed arrays: what a structuredClone checkpoint would have to handle and hold.
import { generateWorld } from '/home/claude/worldseed-perf/src/sim/index.ts'
import { runHistory } from '/home/claude/worldseed-perf/src/sim/history/index.ts'
const world = generateWorld(42)
const RNG = new Set(['next', 'u32', 'range', 'int', 'unitVector', 'shuffle'])
runHistory(world, { years: 300 }, (s, t, k) => {
  if (s.year !== 300) return
  const fns: string[] = [], rngs = new Set<string>()
  let bytes = 0
  const seen = new Set<unknown>()
  const walk = (v: unknown, path: string, d: number) => {
    if (v === null || d > 12) return
    if (typeof v === 'function') { const leaf = path.split('.').pop()!; if (RNG.has(leaf)) rngs.add(path.slice(0, -leaf.length - 1)); else fns.push(path); return }
    if (typeof v !== 'object' || seen.has(v)) return
    seen.add(v)
    if (ArrayBuffer.isView(v)) { bytes += v.byteLength; return }
    if (v instanceof Map || v instanceof Set) { for (const [i, x] of [...(v as Map<unknown, unknown>).entries()].entries()) walk(x, `${path}[${i}]`, d + 1); return }
    for (const [kk, x] of Object.entries(v as object)) walk(x, `${path}.${kk}`, d + 1)
  }
  walk({ s, t, k }, 'root', 0)
  console.log(JSON.stringify({ rngObjects: [...rngs], otherFunctions: fns.slice(0, 40), nOther: fns.length, typedArrayMB: +(bytes / 1e6).toFixed(1) }, null, 1))
})
