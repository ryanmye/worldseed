// families: the Houses tab of "Goods and trade" (goodsPanel.ts hosts it): the list of houses at the year, a house's detail, its
// map highlight (its lanes, home ring in gold and factors in its colour; the ships on its lanes carry its colour) and the
// inspector line "Its merchants hold N: House Veckin 41%, ..." (merchant-families.md §4.1).

import { FamilyEnd, FamilyRuin, FamilySeatClose, FamilySeatKind, type History } from '../contract.ts'
import { formatPopulation, settlementName } from './format.ts'
import {
  FamilyTitle, abilityWord, capitalSeries, famSnapAt, familiesOf, familyCapitals, familyHomeAt, familyLives, familyTitle, headAt, headFullName,
  kinWord, laneRunners, lanesRunAt, liveFamilies, seatCapitals, seatsOpenAt, townHouses, type FamilyData,
} from './familiesData.ts'

export interface HousesUi {
  el(tag: string, cls: string, ...parts: (string | Node)[]): HTMLElement
  dot(color: string): HTMLElement
  span(cls: string, text: string, tip?: string): HTMLElement
  row(kind: string, id: number, selected: boolean, ...cells: (string | Node)[]): HTMLElement
  settLink(id: number): HTMLElement
  note(text: string): HTMLElement
}

const END_WORDS = ['', 'bankrupt', 'faded', 'no heir', 'its town lost']
const RUIN_WORDS = ['', 'a fleet lost', 'a failed venture', 'a crown default', 'war', 'plague']
const CLOSE_WORDS = ['', 'withdrawn', 'bankrupt', 'seized', 'expelled', 'sacked', 'its town lost', 'closed']

export { familiesOf }

/** The Houses list at year y: live houses by capital, then the fallen (dimmed). */
export function housesPane(fd: FamilyData, y: number, sel: number, ui: HousesUi): HTMLElement[] {
  const h = fd.history
  const F = h.families
  const out: HTMLElement[] = []
  const live = liveFamilies(fd, y)
  if (!live.length) {
    out.push(ui.note(F.founded[0] > y ? `No merchant houses yet (the first in ${Math.min(...Array.from(F.founded))}).` : 'No merchant house trades now.'))
  } else {
    const top = live[0].capital || 1
    out.push(ui.el('div', 'gp-cap', 'Merchant houses'))
    for (const { family: f, capital } of live) {
      const facs = seatsOpenAt(fd, f, y).length - 1
      const bar = ui.el('span', 'gp-qbar')
      const fill = document.createElement('span')
      fill.style.width = `${Math.max(2, Math.min(100, (100 * capital) / top)).toFixed(0)}%`
      bar.append(fill)
      bar.title = `Capital ${formatPopulation(capital)}`
      const r = ui.row('family', f, sel === f, ui.dot(fd.css[f]), ui.span('gp-name', familyTitle(fd, f)), ui.span('gp-sub', settlementName(h, familyHomeAt(fd, f, y))), bar, ui.span('gp-num', facs > 0 ? String(facs) : '', 'Factors'))
      r.title = `${FamilyTitle(fd, f)} of ${settlementName(h, familyHomeAt(fd, f, y))}, founded ${F.founded[f]}: capital ${formatPopulation(capital)}${facs > 0 ? `, ${facs} ${facs === 1 ? 'factor' : 'factors'}` : ''}`
      out.push(r)
    }
  }
  const fallen: number[] = []
  for (let f = F.count - 1; f >= 0 && fallen.length < 24; f--) if (F.ended[f] >= 0 && F.ended[f] <= y) fallen.push(f)
  if (fallen.length) {
    const d = document.createElement('details')
    d.className = 'gp-fallen'
    const s = document.createElement('summary')
    s.textContent = 'Fallen houses'
    d.append(s)
    for (const f of fallen) {
      const why = F.end[f] === FamilyEnd.Bankrupt && F.ruin[f] !== FamilyRuin.None ? `bankrupt (${RUIN_WORDS[F.ruin[f]]})` : END_WORDS[F.end[f]]
      const r = ui.row('family', f, sel === f, ui.dot(fd.css[f]), ui.span('gp-name', familyTitle(fd, f)), ui.span('gp-sub', `${F.founded[f]}–${F.ended[f]}, ${why}`))
      r.classList.add('ended')
      d.append(r)
    }
    out.push(d)
  }
  return out
}

function sparkline(fd: FamilyData, f: number, y: number): HTMLElement {
  const h = fd.history
  const series = capitalSeries(fd, f)
  const q1 = famSnapAt(h, y)
  let q0 = 0
  while (q0 < q1 && series[q0] === 0) q0++
  const W = 220, H = 36
  let mx = 0
  for (let q = q0; q <= q1; q++) if (series[q] > mx) mx = series[q]
  const pts: string[] = []
  for (let q = q0; q <= q1; q++) pts.push(`${((W * (q - q0)) / Math.max(1, q1 - q0)).toFixed(1)},${(H - 2 - ((H - 4) * series[q]) / (mx || 1)).toFixed(1)}`)
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  svg.setAttribute('width', String(W))
  svg.setAttribute('height', String(H))
  svg.setAttribute('class', 'gp-spark')
  const pl = document.createElementNS(NS, 'polyline')
  pl.setAttribute('points', pts.join(' '))
  pl.setAttribute('fill', 'none')
  pl.setAttribute('stroke', fd.css[f])
  pl.setAttribute('stroke-width', '1.5')
  svg.append(pl)
  const wrap = document.createElement('div')
  wrap.title = `Capital ${h.snapshotInterval * q0}–${h.snapshotInterval * q1}, at most ${formatPopulation(mx)}`
  wrap.append(svg as unknown as Node)
  return wrap
}

function capitalAt(h: History, p: number, y: number, fallback: number): number {
  const x = p >= 0 ? h.polities[p] : undefined
  if (!x) return fallback
  let c = x.capitals[0] ?? fallback
  for (let k = 0; k < x.capitals.length; k++) if (x.capitalYears[k] <= y) c = x.capitals[k]
  return c
}

/** A house's detail at year y (lines appended to `detail`; `close` the deselect button). */
export function houseDetail(fd: FamilyData, f: number, y: number, ui: HousesUi, detail: HTMLElement, close: HTMLElement): void {
  const h = fd.history
  const F = h.families
  const line = (...parts: (string | Node)[]) => { const d = ui.el('div', 'gp-line', ...parts); detail.append(d); return d }
  const faint = (...parts: (string | Node)[]) => line(...parts).classList.add('gp-faint')
  detail.append(ui.el('div', 'gp-d-title', ui.dot(fd.css[f]), `${FamilyTitle(fd, f)} of ${settlementName(h, familyHomeAt(fd, f, y))}`, close))
  const origin: (string | Node)[] = [`Founded ${F.founded[f]} at `, ui.settLink(F.firstHome[f])]
  const fe = fd.eventsOf[f].map((i) => h.events[i]).find((e) => (e.type as number) === 161)
  if (F.cause[f] === 1 && fe && fe.other >= 0) origin.push(' on the profits of the lane to ', ui.settLink(fe.other))
  if (F.parent[f] >= 0) origin.push(`, a cadet line of House ${F.name[F.parent[f]]}`)
  line(...origin)
  if (y < F.founded[f]) { line('(not yet)'); return }
  const hd = headAt(fd, f, y)
  if (hd >= 0 && familyLives(fd, f, y)) {
    const age = y - F.headBorn[hd]
    line(`${headFullName(fd, hd)}, ${age}, head for ${y - F.headFrom[hd]} years (${kinWord(fd, hd)}); ${abilityWord(F.headAbility[hd])}`)
  }
  const caps = familyCapitals(fd, famSnapAt(h, y))
  if (familyLives(fd, f, y)) line(`Capital ${formatPopulation(caps.get(f) ?? 0)}`)
  detail.append(sparkline(fd, f, y))
  // seats
  const sc = seatCapitals(fd, famSnapAt(h, y))
  const open = seatsOpenAt(fd, f, y)
  for (const k of open) line(F.seatKind[k] === FamilySeatKind.Home ? 'Home: ' : 'Factor at ', ui.settLink(F.seatTown[k]), ` since ${F.seatFrom[k]} (${formatPopulation(sc.get(k) ?? 0)})`)
  for (const k of fd.seatsOf[f]) if (F.seatKind[k] === FamilySeatKind.Branch && F.seatTo[k] >= 0 && F.seatTo[k] <= y && F.seatClose[k] !== FamilySeatClose.Ended) faint('Factor at ', ui.settLink(F.seatTown[k]), ` ${F.seatFrom[k]}–${F.seatTo[k]}, ${CLOSE_WORDS[F.seatClose[k]]}`)
  // lanes
  const L = h.longHaul
  const lanes = lanesRunAt(fd, f, y)
  if (lanes.length && L) {
    const l = line('Runs the lanes ')
    lanes.slice(0, 5).forEach((r, i) => {
      if (i) l.append(', ')
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'gp-link'
      b.dataset.sel = 'lane'
      b.dataset.id = String(r)
      b.textContent = `${settlementName(h, L.a[r])} – ${settlementName(h, L.b[r])}`
      l.append(b)
    })
  }
  for (const m of fd.marriagesOf[f]) {
    if (F.marriageYear[m] > y) continue
    const dyn = h.dynasties[F.marriageDynasty[m]]
    const r = h.rulers[F.marriageRuler[m]]
    line(`${F.marriageDaughter[m] ? 'A daughter wed into' : 'A son wed a woman of'} House ${dyn?.name ?? '?'}, at `, ui.settLink(capitalAt(h, r ? r.polity : -1, F.marriageYear[m], F.firstHome[f])), ` (${F.marriageYear[m]}${F.marriageEnd[m] >= 0 && F.marriageEnd[m] <= y ? `–${F.marriageEnd[m]}` : ''})`)
  }
  for (const b of fd.backsOf[f]) {
    const w = F.backWar[b]
    if (h.wars.startYear[w] > y) continue
    const out = F.backOutcome[b] === 1 && h.wars.endYear[w] <= y ? ': won' : F.backOutcome[b] === 2 && h.wars.endYear[w] <= y ? ': lost' : ''
    line(`Backed the ${F.backSide[b] ? 'pretender' : 'crown'} in the civil war of ${h.wars.startYear[w]}${out}`)
  }
  for (const p of fd.patronsOf[f]) if (F.patronYear[p] <= y) line(`Paid for ${h.landmarks.name[F.patronLandmark[p]] ?? 'a great work'} (${F.patronYear[p]})`)
  // heads
  const hs = fd.headsOf[f].filter((k) => F.headFrom[k] <= y)
  if (hs.length > 1) {
    const strip = ui.el('div', 'gp-line gp-faint', 'Heads: ')
    strip.append(hs.map((k) => `${F.headName[k]} (${F.headFrom[k]}${F.headTo[k] >= 0 && F.headTo[k] <= y ? `–${F.headTo[k]}` : ''})`).join(', '))
    detail.append(strip)
  }
  if (F.ended[f] >= 0 && F.ended[f] <= y) faint(`Ended ${F.ended[f]}: ${F.end[f] === FamilyEnd.Bankrupt ? `bankrupt (${RUIN_WORDS[F.ruin[f]]})` : END_WORDS[F.end[f]]}`)
}

/** The highlight of a house at year y: its lanes (History.longHaul records), its seats (home gold, factors its colour). */
export function houseHighlight(fd: FamilyData, f: number, y: number): { legs: number[]; sett: number[]; rgb: [number, number, number][]; home: number } {
  const F = fd.history.families
  const legs = lanesRunAt(fd, f, y)
  const sett: number[] = [], rgb: [number, number, number][] = []
  let home = -1
  for (const k of seatsOpenAt(fd, f, y)) {
    sett.push(F.seatTown[k])
    if (F.seatKind[k] === FamilySeatKind.Home) { rgb.push([1, 0.82, 0.3]); home = F.seatTown[k] } else rgb.push(fd.rgb[f])
  }
  if (home < 0) home = familyHomeAt(fd, f, y)
  return { legs, sett, rgb, home }
}

/** The colour of the ships on each lane run by a house at year y (History.longHaul record -> sRGB). */
export function shipColors(fd: FamilyData, y: number): Map<number, [number, number, number]> {
  const m = new Map<number, [number, number, number]>()
  for (const [leg, f] of laneRunners(fd, y)) m.set(leg, fd.rgb[f])
  return m
}

/** ": House Veckin 41%, House Osra 12% (a factor of Osk)" for the inspector, or ''. */
export function housesAtLine(h: History, town: number, y: number, mw: number): string {
  const fd = familiesOf(h)
  if (!fd || !(mw > 0)) return ''
  const F = h.families
  const xs = townHouses(fd, town, y).filter((x) => x.capital >= 0.01 * mw).slice(0, 3)
  if (!xs.length) return ''
  return ': ' + xs.map((x) => `${familyTitle(fd, x.family)} ${Math.round((100 * x.capital) / mw)}%${F.seatKind[x.seat] === FamilySeatKind.Branch ? ` (a factor of ${settlementName(h, familyHomeAt(fd, x.family, y))})` : ''}`).join(', ')
}
