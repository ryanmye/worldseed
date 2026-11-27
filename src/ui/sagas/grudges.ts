// Sagas: grudges and oaths, balance, arms (grudges-and-oaths.md §3.9). The chronicle register hedges ("it seems in part",
// "had a name for"): the simulation knows causes only as weights. The legend register tells it as a story.

import { EventType, WarKind } from '../../contract.ts'
import type { Ctx } from './facts.ts'
import { num, times, type PhraseTable, type Voice } from './voice.ts'
import { faithlessAt, wrongWords } from '../grudgesData.ts'

export const GRUDGE_T: PhraseTable = {
  betrayer: [['In {year} it broke faith with its ally, the {ally}, and made a separate peace with the {enemy}{gain}.'],
    ['In {year} the {state} sold the friendship of the {ally} to the {enemy}{gain}, and its name was spoken with scorn for a generation.']],
  turned: [[' It then made war on its former ally.'], [' Then it turned its spears on the friend it had forsaken.']],
  betrayed: [['In {year} its ally, the {ally}, deserted it in its war with the {enemy}.'], ['In {year} the {ally}, sworn to stand by it, left it alone before the {enemy}.']],
  truceBroke: [['It broke a sworn truce {times}, first in {year}, against the {victim}.'], ['{Times} its rulers forswore the peace, first in {year}, against the {victim}.']],
  revenge: [['The {wrong} was not forgotten: in {year} it went to war with the {foe}, it seems in part to avenge it.'], ['The {wrong} cried out for {n} winters, until in {year} the {state} rode against the {foe} to answer it.']],
  faithless: [['Among its neighbours it had a name for faithlessness.'], ['Its word, men said, was written on water.']],
  bandwagon: [['Too weak to stand against the {h}, in {year} it sided with it.'], ['Too small to stand against the {h} and with no friend to stand beside it, the {state} chose to bend rather than break.']],
  armsRace: [['From {year} it armed against the {rival}, and the {rival} against it{end}.'], ['From {year} the forges of the {state} were never cold, for every spear the {rival} raised it raised two{end}.']],
  yBetrayal: [['In {year} {x} broke faith with {q}.'], ['In {year} {x} forsook {q}, its sworn friend.']],
  yArms: [['In those years {a} and {b} raised levies against each other.'], ['In those years {a} and {b} counted each other\'s spears.']],
}

/** The grudges sentences of polity p's state saga (section hWar), in order. */
export function grudgeLines(c: Ctx, v: Voice, p: number): string[] {
  const h = c.h, pd = c.pd!
  const W = pd.wars
  const out: string[] = []
  const Y = c.Y
  if (!W || !h.grievances) return out
  const mine = (i: number) => c.polityOf(c.ev(i).settlement, c.ev(i).year) === p
  // betrayals by it, and of it
  const bet = c.type(EventType.Betrayal).filter((i) => c.ev(i).year <= Y)
  for (const i of bet.filter(mine).slice(0, 1)) {
    const e = c.ev(i)
    const ally = c.polityOf(e.other, e.year)
    const enemy = e.value >= 0 && e.value < W.count ? W.defender[e.value] : -1
    let ceded = 0
    for (const j of c.type(EventType.Joined)) { const f = c.ev(j); if (f.year === e.year && f.value === p) ceded++ }
    out.push(v.p('betrayer', { year: e.year, ally: c.pname(ally), enemy: c.pname(enemy), state: c.pname(p), gain: ceded > 0 ? (ceded === 1 ? ', which gave it a town' : `, which gave it ${num(ceded)} towns`) : '' }) + (e.extra === 1 ? v.p('turned') : ''))
  }
  for (const i of bet.filter((i) => c.polityOf(c.ev(i).other, c.ev(i).year) === p).slice(0, 1)) {
    const e = c.ev(i)
    const enemy = e.value >= 0 && e.value < W.count ? W.defender[e.value] : -1
    out.push(v.p('betrayed', { year: e.year, ally: c.pname(c.polityOf(e.settlement, e.year)), enemy: c.pname(enemy) }))
  }
  // truces it broke
  const tr = c.type(EventType.OathBroken).filter((i) => c.ev(i).year <= Y && c.ev(i).extra === 0 && mine(i))
  if (tr.length) {
    const e = c.ev(tr[0])
    const t = times(tr.length)
    out.push(v.p('truceBroke', { times: t, Times: t.charAt(0).toUpperCase() + t.slice(1), year: e.year, victim: c.pname(c.polityOf(e.other, e.year)) }))
  }
  // the strongest revenge war it fought
  let best = -1, bw = 0
  for (const w of pd.warsOf[p] ?? []) {
    if (W.attacker[w] !== p || W.startYear[w] > Y || W.kind[w] === WarKind.CivilWar) continue
    const r = W.cause[w] ?? -1
    if (r < 0 || r >= h.grievances.count) continue
    if (h.grievances.weight[r] > bw) { bw = h.grievances.weight[r]; best = w }
  }
  if (best >= 0) {
    const r = W.cause[best]
    const y0 = h.grievances.year[r]
    out.push(v.p('revenge', { wrong: wrongWords(h, r, (id) => c.name(id, y0)).replace(/ in \d+$/, '').replace(/, in \d+$/, ''), year: W.startYear[best], foe: c.pname(W.defender[best]), n: num(Math.max(1, W.startYear[best] - y0)), state: c.pname(p) }))
  }
  // bandwagoning
  const bw0 = c.type(EventType.Bandwagon).find((i) => c.ev(i).year <= Y && mine(i))
  if (bw0 !== undefined) out.push(v.p('bandwagon', { h: c.pname(c.ev(bw0).value), year: c.ev(bw0).year, state: c.pname(p) }))
  // its longest arms race
  const R = h.armsRaces
  if (R) {
    let ri = -1, rl = 0
    for (let i = 0; i < R.count; i++) {
      if ((R.a[i] !== p && R.b[i] !== p) || R.start[i] > Y) continue
      const end = R.end[i] >= 0 && R.end[i] <= Y ? R.end[i] : Y
      if (end - R.start[i] > rl) { rl = end - R.start[i]; ri = i }
    }
    if (ri >= 0 && rl >= 20) {
      const o = R.a[ri] === p ? R.b[ri] : R.a[ri]
      const end = R.end[ri] >= 0 && R.end[ri] <= Y ? (R.endCause[ri] === 1 ? `, until war came in ${R.end[ri]}` : R.endCause[ri] === 2 ? `, until both tired of it by ${R.end[ri]}` : '') : ''
      out.push(v.p('armsRace', { year: R.start[ri], rival: c.pname(o), state: c.pname(p), end }))
    }
  }
  // its name for faithlessness at its height
  let peak = 0
  for (let s = 0; s < h.snapshotCount && s * h.snapshotInterval <= Y; s++) peak = Math.max(peak, faithlessAt(h, p, s))
  if (peak >= 1) out.push(v.p('faithless'))
  return out
}

/** The decade chronicle's grudges sentences for the events `of` gives. */
export function grudgeYearLines(c: Ctx, v: Voice, of: (t: number) => { year: number; settlement: number; other: number; value: number; extra?: number }[]): string[] {
  const out: string[] = []
  const b = of(EventType.Betrayal)[0] ?? of(EventType.OathBroken).find((e) => e.extra === 1)
  if (b) out.push(v.p('yBetrayal', { year: b.year, x: c.pname(c.polityOf(b.settlement, b.year)), q: c.pname(c.polityOf(b.other, b.year)) }))
  const a = of(EventType.ArmsRace).find((e) => e.extra === 0)
  if (a) out.push(v.p('yArms', { a: c.pname(c.polityOf(a.settlement, a.year)), b: c.pname(c.polityOf(a.other, a.year)) }))
  return out
}
