// typology: does the label font draw a tier-2 letter (language-typology-scripts.md §4.7)? document.fonts.check() cannot say (it
// "does not check for individual glyph coverage", MDN), so each letter is drawn at 24 px on an offscreen canvas and its alpha
// signature compared with a never-assigned code point's (the tofu box) and with its base letter alone (a dropped diacritic):
// either match marks it unsupported, and the romanizer takes the tradition's fallback. Once per session and font stack, kept in
// localStorage by user agent and font. Display only: History never depends on it.

export interface ProbeCanvas {
  getContext(kind: '2d'): {
    font: string
    textBaseline: string
    fillStyle: string
    clearRect(x: number, y: number, w: number, h: number): void
    fillText(s: string, x: number, y: number): void
    getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> }
  } | null
}
export interface ProbeStore { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** A probe over `font` (a CSS font stack) on `canvas`: supported(ch) is true when the font draws ch as itself. */
export function createGlyphProbe(canvas: ProbeCanvas, font: string, store?: ProbeStore, ua = ''): (ch: string) => boolean {
  const key = `glyphProbe|${ua}|${font}`
  let known: Record<string, boolean> = {}
  try { known = JSON.parse(store?.getItem(key) ?? '{}') as Record<string, boolean> } catch { known = {} }
  const ctx = canvas.getContext('2d')
  const sig = (s: string): string => {
    if (!ctx) return ''
    ctx.clearRect(0, 0, 24, 24)
    ctx.font = `24px ${font}`
    ctx.textBaseline = 'top'
    ctx.fillStyle = '#000'
    ctx.fillText(s, 0, 0)
    const d = ctx.getImageData(0, 0, 24, 24).data
    let h = 2166136261
    for (let i = 3; i < d.length; i += 4) h = Math.imul(h ^ (d[i] > 64 ? 1 : 0), 16777619)
    return String(h >>> 0)
  }
  const tofu = sig('͸')
  let dirty = false
  return (ch: string): boolean => {
    if (ch in known) return known[ch]
    let ok = true
    if (ctx) {
      const s = sig(ch)
      const base = ch.normalize('NFD')[0]
      ok = s !== tofu && (base === ch || s !== sig(base))
    }
    known[ch] = ok
    if (!dirty) { dirty = true; queueMicrotask(() => { dirty = false; try { store?.setItem(key, JSON.stringify(known)) } catch { /* (quota) */ } }) }
    return ok
  }
}

let probe: ((ch: string) => boolean) | null = null
/** The session's probe over the label font (labels.ts SERIF stack is not used for names: the UI font), or null outside a browser. */
export function labelGlyphProbe(): ((ch: string) => boolean) | null {
  if (probe) return probe
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 24; c.height = 24
  probe = createGlyphProbe(c as unknown as ProbeCanvas, "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif", typeof localStorage === 'undefined' ? undefined : localStorage, typeof navigator === 'undefined' ? '' : navigator.userAgent)
  return probe
}
