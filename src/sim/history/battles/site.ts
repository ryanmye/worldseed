// battles: where a battle was fought (battles.md 3.4), from the army's approach path (war.ts armyJourney) and the cells'
// features (PolityState.defenseFeat). Pure apart from the one ground draw passed in; + - * / only.
//   Siege, Relief: the target's cell.
//   Landing: the first land cell after the last sea cell of the approach (flag Coast).
//   Field: the last BATTLE.reach land cells of the approach before the target; a defender who chooses the ground takes the
//          most defensible (T = defense, + fordBonus at a river crossing: defenders hold the crossing), an attacker the
//          least (forcing battle on open ground); ties go to the cell nearest the target. Without a path: the target's
//          neighbour facing the attackers' town.

import { BattleFlag, BattleKind, RIVER_FLOW_THRESHOLD } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { DefFeat } from '../polity/defense.ts'
import { BATTLE } from './params.ts'

/** Flags of the last pickSite (terrain bits and GroundByDefender). */
export let siteFlags = 0

function isRiver(s: HistoryState, c: number): boolean {
  const w = s.world
  return !s.terrain.sea[c] && !w.lake[c] && w.flow[c] >= RIVER_FLOW_THRESHOLD
}

/** Whether the approach crosses a river at path[k] (coming from path[k - 1], not along the same stream). */
function crossing(s: HistoryState, path: readonly number[], k: number): boolean {
  if (k <= 0) return false
  const c = path[k], prev = path[k - 1]
  if (!isRiver(s, c)) return false
  if (!isRiver(s, prev)) return true
  const to = s.world.riverTo
  return to[prev] !== c && to[c] !== prev
}

function coastal(s: HistoryState, c: number): boolean {
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  for (let k = off[c]; k < off[c + 1]; k++) if (s.terrain.sea[nb[k]]) return true
  return false
}

/** The target's land neighbour facing the attackers' town (largest dot product toward it), else the target itself. */
function facing(s: HistoryState, cv: number, cu: number): number {
  const { neighborOffsets: off, neighbors: nb, positions: P } = s.world.grid
  const dx = P[3 * cu] - P[3 * cv], dy = P[3 * cu + 1] - P[3 * cv + 1], dz = P[3 * cu + 2] - P[3 * cv + 2]
  let best = cv, bestDot = -Infinity
  for (let k = off[cv]; k < off[cv + 1]; k++) {
    const j = nb[k]
    if (s.terrain.sea[j]) continue
    const dot = (P[3 * j] - P[3 * cv]) * dx + (P[3 * j + 1] - P[3 * cv + 1]) * dy + (P[3 * j + 2] - P[3 * cv + 2]) * dz
    if (dot > bestDot) { bestDot = dot; best = j }
  }
  return best
}

/** Terrain flags of a cell. */
function terrainFlags(ps: PolityState, c: number): number {
  const f = ps.defenseFeat[c]
  let x = 0
  if (f & DefFeat.Pass) x |= BattleFlag.Pass
  if (f & (DefFeat.Hill | DefFeat.Mountain)) x |= BattleFlag.Hill
  if (f & DefFeat.Wood) x |= BattleFlag.Wood
  if (f & DefFeat.Marsh) x |= BattleFlag.Marsh
  return x
}

/**
 * The battle's cell for a battle of `kind` struck from u on v along `path` (null: no path); `defenderChooses` from the ground
 * draw. Sets siteFlags.
 */
export function pickSite(s: HistoryState, ps: PolityState, path: readonly number[] | null, u: number, v: number, kind: number, defenderChooses: boolean): number {
  const cu = s.cell[u], cv = s.cell[v]
  siteFlags = defenderChooses ? BattleFlag.GroundByDefender : 0
  if (kind === BattleKind.Siege || kind === BattleKind.Relief) { siteFlags |= terrainFlags(ps, cv); return cv }
  const sea = s.terrain.sea
  if (kind === BattleKind.Landing && path !== null) {
    let last = -1
    for (let k = 0; k < path.length; k++) if (sea[path[k]]) last = k
    const c = last >= 0 && last + 1 < path.length ? path[last + 1] : cv
    siteFlags |= terrainFlags(ps, c) | BattleFlag.Coast
    return c
  }
  if (path === null || path.length < 2) { const c = facing(s, cv, cu); siteFlags |= terrainFlags(ps, c); return c }
  let best = -1, bestT = 0, bestFord = false, n = 0
  for (let k = path.length - 2; k >= 0 && n < BATTLE.reach; k--) {
    const c = path[k]
    if (sea[c]) continue
    n++
    const ford = crossing(s, path, k)
    const t = ps.defense[c] + (defenderChooses && ford ? BATTLE.fordBonus : 0)
    if (best < 0 || (defenderChooses ? t > bestT : t < bestT)) { best = c; bestT = t; bestFord = ford }
  }
  if (best < 0) best = facing(s, cv, cu)
  siteFlags |= terrainFlags(ps, best) | (bestFord ? BattleFlag.Ford : 0) | (coastal(s, best) && kind === BattleKind.Landing ? BattleFlag.Coast : 0)
  return best
}

/** Whether the battle's cell lies by water (fog is likelier): a coast or a river. */
export function byWater(s: HistoryState, ps: PolityState, c: number): boolean {
  return coastal(s, c) || (ps.defenseFeat[c] & DefFeat.River) !== 0
}
