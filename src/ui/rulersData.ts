// rulers: one cached index per history over the rulers tables (History.rulers, dynasties, reignOffsets /
// reignIds, marriages, unions, successionWars) and their events (80-88), for the Factions panel's ruler
// section, the inspector's seat line and the chronicle. Null when the history has no rulers (older
// histories, rulers or polities switched off): the UI then looks exactly as before.
//
// Everything the UI shows at a year is a cheap function of the year: the ruler of a state at y is the
// last of its reigns acceded by y (a binary search), unless that reign had ended before y.

import { AccessionHow, EventType, ReignEnd, type Dynasty, type History, type HistoryEvent, type Ruler } from '../contract.ts'
import { PolityTier, polityAtYear, politiesOf, tierAt, type PolitiesData } from './politiesData.ts'

/** Event types of the rulers system (80-88). */
export const isRulersEvent = (t: number) => t >= EventType.RulerAcceded && t <= EventType.SuccessionWar
/** Event types of the religion system (89-97). */
export const isFaithEvent = (t: number) => t >= EventType.FaithFounded && t <= EventType.FaithReached

/** Age of majority (rulers/params.ts RULERS.majority): a younger ruler comes to the throne under a regency. */
export const MAJORITY = 16

/** Grouping classes of chronicle keys (see groupKey). */
export const GroupClass = {
  /** Routine successions of one Kingdom or larger in one quarter-century. */
  Reigns: 1,
  /** A contested or dynastic succession, a union: the events of one state in one year. */
  Succession: 2,
  /** Routine successions in chiefdoms (and leagues' terms), all together per quarter-century. */
  Chiefdoms: 3,
  /** A war of succession with its declaration. */
  War: 4,
  /** A ruler's conversion, a state religion, a persecution: one state in one year. */
  Faith: 5,
  /** A faith reaching new peoples, per faith per half-century. */
  Reached: 6,
  /** A holy war with its declaration. */
  HolyWar: 7,
} as const
const KEY_A = 1e5
const KEY_C = 1e12
export const groupClassOf = (key: number) => Math.floor(key / KEY_C)
const makeKey = (cls: number, a: number, b: number) => cls * KEY_C + (a + 1) * KEY_A + b
const REIGN_BUCKET = 25
const CHIEF_BUCKET = 25
const REACH_BUCKET = 50

export interface RulersData {
  history: History
  /** The polity index (rulers need polities), shared with the Factions panel. */
  pd: PolitiesData
  rulers: readonly Ruler[]
  dynasties: readonly Dynasty[]
  R: number
  D: number
  P: number
  /** Display name with the regnal number where the name repeats on that throne ("Narun II", "Usuk"). */
  title: string[]
  /** Years of regency at the accession (0: of age), from the Regency events. */
  regency: Int16Array
  /** Reigns of each house (on every throne it held), in order of accession. */
  houseReigns: number[][]
  /** Personal unions and marriage ties of each polity (either side), in order of making. */
  unionsOf: number[][]
  marriagesOf: number[][]
  /** War ids of the wars of succession, and the marriage tie each pressed (-1 unknown). */
  succWar: Map<number, number>
  /** Conversions of each reign's person: [year, faith, faith left] triples (RulerConverted), chronological. */
  conversions: Map<number, number[]>
  /** The RulerAcceded and ReignEnded event index of each reign (-1). */
  accEvent: Int32Array
  endEvent: Int32Array
  /** Chronicle grouping key of an event index (rulers and faith events, and the war declarations and succession crises they explain); absent: a line of its own. */
  groupKey: Map<number, number>
  /** Event indices that are headlines on their own (or make their group one). */
  headline: Set<number>
  /** Event indices left out of a settlement's own event list (the accession line of the same year says it). */
  hideInList: Set<number>
  /** Event indices left out of the chronicle: a reign or a house ended with its realm (the realm's end says it). */
  dropped: Set<number>
}

const cache = new WeakMap<History, RulersData | null>()

/** The rulers index of `h` (built once per history), or null when it has none. */
export function rulersOf(h: History | null | undefined): RulersData | null {
  if (!h) return null
  if (cache.has(h)) return cache.get(h) ?? null
  let rd: RulersData | null = null
  try {
    rd = buildRulersData(h)
  } catch (err) {
    console.warn('rulers: data unusable, hidden', err)
    rd = null
  }
  cache.set(h, rd)
  return rd
}

const ROMAN_V = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1]
const ROMAN_S = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I']
export function roman(n: number): string {
  let o = ''
  for (let i = 0; i < ROMAN_V.length; i++) while (n >= ROMAN_V[i]) { o += ROMAN_S[i]; n -= ROMAN_V[i] }
  return o
}

function buildRulersData(h: History): RulersData | null {
  const p = h as Partial<History>
  const rulers = Array.isArray(p.rulers) ? p.rulers : []
  const dynasties = Array.isArray(p.dynasties) ? p.dynasties : []
  if (!rulers.length || !p.reignOffsets || !p.reignIds || p.reignIds.length < rulers.length) return null
  const pd = politiesOf(h)
  if (!pd) return null
  const R = rulers.length, D = dynasties.length, P = pd.count
  if (p.reignOffsets.length < P + 1) return null
  // names: the regnal number only where the name repeats on that throne
  const repeat = new Set<string>()
  {
    const seen = new Set<string>()
    for (const r of rulers) {
      const k = `${r.polity}:${r.name}`
      if (seen.has(k)) repeat.add(k)
      else seen.add(k)
    }
  }
  const title = rulers.map((r) => (r.regnal > 1 || repeat.has(`${r.polity}:${r.name}`) ? `${r.name} ${roman(Math.max(1, r.regnal))}` : r.name))
  const houseReigns: number[][] = Array.from({ length: D }, () => [])
  for (const r of rulers) if (r.dynasty >= 0 && r.dynasty < D) houseReigns[r.dynasty].push(r.id)
  const unionsOf: number[][] = Array.from({ length: P }, () => [])
  const U = p.unions
  if (U) for (let k = 0; k < U.count; k++) {
    if (U.senior[k] >= 0 && U.senior[k] < P) unionsOf[U.senior[k]].push(k)
    if (U.junior[k] >= 0 && U.junior[k] < P) unionsOf[U.junior[k]].push(k)
  }
  const marriagesOf: number[][] = Array.from({ length: P }, () => [])
  const M = p.marriages
  if (M) for (let k = 0; k < M.count; k++) {
    if (M.a[k] >= 0 && M.a[k] < P) marriagesOf[M.a[k]].push(k)
    if (M.b[k] >= 0 && M.b[k] < P) marriagesOf[M.b[k]].push(k)
  }
  const succWar = new Map<number, number>()
  if (p.successionWars) for (const w of p.successionWars) succWar.set(w, -1)
  const regency = new Int16Array(R)
  const accEvent = new Int32Array(R).fill(-1)
  const endEvent = new Int32Array(R).fill(-1)
  const conversions = new Map<number, number[]>()
  const events = h.events
  const E = events.length
  const okR = (r: number) => r >= 0 && r < R
  const rd: RulersData = {
    history: h, pd, rulers, dynasties, R, D, P, title, regency, houseReigns, unionsOf, marriagesOf, succWar, conversions, accEvent, endEvent,
    groupKey: new Map(), headline: new Set(), hideInList: new Set(), dropped: new Set(),
  }
  // the polity of an event logged at a capital (rulers' events carry the reign; faiths' the capital)
  const polityOfEvent = (e: HistoryEvent): number => {
    const t = e.type as number
    if (t === EventType.RulerAcceded || t === EventType.ReignEnded || t === EventType.Regency) return okR(e.value) ? rulers[e.value].polity : -1
    if (t === EventType.DynastyFounded || t === EventType.DynastyEnded || t === EventType.UnionFormed) return okR(e.extra ?? -1) ? rulers[e.extra!].polity : -1
    if (t === EventType.SuccessionCrisis) return e.value
    return e.settlement >= 0 && e.settlement < pd.settlementCount ? polityAtYear(pd, e.settlement, e.year) : -1
  }
  const big = (q: number, y: number) => q >= 0 && q < P && tierAt(pd, q, Math.floor(y / pd.interval)) >= PolityTier.Kingdom
  // first pass: per-reign lookups, conversions, the war of each declaration
  const declOf = new Map<number, number>()
  for (let i = 0; i < E; i++) {
    const e = events[i]
    const t = e.type as number
    if (t === EventType.RulerAcceded && okR(e.value)) accEvent[e.value] = i
    else if (t === EventType.ReignEnded && okR(e.value)) endEvent[e.value] = i
    else if (t === EventType.Regency && okR(e.value)) regency[e.value] = Math.max(1, e.extra ?? 1)
    else if (t === EventType.SuccessionWar) succWar.set(e.value, e.extra ?? -1)
    else if (t === EventType.WarDeclared) declOf.set(e.value, i)
    else if (t === EventType.RulerConverted) {
      const q = polityOfEvent(e)
      const r = q >= 0 ? reignAt(rd, q, e.year) : -1
      if (r >= 0) {
        const person = rulers[r].person
        const a = conversions.get(person)
        const row = [e.year, e.value, e.extra ?? -1]
        if (a) a.push(...row)
        else conversions.set(person, row)
      }
    }
  }
  // second pass: what makes a succession notable (per state and year), then the keys
  const notable = new Set<number>() // q * 10000 + year
  const nk = (q: number, y: number) => q * 10000 + y
  for (let i = 0; i < E; i++) {
    const e = events[i]
    const t = e.type as number
    if (!isRulersEvent(t)) continue
    const q = polityOfEvent(e)
    if (q < 0) continue
    let n = false
    if (t === EventType.RulerAcceded) {
      const how = e.extra ?? rulers[e.value].how
      n = how === AccessionHow.Usurped || how === AccessionHow.Conquered || how === AccessionHow.Union || (how === AccessionHow.Elected && newHouse(rd, e.value))
    } else if (t === EventType.ReignEnded) n = e.extra === ReignEnd.Overthrown || e.extra === ReignEnd.Deposed
    else if (t === EventType.DynastyFounded) n = okR(e.extra ?? -1) && rulers[e.extra!].predecessor >= 0
    else if (t === EventType.DynastyEnded) n = e.year < (pd.list[q]?.endedYear ?? -1) || (pd.list[q]?.endedYear ?? -1) < 0
    else if (t === EventType.UnionFormed || t === EventType.UnionDissolved) n = true
    if (!n) continue
    if (t === EventType.UnionFormed || t === EventType.UnionDissolved || big(q, e.year)) {
      notable.add(nk(q, e.year))
      rd.headline.add(i)
    }
  }
  const key = rd.groupKey
  for (let i = 0; i < E; i++) {
    const e = events[i]
    const t = e.type as number
    if (t === EventType.SuccessionCrisis) {
      if (notable.has(nk(e.value, e.year))) key.set(i, makeKey(GroupClass.Succession, e.value, e.year))
      continue
    }
    if (t === EventType.SuccessionWar || t === EventType.HolyWar) {
      const k = makeKey(t === EventType.HolyWar ? GroupClass.HolyWar : GroupClass.War, e.value, 0)
      key.set(i, k)
      rd.headline.add(i)
      const d = declOf.get(e.value)
      if (d !== undefined) key.set(d, k)
      continue
    }
    if (isFaithEvent(t)) {
      if (t === EventType.RulerConverted || t === EventType.StateReligion || t === EventType.Persecution) {
        const q = polityOfEvent(e)
        if (q >= 0) key.set(i, makeKey(GroupClass.Faith, q, e.year))
      } else if (t === EventType.FaithReached) key.set(i, makeKey(GroupClass.Reached, e.value, Math.floor(e.year / REACH_BUCKET)))
      if (t === EventType.FaithFounded || t === EventType.Schism || t === EventType.HolyCityFell) rd.headline.add(i)
      else if (t === EventType.FaithDied && (h.faiths?.[e.value]?.kind ?? 0) === 1) rd.headline.add(i)
      continue
    }
    if (!isRulersEvent(t)) continue
    if (t === EventType.RoyalMarriage) continue // (a line of its own)
    const q = polityOfEvent(e)
    if (q < 0) continue
    if (notable.has(nk(q, e.year))) key.set(i, makeKey(GroupClass.Succession, q, e.year))
    else if (big(q, e.year)) key.set(i, makeKey(GroupClass.Reigns, q, Math.floor(e.year / REIGN_BUCKET)))
    else key.set(i, makeKey(GroupClass.Chiefdoms, -1, Math.floor(e.year / CHIEF_BUCKET)))
  }
  // a settlement's own list: the accession line of the same year says the end, the regency and the new house
  for (let r = 0; r < R; r++) {
    const a = accEvent[r]
    if (a < 0) continue
    const x = rulers[r]
    if (x.predecessor >= 0 && endEvent[x.predecessor] >= 0 && events[endEvent[x.predecessor]].year === x.acceded) rd.hideInList.add(endEvent[x.predecessor])
  }
  for (let i = 0; i < E; i++) {
    const e = events[i]
    const t = e.type as number
    if (t === EventType.Regency || t === EventType.DynastyFounded) rd.hideInList.add(i)
    // ended with the realm: the realm's end is the line (a reign's end, a house's last throne lost with it)
    if (t === EventType.ReignEnded && e.extra === ReignEnd.RealmEnded) rd.dropped.add(i)
    if (t === EventType.DynastyEnded && okR(e.extra ?? -1) && rulers[e.extra!].end === ReignEnd.RealmEnded) rd.dropped.add(i)
  }
  return rd
}

/** Whether reign r began a house that never ruled that throne before (a new house raised). */
function newHouse(rd: RulersData, r: number): boolean {
  const x = rd.rulers[r]
  if (x.dynasty < 0) return false
  const pr = x.predecessor >= 0 ? rd.rulers[x.predecessor] : null
  return !!pr && pr.dynasty !== x.dynasty
}

/** The reign on polity q's throne at `year` (the last acceded by then; -1 none), ended or not. */
export function reignAt(rd: RulersData, q: number, year: number): number {
  const h = rd.history
  if (q < 0 || q >= rd.P) return -1
  let lo = h.reignOffsets[q], hi = h.reignOffsets[q + 1]
  const a = lo
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (rd.rulers[h.reignIds[m]].acceded <= year) lo = m + 1
    else hi = m
  }
  return lo > a ? h.reignIds[lo - 1] : -1
}

/** The ruler of q at `year`: the reign then, unless it had ended before `year` (-1). */
export function rulerAt(rd: RulersData, q: number, year: number): number {
  const r = reignAt(rd, q, year)
  if (r < 0) return -1
  const x = rd.rulers[r]
  return x.ended >= 0 && x.ended < year ? -1 : r
}

/** Reigns of polity q in order (a subarray view). */
export function reignsOf(rd: RulersData, q: number): Int32Array {
  const h = rd.history
  return q >= 0 && q < rd.P ? h.reignIds.subarray(h.reignOffsets[q], h.reignOffsets[q + 1]) : new Int32Array(0)
}

/** House name of a reign ("House Rilkoli"), '' for a league's elected head. */
export function houseName(rd: RulersData, r: number): string {
  const d = rd.rulers[r]?.dynasty ?? -1
  return d >= 0 && d < rd.D ? `House ${rd.dynasties[d].name}` : ''
}

/** Faith of reign r's person at `year` (its faith at the accession, then its conversions), -1 without religion. */
export function rulerFaithAt(rd: RulersData, r: number, year: number): number {
  const x = rd.rulers[r]
  let f = x.faith
  const c = rd.conversions.get(x.person)
  if (c) for (let k = 0; k < c.length; k += 3) if (c[k] <= year) f = c[k + 1]
  return f
}

/** "King", "Queen", "Empress", "Chief", or "head" of a league, for reign r's polity at `year`. */
export function rulerWord(rd: RulersData, r: number, year: number): string {
  const x = rd.rulers[r]
  const pd = rd.pd
  if (x.dynasty < 0 || pd.list[x.polity]?.origin === 6) return 'Elected head'
  const t = tierAt(pd, x.polity, Math.floor(year / pd.interval))
  if (t === PolityTier.Empire) return x.female ? 'Empress' : 'Emperor'
  if (t === PolityTier.Kingdom) return x.female ? 'Queen' : 'King'
  return x.female ? 'Chieftainess' : 'Chief'
}

/** Generation of reign r within its house: 0 for a founder or the head of a cadet line, else its parent's + 1. */
export function generationOf(rd: RulersData, r: number): number {
  let g = 0
  let x = rd.rulers[r]
  for (let k = 0; k < 200 && x.parent >= 0 && x.parent < rd.R; k++) {
    const pa = rd.rulers[x.parent]
    if (pa.dynasty !== x.dynasty) break
    g++
    x = pa
  }
  return g
}

const samePerson = (rd: RulersData, a: number, b: number) => a >= 0 && b >= 0 && rd.rulers[a].person === rd.rulers[b].person

/** How reign r is kin to its predecessor on the throne: 'son', 'daughter', 'brother', 'grandson', 'nephew', 'kinsman' (a cadet line), or '' (no kin, a new house). */
export function kinToPredecessor(rd: RulersData, r: number): string {
  const x = rd.rulers[r]
  const pr = x.predecessor
  if (pr < 0) return ''
  const y = rd.rulers[pr]
  if (x.dynasty < 0 || y.dynasty !== x.dynasty) return ''
  const f = x.female
  if (x.parent >= 0 && samePerson(rd, x.parent, pr)) return f ? 'daughter' : 'son'
  if (x.parent >= 0 && y.parent >= 0 && samePerson(rd, x.parent, y.parent)) return f ? 'sister' : 'brother'
  if (x.parent >= 0 && rd.rulers[x.parent].parent >= 0 && samePerson(rd, rd.rulers[x.parent].parent, pr)) return f ? 'granddaughter' : 'grandson'
  if (x.parent >= 0 && y.parent >= 0 && rd.rulers[x.parent].parent >= 0 && samePerson(rd, rd.rulers[x.parent].parent, y.parent)) return f ? 'niece' : 'nephew'
  if (x.parent >= 0 && y.parent >= 0 && samePerson(rd, x.parent, rd.rulers[y.parent].parent ?? -1)) return f ? 'aunt' : 'uncle'
  if (x.parent < 0) return f ? 'kinswoman' : 'kinsman'
  return f ? 'kinswoman' : 'kinsman'
}

/** "father", "mother" of reign r's predecessor as kin ("succeeds his father"), from the predecessor's side. */
export function kinWordOfPredecessor(rd: RulersData, r: number): string {
  const k = kinToPredecessor(rd, r)
  const pf = rd.rulers[rd.rulers[r].predecessor]?.female ?? false
  switch (k) {
    case 'son': case 'daughter': return pf ? 'mother' : 'father'
    case 'brother': case 'sister': return pf ? 'sister' : 'brother'
    case 'grandson': case 'granddaughter': return pf ? 'grandmother' : 'grandfather'
    case 'nephew': case 'niece': return pf ? 'aunt' : 'uncle'
    case 'uncle': case 'aunt': return pf ? 'niece' : 'nephew'
  }
  return ''
}

/** Whether reign r is a cadet succession: a kinsman of the house with no parent on the throne (AccessionHow.Inherited, parent -1). */
export function isCadet(rd: RulersData, r: number): boolean {
  const x = rd.rulers[r]
  if (x.how !== AccessionHow.Inherited || x.parent >= 0 || x.predecessor < 0) return false
  return rd.rulers[x.predecessor].dynasty === x.dynasty
}

/** Plain words for a ruler's temperament: "able, warlike and devout" (traits near the middle say nothing). */
export function traitWords(x: Ruler, religion: boolean): string[] {
  const out: string[] = []
  const a = x.ability
  out.push(a >= 1.3 ? 'brilliant' : a >= 1.12 ? 'able' : a >= 0.9 ? 'steady' : a >= 0.74 ? 'mediocre' : 'feeble')
  if (x.warlike >= 0.78) out.push('warlike')
  else if (x.warlike >= 0.62) out.push('martial')
  else if (x.warlike <= 0.22) out.push('peaceable')
  if (religion) {
    if (x.piety >= 0.8) out.push('devout')
    else if (x.piety <= 0.18) out.push('worldly')
    if (x.tolerance >= 0.8) out.push('tolerant')
    else if (x.tolerance <= 0.2) out.push('intolerant')
  }
  return out
}

/** "able, warlike and devout". */
export function listWords(ws: readonly string[]): string {
  if (ws.length <= 1) return ws[0] ?? ''
  return `${ws.slice(0, -1).join(', ')} and ${ws[ws.length - 1]}`
}

/** How reign r came to the throne, in a few words ("by inheritance", "seized the throne"). */
export const HOW_WORDS: Record<number, string> = {
  [AccessionHow.Founded]: 'founded the realm',
  [AccessionHow.Inherited]: 'inherited the throne',
  [AccessionHow.Elected]: 'was elected',
  [AccessionHow.Usurped]: 'seized the throne',
  [AccessionHow.Conquered]: 'was set on the throne by conquerors',
  [AccessionHow.Union]: 'inherited it through a marriage claim',
  [AccessionHow.Claimed]: 'rose as a rival claimant',
}

/** How a reign ended ("died", "fell in battle"), for the king list. */
export const END_WORDS: Record<number, string> = {
  [ReignEnd.Reigning]: '',
  [ReignEnd.Natural]: 'died',
  [ReignEnd.Battle]: 'fell in battle',
  [ReignEnd.Sack]: 'killed at the fall of the capital',
  [ReignEnd.Overthrown]: 'overthrown and killed',
  [ReignEnd.Deposed]: 'deposed',
  [ReignEnd.Plague]: 'died of plague',
  [ReignEnd.RealmEnded]: 'the realm ended',
  [ReignEnd.TermEnded]: 'term ended',
}

/** "his", "her". */
export const his = (x: Ruler) => (x.female ? 'her' : 'his')

/** The other polity of marriage tie k from q's side. */
export function marriagePartner(rd: RulersData, k: number, q: number): number {
  const M = rd.history.marriages
  return M.a[k] === q ? M.b[k] : M.a[k]
}
