// What-if: the comparison panel (experience-whatif-director-sagas §1.8), in the right column's accordion like Nudge
// (W). It shows how the history on screen (A, with the player's orders) differs from another run of the same world (B:
// the orders minus one, minus all, or plus a drafted order not yet urged), which the worker simulates beside it
// (worker.ts `compare`, main.ts requestCompare).
//
// Top to bottom: the header ("The world without …"; for an order that changed nothing, the one line saying so and
// nothing else); the divergence timeline (the similarity of the two records per decade, grey up to the divergence,
// accent after it, with a notch at the divergence and the eight most dramatic events of each world after it as ticks
// above and below; a click sets the year); "What changed first" (the causal window, up to three lines per side, near
// the order's place first); "The worlds part" (after the causal window, introduced by the fixed caution "differences,
// not effects": owner decision); the whatif saga (sagas/whatif.ts, when given); and Swipe, Adopt the other world (an
// `orders` request with B's list, a cache hit), Close. While B is simulated the panel shows progress and Cancel.
// The comparison goes stale when A changes (an extension or a new run): "Compare again".

import type { History, Order, World } from '../contract.ts'
import { encodeOrders } from '../contract.ts'
import { Ctx } from './sagas/facts.ts'
import { whatifSaga } from './sagas/whatif.ts'
import { sagaMarkdown, sagaText, type Saga } from './sagas/index.ts'
import { polish } from './sagas/voice.ts'
import { CAUSAL_YEARS } from '../whatif/diff.ts'
import { settlementName } from './format.ts'
import { orderStory } from './nudgeFormat.ts'
import { politiesOf } from './politiesData.ts'
import { whatIfFacts, type FirstDiff, topEvents } from './whatif/consequences.ts'
import { consequenceText, safeDescribe, type CompareAsk, type CompareResult, type WhatIfShown } from './whatif/wording.ts'
export type { CompareAsk, CompareResult, WhatIfShown } from './whatif/wording.ts'
import { loadFlag, panelToggled, registerPanel, saveFlag } from './panels.ts'
import { addShortcut } from './shortcuts.ts'
import { requestRender } from '../render/invalidate.ts'
import './whatif.css'

export interface WhatIfViewDeps {
  right: HTMLElement
  requestCompare(orders: Order[]): number
  cancelCompare(): void
  /** Adopt the other world: re-simulate with B's orders (a cache hit), keeping the year. */
  adopt(orders: Order[], keepYear: number): void
  /** Write cmp= (null clears it). */
  setCmpParam(value: string | null): void
  setYear(year: number): void
  flyToCell(cell: number): void
  year(): number
  positions(): Float32Array | null
  /** The swipe globe (render/polities.ts uClip, historyView.setAlt): on with the other world, off with null. */
  setSwipe?(alt: History | null, pMatch: Int16Array | null): void
  /** The world (for the whatif saga's names and seed). */
  world(): World | null
  /** The register chosen in the Sagas panel (the whatif saga starts in it). */
  legend(): boolean
}

export interface WhatIfView {
  /** Compare the history shown with a run of these orders. */
  open(ask: CompareAsk): void
  onResult(r: CompareResult): void
  onProgress(years: number, target: number): void
  onError(message: string): void
  /** A history was swapped in (the comparison goes stale unless it is the one compared). */
  commit(h: History | null): void
  close(): void
  readonly shown: WhatIfShown | null
  readonly swipe: boolean
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

export function createWhatIfView(deps: WhatIfViewDeps): WhatIfView {
  const root = el('div', 'panel whatif hidden collapsed')
  const head = el('button', 'gp-head')
  head.type = 'button'
  head.title = 'Compare the history shown with the world without an order, or with another one (W)'
  const title = el('span', 'gp-title', 'What if')
  const count = el('span', 'gp-count')
  const caret = el('span', 'caret')
  caret.setAttribute('aria-hidden', 'true')
  head.append(title, count, caret)
  const body = el('div', 'gp-body')
  body.id = 'whatif-body'
  head.setAttribute('aria-controls', body.id)
  const header = el('div', 'wi-header')
  const status = el('div', 'gp-note wi-status')
  const canvas = el('canvas', 'wi-timeline')
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', 'How alike the two worlds are, decade by decade')
  const firstHead = el('div', 'ng-sub', 'What changed first')
  const first = el('div', 'wi-list')
  const partHead = el('div', 'ng-sub', 'The worlds part')
  const caution = el('div', 'gp-note wi-caution')
  const part = el('div', 'wi-list')
  const sagaHost = el('div', 'wi-saga')
  const buttons = el('div', 'wi-buttons')
  const swipeBtn = el('button', 'gp-link', 'Swipe')
  swipeBtn.type = 'button'
  swipeBtn.setAttribute('aria-pressed', 'false')
  swipeBtn.title = 'Show the other world beside this one on the globe, split by a divider you can drag ([ and ] move it)'
  const adoptBtn = el('button', 'gp-link', 'Adopt the other world')
  adoptBtn.type = 'button'
  adoptBtn.title = 'Make the other world the one shown (its orders replace yours)'
  const againBtn = el('button', 'gp-link', 'Compare again')
  againBtn.type = 'button'
  const cancelBtn = el('button', 'gp-link', 'Cancel')
  cancelBtn.type = 'button'
  const closeBtn = el('button', 'gp-link', 'Close')
  closeBtn.type = 'button'
  buttons.append(swipeBtn, adoptBtn, againBtn, cancelBtn, closeBtn)
  const empty = el('div', 'gp-note wi-empty', 'Choose “what if not?” on an order in the Nudge panel (O), “Compare with no orders”, or “What if instead…” beside Urge.')
  body.append(empty, header, status, canvas, firstHead, first, partHead, caution, part, sagaHost, buttons)
  root.append(head, body)
  deps.right.insertBefore(root, deps.right.querySelector('.chronicle'))

  let collapsed = loadFlag('worldseed.whatif.collapsed', true)
  const syncCollapsed = () => {
    root.classList.toggle('collapsed', collapsed)
    head.setAttribute('aria-expanded', String(!collapsed))
  }
  syncCollapsed()
  const toggleCollapsed = (open?: boolean) => {
    const next = open === undefined ? !collapsed : !open
    if (next === collapsed) return
    collapsed = next
    saveFlag('worldseed.whatif.collapsed', collapsed)
    syncCollapsed()
    panelToggled('whatif', !collapsed)
    if (!collapsed) { draw(); window.setTimeout(() => root.scrollIntoView({ block: 'nearest' }), 80) }
  }
  head.addEventListener('click', () => toggleCollapsed())
  registerPanel('whatif', root, () => !collapsed, () => { if (!collapsed) toggleCollapsed() })
  addShortcut({ keys: ['w', 'W'], label: 'W', description: 'Show or hide the What if panel (compare with the world without an order)', group: 'Panels', run: () => (current ? (toggleCollapsed(), true) : false) })

  let current: History | null = null
  let pending: { ask: CompareAsk; id: number } | null = null
  let shown: WhatIfShown | null = null
  let stale = false
  let swipe = false
  let ticks: { a: { year: number }[]; b: { year: number }[] } = { a: [], b: [] }

  function setSwipe(on: boolean) {
    swipe = on && !!shown && shown.result.digest.divergence >= 0
    swipeBtn.setAttribute('aria-pressed', String(swipe))
    swipeBtn.classList.toggle('on', swipe)
    deps.setSwipe?.(swipe && shown ? shown.B : null, swipe && shown ? shown.result.digest.pMatch : null)
  }

  function render() {
    const s = shown
    const busy = !!pending
    empty.hidden = !!s || busy
    root.classList.toggle('hidden', !current)
    cancelBtn.hidden = !busy
    againBtn.hidden = busy || !stale || !s
    closeBtn.hidden = !s && !busy
    count.textContent = busy ? 'simulating…' : s ? (s.result.digest.divergence < 0 ? 'the same world' : `parted ${s.result.digest.divergence}`) : ''
    header.textContent = busy ? pending!.ask.label : s ? s.ask.label : ''
    const d = s?.result.digest
    const same = !!d && d.divergence < 0
    for (const x of [canvas, firstHead, first, partHead, caution, part, sagaHost]) x.hidden = !s || same || busy
    swipeBtn.hidden = adoptBtn.hidden = !s || busy || same
    if (!s || busy) { status.textContent = busy ? 'Simulating the other world…' : ''; return }
    if (same) {
      const f = s.ask.focus
      const story = f ? orderStory(f.world === 'A' ? s.A : s.B, f.k) : ''
      status.textContent = `Without this order the world would be the same${story ? `: ${story}` : ''}.`
      return
    }
    status.textContent = `${stale ? `Compared at year ${s.facts.T}; the history now runs to ${current?.years ?? s.facts.T}. ` : ''}The two worlds part in ${d!.divergence}${s.result.cached ? ' (from the cache)' : ''}.${s.result.skeleton ? ' (A light copy of the other world: its map shows states only.)' : ''}`
    // ---- what changed first ----
    first.replaceChildren()
    const nudgeTown = nudgeCellName(s)
    const line = (f: FirstDiff) => {
      const h = f.side === 'A' ? s.A : s.B
      const t = safeDescribe(h, f.event)
      if (!t) return null
      const r = el('div', 'gp-row wi-row')
      r.append(el('span', `wi-side ${f.side === 'A' ? 'here' : 'there'}`, f.side === 'A' ? 'here' : 'there'), el('span', 'wi-text', `${f.year}: ${t}${f.near && nudgeTown ? ` (near ${nudgeTown})` : ''}`))
      r.append(showLink(f.year, f.cell))
      return r
    }
    const pick = (xs: FirstDiff[]) => { const out: HTMLElement[] = []; for (const f of xs) { if (out.length >= 3) break; const r = line(f); if (r) out.push(r) } return out }
    first.append(...pick(s.facts.firstA), ...pick(s.facts.firstB))
    if (!first.childNodes.length) first.append(el('div', 'gp-note', 'Nothing the chronicle names, only small changes.'))
    // ---- the worlds part ----
    const k = s.facts.partTenth >= 0 ? s.facts.partTenth - d!.divergence : -1
    caution.textContent = k > 0
      ? `After ${k} years the two worlds share fewer than one event in ten. What follows are differences, not effects.`
      : `Beyond ${d!.divergence + CAUSAL_YEARS} the two worlds go their own ways. What follows are differences, not effects.`
    part.replaceChildren()
    for (const c of s.facts.items) {
      const t = consequenceText(s, c)
      if (!t) continue
      const r = el('div', 'gp-row wi-row')
      r.append(el('span', 'wi-text', t), showLink(c.year, c.cell))
      part.append(r)
    }
    if (s.facts.samePeoples.length) part.append(el('div', 'gp-note', `About the same in both: ${s.facts.samePeoples.map((p) => s.A.peoples[p]?.name ?? '').filter(Boolean).join(', ')}.`))
    // ---- the saga ----
    sagaHost.replaceChildren()
    sagaHost.append(sagaSection(s))
    draw()
  }

  /** "In the world without your order…": the whatif saga with its Chronicle/Legend switch, Copy and Download .md. */
  let sagaLegend: boolean | null = null
  function sagaSection(s: WhatIfShown): HTMLElement {
    const sec = el('div', 'wi-saga-sec')
    const top = el('div', 'wi-buttons')
    const headEl = el('div', 'ng-sub', s.ask.focus?.world === 'B' ? 'In the world of the other order…' : 'In the world without your order…')
    const reg = el('button', 'gp-link', '')
    reg.type = 'button'
    const copyB = el('button', 'gp-link', 'Copy')
    copyB.type = 'button'
    const dl = el('button', 'gp-link', 'Download .md')
    dl.type = 'button'
    top.append(reg, copyB, dl)
    const text = el('div', 'wi-saga-text')
    sec.append(headEl, top, text)
    let saga: Saga | null = null
    const tell = () => {
      const legend = sagaLegend ?? deps.legend()
      reg.textContent = legend ? 'Chronicle' : 'Legend'
      reg.title = legend ? 'Tell it as the plain chronicle' : 'Tell it as a legend'
      const w = deps.world()
      saga = whatifSaga(new Ctx(s.A, w, s.facts.T), new Ctx(s.B, w, s.facts.T), s, legend)
      text.replaceChildren(...saga.paragraphs.map((p, i) => el('p', `wi-saga-p${saga!.marks?.[i] === 'omen' ? ' omen' : ''}`, polish(p))))
    }
    reg.addEventListener('click', () => { sagaLegend = !(sagaLegend ?? deps.legend()); tell() })
    copyB.addEventListener('click', () => { if (saga) void navigator.clipboard?.writeText(sagaText(saga)).catch(() => {}) })
    dl.addEventListener('click', () => {
      if (!saga) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([sagaMarkdown(saga)], { type: 'text/markdown' }))
      a.download = 'what-if.md'
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    })
    tell()
    return sec
  }

  function nudgeCellName(s: WhatIfShown): string {
    const f = s.ask.focus
    const h = f?.world === 'B' ? s.B : s.A
    const r = f ? h.orderOutcomes?.[f.k] : undefined
    return r && r.place >= 0 ? settlementName(h, r.place) : ''
  }
  function nudgeCell(ask: CompareAsk, A: History, B: History): number {
    const f = ask.focus
    const h = f?.world === 'B' ? B : A
    const r = f ? h.orderOutcomes?.[f.k] : undefined
    return r && r.place >= 0 && r.place < h.settlements.length ? h.settlements[r.place].cell : -1
  }

  function showLink(year: number, cell: number): HTMLButtonElement {
    const b = el('button', 'gp-link wi-show', 'show')
    b.type = 'button'
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      deps.setYear(Math.max(0, year))
      if (cell >= 0) deps.flyToCell(cell)
    })
    return b
  }

  /** The divergence timeline (canvas). */
  function draw() {
    const s = shown
    if (!s || collapsed || canvas.hidden) return
    const d = s.result.digest
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = Math.max(120, canvas.clientWidth || 300), H = window.matchMedia('(min-width: 900px)').matches ? 72 : 56
    canvas.style.height = `${H}px`
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    const g = canvas.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    const T = Math.max(1, s.facts.T)
    const x = (y: number) => (y / T) * W
    const top = 12, bot = H - 12, mid = (top + bot) / 2
    const css = getComputedStyle(root)
    const accent = css.getPropertyValue('--accent').trim() || '#e0b060'
    // the similarity curve: filled, grey to the divergence, accent after
    const D = d.similarity.length
    for (const part of [0, 1] as const) {
      g.beginPath()
      g.moveTo(part ? x(d.divergence) : 0, bot)
      for (let k = 0; k < D; k++) {
        const y0 = k * 10
        if (part === 0 && y0 > d.divergence) break
        if (part === 1 && y0 + 10 < d.divergence) continue
        g.lineTo(x(Math.max(part ? d.divergence : 0, y0)), bot - d.similarity[k] * (bot - top))
        g.lineTo(x(Math.min(T, y0 + 10)), bot - d.similarity[k] * (bot - top))
      }
      g.lineTo(part ? W : x(d.divergence), bot)
      g.closePath()
      g.fillStyle = part ? accent : 'rgba(255,255,255,0.25)'
      g.globalAlpha = part ? 0.55 : 1
      g.fill()
      g.globalAlpha = 1
    }
    // the notch at the divergence
    g.fillStyle = '#fff'
    g.fillRect(Math.round(x(d.divergence)) - 1, top - 6, 2, bot - top + 12)
    // ticks: our world's above the axis, the other's below
    g.fillStyle = 'rgba(255,255,255,0.85)'
    for (const t of ticks.a) g.fillRect(Math.round(x(t.year)), 0, 1.5, 7)
    g.fillStyle = accent
    for (const t of ticks.b) g.fillRect(Math.round(x(t.year)), H - 7, 1.5, 7)
    // the year shown
    g.fillStyle = 'rgba(255,255,255,0.5)'
    g.fillRect(Math.round(x(deps.year())), top, 1, bot - top)
    g.fillStyle = 'rgba(255,255,255,0.08)'
    g.fillRect(0, mid, W, 0.5)
  }
  canvas.addEventListener('click', (e) => {
    if (!shown) return
    const r = canvas.getBoundingClientRect()
    deps.setYear(Math.round(((e.clientX - r.left) / Math.max(1, r.width)) * shown.facts.T))
    draw()
    requestRender()
  })
  window.addEventListener('resize', () => draw())

  swipeBtn.addEventListener('click', () => setSwipe(!swipe))
  adoptBtn.addEventListener('click', () => {
    if (!shown) return
    const orders = shown.ask.orders
    api.close()
    deps.adopt(orders, Math.floor(deps.year()))
  })
  againBtn.addEventListener('click', () => { if (shown) api.open(shown.ask) })
  cancelBtn.addEventListener('click', () => { deps.cancelCompare(); pending = null; deps.setCmpParam(null); render() })
  closeBtn.addEventListener('click', () => api.close())

  const api: WhatIfView = {
    open(ask) {
      if (!current) return
      setSwipe(false)
      pending = { ask, id: deps.requestCompare(ask.orders) }
      deps.setCmpParam(ask.orders.length ? encodeOrders(ask.orders) : '-')
      stale = false
      toggleCollapsed(true)
      render()
    },
    onResult(r) {
      if (!pending || pending.id !== r.compareId || !current) return
      const ask = pending.ask
      pending = null
      const A = current, B = r.alt
      const facts = whatIfFacts(A, B, r.fpA, r.fpB, r.digest, nudgeCell(ask, A, B), deps.positions())
      shown = { ask, A, B, result: r, facts, pdA: politiesOf(A), pdB: politiesOf(B) }
      ticks = r.digest.divergence >= 0 ? { a: topEvents(A, r.digest.divergence, facts.T, 8), b: topEvents(B, r.digest.divergence, facts.T, 8) } : { a: [], b: [] }
      stale = A.years !== facts.T
      render()
    },
    onProgress(years, target) {
      if (!pending) return
      status.textContent = `Simulating the other world… ${Math.round((100 * years) / Math.max(1, target))}%`
    },
    onError(message) {
      pending = null
      status.textContent = 'The other world could not be simulated.'
      console.error('what-if:', message)
      render()
      status.textContent = 'The other world could not be simulated.'
    },
    commit(h) {
      current = h
      if (!h) { api.close(); root.classList.add('hidden'); return }
      if (shown && shown.A !== h) {
        // (an extension or a new run of the world shown: the comparison is of an older one)
        stale = true
        if (h.years === shown.facts.T && encodeOrders(h.orders ?? []) === encodeOrders(shown.A.orders ?? [])) stale = false
      }
      render()
    },
    close() {
      if (pending) deps.cancelCompare()
      pending = null
      setSwipe(false)
      shown = null
      ticks = { a: [], b: [] }
      deps.setCmpParam(null)
      sagaHost.replaceChildren()
      render()
    },
    get shown() {
      return shown
    },
    get swipe() {
      return swipe
    },
  }
  return api
}
