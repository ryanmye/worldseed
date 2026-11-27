// seat: the throne HUD's snapshot (lane N3, ui-additions 3, 3b, 3c). At each decision the watcher records, for the seat's
// realm, the meters a court could read (treasury, debt, unrest, deference, wars) and its live yearly hazards computed by the
// same pure functions the systems draw with (rulers/hazards.ts overthrowHazard and contestChance, compose.ts C2 / C3), plus
// the C3 factors of the overthrow hazard (the HUD's "Why?"). Pure reads: no draw, no event, so a seat run is unchanged by it.
//
// Fog (the bots' rule): our own court knows its treasury, its towns and its heirs; an enemy's strength is the believed one
// (beliefs on: believedMass), never the true value. Nothing pre-drawn is read: the ruler's chance of dying this year is the
// life table (RULERS mortality by age), not the drawn year of death.
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { FAR, projAt } from '../polity/state.ts'
import { UNREST } from '../polity/params.ts'
import { c2RevoltChance } from '../compose.ts'
import type { C2HazardFactors } from '../compose.ts'
import { RULERS } from '../rulers/params.ts'
import { contestChance, overthrowExposed, overthrowHazard } from '../rulers/hazards.ts'
import { finOverthrow } from '../finance/hooks.ts'
import { FIN } from '../finance/params.ts'
import { psi, socOverthrowMul, socRevoltMul } from '../society/api.ts'
import { battleCoup } from '../battles/commanders.ts'
import { seatOverthrow } from '../orders/hooks.ts'
import { deferOverthrowMul } from '../rulers/deference.ts'
import { believedMass } from '../beliefs/system.ts'
import { smoothstep } from '../../util.ts'

/** The HUD row's columns (History.seat.decisions.hud: count * HUD_N floats; NaN where the system is off). */
export const HUD = {
  /** Treasury in years of revenue (finance; NaN off). */
  Treasury: 0,
  /** Debt over ordinary revenue (finance; NaN off). */
  Debt: 1,
  /** Interest due over the default threshold (FIN.dsBreak x revenue): 1 = the crown defaults (finance; NaN off). */
  DebtService: 2,
  /** People-weighted unrest of the members over the revolt threshold (UNREST.revolt): 1 = towns ready to rise. */
  Unrest: 3,
  /** Deference (rulers: deference), 0 none .. SEAT.deferDecline: the court rules in all but name. */
  Deference: 4,
  Wars: 5,
  Exhaustion: 6,
  /** Yearly overthrow chance of the ruler (overthrowHazard). */
  Overthrow: 7,
  /** Chance the succession is contested were the ruler to die now (contestChance). */
  Contest: 8,
  /** The ruler's yearly chance of death at this age (the life table). */
  DeathYear: 9,
  /** Yearly chance that some town rises (members over the threshold, C2 revolt hazard). */
  Revolt: 10,
  /** Yearly chance that a town breaks away (each rising town's chance times its rebels' odds against the capital's reach). */
  Breakaway: 11,
  /** Yearly chance of a crown default (a proxy from debt service and arrears; finance; NaN off). */
  Default: 12,
  /** Yearly chance of losing a war badly (a proxy from the believed strength of the strongest enemy at war). */
  WarLoss: 13,
  /** Society: elite pressure Ψ (NaN off). */
  Psi: 14,
  /** The overthrow hazard's base (before the C3 factors), and the factors: finance's unpaid army, society's magnates, battles' famous general, the seat's orders (Placate, Purge), deference (1 where absent). */
  OvBase: 15,
  OvFin: 16,
  OvMagnates: 17,
  OvGeneral: 18,
  OvOrders: 19,
  OvDefer: 20,
  /** Members and people of the realm. */
  Towns: 21,
  Pop: 22,
  /** The strongest enemy at war: its believed mass over ours (0 at peace). */
  EnemyRatio: 23,
} as const
export const HUD_N = 24

const C2H: C2HazardFactors = {}

/** The ruler's yearly chance of death at `age` (the life table of rulers/params.ts, no draw). */
export function deathChance(age: number): number {
  const P = RULERS
  if (age <= 0) return P.infant
  if (age < 5) return P.child
  if (age < 15) return P.youth
  const q = P.adult + P.gompertz * Math.pow(P.gompertzRate, age - 20)
  return q > 1 ? 1 : q
}

/** Writes the HUD row of the seat's realm p now into `out` at `at` (HUD_N values). */
export function hudRow(s: HistoryState, p: number, out: number[], at: number): void {
  for (let i = 0; i < HUD_N; i++) out[at + i] = NaN
  const ps: PolityState | null = s.pol
  if (ps === null || p < 0 || p >= ps.pcap || ps.pEnded[p] >= 0) return
  const fin = s.fin
  if (fin !== null && p < fin.pcap) {
    const R0 = fin.revOrd[p], R = fin.rev[p]
    out[at + HUD.Treasury] = R > 1e-9 ? fin.treas[p] / R : 0
    out[at + HUD.Debt] = R0 > 1e-9 ? fin.debt[p] / R0 : fin.debt[p] > 0 ? 99 : 0
    const ds = R0 > 1e-9 ? fin.interest[p] / (FIN.dsBreak * R0) : fin.interest[p] > 0 ? 9 : 0
    out[at + HUD.DebtService] = ds
    const arrears = fin.unpaid[p] / FIN.arrearYears
    let d = 0.25 * smoothstep(0.6, 1, ds) + 0.25 * (arrears > 1 ? 1 : arrears)
    if (ds >= 1 || (fin.unpaid[p] >= FIN.arrearYears && fin.debt[p] > FIN.needDebtLow * R0)) d = 0.9 // (the rule defaults it next year, if its gap allows)
    out[at + HUD.Default] = fin.debt[p] > 0 && s.year - fin.lastDefault[p] >= FIN.defaultGap ? d : 0
  }
  // members: unrest, revolt and breakaway chances
  const cap = ps.pCapital[p]
  let pop = 0, wu = 0, towns = 0, stay = 1, stayBreak = 1
  const pm = s.soc !== null ? socRevoltMul(s, p) : undefined
  if (pm !== undefined) C2H.psiMul = pm
  const ch = c2RevoltChance(UNREST.chance, pm !== undefined ? C2H : undefined)
  const sup0 = cap >= 0 ? 1 : 0
  for (const i of s.living) {
    if (i >= ps.polity.length || ps.polity[i] !== p || s.outpost[i]) continue
    towns++
    pop += s.pop[i]
    if (i === cap) continue
    wu += s.pop[i] * ps.unrest[i]
    if (ps.unrest[i] < UNREST.revolt || sup0 === 0) continue
    stay *= 1 - ch
    const rb = ps.asab[i] * ps.str[i] * ps.defense[s.cell[i]]
    const sup = projAt(ps, p, ps.dist[i] < FAR ? ps.dist[i] : FAR)
    const win = (rb * rb) / (rb * rb + sup * sup + 1e-12)
    stayBreak *= 1 - ch * win
  }
  out[at + HUD.Towns] = towns
  out[at + HUD.Pop] = pop
  out[at + HUD.Unrest] = pop > 0 ? wu / pop / UNREST.revolt : 0
  out[at + HUD.Revolt] = 1 - stay
  out[at + HUD.Breakaway] = 1 - stayBreak
  out[at + HUD.Deference] = s.defer !== null && p < s.defer.value.length ? s.defer.value[p] : 0
  out[at + HUD.Wars] = ps.pWars[p]
  out[at + HUD.Exhaustion] = ps.pExh[p]
  // wars: the strongest enemy as our court believes it
  let ratio = 0
  for (const w of ps.activeWars) {
    const a = ps.wAtt[w], b = ps.wDef[w]
    if (a !== p && b !== p) continue
    const q = a === p ? b : a
    const r = believedMass(s, ps, p, q) / (ps.pMass[p] + 1e-9)
    if (r > ratio) ratio = r
  }
  out[at + HUD.EnemyRatio] = ratio
  out[at + HUD.WarLoss] = ratio > 0 ? Math.min(0.15, 0.03 * ratio * ratio) : 0
  out[at + HUD.Psi] = s.soc !== null ? psi(s, p) : NaN
  // the throne
  const R = s.rul
  if (R !== null && p < R.pcap && R.cur[p] >= 0) {
    const r = R.cur[p]
    out[at + HUD.Overthrow] = overthrowHazard(s, ps, R, p)
    out[at + HUD.Contest] = contestChance(s, ps, R, p)
    out[at + HUD.DeathYear] = deathChance(s.year - R.rBorn[r])
    // the factors of the overthrow hazard (as overthrowHazard composes them)
    out[at + HUD.OvFin] = (s.fin !== null ? finOverthrow(s, p) : undefined) ?? 1
    out[at + HUD.OvMagnates] = (s.soc !== null ? socOverthrowMul(s, p) : undefined) ?? 1
    out[at + HUD.OvGeneral] = (s.bat !== null && s.bat.pretenders ? battleCoup(s, s.bat, p) : undefined) ?? 1
    out[at + HUD.OvOrders] = (s.orders !== null ? seatOverthrow(s.orders, p) : undefined) ?? 1
    out[at + HUD.OvDefer] = (s.defer !== null ? deferOverthrowMul(s, p) : undefined) ?? 1
    // (the base: the hazard over its factors, so base x factors is the hazard shown; 0 when not exposed)
    const f = out[at + HUD.OvFin] * out[at + HUD.OvMagnates] * out[at + HUD.OvGeneral] * out[at + HUD.OvOrders] * out[at + HUD.OvDefer]
    out[at + HUD.OvBase] = overthrowExposed(R, r, s.year) && f > 1e-9 ? out[at + HUD.Overthrow] / f : 0
  }
}
