// Sagas: "The Saga of the Leko". A people's first hearth and homeland, the names they gave the land, what they grew
// and tamed and took from others, where they spread and sailed, whom they met, their faiths, their ideas (own and
// received), their greatest towns, states and rulers, their wars and sufferings, and where they stand at the year
// told. Every sentence comes from the records up to that year.

import { EventType, FeatureKind, IdeaHow, SpeciesCategory, WarOutcome } from '../../contract.ts'
import { speciesGloss } from '../format.ts'
import { Ctx, settingOf, topBy } from './facts.ts'
import { cityEpithet, reignFacts, rulerEpithet, withEpithet } from './epithets.ts'
import { list, num, people, plural, shareWords, times, Voice, type PhraseTable } from './voice.ts'
import type { Saga } from './types.ts'

const T: PhraseTable = {
  title: [['The Saga of the {people}'], ['The Saga of the {people}{ep}']],
  origin: [
    ['The {people} began at {home}, the hearth of their first tribe, {where}.', 'The story of the {people} begins at {home}, {where}, where their first tribe lived when the counting of years began.'],
    ['In the morning of the world the {people} dwelt at {home}, {where}, and there their first fire was lit.', 'Hear of the {people}, whose first fire burned at {home}, {where}.'],
  ],
  cradle: [
    ['Their neighbours in that cradle of peoples were the {others}.', 'They shared that cradle with the {others}.'],
    ['Beside them in that cradle of peoples dwelt the {others}.', 'Their nearest kin in the old lands were the {others}.'],
  ],
  cradleAlone: [['No other people shared their cradle.', 'They began alone in their cradle, with no near neighbours.'], ['They were alone in their cradle, and no neighbour\'s smoke rose near them.']],
  named: [
    ['It was they who named {list}.', 'They gave their names to {list}.'],
    ['Theirs were the names of {list}.', 'They spoke the first names of {list}.'],
  ],
  founding: [
    ['From the first they grew {crops}{herds}.', 'Their first fields were of {crops}{herds}.'],
    ['From the first their fields bore {crops}{herds}.', 'Of old they grew {crops}{herds}.'],
  ],
  tamed: [
    ['In {year} they were the first to {verb} {sp}, {gloss}, near {place}.', 'They first {verbed} {sp}, {gloss}, near {place} in {year}.'],
    ['In {year}, near {place}, they first {verbed} {sp}, {gloss}.', 'It was they who first {verbed} {sp}, {gloss}, near {place}, in {year}.'],
  ],
  tamedMore: [['They tamed or first grew {n} kinds in all.'], ['{n} wild kinds in all they made their own.']],
  adopted: [
    ['From the {from} they took {sp}.', '{sp} came to them from the {from}.'],
    ['From the {from} they received {sp}.', 'The {from} gave them {sp}.'],
  ],
  technique: [['In {year} they worked out {name}, a new way of farming{what}.'], ['In {year} they found {name}, a new craft of the fields{what}.']],
  spread: [
    ['By {year} they lived in {n}.', 'At their widest, in {year}, they lived in {n}.'],
    ['In {year}, at their widest, their hearths numbered {n}.', 'By {year}, {n} were theirs.'],
  ],
  founded: [['In all they founded {n}.', 'Over the years they founded {n}.'], ['In all they founded {n}.']],
  landfall: [
    ['In {year} settlers from {from} were the first to set foot on an empty land, and founded {place} there.', 'Their first landfall on an empty shore came in {year}, when settlers from {from} founded {place}.'],
    ['In {year} their ships, out of {from}, came to an empty shore, and there they founded {place}.', 'Over the whale-road in {year} went the settlers of {from}, and on an empty shore they raised {place}.'],
  ],
  landfallMore: [[' They made {n} such landfalls in all.'], [' {n} empty shores in all they were the first to tread.']],
  lost: [['{n} of their voyages were lost at sea.', 'The sea took {n} of their voyages.'], ['The sea swallowed {n} of their ships.', '{n} of their ships went down to the sea\'s floor.']],
  discovery: [['An expedition of theirs, out of {from}, was the first of any people to reach {what}, in {year}.'], ['In {year} their far-farers out of {from} reached {what}, where none had come before.']],
  metFirst: [
    ['They first met another people in {year}, when they came upon the {other} at {place}.', 'Their first meeting with another people came in {year}, with the {other}, at {place}.'],
    ['In {year} at {place} they first beheld strangers: the {other}.', 'In {year} came the first meeting, with the {other}, at {place}.'],
  ],
  metMore: [
    ['By {year} they knew {n}; the last they met were the {last}.', 'In time they came to know {n}, the {last} last of all, in {year}.'],
    ['In time {n} were known to them, and last of all the {last}, in {year}.'],
  ],
  metAll: [['By {year} they knew every people of the world.'], ['By {year} no people of the world was strange to them.']],
  metNone: [['They never met another people.'], ['No stranger ever came to them.']],
  contactSick: [
    ['Contact brought sickness: in {year} a disease new to them came from the {from}.', 'Meeting the {from} cost them dearly: a sickness new to them struck in {year}.'],
    ['But strangers bring sickness: in {year} a fever came to them from the {from}.'],
  ],
  oldWays: [['Their own faith was the old {name} ways.', 'They kept the old {name} ways.'], ['Their fathers kept the old {name} ways.', 'Of old they kept the {name} ways.']],
  founderFaith: [
    ['{faith} arose among them, first preached at {place} in {year}.', 'In {year} {faith} was founded among them, at {place}.'],
    ['Among them, at {place}, {faith} was born in {year}.'],
  ],
  founderFaithMore: [[' Later {list} arose among them too.'], [' After it were born among them {list}.']],
  reached: [
    ['{faith} reached them in {year}.', 'In {year} {faith} came to them.'],
    ['In {year} {faith} came among them.'],
  ],
  reachedThen: [[' Then came {list}.', ' After it came {list}.'], [' After it came {list}.']],
  faithNowCame: [['Now most of them follow {faith}, which reached them in {year}.'], ['Now the most of them bow to {faith}, which came to them in {year}.']],
  faithNow: [
    ['Most of them follow {faith} now.', 'Now most of them follow {faith}.'],
    ['Now the most of them bow to {faith}.'],
  ],
  invented: [
    ['They were the first to work out {list}.', '{list} were first worked out among them.'],
    ['From their minds first came {list}.', 'They were the first to master {list}.'],
  ],
  inventedMore: [[' In all they conceived {n} ideas before anyone else.'], [' {n} new things in all came first from them.']],
  received: [
    ['From others they took up {n}, the first of them {first} from the {from}, in {year}.', 'They learned {n} from other peoples, beginning with {first}, from the {from} in {year}.'],
    ['From strangers they learned {n}, and first of all {first}, from the {from}, in {year}.'],
  ],
  lostIdea: [['They lost {what} again in {year}.'], ['In {year} {what} was forgotten among them.']],
  cities: [
    ['Their greatest town was {top}, with {pop} people at its height in {year}.', 'The largest of their towns was {top}, home to {pop} people in {year}.'],
    ['Greatest of their towns was {top}, where {pop} souls dwelt in {year}.', 'Mightiest of their hearths was {top}: {pop} souls lived there in {year}.'],
  ],
  citiesNow: [
    ['Their greatest town is {top}, home to {pop} people now, more than ever before.', 'The largest of their towns is {top}, which has never been larger than now, with {pop} people.'],
    ['Greatest of their towns is {top}, where {pop} souls dwell now, more than ever before.'],
  ],
  citiesMoreOne: [[' After it came {list}.', ' {list} was next in size.'], [' After it came {list}.']],
  citiesMore: [[' After it came {list}.', ' {list} were next in size.'], [' After it came {list}.']],
  states: [
    ['They ruled {n}{extra}. The greatest was the {state}, which at its height in {year} ruled {pop} people.', 'They founded {n}{extra}; the greatest, the {state}, ruled {pop} people in {year}.'],
    ['{n} they raised{extra}, and mightiest of all was the {state}, whose sway in {year} reached {pop} souls.'],
  ],
  stateOne: [['They founded one state, the {state}, which at its height in {year} ruled {pop} people.'], ['One realm they raised, the {state}, and in {year} it ruled {pop} souls.']],
  stateNone: [['They never founded a state of their own.'], ['No crown of their own was ever raised among them.']],
  ruler: [
    ['The longest reign among them was that of {ruler}, {years} years.', 'Of all their rulers {ruler} reigned longest, {years} years.'],
    ['Longest of all their rulers reigned {ruler}, {years} winters.'],
  ],
  wars: [
    ['Their states fought {n} wars{winloss}.', 'In all their states went to war {n} times{winloss}.'],
    ['{n} times their states went to war{winloss}.'],
  ],
  sacks: [['Their towns were sacked {times}; the worst, at {place} in {year}, cost {share} of its people.'], ['{times} their towns were given to the flames; at {place}, in {year}, {share} of the people perished.']],
  famine: [['Their worst famine struck {place} in {year}, where {share} of the people were lost.'], ['In {year} hunger came to {place}, and {share} of its people wasted away.']],
  epidemic: [
    ['The worst sickness to strike them was {disease}, from {year}.', 'In {year} {disease} came upon them, the worst sickness they ever knew.'],
    ['In {year} came {disease}, the bitterest of their sorrows.'],
  ],
  nowAlive: [
    ['In {Y} the {people} number {pop}, in {n}.', 'Now, in {Y}, there are {pop} {people}, living in {n}.'],
    ['In {Y} the {people} are {pop} strong, dwelling in {n}.'],
  ],
  nowLargest: [[' The largest of their towns is {top}.', ' {top} is the largest of them.'], [' Greatest of their towns is {top}.']],
  nowStates: [[' They rule {n}, the greatest the {state}.'], [' They hold {n}, and greatest of these is the {state}.']],
  nowStateless: [[' None of their states remain; they live under others.'], [' Their crowns are fallen, and they live under the rule of strangers.']],
  gone: [
    ['The {people} are gone: their last town, {place}, was abandoned in {year}.', 'There are no {people} left: {place}, the last of their towns, was given up in {year}.'],
    ['The {people} are no more: their last hearth, {place}, went cold in {year}.'],
  ],
  closing: [['Here ends the saga of the {people}.', 'So ends the saga of the {people}, told to the year {Y}.'], ['So ends the saga of the {people}; may their hearths never grow cold.', 'Here the saga of the {people} is ended, but not their story.']],
  closingGone: [['Here ends the saga of the {people}.'], ['So ends the saga of the {people}; their names live only here.']],
  epigraph: [['The {people}: {facts}.'], ['The {people}{ep}: {facts}.']],
}

/** "the river Hulu", "the Kesh mountains", "the land of Kusemuyu". */
export function featurePhrase(kind: number, name: string): string {
  switch (kind) {
    case FeatureKind.Continent: return `the land of ${name}`
    case FeatureKind.Island: return `the island of ${name}`
    case FeatureKind.Ocean: return `the ${name} ocean`
    case FeatureKind.Sea: return `the ${name} sea`
    case FeatureKind.Lake: return `lake ${name}`
    case FeatureKind.River: return `the river ${name}`
    case FeatureKind.MountainRange: return `the ${name} mountains`
    case FeatureKind.Desert: return `the ${name} desert`
    case FeatureKind.Forest: return `the ${name} forest`
  }
  return name
}

function peopleEpithet(c: Ctx, p: number): string {
  const mine = (id: number) => c.peopleOf(id) === p
  const landfalls = c.type(EventType.Landfall).filter((i) => mine(c.ev(i).settlement)).length
  const best = (fn: (q: number) => number) => {
    let b = -1, bv = 0
    for (let q = 0; q < c.h.peoples.length; q++) { const x = fn(q); if (x > bv) { bv = x; b = q } }
    return b
  }
  if (!c.ix.ofPeople[p].some((id) => c.alive(id))) return ', the Vanished'
  if (landfalls >= 3 && best((q) => c.type(EventType.Landfall).filter((i) => c.peopleOf(c.ev(i).settlement) === q).length) === p) return ', the Wave-riders'
  const A = c.h.ideaAdoptions
  if (A) {
    const inv = (q: number) => { let n = 0; for (let k = 0; k < A.count && A.year[k] <= c.Y; k++) if (A.people[k] === q && A.how[k] === IdeaHow.Invented) n++; return n }
    if (inv(p) >= 5 && best(inv) === p) return ', the Makers'
  }
  const horse = c.h.species.findIndex((s) => s.archetype === 'horse')
  if (horse >= 0 && c.type(EventType.Domesticated).some((i) => c.ev(i).value === horse && mine(c.ev(i).settlement))) return ', the Horse-tamers'
  const popOf = (q: number) => c.ix.ofPeople[q].reduce((a, id) => a + c.pop(id), 0)
  if (best(popOf) === p) return ', the Many'
  if (c.fd?.faiths.some((f) => f.kind === 1 && f.people === p && f.foundedYear <= c.Y)) return ', the Prophets\' Kin'
  return ''
}

export function peopleSaga(c: Ctx, p: number, legend: boolean): Saga {
  const h = c.h
  const v = new Voice(c.seed, `people:${p}`, legend, T)
  const pn = c.peopleName(p)
  const Y = c.Y
  const mine = (id: number) => id >= 0 && id < c.N && c.peopleOf(id) === p
  const own = c.ix.ofPeople[p].filter((id) => h.settlements[id].foundedYear <= Y)
  const ep = legend ? peopleEpithet(c, p) : ''
  const paras: string[] = []
  const P = h.peoples.length

  // ---- origin and homeland ----
  const p1: string[] = []
  const home = h.peoples[p].founder
  const set = settingOf(c, h.settlements[home].cell)
  const where = set ? (set.coast ? `by the sea, ${set.where}` : set.river ? `on a river, ${set.where}` : set.where) : 'in the old lands'
  p1.push(v.p('origin', { people: pn, home: c.place(home, 0), where }))
  const others = h.peoples.filter((q) => q.id !== p && q.cradle === h.peoples[p].cradle).map((q) => q.name)
  p1.push(others.length ? v.p('cradle', { others: list(others) }) : v.p('cradleAlone'))
  const named = h.features.filter((f) => f.namedYear <= Y && mine(f.namedBy)).sort((a, b) => b.size - a.size).slice(0, 3)
  if (named.length) p1.push(v.p('named', { list: list(named.map((f) => featurePhrase(f.kind, f.name))) }))
  paras.push(p1.join(' '))

  // ---- what they grew and tamed ----
  const p2: string[] = []
  const S = h.species.length
  const sp = h.species
  const has0 = sp.filter((x) => h.speciesYear[p * S + x.id] === 0)
  const crops = has0.filter((x) => x.category === SpeciesCategory.Staple).slice(0, 2)
  const herds = has0.filter((x) => x.category === SpeciesCategory.Livestock).slice(0, 1)
  const g = (x: typeof sp[number]) => `${x.name}, ${speciesGloss(x.archetype, x.category)},`
  if (crops.length) p2.push(v.p('founding', { crops: list(crops.map(g)).replace(/,$/, ''), herds: herds.length ? `, and their herds were of ${g(herds[0]).replace(/,$/, '')}` : '' }))
  const tamed = c.type(EventType.Domesticated).map((i) => c.ev(i)).filter((e) => mine(e.settlement))
  for (const e of tamed.slice(0, 2)) {
    const x = sp[e.value]
    if (!x) continue
    const verb = x.category === SpeciesCategory.Livestock ? 'tame' : 'cultivate'
    p2.push(v.p('tamed', { year: e.year, verb, verbed: verb === 'tame' ? 'tamed' : 'cultivated', sp: `the ${x.name}`, gloss: speciesGloss(x.archetype, x.category), place: c.place(e.settlement, e.year) }))
  }
  if (tamed.length > 2) p2.push(v.p('tamedMore', { n: num(tamed.length) }))
  const fromOthers = new Map<number, string[]>()
  for (const x of sp) {
    const y = h.speciesYear[p * S + x.id], src = h.speciesSource[p * S + x.id]
    if (y > 0 && y <= Y && src >= 0 && src < P) {
      const a = fromOthers.get(src) ?? []
      a.push(`the ${x.name} (${speciesGloss(x.archetype, x.category)})`)
      fromOthers.set(src, a)
    }
  }
  for (const [q, xs] of [...fromOthers].sort((a, b) => b[1].length - a[1].length).slice(0, 2)) p2.push(v.p('adopted', { from: c.peopleName(q), sp: list(xs.slice(0, 3)) }))
  const tech = c.type(EventType.TechniqueFound).map((i) => c.ev(i)).find((e) => mine(e.settlement))
  if (tech && h.techniques[tech.value]) {
    const k = h.techniques[tech.value]
    p2.push(v.p('technique', { year: tech.year, name: k.name, what: k.species >= 0 && sp[k.species] ? (legend ? ` for the ${sp[k.species].name}` : ` the ${sp[k.species].name}`) : '' }))
  }
  if (p2.length) paras.push(p2.join(' '))

  // ---- spread and seafaring ----
  const p3: string[] = []
  let maxAlive = 0, maxYear = 0
  const I = h.snapshotInterval
  for (let s = 0; s <= c.sY; s++) {
    let n = 0
    for (const id of own) if (h.population[s * c.N + id] > 0 && !h.settlements[id].outpost) n++
    if (n > maxAlive) { maxAlive = n; maxYear = s * I }
  }
  if (own.length > 1) {
    p3.push(v.p('spread', { year: maxYear, n: plural(maxAlive, 'town or village', 'towns and villages') }))
    if (own.length > maxAlive * 1.2) p3.push(v.p('founded', { n: plural(own.filter((id) => !h.settlements[id].outpost).length, 'settlement') }))
  }
  const lf = c.type(EventType.Landfall).map((i) => c.ev(i)).filter((e) => mine(e.settlement))
  if (lf.length) {
    p3.push(v.p('landfall', { year: lf[0].year, from: c.place(lf[0].other, lf[0].year), place: c.place(lf[0].settlement, lf[0].year) }) + (lf.length > 1 ? v.p('landfallMore', { n: num(lf.length) }) : ''))
  }
  const lost = c.type(EventType.VoyageLost).filter((i) => mine(c.ev(i).settlement)).length
  if (lost >= 2) p3.push(v.p('lost', { n: num(lost) }))
  const disc = c.type(EventType.Discovery).map((i) => c.ev(i)).find((e) => mine(e.settlement))
  if (disc) {
    const f = disc.value >= 0 ? h.features[disc.value] : null
    const what = f ? featurePhrase(f.kind, f.name) : 'the pole'
    p3.push(v.p('discovery', { from: c.place(disc.settlement, disc.year), what, year: disc.year }))
  }
  if (p3.length) paras.push(p3.join(' '))

  // ---- whom they met ----
  const p4: string[] = []
  const met: { q: number; y: number }[] = []
  for (let q = 0; q < P; q++) {
    const y = h.contactYear[p * P + q]
    if (q !== p && y >= 0 && y <= Y) met.push({ q, y })
  }
  met.sort((a, b) => a.y - b.y)
  if (met.length === 0) p4.push(v.p('metNone'))
  else {
    const fc = c.type(EventType.FirstContact).map((i) => c.ev(i)).find((e) => (mine(e.settlement) && c.peopleOf(e.other) === met[0].q) || (mine(e.other) && c.peopleOf(e.settlement) === met[0].q))
    const place = fc ? c.place(mine(fc.settlement) ? fc.settlement : fc.other, fc.year) : 'the edge of their lands'
    p4.push(v.p('metFirst', { year: met[0].y, other: c.peopleName(met[0].q), place }))
    if (met.length === P - 1 && met.length > 2) p4.push(v.p('metAll', { year: met[met.length - 1].y }))
    else if (met.length > 1) p4.push(v.p('metMore', { year: met[met.length - 1].y, n: plural(met.length, 'other people', 'other peoples'), last: c.peopleName(met[met.length - 1].q) }))
    const sick = c.type(EventType.Epidemic).map((i) => c.ev(i)).find((e) => mine(e.settlement))
    if (sick) p4.push(v.p('contactSick', { year: sick.year, from: c.peopleName(c.peopleOf(sick.other)) }))
  }
  paras.push(p4.join(' '))

  // ---- faith ----
  const p5: string[] = []
  const p5y: number[] = []
  if (c.fd) {
    p5.push(v.p('oldWays', { name: c.faithWord(p) })); p5y.push(-1)
    const ownF = c.type(EventType.FaithFounded).map((i) => c.ev(i)).filter((e) => mine(e.settlement))
    if (ownF.length) p5y.push(ownF[0].year)
    if (ownF.length) p5.push(v.p('founderFaith', { faith: c.faith(ownF[0].value), place: c.place(ownF[0].settlement, ownF[0].year), year: ownF[0].year }) + (ownF.length > 1 ? v.p('founderFaithMore', { list: list(ownF.slice(1, 3).map((e) => `${c.faith(e.value)}, at ${c.place(e.settlement, e.year)} in ${e.year},`)) }) : ''))
    const reached = c.type(EventType.FaithReached).map((i) => c.ev(i)).filter((e) => e.extra === p && c.fd!.faiths[e.value]?.people !== p)
    const seenF = new Set<number>()
    const firsts = reached.filter((e) => (seenF.has(e.value) ? false : (seenF.add(e.value), true)))
    if (firsts.length) p5y.push(firsts[0].year)
    if (firsts.length) p5.push(v.p('reached', { faith: c.faith(firsts[0].value), year: firsts[0].year }) + (firsts.length > 1 ? v.p('reachedThen', { list: list(firsts.slice(1, 3).map((e) => `${c.faith(e.value)} in ${e.year}`)) }) : ''))
    // majority now, weighted by people
    const w = new Map<number, number>()
    for (const id of own) { if (!c.alive(id)) continue; const f = c.faithAt(id, c.sY); if (f >= 0) w.set(f, (w.get(f) ?? 0) + c.pop(id)) }
    const top = [...w].sort((a, b) => b[1] - a[1])[0]
    if (top && top[0] !== p) {
      const told = ownF.some((e) => e.value === top[0]) || firsts.slice(0, 3).some((e) => e.value === top[0])
      const came = firsts.find((e) => e.value === top[0])
      p5.push(!told && came ? v.p('faithNowCame', { faith: c.faith(top[0]), year: came.year }) : v.p('faithNow', { faith: c.faith(top[0]) }))
      p5y.push(1e9)
    }
  }
  if (p5.length > 1) paras.push(p5.map((t, i) => [t, p5y[i], i] as const).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0]).join(' '))

  // ---- ideas ----
  const p6: string[] = []
  const A = h.ideaAdoptions
  if (A && A.count) {
    const inv: number[] = [], rec: number[] = []
    for (let k = 0; k < A.count && A.year[k] <= Y; k++) {
      if (A.people[k] !== p) continue
      if (A.how[k] === IdeaHow.Invented) { if (h.ideas[A.idea[k]]?.firstPeople === p && h.ideas[A.idea[k]]?.firstYear === A.year[k]) inv.push(k) }
      else if (A.how[k] !== IdeaHow.Lost) rec.push(k)
    }
    if (inv.length) p6.push(v.p('invented', { list: list(inv.slice(0, 3).map((k) => h.ideas[A.idea[k]].name)) }) + (inv.length > 3 ? v.p('inventedMore', { n: num(inv.length) }) : ''))
    if (rec.length) {
      const k = rec[0]
      p6.push(v.p('received', { n: plural(rec.length, 'idea'), first: h.ideas[A.idea[k]].name, from: c.peopleName(A.from[k]), year: A.year[k] }))
    }
    const lostI = c.type(EventType.IdeaLost).map((i) => c.ev(i)).find((e) => mine(e.settlement))
    if (lostI) p6.push(v.p('lostIdea', { what: h.ideas[lostI.value]?.name ?? 'an art', year: lostI.year }))
  }
  if (p6.length) paras.push(p6.join(' '))

  // ---- greatest towns, states, rulers ----
  const p7: string[] = []
  const tops = topBy(own.filter((id) => !h.settlements[id].outpost), (id) => c.peak(id).pop, 3)
  if (tops.length && c.peak(tops[0]).pop >= 1000) {
    const pk = c.peak(tops[0])
    const nowTop = c.alive(tops[0]) && pk.year >= Y - h.snapshotInterval
    const nm = legend ? `${c.name(tops[0], pk.year)}${cityEpithet(c, tops[0]) ? ` ${cityEpithet(c, tops[0])}` : ''}` : c.place(tops[0], pk.year)
    p7.push(v.p(nowTop ? 'citiesNow' : 'cities', { top: nm, pop: people(pk.pop).replace(/^some /, ''), year: pk.year }) + (() => { const more = tops.slice(1).filter((x) => c.peak(x).pop >= 3000); return more.length ? v.p(more.length === 1 ? 'citiesMoreOne' : 'citiesMore', { list: list(more.map((x) => c.name(x, Y))) }) : '' })())
  }
  const states = (c.pd?.list ?? []).filter((x) => x.people === p && x.foundedYear <= Y)
  if (c.pd) {
    if (states.length === 0) p7.push(v.p('stateNone'))
    else {
      const best = topBy(states.map((x) => x.id), (q) => c.ppeak(q).pop, 1)[0] ?? states[0].id
      const pk = c.ppeak(best)
      const big = states.filter((x) => c.ppeak(x.id).maxTier >= 1).length
      if (states.length === 1) p7.push(v.p('stateOne', { state: c.pgreatTitle(best), year: pk.year, pop: people(pk.pop) }))
      else p7.push(v.p('states', { n: plural(states.length, 'state'), extra: big === states.length ? ', all of them kingdoms or greater' : big >= 2 ? `, ${num(big)} of them kingdoms or greater` : '', state: c.pgreatTitle(best), year: pk.year, pop: people(pk.pop) }))
    }
    if (c.rd) {
      const reigns: number[] = []
      for (const x of states) for (const r of c.h.reignIds.subarray(c.h.reignOffsets[x.id], c.h.reignOffsets[x.id + 1])) if (c.rd.rulers[r].acceded <= Y) reigns.push(r)
      const r = topBy(reigns, (r) => c.reignYears(r), 1)[0]
      if (r !== undefined && c.reignYears(r) >= 20) {
        const who = legend ? withEpithet(c.ruler(r), rulerEpithet(reignFacts(c, r))) : `${c.ruler(r)} of ${c.pname(c.rd.rulers[r].polity)}`
        p7.push(v.p('ruler', { ruler: who, years: c.reignYears(r) }))
      }
    }
  }
  if (p7.length) paras.push(p7.join(' '))

  // ---- wars and sufferings ----
  const p8: string[] = []
  const W = c.pd?.wars
  if (W && c.pd) {
    const ids = new Set<number>()
    let won = 0, lost2 = 0
    for (const x of states) for (const w of c.pd.warsOf[x.id] ?? []) {
      if (W.startYear[w] > Y || ids.has(w)) continue
      ids.add(w)
      if (W.endYear[w] < 0 || W.endYear[w] > Y) continue
      const att = states.some((s2) => s2.id === W.attacker[w]), def = states.some((s2) => s2.id === W.defender[w])
      if (att && def) continue
      const o = W.outcome[w]
      if (o === WarOutcome.AttackerGains || o === WarOutcome.Conquest || o === WarOutcome.Tribute || o === WarOutcome.Vassalage) att ? won++ : lost2++
      else if (o === WarOutcome.DefenderGains) att ? lost2++ : won++
    }
    if (ids.size >= 2) p8.push(v.p('wars', { n: num(ids.size), winloss: won + lost2 > 0 ? `, winning ${won ? num(won) : 'none'} and losing ${lost2 ? num(lost2) : 'none'}` : '' }))
  }
  const sacked = c.type(EventType.Sacked).map((i) => c.ev(i)).filter((e) => mine(e.settlement))
  if (sacked.length) {
    const worst = [...sacked].sort((a, b) => b.value * c.pop(b.settlement, b.year - 5) - a.value * c.pop(a.settlement, a.year - 5))[0]
    p8.push(v.p('sacks', { times: times(sacked.length), place: c.place(worst.settlement, worst.year), year: worst.year, share: shareWords(worst.value) }))
  }
  const fam = c.type(EventType.Famine).map((i) => c.ev(i)).filter((e) => mine(e.settlement) && e.value >= 0.1)
  if (fam.length) {
    const worst = [...fam].sort((a, b) => b.value * c.pop(b.settlement, b.year - 5) - a.value * c.pop(a.settlement, a.year - 5))[0]
    p8.push(v.p('famine', { place: c.place(worst.settlement, worst.year), year: worst.year, share: shareWords(worst.value) }))
  }
  const eps = (h.epidemics ?? []).filter((e) => e.startYear <= Y && e.great && e.peoples.includes(p))
  if (eps.length) {
    const worst = [...eps].sort((a, b) => b.deaths - a.deaths)[0]
    const dn = c.disease(worst.disease, legend)
    if (dn) p8.push(v.p('epidemic', { disease: dn, year: worst.startYear }))
  }
  if (p8.length) paras.push(p8.join(' '))

  // ---- now ----
  const living = own.filter((id) => c.alive(id) && !h.settlements[id].outpost)
  let closing: string
  if (living.length) {
    const pop = living.reduce((a, id) => a + c.pop(id), 0)
    let t = v.p('nowAlive', { Y, people: pn, pop: people(pop).replace(/^some /, ''), n: plural(living.length, 'town or village', 'towns and villages') })
    const top = topBy(living, (id) => c.pop(id), 1)[0]
    if (top !== undefined && living.length > 1) t += v.p('nowLargest', { top: c.name(top, Y) })
    const alive = states.filter((x) => c.plives(x.id))
    if (alive.length) {
      const best = topBy(alive.map((x) => x.id), (q) => c.pstat(q, c.sY)?.pop ?? 0, 1)[0] ?? alive[0].id
      t += v.p('nowStates', { n: plural(alive.length, 'state'), state: c.ptitle(best) })
    } else if (states.length) t += v.p('nowStateless')
    paras.push(t)
    closing = v.p('closing', { people: pn, Y })
  } else {
    const last = [...own].filter((id) => !h.settlements[id].outpost).sort((a, b) => h.settlements[b].abandonedYear - h.settlements[a].abandonedYear)[0]
    paras.push(v.p('gone', { people: pn, place: c.name(last, h.settlements[last].abandonedYear - 1), year: h.settlements[last].abandonedYear }))
    closing = v.p('closingGone', { people: pn })
  }

  // ---- epigraph ----
  const facts: string[] = []
  facts.push(`first hearth at ${c.name(home, Y)}`)
  if (tops.length && c.peak(tops[0]).pop >= 3000) facts.push(`greatest town ${c.name(tops[0], Y)}`)
  if (met.length) facts.push(`met ${plural(met.length, 'people', 'peoples')}`)
  facts.push(living.length ? `${people(living.reduce((a, id) => a + c.pop(id), 0)).replace(/^some /, '')} strong in ${Y}` : 'vanished')
  return {
    kind: 'people', id: p, year: Y, legend,
    title: v.p('title', { people: pn, ep }),
    epigraph: v.p('epigraph', { people: pn, ep, facts: list(facts) }),
    paragraphs: paras,
    closing,
  }
}
