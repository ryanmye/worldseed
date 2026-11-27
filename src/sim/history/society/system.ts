// society: classes, wages and rents, elites and the secular cycle (society-secular-cycles.md §2). Per polity, every POLITY.step
// (after cohesionStep, before unrestStep), four classes and their incomes are read off what the sim already has (people, the
// food it can count on, towns, wealth, merchant capital, the church, the crown's revenue); two slow state variables evolve (the
// elite share ε and the lords' coercion κ); Goldstone's political stress Ψ = MMP · EMP · SFD is formed and read by the hooks
// (h1-h7, society/api.ts) inside the existing single draws. A yearly scan of the event log (socYear, after rulerYear) counts
// the internal violence each realm suffered and thins its elites (only violence, or a very slow decline, resets them).
//
// Sources (design defaults are tagged in params.ts):
// - Goldstone, J. A. (1991) Revolution and Rebellion in the Early Modern World, pp. 141-145: Ψ = MMP · EMP · SFD (as credited in
//   Turchin 2013). Turchin, P. (2013) "Modeling social pressures toward political instability", Cliodynamics 4(2):241-280,
//   doi:10.21237/C7clio4221333: MMP = w⁻¹ · N_urb/N · A₂₀₋₂₉, EMP = ε⁻¹ · E/(sN), SFD = (Y/G) · D. (This file's ε, the elite
//   share, and o = ε/ε* are its own design, not Turchin's notation.)
// - Turchin, P. (2003) Historical Dynamics, ch. 7-8; Turchin & Nefedov (2009) Secular Cycles: the four phases, elite
//   overproduction, the fathers-and-sons refractory period (memDamp), disorder lowering carrying capacity (h7). Periodicity is
//   contested; no clock is built in: the cycle, if any, comes from the feedbacks.
// - Brenner, R. (1976) Past & Present 70:30-75; Domar, E. (1970) J. Econ. Hist. 30(1):18-32: labour scarcity binds peasants
//   (second serfdom) where lords are strong, frees them where they are weak (coercion κ).
// - Malthusian wage on land: Malthus (1798), Clark (2007), Ashraf & Galor (2011) AER 101(5); Cobb-Douglas form (Cobb & Douglas 1928).
// Arithmetic: + - * / only (η = 1 avoids pow; squares are products). Fixed orders: ps.alive ascending, s.living, the log.

import { EventType, PolityEnd, PolityOrigin, ReignEnd, SecularPhase, WarOutcome } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { clampAsab } from '../polity/state.ts'
import { POLITY } from '../polity/params.ts'
import { aggregatePass } from '../polity/aggregates.ts'
import { polityFaith } from '../religion/system.ts'
import { finMonetised, finRevenue, finSFD } from '../finance/hooks.ts'
import { SOC } from './params.ts'
import type { SocietyState } from './state.ts'
import { ensureSocPolities, ensureSocSettlements } from './state.ts'
import { foodBase } from '../migration.ts'

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)
const r3 = (x: number): number => Math.round(x * 1000) / 1000

function logX(s: HistoryState, type: number, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type: type as EventType, settlement, other, value, extra })
}

/** Organisation of p's church 0..1 (0.5 without religion or a faith). */
function orgOf(s: HistoryState, p: number): number {
  const rel = s.rel
  if (rel === null) return 0.5
  const f = polityFaith(s, rel, p)
  return f >= 0 && f < rel.org.length ? rel.org[f] : 0.5
}

/** Crown revenue a year: finRevenue when monetised, else 0.02 · the capital's wealth (a year's income, trade.ts settle). */
function revenueOf(s: HistoryState, ps: PolityState, p: number): number {
  if (s.fin !== null && finMonetised(s, p)) return finRevenue(s, p)
  return 0.02 * s.wealth[ps.pCapital[p]]
}

/** The hazard multiplier m(Ψ) with the fathers-and-sons damping. */
export function hazardMul(psi: number, mem: number): number {
  const S = SOC
  const q = psi * psi
  return (S.mLow + ((S.mHigh - S.mLow) * q) / (q + S.psiHalf * S.psiHalf)) * (1 - S.memDamp * (mem < 1 ? mem : 1))
}

/** Peasant real wage, urban wage and rent a commoner for crowding ĉ, coercion κ, tithe τ and trade income ι (§2.4). */
export function wagesAt(chat: number, kappa: number, tau: number, iota: number): { w: number; wU: number; r: number; y: number } {
  const S = SOC
  const y = 1 / (S.alpha * (chat > 0.05 ? chat : 0.05))
  const w = S.alpha * y * (1 - S.chi * kappa) * (1 - tau)
  const wU = (S.urbPrem * w * (1 + (S.urbShare * iota) / (iota + 1))) / (1 + S.urbCrowd * (chat > 1 ? chat - 1 : 0))
  const r = (1 - S.alpha) * y + S.alpha * y * S.chi * kappa
  return { w, wU, r, y }
}

/**
 * Coercion one step on (Brenner 1976; Domar 1970): when labour is scarce (scar > 0) lords bind it if their power λ beats the
 * peasants' π (κ rises) and lose their grip if not; when land is full, coercion decays (the market gives rents).
 */
export function kappaStep(kap: number, scar: number, lam: number, pi: number, step: number): number {
  const S = SOC
  const kStar = scar > 0 ? clamp(kap + S.kUp * scar * (lam - pi), 0, 1) : kap * (1 - S.kDown)
  return clamp(kap + S.kRate2 * step * (kStar - kap), 0, 1)
}

/** newPolity hook (before the rulers'): its elites and coercion from the parent; the land and the rest at its first step. */
export function socNewPolity(soc: SocietyState, p: number, origin: number, parent: number): void {
  ensureSocPolities(soc, p + 1)
  soc.init[p] = 0
  const S = SOC
  if (parent >= 0 && parent < soc.pcap && soc.eps[parent] > 0) {
    soc.eps[p] = origin === PolityOrigin.CivilWar ? clamp(soc.eps[parent] * (1 + S.factionTake), S.epsMin, S.epsMax) : soc.eps[parent]
    soc.kappa[p] = soc.kappa[parent]
    soc.serf[p] = soc.serf[parent]
  } else soc.eps[p] = S.epsNew * S.eps0
}

/** Thin p's elites by `f` (a share). */
function thin(soc: SocietyState, p: number, f: number): void {
  if (p < 0 || p >= soc.pcap || f <= 0) return
  const e = soc.eps[p]
  let n = e * (1 - f)
  if (n < SOC.epsMin) n = SOC.epsMin
  soc.eps[p] = n
  soc.diag.thinTotal += e - n
  if (soc.init[p] === 1) soc.ePeak[p] *= 1 - f // (the share left after this window's thinning; the step resets it when the window has passed)
}

/** Instability weight w at p, with thinning f. */
function hit(soc: SocietyState, ps: PolityState, p: number, w: number, f: number): void {
  if (p < 0 || p >= ps.P) return
  if (p >= soc.pcap) ensureSocPolities(soc, p + 1)
  soc.instY[p] += w
  soc.diag.inst += w
  thin(soc, p, f)
}

/**
 * Yearly (after rulerYear): the event scan from soc.evSeen. Weights (§2.6): Revolt 1 (+1 won), SuccessionCrisis 1, CivilWar 3,
 * Partitioned 2, ReignEnded Overthrown/Deposed 1, PolityEnded Fragmented 3; a lost war thins without counting. The latest
 * epidemic strike among each realm's members (LabourDear's "after the pestilence").
 */
export function socYear(s: HistoryState, ps: PolityState, soc: SocietyState): void {
  const S = SOC
  const ev = s.events
  ensureSocPolities(soc, ps.P)
  for (let k = soc.evSeen; k < ev.length; k++) {
    const e = ev[k]
    switch (e.type) {
      case EventType.Revolt: {
        if (e.other < 0) break
        const p = ps.polity[e.other]
        const n = k + 1 < ev.length ? ev[k + 1] : null
        const won = !(n !== null && n.type === EventType.RevoltCrushed && n.settlement === e.settlement)
        hit(soc, ps, p, won ? 2 : 1, won ? S.thinRevolt : 0) // (crushed revolts kill rebels, not lords)
        if (won && p >= 0) soc.won[p] += 1
        break
      }
      case EventType.SuccessionCrisis: hit(soc, ps, e.value, 1, S.thinCrisis); break
      case EventType.CivilWar: if (e.other >= 0) hit(soc, ps, ps.polity[e.other], 3, S.thinCivil); break
      case EventType.Partitioned: hit(soc, ps, e.value, 2, S.thinPartition); break
      case EventType.ReignEnded:
        if (e.extra === ReignEnd.Overthrown || e.extra === ReignEnd.Deposed) hit(soc, ps, e.settlement >= 0 ? ps.polity[e.settlement] : -1, 1, S.thinOverthrow)
        break
      case EventType.PolityEnded:
        if (e.value >= 0 && e.value < ps.P && ps.pEnd[e.value] === PolityEnd.Fragmented) hit(soc, ps, e.value, 3, S.thinFrag)
        break
      case EventType.PeaceMade: {
        const w = e.value
        if (w < 0 || w >= ps.wOutcome.length) break
        const out = ps.wOutcome[w]
        const loser = out === WarOutcome.DefenderGains ? ps.wAtt[w] : out === WarOutcome.AttackerGains || out === WarOutcome.Conquest || out === WarOutcome.Tribute || out === WarOutcome.Vassalage ? ps.wDef[w] : -1
        if (loser >= 0 && ps.pEnded[loser] < 0) thin(soc, loser, S.thinLost)
        break
      }
      case EventType.GreatEpidemic: case EventType.CityStricken: {
        const p = e.settlement >= 0 && e.settlement < ps.polity.length ? ps.polity[e.settlement] : -1
        if (p >= 0 && p < soc.pcap) { soc.epiAt[p] = e.settlement; soc.epiYear[p] = s.year }
        break
      }
    }
  }
  soc.evSeen = ev.length
}

/** Every POLITY.step (after cohesionStep, before unrestStep): classes, ε, κ, Ψ, phases and their events; h6 erosion. */
export function societyStep(s: HistoryState, ps: PolityState, soc: SocietyState): void {
  const S = SOC
  const step = POLITY.step
  const year = s.year
  ensureSocPolities(soc, ps.P)
  aggregatePass(s, ps, soc.agg)
  const A = soc.agg
  // K̄: each settlement's slow capacity, summed over the members (land does not vanish when hands die).
  ensureSocSettlements(soc, s.count)
  const kS = soc.kS, kb = soc.kBar
  for (const p of ps.alive) kb[p] = 0
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const f = foodBase(s, id)
    kS[id] = kS[id] > 0 ? kS[id] + step * S.kRate * (f - kS[id]) : f
    const p = ps.polity[id]
    if (p >= 0) kb[p] += kS[id]
  }
  const R = soc.RING
  const head = soc.ringAt
  const lagSlot = (head - S.lagSteps + R) % R, y20 = (head - 4 + R) % R
  const D = soc.diag
  for (const p of ps.alive) {
    if (ps.pEnded[p] >= 0) continue
    const L = A.pop[p]
    if (!(L > 0) || !(soc.kBar[p] > 0)) continue
    const fresh = soc.init[p] === 0
    if (fresh) {
      if (!(soc.eps[p] > 0)) soc.eps[p] = S.epsNew * S.eps0
      for (let k = 0; k < R; k++) soc.ring[p * R + k] = L / (S.cRef * soc.kBar[p])
      soc.initYear[p] = year
      soc.ePeak[p] = 1; soc.ePeakYear[p] = year
      soc.phase[p] = SecularPhase.Expansion; soc.phaseSince[p] = year
    }
    const age = (year - soc.initYear[p]) / step // steps of history
    // Disorder and the violence memory from last step's instability.
    const inst = soc.instY[p]
    soc.instY[p] = 0
    let dis = S.disKeep * soc.dis[p] + S.disGain * inst
    if (dis > 1) dis = 1
    soc.dis[p] = dis
    soc.mem[p] = S.memKeep * soc.mem[p] + S.memGain * inst
    soc.won[p] *= S.wonKeep
    // Classes and incomes (§2.4).
    const chat = L / (S.cRef * soc.kBar[p])
    const iota = (0.02 * A.wealth[p]) / L
    const org = orgOf(s, p)
    const tau = S.tithe * (0.5 + org)
    const kap = soc.kappa[p]
    const { w, wU, r, y } = wagesAt(chat, kap, tau, iota)
    const rev = revenueOf(s, ps, p)
    let sigma = r + S.urbTake * iota + (S.office * rev) / L - tau * y
    if (sigma < 0.01) sigma = 0.01
    const eStar = sigma / (sigma + S.e0)
    const eps = soc.eps[p]
    const o = eps / eStar
    soc.chat[p] = chat; soc.trade[p] = iota; soc.tau[p] = tau; soc.cler[p] = S.clergy0 * (0.5 + org)
    soc.w[p] = w; soc.wU[p] = wU; soc.rent[p] = r / ((1 - S.alpha) / S.alpha); soc.o[p] = o
    const u = A.town[p] / L
    soc.urb[p] = u
    soc.L[p] = L
    // Elites (per step, as a product): γ = gUp · max(0, 1 − o_lag) + gFloor − gDown · max(0, o − 1) + mobility.
    const oLag = !fresh && age >= S.lagSteps ? soc.oRing[p * R + lagSlot] : o
    const mobY = (S.mob * iota) / (iota + S.mobHalf)
    const g = S.gUp * (oLag < 1 ? 1 - oLag : 0) + S.gFloor - S.gDown * (o > 1 ? o - 1 : 0) + mobY
    // (in a crisis of the social order the great houses also fall by feud, attainder and ruin that no single event records)
    const att = soc.phase[p] === SecularPhase.Crisis ? 1 - step * S.crisisAttr : 1
    const eNew = clamp(eps * (1 + step * g) * att, S.epsMin, S.epsMax)
    if (att < 1) D.thinTotal += eps * (1 + step * g) - eNew
    soc.eps[p] = eNew
    soc.mobAcc[p] += step * mobY * eps
    // Coercion κ (Brenner 1976; Domar 1970).
    const A_p = ps.pAsab[p]
    const scar = smoothstep(S.scarLow, S.scarHigh, chat)
    const lam = A_p * (1 - 0.5 * u) * (0.5 + 0.5 * (o < 1 ? o : 1))
    const wonN = soc.won[p] / 2
    const pi = 0.3 + 0.4 * (1 - kap) + 0.3 * (wonN < 1 ? wonN : 1)
    const kNew = kappaStep(kap, scar, lam, pi, step)
    soc.kappa[p] = kNew
    soc.scar[p] = scar; soc.lam[p] = lam; soc.pi[p] = pi
    const cap = ps.pCapital[p]
    if (soc.serf[p] === 0 && kNew >= S.serfOn) { soc.serf[p] = 1; logX(s, EventType.SerfdomImposed, cap, -1, p, r3(kNew)); D.serfOn++ }
    else if (soc.serf[p] === 1 && kNew <= S.serfOff) { soc.serf[p] = 0; logX(s, EventType.SerfdomEnded, cap, -1, p, r3(kap)); D.serfOff++ }
    // Ψ (§2.5).
    const imm = clamp(1 / w, 0.3, 4)
    const urbF = clamp(1 + S.mmpUrb * (u - S.uRef), 0.6, 2)
    let youth = 1
    if (!fresh && age >= R) {
      const l20 = soc.ring[p * R + y20], l40 = soc.ring[p * R + head] // (crowding, not people: conquest is no youth bulge)
      const gr = l40 > 0 ? l20 / l40 - 1 : 0
      youth = clamp(1 + (S.mmpYouth * (gr > 0 ? gr : 0)) / S.youthRef, 1, 2)
    }
    const mmp = imm * urbF * youth
    const emp = o * clamp(1 + S.empAsab * (S.aRef - A_p), 0.5, 1.6)
    let fisc = finSFD(s, ps, p)
    if (!finMonetised(s, p)) fisc += S.sfdOver * (o > 1 ? o - 1 : 0)
    const sfd = fisc * clamp(1 + S.sfdAsab * (S.aRef - A_p), 0.6, 1.5)
    const psi = mmp * emp * sfd
    soc.mmp[p] = mmp; soc.emp[p] = emp; soc.sfd[p] = sfd; soc.psi[p] = psi
    soc.m[p] = hazardMul(psi, soc.mem[p])
    const mU = clamp(1 / wU, 0.3, 4) * urbF * youth
    soc.urbP[p] = smoothstep(1, 2, mU) * (u / (u + 0.1))
    // LabourDear: the wage well above its smoothed level.
    if (fresh) soc.wSm[p] = w
    else {
      if (w >= S.dearRise * soc.wSm[p] && year - soc.lastDear[p] >= S.dearGap) {
        soc.lastDear[p] = year
        const epi = year - soc.epiYear[p] <= 10 && soc.epiAt[p] >= 0 ? soc.epiAt[p] : -1
        logX(s, EventType.LabourDear, cap, epi, p, r3(w / soc.wSm[p]))
        D.dear++
      }
      soc.wSm[p] += S.wSmRate * step * (w - soc.wSm[p])
    }
    // Factions (hysteresis on EMP).
    if (soc.fact[p] === 0 && emp >= S.factOn) { soc.fact[p] = 1; logX(s, EventType.EliteFactions, cap, -1, p, r3(emp)); D.factions++ }
    else if (soc.fact[p] === 1 && emp < S.factOff) soc.fact[p] = 0
    // EliteThinned: thinning in the window took >= thinEvent of the nobility.
    if (soc.ePeak[p] <= 1 - S.thinEvent) {
      logX(s, EventType.EliteThinned, cap, -1, p, r3(1 - soc.ePeak[p]))
      D.thinned++
      soc.ePeak[p] = 1; soc.ePeakYear[p] = year
    } else if (year - soc.ePeakYear[p] > S.thinYears) { soc.ePeak[p] = 1; soc.ePeakYear[p] = year }
    // Ennobled: merchants bought their way in.
    if (soc.mobAcc[p] >= S.nobleAcc) {
      const town = A.top[p] >= 0 ? A.top[p] : cap
      logX(s, EventType.Ennobled, town, cap, -1, r3(soc.mobAcc[p]))
      soc.mobAcc[p] = 0
      soc.lastNoble[p] = year
      D.ennobled++
    }
    // Phases (§2.8).
    const ph = soc.phase[p]
    let nph = ph
    if (psi >= S.psiHigh || dis >= S.dCrisis) nph = SecularPhase.Crisis
    else if (ph === SecularPhase.Crisis) nph = SecularPhase.Depression
    else if (ph === SecularPhase.Depression) { if (psi < S.psiLow && dis < S.dLow) nph = SecularPhase.Expansion }
    else if (ph === SecularPhase.Expansion) { if (o >= 1 && psi >= S.psiLow) nph = SecularPhase.Stagflation }
    else if (ph === SecularPhase.Stagflation && o < 0.9) nph = SecularPhase.Expansion
    if (nph !== ph) {
      soc.phase[p] = nph; soc.phaseSince[p] = year
      if (nph === SecularPhase.Crisis && ph !== SecularPhase.Depression) { logX(s, EventType.SocialPhase, cap, -1, p, SecularPhase.Crisis); D.crises++ }
      else if (nph === SecularPhase.Expansion && ph === SecularPhase.Depression) { logX(s, EventType.SocialPhase, cap, -1, p, SecularPhase.Expansion); D.expansions++ }
    }
    // Memory rings (this step's slot; read 4 and 8 steps on).
    soc.ring[p * R + head] = chat
    if (fresh) for (let k = 0; k < R; k++) soc.oRing[p * R + k] = o
    else soc.oRing[p * R + head] = o
    soc.init[p] = 1
    D.steps.push(year, p, psi, eps, w, nph)
  }
  soc.ringAt = (head + 1) % R
  // h6: elite infighting rots asabiya (after cohesionStep's update, in s.living order).
  if (!S.effects) return
  const asab = ps.asab
  for (let t = 0; t < living.length; t++) {
    const i = living[t]
    const p = ps.polity[i]
    if (p < 0 || p >= soc.pcap || soc.init[p] === 0) continue
    const e = soc.emp[p]
    if (e > 1) asab[i] = clampAsab(asab[i] - step * S.erode * (e - 1) * asab[i])
  }
}
