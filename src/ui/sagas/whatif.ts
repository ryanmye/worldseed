// Sagas: "In the world without your order" (experience-whatif-director-sagas §1.9), the whatif saga of a comparison
// (whatifPanel.ts): told at the end of both runs from the two records and the digest of how they differ (whatif/diff.ts,
// ui/whatif/consequences.ts). Not in the library's contents: it exists only beside an open comparison.
//
// 1. The fork: the order told as its omen (omens.ts), then what did not happen in the other world.
// 2. The first differences, in the causal window after the divergence (CAUSAL_YEARS), with names from both records.
// 3. The parting: the year the two records share fewer than one event in ten (hedged: a fact about the records).
// 4. The great differences: states only in one world, peoples whose numbers differ beyond the noise of a trivial order
//    (consequences.ts RHO), great wars only in one world. After the causal window these are told as differences, never
//    as effects ("in the world without it, ..."; owner decision), since the two worlds are then other draws of one world.
// 5. What stayed the same: the peoples within RHO (the majority on the measured seeds).
// An order that changed nothing gets the `same` line only.

import { encodeOrders } from '../../contract.ts'
import { hashString } from '../../sim/rng.ts'
import { CAUSAL_YEARS } from '../../whatif/diff.ts'
import type { Ctx } from './facts.ts'
import { Book, type Saga } from './types.ts'
import { list, people, Voice, type PhraseTable } from './voice.ts'
import { OMEN_T, omenText, ordersWhere } from './omens.ts'
import { orderStory } from '../nudgeFormat.ts'
import type { WhatIfShown } from '../whatif/wording.ts'
import { safeDescribe } from '../whatif/wording.ts'

export const WHATIF_T: PhraseTable = {
  title: [['In the World Without the Order'], ['The World That Was Not']],
  titleInstead: [['In the World of the Other Order'], ['The World That Might Have Been']],
  epigraph: [['Two records of one world, alike until {div}.'], ['One world, two threads, parted in {div}.']],
  fork: [
    ['Had the order of {year} not been given, the record would have run otherwise from {div}.', 'Without the order of {year} the record would have parted from ours in {div}.'],
    ['In the world that was not, no sign was given in {year}, and from {div} the threads of the years ran another way.'],
  ],
  forkInstead: [
    ['Had the other order of {year} been given as well, the record would have run otherwise from {div}.'],
    ['In the world that might have been, another sign was given in {year}, and from {div} the threads of the years ran another way.'],
  ],
  forkNone: [['Without any of the orders the record would have run otherwise from {div}.'], ['Had no sign ever been given, the threads would have parted from ours in {div}.']],
  same: [['Without this order nothing would have been otherwise: {story}.'], ['The sign was given and misread, and the world went on as it would have gone.']],
  first: [['Within {n} years {eventB}, where in our record {eventA}.'], ['Within {n} winters {eventB}, where in our world {eventA}.']],
  firstOnlyB: [['Within {n} years {eventB}, which our record does not tell.'], ['Within {n} winters {eventB}, a thing our world never saw.']],
  firstOnlyA: [['Within {n} years our record tells that {eventA}; the other does not.'], ['Within {n} winters our world saw that {eventA}; the other never did.']],
  part: [['By {year} the two records share hardly one event in ten.'], ['By {year} the two worlds had forgotten each other.']],
  partLate: [['After {year} the two records go their own ways.'], ['After {year} the two worlds no longer knew each other.']],
  caution: [['What follows are differences between the two records, not effects of the order.'], ['What follows the songs of the two worlds do not share; who can say what caused it.']],
  noState: [['The {state}, which in our record ruled some {pop} people at its height, would never have been founded.'], ['No one would ever have sung of the {state}.']],
  newState: [['In its place the records of that other world know the {stateB}, founded in {year} at {cap}.', 'The other record knows instead the {stateB}, founded in {year} at {cap}.'], ['Instead the {stateB} rose at {cap} in {year}, a realm our world never saw.']],
  people: [['The {people} would number {nB} by {T} instead of {nA}.'], ['The {people} would have been {more}, {nB} souls and not {nA}.']],
  warB: [['The other record tells of a war of the {a} on the {b} from {year}, which cost {dead} lives.'], ['In that other world the {a} fell upon the {b} in {year}, and {dead} were slain.']],
  samePeoples: [['Most peoples would have numbered much as they do: {list}.'], ['Yet the great peoples stood where they stand, for the land does not forget: {list}.']],
  samePeoplesNone: [['No people would have numbered as it does.'], ['No people would have stood where it stands.']],
  closing: [['Here ends the record of the world that was not.'], ['So ends the song of the world that was not.']],
}

/** "the walls rose at Oruma" from "The walls rose at Oruma." (a chronicle line inside a sentence). */
const inner = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1).replace(/[.]\s*$/, '') : s)

/** The whatif saga of an open comparison: told in our world's Ctx (cA) with names from the other's (cB). */
export function whatifSaga(cA: Ctx, cB: Ctx, s: WhatIfShown, legend: boolean): Saga {
  const d = s.result.digest
  const f = s.ask.focus
  const v = new Voice(cA.seed, `whatif:${hashString(encodeOrders(s.ask.orders)) >>> 0}`, legend, WHATIF_T, OMEN_T)
  const book = new Book()
  const instead = f?.world === 'B'
  const T = s.facts.T
  const base = { id: 0, year: T, legend, kind: 'whatif' as const }
  if (d.divergence < 0) {
    const story = f ? orderStory(f.world === 'A' ? s.A : s.B, f.k) : ''
    book.add(v.p('same', { story: story || 'the order changed nothing the records hold' }))
    return { ...base, title: v.p(instead ? 'titleInstead' : 'title'), epigraph: v.p('epigraph', { div: T }), ...book.parts(), closing: v.p('closing') }
  }
  const div = d.divergence
  // ---- 1. the fork, with the order as its omen ----
  const cf = instead ? cB : cA
  const omen = f ? ordersWhere(cf, (x) => x.k === f.k)[0] : undefined
  if (omen) book.omen(omenText(cf, v, omen))
  const year = f ? (instead ? s.B : s.A).orders?.[f.k]?.year ?? div : div
  book.add(v.p(f ? (instead ? 'forkInstead' : 'fork') : 'forkNone', { year, div }))
  // ---- 2. the first differences ----
  const a = s.facts.firstA.map((x) => ({ x, t: safeDescribe(s.A, x.event) })).filter((y) => y.t)
  const b = s.facts.firstB.map((x) => ({ x, t: safeDescribe(s.B, x.event) })).filter((y) => y.t)
  const firsts: string[] = []
  for (let k = 0; k < 2; k++) {
    const ea = a[k], eb = b[k]
    if (!ea && !eb) break
    const n = Math.max(1, Math.max(ea?.x.year ?? 0, eb?.x.year ?? 0) - div)
    if (ea && eb) firsts.push(v.p('first', { n, eventA: inner(ea.t), eventB: inner(eb.t) }))
    else if (eb) firsts.push(v.p('firstOnlyB', { n, eventB: inner(eb.t) }))
    else firsts.push(v.p('firstOnlyA', { n, eventA: inner(ea!.t) }))
  }
  book.add(firsts.join(' '))
  // ---- 3. the parting ----
  book.add(s.facts.partTenth >= 0 ? v.p('part', { year: s.facts.partTenth }) : v.p('partLate', { year: Math.min(T, div + CAUSAL_YEARS) }))
  // ---- 4. the great differences ----
  const great: string[] = []
  const onlyA = s.facts.items.filter((c) => c.kind === 'polity' && c.side === 'A').slice(0, 2)
  const onlyB = s.facts.items.filter((c) => c.kind === 'polity' && c.side === 'B').slice(0, 2)
  for (const c of onlyA) great.push(v.p('noState', { state: cA.pgreatTitle(c.a), pop: people(c.va).replace(/^some /, '') }))
  for (const c of onlyB) great.push(v.p('newState', { stateB: cB.pgreatTitle(c.b), year: s.result.fpB.pFounded[c.b], cap: cB.name(cB.pd?.list[c.b]?.capitals[0] ?? -1, s.result.fpB.pFounded[c.b]) }))
  for (const c of s.facts.items.filter((x) => x.kind === 'people' && x.what === 'pop').slice(0, 3)) {
    great.push(v.p('people', { people: cA.peopleName(c.a), nA: people(c.va), nB: people(c.vb), T, more: c.vb > c.va ? 'more' : 'fewer' }))
  }
  for (const c of s.facts.items.filter((x) => x.kind === 'war' && x.side === 'B').slice(0, 1)) {
    const fp = s.result.fpB
    great.push(v.p('warB', { a: cB.pname(fp.wA[c.b]), b: cB.pname(fp.wD[c.b]), year: fp.wStart[c.b], dead: people(fp.wDead[c.b]) }))
  }
  if (great.length) {
    book.add(v.p('caution'))
    book.add(great.join(' '))
  }
  // ---- 5. what stayed the same ----
  const same = s.facts.samePeoples.map((p) => cA.peopleName(p))
  book.add(same.length ? v.p('samePeoples', { list: list(same) }) : v.p('samePeoplesNone'))
  return { ...base, title: v.p(instead ? 'titleInstead' : 'title'), epigraph: v.p('epigraph', { div }), ...book.parts(), closing: v.p('closing') }
}
