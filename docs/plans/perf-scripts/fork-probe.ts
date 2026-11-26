// Can the history state be checkpointed with structuredClone? Runs seed 42 to year 300 with the
// runHistory probe hook and tries to clone the HistoryState, trade and tech states; reports what fails
// (functions/closures) and how big a clone is. Also checks the premise of resuming a nudge: a run with
// an order at year Y matches the run without orders before Y (core arrays hashed at Y-1).
import { generateWorld } from '/home/claude/worldseed-perf/src/sim/index.ts'
import { runHistory } from '/home/claude/worldseed-perf/src/sim/history/index.ts'
import { hashValue } from '/home/claude/worldseed-perf/src/historyCache.ts'

const world = generateWorld(42)
let tried = false
const findFns = (v: unknown, path: string, out: string[], seen = new Set<unknown>(), depth = 0) => {
  if (out.length > 25 || depth > 6 || v === null || typeof v !== 'object' && typeof v !== 'function') return
  if (typeof v === 'function') { out.push(path); return }
  if (seen.has(v) || ArrayBuffer.isView(v)) return
  seen.add(v)
  for (const [k, x] of Object.entries(v as object)) findFns(x, `${path}.${k}`, out, seen, depth + 1)
}
runHistory(world, { years: 301 }, (s, t, k) => {
  if (tried || s.year !== 300) return
  tried = true
  for (const [name, obj] of [['state', s], ['trade', t], ['tech', k]] as const) {
    const fns: string[] = []
    findFns(obj, name, fns)
    let ok = 'ok', ms = 0, bytes = 0
    try { const t0 = performance.now(); const c = structuredClone(obj); ms = performance.now() - t0; bytes = JSON.stringify(Object.keys(c)).length } catch (e) { ok = String((e as Error).message).slice(0, 120) }
    console.log(JSON.stringify({ name, clone: ok, cloneMs: Math.round(ms), functionPaths: fns.slice(0, 25), nFn: fns.length, keys: bytes }))
  }
})
// premise check: orders at year 600 vs none, compared at year 599 on the core arrays
const Y = 600
const core = (h: any) => hashValue([h.population, h.food, h.wealth, h.landUse, h.road, h.settlements, h.events.filter((e: any) => e.type !== undefined), h.polity, h.territory])
const a = runHistory(world, { years: Y - 1 }).history
const b = runHistory(world, { years: Y - 1, orders: [{ year: Y, kind: 0, actor: 0 }] as any }).history
console.log(JSON.stringify({ premise: 'orders at Y do not change years < Y', Y, same: core(a) === core(b), a: core(a), b: core(b) }))
