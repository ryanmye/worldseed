// Text formatting shared by the timeline, inspector and chronicle.

import { EventType, StructureType, type History, type HistoryEvent } from '../contract.ts'

/**
 * Display name of a settlement. Procedural names arrive in a later milestone: when
 * Settlement gains a `name`, it is picked up here and everywhere else follows.
 */
export function settlementName(history: History, id: number): string {
  const s = history.settlements[id] as { name?: string } | undefined
  return s?.name ?? `Settlement #${id}`
}

/** 812, 4.3k, 56k, 1.2M */
export function formatPopulation(n: number): string {
  const v = Math.max(0, n)
  if (v < 1000) return String(Math.round(v))
  if (v < 1e6) return (v / 1e3).toFixed(v < 1e4 ? 1 : 0) + 'k'
  if (v < 1e9) return (v / 1e6).toFixed(v < 1e7 ? 1 : 0) + 'M'
  return (v / 1e9).toFixed(1) + 'B'
}

/** 12,345 */
export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export type EventKind = 'founded' | 'abandoned' | 'famine' | 'migration' | 'built' | 'town' | 'city' | 'lost'

export function eventKind(e: HistoryEvent): EventKind {
  switch (e.type) {
    case EventType.Founded: return 'founded'
    case EventType.Abandoned: return 'abandoned'
    case EventType.Famine: return 'famine'
    case EventType.Built: return 'built'
    case EventType.BecameTown: return 'town'
    case EventType.BecameCity: return 'city'
    case EventType.StructureLost: return 'lost'
    default: return 'migration'
  }
}

/** Type of the structure an event refers to: `value` carries it, `other` is the structure id. */
function structureTypeOf(h: History, e: HistoryEvent): number {
  const st = (h as Partial<History>).structures?.[e.other]
  return st ? st.type : e.value
}

export function structureName(type: number): string {
  return type === StructureType.Dam ? 'dam' : 'port'
}

/** One-line description of an event for the global chronicle. */
export function describeEvent(h: History, e: HistoryEvent): string {
  const name = settlementName(h, e.settlement)
  switch (e.type) {
    case EventType.Founded:
      return e.other >= 0 ? `${name} founded from ${settlementName(h, e.other)}` : `${name} founded by an original tribe`
    case EventType.Abandoned:
      return `${name} abandoned`
    case EventType.Famine:
      return `Famine in ${name}` + (e.value > 0 ? ` (−${Math.round(e.value * 100)}%)` : '')
    case EventType.Built:
      return structureTypeOf(h, e) === StructureType.Dam ? `${name} dams the river` : `${name} builds a port`
    case EventType.BecameTown:
      return `${name} grows into a town`
    case EventType.BecameCity:
      return `${name} becomes a city`
    case EventType.StructureLost:
      return structureTypeOf(h, e) === StructureType.Dam ? `The dam of ${name} falls into ruin` : `The port of ${name} falls into ruin`
    default:
      return `${formatInt(e.value)} migrated from ${name} to ${settlementName(h, e.other)}`
  }
}

/** Chronicle line for `count` famines in one year, `worst` being the most severe. */
export function describeFamineBurst(h: History, worst: HistoryEvent, count: number): string {
  return `Famine across ${count} settlements, worst in ${settlementName(h, worst.settlement)}` + (worst.value > 0 ? ` (−${Math.round(worst.value * 100)}%)` : '')
}

/**
 * Chronicle line for `count` foundings in one decade; `largest` is the founding with the
 * largest party and `sameParent` whether all came from its parent.
 */
export function describeFoundings(h: History, largest: HistoryEvent, count: number, sameParent: boolean): string {
  const parent = settlementName(h, largest.other)
  return sameParent ? `${parent} founded ${count} new settlements` : `${count} new settlements founded, largest from ${parent}`
}

/** Description of an event from the point of view of settlement `id` (inspector). */
export function describeEventFor(h: History, e: HistoryEvent, id: number): string {
  switch (e.type) {
    case EventType.Founded:
      if (e.settlement === id) return e.other >= 0 ? `Founded by migrants from ${settlementName(h, e.other)}` : 'Founded by an original tribe'
      return `Founded the colony ${settlementName(h, e.settlement)}`
    case EventType.Abandoned:
      return 'Abandoned'
    case EventType.Famine:
      return 'Famine' + (e.value > 0 ? `, lost ${Math.round(e.value * 100)}% of its people` : '')
    case EventType.Built:
      return structureTypeOf(h, e) === StructureType.Dam ? 'Dammed the river' : 'Built a port'
    case EventType.BecameTown:
      return `Grew into a town (${formatInt(e.value)} people)`
    case EventType.BecameCity:
      return `Became a city (${formatInt(e.value)} people)`
    case EventType.StructureLost:
      return `Its ${structureName(structureTypeOf(h, e))} fell into ruin`
    default:
      return e.settlement === id
        ? `${formatInt(e.value)} left for ${settlementName(h, e.other)}`
        : `${formatInt(e.value)} arrived from ${settlementName(h, e.settlement)}`
  }
}
