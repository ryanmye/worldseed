// What-if (experience-whatif-director-sagas §1.7): the skeleton of a History for the lite memory tier (phones, weak
// devices): a shallow copy keeping what the comparison, the polity layer of the swipe globe and the whatif saga read
// (events, settlements, population, polity membership, territory and claims, wars, bonds, rulers, faiths, epidemics,
// orders, and every small table), with every other large per-cell or per-snapshot array (land use, roads, crops, food,
// wealth, prices, trade volumes, knowledge, technology, danger, ...) replaced by an empty array of the same type. About a
// quarter of a full History. A skeleton is never handed to historyView: only politiesOf, rulersOf, faithsOf, the saga
// Ctx, buildPolityLayer and the whatif saga see it (whatif skeleton test). DOM-free (the worker builds it).

import type { History } from '../contract.ts'

/** Top-level typed arrays a skeleton keeps whatever their size. */
export const SKELETON_KEEP: ReadonlySet<string> = new Set([
  'population', 'polity', 'landCells', 'territory', 'claimed', 'capacity', 'reignOffsets', 'reignIds', 'successionWars',
  'faith', 'faithShare', 'stateFaith', 'holyWars', 'cradleWish', 'cradleCell', 'cradlePlaced', 'cradleCrowded', 'weatherRegion',
])
/** Other top-level typed arrays are kept only below this size (bytes): the small per-polity and per-people tables. */
export const SKELETON_SMALL = 256 * 1024

type AnyView = ArrayBufferView & { constructor: new (n: number) => ArrayBufferView }

/** The skeleton of `h` (shares its kept arrays: transfer one or the other, not both). */
export function skeletonOf(h: History): History {
  const out: Record<string, unknown> = { ...(h as unknown as Record<string, unknown>) }
  for (const [k, v] of Object.entries(out)) {
    if (!ArrayBuffer.isView(v) || SKELETON_KEEP.has(k) || v.byteLength < SKELETON_SMALL) continue
    out[k] = new (v as AnyView).constructor(0)
  }
  out.skeleton = true
  return out as unknown as History
}

/** Whether a History is a skeleton (skeletonOf). */
export const isSkeleton = (h: History): boolean => (h as unknown as { skeleton?: boolean }).skeleton === true

/** Bytes of a History's top-level typed arrays (for the memory report). */
export function topLevelBytes(h: History): number {
  let b = 0
  for (const v of Object.values(h as unknown as Record<string, unknown>)) if (ArrayBuffer.isView(v)) b += v.byteLength
  return b
}
