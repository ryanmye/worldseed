// seat: History.seat from the seat state, up to the year assembled (copies: the run goes on).
import { DEFER_OPTIONS, OrderKind, SeatOptionKey } from '../../../contract.ts'
import type { Order, SeatHistory } from '../../../contract.ts'
import type { SeatState } from './state.ts'
import { copySeat } from './state.ts'

/** History.seat at `years`; `orders` the run's orders so far (the Choice records give `chosen`). */
export function assembleSeat(st: SeatState, orders: readonly Order[], years: number): SeatHistory {
  const n = st.dYear.length
  const nY = Math.max(0, years - st.opts.from + 1)
  const chosen = new Int8Array(n).fill(-1)
  const deferred = new Uint8Array(n)
  for (const o of orders) {
    if (o.kind !== OrderKind.Choice || o.target === undefined || o.target < 0 || o.year > years) continue
    const d = Math.floor(o.target / 8)
    if (d >= n || st.dYear[d] + 1 !== o.year) continue
    let x = o.target % 8
    if (x === DEFER_OPTIONS.defer) { x = st.dCourt[d]; deferred[d] = 1 } // (a deferral: the cautious court's pick)
    else if (x === DEFER_OPTIONS.reclaim) {
      x = -1
      for (let k = st.optStart[d]; k < st.optStart[d + 1]; k++) if (st.optKey[k] === SeatOptionKey.Reclaim) { x = k - st.optStart[d]; break }
    }
    chosen[d] = x
  }
  return {
    seat: copySeat(st.opts),
    polityAt: Int32Array.from(st.polityAt.slice(0, nY)),
    peopleAt: Int32Array.from(st.peopleAt.slice(0, nY)),
    decisions: {
      count: n,
      year: Int32Array.from(st.dYear), kind: Uint8Array.from(st.dKind), polity: Int32Array.from(st.dPolity), subject: Int32Array.from(st.dSubject), place: Int32Array.from(st.dPlace),
      optStart: Uint32Array.from(st.optStart), optKey: Uint8Array.from(st.optKey),
      orderStart: Uint32Array.from(st.orderStart), orderKind: Uint8Array.from(st.orderKind), orderActor: Int32Array.from(st.orderActor), orderTarget: Int32Array.from(st.orderTarget),
      chosen, divisive: Float32Array.from(st.dDiv), courtPick: Int8Array.from(st.dCourt), deferred,
      info: Int32Array.from(st.dInfo), hud: Float32Array.from(st.hud), heirStart: Uint32Array.from(st.heirStart), heirBorn: Int32Array.from(st.heirBorn), heirFlags: Uint8Array.from(st.heirFlags),
    },
    ambitionYear: Int32Array.from(st.ambitionYear),
    lostYear: st.lostYear,
  }
}
