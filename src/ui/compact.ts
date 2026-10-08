// The phone layout. `compact` on <html> while the window is phone-sized: narrower than COMPACT_MAX_W, or a short
// landscape window (a phone on its side) up to COMPACT_LANDSCAPE_MAX_W wide; `compact-landscape` with it when the
// window is wider than tall. Wider windows (tablets included) keep the desktop layout untouched: every compact rule
// in the CSS hangs off html.compact (compact.css), and the scripts ask isCompact().
//
// In the compact layout (overlay.ts, sheet.ts): the top bar holds the seed, Random, Globe / Map and a menu button
// (the rest of the bar and the view and layers panel open from it as a sheet); the right column becomes a bottom
// sheet with the panels as tabs (on its side: a column at the right); the inspector is one of its tabs; the timeline
// runs full width above the sheet's handle; popovers are full-screen sheets.

/** Narrower than this: the phone layout. */
export const COMPACT_MAX_W = 700
/** A window this short and no wider than COMPACT_LANDSCAPE_MAX_W (a phone on its side): the phone layout too. */
export const COMPACT_MAX_H = 500
export const COMPACT_LANDSCAPE_MAX_W = 1000

const html = document.documentElement
const listeners = new Set<(compact: boolean) => void>()

/** Whether the current window gets the phone layout (computed from its size, not the class). */
export function wantsCompact(): boolean {
  const w = window.innerWidth, h = window.innerHeight
  return w < COMPACT_MAX_W || (h < COMPACT_MAX_H && w <= COMPACT_LANDSCAPE_MAX_W)
}

/** The phone layout is on (html.compact). */
export function isCompact(): boolean {
  return html.classList.contains('compact')
}

/** The phone layout on its side (html.compact-landscape: the sheet is a column at the right). */
export function isCompactLandscape(): boolean {
  return html.classList.contains('compact-landscape')
}

/** Notified when the layout switches between phone and desktop, or the phone turns (after the classes changed). */
export function onCompactChange(cb: (compact: boolean) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

let shown = ''
function sync() {
  const compact = wantsCompact()
  const landscape = compact && window.innerWidth > window.innerHeight
  const key = `${compact}${landscape}`
  if (key === shown) return
  shown = key
  html.classList.toggle('compact', compact)
  html.classList.toggle('compact-landscape', landscape)
  for (const cb of listeners) cb(compact)
}
sync()
// (registered first, as this module loads before the overlay: the classes are current when its resize handlers run)
window.addEventListener('resize', sync)
