// barriers (barriers-coldwar.md §2.1-2.3, §2.5 beliefs row; beliefs addendum "barriers & cold war"): communication barriers
// in what states learn of each other. HistoryState.ib is null unless HistoryOptions.barriers (and beliefs) are on; RNG-free.
//
// - Intelligibility e_elite(p, q) = max(I(L_p, L_q), e_int): I from the live language tree (names/liveDrift.ts, B-R1) of the
//   two capitals' tongues, or with language off (or typology on) the proxy I = 1 for the same people, else 0 (B-R2);
//   e_int = IB.interp 0.4 when either is Kingdom+ (court interpreters; paid through finSpend 'envoys' with a monetised crown,
//   IB.interpCost * R° a year, else free). Lingua francas (eps, L*) are not built yet (deferred: they need migration's prestige).
// - In beliefStep: cheap channels (contact, border, trade) x (0.3 + 0.7 e), spies x (0.5 + 0.5 e); marriage and envoys
//   unchanged (interpreters).
// - News lag (proxy until infrastructure's infraLag): l = 1.3 d ((1 - sigma) / v_land + sigma / v_sea) days, d the great-circle
//   km between capitals, sigma 1 across landmasses; v_land 25 km/day on foot, 67 for an empire's couriers (ORBIS, cursus
//   publicus), v_sea 120. Staleness: each class of channel I <- I / (1 + I * IB.q * l / 365) (B-R4: small by design).

import type { World } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { Tier, tierOf } from '../polity/state.ts'
import { landmassOf } from '../../names/languageTree.ts'
import { advanceLive, createLiveDrift, intelligibility, liveNode, type LiveDrift } from '../../names/liveDrift.ts'
import { finMonetised, finRevOrd, finSpend } from '../finance/hooks.ts'
import { POLITY } from '../polity/params.ts'

export const IB = {
  /** Interpreters' floor of understanding between courts, and their cost a year in R° (barriers §2.2). */
  interp: 0.4,
  interpCost: 0.01,
  /** Per-year variance of the log-strength change (staleness; design default until the harness measures it). */
  q: 0.01,
  /** Speeds km/day: foot, courier (Empire tier), sail. */
  vFoot: 25,
  vCourier: 67,
  vSail: 120,
  /** Path factor over the great circle. */
  path: 1.3,
}

export interface BarrierState {
  /** The live language tree (null: the people proxy). */
  ld: LiveDrift | null
  world: World
  lm: Int32Array
  /** Interpreters paid this slow step (per polity, grown on demand). */
  paid: Uint8Array
  diag: { pairs: number; eSum: number; lagSum: number; unintelligible: number }
}

export function createBarriers(world: World, live: boolean): BarrierState {
  return { ld: live ? createLiveDrift(world) : null, world, lm: landmassOf(world), paid: new Uint8Array(64), diag: { pairs: 0, eSum: 0, lagSum: 0, unintelligible: 0 } }
}

/** beliefStep, first: the live tree takes this step's new settlements; interpreters are paid. */
export function barrierStep(s: HistoryState, ps: PolityState, ib: BarrierState): void {
  if (ib.ld) advanceLive(ib.ld, s.count, (id) => ({ cell: s.cell[id], parent: s.parent[id], foundedYear: s.founded[id], abandonedYear: s.abandoned[id], people: s.people[id] }))
  if (ib.paid.length < ps.P) { const a = new Uint8Array(Math.max(ps.P, 2 * ib.paid.length)); ib.paid = a }
  ib.paid.fill(0)
  for (const p of ps.alive) {
    if (tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop) < Tier.Kingdom) continue
    ib.paid[p] = !finMonetised(s, p) || finSpend(s, p, IB.interpCost * finRevOrd(s, p) * POLITY.slowStep, 'envoys') ? 1 : 0
  }
}

/** Elite intelligibility of polities a and b now. */
export function eliteE(s: HistoryState, ps: PolityState, ib: BarrierState, a: number, b: number): number {
  let I: number
  if (ib.ld) {
    const la = liveNode(ib.ld, ps.pCapital[a], s.year), lb = liveNode(ib.ld, ps.pCapital[b], s.year)
    I = la < 0 || lb < 0 ? (ps.pPeople[a] === ps.pPeople[b] ? 1 : 0) : intelligibility(ib.ld, la, lb, s.year)
  } else I = ps.pPeople[a] === ps.pPeople[b] ? 1 : 0
  const it = (a < ib.paid.length && ib.paid[a] === 1) || (b < ib.paid.length && ib.paid[b] === 1) ? IB.interp : 0
  return I > it ? I : it
}

/** News lag in days between the capitals of a and b (the proxy of barriers §2.3). */
export function newsLag(s: HistoryState, ps: PolityState, ib: BarrierState, a: number, b: number): number {
  const P = ib.world.grid.positions
  const ca = s.cell[ps.pCapital[a]], cb = s.cell[ps.pCapital[b]]
  const x1 = P[ca * 3], y1 = P[ca * 3 + 1], z1 = P[ca * 3 + 2], x2 = P[cb * 3], y2 = P[cb * 3 + 1], z2 = P[cb * 3 + 2]
  const r1 = Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1) || 1, r2 = Math.sqrt(x2 * x2 + y2 * y2 + z2 * z2) || 1
  const dx = x1 / r1 - x2 / r2, dy = y1 / r1 - y2 / r2, dz = z1 / r1 - z2 / r2
  const chord = Math.sqrt(dx * dx + dy * dy + dz * dz)
  // great-circle km from the chord: 2 R asin(chord / 2), asin by its series (x + x^3/6 + 3x^5/40), chord / 2 <= 1
  const h = chord / 2
  const d = 2 * 6371 * (h + (h * h * h) / 6 + (3 * h * h * h * h * h) / 40)
  const sea = ib.lm[ca] !== ib.lm[cb]
  const emp = tierOf(ps.pPop[a], ps.pMembers[a], ps.pMulti[a] === 1, ps.worldPop) >= Tier.Empire || tierOf(ps.pPop[b], ps.pMembers[b], ps.pMulti[b] === 1, ps.worldPop) >= Tier.Empire
  return IB.path * d * (sea ? 1 / IB.vSail : 1 / (emp ? IB.vCourier : IB.vFoot))
}

/** Staleness: a precision I seen through a lag of l days. */
export function stale(I: number, l: number): number {
  return I / (1 + I * IB.q * (l / 365))
}
