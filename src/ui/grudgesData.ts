// grudges and oaths, balance, arms (grudges-and-oaths.md §3.9): read-outs of History.grievances, faithless, arms and armsRaces
// for the panels, the chronicle and the sagas. The weights fade as w(y) = w0 * 0.5^((y - y0) / halfLife) (the UI may use pow).

import { EventType, GrievanceKind } from '../contract.ts'
import type { History, HistoryEvent } from '../contract.ts'

/** The grudges events (190-199). */
export const OathEvent = { Betrayal: 190, OathBroken: 191, Avenged: 192, Bandwagon: 193, ArmsRace: 194 } as const
export const isOathEvent = (t: number): boolean => t >= 190 && t <= 194

export interface Standing {
  /** The other polity, the summed weight now, and the rows (strongest first). */
  other: number
  w: number
  rows: number[]
}

/** The weight of grievance row i at `year` (0 once put aside or before it). */
export function grievanceWeight(h: History, i: number, year: number): number {
  const g = h.grievances
  if (!g || i < 0 || i >= g.count || g.year[i] > year || (g.endYear[i] >= 0 && g.endYear[i] <= year)) return 0
  return g.weight[i] * Math.pow(0.5, (year - g.year[i]) / (g.halfLife || 30))
}

/**
 * Grudges held at `year`: by p against others (`held`), or against p by others (`against`), per other polity, strongest
 * first.
 */
export function standingGrudges(h: History, p: number, year: number, against = false): Standing[] {
  const g = h.grievances
  if (!g || g.count === 0) return []
  const by = new Map<number, Standing>()
  for (let i = 0; i < g.count; i++) {
    if ((against ? g.offender[i] : g.wronged[i]) !== p) continue
    const w = grievanceWeight(h, i, year)
    if (w <= 0) continue
    const o = against ? g.wronged[i] : g.offender[i]
    let s = by.get(o)
    if (!s) { s = { other: o, w: 0, rows: [] }; by.set(o, s) }
    s.w += w
    s.rows.push(i)
  }
  const out = [...by.values()]
  for (const s of out) s.rows.sort((a, b) => grievanceWeight(h, b, year) - grievanceWeight(h, a, year) || a - b)
  out.sort((a, b) => b.w - a.w || a.other - b.other)
  return out
}

/** "strong" (>= 1), "held" (>= 0.4) or "fading". */
export function grudgeWord(w: number): string {
  return w >= 1 ? 'strong' : w >= 0.4 ? 'held' : 'fading'
}

/** Words for the wrong of row i ("the sack of Vebena in 1203"); `name` gives a settlement's name. */
export function wrongWords(h: History, i: number, name: (id: number) => string): string {
  const g = h.grievances
  const y = g.year[i], v = g.settlement[i]
  const at = v >= 0 ? name(v) : ''
  switch (g.kind[i]) {
    case GrievanceKind.TruceBroken: return `the broken truce of ${y}`
    case GrievanceKind.AllyBetrayed: return `the betrayal of ${y}`
    case GrievanceKind.BondThrownOff: return `the defiance of ${y}`
    case GrievanceKind.TownConquered: return g.towns[i] > 1 ? `the ${g.towns[i]} towns lost in ${y}` : `the loss of ${at} in ${y}`
    case GrievanceKind.TownSacked: return `the sack of ${at} in ${y}`
    case GrievanceKind.HolyCityTaken: return `the fall of the holy city of ${at} in ${y}`
    case GrievanceKind.CapitalTaken: return `the loss of its capital, ${at}, in ${y}`
    case GrievanceKind.CrownDefault: return `the unpaid debt of ${y}`
  }
  return `the wrong of ${y}`
}

/** The faithless score of p at snapshot s (0..3), or 0. */
export function faithlessAt(h: History, p: number, s: number): number {
  const P = h.polities.length
  const a = h.faithless
  if (!a || a.length < (s + 1) * P || s < 0) return 0
  return (a[s * P + p] / 255) * 3
}

/** "Faithless" (f >= 1), "Doubted" (>= 0.3) or ''. */
export function faithlessWord(f: number): string {
  return f >= 1 ? 'Faithless' : f >= 0.3 ? 'Doubted' : ''
}

/** Armament M_p of p at snapshot s (0..1). */
export function armsAt(h: History, p: number, s: number): number {
  const P = h.polities.length
  const a = h.arms
  if (!a || a.length < (s + 1) * P || s < 0) return 0
  return a[s * P + p] / 255
}

/** "light" (< 0.2), "armed" (< 0.5) or "heavy". */
export function armsWord(m: number): string {
  return m < 0.2 ? 'light' : m < 0.5 ? 'armed' : 'heavy'
}

/** Races open at `year` (not yet at war): [a, b, level 0..1] triples, flat. */
export function armsRacesAt(h: History, year: number): number[] {
  const R = h.armsRaces
  const out: number[] = []
  if (!R || R.count === 0) return out
  for (let i = 0; i < R.count; i++) {
    if (R.start[i] > year || (R.end[i] >= 0 && R.end[i] <= year)) continue
    const k = R.levelOff[i] + Math.min(R.levelOff[i + 1] - R.levelOff[i] - 1, Math.max(0, Math.floor((year - R.start[i]) / 10)))
    out.push(R.a[i], R.b[i], k >= R.levelOff[i] ? R.level[k] / 255 : 0)
  }
  return out
}

/** The races p took part in (row ids, by start). */
export function racesOf(h: History, p: number): number[] {
  const R = h.armsRaces
  const out: number[] = []
  if (!R) return out
  for (let i = 0; i < R.count; i++) if (R.a[i] === p || R.b[i] === p) out.push(i)
  return out
}

/** Oath events (Betrayal, OathBroken) whose `settlement` is in `caps` (a reign's capitals) between y0 and y1. */
export function oathsBroken(h: History, caps: ReadonlySet<number>, y0: number, y1: number): HistoryEvent[] {
  return h.events.filter((e) => (e.type === EventType.Betrayal || e.type === EventType.OathBroken) && caps.has(e.settlement) && e.year >= y0 && e.year <= y1)
}
