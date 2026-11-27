// seat: words for the decision cards (decisionCard.ts) and for the seat in the Chronicle and Legend (seat-mode §6.3-6.4).
// DOM-free: reads a History only, so the phrase tables are tested in Node (seatFormat.test.ts).
import { DecisionKind, OrderKind, SeatEnd, SeatKind, SeatOptionKey, describeDecisionKinds, describeOrderKinds } from '../../contract.ts'
import { spokenNameAt } from '../../sim/names/spoken.ts' // language: the name as said in the year
import type { History } from '../../contract.ts'
import { DramaCat, registerDrama } from '../story/drama.ts'

// The story director's rules for the seat events (ui/story/drama.ts; base weights a design default [A]). The court kinds'
// events (274-279) come with seat steps 8, 9 and 13 and keep the provisional rule until then.
registerDrama(270, { cat: DramaCat.Nudge, base: 7 }) // SeatTaken
registerDrama(271, { cat: DramaCat.Nudge, base: 5 }) // SeatPassed
registerDrama(272, { cat: DramaCat.Nudge, base: 7 }) // SeatLost
registerDrama(273, { cat: DramaCat.Nudge, base: 7 }) // AmbitionFulfilled
for (let t = 274; t <= 279; t++) registerDrama(t, { cat: DramaCat.Nudge, base: 3 })


const DK = describeDecisionKinds()
const OK = describeOrderKinds()

/** The button word of each option key. */
export const OPTION_LABEL: Record<number, string> = {
  [SeatOptionKey.FightOn]: 'Fight on', [SeatOptionKey.SuePeace]: 'Sue for peace', [SeatOptionKey.OfferTribute]: 'Offer tribute', [SeatOptionKey.SeekAlly]: 'Seek an ally',
  [SeatOptionKey.Strike]: 'Strike', [SeatOptionKey.StayOut]: 'Stay out', [SeatOptionKey.OfferMatch]: 'Offer a match', [SeatOptionKey.NameHeir]: 'Name an heir',
  [SeatOptionKey.LawDecides]: 'Let the law decide', [SeatOptionKey.Placate]: 'Placate them', [SeatOptionKey.CrushPretender]: 'Crush the pretender',
  [SeatOptionKey.Endure]: 'Endure', [SeatOptionKey.Honour]: 'Honour it', [SeatOptionKey.Renounce]: 'Renounce it', [SeatOptionKey.Pay]: 'Pay',
  [SeatOptionKey.Defy]: 'Defy', [SeatOptionKey.Arrange]: 'Arrange the match', [SeatOptionKey.Decline]: 'Decline', [SeatOptionKey.Purge]: 'Purge him',
  [SeatOptionKey.Ignore]: 'Ignore it', [SeatOptionKey.Quarantine]: 'Quarantine the ports', [SeatOptionKey.MoveCourt]: 'Move the court',
  [SeatOptionKey.Embrace]: 'Embrace it', [SeatOptionKey.KeepWays]: 'Keep the old ways', [SeatOptionKey.Fortify]: 'Fortify the capital',
  [SeatOptionKey.Crush]: 'Crush it', [SeatOptionKey.Borrow]: 'Borrow', [SeatOptionKey.Levy]: 'Raise taxes', [SeatOptionKey.Retrench]: 'Retrench',
  [SeatOptionKey.Grant]: 'Grant it', [SeatOptionKey.Refuse]: 'Refuse', [SeatOptionKey.SeparatePeace]: 'Make a separate peace', [SeatOptionKey.StandBy]: 'Stand by them',
  [SeatOptionKey.Settle]: 'Send settlers', [SeatOptionKey.ExploreOn]: 'Explore further', [SeatOptionKey.Stay]: 'Stay at home',
  [SeatOptionKey.TakeUp]: 'Take it up', [SeatOptionKey.Seek]: 'Seek it out', [SeatOptionKey.RepudiateDebts]: 'Refuse the debts',
}

/** The court's own course (an option without orders): what the card says will happen. */
const COURT_EXPECTS = 'The court keeps its own counsel; events take their course.'

/** (politiesData.ts's qualifiers: a successor that kept its parent's name is "West Temukuntin") */
const QUALIFIERS: readonly string[] = ['', 'North', 'South', 'East', 'West', 'New', 'Upper', 'Lower', 'Restored']
/** A polity's distinct name: its proper name with the qualifier a successor bears ("West Temukuntin"). */
export function polityWord(h: History, q: number): string {
  const P = h.polities?.[q]
  if (!P) return 'a neighbour'
  const x = QUALIFIERS[P.qualifier] ?? ''
  return x ? `${x} ${P.name}` : P.name
}
/** A polity named on a card of the seat polity `us`: never reads as the player's own realm (a same-named rival is "the rival X"). */
export function otherWord(h: History, q: number, us: number): string {
  const w = polityWord(h, q)
  return q !== us && us >= 0 && w === polityWord(h, us) ? `the rival ${w}` : w
}
export function townWord(h: History, id: number, year: number): string {
  return id >= 0 && id < h.settlements.length ? spokenNameAt(h, id, year) : 'a town'
}

/** The name of a decision's subject (per kind). */
export function subjectWord(h: History, kind: number, subject: number, year: number, us = -1): string {
  switch (kind) {
    case DecisionKind.WarOnUs: case DecisionKind.Opening: case DecisionKind.AllianceMade: case DecisionKind.AllianceSought:
    case DecisionKind.Overlord: case DecisionKind.Match: case DecisionKind.Betrayal: return otherWord(h, subject, us)
    case DecisionKind.Heir: case DecisionKind.General: return rulerWord(h, subject)
    case DecisionKind.Crisis: case DecisionKind.Credit: return ''
    case DecisionKind.Plague: { const e = h.epidemics?.[subject]; const d = e ? h.diseases?.[e.disease] : undefined; return d ? `the ${d.name}` : 'a pestilence' }
    case DecisionKind.Faith: return h.faiths?.[subject]?.name ?? 'a faith'
    case DecisionKind.Revolt: return townWord(h, subject, year)
    case DecisionKind.Crop: return h.species?.[subject]?.name ?? 'a crop'
    case DecisionKind.Idea: return h.ideas?.[subject]?.name ?? 'an idea'
    case DecisionKind.Frontier: return 'the new lands'
  }
  return ''
}

/** Card title: "War is declared on us: Vosk". */
export function decisionTitle(h: History, d: number): string {
  const D = h.seat!.decisions
  const s = subjectWord(h, D.kind[d], D.subject[d], D.year[d], D.polity[d])
  const label = DK[D.kind[d]]?.label ?? 'A decision'
  return s ? `${label}: ${s}` : label
}

/** Two short lines of situation, from what the seat's people knows. */
export function decisionSituation(h: History, d: number): string {
  const D = h.seat!.decisions
  const y = D.year[d], k = D.kind[d], subj = D.subject[d], at = townWord(h, D.place[d], y)
  const us = D.polity[d] >= 0 ? polityWord(h, D.polity[d]) : 'our people'
  const name = subjectWord(h, k, subj, y, D.polity[d])
  switch (k) {
    case DecisionKind.Heir: return `${capFirst(name)} grows old, or the succession is uncertain. The lords ask whom the crown will name.`
    case DecisionKind.Crisis: return `The succession of ${us} is disputed: magnates take sides and the provinces wait to see who wins.`
    case DecisionKind.General: return `The army is restless after the wars, and its general is spoken of as a better ruler than ${name}.`
    case DecisionKind.Match: return `The house ruling ${name} has a child to marry, and so has ours. A match would bind the two courts.`
    case DecisionKind.AllianceMade: return `${capFirst(name)} and ${us} are now allies against a common rival. The treaty binds us both.`
    case DecisionKind.AllianceSought: return `A rival at least our size threatens ${us}, and ${name} too. They might stand with us.`
    case DecisionKind.Overlord: return `${us} pays ${name} as its overlord. The tribute is heavy; the overlord is far.`
    case DecisionKind.Credit: return `The treasury of ${us} is short: debts are heavy, or pay falls behind, or a war must be paid for.`
    case DecisionKind.Betrayal: return `${us} fights beside ${name} in its war, and our levies are worn out. The enemy would take our own peace.`
    case DecisionKind.WarOnUs: return `In ${y} ${name} declared war on ${us}. Its armies gather at the border.`
    case DecisionKind.Opening: return `${name} is in turmoil: its court is divided and its levies uncertain. Our forces at the border are the stronger.`
    case DecisionKind.Plague: return `${capFirst(name)} has reached ${at}. The sick fill the streets; the ships still come in.`
    case DecisionKind.Faith: return `Many in ${us} now follow ${name}, but the ruler keeps the old faith.`
    case DecisionKind.Revolt: return `${name} has risen against the crown. The garrison holds for now.`
    case DecisionKind.Frontier: return `Explorers came home to ${at} with tales of lands no one of ours has seen.`
    case DecisionKind.Crop: return `Traders tell of ${name}, grown by the people of ${at}. Our fields have never known it.`
    case DecisionKind.Idea: return `At ${at} they have ${name}. Our scholars know of it only by report.`
  }
  return `In ${y}, a matter for the court.`
}

/** "The court expects…": the effect of the option's first order, or the court's own course. */
export function optionExpects(h: History, d: number, option: number): string {
  const D = h.seat!.decisions
  const o = D.optStart[d] + option
  if (D.orderStart[o] === D.orderStart[o + 1]) return COURT_EXPECTS
  const kind = D.orderKind[D.orderStart[o]]
  const n = D.orderStart[o + 1] - D.orderStart[o]
  const info = OK[kind]
  return (info?.effect ?? '') + (n > 1 && kind === OrderKind.Quarantine ? ` (${n} ports)` : '')
}

/** The button word of option `option` of decision d. */
export function optionLabel(h: History, d: number, option: number): string {
  const D = h.seat!.decisions
  const o = D.optStart[d] + option
  if (D.optKey[o] === SeatOptionKey.NameHeir && D.orderStart[o + 1] > D.orderStart[o]) {
    const born = D.orderTarget[D.orderStart[o]]
    return `Name the heir born in ${born} (aged ${D.year[d] - born})${option === 0 ? ', the law’s choice' : ''}`
  }
  return OPTION_LABEL[D.optKey[o]] ?? 'Choose'
}

/** A ruler (History.rulers) by name: "Queen Asha", or "the ruler". */
function rulerWord(h: History, r: number): string {
  const x = h.rulers?.[r] as { name?: string } | undefined
  return x?.name ? x.name : 'the ruler'
}

const capFirst = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t)

/** The seat in words: "the throne of Tarsa", "House Rilkoik", "the Oreni". */
export function seatWords(h: History): string {
  const S = h.seat
  if (!S) return ''
  const { kind, id } = S.seat
  if (kind === SeatKind.Polity) return `the throne of ${polityWord(h, id)}`
  if (kind === SeatKind.House) return `House of ${h.dynasties?.[id]?.name ?? id}`
  return `the ${h.peoples?.[id]?.name ?? 'people'}`
}

export const SEAT_END_WORDS: Record<number, string> = {
  [SeatEnd.Conquered]: 'the realm was conquered',
  [SeatEnd.HouseEnded]: 'the house came to an end',
  [SeatEnd.PeopleGone]: 'the people is no more',
  [SeatEnd.Overthrown]: 'the house was overthrown and holds no throne',
}

// ---------- the Chronicle (hedged) and the Legend (story) of the seat (seat-mode §6.4) ----------
// A Chronicle line never states the player's motive and never says the choice caused the result beyond what the outcome
// records ("seems", "is said to", "the annals record"). The Legend tells it as plain story.

const K = SeatOptionKey
/** The option keys of each DecisionKind (seat-mode §3.5), with [chronicle, legend] templates: {year} {us} {them} {at}. */
export const CHOICE_PHRASES: Record<number, Record<number, readonly [string, string]>> = {
  [DecisionKind.WarOnUs]: {
    [K.FightOn]: ['{year}: when {them} declared war, the court of {us} seems to have resolved to fight; the annals record the levies called out.', 'When {them} came over the border, {us} did not bend. The levies marched.'],
    [K.SuePeace]: ['{year}: when {them} declared war, the court of {us} seems to have sought terms at once; the annals record envoys, not battles.', 'When {them} came, {us} sent salt and silver instead of soldiers.'],
    [K.OfferTribute]: ['{year}: {us} is said to have offered {them} tribute for peace.', '{us} bought peace from {them} with a yearly chest of silver.'],
    [K.SeekAlly]: ['{year}: at war with {them}, {us} is recorded sending envoys for allies.', 'Beset by {them}, {us} looked for friends.'],
  },
  [DecisionKind.Opening]: {
    [K.Strike]: ['{year}: with {them} divided, the court of {us} is said to have chosen war.', '{them} was weak, and {us} struck.'],
    [K.StayOut]: ['{year}: though {them} was in turmoil, {us} seems to have kept its peace.', '{them} bled, and {us} only watched.'],
    [K.OfferMatch]: ['{year}: {us} is said to have offered {them} a marriage while its court was divided.', 'To a {them} in turmoil, {us} offered a bride instead of a sword.'],
  },
  [DecisionKind.Heir]: {
    [K.NameHeir]: ['{year}: the ruler of {us} named an heir; the lords are said to have murmured.', 'The ruler of {us} chose an heir, and the law was made to bend.'],
    [K.LawDecides]: ['{year}: the succession of {us} seems to have been left to the law.', 'The ruler of {us} let the old law choose.'],
  },
  [DecisionKind.Crisis]: {
    [K.Placate]: ['{year}: the court of {us} is said to have bought off its magnates.', 'Gold went out from the treasury of {us}, and the lords fell quiet.'],
    [K.CrushPretender]: ['{year}: {us} is recorded moving against the pretender.', '{us} went after the pretender with fire.'],
    [K.Endure]: ['{year}: the court of {us} seems to have waited the crisis out.', '{us} held its breath and waited.'],
  },
  [DecisionKind.AllianceMade]: {
    [K.Honour]: ['{year}: {us} kept faith with its new ally {them}, as far as the annals tell.', '{us} gave its word to {them} and kept it.'],
    [K.Renounce]: ['{year}: {us} is said to have renounced its alliance with {them}.', '{us} tore up the treaty with {them}.'],
  },
  [DecisionKind.AllianceSought]: {
    [K.SeekAlly]: ['{year}: {us} is recorded seeking an alliance against a common enemy.', '{us} looked for friends against the coming storm.'],
    [K.Decline]: ['{year}: {us} seems to have chosen to stand alone.', '{us} would stand alone.'],
  },
  [DecisionKind.Overlord]: {
    [K.Pay]: ['{year}: {us} is recorded paying its tribute to {them}.', '{us} paid what {them} asked, and bided its time.'],
    [K.Defy]: ['{year}: {us} stopped paying {them} its tribute; war, as the chroniclers expected, was not far behind.', '{us} sent {them} an empty chest.'],
  },
  [DecisionKind.Match]: {
    [K.Arrange]: ['{year}: a match with {them} was arranged, the annals say, at the wish of the court of {us}.', 'A bride went from {us} to {them}, and the two houses were one family.'],
    [K.Decline]: ['{year}: {us} seems to have declined a match with {them}.', '{us} would not marry into {them}.'],
  },
  [DecisionKind.General]: {
    [K.Honour]: ['{year}: the court of {us} heaped honours on its general.', 'The ruler of {us} gave the general gold and a seat at the table.'],
    [K.Purge]: ['{year}: the ruler of {us} moved against the general.', 'The ruler of {us} reached for the general\'s head.'],
    [K.Ignore]: ['{year}: the court of {us} seems to have let the general be.', 'The ruler of {us} let the general be.'],
  },
  [DecisionKind.Plague]: {
    [K.Quarantine]: ['{year}: when {them} came to {at}, the ports of {us} are said to have been closed to ships.', 'When {them} came to {at}, {us} shut its harbours and let no ship in.'],
    [K.MoveCourt]: ['{year}: as {them} raged in {at}, the court of {us} seems to have left the capital.', 'The court of {us} fled {them} and set up its throne elsewhere.'],
    [K.Endure]: ['{year}: {them} reached {at}; the court of {us} is not recorded doing anything against it.', '{them} came to {at}, and {us} endured it.'],
  },
  [DecisionKind.Faith]: {
    [K.Embrace]: ['{year}: the ruler of {us} is said to have turned toward {them}.', 'The ruler of {us} bowed before the altar of {them}.'],
    [K.KeepWays]: ['{year}: the ruler of {us} seems to have kept the old faith, though many had taken up {them}.', 'The ruler of {us} would not kneel to {them}.'],
  },
  [DecisionKind.Revolt]: {
    [K.Placate]: ['{year}: when {them} rose, the court of {us} is said to have offered terms.', '{them} rose, and {us} answered with gifts.'],
    [K.Fortify]: ['{year}: when {them} rose, {us} is recorded raising walls at its capital.', '{them} rose, and {us} raised its walls high.'],
    [K.Crush]: ['{year}: {them} rose against the crown of {us}; the annals record the garrison marching.', '{them} rose, and {us} sent the soldiers.'],
  },
  [DecisionKind.Credit]: {
    [K.Borrow]: ['{year}: the treasury of {us} is said to have borrowed.', '{us} borrowed against the future.'],
    [K.Levy]: ['{year}: {us} raised its taxes, the annals record, to grumbling.', '{us} squeezed its towns for coin.'],
    [K.Retrench]: ['{year}: the court of {us} seems to have tightened its belt.', '{us} lived within its means.'],
    [K.RepudiateDebts]: ['{year}: the crown of {us} is said to have refused its debts; the lenders, the annals record, were not repaid.', '{us} burned the bonds and told its lenders to whistle for their silver.'],
  },
  [DecisionKind.Charter]: {
    [K.Grant]: ['{year}: {us} is said to have granted {them} a charter.', '{them} got its charter from {us}.'],
    [K.Refuse]: ['{year}: {us} refused {them} its charter.', '{us} told {them} no.'],
  },
  [DecisionKind.Betrayal]: {
    [K.SeparatePeace]: ['{year}: {us} is said to have made a separate peace, leaving its ally to fight alone.', '{us} made its own peace and left its ally to the wolves.'],
    [K.StandBy]: ['{year}: {us} stood by its ally, as far as the annals tell.', '{us} stood by its friends.'],
  },
  [DecisionKind.Frontier]: {
    [K.Settle]: ['{year}: after the explorers came home to {at}, settlers of {us} are recorded setting out for the new lands.', 'The explorers came home to {at}, and the settlers of {us} followed their tracks.'],
    [K.ExploreOn]: ['{year}: after the explorers came home to {at}, {us} seems to have sent them out again, further.', 'The explorers came home to {at}, and {us} sent them out again.'],
    [K.Stay]: ['{year}: the explorers came home to {at} with news of new lands; {us} is not recorded going there.', 'The explorers told of new lands, and {us} stayed home.'],
  },
  [DecisionKind.Crop]: {
    [K.TakeUp]: ['{year}: {us} is said to have sought out {them}, known from the traders of {at}.', '{us} brought {them} home from {at} and planted it.'],
    [K.Ignore]: ['{year}: {us} seems to have had no use for {them}.', '{us} would not grow {them}.'],
  },
  [DecisionKind.Idea]: {
    [K.Seek]: ['{year}: {us} is said to have sent to {at} to learn {them}.', '{us} sent its cleverest to {at} to learn {them}.'],
    [K.Ignore]: ['{year}: {us} seems to have let {them} pass it by.', '{us} had no use for {them}.'],
  },
}

/** The words of a decision's choice: [chronicle, legend] filled for decision d and option `option` (null: no phrase). */
export function choiceWords(h: History, d: number, option: number, legend: boolean): string | null {
  const D = h.seat?.decisions
  if (!D || d < 0 || d >= D.count) return null
  const key = D.optKey[D.optStart[d] + option]
  const t = CHOICE_PHRASES[D.kind[d]]?.[key]
  if (!t) return null
  const y = D.year[d]
  const us = D.polity[d] >= 0 ? polityWord(h, D.polity[d]) : `the ${h.peoples?.[h.seat!.peopleAt[y - h.seat!.seat.from]]?.name ?? 'people'}`
  const vars: Record<string, string> = { year: String(y + 1), us, them: subjectWord(h, D.kind[d], D.subject[d], y, D.polity[d]), at: townWord(h, D.place[d], y) }
  const line = (legend ? t[1] : t[0]).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

/** A decision as a fact (for the sagas): its year, kind, the option key chosen (-1: no card answered) and the line in each register. */
export interface DecisionFact { d: number; year: number; kind: number; key: number; chronicle: string; legend: string }

/** The decisions the player answered for polity p (the seat's polity then) up to year Y, in order. */
export function seatDecisionFacts(h: History, p: number, Y: number): DecisionFact[] {
  const D = h.seat?.decisions
  const out: DecisionFact[] = []
  if (!D) return out
  for (let d = 0; d < D.count; d++) {
    if (D.year[d] >= Y || D.polity[d] !== p || D.chosen[d] < 0) continue
    const o = D.chosen[d]
    out.push({ d, year: D.year[d], kind: D.kind[d], key: D.optKey[D.optStart[d] + o], chronicle: choiceWords(h, d, o, false) ?? '', legend: choiceWords(h, d, o, true) ?? '' })
  }
  return out
}

/** Whether an event type is a seat event (270-279). */
export const isSeatEvent = (t: number): boolean => t >= 270 && t <= 279

/** Chronicle line of a seat event (270-273; the court kinds' events with their steps). */
export function describeSeatEvent(h: History, e: { year: number; type: number; settlement: number; other: number; value: number; extra?: number }): string | null {
  if (!isSeatEvent(e.type)) return null
  const at = townWord(h, e.settlement, e.year)
  switch (e.type) {
    case 270: return `The player takes ${seatWords(h) || 'a seat'}${e.settlement >= 0 ? `, ruling from ${at}` : ''}`
    case 271: return `The seat passes to ${polityWord(h, e.value)}, ruled from ${at}`
    case 272: return `The seat is lost: ${SEAT_END_WORDS[e.extra ?? 0] ?? 'it ended'}`
    case 273: return `${capFirst(AMBITION_WORDS[e.value] ?? 'An ambition')} is achieved, ${e.extra ?? 0} years after the seat was taken`
  }
  return `At ${at}, a matter of the seat`
}

export const AMBITION_WORDS: Record<number, string> = {
  0: 'to endure', 1: 'to unify the land', 2: 'a faith of the realm', 3: 'the richest realm', 4: 'two crowns at once', 5: 'a great monument',
}

/** The Choice order's story (the Nudge list and the chronicle): the decision's phrase in the chronicle register. */
export function choiceStory(h: History, target: number): string {
  if (target < 0) return 'A choice of the court'
  return choiceWords(h, Math.floor(target / 8), target % 8, false) ?? 'A choice of the court'
}
