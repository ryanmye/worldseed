// Plain-DOM UI overlay. Top left: the seed bar with the settings (sun, quality) and help
// popovers. Top right: the map panel, a view-mode menu (grouped: VIEW_GROUPS) and the
// collapsible Layers panel (toggles grouped Map / People / Movement, each group in the fixed
// order of LAYER_ORDER whichever module adds a toggle; the goods legend under Trade while it is
// on). Bottom left: the hover readout. Other panels join the exposed columns: the
// inspector under the seed bar (left), the chronicle under the map panel (right), the
// timeline at the bottom centre. The columns scroll internally and stop above the
// timeline when the window is too narrow for them to sit beside it.
//
// Layer toggles and the open/closed state of the panels are remembered (localStorage);
// URL parameters still win (see main.ts). Another layer toggle is one addLayerToggle call.

import { VIEW_MODES, BIOME_NAMES, type ViewMode } from '../render/palette.ts'
import type { Biome } from '../contract.ts'
import { GOOD_COLORS } from '../render/trade.ts'
import { GOOD_NAMES } from './format.ts'
import { addShortcut, shortcutList } from './shortcuts.ts'
import { loadFlag, loadPref, saveFlag, savePref, titleWhenCut } from './panels.ts'
import './trade.css'
import { creditsButton, fillCredits } from './credits.ts'
import './credits.css'
import { isCompact, isCompactLandscape, onCompactChange } from './compact.ts'
import { createSheet, relocateNode, restoreNode } from './sheet.ts'
import './compact.css'

export interface Readout {
  biome: Biome
  elevation: number
  temperature: number
  rainfall: number
  lake: boolean
  /** Cell under the pointer (for looking up what lies there). */
  cell?: number
  /** Named features on or beside the cell ("Kephia river, Hingara continent"). */
  places?: string
}

export interface OverlayCallbacks {
  onSeedSubmit(seed: number): void
  onRandomSeed(): void
  onViewModeChange(mode: ViewMode): void
  onRiversToggle(show: boolean): void
  onCloudsToggle(show: boolean): void
  onMarkersToggle(show: boolean): void
  onJourneysToggle(show: boolean): void
  onFarmlandToggle(show: boolean): void
  onStructuresToggle(show: boolean): void
  /** 3D buildings, farms, docks and ships up close. */
  onBuildingsToggle?(show: boolean): void
  /** Trade routes and merchants. */
  onTradeToggle?(show: boolean): void
  /** Roads and bridges. */
  onRoadsToggle?(show: boolean): void
  /** Place-name labels (shown only when given). */
  onLabelsToggle?(show: boolean): void
  /** Globe (false) or flat map (true); the switch shows only when given. */
  onProjectionChange?(map: boolean): void
}

export interface OverlayOptions {
  viewMode: ViewMode
  rivers: boolean
  clouds: boolean
  markers: boolean
  journeys: boolean
  farmland: boolean
  structures: boolean
  buildings?: boolean
  trade?: boolean
  roads?: boolean
  labels?: boolean
}

export type LayerGroup = 'nature' | 'people' | 'movement'

/**
 * The window rect left free of the panels right now (CSS px from each edge): past the side
 * columns, below the top bar and above the timeline bar. `left` only counts what sits below
 * the top bar in the left column (the inspector, once open) — the top bar's own width is far
 * wider than it is relevant for past its own height, which is what `top` is for instead.
 * render/mapControls.ts fits and centres the whole-world map in it; main.ts offsets the
 * camera's view (globe and map alike) so its rendered centre sits in the middle of it instead
 * of the middle of the window.
 */
export interface ViewportInset {
  left: number
  right: number
  top: number
  bottom: number
}

const ZERO_INSET: ViewportInset = { left: 0, right: 0, top: 0, bottom: 0 }
let freeInset: ViewportInset = ZERO_INSET
const insetListeners = new Set<(inset: ViewportInset) => void>()

/** The current free rect (see ViewportInset); current as of the last relayout() or construction. */
export function getFreeViewportInset(): ViewportInset {
  return freeInset
}

/** Notified whenever the free rect changes (a panel opens, closes, resizes, or the window does). */
export function onFreeViewportChange(cb: (inset: ViewportInset) => void): () => void {
  insetListeners.add(cb)
  return () => insetListeners.delete(cb)
}

function setFreeViewportInset(next: ViewportInset) {
  const prev = freeInset
  if (prev.left === next.left && prev.right === next.right && prev.top === next.top && prev.bottom === next.bottom) return
  freeInset = next
  for (const cb of insetListeners) cb(next)
}

/** One layer toggle (see Overlay.addLayerToggle). */
export interface LayerToggle {
  /** Stable key: remembered in localStorage under it (see loadLayerPrefs). */
  key: string
  label: string
  group: LayerGroup
  checked: boolean
  title?: string
  onChange(show: boolean): void
}

const MODE_LABELS: Record<ViewMode, string> = {
  terrain: 'Terrain',
  elevation: 'Elevation',
  temperature: 'Temperature',
  rainfall: 'Rainfall',
  plates: 'Plates',
  biomes: 'Biomes',
  population: 'Population',
  capacity: 'Carrying capacity',
  landuse: 'Land use',
  crops: 'Crops',
  herds: 'Herds',
  cash: 'Cash crops',
  factions: 'Factions',
  danger: 'Danger',
  faiths: 'Faiths',
  resources: 'Resources',
  fever: 'Fever',
  scenery: 'Scenery',
  ideas: 'Ideas',
}

const GROUP_LABELS: Record<LayerGroup, string> = { nature: 'Map', people: 'People', movement: 'Movement' }

/**
 * Place of each toggle within its group (the grid fills row by row, two to a row), so the list reads
 * the same whichever panel adds its toggle first: the map's own things, then what people built and
 * hold, then what moves. Toggles not listed go last.
 */
const LAYER_ORDER: Record<string, number> = {
  rivers: 0, clouds: 1, mapClouds: 1, labels: 2, graticule: 3, mapNight: 4,
  markers: 0, buildings: 1, farmland: 2, structures: 3, peoples: 4, factions: 5, disease: 6,
  journeys: 0, expeditions: 1, roads: 2, trade: 3, longhaul: 4, travel: 5,
  ideas: 7,
}

/** The view menu's groups (and the order V steps through). */
export const VIEW_GROUPS: readonly { label: string; modes: readonly ViewMode[] }[] = [
  { label: 'The planet', modes: ['terrain', 'elevation', 'temperature', 'rainfall', 'biomes', 'plates'] },
  { label: 'Land and food', modes: ['population', 'capacity', 'landuse', 'crops', 'herds', 'cash'] },
  { label: 'States and beliefs', modes: ['factions', 'danger', 'faiths'] },
  { label: 'Goods, travel, sickness', modes: ['resources', 'scenery', 'fever'] },
  { label: 'Know-how', modes: ['ideas'] },
]
/** Every view mode in menu order. */
const MENU_MODES: readonly ViewMode[] = [...VIEW_GROUPS.flatMap((g) => g.modes), ...VIEW_MODES.filter((m) => !VIEW_GROUPS.some((g) => g.modes.includes(m)))]

const LAYERS_KEY = 'worldseed.layers'
const LAYERS_OPEN_KEY = 'worldseed.layersOpen'

/** Remembered layer toggles by key ({} when none or unavailable). */
export function loadLayerPrefs(): Record<string, boolean> {
  try {
    const v = JSON.parse(loadPref(LAYERS_KEY) ?? '{}') as unknown
    if (!v || typeof v !== 'object') return {}
    const out: Record<string, boolean> = {}
    for (const [k, b] of Object.entries(v as Record<string, unknown>)) if (typeof b === 'boolean') out[k] = b
    return out
  } catch {
    return {}
  }
}

function saveLayerPref(key: string, on: boolean) {
  const prefs = loadLayerPrefs()
  prefs[key] = on
  savePref(LAYERS_KEY, JSON.stringify(prefs))
}

export interface Overlay {
  root: HTMLElement
  /** Column under the seed bar (top-left). */
  left: HTMLElement
  /** Column under the map panel (top-right). */
  right: HTMLElement
  /** Bottom-centre slot. */
  bottom: HTMLElement
  /** Body of the settings popover (sun and quality controls go here). */
  settings: HTMLElement
  setGenerating(on: boolean): void
  setReadout(r: Readout | null): void
  setSeed(seed: number): void
  setViewMode(mode: ViewMode): void
  /** Add a layer toggle to a group of the Layers panel; returns its checkbox. */
  addLayerToggle(t: LayerToggle): HTMLInputElement
  /** Offer a view mode in the menu (and to V / Shift+V) or not (views that need data the history lacks). */
  setViewModeAvailable(mode: ViewMode, available: boolean): void
  /** Re-measure what the columns must keep clear of (after a panel changes size). */
  relayout(): void
  /** Reflect the Globe / Map switch. */
  setProjection(map: boolean): void
  /** The goods legend under Trade shows only these (ascending ids), so it does not grow to every
   * defined good; call with the goods actually traded in the current history (tradePanel.goodsInUse). */
  setGoodsInUse(goods: readonly number[]): void
}

let uid = 0

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function createOverlay(container: HTMLElement, initialSeed: number, initial: OverlayOptions, callbacks: OverlayCallbacks): Overlay {
  const root = document.createElement('div')
  root.className = 'overlay'

  // ---------- seed bar ----------
  const topBar = document.createElement('div')
  topBar.className = 'panel top-bar'

  const seedLabel = document.createElement('label')
  seedLabel.className = 'seed-label'
  seedLabel.textContent = 'Seed'
  const seedInput = document.createElement('input')
  seedInput.type = 'text'
  seedInput.className = 'seed-input'
  seedInput.value = String(initialSeed)
  seedInput.inputMode = 'numeric'
  seedInput.autocomplete = 'off'
  seedInput.spellcheck = false
  seedInput.title = 'World seed (Enter to generate)'
  seedLabel.appendChild(seedInput)

  const randomBtn = document.createElement('button')
  randomBtn.className = 'btn'
  randomBtn.type = 'button'
  randomBtn.textContent = 'Random'
  randomBtn.title = 'A new random world'

  const iconBtn = (cls: string, label: string, svg: string) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `btn icon-btn ${cls}`
    b.setAttribute('aria-label', label)
    b.title = label
    b.innerHTML = svg
    return b
  }
  const settingsBtn = iconBtn(
    'settings-btn',
    'Sun and quality (S)',
    '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.2v2.1M8 12.7v2.1M1.2 8h2.1M12.7 8h2.1M3.2 3.2l1.5 1.5M11.3 11.3l1.5 1.5M3.2 12.8l1.5-1.5M11.3 4.7l1.5-1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  )
  const helpBtn = iconBtn('help-btn', 'Help and keyboard shortcuts (?)', '<span aria-hidden="true">?</span>')
  // Globe / Map: a two-way switch (M)
  const projSwitch = document.createElement('div')
  projSwitch.className = 'proj-switch'
  projSwitch.setAttribute('role', 'radiogroup')
  projSwitch.setAttribute('aria-label', 'Projection')
  const projBtn = (label: string, title: string) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn proj-btn'
    b.textContent = label
    b.title = title
    b.setAttribute('role', 'radio')
    projSwitch.appendChild(b)
    return b
  }
  const globeBtn = projBtn('Globe', 'The world as a globe (M)')
  const mapBtn = projBtn('Map', 'The world as a flat map, Equal Earth projection (M)')
  const setProjection = (map: boolean) => {
    globeBtn.classList.toggle('active', !map)
    mapBtn.classList.toggle('active', map)
    globeBtn.setAttribute('aria-checked', String(!map))
    mapBtn.setAttribute('aria-checked', String(map))
  }
  setProjection(false)
  globeBtn.addEventListener('click', () => callbacks.onProjectionChange?.(false))
  mapBtn.addEventListener('click', () => callbacks.onProjectionChange?.(true))
  topBar.append(seedLabel, randomBtn)
  if (callbacks.onProjectionChange) topBar.append(projSwitch)
  const creditsBtn = creditsButton()
  topBar.append(settingsBtn, helpBtn, creditsBtn)
  // (the phone layout: the menu opens the rest of the bar and the view and layers, compact.ts)
  const menuBtn = iconBtn(
    'menu-btn',
    'Menu: view, layers, sun, help, credits',
    '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  )
  topBar.append(menuBtn)

  // ---------- popovers ----------
  const makePopover = (cls: string, title: string) => {
    const p = document.createElement('div')
    p.className = `panel popover ${cls} hidden`
    p.id = `popover-${++uid}`
    p.setAttribute('role', 'dialog')
    p.setAttribute('aria-label', title)
    p.tabIndex = -1
    const h = document.createElement('div')
    h.className = 'popover-title'
    h.textContent = title
    // (shown in the phone layout, where the popover is a full-screen sheet with no outside to tap)
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'popover-close'
    close.setAttribute('aria-label', `Close ${title.toLowerCase()}`)
    close.textContent = '×'
    close.addEventListener('click', () => closePopover(true))
    h.appendChild(close)
    const body = document.createElement('div')
    body.className = 'popover-body'
    p.append(h, body)
    return { p, body }
  }
  const settingsPop = makePopover('settings-pop', 'Sun and quality')
  const helpPop = makePopover('help-pop', 'Help')
  const creditsPop = makePopover('credits-pop', 'Credits')
  const menuPop = makePopover('menu-pop', 'Menu')
  const menuTools = document.createElement('div')
  menuTools.className = 'menu-tools'
  menuPop.body.appendChild(menuTools)
  menuBtn.setAttribute('aria-controls', menuPop.p.id)
  menuBtn.setAttribute('aria-expanded', 'false')
  creditsBtn.setAttribute('aria-controls', creditsPop.p.id)
  creditsBtn.setAttribute('aria-expanded', 'false')
  settingsBtn.setAttribute('aria-controls', settingsPop.p.id)
  helpBtn.setAttribute('aria-controls', helpPop.p.id)
  settingsBtn.setAttribute('aria-expanded', 'false')
  helpBtn.setAttribute('aria-expanded', 'false')
  const popovers: [HTMLElement, HTMLButtonElement][] = [
    [settingsPop.p, settingsBtn],
    [helpPop.p, helpBtn],
    [creditsPop.p, creditsBtn],
    [menuPop.p, menuBtn],
  ]
  let openPop: HTMLElement | null = null
  function closePopover(returnFocus: boolean) {
    if (!openPop) return
    const btn = popovers.find(([p]) => p === openPop)?.[1]
    openPop.classList.add('hidden')
    btn?.setAttribute('aria-expanded', 'false')
    btn?.classList.remove('active-toggle')
    openPop = null
    if (returnFocus) btn?.focus()
  }
  function togglePopover(p: HTMLElement) {
    const was = openPop === p
    closePopover(false)
    if (was) return
    if (p === helpPop.p) fillHelp()
    if (p === creditsPop.p) fillCredits(creditsPop.body)
    const btn = popovers.find(([q]) => q === p)?.[1]
    p.classList.remove('hidden')
    btn?.setAttribute('aria-expanded', 'true')
    btn?.classList.add('active-toggle')
    openPop = p
    p.focus({ preventScroll: true })
  }
  settingsBtn.addEventListener('click', () => togglePopover(settingsPop.p))
  helpBtn.addEventListener('click', () => togglePopover(helpPop.p))
  creditsBtn.addEventListener('click', () => togglePopover(creditsPop.p))
  menuBtn.addEventListener('click', () => togglePopover(menuPop.p))
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!openPop) return
      const t = e.target as Node
      if (openPop.contains(t) || popovers.some(([p, b]) => p === openPop && b.contains(t))) return
      closePopover(false)
    },
    true,
  )

  function fillHelp() {
    const body = helpPop.body
    body.replaceChildren()
    const mouse: [string, string][] = [
      ['Drag', 'Orbit the globe; on the map, pan (east-west it scrolls on around the world)'],
      ['Scroll', 'Zoom (on the map, toward the pointer)'],
      ['Click', 'Select a settlement (empty ground deselects)'],
      ['Shift-drag', 'Move the sun (or right-drag)'],
    ]
    const section = (title: string, rows: [string, string][]) => {
      const h = document.createElement('div')
      h.className = 'help-section'
      h.textContent = title
      const dl = document.createElement('dl')
      dl.className = 'help-list'
      for (const [k, d] of rows) {
        const dt = document.createElement('dt')
        for (const part of k.split(' / ')) {
          if (dt.childNodes.length) dt.append(' ')
          const kbd = document.createElement('kbd')
          kbd.textContent = part
          dt.appendChild(kbd)
        }
        const dd = document.createElement('dd')
        dd.textContent = d
        dl.append(dt, dd)
      }
      body.append(h, dl)
    }
    // (a touch screen alone: its gestures, and no keyboard sections)
    const touchOnly = window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches
    if (touchOnly) {
      section('Touch', [
        ['Drag', 'Turn the globe; on the map, pan'],
        ['Pinch', 'Zoom'],
        ['Tap', 'Select a settlement (empty ground deselects)'],
        ['Panels', 'Tap a name in the bar at the bottom; drag the bar up or down, or tap its grip'],
      ])
    } else section('Mouse', mouse)
    if (callbacks.onProjectionChange) {
      const note = document.createElement('p')
      note.className = 'help-note'
      note.textContent = 'The map (M) is the same world in the Equal Earth projection, every layer and view included. It is lit from the north-west in full daylight (Day and night shows the terminator), and the 3D towns stay on the globe: the map keeps the flat settlement markers at every zoom.'
      body.appendChild(note)
    }
    for (const g of touchOnly ? [] : (['Timeline', 'View', 'Panels'] as const)) {
      const rows = shortcutList().filter((s) => s.group === g).map((s) => [s.label, s.description] as [string, string])
      if (rows.length) section(g, rows)
    }
    // the views this history offers, as the menu groups them (V steps through them in this order)
    const h = document.createElement('div')
    h.className = 'help-section'
    h.textContent = 'Views'
    const dl = document.createElement('dl')
    dl.className = 'help-list help-views'
    for (const g of VIEW_GROUPS) {
      const names = g.modes.filter((m) => !unavailable.has(m)).map((m) => MODE_LABELS[m])
      if (!names.length) continue
      const dt = document.createElement('dt')
      dt.textContent = g.label
      const dd = document.createElement('dd')
      dd.textContent = names.join(', ')
      dl.append(dt, dd)
    }
    body.append(h, dl)
  }

  // ---------- map panel: view mode and layers ----------
  const mapPanel = document.createElement('div')
  mapPanel.className = 'panel map-panel'

  const viewRow = document.createElement('label')
  viewRow.className = 'view-row'
  const viewLabel = document.createElement('span')
  viewLabel.className = 'view-label'
  viewLabel.textContent = 'View'
  const viewSelect = document.createElement('select')
  viewSelect.className = 'view-select'
  viewSelect.title = 'What the globe and the map show (V / Shift+V)'
  for (const g of VIEW_GROUPS) {
    const og = document.createElement('optgroup')
    og.label = g.label
    for (const mode of g.modes) {
      const o = document.createElement('option')
      o.value = mode
      o.textContent = MODE_LABELS[mode]
      og.appendChild(o)
    }
    viewSelect.appendChild(og)
  }
  for (const mode of MENU_MODES.slice(VIEW_GROUPS.reduce((n, g) => n + g.modes.length, 0))) {
    const o = document.createElement('option')
    o.value = mode
    o.textContent = MODE_LABELS[mode]
    viewSelect.appendChild(o)
  }
  viewSelect.value = initial.viewMode
  viewSelect.addEventListener('change', () => callbacks.onViewModeChange(viewSelect.value as ViewMode))
  viewRow.append(viewLabel, viewSelect)

  const layersHead = document.createElement('button')
  layersHead.type = 'button'
  layersHead.className = 'layers-head'
  layersHead.title = 'Show or hide the layer toggles (L)'
  const layersTitle = document.createElement('span')
  layersTitle.className = 'layers-title'
  layersTitle.textContent = 'Layers'
  const layersCount = document.createElement('span')
  layersCount.className = 'layers-count'
  const layersCaret = document.createElement('span')
  layersCaret.className = 'caret'
  layersCaret.setAttribute('aria-hidden', 'true')
  layersCaret.textContent = '▾'
  layersHead.append(layersTitle, layersCount, layersCaret)
  const layersBody = document.createElement('div')
  layersBody.className = 'layers-body'
  layersBody.id = `layers-${++uid}`
  layersHead.setAttribute('aria-controls', layersBody.id)

  const groups = new Map<LayerGroup, HTMLElement>()
  for (const g of ['nature', 'people', 'movement'] as const) {
    const fs = document.createElement('fieldset')
    fs.className = `layer-group ${g}`
    const lg = document.createElement('legend')
    lg.textContent = GROUP_LABELS[g]
    const grid = document.createElement('div')
    grid.className = 'layer-grid'
    fs.append(lg, grid)
    layersBody.appendChild(fs)
    groups.set(g, grid)
  }
  mapPanel.append(viewRow, layersHead, layersBody)

  const toggles: HTMLInputElement[] = []
  const syncCount = () => {
    // (toggles of the other projection are hidden: not counted)
    const shown = toggles.filter((t) => !t.closest('.layer-toggle')?.classList.contains('hidden'))
    const on = shown.filter((t) => t.checked).length
    layersCount.textContent = `${on} of ${shown.length} on`
  }
  function addLayerToggle(t: LayerToggle): HTMLInputElement {
    const row = document.createElement('label')
    row.className = 'layer-toggle'
    if (t.title) row.title = t.title
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = t.checked
    box.dataset.layer = t.key
    const text = document.createElement('span')
    text.textContent = t.label
    row.append(box, text)
    row.dataset.order = String(LAYER_ORDER[t.key] ?? 99)
    const grid = groups.get(t.group)!
    const before = [...grid.children].find((c) => Number((c as HTMLElement).dataset.order) > (LAYER_ORDER[t.key] ?? 99))
    grid.insertBefore(row, before ?? null)
    box.addEventListener('change', () => {
      saveLayerPref(t.key, box.checked)
      syncCount()
      t.onChange(box.checked)
    })
    toggles.push(box)
    syncCount()
    return box
  }

  addLayerToggle({ key: 'rivers', label: 'Rivers', group: 'nature', checked: initial.rivers, title: 'Rivers, on the Terrain view', onChange: (s) => callbacks.onRiversToggle(s) })
  addLayerToggle({ key: 'clouds', label: 'Clouds', group: 'nature', checked: initial.clouds, title: 'Clouds over the globe, on the Terrain view', onChange: (s) => callbacks.onCloudsToggle(s) })
  if (callbacks.onLabelsToggle) {
    const cb = callbacks.onLabelsToggle
    addLayerToggle({ key: 'labels', label: 'Labels', group: 'nature', checked: initial.labels ?? true, title: 'Names of places', onChange: (s) => cb(s) })
  }
  addLayerToggle({ key: 'markers', label: 'Settlements', group: 'people', checked: initial.markers, title: 'A marker for every settlement, larger the more people live there', onChange: (s) => callbacks.onMarkersToggle(s) })
  addLayerToggle({ key: 'buildings', label: 'Buildings', group: 'people', checked: initial.buildings ?? true, title: '3D towns, farms and ships up close', onChange: (s) => callbacks.onBuildingsToggle?.(s) })
  addLayerToggle({ key: 'farmland', label: 'Farmland', group: 'people', checked: initial.farmland, title: 'Fields and pastures, on the Terrain view', onChange: (s) => callbacks.onFarmlandToggle(s) })
  addLayerToggle({ key: 'structures', label: 'Structures', group: 'people', checked: initial.structures, title: 'Ports, dams and reservoirs', onChange: (s) => callbacks.onStructuresToggle(s) })
  addLayerToggle({ key: 'journeys', label: 'Journeys', group: 'movement', checked: initial.journeys, title: 'Settlers and migrants on the move', onChange: (s) => callbacks.onJourneysToggle(s) })
  const tradeBox = addLayerToggle({
    key: 'trade',
    label: 'Trade',
    group: 'movement',
    checked: initial.trade ?? true,
    title: 'Trade routes and merchants',
    onChange: (s) => {
      legend.classList.toggle('hidden', !s)
      callbacks.onTradeToggle?.(s)
    },
  })
  addLayerToggle({ key: 'roads', label: 'Roads', group: 'movement', checked: initial.roads ?? true, title: 'Roads and bridges', onChange: (s) => callbacks.onRoadsToggle?.(s) })
  // what the merchants carry, while Trade is on: only the goods actually traded in this history
  // (setGoodsInUse, called from main.ts once it has one), so the legend does not grow to every
  // defined good (GOOD_NAMES can have more entries than any one world ever uses)
  const legend = document.createElement('div')
  legend.className = 'goods-legend'
  legend.setAttribute('aria-label', 'Goods carried by merchants')
  function renderLegend(goods: readonly number[]) {
    legend.replaceChildren()
    for (const g of goods) {
      const item = document.createElement('span')
      const dot = document.createElement('span')
      dot.className = 'good-dot'
      dot.style.background = GOOD_COLORS[g] ?? '#888'
      item.append(dot, GOOD_NAMES[g] ?? 'goods')
      legend.appendChild(item)
    }
  }
  renderLegend(GOOD_NAMES.map((_, g) => g))
  legend.classList.toggle('hidden', !tradeBox.checked)
  groups.get('movement')!.parentElement!.appendChild(legend)

  // (first visit: open on a tall window; on a short one the list starts folded, L opens it, so the
  // panels under it fit without the column scrolling)
  let layersOpen = loadFlag(LAYERS_OPEN_KEY, window.innerHeight >= 960)
  const syncLayersOpen = () => {
    mapPanel.classList.toggle('layers-collapsed', !layersOpen)
    layersHead.setAttribute('aria-expanded', String(layersOpen))
  }
  syncLayersOpen()
  const toggleLayers = () => {
    layersOpen = !layersOpen
    saveFlag(LAYERS_OPEN_KEY, layersOpen)
    syncLayersOpen()
    relayout()
  }
  layersHead.addEventListener('click', toggleLayers)

  // ---------- readout, loading ----------
  const readoutPanel = document.createElement('div')
  readoutPanel.className = 'panel readout-panel hidden'
  readoutPanel.setAttribute('aria-live', 'off')

  const loadingOverlay = document.createElement('div')
  loadingOverlay.className = 'loading hidden'
  loadingOverlay.textContent = 'generating world…'

  // ---------- columns ----------
  const left = document.createElement('div')
  left.className = 'side-column left'
  left.appendChild(topBar)
  const right = document.createElement('div')
  right.className = 'side-column right'
  right.appendChild(mapPanel)
  // (the panels' header summaries are cut short in a narrow column: their whole text on hover)
  titleWhenCut(right, '.gp-count, .pp-count, .fp-count, .chr-count')
  const bottom = document.createElement('div')
  bottom.className = 'bottom-slot'

  // the view legends' place in the phone layout (top right, under the bar: sheet.ts moves them here)
  const legends = document.createElement('div')
  legends.className = 'compact-legends'

  root.append(left, right, bottom, legends, readoutPanel, settingsPop.p, helpPop.p, creditsPop.p, menuPop.p, loadingOverlay)
  container.appendChild(root)

  // ---------- the phone layout (compact.ts) ----------
  // the bar keeps the seed, Random, Globe / Map and the menu; the sun, help and credits buttons and the view and
  // layers panel go into the menu sheet; the right column becomes the bottom sheet (sheet.ts)
  const syncCompactBar = (compact: boolean) => {
    if (compact) {
      for (const b of [settingsBtn, helpBtn, creditsBtn]) relocateNode(b, menuTools)
      relocateNode(mapPanel, menuPop.body)
    } else {
      if (openPop === menuPop.p) closePopover(false)
      for (const b of [settingsBtn, helpBtn, creditsBtn, mapPanel]) restoreNode(b)
    }
  }
  syncCompactBar(isCompact())
  onCompactChange(syncCompactBar)
  const sheet = createSheet({ root, column: right, left, bottom, topBar, legends, onLayout: () => queueRelayout() })

  // A control clicked with the mouse lets go of the focus, so Space goes back to play /
  // pause; one reached with the keyboard keeps it (and its focus ring).
  let pointerToggle = false
  root.addEventListener('pointerdown', () => (pointerToggle = true), true)
  root.addEventListener('keydown', () => (pointerToggle = false), true)
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button')
    if (b && e.detail > 0) b.blur()
  })
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement
    if (pointerToggle && t.type === 'checkbox') t.blur()
  })

  // The columns stop above the timeline when they would reach under it, and the left one
  // keeps clear of the hover readout. Measured on resize and when panels change size only.
  const GAP = 10
  /** Left edge the timeline keeps right of when it moves left: the hover readout's usual width (16 px in, about 200 wide) and a gap. */
  const READOUT_CLEAR = 16 + 200 + GAP
  let shiftedTo = ''
  function relayout() {
    if (isCompact()) {
      compactRelayout()
      return
    }
    // the timeline moves left out from under the right column when there is room for it there (at 1200 px wide it
    // would reach under the column's edge by a few pixels, and the column would then stop above it for nothing)
    {
      const rw = right.getBoundingClientRect().width
      const w = bottom.offsetWidth
      const colLeft = window.innerWidth - 16 - rw - GAP
      const centred = (window.innerWidth - w) / 2
      // (not over the hover readout's corner, bottom left: READOUT_CLEAR)
      const x = rw > 0 && w > 0 && centred + w > colLeft && colLeft - w >= READOUT_CLEAR ? `${Math.round(colLeft - w / 2)}px` : ''
      if (x !== shiftedTo) {
        shiftedTo = x
        bottom.style.left = x
      }
    }
    const tl = bottom.getBoundingClientRect()
    const reserveTimeline = tl.height > 0 ? window.innerHeight - tl.top + GAP - 16 : 0
    const lr = left.getBoundingClientRect()
    const rr = right.getBoundingClientRect()
    const leftUnder = tl.height > 0 && 16 + lr.width + GAP > tl.left
    const rightUnder = tl.height > 0 && window.innerWidth - 16 - rr.width - GAP < tl.right
    root.style.setProperty('--left-reserve', `${Math.max(leftUnder ? reserveTimeline : 0, 104)}px`)
    root.style.setProperty('--right-reserve', `${rightUnder ? reserveTimeline : 0}px`)
    // The top bar sits at the top of the left column and is far wider than the rest of it is
    // ever tall for: using the whole left column's width (lr.width, which is the top bar's
    // width whenever the inspector is closed) as a left inset would reserve that width for
    // the full window height, when really only a strip at the very top (the top bar's own
    // height) needs keeping clear there. So: `top` comes from the top bar's height, and
    // `left` comes only from whatever sits below it in the column (the inspector, once a
    // settlement is selected; 0 when it is closed).
    const tbRect = topBar.getBoundingClientRect()
    let belowTopBar = 0
    for (const child of left.children) {
      if (child === topBar) continue
      const r = (child as HTMLElement).getBoundingClientRect()
      if (r.width > 0) belowTopBar = Math.max(belowTopBar, r.right)
    }
    setFreeViewportInset({
      left: belowTopBar > 0 ? belowTopBar + GAP : 0,
      right: rr.width > 0 ? window.innerWidth - rr.left + GAP : 0,
      top: tbRect.height > 0 ? tbRect.bottom + GAP : 0,
      bottom: tl.height > 0 ? window.innerHeight - tl.top + GAP : 0,
    })
  }
  /**
   * The phone layout's free rect: under the top bar, above the timeline as it sits over the sheet at rest (the
   * sheet raised covers the view rather than moving it), and on a phone on its side left of the sheet's column.
   */
  function compactRelayout() {
    if (shiftedTo) {
      shiftedTo = ''
      bottom.style.left = ''
    }
    root.style.setProperty('--left-reserve', '0px')
    root.style.setProperty('--right-reserve', '0px')
    sheet.measure()
    const tb = topBar.getBoundingClientRect()
    // (what sits under the bar keeps clear of it: the legends, the pick hints, the town card; compact.css)
    document.documentElement.style.setProperty('--compact-top', `${Math.round(tb.bottom + 4)}px`)
    const tlH = bottom.offsetHeight
    const landscape = isCompactLandscape()
    const colW = landscape ? right.getBoundingClientRect().width : 0
    setFreeViewportInset({
      left: 0,
      right: colW > 0 ? colW + GAP : 0,
      top: tb.height > 0 ? tb.bottom + GAP : 0,
      bottom: (tlH > 0 ? tlH : 0) + (landscape ? 0 : sheet.peekHeight()) + GAP,
    })
  }
  let relayoutQueued = false
  const queueRelayout = () => {
    if (relayoutQueued) return
    relayoutQueued = true
    requestAnimationFrame(() => {
      relayoutQueued = false
      relayout()
    })
  }
  window.addEventListener('resize', queueRelayout)
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(queueRelayout)
    ro.observe(bottom)
    ro.observe(left)
    ro.observe(right)
  }
  queueRelayout()

  // ---------- seed ----------
  function submitSeed() {
    const parsed = Number.parseInt(seedInput.value, 10)
    if (Number.isFinite(parsed)) callbacks.onSeedSubmit(parsed)
  }
  seedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitSeed()
  })
  seedInput.addEventListener('blur', submitSeed)
  randomBtn.addEventListener('click', () => callbacks.onRandomSeed())

  // ---------- shortcuts ----------
  addShortcut({
    keys: ['Escape'],
    label: 'Esc',
    description: 'Close a popup, else deselect',
    group: 'Panels',
    run: () => {
      if (!openPop) return false
      closePopover(true)
    },
  })
  addShortcut({ keys: ['l', 'L'], label: 'L', description: 'Show or hide the layers', group: 'Panels', run: () => toggleLayers() })
  addShortcut({ keys: ['s', 'S'], label: 'S', description: 'Sun and quality settings', group: 'Panels', run: () => togglePopover(settingsPop.p) })
  addShortcut({ keys: ['j', 'J'], label: 'J', description: 'Credits and licence', group: 'Panels', run: () => togglePopover(creditsPop.p) })
  addShortcut({ keys: ['?'], label: '?', description: 'This help', group: 'Panels', run: () => togglePopover(helpPop.p) })
  const unavailable = new Set<ViewMode>()
  const stepMode = (dir: number) => {
    let i = MENU_MODES.indexOf(viewSelect.value as ViewMode)
    for (let k = 0; k < MENU_MODES.length; k++) {
      i = (i + dir + MENU_MODES.length) % MENU_MODES.length
      if (!unavailable.has(MENU_MODES[i])) break
    }
    callbacks.onViewModeChange(MENU_MODES[i])
  }
  addShortcut({ keys: ['v', 'V'], shift: false, label: 'V / Shift+V', description: 'Next / previous view', group: 'View', run: () => stepMode(1) })
  addShortcut({ keys: ['v', 'V'], shift: true, label: 'V / Shift+V', description: 'Next / previous view', group: 'View', run: () => stepMode(-1) })

  return {
    root,
    left,
    right,
    bottom,
    settings: settingsPop.body,
    setGenerating(on: boolean) {
      loadingOverlay.classList.toggle('hidden', !on)
    },
    setReadout(r: Readout | null) {
      if (!r) {
        readoutPanel.classList.add('hidden')
        return
      }
      readoutPanel.classList.remove('hidden')
      readoutPanel.innerHTML = `
        <div class="readout-biome">${BIOME_NAMES[r.biome] ?? 'Unknown'}${r.lake ? '<span class="readout-tag">lake</span>' : ''}</div>
        ${r.places ? `<div class="readout-places">${escapeHtml(r.places)}</div>` : ''}
        <div class="readout-row">Elevation <span>${r.elevation.toFixed(2)}</span></div>
        <div class="readout-row">Temperature <span>${r.temperature.toFixed(2)}</span></div>
        <div class="readout-row">Rainfall <span>${r.rainfall.toFixed(2)}</span></div>
      `
    },
    setSeed(seed: number) {
      seedInput.value = String(seed)
    },
    setViewMode(mode: ViewMode) {
      viewSelect.value = mode
    },
    addLayerToggle,
    setViewModeAvailable(mode: ViewMode, available: boolean) {
      if (available) unavailable.delete(mode)
      else unavailable.add(mode)
      for (const o of viewSelect.options) if (o.value === mode) o.hidden = !available
      // (a group whose views are all unavailable is hidden with them)
      for (const og of viewSelect.querySelectorAll('optgroup')) (og as HTMLElement).hidden = [...og.querySelectorAll('option')].every((o) => o.hidden)
    },
    relayout: queueRelayout,
    setProjection(map: boolean) {
      setProjection(map)
      syncCount()
    },
    setGoodsInUse(goods: readonly number[]) {
      renderLegend(goods)
    },
  }
}
