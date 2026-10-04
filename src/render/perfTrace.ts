// Per-frame trace (perf=1 measurement only): while window.__worldseed.trace is recording,
// the render loop opens a record per animation frame and layers add the milliseconds or
// counts of their named work to it (traceAdd). Off, traceAdd is one null check.

export type TraceRecord = Record<string, number>

export const trace: { cur: TraceRecord | null } = { cur: null }

/** Adds `v` (ms or a count) under `key` to the current frame's record, if one is recording. */
export function traceAdd(key: string, v: number): void {
  const r = trace.cur
  if (r) r[key] = (r[key] ?? 0) + v
}
