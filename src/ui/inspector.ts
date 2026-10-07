// Settlement inspector panel. `show` builds the static parts once per selection
// (name, origin, cell facts, sparkline); `update` only touches text, a bar width
// and the sparkline cursor, and only when the displayed values actually change.
// Recent events: trade openings and closings, and migrant groups coming and going, are
// gathered per decade ("Opened 4 trade routes", 1850s) so they do not crowd out what
// shaped the place (founding, growth, building, famine, ruin); at most a few such lines
// are shown. The panel collapses to its header and its column can be resized.

import { EventType, StructureType, type History, type HistoryEvent, type World } from '../contract.ts'
import { BIOME_NAMES } from '../render/palette.ts'
import { describeEventFor, eventKind, formatInt, settlementName } from './format.ts'
import { censusLine } from '../render/dioramas/census.ts'
import { countUpTo, isAlive, landSnapshotAt, Tier, TIER_NAMES, tierOf, type HistoryIndex, type SnapshotPos } from './historyIndex.ts'
import { createTradeSection } from './tradePanel.ts'
import { attachWidthHandle, loadFlag, saveFlag } from './panels.ts'
import { describeOutpostSite } from './expeditionsData.ts'
import { politiesOf, wallSlighted } from './politiesData.ts'
import { namesEpoch, withEventNames } from './renamingData.ts'
import { namesLine } from './renamingFormat.ts'
import { landmarkLines } from './landmarksFormat.ts'
import { requestFlyIn } from './flyIn.ts'
import { originWords } from './cradlesFormat.ts'


export interface InspectorCallbacks {
  onSelect(id: number): void
  onClose(): void
}

export interface Inspector {
  show(index: HistoryIndex, world: World, id: number): void
  hide(): void
  readonly selected: number
  /** Refresh dynamic fields for the current year; `population` is the interpolated value. */
  update(year: number, s0: number, population: number): void
  /** The named features the settlement lies on or beside ("Kephia river, Hingara continent"), or '' for none. */
  setPlaces(text: string): void
  /** Empty element under the origin line for the settlement's people (filled by peoplesPanel.ts; hidden while empty). */
  readonly peopleSlot: HTMLElement
  /** Empty element under the people for the cell's crop and herd and the people's species (filled by speciesPanel.ts). */
  readonly speciesSlot: HTMLElement
  /** Empty element under the people for the settlement's faction and danger (filled by politiesPanel.ts; hidden while empty). */
  readonly politySlot: HTMLElement
  /** rulers, religion: empty element under the faction for the seat of a ruler and the majority faith (filled by rulersPanel.ts and faithsPanel.ts; empty takes no room). */
  readonly rulersSlot: HTMLElement
  /** Empty element under the faction for its industries, crafts, mart, posts, prices and deposits (filled by goodsPanel.ts; hidden while empty). */
  readonly goodsSlot: HTMLElement
  /** Empty element under the goods for its sickness: sick now, outbreaks suffered, quarantine, its people's childhood sicknesses and fever (filled by diseasePanel.ts; hidden while empty). */
  readonly diseaseSlot: HTMLElement
  /** Empty element under the sickness for its travel: a resort, visitors and their home towns, sights, where its people travel, the view (filled by tourismPanel.ts; hidden while empty). */
  readonly travelSlot: HTMLElement
  /** ideas: empty element under the travel for its ideas: conceived here, entered its people's lands here, went out from here, refused here (filled by ideasPanel.ts; hidden while empty). */
  readonly ideasSlot: HTMLElement
}

/** Event lines shown, and how many of them may be gathered trade or migration lines. */
const RECENT_EVENTS = 8
const CHURN_LINES = 3
/** Years per gathered line. */
const CHURN_BUCKET = 10
/** Children listed by name; the rest are counted. */
const CHILD_LINKS = 8
const SPARK_W = 240
const SPARK_H = 46

/** A 0..255 land value of `cell`, interpolated between two land snapshots, as a percentage. */
function percentAt(a: Uint8Array, cellCount: number, cell: number, pos: SnapshotPos): number {
  const v0 = a[pos.s0 * cellCount + cell], v1 = a[pos.s1 * cellCount + cell]
  return Math.round((100 * (v0 + (v1 - v0) * pos.frac)) / 255)
}

export function createInspector(container: HTMLElement, callbacks: InspectorCallbacks): Inspector {
  const root = document.createElement('div')
  root.className = 'panel inspector hidden'
  root.innerHTML = `
    <div class="insp-head">
      <div class="insp-name"><span class="insp-name-text"></span><span class="insp-tier hidden"></span></div>
      <button type="button" class="insp-flyin" title="Fly in: look at the town from up close (Y, or double-click it)">Fly in</button>
      <button type="button" class="insp-collapse" title="Collapse" aria-label="Collapse the inspector" aria-expanded="true"><span class="caret" aria-hidden="true">▾</span></button>
      <button type="button" class="insp-close" title="Close (Esc)" aria-label="Close the inspector">×</button>
    </div>
    <div class="insp-body">
    <div class="insp-names hidden"></div>
    <div class="insp-origin"></div>
    <div class="insp-outpost hidden"></div>
    <div class="insp-places hidden"></div>
    <div class="insp-people hidden"></div>
    <div class="insp-faction hidden"></div>
    <div class="insp-rulers"></div>
    <div class="insp-goods hidden"></div>
    <div class="insp-disease hidden"></div>
    <div class="insp-travel hidden"></div>
    <div class="insp-ideas hidden"></div>
    <div class="insp-species hidden"></div>
    <div class="insp-status"></div>
    <div class="readout-row">Population <span class="insp-pop"></span></div>
    <div class="insp-origin insp-census hidden"></div>
    <div class="readout-row insp-food-row">Food <span class="insp-food-val"></span></div>
    <div class="insp-bar insp-food-bar"><div class="insp-bar-fill insp-food-fill"></div></div>
    <div class="insp-wealth hidden"></div>
    <div class="readout-row insp-cap-row">Capacity <span class="insp-cap"></span></div>
    <div class="readout-row">Biome <span class="insp-biome"></span></div>
    <div class="insp-land hidden">
      <div class="readout-row">Cultivated <span class="insp-cult"></span></div>
      <div class="readout-row">Soil worn <span class="insp-deg"></span></div>
    </div>
    <div class="insp-structures hidden"></div>
    <div class="insp-landmarks hidden"></div>
    <div class="insp-trade hidden"></div>
    <div class="insp-children hidden"></div>
    <div class="insp-migrants hidden"></div>
    <div class="insp-spark-cap"><span>Population, year 0–<span class="insp-years"></span></span><span class="insp-spark-peak"></span></div>
    <div class="insp-spark">
      <canvas width="${SPARK_W}" height="${SPARK_H}"></canvas>
      <div class="insp-spark-cursor"></div>
    </div>
    <div class="insp-events-title">Recent events</div>
    <ol class="insp-events"></ol>
    </div>
  `
  container.appendChild(root)
  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T
  const nameEl = q<HTMLSpanElement>('.insp-name-text')
  const tierEl = q<HTMLSpanElement>('.insp-tier')
  const landEl = q<HTMLDivElement>('.insp-land')
  const cultEl = q<HTMLSpanElement>('.insp-cult')
  const degEl = q<HTMLSpanElement>('.insp-deg')
  const structuresEl = q<HTMLDivElement>('.insp-structures')
  // landmarks: its great buildings and houses of worship, each with its state at the year (landmarksFormat.ts)
  const landmarksEl = q<HTMLDivElement>('.insp-landmarks')
  let shownLandmarks = ''
  let shownLandmarksSel = -1, shownLandmarksYear = NaN
  const originEl = q<HTMLDivElement>('.insp-origin')
  const placesEl = q<HTMLDivElement>('.insp-places')
  // renaming: "Formerly Ilchanak (until 1202) · called Tiboi by the Leko" (renamingFormat.ts)
  const namesEl = q<HTMLDivElement>('.insp-names')
  let shownNames = -1
  const statusEl = q<HTMLDivElement>('.insp-status')
  const popEl = q<HTMLSpanElement>('.insp-pop')
  // where its people live, as the close-up view draws them (dioramas/census.ts)
  const censusEl = q<HTMLDivElement>('.insp-census')
  let censusWorld: World | null = null
  const foodValEl = q<HTMLSpanElement>('.insp-food-val')
  const barFill = q<HTMLDivElement>('.insp-food-fill')
  const capEl = q<HTMLSpanElement>('.insp-cap')
  const biomeEl = q<HTMLSpanElement>('.insp-biome')
  const canvas = q<HTMLCanvasElement>('canvas')
  const cursor = q<HTMLDivElement>('.insp-spark-cursor')
  const peakEl = q<HTMLSpanElement>('.insp-spark-peak')
  const yearsEl = q<HTMLSpanElement>('.insp-years')
  const eventsEl = q<HTMLOListElement>('.insp-events')
  const eventsTitle = q<HTMLDivElement>('.insp-events-title')
  const childrenEl = q<HTMLDivElement>('.insp-children')
  const migrantsEl = q<HTMLDivElement>('.insp-migrants')
  q<HTMLButtonElement>('.insp-close').addEventListener('click', () => callbacks.onClose())
  q<HTMLButtonElement>('.insp-flyin').addEventListener('click', () => {
    if (selected >= 0) requestFlyIn(selected)
  })
  const collapseBtn = q<HTMLButtonElement>('.insp-collapse')
  let collapsed = loadFlag('worldseed.inspector.collapsed', false)
  const syncCollapsed = () => {
    root.classList.toggle('collapsed', collapsed)
    collapseBtn.setAttribute('aria-expanded', String(!collapsed))
    collapseBtn.title = collapsed ? 'Expand' : 'Collapse'
  }
  syncCollapsed()
  collapseBtn.addEventListener('click', () => {
    collapsed = !collapsed
    saveFlag('worldseed.inspector.collapsed', collapsed)
    syncCollapsed()
  })
  if (container.parentElement) {
    attachWidthHandle(root, { side: 'right', target: container.parentElement, cssVar: '--left-w', key: 'worldseed.leftWidth', min: 250, max: 460, initial: 292, label: 'Resize the inspector' })
  }

  // links to other settlements carry data-sid
  root.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement).closest('[data-sid]') as HTMLElement | null
    if (link) callbacks.onSelect(Number(link.dataset.sid))
  })

  let index: HistoryIndex | null = null
  let selected = -1
  let shownPop = -1
  let shownFood = -1
  let shownStatus = -1
  let shownEventCount = -1
  let shownCursor = -1
  let shownChildren = -1
  let shownTier = -1
  let shownLand = -1
  let shownStructures = -1
  let cell = -1
  let outpost = false
  const outpostEl = q<HTMLDivElement>('.insp-outpost')
  const landPos: SnapshotPos = { s0: 0, s1: 0, frac: 0 }

  const link = (id: number) => {
    const a = document.createElement('button')
    a.type = 'button'
    a.className = 'insp-link'
    a.dataset.sid = String(id)
    a.textContent = settlementName(index!.history, id)
    return a
  }
  const trade = createTradeSection(q<HTMLDivElement>('.insp-wealth'), q<HTMLDivElement>('.insp-trade'), link)

  function drawSparkline(ix: HistoryIndex, id: number) {
    const h = ix.history
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = SPARK_W * dpr
    canvas.height = SPARK_H * dpr
    canvas.style.width = `${SPARK_W}px`
    canvas.style.height = `${SPARK_H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, SPARK_W, SPARK_H)
    let max = 0
    for (let s = 0; s < h.snapshotCount; s++) max = Math.max(max, h.population[s * ix.count + id])
    peakEl.textContent = max > 0 ? `peak ${formatInt(max)}` : ''
    if (max <= 0) return
    const x = (s: number) => (s / Math.max(1, h.snapshotCount - 1)) * SPARK_W
    const y = (p: number) => SPARK_H - 2 - (p / max) * (SPARK_H - 6)
    ctx.beginPath()
    ctx.moveTo(0, SPARK_H)
    for (let s = 0; s < h.snapshotCount; s++) ctx.lineTo(x(s), y(h.population[s * ix.count + id]))
    ctx.lineTo(SPARK_W, SPARK_H)
    ctx.closePath()
    ctx.fillStyle = 'rgba(255, 196, 92, 0.18)'
    ctx.fill()
    ctx.beginPath()
    for (let s = 0; s < h.snapshotCount; s++) {
      const p = h.population[s * ix.count + id]
      if (s === 0) ctx.moveTo(x(s), y(p))
      else ctx.lineTo(x(s), y(p))
    }
    ctx.strokeStyle = 'rgba(255, 204, 110, 0.95)'
    ctx.lineWidth = 1.25
    ctx.stroke()
  }

  /** One event line: a single event, or a decade of trade or migration events of one kind. */
  interface Line {
    churn: 'trade' | 'out' | 'in' | null
    decade: number
    members: HistoryEvent[]
  }

  /** The lines for events [lo, lo + n) of the selection, newest first: notable events all kept, at most CHURN_LINES gathered ones. */
  function pickEventLines(h: History, list: Int32Array, lo: number, n: number, sel: number): Line[] {
    const lines: Line[] = []
    const groupAt = new Map<string, number>()
    let churn = 0
    for (let k = lo + n - 1; k >= lo && lines.length < RECENT_EVENTS; k--) {
      const e = h.events[list[k]]
      const cls = e.type === EventType.TradeOpened || e.type === EventType.TradeClosed ? 'trade' : e.type === EventType.Migration ? (e.settlement === sel ? 'out' : 'in') : null
      if (!cls) {
        lines.push({ churn: null, decade: 0, members: [e] })
        continue
      }
      const decade = Math.floor(e.year / CHURN_BUCKET)
      const key = cls + decade
      const at = groupAt.get(key)
      if (at !== undefined) {
        if (at >= 0) lines[at].members.push(e)
        continue
      }
      if (churn >= CHURN_LINES) {
        groupAt.set(key, -1) // over the budget: dropped
        continue
      }
      churn++
      groupAt.set(key, lines.length)
      lines.push({ churn: cls, decade, members: [e] })
    }
    return lines
  }

  /** renaming: an event line names towns as during its year (the latest of a gathered decade). */
  function renderLine(h: History, line: Line): HTMLLIElement {
    return withEventNames(line.members[0].year, () => renderLineAt(h, line))
  }

  function renderLineAt(h: History, line: Line): HTMLLIElement {
    const li = document.createElement('li')
    const yr = document.createElement('span')
    yr.className = 'ev-year'
    const span = document.createElement('span')
    span.className = 'ev-text'
    const m = line.members
    if (line.churn === null || m.length === 1) {
      const e = m[0]
      li.className = `ev-${eventKind(e)}`
      yr.textContent = String(e.year)
      const text = describeEventFor(h, e, selected)
      const other = e.settlement === selected ? e.other : e.settlement
      if (other >= 0 && other !== selected && other < h.settlements.length) {
        // make the other settlement's name a link
        const name = settlementName(h, other)
        const at = text.indexOf(name)
        if (at >= 0) span.append(text.slice(0, at), link(other), text.slice(at + name.length))
        else span.textContent = text
      } else span.textContent = text
    } else {
      yr.textContent = `${line.decade * CHURN_BUCKET}s`
      const partners = new Set<number>()
      for (const e of m) partners.add(e.settlement === selected ? e.other : e.settlement)
      if (line.churn === 'trade') {
        let opened = 0, closed = 0
        for (const e of m) {
          if (e.type === EventType.TradeOpened) opened++
          else closed++
        }
        const routes = (k: number) => `${k} trade ${k === 1 ? 'route' : 'routes'}`
        span.textContent = opened && closed ? `Opened ${opened} and closed ${routes(closed)}` : opened ? `Opened ${routes(opened)}` : `Closed ${routes(closed)}`
        li.className = opened ? 'ev-trade' : 'ev-tradeEnd'
      } else {
        let people = 0
        for (const e of m) people += e.value
        span.textContent = `${line.churn === 'out' ? 'Sent' : 'Took in'} ${formatInt(people)} migrants in ${m.length} groups`
        li.className = 'ev-migration'
      }
      const names = [...partners].filter((p) => p >= 0).slice(0, 8).map((p) => settlementName(h, p))
      li.title = `${line.churn === 'trade' ? 'With' : line.churn === 'out' ? 'To' : 'From'} ${names.join(', ')}${partners.size > names.length ? ' and others' : ''}`
    }
    li.append(yr, span)
    return li
  }

  const peopleSlot = q<HTMLDivElement>('.insp-people')
  const speciesSlot = q<HTMLDivElement>('.insp-species')
  const politySlot = q<HTMLDivElement>('.insp-faction')
  const rulersSlot = q<HTMLDivElement>('.insp-rulers')
  const goodsSlot = q<HTMLDivElement>('.insp-goods')
  const diseaseSlot = q<HTMLDivElement>('.insp-disease')
  const travelSlot = q<HTMLDivElement>('.insp-travel')
  const ideasSlot = q<HTMLDivElement>('.insp-ideas')

  return {
    peopleSlot,
    speciesSlot,
    politySlot,
    rulersSlot,
    goodsSlot,
    diseaseSlot,
    travelSlot,
    ideasSlot,
    get selected() {
      return selected
    },
    show(ix: HistoryIndex, world: World, id: number) {
      index = ix
      censusWorld = world
      selected = id
      const h = ix.history
      const s = h.settlements[id]
      nameEl.textContent = settlementName(h, id)
      shownNames = -1
      originEl.replaceChildren()
      // an expedition base: whose it is, where it stands, how it is kept up
      outpost = ix.isOutpost[id] === 1
      root.classList.toggle('is-outpost', outpost)
      outpostEl.classList.toggle('hidden', !outpost)
      outpostEl.replaceChildren()
      // (renaming: its founders' town named as it was at the founding)
      if (outpost) withEventNames(s.foundedYear, () => {
        originEl.append(`Founded in year ${s.foundedYear} by an expedition`)
        if (s.parent >= 0) originEl.append(' from ', link(s.parent))
        outpostEl.append('Expedition base' + (s.parent >= 0 ? ' of ' : ''))
        if (s.parent >= 0) outpostEl.append(link(s.parent))
        outpostEl.append(`, ${describeOutpostSite(world, s.cell)}. It farms nothing: its people live on what ${s.parent >= 0 ? settlementName(h, s.parent) : 'its founders'} sends.`)
      })
      else withEventNames(s.foundedYear, () => {
        originEl.append(`Founded in year ${s.foundedYear} · `)
        if (s.parent >= 0) originEl.append('by migrants from ', link(s.parent))
        else originEl.append(originWords(h, id))
      })
      capEl.textContent = formatInt(h.capacity[s.cell] ?? 0)
      biomeEl.textContent = (BIOME_NAMES[world.biome[s.cell]] ?? 'Unknown') + (world.lake[s.cell] === 1 ? ' (lake)' : '')
      yearsEl.textContent = String(h.years)
      drawSparkline(ix, id)
      shownPop = -1
      shownFood = -1
      shownStatus = -1
      shownEventCount = -1
      shownCursor = -1
      shownChildren = -1
      shownTier = -1
      shownLand = -1
      shownStructures = -1
      shownLandmarksSel = -1
      cell = s.cell
      landEl.classList.toggle('hidden', ix.land === null)
      trade.show(ix, id)
      root.classList.remove('hidden')
    },
    hide() {
      selected = -1
      root.classList.add('hidden')
    },
    setPlaces(text: string) {
      if (placesEl.textContent === text) return
      placesEl.textContent = text
      placesEl.classList.toggle('hidden', text === '')
    },
    update(year: number, s0: number, population: number) {
      if (!index || selected < 0) return
      const h = index.history
      const s = h.settlements[selected]
      const alive = isAlive(s, year)

      // renaming: the name it bears at the year, its former names, the towns it names (once per change of the names in force)
      const ne = namesEpoch()
      if (ne !== shownNames) {
        nameEl.textContent = settlementName(h, selected)
        if (shownNames >= 0) {
          shownChildren = -1
          trade.show(index, selected)
        }
        shownNames = ne
        const nl = namesLine(h, selected, year)
        namesEl.textContent = nl
        namesEl.classList.toggle('hidden', nl === '')
      }

      const pop = alive ? Math.round(population) : -2
      if (pop !== shownPop) {
        shownPop = pop
        popEl.textContent = alive ? formatInt(pop) : '—'
        const line = alive && censusWorld && !s.outpost ? censusLine(censusWorld, h, selected, population) : ''
        censusEl.textContent = line
        censusEl.classList.toggle('hidden', line === '')
      }
      const f = alive ? Math.round(100 * (h.food[s0 * index.count + selected] ?? 0)) : 0
      if (f !== shownFood) {
        shownFood = f
        foodValEl.textContent = alive ? `${f}%` : '—'
        barFill.style.width = `${f}%`
        barFill.classList.toggle('low', f < 60)
      }
      const status = year < s.foundedYear ? 1 : s.abandonedYear >= 0 && year >= s.abandonedYear ? 2 : 0
      if (status !== shownStatus) {
        shownStatus = status
        statusEl.textContent = status === 1 ? `Not founded yet (year ${s.foundedYear})` : status === 2 ? `Abandoned in year ${s.abandonedYear}` : ''
        if (outpost && status === 0) statusEl.textContent = s.abandonedYear >= 0 ? `Kept up until year ${s.abandonedYear}` : 'Kept up to the end of the record'
        statusEl.classList.toggle('hidden', status === 0 && !outpost)
        statusEl.classList.toggle('kept', outpost && status === 0)
        root.classList.toggle('dead', status !== 0)
      }
      const tier = alive ? (outpost ? 9 : tierOf(population)) : -1
      if (tier !== shownTier) {
        shownTier = tier
        tierEl.classList.toggle('hidden', tier < 0)
        tierEl.classList.toggle('town', tier === Tier.Town)
        tierEl.classList.toggle('city', tier === Tier.City)
        tierEl.classList.toggle('outpost', tier === 9)
        tierEl.textContent = tier === 9 ? 'Expedition base' : tier >= 0 ? TIER_NAMES[tier as Tier] : ''
      }

      // how cultivated and how worn its own cell is (interpolated between land snapshots)
      const land = index.land
      if (land && cell >= 0 && cell < land.cellCount) {
        landSnapshotAt(land, year, landPos)
        const u = percentAt(land.landUse, land.cellCount, cell, landPos)
        const d = percentAt(land.degradation, land.cellCount, cell, landPos)
        if (u * 1000 + d !== shownLand) {
          shownLand = u * 1000 + d
          cultEl.textContent = `${u}%`
          degEl.textContent = `${d}%`
        }
      }

      // its ports and dams built so far; ruined ones struck through
      const s0s = index.structureOffsets[selected], s1s = index.structureOffsets[selected + 1]
      let key = 0
      for (let k = s0s; k < s1s; k++) {
        const st = index.structures[index.structureList[k]]
        if (year >= st.builtYear) key += 1
        if (st.lostYear >= 0 && year >= st.lostYear) key += 1000
      }
      if (key !== shownStructures) {
        shownStructures = key
        structuresEl.replaceChildren()
        let shown = 0
        for (let k = s0s; k < s1s; k++) {
          const st = index.structures[index.structureList[k]]
          if (year < st.builtYear) continue
          const ruined = st.lostYear >= 0 && year >= st.lostYear
          const item = document.createElement('div')
          if (ruined) item.className = 'lost'
          if (st.type === StructureType.Walls) {
            // walls: the rings in use, numbered from the innermost; slighted ones (taken down after the town fell) said so
            let ring = 0
            for (let j = s0s; j < k; j++) {
              const o = index.structures[index.structureList[j]]
              if (o.type === StructureType.Walls && year >= o.builtYear && !(o.lostYear >= 0 && year >= o.lostYear)) ring++
            }
            item.textContent = ruined
              ? `Walls built in ${st.builtYear}, ${wallSlighted(politiesOf(index.history), selected, st.lostYear) ? 'slighted' : 'abandoned'} in ${st.lostYear}`
              : `Walls${ring > 0 ? ` (ring ${ring + 1})` : ''}, built in ${st.builtYear}`
          } else if (st.type === StructureType.Fort) item.textContent = `Fort on its border, built in ${st.builtYear}` + (ruined ? `, abandoned in ${st.lostYear}` : '')
          else if (st.type === StructureType.Mine) item.textContent = `Mine, sunk in ${st.builtYear}` + (ruined ? `, abandoned in ${st.lostYear}` : '')
          else if (st.type === StructureType.Factory) item.textContent = `Merchants' quarter abroad, opened in ${st.builtYear}` + (ruined ? `, closed in ${st.lostYear}` : '')
          else item.textContent = `${st.type === StructureType.Dam ? 'Dam' : 'Port'}, built in ${st.builtYear}` + (ruined ? `, in ruins since ${st.lostYear}` : '')
          structuresEl.appendChild(item)
          shown++
        }
        structuresEl.classList.toggle('hidden', shown === 0)
      }

      // (the lines change with the whole year at most: worked out once per year shown)
      if (selected !== shownLandmarksSel || Math.floor(year) !== shownLandmarksYear) {
        shownLandmarksSel = selected
        shownLandmarksYear = Math.floor(year)
        const lines = landmarkLines(h, selected, year)
        const key = selected + ':' + lines.map((l) => l[0]).join('|')
        if (key !== shownLandmarks) {
          shownLandmarks = key
          landmarksEl.replaceChildren()
          if (lines.length) {
            const t = document.createElement('div')
            t.className = 'insp-landmarks-title'
            t.textContent = lines.length === 1 ? 'Landmark' : `Landmarks (${lines.length})`
            landmarksEl.appendChild(t)
          }
          for (const [text, cls] of lines) {
            const item = document.createElement('div')
            if (cls) item.className = cls
            item.textContent = text
            landmarksEl.appendChild(item)
          }
          landmarksEl.classList.toggle('hidden', lines.length === 0)
        }
      }

      trade.update(year, s0)

      const c = Math.round((year / Math.max(1, h.years)) * SPARK_W)
      if (c !== shownCursor) {
        shownCursor = c
        cursor.style.left = `${((100 * c) / SPARK_W).toFixed(2)}%` // the sparkline stretches with the panel
      }

      const c0 = index.childOffsets[selected]
      const nc = countUpTo(index.childYear, year, c0, index.childOffsets[selected + 1])
      if (nc !== shownChildren) {
        shownChildren = nc
        childrenEl.replaceChildren()
        childrenEl.classList.toggle('hidden', nc === 0)
        if (nc > 0) {
          childrenEl.append('Sent settlers to ')
          const shown = Math.min(nc, CHILD_LINKS)
          for (let k = 0; k < shown; k++) {
            if (k > 0) childrenEl.append(', ')
            childrenEl.append(link(index.childList[c0 + k]))
          }
          if (nc > shown) childrenEl.append(` and ${nc - shown} more`)
        }
      }

      const lo = index.eventOffsets[selected]
      const hi = index.eventOffsets[selected + 1]
      const n = countUpTo(index.eventListYear, year, lo, hi)
      if (n !== shownEventCount) {
        shownEventCount = n
        eventsEl.replaceChildren()
        for (const line of pickEventLines(h, index.eventList, lo, n, selected)) eventsEl.appendChild(renderLine(h, line))
        eventsTitle.textContent = n > 0 ? `Recent events (${formatInt(n)})` : 'No events yet'
        let groups = 0, people = 0
        for (let k = lo; k < lo + n; k++) {
          const e = h.events[index.eventList[k]]
          if (e.type === EventType.Migration && e.other === selected) {
            groups++
            people += e.value
          }
        }
        migrantsEl.classList.toggle('hidden', groups === 0)
        migrantsEl.textContent = groups > 0 ? `Took in ${formatInt(people)} migrants in ${groups} ${groups === 1 ? 'group' : 'groups'}` : ''
      }
    },
  }
}
