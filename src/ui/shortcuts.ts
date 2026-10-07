// Keyboard shortcuts: one window listener, a registry that panels add to, and the list
// the help popover shows. Shortcuts are skipped while typing in a field (Escape just
// leaves the field), and keys a focused control uses itself (Space or Enter on a button,
// arrows on a slider or a menu) are left to that control.

export interface Shortcut {
  /** KeyboardEvent.key values that trigger it. */
  keys: string[]
  /** Whether Shift must be held (true), must not be (false), or either (undefined). */
  shift?: boolean
  /** How the help popover writes the key, e.g. "Space" or "← →"; entries with the same label and group are listed once. */
  label: string
  description: string
  group: 'Timeline' | 'View' | 'Panels'
  /** Return false when the key did not apply (the next matching shortcut gets it). */
  run(e: KeyboardEvent): boolean | void
  /** Tried before the shortcuts registered earlier (the city view's Esc goes before the panels' own). */
  first?: boolean
}

const shortcuts: Shortcut[] = []
let installed = false
/** Off while the start page shows (ui/landing.ts): the app's keys wait until it is entered. */
let enabled = true

export function setShortcutsEnabled(on: boolean): void {
  enabled = on
}

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true
  if (t.tagName === 'INPUT') {
    const type = (t as HTMLInputElement).type
    return type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'range'
  }
  return false
}

/** Keys a focused control handles natively. */
function ownedByControl(t: EventTarget | null, key: string): boolean {
  if (!(t instanceof HTMLElement)) return false
  const tag = t.tagName
  const button = tag === 'BUTTON' || t.getAttribute('role') === 'button' || (tag === 'INPUT' && ((t as HTMLInputElement).type === 'checkbox' || (t as HTMLInputElement).type === 'radio'))
  if (button && (key === ' ' || key === 'Enter')) return true
  if (tag === 'INPUT' && (t as HTMLInputElement).type === 'range') return key.startsWith('Arrow') || key === 'Home' || key === 'End' || key === 'PageUp' || key === 'PageDown'
  if (t.getAttribute('role') === 'separator') return key.startsWith('Arrow')
  return false
}

function onKey(e: KeyboardEvent) {
  if (!enabled || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
  if (isTyping(e.target)) {
    if (e.key === 'Escape') (e.target as HTMLElement).blur()
    return
  }
  if (ownedByControl(e.target, e.key)) return
  for (const s of shortcuts) {
    if (!s.keys.includes(e.key)) continue
    if (s.shift !== undefined && s.shift !== e.shiftKey) continue
    if (s.run(e) === false) continue
    e.preventDefault()
    return
  }
}

export function addShortcut(s: Shortcut): void {
  if (s.first) shortcuts.unshift(s)
  else shortcuts.push(s)
  if (!installed) {
    installed = true
    window.addEventListener('keydown', onKey)
  }
}

/** Registered shortcuts, one entry per (group, label), in registration order. */
export function shortcutList(): Shortcut[] {
  const seen = new Set<string>()
  const out: Shortcut[] = []
  for (const s of shortcuts) {
    const k = s.group + '\u0000' + s.label
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}
