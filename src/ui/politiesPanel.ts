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
//
// Polities v2: vassals and tributaries are listed under their overlord (indented, tagged) with
// a subtotal row for the sphere (overlord and vassals); the detail section lists the bonds in
// force with their years ("Vassal of Rilkochal since 1420", "Allied with Kloson against
// Vethuvul since 1500") and the bonds of the past, the tariff rate and duty revenue with a
// sparkline over the faction's life, civil wars marked in the war list, and the origin of every
// successor in the lineage (civil-war pretenders, partition heirs, leagues). The inspector says
// when a settlement is a smugglers' hub, a pirate haven, a blockaded port or a port losing
// cargo to pirates or bandits; the trade section's partners show the duty, contraband and
// losses on each route (tradePanel.ts setTradeRouteNote). The timeline shows the largest bloc
// (a sphere, or a single state). The outlaw layer (render/outlaws.ts: contraband routes,
// preyed-upon lanes, bandit roads, havens, hubs, blockades, pirate ships) is built and driven
// from here with the territory layer.

import * as THREE from 'three'
import type { History, World } from '../contract.ts'
import { BondKind, BondEnd, PolityOrigin, WarOutcome } from '../contract.ts'
import { buildPolityLayer, PolityView, type PolityLayer } from '../render/polities.ts'
import { buildOutlawLayer, type OutlawLayer } from '../render/outlaws.ts'
import { routeNetwork } from '../render/routeCurves.ts'
import { setTradeRouteNote } from './tradePanel.ts'
import type { GlobeMesh } from '../render/globe.ts'
import type { LabelLayer, RegionLabel } from '../render/labels.ts'
import { ViewMode } from '../render/palette.ts'
import { requestRender } from '../render/invalidate.ts'
import { formatInt, formatPopulation, peopleName, settlementName } from './format.ts'
import { assignPolityColors, blockadesAt, embargoesOn, bondActive, capitalAt, capitalOf, contrabandAt, dangerAt, dangerWords, HUB_CONTRABAND, isCivilWar, landSnapNear, overlordBond, piracyAt, polityAt, polityAtYear, polityLives, polityTitle, politiesOf, PolityEvent, revenueAt, spheresAt, statIndex, tariffAt, tierAt, tierWord, tradeSnapNear, warActive, WATER, type BlockadeMark, type PolitiesData } from './politiesData.ts'
import { setPolityFormatWorld, warOutcomeWords } from './polityFormat.ts'
import { loadFlag, saveFlag } from './panels.ts'
import { addShortcut } from './shortcuts.ts'
import type { LayerToggle } from './overlay.ts'
import './polities.css'

/** What one history's factions need on screen (built off the critical path, see historyView.ts). */
export interface PolitiesBuilt {
  data: PolitiesData
  layer: PolityLayer
  /** Contraband routes, preyed-upon lanes, havens, hubs, blockades and pirate ships (null without the second version's data). */
  outlaws: OutlawLayer | null
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
  /** States alive and wars in progress at the year shown, and the largest bloc ("Rilkochal 31%": a sphere or a state, by people), null without polity data. */
  stats(): { states: number; wars: number; largest: string } | null
  /** Whether the Trade layer is shown (the contraband and preyed-upon lanes and the pirate ships go with it). */
  setTradeVisible(on: boolean): void
  /** "Kingdom of Vashtar" for the faction holding a cell at the year shown, or ''. */
  describeCell(cell: number): string
}

/** Goods lines of a faction's detail (secrets held, lanes, posts: ui/goodsPanel.ts), or null without goods data. */
let polityGoodsNote: ((p: number, year: number) => (string | Node)[][]) | null = null
export function setPolityGoodsNote(fn: ((p: number, year: number) => (string | Node)[][]) | null): void {
  polityGoodsNote = fn
}
/** Sickness lines of a faction's detail (armies broken by sickness: ui/diseasePanel.ts), or null without disease data. */
let polityDiseaseNote: ((p: number, year: number) => (string | Node)[][]) | null = null
export function setPolityDiseaseNote(fn: ((p: number, year: number) => (string | Node)[][]) | null): void {
  polityDiseaseNote = fn
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
  // smugglers' hub, pirate haven, blockade, losses to pirates and bandits
  const ipOutlaw = document.createElement('div')
  ipOutlaw.className = 'if-outlaw hidden'
  slot.append(ipLine, ipDanger, ipOutlaw)
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
  /** The sphere subtotal rows: overlord and vassals. */
  let spheres: { members: number[]; sett: HTMLSpanElement; pop: HTMLSpanElement; shown: number }[] = []
  let outlaws: OutlawLayer | null = null
  let tradeOn = true
  /** PiratesRise events per haven (for the lane its pirates strike), and the routes that cross water (for the inspector's losses). */
  let havenRise = new Map<number, { year: number; value: number }[]>()
  let routeSea: Uint8Array | null = null
  const blockTmp: BlockadeMark[] = []
  /** Bonds in force (a hash), checked once per whole year: the list nests vassals under their overlord. */
  let shownBondKey = NaN
  let shownBondYear = NaN
  let statLargest = ''
  /** The inspector's outlaw lines, and the settlement and whole year they were worked out for. */
  let shownOutlaw: { key: string; lines: string[] } = { key: '', lines: [] }
  let shownOutlawKey = NaN

  const force = () => {
    shownOutlawKey = NaN
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
    syncOutlaws()
    shownRegionsKey = -1
    if (labels && currentView() !== PolityView.Tint && currentView() !== PolityView.Political) labels.setRegions?.(null)
    requestRender()
  }

  /** The outlaw layer's parts: havens, hubs, blockades with the Factions layer or views; lanes and ships with the Trade layer; all on the Danger view. */
  function syncOutlaws() {
    const v = currentView()
    outlaws?.setShown(v !== PolityView.Off, tradeOn, v === PolityView.Danger)
  }

  /** The routes of history h that cross water (for the inspector's losses), worked out once per history. */
  function lossSea(): Uint8Array | null {
    if (routeSea || !data || !world) return routeSea
    const T = (data.history as Partial<History>).trade
    if (!T) return null
    const W = world
    const sea = new Uint8Array(T.count)
    for (let r = 0; r < T.count; r++) {
      for (let k = T.pathOffsets[r] + 1; k + 1 < T.pathOffsets[r + 1]; k++) {
        const c = T.path[k]
        if (W.elevation[c] < 0 || W.lake[c] === 1) {
          sea[r] = 1
          break
        }
      }
    }
    routeSea = sea
    return sea
  }

  /** The duty, contraband and losses on route r at trade snapshot t, from settlement id's side (for the inspector's trade partners). */
  function routeNote(r: number, t: number, id: number): string {
    const pd = data
    const T = pd?.trade
    if (!pd || !T || r < 0 || r >= T.count) return ''
    const R = T.count
    const partner = T.a[r] === id ? T.b[r] : T.a[r]
    const y = t * T.interval
    const p = polityAtYear(pd, id, y), q = polityAtYear(pd, partner, y)
    const parts: string[] = []
    // duties: what this town's imports from the partner pay its polity, and the partner's on what it buys here (none within a sphere bond)
    const freeTrade = p >= 0 && q >= 0 && (overlordOf2(pd, p, q, y))
    if (p !== q && !freeTrade && pd.tariff) {
      const rp = p >= 0 ? Math.round(tariffAt(pd, p, Math.floor(y / pd.interval)) * 100) : 0
      const rq = q >= 0 ? Math.round(tariffAt(pd, q, Math.floor(y / pd.interval)) * 100) : 0
      if (rp > 0 || rq > 0) parts.push(rp > 0 && rq > 0 ? `duty ${rp}% here, ${rq}% there` : rp > 0 ? `duty ${rp}% here` : `duty ${rq}% there`)
    }
    const v = T.volume[t * R + r]
    const sm = pd.smuggle ? pd.smuggle[t * R + r] : 0
    if (v > 0 && sm / v >= 0.05) parts.push(`${Math.round((100 * sm) / v)}% contraband`)
    const l = pd.loss ? pd.loss[t * R + r] / 255 : 0
    if (l >= 0.01) parts.push(`${Math.round(l * 100)}% lost to ${lossSea()?.[r] ? 'pirates' : 'bandits'}`)
    return parts.join(' · ')
  }
  /** Whether p and q trade duty-free at year y (a vassal or tributary and its overlord). */
  function overlordOf2(pd: PolitiesData, p: number, q: number, y: number): boolean {
    const a = overlordBond(pd, p, y), b = overlordBond(pd, q, y)
    return (a >= 0 && pd.bonds!.b[a] === q) || (b >= 0 && pd.bonds!.b[b] === p)
  }

  // ---------- panel content ----------
  /** One row of the list: a faction, nested under its overlord when it is a vassal or tributary. */
  function makeRow(p: number, sub: 0 | 1 | 2): Row {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'fp-row' + (sub ? ' sub' : '')
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
    if (sub) {
      const tag = document.createElement('span')
      tag.className = 'fp-bond ' + (sub === 1 ? 'vassal' : 'tribute')
      tag.textContent = sub === 1 ? 'vassal' : 'tribute'
      tag.title = sub === 1 ? 'A vassal: keeps its own government, pays part of its revenue to its overlord and never fights it' : 'Pays tribute to the faction above for a term after a lost war'
      nameCell.append(name, tag, war)
    } else nameCell.append(name, war)
    const sett = document.createElement('span')
    sett.className = 'fp-num'
    const pop = document.createElement('span')
    pop.className = 'fp-num'
    el.append(swatch(p), nameCell, sett, pop)
    return { p, el, name, tier, war, sett, pop, shown: { m: -1, pop: -1, tier: -1, war: -1, sel: false } }
  }

  /** The list's groups at the year: top-level factions by the people of their sphere, each followed by its vassals and tributaries. */
  function listGroups(pd: PolitiesData): { top: number; vassals: number[]; tributaries: number[]; pop: number }[] {
    const lo = pd.aliveOffsets[s0], hi = pd.aliveOffsets[s0 + 1]
    const spheres = spheresAt(pd, year, s0)
    const under = new Set<number>()
    const byTop = new Map<number, { vassals: number[]; tributaries: number[]; pop: number }>()
    for (const x of spheres) {
      for (const v of x.vassals) under.add(v)
      for (const t of x.tributaries) under.add(t)
      byTop.set(x.overlord, { vassals: x.vassals, tributaries: x.tributaries, pop: x.pop })
    }
    const out: { top: number; vassals: number[]; tributaries: number[]; pop: number }[] = []
    for (let k = lo; k < hi; k++) {
      const p = pd.aliveId[k]
      if (under.has(p)) continue
      const g = byTop.get(p)
      const byPop = (a: number, b: number) => pd.alivePop[statIndex(pd, b, s0)] - pd.alivePop[statIndex(pd, a, s0)] || a - b
      out.push({ top: p, vassals: g ? g.vassals.slice().sort(byPop) : [], tributaries: g ? g.tributaries.slice().sort(byPop) : [], pop: g ? g.pop : pd.alivePop[k] })
    }
    out.sort((a, b) => b.pop - a.pop || a.top - b.top)
    return out
  }

  function updateRows() {
    if (!data) return
    const pd = data
    const n = pd.aliveOffsets[s0 + 1] - pd.aliveOffsets[s0]
    if (n * 1000 + statWars !== shownCount) {
      shownCount = n * 1000 + statWars
      count.textContent = n === 0 ? 'none yet' : `${n} ${n === 1 ? 'state' : 'states'}` + (statWars > 0 ? ` · ${statWars} ${statWars === 1 ? 'war' : 'wars'}` : '')
    }
    if (collapsed) return
    const groups = listGroups(pd)
    const key = groups.map((g) => `${g.top}` + (g.vassals.length ? `v${g.vassals.join('.')}` : '') + (g.tributaries.length ? `t${g.tributaries.join('.')}` : '')).join(',')
    if (key !== shownRowsKey) {
      shownRowsKey = key
      list.replaceChildren()
      rows = []
      spheres = []
      for (const g of groups) {
        const top = makeRow(g.top, 0)
        list.appendChild(top.el)
        rows.push(top)
        for (const v of g.vassals) {
          const r = makeRow(v, 1)
          list.appendChild(r.el)
          rows.push(r)
        }
        for (const t of g.tributaries) {
          const r = makeRow(t, 2)
          list.appendChild(r.el)
          rows.push(r)
        }
        if (g.vassals.length > 0) {
          // the sphere's subtotal: overlord and vassals (tributaries are listed, not counted)
          const el = document.createElement('button')
          el.type = 'button'
          el.className = 'fp-row fp-sphere'
          el.dataset.polity = String(g.top)
          const label = document.createElement('span')
          label.className = 'fp-namecell'
          const lt = document.createElement('span')
          lt.className = 'fp-name'
          lt.textContent = `Sphere of ${pd.names[g.top]}`
          label.append(lt)
          const sett = document.createElement('span')
          sett.className = 'fp-num'
          const pop = document.createElement('span')
          pop.className = 'fp-num'
          const sw = document.createElement('span')
          sw.className = 'fp-sphere-mark'
          el.append(sw, label, sett, pop)
          el.title = `${pd.names[g.top]} and its ${g.vassals.length} ${g.vassals.length === 1 ? 'vassal' : 'vassals'}` + (g.tributaries.length ? ` (${g.tributaries.length} paying tribute, not counted)` : '')
          list.appendChild(el)
          spheres.push({ members: [g.top, ...g.vassals], sett, pop, shown: -1 })
        }
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
        const title = `${tierWord(pd, r.p, t)} of ${pd.names[r.p]}`
        r.name.textContent = title
        const cap = capitalAt(pd, r.p, year)
        const people = peopleName(pd.history, pd.list[r.p].people)
        r.el.title = title + (cap >= 0 ? `, ruled from ${settlementName(pd.history, cap)}` : '') + (people ? `; the ${people} people rule` : '') + '. Click to select.'
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
    for (const x of spheres) {
      let m = 0, pp = 0
      for (const q of x.members) {
        const k = statIndex(pd, q, s0)
        if (k < 0) continue
        m += pd.aliveMembers[k]
        pp += pd.alivePop[k]
      }
      if (m * 1e9 + pp !== x.shown) {
        x.shown = m * 1e9 + pp
        x.sett.textContent = formatInt(m)
        x.pop.textContent = formatPopulation(pp)
      }
    }
  }

  /** "pretender", "partition heir" ... for a successor's origin in the lineage, or ''. */
  const originTag = (o: number) => (o === PolityOrigin.CivilWar ? 'pretender' : o === PolityOrigin.Partition ? 'partition heir' : o === PolityOrigin.League ? 'league' : o === PolityOrigin.Revolt ? 'revolt' : o === PolityOrigin.Colonial ? 'colony' : o === PolityOrigin.Fragment ? 'successor' : '')

  /** A small sparkline of the selected faction's tariff over its life (a cursor at the year). */
  function tariffSpark(pd: PolitiesData, p: number): HTMLCanvasElement | null {
    const T = pd.tariff
    const f = pd.firstSnap[p], l = pd.lastSnap[p]
    if (!T || f < 0 || l <= f) return null
    let max = 0
    for (let s = f; s <= l; s++) max = Math.max(max, T[s * pd.count + p])
    if (max <= 0) return null
    const W = 96, H = 18
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const c = document.createElement('canvas')
    c.className = 'fp-spark'
    c.width = W * dpr
    c.height = H * dpr
    c.style.width = `${W}px`
    c.style.height = `${H}px`
    const ctx = c.getContext('2d')
    if (!ctx) return c
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const x = (s: number) => ((s - f) / Math.max(1, l - f)) * W
    const y = (v: number) => H - 2 - (v / max) * (H - 4)
    ctx.beginPath()
    for (let s = f; s <= l; s++) {
      const v = T[s * pd.count + p]
      if (s === f) ctx.moveTo(x(s), y(v))
      else ctx.lineTo(x(s), y(v))
    }
    ctx.strokeStyle = 'rgba(255, 200, 120, 0.9)'
    ctx.lineWidth = 1.2
    ctx.stroke()
    const cx = x(Math.max(f, Math.min(l, s0)))
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.fillRect(cx - 0.5, 0, 1, H)
    c.title = `Tariff over its life, up to ${Math.round((100 * max) / 255)}%`
    return c
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
    let bondN = 0
    const B = pd.bonds
    if (B) for (const k of pd.bondsOf[selected]) bondN += (B.startYear[k] <= year ? 1 : 0) + (B.endYear[k] >= 0 && B.endYear[k] <= year ? 1000 : 0)
    const key = `${selected}:${s0}:${evN}:${kids}:${bondN}:${Math.floor(year)}`
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
    const cap = (text: string) => {
      const c = document.createElement('div')
      c.className = 'fp-d-cap'
      c.textContent = text
      detail.append(c)
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
      const capNow = capitalAt(pd, selected, year)
      const people = peopleName(h, x.people)
      const now = line()
      if (capNow >= 0) now.append('Capital ', settLink(capNow), ' · ')
      now.append(`${formatInt(pd.aliveMembers[k])} settlements, ${formatPopulation(pd.alivePop[k])} people`)
      if (people) line(`Ruled by the ${people} people`)
      // trade policy: the tariff on imports and the duties (and seized contraband) reaching the capital
      if (pd.tariff) {
        const rate = tariffAt(pd, selected, s0)
        const rev = revenueAt(pd, selected, s0)
        const t = line(`Tariff ${Math.round(rate * 100)}% on imports` + (rev > 0.5 ? ` · duties ${formatPopulation(rev)} a year` : ''))
        t.classList.add('fp-tariff')
        const spark = tariffSpark(pd, selected)
        if (spark) t.append(spark)
      }
      // embargoes in force (History.embargoes): drawn as a dashed amber border where the two meet
      for (const em of embargoesOn(pd, selected, year)) line('Under embargo with ', polityLink(em.other, pd.names[em.other]), ` since ${em.since}`).classList.add('fp-embargo')
      // goods: secrets held, lanes and trading posts (goodsPanel.ts)
      for (const parts of polityGoodsNote?.(selected, year) ?? []) line(...parts).classList.add('fp-goods')
      // sickness: armies broken by it (diseasePanel.ts)
      for (const parts of polityDiseaseNote?.(selected, year) ?? []) line(...parts).classList.add('fp-goods')
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
      if (by >= 0 && by !== selected) e.append(x.endCause === 5 ? ' to ' : x.endCause === 4 ? ' into ' : ' by ', polityLink(by, pd.names[by]))
    }
    // bonds: vassalage, tribute, alliances (in force, then past)
    if (B && pd.bondsOf[selected].some((b) => B.startYear[b] <= year)) {
      cap('Bonds')
      const now: number[] = [], past: number[] = []
      for (const b of pd.bondsOf[selected]) {
        if (B.startYear[b] > year) continue
        if (bondActive(pd, b, year)) now.push(b)
        else past.push(b)
      }
      const other = (b: number) => (B.a[b] === selected ? B.b[b] : B.a[b])
      const subjects: number[] = []
      for (const b of now) {
        const o = other(b)
        const kind = B.kind[b]
        if (kind === BondKind.Alliance) {
          const rival = allianceRival(pd, b)
          const d = line('Allied with ', polityLink(o, pd.names[o]))
          if (rival >= 0) d.append(' against ', polityLink(rival, pd.names[rival]))
          d.append(` since ${B.startYear[b]}`)
        } else if (B.a[b] === selected) line(kind === BondKind.Vassal ? 'Vassal of ' : 'Pays tribute to ', polityLink(o, pd.names[o]), ` since ${B.startYear[b]}`).classList.add('fp-bond-line')
        else subjects.push(b)
      }
      const vs = subjects.filter((b) => B.kind[b] === BondKind.Vassal), ts = subjects.filter((b) => B.kind[b] === BondKind.Tribute)
      const listOf = (label: string, bs: number[]) => {
        if (!bs.length) return
        const d = line(label)
        bs.slice(0, 8).forEach((b, i) => {
          if (i > 0) d.append(', ')
          d.append(polityLink(B.a[b], pd.names[B.a[b]]), ` (since ${B.startYear[b]})`)
        })
        if (bs.length > 8) d.append(` and ${bs.length - 8} more`)
      }
      listOf(vs.length === 1 ? 'Overlord of ' : `Overlord of ${vs.length}: `, vs)
      listOf('Receives tribute from ', ts)
      if (vs.length > 0 && lives) {
        let m = 0, pp = 0
        for (const q of [selected, ...vs.map((b) => B.a[b])]) {
          const i = statIndex(pd, q, s0)
          if (i < 0) continue
          m += pd.aliveMembers[i]
          pp += pd.alivePop[i]
        }
        line(`Its sphere: ${formatInt(m)} settlements, ${formatPopulation(pp)} people`).classList.add('fp-sphere-line')
      }
      const shown = past.slice(-5).reverse()
      for (const b of shown) {
        const o = other(b)
        const kind = B.kind[b]
        const endW = B.end[b] === BondEnd.Freed ? (B.a[b] === selected ? ', thrown off' : ', which threw it off') : B.end[b] === BondEnd.Absorbed ? ', absorbed' : ''
        const d = line()
        d.classList.add('fp-faint')
        if (kind === BondKind.Alliance) d.append('Allied with ', polityLink(o, pd.names[o]))
        else if (B.a[b] === selected) d.append(kind === BondKind.Vassal ? 'Vassal of ' : 'Paid tribute to ', polityLink(o, pd.names[o]))
        else d.append(kind === BondKind.Vassal ? 'Overlord of ' : 'Took tribute from ', polityLink(o, pd.names[o]))
        d.append(` ${B.startYear[b]}–${B.endYear[b]}${endW}`)
      }
      if (past.length > shown.length) line(`and ${past.length - shown.length} earlier bonds`).classList.add('fp-faint')
    }
    // family tree: ancestors, this, successors (founded by now), each successor with its origin
    const anc: number[] = []
    for (let a = x.parent; a >= 0 && anc.length < 8; a = pd.list[a].parent) anc.unshift(a)
    const kidsOf = (p: number) => pd.children[p].filter((c) => pd.list[c].foundedYear <= year)
    if (anc.length > 0 || kidsOf(selected).length > 0) {
      const tree = document.createElement('div')
      tree.className = 'fp-tree'
      cap('Lineage')
      detail.append(tree)
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
        d.append(depth > 0 ? '└ ' : '', b)
        const tag = depth > 0 ? originTag(y.origin) : ''
        if (tag) {
          const t = document.createElement('span')
          t.className = 'fp-origin'
          t.textContent = tag
          d.append(t)
        }
        d.append(yr)
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
    // wars (civil wars marked)
    const W = pd.wars
    const ws = W ? pd.warsOf[selected].filter((w) => W.startYear[w] <= year) : []
    if (W && ws.length > 0) {
      cap(`Wars (${ws.length})`)
      const shown = ws.slice(-8).reverse()
      for (const w of shown) {
        const enemy = W.attacker[w] === selected ? W.defender[w] : W.attacker[w]
        const ongoing = W.endYear[w] < 0 || W.endYear[w] > year
        const civil = isCivilWar(pd, w)
        const d = line()
        d.classList.add('fp-war-line')
        if (ongoing) d.classList.add('ongoing')
        if (civil) d.classList.add('civil')
        d.append(ongoing ? `Since ${W.startYear[w]}: ` : `${W.startYear[w]}–${W.endYear[w]}: `)
        if (civil) {
          const t = document.createElement('span')
          t.className = 'fp-civil'
          t.textContent = 'civil war'
          d.append(t, W.attacker[w] === selected ? ' against ' : ' with the pretender ')
        } else d.append(W.attacker[w] === selected ? 'against ' : 'attacked by ')
        d.append(enemy >= 0 && enemy < pd.count ? polityLink(enemy, pd.names[enemy]) : 'rebels')
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

  /** The common rival of alliance bond b: from the Alliance event that made it (-1 unknown). */
  function allianceRival(pd: PolitiesData, b: number): number {
    const B = pd.bonds!
    const h = pd.history
    for (const i of pd.eventsOf[B.a[b]]) {
      const e = h.events[i]
      if ((e.type as number) !== PolityEvent.Alliance || e.year !== B.startYear[b]) continue
      const p = polityAtYear(pd, e.settlement, e.year)
      if ((p === B.a[b] && e.value === B.b[b]) || (p === B.b[b] && e.value === B.a[b])) return e.extra ?? -1
    }
    return -1
  }

  /** "about a third", "about half", "most" of a share. */
  const shareWords = (f: number) => (f >= 0.8 ? 'nearly all' : f >= 0.6 ? 'most' : f >= 0.42 ? 'about half' : f >= 0.29 ? 'about a third' : f >= 0.2 ? 'about a quarter' : f >= 0.13 ? 'about a sixth' : 'a tenth or so')

  /** The inspector's outlaw lines for settlement id at the year: hub, haven, blockade, losses (null when none). */
  function outlawLines(pd: PolitiesData, id: number): { key: string; lines: string[] } {
    const lines: string[] = []
    let key = ''
    const c = contrabandAt(pd, id, s0)
    if (c * 255 >= HUB_CONTRABAND) {
      const w = shareWords(c)
      key += `h${w}`
      lines.push(`A smugglers' town: ${w} of its income is contraband`)
    }
    const v = piracyAt(pd, id, s0)
    if (v > 0) {
      const h = pd.history
      let lane = ''
      // the lane named when they rose (the latest PiratesRise of this haven up to the year)
      const ix = havenRise.get(id)
      if (ix) for (const e of ix) if (e.year <= year && e.value >= 0 && h.trade && e.value < h.trade.count) lane = `${settlementName(h, h.trade.a[e.value])}–${settlementName(h, h.trade.b[e.value])}`
      const w = v >= 0.65 ? 'A great pirate haven' : v >= 0.3 ? 'A pirate haven' : 'A small pirate nest'
      key += `p${w}${lane}`
      lines.push(`${w}: its corsairs prey on ${lane ? `the ${lane} lane` : 'the sea lanes nearby'}`)
    }
    for (const b of blockadesAt(pd, year, blockTmp)) {
      if (b.port !== id) continue
      const q = b.by >= 0 ? polityAtYear(pd, b.by, year) : -1
      key += `b${b.war}`
      lines.push(`Blockaded by the fleets of ${q >= 0 ? pd.names[q] : 'the enemy'} since ${b.year}`)
    }
    const T = pd.trade, LO = pd.loss
    if (T && LO) {
      const t = tradeSnapNear(pd, year)
      const R = T.count
      let seaV = 0, seaL = 0, landV = 0, landL = 0
      const sea = lossSea()
      for (let r = 0; r < R; r++) {
        if (T.a[r] !== id && T.b[r] !== id) continue
        const vol = T.volume[t * R + r]
        if (!(vol > 0)) continue
        const l = LO[t * R + r] / 255
        if (sea && sea[r]) {
          seaV += vol
          seaL += vol * l
        } else {
          landV += vol
          landL += vol * l
        }
      }
      const pct = (x: number) => Math.round(x * 100)
      if (seaV > 0 && seaL / seaV >= 0.01) {
        key += `s${pct(seaL / seaV)}`
        lines.push(`Pirates and privateers take about ${pct(seaL / seaV)}% of the cargo on its sea lanes`)
      }
      if (landV > 0 && landL / landV >= 0.01) {
        key += `l${pct(landL / landV)}`
        lines.push(`Bandits take about ${pct(landL / landV)}% of the cargo on its roads`)
      }
    }
    return { key, lines }
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
    const ob = p >= 0 ? overlordBond(pd, p, year) : -1
    // (the outlaw lines change with the snapshot, the trade snapshot and the blockades: worked out once per whole year)
    const ok = inspected * 65536 + Math.floor(year)
    if (ok !== shownOutlawKey) {
      shownOutlawKey = ok
      shownOutlaw = outlawLines(pd, inspected)
    }
    const ol = shownOutlaw
    const key = `${inspected}:${p}:${tier}:${capOf}:${dangerWords(d)}:${ob}:${ol.key}`
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
      if (ob >= 0) {
        const B = pd.bonds!
        ipLine.append(B.kind[ob] === BondKind.Vassal ? ', vassal of ' : ', tributary of ', polityLink(B.b[ob], pd.names[B.b[ob]]))
      }
    } else ipLine.append('Stateless: governs itself')
    ipDanger.textContent = pd.land?.danger ? `Danger: ${dangerWords(d).toLowerCase()}` : ''
    ipDanger.classList.toggle('hidden', !pd.land?.danger)
    ipOutlaw.replaceChildren()
    for (const t of ol.lines) {
      const dl = document.createElement('div')
      dl.textContent = t
      ipOutlaw.append(dl)
    }
    ipOutlaw.classList.toggle('hidden', ol.lines.length === 0)
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

  /** "Rilkochal 31%": the largest bloc (a sphere: overlord and vassals; or a single state) by its share of the world's people, '' with fewer than two states. */
  function largestBloc(pd: PolitiesData): string {
    const n = pd.aliveOffsets[s0 + 1] - pd.aliveOffsets[s0]
    if (n < 2 || !(pd.worldPop[s0] > 0)) return ''
    let best = -1, bestPop = 0
    const under = new Set<number>()
    for (const x of spheresAt(pd, s0 * pd.interval, s0)) {
      for (const v of x.vassals) under.add(v)
      if (x.pop > bestPop) {
        bestPop = x.pop
        best = x.overlord
      }
    }
    for (let k = pd.aliveOffsets[s0]; k < pd.aliveOffsets[s0 + 1]; k++) {
      const p = pd.aliveId[k]
      if (!under.has(p) && pd.alivePop[k] > bestPop) {
        bestPop = pd.alivePop[k]
        best = p
      }
    }
    return best >= 0 ? `${pd.names[best]} ${Math.round((100 * bestPop) / pd.worldPop[s0])}%` : ''
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
      // the outlaw layer: along the bundled route network (cached: the trade and road layers share it)
      const T = (h as Partial<History>).trade
      const v2 = pd.smuggle || pd.loss || pd.havenSettlements.length > 0 || pd.hubSettlements.length > 0 || pd.blockades.length > 0
      const net = T && T.count > 0 && pd.trade ? routeNetwork(w, T.pathOffsets, T.path, T.count) : null
      return { data: pd, layer: buildPolityLayer(w, h, pd), outlaws: v2 ? buildOutlawLayer(w, h, pd, net) : null }
    },
    disposeBuilt(b) {
      if (!b) return
      deps.planetGroup.remove(b.layer.object)
      b.layer.dispose()
      if (b.outlaws) {
        deps.planetGroup.remove(b.outlaws.object)
        b.outlaws.dispose()
      }
    },
    commit(b: PolitiesBuilt | null, lbl: LabelLayer | null, extend: boolean) {
      if (layer) {
        deps.planetGroup.remove(layer.object)
        layer.dispose()
      }
      if (outlaws) {
        deps.planetGroup.remove(outlaws.object)
        outlaws.dispose()
      }
      layer = b?.layer ?? null
      outlaws = b?.outlaws ?? null
      data = b?.data ?? null
      labels = lbl
      routeSea = null
      havenRise = new Map()
      shownBondKey = shownBondYear = NaN
      if (data) {
        for (const e of data.history.events) {
          if ((e.type as number) !== PolityEvent.PiratesRise) continue
          const a = havenRise.get(e.settlement)
          if (a) a.push({ year: e.year, value: e.value })
          else havenRise.set(e.settlement, [{ year: e.year, value: e.value }])
        }
      }
      setTradeRouteNote(data ? routeNote : null)
      if (layer) {
        layer.setGlobe(deps.getGlobe())
        deps.planetGroup.add(layer.object)
        layer.setKnownMask(knownMask)
        layer.setMasked(knownMask !== null)
      }
      if (outlaws) {
        deps.planetGroup.add(outlaws.object)
        outlaws.setKnownMask(knownMask)
        outlaws.setMasked(knownMask !== null)
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
      shownOutlawKey = NaN
      if (id < 0 || !data) slot.classList.add('hidden')
      requestRender()
    },
    setKnownMask(cellYear: Float32Array | null) {
      knownMask = cellYear
      layer?.setKnownMask(cellYear)
      layer?.setMasked(cellYear !== null)
      outlaws?.setKnownMask(cellYear)
      outlaws?.setMasked(cellYear !== null)
    },
    setTradeVisible(on: boolean) {
      tradeOn = on
      syncOutlaws()
    },
    tick(y, sa, sb, frac, pulseYears, effectAlpha, camera, drawSize, pixelRatio) {
      year = y
      if (!data) return
      s0 = Math.max(0, Math.min(data.snapshotCount - 1, sa))
      if (layer) {
        layer.setTime(y, sa, sb, frac, pulseYears, effectAlpha)
        layer.update(camera, drawSize, pixelRatio)
      }
      if (outlaws) {
        outlaws.setTime(y, sa, sb, frac, effectAlpha)
        outlaws.update(camera, drawSize, pixelRatio)
      }
      // the bonds in force (once per whole year): a vassal bond made or thrown off re-nests the list
      const yi = Math.floor(y)
      let bondsChanged = false
      if (yi !== shownBondYear) {
        shownBondYear = yi
        const B = data.bonds
        let bk = 0
        if (B) for (let k = 0; k < B.count; k++) if (B.kind[k] !== BondKind.Alliance && bondActive(data, k, y)) bk = (Math.imul(bk, 31) + k + 1) | 0
        if (bk !== shownBondKey) {
          shownBondKey = bk
          bondsChanged = true
        }
      }
      // counts for the timeline and the panel head (whole years)
      let wars = 0
      const W = data.wars
      if (W) for (let w = 0; w < W.count; w++) if (warActive(data, w, y)) wars++
      statWars = wars
      statStates = data.aliveOffsets[s0 + 1] - data.aliveOffsets[s0]
      if (s0 !== shownS0 || bondsChanged) {
        if (s0 !== shownS0) statLargest = largestBloc(data)
        shownS0 = s0
        updateRows()
        updateRegions()
      } else if (shownCount !== statStates * 1000 + statWars) updateRows()
      updateDetail()
      updateInspector()
    },
    stats() {
      return data ? { states: statStates, wars: statWars, largest: statLargest } : null
    },
    describeCell(cell: number) {
      if (!data || !layer || currentView() === PolityView.Off) return ''
      const cells = layer.cells
      const p = cells && cell >= 0 && cell < cells.length ? cells[cell] : -1
      if (p === WATER || p < 0) return ''
      const ob = overlordBond(data, p, year)
      if (ob >= 0) return `${polityTitle(data, p, s0)} (${data.bonds!.kind[ob] === BondKind.Vassal ? 'vassal' : 'tributary'} of ${data.names[data.bonds!.b[ob]]})`
      return polityTitle(data, p, s0)
    },
  }
  return api
}
