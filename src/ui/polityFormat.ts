// Text for the political events (EventType 20-34) and walls, for the chronicle and the
// inspector; all optional at runtime (null for other events, or for a history without
// polity data, so the caller falls back to its own wording).

import { RevoltCause, StructureType, WarKind, WarOutcome, type History, type HistoryEvent } from '../contract.ts'
import { CITY_POPULATION } from '../contract.ts'
import { capitalAt, isPolityEventType, polityAt, polityTitle, politiesOf, PolityEvent, snapAfter, snapBefore, wallSlighted, type PolitiesData } from './politiesData.ts'

const settlementName = (h: History, id: number) => (id >= 0 && id < h.settlements.length ? h.settlements[id].name || `Settlement #${id}` : 'a settlement')

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
  return t ? t.replace('{a}', polityName(pd, W.attacker[w])).replace('{d}', polityName(pd, W.defender[w])) : ''
}

/** "The Kingdom of Vashtar", title at the snapshot after the event. */
const The = (pd: PolitiesData, p: number, s: number) => `The ${polityTitle(pd, p, s)}`

/** Words for political events of a history whose polity data is missing (types 20-34). */
const FALLBACK = ['a state is founded', 'a state ends', 'the court moves here', 'joins a state', 'war is declared', 'peace is made', 'taken in war', 'sacked', 'a siege is lifted', 'raided', 'a revolt breaks out', 'a revolt is crushed', 'breaks away', 'changes sides', 'a disputed succession']

/** Chronicle line for a political event (types 20-34) or walls, or null. */
export function describePolityEvent(h: History, e: HistoryEvent): string | null {
  const t = e.type as number
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
      return `${at} declares war on ${df}`
    }
    case PolityEvent.PeaceMade: {
      if (!W || e.value < 0 || e.value >= W.count) return `Peace between ${name} and ${settlementName(h, e.other)}`
      const o = warOutcomeWords(pd, e.value)
      return `Peace between ${polityName(pd, W.attacker[e.value])} and ${polityName(pd, W.defender[e.value])}` + (o ? ` (${o})` : '')
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
  if (!isPolityEventType(t) && !isWallEvent(h, e)) return null
  const pd = politiesOf(h)
  if (isWallEvent(h, e)) {
    if (e.type === 4) return 'Raised walls'
    return wallSlighted(pd, e.settlement, e.year) ? 'Its walls were slighted' : 'Its walls fell into ruin'
  }
  if (!pd) return FALLBACK[t - 20] ? FALLBACK[t - 20].charAt(0).toUpperCase() + FALLBACK[t - 20].slice(1) : null
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
  }
  return null
}

/**
 * Headline political events: states founded and ended, wars declared and ended, capitals
 * falling, sacks of cities, secessions.
 */
export function isPolityHeadline(h: History, e: HistoryEvent): boolean {
  const t = e.type as number
  if (t === PolityEvent.Founded || t === PolityEvent.Ended || t === PolityEvent.WarDeclared || t === PolityEvent.PeaceMade || t === PolityEvent.Seceded) return true
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
