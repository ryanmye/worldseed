// Faiths in the UI: the "Faiths" panel (right column, collapsed by default: the universal faiths
// founded by the year with their founding year, holy city and a sparkline of their share of the
// world's people; a selected faith's founder people, holy city, share over time, the states that hold
// it as their state religion, its schisms and holy wars), the Faiths view (the land of each settlement
// coloured by its majority faith, with a legend), the holy cities on the map (render/faiths.ts), the
// inspector's faith lines and the hover readout's faith.
//
// Selection: a faith (faith=<id>): its holy city flies into view, its mark is drawn on every view,
// and on the Faiths view the other faiths' land is dimmed. Everything is a function of the year; DOM
// writes happen only when what is shown changes (per snapshot, per whole year for the detail), and
// the view's colours are rewritten only when its snapshot, land snapshot or selection changes.
// Without faith data the panel, the view and the readout lines are absent.

import * as THREE from 'three'
import { EventType, FaithKind, type History, type World } from '../contract.ts'
import { buildFaithLayer, type FaithLayer } from '../render/faiths.ts'
import { ViewMode } from '../render/palette.ts'
import type { GlobeMesh } from '../render/globe.ts'
import { requestRender } from '../render/invalidate.ts'
import { formatInt, peopleName, settlementName } from './format.ts'
import { namesEpoch } from './renamingData.ts'
import { faithAt, faithLives, faithName, faithShareAt, faithSnap, faithsOf, stateFaithAt, type FaithsData } from './faithsData.ts'
import { capitalAt, politiesOf, polityAtYear, polityLives, type PolitiesData } from './politiesData.ts'
import { warOutcomeWords } from './polityFormat.ts'
import { loadFlag, saveFlag } from './panels.ts'
import { addShortcut } from './shortcuts.ts'
import './faiths.css'

export interface FaithsBuilt {
  data: FaithsData
  layer: FaithLayer
}

export interface FaithsViewDeps {
  right: HTMLElement
  /** Inspector slot shared with the seat line (rulersPanel.ts). */
  inspectorSlot: HTMLElement
  planetGroup: THREE.Group
  getGlobe(): GlobeMesh | null
  setUrlParam(name: string, value: string | null): void
  onSelectSettlement(id: number): void
  onSelectPolity(p: number): void
  flyToCell(cell: number): void
  setViewModeAvailable?(mode: ViewMode, available: boolean): void
}

export interface FaithsView {
  setWorld(world: World): void
  build(world: World, h: History): FaithsBuilt | null
  disposeBuilt(b: FaithsBuilt | null | undefined): void
  commit(b: FaithsBuilt | null, extend: boolean): void
  setViewMode(mode: ViewMode): void
  showSettlement(id: number): void
  setKnownMask(cellYear: Float32Array | null): void
  setMasked(on: boolean): void
  /** Per frame; `coarse`: playing fast (the Faiths view then recolours every fifth snapshot, about 2 ms each). */
  tick(year: number, coarse: boolean, camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number): void
  /** The faith of the land at a cell on the Faiths view, a holy city there; '' for none. */
  describeCell(cell: number): string
}

/** Land of no settlement, and water, on the Faiths view (sRGB 0..255). */
const UNCLAIMED = [52, 55, 54] as const
const pct = (f: number) => (f > 0 && f < 0.005 ? '<1%' : `${Math.round(f * 100)}%`)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "zealous, well organised, a faith of the towns". */
function traitWords(z: number, o: number, a: number): string {
  const w: string[] = []
  w.push(z >= 0.7 ? 'zealous' : z >= 0.4 ? 'missionary' : 'quiet')
  w.push(o >= 0.66 ? 'with a strong church' : o >= 0.33 ? 'loosely organised' : 'with no church to speak of')
  w.push(a >= 0.66 ? 'a faith of the towns' : a <= 0.33 ? 'a faith of the countryside' : 'of town and country alike')
  return w.join(', ')
}

export function createFaithsView(deps: FaithsViewDeps): FaithsView {
  // ---------- panel ----------
  const root = document.createElement('div')
  root.className = 'panel faiths hidden'
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'gp-head'
  head.title = 'Show or hide the faiths (F)'
  const title = document.createElement('span')
  title.className = 'gp-title'
  title.textContent = 'Faiths'
  const count = document.createElement('span')
  count.className = 'gp-count'
  const caret = document.createElement('span')
  caret.className = 'caret'
  caret.setAttribute('aria-hidden', 'true')
  head.append(title, count, caret)
  const body = document.createElement('div')
  body.className = 'gp-body'
  body.id = 'faiths-body'
  head.setAttribute('aria-controls', body.id)
  const detail = document.createElement('div')
  detail.className = 'gp-detail hidden'
  const pane = document.createElement('div')
  pane.className = 'gp-pane'
  body.append(detail, pane)
  root.append(head, body)
  deps.right.insertBefore(root, deps.right.querySelector('.chronicle'))

  let collapsed = loadFlag('worldseed.faiths.collapsed', true)
  const syncCollapsed = () => {
    root.classList.toggle('collapsed', collapsed)
    head.setAttribute('aria-expanded', String(!collapsed))
  }
  syncCollapsed()
  const toggleCollapsed = () => {
    collapsed = !collapsed
    saveFlag('worldseed.faiths.collapsed', collapsed)
    syncCollapsed()
    force()
  }
  head.addEventListener('click', toggleCollapsed)

  // ---------- legend of the Faiths view (under the map panel) ----------
  const legend = document.createElement('div')
  legend.className = 'panel sp-legend fa-legend hidden'
  {
    const mapPanel = deps.right.querySelector('.map-panel')
    deps.right.insertBefore(legend, mapPanel ? mapPanel.nextSibling : deps.right.firstChild)
  }
  const legendTitle = document.createElement('div')
  legendTitle.className = 'sp-legend-title'
  legendTitle.textContent = 'Faiths: what most people of each place follow'
  const legendList = document.createElement('div')
  legendList.className = 'sp-legend-list'
  legend.append(legendTitle, legendList)

  // ---------- inspector lines (in the slot shared with the seat line) ----------
  const insp = document.createElement('div')
  insp.className = 'ifa-lines hidden'
  deps.inspectorSlot.append(insp)

  // ---------- state ----------
  const params = new URLSearchParams(window.location.search)
  let pending: number | null = (() => {
    const v = params.get('faith')
    const x = v === null ? NaN : Number.parseInt(v, 10)
    return Number.isFinite(x) ? x : null
  })()
  let world: World | null = null
  let data: FaithsData | null = null
  let pd: PolitiesData | null = null
  let layer: FaithLayer | null = null
  let viewMode: ViewMode = ViewMode.Terrain
  let knownMask: Float32Array | null = null
  let sel = -1
  let inspected = -1
  let year = 0
  let tickedYear = NaN
  let dirty = true
  let shownPaneKey = ''
  let shownDetailKey = ''
  let shownInspKey = ''
  let shownCount = ''
  let shownLegendKey = ''
  let shownViewKey = ''
  /** renaming: the names in force last shown (renamingData.ts namesEpoch): its lines name towns as at the year. */
  let shownNames = -1
  let viewRgb: Uint8Array | null = null
  /** Playing fast: the view's snapshot steps by five (it is exact again once paused). */
  let coarseShown = false
  /** Settlements per cell (the readout's holy cities and owners). */
  let atCell = new Map<number, number[]>()
  const force = () => {
    shownPaneKey = shownDetailKey = shownInspKey = shownCount = shownLegendKey = ''
    dirty = true
    requestRender()
  }

  const sname = (id: number) => (data ? settlementName(data.history, id) : '')
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
  const dot = (f: number) => {
    const s = document.createElement('span')
    s.className = 'gp-dot'
    if (data && f >= 0) s.style.background = data.css[f]
    return s
  }
  const settLink = (id: number) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'gp-link'
    b.dataset.sid = String(id)
    b.textContent = sname(id)
    return b
  }
  const polityLink = (q: number) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'gp-link'
    b.dataset.polity = String(q)
    b.textContent = pd ? pd.names[q] : ''
    return b
  }
  const faithLink = (f: number) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'gp-link'
    b.dataset.faith = String(f)
    b.append(dot(f), ` ${data?.faiths[f]?.name ?? ''}`)
    return b
  }

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const sl = t.closest('[data-sid]') as HTMLElement | null
    if (sl) {
      deps.onSelectSettlement(Number(sl.dataset.sid))
      return
    }
    const pl = t.closest('[data-polity]') as HTMLElement | null
    if (pl) {
      deps.onSelectPolity(Number(pl.dataset.polity))
      return
    }
    const fl = t.closest('[data-faith]') as HTMLElement | null
    if (fl) {
      const f = Number(fl.dataset.faith)
      if (fl.classList.contains('gp-row') && f === sel) select(-1, false)
      else select(f, true)
      return
    }
    if (t.closest('.gp-close')) select(-1, false)
  })
  legend.addEventListener('click', (e) => {
    const fl = (e.target as HTMLElement).closest('[data-faith]') as HTMLElement | null
    if (!fl) return
    const f = Number(fl.dataset.faith)
    select(f === sel ? -1 : f, f !== sel)
  })

  function select(f: number, fly: boolean) {
    if (!data || !(f >= 0 && f < data.F) || data.faiths[f].kind !== FaithKind.Universal) f = -1
    sel = f
    deps.setUrlParam('faith', f >= 0 ? String(f) : null)
    layer?.setShown(viewMode === ViewMode.Faiths, sel)
    shownViewKey = ''
    if (fly && f >= 0 && data) {
      const c = data.faiths[f].holyCity
      if (c >= 0 && c < data.N) deps.flyToCell(data.history.settlements[c].cell)
    }
    force()
  }

  /** A sparkline of faith f's share of the world's people, over the whole run's width, drawn up to snapshot s. */
  function spark(f: number, s: number, w: number, hgt: number, max: number): HTMLCanvasElement {
    const dd = data!
    const c = document.createElement('canvas')
    c.className = 'fa-spark'
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = w * dpr
    c.height = hgt * dpr
    c.style.width = `${w}px`
    c.style.height = `${hgt}px`
    const ctx = c.getContext('2d')
    if (!ctx) return c
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)'
    ctx.fillRect(0, hgt - 1, w, 1)
    const S = dd.S
    const x = (k: number) => (k / Math.max(1, S - 1)) * w
    const y = (v: number) => hgt - 1 - (v / Math.max(1e-6, max)) * (hgt - 2)
    const from = Math.max(0, faithSnap(dd, dd.faiths[f].foundedYear))
    if (s < from) return c
    ctx.beginPath()
    ctx.moveTo(x(from), hgt)
    for (let k = from; k <= s; k++) ctx.lineTo(x(k), y(dd.worldShare[k * dd.F + f]))
    ctx.lineTo(x(s), hgt)
    ctx.closePath()
    ctx.globalAlpha = 0.35
    ctx.fillStyle = dd.css[f]
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.beginPath()
    for (let k = from; k <= s; k++) {
      if (k === from) ctx.moveTo(x(k), y(dd.worldShare[k * dd.F + f]))
      else ctx.lineTo(x(k), y(dd.worldShare[k * dd.F + f]))
    }
    ctx.strokeStyle = dd.css[f]
    ctx.lineWidth = 1.2
    ctx.stroke()
    return c
  }

  // ---------- panel content ----------
  /** Universal faiths founded by the year (living first, by share), the dead after. */
  function listed(s: number): number[] {
    const dd = data!
    const out = dd.universal.filter((f) => dd.faiths[f].foundedYear <= year)
    const sh = (f: number) => dd.worldShare[s * dd.F + f]
    out.sort((a, b) => (faithLives(dd, b, year) ? 1 : 0) - (faithLives(dd, a, year) ? 1 : 0) || sh(b) - sh(a) || a - b)
    return out
  }

  function updateCount(s: number) {
    const dd = data!
    let n = 0, top = -1
    for (const f of dd.universal) if (faithLives(dd, f, year)) {
      n++
      if (top < 0 || dd.worldShare[s * dd.F + f] > dd.worldShare[s * dd.F + top]) top = f
    }
    const c = n === 0 ? 'folk practice only' : `${n} ${n === 1 ? 'faith' : 'faiths'}` + (top >= 0 ? ` · ${dd.faiths[top].name} ${pct(dd.worldShare[s * dd.F + top])}` : '')
    if (c !== shownCount) {
      shownCount = c
      count.textContent = c
    }
  }

  function updatePane(s: number) {
    if (!data || collapsed) return
    const dd = data
    const fs = listed(s)
    const key = `${s}:${sel}:${fs.length}:${fs.filter((f) => faithLives(dd, f, year)).length}`
    if (key === shownPaneKey) return
    shownPaneKey = key
    pane.replaceChildren()
    let max = 0
    for (const f of dd.universal) max = Math.max(max, dd.peakShare[f])
    if (!fs.length) {
      const first = dd.universal.length ? Math.min(...dd.universal.map((f) => dd.faiths[f].foundedYear)) : -1
      pane.append(el('div', 'gp-note', first >= 0 ? `Each people keeps its own folk practice; no universal faith yet (the first is founded in ${first}).` : 'Each people keeps its own folk practice: no universal faith arises in this history.'))
    }
    for (const f of fs) {
      const x = dd.faiths[f]
      const alive = faithLives(dd, f, year)
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'gp-row fa-row' + (f === sel ? ' selected' : '') + (alive ? '' : ' ended')
      b.dataset.faith = String(f)
      const sub = x.parent >= 0 ? `${x.foundedYear} · split from ${dd.faiths[x.parent]?.name ?? ''}` : `${x.foundedYear} · ${x.holyCity >= 0 ? sname(x.holyCity) : ''}`
      b.append(dot(f), span('gp-name', x.name), span('gp-sub', sub), spark(f, s, 44, 14, max), span('gp-num', alive ? pct(dd.worldShare[s * dd.F + f]) : `died ${x.endedYear}`, alive ? "Share of the world's people (where it is the majority faith)" : ''))
      b.title = `${cap(faithName(dd, f))}: founded ${x.foundedYear}${x.holyCity >= 0 ? ` at ${sname(x.holyCity)}` : ''}${x.parent >= 0 ? `, a schism of ${dd.faiths[x.parent]?.name}` : ''}. Click to select and go to its holy city.`
      pane.append(b)
    }
    // the folk practice that remains
    let folk = 0
    for (let f = 0; f < dd.F; f++) if (dd.faiths[f].kind !== FaithKind.Universal) folk += dd.worldShare[s * dd.F + f]
    if (fs.length) pane.append(el('div', 'gp-line gp-faint', `Folk practice of the peoples: ${pct(folk)} of the world's people`))
  }

  function updateDetail(s: number) {
    if (!data || collapsed || sel < 0) {
      if (!detail.classList.contains('hidden')) detail.classList.add('hidden')
      shownDetailKey = ''
      return
    }
    const dd = data
    const h = dd.history
    const f = sel
    const x = dd.faiths[f]
    const evN = dd.eventsOf[f].filter((i) => h.events[i].year <= year).length
    const key = `${f}:${s}:${evN}`
    if (key === shownDetailKey) return
    shownDetailKey = key
    detail.classList.remove('hidden')
    detail.replaceChildren()
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'gp-close'
    close.title = 'Deselect (Esc)'
    close.textContent = '×'
    detail.append(el('div', 'gp-d-title', dot(f), cap(faithName(dd, f)), close))
    const line = (...parts: (string | Node)[]) => {
      const d = el('div', 'gp-line', ...parts)
      detail.append(d)
      return d
    }
    if (year < x.foundedYear) {
      line(`(not yet: it is founded in ${x.foundedYear})`).classList.add('gp-faint')
      return
    }
    const people = peopleName(h, x.people)
    if (x.parent >= 0) {
      const l = line('Split from ', faithLink(x.parent), ` in ${x.foundedYear}`)
      if (x.holyCity >= 0) l.append(', its seat at ', settLink(x.holyCity))
      if (people) l.append(`, among the ${people}`)
    } else {
      const l = line(`Founded in ${x.foundedYear}`)
      if (x.foundedAt >= 0) l.append(' at ', settLink(x.foundedAt))
      if (people) l.append(`, among the ${people}`)
    }
    if (x.holyCity >= 0) {
      const fell = dd.eventsOf[f].map((i) => h.events[i]).filter((e) => (e.type as number) === EventType.HolyCityFell && e.value === f && e.year <= year)
      const l = line('Holy city ', settLink(x.holyCity))
      if (fell.length) {
        const e = fell[fell.length - 1]
        const q = pd && e.other >= 0 ? polityAtYear(pd, e.other, e.year) : -1
        l.append(`; it fell in ${e.year}`)
        if (q >= 0) l.append(' to ', polityLink(q))
      }
    }
    line(cap(traitWords(x.zeal, x.organisation, x.appeal))).classList.add('gp-faint')
    // share over time
    const share = dd.worldShare[s * dd.F + f]
    const places = dd.places[s * dd.F + f]
    const shareLine = line(faithLives(dd, f, year) ? `${pct(share)} of the world's people by ${s * dd.interval}; the majority faith of ${formatInt(places)} ${places === 1 ? 'place' : 'places'}` : `Died out in ${x.endedYear}`)
    if (!faithLives(dd, f, year)) shareLine.classList.add('fa-dead')
    detail.append(el('div', 'fa-spark-row', spark(f, s, 220, 26, Math.max(1e-3, dd.peakShare[f]))))
    // states that hold it as their state religion now
    if (pd) {
      const states: number[] = []
      for (const q of dd.statesOf[f]) if (polityLives(pd, q, year) && stateFaithAt(dd, q, s) === f) states.push(q)
      if (states.length) {
        const l = line(states.length === 1 ? 'State religion of ' : `State religion of ${states.length} states: `)
        states.slice(0, 8).forEach((q, i) => {
          if (i) l.append(', ')
          l.append(polityLink(q))
        })
        if (states.length > 8) l.append(` and ${states.length - 8} more`)
      }
    }
    // schisms (and theirs)
    const kids = (g: number) => dd.children[g].filter((c) => dd.faiths[c].foundedYear <= year)
    if (kids(f).length || x.parent >= 0) {
      detail.append(el('div', 'gp-cap', 'Schisms'))
      const tree = el('div', 'fa-tree')
      detail.append(tree)
      // from the root of its family
      let r = f
      while (dd.faiths[r].parent >= 0) r = dd.faiths[r].parent
      const node = (g: number, depth: number) => {
        const y = dd.faiths[g]
        const d = el('div', 'fa-node' + (g === f ? ' self' : '') + (faithLives(dd, g, year) ? '' : ' ended'))
        d.style.paddingLeft = `${depth * 12}px`
        d.append(depth > 0 ? '└ ' : '', g === f ? el('span', '', dot(g), ` ${y.name}`) : faithLink(g), span('fa-years', ` ${y.foundedYear}${y.endedYear >= 0 && y.endedYear <= year ? `–${y.endedYear}` : ''}`))
        tree.append(d)
        for (const c of kids(g)) node(c, depth + 1)
      }
      node(r, 0)
    }
    // holy wars in its name
    const W = h.wars
    const hw = W ? dd.holyWarsOf[f].filter((w) => w >= 0 && w < W.count && W.startYear[w] <= year) : []
    if (W && hw.length) {
      detail.append(el('div', 'gp-cap', `Holy wars (${hw.length})`))
      for (const w of hw.slice(-6).reverse()) {
        const ongoing = W.endYear[w] < 0 || W.endYear[w] > year
        const l = line(ongoing ? `Since ${W.startYear[w]}: ` : `${W.startYear[w]}–${W.endYear[w]}: `, polityLink(W.attacker[w]), ' on ', polityLink(W.defender[w]))
        if (!ongoing && pd) {
          const o = warOutcomeWords(pd, w)
          if (o) l.append(` (${o})`)
        } else l.classList.add('fa-hot')
      }
      if (hw.length > 6) line(`and ${hw.length - 6} earlier`).classList.add('gp-faint')
    }
  }

  // ---------- the Faiths view ----------
  const viewShown = () => viewMode === ViewMode.Faiths
  function updateView(s: number) {
    const globe = deps.getGlobe()
    if (!viewShown() || !data || !world || !globe) return
    const dd = data
    const h = dd.history
    const L = h.landCells?.length ?? 0
    const LQ = h.landSnapshotCount ?? 0
    const T = h.territory
    const hasT = !!T && L > 0 && LQ > 0 && T.length >= L * LQ
    const q = hasT ? Math.max(0, Math.min(LQ - 1, Math.floor(year / Math.max(1, h.landInterval)))) : -1
    const key = `${s}:${q}:${sel}`
    if (key === shownViewKey) return
    shownViewKey = key
    const n = world.grid.cellCount
    if (!viewRgb || viewRgb.length !== n * 3) viewRgb = new Uint8Array(n * 3)
    const out = viewRgb
    for (let c = 0; c < n; c++) {
      out[c * 3] = UNCLAIMED[0]
      out[c * 3 + 1] = UNCLAIMED[1]
      out[c * 3 + 2] = UNCLAIMED[2]
    }
    const N = dd.N
    const paint = (c: number, id: number) => {
      const f = faithAt(dd, id, s)
      if (f < 0) return
      // a slim majority shows paler (toward the unclaimed ground); a faith not selected is dimmed
      let t = 0.5 + 0.5 * Math.min(1, faithShareAt(dd, id, s) * 1.25)
      if (sel >= 0 && f !== sel) t *= 0.35
      out[c * 3] = UNCLAIMED[0] + (dd.rgb[f * 3] * 255 - UNCLAIMED[0]) * t
      out[c * 3 + 1] = UNCLAIMED[1] + (dd.rgb[f * 3 + 1] * 255 - UNCLAIMED[1]) * t
      out[c * 3 + 2] = UNCLAIMED[2] + (dd.rgb[f * 3 + 2] * 255 - UNCLAIMED[2]) * t
    }
    if (hasT) {
      const o = q * L
      for (let k = 0; k < L; k++) {
        const owner = T![o + k] - 1
        if (owner >= 0 && owner < N) paint(h.landCells[k], owner)
      }
    } else {
      // no territory layer: each settlement's cell and its neighbours
      const { neighborOffsets: off, neighbors: nb } = world.grid
      for (let i = 0; i < N; i++) {
        const c = h.settlements[i].cell
        for (let k = off[c]; k < off[c + 1]; k++) paint(nb[k], i)
      }
    }
    for (let i = 0; i < N; i++) if (h.population[s * N + i] > 0) paint(h.settlements[i].cell, i)
    globe.setFaithColors(out)
  }

  function updateLegend(s: number) {
    if (!data) return
    const show = viewShown()
    legend.classList.toggle('hidden', !show)
    if (!show) return
    const dd = data
    const alive = dd.universal.filter((f) => faithLives(dd, f, year))
    const key = `${alive.join(',')}:${sel}`
    if (key === shownLegendKey) return
    shownLegendKey = key
    legendList.replaceChildren()
    alive.sort((a, b) => dd.worldShare[s * dd.F + b] - dd.worldShare[s * dd.F + a] || a - b)
    for (const f of alive.slice(0, 9)) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'sp-legend-item' + (f === sel ? ' selected' : '')
      b.dataset.faith = String(f)
      const sw = el('span', 'sp-swatch')
      sw.style.background = dd.css[f]
      b.append(sw, span('sp-legend-text', dd.faiths[f].name + (dd.faiths[f].parent >= 0 ? ` (from ${dd.faiths[dd.faiths[f].parent]?.name ?? ''})` : '')))
      b.title = `${cap(faithName(dd, f))}: click to select`
      legendList.append(b)
    }
    if (alive.length > 9) legendList.append(el('div', 'sp-legend-item none', `and ${alive.length - 9} more`))
    // folk practice: a strip of the muted tones
    const folk = el('div', 'sp-legend-item none')
    const sw = el('span', 'sp-swatch fa-folk')
    const tones = dd.faiths.filter((x) => x.kind !== FaithKind.Universal).slice(0, 4).map((x) => dd.css[x.id])
    sw.style.background = tones.length > 1 ? `linear-gradient(90deg, ${tones.join(', ')})` : tones[0] ?? 'rgb(90, 86, 78)'
    folk.append(sw, 'Folk practice of the peoples')
    const holy = el('div', 'sp-legend-item none', el('span', 'fa-holy-glyph', '✸'), 'Holy city')
    const none = el('div', 'sp-legend-item none')
    const sw2 = el('span', 'sp-swatch')
    sw2.style.background = `rgb(${UNCLAIMED.join(', ')})`
    none.append(sw2, 'No one’s land; paler where the majority is slim')
    legendList.append(folk, holy, none)
  }

  // ---------- inspector ----------
  function updateInspector(s: number) {
    if (!data || inspected < 0) {
      if (shownInspKey !== 'none') {
        shownInspKey = 'none'
        insp.classList.add('hidden')
      }
      return
    }
    const dd = data
    const h = dd.history
    const key = `${inspected}:${s}:${Math.floor(year + 1e-6) >= (h.settlements[inspected]?.foundedYear ?? 0) ? 1 : 0}`
    if (key === shownInspKey) return
    shownInspKey = key
    insp.replaceChildren()
    const lines: (string | Node)[][] = []
    const f = faithAt(dd, inspected, s)
    if (f >= 0) {
      const sh = faithShareAt(dd, inspected, s)
      const x = dd.faiths[f]
      lines.push([dot(f), x.kind === FaithKind.Universal ? ` ${cap(faithName(dd, f))}: ${pct(sh)} of its people` : ` Keeps ${faithName(dd, f, false)} (${pct(sh)} of its people)`])
    }
    for (const g of dd.holyOf.get(inspected) ?? []) {
      const y = dd.faiths[g]
      if (y.foundedYear > year) continue
      lines.push([y.parent >= 0 ? `Seat of ${faithName(dd, g)}, which split from ${dd.faiths[y.parent]?.name ?? ''} in ${y.foundedYear}` : `Holy city of ${faithName(dd, g)}, founded here in ${y.foundedYear}` + (y.endedYear >= 0 && y.endedYear <= year ? ` (it died out in ${y.endedYear})` : '')])
    }
    // its realm's state religion, where it is not the faith of the place
    if (pd) {
      const q = polityAtYear(pd, inspected, year)
      const sf = q >= 0 ? stateFaithAt(dd, q, s) : -1
      if (sf >= 0 && sf !== f) lines.push([`Its realm's state religion is ${faithName(dd, sf)}`])
      else if (sf >= 0 && q >= 0 && capitalAt(pd, q, year) === inspected) lines.push([`Capital of a state of ${faithName(dd, sf)}`])
    }
    for (const parts of lines) {
      const d = document.createElement('div')
      for (const p of parts) {
        if (p instanceof HTMLElement && p.classList.contains('gp-link')) p.className = 'insp-link'
        d.append(p)
      }
      insp.append(d)
    }
    insp.classList.toggle('hidden', lines.length === 0)
  }

  addShortcut({
    keys: ['Escape'],
    label: 'Esc',
    description: 'Close a popup, else leave the known world, else deselect',
    group: 'Panels',
    run: () => {
      if (sel < 0) return false
      select(-1, false)
    },
  })
  addShortcut({ keys: ['f', 'F'], label: 'F', description: 'Show or hide the faiths', group: 'Panels', run: () => (data ? toggleCollapsed() : false) })

  const api: FaithsView = {
    setWorld(w: World) {
      world = w
      shownViewKey = ''
      viewRgb = null
    },
    build(w: World, h: History) {
      const dd = faithsOf(h)
      if (!dd) return null
      return { data: dd, layer: buildFaithLayer(w, h, dd) }
    },
    disposeBuilt(b) {
      if (!b) return
      deps.planetGroup.remove(b.layer.object)
      b.layer.dispose()
    },
    commit(b: FaithsBuilt | null, extend: boolean) {
      if (layer) {
        deps.planetGroup.remove(layer.object)
        layer.dispose()
      }
      layer = b?.layer ?? null
      data = b?.data ?? null
      pd = data ? politiesOf(data.history) : null
      atCell = new Map()
      if (data) for (const s of data.history.settlements) {
        const a = atCell.get(s.cell)
        if (a) a.push(s.id)
        else atCell.set(s.cell, [s.id])
      }
      if (layer) {
        deps.planetGroup.add(layer.object)
        layer.setKnownMask(knownMask)
        layer.setMasked(knownMask !== null)
      }
      root.classList.toggle('hidden', !data)
      deps.setViewModeAvailable?.(ViewMode.Faiths, !!data)
      if (!data) legend.classList.add('hidden')
      if (!extend) sel = -1
      if (pending !== null && data) {
        const p = pending
        pending = null
        select(p, false)
      } else select(sel, false)
      shownViewKey = ''
      force()
    },
    setViewMode(mode: ViewMode) {
      viewMode = mode
      layer?.setShown(mode === ViewMode.Faiths, sel)
      shownViewKey = ''
      shownLegendKey = ''
      if (mode !== ViewMode.Faiths) legend.classList.add('hidden')
      dirty = true
      requestRender()
    },
    showSettlement(id: number) {
      inspected = id
      shownInspKey = ''
      dirty = true
      requestRender()
    },
    setKnownMask(cellYear: Float32Array | null) {
      knownMask = cellYear
      layer?.setKnownMask(cellYear)
    },
    setMasked(on: boolean) {
      layer?.setMasked(on)
    },
    tick(y, coarse, camera, drawSize, pixelRatio) {
      year = y
      if (!data) return
      if (layer) {
        layer.setTime(y)
        layer.update(camera, drawSize, pixelRatio)
      }
      if (coarse !== coarseShown) {
        coarseShown = coarse
        dirty = true // (stopped: the exact snapshot again)
      }
      // renaming: a name in force changed (holy cities, seats): rewrite the lines that name towns
      if (namesEpoch() !== shownNames) {
        shownNames = namesEpoch()
        shownPaneKey = shownDetailKey = shownInspKey = ''
        dirty = true
      }
      const yi = Math.floor(y + 1e-6)
      if (yi === tickedYear && !dirty) return
      tickedYear = yi
      dirty = false
      const s = faithSnap(data, y)
      updateCount(s)
      updatePane(s)
      updateDetail(s)
      updateLegend(s)
      updateInspector(s)
      updateView(coarse ? s - (s % 5) : s)
    },
    describeCell(cell: number) {
      if (!data) return ''
      const dd = data
      const h = dd.history
      const s = faithSnap(dd, year)
      const parts: string[] = []
      for (const id of atCell.get(cell) ?? []) for (const g of dd.holyOf.get(id) ?? []) if (faithLives(dd, g, year) && h.population[s * dd.N + id] > 0) parts.push(`Holy city of the ${dd.faiths[g].name} faith`)
      if (viewShown()) {
        // the land's owner at the land snapshot (or a settlement on the cell)
        let owner = -1
        const L = h.landCells?.length ?? 0
        const LQ = h.landSnapshotCount ?? 0
        if (h.territory && L > 0 && LQ > 0) {
          const q = Math.max(0, Math.min(LQ - 1, Math.floor(year / Math.max(1, h.landInterval))))
          let lo = 0, hi = L
          while (lo < hi) {
            const m = (lo + hi) >>> 1
            if (h.landCells[m] < cell) lo = m + 1
            else hi = m
          }
          if (lo < L && h.landCells[lo] === cell) owner = h.territory[q * L + lo] - 1
        }
        for (const id of atCell.get(cell) ?? []) if (h.population[s * dd.N + id] > 0) owner = id
        const f = owner >= 0 ? faithAt(dd, owner, s) : -1
        if (f >= 0) parts.unshift(`${dd.faiths[f].kind === FaithKind.Universal ? `${dd.faiths[f].name} faith` : `Folk practice (${dd.faiths[f].name})`}, ${pct(faithShareAt(dd, owner, s))} of ${sname(owner)}`)
      }
      return parts.join(' · ')
    },
  }
  deps.setViewModeAvailable?.(ViewMode.Faiths, false)
  if (params.get('perf') === '1') {
    ;(window as unknown as { __worldseedFaiths: unknown }).__worldseedFaiths = {
      data: () => data,
      active: () => layer?.active ?? false,
      select: (f: number) => select(f, false),
      /** Milliseconds to recolour the Faiths view once (the per-snapshot cost while it plays). */
      recolourMs: () => {
        if (!data) return -1
        const t0 = performance.now()
        shownViewKey = ''
        updateView(faithSnap(data, year))
        return performance.now() - t0
      },
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
