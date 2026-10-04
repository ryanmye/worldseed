// polities: the polity system's place in the yearly tick, and the narrow hooks other systems read.
//
// Yearly, after abandonment (index.ts):
//   new settlements (graph link, cohesion, membership) -> members abandoned this year leave (a lost
//   capital is replaced) -> [map pass every POLITY.mapStep years] -> campaigns of the wars -> war
//   weariness and ravage fade -> every POLITY.step years: control (power, reach, mass), cohesion,
//   danger, unrest, revolts, successions / fragmentation / capital moves; every POLITY.slowStep years
//   also formation, accretion, absorption, rivalry, declarations, raids, walls, hostile borders; cell danger.
// The tax (taxSystem) runs between trade and population: grain flows from members to capitals.
//
// Hooks (every one a no-op while HistoryState.pol is null, which is how the off switch keeps the
// history bit-identical): flight and siting by danger (migration.ts, voyages.ts), crowding into
// walled towns, no joining an enemy at war, war embargo on trade (trade.ts), ravaged harvests
// (population.ts), technology shared inside empires (technology.ts).

import { EventType } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import { TECH, WEALTH } from '../params.ts'
import type { HistoryState } from '../state.ts'
import type { TradeState } from '../trade.ts'
import { controlPass } from './control.ts'
import { cellDanger, linkNew, mapPass, createMapHeap, zCell } from './territory.ts'
import { dangerStep, loseWalls, wallStep } from './danger.ts'
import { absorption, accretion, atWar, formation } from './formation.ts'
import { COHESION, DANGER, POLITY, UNREST } from './params.ts'
import { relationOf, relationStep } from './relations.ts'
import { FAR, createPolityState, ensureSettlements, grainShare, grip, setPolity, tierOf, Tier } from './state.ts'
import type { PolityState } from './state.ts'
import { cohesionStep, lostCapitals, realmStep, revoltStep, unrestStep } from './unrest.ts'
import { campaigns, declarations, raids, warYear } from './war.ts'
import type { Heap } from '../heap.ts'

let mapHeap: Heap | null = null

/** Creates the polity system at year 0 (after the tribes are founded): their cohesion, the first territory map. */
export function createPolitySystem(s: HistoryState, ts: TradeState): PolityState {
  const ps = createPolityState(s)
  newSettlements(s, ps)
  if (!mapHeap) mapHeap = createMapHeap()
  mapPass(s, ps, ts, mapHeap)
  cellDanger(s, ps)
  return ps
}

/** New settlements since the last call: graph link, cohesion, membership. */
function newSettlements(s: HistoryState, ps: PolityState): void {
  const n = s.count
  if (ps.seen >= n) return
  ensureSettlements(ps, n)
  for (let id = ps.seen; id < n; id++) {
    const par = s.parent[id]
    ps.asab[id] = par >= 0 ? ps.asab[par] : COHESION.start
    ps.dist[id] = FAR
    ps.foundZ[id] = zCell(s, ps, s.cell[id])
    const links = ps.linkA.length
    linkNew(s, ps, id)
    if (s.outpost[id] || s.abandoned[id] >= 0) continue
    if (s.year > 0) {
      ps.diag.foundYear.push(s.year)
      ps.diag.foundCellZ.push(zCell(s, ps, s.cell[id]))
      ps.diag.foundT.push(ps.defense[s.cell[id]])
      ps.diag.foundFromZ.push(par >= 0 && par < ps.seen ? ps.danger[par] : 0)
      ps.diag.foundHome.push(par >= 0 && s.terrain.landmass[s.cell[par]] === s.terrain.landmass[s.cell[id]] ? 1 : 0)
      ps.diag.foundCell.push(s.cell[id])
    }
    // Membership: overseas colonies of a kingdom's port town join it; others join the polity whose
    // land they settle, or their mother town's polity if they are within its reach.
    const seaborne = ps.linkA.length > links
    if (par < 0) continue
    const pp = ps.polity[par]
    if (seaborne) {
      if (pp >= 0 && s.port[par] >= 0 && tierOf(ps.pPop[pp], ps.pMembers[pp], ps.pMulti[pp] === 1) >= Tier.Kingdom) setPolity(s, ps, id, pp, ps.dist[par] + ps.linkCost[links])
      continue
    }
    const c = s.cell[id]
    const o = ps.tOwner[c]
    if (o >= 0 && o !== id && s.abandoned[o] < 0 && ps.polity[o] >= 0) { setPolity(s, ps, id, ps.polity[o], ps.dist[o] + ps.tDist[c]); continue }
    if (pp >= 0) {
      const nb = ps.gNb[id], co = ps.gCost[id]
      let d = FAR
      for (let k = 0; k < nb.length; k++) if (nb[k] === par) d = ps.dist[par] + co[k]
      if (d <= POLITY.newReach * ps.pReach[pp]) setPolity(s, ps, id, pp, d)
    }
  }
  ps.seen = n
}

/** Hostile border cells (rival or enemy polities on the two sides). */
function hostileCells(s: HistoryState, ps: PolityState): void {
  const { hostile, tOwner, polity, borderCell, borderOther } = ps
  hostile.fill(0)
  for (let k = 0; k < borderCell.length; k++) {
    const c = borderCell[k]
    const a = tOwner[c], b = borderOther[k]
    if (s.abandoned[a] >= 0 || s.abandoned[b] >= 0) continue
    const pa = polity[a], pb = polity[b]
    if (pa < 0 || pb < 0 || pa === pb) continue
    if (atWar(ps, pa, pb) || relationOf(ps, pa, pb) >= 0.5) hostile[c] = 1
  }
}

/** System (yearly, after abandonment): see the file comment for the order. */
export function politySystem(s: HistoryState, ps: PolityState, ts: TradeState): void {
  newSettlements(s, ps)
  // Settlements abandoned this year (Abandoned events since the last look) leave their polity; walls fall with them.
  const gone: number[] = []
  const ev = s.events
  for (let k = ps.evSeen; k < ev.length; k++) {
    const e = ev[k]
    if (e.type !== EventType.Abandoned) continue
    const id = e.settlement
    if (id >= ps.seen) continue
    if (ps.walls[id] > 0) loseWalls(s, ps, id)
    if (ps.polity[id] >= 0) gone.push(id)
  }
  ps.evSeen = ev.length
  if (gone.length > 0) lostCapitals(s, ps, gone)
  if (s.year % POLITY.mapStep === 0) {
    if (!mapHeap) mapHeap = createMapHeap()
    mapPass(s, ps, ts, mapHeap)
  }
  campaigns(s, ps)
  warYear(s, ps)
  if (s.year % POLITY.step !== 0) return
  controlPass(s, ps, ps.heap)
  dangerStep(s, ps)
  cohesionStep(s, ps)
  unrestStep(s, ps)
  revoltStep(s, ps)
  realmStep(s, ps)
  if (s.year % POLITY.slowStep === 0) {
    formation(s, ps)
    accretion(s, ps)
    absorption(s, ps)
    relationStep(s, ps, ts)
    declarations(s, ps)
    raids(s, ps)
    wallStep(s, ps)
    hostileCells(s, ps)
  }
  cellDanger(s, ps)
  taxShares(s, ps)
}

/** Share of its food each member sends its capital until the next step: tax * gamma * g / T. */
function taxShares(s: HistoryState, ps: PolityState): void {
  const living = s.living
  const payers = ps.taxPayers
  payers.length = 0
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const p = ps.polity[id]
    let x = 0
    if (p >= 0 && ps.pCapital[p] !== id && ps.dist[id] < FAR) x = (POLITY.tax * grainShare(s, id) * grip(ps.dist[id], ps.pReach[p])) / ps.defense[s.cell[id]]
    ps.taxShare[id] = x
    if (x > 0) payers.push(id)
  }
}

/**
 * System (yearly, between trade and population): the grain tax. Each member sends
 * tax * supply * gamma * g / T of its food to its capital (remote and rough members pay little) and a
 * small share of its wealth; the tax counts as loads through the capital (capitals as hubs).
 */
export function taxSystem(s: HistoryState, ps: PolityState): void {
  if (ps.alive.length === 0) return
  const P = POLITY
  const inFood = ps.scratchF
  for (const p of ps.alive) inFood[ps.pCapital[p]] = 0
  const wt = P.wealthTax * WEALTH.decay
  const payers = ps.taxPayers
  for (let t = 0; t < payers.length; t++) {
    const id = payers[t]
    if (s.abandoned[id] >= 0) continue
    const share = ps.taxShare[id]
    if (!(share > 0)) continue
    const p = ps.polity[id]
    if (p < 0) continue
    const cap = ps.pCapital[p]
    if (cap === id || s.abandoned[cap] >= 0) continue
    const tax = share * s.supply[id]
    if (!(tax > 0)) continue
    const g = grip(ps.dist[id], ps.pReach[p])
    s.supply[id] -= tax
    const pid = s.pop[id]
    s.food[id] = s.supply[id] >= pid ? 1 : s.supply[id] / pid
    inFood[cap] += tax
    const w = wt * g * s.wealth[id]
    s.wealth[id] -= w
    s.wealth[cap] += w
    if (s.harvest[s.weatherRegion[s.cell[id]]] < UNREST.badHarvest) ps.badTax[id] = 1
  }
  for (const p of ps.alive) {
    const cap = ps.pCapital[p]
    if (s.abandoned[cap] >= 0) continue
    const x = inFood[cap]
    if (!(x > 0)) continue
    s.supply[cap] += x
    const pc = s.pop[cap]
    s.food[cap] = s.supply[cap] >= pc ? 1 : s.supply[cap] / pc
    // (equilibria: the smoothed imports and through-traffic come to include the tax)
    s.foodImport[cap] += WEALTH.importSmoothing * x
    s.through[cap] += 0.2 * P.taxThrough * x
    ps.taxIn[cap] += 0.1 * (x - ps.taxIn[cap])
  }
}

// --- Hooks ---------------------------------------------------------------------------------------------

/** Extra yearly chance that a group flees settlement id from danger (migration). */
export function fleeChance(ps: PolityState, id: number): number {
  if (id >= ps.seen) return 0
  return DANGER.flee * smoothstep(DANGER.fleeLow, DANGER.fleeHigh, ps.danger[id])
}

/**
 * Site score factor of a new settlement on cell c founded from settlement `from` (migration, voyages):
 * (1 - site * z * (1 - D)) * (1 + refuge * z * D): danger repels, eased by defensibility D, and makes defensible
 * sites sought after; z is the cell's danger or, for a group fleeing danger, part of its own (fear sends people
 * to hilltops and islands even where it is quiet for now).
 */
export function siteFactor(s: HistoryState, ps: PolityState, c: number, from: number): number {
  let z = zCell(s, ps, c)
  if (from < ps.seen) { const zf = DANGER.fear * ps.danger[from]; if (zf > z) z = zf }
  const D = ps.defenseD[c]
  return (1 - DANGER.site * z * (1 - D)) * (1 + DANGER.refuge * z * D)
}

/** Join score factor of a group from `from` joining `occ`: the threatened crowd into walled towns; dangerous towns repel. */
export function joinFactor(s: HistoryState, ps: PolityState, from: number, occ: number): number {
  if (occ >= ps.seen || from >= ps.seen) return 1
  const wall = ps.walls[occ] > 0 ? POLITY.wall : 0
  return (1 + ps.danger[from] * wall) * (1 - DANGER.site * ps.danger[occ] * (1 - ps.defenseD[s.cell[occ]]))
}

/** True when a group from `from` may not join `occ`: their polities are at war. */
export function joinBlocked(ps: PolityState, from: number, occ: number): boolean {
  if (occ >= ps.seen || from >= ps.seen) return false
  return atWar(ps, ps.polity[from], ps.polity[occ])
}

/** True when trade between settlements a and b is embargoed (their polities are at war). */
export function embargoed(ps: PolityState, a: number, b: number): boolean {
  if (a >= ps.seen || b >= ps.seen) return false
  return atWar(ps, ps.polity[a], ps.polity[b])
}

/** Harvest multiplier of settlement id from war damage to its fields (1 - ravage). */
export function harvestLeft(ps: PolityState, id: number): number {
  return id < ps.seen ? 1 - ps.ravage[id] : 1
}

/**
 * Empires link their peoples (technology): link_pq += 0.01 * min(share_p, share_q) / 0.15 (at most TECH.near)
 * while two peoples in contact each hold at least POLITY.multiShare of a polity's members.
 */
export function empireLinks(s: HistoryState, ps: PolityState, link: Float64Array, P: number): void {
  if (ps.alive.length === 0) return
  const count = new Float64Array(P)
  // Members per people per polity (the member lists of the last control pass).
  for (const p of ps.alive) {
    if (p + 1 >= ps.memOff.length) continue
    const m0 = ps.memOff[p], m1 = ps.memOff[p + 1]
    const n = m1 - m0
    if (n < 2) continue
    count.fill(0)
    for (let k = m0; k < m1; k++) count[s.people[ps.memList[k]]]++
    for (let a = 0; a < P; a++) {
      const sa = count[a] / n
      if (sa < POLITY.multiShare) continue
      for (let b = 0; b < P; b++) {
        if (b === a) continue
        const sb = count[b] / n
        if (sb < POLITY.multiShare || !(link[a * P + b] > 0)) continue
        let add = (0.01 * (sa < sb ? sa : sb)) / 0.15
        if (add > TECH.near) add = TECH.near
        link[a * P + b] += add
      }
    }
  }
}
