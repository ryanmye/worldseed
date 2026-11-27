// Partisan sagas (experience-whatif-director-sagas §3.6 UI): the "Told by" selector of the Sagas panel and the library
// ("The record (neutral)", then the peoples, then the states existing by the year told; one native <select>, so phones
// get their own picker), the pov= URL parameter, and the tag line of a partisan telling with its link to the record.

import type { History, World } from '../../contract.ts'
import { Ctx } from './facts.ts'
import { parsePov, povKey, type Pov } from './lens.ts'

export { parsePov, povKey }
export type { Pov }

/** A "Told by" select. */
export function createPovSelect(onChange: (pov: Pov | null) => void): HTMLSelectElement {
  const sel = document.createElement('select')
  sel.className = 'view-select sg-pov-select'
  sel.title = 'Who tells it: the neutral record, or a people or a state (numbers and blame are then the teller\'s)'
  sel.setAttribute('aria-label', 'Told by')
  sel.addEventListener('change', () => onChange(parsePov(sel.value)))
  return sel
}

/** Fills `sel` with the tellers at `year` and selects `pov`. */
export function fillPovSelect(sel: HTMLSelectElement, h: History, world: World | null, year: number, pov: Pov | null): void {
  const c = new Ctx(h, world, year)
  const opts: [string, string][] = [['', 'Told by: the record (neutral)']]
  h.peoples.forEach((p, i) => opts.push([`people:${i}`, `Told by the ${p.name}`]))
  const pd = c.pd
  if (pd) {
    const alive: number[] = []
    for (let p = 0; p < pd.count; p++) if (pd.list[p].foundedYear <= year) alive.push(p)
    alive.sort((a, b) => c.ppeak(b).pop - c.ppeak(a).pop || a - b)
    for (const p of alive.slice(0, 60)) opts.push([`state:${p}`, `Told in the ${c.pgreatTitle(p)}`])
    if (pov?.kind === 'state' && !alive.slice(0, 60).includes(pov.id) && pov.id < pd.count) opts.push([povKey(pov), `Told in the ${c.pgreatTitle(pov.id)}`])
  }
  const want = pov ? povKey(pov) : ''
  const key = opts.map((o) => o[0]).join(',')
  if (sel.dataset.key !== key) {
    sel.replaceChildren(...opts.map(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o }))
    sel.dataset.key = key
  }
  sel.value = want
}

/**
 * "Partisan: numbers and blame are the teller's · Read the record" (hidden without a teller). With beliefs in the history
 * (`believed`), it adds that strengths, motives and secret alliances are as the teller's court believed them.
 */
export function createPartisanTag(onRecord: () => void): { el: HTMLElement; set(pov: Pov | null, believed?: boolean): void } {
  const el = document.createElement('div')
  el.className = 'gp-note sg-partisan'
  const t = document.createElement('span')
  const plain = 'Partisan: numbers and blame are the teller’s. '
  t.textContent = plain
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'gp-link'
  b.textContent = 'Read the record'
  b.title = 'The neutral version of the same saga'
  b.addEventListener('click', onRecord)
  el.append(t, b)
  el.hidden = true
  return {
    el,
    set: (pov, believed = false) => {
      el.hidden = !pov
      t.textContent = believed ? `${plain}Strengths, motives and secret alliances are as its court believed them. ` : plain
    },
  }
}
