// Species in the UI: the Species panel (right column, under the Peoples), the legend of
// the Crops and Herds views (under the map panel), the species chips of the peoples panel
// rows, and the inspector's species section (its cell's main crop and herd, its people's
// species). Selecting a species (a row, a legend entry, a chip, or species=<id>) shows on
// the globe where it is grown now, where it is native, and the arcs along which it passed
// from people to people up to the current year (render/species.ts, driven by the history
// view through onSelect).
//
// Everything here is optional: without species data (speciesData.ts) the panel, legend
// and sections stay hidden. DOM writes happen only when a shown value changes.

import type { History } from '../contract.ts'
import { SPECIES_CATEGORY_NAMES } from './format.ts'
import { cropSnapshotAt, heldAt, holdersAt, type SpeciesData } from './speciesData.ts'
import { loadFlag, saveFlag } from './panels.ts'
import { ViewMode } from '../render/palette.ts'
import './species.css'

export interface SpeciesViewDeps {
  right: HTMLElement
  inspectorSlot: HTMLElement
  setUrlParam(name: string, value: string | null): void
  /** The selected species changed (-1: none). */
  onSelect(species: number): void
}

export interface SpeciesView {
  /** A history was committed: its species data (null hides everything); `keep` keeps the selection (a longer run). */
  setData(d: SpeciesData | null, h: History | null, peopleOf: Int32Array | null, peopleNames: string[] | null, keep: boolean): void
  select(species: number): void
  readonly selected: number
  readonly data: SpeciesData | null
  /** The Crops or Herds view shows its legend. */
  setViewMode(mode: string): void
  /** The inspector shows settlement `id` (-1: none; an expedition base gets no species section). */
  showSettlement(id: number, outpost: boolean): void
  /** Per frame (cheap: compares numbers). */
  tick(year: number): void
}

const pct = (n: number, d: number) => (d <= 0 ? '—' : n <= 0 ? '0%' : n / d < 0.005 ? '<1%' : `${Math.round((100 * n) / d)}%`)

/** A row of small coloured squares: the species a people holds at a year, with since when and from whom on hover. */
export class SpeciesChips {
  readonly el: HTMLSpanElement
  /** What is shown: the data, the people, and how many species it holds (a people's set only grows with the year, so the count identifies it). */
  private shownData: SpeciesData | null = null
  private shownPeople = -1
  private shownCount = -1
  private held: number[] = []
  constructor(cls = 'sp-chips') {
    this.el = document.createElement('span')
    this.el.className = cls
  }
  update(d: SpeciesData | null, p: number, year: number, peopleNames: string[] | null) {
    if (!d || p < 0) {
      if (this.shownCount !== -1) {
        this.shownCount = -1
        this.shownData = null
        this.el.replaceChildren()
      }
      return
    }
    let n = 0
    for (let s = 0; s < d.count; s++) {
      const y = d.year[p * d.count + s]
      if (y >= 0 && y <= year) n++
    }
    if (n === this.shownCount && d === this.shownData && p === this.shownPeople) return
    this.shownCount = n
    this.shownData = d
    this.shownPeople = p
    heldAt(d, p, year, this.held)
    this.el.replaceChildren()
    for (const s of this.held) {
      const c = document.createElement('span')
      c.className = `sp-chip cat${d.list[s].category}`
      c.style.background = d.css[s]
      c.dataset.species = String(s)
      const since = d.year[p * d.count + s]
      const src = d.source[p * d.count + s]
      const how = since <= 0 ? 'held from the start' : src >= 0 ? `since ${since}, from the ${peopleNames?.[src] ?? 'neighbours'}` : `since ${since}, ${d.list[s].category === 1 ? 'tamed' : 'first grown'} by them`
      c.title = `${d.names[s]}, ${d.gloss[s]}: ${how}`
      this.el.appendChild(c)
    }
  }
}

interface Row {
  s: number
  el: HTMLButtonElement
  held: HTMLSpanElement
  land: HTMLSpanElement
  shown: { held: number; land: number; selected: boolean }
}

export function createSpeciesView(deps: SpeciesViewDeps): SpeciesView {
  // ---------- panel ----------
  const root = document.createElement('div')
  root.className = 'panel species hidden'
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'pp-head'
  head.title = 'Show or hide the species'
  const title = document.createElement('span')
  title.className = 'pp-title'
  title.textContent = 'Species'
  const count = document.createElement('span')
  count.className = 'pp-count'
  const caret = document.createElement('span')
  caret.className = 'caret'
  caret.setAttribute('aria-hidden', 'true')
  head.append(title, count, caret)
  const body = document.createElement('div')
  body.className = 'sp-body'
  body.id = 'species-body'
  head.setAttribute('aria-controls', body.id)
  const cols = document.createElement('div')
  cols.className = 'sp-cols'
  cols.innerHTML = '<span></span><span>Species</span><span title="Peoples holding it">Held</span><span title="Share of the farmland (staples) or pasture (livestock) where it is the main one">Land</span>'
  const list = document.createElement('div')
  list.className = 'sp-list'
  const note = document.createElement('div')
  note.className = 'pp-note'
  note.textContent = 'Click a species to see where it is grown and how it spread.'
  body.append(cols, list, note)
  root.append(head, body)
  const chronicle = deps.right.querySelector('.chronicle')
  deps.right.insertBefore(root, chronicle)

  let collapsed = loadFlag('worldseed.species.collapsed', true)
  const syncCollapsed = () => {
    root.classList.toggle('collapsed', collapsed)
    head.setAttribute('aria-expanded', String(!collapsed))
  }
  syncCollapsed()
  head.addEventListener('click', () => {
    collapsed = !collapsed
    saveFlag('worldseed.species.collapsed', collapsed)
    syncCollapsed()
    shownYear = NaN
  })

  // ---------- legend of the Crops and Herds views ----------
  const legend = document.createElement('div')
  legend.className = 'panel sp-legend hidden'
  const legendTitle = document.createElement('div')
  legendTitle.className = 'sp-legend-title'
  const legendList = document.createElement('div')
  legendList.className = 'sp-legend-list'
  legend.append(legendTitle, legendList)
  const mapPanel = deps.right.querySelector('.map-panel')
  deps.right.insertBefore(legend, mapPanel ? mapPanel.nextSibling : deps.right.firstChild)

  // ---------- inspector section ----------
  const slot = deps.inspectorSlot
  const isLand = document.createElement('div')
  isLand.className = 'isp-land'
  const isHeld = document.createElement('div')
  isHeld.className = 'isp-held'
  const isHeldLabel = document.createElement('span')
  isHeldLabel.textContent = 'Its people hold '
  const inspChips = new SpeciesChips('sp-chips insp')
  isHeld.append(isHeldLabel, inspChips.el)
  slot.append(isLand, isHeld)

  // ---------- state ----------
  let d: SpeciesData | null = null
  let history: History | null = null
  let peopleOf: Int32Array | null = null
  let peopleNames: string[] | null = null
  let selected = -1
  let rows: Row[] = []
  let viewCategory = -1
  let year = 0
  let shownYear = NaN
  let inspected = -1
  let inspCell = -1
  let shownLandKey = -2

  const swatch = (s: number) => {
    const el = document.createElement('span')
    el.className = 'sp-swatch'
    if (d) el.style.background = d.css[s]
    return el
  }

  function buildRows() {
    list.replaceChildren()
    rows = []
    if (!d) return
    const order = d.list.map((_, i) => i).sort((a, b) => d!.list[a].category - d!.list[b].category || a - b)
    let lastCat = -1
    for (const s of order) {
      const cat = d.list[s].category
      if (cat !== lastCat) {
        const g = document.createElement('div')
        g.className = 'sp-group'
        g.textContent = cat === 0 ? 'Staples' : cat === 1 ? 'Livestock' : `${SPECIES_CATEGORY_NAMES[cat] ?? 'other'}`.replace(/^./, (c) => c.toUpperCase())
        list.appendChild(g)
        lastCat = cat
      }
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'sp-row'
      el.dataset.species = String(s)
      const name = document.createElement('span')
      name.className = 'sp-name'
      const strong = document.createElement('span')
      strong.className = 'sp-word'
      strong.textContent = d.names[s]
      const gl = document.createElement('span')
      gl.className = 'sp-gloss'
      gl.textContent = d.gloss[s]
      name.append(strong, gl)
      const held = document.createElement('span')
      held.className = 'pp-num'
      const land = document.createElement('span')
      land.className = 'pp-num'
      el.append(swatch(s), name, held, land)
      el.title = `${d.names[s]}, ${d.gloss[s]} (${SPECIES_CATEGORY_NAMES[cat] ?? 'species'}): click to see where it is grown and how it spread`
      list.appendChild(el)
      rows.push({ s, el, held, land, shown: { held: -1, land: -2, selected: false } })
    }
  }

  function buildLegend() {
    legendList.replaceChildren()
    legend.classList.toggle('hidden', !d || viewCategory < 0 || (viewCategory === 0 ? !d.crop : !d.herd))
    if (!d || viewCategory < 0) return
    legendTitle.textContent = viewCategory === 0 ? 'Main staple crop' : 'Main herd animal'
    for (let s = 0; s < d.count; s++) {
      if (d.list[s].category !== viewCategory) continue
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'sp-legend-item'
      b.dataset.species = String(s)
      b.classList.toggle('selected', s === selected)
      const t = document.createElement('span')
      t.className = 'sp-legend-text'
      const w = document.createElement('b')
      w.textContent = d.names[s]
      t.append(w, `, ${d.gloss[s]}`)
      b.append(swatch(s), t)
      legendList.appendChild(b)
    }
    const none = document.createElement('div')
    none.className = 'sp-legend-item none'
    const sw = document.createElement('span')
    sw.className = 'sp-swatch neutral'
    none.append(sw, viewCategory === 0 ? 'Not farmed' : 'No herds')
    legendList.appendChild(none)
  }

  const onPick = (e: Event) => {
    const el = (e.target as HTMLElement).closest('[data-species]') as HTMLElement | null
    if (!el) return
    const s = Number(el.dataset.species)
    api.select(selected === s ? -1 : s)
  }
  list.addEventListener('click', onPick)
  legendList.addEventListener('click', onPick)
  slot.addEventListener('click', onPick)

  function updatePanel() {
    if (!d) return
    const P = d.peoples
    if (collapsed) return
    const l = d.landCount > 0 ? cropSnapshotAt(d, year) : -1
    for (const r of rows) {
      const held = holdersAt(d, r.s, year)
      if (held !== r.shown.held) {
        r.shown.held = held
        r.held.textContent = `${held}/${P}`
        r.el.classList.toggle('unheld', held === 0)
      }
      const livestock = d.list[r.s].category === 1
      const layer = livestock ? d.herd : d.crop
      const n = l >= 0 && layer ? (livestock ? d.herdCells : d.cropCells)[l * d.count + r.s] : -1
      const total = l >= 0 && layer ? (livestock ? d.pastureCells : d.farmedCells)[l] : 0
      const key = n < 0 ? -1 : Math.round((1000 * n) / Math.max(1, total)) + (n > 0 ? 1 : 0)
      if (key !== r.shown.land) {
        r.shown.land = key
        r.land.textContent = n < 0 ? '—' : pct(n, total)
        r.land.title = n < 0 ? '' : `${n} of ${total} ${livestock ? 'herding' : 'farmed'} cells`
      }
      const sel = r.s === selected
      if (sel !== r.shown.selected) {
        r.shown.selected = sel
        r.el.classList.toggle('selected', sel)
        r.el.setAttribute('aria-pressed', String(sel))
      }
    }
  }

  function updateInspector() {
    if (!d || inspected < 0 || !history || !peopleOf) return
    const p = peopleOf[inspected] ?? -1
    inspChips.update(d, p, year, peopleNames)
    isHeld.classList.toggle('hidden', p < 0)
    // the cell's main crop and herd at the land snapshot shown
    const l = d.landCount > 0 ? cropSnapshotAt(d, year) : -1
    const crop = l >= 0 && d.crop ? d.crop[l * d.cellCount + inspCell] - 1 : -1
    const herd = l >= 0 && d.herd ? d.herd[l * d.cellCount + inspCell] - 1 : -1
    const key = (crop + 1) * 1000 + herd + 1
    if (key === shownLandKey) return
    shownLandKey = key
    isLand.replaceChildren()
    const part = (s: number, verb: string) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'isp-species'
      b.dataset.species = String(s)
      b.title = `${d!.names[s]}, ${d!.gloss[s]}: show where it is grown`
      b.append(swatch(s), d!.names[s])
      isLand.append(`${verb} `, b)
    }
    if (crop >= 0) part(crop, 'Grows')
    if (herd >= 0) {
      if (crop >= 0) isLand.append(' · ')
      part(herd, crop >= 0 ? 'keeps' : 'Keeps')
    }
    if (crop < 0 && herd < 0) isLand.append(d.crop || d.herd ? 'No crops or herds here' : '')
    isLand.classList.toggle('hidden', !d.crop && !d.herd)
  }

  const api: SpeciesView = {
    get selected() {
      return selected
    },
    get data() {
      return d
    },
    setData(data, h, people, names, keep) {
      d = data
      history = h
      peopleOf = people
      peopleNames = names
      root.classList.toggle('hidden', !d)
      count.textContent = d ? String(d.count) : ''
      buildRows()
      buildLegend()
      const want = keep ? selected : -1
      selected = -1
      shownYear = NaN
      shownLandKey = -2
      if (d && want >= 0 && want < d.count) api.select(want)
      else deps.setUrlParam('species', null)
      api.showSettlement(inspected, false)
    },
    select(s: number) {
      const next = d && s >= 0 && s < d.count ? s : -1
      if (next === selected) return
      selected = next
      deps.setUrlParam('species', next >= 0 ? String(next) : null)
      for (const el of legendList.querySelectorAll<HTMLElement>('[data-species]')) el.classList.toggle('selected', Number(el.dataset.species) === selected)
      shownYear = NaN
      deps.onSelect(next)
    },
    setViewMode(mode: string) {
      const cat = mode === ViewMode.Crops ? 0 : mode === ViewMode.Herds ? 1 : -1
      if (cat === viewCategory) return
      viewCategory = cat
      buildLegend()
    },
    showSettlement(id: number, outpost: boolean) {
      inspected = id
      const ok = id >= 0 && !outpost && d !== null && history !== null && id < history.settlements.length
      slot.classList.toggle('hidden', !ok)
      if (!ok || !history) return
      inspCell = history.settlements[id].cell
      shownLandKey = -2
      inspChips.update(null, -1, 0, null)
      updateInspector()
    },
    tick(y: number) {
      year = y
      if (!d) return
      const yi = Math.floor(y)
      if (yi === shownYear) return
      shownYear = yi
      updatePanel()
      updateInspector()
    },
  }
  slot.classList.add('hidden')
  return api
}
