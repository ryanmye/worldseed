// landmarks: great buildings and houses of worship raised as a consequence of history. A pure consequence layer: it reads
// the other systems' state at the end of each year (after renaming, index.ts) and changes nothing of theirs; its only
// output is its own table of landmarks and their changes, which assemble.ts names (History.landmarks) and turns into the
// landmark events (great ones only).
//
// Great works (LandmarkRank.Great; at most one of each kind per town, victory monuments and tombs aside), begun at the
// scans every LANDMARK.step years unless said otherwise, each with its chance per scan (params.ts):
//   Castle        the capital of a realm of Kingdom tier or more, held castleYears, with castlePop people (castle); any capital
//                 held forceYears with forcePop people that has neither castle nor palace begins one at once (the guarantee:
//                 every city that has long been a capital has a great work); or a frontier fortress: a town of fortPop
//                 people of such a realm, taken in war or besieged in the last fortWindow years (fort).
//   Palace        the capital of a kingdom held palaceYears (an empire's palaceEmpireYears), palacePop people, rich.
//   GreatTemple   the holy city of a living universal faith (holyPop; holy); the capital of a kingdom whose majority follows
//                 its state faith (seatTemplePop; seatTemple); a rich city of piousPop whose majority faith holds piousShare
//                 under a ruler of piety piousRuler (pious).
//   Monastery     a pious ruler (piety monkPiety) of a faith of organisation monkOrg founds one (one per reign) in the largest
//                 town of the realm (monkPop) that follows the ruler's faith and has none.
//   MarketHall    a mart of the long-haul trade of martPop people, rich (mart); a city of hubPop, hubRich times as rich (hub).
//   Guildhall     the seat of a craft tradition renowned in the last guildWindow years, guildPop people (guild).
//   Lighthouse    a port at an end of an open long-haul lane over the deep sea (oceanCells), lightPop people (light).
//   Library       a rich city of libraryPop whose people holds writing (library; x libPaper with paper, x libPrinting with printing).
//   Monument      at the peace of a war won (gains, conquest or tribute) by a realm of Kingdom tier whose ruler is warlike
//                 (monumentWar), at its capital (monumentPop): monument; begun that year, one per reign.
//   Mausoleum     at the death of the founder of a house (tombFounder) or of a ruler of a long great reign (tombReign years,
//                 ability tombAbility; tombGreat), at the capital of a kingdom (tombPop); begun that year.
//   Baths         a resort at hot springs (SceneryBit.Spring on or beside its cell), bathsPop (baths); a town of springTownPop by
//                 springs, rich (springTown).
//   CouncilHouse  the capital of a league or of an elective state (an elective law, or a league's elected head), held
//                 councilYears, councilPop people (council).
// Lesser (LandmarkRank.Lesser, no events): a Temple of its majority faith for a town of templePop people for templeYears, one
// more per templeStep people up to templeMax (temple); a folk Shrine for a settlement of shrinePop people for shrineYears whose
// majority holds a traditional faith, one (shrine).
// Each work takes buildMin..buildMax years (by kind, drawn at the start). It is given up (Unfinished) if its town is abandoned or
// sacked, or (great ones) the builder's realm ends or loses the town, before it is finished.
// A standing landmark is neglected when its town stays under neglectShare of its peak since completion for neglectYears, or (a
// seat) its town has not been a capital for seatYears; it falls into ruin ruinMin..ruinMax years into its neglect, at once when
// its town is abandoned, and with a chance when it is sacked (sackGreat, sackCastle, sackLesser); a neglected or ruined one in a
// living town is restored (restore; a ruin at ruinRestore of it) when the town is back over restoreShare of the peak and rich, a
// seat a capital again, or a house of worship under a pious ruler. A house of worship is rededicated (Converted) when its town's
// majority (convertShare) follows another faith (convertLesser, convertGreat per scan), and a great one when the state faith of
// the realm holding it changes (convertState). No change within minGap years of the last (sacks and abandonment excepted).
// Building traditions (LandmarkForm): each faith's is fixed when it first appears, from its founding settlement's lands and a
// draw from 'landmarks-faith-<id>' (a schism keeps its parent's with another variant); a great temple or temple of a steepled,
// domed or pagoda tradition begun before its builders hold mathematics takes the early form (ziggurat for a hot dry homeland,
// else columned); shrines are stone circles.
// Every other draw comes from 'history-landmarks', in the order of the events, then of the works in progress, then of the
// settlements by id, then the polities and the landmarks by id: deterministic, and nothing depends on the run's length.

import { Biome, EventType, FaithKind, LandmarkForm, LandmarkKind, LandmarkRank, LandmarkState, PolityOrigin, ReignEnd, SceneryBit, SuccessionLaw, TECH_FIELD_COUNT, TechField, WarOutcome } from '../../../contract.ts'
import { createRng } from '../../rng.ts'
import type { HistoryState } from '../state.ts'
import { Tier, tierOf } from '../polity/state.ts'
import type { PolityState } from '../polity/state.ts'
import { K as SLOTS } from '../religion/state.ts'
import { IDEA_INDEX } from '../ideas/state.ts'
import { LANDMARK } from './params.ts'
import { createLandmarksState, ensureLandmarkPolities, ensureLandmarkSettlements } from './state.ts'
import type { LandmarksState } from './state.ts'

const KD = LandmarkKind, ST = LandmarkState, FM = LandmarkForm
const I_WRITING = IDEA_INDEX.get('writing') ?? -1
const I_PAPER = IDEA_INDEX.get('paper') ?? -1
const I_PRINTING = IDEA_INDEX.get('printing') ?? -1
const I_MATH = IDEA_INDEX.get('mathematics') ?? -1

/** Houses of worship: their form is their faith's building tradition, and they may be rededicated. */
export function isWorship(kind: number): boolean {
  return kind === KD.GreatTemple || kind === KD.Monastery || kind === KD.Temple || kind === KD.Shrine
}
/** In use (finished, restored or rededicated). */
function standing(state: number): boolean {
  return state === ST.InUse || state === ST.Restored || state === ST.Converted
}

// --- Building traditions ------------------------------------------------------------------------------------------

/** True for a hot dry homeland (cell c). */
function hotDry(s: HistoryState, c: number): boolean {
  const w = s.world
  return w.biome[c] === Biome.Desert || (w.temperature[c] > 0.62 && w.rainfall[c] < 0.32)
}

/** The tradition of a faith founded at cell c: weighted forms by its lands, drawn from the faith's own stream. */
function traditionOf(s: HistoryState, c: number, f: number): { form: number; variant: number } {
  const w = s.world
  const rng = createRng(w.seed, `landmarks-faith-${f}`)
  const b = w.biome[c], t = w.temperature[c], e = w.elevation[c]
  let forms: number[], weights: number[]
  if (b === Biome.Mountain || e > 0.45) { forms = [FM.Pagoda, FM.Stupa]; weights = [0.5, 0.5] }
  else if (hotDry(s, c)) { forms = [FM.Ziggurat, FM.Domed]; weights = [0.45, 0.55] }
  else if (b === Biome.Rainforest) { forms = [FM.Pagoda, FM.Stupa, FM.Ziggurat]; weights = [0.35, 0.35, 0.3] }
  else if (b === Biome.Savanna) { forms = [FM.Domed, FM.Stupa, FM.Circle]; weights = [0.4, 0.35, 0.25] }
  else if (b === Biome.Taiga || b === Biome.Tundra || b === Biome.Ice || t < 0.35) { forms = [FM.Stave, FM.Steepled]; weights = [0.55, 0.45] }
  else { forms = [FM.Steepled, FM.Columned, FM.Domed]; weights = [0.4, 0.3, 0.3] }
  let x = rng.next(), form = forms[forms.length - 1]
  for (let i = 0; i < forms.length; i++) { x -= weights[i]; if (x < 0) { form = forms[i]; break } }
  return { form, variant: rng.int(0, 3) }
}

/** Faiths that appeared since the last call get their building tradition (in id order; a schism after its parent). */
function newFaiths(s: HistoryState, lm: LandmarksState): void {
  const rel = s.rel
  if (rel === null) return
  for (let f = lm.faithForm.length; f < rel.kind.length; f++) {
    const par = rel.parent[f]
    const at = rel.foundAt[f]
    const c = at >= 0 && at < s.count ? s.cell[at] : 0
    if (par >= 0 && par < f) {
      const rng = createRng(s.world.seed, `landmarks-faith-${f}`)
      lm.faithForm.push(lm.faithForm[par])
      lm.faithVariant.push((lm.faithVariant[par] + 1 + rng.int(0, 2)) % 4)
      lm.faithHot.push(lm.faithHot[par])
    } else {
      const t = traditionOf(s, c, f)
      lm.faithForm.push(t.form)
      lm.faithVariant.push(t.variant)
      lm.faithHot.push(hotDry(s, c) ? 1 : 0)
    }
  }
}

// --- Helpers ------------------------------------------------------------------------------------------------------

/** True if people p holds idea i (ideas on), else its Crafts level is at least `tech`. */
function holds(s: HistoryState, p: number, i: number, tech: number): boolean {
  const ix = s.ideas
  if (ix !== null) return i >= 0 && ix.held[p * ix.I + i] === 1
  return s.tech[p * TECH_FIELD_COUNT + TechField.Crafts] >= tech
}

/** The settlement whose language polity p names in: its capital if of the ruling people, else its founding capital. */
function langSeat(s: HistoryState, ps: PolityState, p: number): number {
  const c = ps.pCapital[p]
  return s.people[c] === ps.pPeople[p] ? c : ps.pCapIds[p][0]
}

/** Majority faith of living settlement v (-1 without religion). */
function majority(s: HistoryState, v: number): number {
  const rel = s.rel
  if (rel === null || v >= rel.seen || rel.fN[v] === 0) return -1
  return rel.fId[v * SLOTS]
}

function majorityShare(s: HistoryState, v: number): number {
  const rel = s.rel
  if (rel === null || v >= rel.seen || rel.fN[v] === 0) return 0
  return rel.fSh[v * SLOTS]
}

/** The current ruler of polity p (-1). */
function rulerOf(s: HistoryState, p: number): number {
  const R = s.rul
  return R !== null && p >= 0 && p < R.pcap ? R.cur[p] : -1
}

function stateFaith(s: HistoryState, p: number): number {
  const rel = s.rel
  return rel !== null && p >= 0 && p < rel.pcap ? rel.state[p] : -1
}

function capitalOf(s: HistoryState, p: number): number {
  const ps = s.pol
  return ps !== null && p >= 0 && ps.pEnded[p] < 0 ? ps.pCapital[p] : -1
}

/** True if SceneryBit.Spring marks cell c or a neighbour. */
function springNear(s: HistoryState, c: number): boolean {
  const tz = s.tz
  if (tz === null) return false
  const k = tz.sceneryKind
  if (k[c] & SceneryBit.Spring) return true
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  for (let j = off[c]; j < off[c + 1]; j++) if (k[nb[j]] & SceneryBit.Spring) return true
  return false
}

/** True if the town has no great landmark of kind k (begun and not given up). */
function lacks(has: number, k: number): boolean {
  return (has & (1 << k)) === 0
}

/** Records a change of landmark id this year. */
function change(s: HistoryState, lm: LandmarksState, id: number, state: number, faith: number, pol: number, other: number): void {
  lm.cLm.push(id); lm.cYear.push(s.year); lm.cState.push(state); lm.cFaith.push(faith); lm.cPol.push(pol); lm.cOther.push(other)
  lm.lState[id] = state
  lm.lSince[id] = s.year
  if (state === ST.Unfinished && lm.lRank[id] === LandmarkRank.Great) lm.has[lm.lSett[id]] &= ~(1 << lm.lKind[id])
}

/**
 * Begins landmark of `kind` at v this year for polity p (-1 none): `ruler` its ruler (-1: the polity's now), `faith` the faith
 * it is raised for (houses of worship), `seat` 1 for a seat of government. Returns its id.
 */
function begin(s: HistoryState, lm: LandmarksState, v: number, kind: number, p: number, ruler: number, faith: number, subject: number, seat: number): number {
  const id = lm.lKind.length
  const ps = s.pol
  const rank = kind === KD.Temple || kind === KD.Shrine ? LandmarkRank.Lesser : LandmarkRank.Great
  const builders = rank === LandmarkRank.Great && p >= 0 && ps !== null ? ps.pPeople[p] : s.people[v]
  let form = 0, variant = 0
  if (isWorship(kind) && faith >= 0 && faith < lm.faithForm.length) {
    form = kind === KD.Shrine ? FM.Circle : lm.faithForm[faith]
    variant = lm.faithVariant[faith]
    if ((kind === KD.GreatTemple || kind === KD.Temple) && (form === FM.Steepled || form === FM.Domed || form === FM.Pagoda) && !holds(s, builders, I_MATH, 2)) form = lm.faithHot[faith] ? FM.Ziggurat : FM.Columned
  } else variant = lm.rng.int(0, 3)
  if (ruler < 0) ruler = rulerOf(s, p)
  const R = s.rul
  const dyn = ruler >= 0 && R !== null ? R.rDyn[ruler] : -1
  lm.lKind.push(kind); lm.lRank.push(rank); lm.lForm.push(form); lm.lVariant.push(variant); lm.lSett.push(v); lm.lCell.push(s.cell[v]); lm.lBegun.push(s.year); lm.lDone.push(-1)
  lm.lPol.push(p); lm.lRuler.push(ruler); lm.lDyn.push(dyn); lm.lFaith.push(isWorship(kind) ? faith : stateFaith(s, p)); lm.lPeople.push(builders)
  lm.lLang.push(rank === LandmarkRank.Great && p >= 0 && ps !== null ? langSeat(s, ps, p) : v); lm.lSubject.push(subject)
  lm.lState.push(ST.Building); lm.lSince.push(s.year); lm.lCur.push(isWorship(kind) ? faith : -1); lm.lRef.push(s.pop[v]); lm.lLow.push(-1)
  lm.lDue.push(s.year + lm.rng.int(LANDMARK.buildMin[kind], LANDMARK.buildMax[kind])); lm.lSeat.push(seat); lm.lNext.push(-1)
  if (lm.tail[v] >= 0) lm.lNext[lm.tail[v]] = id
  else lm.head[v] = id
  lm.tail[v] = id
  if (rank === LandmarkRank.Great) lm.has[v] |= 1 << kind
  lm.building.push(id)
  change(s, lm, id, ST.Building, -1, p, capitalOf(s, p))
  return id
}

// --- Yearly -------------------------------------------------------------------------------------------------------

function newSettlements(s: HistoryState, lm: LandmarksState): void {
  const n = s.count
  if (lm.seen >= n) return
  ensureLandmarkSettlements(lm, n)
  for (let id = lm.seen; id < n; id++) lm.peak[id] = s.pop[id]
  lm.seen = n
}

/** The events of the year: abandonments, sacks, conquests and sieges, renown, peace, deaths of rulers, state religions. */
function scanEvents(s: HistoryState, lm: LandmarksState): void {
  const ev = s.events
  const ps = s.pol
  const R = s.rul
  const rng = lm.rng
  const X = LANDMARK
  const year = s.year
  for (let i = lm.evSeen; i < ev.length; i++) {
    const e = ev[i]
    switch (e.type) {
      case EventType.Abandoned: {
        const v = e.settlement
        if (v >= lm.seen) break
        for (let id = lm.head[v]; id >= 0; id = lm.lNext[id]) {
          const st = lm.lState[id]
          if (st === ST.Building) change(s, lm, id, ST.Unfinished, -1, -1, -1)
          else if (st !== ST.Ruined && st !== ST.Unfinished) change(s, lm, id, ST.Ruined, -1, -1, -1)
        }
        break
      }
      case EventType.Sacked: {
        const v = e.settlement
        if (v >= lm.seen) break
        const by = e.other >= 0 && ps !== null && e.other < ps.seen ? ps.polity[e.other] : -1
        for (let id = lm.head[v]; id >= 0; id = lm.lNext[id]) {
          const st = lm.lState[id]
          if (st === ST.Building) { change(s, lm, id, ST.Unfinished, -1, by, -1); continue }
          if (st === ST.Ruined || st === ST.Unfinished) continue
          lm.diag.sackRolls++
          const k = lm.lKind[id]
          const chance = lm.lRank[id] === LandmarkRank.Lesser ? X.sackLesser : k === KD.Castle ? X.sackCastle : X.sackGreat
          if (rng.next() < chance) change(s, lm, id, ST.Ruined, -1, by, e.other)
        }
        lm.warYear[v] = year
        break
      }
      case EventType.Conquered: case EventType.SiegeLifted:
        if (e.settlement < lm.seen) lm.warYear[e.settlement] = year
        break
      case EventType.TraditionRenowned:
        if (e.settlement >= 0 && e.settlement < lm.seen) { lm.renowned[e.settlement] = year; lm.renownT[e.settlement] = e.value }
        break
      case EventType.PeaceMade: {
        if (ps === null || R === null) break
        const w = e.value
        const o = ps.wOutcome[w]
        const p = o === WarOutcome.AttackerGains || o === WarOutcome.Conquest || o === WarOutcome.Tribute ? ps.wAtt[w] : o === WarOutcome.DefenderGains ? ps.wDef[w] : -1
        if (p < 0 || ps.pEnded[p] >= 0) break
        ensureLandmarkPolities(lm, ps.P)
        const c = ps.pCapital[p]
        const r = rulerOf(s, p)
        if (r < 0 || R.rWar[r] < X.monumentWar || lm.monuRuler[p] === r || s.abandoned[c] >= 0 || s.pop[c] < X.monumentPop) break
        if (tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop) < Tier.Kingdom) break
        if (rng.next() >= X.monument) break
        lm.monuRuler[p] = r
        begin(s, lm, c, KD.Monument, p, r, -1, -1, 0)
        break
      }
      case EventType.ReignEnded: {
        if (ps === null || R === null) break
        const r = e.value
        const cause = e.extra ?? -1
        if (R.rDied[r] !== year || cause === ReignEnd.Sack || cause === ReignEnd.Overthrown) break
        const p = R.rPolity[r]
        const c = e.settlement
        if (p < 0 || ps.pEnded[p] >= 0 || ps.pCapital[p] !== c || s.abandoned[c] >= 0 || s.pop[c] < X.tombPop) break
        const d = R.rDyn[r]
        const founder = d >= 0 && R.dFounder[d] === r
        const great = year - R.rAcc[r] >= X.tombReign && R.rAbility[r] >= X.tombAbility
        if (!founder && !great) break
        if (tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop) < Tier.Kingdom) break
        if (rng.next() >= (founder ? X.tombFounder : X.tombGreat)) break
        begin(s, lm, c, KD.Mausoleum, p, r, -1, -1, 0)
        break
      }
      case EventType.StateReligion: {
        const old = e.extra ?? -1
        if (ps === null || old < 0) break
        const f = e.value
        const cap = e.settlement
        const p = ps.polity[cap]
        if (p < 0) break
        const n = lm.lKind.length
        for (let id = 0; id < n; id++) {
          const k = lm.lKind[id]
          if ((k !== KD.GreatTemple && k !== KD.Monastery) || !standing(lm.lState[id]) || lm.lCur[id] === f) continue
          const v = lm.lSett[id]
          if (s.abandoned[v] >= 0 || ps.polity[v] !== p) continue
          if (rng.next() >= X.convertState) continue
          lm.lCur[id] = f
          lm.diag.stateConversions++
          change(s, lm, id, ST.Converted, f, p, cap)
        }
        break
      }
    }
  }
  lm.evSeen = ev.length
}

/** Works in progress: given up, or finished when due. */
function works(s: HistoryState, lm: LandmarksState): void {
  const ps = s.pol
  let n = 0
  const list = lm.building
  for (let i = 0; i < list.length; i++) {
    const id = list[i]
    if (lm.lState[id] !== ST.Building) continue
    const v = lm.lSett[id], p = lm.lPol[id]
    if (lm.lRank[id] === LandmarkRank.Great && p >= 0 && ps !== null && (ps.pEnded[p] >= 0 || ps.polity[v] !== p)) {
      change(s, lm, id, ST.Unfinished, -1, ps.pEnded[p] >= 0 ? -1 : ps.polity[v], -1)
      continue
    }
    if (s.year < lm.lDue[id]) { list[n++] = id; continue }
    lm.lDone[id] = s.year
    lm.lRef[id] = s.pop[v]
    change(s, lm, id, ST.InUse, -1, p, capitalOf(s, p))
  }
  list.length = n
}

/** Since when polity p's capital has been its capital. */
function capSince(ps: PolityState, p: number): number {
  const y = ps.pCapYears[p]
  return y[y.length - 1]
}

/** The scan of the towns: new works, then the states of the standing ones. */
function scan(s: HistoryState, lm: LandmarksState): void {
  const X = LANDMARK
  const ps = s.pol, rel = s.rel, R = s.rul, g = s.goods, tz = s.tz
  const rng = lm.rng
  const year = s.year
  const n = s.count
  lm.diag.scans++
  // The world's wealth per head (towns), polities' tiers, holy cities, ocean lanes.
  let sw = 0, sp = 0
  for (let v = 0; v < n; v++) if (s.abandoned[v] < 0 && !s.outpost[v] && s.pop[v] >= 1000) { sw += s.wealth[v]; sp += s.pop[v] }
  lm.worldWpc = sp > 0 ? sw / sp : 0
  const rich = (v: number, mul: number): boolean => s.pop[v] > 0 && s.wealth[v] >= mul * X.richMul * lm.worldWpc * s.pop[v]
  if (ps !== null) {
    ensureLandmarkPolities(lm, ps.P)
    for (const p of ps.alive) { lm.tierP[p] = tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop); lm.monkBest[p] = -1 }
  }
  for (const v of lm.holyList) lm.holyAt[v] = -1
  lm.holyList.length = 0
  if (rel !== null) {
    for (let f = 0; f < rel.kind.length; f++) {
      const h = rel.holy[f]
      if (rel.kind[f] !== FaithKind.Universal || rel.endYear[f] >= 0 || h < 0 || h >= n || s.abandoned[h] >= 0) continue
      if (lm.holyAt[h] < 0) { lm.holyAt[h] = f; lm.holyList.push(h) }
    }
  }
  if (g !== null) {
    const deep = s.terrain.deep
    for (let k = 0; k < g.legCount; k++) {
      if (g.legKind[k] !== 1 || !g.legOpen[k]) continue
      while (lm.legOcean.length <= k) lm.legOcean.push(-1)
      if (lm.legOcean[k] < 0) { let c = 0; const path = g.legPath[k]; for (let j = 0; j < path.length; j++) if (deep[path[j]]) c++; lm.legOcean[k] = c }
      if (lm.legOcean[k] < X.oceanCells) continue
      const a = g.legA[k], b = g.legB[k]
      if (a >= 0 && a < n) lm.laneMark[a] = year
      if (b >= 0 && b < n) lm.laneMark[b] = year
    }
  }

  for (let v = 0; v < n; v++) {
    if (s.abandoned[v] >= 0 || s.outpost[v]) continue
    const pop = s.pop[v]
    if (pop > lm.peak[v]) lm.peak[v] = pop
    const m = majority(s, v)
    if (pop >= X.templePop) { if (lm.bigSince[v] < 0) lm.bigSince[v] = year } else lm.bigSince[v] = -1
    if (pop >= X.shrinePop && m >= 0 && rel !== null && rel.kind[m] === FaithKind.Traditional) { if (lm.shrineSince[v] < 0) lm.shrineSince[v] = year } else lm.shrineSince[v] = -1
    const p = ps !== null ? ps.polity[v] : -1
    const cap = p >= 0 && ps !== null && ps.pCapital[p] === v
    if (cap) lm.lastCap[v] = year
    if (pop < X.bathsPop) continue
    const has = lm.has[v]
    const tier = p >= 0 ? lm.tierP[p] : -1
    const capYears = cap && ps !== null ? year - capSince(ps, p) : -1
    const ruler = rulerOf(s, p)
    const people = p >= 0 && ps !== null ? ps.pPeople[p] : s.people[v]
    // Castle (the guarantee first: no draw).
    if (lacks(has, KD.Castle) && lacks(has, KD.Palace) && cap && capYears >= X.forceYears && pop >= X.forcePop) { lm.diag.forced++; begin(s, lm, v, KD.Castle, p, -1, -1, -1, 1) }
    else if (lacks(has, KD.Castle) && cap && tier >= Tier.Kingdom && capYears >= X.castleYears && pop >= X.castlePop) { if (rng.next() < X.castle) begin(s, lm, v, KD.Castle, p, -1, -1, -1, 1) }
    else if (lacks(has, KD.Castle) && p >= 0 && tier >= Tier.Kingdom && pop >= X.fortPop && year - lm.warYear[v] <= X.fortWindow) { lm.diag.fortTowns++; if (rng.next() < X.fort) begin(s, lm, v, KD.Castle, p, -1, -1, -1, 0) }
    // Palace.
    if (lacks(has, KD.Palace) && cap && tier >= Tier.Kingdom && capYears >= (tier >= Tier.Empire ? X.palaceEmpireYears : X.palaceYears) && pop >= X.palacePop && rich(v, 1)) {
      if (rng.next() < X.palace) begin(s, lm, v, KD.Palace, p, -1, -1, -1, 1)
    }
    // Great temple.
    if (lacks(has, KD.GreatTemple) && rel !== null) {
      let f = -1, chance = 0
      const sf = stateFaith(s, p)
      if (lm.holyAt[v] >= 0 && pop >= X.holyPop) { f = lm.holyAt[v]; chance = X.holy }
      else if (cap && tier >= Tier.Kingdom && sf >= 0 && sf === m && pop >= X.seatTemplePop) { f = sf; chance = X.seatTemple }
      else if (m >= 0 && pop >= X.piousPop && majorityShare(s, v) >= X.piousShare && ruler >= 0 && R !== null && R.rPiety[ruler] >= X.piousRuler && rich(v, 1)) { f = m; chance = X.pious }
      if (f >= 0 && rng.next() < chance) begin(s, lm, v, KD.GreatTemple, p, -1, f, -1, 0)
    }
    // Monastery: the largest eligible town of each realm (judged after the loop).
    if (lacks(has, KD.Monastery) && rel !== null && R !== null && p >= 0 && ps !== null && pop >= X.monkPop && ruler >= 0 && m >= 0 && R.rFaith[ruler] === m && R.rPiety[ruler] >= X.monkPiety && rel.org[m] >= X.monkOrg && lm.monkRuler[p] !== ruler) {
      const b = lm.monkBest[p]
      if (b < 0 || pop > s.pop[b]) lm.monkBest[p] = v
    }
    // Market hall.
    if (lacks(has, KD.MarketHall) && g !== null) {
      if (v < g.isMart.length && g.isMart[v] && pop >= X.martPop && rich(v, 1)) { if (rng.next() < X.mart) begin(s, lm, v, KD.MarketHall, p, -1, -1, -1, 0) }
      else if (pop >= X.hubPop && rich(v, X.hubRich)) { if (rng.next() < X.hub) begin(s, lm, v, KD.MarketHall, p, -1, -1, -1, 0) }
    }
    // Guildhall.
    if (lacks(has, KD.Guildhall) && lm.renowned[v] >= 0 && year - lm.renowned[v] <= X.guildWindow && pop >= X.guildPop) {
      if (rng.next() < X.guild) begin(s, lm, v, KD.Guildhall, p, -1, -1, lm.renownT[v], 0)
    }
    // Lighthouse.
    if (lacks(has, KD.Lighthouse) && s.port[v] >= 0 && lm.laneMark[v] === year && pop >= X.lightPop) {
      if (rng.next() < X.light) begin(s, lm, v, KD.Lighthouse, p, -1, -1, -1, 0)
    }
    // Library.
    if (lacks(has, KD.Library) && pop >= X.libraryPop && rich(v, 1) && holds(s, people, I_WRITING, X.libTech)) {
      const mul = holds(s, people, I_PRINTING, X.libTech + 1) ? X.libPrinting : holds(s, people, I_PAPER, X.libTech + 0.5) ? X.libPaper : 1
      if (rng.next() < X.library * mul) begin(s, lm, v, KD.Library, p, -1, -1, -1, 0)
    }
    // Baths.
    if (lacks(has, KD.Baths) && tz !== null && springNear(s, s.cell[v])) {
      if (v < tz.cap && tz.resort[v]) { if (rng.next() < X.baths) begin(s, lm, v, KD.Baths, p, -1, -1, -1, 0) }
      else if (pop >= X.springTownPop && rich(v, 1)) { if (rng.next() < X.springTown) begin(s, lm, v, KD.Baths, p, -1, -1, -1, 0) }
    }
    // Council house.
    if (lacks(has, KD.CouncilHouse) && cap && ps !== null && capYears >= X.councilYears && pop >= X.councilPop) {
      const elective = ps.pOrigin[p] === PolityOrigin.League || (ruler >= 0 && R !== null && (R.rDyn[ruler] < 0 || R.rLaw[ruler] === SuccessionLaw.Elective))
      if (elective && rng.next() < X.council) begin(s, lm, v, KD.CouncilHouse, p, -1, -1, -1, 1)
    }
    // Lesser: temples and a shrine.
    if (m >= 0) {
      if (lm.bigSince[v] >= 0 && year - lm.bigSince[v] >= X.templeYears) {
        const extra = 1 + Math.floor((pop - X.templePop) / X.templeStep)
        const want = extra < X.templeMax ? extra : X.templeMax
        let have = 0
        for (let id = lm.head[v]; id >= 0; id = lm.lNext[id]) if (lm.lKind[id] === KD.Temple && lm.lState[id] !== ST.Ruined && lm.lState[id] !== ST.Unfinished) have++
        if (have < want && rng.next() < X.temple) begin(s, lm, v, KD.Temple, p, -1, m, -1, 0)
      }
      if (lm.shrineSince[v] >= 0 && year - lm.shrineSince[v] >= X.shrineYears) {
        let have = false
        for (let id = lm.head[v]; id >= 0; id = lm.lNext[id]) if (lm.lKind[id] === KD.Shrine) have = true
        if (!have && rng.next() < X.shrine) begin(s, lm, v, KD.Shrine, p, -1, m, -1, 0)
      }
    }
  }
  // Monasteries: a pious ruler's foundation in the largest eligible town of the realm.
  if (ps !== null && R !== null && rel !== null) {
    for (const p of ps.alive) {
      const v = lm.monkBest[p]
      if (v < 0) continue
      lm.diag.monkChances++
      if (rng.next() >= X.monastery) continue
      const r = rulerOf(s, p)
      lm.monkRuler[p] = r
      begin(s, lm, v, KD.Monastery, p, r, majority(s, v), -1, 0)
    }
  }
  // States of the landmarks.
  const L = lm.lKind.length
  for (let id = 0; id < L; id++) {
    const st = lm.lState[id]
    if (st === ST.Building || st === ST.Unfinished) continue
    const v = lm.lSett[id]
    if (s.abandoned[v] >= 0 || year - lm.lSince[id] < X.minGap) continue
    const pop = s.pop[v]
    const p = ps !== null ? ps.polity[v] : -1
    const kind = lm.lKind[id]
    const worship = isWorship(kind)
    const m = worship ? majority(s, v) : -1
    if (standing(st)) {
      if (pop > lm.lRef[id]) lm.lRef[id] = pop
      if (pop < X.neglectShare * lm.lRef[id]) { if (lm.lLow[id] < 0) lm.lLow[id] = year } else lm.lLow[id] = -1
      const seatLost = lm.lSeat[id] === 1 && year - lm.lastCap[v] >= X.seatYears
      if ((lm.lLow[id] >= 0 && year - lm.lLow[id] >= X.neglectYears) || seatLost) {
        lm.lDue[id] = year + rng.int(X.ruinMin, X.ruinMax)
        change(s, lm, id, ST.Neglected, -1, -1, -1)
        continue
      }
      if (worship && m >= 0 && m !== lm.lCur[id] && majorityShare(s, v) >= X.convertShare) {
        if (rng.next() < (lm.lRank[id] === LandmarkRank.Lesser ? X.convertLesser : X.convertGreat)) {
          lm.lCur[id] = m
          change(s, lm, id, ST.Converted, m, p, capitalOf(s, p))
        }
      }
      continue
    }
    // Neglected or ruined, in a living town: restored, or (neglected long enough) fallen into ruin.
    const cap = p >= 0 && ps !== null && ps.pCapital[p] === v
    const ruler = rulerOf(s, p)
    let can: boolean
    if (lm.lSeat[id] === 1) can = cap
    else {
      can = pop >= X.restoreShare * lm.lRef[id] && rich(v, 1)
      if (!can && worship && ruler >= 0 && R !== null && R.rPiety[ruler] >= X.restorePiety && pop >= X.restorePious * lm.lRef[id]) can = true
    }
    if (can) {
      if (rng.next() < X.restore * (st === ST.Ruined ? X.ruinRestore : 1)) {
        const f = worship ? (m >= 0 ? m : lm.lCur[id]) : -1
        if (worship) lm.lCur[id] = f
        lm.lLow[id] = -1
        if (lm.lSeat[id] === 1) lm.lastCap[v] = year
        change(s, lm, id, ST.Restored, f, p, capitalOf(s, p))
        continue
      }
    }
    if (st === ST.Neglected && year >= lm.lDue[id]) change(s, lm, id, ST.Ruined, -1, -1, -1)
  }
}

/** System (yearly, at the end of the year, after renaming and before the snapshots): see the file comment. */
export function landmarksYear(s: HistoryState, lm: LandmarksState): void {
  newSettlements(s, lm)
  newFaiths(s, lm)
  scanEvents(s, lm)
  works(s, lm)
  if (s.year % LANDMARK.step === 0) scan(s, lm)
}

/** Creates the system at year 0 (after the tribes are founded): the traditional faiths' building traditions. */
export function createLandmarks(s: HistoryState): LandmarksState {
  const lm = createLandmarksState(s)
  newSettlements(s, lm)
  newFaiths(s, lm)
  return lm
}
