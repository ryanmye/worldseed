// Throne slice (lane N3): the seat dashboard, the context panel while seated (ui-additions 3, 3b, 3c, 3d, 6, 7; registered as
// `seat`, priority 10, ui/contextPanel.ts). It shows the realm's arms and the ruler's and heirs' medallions, the ambition
// (with a picker), the 50-year odds, the throne HUD (meters with ▲/▼ since the decision before, hazards each with a "Why?"),
// the "your realm" feed (successions, wars, what came of your choices, age milestones), and the reigns' summaries with their
// share links. Built from the History at each pause (hudModel.ts, callbacks.ts, summary.ts: the same data the cards and the
// bots read). On a phone the right column is the bottom sheet: the dashboard is compact there (seat.css).
import type { History } from '../../../contract.ts'
import { contextChanged, registerContext } from '../../contextPanel.ts'
import { AMBITIONS, ambitionLine } from './ambition.ts'
import { callbacksAt, realmNews, rulerTitle } from './callbacks.ts'
import { heirsAt, heirPhrase, reignAt, crownedAs } from './heirs.ts'
import { realmArms, portrait, realmColour } from './heraldry.ts'
import { ageMilestone, hudModel, oddsSentence } from './hudModel.ts'
import { reignSummary, shareLink } from './summary.ts'

export interface SeatDashboard {
  readonly root: HTMLElement
  /** The History at a pause (null: the seat ended). */
  update(h: History | null): void
}

export interface SeatDashboardDeps {
  host: HTMLElement
  seed(): number
  /** Restart the seat with these ambitions (the picker). */
  setAmbition(kind: number): void
  /** The current ambitions (seat=). */
  ambition(): number | undefined
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
function svg(cls: string, markup: string): HTMLElement {
  const e = el('span', cls)
  e.setAttribute('aria-hidden', 'true')
  e.innerHTML = markup // (our own generated SVG, no user text)
  return e
}

export function createSeatDashboard(deps: SeatDashboardDeps): SeatDashboard {
  const root = el('section', 'panel seat-dash')
  root.setAttribute('aria-label', 'Your throne')
  let active = false
  deps.host.insertBefore(root, deps.host.querySelector(':scope > .chronicle'))
  registerContext({ id: 'seat', priority: 10, root, active: () => active })
  const feedSeen = new Set<string>()

  function update(h: History | null) {
    const S = h?.seat
    active = !!(h && S && S.lostYear < 0)
    root.hidden = !active
    document.body.classList.toggle('seat-active', active) // (the Factions panel's "Take this throne" hides while seated: seat.css)
    if (!h || !S || !active) { contextChanged(); return }
    root.replaceChildren()
    const year = h.years
    const p = S.polityAt[Math.max(0, Math.min(S.polityAt.length - 1, year - S.seat.from))]
    const P = h.polities?.[p]
    const name = P?.name ?? 'the realm'
    const seed = deps.seed()
    const rim = realmColour(seed, p, name)
    // ---- the realm, the ruler, the heirs ----
    const head = el('div', 'seat-dash-head')
    head.append(svg('seat-dash-arms', realmArms(seed, p, name, 52)))
    const who = el('div', 'seat-dash-who')
    const age = P ? year - P.foundedYear : 0
    who.append(el('div', 'seat-dash-realm', name), el('div', 'seat-dash-age', `${age} years old · ${year}`))
    const ruler = reignAt(h, p, year)
    if (ruler) {
      const rr = el('div', 'seat-dash-ruler')
      rr.append(svg('seat-dash-portrait', portrait(seed, ruler.id, ruler.female, year - ruler.born, true, rim, 40)), el('span', '', `${rulerTitle(ruler)}, ${year - ruler.born} · ${year - ruler.acceded} years on the throne`))
      who.append(rr)
    }
    head.append(who)
    root.append(el('h3', 'panel-title', 'Your throne'), head)
    const lastD = S.decisions.count - 1
    const heirs = lastD >= 0 ? heirsAt(h, lastD).slice(0, 4) : []
    if (heirs.length) {
      const hs = el('div', 'seat-dash-heirs')
      hs.append(el('span', 'seat-dash-label', 'Heirs'))
      for (const x of heirs) {
        const c = el('span', 'seat-dash-heir')
        c.append(svg('seat-dash-portrait small', portrait(seed, (ruler?.dynasty ?? 0) * 4096 + x.born, x.female, year - x.born, false, rim, 26)), el('span', '', heirPhrase({ ...x, age: year - x.born })))
        hs.append(c)
      }
      root.append(hs)
    }
    // ---- ambition (and the picker) ----
    const amb = el('div', 'seat-dash-ambition')
    amb.append(el('span', '', ambitionLine(h, year) || 'No ambition declared.'))
    const pick = el('select', 'seat-dash-ambition-pick')
    pick.setAttribute('aria-label', 'Choose the reign’s ambition (the reign is replayed from the start)')
    pick.title = 'The reign’s ambition. Changing it replays the reign from its first year with the same choices where they still apply.'
    pick.append(el('option', '', 'Change ambition…'))
    for (const a of AMBITIONS) { const o = el('option', '', `${a.label}: ${a.goal}`); o.value = String(a.kind); if (deps.ambition() === a.kind) o.selected = true; pick.append(o) }
    pick.addEventListener('change', () => { const v = Number(pick.value); if (Number.isFinite(v)) deps.setAmbition(v) })
    amb.append(pick)
    root.append(amb)
    // ---- the odds and the HUD ----
    const m = hudModel(h, -1, year)
    if (m) {
      const odds = el('div', 'seat-dash-odds')
      odds.title = oddsSentence(m)
      odds.append(el('span', 'seat-dash-odds-num', m.oddsText), el('span', 'seat-dash-odds-label', 'odds the realm stands 50 years, if things stay as they are'), el('span', `seat-dash-change trend-${m.oddsTrend}`, m.oddsChange))
      root.append(odds)
      const meters = el('div', 'seat-dash-meters')
      for (const x of m.meters) {
        const row = el('div', 'seat-dash-meter')
        row.title = x.why
        row.append(el('span', 'seat-dash-label', x.label), el('span', 'seat-dash-val', x.text), el('span', `seat-dash-change trend-${x.trend}`, x.change))
        meters.append(row)
      }
      root.append(meters)
      const hz = el('div', 'seat-dash-hazards')
      hz.append(el('div', 'seat-dash-sub', 'Yearly hazards'))
      for (const x of m.hazards) {
        const row = el('div', 'seat-dash-hazard')
        const why = el('button', 'seat-dash-why', 'Why?')
        why.type = 'button'
        const text = el('div', 'seat-dash-whytext', x.why)
        text.hidden = true
        why.addEventListener('click', () => { text.hidden = !text.hidden })
        row.append(el('span', 'seat-dash-label', x.label), el('span', 'seat-dash-val', x.text), el('span', `seat-dash-change trend-${x.trend}`, x.change), why, text)
        hz.append(row)
      }
      hz.append(el('div', 'seat-dash-note', m.ageNote))
      root.append(hz)
    }
    // ---- the realm's feed ----
    const feed = el('div', 'seat-dash-feed')
    feed.append(el('div', 'seat-dash-sub', 'Your realm'))
    const items: { year: number; text: string; cls: string }[] = []
    for (const n of realmNews(h, p, S.seat.from, year)) items.push({ year: n.year, text: n.text, cls: n.kind })
    for (const c of callbacksAt(h, year + 1, S.seat.from, year - S.seat.from + 1, 40)) items.push({ year: c.year, text: c.text, cls: 'callback' })
    if (P) for (let y0 = S.seat.from; y0 < year; y0 += 100) { const t = ageMilestone(name, P.foundedYear, y0, Math.min(year, y0 + 100)); if (t) items.push({ year: Math.min(year, P.foundedYear + 100 * Math.floor((Math.min(year, y0 + 100) - P.foundedYear) / 100)), text: t, cls: 'milestone' }) }
    // breakaways and towns lost (play-test #1: 47 -> 32 settlements and no word of it): from the snapshots
    lostTowns(h, p, S.seat.from, year, items)
    items.sort((a, b) => b.year - a.year)
    const list = el('ol', 'seat-dash-feedlist')
    for (const x of items.slice(0, 24)) {
      const li = el('li', `seat-feed-${x.cls}`, x.text)
      const key = `${x.year}|${x.text}`
      if (!feedSeen.has(key)) { li.classList.add('new'); feedSeen.add(key) }
      list.append(li)
    }
    feed.append(list)
    root.append(feed)
    // ---- the reigns told (with share links) ----
    const past = (h.rulers ?? []).filter((r) => r.polity === p && r.ended >= 0 && r.ended > S.seat.from && r.ended <= year).slice(-4).reverse()
    if (past.length) {
      const rs = el('div', 'seat-dash-reigns')
      rs.append(el('div', 'seat-dash-sub', 'Reigns'))
      for (const r of past) {
        const sum = reignSummary(h, r, year)
        const d = el('details', 'seat-dash-reign')
        const s = el('summary', '')
        s.append(svg('seat-dash-portrait small', portrait(seed, r.id, r.female, r.ended - r.born, false, rim, 22)), el('span', '', `${sum.title} (${r.acceded}–${r.ended})`))
        d.append(s)
        for (const t of sum.lines) d.append(el('p', '', t))
        const a = el('a', 'seat-dash-share', 'Share this reign')
        a.href = shareLink(window.location.href, sum.year)
        a.title = 'A link that replays this reign (the same seat and choices)'
        d.append(a)
        rs.append(d)
      }
      root.append(rs)
    }
    void crownedAs
    contextChanged()
  }

  return { root, update }
}

/** "Lost: 12 towns since 801 (47 → 35)": a fall of a fifth or more of the realm's towns between snapshots. */
function lostTowns(h: History, p: number, from: number, to: number, out: { year: number; text: string; cls: string }[]): void {
  const N = h.settlements.length, I = h.snapshotInterval
  let prev = -1, prevY = -1
  for (let y = Math.ceil(from / I) * I; y <= to; y += I) {
    const q = Math.min(h.snapshotCount - 1, Math.floor(y / I))
    let n = 0
    for (let i = 0; i < N; i++) if (h.polity[q * N + i] === p) n++
    if (prev >= 5 && n <= 0.8 * prev) out.push({ year: y, text: `${y}: the realm has lost ${prev - n} towns since ${prevY} (${prev} → ${n}): risings, a war or a partition.`, cls: 'loss' })
    prev = n; prevY = y
  }
}
