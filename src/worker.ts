// Web worker: generates a World off the main thread, posts it back so the
// globe can appear immediately, then simulates its settlement history and
// posts that as a second message.
//
// The world is posted as a structured-clone copy (~2 MB at the default
// resolution, about a millisecond) so the worker keeps the original to
// simulate on; the history's large typed arrays are transferred, not copied.

import type { History, HistoryOptions, World, WorldOptions } from './contract.ts'
import { generateWorld } from './sim/index.ts'
// HISTORY SOURCE: dev stand-in. Swap to `from './sim/index.ts'` once the real simulation lands.
import { simulateHistory } from './sim/index.ts'

export interface WorkerRequest {
  /** Echoed in every response so the UI can drop results for superseded requests. */
  requestId: number
  seed: number
  options?: WorldOptions
  historyOptions?: HistoryOptions
}

export type WorkerResponse =
  | { type: 'world'; requestId: number; world: World }
  | { type: 'history'; requestId: number; history: History; ms: number }
  | { type: 'error'; requestId: number; stage: 'world' | 'history'; message: string }

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)
const errorMessage = (err: unknown) => (err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err))

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { requestId, seed, options, historyOptions } = ev.data
  let world: World
  try {
    world = generateWorld(seed, options)
    post({ type: 'world', requestId, world }) // copied: the worker keeps `world`
  } catch (err) {
    post({ type: 'error', requestId, stage: 'world', message: errorMessage(err) })
    return
  }
  try {
    const t0 = performance.now()
    const history = simulateHistory(world, historyOptions)
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
    for (const a of extra) if (a && ArrayBuffer.isView(a) && a.buffer instanceof ArrayBuffer && a.buffer.byteLength > 0) transfer.add(a.buffer)
    post({ type: 'history', requestId, history, ms }, [...transfer])
  } catch (err) {
    post({ type: 'error', requestId, stage: 'history', message: errorMessage(err) })
  }
}
