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
//             water), heat on a clear day in hot desert;
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
//
// Not neutral (battles#6, battles.md 3.3): the outcome is `U < x / (x + x*)` with x = r^2 M and
//   M = ground (T_target / T_site, field battles: the chosen ground replaces the target's) x cmd (skill_A / skill_D)
//       x supply ((0.8 + 0.2 fA) / (0.8 + 0.2 fD), f the front town's food, the marching side's x the regional harvest <= 1)
//       x sick (0.8 for a side whose war logged ArmyStricken against it in the last 2 years) x surprise (1 / 0.85^2 for the
//       side that surprised) x weather (the attackers at 0.9 in snow, 0.92 in heat); rain compresses x -> sqrt(x);
//   x* = (1 - bD^2) / (1 - bA^2), b = clamp(break0 - 0.1 (asab - 0.5) - zeal - famed + 0.1 min(1, exh), 0.6, 0.92) per side.
// Each factor is a ratio of the two sides' terms, so E ln M is near 0 by symmetry; battleStats measures it (target |E ln M|
// and |E ln x*| <= 0.05: a bias of 0.1 moves the attacker win rate by ~0.01, battles.md 1.3).
// The toll (3.5, 3.12): 'split' keeps the front towns' total (WAR.battle of both) and shares it by casualties (each town
// pays at most 2 WAR.battle of its people); 'escalate' keeps half of that and adds kill x the casualties of the unclamped
// armies (WAR.army x mass: realm-scaled) x the coalition, charged to the front town then spread over the side's members by
// population (levies), capped at realmCap of the realm a battle.

import { BattleFlag, BattleKind, BattleWeather, Biome, CommanderFate, EventType, ReignEnd } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { logEvent } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { horseOf, isCapital, qualityOf, wallFactor } from '../polity/state.ts'
import { WAR } from '../polity/params.ts'
import { membersOf } from '../polity/realm.ts'
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
export function served(s: HistoryState, bs: BattleState, c: number, b: number, won: boolean, gain: number, base: number): boolean {
  bs.cBattles[c]++
  bs.cLast[c] = s.year
  bs.cLastBattle[c] = b
  bs.cBase[c] = base
  if (bs.cHome[c] < 0) bs.cHome[c] = base
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

/** Whether the side of polity x in war w is the war's attacker's (0) or defender's (1). */
function sideOf(ps: PolityState, w: number, x: number): number {
  return x === ps.wAtt[w] ? 0 : 1
}

/** ArmyStricken (disease) since the last scan: the stricken side of each war (value the war, other the army's town). */
function scanSick(s: HistoryState, bs: BattleState, ps: PolityState): void {
  const ev = s.events
  for (let i = bs.evSeen; i < ev.length; i++) {
    const e = ev[i]
    if (e.type !== EventType.ArmyStricken) continue
    const w = e.value
    if (w < 0 || w >= ps.wAtt.length) continue
    while (bs.wSick.length < 2 * (w + 1)) bs.wSick.push(-9999)
    const px = e.other >= 0 ? ps.polity[e.other] : ps.wAtt[w]
    bs.wSick[2 * w + sideOf(ps, w, px)] = e.year
  }
  bs.evSeen = ev.length
  const rel = s.rel
  if (rel !== null) { for (let i = bs.holySeen; i < rel.holyWars.length; i++) bs.holy.add(rel.holyWars[i]); bs.holySeen = rel.holyWars.length }
}

function sickOf(bs: BattleState, w: number, side: number, year: number): boolean {
  const i = 2 * w + side
  return i < bs.wSick.length && year - bs.wSick[i] <= BATTLE.sickYears
}

/** A side's break fraction (morale): cohesion of its front town, holy zeal, a famous commander, exhaustion. */
function breakOf(ps: PolityState, bs: BattleState, town: number, x: number, zealous: boolean, cmd: number): number {
  let e = ps.pExh[x]
  if (e > 1) e = 1
  const b = BATTLE.break0 - BATTLE.asabK * (ps.asab[town] - 0.5) - (zealous ? BATTLE.zeal : 0) - (bs.cRenowned[cmd] === 1 ? BATTLE.famed : 0) + BATTLE.exhK * e
  return b < BATTLE.breakMin ? BATTLE.breakMin : b > BATTLE.breakMax ? BATTLE.breakMax : b
}

function food01(s: HistoryState, i: number): number {
  const f = s.food[i]
  return f < 0 ? 0 : f > 1 ? 1 : f
}

/** Other active wars p or q fight this year (the coalition's armies), capped. */
function linkedWars(ps: PolityState, w: number, p: number, q: number): number {
  let n = 0
  for (let k = 0; k < ps.activeWars.length; k++) {
    const x = ps.activeWars[k]
    if (x === w || ps.wEnd[x] >= 0) continue
    const a = ps.wAtt[x], d = ps.wDef[x]
    if (a === p || d === p || a === q || d === q) n++
  }
  return n > BATTLE.coalitionMax ? BATTLE.coalitionMax : n
}

/** Deducts `amount` from p's members other than `skip`, by population, capped at realmCap of p; returns what was taken. */
function levyDead(s: HistoryState, ps: PolityState, p: number, skip: number, amount: number): number {
  if (amount <= 0) return 0
  const cap = BATTLE.realmCap * ps.pPop[p]
  if (amount > cap) amount = cap
  const ms = membersOf(s, ps, p)
  let tot = 0
  for (let k = 0; k < ms.length; k++) if (ms[k] !== skip) tot += s.pop[ms[k]]
  if (tot <= 0) return 0
  let k0 = amount / tot
  if (k0 > 0.5) k0 = 0.5
  let taken = 0
  for (let k = 0; k < ms.length; k++) {
    const m = ms[k]
    if (m === skip) continue
    const d = s.pop[m] * k0
    s.pop[m] -= d
    taken += d
  }
  return taken
}

/**
 * The battle of war w in which p strikes q's v from u (attacker: the war's attacker strikes; else a counterstroke), with
 * the war's odds r (after siege attrition), its outcome draw U, the army's path (or null), the front towns' dead (lu, lv:
 * WAR.battle of each) and the strengths A and D (war.ts strike). Records it and returns whether p won. Not neutral, the
 * toll war.ts deducts is left in bs.tollU / tollV (the front towns) and bs.realmP / realmQ (levies, already deducted).
 */
export function battleFought(s: HistoryState, bs: BattleState, ps: PolityState, w: number, p: number, q: number, u: number, v: number, attacker: boolean, siege: boolean, r: number, U: number, path: readonly number[] | null, lu: number, lv: number, A: number, D: number): boolean {
  const rng = bs.rng
  const b = bs.bWar.length
  const neutral = bs.neutral
  if (!neutral) scanSick(s, bs, ps)
  // Kind.
  let kind: number = !attacker && relieves(ps, w, v) ? BattleKind.Relief : siege ? BattleKind.Siege : hasSea(s, path) ? BattleKind.Landing : BattleKind.Field
  // The fixed draws.
  const gDraw = rng.next(), wetDraw = rng.next(), fogDraw = rng.next(), surDraw = rng.next(), sideDraw = rng.next()
  // Commanders (appointment draws only when appointing; the striker's side first).
  while (bs.wBattles.length <= w) bs.wBattles.push(0)
  while (bs.wDecisive.length <= w) bs.wDecisive.push(-1)
  const sideP = sideOf(ps, w, p)
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
  if (weather === BattleWeather.Clear && temp > BATTLE.heatT && bm === Biome.Desert) weather = BattleWeather.Heat
  // Surprise.
  const cover = (flags & (BattleFlag.Wood | BattleFlag.Pass | BattleFlag.Hill)) !== 0
  const hi = sA > sD ? sA : sD, lo = sA > sD ? sD : sA
  let surprise = 0 // (1 the attackers surprised the defenders, -1 the defenders the attackers)
  if (surDraw < BATTLE.surprise * (fog ? 3 : 1) * (cover ? 2 : 1) * (hi / lo)) {
    let pd = 0.5 + 0.25 * (sD - sA)
    pd = pd < 0.25 ? 0.25 : pd > 0.75 ? 0.75 : pd
    flags |= BattleFlag.Surprise
    if (sideDraw < pd) { flags |= BattleFlag.SurpriseByDefender; surprise = -1; if (kind === BattleKind.Field) kind = BattleKind.Ambush }
    else surprise = 1
    bs.diag.surprises++
  }
  // The odds (battles.md 3.3): neutral, today's x = r^2 against x* = 1.
  let x = r * r, xs = 1, bA: number = BATTLE.break0, bD: number = BATTLE.break0
  if (!neutral) {
    const field = kind === BattleKind.Field || kind === BattleKind.Ambush || kind === BattleKind.Landing
    const tSite = ps.defense[site] + (defChooses && (flags & BattleFlag.Ford) !== 0 ? BATTLE.fordBonus : 0)
    const mGround = field ? ps.defense[s.cell[v]] / tSite : 1
    const mCmd = sA / sD
    let hc = hv < 1 ? hv : 1
    if (hc < 0) hc = 0
    const sb = BATTLE.supplyBase
    const mSupply = (sb + (1 - sb) * food01(s, u) * hc) / (sb + (1 - sb) * food01(s, v))
    const sickA = sickOf(bs, w, sideP, s.year), sickD = sickOf(bs, w, 1 - sideP, s.year)
    const mSick = (sickA ? BATTLE.sick : 1) / (sickD ? BATTLE.sick : 1)
    const sv = 1 / ((1 - BATTLE.surpriseLoss) * (1 - BATTLE.surpriseLoss))
    const mSurprise = surprise > 0 ? sv : surprise < 0 ? 1 / sv : 1
    const mWeather = weather === BattleWeather.Snow ? BATTLE.snowMul : weather === BattleWeather.Heat ? BATTLE.heatMul : 1
    x = x * mGround * mCmd * mSupply * mSick * mSurprise * mWeather
    const rain = weather === BattleWeather.Rain || weather === BattleWeather.Snow
    let mRain = 1
    if (rain) { const x1 = Math.sqrt(x); const x2 = x1 * Math.sqrt(x1); mRain = x2 / x; x = x2 } // (mud and wet strings blunt horse and missile alike: the advantage is compressed, x -> x^(3/4))
    const holy = bs.holy.has(w)
    const att = ps.wAtt[w]
    bA = breakOf(ps, bs, u, p, holy && p === att, cA)
    bD = breakOf(ps, bs, v, q, holy && q === att, cD)
    xs = (1 - bD * bD) / (1 - bA * bA)
    bs.diag.factors.push(mGround, mCmd, mSupply, mSick, mSurprise, mWeather, xs, mRain)
  }
  const won = U < x / (x + xs)
  // Men.
  let men0 = WAR.army * ps.pMass[p]
  let menA = men0
  if (menA < WAR.armyMin) menA = WAR.armyMin
  if (menA > WAR.armyMax) menA = WAR.armyMax
  const qA = qualityOf(s, u), qD = qualityOf(s, v)
  const ratioD = A > 0 ? ((D / A) * qA) / qD : 1
  let menD = menA * ratioD
  if (kind === BattleKind.Siege) menD /= wallFactor(ps, v, isCapital(ps, v))
  if (menD < WAR.armyMin * BATTLE.menDLo) menD = WAR.armyMin * BATTLE.menDLo
  if (menD > WAR.armyMax * BATTLE.menDHi) menD = WAR.armyMax * BATTLE.menDHi
  // Rout (losses only, never the outcome) and the Lanchester solution.
  const hU = horseOf(s, u), hV = horseOf(s, v)
  let hr = 1 + (won ? hU - hV : hV - hU)
  hr = hr < 0.5 ? 0.5 : hr > 2 ? 2 : hr
  const rho = BATTLE.rout * hr * ((flags & BattleFlag.Ford) !== 0 && !won ? 1.5 : 1) * (weather === BattleWeather.Snow || (flags & BattleFlag.Wood) !== 0 ? 0.6 : 1)
  const res = resolve(x, xs, bA, bD, rho, U)
  const xe = res.xEff
  let fA = res.fA, fD = res.fD
  if (!neutral) {
    // The opening volley of a surprise, before the square-law phase; a decisive defeat annihilates part of what is left.
    const sl = BATTLE.surpriseLoss
    if (surprise > 0) fD = sl + (1 - sl) * fD
    else if (surprise < 0) fA = sl + (1 - sl) * fA
    if (xe > BATTLE.annihilateRatio && won) fD += BATTLE.annihilate * (1 - fD)
    else if (xe < 1 / BATTLE.annihilateRatio && !won) fA += BATTLE.annihilate * (1 - fA)
  }
  const lossA = fA * menA, lossD = fD * menD
  let hours = BATTLE.hourScale * res.tau
  if (hours < BATTLE.minHours) hours = BATTLE.minHours
  if (hours > BATTLE.maxHours) hours = BATTLE.maxHours
  // Course flags.
  const fW = won ? fA : fD, fL = won ? fD : fA, menW = won ? menA : menD, menL = won ? menD : menA
  const bL = won ? bD : bA
  if (bL * rho >= BATTLE.pursuitLog) flags |= BattleFlag.Pursuit
  if (fW >= BATTLE.pyrrhic) flags |= BattleFlag.Pyrrhic
  if (menW < menL) flags |= BattleFlag.Outnumbered
  if (won) flags |= BattleFlag.TargetFell
  if (bs.cReign[cA] >= 0 || bs.cReign[cD] >= 0) { flags |= BattleFlag.RulerLed; bs.diag.rulerLed++ }
  const hW = won ? hU : hV, hL = won ? hV : hU
  if (hW > hL + BATTLE.flankHorse || (flags & BattleFlag.Surprise) !== 0 || xe > BATTLE.flankRatio || xe < 1 / BATTLE.flankRatio) flags |= BattleFlag.Flank
  // The toll (not neutral): the front towns' total shared by casualties, and (escalate) the levies of the realm.
  let dead = lu + lv
  if (!neutral && bs.toll !== 'baseline') {
    const share = lossA + lossD > 0 ? lossA / (lossA + lossD) : 0.5
    const capU = 2 * WAR.battle * s.pop[u], capV = 2 * WAR.battle * s.pop[v]
    const esc = bs.toll === 'escalate'
    const T = (lu + lv) * (esc ? 1 - BATTLE.realmShare : 1)
    let tu = T * share, tv = T - tu
    if (tu > capU) { tv += tu - capU; tu = capU }
    if (tv > capV) { tu += tv - capV; tv = capV; if (tu > capU) tu = capU }
    let rp = 0, rq = 0
    if (esc) {
      // casualties of the unclamped armies (the realm's mass, not the Journey's display clamp)
      const mA = men0 > WAR.armyMin ? men0 : WAR.armyMin
      const mD = (kind === BattleKind.Siege ? (mA * ratioD) / wallFactor(ps, v, isCapital(ps, v)) : mA * ratioD)
      const cas = fA * mA + fD * mD
      // escalation: the war's mobilisation grows by BATTLE.escalate a war-year (Clauset et al. 2025's multiplicative
      // escalation; with near-exponential durations this gives the power-law tail of war sizes), up to escalateMax
      let esc = 1
      for (let y = ps.wStart[w]; y < s.year && esc < BATTLE.escalateMax; y++) esc *= 1 + BATTLE.escalate
      if (esc > BATTLE.escalateMax) esc = BATTLE.escalateMax
      const realm = BATTLE.realmShare * BATTLE.kill * cas * esc * (1 + BATTLE.coalition * linkedWars(ps, w, p, q))
      let ra = realm * share, rd = realm - ra
      // the front towns first (up to their caps), then the levies of the rest of the realm
      const roomU = capU - tu, roomV = capV - tv
      const au = ra < roomU ? ra : roomU, av = rd < roomV ? rd : roomV
      tu += au; tv += av; ra -= au; rd -= av
      rp = levyDead(s, ps, p, u, ra)
      rq = levyDead(s, ps, q, v, rd)
      bs.diag.realmDead += rp + rq
    }
    bs.tollU = tu; bs.tollV = tv; bs.realmP = rp; bs.realmQ = rq
    dead = tu + tv + rp + rq
  } else { bs.tollU = lu; bs.tollV = lv; bs.realmP = 0; bs.realmQ = 0 }
  // Siege laid (the first assault of a siege).
  const siegeYear = kind === BattleKind.Siege && attacker ? ps.wSiegeYears[w] : 0
  if (kind === BattleKind.Siege && attacker && ps.wSiegeYears[w] === 0 && ps.wSiege[w] === v) logEvent(s, EventType.SiegeLaid, v, u, w)
  // The fall of commanders (2 draws always). Neutral: rulers die by the rulers system's own draw (linked at assembly).
  const slainADraw = rng.next(), slainDDraw = rng.next()
  let fell = false
  const fallOf = (c: number, beaten: boolean, draw: number): number => {
    if (bs.cReign[c] >= 0 && neutral) return CommanderFate.Serving
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
  bs.bBreakA.push(bA); bs.bBreakD.push(bD); bs.bSiegeYear.push(siegeYear > 255 ? 255 : siegeYear)
  bs.diag.battles++
  bs.diag.byKind[kind]++
  bs.diag.byWeather[weather]++
  const first = bs.wBattles[w] === 0
  bs.wBattles[w]++
  const renA = served(s, bs, cA, b, won, gainA, u)
  const renD = served(s, bs, cD, b, !won, gainD, v)
  bs.cWar[cA] = w; bs.cWar[cD] = w
  let rulerFell = false
  const fallen = (c: number, fate: number, x: number): void => {
    if (fate === CommanderFate.Serving) return
    bs.cFate[c] = fate; bs.cFateYear[c] = s.year; bs.cFateBattle[c] = b
    if (fate === CommanderFate.Slain) bs.diag.slain++
    else bs.diag.taken++
    fell = true
    // a ruler slain or taken in the field: his reign ends this year (rulerYear runs after the campaigns)
    const R = s.rul
    if (bs.cReign[c] >= 0 && R !== null && x < R.pcap && R.cur[x] === bs.cReign[c] && R.kill[x] === 0) { R.kill[x] = ReignEnd.Battle; bs.diag.rulersFell++; rulerFell = true }
  }
  fallen(cA, fateA, p)
  fallen(cD, fateD, q)
  // A decisive battle (C6 factor 4, tempo): a pursuit that cost the beaten side dearly, or a ruler fallen.
  if (!neutral && (fL >= BATTLE.decisiveLoss || rulerFell)) { bs.wDecisive[w] = s.year; bs.diag.decisive++ }
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
  if (menA + menD >= BATTLE.logMen || fell || (won && siege) || first) logEx(s, EventType.BattleFought, v, u, b, kind | ((won ? 0 : 1) << 3))
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

/** Tempo (C6 factor 4): whether war w saw a decisive battle this year. */
export function battleDecisive(bs: BattleState, w: number, year: number): boolean {
  return w < bs.wDecisive.length && bs.wDecisive[w] === year
}
