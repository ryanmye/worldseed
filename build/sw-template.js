// worldseed service worker (generated from build/sw-template.js by build/pwa.ts; web build only).
// Precaches the whole build on install, so the app opens and runs offline. Every path is relative to the scope
// (the site's base). The cache is named after a hash of the build: a new build is a new worker with a new cache,
// which takes over once no page runs the old build (no skipWaiting: a running page keeps the files it started
// with), and then deletes the old caches.
const VERSION = __WORLDSEED_SW_VERSION__
const FILES = __WORLDSEED_SW_FILES__
const CACHE = `worldseed-${VERSION}`
const scope = new URL(self.registration.scope)
const url = (path) => new URL(path, scope).href
const INDEX = url('index.html')

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([...FILES.map(url), url('./')].filter((u, i, a) => a.indexOf(u) === i))),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('worldseed-') && k !== CACHE).map((k) => caches.delete(k)))),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const u = new URL(req.url)
  if (u.origin !== scope.origin || !u.href.startsWith(scope.href)) return
  if (req.mode === 'navigate') {
    // the page: the network first (a new build shows as soon as it is online), the cached page when offline;
    // the query (seed=, o=, ...) only matters to the script, so any navigation in scope gets index.html
    event.respondWith(
      fetch(req).catch(() => caches.open(CACHE).then((c) => c.match(INDEX).then((r) => r ?? c.match(url('./'))).then((r) => r ?? Response.error()))),
    )
    return
  }
  // build files: hashed names never change, so the cache first; anything else falls through to the network
  event.respondWith(caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: true }).then((r) => r ?? fetch(req))))
})
