// goods: the goods system's place in the yearly tick (index.ts), when HistoryOptions.goods is on.
//
//   weather -> food (x tools) -> goodsProduce (mines, camps' and bases' furs) -> trade (goods hooks: held stocks, high-value
//   classes, middlemen, forward bids, the long-haul sweep (duties, contraband, pirates and bandits on the legs), workshops, consumption, carry-over, tools and arms)
//   -> ... -> species-v2 -> goodsYear: the event log (craftsmen, deportation, defection, conquest, tamed secret species),
//   lanes, posts, relay income (smugglers' hubs and rings are polities v2's: polity/outlaw.ts); every 10 years by phase: year % 10 = 1 marts and legs, 3 prospecting,
//   5 traditions, 7 rumour and route-seeking, 9 secrets -> snapshots.
// Technology (technology.ts hooks): smithing and workshop output count as Metalworking and Crafts activity; what a people
// gains by diffusion is capped at its own level plus DIFFUSION.cap.
// Every draw comes from 'history-goods' (GoodsState.rng), in fixed id order; no Map or Set is iterated.

import { EventType, GOOD_COUNT, Good, SpeciesCategory, TECH_FIELD_COUNT, TechField } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { TradeState } from '../trade.ts'
import type { TechState } from '../technology.ts'
import type { ExploreState } from '../exploration.ts'
import { CASH, STIMULANTS, SPECIES_TABLE, SP, S_COUNT } from '../species.ts'
import { CASHCROP } from '../params.ts'
import { CLASS, CROPS, DIFFUSION, FLAGS, FURS, SECRET, WORKSHOP } from './params.ts'
import type { GoodsState } from './state.ts'
import { MIX_OF, Maker, createGoods, ensureGoods, flushIncome, mixAdd, newVariety } from './state.ts'
import { buildMines, mineYear, minesAbandoned, placeDeposits, prospect, rushMap } from './deposits.ts'
import { laneYear, rebuildMarts } from './longhaul.ts'
import { postConquered, postSupply, postYear, relayYear, routePass } from './routes.ts'
import { carryCraft, seatAbandoned, traditionPass } from './traditions.ts'
import { conquestAt, domesticated, initSpeciesSecrets, pushAt, secretPass } from './secrets.ts'
import { VarietyKind } from '../../../contract.ts'

const G = GOOD_COUNT

/** Creates the goods system at year 0 (after the tribes and their species): deposits, the secret species, the price rule. */
export function createGoodsSystem(s: HistoryState, ts: TradeState): GoodsState {
  const g = createGoods(s, S_COUNT, CASH.length, STIMULANTS.length)
  for (let x = 0; x < S_COUNT; x++) {
    const d = SPECIES_TABLE[x]
    let cls = d.good >= 0 ? d.good : Good.Grain
    let rel = 1
    if (x === SP.silk) { cls = Good.Finery; rel = d.value / CLASS.worth[Good.Finery] }
    else if (d.good === Good.Luxury) rel = d.value / CLASS.worth[Good.Luxury]
    g.spClass[x] = cls
    g.spRel[x] = rel
    g.spMinFit[x] = d.good === Good.Luxury && x !== SP.silk && d.category === SpeciesCategory.Luxury ? CROPS.luxMinFit : CASHCROP.minFit
  }
  placeDeposits(s, g)
  initSpeciesSecrets(s, g)
  ts.hv = Uint8Array.from(CLASS.hv)
  return g
}

/** System (yearly, before the market): deposits worked; furs of expedition bases in the far north go to their parents. */
export function goodsProduce(s: HistoryState, g: GoodsState, es: ExploreState): void {
  ensureGoods(g, s.count)
  mineYear(s, g, es)
  postSupply(s, g)
  const bases = s.outposts
  const pos = s.world.grid.positions
  for (let t = 0; t < bases.length; t++) {
    const b = bases[t]
    const c = s.cell[b]
    const y = pos[c * 3 + 1]
    if (y < FURS.polarY && y > -FURS.polarY) continue
    const bi = s.world.biome[c]
    if (bi !== 3 && bi !== 4) continue
    const par = s.parent[b]
    if (par < 0 || s.abandoned[par] >= 0) continue
    const p = s.people[par]
    let v = g.furVar[p]
    if (v < 0) { v = newVariety(s, g, Good.Luxury, VarietyKind.Wild, -1, p, Maker.People, p, 20, FURS.rel); g.furVar[p] = v }
    g.held[par * G + Good.Luxury] += FURS.perBase
    mixAdd(g, par, MIX_OF[Good.Luxury], v, FURS.perBase)
    g.vOut[v] += FURS.perBase
  }
}

/** Push of craftsmen leaving settlement id this year: famine, danger, a recent sack. */
function pushOf(s: HistoryState, g: GoodsState, id: number): number {
  if (s.year - g.sackedYear[id] <= 5) return 4
  const ps = s.pol
  if (ps !== null && id < ps.seen && ps.danger[id] >= 0.5) return 3
  if (s.year - s.lastFamine[id] <= 10) return 2
  return 1
}

/** The events of this year that the goods rules answer (after the fact, as the polity system reads them). */
function scanEvents(s: HistoryState, g: GoodsState): void {
  const ev = s.events
  const end = ev.length
  const X = SECRET
  const ps = s.pol
  const carryDefect = (from: number, to: number): void => carryCraft(s, g, from, to, 0, 1, 2)
  for (let i = g.evSeen; i < end; i++) {
    const e = ev[i]
    switch (e.type) {
      case EventType.Migration: {
        const from = e.settlement, to = e.other
        if (from >= g.cap) break
        carryCraft(s, g, from, to, e.value, pushOf(s, g, from), 0)
        if (s.people[to] !== s.people[from] && s.pop[from] > 0) pushAt(s, g, from, X.pushMigration * (e.value / (s.pop[from] + e.value)) * 50, carryDefect)
        break
      }
      case EventType.Sacked: {
        const v = e.settlement
        if (v >= g.cap) break
        g.sackedYear[v] = s.year
        // Deportation to the conquerors' capital.
        const u = e.other
        if (ps !== null && u >= 0 && u < ps.seen) { const q = ps.polity[u]; if (q >= 0) carryCraft(s, g, v, ps.pCapital[q], 0, 1, 1) }
        pushAt(s, g, v, X.pushSack, carryDefect)
        break
      }
      case EventType.Conquered: {
        const v = e.settlement
        let u = e.other
        if (u < 0 && ps !== null && v < ps.seen && ps.polity[v] >= 0) u = ps.pCapital[ps.polity[v]]
        conquestAt(s, g, v, u)
        postConquered(s, g, v)
        break
      }
      case EventType.Famine: pushAt(s, g, e.settlement, X.pushFamine, carryDefect); break
      case EventType.Revolt: pushAt(s, g, e.settlement, X.pushRevolt, carryDefect); break
      case EventType.Abandoned: seatAbandoned(s, g, e.settlement); minesAbandoned(s, g, e.settlement); break
      case EventType.Domesticated: domesticated(s, g, e.settlement, e.value); break
    }
  }
  g.evSeen = end
}

/** System (end of year, after species-v2): see the header. */
export function goodsYear(s: HistoryState, g: GoodsState, ts: TradeState, tk: TechState, es: ExploreState): void {
  ensureGoods(g, s.count)
  flushIncome(s, g)
  scanEvents(s, g)
  buildMines(s, g)
  laneYear(s, g, ts)
  postYear(s, g)
  relayYear(s, g)
  const phase = s.year % 10
  if (phase === 1) {
    if (ts.adjCount > 0) rebuildMarts(s, ts, g)
    // Origins move to whoever now grows or makes most of each variety.
    for (let v = 1; v < g.vCount; v++) g.vOriginOut[v] *= 0.5
  } else if (phase === 3) { prospect(s, g); rushMap(s, g) }
  else if (phase === 5) traditionPass(s, g)
  else if (phase === 7) { if (ts.adjCount > 0 && FLAGS.routes) routePass(s, g, ts, es) }
  else if (phase === 9) secretPass(s, g, tk)
  if (phase === 0) for (let v = 1; v < g.vCount; v++) g.vOut[v] = 0
}

/** Technology hook (technology.ts, before growth): smithing and workshop output (yearly means since the last step) as activity. */
export function goodsTechActivity(g: GoodsState, act: Float64Array, P: number, dt: number): void {
  const F = TECH_FIELD_COUNT
  if (!FLAGS.techAct) { g.smithAct.fill(0); g.workAct.fill(0); return }
  // Renowned seats of each people raise the worth of its workshops' work for Crafts.
  for (let p = 0; p < P; p++) {
    let ren = 0
    for (let t = 0; t < g.tCount; t++) if (g.tPeople[t] === p && g.tEnd[t] < 0 && g.tRenowned[t]) ren++
    act[p * F + TechField.Metalworking] += (WORKSHOP.smith * g.smithAct[p]) / dt
    act[p * F + TechField.Crafts] += ((WORKSHOP.work * g.workAct[p]) / dt) * (1 + WORKSHOP.renowned * ren)
    g.smithAct[p] = 0
    g.workAct[p] = 0
  }
}

/** Technology hook (technology.ts): a diffusion gain g at index i, capped so the level stays within its own level plus DIFFUSION.cap. */
export function capGain(g: GoodsState, tech: Float64Array, i: number, gain: number): number {
  if (!FLAGS.brake) return gain
  const room = g.own[i] + DIFFUSION.cap - tech[i]
  return gain < room ? gain : room > 0 ? room : 0
}

void TECH_FIELD_COUNT
