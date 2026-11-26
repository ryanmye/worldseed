// The web build as an installable, offline-capable app (PWA): a web app manifest, the icons in public/icons, and a
// service worker (build/sw-template.js) that precaches every file of the build. Build only (never in dev). The page
// registers the worker (src/platform/pwa.ts).
//
// Cache busting: the worker's cache is named after a hash of every precached file's path and bytes, so any change to
// the build gives a new sw.js (the browser then installs it next to the old one and switches over once no page uses
// the old one; the old cache is deleted on activation). Paths are relative to the worker's scope, so the same build
// works at any base (`/` locally, `/worldseed/` on GitHub Pages).
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

const ROOT = import.meta.dirname

/** Name, colours and icons of the installed app. */
export const MANIFEST = {
  name: 'worldseed',
  short_name: 'worldseed',
  description: 'A procedural planet and the history of the peoples on it.',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'any',
  background_color: '#05070d',
  theme_color: '#05070d',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
}

function publicFiles(dir: string, out: string[]) {
  const st = statSync(dir, { throwIfNoEntry: false })
  if (!st) return
  if (st.isDirectory()) for (const name of readdirSync(dir).sort()) publicFiles(join(dir, name), out)
  else out.push(dir)
}

/** Files the worker leaves to the network: source maps and documentation. */
const SKIP = /\.(map|md)$/

export function pwaPlugin(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'worldseed-pwa',
    apply: 'build',
    enforce: 'post',
    configResolved(c) {
      config = c
    },
    transformIndexHtml() {
      const base = config.base
      return [
        { tag: 'link', attrs: { rel: 'manifest', href: `${base}manifest.webmanifest` }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'theme-color', content: MANIFEST.theme_color }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: `${base}icons/apple-touch-icon.png` }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }, injectTo: 'head' },
      ]
    },
    generateBundle(_options, bundle) {
      const manifest = JSON.stringify(MANIFEST, null, 2) + '\n'
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest })
      const entries: { path: string; bytes: string | Uint8Array }[] = []
      for (const [fileName, out] of Object.entries(bundle)) {
        if (SKIP.test(fileName)) continue
        entries.push({ path: fileName, bytes: out.type === 'chunk' ? out.code : out.source })
      }
      entries.push({ path: 'manifest.webmanifest', bytes: manifest })
      if (config.publicDir) {
        const files: string[] = []
        publicFiles(config.publicDir, files)
        for (const f of files) {
          const path = relative(config.publicDir, f).split(sep).join('/')
          if (!SKIP.test(path) && !(path in bundle)) entries.push({ path, bytes: readFileSync(f) })
        }
      }
      entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      const h = createHash('sha256')
      for (const e of entries) {
        h.update(e.path)
        h.update('\0')
        h.update(e.bytes)
        h.update('\0')
      }
      const version = h.digest('hex').slice(0, 16)
      const template = readFileSync(join(ROOT, 'sw-template.js'), 'utf8')
      const source = template
        .replace('__WORLDSEED_SW_VERSION__', JSON.stringify(version))
        .replace('__WORLDSEED_SW_FILES__', JSON.stringify(entries.map((e) => e.path)))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}
