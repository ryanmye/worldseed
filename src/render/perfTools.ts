// Performance readout (URL perf=1) and measurement hooks on window.__worldseed:
//   bench(n)        draw n frames back to back, each waited for (GPU included); median ms
//   noiseCount()    noise / Voronoi evaluations per pixel of the planet in the current view
//   bakeReady()     surface and cloud bakes finished
//   stats()         frames drawn, draw calls, bakes, texture memory
//   setContinuous() draw every animation frame (for frame-rate comparisons)

import * as THREE from 'three'
import type { GlobeMesh } from './globe.ts'
import type { Clouds } from './sky.ts'
import { trace, type TraceRecord } from './perfTrace.ts'
import type { GpuTimer } from './gpuTimer.ts'

interface Hooks {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.Camera
  getGlobe(): GlobeMesh | null
  getClouds(): Clouds | null
  drawNow(): void
  bakeReady(): boolean
  pixelRatio(): number
  quality(): string
  /** Atmosphere ray-march steps (A/B timing). */
  setAtmosphereSteps(n: number): void
  /** The render loop's GPU timer (paused while a tool here runs its own queries). */
  gpuTimer: GpuTimer
  /** Motion resolution: 'auto', 'interval' (no GPU timer), 'off' (always the cap). */
  setMotionRes(mode: 'auto' | 'interval' | 'off'): void
}

export interface PerfMonitor {
  readonly enabled: boolean
  /** Draw every animation frame (measurement only). */
  readonly forceContinuous: boolean
  /** A measurement drives the bake itself: the render loop must not step it. */
  readonly holdBake: boolean
  /** After each drawn frame: timestamp, CPU ms spent in renderer.render. */
  frame(ts: number, cpuMs: number, renderer: THREE.WebGLRenderer): void
  /** Around each animation frame: opens and closes its trace record while one is recording. */
  traceBegin(ts: number): void
  traceEnd(pixelRatio: number): void
  expose(hooks: Hooks): void
}

/** Buffer and texture uploads, in kB per traced frame (perf=1 traces): the context's upload calls wrapped once. */
const counted = new WeakSet<object>()
function countUploads(gl: WebGL2RenderingContext) {
  if (counted.has(gl)) return
  counted.add(gl)
  const g = gl as unknown as Record<string, (...a: unknown[]) => unknown>
  const wrap = (name: string, bytes: (a: unknown[]) => number) => {
    const f = g[name].bind(gl)
    g[name] = (...a: unknown[]) => {
      const r = trace.cur
      if (!r) return f(...a)
      const t = performance.now()
      const out = f(...a)
      r.upMs = (r.upMs ?? 0) + performance.now() - t
      r.upKB = (r.upKB ?? 0) + bytes(a) / 1024
      return out
    }
  }
  const view = (x: unknown) => (x && typeof (x as ArrayBufferView).byteLength === 'number' ? (x as ArrayBufferView).byteLength : 0)
  // bufferSubData(target, offset, src, srcOffset, length): length in elements of src
  wrap('bufferSubData', (a) => (typeof a[4] === 'number' && a[2] ? (a[4] as number) * ((a[2] as Float32Array).BYTES_PER_ELEMENT ?? 1) : view(a[2])))
  wrap('bufferData', (a) => (typeof a[1] === 'number' ? 0 : view(a[1])))
  wrap('texSubImage2D', (a) => view(a[a.length - 1]) || view(a[a.length - 2]))
  wrap('texImage2D', (a) => view(a[a.length - 1]) || view(a[a.length - 2]))
  wrap('texSubImage3D', (a) => view(a[a.length - 1]) || view(a[a.length - 2]))
}

export function createPerfMonitor(enabled: boolean, container: HTMLElement): PerfMonitor {
  let forceContinuous = false
  let holdBake = false
  let frames = 0
  let windowFrames = 0
  let windowCpu = 0
  let calls = 0
  let triangles = 0
  let bakes = 0
  let lastCounted = 0
  let lastBakeMs = 0
  let bakeBytes = 0
  let hooks: Hooks | null = null
  let el: HTMLDivElement | null = null
  let last = performance.now()
  // per-frame trace (window.__worldseed.trace)
  let tracing = false
  let traceRecs: TraceRecord[] = []
  let traceT0 = 0
  let traceCalls0 = 0

  if (enabled) {
    el = document.createElement('div')
    el.className = 'perf-readout'
    container.appendChild(el)
    // the readout itself must not keep the page drawing: plain DOM text, twice a second
    window.setInterval(() => {
      const now = performance.now()
      const sec = (now - last) / 1000
      last = now
      const fps = windowFrames / sec
      const cpu = windowFrames ? windowCpu / windowFrames : 0
      windowFrames = 0
      windowCpu = 0
      if (!el) return
      const g = hooks?.getGlobe()?.bakeInfo
      const c = hooks?.getClouds()?.bakeInfo
      const n = (g?.count ?? 0) + (c?.count ?? 0)
      if (n !== lastCounted) {
        // per world: a new world starts its counts from zero
        if (n > lastCounted) bakes += n - lastCounted
        lastCounted = n
        lastBakeMs = Math.max(g?.lastMs ?? 0, c?.lastMs ?? 0)
      }
      bakeBytes = (g?.ready ? g.bytes : 0) + (c?.ready ? c.bytes : 0)
      const pr = hooks ? hooks.pixelRatio().toFixed(2) : '?'
      el.textContent =
        `${fps.toFixed(1)} frames/s drawn · ${cpu.toFixed(2)} ms cpu/frame · ${calls} calls · ${(triangles / 1000).toFixed(0)}k tris\n` +
        `px ratio ${pr} · ${hooks?.quality() ?? ''} · bakes ${bakes} (last ${lastBakeMs.toFixed(0)} ms) · bake tex ${(bakeBytes / 1048576).toFixed(0)} MB · ${frames} frames total`
    }, 500)
  }

  return {
    enabled,
    get forceContinuous() {
      return forceContinuous
    },
    get holdBake() {
      return holdBake
    },
    frame(_ts: number, cpuMs: number, renderer: THREE.WebGLRenderer) {
      frames++
      windowFrames++
      windowCpu += cpuMs
      calls = renderer.info.render.calls
      triangles = renderer.info.render.triangles
      if (trace.cur) {
        trace.cur.drawn = 1
        trace.cur.calls = calls
        trace.cur.tris = triangles
      }
    },
    traceBegin(ts: number) {
      if (!tracing) return
      trace.cur = { ts, t: performance.now() }
      traceCalls0 = frames
    },
    traceEnd(pixelRatio: number) {
      const r = trace.cur
      if (!tracing || !r) return
      r.ms = performance.now() - r.t
      r.pr = pixelRatio
      if (frames === traceCalls0) r.drawn = 0
      trace.cur = null
      traceRecs.push(r)
    },
    expose(h: Hooks) {
      hooks = h
      const api = {
        bakeReady: () => h.bakeReady(),
        stats: () => ({
          frames,
          calls,
          triangles,
          bakes: (h.getGlobe()?.bakeInfo.count ?? 0) + (h.getClouds()?.bakeInfo.count ?? 0),
          globeBake: h.getGlobe()?.bakeInfo ?? null,
          globeDetail: h.getGlobe()?.detailInfo ?? null,
          cloudBake: h.getClouds()?.bakeInfo ?? null,
          pixelRatio: h.pixelRatio(),
          quality: h.quality(),
          textures: h.renderer.info.memory.textures,
          geometries: h.renderer.info.memory.geometries,
        }),
        useBake: (on: boolean) => {
          h.getGlobe()?.setBakeUse(on)
          h.getClouds()?.setBakeUse(on)
          h.drawNow()
        },
        setContinuous: (on: boolean) => {
          forceContinuous = on
        },
        /**
         * Per-frame trace: start() records every animation frame (ms of the whole frame
         * callback, its parts and the layers' named work, draw calls, triangles, pixel
        /** The scene, renderer and camera (measurement experiments). */
        three: () => ({ scene: h.scene, renderer: h.renderer, camera: h.camera }),
        /**
         * Per-frame trace: start() records every animation frame (ms of the whole frame
         * callback, its parts and the layers' named work, draw calls, triangles, pixel
         * ratio, GPU ms of its draw from the render loop's timer); stop() returns them.
         */
        trace: {
          start: () => {
            countUploads(h.renderer.getContext() as WebGL2RenderingContext)
            traceRecs = []
            traceT0 = performance.now()
            tracing = true
          },
          stop: async () => {
            tracing = false
            const nextFrame = () => new Promise((res) => requestAnimationFrame(res))
            // the last frames' GPU times arrive a frame or two later
            for (let k = 0; k < 8; k++) {
              h.gpuTimer.poll()
              await nextFrame()
            }
            h.gpuTimer.poll()
            const recs = traceRecs
            traceRecs = []
            for (const r of recs) r.t -= traceT0
            return recs
          },
        },
        motionRes: (mode: 'auto' | 'interval' | 'off') => h.setMotionRes(mode),
        bench: (n = 10) => {
          const gl = h.renderer.getContext()
          const px = new Uint8Array(4)
          const ts: number[] = []
          for (let i = 0; i < n; i++) {
            const t = performance.now()
            h.drawNow()
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
            ts.push(performance.now() - t)
          }
          ts.sort((a, b) => a - b)
          return { median: +ts[ts.length >> 1].toFixed(1), min: +ts[0].toFixed(1), max: +ts[ts.length - 1].toFixed(1), calls: h.renderer.info.render.calls }
        },
        /**
         * Interleaved A/B timing in one page (cancels machine-load drift): 'bake' compares
         * the procedural and baked surface and clouds, 'atmo' 12 against `steps` atmosphere steps.
         */
        ab: (n = 8, what = 'bake', steps = 8) => {
          h.gpuTimer.suspended = true
          const gl = h.renderer.getContext()
          const px = new Uint8Array(4)
          const set = (b: boolean) => {
            if (what === 'bake') {
              h.getGlobe()?.setBakeUse(b)
              h.getClouds()?.setBakeUse(b)
            } else h.setAtmosphereSteps(b ? steps : 12)
          }
          const time = () => {
            const t = performance.now()
            h.drawNow()
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
            return performance.now() - t
          }
          // warm up both (shader compiles)
          set(false); time(); time()
          set(true); time(); time()
          const a: number[] = [], b: number[] = []
          for (let i = 0; i < n; i++) {
            set(false); a.push(time())
            set(true); b.push(time())
          }
          set(true)
          h.gpuTimer.suspended = false
          const med = (x: number[]) => +x.sort((p, q) => p - q)[x.length >> 1].toFixed(1)
          return { what, before: med(a), after: med(b), ratio: +(med(a) / med(b)).toFixed(2) }
        },
        /**
         * GPU time per frame (EXT_disjoint_timer_query_webgl2, when available). `variant`:
         * 'current'; 'ab-bake' alternates procedural (before) and baked (after) surface and
         * clouds frame by frame; 'ab-atmo' 12 against `steps` atmosphere steps.
         */
        gpu: async (n = 16, variant = 'current', steps = 8) => {
          const gl = h.renderer.getContext() as WebGL2RenderingContext
          const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
          if (!ext) return null
          h.gpuTimer.suspended = true
          const nextFrame = () => new Promise((r) => requestAnimationFrame(r))
          const set = (b: boolean) => {
            if (variant === 'ab-bake') {
              h.getGlobe()?.setBakeUse(b)
              h.getClouds()?.setBakeUse(b)
            } else if (variant === 'ab-atmo') h.setAtmosphereSteps(b ? steps : 12)
          }
          const timed = async (fn: () => void) => {
            const q = gl.createQuery() as WebGLQuery
            gl.beginQuery(ext.TIME_ELAPSED_EXT, q)
            fn()
            gl.endQuery(ext.TIME_ELAPSED_EXT)
            await nextFrame()
            return q
          }
          const qa: WebGLQuery[] = [], qb: WebGLQuery[] = []
          const ab = variant !== 'current'
          for (let i = 0; i < 3; i++) { set(false); h.drawNow(); set(true); h.drawNow(); await nextFrame() }
          for (let i = 0; i < n; i++) {
            if (ab) {
              set(false)
              qa.push(await timed(h.drawNow))
            }
            set(true)
            qb.push(await timed(h.drawNow))
          }
          set(true)
          const read = async (qs: WebGLQuery[]) => {
            const out: number[] = []
            for (const q of qs) {
              for (let k = 0; k < 120 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await nextFrame()
              out.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6)
              gl.deleteQuery(q)
            }
            return out.sort((x, y) => x - y)
          }
          const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT)
          const b = await read(qb)
          h.gpuTimer.suspended = false
          const med = (x: number[]) => +x[x.length >> 1].toFixed(3)
          if (!ab) return { gpuMs: med(b), min: +b[0].toFixed(3), disjoint }
          const a = await read(qa)
          return { variant, beforeMs: med(a), afterMs: med(b), ratio: +(med(a) / med(b)).toFixed(2), disjoint }
        },
        /** Re-bake surface and clouds, timing every bake face on the GPU. */
        bakeGpu: async () => {
          const gl = h.renderer.getContext() as WebGL2RenderingContext
          const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number } | null
          const globe = h.getGlobe(), clouds = h.getClouds()
          if (!ext || !globe || !clouds) return null
          const nextFrame = () => new Promise((r) => requestAnimationFrame(r))
          const gs = globe.bakeInfo.size, cs = clouds.bakeInfo.size
          holdBake = true
          h.gpuTimer.suspended = true
          globe.setBakeSize(0); globe.setBakeSize(gs)
          clouds.setBakeSize(0); clouds.setBakeSize(cs)
          const qs: [string, WebGLQuery][] = []
          const t0 = performance.now()
          for (const [name, step] of [['surface', () => globe.bakeStep(h.renderer, 1)], ['clouds', () => clouds.bakeStep(h.renderer, 1)]] as const) {
            let more = true
            while (more) {
              const q = gl.createQuery() as WebGLQuery
              gl.beginQuery(ext.TIME_ELAPSED_EXT, q)
              more = step()
              gl.endQuery(ext.TIME_ELAPSED_EXT)
              qs.push([name, q])
              await nextFrame()
            }
          }
          const wall = performance.now() - t0
          holdBake = false
          const sum: Record<string, number> = { surface: 0, clouds: 0 }
          let maxFace = 0
          for (const [name, q] of qs) {
            for (let k = 0; k < 120 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await nextFrame()
            const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6
            sum[name] += ms
            maxFace = Math.max(maxFace, ms)
            gl.deleteQuery(q)
          }
          h.gpuTimer.suspended = false
          h.drawNow()
          return { surfaceGpuMs: +sum.surface.toFixed(1), cloudsGpuMs: +sum.clouds.toFixed(1), maxFaceGpuMs: +maxFace.toFixed(2), faces: qs.length, wallMs: +wall.toFixed(0), surfaceMB: +(globe.bakeInfo.bytes / 1048576).toFixed(1), cloudsMB: +(clouds.bakeInfo.bytes / 1048576).toFixed(1) }
        },
        /** Time each drawable alone (and none: clear + composite) to see where a frame goes. */
        parts: (n = 4) => {
          const gl = h.renderer.getContext()
          const px = new Uint8Array(4)
          const all: THREE.Object3D[] = []
          h.scene.traverse((o) => {
            const drawable = (o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine
            if (drawable && o.visible) all.push(o)
          })
          const time = () => {
            const t = performance.now()
            h.renderer.render(h.scene, h.camera)
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
            return performance.now() - t
          }
          const med = (x: number[]) => +x.sort((p, q) => p - q)[x.length >> 1].toFixed(1)
          const out: Record<string, number> = {}
          const run = (label: string, only: THREE.Object3D | null) => {
            for (const o of all) o.visible = only === null ? false : o === only
            time()
            const ts: number[] = []
            for (let i = 0; i < n; i++) ts.push(time())
            out[label] = med(ts)
          }
          run('none', null)
          all.forEach((o, i) => {
            const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined
            const tag = o.type + (o.renderOrder ? '@' + o.renderOrder : '') + (m && m.fragmentShader && m.fragmentShader.includes('uBake0') ? '(baked)' : '')
            run(i + ':' + tag, o)
          })
          for (const o of all) o.visible = true
          for (const o of all) o.visible = true
          const ts: number[] = []
          time()
          for (let i = 0; i < n; i++) ts.push(time())
          out.all = med(ts)
          return out
        },
        /** Noise calls per planet pixel (mean over the planet's pixels, and max). */
        noiseCount: () => {
          const globe = h.getGlobe()
          if (!globe) return null
          const r = h.renderer
          const size = r.getDrawingBufferSize(new THREE.Vector2())
          const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.FloatType, depthBuffer: true })
          const hidden: THREE.Object3D[] = []
          h.scene.traverse((o) => {
            const drawable = (o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine
            if (drawable && o !== globe.mesh && o.visible) {
              o.visible = false
              hidden.push(o)
            }
          })
          globe.setNoiseCount(true)
          const clear = r.getClearColor(new THREE.Color())
          const alpha = r.getClearAlpha()
          r.setClearColor(0x000000, 0)
          globe.update(h.camera)
          r.setRenderTarget(rt)
          r.render(h.scene, h.camera)
          r.setRenderTarget(null)
          const buf = new Float32Array(size.x * size.y * 4)
          r.readRenderTargetPixels(rt, 0, 0, size.x, size.y, buf)
          r.setClearColor(clear, alpha)
          globe.setNoiseCount(false)
          for (const o of hidden) o.visible = true
          rt.dispose()
          let n = 0, sum = 0, sumCells = 0, max = 0
          for (let i = 0; i < buf.length; i += 4) {
            if (buf[i + 3] < 0.5) continue
            n++
            sum += buf[i]
            sumCells += buf[i + 1]
            max = Math.max(max, buf[i])
          }
          h.drawNow()
          return { pixels: n, noisePerPixel: n ? +(sum / n).toFixed(2) : 0, voronoiPerPixel: n ? +(sumCells / n).toFixed(3) : 0, maxNoise: max, material: (globe.mesh.material as THREE.ShaderMaterial).fragmentShader.includes('uBake0') ? 'baked' : 'procedural' }
        },
      }
      ;(window as unknown as { __worldseed: typeof api }).__worldseed = api
    },
  }
}
