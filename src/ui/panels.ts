// Small panel helpers: remembered UI state (localStorage, every access guarded) and a
// drag handle that sets the width of a side column.

export function loadPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null // storage unavailable (private mode, blocked)
  }
}

export function savePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // not remembered; the change still applies to this page
  }
}

export function loadFlag(key: string, fallback: boolean): boolean {
  const v = loadPref(key)
  return v === '1' ? true : v === '0' ? false : fallback
}

export function saveFlag(key: string, on: boolean): void {
  savePref(key, on ? '1' : '0')
}

/**
 * A handle on the inner edge of `panel` that sets the CSS variable `cssVar` on `target`
 * (the width of its column) by dragging, or by the arrow keys when focused. The width is
 * remembered under `key`; `onChange` runs after every change.
 */
export function attachWidthHandle(panel: HTMLElement, opts: { side: 'left' | 'right'; target: HTMLElement; cssVar: string; key: string; min: number; max: number; initial: number; label: string; onChange?(): void }): void {
  const handle = document.createElement('div')
  handle.className = `width-handle ${opts.side}`
  handle.setAttribute('role', 'separator')
  handle.setAttribute('aria-orientation', 'vertical')
  handle.setAttribute('aria-label', opts.label)
  handle.tabIndex = 0
  handle.title = 'Drag to resize'
  panel.appendChild(handle)

  const clamp = (w: number) => Math.round(Math.min(Math.min(opts.max, window.innerWidth * 0.42), Math.max(opts.min, w)))
  let width = clamp(Number(loadPref(opts.key)) || opts.initial)
  const apply = (w: number, save: boolean) => {
    width = clamp(w)
    opts.target.style.setProperty(opts.cssVar, `${width}px`)
    handle.setAttribute('aria-valuenow', String(width))
    if (save) savePref(opts.key, String(width))
    opts.onChange?.()
  }
  apply(width, false)
  window.addEventListener('resize', () => apply(width, false))

  let startX = 0, startW = 0, dragging = false
  handle.addEventListener('pointerdown', (e) => {
    dragging = true
    startX = e.clientX
    startW = width
    handle.setPointerCapture(e.pointerId)
    handle.classList.add('active')
    e.preventDefault()
  })
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const dx = e.clientX - startX
    apply(startW + (opts.side === 'left' ? -dx : dx), false)
  })
  const end = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    handle.classList.remove('active')
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
    apply(width, true)
  }
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const grow = (e.key === 'ArrowLeft') === (opts.side === 'left')
    apply(width + (grow ? 16 : -16), true)
  })
}
