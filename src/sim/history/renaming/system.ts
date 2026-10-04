// renaming: places renamed as a consequence of history. A pure consequence layer: it reads the other systems' state at
// the end of each year (after religion and the last milestone pass, index.ts) and changes nothing of theirs; its only
// output is the decisions, which assemble.ts turns into names (History.renamings) and PlaceRenamed events.
//
// Each year, from the events of the year (scanned once) and a few short lists:
//   Conquest     a town taken by a state whose ruling people is not the people of its name (and never named it before)
//                is a candidate; if still held without a break holdMin..holdMax years later (drawn at the conquest), it is
//                renamed with chance conquest * importance: adapted to the conquerors' tongue (adapt), named for their
//                ruler or house, or given a new name. Sacked when it fell: refounded under a new or dedicated name
//                (refound). A holy city of another faith taken by a state with a state religion: rededicated (holyTaken).
//   Cession      when the war in which it was taken ends in a treaty (gains, tribute or vassalage), a candidate still held
//                is renamed with chance cede * importance within cedeDelay years (else the slow rule above goes on).
//   Capital      a new capital of a realm of Kingdom tier or more (capital; a seat in a town of another people, foreignSeat),
//                or the capital of a realm that first becomes an empire (imperial), renamed for the ruler, the house, or with
//                a new royal name, within capitalDelay years if it is still the capital and has seatPop people.
//   Faith        a change of state religion (one faith to another): the capital renamed for the new faith (faithCapital),
//                the old faith's holy city in the realm too (faithHoly).
//   Trade        a port (tradePop people) hosting a foreign factory for tradeYears: the traders' name for it sticks (trade).
//   Restored     a renamed town under a state of a people whose earlier name it bore (or stateless among its own people,
//                at stateless times the chance) takes that name back within restoreDelay years, with chance
//                restore * max(0, 1 - years borne / stickYears) (times reimpose when the name is not of the town's own
//                people: reconquerors bringing back the name they gave); a trade name only once the factory is gone.
//   HouseFell    a town named for a ruler or a house, when another house takes that realm's throne: houseFell * stickiness,
//                the previous name back if it is in the rulers' language, else a new one.
//   Revived      a town founded on or beside the ruin of a settlement that once had ruinPeak people (abandoned ruinAge
//                years before) takes the ruin's name with chance revive when it reaches revivePop.
// Importance = clamp((pop - popLow) / (popFull - popLow), 0, 1), times capitalMul for a seat of government (now or before)
// and cityMul for a city. No renaming within MIN_GAP years of the last, except a restoration on liberation.
// Every draw comes from 'history-renaming', in the order of the events and lists (deterministic and prefix-stable).

import { EventType, RenameCause, RenameForm, WarOutcome } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { tierOf, Tier } from '../polity/state.ts'
import { RENAME } from './params.ts'
import { createRenamingState, ensureRenamingPolities, ensureRenamingSettlements, ensureTradeDone, foundingIdent, NO_IDENT, Seat } from './state.ts'
import type { RenamingState } from './state.ts'

const CF_SACKED = 1, CF_TREATY = 2, CF_CEDED = 4
/** Years after a renaming before another (restorations excepted). */
const MIN_GAP = 10

/** New settlements: their founding name, and a ruin they stand on. */
function newSettlements(s: HistoryState, rn: RenamingState): void {
  const n = s.count
  if (rn.seen >= n) return
  ensureRenamingSettlements(rn, n)
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  for (let id = rn.seen; id < n; id++) {
    rn.lang[id] = s.people[id]
    rn.since[id] = s.founded[id]
    rn.rec[id] = -1
    rn.ident[id] = foundingIdent(id)
    rn.peak[id] = s.pop[id]
    if (s.outpost[id] || s.year === 0) continue
    // A ruin of note on its cell or a neighbour (the one that was largest).
    const c = s.cell[id]
    let best = -1
    for (let k = off[c] - 1; k < off[c + 1]; k++) {
      const r = rn.ruinAt[k < off[c] ? c : nb[k]]
      if (r < 0 || r === id || rn.rvTaken[r] || s.abandoned[r] < 0 || s.year - s.abandoned[r] < RENAME.ruinAge) continue
      if (best < 0 || rn.peak[r] > rn.peak[best]) best = r
    }
    if (best >= 0) { rn.rvRuin[id] = best; rn.revive.push(id); rn.diag.ruinsFound++ }
  }
  rn.seen = n
}

/** Importance of settlement v now (see the file comment). */
function importance(s: HistoryState, rn: RenamingState, v: number): number {
  let w = (s.pop[v] - RENAME.popLow) / (RENAME.popFull - RENAME.popLow)
  w = w < 0 ? 0 : w > 1 ? 1 : w
  if (rn.capEver[v]) w *= RENAME.capitalMul
  if (s.pop[v] >= RENAME.cityPop) w *= RENAME.cityMul
  return w
}

/** The settlement whose language polity p names in: its capital if of the ruling people, else its founding capital. */
function langSeat(s: HistoryState, ps: PolityState, p: number): number {
  const c = ps.pCapital[p]
  return s.people[c] === ps.pPeople[p] ? c : ps.pCapIds[p][0]
}

/**
 * The most recent earlier name of v in the language of people x (its identity), other than the one in use; NO_IDENT if none.
 */
function earlierName(s: HistoryState, rn: RenamingState, v: number, x: number): number {
  const cur = rn.ident[v]
  let k = rn.rec[v]
  while (k >= 0) {
    const prev = rn.yPrev[k]
    if (prev < 0) break
    if (rn.yPeople[prev] === x && rn.yIdent[prev] !== cur) return rn.yIdent[prev]
    k = prev
  }
  const f = foundingIdent(v)
  return s.people[v] === x && f !== cur ? f : NO_IDENT
}

/** People of a name identity (a decision's, or a founding name's). */
function identPeople(s: HistoryState, rn: RenamingState, ident: number): number {
  return ident >= 0 ? rn.yPeople[ident] : s.people[-ident - 2]
}

/** True if a name of v was ever given for a faith (a town is rededicated once at most). */
function faithNamed(rn: RenamingState, v: number): boolean {
  for (let k = rn.rec[v]; k >= 0; k = rn.yPrev[k]) if (rn.yForm[k] === RenameForm.Faith) return true
  return false
}

/** The state religion of polity p (-1). */
function stateFaith(s: HistoryState, p: number): number {
  const rel = s.rel
  return rel !== null && p >= 0 && p < rel.pcap ? rel.state[p] : -1
}

/** True while a realm of people a (other than p) of Kingdom tier or more stands: a proud people. */
function ownState(ps: PolityState, a: number, p: number): boolean {
  for (const q of ps.alive) if (q !== p && ps.pPeople[q] === a && tierOf(ps.pPop[q], ps.pMembers[q], ps.pMulti[q] === 1, ps.worldPop) >= Tier.Kingdom) return true
  return false
}

/**
 * Records a renaming of v this year. `people` is the people of the new name, `langAt` the settlement whose language makes it
 * (-1 for a name borne before), `restore` the identity restored (NO_IDENT for a new name).
 */
function rename(s: HistoryState, rn: RenamingState, v: number, cause: number, form: number, p: number, langAt: number, people: number, restore: number, source: number, faith: number): void {
  const k = rn.ySettlement.length
  const ps = s.pol
  const rul = s.rul
  let ruler = -1, dyn = -1
  if (rul !== null && p >= 0 && p < rul.pcap) { ruler = rul.cur[p]; dyn = ruler >= 0 ? rul.rDyn[ruler] : -1 }
  if (form === RenameForm.House && dyn < 0) form = ruler >= 0 ? RenameForm.Ruler : RenameForm.New
  if (form === RenameForm.Ruler && ruler < 0) form = RenameForm.New
  // Kept: the town's own people under a name imposed by foreigners who persecute them, or while a realm of their own stands.
  let kept = -1
  const own = s.people[v]
  if (people !== own && ps !== null && (cause === RenameCause.Conquest || cause === RenameCause.Cession || cause === RenameCause.Capital || cause === RenameCause.Refounded || cause === RenameCause.Faith || cause === RenameCause.Trade)) {
    const rel = s.rel
    const persecuted = rel !== null && p >= 0 && p < rel.pcap && rel.persUntil[p] > s.year
    if (persecuted || ownState(ps, own, p)) kept = own
  }
  rn.ySettlement.push(v)
  rn.yYear.push(s.year)
  rn.yCause.push(cause)
  rn.yForm.push(form)
  rn.yPolity.push(p)
  rn.yRuler.push(ruler)
  rn.yDynasty.push(dyn)
  rn.yFaith.push(faith)
  rn.yLang.push(langAt)
  rn.yPeople.push(people)
  rn.yPrev.push(rn.rec[v])
  rn.yIdent.push(restore !== NO_IDENT ? restore : k)
  rn.yRestore.push(restore)
  rn.ySource.push(source)
  rn.yKept.push(kept)
  rn.yOther.push(source >= 0 ? source : p >= 0 && ps !== null ? ps.pCapital[p] : -1)
  rn.rec[v] = k
  rn.ident[v] = rn.yIdent[k]
  rn.lang[v] = people
  rn.since[v] = s.year
  rn.freed[v] = 0
  rn.rDue[v] = -1
  rn.hfDone[v] = 0
  rn.cDue[v] = -1
  if (!rn.inRenamed[v]) { rn.inRenamed[v] = 1; rn.renamed.push(v) }
}

/** A renaming by polity p of the town v in its rulers' language: the form drawn from shares (adapted, ruler, house; the rest new). */
function renameBy(s: HistoryState, rn: RenamingState, ps: PolityState, v: number, p: number, cause: number, adapt: number, ruler: number, house: number, faith: number): void {
  const u = rn.rng.next()
  const form = u < adapt ? RenameForm.Adapted : u < adapt + ruler ? RenameForm.Ruler : u < adapt + ruler + house ? RenameForm.House : RenameForm.New
  rename(s, rn, v, cause, form, p, langSeat(s, ps, p), ps.pPeople[p], NO_IDENT, -1, faith)
}

/** The events of the year: conquests, sacks, treaties, capitals, state religions, abandonments. */
function scanEvents(s: HistoryState, rn: RenamingState): void {
  const ev = s.events
  const ps = s.pol
  const rng = rn.rng
  const year = s.year
  for (let i = rn.evSeen; i < ev.length; i++) {
    const e = ev[i]
    switch (e.type) {
      case EventType.Abandoned: {
        const v = e.settlement
        if (rn.peak[v] >= RENAME.ruinPeak && !s.outpost[v]) rn.ruinAt[s.cell[v]] = v
        break
      }
      case EventType.PolityFounded: rn.capEver[e.settlement] = 1; break
      case EventType.CapitalMoved: {
        const v = e.settlement
        rn.capEver[v] = 1
        if (ps === null) break
        rn.sId.push(v); rn.sPol.push(e.value); rn.sDue.push(year + 1 + Math.floor(rng.next() * RENAME.capitalDelay)); rn.sKind.push(Seat.Moved); rn.sFaith.push(-1)
        break
      }
      case EventType.Conquered: {
        const v = e.settlement
        if (ps === null || s.abandoned[v] >= 0) break
        const p = ps.polity[v]
        if (p < 0) break
        const x = ps.pPeople[p]
        // (taken by the people of its name, or by one whose name it once bore: the restoration rule's business)
        if (x === rn.lang[v] || earlierName(s, rn, v, x) !== NO_IDENT) { rn.cDue[v] = -1; break }
        rn.cDue[v] = year + RENAME.holdMin + Math.floor(rng.next() * (RENAME.holdMax - RENAME.holdMin + 1))
        rn.cPol[v] = p
        rn.cYear[v] = year
        rn.cWar[v] = e.value
        rn.cFlags[v] = 0
        rn.cHoly[v] = -1
        rn.diag.conquests++
        if (!rn.inPend[v]) { rn.inPend[v] = 1; rn.pend.push(v) }
        break
      }
      case EventType.Sacked: {
        const v = e.settlement
        if (rn.cDue[v] >= 0 && rn.cYear[v] === year) rn.cFlags[v] |= CF_SACKED
        break
      }
      case EventType.HolyCityFell: {
        const v = e.settlement
        if (rn.cDue[v] >= 0 && rn.cYear[v] === year) rn.cHoly[v] = e.value
        break
      }
      case EventType.PeaceMade: {
        if (ps === null) break
        const w = e.value
        const o = ps.wOutcome[w]
        if (o !== WarOutcome.AttackerGains && o !== WarOutcome.DefenderGains && o !== WarOutcome.Tribute && o !== WarOutcome.Vassalage) break
        for (const v of rn.pend) {
          if (rn.cDue[v] < 0 || rn.cWar[v] !== w || (rn.cFlags[v] & CF_TREATY) !== 0) continue
          rn.cFlags[v] |= CF_TREATY
          const p = rn.cPol[v]
          if (s.abandoned[v] >= 0 || ps.polity[v] !== p || ps.joined[v] !== rn.cYear[v]) continue
          rn.diag.treaties++
          if (rng.next() < RENAME.cede * importance(s, rn, v)) {
            rn.cFlags[v] |= CF_CEDED
            rn.cDue[v] = year + 1 + Math.floor(rng.next() * RENAME.cedeDelay)
          }
        }
        break
      }
      case EventType.StateReligion: {
        const old = e.extra ?? -1
        const rel = s.rel
        if (ps === null || rel === null || old < 0) break
        const cap = e.settlement
        const p = ps.polity[cap]
        if (p < 0) break
        rn.sId.push(cap); rn.sPol.push(p); rn.sDue.push(year + 1 + Math.floor(rng.next() * RENAME.faithDelay)); rn.sKind.push(Seat.FaithCapital); rn.sFaith.push(e.value)
        const h = rel.holy[old]
        if (h >= 0 && h !== cap && h < s.count && s.abandoned[h] < 0 && ps.polity[h] === p) {
          rn.sId.push(h); rn.sPol.push(p); rn.sDue.push(year + 1 + Math.floor(rng.next() * RENAME.faithDelay)); rn.sKind.push(Seat.FaithHoly); rn.sFaith.push(e.value)
        }
        break
      }
    }
  }
  rn.evSeen = ev.length
}

/** Conquest and cession candidates that came due. */
function conquests(s: HistoryState, rn: RenamingState, ps: PolityState): void {
  const year = s.year
  const rng = rn.rng
  let n = 0
  const list = rn.pend
  for (let i = 0; i < list.length; i++) {
    const v = list[i]
    if (rn.cDue[v] < 0 || s.abandoned[v] >= 0) { rn.cDue[v] = -1; rn.inPend[v] = 0; continue }
    if (rn.cDue[v] > year) { list[n++] = v; continue }
    rn.cDue[v] = -1
    rn.inPend[v] = 0
    const p = rn.cPol[v]
    if (ps.polity[v] !== p || ps.joined[v] !== rn.cYear[v] || ps.pEnded[p] >= 0 || ps.pPeople[p] === rn.lang[v]) continue
    if (year - rn.since[v] < MIN_GAP && rn.rec[v] >= 0) continue
    rn.diag.judged++
    const imp = importance(s, rn, v)
    const X = RENAME
    if ((rn.cFlags[v] & CF_CEDED) !== 0) { renameBy(s, rn, ps, v, p, RenameCause.Cession, X.cedeAdapt, X.cedeRuler, 0, -1); continue }
    const u = rng.next()
    if ((rn.cFlags[v] & CF_SACKED) !== 0) {
      if (u < X.refound * imp) renameBy(s, rn, ps, v, p, RenameCause.Refounded, 0, 0.35, 0.15, -1)
      continue
    }
    if (u >= X.conquest * imp) continue
    const sf = stateFaith(s, p)
    if (rn.cHoly[v] >= 0 && sf >= 0 && sf !== rn.cHoly[v] && !faithNamed(rn, v) && rng.next() < X.holyTaken) {
      rename(s, rn, v, RenameCause.Faith, RenameForm.Faith, p, langSeat(s, ps, p), ps.pPeople[p], NO_IDENT, -1, sf)
      continue
    }
    renameBy(s, rn, ps, v, p, RenameCause.Conquest, X.adapt, X.ruler, X.house, -1)
  }
  list.length = n
}

/** Seat candidates (new capitals, imperial seats, faith rededications) that came due. */
function seats(s: HistoryState, rn: RenamingState, ps: PolityState): void {
  const year = s.year
  const rng = rn.rng
  const X = RENAME
  let n = 0
  for (let i = 0; i < rn.sId.length; i++) {
    const v = rn.sId[i], p = rn.sPol[i], kind = rn.sKind[i], f = rn.sFaith[i]
    if (rn.sDue[i] > year) {
      rn.sId[n] = v; rn.sPol[n] = p; rn.sDue[n] = rn.sDue[i]; rn.sKind[n] = kind; rn.sFaith[n] = f
      n++
      continue
    }
    if (s.abandoned[v] >= 0 || ps.pEnded[p] >= 0 || ps.polity[v] !== p) continue
    if (rn.rec[v] >= 0 && year - rn.since[v] < MIN_GAP) continue
    const capital = ps.pCapital[p] === v
    const big = tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop) >= Tier.Kingdom
    rn.diag.seats++
    if (kind === Seat.Moved || kind === Seat.Imperial) {
      if (!capital || (kind === Seat.Moved && !big) || s.pop[v] < X.seatPop) continue
      const chance = kind === Seat.Imperial ? X.imperial : rn.lang[v] !== ps.pPeople[p] ? X.foreignSeat : X.capital
      if (rng.next() >= chance) continue
      if (rn.lang[v] !== ps.pPeople[p] && earlierName(s, rn, v, ps.pPeople[p]) !== NO_IDENT) continue // (the restoration rule's business)
      const withRulers = s.rul !== null
      renameBy(s, rn, ps, v, p, RenameCause.Capital, 0, withRulers ? X.capRuler : 0, withRulers ? X.capHouse : 0, -1)
    } else {
      if (stateFaith(s, p) !== f || (kind === Seat.FaithCapital && (!capital || !big)) || faithNamed(rn, v)) continue
      if (rng.next() >= (kind === Seat.FaithCapital ? X.faithCapital : X.faithHoly)) continue
      rename(s, rn, v, RenameCause.Faith, RenameForm.Faith, p, langSeat(s, ps, p), ps.pPeople[p], NO_IDENT, -1, f)
    }
  }
  rn.sId.length = n; rn.sPol.length = n; rn.sDue.length = n; rn.sKind.length = n; rn.sFaith.length = n
}

/** Realms that first became empires: their capitals are candidates (Seat.Imperial). */
function empires(s: HistoryState, rn: RenamingState, ps: PolityState): void {
  ensureRenamingPolities(rn, ps.P)
  for (const p of ps.alive) {
    if (rn.empire[p]) continue
    if (tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop) < Tier.Empire) continue
    rn.empire[p] = 1
    rn.sId.push(ps.pCapital[p]); rn.sPol.push(p); rn.sDue.push(s.year + 1 + Math.floor(rn.rng.next() * RENAME.capitalDelay)); rn.sKind.push(Seat.Imperial); rn.sFaith.push(-1)
  }
}

/** Renamed towns: liberation (restoration) and the fall of an honoured house. */
function restorations(s: HistoryState, rn: RenamingState): void {
  const ps = s.pol
  const rul = s.rul
  const g = s.goods
  const year = s.year
  const rng = rn.rng
  const X = RENAME
  let n = 0
  const list = rn.renamed
  for (let i = 0; i < list.length; i++) {
    const v = list[i]
    if (s.abandoned[v] >= 0) { rn.inRenamed[v] = 0; continue }
    list[n++] = v
    const p = ps !== null ? ps.polity[v] : -1
    const holder = p >= 0 && ps !== null ? ps.pPeople[p] : s.people[v]
    const k = rn.rec[v]
    const age = year - rn.since[v]
    const stick = age >= X.stickYears ? 0 : 1 - age / X.stickYears
    // Liberation: edge-triggered, one roll per spell.
    let target = holder !== rn.lang[v] ? earlierName(s, rn, v, holder) : NO_IDENT
    if (target !== NO_IDENT && k >= 0 && rn.yCause[k] === RenameCause.Trade && g !== null && v < g.factoryAt.length && g.factoryAt[v] >= 0) target = NO_IDENT // (while the traders stay)
    if (target === NO_IDENT) { rn.freed[v] = 0; rn.rDue[v] = -1 }
    else if (!rn.freed[v]) {
      rn.freed[v] = 1
      rn.diag.liberations++
      if (rng.next() < X.restore * stick * (p < 0 ? X.stateless : 1) * (holder !== s.people[v] ? X.reimpose : 1)) { rn.rDue[v] = year + Math.floor(rng.next() * (X.restoreDelay + 1)); rn.rIdent[v] = target; rn.rPol[v] = p }
    }
    if (target !== NO_IDENT && rn.rDue[v] >= 0 && rn.rDue[v] <= year) {
      const t = earlierName(s, rn, v, holder)
      rename(s, rn, v, RenameCause.Restored, RenameForm.Restored, p, -1, holder, t, -1, -1)
      continue
    }
    // The honoured house lost the throne of the realm that named the town for it.
    if (rul === null || ps === null || k < 0 || rn.hfDone[v]) continue
    const f = rn.yForm[k]
    if (f !== RenameForm.Ruler && f !== RenameForm.House) continue
    const q = rn.yPolity[k]
    if (q < 0 || p !== q || q >= rul.pcap) continue
    const cur = rul.cur[q]
    if (cur < 0 || rul.rDyn[cur] === rn.yDynasty[k] || rn.yDynasty[k] < 0) continue
    rn.hfDone[v] = 1
    rn.diag.houseFalls++
    if (year - rn.since[v] < MIN_GAP || rng.next() >= X.houseFell * stick) continue
    const prev = rn.yPrev[k]
    const prevIdent = prev >= 0 ? rn.yIdent[prev] : foundingIdent(v)
    if (identPeople(s, rn, prevIdent) === holder) rename(s, rn, v, RenameCause.HouseFell, RenameForm.Restored, q, -1, holder, prevIdent, -1, -1)
    else rename(s, rn, v, RenameCause.HouseFell, RenameForm.New, q, langSeat(s, ps, q), holder, NO_IDENT, -1, -1)
  }
  list.length = n
}

/** Newcomers on ruins that grew: the ruin's name revived. */
function revivals(s: HistoryState, rn: RenamingState): void {
  let n = 0
  const list = rn.revive
  for (let i = 0; i < list.length; i++) {
    const v = list[i]
    const r = rn.rvRuin[v]
    if (s.abandoned[v] >= 0 || rn.rvTaken[r] || rn.rec[v] >= 0) continue
    if (s.pop[v] < RENAME.revivePop) { list[n++] = v; continue }
    if (rn.rng.next() >= RENAME.revive) continue
    rn.rvTaken[r] = 1
    const p = s.pol !== null ? s.pol.polity[v] : -1
    rename(s, rn, v, RenameCause.Revived, RenameForm.Revived, p, -1, rn.lang[r], rn.ident[r], r, -1)
  }
  list.length = n
}

/** Ports hosting a foreign factory for generations: the traders' name may stick. */
function tradeNames(s: HistoryState, rn: RenamingState): void {
  const g = s.goods
  if (g === null) return
  ensureTradeDone(rn, g.postCount)
  const year = s.year
  for (let i = 0; i < g.postCount; i++) {
    if (rn.tradeDone[i] || g.pKind[i] !== 0 || g.pEnded[i] >= 0 || year - g.pFounded[i] < RENAME.tradeYears) continue
    const h = g.pHost[i], o = g.pOwner[i]
    if (h < 0 || s.abandoned[h] >= 0 || s.port[h] < 0 || s.pop[h] < RENAME.tradePop || s.people[o] === rn.lang[h]) continue
    if (rn.rec[h] >= 0 && year - rn.since[h] < MIN_GAP) continue
    rn.tradeDone[i] = 1
    rn.diag.factoriesJudged++
    if (rn.rng.next() >= RENAME.trade) continue
    const p = s.pol !== null ? s.pol.polity[o] : -1
    rename(s, rn, h, RenameCause.Trade, RenameForm.Adapted, p, o, s.people[o], NO_IDENT, -1, -1)
  }
}

/** System (yearly, at the end of the year, before the snapshots): see the file comment. */
export function renamingYear(s: HistoryState, rn: RenamingState): void {
  newSettlements(s, rn)
  const living = s.living
  for (let t = 0; t < living.length; t++) { const id = living[t]; if (s.pop[id] > rn.peak[id]) rn.peak[id] = s.pop[id] }
  scanEvents(s, rn)
  const ps = s.pol
  if (ps !== null) {
    if (s.year % RENAME.empireStep === 0) empires(s, rn, ps)
    conquests(s, rn, ps)
    seats(s, rn, ps)
  }
  restorations(s, rn)
  revivals(s, rn)
  if (s.year % RENAME.tradeStep === 0) tradeNames(s, rn)
}

/** Creates the system at year 0 (after the tribes are founded); the first year's scan reads the events from the start. */
export function createRenaming(s: HistoryState): RenamingState {
  const rn = createRenamingState(s)
  newSettlements(s, rn)
  return rn
}
