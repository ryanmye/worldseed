// Memory of a loaded page (seed 42, 2000 years, idle): RSS of each Chrome process by type (/proc),
// the perf readout (bake texture MB), the History's typed-array bytes on the main thread and
// three.js geometry/texture counts. Run: node memory-page.mjs
import { chromium } from 'playwright'
import { readFileSync, readdirSync } from 'node:fs'
const BASE = process.env.BASE ?? 'http://localhost:4173/'
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await page.goto(BASE + '?seed=42&perf=1&intro=0&quality=balanced&play=0&spin=0&nocache=1')
await page.waitForFunction(() => window.__worldseedHistory?.debug()?.history && window.__worldseed.bakeReady(), null, { timeout: 180000, polling: 500 })
await page.waitForTimeout(5000)
const info = await page.evaluate(() => {
  const h = window.__worldseedHistory.debug().history
  let bytes = 0
  const seen = new Set()
  const walk = (v, d) => { if (!v || typeof v !== 'object' || seen.has(v) || d > 6) return; seen.add(v); if (ArrayBuffer.isView(v)) { bytes += v.byteLength; return } for (const x of Object.values(v)) walk(x, d + 1) }
  walk(h, 0)
  const geo = new Set(); let geoBytes = 0
  const byObj = []
  const nm = (o) => { const n = []; for (let x = o; x && n.length < 3; x = x.parent) n.push(x.name || x.type); return n.join('<') }
  window.__worldseed.three().scene.traverse((o) => { const g = o.geometry; if (!g || geo.has(g)) return; geo.add(g); let b = 0; for (const a of [...Object.values(g.attributes), g.index].filter(Boolean)) b += a.array.byteLength; geoBytes += b; byObj.push([nm(o), +(b / 1e6).toFixed(1)]) })
  byObj.sort((a, b) => b[1] - a[1])
  return { historyTypedMB: +(bytes / 1e6).toFixed(1), sceneGeometryMB: +(geoBytes / 1e6).toFixed(1), topGeometries: byObj.slice(0, 12), readout: document.querySelector('.perf-readout, #perf, [class*=perf]')?.textContent ?? null, stats: window.__worldseed.stats().textures }
})
const heap = await cdp.send('Runtime.getHeapUsage')
const rss = {}
for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
    if (!/chrome/.test(cmd) || /^node/.test(cmd)) continue
    const type = (cmd.match(/--type=([a-z-]+)/)?.[1] ?? 'browser') + (cmd.match(/--utility-sub-type=([\w.]+)/) ? ':' + cmd.match(/--utility-sub-type=([\w.]+)/)[1] : '')
    const kb = +readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]
    rss[type] = (rss[type] ?? 0) + Math.round(kb / 1024)
  } catch {}
}
console.log(JSON.stringify({ ...info, mainJsHeapUsedMB: +(heap.usedSize / 1e6).toFixed(0), rssMBByProcessType: rss }, null, 1))
await browser.close()
