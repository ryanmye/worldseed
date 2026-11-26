// Does the initial 0->2000 animation trigger a background extension to 2500 years (worker CPU,
// a cache write) even though playback stops at 2000? Loads the default link, samples the history
// length, the extension in flight and Chrome CPU every 10 s for up to 200 s.
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://localhost:4173/'
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 360, height: 240 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (/cache|generated|history/.test(m.text())) console.log('console:', m.text().slice(0, 140)) })
await page.goto(BASE + '?seed=42&perf=1&intro=0&quality=balanced&spin=0&nocache=1')
for (let t = 0; t < 200; t += 10) {
  await page.waitForTimeout(10000)
  const s = await page.evaluate(() => ({ years: window.__worldseedHistory?.years?.(), extending: window.__worldseedHistory?.extending?.(), year: new URL(location.href).searchParams.get('year'), playing: !!document.querySelector('[aria-pressed=true]'), frames: window.__worldseed?.stats().frames }))
  console.log(t + 10, JSON.stringify(s))
}
await browser.close()
