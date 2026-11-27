// seat: words for the decision cards (decisionCard.ts) and for the seat in the Chronicle and Legend (seat-mode §6.3-6.4).
// DOM-free: reads a History only, so the phrase tables are tested in Node (seatFormat.test.ts).
import { DecisionKind, OrderKind, SeatEnd, SeatKind, SeatOptionKey, describeDecisionKinds, describeOrderKinds, settlementNameAt } from '../../contract.ts'
import type { History } from '../../contract.ts'

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
  [SeatOptionKey.TakeUp]: 'Take it up', [SeatOptionKey.Seek]: 'Seek it out',
}

/** The court's own course (an option without orders): what the card says will happen. */
const COURT_EXPECTS = 'The court keeps its own counsel; events take their course.'

/** The year's polity name ("the Oreni realm" style: the proper name). */
export function polityWord(h: History, q: number): string {
  const P = h.polities?.[q]
  return P ? P.name : 'a neighbour'
}
export function townWord(h: History, id: number, year: number): string {
  return id >= 0 && id < h.settlements.length ? settlementNameAt(h, id, year) : 'a town'
}

/** The name of a decision's subject (per kind). */
export function subjectWord(h: History, kind: number, subject: number, year: number): string {
  switch (kind) {
    case DecisionKind.WarOnUs: case DecisionKind.Opening: return polityWord(h, subject)
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
  const s = subjectWord(h, D.kind[d], D.subject[d], D.year[d])
  const label = DK[D.kind[d]]?.label ?? 'A decision'
  return s ? `${label}: ${s}` : label
}

/** Two short lines of situation, from what the seat's people knows. */
export function decisionSituation(h: History, d: number): string {
  const D = h.seat!.decisions
  const y = D.year[d], k = D.kind[d], subj = D.subject[d], at = townWord(h, D.place[d], y)
  const us = D.polity[d] >= 0 ? polityWord(h, D.polity[d]) : 'our people'
  const name = subjectWord(h, k, subj, y)
  switch (k) {
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
  return OPTION_LABEL[D.optKey[D.optStart[d] + option]] ?? 'Choose'
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
