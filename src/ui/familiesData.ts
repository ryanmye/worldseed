// families: indexes over History.families for the panel, the inspector, the chronicle and the sagas (merchant-families.md §4).
// Every function tolerates a history without families (familiesOf returns null).

import { FamilySeatKind, HeadHow, type History } from '../contract.ts'
import { settlementName } from './format.ts'

export interface FamilyData {
  history: History
  /** Seats of each family, by seat id. */
  seatsOf: number[][]
  /** Seats ever at each town. */
  seatsAt: Map<number, number[]>
  /** Heads of each family, in order of accession. */
  headsOf: number[][]
  /** History.events indexes of each family's events (161-169), in order. */
  eventsOf: number[][]
  lanesOf: number[][]
  marriagesOf: number[][]
  backsOf: number[][]
  patronsOf: number[][]
  /** The family's colour (sRGB 0..1) and CSS. */
  rgb: [number, number, number][]
  css: string[]
}

const cache = new WeakMap<History, FamilyData | null>()

function hue(f: number): [number, number, number] {
  // golden-angle hues, fairly bright (the polities' style: distinct neighbours)
  const h = ((f * 137.508 + 31) % 360) / 360, s = 0.62, l = 0.6
  const k = (n: number) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const c = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [c(0), c(8), c(4)]
}

/** The families' indexes (null without families). */
export function familiesOf(h: History): FamilyData | null {
  const got = cache.get(h)
  if (got !== undefined) return got
  const F = (h as Partial<History>).families
  if (!F || F.count === 0) { cache.set(h, null); return null }
  const n = F.count
  const mk = () => Array.from({ length: n }, () => [] as number[])
  const d: FamilyData = { history: h, seatsOf: mk(), seatsAt: new Map(), headsOf: mk(), eventsOf: mk(), lanesOf: mk(), marriagesOf: mk(), backsOf: mk(), patronsOf: mk(), rgb: [], css: [] }
  for (let k = 0; k < F.seatCount; k++) {
    d.seatsOf[F.seatFamily[k]].push(k)
    const t = F.seatTown[k]
    const a = d.seatsAt.get(t)
    if (a) a.push(k)
    else d.seatsAt.set(t, [k])
  }
  for (let k = 0; k < F.headCount; k++) d.headsOf[F.headFamily[k]].push(k)
  for (let k = 0; k < F.laneCount; k++) d.lanesOf[F.laneFamily[k]].push(k)
  for (let k = 0; k < F.marriageCount; k++) d.marriagesOf[F.marriageFamily[k]].push(k)
  for (let k = 0; k < F.backCount; k++) d.backsOf[F.backFamily[k]].push(k)
  for (let k = 0; k < F.patronCount; k++) d.patronsOf[F.patronFamily[k]].push(k)
  h.events.forEach((e, i) => { if ((e.type as number) >= 161 && (e.type as number) <= 169 && e.value >= 0 && e.value < n) d.eventsOf[e.value].push(i) })
  for (let f = 0; f < n; f++) {
    const c = hue(f)
    d.rgb.push(c)
    d.css.push(`rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`)
  }
  cache.set(h, d)
  return d
}

/** True when family f trades at year y. */
export function familyLives(fd: FamilyData, f: number, y: number): boolean {
  const F = fd.history.families
  return F.founded[f] <= y && (F.ended[f] < 0 || F.ended[f] > y)
}

/** Its home at year y (the open Home seat; the first home before it was founded). */
export function familyHomeAt(fd: FamilyData, f: number, y: number): number {
  const F = fd.history.families
  let home = F.firstHome[f]
  for (const k of fd.seatsOf[f]) if (F.seatKind[k] === FamilySeatKind.Home && F.seatFrom[k] <= y) home = F.seatTown[k]
  return home
}

/** "House Veckin", or a cadet line "the Veckin of Osk" (after its first home). */
export function familyTitle(fd: FamilyData, f: number): string {
  const F = fd.history.families
  if (F.parent[f] >= 0) return `the ${F.name[f]} of ${settlementName(fd.history, F.firstHome[f])}`
  return `House ${F.name[f]}`
}

/** Capitalised title for the start of a line. */
export function FamilyTitle(fd: FamilyData, f: number): string {
  const t = familyTitle(fd, f)
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** The population snapshot shown at year y. */
export function famSnapAt(h: History, y: number): number {
  return Math.max(0, Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval)))
}

/** Family capital per family at snapshot q (alive ones). */
export function familyCapitals(fd: FamilyData, q: number): Map<number, number> {
  const F = fd.history.families
  const m = new Map<number, number>()
  for (let i = F.famSnapOffsets[q]; i < F.famSnapOffsets[q + 1]; i++) m.set(F.famSnapFamily[i], F.famSnapCapital[i])
  return m
}

/** Capital of each open seat at snapshot q. */
export function seatCapitals(fd: FamilyData, q: number): Map<number, number> {
  const F = fd.history.families
  const m = new Map<number, number>()
  for (let i = F.seatSnapOffsets[q]; i < F.seatSnapOffsets[q + 1]; i++) m.set(F.seatSnapSeat[i], F.seatSnapCapital[i])
  return m
}

/** Seats of f open at year y (home first). */
export function seatsOpenAt(fd: FamilyData, f: number, y: number): number[] {
  const F = fd.history.families
  const out = fd.seatsOf[f].filter((k) => F.seatFrom[k] <= y && (F.seatTo[k] < 0 || F.seatTo[k] > y))
  out.sort((a, b) => F.seatKind[a] - F.seatKind[b] || a - b)
  return out
}

/** The head of f at year y (-1 before its founding). */
export function headAt(fd: FamilyData, f: number, y: number): number {
  const F = fd.history.families
  let cur = -1
  for (const k of fd.headsOf[f]) if (F.headFrom[k] <= y) cur = k
  return cur
}

/** "Taro Veckin". */
export function headFullName(fd: FamilyData, k: number): string {
  const F = fd.history.families
  return `${F.headName[k]} ${F.name[F.headFamily[k]]}`
}

/** Ability in plain words. */
export function abilityWord(a: number): string {
  return a >= 130 ? 'brilliant' : a >= 112 ? 'shrewd' : a >= 92 ? 'middling' : a >= 75 ? 'cautious' : 'spendthrift'
}

/** How a head came to lead the house, against the one before. */
export function kinWord(fd: FamilyData, k: number): string {
  const F = fd.history.families
  const female = F.headFemale[k] === 1
  switch (F.how[k]) {
    case HeadHow.Founder: return 'its founder'
    case HeadHow.Son: return female ? 'daughter of the last head' : 'son of the last head'
    case HeadHow.Brother: return female ? 'sister of the last head' : 'brother of the last head'
    case HeadHow.Nephew: return female ? 'niece of the last head' : 'nephew of the last head'
    case HeadHow.Widow: return 'widow of the last head'
    case HeadHow.SonInLaw: return 'son-in-law of the last head'
    default: return ''
  }
}

/** The families seated at `town` at year y with their capital there, richest first (ties by family id). */
export function townHouses(fd: FamilyData, town: number, y: number): { family: number; seat: number; capital: number }[] {
  const F = fd.history.families
  const q = famSnapAt(fd.history, y)
  const caps = seatCapitals(fd, q)
  const out: { family: number; seat: number; capital: number }[] = []
  for (const k of fd.seatsAt.get(town) ?? []) {
    if (!(F.seatFrom[k] <= y && (F.seatTo[k] < 0 || F.seatTo[k] > y))) continue
    out.push({ family: F.seatFamily[k], seat: k, capital: caps.get(k) ?? 0 })
  }
  out.sort((a, b) => b.capital - a.capital || a.family - b.family)
  return out
}

/** city-states: the council of a town at year y, its k richest families with their share of the town's merchant capital. */
export function councilAt(h: History, town: number, year: number, k: number): { family: number; capital: number; share: number }[] {
  const fd = familiesOf(h)
  if (!fd) return []
  const q = famSnapAt(h, year)
  const S = h.settlements.length
  const mw = h.merchantWealth.length >= (q + 1) * S ? h.merchantWealth[q * S + town] : 0
  return townHouses(fd, town, year).slice(0, k).map((x) => ({ family: x.family, capital: x.capital, share: mw > 0 ? x.capital / mw : 0 }))
}

/** Live families at year y, richest first. */
export function liveFamilies(fd: FamilyData, y: number): { family: number; capital: number }[] {
  const caps = familyCapitals(fd, famSnapAt(fd.history, y))
  const out: { family: number; capital: number }[] = []
  const F = fd.history.families
  for (let f = 0; f < F.count; f++) if (familyLives(fd, f, y)) out.push({ family: f, capital: caps.get(f) ?? 0 })
  out.sort((a, b) => b.capital - a.capital || a.family - b.family)
  return out
}

/** The capital of f over the snapshots (0 outside its life), for a sparkline. */
export function capitalSeries(fd: FamilyData, f: number): Float32Array {
  const F = fd.history.families
  const Q = fd.history.snapshotCount
  const out = new Float32Array(Q)
  for (let q = 0; q < Q; q++) for (let i = F.famSnapOffsets[q]; i < F.famSnapOffsets[q + 1]; i++) if (F.famSnapFamily[i] === f) { out[q] = F.famSnapCapital[i]; break }
  return out
}

/** Lanes (History.longHaul records) run by family f at year y. */
export function lanesRunAt(fd: FamilyData, f: number, y: number): number[] {
  const F = fd.history.families
  const out: number[] = []
  for (const r of fd.lanesOf[f]) if (F.laneFrom[r] <= y && (F.laneTo[r] < 0 || F.laneTo[r] > y) && F.laneLeg[r] >= 0) out.push(F.laneLeg[r])
  return out
}

/** Every lane run at year y by some family, with the family (History.longHaul record -> family). */
export function laneRunners(fd: FamilyData, y: number): Map<number, number> {
  const F = fd.history.families
  const m = new Map<number, number>()
  for (let r = 0; r < F.laneCount; r++) if (F.laneFrom[r] <= y && (F.laneTo[r] < 0 || F.laneTo[r] > y) && F.laneLeg[r] >= 0) m.set(F.laneLeg[r], F.laneFamily[r])
  return m
}
