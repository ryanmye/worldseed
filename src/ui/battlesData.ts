// battles: an index of History.battles and History.commanders for the panels and the chronicle (built once per history).
// By war, by town fought for (the target), by commander; sieges grouped (the assaults of one war on one town in
// successive years). Pure; no DOM.

import { BattleKind } from '../contract.ts'
import type { Battles, Commanders, History } from '../contract.ts'

export interface SiegeGroup {
  war: number
  target: number
  /** Battle ids of the assaults, in order. */
  rows: number[]
  firstYear: number
  lastYear: number
  /** Whether the town fell to the last assault. */
  fell: boolean
}

export interface BattlesData {
  B: Battles
  C: Commanders
  byWar: Map<number, number[]>
  byTarget: Map<number, number[]>
  byCommander: number[][]
  sieges: SiegeGroup[]
  /** The siege group of each Siege row (-1 for other kinds). */
  siegeOf: Int32Array
}

const cache = new WeakMap<History, BattlesData | null>()

function push<K>(m: Map<K, number[]>, k: K, v: number): void {
  const a = m.get(k)
  if (a) a.push(v)
  else m.set(k, [v])
}

/** The battles index of `h`, or null when it has no battles (battles off, or an older history). */
export function battlesOf(h: History | null | undefined): BattlesData | null {
  if (!h) return null
  if (cache.has(h)) return cache.get(h) ?? null
  const B = (h as Partial<History>).battles, C = (h as Partial<History>).commanders
  let bd: BattlesData | null = null
  if (B && C && B.count > 0) {
    const byWar = new Map<number, number[]>(), byTarget = new Map<number, number[]>()
    const byCommander: number[][] = Array.from({ length: C.count }, () => [])
    const sieges: SiegeGroup[] = []
    const siegeOf = new Int32Array(B.count).fill(-1)
    const open = new Map<string, number>()
    for (let b = 0; b < B.count; b++) {
      push(byWar, B.war[b], b)
      push(byTarget, B.target[b], b)
      if (B.cmdA[b] >= 0) byCommander[B.cmdA[b]].push(b)
      if (B.cmdD[b] >= 0 && B.cmdD[b] !== B.cmdA[b]) byCommander[B.cmdD[b]].push(b)
      if (B.kind[b] === BattleKind.Siege) {
        const key = B.war[b] + ':' + B.target[b]
        const g = open.get(key)
        if (g !== undefined && B.year[b] - sieges[g].lastYear <= 1) {
          sieges[g].rows.push(b); sieges[g].lastYear = B.year[b]; sieges[g].fell = B.winner[b] === 0; siegeOf[b] = g
        } else {
          open.set(key, sieges.length)
          siegeOf[b] = sieges.length
          sieges.push({ war: B.war[b], target: B.target[b], rows: [b], firstYear: B.year[b], lastYear: B.year[b], fell: B.winner[b] === 0 })
        }
      }
    }
    bd = { B, C, byWar, byTarget, byCommander, sieges, siegeOf }
  }
  cache.set(h, bd)
  return bd
}

/** People the front towns lost in the battles of war w (sacks excluded): a battle-deaths figure for COW-like fits. */
export function battleDeadOf(h: History, w: number): number {
  const bd = battlesOf(h)
  if (!bd) return 0
  let d = 0
  for (const b of bd.byWar.get(w) ?? []) d += bd.B.dead[b]
  return d
}

/** How much a battle is worth telling: the men engaged, more when the town fell, a ruler led or a commander fell. */
export function battleWeight(B: Battles, b: number): number {
  return (B.menA[b] + B.menD[b]) * (B.winner[b] === 0 ? 1.5 : 1) * (B.flags[b] & 16384 ? 1.5 : 1)
}

/** The war's most notable battles (at most `max`), in order of battle; a siege counted once (its last assault). */
export function notableBattlesOfWar(h: History, w: number, max = 3): number[] {
  const bd = battlesOf(h)
  if (!bd) return []
  const rows = (bd.byWar.get(w) ?? []).filter((b) => bd.siegeOf[b] < 0 || bd.sieges[bd.siegeOf[b]].rows[bd.sieges[bd.siegeOf[b]].rows.length - 1] === b)
  return rows.slice().sort((a, b) => battleWeight(bd.B, b) - battleWeight(bd.B, a) || a - b).slice(0, max).sort((a, b) => a - b)
}
