// Web worker: generates a World off the main thread, posts it back so the
// globe can appear immediately, then simulates its settlement history and
// posts that as a second message.
//
// The world is posted as a structured-clone copy (~2 MB at the default
// resolution, about a millisecond) so the worker keeps the original to
// simulate on; the history's large typed arrays are transferred, not copied.
//
// Extending: an `extend` request continues the simulation of the kept world for a longer
// run. The worker keeps one resumable run (createHistoryRun) per generated world and calls
// advanceTo for the initial history and for every extension, so an extension costs only
// the added years; each History it returns owns its arrays (safe to transfer). Without
// createHistoryRun it re-runs simulateHistory from scratch. Either way a shorter run
// reproduces the start of a longer one bit for bit, so the longer History simply replaces
// the shorter one on the main thread. Requests are handled one at a time (one simulation
// at once); the main thread sends at most one extension at a time and drops responses
// whose requestId is stale (a new seed).
//
// World only (the start page, ui/landing.ts): a generate request with worldOnly posts the world and keeps
// it without simulating; a later `history` request for the same requestId simulates (or reads from the
// cache) its first history with the options chosen there (the years), as a plain generate would have.
//
// Orders (the player's nudges, HistoryOptions.orders): a generate request may carry them in its
// historyOptions, and an `orders` request re-simulates the kept world with a new list. Either way the
// list is canonicalised (decodeOrders(encodeOrders(...)), dropped when empty, so [] and undefined
// give the same run and the same cache key) and is part of the cache key (cacheKeys serialises the
// history options). The resumable run keeps the orders it was created with, so new orders start a new
// createHistoryRun from year 0 (the run before the earliest order is the same, but a run cannot be
// forked, so it is simulated again: a full run, about 3 s for 2000 years). A newer orders or generate
// request makes a queued orders request moot (it is skipped).
//
// Cradles (the first hearths the player planted, HistoryOptions.cradles: a cell per people in people order, -1 the
// simulation's choice): carried like the orders, in a generate or history request's historyOptions or in an `orders`
// request (which then re-simulates with that list; without the field the kept run's cradles stay). Canonical
// (contract.ts canonicalCradles: whole cells or -1, trailing -1 dropped) and dropped when empty or all -1, so
// [], [-1, -1] and undefined give the same run and the same cache key; part of the cache key like every history
// option (cacheKeys serialises them all but `years`). New cradles change the history from year 0: a new run.

//
// Seat mode (seat-mode §5; HistoryOptions.seat): a `seat` request starts a live run of the kept world with the seat and the
// orders given (a URL's, on a reload), steps it to the replay point (the seat's year, or the year before the last order) with
// progress posts, then plays on (HistoryRun.playSeat) to the first year the seat's watcher records a decision, the seat is
// lost, or SEAT_MAX_RUN years pass, and posts that History as `seatPause` with the decision rows of its last year (`cards`).
// A `seatChoose` request appends the orders of the options chosen to the same run (HistoryRun.addOrders: nothing is
// re-simulated, and the result is exactly the run with those orders from the start) and plays on to the next pause.
// `seatStop` leaves seat mode: the seat run becomes the kept run (with its seat and orders as its options) and is extended
// to `years` without pausing, posted as a replace history. Pause histories are not cached (the stopped run is).
// (Take-back, `seatBack`, needs the checkpoints of perf-efficiency P6: seat steps 10-11.)

import type { CreateHistoryRun, History, HistoryOptions, HistoryRun, Order, SeatOptions, World, WorldOptions } from './contract.ts'
import { canonicalCradles, decodeOrders, encodeOrders } from './contract.ts'
import * as sim from './sim/index.ts'
import { buffersOf, cacheKeys, hashValue, openHistoryCache, snapshot, type CacheKeys } from './historyCache.ts'

const { generateWorld, simulateHistory } = sim
/** The resumable run's constructor, when the simulation exports one (else every run starts from scratch). */
const createHistoryRun = (sim as { createHistoryRun?: CreateHistoryRun }).createHistoryRun

export type WorkerRequest =
  | {
      type: 'generate'
      /** Echoed in every response so the UI can drop results for superseded requests. */
      requestId: number
      seed: number
      options?: WorldOptions
      historyOptions?: HistoryOptions
      /** Cache (see the cache section below): skip reading (still write); compare a cached history with a fresh run. */
      nocache?: boolean
      cachecheck?: boolean
      /** Without a cached history, first simulate (and post) only this many years when the requested run is longer; the UI then extends. */
      firstYears?: number
      /** Post the world only and keep it: its history comes with a later `history` request (the start page, ui/landing.ts). */
      worldOnly?: boolean
    }
  | {
      /** Simulate the history of the world kept by generate request `requestId` (sent with worldOnly), with these options. */
      type: 'history'
      requestId: number
      historyOptions?: HistoryOptions
      nocache?: boolean
      cachecheck?: boolean
      firstYears?: number
    }
  | {
      /** Simulate the world of request `requestId` again, `years` long. */
      type: 'extend'
      requestId: number
      years: number
      /** Debugging (perf=1 tools): fail as if the simulation had thrown. */
      fail?: boolean
      /** Run at full speed even in a hidden tab (the run the page was opened for). */
      full?: boolean
    }
  | {
      /** Simulate the kept world again with these orders (the player's nudges), `years` long; answered with a `replace` history under the new requestId. */
      type: 'orders'
      requestId: number
      orders: Order[]
      years: number
      /** The planted cradles to simulate with (HistoryOptions.cradles); absent: those of the run kept. */
      cradles?: number[]
    }
  /** seat: start (or, from a URL, resume) seat mode on the kept world: a live run with this seat and these orders, played to the next pause. */
  | { type: 'seat'; requestId: number; seat: SeatOptions; orders: Order[]; cradles?: number[] }
  /** seat: the orders of the options chosen at the last pause (year + 1; maybe none), appended to the live run; play on. */
  | { type: 'seatChoose'; requestId: number; orders: Order[] }
  /** seat: leave seat mode, extending the seat's run to `years` without pausing (answered with a replace history). */
  | { type: 'seatStop'; requestId: number; years: number }
  /** The page was hidden or shown: background extensions run at a reduced duty cycle while hidden. */
  | { type: 'throttle'; hidden: boolean }

export type WorkerResponse =
  | { type: 'world'; requestId: number; world: World }
  | { type: 'history'; requestId: number; history: History; ms: number; extend: boolean; cached?: boolean; /** A run with different orders of the world shown (an `orders` request). */ replace?: boolean }
  | { type: 'error'; requestId: number; stage: 'world' | 'history' | 'extend'; message: string }
  /** Progress of a run in chunks (resumable runs only, see `simulate`): `years` simulated so far of `target`. */
  | { type: 'progress'; requestId: number; years: number; target: number }
  /** seat: the History up to a pause (its last year), the decision rows of that year (History.seat.decisions), whether the seat is lost. */
  | { type: 'seatPause'; requestId: number; history: History; ms: number; cards: number[]; lost: boolean }

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)
const errorMessage = (err: unknown) => (err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err))

/** The world of the latest generate request, kept to simulate longer runs on, with its resumable run (null before the first run, without createHistoryRun, or after a failure). */
interface Kept { requestId: number; world: World; historyOptions?: HistoryOptions; run: HistoryRun | null; keys: CacheKeys | null }
let kept: Kept | null = null

/** Progress is posted at least this often (simulated years) while a resumable run advances toward its target. */
const PROGRESS_CHUNK_YEARS = 50
/**
 * Years of the next chunk from `year`. With the run's simulateTo (steps without assembling a
 * History) chunks stay small for a smooth progress strip; older runs only have advanceTo, which
 * assembles a whole History per call (about 25 ms at 2000 years, 80 ms at 6000), so there chunks
 * grow to a tenth of the years so far.
 */
const chunkYears = (run: HistoryRun) => (run.simulateTo ? PROGRESS_CHUNK_YEARS : Math.max(150, Math.floor(run.year / 10)))

/**
 * History `years` long (undefined: the requested default length) of the kept world: from its
 * resumable run when there is one, stepping it in chunks (simulateTo where the run has it, else
 * advanceTo) and posting a 'progress' response after each one short of the target, then
 * assembling the History once with advanceTo(target), so the UI can show real progress for the
 * simulation (the run reaching the same target in one call or several costs the same, per its contract).
 */
async function simulate(k: Kept, years: number | undefined, requestId: number, background: boolean): Promise<History> {
  if (createHistoryRun && !k.run) k.run = createHistoryRun(k.world, k.historyOptions)
  const target = years ?? k.historyOptions?.years ?? 2000
  if (!k.run) return simulateHistory(k.world, years === undefined ? k.historyOptions : { ...k.historyOptions, years })
  try {
    const run = k.run
    let upTo = Math.min(target, run.year + chunkYears(run))
    while (upTo < target) {
      const t0 = performance.now()
      if (run.simulateTo) run.simulateTo(upTo)
      else run.advanceTo(upTo)
      lastChunkMs = performance.now() - t0
      post({ type: 'progress', requestId, years: run.year, target })
      if (background) await breathe()
      upTo = Math.min(target, run.year + chunkYears(run))
    }
    const t0 = performance.now()
    const h = run.advanceTo(target)
    lastChunkMs = performance.now() - t0
    return h
  } catch (err) {
    k.run = null // its state is suspect: a later request starts from scratch
    throw err
  }
}

/** The buffers of a History to transfer with it (zero-copy; detached in the worker). */
function transferList(history: History): Transferable[] {
  // A Set: the sim may pack several arrays into one buffer, and listing a buffer twice throws.
  const transfer = new Set<Transferable>([history.population.buffer, history.food.buffer, history.capacity.buffer] as ArrayBuffer[])
  const partial = history as Partial<History>
  const J = partial.journeys
  if (J) {
    for (const a of [J.departYear, J.arriveYear, J.from, J.to, J.size, J.kind, J.pathOffsets, J.path]) transfer.add(a.buffer as ArrayBuffer)
  }
  // land snapshots, roads, wealth and trade arrive with the sim; any may be missing while it is being extended
  const T = partial.trade
  const extra: (ArrayBufferView | undefined)[] = [partial.landUse, partial.degradation, partial.road, partial.wealth, partial.tradeVolume]
  if (T) extra.push(T.a, T.b, T.openedYear, T.goodAB, T.goodBA, T.pathOffsets, T.path)
  // knowledge, contact, technology and species tables (newer sims)
  const p = partial as Record<string, unknown>
  for (const k of ['knownYear', 'contactYear', 'technology', 'speciesYear', 'speciesSource', 'crop', 'herd', 'cash', 'habit', 'storable', 'techniqueYear', 'techniqueSource']) if (ArrayBuffer.isView(p[k])) extra.push(p[k] as ArrayBufferView)
  // polities: membership, territory and danger rows, wars and raids (empty placeholders are copied, not transferred)
  // (polities v2: tariffs, duty revenue, contraband and losses on routes, smugglers' hubs, pirate havens, bonds)
  for (const k of ['polity', 'landCells', 'territory', 'claimed', 'danger', 'tariff', 'tariffRevenue', 'smuggleVolume', 'tradeLoss', 'contraband', 'piracy']) if (ArrayBuffer.isView(p[k]) && (p[k] as ArrayBufferView).byteLength > 0) extra.push(p[k] as ArrayBufferView)
  // goods: deposit output, tradition quality, industries, tools and arms, long-haul volumes, prices, marts, secret guards, merchant capital
  // (the long-haul leg records' columns go with partial.longHaul below)
  for (const k of ['depositOutput', 'traditionQuality', 'industry', 'metal', 'longHaulVolume', 'priceIndex', 'mart', 'secretGuard', 'merchantWealth']) if (ArrayBuffer.isView(p[k]) && (p[k] as ArrayBufferView).byteLength > 0) extra.push(p[k] as ArrayBufferView)
  // rulers, religion: reigns per polity, marriages, unions, wars of succession; majority faith and its share per snapshot, state religions, holy wars
  for (const k of ['reignOffsets', 'reignIds', 'successionWars', 'faith', 'faithShare', 'stateFaith', 'holyWars']) if (ArrayBuffer.isView(p[k]) && (p[k] as ArrayBufferView).byteLength > 0) extra.push(p[k] as ArrayBufferView)
  for (const group of [partial.marriages, partial.unions] as unknown as (Record<string, unknown> | undefined)[]) if (group) for (const v of Object.values(group)) if (ArrayBuffer.isView(v) && v.byteLength > 0) extra.push(v)
  // disease: fever per cell, fever tolerance and endemic sickness per snapshot per people, outbreaks and quarantines
  for (const k of ['fever', 'feverTolerance', 'endemic']) if (ArrayBuffer.isView(p[k]) && (p[k] as ArrayBufferView).byteLength > 0) extra.push(p[k] as ArrayBufferView)
  // tourism: scenery and its kinds per cell, visitor flows (pairs, paths and rows); renaming: the renamings table (its typed columns, fresh per run); landmarks: the landmarks and their changes (likewise)
  for (const k of ['scenery', 'sceneryKind']) if (ArrayBuffer.isView(p[k]) && (p[k] as ArrayBufferView).byteLength > 0) extra.push(p[k] as ArrayBufferView)
  // oaths, arms: faithless and armament per snapshot; finance: the crowns' purses per snapshot and loan balances (their tables go with the groups below)
  for (const k of ['faithless', 'arms', 'treasury', 'crownDebt', 'crownRevenue', 'crownSpending', 'creditRate', 'coinage', 'fiscalDistress', 'loanBalance']) if (ArrayBuffer.isView(p[k]) && (p[k] as ArrayBufferView).byteLength > 0) extra.push(p[k] as ArrayBufferView)
  // beliefs: true strength, the belief snapshots and the per-polity bluff, spy and credibility rows (fresh at assembly)
  for (const k of ['strength', 'beliefEst', 'beliefSd', 'beliefSource', 'bluffShown', 'spyService', 'credibility']) if (ArrayBuffer.isView(p[k]) && (p[k] as ArrayBufferView).byteLength > 0) extra.push(p[k] as ArrayBufferView)
  for (const group of [partial.grievances, partial.armsRaces, partial.loans, partial.beliefs] as unknown as (Record<string, unknown> | undefined)[]) if (group) for (const v of Object.values(group)) if (ArrayBuffer.isView(v) && v.byteLength > 0) extra.push(v)
  for (const group of [partial.wars, partial.raids, partial.bonds, partial.embargoes, partial.longHaul, partial.secretHolds, partial.outbreaks, partial.quarantines, partial.visitorFlows, partial.renamings, partial.landmarks] as unknown as (Record<string, unknown> | undefined)[]) {
    if (!group) continue
    for (const v of Object.values(group)) if (ArrayBuffer.isView(v) && v.byteLength > 0) extra.push(v)
  }
  // ideas: the adoptions table (its typed columns, fresh per run)
  if (partial.ideaAdoptions) for (const v of Object.values(partial.ideaAdoptions)) if (ArrayBuffer.isView(v) && v.byteLength > 0) extra.push(v)
  // causes: History.why's tables (typed columns, fresh per run)
  if (partial.why) for (const g of Object.values(partial.why)) for (const v of Object.values(g)) if (ArrayBuffer.isView(v) && v.byteLength > 0) extra.push(v)
  for (const a of extra) if (a && ArrayBuffer.isView(a) && a.buffer instanceof ArrayBuffer && a.buffer.byteLength > 0) transfer.add(a.buffer)
  return [...transfer]
}

async function simulateAndPost(requestId: number, k: Kept, years: number | undefined, extend: boolean, background = false, replace = false) {
  const t0 = performance.now()
  const history = await simulate(k, years, requestId, background)
  const ms = performance.now() - t0
  const stored = k.keys ? snapshot(history) : null // (before its arrays are transferred away)
  const transfer = transferList(history)
  post({ type: 'history', requestId, history, ms, extend, replace: replace || undefined }, transfer)
  if (stored && k.keys) void cacheWrite(k.keys.history(stored.years), k.keys.group, stored.years, stored)
}

// ---------- cache (historyCache.ts) and the background duty cycle ----------
// Worlds and histories are cached in IndexedDB by code version, seed and options (written here
// after each run, read on generate). Requests are handled one at a time, in order (`queue`); a
// background extension yields between chunks, and while the page is hidden it sleeps twice
// the last chunk's time after each (about a third of a core instead of a whole one).

const cacheReady = openHistoryCache()
let hidden = false
let lastChunkMs = 0
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const breathe = () => sleep(hidden ? Math.min(2000, 2 * lastChunkMs) : 0)
let writes: Promise<void> = Promise.resolve()
/** Writes run one after another (each compresses its arrays first), behind the requests. */
function cacheWrite(key: string, group: string, years: number, value: unknown) {
  writes = writes.then(async () => {
    const t0 = performance.now()
    if (await (await cacheReady)?.put(key, group, years, value)) console.info(`cache: ${years ? `${years}-year history` : 'world'} stored ${(performance.now() - t0).toFixed(0)} ms after the run (compressed in the background)`)
  })
}

/** History options with the orders and the cradles canonical (see the header) and each dropped when there are none. */
function canonicalOptions(o: HistoryOptions | undefined): HistoryOptions | undefined {
  if (!o || (o.orders === undefined && o.cradles === undefined)) return o
  const { orders, cradles, ...rest } = o
  const out: HistoryOptions = { ...rest }
  if (orders !== undefined) {
    const canon = decodeOrders(encodeOrders(orders))
    if (canon.length > 0) out.orders = canon
  }
  const cc = cradles ? canonicalCradles(cradles) : []
  if (cc.length > 0) out.cradles = cc
  return Object.keys(out).length > 0 ? out : undefined
}

/** The seed and world options of the kept world (for the cache keys of an orders request). */
let keptSeed: { seed: number; options?: WorldOptions } | null = null
/** The latest request id seen: a queued orders request older than it is skipped. */
let latestRequestId = 0

async function generate(req: Extract<WorkerRequest, { type: 'generate' }>) {
  const { requestId, seed, options } = req
  const historyOptions = canonicalOptions(req.historyOptions)
  keptSeed = { seed, options }
  const cache = await cacheReady
  const keys = cache ? cacheKeys(cache.version, seed, options, historyOptions) : null
  kept = null
  let world: World | null = null
  try {
    const t0 = performance.now()
    world = keys && !req.nocache ? await cache!.getWorld<World>(keys.world) : null
    if (world) {
      console.info(`cache: world read in ${(performance.now() - t0).toFixed(0)} ms`)
      if (req.cachecheck) {
        const a = hashValue(generateWorld(seed, options)), b = hashValue(world)
        console[a === b ? 'info' : 'error'](`cache check (world): fresh ${a}, cached ${b}: ${a === b ? 'identical' : 'DIFFERENT'}`)
      }
    } else {
      world = generateWorld(seed, options)
      console.info(`world generated in ${(performance.now() - t0).toFixed(0)} ms`)
      if (keys) cacheWrite(keys.world, '', 0, snapshot(world))
    }
    post({ type: 'world', requestId, world }) // copied: the worker keeps `world`
  } catch (err) {
    post({ type: 'error', requestId, stage: 'world', message: errorMessage(err) })
    return
  }
  kept = { requestId, world, historyOptions, run: null, keys }
  if (req.worldOnly) return
  await historyOf(kept, req)
}

/** The kept world's first history: from the cache when it has it, else simulated (and posted). */
async function historyOf(k: Kept, req: { requestId: number; nocache?: boolean; cachecheck?: boolean; firstYears?: number }) {
  const { requestId } = req
  const { world, historyOptions, keys } = k
  const cache = await cacheReady
  const target = historyOptions?.years ?? 2000
  try {
    const t0 = performance.now()
    const hit = keys && !req.nocache ? await cache!.getHistory<History>(keys, target) : null
    if (hit) {
      const ms = performance.now() - t0
      console.info(`cache: ${hit.years}-year history read in ${ms.toFixed(0)} ms`)
      if (req.cachecheck) {
        const fresh = simulateHistory(world, { ...historyOptions, years: hit.years })
        const a = hashValue(fresh), b = hashValue(hit.value)
        console[a === b ? 'info' : 'error'](`cache check (${hit.years} years): fresh ${a}, cached ${b}: ${a === b ? 'identical' : 'DIFFERENT'}`)
      }
      post({ type: 'history', requestId, history: hit.value, ms, extend: false, cached: true }, buffersOf(hit.value))
      return
    }
    const first = req.firstYears && req.firstYears < target ? req.firstYears : undefined
    await simulateAndPost(requestId, k, first, false)
  } catch (err) {
    post({ type: 'error', requestId, stage: 'history', message: errorMessage(err) })
  }
}

/** The history of a world posted with worldOnly (the start page's Start), with the options chosen there. */
async function historyFor(req: Extract<WorkerRequest, { type: 'history' }>) {
  if (!kept || kept.requestId !== req.requestId || !keptSeed) return // superseded by a newer world
  const historyOptions = canonicalOptions(req.historyOptions)
  const cache = await cacheReady
  const keys = cache ? cacheKeys(cache.version, keptSeed.seed, keptSeed.options, historyOptions) : null
  kept = { requestId: req.requestId, world: kept.world, historyOptions, run: null, keys }
  await historyOf(kept, req)
}

/** Re-simulate the kept world with new orders (a new resumable run from year 0), `years` long, from the cache when it has that run. */
async function reorder(req: Extract<WorkerRequest, { type: 'orders' }>) {
  if (req.requestId !== latestRequestId) return // superseded while queued
  if (!kept || !keptSeed) {
    post({ type: 'error', requestId: req.requestId, stage: 'history', message: 'no world to re-simulate' })
    return
  }
  const base: HistoryOptions = { ...(kept.historyOptions ?? {}) }
  delete base.orders
  if (req.cradles !== undefined) base.cradles = req.cradles
  const historyOptions = canonicalOptions({ ...base, orders: req.orders })
  const cache = await cacheReady
  const keys = cache ? cacheKeys(cache.version, keptSeed.seed, keptSeed.options, historyOptions) : null
  kept = { requestId: req.requestId, world: kept.world, historyOptions, run: null, keys }
  try {
    const t0 = performance.now()
    const hit = keys ? await cache!.getHistory<History>(keys, req.years) : null
    if (hit && hit.years === req.years) {
      console.info(`cache: ${hit.years}-year history with ${historyOptions?.orders?.length ?? 0} orders and ${historyOptions?.cradles?.length ?? 0} cradles read in ${(performance.now() - t0).toFixed(0)} ms`)
      post({ type: 'history', requestId: req.requestId, history: hit.value, ms: performance.now() - t0, extend: false, cached: true, replace: true }, buffersOf(hit.value))
      return
    }
    await simulateAndPost(req.requestId, kept, req.years, false, false, true)
  } catch (err) {
    post({ type: 'error', requestId: req.requestId, stage: 'history', message: errorMessage(err) })
  }
}

async function extend(req: Extract<WorkerRequest, { type: 'extend' }>) {
  const { requestId, years } = req
  if (!kept || kept.requestId !== requestId) return // superseded by a newer world
  try {
    if (req.fail) throw new Error('simulated extension failure (debug)')
    await simulateAndPost(requestId, kept, years, true, !req.full)
  } catch (err) {
    post({ type: 'error', requestId, stage: 'extend', message: errorMessage(err) })
  }
}

// ---------- seat mode (see the header) ----------

/** The seat's live run (null outside seat mode). */
let seatRun: { requestId: number; run: HistoryRun; historyOptions: HistoryOptions; lastPause: number } | null = null
/** Years played at most between two pauses without a decision (seat/params.ts SEAT.maxRun). */
const SEAT_MAX_RUN = 50
const SEAT_MAX_YEARS = 6000

async function seatStart(req: Extract<WorkerRequest, { type: 'seat' }>) {
  if (req.requestId !== latestRequestId) return
  if (!kept || !keptSeed || !createHistoryRun) {
    post({ type: 'error', requestId: req.requestId, stage: 'history', message: 'no world (or no resumable run) for seat mode' })
    return
  }
  const base: HistoryOptions = { ...(kept.historyOptions ?? {}) }
  delete base.orders
  delete base.seat
  delete base.years
  if (req.cradles !== undefined) base.cradles = req.cradles
  const historyOptions = canonicalOptions({ ...base, orders: req.orders }) ?? {}
  historyOptions.seat = { kind: req.seat.kind, id: Math.floor(req.seat.id), from: Math.max(0, Math.floor(req.seat.from)), ...(req.seat.ambitions && req.seat.ambitions.length > 0 ? { ambitions: req.seat.ambitions.slice() } : {}) }
  try {
    const run = createHistoryRun(kept.world, historyOptions)
    const orders = historyOptions.orders ?? []
    let replay = historyOptions.seat.from
    for (const o of orders) replay = Math.max(replay, Math.floor(o.year) - 1)
    replay = Math.min(SEAT_MAX_YEARS, replay)
    seatRun = { requestId: req.requestId, run, historyOptions, lastPause: replay }
    while (run.year < replay) {
      if (req.requestId !== latestRequestId) return
      const t0 = performance.now()
      run.simulateTo!(Math.min(replay, run.year + PROGRESS_CHUNK_YEARS))
      lastChunkMs = performance.now() - t0
      post({ type: 'progress', requestId: req.requestId, years: run.year, target: replay })
      await breathe()
    }
    seatPlay(req.requestId)
  } catch (err) {
    seatRun = null
    post({ type: 'error', requestId: req.requestId, stage: 'history', message: errorMessage(err) })
  }
}

/** Plays the seat's run to the next pause and posts it. */
function seatPlay(requestId: number) {
  const sr = seatRun!
  const t0 = performance.now()
  const y = sr.run.playSeat!(Math.min(SEAT_MAX_YEARS, sr.run.year + SEAT_MAX_RUN))
  const history = sr.run.advanceTo(y)
  const ms = performance.now() - t0
  const S = history.seat
  const cards: number[] = []
  if (S) for (let d = 0; d < S.decisions.count; d++) if (S.decisions.year[d] === y) cards.push(d)
  const lost = S ? S.lostYear >= 0 : true
  sr.lastPause = y
  post({ type: 'seatPause', requestId, history, ms, cards, lost: lost || y >= SEAT_MAX_YEARS }, transferList(history))
}

function seatChoose(req: Extract<WorkerRequest, { type: 'seatChoose' }>) {
  const sr = seatRun
  if (!sr || req.requestId !== latestRequestId) return
  try {
    const add = decodeOrders(encodeOrders(req.orders))
    if (add.length > 0) {
      sr.run.addOrders!(add)
      sr.historyOptions = { ...sr.historyOptions, orders: [...(sr.historyOptions.orders ?? []), ...add] }
    }
    sr.requestId = req.requestId
    seatPlay(req.requestId)
  } catch (err) {
    post({ type: 'error', requestId: req.requestId, stage: 'history', message: errorMessage(err) })
  }
}

async function seatStop(req: Extract<WorkerRequest, { type: 'seatStop' }>) {
  const sr = seatRun
  if (!sr || !kept || !keptSeed || req.requestId !== latestRequestId) return
  seatRun = null
  const cache = await cacheReady
  const keys = cache ? cacheKeys(cache.version, keptSeed.seed, keptSeed.options, sr.historyOptions) : null
  kept = { requestId: req.requestId, world: kept.world, historyOptions: sr.historyOptions, run: sr.run, keys }
  try {
    await simulateAndPost(req.requestId, kept, Math.max(req.years, sr.run.year), false, false, true)
  } catch (err) {
    post({ type: 'error', requestId: req.requestId, stage: 'history', message: errorMessage(err) })
  }
}

let queue: Promise<void> = Promise.resolve()
self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  if (req.type === 'throttle') hidden = req.hidden
  else {
    if (req.type !== 'extend' && req.type !== 'history') latestRequestId = req.requestId
    if (req.type === 'generate' || req.type === 'history' || req.type === 'orders') seatRun = null // (a new world or run leaves seat mode)
    queue = queue.then(() => (req.type === 'extend' ? extend(req) : req.type === 'orders' ? reorder(req) : req.type === 'history' ? historyFor(req) : req.type === 'seat' ? seatStart(req) : req.type === 'seatChoose' ? seatChoose(req) : req.type === 'seatStop' ? seatStop(req) : generate(req)))
  }
}
