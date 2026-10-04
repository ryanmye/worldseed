// The inspector's wealth and trade section: a wealth bar with the settlement's rank, its
// trade routes, what it mainly exports and imports, and its current partners with the
// goods going each way and their relative volume (partners are links). Rebuilt only
// when the population snapshot (wealth) or the nearest trade snapshot (routes) changes.

import { formatInt, formatPopulation, goodName } from './format.ts'
import { isAlive, type HistoryIndex } from './historyIndex.ts'
import { GOOD_COLORS } from '../render/trade.ts'
import { GOOD_COUNT } from '../contract.ts'
import './trade.css'

/** Partners listed by name; the rest are counted. */
const PARTNER_ROWS = 6

export interface TradeSection {
  /** A new selection. */
  show(index: HistoryIndex, id: number): void
  /** Refresh for the current year; `s0` is the population snapshot. */
  update(year: number, s0: number): void
}

export function createTradeSection(wealthEl: HTMLElement, tradeEl: HTMLElement, link: (id: number) => HTMLElement): TradeSection {
  wealthEl.innerHTML = `
    <div class="readout-row">Wealth <span class="insp-wealth-val"></span></div>
    <div class="insp-bar"><div class="insp-bar-fill insp-wealth-fill"></div></div>
  `
  const wealthVal = wealthEl.querySelector('.insp-wealth-val') as HTMLSpanElement
  const wealthFill = wealthEl.querySelector('.insp-wealth-fill') as HTMLDivElement

  let index: HistoryIndex | null = null
  let selected = -1
  let shownWealthSnap = -1
  let shownTradeSnap = -1

  const goodDot = (g: number) => {
    const d = document.createElement('span')
    d.className = 'good-dot'
    d.style.background = GOOD_COLORS[g] ?? '#888'
    return d
  }
  /** "grain, fish and ore" with coloured dots. */
  const goodList = (goods: number[]) => {
    const frag = document.createDocumentFragment()
    goods.forEach((g, i) => {
      if (i > 0) frag.append(i === goods.length - 1 ? ' and ' : ', ')
      frag.append(goodDot(g), goodName(g))
    })
    return frag
  }

  function updateWealth(ix: HistoryIndex, id: number, year: number, s0: number) {
    const W = ix.wealth
    if (!W) return
    const N = ix.count
    const s = ix.history.settlements[id]
    if (!isAlive(s, year)) {
      wealthVal.textContent = '—'
      wealthFill.style.width = '0%'
      return
    }
    const w = W[s0 * N + id]
    const max = ix.wealthMax[s0]
    let rank = 1, alive = 0
    for (let i = 0; i < N; i++) {
      if (ix.history.population[s0 * N + i] <= 0) continue
      alive++
      if (W[s0 * N + i] > w) rank++
    }
    wealthVal.textContent = w > 0 ? `${formatPopulation(w)} · #${formatInt(rank)} of ${formatInt(alive)}` : 'none yet'
    wealthFill.style.width = `${max > 0 && w > 0 ? Math.max(3, (100 * Math.log1p(w)) / Math.log1p(max)) : 0}%`
  }

  function updateTrade(ix: HistoryIndex, id: number, t: number) {
    const td = ix.trade
    if (!td) return
    const T = td.routes
    const R = T.count
    const rows: { r: number; v: number }[] = []
    for (let k = td.routeOffsets[id]; k < td.routeOffsets[id + 1]; k++) {
      const r = td.routeList[k]
      const v = td.volume[t * R + r]
      if (v > 0) rows.push({ r, v })
    }
    rows.sort((a, b) => b.v - a.v || a.r - b.r)
    tradeEl.replaceChildren()
    tradeEl.classList.toggle('hidden', rows.length === 0)
    if (rows.length === 0) return

    let sea = 0
    const exported = new Float64Array(GOOD_COUNT), imported = new Float64Array(GOOD_COUNT)
    for (const { r, v } of rows) {
      if (td.bySea[r]) sea++
      const isA = T.a[r] === id
      exported[isA ? T.goodAB[r] : T.goodBA[r]] += v / 2
      imported[isA ? T.goodBA[r] : T.goodAB[r]] += v / 2
    }
    const top = (a: Float64Array) => {
      let total = 0
      for (const x of a) total += x
      return [...a.keys()].filter((g) => a[g] > 0 && a[g] >= 0.15 * total).sort((x, y) => a[y] - a[x]).slice(0, 2)
    }
    const head = document.createElement('div')
    head.className = 'insp-trade-head'
    head.textContent = `${rows.length} trade ${rows.length === 1 ? 'route' : 'routes'}` + (sea > 0 ? `, ${sea === rows.length ? (sea === 1 ? 'by sea' : 'all by sea') : `${sea} by sea`}` : '')
    tradeEl.appendChild(head)
    const ex = top(exported), im = top(imported)
    const summary = document.createElement('div')
    summary.className = 'insp-trade-summary'
    summary.append('Exports ', goodList(ex))
    if (im.length) summary.append(' · imports ', goodList(im))
    tradeEl.appendChild(summary)

    const title = document.createElement('div')
    title.className = 'insp-events-title'
    title.textContent = 'Trades with'
    tradeEl.appendChild(title)
    const list = document.createElement('ol')
    list.className = 'insp-partners'
    const max = rows[0].v
    for (const { r, v } of rows.slice(0, PARTNER_ROWS)) {
      const isA = T.a[r] === id
      const partner = isA ? T.b[r] : T.a[r]
      const out = isA ? T.goodAB[r] : T.goodBA[r]
      const back = isA ? T.goodBA[r] : T.goodAB[r]
      const li = document.createElement('li')
      li.title = `${formatInt(v)} loads a year${td.bySea[r] ? ', partly by sea' : ''}`
      const bar = document.createElement('span')
      bar.className = 'insp-partner-bar'
      const fill = document.createElement('span')
      fill.style.width = `${Math.max(8, (100 * v) / max)}%`
      bar.appendChild(fill)
      const text = document.createElement('span')
      text.className = 'insp-partner-text'
      if (out === back) text.append('Trades ', goodDot(out), `${goodName(out)} with `, link(partner))
      else text.append('Exports ', goodDot(out), `${goodName(out)} to `, link(partner), ', imports ', goodDot(back), goodName(back))
      li.append(bar, text)
      list.appendChild(li)
    }
    tradeEl.appendChild(list)
    if (rows.length > PARTNER_ROWS) {
      const more = document.createElement('div')
      more.className = 'insp-trade-more'
      more.textContent = `and ${rows.length - PARTNER_ROWS} more`
      tradeEl.appendChild(more)
    }
  }

  return {
    show(ix: HistoryIndex, id: number) {
      index = ix
      selected = id
      shownWealthSnap = -1
      shownTradeSnap = -1
      wealthEl.classList.toggle('hidden', ix.wealth === null)
      tradeEl.classList.add('hidden')
    },
    update(year: number, s0: number) {
      const ix = index
      if (!ix || selected < 0) return
      // alive or not changes with the year inside a snapshot too: key on both
      const wKey = s0 * 2 + (isAlive(ix.history.settlements[selected], year) ? 1 : 0)
      if (wKey !== shownWealthSnap) {
        shownWealthSnap = wKey
        updateWealth(ix, selected, year, s0)
      }
      const td = ix.trade
      if (td) {
        const t = Math.min(td.count - 1, Math.max(0, Math.round(year / td.interval)))
        if (t !== shownTradeSnap) {
          shownTradeSnap = t
          updateTrade(ix, selected, t)
        }
      }
    },
  }
}
