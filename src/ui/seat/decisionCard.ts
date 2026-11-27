// seat: the decision screen (seat-mode §6.3). A dimmed backdrop over the globe; a title banner with the situation and its
// header illustration (procedural, art/scenes.ts); 2-4 portrait option cards in a row (on a phone, a scroll-snap carousel
// with the next card peeking and Prev / Next); below them "Let the court decide" (the court's own course: Esc) and a small
// "Show me" that lifts the screen to look at the place, with a pill to come back. Each card is one labelled button: a
// corner badge (what it costs or risks), the option's name, a framed illustration (its glyph over a small landscape in the
// card's tint), a type tag and a line of consequence. Keys 1-4 pick the cards in order. The art is decorative (aria-hidden).
// Reduced motion: no lift or scroll animation (seat.css). Plain messages (reaching the reign, the seat lost) are a small
// panel without the backdrop, so the timeline can be watched.
import type { History } from '../../contract.ts'
import { isCompact } from '../compact.ts'
import { decisionCardModel, type CardModel } from './cardModel.ts'
import { glyphInner, optionGlyph } from './art/glyphs.ts'
import { decisionScene, optionArt } from './art/scenes.ts'
import './seat.css'

export interface DecisionCard {
  /** Show decision d of h (`n` of `total` this year); `pick(option)` once chosen; `showMe()` for the place. */
  show(h: History, d: number, n: number, total: number, pick: (option: number) => void, showMe: (() => void) | null): void
  /** A plain message (the seat lost, waiting) with buttons; null buttons: a status line only. */
  /** `callbacks`: decisions whose outcomes the message tells (lane N3: the bots' visible-consequence metric). `extra`: a DOM node shown under the text (the reign summary's share link). */
  message(title: string, text: string, buttons: { label: string; run: () => void }[] | null, callbacks?: number[], extra?: HTMLElement): void
  hide(): void
  readonly open: boolean
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
/** An element holding trusted, generated SVG markup (our own art strings, no user text). */
function svgHost(cls: string, svg: string): HTMLElement {
  const e = el('span', cls)
  e.setAttribute('aria-hidden', 'true')
  e.innerHTML = svg
  return e
}

/**
 * The Authority meter: how far the seat's realm still waits on the ruler (1 - deference / SEAT.deferFull), and what leaving this
 * matter would cost (less for a divisive one). Hover or tap for the explanation. (Values: cardModel.ts authorityOf.)
 */
function authorityMeter(a: CardModel['authority']): HTMLElement {
  const auth = a.value, cost = a.cost, why = a.why
  const box = el('div', 'seat-authority')
  box.title = why
  box.tabIndex = 0
  box.setAttribute('role', 'meter')
  box.setAttribute('aria-valuemin', '0'); box.setAttribute('aria-valuemax', '100'); box.setAttribute('aria-valuenow', String(Math.round(auth * 100)))
  box.setAttribute('aria-label', `Authority ${Math.round(auth * 100)} of 100. ${why}`)
  const bar = el('span', 'seat-authority-bar')
  const fill = el('span', 'seat-authority-fill')
  fill.style.width = `${(auth * 100).toFixed(0)}%`
  const after = el('span', 'seat-authority-cost')
  after.style.left = `${(Math.max(0, auth - cost) * 100).toFixed(0)}%`
  after.style.width = `${(Math.min(auth, cost) * 100).toFixed(0)}%`
  bar.append(fill, after)
  // (lane N3: the number shown, and the cost said as it is: now, before it recovers with the decisions you take)
  box.append(el('span', 'seat-authority-label', `Authority ${Math.round(auth * 100)}`), bar, el('span', 'seat-authority-note', `leaving it: −${Math.round(Math.min(auth, cost) * 100)} now`))
  box.addEventListener('click', () => box.classList.toggle('open'))
  box.append(el('span', 'seat-authority-why', why))
  return box
}

export function createDecisionCard(parent: HTMLElement): DecisionCard {
  // the decision screen
  const screen = el('div', 'seat-screen hidden')
  screen.setAttribute('role', 'dialog')
  screen.setAttribute('aria-modal', 'true')
  const peekPill = el('button', 'seat-peek-back hidden', 'Back to the decision')
  peekPill.type = 'button'
  // the message panel
  const msg = el('div', 'seat-msg hidden')
  msg.setAttribute('role', 'status')
  msg.setAttribute('aria-live', 'polite')
  parent.append(screen, peekPill, msg)
  let keys: ((e: KeyboardEvent) => void) | null = null
  const clearKeys = () => { if (keys) window.removeEventListener('keydown', keys, true); keys = null }
  const setPeek = (on: boolean) => { screen.classList.toggle('peek', on); peekPill.classList.toggle('hidden', !on) }
  peekPill.addEventListener('click', () => setPeek(false))

  const api: DecisionCard = {
    get open() { return !screen.classList.contains('hidden') || !msg.classList.contains('hidden') },
    show(h, d, n, total, pick, showMe) {
      clearKeys()
      msg.classList.add('hidden')
      setPeek(false)
      screen.replaceChildren()
      screen.classList.remove('hidden')
      const compact = isCompact()
      screen.classList.toggle('seat-compact', compact)
      const D = h.seat!.decisions
      const model = decisionCardModel(h, d, n, total) // (the screen's content: cardModel.ts, the bots read the same)
      const title = model.title
      screen.setAttribute('aria-label', title)
      // banner and situation
      const banner = el('div', 'seat-banner')
      banner.append(el('h2', 'seat-banner-title', title), el('div', 'seat-banner-sub', model.sub))
      const sit = el('div', 'seat-situation')
      sit.append(svgHost('seat-scene-frame', decisionScene(D.kind[d], d)), el('p', 'seat-situation-text', model.situation))
      // cards
      let court = -1
      let done = false
      const choose = (i: number) => { if (done) return; done = true; clearKeys(); pick(i) }
      const row = el('div', 'seat-cards')
      const order: number[] = []
      court = model.defer.option
      for (const m of model.options) {
        const i = m.option
        order.push(i)
        const b = el('button', `seat-opt seat-tint-${m.tint}`)
        b.type = 'button'
        b.setAttribute('aria-label', m.aria)
        b.dataset.key = String(m.key) // (the glyph's key and the option sent: read by the UI bots, scripts/bots-ui.mjs)
        b.dataset.option = String(i)
        if (m.court) b.dataset.court = '1'
        const badge = el('span', 'seat-opt-badge')
        badge.append(svgHost('seat-opt-badge-glyph', optionGlyph(m.key, 14)), el('span', '', m.badge))
        const head = el('span', 'seat-opt-head')
        head.append(el('span', 'seat-opt-num', String(order.length)), el('span', 'seat-opt-label', m.label))
        const risk = el('span', `seat-opt-risk risk-${m.stakes.risk}`, `Risk: ${m.stakes.risk}`)
        b.append(badge, head, svgHost('seat-opt-frame', optionArt(glyphInner(m.key), d * 8 + i)), el('span', 'seat-opt-tag', m.tag), el('span', 'seat-opt-note', m.note), risk, ...(m.stakes.odds ? [el('span', 'seat-opt-odds', m.stakes.odds)] : []))
        b.addEventListener('click', () => choose(i))
        row.append(b)
      }
      // lane N3: since the last card: the realm's news (who died, who reigns) and what came of earlier choices
      const since = el('div', 'seat-since')
      for (const t of model.news) since.append(el('p', 'seat-news', t))
      for (const c of model.callbacks) since.append(el('p', 'seat-callback', c.text))
      if (model.ambition) since.append(el('p', 'seat-ambition', model.ambition))
      if (model.hud) {
        const o = el('p', 'seat-odds')
        o.append(el('span', 'seat-odds-label', 'Odds the realm stands 50 years: '), el('strong', '', model.hud.oddsText), el('span', `seat-odds-change trend-${model.hud.oddsTrend}`, model.hud.oddsChange ? ` ${model.hud.oddsChange}` : ''))
        o.title = 'If things stay as they are: the chance of 50 years with no overthrow, contested succession, default, lost town or lost war (the throne panel has the hazards).'
        since.append(o)
      }
      screen.append(banner, sit, ...(since.childElementCount ? [since] : []), authorityMeter(model.authority), row)
      // phone: Prev / Next under the carousel
      if (compact && order.length > 1) {
        const nav = el('div', 'seat-nav')
        const prev = el('button', 'seat-nav-btn', 'Prev'), next = el('button', 'seat-nav-btn', 'Next')
        prev.type = next.type = 'button'
        const pager = el('span', 'seat-nav-pager', `1 / ${order.length}`)
        const at = () => Math.round(row.scrollLeft / Math.max(1, (row.firstElementChild as HTMLElement | null)?.offsetWidth ?? 1))
        const go = (k: number) => { const c = row.children[Math.max(0, Math.min(order.length - 1, k))] as HTMLElement | undefined; c?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }
        prev.addEventListener('click', () => go(at() - 1))
        next.addEventListener('click', () => go(at() + 1))
        row.addEventListener('scroll', () => { pager.textContent = `${Math.min(order.length, at() + 1)} / ${order.length}` }, { passive: true })
        nav.append(prev, pager, next)
        screen.append(nav)
      }
      // the court's own course, Show me
      const actions = el('div', 'seat-actions')
      {
        // the matter left to the body that decides without the player: a cautious court's pick, at a cost in authority
        const { words, pickLabel: pickWords, hint } = model.defer
        const skip = el('button', 'seat-skip')
        skip.type = 'button'
        skip.append(el('span', 'seat-skip-label', words), el('span', 'seat-skip-note', model.defer.note))
        skip.title = `${words}: ${pickWords}. ${hint} (Esc)`
        skip.setAttribute('aria-label', `${words}. They would choose ${pickWords}. ${hint} (Escape)`)
        skip.addEventListener('click', () => choose(court))
        actions.append(skip)
      }
      if (showMe) {
        const m = el('button', 'seat-showme', 'Show me')
        m.type = 'button'
        m.addEventListener('click', () => { setPeek(true); showMe() })
        actions.append(m)
      }
      screen.append(actions)
      keys = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
        if (screen.classList.contains('peek')) { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setPeek(false) } return }
        // (lane N3: the card's keys are its own while it is shown: 1-4 no longer also set the playback speed; capture phase)
        if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault(); e.stopImmediatePropagation()
          const k = Number(e.key)
          if (k >= 1 && k <= order.length) choose(order[k - 1])
        } else if (e.key === 'Escape' && court >= 0) { e.preventDefault(); e.stopImmediatePropagation(); choose(court) }
      }
      window.addEventListener('keydown', keys, true)
      ;(row.firstElementChild as HTMLElement | null)?.focus({ preventScroll: true })
    },
    message(title, text, buttons, _callbacks, extra) {
      clearKeys()
      screen.classList.add('hidden')
      setPeek(false)
      msg.replaceChildren()
      msg.classList.remove('hidden')
      msg.classList.toggle('seat-compact', isCompact())
      msg.append(el('div', 'seat-msg-title', title), el('p', 'seat-msg-text', text))
      if (extra) msg.append(extra)
      if (buttons) {
        const opts = el('div', 'seat-msg-buttons')
        for (const x of buttons) {
          const b = el('button', 'seat-skip', x.label)
          b.type = 'button'
          b.addEventListener('click', x.run)
          opts.append(b)
        }
        msg.append(opts)
      }
    },
    hide() { clearKeys(); screen.classList.add('hidden'); msg.classList.add('hidden'); setPeek(false) },
  }
  return api
}
