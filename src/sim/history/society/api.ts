// society: what other systems read (society-secular-cycles.md §0.4, §2.7). All O(1) and RNG-free; valid from the first step
// after a polity's founding (before it, and for p < 0 or ended polities, the neutral value). Callers guard with s.soc !== null
// (the codebase pattern); the hook helpers below return the neutral value (or undefined: the factor is skipped, not ×1) when
// society is off, in shadow mode (SOC.effects false), or the polity has no step yet.
//
// For riots-uprisings (structural fuel): psi, mmp, emp, sfd, mmpAt, socUrban, socWage; socRevoltMul moves into their ladder as
// its single multiplicative term (C2: Ψ enters the revolt hazard exactly once; whoever calls revolt() applies it).

import { TOWN_POPULATION } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { foodBase } from '../migration.ts'
import { SOC } from './params.ts'
import type { SocietyState } from './state.ts'
import { wagesAt } from './system.ts'

function ready(s: HistoryState, p: number): SocietyState | null {
  const soc = s.soc
  if (soc === null || p < 0 || p >= soc.pcap || soc.init[p] === 0) return null
  const ps = s.pol
  if (ps === null || p >= ps.P || ps.pEnded[p] >= 0) return null
  return soc
}
/** The society state for hooks: null when off, in shadow mode or p has no step yet. */
function live(s: HistoryState, p: number): SocietyState | null {
  return SOC.effects ? ready(s, p) : null
}
const e1 = (emp: number): number => (emp <= 1 ? 0 : emp >= 2 ? 1 : emp - 1)

// --- §0.4 queries -------------------------------------------------------------------------------------------------------

/** Political stress indicator Ψ = MMP · EMP · SFD of polity p (1 = reference; ~0.3 calm .. 6+ breakdown); 0 for p < 0 or ended. */
export function psi(s: HistoryState, p: number): number { const c = ready(s, p); return c === null ? 0 : c.psi[p] }
/** Mass mobilisation potential of p (1 at reference). */
export function mmp(s: HistoryState, p: number): number { const c = ready(s, p); return c === null ? 0 : c.mmp[p] }
/** Elite mobilisation potential of p (1 at reference). */
export function emp(s: HistoryState, p: number): number { const c = ready(s, p); return c === null ? 0 : c.emp[p] }
/** State fiscal distress of p with the distrust factor (1 at reference). */
export function sfd(s: HistoryState, p: number): number { const c = ready(s, p); return c === null ? 0 : c.sfd[p] }
/** Real wage index of p's peasants (1 = subsistence). */
export function socWage(s: HistoryState, p: number): number { const c = ready(s, p); return c === null ? 0 : c.w[p] }
/** Real wage index of p's townsfolk. */
export function socUrbanWage(s: HistoryState, p: number): number { const c = ready(s, p); return c === null ? 0 : c.wU[p] }
/** Rent index of p (1 = reference). */
export function socRent(s: HistoryState, p: number): number { const c = ready(s, p); return c === null ? 0 : c.rent[p] }
/** The lords' coercion κ of p, 0..1. */
export function socCoercion(s: HistoryState, p: number): number { const c = ready(s, p); return c === null ? 0 : c.kappa[p] }
/** Elite share ε of p's people. */
export function socElite(s: HistoryState, p: number): number { const c = ready(s, p); return c === null ? 0 : c.eps[p] }
/** Elite overproduction o = ε / ε* of p (1 = the surplus supports exactly this many). */
export function socOverprod(s: HistoryState, p: number): number { const c = ready(s, p); return c === null ? 0 : c.o[p] }
/** Labour-scarcity drive of p, 0..1. */
export function socScarcity(s: HistoryState, p: number): number { const c = ready(s, p); return c === null ? 0 : c.scar[p] }
/** Urban pressure 0..1 = smoothstep(1, 2, MMP_urban) · u / (u + 0.1): for city-states and riots-uprisings. */
export function socUrban(s: HistoryState, p: number): number { const c = ready(s, p); return c === null ? 0 : c.urbP[p] }
/** Secular phase of p (SecularPhase; 0 Expansion before its first step). */
export function socPhase(s: HistoryState, p: number): number { const c = ready(s, p); return c === null ? 0 : c.phase[p] }
/** Smoothed disorder D of p, 0..1. */
export function socDisorder(s: HistoryState, p: number): number { const c = ready(s, p); return c === null ? 0 : c.dis[p] }

/**
 * Settlement-level mass pressure: MMP of id's polity with the local terms swapped in. A town (>= TOWN_POPULATION) uses the
 * urban wage at its own crowding pop / (cRef · foodBase); a village the peasant wage at its own crowding. 0 when stateless.
 */
export function mmpAt(s: HistoryState, id: number): number {
  const ps = s.pol
  if (ps === null || id < 0 || id >= ps.polity.length) return 0
  const p = ps.polity[id]
  const c = ready(s, p)
  if (c === null || c.mmp[p] <= 0) return 0
  const S = SOC
  const ci = s.pop[id] / (S.cRef * foodBase(s, id))
  const v = wagesAt(ci, c.kappa[p], c.tau[p], c.trade[p])
  const wl = s.pop[id] >= TOWN_POPULATION ? v.wU : v.w
  const immP = 1 / c.w[p], immL = 1 / wl
  const cl = (x: number): number => (x < 0.3 ? 0.3 : x > 4 ? 4 : x)
  return (c.mmp[p] / cl(immP)) * cl(immL)
}

// --- hooks (h1-h8; neutral or undefined when not live) -------------------------------------------------------------------

/** h1 (C2 psiMul): m(Ψ_p), the only multiplicative revolt-hazard term; undefined (skipped) when not live. */
export function socRevoltMul(s: HistoryState, p: number): number | undefined {
  const c = live(s, p)
  return c === null ? undefined : c.m[p]
}

/** h2: the scratch of socGrief (peasant additions and the townsfolk term). */
export const GRIEF = { imm: 0, coerce: 0, urban: 0 }
/**
 * h2: grievance additions of member i of p into GRIEF: immiseration immis · max(0, 1/w − 1) and failed coercion
 * coerceGrief · κ · scar · [λ < π] (added to the peasant term); townsfolk urban · (max(0, 1/wU − 1) + max(0, ĉ_town − 1)) for
 * a member >= TOWN_POPULATION (terms[6], RevoltCause.Urban). Returns false (all 0) when not live.
 */
export function socGrief(s: HistoryState, i: number, p: number): boolean {
  const c = live(s, p)
  GRIEF.imm = 0; GRIEF.coerce = 0; GRIEF.urban = 0
  if (c === null) return false
  const S = SOC
  const iw = 1 / c.w[p] - 1
  GRIEF.imm = iw > 0 ? S.immis * iw : 0
  GRIEF.coerce = c.lam[p] < c.pi[p] ? S.coerceGrief * c.kappa[p] * c.scar[p] : 0
  if (s.pop[i] >= TOWN_POPULATION) {
    const uw = 1 / c.wU[p] - 1
    const ct = s.pop[i] / (S.cRef * foodBase(s, i)) - 1
    GRIEF.urban = S.urban * ((uw > 0 ? uw : 0) + (ct > 0 ? ct : 0))
  }
  return true
}

/** h2b: rebels' strength factor 1 + eliteLead · min(1, max(0, EMP − 1)) (1 when not live). */
export function socEliteLead(s: HistoryState, p: number): number {
  const c = live(s, p)
  return c === null ? 1 : 1 + SOC.eliteLead * e1(c.emp[p])
}

/** h3: civil-war chance factor 1 + civilPsi · max(0, m(Ψ) − 1) (1 when not live). */
export function socCivilMul(s: HistoryState, p: number): number {
  const c = live(s, p)
  if (c === null) return 1
  const x = c.m[p] - 1
  return x > 0 ? 1 + SOC.civilPsi * x : 1
}

/** h4: added contested-succession (or crisis) chance contest · min(1, max(0, EMP − 1)) (0 when not live). */
export function socContest(s: HistoryState, p: number): number {
  const c = live(s, p)
  return c === null ? 0 : SOC.contest * e1(c.emp[p])
}

/** h4: extra crisis years at most, floor(crisisPlus · min(1, max(0, EMP − 1))) (0 when not live). */
export function socCrisisPlus(s: HistoryState, p: number): number {
  const c = live(s, p)
  return c === null ? 0 : Math.floor(SOC.crisisPlus * e1(c.emp[p]))
}

/** h5 (C3 emp): overthrow factor 1 + overthrow · min(1, max(0, EMP − 1)); undefined (skipped) when not live. */
export function socOverthrowMul(s: HistoryState, p: number): number | undefined {
  const c = live(s, p)
  return c === null ? undefined : 1 + SOC.overthrow * e1(c.emp[p])
}

/** h7 (C5 disorder): supply factor 1 − disorder · D of settlement id's polity; undefined (skipped) when not live or stateless. */
export function socDisorderMul(s: HistoryState, id: number): number | undefined {
  const ps = s.pol
  if (ps === null || s.soc === null || !SOC.effects || id >= ps.polity.length) return undefined
  const p = ps.polity[id]
  const c = live(s, p)
  return c === null ? undefined : 1 - SOC.disorder * c.dis[p]
}

/** h8 (finances 2.4.2 patronage): elite overproduction o of p for the court cost, undefined (skipped) when not live. */
export function socPatronO(s: HistoryState, p: number): number | undefined {
  const c = live(s, p)
  return c === null ? undefined : c.o[p]
}
