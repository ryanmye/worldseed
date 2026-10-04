// goods: the narrow hooks other systems call (cash crops, species adoption, food, military quality, migration).
// Every one is called only while HistoryState.goods is non-null, which is how the off switch keeps the history
// bit-identical. This module imports no system module (only types), so species.ts and cashCrops.ts can import it
// without an import cycle; the per-species tables it reads are built into the goods state by system.ts.

import { TechField } from '../../../contract.ts'
import { POLITY } from '../polity/params.ts'
import { FLAGS, METAL } from './params.ts'
import type { GoodsState } from './state.ts'
import { ensureGoods } from './state.ts'

/** Price per unit of cash species x's crop at offset o of a trader's prices: its class's price times its relative worth. */
export function cashPrice(g: GoodsState, price: Float64Array, o: number, x: number): number {
  return price[o + g.spClass[x]] * g.spRel[x]
}

/** Catchment fit a cash species needs to be grown for trade (Luxury species need more: CROPS.luxMinFit). */
export function cashMinFit(g: GoodsState, x: number): number {
  return g.spMinFit[x]
}

/** Cash crop shares of settlement id are being reckoned again: its per-species output coefficients start from 0. */
export function cashCoefReset(g: GoodsState, id: number, count: number, nc: number): void {
  ensureGoods(g, count)
  g.cashCoef.fill(0, id * nc, (id + 1) * nc)
}

/** Output coefficient of cash crop index q (CASH order) at settlement id (units per unit of potential crop food). */
export function cashCoefSet(g: GoodsState, id: number, nc: number, q: number, out: number): void {
  g.cashCoef[id * nc + q] = out
}

/**
 * Secret species: a people that does not hold species x's secret cannot take it up from another people (replaces the
 * species' `cross` factor for the four secret species); for any other species the factor stays. Returns the factor.
 */
export function crossFactor(g: GoodsState, x: number, people: number, cross: number): number {
  const k = g.speciesSecret[x]
  if (k < 0) return cross
  return g.sHeld[k][people] ? 1 : 0
}

/** True when people may take up species x from a people met (an expedition's way home): false for a secret it does not hold. */
export function mayAdopt(g: GoodsState, x: number, people: number): boolean {
  const k = g.speciesSecret[x]
  return k < 0 || g.sHeld[k][people] === 1
}

/** Farm multiplier of settlement id from its tools (population.ts). */
export function toolFarm(g: GoodsState, id: number): number {
  return id < g.cap && FLAGS.tools ? g.toolMul[id] : 1
}

/** Rush multiplier of a migration site or join score on cell c (migration.ts). */
export function rushAt(g: GoodsState, c: number): number {
  return g.rush[c]
}

/**
 * Military quality of settlement id (polity/state.ts qualityOf) with the goods system on: Metalworking weighs METAL.qMetal
 * (instead of POLITY.qMetal) and the arms stock the rest: q * (1 + armsQ * a / (a + armsHalf)), a = arms a head (fine
 * blades count their relative worth). `o` is the people's offset into tech, `horse` 1 with horses.
 */
export function armsQuality(g: GoodsState, tech: Float64Array, o: number, horse: number, pop: number, id: number): number {
  const q = 1 + METAL.qMetal * (tech[o + TechField.Metalworking] - 1) + POLITY.qCrafts * (tech[o + TechField.Crafts] - 1) + 0.3 * horse
  if (id >= g.cap || !(pop > 0) || !FLAGS.arms) return q
  const a = (g.arms[id] * g.armsRel[id]) / pop
  return q * (1 + (METAL.armsQ * a) / (a + METAL.armsHalf))
}
