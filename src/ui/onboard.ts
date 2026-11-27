// Onboarding (EVALUATION §4 Lane 4, "Dramatic watch"): the policies of the first minutes, in one place.
//  - Follow the story is on by default for a first visit (no follow= in the address, not a seat, comparison or fly-in
//    link); follow=0 turns it off, follow=1 on. A visit counts once a history has been shown (markVisited).
//  - The start page's play paths (ui/landing.ts): watch the story (Follow on), explore freely (Follow off), or rule a
//    kingdom (a seat link; THRONE_START below until the throne lane's curated seeds replace it).
//  - The right column shows CORE_PANELS and the current context panel (ui/contextPanel.ts); the rest wait under "More".

import { loadFlag, loadPref, saveFlag, savePref } from './panels.ts'
import './onboard.css'
import { currentContext, isContextRoot, onContextChange, registerContext } from './contextPanel.ts'

const VISITED_KEY = 'worldseed.visited'

export function isFirstVisit(): boolean {
  return loadPref(VISITED_KEY) === null
}

export function markVisited(): void {
  if (isFirstVisit()) savePref(VISITED_KEY, '1')
}

/** Whether Follow the story starts on, from the address (`follow=`) and whether this is a first visit. */
export function followByDefault(params: URLSearchParams, firstVisit = isFirstVisit()): boolean {
  const f = params.get('follow')
  if (f === '1') return true
  if (f === '0') return false
  // links that open somewhere particular keep their own camera and pace
  for (const k of ['seat', 'cmp', 'fly', 'select', 'polity', 'year', 'lon', 'lat']) if (params.has(k)) return false
  return firstVisit
}

// ---------- the start page's play paths ----------

export const PlayPath = { Watch: 'watch', Explore: 'explore', Rule: 'rule' } as const
export type PlayPath = (typeof PlayPath)[keyof typeof PlayPath]

export interface PlayPathSpec {
  path: PlayPath
  label: string
  hint: string
  /** The page's main button (submitted by Enter in a field). */
  primary?: boolean
}

export const PLAY_PATHS: readonly PlayPathSpec[] = [
  { path: PlayPath.Watch, label: 'Watch history unfold', hint: 'The camera follows the great events: about ten minutes for 2,000 years', primary: true },
  { path: PlayPath.Rule, label: 'Rule a kingdom', hint: 'Take a throne and decide: heirs, wars, revolts' },
  { path: PlayPath.Explore, label: 'Explore freely', hint: 'Turn the globe yourself; history plays in the background' },
]

/**
 * Rule a kingdom: the seat link it opens (the throne lane replaces this with its curated seeds, realms and years).
 * Seed 61343's Kelurair from 700 reached its first card in 14.5 s on a phone viewport in the evaluation.
 */
export const THRONE_START = { seed: 61343, seat: 'polity:0:700' }

/** The address of the Rule a kingdom path (keeps `keep` parameters of the page, e.g. preset=). */
export function throneUrl(from: URL, keep: readonly string[] = ['preset', 'lang']): URL {
  const url = new URL(from.href)
  url.search = ''
  url.searchParams.set('seed', String(THRONE_START.seed))
  url.searchParams.set('seat', THRONE_START.seat)
  for (const k of keep) {
    const v = from.searchParams.get(k)
    if (v !== null) url.searchParams.set(k, v)
  }
  return url
}

// ---------- the right column: the context panel, the rest under "More" ----------

/** The right column's panels always in sight (by their root's class): the map's View panel, the Chronicle, a selection's inspector. */
export const CORE_PANELS: readonly string[] = ['map-panel', 'chronicle', 'inspector']
const MORE_KEY = 'worldseed.panels.more'
/** A panel whose header says it has nothing yet is left out of the "More" drawer too. */
const EMPTY_RE = /\b(none yet|none now|no orders|none known yet|no towns yet)\b/i

/**
 * The right column (ui-additions 2): CORE_PANELS (and the view's legends) stay in sight, and of the context panels
 * (ui/contextPanel.ts: Factions by default, the Why panel while open, the story's battle, the throne lane's seat) the
 * current one shows; every other panel waits in the "More" drawer, a row before the Chronicle (opening it shows them,
 * remembered), and panels that have nothing yet are hidden even there. Panels added later are sorted in as they come;
 * a tucked panel opened by a link or a shortcut opens the drawer.
 */
export function groupRightRail(right: HTMLElement): { readonly open: boolean; setOpen(on: boolean): void } {
  let open = loadFlag(MORE_KEY, false)
  const row = document.createElement('button')
  row.type = 'button'
  row.className = 'rail-more'
  row.setAttribute('aria-expanded', String(open))
  const isCore = (el: Element) => el === row || CORE_PANELS.some((c) => el.classList.contains(c)) || /legend|banner|width-handle/.test(el.className)
  const shown = (el: Element) => !(el as HTMLElement).hidden && !el.classList.contains('hidden')
  /** The default contexts, registered once their panels exist. */
  const defaults = () => {
    const fac = right.querySelector<HTMLElement>(':scope > .factions')
    if (fac && !isContextRoot(fac)) registerContext({ id: 'realm', priority: 1, root: fac, active: () => true })
    const why = right.querySelector<HTMLElement>(':scope > .why')
    if (why && !isContextRoot(why)) registerContext({ id: 'why', priority: 5, root: why, active: () => shown(why) })
  }
  /** Each tucked panel's collapsed state at the last look: one opened meanwhile (a link, a shortcut) opens "More". */
  const wasCollapsed = new WeakMap<Element, boolean>()
  const sync = () => {
    defaults()
    const ctx = currentContext()
    let n = 0
    const tuckable = Array.from(right.children).filter((el) => !isCore(el) && el !== ctx?.root)
    if (!open) {
      for (const el of tuckable) {
        if (wasCollapsed.get(el) === true && !el.classList.contains('collapsed') && !isContextRoot(el)) open = true
      }
    }
    for (const el of Array.from(right.children)) el.classList.toggle('rail-context', el === ctx?.root)
    if (ctx) ctx.root.classList.remove('rail-tucked', 'rail-empty')
    for (const el of tuckable) {
      wasCollapsed.set(el, el.classList.contains('collapsed'))
      const empty = !isContextRoot(el) && EMPTY_RE.test((el.textContent ?? '').slice(0, 160))
      el.classList.toggle('rail-tucked', !open || empty)
      el.classList.toggle('rail-empty', empty)
      if (shown(el) && !empty && !(isContextRoot(el) && !ctxShownInDrawer(el))) n++
    }
    row.textContent = open ? 'Fewer panels' : `More panels (${n})`
    row.setAttribute('aria-expanded', String(open))
    row.hidden = n === 0 && !open
    // before the Chronicle (or last)
    const chron = right.querySelector(':scope > .chronicle')
    if (chron && row.nextSibling !== chron) right.insertBefore(row, chron)
    else if (!chron && row.parentElement !== right) right.appendChild(row)
  }
  /** An inactive context in the drawer: only the always-available ones (Factions) are worth listing there. */
  const ctxShownInDrawer = (el: Element) => el.classList.contains('factions')
  row.addEventListener('click', () => {
    open = !open
    saveFlag(MORE_KEY, open)
    sync()
  })
  right.classList.add('rail-grouped')
  // (a panel added, or shown or hidden: the count and its place; the column's own children only)
  const OBS: MutationObserverInit = { childList: true, attributes: true, subtree: true, attributeFilter: ['class', 'hidden'] }
  let queued = false
  const resync = () => {
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      mo.disconnect()
      sync()
      mo.observe(right, OBS)
    })
  }
  const mo = new MutationObserver((recs) => {
    if (recs.some((r) => (r.type === 'childList' ? r.target === right : (r.target as Element).parentElement === right))) resync()
  })
  onContextChange(resync)
  // (a panel's header text changes as history plays: "none yet" panels come out of hiding)
  window.setInterval(() => { if (right.isConnected) resync() }, 2000)
  sync()
  mo.observe(right, OBS)
  return {
    get open() {
      return open
    },
    setOpen(on: boolean) {
      if (on === open) return
      open = on
      saveFlag(MORE_KEY, open)
      sync()
    },
  }
}
