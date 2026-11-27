// grudges and oaths: Richardson arms races (grudges-and-oaths.md §3.11; HistoryOptions.arms). RNG-free.
//
// Richardson (1960, Arms and Insecurity, Boxwood Press): dx/dt = k * y - a * x + g, dy/dt = l * x - b * y + h, with reaction
// k, l, fatigue a, b and grievance g, h; the equilibrium is stable iff a * b > k * l (FSU MAP5932 2016, lecture 5). Its empirical
// support is weak to mixed (Britannica, "Arms race: Prisoner's dilemma models"): a stylised mechanism here. Arms are dyadic:
// x is a's armament against b, a share of its strength kept under arms against that rival, so each pair is its own 2 x 2 system.
// Every slow step, per pair in relation order (both alive, bordering or with R >= ALIGN.preR; else both halve), ARMS.substeps
// explicit-Euler steps of dt = slowStep / substeps, both derivatives from the previous values:
//   g_a = gR * smoothstep(0.5, 1.2, R) + gG * g(a, b) + gT * theta(b -> a) - gTrade * v / (v + 200)   (may be < 0: goodwill)
//   k_a = k * rulerWar(a),   a_a = a * (1 + fatigue * need_a)   (need: finances' finNeed, else min(1, exhaustion))
// held while the pair is at war; * ARMS.peace at the peace. Rivalry alone gives x* = gR / (a - k) = 0.24 < raceOn: a race
// needs a grudge or a threat. A race opens at min(x, y) >= raceOn with both rising, eases below raceOff, ends in war at a
// declaration between the two or when either ends or bows to the other.
// Effects: M_p = min(1, max_q x_pq + pool * (sum_q x_pq - max_q x_pq)); war power on the pair's fronts * (1 + proj * x) both
// ways (declarations: adv * (1 + proj x_pq) / (1 + proj x_qp); campaigns: A and D); cost: finances' garrison * (1 + costMul M_p),
// or without finances the capital's wealth -= drain * M_p * WEALTH.decay * wealth a year (lost, not moved).

import { ArmsRaceEnd, EventType } from '../../../contract.ts'
import type { EventType as EventTypeT } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import { WEALTH } from '../params.ts'
import type { HistoryState } from '../state.ts'
import { ALIGN, ARMS, POLITY } from './params.ts'
import type { PolityState } from './state.ts'
import type { GrudgeState } from './grudgeState.ts'
import { at, put } from './grudgeState.ts'
import { grudge } from './grievances.ts'
import { threatAt } from './align.ts'
import { overlordOf } from './bonds.ts'
import { relIdx } from './relations.ts'
import { rulerWar } from '../rulers/system.ts' // rulers:
import { finArmsNeed, finArmsCost } from './finHooks.ts' // finances:

function logX(s: HistoryState, type: EventTypeT, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

const byte = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0)

function closeRace(s: HistoryState, ps: PolityState, og: GrudgeState, r: number, cause: number, war: number): void {
  const i = at(og.relRace, r, -1)
  if (i < 0) return
  og.raEnd[i] = s.year
  og.raCause[i] = cause
  og.raWar[i] = war
  put(og.relRace, r, -1, -1)
  if (cause === ArmsRaceEnd.War) { og.diag.racesWar++; logX(s, EventType.ArmsRace, ps.pCapital[og.raA[i]], ps.pCapital[og.raB[i]], i, 1) }
  else if (cause === ArmsRaceEnd.Eased) { og.diag.racesEased++; logX(s, EventType.ArmsRace, ps.pCapital[og.raA[i]], ps.pCapital[og.raB[i]], i, 2) }
}

/** System part (every slow step, after the alliances): Richardson's equations for every rival pair; races; M_p. */
export function armsStep(s: HistoryState, ps: PolityState, og: GrudgeState): void {
  if (!og.arms) return
  const X = ARMS
  const R = ps.relA.length
  const dt = POLITY.slowStep / X.substeps
  const P = ps.P
  const sum = new Float64Array(P), mx = new Float64Array(P)
  for (let r = 0; r < R; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    let x = at(og.relX, r, 0), y = at(og.relY, r, 0)
    if (ps.pEnded[a] >= 0 || ps.pEnded[b] >= 0 || overlordOf(ps, a) === b || overlordOf(ps, b) === a) {
      if (at(og.relRace, r, -1) >= 0) closeRace(s, ps, og, r, ArmsRaceEnd.Ended, -1)
      if (x > 0 || y > 0) { put(og.relX, r, 0, 0); put(og.relY, r, 0, 0) }
      continue
    }
    put(og.relPX, r, x, 0); put(og.relPY, r, y, 0)
    const px = x, py = y
    if (ps.relWar[r] < 0) {
      const Rr = ps.relR[r]
      if (ps.relEdges[r].length > 0 || Rr >= ALIGN.preR) {
        const v = og.relVol !== null && r < og.relVol.length ? og.relVol[r] : 0
        const tr = X.gTrade * (v / (v + 200))
        const base = X.gR * smoothstep(0.5, 1.2, Rr) - tr
        const ga = base + (og.oaths ? X.gG * grudge(og, a, b) : 0) + X.gT * threatAt(s, ps, r, b, a)
        const gb = base + (og.oaths ? X.gG * grudge(og, b, a) : 0) + X.gT * threatAt(s, ps, r, a, b)
        const ka = X.k * (s.rul !== null ? rulerWar(s.rul, a) : 1), kb = X.k * (s.rul !== null ? rulerWar(s.rul, b) : 1)
        const fa = X.a * (1 + X.fatigue * finArmsNeed(s, ps, a)), fb = X.a * (1 + X.fatigue * finArmsNeed(s, ps, b))
        for (let k = 0; k < X.substeps; k++) {
          const dx = ka * y - fa * x + ga, dy = kb * x - fb * y + gb
          x += dt * dx; y += dt * dy
          x = x < 0 ? 0 : x > X.max ? X.max : x
          y = y < 0 ? 0 : y > X.max ? X.max : y
        }
      } else { x *= 1 - X.a * POLITY.slowStep; y *= 1 - X.a * POLITY.slowStep; if (x < 1e-4) x = 0; if (y < 1e-4) y = 0 }
    }
    put(og.relX, r, x, 0); put(og.relY, r, y, 0)
    // races
    const m = x < y ? x : y
    let race = at(og.relRace, r, -1)
    if (race < 0 && ps.relWar[r] < 0 && m >= X.raceOn && x > px && y > py) {
      race = og.raA.length
      og.raA.push(a); og.raB.push(b); og.raStart.push(s.year); og.raEnd.push(-1); og.raCause.push(ArmsRaceEnd.Ongoing); og.raWar.push(-1)
      og.raPeak.push(byte(m)); og.raPeakY.push(s.year); og.raLevel.push([])
      put(og.relRace, r, race, -1)
      og.diag.races++
      logX(s, EventType.ArmsRace, ps.pCapital[a], ps.pCapital[b], race, 0)
    } else if (race >= 0 && m < X.raceOff) { closeRace(s, ps, og, r, ArmsRaceEnd.Eased, -1); race = -1 }
    if (race >= 0) {
      og.raLevel[race].push(byte(m))
      if (byte(m) > og.raPeak[race]) { og.raPeak[race] = byte(m); og.raPeakY[race] = s.year }
    }
    if (m >= 0.95 * X.max) { const c = at(og.relCap, r, 0) + POLITY.slowStep; put(og.relCap, r, c, 0); if (c > 30) og.diag.armsCapYears += POLITY.slowStep } else if (at(og.relCap, r, 0) > 0) put(og.relCap, r, 0, 0)
    sum[a] += x; sum[b] += y
    if (x > mx[a]) mx[a] = x
    if (y > mx[b]) mx[b] = y
  }
  for (let p = 0; p < P; p++) {
    const M = mx[p] + X.pool * (sum[p] - mx[p])
    put(og.pArms, p, ps.pEnded[p] >= 0 ? 0 : M > 1 ? 1 : M, 0)
  }
}

/** p's arms against q (x_pq). */
export function armsAgainst(ps: PolityState, og: GrudgeState, p: number, q: number): number {
  const r = relIdx(ps, p, q)
  if (r < 0) return 0
  return ps.relA[r] === p ? at(og.relX, r, 0) : at(og.relY, r, 0)
}

/** Declarations: adv * (1 + proj x_pq) / (1 + proj x_qp) (arming deters as well as provokes). */
export function armsAdv(ps: PolityState, og: GrudgeState, r: number, p: number): number {
  const x = at(og.relX, r, 0), y = at(og.relY, r, 0)
  const mine = ps.relA[r] === p ? x : y, theirs = ps.relA[r] === p ? y : x
  return (1 + ARMS.proj * mine) / (1 + ARMS.proj * theirs)
}

/** declare hook: a war between the two of relation r ends their race (War) and records it as the war's precursor. */
export function armsDeclared(s: HistoryState, ps: PolityState, og: GrudgeState, r: number, w: number): void {
  const open = at(og.relRace, r, -1)
  if (open >= 0) { closeRace(s, ps, og, r, ArmsRaceEnd.War, w); put(og.wRace, w, open, -1); return }
  const a = ps.relA[r], b = ps.relB[r]
  for (let i = og.raA.length - 1; i >= 0; i--) {
    if (og.raA[i] !== a || og.raB[i] !== b) continue
    if (og.raEnd[i] >= 0 && s.year - og.raEnd[i] <= ARMS.precede) put(og.wRace, w, i, -1)
    break
  }
}

/** closeWar hook: demobilisation of the pair of relation r. */
export function armsPeace(og: GrudgeState, r: number): void {
  put(og.relX, r, at(og.relX, r, 0) * ARMS.peace, 0)
  put(og.relY, r, at(og.relY, r, 0) * ARMS.peace, 0)
}

/** Tax system hook (yearly, without finances): the upkeep of arms drains each capital's wealth. */
export function armsUpkeep(s: HistoryState, ps: PolityState, og: GrudgeState): void {
  if (!og.arms || finArmsCost(s)) return
  for (const p of ps.alive) {
    const M = at(og.pArms, p, 0)
    if (!(M > 0)) continue
    const cap = ps.pCapital[p]
    if (s.abandoned[cap] >= 0) continue
    s.wealth[cap] -= ARMS.drain * M * WEALTH.decay * s.wealth[cap]
  }
}
