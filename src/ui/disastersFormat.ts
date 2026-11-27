// disasters: chronicle and inspector lines for the natural shocks and climate epochs (events 260-268, History.disasters),
// the names the stories give them ("the Year Without Summer", "the Ash Winter of 1257", "the Long Winter", "the Great Drought
// of the Ushtaani"), and the climate strip's marks. Every function tolerates a history without the disasters fields.
//   260 "Mount Ushtaan erupted near Varn (VEI 6)"           261 "A volcanic winter: harvests failed round Varn (−1.8 °C summers)"
//   262 "Earthquake (M 7.8) at Tessa: 14% of its people killed"   263 "A great wave struck Lisk and 6 other ports"
//   264 "Tessa destroyed (−31%)"   265 "The river flooded at Amun (−4%)"   266/267 "Drought settled on the land of Varn" / "... broke"
//   268 "The world turned colder" / "A warm age began"

import { DisasterKind, EventType, type History, type HistoryEvent } from '../contract.ts'
import { peopleName, peopleOf, settlementName } from './format.ts'
import type { TimelineMark } from './timeline.ts'
import './disasters.css'

export const isDisasterEvent = (t: number) => t >= EventType.Eruption && t <= EventType.ClimateTurned

const D = (h: History) => (h as Partial<History>).disasters
const pct = (x: number | undefined) => `${Math.round((x ?? 0) * 100)}%`

/** The volcano's name in row `row` ("Mount Ushtaan"), or "a volcano". */
export function volcanoName(h: History, row: number): string {
  const d = D(h)
  return d && row >= 0 && row < d.count && d.name[row] ? d.name[row] : 'a volcano'
}

/**
 * The name the stories give a disaster row (null when it has none): the first VEI 7 eruption, or any whose volcanic winter
 * cooled the world by 1.5 degC or more, is "the Year Without Summer" (the later ones "the Ash Winter of {year}"); epochs are
 * "the Long Winter" / "the Warm Centuries"; a megadrought is "the Great Drought" of the people of its region's largest town.
 */
export function disasterTitle(h: History, row: number, megaYears = 15): string | null {
  const d = D(h)
  if (!d || !(row >= 0 && row < d.count)) return null
  const k = d.kind[row]
  if (k === DisasterKind.Eruption) {
    const great = (i: number) => d.kind[i] === DisasterKind.Eruption && (d.size[i] >= 7 || d.dT[i] <= -1.5)
    if (!great(row)) return null
    for (let i = 0; i < row; i++) if (great(i)) return `the Ash Winter of ${d.year[row]}`
    return 'the Year Without Summer'
  }
  if (k === DisasterKind.ColdEpoch) return 'the Long Winter'
  if (k === DisasterKind.WarmEpoch) return 'the Warm Centuries'
  if (k === DisasterKind.Drought && (d.endYear[row] < 0 || d.size[row] >= megaYears)) {
    if (d.size[row] < megaYears) return null
    const s = d.settlement[row]
    const p = s >= 0 ? peopleName(h, peopleOf(h, s)) : null
    return p ? `the Great Drought of the ${p}` : 'the Great Drought'
  }
  return null
}

export function disasterEventKind(e: HistoryEvent): 'disaster' | null {
  return isDisasterEvent(e.type as number) ? 'disaster' : null
}

/** One-line chronicle description (null if not a disaster event). */
export function describeDisasterEvent(h: History, e: HistoryEvent): string | null {
  if (!isDisasterEvent(e.type as number)) return null
  const name = settlementName(h, e.settlement)
  const d = D(h)
  const row = e.value
  switch (e.type) {
    case EventType.Eruption: {
      const t = disasterTitle(h, row)
      const v = volcanoName(h, row)
      return `${v === 'a volcano' ? 'A volcano' : v} erupted near ${name} (VEI ${e.extra ?? 5})` + (t ? `: ${t}` : '')
    }
    case EventType.VolcanicWinter:
      return `A volcanic winter: harvests failed round ${name} (${(e.extra ?? 0).toFixed(1).replace('-', '−')} °C summers)`
    case EventType.Earthquake: {
      const lost = d && row >= 0 && row < d.count ? d.deaths[row] : 0
      return `Earthquake (M ${(e.extra ?? 7).toFixed(1)}) at ${name}` + (lost > 0 ? `: ${pct(lostShare(h, e))} of its people killed` : '')
    }
    case EventType.Tsunami: {
      const n = (e.extra ?? 1) - 1
      return n > 0 ? `A great wave struck ${name} and ${n} other ${n === 1 ? 'port' : 'ports'}` : `A great wave struck ${name}`
    }
    case EventType.CityDestroyed:
      return `${name} destroyed (−${pct(e.extra)})`
    case EventType.Flood:
      return `The river flooded at ${name} (−${pct(e.extra)})`
    case EventType.DroughtBegan:
      return `Drought settled on the land of ${name}`
    case EventType.DroughtEnded: {
      const t = disasterTitle(h, row)
      return `The drought round ${name} broke after ${e.extra ?? 0} years` + (t ? ` (${t})` : '')
    }
    case EventType.ClimateTurned:
      return (e.extra ?? 0) < 0 ? 'The world turned colder' : 'A warm age began'
  }
  return null
}

/** The share of its people settlement e.settlement lost to the disaster of row e.value (from its CityDestroyed sibling or the row). */
function lostShare(h: History, e: HistoryEvent): number {
  for (const x of h.events) if (x.type === EventType.CityDestroyed && x.value === e.value && x.settlement === e.settlement) return x.extra ?? 0
  const d = D(h)
  if (!d) return 0
  // without a CityDestroyed event: the row's deaths over the town's people before (approximately: deaths / (deaths + people after))
  const S = h.settlements.length
  const q = Math.min(h.snapshotCount - 1, Math.max(0, Math.floor(e.year / h.snapshotInterval)))
  const after = h.population[q * S + e.settlement] ?? 0
  const lost = d.deaths[e.value]
  return lost + after > 0 ? lost / (lost + after) : 0
}

/** Description from the point of view of settlement `id` (inspector); null if not a disaster event. */
export function describeDisasterEventFor(h: History, e: HistoryEvent, id: number): string | null {
  if (!isDisasterEvent(e.type as number)) return null
  if (e.settlement !== id) return describeDisasterEvent(h, e)
  switch (e.type) {
    case EventType.Eruption: return `Saw ${volcanoName(h, e.value)} erupt (VEI ${e.extra ?? 5})`
    case EventType.VolcanicWinter: return `Its harvests failed in a volcanic winter (${(e.extra ?? 0).toFixed(1).replace('-', '−')} °C summers)`
    case EventType.Earthquake: return `Struck by an earthquake (M ${(e.extra ?? 7).toFixed(1)})`
    case EventType.Tsunami: return 'Struck by a great wave from the sea'
    case EventType.CityDestroyed: return `Destroyed: lost ${pct(e.extra)} of its people at once`
    case EventType.Flood: return `The river flooded: lost ${pct(e.extra)} of its people`
    case EventType.DroughtBegan: return 'A long drought settled on its land'
    case EventType.DroughtEnded: return `The drought on its land broke after ${e.extra ?? 0} years`
    case EventType.ClimateTurned: return (e.extra ?? 0) < 0 ? 'The world turned colder' : 'A warm age began'
  }
  return null
}

/** The climate strip's marks: epochs as spans, eruptions of VEI 6 and 7 as ticks (click: jump to the year). */
export function climateMarks(h: History): TimelineMark[] {
  const d = D(h)
  const out: TimelineMark[] = []
  if (!d) return out
  for (let i = 0; i < d.count; i++) {
    const k = d.kind[i]
    if (k === DisasterKind.ColdEpoch || k === DisasterKind.WarmEpoch) {
      const to = d.endYear[i] < 0 ? h.years : d.endYear[i]
      const cold = k === DisasterKind.ColdEpoch
      out.push({ from: d.year[i], to: Math.max(d.year[i] + 1, to), color: cold ? 'rgba(120, 175, 255, 0.55)' : 'rgba(255, 140, 100, 0.55)', title: `${cold ? 'The Long Winter' : 'The Warm Centuries'}: ${d.year[i]}–${d.endYear[i] < 0 ? '' : to}` })
    } else if (k === DisasterKind.Eruption && d.size[i] >= 6) {
      const t = disasterTitle(h, i)
      out.push({ from: d.year[i], to: d.year[i] + 1, color: d.size[i] >= 7 ? '#ff7a3c' : '#c9b8a6', title: `${d.year[i]}: ${volcanoName(h, i)} erupted (VEI ${d.size[i]})${t ? ` — ${t}` : ''}` })
    }
  }
  return out
}
