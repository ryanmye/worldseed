// seat: the decision screen's content as data (DOM-free). decisionCard.ts renders exactly this, and the bot harness
// (src/bots) reads exactly this, so a bot sees what the seat UI shows at that pause and nothing more (fun-harness rule:
// the real seat interface, fog included; EVALUATION §4 Lane 2). Every field is a string or number the screen displays
// (or, for `key`, the option's glyph, which the card draws from the key; `option`, the index the click sends).
import { DEFER_OPTIONS } from '../../contract.ts'
import type { History } from '../../contract.ts'
import { SEAT, deferCost } from '../../sim/history/seat/params.ts'
import { deciderButton, deciderName } from './decider.ts'
import { decisionSituation, decisionTitle, optionExpects, optionLabel, optionMeta } from './seatFormat.ts'
import type { OptionTint } from './seatFormat.ts'
// lane N3 (throne slice): stakes, callbacks, news and the HUD (src/ui/seat/throne/*; N1's new-system cards keep their own modules)
import { stakesOf, type Stakes } from './throne/stakes.ts'
import { callbacksAt, realmNews } from './throne/callbacks.ts'
import { hudModel, type HudModel } from './throne/hudModel.ts'
import { ambitionLine } from './throne/ambition.ts'

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
  /** lane N3: plain words of what likely follows, the risk word, and the 50-year odds move where known. */
  stakes: Stakes
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
  /** lane N3: "Because you…" lines (outcomes of earlier choices resolved since the previous card), each with its decision. */
  callbacks: { d: number; text: string }[]
  /** lane N3: the realm's news since the previous card (successions, reigns ended, wars ended). */
  news: string[]
  /** lane N3: the throne HUD at this decision (meters, hazards, 50-year odds). */
  hud: HudModel | null
  /** lane N3: the declared ambition and how it stands ('' none). */
  ambition: string
}

/** The Authority meter of decision d (1 - deference / SEAT.deferFull, and the cost of a deferral, less for a divisive matter). */
export function authorityOf(h: History, d: number): CardModel['authority'] {
  const D = h.seat!.decisions
  const p = D.polity[d]
  const dv = h.deference && p >= 0 && p < h.deference.count ? h.deference.value[p] : 0
  const auth = Math.max(0, 1 - dv / SEAT.deferFull)
  const cost = deferCost(D.divisive[d]) / SEAT.deferFull // (lane N3d: what seat/system.ts adds)
  const body = deciderName(h, h.seat!.seat, D.year[d])
  // (lane N3d: the cost is what the next year takes; the meter then recovers a fiftieth of what is lost each year and a tenth with
  // each decision you take, so the next card may show a little less: play-test #2 read "−8" and then saw −6)
  const why = `Authority: how far the realm still waits on you. Each matter you leave to ${body} lowers it, routine business least, a grave matter most (its blame they bear). It recovers a little each year, and each decision you take yourself restores a tenth of what is lost. Low, ${body} rule in all but name, and the throne is less safe.`
  return { value: auth, cost, body, why }
}

/** The decision screen for decision d (`n` of `total` this year). */
export function decisionCardModel(h: History, d: number, n: number, total: number): CardModel {
  const D = h.seat!.decisions
  const count = D.optStart[d + 1] - D.optStart[d]
  const options: CardOptionModel[] = []
  for (let i = 0; i < count; i++) {
    const m = optionMeta(h, d, i)
    const label = optionLabel(h, d, i)
    const stakes = stakesOf(h, d, i)
    // (lane N3: an option without orders says what happens, not "the court keeps its own counsel"; one with orders adds the likely outcome)
    const note = m.court ? stakes.likely : [optionExpects(h, d, i), stakes.likely].filter(Boolean).join(' ')
    options.push({ option: i, key: m.key, label, tag: m.tag, tint: m.tint, badge: m.badge, note, court: m.court, stakes, aria: `${options.length + 1}. ${label}. ${m.tag}. ${note} Risk: ${stakes.risk}.${stakes.odds ? ` ${stakes.odds}.` : ''}${m.badge ? ` (${m.badge})` : ''}` })
  }
  const words = deciderButton(h, h.seat!.seat, D.year[d])
  const pickLabel = optionLabel(h, d, D.courtPick[d])
  const hint = D.divisive[d] >= 0.5 ? 'A grave matter: the blame will fall on them, but the realm sees you stand aside.' : 'Routine business: little authority is lost by leaving it.'
  // lane N3: what came of earlier choices, and the realm's news, since the previous card
  let prev = -1
  for (let x = d - 1; x >= 0; x--) if (D.year[x] < D.year[d]) { prev = D.year[x]; break }
  const since = prev >= 0 ? prev : h.seat!.seat.from
  // (lane N3d: decision 2 of 2 does not tell the same news again: the first card of the year has it)
  const first = n <= 1
  const callbacks = first ? callbacksAt(h, D.year[d], since).map((c) => ({ d: c.d, text: c.text })) : []
  const news = first && D.polity[d] >= 0 ? realmNews(h, D.polity[d], since, D.year[d]).map((x) => x.text) : []
  return {
    callbacks, news, hud: hudModel(h, d, D.year[d]), ambition: ambitionLine(h, D.year[d]),
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
