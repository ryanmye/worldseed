// Story arcs (throne-stories-fiction §2.1; lane N3 builds the four templates the merged events support, EVALUATION §3 P3):
// T1 the usurper's spiral, T3 the princes' succession war, the revenge war (grudges), the bankruptcy war (finance). Pure and
// post hoc: walks the reigns and the events once, no RNG, ties by event index. An arc is a chain of History.events with a
// phase each (0 opening, 1 rising, 2 turn, 3 payoff); `end` -1 while its payoff could still come. The director keeps an arc's
// chapters together (plan.ts: continuity instead of novelty inside an arc, and the payoff kept wherever the opening is), and
// the bots count completed arcs (src/bots/metrics.ts arcCompletion).
import { AccessionHow, EventType, ReignEnd, WarOutcome } from '../../contract.ts'
import type { History } from '../../contract.ts'

export const ArcKind = { Usurper: 0, Princes: 1, Revenge: 2, Bankruptcy: 3 } as const
export type ArcKind = (typeof ArcKind)[keyof typeof ArcKind]
export const ARC_LABEL: readonly string[] = ['The usurper’s spiral', 'The princes’ war', 'A war of revenge', 'The war that broke the treasury']

export interface Arc {
  kind: ArcKind
  /** The realm the arc is about. */
  polity: number
  /** History.events indices in order, and each one's phase (0 opening, 1 rising, 2 turn, 3 payoff). */
  events: number[]
  phase: number[]
  start: number
  /** The payoff's year, -1 while open. */
  end: number
  complete: boolean
}

const PAYOFF = 3

/** The arcs of `h` up to `until` (default: its length). */
export function findArcs(h: History, until = h.years): Arc[] {
  const out: Arc[] = []
  const ev = h.events
  const R = h.rulers ?? []
  const W = h.wars
  // events by type, in order (only the types the matchers read)
  const byType = new Map<number, number[]>()
  const want = [EventType.RulerAcceded, EventType.ReignEnded, EventType.Revolt, EventType.CivilWar, EventType.SuccessionCrisis, EventType.DynastyEnded, EventType.WarDeclared, EventType.PeaceMade, EventType.WarBankrupt, EventType.CrownDefault, 276]
  for (const t of want) byType.set(t, [])
  for (let i = 0; i < ev.length; i++) { const e = ev[i]; if (e.year > until) break; byType.get(e.type)?.push(i) }
  const of = (t: number) => byType.get(t) ?? []
  const acceded = new Map<number, number>(), endedEv = new Map<number, number>()
  for (const i of of(EventType.RulerAcceded)) acceded.set(ev[i].value, i)
  for (const i of of(EventType.ReignEnded)) endedEv.set(ev[i].value, i)
  const capAt = (p: number, y: number) => {
    const P = h.polities?.[p]
    if (!P) return -1
    let c = -1
    for (let k = 0; k < P.capitals.length; k++) if (P.capitalYears[k] <= y) c = P.capitals[k]
    return c
  }
  const peaceOf = new Map<number, number>()
  for (const i of of(EventType.PeaceMade)) if (!peaceOf.has(ev[i].value)) peaceOf.set(ev[i].value, i)

  // T1 the usurper's spiral: a usurper's (or claimant's) reign of at most 25 years with a revolt, a civil war or a purge in it,
  // ending violently; payoff: the old house back on the throne, or the usurper's house ended
  for (const r of R) {
    if ((r.how !== AccessionHow.Usurped && r.how !== AccessionHow.Claimed) || r.acceded > until) continue
    const a = acceded.get(r.id)
    if (a === undefined) continue
    const end = r.ended >= 0 && r.ended <= until ? r.ended : -1
    const span = end >= 0 ? end : until
    if (span - r.acceded > 25) continue
    const cap = capAt(r.polity, r.acceded)
    const rising: number[] = []
    for (const i of of(EventType.Revolt)) if (ev[i].year >= r.acceded && ev[i].year <= span && ev[i].other === cap) rising.push(i)
    for (const i of of(EventType.CivilWar)) if (ev[i].year >= r.acceded && ev[i].year <= span && ev[i].other === cap) rising.push(i)
    for (const i of of(276)) if (ev[i].year >= r.acceded && ev[i].year <= span && ev[i].value === r.polity) rising.push(i)
    if (rising.length === 0) continue
    rising.sort((x, y) => x - y)
    const events = [a, ...rising.slice(0, 4)], phase = [0, ...rising.slice(0, 4).map(() => 1)]
    let complete = false, endY = -1
    if (end >= 0 && (r.end === ReignEnd.Overthrown || r.end === ReignEnd.Deposed || r.end === ReignEnd.Battle)) {
      const e = endedEv.get(r.id)
      if (e !== undefined) { events.push(e); phase.push(2) }
      const next = R.find((x) => x.predecessor === r.id)
      const pred = r.predecessor >= 0 ? R[r.predecessor] : null
      if (next && pred && next.dynasty === pred.dynasty && next.dynasty !== r.dynasty) { const ai = acceded.get(next.id); if (ai !== undefined) { events.push(ai); phase.push(PAYOFF); complete = true; endY = next.acceded } }
      if (!complete) for (const i of of(EventType.DynastyEnded)) if (ev[i].value === r.dynasty && ev[i].year >= end && ev[i].year <= end + 1) { events.push(i); phase.push(PAYOFF); complete = true; endY = ev[i].year; break }
      if (!complete && e !== undefined) { phase[phase.length - 1] = PAYOFF; complete = true; endY = end } // (the fall itself closes the spiral)
    }
    out.push({ kind: ArcKind.Usurper, polity: r.polity, events, phase, start: r.acceded, end: endY, complete })
  }

  // T3 the princes' war: a contested succession won by a kinsman of the dead ruler's house, and a civil war within 3 years;
  // payoff: the civil war's end
  for (const i of of(EventType.SuccessionCrisis)) {
    const p = ev[i].value, y = ev[i].year
    const winner = R.find((x) => x.polity === p && x.acceded === y && x.how === AccessionHow.Usurped)
    const pred = winner && winner.predecessor >= 0 ? R[winner.predecessor] : null
    if (!winner || !pred || winner.dynasty !== pred.dynasty) continue
    const cap = capAt(p, y)
    const cw = of(EventType.CivilWar).find((j) => ev[j].year >= y && ev[j].year <= y + 3 && ev[j].other === cap)
    if (cw === undefined) continue
    const events = [i, acceded.get(winner.id) ?? i, cw], phase = [0, 1, 2]
    const w = ev[cw].value
    const peace = peaceOf.get(w)
    let complete = false, endY = -1
    if (peace !== undefined && ev[peace].year <= until) { events.push(peace); phase.push(PAYOFF); complete = true; endY = ev[peace].year }
    out.push({ kind: ArcKind.Princes, polity: p, events: dedupe(events, phase).events, phase: dedupe(events, phase).phase, start: y, end: endY, complete })
  }

  // the revenge war: a war declared for a grievance (Wars.cause >= 0); opening the wrong's year (its war's declaration if it
  // came from one), payoff the war's end with the avenger's gains
  const G = h.grievances
  for (const i of of(EventType.WarDeclared)) {
    const w = ev[i].value
    if (w < 0 || w >= W.count || !W.cause || W.cause[w] < 0 || !G) continue
    const g = W.cause[w]
    const events: number[] = [], phase: number[] = []
    const gw = G.war?.[g] ?? -1
    if (gw >= 0) { const d = of(EventType.WarDeclared).find((j) => ev[j].value === gw); if (d !== undefined) { events.push(d); phase.push(0) } }
    events.push(i); phase.push(events.length === 0 ? 0 : 2)
    if (phase.length === 1) phase[0] = 0
    let complete = false, endY = -1
    const peace = peaceOf.get(w)
    if (W.endYear[w] >= 0 && W.endYear[w] <= until && peace !== undefined) {
      const o = W.outcome[w]
      if (o === WarOutcome.AttackerGains || o === WarOutcome.Conquest || o === WarOutcome.Tribute || o === WarOutcome.Vassalage || o === WarOutcome.DefenderGains || o === WarOutcome.WhitePeace) { events.push(peace); phase.push(PAYOFF); complete = true; endY = W.endYear[w] }
    }
    out.push({ kind: ArcKind.Revenge, polity: W.attacker[w], events, phase, start: G.year[g], end: endY, complete })
  }

  // the bankruptcy war: a war that broke a treasury (WarBankrupt): opening the declaration, turn the bankruptcy, payoff the
  // peace or a crown default within 10 years
  for (const i of of(EventType.WarBankrupt)) {
    const w = ev[i].value
    if (w < 0 || w >= W.count) continue
    const d = of(EventType.WarDeclared).find((j) => ev[j].value === w) ?? of(EventType.CivilWar).find((j) => ev[j].value === w)
    const events = d !== undefined ? [d, i] : [i], phase = d !== undefined ? [0, 2] : [0]
    const broke = ev[i].settlement
    let complete = false, endY = -1
    const def = of(EventType.CrownDefault).find((j) => ev[j].settlement === broke && ev[j].year >= ev[i].year && ev[j].year <= ev[i].year + 10)
    const peace = peaceOf.get(w)
    const pay = def ?? peace
    if (pay !== undefined && ev[pay].year <= until) { events.push(pay); phase.push(PAYOFF); complete = true; endY = ev[pay].year }
    const p = W.attacker[w] >= 0 && capAt(W.attacker[w], ev[i].year) === broke ? W.attacker[w] : W.defender[w]
    out.push({ kind: ArcKind.Bankruptcy, polity: p, events, phase, start: d !== undefined ? ev[d].year : ev[i].year, end: endY, complete })
  }
  return out.sort((a, b) => a.start - b.start || a.kind - b.kind)
}

function dedupe(events: number[], phase: number[]): { events: number[]; phase: number[] } {
  const e: number[] = [], p: number[] = []
  for (let k = 0; k < events.length; k++) if (e.indexOf(events[k]) < 0) { e.push(events[k]); p.push(phase[k]) }
  return { events: e, phase: p }
}

/** Per notable entry (by its representative event, StaticDrama.rep): the arc it belongs to (-1) and its phase. */
export function arcEntries(arcs: readonly Arc[], rep: ArrayLike<number>): { arcOf: Int32Array; phase: Uint8Array; payoffOf: Int32Array } {
  const E = rep.length
  const byEvent = new Map<number, number>()
  for (let n = 0; n < E; n++) if (rep[n] >= 0 && !byEvent.has(rep[n])) byEvent.set(rep[n], n)
  const arcOf = new Int32Array(E).fill(-1), phase = new Uint8Array(E)
  const payoffOf = new Int32Array(arcs.length).fill(-1)
  arcs.forEach((a, k) => {
    for (let j = 0; j < a.events.length; j++) {
      const n = byEvent.get(a.events[j])
      if (n === undefined || arcOf[n] >= 0) continue
      arcOf[n] = k
      phase[n] = a.phase[j]
      if (a.phase[j] === PAYOFF) payoffOf[k] = n
    }
  })
  return { arcOf, phase, payoffOf }
}
