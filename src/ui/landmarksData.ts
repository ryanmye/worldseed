// landmarks: the tables behind the landmarks in the UI and the dioramas (History.landmarks), built once per history.
//
// Per settlement its landmarks in the order they were begun; per landmark its number among the town's landmarks of its
// kind (the plan places it by kind and number: town.ts landmark), and its life as spans of one state each, from its begun
// year to the end of time (a landmark is never removed). A history without landmarks (older histories, landmarks: false)
// gives null, and every caller then draws and says what it did before.

import { LandmarkState, type History, type Landmarks } from '../contract.ts'

/** Far future: the last span of every landmark runs to it. */
export const LANDMARK_NEVER = 1e9

export interface LandmarksData {
  L: Landmarks
  /** Landmark ids by settlement, in begun order (only settlements with landmarks). */
  bySettlement: Map<number, number[]>
  /** Per landmark: its number among its town's landmarks of the same kind (0 the first). */
  ord: Int32Array
  /** Per landmark: its spans spanOff[i] .. spanOff[i + 1] of the span columns. */
  spanOff: Int32Array
  spanFrom: Float64Array
  spanTo: Float64Array
  spanState: Uint8Array
  /** The faith it serves through the span (after conversions), -1. */
  spanFaith: Int16Array
}

const cache = new WeakMap<History, LandmarksData | null>()

/** The landmarks of a history, or null when it has none. */
export function landmarksOf(h: History | null | undefined): LandmarksData | null {
  if (!h) return null
  if (cache.has(h)) return cache.get(h) ?? null
  let d: LandmarksData | null = null
  try {
    d = build(h)
  } catch (err) {
    console.warn('landmarks: data unusable, hidden', err)
  }
  cache.set(h, d)
  return d
}

function build(h: History): LandmarksData | null {
  const L = (h as Partial<History>).landmarks
  if (!L || !(L.count > 0) || !L.settlement || !L.changeLandmark) return null
  const n = L.count
  const bySettlement = new Map<number, number[]>()
  const ord = new Int32Array(n)
  const seen = new Map<number, number>()
  for (let i = 0; i < n; i++) {
    const v = L.settlement[i]
    let list = bySettlement.get(v)
    if (!list) bySettlement.set(v, (list = []))
    list.push(i)
    const key = v * 64 + L.kind[i]
    const k = seen.get(key) ?? 0
    ord[i] = k
    seen.set(key, k + 1)
  }
  // the changes of each landmark, in order
  const count = new Int32Array(n)
  for (let k = 0; k < L.changeCount; k++) count[L.changeLandmark[k]]++
  const spanOff = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) spanOff[i + 1] = spanOff[i] + count[i] + 1
  const S = spanOff[n]
  const spanFrom = new Float64Array(S), spanTo = new Float64Array(S).fill(LANDMARK_NEVER), spanState = new Uint8Array(S), spanFaith = new Int16Array(S)
  const at = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const o = spanOff[i]
    spanFrom[o] = L.begunYear[i]
    spanState[o] = LandmarkState.Building
    spanFaith[o] = L.faith[i]
  }
  for (let k = 0; k < L.changeCount; k++) {
    const i = L.changeLandmark[k]
    const o = spanOff[i] + ++at[i]
    spanTo[o - 1] = L.changeYear[k]
    spanFrom[o] = L.changeYear[k]
    spanState[o] = L.changeState[k]
    spanFaith[o] = L.changeFaith[k] >= 0 ? L.changeFaith[k] : spanFaith[o - 1]
  }
  return { L, bySettlement, ord, spanOff, spanFrom, spanTo, spanState, spanFaith }
}

/** The kinds of settlement id's landmarks, in begun order (for the town plan's room). */
export function landmarkKindsOf(d: LandmarksData | null, id: number): number[] {
  const list = d?.bySettlement.get(id)
  return list ? list.map((i) => d!.L.kind[i]) : []
}

/** Index of the span of landmark i in force at year y (its last with from <= y), or -1 before it was begun. */
export function landmarkSpanAt(d: LandmarksData, i: number, y: number): number {
  let s = -1
  for (let o = d.spanOff[i]; o < d.spanOff[i + 1] && d.spanFrom[o] <= y; o++) s = o
  return s
}

/** Whether a landmark in a state stands in use (finished, restored, rededicated). */
export const landmarkInUse = (state: number) => state === LandmarkState.InUse || state === LandmarkState.Restored || state === LandmarkState.Converted
/** Whether a landmark in a state is a ruin (ruined, or given up unfinished). */
export const landmarkRuined = (state: number) => state === LandmarkState.Ruined || state === LandmarkState.Unfinished
