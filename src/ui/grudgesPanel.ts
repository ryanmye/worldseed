// grudges and oaths, balance, arms: the polity panel's lines (grudges-and-oaths.md §3.9): grudges held and borne, the name for
// faithlessness and the oaths broken, armament and races, coalitions.

import { BondKind, EventType } from '../contract.ts'
import type { History } from '../contract.ts'
import { armsAt, armsWord, faithlessAt, faithlessWord, grudgeWord, racesOf, standingGrudges, wrongWords } from './grudgesData.ts'
import { bondActive, polityAt, polityAtYear, snapBefore, type PolitiesData } from './politiesData.ts'
import { settlementName } from './format.ts'

export interface PanelKit {
  cap: (text: string) => void
  line: (...parts: (string | Node)[]) => HTMLElement
  polityLink: (p: number, text?: string) => Node
}

/** The Grudges section of polity p's panel at `year` (snapshot s0); nothing when the history has none. */
export function grudgeSection(h: History, pd: PolitiesData, p: number, year: number, s0: number, k: PanelKit): void {
  const name = (id: number) => settlementName(h, id)
  const held = standingGrudges(h, p, year), borne = standingGrudges(h, p, year, true)
  const f = faithlessAt(h, p, s0)
  const broken = h.events.filter((e) => (e.type === EventType.OathBroken || e.type === EventType.Betrayal) && e.year <= year && polityAt(pd, e.settlement, snapBefore(pd, e.year)) === p)
  const m = armsAt(h, p, s0)
  const races = racesOf(h, p).filter((i) => h.armsRaces.start[i] <= year && (h.armsRaces.end[i] < 0 || h.armsRaces.end[i] > year))
  const B = pd.bonds
  // coalitions: >= 2 of its alliances against the same threat, or leagues against it
  const threats = new Map<number, number[]>()
  let against = 0
  if (B) {
    for (let b = 0; b < B.count; b++) {
      if (B.kind[b] !== BondKind.Alliance || !bondActive(pd, b, year)) continue
      const c = allianceThreat(h, pd, b)
      if (c === p) against++
      if (B.a[b] !== p && B.b[b] !== p) continue
      if (c < 0) continue
      const o = B.a[b] === p ? B.b[b] : B.a[b]
      const l = threats.get(c) ?? []
      l.push(o)
      threats.set(c, l)
    }
  }
  const coalition = [...threats.entries()].find(([, l]) => l.length >= 2)
  if (held.length === 0 && borne.length === 0 && f < 0.3 && broken.length === 0 && m < 0.05 && races.length === 0 && !coalition && against < 2) return
  k.cap('Grudges')
  for (const g of held.slice(0, 4)) {
    const d = k.line('Against ', k.polityLink(g.other, pd.names[g.other]), ': ')
    d.append(g.rows.slice(0, 2).map((i) => wrongWords(h, i, name)).join(', ') + (g.rows.length > 2 ? ` and ${g.rows.length - 2} more` : '') + ` · ${grudgeWord(g.w)}`)
  }
  if (borne.length > 0) {
    const d = k.line('Held against it by: ')
    borne.slice(0, 4).forEach((g, i) => {
      if (i > 0) d.append(', ')
      d.append(k.polityLink(g.other, pd.names[g.other]), ` (${wrongWords(h, g.rows[0], name)})`)
    })
    if (borne.length > 4) d.append(` and ${borne.length - 4} more`)
  }
  const fw = faithlessWord(f)
  if (fw || broken.length > 0) {
    const last = broken.length ? broken[broken.length - 1].year : -1
    k.line([fw, broken.length > 0 ? `Broke ${broken.length === 1 ? 'one oath' : `${broken.length} oaths`}, last in ${last}` : ''].filter(Boolean).join(' · ')).classList.add('fp-faint')
  }
  if (m >= 0.05 || races.length > 0) {
    const d = k.line(`Arms: ${armsWord(m)} (${m.toFixed(2)})`)
    for (const i of races.slice(0, 2)) {
      const o = h.armsRaces.a[i] === p ? h.armsRaces.b[i] : h.armsRaces.a[i]
      d.append(' · racing ', k.polityLink(o, pd.names[o]), ` since ${h.armsRaces.start[i]}`)
    }
  }
  if (coalition) {
    const [c, l] = coalition
    const d = k.line('Coalition: allied with ')
    l.forEach((o, i) => { if (i > 0) d.append(i === l.length - 1 ? ' and ' : ', '); d.append(k.polityLink(o, pd.names[o])) })
    d.append(' against ', k.polityLink(c, pd.names[c]))
  }
  if (against >= 2) k.line(`Against it: a league of ${against + 1} realms`)
}

/** The common rival of alliance bond b (the Alliance event's extra), or -1. */
function allianceThreat(h: History, pd: PolitiesData, b: number): number {
  const B = pd.bonds!
  for (const i of pd.eventsOf[B.a[b]]) {
    const e = h.events[i]
    if (e.type !== EventType.Alliance || e.year !== B.startYear[b]) continue
    const x = polityAtYear(pd, e.settlement, e.year)
    if ((x === B.a[b] && e.value === B.b[b]) || (x === B.b[b] && e.value === B.a[b])) return e.extra ?? -1
  }
  return -1
}
