// Onboarding policies without the DOM (ui/onboard.ts re-exports them; onboard.test.ts tests them in Node).

/** Whether Follow the story starts on, from the address (`follow=`) and whether this is a first visit. */
export function followByDefault(params: URLSearchParams, firstVisit: boolean): boolean {
  const f = params.get('follow')
  if (f === '1' || f?.startsWith('realm:')) return true // (lane N4d: follow=realm:<id> follows one realm)
  if (f === '0') return false
  // links that open somewhere particular keep their own camera and pace
  for (const k of ['seat', 'cmp', 'fly', 'select', 'polity', 'year', 'lon', 'lat']) if (params.has(k)) return false
  return firstVisit
}

// ---------- the start page's play paths ----------

export const PlayPath = { Watch: 'watch', Explore: 'explore', Rule: 'rule', /** lane N3: the second curated throne */ Old: 'old', /** lane N4d: Watch, following one realm */ Realm: 'realm' } as const
export type PlayPath = (typeof PlayPath)[keyof typeof PlayPath]

export interface PlayPathSpec {
  path: PlayPath
  label: string
  hint: string
  /** The page's main button (submitted by Enter in a field). */
  primary?: boolean
  /** lane N4d: a smaller second choice under the button ("or follow one realm"). */
  alt?: { path: PlayPath; label: string; hint: string }
}

export const PLAY_PATHS: readonly PlayPathSpec[] = [
  { path: PlayPath.Watch, label: 'Watch history unfold', hint: 'The camera follows the great events: some seven minutes for 2,000 years', primary: true, alt: { path: PlayPath.Realm, label: 'or follow one realm', hint: 'The camera stays with one realm, the greatest of this world: its rulers, towns, battles and troubles, the small events too' } },
  { path: PlayPath.Rule, label: 'Rule a kingdom', hint: 'Take a throne and decide: heirs, wars, revolts' },
  { path: PlayPath.Old, label: 'Keep an old great power alive', hint: 'A realm of five centuries, its overlord ready to swallow it whole: can you save it?' },
  { path: PlayPath.Explore, label: 'Explore freely', hint: 'Turn the globe yourself; history plays in the background' },
]

/**
 * Rule a kingdom: the seat link it opens (the throne lane replaces this with its curated seeds, realms and years).
 * Seed 61343's Kelurair from 700 reached its first card in 14.5 s on a phone viewport in the evaluation.
 */
export const THRONE_START = { seed: 61343, seat: 'polity:0:700' }
/**
 * lane N3: "Keep an old great power alive" (ui-additions, owner-approved). lane N3b: seed 1's Uhulaun from 1080 (Dramatic),
 * founded in 510, a vassal of Glakul whose overlord could take it whole within a few years (the looming Overlord card is its
 * first card). Seed 7's Thotakor from 995 (lane N3) was lost to the N5 battles merge: in the Dramatic history it is conquered
 * in 981, so that seat was dead at its year (0 cards). The bots (runs/n3b/oldcand): cautious and greedy survive 300 years 4
 * of 7, random 2 of 4, a court left to decide (always-defer) falls in 85 years. n3b.test.ts checks the seat is alive at its
 * year with its first card, so a merge that changes the Dramatic history fails there first.
 */
export const OLD_POWER_START = { seed: 1, seat: 'polity:1:1080' }

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

