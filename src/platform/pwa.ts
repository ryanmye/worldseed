// The web build as an installed app (build/pwa.ts makes the manifest and the service worker): registers the worker
// and asks once, on the first run, for persistent storage. Production builds only: never in dev (vite serves no
// sw.js) or with perf=1 (measurements without a worker precaching in the background); sw=0 unregisters it.

const PERSIST_ASKED_KEY = 'worldseed.storage.persistAsked'

/** Registers the service worker once the page has loaded and gone quiet. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const params = new URLSearchParams(window.location.search)
  if (params.get('sw') === '0') {
    void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister()))
    return
  }
  if (params.get('perf') === '1') return
  const go = () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err: unknown) => console.warn('worldseed: service worker', err))
  }
  // after load and a pause, so precaching does not compete with the first world's generation
  const later = () => window.setTimeout(go, 5000)
  if (document.readyState === 'complete') later()
  else window.addEventListener('load', later, { once: true })
}

/** navigator.storage.persist(), with false where the API is missing or throws. */
export async function persistStorage(): Promise<boolean> {
  try {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined
    if (!s?.persist) return false
    if (await s.persisted?.()) return true
    return await s.persist()
  } catch {
    return false
  }
}

export async function storagePersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false
  } catch {
    return false
  }
}

/** On the first run only (remembered in localStorage): ask for persistent storage. Chromium and Safari decide
 * without a prompt; Firefox may show one. Resolves to the answer, or null when it was asked before. */
export async function requestPersistenceOnce(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocalStorage()): Promise<boolean | null> {
  if (!storage || storage.getItem(PERSIST_ASKED_KEY)) return null
  try {
    storage.setItem(PERSIST_ASKED_KEY, String(Date.now()))
  } catch {
    return null // storage full or blocked: do not ask on every start
  }
  return persistStorage()
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}
