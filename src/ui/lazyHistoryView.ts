// onboarding (EVALUATION §4 Lane 4, bundle split): the history view (every panel, layer, the story director, sagas...)
// is most of the app's code, and the start page needs none of it. main.ts gets this stand-in at once: the module is
// fetched in the background (a separate chunk), built with the same deps when it arrives, and every call made meanwhile
// is replayed on it in order. Before then, readers get neutral answers (no history: 0 years, nothing picked).

import type { HistoryView, HistoryViewDeps, InitialHistoryState } from './historyView.ts'

/** Answers before the real view exists (methods returning something; the rest are queued). */
const BEFORE: Partial<Record<keyof HistoryView, unknown>> = {
  years: 0,
  year: 0,
  lastSwap: null,
  pickAt: () => -1,
  placesAt: () => '',
  isPlaying: () => false,
  isCellHidden: () => false,
  pickCell: () => false,
  debug: () => ({ history: null, index: null, journeys: null }),
}

export interface LazyHistoryView {
  readonly view: HistoryView
  /** Resolves once the real view is built (and the calls made meanwhile have been replayed). */
  readonly ready: Promise<HistoryView>
}

export function lazyHistoryView(deps: HistoryViewDeps, initial: InitialHistoryState, onError?: (err: unknown) => void): LazyHistoryView {
  let real: HistoryView | null = null
  const queue: [keyof HistoryView, unknown[]][] = []
  const view = new Proxy({} as HistoryView, {
    get(_t, key) {
      const k = key as keyof HistoryView
      if (real) {
        const v = real[k] as unknown
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(real) : v
      }
      if (k in BEFORE) return BEFORE[k]
      return (...args: unknown[]) => {
        queue.push([k, args])
      }
    },
  })
  const ready = import('./historyView.ts').then((m) => {
    const v = m.createHistoryView(deps, initial)
    real = v
    // (in order; a call these make goes straight to the view)
    for (const [k, args] of queue.splice(0)) (v[k] as (...a: unknown[]) => unknown)(...args)
    deps.wake()
    return v
  })
  ready.catch((err) => {
    console.error('history view failed to load', err)
    onError?.(err)
  })
  return { view, ready }
}
