// Smoke test of the web build in headless Chrome, served at /worldseed/ like GitHub Pages: the module worker starts,
// a world and a history are made, no console errors; then the service worker takes control, the manifest loads, and
// the page reloads and makes a world offline with nothing fetched from the server.
// Needs Playwright and a Chrome (not dependencies of the project):
//   npx vite build --base=/worldseed/ --outDir /tmp/dist-pages
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs CHROME=/usr/bin/google-chrome \
//     node build/verify-pwa.mjs /tmp/dist-pages
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const [dir = 'dist'] = process.argv.slice(2)
const mode = 'web'
const PREFIX = '/worldseed/'
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
}
const served = []
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (!path.startsWith(PREFIX)) return res.writeHead(404).end()
  let rel = normalize(path.slice(PREFIX.length))
  if (rel.startsWith('..')) return res.writeHead(403).end()
  if (rel === '.' || rel.endsWith('/')) rel = join(rel, 'index.html')
  const file = join(dir, rel)
  try {
    if (!(await stat(file)).isFile()) throw new Error()
    const body = await readFile(file)
    served.push(rel)
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://localhost:${server.address().port}`
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright')
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
const page = await context.newPage()
const errors = []
const logs = []
page.on('console', (m) => {
  logs.push(`${m.type()}: ${m.text()}`)
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e)))
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`))

async function runWorld(label) {
  const t0 = Date.now()
  const history = page.waitForEvent('console', { predicate: (m) => m.text().startsWith('history:'), timeout: 240_000 })
  await page.goto(`${origin}${PREFIX}?seed=42&years=500&intro=0`)
  const msg = await history
  const workers = page.workers().map((w) => w.url())
  console.log(`${label}: ${msg.text()} after ${((Date.now() - t0) / 1000).toFixed(1)} s; workers ${JSON.stringify(workers)}`)
  if (workers.length === 0) errors.push(`${label}: no worker`)
}

let ok = true
try {
  await runWorld(`${mode} online`)
  const secure = await page.evaluate(() => window.isSecureContext)
  console.log(`secure context: ${secure}`)
  if (mode === 'web') {
    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      return { scope: reg.scope, active: reg.active?.state }
    })
    console.log(`service worker: ${JSON.stringify(sw)}`)
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys()
      const c = await caches.open(keys[0])
      return { keys, entries: (await c.keys()).length }
    })
    console.log(`cache: ${JSON.stringify(cached)}`)
    const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json())
    console.log(`manifest: ${manifest.name}, ${manifest.icons.length} icons, start_url ${manifest.start_url}`)
    await context.setOffline(true)
    const before = served.length
    await runWorld('web offline')
    console.log(`files served by the server while offline: ${served.length - before}`)
    await context.setOffline(false)
  }
} catch (e) {
  ok = false
  console.log('FAILED:', e.message)
  console.log(logs.slice(-20).join('\n'))
}
await browser.close()
server.close()
const real = errors.filter((e) => !/favicon/.test(e))
console.log(real.length ? `console errors:\n${real.join('\n')}` : 'no console errors')
process.exit(ok && real.length === 0 ? 0 : 1)
