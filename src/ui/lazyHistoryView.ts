// onboarding (EVALUATION §4 Lane 4, bundle split): the history view (every panel, layer, the story director, sagas...)
// is most of the app's code, and the start page needs none of it. main.ts gets this stand-in at once (ui/lazy.ts): the
// module is fetched in the background, built with the same deps when it arrives, and the calls made meanwhile are
// replayed on it in order. Before then, readers get neutral answers (no history: 0 years, nothing picked).

import type { HistoryView, HistoryViewDeps, InitialHistoryState } from './historyView.ts'
import { lazyObject, type Lazy } from './lazy.ts'

/** Answers before the real view exists (members returning something; the rest are queued). */
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

/** `after`: a promise to wait for before fetching (the start page: its first frames are drawn first). */
export function lazyHistoryView(deps: HistoryViewDeps, initial: InitialHistoryState, after: Promise<unknown> = Promise.resolve()): Lazy<HistoryView> {
  return lazyObject(
    () =>
      after.then(() => import('./historyView.ts')).then((m) => {
        const v = m.createHistoryView(deps, initial)
        queueMicrotask(() => deps.wake())
        return v
      }),
    BEFORE,
    'history view',
  )
}
