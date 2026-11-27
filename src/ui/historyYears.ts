// History lengths (onboarding: split out of historyIndex.ts and historyView.ts so the start page's bundle need not load
// those modules just for these numbers; both re-export them).

/** Histories grow in chunks of this many years. */
export const HISTORY_CHUNK_YEARS = 500
export const MAX_YEARS = 6000
/** Length of a history `years` long extended once (the next chunk boundary), capped. */
export const nextHistoryLength = (years: number) => Math.min(MAX_YEARS, (Math.floor(years / HISTORY_CHUNK_YEARS + 1e-9) + 1) * HISTORY_CHUNK_YEARS)
