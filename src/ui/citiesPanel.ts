// Cities: the right column's ranked list of every town and city alive at the current year,
// biggest first (villages are not listed). Follows the same collapsed-by-default panel
// convention as Travel, Goods, Sickness and the Faiths (gp-head / gp-body / gp-row), but owns
// no 3D layer: a row only selects a settlement and flies to it, the same way the chronicle and
// the other panels' links do (deps.onSelectSettlement).
//
// What is shown is a pure function of the population snapshot index (History.population is
// stored per snapshot): the ranked list, the header's count and "largest", and every row's
// tier, state chip, people dot and sparkline are all rebuilt only when that index changes (or
// a renaming takes effect, or the list is expanded/collapsed). A growing pool of DOM rows is
// reused (chronicle.ts's pattern): rows are never rebuilt or removed, only hidden or rewritten.
//
// The state chip (colour + name) comes from this history's own polities index
// (politiesData.ts), built and coloured the same way the Factions panel builds its own: the
// colours line up because assignPolityColors is a deterministic function of the polity list
// and its capitals. The people dot's colour comes from the peoples index (peoplesData.ts),
// already built once per history by historyView.ts and handed in at commit().

import { landmarksOf } from './landmarksData.ts'
import { CITY_POPULATION, landmarksAt, TOWN_POPULATION, type History, type World } from '../contract.ts'
import { formatPopulation, settlementName } from './format.ts'
import { namesEpoch } from './renamingData.ts'
import { assignPolityColors, polityAtYear, politiesOf, type PolitiesData } from './politiesData.ts'
import type { PeoplesData } from './peoplesData.ts'
import { loadFlag, panelToggled, registerPanel, saveFlag } from './panels.ts'
import { addShortcut } from './shortcuts.ts'
import { requestFlyIn } from './flyIn.ts'
import './cities.css'

export interface CitiesBuilt {
  pd: PolitiesData | null
}

export interface CitiesViewDeps {
  right: HTMLElement
  /** Select (and fly to) a settlement, the same call every other panel's rows use. */
  onSelectSettlement(id: number): void
}

export interface CitiesView {
  setWorld(world: World): void
  /** Builds this history's polity colours for the state chip (null without polity data); nothing on screen changes. */
  build(world: World, h: History): CitiesBuilt
  /** Swaps a built history in (`null` clears the panel). */
  commit(b: CitiesBuilt | null, h: History | null, peoples: PeoplesData | null): void
  /** The inspector's selected settlement (-1 none): highlights and scrolls its row into view. */
  showSettlement(id: number): void
  tick(year: number): void
}

/** Default rows shown; "show all towns" lifts this to SHOWN_CAP. */
const TOP_DEFAULT = 30
/** However many towns and cities a history has, the list (and its DOM row pool) stops growing here. */
const SHOWN_CAP = 300
/** The sparkline covers this many years back (clamped to what the history has run). */
const SPARK_YEARS = 150

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function createCitiesView(deps: CitiesViewDeps): CitiesView {
  // ---------- panel ----------
  const root = document.createElement('div')
  root.className = 'panel cities hidden'
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'gp-head'
  head.title = 'Show or hide the cities (U)'
  const title = document.createElement('span')
  title.className = 'gp-title'
  title.textContent = 'Cities'
  const count = document.createElement('span')
  count.className = 'gp-count'
  const caret = document.createElement('span')
  caret.className = 'caret'
  caret.setAttribute('aria-hidden', 'true')
  head.append(title, count, caret)
  const body = document.createElement('div')
  body.className = 'gp-body'
  body.id = 'cities-body'
  head.setAttribute('aria-controls', body.id)
  const list = document.createElement('div')
  list.className = 'cp-list'
  const empty = document.createElement('div')
  empty.className = 'gp-note'
  empty.textContent = 'No towns yet.'
  empty.hidden = true
  const more = document.createElement('button')
  more.type = 'button'
  more.className = 'gp-link cp-more'
  more.hidden = true
  body.append(list, empty, more)
  root.append(head, body)
  deps.right.insertBefore(root, deps.right.querySelector('.chronicle'))

  let collapsed = loadFlag('worldseed.cities.collapsed', true)
  const syncCollapsed = () => {
    root.classList.toggle('collapsed', collapsed)
    head.setAttribute('aria-expanded', String(!collapsed))
  }
  syncCollapsed()
  const toggleCollapsed = () => {
    collapsed = !collapsed
    saveFlag('worldseed.cities.collapsed', collapsed)
    syncCollapsed()
    panelToggled('cities', !collapsed)
    shownS0 = -1 // force the body to fill in now that it is visible
    if (!collapsed) window.setTimeout(() => root.scrollIntoView({ block: 'nearest' }), 80)
  }
  head.addEventListener('click', toggleCollapsed)
  registerPanel('cities', root, () => !collapsed, () => { if (!collapsed) toggleCollapsed() })
  let showAll = false
  more.addEventListener('click', () => {
    showAll = !showAll
    shownS0 = -1
    render()
  })

  // ---------- rows: a growing pool, reused (chronicle.ts's pattern) ----------
  interface Row {
    el: HTMLButtonElement
    rank: HTMLSpanElement
    peopleDot: HTMLSpanElement
    tier: HTMLSpanElement
    name: HTMLSpanElement
    state: HTMLSpanElement
    stateDot: HTMLSpanElement
    stateName: Text
    pop: HTMLSpanElement
    spark: HTMLCanvasElement
    sparkCtx: CanvasRenderingContext2D | null
    id: number
  }
  const rows: Row[] = []
  const SPARK_W = 40, SPARK_H = 14
  function makeRow(): Row {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'gp-row cp-row'
    const rank = document.createElement('span')
    rank.className = 'cp-rank'
    const peopleDot = document.createElement('span')
    peopleDot.className = 'gp-dot'
    const tier = document.createElement('span')
    tier.className = 'cp-tier'
    const name = document.createElement('span')
    name.className = 'gp-name'
    const stateDot = document.createElement('span')
    stateDot.className = 'gp-dot cp-state-dot'
    const stateName = document.createTextNode('')
    const state = document.createElement('span')
    state.className = 'cp-state'
    state.append(stateDot, stateName)
    const pop = document.createElement('span')
    pop.className = 'gp-num'
    const spark = document.createElement('canvas')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    spark.width = SPARK_W * dpr
    spark.height = SPARK_H * dpr
    spark.style.width = `${SPARK_W}px`
    spark.style.height = `${SPARK_H}px`
    spark.className = 'cp-spark'
    const sparkCtx = spark.getContext('2d')
    if (sparkCtx) sparkCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // (a span, not a button: the row itself is a button)
    const flyIn = document.createElement('span')
    flyIn.className = 'cp-fly'
    flyIn.textContent = '↓'
    flyIn.title = 'Fly in: look at the town from up close'
    flyIn.setAttribute('aria-hidden', 'true')
    el.append(rank, peopleDot, tier, name, state, pop, spark, flyIn)
    el.hidden = true
    list.appendChild(el)
    const row: Row = { el, rank, peopleDot, tier, name, state, stateDot, stateName, pop, spark, sparkCtx, id: -1 }
    return row
  }
  function rowAt(i: number): Row {
    while (rows.length <= i) rows.push(makeRow())
    return rows[i]
  }

  list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.cp-row') as HTMLElement | null
    if (!b) return
    const row = rows.find((r) => r.el === b)
    if (row && row.id >= 0 && (e.target as HTMLElement).closest('.cp-fly')) return requestFlyIn(row.id)
    if (row && row.id >= 0) deps.onSelectSettlement(row.id)
  })

  // ---------- state ----------
  let history: History | null = null
  let peoplesData: PeoplesData | null = null
  let polData: PolitiesData | null = null
  let shownS0 = -1
  let shownNames = -1
  let selectedId = -1
  /** Settlement ids ranked by population at the last snapshot drawn, biggest first (towns and cities only). */
  let ranked: { id: number; pop: number }[] = []
  let nTowns = 0, nCities = 0

  function sparkline(ctx: CanvasRenderingContext2D, id: number, s0: number) {
    ctx.clearRect(0, 0, SPARK_W, SPARK_H)
    if (!history) return
    const h = history
    const N = h.settlements.length
    const span = Math.max(1, Math.min(s0, Math.round(SPARK_YEARS / Math.max(1, h.snapshotInterval))))
    const s0r = s0 - span
    let peak = 1
    for (let s = s0r; s <= s0; s++) peak = Math.max(peak, h.population[s * N + id])
    const x = (s: number) => ((s - s0r) / span) * (SPARK_W - 1)
    const y = (v: number) => SPARK_H - 1 - (v / peak) * (SPARK_H - 2)
    ctx.beginPath()
    ctx.moveTo(x(s0r), SPARK_H - 1)
    for (let s = s0r; s <= s0; s++) ctx.lineTo(x(s), y(h.population[s * N + id]))
    ctx.lineTo(x(s0), SPARK_H - 1)
    ctx.closePath()
    ctx.fillStyle = 'rgba(159, 214, 234, 0.3)'
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x(s0r), y(h.population[s0r * N + id]))
    for (let s = s0r; s <= s0; s++) ctx.lineTo(x(s), y(h.population[s * N + id]))
    ctx.strokeStyle = 'rgba(159, 214, 234, 0.9)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  function updateRow(row: Row, rank: number, id: number, pop: number, year: number) {
    row.id = id
    row.el.dataset.sid = String(id)
    row.rank.textContent = String(rank + 1)
    row.name.textContent = settlementName(history!, id)
    row.pop.textContent = formatPopulation(pop)
    const isCity = pop >= CITY_POPULATION
    row.tier.textContent = isCity ? 'City' : 'Town'
    row.tier.title = isCity ? 'City' : 'Town'
    row.tier.classList.toggle('cp-tier-city', isCity)
    row.tier.classList.toggle('cp-tier-town', !isCity)
    const peopleId = history!.settlements[id].people
    const pc = peoplesData && peopleId >= 0 && peopleId < peoplesData.count ? peoplesData.css[peopleId] : ''
    row.peopleDot.style.background = pc || 'transparent'
    row.peopleDot.style.visibility = pc ? 'visible' : 'hidden'
    row.peopleDot.title = peoplesData && peopleId >= 0 ? `${peoplesData.names[peopleId]}` : ''
    const p = polData ? polityAtYear(polData, id, year) : -1
    if (polData && p >= 0 && p < polData.count) {
      row.stateDot.style.background = polData.css[p]
      row.stateName.textContent = polData.names[p]
      row.state.title = polData.names[p]
      row.state.hidden = false
    } else {
      row.state.hidden = true
    }
    if (row.sparkCtx) sparkline(row.sparkCtx, id, shownS0)
    // landmarks: its great buildings standing by the year (any state), in the tooltip
    // (the town's at the year: one an heir town restored on its ruins counts there, landmarksAt)
    let great = 0
    if (landmarksOf(history)) for (const x of landmarksAt(history!, id, year)) if (x.rank === 0) great++
    row.el.title = `${settlementName(history!, id)}: ${Math.round(pop)} people` + (polData && p >= 0 ? `, ${polData.names[p]}` : '') + (great ? ` · ${great} landmark${great > 1 ? 's' : ''}` : '')
    row.el.classList.toggle('selected', id === selectedId)
  }

  function headerText(): string {
    const total = nTowns + nCities
    if (total === 0) return 'No towns yet'
    const mixed = nCities > 0 && nTowns > 0
    const kind = mixed ? `${total} towns and cities` : nCities > 0 ? plural(nCities, 'city', 'cities') : plural(nTowns, 'town', 'towns')
    const top = ranked[0]
    const name = history ? settlementName(history, top.id) : ''
    return `${kind} · largest ${name} ${formatPopulation(top.pop)}`
  }

  function render() {
    if (!history) return
    const total = ranked.length
    empty.hidden = total > 0
    more.hidden = total <= TOP_DEFAULT
    const capped = showAll && total > SHOWN_CAP
    more.textContent = showAll ? (capped ? `showing the biggest ${SHOWN_CAP} of ${total} — show top 30` : 'show top 30') : `show all ${total} towns`
    const shown = Math.min(total, showAll ? SHOWN_CAP : TOP_DEFAULT)
    const year = history.snapshotInterval * shownS0
    for (let i = 0; i < shown; i++) updateRow(rowAt(i), i, ranked[i].id, ranked[i].pop, year)
    for (let i = shown; i < rows.length; i++) rows[i].el.hidden = true
    for (let i = 0; i < shown; i++) rows[i].el.hidden = false
    root.classList.toggle('many', shown >= 8) // (style.css: eight rows or more keep at least eight in view)
  }

  function recompute(s0: number) {
    if (!history) return
    const h = history
    const N = h.settlements.length
    const base = s0 * N
    ranked = []
    nTowns = 0
    nCities = 0
    for (let i = 0; i < N; i++) {
      const p = h.population[base + i]
      if (p >= CITY_POPULATION) nCities++
      else if (p >= TOWN_POPULATION) nTowns++
      else continue
      ranked.push({ id: i, pop: p })
    }
    ranked.sort((a, b) => b.pop - a.pop)
  }

  function syncHeader() {
    count.textContent = headerText()
  }

  addShortcut({ keys: ['u', 'U'], label: 'U', description: 'Show or hide the cities (towns and cities ranked by population)', group: 'Panels', run: () => (history ? toggleCollapsed() : false) })

  const api: CitiesView = {
    setWorld() {
      // (the state chip's colours are a function of the history and the world's capitals
      // only, recomputed fresh in build() each time; nothing to carry over here)
    },
    build(world: World, h: History): CitiesBuilt {
      const pd = politiesOf(h)
      if (pd) assignPolityColors(pd, world)
      return { pd }
    },
    commit(b, h, peoples) {
      history = h
      polData = b?.pd ?? null
      peoplesData = peoples
      selectedId = -1
      shownS0 = -1
      showAll = false
      root.classList.toggle('hidden', !h)
      if (!h) {
        ranked = []
        nTowns = nCities = 0
        for (const r of rows) r.el.hidden = true
      }
    },
    showSettlement(id: number) {
      selectedId = id
      for (const r of rows) {
        if (r.el.hidden) continue
        const sel = r.id === id
        r.el.classList.toggle('selected', sel)
        if (sel && !collapsed) r.el.scrollIntoView({ block: 'nearest' })
      }
    },
    tick(year: number) {
      if (!history) return
      const h = history
      const s0 = Math.max(0, Math.min(h.snapshotCount - 1, Math.floor(year / Math.max(1, h.snapshotInterval))))
      let changed = false
      if (s0 !== shownS0) {
        shownS0 = s0
        recompute(s0)
        changed = true
      }
      if (namesEpoch() !== shownNames) {
        shownNames = namesEpoch()
        changed = true
      }
      if (!changed) return
      syncHeader()
      if (!collapsed) render()
    },
  }
  return api
}
