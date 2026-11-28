// Why panel (causal-explorer.md §8.1): "What the record shows" for one node: the explanation in words (Chronicle, or the
// Legend at a toggle), then the tree of causes, each link with its tier (● recorded, ◐ probable with its confidence in
// words, ○ a condition with a bar for its weight), its year and a "why?" that explains it in turn (re-rooting the panel).
// Clicking a name selects its town on the map. "Show the record" adds the rule ids and the sim's numbers. "What came of
// it?" lists the effects. Esc closes it. URL: why=event:1234. A panel in the right column (it follows the chronicle).

import './why.css'
import type { History } from '../contract.ts'
import { WhyTier, causesIn, parseKey } from './why/graph.ts'
import type { WhyLink, WhyTree } from './why/graph.ts'
import { explain, WHY_LIMITS } from './why/explain.ts'
import { hasWhy } from './why/causeIndex.ts'
import { whyProse } from './why/prose.ts'
import { addShortcut } from './shortcuts.ts'
import { openPanel } from './panels.ts' // n4c

export interface WhyPanelDeps {
  host: HTMLElement
  history(): History | null
  seed(): number
  /** Select a settlement on the map (and fly there). */
  select(id: number): void
  setUrlParam(name: string, value: string | null): void
}

/** why= in the address when the page opened (opened with the first history). */
const initialKey = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('why') : null

export interface WhyPanel {
  /** Explain node `key` ("event:12", "polity:3", "settlement:40", "ruler:7", "war:2"); `note` e.g. "one of 12". */
  open(key: string, note?: string): void
  close(): void
  readonly isOpen: boolean
  /** A new history: the panel re-explains its node, or closes when the node is gone. */
  historyChanged(): void
}

const confWords = (c: number) => (c >= 0.85 ? 'very likely' : c >= 0.66 ? 'likely' : c >= 0.33 ? 'perhaps' : 'doubtful')

export function createWhyPanel(deps: WhyPanelDeps): WhyPanel {
  const root = document.createElement('section')
  root.className = 'panel why hidden'
  root.setAttribute('aria-label', 'Why')
  const head = document.createElement('div')
  head.className = 'gp-head why-head'
  const title = document.createElement('span')
  title.className = 'gp-title why-title'
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'why-close'
  closeBtn.textContent = '×'
  closeBtn.setAttribute('aria-label', 'Close the Why panel')
  closeBtn.title = 'Close (Esc; R goes back to the factions)'
  head.append(title, closeBtn)
  const bar = document.createElement('div')
  bar.className = 'why-bar'
  const mk = (label: string) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'why-toggle'
    b.textContent = label
    b.setAttribute('aria-pressed', 'false')
    bar.appendChild(b)
    return b
  }
  const legendBtn = mk('Legend')
  legendBtn.title = 'As the legend tells it (hedges kept on what is only probable)'
  const recordBtn = mk('Show the record')
  const backBtn = mk('Back')
  backBtn.hidden = true
  const note = document.createElement('div')
  note.className = 'why-note'
  const prose = document.createElement('p')
  prose.className = 'why-prose'
  const tree = document.createElement('ol')
  tree.className = 'why-tree'
  tree.setAttribute('role', 'tree')
  const effHead = document.createElement('details')
  effHead.className = 'why-effects'
  const effSum = document.createElement('summary')
  effSum.textContent = 'What came of it?'
  const effList = document.createElement('ul')
  effHead.append(effSum, effList)
  const foot = document.createElement('div')
  foot.className = 'why-foot'
  foot.textContent = 'What the record shows: ● recorded · ◐ probable · ○ a condition, weighed'
  root.append(head, bar, note, prose, tree, effHead, foot)
  deps.host.appendChild(root)

  let key: string | null = null
  let pendingKey: string | null = initialKey
  let extra = ''
  let legend = false
  let record = false
  const back: string[] = []
  let depthOf = new Map<string, number>()

  const render = () => {
    const h = deps.history()
    if (!h || !key) { root.classList.add('hidden'); return }
    root.classList.remove('hidden')
    let t: WhyTree
    try { t = explain(h, key, { depth: Math.max(WHY_LIMITS.depth, ...depthOf.values()) }) } catch { title.textContent = 'Why?'; prose.textContent = 'The record does not say why.'; tree.replaceChildren(); return }
    const rn = t.nodes.get(t.root)
    title.textContent = `Why? ${rn?.label ?? ''}`
    note.textContent = [extra, hasWhy(h) ? '' : 'This history was made without its causes recorded: the explanations use the rules only, and are less sure.'].filter(Boolean).join(' ')
    note.hidden = note.textContent === ''
    legendBtn.setAttribute('aria-pressed', String(legend))
    recordBtn.setAttribute('aria-pressed', String(record))
    backBtn.hidden = back.length === 0
    // prose, with named nodes as links
    prose.replaceChildren()
    for (const s of whyProse(h, t, legend, deps.seed())) {
      if (typeof s === 'string') { prose.append(s); continue }
      const a = document.createElement('button')
      a.type = 'button'
      a.className = 'why-ref'
      a.textContent = s.text
      a.addEventListener('click', () => focusNode(t, s.key))
      prose.append(a)
    }
    if (legend) prose.prepend(Object.assign(document.createElement('em'), { textContent: 'As the legend tells it: ' }))
    // the tree
    tree.replaceChildren()
    const kids = causesIn(t)
    const seen = new Set<string>()
    const add = (parent: HTMLElement, k: string, depth: number) => {
      for (const l of kids.get(k) ?? []) {
        const li = document.createElement('li')
        li.setAttribute('role', 'treeitem')
        li.append(linkRow(t, l))
        parent.appendChild(li)
        if (seen.has(l.cause)) { li.classList.add('why-shared'); continue }
        seen.add(l.cause)
        if ((kids.get(l.cause) ?? []).length) {
          const ol = document.createElement('ol')
          ol.setAttribute('role', 'group')
          li.appendChild(ol)
          add(ol, l.cause, depth + 1)
        }
      }
    }
    add(tree, t.root, 0)
    // (play-test 1: the prose already says "The record does not say why."; the tree does not say it again)
    if (tree.childElementCount === 0) tree.append(Object.assign(document.createElement('li'), { className: 'why-empty', textContent: 'No earlier cause is on record.' }))
    if (t.truncated) tree.append(Object.assign(document.createElement('li'), { className: 'why-empty', textContent: 'The record goes further back: press why? on a cause to continue.' }))
    // effects
    effList.replaceChildren()
    for (const l of t.effects) {
      const li = document.createElement('li')
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'why-ref'
      b.textContent = t.nodes.get(l.effect)?.label ?? l.effect
      b.addEventListener('click', () => reroot(l.effect))
      li.append(b)
      effList.append(li)
    }
    effHead.hidden = t.effects.length === 0
  }

  function linkRow(t: WhyTree, l: WhyLink): HTMLElement {
    const row = document.createElement('div')
    row.className = `why-link tier-${l.tier}`
    const badge = document.createElement('span')
    badge.className = 'why-badge'
    if (l.tier === WhyTier.Recorded) { badge.textContent = '●'; badge.title = 'recorded' }
    else if (l.tier === WhyTier.Rule) { badge.textContent = '◐'; badge.title = `probable: ${confWords(l.conf)}` }
    else {
      badge.textContent = '○'
      badge.title = `a condition, weight ${Math.round(l.conf * 100)}%`
      const w = document.createElement('span')
      w.className = 'why-weight'
      w.style.setProperty('--w', String(Math.max(0.04, Math.min(1, l.conf))))
      badge.append(w)
    }
    const n = t.nodes.get(l.cause)
    const label = document.createElement('button')
    label.type = 'button'
    label.className = 'why-label'
    label.textContent = n?.label ?? l.cause
    label.addEventListener('click', () => { if (n && n.place >= 0) deps.select(n.place) })
    row.append(badge, label)
    if (l.tier === WhyTier.Rule) row.append(Object.assign(document.createElement('span'), { className: 'why-conf', textContent: confWords(l.conf) }))
    if (record) row.append(Object.assign(document.createElement('span'), { className: 'why-rec', textContent: `${l.via}${l.value ? ' · ' + l.value : ''} · ${l.tier === WhyTier.Condition ? 'weight' : 'conf'} ${l.conf.toFixed(2)}` }))
    else if (l.value && l.tier !== WhyTier.Rule) row.append(Object.assign(document.createElement('span'), { className: 'why-val', textContent: l.value }))
    {
      const more = document.createElement('button')
      more.type = 'button'
      more.className = 'why-more'
      more.textContent = 'why?'
      more.setAttribute('aria-label', `Why: ${n?.label ?? ''}`)
      more.addEventListener('click', () => reroot(l.cause))
      row.append(more)
    }
    return row
  }

  function focusNode(t: WhyTree, k: string) {
    const n = t.nodes.get(k)
    if (n && n.place >= 0) deps.select(n.place)
  }

  function reroot(k: string) {
    if (key) back.push(key)
    key = k
    extra = ''
    depthOf = new Map()
    deps.setUrlParam('why', k)
    render()
  }

  closeBtn.addEventListener('click', () => api.close())
  legendBtn.addEventListener('click', () => { legend = !legend; render() })
  recordBtn.addEventListener('click', () => { record = !record; render() })
  backBtn.addEventListener('click', () => { const k = back.pop(); if (k) { key = k; deps.setUrlParam('why', k); render() } })
  addShortcut({ keys: ['Escape'], label: 'Esc', description: 'Close the Why panel', group: 'Panels', first: true, run: () => { if (!key) return false; api.close(); return true } })
  // n4b: the Why panel holds the context slot while open, so R (Factions) closes it and the Factions panel is back
  addShortcut({ keys: ['r', 'R'], label: 'R', description: 'Close the Why panel (back to the factions)', group: 'Panels', first: true, run: () => { if (!key) return false; api.close(); openPanel('factions'); return true } }) // n4c: back to the factions, open (play-test 2: R showed nothing)

  const api: WhyPanel = {
    open(k, n = '') {
      back.length = 0
      key = k
      extra = n
      depthOf = new Map()
      deps.setUrlParam('why', k)
      render()
      // n4b: once the column has put it in the context slot (a microtask), bring it into view at a usable height
      requestAnimationFrame(() => {
        if (!key) return
        root.scrollIntoView?.({ block: 'nearest' })
        closeBtn.focus({ preventScroll: true })
      })
    },
    close() {
      key = null
      back.length = 0
      deps.setUrlParam('why', null)
      root.classList.add('hidden')
    },
    get isOpen() { return key !== null },
    historyChanged() {
      if (!key && pendingKey) { const k = pendingKey; pendingKey = null; if (parseKey(k)) api.open(k); return }
      if (!key) return
      const h = deps.history()
      const k = parseKey(key)
      if (!h || !k || (k.kind === 'event' && k.id >= h.events.length)) { api.close(); return }
      render()
    },
  }
  return api
}
