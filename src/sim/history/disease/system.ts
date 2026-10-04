// disease: epidemics, endemic crowd diseases and place-bound fever (HistoryOptions.disease; 'history-disease').
//
// A pool of 4-8 diseases per world (state.ts): crowd diseases emerge among a people whose herd-and-town load
// (species.ts M8) has reached the disease's threshold; plague spills from a rodent reservoir (a steppe or highland
// weather region) where trading settlements live, and lingers in the towns of a great wave as foci that return for
// centuries; camp fever is born in sieges; fever is place-bound in hot, wet lowlands.
//
// Per settlement and disease a susceptible share sigma (a byte): births renew it (DZ.birth a year, plus immunity
// fading), an outbreak takes attack * sigma. A struck settlement is sick for `duration` years (one outbreak at a time),
// losing toll / duration a year, toll = mortality * attack(pop) * sigma * (virgin: the first time its people meets the
// disease) * (1 + famine * (1 - food)), and from the next year infects its links each year with chance
//   beta * force * w * sigma_j,   force = min(1, sigma * pop / crowd)   (crowd diseases need towns to go on)
// over trade routes (through their transit settlements) and long-haul legs (w = v / (v + half)), by sea only for
// diseases that travel by ship (quarantined ports block most), to neighbours, mother and daughters, and with the
// year's journeys (settlers, migrants, expeditions, fleets, armies on the march and home again). It passes between
// peoples only where they are in contact.
// Endemic: a crowd disease that has struck a people whose population, with its trade partners' where the disease is
// endemic (weighted by trade volume), reaches the critical community size settles as a childhood sickness: a small
// steady death rate, susceptibles held low, no outbreaks; below DZ.burnOut of it, it burns out and returns later
// as an epidemic. Endemic peoples seed outbreaks along their links to others, and a first contact passes their
// sicknesses at once: the species system's contact epidemic (M8) is this case (Epidemic event, value the expected loss).
// Fever: settlements on fever ground lose FEVER.mort * intensity * (1 - tolerance) a year; tolerance per people grows
// over centuries with the share of its people living there; armies on fever ground tire.
// Effects: deaths; the year's food multiplier falls (labour); trade pairs of sick places cost more for a few years;
// flight to neighbours (who may catch it) and deserted hamlets; unrest in polity members; exhaustion of armies that
// meet sickness (ArmyStricken), which may end a campaign; quarantine at wealthy, well-governed ports.

import { CITY_POPULATION, DiseaseKind, DiseaseVia, EventType, JourneyKind, LegKind, TECH_FIELD_COUNT, TOWN_POPULATION, TechField } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { logEvent } from '../state.ts'
import type { HistoryEvent } from '../../../contract.ts'
import type { TradeState } from '../trade.ts'
import type { TechState } from '../technology.ts'
import { SP } from '../species.ts'
import type { DiseaseState } from './state.ts'
import { ensureDisease } from './state.ts'
import { DZ, FEVER, QUARANTINE } from './params.ts'
import { rulerPlague } from '../rulers/hooks.ts' // rulers:
import { religionPlague } from '../religion/hooks.ts' // religion:

// (Set at the start of each yearly call: the year's per-people figures from the technology system.)
let TK: TechState | null = null
let DEG = new Int32Array(0)
let CROSS: number[] = []

/** Pushes an event with a second number (HistoryEvent.extra). */
function logExtra(s: HistoryState, type: HistoryEvent['type'], settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

const alive = (s: HistoryState, id: number): boolean => s.abandoned[id] < 0 && s.outpost[id] === 0

/** First contact between settlements a and b (knowledge.ts meet, through species.ts): handled at the end of the year. */
export function diseaseOnContact(s: HistoryState, a: number, b: number): void {
  const dz = s.dz
  if (dz === null) return
  dz.contacts.push(a, b)
}

/** Trade cost multiplier of a settlement's pairs (the trade system's hook), or null when nothing is touched this year. */
export function diseaseTradeMul(s: HistoryState): Float64Array | null {
  const dz = s.dz
  if (dz === null || !dz.tmulOn || dz.tmul.length < s.count) return null
  return dz.tmul
}

/** Effective fever intensity at settlement id: the cell's, more with paddy or irrigation, less with drainage. */
function feverAt(s: HistoryState, dz: DiseaseState, id: number): number {
  const c = s.cell[id]
  let f = dz.fever[c]
  if (f <= 0) return 0
  if ((s.sp.m0[id] & (1 << SP.paddyRice)) !== 0 || s.farmMul[c] > 1) f *= FEVER.paddy
  const farm = s.tech[s.people[id] * TECH_FIELD_COUNT + TechField.Farming]
  if (farm > FEVER.drainFrom) {
    let dr = FEVER.drain * (farm - FEVER.drainFrom)
    if (dr > FEVER.drainMax) dr = FEVER.drainMax
    f *= 1 - dr
  }
  return f > 1 ? 1 : f
}

/** Hygiene of people p: the share of an outbreak's toll left by its Crafts level (1 early in a run). */
function hygieneOf(s: HistoryState, p: number): number {
  const c = s.tech[p * TECH_FIELD_COUNT + TechField.Crafts]
  if (c <= DZ.hygieneFrom) return 1
  let x = DZ.hygiene * (c - DZ.hygieneFrom)
  if (x > DZ.hygieneMax) x = DZ.hygieneMax
  return 1 - x
}

/** Migration's site factor for a group from `from` on cell c: fever ground is shunned by those not used to it. */
export function feverSite(dz: DiseaseState, c: number, people: number): number {
  const f = dz.fever[c]
  if (f <= 0) return 1
  return 1 - FEVER.site * f * (1 - dz.tol[people])
}

/** Weight of sea links for disease d carried by people p (0 before ships are fast enough for it). */
function seaWeight(s: HistoryState, dz: DiseaseState, d: number, p: number): number {
  const def = dz.defs[d]
  if (def.seaTech > 0 && s.tech[p * TECH_FIELD_COUNT + TechField.Seafaring] < def.seaTech) return 0
  return def.sea
}

function newEpidemic(s: HistoryState, dz: DiseaseState, d: number, origin: number, source: number, via: number): number {
  const e = dz.eDisease.length
  dz.eDisease.push(d); dz.eStart.push(s.year); dz.eEnd.push(-1); dz.eOrigin.push(origin); dz.eSource.push(source)
  dz.eDeaths.push(0); dz.eNet.push(0); dz.eMask.push(0); dz.ePeoples.push([]); dz.eActive.push(0); dz.eGreat.push(0); dz.eRows.push(0)
  dz.eTownDeaths.push(0); dz.eTownPop.push(0); dz.eFoci.push([]); dz.eVia.push(via)
  dz.eOpen.push(e)
  return e
}

/** Settlement j catches disease d of epidemic epi (-1: a new one begins at j) from src (-1: none) by `via`. */
function strike(s: HistoryState, dz: DiseaseState, j: number, d: number, epi: number, src: number, via: number): void {
  const D = dz.D
  const def = dz.defs[d]
  const pop = s.pop[j]
  const pj = s.people[j]
  if (epi < 0) epi = newEpidemic(s, dz, d, j, src, via)
  dz.lastEpi[j * D + d] = epi
  const sig = dz.sus[j * D + d] / 255
  const attack = def.attack * (DZ.village + ((1 - DZ.village) * pop) / (pop + DZ.townHalf))
  let toll = def.mortality * attack * sig
  if (dz.ever[pj * D + d] === 0) toll *= DZ.virgin
  const food = s.food[j]
  if (food < 1) toll *= 1 + DZ.famine * (1 - food)
  toll *= hygieneOf(s, pj)
  if (toll > DZ.maxToll) toll = DZ.maxToll
  dz.sus[j * D + d] = (sig * (1 - attack) * 255 + 0.5) | 0
  dz.act[j] = d + 1
  dz.actEnd[j] = s.year + def.duration - 1
  dz.actRate[j] = toll / def.duration
  dz.actEpi[j] = epi
  const f = (sig * pop) / def.crowd
  dz.actForce[j] = f > 1 ? 1 : f
  dz.active.push(j)
  if (dz.firstYear[d] < 0) {
    dz.firstYear[d] = s.year; dz.firstSettlement[d] = j; dz.originPeople[d] = pj
    if (dz.originCell[d] < 0) dz.originCell[d] = s.cell[j]
    logEvent(s, EventType.DiseaseAppeared, j, -1, d)
  }
  dz.oDisease.push(d); dz.oSettlement.push(j); dz.oYear.push(s.year); dz.oToll.push(toll); dz.oSource.push(src); dz.oVia.push(via); dz.oEpi.push(epi)
  dz.eActive[epi]++
  dz.eRows[epi]++
  const dead = toll * pop
  dz.eDeaths[epi] += dead
  if ((dz.eMask[epi] & (1 << pj)) === 0) {
    dz.eMask[epi] |= 1 << pj
    dz.ePeoples[epi].push(pj)
    dz.eNet[epi] += TK !== null && TK.pop[pj] > 0 ? TK.pop[pj] : pop
  }
  if (pop >= TOWN_POPULATION) { dz.eTownDeaths[epi] += dead; dz.eTownPop[epi] += pop }
  if (dz.kind[d] === DiseaseKind.Plague && pop >= DZ.focusPop && dz.eFoci[epi].length < DZ.focusTowns) dz.eFoci[epi].push(j)
  dz.ever[pj * D + d] = 1
  dz.lastIn[pj * D + d] = s.year
  if (dz.tradeUntil[j] < s.year) dz.hit.push(j)
  dz.tradeUntil[j] = s.year + def.duration + DZ.tradeYears
  if (pop >= CITY_POPULATION) logExtra(s, EventType.CityStricken, j, src, epi, toll)
  if (dz.eGreat[epi] === 0) {
    if (dz.eDeaths[epi] >= DZ.great * dz.eNet[epi] && dz.eDeaths[epi] >= DZ.greatMin) {
      dz.eGreat[epi] = 1
      for (const q of dz.ePeoples[epi]) dz.lastGreat[q] = s.year
      logExtra(s, EventType.GreatEpidemic, dz.eOrigin[epi], dz.eSource[epi], epi, d)
    }
  } else dz.lastGreat[pj] = s.year
  // Unrest among the members of a polity.
  const ps = s.pol
  if (ps !== null && j < ps.polity.length && ps.polity[j] >= 0) {
    ps.unrest[j] += DZ.unrest * toll
    // rulers: an epidemic at a capital may take the ruler and the heirs (their deaths take effect at the next rulers' year).
    const pj2 = ps.polity[j]
    if (s.rul !== null && ps.pCapital[pj2] === j) rulerPlague(s, pj2, toll, DZ.court)
  }
  // religion: a town struck hard counts as a woe for the founding of faiths.
  if (s.rel !== null && pop >= TOWN_POPULATION && toll >= DZ.woeToll) religionPlague(s, j)
  // Flight from a struck place: some flee to a neighbour of their people, and may bring the sickness.
  if (pop >= DZ.fleeMin && toll >= 0.08) {
    const t = neighbourOf(s, dz, j, true)
    if (t >= 0) {
      let x = DZ.flee * toll
      if (x > DZ.fleeMax) x = DZ.fleeMax
      x *= pop
      s.pop[j] -= x
      s.pop[t] += x
      dz.diag.fled += x
      tryInfect(s, dz, j, t, d, def.beta * 0.5, DiseaseVia.Near, false, epi)
    }
  } else if (pop < DZ.desertPop && toll >= DZ.desertLoss && dz.rng.next() < DZ.desert) {
    // A hamlet struck hard is deserted: the survivors go to its mother or a neighbour (abandoned next year).
    let t = s.parent[j]
    if (t < 0 || !alive(s, t) || s.people[t] !== pj) t = neighbourOf(s, dz, j, false)
    if (t >= 0 && pop > 10) {
      // (the survivors go; ten stay behind with the sickness, and the place is abandoned next year)
      s.pop[t] += (pop - 10) * (1 - toll)
      s.pop[j] = 10
      dz.diag.deserted++
    }
  }
}

/** The largest living neighbour of j's people within its fields' reach (not sick if `healthy`), or -1. */
function neighbourOf(s: HistoryState, dz: DiseaseState, j: number, healthy: boolean): number {
  const T = s.terrain
  const c = s.cell[j]
  const pj = s.people[j]
  let best = -1, bp = 0
  for (let k = T.catchOff[c], e = T.catchBase[c]; k < e; k++) {
    const o = s.occupant[T.catchCell[k]]
    if (o < 0 || o === j || s.outpost[o] || s.people[o] !== pj || (healthy && dz.act[o] !== 0)) continue
    if (s.pop[o] > bp) { bp = s.pop[o]; best = o }
  }
  return best
}

/** src passes disease d to j with chance p * sigma_j (epi -1: a new epidemic begins at j). */
function tryInfect(s: HistoryState, dz: DiseaseState, src: number, j: number, d: number, p: number, via: number, sea: boolean, epi: number): boolean {
  if (!alive(s, j) || dz.act[j] !== 0) return false
  const D = dz.D
  const pj = s.people[j]
  if (dz.endemic[pj * D + d] !== 0) return false
  const ps = s.people[src]
  if (ps !== pj && s.know.contact[ps * s.know.P + pj] < 0) return false
  const def = dz.defs[d]
  const sig = dz.sus[j * D + d] / 255
  if (sig < def.susMin || (epi >= 0 && dz.lastEpi[j * D + d] === epi)) return false
  const x = p * sig
  if (x < 1e-4) return false
  const q = dz.quar[j] < 0 ? 1 : sea ? QUARANTINE.block : QUARANTINE.cordon
  const u = dz.rng.next()
  if (u >= x * q) { if (u < x) dz.diag.blocked++; return false }
  strike(s, dz, j, d, epi, src, via)
  return true
}

/** Settlement i (sick) infects its links this year. */
function spreadFrom(s: HistoryState, dz: DiseaseState, i: number): void {
  const d = dz.act[i] - 1
  const def = dz.defs[d]
  const base = def.beta * dz.actForce[i]
  if (base <= 0) return
  const epi = dz.actEpi[i]
  const seaW = seaWeight(s, dz, d, s.people[i])
  if (i < dz.linkN) {
    for (let k = dz.lOff[i], e = dz.lOff[i + 1]; k < e; k++) {
      const sea = dz.lSea[k] === 1
      const w = sea ? dz.lW[k] * seaW : dz.lW[k]
      if (w > 0) tryInfect(s, dz, i, dz.lTo[k], d, base * w, sea ? DiseaseVia.Sea : DiseaseVia.Route, sea, epi)
    }
  }
  const T = s.terrain
  const c = s.cell[i]
  for (let k = T.catchOff[c], e = T.catchBase[c]; k < e; k++) {
    const o = s.occupant[T.catchCell[k]]
    if (o >= 0 && o !== i) tryInfect(s, dz, i, o, d, base * DZ.near, DiseaseVia.Near, false, epi)
  }
  const par = s.parent[i]
  if (par >= 0) tryInfect(s, dz, i, par, d, base * DZ.kin, DiseaseVia.Kin, false, epi)
  const sp = s.sp
  for (let ch = sp.firstChild[i]; ch >= 0; ch = sp.nextSibling[ch]) tryInfect(s, dz, i, ch, d, base * DZ.kin, DiseaseVia.Kin, false, epi)
}

/** Links between settlements: open trade routes (through their transit settlements) and open long-haul legs. */
function rebuildLinks(s: HistoryState, dz: DiseaseState, ts: TradeState, tk: TechState): void {
  const S = s.count
  if (DEG.length < S + 1) DEG = new Int32Array(2 * (S + 1))
  const deg = DEG
  deg.fill(0, 0, S + 1)
  const gx = s.goods
  // Two passes: count, then fill (edge order: routes in open order, hop by hop; then legs).
  for (let pass = 0; pass < 2; pass++) {
    const add = (a: number, b: number, w: number, sea: number): void => {
      if (pass === 0) { deg[a + 1]++; deg[b + 1]++; return }
      let k = FILLP[a]++
      dz.lTo[k] = b; dz.lW[k] = w; dz.lSea[k] = sea
      k = FILLP[b]++
      dz.lTo[k] = a; dz.lW[k] = w; dz.lSea[k] = sea
      if (s.people[a] !== s.people[b]) CROSS.push(a, b, w, sea)
    }
    for (const r of ts.openList) {
      const v = ts.rVol[r]
      if (!(v > 0)) continue
      const w = v / (v + DZ.routeHalf)
      const sea = r < tk.routeSea.length ? tk.routeSea[r] : 0
      let x = ts.rA[r]
      if (!alive(s, x)) continue
      const tr = ts.rTransit[r]
      for (let k = 0; k < tr.length; k++) {
        const y = tr[k]
        if (y === x || !alive(s, y)) continue
        add(x, y, w, sea)
        x = y
      }
      const b = ts.rB[r]
      if (alive(s, b) && b !== x) { add(x, b, w, sea) }
    }
    if (gx !== null) {
      for (let k = 0; k < gx.legCount; k++) {
        if (!gx.legOpen[k]) continue
        const a = gx.legA[k], b = gx.legB[k]
        if (!alive(s, a) || !alive(s, b)) continue
        const v = gx.legVol[k]
        if (!(v > 0)) continue
        add(a, b, v / (v + DZ.legHalf), gx.legKind[k] === LegKind.Lane ? 1 : 0)
      }
    }
    if (pass === 0) {
      for (let i = 0; i < S; i++) deg[i + 1] += deg[i]
      const m = deg[S]
      if (dz.lOff.length < S + 1) dz.lOff = new Int32Array(2 * (S + 1))
      dz.lOff.set(deg.subarray(0, S + 1))
      if (dz.lTo.length < m) { dz.lTo = new Int32Array(2 * m); dz.lW = new Float64Array(2 * m); dz.lSea = new Uint8Array(2 * m) }
      if (FILLP.length < S + 1) FILLP = new Int32Array(2 * (S + 1))
      FILLP.set(deg.subarray(0, S))
      CROSS = []
    }
  }
  dz.linkN = S
  dz.linkYear = s.year
  dz.cross = CROSS
}
let FILLP = new Int32Array(0)

/** New settlements take their mother's immunity (founders a fully susceptible people). */
function initNew(s: HistoryState, dz: DiseaseState): void {
  ensureDisease(dz, s.count)
  const D = dz.D
  for (let id = dz.seen; id < s.count; id++) {
    const par = s.parent[id]
    if (par >= 0 && par < id) dz.sus.copyWithin(id * D, par * D, par * D + D)
    else dz.sus.fill(255, id * D, id * D + D)
  }
  dz.seen = s.count
}

/** The active war between the polities of u and v (or the war u's polity fights, if v was just taken), or -1. */
function warOf(s: HistoryState, u: number, v: number): number {
  const ps = s.pol
  if (ps === null || u >= ps.polity.length || v >= ps.polity.length) return -1
  const p = ps.polity[u], q = ps.polity[v]
  if (p < 0) return -1
  for (const w of ps.activeWars) {
    const a = ps.wAtt[w], b = ps.wDef[w]
    if ((a === p && b === q) || (a === q && b === p)) return w
  }
  if (p === q) for (const w of ps.activeWars) if (ps.wAtt[w] === p || ps.wDef[w] === p) return w
  return -1
}

/** The year's journeys: carriers travel with settlers, migrants, expeditions, fleets and armies; armies meet sickness. */
function journeys(s: HistoryState, dz: DiseaseState): void {
  const J = s.journeys
  const D = dz.D
  const year = s.year
  for (let t = dz.jSeen; t < J.length; t++) {
    const rec = J[t]
    const u = rec.from, v = rec.to
    if (u < 0 || v < 0 || u >= s.count || v >= s.count || u === v) continue
    const kind = rec.kind
    const jw = DZ.journey[kind] ?? 0.3
    const sea = kind === JourneyKind.Fleet
    // A sick place sends the sickness along.
    if (dz.act[u] !== 0 && year <= dz.actEnd[u] + 1) {
      const d = dz.act[u] - 1
      const def = dz.defs[d]
      if (!sea || seaWeight(s, dz, d, s.people[u]) > 0) tryInfect(s, dz, u, v, d, def.beta * dz.actForce[u] * jw, kind === JourneyKind.Army ? DiseaseVia.Army : DiseaseVia.Journey, sea, dz.actEpi[u])
    } else {
      // From an endemic people to one where it is not.
      const pu = s.people[u], pv = s.people[v]
      if (pu !== pv) for (let d = 0; d < D; d++) {
        if (dz.endemic[pu * D + d] === 0 || dz.endemic[pv * D + d] !== 0) continue
        if (tryInfect(s, dz, u, v, d, dz.defs[d].beta * DZ.endemicForce * jw, kind === JourneyKind.Army ? DiseaseVia.Army : DiseaseVia.Journey, sea, -1)) break
      }
    }
    if (kind !== JourneyKind.Army || s.pol === null) continue
    // Armies: home again with the sickness of the town they marched on; camp fever; fever ground.
    let exh = 0, cause = 0
    if (dz.act[v] !== 0 && year <= dz.actEnd[v] + 1) {
      const d = dz.act[v] - 1
      const def = dz.defs[d]
      tryInfect(s, dz, v, u, d, def.beta * dz.actForce[v] * DZ.armyHome, DiseaseVia.Army, false, dz.actEpi[v])
      exh += DZ.armyExhaust * dz.actRate[v] * def.duration * (dz.sus[u * D + d] / 255)
    }
    const cp = dz.campId
    if (cp >= 0) {
      const ps = s.pol
      const siege = v < ps.polity.length && ((ps.walls[v] > 0) || (ps.polity[v] >= 0 && ps.pCapital[ps.polity[v]] === v))
      const chance = dz.firstYear[cp] < 0 ? (siege ? DZ.campFirst : 0) : DZ.camp * (siege ? 2 : 1)
      if (chance > 0 && dz.rng.next() < chance) {
        let e = -1
        if (dz.act[v] === 0 && dz.sus[v * D + cp] / 255 >= dz.defs[cp].susMin) { strike(s, dz, v, cp, -1, u, DiseaseVia.Army); e = dz.actEpi[v] }
        if (dz.act[u] === 0 && dz.sus[u * D + cp] / 255 >= dz.defs[cp].susMin) strike(s, dz, u, cp, e, e >= 0 ? v : -1, DiseaseVia.Army)
        exh += DZ.campExhaust
        cause = 1
      }
    }
    const f = feverAt(s, dz, v)
    if (f > 0) {
      const e = FEVER.army * f * (1 - dz.tol[s.people[u]])
      if (e > exh) cause = 2
      exh += e
    }
    if (exh <= 0) continue
    const w = warOf(s, u, v)
    if (w < 0) continue
    const ps = s.pol
    const p = ps.polity[u]
    const before = ps.pExh[p]
    ps.pExh[p] += exh
    if (exh >= DZ.armyLog) {
      logExtra(s, EventType.ArmyStricken, v, u, w, exh)
      dz.diag.army.push(year, w, cause, exh)
      if (before < 1 && before + exh >= 1) dz.diag.spent.push(year, w)
    }
  }
  dz.jSeen = J.length
}

/** First contacts of the year: each people's crowd diseases (endemic, or sick at the meeting place) pass to the other. */
function contacts(s: HistoryState, dz: DiseaseState): void {
  const C = dz.contacts
  const D = dz.D
  for (let t = 0; t < C.length; t += 2) {
    for (let dir = 0; dir < 2; dir++) {
      const a = dir === 0 ? C[t] : C[t + 1], b = dir === 0 ? C[t + 1] : C[t]
      if (!alive(s, a) || !alive(s, b)) continue
      const pa = s.people[a], pb = s.people[b]
      let logged = false
      for (let d = 0; d < D; d++) {
        if (dz.kind[d] !== DiseaseKind.Crowd) continue
        const carried = dz.endemic[pa * D + d] !== 0 || (dz.act[a] === d + 1 && s.year <= dz.actEnd[a] + 1)
        if (!carried || dz.endemic[pb * D + d] !== 0 || dz.act[b] !== 0) continue
        if (dz.sus[b * D + d] / 255 < dz.defs[d].susMin) continue
        if (dz.rng.next() >= DZ.contact) continue
        const virgin = dz.ever[pb * D + d] === 0
        const est = virgin && !logged ? expectedLoss(s, dz, pb, d) : 0
        strike(s, dz, b, d, -1, a, DiseaseVia.Contact)
        if (virgin && !logged && est > 0) {
          logExtra(s, EventType.Epidemic, b, a, est, dz.actEpi[b])
          logged = true
        }
      }
    }
  }
  C.length = 0
}

/** Expected share of people p lost to disease d reaching all its settlements now (for the contact Epidemic event). */
function expectedLoss(s: HistoryState, dz: DiseaseState, p: number, d: number): number {
  const def = dz.defs[d]
  const D = dz.D
  let tot = 0, dead = 0
  for (const id of s.living) {
    if (s.people[id] !== p) continue
    const pop = s.pop[id]
    const attack = def.attack * (DZ.village + ((1 - DZ.village) * pop) / (pop + DZ.townHalf))
    let toll = def.mortality * attack * (dz.sus[id * D + d] / 255) * (dz.ever[p * D + d] === 0 ? DZ.virgin : 1) * hygieneOf(s, p)
    if (toll > DZ.maxToll) toll = DZ.maxToll
    tot += pop
    dead += toll * pop
  }
  if (!(tot > 0)) return 0
  let x = (DZ.contactReach * dead) / tot
  if (x > DZ.maxContact) x = DZ.maxContact
  return x
}

/** Spills: plague from its reservoir and its foci, crowd diseases from herds and towns (every step). */
function spills(s: HistoryState, dz: DiseaseState, ts: TradeState, tk: TechState): void {
  const D = dz.D
  const rng = dz.rng
  const year = s.year
  for (let d = 0; d < D; d++) {
    if (dz.kind[d] !== DiseaseKind.Plague) continue
    const def = dz.defs[d]
    if (rng.next() < DZ.spill) {
      // (herders and traders in or near the reservoir: the busiest trading place within reach, nearer ones first)
      const R = dz.region[d], o = dz.originCell[d]
      const G = s.world.grid.positions
      const r2 = DZ.spillReach * DZ.spillReach
      let best = -1, bt = -1
      for (const id of s.living) {
        if (s.pop[id] < DZ.spillPop || !ts.trader[id] || dz.act[id] !== 0) continue
        const c = s.cell[id]
        const dx = G[c * 3] - G[o * 3], dy = G[c * 3 + 1] - G[o * 3 + 1], dzz = G[c * 3 + 2] - G[o * 3 + 2]
        const d2 = dx * dx + dy * dy + dzz * dzz
        if (s.weatherRegion[c] !== R && d2 > r2) continue
        if (dz.sus[id * D + d] / 255 < def.susMin) continue
        const x = (s.through[id] + s.pop[id] * 1e-3) / (1 + d2 / r2)
        if (x > bt) { bt = x; best = id }
      }
      if (best >= 0) strike(s, dz, best, d, -1, -1, DiseaseVia.Origin)
    }
    if (dz.focusW[d] > 0.01) {
      dz.focusW[d] *= DZ.focusDecay
      const F = dz.foci[d]
      if (F.length > 0 && rng.next() < dz.focusW[d] * DZ.focusChance) {
        const id = F[rng.int(0, F.length - 1)]
        if (alive(s, id) && dz.act[id] === 0 && dz.endemic[s.people[id] * D + d] === 0 && dz.sus[id * D + d] / 255 >= def.susMin) strike(s, dz, id, d, -1, -1, DiseaseVia.Focus)
      }
    }
  }
  if (year % DZ.step !== 0) return
  const P = dz.P
  const load = s.sp.disease
  for (let d = 0; d < D; d++) {
    if (dz.kind[d] !== DiseaseKind.Crowd) continue
    const def = dz.defs[d]
    for (let p = 0; p < P; p++) {
      if (!tk.alive[p] || load[p] < dz.load[d] || tk.pop[p] < DZ.emergePop * def.ccs) continue
      const big = tk.largest[p]
      if (big < 0 || s.pop[big] < DZ.emergeTown || dz.ever[p * D + d] !== 0) continue
      if (rng.next() >= DZ.emerge) continue
      if (dz.act[big] === 0 && dz.sus[big * D + d] / 255 >= def.susMin) strike(s, dz, big, d, -1, -1, DiseaseVia.Origin)
    }
  }
}

/** Endemic sources seed outbreaks along their links to peoples where the disease is not endemic (every other year). */
function endemicSeeds(s: HistoryState, dz: DiseaseState): void {
  const X = dz.cross
  const D = dz.D
  for (let t = 0; t < X.length; t += 4) {
    const w = X[t + 2], sea = X[t + 3] === 1
    for (let dir = 0; dir < 2; dir++) {
      const a = dir === 0 ? X[t] : X[t + 1], b = dir === 0 ? X[t + 1] : X[t]
      if (dz.act[b] !== 0 || !alive(s, a)) continue
      const pa = s.people[a], pb = s.people[b]
      for (let d = 0; d < D; d++) {
        if (dz.endemic[pa * D + d] === 0 || dz.endemic[pb * D + d] !== 0) continue
        const ww = sea ? w * seaWeight(s, dz, d, pa) : w
        if (ww > 0 && tryInfect(s, dz, a, b, d, 2 * dz.defs[d].beta * DZ.endemicForce * ww, sea ? DiseaseVia.Sea : DiseaseVia.Route, sea, -1)) break
      }
    }
  }
}

/** Every step: endemic status per people (critical community size with trade partners), the load it adds. */
function endemicPass(s: HistoryState, dz: DiseaseState, tk: TechState): void {
  const D = dz.D, P = dz.P
  const contact = s.know.contact
  const year = s.year
  for (let d = 0; d < D; d++) {
    if (dz.kind[d] !== DiseaseKind.Crowd) continue
    const ccs = dz.defs[d].ccs
    for (let p = 0; p < P; p++) {
      const i = p * D + d
      if (!tk.alive[p]) { dz.endemic[i] = 0; continue }
      let C = tk.pop[p]
      for (let q = 0; q < P; q++) {
        // (partners where it is endemic, or where it is going round too)
        if (q === p || !tk.alive[q] || contact[p * P + q] < 0 || (dz.endemic[q * D + d] === 0 && dz.lastIn[q * D + d] < year - 2 * DZ.step)) continue
        const v = tk.pairVol[p * P + q]
        if (v > 0) C += (tk.pop[q] * v) / (v + DZ.partnerHalf)
      }
      if (dz.endemic[i] === 0) {
        if (dz.lastIn[i] >= year - 2 * DZ.step && C >= ccs && tk.largest[p] >= 0) {
          dz.endemic[i] = 1
          logEvent(s, EventType.Endemic, tk.largest[p], -1, d)
        }
      } else if (C < DZ.burnOut * ccs) dz.endemic[i] = 0
    }
  }
  // Steady death rate and load per people.
  const load = s.sp.disease
  for (let p = 0; p < P; p++) {
    let r = 0, l = 0
    for (let d = 0; d < D; d++) if (dz.endemic[p * D + d] !== 0) { r += dz.defs[d].endemicDeath; l += 0.12 }
    dz.endRate[p] = r * hygieneOf(s, p)
    if (load[p] < l) load[p] = l
  }
}

/** Every step: births renew susceptibles (immunity fades), held low where endemic. */
function susPass(s: HistoryState, dz: DiseaseState): void {
  const D = dz.D
  const lowE = (DZ.endemicSus * 255 + 0.5) | 0
  const step = DZ.step
  for (const id of s.living) {
    const p = s.people[id]
    const o = id * D
    for (let d = 0; d < D; d++) {
      if (d === dz.feverId) continue
      const x = dz.sus[o + d]
      if (dz.endemic[p * D + d] !== 0) { if (x > lowE) dz.sus[o + d] = lowE; continue }
      if (x >= 255) continue
      const inc = (((255 - x) * step * (DZ.birth + dz.defs[d].fade)) | 0) + 1
      dz.sus[o + d] = x + inc > 255 ? 255 : x + inc
    }
  }
}

/** Every step: fever tolerance per people grows with the share of its people on fever ground. */
function tolerancePass(s: HistoryState, dz: DiseaseState, first: boolean): void {
  const P = dz.P
  const pop = PPOP.length >= P ? PPOP : (PPOP = new Float64Array(P))
  const exp = PEXP.length >= P ? PEXP : (PEXP = new Float64Array(P))
  pop.fill(0, 0, P); exp.fill(0, 0, P)
  for (const id of s.living) {
    const p = s.people[id]
    const x = s.pop[id]
    pop[p] += x
    const f = dz.fever[s.cell[id]]
    if (f > 0) exp[p] += x * f
  }
  for (let p = 0; p < P; p++) {
    if (!(pop[p] > 0)) continue
    const e = exp[p] / pop[p]
    if (first) dz.tol[p] = FEVER.tolMax * (FEVER.start * e < 1 ? FEVER.start * e : 1)
    else dz.tol[p] += DZ.step * FEVER.adapt * e * (FEVER.tolMax - dz.tol[p])
  }
}
let PPOP = new Float64Array(0), PEXP = new Float64Array(0)

/** Every 10 years: wealthy, well-governed ports of polity members that remember a great epidemic hold ships in quarantine. */
function quarantinePass(s: HistoryState, dz: DiseaseState): void {
  const ps = s.pol
  const year = s.year
  const Q = QUARANTINE
  // Lifted where the port, the settlement or its polity is gone.
  for (let k = 0; k < dz.qSettlement.length; k++) {
    if (dz.qTo[k] >= 0) continue
    const id = dz.qSettlement[k]
    if (!alive(s, id) || s.port[id] < 0 || ps === null || id >= ps.polity.length || ps.polity[id] < 0) { dz.qTo[k] = year; dz.quar[id] = -1 }
  }
  if (ps === null) return
  for (const id of s.living) {
    if (s.port[id] < 0 || dz.quar[id] >= 0 || id >= ps.polity.length) continue
    const pol = ps.polity[id]
    if (pol < 0) continue
    const p = s.people[id]
    if (s.tech[p * TECH_FIELD_COUNT + TechField.Crafts] < Q.crafts || year - dz.lastGreat[p] > Q.memory || ps.unrest[id] > Q.unrestMax) continue
    if (s.wealth[id] < Q.wealthHead * s.pop[id]) continue
    if (dz.rng.next() >= Q.chance) continue
    dz.quar[id] = dz.qSettlement.length
    dz.qSettlement.push(id); dz.qFrom.push(year); dz.qTo.push(-1)
    logEvent(s, EventType.Quarantine, id, ps.pCapital[pol], pol)
  }
}

/** An epidemic with no settlement still sick ends; a great one is logged, a great plague leaves foci. */
function closeEpidemics(s: HistoryState, dz: DiseaseState): void {
  let w = 0
  for (let t = 0; t < dz.eOpen.length; t++) {
    const e = dz.eOpen[t]
    if (dz.eActive[e] > 0) { dz.eOpen[w++] = e; continue }
    dz.eEnd[e] = s.year
    if (dz.eGreat[e] !== 0) {
      logExtra(s, EventType.EpidemicEnded, dz.eOrigin[e], -1, e, dz.eNet[e] > 0 ? dz.eDeaths[e] / dz.eNet[e] : 0)
      const d = dz.eDisease[e]
      // (a great wave from the reservoir leaves foci in its towns, which return now and then, fading; returns leave none)
      if (dz.kind[d] === DiseaseKind.Plague && dz.eVia[e] === DiseaseVia.Origin && dz.eFoci[e].length > 0) {
        dz.focusW[d] = DZ.focusMax
        dz.foci[d] = dz.eFoci[e].slice()
      }
    }
    dz.eFoci[e] = []
  }
  dz.eOpen.length = w
}

/** System (end of year): the disease system's year (see the header). */
export function diseaseSystem(s: HistoryState, dz: DiseaseState, ts: TradeState, tk: TechState): void {
  TK = tk
  const year = s.year
  const D = dz.D
  initNew(s, dz)
  const first = dz.linkYear < 0
  if (first || year % DZ.step === 0) rebuildLinks(s, dz, ts, tk)
  // Sick places infect their links (struck in earlier years, still sick or in their last infectious year).
  const n0 = dz.active.length
  for (let t = 0; t < n0; t++) {
    const i = dz.active[t]
    if (dz.act[i] === 0 || !alive(s, i) || dz.actEpi[i] < 0) continue
    spreadFrom(s, dz, i)
  }
  if (year % 2 === 0) endemicSeeds(s, dz)
  journeys(s, dz)
  contacts(s, dz)
  spills(s, dz, ts, tk)
  // Deaths, labour, the end of outbreaks.
  let epiDead = 0
  {
    const A = dz.active
    let w = 0
    for (let t = 0; t < A.length; t++) {
      const i = A[t]
      const e = dz.actEpi[i]
      if (!alive(s, i)) { dz.act[i] = 0; dz.eActive[e]--; continue }
      if (year <= dz.actEnd[i]) {
        const r = dz.actRate[i]
        epiDead += r * s.pop[i]
        s.pop[i] *= 1 - r
        let l = DZ.labour * r
        if (l > DZ.labourMax) l = DZ.labourMax
        s.econ[i] *= 1 - l
      }
      if (year >= dz.actEnd[i] + 1) { dz.act[i] = 0; dz.eActive[e]--; continue }
      A[w++] = i
    }
    A.length = w
  }
  closeEpidemics(s, dz)
  // Endemic sickness and fever: steady deaths.
  let endDead = 0, feverDead = 0
  const fid = dz.feverId
  for (const id of s.living) {
    const p = s.people[id]
    const pop = s.pop[id]
    let r = dz.endRate[p]
    endDead += r * pop
    if (fid >= 0 && dz.fever[s.cell[id]] > 0) {
      const f = feverAt(s, dz, id)
      const x = FEVER.mort * f * (1 - dz.tol[p])
      r += x
      feverDead += x * pop
      if (dz.firstYear[fid] < 0 && f >= FEVER.ground && pop >= 50) {
        dz.firstYear[fid] = year; dz.firstSettlement[fid] = id; dz.originPeople[fid] = p; dz.originCell[fid] = s.cell[id]
        logEvent(s, EventType.DiseaseAppeared, id, -1, fid)
      }
    }
    if (r > 0) s.pop[id] = pop * (1 - r)
  }
  const dec = (year / 10) | 0
  const dg = dz.diag
  while (dg.epiDead.length <= dec) { dg.epiDead.push(0); dg.endDead.push(0); dg.feverDead.push(0) }
  dg.epiDead[dec] += epiDead; dg.endDead[dec] += endDead; dg.feverDead[dec] += feverDead
  // Coarse passes.
  if (first) tolerancePass(s, dz, true)
  if (year % DZ.step === 0) {
    endemicPass(s, dz, tk)
    susPass(s, dz)
    tolerancePass(s, dz, false)
  }
  if (year % 10 === 0) quarantinePass(s, dz)
  // Trade costs next year: sick and lately struck places, quarantined ports.
  for (const id of dz.tmulList) dz.tmul[id] = 1
  dz.tmulList.length = 0
  {
    const H = dz.hit
    let w = 0
    for (let t = 0; t < H.length; t++) {
      const id = H[t]
      if (dz.tradeUntil[id] < year + 1 || !alive(s, id)) continue
      H[w++] = id
      dz.tmul[id] = DZ.tradeHit
      dz.tmulList.push(id)
    }
    H.length = w
  }
  for (let k = 0; k < dz.qSettlement.length; k++) {
    if (dz.qTo[k] >= 0) continue
    const id = dz.qSettlement[k]
    if (dz.tmul[id] === 1) dz.tmulList.push(id)
    dz.tmul[id] *= QUARANTINE.cost
  }
  dz.tmulOn = dz.tmulList.length > 0
  void D
}

/** Snapshot: fever tolerance and endemic diseases per people. */
export function diseaseSnapshot(dz: DiseaseState): void {
  const P = dz.P, D = dz.D
  const need = dz.snapUsed + P
  if (dz.snapTol.length < need) {
    let size = dz.snapTol.length
    while (size < need) size *= 2
    const a = new Uint8Array(size); a.set(dz.snapTol); dz.snapTol = a
    const b = new Uint8Array(size); b.set(dz.snapEnd); dz.snapEnd = b
  }
  for (let p = 0; p < P; p++) {
    dz.snapTol[dz.snapUsed + p] = (dz.tol[p] * 255 + 0.5) | 0
    let m = 0
    for (let d = 0; d < D; d++) if (dz.endemic[p * D + d] !== 0) m |= 1 << d
    dz.snapEnd[dz.snapUsed + p] = m
  }
  dz.snapUsed = need
}
