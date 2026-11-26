// battles: every contest of war.ts battle() as a recorded battle (battles.md 3.3-3.9).
//
// battleFought is called once per battle, after the army's journey and the war's single outcome draw U, before the
// front towns' losses. With BATTLE.neutral (the default) every modifier is 1 and the outcome is today's test
// `U < r*r / (r*r + 1)` computed as x / (x + x*) with x = r*r, x* = 1 (the same float operations): wars, towns, people and
// rulers are bit-identical to battles off. What is recorded beside it:
//   kind      Relief (a counterstroke on the besiegers' base or lines), Siege (a walled town or a capital), Landing (the
//             approach crossed the sea), Ambush (a field battle the defenders opened by surprise), else Field;
//   site      site.ts, the ground chosen by the defenders with chance sD / (sA + sD) (commanders' skill);
//   weather   rain with BATTLE.rain (0.5 + rainfall) (x 1.5 in a wet year), snow when it is cold, fog with BATTLE.fog (x 2 by
//             water), heat on a clear day in hot desert or savanna;
//   surprise  BATTLE.surprise (x 3 in fog, x 2 with cover) x the better commander's skill over the worse; the defenders'
//             with chance 0.5 + 0.25 (sD - sA);
//   men       the attacker's army is the Journey's size (WAR.army * mass, clamped); the defenders' is derived, the chronicler's
//             number: menA (D / A) (qA / qD), over the walls for a siege;
//   losses    lanchester.ts with x' = r*r (1 - U) / U, equal breaks BATTLE.break0, and the rout
//             rho = BATTLE.rout (1 + horse_w - horse_l, 0.5..2) (x 1.5 with a river behind the beaten attackers) (x 0.6 in snow or wood);
//   hours     BATTLE.hourScale tau, clamped;
//   commanders.ts appointment, fame, the fall of generals.
// Draws ('history-battles'), fixed per battle: [ground, wet, fog, surprise, surpriseSide], then the commanders'
// appointments (attacker side, defender side; only when appointing), then [slainA, slainD], then a dismissal (a beaten
// general who survived). The war's stream ('history-war') is not drawn here.

import { BattleFlag, BattleKind, BattleWeather, Biome, CommanderFate, EventType } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { logEvent } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { horseOf, isCapital, qualityOf, wallFactor } from '../polity/state.ts'
import { WAR } from '../polity/params.ts'
import { resolve } from './lanchester.ts'
import { BATTLE } from './params.ts'
import { byWater, pickSite, siteFlags } from './site.ts'
import type { BattleState } from './state.ts'
import { commanderOf, fameGain, fameNow } from './commanders.ts'

function logEx(s: HistoryState, type: EventType, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

function hasSea(s: HistoryState, path: readonly number[] | null): boolean {
  if (path === null) return false
  const sea = s.terrain.sea
  for (let k = 0; k < path.length; k++) if (sea[path[k]]) return true
  return false
}

/** Whether v is the besiegers' base or beside the besieged town of war w (a relief). */
function relieves(ps: PolityState, w: number, v: number): boolean {
  const sg = ps.wSiege[w]
  if (sg < 0) return false
  if (ps.wSiegeFrom[w] === v) return true
  const nb = ps.gNb[sg]
  if (nb) for (let k = 0; k < nb.length; k++) if (nb[k] === v) return true
  return false
}

/** A commander's battle done: veterancy, wins, fame (fame gained `gain`, 0 on a loss), last base. Returns true when he became renowned. */
function served(s: HistoryState, bs: BattleState, c: number, b: number, won: boolean, gain: number, base: number): boolean {
  bs.cBattles[c]++
  bs.cLast[c] = s.year
  bs.cLastBattle[c] = b
  bs.cBase[c] = base
  if (won) bs.cWins[c]++
  if (bs.cReign[c] < 0 && bs.cBattles[c] > 1) { const sk = bs.cSkill[c] + BATTLE.veteran, cap = bs.cSkill0[c] + BATTLE.veteranMax; bs.cSkill[c] = sk < cap ? sk : cap }
  const f = fameNow(bs, c, s.year) + gain
  bs.cFame[c] = f
  if (f > bs.cPeak[c]) { bs.cPeak[c] = f; bs.cPeakYear[c] = s.year }
  if (f >= BATTLE.renown && bs.cRenowned[c] === 0) {
    bs.cRenowned[c] = 1
    bs.diag.renowned++
    return true
  }
  return false
}

/**
 * The battle of war w in which p strikes q's v from u (attacker: the war's attacker strikes; else a counterstroke), with
 * the war's odds r (after siege attrition), its outcome draw U, the army's path (or null), the front towns' dead and the
 * strengths A and D (war.ts strike). Records it and returns whether p won.
 */
export function battleFought(s: HistoryState, bs: BattleState, ps: PolityState, w: number, p: number, q: number, u: number, v: number, attacker: boolean, siege: boolean, r: number, U: number, path: readonly number[] | null, dead: number, A: number, D: number): boolean {
  const rng = bs.rng
  const b = bs.bWar.length
  const x = r * r, xs = 1 // (neutral; the modifiers of 3.3 enter here once tuned: battles#6)
  const won = U < x / (x + xs)
  // Kind.
  let kind: number = !attacker && relieves(ps, w, v) ? BattleKind.Relief : siege ? BattleKind.Siege : hasSea(s, path) ? BattleKind.Landing : BattleKind.Field
  // The fixed draws.
  const gDraw = rng.next(), wetDraw = rng.next(), fogDraw = rng.next(), surDraw = rng.next(), sideDraw = rng.next()
  // Commanders (appointment draws only when appointing; the striker's side first).
  while (bs.wBattles.length <= w) bs.wBattles.push(0)
  const sideP = p === ps.wAtt[w] ? 0 : 1
  const cA = commanderOf(s, bs, ps, w, sideP, p)
  const cD = commanderOf(s, bs, ps, w, 1 - sideP, q)
  const sA = bs.cSkill[cA], sD = bs.cSkill[cD]
  // Ground and site.
  const defChooses = gDraw < sD / (sA + sD)
  const site = pickSite(s, ps, path, u, v, kind, defChooses)
  let flags = siteFlags
  if (defChooses) bs.diag.groundByDefender++
  // Weather.
  const W = s.world
  const hv = s.harvest[s.weatherRegion[site]]
  const temp = W.temperature[site]
  let weather: number = BattleWeather.Clear
  if (wetDraw < BATTLE.rain * (0.5 + W.rainfall[site]) * (hv > 1.1 ? 1.5 : 1)) weather = temp < BATTLE.snowT ? BattleWeather.Snow : BattleWeather.Rain
  const fog = fogDraw < BATTLE.fog * (byWater(s, ps, site) ? 2 : 1)
  if (fog && weather === BattleWeather.Clear) weather = BattleWeather.Fog
  const bm = W.biome[site]
  if (weather === BattleWeather.Clear && temp > BATTLE.heatT && (bm === Biome.Desert || bm === Biome.Savanna)) weather = BattleWeather.Heat
  // Surprise.
  const cover = (flags & (BattleFlag.Wood | BattleFlag.Pass | BattleFlag.Hill)) !== 0
  const hi = sA > sD ? sA : sD, lo = sA > sD ? sD : sA
  if (surDraw < BATTLE.surprise * (fog ? 3 : 1) * (cover ? 2 : 1) * (hi / lo)) {
    let pd = 0.5 + 0.25 * (sD - sA)
    pd = pd < 0.25 ? 0.25 : pd > 0.75 ? 0.75 : pd
    flags |= BattleFlag.Surprise
    if (sideDraw < pd) { flags |= BattleFlag.SurpriseByDefender; if (kind === BattleKind.Field) kind = BattleKind.Ambush }
    bs.diag.surprises++
  }
  // Men.
  let menA = WAR.army * ps.pMass[p]
  if (menA < WAR.armyMin) menA = WAR.armyMin
  if (menA > WAR.armyMax) menA = WAR.armyMax
  const qA = qualityOf(s, u), qD = qualityOf(s, v)
  let menD = A > 0 ? (menA * (D / A) * qA) / qD : menA
  if (kind === BattleKind.Siege) menD /= wallFactor(ps, v, isCapital(ps, v))
  if (menD < WAR.armyMin * BATTLE.menDLo) menD = WAR.armyMin * BATTLE.menDLo
  if (menD > WAR.armyMax * BATTLE.menDHi) menD = WAR.armyMax * BATTLE.menDHi
  // Rout (losses only, never the outcome) and the Lanchester solution.
  const hU = horseOf(s, u), hV = horseOf(s, v)
  let hr = 1 + (won ? hU - hV : hV - hU)
  hr = hr < 0.5 ? 0.5 : hr > 2 ? 2 : hr
  const rho = BATTLE.rout * hr * ((flags & BattleFlag.Ford) !== 0 && !won ? 1.5 : 1) * (weather === BattleWeather.Snow || (flags & BattleFlag.Wood) !== 0 ? 0.6 : 1)
  const b0 = BATTLE.break0
  const res = resolve(x, xs, b0, b0, rho, U)
  const xe = res.xEff, fA = res.fA, fD = res.fD
  const lossA = fA * menA, lossD = fD * menD
  let hours = BATTLE.hourScale * res.tau
  if (hours < BATTLE.minHours) hours = BATTLE.minHours
  if (hours > BATTLE.maxHours) hours = BATTLE.maxHours
  // Course flags.
  const fW = won ? fA : fD, menW = won ? menA : menD, menL = won ? menD : menA
  if (b0 * rho >= BATTLE.pursuitLog) flags |= BattleFlag.Pursuit
  if (fW >= BATTLE.pyrrhic) flags |= BattleFlag.Pyrrhic
  if (menW < menL) flags |= BattleFlag.Outnumbered
  if (won) flags |= BattleFlag.TargetFell
  if (bs.cReign[cA] >= 0 || bs.cReign[cD] >= 0) { flags |= BattleFlag.RulerLed; bs.diag.rulerLed++ }
  const hW = won ? hU : hV, hL = won ? hV : hU
  if (hW > hL + BATTLE.flankHorse || (flags & BattleFlag.Surprise) !== 0 || xe > BATTLE.flankRatio || xe < 1 / BATTLE.flankRatio) flags |= BattleFlag.Flank
  // Siege laid (the first assault of a siege).
  const siegeYear = kind === BattleKind.Siege && attacker ? ps.wSiegeYears[w] : 0
  if (kind === BattleKind.Siege && attacker && ps.wSiegeYears[w] === 0 && ps.wSiege[w] === v) logEvent(s, EventType.SiegeLaid, v, u, w)
  // The fall of generals (2 draws always; rulers die by the rulers system's own draw while neutral).
  const slainADraw = rng.next(), slainDDraw = rng.next()
  let fell = false
  const fallOf = (c: number, beaten: boolean, draw: number): number => {
    if (bs.cReign[c] >= 0) return CommanderFate.Serving
    const slain = beaten ? BATTLE.slainLoser + BATTLE.slainRout * rho : BATTLE.slainWinner
    if (draw < slain) return CommanderFate.Slain
    if (beaten && draw < slain + BATTLE.taken) return CommanderFate.Taken
    return CommanderFate.Serving
  }
  const fateA = fallOf(cA, !won, slainADraw), fateD = fallOf(cD, won, slainDDraw)
  // Fame and service.
  const capA = ps.pCapital[p], capD = ps.pCapital[q]
  const enemyFameA = fameNow(bs, cD, s.year), enemyFameD = fameNow(bs, cA, s.year)
  const gainA = won ? fameGain(fD, menD, menA, isCapital(ps, v), enemyFameA) : 0
  const gainD = won ? 0 : fameGain(fA, menA, menD, false, enemyFameD)
  // Record the row (before the events that name it).
  bs.bWar.push(w); bs.bYear.push(s.year); bs.bKind.push(kind); bs.bCounter.push(attacker ? 0 : 1); bs.bSite.push(site); bs.bTarget.push(v); bs.bFrom.push(u)
  bs.bAtt.push(p); bs.bDef.push(q); bs.bCmdA.push(cA); bs.bCmdD.push(cD); bs.bMenA.push(menA); bs.bMenD.push(menD); bs.bLossA.push(lossA); bs.bLossD.push(lossD)
  bs.bDead.push(dead); bs.bWinner.push(won ? 0 : 1); bs.bHours.push(hours); bs.bWeather.push(weather); bs.bFlags.push(flags); bs.bRatio.push(xe)
  bs.bBreakA.push(b0); bs.bBreakD.push(b0); bs.bSiegeYear.push(siegeYear > 255 ? 255 : siegeYear)
  bs.diag.battles++
  bs.diag.byKind[kind]++
  bs.diag.byWeather[weather]++
  const first = bs.wBattles[w] === 0
  bs.wBattles[w]++
  const renA = served(s, bs, cA, b, won, gainA, u)
  const renD = served(s, bs, cD, b, !won, gainD, v)
  const fallen = (c: number, fate: number): void => {
    if (fate === CommanderFate.Serving) return
    bs.cFate[c] = fate; bs.cFateYear[c] = s.year; bs.cFateBattle[c] = b
    if (fate === CommanderFate.Slain) bs.diag.slain++
    else bs.diag.taken++
    fell = true
  }
  fallen(cA, fateA)
  fallen(cD, fateD)
  // The veteran recalled for the next war: a victorious general who is still serving.
  const winner = won ? cA : cD, wp = won ? p : q
  if (bs.cReign[winner] < 0 && bs.cFate[winner] === CommanderFate.Serving) {
    while (bs.pVeteran.length <= wp) bs.pVeteran.push(-1)
    const vet = bs.pVeteran[wp]
    if (vet < 0 || bs.cFate[vet] !== CommanderFate.Serving || bs.cPeak[winner] >= bs.cPeak[vet]) bs.pVeteran[wp] = winner
  }
  // A beaten general who survived may be relieved.
  const loser = won ? cD : cA
  let dismissed = false
  if (bs.cReign[loser] < 0 && bs.cFate[loser] === CommanderFate.Serving) {
    let k = bs.cFame[loser] / BATTLE.renown
    if (k > 1) k = 1
    if (rng.next() < BATTLE.dismiss * (1 - k)) {
      bs.cFate[loser] = CommanderFate.Dismissed; bs.cFateYear[loser] = s.year; bs.cFateBattle[loser] = b
      bs.diag.dismissed++
      dismissed = true
    }
  }
  // Events.
  if (menA + menD >= BATTLE.logMen || fell || won || first) logEx(s, EventType.BattleFought, v, u, b, kind | ((won ? 0 : 1) << 3))
  const fellEv = (c: number, fate: number): void => {
    if (fate !== CommanderFate.Serving && bs.cBattles[c] >= 2) logEx(s, EventType.CommanderFell, v, -1, c, fate === CommanderFate.Slain ? 0 : 1)
  }
  fellEv(cA, fateA)
  fellEv(cD, fateD)
  if (renA) logEvent(s, EventType.CommanderRenowned, v, capA, cA)
  if (renD) logEvent(s, EventType.CommanderRenowned, v, capD, cD)
  if (dismissed && bs.cPeak[loser] >= BATTLE.renown / 2) logEvent(s, EventType.CommanderDismissed, v, loser === cA ? capA : capD, loser)
  return won
}
