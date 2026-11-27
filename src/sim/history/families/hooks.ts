// families: bookkeeping hooks in the merchant pool (goods/merchants.ts). They only add to the families' own arrays: no value
// another system computes changes and nothing is drawn. With families off (GoodsState.ext.fam null) each is a null check.

import type { GoodsState } from '../goods/state.ts'
import { ensureFamTowns } from './state.ts'

/** Merchant inflow `x` at settlement id (leg k's end, or -1 for none). */
export function famIn(g: GoodsState, id: number, k: number, x: number): void {
  const F = g.ext.fam
  if (F === null || !(x > 0)) return
  if (id >= F.cap) ensureFamTowns(F, id + 1)
  if (F.tmark[id] === 0) { F.tmark[id] = 1; F.touched.push(id) }
  F.inY[id] += x
  if (k >= 0 && k < F.lcap && F.laneOwner[k] >= 0) { // (only the lanes a family runs are kept apart)
    if (g.legA[k] === id) F.inLegA[k] += x
    else F.inLegB[k] += x
  }
}

/** The part `x` of a venture's cost at id paid out of its merchant pool. */
export function famPay(g: GoodsState, id: number, x: number): void {
  const F = g.ext.fam
  if (F === null || !(x > 0)) return
  if (id >= F.cap) ensureFamTowns(F, id + 1)
  if (F.tmark[id] === 0) { F.tmark[id] = 1; F.touched.push(id) }
  F.payY[id] += x
}

/** Capital `x` arrived at id's pool from another pool (flight, gathering). */
export function famMovIn(g: GoodsState, id: number, x: number): void {
  const F = g.ext.fam
  if (F === null || !(x > 0)) return
  if (id >= F.cap) ensureFamTowns(F, id + 1)
  if (F.tmark[id] === 0) { F.tmark[id] = 1; F.touched.push(id) }
  F.movInY[id] += x
}
