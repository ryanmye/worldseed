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

// ---------- the right column's accordion ----------
// At most maxOpenPanels() of the right column's list panels (Peoples, Factions, Goods, Faiths, Sickness, Travel, Ideas,
// Cities, Species; not the Chronicle, which keeps its own minimum under them) are open at once: opening one more closes
// the one opened longest ago. The order they were opened in is remembered (with each panel's own collapsed flag).

const OPEN_ORDER_KEY = 'worldseed.panels.openOrder'
interface AccordionPanel { root: HTMLElement; isOpen(): boolean; collapse(): void }
const accordion = new Map<string, AccordionPanel>()
let openOrder: string[] = (loadPref(OPEN_ORDER_KEY) ?? '').split(',').filter((n) => n.length > 0)

/** Open panels allowed at once: two in a window under 1000 px tall, three in a taller one. */
export const maxOpenPanels = () => (window.innerHeight >= 1000 ? 3 : 2)

const shownOpen = (n: string) => {
  const p = accordion.get(n)
  return !!p && p.isOpen() && !p.root.classList.contains('hidden') && !p.root.hidden
}

/** Closes the panels opened longest ago (never `keep`) until no more than maxOpenPanels() shown panels are open. */
function enforceOpenLimit(keep: string | null) {
  // panels open but not in the remembered order count as the oldest
  const open = [...accordion.keys()].filter((n) => shownOpen(n) && !openOrder.includes(n)).concat(openOrder.filter(shownOpen))
  for (let k = 0; open.length - k > maxOpenPanels() && k < open.length; k++) {
    if (open[k] === keep) continue
    accordion.get(open[k])!.collapse()
  }
}

/**
 * After `keep` was opened: while the column still overflows (a short window, the layer list open), close the other
 * panels opened longest ago, down to `keep` and one more (measured on the next frame, once the opened body is filled).
 */
function fitColumn(keep: string) {
  const col = accordion.get(keep)?.root.parentElement
  if (!col) return
  const open = [...accordion.keys()].filter((n) => shownOpen(n) && !openOrder.includes(n)).concat(openOrder.filter(shownOpen))
  let n = open.length
  for (let k = 0; k < open.length && n > 2 && col.scrollHeight > col.clientHeight + 1; k++) {
    if (open[k] === keep) continue
    accordion.get(open[k])!.collapse()
    n--
  }
}

/** A right-column panel joins the accordion: `isOpen` its state, `collapse` closes it (through its own toggle, which then calls panelToggled). */
export function registerPanel(name: string, root: HTMLElement, isOpen: () => boolean, collapse: () => void): void {
  accordion.set(name, { root, isOpen, collapse })
  // (after the panels being built now are all built: a remembered state may hold more open than the limit)
  queueMicrotask(() => enforceOpenLimit(null))
}

/** A panel was opened or closed (by the user, a shortcut or a link): remember the order, and close the oldest one over the limit. */
export function panelToggled(name: string, open: boolean): void {
  openOrder = openOrder.filter((n) => n !== name)
  if (open) openOrder.push(name)
  savePref(OPEN_ORDER_KEY, openOrder.join(','))
  if (open) {
    enforceOpenLimit(name)
    requestAnimationFrame(() => requestAnimationFrame(() => fitColumn(name)))
  }
}

/**
 * Elements under `container` matching `selector` that are cut short (an ellipsis) get their whole text as a tooltip when
 * the pointer comes over them (written then, not as their text changes; an element's own title is left alone).
 */
export function titleWhenCut(container: HTMLElement, selector: string): void {
  container.addEventListener('pointerover', (e) => {
    const t = (e.target as Element | null)?.closest?.(selector) as HTMLElement | null
    if (!t || (t.title && t.dataset.cutTitle !== '1')) return
    const cut = t.scrollWidth > t.clientWidth + 1
    t.title = cut ? (t.textContent ?? '') : ''
    t.dataset.cutTitle = '1'
  })
}
