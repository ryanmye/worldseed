// Render-loop measurements in headless Chrome (software GL: GPU times are meaningless, frame counts,
// main-thread JS time and process CPU are not). Serves nothing itself: point it at a running
// `vite preview` (BASE, default http://localhost:4173/). For each scenario: load, wait for the
// history and the bakes, settle 3 s, then measure a 10 s window: frames drawn (perf=1 stats),
// main-thread task/script ms (CDP Performance.getMetrics), per-frame trace sums, CPU seconds of all
// Chrome processes (/proc, includes the GPU process and the worker), JS heap.
// SMALL=1: a 360x240 CSS px, 1x viewport, so the software GPU keeps up and the frame counts show the
// loop's own caps (not the GPU's limit).
// Run: node bench-render.mjs [scenario...]   (OUT=path.json writes results)
import { chromium, devices } from 'playwright'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:4173/'
const WINDOW_MS = +(process.env.WINDOW_MS ?? 10000)
const scenarios = {
  // what a visitor gets from a shared link: spinning globe, history playing
  default: { q: 'seed=42&perf=1&intro=0&quality=balanced' },
  paused_spin: { q: 'seed=42&perf=1&intro=0&quality=balanced&play=0' },
  idle: { q: 'seed=42&perf=1&intro=0&quality=balanced&play=0&spin=0' },
  playing_nospin: { q: 'seed=42&perf=1&intro=0&quality=balanced&spin=0' },
  map_playing: { q: 'seed=42&perf=1&intro=0&quality=balanced&map=1' },
  landing: { q: 'perf=1&intro=1' },
  high_paused_spin: { q: 'seed=42&perf=1&intro=0&play=0&quality=high' },
  phone_default: { q: 'seed=42&perf=1&intro=0&quality=phone', phone: true },
  phone_idle: { q: 'seed=42&perf=1&intro=0&quality=phone&play=0&spin=0', phone: true },
  high_idle: { q: 'seed=42&perf=1&intro=0&play=0&spin=0&quality=high' },
  hidden_tab: { q: 'seed=42&perf=1&intro=0&quality=balanced', hide: true },
}
const pick = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios)

function chromeCpuSeconds() {
  const hz = 100
  let t = 0
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      if (!/chrome/.test(cmd) || /node/.test(cmd.split('\0')[0])) continue
      const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')
      t += (+f[11] + +f[12]) / hz
    } catch {}
  }
  return t
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
const results = []
for (const name of pick) {
  const sc = scenarios[name]
  const small = process.env.SMALL ? { viewport: { width: 360, height: 240 }, deviceScaleFactor: 1 } : {}
  const ctx = await browser.newContext(sc.phone ? { ...devices['iPhone 13'], deviceScaleFactor: 3, ...small } : process.env.SMALL ? small : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error(name, 'pageerror', e.message))
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  const t0 = Date.now()
  await page.goto(BASE + '?' + sc.q + '&nocache=1')
  // ready: history shown and the bakes done (or 90 s)
  await page.waitForFunction(() => {
    const w = window
    if (!w.__worldseed) return false
    if (location.search.includes('intro=1')) return true
    const h = w.__worldseedHistory?.debug()?.history
    return !!h && w.__worldseed.bakeReady()
  }, null, { timeout: 180000, polling: 500 }).catch(() => console.error(name, 'not ready in time'))
  const readyMs = Date.now() - t0
  if (sc.hide) await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.waitForTimeout(3000)
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]))
  const s0 = await page.evaluate(() => window.__worldseed.stats().frames)
  const m0 = await m()
  const c0 = chromeCpuSeconds()
  await page.evaluate(() => window.__worldseed.trace.start())
  await page.waitForTimeout(WINDOW_MS)
  const recs = await page.evaluate(() => window.__worldseed.trace.stop())
  const c1 = chromeCpuSeconds()
  const m1 = await m()
  const s1 = await page.evaluate(() => window.__worldseed.stats().frames)
  const st = await page.evaluate(() => ({ ...window.__worldseed.stats(), globeBake: undefined, globeDetail: undefined, cloudBake: undefined, years: window.__worldseedHistory?.years?.(), extending: window.__worldseedHistory?.extending?.(), device: window.__worldseedDevice?.() }))
  const drawn = recs.filter((r) => r.drawn)
  const sum = {}
  for (const r of recs) for (const [k, v] of Object.entries(r)) if (!['ts', 't', 'pr', 'drawn', 'calls', 'tris', 'gpu'].includes(k)) sum[k] = (sum[k] ?? 0) + v
  const per = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, +(v / Math.max(1, drawn.length)).toFixed(2)]))
  const sorted = drawn.map((r) => r.ms).sort((a, b) => a - b)
  const res = {
    name, readyMs, framesDrawn: s1 - s0, animationFrames: recs.length,
    mainTaskMs: Math.round((m1.TaskDuration - m0.TaskDuration) * 1000), mainScriptMs: Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000),
    chromeCpuS: +(c1 - c0).toFixed(2), jsHeapMB: +(m1.JSHeapUsedSize / 1e6).toFixed(0),
    frameMsMedian: sorted.length ? +sorted[sorted.length >> 1].toFixed(2) : 0, frameMsP95: sorted.length ? +sorted[Math.floor(sorted.length * 0.95)].toFixed(2) : 0,
    perDrawnFrame: per, calls: st.calls, tris: st.triangles, textures: st.textures, geometries: st.geometries, pixelRatio: st.pixelRatio, quality: st.quality, years: st.years, extending: st.extending,
  }
  results.push(res)
  console.log(JSON.stringify(res))
  await ctx.close()
}
await browser.close()
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(results, null, 1))
