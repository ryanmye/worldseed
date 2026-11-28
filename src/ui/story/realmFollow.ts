// lane N4d: follow one realm (owner, 2026-11-28: "instead of following everything in the world, follow mode should also
// lock into a country and go through smaller events too"). DOM-free and CSS-free like drama.ts and plan.ts, so the stats
// harnesses (storyStats.ts, pacingStats.ts --realm) build the same story the app tells.
//
// A realm's story is its own plan (plan.ts buildStoryPlan with REALM_STORY: shorter gaps, lower thresholds) over its own
// entries: one per event of the realm, from its founding to its end, scored by REALM_RULES (smaller events than the world's
// story tells: accessions and deaths, marriages, revolts, towns founded and lost, buildings and landmarks, ideas adopted,
// faith, battles of any size, debts, plagues and floods in its towns, merchant houses and charters), plus a few "meanwhile"
// entries: the world's greatest beats elsewhere (kept at MEANWHILE_SPEED× in the world plan, at most one per MEANWHILE_GAP
// years), told without a flight.
//
//   s(e) = max(B_r[type] · M_r(e) · C(e), W · S_w(e) / R(realm))
//   M_r = 0.8 + 0.4 · min(3, log2(1 + pop(town) / mean town pop of the realm))   (a town large for its realm, 1 without a town)
//   C   = 1.3 at the realm's capital
//   S_w = drama.ts eventScore (the world's score of the event on its own), R its reach factor (empire 1.6 ... chiefdom 0.8):
//         the realm's tier is divided out, so a chiefdom's story and an empire's run on the same thresholds.
// B_r, W and the tune are design defaults [A], tuned with storyStats.ts --realm (beats per century, share of small events).
//
// An event is the realm's when the realm is one of its polities (politiesData eventPolities, or its drama rule's), or its
// town (or, for a few kinds, its other town) is the realm's that year. A small (local) event is one the world's story
// would not make a beat of on its own (S_w below STORY.theta).

import { CITY_POPULATION, EventType, type History } from '../../contract.ts'
import { capitalAt, eventPolities, polityAtYear, polityLives, type PolitiesData } from '../politiesData.ts'
import { createDramaCtx, DramaCat, dramaRule, DramaScale, eventScore, reachOf, storyKind, type DramaCtx, type NotableIndex, type StaticDrama } from './drama.ts'
import { buildStoryPlan, STORY, type StoryPlan, type StoryTune } from './plan.ts'
import type { PacingTune } from './director.ts'

/** The realm plan's constants (plan.ts STORY overridden): beats every gMin..gMin+window years, kept at speed k when
 * their prominence is at least promPerSpeed·k years. Tuned with storyStats.ts --realm (2000 years, 3 seeds). */
export const REALM_STORY: StoryTune = {
  tauKey: 40,
  tauCat: 45,
  gMin: 9,
  window: 18,
  theta: 2.2,
  thetaNote: 99, // (no notices of its own: the realm's smaller events are its beats; the world's notices are left out)
  focus: 1,
  promPerSpeed: 6,
  fresh: 0.6,
  tauType: 60,
  debut: 0,
  floor: 0.6,
  like: 0.8,
  likeYears: 2,
  ahead: 1.5,
}
/** The realm's pacing (director.ts setPacing): a stretch is quiet after 30 years with no beat (the world: 60), and goes
 * by at 2.5× (the world: 4×): there are more beats, so less to skip. */
export const REALM_PACE: PacingTune = { ffYears: 30, ffFactor: 2.5 }
/** The weight of the world's own score of an event in the realm's (the realm's tier divided out). */
export const REALM_WORLD_WEIGHT = 0.6
/** Meanwhile: the world's beats kept at this speed, at most one per MEANWHILE_GAP years, scored MEANWHILE_SCORE × θ. */
export const MEANWHILE_SPEED = 8
export const MEANWHILE_GAP = 120
export const MEANWHILE_SCORE = 1.3

const T = EventType
/** Whose the event is: Town (its town's owner, camera on the town), Realm (its polities, camera on the capital). */
const Scope = { Town: 0, Realm: 1 } as const
type Scope = (typeof Scope)[keyof typeof Scope]
/** [category, base weight B_r, scope]. Types not listed count only with the world's score (their drama rule's). */
export const REALM_RULES: Partial<Record<number, readonly [DramaCat, number, Scope]>> = {
  // rulers and heirs
  [T.RulerAcceded]: [DramaCat.Dynasty, 3, Scope.Realm],
  [T.ReignEnded]: [DramaCat.Dynasty, 3, Scope.Realm],
  [T.DynastyFounded]: [DramaCat.Dynasty, 4, Scope.Realm],
  [T.DynastyEnded]: [DramaCat.Dynasty, 4, Scope.Realm],
  [T.Regency]: [DramaCat.Dynasty, 3, Scope.Realm],
  [T.UnionFormed]: [DramaCat.Dynasty, 4, Scope.Realm],
  [T.UnionDissolved]: [DramaCat.Dynasty, 3, Scope.Realm],
  [T.RoyalMarriage]: [DramaCat.Dynasty, 3, Scope.Realm],
  [T.SuccessionWar]: [DramaCat.War, 4, Scope.Realm],
  [T.SuccessionCrisis]: [DramaCat.Dynasty, 3, Scope.Realm],
  [T.HeirNamed]: [DramaCat.Dynasty, 2.5, Scope.Realm],
  // the realm's politics and its towns
  [T.PolityFounded]: [DramaCat.Politics, 5, Scope.Realm],
  [T.PolityEnded]: [DramaCat.Politics, 6, Scope.Realm],
  [T.CapitalMoved]: [DramaCat.Politics, 3, Scope.Town],
  [T.Joined]: [DramaCat.Politics, 2, Scope.Town],
  [T.Revolt]: [DramaCat.Politics, 3, Scope.Town],
  [T.RevoltCrushed]: [DramaCat.Politics, 2.5, Scope.Town],
  [T.Defected]: [DramaCat.Politics, 3, Scope.Town],
  [T.Seceded]: [DramaCat.Politics, 4, Scope.Town],
  [T.Partitioned]: [DramaCat.Politics, 5, Scope.Realm],
  [T.Reunified]: [DramaCat.Politics, 5, Scope.Realm],
  [T.BecameVassal]: [DramaCat.Politics, 3, Scope.Realm],
  [T.Alliance]: [DramaCat.Politics, 2, Scope.Realm],
  [T.Founded]: [DramaCat.Settlement, 2, Scope.Town],
  [T.BecameTown]: [DramaCat.Settlement, 2, Scope.Town],
  [T.BecameCity]: [DramaCat.Settlement, 3, Scope.Town],
  [T.Abandoned]: [DramaCat.Settlement, 2.5, Scope.Town],
  [T.PlaceRenamed]: [DramaCat.Culture, 1.5, Scope.Town],
  // war: its battles of any size
  [T.WarDeclared]: [DramaCat.War, 3, Scope.Realm],
  [T.PeaceMade]: [DramaCat.War, 3, Scope.Realm],
  [T.CivilWar]: [DramaCat.War, 5, Scope.Realm],
  [T.Conquered]: [DramaCat.War, 3.5, Scope.Town],
  [T.Sacked]: [DramaCat.War, 4, Scope.Town],
  [T.SiegeLifted]: [DramaCat.War, 3, Scope.Town],
  [T.Raid]: [DramaCat.War, 1.5, Scope.Town],
  [T.Blockade]: [DramaCat.War, 2.5, Scope.Town],
  [T.BattleFought]: [DramaCat.War, 3, Scope.Town],
  [T.SiegeLaid]: [DramaCat.War, 2.5, Scope.Town],
  [T.CommanderFell]: [DramaCat.War, 3, Scope.Town],
  [T.CommanderRenowned]: [DramaCat.War, 2.5, Scope.Realm],
  [T.GeneralSeized]: [DramaCat.Dynasty, 4, Scope.Realm],
  [T.GeneralRose]: [DramaCat.War, 3, Scope.Realm],
  [T.GeneralTurned]: [DramaCat.War, 3, Scope.Town],
  [T.CommanderDismissed]: [DramaCat.War, 2, Scope.Realm],
  [T.ArmyStricken]: [DramaCat.War, 2.5, Scope.Realm],
  // buildings and landmarks
  [T.Built]: [DramaCat.Culture, 1.5, Scope.Town],
  [T.StructureLost]: [DramaCat.Culture, 1.5, Scope.Town],
  [T.LandmarkBegun]: [DramaCat.Culture, 2.5, Scope.Town],
  [T.LandmarkCompleted]: [DramaCat.Culture, 3.5, Scope.Town],
  [T.LandmarkAbandoned]: [DramaCat.Culture, 2, Scope.Town],
  [T.LandmarkRuined]: [DramaCat.Culture, 3, Scope.Town],
  [T.LandmarkRestored]: [DramaCat.Culture, 2, Scope.Town],
  [T.LandmarkConverted]: [DramaCat.Faith, 2.5, Scope.Town],
  [T.TraditionRenowned]: [DramaCat.Culture, 2, Scope.Town],
  [T.Boom]: [DramaCat.Trade, 2, Scope.Town],
  // ideas and faith
  [T.IdeaConceived]: [DramaCat.Culture, 3.5, Scope.Town],
  [T.IdeaAdopted]: [DramaCat.Culture, 2, Scope.Town],
  [T.IdeaLost]: [DramaCat.Culture, 2, Scope.Town],
  [T.ScriptInvented]: [DramaCat.Culture, 3.5, Scope.Town],
  [T.ScriptAdopted]: [DramaCat.Culture, 2, Scope.Town],
  [T.FaithFounded]: [DramaCat.Faith, 4, Scope.Town],
  [T.FaithReached]: [DramaCat.Faith, 2, Scope.Town],
  [T.RulerConverted]: [DramaCat.Faith, 3.5, Scope.Realm],
  [T.StateReligion]: [DramaCat.Faith, 3.5, Scope.Realm],
  [T.Persecution]: [DramaCat.Faith, 3, Scope.Realm],
  [T.Schism]: [DramaCat.Faith, 3, Scope.Town],
  [T.HolyWar]: [DramaCat.Faith, 4, Scope.Realm],
  [T.HolyCityFell]: [DramaCat.Faith, 4, Scope.Town],
  // debts and taxes
  [T.LoanTaken]: [DramaCat.Politics, 2, Scope.Realm],
  [T.ArmyUnpaid]: [DramaCat.Politics, 2.5, Scope.Realm],
  [T.CrownDefault]: [DramaCat.Politics, 3.5, Scope.Realm],
  [T.Repudiation]: [DramaCat.Politics, 3.5, Scope.Realm],
  [T.WarBankrupt]: [DramaCat.War, 3.5, Scope.Realm],
  [T.HousesRuined]: [DramaCat.Trade, 2, Scope.Realm],
  // plagues, floods and the land
  [T.CityStricken]: [DramaCat.Plague, 3, Scope.Town],
  [T.Famine]: [DramaCat.Nature, 2, Scope.Town],
  [T.Eruption]: [DramaCat.Nature, 4, Scope.Town],
  [T.Earthquake]: [DramaCat.Nature, 3.5, Scope.Town],
  [T.Tsunami]: [DramaCat.Nature, 3.5, Scope.Town],
  [T.CityDestroyed]: [DramaCat.Nature, 4.5, Scope.Town],
  [T.Flood]: [DramaCat.Nature, 2, Scope.Town],
  [T.DroughtBegan]: [DramaCat.Nature, 2.5, Scope.Town],
  [T.VolcanicWinter]: [DramaCat.Nature, 3, Scope.Town],
  // its families and city charters
  [T.FamilyFounded]: [DramaCat.Trade, 2, Scope.Town],
  [T.FamilyBranch]: [DramaCat.Trade, 1.5, Scope.Town],
  [T.FamilyMoved]: [DramaCat.Trade, 1.5, Scope.Town],
  [T.FamilyHead]: [DramaCat.Trade, 1.5, Scope.Town],
  [T.FamilyMarriage]: [DramaCat.Dynasty, 3, Scope.Town],
  [T.FamilyBacked]: [DramaCat.Politics, 2.5, Scope.Town],
  [T.FamilyPatron]: [DramaCat.Culture, 2, Scope.Town],
  [T.FamilyFell]: [DramaCat.Trade, 3, Scope.Town],
  [T.CharterBought]: [DramaCat.Politics, 3, Scope.Town],
  [T.CommuneProclaimed]: [DramaCat.Politics, 4, Scope.Town],
  [T.SignoriaSeized]: [DramaCat.Politics, 4, Scope.Town],
  [T.TheocracyProclaimed]: [DramaCat.Faith, 4, Scope.Town],
  [T.GovernmentChanged]: [DramaCat.Politics, 3, Scope.Town],
  [T.CharterRevoked]: [DramaCat.Politics, 3, Scope.Town],
  // society, oaths, beliefs
  [T.SocialPhase]: [DramaCat.Society, 2.5, Scope.Realm],
  [T.SerfdomImposed]: [DramaCat.Society, 3, Scope.Realm],
  [T.SerfdomEnded]: [DramaCat.Society, 3, Scope.Realm],
  [T.EliteFactions]: [DramaCat.Society, 2.5, Scope.Realm],
  [T.EliteThinned]: [DramaCat.Society, 3, Scope.Realm],
  [T.LabourDear]: [DramaCat.Society, 2, Scope.Realm],
  [T.Betrayal]: [DramaCat.Politics, 4, Scope.Realm],
  [T.OathBroken]: [DramaCat.War, 3.5, Scope.Realm],
  [T.Avenged]: [DramaCat.War, 3, Scope.Realm],
  [T.Bandwagon]: [DramaCat.Politics, 2, Scope.Realm],
  [T.Coerced]: [DramaCat.War, 2.5, Scope.Realm],
  [T.BluffExposed]: [DramaCat.Politics, 3, Scope.Realm],
  [T.AllianceRevealed]: [DramaCat.Politics, 3, Scope.Realm],
  [T.SpyCaught]: [DramaCat.Politics, 2, Scope.Realm],
  [T.ColdWarBegan]: [DramaCat.Politics, 3.5, Scope.Realm],
  [T.ProxyWar]: [DramaCat.War, 3, Scope.Realm],
  [T.ColdWarEnded]: [DramaCat.Politics, 3, Scope.Realm],
  [T.PiratesRise]: [DramaCat.Trade, 2, Scope.Town],
}

/** One followed realm's story. Entries are this structure's own (one per event of the realm, then the meanwhile ones). */
export interface RealmStory {
  polity: number
  /** Entry years (ascending), scores and the rest in plan.ts's StaticDrama shape (rep: the entry's event). */
  years: Float64Array
  drama: StaticDrama
  plan: StoryPlan
  /** Per entry: 1 a small (local) event (the world's story would not make a beat of it), 2 a meanwhile entry, else 0. */
  kind: Uint8Array
  /** Per entry: the world chronicle's entry holding its event (-1 none). */
  worldEntry: Int32Array
  /** The world chronicle's entries that are the realm's (ascending): the chronicle's realm filter. */
  chronicleEntries: Int32Array
  /** The year the realm ended (Infinity: it lives to the end of the run) and its successor (null: none). */
  endYear: number
  successor: Successor | null
}

export const EntryKindR = { Realm: 0, Small: 1, Meanwhile: 2 } as const

export interface Successor {
  polity: number
  /** conquered: it took the capital; capital: it kept the capital (a breakaway, a rump); heir: the largest heir state. */
  why: 'conquered' | 'capital' | 'heir'
}

/** The realm `p`'s story over history `ix.history` (`world`: the world's drama and plan, for the meanwhile entries). */
export function buildRealmStory(ix: NotableIndex, p: number, world: { drama: StaticDrama; plan: StoryPlan } | null, ctx: DramaCtx = createDramaCtx(ix.history)): RealmStory | null {
  const h = ix.history
  const pd = ctx.pd
  if (!pd || p < 0 || p >= pd.count) return null
  const x = pd.list[p]
  const from = x.foundedYear
  const end = x.endedYear >= 0 ? x.endedYear : Infinity
  // event -> world chronicle entry
  const entryOf = new Int32Array(h.events.length).fill(-1)
  for (let k = 0; k < ix.notableKind.length; k++) for (let q = ix.notableOffsets[k]; q < ix.notableOffsets[k + 1]; q++) { const i = ix.notableMembers[q]; if (i >= 0) entryOf[i] = k }
  const owner = (s: number, y: number) => (s >= 0 && s < h.settlements.length ? polityAtYear(pd, s, y) : -1)
  // the realm's mean town population (M_r), sampled once a century of its life
  const N = h.settlements.length
  let meanPop = 0
  {
    let sum = 0, n = 0
    const S = h.snapshotCount
    for (let y = from; y <= Math.min(end, h.years); y += 100) {
      const s = Math.max(0, Math.min(S - 1, Math.floor(y / h.snapshotInterval)))
      const M = pd.settlementCount
      for (let i = 0; i < Math.min(N, M); i++) if (pd.polity[s * M + i] === p && h.population[s * N + i] > 0) { sum += h.population[s * N + i]; n++ }
    }
    meanPop = n > 0 ? sum / n : CITY_POPULATION / 4
  }
  const ev: { i: number; s: number; cat: number; cell: number; scale: number; other: number; small: boolean }[] = []
  for (let i = 0; i < h.events.length; i++) {
    const e = h.events[i]
    if (e.year < from || e.year > Math.min(end, h.years)) continue
    const t = e.type as number
    const rr = REALM_RULES[t]
    const wr = dramaRule(t)
    if (!rr && (!wr || wr.base <= 0)) continue
    // whose: its polities, else its town's (or the other town's) owner
    let pols: number[]
    try {
      pols = (wr?.polities ? wr.polities(ctx, e) : eventPolities(pd, e)).filter((q) => q >= 0)
    } catch {
      pols = []
    }
    const townOwner = owner(e.settlement, e.year)
    const mine = pols.includes(p) || townOwner === p || (rr?.[2] === Scope.Town && owner(e.other, e.year) === p && (t === T.Conquered || t === T.Defected || t === T.Seceded))
    if (!mine) continue
    const sw = wr && wr.base > 0 && (!wr.gate || wr.gate(ctx, e)) ? eventScore(ctx, e) : 0
    const reach = reachOf(ctx, [p], -1, e.year)
    let s = REALM_WORLD_WEIGHT * sw / reach
    let cat = wr?.cat ?? DramaCat.Politics
    let scope: Scope = rr ? rr[2] : wr?.scale === DramaScale.Town ? Scope.Town : Scope.Realm
    if (rr) {
      const town = e.settlement >= 0 && e.settlement < N ? ctx.popBefore(e.settlement, e.year) : 0
      const M = town > 0 && scope === Scope.Town ? 0.8 + 0.4 * Math.min(3, Math.log2(1 + town / Math.max(1, meanPop))) : 1
      const C = e.settlement >= 0 && capitalAt(pd, p, e.year) === e.settlement ? 1.3 : 1
      const local = rr[1] * M * C
      if (local >= s) cat = rr[0]
      s = Math.max(s, local)
    }
    if (!(s > 0)) continue
    // the camera: the event's town when it is the realm's (or a battle's site), else the capital
    const cap = capitalAt(pd, p, e.year)
    let cell = -1
    if (t === T.BattleFought && h.battles && e.value >= 0 && e.value < h.battles.count) cell = h.battles.site[e.value]
    else if (scope === Scope.Town && e.settlement >= 0 && e.settlement < N) cell = h.settlements[e.settlement].cell
    if (cell < 0 && cap >= 0) { cell = h.settlements[cap].cell; scope = Scope.Realm }
    ev.push({ i, s, cat, cell, scale: scope === Scope.Town ? DramaScale.Town : DramaScale.Region, other: pols.find((q) => q !== p) ?? -1, small: sw < STORY.theta })
  }
  // meanwhile: the world's greatest beats elsewhere
  const mw: { k: number; y: number }[] = []
  if (world) {
    const wp = world.plan, wd = world.drama
    let last = -Infinity
    const unit = Math.min(STORY.gMin, STORY.promPerSpeed)
    for (let b = 0; b < wp.beatEntry.length; b++) {
      const k = wp.beatEntry[b], y = wp.beatYear[b]
      if (y < from || y > Math.min(end, h.years) || wp.beatProminence[b] < unit * MEANWHILE_SPEED || y - last < MEANWHILE_GAP) continue
      if (wd.polA[k] === p || wd.polB[k] === p) continue
      mw.push({ k, y })
      last = y
    }
  }
  // entries in year order (ties: realm events first, by event index)
  type Row = { y: number; ord: number; r: number; m: number }
  const rows: Row[] = ev.map((r, j) => ({ y: h.events[r.i].year, ord: r.i, r: j, m: -1 }))
  for (const [j, m] of mw.entries()) rows.push({ y: m.y, ord: h.events.length + j, r: -1, m: j })
  rows.sort((a, b) => a.y - b.y || a.ord - b.ord)
  const E = rows.length
  const sd: StaticDrama = {
    score: new Float32Array(E), cat: new Uint8Array(E), cell: new Int32Array(E).fill(-1), scale: new Uint8Array(E), key: new Int32Array(E),
    rep: new Int32Array(E).fill(-1), type: new Int16Array(E).fill(-1), polA: new Int32Array(E).fill(-1), polB: new Int32Array(E).fill(-1),
    fB: new Float32Array(E), fM: new Float32Array(E), fU: new Float32Array(E), fR: new Float32Array(E), fF: new Float32Array(E),
  }
  const years = new Float64Array(E)
  const kind = new Uint8Array(E)
  const worldEntry = new Int32Array(E).fill(-1)
  const theta = REALM_STORY.theta ?? STORY.theta
  for (let n = 0; n < E; n++) {
    const row = rows[n]
    years[n] = row.y
    if (row.r >= 0) {
      const r = ev[row.r]
      const e = h.events[r.i]
      sd.score[n] = r.s
      sd.cat[n] = r.cat
      sd.cell[n] = r.cell
      sd.scale[n] = r.scale
      sd.rep[n] = r.i
      sd.type[n] = storyKind(e.type as number)
      sd.polA[n] = p
      sd.polB[n] = r.other
      sd.key[n] = r.cat * (1 << 20) + p
      kind[n] = r.small ? EntryKindR.Small : EntryKindR.Realm
      worldEntry[n] = entryOf[r.i]
    } else {
      const k = mw[row.m].k
      const wd = world!.drama
      sd.score[n] = MEANWHILE_SCORE * theta
      sd.cat[n] = wd.cat[k]
      sd.cell[n] = -1 // (told without a flight: the camera stays on the realm)
      sd.scale[n] = wd.scale[k]
      sd.rep[n] = wd.rep[k]
      sd.type[n] = -2 // (a kind of its own: never fresher than the realm's)
      sd.polA[n] = wd.polA[k]
      sd.polB[n] = wd.polB[k]
      sd.key[n] = (1 << 30) + n // (no novelty against the realm's)
      kind[n] = EntryKindR.Meanwhile
      worldEntry[n] = k
    }
    sd.fB[n] = sd.score[n]
  }
  const plan = buildStoryPlan(sd, years, { until: Math.min(end, h.years), tune: REALM_STORY })
  // the chronicle's realm filter: the world entries holding a realm event, and those the drama gives the realm
  const ce = new Set<number>()
  for (const r of ev) if (entryOf[r.i] >= 0) ce.add(entryOf[r.i])
  if (world) for (let k = 0; k < world.drama.polA.length; k++) if (world.drama.polA[k] === p || world.drama.polB[k] === p) ce.add(k)
  for (const i of pd.eventsOf[p] ?? []) if (entryOf[i] >= 0) ce.add(entryOf[i])
  const chronicleEntries = Int32Array.from([...ce].sort((a, b) => a - b))
  return { polity: p, years, drama: sd, plan, kind, worldEntry, chronicleEntries, endYear: end, successor: successorOf(h, pd, p) }
}

/** Who the story passes to when realm `p` ends: the realm holding its last capital after (its conqueror, or the breakaway
 * or rump that kept it), else its largest heir state founded within 30 years of its end; null if none (or it lives on). */
export function successorOf(h: History, pd: PolitiesData, p: number): Successor | null {
  const x = pd.list[p]
  if (!x || x.endedYear < 0) return null
  const y = x.endedYear
  const cap = capitalAt(pd, p, y - 1)
  if (cap >= 0) {
    for (const yy of [y + 1, y + 5, y + 12]) {
      if (yy > h.years) break
      const q = polityAtYear(pd, cap, yy)
      if (q >= 0 && q !== p && polityLives(pd, q, yy)) return { polity: q, why: x.endCause === 1 ? 'conquered' : 'capital' }
    }
  }
  let best = -1, bestPop = 0
  for (const c of pd.children[p] ?? []) {
    const cx = pd.list[c]
    if (Math.abs(cx.foundedYear - y) > 30 && !(cx.foundedYear < y && (cx.endedYear < 0 || cx.endedYear > y))) continue
    let pop = 0
    for (let s = Math.max(0, pd.firstSnap[c]); s >= 0 && s <= pd.lastSnap[c] && s < pd.snapshotCount; s++) {
      for (let k = pd.aliveOffsets[s]; k < pd.aliveOffsets[s + 1]; k++) if (pd.aliveId[k] === c) pop = Math.max(pop, pd.alivePop[k])
    }
    if (pop > bestPop) { bestPop = pop; best = c }
  }
  return best >= 0 ? { polity: best, why: 'heir' } : null
}

/** follow=realm:auto (the start page's "or follow one realm"): the realm defaultRealm picks once the history is in. */
export const REALM_AUTO = -2
/** The realm a follow=realm:<id> address names (REALM_AUTO for realm:auto; null: not a realm link). */
export function parseFollowRealm(v: string | null): number | null {
  if (v === 'realm:auto') return REALM_AUTO
  const m = v ? /^realm:(\d+)$/.exec(v) : null
  return m ? Number(m[1]) : null
}

/** The realm "or follow one realm" on the start page picks: of the realms alive at year `at` (or the first founded after),
 * the one with the most people at its peak whose life covers the most of the run after `at`. */
export function defaultRealm(pd: PolitiesData, at: number, years: number): number {
  let best = -1, bestV = 0
  for (let p = 0; p < pd.count; p++) {
    const x = pd.list[p]
    const end = x.endedYear >= 0 ? x.endedYear : years
    if (end < at + 50) continue
    let peak = 0
    for (let s = Math.max(0, pd.firstSnap[p]); s >= 0 && s <= pd.lastSnap[p] && s < pd.snapshotCount; s++)
      for (let k = pd.aliveOffsets[s]; k < pd.aliveOffsets[s + 1]; k++) if (pd.aliveId[k] === p) peak = Math.max(peak, pd.alivePop[k])
    const v = peak * Math.min(1, (end - Math.max(at, x.foundedYear)) / 500)
    if (v > bestV) { bestV = v; best = p }
  }
  return best
}

/** Which event types are a realm's small (local) stories by rule (the share the stats report). */
export const isRealmRule = (t: number) => REALM_RULES[t] !== undefined
