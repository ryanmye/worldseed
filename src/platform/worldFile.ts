// The `.worldseed` world file, link form (format 1): a run's address parameters (seed=, years=, o=, c=, ... exactly
// what main.ts reads), so a file opens the same world and history the link does. DOM-free. Not wired to a
// button yet: platform.files.exportFile / importFile move it (index.ts).
//
// The world-saving plan (plans/world-builder-divine.md §4.5) puts a full SaveRecipe under `recipe`; a file with
// `link` instead is this earlier form, which that importer can read with urlToRecipe.

export const WORLD_FILE_EXTENSION = 'worldseed'
export const WORLD_FILE_MIME = 'application/json'

export interface WorldFileLink {
  worldseed: 1
  /** The address query, '?seed=…&o=…' ('' for the defaults). */
  link: string
  /** A readable name for the file. */
  name: string
  /** ms since epoch. */
  created: number
}

/** Parameters that only steer the page, not the run: left out of a file. */
const VIEW_ONLY = new Set(['intro', 'perf', 'nocache', 'cachecheck'])

/** The world file of the run at `search` (location.search). */
export function worldFileFor(search: string, now = Date.now()): { name: string; text: string } {
  const params = new URLSearchParams(search)
  for (const k of VIEW_ONLY) params.delete(k)
  const seed = params.get('seed')
  const query = params.toString()
  const name = seed ? `world-${seed.replace(/[^0-9a-zA-Z-]/g, '')}` : 'world'
  const file: WorldFileLink = { worldseed: 1, link: query ? `?${query}` : '', name, created: now }
  return { name: `${name}.${WORLD_FILE_EXTENSION}`, text: JSON.stringify(file, null, 2) + '\n' }
}

/** The address query a world file opens ('?…'), or an error message. Accepts only this file form. */
export function parseWorldFile(text: string): { link: string } | { error: string } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { error: 'This is not a worldseed file (not JSON).' }
  }
  if (typeof data !== 'object' || data === null) return { error: 'This is not a worldseed file.' }
  const d = data as Record<string, unknown>
  if (d.worldseed !== 1) return { error: 'This worldseed file is from a newer or unknown format.' }
  if ('recipe' in d && !('link' in d)) return { error: 'This save needs a newer worldseed.' }
  if (typeof d.link !== 'string' || (d.link !== '' && !d.link.startsWith('?'))) return { error: 'This worldseed file has no world in it.' }
  // only a query: no path, fragment or scheme can come in through a file
  const params = new URLSearchParams(d.link)
  for (const k of VIEW_ONLY) params.delete(k)
  const q = params.toString()
  return { link: q ? `?${q}` : '?intro=0' }
}
