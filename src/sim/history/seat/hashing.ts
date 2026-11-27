// seat: value hashes for the seat and live-append tests (the same FNV walk as orders.test.ts): every History field, or every
// field but some keys and some event types (the comparisons "identical apart from ...").
import type { History } from '../../../contract.ts'

function fnvBytes(h: number, b: Uint8Array): number {
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) }
  return h
}
const enc = new TextEncoder()
/** Hash of any value: typed arrays by bytes, arrays and objects key by key (sorted), numbers as float64. */
export function hv(h: number, v: unknown): number {
  if (v === null || v === undefined) return fnvBytes(h, enc.encode(String(v)))
  if (ArrayBuffer.isView(v)) { h = fnvBytes(h, enc.encode(v.constructor.name)); return fnvBytes(h, new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) }
  if (typeof v === 'number') return fnvBytes(h, new Uint8Array(new Float64Array([v]).buffer))
  if (typeof v === 'string' || typeof v === 'boolean') return fnvBytes(h, enc.encode(typeof v + String(v)))
  if (Array.isArray(v)) { h = fnvBytes(h, enc.encode('[' + v.length)); for (const x of v) h = hv(h, x); return h }
  if (typeof v === 'object') { for (const k of Object.keys(v as object).sort()) { h = fnvBytes(h, enc.encode(k)); h = hv(h, (v as Record<string, unknown>)[k]) } return h }
  return h
}

/** Hash of every History field. */
export function hashAll(h: History): string {
  return (hv(0x811c9dc5, h) >>> 0).toString(16)
}

/** Hash of every History field but the keys `skip`, with the events whose type `drop` accepts left out. */
export function hashWithout(hi: History, skip: readonly string[], drop: (type: number) => boolean): string {
  const r = hi as unknown as Record<string, unknown>
  let h = 0x811c9dc5
  for (const k of Object.keys(r).filter((x) => skip.indexOf(x) < 0).sort()) {
    h = fnvBytes(h, enc.encode(k))
    h = hv(h, k === 'events' ? hi.events.filter((e) => !drop(e.type)) : r[k])
  }
  return (h >>> 0).toString(16)
}
