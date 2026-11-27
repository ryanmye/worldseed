// governments: forms of government and the birth of city-states (city-states.md §4-§6). Every polity has a form (Monarchy,
// Republic, FreeCity, Signoria, Theocracy, Confederation, League) that changes with wealth, force and need; the changes are
// rows of History.governments.
//
// Order (polity/system.ts): govNewPolity in newPolity just before the rulers hook (govAfterRuler right after it); every
// POLITY.step govStep after realmStep and before bondStep (so a new Charter bond is first checked at the next step), with the
// Charter branch of bondStep (govCharterBond); every slowStep govSlow right after leagues() and before accretion() (a new
// republic can take stateless villages in the same slow step). Rulers call govAtSuccession (in succession, before an heir is
// chosen) and govTermEnded (an elected head's term ran out).
//
// Determinism: one stream, 'history-government' (created only when on). Gates never draw: one draw per gated candidate, plus
// one for a rising's outcome and one for a signoria's cause. Consequences call the rulers' functions (R.rng) and newPolity
// (ps.rng), which is allowed: with the system on the history may differ. With the system off s.gov is null and nothing here
// runs.

import { BondEnd, BondKind, EventType, Government, GovernmentCause, PolityOrigin, ReignEnd, RevoltCause, TOWN_POPULATION, FaithKind } from '../../../contract.ts'
import type { EventType as EventTypeT } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from '../polity/state.ts'
import { FAR, Tier, clampAsab, grainShare, horseOf, inCrisis, localOf, newPolity, projAt, setPolity, tierOf } from '../polity/state.ts'
import { COHESION, LEAGUE, POLITY, RELATION, UNREST } from '../polity/params.ts'
import { controlOne } from '../polity/control.ts'
import { ensureRelation } from '../polity/relations.ts'
import { absorbVassal, charterBond, distAcross, endBond } from '../polity/bonds.ts'
import type { RulerState } from '../rulers/state.ts'
import { RULERS } from '../rulers/params.ts'
import { pickHeir } from '../rulers/hazards.ts'
import { abolishThrone, secularThrone, seizeSignoria } from '../rulers/system.ts'
import { majorityOf, polityFaith } from '../religion/system.ts'
import { merchantPay } from '../goods/merchants.ts'
import { finCredit, finSpend } from '../finance/hooks.ts'
import { FAMILY } from '../families/params.ts'
import { familyInfluence, topFamilyAt } from '../families/api.ts'
import { CITY, GOV, electedForm } from './params.ts'
import type { GovState } from './state.ts'
import { ensureGovPolities } from './state.ts'
import { distantOf, forceOf, mHead, mercOf, needOf, revRatio, suppressOf, tradeOf, wealthAll } from './econ.ts'

function logX(s: HistoryState, type: EventTypeT, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

/** The capital's leading merchant family (a pure label: last year's families; -1 when families are off). */
function famLabel(s: HistoryState, town: number): number {
  return s.goods !== null && s.goods.ext.fam !== null ? topFamilyAt(s, town) : -1
}

/** famTop_c: the leading family's influence at the capital, with families feedback only (§9.3 amendment 1); else 0. */
function famTop(s: HistoryState, town: number): number {
  if (!FAMILY.feedback || s.goods === null || s.goods.ext.fam === null) return 0
  const f = topFamilyAt(s, town)
  return f >= 0 ? familyInfluence(s, f, town) : 0
}

/** Pushes a change row for p (the only writer of G.form): form, cause, the story's settlement, the reign begun with it, the family. */
export function setForm(s: HistoryState, G: GovState, p: number, form: number, cause: number, settlement: number, ruler = -1, family = -1): number {
  ensureGovPolities(G, p + 1)
  const k = G.gPolity.length
  G.gPolity.push(p); G.gYear.push(s.year); G.gForm.push(form); G.gCause.push(cause); G.gRuler.push(ruler); G.gSettlement.push(settlement); G.gFamily.push(family)
  G.form[p] = form
  G.since[p] = s.year
  G.last[p] = k
  G.lone[p] = -1
  if (form !== Government.Signoria && form !== Government.Theocracy) G.house[p] = -1
  return k
}

/** True when p's form changed this year after its founding row (a form changes at most once a year). */
function changedNow(s: HistoryState, G: GovState, p: number): boolean {
  return G.since[p] === s.year
}

// --- Founding -------------------------------------------------------------------------------------------------

/** newPolity hook (before the rulers hook): p's founding form (§4.2). */
export function govNewPolity(s: HistoryState, ps: PolityState, G: GovState, p: number): void {
  ensureGovPolities(G, p + 1)
  const origin = ps.pOrigin[p], c = ps.pCapital[p], par = ps.pParent[p]
  let form: number, cause: number = GovernmentCause.Founded
  if (G.ctxForm >= 0) { form = G.ctxForm; cause = G.ctxCause }
  else if (origin === PolityOrigin.League) form = Government.League
  else if ((origin === PolityOrigin.Formed || origin === PolityOrigin.Revolt || origin === PolityOrigin.Fragment) && s.liveFrac[c] >= CITY.herdFrac && horseOf(s, c) === 1) form = Government.Confederation
  else if ((origin === PolityOrigin.Partition || origin === PolityOrigin.CivilWar) && par >= 0) {
    const f = G.form[par]
    form = f === Government.Monarchy || f === Government.Confederation || f === Government.Signoria ? f : Government.Monarchy
  } else form = Government.Monarchy
  const fam = G.ctxFamily
  G.ctxForm = -1; G.ctxCause = -1; G.ctxFamily = -1
  if (form === Government.Confederation) G.diag.confederations++
  setForm(s, G, p, form, cause, G.ctxSettlement >= 0 ? G.ctxSettlement : c, -1, fam)
  G.ctxSettlement = -1
  G.since[p] = s.year
}

/** newPolity hook (right after the rulers hook): the first reign of p's founding row, and the head's family label. */
export function govAfterRuler(s: HistoryState, G: GovState, p: number): void {
  const k = G.last[p]
  if (k < 0) return
  const R = s.rul
  if (R !== null && p < R.pcap) G.gRuler[k] = R.cur[p]
  if (G.gFamily[k] < 0 && electedForm(G.gForm[k]) && G.gForm[k] !== Government.Theocracy) G.gFamily[k] = famLabel(s, G.gSettlement[k])
}

/**
 * Makes town i (a member of p, or stateless when p is -1) a state of form `form` with its contado: the small villages around it
 * that are nearer it than their capital (§4.4 cityState). Returns the new polity.
 */
export function cityState(s: HistoryState, ps: PolityState, G: GovState, i: number, p: number, form: number, cause: number, family = -1): number {
  const contado: number[] = [], cost: number[] = []
  const nb = ps.gNb[i], co = ps.gCost[i]
  const cap = p >= 0 ? ps.pCapital[p] : -1
  if (nb) {
    for (let k = 0; k < nb.length; k++) {
      const j = nb[k]
      if (j === cap || ps.polity[j] !== p || s.abandoned[j] >= 0 || s.outpost[j]) continue
      if (s.pop[j] > CITY.contado * s.pop[i] || s.pop[j] >= TOWN_POPULATION) continue
      if (p >= 0 && !(co[k] < ps.dist[j])) continue
      if (contado.indexOf(j) >= 0) continue
      contado.push(j); cost.push(co[k])
    }
  }
  // (id order)
  const ord = contado.map((_, k) => k).sort((a, b) => contado[a] - contado[b])
  for (const k of ord) setPolity(s, ps, contado[k], -1, FAR)
  G.ctxForm = form; G.ctxCause = cause; G.ctxSettlement = i; G.ctxFamily = family
  const q = newPolity(s, ps, i, form === Government.FreeCity ? PolityOrigin.Charter : PolityOrigin.CityState, p)
  for (const k of ord) setPolity(s, ps, contado[k], q, cost[k])
  ps.asab[i] = clampAsab(ps.asab[i] + POLITY.foundAsab); ps.unrest[i] = 0
  for (const k of ord) { const j = contado[k]; ps.asab[j] = clampAsab(ps.asab[j] + POLITY.foundAsab); ps.unrest[j] = 0 }
  controlOne(s, ps, q, ps.heap)
  if (p >= 0 && ps.pEnded[p] < 0) controlOne(s, ps, p, ps.heap)
  return q
}

// --- Every step: charters and risings, free cities without overlords, republics -----------------------------------

/** Rising outcome draw and its consequences at town i of p (shared by burghers and a holy city's clergy). Returns the new polity or -1. */
function rising(s: HistoryState, ps: PolityState, G: GovState, i: number, p: number, F: number, S: number, form: number, cause: number, revoltCause: number): number {
  const c = ps.pCapital[p]
  ps.rose[i] = s.year
  logEvent6(s, EventType.Revolt, i, c, revoltCause)
  ps.diag.revolts++
  G.diag.risings++
  const win = G.rng.next() < (F * F) / (F * F + S * S + 1e-12)
  if (!win) {
    s.pop[i] *= 1 - UNREST.crushPop
    s.wealth[i] *= 1 - UNREST.crushWealth
    const g = s.goods
    if (g !== null && i < g.ext.merch.cap) g.ext.merch.mw[i] *= 1 - CITY.crushMerch
    ps.unrest[i] = UNREST.crushAfter
    ps.asab[i] = clampAsab(ps.asab[i] + COHESION.crushed)
    ps.pExh[p] += UNREST.crushExhaust
    logX(s, EventType.RevoltCrushed, i, c, 1, 0)
    G.diag.risingsCrushed++
    return -1
  }
  ps.diag.revoltsWon++
  const q = cityState(s, ps, G, i, p, form, cause)
  if (ps.pEnded[p] < 0) {
    const r = ensureRelation(ps, p, q)
    ps.relR[r] = RELATION.secedeR
    ps.relTruce[r] = s.year + RELATION.truceSecede
  }
  return q
}

function logEvent6(s: HistoryState, type: EventTypeT, settlement: number, other: number, value: number): void {
  s.events.push({ year: s.year, type, settlement, other, value })
}

/**
 * The burghers' rising draw (R10): with riots on (s.up, not on this tree yet) a hit would add a Commune trigger at the town and
 * riots would resolve it through govRisingResolve. Exported for riots: resolves a rising of town i against p now.
 */
export function govRisingResolve(s: HistoryState, ps: PolityState, G: GovState, i: number, p: number): number {
  const F = forceOf(s, ps, i), S = suppressOf(s, ps, i, p)
  const q = rising(s, ps, G, i, p, F, S, Government.Republic, GovernmentCause.Rising, RevoltCause.Burghers)
  if (q >= 0) logX(s, EventType.CommuneProclaimed, i, ps.pCapital[p], q, 0)
  return q
}

/** System part (every POLITY.step, after realmStep and before bondStep). */
export function govStep(s: HistoryState, ps: PolityState, G: GovState): void {
  ensureGovPolities(G, ps.P)
  const year = s.year
  const step = POLITY.step
  // T_x: the through-traffic of each polity's port members (the trade-rival measure, govCompete).
  for (const p of ps.alive) G.trade[p] = 0
  for (const i of s.living) { const p = ps.polity[i]; if (p >= 0 && s.port[i] >= 0) G.trade[p] += s.through[i] }
  // A free city whose charter bond is gone (its overlord ended, or the bond passed away) stands alone as a republic.
  for (const p of ps.alive.slice()) {
    if (G.form[p] !== Government.FreeCity) continue
    const k = ps.pSub[p]
    if (k >= 0 && ps.bKind[k] === BondKind.Charter && ps.bEnd[k] < 0) continue
    setForm(s, G, p, Government.Republic, GovernmentCause.Freed, ps.pCapital[p], -1, famLabel(s, ps.pCapital[p]))
    G.diag.freed++
    logX(s, EventType.CommuneProclaimed, ps.pCapital[p], -1, p, 2)
  }
  // Member towns: charters and risings (s.living order; the gates draw nothing; one act per polity per step).
  const living = s.living.slice()
  for (let t = 0; t < living.length; t++) {
    const i = living[t]
    const p = ps.polity[i]
    if (p < 0 || ps.pEnded[p] >= 0 || ps.pCapital[p] === i || s.outpost[i] || s.abandoned[i] >= 0 || ps.rose[i] === year) continue
    const form = G.form[p]
    if (form === Government.FreeCity || form === Government.League || G.acted[p] === year) continue
    if (s.pop[i] < CITY.minPop || year - ps.joined[i] < CITY.settle) continue
    const m = mHead(s, i)
    if (m < CITY.mHead) continue
    const rho = revRatio(s, ps, i, p)
    if (rho < CITY.rich0) continue
    const tr = tradeOf(s, i)
    if (!(tr > 0)) continue
    const omega = smoothstep(CITY.rich0, CITY.rich1, rho) * tr * smoothstep(CITY.mHead, CITY.mHead1, m)
    const F = forceOf(s, ps, i), S = suppressOf(s, ps, i, p)
    const phi = F / (S + 1e-9)
    const need = needOf(s, ps, p)
    const delta = distantOf(ps, i, p, phi)
    if (phi >= CITY.defy) {
      G.acted[p] = year
      if (G.rng.next() >= step * CITY.rise * omega * (0.5 + 0.5 * delta) * (1 + need)) continue
      const c = ps.pCapital[p]
      const q = rising(s, ps, G, i, p, F, S, Government.Republic, GovernmentCause.Rising, RevoltCause.Burghers)
      if (q >= 0) logX(s, EventType.CommuneProclaimed, i, c, q, 0)
      continue
    }
    if (!(need > 0) || tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop) < Tier.Kingdom) continue
    G.acted[p] = year
    if (G.rng.next() >= step * CITY.charter * omega * need * (0.5 + 0.5 * delta)) continue
    const c = ps.pCapital[p]
    const price = CITY.price * wealthAll(s, i)
    if (s.goods !== null) merchantPay(s, s.goods, i, price)
    else s.wealth[i] -= price
    if (s.fin !== null) finCredit(s, p, price, 'charter')
    else s.wealth[c] += price
    const q = cityState(s, ps, G, i, p, Government.FreeCity, GovernmentCause.Charter)
    charterBond(s, ps, q, p)
    G.diag.charters++
    logX(s, EventType.CharterBought, i, c, q, price)
    const r = ensureRelation(ps, p, q)
    if (ps.relR[r] > 0.2) ps.relR[r] = 0.2
  }
  republics(s, ps, G)
  mercPay(s, ps, G)
}

/** Republics (ps.alive order, one draw each): signoria; signorie long under one house may be crowned. */
function republics(s: HistoryState, ps: PolityState, G: GovState): void {
  const year = s.year, step = POLITY.step
  const R = s.rul
  for (const p of ps.alive.slice()) {
    if (ps.pEnded[p] >= 0 || changedNow(s, G, p)) continue
    const form = G.form[p]
    const c = ps.pCapital[p]
    if (form === Government.Republic) {
      const war = ps.pWars[p] > 0 ? 1 : 0, cri = inCrisis(s, ps, p) ? 1 : 0
      const lost = R !== null && p < R.pcap && year - R.lost[p] <= 10 ? 1 : 0
      const fam = famTop(s, c)
      const wWar = CITY.sigWar * war + CITY.sigLost * lost, wFam = CITY.sigFamily * fam, wCri = CITY.sigCrisis * cri
      if (G.rng.next() >= step * CITY.signoria * (1 + wWar + wFam + wCri)) continue
      const u = G.rng.next() * (wWar + wFam + wCri + 1)
      const how = u < wWar ? 0 : u < wWar + wFam ? 1 : 2
      const family = how === 1 ? topFamilyAt(s, c) : -1
      logX(s, EventType.SignoriaSeized, c, -1, p, how)
      let r = -1
      if (R !== null) { r = seizeSignoria(s, ps, R, p); G.house[p] = R.rDyn[r] }
      setForm(s, G, p, Government.Signoria, how === 1 ? GovernmentCause.Family : GovernmentCause.Strongman, c, r, family)
      if (R !== null) G.house[p] = R.rDyn[r]
      G.diag.signorie++
    } else if (form === Government.Signoria) {
      if (year - G.since[p] < CITY.crownYears) continue
      if (R !== null && (p >= R.pcap || R.cur[p] < 0 || R.rDyn[R.cur[p]] !== G.house[p])) continue
      if (tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop) < Tier.Kingdom && ps.pMembers[p] < CITY.crownMembers) continue
      if (G.rng.next() >= step * CITY.crown) continue
      setForm(s, G, p, Government.Monarchy, GovernmentCause.Crowned, c)
      G.diag.crowned++
      logX(s, EventType.GovernmentChanged, c, -1, p, Government.Monarchy)
    }
  }
}

/** Mercenaries cost money: a polity whose form hires (GOV.merc > 0) pays at war, its merchants first (or its treasury). */
function mercPay(s: HistoryState, ps: PolityState, G: GovState): void {
  for (const p of ps.alive) {
    if (ps.pWars[p] <= 0) continue
    const f = GOV.merc[G.form[p]]
    if (f === 0) continue
    const c = ps.pCapital[p]
    const W = wealthAll(s, c)
    if (W < CITY.mercFloor) continue
    const pay = CITY.mercPay * f * (mercOf(mHead(s, c)) - 1) * W
    if (!(pay > 0)) continue
    if (s.fin !== null && finSpend(s, p, pay, 'mercenary')) { G.diag.mercPaid += pay; continue }
    if (s.goods !== null) merchantPay(s, s.goods, c, pay)
    else s.wealth[c] -= pay
    if (s.wealth[c] < 0) s.wealth[c] = 0
    G.diag.mercPaid += pay
  }
}

/** localOf hook: the capital of a polity whose form hires mercenaries fights with them (x merc), unless its money is below mercFloor. */
export function govLocal(s: HistoryState, G: GovState, p: number, id: number): number {
  const f = GOV.merc[G.form[p]]
  if (f === 0 || wealthAll(s, id) < CITY.mercFloor) return 1
  return 1 + f * (mercOf(mHead(s, id)) - 1)
}

/** bondStep hook: Charter bond k (free city a of overlord b): it stops paying (Freed), or b revokes it (Absorbed). */
export function govCharterBond(s: HistoryState, ps: PolityState, G: GovState, k: number): void {
  if (ps.bStart[k] === s.year) return // (a new charter is first weighed at the next step)
  const a = ps.bA[k], b = ps.bB[k]
  const d = distAcross(s, ps, b, a)
  const proj = d < FAR ? projAt(ps, b, d) : 0
  const ca = ps.pCapital[a], cb = ps.pCapital[b]
  const F = localOf(s, ps, ca) // (its levy and, through govLocal, its mercenaries)
  const need = needOf(s, ps, b)
  let freed = proj < CITY.freeRebel * F
  if (!freed && need >= 0.5) freed = G.rng.next() < POLITY.step * CITY.stopPay
  if (freed) {
    endBond(s, ps, k, BondEnd.Freed)
    setForm(s, G, a, Government.Republic, GovernmentCause.Freed, ca, -1, famLabel(s, ca))
    G.diag.freed++
    logX(s, EventType.CommuneProclaimed, ca, cb, a, 2)
    const r = ensureRelation(ps, a, b)
    if (ps.relR[r] < CITY.freedR) ps.relR[r] = CITY.freedR
    return
  }
  if (s.year - ps.bStart[k] < CITY.revokeYears || proj < CITY.revoke * F || ps.pWars[b] !== 0 || need !== 0 || !(d < FAR)) return
  if (G.rng.next() >= POLITY.step * CITY.revokeChance) return
  logX(s, EventType.CharterRevoked, ca, cb, a, 0)
  G.diag.revoked++
  absorbVassal(s, ps, k, a, b, d)
}

// --- Every slow step: stateless free towns, league remnants, holy cities, confederations ------------------------------

export function govSlow(s: HistoryState, ps: PolityState, G: GovState): void {
  ensureGovPolities(G, ps.P)
  const year = s.year
  // Stateless trading towns govern themselves (s.living order).
  const living = s.living.slice()
  for (let t = 0; t < living.length; t++) {
    const i = living[t]
    if (ps.polity[i] >= 0 || s.outpost[i] || s.abandoned[i] >= 0 || s.pop[i] < CITY.freePop) continue
    const tr = tradeOf(s, i)
    if (tr < CITY.freeTrade) continue
    if (mHead(s, i) < CITY.mHead && s.through[i] < CITY.thHigh) continue
    if (G.rng.next() >= CITY.free * tr * smoothstep(CITY.freePop, CITY.freePop1, s.pop[i]) * (1 + ps.danger[i] / LEAGUE.danger)) continue
    const q = cityState(s, ps, G, i, -1, Government.Republic, GovernmentCause.Free)
    G.diag.freeTowns++
    logX(s, EventType.CommuneProclaimed, i, -1, q, 1)
  }
  // League remnants: a league of one town for calmYears governs itself as a republic.
  for (const p of ps.alive) {
    if (G.form[p] !== Government.League) continue
    if (ps.pMembers[p] !== 1) { G.lone[p] = -1; continue }
    if (G.lone[p] < 0) { G.lone[p] = year; continue }
    if (year - G.lone[p] < LEAGUE.calmYears) continue
    setForm(s, G, p, Government.Republic, GovernmentCause.Council, ps.pCapital[p], -1, famLabel(s, ps.pCapital[p]))
    G.diag.council++
    logX(s, EventType.CommuneProclaimed, ps.pCapital[p], -1, p, 3)
  }
  if (s.rel !== null) theocracies(s, ps, G)
  confederations(s, ps, G)
}

/** Theocracy (§4.9): holy cities of organised universal faiths take their rule; theocracies that lost their faith are secularised. */
function theocracies(s: HistoryState, ps: PolityState, G: GovState): void {
  const rel = s.rel!
  const R = s.rul
  const F = rel.kind.length
  for (let f = 0; f < F; f++) {
    if (rel.kind[f] !== FaithKind.Universal || rel.endYear[f] >= 0) continue
    const h = rel.holy[f]
    if (h < 0 || s.abandoned[h] >= 0 || s.outpost[h] || rel.org[f] < CITY.theoOrg || s.pop[h] < CITY.theoPop) continue
    const p = ps.polity[h]
    if (p < 0) {
      if (G.rng.next() >= CITY.theoFree) continue
      const q = cityState(s, ps, G, h, -1, Government.Theocracy, GovernmentCause.Clergy)
      G.house[q] = f
      G.diag.theocracies++
      logX(s, EventType.TheocracyProclaimed, h, -1, q, f)
      continue
    }
    if (ps.pCapital[p] === h || G.form[p] === Government.Theocracy || G.acted[p] === s.year || ps.rose[h] === s.year) continue
    const pf = polityFaith(s, rel, p)
    const pil = s.pop[h] > 0 ? rel.pilgrims[f] / s.pop[h] : 0
    const Fh = forceOf(s, ps, h, pil), Sh = suppressOf(s, ps, h, p)
    if (pf === f && Fh / (Sh + 1e-9) < CITY.defy) continue
    G.acted[p] = s.year
    if (G.rng.next() >= CITY.theoSecede * (pf !== f ? 1.5 : 1)) continue
    const c = ps.pCapital[p]
    let q = -1
    if (pf === f) q = cityState(s, ps, G, h, p, Government.Theocracy, GovernmentCause.Clergy)
    else q = rising(s, ps, G, h, p, Fh, Sh, Government.Theocracy, GovernmentCause.Clergy, RevoltCause.Religious)
    if (q < 0) continue
    G.house[q] = f
    G.diag.theocracies++
    logX(s, EventType.TheocracyProclaimed, h, c, q, f)
  }
  // Secularised: the holy city's faith gone, or the capital of another faith now.
  for (const p of ps.alive.slice()) {
    if (G.form[p] !== Government.Theocracy || changedNow(s, G, p)) continue
    const f = G.house[p], c = ps.pCapital[p]
    if (f >= 0 && rel.endYear[f] < 0 && majorityOf(s, rel, c) === f) continue
    let r = -1
    if (R !== null) r = secularThrone(s, ps, R, p)
    setForm(s, G, p, Government.Monarchy, GovernmentCause.Secularised, c, r)
    G.diag.secularised++
    logX(s, EventType.GovernmentChanged, c, -1, p, Government.Monarchy)
  }
}

/** Confederations that have been large and settled (mean member grain share >= formGrain) for settleYears become monarchies. */
function confederations(s: HistoryState, ps: PolityState, G: GovState): void {
  for (const p of ps.alive) {
    if (G.form[p] !== Government.Confederation || changedNow(s, G, p)) continue
    let ok = tierOf(ps.pPop[p], ps.pMembers[p], ps.pMulti[p] === 1, ps.worldPop) >= Tier.Kingdom
    if (ok && p + 1 < ps.memOff.length) {
      let g = 0, n = 0
      for (let k = ps.memOff[p]; k < ps.memOff[p + 1]; k++) { const m = ps.memList[k]; if (ps.polity[m] !== p) continue; g += grainShare(s, m); n++ }
      ok = n > 0 && g / n >= POLITY.formGrain
    } else ok = false
    if (!ok) { G.lone[p] = -1; continue }
    if (G.lone[p] < 0) { G.lone[p] = s.year; continue }
    if (s.year - G.lone[p] < CITY.settleYears) continue
    if (G.rng.next() >= CITY.settle2) continue
    setForm(s, G, p, Government.Monarchy, GovernmentCause.Settled, ps.pCapital[p])
    G.diag.settled++
    logX(s, EventType.GovernmentChanged, ps.pCapital[p], -1, p, Government.Monarchy)
  }
}

// --- Rulers hooks -------------------------------------------------------------------------------------------------------

/**
 * succession() hook (the reign already ended with `cause`, before an heir is chosen): the clergy of a holy city take the throne;
 * a council of a rich small trading monarchy abolishes it; a signoria's lords are driven out. Returns true when the throne is
 * settled (an elected head in office).
 */
export function govAtSuccession(s: HistoryState, ps: PolityState, G: GovState, R: RulerState, p: number, cause: number): boolean {
  ensureGovPolities(G, p + 1)
  const form = G.form[p]
  if (form !== Government.Monarchy && form !== Government.Signoria) return false
  if (changedNow(s, G, p)) return false
  const c = ps.pCapital[p]
  const people = ps.pPeople[p]
  const heir = pickHeir(R, p, R.law[people], R.cognatic[people] === 1, s.year)
  const extinct = heir < 0
  const fell = cause === ReignEnd.Overthrown || cause === ReignEnd.Deposed
  if (form === Government.Signoria) {
    if (!(extinct || fell) || G.rng.next() >= CITY.restore) return false
    const r = abolishThrone(s, ps, R, p)
    setForm(s, G, p, Government.Republic, GovernmentCause.Restored, c, r, famLabel(s, c))
    G.diag.restored++
    logX(s, EventType.CommuneProclaimed, c, -1, p, 4)
    return true
  }
  // Monarchy: the clergy of the holy city.
  const rel = s.rel
  if (rel !== null && ps.pMembers[p] <= CITY.theoMembers) {
    for (let f = 0; f < rel.kind.length; f++) {
      if (rel.holy[f] !== c || rel.kind[f] !== FaithKind.Universal || rel.endYear[f] >= 0 || rel.org[f] < CITY.theoOrg || polityFaith(s, rel, p) !== f) continue
      if (G.rng.next() >= CITY.theoCrown) break
      const r = abolishThrone(s, ps, R, p, true)
      setForm(s, G, p, Government.Theocracy, GovernmentCause.Clergy, c, r)
      G.house[p] = f
      G.diag.theocracies++
      logX(s, EventType.TheocracyProclaimed, c, -1, p, f)
      return true
    }
  }
  // Monarchy: the great houses abolish the throne.
  const minor = !extinct && s.year - R.hBorn[p * RULERS.heirs + heir] < RULERS.majority
  if (!(extinct || fell || minor) || ps.pMembers[p] > CITY.councilMembers) return false
  const m = mHead(s, c)
  if (tradeOf(s, c) < CITY.councilTrade || m < CITY.councilHead) return false
  if (G.rng.next() >= CITY.council * smoothstep(CITY.councilHead, CITY.councilHead1, m)) return false
  const r = abolishThrone(s, ps, R, p)
  setForm(s, G, p, Government.Republic, GovernmentCause.Council, c, r, famLabel(s, c))
  G.diag.council++
  logX(s, EventType.CommuneProclaimed, c, -1, p, 3)
  return true
}

/** rulerYear hook: a republic's or free city's head's term ended (the next is already chosen): factional strife may open a crisis. */
export function govTermEnded(s: HistoryState, ps: PolityState, G: GovState, p: number): void {
  G.diag.terms++
  let e = ps.pExh[p]
  if (e > 1) e = 1
  if (G.rng.next() >= CITY.faction * (1 + (ps.pWars[p] > 0 ? 1 : 0) + e)) return
  if (inCrisis(s, ps, p)) return
  const U = UNREST
  ps.pCrisisUntil[p] = s.year + U.crisisMin + Math.floor(G.rng.next() * (U.crisisMax - U.crisisMin + 1))
  G.diag.strife++
  logX(s, EventType.SuccessionCrisis, ps.pCapital[p], -1, p, s.rul !== null && p < s.rul.pcap ? s.rul.cur[p] : -1)
}

