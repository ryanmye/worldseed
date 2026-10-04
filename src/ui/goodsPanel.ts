// Goods and trade in the UI: the "Goods and trade" panel (right column, collapsed by default:
// tabs for craft traditions, secrets, marts and prices, deposits and lanes), the goods section of
// the inspector, the long-haul layer on the map (render/longhaul.ts: lanes, relay legs, marts,
// posts, deposits, ships, industries on the Resources view, prices), the hover readout's
// deposits and posts, the Resources legend, and the goods lines of the Factions detail.
//
// Selections (one at a time): a tradition (tradition=<id>: its seats ringed, the legs carrying
// its class from them bold), a secret (secret=<id>: its holders' settlements ringed in their
// faction's colour, a timeline of holders with the channel each gained it by), a deposit
// (deposit=<id>), a lane (lane=<leg id>: bold, its opening expedition's trail, its ends ringed);
// the price view (price=<good>, 7..11) shades the traders of a class. Selecting flies there.
// Everything is a function of the year; DOM writes happen only when what is shown changes.

import * as THREE from 'three'
import type { History, World } from '../contract.ts'
import { LegKind, PostKind, SecretKind } from '../contract.ts'
import { buildLongHaulLayer, type LongHaulLayer } from '../render/longhaul.ts'
import { ViewMode } from '../render/palette.ts'
import { requestRender } from '../render/invalidate.ts'
import { formatPopulation, settlementName } from './format.ts'
import {
  aliveAt, CHANNEL_WORDS, CRAFT_WORDS, DEPOSIT_WORDS, depositOutputAt, depositsNear, depositState, goodsOf, guardAt, holderName, holdersAt, industryAt, industryWords,
  INDUSTRY_LIST, legOpen, legVolumeAt, martAt, metalAt, metalWords, mineAt, POST_WORDS, postLives, PRICE_GOODS, PRICE_WORDS, priceAt, priceSpread, qualityAt,
  rushAt, SECRET_KIND_WORDS, secretNoun, secretTitle, seatsAt, topMarts, tradeSnapAt, traditionLives, traditionsAt, type GoodsData,
} from './goodsData.ts'
import { politiesOf, polityAtYear } from './politiesData.ts'
import { setPolityGoodsNote } from './politiesPanel.ts'
import { loadFlag, loadPref, saveFlag, savePref } from './panels.ts'
import { addShortcut } from './shortcuts.ts'
import { loadLayerPrefs, type LayerToggle } from './overlay.ts'
import './goods.css'

export interface GoodsBuilt {
  data: GoodsData
  layer: LongHaulLayer
}

export interface GoodsViewDeps {
  right: HTMLElement
  inspectorSlot: HTMLElement
  planetGroup: THREE.Group
  setUrlParam(name: string, value: string | null): void
  onSelectSettlement(id: number): void
  /** Fly the camera to a cell (and stop the spin). */
  flyToCell(cell: number): void
  addLayerToggle?(t: LayerToggle): HTMLInputElement
  setViewModeAvailable?(mode: ViewMode, available: boolean): void
}

export interface GoodsView {
  setWorld(world: World): void
  build(world: World, h: History, maxPopulation: number): GoodsBuilt | null
  disposeBuilt(b: GoodsBuilt | null | undefined): void
  commit(b: GoodsBuilt | null, extend: boolean): void
  setViewMode(mode: ViewMode): void
  /** Deposits show with the Structures layer (and on the Resources view). */
  setStructuresVisible(on: boolean): void
  showSettlement(id: number): void
  setKnownMask(cellYear: Float32Array | null): void
  setMasked(on: boolean): void
  setYield(near: number, far: number): void
  tick(year: number, s0: number, s1: number, frac: number, effectAlpha: number, camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number): void
  /** "Venet silver, worked by Venet" for what lies at a cell at the year shown, or ''. */
  describeCell(cell: number): string
}

const TABS = ['Crafts', 'Secrets', 'Marts', 'Deposits', 'Lanes'] as const
const CRAFT_COLORS = ['#ff7fc4', '#9a6bff', '#7fb6ff', '#d8e2ee', '#d0793e', '#7fe3e0', '#f2f2f2', '#efe6c8', '#e05a4a', '#ffb070', '#f6f4ee', '#b0385a']
const DEPOSIT_COLORS = ['#f2c14e', '#d6dde6', '#e0457b', '#f39a2a', '#f4f6fa', '#9a4fa8', '#d7834b', '#b9bcb5', '#7a808c', '#efeadc']
const CHANNEL_COLORS = ['#f2d27a', '#8fd0ff', '#ff8a6a', '#ffb3e0', '#d0a4ff', '#ff5f5f', '#9fe39a', '#ffe9a8']
const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255]

export function createGoodsView(deps: GoodsViewDeps): GoodsView {
  // ---------- panel ----------
  const root = document.createElement('div')
  root.className = 'panel goods hidden'
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'gp-head'
  head.title = 'Show or hide goods and trade (G)'
  const title = document.createElement('span')
  title.className = 'gp-title'
  title.textContent = 'Goods and trade'
  const count = document.createElement('span')
  count.className = 'gp-count'
  const caret = document.createElement('span')
  caret.className = 'caret'
  caret.setAttribute('aria-hidden', 'true')
  head.append(title, count, caret)
  const body = document.createElement('div')
  body.className = 'gp-body'
  body.id = 'goods-body'
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
  const detail = document.createElement('div')
  detail.className = 'gp-detail hidden'
  body.append(tabs, pane, detail)
  root.append(head, body)
  deps.right.insertBefore(root, deps.right.querySelector('.chronicle'))

  let collapsed = loadFlag('worldseed.goods.collapsed', true)
  let tab = Math.max(0, Math.min(TABS.length - 1, Number(loadPref('worldseed.goods.tab')) || 0))
  const syncCollapsed = () => {
    root.classList.toggle('collapsed', collapsed)
    head.setAttribute('aria-expanded', String(!collapsed))
  }
  syncCollapsed()
  const toggleCollapsed = () => {
    collapsed = !collapsed
    saveFlag('worldseed.goods.collapsed', collapsed)
    syncCollapsed()
    force()
  }
  head.addEventListener('click', toggleCollapsed)
  const syncTabs = () => tabBtns.forEach((b, i) => {
    b.classList.toggle('active', i === tab)
    b.setAttribute('aria-selected', String(i === tab))
  })
  syncTabs()

  // ---------- Resources legend (under the map panel) ----------
  const legend = document.createElement('div')
  legend.className = 'panel sp-legend gp-legend hidden'
  {
    const mapPanel = deps.right.querySelector('.map-panel')
    deps.right.insertBefore(legend, mapPanel ? mapPanel.nextSibling : deps.right.firstChild)
  }

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
  const priceParam = () => {
    const v = params.get('price')
    if (v === null) return -1
    const n = Number.parseInt(v, 10)
    const k = PRICE_GOODS.indexOf(n)
    if (k >= 0) return k
    return PRICE_WORDS.findIndex((w) => w.startsWith(v.toLowerCase()))
  }
  type Sel = { kind: 'none' } | { kind: 'tradition' | 'secret' | 'deposit' | 'lane'; id: number }
  let sel: Sel = { kind: 'none' }
  let pending: { tradition: number; secret: number; deposit: number; lane: number; price: number } | null = {
    tradition: intParam('tradition'), secret: intParam('secret'), deposit: intParam('deposit'), lane: intParam('lane'), price: priceParam(),
  }
  let price = -1
  let world: World | null = null
  let data: GoodsData | null = null
  let layer: LongHaulLayer | null = null
  let toggle: HTMLInputElement | null = null
  const prefs = loadLayerPrefs()
  let lanesOn = params.has('longhaul') ? params.get('longhaul') !== '0' : (prefs['longhaul'] ?? true)
  if (!lanesOn && !params.has('longhaul')) deps.setUrlParam('longhaul', '0')
  let structuresOn = true
  let viewMode: ViewMode = ViewMode.Terrain
  let knownMask: Float32Array | null = null
  let inspected = -1
  let year = 0
  let s0 = 0
  let shownPaneKey = ''
  let shownDetailKey = ''
  let shownInspKey = ''
  let shownHlKey = ''
  let shownCount = ''
  let shownLegendKey = ''
  /** What lies at each cell: deposits, and posts (factory hosts, forts and stations). */
  let depositAt = new Map<number, number>()
  let postsAt = new Map<number, number[]>()

  const force = () => {
    shownPaneKey = shownDetailKey = shownInspKey = shownHlKey = shownCount = ''
    requestRender()
  }

  const resources = () => viewMode === ViewMode.Resources
  function syncLayer() {
    layer?.setShown({ lanes: lanesOn, marks: lanesOn, deposits: structuresOn, resources: resources(), price })
    legend.classList.toggle('hidden', !resources() || !data)
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

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const tb = t.closest('[data-tab]') as HTMLElement | null
    if (tb) {
      tab = Number(tb.dataset.tab)
      savePref('worldseed.goods.tab', String(tab))
      syncTabs()
      force()
      return
    }
    const sl = t.closest('[data-sid]') as HTMLElement | null
    if (sl) {
      deps.onSelectSettlement(Number(sl.dataset.sid))
      return
    }
    const pr = t.closest('[data-price]') as HTMLElement | null
    if (pr) {
      setPrice(Number(pr.dataset.price))
      return
    }
    const it = t.closest('[data-sel]') as HTMLElement | null
    if (it) {
      const kind = it.dataset.sel as 'tradition' | 'secret' | 'deposit' | 'lane'
      const id = Number(it.dataset.id)
      if (sel.kind === kind && sel.id === id) select({ kind: 'none' }, false)
      else select({ kind, id }, true)
      return
    }
    if (t.closest('.gp-close')) select({ kind: 'none' }, false)
  })

  function setPrice(k: number) {
    price = data?.price && k >= 0 && k < 5 ? (price === k ? -1 : k) : -1
    deps.setUrlParam('price', price >= 0 ? String(PRICE_GOODS[price]) : null)
    syncLayer()
    force()
  }

  /** Where to fly for a selection. */
  function cellOf(s: Sel): number {
    if (!data || s.kind === 'none') return -1
    const H = data.history
    if (s.kind === 'deposit') return H.deposits[s.id]?.cell ?? -1
    if (s.kind === 'lane') {
      const L = data.legs
      if (!L) return -1
      return L.path[(L.pathOffsets[s.id] + L.pathOffsets[s.id + 1]) >> 1]
    }
    if (s.kind === 'tradition') {
      const seats = seatsAt(data, s.id, Math.max(year, H.traditions[s.id].bornYear))
      const id = seats[0] ?? H.traditions[s.id].bornAt
      return H.settlements[id]?.cell ?? -1
    }
    const x = data.secrets[s.id]
    const holds = holdersAt(data, s.id, Math.max(year, x.foundYear))
    const via = holds.length && data.holds ? data.holds.via[holds[holds.length - 1]] : x.foundAt
    const id = via >= 0 ? via : x.foundAt
    return id >= 0 ? H.settlements[id]?.cell ?? -1 : -1
  }

  function select(s: Sel, fly: boolean) {
    const valid = (n: number, k: string) => !!data && n >= 0 && n < (k === 'tradition' ? data.T : k === 'secret' ? data.secrets.length : k === 'deposit' ? data.D : k === 'lane' ? data.L : 0)
    if (s.kind !== 'none' && !valid(s.id, s.kind)) s = { kind: 'none' }
    sel = s
    for (const k of ['tradition', 'secret', 'deposit', 'lane']) deps.setUrlParam(k, s.kind === k ? String((s as { id: number }).id) : null)
    if (fly) {
      const c = cellOf(s)
      if (c >= 0) deps.flyToCell(c)
    }
    force()
  }

  // ---------- highlight on the map ----------
  function updateHighlight() {
    if (!layer || !data) return
    const key = sel.kind === 'none' ? '' : `${sel.kind}:${sel.id}:${s0}:${tradeSnapAt(data, year)}:${Math.floor(year)}`
    if (key === shownHlKey) return
    shownHlKey = key
    const H = data.history
    const legs: number[] = [], sett: number[] = [], rgb: [number, number, number][] = [], cells: number[] = []
    if (sel.kind === 'tradition') {
      const x = H.traditions[sel.id]
      const c = hex(CRAFT_COLORS[x.craft] ?? '#ffffff')
      const seats = seatsAt(data, sel.id, year)
      for (const id of seats) {
        sett.push(id)
        rgb.push(c)
        // where its goods travel: the open legs from its seats carrying its class away
        const L = data.legs
        if (L) for (const k of data.legsOf.get(id) ?? []) if (legOpen(data, k, year) && ((L.a[k] === id && L.goodAB[k] === x.good) || (L.b[k] === id && L.goodBA[k] === x.good))) legs.push(k)
      }
    } else if (sel.kind === 'secret') {
      const SH = data.holds
      const pd = politiesOf(H)
      const N = data.N
      const s = Math.max(0, Math.min(H.snapshotCount - 1, Math.floor(year / H.snapshotInterval)))
      if (SH) {
        for (const i of holdersAt(data, sel.id, year)) {
          const q = SH.polity[i], pp = SH.people[i]
          const c: [number, number, number] = pd && q >= 0 && q < pd.count ? [pd.rgb[q * 3], pd.rgb[q * 3 + 1], pd.rgb[q * 3 + 2]] : hex(CHANNEL_COLORS[SH.channel[i]] ?? '#ffffff')
          for (let id = 0; id < N && sett.length < 470; id++) {
            if (H.population[s * N + id] <= 0 || H.settlements[id].people !== pp) continue
            const pol = H.polity && H.polity.length >= (s + 1) * N ? H.polity[s * N + id] : -1
            if (q >= 0 ? pol !== q : pol >= 0) continue
            sett.push(id)
            rgb.push(c)
          }
        }
        // a chart: its lane too
        const x = data.secrets[sel.id]
        if (x.kind === SecretKind.Chart && x.subject >= 0 && x.subject < data.L) legs.push(x.subject)
      }
    } else if (sel.kind === 'deposit') {
      cells.push(H.deposits[sel.id].cell)
      const st = mineAt(data, sel.id, year)
      if (st && st.settlement >= 0) {
        sett.push(st.settlement)
        rgb.push([1, 0.85, 0.45])
      }
    } else if (sel.kind === 'lane') {
      const L = data.legs!
      legs.push(sel.id)
      // the other legs of its chart (a lane through a station)
      const chart = L.chart[sel.id]
      if (chart >= 0) for (const k of data.lanes) if (k !== sel.id && L.chart[k] === chart) legs.push(k)
      for (const k of legs) for (const id of [L.a[k], L.b[k]]) if (!sett.includes(id)) {
        sett.push(id)
        rgb.push([1, 0.95, 0.75])
      }
    }
    layer.setHighlight(legs, sett, rgb, cells)
  }

  // ---------- panel content ----------
  function updateCount() {
    if (!data) return
    let lanes = 0, crafts = 0
    for (const k of data.lanes) if (legOpen(data, k, year)) lanes++
    for (let t = 0; t < data.T; t++) if (traditionLives(data, t, year)) crafts++
    const parts: string[] = []
    if (lanes) parts.push(`${lanes} ${lanes === 1 ? 'lane' : 'lanes'}`)
    if (crafts) parts.push(`${crafts} ${crafts === 1 ? 'craft' : 'crafts'}`)
    const c = parts.join(' · ') || 'none yet'
    if (c !== shownCount) {
      shownCount = c
      count.textContent = c
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
  const span = (cls: string, text: string, tip?: string) => {
    const s = document.createElement('span')
    s.className = cls
    s.textContent = text
    if (tip) s.title = tip
    return s
  }
  const qbar = (q: number) => {
    const w = document.createElement('span')
    w.className = 'gp-qbar'
    const f = document.createElement('span')
    f.style.width = `${Math.min(100, (q / 3) * 100).toFixed(0)}%`
    w.title = `Quality ${q.toFixed(1)}`
    w.append(f)
    return w
  }
  const note = (text: string) => el('div', 'gp-note', text)

  function updatePane() {
    if (!data || collapsed) return
    const gd = data
    const H = gd.history
    const yi = Math.floor(year)
    const t = tradeSnapAt(gd, year)
    const selKey = sel.kind === 'none' ? '' : `${sel.kind}${sel.id}`
    const key = `${tab}:${t}:${selKey}:${price}:${tab === 0 || tab === 1 || tab === 4 ? yi : ''}`
    if (key === shownPaneKey) return
    shownPaneKey = key
    pane.replaceChildren()
    if (tab === 0) {
      // craft traditions born by the year
      const list: number[] = []
      for (let k = 0; k < gd.T; k++) if (H.traditions[k].bornYear <= year) list.push(k)
      if (!list.length) {
        pane.append(note(gd.T ? `No craft traditions yet (the first in ${H.traditions[0].bornYear}).` : 'No craft traditions in this history.'))
        return
      }
      list.sort((a, b) => qualityAt(gd, b, year) - qualityAt(gd, a, year) || a - b)
      for (const k of list) {
        const x = H.traditions[k]
        const lives = traditionLives(gd, k, year)
        const seats = seatsAt(gd, k, year)
        const q = qualityAt(gd, k, year)
        const r = row('tradition', k, sel.kind === 'tradition' && sel.id === k, dot(CRAFT_COLORS[x.craft] ?? '#fff'), span('gp-name', gd.traditionNames[k]), span('gp-sub', CRAFT_WORDS[x.craft] ?? ''), lives ? qbar(q) : span('gp-sub', 'lost'), span('gp-num', lives ? String(seats.length) : '', 'Seats'))
        if (!lives) r.classList.add('ended')
        r.title = `${gd.traditionNames[k]}: ${CRAFT_WORDS[x.craft] ?? ''}, born ${x.bornYear} at ${sname(x.bornAt)}` + (lives ? `; quality ${q.toFixed(1)}, ${seats.length} ${seats.length === 1 ? 'seat' : 'seats'}` : '')
        pane.append(r)
      }
    } else if (tab === 1) {
      const list: number[] = []
      for (let k = 0; k < gd.secrets.length; k++) if (gd.secrets[k].foundYear <= year && (gd.holdsOf[k].length > 0)) list.push(k)
      if (!list.length) {
        pane.append(note(gd.secrets.length ? 'No secrets kept yet.' : 'No secrets in this history.'))
        return
      }
      for (const k of list) {
        const x = gd.secrets[k]
        const n = holdersAt(gd, k, year).length
        pane.append(row('secret', k, sel.kind === 'secret' && sel.id === k, dot(x.kind === SecretKind.Chart ? '#ffe9a8' : x.kind === SecretKind.Craft ? '#d8e2ee' : '#9fe39a'), span('gp-name', secretTitle(gd, k)), span('gp-sub', SECRET_KIND_WORDS[x.kind] ?? ''), span('gp-num', String(n), 'Holders now')))
      }
    } else if (tab === 2) {
      const tops = topMarts(gd, year, 8)
      if (!tops.length) pane.append(note(gd.mart ? 'No marts yet.' : 'No marts in this history.'))
      else {
        pane.append(el('div', 'gp-cap', 'Busiest marts'))
        for (const m of tops) {
          const b = row('mart', m.id, false, dot('#f2c14e'), span('gp-name', sname(m.id)), span('gp-sub', `${m.legs} ${m.legs === 1 ? 'leg' : 'legs'}`), span('gp-num', formatPopulation(m.volume), 'Long-haul trade a year'))
          b.removeAttribute('data-sel')
          b.dataset.sid = String(m.id)
          pane.append(b)
        }
      }
      if (gd.price) {
        pane.append(el('div', 'gp-cap', 'Prices on the map'))
        const chips = el('div', 'gp-chips')
        PRICE_WORDS.forEach((w, k) => {
          const c = document.createElement('button')
          c.type = 'button'
          c.className = 'gp-chip' + (price === k ? ' active' : '')
          c.dataset.price = String(k)
          c.textContent = w
          c.title = `Shade the traders by the price of ${w} (again to turn off)`
          chips.append(c)
        })
        pane.append(chips)
        if (price >= 0) {
          const sp = priceSpread(gd, price, t)
          if (sp.n > 1 && sp.min > 0) {
            const ratio = sp.max / sp.min
            pane.append(el('div', 'gp-line', `${PRICE_WORDS[price].charAt(0).toUpperCase() + PRICE_WORDS[price].slice(1)} sell at `, el('b', '', `×${ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}`), ' in the dearest market over the cheapest'))
            const l = el('div', 'gp-line gp-faint', 'Cheapest at ', settLink(sp.minAt), `, dearest at `, settLink(sp.maxAt), ` (of ${sp.n} markets)`)
            pane.append(l)
            pane.append(el('div', 'gp-ramp', span('', 'cheap'), span('', 'dear')))
          } else pane.append(note(`Too few markets trade ${PRICE_WORDS[price]} yet.`))
        }
      }
    } else if (tab === 3) {
      let found = 0, working = 0, spent = 0
      const list: number[] = []
      for (let d = 0; d < gd.D; d++) {
        const st = depositState(gd, d, year)
        if (st === 0) continue
        found++
        if (st === 2) spent++
        else if (mineAt(gd, d, year) || depositOutputAt(gd, d, year) > 0.01) working++
        list.push(d)
      }
      pane.append(el('div', 'gp-line', `${found} found · ${working} worked · ${spent} spent` + (gd.D - found > 0 ? ` · ${gd.D - found} undiscovered` : '')))
      for (const d of list) {
        const x = H.deposits[d]
        const st = depositState(gd, d, year)
        const mine = mineAt(gd, d, year)
        const out = depositOutputAt(gd, d, year)
        const r = row('deposit', d, sel.kind === 'deposit' && sel.id === d, dot(DEPOSIT_COLORS[x.kind] ?? '#fff'), span('gp-name', gd.depositNames[d]), span('gp-sub', st === 2 ? 'spent' : rushAt(gd, d, year) ? 'rush' : mine ? sname(mine.settlement) : out > 0.01 ? 'worked' : 'idle'), span('gp-num', st === 2 ? '' : out > 0.01 ? out.toFixed(1) : '', 'Output a year'))
        if (st === 2) r.classList.add('ended')
        r.title = `${gd.depositNames[d]} (${DEPOSIT_WORDS[x.kind]}${x.richness >= 3 ? ', a bonanza' : ''}): found ${x.foundYear}${x.foundBy >= 0 ? ` by ${sname(x.foundBy)}` : ''}` + (st === 2 ? `, spent ${x.exhaustedYear}` : '')
        pane.append(r)
      }
    } else {
      const L = gd.legs
      const list = gd.lanes.filter((k) => L && L.openedYear[k] <= year)
      if (!list.length) {
        pane.append(note(gd.lanes.length ? `No direct lanes yet (the first in ${L!.openedYear[gd.lanes[0]]}).` : 'No direct lanes in this history.'))
        return
      }
      for (const k of list) {
        const open = legOpen(gd, k, year)
        const v = legVolumeAt(gd, k, year)
        const r = row('lane', k, sel.kind === 'lane' && sel.id === k, dot('#ffe9a8'), span('gp-name', `${sname(L!.a[k])} – ${sname(L!.b[k])}`), span('gp-sub', String(L!.openedYear[k])), span('gp-num', open ? formatPopulation(v) : 'closed', 'Cargo a year'))
        if (!open) r.classList.add('ended')
        pane.append(r)
      }
    }
  }

  function updateDetail() {
    if (!data || collapsed || sel.kind === 'none') {
      if (!detail.classList.contains('hidden')) detail.classList.add('hidden')
      shownDetailKey = ''
      return
    }
    const gd = data
    const H = gd.history
    const key = `${sel.kind}:${sel.id}:${Math.floor(year)}`
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
    if (sel.kind === 'tradition') {
      const x = H.traditions[sel.id]
      detail.append(el('div', 'gp-d-title', dot(CRAFT_COLORS[x.craft] ?? '#fff'), gd.traditionNames[sel.id], close))
      line(`${CRAFT_WORDS[x.craft]} of the ${H.peoples[x.people]?.name ?? ''} people, born ${x.bornYear} at `, settLink(x.bornAt))
      if (x.parent >= 0) line(`A daughter of ${gd.traditionNames[x.parent]}`)
      if (year < x.bornYear) {
        line('(not yet)')
        return
      }
      const q = qualityAt(gd, sel.id, year)
      if (traditionLives(gd, sel.id, year)) {
        const l = line(`Quality ${q.toFixed(1)} `)
        l.append(qbar(q))
        const seats = seatsAt(gd, sel.id, year)
        const s = line(seats.length === 1 ? 'Seat: ' : `Seats (${seats.length}): `)
        seats.forEach((id, i) => {
          if (i) s.append(', ')
          s.append(settLink(id))
        })
      } else line(`Lost in ${x.endYear}`).classList.add('gp-faint')
      for (const i of gd.eventsOfTradition[sel.id]) {
        const e = H.events[i]
        if (e.year > year || (e.type as number) === 53) continue
        const t = e.type as number
        if (t === 55) line(`${e.year}: carried from `, settLink(e.other), ' to ', settLink(e.settlement), e.extra === 1 ? ' (deported)' : e.extra === 2 ? ' (fled)' : '').classList.add('gp-faint')
        else if (t === 54) line(`${e.year}: renowned`).classList.add('gp-faint')
      }
    } else if (sel.kind === 'secret') {
      const x = gd.secrets[sel.id]
      detail.append(el('div', 'gp-d-title', secretTitle(gd, sel.id), close))
      line(`A ${SECRET_KIND_WORDS[x.kind]} secret`, x.foundAt >= 0 ? ', first at ' : '', x.foundAt >= 0 ? settLink(x.foundAt) : '', x.foundYear > 0 ? ` (${x.foundYear})` : ' (held from the start)')
      const g = guardAt(gd, sel.id, year)
      if (g > 0.02) line(`Guarded ${g >= 0.66 ? 'closely' : g >= 0.33 ? 'well' : 'loosely'} by its main holder`)
      // the holders' timeline: a bar per holding over the run, with the channel it came by
      const SH = gd.holds
      const all = gd.holdsOf[sel.id]
      const y0 = Math.max(0, Math.min(...all.map((i) => SH!.from[i])))
      const y1 = Math.max(H.years, year)
      const tl = el('div', 'gp-tl')
      const pd = politiesOf(H)
      for (const i of all) {
        if (!SH || SH.from[i] > year) continue
        const to = SH.to[i] >= 0 && SH.to[i] <= year ? SH.to[i] : year
        const r = el('div', 'gp-tl-row')
        const track = el('div', 'gp-tl-track')
        const bar = el('span', 'gp-tl-bar')
        bar.style.left = `${((100 * (SH.from[i] - y0)) / Math.max(1, y1 - y0)).toFixed(1)}%`
        bar.style.width = `${Math.max(1.5, (100 * (to - SH.from[i])) / Math.max(1, y1 - y0)).toFixed(1)}%`
        const q = SH.polity[i]
        bar.style.background = pd && q >= 0 && q < pd.count ? pd.css[q] : CHANNEL_COLORS[SH.channel[i]] ?? '#ccc'
        track.append(bar)
        const ch = el('span', 'gp-tl-ch', CHANNEL_WORDS[SH.channel[i]] ?? '')
        ch.style.color = CHANNEL_COLORS[SH.channel[i]] ?? ''
        r.append(el('span', 'gp-tl-name', holderName(gd, i)), track, ch)
        r.title = `${holderName(gd, i)}: from ${SH.from[i]}${SH.to[i] >= 0 ? ` to ${SH.to[i]}` : ''}, ${CHANNEL_WORDS[SH.channel[i]]}${SH.via[i] >= 0 ? ` via ${sname(SH.via[i])}` : ''}`
        tl.append(r)
      }
      const cur = el('div', 'gp-tl-cursor')
      cur.style.left = `${((100 * (year - y0)) / Math.max(1, y1 - y0)).toFixed(1)}%`
      tl.append(cur)
      detail.append(el('div', 'gp-cap', `Holders ${y0}–${y1}`), tl)
    } else if (sel.kind === 'deposit') {
      const x = H.deposits[sel.id]
      detail.append(el('div', 'gp-d-title', dot(DEPOSIT_COLORS[x.kind] ?? '#fff'), gd.depositNames[sel.id], close))
      line(`${DEPOSIT_WORDS[x.kind]}${x.richness >= 3 ? ', a bonanza' : x.richness >= 1.25 ? ', rich' : ''}`)
      if (x.foundYear < 0 || year < x.foundYear) {
        line(x.foundYear < 0 ? 'Never found' : `Found in ${x.foundYear} (not yet)`)
        return
      }
      line(`Found in ${x.foundYear}`, x.foundBy >= 0 ? ' by prospectors from ' : '', x.foundBy >= 0 ? settLink(x.foundBy) : '')
      const mine = mineAt(gd, sel.id, year)
      if (mine) line('Worked by ', settLink(mine.settlement), ` since ${mine.builtYear}`)
      const out = depositOutputAt(gd, sel.id, year)
      if (out > 0.01) line(`Output ${out.toFixed(1)} a year (peak ${gd.depositPeak[sel.id].toFixed(1)})`)
      if (rushAt(gd, sel.id, year)) line('A rush is on').classList.add('gp-hot')
      if (x.exhaustedYear >= 0 && year >= x.exhaustedYear) line(`Gave out in ${x.exhaustedYear}`).classList.add('gp-faint')
    } else {
      const L = gd.legs!
      const k = sel.id
      detail.append(el('div', 'gp-d-title', dot('#ffe9a8'), `${sname(L.a[k])} – ${sname(L.b[k])}`, close))
      const ev = gd.legEvent[k]
      const v = ev >= 0 ? H.events[ev].extra ?? -1 : -1
      line(`${L.kind[k] === LegKind.Lane ? 'A direct lane' : 'A relay leg'}, opened ${L.openedYear[k]} from `, settLink(L.a[k]), v >= 0 ? ` in search of ${gd.varietyNames[v] ?? 'goods'}` : '')
      const j = gd.legJourney[k]
      if (j >= 0 && H.journeys) line(`Found by an expedition from ${sname(H.journeys.from[j])} (${Math.floor(H.journeys.departYear[j])}–${Math.floor(H.journeys.arriveYear[j])}): its trail is dotted`).classList.add('gp-faint')
      if (L.closedYear[k] >= 0 && year >= L.closedYear[k]) line(`Closed in ${L.closedYear[k]}`).classList.add('gp-faint')
      else if (year >= L.openedYear[k]) line(`Carries ${formatPopulation(legVolumeAt(gd, k, year))} a year: ${['grain', 'fish', 'livestock', 'timber', 'ore', 'salt', 'cloth', 'luxuries', 'stimulants', 'metalware', 'finery', 'treasure', 'wares'][L.goodAB[k]] ?? 'goods'} out, ${['grain', 'fish', 'livestock', 'timber', 'ore', 'salt', 'cloth', 'luxuries', 'stimulants', 'metalware', 'finery', 'treasure', 'wares'][L.goodBA[k]] ?? 'goods'} home`)
      const c = L.chart[k]
      if (c >= 0) {
        const n = holdersAt(gd, c, year).length
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'gp-link'
        b.dataset.sel = 'secret'
        b.dataset.id = String(c)
        b.textContent = 'its chart'
        line('The way is a secret: ', b, ` held by ${n} ${n === 1 ? 'holder' : 'holders'}`)
      }
      const ps = gd.posts.filter((p) => p.leg === k && p.foundedYear <= year)
      for (const p of ps) line(`${POST_WORDS[p.kind].charAt(0).toUpperCase() + POST_WORDS[p.kind].slice(1)} at `, settLink(p.kind === PostKind.Factory ? p.host : p.settlement), ` (${p.foundedYear}${p.endedYear >= 0 && p.endedYear <= year ? `–${p.endedYear}` : ''})`)
      const by: number[] = []
      for (const [id, evs] of gd.bypassedOf) for (const i of evs) if (H.events[i].value === k && H.events[i].year <= year) by.push(id)
      if (by.length) {
        const l = line('Bypassed: ')
        by.slice(0, 6).forEach((id, i) => {
          if (i) l.append(', ')
          l.append(settLink(id))
        })
        if (by.length > 6) l.append(` and ${by.length - 6} more`)
      }
    }
  }

  // ---------- inspector ----------
  function inspectorLines(gd: GoodsData, id: number): (string | Node)[][] {
    const H = gd.history
    const out: (string | Node)[][] = []
    const post = gd.postOfSettlement.get(id)
    if (post !== undefined && postLives(gd, post, year)) {
      const p = gd.posts[post]
      const L = gd.legs
      // the lane's far end: a station or fort on the way serves the whole chart's lane
      let far = p.leg >= 0 && L ? L.b[p.leg] : -1
      if (L && p.leg >= 0 && far === id) for (const k of gd.lanes) if (k !== p.leg && L.chart[k] >= 0 && L.chart[k] === L.chart[p.leg] && L.a[k] === id) far = L.b[k]
      out.push([`A ${POST_WORDS[p.kind]} of `, settLink(p.owner), far >= 0 && far !== id ? ` on the lane to ${sname(far)}` : '', `, since ${p.foundedYear}`])
      if (p.kind === PostKind.Camp) {
        for (let d = 0; d < gd.D; d++) {
          const st = mineAt(gd, d, year)
          if (st && st.settlement === id) out.push([`It works ${gd.depositNames[d]}`])
        }
      }
    }
    const bits = industryAt(gd, id, year)
    if (bits) out.push([`Industries: ${industryWords(bits).join(', ').toLowerCase()}`])
    for (const { t, since } of traditionsAt(gd, id, year)) out.push([`Seat of ${gd.traditionNames[t]}, quality ${qualityAt(gd, t, year).toFixed(1)}, since ${since}`])
    if (martAt(gd, id, year)) {
      let v = 0, n = 0
      for (const k of gd.legsOf.get(id) ?? []) {
        const x = legVolumeAt(gd, k, year)
        if (x > 0) {
          v += x
          n++
        }
      }
      out.push([`A mart of the long-haul trade: ${n} ${n === 1 ? 'leg' : 'legs'}, ${formatPopulation(v)} a year`])
    }
    const L = gd.legs
    if (L) {
      const lanes = (gd.legsOf.get(id) ?? []).filter((k) => L.kind[k] === LegKind.Lane && L.a[k] === id && legOpen(gd, k, year))
      if (lanes.length) {
        const l: (string | Node)[] = ['Home of the lanes to ']
        lanes.forEach((k, i) => {
          if (i) l.push(', ')
          l.push(settLink(L.b[k]), ` (${L.openedYear[k]})`)
        })
        out.push(l)
      }
    }
    for (const x of gd.postsHosted.get(id) ?? []) {
      const p = gd.posts[x]
      if (postLives(gd, x, year)) out.push(['Hosts a trading post of ', settLink(p.owner), ` since ${p.foundedYear}`])
    }
    const owned = (gd.postsOwned.get(id) ?? []).filter((x) => postLives(gd, x, year))
    if (owned.length) {
      const l: (string | Node)[] = ['Keeps ']
      owned.slice(0, 5).forEach((x, i) => {
        const p = gd.posts[x]
        if (i) l.push(', ')
        l.push(`a ${POST_WORDS[p.kind]} at `, settLink(p.kind === PostKind.Factory ? p.host : p.settlement))
      })
      out.push(l)
    }
    for (const i of gd.bypassedOf.get(id) ?? []) {
      const e = H.events[i]
      if (e.year <= year) out.push([`Bypassed in ${e.year} by the lane from `, settLink(e.other)])
    }
    for (let d = 0; d < gd.D; d++) {
      const st = mineAt(gd, d, year)
      if (st && st.settlement === id) out.push([`Works the mine on ${gd.depositNames[d]} (${depositOutputAt(gd, d, year).toFixed(1)} a year)`])
    }
    if (world) {
      const near = depositsNear(gd, world.grid.positions, H.settlements[id].cell, year, 3.5).filter((d) => !(mineAt(gd, d, year)?.settlement === id))
      if (near.length) out.push([`Nearby: ${near.slice(0, 3).map((d) => gd.depositNames[d] + (depositState(gd, d, year) === 2 ? ' (spent)' : '')).join(', ')}`])
    }
    const [tools, arms] = metalAt(gd, id, year)
    if (gd.metal) out.push([metalWords(tools, arms)])
    if (gd.price) {
      const q = tradeSnapAt(gd, year)
      const parts: string[] = []
      for (let k = 0; k < 5; k++) {
        const p = priceAt(gd, id, k, year)
        const m = priceSpread(gd, k, q).median
        if (p > 0 && m > 0) parts.push(`${PRICE_WORDS[k]} ×${(p / m).toFixed(p / m >= 10 ? 0 : 1)}`)
      }
      if (parts.length) out.push([`Prices against the world median: ${parts.join(', ')}`])
    }
    return out
  }

  function updateInspector() {
    if (!data || inspected < 0) return
    const key = `${inspected}:${Math.floor(year)}`
    if (key === shownInspKey) return
    shownInspKey = key
    slot.replaceChildren()
    if (!aliveAt(data.history, inspected, year)) {
      slot.classList.add('hidden')
      return
    }
    const lines = inspectorLines(data, inspected)
    for (const parts of lines) {
      const d = document.createElement('div')
      for (const p of parts) {
        if (p instanceof HTMLElement && p.classList.contains('gp-link')) {
          // inspector links select through the inspector's own handler
          p.className = 'insp-link'
        }
        d.append(p)
      }
      slot.append(d)
    }
    slot.classList.toggle('hidden', lines.length === 0)
  }

  // ---------- Resources legend ----------
  function updateLegend() {
    if (!data || !resources()) return
    const gd = data
    const key = String(tradeSnapAt(gd, year))
    if (key === shownLegendKey) return
    shownLegendKey = key
    legend.replaceChildren()
    legend.append(el('div', 'sp-legend-title', 'Deposits'))
    const kinds = new Set<number>()
    for (let d = 0; d < gd.D; d++) if (depositState(gd, d, year) > 0) kinds.add(gd.history.deposits[d].kind)
    const dl = el('div', 'gp-legend-grid')
    for (const k of [...kinds].sort((a, b) => a - b)) dl.append(el('span', 'gp-legend-item', dot(DEPOSIT_COLORS[k]), DEPOSIT_WORDS[k]))
    if (!kinds.size) dl.append(el('span', 'gp-legend-item gp-faint', 'none found yet'))
    legend.append(dl, el('div', 'sp-legend-title', 'Industries (dots round a town)'))
    let used = 0
    if (gd.industry) for (let i = 0; i < gd.N; i++) used |= gd.industry[tradeSnapAt(gd, year) * gd.N + i]
    const il = el('div', 'gp-legend-grid')
    for (const x of INDUSTRY_LIST) if (used & x.bit) il.append(el('span', 'gp-legend-item', dot(x.color), x.word))
    if (!used) il.append(el('span', 'gp-legend-item gp-faint', 'none yet'))
    legend.append(il)
  }

  /** Faction detail lines (politiesPanel.ts): secrets held, lanes and posts kept, at the year. */
  function polityLines(p: number, y: number): (string | Node)[][] {
    const gd = data
    if (!gd) return []
    const H = gd.history
    const pd = politiesOf(H)
    if (!pd) return []
    const out: (string | Node)[][] = []
    const SH = gd.holds
    if (SH) {
      const names = new Set<string>()
      for (let i = 0; i < SH.count; i++) if (SH.polity[i] === p && SH.from[i] <= y && (SH.to[i] < 0 || y < SH.to[i])) names.add(secretNoun(gd, SH.secret[i]))
      if (names.size) out.push([`Holds the secrets of ${[...names].slice(0, 5).join(', ')}${names.size > 5 ? ` and ${names.size - 5} more` : ''}`])
    }
    const L = gd.legs
    if (L) {
      const mine = gd.lanes.filter((k) => legOpen(gd, k, y) && polityAtYear(pd, L.a[k], y) === p)
      if (mine.length) out.push([`Lanes: ${mine.slice(0, 4).map((k) => `${sname(L.a[k])} to ${sname(L.b[k])}`).join(', ')}${mine.length > 4 ? ` and ${mine.length - 4} more` : ''}`])
    }
    const posts = gd.posts.filter((x) => postLives(gd, x.id, y) && polityAtYear(pd, x.owner, y) === p)
    if (posts.length) out.push([`Trading posts: ${posts.slice(0, 4).map((x) => `${POST_WORDS[x.kind]} at ${sname(x.kind === PostKind.Factory ? x.host : x.settlement)}`).join(', ')}${posts.length > 4 ? ` and ${posts.length - 4} more` : ''}`])
    return out
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
  addShortcut({ keys: ['g', 'G'], label: 'G', description: 'Show or hide goods and trade', group: 'Panels', run: () => (data ? toggleCollapsed() : false) })

  const api: GoodsView = {
    setWorld(w: World) {
      world = w
    },
    build(w: World, hist: History, maxPopulation: number) {
      const gd = goodsOf(hist)
      if (!gd) return null
      return { data: gd, layer: buildLongHaulLayer(w, hist, gd, maxPopulation) }
    },
    disposeBuilt(b) {
      if (!b) return
      deps.planetGroup.remove(b.layer.object)
      b.layer.dispose()
    },
    commit(b: GoodsBuilt | null, extend: boolean) {
      if (layer) {
        deps.planetGroup.remove(layer.object)
        layer.dispose()
      }
      layer = b?.layer ?? null
      data = b?.data ?? null
      depositAt = new Map()
      postsAt = new Map()
      if (data) {
        const H = data.history
        H.deposits.forEach((d, i) => depositAt.set(d.cell, i))
        for (const x of data.posts) {
          const site = x.kind === PostKind.Factory ? x.host : x.settlement
          if (site < 0) continue
          const c = H.settlements[site].cell
          const a = postsAt.get(c)
          if (a) a.push(x.id)
          else postsAt.set(c, [x.id])
        }
      }
      if (layer) {
        deps.planetGroup.add(layer.object)
        layer.setKnownMask(knownMask)
        layer.setMasked(knownMask !== null)
      }
      root.classList.toggle('hidden', !data)
      deps.setViewModeAvailable?.(ViewMode.Resources, !!data && (data.D > 0 || !!data.industry))
      if (data && !toggle && deps.addLayerToggle) {
        toggle = deps.addLayerToggle({
          key: 'longhaul',
          label: 'Long-distance trade',
          group: 'movement',
          checked: lanesOn,
          title: 'Sea lanes opened by expeditions and their ships, relay legs between marts, marts and trading posts',
          onChange: (on) => {
            lanesOn = on
            deps.setUrlParam('longhaul', on ? null : '0')
            syncLayer()
          },
        })
      }
      toggle?.closest('label')?.classList.toggle('hidden', !data)
      setPolityGoodsNote(data ? polityLines : null)
      if (!extend) sel = { kind: 'none' }
      if (pending && data) {
        const p = pending
        pending = null
        if (p.price >= 0) price = p.price
        if (p.tradition >= 0) select({ kind: 'tradition', id: p.tradition }, false)
        else if (p.secret >= 0) select({ kind: 'secret', id: p.secret }, false)
        else if (p.deposit >= 0) select({ kind: 'deposit', id: p.deposit }, false)
        else if (p.lane >= 0) select({ kind: 'lane', id: p.lane }, false)
      } else if (sel.kind !== 'none') select(sel, false)
      if (!data) price = -1
      shownLegendKey = ''
      syncLayer()
      force()
    },
    setViewMode(mode: ViewMode) {
      viewMode = mode
      shownLegendKey = ''
      syncLayer()
    },
    setStructuresVisible(on: boolean) {
      structuresOn = on
      syncLayer()
    },
    showSettlement(id: number) {
      inspected = id
      shownInspKey = ''
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
    tick(y, sa, sb, frac, effectAlpha, camera, drawSize, pixelRatio) {
      year = y
      if (!data) return
      s0 = sa
      if (layer) {
        layer.setTime(y, sa, sb, frac, effectAlpha)
        layer.update(camera, drawSize, pixelRatio)
      }
      updateHighlight()
      updateCount()
      updatePane()
      updateDetail()
      updateInspector()
      updateLegend()
    },
    describeCell(cell: number) {
      if (!data) return ''
      const gd = data
      const parts: string[] = []
      const d = depositAt.get(cell)
      if (d !== undefined) {
        const st = depositState(gd, d, year)
        if (st > 0) {
          const mine = mineAt(gd, d, year)
          parts.push(`${gd.depositNames[d]}` + (st === 2 ? ' (spent)' : mine ? `, worked by ${sname(mine.settlement)}` : '') + (rushAt(gd, d, year) ? ', a rush' : ''))
        }
      }
      for (const x of postsAt.get(cell) ?? []) {
        if (!postLives(gd, x, year)) continue
        const p = gd.posts[x]
        parts.push(`${POST_WORDS[p.kind].charAt(0).toUpperCase() + POST_WORDS[p.kind].slice(1)} of ${sname(p.owner)}`)
      }
      return parts.join(' · ')
    },
  }
  return api
}
