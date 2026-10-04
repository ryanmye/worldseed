// Species in the UI: the Species panel (right column, under the Peoples) with its species
// grouped by kind (collapsible groups with counts) and its Techniques group, the legend of
// the Crops, Herds and Cash crops views (under the map panel), the species chips, habit bars
// and technique count of the peoples panel rows, and the inspector's species section (its
// cell's main crop, herd and cash crop, its stored food, its people's habits, techniques
// and species). Selecting a species (a row, a legend entry, a chip, or species=<id>) shows
// on the globe where it is grown now, where it is native, and the arcs along which it
// passed from people to people up to the current year (render/species.ts, driven by the
// history view through onSelect); a stimulant also tints each people's land by its habit.
// Selecting a technique (a row, or technique=<id>) shows where it was first worked out and
// how it spread.
//
// Everything here is optional: without species data (speciesData.ts) the panel, legend
// and sections stay hidden. DOM writes happen only when a shown value changes.

import { SpeciesCategory, type History } from '../contract.ts'
import { goodName, settlementName } from './format.ts'
import { namesEpoch } from './renamingData.ts'
import { CASH_VIEW, cropSnapshotAt, habitLevel, habitSnapshotAt, heldAt, holdersAt, inViewCategory, isHabitForming, techHoldersAt, type SpeciesData } from './speciesData.ts'
import { loadFlag, saveFlag } from './panels.ts'
import { ViewMode } from '../render/palette.ts'
import { GOOD_COLORS } from '../render/trade.ts'
import './species.css'

export interface SpeciesViewDeps {
  right: HTMLElement
  inspectorSlot: HTMLElement
  setUrlParam(name: string, value: string | null): void
  /** The selected species changed (-1: none). */
  onSelect(species: number): void
  /** The selected technique changed (-1: none). */
  onSelectTechnique?(technique: number): void
}

export interface SpeciesView {
  /** A history was committed: its species data (null hides everything); `keep` keeps the selection (a longer run). */
  setData(d: SpeciesData | null, h: History | null, peopleOf: Int32Array | null, peopleNames: string[] | null, keep: boolean): void
  select(species: number): void
  selectTechnique(technique: number): void
  readonly selected: number
  readonly technique: number
  readonly data: SpeciesData | null
  /** The Crops, Herds or Cash crops view shows its legend. */
  setViewMode(mode: string): void
  /** The inspector shows settlement `id` (-1: none; an expedition base gets no species section). */
  showSettlement(id: number, outpost: boolean): void
  /** Per frame (cheap: compares numbers). */
  tick(year: number): void
}

const pct = (n: number, d: number) => (d <= 0 ? '—' : n <= 0 ? '0%' : n / d < 0.005 ? '<1%' : `${Math.round((100 * n) / d)}%`)

/** Group headings of the panel and legend, by SpeciesCategory. */
const GROUP_NAMES = ['Staples', 'Livestock', 'Fibre', 'Luxuries and dyes', 'Stimulants', 'Ornamentals']
const GROUP_OPEN_DEFAULT = [true, true, false, false, false, false]
/** Key of the Techniques group (after the categories). */
const TECH_GROUP = 6

/** "About a third of its food keeps in store" for a stored share 0..1. */
export function storedWords(f: number): string {
  if (!(f > 0.03)) return 'Hardly any of its food keeps in store'
  if (f >= 0.92) return 'Nearly all of its food keeps in store'
  if (f >= 0.7) return 'Most of its food keeps in store'
  const table: [number, string][] = [[0.1, 'a tenth'], [0.2, 'a fifth'], [0.25, 'a quarter'], [1 / 3, 'a third'], [0.4, 'two fifths'], [0.5, 'half'], [0.6, 'three fifths'], [2 / 3, 'two thirds']]
  let best = table[0]
  for (const t of table) if (Math.abs(t[0] - f) < Math.abs(best[0] - f)) best = t
  return `About ${best[1]} of its food keeps in store`
}

/** A people's list of names: "the Dona, Usa and Ilo" (at most `max`, then "and n more"). */
function peopleList(names: string[] | null, ids: number[], max = 4): string {
  const ns = ids.map((p) => names?.[p] ?? `people ${p + 1}`)
  if (ns.length === 0) return ''
  const shown = ns.slice(0, max)
  const rest = ns.length - shown.length
  if (rest > 0) return `the ${shown.join(', ')} and ${rest} more`
  return shown.length === 1 ? `the ${shown[0]}` : `the ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

/** A small swatch in a species' colour, shaped by its category (chips and swatches). */
function speciesSwatch(d: SpeciesData | null, s: number, cls = 'sp-swatch'): HTMLSpanElement {
  const el = document.createElement('span')
  el.className = `${cls} cat${d ? d.list[s].category : 0}`
  if (d) el.style.background = d.css[s]
  return el
}

/** Tags after a species' name: the good it yields (a coloured dot) and its habit or harm. */
function speciesTags(d: SpeciesData, s: number): HTMLSpanElement | null {
  const x = d.list[s]
  const g = d.good[s]
  const wrap = document.createElement('span')
  wrap.className = 'sp-tags'
  if (g >= 0 && x.category !== SpeciesCategory.Staple) {
    const dot = document.createElement('span')
    dot.className = 'good-dot sp-good'
    dot.style.background = GOOD_COLORS[g] ?? '#888'
    dot.title = x.category === SpeciesCategory.Livestock ? `Its wool yields ${goodName(g)}` : `Grown for trade: yields ${goodName(g)}`
    wrap.appendChild(dot)
  }
  if (x.category === SpeciesCategory.Stimulant || d.harmWord[s]) {
    const t = document.createElement('span')
    const harm = d.harmWord[s]
    t.className = `sp-pill${harm === 'ruinous' || harm === 'harmful' ? ' warn' : harm ? ' mild-warn' : ''}`
    t.textContent = harm === 'ruinous' ? 'ruinous' : harm === 'harmful' ? 'harmful' : 'habit'
    t.title = harm ? `Habit-forming, ${harm} to the health and work of its users` : 'Habit-forming, and mild'
    wrap.appendChild(t)
  }
  return wrap.childNodes.length ? wrap : null
}

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
    // by category, so the shapes run together
    this.held.sort((a, b) => d.list[a].category - d.list[b].category || a - b)
    this.el.replaceChildren()
    for (const s of this.held) {
      const c = speciesSwatch(d, s, 'sp-chip')
      c.dataset.species = String(s)
      const since = d.year[p * d.count + s]
      const src = d.source[p * d.count + s]
      const how = since <= 0 ? 'held from the start' : src >= 0 ? `since ${since}, from the ${peopleNames?.[src] ?? 'neighbours'}` : `since ${since}, ${d.list[s].category === SpeciesCategory.Livestock ? 'tamed' : 'first grown'} by them`
      c.title = `${d.names[s]}, ${d.gloss[s]}: ${how}`
      this.el.appendChild(c)
    }
  }
}

/** A people's habits at a year: a small bar per stimulant it is habituated to, harmful ones in a warning tone. */
export class HabitLine {
  readonly el: HTMLSpanElement
  private shownKey = -1
  private shownData: SpeciesData | null = null
  private shownPeople = -1
  private readonly labels: boolean
  constructor(labels = true) {
    this.labels = labels
    this.el = document.createElement('span')
    this.el.className = 'sp-habits'
  }
  /** Whether anything is shown. */
  get shown(): boolean {
    return this.shownKey > 0
  }
  update(d: SpeciesData | null, p: number, year: number, peopleNames: string[] | null) {
    const K = d ? d.stimulants.length : 0
    if (!d || p < 0 || K === 0 || !d.habit) {
      if (this.shownKey !== -1 || this.shownData !== d) {
        this.shownKey = -1
        this.shownData = d
        this.el.replaceChildren()
      }
      return
    }
    const s = habitSnapshotAt(d, year)
    // levels in 5% steps and whether each "since" has passed, as a number (0: nothing shown)
    let key = 0
    for (let k = 0; k < K; k++) {
      const v = Math.round((habitLevel(d, s, p, k) / 255) * 20)
      const since = d.habitSince[p * K + k]
      key = (key * 43 + (v > 0 ? v * 2 + (since >= 0 && since <= year ? 1 : 0) : 0)) % 1e15
    }
    if (key === this.shownKey && d === this.shownData && p === this.shownPeople) return
    this.shownKey = key
    this.shownData = d
    this.shownPeople = p
    this.el.replaceChildren()
    for (let k = 0; k < K; k++) {
      const lv = habitLevel(d, s, p, k) / 255
      if (Math.round(lv * 20) <= 0) continue
      const sp = d.stimulants[k]
      const harm = d.harmWord[sp]
      const item = document.createElement('span')
      item.className = `sp-habit${harm === 'harmful' || harm === 'ruinous' ? ' warn' : harm ? ' mild-warn' : ''}`
      item.dataset.species = String(sp)
      const bar = document.createElement('span')
      bar.className = 'sp-habit-bar'
      const fill = document.createElement('span')
      fill.style.width = `${Math.max(8, Math.round(lv * 100))}%`
      if (!harm) fill.style.background = d.css[sp]
      bar.appendChild(fill)
      item.appendChild(bar)
      if (this.labels) {
        const name = document.createElement('span')
        name.className = 'sp-habit-name'
        name.textContent = d.names[sp]
        item.appendChild(name)
      }
      const since = d.habitSince[p * K + k]
      const from = d.habitFrom[p * K + k]
      const sinceText = since >= 0 && since <= year ? `, a habit since ${since}` + (from >= 0 && from !== p ? ` (from the ${peopleNames?.[from] ?? 'neighbours'})` : '') : ''
      item.title = `${d.names[sp]}, ${d.gloss[sp]}: habit ${Math.round(lv * 100)}%${sinceText}`
      this.el.appendChild(item)
    }
  }
}

/** A people's techniques at a year: a count with the names on hover. */
export class TechniqueCount {
  readonly el: HTMLSpanElement
  private shownN = -1
  private shownData: SpeciesData | null = null
  private shownPeople = -1
  constructor() {
    this.el = document.createElement('span')
    this.el.className = 'sp-techcount'
  }
  get shown(): boolean {
    return this.shownN > 0
  }
  update(d: SpeciesData | null, p: number, year: number, peopleNames: string[] | null) {
    const T = d ? d.techniques.length : 0
    let n = 0
    if (d && p >= 0 && p < d.peoples) {
      for (let k = 0; k < T; k++) {
        const y = d.techYear[p * T + k]
        if (y >= 0 && y <= year) n++
      }
    }
    if (n === this.shownN && d === this.shownData && p === this.shownPeople) return
    const held: number[] = []
    if (d && n > 0) for (let k = 0; k < T; k++) { const y = d.techYear[p * T + k]; if (y >= 0 && y <= year) held.push(k) }
    this.shownN = n
    this.shownData = d
    this.shownPeople = p
    this.el.textContent = n > 0 ? `${n} ${n === 1 ? 'technique' : 'techniques'}` : ''
    this.el.title = n > 0 && d ? held.map((k) => {
      const y = d.techYear[p * T + k], src = d.techSource[p * T + k]
      return `${d.techNames[k]}, ${d.techGloss[k]} (${src >= 0 ? `from the ${peopleNames?.[src] ?? 'neighbours'}, ${y}` : `worked out ${y}`})`
    }).join('\n') : ''
  }
}

interface Row {
  s: number
  el: HTMLButtonElement
  held: HTMLSpanElement
  land: HTMLSpanElement
  shown: { held: number; land: number; selected: boolean }
}
interface TechRow {
  k: number
  el: HTMLButtonElement
  held: HTMLSpanElement
  first: HTMLSpanElement
  shown: { held: number; first: boolean; selected: boolean }
}
interface Group {
  key: number
  head: HTMLButtonElement
  count: HTMLSpanElement
  body: HTMLDivElement
  members: number[]
  open: boolean
  shown: number
  sync(): void
}

export function createSpeciesView(deps: SpeciesViewDeps): SpeciesView {
  // ---------- panel ----------
  const root = document.createElement('div')
  root.className = 'panel species hidden'
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'pp-head'
  head.title = 'Show or hide the species and techniques'
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
  cols.innerHTML = '<span></span><span>Species</span><span title="Peoples holding it">Held</span><span title="Share of the farmland (staples), pasture (livestock) or land under cash crops where it is the main one">Land</span>'
  const list = document.createElement('div')
  list.className = 'sp-list'
  const detail = document.createElement('div')
  detail.className = 'sp-detail'
  const note = document.createElement('div')
  note.className = 'pp-note'
  note.textContent = 'Click a species or technique to see where it is grown and how it spread.'
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
    forceRefresh()
  })

  // ---------- legend of the Crops, Herds and Cash crops views ----------
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
  const isStore = document.createElement('div')
  isStore.className = 'isp-store hidden'
  const isHabit = document.createElement('div')
  isHabit.className = 'isp-habit hidden'
  const inspHabits = new HabitLine()
  isHabit.append('Its people’s habits ', inspHabits.el)
  const isTech = document.createElement('div')
  isTech.className = 'isp-tech hidden'
  const isHeld = document.createElement('div')
  isHeld.className = 'isp-held'
  const isHeldLabel = document.createElement('span')
  isHeldLabel.textContent = 'Its people hold '
  const inspChips = new SpeciesChips('sp-chips insp')
  isHeld.append(isHeldLabel, inspChips.el)
  slot.append(isLand, isStore, isHabit, isTech, isHeld)

  // ---------- state ----------
  let d: SpeciesData | null = null
  let history: History | null = null
  let peopleOf: Int32Array | null = null
  let peopleNames: string[] | null = null
  let selected = -1
  let technique = -1
  let rows: Row[] = []
  let techRows: TechRow[] = []
  let groups: Group[] = []
  let viewCategory = -1
  let year = 0
  let shownYear = NaN
  let inspected = -1
  let inspCell = -1
  let shownLandKey = -2
  let shownStoreKey = -2
  let shownTechKey = -2
  let shownLegendL = -2
  let shownDetailKey = -1
  /** technique=<id> from the page address, applied with the first data. */
  let pendingTechnique = (() => {
    try {
      const v = new URLSearchParams(window.location.search).get('technique')
      return v !== null && /^\d+$/.test(v) ? Number(v) : -1
    } catch {
      return -1
    }
  })()

  const forceRefresh = () => {
    shownYear = NaN
    for (const g of groups) g.shown = -1
    shownDetailKey = -1
  }

  function makeGroup(key: number, label: string, members: number[]): Group {
    const gHead = document.createElement('button')
    gHead.type = 'button'
    gHead.className = 'sp-group'
    const gCaret = document.createElement('span')
    gCaret.className = 'sp-group-caret'
    gCaret.setAttribute('aria-hidden', 'true')
    const gName = document.createElement('span')
    gName.className = 'sp-group-name'
    gName.textContent = label
    const gCount = document.createElement('span')
    gCount.className = 'sp-group-count'
    gHead.append(gCaret, gName, gCount)
    const gBody = document.createElement('div')
    gBody.className = 'sp-group-body'
    const open = loadFlag(`worldseed.species.group${key}`, key < GROUP_OPEN_DEFAULT.length ? GROUP_OPEN_DEFAULT[key] : false)
    const g: Group = {
      key, head: gHead, count: gCount, body: gBody, members, open, shown: -1,
      sync() {
        gHead.classList.toggle('open', g.open)
        gHead.setAttribute('aria-expanded', String(g.open))
        gBody.classList.toggle('hidden', !g.open)
      },
    }
    g.sync()
    gHead.addEventListener('click', () => {
      g.open = !g.open
      saveFlag(`worldseed.species.group${key}`, g.open)
      g.sync()
      forceRefresh()
      updatePanel()
    })
    list.append(gHead, gBody)
    return g
  }
  const openGroup = (key: number) => {
    const g = groups.find((x) => x.key === key)
    if (!g || g.open) return
    g.open = true
    g.sync()
  }

  function buildRows() {
    list.replaceChildren()
    rows = []
    techRows = []
    groups = []
    if (!d) return
    const byCat: number[][] = []
    for (let s = 0; s < d.count; s++) {
      const c = Math.max(0, Math.min(5, d.list[s].category))
      ;(byCat[c] ??= []).push(s)
    }
    for (let c = 0; c < 6; c++) {
      const members = byCat[c]
      if (!members?.length) continue
      const g = makeGroup(c, GROUP_NAMES[c], members)
      groups.push(g)
      for (const s of members) {
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
        const tags = speciesTags(d, s)
        gl.textContent = tags ? d.plainGloss[s] : d.gloss[s]
        name.append(strong)
        if (tags) name.append(tags)
        name.append(gl)
        const held = document.createElement('span')
        held.className = 'pp-num'
        const land = document.createElement('span')
        land.className = 'pp-num'
        el.append(speciesSwatch(d, s), name, held, land)
        el.title = `${d.names[s]}, ${d.gloss[s]}: click to see where it is grown and how it spread`
        g.body.appendChild(el)
        rows.push({ s, el, held, land, shown: { held: -1, land: -2, selected: false } })
      }
    }
    const T = d.techniques.length
    if (T > 0) {
      const g = makeGroup(TECH_GROUP, 'Techniques', Array.from({ length: T }, (_, k) => k))
      groups.push(g)
      for (let k = 0; k < T; k++) {
        const el = document.createElement('button')
        el.type = 'button'
        el.className = 'sp-row tech'
        el.dataset.technique = String(k)
        const icon = document.createElement('span')
        icon.className = 'sp-tech-icon'
        const name = document.createElement('span')
        name.className = 'sp-name'
        const strong = document.createElement('span')
        strong.className = 'sp-word'
        strong.textContent = d.techNames[k]
        const gl = document.createElement('span')
        gl.className = 'sp-gloss'
        gl.textContent = d.techGloss[k]
        name.append(strong, gl)
        const held = document.createElement('span')
        held.className = 'pp-num'
        const first = document.createElement('span')
        first.className = 'pp-num'
        el.append(icon, name, held, first)
        el.title = `${d.techNames[k]}, ${d.techGloss[k]}: click to see who first had it and how it spread`
        g.body.appendChild(el)
        techRows.push({ k, el, held, first, shown: { held: -1, first: false, selected: false } })
      }
    }
  }

  function buildLegend() {
    legendList.replaceChildren()
    shownLegendL = -2
    const layer = !d ? null : viewCategory === 0 ? d.crop : viewCategory === 1 ? d.herd : viewCategory === CASH_VIEW ? d.cash : null
    legend.classList.toggle('hidden', !d || viewCategory < 0 || !layer)
    if (!d || viewCategory < 0 || !layer) return
    legendTitle.textContent = viewCategory === 0 ? 'Main staple crop' : viewCategory === 1 ? 'Main herd animal' : 'Main cash crop'
    let lastCat = -1
    for (const c of [0, 1, 2, 3, 4]) {
      for (let s = 0; s < d.count; s++) {
        if (d.list[s].category !== c || !inViewCategory(c, viewCategory)) continue
        // what is grown somewhere in this history (the rest would never show)
        if (!d.everGrown[s]) continue
        if (viewCategory === CASH_VIEW && c !== lastCat) {
          const g = document.createElement('div')
          g.className = 'sp-legend-group'
          g.textContent = GROUP_NAMES[c]
          legendList.appendChild(g)
          lastCat = c
        }
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'sp-legend-item'
        b.dataset.species = String(s)
        b.classList.toggle('selected', s === selected)
        const t = document.createElement('span')
        t.className = 'sp-legend-text'
        const w = document.createElement('b')
        w.textContent = d.names[s]
        const tags = viewCategory === CASH_VIEW ? speciesTags(d, s) : null
        t.append(w, `, ${tags ? d.plainGloss[s] : d.gloss[s]}`)
        b.append(speciesSwatch(d, s), t)
        if (tags) b.append(tags)
        b.title = `${d.names[s]}, ${d.gloss[s]}` + (d.good[s] >= 0 ? `: yields ${goodName(d.good[s])}` : '')
        legendList.appendChild(b)
      }
    }
    const neutral = (cls: string, text: string) => {
      const none = document.createElement('div')
      none.className = 'sp-legend-item none'
      const sw = document.createElement('span')
      sw.className = `sp-swatch ${cls}`
      none.append(sw, text)
      legendList.appendChild(none)
    }
    if (viewCategory === CASH_VIEW) neutral('neutral food', 'Food crops only')
    neutral('neutral', viewCategory === 0 || viewCategory === CASH_VIEW ? 'Not farmed' : 'No herds')
    updateLegend()
  }

  /** Legend entries not grown at the land snapshot shown are faded. */
  function updateLegend() {
    if (!d || viewCategory < 0 || legend.classList.contains('hidden')) return
    const l = d.landCount > 0 ? cropSnapshotAt(d, year) : -1
    if (l === shownLegendL) return
    shownLegendL = l
    const cells = viewCategory === 0 ? d.cropCells : viewCategory === 1 ? d.herdCells : d.cashCells
    for (const el of legendList.querySelectorAll<HTMLElement>('[data-species]')) {
      const s = Number(el.dataset.species)
      el.classList.toggle('absent', l < 0 || cells[l * d.count + s] === 0)
    }
  }

  const onPick = (e: Event) => {
    const t = e.target as HTMLElement
    const tk = t.closest('[data-technique]') as HTMLElement | null
    if (tk && !t.closest('[data-species]')) {
      const k = Number(tk.dataset.technique)
      api.selectTechnique(technique === k ? -1 : k)
      return
    }
    const el = t.closest('[data-species]') as HTMLElement | null
    if (!el) return
    const s = Number(el.dataset.species)
    api.select(selected === s ? -1 : s)
  }
  list.addEventListener('click', onPick)
  detail.addEventListener('click', onPick)
  legendList.addEventListener('click', onPick)
  slot.addEventListener('click', onPick)

  /** Land share of species s at land snapshot l: [cells, total] (-1 cells: no such layer). */
  function landOf(s: number, l: number): [number, number] {
    if (!d || l < 0) return [-1, 0]
    const c = d.list[s].category
    if (c === SpeciesCategory.Staple) return d.crop ? [d.cropCells[l * d.count + s], d.farmedCells[l]] : [-1, 0]
    if (c === SpeciesCategory.Livestock) return d.herd ? [d.herdCells[l * d.count + s], d.pastureCells[l]] : [-1, 0]
    if (c === SpeciesCategory.Ornamental) return [-1, 0]
    return d.cash ? [d.cashCells[l * d.count + s], d.cashTotal[l]] : [-1, 0]
  }

  function updatePanel() {
    if (!d) return
    const P = d.peoples
    if (collapsed) return
    const l = d.landCount > 0 ? cropSnapshotAt(d, year) : -1
    for (const g of groups) {
      // "7 of 12 held" (techniques: "known"); the members' holder counts only grow with the year
      let n = 0
      for (const m of g.members) if (g.key === TECH_GROUP ? techHoldersAt(d, m, year) > 0 : holdersAt(d, m, year) > 0) n++
      if (n !== g.shown) {
        g.shown = n
        g.count.textContent = `${n} of ${g.members.length} ${g.key === TECH_GROUP ? 'known' : 'held'}`
      }
    }
    for (const r of rows) {
      const sel = r.s === selected
      if (sel !== r.shown.selected) {
        r.shown.selected = sel
        r.el.classList.toggle('selected', sel)
        r.el.setAttribute('aria-pressed', String(sel))
      }
      if (r.el.parentElement?.classList.contains('hidden')) continue
      const held = holdersAt(d, r.s, year)
      if (held !== r.shown.held) {
        r.shown.held = held
        r.held.textContent = `${held}/${P}`
        r.el.classList.toggle('unheld', held === 0)
      }
      const [n, total] = landOf(r.s, l)
      const key = n < 0 ? -1 : Math.round((1000 * n) / Math.max(1, total)) + (n > 0 ? 1 : 0)
      if (key !== r.shown.land) {
        r.shown.land = key
        const c = d.list[r.s].category
        r.land.textContent = n < 0 ? '—' : pct(n, total)
        r.land.title = n < 0 ? (c === SpeciesCategory.Ornamental ? 'Grown for show, not on the map' : '') : `${n} of ${total} ${c === SpeciesCategory.Livestock ? 'herding' : c === SpeciesCategory.Staple ? 'farmed' : 'cash-crop'} cells`
      }
    }
    for (const r of techRows) {
      const sel = r.k === technique
      if (sel !== r.shown.selected) {
        r.shown.selected = sel
        r.el.classList.toggle('selected', sel)
        r.el.setAttribute('aria-pressed', String(sel))
      }
      if (r.el.parentElement?.classList.contains('hidden')) continue
      const held = techHoldersAt(d, r.k, year)
      if (held !== r.shown.held) {
        r.shown.held = held
        r.held.textContent = `${held}/${P}`
        r.el.classList.toggle('unheld', held === 0)
      }
      // the year it was first worked out, once it has been
      const fy = d.techFirstYear[r.k]
      const known = fy >= 0 && fy <= year
      if (known !== r.shown.first || r.first.textContent === '') {
        r.shown.first = known
        r.first.textContent = known ? String(fy) : '—'
        r.first.title = known ? `First worked out in ${fy}` : 'Not worked out yet'
      }
    }
    updateDetail()
  }

  /** The detail block under the selected row: origins, first holder, what it yields, its habit and harm, who holds it now. */
  function updateDetail() {
    if (!d) return
    const rowEl = selected >= 0 ? rows.find((r) => r.s === selected)?.el : technique >= 0 ? techRows.find((r) => r.k === technique)?.el : undefined
    if (!rowEl || rowEl.parentElement?.classList.contains('hidden')) {
      if (detail.parentElement) detail.remove()
      shownDetailKey = -1
      return
    }
    const P = d.peoples
    const T = d.techniques.length
    const holds = (p: number) => {
      const y = selected >= 0 ? d!.year[p * d!.count + selected] : d!.techYear[p * T + technique]
      return y >= 0 && y <= year
    }
    // what the block shows, as a number (compared before anything is made): the holders, the
    // strongest habit, the settlements by then nearest to where it is native
    let key = selected * 64 + technique + 2
    for (let p = 0; p < P; p++) key = (key * 2 + (holds(p) ? 1 : 0)) % 1e15
    const k = selected >= 0 ? d.stimIndex[selected] : -1
    const hs = k >= 0 ? habitSnapshotAt(d, year) : -1
    let strongest = -1, sv = 0
    if (k >= 0) for (let p = 0; p < P; p++) { const v = habitLevel(d, hs, p, k); if (v > sv) { sv = v; strongest = p } }
    key = (key * 64 + strongest + 1) % 1e15
    key = (key * 32 + Math.round((sv / 255) * 20)) % 1e15
    const firstFounded = (order: Int32Array) => {
      for (let j = 0; j < order.length; j++) if (history!.settlements[order[j]].foundedYear <= year) return order[j]
      return -1
    }
    const origins = selected >= 0 && history ? d.originNear[selected] : []
    for (const order of origins) key = (key * 4099 + firstFounded(order) + 1) % 1e15
    key = (key * 64 + (namesEpoch() % 64)) % 1e15 // renaming: the towns named as at the year
    if (rowEl.nextSibling !== detail) rowEl.after(detail)
    if (key === shownDetailKey) return
    shownDetailKey = key
    const holders: number[] = []
    for (let p = 0; p < P; p++) if (holds(p)) holders.push(p)
    const near: number[] = []
    for (const order of origins) {
      const best = firstFounded(order)
      if (best >= 0 && !near.includes(best)) near.push(best)
    }
    detail.replaceChildren()
    const line = (cls = '') => {
      const el = document.createElement('div')
      if (cls) el.className = cls
      detail.appendChild(el)
      return el
    }
    const name = (i: number) => (history && history.settlements[i] ? settlementName(history, i) : '')
    if (selected >= 0) {
      const x = d.list[selected]
      // who first held it, and how (by the year shown)
      let first = -1, fy = 1e9
      for (let p = 0; p < P; p++) { const y = d.year[p * d.count + selected]; if (y >= 0 && y <= year && y < fy && d.source[p * d.count + selected] < 0) { fy = y; first = p } }
      const verb = x.category === SpeciesCategory.Livestock ? 'tamed' : 'first grown'
      const origin = near.length ? `Native near ${near.map(name).filter(Boolean).join(' and ')}` : 'Native to unsettled land'
      const firstText = first < 0 ? 'not yet taken up by any people' : fy <= 0 ? `held by the ${peopleNames?.[first] ?? ''} from the start` : `${verb} by the ${peopleNames?.[first] ?? ''} in ${fy}`
      line().textContent = origin ? `${origin} · ${firstText}` : firstText.charAt(0).toUpperCase() + firstText.slice(1)
      // what it is for
      const g = d.good[selected]
      const use = line()
      if (x.category === SpeciesCategory.Staple) {
        const parts = [`Yields ${(x.yield || 1).toFixed(1)}× the baseline grain`]
        const st = x.storability
        if (typeof st === 'number') parts.push(st >= 0.75 ? 'keeps for years' : st >= 0.45 ? 'keeps a season or two' : 'rots within weeks')
        if (x.clonal) parts.push('grown from cuttings, open to blight')
        use.textContent = parts.join(' · ')
      } else if (x.category === SpeciesCategory.Livestock) use.textContent = g >= 0 ? `Meat, milk and hides; its wool yields ${goodName(g)}` : 'Meat, milk, hides and work'
      else if (x.category === SpeciesCategory.Ornamental) use.textContent = 'Grown for show and prestige, not for food or trade'
      else {
        const parts: string[] = []
        if (g >= 0) use.append('Grown for trade: yields ', Object.assign(document.createElement('span'), { className: 'good-dot', style: `background:${GOOD_COLORS[g] ?? '#888'}` }), goodName(g))
        else parts.push('Grown for building and craft, not traded')
        if (isHabitForming(x)) {
          const h = d.harmWord[selected]
          parts.push(h ? `habit-forming, ${h} to its users` : 'habit-forming, and mild')
        }
        if (parts.length) use.append((g >= 0 ? ' · ' : '') + parts.join(' · '))
        if (d.harmWord[selected] === 'harmful' || d.harmWord[selected] === 'ruinous') use.classList.add('warn')
      }
      line().textContent = holders.length ? `Held now by ${peopleList(peopleNames, holders)}` : 'Held by no people yet'
      if (k >= 0) {
        line('sp-detail-faint').textContent = strongest >= 0 && sv >= 13 ? `The habit is strongest among the ${peopleNames?.[strongest] ?? ''} (${Math.round((100 * sv) / 255)}%); the globe shades each people's land by it` : 'No people has the habit yet; the globe shades each people\'s land by it'
      }
    } else {
      const T = d.techniques.length
      const t = d.techniques[technique]
      const fp = d.techFirstPeople[technique], fy = d.techFirstYear[technique]
      line().textContent = fp >= 0 && fy <= year ? `First worked out by the ${peopleNames?.[fp] ?? ''} in ${fy}` : 'Not worked out yet'
      if (t.species >= 0 && t.species < d.count) {
        const el = line()
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'isp-species'
        b.dataset.species = String(t.species)
        b.append(speciesSwatch(d, t.species), d.names[t.species])
        el.append('For ', b, `, ${d.gloss[t.species]}`)
      }
      let learned = 0
      for (const p of holders) if (d.techSource[p * T + technique] >= 0) learned++
      line().textContent = holders.length ? `Known now to ${peopleList(peopleNames, holders)}` + (learned ? ` (${learned} learned it from others)` : '') : 'Known to no people yet'
    }
  }

  function updateInspector() {
    if (!d || inspected < 0 || !history || !peopleOf) return
    const p = peopleOf[inspected] ?? -1
    inspChips.update(d, p, year, peopleNames)
    isHeld.classList.toggle('hidden', p < 0)
    inspHabits.update(d, p, year, peopleNames)
    isHabit.classList.toggle('hidden', !inspHabits.shown)
    // the people's techniques (a count of them changes the list)
    const T = d.techniques.length
    let tk = 0
    if (p >= 0) for (let k = 0; k < T; k++) { const y = d.techYear[p * T + k]; if (y >= 0 && y <= year) tk = tk * 2 + 1; else tk *= 2 }
    if (tk !== shownTechKey) {
      shownTechKey = tk
      isTech.replaceChildren()
      const held: number[] = []
      if (p >= 0) for (let k = 0; k < T; k++) { const y = d.techYear[p * T + k]; if (y >= 0 && y <= year) held.push(k) }
      isTech.classList.toggle('hidden', held.length === 0)
      if (held.length) {
        isTech.append('Its people know ')
        held.forEach((k, i) => {
          if (i > 0) isTech.append(i === held.length - 1 ? ' and ' : ', ')
          const b = document.createElement('button')
          b.type = 'button'
          b.className = 'isp-species tech'
          b.dataset.technique = String(k)
          b.textContent = d!.techNames[k]
          b.title = `${d!.techNames[k]}, ${d!.techGloss[k]}: show who first had it and how it spread`
          isTech.append(b)
        })
      }
    }
    // the share of its food in store
    if (d.storable) {
      const s = habitSnapshotAt(d, year)
      const v = history.population[s * d.settlementCount + inspected] > 0 ? d.storable[s * d.settlementCount + inspected] : -1
      const sk = v < 0 ? -1 : Math.round(v / 4)
      if (sk !== shownStoreKey) {
        shownStoreKey = sk
        const words = v < 0 ? '' : storedWords(v / 255)
        isStore.textContent = words
        isStore.title = v >= 0 ? `About ${Math.round((100 * v) / 255)}% of its harvest keeps through a bad year` : ''
        isStore.classList.toggle('hidden', words === '')
      }
    }
    // the cell's main crop, herd and cash crop at the land snapshot shown
    const l = d.landCount > 0 ? cropSnapshotAt(d, year) : -1
    const at = (a: Uint8Array | null) => (l >= 0 && a ? a[l * d!.cellCount + inspCell] - 1 : -1)
    const crop = at(d.crop), herd = at(d.herd), cash = at(d.cash)
    const key = ((crop + 1) * 64 + herd + 1) * 64 + cash + 1
    if (key === shownLandKey) return
    shownLandKey = key
    isLand.replaceChildren()
    let n = 0
    const part = (s: number, verb: string) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'isp-species'
      b.dataset.species = String(s)
      b.title = `${d!.names[s]}, ${d!.gloss[s]}: show where it is grown`
      b.append(speciesSwatch(d, s), d!.names[s])
      if (n++ > 0) isLand.append(' · ')
      isLand.append(`${n === 1 ? verb.charAt(0).toUpperCase() + verb.slice(1) : verb} `, b)
      const g = d!.good[s]
      if (g >= 0 && d!.list[s].category !== SpeciesCategory.Staple && d!.list[s].category !== SpeciesCategory.Livestock) isLand.append(` for ${goodName(g)}`)
    }
    if (crop >= 0) part(crop, 'grows')
    if (herd >= 0) part(herd, 'keeps')
    if (cash >= 0) part(cash, 'cash crop')
    if (n === 0) isLand.append(d.crop || d.herd ? 'No crops or herds here' : '')
    isLand.classList.toggle('hidden', !d.crop && !d.herd && !d.cash)
  }

  const api: SpeciesView = {
    get selected() {
      return selected
    },
    get technique() {
      return technique
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
      count.textContent = d ? `${d.count}` + (d.techniques.length ? ` · ${d.techniques.length} techniques` : '') : ''
      detail.remove()
      buildRows()
      buildLegend()
      const want = keep ? selected : -1
      const wantTech = keep ? technique : pendingTechnique
      if (d) pendingTechnique = -1
      selected = -1
      technique = -1
      forceRefresh()
      shownLandKey = shownStoreKey = shownTechKey = -2
      if (d && want >= 0 && want < d.count) api.select(want)
      else deps.setUrlParam('species', null)
      if (d && wantTech >= 0 && wantTech < d.techniques.length) api.selectTechnique(wantTech)
      else if (d) deps.setUrlParam('technique', null)
      api.showSettlement(inspected, false)
    },
    select(s: number) {
      const next = d && s >= 0 && s < d.count ? s : -1
      if (next === selected) return
      selected = next
      if (next >= 0 && technique >= 0) {
        technique = -1
        deps.setUrlParam('technique', null)
        deps.onSelectTechnique?.(-1)
      }
      if (next >= 0 && d) openGroup(Math.max(0, Math.min(5, d.list[next].category)))
      deps.setUrlParam('species', next >= 0 ? String(next) : null)
      for (const el of legendList.querySelectorAll<HTMLElement>('[data-species]')) el.classList.toggle('selected', Number(el.dataset.species) === selected)
      forceRefresh()
      deps.onSelect(next)
      updatePanel()
    },
    selectTechnique(k: number) {
      const next = d && k >= 0 && k < d.techniques.length ? k : -1
      if (next === technique) return
      if (next >= 0 && selected >= 0) api.select(-1)
      technique = next
      if (next >= 0) openGroup(TECH_GROUP)
      deps.setUrlParam('technique', next >= 0 ? String(next) : null)
      forceRefresh()
      deps.onSelectTechnique?.(next)
      updatePanel()
    },
    setViewMode(mode: string) {
      const cat = mode === ViewMode.Crops ? 0 : mode === ViewMode.Herds ? 1 : mode === ViewMode.Cash ? CASH_VIEW : -1
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
      shownLandKey = shownStoreKey = shownTechKey = -2
      inspChips.update(null, -1, 0, null)
      inspHabits.update(null, -1, 0, null)
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
      updateLegend()
    },
  }
  slot.classList.add('hidden')
  return api
}
