// Settlement inspector panel. `show` builds the static parts once per selection
// (name, origin, cell facts, sparkline); `update` only touches text, a bar width
// and the sparkline cursor, and only when the displayed values actually change.

import { EventType, StructureType, type World } from '../contract.ts'
import { BIOME_NAMES } from '../render/palette.ts'
import { describeEventFor, eventKind, formatInt, settlementName } from './format.ts'
import { countUpTo, isAlive, landSnapshotAt, Tier, TIER_NAMES, tierOf, type HistoryIndex, type SnapshotPos } from './historyIndex.ts'

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
}

const RECENT_EVENTS = 6
/** Children listed by name; the rest are counted. */
const CHILD_LINKS = 8
const SPARK_W = 236
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
      <button type="button" class="insp-close" title="Close">×</button>
    </div>
    <div class="insp-origin"></div>
    <div class="insp-status"></div>
    <div class="readout-row">Population <span class="insp-pop"></span></div>
    <div class="readout-row">Food <span class="insp-food-val"></span></div>
    <div class="insp-bar"><div class="insp-bar-fill"></div></div>
    <div class="readout-row">Capacity <span class="insp-cap"></span></div>
    <div class="readout-row">Biome <span class="insp-biome"></span></div>
    <div class="insp-land hidden">
      <div class="readout-row">Cultivated <span class="insp-cult"></span></div>
      <div class="readout-row">Soil worn <span class="insp-deg"></span></div>
    </div>
    <div class="insp-structures hidden"></div>
    <div class="insp-children hidden"></div>
    <div class="insp-migrants hidden"></div>
    <div class="insp-spark-cap"><span>Population, year 0–<span class="insp-years"></span></span><span class="insp-spark-peak"></span></div>
    <div class="insp-spark">
      <canvas width="${SPARK_W}" height="${SPARK_H}"></canvas>
      <div class="insp-spark-cursor"></div>
    </div>
    <div class="insp-events-title">Recent events</div>
    <ol class="insp-events"></ol>
  `
  container.appendChild(root)
  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T
  const nameEl = q<HTMLSpanElement>('.insp-name-text')
  const tierEl = q<HTMLSpanElement>('.insp-tier')
  const landEl = q<HTMLDivElement>('.insp-land')
  const cultEl = q<HTMLSpanElement>('.insp-cult')
  const degEl = q<HTMLSpanElement>('.insp-deg')
  const structuresEl = q<HTMLDivElement>('.insp-structures')
  const originEl = q<HTMLDivElement>('.insp-origin')
  const statusEl = q<HTMLDivElement>('.insp-status')
  const popEl = q<HTMLSpanElement>('.insp-pop')
  const foodValEl = q<HTMLSpanElement>('.insp-food-val')
  const barFill = q<HTMLDivElement>('.insp-bar-fill')
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
  const landPos: SnapshotPos = { s0: 0, s1: 0, frac: 0 }

  const link = (id: number) => {
    const a = document.createElement('button')
    a.type = 'button'
    a.className = 'insp-link'
    a.dataset.sid = String(id)
    a.textContent = settlementName(index!.history, id)
    return a
  }

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

  return {
    get selected() {
      return selected
    },
    show(ix: HistoryIndex, world: World, id: number) {
      index = ix
      selected = id
      const h = ix.history
      const s = h.settlements[id]
      nameEl.textContent = settlementName(h, id)
      originEl.replaceChildren()
      originEl.append(`Founded in year ${s.foundedYear} · `)
      if (s.parent >= 0) originEl.append('by migrants from ', link(s.parent))
      else originEl.append('Original tribe')
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
      cell = s.cell
      landEl.classList.toggle('hidden', ix.land === null)
      root.classList.remove('hidden')
    },
    hide() {
      selected = -1
      root.classList.add('hidden')
    },
    update(year: number, s0: number, population: number) {
      if (!index || selected < 0) return
      const h = index.history
      const s = h.settlements[selected]
      const alive = isAlive(s, year)

      const pop = alive ? Math.round(population) : -2
      if (pop !== shownPop) {
        shownPop = pop
        popEl.textContent = alive ? formatInt(pop) : '—'
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
        statusEl.classList.toggle('hidden', status === 0)
        root.classList.toggle('dead', status !== 0)
      }
      const tier = alive ? tierOf(population) : -1
      if (tier !== shownTier) {
        shownTier = tier
        tierEl.classList.toggle('hidden', tier < 0)
        tierEl.classList.toggle('town', tier === Tier.Town)
        tierEl.classList.toggle('city', tier === Tier.City)
        tierEl.textContent = tier >= 0 ? TIER_NAMES[tier as Tier] : ''
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
          item.textContent = `${st.type === StructureType.Dam ? 'Dam' : 'Port'}, built in ${st.builtYear}` + (ruined ? `, in ruins since ${st.lostYear}` : '')
          structuresEl.appendChild(item)
          shown++
        }
        structuresEl.classList.toggle('hidden', shown === 0)
      }

      const c = Math.round((year / Math.max(1, h.years)) * SPARK_W)
      if (c !== shownCursor) {
        shownCursor = c
        cursor.style.transform = `translateX(${c}px)`
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
        for (let k = lo + n - 1; k >= Math.max(lo, lo + n - RECENT_EVENTS); k--) {
          const e = h.events[index.eventList[k]]
          const li = document.createElement('li')
          li.className = `ev-${eventKind(e)}`
          const yr = document.createElement('span')
          yr.className = 'ev-year'
          yr.textContent = String(e.year)
          const text = describeEventFor(h, e, selected)
          const other = e.settlement === selected ? e.other : e.settlement
          const span = document.createElement('span')
          span.className = 'ev-text'
          if (other >= 0 && other !== selected) {
            // make the other settlement's name a link
            const name = settlementName(h, other)
            const at = text.indexOf(name)
            if (at >= 0) span.append(text.slice(0, at), link(other), text.slice(at + name.length))
            else span.textContent = text
          } else span.textContent = text
          li.append(yr, span)
          eventsEl.appendChild(li)
        }
        eventsTitle.textContent = n > 0 ? `Recent events (${n})` : 'No events yet'
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
