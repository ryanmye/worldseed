// What-if (experience-whatif-director-sagas §1.5): which event fields can be matched across two runs. After two runs part,
// they number their towns, polities, wars and rulers differently, so an event is matched by geography: its type, its year,
// the cell of its settlement and, for the types whose `other` is a settlement, the cell of that one too. This module is
// imported by the worker, which must stay DOM- and CSS-free, so it cannot import the UI's predicates (historyIndex.ts
// imports landmarksFormat.ts and renamingFormat.ts, which import CSS): the table is a copy, checked against
// historyIndex.ts otherIsSettlement on every type id by eventFields.test.ts. A type missing from it hashes without its
// `other`, which can under-report a difference but never invents one.

import { EventType } from '../contract.ts'

/** Event types whose `other` is a settlement id (historyIndex.ts otherIsSettlement, copied; the test keeps them equal). */
const OTHER_IS_SETTLEMENT: readonly number[] = [
  0, 3, 8, 9, 11, 12, 14, 18, 19, 21, 22, 24, 25, 30, 32, 33, 35, 37, 38, 39, 42, 43, 45, 47, 48, 49, 55, 57, 58, 59, 60, 61, 62, 63, 64, 65, 67, 69, 70, 72,
  85, 86, 87, 88, 92, 94, 95, 97, 100, 101, 102, 105, 110, 120, 121, 123, 130, 140, 141, 142, 143, 144, 145, 146, 150, 151, 160, 161, 162, 163, 165, 166, 167, 169, 170, 171, // (161-169 but 164, 168: families)
  190, 191, 192, 193, 194, 200, 201, 203, 205, 210, 211, 212, 213, 214, 215, 216, 217, 220, 221, 223, 224, 225, 226, 227,
  230, 231, 232, 233, 234, 235, 236, 237, 238, // beliefs: the other realm's capital, or a claimed town
]

/** Flags per event type id (EVENT_FIELDS[type]). */
export const FieldFlag = { OtherIsSettlement: 1 } as const

/** Highest event type id the table covers (ids above it get no flags). */
export const EVENT_TYPE_MAX = 1023

/** Per event type: FieldFlag bits. */
export const EVENT_FIELDS: Uint8Array = (() => {
  const a = new Uint8Array(EVENT_TYPE_MAX + 1)
  for (const t of OTHER_IS_SETTLEMENT) a[t] |= FieldFlag.OtherIsSettlement
  return a
})()

export const otherIsSettlementType = (t: number): boolean => t >= 0 && t <= EVENT_TYPE_MAX && (EVENT_FIELDS[t] & FieldFlag.OtherIsSettlement) !== 0

/** The player's own events, left out of a comparison: the orders (170-179) and the planted hearths (180). They differ by construction. */
export const isPlayerEvent = (t: number): boolean => (t >= EventType.OrderGiven && t <= 179) || t === EventType.CradlePlaced
