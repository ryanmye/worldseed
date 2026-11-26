// Main-thread profile of history playback (headless Chrome, small viewport so the software GPU is
// not the bottleneck): CPU profile (CDP Profiler) and allocation sampling (HeapProfiler) over a
// 10 s window, plus which scene objects re-upload vertex data (BufferAttribute.version changes,
// bytes per drawn frame, by object name / parent chain).
// Run: node profile-playback.mjs [query]   writes playback.cpuprofile, playback.heapprofile.json
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const BASE = process.env.BASE ?? 'http://localhost:4173/'
const q = process.argv[2] ?? 'seed=42&perf=1&intro=0&quality=balanced&spin=0'
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await page.goto(BASE + '?' + q)
await page.waitForFunction(() => window.__worldseedHistory?.debug()?.history && window.__worldseed.bakeReady(), null, { timeout: 180000, polling: 500 })
await page.waitForTimeout(2000)
// attribute uploads per object
await page.evaluate(() => {
  const { scene } = window.__worldseed.three()
  const seen = new Map()
  const acc = new Map()
  let frames = 0
  const name = (o) => { const n = []; for (let x = o; x && n.length < 4; x = x.parent) n.push(x.name || x.type); return n.join('<') }
  const tick = () => {
    frames++
    scene.traverse((o) => {
      const g = o.geometry
      if (!g) return
      const list = [...Object.values(g.attributes), ...(g.index ? [g.index] : [])]
      for (const a of list) {
        const v = a.version, prev = seen.get(a)
        seen.set(a, v)
        if (prev !== undefined && prev !== v) {
          const k = name(o) + ' [' + (o.material?.type ?? '') + ']'
          acc.set(k, (acc.get(k) ?? 0) + (a.array?.byteLength ?? 0))
        }
      }
    })
    if (window.__uploadsOn) requestAnimationFrame(tick)
  }
  window.__uploadsOn = true
  window.__uploads = () => ({ frames, top: [...acc].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, b]) => [k, +(b / frames / 1024).toFixed(1)]) })
  requestAnimationFrame(tick)
})
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
await cdp.send('HeapProfiler.enable')
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384 })
await cdp.send('Profiler.start')
const f0 = await page.evaluate(() => window.__worldseed.stats().frames)
await page.waitForTimeout(10000)
const f1 = await page.evaluate(() => window.__worldseed.stats().frames)
const { profile } = await cdp.send('Profiler.stop')
const { profile: heap } = await cdp.send('HeapProfiler.stopSampling')
const up = await page.evaluate(() => { window.__uploadsOn = false; return window.__uploads() })
writeFileSync('playback.cpuprofile', JSON.stringify(profile))
writeFileSync('playback.heapprofile.json', JSON.stringify(heap))
// allocation by function (self)
const agg = new Map()
const walk = (n) => { const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}:${n.callFrame.columnNumber + 1}`; agg.set(k, (agg.get(k) ?? 0) + n.selfSize); for (const c of n.children) walk(c) }
walk(heap.head)
const totalAlloc = [...agg.values()].reduce((a, b) => a + b, 0)
console.log(JSON.stringify({ q, framesDrawn: f1 - f0, sampledAllocMBin10s: +(totalAlloc / 1e6).toFixed(1), topAlloc: [...agg].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => [k, +(v / 1e6).toFixed(2)]), uploadsKBPerFrame: up }, null, 1))
const census = await page.evaluate(() => {
  const { scene } = window.__worldseed.three()
  const rows = []
  const name = (o) => { const n = []; for (let x = o; x && n.length < 3; x = x.parent) n.push(x.name || x.type); return n.join('<') }
  scene.traverseVisible((o) => {
    const g = o.geometry
    if (!g || !(o.isMesh || o.isLine || o.isPoints || o.isLineSegments)) return
    const idx = g.index ? g.index.count : (g.attributes.position?.count ?? 0)
    const inst = o.isInstancedMesh ? o.count : g.instanceCount ?? 1
    const range = Math.min(idx, g.drawRange.count)
    rows.push([name(o) + ' [' + (o.material?.type ?? '') + (o.material?.transparent ? ',transparent' : '') + ']', o.isMesh ? Math.round(range / 3) * (Number.isFinite(inst) ? inst : 1) : range])
  })
  return rows.sort((a, b) => b[1] - a[1]).slice(0, 15)
})
console.log(JSON.stringify({ visibleObjectsByPrimitives: census }))
await browser.close()
