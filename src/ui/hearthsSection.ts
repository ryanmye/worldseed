// The Nudge panel's "Hearths" section (at its top, ui/nudgePanel.ts): where the first peoples began. Each hearth the player
// planted (HistoryOptions.cradles, c= in the address) with what became of it in the history shown (History.cradlePlaced:
// set down as wished, moved to the nearest land, or the place could not be lived on), a link to the place and to the
// people's first town; and "Replant the hearths", which goes to year 0 and opens the hearth picker (ui/hearthPicker.ts)
// on the main globe or map: Done re-simulates the world with the new list as orders do (a new run from year 0, the
// history on screen kept until it arrives, then swapped in at year 0 keeping the camera); Esc leaves it unchanged and
// goes back to the year it was at.

import type { History } from '../contract.ts'
import { canonicalCradles, CradleOutcome, encodeCradles, settlementNameAt } from '../contract.ts'
import type { HearthPicker } from './hearthPicker.ts'
import { cradlesOf } from './cradlesData.ts'

export interface HearthsSectionDeps {
  hearths: HearthPicker
  getCradles(): number[]
  requestCradles(cradles: number[], keepYear: number): void
  year(): number
  setYear(year: number): void
  flyToCell(cell: number): void
  onSelectSettlement(id: number): void
  /** Picking begins: the panel's own place-picking stops. */
  onStart(): void
}

export interface HearthsSection {
  readonly el: HTMLElement
  commit(h: History | null): void
  refresh(): void
  /** "3 hearths" for the panel's head ('' for none). */
  countWords(): string
}

const OUTCOME = ['the world’s choice', 'as wished', 'moved to land', 'could not be lived on']
const OUTCOME_CLASS = ['expired', 'fulfilled', 'partly', 'failed']
const OUTCOME_TITLE = [
  'The simulation chose where this people began',
  'The people began at the place chosen',
  'The place chosen was water or ice: the people came ashore at the nearest land',
  'The place chosen could not be lived in, and no land near it either: the people began where the world would have them',
]

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

export function createHearthsSection(deps: HearthsSectionDeps): HearthsSection {
  const root = el('div', 'ng-hearths')
  const head = el('div', 'ng-sub', 'Hearths')
  const note = el('div', 'gp-note ng-hearth-note')
  const list = el('div', 'ng-list')
  const replant = el('button', 'gp-link ng-replant', 'Replant the hearths')
  replant.type = 'button'
  replant.title = 'Choose on the map where the first peoples begin (goes to year 0; Done re-runs the history)'
  root.append(head, note, list, replant)

  let history: History | null = null
  let yearBefore = 0

  const link = (label: string, run: () => void) => {
    const b = el('button', 'gp-link', label)
    b.type = 'button'
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      run()
    })
    return b
  }

  function refresh() {
    const h = history
    const wish = deps.getCradles()
    const n = wish.filter((c) => c >= 0).length
    list.replaceChildren()
    replant.textContent = deps.hearths.active ? 'planting… (Done or Esc)' : n > 0 ? 'Replant the hearths' : 'Plant the first hearths'
    replant.disabled = !h
    if (!h) {
      note.textContent = ''
      return
    }
    const rec = cradlesOf(h)
    const shown = rec ? canonicalCradles(Array.from(rec.wish)) : []
    const inSync = encodeCradles(shown) === encodeCradles(wish)
    if (n === 0 && !rec) {
      note.textContent = 'The first peoples began where the world would have them.'
      return
    }
    if (!inSync) {
      note.textContent = 'Re-running the history with the hearths planted…'
      return
    }
    note.textContent = ''
    if (!rec) return
    const P = h.peoples.length
    for (let p = 0; p < P; p++) {
      const o = rec.placed[p]
      if (o === CradleOutcome.Chosen) continue
      const r = el('div', 'gp-row ng-row')
      const chip = el('span', `ng-chip ${OUTCOME_CLASS[o] ?? 'expired'}`, OUTCOME[o] ?? '?')
      chip.title = OUTCOME_TITLE[o] ?? ''
      const founder = h.peoples[p]?.founder ?? -1
      const text = el('span', 'ng-text', `${p + 1} · the ${h.peoples[p]?.name ?? 'people'}${founder >= 0 && o !== CradleOutcome.Rejected ? `, at ${settlementNameAt(h, founder, 0)}` : ''}`)
      r.title = OUTCOME_TITLE[o] ?? ''
      const links = el('span', 'ng-links')
      const wished = rec.wish[p]
      if (wished >= 0) links.appendChild(link(o === CradleOutcome.Placed ? 'the place' : 'the place chosen', () => deps.flyToCell(wished)))
      if (founder >= 0) {
        if (links.childNodes.length) links.append(' · ')
        links.appendChild(link(o === CradleOutcome.Rejected ? 'where they began' : 'their first town', () => deps.onSelectSettlement(founder)))
      }
      r.append(chip, text, links)
      list.appendChild(r)
    }
  }

  replant.addEventListener('click', () => {
    if (!history) return
    if (deps.hearths.active) {
      deps.hearths.bar.querySelector<HTMLButtonElement>('.hearth-done')?.click()
      return
    }
    deps.onStart()
    // (the bar at the top of the view; the start page had it over its disc)
    const bar = deps.hearths.bar
    bar.classList.remove('in-landing')
    bar.classList.add('in-app')
    document.body.appendChild(bar)
    yearBefore = Math.floor(deps.year())
    deps.setYear(0)
    const before = canonicalCradles(deps.getCradles())
    deps.hearths.start({
      max: history.peoples.length,
      cells: before,
      onDone(cells) {
        if (encodeCradles(cells) !== encodeCradles(before)) deps.requestCradles(cells, 0)
        refresh()
      },
      onCancel() {
        deps.setYear(yearBefore)
        refresh()
      },
    })
    refresh()
  })

  return {
    el: root,
    commit(h) {
      history = h
      if (!h) deps.hearths.stop()
      refresh()
    },
    refresh,
    countWords() {
      const n = deps.getCradles().filter((c) => c >= 0).length
      return n > 0 ? `${n} ${n === 1 ? 'hearth' : 'hearths'}` : ''
    },
  }
}
