// Sagas: "The Chronicle of the Years 1300–1309" (or of one year): a single paragraph on what happened in the world in a
// decade or a year, up to the year told: how many lived and under how many states, the wars begun and ended (by name
// where they have one), the worst sack, the states founded and fallen, who came to the greatest throne, plague and
// famine, faiths, landfalls and discoveries, new cities, ideas and great works finished, and the omens of those years.
// The most telling few are kept, in that order; quiet years get a short, plain entry.

import { CITY_POPULATION, EventType, FeatureKind, WarKind } from '../../contract.ts'
import { Ctx, topBy } from './facts.ts'
import { omensOfYears, omenText, OMEN_T } from './omens.ts'
import { Refs } from './refs.ts'
import { warName } from './wars.ts'
import { Book, type Saga } from './types.ts'
import { cap, list, num, people, plural, shareWords, Voice, type PhraseTable } from './voice.ts'

const T: PhraseTable = {
  titleDecade: [['The Chronicle of the Years {a}–{b}'], ['The Tale of the Years {a} to {b}']],
  titleYear: [['The Chronicle of the Year {a}'], ['The Tale of the Year {a}']],
  opener: [
    ['In the years from {a} to {b} the world held {pop} people, in {towns}{states}.', 'Between {a} and {b} {pop} people lived in the world, in {towns}{states}.'],
    ['In the years {a} to {b} {pop} souls dwelt under the sky, in {towns}{states}.'],
  ],
  openerFirst: [['In the first ten years of the records the world held {pop} people, in {towns}{states}.'], ['In the first ten years that were counted, {pop} souls dwelt under the sky, in {towns}{states}.']],
  openerYear: [['In {a} the world held {pop} people, in {towns}{states}.'], ['In the year {a} {pop} souls dwelt under the sky, in {towns}{states}.']],
  wars: [
    ['War broke out {times}; the greatest was {war}, begun in {year}.', 'There were {n} new wars; the greatest, {war}, began in {year}.'],
    ['{times} the spear-storm rose; greatest of these was {war}, begun in {year}.'],
  ],
  war1: [['In {year} {war} began.', '{war} broke out in {year}.'], ['In {year} {war} began.']],
  peace: [['In {year} {war} ended{how}.', '{war} came to an end in {year}{how}.'], ['In {year} {war} was ended{how}.']],
  peaceMore: [[' {other} ended too.'], [' {other} came to an end.']],
  sack: [['In {year} {by} sacked {town}, and {share} of its people were lost.'], ['In {year} {by} put {town} to the torch, and {share} of its people perished.']],
  founded: [['In {year} the {state} was founded at {cap}.', 'The {state} was founded at {cap} in {year}.'], ['In {year} a new crown was raised at {cap}: the {state}.']],
  foundedMore: [[' {other} rose in those years.'], [' {other} rose too.']],
  ended: [['In {year} the {state} came to an end.', 'The {state} fell in {year}.'], ['In {year} the {state} was cast down.']],
  endedMore: [[' {other} fell.'], [' {other} fell with it.']],
  acceded: [['In {year} {ruler} came to the throne of the {state}.'], ['In {year} {ruler} took the crown of the {state}.']],
  disease: [['In {year} {disease} first struck, at {place}.'], ['In {year} {disease} first came out of {place}.']],
  stricken: [['In {year} {disease} reached {city} and carried off {share} of its people.'], ['In {year} {disease} came into {city} and took {share} of its people.']],
  famine: [['Famine struck {place} in {year}, and {share} of its people were lost.'], ['In {year} hunger came to {place}, and {share} of its people wasted away.']],
  faith: [['In {year} {faith} was first preached at {place}.'], ['In {year} at {place} {faith} was proclaimed.']],
  stateFaith: [['In {year} {faith} became the faith of the {state}.'], ['In {year} the {state} was given to {faith}.']],
  landfall: [['In {year} settlers from {from} founded {place} on a land where no one had lived{more}.'], ['In {year} the ships of {from} came to an empty shore and raised {place}{more}.']],
  discovery: [['In {year} an expedition from {from} reached {what}.'], ['In {year} the far-farers of {from} came to {what}.']],
  contact: [['In {year} the {a} and the {b} met for the first time, at {place}.'], ['In {year} at {place} the {a} first looked upon the {b}.']],
  cities: [['{list} grew into cities.', '{list} became cities.'], ['{list} grew into great cities.']],
  city1: [['{town} grew into a city in {year}.'], ['In {year} {town} grew into a great city.']],
  ideas: [['{list} {was} first worked out.'], ['{list} {was} first found.']],
  works: [['{list} {was} finished.'], ['{list} {was} raised to completion.']],
  work1: [['{lm} was finished in {year}.', 'In {year} {lm} was finished.'], ['In {year} {lm} stood complete.']],
  quiet: [['The records of those years are quiet.', 'Little is written of those years.'], ['The songs of those years are few.', 'Those were quiet years, and little is sung of them.']],
  closingDecade: [['So stood the world in {b}.'], ['So passed the years {a} to {b}.']],
  closingYear: [['So stood the world at the end of {a}.'], ['So passed the year {a}.']],
  epigraph: [['The world of {world}, {span}: {facts}.'], ['The world of {world}, {span}: {facts}.']],
}

const MILESTONES = ['pottery', 'wheel', 'iron', 'writing', 'coinage', 'paper', 'compass', 'printing', 'gunpowder', 'science']

export function yearSaga(c: Ctx, a0: number, span: number, legend: boolean, worldName: string): Saga {
  const h = c.h
  const v = new Voice(c.seed, `years:${a0}:${span}`, legend, T, OMEN_T)
  const a = Math.max(0, a0)
  const b = Math.min(a + span - 1, c.Y)
  const kind = span === 1 ? 'year' : 'decade'
  const book = new Book()
  const refs = new Refs(c, book, { kind, id: a }, legend, 4)
  // events in [a, b]
  let lo = 0, hi = c.ix.years.length
  while (lo < hi) { const m = (lo + hi) >>> 1; if (c.ix.years[m] < a) lo = m + 1; else hi = m }
  const evs: number[] = []
  for (let i = lo; i < c.cut && c.ix.years[i] <= b; i++) evs.push(i)
  const of = (t: number) => evs.filter((i) => h.events[i].type === t).map((i) => h.events[i])
  const sents: string[] = []
  const facts: string[] = []
  const pd = c.pd
  const W = pd?.wars

  // the world then
  let pop = 0, towns = 0
  const sb = c.snap(b)
  for (let id = 0; id < c.N; id++) if (c.alive(id, b) && !h.settlements[id].outpost) { pop += h.population[sb * c.N + id]; towns++ }
  let states = ''
  if (pd) { const n = pd.list.filter((x) => c.plives(x.id, b)).length; if (n) states = `, under ${plural(n, 'state')}` }
  const opener = a === 0 && span > 1 ? v.p('openerFirst', { b, pop: people(pop), towns: plural(towns, 'town and village', 'towns and villages'), states }) : v.p(span === 1 ? 'openerYear' : 'opener', { a, b, pop: people(pop), towns: plural(towns, 'town and village', 'towns and villages'), states })

  // wars begun and ended
  if (W && pd) {
    const begun = [...of(EventType.WarDeclared), ...of(EventType.CivilWar)].map((e) => e.value).filter((w, i, xs) => w >= 0 && w < W.count && xs.indexOf(w) === i)
    const about = (w: number) => warName(c, w) || (W.kind[w] === WarKind.CivilWar ? `a civil war in ${c.pname(W.defender[w])}` : `the war of ${c.pname(W.attacker[w])} against ${c.pname(W.defender[w])}`)
    if (begun.length) {
      const big = topBy(begun, (w) => W.dead[w] + 1, 1)[0]
      sents.push(begun.length === 1 ? cap(v.p('war1', { year: W.startYear[big], war: about(big) })) : cap(v.p('wars', { times: begun.length === 2 ? 'twice' : `${num(begun.length)} times`, n: num(begun.length), war: about(big), year: W.startYear[big] })))
      facts.push(plural(begun.length, 'war'))
    }
    const ended = of(EventType.PeaceMade).map((e) => e.value).filter((w, i, xs) => w >= 0 && w < W.count && xs.indexOf(w) === i && !begun.includes(w))
    if (ended.length) {
      const big = topBy(ended, (w) => W.dead[w] + 1, 1)[0]
      const how = W.outcome[big] === 1 ? ', with nothing changed' : W.outcome[big] === 4 ? `, with ${c.pname(W.defender[big])} conquered` : W.outcome[big] === 6 ? ', in vassalage' : W.outcome[big] === 5 ? ', in tribute' : ''
      sents.push(cap(v.p('peace', { year: W.endYear[big], war: about(big), how })) + (ended.length > 1 ? v.p('peaceMore', { other: others(ended.length - 1, 'war') }) : ''))
    }
  }
  // the worst sack
  const sacks = of(EventType.Sacked)
  const worst = topBy(sacks, (e) => e.value * c.pop(e.settlement, Math.max(0, e.year - 1)), 1)[0]
  if (worst) {
    const byP = c.polityOf(worst.other, worst.year)
    sents.push(refs.cite(v.p('sack', { year: worst.year, by: byP >= 0 ? `the army of ${c.pname(byP)}` : `raiders from ${c.name(worst.other, worst.year)}`, town: c.name(worst.settlement, worst.year), share: shareWords(worst.value) }), { kind: 'city', id: worst.settlement }))
  }
  // states founded and fallen, and the greatest throne
  if (pd) {
    const fnd = of(EventType.PolityFounded).map((e) => e.value).filter((p) => p >= 0 && p < pd.count)
    if (fnd.length) {
      const big = topBy(fnd, (p) => c.ppeak(p).pop + 1, 1)[0]
      const x = pd.list[big]
      sents.push(refs.cite(v.p('founded', { year: x.foundedYear, state: c.ptitle(big, x.foundedYear), cap: c.name(x.capitals[0], x.foundedYear) }), { kind: 'state', id: big }) + (fnd.length > 1 ? v.p('foundedMore', { other: others(fnd.length - 1, legend ? 'crown' : 'state') }) : ''))
      facts.push(`${plural(fnd.length, 'state')} founded`)
    }
    const fell = of(EventType.PolityEnded).map((e) => e.value).filter((p) => p >= 0 && p < pd.count)
    if (fell.length) {
      const big = topBy(fell, (p) => c.ppeak(p).pop + 1, 1)[0]
      sents.push(refs.cite(v.p('ended', { year: pd.list[big].endedYear, state: c.pgreatTitle(big) }), { kind: 'state', id: big }) + (fell.length > 1 ? v.p('endedMore', { other: others(fell.length - 1, legend ? 'crown' : 'state') }) : ''))
    }
    if (c.rd) {
      const live = pd.list.filter((x) => c.plives(x.id, b)).map((x) => x.id)
      const top = topBy(live, (p) => c.pstat(p, sb)?.pop ?? 0, 1)[0]
      const acc = of(EventType.RulerAcceded).filter((e) => top !== undefined && e.value >= 0 && e.value < c.rd!.R && c.rd!.rulers[e.value].polity === top)
      if (acc.length) sents.push(v.p('acceded', { year: acc[0].year, ruler: c.ruler(acc[0].value), state: c.ptitle(top, acc[0].year) }))
    }
  }
  // sickness and hunger
  const da = of(EventType.DiseaseAppeared)[0]
  if (da) { const dn = c.disease(da.value, legend); if (dn) sents.push(cap(v.p('disease', { year: da.year, disease: dn, place: c.name(da.settlement, da.year) }))) }
  const st = topBy(of(EventType.CityStricken), (e) => (e.extra ?? 0) * c.pop(e.settlement, e.year), 1)[0]
  if (st && (st.extra ?? 0) >= 0.03) {
    const ep = h.epidemics?.[st.value]
    const dn = ep ? c.disease(ep.disease, legend) : ''
    if (dn) sents.push(cap(v.p('stricken', { year: st.year, disease: dn, city: c.name(st.settlement, st.year), share: shareWords(st.extra ?? 0) })))
  }
  const fam = topBy(of(EventType.Famine).filter((e) => e.value >= 0.1), (e) => e.value * c.pop(e.settlement, Math.max(0, e.year - 1)), 1)[0]
  if (fam && c.pop(fam.settlement, Math.max(0, fam.year - 1)) >= 500) sents.push(v.p('famine', { year: fam.year, place: c.name(fam.settlement, fam.year), share: shareWords(fam.value) }))
  // faith
  for (const e of of(EventType.FaithFounded).slice(0, 1)) sents.push(cap(v.p('faith', { year: e.year, faith: c.faith(e.value), place: c.name(e.settlement, e.year) })))
  if (pd) {
    const sr = topBy(of(EventType.StateReligion), (e) => { const p = c.polityOf(e.settlement, e.year); return p >= 0 ? (c.pstat(p, c.snap(e.year))?.pop ?? 0) + 1 : 0 }, 1)[0]
    if (sr) { const p = c.polityOf(sr.settlement, sr.year); if (p >= 0 && (c.pstat(p, c.snap(sr.year))?.pop ?? 0) >= CITY_POPULATION) sents.push(cap(v.p('stateFaith', { year: sr.year, faith: c.faith(sr.value), state: c.ptitle(p, sr.year) }))) }
  }
  // the edges of the world
  const lfs = of(EventType.Landfall)
  if (lfs.length) sents.push(v.p('landfall', { year: lfs[0].year, from: c.name(lfs[0].other, lfs[0].year), place: c.name(lfs[0].settlement, lfs[0].year), more: lfs.length > 1 ? `, the first of ${num(lfs.length)} such landfalls in those years` : '' }))
  const disc = of(EventType.Discovery)[0]
  if (disc) { const f = disc.value >= 0 ? h.features[disc.value] : null; sents.push(v.p('discovery', { year: disc.year, from: c.name(disc.settlement, disc.year), what: f ? featurePhrase(f.kind, f.name) : 'the pole' })) }
  const fc = of(EventType.FirstContact)[0]
  if (fc) sents.push(v.p('contact', { year: fc.year, a: c.peopleName(c.peopleOf(fc.settlement)), b: c.peopleName(c.peopleOf(fc.other)), place: c.name(fc.settlement, fc.year) }))
  // growth, ideas, works
  const cities = of(EventType.BecameCity)
  if (cities.length === 1) sents.push(refs.cite(v.p('city1', { town: c.name(cities[0].settlement, cities[0].year), year: cities[0].year }), { kind: 'city', id: cities[0].settlement }))
  else if (cities.length > 1) sents.push(cap(v.p('cities', { list: list(cities.slice(0, 3).map((e) => `${c.name(e.settlement, e.year)} (${e.year})`)) + (cities.length > 3 ? ` and ${num(cities.length - 3)} more` : '') })))
  const ideas = of(EventType.IdeaConceived).filter((e) => (e.extra ?? 0) === 0 && h.ideas[e.value])
  ideas.sort((x, y) => Number(MILESTONES.includes(h.ideas[y.value].key)) - Number(MILESTONES.includes(h.ideas[x.value].key)))
  if (ideas.length) {
    const xs = ideas.slice(0, 2).map((e) => `${h.ideas[e.value].name}, by the ${c.peopleName(c.peopleOf(e.settlement))} at ${c.name(e.settlement, e.year)} in ${e.year}`)
    sents.push(cap(v.p('ideas', { list: list(xs), was: xs.length > 1 ? 'were' : 'was' })))
  }
  const works = of(EventType.LandmarkCompleted)
  if (works.length) {
    const xs = works.slice(0, 2).map((e) => { const nm = c.landmark(e.value, e.year); const t = c.name(e.settlement, e.year); return `${nm}${nm.includes(t) ? '' : ` at ${t}`} (${e.year})` })
    sents.push(works.length === 1 ? cap(v.p('work1', { lm: xs[0].replace(/ \(\d+\)$/, ''), year: works[0].year })) : cap(v.p('works', { list: list(xs), was: 'were' })))
  }
  // the omens of those years (two at most)
  const om = omensOfYears(c, a, b).slice(0, 2).map((f) => omenText(c, v, f)).filter(Boolean)

  const body: string[] = [opener]
  // (the most telling nine, kept in the order of their years: the first year each names within the span)
  const yearIn = (s: string) => { for (const m of s.matchAll(/\b(\d{1,4})\b/g)) { const y = Number(m[1]); if (y >= a && y <= b) return y } return b }
  body.push(...sents.slice(0, 9).map((s, i) => [s, yearIn(s), i] as const).sort((x, y) => x[1] - y[1] || x[2] - y[2]).map((x) => (span === 1 ? cap(x[0].replace(new RegExp(`^In ${a},? `), '').replace(new RegExp(` in ${a}(?=[.,;])`), '')) : x[0])))
  if (sents.length === 0 && om.length === 0) body.push(v.p('quiet'))
  book.add(body.join(' '))
  for (const t of om) book.omen(t)
  const spanW = span === 1 ? `${a}` : b < a + span - 1 ? `${a}–${b}, told so far` : `${a}–${b}`
  if (sacks.length) facts.push(sacks.length === 1 ? 'a sack' : plural(sacks.length, 'sack'))
  if (cities.length) facts.push(plural(cities.length, 'new city', 'new cities'))
  if (lfs.length) facts.push(plural(lfs.length, 'landfall'))
  if (!facts.length) facts.push(sents.length ? (sents.length === 1 ? 'one thing of note' : 'a few things of note') : 'quiet years')
  return {
    kind, id: a, year: c.Y, legend,
    title: v.p(span === 1 ? 'titleYear' : 'titleDecade', { a, b: a + span - 1 }),
    epigraph: v.p('epigraph', { world: worldName, span: spanW, facts: list(facts) }),
    ...book.parts(),
    closing: v.p(span === 1 ? 'closingYear' : 'closingDecade', { a, b }),
  }
}

/** "One other state", "Three other states". */
const others = (n: number, one: string) => (n === 1 ? `One other ${one}` : `${cap(num(n))} other ${one}s`)

function featurePhrase(kind: number, name: string): string {
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
