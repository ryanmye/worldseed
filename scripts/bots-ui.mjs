// Fun harness, driver (b): a UI-level bot in the real app (Playwright, system Chrome, the GL flags of
// /home/claude/plans/shotscripts/throne.mjs), playing as a sensible human would by docs/PLAYER_PRIMER.md:
//   setup  - open the seed at the seat's year paused; Sun -> Follow (S, then the Follow button: the realm is lit, never the
//            night side); Follow the story on (H); Factions (R), the top realm (most people) alive in that year, its capital
//            link (the camera flies onto the realm's land, not the ocean); "Take this throne".
//   play   - speed 16x (key 4) between cards; at each decision screen it reads the screen from the DOM into the same
//            CardModel shape the headless bots get (ui/seat/cardModel.ts) and asks the same persona (src/bots/personas.ts);
//            it clicks that option's card or the "Do nothing" button. Nothing else is read.
//   check  - after N cards it stops at the next decision screen, takes the address (seat=, o=) and the shown History's hash,
//            opens that address fresh in a new browser context and compares the hash at its first decision screen; and it runs
//            the headless driver (src/bots/headless.ts) on the same seat and persona and compares the card sequence and hash.
//
//   node --import ./scripts/css-register.mjs --experimental-strip-types --no-warnings scripts/bots-ui.mjs \
//     <base url, e.g. http://localhost:5199/> [--seed 42] [--from 700] [--persona cautious] [--cards 5] [--out dir] [--seat polity:2:700]
//   (PLAYWRIGHT_FROM: a folder whose node_modules has playwright, default /home/claude/plans/perf-scripts/; CHROME default
//    /usr/bin/google-chrome). Exit code 1 when an equivalence check fails.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { personaOf, rngOf } from '../src/bots/personas.ts'
import { runBot } from '../src/bots/headless.ts'
import { resolveRun } from '../src/bots/presets.ts'
import { hashAll } from '../src/sim/history/seat/hashing.ts'
import { decodeSeat } from '../src/contract.ts'

const require = createRequire(process.env.PLAYWRIGHT_FROM ?? '/home/claude/plans/perf-scripts/')
const { chromium } = require('playwright')
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const base = argv[0]
const seed = Number(arg('seed', '42')), from = Number(arg('from', '700')), personaSpec = arg('persona', 'cautious'), N = Number(arg('cards', '5'))
const out = arg('out', '/home/claude/shots/bots/')
mkdirSync(out, { recursive: true })
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: GL })
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a)
const T0 = Date.now()
const fails = []
const check = (ok, what) => { log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what) }
const run = resolveRun(arg('preset', 'realistic'))

// the same FNV walk as src/sim/history/seat/hashing.ts hashAll, in the page (the History shown)
const PAGE_HASH = () => {
  const enc = new TextEncoder()
  const fnv = (h, b) => { for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) } return h }
  const hv = (h, v) => {
    if (v === null || v === undefined) return fnv(h, enc.encode(String(v)))
    if (ArrayBuffer.isView(v)) { h = fnv(h, enc.encode(v.constructor.name)); return fnv(h, new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) }
    if (typeof v === 'number') return fnv(h, new Uint8Array(new Float64Array([v]).buffer))
    if (typeof v === 'string' || typeof v === 'boolean') return fnv(h, enc.encode(typeof v + String(v)))
    if (Array.isArray(v)) { h = fnv(h, enc.encode('[' + v.length)); for (const x of v) h = hv(h, x); return h }
    if (typeof v === 'object') { for (const k of Object.keys(v).sort()) { h = fnv(h, enc.encode(k)); h = hv(h, v[k]) } return h }
    return h
  }
  const hist = window.__worldseedHistory?.debug().history
  return hist ? { hash: (hv(0x811c9dc5, hist) >>> 0).toString(16), years: hist.years } : null
}

// the decision screen, read from the DOM into the CardModel shape (only what is drawn)
const READ_CARD = () => {
  const s = document.querySelector('.seat-screen:not(.hidden)')
  if (!s || !s.querySelector('.seat-opt')) return null
  const t = (el, q) => el.querySelector(q)?.textContent ?? ''
  const meter = s.querySelector('.seat-authority')
  const value = Number(meter?.getAttribute('aria-valuenow') ?? 100) / 100
  const cost = Number((t(s, '.seat-authority-note').match(/(\d+)/) ?? [0, 0])[1]) / 100
  const skipNote = t(s, '.seat-skip-note')
  const m = skipNote.match(/^They would choose: (.*?)\. ((?:A divisive|Routine).*)$/)
  return {
    d: -1, title: t(s, '.seat-banner-title'), sub: t(s, '.seat-banner-sub'), year: Number(t(s, '.seat-banner-sub').split(' ')[0]),
    situation: t(s, '.seat-situation-text'), authority: { value, cost, body: '', why: meter?.title ?? '' },
    options: [...s.querySelectorAll('.seat-opt')].map((b) => ({ option: Number(b.dataset.option), key: Number(b.dataset.key), label: t(b, '.seat-opt-label'), tag: t(b, '.seat-opt-tag'), tint: '', badge: b.querySelector('.seat-opt-badge')?.lastChild?.textContent ?? '', note: t(b, '.seat-opt-note'), court: b.dataset.court === '1', aria: b.getAttribute('aria-label') ?? '' })),
    defer: { option: 7, words: t(s, '.seat-skip-label'), pickLabel: m ? m[1] : '', hint: m ? m[2] : '', note: skipNote },
    place: -1,
  }
}

async function waitShown(page, ms = 600000) {
  for (let t = 0; t < ms; t += 500) { if (await page.evaluate(() => !!window.__worldseedHistory?.debug().history)) return true; await page.waitForTimeout(500) }
  return false
}
/** Waits for a decision screen (or the lost message); null on timeout. */
async function waitCard(page, ms = 900000) {
  for (let t = 0; t < ms; t += 400) {
    const c = await page.evaluate(READ_CARD)
    if (c) return c
    const lost = await page.evaluate(() => document.querySelector('.seat-msg:not(.hidden) .seat-msg-title')?.textContent === 'The seat is lost')
    if (lost) return 'lost'
    await page.waitForTimeout(400)
  }
  return null
}

// ---------- setup: as a sensible player ----------
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
const url0 = new URL(base)
url0.searchParams.set('seed', String(seed)); url0.searchParams.set('year', String(from)); url0.searchParams.set('play', '0'); url0.searchParams.set('perf', '1')
for (const [k, v] of Object.entries(run.url)) url0.searchParams.set(k, v)
await page.goto(url0.href)
check(await waitShown(page), 'the history is shown')
await page.waitForTimeout(1500)
await page.mouse.click(720, 450) // (focus the page for the keys; a click on the globe)
await page.keyboard.press('Escape')
// sun: Follow (whatever we look at is lit)
await page.keyboard.press('s')
await page.waitForTimeout(400)
const sunBtn = page.locator('.settings-pop .seg-btn', { hasText: /^Follow$/ }).first()
await sunBtn.click()
const sunOn = await sunBtn.evaluate((b) => b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true')
await page.keyboard.press('s')
check(sunOn, 'sun set to Follow (the view is always on the lit side)')
// factions: the top realm alive this year, framed, then its throne
let seatText = arg('seat')
const row = page.locator('.fp-row').first()
// R toggles the Factions panel (it may start open or collapsed): press until its list is visible
for (let k = 0; k < 3 && !(await row.isVisible().catch(() => false)); k++) { await page.keyboard.press('r'); await page.waitForTimeout(800) }
await row.scrollIntoViewIfNeeded()
await row.click()
await page.waitForTimeout(800)
const realm = await page.evaluate(() => document.querySelector('.fp-detail:not(.hidden) .fp-d-title, .fp-detail:not(.hidden)')?.textContent?.slice(0, 80) ?? '')
const capital = page.locator('.fp-detail:not(.hidden) .fp-link.sett').first()
if (await capital.count()) { await capital.click(); await page.waitForTimeout(3000) }
check((await capital.count()) > 0, `framed the realm's capital (${realm.split('×')[0].trim()})`)
// follow the story (H): the director takes the camera to the great events
await page.keyboard.press('h')
await page.waitForTimeout(500)
const follow = await page.evaluate(() => window.__worldseedStory?.state())
check(follow !== undefined && follow !== 0, `Follow the story on (director state ${follow})`)
await page.screenshot({ path: out + `setup-${seed}.png` })
const take = page.locator('.seat-take').first()
check((await take.count()) > 0, 'the realm is alive: "Take this throne" is offered')
await take.click()
const t1 = Date.now()
await page.keyboard.press('4') // (16x between cards)
await page.waitForTimeout(500)
if ((await page.locator('.tl-play').getAttribute('aria-label')) === 'Play') await page.locator('.tl-play').click() // (opened paused: play)

// ---------- play ----------
const { persona } = personaOf(personaSpec)
const rng = rngOf(seed * 7919 + 17)
const mem = { seen: [] }
const seen = []
let firstCardS = -1
for (let i = 0; i <= N; i++) {
  const c = await waitCard(page)
  if (c === null) { check(false, `card ${i + 1} came`); break }
  if (c === 'lost') { log('the seat is lost'); break }
  if (firstCardS < 0) firstCardS = (Date.now() - t1) / 1000
  if (i === N) {
    // stop here: the address and the History shown at this decision screen
    const u = new URL(page.url())
    seatText = u.searchParams.get('seat')
    // the History shown must be the pause's (its last year is the card's year); note how long the swap lags the card
    let h = await page.evaluate(PAGE_HASH)
    const lag0 = Date.now()
    while (h && h.years !== c.year && Date.now() - lag0 < 120000) { await page.waitForTimeout(500); h = await page.evaluate(PAGE_HASH) }
    log(`the History shown reached the pause ${((Date.now() - lag0) / 1000).toFixed(1)} s after the card (years ${h?.years}, card ${c.year})`)
    seen.push({ title: c.title, options: c.options.map((o) => o.label), stop: true })
    await page.screenshot({ path: out + `stop-${seed}.png` })
    var stopUrl = u, stopHash = h
    break
  }
  const dec = persona.choose(c, mem, rng)
  seen.push({ title: c.title, options: c.options.map((o) => o.label), picked: dec.option, why: dec.why })
  mem.seen.push({ year: c.year, title: c.title, situation: c.situation, picked: dec.option, deferred: dec.option === 7, label: c.options.find((o) => o.option === dec.option)?.label ?? c.defer.words, lever: dec.lever })
  log(`card ${i + 1} ${c.sub}: ${c.title} [${c.options.map((o) => o.label).join(' / ')}] -> ${dec.why}`)
  if (i === 0) await page.screenshot({ path: out + `card-${seed}.png` })
  if (dec.option === 7) await page.locator('.seat-screen:not(.hidden) .seat-skip').click()
  else await page.locator(`.seat-screen:not(.hidden) .seat-opt[data-option="${dec.option}"]`).click()
  await page.waitForTimeout(300)
}
log(`seat taken: ${new URL(page.url()).searchParams.get('seat')} (Follow the story plays the timeline on, so the year can pass the one opened)`)
// personas v5 (lane N4d): seated, Follow follows the seat's realm
await page.waitForTimeout(1500)
log(`following realm: ${JSON.stringify(await page.evaluate(() => window.__worldseedStory?.realm?.() ?? null))}`)
log(`first decision screen ${firstCardS.toFixed(0)} s after Take this throne; ${seen.length - 1} cards answered`)
await ctx.close()

// ---------- replay: the address, fresh ----------
let ok = true
if (stopUrl && stopHash) {
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p2 = await ctx2.newPage()
  const fresh = new URL(stopUrl.href)
  fresh.searchParams.delete('year'); fresh.searchParams.delete('play') // (a seat link: seed, lang, seat, o)
  await p2.goto(fresh.href)
  const c2 = await waitCard(p2)
  let h2 = c2 && c2 !== 'lost' ? await p2.evaluate(PAGE_HASH) : null
  for (let k = 0; k < 240 && h2 && c2 && h2.years !== c2.year; k++) { await p2.waitForTimeout(500); h2 = await p2.evaluate(PAGE_HASH) }
  check(!!h2 && h2.hash === stopHash.hash && h2.years === stopHash.years, `fresh replay of the bot's address equals its run (bot ${stopHash.hash} @${stopHash.years}, replay ${h2?.hash} @${h2?.years}; card "${c2?.title}")`)
  await ctx2.close()
  // ---------- the headless driver on the same seat: same cards, same History ----------
  const seat = decodeSeat(seatText)
  const r = await runBot({ seed, seat, persona: personaOf(personaSpec).persona, span: 100000, historyOptions: run.historyOptions, maxCards: seen.length - 1 })
  const hl = r.cards.map((c) => ({ title: c.model.title, options: c.model.options.map((o) => o.label), picked: c.decision.option }))
  const same = seen.slice(0, -1).every((x, i) => hl[i] && hl[i].title === x.title && hl[i].options.join('|') === x.options.join('|') && hl[i].picked === x.picked)
  check(same && hl.length === seen.length - 1, `headless driver shows the same ${hl.length} cards and makes the same choices`)
  check(hashAll(r.history) === stopHash.hash, `headless History at the stop equals the browser's (${hashAll(r.history)})`)
  writeFileSync(out + `run-${seed}-${personaSpec.replace(':', '_')}.json`, JSON.stringify({ url: stopUrl.href, hash: stopHash, browser: seen, headless: hl }, null, 1))
} else ok = false
log(`page errors: ${errs.length ? errs.join(' | ') : 'none'}`)
log(`runtime ${((Date.now() - T0) / 1000).toFixed(0)} s`)
await browser.close()
process.exit(fails.length || !ok ? 1 : 0)
