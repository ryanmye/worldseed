// Sagas: "The Legend of Rilko". A town's founding and founders, its setting and growth, the names it has borne, who
// held it and whose seat it was, its walls, sieges and sacks, its great buildings and their fates, plague and famine,
// trade and fame (routes, marts, lanes, crafts, holy city, resort, sights, ideas), the rulers seated there, and how
// it stands at the year told. Every sentence comes from the records (events up to the year, the snapshots, the
// landmark, renaming, faith and goods tables); a town where little happened gets a short notice instead.

import { CITY_POPULATION, EventType, LandmarkRank, LandmarkState, landmarksAt, OrderKind, PostKind, RenameCause, StructureType, TOWN_POPULATION } from '../../contract.ts'
import { landmarkNoun } from '../landmarksFormat.ts'
import { goodsOf } from '../goodsData.ts'
import { speciesGloss } from '../format.ts'
import { Ctx, farmingAt, settingOf, topBy } from './facts.ts'
import { cityEpithet, reignFacts, rulerEpithet, withEpithet } from './epithets.ts'
import { an, cap, list, num, people, plural, shareWords, times, Voice, type PhraseTable } from './voice.ts'
import { Book, type Saga } from './types.ts'
import { DIVINE_T, divineOrigin, OMEN_T, omenText, omensOfCity } from './omens.ts'
import { Refs } from './refs.ts'
import { foundingScene, pickScenes, plagueScene, sackScene, SCENE_T, workScene, type Scene } from './scenes.ts'

const T: PhraseTable = {
  title: [['The Legend of {name}'], ['The Legend of {name}']],
  firstHearth: [
    ['The records begin at {name}: here the {people} kept their first hearth, and every town of theirs descends from it.', '{name} is the oldest hearth of the {people}. When the counting of years began they were already there, and all their later towns were founded from it or from its daughters.'],
    ['Before the counting of years the {people} kindled their first fire at {name}, and from that fire every hearth of theirs was lit.', 'In the beginning was {name}, the mother-hearth of the {people}; all their towns are its children and its children\'s children.'],
  ],
  founded: [
    ['{name} was founded in {year} by {group} settlers from {parent}.', 'In {year} a band of {group} settlers came out of {parent} and founded {name}.', '{name} began in {year}, when {group} people from {parent} settled there.'],
    ['In the year {year} a band of {group} souls went out from {parent} and raised the first roofs of {name}.', 'It was in {year} that {group} wanderers of {parent} came to the place and called it {name}.'],
  ],
  foundedNoGroup: [
    ['{name} was founded in {year} by settlers from {parent}.', 'Settlers from {parent} founded {name} in {year}.'],
    ['In the year {year} folk of {parent} came to the place and called it {name}.'],
  ],
  landfall: [
    ['They were the first people to settle on that land, which had been empty until then.', 'No one had lived on that land before them.'],
    ['Theirs were the first feet on that empty shore.', 'Before them that land had known no hearth.'],
  ],
  outpost: [
    ['It was an expedition base, kept supplied from {parent} in land that could not feed it.'],
    ['It was a camp of far-farers, fed from {parent}, for the land there gave nothing.'],
  ],
  postFort: [['It was raised as a fort for the long-haul lane of {owner}.', 'Merchants of {owner} raised it as a fort to guard their lane.'], ['The merchants of {owner} raised it as a fort on their sea-road.']],
  postStation: [['It was a victualling station of {owner}, founded to feed the ships of its lane.'], ['It was a watering-place of the ships of {owner}.']],
  postCamp: [['It began as a mining camp of {owner}.'], ['It began as a camp of the miners of {owner}.']],
  resort: [['It was founded as a resort for visitors, most of them from {from}.'], ['It was raised for pleasure, and the folk of {from} came there to take their ease.']],
  setting: [
    ['It stood {water}{where}.', 'Its site lay {water}{where}.'],
    ['It stood {water}{where}.', 'Its hearths were set {water}{where}.'],
  ],
  fields: [
    ['Its people grew {crop}, {gloss}{herd}.', 'Around it lay fields of {crop}, {gloss}{herd}.'],
    ['Around it grew the {crop}, {gloss}{herd}.', 'Its fields bore {crop}, {gloss}{herd}.'],
  ],
  littleVillage: [
    ['Of {name} the records say little: {an} {what} that never grew.', '{name} left little mark on the records: {an} {what} that never grew large.', 'Little is written of {name}: {an} {what} that stayed small all its days.'],
    ['Of {name} the songs are few: {an} {what} that never grew.', 'Small was {name} and quiet its fate: {an} {what} that never grew.'],
  ],
  town: [
    ['By {year} it had grown into a town', 'It had become a town by {year}'],
    ['By {year} it had grown into a town of many roofs', 'In {year} it was a town of note'],
  ],
  city: [
    [', and it was a city by {year}.', ', and by {year} a city.'],
    [', and by {year} a great city.', ', and in {year} a city of tens of thousands.'],
  ],
  peak: [
    ['At its height, in {year}, {pop} people lived there.', 'It was largest in {year}, with {pop} people.', 'Its numbers peaked at {pop} in {year}.'],
    ['In {year}, at the crest of its fortune, {pop} souls dwelt within it.', 'Its glory was greatest in {year}, when {pop} souls lived there.'],
  ],
  peakNow: [
    ['It has never been larger than it is now.', 'It is larger now than it has ever been.'],
    ['Its fortune has never stood higher than now.'],
  ],
  daughters: [
    ['Its people went on to found {n}, among them {names}.', 'From it settlers went out to found {n}, {names} among them.'],
    ['It was the mother of {n}, and {names} were among its children.', 'Out of it went the founders of {n}; {names} were its daughters.'],
  ],
  daughtersAll: [['Its people went on to found {n}, {names}.', 'From it settlers went out to found {n}: {names}.'], ['It was the mother of {n}: {names}.']],
  renamed: [
    ['In {year} it was renamed {new}, {why}.', '{why2} it took the name {new} in {year}.'],
    ['In {year} its name was changed to {new}, {why}.'],
  ],
  heldFirst: [
    ['It first came under the {state} in {year}.', 'In {year} it became part of the {state}.'],
    ['In {year} it bent the knee to the {state}.', 'In {year} the banners of the {state} first flew over it.'],
  ],
  seatFirst: [
    ['In {year} it became the seat of a new state, the {state}{grew}.', 'A new state, the {state}, was founded from it in {year}{grew}.'],
    ['In {year} a new realm was raised with it as its seat: the {state}{grew}.', 'In {year} its lords made it the seat of a realm, the {state}{grew}.'],
  ],
  grew: [[', which grew into {an} {tier}', ', later {an} {tier}'], [', which waxed into {an} {tier}', ', in time {an} {tier}']],
  heldThen: [
    ['Later it passed to {list}.', 'In the years after it was held by {list}.'],
    ['Then it passed from hand to hand: to {list}.', 'Afterward {list} held it in turn.'],
  ],
  heldThenOne: [['Later it passed to {state}.', 'In time it passed to {state}.'], ['Afterward it passed to {state}.', 'In time {state} took it.']],
  heldMany: [
    ['In all it passed between {n} states.', 'All told, {n} different states held it.'],
    ['{n} realms in all claimed it as theirs.'],
  ],
  neverHeld: [['No state ever ruled it.', 'It never belonged to any state.'], ['It bowed to no crown.', 'No king ever held it.']],
  capital: [
    ['It was the capital of the {state} from {from} {to}.', 'The {state} was ruled from it from {from} {to}.'],
    ['From {from} {to} it was the seat of the {state}.', 'The rulers of the {state} sat in its halls from {from} {to}.'],
  ],
  walls: [['Its first walls went up in {year}.', 'It was first walled in {year}.'], ['In {year} it girded itself with walls.', 'Its walls were raised in {year}.']],
  taken: [
    ['It was taken in war {times}, first in {first}.', 'Armies took it {times}, the first time in {first}.'],
    ['{times} it fell to the sword, first in {first}.', 'Spears broke its gates {times}, first in {first}.'],
  ],
  takenOnce: [['It was taken in war once, in {first}.', 'It fell to an army in {first}.'], ['In {first} it fell to the sword.', 'Its gates were broken in {first}.']],
  sacked: [
    ['In {year} {by} sacked it, and {share} of its people were lost.', 'The sack of {year}, by {by}, cost it {share} of its people.'],
    ['In {year} {by} put it to the torch, and {share} of its people perished.', 'Fire came in {year}: {by} sacked it, and {share} of its folk were lost.'],
  ],
  sackedMore: [
    ['It was sacked {times} in all.', 'In all it was sacked {times}.'],
    ['{times} in all it burned.'],
  ],
  siege: [
    ['It withstood {n}, in {years}.', 'Besiegers came {times} and went away, in {years}.'],
    ['{times} it was besieged, and {times} it held, in {years}.', 'It withstood {n}, in {years}, and its gates held.'],
  ],
  revolts: [
    ['It rose in revolt {times}{first}.', 'Its people rebelled {times}{first}.'],
    ['{times} it rose against its masters{first}.'],
  ],
  landmarkBegun: [
    ['In {year} {who} began {lm}{noun}', '{who} began {lm}{noun} in {year}', 'Work on {lm}{noun} began in {year} under {who}'],
    ['In {year} {who} laid the first stones of {lm}{noun}', 'It was {who} who in {year} began {lm}{noun}'],
  ],
  landmarkBegunAnon: [['Work began on {lm}{noun} in {year}'], ['In {year} the first stones of {lm}{noun} were laid']],
  lmDone: [['; it was finished in {year}.', ', and it was finished in {year}.', '; it took {n} years to build.'], ['; in {year} it stood complete.', ', and the last stone was set in {year}.', '; {n} years it was in the building.']],
  lmBuilding: [['; it is still being built.', '; work on it goes on.', ', and it is not yet finished.'], ['; its builders labour on it still.', ', and the work goes on.']],
  lmUnfinished: [[' It was left unfinished in {year}.', ' Work stopped in {year}, and it was never finished.'], [' In {year} the work was abandoned, and it stands a stump.']],
  lmRuined: [[' It fell into ruin in {year}.', ' By {year} it was a ruin.'], [' In {year} its roof fell and it became a ruin.', ' Ruin took it in {year}.']],
  lmNeglected: [[' It has been neglected since {year}.'], [' Since {year} it has stood half-forgotten.']],
  lmRestored: [[' It was restored in {year}.'], [' In {year} it was raised up again.']],
  lmNeglectedAll: [['Since {year} all of them have stood neglected.', 'All of them have been neglected since {year}.'], ['Since {year} they have all stood half-forgotten, their courts empty.']],
  lmNeglectedSome: [['{n} of them have been neglected since {year}.'], ['Since {year} {n} of them have stood half-forgotten.']],
  lmConvertedMany: [[' It changed faiths {times}, the last time in {year}, to {faith}.'], [' {times} it was given to new gods, last in {year} to {faith}.']],
  lmConverted: [[' In {year} it was rededicated to {faith}.'], [' In {year} it was given to {faith}.']],
  lesserOne: [['It also had {n}.'], ['Beside it stood {n}.']],
  lesser: [['It also had {n}.', 'Besides these there were {n}.'], ['Beside them stood {n}.']],
  stricken: [
    ['{disease} reached it in {year} and carried off {share} of its people.', 'In {year} {disease} struck, and {share} of its people died.'],
    ['In {year} {disease} came within its walls and took {share} of its people.', '{disease} visited it in {year}, and {share} of its folk went to their graves.'],
  ],
  strickenLight: [
    ['{disease} reached it in {year}, though few died.', 'In {year} {disease} struck, but it took few lives.'],
    ['In {year} {disease} came to its gates, but took few.'],
  ],
  outbreaks: [
    ['In all, sickness struck it {times}.', 'Epidemics struck it {times} in all.'],
    ['{times} the sickness came to its doors.'],
  ],
  famine: [
    ['The worst famine came in {year}, when {share} of its people were lost.', 'Hunger struck hardest in {year}, taking {share} of its people.'],
    ['In {year} the hunger came, and {share} of its folk wasted away.'],
  ],
  famines: [[' Famine struck it {times} in all.'], [' {times} in all the granaries ran dry.']],
  routes: [
    ['Trade routes ran from it to {n}.', 'Its merchants traded along routes to {n}.'],
    ['Roads of trade bound it to {n}.'],
  ],
  mart: [
    ['It was a mart of the long-distance trade for some {years}{from}.', 'For some {years}{from} it was one of the great marts of the long-haul trade.'],
    ['For {years}{from} the goods of far lands were bought and sold in its markets.'],
  ],
  lane: [
    ['In {year} its merchants opened a direct lane to {far}{sought}.', 'A trade expedition from it opened a lane to {far} in {year}{sought}.'],
    ['In {year} its ships first found the open-sea road to {far}{sought}.'],
  ],
  tradition: [
    ['{craft} was first made here, from {year}.', 'The craft of {craft} was born here in {year}.'],
    ['Here, in {year}, the makers of {craft} first plied their art.'],
  ],
  renowned: [[' It became renowned in {year}.'], [' By {year} its fame had spread far.']],
  holy: [
    ['{faith} was founded here in {year}, and this was its holy city.', 'It was the holy city of {faith}, which was first preached here in {year}.'],
    ['Here {faith} was born in {year}, and here was its holiest place.'],
  ],
  holySeat: [['It became the seat of {faith} in {year}, when that faith split from its parent.'], ['In {year} it became the seat of {faith}, which broke from the older faith.']],
  holyFell: [[' Its holy places fell to unbelievers in {year}.'], [' In {year} unbelievers took its holy places.']],
  resortFame: [['Visitors came to it for its scenery{from}.', 'It drew visitors for its beauty{from}.'], ['Travellers came to gaze on it{from}.']],
  inFashion: [[' It came into fashion in {year}.'], [' In {year} it became the fashion.']],
  sight: [['It was counted among the sights worth the journey from {year}, for {what}.'], ['From {year} pilgrims of pleasure came to see {what}.']],
  idea: [
    ['{idea} {was} first worked out here, in {year}.', 'It was here, in {year}, that {idea} {was} first conceived.'],
    ['Here, in {year}, {idea} {was} first conceived.'],
  ],
  ideas: [['{list} were first worked out here.', 'It was the birthplace of {list}.'], ['From it came {list}, known nowhere before.']],
  smugglers: [['In {year} it became a smugglers\' hub.'], ['In {year} it became a nest of smugglers.']],
  pirates: [['In {year} pirates made it their haven.'], ['In {year} sea-wolves made it their lair.']],
  rulers: [
    ['In all {n} came to the throne here.', 'It saw {n} come to the throne.'],
    ['In all {n} took the crown within its walls.'],
  ],
  longReign: [
    ['The longest reign seated here was that of {ruler}, {years} years.', 'Of these {ruler} reigned longest, for {years} years.'],
    ['Longest of them reigned {ruler}, for {years} winters.'],
  ],
  founderFaith: [['{faith} was founded here in {year}.'], ['Here, in {year}, {faith} was first proclaimed.']],
  nowAlive: [
    ['In {Y} {name} is {an} {tier} of {pop} people{under}.', 'Now, in {Y}, {name} is {an} {tier} of {pop}{under}.'],
    ['In {Y} {name} stands still, {an} {tier} of {pop} souls{under}.', 'Still it endures in {Y}: {an} {tier} of {pop}{under}.'],
  ],
  nowRuin: [
    ['It was abandoned in {year}{left}.', 'In {year} the last of its people left{left}.'],
    ['In {year} its hearths went cold{left}.', 'In {year} the last fire was put out{left}.'],
  ],
  ruinSight: [[' Its ruins are now visited by travellers.'], [' Travellers now walk among its broken stones.']],
  closingAlive: [['Here ends the legend of {name}, which still stands.', 'So stands {name} in the year {Y}.'], ['So ends the legend of {name}; may its gates long stand.', 'Thus far the legend of {name}; its tale is not yet done.']],
  closingRuin: [['Here ends the legend of {name}.', 'So ends the story of {name}.'], ['So ends the legend of {name}, and the wind keeps its stones.', 'Thus passed {name}, and only its name remains.']],
  epiAlive: [['{name}: {facts}.'], ['{name}{ep}: {facts}.']],
  closingLittle: [['That is all the records hold of {name}.', 'No more is written of {name}.'], ['No more is sung of {name}.', 'That is all the songs say of {name}.']],
  hFounding: [['Founding'], ['How It Began']],
  hGrowth: [['Growth and Names'], ['Its Rising']],
  hMasters: [['Masters and Wars'], ['Crowns and Sieges']],
  hWorks: [['Great Works'], ['Halls and Towers']],
  hSickness: [['Plague and Hunger'], ['Pestilence and Famine']],
  hFame: [['Trade and Fame'], ['Its Renown']],
  hRulers: [['Rulers and Faiths'], ['Thrones and Gods']],
  hOmens: [['Signs and Portents'], ['Signs and Wonders']],
  hNow: [['{name} in {Y}'], ['As It Stands']],
  hRuin: [['The End of {name}'], ['The Last Fire']],
}

/** How a renaming came about, in a clause ("by its Kusubel conquerors"). */
function whyRenamed(c: Ctx, k: number): string {
  const R = c.h.renamings
  const cause = R.cause[k]
  const pol = R.polity[k] >= 0 ? c.pname(R.polity[k]) : ''
  const who = R.people[k] >= 0 ? c.peopleName(R.people[k]) : ''
  const honour = () => {
    if (R.ruler[k] >= 0 && c.rd && R.form[k] === 2) return ` and was named for ${c.rulerName(R.ruler[k])}`
    if (R.dynasty[k] >= 0 && R.form[k] === 3) return ` and was named for the house of ${c.h.dynasties[R.dynasty[k]]?.name ?? ''}`
    return ''
  }
  switch (cause) {
    case RenameCause.Conquest: return who ? `by its ${who} conquerors` : 'by its conquerors'
    case RenameCause.Cession: return pol ? `when it passed to ${pol} at a peace` : 'when it was ceded at a peace'
    case RenameCause.Capital: return pol ? `when it became the seat of ${pol}${honour()}` : `as a royal seat${honour()}`
    case RenameCause.Refounded: return pol ? `when ${pol} rebuilt it after a sack` : 'when it was rebuilt after a sack'
    case RenameCause.Faith: return R.faith[k] >= 0 ? `in the name of ${c.faith(R.faith[k])}` : 'for a faith'
    case RenameCause.Trade: return 'after the name foreign traders had long used for it'
    case RenameCause.Restored: return 'taking back a name it had borne before'
    case RenameCause.Revived: return 'after the ruined town on whose site it stood'
    case RenameCause.HouseFell: return 'when the house it had been named for fell'
    default: return 'by the decree of its masters'
  }
}

const TIER_WORD = (pop: number) => (pop >= CITY_POPULATION ? 'city' : pop >= TOWN_POPULATION ? 'town' : 'village')

export function citySaga(c: Ctx, id: number, legend: boolean): Saga {
  const h = c.h
  const s = h.settlements[id]
  const v = new Voice(c.seed, `city:${id}`, legend, T, SCENE_T, OMEN_T, DIVINE_T)
  const Y = c.Y
  const nowName = c.name(id, Y)
  const pn = c.peopleName(s.people)
  const ep = legend ? cityEpithet(c, id) : ''
  const titleName = ep ? `${nowName} ${ep}` : nowName
  const book = new Book()
  const refs = new Refs(c, book, { kind: 'city', id }, legend)
  const scenes = pickScenes([
    // (a founding is a scene only for a town that became a city, the first on an empty land, or one the omens tell of)
    c.peak(id).pop >= CITY_POPULATION || c.at(id, [EventType.Landfall]).length > 0 || (h.orderOutcomes ?? []).some((r, k) => h.orders?.[k]?.kind === OrderKind.Settle && r.product === id && r.year <= Y) ? foundingScene(c, v, id) : null,
    ...topBy(c.at(id, [EventType.Sacked]), (i) => c.ev(i).value * c.pop(id, Math.max(0, c.ev(i).year - 1)), 1).map((i) => sackScene(c, v, i)),
    ...topBy(c.at(id, [EventType.CityStricken]), (i) => (c.ev(i).extra ?? 0) + 0.001, 1).map((i) => plagueScene(c, v, i, legend)),
    ...topBy(c.at(id, [EventType.LandmarkCompleted]), (i) => { const L = h.landmarks; return L ? L.completedYear[c.ev(i).value] - L.begunYear[c.ev(i).value] : 0 }, 1).map((i) => workScene(c, v, i)),
  ], 2)
  const omens = omensOfCity(c, id)
  const placed = new Set<number>()
  const section = (head: string, text: string, sceneKinds: readonly Scene['kind'][] = [], omenKinds: readonly number[] = []) => {
    book.chapter(head ? v.p(head, { name: nowName, Y }) : null)
    book.add(text)
    for (const s of scenes) if (sceneKinds.includes(s.kind)) book.scene(s.title, s.text)
    for (const f of omens) if (omenKinds.includes(f.o.kind) && !placed.has(f.k)) { placed.add(f.k); book.omen(omenText(c, v, f)) }
  }
  const born = s.foundedYear

  // ---- founding and setting ----
  const p1: string[] = []
  const isFirst = s.parent < 0
  if (isFirst) {
    p1.push(refs.cite(v.p('firstHearth', { name: c.place(id, born), people: pn }), { kind: 'people', id: s.people }))
    // (the first hearth of a people the player placed: set down by the Divine, omens.ts)
    if (h.peoples[s.people]?.founder === id) p1.push(divineOrigin(c, v, s.people).text)
  }
  else if (!scenes.some((x) => x.kind === 'founding')) {
    const fe = c.at(id, [EventType.Founded])[0]
    const group = fe !== undefined ? Math.round(c.ev(fe).value) : 0
    const parent = c.place(s.parent, born)
    const nm = c.place(id, born)
    p1.push(group >= 10 ? v.p('founded', { name: nm, year: born, group: num(group), parent }) : v.p('foundedNoGroup', { name: nm, year: born, parent }))
    if (c.at(id, [EventType.Landfall]).length > 0) p1.push(v.p('landfall'))
  }
  if (s.outpost) p1.push(v.p('outpost', { parent: c.name(s.parent, born) }))
  const postEv = c.type(EventType.PostFounded).map((i) => c.ev(i)).find((e) => e.settlement === id && (e.extra ?? -1) !== PostKind.Factory)
  if (postEv) {
    const owner = c.name(postEv.other, postEv.year)
    const k = postEv.extra ?? 0
    p1.push(v.p(k === PostKind.Fort ? 'postFort' : k === PostKind.Station ? 'postStation' : 'postCamp', { owner }))
  }
  const resortEv = c.at(id, [EventType.ResortFounded])[0]
  if (resortEv !== undefined) p1.push(v.p('resort', { from: c.name(c.ev(resortEv).other, c.ev(resortEv).year) }))
  const set = settingOf(c, s.cell)
  if (set) {
    const water = set.coast ? (set.river ? 'where a river meets the sea, ' : 'by the sea, ') : set.river ? 'on a river, ' : set.lake ? 'on a lake shore, ' : ''
    if (!scenes.some((x) => x.kind === 'founding')) p1.push(v.p('setting', { where: set.where, water }))
  }
  const farm = farmingAt(c, s.cell, Math.min(Y, Math.max(born + 50, c.peak(id).year)))
  const sp = h.species
  if (farm.crop >= 0 && sp[farm.crop]) {
    const herd = farm.herd >= 0 && sp[farm.herd] ? `, and its herds were of ${sp[farm.herd].name}, ${speciesGloss(sp[farm.herd].archetype, sp[farm.herd].category)}` : ''
    p1.push(v.p('fields', { crop: sp[farm.crop].name, gloss: speciesGloss(sp[farm.crop].archetype, sp[farm.crop].category), herd }))
  }

  // ---- how much happened ----
  const peak = c.peak(id)
  const sacks = c.at(id, [EventType.Sacked])
  const conquests = c.at(id, [EventType.Conquered])
  const L = h.landmarks
  const greats: number[] = []
  if (L) for (const x of landmarksAt(h, id, Y)) if (x.rank === LandmarkRank.Great) greats.push(x.id)
  const renames = (() => {
    const R = h.renamings, out: number[] = []
    if (R) for (let k = 0; k < R.count && R.year[k] <= Y; k++) if (R.settlement[k] === id && R.cause[k] !== RenameCause.Distinguished) out.push(k)
    return out
  })()
  const capitalOf = (c.pd?.list ?? []).filter((p) => p.foundedYear <= Y && p.capitals.some((x, k) => x === id && p.capitalYears[k] <= Y))
  const little = peak.pop < TOWN_POPULATION && sacks.length === 0 && greats.length === 0 && renames.length === 0 && capitalOf.length === 0 && conquests.length <= 1

  if (little) {
    const what = farm.crop >= 0 && sp[farm.crop] ? `village of ${sp[farm.crop].name} growers` : set?.coast ? 'village by the sea' : 'village'
    const out = [v.p('littleVillage', { name: nowName, an: an(what).split(' ')[0], what }), ...p1]
    out.push(presentLine(c, v, id, nowName))
    book.add(out.join(' '))
    for (const f of omens) book.omen(omenText(c, v, f))
    return {
      kind: 'city', id, year: Y, legend,
      title: v.p('title', { name: titleName }),
      epigraph: epigraph(c, v, id, nowName, ep, peak.pop),
      ...book.parts(),
      closing: v.p(c.alive(id) ? 'closingLittle' : 'closingRuin', { name: nowName, Y }),
    }
  }
  const fs = scenes.find((x) => x.kind === 'founding')
  if (fs) { book.chapter(v.p('hFounding')); book.scene(fs.title, fs.text) }
  section(fs ? '' : 'hFounding', p1.join(' '), [], [OrderKind.Settle])

  // ---- growth, daughters, names ----
  const p2: string[] = []
  const tEv = c.at(id, [EventType.BecameTown])[0], cEv = c.at(id, [EventType.BecameCity])[0]
  if (tEv !== undefined) p2.push(v.p('town', { year: c.ev(tEv).year }) + (cEv !== undefined ? v.p('city', { year: c.ev(cEv).year }) : '.'))
  if (peak.pop >= 500) {
    const nowPop = c.alive(id) ? c.pop(id) : 0
    if (c.alive(id) && peak.year >= Y - h.snapshotInterval && nowPop >= peak.pop * 0.98) p2.push(v.p('peakNow'))
    else p2.push(v.p('peak', { year: peak.year, pop: people(peak.pop) }))
  }
  const daughters = h.settlements.filter((x) => x.parent === id && x.foundedYear <= Y && !x.outpost)
  if (daughters.length >= 2) {
    const best = topBy(daughters.map((x) => x.id), (d) => c.peak(d).pop, 2)
    p2.push(v.p(daughters.length === best.length ? 'daughtersAll' : 'daughters', { n: plural(daughters.length, 'settlement'), names: list(best.map((d) => c.name(d, Y))) }))
  }
  for (const k of renames.slice(0, 4)) {
    const R = h.renamings
    const why = whyRenamed(c, k)
    p2.push(v.p('renamed', { year: R.year[k], new: R.name[k], why, why2: cap(why) + ',' }).replace(/, ,/g, ','))
  }
  section('hGrowth', p2.join(' '))

  // ---- who held it, whose seat it was, war ----
  const p3: string[] = []
  const p3y: number[] = []
  const push3 = (t: string, y: number) => { p3.push(t); p3y.push(y) }
  if (c.pd) {
    const runs: { p: number; from: number }[] = []
    const I = h.snapshotInterval
    for (let q = c.snap(born); q <= c.sY; q++) {
      const p = h.polity[q * c.N + id]
      if (p < 0 || h.population[q * c.N + id] <= 0) continue
      if (runs.length === 0 || runs[runs.length - 1].p !== p) runs.push({ p, from: q * I })
    }
    const seated = new Set<number>()
    if (runs.length === 0) push3(v.p('neverHeld'), 0)
    else {
      const p0 = c.pd.list[runs[0].p]
      if (p0.capitals[0] === id) {
        seated.add(p0.id)
        const t0 = c.ptitle(p0.id, p0.foundedYear), tg = c.pgreatTitle(p0.id)
        const tier = tg.split(' of ')[0].toLowerCase()
        const grew = tg !== t0 ? v.p('grew', { an: an(tier).split(' ')[0], tier }) : ''
        push3(refs.cite(v.p('seatFirst', { state: t0, year: p0.foundedYear, grew }), { kind: 'state', id: p0.id }), p0.foundedYear)
      } else push3(v.p('heldFirst', { state: c.ptitle(runs[0].p, runs[0].from), year: runs[0].from }), runs[0].from)
      const later: string[] = []
      for (const r of runs.slice(1)) {
        const n = c.pname(r.p)
        if (!later.includes(n) && n !== c.pname(runs[0].p)) later.push(n)
      }
      if (later.length === 1) push3(v.p('heldThenOne', { state: later[0] }), runs[1].from)
      else if (later.length > 1 && later.length <= 4) push3(v.p('heldThen', { list: list(later) }), runs[1].from)
      else if (later.length > 4) push3(v.p('heldMany', { n: num(later.length + 1) }), runs[1].from)
    }
    for (const p of capitalOf.filter((x) => !seated.has(x.id)).slice(0, 3)) {
      const k = p.capitals.indexOf(id)
      const from = p.capitalYears[k]
      const toY = k + 1 < p.capitals.length ? p.capitalYears[k + 1] : p.endedYear
      const to = toY >= 0 && toY <= Y ? `to ${toY}` : 'onward'
      push3(refs.cite(v.p('capital', { state: c.pgreatTitle(p.id), from, to }), { kind: 'state', id: p.id }), from)
    }
  }
  const walls = c.at(id, [EventType.Built]).map((i) => c.ev(i)).find((e) => h.structures[e.other]?.type === StructureType.Walls)
  if (walls) push3(v.p('walls', { year: walls.year }), walls.year)
  const sackYears = new Set(sacks.map((i) => c.ev(i).year))
  if (conquests.length === 1 && sackYears.has(c.ev(conquests[0]).year)) { /* (the sack says it) */ }
  else if (conquests.length === 1) push3(v.p('takenOnce', { first: c.ev(conquests[0]).year }), c.ev(conquests[0]).year)
  else if (conquests.length > 1) push3(v.p('taken', { times: times(conquests.length), first: c.ev(conquests[0]).year }), c.ev(conquests[0]).year)
  if (sacks.length > 0) {
    const worst = sacks.map((i) => c.ev(i)).sort((a, b) => b.value - a.value)[0]
    const byP = c.polityOf(worst.other, worst.year)
    const by = byP >= 0 ? `the army of ${c.pname(byP)}` : `raiders from ${c.name(worst.other, worst.year)}`
    push3(v.p('sacked', { year: worst.year, by, share: shareWords(worst.value) }), worst.year)
    if (sacks.length > 1) push3(v.p('sackedMore', { times: times(sacks.length) }), worst.year)
  }
  const sieges = c.at(id, [EventType.SiegeLifted]).map((i) => c.ev(i).year)
  if (sieges.length > 0 && sieges.length <= 3) push3(v.p('siege', { n: sieges.length === 1 ? 'one siege' : `${num(sieges.length)} sieges`, times: times(sieges.length), years: list(sieges.map(String)) }), sieges[0])
  else if (sieges.length > 3) push3(v.p('siege', { times: times(sieges.length), n: `${num(sieges.length)} sieges`, years: `the years between ${sieges[0]} and ${sieges[sieges.length - 1]}` }), sieges[0])
  const revolts = c.at(id, [EventType.Revolt])
  if (revolts.length > 0) push3(v.p('revolts', { times: times(revolts.length), first: revolts.length > 1 ? `, first in ${c.ev(revolts[0]).year}` : `, in ${c.ev(revolts[0]).year}` }), c.ev(revolts[0]).year)
  section('hMasters', p3.map((t, i) => [t, p3y[i], i] as const).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0]).join(' '), ['sack'], [OrderKind.War, OrderKind.Peace, OrderKind.Seat, OrderKind.Fortify])

  // ---- great buildings ----
  if (L && greats.length > 0) {
    const p4: string[] = []
    const neglected: number[] = []
    let prevRuler = -1
    for (const i of greats.slice(0, 4)) {
      const lm = c.landmark(i, Y)
      const nounW = landmarkNoun(L.kind[i], L.form[i])
      const noun = lm.toLowerCase().includes(nounW.split(' ').pop()!) ? '' : `, ${an(nounW)},`
      const r = L.ruler[i]
      let s4 = ''
      if (r >= 0 && c.rd) {
        const who = r === prevRuler ? `the same ${c.rulerName(r)}` : legend ? withEpithet(c.ruler(r), rulerEpithet(reignFacts(c, r))) : `${c.ruler(r)}${L.polity[i] >= 0 ? ` of ${c.pname(L.polity[i])}` : ''}`
        prevRuler = r
        s4 = v.p('landmarkBegun', { year: L.begunYear[i], who, lm, noun })
      } else s4 = v.p('landmarkBegunAnon', { year: L.begunYear[i], lm, noun })
      const done = L.completedYear[i]
      if (done >= 0 && done <= Y) s4 += v.p('lmDone', { year: done, n: num(done - L.begunYear[i]) })
      else s4 += '.'
      s4 = s4.replace(/,( in| began|,|;|\.)/g, (m, a: string) => (a === ',' || a === ';' || a === '.' ? a : m)).replace(/,\./g, '.')
      // its fate: the change rows up to the year told
      const conv: number[] = []
      for (let k = 0; k < L.changeCount && L.changeYear[k] <= Y; k++) {
        if (L.changeLandmark[k] !== i) continue
        const st = L.changeState[k], y = L.changeYear[k]
        if (st === LandmarkState.Ruined) s4 += v.p('lmRuined', { year: y })
        else if (st === LandmarkState.Unfinished) s4 += v.p('lmUnfinished', { year: y })
        else if (st === LandmarkState.Restored) s4 += v.p('lmRestored', { year: y })
        else if (st === LandmarkState.Converted && L.changeFaith[k] >= 0) conv.push(k)
        else if (st === LandmarkState.Neglected && k === lastChange(c, i)) neglected.push(y)
      }
      if (conv.length === 1 || conv.length === 2) for (const k of conv) s4 += v.p('lmConverted', { year: L.changeYear[k], faith: c.faith(L.changeFaith[k]) })
      else if (conv.length > 2) { const k = conv[conv.length - 1]; s4 += v.p('lmConvertedMany', { times: times(conv.length), year: L.changeYear[k], faith: c.faith(L.changeFaith[k]) }) }
      if (!(done >= 0 && done <= Y) && lastState(c, i) === LandmarkState.Building) s4 = s4.replace(/\.$/, '') + v.p('lmBuilding')
      p4.push(s4)
    }
    if (neglected.length === 1) p4[p4.length - 1] += v.p('lmNeglected', { year: neglected[0] })
    else if (neglected.length > 1) p4.push(v.p(neglected.length === Math.min(4, greats.length) ? 'lmNeglectedAll' : 'lmNeglectedSome', { n: num(neglected.length), year: Math.min(...neglected) }))
    let lesser = 0
    for (const x of landmarksAt(h, id, Y)) if (x.rank !== LandmarkRank.Great) lesser++
    if (lesser > 0) p4.push(v.p(greats.length === 1 ? 'lesserOne' : 'lesser', { n: lesser === 1 ? 'one lesser temple or shrine' : `${num(lesser)} lesser temples and shrines` }))
    section('hWorks', p4.join(' '), ['work'])
  }

  // ---- sickness and hunger ----
  const p5: string[] = []
  const stricken = c.at(id, [EventType.CityStricken]).map((i) => c.ev(i))
  if (stricken.length > 0) {
    const worst = [...stricken].sort((a, b) => (b.extra ?? 0) - (a.extra ?? 0))[0]
    const ep2 = h.epidemics[worst.value]
    const dn = ep2 ? h.diseases[ep2.disease]?.name : ''
    const disease = (dn ? c.disease(ep2.disease, legend) : '') || 'an epidemic'
    const sh = worst.extra ?? 0
    p5.push(cap(v.p(sh >= 0.03 ? 'stricken' : 'strickenLight', { disease, year: worst.year, share: shareWords(sh) })))
  }
  const O = h.outbreaks
  if (O) {
    let n = 0
    for (let k = 0; k < O.count && O.year[k] <= Y; k++) if (O.settlement[k] === id) n++
    if (n >= 2) p5.push(cap(v.p('outbreaks', { times: times(n) })))
  }
  const famines = c.at(id, [EventType.Famine]).map((i) => c.ev(i))
  if (famines.length > 0) {
    const worst = [...famines].sort((a, b) => b.value - a.value)[0]
    if (worst.value >= 0.05) p5.push(v.p('famine', { year: worst.year, share: shareWords(worst.value) }) + (famines.length > 1 ? cap(v.p('famines', { times: times(famines.length) }).trim()).replace(/^/, ' ') : ''))
  }
  section('hSickness', p5.join(' '), ['plague'], [OrderKind.Quarantine])

  // ---- trade and fame ----
  const p6: string[] = []
  const TR = h.trade
  if (TR) {
    const partners = new Set<number>()
    for (let r = 0; r < TR.count; r++) if (TR.openedYear[r] <= Y && (TR.a[r] === id || TR.b[r] === id)) partners.add(TR.a[r] === id ? TR.b[r] : TR.a[r])
    if (partners.size >= 3) p6.push(v.p('routes', { n: plural(partners.size, 'other town') }))
  }
  const gd = goodsOf(h)
  if (h.mart && h.tradeSnapshotCount > 0) {
    const TI = h.tradeInterval, N = c.N
    let first = -1, count = 0
    for (let q = 0; q * TI <= Y && q < h.tradeSnapshotCount; q++) if (h.mart[q * N + id]) { if (first < 0) first = q * TI; count++ }
    const yrs = count * TI
    if (count >= 4) p6.push(v.p('mart', { years: yrs >= 200 ? `${num(Math.round(yrs / 100))} centuries` : `${num(Math.round(yrs / 10) * 10)} years`, from: ` from ${first}` }))
  }
  const lanes = c.at(id, [EventType.DirectRoute]).map((i) => c.ev(i))
  if (lanes.length > 0) {
    const e = lanes[0]
    const sought = gd && e.extra !== undefined && e.extra > 0 && gd.varietyNames[e.extra] ? `, seeking ${gd.varietyNames[e.extra]}` : ''
    p6.push(v.p('lane', { year: e.year, far: c.place(e.other, e.year), sought }))
  }
  for (const i of c.at(id, [EventType.TraditionBorn]).slice(0, 2)) {
    const e = c.ev(i)
    const name = gd?.traditionNames[e.value]
    if (!name) continue
    let s6 = v.p('tradition', { craft: name, year: e.year })
    const ren = c.type(EventType.TraditionRenowned).map((k) => c.ev(k)).find((x) => x.value === e.value)
    if (ren) s6 += v.p('renowned', { year: ren.year })
    p6.push(s6)
  }
  for (const f of c.fd?.faiths ?? []) {
    if (f.holyCity !== id || f.foundedYear > Y || f.kind !== 1) continue
    let s6 = f.parent >= 0 ? v.p('holySeat', { faith: c.faith(f.id), year: f.foundedYear }) : v.p('holy', { faith: c.faith(f.id), year: f.foundedYear })
    const fell = c.at(id, [EventType.HolyCityFell]).map((k) => c.ev(k)).find((e) => e.value === f.id)
    if (fell) s6 += v.p('holyFell', { year: fell.year })
    p6.push(cap(s6))
  }
  if (s.resort || c.at(id, [EventType.ResortInFashion]).length > 0) {
    const fe = c.at(id, [EventType.ResortInFashion])[0]
    if (resortEv === undefined) p6.push(v.p('resortFame', { from: fe !== undefined ? `, most from ${c.name(c.ev(fe).other, c.ev(fe).year)}` : '' }))
    if (fe !== undefined) p6.push(v.p('inFashion', { year: c.ev(fe).year }).trim())
  }
  const sights = c.at(id, [EventType.SightRecognised]).map((i) => c.ev(i)).filter((e) => e.other === -1 || e.other === id)
  if (sights.length > 0) {
    const e = sights[0]
    const sg = h.sights[e.value]
    const what = sg ? sightWhat(c, sg.kind, sg.landmark, e.year) : ''
    if (what) p6.push(v.p('sight', { year: e.year, what }))
  }
  const ideas = c.at(id, [EventType.IdeaConceived]).map((i) => c.ev(i)).filter((e) => (e.extra ?? 0) === 0)
  if (ideas.length === 1) {
    const idea = h.ideas[ideas[0].value]
    if (idea) p6.push(cap(v.p('idea', { idea: idea.name, was: /s$/.test(idea.name) && !/ss$/.test(idea.name) ? 'were' : 'was', year: ideas[0].year })))
  } else if (ideas.length > 1) p6.push(cap(v.p('ideas', { list: list(ideas.slice(0, 4).map((e) => h.ideas[e.value]?.name ?? 'an idea')) })))
  const smug = c.at(id, [EventType.SmugglingRing])[0]
  if (smug !== undefined) p6.push(v.p('smugglers', { year: c.ev(smug).year }))
  const pir = c.at(id, [EventType.PiratesRise])[0]
  if (pir !== undefined) p6.push(v.p('pirates', { year: c.ev(pir).year }))
  section('hFame', p6.join(' '), [], [OrderKind.Explore, OrderKind.Crop, OrderKind.Idea])

  // ---- the rulers seated there, faiths founded ----
  const p7: string[] = []
  if (c.rd) {
    const reigns = [...new Set(c.at(id, [EventType.RulerAcceded]).map((i) => c.ev(i).value))].filter((r) => r >= 0 && r < c.rd!.R)
    if (reigns.length >= 2) {
      p7.push(v.p('rulers', { n: plural(reigns.length, 'ruler') }))
      const best = topBy(reigns, (r) => c.reignYears(r), 1)[0]
      if (best !== undefined && c.reignYears(best) >= 15) {
        const who = legend ? withEpithet(c.ruler(best), rulerEpithet(reignFacts(c, best))) : `${c.ruler(best)} of ${c.pname(c.rd.rulers[best].polity)}`
        p7.push(v.p('longReign', { ruler: who, years: c.reignYears(best) }))
      }
    }
  }
  for (const i of c.at(id, [EventType.FaithFounded])) {
    const e = c.ev(i)
    if (c.fd?.faiths[e.value]?.holyCity === id) continue // (said with the holy city)
    p7.push(cap(v.p('founderFaith', { faith: c.faith(e.value), year: e.year })))
  }
  section('hRulers', p7.join(' '), [], [OrderKind.Faith])

  const rest = omens.filter((f) => !placed.has(f.k))
  if (rest.length) { book.chapter(v.p('hOmens')); for (const f of rest) book.omen(omenText(c, v, f)) }
  section(c.alive(id) ? 'hNow' : 'hRuin', presentLine(c, v, id, nowName))
  return {
    kind: 'city', id, year: Y, legend,
    title: v.p('title', { name: titleName }),
    epigraph: epigraph(c, v, id, nowName, ep, peak.pop),
    ...book.parts(),
    closing: v.p(c.alive(id) ? 'closingAlive' : 'closingRuin', { name: nowName, Y }),
  }
}

function lastChange(c: Ctx, i: number): number {
  const L = c.h.landmarks
  let k0 = -1
  for (let k = 0; k < L.changeCount && L.changeYear[k] <= c.Y; k++) if (L.changeLandmark[k] === i) k0 = k
  return k0
}
function lastState(c: Ctx, i: number): number {
  const k = lastChange(c, i)
  return k < 0 ? LandmarkState.Building : c.h.landmarks.changeState[k]
}

const SIGHT_WHAT = ['the ruins of a great town', 'its old palaces and walls as a former capital', 'a famous summit', 'an old polar base', 'a mining town gone quiet', 'a resort long out of fashion', 'its holy places', '']
function sightWhat(c: Ctx, kind: number, lm: number | undefined, y: number): string {
  if (kind === 7 && lm !== undefined && lm >= 0) return c.landmark(lm, y)
  return SIGHT_WHAT[kind] ?? ''
}

function presentLine(c: Ctx, v: Voice, id: number, name: string): string {
  const s = c.h.settlements[id]
  if (c.alive(id)) {
    const pop = c.pop(id)
    const p = c.polityOf(id, c.Y)
    const capOf = p >= 0 && c.capital(p, c.Y) === id
    const under = p >= 0 ? (capOf ? `, the capital of the ${c.ptitle(p)}` : `, under the ${c.ptitle(p)}`) : ''
    const tier = TIER_WORD(pop)
    return v.p('nowAlive', { Y: c.Y, name, an: an(tier).split(' ')[0], tier, pop: people(pop).replace(/^some /, ''), under })
  }
  const ab = c.at(s.id, [EventType.Abandoned])[0]
  const left = ab !== undefined && c.ev(ab).value >= 1 ? `, when only ${num(Math.round(c.ev(ab).value))} remained` : ''
  let t = v.p('nowRuin', { year: s.abandonedYear, left })
  const ruin = c.h.sights?.some((x) => x.kind === 0 && x.settlement === id && x.fromYear <= c.Y)
  if (ruin) t += v.p('ruinSight')
  return t
}

function epigraph(c: Ctx, v: Voice, id: number, name: string, ep: string, peakPop: number): string {
  const s = c.h.settlements[id]
  const facts: string[] = []
  facts.push(s.parent < 0 ? `first hearth of the ${c.peopleName(s.people)}` : `a town of the ${c.peopleName(s.people)}, founded ${s.foundedYear}`)
  const sacks = c.at(id, [EventType.Sacked]).length
  if (sacks > 0) facts.push(`sacked ${times(sacks)}`)
  if (peakPop >= CITY_POPULATION) facts.push(c.alive(id) && c.pop(id) >= peakPop * 0.8 ? `home to ${people(c.pop(id)).replace(/^some /, '')}` : `once home to ${people(peakPop).replace(/^some /, '')}`)
  facts.push(c.alive(id) ? 'still standing' : `abandoned ${s.abandonedYear}`)
  return v.p('epiAlive', { name, ep: ep ? ` ${ep}` : '', facts: list(facts) })
}
