// polities: the danger field and town walls (design 7).
//
// Danger z of a settlement (every step): it decays (DANGER.decay a year) and is held up by ongoing
// sources, whichever is largest:
//   0.3  a land edge to a member of a rival polity (rivalry >= 0.5); 0.5 to an enemy at war
//   0.3 * cohesion of a raider-type stateless neighbour (another people, herders or horsemen)
//   0.15 the state's frontier: stateless next to a polity, or a member next to stateless land
//   lawless = 0.3 * (1 - g(dist)) * smoothstep(0.35, 0.1, A * (crisis ? 0.6 : 1))   (members only: bandits where the grip is weak)
// and events raise it at once (spike): raid 0.4, battle 0.6, siege or sack 0.9, revolt 0.4.
// The smoothed danger (dangerAvg) builds walls: a town of WALLS.pop (a capital of capitalPop) whose
// smoothed danger reaches WALLS.danger raises walls with a yearly chance; it adds rings as it grows;
// walls fall out of use only below WALLS.keep people, by slighting after a sack, or with the town:
// never merely because peace returned (walls answer threat with a lag and outlive it).
// Effects on people (migration.ts, voyages.ts, read through hooks.ts): flight from danger, site
// choice by danger and defensibility, crowding into walled towns.

import { EventType, StructureType, TechField } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import { TECH } from '../params.ts'
import type { HistoryState } from '../state.ts'
import { logEvent, techOf } from '../state.ts'
import { COHESION, DANGER, POLITY, WALLS } from './params.ts'
import { grip, inCrisis, isCapital } from './state.ts'
import type { PolityState } from './state.ts'
import { relationOf } from './relations.ts'
import { atWar } from './formation.ts'


/** Raises the danger of settlement id to at least z (an event). */
export function spike(ps: PolityState, id: number, z: number): void {
  if (ps.danger[id] < z) ps.danger[id] = z
}

/** True for a stateless settlement of herders (or horsemen): the raiders of the steppe frontier. */
export function raiderType(s: HistoryState, ps: PolityState, v: number): boolean {
  return ps.polity[v] < 0 && s.liveFrac[v] > 0.4
}

/** System part (every step): danger decays and is held up by its ongoing sources. */
export function dangerStep(s: HistoryState, ps: PolityState): void {
  const D = DANGER
  const step = POLITY.step
  const keep = 1 - step * D.decay
  const avg = step * D.avgRate
  const living = s.living
  const { danger, dangerAvg, gNb, polity } = ps
  for (let t = 0; t < living.length; t++) {
    const i = living[t]
    let z = danger[i] * keep
    const pi = polity[i]
    let on = 0
    // Also the frontier flags for cohesion (unrest.ts): 1 a frontier, 2 a steppe frontier (a raider-type neighbour of another people).
    let front = 0
    const nb = gNb[i]
    if (nb) {
      for (let k = 0; k < nb.length; k++) {
        const v = nb[k]
        if (s.abandoned[v] >= 0 || s.outpost[v]) continue
        const pv = polity[v]
        const other = s.people[v] !== s.people[i]
        if (pi >= 0 && pv >= 0 && pi !== pv) {
          if (atWar(ps, pi, pv)) { if (on < D.enemy) on = D.enemy; front |= 1 }
          else {
            const R = relationOf(ps, pi, pv)
            if (R >= 0.5 && on < D.rival) on = D.rival
            if (R >= COHESION.frontierR) front |= 1
          }
        }
        if ((pi < 0) !== (pv < 0) && on < D.frontier) on = D.frontier
        if (pi < 0 && pv >= 0) front |= 1
        if (other) front |= 1
        if (pv < 0 && other && raiderType(s, ps, v)) {
          front |= 2
          const r = D.raider * ps.asab[v]
          if (r > on) on = r
        }
      }
    }
    ps.scratchI[i] = front
    if (pi >= 0) {
      const A = ps.pAsab[pi] * (inCrisis(s, ps, pi) ? POLITY.crisisMass : 1)
      const lw = D.lawless * (1 - grip(ps.dist[i], ps.pReach[pi])) * smoothstep(D.lawlessHigh, D.lawlessLow, A)
      if (lw > on) on = lw
    }
    if (on > z) z = on
    danger[i] = z
    dangerAvg[i] += avg * (z - dangerAvg[i])
  }
}

/** Building skill from Crafts c, as for ports and dams: c / (1 + build * (c - 1)). */
function buildSkill(s: HistoryState, id: number): number {
  const c = techOf(s, id, TechField.Crafts)
  return c / (1 + TECH.build * (c - 1))
}

/** Raises a ring of walls at settlement id this year. */
function buildWalls(s: HistoryState, ps: PolityState, id: number): void {
  const sid = s.structures.length
  s.structures.push({ id: sid, type: StructureType.Walls, cell: s.cell[id], settlement: id, builtYear: s.year, lostYear: -1 })
  logEvent(s, EventType.Built, id, sid, StructureType.Walls)
  ps.walls[id]++
  ps.wallPop[id] = s.pop[id]
}

/** Every ring of settlement id's walls falls out of use this year (slighted, abandoned, or too few to man them). */
export function loseWalls(s: HistoryState, ps: PolityState, id: number): void {
  if (ps.walls[id] <= 0) return
  const list = s.structures
  for (let k = 0; k < list.length; k++) {
    const x = list[k]
    if (x.type !== StructureType.Walls || x.settlement !== id || x.lostYear >= 0) continue
    x.lostYear = s.year
    logEvent(s, EventType.StructureLost, id, k, StructureType.Walls)
  }
  ps.walls[id] = 0
  ps.wallPop[id] = 0
}

/** System part (every step, after the campaigns of the year): walls raised against danger, and walls lost. */
export function wallStep(s: HistoryState, ps: PolityState): void {
  const W = WALLS
  const rng = ps.rng
  const living = s.living
  const step = POLITY.slowStep
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const p = s.pop[id]
    const r = ps.walls[id]
    if (r > 0 && p < W.keep) { loseWalls(s, ps, id); continue }
    const cap = isCapital(ps, id)
    const za = ps.dangerAvg[id]
    let want = false
    if (r === 0) want = (p >= W.pop || (cap && p >= W.capitalPop)) && za >= W.danger
    else if (r < W.maxRings) want = p >= W.ringGrowth * ps.wallPop[id] && (za >= W.ringDanger || (cap && p >= W.ringCapital))
    if (!want) continue
    // (a structure built this year is never lost this year: campaigns ran before this)
    if (rng.next() < step * W.chance * buildSkill(s, id)) buildWalls(s, ps, id)
  }
}
