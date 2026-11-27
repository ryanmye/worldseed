// Sagas: classes and the secular cycle (society-secular-cycles.md §4.4). The chronicle register states the record and hedges
// every causal reading (cycles and causes are inferences); the legend tells it, heightened and certain. Numbers are rounded.

import { EventType, SecularPhase } from '../../contract.ts'
import type { HistoryEvent } from '../../contract.ts'
import type { Ctx } from './facts.ts'
import type { PhraseTable, Voice } from './voice.ts'

export const SOC_T: PhraseTable = {
  socCrisis: [['From about {year} the realm seems to have had more lords than lands to give them, and the quarrels of the great houses, by most accounts, opened its troubles.'], ['In {year} the sons of the great houses were too many for its halls, and they turned their swords on one another.']],
  socDear: [['After the pestilence of {year}, it is recorded, hands were few and a labourer could ask {rise} the old wage.'], ['The plague of {year} passed, and the fields called for reapers who were not there; the poor man named his price.']],
  socDearPlain: [['In {year}, it is recorded, hands were few and a labourer could ask {rise} the old wage.'], ['In {year} the fields called for reapers who were not there, and the poor man named his price.']],
  socSerf: [['In {year} its lords bound their peasants to the land; the old freedoms, it seems, did not soon return.'], ['In {year} its lords put the yoke on the ploughman\'s neck, and his sons and their sons wore it.']],
  socFree: [['By {year} bondage had ended there; the lords, by some accounts, could no longer hold men who could find better masters.'], ['In {year} its chains rusted through, and no lord could forge them again.']],
  socThinned: [['The wars and risings before {year} left its nobility, it is said, {share} fewer.'], ['Of the great houses that rode out before {year}, {share} never came home.']],
  socEnnobled: [['Merchants of {town} bought land and titles there in {year}.'], ['In {year} the silver of the merchants of {town} bought them crests and manors, and the old lords sneered and bowed.']],
  socCycle: [['Its history, read at a distance, rose and fell in long tides: growth, then crowding, then strife, about every {gap} years.'], ['{Times} it grew fat, and {times} it bled; so turns the wheel.']],
  socCalm: [['It knew, as far as the records tell, no great breakdown of its order.'], ['Its lords and peasants kept the peace for {n} years.']],
  ySocCrisis: [['In {year} the social order of {state}, it seems, fell into crisis.'], ['In {year} the great houses of {state} turned on one another.']],
}

const share = (x: number) => (x >= 0.6 ? 'more than half' : x >= 0.45 ? 'nearly half' : x >= 0.3 ? 'a third' : 'a fifth')
const rise = (x: number) => (x >= 1.9 ? 'twice' : x >= 1.45 ? 'half again' : 'a third more than')
const word = (n: number) => (n === 2 ? 'twice' : n === 3 ? 'three times' : n === 4 ? 'four times' : `${n} times`)
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

/** The society sentences of polity p's state saga. */
export function societyLines(c: Ctx, v: Voice, p: number): string[] {
  const out: string[] = []
  const Y = c.Y
  const mine = (t: number, by: (e: HistoryEvent) => number = (e) => e.value) => c.type(t).map((i) => c.ev(i)).filter((e) => e.year <= Y && by(e) === p)
  const crises = mine(EventType.SocialPhase).filter((e) => e.extra === SecularPhase.Crisis)
  if (crises.length > 0) out.push(v.p('socCrisis', { year: crises[0].year }))
  const dear = mine(EventType.LabourDear)[0]
  if (dear) out.push(v.p(dear.other >= 0 ? 'socDear' : 'socDearPlain', { year: dear.year, rise: rise(dear.extra ?? 1.3) }))
  const serf = mine(EventType.SerfdomImposed)[0]
  if (serf) out.push(v.p('socSerf', { year: serf.year }))
  const free = mine(EventType.SerfdomEnded)[0]
  if (free) out.push(v.p('socFree', { year: free.year }))
  const thin = mine(EventType.EliteThinned)[0]
  if (thin) out.push(v.p('socThinned', { year: thin.year, share: share(thin.extra ?? 0.3) }))
  const nob = mine(EventType.Ennobled, (e) => c.polityOf(e.other, e.year))[0]
  if (nob) out.push(v.p('socEnnobled', { year: nob.year, town: c.name(nob.settlement, nob.year) }))
  if (crises.length >= 2) {
    const gap = Math.round((crises[crises.length - 1].year - crises[0].year) / (crises.length - 1) / 50) * 50
    const t = word(crises.length)
    out.push(v.p('socCycle', { gap: Math.max(50, gap), Times: cap(t), times: t }))
  } else if (crises.length === 0) {
    const P = c.pd?.list[p]
    const life = P ? (P.endedYear >= 0 && P.endedYear <= Y ? P.endedYear : Y) - P.foundedYear : 0
    if (life >= 300 && c.h.socPhase && c.h.socPhase.length > 0) out.push(v.p('socCalm', { n: Math.floor(life / 100) * 100 }))
  }
  return out
}

/** The decade chronicle's society sentence: the span's first crisis of the social order. */
export function societyYearLines(c: Ctx, v: Voice, of: (t: number) => HistoryEvent[]): string[] {
  const d = of(EventType.SocialPhase).find((e) => e.extra === SecularPhase.Crisis)
  return d ? [v.p('ySocCrisis', { year: d.year, state: c.pname(d.value) })] : []
}
