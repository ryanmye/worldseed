// Text for the political events (EventType 20-34) and walls, for the chronicle and the
// inspector; all optional at runtime (null for other events, or for a history without
// polity data, so the caller falls back to its own wording). Claims: BorderDispute (130),
// two states' claims meeting over unsettled land.

import { spokenName } from './languageData.ts' // language: names as said in the year
import { BondKind, EventType, GOOD_COUNT, PolityEnd, RevoltCause, StructureType, WarKind, WarMotive, WarOutcome, type History, type HistoryEvent } from '../contract.ts'
import { CITY_POPULATION } from '../contract.ts'
import { namesYear, renamedName } from './renamingData.ts'
import { isOathEvent, OathEvent } from './grudgesData.ts' // oaths, balance, arms:
import { capitalAt, isPolityEventType, polityAt, polityAtYear, polityTitle, politiesOf, PolityEvent, snapAfter, snapBefore, TRIBUTE_BASE, wallSlighted, type PolitiesData } from './politiesData.ts'

/** Good names (lower case) for the smuggling lines, indexed by Good (as format.ts GOOD_NAMES). */
const SMUGGLED_GOODS: readonly string[] = ['grain', 'fish', 'livestock', 'timber', 'ore', 'salt', 'cloth', 'luxuries', 'stimulants']

/** Polity of settlement `id` at `year` (polityAtYear), else the one just before (-1 none). */
function polOf(pd: PolitiesData, id: number, year: number): number {
  if (id < 0 || id >= pd.settlementCount) return -1
  const p = polityAtYear(pd, id, year)
  return p >= 0 ? p : polityAt(pd, id, snapBefore(pd, year))
}

/** "A", "A and B", "A, B and C", "A, B, C and 2 more". */
function listWords(names: string[], max = 3): string {
  const n = names.length
  if (n === 0) return ''
  if (n === 1) return names[0]
  if (n <= max) return `${names.slice(0, -1).join(', ')} and ${names[n - 1]}`
  return `${names.slice(0, max).join(', ')} and ${n - max} more`
}

/** "the Fluthufi–Hulmu lane" for trade route r, or null. */
function laneWords(h: History, r: number): string | null {
  const T = (h as Partial<History>).trade
  if (!T || !(r >= 0 && r < T.count)) return null
  return `the ${settlementName(h, T.a[r])}–${settlementName(h, T.b[r])} lane`
}

// (renaming: the name borne at the year shown, or at the event's year inside withEventNames: renamingData.ts)
const settlementName = (h: History, id: number) => (id >= 0 && id < h.settlements.length ? spokenName(h, id, namesYear()) ?? renamedName(h, id) ?? (h.settlements[id].name || `Settlement #${id}`) : 'a settlement')

/** Short name of polity p ("North Vashtar"), or a fallback. */
export function polityName(pd: PolitiesData, p: number, fallback = 'its neighbours'): string {
  return p >= 0 && p < pd.count ? pd.names[p] : fallback
}

/** Whether `e` is a Built / StructureLost event of walls. */
export function isWallEvent(h: History, e: HistoryEvent): boolean {
  return (e.type === 4 || e.type === 7) && (h.structures?.[e.other]?.type === StructureType.Walls || (h.structures?.[e.other] === undefined && e.value === StructureType.Walls))
}

/** "northern", "eastern" ... of settlement `id` relative to `from` (by their cells), or '' when too close or unknown. */
function quarterOf(h: History, id: number, from: number, world: { grid: { positions: Float32Array } } | null): string {
  if (!world || id < 0 || from < 0 || id >= h.settlements.length || from >= h.settlements.length) return ''
  const P = world.grid.positions
  const a = h.settlements[id].cell, b = h.settlements[from].cell
  const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2]
  const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2]
  const lat = (y: number) => Math.asin(Math.max(-1, Math.min(1, y)))
  const dLat = lat(ay) - lat(by)
  let dLon = Math.atan2(ax, az) - Math.atan2(bx, bz)
  if (dLon > Math.PI) dLon -= 2 * Math.PI
  if (dLon < -Math.PI) dLon += 2 * Math.PI
  const dx = dLon * Math.cos((lat(ay) + lat(by)) / 2)
  if (Math.hypot(dx, dLat) < 0.02) return ''
  if (Math.abs(dLat) >= Math.abs(dx)) return dLat > 0 ? 'northern' : 'southern'
  return dx > 0 ? 'eastern' : 'western'
}

let worldRef: { grid: { positions: Float32Array } } | null = null
/** The world of the history shown (for compass words); set by the history view. */
export function setPolityFormatWorld(w: { grid: { positions: Float32Array } } | null): void {
  worldRef = w
}

const OUTCOME_WORDS: Record<number, string> = {
  [WarOutcome.WhitePeace]: 'nothing changes hands',
  [WarOutcome.AttackerGains]: '{a} gains ground',
  [WarOutcome.DefenderGains]: '{d} gains ground',
  [WarOutcome.Conquest]: '{d} is conquered',
  [WarOutcome.Tribute]: '{d} pays tribute',
  [WarOutcome.Vassalage]: '{d} becomes a vassal of {a}',
  [WarOutcome.Reunified]: 'the realm is reunited',
}

/** Words for how war w ended ("Inachal pays tribute"), or ''. */
export function warOutcomeWords(pd: PolitiesData, w: number): string {
  const W = pd.wars
  if (!W || w < 0 || w >= W.count) return ''
  const t = OUTCOME_WORDS[W.outcome[w]]
  // vassalage and tribute: which side bowed is in History.bonds (the bond the war's end made between the two)
  const B = pd.bonds
  const o = W.outcome[w]
  if (B && (o === WarOutcome.Vassalage || o === WarOutcome.Tribute) && W.endYear[w] >= 0) {
    const a = W.attacker[w], d = W.defender[w]
    for (let k = 0; k < B.count; k++) {
      if (Math.abs(B.startYear[k] - W.endYear[w]) > 1 || B.kind[k] !== (o === WarOutcome.Vassalage ? BondKind.Vassal : BondKind.Tribute)) continue
      if (!((B.a[k] === a && B.b[k] === d) || (B.a[k] === d && B.b[k] === a))) continue
      const vn = polityName(pd, B.a[k]), on = polityName(pd, B.b[k])
      return o === WarOutcome.Vassalage ? `${vn} becomes a vassal of ${on}` : `${vn} pays tribute to ${on}`
    }
  }
  return t ? t.replace('{a}', polityName(pd, W.attacker[w])).replace('{d}', polityName(pd, W.defender[w])) : ''
}

/** "The Kingdom of Vashtar", title at the snapshot after the event. */
const The = (pd: PolitiesData, p: number, s: number) => `The ${polityTitle(pd, p, s)}`

/** Words for political events of a history whose polity data is missing (types 20-34). */
const FALLBACK = ['a state is founded', 'a state ends', 'the court moves here', 'joins a state', 'war is declared', 'peace is made', 'taken in war', 'sacked', 'a siege is lifted', 'raided', 'a revolt breaks out', 'a revolt is crushed', 'breaks away', 'changes sides', 'a disputed succession',
  'civil war breaks out', 'the realm is divided', 'the realm is one again', 'bows to an overlord', 'an alliance is made', 'smugglers gather', 'pirates rise', 'the pirates are put down', 'a blockade']

/** The smuggled good of a SmugglingRing event ("timber"). */
const goodWord = (g: number) => (g >= 0 && g < GOOD_COUNT ? SMUGGLED_GOODS[g] : 'goods')

/** Chronicle line for the second version's events (35-43), or null. */
function describeV2(h: History, pd: PolitiesData, e: HistoryEvent): string | null {
  const t = e.type as number
  const name = settlementName(h, e.settlement)
  const W = pd.wars
  const b = snapBefore(pd, e.year)
  switch (t) {
    case PolityEvent.CivilWar: {
      const realm = e.other >= 0 ? polityAt(pd, e.other, b) : W && e.value >= 0 && e.value < W.count ? W.defender[e.value] : -1
      const pretender = W && e.value >= 0 && e.value < W.count ? W.attacker[e.value] : polOf(pd, e.settlement, e.year)
      return `Civil war in ${polityName(pd, realm, 'the realm')}: ${polityName(pd, pretender, name)} proclaims its own king`
    }
    case PolityEvent.Partitioned:
      return `${polityName(pd, e.value, 'The realm')} is divided among the heirs`
    case PolityEvent.Reunified: {
      const win = polOf(pd, e.settlement, e.year)
      const lost = e.value
      const wn = polityName(pd, win, name), ln = polityName(pd, lost, 'the rival realm')
      const wx = pd.list[win], lx = pd.list[lost]
      if (lx && lx.parent === win) return `${wn} is one realm again` + (wn !== ln ? ` (${ln} is brought back)` : '')
      if (wx && wx.parent === lost) return `${wn} wins the throne of ${ln}: one realm again`
      return `${wn} brings ${ln} back into one realm`
    }
    case PolityEvent.BecameVassal: {
      const v = polOf(pd, e.settlement, e.year)
      const o = e.value % TRIBUTE_BASE
      const vn = polityName(pd, v, name), on = polityName(pd, o, 'an overlord')
      if (e.extra === 1) return `${vn} throws off the yoke of ${on}`
      return e.value >= TRIBUTE_BASE ? `${vn} pays tribute to ${on}` : `${vn} bows to ${on}`
    }
    case PolityEvent.Alliance: {
      const a = polOf(pd, e.settlement, e.year)
      return `${polityName(pd, a, name)} and ${polityName(pd, e.value, 'a neighbour')} ally against ${polityName(pd, e.extra ?? -1, 'a common rival')}`
    }
    case PolityEvent.SmugglingRing: {
      const q = e.other >= 0 ? polOf(pd, e.other, e.year) : -1
      const g = goodWord(e.value)
      return q >= 0 || e.other >= 0 ? `Smugglers at ${name} run ${g} past the customs of ${q >= 0 ? polityName(pd, q) : settlementName(h, e.other)}` : `${name} becomes a smugglers' den for ${g}`
    }
    case PolityEvent.PiratesRise: {
      const lane = laneWords(h, e.value)
      return `Pirates from ${name} prey on ${lane ?? 'the sea lanes nearby'}`
    }
    case PolityEvent.PiratesSuppressed: {
      const q = e.other >= 0 ? polOf(pd, e.other, e.year) : -1
      return `The fleets of ${q >= 0 ? polityName(pd, q) : e.other >= 0 ? settlementName(h, e.other) : 'a neighbour'} burn the pirate nests of ${name}`
    }
    case PolityEvent.Blockade: {
      const q = e.other >= 0 ? polOf(pd, e.other, e.year) : -1
      return `The fleets of ${q >= 0 ? polityName(pd, q) : e.other >= 0 ? settlementName(h, e.other) : 'the enemy'} blockade ${name}`
    }
  }
  return null
}

/** Inspector line for the second version's events (35-43) from the point of view of settlement `id`, or null. */
function describeV2For(h: History, pd: PolitiesData, e: HistoryEvent, id: number): string | null {
  const t = e.type as number
  const self = e.settlement === id
  const otherName = settlementName(h, self ? e.other : e.settlement)
  const W = pd.wars
  switch (t) {
    case PolityEvent.CivilWar: {
      const pretender = W && e.value >= 0 && e.value < W.count ? W.attacker[e.value] : polOf(pd, e.settlement, e.year)
      return self ? `Rose against ${otherName} in civil war, as the seat of ${polityName(pd, pretender, 'a pretender')}` : `${otherName} rose against it in civil war (${polityName(pd, pretender, 'a pretender')})`
    }
    case PolityEvent.Partitioned:
      return 'Its realm was divided among the heirs'
    case PolityEvent.Reunified:
      return self ? `Took back ${polityName(pd, e.value, 'a kindred realm')}: one realm again` : `Brought back into one realm with ${otherName}`
    case PolityEvent.BecameVassal: {
      const o = e.value % TRIBUTE_BASE
      const v = polOf(pd, e.settlement, e.year)
      if (self) return e.extra === 1 ? `Threw off the yoke of ${polityName(pd, o, otherName)}` : e.value >= TRIBUTE_BASE ? `Began to pay tribute to ${polityName(pd, o, otherName)}` : `Bowed to ${polityName(pd, o, otherName)} as its vassal`
      return e.extra === 1 ? `${polityName(pd, v, otherName)} threw off its yoke` : e.value >= TRIBUTE_BASE ? `${polityName(pd, v, otherName)} began to pay it tribute` : `${polityName(pd, v, otherName)} bowed to it`
    }
    case PolityEvent.Alliance: {
      const rival = polityName(pd, e.extra ?? -1, 'a common rival')
      const partner = self ? polityName(pd, e.value, otherName) : polityName(pd, polOf(pd, e.settlement, e.year), otherName)
      return `Allied with ${partner} against ${rival}`
    }
    case PolityEvent.SmugglingRing: {
      if (!self) return `Smugglers at ${otherName} evade its customs`
      const q = e.other >= 0 ? polOf(pd, e.other, e.year) : -1
      return `Became a smugglers' town: ${goodWord(e.value)}` + (q >= 0 ? ` past the customs of ${polityName(pd, q)}` : '')
    }
    case PolityEvent.PiratesRise: {
      const lane = laneWords(h, e.value)
      return `Pirates based here began to prey on ${lane ?? 'the sea lanes nearby'}`
    }
    case PolityEvent.PiratesSuppressed: {
      const q = e.other >= 0 ? polOf(pd, e.other, e.year) : -1
      return self ? `Its pirates were put down by the fleets of ${polityName(pd, q, otherName)}` : `Its fleets burned the pirate nests of ${otherName}`
    }
    case PolityEvent.Blockade: {
      const q = e.other >= 0 ? polOf(pd, e.other, e.year) : -1
      return self ? `Blockaded by the fleets of ${polityName(pd, q, otherName)}` : `Its fleets blockaded ${otherName}`
    }
  }
  return null
}

// ---- oaths, balance, arms (190-194; grudges-and-oaths §3.9): the chronicle register states the record, no motives ----

/** " after N years of arming" for a war that an arms race between its sides preceded (Wars.race), else ''. */
function armingWords(h: History, w: number): string {
  const R = h.armsRaces, W = h.wars
  const r = W.race ? W.race[w] : -1
  if (!R || r === undefined || r < 0 || r >= R.count) return ''
  const n = W.startYear[w] - R.start[r]
  return n >= 10 ? ` after ${n} years of arming` : ''
}

/** The end year of the latest war between polities p and q that ended at or before `year` (-1 none). */
function lastPeace(pd: PolitiesData, p: number, q: number, year: number, before: number): number {
  const W = pd.wars
  if (!W) return -1
  let y = -1
  for (let v = 0; v < before && v < W.count; v++) if (((W.attacker[v] === p && W.defender[v] === q) || (W.attacker[v] === q && W.defender[v] === p)) && W.endYear[v] >= 0 && W.endYear[v] <= year && W.endYear[v] > y) y = W.endYear[v]
  return y
}

/** Chronicle line for an oath event (190-194), or null. */
function describeOath(h: History, pd: PolitiesData, e: HistoryEvent): string | null {
  const t = e.type as number
  const x = polOf(pd, e.settlement, e.year), q = e.other >= 0 ? polOf(pd, e.other, e.year) : -1
  const xn = polityName(pd, x, settlementName(h, e.settlement)), qn = polityName(pd, q, e.other >= 0 ? settlementName(h, e.other) : 'a rival')
  const W = pd.wars
  switch (t) {
    case OathEvent.Betrayal: {
      const enemy = W && e.value >= 0 && e.value < W.count ? polityName(pd, W.defender[e.value], 'the enemy') : 'the enemy'
      if (e.extra === 1) return `${xn} abandons ${qn} and turns on it`
      let ceded = 0
      for (const f of h.events) if (f.year === e.year && (f.type as number) === PolityEvent.Joined && f.value === x && W && e.value >= 0 && polOf(pd, f.settlement, e.year - 1) === W.defender[e.value]) ceded++
      return `${xn} breaks faith with ${qn} and makes a separate peace with ${enemy}` + (ceded > 0 ? ` (${ceded === 1 ? 'a town' : `${ceded} towns`} ceded)` : '')
    }
    case OathEvent.OathBroken: {
      if (e.extra === 1) return `${xn} makes war on its own ally ${qn}`
      const y0 = lastPeace(pd, x, q, e.year, e.value)
      return y0 >= 0 ? `${xn} breaks the truce of ${y0} and makes war on ${qn}` : `${xn} breaks its truce and makes war on ${qn}`
    }
    case OathEvent.Avenged:
      return `${xn} repays an old wrong of ${qn}`
    case OathEvent.Bandwagon:
      return e.extra === 1 ? `${xn} offers tribute to ${polityName(pd, e.value, qn)} unasked` : `${xn} sides with the mighty ${polityName(pd, e.value, qn)}`
    case OathEvent.ArmsRace:
      if (e.extra === 0) return `${xn} and ${qn} arm against each other`
      if (e.extra === 2) return `The arming of ${xn} and ${qn} slackens`
      return null
  }
  return null
}

/** Inspector line for an oath event from the point of view of settlement `id`, or null. */
function describeOathFor(h: History, pd: PolitiesData, e: HistoryEvent, id: number): string | null {
  const t = e.type as number
  const self = e.settlement === id
  const other = self ? (e.other >= 0 ? polOf(pd, e.other, e.year) : -1) : polOf(pd, e.settlement, e.year)
  const on = polityName(pd, other, settlementName(h, self ? e.other : e.settlement))
  const W = pd.wars
  switch (t) {
    case OathEvent.Betrayal: {
      const enemy = W && e.value >= 0 && e.value < W.count ? polityName(pd, W.defender[e.value], 'the enemy') : 'the enemy'
      return self ? `Broke faith with its ally ${on} (a separate peace with ${enemy})` + oathClause(h, pd, e) : `Betrayed by its ally ${on}`
    }
    case OathEvent.OathBroken:
      if (e.extra === 1) return self ? `Made war on its own ally ${on}` + oathClause(h, pd, e) : `Attacked by its own ally ${on}`
      return self ? `Broke the truce with ${on}` + oathClause(h, pd, e) : `${on} broke the truce with it`
    case OathEvent.Avenged:
      return self ? `Repaid an old wrong of ${on}` : `${on} repaid an old wrong`
    case OathEvent.Bandwagon:
      return self ? (e.extra === 1 ? `Offered tribute to ${on} unasked` : `Sided with the mighty ${on}`) : (e.extra === 1 ? `${on} offered it tribute unasked` : `${on} sided with it`)
    case OathEvent.ArmsRace:
      if (e.extra === 0) return `Armed against ${on} (and ${on} in turn)`
      if (e.extra === 2) return `The arming against ${on} slackened`
      return null
  }
  return null
}

/** ", its ruler old and without an heir" / ", during a disputed succession" from the record at the year (hedged), or ''. */
function oathClause(h: History, pd: PolitiesData, e: HistoryEvent): string {
  const p = polOf(pd, e.settlement, e.year)
  const R = h.rulers
  if (!R || p < 0) return ''
  for (let r = 0; r < R.length; r++) {
    const x = R[r]
    if (x.polity !== p || x.acceded > e.year || (x.ended >= 0 && x.ended < e.year)) continue
    if (e.year - x.born >= 60) return ', its ruler old'
  }
  for (const f of h.events) if ((f.type as number) === PolityEvent.SuccessionCrisis && f.value === p && f.year <= e.year && f.year >= e.year - 10) return ', during a disputed succession'
  return ''
}

// ---- finance (210-217; state-finances §4.3): crowns borrowing, defaulting and going bankrupt ----

/** Whether events of type t are finance events. */
export const isMoneyEvent = (t: number) => t >= 210 && t <= 219

const pct = (x: number) => `${Math.round(x * 100)}%`

/** Chronicle line for a finance event, or null. */
function describeMoney(h: History, pd: PolitiesData, e: HistoryEvent): string | null {
  const p = polOf(pd, e.settlement, e.year)
  const pn = polityName(pd, p, settlementName(h, e.settlement))
  const W = pd.wars
  switch (e.type as number) {
    case EventType.LoanTaken: return `The crown of ${pn} borrows from the merchant houses of ${settlementName(h, e.other)} at ${pct(e.extra ?? 0)}`
    case EventType.CrownDefault: return `The crown of ${pn} stops its payments: ${pct(e.extra ?? 0)} of its debts are written off` + (e.other >= 0 ? ` (the houses of ${settlementName(h, e.other)} lose most)` : '')
    case EventType.Repudiation: return `A new ruler of ${pn} refuses the crown's debts`
    case EventType.ArmyUnpaid: return `The soldiers of ${pn} go unpaid`
    case EventType.WarBankrupt: {
      const o = W && e.value >= 0 && e.value < W.count ? (W.attacker[e.value] === p ? W.defender[e.value] : W.attacker[e.value]) : -1
      return `${pn}, its treasury empty, can no longer pay for its war with ${polityName(pd, o, 'its enemy')}`
    }
    case EventType.HousesRuined: return `The merchant houses of ${settlementName(h, e.settlement)} are ruined by the debts of ${polityName(pd, polOf(pd, e.other, e.year), 'a crown')}`
  }
  return null
}

/** Inspector line for a finance event from the point of view of settlement `id`, or null. */
function describeMoneyFor(h: History, pd: PolitiesData, e: HistoryEvent, id: number): string | null {
  const self = e.settlement === id
  const other = settlementName(h, self ? e.other : e.settlement)
  switch (e.type as number) {
    case EventType.LoanTaken: return self ? `The crown borrowed from the houses of ${other} at ${pct(e.extra ?? 0)}` : `Its merchant houses lent to the crown of ${polityName(pd, polOf(pd, e.settlement, e.year), other)}`
    case EventType.CrownDefault: return self ? `The crown stopped its payments (${pct(e.extra ?? 0)} of its debts written off)` : `Its merchant houses lost by the default of ${polityName(pd, polOf(pd, e.settlement, e.year), other)}`
    case EventType.Repudiation: return self ? 'A new ruler refused the crown\'s debts' : `Its merchant houses lost by the repudiation of ${polityName(pd, polOf(pd, e.settlement, e.year), other)}`
    case EventType.ArmyUnpaid: return self ? 'Its soldiers went unpaid' : `The soldiers of ${polityName(pd, polOf(pd, e.settlement, e.year), other)} went unpaid`
    case EventType.WarBankrupt: return self ? 'Its treasury empty, it could no longer pay for its war' : `${polityName(pd, polOf(pd, e.settlement, e.year), other)} could no longer pay for its war`
    case EventType.HousesRuined: return self ? `Its merchant houses were ruined by a crown's debts (${pct(e.extra ?? 0)} of their capital)` : `Its debts ruined the merchant houses of ${other}`
  }
  return null
}

// ---- beliefs (230-238; beliefs-and-deception §5.4): what states believed of each other. The register is hedged: beliefs are
// inferences about minds ("seems to have thought", "it later appeared").

/** Whether events of type t are belief events (intrigue). */
export const isBeliefEvent = (t: number) => t >= 230 && t <= 239

/** Chronicle line for a belief event, or null. */
function describeBelief(h: History, pd: PolitiesData, e: HistoryEvent): string | null {
  const sn = settlementName(h, e.settlement)
  const p = polOf(pd, e.settlement, e.year)
  const pn = polityName(pd, p, sn)
  const q = e.other >= 0 ? polOf(pd, e.other, e.year) : -1
  const qn = polityName(pd, q, e.other >= 0 ? settlementName(h, e.other) : 'a neighbour')
  const n = e.extra ?? 0
  switch (e.type as number) {
    case EventType.Coerced: {
      const cn = polityName(pd, e.value, pn)
      return n > 0 ? `${qn} yields ${n === 1 ? 'a town' : `${n} towns`} to ${cn} without a fight` : `${qn} agrees to pay tribute to ${cn} rather than fight`
    }
    case EventType.Deterred: return `${pn} presses ${qn}, then draws back` + (n === 1 ? ` (${qn}'s strength, it later appeared, was largely show)` : '')
    case EventType.BluffBegun: return `${pn} makes a great show of its strength`
    case EventType.BluffExposed: return `${polityName(pd, e.value, qn)} sees through ${pn}'s show of strength`
    case EventType.SecretAlliance: return `${pn} and ${polityName(pd, e.value, qn)} ally in secret against ${polityName(pd, e.extra ?? -1, 'a common rival')}`
    case EventType.AllianceRevealed: return e.value >= 0 ? `${pn}'s secret alliance with ${qn} comes to light as it joins the war` : `The secret alliance of ${pn} and ${qn} is found out` + (n > 0 ? ` (kept ${n} years)` : '')
    case EventType.SpyCaught: return `${pn} catches the spies of ${qn}`
    case EventType.ClaimForged: return `${pn} lays a claim to ${e.other >= 0 ? settlementName(h, e.other) : 'a town'}`
    case EventType.ClaimExposed: return `${pn}'s claim to ${e.other >= 0 ? settlementName(h, e.other) : 'a town'} is shown to be forged`
  }
  return null
}

/** Inspector line for a belief event from the point of view of settlement `id`, or null. */
function describeBeliefFor(h: History, pd: PolitiesData, e: HistoryEvent, id: number): string | null {
  const self = e.settlement === id
  const other = polityName(pd, polOf(pd, self ? e.other : e.settlement, e.year), settlementName(h, self ? e.other : e.settlement))
  const n = e.extra ?? 0
  switch (e.type as number) {
    case EventType.Coerced: return self ? (n > 0 ? `Pressed ${other} into yielding ${n === 1 ? 'a town' : `${n} towns`} without war` : `Pressed ${other} into paying tribute`) : (n > 0 ? `Yielded ${n === 1 ? 'a town' : `${n} towns`} to ${other} without a fight` : `Agreed to pay tribute to ${other} rather than fight`)
    case EventType.Deterred: return self ? `Pressed ${other}, then drew back` : `${other} pressed it, then drew back`
    case EventType.BluffBegun: return 'Made a great show of its strength'
    case EventType.BluffExposed: return self ? `${other} saw through its show of strength` : `Saw through the show of strength of ${other}`
    case EventType.SecretAlliance: return `Allied in secret with ${other}`
    case EventType.AllianceRevealed: return `Its secret alliance with ${other} came to light`
    case EventType.SpyCaught: return self ? `Caught the spies of ${other}` : `Its spies were caught by ${other}`
    case EventType.ClaimForged: return self ? 'Put forward a claim that may have been forged' : `Claimed by ${other}`
    case EventType.ClaimExposed: return self ? 'Its claim was shown to be forged' : `The claim of ${other} to it was shown to be forged`
  }
  return null
}

/** beliefs: a WarDeclared line for a bargained war whose start was misjudged or special, or null (Wars.believed / motive). */
function beliefWarLine(pd: PolitiesData, w: number): string | null {
  const W = pd.wars
  if (!W || !W.believed || W.believed.length !== W.count || !(W.believed[w] >= 0)) return null
  const at = polityName(pd, W.attacker[w]), df = polityName(pd, W.defender[w])
  const m = W.motive[w]
  if (m === WarMotive.Preventive) return `${at} makes war on the rising ${df}: it seems to strike before ${df} grew stronger`
  if (m === WarMotive.Indivisible) return `${at} makes war on ${df} over a holy city`
  if (W.believed[w] >= 1.5 * W.actual[w]) return `${at}, which seems to have thought ${df} weaker than it was, makes war on it`
  return null
}

/** beliefs: " (it had misjudged X's strength)" for a war lost by its initiator that it began believing itself 1.5 times stronger than it was. */
function misjudgedWords(pd: PolitiesData, w: number): string {
  const W = pd.wars
  if (!W || !W.believed || W.believed.length !== W.count || !(W.believed[w] >= 0) || W.outcome[w] !== WarOutcome.DefenderGains || !(W.believed[w] >= 1.5 * W.actual[w])) return ''
  return ` (${polityName(pd, W.attacker[w])} had misjudged ${polityName(pd, W.defender[w])}'s strength)`
}

// ---- claims: border disputes (EventType.BorderDispute) ----

/** Whether events of type t are border disputes (claims). */
export const isDisputeEvent = (t: number) => t === EventType.BorderDispute

/** Years from a pair's first border dispute over which the chronicle gathers the next ones (they lapse and flare again). */
const DISPUTE_BUCKET_YEARS = 50
/** A dispute followed by a war between the two within this many years is a headline. */
const DISPUTE_WAR_YEARS = 20

/** The two polities of a BorderDispute: that ruled from `settlement`, and `value` (the other's; -1 unknown). */
function disputePair(pd: PolitiesData, e: HistoryEvent): [number, number] {
  return [polOf(pd, e.settlement, e.year), e.value >= 0 && e.value < pd.count ? e.value : polOf(pd, e.other, e.year)]
}

/** The names of a dispute's two sides ("Rilkochal", "Lekowi"), their capitals' names without polity data. */
function disputeNames(h: History, e: HistoryEvent): [string, string] {
  const pd = politiesOf(h)
  if (!pd) return [settlementName(h, e.settlement), settlementName(h, e.other)]
  const [a, b] = disputePair(pd, e)
  return [polityName(pd, a, settlementName(h, e.settlement)), polityName(pd, b, settlementName(h, e.other))]
}

/** Chronicle line for a border dispute ("Rilkochal and Lekowi dispute the marches between them"). */
function describeDispute(h: History, e: HistoryEvent): string {
  const [a, b] = disputeNames(h, e)
  return `${a} and ${b} dispute the marches between them`
}

/** Inspector line for a border dispute from the point of view of `id` (either capital). */
function describeDisputeFor(h: History, e: HistoryEvent, id: number): string {
  const [a, b] = disputeNames(h, e)
  return `Disputed the marches with ${e.settlement === id ? b : a}`
}

/**
 * Chronicle group keys of the border disputes (event index to key): one pair's disputes (either order) from the first
 * of a run until DISPUTE_BUCKET_YEARS after it, so a quarrel that lapses and flares again is one line; empty without
 * polity data.
 */
export function disputeGroupKeys(h: History): Map<number, number> {
  const out = new Map<number, number>()
  const pd = politiesOf(h)
  if (!pd) return out
  const idx: number[] = []
  h.events.forEach((e, i) => {
    if (isDisputeEvent(e.type as number)) idx.push(i)
  })
  idx.sort((x, y) => h.events[x].year - h.events[y].year || x - y)
  const run = new Map<number, { start: number; key: number }>()
  let next = 0
  for (const i of idx) {
    const e = h.events[i]
    const [a, b] = disputePair(pd, e)
    if (a < 0 || b < 0) continue
    const pair = Math.min(a, b) * 32768 + Math.max(a, b)
    let r = run.get(pair)
    if (!r || e.year - r.start >= DISPUTE_BUCKET_YEARS) run.set(pair, (r = { start: e.year, key: next++ }))
    out.set(i, r.key)
  }
  return out
}

/** Chronicle line for one pair's disputes within half a century ("Rilkochal and Lekowi dispute the marches between them (again in 1380)"). */
export function describeDisputes(h: History, members: readonly HistoryEvent[]): string {
  if (members.length === 0) return ''
  const line = describeDispute(h, members[0])
  const again = members.slice(1).map((e) => e.year).filter((y, i, a) => a.indexOf(y) === i && y !== members[0].year)
  return again.length ? `${line} (again in ${listWords(again.map(String))})` : line
}

/** Whether a border dispute is followed by a war between the two within DISPUTE_WAR_YEARS (a headline: the quarrel that led to war). */
export function isDisputeHeadline(h: History, e: HistoryEvent): boolean {
  const pd = politiesOf(h)
  const W = pd?.wars
  if (!pd || !W) return false
  const [a, b] = disputePair(pd, e)
  if (a < 0 || b < 0 || a === b) return false
  for (const w of pd.warsOf[a]) {
    const s = W.startYear[w]
    if (s < e.year || s > e.year + DISPUTE_WAR_YEARS) continue
    if ((W.attacker[w] === a && W.defender[w] === b) || (W.attacker[w] === b && W.defender[w] === a)) return true
  }
  return false
}
// ---- cold wars (393-398; barriers-coldwar §3): the record, hedged ----

export const isColdWarEvent = (t: number) => t >= 393 && t <= 398

const CW_END_WORDS = ['the rivalry cooled', 'it turned to open war', 'one side fell into ruin', 'the balance between them was lost', 'one side was no more']

/** Chronicle line for a cold-war event, or null. */
function describeColdWar(h: History, pd: PolitiesData, e: HistoryEvent): string | null {
  const p = polOf(pd, e.settlement, e.year)
  const pn = polityName(pd, p, settlementName(h, e.settlement))
  const q = e.other >= 0 ? polOf(pd, e.other, e.year) : -1
  const qn = polityName(pd, q, e.other >= 0 ? settlementName(h, e.other) : 'a rival')
  const C = h.coldWars
  const since = C && e.value >= 0 && e.value < C.count ? C.start[e.value] : -1
  switch (e.type as number) {
    case EventType.ColdWarBegan: return `${pn} and ${qn} arm and watch each other but do not fight: a cold war, it seems`
    case EventType.ProxyWar: {
      const W = h.wars
      const enemy = W && e.value >= 0 && e.value < W.count ? polityName(pd, W.attacker[e.value] === q ? W.defender[e.value] : W.attacker[e.value], 'its enemy') : 'its enemy'
      return `${pn} sends money and advisers to ${qn} in its war with ${enemy}`
    }
    case EventType.ClientDefected: return `${pn} leaves ${polityName(pd, e.extra ?? -1, 'its patron')} for ${qn}`
    case EventType.Crisis: {
      const x = e.extra ?? 0
      if (x === 0) return `A crisis between ${pn} and ${qn}; ${pn} backs down`
      if (x === 1) return `A crisis between ${pn} and ${qn}; ${qn} backs down`
      if (x === 2) return `A crisis between ${pn} and ${qn} ends in a compromise`
      return `A crisis between ${pn} and ${qn} slips into war`
    }
    case EventType.Detente: return e.extra === 1 ? `The quarrel of ${pn} and ${qn} hardens again` : `${pn} and ${qn} ease their rivalry`
    case EventType.ColdWarEnded: {
      const n = since >= 0 ? e.year - since : 0
      return `The cold war of ${pn} and ${qn}${n >= 10 ? `, ${n} years long,` : ''} ends: ${CW_END_WORDS[e.extra ?? 0] ?? 'it passed'}`
    }
  }
  return null
}

/** Inspector line for a cold-war event from the point of view of settlement `id`, or null. */
function describeColdWarFor(h: History, pd: PolitiesData, e: HistoryEvent, id: number): string | null {
  const self = e.settlement === id
  const on = polityName(pd, polOf(pd, self ? e.other : e.settlement, e.year), settlementName(h, self ? e.other : e.settlement))
  switch (e.type as number) {
    case EventType.ColdWarBegan: return `Entered a cold war with ${on}`
    case EventType.ProxyWar: return self ? `Backed ${on} in a war it did not fight` : `Backed by ${on} in its war`
    case EventType.ClientDefected: return self ? `Left its patron for ${on}` : `${on} came over to it`
    case EventType.Crisis: return `A crisis with ${on}` + (['', '', ', settled by compromise', ', which led to war'][e.extra ?? 0] ?? '')
    case EventType.Detente: return e.extra === 1 ? `Its rivalry with ${on} hardened again` : `Eased its rivalry with ${on}`
    case EventType.ColdWarEnded: return `Its cold war with ${on} ended`
  }
  return null
}

// ---- society (240-246; society-secular-cycles §4.3): classes, bondage, the nobility and the secular cycle ----

/** Whether events of type t are society events. */
export const isSocietyEvent = (t: number) => t >= 240 && t <= 249

const share = (x: number) => (x >= 0.6 ? 'more than half' : x >= 0.45 ? 'nearly half' : x >= 0.3 ? 'a third' : x >= 0.2 ? 'a fifth' : 'a tenth')
const rise = (x: number) => (x >= 1.9 ? 'doubled' : x >= 1.45 ? 'up by half' : 'up by a third')

/** Chronicle line for a society event, or null. */
function describeSociety(h: History, pd: PolitiesData, e: HistoryEvent): string | null {
  const t = e.type as number
  const p = polOf(pd, t === EventType.Ennobled ? e.other : e.settlement, e.year)
  const pn = polityName(pd, p, settlementName(h, e.settlement))
  switch (t) {
    case EventType.SocialPhase: return (e.extra ?? 0) === 2 ? `The social order of ${pn} falls into crisis` : `${pn} enters a new age of growth`
    case EventType.LabourDear: return `${e.other >= 0 ? 'After the pestilence, l' : 'L'}abour grows dear in ${pn} (wages ${rise(e.extra ?? 1.3)})`
    case EventType.SerfdomImposed: return `The lords of ${pn} bind the peasants to the land`
    case EventType.SerfdomEnded: return `The peasants of ${pn} are free of their bondage`
    case EventType.EliteFactions: return `The great families of ${pn} divide into factions`
    case EventType.Ennobled: return `The merchants of ${settlementName(h, e.settlement)} buy their way into the nobility of ${pn}`
    case EventType.EliteThinned: return `${pn}'s nobility is thinned by its wars (${share(e.extra ?? 0.3)} of the great families gone)`
  }
  return null
}

/** Inspector line for a society event from the point of view of settlement `id`, or null. */
function describeSocietyFor(h: History, pd: PolitiesData, e: HistoryEvent, id: number): string | null {
  if ((e.type as number) === EventType.Ennobled && e.settlement === id) return `Its merchants bought their way into the nobility of ${polityName(pd, polOf(pd, e.other, e.year), settlementName(h, e.other))}`
  const line = describeSociety(h, pd, e)
  return line
}

/** Chronicle line for a political event (types 20-34) or walls, or null. */
export function describePolityEvent(h: History, e: HistoryEvent): string | null {
  const t = e.type as number
  if (isDisputeEvent(t)) return describeDispute(h, e)
  if (isOathEvent(t)) { const pd = politiesOf(h); return pd ? describeOath(h, pd, e) : null } // oaths, balance, arms
  if (isMoneyEvent(t)) { const pd = politiesOf(h); return pd ? describeMoney(h, pd, e) : null } // finance
  if (isSocietyEvent(t)) { const pd = politiesOf(h); return pd ? describeSociety(h, pd, e) : null } // society
  if (isBeliefEvent(t)) { const pd = politiesOf(h); return pd ? describeBelief(h, pd, e) : null } // beliefs
  if (isColdWarEvent(t)) { const pd = politiesOf(h); return pd ? describeColdWar(h, pd, e) : null } // cold wars
  if (!isPolityEventType(t) && !isWallEvent(h, e)) return null
  const pd = politiesOf(h)
  const name = settlementName(h, e.settlement)
  if (isWallEvent(h, e)) {
    if (e.type === 4) {
      const before = pd ? (pd.wallsOf.get(e.settlement) ?? []).filter((id) => { const st = h.structures[id]; return st.builtYear < e.year && (st.lostYear < 0 || st.lostYear > e.year) }).length : 0
      return before > 0 ? `${name} raises a new ring of walls` : `${name} raises walls`
    }
    return wallSlighted(pd, e.settlement, e.year) ? `The walls of ${name} are slighted` : `The walls of ${name} fall into ruin`
  }
  if (!pd) return `${name}: ${FALLBACK[t - 20] ?? 'a political event'}`
  if (t >= PolityEvent.CivilWar) return describeV2(h, pd, e)
  const b = snapBefore(pd, e.year), a = snapAfter(pd, e.year)
  const W = pd.wars
  switch (t) {
    case PolityEvent.Founded: {
      const x = pd.list[e.value]
      if (x && x.parent >= 0) return `${The(pd, e.value, a)} rises at ${name}, breaking from ${polityName(pd, x.parent)}`
      return `${The(pd, e.value, a)} is founded at ${name}`
    }
    case PolityEvent.Ended: {
      const x = pd.list[e.value]
      const by = e.other >= 0 ? polityAt(pd, e.other, b) : -1
      const title = The(pd, e.value, b)
      switch (x?.endCause) {
        case 1: return `${title} falls` + (by >= 0 ? ` (conquered by ${polityName(pd, by)})` : ' (conquered)')
        case 2: return `${title} breaks apart`
        case 3: return `${title} dwindles away`
        case 4: return `${title} is reunited` + (by >= 0 ? ` with ${polityName(pd, by)}` : '')
        case 5: return `${title} submits` + (by >= 0 ? ` to ${polityName(pd, by)}` : ' to a neighbour')
        default: return `${title} comes to an end`
      }
    }
    case PolityEvent.CapitalMoved:
      return `The court of ${polityName(pd, e.value)} moves to ${name}` + (e.other >= 0 ? ` from ${settlementName(h, e.other)}` : '')
    case PolityEvent.Joined:
      return `${name} joins ${polityName(pd, e.value)}`
    case PolityEvent.WarDeclared: {
      if (!W || e.value < 0 || e.value >= W.count) return `War between ${name} and ${settlementName(h, e.other)}`
      const at = polityName(pd, W.attacker[e.value]), df = polityName(pd, W.defender[e.value])
      if (W.kind[e.value] === WarKind.CivilWar) return `Civil war: ${at} rises against ${df}`
      if (W.kind[e.value] === WarKind.Blockade) return `${at} blockades ${df}`
      const bw = beliefWarLine(pd, e.value) // beliefs: a misjudged or preventive start
      if (bw) return bw + armingWords(h, e.value)
      return `${at} declares war on ${df}` + armingWords(h, e.value) // (arms: after the race between them)
    }
    case PolityEvent.PeaceMade: {
      if (!W || e.value < 0 || e.value >= W.count) return `Peace between ${name} and ${settlementName(h, e.other)}`
      const o = warOutcomeWords(pd, e.value)
      if (W.kind[e.value] === WarKind.CivilWar) return `The civil war in ${polityName(pd, W.defender[e.value])} ends` + (o ? ` (${o})` : '')
      return `Peace between ${polityName(pd, W.attacker[e.value])} and ${polityName(pd, W.defender[e.value])}` + (o ? ` (${o})` : '') + misjudgedWords(pd, e.value) // (beliefs)
    }
    case PolityEvent.Conquered: {
      const loser = polityAt(pd, e.settlement, b)
      let gainer = polityAt(pd, e.settlement, a)
      if (W && e.value >= 0 && e.value < W.count && (gainer < 0 || gainer === loser)) gainer = loser === W.attacker[e.value] ? W.defender[e.value] : W.attacker[e.value]
      const cap = loser >= 0 && capitalAt(pd, loser, e.year - 1) === e.settlement
      if (gainer >= 0) return `${polityName(pd, gainer)} takes ${cap ? 'the capital ' : ''}${name}` + (loser >= 0 && loser !== gainer ? ` from ${polityName(pd, loser)}` : '')
      return `${name} falls`
    }
    case PolityEvent.Sacked: {
      const by = sackerOf(pd, e)
      return `${name} is sacked` + (by >= 0 ? ` by ${polityName(pd, by)}` : '') + (e.value > 0.02 ? ` (${lossWords(e.value)})` : '')
    }
    case PolityEvent.SiegeLifted:
      return `The siege of ${name} is lifted`
    case PolityEvent.Raid: {
      const by = e.other >= 0 ? polityAt(pd, e.other, b) : -1
      return `Raiders ${by >= 0 ? `of ${polityName(pd, by)}` : e.other >= 0 ? `from ${settlementName(h, e.other)}` : ''} strike ${name}`.replace('  ', ' ')
    }
    case PolityEvent.Revolt: {
      const q = polityAt(pd, e.other, b)
      const against = q >= 0 ? polityName(pd, q) : settlementName(h, e.other)
      const quarter = quarterOf(h, e.settlement, e.other, worldRef)
      switch (e.value) {
        case RevoltCause.Peasant: return `Peasants rise at ${name} against ${against}`
        case RevoltCause.Taxes: return `Townsmen rise at ${name} against the tax-gatherers of ${against}` // (finance)
        case RevoltCause.Urban: return `The townsfolk of ${name} rise against ${against}` // (society: dear bread, low wages)
        case RevoltCause.Ethnic: {
          const pp = (h.settlements[e.settlement] as { people?: number }).people
          const pn = pp !== undefined ? h.peoples?.[pp]?.name : undefined
          return `${pn ? `The ${pn} of ${name}` : `The people of ${name}`} rise against ${against}`
        }
        case RevoltCause.Colonial: return `The colonies around ${name} rise against ${against}`
        default: return quarter ? `The ${quarter} provinces rise against ${against}` : `The provinces around ${name} rise against ${against}`
      }
    }
    case PolityEvent.RevoltCrushed: {
      const q = polityAt(pd, e.other, b)
      return `${q >= 0 ? polityName(pd, q) : 'The crown'} crushes the revolt at ${name}` + (e.value > 1 ? ` (${e.value} settlements had risen)` : '')
    }
    case PolityEvent.Seceded: {
      const q = polityAt(pd, e.other, b)
      return `${polityName(pd, e.value)} breaks away from ${q >= 0 ? polityName(pd, q) : settlementName(h, e.other)}`
    }
    case PolityEvent.Defected:
      return `${name} goes over to ${polityName(pd, e.value)}`
    case PolityEvent.SuccessionCrisis:
      return `Succession crisis in ${polityName(pd, e.value)}`
  }
  return null
}

/** The polity that sacked a town: its new owner after it fell, else that of the army's base afterwards (-1 unknown). */
export function sackerOf(pd: PolitiesData, e: HistoryEvent): number {
  const b = snapBefore(pd, e.year), a = snapAfter(pd, e.year)
  const loser = polityAt(pd, e.settlement, b)
  const owner = polityAt(pd, e.settlement, a)
  if (owner >= 0 && owner !== loser) return owner
  const base = e.other >= 0 ? polityAt(pd, e.other, a) : -1
  return base !== loser ? base : -1
}

/** "one in five die" for a sack's losses. */
function lossWords(f: number): string {
  if (f >= 0.62) return 'most of its people die'
  if (f >= 0.42) return 'half its people die'
  const n = Math.round(1 / Math.max(f, 1e-3))
  return n > 20 ? 'a few die' : `one in ${['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'][n]} die`
}

/** Inspector line for a political event or walls, from the point of view of settlement `id`, or null. */
export function describePolityEventFor(h: History, e: HistoryEvent, id: number): string | null {
  const t = e.type as number
  if (isDisputeEvent(t)) return describeDisputeFor(h, e, id)
  if (isOathEvent(t)) { const pd = politiesOf(h); return pd ? describeOathFor(h, pd, e, id) : null } // oaths, balance, arms
  if (isMoneyEvent(t)) { const pd = politiesOf(h); return pd ? describeMoneyFor(h, pd, e, id) : null } // finance
  if (isSocietyEvent(t)) { const pd = politiesOf(h); return pd ? describeSocietyFor(h, pd, e, id) : null } // society
  if (isBeliefEvent(t)) { const pd = politiesOf(h); return pd ? describeBeliefFor(h, pd, e, id) : null } // beliefs
  if (isColdWarEvent(t)) { const pd = politiesOf(h); return pd ? describeColdWarFor(h, pd, e, id) : null } // cold wars
  if (!isPolityEventType(t) && !isWallEvent(h, e)) return null
  const pd = politiesOf(h)
  if (isWallEvent(h, e)) {
    if (e.type === 4) return 'Raised walls'
    return wallSlighted(pd, e.settlement, e.year) ? 'Its walls were slighted' : 'Its walls fell into ruin'
  }
  if (!pd) return FALLBACK[t - 20] ? FALLBACK[t - 20].charAt(0).toUpperCase() + FALLBACK[t - 20].slice(1) : null
  if (t >= PolityEvent.CivilWar) return describeV2For(h, pd, e, id)
  const b = snapBefore(pd, e.year), a = snapAfter(pd, e.year)
  const W = pd.wars
  const self = e.settlement === id
  const otherName = settlementName(h, self ? e.other : e.settlement)
  switch (t) {
    case PolityEvent.Founded:
      return self ? `Became the capital of the new ${polityTitle(pd, e.value, a)}` : `${polityName(pd, e.value)} broke away, ruled from ${otherName}`
    case PolityEvent.Ended: {
      const by = e.other >= 0 ? polityAt(pd, e.other, b) : -1
      return self ? `The ${polityTitle(pd, e.value, b)} ended here` + (by >= 0 ? ` (conquered by ${polityName(pd, by)})` : '') : `Its realm conquered the ${polityTitle(pd, e.value, b)}`
    }
    case PolityEvent.CapitalMoved:
      return self ? `Became the capital of ${polityName(pd, e.value)}` + (e.other >= 0 ? ` (from ${otherName})` : '') : `The court of ${polityName(pd, e.value)} left for ${otherName}`
    case PolityEvent.Joined:
      return self ? `Joined ${polityName(pd, e.value)}` : `${otherName} submitted`
    case PolityEvent.WarDeclared:
      if (W && e.value >= 0 && e.value < W.count) return self ? `Declared war on ${polityName(pd, W.defender[e.value])}` : `${polityName(pd, W.attacker[e.value])} declared war on it`
      return 'War declared'
    case PolityEvent.PeaceMade: {
      const o = W && e.value >= 0 && e.value < W.count ? warOutcomeWords(pd, e.value) : ''
      if (W && e.value >= 0 && e.value < W.count) return `Peace with ${polityName(pd, self ? W.defender[e.value] : W.attacker[e.value])}` + (o ? ` (${o})` : '')
      return 'Peace made'
    }
    case PolityEvent.Conquered: {
      if (!self) return `Its army took ${otherName}`
      const loser = polityAt(pd, e.settlement, b)
      let gainer = polityAt(pd, e.settlement, a)
      if (W && e.value >= 0 && e.value < W.count && (gainer < 0 || gainer === loser)) gainer = loser === W.attacker[e.value] ? W.defender[e.value] : W.attacker[e.value]
      return `Conquered by ${polityName(pd, gainer, 'an enemy')}` + (e.other >= 0 ? ` (an army from ${otherName})` : '')
    }
    case PolityEvent.Sacked:
      return self ? `Sacked` + (e.value > 0.02 ? `: ${lossWords(e.value).replace('die', 'died').replace('dies', 'died')}` : '') : `Its army sacked ${otherName}`
    case PolityEvent.SiegeLifted:
      return self ? 'Withstood a siege' : `Its army besieged ${otherName} in vain`
    case PolityEvent.Raid:
      return self ? `Raided` + (e.other >= 0 ? ` from ${otherName}` : '') : `Its raiders struck ${otherName}`
    case PolityEvent.Revolt:
      return self ? `Rose in revolt` + (e.other >= 0 ? ` against ${otherName}` : '') : `${otherName} rose against it`
    case PolityEvent.RevoltCrushed:
      return self ? 'Its revolt was crushed' : `Crushed the revolt at ${otherName}`
    case PolityEvent.Seceded:
      return self ? `Broke away as the capital of ${polityName(pd, e.value)}` : `${otherName} broke away as ${polityName(pd, e.value)}`
    case PolityEvent.Defected:
      return self ? `Went over to ${polityName(pd, e.value)}` : `${otherName} came over to it`
    case PolityEvent.SuccessionCrisis:
      return 'A disputed succession'
  }
  return null
}

/** Chronicle / inspector dot class for a political event, or null. */
export function polityEventKind(h: History | null, e: HistoryEvent): string | null {
  const t = e.type as number
  if (h && isWallEvent(h, e)) return e.type === 4 ? 'walls' : 'lost'
  switch (t) {
    case PolityEvent.Founded:
    case PolityEvent.Ended:
    case PolityEvent.CapitalMoved:
    case PolityEvent.SuccessionCrisis:
      return 'polity'
    case PolityEvent.Joined:
    case PolityEvent.Defected:
      return 'joined'
    case PolityEvent.WarDeclared:
      return 'war'
    case PolityEvent.PeaceMade:
      return 'peace'
    case PolityEvent.Conquered:
    case PolityEvent.SiegeLifted:
      return 'conquest'
    case PolityEvent.Sacked:
      return 'sack'
    case PolityEvent.Raid:
      return 'raid'
    case PolityEvent.Revolt:
    case PolityEvent.RevoltCrushed:
    case PolityEvent.Seceded:
      return 'revolt'
    case PolityEvent.CivilWar:
      return 'civilwar'
    case PolityEvent.Partitioned:
    case PolityEvent.Reunified:
      return 'polity'
    case PolityEvent.BecameVassal:
      return 'vassal'
    case PolityEvent.Alliance:
      return 'alliance'
    case PolityEvent.SmugglingRing:
      return 'smuggle'
    case PolityEvent.PiratesRise:
    case PolityEvent.PiratesSuppressed:
      return 'pirate'
    case PolityEvent.Blockade:
      return 'blockade'
    case EventType.BorderDispute:
      return 'dispute'
    // oaths, balance, arms
    case OathEvent.Betrayal: case OathEvent.OathBroken: case OathEvent.Avenged:
      return 'betrayal'
    case OathEvent.Bandwagon:
      return 'alliance'
    case OathEvent.ArmsRace:
      return 'arms'
  }
  if (t >= 210 && t <= 219) return 'money' // finance
  if (t >= 240 && t <= 249) return 'polity' // society
  if (t >= 230 && t <= 239) return 'intrigue' // beliefs
  return null
}

// ---- the second version's frequent events, gathered per faction and decade in the chronicle ----

/** Group of a BecameVassal event: its overlord. */
export const bondGroupPolity = (e: HistoryEvent) => e.value % TRIBUTE_BASE
/** Group of an Alliance event: the common rival. */
export const allianceGroupPolity = (e: HistoryEvent) => e.extra ?? -1
/** Group of a Blockade event: the blockading polity (that of `other`, its capital), -1 unknown. */
export function blockadeGroupPolity(h: History, e: HistoryEvent): number {
  const pd = politiesOf(h)
  return pd && e.other >= 0 ? polOf(pd, e.other, e.year) : -1
}

/** Chronicle line for the vassal bonds made or thrown off with one overlord in a decade ("Thogon and Kloson bow to Rilkochal; Tiboizo throws off its yoke"). */
export function describeBonds(h: History, members: readonly HistoryEvent[]): string {
  const pd = politiesOf(h)
  if (!pd || members.length === 0) return ''
  const o = bondGroupPolity(members[0])
  const on = polityName(pd, o, 'an overlord')
  const bowed: string[] = [], tribute: string[] = [], freed: string[] = []
  for (const e of members) {
    const n = polityName(pd, polOf(pd, e.settlement, e.year), settlementName(h, e.settlement))
    const into = e.extra === 1 ? freed : e.value >= TRIBUTE_BASE ? tribute : bowed
    if (!into.includes(n)) into.push(n)
  }
  const parts: string[] = []
  if (bowed.length) parts.push(`${listWords(bowed)} ${bowed.length === 1 ? 'bows' : 'bow'} to ${on}`)
  if (tribute.length) parts.push(`${listWords(tribute)} ${tribute.length === 1 ? 'pays' : 'pay'} tribute to ${parts.length ? 'it' : on}`)
  if (freed.length) parts.push(parts.length ? `${listWords(freed)} ${freed.length === 1 ? 'throws' : 'throw'} off its yoke` : `${listWords(freed)} ${freed.length === 1 ? 'throws' : 'throw'} off the yoke of ${on}`)
  return parts.join('; ')
}

/** Chronicle line for the alliances against one rival in a decade ("Kloson, Tiboizo and Thogon ally against Rilkochal"). */
export function describeAlliances(h: History, members: readonly HistoryEvent[]): string {
  const pd = politiesOf(h)
  if (!pd || members.length === 0) return ''
  const names: string[] = []
  for (const e of members) {
    for (const p of [polOf(pd, e.settlement, e.year), e.value]) {
      const n = polityName(pd, p, '')
      if (n && !names.includes(n)) names.push(n)
    }
  }
  return `${listWords(names, 4)} ally against ${polityName(pd, allianceGroupPolity(members[0]), 'a common rival')}` + (members.length > 1 ? ` (${members.length} alliances)` : '')
}

/** Whether a BecameVassal event (the bond made, not thrown off) is already said by the PeaceMade line of the war
 * that ended it this year (same two polities, outcome Vassalage or Tribute): the chronicle then shows only the
 * peace line (which already states the outcome via warOutcomeWords), not a separate "X bows to Y" line too. */
export function vassalSaidByPeace(h: History, e: HistoryEvent): boolean {
  if (e.extra === 1) return false
  const pd = politiesOf(h)
  const W = pd?.wars
  if (!pd || !W) return false
  const v = polOf(pd, e.settlement, e.year)
  const o = bondGroupPolity(e)
  for (let w = 0; w < W.count; w++) {
    if (Math.abs(W.endYear[w] - e.year) > 1) continue
    if (W.outcome[w] !== WarOutcome.Vassalage && W.outcome[w] !== WarOutcome.Tribute) continue
    const a = W.attacker[w], d = W.defender[w]
    if ((a === v && d === o) || (a === o && d === v)) return true
  }
  return false
}

/** Whether `e` is a Built event raising walls (not a fort or another structure). */
export function isWallBuilt(h: History, e: HistoryEvent): boolean {
  return e.type === 4 && h.structures?.[e.other]?.type === StructureType.Walls
}

/** Group of a wall-building event for the chronicle: the builder's polity at the time (-1 stateless or unknown). */
export function wallGroupPolity(h: History, e: HistoryEvent): number {
  const pd = politiesOf(h)
  return pd ? polOf(pd, e.settlement, e.year) : -1
}

/**
 * Whether a Built-walls event is a polity capital's first ring: a milestone kept as its own chronicle line
 * rather than folded into the routine wall-building other towns in the realm are grouped into.
 */
export function isCapitalFirstWalls(h: History, e: HistoryEvent): boolean {
  const pd = politiesOf(h)
  if (!pd) return false
  const before = (pd.wallsOf.get(e.settlement) ?? []).filter((id) => {
    const st = h.structures[id]
    return st.builtYear < e.year && (st.lostYear < 0 || st.lostYear > e.year)
  }).length
  if (before > 0) return false // not its first ring
  return pd.list.some((x) => x.capitals.includes(e.settlement))
}

/** Chronicle line for the walls raised by one polity's towns in a decade ("Vashtar walls 6 towns"). */
export function describeWalls(h: History, members: readonly HistoryEvent[]): string {
  if (members.length === 0) return ''
  const pd = politiesOf(h)
  const g = wallGroupPolity(h, members[0])
  const gn = pd && g >= 0 ? polityName(pd, g) : 'Towns'
  return pd && g >= 0 ? `${gn} walls ${members.length} towns` : `${members.length} towns raise walls`
}

/** Chronicle line for the forts built in a decade ("6 forts rise on the borders, at Frifinlom, Ifimu, Frilis and 3 more"). */
export function describeForts(h: History, members: readonly HistoryEvent[]): string {
  const at: string[] = []
  for (const e of members) {
    const n = settlementName(h, e.settlement)
    if (!at.includes(n)) at.push(n)
  }
  return `${members.length} forts rise on the borders, at ${listWords(at)}`
}

/** Chronicle line for one polity's blockades in a decade ("The fleets of Rilkochal blockade Thofen and Haseno"). */
export function describeBlockades(h: History, members: readonly HistoryEvent[]): string {
  const pd = politiesOf(h)
  if (members.length === 0) return ''
  const by = blockadeGroupPolity(h, members[0])
  const ports: string[] = []
  for (const e of members) {
    const n = settlementName(h, e.settlement)
    if (!ports.includes(n)) ports.push(n)
  }
  const who = pd && by >= 0 ? polityName(pd, by) : members[0].other >= 0 ? settlementName(h, members[0].other) : 'the enemy'
  return `The fleets of ${who} blockade ${listWords(ports)}` + (members.length > ports.length ? ` (${members.length} times)` : '')
}

/**
 * Headline political events: states founded and ended, wars declared and ended, capitals
 * falling, sacks of cities, secessions.
 */
export function isPolityHeadline(h: History, e: HistoryEvent): boolean {
  const t = e.type as number
  // claims: a border dispute only when war between the two follows it
  if (isDisputeEvent(t)) return isDisputeHeadline(h, e)
  // oaths: betrayals, broken oaths and bandwagoning are rare headlines; arms races and avenging are not
  if (t === OathEvent.Betrayal || t === OathEvent.OathBroken || t === OathEvent.Bandwagon) return true
  if (isOathEvent(t)) return false
  // finance: defaults, repudiations and bankrupt wars are headlines; loans, unpaid armies and ruined houses are not
  if (t === EventType.CrownDefault || t === EventType.Repudiation || t === EventType.WarBankrupt) return true
  if (isMoneyEvent(t)) return false
  // society: a crisis of the social order, bondage imposed or thrown off, a nobility thinned are headlines
  if (t === EventType.SocialPhase) return (e.extra ?? 0) === 2
  if (t === EventType.SerfdomImposed || t === EventType.SerfdomEnded || t === EventType.EliteThinned) return true
  if (isSocietyEvent(t)) return false
  // beliefs: coerced cessions, pacts come to light and bluffs seen through are headlines; the rest are not
  if (t === EventType.Coerced || t === EventType.AllianceRevealed || t === EventType.BluffExposed) return true
  if (isBeliefEvent(t)) return false
  // (a realm ended by reunification: its Reunified line is the headline)
  if (t === PolityEvent.Ended && politiesOf(h)?.list[e.value]?.endCause === PolityEnd.Reunified) return false
  if (t === PolityEvent.Founded || t === PolityEvent.Ended || t === PolityEvent.WarDeclared || t === PolityEvent.PeaceMade || t === PolityEvent.Seceded) return true
  // the second version: civil wars, partitions, reunifications
  if (t === PolityEvent.CivilWar || t === PolityEvent.Partitioned || t === PolityEvent.Reunified) return true
  const pd = politiesOf(h)
  if (!pd) return false
  if (t === PolityEvent.Conquered) {
    const loser = polityAt(pd, e.settlement, snapBefore(pd, e.year))
    return loser >= 0 && capitalAt(pd, loser, e.year - 1) === e.settlement
  }
  if (t === PolityEvent.Sacked) {
    const s = snapBefore(pd, e.year)
    return (h.population[s * pd.settlementCount + e.settlement] ?? 0) >= CITY_POPULATION
  }
  return false
}

/** Whether a Conquered or Joined event is minor (grouped per polity per decade in the chronicle). */
export function isMinorGain(h: History, e: HistoryEvent): boolean {
  const t = e.type as number
  if (t === PolityEvent.Joined) return true
  if (t !== PolityEvent.Conquered) return false
  return !isPolityHeadline(h, e)
}

/** Group key of a minor gain: gainer and loser polity (Joined: the polity and -1). */
export function gainKey(h: History, e: HistoryEvent): [number, number] {
  const pd = politiesOf(h)
  if (!pd) return [-1, -1]
  if ((e.type as number) === PolityEvent.Joined) return [e.value, -1]
  const b = snapBefore(pd, e.year), a = snapAfter(pd, e.year)
  const W = pd.wars
  const loser = polityAt(pd, e.settlement, b)
  let gainer = polityAt(pd, e.settlement, a)
  if (W && e.value >= 0 && e.value < W.count && (gainer < 0 || gainer === loser)) gainer = loser === W.attacker[e.value] ? W.defender[e.value] : W.attacker[e.value]
  return [gainer, loser]
}

/** Chronicle line for `count` minor gains of one polity in a decade ("Vashtar takes 4 settlements from Inachal", "3 towns join Vashtar"). */
export function describeGains(h: History, members: readonly HistoryEvent[]): string {
  const pd = politiesOf(h)
  if (!pd || members.length === 0) return ''
  const [g, l] = gainKey(h, members[0])
  const joined = members.filter((e) => (e.type as number) === PolityEvent.Joined).length
  const taken = members.length - joined
  const gn = polityName(pd, g, 'A state')
  const parts: string[] = []
  if (taken > 0) parts.push(`${gn} takes ${taken === 1 ? settlementName(h, members.find((e) => (e.type as number) !== PolityEvent.Joined)!.settlement) : `${taken} settlements`}` + (l >= 0 ? ` from ${polityName(pd, l)}` : ''))
  if (joined > 0) parts.push(taken > 0 ? `${joined} more ${joined === 1 ? 'joins' : 'join'}` : `${joined} ${joined === 1 ? 'town joins' : 'towns join'} ${gn}`)
  return parts.join('; ')
}

/** Chronicle line for raids on towns in a decade. */
export function describeRaids(h: History, members: readonly HistoryEvent[]): string {
  const towns = new Set(members.map((e) => e.settlement))
  const worst = members.reduce((a, e) => (e.value > a.value ? e : a), members[0])
  return `Raiders strike ${towns.size} ${towns.size === 1 ? 'town' : 'towns'}` + (towns.size > 1 ? `, worst ${settlementName(h, worst.settlement)}` : ` (${settlementName(h, worst.settlement)})`) + (members.length > towns.size ? ` (${members.length} raids)` : '')
}

/** Chronicle line for the small raids (History.raids) of one decade: `raids` raids on `places` settlements. */
export function describeSmallRaids(raids: number, places: number): string {
  return `Raiders harry the countryside: ${raids} ${raids === 1 ? 'raid' : 'raids'} on ${places} ${places === 1 ? 'village' : 'villages'}`
}

/** Polity a revolt (or its crushing) was against: that of the capital `other` before it (-1 unknown). */
export function revoltPolity(h: History, e: HistoryEvent): number {
  const pd = politiesOf(h)
  return pd && e.other >= 0 ? polityAt(pd, e.other, snapBefore(pd, e.year)) : -1
}

/** Chronicle line for the revolts against one polity in a decade ("Unrest in Vashtar: 5 risings, 3 crushed"). */
export function describeRevolts(h: History, members: readonly HistoryEvent[]): string {
  const pd = politiesOf(h)
  const p = members.length ? revoltPolity(h, members[0]) : -1
  const rose = members.filter((e) => (e.type as number) === PolityEvent.Revolt).length
  const crushed = members.length - rose
  const name = pd && p >= 0 ? polityName(pd, p) : 'the realm'
  const parts: string[] = []
  if (rose > 0) parts.push(`${rose} ${rose === 1 ? 'rising' : 'risings'}`)
  if (crushed > 0) parts.push(`${crushed} crushed`)
  return `Unrest in ${name}: ${parts.join(', ')}`
}
