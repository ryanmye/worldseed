// The platform the page runs on, behind one small typed API. Today only the browser implementation exists; a native
// shell (e.g. a WKWebView app) can later replace any part with setPlatformBackend(), and the rest of the app never
// asks which one it runs on:
//
//   platform.storage.persist()       ask that the origin's storage (history cache, saves) is not evicted
//   platform.files.exportFile(...)   a file to the user: the share sheet where the Web Share API takes files on a
//                                    touch device, else a download
//   platform.files.importFile(...)   a file from the user (file input)
//   platform.files.share(...)        share text or a link (Web Share API); false where unavailable
//   platform.power                   'normal' | 'saver'; a change is handed to window.__worldseed.setPowerMode when
//                                    the render code provides it (guarded: a no-op while it does not)
//
// startPlatform() runs once from main.ts: the service worker and the first-run storage request (pwa.ts).

import { persistStorage, registerServiceWorker, requestPersistenceOnce, storagePersisted } from './pwa.ts'

export type PowerMode = 'normal' | 'saver'
export type ExportResult = 'saved' | 'cancelled' | 'failed'

export interface ExportRequest {
  /** File name with extension, e.g. 'world-42.worldseed'. */
  name: string
  text: string
  mime?: string
}

export interface ImportedFile {
  name: string
  text: string
}

export interface ShareRequest {
  title?: string
  text?: string
  url?: string
}

/** What a platform implements (the browser below; a native shell may override any part). */
export interface PlatformBackend {
  kind: string
  persist(): Promise<boolean>
  persisted(): Promise<boolean>
  exportFile(req: ExportRequest): Promise<ExportResult>
  /** The chosen file's name and text, or null when cancelled. `extensions` without dots. */
  importFile(extensions: string[]): Promise<ImportedFile | null>
  /** True when the share went out (or the user dismissed the sheet), false where sharing is unavailable. */
  share(req: ShareRequest): Promise<boolean>
}

// ---------- the browser ----------

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

async function webExport(req: ExportRequest): Promise<ExportResult> {
  const mime = req.mime ?? 'application/octet-stream'
  try {
    const blob = new Blob([req.text], { type: mime })
    // phones and tablets: the share sheet (iOS Safari has no download folder in reach); feature-tested
    if (navigator.maxTouchPoints > 0 && typeof navigator.canShare === 'function') {
      const file = new File([blob], req.name, { type: mime })
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: req.name })
          return 'saved'
        } catch (err) {
          if (isAbort(err)) return 'cancelled'
          // anything else: fall back to a download
        }
      }
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = req.name
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return 'saved'
  } catch (err) {
    console.warn('worldseed: export', err)
    return 'failed'
  }
}

function webImport(extensions: string[]): Promise<ImportedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = [...extensions.map((x) => `.${x}`), 'application/json'].join(',')
    input.style.display = 'none'
    let done = false
    const finish = (v: ImportedFile | null) => {
      if (done) return
      done = true
      input.remove()
      resolve(v)
    }
    input.addEventListener('change', () => {
      const f = input.files?.[0]
      if (!f) return finish(null)
      f.text().then((text) => finish({ name: f.name, text }), () => finish(null))
    })
    input.addEventListener('cancel', () => finish(null))
    document.body.appendChild(input)
    input.click()
  })
}

async function webShare(req: ShareRequest): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false
  if (typeof navigator.canShare === 'function' && !navigator.canShare(req)) return false
  try {
    await navigator.share(req)
    return true
  } catch (err) {
    return isAbort(err)
  }
}

export const webBackend: PlatformBackend = {
  kind: 'web',
  persist: persistStorage,
  persisted: storagePersisted,
  exportFile: webExport,
  importFile: webImport,
  share: webShare,
}

let backend: PlatformBackend = webBackend

/** Replaces parts of the platform (a native shell); the parts left out stay the browser's. */
export function setPlatformBackend(parts: Partial<PlatformBackend>): void {
  backend = { ...backend, ...parts }
}

// ---------- power mode ----------

const powerListeners = new Set<(mode: PowerMode) => void>()
let powerMode: PowerMode = 'normal'

interface PowerHook {
  setPowerMode?(mode: PowerMode): void
}

/** Hands the power mode to the render code's hook (window.__worldseed.setPowerMode); false while it is absent. */
export function applyPowerMode(mode: PowerMode): boolean {
  const hook = (globalThis as unknown as { __worldseed?: PowerHook }).__worldseed
  if (typeof hook?.setPowerMode !== 'function') return false
  try {
    hook.setPowerMode(mode)
    return true
  } catch (err) {
    console.warn('worldseed: setPowerMode', err)
    return false
  }
}

// ---------- the platform ----------

export const platform = {
  get kind(): string {
    return backend.kind
  },
  storage: {
    persist: (): Promise<boolean> => backend.persist(),
    persisted: (): Promise<boolean> => backend.persisted(),
  },
  files: {
    exportFile: (req: ExportRequest): Promise<ExportResult> => backend.exportFile(req),
    importFile: (extensions: string[]): Promise<ImportedFile | null> => backend.importFile(extensions),
    share: (req: ShareRequest): Promise<boolean> => backend.share(req),
  },
  power: {
    mode: (): PowerMode => powerMode,
    /**
     * Sets the mode (a native shell's Low Power Mode or thermal state; a future web heuristic) and hands it to the
     * render hook. The hook may be installed after startup, so a few retries follow while the mode holds.
     */
    set(mode: PowerMode): void {
      if (mode === powerMode) return
      powerMode = mode
      for (const cb of powerListeners) cb(mode)
      let tries = 0
      const push = () => {
        if (powerMode !== mode || applyPowerMode(mode) || ++tries >= 5) return
        globalThis.setTimeout(push, 2000)
      }
      push()
    },
    onChange(cb: (mode: PowerMode) => void): () => void {
      powerListeners.add(cb)
      return () => powerListeners.delete(cb)
    },
  },
}

// ---------- start ----------

let started = false

/** Once, from main.ts: the PWA service worker and the first-run storage request. */
export function startPlatform(): void {
  if (started) return
  started = true
  registerServiceWorker()
  void requestPersistenceOnce()
}
