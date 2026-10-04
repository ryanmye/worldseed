// Factions (polities) in the UI: the Factions panel (right column, under the peoples), the
// faction section of the inspector, the Factions layer and views on the globe
// (render/polities.ts), the faction names across their territory (labels.ts regions), the
// hover readout's faction, and the timeline's count of states and wars.
//
// The panel lists the factions alive at the current year by population: colour, tier and name
// ("Kingdom of Vashtar"), capital, members, population, ruling people and wars in progress.
// Clicking one selects it (polity=<id>): its territory is highlighted and the others dimmed,
// and a detail section shows how it was founded, its family tree (parent and successors,
// clickable, ended ones too), capitals, wars with their outcomes, revolts, and its end.
//
// Everything is optional: a history without polity data hides the panel, the layer toggle
// and the views, and the app looks as before. DOM writes happen only when a shown value
// changes (compared as numbers or keys first); the layer's textures change only with a snapshot.

import * as THREE from 'three'
import type { History, World } from '../contract.ts'
import { PolityOrigin, WarOutcome } from '../contract.ts'
import { buildPolityLayer, PolityView, type PolityLayer } from '../render/polities.ts'
import type { GlobeMesh } from '../render/globe.ts'
import type { LabelLayer, RegionLabel } from '../render/labels.ts'
import { ViewMode } from '../render/palette.ts'
import { requestRender } from '../render/invalidate.ts'
import { formatInt, formatPopulation, peopleName, settlementName } from './format.ts'
import { assignPolityColors, capitalAt, capitalOf, dangerAt, dangerWords, landSnapNear, polityAt, polityAtYear, polityLives, polityTitle, politiesOf, PolityEvent, statIndex, tierAt, TIER_WORDS, warActive, WATER, type PolitiesData } from './politiesData.ts'
import { setPolityFormatWorld, warOutcomeWords } from './polityFormat.ts'
import { loadFlag, saveFlag } from './panels.ts'
import { addShortcut } from './shortcuts.ts'
import type { LayerToggle } from './overlay.ts'
import './polities.css'

/** What one history's factions need on screen (built off the critical path, see historyView.ts). */
export interface PolitiesBuilt {
  data: PolitiesData
  layer: PolityLayer
}

export interface PolitiesViewDeps {
  right: HTMLElement
  inspectorSlot: HTMLElement
  planetGroup: THREE.Group
  getGlobe(): GlobeMesh | null
  setUrlParam(name: string, value: string | null): void
  /** Select (and fly to) a settlement. */
  onSelectSettlement(id: number): void
  addLayerToggle?(t: LayerToggle): HTMLInputElement
  setViewModeAvailable?(mode: ViewMode, available: boolean): void
  /** The Factions layer at start: the URL's factions= or the remembered toggle. */
  layerOn: boolean
  /** polity=<id> from the URL. */
  initialPolity: number | null
}

export interface PolitiesView {
  setWorld(world: World): void
  /** Data and layer for history h (null without polity data); nothing on screen changes. */
  build(world: World, h: History): PolitiesBuilt | null
  disposeBuilt(b: PolitiesBuilt | null | undefined): void
  /** Swap a built history in (`extend`: a longer run of the one shown: the selection is kept). */
  commit(b: PolitiesBuilt | null, labels: LabelLayer | null, extend: boolean): void
  setViewMode(mode: ViewMode): void
  setLabelsVisible(on: boolean): void
  select(p: number): void
  readonly selected: number
  /** The inspector shows settlement `id` (-1 none). */
  showSettlement(id: number): void
  setKnownMask(cellYear: Float32Array | null): void
  /** Per frame. */
  tick(year: number, s0: number, s1: number, frac: number, pulseYears: number, effectAlpha: number, camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number): void
  /** States alive and wars in progress at the year shown (null without polity data). */
  stats(): { states: number; wars: number } | null
  /** "Kingdom of Vashtar" for the faction holding a cell at the year shown, or ''. */
  describeCell(cell: number): string
}

const ORIGIN_WORDS: Record<number, string> = {
  [PolityOrigin.Formed]: 'as {cap} gathered its neighbours',
  [PolityOrigin.Revolt]: 'by provinces that rose against {parent}',
  [PolityOrigin.Fragment]: 'as a successor of {parent} when it fell apart',
  [PolityOrigin.Colonial]: 'by colonies that broke away from {parent}',
  [PolityOrigin.Partition]: 'when heirs divided {parent}',
  [PolityOrigin.CivilWar]: 'out of a civil war in {parent}',
  [PolityOrigin.League]: 'as a league of trading towns',
}

export function createPolitiesView(deps: PolitiesViewDeps): PolitiesView {
  // ---------- panel ----------
  const root = document.createElement('div')
  root.className = 'panel factions hidden'
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'fp-head'
  head.title = 'Show or hide the factions (R)'
  const title = document.createElement('span')
  title.className = 'fp-title'
  title.textContent = 'Factions'
  const count = document.createElement('span')
  count.className = 'fp-count'
  const caret = document.createElement('span')
  caret.className = 'caret'
  caret.setAttribute('aria-hidden', 'true')
  head.append(title, count, caret)
  const body = document.createElement('div')
  body.className = 'fp-body'
  body.id = 'factions-body'
  head.setAttribute('aria-controls', body.id)
  const cols = document.createElement('div')
  cols.className = 'fp-cols'
  cols.innerHTML = '<span></span><span>Faction</span><span title="Member settlements">Sett.</span><span title="Population">Pop.</span>'
  const list = document.createElement('div')
  list.className = 'fp-list'
  const empty = document.createElement('div')
  empty.className = 'fp-note'
  const detail = document.createElement('div')
  detail.className = 'fp-detail hidden'
  body.append(cols, list, empty, detail)
  root.append(head, body)
  deps.right.insertBefore(root, deps.right.querySelector('.chronicle'))

  let collapsed = loadFlag('worldseed.factions.collapsed', false)
  const syncCollapsed = () => {
    root.classList.toggle('collapsed', collapsed)
    head.setAttribute('aria-expanded', String(!collapsed))
  }
  syncCollapsed()
  const toggleCollapsed = () => {
    collapsed = !collapsed
    saveFlag('worldseed.factions.collapsed', collapsed)
    syncCollapsed()
    force()
  }
  head.addEventListener('click', toggleCollapsed)

  // ---------- inspector section ----------
  const slot = deps.inspectorSlot
  const ipLine = document.createElement('div')
  ipLine.className = 'if-line'
  const ipDanger = document.createElement('div')
  ipDanger.className = 'if-danger'
  slot.append(ipLine, ipDanger)
  slot.classList.add('hidden')

  // ---------- state ----------
  let world: World | null = null
  let data: PolitiesData | null = null
  let layer: PolityLayer | null = null
  let labels: LabelLayer | null = null
  let labelsVisible = true
  let toggle: HTMLInputElement | null = null
  let layerOn = deps.layerOn
  let viewMode: ViewMode = ViewMode.Terrain
  let selected = -1
  let pendingSelect = deps.initialPolity
  let inspected = -1
  let knownMask: Float32Array | null = null
  let year = 0
  let s0 = 0
  let shownS0 = -1
  let shownRowsKey = ''
  let shownDetailKey = ''
  let shownInspKey = ''
  let shownRegionsKey = -1
  let shownCount = -1
  let statStates = 0
  let statWars = 0
  interface Row { p: number; el: HTMLButtonElement; name: HTMLSpanElement; tier: HTMLSpanElement; war: HTMLSpanElement; sett: HTMLSpanElement; pop: HTMLSpanElement; shown: { m: number; pop: number; tier: number; war: number; sel: boolean } }
  let rows: Row[] = []

  const force = () => {
    shownS0 = -1
    shownRowsKey = ''
    shownDetailKey = ''
    shownInspKey = ''
    shownRegionsKey = -1
    shownCount = -1
    requestRender()
  }

  const swatch = (p: number) => {
    const s = document.createElement('span')
    s.className = 'fp-swatch'
    if (data && p >= 0) s.style.background = data.css[p]
    return s
  }
  const polityLink = (p: number, text?: string) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'fp-link'
    b.dataset.polity = String(p)
    b.append(swatch(p), text ?? (data ? polityTitle(data, p, s0) : ''))
    return b
  }
  const settLink = (id: number) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'fp-link sett'
    b.dataset.sid = String(id)
    b.textContent = data ? settlementName(data.history, id) : ''
    return b
  }
  const onClick = (e: Event) => {
    const t = e.target as HTMLElement
    const pl = t.closest('[data-polity]') as HTMLElement | null
    if (pl) {
      const p = Number(pl.dataset.polity)
      api.select(pl.classList.contains('fp-row') && p === selected ? -1 : p)
      return
    }
    const sl = t.closest('[data-sid]') as HTMLElement | null
    if (sl && root.contains(sl)) deps.onSelectSettlement(Number(sl.dataset.sid))
  }
  root.addEventListener('click', onClick)
  slot.addEventListener('click', (e) => {
    const pl = (e.target as HTMLElement).closest('[data-polity]') as HTMLElement | null
    if (pl) api.select(Number(pl.dataset.polity))
  })

  function currentView(): PolityView {
    if (!data) return PolityView.Off
    if (viewMode === ViewMode.Factions) return PolityView.Political
    if (viewMode === ViewMode.Danger) return PolityView.Danger
    if (viewMode === ViewMode.Terrain && layerOn) return PolityView.Tint
    return PolityView.Off
  }
  function applyView() {
    layer?.setView(currentView())
    shownRegionsKey = -1
    if (labels && currentView() !== PolityView.Tint && currentView() !== PolityView.Political) labels.setRegions?.(null)
    requestRender()
  }

  // ---------- panel content ----------
  function updateRows() {
    if (!data) return
    const pd = data
    const lo = pd.aliveOffsets[s0], hi = pd.aliveOffsets[s0 + 1]
    const alive: number[] = []
    for (let k = lo; k < hi; k++) alive.push(k)
    alive.sort((a, b) => pd.alivePop[b] - pd.alivePop[a] || pd.aliveId[a] - pd.aliveId[b])
    const n = alive.length
    if (n * 1000 + statWars !== shownCount) {
      shownCount = n * 1000 + statWars
      count.textContent = n === 0 ? 'none yet' : `${n} ${n === 1 ? 'state' : 'states'}` + (statWars > 0 ? ` · ${statWars} ${statWars === 1 ? 'war' : 'wars'}` : '')
    }
    if (collapsed) return
    const key = alive.map((k) => pd.aliveId[k]).join(',')
    if (key !== shownRowsKey) {
      shownRowsKey = key
      list.replaceChildren()
      rows = []
      for (const k of alive) {
        const p = pd.aliveId[k]
        const el = document.createElement('button')
        el.type = 'button'
        el.className = 'fp-row'
        el.dataset.polity = String(p)
        const nameCell = document.createElement('span')
        nameCell.className = 'fp-namecell'
        const tier = document.createElement('span')
        tier.className = 'fp-tier'
        const name = document.createElement('span')
        name.className = 'fp-name'
        const war = document.createElement('span')
        war.className = 'fp-war hidden'
        war.textContent = '⚔'
        nameCell.append(name, war)
        const sett = document.createElement('span')
        sett.className = 'fp-num'
        const pop = document.createElement('span')
        pop.className = 'fp-num'
        el.append(swatch(p), nameCell, sett, pop)
        list.appendChild(el)
        rows.push({ p, el, name, tier, war, sett, pop, shown: { m: -1, pop: -1, tier: -1, war: -1, sel: false } })
      }
      empty.textContent = n === 0 ? 'No states yet: every settlement governs itself.' : ''
      empty.classList.toggle('hidden', n > 0)
    }
    for (const r of rows) {
      const k = statIndex(pd, r.p, s0)
      if (k < 0) continue
      const m = pd.aliveMembers[k], pp = pd.alivePop[k], t = pd.aliveTier[k]
      if (m !== r.shown.m) {
        r.shown.m = m
        r.sett.textContent = formatInt(m)
      }
      if (pp !== r.shown.pop) {
        r.shown.pop = pp
        r.pop.textContent = formatPopulation(pp)
      }
      if (t !== r.shown.tier) {
        r.shown.tier = t
        r.name.textContent = `${TIER_WORDS[t]} of ${pd.names[r.p]}`
        const cap = capitalAt(pd, r.p, year)
        const people = peopleName(pd.history, pd.list[r.p].people)
        r.el.title = `${TIER_WORDS[t]} of ${pd.names[r.p]}` + (cap >= 0 ? `, ruled from ${settlementName(pd.history, cap)}` : '') + (people ? `; the ${people} people rule` : '') + '. Click to select.'
      }
      let w = 0
      for (const wid of pd.warsOf[r.p]) if (warActive(pd, wid, year)) w++
      if (w !== r.shown.war) {
        r.shown.war = w
        r.war.classList.toggle('hidden', w === 0)
        r.war.title = w > 0 ? `At war (${w})` : ''
      }
      const sel = r.p === selected
      if (sel !== r.shown.sel) {
        r.shown.sel = sel
        r.el.classList.toggle('selected', sel)
        r.el.setAttribute('aria-pressed', String(sel))
      }
    }
  }

  /** The detail section of the selected faction (rebuilt when what it lists changes). */
  function updateDetail() {
    if (!data || selected < 0 || collapsed) {
      if (!detail.classList.contains('hidden')) detail.classList.add('hidden')
      return
    }
    const pd = data
    const h = pd.history
    const x = pd.list[selected]
    // what is shown changes with the snapshot (numbers) and with the events up to the year
    let evN = 0
    for (const i of pd.eventsOf[selected]) if (h.events[i].year <= year) evN++
    let kids = 0
    for (const c of pd.children[selected]) if (pd.list[c].foundedYear <= year) kids++
    const key = `${selected}:${s0}:${evN}:${kids}:${Math.floor(year)}`
    if (key === shownDetailKey) return
    // the whole-year part only matters for wars starting or ending within a snapshot: keep the key coarse otherwise
    shownDetailKey = key
    detail.classList.remove('hidden')
    detail.replaceChildren()
    const k = statIndex(pd, selected, s0)
    const lives = polityLives(pd, selected, year)
    const exists = year >= x.foundedYear
    const titleEl = document.createElement('div')
    titleEl.className = 'fp-d-title'
    titleEl.append(swatch(selected), polityTitle(pd, selected, s0))
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'fp-d-close'
    close.title = 'Deselect (Esc)'
    close.textContent = '×'
    close.addEventListener('click', (e) => {
      e.stopPropagation()
      api.select(-1)
    })
    titleEl.append(close)
    detail.append(titleEl)
    const line = (...parts: (string | Node)[]) => {
      const d = document.createElement('div')
      d.className = 'fp-d-line'
      d.append(...parts)
      detail.append(d)
      return d
    }
    if (!exists) {
      line(`Founded in ${x.foundedYear} (not yet)`)
      return
    }
    // founding
    const cap0 = x.capitals?.[0] ?? -1
    const how = (ORIGIN_WORDS[x.origin] ?? '').split(/(\{cap\}|\{parent\})/)
    const f = line(`Founded in ${x.foundedYear}` + (cap0 >= 0 ? ' at ' : ''))
    if (cap0 >= 0) f.append(settLink(cap0))
    if (how.length > 1 || how[0]) {
      f.append(' ')
      for (const part of how) {
        if (part === '{cap}') f.append(cap0 >= 0 ? settLink(cap0) : 'its capital')
        else if (part === '{parent}') f.append(x.parent >= 0 ? polityLink(x.parent, pd.names[x.parent]) : 'its overlord')
        else if (part) f.append(part)
      }
    }
    // now
    if (lives && k >= 0) {
      const cap = capitalAt(pd, selected, year)
      const people = peopleName(h, x.people)
      const now = line()
      if (cap >= 0) now.append('Capital ', settLink(cap), ' · ')
      now.append(`${formatInt(pd.aliveMembers[k])} settlements, ${formatPopulation(pd.alivePop[k])} people`)
      if (people) line(`Ruled by the ${people} people`)
    }
    // capitals
    const caps: [number, number][] = []
    for (let c = 0; c < (x.capitals?.length ?? 0); c++) if ((x.capitalYears[c] ?? 0) <= year) caps.push([x.capitals[c], x.capitalYears[c]])
    if (caps.length > 1) {
      const c = line('Capitals: ')
      caps.forEach(([id, y], i) => {
        if (i > 0) c.append(', ')
        c.append(settLink(id), ` (${y})`)
      })
    }
    // end
    if (x.endedYear >= 0 && x.endedYear <= year) {
      const endEv = pd.eventsOf[selected].map((i) => h.events[i]).find((e) => (e.type as number) === PolityEvent.Ended)
      const by = endEv && endEv.other >= 0 ? polityAt(pd, endEv.other, Math.max(0, Math.floor((x.endedYear - 1) / pd.interval))) : -1
      const words = x.endCause === 1 ? 'Conquered' : x.endCause === 2 ? 'Broke apart' : x.endCause === 3 ? 'Dwindled away' : x.endCause === 4 ? 'Reunified' : x.endCause === 5 ? 'Submitted' : 'Ended'
      const e = line(`${words} in ${x.endedYear}`)
      e.classList.add('fp-ended')
      if (by >= 0 && by !== selected) e.append(x.endCause === 5 ? ' to ' : ' by ', polityLink(by, pd.names[by]))
    }
    // family tree: ancestors, this, successors (founded by now)
    const anc: number[] = []
    for (let a = x.parent; a >= 0 && anc.length < 8; a = pd.list[a].parent) anc.unshift(a)
    const kidsOf = (p: number) => pd.children[p].filter((c) => pd.list[c].foundedYear <= year)
    if (anc.length > 0 || kidsOf(selected).length > 0) {
      const tree = document.createElement('div')
      tree.className = 'fp-tree'
      const cap = document.createElement('div')
      cap.className = 'fp-d-cap'
      cap.textContent = 'Lineage'
      detail.append(cap, tree)
      const node = (p: number, depth: number, self: boolean) => {
        const d = document.createElement('div')
        d.className = 'fp-node' + (self ? ' self' : '')
        d.style.paddingLeft = `${depth * 12}px`
        const y = pd.list[p]
        const span = `${y.foundedYear}–${y.endedYear >= 0 && y.endedYear <= year ? y.endedYear : ''}`
        const b = self ? (() => { const s = document.createElement('span'); s.append(swatch(p), pd.names[p]); return s })() : polityLink(p, pd.names[p])
        if (y.endedYear >= 0 && y.endedYear <= year) d.classList.add('ended')
        const yr = document.createElement('span')
        yr.className = 'fp-years'
        yr.textContent = span
        d.append(depth > 0 ? '└ ' : '', b, yr)
        tree.append(d)
      }
      anc.forEach((a, i) => node(a, i, false))
      node(selected, anc.length, true)
      const walk = (p: number, depth: number, budget: { n: number }) => {
        for (const c of kidsOf(p)) {
          if (budget.n-- <= 0) return
          node(c, depth, false)
          walk(c, depth + 1, budget)
        }
      }
      walk(selected, anc.length + 1, { n: 14 })
    }
    // wars
    const W = pd.wars
    const ws = W ? pd.warsOf[selected].filter((w) => W.startYear[w] <= year) : []
    if (W && ws.length > 0) {
      const cap = document.createElement('div')
      cap.className = 'fp-d-cap'
      cap.textContent = `Wars (${ws.length})`
      detail.append(cap)
      const shown = ws.slice(-8).reverse()
      for (const w of shown) {
        const enemy = W.attacker[w] === selected ? W.defender[w] : W.attacker[w]
        const ongoing = W.endYear[w] < 0 || W.endYear[w] > year
        const d = line()
        d.classList.add('fp-war-line')
        if (ongoing) d.classList.add('ongoing')
        d.append(ongoing ? `Since ${W.startYear[w]}: ` : `${W.startYear[w]}–${W.endYear[w]}: `, W.attacker[w] === selected ? 'against ' : 'attacked by ', enemy >= 0 && enemy < pd.count ? polityLink(enemy, pd.names[enemy]) : 'rebels')
        if (!ongoing && W.outcome[w] !== WarOutcome.Ongoing) d.append(` (${warOutcomeWords(pd, w)})`)
        else if (ongoing) d.append(' (in progress)')
      }
      if (ws.length > shown.length) line(`and ${ws.length - shown.length} earlier`).classList.add('fp-faint')
    }
    // revolts
    let revolts = 0, lastRevolt = -1, crushed = 0, seceded = 0
    for (const i of pd.eventsOf[selected]) {
      const e = h.events[i]
      if (e.year > year) break
      const t = e.type as number
      if (t === PolityEvent.Revolt) {
        revolts++
        lastRevolt = i
      } else if (t === PolityEvent.RevoltCrushed) crushed++
      else if (t === PolityEvent.Seceded && e.value !== selected) seceded++
    }
    if (revolts > 0) {
      const e = h.events[lastRevolt]
      const r = line(`Revolts: ${revolts}` + (crushed ? `, ${crushed} crushed` : '') + (seceded ? `, ${seceded} broke away` : '') + ' · last at ')
      r.append(settLink(e.settlement), ` (${e.year})`)
    }
  }

  function updateInspector() {
    if (!data || inspected < 0) return
    const pd = data
    const p = polityAtYear(pd, inspected, year)
    const capOf = capitalOf(pd, inspected, year)
    const cell = pd.history.settlements[inspected]?.cell ?? -1
    const q = landSnapNear(pd, year)
    const d = cell >= 0 ? dangerAt(pd, cell, q) : 0
    const tier = p >= 0 ? tierAt(pd, p, s0) : -1
    const key = `${inspected}:${p}:${tier}:${capOf}:${dangerWords(d)}`
    if (key === shownInspKey) return
    shownInspKey = key
    ipLine.replaceChildren()
    const alive = (pd.history.population[s0 * pd.settlementCount + inspected] ?? 0) > 0
    if (!alive) {
      slot.classList.add('hidden')
      return
    }
    slot.classList.remove('hidden')
    if (p >= 0) {
      ipLine.append(capOf === p ? 'Capital of the ' : 'Part of the ', polityLink(p))
    } else ipLine.append('Stateless: governs itself')
    ipDanger.textContent = pd.land?.danger ? `Danger: ${dangerWords(d).toLowerCase()}` : ''
    ipDanger.classList.toggle('hidden', !pd.land?.danger)
  }

  /** Faction names across their territory: an anchor far from the borders, size by area and tier. */
  function updateRegions() {
    if (!labels || !data || !layer || !world || !labelsVisible) return
    const v = currentView()
    if (v !== PolityView.Tint && v !== PolityView.Political) return
    const cells = layer.cells
    if (!cells) return
    const key = s0
    if (key === shownRegionsKey) return
    shownRegionsKey = key
    const pd = data
    const { cellCount, neighborOffsets: off, neighbors: nb } = world.grid
    // distance (in steps) from each owned cell to its polity's edge
    const dist = new Int16Array(cellCount).fill(-1)
    const queue = new Int32Array(cellCount)
    let qh = 0, qt = 0
    for (let c = 0; c < cellCount; c++) {
      const v0 = cells[c]
      if (v0 < 0) continue
      for (let k = off[c]; k < off[c + 1]; k++) {
        if (cells[nb[k]] !== v0) {
          dist[c] = 0
          queue[qt++] = c
          break
        }
      }
    }
    while (qh < qt) {
      const c = queue[qh++]
      for (let k = off[c]; k < off[c + 1]; k++) {
        const n = nb[k]
        if (dist[n] >= 0 || cells[n] !== cells[c]) continue
        dist[n] = dist[c] + 1
        queue[qt++] = n
      }
    }
    const best = new Map<number, { cell: number; d: number; n: number }>()
    for (let c = 0; c < cellCount; c++) {
      const v0 = cells[c]
      if (v0 < 0) continue
      const b = best.get(v0)
      if (!b) best.set(v0, { cell: c, d: dist[c], n: 1 })
      else {
        b.n++
        if (dist[c] > b.d) {
          b.d = dist[c]
          b.cell = c
        }
      }
    }
    const regions: RegionLabel[] = []
    for (const [p, b] of best) {
      if (b.n < 10 || p >= pd.count) continue
      const r = pd.rgb[p * 3], g = pd.rgb[p * 3 + 1], bl = pd.rgb[p * 3 + 2]
      const lite = (x: number) => Math.round((x + (1 - x) * 0.55) * 255)
      regions.push({ key: p, name: pd.names[p], cell: b.cell, cells: b.n, rgb: `${lite(r)},${lite(g)},${lite(bl)}`, rank: tierAt(pd, p, s0) })
    }
    labels.setRegions?.(regions)
  }

  addShortcut({
    keys: ['Escape'],
    label: 'Esc',
    description: 'Close a popup, else leave the known world, else deselect',
    group: 'Panels',
    run: () => {
      if (selected < 0) return false
      api.select(-1)
    },
  })
  addShortcut({ keys: ['r', 'R'], label: 'R', description: 'Show or hide the factions', group: 'Panels', run: () => (data ? toggleCollapsed() : false) })

  const api: PolitiesView = {
    setWorld(w: World) {
      world = w
      setPolityFormatWorld(w)
    },
    build(w: World, h: History) {
      const pd = politiesOf(h)
      if (!pd) return null
      assignPolityColors(pd, w)
      return { data: pd, layer: buildPolityLayer(w, h, pd) }
    },
    disposeBuilt(b) {
      if (!b) return
      deps.planetGroup.remove(b.layer.object)
      b.layer.dispose()
    },
    commit(b: PolitiesBuilt | null, lbl: LabelLayer | null, extend: boolean) {
      if (layer) {
        deps.planetGroup.remove(layer.object)
        layer.dispose()
      }
      layer = b?.layer ?? null
      data = b?.data ?? null
      labels = lbl
      if (layer) {
        layer.setGlobe(deps.getGlobe())
        deps.planetGroup.add(layer.object)
        layer.setKnownMask(knownMask)
        layer.setMasked(knownMask !== null)
      }
      root.classList.toggle('hidden', !data)
      deps.setViewModeAvailable?.(ViewMode.Factions, !!data)
      deps.setViewModeAvailable?.(ViewMode.Danger, !!data?.land?.danger)
      if (data && !toggle && deps.addLayerToggle) {
        // the layer toggle appears with the first history that has factions
        toggle = deps.addLayerToggle({
          key: 'factions',
          label: 'Factions',
          group: 'people',
          checked: layerOn,
          title: 'Tint the land of each faction (state) in its colour, with its borders, capitals, armies and battles',
          onChange: (on) => {
            layerOn = on
            deps.setUrlParam('factions', on ? null : '0')
            applyView()
          },
        })
      }
      toggle?.closest('label')?.classList.toggle('hidden', !data)
      if (!extend || !data || selected >= (data?.count ?? 0)) selected = extend && data && selected < data.count ? selected : -1
      if (pendingSelect !== null && data) {
        const p = pendingSelect
        pendingSelect = null
        if (p >= 0 && p < data.count) selected = p
      }
      layer?.setSelected(selected)
      deps.setUrlParam('polity', selected >= 0 ? String(selected) : null)
      rows = []
      list.replaceChildren()
      applyView()
      force()
    },
    setViewMode(mode: ViewMode) {
      viewMode = mode
      applyView()
    },
    setLabelsVisible(on: boolean) {
      labelsVisible = on
      shownRegionsKey = -1
    },
    select(p: number) {
      if (!data || !(p >= 0 && p < data.count)) p = -1
      if (p === selected) return
      selected = p
      layer?.setSelected(p)
      deps.setUrlParam('polity', p >= 0 ? String(p) : null)
      force()
    },
    get selected() {
      return selected
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
      layer?.setMasked(cellYear !== null)
    },
    tick(y, sa, sb, frac, pulseYears, effectAlpha, camera, drawSize, pixelRatio) {
      year = y
      if (!data) return
      s0 = Math.max(0, Math.min(data.snapshotCount - 1, sa))
      if (layer) {
        layer.setTime(y, sa, sb, frac, pulseYears, effectAlpha)
        layer.update(camera, drawSize, pixelRatio)
      }
      // counts for the timeline and the panel head (whole years)
      let wars = 0
      const W = data.wars
      if (W) for (let w = 0; w < W.count; w++) if (warActive(data, w, y)) wars++
      statWars = wars
      statStates = data.aliveOffsets[s0 + 1] - data.aliveOffsets[s0]
      if (s0 !== shownS0) {
        shownS0 = s0
        updateRows()
        updateRegions()
      } else if (shownCount !== statStates * 1000 + statWars) updateRows()
      updateDetail()
      updateInspector()
    },
    stats() {
      return data ? { states: statStates, wars: statWars } : null
    },
    describeCell(cell: number) {
      if (!data || !layer || currentView() === PolityView.Off) return ''
      const cells = layer.cells
      const p = cells && cell >= 0 && cell < cells.length ? cells[cell] : -1
      if (p === WATER || p < 0) return ''
      return polityTitle(data, p, s0)
    },
  }
  return api
}
