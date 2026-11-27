// governments: small O(1) readers that the polity, rulers, war, policy and goods code import (city-states.md §4.1). Each is a
// no-op (or returns undefined, so the compose stacks skip it) while HistoryState.gov is null.

import { Government } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { GovState } from './state.ts'
import { GOV, electedForm } from './params.ts'

/** Form of government of polity p now (Monarchy past the arrays). */
export function govOf(G: GovState, p: number): number {
  return p >= 0 && p < G.pcap ? G.form[p] : Government.Monarchy
}

/** True when p's head is elected (Republic, FreeCity, Theocracy, League): no house, no marriages. */
export function govElected(G: GovState, p: number): boolean {
  return electedForm(govOf(G, p))
}

/** False when p does not bow whole (absorption, overawe): GOV.absorb 0. True with the system off. */
export function govAbsorbable(s: HistoryState, p: number): boolean {
  return s.gov === null || GOV.absorb[govOf(s.gov, p)] !== 0
}

/** compete_pq = min(T_p, T_q) / max(T_p, T_q) * smoothstep(1000, 10000, min(T_p, T_q)): trade rivals (T: port members' through-traffic, govStep). */
export function govCompete(G: GovState, p: number, q: number): number {
  if (p >= G.pcap || q >= G.pcap) return 0
  const a = G.trade[p], b = G.trade[q]
  const lo = a < b ? a : b, hi = a < b ? b : a
  if (!(lo > 1000)) return 0
  const x = lo >= 10000 ? 1 : ((lo - 1000) / 9000) * ((lo - 1000) / 9000) * (3 - 2 * ((lo - 1000) / 9000))
  return (lo / hi) * x
}

/** C1 factor 2: GOV.war * (1 + GOV.tradeWar * compete) of p's form against q; undefined when neutral (a monarchy: skipped, not x1). */
export function govWarMul(G: GovState, p: number, q: number): number | undefined {
  const f = govOf(G, p)
  if (f === Government.Monarchy) return undefined
  const tw = GOV.tradeWar[f]
  return tw !== 0 ? GOV.war[f] * (1 + tw * govCompete(G, p, q)) : GOV.war[f]
}

/** C2 form multiplier on the grievance sum (GOV.unrest); undefined for a monarchy. */
export function govUnrestMul(G: GovState, p: number): number | undefined {
  const f = govOf(G, p)
  return f === Government.Monarchy ? undefined : GOV.unrest[f]
}

/** C4 factor 1 (GOV.reach); undefined for a monarchy. */
export function govReachMul(G: GovState, p: number): number | undefined {
  const f = govOf(G, p)
  return f === Government.Monarchy || GOV.reach[f] === 1 ? undefined : GOV.reach[f]
}

/** Tariff target multiplier (GOV.tariff) of p, 1 for a monarchy. */
export function govTariff(G: GovState, p: number): number {
  return GOV.tariff[govOf(G, p)]
}

/** Embargo threshold multiplier: the lesser GOV.embargo of the two sides. */
export function govEmbargo(G: GovState, p: number, q: number): number {
  const a = GOV.embargo[govOf(G, p)], b = GOV.embargo[govOf(G, q)]
  return a < b ? a : b
}

/** Trade-rivalry drift a slow step: CITY.tradeRival * max(GOV.tradeRival) * compete (0 when neither side trades for a living). */
export function govRivalry(G: GovState, p: number, q: number, step: number, k: number): number {
  const a = GOV.tradeRival[govOf(G, p)], b = GOV.tradeRival[govOf(G, q)]
  const m = a > b ? a : b
  if (m === 0) return 0
  return step * k * m * govCompete(G, p, q)
}

/** Lane urge multiplier (GOV.urge) of polity p. */
export function govUrge(G: GovState, p: number): number {
  return p < 0 ? 1 : GOV.urge[govOf(G, p)]
}

/** True when a winning attacker of p's form takes tribute (trading privileges), never vassalage (GOV.tribute). */
export function govTributeOnly(G: GovState, p: number): boolean {
  return GOV.tribute[govOf(G, p)] === 1
}
