// Sagas: what states believed of each other (beliefs-and-deception.md §5.5). The chronicle register is hedged (beliefs are
// inferences about minds); the legend tells it.

import { EventType, WarMotive, WarOutcome } from '../../contract.ts'
import type { Ctx } from './facts.ts'
import type { PhraseTable, Voice } from './voice.ts'

export const INT_T: PhraseTable = {
  misjudged: [['In {year} {state} went to war with {foe}, believing it weak; the records suggest it was {k} times stronger than {state} thought, and the war was lost.'], ['In {year} its king looked on the quiet marches of {foe} and thought them ripe; he had counted its spears by the light of a single lamp.']],
  preventive: [['Fearing the growth of {foe}, {state} struck first in {year}.'], ['{foe} was waxing like the spring flood, and in {year} {state} rode out to break the dam before it burst.']],
  coercedGain: [['In {year} {foe} gave up {towns} to {state} rather than fight.'], ['In {year} {foe} looked on the host of {state} and handed over {towns} without a blow.']],
  coercedLoss: [['In {year} it yielded {towns} to {foe} without war.'], ['In {year} it bent the knee and gave {towns} to {foe}, and the shame of it was long remembered.']],
  bluffHeld: [['Its show of strength in {year}, by some accounts larger than its real strength, seems to have kept {foe} at bay.'], ['In {year} it lit a thousand fires for a hundred men, and {foe} turned back.']],
  bluffExposed: [['In {year} {foe} saw through its show of strength.'], ["In {year} {foe}'s spies counted its tents and laughed."]],
  secretAlly: [['Its alliance with {ally}, kept secret {n} years, came to light in {year} when {ally} joined its war.'], ['For {n} years the pact with {ally} lay hidden like a blade in a sleeve, until {year}, when {ally} drew it.']],
  spies: [['Its spies were caught at the court of {foe} in {year}.'], ['In {year} {foe} hanged its spies from the city gate.']],
  forged: [['Its claim to {town}, put forward in {year}, was afterwards shown to be forged.'], ['Its scribes forged a claim to {town}, and the forgery was found out.']],
  yMisjudged: [['In {year} {state} seems to have misjudged {foe}, and lost the war it began.'], ['In {year} {state} marched on {foe} it thought weak, and came home beaten.']],
  yCoerced: [['In {year} {foe} yielded {towns} to {state} without a fight.'], ['In {year} {foe} gave {towns} to {state} sooner than face its host.']],
}

const townsWord = (n: number) => (n <= 0 ? 'tribute' : n === 1 ? 'a town' : `${n} towns`)

/** The belief sentences of polity p's state saga (section hWar): at most three, the most striking first. */
export function intrigueLines(c: Ctx, v: Voice, p: number): string[] {
  const out: string[] = []
  const h = c.h, Y = c.Y
  const W = h.wars
  const pn = c.pname(p)
  if (W && W.believed && W.believed.length === W.count) {
    for (let w = 0; w < W.count && out.length < 1; w++) {
      if (W.attacker[w] !== p || W.startYear[w] > Y || !(W.believed[w] >= 0)) continue
      if (W.outcome[w] === WarOutcome.DefenderGains && W.believed[w] >= 1.5 * W.actual[w] && W.endYear[w] >= 0 && W.endYear[w] <= Y) {
        out.push(v.p('misjudged', { year: W.startYear[w], state: pn, foe: c.pname(W.defender[w]), k: (W.believed[w] / Math.max(1e-6, W.actual[w])).toFixed(1) }))
      }
    }
    for (let w = 0; w < W.count && out.length < 2; w++) if (W.attacker[w] === p && W.startYear[w] <= Y && W.motive[w] === WarMotive.Preventive) { out.push(v.p('preventive', { year: W.startYear[w], state: pn, foe: c.pname(W.defender[w]) })); break }
  }
  const evs = (t: number) => c.type(t).map((i) => c.ev(i)).filter((e) => e.year <= Y)
  for (const e of evs(EventType.Coerced)) {
    if (out.length >= 3) break
    const coercer = e.value, yielder = c.polityOf(e.other, e.year)
    if (coercer === p) { out.push(v.p('coercedGain', { year: e.year, foe: c.pname(yielder), state: pn, towns: townsWord(e.extra ?? 0) })); break }
    if (yielder === p) { out.push(v.p('coercedLoss', { year: e.year, foe: c.pname(coercer), towns: townsWord(e.extra ?? 0) })); break }
  }
  if (out.length < 3) {
    const d = evs(EventType.Deterred).find((e) => (e.extra ?? 0) === 1 && c.polityOf(e.other, e.year) === p)
    if (d) out.push(v.p('bluffHeld', { year: d.year, foe: c.pname(c.polityOf(d.settlement, d.year)) }))
  }
  if (out.length < 3) {
    const x = evs(EventType.BluffExposed).find((e) => c.polityOf(e.settlement, e.year) === p)
    if (x) out.push(v.p('bluffExposed', { year: x.year, foe: c.pname(x.value) }))
  }
  if (out.length < 3) {
    const r = evs(EventType.AllianceRevealed).find((e) => e.value >= 0 && c.polityOf(e.other, e.year) === p)
    if (r) out.push(v.p('secretAlly', { year: r.year, ally: c.pname(c.polityOf(r.settlement, r.year)), n: r.extra ?? 0 }))
  }
  if (out.length < 3) {
    const s = evs(EventType.SpyCaught).find((e) => e.value === p)
    if (s) out.push(v.p('spies', { year: s.year, foe: c.pname(c.polityOf(s.settlement, s.year)) }))
  }
  if (out.length < 3) {
    const f = evs(EventType.ClaimExposed).find((e) => c.polityOf(e.settlement, e.year) === p)
    if (f) out.push(v.p('forged', { year: f.year, town: c.name(f.other, f.year) }))
  }
  return out
}

/** The decade chronicle's belief sentence: a misjudged war lost, else a coerced cession. */
export function intrigueYearLines(c: Ctx, v: Voice, of: (t: number) => { year: number; settlement: number; other: number; value: number; extra?: number }[]): string[] {
  const W = c.h.wars
  if (W && W.believed && W.believed.length === W.count) {
    for (const e of of(EventType.PeaceMade)) {
      const w = e.value
      if (w < 0 || w >= W.count || !(W.believed[w] >= 0) || W.outcome[w] !== WarOutcome.DefenderGains || !(W.believed[w] >= 1.5 * W.actual[w])) continue
      return [v.p('yMisjudged', { year: e.year, state: c.pname(W.attacker[w]), foe: c.pname(W.defender[w]) })]
    }
  }
  const k = of(EventType.Coerced)[0]
  return k ? [v.p('yCoerced', { year: k.year, state: c.pname(k.value), foe: c.pname(c.polityOf(k.other, k.year)), towns: townsWord(k.extra ?? 0) })] : []
}
