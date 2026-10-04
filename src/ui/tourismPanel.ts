// Leisure travel in the UI: the "Travel" panel (right column, collapsed by default: tabs for the
// places visited now with their visitors a year and main home towns, the resort towns with the
// rise and fall of their visitors as a tiny sparkline, and the sights), the travel section of the
// inspector, the travellers on the map (render/tourism.ts), the Scenery view and its legend, and
// the hover readout's sights, visitors and scenery.
//
// Clicking a place, resort or sight selects it (the camera flies there). The Travel layer toggle
// (travel=0) hides the map marks and flows. Everything is a function of the year; the lists follow
// the trade snapshot at or before it (every tradeInterval years), and DOM writes happen only when
// what is shown changes.

import * as THREE from 'three'
import { SceneryBit, type History, type World } from '../contract.ts'
import { buildTourismLayer, type TourismLayer } from '../render/tourism.ts'
import { ViewMode } from '../render/palette.ts'
import type { GlobeMesh } from '../render/globe.ts'
import { requestRender } from '../render/invalidate.ts'
import { formatPopulation, settlementName } from './format.ts'
import {
  causeWords, fameWords, inFashion, lastDecline, placesAt, resortState, sceneryGrade, sceneryWords, SIGHT_CSS, SIGHT_GLYPH, SIGHT_SHORT, sightPhrase, sightsBy,
  snapAt, sourcesAt, sourcesUpTo, spendAt, tourismOf, TRAVEL_CSS, tripsFrom, visitorsAt, worldVisitors, type TourismData,
} from './tourismData.ts'
import { causeShort } from './tourismFormat.ts'
import { loadFlag, loadPref, saveFlag, savePref } from './panels.ts'
import { addShortcut } from './shortcuts.ts'
import { loadLayerPrefs, type LayerToggle } from './overlay.ts'
import './tourism.css'

export interface TourismBuilt {
  data: TourismData
  layer: TourismLayer
}

export interface TourismViewDeps {
  right: HTMLElement
  inspectorSlot: HTMLElement
  planetGroup: THREE.Group
  getGlobe(): GlobeMesh | null
  setUrlParam(name: string, value: string | null): void
  onSelectSettlement(id: number): void
  /** Fly the camera to a cell (and stop the spin). */
  flyToCell(cell: number): void
  addLayerToggle?(t: LayerToggle): HTMLInputElement
  setViewModeAvailable?(mode: ViewMode, available: boolean): void
}

export interface TourismView {
  setWorld(world: World): void
  build(world: World, h: History, maxPopulation: number): TourismBuilt | null
  disposeBuilt(b: TourismBuilt | null | undefined): void
  commit(b: TourismBuilt | null, extend: boolean): void
  setViewMode(mode: ViewMode): void
  showSettlement(id: number): void
  setKnownMask(cellYear: Float32Array | null): void
  setMasked(on: boolean): void
  setYield(near: number, far: number): void
  tick(year: number, effect: number, camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number): void
  /** "Sight: the ruins of Kuniden" / "240 visitors a year" / the scenery on the Scenery view, for a cell; '' for none. */
  describeCell(cell: number): string
}

const TABS = ['Places', 'Resorts', 'Sights'] as const

// ---------- the Scenery view's colours ----------
/** Families of scenery, as the Scenery view colours the finer places (sRGB 0..255) and its legend names them. */
const FAMILIES: readonly { label: string; rgb: readonly [number, number, number] }[] = [
  { label: 'Heights and snow', rgb: [186, 156, 236] },
  { label: 'Shores and islands', rgb: [72, 204, 214] },
  { label: 'Woods and mild country', rgb: [158, 210, 82] },
  { label: 'Hot springs', rgb: [255, 142, 62] },
  { label: 'Ice and tundra', rgb: [160, 212, 248] },
]
const PLAIN = [74, 80, 75] as const
const WATER = [16, 28, 50] as const
function familyOf(bits: number): number {
  const B = SceneryBit
  if (bits & B.Spring) return 3
  if (bits & (B.Snow | B.Relief | B.GreatRange)) return 0
  if (bits & (B.Lake | B.Coast | B.Island | B.River | B.GreatLake)) return 1
  if (bits & B.Cold) return 4
  return 2
}
/** Colour of land of scenery v (0..255) and bits (sRGB 0..255) into out[o..o+2]. */
function sceneryRgb(v: number, bits: number, out: Uint8Array, o: number) {
  const t = v / 255
  const f = FAMILIES[familyOf(bits)].rgb
  const k = Math.pow(Math.min(1, Math.max(0, (t - 0.02) / 0.7)), 0.8)
  const s = k * k * (3 - 2 * k)
  let r = PLAIN[0] + (f[0] - PLAIN[0]) * s, g = PLAIN[1] + (f[1] - PLAIN[1]) * s, b = PLAIN[2] + (f[2] - PLAIN[2]) * s
  // the finest tenth of the land glows toward white
  const w = Math.max(0, (t - 0.73) / 0.27) * 0.38
  r += (255 - r) * w
  g += (255 - g) * w
  b += (255 - b) * w
  out[o] = r
  out[o + 1] = g
  out[o + 2] = b
}
const cssOf = (c: ArrayLike<number>) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`

export function createTourismView(deps: TourismViewDeps): TourismView {
  // ---------- panel ----------
  const root = document.createElement('div')
  root.className = 'panel travel hidden'
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'gp-head'
  head.title = 'Show or hide leisure travel: places visited, resorts and sights (T)'
  const title = document.createElement('span')
  title.className = 'gp-title'
  title.textContent = 'Travel'
  const count = document.createElement('span')
  count.className = 'gp-count'
  const caret = document.createElement('span')
  caret.className = 'caret'
  caret.setAttribute('aria-hidden', 'true')
  head.append(title, count, caret)
  const body = document.createElement('div')
  body.className = 'gp-body'
  body.id = 'travel-body'
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
  const pane = document.createElement('div')
  pane.className = 'gp-pane'
  body.append(tabs, pane)
  root.append(head, body)
  deps.right.insertBefore(root, deps.right.querySelector('.chronicle'))

  let collapsed = loadFlag('worldseed.travel.collapsed', true)
  let tab = Math.max(0, Math.min(TABS.length - 1, Number(loadPref('worldseed.travel.tab')) || 0))
  const syncCollapsed = () => {
    root.classList.toggle('collapsed', collapsed)
    head.setAttribute('aria-expanded', String(!collapsed))
  }
  syncCollapsed()
  const toggleCollapsed = () => {
    collapsed = !collapsed
    saveFlag('worldseed.travel.collapsed', collapsed)
    syncCollapsed()
    force()
    // (the right column scrolls as a whole when it outgrows the window: bring the opened panel into view)
    // (after the next frame has filled it)
    if (!collapsed) window.setTimeout(() => root.scrollIntoView({ block: 'nearest' }), 80)
  }
  head.addEventListener('click', toggleCollapsed)
  const syncTabs = () => tabBtns.forEach((b, i) => {
    b.classList.toggle('active', i === tab)
    b.setAttribute('aria-selected', String(i === tab))
  })
  syncTabs()

  // ---------- Scenery legend (under the map panel) ----------
  const legend = document.createElement('div')
  legend.className = 'panel sp-legend tp-legend hidden'
  {
    const mapPanel = deps.right.querySelector('.map-panel')
    deps.right.insertBefore(legend, mapPanel ? mapPanel.nextSibling : deps.right.firstChild)
  }
  {
    const legendTitle = document.createElement('div')
    legendTitle.className = 'sp-legend-title'
    legendTitle.textContent = 'Scenery: where the views are'
    const legendList = document.createElement('div')
    legendList.className = 'sp-legend-list'
    const sw = new Uint8Array(3)
    for (const [i, f] of FAMILIES.entries()) {
      const item = document.createElement('div')
      item.className = 'sp-legend-item none'
      const s = document.createElement('span')
      s.className = 'sp-swatch'
      sceneryRgb(225, i === 0 ? SceneryBit.Snow : i === 1 ? SceneryBit.Coast : i === 2 ? SceneryBit.Forest : i === 3 ? SceneryBit.Spring : SceneryBit.Cold, sw, 0)
      s.style.background = cssOf(sw)
      item.append(s, f.label)
      legendList.appendChild(item)
    }
    const plain = document.createElement('div')
    plain.className = 'sp-legend-item none'
    const ps = document.createElement('span')
    ps.className = 'sp-swatch'
    ps.style.background = cssOf(PLAIN)
    plain.append(ps, 'Plain land')
    legendList.appendChild(plain)
    // the ramp: plain to the finest views (rank-based: only a tenth of the land is fine)
    const ramp = document.createElement('div')
    ramp.className = 'tp-ramp-row'
    const bar = document.createElement('span')
    bar.className = 'tp-ramp'
    const stops: string[] = []
    for (const v of [0, 40, 90, 140, 186, 220, 255]) {
      sceneryRgb(v, SceneryBit.Snow, sw, 0)
      stops.push(`${cssOf(sw)} ${((v / 255) * 100).toFixed(0)}%`)
    }
    bar.style.background = `linear-gradient(to right, ${stops.join(', ')})`
    ramp.append(document.createTextNode('plain'), bar, document.createTextNode('finest'))
    const note = document.createElement('div')
    note.className = 'tp-legend-note'
    note.textContent = 'By rank: only a tenth of the land counts as fine'
    legend.append(legendTitle, legendList, ramp, note)
  }

  // ---------- inspector section ----------
  const slot = deps.inspectorSlot
  slot.classList.add('hidden')

  // ---------- state ----------
  const params = new URLSearchParams(window.location.search)
  let world: World | null = null
  let data: TourismData | null = null
  let layer: TourismLayer | null = null
  let toggle: HTMLInputElement | null = null
  const prefs = loadLayerPrefs()
  let layerOn = params.has('travel') ? params.get('travel') !== '0' : (prefs['travel'] ?? true)
  if (!layerOn && !params.has('travel')) deps.setUrlParam('travel', '0')
  let viewMode: ViewMode = ViewMode.Terrain
  let knownMask: Float32Array | null = null
  let inspected = -1
  let year = 0
  let shownPaneKey = ''
  let shownInspKey = ''
  let shownCount = ''
  let shownSceneryKey = ''
  let sceneryRgbData: Uint8Array | null = null
  /** Living settlements per cell (for the hover readout), rebuilt per history. */
  let atCell = new Map<number, number[]>()
  let tickedQ = -1
  /** The camera of the last frame (for the perf=1 helpers only). */
  let lastCamera: THREE.Camera | null = null
  let tickedYear = NaN
  let dirty = true
  const force = () => {
    shownPaneKey = shownInspKey = shownCount = ''
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
  const num = (v: number) => formatPopulation(v < 10 ? Math.round(v) : v)

  function syncLayer() {
    layer?.setShown(layerOn)
    requestRender()
  }

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const tb = t.closest('[data-tab]') as HTMLElement | null
    if (tb) {
      tab = Number(tb.dataset.tab)
      savePref('worldseed.travel.tab', String(tab))
      syncTabs()
      force()
      return
    }
    const sl = t.closest('[data-sid]') as HTMLElement | null
    if (sl) {
      deps.onSelectSettlement(Number(sl.dataset.sid))
      return
    }
    const sc = t.closest('[data-cell]') as HTMLElement | null
    if (sc) deps.flyToCell(Number(sc.dataset.cell))
  })

  /** The living settlement to select for a sight at the year (its host or its own), or -1. */
  function sightTarget(k: number): number {
    if (!data) return -1
    const H = data.history
    const alive = (id: number) => id >= 0 && id < data!.N && H.settlements[id].foundedYear <= year && (H.settlements[id].abandonedYear < 0 || H.settlements[id].abandonedYear > year)
    const host = data.sightHost[k]
    if (alive(host)) return host
    const own = data.sights[k].settlement
    return alive(own) ? own : -1
  }

  // ---------- panel content ----------
  function updateCount() {
    if (!data) return
    const q = snapAt(data, year)
    const w = worldVisitors(data, q)
    let c = ''
    if (w.places > 0) c = `${w.places} ${w.places === 1 ? 'place' : 'places'} · ${num(w.visitors)} a year`
    else if (data.firstTravel >= 0 && data.firstTravel > year) c = `none yet`
    else c = data.firstTravel >= 0 ? 'none now' : data.sights.length ? `${sightsBy(data, year).length} sights` : 'none'
    if (c !== shownCount) {
      shownCount = c
      count.textContent = c
      count.classList.toggle('tp-hot', w.places > 0)
    }
  }

  function row(...cells: (string | Node)[]) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'gp-row'
    b.append(...cells)
    return b
  }
  const dot = (color: string, cls = 'gp-dot') => {
    const s = document.createElement('span')
    s.className = cls
    s.style.background = color
    return s
  }

  /** A tiny sparkline of a destination's visitors over the run, drawn up to the snapshot q (the part after it faint). */
  function sparkline(dd: TourismData, id: number, q: number): HTMLCanvasElement {
    const c = document.createElement('canvas')
    const w = 56, hgt = 14
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = w * dpr
    c.height = hgt * dpr
    c.style.width = `${w}px`
    c.style.height = `${hgt}px`
    c.className = 'tp-spark'
    const d = dd.destOf[id]
    const ctx = c.getContext('2d')
    if (!ctx || d < 0) return c
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const Q = dd.Q
    const peak = Math.max(1, dd.peakVis[d])
    const r = dd.resortOf.get(id)
    // from its first visitors (or founding) to the end of the run
    let q0 = 0
    while (q0 < Q - 1 && dd.destVis[d * Q + q0] <= 0 && !(r && q0 * dd.interval >= r.founded)) q0++
    q0 = Math.max(0, q0 - 1)
    const span = Math.max(1, Q - 1 - q0)
    const X = (k: number) => ((k - q0) / span) * (w - 1)
    const Y = (v: number) => hgt - 1 - (Math.sqrt(v / peak) * (hgt - 2))
    for (const pass of [0, 1]) {
      const hi = pass === 0 ? Q - 1 : Math.min(Q - 1, q)
      ctx.beginPath()
      ctx.moveTo(X(q0), hgt - 1)
      for (let k = q0; k <= hi; k++) ctx.lineTo(X(k), Y(dd.destVis[d * Q + k]))
      ctx.lineTo(X(hi), hgt - 1)
      ctx.closePath()
      ctx.fillStyle = pass === 0 ? 'rgba(255, 255, 255, 0.09)' : 'rgba(255, 128, 189, 0.75)'
      ctx.fill()
    }
    if (r && r.abandoned >= 0 && r.abandoned / dd.interval <= q) {
      ctx.fillStyle = 'rgba(200, 200, 210, 0.7)'
      ctx.fillRect(Math.round(X(r.abandoned / dd.interval)), 1, 1, hgt - 2)
    }
    return c
  }

  function updatePane() {
    if (!data || collapsed) return
    const dd = data
    const q = snapAt(dd, year)
    const yi = Math.floor(year + 1e-6)
    const nSights = sightsBy(dd, year).length
    let nRes = 0
    for (const r of dd.resorts) if (r.founded <= year) nRes++
    // (lists follow the trade snapshot; the resorts' states and the sights follow their events)
    const key = `${tab}:${q}:${nSights}:${nRes}:${tab === 1 ? dd.resorts.map((r) => resortState(dd, r.id, year) + (inFashion(dd, r.id, year) ? 1 : 0)).join('') : ''}`
    if (key === shownPaneKey) return
    shownPaneKey = key
    pane.replaceChildren()
    if (tab === 0) {
      const list = placesAt(dd, q)
      if (!list.length) {
        pane.append(note(dd.firstTravel < 0 ? 'No one travels for pleasure in this history.' : dd.firstTravel > yi ? `No one travels for pleasure yet (the first in ${dd.firstTravel}).` : 'No one travels for pleasure now.'))
        return
      }
      const shown = list.slice(0, 30)
      for (const [id, v] of shown) {
        const src = sourcesAt(dd, id, q, 2)
        const resort = resortState(dd, id, year) === 'alive'
        const sub = src.length ? `from ${src.map(([s]) => sname(s)).join(', ')}` : ''
        const r = row(dot(resort ? TRAVEL_CSS : 'rgba(255, 196, 224, 0.55)', resort ? 'gp-dot tp-resort-dot' : 'gp-dot'), span('gp-name', sname(id)), span('gp-sub', sub), span('gp-num', num(v), 'Visitors a year'))
        r.dataset.sid = String(id)
        if (inFashion(dd, id, year)) r.classList.add('tp-fashion')
        r.title = `${sname(id)}: ${Math.round(v)} visitors a year` + (src.length ? `, most from ${src.map(([s, x]) => `${sname(s)} (${Math.round(x)})`).join(', ')}` : '') + (resort ? '; a resort town' : '') + (inFashion(dd, id, year) ? '; in fashion' : '')
        pane.append(r)
      }
      if (list.length > shown.length) pane.append(el('div', 'gp-line gp-faint', `and ${list.length - shown.length} more`))
      const w = worldVisitors(dd, q)
      pane.append(el('div', 'gp-line gp-faint', `${formatPopulation(w.visitors)} visitors a year in all, spending as they go`))
      return
    }
    if (tab === 1) {
      const list = dd.resorts.filter((r) => r.founded <= year)
      if (!list.length) {
        pane.append(note(dd.resorts.length ? 'No resort town yet.' : 'No resort town in this history.'))
        return
      }
      for (const r of list) {
        const st = resortState(dd, r.id, year)
        const fash = inFashion(dd, r.id, year)
        const dec = lastDecline(dd, r.id, year)
        const sub = st === 'abandoned' ? `${r.founded}–${r.abandoned}, given up` : fash ? `${r.founded} · in fashion` : dec ? `${r.founded} · out: ${causeShort(dec[1])}` : `founded ${r.founded}`
        const b = row(dot(st === 'abandoned' ? 'rgba(170, 170, 180, 0.6)' : fash ? TRAVEL_CSS : 'rgba(255, 150, 200, 0.6)', 'gp-dot tp-resort-dot'), span('gp-name', sname(r.id)), span('gp-sub', sub), sparkline(dd, r.id, q), span('gp-num', num(visitorsAt(dd, r.id, q * dd.interval)), 'Visitors a year'))
        b.classList.add('tp-resort-row')
        if (st === 'abandoned') b.classList.add('ended')
        b.dataset.sid = String(r.id)
        b.title = `${sname(r.id)}: a resort founded in ${r.founded}` + (r.from >= 0 ? ` for visitors from ${sname(r.from)}` : '') + (st === 'abandoned' ? `, given up in ${r.abandoned}` : '') + (dec ? `; last out of fashion in ${dec[0]} (${causeWords(dec[1])})` : '')
        pane.append(b)
      }
      return
    }
    const ks = sightsBy(dd, year)
    if (!ks.length) {
      pane.append(note(dd.sights.length ? `No sight yet (the first in ${dd.sights[0].fromYear}).` : 'No sights in this history.'))
      return
    }
    // the most famous first
    const order = [...ks].sort((a, b) => dd.sights[b].fame - dd.sights[a].fame || dd.sights[a].fromYear - dd.sights[b].fromYear)
    for (const k of order) {
      const x = dd.sights[k]
      const g = span('tp-glyph', SIGHT_GLYPH[x.kind] ?? '•')
      g.style.color = SIGHT_CSS[x.kind] ?? '#fff'
      const target = sightTarget(k)
      const b = row(g, span('gp-name', x.name || SIGHT_SHORT[x.kind] || 'Sight'), span('gp-sub', `${SIGHT_SHORT[x.kind] ?? ''} · ${fameWords(x.fame)}`), span('gp-num', String(x.fromYear), 'A sight since'))
      if (target >= 0) b.dataset.sid = String(target)
      else b.dataset.cell = String(x.cell)
      b.title = `${cap(sightPhrase(x))}: ${fameWords(x.fame)}, a sight since ${x.fromYear}` + (target >= 0 && target !== x.settlement ? `; its visitors stay at ${sname(target)}` : '')
      pane.append(b)
    }
  }

  // ---------- inspector ----------
  /** The best scenery at a cell or one hop away (the view from the place), and its cell. */
  function viewOf(cell: number): number {
    if (!data?.scenery || !world) return cell
    const sc = data.scenery
    const { neighborOffsets: off, neighbors: nb } = world.grid
    let best = cell
    for (let k = off[cell]; k < off[cell + 1]; k++) if (sc[nb[k]] > sc[best]) best = nb[k]
    return best
  }

  function inspectorLines(dd: TourismData, id: number): (string | Node)[][] {
    const H = dd.history
    const out: (string | Node)[][] = []
    const s = H.settlements[id]
    const q = snapAt(dd, year)
    const r = dd.resortOf.get(id)
    if (r && year >= r.founded) {
      const l: (string | Node)[] = [`A resort town, founded in ${r.founded}`]
      if (r.from >= 0) l.push(' for visitors from ', settLink(r.from))
      const st = resortState(dd, id, year)
      if (st === 'abandoned') l.push(`; given up in ${r.abandoned}`)
      out.push(l)
    }
    const v = visitorsAt(dd, id, year)
    if (v >= 0.5) {
      const sp = spendAt(dd, id, year)
      out.push([`Visitors: ${Math.round(v)} a year` + (sp > 0.05 ? `, spending ${formatPopulation(sp)} a year` : '') + (inFashion(dd, id, year) ? ' (in fashion)' : '')])
      const src = sourcesAt(dd, id, q, 3)
      if (src.length) {
        const l: (string | Node)[] = ['Most come from ']
        src.forEach(([sid, x], i) => {
          if (i) l.push(i === src.length - 1 ? ' and ' : ', ')
          l.push(settLink(sid), ` (${Math.round(x)})`)
        })
        out.push(l)
      }
    } else if (dd.destOf[id] >= 0 && year >= H.settlements[id].foundedYear) {
      // visited once: its best years and where they came from
      const d = dd.destOf[id]
      if (dd.peakQ[d] * dd.interval <= year && dd.peakVis[d] >= 1) {
        const src = sourcesUpTo(dd, id, q, 1)
        const l: (string | Node)[] = [`Visited once: up to ${Math.round(dd.peakVis[d])} a year in ${dd.peakQ[d] * dd.interval}`]
        if (src.length) l.push(', most from ', settLink(src[0][0]))
        out.push(l)
      }
    }
    if (r || dd.fashion.has(id)) {
      const dec = lastDecline(dd, id, year)
      if (!inFashion(dd, id, year) && dec && resortState(dd, id, year) !== 'abandoned') out.push([`Out of fashion since ${dec[0]}: ${causeWords(dec[1])}`])
    }
    for (const k of dd.sightsOf.get(id) ?? []) {
      const x = dd.sights[k]
      if (x.fromYear > year) continue
      const near = x.settlement !== id
      out.push([`${near ? 'Near it: ' : 'A sight: '}${sightPhrase(x)}, ${fameWords(x.fame)}, since ${x.fromYear}`])
    }
    if (dd.isHome[id]) {
      const trips = tripsFrom(dd, id, q, 3)
      if (trips.length) {
        const l: (string | Node)[] = ['Its people travel to ']
        trips.forEach(([t, x], i) => {
          if (i) l.push(i === trips.length - 1 ? ' and ' : ', ')
          l.push(settLink(t), ` (${Math.round(x)})`)
        })
        out.push(l)
      }
    }
    if (dd.scenery) {
      const c = viewOf(s.cell)
      const g = sceneryGrade(dd.scenery[c])
      if (g && (out.length || dd.scenery[c] >= 186)) {
        const w = dd.sceneryKind ? sceneryWords(dd.sceneryKind[c]) : ''
        out.push([`The view: ${w || g}` + (w ? ` (${g})` : '')])
      }
    }
    return out
  }

  function updateInspector() {
    if (!data || inspected < 0) return
    const dd = data
    const id = inspected
    const q = snapAt(dd, year)
    const ns = (dd.sightsOf.get(id) ?? []).filter((k) => dd.sights[k].fromYear <= year).length
    const dec = lastDecline(dd, id, year)
    const key = `${id}:${q}:${resortState(dd, id, year)}:${inFashion(dd, id, year)}:${ns}:${dec ? dec[0] : -1}:${Math.round(visitorsAt(dd, id, year))}:${year >= dd.history.settlements[id].foundedYear}`
    if (key === shownInspKey) return
    shownInspKey = key
    slot.replaceChildren()
    const s = dd.history.settlements[id]
    if (!s || year < s.foundedYear) {
      slot.classList.add('hidden')
      return
    }
    const lines = inspectorLines(dd, id)
    lines.forEach((parts, k) => {
      const d = document.createElement('div')
      if (k === 0 && resortState(dd, id, year) === 'alive') d.className = 'tp-hot'
      for (const p of parts) {
        if (p instanceof HTMLElement && p.classList.contains('gp-link')) p.className = 'insp-link'
        d.append(p)
      }
      slot.append(d)
    })
    slot.classList.toggle('hidden', lines.length === 0)
  }

  // ---------- the Scenery view ----------
  const sceneryShown = () => viewMode === ViewMode.Scenery
  const syncLegend = () => legend.classList.toggle('hidden', !sceneryShown() || !data?.scenery)
  function updateScenery() {
    const globe = deps.getGlobe()
    if (!sceneryShown() || !data?.scenery || !world || !globe) return
    const key = `${world.grid.cellCount}`
    if (key === shownSceneryKey) return
    shownSceneryKey = key
    const n = world.grid.cellCount
    if (!sceneryRgbData || sceneryRgbData.length !== n * 3) sceneryRgbData = new Uint8Array(n * 3)
    const lake = (world as Partial<World>).lake
    const sc = data.scenery
    const bits = data.sceneryKind
    for (let c = 0; c < n; c++) {
      if (world.elevation[c] < 0 || lake?.[c] === 1) {
        sceneryRgbData[c * 3] = WATER[0]
        sceneryRgbData[c * 3 + 1] = WATER[1]
        sceneryRgbData[c * 3 + 2] = WATER[2]
      } else sceneryRgb(sc[c], bits ? bits[c] : 0, sceneryRgbData, c * 3)
    }
    globe.setSceneryColors(sceneryRgbData)
  }

  addShortcut({ keys: ['t', 'T'], label: 'T', description: 'Show or hide leisure travel (places visited, resorts, sights)', group: 'Panels', run: () => (data && !root.classList.contains('hidden') ? toggleCollapsed() : false) })

  const api: TourismView = {
    setWorld(w: World) {
      world = w
      shownSceneryKey = ''
      sceneryRgbData = null
    },
    build(w: World, hist: History, maxPopulation: number) {
      const td = tourismOf(hist)
      if (!td) return null
      return { data: td, layer: buildTourismLayer(w, hist, td, maxPopulation) }
    },
    disposeBuilt(b) {
      if (!b) return
      deps.planetGroup.remove(b.layer.object)
      b.layer.dispose()
    },
    commit(b: TourismBuilt | null, extend: boolean) {
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
        layer.setSelected(inspected)
      }
      // the panel and the toggle once anything travels (or a sight or resort exists); the Scenery view with the scenery
      const any = !!data && (data.F.count > 0 || data.sights.length > 0 || data.resorts.length > 0)
      root.classList.toggle('hidden', !any)
      deps.setViewModeAvailable?.(ViewMode.Scenery, !!data?.scenery)
      if (any && !toggle && deps.addLayerToggle) {
        toggle = deps.addLayerToggle({
          key: 'travel',
          label: 'Travel',
          group: 'movement',
          checked: layerOn,
          title: 'Leisure travel: travellers on their way, places visited, resort towns and sights',
          onChange: (on) => {
            layerOn = on
            deps.setUrlParam('travel', on ? null : '0')
            syncLayer()
          },
        })
      }
      toggle?.closest('label')?.classList.toggle('hidden', !any)
      syncLegend()
      shownSceneryKey = ''
      tickedQ = -1
      void extend
      syncLayer()
      force()
    },
    setViewMode(mode: ViewMode) {
      viewMode = mode
      syncLegend()
      shownSceneryKey = ''
      dirty = true
      requestRender()
    },
    showSettlement(id: number) {
      inspected = id
      shownInspKey = ''
      dirty = true
      layer?.setSelected(id)
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
    setYield(near: number, far: number) {
      layer?.setYield(near, far)
    },
    tick(y, effect, camera, drawSize, pixelRatio) {
      year = y
      lastCamera = camera
      if (!data) return
      if (layer) {
        layer.setTime(y, effect)
        layer.update(camera, drawSize, pixelRatio)
      }
      // the panels change with the whole year (events) and the trade snapshot: nothing to look at in between
      const yi = Math.floor(y + 1e-6)
      const q = snapAt(data, y)
      if (yi === tickedYear && q === tickedQ && !dirty) return
      tickedYear = yi
      tickedQ = q
      dirty = false
      updateCount()
      updatePane()
      updateInspector()
      updateScenery()
    },
    describeCell(cell: number) {
      if (!data) return ''
      const dd = data
      const parts: string[] = []
      for (const k of dd.sightsAt.get(cell) ?? []) {
        const x = dd.sights[k]
        if (x.fromYear <= year) parts.push(`Sight: ${sightPhrase(x)} (${fameWords(x.fame)})`)
      }
      for (const id of atCell.get(cell) ?? []) {
        const st = resortState(dd, id, year)
        const v = visitorsAt(dd, id, year)
        if (st === 'abandoned') parts.push('A resort, given up')
        else if (v >= 0.5) parts.push(`${st === 'alive' ? 'Resort town, ' : ''}${Math.round(v)} visitors a year${inFashion(dd, id, year) ? ', in fashion' : ''}`)
        else if (st === 'alive') parts.push('A resort town, quiet now')
      }
      if (sceneryShown() && dd.scenery) {
        const c = cell
        const g = sceneryGrade(dd.scenery[c])
        const w = dd.sceneryKind ? sceneryWords(dd.sceneryKind[c]) : ''
        if (world && (world.elevation[c] < 0 || (world as Partial<World>).lake?.[c] === 1)) {
          // (water has no scenery of its own)
        } else if (g) parts.push(w ? `${cap(g)}: ${w}` : cap(g))
        else parts.push(w ? `Plain land (${w})` : 'Plain land')
      }
      return parts.join(' · ')
    },
  }
  deps.setViewModeAvailable?.(ViewMode.Scenery, false)
  if (params.get('perf') === '1') {
    // debugging and measurement: the data, the layer's state; and where a settlement is (camera az / lat in degrees)
    ;(window as unknown as { __worldseedTourism: unknown }).__worldseedTourism = {
      data: () => data,
      active: () => layer?.active ?? false,
      pairs: () => layer?.pairsDrawn ?? 0,
      where: (id: number) => {
        if (!world || !data || id < 0 || id >= data.N) return null
        const c = data.history.settlements[id].cell
        const P = world.grid.positions
        return { az: (Math.atan2(P[c * 3], P[c * 3 + 2]) * 180) / Math.PI, lat: (Math.asin(Math.max(-1, Math.min(1, P[c * 3 + 1]))) * 180) / Math.PI }
      },
      /** CSS pixel of settlement id's place on screen (as the last frame drew it), or null. */
      screen: (id: number) => {
        if (!world || !data || !lastCamera || id < 0 || id >= data.N) return null
        const c = data.history.settlements[id].cell
        const P = world.grid.positions
        deps.planetGroup.updateWorldMatrix(true, false)
        const v = new THREE.Vector3(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]).multiplyScalar(1.004).applyMatrix4(deps.planetGroup.matrixWorld).project(lastCamera)
        return [((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight]
      },
      /** Show every sight with the glyph of kind (index mod 7), to look at all seven (Holy cities come with the religion system). */
      cycleSightKinds: () => {
        const marks = layer?.object.children.find((o) => o.name === 'tourism marks') as THREE.Mesh | undefined
        const a = marks?.geometry.getAttribute('aA') as THREE.InstancedBufferAttribute | undefined
        if (!a || !data) return false
        for (let k = 0; k < data.sights.length; k++) a.setZ(k, k % 7)
        a.needsUpdate = true
        requestRender()
        return true
      },
      /** The instance attributes of mark k (sights first, then destinations). */
      mark: (k: number) => {
        const marks = layer?.object.children.find((o) => o.name === 'tourism marks') as THREE.Mesh | undefined
        if (!marks) return null
        const g = marks.geometry
        const at = (n: string) => Array.from((g.getAttribute(n) as THREE.InstancedBufferAttribute).array.slice(k * g.getAttribute(n).itemSize, (k + 1) * g.getAttribute(n).itemSize))
        return { aPos: at('aPos'), aA: at('aA'), aB: at('aB'), aC: at('aC'), aKnown: at('aKnown') }
      },
      expand: (t = 0) => {
        tab = t
        if (collapsed) toggleCollapsed()
        syncTabs()
        force()
      },
    }
  }
  return api
}
