// The city view's heads-up card (render/cityView.ts): the town's name, its people and state,
// its population and the year, what the view looks toward and the landmarks in view; the
// view's controls (turn, raise and lower, closer and further) and the way back to the globe.
// A small label follows the pointer over a landmark. Text is rewritten only when it changes,
// and only on frames that are drawn anyway.

import { landmarkNameAt, settlementNameAt, type History } from '../contract.ts'
import { formatInt, peopleName, peopleOf } from './format.ts'
import { polityAtYear, politiesOf } from './politiesData.ts'
import './cityCard.css'

export interface CityCardCallbacks {
  onBack(): void
  onTurn(rad: number): void
  onRaise(k: number): void
  onZoom(k: number): void
}

export interface CityCard {
  show(flying: boolean): void
  hide(): void
  /** Refresh for the year; `landmarks`: ids of the landmarks on screen, nearest first. */
  update(h: History, id: number, year: number, focus: string, landmarks: readonly number[], flying: boolean): void
  /** The label by the pointer (CSS px in the page), or null to hide it. */
  hover(text: string | null, x: number, y: number): void
}

export function createCityCard(container: HTMLElement, cb: CityCardCallbacks): CityCard {
  const root = document.createElement('div')
  root.className = 'city-card hidden'
  root.setAttribute('role', 'region')
  root.setAttribute('aria-label', 'City view')
  root.innerHTML = `
    <div class="cc-name"></div>
    <div class="cc-sub"></div>
    <div class="cc-pop"></div>
    <div class="cc-focus"></div>
    <div class="cc-lm"></div>
    <div class="cc-ctl">
      <button type="button" data-a="left" title="Turn left (Q)" aria-label="Turn left">⟲</button>
      <button type="button" data-a="right" title="Turn right (E)" aria-label="Turn right">⟳</button>
      <button type="button" data-a="up" title="Raise the view (X)" aria-label="Raise the view">▲</button>
      <button type="button" data-a="down" title="Lower the view (Z)" aria-label="Lower the view">▼</button>
      <button type="button" data-a="in" title="Closer (+)" aria-label="Closer">+</button>
      <button type="button" data-a="out" title="Further (−)" aria-label="Further">−</button>
      <button type="button" class="cc-back" title="Back to the globe (Esc)">Back to the globe</button>
    </div>`
  container.appendChild(root)
  const q = (s: string) => root.querySelector(s) as HTMLElement
  const nameEl = q('.cc-name'), subEl = q('.cc-sub'), popEl = q('.cc-pop'), focusEl = q('.cc-focus'), lmEl = q('.cc-lm')
  const ctl = q('.cc-ctl')
  ctl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button')
    if (!b) return
    if (b.classList.contains('cc-back')) cb.onBack()
    const a = b.dataset.a
    if (a === 'left') cb.onTurn(-0.35)
    else if (a === 'right') cb.onTurn(0.35)
    else if (a === 'up') cb.onRaise(1.25)
    else if (a === 'down') cb.onRaise(0.8)
    else if (a === 'in') cb.onZoom(0.75)
    else if (a === 'out') cb.onZoom(1.33)
  })
  const tip = document.createElement('div')
  tip.className = 'city-tip hidden'
  container.appendChild(tip)

  const set = (el: HTMLElement, text: string) => {
    if (el.textContent !== text) el.textContent = text
    el.hidden = text === ''
  }

  return {
    show(flying: boolean) {
      root.classList.remove('hidden')
      root.classList.toggle('flying', flying)
    },
    hide() {
      root.classList.add('hidden')
      tip.classList.add('hidden')
    },
    update(h, id, year, focus, landmarks, flying) {
      root.classList.toggle('flying', flying)
      const y = Math.floor(year)
      set(nameEl, settlementNameAt(h, id, y))
      const p = peopleOf(h, id)
      const people = p >= 0 ? peopleName(h, p) : null
      const pd = politiesOf(h)
      const pol = pd ? polityAtYear(pd, id, y) : -1
      const state = pd && pol >= 0 ? pd.names[pol] : ''
      set(subEl, [people ? `${people} people` : '', state].filter(Boolean).join(' · '))
      const N = h.settlements.length
      const s = Math.max(0, Math.min(h.snapshotCount - 1, year / h.snapshotInterval))
      const s0 = Math.floor(s), s1 = Math.min(h.snapshotCount - 1, s0 + 1)
      const pop = h.population[s0 * N + id] + (h.population[s1 * N + id] - h.population[s0 * N + id]) * (s - s0)
      set(popEl, `${pop >= 1 ? formatInt(Math.round(pop)) + ' people' : 'Abandoned'} · year ${y}`)
      set(focusEl, focus ? `Looking toward the ${focus}` : '')
      const names: string[] = []
      for (const lm of landmarks) {
        const n = landmarkNameAt(h, lm, y)
        if (!names.includes(n)) names.push(n)
        if (names.length >= 3) break
      }
      set(lmEl, names.length ? `In view: ${names.join(', ')}${landmarks.length > names.length ? '…' : ''}` : '')
    },
    hover(text, x, y) {
      if (!text) {
        tip.classList.add('hidden')
        return
      }
      if (tip.textContent !== text) tip.textContent = text
      tip.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 12)}px)`
      tip.classList.remove('hidden')
    },
  }
}
