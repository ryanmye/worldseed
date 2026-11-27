// seat: the decision screen's content as data (DOM-free). decisionCard.ts renders exactly this, and the bot harness
// (src/bots) reads exactly this, so a bot sees what the seat UI shows at that pause and nothing more (fun-harness rule:
// the real seat interface, fog included; EVALUATION §4 Lane 2). Every field is a string or number the screen displays
// (or, for `key`, the option's glyph, which the card draws from the key; `option`, the index the click sends).
import { DEFER_OPTIONS } from '../../contract.ts'
import type { History } from '../../contract.ts'
import { SEAT } from '../../sim/history/seat/params.ts'
import { deciderButton, deciderName } from './decider.ts'
import { decisionSituation, decisionTitle, optionExpects, optionLabel, optionMeta } from './seatFormat.ts'
import type { OptionTint } from './seatFormat.ts'

export interface CardOptionModel {
  /** The option index the card's button sends (pick(option)). */
  option: number
  /** The glyph's option key (SeatOptionKey), drawn on the card. */
  key: number
  label: string
  tag: string
  tint: OptionTint
  badge: string
  /** The line of consequence ("The court expects…"). */
  note: string
  /** The option is the court's own course (no orders: the "Wait" badge). */
  court: boolean
  aria: string
}

export interface CardModel {
  /** The decision row (what pick() is called for; the URL's Choice target d * 8 + option). */
  d: number
  title: string
  /** "701 · decision 1 of 2". */
  sub: string
  year: number
  situation: string
  /** The Authority meter: 0..1 now, and what leaving the matter would take away (0..1). */
  authority: { value: number; cost: number; body: string; why: string }
  options: CardOptionModel[]
  /** "Do nothing — let <body> decide", the court's pick and the hint (the option sent: DEFER_OPTIONS.defer). */
  defer: { option: number; words: string; pickLabel: string; hint: string; note: string }
  /** The place "Show me" flies to (-1: no Show me button). */
  place: number
}

/** The Authority meter of decision d (1 - deference / SEAT.deferFull, and the cost of a deferral, less for a divisive matter). */
export function authorityOf(h: History, d: number): CardModel['authority'] {
  const D = h.seat!.decisions
  const p = D.polity[d]
  const dv = h.deference && p >= 0 && p < h.deference.count ? h.deference.value[p] : 0
  const auth = Math.max(0, 1 - dv / SEAT.deferFull)
  const cost = (1 - SEAT.deferDivisive * D.divisive[d]) / SEAT.deferFull
  const body = deciderName(h, h.seat!.seat, D.year[d])
  const why = `Authority: how far the realm still waits on you. Each matter you leave to ${body} lowers it (less for a divisive one, whose blame they bear); each decision you take restores it. Low, ${body} rule in all but name, and the throne is less safe. Your court grows used to ruling without you.`
  return { value: auth, cost, body, why }
}

/** The decision screen for decision d (`n` of `total` this year). */
export function decisionCardModel(h: History, d: number, n: number, total: number): CardModel {
  const D = h.seat!.decisions
  const count = D.optStart[d + 1] - D.optStart[d]
  const options: CardOptionModel[] = []
  for (let i = 0; i < count; i++) {
    const m = optionMeta(h, d, i)
    const label = optionLabel(h, d, i), note = optionExpects(h, d, i)
    options.push({ option: i, key: m.key, label, tag: m.tag, tint: m.tint, badge: m.badge, note, court: m.court, aria: `${options.length + 1}. ${label}. ${m.tag}. ${note}${m.badge ? ` (${m.badge})` : ''}` })
  }
  const words = deciderButton(h, h.seat!.seat, D.year[d])
  const pickLabel = optionLabel(h, d, D.courtPick[d])
  const hint = D.divisive[d] >= 0.5 ? 'A divisive matter: the blame will fall on them.' : 'Routine business: the court grows used to ruling without you.'
  return {
    d,
    title: decisionTitle(h, d),
    sub: `${D.year[d]}${total > 1 ? ` · decision ${n} of ${total}` : ''}`,
    year: D.year[d],
    situation: decisionSituation(h, d),
    authority: authorityOf(h, d),
    options,
    defer: { option: DEFER_OPTIONS.defer, words, pickLabel, hint, note: `They would choose: ${pickLabel}. ${hint}` },
    place: D.place[d],
  }
}
