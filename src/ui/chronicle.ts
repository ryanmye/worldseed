// Chronicle: the most recent notable events up to the current year, newest first.
// A fixed pool of rows is reused; a row's text is only rewritten when what it shows
// changes. Aggregated entries (famine bursts, a decade of foundings) count only their
// members up to the current year. What is shown is a pure function of the year
// (binary searches into the index), so scrubbing backwards is exact.

import { EventType } from '../contract.ts'
import { describeEvent, describeFamineBurst, describeFoundings, describeMigrations, describeTradeBurst, eventKind } from './format.ts'
import { countUpTo, EntryKind, FOUNDING_BUCKET_YEARS, type HistoryIndex } from './historyIndex.ts'

const ROWS = 40

export interface ChronicleCallbacks {
  onSelect(id: number): void
}

export interface Chronicle {
  setIndex(index: HistoryIndex | null): void
  update(year: number): void
}

export function createChronicle(container: HTMLElement, callbacks: ChronicleCallbacks): Chronicle {
  const root = document.createElement('div')
  root.className = 'panel chronicle'
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'chr-head'
  const title = document.createElement('span')
  title.className = 'chr-title'
  title.textContent = 'Chronicle'
  const count = document.createElement('span')
  count.className = 'chr-count'
  const caret = document.createElement('span')
  caret.className = 'chr-caret'
  caret.textContent = '▾'
  head.append(title, count, caret)
  const list = document.createElement('ol')
  list.className = 'chr-list'
  const empty = document.createElement('div')
  empty.className = 'chr-empty'
  empty.textContent = 'Nothing has happened yet.'
  root.append(head, list, empty)
  container.appendChild(root)

  /** `entry` and `shown` (members counted) identify what the row displays; `target` is the settlement a click selects. */
  interface Row { li: HTMLLIElement; year: HTMLSpanElement; text: HTMLSpanElement; entry: number; shown: number; target: number }
  const rows: Row[] = []
  for (let i = 0; i < ROWS; i++) {
    const li = document.createElement('li')
    const year = document.createElement('span')
    year.className = 'ev-year'
    const text = document.createElement('span')
    text.className = 'ev-text'
    li.append(year, text)
    li.hidden = true
    list.appendChild(li)
    rows.push({ li, year, text, entry: -1, shown: 0, target: -1 })
  }

  let index: HistoryIndex | null = null
  let collapsed = false
  let shownMembers = -1
  let lastYear = 0

  try {
    collapsed = localStorage.getItem('worldseed.chronicle.collapsed') === '1'
  } catch {
    // storage unavailable: default expanded
  }
  root.classList.toggle('collapsed', collapsed)

  head.addEventListener('click', () => {
    collapsed = !collapsed
    root.classList.toggle('collapsed', collapsed)
    try {
      localStorage.setItem('worldseed.chronicle.collapsed', collapsed ? '1' : '0')
    } catch {
      // ignore
    }
    head.blur()
    shownMembers = -1
    api.update(lastYear)
  })
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('li')
    if (!li || !index) return
    const row = rows.find((r) => r.li === li)
    if (row && row.entry >= 0 && row.target >= 0) callbacks.onSelect(row.target)
  })

  /** Writes entry k, with its first m members, into row r. */
  function render(ix: HistoryIndex, r: Row, k: number, m: number) {
    const h = ix.history
    const lo = ix.notableOffsets[k]
    const kind = ix.notableKind[k]
    let ev = ix.notableMembers[lo]
    let text: string
    let yearText: string
    if (kind === EntryKind.FamineBurst) {
      for (let q = lo + 1; q < lo + m; q++) if (h.events[ix.notableMembers[q]].value > h.events[ev].value) ev = ix.notableMembers[q]
      text = describeFamineBurst(h, h.events[ev], m)
      yearText = String(h.events[ev].year)
      r.target = h.events[ev].settlement
    } else if (kind === EntryKind.Foundings && m > 1) {
      let sameParent = true
      for (let q = lo + 1; q < lo + m; q++) {
        const e = h.events[ix.notableMembers[q]]
        if (e.value > h.events[ev].value) ev = ix.notableMembers[q]
        if (e.other !== h.events[ix.notableMembers[lo]].other) sameParent = false
      }
      text = describeFoundings(h, h.events[ev], m, sameParent)
      yearText = `${Math.floor(h.events[ev].year / FOUNDING_BUCKET_YEARS) * FOUNDING_BUCKET_YEARS}s`
      r.target = h.events[ev].other
    } else if (kind === EntryKind.Migrations && m > 1) {
      let people = 0
      for (let q = lo; q < lo + m; q++) {
        const e = h.events[ix.notableMembers[q]]
        people += e.value
        if (e.value > h.events[ev].value) ev = ix.notableMembers[q]
      }
      text = describeMigrations(h, h.events[ev], m, people)
      yearText = `${Math.floor(h.events[ev].year / FOUNDING_BUCKET_YEARS) * FOUNDING_BUCKET_YEARS}s`
      r.target = h.events[ev].other
    } else if ((kind === EntryKind.TradeOpenings || kind === EntryKind.TradeClosings) && m > 1) {
      // name the route between the largest pair of settlements
      const N = ix.count
      const weight = (i: number) => {
        const e = h.events[i]
        const s = Math.min(h.snapshotCount - 1, Math.max(0, Math.round(e.year / h.snapshotInterval)))
        return (h.population[s * N + e.settlement] ?? 0) + (e.other >= 0 ? h.population[s * N + e.other] ?? 0 : 0)
      }
      let best = weight(ev)
      for (let q = lo + 1; q < lo + m; q++) {
        const w = weight(ix.notableMembers[q])
        if (w > best) {
          best = w
          ev = ix.notableMembers[q]
        }
      }
      text = describeTradeBurst(h, h.events[ev], m, h.events[ev].type === EventType.TradeOpened)
      yearText = `${Math.floor(h.events[ev].year / FOUNDING_BUCKET_YEARS) * FOUNDING_BUCKET_YEARS}s`
      r.target = h.events[ev].settlement
    } else {
      text = describeEvent(h, h.events[ev])
      yearText = String(h.events[ev].year)
      r.target = h.events[ev].settlement
    }
    r.li.hidden = false
    const ek = eventKind(h.events[ev])
    r.li.className = ek === 'town' || ek === 'city' ? `ev-${ek} notable` : `ev-${ek}`
    r.year.textContent = yearText
    r.text.textContent = text
    r.li.title = `${kind !== EntryKind.Single && kind !== EntryKind.FamineBurst && m > 1 ? `The ${yearText}` : `Year ${yearText}`}: ${text}`
  }

  const api: Chronicle = {
    setIndex(ix: HistoryIndex | null) {
      index = ix
      shownMembers = -1
      for (const r of rows) {
        r.entry = -1
        r.target = -1
        r.li.hidden = true
      }
      root.classList.toggle('hidden', ix === null)
      count.textContent = ''
    },
    update(year: number) {
      lastYear = year
      if (!index) return
      // every new entry or new member of an aggregated entry reveals one more member year
      const members = countUpTo(index.memberYearsSorted, year)
      if (members === shownMembers) return
      shownMembers = members
      const n = countUpTo(index.notableYear, year)
      count.textContent = n > 0 ? String(n) : ''
      empty.hidden = n > 0 || collapsed
      if (collapsed) return
      for (let k = 0; k < ROWS; k++) {
        const r = rows[k]
        const entry = n - 1 - k
        if (entry < 0) {
          if (r.entry !== -1) {
            r.entry = -1
            r.target = -1
            r.li.hidden = true
          }
          continue
        }
        const lo = index.notableOffsets[entry]
        const m = countUpTo(index.notableMemberYear, year, lo, index.notableOffsets[entry + 1])
        if (entry === r.entry && m === r.shown) continue
        r.entry = entry
        r.shown = m
        render(index, r, entry, m)
      }
    },
  }
  api.setIndex(null)
  return api
}
