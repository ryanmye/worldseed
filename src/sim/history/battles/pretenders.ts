// battles: generals as pretenders (battles.md 3.9, battles#9; BATTLE_MODE.pretenders, never while neutral).
//
//   Coup     C3 factor 3 (commanders.ts battleCoup): while a general of fame >= renown / 2 serves, the overthrow chance is
//            x (1 + coup min(2, fame / renown)). When an overthrow fires, it is his with chance (m - 1) / m (one
//            'history-battles' draw): he founds the new house (newHouseAccede takes his birth year and sex after its own
//            draws), GeneralSeized, fate Seized, reignAfter the new reign.
//   Rising   in a contested succession (rulers contested), a famous general's base is the rival centre when it passes the
//            rival test at riseBar x the usual bar; he is the pretender of a new house; GeneralRose after CivilWar, fate Rose.
//   Turned   every POLITY.step, a famous general dismissed while his realm's war goes on (fame >= renown / 2) whose base
//            borders the enemy goes over with chance turn x step: Defected and GeneralTurned, and (oaths) a GeneralTurned
//            grievance of his realm against the enemy. Fate Turned.

import { CommanderFate, EventType, GrievanceKind } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { logEvent } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { FAR, setPolity } from '../polity/state.ts'
import { distTo } from '../polity/control.ts'
import { CIVIL, OATH, POLITY } from '../polity/params.ts'
import { recordGrievance } from '../polity/grievances.ts'
import { BATTLE } from './params.ts'
import type { BattleState } from './state.ts'
import { battleCoup, famousGeneral, fameNow } from './commanders.ts'

function logEx(s: HistoryState, type: EventType, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

/** An overthrow of p's ruler fired: the famous general whose coup it is (one draw), or -1. */
export function battleUsurper(s: HistoryState, bs: BattleState, p: number): number {
  const m = battleCoup(s, bs, p)
  if (m <= 1) return -1
  const c = famousGeneral(s, bs, p)
  if (c < 0) return -1
  return bs.rng.next() < (m - 1) / m ? c : -1
}

/** General c took p's throne as reign `reign`. */
export function battleSeized(s: HistoryState, bs: BattleState, c: number, p: number, reign: number): void {
  const ps = s.pol!
  bs.cFate[c] = CommanderFate.Seized; bs.cFateYear[c] = s.year; bs.cReignAfter[c] = reign
  bs.diag.seized++
  logEx(s, EventType.GeneralSeized, ps.pCapital[p], bs.cBase[c], c, reign)
}

/** The famous general of p whose base can be a rival centre in a contested succession (riseBar x the usual bar), or -1. */
export function generalBase(s: HistoryState, bs: BattleState, p: number, members: readonly number[]): number {
  const c = famousGeneral(s, bs, p)
  if (c < 0) return -1
  const m = bs.cBase[c]
  const ps = s.pol!
  const cap = ps.pCapital[p]
  if (m < 0 || m === cap || ps.polity[m] !== p || s.abandoned[m] >= 0 || !(ps.dist[m] < FAR)) return -1
  if (members.indexOf(m) < 0) return -1
  const bar = (CIVIL.rivalRatio * s.pop[cap]) / (1 + ps.pMembers[p] / CIVIL.sizeRef)
  const need = BATTLE.riseBar * (bar > CIVIL.rivalPop ? bar : CIVIL.rivalPop)
  if (s.pop[m] < need || ps.dist[m] < BATTLE.riseBar * CIVIL.rivalDist * ps.pReach[p]) return -1
  return c
}

/** General c rose from `base` against the realm ruled from `capital`: civil war w. */
export function battleRose(s: HistoryState, bs: BattleState, c: number, base: number, capital: number, w: number): void {
  bs.cFate[c] = CommanderFate.Rose; bs.cFateYear[c] = s.year; bs.cFateWar[c] = w
  bs.diag.rose++
  logEx(s, EventType.GeneralRose, base, capital, c, w)
}

/** Yearly (after the rulers): every POLITY.step, famous generals passed over may turn to the enemy with the town they hold. */
export function battlesYear(s: HistoryState, ps: PolityState, bs: BattleState): void {
  if (!bs.pretenders || s.year % POLITY.step !== 0) return
  const chance = BATTLE.turn * POLITY.step
  const C = bs.cPolity.length
  for (let c = 0; c < C; c++) {
    if (bs.cFate[c] !== CommanderFate.Dismissed || bs.cReign[c] >= 0) continue
    const w = bs.cWar[c]
    if (w < 0 || ps.wEnd[w] >= 0 || s.year - bs.cFateYear[c] > 2 * POLITY.step) continue
    if (bs.cPeak[c] < BATTLE.renown / 2 || fameNow(bs, c, s.year) < BATTLE.renown / 4) continue
    const p = bs.cPolity[c]
    const base = bs.cBase[c]
    if (base < 0 || s.abandoned[base] >= 0 || ps.polity[base] !== p || ps.pCapital[p] === base) continue
    const enemy = ps.wAtt[w] === p ? ps.wDef[w] : ps.wDef[w] === p ? ps.wAtt[w] : -1
    if (enemy < 0 || ps.pEnded[enemy] >= 0) continue
    const nb = ps.gNb[base]
    let borders = false
    if (nb) for (let k = 0; k < nb.length && !borders; k++) if (ps.polity[nb[k]] === enemy) borders = true
    if (!borders) continue
    if (bs.rng.next() >= chance) continue
    const d = distTo(ps, enemy, base, s.abandoned)
    setPolity(s, ps, base, enemy, d)
    ps.unrest[base] = 0
    bs.cFate[c] = CommanderFate.Turned; bs.cFateYear[c] = s.year; bs.cFateWar[c] = w; bs.cPolity[c] = p
    bs.diag.turned++
    logEvent(s, EventType.Defected, base, ps.pCapital[enemy], enemy)
    logEx(s, EventType.GeneralTurned, base, ps.pCapital[enemy], c, w)
    if (ps.og !== null && ps.og.oaths) recordGrievance(s, ps, ps.og, GrievanceKind.GeneralTurned, p, enemy, OATH.wTown * (1 + bs.cPeak[c] / BATTLE.renown), base, w) // oaths: the realm he betrayed holds it against the enemy
  }
}
