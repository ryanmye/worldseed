// Fly into towns of several sizes at a year; record diorama stats, renderer calls/tris, layout/rebuild ms, screenshot.
import { chromium } from '/home/claude/plans/perf-scripts/node_modules/playwright/index.mjs'
const BASE = process.env.BASE ?? 'http://localhost:4174/'
const seed = process.env.SEED ?? '42'
const year = process.env.YEAR ?? '2000'
const q = process.env.Q ?? 'balanced'
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.error('pageerror', e.message))
await page.goto(`${BASE}?seed=${seed}&perf=1&intro=0&play=0&spin=0&year=${year}&quality=${q}`)
await page.waitForFunction(() => { const w = window; const h = w.__worldseedHistory?.debug()?.history; return !!h && w.__worldseed?.bakeReady() }, null, { timeout: 400000, polling: 1000 })
// pick towns by population at the shown year
const picks = await page.evaluate((Y) => {
  const h = window.__worldseedHistory.debug().history
  const N = h.settlements.length, s = Math.min(h.snapshotCount - 1, Math.floor(Y / h.snapshotInterval))
  const rows = []
  for (let i = 0; i < N; i++) { const p = h.population[s * N + i]; if (p > 0 && !h.settlements[i].outpost) rows.push([i, p]) }
  rows.sort((a, b) => a[1] - b[1])
  const near = (t) => rows.reduce((b, r) => (Math.abs(Math.log(r[1] / t)) < Math.abs(Math.log(b[1] / t)) ? r : b))
  return { n: rows.length, max: rows[rows.length - 1], picks: [near(300), near(3000), near(12000), near(40000), rows[rows.length - 1]], hist: [300, 1000, 3000, 10000, 30000, 100000].map((t) => rows.filter((r) => r[1] >= t).length) }
}, +year)
console.log(JSON.stringify(picks))
const out = []
const only = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null
for (const [id, pop] of picks.picks) {
  if (only && !only.includes(id)) continue
  await page.evaluate((id) => window.__worldseedCity.flyIn(id), id)
  const t0 = Date.now()
  await page.waitForFunction(() => { const s = window.__worldseedCity.state(); const a = window.__worldseedCity.aim(s.id); return s.state === 2 && a && !a.pending }, null, { timeout: +(process.env.SETTLE ?? 300000), polling: 500 }).catch(() => console.error('not settled', id))
  const settle = Date.now() - t0
  await page.evaluate((id) => window.__worldseedCity.sunOver(id, 35, 200), id)
  await page.waitForTimeout(1500)
  // measure frames: orbit turn repeatedly
  await page.evaluate(() => window.__worldseed.trace.start())
  for (let k = 0; k < 10; k++) { await page.evaluate(() => window.__worldseedCity.turn(0.05)); await page.waitForTimeout(200) }
  const recs = await page.evaluate(() => window.__worldseed.trace.stop())
  const st = await page.evaluate(() => ({ r: window.__worldseed.stats(), d: window.__dioramaStats, c: window.__worldseedCity.state() }))
  const drawn = recs.filter((r) => r.drawn)
  const avg = (k) => +(drawn.reduce((a, r) => a + (r[k] ?? 0), 0) / Math.max(1, drawn.length)).toFixed(2)
  const d = st.d
  const row = { id, pop: Math.round(pop), settleMs: settle, flight: st.c.flight, calls: st.r.calls, tris: st.r.triangles, drawn: drawn.length, frameMs: avg('ms'), tickMs: avg('tick'), renderMs: avg('render'), d: { inst: d.instances, batches: d.batches, tri: d.triangles, groundTri: d.groundTriangles, settl: d.settlements, vill: d.villages, villInst: d.villageInstances, trees: d.trees, rebuildMs: +d.rebuildMs.toFixed(1), lm: d.landmarks, lmPieces: d.landmarkPieces, walls: d.walls, works: d.works, shadows: d.shadows } }
  console.log(JSON.stringify(row))
  out.push(row)
  await page.screenshot({ path: `/home/claude/scratch-cityeras/meas/shot-${seed}-${year}-${id}.png` })
  await page.evaluate(() => window.__worldseedCity.flyOut())
  await page.waitForFunction(() => window.__worldseedCity.state().state === 0, null, { timeout: 120000, polling: 500 }).catch(() => {})
}
await browser.close()
