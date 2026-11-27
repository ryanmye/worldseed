// Onboarding policies without the DOM (ui/onboard.ts re-exports them; onboard.test.ts tests them in Node).

/** Whether Follow the story starts on, from the address (`follow=`) and whether this is a first visit. */
export function followByDefault(params: URLSearchParams, firstVisit: boolean): boolean {
  const f = params.get('follow')
  if (f === '1') return true
  if (f === '0') return false
  // links that open somewhere particular keep their own camera and pace
  for (const k of ['seat', 'cmp', 'fly', 'select', 'polity', 'year', 'lon', 'lat']) if (params.has(k)) return false
  return firstVisit
}

// ---------- the start page's play paths ----------

export const PlayPath = { Watch: 'watch', Explore: 'explore', Rule: 'rule' } as const
export type PlayPath = (typeof PlayPath)[keyof typeof PlayPath]

export interface PlayPathSpec {
  path: PlayPath
  label: string
  hint: string
  /** The page's main button (submitted by Enter in a field). */
  primary?: boolean
}

export const PLAY_PATHS: readonly PlayPathSpec[] = [
  { path: PlayPath.Watch, label: 'Watch history unfold', hint: 'The camera follows the great events: some seven minutes for 2,000 years', primary: true },
  { path: PlayPath.Rule, label: 'Rule a kingdom', hint: 'Take a throne and decide: heirs, wars, revolts' },
  { path: PlayPath.Explore, label: 'Explore freely', hint: 'Turn the globe yourself; history plays in the background' },
]

/**
 * Rule a kingdom: the seat link it opens (the throne lane replaces this with its curated seeds, realms and years).
 * Seed 61343's Kelurair from 700 reached its first card in 14.5 s on a phone viewport in the evaluation.
 */
export const THRONE_START = { seed: 61343, seat: 'polity:0:700' }

/** The address of the Rule a kingdom path (keeps `keep` parameters of the page, e.g. preset=). */
export function throneUrl(from: URL, keep: readonly string[] = ['preset', 'lang']): URL {
  const url = new URL(from.href)
  url.search = ''
  url.searchParams.set('seed', String(THRONE_START.seed))
  url.searchParams.set('seat', THRONE_START.seat)
  for (const k of keep) {
    const v = from.searchParams.get(k)
    if (v !== null) url.searchParams.set(k, v)
  }
  return url
}

