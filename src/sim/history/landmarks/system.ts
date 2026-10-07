// landmarks: great buildings and houses of worship raised as a consequence of history. A pure consequence layer: it reads
// the other systems' state at the end of each year (after renaming, index.ts) and changes nothing of theirs; its only
// output is its own table of landmarks and their changes, which assemble.ts names (History.landmarks) and turns into the
// landmark events (great ones only).
//
// Great works (LandmarkRank.Great; at most one of each kind per town, a second only once the first was given up), begun at the
// scans every LANDMARK.step years unless said otherwise, each with its chance per scan (params.ts). Each needs its people (the
// ...Pop minimum) and its town among the world's largest (the ...Rank-th largest living town's people at the scan), so a crowded
// world raises no more of them than a sparse one:
//   Castle        the capital of a realm of Kingdom tier or more, held castleYears, castlePop/castleRank (castle); a frontier fortress:
//                 a town of fortPop/castleRank of such a realm, taken in war or besieged in the last fortWindow years (fort). The
//                 guarantee, without a draw or a rank: any capital held forceYears with forcePop people that has neither castle nor
//                 palace begins one at that scan (the scans fall on the snapshot years, so every city of 10,000 people that has been
//                 a capital for 30 years has a castle or palace begun by then; tested as an invariant).
//   Palace        the capital of a kingdom held palaceYears (an empire's palaceEmpireYears), palacePop/palaceRank, rich.
//   GreatTemple   the holy city of a living universal faith (holyPop/holyRank; holy); the capital of a kingdom whose majority follows
//                 its state faith (seatTemplePop/templeRank; seatTemple); a rich city of piousPop/templeRank whose majority faith
//                 holds piousShare under a ruler of piety piousRuler (pious).
//   Monastery     a pious ruler (piety monkPiety) of a faith of organisation monkOrg founds one (one per reign; monastery) in the
//                 largest town of the realm (monkPop/monkRank) that follows the ruler's faith and has none.
//   MarketHall    a mart of the long-haul trade of martPop/martRank, rich (mart); a city of hubPop/hubRank, hubRich times as rich (hub).
//   Guildhall     the seat of a craft tradition renowned in the last guildWindow years, guildPop/guildRank (guild).
//   Lighthouse    a port at an end of an open long-haul lane over the deep sea (oceanCells), lightPop/lightRank (light).
//   Library       a rich city of libraryPop/libraryRank whose people holds writing (library; x libPaper with paper, x libPrinting
//                 with printing).
//   Monument      at the peace of a war won (a conquest, or monumentTaken towns taken) by a realm of monumentTier whose ruler is
//                 warlike (monumentWar), at its capital (monumentPop/monumentRank): monument; begun that year, one per reign.
//   Mausoleum     at the death of a ruler at the capital (tombPop/tombRank): the founder of a house who reigned tombFounderReign years
//                 over an empire (tombFounder), or a long great reign (tombReign years, ability tombAbility) over a kingdom or more
//                 (tombGreat); begun that year. Not for a ruler slain at the sack of the capital or overthrown.
//   Baths         a resort at hot springs (SceneryBit.Spring on or beside its cell), bathsPop (baths); a town of
//                 springTownPop/springRank by springs, rich (springTown).
//   CouncilHouse  the capital of a league or of an elective state (an elective law, or a league's elected head), held
//                 councilYears, councilPop/councilRank (council).
// Lesser (LandmarkRank.Lesser, no events): a Temple of its majority faith for a town of templePop people for templeYears, one
// more per templeStep people up to templeMax (temple); a folk Shrine for a settlement of shrinePop people for shrineYears whose
// majority holds a traditional faith, one (shrine).
// Each work takes buildMin..buildMax years (by kind, drawn at the start). It is given up (Unfinished) if its town is abandoned or
// sacked, or (great ones) the builder's realm ends or loses the town, before it is finished.
// A standing landmark is neglected when its town stays under neglectShare of its peak since completion for neglectYears, or (a
// seat: a capital's castle, a palace, a council house) its town has not been a capital for seatYears (a castle only if its town
// is also under castleKeep of the peak: else it stands on as a governor's seat); it falls into ruin ruinMin..ruinMax years into its
// neglect, at once when its town is abandoned, and with a chance when it is sacked (sackGreat, sackCastle, sackLesser). A neglected
// or ruined one in a living town is restored (restore; a ruin at ruinRestore of it) when the town is back over restoreShare of the
// peak and rich, a seat a capital again with restoreSeat of the peak, a house of worship under a pious ruler (restorePiety, the
// town at restorePious), a shrine when its town (restoreShare) holds a traditional faith again; the ruins of an abandoned town
// stay ruins (unless a town is refounded on or beside them: Revival below). A house of worship is rededicated (Converted) when its town's majority (convertShare) follows another faith
// (convertLesser, convertGreat per scan; a great one not while its realm's state faith is the one it serves), and a great one
// when the state faith of the realm holding it changes (convertState); a folk shrine whose town took up a universal faith falls
// into neglect instead. No change within minGap years of the last (completion, sacks, abandonment and giving up excepted).
// A conqueror with a state faith rededicates a standing great temple or monastery of another faith in a town it takes
// (convertConquest, at the conquest).
// Crowding: every great work but the capital's guarantee has its chance times clamp(1 - (n - crowdFrom) / (crowdTo - crowdFrom),
// 0, 1), n the great landmarks begun so far in the world (a crowded, long-lived world keeps a few dozen).
// Revival: the ruins of an abandoned town wait for its heir, the first settlement founded on or beside its cell after it was
// given up; once the heir is reviveYears old and has max(revivePop, reviveShare of the old town's peak) people, each ruin is
// restored with chance revive per scan (a great one if the heir has none of its kind, a temple if it has fewer than templeMax;
// shrines stay ruins) and becomes the heir's (History.landmarks.changeSettlement), rededicated to the heir's majority faith.
// Likewise a town rebuilt after the sack that ruined a landmark (refounded, often under a new name) restores the ruin
// reviveYears after the sack once it has max(revivePop, reviveShare of its old peak) people (revive per scan), without the
// wealth an ordinary restoration needs.
// Building traditions (LandmarkForm): each faith's is fixed when it first appears, from its founding settlement's lands
// (traditionOf: mountains, hot dry lands, cold lands, rainforest, savanna, cool and warm temperate forest, grassland) and a draw
// from 'landmarks-faith-<id>' (a universal faith draws no ziggurat or stone circle: those are the folk traditions'; a schism keeps
// its parent's form with another variant, from its own stream); a great temple of a steepled, domed or pagoda tradition begun
// before its builders hold mathematics takes the early form (ziggurat for a hot dry homeland, else columned); a town's temple and
// a monastery take the tradition as it is (a church is a church); shrines are stone circles.
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

/**
 * The tradition of faith f founded at cell c: weighted forms by its lands, drawn from the faith's own stream. A universal faith
 * (the kind that spreads across peoples) does not build ziggurats or stone circles: those are the old folk traditions' (its
 * other weights are scaled up instead).
 */
function traditionOf(s: HistoryState, c: number, f: number, universal: boolean): { form: number; variant: number } {
  const w = s.world
  const rng = createRng(w.seed, `landmarks-faith-${f}`)
  const b = w.biome[c], t = w.temperature[c], e = w.elevation[c]
  let forms: number[], weights: number[]
  if (b === Biome.Mountain || e > 0.2) { forms = [FM.Pagoda, FM.Stupa, FM.Steepled]; weights = [0.45, 0.35, 0.2] }
  else if (hotDry(s, c)) { forms = [FM.Domed, FM.Ziggurat, FM.Steepled, FM.Columned]; weights = [0.45, 0.3, 0.15, 0.1] }
  else if (b === Biome.Taiga || b === Biome.Tundra || b === Biome.Ice || t < 0.45) { forms = [FM.Steepled, FM.Stave]; weights = [0.55, 0.45] }
  else if (b === Biome.Rainforest) { forms = [FM.Pagoda, FM.Stupa, FM.Steepled, FM.Domed, FM.Ziggurat]; weights = [0.3, 0.2, 0.2, 0.15, 0.15] }
  else if (b === Biome.Savanna) { forms = [FM.Domed, FM.Steepled, FM.Stupa, FM.Columned, FM.Circle, FM.Ziggurat]; weights = [0.25, 0.25, 0.15, 0.15, 0.1, 0.1] }
  else if (b === Biome.TemperateForest && t < 0.52) { forms = [FM.Steepled, FM.Stave, FM.Columned]; weights = [0.5, 0.35, 0.15] }
  else if (b === Biome.Grassland) { forms = [FM.Steepled, FM.Domed, FM.Columned, FM.Stupa]; weights = [0.3, 0.3, 0.3, 0.1] }
  else { forms = [FM.Steepled, FM.Domed, FM.Columned]; weights = [0.5, 0.25, 0.25] }
  let sum = 0
  for (let i = 0; i < forms.length; i++) { if (universal && (forms[i] === FM.Ziggurat || forms[i] === FM.Circle)) weights[i] = 0; sum += weights[i] }
  let x = rng.next() * sum, form = forms[0]
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
      const t = traditionOf(s, c, f, rel.kind[f] === FaithKind.Universal)
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

/** People a town needs for a great work: `min`, and to be among the world's `rank` largest towns at the last scan. */
function need(lm: LandmarksState, min: number, rank: number): number {
  const t = lm.top[rank - 1]
  return t > min ? t : min
}

/** The world's crowding factor on the chance of a great work (LANDMARK.crowdFrom, crowdTo; the capital's guarantee aside). */
function crowd(lm: LandmarksState): number {
  const X = LANDMARK
  if (!(X.crowdTo > X.crowdFrom)) return 1
  const x = 1 - (lm.greatN - X.crowdFrom) / (X.crowdTo - X.crowdFrom)
  return x > 1 ? 1 : x < 0 ? 0 : x
}

/**
 * The world's towns at the scan, in one pass: the TOP_TOWNS largest living towns' populations (descending; 0 where there are
 * fewer), and the mean wealth per head of the towns of 1,000 people or more.
 */
function worldTowns(s: HistoryState, lm: LandmarksState): void {
  const top = lm.top
  top.fill(0)
  const K = top.length
  let sw = 0, sp = 0
  for (let v = 0; v < s.count; v++) {
    if (s.abandoned[v] >= 0 || s.outpost[v]) continue
    const x = s.pop[v]
    if (x >= 1000) { sw += s.wealth[v]; sp += x }
    if (x <= top[K - 1]) continue
    let j = K - 1
    while (j > 0 && top[j - 1] < x) { top[j] = top[j - 1]; j-- }
    top[j] = x
  }
  lm.worldWpc = sp > 0 ? sw / sp : 0
}

/** The least population any great work needs at this scan (the forced castle's, or a kind's minimum and rank; resorts aside). */
function greatGate(lm: LandmarksState): number {
  const X = LANDMARK
  let g = X.forcePop
  const pairs = [X.castlePop, X.castleRank, X.fortPop, X.castleRank, X.palacePop, X.palaceRank, X.holyPop, X.holyRank, X.seatTemplePop, X.templeRank, X.piousPop, X.templeRank,
    X.monkPop, X.monkRank, X.martPop, X.martRank, X.hubPop, X.hubRank, X.guildPop, X.guildRank, X.lightPop, X.lightRank, X.libraryPop, X.libraryRank,
    X.springTownPop, X.springRank, X.councilPop, X.councilRank]
  for (let k = 0; k < pairs.length; k += 2) { const x = need(lm, pairs[k], pairs[k + 1]); if (x < g) g = x }
  return g
}

/** True if the town has no great landmark of kind k (begun and not given up). */
function lacks(has: number, k: number): boolean {
  return (has & (1 << k)) === 0
}

/** Records a change of landmark id this year. */
function change(s: HistoryState, lm: LandmarksState, id: number, state: number, faith: number, pol: number, other: number): void {
  lm.cLm.push(id); lm.cYear.push(s.year); lm.cState.push(state); lm.cFaith.push(faith); lm.cPol.push(pol); lm.cOther.push(other); lm.cTown.push(lm.lSett[id])
  lm.lState[id] = state
  lm.lSince[id] = s.year
  if (state === ST.Unfinished && lm.lRank[id] === LandmarkRank.Great) lm.has[lm.lSett[id]] &= ~(1 << lm.lKind[id])
  if (state === ST.Restored) lm.lSack[id] = -1
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
    if (kind === KD.GreatTemple && (form === FM.Steepled || form === FM.Domed || form === FM.Pagoda) && !holds(s, builders, I_MATH, 2)) form = lm.faithHot[faith] ? FM.Ziggurat : FM.Columned
  } else variant = lm.rng.int(0, 3)
  if (ruler < 0) ruler = rulerOf(s, p)
  const R = s.rul
  const dyn = ruler >= 0 && R !== null ? R.rDyn[ruler] : -1
  lm.lKind.push(kind); lm.lRank.push(rank); lm.lForm.push(form); lm.lVariant.push(variant); lm.lSett.push(v); lm.lHome.push(v); lm.lSight.push(0); lm.lSack.push(-1); lm.lCell.push(s.cell[v]); lm.lBegun.push(s.year); lm.lDone.push(-1)
  lm.lPol.push(p); lm.lRuler.push(ruler); lm.lDyn.push(dyn); lm.lFaith.push(isWorship(kind) ? faith : stateFaith(s, p)); lm.lPeople.push(builders)
  lm.lLang.push(rank === LandmarkRank.Great && p >= 0 && ps !== null ? langSeat(s, ps, p) : v); lm.lSubject.push(subject)
  lm.lState.push(ST.Building); lm.lSince.push(s.year); lm.lCur.push(isWorship(kind) ? faith : -1); lm.lRef.push(s.pop[v]); lm.lLow.push(-1)
  lm.lDue.push(s.year + lm.rng.int(LANDMARK.buildMin[kind], LANDMARK.buildMax[kind])); lm.lSeat.push(seat); lm.lSeat0.push(seat); lm.lNext.push(-1)
  if (lm.tail[v] >= 0) lm.lNext[lm.tail[v]] = id
  else lm.head[v] = id
  lm.tail[v] = id
  if (rank === LandmarkRank.Great) { lm.has[v] |= 1 << kind; lm.greatN++ }
  lm.building.push(id)
  change(s, lm, id, ST.Building, -1, p, capitalOf(s, p))
  return id
}

// --- Yearly -------------------------------------------------------------------------------------------------------

function newSettlements(s: HistoryState, lm: LandmarksState): void {
  const n = s.count
  if (lm.seen >= n) return
  ensureLandmarkSettlements(lm, n)
  // A settlement founded on or beside the ruins of an abandoned town with landmarks is its heir (the first one only).
  if (s.year > 0) {
    const { neighborOffsets: off, neighbors: nb } = s.world.grid
    const ruinAt = lm.ruinAt
    for (let v = lm.seen; v < n; v++) {
      if (s.outpost[v] || s.abandoned[v] >= 0) continue
      const c = s.cell[v]
      let u = ruinAt[c]
      for (let k = off[c]; k < off[c + 1] && !(u >= 0 && lm.heir[u] < 0); k++) u = ruinAt[nb[k]]
      if (u >= 0 && u < v && s.abandoned[u] >= 0 && lm.heir[u] < 0) lm.heir[u] = v
    }
  }
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
        if (lm.head[v] >= 0) lm.ruinAt[s.cell[v]] = v // (its ruins wait for a town refounded on or beside them)
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
          if (rng.next() < chance) { change(s, lm, id, ST.Ruined, -1, by, e.other); lm.lSack[id] = year }
        }
        lm.warYear[v] = year
        break
      }
      case EventType.Conquered: {
        const v = e.settlement
        if (v >= lm.seen) break
        lm.warYear[v] = year
        // A conqueror with a state faith rededicates the great houses of worship of another faith in the town it took.
        const p = ps !== null ? ps.polity[v] : -1
        const f = stateFaith(s, p)
        if (f < 0 || s.abandoned[v] >= 0 || !(X.convertConquest > 0)) break
        for (let id = lm.head[v]; id >= 0; id = lm.lNext[id]) {
          const k = lm.lKind[id]
          if ((k !== KD.GreatTemple && k !== KD.Monastery) || !standing(lm.lState[id]) || lm.lCur[id] === f || year - lm.lSince[id] < X.minGap) continue
          if (rng.next() >= X.convertConquest) continue
          lm.lCur[id] = f
          lm.diag.conquestConversions++
          change(s, lm, id, ST.Converted, f, p, capitalOf(s, p))
        }
        break
      }
      case EventType.SiegeLifted:
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
        if (r < 0 || R.rWar[r] < X.monumentWar || lm.monuRuler[p] === r || s.abandoned[c] >= 0 || s.pop[c] < need(lm, X.monumentPop, X.monumentRank) || !lacks(lm.has[c], KD.Monument)) break
        if (o !== WarOutcome.Conquest && ps.wTaken[w] < X.monumentTaken) break
        if (tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop) < X.monumentTier) break
        if (rng.next() >= X.monument * crowd(lm)) break
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
        if (p < 0 || ps.pEnded[p] >= 0 || ps.pCapital[p] !== c || s.abandoned[c] >= 0 || s.pop[c] < need(lm, X.tombPop, X.tombRank) || !lacks(lm.has[c], KD.Mausoleum)) break
        const d = R.rDyn[r]
        const tier = tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop)
        const founder = d >= 0 && R.dFounder[d] === r && year - R.rAcc[r] >= X.tombFounderReign && tier >= Tier.Empire
        const great = year - R.rAcc[r] >= X.tombReign && R.rAbility[r] >= X.tombAbility && tier >= Tier.Kingdom
        if (!founder && !great) break
        if (rng.next() >= (founder ? X.tombFounder : X.tombGreat) * crowd(lm)) break
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
          if ((k !== KD.GreatTemple && k !== KD.Monastery) || !standing(lm.lState[id]) || lm.lCur[id] === f || year - lm.lSince[id] < X.minGap) continue
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
  worldTowns(s, lm)
  const gate = greatGate(lm)
  // Polities' tiers, holy cities, ocean lanes.
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
    const p = ps !== null ? ps.polity[v] : -1
    const cap = p >= 0 && ps !== null && ps.pCapital[p] === v
    if (cap) lm.lastCap[v] = year
    const resort = tz !== null && v < tz.cap && tz.resort[v] === 1
    if (pop < X.minPop && !resort) { lm.bigSince[v] = -1; lm.shrineSince[v] = -1; continue } // (minPop is at most templePop, shrinePop and the great works' minimums)
    const m = majority(s, v)
    if (pop >= X.templePop) { if (lm.bigSince[v] < 0) lm.bigSince[v] = year } else lm.bigSince[v] = -1
    if (pop >= X.shrinePop && m >= 0 && rel !== null && rel.kind[m] === FaithKind.Traditional) { if (lm.shrineSince[v] < 0) lm.shrineSince[v] = year } else lm.shrineSince[v] = -1
    // Great works (none below the scan's gate, the least any of them needs: greatGate; resorts aside, for their baths).
    if (pop >= gate || resort) {
      const has = lm.has[v]
      const tier = p >= 0 ? lm.tierP[p] : -1
      const capYears = cap && ps !== null ? year - capSince(ps, p) : -1
      const ruler = rulerOf(s, p)
      const people = p >= 0 && ps !== null ? ps.pPeople[p] : s.people[v]
      // Castle (the guarantee first: no draw).
      if (lacks(has, KD.Castle) && lacks(has, KD.Palace) && cap && capYears >= X.forceYears && pop >= X.forcePop) { lm.diag.forced++; begin(s, lm, v, KD.Castle, p, -1, -1, -1, 1) }
      else if (lacks(has, KD.Castle) && cap && tier >= Tier.Kingdom && capYears >= X.castleYears && pop >= need(lm, X.castlePop, X.castleRank)) { if (rng.next() < X.castle * crowd(lm)) begin(s, lm, v, KD.Castle, p, -1, -1, -1, 1) }
      else if (lacks(has, KD.Castle) && p >= 0 && tier >= Tier.Kingdom && pop >= need(lm, X.fortPop, X.castleRank) && year - lm.warYear[v] <= X.fortWindow) { lm.diag.fortTowns++; if (rng.next() < X.fort * crowd(lm)) begin(s, lm, v, KD.Castle, p, -1, -1, -1, 0) }
      // Palace.
      if (lacks(has, KD.Palace) && cap && tier >= Tier.Kingdom && capYears >= (tier >= Tier.Empire ? X.palaceEmpireYears : X.palaceYears) && pop >= need(lm, X.palacePop, X.palaceRank) && rich(v, 1)) {
        if (rng.next() < X.palace * crowd(lm)) begin(s, lm, v, KD.Palace, p, -1, -1, -1, 1)
      }
      // Great temple.
      if (lacks(has, KD.GreatTemple) && rel !== null) {
        let f = -1, chance = 0
        const sf = stateFaith(s, p)
        if (lm.holyAt[v] >= 0 && pop >= need(lm, X.holyPop, X.holyRank)) { f = lm.holyAt[v]; chance = X.holy }
        else if (cap && tier >= Tier.Kingdom && sf >= 0 && sf === m && pop >= need(lm, X.seatTemplePop, X.templeRank)) { f = sf; chance = X.seatTemple }
        else if (m >= 0 && pop >= need(lm, X.piousPop, X.templeRank) && majorityShare(s, v) >= X.piousShare && ruler >= 0 && R !== null && R.rPiety[ruler] >= X.piousRuler && rich(v, 1)) { f = m; chance = X.pious }
        if (f >= 0 && rng.next() < chance * crowd(lm)) begin(s, lm, v, KD.GreatTemple, p, -1, f, -1, 0)
      }
      // Monastery: the largest eligible town of each realm (judged after the loop).
      if (lacks(has, KD.Monastery) && rel !== null && R !== null && p >= 0 && ps !== null && pop >= need(lm, X.monkPop, X.monkRank) && ruler >= 0 && m >= 0 && R.rFaith[ruler] === m && R.rPiety[ruler] >= X.monkPiety && rel.org[m] >= X.monkOrg && lm.monkRuler[p] !== ruler) {
        const b = lm.monkBest[p]
        if (b < 0 || pop > s.pop[b]) lm.monkBest[p] = v
      }
      // Market hall.
      if (lacks(has, KD.MarketHall) && g !== null) {
        if (v < g.isMart.length && g.isMart[v] && pop >= need(lm, X.martPop, X.martRank) && rich(v, 1)) { if (rng.next() < X.mart * crowd(lm)) begin(s, lm, v, KD.MarketHall, p, -1, -1, -1, 0) }
        else if (pop >= need(lm, X.hubPop, X.hubRank) && rich(v, X.hubRich)) { if (rng.next() < X.hub * crowd(lm)) begin(s, lm, v, KD.MarketHall, p, -1, -1, -1, 0) }
      }
      // Guildhall.
      if (lacks(has, KD.Guildhall) && lm.renowned[v] >= 0 && year - lm.renowned[v] <= X.guildWindow && pop >= need(lm, X.guildPop, X.guildRank)) {
        if (rng.next() < X.guild * crowd(lm)) begin(s, lm, v, KD.Guildhall, p, -1, -1, lm.renownT[v], 0)
      }
      // Lighthouse.
      if (lacks(has, KD.Lighthouse) && s.port[v] >= 0 && lm.laneMark[v] === year && pop >= need(lm, X.lightPop, X.lightRank)) {
        if (rng.next() < X.light * crowd(lm)) begin(s, lm, v, KD.Lighthouse, p, -1, -1, -1, 0)
      }
      // Library.
      if (lacks(has, KD.Library) && pop >= need(lm, X.libraryPop, X.libraryRank) && rich(v, 1) && holds(s, people, I_WRITING, X.libTech)) {
        const mul = holds(s, people, I_PRINTING, X.libTech + 1) ? X.libPrinting : holds(s, people, I_PAPER, X.libTech + 0.5) ? X.libPaper : 1
        if (rng.next() < X.library * mul * crowd(lm)) begin(s, lm, v, KD.Library, p, -1, -1, -1, 0)
      }
      // Baths.
      if (lacks(has, KD.Baths) && tz !== null && springNear(s, s.cell[v])) {
        if (v < tz.cap && tz.resort[v]) { if (pop >= X.bathsPop && rng.next() < X.baths * crowd(lm)) begin(s, lm, v, KD.Baths, p, -1, -1, -1, 0) }
        else if (pop >= need(lm, X.springTownPop, X.springRank) && rich(v, 1)) { if (rng.next() < X.springTown * crowd(lm)) begin(s, lm, v, KD.Baths, p, -1, -1, -1, 0) }
      }
      // Council house.
      if (lacks(has, KD.CouncilHouse) && cap && ps !== null && capYears >= X.councilYears && pop >= need(lm, X.councilPop, X.councilRank)) {
        const elective = ps.pOrigin[p] === PolityOrigin.League || (ruler >= 0 && R !== null && (R.rDyn[ruler] < 0 || R.rLaw[ruler] === SuccessionLaw.Elective))
        if (elective && rng.next() < X.council * crowd(lm)) begin(s, lm, v, KD.CouncilHouse, p, -1, -1, -1, 1)
      }
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
      if (rng.next() >= X.monastery * crowd(lm)) continue
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
    if (year - lm.lSince[id] < X.minGap) continue
    if (s.abandoned[v] >= 0) { if (st === ST.Ruined && lm.heir[v] >= 0) revive(s, lm, id, v); continue } // (a town grown on or beside the ruins may restore them)
    const pop = s.pop[v]
    const p = ps !== null ? ps.polity[v] : -1
    const kind = lm.lKind[id]
    const worship = isWorship(kind)
    const m = worship ? majority(s, v) : -1
    if (standing(st)) {
      if (pop > lm.lRef[id]) lm.lRef[id] = pop
      if (pop < X.neglectShare * lm.lRef[id]) { if (lm.lLow[id] < 0) lm.lLow[id] = year } else lm.lLow[id] = -1
      // (a castle that was a seat stands on as a governor's or a lord's while its town keeps castleKeep of its peak)
      const seatLost = lm.lSeat[id] === 1 && year - lm.lastCap[v] >= X.seatYears && (kind !== KD.Castle || pop < X.castleKeep * lm.lRef[id])
      if ((lm.lLow[id] >= 0 && year - lm.lLow[id] >= X.neglectYears) || seatLost) {
        lm.lDue[id] = year + rng.int(X.ruinMin, X.ruinMax)
        change(s, lm, id, ST.Neglected, -1, -1, -1)
        continue
      }
      if (worship && m >= 0 && m !== lm.lCur[id] && majorityShare(s, v) >= X.convertShare && (lm.lRank[id] === LandmarkRank.Lesser || stateFaith(s, p) !== lm.lCur[id])) {
        // (a folk shrine whose town has taken up a universal faith falls out of use; a great house of its realm's state faith is kept)
        if (kind === KD.Shrine && rel !== null && rel.kind[m] !== FaithKind.Traditional) {
          if (rng.next() < X.convertLesser) { lm.lDue[id] = year + rng.int(X.ruinMin, X.ruinMax); change(s, lm, id, ST.Neglected, -1, -1, -1) }
        } else if (rng.next() < (lm.lRank[id] === LandmarkRank.Lesser ? X.convertLesser : X.convertGreat)) {
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
    if (lm.lSeat[id] === 1) can = cap && pop >= X.restoreSeat * lm.lRef[id]
    else if (kind === KD.Shrine) can = m >= 0 && rel !== null && rel.kind[m] === FaithKind.Traditional && pop >= X.restoreShare * lm.lRef[id]
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
    } else if (st === ST.Ruined && lm.lSack[id] >= 0 && X.revive > 0 && kind !== KD.Shrine && year - lm.lSack[id] >= X.reviveYears && pop >= X.revivePop && pop >= X.reviveShare * lm.lRef[id]) {
      // A town rebuilt after the sack that ruined it (refounded, often under a new name) restores the ruin once it has grown
      // back enough (Revival: the same rule as an heir's), a seat only as a lord's hall unless it is a capital again.
      if (rng.next() < X.revive) {
        const f = worship ? (m >= 0 ? m : lm.lCur[id]) : -1
        if (worship) lm.lCur[id] = f
        lm.lLow[id] = -1
        lm.lRef[id] = pop
        if (lm.lSeat[id] === 1) { if (cap) lm.lastCap[v] = year; else lm.lSeat[id] = 0 }
        lm.diag.revived++
        change(s, lm, id, ST.Restored, f, p, capitalOf(s, p))
        continue
      }
    }
    if (st === ST.Neglected && year >= lm.lDue[id]) change(s, lm, id, ST.Ruined, -1, -1, -1)
  }
}

/**
 * The ruin `id` of the abandoned town u: its heir (the first settlement founded on or beside u's cell after u was given up),
 * once reviveYears old with max(revivePop, reviveShare of the peak u had) people, restores it with chance revive per scan, if it
 * has no great landmark of the kind (a temple: fewer than templeMax; never a shrine); the landmark becomes the heir's (its
 * change row's town), rededicated to the heir's majority faith (a house of worship), no longer a seat unless the heir is a capital.
 */
function revive(s: HistoryState, lm: LandmarksState, id: number, u: number): void {
  const X = LANDMARK
  const h = lm.heir[u]
  if (!(X.revive > 0) || s.abandoned[h] >= 0 || s.year - s.founded[h] < X.reviveYears) return
  const pop = s.pop[h]
  if (pop < X.revivePop || pop < X.reviveShare * lm.lRef[id]) return
  const kind = lm.lKind[id]
  const great = lm.lRank[id] === LandmarkRank.Great
  if (kind === KD.Shrine) return
  if (great && !lacks(lm.has[h], kind)) return
  if (!great) {
    let have = 0
    for (let k = lm.head[h]; k >= 0; k = lm.lNext[k]) if (lm.lKind[k] === KD.Temple && lm.lState[k] !== ST.Ruined && lm.lState[k] !== ST.Unfinished) have++
    if (have >= X.templeMax) return
  }
  if (lm.rng.next() >= X.revive) return
  // (out of u's list, onto h's)
  let prev = -1
  for (let k = lm.head[u]; k >= 0; prev = k, k = lm.lNext[k]) {
    if (k !== id) continue
    if (prev < 0) lm.head[u] = lm.lNext[k]; else lm.lNext[prev] = lm.lNext[k]
    if (lm.tail[u] === k) lm.tail[u] = prev
    break
  }
  lm.lNext[id] = -1
  if (lm.tail[h] >= 0) lm.lNext[lm.tail[h]] = id
  else lm.head[h] = id
  lm.tail[h] = id
  lm.lSett[id] = h
  if (great) lm.has[h] |= 1 << kind
  const ps = s.pol
  const p = ps !== null ? ps.polity[h] : -1
  const cap = p >= 0 && ps !== null && ps.pCapital[p] === h
  if (lm.lSeat[id] === 1 && !cap) lm.lSeat[id] = 0
  if (cap) lm.lastCap[h] = s.year
  const worship = isWorship(kind)
  const m = worship ? majority(s, h) : -1
  const f = worship ? (m >= 0 ? m : lm.lCur[id]) : -1
  if (worship) lm.lCur[id] = f
  lm.lRef[id] = pop
  lm.lLow[id] = -1
  lm.diag.revived++
  change(s, lm, id, ST.Restored, f, p, capitalOf(s, p))
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
