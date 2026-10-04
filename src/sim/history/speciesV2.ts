// Species, second version: what the plants and animals of species.ts do beyond feeding people. This file holds the
// state and runs the systems, in this order at the end of each year (after species.ts speciesSystem):
//   storage.ts     what keeps in store: a settlement's staples set how hard a bad harvest hits it (cropOf writes the
//                  mix; population.ts applies it) and how far its grain can be carried (trade.ts); History.storable.
//   cashCrops.ts   fibre, luxury and stimulant species grown for trade on part of the fields where they fit and pay
//                  (prices from the market), yielding the goods Cloth, Luxury and Stimulant (trade.ts), wearing the soil
//                  (land.ts) and taking land from food (population.ts); History.cash.
//   habit.ts       habituation per people to each stimulant (History.habit), its harm, and the drain of wealth paying for it.
//   blight.ts      crop diseases striking peoples that depend on one staple (clonal ones most), spreading along contacts
//                  and trade; livestock plagues when a people takes up a herd animal from one that has long kept it.
//   techniques.ts  techniques and improved strains found by trigger (rarely where a people met already has them) and
//                  learned between peoples mostly through trade (History.techniques, techniqueYear, techniqueSource).
// Draws: 'history-species-hazard' (blight, livestock plague), 'history-species-techniques' (techniques found). Nothing
// else here draws. Fixed iteration orders (settlement id, people id, species id); no Maps or Sets iterated.

import type { HistoryEvent, TechniqueInfo, World } from '../../contract.ts'
import type { Rng } from '../rng.ts'
import type { SettlementNaming } from '../names/index.ts'
import { shiftWord } from '../names/words.ts'
import { BLIGHT, CASHCROP, HABIT, TECHNIQUE2 } from './params.ts'
import type { HistoryState } from './state.ts'
import type { MarketView } from './species.ts'
import { assembleTechniques, ITEMS, K_COUNT, NST, S_COUNT, STIMULANTS } from './species.ts'
import { cashUpdate, wearPass } from './cashCrops.ts'
import { habitStep, habitYear } from './habit.ts'
import { blightPass, blightYear, plagueFromEvents } from './blight.ts'
import { techniquePass } from './techniques.ts'
import { storableByte } from './storage.ts'

export interface SpeciesV2 {
  P: number
  /** Stimulant species count (History.stimulants). */
  NK: number
  rngHazard: Rng
  rngTech: Rng
  /** Settlement capacity of the per-settlement arrays. */
  cap: number
  // Per people and stimulant [p * NK + k].
  /** Habit, 0..1; 1 once the stimulant has reached the people (grown or bought); 1 once HabitSpreads was logged. */
  habit: Float64Array
  access: Uint8Array
  spreadLogged: Uint8Array
  /** Consumption (units) summed since the last habit step. */
  consAcc: Float64Array
  /** Smoothed net import value a year (imports minus exports, at the buyers' prices); years in a row over the drain threshold; logged. */
  balance: Float64Array
  drainRun: Int32Array
  drainLogged: Uint8Array
  /** Per people: smoothed trade income a year (wealth gained), and the habit total (sum over stimulants, capped). */
  income: Float64Array
  habitSum: Float64Array
  // Per settlement.
  /** Units of each good (Cloth, Luxury, Stimulant) per unit of potential crop food, from the cash shares (cashUpdate); wool per unit livestock food. */
  coef: Float64Array
  wool: Float64Array
  /** Stimulant output per species per unit of potential crop food [id * NK + k]. */
  stimCoef: Float64Array
  /** Stimulant in stock by species this year (set from production, moved with each trade flow) [id * NK + k]. */
  amt: Float64Array
  /** Value of each stimulant bought and sold this year [id * NK + k]. */
  imp: Float64Array
  exp: Float64Array
  /** Production of Cloth, Luxury, Stimulant this year (units; traders, set by the market). */
  prod: Float64Array
  /** Share of the fields under cash crops (of the crop part) cut from food. */
  cut: Float64Array
  /** Wealth at the end of last year (for trade income). */
  prevWealth: Float64Array
  /** What each settlement paid this year for the Luxury and Stimulant it bought (value at its prices). */
  pay: Float64Array
  /** Settlements the market moved luxuries or stimulants to or from this year (touchedN of them; touchedMark per settlement). */
  touched: Int32Array
  touchedN: number
  touchedMark: Uint8Array
  // Blight, per people and staple [p * NST + t].
  /** 1 + blights survived (resistant strains); years of blight left; 1 where the staple's pests are present. */
  strains: Int32Array
  blightLeft: Int32Array
  pest: Uint8Array
  /** Livestock plague per people: share of herds lost at the strike, years of regrowth left. */
  herdLoss: Float64Array
  herdLeft: Int32Array
  /** Events scanned for herd adoptions (index into s.events). */
  evSeen: number
  // Diagnostics (flattened).
  /** Blights: year, people, species, loss, share of the people's crop food, people's population before, years, jumped (1) or not, share of the people's farm food lost. */
  blightLog: number[]
  /** Livestock plagues: year, people, species, loss, source people. */
  plagueLog: number[]
  /** Drains: year, people, species, balance, income. */
  drainLog: number[]
  /** First year each people suffered pellagra (maize >= pellagraLow of its food without lime-processing), -1. */
  pellagra: Int16Array
  /** Snapshots: habit (P * NK bytes per snapshot), storable (ragged per settlement, offsets / counts per snapshot). */
  snapHabit: Uint8Array
  habitUsed: number
  snapSto: Uint8Array
  stoUsed: number
  stoOff: number[]
  stoCount: number[]
}

/** Creates the v2 state (after createSpecies, before the tribes are founded). */
export function createSpeciesV2(s: HistoryState, rngHazard: Rng, rngTech: Rng): SpeciesV2 {
  const P = s.sp.P
  const NK = STIMULANTS.length
  const cap = 256
  const strains = new Int32Array(P * NST).fill(1)
  return {
    P, NK, rngHazard, rngTech, cap,
    habit: new Float64Array(P * NK), access: new Uint8Array(P * NK), spreadLogged: new Uint8Array(P * NK), consAcc: new Float64Array(P * NK),
    balance: new Float64Array(P * NK), drainRun: new Int32Array(P * NK), drainLogged: new Uint8Array(P * NK),
    income: new Float64Array(P), habitSum: new Float64Array(P),
    coef: new Float64Array(cap * 3), wool: new Float64Array(cap), stimCoef: new Float64Array(cap * NK), amt: new Float64Array(cap * NK),
    imp: new Float64Array(cap * NK), exp: new Float64Array(cap * NK), prod: new Float64Array(cap * 3), cut: new Float64Array(cap), prevWealth: new Float64Array(cap),
    touched: new Int32Array(cap), touchedN: 0, touchedMark: new Uint8Array(cap), pay: new Float64Array(cap),
    strains, blightLeft: new Int32Array(P * NST), pest: new Uint8Array(P * NST), herdLoss: new Float64Array(P), herdLeft: new Int32Array(P), evSeen: 0,
    blightLog: [], plagueLog: [], drainLog: [], pellagra: new Int16Array(P).fill(-1),
    snapHabit: new Uint8Array(Math.max(1, 64 * P * NK)), habitUsed: 0, snapSto: new Uint8Array(4096), stoUsed: 0, stoOff: [], stoCount: [],
  }
}

function growF(a: Float64Array, n: number): Float64Array { const b = new Float64Array(n); b.set(a); return b }

/** Grows the per-settlement arrays to cover `count` settlements. */
export function ensureV2(v: SpeciesV2, count: number): void {
  if (count <= v.cap) return
  let size = v.cap
  while (size < count) size *= 2
  const NK = v.NK
  v.coef = growF(v.coef, size * 3)
  v.wool = growF(v.wool, size)
  v.stimCoef = growF(v.stimCoef, size * NK)
  v.amt = growF(v.amt, size * NK)
  v.imp = growF(v.imp, size * NK)
  v.exp = growF(v.exp, size * NK)
  v.prod = growF(v.prod, size * 3)
  v.cut = growF(v.cut, size)
  v.prevWealth = growF(v.prevWealth, size)
  const t = new Int32Array(size); t.set(v.touched); v.touched = t
  const tm = new Uint8Array(size); tm.set(v.touchedMark); v.touchedMark = tm
  v.pay = growF(v.pay, size)
  v.cap = size
}

/** Pushes an event with a second number (HistoryEvent.extra). */
export function logEventExtra(s: HistoryState, type: HistoryEvent['type'], settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

/** System (end of year, after speciesSystem): see the header. */
export function speciesV2System(s: HistoryState, tv: MarketView): void {
  const v = s.sp.v2
  ensureV2(v, s.count)
  const year = s.year
  plagueFromEvents(s, v)
  blightYear(s, v)
  habitYear(s, v, tv)
  const living = s.living
  if (year % CASHCROP.step === 0) for (let t = 0; t < living.length; t++) cashUpdate(s, v, tv, living[t])
  if (year % HABIT.step === 0) habitStep(s, v, tv)
  if (year % TECHNIQUE2.step === 0) techniquePass(s, v)
  if (year % CASHCROP.wearStep === 0) wearPass(s)
  if (year % BLIGHT.step === 5) blightPass(s, v, tv)
}

/** Snapshot (with the settlement snapshots): habit per people and stimulant, storable share per settlement. */
export function speciesV2Snapshot(s: HistoryState): void {
  const v = s.sp.v2
  const n = v.P * v.NK
  if (v.habitUsed + n > v.snapHabit.length) { const b = new Uint8Array(Math.max(2 * v.snapHabit.length, v.habitUsed + n)); b.set(v.snapHabit); v.snapHabit = b }
  const alive = ALIVE.length >= v.P ? ALIVE : (ALIVE = new Uint8Array(v.P))
  alive.fill(0)
  for (let t = 0; t < s.living.length; t++) alive[s.people[s.living[t]]] = 1
  for (let i = 0; i < n; i++) v.snapHabit[v.habitUsed + i] = alive[(i / v.NK) | 0] ? (v.habit[i] * 255 + 0.5) | 0 : 0
  v.habitUsed += n
  const S = s.count
  if (v.stoUsed + S > v.snapSto.length) { let m = v.snapSto.length; while (m < v.stoUsed + S) m *= 2; const b = new Uint8Array(m); b.set(v.snapSto); v.snapSto = b }
  for (let id = 0; id < S; id++) v.snapSto[v.stoUsed + id] = storableByte(s, id)
  v.stoOff.push(v.stoUsed)
  v.stoCount.push(S)
  v.stoUsed += S
}
let ALIVE = new Uint8Array(0)

export interface SpeciesV2History {
  techniques: TechniqueInfo[]
  techniqueYear: Int16Array
  techniqueSource: Int8Array
  habit: Uint8Array
  stimulants: number[]
  storable: Uint8Array
}

/** The v2 fields of History up to `snapshotCount` snapshots of `S` settlements (each array with its own buffer). */
export function assembleV2(world: World, s: HistoryState, naming: SettlementNaming, used: Set<string>, snapshotCount: number, S: number, techYear: Int16Array, techSource: Int8Array): SpeciesV2History {
  const v = s.sp.v2
  const n = v.P * v.NK
  const habit = v.snapHabit.slice(0, snapshotCount * n)
  const storable = new Uint8Array(snapshotCount * S)
  for (let q = 0; q < snapshotCount; q++) storable.set(v.snapSto.subarray(v.stoOff[q], v.stoOff[q] + v.stoCount[q]), q * S)
  return {
    techniques: assembleTechniques(world, s.sp, naming, used, s.founders),
    techniqueYear: techYear, techniqueSource: techSource,
    habit, stimulants: STIMULANTS.slice(), storable,
  }
}

/** Diagnostics for the stats harness and tests (copies). */
export interface SpeciesV2Diag {
  blightLog: number[]
  plagueLog: number[]
  drainLog: number[]
  pellagra: Int16Array
  /** Running net import value per people and stimulant, and smoothed trade income per people, at the end. */
  balance: Float64Array
  income: Float64Array
  /** Loanword names: what each people calls each species and technique it holds [p * (S + K) + item], '' if not held. */
  localNames: string[]
}

export function v2Diag(s: HistoryState, speciesNames: string[], techNames: string[], naming: SettlementNaming): SpeciesV2Diag {
  const v = s.sp.v2
  return {
    blightLog: v.blightLog.slice(), plagueLog: v.plagueLog.slice(), drainLog: v.drainLog.slice(), pellagra: v.pellagra.slice(),
    balance: v.balance.slice(), income: v.income.slice(), localNames: localNames(s, speciesNames, techNames, naming),
  }
}

/**
 * M16 loanwords: a people that took a species or technique from another calls it by the giver's word carried into its own
 * sounds (names/words.ts shiftWord: each sound to the one at the same place in the borrower's inventory), the giver's own
 * word being its loan from whoever it had it from, back to the first holders' word (History species / technique name).
 * Peoples that tamed it themselves or had it from the start use that name. Resolved in order of the year held.
 */
function localNames(s: HistoryState, speciesNames: string[], techNames: string[], naming: SettlementNaming): string[] {
  const sp = s.sp
  const P = sp.P
  const W = S_COUNT + K_COUNT
  const out: string[] = new Array<string>(P * W).fill('')
  const langOf = (p: number) => naming.language(naming.tribe[s.founders[p]], 0)
  for (let x = 0; x < W; x++) {
    const base = x < S_COUNT ? speciesNames[x] : techNames[x - S_COUNT]
    const order: number[] = []
    for (let p = 0; p < P; p++) if (sp.year[p * ITEMS + x] >= 0) order.push(p)
    order.sort((a, b) => sp.year[a * ITEMS + x] - sp.year[b * ITEMS + x] || a - b)
    for (const p of order) {
      const src = sp.source[p * ITEMS + x]
      if (src < 0 || !out[src * W + x]) { out[p * W + x] = base; continue }
      out[p * W + x] = shiftWord(out[src * W + x], langOf(src), langOf(p)) ?? out[src * W + x]
    }
  }
  return out
}
