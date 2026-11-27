// society: readers of History's soc* tables (society-secular-cycles.md §4.1). All null / empty without society.

import { SecularPhase } from '../contract.ts'
import type { PolitiesData } from './politiesData.ts'

const at = (pd: PolitiesData, a: Uint8Array | undefined, p: number, s: number): number | null => {
  const P = pd.count
  if (!a || a.length < (s + 1) * P || s < 0 || p < 0 || p >= P) return null
  return a[s * P + p]
}
const live = (pd: PolitiesData, p: number, s: number): boolean => { const ph = at(pd, pd.history.socPhase, p, s); return ph !== null && ph !== 255 }

/** True when the history carries the society tables. */
export const hasSociety = (pd: PolitiesData): boolean => (pd.history.socPhase?.length ?? 0) > 0

/** Peasant and urban real wage (1 = subsistence), rent index (1 = reference) at snapshot s; null outside its life. */
export function wagesAt(pd: PolitiesData, p: number, s: number): { wage: number; urban: number; rent: number } | null {
  if (!live(pd, p, s)) return null
  const h = pd.history
  return { wage: (at(pd, h.socWage, p, s)! / 255) * 4, urban: (at(pd, h.socUrbanWage, p, s)! / 255) * 4, rent: (at(pd, h.socRent, p, s)! / 255) * 4 }
}
/** Ψ and its factors (1 = reference) at snapshot s; null outside its life. */
export function factorsAt(pd: PolitiesData, p: number, s: number): { psi: number; mmp: number; emp: number; sfd: number } | null {
  if (!live(pd, p, s)) return null
  const h = pd.history
  const f = (a: Uint8Array) => (at(pd, a, p, s)! / 255) * 8
  return { psi: f(h.socPsi), mmp: f(h.socMMP), emp: f(h.socEMP), sfd: f(h.socSFD) }
}
/** Shares of the people (peasants, townsfolk, clergy, elites) and the lords' coercion at snapshot s; null outside its life. */
export function sharesAt(pd: PolitiesData, p: number, s: number): { peasants: number; townsfolk: number; clergy: number; elites: number; coercion: number } | null {
  if (!live(pd, p, s)) return null
  const h = pd.history
  const elites = (at(pd, h.socElite, p, s)! / 255) * 0.128, townsfolk = at(pd, h.socUrban, p, s)! / 255, clergy = (at(pd, h.socClergy, p, s)! / 255) * 0.032
  return { peasants: Math.max(0, 1 - elites - townsfolk - clergy), townsfolk, clergy, elites, coercion: at(pd, h.socCoercion, p, s)! / 255 }
}
/** Secular phase at snapshot s (SecularPhase), -1 outside its life. */
export function phaseAt(pd: PolitiesData, p: number, s: number): number {
  const ph = at(pd, pd.history.socPhase, p, s)
  return ph === null || ph === 255 ? -1 : ph
}
/** Runs of equal phase over p's life: [first snapshot, last snapshot, phase]. */
export function phaseSpans(pd: PolitiesData, p: number): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let s = 0; s < pd.snapshotCount; s++) {
    const ph = phaseAt(pd, p, s)
    if (ph < 0) continue
    const last = out[out.length - 1]
    if (last && last[2] === ph && last[1] === s - 1) last[1] = s
    else out.push([s, s, ph])
  }
  return out
}
export const PHASE_NAME: Record<number, string> = { [SecularPhase.Expansion]: 'expansion', [SecularPhase.Stagflation]: 'stagflation', [SecularPhase.Crisis]: 'crisis', [SecularPhase.Depression]: 'depression' }
/** "calm" .. "breakdown" for Ψ. */
export const psiWord = (x: number): string => (x < 0.7 ? 'calm' : x < 1.3 ? 'ordinary' : x < 2.2 ? 'strained' : x < 4 ? 'crisis' : 'breakdown')
