// The story director's drama score, static part (experience-whatif-director-sagas §2.2): one score per chronicle entry,
// built once per History in O(entries). DOM-free and CSS-free: it imports only the contract and the polity index (and
// the HistoryIndex type, erased at run time), so Node scripts (storyStats.ts, what-if harnesses) can import it directly.
//
//   S0(n) = B[type] · M(n) · U(e) · R(e) · F1(e) · boost(e)
//
// B: a base weight per event type (0–10) with a category; M: magnitude, 1 + 0.5·log10(1 + X/1000) for X people touched;
// U: upset (the smaller side won); R: reach (empire, kingdom, chiefdom; a city); F1: the world's first of a kind.
// Every EventType has a rule in DRAMA or is listed in DRAMA_IGNORED: the coverage test (drama.test.ts) enumerates the
// live EventType, so a plan that adds event types must decide how each scores, with registerDrama(type, rule) from its
// own *Format.ts or ignoreDrama(type). Ids a later plan has reserved (MASTER-PLAN §3.1) have a provisional rule in
// PROVISIONAL_DRAMA, used only while no rule is registered; the owning plan replaces it.
//
// Weights are design choices [A] (taste), tuned by the harness (storyStats.ts) for spread across categories.

import { CITY_POPULATION, EventType, ReignEnd, TOWN_POPULATION, WarOutcome, PolityEnd, type History, type HistoryEvent } from '../../contract.ts'
import { capitalAt, eventPolities, polityAt, polityAtYear, politiesOf, snapAfter, snapBefore, statIndex, tierAt, type PolitiesData } from '../politiesData.ts'
import type { HistoryIndex } from '../historyIndex.ts'

/** The merged systems (post-8cabf09) by event-type range: their beats are the surfacing lane's measure (storyStats.ts), and
 * the plan's freshness term counts a system's stories as one kind (a battle, a siege and a fallen commander are all battles). */
export const MERGED_SYSTEMS: readonly (readonly [string, (t: number) => boolean])[] = [
  ['families', (t) => t >= 161 && t <= 169],
  ['absentee', (t) => t >= 185 && t <= 187],
  ['oaths', (t) => t >= 190 && t <= 194],
  ['governments', (t) => t >= 200 && t <= 205],
  ['finance', (t) => t >= 210 && t <= 217],
  ['battles', (t) => t >= 220 && t <= 229],
  ['beliefs', (t) => t >= 230 && t <= 238],
  ['society', (t) => t >= 240 && t <= 246],
  ['disasters', (t) => t >= 260 && t <= 269],
  ['coldWars', (t) => t >= 393 && t <= 398],
]
const systemIndex = (t: number): number => MERGED_SYSTEMS.findIndex(([, f]) => f(t))
export const systemOf = (t: number): string | null => MERGED_SYSTEMS[systemIndex(t)]?.[0] ?? null
/** The freshness kind of an event type: its merged system (1000 + index), else the type itself. */
export const storyKind = (t: number): number => { const i = systemIndex(t); return i >= 0 ? 1000 + i : t }

/** Kind of story, for the category spread and the novelty term. */
export const DramaCat = {
  War: 0,
  Politics: 1,
  Dynasty: 2,
  Faith: 3,
  Plague: 4,
  Discovery: 5,
  Settlement: 6,
  Culture: 7,
  Trade: 8,
  Nature: 9,
  Society: 10,
  Nudge: 11,
} as const
export type DramaCat = (typeof DramaCat)[keyof typeof DramaCat]
export const DRAMA_CAT_NAMES: readonly string[] = ['War', 'Politics', 'Dynasty', 'Faith', 'Plague', 'Discovery', 'Settlement', 'Culture', 'Trade', 'Nature', 'Society', 'Nudge']

/** How far the camera stands back: a town, a region, a continent. */
export const DramaScale = { Town: 0, Region: 1, Continent: 2 } as const
export type DramaScale = (typeof DramaScale)[keyof typeof DramaScale]

/** Small lookups over a History for the rules (not the saga Ctx: cheap, no year cut). */
export interface DramaCtx {
  readonly h: History
  readonly pd: PolitiesData | null
  /** Number of settlements (row length of population). */
  readonly N: number
  /** Snapshot at or before `year`. */
  snap(year: number): number
  /** People of settlement `s` at the snapshot before `year` (the town as the event found it). */
  popBefore(s: number, year: number): number
  /** People of polity `p` at the snapshot before `year` (0 if not alive then). */
  polityPop(p: number, year: number): number
  /** Largest people of polity `p` at snapshots within [from, to] (both clamped to the run). */
  polityPeak(p: number, from: number, to: number): number
  /** Tier of polity p at `year`: 0 Chiefdom, 1 Kingdom, 2 Empire; -1 without polities. */
  tier(p: number, year: number): number
  /** Polity of settlement `s` just before `year` (-1 none). */
  polityBefore(s: number, year: number): number
  /** Polity of settlement `s` just after `year` (-1 none). */
  polityAfter(s: number, year: number): number
  /** People of all settlements of people `q` at the snapshot before `year`. */
  peoplePop(q: number, year: number): number
}

export interface DramaRule {
  cat: DramaCat
  /** Base weight B (0–10). */
  base: number
  /** False: this event does not count (as if ignored), e.g. a reign that ended of old age. */
  gate?(c: DramaCtx, e: HistoryEvent): boolean
  /** People affected X (M = 1 + 0.5·log10(1 + X/1000)); absent: M = 1. Summed over an aggregated entry's members. */
  mag?(c: DramaCtx, e: HistoryEvent): number
  /** Upset factor U (1..3); absent: 1. */
  upset?(c: DramaCtx, e: HistoryEvent): number
  /** A further factor of the type's own (a capital falls ×2.5, a peace by its outcome); absent: 1. */
  boost?(c: DramaCtx, e: HistoryEvent): number
  /** The cell the camera goes to; absent: the event settlement's cell. */
  place?(c: DramaCtx, e: HistoryEvent): number
  /** The polities involved (novelty key, diversity and focus); absent: eventPolities(pd, e). */
  polities?(c: DramaCtx, e: HistoryEvent): number[]
  /** Camera distance; absent: Region. */
  scale?: DramaScale | ((c: DramaCtx, e: HistoryEvent) => DramaScale)
  /** ×1.5 for the world's first event of this type that passes the gate (F1). */
  first?: boolean
}

/** Rules per event type. Partial: every type is here or in DRAMA_IGNORED (the coverage test). */
export const DRAMA: Partial<Record<number, DramaRule>> = {}
/** Event types that never make a beat or a notice. */
export const DRAMA_IGNORED = new Set<number>()

/** A plan's rule for its event type (call from its *Format.ts); replaces any earlier rule or ignore. */
export function registerDrama(type: number, rule: DramaRule): void {
  DRAMA_IGNORED.delete(type)
  DRAMA[type] = rule
}
/** A plan's event type that the director leaves alone. */
export function ignoreDrama(type: number): void {
  delete DRAMA[type]
  DRAMA_IGNORED.add(type)
}

// ---------------------------------------------------------------------------------------------------------------
// factors

/** M: magnitude from X people touched, 1 at X = 0, 2 at a million. */
export const magnitude = (x: number): number => 1 + 0.5 * Math.log10(1 + Math.max(0, x) / 1000)

/** U: the smaller side won. `winner` and `loser` are polity ids; their people from the snapshot before the year. */
export function upsetOf(c: DramaCtx, winner: number, loser: number, year: number): number {
  if (winner < 0 || loser < 0 || winner === loser) return 1
  const pw = c.polityPop(winner, year), pl = c.polityPop(loser, year)
  if (!(pw > 0) || !(pl > pw)) return 1
  return Math.min(3, Math.sqrt(pl / pw))
}

/** R: reach by the largest tier involved (×1.6 empire, ×1.25 kingdom, ×0.8 chiefdom), and ×1.2 at a city. */
export function reachOf(c: DramaCtx, polities: readonly number[], settlement: number, year: number): number {
  let tier = -1
  for (const p of polities) if (p >= 0) tier = Math.max(tier, c.tier(p, year))
  const t = tier === 2 ? 1.6 : tier === 1 ? 1.25 : tier === 0 ? 0.8 : 1
  return t * (settlement >= 0 && c.popBefore(settlement, year) >= CITY_POPULATION ? 1.2 : 1)
}

/** Years after an event that a "peak" magnitude looks ahead: bounded, so extending a History leaves older scores alone. */
export const PEAK_HORIZON = 100

// ---------------------------------------------------------------------------------------------------------------
// the context

export function createDramaCtx(h: History): DramaCtx {
  const pd = politiesOf(h)
  const N = h.settlements.length
  const S = h.snapshotCount
  const iv = h.snapshotInterval
  const clampS = (s: number) => Math.max(0, Math.min(S - 1, s))
  const snap = (y: number) => clampS(Math.floor(y / iv))
  const sB = (y: number) => clampS(Math.floor((y - 1) / iv))
  let peopleOf: Int32Array | null = null
  const peoplePopCache = new Map<number, number>()
  const polityPop = (p: number, year: number) => {
    if (!pd || p < 0 || p >= pd.count) return 0
    const k = statIndex(pd, p, snapBefore(pd, year))
    return k >= 0 ? pd.alivePop[k] : 0
  }
  return {
    h,
    pd,
    N,
    snap,
    popBefore: (s, year) => (s >= 0 && s < N ? h.population[sB(year) * N + s] ?? 0 : 0),
    polityPop,
    polityPeak(p, from, to) {
      if (!pd || p < 0 || p >= pd.count) return 0
      let best = 0
      for (let s = clampS(Math.floor(from / iv)), e = clampS(Math.floor(to / iv)); s <= e; s++) {
        const k = statIndex(pd, p, s)
        if (k >= 0 && pd.alivePop[k] > best) best = pd.alivePop[k]
      }
      return best
    },
    tier: (p, year) => (pd && p >= 0 && p < pd.count ? tierAt(pd, p, snapBefore(pd, year)) : -1),
    polityBefore: (s, year) => (pd ? polityAt(pd, s, snapBefore(pd, year)) : -1),
    polityAfter: (s, year) => (pd ? polityAt(pd, s, snapAfter(pd, year)) : -1),
    peoplePop(q, year) {
      const s = sB(year)
      const key = q * 65536 + s
      const hit = peoplePopCache.get(key)
      if (hit !== undefined) return hit
      if (!peopleOf) peopleOf = Int32Array.from(h.settlements, (x) => x.people)
      let sum = 0
      for (let i = 0; i < N; i++) if (peopleOf[i] === q) sum += h.population[s * N + i] ?? 0
      peoplePopCache.set(key, sum)
      return sum
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------
// rules for the event types at 8cabf09 (§2.2 table)

const T = EventType
const warDead = (c: DramaCtx, w: number) => {
  const W = c.pd?.wars
  return W && w >= 0 && w < W.count ? W.dead[w] : 0
}
const warSides = (c: DramaCtx, w: number): number[] => {
  const W = c.pd?.wars
  return W && w >= 0 && w < W.count ? [W.attacker[w], W.defender[w]] : []
}
/** People of the event's town as the event found it. */
const townPop = (c: DramaCtx, e: HistoryEvent) => c.popBefore(e.settlement, e.year)
/** The realm ruled from the event's settlement (polity of its capital) just before. */
const realmOf = (c: DramaCtx, e: HistoryEvent) => (c.pd ? polityAtYear(c.pd, e.settlement, Math.max(0, e.year - 1)) : -1)
const realmPop = (c: DramaCtx, e: HistoryEvent) => c.polityPop(realmOf(c, e), e.year)
const realmPolities = (c: DramaCtx, e: HistoryEvent) => [realmOf(c, e)]
/** The two realms ruled from the event's settlement and `other` (oaths, beliefs, cold wars). */
const pairPolities = (c: DramaCtx, e: HistoryEvent) => [realmOf(c, e), e.other >= 0 ? c.polityBefore(e.other, e.year) : -1]
/** People of both realms of a pair event (the smaller counted in full: a pact between giants weighs more than one with a city). */
const pairPop = (c: DramaCtx, e: HistoryEvent) => { const [a, b] = pairPolities(c, e); return c.polityPop(a, e.year) + (b >= 0 ? c.polityPop(b, e.year) : 0) }
/** Battle ranks by men engaged, per History (cached): the largest ×3 (the battle of the age), the next to BATTLE_TOP[0] ×2.2, the next to BATTLE_TOP[1] ×1.5. */
export const BATTLE_TOP = [5, 15] as const
const battleRanks = new WeakMap<History, Int32Array>()
function battleRankBoost(h: History, b: number): number {
  const B = h.battles
  if (!B || b < 0 || b >= B.count) return 1
  let r = battleRanks.get(h)
  if (!r) {
    const order = Array.from({ length: B.count }, (_, i) => i).sort((x, y) => B.menA[y] + B.menD[y] - (B.menA[x] + B.menD[x]) || x - y)
    r = new Int32Array(B.count)
    order.forEach((i, k) => { r![i] = k })
    battleRanks.set(h, r)
  }
  return r[b] === 0 ? 3 : r[b] < BATTLE_TOP[0] ? 2.2 : r[b] < BATTLE_TOP[1] ? 1.5 : 1
}
/** The town that fell was its realm's capital the year before. */
const capitalFell = (c: DramaCtx, e: HistoryEvent) => {
  if (!c.pd) return false
  const loser = c.polityBefore(e.settlement, e.year)
  return loser >= 0 && capitalAt(c.pd, loser, e.year - 1) === e.settlement
}
const empireScale = (c: DramaCtx, e: HistoryEvent, p: number): DramaScale => (c.tier(p, e.year) === 2 ? DramaScale.Continent : DramaScale.Region)

const R = (type: number, rule: DramaRule) => registerDrama(type, rule)
const I = (...types: number[]) => types.forEach(ignoreDrama)

// --- settlements, food, peoples (0-19) ---
I(T.Founded, T.Migration, T.Built, T.BecameTown, T.StructureLost, T.TradeOpened, T.TradeClosed, T.ExpeditionSent, T.ExpeditionReturned, T.TechAdvance, T.Domesticated, T.SpeciesAdopted)
R(T.Abandoned, { cat: DramaCat.Settlement, base: 4, scale: DramaScale.Town, gate: (c, e) => townPop(c, e) >= TOWN_POPULATION, mag: townPop })
R(T.Famine, { cat: DramaCat.Nature, base: 2, scale: DramaScale.Town, mag: (c, e) => e.value * townPop(c, e) })
R(T.BecameCity, { cat: DramaCat.Settlement, base: 3, scale: DramaScale.Town, first: true, mag: (_c, e) => e.value })
R(T.VoyageLost, { cat: DramaCat.Discovery, base: 3, mag: (_c, e) => e.value })
R(T.Landfall, { cat: DramaCat.Discovery, base: 6, first: true, mag: (_c, e) => e.value * 50 })
R(T.FirstContact, { cat: DramaCat.Discovery, base: 7, first: true })
R(T.Discovery, { cat: DramaCat.Discovery, base: 5, place: (c, e) => (e.other >= 0 ? e.other : c.h.settlements[e.settlement]?.cell ?? -1) })
R(T.Epidemic, { cat: DramaCat.Plague, base: 6, mag: (c, e) => e.value * c.peoplePop(c.h.settlements[e.settlement]?.people ?? -1, e.year) })

// --- polities (20-43) ---
R(T.PolityFounded, { cat: DramaCat.Politics, base: 4, first: true, polities: (_c, e) => [e.value], mag: (c, e) => c.polityPeak(e.value, e.year, e.year + PEAK_HORIZON), scale: (c, e) => empireScale(c, e, e.value) })
R(T.PolityEnded, {
  cat: DramaCat.Politics,
  base: 8,
  polities: (c, e) => [e.value, e.other >= 0 ? c.polityAfter(e.other, e.year) : -1],
  mag: (c, e) => c.polityPeak(e.value, c.pd?.list[e.value]?.foundedYear ?? e.year, e.year),
  upset: (c, e) => (c.pd?.list[e.value]?.endCause === PolityEnd.Conquered && e.other >= 0 ? upsetOf(c, c.polityAfter(e.other, e.year), e.value, e.year) : 1),
  scale: (c, e) => empireScale(c, e, e.value),
})
R(T.CapitalMoved, { cat: DramaCat.Politics, base: 2, polities: (_c, e) => [e.value] })
I(T.Joined, T.Raid, T.RevoltCrushed, T.Defected, T.SmugglingRing, T.PiratesSuppressed, T.Blockade)
R(T.WarDeclared, { cat: DramaCat.War, base: 3, mag: (c, e) => warDead(c, e.value), polities: (c, e) => warSides(c, e.value) })
R(T.PeaceMade, {
  cat: DramaCat.War,
  base: 2,
  mag: (c, e) => warDead(c, e.value),
  polities: (c, e) => warSides(c, e.value),
  boost(c, e) {
    const o = c.pd?.wars?.outcome[e.value]
    return o === WarOutcome.Conquest ? 2 : o === WarOutcome.AttackerGains || o === WarOutcome.DefenderGains || o === WarOutcome.Reunified ? 1.5 : 1
  },
  upset(c, e) {
    const W = c.pd?.wars
    if (!W || e.value < 0 || e.value >= W.count) return 1
    const o = W.outcome[e.value], a = W.attacker[e.value], d = W.defender[e.value]
    const y = W.startYear[e.value]
    if (o === WarOutcome.AttackerGains || o === WarOutcome.Conquest) return upsetOf(c, a, d, y)
    if (o === WarOutcome.DefenderGains) return upsetOf(c, d, a, y)
    return 1
  },
})
R(T.Conquered, {
  cat: DramaCat.War,
  base: 4,
  scale: DramaScale.Town,
  mag: townPop,
  boost: (c, e) => (capitalFell(c, e) ? 2.5 : 1),
  upset: (c, e) => (capitalFell(c, e) ? upsetOf(c, c.polityAfter(e.settlement, e.year), c.polityBefore(e.settlement, e.year), e.year) : 1),
})
R(T.Sacked, { cat: DramaCat.War, base: 6, scale: DramaScale.Town, mag: (c, e) => e.value * townPop(c, e) })
R(T.SiegeLifted, {
  cat: DramaCat.War,
  base: 4,
  scale: DramaScale.Town,
  polities: (c, e) => warSides(c, e.value),
  upset: (c, e) => upsetOf(c, c.polityBefore(e.settlement, e.year), e.other >= 0 ? c.polityBefore(e.other, e.year) : -1, e.year),
})
// battles (220-227): a battle by the men engaged (History.battles), on the war's sides; a commander's fall, renown, a general's coup
const battleWar = (c: DramaCtx, e: HistoryEvent) => (c.h.battles && e.value >= 0 && e.value < c.h.battles.count ? c.h.battles.war[e.value] : -1)
// (surfacing lane, EVALUATION §4 Lane 1: the run's great battles are beats: the largest by men engaged are boosted by rank, and
// the smaller army winning is an upset)
R(T.BattleFought, {
  cat: DramaCat.War,
  base: 5,
  scale: DramaScale.Town,
  polities: (c, e) => { const B = c.h.battles; return B && e.value >= 0 && e.value < B.count ? [B.attacker[e.value], B.defender[e.value]] : warSides(c, battleWar(c, e)) },
  mag: (c, e) => (c.h.battles && e.value >= 0 && e.value < c.h.battles.count ? 4 * (c.h.battles.menA[e.value] + c.h.battles.menD[e.value]) + 20 * c.h.battles.dead[e.value] : 0),
  boost: (c, e) => battleRankBoost(c.h, e.value),
  upset(c, e) {
    const B = c.h.battles
    if (!B || e.value < 0 || e.value >= B.count) return 1
    const win = B.winner[e.value] === 0 ? B.menA[e.value] : B.menD[e.value], lose = B.winner[e.value] === 0 ? B.menD[e.value] : B.menA[e.value]
    return win > 0 && lose > win ? Math.min(3, Math.sqrt(lose / win)) : 1
  },
})
R(T.SiegeLaid, { cat: DramaCat.War, base: 3, scale: DramaScale.Town, polities: (c, e) => warSides(c, e.value) })
R(T.CommanderFell, { cat: DramaCat.War, base: 5, scale: DramaScale.Town })
R(T.CommanderRenowned, { cat: DramaCat.War, base: 4 })
R(T.GeneralSeized, { cat: DramaCat.Dynasty, base: 7 })
R(T.GeneralRose, { cat: DramaCat.War, base: 6 })
R(T.GeneralTurned, { cat: DramaCat.War, base: 5, scale: DramaScale.Town })
R(T.CommanderDismissed, { cat: DramaCat.War, base: 2 })
R(T.Revolt, { cat: DramaCat.Politics, base: 3, scale: DramaScale.Town })
R(T.Seceded, { cat: DramaCat.Politics, base: 4, mag: (c, e) => c.polityPeak(e.value, e.year, e.year + PEAK_HORIZON) })
R(T.SuccessionCrisis, { cat: DramaCat.Dynasty, base: 3, polities: (_c, e) => [e.value], mag: (c, e) => c.polityPop(e.value, e.year) })
R(T.CivilWar, { cat: DramaCat.War, base: 7, mag: (c, e) => warDead(c, e.value), polities: (c, e) => warSides(c, e.value) })
R(T.Partitioned, { cat: DramaCat.Politics, base: 6, polities: (_c, e) => [e.value], mag: (c, e) => c.polityPop(e.value, e.year), scale: (c, e) => empireScale(c, e, e.value) })
R(T.Reunified, { cat: DramaCat.Politics, base: 6, mag: (c, e) => c.polityPop(e.value, e.year) })
R(T.BecameVassal, { cat: DramaCat.Politics, base: 3 })
R(T.Alliance, { cat: DramaCat.Politics, base: 2 })
R(T.PiratesRise, { cat: DramaCat.Trade, base: 3, scale: DramaScale.Town })

// --- species, second version (44-49) ---
I(T.TechniqueFound, T.TechniqueAdopted, T.HabitSpreads, T.Drain)
R(T.Blight, { cat: DramaCat.Nature, base: 3, mag: (c, e) => (e.extra ?? 0) * c.peoplePop(c.h.settlements[e.settlement]?.people ?? -1, e.year) })
R(T.Panzootic, { cat: DramaCat.Nature, base: 3, mag: (c, e) => (e.extra ?? 0) * c.peoplePop(c.h.settlements[e.settlement]?.people ?? -1, e.year) })

// --- goods (50-65) ---
I(T.MineExhausted, T.TraditionBorn, T.TraditionMoved, T.TraditionLost, T.SecretGuarded, T.PostFounded, T.PostLost, T.Bypassed, T.SecretSmuggled)
R(T.DepositFound, { cat: DramaCat.Trade, base: 2, scale: DramaScale.Town })
R(T.Boom, { cat: DramaCat.Trade, base: 4, scale: DramaScale.Town })
R(T.TraditionRenowned, { cat: DramaCat.Culture, base: 3, scale: DramaScale.Town })
R(T.SecretLeaked, { cat: DramaCat.Trade, base: 3 })
R(T.MonopolyBroken, { cat: DramaCat.Trade, base: 4 })
R(T.DirectRoute, { cat: DramaCat.Trade, base: 4, scale: DramaScale.Continent })
R(T.FleetLost, { cat: DramaCat.Trade, base: 3 })

// --- disease (66-72) ---
I(T.Quarantine, T.Endemic)
R(T.DiseaseAppeared, { cat: DramaCat.Plague, base: 3 })
R(T.GreatEpidemic, { cat: DramaCat.Plague, base: 9, first: true, scale: DramaScale.Continent, mag: (c, e) => c.h.epidemics?.[e.value]?.deaths ?? 0 })
R(T.EpidemicEnded, { cat: DramaCat.Plague, base: 3, scale: DramaScale.Continent, mag: (c, e) => c.h.epidemics?.[e.value]?.deaths ?? 0 })
R(T.CityStricken, { cat: DramaCat.Plague, base: 4, scale: DramaScale.Town, mag: (c, e) => (e.extra ?? 0) * townPop(c, e) })
R(T.ArmyStricken, { cat: DramaCat.War, base: 3, polities: (c, e) => warSides(c, e.value) })

// --- rulers (80-88) ---
I(T.RulerAcceded, T.RoyalMarriage)
// (a reign ended in battle, of plague, or by a usurper: murdered or driven out (surfacing lane: usurpation was unscored))
R(T.ReignEnded, { cat: DramaCat.Dynasty, base: 5, polities: realmPolities, gate: (_c, e) => e.extra === ReignEnd.Battle || e.extra === ReignEnd.Plague || e.extra === ReignEnd.Overthrown || e.extra === ReignEnd.Deposed, mag: realmPop, boost: (_c, e) => (e.extra === ReignEnd.Overthrown ? 1.5 : e.extra === ReignEnd.Deposed ? 1.25 : 1) })
R(T.DynastyFounded, { cat: DramaCat.Dynasty, base: 4, polities: realmPolities, mag: realmPop })
R(T.DynastyEnded, { cat: DramaCat.Dynasty, base: 5, // (the plan's 6 made it a third of all beats; storyStats.ts)
  polities: realmPolities, mag: realmPop })
R(T.Regency, { cat: DramaCat.Dynasty, base: 2, polities: realmPolities })
R(T.UnionFormed, { cat: DramaCat.Dynasty, base: 5, polities: (c, e) => [realmOf(c, e), e.other >= 0 ? c.polityBefore(e.other, e.year) : -1] })
R(T.UnionDissolved, { cat: DramaCat.Dynasty, base: 3, polities: (c, e) => [realmOf(c, e), e.other >= 0 ? c.polityBefore(e.other, e.year) : -1] })
R(T.SuccessionWar, { cat: DramaCat.War, base: 5, mag: (c, e) => warDead(c, e.value), polities: (c, e) => warSides(c, e.value) })

// --- religion (89-97) ---
I(T.FaithReached)
R(T.FaithFounded, { cat: DramaCat.Faith, base: 8, first: true, scale: DramaScale.Town })
R(T.RulerConverted, { cat: DramaCat.Faith, base: 4, polities: realmPolities, mag: realmPop })
R(T.StateReligion, { cat: DramaCat.Faith, base: 4, polities: realmPolities, mag: realmPop })
R(T.Schism, { cat: DramaCat.Faith, base: 6 })
R(T.Persecution, { cat: DramaCat.Faith, base: 4, polities: realmPolities, mag: realmPop })
R(T.HolyWar, { cat: DramaCat.Faith, base: 6, mag: (c, e) => warDead(c, e.value), polities: (c, e) => warSides(c, e.value) })
R(T.HolyCityFell, { cat: DramaCat.Faith, base: 8, scale: DramaScale.Town, mag: townPop, polities: (c, e) => [c.polityBefore(e.settlement, e.year), c.polityAfter(e.settlement, e.year)] })
R(T.FaithDied, { cat: DramaCat.Faith, base: 5 })

// --- tourism, renaming, ideas, claims (100-130) ---
I(T.LeisureTravel, T.ResortFounded, T.ResortInFashion, T.ResortDeclined, T.ResortAbandoned, T.SightRecognised, T.PlaceRenamed)
R(T.IdeaConceived, { cat: DramaCat.Culture, base: 4, gate: (_c, e) => (e.extra ?? 0) === 0 })
I(T.IdeaAdopted, T.IdeaLost, T.IdeaResisted, T.BorderDispute)

// --- language (250-253, language-drift: present only with HistoryOptions.language) ---
R(T.LanguageSplit, { cat: DramaCat.Culture, base: 2 })
R(T.LanguageShift, { cat: DramaCat.Culture, base: 2, scale: DramaScale.Town })
I(T.LoanWave)
R(T.LanguageDied, { cat: DramaCat.Culture, base: 4 })

// --- writing (400-404, language-typology-scripts: present only with HistoryOptions.typology) ---
// (a people's own invention scores like IdeaConceived; the rest are notices)
R(T.ScriptInvented, { cat: DramaCat.Culture, base: 4, gate: (_c, e) => (e.extra ?? 0) === 0 })
R(T.ScriptAdopted, { cat: DramaCat.Culture, base: 2 })
R(T.ScriptReformed, { cat: DramaCat.Culture, base: 3 })
R(T.ScriptReplaced, { cat: DramaCat.Culture, base: 3 })
R(T.ScriptLost, { cat: DramaCat.Culture, base: 3 })

// --- oaths (190-194, grudges-and-oaths: only with HistoryOptions.oaths/balance/arms) ---
// (surfacing lane: a broken oath or a betrayal weighs by the realms it binds; a war against an ally's oath more than a broken truce)
R(T.Betrayal, { cat: DramaCat.Politics, base: 7, polities: (c, e) => [realmOf(c, e), e.other >= 0 ? c.polityBefore(e.other, e.year) : -1], mag: (c, e) => pairPop(c, e), first: true })
R(T.OathBroken, { cat: DramaCat.War, base: 6, polities: (c, e) => [realmOf(c, e), e.other >= 0 ? c.polityBefore(e.other, e.year) : -1], mag: (c, e) => pairPop(c, e), boost: (_c, e) => ((e.extra ?? 0) === 1 ? 1.3 : 1), first: true })
R(T.Avenged, { cat: DramaCat.War, base: 5, polities: (c, e) => [realmOf(c, e), e.other >= 0 ? c.polityBefore(e.other, e.year) : -1], mag: (c, e) => pairPop(c, e) })
R(T.Bandwagon, { cat: DramaCat.Politics, base: 3, polities: (c, e) => [realmOf(c, e), e.other >= 0 ? c.polityBefore(e.other, e.year) : -1] })
R(T.ArmsRace, { cat: DramaCat.War, base: 3, gate: (_c, e) => (e.extra ?? 0) !== 1, polities: (c, e) => [realmOf(c, e), e.other >= 0 ? c.polityBefore(e.other, e.year) : -1] })

// --- beliefs (230-238, beliefs-and-deception: only with HistoryOptions.beliefs) ---
// (surfacing lane: an exposed bluff and a secret alliance come to light are the system's headlines, weighed by the realms involved)
R(T.Coerced, { cat: DramaCat.War, base: 4, polities: pairPolities })
R(T.Deterred, { cat: DramaCat.Politics, base: 2, polities: pairPolities })
R(T.BluffExposed, { cat: DramaCat.Politics, base: 5, polities: pairPolities, mag: (c, e) => pairPop(c, e), first: true })
R(T.AllianceRevealed, { cat: DramaCat.Politics, base: 6, polities: pairPolities, mag: (c, e) => pairPop(c, e), boost: (_c, e) => (e.value >= 0 ? 1.3 : 1), first: true })
R(T.ClaimExposed, { cat: DramaCat.Politics, base: 2, polities: realmPolities })
I(T.BluffBegun, T.SecretAlliance, T.SpyCaught, T.ClaimForged)

// --- cold wars (393-398, barriers-coldwar: only with HistoryOptions.coldWars) ---
R(T.ColdWarBegan, { cat: DramaCat.Politics, base: 5, polities: pairPolities, mag: (c, e) => pairPop(c, e), first: true, scale: DramaScale.Continent })
R(T.ProxyWar, { cat: DramaCat.War, base: 3, polities: pairPolities })
R(T.ClientDefected, { cat: DramaCat.Politics, base: 3, polities: pairPolities })
R(T.Crisis, { cat: DramaCat.War, base: 3, gate: (_c, e) => (e.extra ?? 0) !== 3, polities: pairPolities }) // (an escalated crisis: its WarDeclared scores)
R(T.ColdWarEnded, { cat: DramaCat.Politics, base: 4, gate: (_c, e) => (e.extra ?? 0) !== 1, polities: pairPolities, mag: (c, e) => pairPop(c, e) }) // (a hot war: its WarDeclared scores)
I(T.Detente)

// --- crown finance (210-217, state-finances: only with HistoryOptions.finance) ---
I(T.LoanTaken, T.ArmyUnpaid)
R(T.CrownDefault, { cat: DramaCat.Politics, base: 5, polities: realmPolities, mag: realmPop, first: true })
R(T.Repudiation, { cat: DramaCat.Politics, base: 5, polities: realmPolities, mag: realmPop })
R(T.WarBankrupt, { cat: DramaCat.War, base: 6, polities: realmPolities, mag: realmPop, first: true }) // (surfacing: a war that broke a treasury, by the realm it broke)
R(T.HousesRuined, { cat: DramaCat.Trade, base: 3 })

// --- society (240-246, society-secular-cycles: only with HistoryOptions.society) ---
// (headlines: a crisis of the social order, bondage imposed or ended, a nobility thinned; the rest are notices)
R(T.SocialPhase, { cat: DramaCat.Society, base: 4, gate: (_c, e) => (e.extra ?? 0) === 2, polities: realmPolities, mag: realmPop })
R(T.SerfdomImposed, { cat: DramaCat.Society, base: 4, polities: realmPolities, mag: realmPop })
R(T.SerfdomEnded, { cat: DramaCat.Society, base: 4, polities: realmPolities, mag: realmPop })
R(T.EliteThinned, { cat: DramaCat.Society, base: 4, polities: realmPolities })
R(T.EliteFactions, { cat: DramaCat.Society, base: 3, polities: realmPolities })
R(T.LabourDear, { cat: DramaCat.Society, base: 2, polities: realmPolities })
I(T.Ennobled)

// --- governments (200-205, city-states: only with HistoryOptions.governments) ---
// (a commune proclaimed, a charter bought, a lord seizing a republic, a clergy taking its holy city and a charter revoked are
// stories; GovernmentChanged (crowned, settled, secularised) a smaller one)
// (surfacing lane: by the city's people over its first century, and each the world's first once)
const cityPeak = (c: DramaCtx, e: HistoryEvent) => Math.max(townPop(c, e), c.polityPeak(e.value, e.year, e.year + PEAK_HORIZON))
R(T.CharterBought, { cat: DramaCat.Politics, base: 4, scale: DramaScale.Town, polities: (_c, e) => [e.value], mag: cityPeak, first: true })
R(T.CommuneProclaimed, { cat: DramaCat.Politics, base: 7, scale: DramaScale.Town, polities: (_c, e) => [e.value], mag: cityPeak, first: true })
R(T.SignoriaSeized, { cat: DramaCat.Politics, base: 6, polities: (_c, e) => [e.value], mag: cityPeak, first: true })
R(T.TheocracyProclaimed, { cat: DramaCat.Faith, base: 7, scale: DramaScale.Town, polities: (_c, e) => [e.value], mag: cityPeak, first: true })
R(T.GovernmentChanged, { cat: DramaCat.Politics, base: 3, polities: (_c, e) => [e.value] })
R(T.CharterRevoked, { cat: DramaCat.Politics, base: 4, scale: DramaScale.Town, polities: (_c, e) => [e.value] })

// --- landmarks (140-146), danger on the way (150-151), merchants (160) ---
I(T.LandmarkBegun, T.LandmarkAbandoned, T.LandmarkNeglected, T.LandmarkRestored, T.LandmarkConverted)
R(T.LandmarkCompleted, { cat: DramaCat.Culture, base: 5, scale: DramaScale.Town })
R(T.LandmarkRuined, { cat: DramaCat.Culture, base: 5, scale: DramaScale.Town })
R(T.TradeForsaken, { cat: DramaCat.Trade, base: 3 })
I(T.TradeRestored, T.MerchantsMoved)

// --- merchant families (161-169, merchant-families: only with HistoryOptions.families) ---
// (a house founded on a venture, a bankruptcy, a marriage into a ruling house and a backed civil war make stories; the rest are notices)
R(T.FamilyFounded, { cat: DramaCat.Trade, base: 2, scale: DramaScale.Town, gate: (_c, e) => (e.extra ?? 0) === 1 })
I(T.FamilyBranch, T.BranchClosed, T.FamilyHead, T.FamilyPatron)
R(T.FamilyMoved, { cat: DramaCat.Trade, base: 2, scale: DramaScale.Town })
R(T.FamilyMarriage, { cat: DramaCat.Dynasty, base: 4, mag: realmPop, first: true }) // (a merchant house marries into a crown: by the realm)
R(T.FamilyBacked, { cat: DramaCat.Politics, base: 4, mag: (c, e) => warDead(c, e.extra ?? -1) }) // (a house backing a side of a civil war, by its dead)
R(T.FamilyFell, { cat: DramaCat.Trade, base: 6, scale: DramaScale.Town, gate: (_c, e) => (((e.extra ?? 0) / 16) | 0) === 1, mag: townPop, first: true }) // (surfacing: a house's ruin, by the town it fell in)

// --- orders (170-173), cradles (180) ---
I(T.OrderGiven, T.OrderLapsed, T.CradlePlaced)
R(T.OrderFulfilled, { cat: DramaCat.Nudge, base: 7 })
R(T.OrderFailed, { cat: DramaCat.Nudge, base: 4 })

// ---------------------------------------------------------------------------------------------------------------
// provisional rules for event ids later plans have reserved (MASTER-PLAN §3.1, R37; addenda): used only while the type
// has no registered rule. Base weights from the owners' plans where given (court §10.5, migration §5.5, divine 3.9,
// character), else a design default [A]. Base 0 means "ignore" (the owner listed it in DRAMA_IGNORED).

/** [first id, last id, category, base] blocks, with per-id overrides below. */
const PROVISIONAL_BLOCKS: readonly (readonly [number, number, DramaCat, number])[] = [
  [161, 169, DramaCat.Trade, 2], // merchant-families
  [190, 199, DramaCat.War, 4], // grudges
  [200, 209, DramaCat.Politics, 4], // city-states
  [210, 219, DramaCat.Politics, 3], // state-finances
  [220, 229, DramaCat.War, 4], // battles (experience §0.1 range fallback until battles registers)
  [230, 239, DramaCat.Politics, 3], // beliefs
  [240, 249, DramaCat.Society, 3], // society
  [250, 259, DramaCat.Culture, 2], // language-drift
  [260, 269, DramaCat.Nature, 5], // disasters
  [270, 279, DramaCat.Nudge, 3], // seat-mode
  [280, 289, DramaCat.Society, 4], // riots
  [290, 299, DramaCat.Politics, 2], // court-politics
  [300, 309, DramaCat.Culture, 3], // tech-tree
  [310, 319, DramaCat.Politics, 4], // modern-ideologies
  [320, 329, DramaCat.Discovery, 4], // future-tech
  [330, 339, DramaCat.Politics, 3], // future-politics
  [340, 349, DramaCat.Society, 3], // migration
  [350, 359, DramaCat.Trade, 2], // infrastructure
  [360, 369, DramaCat.Nudge, 3], // character-mode
  [380, 389, DramaCat.Faith, 4], // world-builder-divine
  [410, 419, DramaCat.Faith, 4], // religious-evolution
]
const PROVISIONAL_OVERRIDES: Record<number, readonly [DramaCat, number]> = {
  169: [DramaCat.Trade, 3], // FamilyFell
  190: [DramaCat.Politics, 7], 191: [DramaCat.War, 5], 192: [DramaCat.War, 5], // Betrayal, OathBroken, Avenged
  201: [DramaCat.Politics, 6], 202: [DramaCat.Politics, 4], 205: [DramaCat.Politics, 4], // CommuneProclaimed, SignoriaSeized, CharterRevoked
  211: [DramaCat.Politics, 5], 212: [DramaCat.Politics, 5], 214: [DramaCat.War, 5], // CrownDefault, Repudiation, WarBankrupt
  220: [DramaCat.War, 5], 222: [DramaCat.War, 5], 226: [DramaCat.War, 5], // BattleFought, CommanderFell, GeneralTurned
  230: [DramaCat.War, 4], 233: [DramaCat.Politics, 3], 235: [DramaCat.Politics, 5], // Coerced, BluffExposed, AllianceRevealed
  240: [DramaCat.Society, 4], 246: [DramaCat.Society, 4], // SocialPhase, EliteThinned
  253: [DramaCat.Culture, 4], // LanguageDied
  260: [DramaCat.Nature, 7], 261: [DramaCat.Nature, 6], 264: [DramaCat.Nature, 8], // Eruption, VolcanicWinter, CityDestroyed
  270: [DramaCat.Nudge, 7], 272: [DramaCat.Nudge, 7], 273: [DramaCat.Nudge, 7], // SeatTaken, SeatLost, AmbitionFulfilled
  280: [DramaCat.Society, 5], 283: [DramaCat.Society, 6], 288: [DramaCat.Society, 5], // Uprising, Massacre, MinorityAttacked
  290: [DramaCat.Politics, 3], 291: [DramaCat.Politics, 3], 292: [DramaCat.Politics, 6], 295: [DramaCat.Politics, 3], 296: [DramaCat.Politics, 3], 297: [DramaCat.Politics, 3], 298: [DramaCat.Politics, 6], // court §10.5
  310: [DramaCat.Politics, 6], 314: [DramaCat.Politics, 6], 315: [DramaCat.Politics, 6], // ModernRegimeChanged, Coup, RevolutionStage
  327: [DramaCat.Nature, 8], // GreatCollapse
  340: [DramaCat.Politics, 3], 341: [DramaCat.Society, 5], 342: [DramaCat.Politics, 6], 343: [DramaCat.Politics, 3], 344: [DramaCat.Society, 2], 345: [DramaCat.Society, 3], 346: [DramaCat.Society, 2], 347: [DramaCat.Society, 4], 348: [DramaCat.Society, 0], // migration §5.5
  361: [DramaCat.Nudge, 6], 362: [DramaCat.Nudge, 2], 363: [DramaCat.Nudge, 2], 368: [DramaCat.Nudge, 6], 369: [DramaCat.Nudge, 6], // character
  380: [DramaCat.Faith, 6], 381: [DramaCat.Faith, 0], 382: [DramaCat.Faith, 0], 383: [DramaCat.Faith, 5], 384: [DramaCat.Faith, 6], 385: [DramaCat.Faith, 4], // divine 3.9
  410: [DramaCat.Faith, 6], // Reformation
}

/** The provisional rule for a reserved id, or null (unreserved, or the owner ignores it). */
export function provisionalDrama(type: number): DramaRule | null {
  const o = PROVISIONAL_OVERRIDES[type]
  if (o) return o[1] > 0 ? { cat: o[0], base: o[1] } : null
  for (const [lo, hi, cat, base] of PROVISIONAL_BLOCKS) if (type >= lo && type <= hi) return { cat, base }
  return null
}
/** Whether `type` lies in a block some plan has reserved (MASTER-PLAN §3.1). */
export const isReservedEventId = (type: number) => PROVISIONAL_BLOCKS.some(([lo, hi]) => type >= lo && type <= hi)

/** The rule in force for `type`: registered, else provisional, else null (ignored or unknown). */
export function dramaRule(type: number): DramaRule | null {
  const r = DRAMA[type]
  if (r) return r
  if (DRAMA_IGNORED.has(type)) return null
  return provisionalDrama(type)
}

// ---------------------------------------------------------------------------------------------------------------
// static scores over the chronicle's entries

/** The slice of a HistoryIndex the scores read (the type is erased: no CSS reaches Node through it). */
export type NotableIndex = Pick<HistoryIndex, 'history' | 'notableKind' | 'notableYear' | 'notableOffsets' | 'notableMembers'>

/** EntryKind values the score treats specially (mirrors historyIndex.ts EntryKind; drama.test.ts checks they agree). */
export const ENTRY_SINGLE = 0
export const ENTRY_FAMINE_BURST = 1

export interface StaticDrama {
  /** S0 per notable entry (0: not a story). */
  score: Float32Array
  cat: Uint8Array
  /** The camera's target cell (-1 none). */
  cell: Int32Array
  scale: Uint8Array
  /** Novelty key: cat·2^20 + main polity id, or + 2^19 + people id when no polity is involved. */
  key: Int32Array
  /** The representative event (index into History.events; -1 none) and the two main polities (-1 none). */
  rep: Int32Array
  /** The representative event's story kind (storyKind: its merged system, else its type; -1 none): the plan's freshness
   * term (a kind of story not told for a while) and its like-story rule. */
  type: Int16Array
  polA: Int32Array
  polB: Int32Array
  /** Factors of S0 for review (storyStats): B, M, U, R, F1 (and the type's own boost folded into B). */
  fB: Float32Array
  fM: Float32Array
  fU: Float32Array
  fR: Float32Array
  fF: Float32Array
}

const KEY_CAT = 1 << 20
const KEY_PEOPLE = 1 << 19

/** S0 and its parts for every notable entry of `ix`. Deterministic, no RNG; O(entries + events). */
export function buildStaticDrama(ix: NotableIndex, ctx: DramaCtx = createDramaCtx(ix.history)): StaticDrama {
  const h = ix.history
  const E = ix.notableKind.length
  const out: StaticDrama = {
    score: new Float32Array(E), cat: new Uint8Array(E), cell: new Int32Array(E).fill(-1), scale: new Uint8Array(E), key: new Int32Array(E),
    rep: new Int32Array(E).fill(-1), type: new Int16Array(E).fill(-1), polA: new Int32Array(E).fill(-1), polB: new Int32Array(E).fill(-1),
    fB: new Float32Array(E), fM: new Float32Array(E), fU: new Float32Array(E), fR: new Float32Array(E), fF: new Float32Array(E),
  }
  /** Types whose world's first (passing the gate) has been seen, in chronological entry order. */
  const firstSeen = new Set<number>()
  const pd = ctx.pd
  for (let k = 0; k < E; k++) {
    const lo = ix.notableOffsets[k], hi = ix.notableOffsets[k + 1]
    // the representative: the member with the highest base weight that passes its gate (ties: the first)
    let rep = -1, repRule: DramaRule | null = null, repB = 0
    let x = 0, m = 0, anyMag = false
    for (let q = lo; q < hi; q++) {
      const i = ix.notableMembers[q]
      if (i < 0) continue // namings, small raids, re-paths: no event, not a story
      const e = h.events[i]
      const rule = dramaRule(e.type as number)
      if (!rule || rule.base <= 0 || (rule.gate && !rule.gate(ctx, e))) continue
      m++
      if (rule.mag) {
        anyMag = true
        x += rule.mag(ctx, e)
      }
      if (rule.base > repB) {
        repB = rule.base
        rep = i
        repRule = rule
      }
    }
    if (rep < 0 || !repRule) continue
    const e = h.events[rep]
    let B = repB
    if (ix.notableKind[k] === ENTRY_FAMINE_BURST) B = Math.max(B, 4) // a famine across many towns in one year
    B *= repRule.boost ? repRule.boost(ctx, e) : 1
    const M = (anyMag ? magnitude(x) : 1) * (1 + 0.1 * Math.min(10, Math.max(0, m - 1)))
    const U = repRule.upset ? Math.max(1, Math.min(3, repRule.upset(ctx, e))) : 1
    const pols = (repRule.polities ? repRule.polities(ctx, e) : pd ? eventPolities(pd, e) : []).filter((p) => p >= 0)
    const Rr = reachOf(ctx, pols, e.settlement, e.year)
    let F = 1
    if (repRule.first && !firstSeen.has(e.type as number)) {
      firstSeen.add(e.type as number)
      F = 1.5
    }
    out.score[k] = B * M * U * Rr * F
    out.cat[k] = repRule.cat
    out.cell[k] = repRule.place ? repRule.place(ctx, e) : h.settlements[e.settlement]?.cell ?? -1
    const sc = repRule.scale
    out.scale[k] = sc === undefined ? DramaScale.Region : typeof sc === 'function' ? sc(ctx, e) : sc
    out.rep[k] = rep
    out.type[k] = storyKind(e.type as number)
    out.polA[k] = pols[0] ?? -1
    out.polB[k] = pols.find((p) => p !== pols[0]) ?? -1
    const people = h.settlements[e.settlement]?.people ?? 0
    out.key[k] = repRule.cat * KEY_CAT + (out.polA[k] >= 0 ? out.polA[k] : KEY_PEOPLE + people)
    out.fB[k] = B
    out.fM[k] = M
    out.fU[k] = U
    out.fR[k] = Rr
    out.fF[k] = F
  }
  return out
}

/**
 * what-if (experience §1.6 step 3): the static score of one event on its own, B·M·U·R (no aggregation, no firsts): 0 when
 * the type is ignored or its gate fails. Ranks a comparison's first differences.
 */
export function eventScore(c: DramaCtx, e: HistoryEvent): number {
  const rule = dramaRule(e.type as number)
  if (!rule || rule.base <= 0 || (rule.gate && !rule.gate(c, e))) return 0
  const B = rule.base * (rule.boost ? rule.boost(c, e) : 1)
  const M = rule.mag ? magnitude(rule.mag(c, e)) : 1
  const U = rule.upset ? Math.max(1, Math.min(3, rule.upset(c, e))) : 1
  const pols = (rule.polities ? rule.polities(c, e) : c.pd ? eventPolities(c.pd, e) : []).filter((p) => p >= 0)
  return B * M * U * reachOf(c, pols, e.settlement, e.year)
}
