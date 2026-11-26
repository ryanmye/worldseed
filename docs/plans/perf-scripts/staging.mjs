// Worker simulation time and main-thread staging time of a fresh history in the browser, with the
// page otherwise idle (play=0, spin=0) so the software GPU competes as little as possible. Prints
// the app's own console timing lines (worker.ts, historyView.ts) in full.
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://localhost:4173/'
const q = process.argv[2] ?? 'seed=42&perf=1&intro=0&quality=balanced&spin=0&play=0&nocache=1'
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 360, height: 240 } })
const page = await ctx.newPage()
let done
const shown = new Promise((r) => (done = r))
page.on('console', (m) => { const t = m.text(); if (/generated|history|cache/.test(t)) console.log(t); if (/history shown/.test(t)) done() })
await page.goto(BASE + '?' + q)
await Promise.race([shown, new Promise((r) => setTimeout(r, 240000))])
await page.waitForTimeout(3000)
await browser.close()
