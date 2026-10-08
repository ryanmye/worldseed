// The phone layout's bottom sheet (compact.ts): the right column of panels, in the compact layout, slides up from
// the bottom edge. Its handle (a grabber and the panels' names as horizontally scrolling tabs) is all that shows at
// rest ("peek"); "half" and "full" show one panel at a time under it. The handle is dragged up and down (the sheet
// and the timeline above it follow as CSS transforms, nothing redrawn), or tapped: the grabber steps through the
// heights, a tab opens its panel (half height from peek), the open tab again lowers the sheet to peek. On a phone
// on its side the sheet is a column at the right instead: peek is the tabs alone at its top, half and full the
// whole column.
//
// The panels stay the column's own children (their CSS and the accordion of panels.ts keep working): the sheet only
// shows the active one, opens it through its own header (so it renders) and closes the others (so they do not);
// at peek the active panel is closed too. A panel opened from elsewhere (a link, a shortcut) becomes the active tab
// and raises the sheet. The inspector moves into the sheet as the "Town" tab while a settlement is selected, and the
// view legends move out of it to the top right (compactLegends), both back again on leaving the compact layout.

import { isCompact, isCompactLandscape, onCompactChange } from './compact.ts'
import { loadPref, savePref } from './panels.ts'

export type SheetState = 'peek' | 'half' | 'full'

export interface Sheet {
  readonly state: SheetState
  setState(s: SheetState): void
  /** Open the panel with this key (its second class name: peoples, factions, goods, …, inspector) as the active tab. */
  show(key: string): void
  /** The sheet's height at rest, peek (CSS px from the bottom edge, safe area included); 0 outside the compact layout. */
  peekHeight(): number
  /** Re-measure the heights (the window, the top bar or the timeline changed size). */
  measure(): void
}

export interface SheetDeps {
  /** The overlay root (gets --sheet-peek and the sheet-* classes). */
  root: HTMLElement
  /** The right column: the sheet itself. */
  column: HTMLElement
  /** The left column (the inspector comes from it). */
  left: HTMLElement
  /** The timeline's slot (rides on top of the sheet in portrait). */
  bottom: HTMLElement
  /** The top bar (the sheet's full height stops under it). */
  topBar: HTMLElement
  /** Where the view legends go in the compact layout. */
  legends: HTMLElement
  /** The free view or the sheet's height at rest changed. */
  onLayout(): void
}

const TAB_KEY = 'worldseed.sheet.tab'
const STATE_KEY = 'worldseed.sheet.state'
/** Short names for the tabs where a panel's title is long. */
const TAB_LABELS: Record<string, string> = { goods: 'Goods', inspector: 'Town' }

// ---------- moving a node out of its place and back ----------
const marks = new WeakMap<Node, Comment>()
/** Moves `node` into `parent` (before `before`), leaving a marker where it was so restoreNode puts it back. */
export function relocateNode(node: Node, parent: Node, before: Node | null = null): void {
  if (!marks.has(node) && node.parentNode) {
    const m = document.createComment('compact')
    node.parentNode.insertBefore(m, node)
    marks.set(node, m)
  }
  if (node.parentNode !== parent || node.nextSibling !== before) parent.insertBefore(node, before)
}
/** Puts a node moved by relocateNode back where it was. */
export function restoreNode(node: Node): void {
  const m = marks.get(node)
  if (!m) return
  marks.delete(node)
  m.parentNode?.replaceChild(node, m)
}

export function createSheet(deps: SheetDeps): Sheet {
  const { column, root } = deps
  const handle = document.createElement('div')
  handle.className = 'sheet-handle'
  const grabber = document.createElement('button')
  grabber.type = 'button'
  grabber.className = 'sheet-grabber'
  grabber.setAttribute('aria-label', 'Panels: raise or lower')
  grabber.innerHTML = '<span aria-hidden="true"></span>'
  const tabs = document.createElement('div')
  tabs.className = 'sheet-tabs'
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', 'Panels')
  handle.append(grabber, tabs)

  let state: SheetState = (['peek', 'half', 'full'] as const).find((s) => s === loadPref(STATE_KEY)) ?? 'peek'
  let active = loadPref(TAB_KEY) ?? 'peoples'
  /** The tab before the inspector took over (back to it when the selection is cleared). */
  let beforeTown = ''
  let on = false
  /** Clicking a panel's header ourselves (not the user: the header clicks are let through). */
  let own = false
  const heights = { peek: 64, half: 300, full: 500 }

  // ---------- the panels ----------
  const isPanel = (el: Element): el is HTMLElement =>
    el instanceof HTMLElement && el.classList.contains('panel') && !el.classList.contains('sp-legend') && !el.classList.contains('map-panel')
  const keyOf = (p: HTMLElement) => (p.classList.contains('inspector') ? 'inspector' : (p.classList[1] ?? ''))
  const headOf = (p: HTMLElement) => (p.querySelector(':scope > [aria-expanded]') ?? p.querySelector('.insp-collapse')) as HTMLElement | null
  const panels = () => [...column.children].filter(isPanel)
  const panelOf = (key: string) => panels().find((p) => keyOf(p) === key) ?? null
  const shownPanel = (p: HTMLElement) => !p.classList.contains('hidden') && !p.hidden
  const isOpen = (p: HTMLElement) => headOf(p)?.getAttribute('aria-expanded') === 'true'
  function setOpen(p: HTMLElement, open: boolean) {
    if (keyOf(p) === 'inspector') return // (stays open: its tab shows it or not)
    const h = headOf(p)
    if (!h || isOpen(p) === open) return
    own = true
    try {
      h.click()
    } finally {
      own = false
    }
  }

  // ---------- the tabs ----------
  const tabFor = new Map<string, HTMLButtonElement>()
  function syncTabs() {
    const list = panels()
    const keys = new Set<string>()
    let prev: HTMLButtonElement | null = null
    for (const p of list) {
      const key = keyOf(p)
      keys.add(key)
      let t = tabFor.get(key)
      if (!t) {
        t = document.createElement('button')
        t.type = 'button'
        t.className = 'sheet-tab'
        t.setAttribute('role', 'tab')
        t.dataset.key = key
        const title = p.querySelector('[class$="-title"]')?.textContent?.trim() ?? key
        t.textContent = TAB_LABELS[key] ?? title
        tabFor.set(key, t)
      }
      t.hidden = !shownPanel(p)
      // (in the column's order, the inspector first)
      const want: Element | null = prev ? prev.nextElementSibling : tabs.firstElementChild
      if (want !== t) tabs.insertBefore(t, want)
      prev = t
    }
    for (const [k, t] of tabFor) if (!keys.has(k)) { t.remove(); tabFor.delete(k) }
    syncActive()
  }
  function syncActive() {
    // the active tab must be a shown panel: else the first shown one
    const p = panelOf(active)
    if (!p || !shownPanel(p)) {
      const first = panels().find((q) => shownPanel(q) && keyOf(q) !== 'inspector')
      if (first) active = keyOf(first)
    }
    for (const [k, t] of tabFor) {
      const sel = k === active
      t.classList.toggle('active', sel)
      t.setAttribute('aria-selected', String(sel))
    }
    for (const q of panels()) q.classList.toggle('sheet-active', keyOf(q) === active)
  }
  /** The active panel open (unless at peek), every other one closed. */
  function applyPanels() {
    if (!on) return
    for (const p of panels()) setOpen(p, keyOf(p) === active && state !== 'peek')
  }

  function show(key: string, raise = true) {
    if (!panelOf(key)) return
    if (key !== active && key === 'inspector') beforeTown = active
    active = key
    if (key !== 'inspector') savePref(TAB_KEY, key)
    syncActive()
    if (raise && state === 'peek') setState('half')
    else applyPanels()
    tabFor.get(key)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  // ---------- heights ----------
  const safeBottom = () => parseFloat(getComputedStyle(column).paddingBottom) || 0
  function measure() {
    if (!on) return
    const h = window.innerHeight
    const peek = Math.round(handle.offsetHeight + safeBottom())
    if (isCompactLandscape()) {
      heights.peek = peek
      heights.half = heights.full = h
      column.style.height = ''
      root.style.setProperty('--sheet-peek', `${peek}px`)
    } else {
      const top = deps.topBar.getBoundingClientRect().bottom
      const tl = deps.bottom.offsetHeight
      const full = Math.max(peek + 80, Math.round(h - top - 8 - tl))
      heights.peek = peek
      heights.full = full
      heights.half = Math.max(peek + 60, Math.min(full, Math.round(h * 0.46)))
      column.style.height = `${full}px`
      root.style.setProperty('--sheet-peek', `${peek}px`)
    }
    place(heights[state], false)
  }
  /** Show `visible` px of the sheet (portrait: transforms on the sheet and the timeline). */
  function place(visible: number, dragging: boolean) {
    root.classList.toggle('sheet-dragging', dragging)
    if (isCompactLandscape()) {
      column.style.transform = ''
      deps.bottom.style.transform = ''
      return
    }
    const v = Math.max(heights.peek, Math.min(heights.full, visible))
    column.style.transform = `translateY(${heights.full - v}px)`
    deps.bottom.style.transform = `translateY(${-(v - heights.peek)}px)`
  }
  function setState(s: SheetState) {
    state = s
    savePref(STATE_KEY, s)
    root.classList.toggle('sheet-peek', s === 'peek')
    root.classList.toggle('sheet-half', s === 'half')
    root.classList.toggle('sheet-full', s === 'full')
    grabber.setAttribute('aria-label', s === 'peek' ? 'Raise the panels' : s === 'half' ? 'Raise the panels to full height' : 'Lower the panels')
    applyPanels()
    place(heights[s], false)
  }

  // ---------- dragging the handle; tapping it ----------
  let drag: { id: number; y0: number; v0: number; moved: boolean; lastY: number; lastT: number; vel: number } | null = null
  let suppressClick = false
  handle.addEventListener('pointerdown', (e) => {
    if (!on || isCompactLandscape() || (e.pointerType === 'mouse' && e.button !== 0)) return
    drag = { id: e.pointerId, y0: e.clientY, v0: heights[state], moved: false, lastY: e.clientY, lastT: e.timeStamp, vel: 0 }
  })
  handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const dy = e.clientY - drag.y0
    if (!drag.moved) {
      if (Math.abs(dy) < 8) return
      drag.moved = true
      handle.setPointerCapture(e.pointerId)
      // (the panel about to show is opened as the drag starts, so it is filled when it comes into view)
      if (state === 'peek') {
        const p = panelOf(active)
        if (p) setOpen(p, true)
      }
    }
    const dt = Math.max(1, e.timeStamp - drag.lastT)
    drag.vel = (e.clientY - drag.lastY) / dt
    drag.lastY = e.clientY
    drag.lastT = e.timeStamp
    place(drag.v0 - dy, true)
  })
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    const d = drag
    drag = null
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
    if (!d.moved) return
    suppressClick = true
    window.setTimeout(() => (suppressClick = false), 0)
    // nearest height, thrown a step by a quick flick
    const v = d.v0 - (e.clientY - d.y0) - d.vel * 180
    const order: SheetState[] = ['peek', 'half', 'full']
    let best: SheetState = 'peek'
    for (const s of order) if (Math.abs(heights[s] - v) < Math.abs(heights[best] - v)) best = s
    setState(best)
  }
  handle.addEventListener('pointerup', endDrag)
  handle.addEventListener('pointercancel', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const moved = drag.moved
    drag = null
    if (moved) setState(state)
  })
  grabber.addEventListener('click', () => {
    if (suppressClick) return
    // (on its side the column has one open height)
    if (isCompactLandscape()) setState(state === 'peek' ? 'half' : 'peek')
    else setState(state === 'peek' ? 'half' : state === 'half' ? 'full' : 'peek')
  })
  tabs.addEventListener('click', (e) => {
    if (suppressClick) return
    const t = (e.target as HTMLElement).closest('.sheet-tab') as HTMLButtonElement | null
    if (!t?.dataset.key) return
    if (t.dataset.key === active && state !== 'peek') setState('peek')
    else show(t.dataset.key)
  })

  // ---------- a panel's own header: in the sheet the tabs open and close the panels ----------
  column.addEventListener('click', (e) => {
    if (!on || own) return
    const h = (e.target as HTMLElement).closest('[aria-expanded]') as HTMLElement | null
    const p = h?.parentElement
    if (!h || !p || !isPanel(p) || headOf(p) !== h) return
    // (a click on the open panel's header would only close it under its tab)
    e.stopImmediatePropagation()
    e.preventDefault()
  }, true)

  // ---------- following the panels ----------
  const watched = new WeakSet<HTMLElement>()
  const attrObserver = new MutationObserver((records) => {
    if (!on) return
    let tabsChanged = false
    for (const r of records) {
      const t = r.target as HTMLElement
      if (r.attributeName === 'class' && isPanel(t)) {
        tabsChanged = true
        // a settlement selected: the inspector's tab, raised; cleared: back to the tab before
        if (keyOf(t) === 'inspector') {
          if (shownPanel(t)) show('inspector')
          else if (active === 'inspector') {
            active = beforeTown || (loadPref(TAB_KEY) ?? 'peoples')
            syncActive()
            applyPanels()
          }
        }
      } else if (r.attributeName === 'aria-expanded' && !own && t.getAttribute('aria-expanded') === 'true') {
        // opened from elsewhere (a link, a shortcut): its tab, raised
        const p = t.parentElement
        if (p && isPanel(p) && headOf(p) === t && keyOf(p) !== 'inspector') show(keyOf(p))
      }
    }
    if (tabsChanged) syncTabs()
  })
  function watch(p: HTMLElement) {
    if (watched.has(p)) return
    watched.add(p)
    attrObserver.observe(p, { attributes: true, attributeFilter: ['class'] })
    const h = headOf(p)
    if (h) attrObserver.observe(h, { attributes: true, attributeFilter: ['aria-expanded'] })
  }

  /** Inspector into the sheet, legends out of it (or both back), the tabs current. */
  function adopt() {
    if (!on) return
    const insp = deps.left.querySelector(':scope > .inspector') as HTMLElement | null
    if (insp && insp.parentNode !== column) relocateNode(insp, column, handle.nextSibling)
    for (const l of [...column.querySelectorAll(':scope > .sp-legend')]) relocateNode(l, deps.legends)
    for (const p of panels()) watch(p)
    syncTabs()
    applyPanels()
  }
  const childObserver = new MutationObserver(() => adopt())
  childObserver.observe(column, { childList: true })
  childObserver.observe(deps.left, { childList: true })

  function enter() {
    on = true
    root.classList.add('sheet-on')
    column.insertBefore(handle, column.firstChild)
    adopt()
    const insp = panelOf('inspector')
    if (insp && shownPanel(insp)) active = 'inspector'
    syncActive()
    setState(state)
    requestAnimationFrame(() => measure())
  }
  function leave() {
    on = false
    root.classList.remove('sheet-on', 'sheet-peek', 'sheet-half', 'sheet-full', 'sheet-dragging')
    handle.remove()
    const insp = column.querySelector(':scope > .inspector')
    if (insp) restoreNode(insp)
    for (const l of [...deps.legends.children]) restoreNode(l)
    for (const p of panels()) p.classList.remove('sheet-active')
    column.style.transform = ''
    column.style.height = ''
    deps.bottom.style.transform = ''
    root.style.removeProperty('--sheet-peek')
  }
  onCompactChange((compact) => {
    if (compact && !on) enter()
    else if (!compact && on) leave()
    else if (on) {
      // (the phone turned: the other arrangement)
      setState(state)
      requestAnimationFrame(() => measure())
    }
    deps.onLayout()
  })
  if (isCompact()) enter()

  return {
    get state() {
      return state
    },
    setState,
    show,
    peekHeight: () => (on ? heights.peek : 0),
    measure,
  }
}
