// Ideas in the UI: the "Ideas" panel (right column, collapsed by default: a tab for the catalogue by era, each known idea with
// its year, its first people and a bar of how many peoples hold it now, the ideas not yet conceived only counted, so the list does
// not spoil the future; a tab for the peoples, a strip of pips per people for what it holds now, its own gold and the received in
// their channel's colour), the selected idea's detail (what it does, what it needs, who first conceived it, where and when, its
// journey from people to people, who refused it and who lost it, "Play its spread"), the ideas section of the inspector, the map
// layer (render/ideas.ts), the Ideas view (peoples' lands by the number of ideas held, or by when they took up the selected one)
// and its legend, the hover readout, and the ideas lines of the Peoples panel and its technology bars.
//
// Selecting an idea (idea=<key>) flies to where it was first conceived. The Ideas layer toggle (ideas=0) hides the map marks and
// links. Everything is a function of the year: the panel, the detail and the inspector are rewritten only when the year crosses a
// row of the ideas table (or a refusal), the snapshot or the selection changes; while the panel is collapsed only its header is.

import * as THREE from 'three'
import { IdeaHow, type History, type World } from '../contract.ts'
import { buildIdeasLayer, IDEA_RAMP_CSS, ideaRamp, type IdeasLayer } from '../render/ideas.ts'
import { ViewMode } from '../render/palette.ts'
import type { GlobeMesh } from '../render/globe.ts'
import { requestRender } from '../render/invalidate.ts'
import { settlementName } from './format.ts'
import { namesEpoch } from './renamingData.ts'
import type { PeoplesData } from './peoplesData.ts'
import {
  adoptionYears, ERA_LABELS, heldBy, heldCounts, holdersAt, HOW_CSS, HOW_SHORT, ideaBehindAdvance, ideaRowsUpTo, ideasOf, isKnown, KIND_CSS, KIND_WORDS, knownCount, latestKnown,
  rowsUpTo, upTo, type IdeasData,
} from './ideasData.ts'
import { channelPhrase, conceivedHere, lossShort, refusalShort } from './ideasFormat.ts'
import { setPeopleIdeasNote, setPeopleTechNote } from './peoplesPanel.ts'
import { loadFlag, loadPref, panelToggled, registerPanel, saveFlag, savePref } from './panels.ts'
import { addShortcut } from './shortcuts.ts'
import { loadLayerPrefs, type LayerToggle } from './overlay.ts'
import './ideas.css'

export interface IdeasBuilt {
  data: IdeasData
  layer: IdeasLayer
}

export interface IdeasViewDeps {
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
  addLayerToggle?(t: LayerToggle): HTMLInputElement
  setViewModeAvailable?(mode: ViewMode, available: boolean): void
}

export interface IdeasView {
  setWorld(world: World): void
  build(world: World, h: History, maxPopulation: number): IdeasBuilt | null
  disposeBuilt(b: IdeasBuilt | null | undefined): void
  /** `peoples`: the peoples' names, colours and living settlements (the Peoples tab). */
  commit(b: IdeasBuilt | null, extend: boolean, peoples: PeoplesData | null): void
  setViewMode(mode: ViewMode): void
  showSettlement(id: number): void
  setKnownMask(cellYear: Float32Array | null): void
  setMasked(on: boolean): void
  setYield(near: number, far: number): void
  tick(year: number, s0: number, pulseYears: number, effect: number, playing: boolean, camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number): void
  /** On the Ideas view, the land's people and its ideas ("The Leko: 27 ideas"); '' for none. */
  describeCell(cell: number): string
}

const TABS = ['Ideas', 'Peoples'] as const
/** The Ideas view's ramp over the ideas held (0 none .. 1 the most anyone holds in the run), sRGB 0..255. */
const COUNT_STOPS: readonly (readonly [number, number, number, number])[] = [
  [0, 52, 56, 64],
  [0.25, 58, 92, 118],
  [0.5, 64, 150, 150],
  [0.75, 150, 200, 110],
  [1, 255, 206, 92],
]
const UNSETTLED = [42, 46, 48] as const
const NOT_YET = [64, 68, 74] as const
const LOST = [104, 92, 84] as const
function countRamp(x: number, out: Uint8Array, o: number) {
  const t = Math.max(0, Math.min(1, x))
  let k = 1
  while (k < COUNT_STOPS.length - 1 && t > COUNT_STOPS[k][0]) k++
  const a = COUNT_STOPS[k - 1], b = COUNT_STOPS[k]
  const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0])
  out[o] = a[1] + (b[1] - a[1]) * f
  out[o + 1] = a[2] + (b[2] - a[2]) * f
  out[o + 2] = a[3] + (b[3] - a[3]) * f
}
const cssOf = (c: ArrayLike<number>) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`

export function createIdeasView(deps: IdeasViewDeps): IdeasView {
  // ---------- panel ----------
  const root = document.createElement('div')
  root.className = 'panel ideas hidden'
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'gp-head'
  head.title = 'Show or hide ideas: inventions and how they travelled (I)'
  const title = document.createElement('span')
  title.className = 'gp-title'
  title.textContent = 'Ideas'
  const count = document.createElement('span')
  count.className = 'gp-count'
  const caret = document.createElement('span')
  caret.className = 'caret'
  caret.setAttribute('aria-hidden', 'true')
  head.append(title, count, caret)
  const body = document.createElement('div')
  body.className = 'gp-body'
  body.id = 'ideas-body'
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
  const detail = document.createElement('div')
  detail.className = 'gp-detail hidden'
  const pane = document.createElement('div')
  pane.className = 'gp-pane'
  body.append(tabs, detail, pane)
  root.append(head, body)
  deps.right.insertBefore(root, deps.right.querySelector('.chronicle'))

  let collapsed = loadFlag('worldseed.ideas.collapsed', true)
  let tab = Math.max(0, Math.min(TABS.length - 1, Number(loadPref('worldseed.ideas.tab')) || 0))
  const syncCollapsed = () => {
    root.classList.toggle('collapsed', collapsed)
    head.setAttribute('aria-expanded', String(!collapsed))
  }
  syncCollapsed()
  const toggleCollapsed = () => {
    collapsed = !collapsed
    saveFlag('worldseed.ideas.collapsed', collapsed)
    syncCollapsed()
    panelToggled('ideas', !collapsed)
    force()
    if (!collapsed) window.setTimeout(() => root.scrollIntoView({ block: 'nearest' }), 80)
  }
  head.addEventListener('click', toggleCollapsed)
  registerPanel('ideas', root, () => !collapsed, () => { if (!collapsed) toggleCollapsed() })
  const syncTabs = () => tabBtns.forEach((b, i) => {
    b.classList.toggle('active', i === tab)
    b.setAttribute('aria-selected', String(i === tab))
  })
  syncTabs()

  // ---------- Ideas legend (under the map panel) ----------
  const legend = document.createElement('div')
  legend.className = 'panel sp-legend ip-legend hidden'
  {
    const mapPanel = deps.right.querySelector('.map-panel')
    deps.right.insertBefore(legend, mapPanel ? mapPanel.nextSibling : deps.right.firstChild)
  }
  const legendTitle = document.createElement('div')
  legendTitle.className = 'sp-legend-title'
  const legendList = document.createElement('div')
  legendList.className = 'sp-legend-list'
  const legendNote = document.createElement('div')
  legendNote.className = 'ip-legend-note'
  legend.append(legendTitle, legendList, legendNote)

  // ---------- inspector section ----------
  const slot = deps.inspectorSlot
  slot.classList.add('hidden')

  // ---------- state ----------
  const params = new URLSearchParams(window.location.search)
  let pendingKey: string | null = params.get('idea')
  let world: World | null = null
  let data: IdeasData | null = null
  let peoples: PeoplesData | null = null
  let layer: IdeasLayer | null = null
  let toggle: HTMLInputElement | null = null
  const prefs = loadLayerPrefs()
  let layerOn = params.has('ideas') ? params.get('ideas') !== '0' : (prefs['ideas'] ?? true)
  if (!layerOn && !params.has('ideas')) deps.setUrlParam('ideas', '0')
  let viewMode: ViewMode = ViewMode.Terrain
  let knownMask: Float32Array | null = null
  let sel = -1
  let inspected = -1
  let year = 0
  let s0 = 0
  let shownPaneKey = ''
  let shownDetailKey = ''
  let shownInspKey = ''
  let shownCountKey = -1
  let shownViewKey = ''
  let shownLegendKey = ''
  let viewRgb: Uint8Array | null = null
  /** The most ideas any living people holds at the year (the Ideas view's scale: the leader brightest), and each land cell's index in landCells (-1). */
  let maxHeld = 1
  let landIndex: Int32Array | null = null
  /** Rows by the year last looked at (rowsUpTo), the snapshot, and whether anything else changed since. */
  let tickedRows = -1
  let tickedS0 = -1
  let dirty = true
  /** renaming: the names in force last shown (namesEpoch). */
  let shownNames = -1
  let scratch = new Int32Array(0)
  let adoptY = new Int16Array(0), lostY = new Int16Array(0)
  /** The camera of the last frame (for the perf=1 helpers only). */
  let lastCamera: THREE.Camera | null = null
  /** Main-thread milliseconds of the last build (the index, the layer), for the perf=1 helpers. */
  let buildMs = { data: 0, layer: 0 }
  const force = () => {
    shownPaneKey = shownDetailKey = shownInspKey = shownViewKey = shownLegendKey = ''
    shownCountKey = -1
    dirty = true
    requestRender()
  }

  const H = () => data!.history
  const sname = (id: number) => (data && id >= 0 && id < data.N ? settlementName(data.history, id) : '')
  const pname = (p: number) => (data && p >= 0 && p < data.P ? data.history.peoples[p]?.name ?? '' : '')
  const iname = (i: number) => data?.ideas[i]?.name ?? ''
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const yi = () => Math.floor(year + 1e-6)
  const settLink = (id: number) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'gp-link'
    b.dataset.sid = String(id)
    b.textContent = sname(id)
    return b
  }
  const ideaLink = (i: number) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'gp-link'
    b.dataset.idea = String(i)
    b.textContent = iname(i)
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
  const dot = (color: string, cls = 'gp-dot') => {
    const s = document.createElement('span')
    s.className = cls
    s.style.background = color
    return s
  }
  const note = (text: string) => el('div', 'gp-note', text)
  const living = (p: number) => !peoples || peoples.alive[Math.min(H().snapshotCount - 1, s0) * peoples.count + p] > 0

  function syncLayer() {
    layer?.setShown(layerOn)
    requestRender()
  }

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const tb = t.closest('[data-tab]') as HTMLElement | null
    if (tb) {
      tab = Number(tb.dataset.tab)
      savePref('worldseed.ideas.tab', String(tab))
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
    const it = t.closest('[data-idea]') as HTMLElement | null
    if (it) {
      const i = Number(it.dataset.idea)
      if (i === sel && it.classList.contains('gp-row')) select(-1, false)
      else select(i, true)
      return
    }
    if (t.closest('.gp-close')) select(-1, false)
  })

  /** Where idea i was first conceived (a cell), or -1. */
  function originCell(i: number): number {
    if (!data || i < 0) return -1
    const s = data.ideas[i].firstSettlement
    return s >= 0 && s < data.N ? data.history.settlements[s].cell : -1
  }

  function select(i: number, fly: boolean) {
    if (!data || !(i >= 0 && i < data.I)) i = -1
    sel = i
    deps.setUrlParam('idea', i >= 0 ? data!.ideas[i].key : null)
    layer?.setSelected(i)
    if (fly && i >= 0 && isKnown(data!, i, year)) {
      const c = originCell(i)
      if (c >= 0) deps.flyToCell(c)
    }
    force()
  }

  // ---------- header ----------
  function updateCount() {
    if (!data) return
    const dd = data
    const k = upTo(dd.conceptionYears, yi())
    if (k === shownCountKey) return
    shownCountKey = k
    const n = knownCount(dd, year)
    const last = latestKnown(dd, year)
    count.textContent = n > 0 ? `${n} of ${dd.I} known · latest: ${iname(last)}` : 'none known yet'
  }

  // ---------- panel content ----------
  function row(i: number, ...cells: (string | Node)[]) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'gp-row' + (i === sel ? ' selected' : '')
    b.dataset.idea = String(i)
    b.append(...cells)
    return b
  }

  function updatePane() {
    if (!data || collapsed) return
    const dd = data
    const rows = rowsUpTo(dd, year)
    const key = `${tab}:${rows}:${sel}:${tab === 1 ? s0 : -1}:${namesEpoch()}`
    if (key === shownPaneKey) return
    shownPaneKey = key
    pane.replaceChildren()
    if (tab === 0) {
      let livingN = 0
      for (let p = 0; p < dd.P; p++) if (living(p)) livingN++
      livingN = Math.max(1, livingN)
      for (let e = 0; e < ERA_LABELS.length; e++) {
        const ids: number[] = []
        let unknown = 0
        for (let i = 0; i < dd.I; i++) {
          if (dd.era[i] !== e) continue
          if (isKnown(dd, i, year)) ids.push(i)
          else unknown++
        }
        if (!ids.length && !unknown) continue
        pane.append(el('div', 'gp-cap', ERA_LABELS[e]))
        ids.sort((a, b) => dd.ideas[a].firstYear - dd.ideas[b].firstYear || a - b)
        for (const i of ids) {
          const x = dd.ideas[i]
          const n = holdersAt(dd, i, year)
          const bar = el('span', 'gp-qbar ip-bar')
          const fill = document.createElement('span')
          fill.style.width = `${Math.round((100 * Math.min(livingN, n)) / livingN)}%`
          bar.append(fill)
          const r = row(i, dot(KIND_CSS[x.kind] ?? '#ccc'), span('gp-name', x.name), span('gp-sub', `${x.firstYear} · the ${pname(x.firstPeople)}`), bar, span('gp-num', String(n), 'Peoples holding it now'))
          if (n === 0) r.classList.add('ended')
          r.title = `${cap(x.name)} (${KIND_WORDS[x.kind] ?? ''}): first conceived by the ${pname(x.firstPeople)} at ${sname(x.firstSettlement)} in ${x.firstYear}; held now by ${n} of ${livingN} ${livingN === 1 ? 'people' : 'peoples'}` + (n === 0 ? ' (forgotten)' : '')
          pane.append(r)
        }
        if (unknown) pane.append(el('div', 'gp-line gp-faint ip-unknown', `${unknown} not yet known`))
      }
      return
    }
    // peoples: what each holds now (own gold, received in the channel's colour, lost grey), in catalogue order of the known ideas
    if (scratch.length !== dd.I) scratch = new Int32Array(dd.I)
    const known: number[] = []
    for (let i = 0; i < dd.I; i++) if (isKnown(dd, i, year)) known.push(i)
    known.sort((a, b) => dd.ideas[a].firstYear - dd.ideas[b].firstYear || a - b)
    if (!known.length) {
      pane.append(note('No idea has been conceived yet.'))
      return
    }
    const legendRow = el('div', 'ip-key')
    legendRow.append(dot(HOW_CSS[IdeaHow.Invented], 'ip-pip own'), ' their own ', dot(HOW_CSS[IdeaHow.Trade], 'ip-pip'), ' received (by how) ', dot('transparent', 'ip-pip lost'), ' lost')
    pane.append(legendRow)
    const order = Array.from({ length: dd.P }, (_, p) => p).filter((p) => living(p))
    const held = new Map<number, number>()
    for (const p of order) held.set(p, heldCounts(dd, p, year, scratch).held)
    order.sort((a, b) => held.get(b)! - held.get(a)! || a - b)
    for (const p of order) {
      const c = heldCounts(dd, p, year, scratch)
      const wrap = el('div', 'ip-people')
      const line = el('div', 'ip-people-line', dot(peoples?.css[p] ?? '#888', 'pp-swatch'), span('gp-name', pname(p)), span('gp-sub', `${c.own} own · ${c.held - c.own} received`), span('gp-num', String(c.held), 'Ideas held now'))
      const strip = el('div', 'ip-strip')
      for (const i of known) {
        const k = scratch[i]
        const pip = document.createElement('span')
        pip.dataset.idea = String(i)
        if (k >= 0) {
          const how = dd.A.how[k]
          pip.className = 'ip-pip' + (how === IdeaHow.Invented ? ' own' : '')
          pip.style.background = HOW_CSS[how]
          pip.title = how === IdeaHow.Invented ? `${cap(iname(i))}: conceived by the ${pname(p)} in ${dd.A.year[k]}` : `${cap(iname(i))}: since ${dd.A.year[k]}, ${channelPhrase(dd.history, how, dd.A.source[k], dd.A.from[k])}`
        } else if (k === -2) {
          pip.className = 'ip-pip lost'
          pip.title = `${cap(iname(i))}: lost`
        } else {
          pip.className = 'ip-pip none'
          pip.title = `${cap(iname(i))}: not held`
        }
        if (i === sel) pip.classList.add('sel')
        strip.append(pip)
      }
      wrap.append(line, strip)
      pane.append(wrap)
    }
  }

  function updateDetail() {
    if (!data || collapsed || sel < 0) {
      if (!detail.classList.contains('hidden')) detail.classList.add('hidden')
      shownDetailKey = ''
      return
    }
    const dd = data
    const h = dd.history
    const i = sel
    const x = dd.ideas[i]
    const rowsBy = ideaRowsUpTo(dd, i, year)
    let refusedBy = 0
    for (const r of dd.refusals) if (r.idea === i && r.year <= yi()) refusedBy++
    const key = `${i}:${rowsBy}:${refusedBy}:${s0}:${namesEpoch()}`
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
    const known = isKnown(dd, i, year)
    detail.append(el('div', 'gp-d-title', dot(KIND_CSS[x.kind] ?? '#ccc'), cap(x.name), close))
    line(`${cap(x.effect)} (${KIND_WORDS[x.kind] ?? 'an idea'})`)
    if (x.prerequisites.length) {
      const l = line('Needs ')
      x.prerequisites.forEach((q, j) => {
        if (j) l.append(j === x.prerequisites.length - 1 ? ' and ' : ', ')
        l.append(ideaLink(q))
      })
    } else line('Needs nothing before it').classList.add('gp-faint')
    if (!known) {
      line(x.firstYear >= 0 ? `Not yet known to anyone in ${yi()}` : 'Never conceived in this history').classList.add('gp-faint')
      return
    }
    // origins, in order
    const lo = dd.ideaOff[i]
    let origin = 0
    for (let j = lo; j < lo + rowsBy; j++) {
      const k = dd.ideaRows[j]
      if (dd.A.how[k] !== IdeaHow.Invented) continue
      const q = dd.A.people[k]
      if (origin++ === 0) line('First conceived by the ', span('ip-pn', pname(q)), ' at ', settLink(dd.A.via[k]), ` in ${dd.A.year[k]}`)
      else line('Again, independently, by the ', span('ip-pn', pname(q)), ' at ', settLink(dd.A.via[k]), ` in ${dd.A.year[k]}`)
    }
    let livingN = 0, without = 0
    const lacking: string[] = []
    if (adoptY.length !== dd.P) {
      adoptY = new Int16Array(dd.P)
      lostY = new Int16Array(dd.P)
    }
    adoptionYears(dd, i, adoptY, lostY)
    for (let p = 0; p < dd.P; p++) {
      if (!living(p)) continue
      livingN++
      const holds = adoptY[p] >= 0 && adoptY[p] <= yi() && !(lostY[p] >= 0 && lostY[p] <= yi())
      if (!holds) {
        without++
        lacking.push(pname(p))
      }
    }
    line(`Held by ${livingN - without} of ${livingN} living ${livingN === 1 ? 'people' : 'peoples'} in ${yi()}`).classList.add('ip-hot')
    // play its spread, and the ramp of when
    const play = document.createElement('button')
    play.type = 'button'
    play.className = 'btn ip-play'
    const from = Math.max(0, x.firstYear - 5)
    play.dataset.play = String(from)
    play.textContent = '▶ Play its spread'
    play.title = `Jump to ${from} and play`
    const rampBar = el('span', 'ip-ramp')
    rampBar.style.background = IDEA_RAMP_CSS
    detail.append(el('div', 'ip-play-row', play, el('span', 'ip-ramp-wrap', span('', String(x.firstYear)), rampBar, span('', String(Math.max(x.firstYear, dd.lastYear[i]))))))
    // its journey, in order
    detail.append(el('div', 'gp-cap', 'Its journey'))
    const list = el('div', 'ip-journey')
    const shown = Math.min(rowsBy, 40)
    for (let j = lo; j < lo + shown; j++) {
      const k = dd.ideaRows[j]
      const how = dd.A.how[k]
      const q = dd.A.people[k]
      const it = el('div', 'ip-step', span('ip-y', String(dd.A.year[k])), dot(HOW_CSS[how], 'ip-pip' + (how === IdeaHow.Invented ? ' own' : how === IdeaHow.Lost ? ' lost' : '')))
      const text = el('span', 'ip-step-text')
      if (how === IdeaHow.Invented) text.append('conceived by the ', span('ip-pn', pname(q)), ' at ', settLink(dd.A.via[k]))
      else if (how === IdeaHow.Lost) {
        text.append('lost by the ', span('ip-pn', pname(q)), ` (${lossShort(dd.lossCause[k])})`)
        it.classList.add('lost')
      } else {
        text.append('the ', span('ip-pn', pname(q)), `, ${channelPhrase(h, how, dd.A.source[k], dd.A.from[k])}`)
        if (dd.A.via[k] >= 0) text.append(', entering at ', settLink(dd.A.via[k]))
        if (dd.netFirst[k]) it.classList.add('ip-first')
      }
      it.append(text)
      it.title = `${dd.A.year[k]}: ${HOW_SHORT[how]}` + (dd.netFirst[k] ? ' (the first of their world to have it)' : '')
      list.append(it)
    }
    if (rowsBy > shown) list.append(el('div', 'gp-line gp-faint', `and ${rowsBy - shown} more`))
    detail.append(list)
    // refused
    const refused = dd.refusals.filter((r) => r.idea === i && r.year <= yi())
    if (refused.length) {
      detail.append(el('div', 'gp-cap', 'Refused'))
      for (const r of refused.slice(-8)) line(`${r.year}: the `, span('ip-pn', pname(r.people)), ' at ', settLink(r.settlement), ` (${refusalShort(r.cause)})`)
    }
    if (without && lacking.length) {
      const names = lacking.length <= 4 ? lacking.join(', ') : `${lacking.slice(0, 3).join(', ')} and ${lacking.length - 3} more`
      line(`Not yet among the ${names}`).classList.add('gp-faint')
    }
  }

  // ---------- inspector ----------
  function inspectorLines(dd: IdeasData, id: number): (string | Node)[][] {
    const h = dd.history
    const out: (string | Node)[][] = []
    const y = yi()
    const here = (dd.viaRows.get(id) ?? []).filter((k) => dd.A.year[k] <= y)
    // (every conception here; of the arrivals and losses the latest few)
    const firsts: (string | Node)[][] = []
    const lines: (string | Node)[][] = []
    for (const k of here) {
      const i = dd.A.idea[k]
      const how = dd.A.how[k]
      const q = dd.A.people[k]
      if (how === IdeaHow.Invented) {
        const again = dd.ideas[i].firstSettlement !== id && dd.ideas[i].firstYear < dd.A.year[k]
        firsts.push([`${conceivedHere(dd, i)} in ${dd.A.year[k]}` + (again ? ', independently' : '')])
      } else if (how === IdeaHow.Lost) {
        lines.push([`${dd.A.year[k]}: the ${pname(q)} lost ${iname(i)} (${lossShort(dd.lossCause[k])})`])
      } else {
        const l: (string | Node)[] = [`${cap(iname(i))} entered the ${pname(q)} lands here in ${dd.A.year[k]}, `]
        const src = dd.A.source[k]
        const ch = channelPhrase(h, how, src, dd.A.from[k])
        // the source town as a link where the phrase names it
        const s = src >= 0 ? sname(src) : ''
        const at = s ? ch.lastIndexOf(s) : -1
        if (at >= 0) l.push(ch.slice(0, at), settLink(src), ch.slice(at + s.length))
        else l.push(ch)
        lines.push(l)
      }
    }
    out.push(...firsts)
    if (lines.length > 4) out.push([`${lines.length - 4} more ideas came in here before these:`])
    out.push(...lines.slice(-4))
    const went = (dd.sourceRows.get(id) ?? []).filter((k) => dd.A.year[k] <= y)
    if (went.length) {
      const l: (string | Node)[] = ['Ideas went out from here: ']
      const last = went.slice(-3)
      last.forEach((k, j) => {
        if (j) l.push(j === last.length - 1 ? ' and ' : ', ')
        l.push(`${iname(dd.A.idea[k])} to the ${pname(dd.A.people[k])} (${dd.A.year[k]})`)
      })
      if (went.length > 3) l.push(`, and ${went.length - 3} before`)
      out.push(l)
    }
    for (const r of dd.refusals) if (r.settlement === id && r.year <= y) out.push([`${cap(iname(r.idea))} was turned away here in ${r.year} (${refusalShort(r.cause)})`])
    // its people's ideas
    const p = h.settlements[id]?.people ?? -1
    if (p >= 0 && p < dd.P) {
      if (scratch.length !== dd.I) scratch = new Int32Array(dd.I)
      const c = heldCounts(dd, p, year, scratch)
      if (c.held > 0) out.push([`The ${pname(p)} hold ${c.held} ${c.held === 1 ? 'idea' : 'ideas'}, ${c.own} of their own`])
    }
    return out
  }

  function updateInspector() {
    if (!data || inspected < 0) return
    const dd = data
    const key = `${inspected}:${rowsUpTo(dd, year)}:${namesEpoch()}`
    if (key === shownInspKey) return
    shownInspKey = key
    slot.replaceChildren()
    const s = dd.history.settlements[inspected]
    if (!s || year < s.foundedYear) {
      slot.classList.add('hidden')
      return
    }
    const lines = inspectorLines(dd, inspected)
    for (const parts of lines) {
      const d = document.createElement('div')
      for (const p of parts) {
        if (p instanceof HTMLElement && p.classList.contains('gp-link')) p.className = 'insp-link'
        d.append(p)
      }
      slot.append(d)
    }
    slot.classList.toggle('hidden', lines.length === 0)
  }

  // ---------- the Ideas view ----------
  const viewShown = () => viewMode === ViewMode.Ideas
  /** The settlement whose land a cell is at land snapshot q (the territory layer), or -1. */
  function ownerOf(cell: number): number {
    if (!data) return -1
    const h = data.history
    const L = h.landCells?.length ?? 0
    const LQ = h.landSnapshotCount ?? 0
    const T = h.territory
    if (!landIndex || !T || !L || !LQ || T.length < L * LQ) return -1
    const k = landIndex[cell]
    if (k < 0) return -1
    const q = Math.max(0, Math.min(LQ - 1, Math.floor(year / Math.max(1, h.landInterval))))
    const C = h.claimed && h.claimed.length >= L * LQ ? h.claimed : null
    if (C && C[q * L + k]) return -1
    return T[q * L + k] - 1
  }
  function updateView() {
    const globe = deps.getGlobe()
    if (!viewShown() || !data || !world || !globe) return
    const dd = data
    const h = dd.history
    const L = h.landCells?.length ?? 0
    const LQ = h.landSnapshotCount ?? 0
    const T = h.territory
    const hasT = !!T && L > 0 && LQ > 0 && T.length >= L * LQ
    const q = hasT ? Math.max(0, Math.min(LQ - 1, Math.floor(year / Math.max(1, h.landInterval)))) : -1
    const key = `${rowsUpTo(dd, year)}:${q}:${s0}:${sel}`
    if (key === shownViewKey) return
    shownViewKey = key
    const n = world.grid.cellCount
    if (!viewRgb || viewRgb.length !== n * 3) viewRgb = new Uint8Array(n * 3)
    const out = viewRgb
    for (let c = 0; c < n; c++) {
      out[c * 3] = UNSETTLED[0]
      out[c * 3 + 1] = UNSETTLED[1]
      out[c * 3 + 2] = UNSETTLED[2]
    }
    // per people: its colour this year (ideas held, or when it took up the selected idea)
    const P = dd.P
    const prgb = new Uint8Array(P * 3)
    if (scratch.length !== dd.I) scratch = new Int32Array(dd.I)
    if (adoptY.length !== P) {
      adoptY = new Int16Array(P)
      lostY = new Int16Array(P)
    }
    if (sel >= 0) adoptionYears(dd, sel, adoptY, lostY)
    const y = yi()
    const y0 = sel >= 0 ? dd.ideas[sel].firstYear : 0
    const span = sel >= 0 ? Math.max(1, dd.lastYear[sel] - y0) : 1
    const tmp = [0, 0, 0]
    // (the ideas held against the leader's at the year, squared: the gaps near the top, where most peoples are, show)
    const held = new Int16Array(P)
    if (sel < 0) {
      maxHeld = 1
      for (let p = 0; p < P; p++) {
        held[p] = heldBy(dd, p, year, scratch)
        if (living(p)) maxHeld = Math.max(maxHeld, held[p])
      }
    }
    for (let p = 0; p < P; p++) {
      if (sel < 0) countRamp((held[p] / maxHeld) ** 2, prgb, p * 3)
      else if (lostY[p] >= 0 && lostY[p] <= y) prgb.set(LOST, p * 3)
      else if (adoptY[p] >= 0 && adoptY[p] <= y) {
        ideaRamp((adoptY[p] - y0) / span, tmp, 0, 255)
        prgb[p * 3] = tmp[0]
        prgb[p * 3 + 1] = tmp[1]
        prgb[p * 3 + 2] = tmp[2]
      } else prgb.set(NOT_YET, p * 3)
    }
    const N = dd.N
    const paint = (c: number, id: number) => {
      const p = h.settlements[id].people
      if (p < 0 || p >= P) return
      out[c * 3] = prgb[p * 3]
      out[c * 3 + 1] = prgb[p * 3 + 1]
      out[c * 3 + 2] = prgb[p * 3 + 2]
    }
    if (hasT) {
      const o = q * L
      const C = h.claimed && h.claimed.length >= L * LQ ? h.claimed : null
      for (let k = 0; k < L; k++) {
        const owner = T![o + k] - 1
        if (owner >= 0 && owner < N && !(C && C[o + k])) paint(h.landCells[k], owner)
      }
    } else {
      const { neighborOffsets: off, neighbors: nb } = world.grid
      for (let i = 0; i < N; i++) {
        if (h.population[s0 * N + i] <= 0) continue
        const c = h.settlements[i].cell
        for (let k = off[c]; k < off[c + 1]; k++) paint(nb[k], i)
      }
    }
    for (let i = 0; i < N; i++) if (h.population[s0 * N + i] > 0) paint(h.settlements[i].cell, i)
    globe.setIdeaColors(out)
  }

  function updateLegend() {
    const show = viewShown() && !!data
    legend.classList.toggle('hidden', !show)
    if (!show || !data) return
    const dd = data
    const key = `${sel}:${maxHeld}`
    if (key === shownLegendKey) return
    shownLegendKey = key
    legendList.replaceChildren()
    const item = (css: string, text: string) => {
      const it = el('div', 'sp-legend-item none')
      const sw = document.createElement('span')
      sw.className = 'sp-swatch'
      sw.style.background = css
      it.append(sw, text)
      legendList.append(it)
    }
    const c = new Uint8Array(3)
    if (sel < 0) {
      legendTitle.textContent = 'Ideas held by each people'
      for (const f of [1, 0.9, 0.75, 0.5, 0]) {
        countRamp(f * f, c, 0)
        item(cssOf(c), f === 1 ? `${maxHeld}, the most any people holds` : String(Math.round(f * maxHeld)))
      }
      item(cssOf(UNSETTLED), 'Unsettled')
      legendNote.textContent = 'Who is ahead, and who is cut off'
    } else {
      legendTitle.textContent = `When each people took up ${iname(sel)}`
      const x = dd.ideas[sel]
      const ramp = el('div', 'ip-legend-ramp', span('', String(x.firstYear)), el('span', 'ip-ramp wide'), span('', String(Math.max(x.firstYear, dd.lastYear[sel]))))
      ;(ramp.children[1] as HTMLElement).style.background = IDEA_RAMP_CSS
      legendList.append(ramp)
      item(cssOf(NOT_YET), 'Not yet')
      item(cssOf(LOST), 'Lost')
      item(cssOf(UNSETTLED), 'Unsettled')
      legendNote.textContent = ''
    }
  }

  // ---------- notes in the Peoples panel ----------
  function peopleNote(p: number, y: number): string[] {
    const dd = data
    if (!dd || p < 0 || p >= dd.P) return []
    if (scratch.length !== dd.I) scratch = new Int32Array(dd.I)
    const c = heldCounts(dd, p, y, scratch)
    if (c.held === 0) return dd.ideas.some((x) => x.firstYear >= 0 && x.firstYear <= y) ? ['Ideas: none yet'] : []
    // the latest it took up
    let last = -1
    for (let i = 0; i < dd.I; i++) if (scratch[i] >= 0 && (last < 0 || dd.A.year[scratch[i]] > dd.A.year[last])) last = scratch[i]
    const out = [`Ideas: ${c.held} held, ${c.own} their own, ${c.held - c.own} received`]
    if (last >= 0) {
      const how = dd.A.how[last]
      out.push(`Latest: ${iname(dd.A.idea[last])} (${dd.A.year[last]}${how === IdeaHow.Invented ? ', their own' : `, ${channelPhrase(dd.history, how, dd.A.source[last], dd.A.from[last])}`})`)
    }
    const lost: string[] = []
    for (let i = 0; i < dd.I; i++) if (scratch[i] === -2) lost.push(iname(i))
    if (lost.length) out.push(`Lost: ${lost.join(', ')}`)
    const ref = dd.refusals.filter((r) => r.people === p && r.year <= y)
    if (ref.length) out.push(`Refused: ${ref.slice(-3).map((r) => `${iname(r.idea)} (${r.year}, ${refusalShort(r.cause)})`).join(', ')}`)
    return out
  }
  function techNote(p: number, f: number, y: number): string {
    const dd = data
    if (!dd) return ''
    const i = ideaBehindAdvance(dd, p, f, y)
    return i >= 0 ? ` · lately raised by ${iname(i)}` : ''
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
  addShortcut({ keys: ['i', 'I'], label: 'I', description: 'Show or hide ideas (inventions and how they travelled)', group: 'Panels', run: () => (data ? toggleCollapsed() : false) })

  const api: IdeasView = {
    setWorld(w: World) {
      world = w
      shownViewKey = ''
      viewRgb = null
    },
    build(w: World, hist: History, maxPopulation: number) {
      const t0 = performance.now()
      const dd = ideasOf(hist)
      const t1 = performance.now()
      if (!dd) return null
      const built = { data: dd, layer: buildIdeasLayer(w, hist, dd, maxPopulation) }
      buildMs = { data: t1 - t0, layer: performance.now() - t1 }
      return built
    },
    disposeBuilt(b) {
      if (!b) return
      deps.planetGroup.remove(b.layer.object)
      b.layer.dispose()
    },
    commit(b: IdeasBuilt | null, extend: boolean, pd: PeoplesData | null) {
      if (layer) {
        deps.planetGroup.remove(layer.object)
        layer.dispose()
      }
      layer = b?.layer ?? null
      data = b?.data ?? null
      peoples = pd && data && pd.count === data.P ? pd : null
      landIndex = null
      maxHeld = 1
      if (data) {
        const h = data.history
        if (world && h.landCells?.length) {
          landIndex = new Int32Array(world.grid.cellCount).fill(-1)
          for (let k = 0; k < h.landCells.length; k++) if (h.landCells[k] < landIndex.length) landIndex[h.landCells[k]] = k
        }
        scratch = new Int32Array(data.I)
      }
      if (layer) {
        deps.planetGroup.add(layer.object)
        layer.setKnownMask(knownMask)
        layer.setMasked(knownMask !== null)
      }
      root.classList.toggle('hidden', !data)
      deps.setViewModeAvailable?.(ViewMode.Ideas, !!data)
      if (data && !toggle && deps.addLayerToggle) {
        toggle = deps.addLayerToggle({
          key: 'ideas',
          label: 'Ideas',
          group: 'people',
          checked: layerOn,
          title: 'Ideas: a pulse where one arrives or is conceived (while playing); a selected idea\'s spread, its origin and the way it came',
          onChange: (on) => {
            layerOn = on
            deps.setUrlParam('ideas', on ? null : '0')
            syncLayer()
          },
        })
      }
      toggle?.closest('label')?.classList.toggle('hidden', !data)
      setPeopleIdeasNote(data ? peopleNote : null)
      setPeopleTechNote(data ? techNote : null)
      // the selection: kept on a longer run (same catalogue), else from the URL
      let want = extend ? sel : -1
      if (pendingKey !== null && data) {
        const k = pendingKey
        pendingKey = null
        want = data.ideas.findIndex((x) => x.key === k)
      }
      select(data ? want : -1, false)
      tickedRows = tickedS0 = -1
      syncLayer()
      force()
    },
    setViewMode(mode: ViewMode) {
      viewMode = mode
      shownViewKey = shownLegendKey = ''
      dirty = true
      updateLegend()
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
    setYield(near: number, far: number) {
      layer?.setYield(near, far)
    },
    tick(y, snap, pulseYears, effect, playing, camera, drawSize, pixelRatio) {
      year = y
      s0 = snap
      lastCamera = camera
      if (!data) return
      if (layer) {
        layer.setTime(y, pulseYears, effect, playing, snap)
        layer.update(camera, drawSize, pixelRatio)
      }
      if (namesEpoch() !== shownNames) {
        shownNames = namesEpoch()
        dirty = true
      }
      // the panels change only when the year crosses a row of the ideas table (or a refusal), with the snapshot, or the selection
      const rows = rowsUpTo(data, y)
      if (rows === tickedRows && snap === tickedS0 && !dirty) return
      tickedRows = rows
      tickedS0 = snap
      dirty = false
      updateCount()
      updatePane()
      updateDetail()
      updateInspector()
      updateView()
      updateLegend()
    },
    describeCell(cell: number) {
      if (!data || !viewShown()) return ''
      const dd = data
      const owner = ownerOf(cell)
      const p = owner >= 0 && owner < dd.N ? dd.history.settlements[owner].people : -1
      if (p < 0) return ''
      if (sel >= 0) {
        if (adoptY.length !== dd.P) return ''
        const y = yi()
        if (lostY[p] >= 0 && lostY[p] <= y) return `The ${pname(p)} lost ${iname(sel)} in ${lostY[p]}`
        if (adoptY[p] >= 0 && adoptY[p] <= y) return `The ${pname(p)} took up ${iname(sel)} in ${adoptY[p]}`
        return `The ${pname(p)}: not yet ${iname(sel)}`
      }
      if (scratch.length !== dd.I) scratch = new Int32Array(dd.I)
      const c = heldCounts(dd, p, year, scratch)
      return `The ${pname(p)}: ${c.held} ${c.held === 1 ? 'idea' : 'ideas'} (${c.own} their own)`
    },
  }
  deps.setViewModeAvailable?.(ViewMode.Ideas, false)
  if (params.get('perf') === '1') {
    // debugging and measurement: the data, the layer's state, selection; where a settlement is on screen
    ;(window as unknown as { __worldseedIdeas: unknown }).__worldseedIdeas = {
      data: () => data,
      active: () => layer?.active ?? false,
      stats: () => layer?.stats() ?? null,
      buildMs: () => buildMs,
      /** Main-thread milliseconds of building the index anew (a shallow copy of the history is a new cache key). */
      timeData: () => {
        if (!data) return -1
        const t0 = performance.now()
        ideasOf({ ...data.history })
        return performance.now() - t0
      },
      select: (key: string | number) => select(typeof key === 'number' ? key : (data?.ideas.findIndex((x) => x.key === key) ?? -1), false),
      expand: (t = 0) => {
        tab = t
        if (collapsed) toggleCollapsed()
        syncTabs()
        force()
      },
      where: (id: number) => {
        if (!world || !data || id < 0 || id >= data.N) return null
        const c = data.history.settlements[id].cell
        const P = world.grid.positions
        return { az: (Math.atan2(P[c * 3], P[c * 3 + 2]) * 180) / Math.PI, lat: (Math.asin(Math.max(-1, Math.min(1, P[c * 3 + 1]))) * 180) / Math.PI }
      },
      screen: (id: number) => {
        if (!world || !data || !lastCamera || id < 0 || id >= data.N) return null
        const c = data.history.settlements[id].cell
        const P = world.grid.positions
        deps.planetGroup.updateWorldMatrix(true, false)
        const v = new THREE.Vector3(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]).multiplyScalar(1.004).applyMatrix4(deps.planetGroup.matrixWorld).project(lastCamera)
        return [((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight]
      },
    }
  }
  return api
}
