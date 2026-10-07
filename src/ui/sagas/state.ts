// Sagas: "A History of the Empire of Rilkochal". A state's founding and founders, its capitals, its houses and notable
// rulers (long reigns, usurpers, regencies, deaths in battle), its wars won and lost, the towns it gained and lost
// (submissions, conquests, secessions, revolts, partitions), its state faith and great works, its height, and its
// fall or its extent at the year told. Every sentence comes from the records up to that year.

import { AccessionHow, BondKind, EventType, LandmarkRank, PolityEnd, PolityOrigin, ReignEnd, WarKind, WarOutcome } from '../../contract.ts'
import { landmarkNoun } from '../landmarksFormat.ts'
import { Ctx, topBy } from './facts.ts'
import { reignFacts, rulerEpithet, withEpithet } from './epithets.ts'
import { an, list, num, people, plural, times, Voice, type PhraseTable } from './voice.ts'
import type { Saga } from './types.ts'

const T: PhraseTable = {
  title: [['A History of the {state}'], ['The Saga of the {state}']],
  formed: [
    ['The {state} began in {year}, when {cap} gathered the towns around it into a state.', 'In {year} {cap} brought its neighbours under its rule, and the {state} was founded.'],
    ['In {year} {cap} gathered the towns about it under one rule, and so began the {state}.', 'In the year {year} the lords of {cap} bound their neighbours to them, and the {state} was born.'],
  ],
  revolt: [
    ['The {state} was born in revolt: in {year} towns of {parent} rose and broke away, with {cap} at their head.', 'In {year} provinces of {parent} threw off its rule and made {cap} the capital of the {state}.'],
    ['It was born of rebellion: in {year} the towns of {parent} cast off their masters and raised up {cap} as their seat.'],
  ],
  fragment: [
    ['When {parent} fell apart in {year}, {cap} became the seat of one of the states that rose from its ruins, the {state}.', 'The {state} was one of the successors of {parent}: when that realm broke apart in {year}, {cap} kept its own share.'],
    ['When {parent} was broken in {year}, {cap} took up a piece of the shattered realm and ruled it as its own.'],
  ],
  colonial: [['The towns of the {state} were colonies of {parent} overseas until {year}, when they broke away under {cap}.'], ['In {year} the far colonies of {parent} broke their bonds and raised {cap} as their seat.']],
  partition: [['The {state} was an heir\'s share of {parent}, cut from it at a succession in {year}, with {cap} as its seat.'], ['In {year} {parent} was divided among heirs, and this share fell to {cap}.']],
  civil: [['The {state} began in {year} as a rival centre of {parent}: {cap} rose against its capital and proclaimed its own ruler.'], ['In {year} {cap} rose against the throne of {parent} and set up a crown of its own.']],
  league: [['In {year} trading towns bound themselves together against a common threat, and the {state} was founded, led from {cap}.'], ['In {year} the merchant towns swore an oath together against their foes, and so the {state} began, with {cap} at its head.']],
  people: [[' Its rulers were {people}.', ' It was a state of the {people}.'], [' Its lords were of the {people}.']],
  firstRuler: [
    ['Its first ruler was {ruler}.', '{ruler} was its first ruler.'],
    ['First to rule it was {ruler}.'],
  ],
  firstRulerOf: [[' Its first ruler was {ruler}, of {house}.'], [' First to rule it was {ruler}, of {house}.']],
  capitals: [
    ['Its seat moved {times}: {moves}.', 'The capital moved {times}: {moves}.'],
    ['{times} its throne was carried to a new seat: {moves}.'],
  ],
  oneSeat: [['It was ruled from {cap} all its days.', '{cap} was its capital throughout.'], ['From {cap} it was ruled all its days.']],
  houses: [
    ['{n} reigned over it, of {houses}.', 'In all {n} sat on its throne, of {houses}.'],
    ['{n} held its crown in turn, of {houses}.'],
  ],
  houseLong: [
    ['House {name} held the throne longest, from {from} {to}, with {n}.', 'The longest-lived of its houses was House {name}, which gave it {n} from {from} {to}.'],
    ['Longest of all its houses ruled House {name}, from {from} {to}: {n} of its blood sat on the throne.'],
  ],
  longReign: [
    ['The longest reign was that of {ruler}, {years} years, from {from}.', '{ruler} reigned longest, for {years} years from {from}.'],
    ['Longest of all reigned {ruler}, {years} winters from {from}.'],
  ],
  usurpers: [
    ['{n} seized the throne by force, the first of them {ruler} in {year}.', 'The throne was seized {times}; the first usurper was {ruler}, in {year}.'],
    ['{times} the crown was torn away by force, and first to seize it was {ruler}, in {year}.'],
  ],
  regencies: [['{n} came to the throne as children and were ruled for by regents.'], ['{n} were crowned in their cradles, and others ruled in their name.']],
  battleDeath: [['{ruler} fell in battle in {year}.', 'In {year} {ruler} was killed in battle.'], ['In {year} {ruler} fell in the spear-storm.']],
  battleDeaths: [['{n} of its rulers fell in battle, among them {ruler}, in {year}.'], ['{n} of its kings fell in the spear-storm, and {ruler} among them, in {year}.']],
  plagueDeath: [['{ruler} died of plague in {year}.'], ['In {year} {ruler} was taken by the plague.']],
  crises: [['Its successions were contested {times}.'], ['{times} the death of a king left the throne in dispute.']],
  wars: [
    ['It fought {n}{record}.', 'In all it went to war {times}{record}.'],
    ['{times} it took up the spear{record}.'],
  ],
  warsNone: [['It fought no wars.'], ['It never went to war.']],
  bloodiest: [
    ['The bloodiest was {war}, {span}, which cost {dead} lives and ended {how}.', 'Its costliest war was {war}, {span}: it took {dead} lives and ended {how}.'],
    ['Bitterest of all was {war}, {span}: {dead} fell, and it ended {how}.'],
  ],
  holyWars: [['It fought {n} in the name of its faith.'], ['{n} it fought in the name of its gods.']],
  civilWars: [['It was torn by civil war {times}, first in {year}.'], ['{times} it was torn in two by civil war, first in {year}.']],
  joined: [['{n} joined it of their own will.'], ['{n} came to it of their own will.']],
  conquered: [['Its armies took {n}{where}.', 'In war it took {n}{where}.'], ['Its spears won {n}{where}.']],
  lostTowns: [['It lost {n} to its enemies in war.'], ['In war its foes tore {n} from it.']],
  revolts: [['Revolts broke out against it {times}; {crushed} were put down.'], ['Its subjects rose against it {times}, and {crushed} of the risings were crushed.']],
  seceded: [['{list} broke away from it.', 'It lost {list}, which broke away to stand alone.'], ['{list} broke from it and went their own way.']],
  partitioned: [['In {year} it was divided among heirs.'], ['In {year} the realm was cut in pieces among heirs.']],
  stateFaith: [
    ['In {year} {faith} became its state religion.', '{faith} was made the faith of the state in {year}.'],
    ['In {year} its rulers made {faith} the faith of the realm.'],
  ],
  stateFaithMore: [[' It changed its state faith {times} after that.', ' Later it changed its state faith {times}.'], [' {times} after that the realm changed its gods.']],
  persecution: [[' In {year} it began to persecute those of other faiths.'], [' In {year} it turned on those who kept other gods.']],
  works: [
    ['Under its rule were raised {list}.', 'Its great works were {list}.'],
    ['Its rulers raised {list}.'],
  ],
  workOne: [['Its great work was {list}.', 'Under its rule {list} was raised.'], ['Its rulers raised {list}.']],
  vassals: [['At one time or another {n} were its vassals.'], ['{n} in their time bent the knee to it as vassals.']],
  overlord: [['From {year} it was itself a vassal of {over}{until}.'], ['From {year} it bowed to {over} as vassal{until}.']],
  height: [
    ['It was at its height in {year}, when it ruled {pop} people in {members}.', 'At its height, in {year}, it ruled {pop} people in {members}.'],
    ['In {year} its power was greatest: {pop} souls in {members} obeyed it.'],
  ],
  endConquered: [['In {year} it was conquered{by}, and it was no more.', 'It fell in {year}, conquered{by}.'], ['In {year} it was cast down{by}, and its crown was broken.']],
  endFragmented: [['In {year} it broke apart into successor states.'], ['In {year} it shattered into pieces, and other crowns rose from its ruin.']],
  endDwindled: [['It dwindled away and was gone by {year}.'], ['By {year} it had dwindled to nothing.']],
  endReunified: [['In {year} it was taken back into {by}, the realm it had broken from.'], ['In {year} {by} gathered it back into itself.']],
  endAbsorbed: [['In {year} it submitted whole to {by}.'], ['In {year} it bowed its head and was swallowed by {by}.']],
  endOther: [['It ended in {year}.'], ['In {year} it passed away.']],
  lasted: [[' It had lasted {years} years.'], [' {years} years it had endured.']],
  now: [
    ['In {Y} it is {an} {tier} of {pop} people in {members}, ruled from {cap}{by}.', 'In {Y} the {state} rules {pop} people in {members} from {cap}{under}.'],
    ['In {Y} it stands {an} {tier} of {pop} souls in {members}, ruled from {cap}{by}.'],
  ],
  closing: [['Here ends the history of the {state}.', 'So stands the {state} in {Y}.'], ['So ends the saga of the {state}; long may its banners fly.', 'Here the tale of the {state} rests, but its days are not ended.']],
  closingEnded: [['Here ends the history of the {state}.'], ['So ends the saga of the {state}, whose crown is dust.']],
  epigraph: [['The {state}: {facts}.'], ['The {state}: {facts}.']],
}

function originKey(o: number): string {
  switch (o) {
    case PolityOrigin.Revolt: return 'revolt'
    case PolityOrigin.Fragment: return 'fragment'
    case PolityOrigin.Colonial: return 'colonial'
    case PolityOrigin.Partition: return 'partition'
    case PolityOrigin.CivilWar: return 'civil'
    case PolityOrigin.League: return 'league'
  }
  return 'formed'
}

/** How war w ended, from p's side: "in victory", "in defeat", "with nothing changed", "with the conquest of X". */
function warEnd(c: Ctx, w: number, p: number): string {
  const W = c.pd!.wars!
  if (W.endYear[w] < 0 || W.endYear[w] > c.Y) return 'still unfinished'
  const att = W.attacker[w] === p
  const other = att ? W.defender[w] : W.attacker[w]
  switch (W.outcome[w]) {
    case WarOutcome.WhitePeace: return 'with nothing changed'
    case WarOutcome.AttackerGains: return att ? 'in its favour' : `with ${c.pname(other)} the gainer`
    case WarOutcome.DefenderGains: return att ? `with ${c.pname(other)} the gainer` : 'in its favour'
    case WarOutcome.Conquest: return att ? `with ${c.pname(other)} conquered` : 'with its own conquest'
    case WarOutcome.Tribute: return att ? `with ${c.pname(other)} paying tribute` : 'with tribute to pay'
    case WarOutcome.Vassalage: return att ? `with ${c.pname(other)} made a vassal` : 'in vassalage'
    case WarOutcome.Reunified: return 'with the realm made one again'
  }
  return 'in peace'
}

export function stateSaga(c: Ctx, p: number, legend: boolean): Saga {
  const h = c.h
  const pd = c.pd!
  const x = pd.list[p]
  const v = new Voice(c.seed, `state:${p}`, legend, T)
  const Y = c.Y
  const state = c.pgreatTitle(p)
  const paras: string[] = []
  const rd = c.rd
  const reigns = rd ? [...h.reignIds.subarray(h.reignOffsets[p], h.reignOffsets[p + 1])].filter((r) => rd.rulers[r].acceded <= Y) : []

  // ---- founding ----
  const fy = x.foundedYear
  const cap0 = c.place(x.capitals[0], fy)
  const parent = x.parent >= 0 ? `the ${c.ptitle(x.parent, fy)}` : 'an older realm'
  let p1 = v.p(originKey(x.origin), { state: c.ptitle(p, fy), year: fy, cap: cap0, parent })
  p1 += v.p('people', { people: c.peopleName(x.people) })
  if (reigns.length && rd) {
    const r0 = reigns[0]
    const who = legend ? withEpithet(c.ruler(r0), rulerEpithet(reignFacts(c, r0))) : c.ruler(r0)
    const d = rd.rulers[r0].dynasty
    p1 += d >= 0 ? v.p('firstRulerOf', { ruler: who, house: `House ${h.dynasties[d].name}` }) : ' ' + v.p('firstRuler', { ruler: who })
  }
  paras.push(p1)

  // ---- capitals ----
  const moves: string[] = []
  for (let k = 1; k < x.capitals.length && x.capitalYears[k] <= Y; k++) moves.push(`to ${c.place(x.capitals[k], x.capitalYears[k])} in ${x.capitalYears[k]}`)
  const p2: string[] = []
  if (moves.length === 0) p2.push(v.p('oneSeat', { cap: c.name(x.capitals[0], Y) }))
  else if (moves.length <= 4) p2.push(v.p('capitals', { times: times(moves.length), moves: list(moves) }))
  else p2.push(v.p('capitals', { times: times(moves.length), moves: `${list(moves.slice(0, 2))}, and at last ${moves[moves.length - 1]}` }))

  // ---- houses and rulers ----
  if (rd && reigns.length) {
    const houseRuns: { d: number; from: number; to: number; n: number }[] = []
    for (const r of reigns) {
      const d = rd.rulers[r].dynasty
      const last = houseRuns[houseRuns.length - 1]
      const end = c.reignEndedBy(r) ? rd.rulers[r].ended : Y
      if (last && last.d === d) { last.to = end; last.n++ }
      else houseRuns.push({ d, from: rd.rulers[r].acceded, to: end, n: 1 })
    }
    const houseIds = [...new Set(reigns.map((r) => rd.rulers[r].dynasty).filter((d) => d >= 0))]
    if (reigns.length >= 2) {
      const hs = houseIds.length === 1 ? `one house, House ${h.dynasties[houseIds[0]].name}` : houseIds.length <= 3 ? `${num(houseIds.length)} houses: ${list(houseIds.map((d) => h.dynasties[d].name))}` : `${num(houseIds.length)} houses`
      p2.push(v.p('houses', { n: plural(reigns.length, 'ruler'), houses: hs }))
      if (houseIds.length > 1) {
        const best = [...houseRuns].filter((r) => r.d >= 0).sort((a, b) => b.to - b.from - (a.to - a.from))[0]
        if (best && best.n >= 3) p2.push(v.p('houseLong', { name: h.dynasties[best.d].name, from: best.from, to: best.to >= Y && !h.dynasties[best.d] ? 'onward' : best.to >= Y ? 'to this day' : `to ${best.to}`, n: plural(best.n, 'ruler') }))
      }
      const long = topBy(reigns, (r) => c.reignYears(r), 1)[0]
      if (long !== undefined && c.reignYears(long) >= 20) {
        const who = legend ? withEpithet(c.ruler(long), rulerEpithet(reignFacts(c, long))) : c.ruler(long)
        p2.push(v.p('longReign', { ruler: who, years: c.reignYears(long), from: rd.rulers[long].acceded }))
      }
    }
    const usurp = reigns.filter((r) => rd.rulers[r].how === AccessionHow.Usurped)
    if (usurp.length) {
      const who = legend ? withEpithet(c.ruler(usurp[0]), 'the Usurper') : c.ruler(usurp[0])
      p2.push(v.p('usurpers', { n: usurp.length === 1 ? 'One ruler' : `${num(usurp.length)} rulers`, times: times(usurp.length), ruler: who, year: rd.rulers[usurp[0]].acceded }).replace(/^One ruler seized the throne by force, the first of them (.*) in (\d+)\.$/, '$1 seized the throne by force in $2.'))
    }
    const regs = reigns.filter((r) => (rd.regency[r] ?? 0) > 0)
    if (regs.length >= 2) p2.push(v.p('regencies', { n: plural(regs.length, 'ruler') }))
    const battle = reigns.filter((r) => c.reignEndedBy(r) && rd.rulers[r].end === ReignEnd.Battle)
    if (battle.length === 1) p2.push(v.p('battleDeath', { ruler: c.ruler(battle[0]), year: rd.rulers[battle[0]].ended }))
    else if (battle.length > 1) p2.push(v.p('battleDeaths', { n: num(battle.length), ruler: c.ruler(battle[0]), year: rd.rulers[battle[0]].ended }))
    const plague = reigns.filter((r) => c.reignEndedBy(r) && rd.rulers[r].end === ReignEnd.Plague)
    if (plague.length) p2.push(v.p('plagueDeath', { ruler: c.ruler(plague[0]), year: rd.rulers[plague[0]].ended }))
  }
  const crises = c.type(EventType.SuccessionCrisis).filter((i) => c.ev(i).value === p).length
  if (crises >= 2) p2.push(v.p('crises', { times: times(crises) }))
  paras.push(p2.join(' '))

  // ---- wars ----
  const p3: string[] = []
  const W = pd.wars
  const wars = W ? (pd.warsOf[p] ?? []).filter((w) => W.startYear[w] <= Y) : []
  if (W && wars.length) {
    let won = 0, lost = 0
    for (const w of wars) {
      if (W.endYear[w] < 0 || W.endYear[w] > Y) continue
      const att = W.attacker[w] === p
      const o = W.outcome[w]
      if (o === WarOutcome.AttackerGains || o === WarOutcome.Conquest || o === WarOutcome.Tribute || o === WarOutcome.Vassalage) att ? won++ : lost++
      else if (o === WarOutcome.DefenderGains) att ? lost++ : won++
    }
    const record = won + lost > 0 ? `, winning ${won ? num(won) : 'none'} and losing ${lost ? num(lost) : 'none'}` : ''
    p3.push(v.p('wars', { n: wars.length === 1 ? 'one war' : `${num(wars.length)} wars`, times: times(wars.length), record: wars.length === 1 ? '' : record }))
    const bloody = topBy(wars, (w) => W.dead[w], 1)[0]
    if (bloody !== undefined && W.dead[bloody] >= 500) {
      const other = W.attacker[bloody] === p ? W.defender[bloody] : W.attacker[bloody]
      const civil = W.kind[bloody] === WarKind.CivilWar
      const war = civil ? 'the civil war' : `the war against ${c.pname(other)}`
      const e = W.endYear[bloody]
      const sp = e >= 0 && e <= Y ? (e === W.startYear[bloody] ? `fought in ${e}` : `fought from ${W.startYear[bloody]} to ${e}`) : `begun in ${W.startYear[bloody]}`
      p3.push(v.p('bloodiest', { war, span: sp, dead: people(W.dead[bloody]), how: warEnd(c, bloody, p) }))
    }
    const holy = wars.filter((w) => h.holyWars?.includes(w) && W.attacker[w] === p).length
    if (holy) p3.push(v.p('holyWars', { n: holy === 1 ? 'one holy war' : `${num(holy)} holy wars` }))
    const civ = wars.filter((w) => W.kind[w] === WarKind.CivilWar && W.defender[w] === p)
    if (civ.length) p3.push(v.p('civilWars', { times: times(civ.length), year: W.startYear[civ[0]] }))
  } else if (W) p3.push(v.p('warsNone'))

  // ---- towns gained and lost ----
  const joined = c.type(EventType.Joined).filter((i) => c.ev(i).value === p).length
  if (joined >= 2) p3.push(v.p('joined', { n: plural(joined, 'town') }))
  const conq = c.type(EventType.Conquered).map((i) => c.ev(i)).filter((e) => W && e.value >= 0 && e.value < W.count && (W.attacker[e.value] === p || W.defender[e.value] === p))
  const took = conq.filter((e) => c.polityOf(e.settlement, e.year + h.snapshotInterval) === p)
  const lostT = conq.filter((e) => c.polityOf(e.settlement, Math.max(0, e.year - 1)) === p && c.polityOf(e.settlement, e.year + h.snapshotInterval) !== p)
  if (took.length) {
    const big = topBy(took, (e) => c.pop(e.settlement, e.year), 1)[0]
    p3.push(v.p('conquered', { n: plural(took.length, 'town'), where: big && c.pop(big.settlement, big.year) >= 3000 ? `, the greatest of them ${c.place(big.settlement, big.year)}, in ${big.year}` : '' }))
  }
  if (lostT.length >= 2) p3.push(v.p('lostTowns', { n: plural(lostT.length, 'town') }))
  const revolts = c.type(EventType.Revolt).map((i) => c.ev(i)).filter((e) => c.polityOf(e.other, e.year) === p && c.capital(p, e.year) === e.other)
  if (revolts.length >= 2) {
    const crushed = c.type(EventType.RevoltCrushed).map((i) => c.ev(i)).filter((e) => c.capital(p, e.year) === e.other).length
    p3.push(v.p('revolts', { times: times(revolts.length), crushed: crushed === 0 ? 'none' : crushed >= revolts.length ? 'all' : num(crushed) }).replace('; all were put down', '; every one was put down').replace(', and all of the risings', ', and every one of the risings'))
  }
  const kids = (pd.children[p] ?? []).filter((q) => pd.list[q].foundedYear <= Y && (pd.list[q].origin === PolityOrigin.Revolt || pd.list[q].origin === PolityOrigin.Colonial || pd.list[q].origin === PolityOrigin.CivilWar))
  if (kids.length) p3.push(v.p('seceded', { list: kids.length <= 3 ? list(kids.map((q) => c.pname(q))) : `${kids.slice(0, 2).map((q) => c.pname(q)).join(', ')} and ${num(kids.length - 2)} others` }))
  const part = c.type(EventType.Partitioned).map((i) => c.ev(i)).find((e) => e.value === p)
  if (part) p3.push(v.p('partitioned', { year: part.year }))
  if (p3.length) paras.push(p3.join(' '))

  // ---- faith and great works ----
  const p4: string[] = []
  const sf = c.type(EventType.StateReligion).map((i) => c.ev(i)).filter((e) => c.capital(p, e.year) === e.settlement && c.plives(p, e.year))
  if (sf.length) {
    let t = v.p('stateFaith', { year: sf[0].year, faith: c.faith(sf[0].value) })
    if (sf.length > 1) t += v.p('stateFaithMore', { times: times(sf.length - 1) })
    const pers = c.type(EventType.Persecution).map((i) => c.ev(i)).find((e) => c.capital(p, e.year) === e.settlement && c.plives(p, e.year))
    if (pers) t += v.p('persecution', { year: pers.year })
    p4.push(t)
  }
  const L = h.landmarks
  if (L) {
    const works: number[] = []
    for (let i = 0; i < L.count && L.begunYear[i] <= Y; i++) if (L.polity[i] === p && L.rank[i] === LandmarkRank.Great) works.push(i)
    if (works.length) {
      const items = works.slice(0, 4).map((i) => {
        const nm = c.landmark(i, L.begunYear[i])
        const noun = landmarkNoun(L.kind[i], L.form[i])
        const town = c.name(L.settlement[i], L.begunYear[i])
        return `${nm}${nm.toLowerCase().includes(noun.split(' ').pop()!) ? '' : `, ${an(noun)},`}${nm.includes(town) ? '' : ` at ${town}`}`
      })
      p4.push(v.p(works.length === 1 ? 'workOne' : 'works', { list: list(items) + (works.length > 4 ? `, among ${num(works.length)} in all` : '') }))
    }
  }
  const B = pd.bonds
  if (B) {
    const vassals = new Set<number>()
    let over = -1, overYear = 0, overEnd = -1
    for (let k = 0; k < B.count && B.startYear[k] <= Y; k++) {
      if (B.kind[k] !== BondKind.Vassal) continue
      if (B.b[k] === p) vassals.add(B.a[k])
      if (B.a[k] === p && over < 0) { over = B.b[k]; overYear = B.startYear[k]; overEnd = B.endYear[k] }
    }
    if (vassals.size >= 2) p4.push(v.p('vassals', { n: plural(vassals.size, 'state') }))
    if (over >= 0) p4.push(v.p('overlord', { year: overYear, over: `the ${c.ptitle(over, overYear)}`, until: overEnd >= 0 && overEnd <= Y ? ` until ${overEnd}` : '' }))
  }
  if (p4.length) paras.push(p4.join(' '))

  // ---- height, and fall or present ----
  const pk = c.ppeak(p)
  const p5: string[] = []
  const ended = x.endedYear >= 0 && x.endedYear <= Y
  if (pk.year >= 0 && pk.pop > 0 && !(!ended && pk.year >= Y - h.snapshotInterval)) p5.push(v.p('height', { year: pk.year, pop: people(pk.pop), members: plural(pk.members, 'town and village', 'towns and villages') }))
  let closing: string
  if (ended) {
    const endEv = c.type(EventType.PolityEnded).map((i) => c.ev(i)).find((e) => e.value === p)
    const byP = endEv && endEv.other >= 0 ? c.polityOf(endEv.other, x.endedYear) : -1
    const by = byP >= 0 && byP !== p ? ` by the ${c.ptitle(byP, x.endedYear)}` : ''
    const byN = byP >= 0 && byP !== p ? `the ${c.ptitle(byP, x.endedYear)}` : 'a larger neighbour'
    const key = x.endCause === PolityEnd.Conquered ? 'endConquered' : x.endCause === PolityEnd.Fragmented ? 'endFragmented' : x.endCause === PolityEnd.Dwindled ? 'endDwindled' : x.endCause === PolityEnd.Reunified ? 'endReunified' : x.endCause === PolityEnd.Absorbed ? 'endAbsorbed' : 'endOther'
    p5.push(v.p(key, { year: x.endedYear, by: key === 'endConquered' ? by : byN }) + v.p('lasted', { years: x.endedYear - fy }))
    closing = v.p('closingEnded', { state })
  } else {
    const st = c.pstat(p, c.sY)
    const capNow = c.capital(p, Y)
    const r = rd ? (() => { const a = reigns.filter((r) => !c.reignEndedBy(r)); return a[a.length - 1] ?? -1 })() : -1
    const tierW = c.ptitle(p).split(' of ')[0].toLowerCase()
    p5.push(v.p('now', {
      Y, state: c.ptitle(p), an: an(tierW).split(' ')[0], tier: tierW,
      pop: people(st?.pop ?? 0).replace(/^some /, ''), members: plural(st?.members ?? 0, 'town and village', 'towns and villages'),
      cap: c.name(capNow, Y), by: r >= 0 ? ` by ${legend ? withEpithet(c.ruler(r, Y), rulerEpithet(reignFacts(c, r))) : c.ruler(r, Y)}` : '',
      under: r >= 0 ? `, under ${legend ? withEpithet(c.ruler(r, Y), rulerEpithet(reignFacts(c, r))) : c.ruler(r, Y)}` : '',
    }))
    closing = v.p('closing', { state: c.ptitle(p), Y })
  }
  paras.push(p5.join(' '))

  const facts: string[] = [`founded ${fy} at ${c.name(x.capitals[0], fy)}`]
  if (reigns.length >= 2) facts.push(plural(reigns.length, 'ruler'))
  if (wars.length) facts.push(plural(wars.length, 'war'))
  facts.push(ended ? `ended ${x.endedYear}` : `standing in ${Y}`)
  return {
    kind: 'state', id: p, year: Y, legend,
    title: v.p('title', { state }),
    epigraph: v.p('epigraph', { state, facts: list(facts) }),
    paragraphs: paras,
    closing,
  }
}
