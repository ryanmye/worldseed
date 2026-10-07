// Sagas: "The Chronicle of the House of Mera". A ruling house: its founder and how it came to the throne, the thrones
// it held and for how long, its notable members (the longest reign, usurpers among them, those who fell in battle),
// its marriages and unions, and its end or its standing at the year told.

import { AccessionHow, EventType, ReignEnd } from '../../contract.ts'
import { Ctx, topBy } from './facts.ts'
import { reignFacts, rulerEpithet, withEpithet } from './epithets.ts'
import { list, num, plural, Voice, type PhraseTable } from './voice.ts'
import { Book, type Saga } from './types.ts'
import { OMEN_T, omenText, omensOfHouse } from './omens.ts'
import { Refs } from './refs.ts'

const T: PhraseTable = {
  title: [['The Chronicle of the House of {name}'], ['The Saga of the House of {name}']],
  founder: [
    ['The house of {name} came to the throne of the {state} in {year} with {ruler}, who {how}.', 'Its founder was {ruler}, who {how} of the {state} in {year}.'],
    ['In {year} {ruler} {how} of the {state}, and so the house of {name} began.'],
  ],
  people: [[' It was a house of the {people}.'], [' Its blood was of the {people}.']],
  thrones: [
    ['In all it gave {n} to {thrones}.', 'Its members sat on {thrones}: {n} in all.'],
    ['{n} of its blood sat on {thrones}.'],
  ],
  longest: [['The longest reign of the house was that of {ruler}, {years} years.'], ['Longest of its line reigned {ruler}, {years} winters.']],
  usurper: [['{ruler} seized a throne by force in {year}.'], ['In {year} {ruler} took a crown by the sword.']],
  battle: [['{ruler} fell in battle in {year}.'], ['{ruler} fell in the spear-storm in {year}.']],
  marriages: [['It made {n} with other ruling houses.'], ['{n} it wove with other royal houses.']],
  unions: [['Through a marriage claim it once held two thrones at once, from {year}.'], ['From {year}, by a marriage claim, it wore two crowns at once.']],
  ended: [
    ['It lost its last throne in {year}, when {ruler} {end}.', 'The house ended in {year} with {ruler}, who {end}.'],
    ['In {year} its last crown fell, when {ruler} {end}.'],
  ],
  reigning: [['In {Y} it still reigns, in the person of {ruler}.', 'It still holds the throne in {Y}: {ruler} reigns.'], ['In {Y} it reigns still, and {ruler} wears its crown.']],
  closing: [['Here ends the chronicle of the house of {name}.'], ['So ends the saga of the house of {name}.']],
  epigraph: [['The house of {name}: {facts}.'], ['The house of {name}: {facts}.']],
}

const HOW: Record<number, string> = {
  [AccessionHow.Founded]: 'founded the realm',
  [AccessionHow.Inherited]: 'inherited the throne',
  [AccessionHow.Elected]: 'was chosen as ruler',
  [AccessionHow.Usurped]: 'seized the throne',
  [AccessionHow.Conquered]: 'was set on the throne by conquerors',
  [AccessionHow.Union]: 'inherited the throne through a marriage claim',
  [AccessionHow.Claimed]: 'rose as a rival claimant',
}
const END: Record<number, string> = {
  [ReignEnd.Natural]: 'died without an heir of the house to follow',
  [ReignEnd.Battle]: 'fell in battle',
  [ReignEnd.Sack]: 'was killed when the capital fell',
  [ReignEnd.Overthrown]: 'was overthrown and killed',
  [ReignEnd.Deposed]: 'was driven from the throne',
  [ReignEnd.Plague]: 'died of plague',
  [ReignEnd.RealmEnded]: 'saw the realm itself come to an end',
  [ReignEnd.TermEnded]: 'came to the end of a term',
}

export function houseSaga(c: Ctx, d: number, legend: boolean): Saga {
  const h = c.h
  const rd = c.rd!
  const D = h.dynasties[d]
  const v = new Voice(c.seed, `house:${d}`, legend, T, OMEN_T)
  const Y = c.Y
  const reigns = (rd.houseReigns[d] ?? []).filter((r) => rd.rulers[r].acceded <= Y)
  const book = new Book()
  const refs = new Refs(c, book, { kind: 'house', id: d }, legend)
  const nm = (r: number) => (legend ? withEpithet(c.ruler(r), rulerEpithet(reignFacts(c, r))) : c.ruler(r))
  const f = D.founder
  const fx = rd.rulers[f]
  book.add(refs.cite(v.p('founder', { name: D.name, state: c.ptitle(fx.polity, fx.acceded), year: fx.acceded, ruler: nm(f), how: HOW[fx.how] ?? 'took the throne' }), { kind: 'state', id: fx.polity }) + v.p('people', { people: c.peopleName(D.people) }))

  const p2: string[] = []
  const thrones = [...new Set(reigns.map((r) => rd.rulers[r].polity))]
  if (reigns.length > 1) p2.push(v.p('thrones', { n: plural(reigns.length, 'ruler'), thrones: thrones.length === 1 ? `the throne of the ${c.ptitle(thrones[0])}` : `the thrones of ${list(thrones.slice(0, 4).map((q) => c.pname(q)))}` }))
  const long = topBy(reigns, (r) => c.reignYears(r), 1)[0]
  if (long !== undefined && c.reignYears(long) >= 15) p2.push(v.p('longest', { ruler: nm(long), years: c.reignYears(long) }))
  const us = reigns.find((r) => r !== f && rd.rulers[r].how === AccessionHow.Usurped)
  if (us !== undefined) p2.push(v.p('usurper', { ruler: nm(us), year: rd.rulers[us].acceded }))
  const bt = reigns.find((r) => c.reignEndedBy(r) && rd.rulers[r].end === ReignEnd.Battle)
  if (bt !== undefined) p2.push(v.p('battle', { ruler: c.ruler(bt), year: rd.rulers[bt].ended }))
  const M = h.marriages
  if (M) {
    let n = 0
    for (let k = 0; k < M.count && M.year[k] <= Y; k++) if (M.dynastyA[k] === d || M.dynastyB[k] === d) n++
    if (n >= 1) p2.push(v.p('marriages', { n: n === 1 ? 'one marriage alliance' : `${num(n)} marriage alliances` }))
  }
  const un = c.type(EventType.UnionFormed).map((i) => c.ev(i)).find((e) => e.extra !== undefined && rd.rulers[e.extra]?.dynasty === d)
  if (un) p2.push(v.p('unions', { year: un.year }))
  if (p2.length) book.add(p2.join(' '))
  for (const f of omensOfHouse(c, d)) book.omen(omenText(c, v, f))

  let closing = v.p('closing', { name: D.name })
  if (D.ended >= 0 && D.ended <= Y) {
    const last = reigns[reigns.length - 1]
    book.add(v.p('ended', { year: D.ended, ruler: c.ruler(last), end: END[rd.rulers[last].end] ?? 'died' }))
  } else {
    const now = reigns.filter((r) => !c.reignEndedBy(r)).pop()
    if (now !== undefined) book.add(v.p('reigning', { Y, ruler: `${nm(now)} of ${c.pname(rd.rulers[now].polity)}` }))
  }
  const facts = [`founded ${D.founded}`, plural(reigns.length, 'ruler'), D.ended >= 0 && D.ended <= Y ? `ended ${D.ended}` : `reigning in ${Y}`]
  return { kind: 'house', id: d, year: Y, legend, title: v.p('title', { name: D.name }), epigraph: v.p('epigraph', { name: D.name, facts: list(facts) }), ...book.parts(), closing }
}
