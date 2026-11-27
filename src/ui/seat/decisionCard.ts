// seat: the decision card (seat-mode §6.3). Touch-first: designed at 360×640 first. On a phone (isCompact) the card is a
// panel along the bottom with full-width option buttons at least 48 px tall in thumb reach (no swipe chooses anything); on
// a wider screen it is a 420 px card at the top centre, keys 1-4 pick and Esc lets the court decide. Two cards of one year
// come one after the other ("1 of 2"). The map above stays live; "Show me" flies to the place.
import type { History } from '../../contract.ts'
import { isCompact } from '../compact.ts'
import { decisionSituation, decisionTitle, optionExpects, optionLabel } from './seatFormat.ts'
import './seat.css'

export interface DecisionCard {
  /** Show decision d of h (`n` of `total` this year); `pick(option)` once chosen; `showMe()` for the place. */
  show(h: History, d: number, n: number, total: number, pick: (option: number) => void, showMe: (() => void) | null): void
  /** A plain message card (the seat lost, waiting) with buttons; null buttons: a status line only. */
  message(title: string, text: string, buttons: { label: string; run: () => void }[] | null): void
  hide(): void
  readonly open: boolean
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

export function createDecisionCard(parent: HTMLElement): DecisionCard {
  const root = el('div', 'seat-card hidden')
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-live', 'polite')
  parent.appendChild(root)
  let keys: ((e: KeyboardEvent) => void) | null = null
  const clearKeys = () => { if (keys) window.removeEventListener('keydown', keys); keys = null }
  const frame = (title: string, sub: string) => {
    clearKeys()
    root.replaceChildren()
    root.classList.remove('hidden')
    root.classList.toggle('seat-card-compact', isCompact())
    const head = el('div', 'seat-card-head')
    head.append(el('div', 'seat-card-title', title))
    if (sub) head.append(el('div', 'seat-card-sub', sub))
    root.append(head)
  }
  const api: DecisionCard = {
    get open() { return !root.classList.contains('hidden') },
    show(h, d, n, total, pick, showMe) {
      const D = h.seat!.decisions
      frame(decisionTitle(h, d), `${D.year[d]}${total > 1 ? ` · ${n} of ${total}` : ''}`)
      root.append(el('p', 'seat-card-text', decisionSituation(h, d)))
      const opts = el('div', 'seat-card-options')
      const count = D.optStart[d + 1] - D.optStart[d]
      let court = -1
      let done = false
      const choose = (i: number) => { if (done) return; done = true; clearKeys(); pick(i) }
      for (let i = 0; i < count; i++) {
        const o = D.optStart[d] + i
        if (D.orderStart[o] === D.orderStart[o + 1]) court = i
        const b = el('button', 'seat-opt')
        b.type = 'button'
        b.append(el('span', 'seat-opt-label', `${isCompact() ? '' : `${i + 1}. `}${optionLabel(h, d, i)}`), el('span', 'seat-opt-note', optionExpects(h, d, i)))
        b.addEventListener('click', () => choose(i))
        opts.append(b)
      }
      root.append(opts)
      if (showMe) {
        const m = el('button', 'seat-showme', 'Show me')
        m.type = 'button'
        m.addEventListener('click', showMe)
        root.append(m)
      }
      keys = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
        const k = Number(e.key)
        if (k >= 1 && k <= count) { e.preventDefault(); choose(k - 1) }
        else if (e.key === 'Escape' && court >= 0) { e.preventDefault(); choose(court) }
      }
      window.addEventListener('keydown', keys)
      ;(opts.firstElementChild as HTMLElement | null)?.focus({ preventScroll: true })
    },
    message(title, text, buttons) {
      frame(title, '')
      root.append(el('p', 'seat-card-text', text))
      if (buttons) {
        const opts = el('div', 'seat-card-options')
        for (const x of buttons) {
          const b = el('button', 'seat-opt')
          b.type = 'button'
          b.append(el('span', 'seat-opt-label', x.label))
          b.addEventListener('click', x.run)
          opts.append(b)
        }
        root.append(opts)
      }
    },
    hide() { clearKeys(); root.classList.add('hidden') },
  }
  return api
}
