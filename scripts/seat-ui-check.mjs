// seat mode: a browser check of the decision card (Playwright with the system Chrome; not part of vitest).
//
//   node scripts/seat-ui-check.mjs <url with seat=...> [desktop|phone] [own realm name]
//   (PLAYWRIGHT_FROM: a folder whose node_modules has playwright, default /home/claude/plans/perf-scripts/;
//    CHROME: the browser, default /usr/bin/google-chrome)
//
// Checks: (1) the card's subject never reads as the player's own realm (the name given); (2) a seat= URL jumps to the reign:
// the timeline never plays from year 0 (the year shown is >= the seat's year once the history is in) and the card comes
// quickly; (3) the card and its options are opaque; (4) on a phone every option and "Show me" are the card's own at their
// centre (not covered by the sheet's tab bar) and end above the bottom edge and the safe area. Exit code 1 on a failure.
import { createRequire } from 'node:module'
const require = createRequire(process.env.PLAYWRIGHT_FROM ?? '/home/claude/plans/perf-scripts/')
const { chromium, devices } = require('playwright')

const url = process.argv[2]
const mode = process.argv[3] || 'desktop'
const own = process.argv[4] || ''
const from = Number(new URL(url).searchParams.get('seat')?.split(':')[2] ?? 0)
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const ctx = mode === 'phone'
  ? await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent })
  : await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const fails = []
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what) }
const t0 = Date.now()
await page.goto(url)
// (2) from the first history shown, the year never sits below the seat's year
const years = []
const sampler = setInterval(() => { page.evaluate(() => Number(document.querySelector('.tl-slider')?.value ?? -1)).then((y) => { if (y > 0) years.push(y) }).catch(() => {}) }, 400)
let decision = false
try { await page.locator('.seat-card:not(.hidden) .seat-opt-note').first().waitFor({ timeout: 240000 }); decision = true } catch { /* no card */ }
clearInterval(sampler)
const secs = (Date.now() - t0) / 1000
check(decision, `a decision card shows (${secs.toFixed(0)} s)`)
if (decision) {
  await page.waitForTimeout(800)
  const below = years.filter((y) => y < from)
  check(below.length === 0, `the timeline jumped to the reign (years seen below ${from}: ${below.length ? below.slice(0, 5).join(', ') : 'none'})`)
  check(secs < 120, `the card came within 2 minutes of loading (${secs.toFixed(0)} s)`)
  const info = await page.evaluate(() => {
    const card = document.querySelector('.seat-card:not(.hidden)')
    const alpha = (el) => { const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/); const p = m ? m[1].split(',').map(Number) : [0, 0, 0, 0]; return p.length > 3 ? p[3] : 1 }
    const mine = (el) => { const r = el.getBoundingClientRect(); const x = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!x && card.contains(x) }
    const buttons = [...card.querySelectorAll('.seat-opt, .seat-showme')]
    return {
      title: card.querySelector('.seat-card-title')?.textContent ?? '',
      cardAlpha: alpha(card), optAlpha: Math.min(...[...card.querySelectorAll('.seat-opt')].map(alpha)),
      covered: buttons.filter((b) => !mine(b)).map((b) => b.textContent),
      bottom: Math.max(...buttons.map((b) => b.getBoundingClientRect().bottom)), vh: window.innerHeight,
    }
  })
  console.log(JSON.stringify(info))
  const subject = info.title.includes(': ') ? info.title.slice(info.title.indexOf(': ') + 2) : ''
  check(!own || subject !== own, `the card's subject "${subject}" is not the player's own realm "${own}"`)
  check(info.cardAlpha === 1 && info.optAlpha === 1, `the card and its options are opaque (${info.cardAlpha}, ${info.optAlpha})`)
  check(info.covered.length === 0, `nothing covers the options or Show me (${info.covered.join(' | ') || 'none'})`)
  check(info.bottom <= info.vh - 12, `the last button ends above the bottom edge (${info.bottom.toFixed(0)} of ${info.vh})`)
}
await browser.close()
if (fails.length) { console.log(`${fails.length} failure(s)`); process.exit(1) }
