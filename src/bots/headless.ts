// Fun harness, driver (a): headless, in Node. It hosts the real worker (src/worker.ts, with a fake `self`) and the real seat
// controller (ui/seat/seatController.ts), and gives the controller a "card" that, instead of drawing the decision screen,
// builds the same CardModel the screen draws (ui/seat/cardModel.ts) and lets a persona click one of its buttons. So every
// order goes through the controller's own path (decisionOrders, the o= list, seatChoose), Defer through DEFER_OPTIONS.defer,
// and the bot sees only the card. The one difference from the browser: the timeline is not played in real time (year()
// is always at the pause); playback time is reported from the years (1x = 20/3 years a second, timeline.ts).
import { decodeOrders, encodeOrders, encodeSeat } from '../contract.ts'
import type { History, HistoryOptions, Order, SeatOptions } from '../contract.ts'
import { createSeatController } from '../ui/seat/seatController.ts'
import type { DecisionCard } from '../ui/seat/decisionCard.ts'
import { decisionCardModel, type CardModel } from '../ui/seat/cardModel.ts'
import { rngOf, type Decision, type Persona, type PersonaMemory } from './personas.ts'

export interface CardLog {
  /** Wall-clock ms since the run started when the card showed. */
  t: number
  model: CardModel
  decision: Decision
}
export interface MessageLog { t: number; title: string; text: string }

export interface BotRun {
  seed: number
  seat: SeatOptions
  persona: string
  historyOptions: HistoryOptions
  cards: CardLog[]
  messages: MessageLog[]
  /** The o= the run left (encodeOrders) and the seat= (encodeSeat): the run's URL. */
  o: string
  seatParam: string
  /** The History at the last pause. */
  history: History
  lost: boolean
  pauses: number
  wallMs: number
  /** ms from start to the world, and to the first decision card. */
  worldMs: number
  firstCardMs: number
}

type Msg = { type: string; requestId: number; history?: History; cards?: number[]; lost?: boolean; message?: string; ms?: number }

let booted: Promise<void> | null = null
let handler: ((m: Msg) => void) | null = null
/** Boots the real worker once per process (its module state is the worker's). */
function boot(): Promise<void> {
  if (!booted) {
    const g = globalThis as unknown as { self: unknown }
    g.self = { postMessage: (m: Msg) => handler?.(m), onmessage: null }
    booted = import('../worker.ts').then(() => undefined)
  }
  return booted
}
let nextId = 1000

export interface RunConfig {
  seed: number
  seat: SeatOptions
  persona: Persona
  /** Years to play after seat.from (stops at the first pause at or past it). */
  span: number
  historyOptions: HistoryOptions
  rngSeed?: number
  subdivisions?: number
  /** Stop at the first pause with a card after this many cards were answered (the UI bot's stop). */
  maxCards?: number
  /** Called at each card (progress output). */
  onCard?: (c: CardLog) => void
}

export async function runBot(cfg: RunConfig): Promise<BotRun> {
  await boot()
  const self = (globalThis as unknown as { self: { onmessage: (e: { data: unknown }) => void } }).self
  const t0 = performance.now()
  const now = () => performance.now() - t0
  const rng = rngOf(cfg.rngSeed ?? cfg.seed * 7919 + 17)
  const mem: PersonaMemory = { seen: [] }
  const cards: CardLog[] = []
  const messages: MessageLog[] = []
  let orders: Order[] = []
  let latest = 0
  let worldMs = 0, firstCardMs = -1, pauses = 0
  const end = cfg.seat.from + cfg.span

  return new Promise<BotRun>((resolve, reject) => {
    let done = false
    const finish = (h: History, lost: boolean) => {
      if (done) return
      done = true
      handler = null
      resolve({
        seed: cfg.seed, seat: cfg.seat, persona: cfg.persona.id, historyOptions: cfg.historyOptions, cards, messages,
        o: encodeOrders(orders), seatParam: encodeSeat(cfg.seat), history: h, lost, pauses, wallMs: now(), worldMs, firstCardMs,
      })
    }
    // the bot's "screen": the decision card's model, answered by the persona
    let current: History | null = null
    const card: DecisionCard = {
      get open() { return false },
      show(h, d, n, total, pick) {
        const model = decisionCardModel(h, d, n, total)
        const decision = cfg.persona.choose(model, mem, rng)
        const c: CardLog = { t: now(), model, decision }
        if (firstCardMs < 0) firstCardMs = c.t
        cards.push(c)
        cfg.onCard?.(c)
        const opt = model.options.find((o) => o.option === decision.option)
        mem.seen.push({ year: model.year, title: model.title, situation: model.situation, picked: decision.option, deferred: decision.option === model.defer.option, label: opt?.label ?? model.defer.words })
        queueMicrotask(() => pick(decision.option))
      },
      message(title, text) {
        messages.push({ t: now(), title, text })
        if (title === 'The seat is lost' && current) finish(current, true)
      },
      hide() {},
    }
    const ctl = createSeatController({
      card,
      post: (req) => { latest = ++nextId; self.onmessage({ data: { ...req, requestId: latest } }) },
      replaceHistory: (h) => { current = h },
      year: () => Number.POSITIVE_INFINITY,
      getOrders: () => orders,
      setOrders: (o) => { orders = decodeOrders(encodeOrders(o)) },
      setUrlParam: () => {},
      flyTo: () => {},
      watchYears: (y) => y,
      progress: () => {},
    })
    const worldId = ++nextId
    handler = (m) => {
      if (m.type === 'error') { done = true; handler = null; reject(new Error(m.message)); return }
      if (m.type === 'world' && m.requestId === worldId) { worldMs = now(); ctl.start(cfg.seat); return }
      if (m.type !== 'seatPause' || m.requestId !== latest) return
      pauses++
      const h = m.history!
      current = h
      if (h.years >= end || m.lost || (cfg.maxCards !== undefined && cards.length >= cfg.maxCards && m.cards!.length > 0)) { finish(h, !!m.lost); return }
      ctl.onPause(h, m.ms ?? 0, m.cards!, !!m.lost)
    }
    latest = worldId
    self.onmessage({ data: { type: 'generate', requestId: worldId, seed: cfg.seed, options: { subdivisions: cfg.subdivisions ?? 48 }, historyOptions: cfg.historyOptions, worldOnly: true } })
  })
}
