// Sagas: "The Chronicle of the World of Kusemuyu". The whole history in eras, a paragraph each: the first villages and
// their cradles, the meetings of peoples and the first landfalls, the rise of states, the wars, the ways of trade,
// faith and plague, ideas and great works, and the world at the year told, naming the greatest cities, peoples, states
// and turning points with their years. An era with nothing in the records yet is left out.

import { CITY_POPULATION, EventType, FeatureKind, OrderKind, OrderStatus, TOWN_POPULATION, WarKind } from '../../contract.ts'
import { goodsOf } from '../goodsData.ts'
import { Ctx, topBy } from './facts.ts'
import { list, num, people, plural, shareWords, Voice, type PhraseTable } from './voice.ts'
import { Book, type Saga } from './types.ts'
import { DIVINE_T, divineSummary, OMEN_T, omenText, ordersWhere } from './omens.ts'
import { Refs } from './refs.ts'
import { conversionScene, landfallScene, pickScenes, plagueScene, sackScene, SCENE_T, workScene, type Scene } from './scenes.ts'
import { warName } from './wars.ts'

const T: PhraseTable = {
  title: [['The Chronicle of the World of {world}'], ['The Chronicle of the World of {world}']],
  hVillages: [['The First Villages'], ['The Elder Days']],
  hContact: [['Cradles and First Meetings'], ['The Meeting of Peoples']],
  hStates: [['The Rise of States'], ['The Coming of Crowns']],
  hWar: [['Wars'], ['The Spear-Ages']],
  hPowers: [['The Great Powers'], ['The Ages of Empire']],
  powerFirst: [
    ['By {from} the greatest state in the world was the {state}', 'The first great power was the {state}, the largest state by {from}'],
    ['By {from} the mightiest realm under the sky was the {state}', 'First of the great powers was the {state}, mightiest of realms by {from}'],
  ],
  powerHeld: [[', and it kept the first place until {to}.', ', and it remained the largest until {to}.'], [', and it held the first place until {to}.']],
  powerNow: [[', and it remains the largest.', ', and it is the largest still.'], [', and none has yet surpassed it.']],
  powerNext: [
    ['By {from} the {state} had overtaken it', 'Then the {state} rose above it, by {from}', 'The {state} was the largest by {from}'],
    ['By {from} the {state} had risen above it', 'Then came the {state}, greatest of realms by {from}', 'By {from} the {state} stood above all others'],
  ],
  powerAgain: [['By {from} the {state} was the largest once more', 'The {state} took the first place again by {from}'], ['By {from} the {state} stood first once more']],
  cityFirst: [['{city} was the largest city in the world by {year}.', 'By {year} {city} was the largest city in the world.'], ['By {year} {city} was the greatest of cities.']],
  cityNext: [['{city} overtook it by {year}', 'By {year} {city} had outgrown it'], ['By {year} {city} had outgrown it']],
  cityTraded: [[', and the two have traded the first place since; in {Y} the larger is {city}.'], [', and since then the two have contended for the first place; in {Y} {city} is the greater.']],
  cityLater: [[', and later {list} each had their turn; in {Y} the largest is {city}.'], [', and after it {list} each had their day; in {Y} {city} is the greatest.']],
  cityRuns: [
    ['The largest city was {first}; {rest}.', 'The greatest city of the world was {first}; {rest}.'],
    ['Greatest of cities was {first}; {rest}.'],
  ],
  cityRunsOne: [[' {first} has been the largest city of the world since it became a city.'], [' {first} has been the greatest of cities since it grew into one.']],
  hTrade: [['The Ways of Trade'], ['The Roads of Gold']],
  hFaith: [['Faith and Plague'], ['Gods and Pestilence']],
  hIdeas: [['Ideas and Great Works'], ['The Age of Wonders']],
  hNow: [['The World in {Y}'], ['The World as It Stands']],
  hOmens: [['Signs and Portents'], ['Signs and Wonders']],
  beginning: [
    ['When the counting of years began, {n} peoples lived in {k}: {groups}.', 'At the beginning of the records there were {n} peoples, in {k}: {groups}.'],
    ['In the beginning {n} peoples kindled their fires in {k}: {groups}.', 'Before the first year was counted, {n} peoples dwelt in {k}: {groups}.'],
  ],
  land: [[' The greatest land of the world, later called {name}, held {which}.'], [' The greatest of lands, which men came to call {name}, held {which}.']],
  firstTown: [
    ['The first of their villages to grow into a town was {town} of the {people}, in {year}', '{town}, a village of the {people}, was the first to become a town, in {year}'],
    ['In {year} {town} of the {people} grew first of all into a town', 'First of all hearths to grow into a town was {town} of the {people}, in {year}'],
  ],
  firstCity: [['; the first city was {city}, in {year}.', ', and the first to become a city was {city}, in {year}.'], ['; and in {year} {city} became the first great city.', ', and {city} rose first to be a city, in {year}.']],
  sameCity: [[', and in {year} it became the first city as well.', '; it was also the first to become a city, in {year}.'], ['; and in {year} it became the first great city as well.']],
  noCity: [['; no town had yet become a city.'], ['; no city had yet arisen.']],
  noTown: [['For long none of their villages grew into a town.'], ['Long the peoples dwelt in villages, and none grew great.']],
  firstContact: [
    ['The first meeting of peoples on record came in {year}, when the {a} and the {b} met at {place}.', 'In {year} the {a} and the {b} met at {place}: the first meeting of two peoples on record.'],
    ['In {year} at {place} the {a} first looked upon the {b}, and so began the meeting of peoples.'],
  ],
  crossCradle: [
    ['The first meeting across the cradles, between the {a} and the {b}, came in {year}.', 'Peoples of different cradles first met in {year}: the {a} and the {b}.'],
    ['In {year} the {a} and the {b}, of different cradles, met for the first time, and the world grew wider.'],
  ],
  allMet: [[' By {year} every people had met at least one other.'], [' By {year} no people dwelt alone.']],
  landfalls: [
    ['The first landfall on an empty land was made in {year} by settlers from {from}, who founded {place}; by {Y} there had been {n} such landfalls.', 'In {year} settlers from {from} founded {place} on a land where no one had lived; {n} such landfalls followed by {Y}.'],
    ['In {year} the seafarers of {from} first came to an empty shore and raised {place}; {n} such landfalls were made by {Y}.'],
  ],
  landfallsOne: [['In {year} settlers from {from} founded {place} on an empty land, the only such landfall by {Y}.'], ['In {year} the seafarers of {from} came to an empty shore and raised {place} there.']],
  firstState: [
    ['The first state was founded in {year}, when {cap} gathered its neighbours into the {state}.', 'In {year} {cap} founded the first state, the {state}.'],
    ['In {year} the first crown was raised at {cap}: the {state}.'],
  ],
  grewKingdom: [[', which by {year} had become the first kingdom.', ', and by {year} it was the first kingdom.'], [', and by {year} it had waxed into the first kingdom.']],
  firstKingdom: [[' The first kingdom was the {state}, by {year}.', ' By {year} the {state} had become the first kingdom.'], [' By {year} the {state} had grown to be the first kingdom.']],
  firstEmpire: [[' The first empire was the {state}, by {year}.', ' By {year} the {state} had become the first empire.'], [' And by {year} the {state} had become the first empire.']],
  greatest: [
    ['The greatest state of all was the {state}, which in {year} ruled {pop} people, {share} of the world\'s people.', 'Greatest of all states was the {state}: in {year} it ruled {pop} people, {share} of all the world\'s.'],
    ['Mightiest of all realms was the {state}, which in {year} held sway over {pop} souls, {share} of all the world\'s.'],
  ],
  rose: [[' In all {n} states rose by {Y}, and {m} of them fell.'], [' In all, {n} crowns were raised by {Y}, and {m} of them were cast down.']],
  wars: [
    ['By {Y} the states had fought {n} wars{civil}.', 'Down to {Y} the states fought {n} wars{civil}.'],
    ['By {Y} the spear-storm had blown {n} times{civil}.'],
  ],
  bloodiest: [
    ['The bloodiest was {war}, {span}, which cost {dead} lives.', 'Bloodiest of all was {war}, {span}: {dead} died in it.'],
    ['Bitterest of all was {war}, {span}, in which {dead} fell.'],
  ],
  worstSack: [
    ['The worst sack befell {place} in {year}, when the army of the {by} took it and {share} of its people were lost.', 'In {year} the army of the {by} sacked {place}, and {share} of its people were lost: the worst sack on record.'],
    ['In {year} the host of the {by} put {place} to the torch, and {share} of its people perished: no sack was ever worse.'],
  ],
  firstRoute: [
    ['Trade between towns is first recorded in {year}, between {a} and {b}.', 'The first trade route on record opened in {year}, between {a} and {b}.'],
    ['In {year} the first merchants went between {a} and {b}.'],
  ],
  routesNow: [[' By {Y} there were {n} open routes.'], [' By {Y} there were {n} roads of trade.']],
  firstLane: [
    ['In {year} a trade expedition from {a} opened the first direct lane, to {b}{sought}.', 'The first long-haul lane was opened in {year}, from {a} to {b}{sought}.'],
    ['In {year} the ships of {a} first found the open road to {b}{sought}.'],
  ],
  bigMart: [[' The greatest mart of the long-haul trade was {mart}.', ' Of all the marts of the long-haul trade, {mart} was the greatest.'], [' Greatest of all markets was {mart}.']],
  traditions: [[' Renowned crafts arose: {list}.'], [' Famed crafts arose: {list}.']],
  faiths: [
    ['The first universal faith, {faith}, was founded at {place} in {year}.', 'In {year} {faith} was first preached at {place}, the first faith to seek converts among all peoples.'],
    ['In {year} at {place} {faith} was proclaimed, the first faith to call to all peoples.'],
  ],
  faithsMore: [[' {list} followed.', ' After it came {list}.'], [' After it arose {list}.']],
  faithNow: [[' In {Y} the largest faith is {faith}, followed by {share} of the world\'s people.'], [' In {Y} the mightiest faith is {faith}, which {share} of the world follows.']],
  holyWars: [[' {n} holy wars were fought in their names.'], [' {n} holy wars were waged in their names.']],
  diseases: [
    ['{disease} first struck at {place} in {year}.', 'In {year} {disease} appeared at {place}.'],
    ['In {year} {disease} first came out of {place}.'],
  ],
  greatEpidemics: [
    ['{n} great epidemics are recorded; the worst began in {year} and killed {dead}.', 'The worst of {n} great epidemics began in {year}, and {dead} died of it.'],
    ['{n} great pestilences swept the world; the worst began in {year}, and {dead} went to their graves.'],
  ],
  greatEpidemic: [['One great epidemic is recorded: it began in {year} and killed {dead}.'], ['One great pestilence swept the world, from {year}, and {dead} went to their graves.']],
  ideas: [
    ['{first} was first worked out by the {people} in {year}.', 'The {people} were the first to master {first}, in {year}.'],
    ['In {year} the {people} first mastered {first}.'],
  ],
  ideasThen: [[' Then came {list}.', ' After it came {list}.'], [' Then were found {list}.', ' After it came {list}.']],
  works: [[' By {Y} {n} great buildings had been raised, among them {list}.'], [' By {Y} {n} great works stood or had stood, among them {list}.']],
  nowWorld: [
    ['In {Y} {pop} people live in {n}.', 'In {Y} the world holds {pop} people, in {n}.'],
    ['In {Y} {pop} souls dwell in {n}.'],
  ],
  nowCities: [[' The greatest cities are {list}.', ' Its largest cities are {list}.'], [' Greatest of its cities are {list}.']],
  nowStates: [[' {n} states stand; the greatest is the {state}, with {pop} people.'], [' {n} crowns stand, and mightiest is the {state}, with {pop} souls.']],
  nowPeoples: [[' The most numerous people is the {people}.'], [' Most numerous of peoples are the {people}.']],
  nowGone: [[' {list} have vanished.'], [' {list} are no more.']],
  closing: [['Here ends the chronicle, told to the year {Y}.'], ['Here the chronicle rests in the year {Y}; what comes after is not yet sung.']],
  epigraph: [['The world of {world}: {facts}.'], ['The world of {world}: {facts}.']],
}

const MILESTONES = ['pottery', 'wheel', 'iron', 'writing', 'coinage', 'paper', 'compass', 'printing', 'gunpowder', 'science']

export function worldSaga(c: Ctx, legend: boolean): Saga {
  const h = c.h
  const v = new Voice(c.seed, 'world', legend, T, SCENE_T, OMEN_T, DIVINE_T)
  const Y = c.Y
  const P = h.peoples.length
  const book = new Book()
  const refs = new Refs(c, book, { kind: 'world', id: 0 }, legend, 4)
  // the scenes: the first landfall, the worst sacks, the worst plague in a city, the longest great work, the greatest conversion
  const topEv = (t: number, key: (i: number) => number, n: number) => topBy(c.type(t), key, n)
  const lf0 = c.type(EventType.Landfall)[0]
  const scenes = pickScenes([
    lf0 !== undefined ? landfallScene(c, v, lf0) : null,
    ...topEv(EventType.Sacked, (i) => c.ev(i).value * c.pop(c.ev(i).settlement, Math.max(0, c.ev(i).year - 1)), 2).map((i) => sackScene(c, v, i)),
    ...topEv(EventType.CityStricken, (i) => (c.ev(i).extra ?? 0) * c.pop(c.ev(i).settlement, c.ev(i).year), 2).map((i) => plagueScene(c, v, i, legend)),
    ...topEv(EventType.LandmarkCompleted, (i) => { const L = h.landmarks; const k = c.ev(i).value; return L ? L.completedYear[k] - L.begunYear[k] : 0 }, 1).map((i) => workScene(c, v, i)),
    ...topEv(EventType.RulerConverted, (i) => { const p = c.polityOf(c.ev(i).settlement, c.ev(i).year); return p >= 0 ? c.pstat(p, c.snap(c.ev(i).year))?.pop ?? 0 : 0 }, 1).map((i) => conversionScene(c, v, i)),
  ], 4)
  // the omens: four at most, those that came true (in part or whole) first
  const omens = ordersWhere(c, () => true).sort((a, b) => Number(b.status === OrderStatus.Fulfilled || b.status === OrderStatus.Partly) - Number(a.status === OrderStatus.Fulfilled || a.status === OrderStatus.Partly)).slice(0, 4)
  const placed = new Set<number>()
  const add = (head: string, text: string, sceneKinds: readonly Scene['kind'][] = [], omenKinds: readonly number[] = []) => {
    book.chapter(head)
    book.add(text)
    for (const s of scenes) if (sceneKinds.includes(s.kind)) book.scene(s.title, s.text)
    for (const f of omens.filter((x) => omenKinds.includes(x.o.kind)).sort((a, b) => a.o.year - b.o.year)) { placed.add(f.k); book.omen(omenText(c, v, f)) }
  }
  const worldName = worldNameOf(c)

  // ---- the first villages ----
  const cradles = new Map<number, number[]>()
  for (const p of h.peoples) { const a = cradles.get(p.cradle) ?? []; a.push(p.id); cradles.set(p.cradle, a) }
  const nth = ['one', 'another', 'a third', 'a fourth', 'a fifth', 'a sixth', 'a seventh', 'an eighth']
  const groups = [...cradles.values()].map((ps, i) => `the ${list(ps.map((p) => c.peopleName(p)))} in ${nth[i] ?? 'another'}`)
  let t1 = v.p('beginning', { n: num(P), k: plural(cradles.size, 'cradle'), groups: groups.length > 1 ? groups.join('; ') : groups[0] })
  // (the hearths the player planted, as the Divine's: one sentence, omens.ts)
  const dv = divineSummary(c, v, false)
  if (dv) t1 += ' ' + dv
  const firstT = c.type(EventType.BecameTown)[0], firstC = c.type(EventType.BecameCity)[0]
  if (firstT !== undefined) {
    const e = c.ev(firstT)
    t1 += ' ' + v.p('firstTown', { town: c.place(e.settlement, e.year), people: c.peopleName(c.peopleOf(e.settlement)), year: e.year })
    if (firstC !== undefined && c.ev(firstC).settlement === e.settlement) t1 += v.p('sameCity', { year: c.ev(firstC).year })
    else if (firstC !== undefined) t1 += v.p('firstCity', { city: c.place(c.ev(firstC).settlement, c.ev(firstC).year), year: c.ev(firstC).year })
    else t1 += v.p('noCity')
  } else t1 += ' ' + v.p('noTown')
  if (firstC !== undefined) t1 = refs.cite(t1, { kind: 'city', id: c.ev(firstC).settlement })
  add(v.p('hVillages'), t1)

  // ---- meetings and landfalls ----
  const t2: string[] = []
  const t2y: number[] = []
  const push2 = (t: string, y: number) => { t2.push(t); t2y.push(y) }
  const fcs = c.type(EventType.FirstContact).map((i) => c.ev(i))
  if (fcs.length) {
    const e = fcs[0]
    push2(v.p('firstContact', { year: e.year, a: c.peopleName(c.peopleOf(e.settlement)), b: c.peopleName(c.peopleOf(e.other)), place: c.place(e.settlement, e.year) }), e.year)
    const cross = fcs.find((x) => h.peoples[c.peopleOf(x.settlement)]?.cradle !== h.peoples[c.peopleOf(x.other)]?.cradle)
    if (cross && cross !== e) push2(v.p('crossCradle', { year: cross.year, a: c.peopleName(c.peopleOf(cross.settlement)), b: c.peopleName(c.peopleOf(cross.other)) }), cross.year)
    let allBy = -1
    for (let p = 0; p < P; p++) {
      let first = 1e9
      for (let q = 0; q < P; q++) { const y = h.contactYear[p * P + q]; if (q !== p && y >= 0 && y < first) first = y }
      allBy = Math.max(allBy, first)
    }
    if (allBy <= Y && P > 2) push2(v.p('allMet', { year: allBy }).trim(), allBy)
  }
  const lfs = c.type(EventType.Landfall).map((i) => c.ev(i))
  if (lfs.length === 1) push2(v.p('landfallsOne', { year: lfs[0].year, from: c.place(lfs[0].other, lfs[0].year), place: c.place(lfs[0].settlement, lfs[0].year), Y }), lfs[0].year)
  else if (lfs.length > 1) push2(v.p('landfalls', { year: lfs[0].year, from: c.place(lfs[0].other, lfs[0].year), place: c.place(lfs[0].settlement, lfs[0].year), n: num(lfs.length), Y }), lfs[0].year)
  add(v.p('hContact'), t2.map((t, i) => [t, t2y[i], i] as const).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0]).join(' '), ['landfall'], [OrderKind.Explore, OrderKind.Settle])

  // ---- states ----
  const pd = c.pd
  if (pd && pd.count) {
    const live = pd.list.filter((x) => x.foundedYear <= Y)
    if (live.length) {
      const x0 = live[0]
      let t3 = v.p('firstState', { year: x0.foundedYear, cap: c.place(x0.capitals[0], x0.foundedYear), state: c.ptitle(x0.id, x0.foundedYear) })
      // first kingdom and empire: the first snapshot any polity reached the tier
      let kY = -1, kP = -1, eY = -1, eP = -1
      for (let s = 0; s <= c.sY && eY < 0; s++) for (let k = pd.aliveOffsets[s]; k < pd.aliveOffsets[s + 1]; k++) {
        const t = pd.aliveTier[k]
        if (t >= 1 && kY < 0) { kY = s * pd.interval; kP = pd.aliveId[k] }
        if (t >= 2 && eY < 0) { eY = s * pd.interval; eP = pd.aliveId[k] }
      }
      if (kP >= 0 && kP === x0.id) t3 = t3.replace(/\.$/, '') + v.p('grewKingdom', { year: kY })
      else if (kP >= 0) t3 += v.p('firstKingdom', { state: `Kingdom of ${c.pname(kP)}`.replace(/^Kingdom of (.*)$/, (m) => (pd.list[kP].origin === 6 ? `League of ${c.pname(kP)}` : m)), year: kY })
      if (eP >= 0) t3 += v.p('firstEmpire', { state: `Empire of ${c.pname(eP)}`, year: eY })
      const best = topBy(live.map((x) => x.id), (q) => c.ppeak(q).pop, 1)[0]
      if (best !== undefined) {
        const pk = c.ppeak(best)
        const wp = pd.worldPop[c.snap(pk.year)] || 1
        t3 += ' ' + refs.cite(v.p('greatest', { state: c.pgreatTitle(best), year: pk.year, pop: people(pk.pop), share: shareWords(pk.pop / wp) }), { kind: 'state', id: best })
      }
      t3 += v.p('rose', { n: num(live.length), m: num(live.filter((x) => x.endedYear >= 0 && x.endedYear <= Y).length), Y })
      add(v.p('hStates'), t3, [], [OrderKind.Seat])
    }
    // ---- wars ----
    const W = pd.wars
    if (W && W.count) {
      const ws: number[] = []
      for (let w = 0; w < W.count; w++) if (W.startYear[w] <= Y) ws.push(w)
      if (ws.length) {
        const civ = ws.filter((w) => W.kind[w] === WarKind.CivilWar).length
        let t4 = v.p('wars', { n: num(ws.length), Y, civil: civ === 1 ? ', one of them a civil war' : civ ? `, ${num(civ)} of them civil wars` : '' })
        const b = topBy(ws, (w) => W.dead[w], 1)[0]
        if (b !== undefined && W.dead[b] > 0) {
          const e = W.endYear[b]
          const sp = e >= 0 && e <= Y ? (e === W.startYear[b] ? `in ${e}` : `from ${W.startYear[b]} to ${e}`) : `begun in ${W.startYear[b]}`
          const wn = warName(c, b), pair = `the ${c.ptitle(W.attacker[b], W.startYear[b])} and the ${c.ptitle(W.defender[b], W.startYear[b])}`
          t4 += ' ' + v.p('bloodiest', { war: wn ? `${wn}, between ${pair}` : `the war between ${pair}`, span: sp, dead: people(W.dead[b]) })
        }
        const sacks = c.type(EventType.Sacked).map((i) => c.ev(i))
        const worst = topBy(sacks, (e) => e.value * c.pop(e.settlement, Math.max(0, e.year - h.snapshotInterval)), 1)[0]
        if (worst && !scenes.some((s) => s.kind === 'sack' && s.place === worst.settlement && s.year === worst.year)) {
          const byP = c.polityOf(worst.other, worst.year)
          if (byP >= 0) t4 += ' ' + v.p('worstSack', { place: c.place(worst.settlement, worst.year), year: worst.year, by: c.ptitle(byP, worst.year), share: shareWords(worst.value) })
        }
        add(v.p('hWar'), t4, ['sack'], [OrderKind.War, OrderKind.Peace, OrderKind.Fortify])
      }
    }
  }

  // ---- the great powers and the greatest cities over the ages ----
  if (pd && pd.count && Y >= 300) {
    const step = 100
    const runs: { p: number; from: number; to: number }[] = []
    for (let t = step; t <= Y; t += step) {
      const sn = c.snap(t)
      let best = -1, bp = 0
      for (let k = pd.aliveOffsets[sn]; k < pd.aliveOffsets[sn + 1]; k++) if (pd.alivePop[k] > bp) { bp = pd.alivePop[k]; best = pd.aliveId[k] }
      if (best < 0 || pd.aliveTier[pd.aliveOffsets[sn]] === undefined) continue
      const last = runs[runs.length - 1]
      if (last && last.p === best) last.to = t
      else runs.push({ p: best, from: t, to: t })
    }
    // (a lead held for a single century is a flicker: folded into the run before it)
    const kept: typeof runs = []
    for (const r of runs) {
      const prev = kept[kept.length - 1]
      if (prev && (r.to - r.from < step || prev.p === r.p)) { prev.to = r.to; if (prev.p !== r.p && r.to - r.from >= step) kept.push(r); continue }
      kept.push(r)
    }
    const big = kept.filter((r, i) => i === 0 || r.to - r.from >= step)
    if (big.length) {
      const out: string[] = []
      const seen = new Set<number>()
      big.slice(0, 6).forEach((r, i) => {
        const st = c.ptitle(r.p, r.from)
        let t = i === 0 ? v.p('powerFirst', { state: st, from: r.from }) : seen.has(r.p) ? v.p('powerAgain', { state: st, from: r.from }) : v.p('powerNext', { state: st, from: r.from })
        seen.add(r.p)
        const isLast = i === big.length - 1
        t += isLast && r.to >= Y - step ? v.p('powerNow') : r.to - r.from >= 2 * step ? v.p('powerHeld', { to: r.to }) : '.'
        out.push(t)
      })
      // the largest city, the same way
      const cr: { id: number; from: number }[] = []
      for (let t = step; t <= Y; t += step) {
        const sn = c.snap(t)
        let best = -1, bp = CITY_POPULATION - 1
        for (let id = 0; id < c.N; id++) { const x = h.population[sn * c.N + id]; if (x > bp) { bp = x; best = id } }
        if (best < 0) continue
        if (!cr.length || cr[cr.length - 1].id !== best) cr.push({ id: best, from: t })
      }
      const crK = cr.filter((x, i) => i === cr.length - 1 || cr[i + 1].from - x.from > step)
      if (crK.length === 1) out.push(v.p('cityRunsOne', { first: c.name(crK[0].id, Y) }).trim())
      else if (crK.length > 1) {
        const a = crK[0], b = crK[1], z = crK[crK.length - 1]
        let t = v.p('cityFirst', { city: c.place(a.id, a.from), year: a.from }) + ' ' + v.p('cityNext', { city: c.place(b.id, b.from), year: b.from })
        const distinct = new Set(crK.map((x) => x.id))
        if (crK.length > 2 && distinct.size === 2) t += v.p('cityTraded', { Y, city: c.name(z.id, Y) })
        else if (crK.length > 2) t += v.p('cityLater', { list: list([...new Set(crK.slice(2).map((x) => x.id))].filter((id) => id !== b.id).slice(0, 3).map((id) => c.place(id, Y))), Y, city: c.name(z.id, Y) })
        else t += '.'
        out.push(t)
      }
      add(v.p('hPowers'), out.join(' '))
    }
  }

  // ---- trade ----
  const t5: string[] = []
  const TR = h.trade
  if (TR && TR.count) {
    let r0 = -1
    for (let r = 0; r < TR.count; r++) if (TR.openedYear[r] <= Y && (r0 < 0 || TR.openedYear[r] < TR.openedYear[r0])) r0 = r
    if (r0 >= 0) {
      const y0 = Math.round(TR.openedYear[r0])
      let open = 0
      const q = Math.max(0, Math.min(h.tradeSnapshotCount - 1, Math.floor(Y / Math.max(1, h.tradeInterval))))
      for (let r = 0; r < TR.count; r++) if (h.tradeVolume[q * TR.count + r] > 0) open++
      t5.push(v.p('firstRoute', { year: y0, a: c.place(TR.a[r0], y0), b: c.place(TR.b[r0], y0) }) + (open > 1 ? v.p('routesNow', { n: num(open), Y }) : ''))
    }
  }
  const lane = c.type(EventType.DirectRoute).map((i) => c.ev(i))[0]
  if (lane) t5.push(v.p('firstLane', { year: lane.year, a: c.place(lane.settlement, lane.year), b: c.place(lane.other, lane.year), sought: '' }))
  if (h.mart && h.tradeSnapshotCount) {
    const TI = h.tradeInterval
    const cnt = new Map<number, number>()
    for (let q = 0; q * TI <= Y && q < h.tradeSnapshotCount; q++) for (let id = 0; id < c.N; id++) if (h.mart[q * c.N + id]) cnt.set(id, (cnt.get(id) ?? 0) + 1)
    const best = [...cnt].sort((a, b) => b[1] - a[1])[0]
    if (best && t5.length) t5[t5.length - 1] += v.p('bigMart', { mart: c.name(best[0], Y) })
  }
  const renowned = c.type(EventType.TraditionRenowned).map((i) => c.ev(i))
  if (renowned.length && h.traditions) {
    const names = [...new Set(renowned.map((e) => `${craftName(c, e.value)} (${e.year})`))].slice(0, 3)
    if (t5.length) t5[t5.length - 1] += v.p('traditions', { list: list(names) })
  }
  add(v.p('hTrade'), t5.join(' '))

  // ---- faith and plague ----
  const t6: string[] = []
  const ff = c.type(EventType.FaithFounded).map((i) => c.ev(i))
  if (ff.length && c.fd) {
    let t = v.p('faiths', { faith: c.faith(ff[0].value), place: c.place(ff[0].settlement, ff[0].year), year: ff[0].year })
    if (ff.length > 1) t += v.p('faithsMore', { list: list(ff.slice(1, 4).map((e) => `${c.faith(e.value)} at ${c.name(e.settlement, e.year)} in ${e.year}`)) })
    const F = c.fd.F
    let bf = -1, bs = 0
    for (let f = 0; f < F; f++) { const s = c.fd.worldShare[c.sY * F + f]; if (s > bs) { bs = s; bf = f } }
    if (bf >= 0) t += v.p('faithNow', { faith: c.faith(bf), share: shareWords(bs), Y })
    const hw = c.type(EventType.HolyWar).length
    if (hw >= 2) t += v.p('holyWars', { n: cap1(num(hw)) })
    t6.push(t)
  }
  const faithYear = ff.length ? ff[0].year : 1e9
  const plague: string[] = []
  const da = c.type(EventType.DiseaseAppeared).map((i) => c.ev(i))
  if (da.length) {
    const e = da[0]
    const dn = c.disease(e.value, legend)
    if (dn) plague.push(v.p('diseases', { disease: dn, place: c.place(e.settlement, e.year), year: e.year }))
  }
  const ge = (h.epidemics ?? []).filter((e) => e.great && e.startYear <= Y)
  if (ge.length) {
    const worst = [...ge].sort((a, b) => b.deaths - a.deaths)[0]
    plague.push(v.p(ge.length === 1 ? 'greatEpidemic' : 'greatEpidemics', { n: num(ge.length), year: worst.startYear, dead: people(worst.deaths) }))
  }
  add(v.p('hFaith'), (da.length && da[0].year < faithYear ? plague.concat(t6) : t6.concat(plague)).join(' '), ['plague', 'conversion'], [OrderKind.Faith, OrderKind.Quarantine])

  // ---- ideas and great works ----
  const t7: string[] = []
  const ms = h.ideas.filter((i) => MILESTONES.includes(i.key) && i.firstYear >= 0 && i.firstYear <= Y).sort((a, b) => a.firstYear - b.firstYear)
  if (ms.length) {
    const first = ms[0]
    let t = v.p('ideas', { first: first.name, people: c.peopleName(first.firstPeople), year: first.firstYear })
    // (four more, spread over the run: the latest among them)
    const pickI = ms.length <= 5 ? ms.slice(1) : [1, 2, 3, 4].map((k) => ms[Math.round((k * (ms.length - 1)) / 4)])
    const rest = [...new Set(pickI)].map((i) => `${i.name} by the ${c.peopleName(i.firstPeople)} in ${i.firstYear}`)
    if (rest.length) t += v.p('ideasThen', { list: list(rest) })
    t7.push(t)
  }
  const L = h.landmarks
  if (L && L.count) {
    const great: number[] = []
    for (let i = 0; i < L.count && L.begunYear[i] <= Y; i++) if (L.rank[i] === 0) great.push(i)
    if (great.length) {
      const pick = great.filter((i) => L.kind[i] === 1 || L.kind[i] === 2).slice(0, 2).concat(great.filter((i) => L.kind[i] !== 1 && L.kind[i] !== 2).slice(0, 1))
      t7.push(v.p('works', { n: num(great.length), Y, list: list(pick.map((i) => `${c.landmark(i, L.begunYear[i])} (${L.begunYear[i]})`)) }).trim())
    }
  }
  add(v.p('hIdeas'), t7.join(' '), ['work'], [OrderKind.Crop, OrderKind.Idea])

  // ---- now ----
  let worldPop = 0, nAlive = 0
  const alive: number[] = []
  for (let id = 0; id < c.N; id++) if (c.alive(id) && !h.settlements[id].outpost) { worldPop += c.pop(id); nAlive++; alive.push(id) }
  let t8 = v.p('nowWorld', { Y, pop: people(worldPop).replace(/^some /, 'some '), n: plural(nAlive, 'town and village', 'towns and villages') })
  const bigC = topBy(alive, (id) => c.pop(id), 3)
  if (bigC.length && c.pop(bigC[0]) >= TOWN_POPULATION) t8 += v.p('nowCities', { list: list(bigC.filter((id) => c.pop(id) >= TOWN_POPULATION).map((id) => `${c.name(id, Y)} of the ${c.peopleName(c.peopleOf(id))} (${people(c.pop(id)).replace(/^some /, '')})`)) })
  if (pd) {
    const live = pd.list.filter((x) => c.plives(x.id))
    if (live.length) {
      const b = topBy(live.map((x) => x.id), (q) => c.pstat(q, c.sY)?.pop ?? 0, 1)[0]
      if (b !== undefined) t8 += v.p('nowStates', { n: cap1(num(live.length)), state: c.ptitle(b), pop: people(c.pstat(b, c.sY)?.pop ?? 0) })
    }
  }
  const popOf = (p: number) => c.ix.ofPeople[p].reduce((a, id) => a + (c.alive(id) ? c.pop(id) : 0), 0)
  const topP = topBy(h.peoples.map((p) => p.id), popOf, 1)[0]
  if (topP !== undefined) t8 += ' ' + refs.cite(v.p('nowPeoples', { people: c.peopleName(topP) }).trim(), { kind: 'people', id: topP })
  const gone = h.peoples.filter((p) => popOf(p.id) <= 0).map((p) => `the ${p.name}`)
  if (gone.length) t8 += v.p('nowGone', { list: list(gone) })
  const rest = omens.filter((f) => !placed.has(f.k))
  if (rest.length) { book.chapter(v.p('hOmens')); for (const f of rest) book.omen(omenText(c, v, f)) }
  add(v.p('hNow', { Y }), t8)

  const facts = [`${Y} years`, plural(P, 'people'), pd ? plural(pd.list.filter((x) => x.foundedYear <= Y).length, 'state') : ''].filter(Boolean)
  const big = bigC[0]
  const greatest = big !== undefined && c.pop(big) >= CITY_POPULATION ? `; its greatest city ${c.name(big, Y)}` : ''
  return {
    kind: 'world', id: 0, year: Y, legend,
    title: v.p('title', { world: worldName }),
    epigraph: v.p('epigraph', { world: worldName, facts: list(facts) + greatest }),
    ...book.parts(),
    closing: v.p('closing', { Y }),
  }
}

/** The world's name: its largest named continent, by the year told. */
export function worldNameOf(c: Ctx): string {
  const continents = c.h.features.filter((f) => f.kind === FeatureKind.Continent && f.namedYear <= c.Y).sort((a, b) => b.size - a.size)
  return continents[0]?.name ?? `Seed ${c.seed}`
}
export const worldName = worldNameOf

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function craftName(c: Ctx, t: number): string {
  return goodsOf(c.h)?.traditionNames[t] ?? 'a craft'
}
