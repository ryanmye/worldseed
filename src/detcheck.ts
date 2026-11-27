// detcheck=1 (debugging, lane/detmath2): a worker of its own simulates the page's seed with the page's history options at
// 2000 years from scratch and posts G0's hashBase and the full hashValue, so a phone without a console can be compared with
// Node (scripts/g0.ts) or with another browser: every engine must give the same pair (src/sim/detMath.ts).
import type { HistoryOptions, WorldOptions } from './contract.ts'
import { hashBase } from './hashBase.ts'
import { hashValue } from './historyCache.ts'
import { generateWorld, simulateHistory } from './sim/index.ts'

export type DetcheckRequest = { seed: number; world: WorldOptions; options: HistoryOptions }
export type DetcheckResponse = { hashBase: string; hashValue: string; ms: number } | { error: string }

self.onmessage = (ev: MessageEvent<DetcheckRequest>) => {
  const { seed, world, options } = ev.data
  try {
    const t0 = performance.now()
    const h = simulateHistory(generateWorld(seed, world), { ...options, years: 2000 })
    self.postMessage({ hashBase: hashBase(h), hashValue: hashValue(h), ms: Math.round(performance.now() - t0) } satisfies DetcheckResponse)
  } catch (e) {
    self.postMessage({ error: String(e) } satisfies DetcheckResponse)
  }
}
