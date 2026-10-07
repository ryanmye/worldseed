// Trade routes that change their way round danger (History.trade.repath*, polities): the chronicle's lines for them, one per
// decade ("Merchants from Rilko to Fanfin now go round by way of Osu"; "... take their old way again"), and the way a route
// follows at a year for the inspector and the danger lines (tradeDangerFormat.ts). There is no event for a re-path: everything
// here comes from the re-path table alone. Every function tolerates a history without it (no re-paths: nothing to say).

import { routePathAt, type History } from '../contract.ts'
import { settlementName } from './format.ts'

interface RepathInfo {
  /** Per re-path k: 1 when route repathRoute[k] went back to the way it opened along. */
  back: Uint8Array
  /** Per re-path k: the town the new way passes that the way before it did not (the largest living at the year), or -1. */
  via: Int32Array
  /** Per re-path k: 1 when the new way crosses water and the one before did not, 2 the reverse, else 0. */
  sea: Uint8Array
}

const cache = new WeakMap<History, RepathInfo | null>()

const isWater = (h: History, c: number) => (h.capacity[c] ?? 1) <= 0

/** The re-paths of a history, worked out once, or null without any. */
function repathsOf(h: History): RepathInfo | null {
  if (cache.has(h)) return cache.get(h) ?? null
  const T = (h as Partial<History>).trade
  const n = T?.repathCount ?? 0
  let info: RepathInfo | null = null
  if (T && n > 0 && T.repathRoute && T.repathOffsets && T.repathPath) {
    const N = h.settlements.length
    const townsAt = new Map<number, number[]>()
    for (let i = 0; i < N; i++) {
      const c = h.settlements[i].cell
      const l = townsAt.get(c)
      if (l) l.push(i)
      else townsAt.set(c, [i])
    }
    const back = new Uint8Array(n), via = new Int32Array(n).fill(-1), sea = new Uint8Array(n)
    const S = h.snapshotCount
    for (let k = 0; k < n; k++) {
      const r = T.repathRoute[k], y = T.repathYear[k]
      // the way before (the route's way the year before) and the new one
      const prev = routePathAt(T, r, y - 1)
      const a = T.repathOffsets[k], b = T.repathOffsets[k + 1]
      const p0 = T.pathOffsets[r], p1 = T.pathOffsets[r + 1]
      let same = b - a === p1 - p0
      for (let q = 0; same && q < b - a; q++) if (T.repathPath[a + q] !== T.path[p0 + q]) same = false
      back[k] = same ? 1 : 0
      const old = new Set<number>()
      let oldWet = false, newWet = false
      for (let q = prev.from; q < prev.to; q++) {
        old.add(prev.arr[q])
        if (q > prev.from && q + 1 < prev.to && isWater(h, prev.arr[q])) oldWet = true
      }
      const s = Math.max(0, Math.min(S - 1, Math.round(y / h.snapshotInterval)))
      let best = -1, bestPop = 0
      for (let q = a + 1; q + 1 < b; q++) {
        const c = T.repathPath[q]
        if (isWater(h, c)) newWet = true
        if (old.has(c)) continue
        for (const i of townsAt.get(c) ?? []) {
          if (i === T.a[r] || i === T.b[r]) continue
          const st = h.settlements[i]
          if (st.foundedYear > y || (st.abandonedYear >= 0 && st.abandonedYear <= y)) continue
          const pop = h.population[s * N + i] ?? 0
          if (pop > bestPop) {
            bestPop = pop
            best = i
          }
        }
      }
      via[k] = best
      sea[k] = newWet && !oldWet ? 1 : oldWet && !newWet ? 2 : 0
    }
    info = { back, via, sea }
  }
  cache.set(h, info)
  return info
}

/** The re-path in force for route r at `year` (its last at or before it), or -1 (the way it opened along, never re-pathed by then). */
export function repathAt(h: History, r: number, year: number): number {
  const T = (h as Partial<History>).trade
  const n = T?.repathCount ?? 0
  let k = -1
  for (let i = 0; i < n && T!.repathYear[i] <= year; i++) if (T!.repathRoute[i] === r) k = i
  return k
}

/** How re-path k's way goes, after "now go": "round by way of Osu", "round by sea", "round overland", "round the danger by another way" (or "" when it went back). */
function wayWords(h: History, info: RepathInfo, k: number): string {
  if (info.back[k]) return ''
  const v = info.via[k]
  if (v >= 0) return `round by way of ${settlementName(h, v)}`
  return info.sea[k] === 1 ? 'round by sea' : info.sea[k] === 2 ? 'round overland' : 'round the danger by another way'
}

/**
 * When route r follows a way round danger at `year` (not the way it opened along), how: "round by way of Osu" (as for the
 * re-path in force), else ''. For the danger lines and the inspector.
 */
export function goesRoundAt(h: History, r: number, year: number): string {
  const info = repathsOf(h)
  if (!info) return ''
  const k = repathAt(h, r, year)
  return k >= 0 ? wayWords(h, info, k) : ''
}

/** "Merchants from Rilko to Fanfin now go round by way of Osu"; "Merchants from Rilko to Fanfin take their old way again". */
export function describeRepath(h: History, k: number): string {
  const T = h.trade
  const r = T.repathRoute[k]
  const pair = `${settlementName(h, T.a[r])} to ${settlementName(h, T.b[r])}`
  const info = repathsOf(h)
  if (!info || info.back[k]) return `Merchants from ${pair} take their old way again`
  return `Merchants from ${pair} now go ${wayWords(h, info, k)}`
}

/**
 * Chronicle line for the re-paths of one decade (rows `rows` of the re-path table, in order): one says it alone; several
 * name the first ("Merchants change their way round danger on 3 routes, among them Rilko to Fanfin, now round by way of Osu").
 */
export function describeRepathGroup(h: History, rows: readonly number[]): string {
  if (rows.length === 1) return describeRepath(h, rows[0])
  const T = h.trade
  const info = repathsOf(h)
  let out = 0, back = 0
  for (const k of rows) if (info?.back[k]) back++
  else out++
  const k0 = rows[0], r = T.repathRoute[k0]
  const pair = `${settlementName(h, T.a[r])} to ${settlementName(h, T.b[r])}`
  const w = info && !info.back[k0] ? wayWords(h, info, k0).replace('round the danger by', 'by') : ''
  const how = w ? `, now ${w}` : out ? ', back on its old way' : ''
  const what = out && back ? `go round danger or back to their old ways on ${rows.length} routes` : out ? `go round danger on ${out} routes` : `take their old ways again on ${back} routes`
  return `Merchants ${what}, among them ${pair}${how}`
}

/** The settlement a re-path's chronicle line selects: the route's first end. */
export function repathTarget(h: History, k: number): number {
  return h.trade.a[h.trade.repathRoute[k]]
}
