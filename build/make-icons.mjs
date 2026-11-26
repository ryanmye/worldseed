// Renders public/icons/icon.svg to the PNG icons of the PWA (public/icons). Run by hand after changing the SVG; the PNGs are
// committed, so builds never need it. Needs Playwright and a Chrome:
//   PLAYWRIGHT=/path/to/node_modules/playwright CHROME=/usr/bin/google-chrome node build/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright')
const svg = readFileSync(join(ROOT, 'public/icons/icon.svg'), 'utf8')
const PWA = join(ROOT, 'public/icons')
const outputs = [
  [join(PWA, 'icon-192.png'), 192],
  [join(PWA, 'icon-512.png'), 512],
  [join(PWA, 'icon-maskable-512.png'), 512],
  [join(PWA, 'apple-touch-icon.png'), 180],
]
const browser = await chromium.launch({ executablePath: process.env.CHROME })
const page = await browser.newPage()
for (const [file, size] of outputs) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<style>html,body{margin:0;background:#05070d}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
  writeFileSync(file, await page.screenshot({ type: 'png', omitBackground: false }))
  console.log(file, size)
}
await browser.close()
