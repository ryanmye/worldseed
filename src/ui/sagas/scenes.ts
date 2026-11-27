// Sagas: scenes, the set pieces of a saga. A few of the most dramatic recorded events of a subject (a sack and its toll, a
// plague year in a city, a founding, a first landfall on an empty land, a ruler's conversion, a great work finished),
// each told in two or three sentences with the people and places by name: who came, from where, how many lived there and
// how many were lost, who died, what was left standing. Every clause is a recorded fact of that event or its year; the
// voice only chooses the wording. A generator offers its candidates and keeps the best few by a rough measure of drama.

import { BattleFlag, BattleKind, BattleWeather, EventType, ReignEnd, type HistoryEvent } from '../../contract.ts'
import { battlesOf } from '../battlesData.ts' // battles:
import { hoursWords, roundMen } from '../battleFormat.ts' // battles:

import { settingOf, type Ctx } from './facts.ts'
import { warName } from './wars.ts'
import { tollWords } from './partisan.ts' // partisan:
import { cap, num, people, shareWords, times, type PhraseTable, type Voice } from './voice.ts'

export interface Scene {
  kind: 'sack' | 'plague' | 'founding' | 'landfall' | 'conversion' | 'work' | 'battle' | 'siege'
  year: number
  /** Rough drama: people lost or touched, or a fixed weight for a beginning. */
  score: number
  title: string
  text: string
  /** The settlement it happened at (to keep two scenes of one place apart). */
  place: number
}

export const SCENE_T: PhraseTable = {
  sackTitle: [['The Sack of {town}, {year}'], ['The Burning of {town}']],
  sackA: [
    ['In {year} the army of {by} came out of {from} against {town}{war}.', 'In {year}{war2} the army of {by}, marching from {from}, broke into {town}.'],
    ['In {year} the host of {by} came up out of {from} against {town}{war}.', 'In the year {year}{war2} the spears of {by} came over the walls of {town}.'],
  ],
  sackB: [
    ['{pop} people lived there; when the army left, {share} of them were dead or gone.', 'Of the {pop} who lived there, {share} were lost.'],
    ['{pop} souls dwelt within its walls, and when the fires died {share} of them were gone.', 'Of the {pop} who dwelt there, {share} did not see another spring.'],
  ],
  sackRuler: [['{ruler} died when the city fell.'], ['{ruler} perished in the burning of the city.']],
  sackWork: [['{lm} was left a ruin.', '{lm} did not survive it.'], ['{lm} was thrown down.', 'They threw down {lm}.']],
  sackSieges: [['Its walls had turned back besiegers {times} before.'], ['{times} before, its walls had held.']],
  sackAgain: [['It was the {nth} time the town had been sacked.'], ['It was the {nth} time the town had burned.']],
  plagueTitle: [['{disease} at {city}, {year}'], ['The Year of {disease}']],
  plagueA: [
    ['In {year} {disease} reached {city}{from}.', '{disease} came to {city} in {year}{from}.'],
    ['In {year} {disease} came to the gates of {city}{from}.', 'In the year {year} {disease} came into {city}{from}.'],
  ],
  plagueB: [
    ['It carried off {share} of the {pop} people of the city.', 'Of the {pop} who lived there, {share} died of it.'],
    ['Of the {pop} souls of the city it took {share}.', 'It took {share} of the {pop} who dwelt there.'],
  ],
  plagueRuler: [['{ruler} was among the dead.'], ['{ruler} too was taken.']],
  plagueWorld: [['Before it burned out it had killed {dead} across the world.'], ['Before it was done it had sent {dead} to their graves across the world.']],
  plagueQuar: [['The port had held its ships in quarantine since {year}, to no avail.'], ['Since {year} the port had turned the ships away, and still it came.']],
  foundTitle: [['The Founding of {name}, {year}'], ['How {name} Was Founded']],
  foundA: [
    ['In {year} a party of {group} settlers set out from {parent}.', 'In {year} a band of {group} left {parent} to find new land.'],
    ['In the year {year} a company of {group} souls went out from {parent} to seek new fields.', 'In {year} a band of {group} wanderers left the hearths of {parent}.'],
  ],
  foundB: [
    ['They stopped {at}, and built {name}.', 'They settled {at}, and called the place {name}.'],
    ['They came to rest {at}, and there they raised {name}.', 'They built their first roofs {at}, and called the place {name}.'],
  ],
  foundEmpty: [['No one had ever lived on that land before them.'], ['Before them no fire had burned on that land.']],
  landfallTitle: [['The First Landfall, {year}'], ['The Coming to the Empty Shore']],
  landfallA: [
    ['In {year} a party of {group} settlers from {from} crossed the sea to a land where no one lived.', 'In {year} a ship out of {from} brought {group} settlers to a land no one had ever lived on.'],
    ['In {year} a company of {group} souls out of {from} crossed the whale-road to a shore no foot had trodden.', 'In the year {year} the ships of {from} came to an empty shore with {group} aboard.'],
  ],
  landfallB: [['There they founded {place}{land}.', 'They founded {place} there{land}.'], ['There they raised {place}{land}.', 'On that shore they raised {place}{land}.']],
  convTitle: [['The Conversion of {ruler}, {year}'], ['The Turning of {ruler}']],
  convA: [
    ['In {year} {ruler} of {state} put away {old} and took up {faith}.', 'In {year} {ruler}, ruler of {state}, turned from {old} to {faith}.'],
    ['In {year} {ruler} of {state} cast off {old} and bowed to {faith}.', 'In the year {year} {ruler} turned from {old} to {faith}.'],
  ],
  convSame: [['In the same year {faith} was made the faith of the realm.'], ['That same year the whole realm was given to {faith}.']],
  convLater: [['{n} years later it was the faith of the realm.'], ['{n} years after, the whole realm followed.']],
  convPers: [['In {year} the realm began to persecute those who kept other faiths.'], ['In {year} those who kept the old ways were hunted.']],
  workTitle: [['{Lm}, {year}'], ['The Raising of {lm}']],
  workA: [
    ['In {year}, after {n} years of work, {lm}{at} was finished.', '{lm}{at} was finished in {year}, {n} years after the first stone.'],
    ['In {year}, after {n} years of labour, the last stone of {lm}{at} was set.', 'For {n} years they laboured on {lm}{at}, and in {year} it stood complete.'],
  ],
  workBegun: [['{ruler} had begun it in {began}, and did not live to see it done.', 'It had been begun under {ruler} in {began}; {ruler2} did not see it finished.'], ['{ruler} had laid its first stone in {began}, but did not live to see the last.']],
  workSaw: [['{ruler}, who had begun it in {began}, lived to see it finished.'], ['{ruler}, who began it in {began}, lived to see it stand.']],
  // battles (BATTLE_T, battles.md 8.2): every clause from the battle's record (men, losses, hours, weather, flags, commanders)
  battleTitle: [['{Name}, {year}'], ['{Name}', 'The Day of {near}']],
  battleA: [
    ['In {year} the army of {att}, some {menA} strong{cmdA}, met {def}\'s {menD} near {near}{war}.', 'In {year}{war2} some {menA} of {att}{cmdA} came against perhaps {menD} of {def} near {near}.'],
    ['In the year {year}{war2} {lead} led the spears of {att} down to {near}, where the host of {def} stood waiting.', 'In {year} the host of {att}, {menA} spears{cmdA}, came to {near}, and the host of {def} was there before them.'],
  ],
  battleFord: [['They forced the crossing of the {river} under the enemy\'s missiles.'], ['The {river} ran red where they waded.']],
  battleAmbush: [['The {def} fell on them from cover before they could form.'], ['Out of the cover came the {def}, and the road became a grave.']],
  battleRain: [['Rain had soaked the field, and neither side could make its horse tell.'], ['Heaven wept on both hosts alike.']],
  battleSnow: [['They fought in falling snow.'], ['The snow fell on the living and the dead alike.']],
  battleFog: [['A fog lay on the field, and the lines found each other late.'], ['Out of the fog came the enemy, close enough to touch.']],
  battleBreak: [['{hours} the {loser} line broke; perhaps {lossL} fell or were taken, against {lossW} of the victors.'], ['{hours} the {loser} broke like ice in spring, and {lossL} did not go home.']],
  battlePyrrhic: [['It was a victory that cost {winner} nearly as much as defeat.'], ['{winner} won the field and wept over it.']],
  battleOdds: [['{winner} won outnumbered.'], ['Few against many, and the many fled.']],
  battleRuler: [['{ruler} commanded in person.'], ['{ruler} rode at the head of the host.']],
  battleFell: [['{who} fell on the field.'], ['{who} did not leave the field.']],
  battleTaken: [['{who} was taken.'], ['{who} was led away in chains.']],
  battleFall: [['{town} fell.'], ['And {town} fell.']],
  siegeTitle: [['{Name}, {years}'], ['{Name}']],
  siegeA: [
    ['In {year}{war} the army of {att} laid siege to {town}.', '{town} was besieged by {att} from {year}{war}.'],
    ['In {year}{war} the host of {att} drew its lines about {town}.', 'In the year {year} {att} came and sat down before the walls of {town}{war}.'],
  ],
  siegeAssaults: [['There were {n} assaults on the walls.'], ['{n} times they came against the walls.']],
  siegeFell: [['In {year} the walls were carried, and the town fell.'], ['In {year} the walls gave way, and the town was theirs.']],
  greatCommander: [['Its most famous commander was {name}, {feat}.'], ['Its greatest captain was {name}, {feat}.']],
  siegeHeld: [['In {year} the last assault failed; the town held.'], ['In {year} the last assault broke on the walls, and the town stood.']],
}

const ev = (c: Ctx, i: number): HistoryEvent => c.ev(i)

/** The sack of `e` (a Sacked event) as a scene. */
export function sackScene(c: Ctx, v: Voice, i: number): Scene | null {
  const e = ev(c, i)
  const before = c.pop(e.settlement, Math.max(0, e.year - 1))
  if (before < 500) return null
  const byP = c.polityOf(e.other, e.year)
  const by = byP >= 0 ? `the ${c.ptitle(byP, e.year)}` : `the raiders of ${c.name(e.other, e.year)}`
  const town = c.name(e.settlement, e.year)
  // the war it fell in: a Conquered of this town this year
  const conq = c.at(e.settlement, [EventType.Conquered]).map((k) => c.ev(k)).find((x) => x.year === e.year)
  const wn = conq ? warName(c, conq.value) : ''
  const parts: string[] = []
  // partisan: the victim's telling counts its dead large; the sacker's calls it a punishment and gives no toll
  const L = c.lens && v.has('sacked.foe') ? c.lens : null
  const victim = L ? c.polityOf(e.settlement, Math.max(0, e.year - 1)) : -1
  if (L && victim >= 0 && L.isUs(victim) && !(byP >= 0 && L.isUs(byP))) parts.push(v.p('sacked.foe', { year: e.year, foe: byP >= 0 ? c.ptitle(byP, e.year) : `raiders of ${c.name(e.other, e.year)}`, town, toll: tollWords(e.value * before * (v.legend ? 3 : 1.5), v.legend) }))
  else if (L && byP >= 0 && L.isUs(byP) && !(victim >= 0 && L.isUs(victim))) parts.push(v.p('sacked.us', { year: e.year, town }))
  else {
    parts.push(v.p('sackA', { year: e.year, by, from: c.name(e.other, e.year), town, war: wn ? `, in ${wn}` : '', war2: wn ? `, in ${wn},` : '' }))
    parts.push(cap(v.p('sackB', { pop: people(before).replace(/^some /, 'some '), share: shareWords(e.value) })))
  }
  // who died, what fell
  const rd = c.rd
  if (rd) {
    const re = c.at(e.settlement, [EventType.ReignEnded]).map((k) => c.ev(k)).find((x) => x.year === e.year && x.extra === ReignEnd.Sack)
    if (re && re.value >= 0 && re.value < rd.R) parts.push(v.p('sackRuler', { ruler: c.ruler(re.value) }))
  }
  const ruined = c.at(e.settlement, [EventType.LandmarkRuined]).map((k) => c.ev(k)).find((x) => x.year === e.year)
  if (ruined) parts.push(v.p('sackWork', { lm: cap(c.landmark(ruined.value, e.year)) }))
  const prior = c.at(e.settlement, [EventType.Sacked]).filter((k) => c.ev(k).year < e.year).length
  const sieges = c.at(e.settlement, [EventType.SiegeLifted]).filter((k) => c.ev(k).year < e.year).length
  if (parts.length < 3 && prior >= 1) parts.push(v.p('sackAgain', { nth: ['', 'second', 'third', 'fourth', 'fifth', 'sixth'][prior + 1] ?? `${prior + 1}th` }))
  else if (parts.length < 3 && sieges >= 1) parts.push(cap(v.p('sackSieges', { times: times(sieges) })))
  return { kind: 'sack', year: e.year, score: 3 * e.value * before, title: v.p('sackTitle', { town, year: e.year }), text: parts.join(' '), place: e.settlement }
}

/** A city stricken by an epidemic (a CityStricken event) as a scene. */
export function plagueScene(c: Ctx, v: Voice, i: number, legend: boolean): Scene | null {
  const e = ev(c, i)
  const h = c.h
  const ep = h.epidemics?.[e.value]
  const share = e.extra ?? 0
  if (!ep || share < 0.08) return null
  const d = h.diseases?.[ep.disease]
  if (!d?.name) return null
  const pop = c.pop(e.settlement, Math.max(0, e.year - 1))
  if (pop < 2000) return null
  const city = c.name(e.settlement, e.year)
  const dn = c.disease(ep.disease, legend) || `the ${d.name}`
  const parts = [cap(v.p('plagueA', { year: e.year, disease: dn, city, from: e.other >= 0 ? ` from ${c.name(e.other, e.year)}` : '' }))]
  parts.push(v.p('plagueB', { share: shareWords(share), pop: people(pop) }))
  const rd = c.rd
  const re = rd ? c.at(e.settlement, [EventType.ReignEnded]).map((k) => c.ev(k)).find((x) => x.extra === ReignEnd.Plague && x.year >= e.year && x.year <= e.year + 3) : undefined
  if (re && rd && re.value >= 0 && re.value < rd.R) parts.push(v.p('plagueRuler', { ruler: c.ruler(re.value) }))
  else if (ep.great && ep.endYear >= 0 && ep.endYear <= c.Y && ep.deaths >= pop) parts.push(v.p('plagueWorld', { dead: people(ep.deaths) }))
  else {
    const q = c.at(e.settlement, [EventType.Quarantine]).map((k) => c.ev(k)).find((x) => x.year <= e.year)
    if (q) parts.push(v.p('plagueQuar', { year: q.year }))
  }
  const title = v.p('plagueTitle', { disease: cap(`the ${d.name}`), city, year: e.year })
  return { kind: 'plague', year: e.year, score: 2.5 * share * pop, title, text: parts.join(' '), place: e.settlement }
}

/** The founding of town `id` (its Founded event, with a group and a parent) as a scene. */
export function foundingScene(c: Ctx, v: Voice, id: number): Scene | null {
  const s = c.h.settlements[id]
  if (!s || s.parent < 0 || s.outpost) return null
  const fe = c.at(id, [EventType.Founded])[0]
  const group = fe !== undefined ? Math.round(c.ev(fe).value) : 0
  if (group < 10) return null
  const set = settingOf(c, s.cell)
  const water = set ? (set.coast ? (set.river ? 'where a river meets the sea, ' : 'by the sea, ') : set.river ? 'on a river, ' : set.lake ? 'on a lake shore, ' : '') : ''
  const name = c.name(id, s.foundedYear)
  const parts = [v.p('foundA', { year: s.foundedYear, group: num(group), parent: c.name(s.parent, s.foundedYear) })]
  const where = set?.where ?? 'in open country'
  parts.push(v.p('foundB', { at: `${water}${where}`, name }))
  if (c.at(id, [EventType.Landfall]).length > 0) parts.push(v.p('foundEmpty'))
  return { kind: 'founding', year: s.foundedYear, score: 1500, title: v.p('foundTitle', { name, year: s.foundedYear }), text: parts.join(' '), place: id }
}

/** A Landfall event as a scene (the first of a people, or of the world). */
export function landfallScene(c: Ctx, v: Voice, i: number): Scene | null {
  const e = ev(c, i)
  const fe = c.at(e.settlement, [EventType.Founded])[0]
  const group = fe !== undefined ? Math.round(c.ev(fe).value) : 0
  if (group < 5) return null
  const land = c.h.features.find((f) => f.namedYear <= c.Y && f.namedBy === e.settlement && (f.kind === 0 || f.kind === 1))
  const parts = [v.p('landfallA', { year: e.year, group: num(group), from: c.name(e.other, e.year) })]
  parts.push(v.p('landfallB', { place: c.name(e.settlement, e.year), land: land ? `, on the land they named ${land.name}` : '' }))
  return { kind: 'landfall', year: e.year, score: 2500, title: v.p('landfallTitle', { year: e.year }), text: parts.join(' '), place: e.settlement }
}

/** A ruler's conversion (a RulerConverted event at a capital) as a scene. */
export function conversionScene(c: Ctx, v: Voice, i: number): Scene | null {
  const e = ev(c, i)
  const rd = c.rd
  if (!rd || !c.fd) return null
  const p = c.polityOf(e.settlement, e.year)
  if (p < 0) return null
  let r = -1
  for (const x of c.h.reignIds.subarray(c.h.reignOffsets[p], c.h.reignOffsets[p + 1])) { const q = rd.rulers[x]; if (q.acceded <= e.year && (q.ended < 0 || q.ended >= e.year)) r = x }
  if (r < 0) return null
  const ruler = c.ruler(r, e.year)
  const old = (e.extra ?? -1) >= 0 ? c.faith(e.extra!) : 'the old ways'
  const parts = [v.p('convA', { year: e.year, ruler, state: `the ${c.ptitle(p, e.year)}`, old, faith: c.faith(e.value) })]
  const sr = c.type(EventType.StateReligion).map((k) => c.ev(k)).find((x) => x.settlement === e.settlement && x.value === e.value && x.year >= e.year && x.year <= e.year + 60)
  if (sr) parts.push(sr.year === e.year ? v.p('convSame', { faith: c.faith(e.value) }) : cap(v.p('convLater', { n: num(sr.year - e.year) })))
  const pers = c.type(EventType.Persecution).map((k) => c.ev(k)).find((x) => x.settlement === e.settlement && x.value === e.value && x.year >= e.year && x.year <= e.year + 60)
  if (pers) parts.push(v.p('convPers', { year: pers.year }))
  const pop = c.pstat(p, c.snap(e.year))?.pop ?? 0
  return { kind: 'conversion', year: e.year, score: 800 + pop * 0.05, title: v.p('convTitle', { ruler, year: e.year }), text: parts.join(' '), place: e.settlement }
}

/** A great work finished (a LandmarkCompleted event) as a scene. */
export function workScene(c: Ctx, v: Voice, i: number): Scene | null {
  const e = ev(c, i)
  const L = c.h.landmarks
  const k = e.value
  if (!L || k < 0 || k >= L.count) return null
  const begun = L.begunYear[k], done = L.completedYear[k]
  if (done < 0 || done > c.Y || done - begun < 5) return null
  const lm = c.landmark(k, done)
  const town = c.name(L.settlement[k], done)
  const parts = [cap(v.p('workA', { year: done, n: num(done - begun), lm, at: lm.includes(town) ? '' : ` at ${town}` }))]
  const r = L.ruler[k], rd = c.rd
  if (rd && r >= 0 && r < rd.R) {
    const x = rd.rulers[r]
    const ruler = c.ruler(r, begun)
    if (x.ended >= 0 && x.ended < done) parts.push(v.p('workBegun', { ruler, ruler2: c.rulerName(r), began: begun }))
    else parts.push(v.p('workSaw', { ruler, began: begun }))
  }
  return { kind: 'work', year: done, score: 1200 + (done - begun) * 25, title: v.p('workTitle', { Lm: cap(lm), lm, year: done }), text: parts.join(' '), place: L.settlement[k] }
}

// ---- battles: a battle and a siege as scenes ----

/** Battle b as a scene (battles told at most up to the year told; small battles are no scene). */
export function battleScene(c: Ctx, v: Voice, b: number): Scene | null {
  const bd = battlesOf(c.h)
  if (!bd || b < 0 || b >= bd.B.count) return null
  const B = bd.B, C = bd.C
  if (B.year[b] > c.Y || B.kind[b] === BattleKind.Siege) return null
  const men = B.menA[b] + B.menD[b]
  if (men < 600) return null
  const year = B.year[b], fl = B.flags[b]
  const won = B.winner[b] === 0
  const pn = (p: number) => (p >= 0 ? c.pname(p) : 'its enemies')
  const att = pn(B.attacker[b]), def = pn(B.defender[b])
  const cmd = (k: number) => (k >= 0 && C.name[k] ? C.name[k] : '')
  const cA = cmd(B.cmdA[b]), cD = cmd(B.cmdD[b])
  const name = B.name[b] || 'the battle'
  const near = name.replace(/^the (\w+ )?(Battle|Ambush|Relief) (of|in|at) (the )?/, '').replace(/ (Field|Ford|Pass|Hill|Strand|Marshes)$/, '')
  const wn = warName(c, B.war[b])
  const parts = [v.p('battleA', { year, att, def, menA: roundMen(B.menA[b]), menD: roundMen(B.menD[b]), cmdA: cA ? ` under ${cA}` : '', lead: cA || `the lord of ${att}`, near, war: wn ? `, in ${wn}` : '', war2: wn ? `, in ${wn},` : '' })]
  if (fl & BattleFlag.RulerLed) { const r = C.reign[B.cmdA[b]] >= 0 ? cA : cD; if (r) parts.push(v.p('battleRuler', { ruler: r })) }
  if (fl & BattleFlag.Ford) { const river = /the (.+) Ford$/.exec(name)?.[1]; parts.push(v.p('battleFord', { river: river ?? 'river' })) }
  if (B.kind[b] === BattleKind.Ambush) parts.push(v.p('battleAmbush', { def }))
  const w = B.weather[b]
  if (w === BattleWeather.Rain) parts.push(v.p('battleRain'))
  else if (w === BattleWeather.Snow) parts.push(v.p('battleSnow'))
  else if (w === BattleWeather.Fog) parts.push(v.p('battleFog'))
  const loser = won ? def : att, winner = won ? att : def
  const lossL = won ? B.lossD[b] : B.lossA[b], lossW = won ? B.lossA[b] : B.lossD[b]
  parts.push(cap(v.p('battleBreak', { hours: cap(hoursWords(B.hours[b])), loser, lossL: roundMen(lossL), lossW: roundMen(lossW) })))
  if (fl & BattleFlag.Pyrrhic) parts.push(v.p('battlePyrrhic', { winner }))
  else if (fl & BattleFlag.Outnumbered) parts.push(v.p('battleOdds', { winner }))
  const lk = won ? B.cmdD[b] : B.cmdA[b]
  if (lk >= 0 && C.fateBattle[lk] === b && C.name[lk]) parts.push(v.p(C.fate[lk] === 1 ? 'battleFell' : 'battleTaken', { who: C.name[lk] }))
  if (won && B.kind[b] !== BattleKind.Relief) parts.push(v.p('battleFall', { town: c.name(B.target[b], year) }))
  const Name = name.charAt(0).toUpperCase() + name.slice(1)
  return { kind: 'battle', year, score: 1.2 * (B.lossA[b] + B.lossD[b]) + (fl & BattleFlag.RulerLed ? 400 : 0), title: v.p('battleTitle', { Name, year, near }), text: parts.join(' '), place: B.target[b] }
}

/** battles: the `n` greatest battles (by casualties, up to the year told) that `pick` accepts, as scenes. */
export function battleScenes(c: Ctx, v: Voice, n: number, pick: (b: number) => boolean): (Scene | null)[] {
  const bd = battlesOf(c.h)
  if (!bd) return []
  const B = bd.B
  const rows: number[] = []
  for (let b = 0; b < B.count && B.year[b] <= c.Y; b++) if (B.kind[b] !== BattleKind.Siege && B.menA[b] + B.menD[b] >= 600 && pick(b)) rows.push(b)
  return rows.sort((a, b) => B.lossA[b] + B.lossD[b] - (B.lossA[a] + B.lossD[a]) || a - b).slice(0, n).map((b) => battleScene(c, v, b))
}

/** battles: the `n` longest sieges (most assaults, up to the year told) that `pick` accepts (a group id), as scenes. */
export function siegeScenes(c: Ctx, v: Voice, n: number, pick: (g: number) => boolean): (Scene | null)[] {
  const bd = battlesOf(c.h)
  if (!bd) return []
  const gs: number[] = []
  for (let g = 0; g < bd.sieges.length; g++) if (bd.sieges[g].firstYear <= c.Y && pick(g)) gs.push(g)
  return gs.sort((a, b) => bd.sieges[b].rows.length - bd.sieges[a].rows.length || a - b).slice(0, n).map((g) => siegeScene(c, v, g))
}

/** Siege group g (battlesData sieges) as a scene. */
export function siegeScene(c: Ctx, v: Voice, g: number): Scene | null {
  const bd = battlesOf(c.h)
  const sg = bd?.sieges[g]
  if (!bd || !sg || sg.firstYear > c.Y) return null
  const rows = sg.rows.filter((b) => bd.B.year[b] <= c.Y)
  if (rows.length < 2 && !(sg.fell && sg.lastYear <= c.Y)) return null
  const B = bd.B
  const first = rows[0], last = rows[rows.length - 1]
  const town = c.name(sg.target, B.year[first])
  const wn = warName(c, sg.war)
  const att = B.attacker[first] >= 0 ? c.pname(B.attacker[first]) : 'its enemies'
  const parts = [cap(v.p('siegeA', { year: B.year[first], att, town, war: wn ? `, in ${wn}` : '' }))]
  if (rows.length > 1) parts.push(v.p('siegeAssaults', { n: cap(num(rows.length)) }))
  parts.push(v.p(B.winner[last] === 0 ? 'siegeFell' : 'siegeHeld', { year: B.year[last] }))
  let loss = 0
  for (const b of rows) loss += B.lossA[b] + B.lossD[b]
  const name = B.name[first] || `the siege of ${town}`
  const Name = name.charAt(0).toUpperCase() + name.slice(1)
  const years = B.year[last] > B.year[first] ? `${B.year[first]}–${B.year[last]}` : String(B.year[first])
  return { kind: 'siege', year: B.year[first], score: 1.2 * loss + 300 * rows.length, title: v.p('siegeTitle', { Name, years }), text: parts.join(' '), place: sg.target }
}

/** The best `n` of the candidates (by drama, no two of one kind at one place), in the order they happened. */
export function pickScenes(cands: (Scene | null)[], n: number): Scene[] {
  const xs = cands.filter((x): x is Scene => !!x).sort((a, b) => b.score - a.score)
  const out: Scene[] = []
  for (const s of xs) {
    if (out.length >= n) break
    if (out.some((o) => o.kind === s.kind && (o.place === s.place || out.filter((q) => q.kind === s.kind).length >= 2))) continue
    out.push(s)
  }
  return out.sort((a, b) => a.year - b.year)
}
