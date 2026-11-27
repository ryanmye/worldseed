// seat: the main-thread side of seat mode (seat-mode §5). It asks the worker for the next pause (worker.ts `seat`,
// `seatChoose`, `seatStop`), swaps each pause's History in (played on from the last pause), waits until the timeline reaches
// the pause year, then shows that year's decision cards one after the other. The choices' orders (decisionOrders: a Choice
// record plus the option's orders, for the next year) go to the URL's o= with the seat in seat= (both with replaceState, as
// nudges are), so a reload replays the same reign.
import { decisionOrders, encodeSeat } from '../../contract.ts'
import type { History, Order, SeatOptions } from '../../contract.ts'
import { createDecisionCard } from './decisionCard.ts'
import { SEAT_END_WORDS, seatWords } from './seatFormat.ts'

export type SeatRequest =
  | { type: 'seat'; seat: SeatOptions; orders: Order[]; cradles?: number[] }
  | { type: 'seatChoose'; orders: Order[] }
  | { type: 'seatStop'; years: number }

export interface SeatControllerDeps {
  parent: HTMLElement
  /** Post a seat request to the worker (main gives it a new request id). */
  post(req: SeatRequest): void
  /** Swap a pause's History in, played on from `keepYear`. */
  replaceHistory(h: History, ms: number, keepYear: number): void
  /** The year the timeline shows. */
  year(): number
  getOrders(): Order[]
  /** The orders now (written to o=). */
  setOrders(orders: Order[]): void
  setUrlParam(name: string, value: string | null): void
  /** Fly to a settlement (Show me). */
  flyTo(id: number): void
  /** The length to extend to when the player leaves the throne. */
  watchYears(years: number): number
  progress(label: string | null): void
}

export interface SeatController {
  readonly active: boolean
  /** Take a seat (the Take this throne button, or seat= on load). */
  start(seat: SeatOptions, cradles?: number[]): void
  /** A seatPause from the worker. */
  onPause(h: History, ms: number, cards: number[], lost: boolean): void
  /** Leave seat mode, watching history go on. */
  stop(): void
}

export function createSeatController(deps: SeatControllerDeps): SeatController {
  const card = createDecisionCard(deps.parent)
  let seat: SeatOptions | null = null
  let lastPause = -1
  let wait: number | null = null
  const clearWait = () => { if (wait !== null) window.clearInterval(wait); wait = null }

  /** Show cards[i...] of h; then send the orders chosen. */
  function ask(h: History, cards: number[], i: number, chosen: Order[]) {
    if (i >= cards.length) {
      card.message('The court acts', 'Envoys ride and orders go out. The years go on…', null)
      deps.setOrders([...deps.getOrders(), ...chosen])
      deps.post({ type: 'seatChoose', orders: chosen })
      return
    }
    const d = cards[i]
    const place = h.seat!.decisions.place[d]
    if (place >= 0) deps.flyTo(place) // (the camera frames the card's place; the card stands aside of it)
    card.show(h, d, i + 1, cards.length, (option) => ask(h, cards, i + 1, [...chosen, ...decisionOrders(h, d, option)]), place >= 0 ? () => deps.flyTo(place) : null)
  }

  const api: SeatController = {
    get active() { return seat !== null },
    start(s, cradles) {
      seat = s
      lastPause = s.from
      deps.setUrlParam('seat', encodeSeat(s))
      card.message('Reaching your reign…', `The years up to ${s.from} are told first; the chroniclers sharpen their pens. ${s.kind === 2 ? 'The house' : 'The throne'} is yours from then on.`, null)
      deps.progress(`Reaching your reign (${s.from})…`)
      deps.post({ type: 'seat', seat: s, orders: deps.getOrders(), cradles })
    },
    onPause(h, ms, cards, lost) {
      if (!seat) return
      clearWait()
      deps.progress(null)
      card.hide()
      deps.replaceHistory(h, ms, Math.min(lastPause, h.years))
      lastPause = h.years
      // (wait for the timeline to reach the pause, then ask)
      wait = window.setInterval(() => {
        if (deps.year() < h.years - 1e-6) return
        clearWait()
        if (lost) {
          const end = h.events.filter((e) => e.type === 272).pop()
          card.message('The seat is lost', `In ${h.seat?.lostYear ?? h.years} ${SEAT_END_WORDS[end?.extra ?? 0] ?? 'it ended'}: so ends the story of ${seatWords(h)}.`, [
            { label: 'Watch on', run: () => api.stop() },
          ])
          return
        }
        if (cards.length === 0) { deps.post({ type: 'seatChoose', orders: [] }); return }
        ask(h, cards, 0, [])
      }, 200)
    },
    stop() {
      if (!seat) return
      clearWait()
      card.hide()
      seat = null
      deps.post({ type: 'seatStop', years: deps.watchYears(lastPause) })
    },
  }
  return api
}
