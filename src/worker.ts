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

import type { CreateHistoryRun, History, HistoryOptions, HistoryRun, World, WorldOptions } from './contract.ts'
import * as sim from './sim/index.ts'

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
    }
  | {
      /** Simulate the world of request `requestId` again, `years` long. */
      type: 'extend'
      requestId: number
      years: number
      /** Debugging (perf=1 tools): fail as if the simulation had thrown. */
      fail?: boolean
    }

export type WorkerResponse =
  | { type: 'world'; requestId: number; world: World }
  | { type: 'history'; requestId: number; history: History; ms: number; extend: boolean }
  | { type: 'error'; requestId: number; stage: 'world' | 'history' | 'extend'; message: string }

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)
const errorMessage = (err: unknown) => (err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err))

/** The world of the latest generate request, kept to simulate longer runs on, with its resumable run (null before the first run, without createHistoryRun, or after a failure). */
interface Kept { requestId: number; world: World; historyOptions?: HistoryOptions; run: HistoryRun | null }
let kept: Kept | null = null

/** History `years` long (undefined: the requested default length) of the kept world: from its resumable run when there is one. */
function simulate(k: Kept, years: number | undefined): History {
  if (createHistoryRun && !k.run) k.run = createHistoryRun(k.world, k.historyOptions)
  if (!k.run) return simulateHistory(k.world, years === undefined ? k.historyOptions : { ...k.historyOptions, years })
  try {
    return k.run.advanceTo(years ?? k.historyOptions?.years ?? 2000)
  } catch (err) {
    k.run = null // its state is suspect: a later request starts from scratch
    throw err
  }
}

function simulateAndPost(requestId: number, k: Kept, years: number | undefined, extend: boolean) {
  const t0 = performance.now()
  const history = simulate(k, years)
  const ms = performance.now() - t0
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
  for (const k of ['polity', 'landCells', 'territory', 'danger', 'tariff', 'tariffRevenue', 'smuggleVolume', 'tradeLoss', 'contraband', 'piracy']) if (ArrayBuffer.isView(p[k]) && (p[k] as ArrayBufferView).byteLength > 0) extra.push(p[k] as ArrayBufferView)
  // goods: deposit output, tradition quality, industries, tools and arms, long-haul volumes, prices, marts, secret guards
  for (const k of ['depositOutput', 'traditionQuality', 'industry', 'metal', 'longHaulVolume', 'priceIndex', 'mart', 'secretGuard']) if (ArrayBuffer.isView(p[k]) && (p[k] as ArrayBufferView).byteLength > 0) extra.push(p[k] as ArrayBufferView)
  // rulers, religion: reigns per polity, marriages, unions, wars of succession; majority faith and its share per snapshot, state religions, holy wars
  for (const k of ['reignOffsets', 'reignIds', 'successionWars', 'faith', 'faithShare', 'stateFaith', 'holyWars']) if (ArrayBuffer.isView(p[k]) && (p[k] as ArrayBufferView).byteLength > 0) extra.push(p[k] as ArrayBufferView)
  for (const group of [partial.marriages, partial.unions] as unknown as (Record<string, unknown> | undefined)[]) if (group) for (const v of Object.values(group)) if (ArrayBuffer.isView(v) && v.byteLength > 0) extra.push(v)
  // disease: fever per cell, fever tolerance and endemic sickness per snapshot per people, outbreaks and quarantines
  for (const k of ['fever', 'feverTolerance', 'endemic']) if (ArrayBuffer.isView(p[k]) && (p[k] as ArrayBufferView).byteLength > 0) extra.push(p[k] as ArrayBufferView)
  for (const group of [partial.wars, partial.raids, partial.bonds, partial.embargoes, partial.longHaul, partial.secretHolds, partial.outbreaks, partial.quarantines] as unknown as (Record<string, unknown> | undefined)[]) {
    if (!group) continue
    for (const v of Object.values(group)) if (ArrayBuffer.isView(v) && v.byteLength > 0) extra.push(v)
  }
  for (const a of extra) if (a && ArrayBuffer.isView(a) && a.buffer instanceof ArrayBuffer && a.buffer.byteLength > 0) transfer.add(a.buffer)
  post({ type: 'history', requestId, history, ms, extend }, [...transfer])
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  if (req.type === 'extend') {
    const { requestId, years } = req
    if (!kept || kept.requestId !== requestId) return // superseded by a newer world
    try {
      if (req.fail) throw new Error('simulated extension failure (debug)')
      simulateAndPost(requestId, kept, years, true)
    } catch (err) {
      post({ type: 'error', requestId, stage: 'extend', message: errorMessage(err) })
    }
    return
  }
  const { requestId, seed, options, historyOptions } = req
  let world: World
  kept = null
  try {
    world = generateWorld(seed, options)
    post({ type: 'world', requestId, world }) // copied: the worker keeps `world`
  } catch (err) {
    post({ type: 'error', requestId, stage: 'world', message: errorMessage(err) })
    return
  }
  kept = { requestId, world, historyOptions, run: null }
  try {
    simulateAndPost(requestId, kept, undefined, false)
  } catch (err) {
    post({ type: 'error', requestId, stage: 'history', message: errorMessage(err) })
  }
}
