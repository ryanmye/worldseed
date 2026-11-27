// battles: naval battles (battles.md 3.10, battles#8). Before a blockade (outlaw.ts blockade, once its guards pass and the
// enemy has a navy), the fleets fight for the sea off the enemy's main port. Square law for fleets (Lanchester 1916; Fiske
// 1905): x = (ships_p sea_p / (ships_q sea_q))^2 x cmd (the war's commanders: one office for land and sea in this model) x
// rain compression; ships = clamp(shipsPerPort x ports x navy, shipsMin, shipsMax). One outcome draw ('history-battles').
// With BATTLE_MODE.navalDecides a lost battle prevents the blockade that year; otherwise (and always while neutral) the
// blockaders are recorded as the winners (the outcome draw is mapped into their winning range) and the blockade is today's.
// Draws, fixed: [wet, fog, outcome], then the commanders' appointments (only when appointing).

import { BattleFlag, BattleKind, BattleWeather, EventType, TECH_FIELD_COUNT, TechField } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { navyOf } from '../polity/policy.ts'
import { resolve } from './lanchester.ts'
import { BATTLE } from './params.ts'
import type { BattleState } from './state.ts'
import { commanderOf, fameGain } from './commanders.ts'
import { served } from './system.ts'

/** The sea cell off `port` (within 3 sea hops) nearest the cell `toward`; -1 if the port has no sea beside it. */
function seaOff(s: HistoryState, port: number, toward: number): number {
  const { neighborOffsets: off, neighbors: nb, positions: P } = s.world.grid
  const sea = s.terrain.sea
  const c0 = s.cell[port]
  let ring = [c0]
  const seen = new Set<number>([c0])
  let best = -1, bestD = Infinity
  for (let hop = 0; hop < 3 && ring.length > 0; hop++) {
    const next: number[] = []
    for (const c of ring) for (let k = off[c]; k < off[c + 1]; k++) {
      const j = nb[k]
      if (seen.has(j) || !sea[j]) continue
      seen.add(j)
      next.push(j)
      const dx = P[3 * j] - P[3 * toward], dy = P[3 * j + 1] - P[3 * toward + 1], dz = P[3 * j + 2] - P[3 * toward + 2]
      const d = dx * dx + dy * dy + dz * dz
      if (d < bestD) { bestD = d; best = j }
    }
    ring = next
  }
  return best
}

function shipsOf(s: HistoryState, ps: PolityState, p: number): number {
  const n = BATTLE.shipsPerPort * ps.pPorts[p] * navyOf(s, ps, p)
  return n < BATTLE.shipsMin ? BATTLE.shipsMin : n > BATTLE.shipsMax ? BATTLE.shipsMax : n
}

/** The fleets of p (blockading) and q fight off q's main port in war w. Returns whether p won the sea (the blockade may follow). */
export function navalBattle(s: HistoryState, bs: BattleState, ps: PolityState, w: number, p: number, q: number, port: number): boolean {
  const rng = bs.rng
  const b = bs.bWar.length
  const wetDraw = rng.next(), fogDraw = rng.next()
  let U = rng.next()
  while (bs.wBattles.length <= w) bs.wBattles.push(0)
  while (bs.wDecisive.length <= w) bs.wDecisive.push(-1)
  const sideP = p === ps.wAtt[w] ? 0 : 1
  const cA = commanderOf(s, bs, ps, w, sideP, p)
  const cD = commanderOf(s, bs, ps, w, 1 - sideP, q)
  const capP = ps.pCapital[p]
  let site = seaOff(s, port, s.cell[capP])
  if (site < 0) site = s.cell[port]
  const W = s.world
  let weather: number = BattleWeather.Clear
  if (wetDraw < BATTLE.rain * (0.5 + W.rainfall[site])) weather = BattleWeather.Rain
  else if (fogDraw < 2 * BATTLE.fog) weather = BattleWeather.Fog
  const shA = shipsOf(s, ps, p), shD = shipsOf(s, ps, q)
  const sp = s.tech[ps.pPeople[p] * TECH_FIELD_COUNT + TechField.Seafaring], sq = s.tech[ps.pPeople[q] * TECH_FIELD_COUNT + TechField.Seafaring]
  const ra = (shA * sp) / (shD * (sq > 0 ? sq : 1e-9))
  let x = ra * ra
  if (!bs.neutral) {
    x *= bs.cSkill[cA] / bs.cSkill[cD]
    if (weather === BattleWeather.Rain) x = Math.sqrt(x)
  }
  const decides = bs.navalDecides
  if (!decides) U *= x / (x + 1) // (recorded as won by the blockaders: the draw mapped into their winning range)
  const b0 = BATTLE.break0
  const res = resolve(x, 1, b0, b0, BATTLE.rout, U)
  const won = res.winner === 0
  const lossA = res.fA * shA, lossD = res.fD * shD
  let hours = BATTLE.hourScale * res.tau
  if (hours < BATTLE.minHours) hours = BATTLE.minHours
  if (hours > BATTLE.maxHours) hours = BATTLE.maxHours
  let flags = 0
  const { neighborOffsets: off, neighbors: nb } = W.grid
  for (let k = off[site]; k < off[site + 1]; k++) if (!s.terrain.sea[nb[k]]) { flags |= BattleFlag.Coast; break }
  if ((won ? shA : shD) < (won ? shD : shA)) flags |= BattleFlag.Outnumbered
  if ((won ? res.fA : res.fD) >= BATTLE.pyrrhic) flags |= BattleFlag.Pyrrhic
  bs.bWar.push(w); bs.bYear.push(s.year); bs.bKind.push(BattleKind.Naval); bs.bCounter.push(0); bs.bSite.push(site); bs.bTarget.push(port); bs.bFrom.push(capP)
  bs.bAtt.push(p); bs.bDef.push(q); bs.bCmdA.push(cA); bs.bCmdD.push(cD); bs.bMenA.push(shA); bs.bMenD.push(shD); bs.bLossA.push(lossA); bs.bLossD.push(lossD)
  bs.bDead.push(0); bs.bWinner.push(won ? 0 : 1); bs.bHours.push(hours); bs.bWeather.push(weather); bs.bFlags.push(flags); bs.bRatio.push(res.xEff)
  bs.bBreakA.push(b0); bs.bBreakD.push(b0); bs.bSiegeYear.push(0)
  bs.diag.battles++
  bs.diag.byKind[BattleKind.Naval]++
  bs.diag.byWeather[weather]++
  bs.diag.naval++
  if (!won) bs.diag.navalLost++
  bs.wBattles[w]++
  const gainA = won ? fameGain(res.fD, shD, shA, false, 0) : 0
  const gainD = won ? 0 : fameGain(res.fA, shA, shD, false, 0)
  const renA = served(s, bs, cA, b, won, gainA, capP)
  const renD = served(s, bs, cD, b, !won, gainD, port)
  bs.cWar[cA] = w; bs.cWar[cD] = w
  s.events.push({ year: s.year, type: EventType.BattleFought, settlement: port, other: capP, value: b, extra: BattleKind.Naval | ((won ? 0 : 1) << 3) })
  if (renA) s.events.push({ year: s.year, type: EventType.CommanderRenowned, settlement: port, other: capP, value: cA })
  if (renD) s.events.push({ year: s.year, type: EventType.CommanderRenowned, settlement: port, other: ps.pCapital[q], value: cD })
  return won || !decides
}
