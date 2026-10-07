// religion: one cached index per history over the faith tables (History.faiths, faith, faithShare,
// stateFaith, holyWars) and the faith events (89-97), for the Faiths view and panel, the inspector's
// faith lines and the chronicle. Null when the history has no faiths (older histories, religion
// switched off): the UI then looks exactly as before.
//
// Colours: each universal faith a stable, distinct hue (by its order of founding), a schism a related
// hue of its parent (a little lighter or darker), each people's traditional practice a muted earth tone.

import { EventType, FaithKind, type Faith, type History } from '../contract.ts'

export interface FaithsData {
  history: History
  faiths: readonly Faith[]
  F: number
  /** Settlements, snapshots, years per snapshot. */
  N: number
  S: number
  interval: number
  /** Universal faiths (schisms included), in order of founding. */
  universal: number[]
  /** sRGB 0..1, 3 per faith, and CSS colours. */
  rgb: Float32Array
  css: string[]
  /**
   * Share of the world's people following each faith per snapshot, from the majority faith of each
   * place times its share (minorities are not recorded): worldShare[s * F + f], 0..1.
   */
  worldShare: Float32Array
  /** Living settlements whose majority follows each faith, per snapshot: places[s * F + f]. */
  places: Uint32Array
  /** Share of the world's people living in the places where each faith is the majority, per snapshot (worldShare's upper reach there): majorityPop[s * F + f], 0..1. */
  majorityPop: Float32Array
  /**
   * Whether the history records the majority's share in each place (some living place below 255): then worldShare counts the
   * followers there; else only that a faith is the majority, and the panel says in how many places instead of a share.
   */
  sharesKnown: boolean
  /** Faiths whose holy city each settlement is. */
  holyOf: Map<number, number[]>
  /** Schisms of each faith (ids, in order). */
  children: number[][]
  /** Faith events (89-97) per faith (as `value`; a holy war under its attacker's faith; a ruler converted under the faith left too), chronological. */
  eventsOf: number[][]
  /** Holy wars (war ids) declared in the name of each faith. */
  holyWarsOf: number[][]
  /** The faith of each holy war (war id), -1 unknown. */
  holyWarFaith: Map<number, number>
  /** Polities whose state religion each faith ever was (ids, first adoption order). */
  statesOf: number[][]
  /** Year each faith's holy city fell to unbelievers (the last such event up to the end: [year, ...] per faith). */
  holyFell: number[][]
  /** Largest worldShare of each faith over the run (for the sparklines' scale). */
  peakShare: Float32Array
}

const cache = new WeakMap<History, FaithsData | null>()

/** The faith index of `h` (built once per history), or null when it has none. */
export function faithsOf(h: History | null | undefined): FaithsData | null {
  if (!h) return null
  if (cache.has(h)) return cache.get(h) ?? null
  let fd: FaithsData | null = null
  try {
    fd = buildFaithsData(h)
  } catch (err) {
    console.warn('faiths: data unusable, hidden', err)
    fd = null
  }
  cache.set(h, fd)
  return fd
}

/** Root universal faiths' hues: distinct, none of them the greys and browns of folk practice. */
const UNIVERSAL_RGB: readonly (readonly [number, number, number])[] = [
  [232, 186, 64], // gold
  [70, 142, 222], // azure
  [214, 76, 76], // crimson
  [76, 186, 124], // emerald
  [160, 112, 222], // violet
  [236, 128, 52], // orange
  [52, 184, 188], // teal
  [222, 102, 168], // rose
  [168, 198, 64], // lime
  [104, 112, 228], // indigo
  [244, 222, 140], // pale gold
  [150, 214, 238], // sky
]

function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0), f(8), f(4)]
}
function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  if (mx === mn) return [0, 0, l]
  const d = mx - mn
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  h /= 6
  return [h, s, l]
}

function buildFaithsData(h: History): FaithsData | null {
  const p = h as Partial<History>
  const faiths = Array.isArray(p.faiths) ? p.faiths : []
  const N = h.settlements.length
  const S = h.snapshotCount
  if (!faiths.length || !(p.faith instanceof Uint8Array) || p.faith.length < S * N || !(p.faithShare instanceof Uint8Array) || p.faithShare.length < S * N) return null
  const F = faiths.length
  const universal = faiths.filter((f) => f.kind === FaithKind.Universal).map((f) => f.id)
  // colours
  const rgb = new Float32Array(F * 3)
  const children: number[][] = Array.from({ length: F }, () => [])
  for (const f of faiths) if (f.parent >= 0 && f.parent < F) children[f.parent].push(f.id)
  let roots = 0
  for (const f of faiths) {
    let c: [number, number, number]
    if (f.kind !== FaithKind.Universal) {
      // folk practice: a muted earth tone per people (umber to olive to slate, low saturation), so the universal faiths stand out
      const u = (f.people * 0.618034) % 1
      const hue = u < 0.75 ? 0.06 + u * 0.32 : 0.52 + (u - 0.75) * 0.4
      c = hsl2rgb(hue, 0.13 + 0.06 * ((f.people * 5) % 3) / 2, 0.36 + 0.07 * ((f.people * 7) % 3) / 2)
    } else if (f.parent < 0 || f.parent >= F) {
      const u = UNIVERSAL_RGB[roots++ % UNIVERSAL_RGB.length]
      c = [u[0] / 255, u[1] / 255, u[2] / 255]
    } else {
      // a schism: the parent's hue, turned a little and lighter or darker by its order among the parent's schisms
      const pr = rgb.subarray(f.parent * 3, f.parent * 3 + 3)
      const [ph, ps, pl] = rgb2hsl(pr[0], pr[1], pr[2])
      const k = children[f.parent].indexOf(f.id)
      const sign = k % 2 === 0 ? 1 : -1
      const step = 1 + Math.floor(k / 2)
      c = hsl2rgb((ph + sign * 0.045 * step + 1) % 1, Math.min(1, ps * 0.95), Math.max(0.3, Math.min(0.8, pl + sign * 0.13 * step)))
    }
    rgb[f.id * 3] = c[0]
    rgb[f.id * 3 + 1] = c[1]
    rgb[f.id * 3 + 2] = c[2]
  }
  const css = faiths.map((f) => `rgb(${Math.round(rgb[f.id * 3] * 255)}, ${Math.round(rgb[f.id * 3 + 1] * 255)}, ${Math.round(rgb[f.id * 3 + 2] * 255)})`)
  // followers per snapshot
  const worldShare = new Float32Array(S * F)
  const places = new Uint32Array(S * F)
  const majorityPop = new Float32Array(S * F)
  const accAll = new Float64Array(F)
  let sharesKnown = false
  const peakShare = new Float32Array(F)
  const out = new Uint8Array(N)
  for (let i = 0; i < N; i++) if ((h.settlements[i] as { outpost?: boolean }).outpost === true) out[i] = 1
  const acc = new Float64Array(F)
  for (let s = 0; s < S; s++) {
    acc.fill(0)
    accAll.fill(0)
    let total = 0
    const o = s * N
    for (let i = 0; i < N; i++) {
      const pop = h.population[o + i]
      if (!(pop > 0) || out[i]) continue
      total += pop
      const f = p.faith[o + i]
      if (f >= F) continue
      acc[f] += pop * (p.faithShare[o + i] / 255)
      accAll[f] += pop
      if (p.faithShare[o + i] < 255) sharesKnown = true
      places[s * F + f]++
    }
    if (total > 0) for (let f = 0; f < F; f++) {
      const v = acc[f] / total
      worldShare[s * F + f] = v
      majorityPop[s * F + f] = accAll[f] / total
      if (v > peakShare[f]) peakShare[f] = v
    }
  }
  const holyOf = new Map<number, number[]>()
  for (const f of faiths) {
    if (f.holyCity < 0) continue
    const a = holyOf.get(f.holyCity)
    if (a) a.push(f.id)
    else holyOf.set(f.holyCity, [f.id])
  }
  const eventsOf: number[][] = Array.from({ length: F }, () => [])
  const holyWarsOf: number[][] = Array.from({ length: F }, () => [])
  const holyWarFaith = new Map<number, number>()
  const holyFell: number[][] = Array.from({ length: F }, () => [])
  const ok = (f: number | undefined) => typeof f === 'number' && f >= 0 && f < F
  h.events.forEach((e, i) => {
    const t = e.type as number
    if (t < EventType.FaithFounded || t > EventType.FaithReached) return
    if (t === EventType.HolyWar) {
      const f = e.extra
      if (ok(f)) {
        eventsOf[f!].push(i)
        holyWarsOf[f!].push(e.value)
      }
      holyWarFaith.set(e.value, ok(f) ? f! : -1)
      return
    }
    if (ok(e.value)) eventsOf[e.value].push(i)
    if (t === EventType.RulerConverted && ok(e.extra) && e.extra !== e.value) eventsOf[e.extra!].push(i)
    if (t === EventType.HolyCityFell && ok(e.value)) holyFell[e.value].push(e.year)
  })
  // (events are in year order already; a ruler converted away is pushed in the same pass)
  // states that held each faith as their state religion (first adoption order)
  const statesOf: number[][] = Array.from({ length: F }, () => [])
  const SF = p.stateFaith
  const P = Array.isArray(p.polities) ? p.polities.length : 0
  if (SF instanceof Uint8Array && P > 0 && SF.length >= S * P) {
    const seen = new Set<number>()
    for (let s = 0; s < S; s++) {
      for (let q = 0; q < P; q++) {
        const v = SF[s * P + q]
        if (v === 0 || v > F) continue
        const k = (v - 1) * 65536 + q
        if (seen.has(k)) continue
        seen.add(k)
        statesOf[v - 1].push(q)
      }
    }
  }
  return { history: h, faiths, F, N, S, interval: h.snapshotInterval, universal, rgb, css, worldShare, places, majorityPop, sharesKnown, holyOf, children, eventsOf, holyWarsOf, holyWarFaith, statesOf, holyFell, peakShare }
}

/** Snapshot of a year. */
export const faithSnap = (fd: FaithsData, year: number) => Math.max(0, Math.min(fd.S - 1, Math.floor(year / Math.max(1, fd.interval))))

/** Majority faith of settlement `id` at snapshot s (-1 none, or not alive), and its share 0..1. */
export function faithAt(fd: FaithsData, id: number, s: number): number {
  if (id < 0 || id >= fd.N) return -1
  const f = fd.history.faith[s * fd.N + id]
  return f < fd.F ? f : -1
}
export const faithShareAt = (fd: FaithsData, id: number, s: number) => (id >= 0 && id < fd.N ? fd.history.faithShare[s * fd.N + id] / 255 : 0)

/** State religion of polity q at snapshot s (a faith id, -1 none). */
export function stateFaithAt(fd: FaithsData, q: number, s: number): number {
  const SF = fd.history.stateFaith
  const P = fd.history.polities?.length ?? 0
  if (!SF || q < 0 || q >= P || SF.length < (s + 1) * P) return -1
  const v = SF[s * P + q]
  return v > 0 && v <= fd.F ? v - 1 : -1
}

/** Whether faith f exists at `year` (founded, not yet died out). */
export const faithLives = (fd: FaithsData, f: number, year: number) => {
  const x = fd.faiths[f]
  return !!x && year >= x.foundedYear && (x.endedYear < 0 || year < x.endedYear)
}

/** "the Unlafa faith"; a traditional one "the old Lurakufa ways" when `plain` is false. */
export function faithName(fd: FaithsData, f: number, plain = true): string {
  const x = fd.faiths[f]
  if (!x) return 'another faith'
  return x.kind === FaithKind.Universal || plain ? `the ${x.name} faith` : `the old ${x.name} ways`
}

/** "Unlafa" (its proper name), '' unknown. */
export const faithWord = (fd: FaithsData, f: number) => fd.faiths[f]?.name ?? ''
