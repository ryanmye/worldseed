// Storage and harvest stability (M7). Staples differ in how well their harvest keeps (SpeciesDef.store: grain for
// years, tubers for weeks; cassava keeps in the ground as a drought reserve, storeDrought; freeze-dried potato keeps
// once a people has the technique) and in how hard a drought hits them (sigma). species.ts cropOf mixes them by each
// staple's share of a settlement's crop food into
//   sto  = sum share * store                                  (what keeps: History.storable, the tax base for polities)
//   damp = sum share * sigma * (1 - storeDamp * storeDrought) / dampRef
// and the food system (population.ts) multiplies a bad harvest's shortfall by damp. Grain carried from a settlement
// costs more the less of its food keeps (trade.ts: transport / (perishLow + (1 - perishLow) * sto)), so tubers feed
// locally and grain travels.

import { SPECIES2, WEATHER } from './params.ts'
import type { HistoryState } from './state.ts'

/** Share of settlement `id`'s food that keeps in store, 0..255 (its crop part times what of it keeps; 0 for bases and the dead). */
export function storableByte(s: HistoryState, id: number): number {
  if (s.abandoned[id] >= 0 || s.outpost[id] || s.pop[id] <= 0) return 0
  let crop = 1 - s.fishFrac[id] - s.liveFrac[id]
  if (crop < 0) crop = 0
  const v = crop * s.sp.sto[id]
  return v >= 1 ? 255 : (v * 255 + 0.5) | 0
}

/** Transport cost multiplier on grain carried from settlement `id` (>= 1: perishable harvests travel badly). */
export function perishOf(s: HistoryState, id: number): number {
  const lo = SPECIES2.perishLow
  return 1 / (lo + (1 - lo) * s.sp.sto[id])
}

/** A bad harvest h (< 1) as it falls on a settlement whose shortfall weight is `damp`: 1 - (1 - h) * damp, no worse than the worst harvest. */
export function stored(h: number, damp: number): number {
  const v = 1 - (1 - h) * damp
  return v > WEATHER.harvestMin ? v : WEATHER.harvestMin
}
