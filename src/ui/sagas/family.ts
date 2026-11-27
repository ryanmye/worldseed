// Sagas: "The Chronicle of House Veckin" (merchant-families.md §4.2). A merchant family: its founding (a venture's profits, a
// trader's fortune, a cadet line), its factors and lanes, its heads, its marriages into ruling houses and the civil wars it
// backed, the great works it paid for, and its fall or its standing at the year told. The chronicle register hedges ("it
// seems", "the records say"); the legend tells a story.

import { EventType, FamilyCause, FamilyEnd, FamilyRuin, FamilySeatKind, HeadHow } from '../../contract.ts'
import type { Ctx } from './facts.ts'
import { list, plural, Voice, type PhraseTable } from './voice.ts'
import { Book, type Saga } from './types.ts'
import { OMEN_T } from './omens.ts'
import { Refs } from './refs.ts'
import { familiesOf, familyHomeAt, headFullName } from '../familiesData.ts'

const T: PhraseTable = {
  title: [['The Chronicle of House {name}'], ['The Saga of the {name}']],
  founder: [
    ['The ledgers of {home} record that House {name} was founded in {year} by {head}, it seems on the profits of a venture to {far}.',
      'House {name} appears in the records of {home} in {year}; its founder, {head}, is said to have made a fortune on the lane to {far}.'],
    ['{head} came home to {home} from {far} with full holds, and on that cargo the house of {name} was built, in {year}.'],
  ],
  founderCapital: [
    ['By {year} the name of {name} stands among the great merchants of {home}; the first of them recorded is {head}.'],
    ['In {home} the counting-houses grew rich, and in {year} the richest of them was the house of {head}, called {name}.'],
  ],
  cadet: [
    ['In {year} a branch of House {name} of {parent} is recorded keeping its own books at {home}, under {head}.'],
    ['In {year} {head} took the factor\'s house at {home} for his own, and the {name} of {home} parted from their kin at {parent}.'],
  ],
  branch: [['It kept factors at {list}, as far as the records show.'], ['Its factors sat in {list}, and wherever its ships put in a {name} was waiting on the quay.']],
  lanes: [['It is said to have run the lanes to {list}.'], ['Its ships plied the lanes to {list}.']],
  head: [['{head} is recorded as head of the house from {from}; {kin}.'], ['{head}, {kin}, took up the keys of the house in {from}.']],
  heads: [['In all, {n} are recorded at its head.'], ['{n} held its keys, one after another.']],
  sonInLaw: [
    ['When {prev} died without a son, the house seems to have passed to {head}, who had married his daughter.'],
    ['{prev} left no son; but his daughter had wed {head}, the cleverest of his factors, and the house went on.'],
  ],
  widow: [['On the death of {prev} his widow {head} is recorded at the head of the house.'], ['When {prev} died, {head} his widow kept the keys, and the house did not falter.']],
  marriage: [['In {year} a daughter of the house is said to have married into House {dyn}, then ruling the {state}.'], ['In {year} a {name} bride was led into the halls of House {dyn}, and the counting-house sat at the king\'s table.']],
  marriageSon: [['In {year} a son of the house is said to have wed a woman of House {dyn}, then ruling the {state}.'], ['In {year} a son of the {name} wed a princess of House {dyn}, and the merchants stood among the lords of the {state}.']],
  backed: [['In the civil war of {year} the house appears among the backers of {side}; the cause {won}.'], ['When the {state} broke in two in {year}, the {name} put their gold behind {side}, and {wonL}.']],
  patron: [['{lm} is ascribed to the house\'s money ({year}).'], ['They raised {lm} in {year}, that men would remember the name of {name}.']],
  fellFleet: [['The house seems to have failed in {year}, after a fleet was lost at sea.'], ['In {year} the sea took the {name} fleet, and with it the house: the creditors came before the mourners.']],
  fellDefault: [['In {year}, the records suggest, the crown at {town} would not repay, and House {name} failed.'], ['The king at {town} would not pay what he owed, and in {year} the house of {name} broke like a dropped jar.']],
  fellWar: [['The house is not heard of after the war of {year}.'], ['When war came in {year}, the ledgers of the {name} burned with their warehouses.']],
  fellVenture: [['A venture of {year} seems to have come to nothing, and the house with it.'], ['In {year} they staked all on one voyage, and the voyage came to nothing.']],
  fellPlague: [['Plague emptied {town} in {year}, and the house failed with it.'], ['In {year} the plague came to {town}; the clerks died at their desks, and the house of {name} died with them.']],
  faded: [['After {year} the name of {name} drops from the lists of the great merchants.'], ['The {name} grew small, and by {year} none sang of them.']],
  noHeir: [['It ended in {year} with {head}, who left no heir.'], ['{head} was the last of the {name}; in {year} the house went into the dark with him.']],
  townLost: [['It ended in {year} with its town.'], ['In {year} its town was no more, and the house was no more.']],
  trades: [['In {Y} it still trades from {home}, under {head}.', 'It is recorded as trading in {Y}, headed by {head}.'], ['In {Y} the {name} still trade from {home}, and {head} holds the keys.']],
  closing: [['Here ends the chronicle of House {name}.'], ['So ends the saga of the {name}.']],
  epigraph: [['House {name}: {facts}.'], ['The {name}: {facts}.']],
}

const KIN: Record<number, [string, string]> = {
  [HeadHow.Son]: ['son of the last head', 'daughter of the last head'],
  [HeadHow.Brother]: ['brother of the last head', 'sister of the last head'],
  [HeadHow.Nephew]: ['nephew of the last head', 'niece of the last head'],
  [HeadHow.Widow]: ['widow of the last head', 'widow of the last head'],
  [HeadHow.SonInLaw]: ['who had married the last head\'s daughter', 'who had married the last head\'s daughter'],
}

export function familySaga(c: Ctx, f: number, legend: boolean): Saga {
  const h = c.h
  const fd = familiesOf(h)!
  const F = h.families
  const Y = c.Y
  const v = new Voice(c.seed, `family:${f}`, legend, T, OMEN_T)
  const book = new Book()
  const refs = new Refs(c, book, { kind: 'family', id: f }, legend)
  const name = F.name[f]
  const first = F.firstHome[f]
  const heads = fd.headsOf[f].filter((k) => F.headFrom[k] <= Y)
  const head0 = heads.length ? headFullName(fd, heads[0]) : `a ${name}`
  // founding
  const fe = fd.eventsOf[f].map((i) => h.events[i]).find((e) => (e.type as number) === EventType.FamilyFounded)
  let p1: string
  if (F.cause[f] === FamilyCause.Venture && fe && fe.other >= 0) p1 = v.p('founder', { home: c.name(first, F.founded[f]), name, year: F.founded[f], head: head0, far: c.name(fe.other, F.founded[f]) })
  else if (F.cause[f] === FamilyCause.Split && F.parent[f] >= 0) p1 = v.p('cadet', { name, parent: c.name(F.firstHome[F.parent[f]], F.founded[f]), home: c.name(first, F.founded[f]), year: F.founded[f], head: head0 })
  else p1 = v.p('founderCapital', { name, home: c.name(first, F.founded[f]), year: F.founded[f], head: head0 })
  book.chapter('The founding')
  book.add(refs.cite(p1, { kind: 'city', id: first }))
  // factors and lanes
  const towns: string[] = []
  for (const k of fd.seatsOf[f]) if (F.seatKind[k] === FamilySeatKind.Branch && F.seatFrom[k] <= Y && !towns.includes(c.name(F.seatTown[k], Y))) towns.push(c.name(F.seatTown[k], Y))
  const far: string[] = []
  const L = h.longHaul
  for (const r of fd.lanesOf[f]) if (F.laneFrom[r] <= Y && F.laneLeg[r] >= 0 && L) { const x = c.name(L.b[F.laneLeg[r]], Y); if (!far.includes(x)) far.push(x) }
  const p2: string[] = []
  if (towns.length) p2.push(v.p('branch', { list: list(towns.slice(0, 5)), name }))
  if (far.length) p2.push(v.p('lanes', { list: list(far.slice(0, 4)) }))
  if (p2.length) { book.chapter('The lanes and the factors'); book.add(p2.join(' ')) }
  // heads
  const p3: string[] = []
  for (let i = 1; i < heads.length && p3.length < 4; i++) {
    const k = heads[i]
    const how = F.how[k]
    const prev = headFullName(fd, heads[i - 1])
    if (how === HeadHow.SonInLaw) p3.push(v.p('sonInLaw', { prev, head: headFullName(fd, k) }))
    else if (how === HeadHow.Widow) p3.push(v.p('widow', { prev, head: headFullName(fd, k) }))
    else if (i === heads.length - 1 || F.headAbility[k] >= 125) p3.push(v.p('head', { head: headFullName(fd, k), from: F.headFrom[k], kin: (KIN[how] ?? ['', ''])[F.headFemale[k]] }))
  }
  if (heads.length >= 3) p3.push(v.p('heads', { n: plural(heads.length, 'head') }))
  if (p3.length) { book.chapter('The heads'); book.add(p3.join(' ')) }
  // crowns and courts
  const p4: string[] = []
  for (const m of fd.marriagesOf[f]) {
    if (F.marriageYear[m] > Y || p4.length >= 3) continue
    const dyn = h.dynasties[F.marriageDynasty[m]]?.name ?? ''
    const s = v.p(F.marriageDaughter[m] ? 'marriage' : 'marriageSon', { year: F.marriageYear[m], dyn, state: c.ptitle(F.marriagePolity[m], F.marriageYear[m]), name })
    p4.push(refs.cite(s, { kind: 'house', id: F.marriageDynasty[m] }))
  }
  for (const b of fd.backsOf[f]) {
    const w = F.backWar[b]
    if (h.wars.startYear[w] > Y || p4.length >= 5) continue
    const done = F.backOutcome[b] !== 0 && h.wars.endYear[w] >= 0 && h.wars.endYear[w] <= Y
    const won = F.backOutcome[b] === 1
    const state = c.ptitle(h.wars.defender[w], h.wars.startYear[w])
    p4.push(v.p('backed', { year: h.wars.startYear[w], side: F.backSide[b] ? 'the pretender' : 'the crown', won: done ? (won ? 'won' : 'was lost') : 'was not yet decided', state, name, wonL: done ? (won ? 'their gold came home doubled' : 'their gold was lost') : 'the end was not yet seen' }))
  }
  if (p4.length) { book.chapter('Crowns and courts'); book.add(p4.join(' ')) }
  // patronage
  const p5: string[] = []
  for (const p of fd.patronsOf[f]) {
    if (F.patronYear[p] > Y || p5.length >= 2) continue
    const lmName = h.landmarks.name[F.patronLandmark[p]]
    if (lmName) p5.push(v.p('patron', { lm: lmName.charAt(0).toUpperCase() + lmName.slice(1), year: F.patronYear[p], name }))
  }
  if (p5.length) { book.chapter('Patronage'); book.add(p5.join(' ')) }
  // the end
  const ended = F.ended[f] >= 0 && F.ended[f] <= Y
  if (ended) {
    const year = F.ended[f]
    const fell = fd.eventsOf[f].map((i) => h.events[i]).find((e) => (e.type as number) === EventType.FamilyFell)
    const town = fell && fell.other >= 0 ? c.name(fell.other, year) : c.name(familyHomeAt(fd, f, year), year)
    const last = heads.length ? headFullName(fd, heads[heads.length - 1]) : name
    let s: string
    if (F.end[f] === FamilyEnd.Bankrupt) {
      const key = F.ruin[f] === FamilyRuin.Fleet ? 'fellFleet' : F.ruin[f] === FamilyRuin.Default ? 'fellDefault' : F.ruin[f] === FamilyRuin.Venture ? 'fellVenture' : F.ruin[f] === FamilyRuin.Plague ? 'fellPlague' : 'fellWar'
      s = v.p(key, { year, town: F.ruin[f] === FamilyRuin.Plague ? c.name(familyHomeAt(fd, f, year), year) : town, name })
    } else if (F.end[f] === FamilyEnd.NoHeir) s = v.p('noHeir', { year, head: last, name })
    else if (F.end[f] === FamilyEnd.TownLost) s = v.p('townLost', { year })
    else s = v.p('faded', { year, name })
    book.chapter('The fall')
    book.add(s)
  } else {
    const cur = heads.length ? headFullName(fd, heads[heads.length - 1]) : name
    book.add(v.p('trades', { Y, home: c.name(familyHomeAt(fd, f, Y), Y), head: cur, name }))
  }
  const facts = [`founded ${F.founded[f]} at ${c.name(first, F.founded[f])}`, plural(heads.length, 'head'), ended ? `ended ${F.ended[f]}` : `trading in ${Y}`]
  return { kind: 'family', id: f, year: Y, legend, title: v.p('title', { name }), epigraph: v.p('epigraph', { name, facts: list(facts) }), ...book.parts(), closing: v.p('closing', { name }) }
}
