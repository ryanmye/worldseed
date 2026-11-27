// Sagas: the natural shocks (History.disasters; events 260-268) in both registers. The chronicle hedges ("It is written that
// in 1257 Mount Ushtaan burst in the far south, and that the sun was weak for two summers"); the legend tells it as plain
// fact ("In 1257 Ushtaan woke. Ash fell on the fields, and that summer never came"). Great shocks get a precursor omen from
// DISASTER_OMENS, a table of their own (never an order's, and an order's omen is never one of these): the springs ran hot and
// smelled of sulphur before an eruption, the sea drew back before a wave (both real precursors), the wells rose and fell and
// the dogs howled before a quake (folklore, not established science). The omen is chosen by a stream seeded with the world
// and the disaster row, so every saga that tells it tells the same one. Nothing here credits a disaster to an order.

import { DisasterKind, EventType, TOWN_POPULATION, type HistoryEvent } from '../../contract.ts'
import { createRng } from '../../sim/rng.ts'
import { disasterTitle, volcanoName } from '../disastersFormat.ts'
import type { Ctx } from './facts.ts'
import { cap, fill, shareWords, type PhraseTable, type Voice } from './voice.ts'

export const DISASTER_T: PhraseTable = {
  hDisasters: [['Fire, Flood and the Shaking of the Earth'], ['When the Earth Stirred']],
  eruptC: [['It is written that in {year} {volcano} burst {near}, and that the sun was weak for {summers}.', 'The records say {volcano} woke in {year} {near}; ash fell, and the summers after were cold.'], []],
  eruptL: [[], ['In {year} {volcanoBare} woke. Ash fell on the fields {near}, and that summer never came{title}.', 'In {year} the mountain {volcanoBare} split, and fire came out of it{title}.']],
  winterC: [['In {year}, they say, the harvests failed round {name} in a summer without warmth{title}.'], []],
  winterL: [[], ['In {year} the sun was a pale coin, the grain stood green into autumn and rotted round {name}{title}.']],
  quakeC: [['The records speak of a great shaking at {name} in {year}, which threw down {share} of its people.', 'It is written that the earth shook at {name} in {year}, and {share} of its people died.'], []],
  quakeL: [[], ['In {year} the earth rose under {name} like a wave of the sea, and {share} of its people never rose again.']],
  waveC: [['It is written that in {year} a great wave came out of the sea upon {name}.'], []],
  waveL: [[], ['The sea drew back from the harbour of {name} as far as a man could see, and the children ran out to gather the fish. Then the sea came home.']],
  floodC: [['In {year} the river rose over {name}, and {share} of its people were lost, they say.'], []],
  floodL: [[], ['In {year} the river forgot its banks and walked through {name}.']],
  destroyedC: [['{name} was thrown down in {year}{rebuilt}.'], []],
  destroyedL: [[], ['In {year} {name} fell{rebuilt}.']],
  rebuilt: [[' and rebuilt in {gen}'], [', and in {gen} it stood again']],
  droughtC: [['A drought lay on the land round {name} from {from} for {years} years{title}.'], []],
  droughtL: [[], ['For {years} years from {from} the rain forgot the land round {name}{title}.']],
  coldC: [['In {year}, the records say, the world turned colder{title}.'], []],
  coldL: [[], ['In {year} the cold came down from the hills and stayed{title}.']],
  warmC: [['From {year}, it is written, the summers were long and kind{title}.'], []],
  warmL: [[], ['In {year} began the warm years, when the vines climbed north{title}.']],
  omenC: [['It is written that before it {omen}.', 'The chronicles add that {omen} beforehand.'], []],
  omenL: [[], ['{Omen}', 'Before it came, {omen}.']],
}

interface DOmen { c: string; l: string }
/** Precursors per DisasterKind (eruption, quake, tsunami, flood). The quake ones are folklore. */
export const DISASTER_OMENS: Record<number, readonly DOmen[]> = {
  [DisasterKind.Eruption]: [
    { c: 'the springs of {name} ran hot and smelled of sulphur', l: 'the springs of {name} ran hot and stank of sulphur, and the goats would not drink.' },
    { c: 'the mountain smoked for a month and the ground hummed', l: 'the mountain smoked for a month, and at night the ground hummed like a hive.' },
  ],
  [DisasterKind.Earthquake]: [
    { c: 'the wells of {name} rose and fell, and the dogs howled all night', l: 'the wells of {name} rose and fell, and every dog in the town howled until dawn.' },
    { c: 'the birds left {name} in one flock', l: 'the birds left {name} all at once, in one black flock.' },
  ],
  [DisasterKind.Tsunami]: [
    { c: 'the sea drew back from the harbour of {name}', l: 'the sea drew back from the harbour of {name}, further than any had seen.' },
  ],
  [DisasterKind.Flood]: [
    { c: 'it rained forty days in the hills above {name}', l: 'it rained forty days in the hills above {name}, and the river talked in the night.' },
  ],
}

/** The omen of disaster row `row` told at `name` ('' if none: only great shocks get one). */
export function disasterOmen(c: Ctx, v: Voice, row: number, name: string): string {
  const d = c.h.disasters
  if (!d || !(row >= 0 && row < d.count)) return ''
  const t = DISASTER_OMENS[d.kind[row]]
  if (!t || !t.length) return ''
  const rng = createRng(c.seed, `omen-disaster:${row}`)
  const o = t[Math.min(t.length - 1, Math.floor(rng.next() * t.length))]
  return v.legend ? v.p('omenL', { Omen: cap(fill(o.l, { name })), omen: fill(o.l, { name }) }) : v.p('omenC', { omen: fill(o.c, { name }) })
}

/** The saga lines of the disasters that struck town `id` by the year told (the worst of each kind; at most three), with omens. */
export function cityDisasterLines(c: Ctx, v: Voice, id: number): { text: string[]; omens: string[] } {
  const d = c.h.disasters
  const text: string[] = [], omens: string[] = []
  if (!d || d.count === 0) return { text, omens }
  const name = c.name(id)
  const evs = c.at(id, [EventType.Eruption, EventType.VolcanicWinter, EventType.Earthquake, EventType.Tsunami, EventType.Flood, EventType.CityDestroyed, EventType.DroughtEnded]).map((i) => c.ev(i))
  const seen = new Set<number>()
  for (const e of evs) {
    if (text.length >= 3 || seen.has(e.type)) continue
    seen.add(e.type)
    const row = e.value
    const yr = e.year
    const t = disasterTitle(c.h, row)
    const title = t ? (v.legend ? `: ${t}, the old songs call it` : ` (${t})`) : ''
    switch (e.type) {
      case EventType.Eruption: {
        const vn = volcanoName(c.h, row)
        const great = d.size[row] >= 6
        text.push(v.p(v.legend ? 'eruptL' : 'eruptC', { year: yr, volcano: vn, volcanoBare: vn.replace(/^Mount /, ''), near: `near ${name}`, summers: d.size[row] >= 7 ? 'three summers' : 'two summers', title }))
        if (great) { const o = disasterOmen(c, v, row, name); if (o) omens.push(o) }
        break
      }
      case EventType.VolcanicWinter: text.push(v.p(v.legend ? 'winterL' : 'winterC', { year: yr, name, title })); break
      case EventType.Earthquake: {
        const share = d.struck[row] > 0 && d.settlement[row] === id ? lostAt(c, id, row) : 0
        text.push(v.p(v.legend ? 'quakeL' : 'quakeC', { year: yr, name, share: shareWords(share) }))
        break
      }
      case EventType.Tsunami: text.push(v.p(v.legend ? 'waveL' : 'waveC', { year: yr, name })); break
      case EventType.Flood: text.push(v.p(v.legend ? 'floodL' : 'floodC', { year: yr, name, share: shareWords(e.extra ?? 0) })); break
      case EventType.CityDestroyed: {
        const before = c.pop(id, Math.max(0, yr - 1))
        let back = -1
        for (let y = yr + 5; y <= c.Y; y += 5) if (c.pop(id, y) >= before && before >= TOWN_POPULATION) { back = y; break }
        const rebuilt = back > 0 ? v.p('rebuilt', { gen: back - yr <= 35 ? 'a generation' : `${Math.round((back - yr) / 10) * 10} years` }) : ''
        text.push(v.p(v.legend ? 'destroyedL' : 'destroyedC', { year: yr, name, rebuilt }))
        const o = disasterOmen(c, v, row, name)
        if (o) omens.push(o)
        break
      }
      case EventType.DroughtEnded:
        text.push(v.p(v.legend ? 'droughtL' : 'droughtC', { from: d.year[row], years: e.extra ?? 0, name, title }))
        break
    }
  }
  return { text, omens }
}

/** The year saga's lines for the natural shocks of the events given (a turn of the climate, the greatest eruption, a town destroyed). */
export function yearDisasterLines(c: Ctx, v: Voice, evs: readonly HistoryEvent[]): string[] {
  const d = c.h.disasters
  const out: string[] = []
  if (!d || d.count === 0) return out
  const titled = (row: number) => { const t = disasterTitle(c.h, row); return t ? (v.legend ? `: ${t}` : ` (${t})`) : '' }
  const turn = evs.find((e) => e.type === EventType.ClimateTurned)
  if (turn) out.push(v.p((turn.extra ?? 0) < 0 ? (v.legend ? 'coldL' : 'coldC') : (v.legend ? 'warmL' : 'warmC'), { year: turn.year, title: titled(turn.value) }))
  const er = evs.filter((e) => e.type === EventType.Eruption && (e.extra ?? 0) >= 6).sort((a, b) => (b.extra ?? 0) - (a.extra ?? 0))[0]
  if (er) { const vn = volcanoName(c.h, er.value); out.push(v.p(v.legend ? 'eruptL' : 'eruptC', { year: er.year, volcano: vn, volcanoBare: vn.replace(/^Mount /, ''), near: `near ${c.name(er.settlement, er.year)}`, summers: (er.extra ?? 0) >= 7 ? 'three summers' : 'two summers', title: titled(er.value) })) }
  const ds = evs.find((e) => e.type === EventType.CityDestroyed)
  if (ds) out.push(v.p(v.legend ? 'destroyedL' : 'destroyedC', { year: ds.year, name: c.name(ds.settlement, ds.year), rebuilt: '' }))
  return out
}

/** Share of town `id`'s people lost to row `row` (its deaths over the people before; approximate between snapshots). */
function lostAt(c: Ctx, id: number, row: number): number {
  const d = c.h.disasters
  const y = d.year[row]
  const before = c.pop(id, Math.max(0, y - 1))
  return before > 0 ? Math.min(1, d.deaths[row] / before) : 0
}
