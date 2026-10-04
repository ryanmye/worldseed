// goods: craft traditions, cultural specialities (design 2.2).
//
// A tradition is a named workshop culture of one people (silk, dyeing, fine cloth or blades) at one or more seats, with a
// quality Q that grows with practice. Every 10 years (year % 10 = 5): practice follows each settlement's output of the
// craft; a large settlement with much practice and no tradition of its people's in that craft nearby may give birth to
// one (TraditionBorn; the first of a secret craft creates the secret, secrets.ts); quality grows toward a cap set by the
// people's technology and the number of seats, and fades with disuse (TraditionRenowned at Q >= 2); busy neighbours of a
// seat become seats (the industrial district); idle seats are lost and a tradition without seats ends (TraditionLost).
// Craftsmen carry traditions: a group leaving a seat may take it (a daughter tradition among another people or far away,
// else a new seat), more after famine, danger or a sack; after a sack the conqueror may deport them to its capital
// (TraditionMoved). Names are fixed at birth (the seat's name), so they are the same in longer runs.

import { CraftKind, EventType, Good, TECH_FIELD_COUNT, VarietyKind } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import { TRADITION, WORKSHOP } from './params.ts'
import type { GoodsState } from './state.ts'
import { Maker, logGoods, newVariety, setVarSecret } from './state.ts'
import { craftHeld, grantCraft, protection, secretKind } from './secrets.ts'

/** Class, field, gate of each craft kind (Silk, Dyeing, FineCloth, Blades). */
const CRAFT_GOOD = [Good.Finery, Good.Finery, Good.Finery, Good.Metalware]
const CRAFT_FIELD = [3, 3, 3, 2]
const CRAFT_GATE = [1.6, WORKSHOP.gate[1], WORKSHOP.gate[2], WORKSHOP.bladeGate]
/** Worth per unit (relative to grain) of a tradition's goods at quality 1, for the contract. */
const CRAFT_VALUE = [30, 24, 26, 20]

/** Output of craft c at settlement id this year (class units). */
function outOf(s: HistoryState, g: GoodsState, id: number, c: number): number {
  if (c === CraftKind.Silk) return g.silkOut[id]
  if (c === CraftKind.Dyeing) return g.wOut[id * 3 + 1]
  if (c === CraftKind.FineCloth) return g.wOut[id * 3 + 2]
  const M = s.tech[s.people[id] * TECH_FIELD_COUNT + 2]
  return g.wOut[id * 3] * smoothstep(WORKSHOP.bladeGate - 0.4, WORKSHOP.bladeGate + 0.2, M)
}

/** Chord^2 between two settlements' cells. */
function chord2(s: HistoryState, a: number, b: number): number {
  const P = s.world.grid.positions
  const ca = s.cell[a] * 3, cb = s.cell[b] * 3
  const dx = P[ca] - P[cb], dy = P[ca + 1] - P[cb + 1], dz = P[ca + 2] - P[cb + 2]
  return dx * dx + dy * dy + dz * dz
}

/** Squared chord of `hops` hops at this resolution. */
function hops2(s: HistoryState, hops: number): number {
  const h = (1.12 / s.terrain.n) * hops
  return h * h
}

/** Living seats of tradition t. */
function seatsOf(g: GoodsState, t: number): number[] {
  const out: number[] = []
  const se = g.tSeats[t], to = g.tSeatTo[t]
  for (let k = 0; k < se.length; k++) if (to[k] < 0) out.push(se[k])
  return out
}

/** Makes settlement id a seat of tradition t this year. */
function addSeat(s: HistoryState, g: GoodsState, t: number, id: number): void {
  const c = g.tCraft[t]
  g.seatOf[id * 4 + c] = t
  g.seatIdle[id * 4 + c] = 0
  g.tSeats[t].push(id)
  g.tSeatFrom[t].push(s.year)
  g.tSeatTo[t].push(-1)
}

/** Seat id of tradition t is lost this year; the tradition ends with its last seat. */
function dropSeat(s: HistoryState, g: GoodsState, t: number, id: number): void {
  const c = g.tCraft[t]
  if (g.seatOf[id * 4 + c] === t) g.seatOf[id * 4 + c] = -1
  const se = g.tSeats[t], to = g.tSeatTo[t]
  for (let k = 0; k < se.length; k++) if (se[k] === id && to[k] < 0) to[k] = s.year
  if (seatsOf(g, t).length === 0 && g.tEnd[t] < 0) {
    g.tEnd[t] = s.year
    logGoods(s, EventType.TraditionLost, id, -1, t)
  }
}

/** A new tradition of craft c of settlement id's people (a daughter of `parent` at quality q0); returns its id. */
function birth(s: HistoryState, g: GoodsState, c: number, id: number, parent: number, q0: number): number {
  const t = g.tCount++
  const people = s.people[id]
  const rel = TRADITION.base[c] * (0.6 + 0.4 * q0)
  const v = newVariety(s, g, CRAFT_GOOD[c], VarietyKind.Tradition, t, people, Maker.Settlement, id, CRAFT_VALUE[c], rel)
  g.tCraft.push(c); g.tPeople.push(people); g.tVar.push(v); g.tQ.push(q0); g.tBorn.push(s.year); g.tBornAt.push(id); g.tEnd.push(-1)
  g.tParent.push(parent); g.tSeats.push([]); g.tSeatFrom.push([]); g.tSeatTo.push([]); g.tRenowned.push(0); g.tOut.push(0)
  addSeat(s, g, t, id)
  return t
}

/** Every 10 years (year % 10 = 5): practice, births, quality, clusters, idle seats (see the header). */
export function traditionPass(s: HistoryState, g: GoodsState): void {
  const X = TRADITION
  const rng = g.rng
  const living = s.living
  // Practice and births.
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const p = s.pop[id]
    for (let c = 0; c < 4; c++) {
      const out = outOf(s, g, id, c)
      const k = id * 4 + c
      g.practice[k] += X.practice * (out - g.practice[k])
      if (g.seatOf[k] >= 0 || p < X.birthPop) continue
      const thr = X.birthShare[c] * p
      const pr = g.practice[k]
      if (pr < thr) continue
      // A secret craft: only its holders (the first birth creates the secret).
      const people = s.people[id]
      const sk = secretKind(g, c, id)
      if (sk >= 0 && !craftHeld(g, sk, people)) continue
      // No tradition of this craft of the same people within `spacing` hops.
      let near = false
      const sp2 = hops2(s, X.spacing)
      for (let u = 0; u < g.tCount && !near; u++) {
        if (g.tEnd[u] >= 0 || g.tCraft[u] !== c || g.tPeople[u] !== people) continue
        for (const x of seatsOf(g, u)) if (chord2(s, x, id) < sp2) { near = true; break }
      }
      if (near) continue
      if (rng.next() >= X.birth * smoothstep(1, 3, pr / thr)) continue
      const nt = birth(s, g, c, id, -1, 1)
      logGoods(s, EventType.TraditionBorn, id, -1, nt)
      if (sk === -1) grantCraft(s, g, c, id, -1, 0) // (the first of a secret craft: the secret begins)
      else if (sk >= 0) setVarSecret(g, g.tVar[nt], sk)
    }
  }
  // Quality, clusters, idle seats.
  for (let t = 0; t < g.tCount; t++) {
    if (g.tEnd[t] >= 0) continue
    const c = g.tCraft[t]
    const seats = seatsOf(g, t)
    let out = 0, pop = 0, big = seats[0]
    for (const x of seats) {
      const o = outOf(s, g, x, c)
      out += o
      pop += s.pop[x]
      if (s.pop[x] > s.pop[big]) big = x
      const u1 = o / (o + X.birthShare[c] * s.pop[x] + 1e-9)
      const k = x * 4 + c
      if (u1 < X.deadU) g.seatIdle[k] += 10
      else g.seatIdle[k] = 0
    }
    const u = out / (out + X.birthShare[c] * pop + 1e-9)
    const people = g.tPeople[t]
    const field = s.tech[people * TECH_FIELD_COUNT + CRAFT_FIELD[c]]
    let qcap = 1 + X.capField * (field - CRAFT_GATE[c]) + X.capSeat * Math.min(2, seats.length - 1)
    if (c === CraftKind.Blades && g.steel >= 0 && craftHeld(g, g.steel, people)) qcap += X.steelBonus
    let Q = g.tQ[t]
    Q += X.up * (qcap - Q) * u - X.down * Q * (1 - u)
    if (Q < X.qMin) Q = X.qMin
    if (Q > X.qMax) Q = X.qMax
    g.tQ[t] = Q
    g.vRel[g.tVar[t]] = TRADITION.base[c] * (0.6 + 0.4 * Q)
    if (!g.tRenowned[t] && Q >= X.renowned) { g.tRenowned[t] = 1; logGoods(s, EventType.TraditionRenowned, big, -1, t, Q) }
    g.tOut[t] = 0
    // Busy neighbours of the same people become seats.
    const cl2 = hops2(s, X.clusterHops)
    for (let i = 0; i < living.length; i++) {
      const id = living[i]
      if (s.people[id] !== people || g.seatOf[id * 4 + c] >= 0) continue
      if (outOf(s, g, id, c) < X.clusterShare * X.birthShare[c] * s.pop[id] || !(outOf(s, g, id, c) > 0)) continue
      let close = false
      for (const x of seats) if (chord2(s, x, id) < cl2) { close = true; break }
      if (!close) continue
      if (rng.next() < X.cluster) addSeat(s, g, t, id)
    }
    // Idle or abandoned seats are lost.
    for (const x of seats) if (s.abandoned[x] >= 0 || g.seatIdle[x * 4 + c] >= X.deadYears) dropSeat(s, g, t, x)
  }
}

/** A seat abandoned this year loses its traditions (from the event scan). */
export function seatAbandoned(s: HistoryState, g: GoodsState, id: number): void {
  if (id >= g.cap) return
  for (let c = 0; c < 4; c++) { const t = g.seatOf[id * 4 + c]; if (t >= 0) dropSeat(s, g, t, id) }
}

/**
 * Craftsmen leave seat `from` for `to` (a Migration of `group`; push 1..4) or are deported after a sack (cause 1), or flee
 * a sack for another people's town (cause 2): each tradition seated at `from` may go with them.
 */
export function carryCraft(s: HistoryState, g: GoodsState, from: number, to: number, group: number, push: number, cause: number): void {
  if (from >= g.cap || to < 0 || s.abandoned[to] >= 0) return
  const X = TRADITION
  const rng = g.rng
  for (let c = 0; c < 4; c++) {
    const t = g.seatOf[from * 4 + c]
    if (t < 0 || g.tEnd[t] >= 0) continue
    let chance: number
    if (cause === 1) chance = X.deport
    else {
      const pop = s.pop[from] + group
      chance = X.carry * (group / pop) * push * (1 - 0.7 * protection(s, g, c, from))
    }
    if (rng.next() >= chance) continue
    if (g.seatOf[to * 4 + c] >= 0) continue
    const far = s.people[to] !== s.people[from] || chord2(s, from, to) > hops2(s, X.farHops)
    let nt = t
    if (far || cause !== 0) {
      nt = birth(s, g, c, to, t, g.tQ[t] * (cause === 1 ? X.deportQ : X.daughter))
      if (s.people[to] !== s.people[from]) {
        const sk = secretKind(g, c, from)
        if (sk >= 0 && !craftHeld(g, sk, s.people[to])) grantCraft(s, g, c, to, from, cause === 1 ? 5 : 3)
      }
      const sk2 = secretKind(g, c, from)
      if (sk2 >= 0) setVarSecret(g, g.tVar[nt], sk2)
    } else addSeat(s, g, t, to)
    logGoods(s, EventType.TraditionMoved, to, from, nt, cause)
  }
}
