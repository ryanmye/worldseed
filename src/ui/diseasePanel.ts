// Sickness in the UI: the "Sickness" panel (right column, collapsed by default: tabs for the
// world's diseases and for its epidemics, with a small chart of deaths by epidemic over time), the
// disease section of the inspector, the epidemics on the map (render/disease.ts), the Fever view
// and its legend, the hover readout's sick places, the timeline's marks of great epidemics, and
// the sickness lines of the Peoples panel and of the Factions detail.
//
// Selections (one at a time): a disease (sickness=<id>: its outbreaks bright, the others dimmed)
// or an epidemic (epidemic=<id>: every place it struck coloured by when, its spread tree, "play
// this epidemic"). Selecting flies to where it began. The Disease layer toggle (disease=0) hides
// the map marks. Everything is a function of the year; DOM writes happen only when what is shown
// changes, and the map layer does per-frame work only while something is drawn.

import * as THREE from 'three'
import { DiseaseKind, type History, type World } from '../contract.ts'
import { buildDiseaseLayer, type DiseaseLayer } from '../render/disease.ts'
import { ViewMode } from '../render/palette.ts'
import type { GlobeMesh } from '../render/globe.ts'
import { requestRender } from '../render/invalidate.ts'
import { formatPopulation, settlementName } from './format.ts'
import { namesEpoch } from './renamingData.ts'
import {
  activeEpidemics, diseaseOf, endemicAt, epidemicExtent, epidemicNoun, epidemicTitle, feverWords, KIND_CSS, KIND_WORDS, mortalityWords, peopleLosses, quarantinesOf,
  rowsOfSettlement, shareWords, sickRow, snapOf, toleranceAt, toleranceWords, viaPhrase, type DiseaseData,
} from './diseaseData.ts'
import { setPolityDiseaseNote } from './politiesPanel.ts'
import { setPeopleDiseaseNote } from './peoplesPanel.ts'
import { loadFlag, loadPref, panelToggled, registerPanel, saveFlag, savePref } from './panels.ts'
import { addShortcut } from './shortcuts.ts'
import { loadLayerPrefs, type LayerToggle } from './overlay.ts'
import type { TimelineMark } from './timeline.ts'
import './disease.css'

export interface DiseaseBuilt {
  data: DiseaseData
  layer: DiseaseLayer
}

export interface DiseaseViewDeps {
  right: HTMLElement
  inspectorSlot: HTMLElement
  planetGroup: THREE.Group
  getGlobe(): GlobeMesh | null
  setUrlParam(name: string, value: string | null): void
  onSelectSettlement(id: number): void
  /** Fly the camera to a cell (and stop the spin). */
  flyToCell(cell: number): void
  /** Jump the timeline to a year and play from there. */
  playFrom(year: number): void
  /** Marks on the timeline (great epidemics), or null for none. */
  setTimelineMarks(marks: readonly TimelineMark[] | null): void
  addLayerToggle?(t: LayerToggle): HTMLInputElement
  setViewModeAvailable?(mode: ViewMode, available: boolean): void
}

export interface DiseaseView {
  setWorld(world: World): void
  build(world: World, h: History, maxPopulation: number): DiseaseBuilt | null
  disposeBuilt(b: DiseaseBuilt | null | undefined): void
  commit(b: DiseaseBuilt | null, extend: boolean): void
  setViewMode(mode: ViewMode): void
  showSettlement(id: number): void
  setKnownMask(cellYear: Float32Array | null): void
  setMasked(on: boolean): void
  /** The people whose known world is shown (the Fever view takes its tolerance), or -1. */
  setKnownPeople(p: number): void
  setYield(near: number, far: number): void
  tick(year: number, pulseYears: number, effect: number, playing: boolean, camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number): void
  /** "Sick: the great bunewu (struck 1797)" for a settlement at a cell, or fever ground on the Fever view; '' for none. */
  describeCell(cell: number): string
}

const TABS = ['Diseases', 'Epidemics'] as const
/** The Fever view's heat ramp over the burden 0..1 (sRGB 0..255). */
const FEVER_STOPS: readonly (readonly [number, number, number, number])[] = [
  [0, 46, 52, 50],
  [0.12, 64, 80, 54],
  [0.35, 128, 150, 52],
  [0.6, 214, 168, 46],
  [0.82, 222, 98, 40],
  [1, 186, 34, 52],
]
const FEVER_WATER = [14, 22, 38] as const
function feverRamp(x: number, out: Uint8Array, o: number) {
  const t = Math.max(0, Math.min(1, x))
  let k = 1
  while (k < FEVER_STOPS.length - 1 && t > FEVER_STOPS[k][0]) k++
  const a = FEVER_STOPS[k - 1], b = FEVER_STOPS[k]
  const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0])
  out[o] = a[1] + (b[1] - a[1]) * f
  out[o + 1] = a[2] + (b[2] - a[2]) * f
  out[o + 2] = a[3] + (b[3] - a[3]) * f
}
const feverCss = (x: number) => {
  const c = new Uint8Array(3)
  feverRamp(x, c, 0)
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}
/** When in an epidemic (0 first .. 1 last), as the map's ramp (render/disease.ts). */
const RAMP_CSS = 'linear-gradient(to right, rgb(255, 242, 140), rgb(255, 153, 46), rgb(219, 31, 77))'

export function createDiseaseView(deps: DiseaseViewDeps): DiseaseView {
  // ---------- panel ----------
  const root = document.createElement('div')
  root.className = 'panel disease hidden'
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'gp-head'
  head.title = 'Show or hide sickness: diseases and epidemics (D)'
  const title = document.createElement('span')
  title.className = 'gp-title'
  title.textContent = 'Sickness'
  const count = document.createElement('span')
  count.className = 'gp-count'
  const caret = document.createElement('span')
  caret.className = 'caret'
  caret.setAttribute('aria-hidden', 'true')
  head.append(title, count, caret)
  const body = document.createElement('div')
  body.className = 'gp-body'
  body.id = 'disease-body'
  head.setAttribute('aria-controls', body.id)
  const tabs = document.createElement('div')
  tabs.className = 'gp-tabs'
  tabs.setAttribute('role', 'tablist')
  const tabBtns = TABS.map((t, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'gp-tab'
    b.textContent = t
    b.dataset.tab = String(i)
    b.setAttribute('role', 'tab')
    tabs.appendChild(b)
    return b
  })
  // the chart of deaths by epidemic over time (Epidemics tab)
  const chartWrap = document.createElement('div')
  chartWrap.className = 'dp-chart hidden'
  const chart = document.createElement('canvas')
  chart.title = 'Deaths by epidemic over the run (click one to select it)'
  const chartCursor = document.createElement('div')
  chartCursor.className = 'dp-chart-cursor'
  chartWrap.append(chart, chartCursor)
  const pane = document.createElement('div')
  pane.className = 'gp-pane'
  const detail = document.createElement('div')
  detail.className = 'gp-detail hidden'
  body.append(tabs, chartWrap, detail, pane)
  root.append(head, body)
  deps.right.insertBefore(root, deps.right.querySelector('.chronicle'))

  let collapsed = loadFlag('worldseed.disease.collapsed', true)
  let tab = Math.max(0, Math.min(TABS.length - 1, Number(loadPref('worldseed.disease.tab')) || 0))
  const syncCollapsed = () => {
    root.classList.toggle('collapsed', collapsed)
    head.setAttribute('aria-expanded', String(!collapsed))
  }
  syncCollapsed()
  const toggleCollapsed = () => {
    collapsed = !collapsed
    saveFlag('worldseed.disease.collapsed', collapsed)
    syncCollapsed()
    panelToggled('disease', !collapsed)
    force()
  }
  head.addEventListener('click', toggleCollapsed)
  registerPanel('disease', root, () => !collapsed, () => { if (!collapsed) toggleCollapsed() })
  const syncTabs = () => tabBtns.forEach((b, i) => {
    b.classList.toggle('active', i === tab)
    b.setAttribute('aria-selected', String(i === tab))
  })
  syncTabs()

  // ---------- Fever legend (under the map panel) ----------
  const legend = document.createElement('div')
  legend.className = 'panel sp-legend dp-legend hidden'
  {
    const mapPanel = deps.right.querySelector('.map-panel')
    deps.right.insertBefore(legend, mapPanel ? mapPanel.nextSibling : deps.right.firstChild)
  }
  const legendTitle = document.createElement('div')
  legendTitle.className = 'sp-legend-title'
  legendTitle.textContent = 'Fever: hot, wet lowlands'
  const legendList = document.createElement('div')
  legendList.className = 'sp-legend-list'
  for (const [f, w] of [[1, 'Deadly'], [0.66, 'Heavy'], [0.33, 'Light'], [0, 'None']] as const) {
    const item = document.createElement('div')
    item.className = 'sp-legend-item none'
    const sw = document.createElement('span')
    sw.className = 'sp-swatch'
    sw.style.background = feverCss(f)
    item.append(sw, w)
    legendList.appendChild(item)
  }
  const feverRow = document.createElement('label')
  feverRow.className = 'dp-fever-row'
  const feverLabel = document.createElement('span')
  feverLabel.textContent = 'As felt by'
  const feverSelect = document.createElement('select')
  feverSelect.className = 'chr-filter-select'
  feverSelect.title = 'Scale the fever by how hardened a people is to it at the year shown'
  feverRow.append(feverLabel, feverSelect)
  const feverNote = document.createElement('div')
  feverNote.className = 'dp-fever-note'
  legend.append(legendTitle, legendList, feverRow, feverNote)

  // ---------- inspector section ----------
  const slot = deps.inspectorSlot
  slot.classList.add('hidden')

  // ---------- state ----------
  const params = new URLSearchParams(window.location.search)
  const intParam = (n: string) => {
    const v = params.get(n)
    const x = v === null ? NaN : Number.parseInt(v, 10)
    return Number.isFinite(x) ? x : -1
  }
  type Sel = { kind: 'none' } | { kind: 'epidemic' | 'disease'; id: number }
  let sel: Sel = { kind: 'none' }
  let pending: { epidemic: number; disease: number } | null = { epidemic: intParam('epidemic'), disease: intParam('sickness') }
  let world: World | null = null
  let data: DiseaseData | null = null
  let layer: DiseaseLayer | null = null
  let toggle: HTMLInputElement | null = null
  const prefs = loadLayerPrefs()
  let layerOn = params.has('disease') ? params.get('disease') !== '0' : (prefs['disease'] ?? true)
  if (!layerOn && !params.has('disease')) deps.setUrlParam('disease', '0')
  let viewMode: ViewMode = ViewMode.Terrain
  let knownMask: Float32Array | null = null
  let knownPeople = -1
  /** The people the Fever view is scaled for: -1 none (the natural fever), else a people id; null follows the known world. */
  let feverPeople: number | null = null
  let inspected = -1
  let year = 0
  let shownPaneKey = ''
  let shownDetailKey = ''
  let shownInspKey = ''
  let shownCount = ''
  let shownChartKey = ''
  let shownCursor = -1
  let shownFeverKey = ''
  let shownFeverNote = ''
  /** renaming: the names in force last shown (renamingData.ts namesEpoch): its lines name towns as at the year. */
  let shownNames = -1
  let feverRgb: Uint8Array | null = null
  /** Living settlements per cell (for the hover readout), rebuilt per history. */
  let atCell = new Map<number, number[]>()

  /** The whole year the panels last showed, and whether something besides the year changed since (the panels are only looked at then). */
  let tickedYear = NaN
  let dirty = true
  const force = () => {
    shownPaneKey = shownDetailKey = shownInspKey = shownCount = shownChartKey = ''
    shownCursor = -1
    dirty = true
    requestRender()
  }

  const sname = (id: number) => (data ? settlementName(data.history, id) : '')
  const settLink = (id: number) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'gp-link'
    b.dataset.sid = String(id)
    b.textContent = sname(id)
    return b
  }
  const dot = (color: string) => {
    const s = document.createElement('span')
    s.className = 'gp-dot'
    s.style.background = color
    return s
  }
  const el = (tag: string, cls: string, ...parts: (string | Node)[]) => {
    const e = document.createElement(tag)
    e.className = cls
    e.append(...parts)
    return e
  }
  const span = (cls: string, text: string, tip?: string) => {
    const s = document.createElement('span')
    s.className = cls
    s.textContent = text
    if (tip) s.title = tip
    return s
  }
  const note = (text: string) => el('div', 'gp-note', text)
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const pct = (f: number) => (f > 0 && f < 0.005 ? '<1%' : `${Math.round(f * 100)}%`)
  const kindCss = (d: number) => KIND_CSS[data?.diseases[d]?.kind ?? 0] ?? '#ccc'
  const dname = (d: number) => data?.names[d] || 'A sickness'

  function syncLayer() {
    layer?.setShown(layerOn)
    requestRender()
  }

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const tb = t.closest('[data-tab]') as HTMLElement | null
    if (tb) {
      tab = Number(tb.dataset.tab)
      savePref('worldseed.disease.tab', String(tab))
      syncTabs()
      force()
      return
    }
    const sl = t.closest('[data-sid]') as HTMLElement | null
    if (sl) {
      deps.onSelectSettlement(Number(sl.dataset.sid))
      return
    }
    const pl = t.closest('[data-play]') as HTMLElement | null
    if (pl) {
      deps.playFrom(Number(pl.dataset.play))
      return
    }
    const it = t.closest('[data-sel]') as HTMLElement | null
    if (it) {
      const kind = it.dataset.sel as 'epidemic' | 'disease'
      const id = Number(it.dataset.id)
      if (sel.kind === kind && sel.id === id) select({ kind: 'none' }, false)
      else select({ kind, id }, true)
      return
    }
    if (t.closest('.gp-close')) select({ kind: 'none' }, false)
  })
  chart.addEventListener('click', (e) => {
    if (!data) return
    const rect = chart.getBoundingClientRect()
    const y = ((e.clientX - rect.left) / Math.max(1, rect.width)) * Math.max(1, data.history.years)
    // the epidemic nearest the click (by its span), the larger first
    let best = -1, bd = Infinity
    for (let k = 0; k < data.E; k++) {
      const x = data.epidemics[k]
      if (data.eOff[k + 1] === data.eOff[k]) continue
      const dist = y < x.startYear ? x.startYear - y : y > data.epiEnd[k] ? y - data.epiEnd[k] : 0
      const score = dist - Math.log1p(x.deaths) * 2
      if (dist < data.history.years * 0.02 && score < bd) {
        bd = score
        best = k
      }
    }
    if (best >= 0) select({ kind: 'epidemic', id: best }, true)
  })
  feverSelect.addEventListener('change', () => {
    const v = Number(feverSelect.value)
    feverPeople = Number.isFinite(v) ? v : -1
    shownFeverKey = ''
    dirty = true
    requestRender()
  })

  /** Where to fly for a selection. */
  function cellOf(s: Sel): number {
    if (!data || s.kind === 'none') return -1
    const H = data.history
    if (s.kind === 'epidemic') {
      const o = data.epidemics[s.id]?.origin ?? -1
      return o >= 0 && o < data.N ? H.settlements[o].cell : -1
    }
    const d = data.diseases[s.id]
    if (!d) return -1
    if (d.originCell >= 0) return d.originCell
    return d.firstSettlement >= 0 && d.firstSettlement < data.N ? H.settlements[d.firstSettlement].cell : -1
  }

  function select(s: Sel, fly: boolean) {
    const valid = (n: number, k: string) => !!data && n >= 0 && n < (k === 'epidemic' ? data.E : k === 'disease' ? data.D : 0)
    if (s.kind !== 'none' && !valid(s.id, s.kind)) s = { kind: 'none' }
    if (s.kind === 'disease' && data && data.diseases[s.id].firstYear < 0) s = { kind: 'none' }
    sel = s
    deps.setUrlParam('epidemic', s.kind === 'epidemic' ? String(s.id) : null)
    deps.setUrlParam('sickness', s.kind === 'disease' ? String(s.id) : null)
    layer?.setSelection(s.kind === 'epidemic' ? s.id : -1, s.kind === 'disease' ? s.id : -1)
    if (s.kind === 'epidemic' && tab !== 1) {
      tab = 1
      syncTabs()
    } else if (s.kind === 'disease' && tab !== 0) {
      tab = 0
      syncTabs()
    }
    if (fly) {
      const c = cellOf(s)
      if (c >= 0) deps.flyToCell(c)
    }
    force()
  }

  // ---------- panel content ----------
  function updateCount() {
    if (!data) return
    const act = activeEpidemics(data, year)
    let c = ''
    if (act.length === 1) {
      const ex = epidemicExtent(data, act[0], year)
      c = `${cap(epidemicNoun(data, act[0]))}: ${ex.sick} sick`
    } else if (act.length > 1) {
      let sick = 0
      for (const e of act) sick += epidemicExtent(data, e, year).sick
      c = `${act.length} epidemics · ${sick} sick`
    } else c = 'none now'
    if (c !== shownCount) {
      shownCount = c
      count.textContent = c
      count.classList.toggle('dp-hot', act.length > 0)
    }
  }

  function row(selKind: string, id: number, selected: boolean, ...cells: (string | Node)[]) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'gp-row' + (selected ? ' selected' : '')
    b.dataset.sel = selKind
    b.dataset.id = String(id)
    b.append(...cells)
    return b
  }

  function updatePane() {
    if (!data || collapsed) return
    const dd = data
    const yi = Math.floor(year + 1e-6)
    const selKey = sel.kind === 'none' ? '' : `${sel.kind}${sel.id}`
    // (the Diseases tab changes with the snapshot: endemic lists; the Epidemics tab every year)
    const key = `${tab}:${selKey}:${tab === 1 ? yi : snapOf(dd, year)}`
    if (key === shownPaneKey) return
    shownPaneKey = key
    pane.replaceChildren()
    chartWrap.classList.toggle('hidden', tab !== 1)
    if (tab === 0) {
      const list: number[] = []
      for (let d = 0; d < dd.D; d++) if (dd.diseases[d].firstYear >= 0 && dd.diseases[d].firstYear <= year) list.push(d)
      const later = dd.diseases.filter((x) => x.firstYear > year).length
      if (!list.length) pane.append(note(later ? `No sickness has struck yet (the first in ${Math.min(...dd.diseases.filter((x) => x.firstYear >= 0).map((x) => x.firstYear))}).` : 'No sickness in this history.'))
      for (const d of list) {
        const x = dd.diseases[d]
        const r = row('disease', d, sel.kind === 'disease' && sel.id === d, dot(kindCss(d)), span('gp-name', dname(d)), span('gp-sub', dd.gloss[d]), span('gp-num', String(x.firstYear), 'First struck'))
        r.title = `${dname(d)}, ${dd.gloss[d]}: ${mortalityWords(x)}` + (x.kind === DiseaseKind.Fever ? '' : x.sea > 0 ? '; travels by ship' : '; does not travel by sea')
        pane.append(r)
      }
      if (later && list.length) pane.append(el('div', 'gp-line gp-faint', `${later} more ${later === 1 ? 'sickness is' : 'sicknesses are'} still to appear`))
      return
    }
    // epidemics: those going on now, then the great ones
    const act = activeEpidemics(dd, year)
    if (act.length) {
      pane.append(el('div', 'gp-cap', 'Now'))
      for (const e of act) {
        const x = dd.epidemics[e]
        const ex = epidemicExtent(dd, e, year)
        const r = row('epidemic', e, sel.kind === 'epidemic' && sel.id === e, dot(kindCss(x.disease)), span('gp-name', epidemicTitle(dd, e)), span('gp-sub', `${ex.places} ${ex.places === 1 ? 'place' : 'places'} · ${ex.sick} sick`), span('gp-num', formatPopulation(ex.deaths), 'Dead so far'))
        r.classList.add('dp-now')
        pane.append(r)
      }
    }
    pane.append(el('div', 'gp-cap', 'Great epidemics'))
    if (!dd.great.length) pane.append(note('No great epidemic in this history (one that kills a twentieth of the peoples it reaches).'))
    for (const e of dd.great) {
      const x = dd.epidemics[e]
      const share = x.network > 0 ? x.deaths / x.network : 0
      const ahead = x.startYear > year
      const r = row('epidemic', e, sel.kind === 'epidemic' && sel.id === e, dot(kindCss(x.disease)), span('gp-name', epidemicTitle(dd, e)), span('gp-sub', `${x.startYear}–${x.endYear >= 0 ? x.endYear : '…'} · ${x.peoples.length} ${x.peoples.length === 1 ? 'people' : 'peoples'}`), span('gp-num', ahead ? 'ahead' : pct(share), ahead ? 'Not yet' : 'Share of the peoples it reached lost'))
      if (ahead) r.classList.add('ended')
      r.title = `${epidemicTitle(dd, e)}: began at ${sname(x.origin)}; ${x.outbreaks} places, ${x.peoples.length} peoples; took ${shareWords(share)} (${formatPopulation(x.deaths)} of ${formatPopulation(x.network)})`
      pane.append(r)
    }
    const minor = dd.E - dd.great.length
    if (minor > 0) pane.append(el('div', 'gp-line gp-faint', `and ${minor} lesser epidemics over the run (on the chart)`))
  }

  // ---------- the chart: deaths by epidemic over the run ----------
  function updateChart() {
    if (!data || collapsed || tab !== 1) return
    const dd = data
    const H = dd.history
    const key = `${H.years}:${sel.kind === 'epidemic' ? sel.id : -1}`
    if (key !== shownChartKey) {
      shownChartKey = key
      // (measured only when redrawn: the canvas stretches with the column)
      const w = Math.max(120, Math.round(chartWrap.clientWidth || 240))
      shownCursor = -1
      const hgt = 46
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      chart.width = w * dpr
      chart.height = hgt * dpr
      chart.style.width = `${w}px`
      chart.style.height = `${hgt}px`
      const ctx = chart.getContext('2d')
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, w, hgt)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
        ctx.fillRect(0, hgt - 1, w, 1)
        let max = 1
        for (const x of dd.epidemics) max = Math.max(max, x.deaths)
        const sx = (y: number) => (y / Math.max(1, H.years)) * w
        // lesser first, the great over them
        for (const pass of [0, 1]) {
          for (let e = 0; e < dd.E; e++) {
            const x = dd.epidemics[e]
            if ((pass === 1) !== x.great || dd.eOff[e + 1] === dd.eOff[e]) continue
            const hh = Math.max(1.5, Math.sqrt(x.deaths / max) * (hgt - 6))
            const x0 = sx(x.startYear), x1 = Math.max(x0 + 2, sx(dd.epiEnd[e] + 1))
            const selected = sel.kind === 'epidemic' && sel.id === e
            ctx.globalAlpha = selected ? 1 : x.great ? 0.85 : 0.45
            ctx.fillStyle = KIND_CSS[dd.diseases[x.disease]?.kind ?? 0]
            ctx.fillRect(x0, hgt - 1 - hh, x1 - x0, hh)
            if (selected) {
              ctx.globalAlpha = 1
              ctx.strokeStyle = '#ffffff'
              ctx.lineWidth = 1
              ctx.strokeRect(x0 - 1.5, hgt - 2.5 - hh, x1 - x0 + 3, hh + 2)
            }
          }
        }
        ctx.globalAlpha = 1
      }
    }
    const c = Math.round((year / Math.max(1, H.years)) * 1000)
    if (c !== shownCursor) {
      shownCursor = c
      chartCursor.style.left = `${(c / 10).toFixed(1)}%`
    }
  }

  function updateDetail() {
    // (the detail goes with its tab: a disease's on Diseases, an epidemic's on Epidemics)
    if (!data || collapsed || sel.kind === 'none' || (sel.kind === 'disease') !== (tab === 0)) {
      if (!detail.classList.contains('hidden')) detail.classList.add('hidden')
      shownDetailKey = ''
      return
    }
    const dd = data
    const H = dd.history
    const yi = Math.floor(year + 1e-6)
    const key = `${sel.kind}:${sel.id}:${sel.kind === 'epidemic' ? yi : snapOf(dd, year)}`
    if (key === shownDetailKey) return
    shownDetailKey = key
    detail.classList.remove('hidden')
    detail.replaceChildren()
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'gp-close'
    close.title = 'Deselect (Esc)'
    close.textContent = '×'
    const line = (...parts: (string | Node)[]) => {
      const d = el('div', 'gp-line', ...parts)
      detail.append(d)
      return d
    }
    if (sel.kind === 'disease') {
      const d = sel.id
      const x = dd.diseases[d]
      detail.append(el('div', 'gp-d-title', dot(kindCss(d)), dname(d), close))
      line(`${cap(dd.gloss[d])} (${KIND_WORDS[x.kind]?.toLowerCase() ?? 'sickness'})`)
      if (x.firstSettlement >= 0) line(`First struck `, settLink(x.firstSettlement), ` in ${x.firstYear}` + (x.originPeople >= 0 && H.peoples[x.originPeople] ? `, among the ${H.peoples[x.originPeople].name}` : ''))
      line(cap(mortalityWords(x)) + (x.kind === DiseaseKind.Fever ? '' : `; sick for ${x.duration} ${x.duration === 1 ? 'year' : 'years'}; ${x.fade > 0 ? 'immunity fades' : 'survivors are immune for life'}`))
      if (x.placeBound || x.kind === DiseaseKind.Fever) line('Bound to its ground: it never travels (see the Fever view)').classList.add('gp-faint')
      else line(x.sea > 0 ? `Travels by ship${x.sea > 1 ? ', readily' : ''}` : 'Does not travel by sea').classList.add('gp-faint')
      if (x.criticalSize > 0) line(`Settles in as a childhood sickness among peoples of ${formatPopulation(x.criticalSize)} or more (with their trade partners)`).classList.add('gp-faint')
      const s = snapOf(dd, year)
      const among: string[] = []
      for (let p = 0; p < dd.P; p++) if (endemicAt(dd, p, s).includes(d)) among.push(H.peoples[p]?.name ?? '')
      if (among.length) line(`A childhood sickness now among the ${among.join(', ')}`)
      // its epidemics so far
      let n = 0, deaths = 0
      const greats: number[] = []
      for (let e = 0; e < dd.E; e++) {
        const ep = dd.epidemics[e]
        if (ep.disease !== d || ep.startYear > year) continue
        n++
        deaths += epidemicExtent(dd, e, year).deaths
        if (ep.great) greats.push(e)
      }
      if (n) line(`${n} ${n === 1 ? 'epidemic' : 'epidemics'} by ${yi}, ${formatPopulation(deaths)} dead`)
      if (greats.length) {
        const l = line('Great: ')
        greats.forEach((e, i) => {
          if (i) l.append(', ')
          const b = document.createElement('button')
          b.type = 'button'
          b.className = 'gp-link'
          b.dataset.sel = 'epidemic'
          b.dataset.id = String(e)
          b.textContent = String(dd.epidemics[e].startYear)
          l.append(b)
        })
      }
      return
    }
    const e = sel.id
    const x = dd.epidemics[e]
    detail.append(el('div', 'gp-d-title', dot(kindCss(x.disease)), epidemicTitle(dd, e), close))
    line(`${cap(dd.gloss[x.disease] ?? '')}, ${x.startYear}–${x.endYear >= 0 ? x.endYear : 'still going at the end'}`)
    const b = line('Began at ', settLink(x.origin))
    if (x.source >= 0) b.append(', brought from ', settLink(x.source))
    else b.append(dd.diseases[x.disease]?.kind === DiseaseKind.Plague ? ', a spill from the rodents' : dd.diseases[x.disease]?.kind === DiseaseKind.Camp ? ', in an army camp' : ', from the herds and the crowds')
    const share = x.network > 0 ? x.deaths / x.network : 0
    line(`${x.outbreaks} places of ${x.peoples.length} ${x.peoples.length === 1 ? 'people' : 'peoples'}; it took ${shareWords(share)} of them (${formatPopulation(x.deaths)} of ${formatPopulation(x.network)})`)
    if (year >= x.startYear && year <= dd.epiEnd[e]) {
      const ex = epidemicExtent(dd, e, year)
      line(`By ${yi}: ${ex.places} places struck, ${ex.sick} sick now, ${formatPopulation(ex.deaths)} dead`).classList.add('dp-hot')
    } else if (year < x.startYear) line(`(not yet: it begins in ${x.startYear})`).classList.add('gp-faint')
    const play = document.createElement('button')
    play.type = 'button'
    play.className = 'btn dp-play'
    play.dataset.play = String(Math.max(0, x.startYear - 3))
    play.textContent = '▶ Play this epidemic'
    play.title = `Jump to ${Math.max(0, x.startYear - 3)} and play`
    const rampBar = el('span', 'dp-ramp')
    rampBar.style.background = RAMP_CSS
    const lo = dd.eOff[e], hi = dd.eOff[e + 1]
    const last = hi > lo ? dd.eYear[hi - 1] : x.startYear
    detail.append(el('div', 'dp-play-row', play, el('span', 'dp-ramp-wrap', span('', String(hi > lo ? dd.eYear[lo] : x.startYear)), rampBar, span('', String(last)))))
    // the places it struck, in order
    const list = el('div', 'dp-places')
    const shown = Math.min(hi - lo, 40)
    for (let k = lo; k < lo + shown; k++) {
      const i = dd.eList[k]
      const id = dd.O.settlement[i]
      const src = dd.O.source[i]
      const it = el('div', 'dp-place' + (dd.O.year[i] > year ? ' ahead' : ''), span('dp-y', String(dd.O.year[i])), settLink(id))
      if (dd.rowCity[i]) it.append(span('dp-city', 'city'))
      it.append(span('gp-faint', ` ${viaPhrase(src >= 0 ? dd.O.via[i] : 0, sname(src))}`))
      it.title = `${dd.O.year[i]}: ${sname(id)}, ${pct(dd.O.mortality[i] / 255)} to die` + (src >= 0 ? `, ${viaPhrase(dd.O.via[i], sname(src))}` : '')
      list.append(it)
    }
    if (hi - lo > shown) list.append(el('div', 'gp-line gp-faint', `and ${hi - lo - shown} more`))
    detail.append(list)
  }

  // ---------- inspector ----------
  function inspectorLines(dd: DiseaseData, id: number): (string | Node)[][] {
    const H = dd.history
    const out: (string | Node)[][] = []
    const s = H.settlements[id]
    const now = sickRow(dd, id, year)
    if (now >= 0) {
      const e = dd.O.epidemic[now]
      const src = dd.O.source[now]
      const l: (string | Node)[] = [`Sick with ${epidemicNoun(dd, e)} since ${dd.O.year[now]}: ${pct(dd.O.mortality[now] / 255)} to die`]
      if (src >= 0) l.push(`; it came ${viaPhrase(dd.O.via[now], '').replace(/ $/, '')} `, settLink(src))
      out.push(l)
    }
    // its people: childhood sicknesses and the fever
    const p = s.people
    const sn = snapOf(dd, year)
    const end = endemicAt(dd, p, sn)
    const pn = H.peoples[p]?.name
    if (end.length) out.push([`Childhood sicknesses of the ${pn ?? 'people'}: ${end.map((d) => dd.diseases[d]?.name ?? '').join(', ')}`])
    // the last great epidemic its people suffered (over by the year), and how many in all
    const losses = peopleLosses(dd, p).filter((x) => dd.epiEnd[x.epi] <= year)
    if (losses.length) {
      const last = losses[losses.length - 1]
      out.push([`The ${pn ?? 'people'} lost ${pct(last.share)} to ${epidemicNoun(dd, last.epi)} of ${dd.epidemics[last.epi].startYear}` + (losses.length > 1 ? ` (${losses.length} great epidemics in all)` : '')])
    }
    if (dd.fever) {
      const fw = feverWords(dd.fever[s.cell])
      if (fw) out.push([`${cap(fw)}; its people are ${toleranceWords(toleranceAt(dd, p, sn))}`])
    }
    for (const q of quarantinesOf(dd, id, year)) out.push([q.to < 0 ? `Holds ships from sick ports in quarantine since ${q.from}` : `Held ships in quarantine ${q.from}–${q.to}`])
    // what it suffered
    const rows = rowsOfSettlement(dd, id, year).filter((i) => i !== now)
    for (const i of rows.slice(0, 5)) {
      const src = dd.O.source[i]
      const l: (string | Node)[] = [`${dd.O.year[i]}: ${dd.diseases[dd.O.disease[i]]?.name ?? 'sickness'}${dd.epidemics[dd.O.epidemic[i]]?.great ? ' (great)' : ''}, lost ${pct(dd.O.mortality[i] / 255)}`]
      if (src >= 0) l.push(`, ${viaPhrase(dd.O.via[i], '').replace(/ $/, '')} `, settLink(src))
      out.push(l)
    }
    if (rows.length > 5) out.push([`and ${rows.length - 5} earlier outbreaks`])
    return out
  }

  function updateInspector() {
    if (!data || inspected < 0) return
    const key = `${inspected}:${Math.floor(year + 1e-6)}`
    if (key === shownInspKey) return
    shownInspKey = key
    slot.replaceChildren()
    const s = data.history.settlements[inspected]
    if (!s || year < s.foundedYear) {
      slot.classList.add('hidden')
      return
    }
    const lines = inspectorLines(data, inspected)
    lines.forEach((parts, k) => {
      const d = document.createElement('div')
      if (k === 0 && sickRow(data!, inspected, year) >= 0) d.className = 'dp-hot'
      for (const p of parts) {
        if (p instanceof HTMLElement && p.classList.contains('gp-link')) p.className = 'insp-link'
        d.append(p)
      }
      slot.append(d)
    })
    slot.classList.toggle('hidden', lines.length === 0)
  }

  // ---------- the Fever view ----------
  const feverShown = () => viewMode === ViewMode.Fever
  const syncLegend = () => legend.classList.toggle('hidden', !feverShown() || !data?.fever)
  function syncFeverOptions() {
    feverSelect.replaceChildren()
    const add = (v: number, text: string) => {
      const o = document.createElement('option')
      o.value = String(v)
      o.textContent = text
      feverSelect.append(o)
    }
    add(-1, 'newcomers (no tolerance)')
    if (data) data.history.peoples.forEach((p, i) => add(i, `the ${p.name}`))
  }
  function updateFever() {
    const globe = deps.getGlobe()
    const fever = data?.fever
    if (!feverShown() || !data || !fever || !world || !globe) return
    const dd = data
    const p = feverPeople ?? (knownPeople >= 0 ? knownPeople : -1)
    const s = snapOf(dd, year)
    // (the tolerance in steps of 1/64: the colours are rewritten only when it moves a step)
    const tol = p >= 0 ? Math.round(toleranceAt(dd, p, s) * 64) / 64 : 0
    const key = `${p}:${tol}`
    if (String(p) !== feverSelect.value) feverSelect.value = String(p)
    const nt = p >= 0 ? `The ${dd.history.peoples[p]?.name ?? ''} are ${toleranceWords(toleranceAt(dd, p, s))} in ${Math.floor(year + 1e-6)}` : 'As it strikes a people new to it'
    if (nt !== shownFeverNote) {
      shownFeverNote = nt
      feverNote.textContent = nt
    }
    if (key === shownFeverKey) return
    shownFeverKey = key
    const n = world.grid.cellCount
    if (!feverRgb || feverRgb.length !== n * 3) feverRgb = new Uint8Array(n * 3)
    const lake = (world as Partial<World>).lake
    for (let c = 0; c < n; c++) {
      if (world.elevation[c] < 0 || lake?.[c] === 1) {
        feverRgb[c * 3] = FEVER_WATER[0]
        feverRgb[c * 3 + 1] = FEVER_WATER[1]
        feverRgb[c * 3 + 2] = FEVER_WATER[2]
      } else feverRamp((fever[c] / 255) * (1 - tol), feverRgb, c * 3)
    }
    globe.setFeverColors(feverRgb)
  }

  // ---------- notes in other panels ----------
  function peopleNote(p: number, y: number, s0: number): string[] {
    const dd = data
    if (!dd || p < 0 || p >= dd.P) return []
    const out: string[] = []
    const end = endemicAt(dd, p, s0)
    if (end.length) out.push(`Childhood sicknesses: ${end.map((d) => dd.diseases[d]?.name ?? '').join(', ')}`)
    if (dd.tolerance) out.push(cap(toleranceWords(toleranceAt(dd, p, s0))))
    const losses = peopleLosses(dd, p).filter((x) => dd.epiEnd[x.epi] <= y)
    if (losses.length) out.push(`Great epidemics: ${losses.map((x) => `${dd.diseases[dd.epidemics[x.epi].disease]?.name ?? ''} ${dd.epidemics[x.epi].startYear} (lost ${pct(x.share)})`).join(', ')}`)
    return out
  }
  function polityNote(q: number, y: number): (string | Node)[][] {
    const dd = data
    if (!dd) return []
    const evs = (dd.armiesOf.get(q) ?? []).filter((i) => dd.history.events[i].year <= y)
    if (!evs.length) return []
    const last = dd.history.events[evs[evs.length - 1]]
    return [[evs.length === 1 ? `Sickness broke one of its armies, in ${last.year} marching on ` : `Sickness broke ${evs.length} of its armies, the last in ${last.year} marching on `, settLink(last.settlement)]]
  }

  addShortcut({
    keys: ['Escape'],
    label: 'Esc',
    description: 'Close a popup, else leave the known world, else deselect',
    group: 'Panels',
    run: () => {
      if (sel.kind === 'none') return false
      select({ kind: 'none' }, false)
    },
  })
  addShortcut({ keys: ['d', 'D'], label: 'D', description: 'Show or hide sickness (diseases and epidemics)', group: 'Panels', run: () => (data ? toggleCollapsed() : false) })

  const api: DiseaseView = {
    setWorld(w: World) {
      world = w
      shownFeverKey = ''
      feverRgb = null
    },
    build(w: World, hist: History, maxPopulation: number) {
      const dd = diseaseOf(hist, w)
      if (!dd) return null
      return { data: dd, layer: buildDiseaseLayer(w, hist, dd, maxPopulation) }
    },
    disposeBuilt(b) {
      if (!b) return
      deps.planetGroup.remove(b.layer.object)
      b.layer.dispose()
    },
    commit(b: DiseaseBuilt | null, extend: boolean) {
      if (layer) {
        deps.planetGroup.remove(layer.object)
        layer.dispose()
      }
      layer = b?.layer ?? null
      data = b?.data ?? null
      atCell = new Map()
      if (data) {
        for (const s of data.history.settlements) {
          const a = atCell.get(s.cell)
          if (a) a.push(s.id)
          else atCell.set(s.cell, [s.id])
        }
      }
      if (layer) {
        deps.planetGroup.add(layer.object)
        layer.setKnownMask(knownMask)
        layer.setMasked(knownMask !== null)
      }
      root.classList.toggle('hidden', !data)
      deps.setViewModeAvailable?.(ViewMode.Fever, !!data?.fever)
      if (data && !toggle && deps.addLayerToggle) {
        toggle = deps.addLayerToggle({
          key: 'disease',
          label: 'Sickness',
          group: 'people',
          checked: layerOn,
          title: 'Epidemics spreading: places sick, the way the sickness came, the ground it passed; ports in quarantine',
          onChange: (on) => {
            layerOn = on
            deps.setUrlParam('disease', on ? null : '0')
            syncLayer()
          },
        })
      }
      toggle?.closest('label')?.classList.toggle('hidden', !data)
      setPolityDiseaseNote(data ? polityNote : null)
      setPeopleDiseaseNote(data ? peopleNote : null)
      syncFeverOptions()
      syncLegend()
      shownFeverKey = ''
      // timeline marks: the great epidemics
      if (data) {
        const dd = data
        deps.setTimelineMarks(dd.great.map((e) => {
          const x = dd.epidemics[e]
          const share = x.network > 0 ? x.deaths / x.network : 0
          return { from: x.startYear, to: dd.epiEnd[e], color: KIND_CSS[dd.diseases[x.disease]?.kind ?? 0], title: `${epidemicTitle(dd, e)} (${x.startYear}–${x.endYear >= 0 ? x.endYear : '…'}): took ${shareWords(share)} of the peoples it reached` }
        }))
      } else deps.setTimelineMarks(null)
      if (!extend) sel = { kind: 'none' }
      if (pending && data) {
        const p = pending
        pending = null
        if (p.epidemic >= 0) select({ kind: 'epidemic', id: p.epidemic }, false)
        else if (p.disease >= 0) select({ kind: 'disease', id: p.disease }, false)
      } else select(sel, false)
      syncLayer()
      force()
    },
    setViewMode(mode: ViewMode) {
      viewMode = mode
      syncLegend()
      shownFeverKey = ''
      dirty = true
      requestRender()
    },
    showSettlement(id: number) {
      inspected = id
      shownInspKey = ''
      dirty = true
      if (id < 0 || !data) slot.classList.add('hidden')
      requestRender()
    },
    setKnownMask(cellYear: Float32Array | null) {
      knownMask = cellYear
      layer?.setKnownMask(cellYear)
    },
    setMasked(on: boolean) {
      layer?.setMasked(on)
    },
    setKnownPeople(p: number) {
      knownPeople = p
      // the Fever view follows the known world shown
      feverPeople = null
      shownFeverKey = ''
      dirty = true
    },
    setYield(near: number, far: number) {
      layer?.setYield(near, far)
    },
    tick(y, pulseYears, effect, playing, camera, drawSize, pixelRatio) {
      year = y
      if (!data) return
      if (layer) {
        layer.setTime(y, pulseYears, effect, playing)
        layer.update(camera, drawSize, pixelRatio)
      }
      // renaming: a name in force changed: rewrite the lines that name towns
      if (namesEpoch() !== shownNames) {
        shownNames = namesEpoch()
        shownPaneKey = shownDetailKey = shownInspKey = ''
        dirty = true
      }
      // the panels change with the whole year (and with selections, tabs, the view): nothing to look at in between
      const yi = Math.floor(y + 1e-6)
      if (yi === tickedYear && !dirty) return
      tickedYear = yi
      dirty = false
      updateCount()
      updatePane()
      updateChart()
      updateDetail()
      updateInspector()
      updateFever()
    },
    describeCell(cell: number) {
      if (!data) return ''
      const dd = data
      const parts: string[] = []
      for (const id of atCell.get(cell) ?? []) {
        const r = sickRow(dd, id, year)
        if (r >= 0) parts.push(`Sick: ${epidemicNoun(dd, dd.O.epidemic[r])} (struck ${dd.O.year[r]})`)
        for (const q of quarantinesOf(dd, id, year)) if (q.to < 0) parts.push('Ships held in quarantine')
      }
      if (feverShown() && dd.fever) {
        const w = feverWords(dd.fever[cell])
        if (w) parts.push(cap(w))
      }
      return parts.join(' · ')
    },
  }
  deps.setViewModeAvailable?.(ViewMode.Fever, false)
  if (params.get('perf') === '1') {
    // debugging and measurement: the data, the layer's state, selections; and where a settlement is (camera az / lat in degrees)
    ;(window as unknown as { __worldseedDisease: unknown }).__worldseedDisease = {
      data: () => data,
      active: () => layer?.active ?? false,
      select: (kind: 'epidemic' | 'disease' | 'none', id = -1) => select(kind === 'none' ? { kind: 'none' } : { kind, id }, false),
      where: (id: number) => {
        if (!world || !data || id < 0 || id >= data.N) return null
        const c = data.history.settlements[id].cell
        const P = world.grid.positions
        return { az: (Math.atan2(P[c * 3], P[c * 3 + 2]) * 180) / Math.PI, lat: (Math.asin(Math.max(-1, Math.min(1, P[c * 3 + 1]))) * 180) / Math.PI }
      },
    }
  }
  return api
}
