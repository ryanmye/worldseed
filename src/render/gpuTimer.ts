// GPU time of drawn frames (EXT_disjoint_timer_query_webgl2, where the browser has it):
// one query around each frame's draw, read back a frame or two later without waiting. The
// render loop's motion resolution (main.ts) uses it to tell a frame the GPU cannot finish in
// time from one the CPU held up; perf=1 traces read it too. Without the extension every
// call is a no-op and `last` stays NaN.

export interface GpuTimer {
  readonly available: boolean
  /** Around the frame's GPU work; `onResult` gets its milliseconds once known. Nested or suspended calls are skipped. */
  begin(onResult?: (ms: number) => void): void
  end(): void
  /** Collects finished queries; returns the latest GPU ms (NaN if none yet). */
  poll(): number
  /** Pauses timing (a measurement tool runs its own queries). */
  suspended: boolean
}

export function createGpuTimer(gl: WebGL2RenderingContext): GpuTimer {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
  const pool: WebGLQuery[] = []
  const inflight: { q: WebGLQuery; cb: ((ms: number) => void) | undefined }[] = []
  let active: WebGLQuery | null = null
  let activeCb: ((ms: number) => void) | undefined
  let last = NaN
  const timer: GpuTimer = {
    available: ext !== null,
    suspended: false,
    begin(onResult) {
      if (!ext || active || timer.suspended || inflight.length >= 6) return
      const q = pool.pop() ?? gl.createQuery()
      if (!q) return
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q)
      active = q
      activeCb = onResult
    },
    end() {
      if (!ext || !active) return
      gl.endQuery(ext.TIME_ELAPSED_EXT)
      inflight.push({ q: active, cb: activeCb })
      active = null
      activeCb = undefined
    },
    poll() {
      if (!ext) return NaN
      while (inflight.length > 0) {
        const { q, cb } = inflight[0]
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break
        inflight.shift()
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number
        pool.push(q)
        // (a disjoint event, e.g. a GPU clock change, makes the reading meaningless)
        if (gl.getParameter(ext.GPU_DISJOINT_EXT)) continue
        last = ns / 1e6
        cb?.(last)
      }
      return last
    },
  }
  return timer
}
