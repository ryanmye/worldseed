// religion: faiths and their followers (the religion system), and the hooks the polity system reads.
//
// Each people starts with its own traditional faith (a folk faith that does not proselytise; faith id = people id).
// Every settlement keeps RELIGION.slots faiths with shares of its people: a new settlement takes its parent's (settlers carry
// their faith), migrants mix theirs into the town they join. Universal faiths arise rarely (every slowStep years, with a chance
// that falls with the faiths already founded and rises in hard times) in a large, connected town of a people literate
// enough (Crafts); the town is the holy city. They spread every step by exposure: along trade routes and long-haul legs in
// proportion to their volume, to neighbours on the link graph, from a state church or a ruler of the faith, each source
// weighted by the faith's zeal and organisation (missionaries); a faith present grows by itself (a bandwagon, toward a ceiling
// lower in villages); towns or villages convert faster by the faith's appeal. Traditional faiths keep the isolated and fade
// where the new faith reaches.
// Every slow step a ruler may convert to the largest other universal faith in the capital and the realm (more readily when
// pious and when the old faith is a folk faith; rulers.ts traits), and a ruler's universal faith may become the state
// religion (more readily with a strong church). A zealous state religion under an intolerant ruler may persecute: grievance,
// pressed conversion, and minorities fleeing along trade routes to tolerant places (Migration events: goods' craftsmen follow,
// and they carry skills). Every schism step a large old faith may split in a realm ruled by another people or by a rival of the
// holy city's holder (Schism; rivalry between the two churches' states).
// Effects (hooks): grievance of members whose faith is not the ruler's (eased by assimilation: syncretism), rivalry between
// realms of opposed faiths (lower between co-religionists), holy war (a zealous state religion declares more readily on other
// faiths, most of all on the holder of its holy city), pilgrims' wealth at holy cities, and monasteries (technology links
// between peoples of one universal faith). Draws only from 'history-religion'.

import { EventType, FaithKind, JourneyKind, TECH_FIELD_COUNT, TOWN_POPULATION } from '../../../contract.ts'
import type { EventType as EventTypeT } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import { logEvent, logJourney } from '../state.ts'
import type { TradeState } from '../trade.ts'
import { CONVERT, EFFECTS, FOUNDING, PERSECUTION, RELIGION, SCHISM } from './params.ts'
import { E, K, createReligion, ensureReligionPolities, ensureReligionSettlements, growU8 } from './state.ts'
import type { ReligionState } from './state.ts'
import { TECH } from '../params.ts'
import { FAR, grip } from '../polity/state.ts'
import { milestoneSystem } from '../population.ts'

function logX(s: HistoryState, type: EventTypeT, settlement: number, other: number, value: number, extra: number): void {
  s.events.push({ year: s.year, type, settlement, other, value, extra })
}

// --- Faiths ------------------------------------------------------------------------------------------

function newFaith(s: HistoryState, rel: ReligionState, kind: number, parent: number, people: number, at: number, zeal: number, org: number, appeal: number): number {
  const f = rel.kind.length
  rel.kind.push(kind); rel.parent.push(parent); rel.people.push(people); rel.foundAt.push(at); rel.foundYear.push(s.year)
  rel.holy.push(kind === FaithKind.Universal ? at : -1); rel.zeal.push(zeal); rel.org.push(org); rel.appeal.push(appeal); rel.endYear.push(-1)
  rel.followers.push(0); rel.peak.push(0); rel.stronghold.push(at); rel.pilgrims.push(0)
  const P = s.know.P
  rel.reached = growU8(rel.reached, (f + 1) * P)
  if (people >= 0) rel.reached[f * P + people] = 1
  return f
}

/** Creates the religion system at year 0 (after the tribes are founded): one traditional faith per people. */
export function createReligionSystem(s: HistoryState): ReligionState {
  const rel = createReligion(s)
  const rng = rel.rng
  for (let p = 0; p < s.know.P; p++) newFaith(s, rel, FaithKind.Traditional, -1, p, s.founders[p], 0.05 + 0.1 * rng.next(), 0.15 * rng.next(), 0.3 * rng.next())
  catchUp(s, rel)
  return rel
}

/** New settlements since the last call take their parent's faiths (an original tribe its people's). */
function catchUp(s: HistoryState, rel: ReligionState): void {
  const n = s.count
  if (rel.seen >= n) return
  ensureReligionSettlements(rel, n)
  for (let id = rel.seen; id < n; id++) {
    const par = s.parent[id]
    const o = id * K
    if (par >= 0 && par < id) {
      const q = par * K
      rel.fN[id] = rel.fN[par]
      for (let k = 0; k < K; k++) { rel.fId[o + k] = rel.fId[q + k]; rel.fSh[o + k] = rel.fSh[q + k] }
    } else {
      rel.fN[id] = 1
      rel.fId[o] = s.people[id]
      rel.fSh[o] = 1
    }
  }
  rel.seen = n
}

/** Share of faith f at settlement id (0 if unknown). */
export function shareOf(rel: ReligionState, id: number, f: number): number {
  if (id >= rel.seen || f < 0) return 0
  const o = id * K
  for (let k = 0; k < rel.fN[id]; k++) if (rel.fId[o + k] === f) return rel.fSh[o + k]
  return 0
}

/** Majority faith of settlement id (one not yet seen: its parent's, or its people's traditional faith). */
export function majorityOf(s: HistoryState, rel: ReligionState, id: number): number {
  let x = id
  while (x >= rel.seen && s.parent[x] >= 0) x = s.parent[x]
  if (x >= rel.seen) return s.people[x]
  return rel.fN[x] > 0 ? rel.fId[x * K] : s.people[x]
}

/** Rulers hook: the faith of settlement id's majority (-1 without religion). */
export function capitalFaith(s: HistoryState, id: number): number {
  return s.rel === null || id < 0 ? -1 : majorityOf(s, s.rel, id)
}

/** The faith of polity p: its ruler's (rulers on), else its capital's majority. */
export function polityFaith(s: HistoryState, rel: ReligionState, p: number): number {
  const R = s.rul
  if (R !== null && p < R.pcap) {
    const r = R.cur[p]
    if (r >= 0 && R.rFaith[r] >= 0) return R.rFaith[r]
  }
  const ps = s.pol
  return ps === null ? -1 : majorityOf(s, rel, ps.pCapital[p])
}

/** Faith f is gone: its last followers fold into the other faiths of their settlements. */
function purge(s: HistoryState, rel: ReligionState, f: number): void {
  let fb = -1
  for (let g = 0; g < rel.kind.length; g++) if (g !== f && rel.endYear[g] < 0 && (fb < 0 || rel.followers[g] > rel.followers[fb])) fb = g
  for (let id = 0; id < rel.seen; id++) {
    const o = id * K
    const n = rel.fN[id]
    for (let k = 0; k < n; k++) {
      if (rel.fId[o + k] !== f) continue
      if (n === 1) { const t = s.people[id] !== f && rel.endYear[s.people[id]] < 0 ? s.people[id] : rel.peopleFaith[s.people[id]] >= 0 ? rel.peopleFaith[s.people[id]] : fb; if (t >= 0) rel.fId[o] = t; break }
      rel.fSh[o + k] = 0
      tidy(rel, id)
      break
    }
  }
}

/** Sorts settlement id's slots by share (descending), drops the negligible and normalises. */
function tidy(rel: ReligionState, id: number): void {
  const o = id * K
  let n = rel.fN[id]
  for (let a = 1; a < n; a++) {
    for (let b = a; b > 0 && rel.fSh[o + b] > rel.fSh[o + b - 1]; b--) {
      const x = rel.fSh[o + b]; rel.fSh[o + b] = rel.fSh[o + b - 1]; rel.fSh[o + b - 1] = x
      const y = rel.fId[o + b]; rel.fId[o + b] = rel.fId[o + b - 1]; rel.fId[o + b - 1] = y
    }
  }
  while (n > 1 && rel.fSh[o + n - 1] < RELIGION.minShare) n--
  rel.fN[id] = n
  let t = 0
  for (let k = 0; k < n; k++) t += rel.fSh[o + k]
  if (t > 0) for (let k = 0; k < n; k++) rel.fSh[o + k] /= t
  else { rel.fSh[o] = 1 }
}

/** The slot of faith f at id, made if missing (replacing the smallest when full, if it is below `room`); -1 if no room. */
function slotOf(rel: ReligionState, id: number, f: number, room: number): number {
  const o = id * K
  const n = rel.fN[id]
  for (let k = 0; k < n; k++) if (rel.fId[o + k] === f) return k
  if (n < K) { rel.fId[o + n] = f; rel.fSh[o + n] = 0; rel.fN[id] = n + 1; return n }
  const m = n - 1 // (sorted: the last is the smallest)
  if (rel.fSh[o + m] >= room) return -1
  rel.fId[o + m] = f // (the smallest minority folds into the newcomer)
  return m
}

/** Faith f gains `gain` of settlement id's people, taken from the others in proportion. */
function addShare(rel: ReligionState, id: number, f: number, gain: number): void {
  if (!(gain > 0)) return
  const j = slotOf(rel, id, f, gain)
  if (j < 0) return
  const o = id * K
  const T = 1 - rel.fSh[o + j]
  if (!(T > 1e-12)) return
  const g = gain < T ? gain : T
  const keep = 1 - g / T
  for (let k = 0; k < rel.fN[id]; k++) if (k !== j) rel.fSh[o + k] *= keep
  rel.fSh[o + j] += g
  tidy(rel, id)
}

/** Moves `amount` of id's people from faith a to faith b. */
function transfer(rel: ReligionState, id: number, a: number, b: number, amount: number): void {
  const o = id * K
  let ia = -1
  for (let k = 0; k < rel.fN[id]; k++) if (rel.fId[o + k] === a) ia = k
  if (ia < 0) return
  const x = amount < rel.fSh[o + ia] ? amount : rel.fSh[o + ia]
  if (!(x > 0)) return
  const j = slotOf(rel, id, b, 2)
  if (j < 0) return
  if (j === ia) return
  // (slotOf may have reused a's slot only when it was the smallest and b new: then the whole of it is b's)
  rel.fSh[o + ia] -= x
  rel.fSh[o + j] += x
  tidy(rel, id)
}

const MIXF = new Int32Array(2 * K), MIXS = new Float64Array(2 * K)

/** Mixes a share w of settlement `to`'s people with the faiths `ids` / `shs` (n of them). */
function mixInto(rel: ReligionState, to: number, ids: ArrayLike<number>, shs: ArrayLike<number>, n: number, w: number): void {
  const o = to * K
  let m = 0
  for (let k = 0; k < rel.fN[to]; k++) { MIXF[m] = rel.fId[o + k]; MIXS[m] = (1 - w) * rel.fSh[o + k]; m++ }
  for (let k = 0; k < n; k++) {
    let at = -1
    for (let j = 0; j < m; j++) if (MIXF[j] === ids[k]) at = j
    if (at < 0) { MIXF[m] = ids[k]; MIXS[m] = 0; at = m++ }
    MIXS[at] += w * shs[k]
  }
  // The largest K.
  let c = 0
  for (let k = 0; k < K && k < m; k++) {
    let best = -1
    for (let j = 0; j < m; j++) if (MIXS[j] >= 0 && (best < 0 || MIXS[j] > MIXS[best] || (MIXS[j] === MIXS[best] && MIXF[j] < MIXF[best]))) best = j
    if (best < 0) break
    rel.fId[o + c] = MIXF[best]; rel.fSh[o + c] = MIXS[best]; c++
    MIXS[best] = -1
  }
  rel.fN[to] = c
  tidy(rel, to)
}

const ONE_F = new Int32Array(1), ONE_S = new Float64Array([1])

// --- Events ------------------------------------------------------------------------------------------------

/** The events since the last look: migrants mix their faith in; conquests and sacks are woes (and holy cities may fall). */
function scanEvents(s: HistoryState, rel: ReligionState): void {
  const ev = s.events
  const end = ev.length
  let sk = 0
  const skip = rel.skip
  while (sk < skip.length && skip[sk] < rel.evSeen) sk++
  const ps = s.pol
  for (let i = rel.evSeen; i < end; i++) {
    const e = ev[i]
    if (e.type === EventType.Migration) {
      if (sk < skip.length && skip[sk] === i) { sk++; continue }
      const from = e.settlement, to = e.other
      if (from >= rel.seen || to >= rel.seen || s.abandoned[to] >= 0) continue
      const pt = s.pop[to]
      let w = pt > 0 ? e.value / pt : 1
      if (w > 0.5) w = 0.5
      if (!(w > 0)) continue
      const q = from * K
      mixInto(rel, to, rel.fId.subarray(q, q + rel.fN[from]), rel.fSh.subarray(q, q + rel.fN[from]), rel.fN[from], w)
    } else if (e.type === EventType.Conquered || e.type === EventType.Sacked) {
      const v = e.settlement
      if (v < rel.cap) rel.woe[v] = s.year
      if (e.type === EventType.Conquered && ps !== null && v < ps.seen) {
        const q = ps.polity[v]
        for (let f = 0; f < rel.kind.length; f++) {
          if (rel.holy[f] !== v || rel.endYear[f] >= 0) continue
          if (q >= 0 && polityFaith(s, rel, q) === f) continue
          logX(s, EventType.HolyCityFell, v, e.other, f, e.value)
          rel.diag.holyFell++
        }
      }
    }
  }
  rel.skip.length = 0
  rel.evSeen = end
}

// --- The yearly system -------------------------------------------------------------------------------------

/** System (end of year, before the snapshots): see the file comment. */
export function religionYear(s: HistoryState, rel: ReligionState, ts: TradeState): void {
  catchUp(s, rel)
  scanEvents(s, rel)
  if (s.pol !== null) ensureReligionPolities(rel, s.pol.P)
  // Pilgrims (yearly, from the last step's figures).
  for (let f = 0; f < rel.kind.length; f++) {
    const h = rel.holy[f]
    if (h < 0 || rel.endYear[f] >= 0 || s.abandoned[h] >= 0) continue
    let x = rel.pilgrims[f]
    const cap = RELIGION.pilgrimCap * s.pop[h]
    if (x > cap) x = cap
    if (x > 0) s.wealth[h] += x
  }
  const y = s.year
  if (y % RELIGION.step === 0) { spreadStep(s, rel, ts); if (s.pol !== null) flightStep(s, rel, ts) }
  if (y % RELIGION.slowStep === 0) { if (s.pol !== null) rulersStep(s, rel); foundStep(s, rel, ts) }
  if (y % RELIGION.schismStep === 0 && s.pol !== null) schismStep(s, rel)
}

/** Exposure of settlement i to faith f (weight v, from settlement src). */
function expose(rel: ReligionState, i: number, f: number, v: number, src: number): void {
  const o = i * E
  const n = rel.eN[i]
  for (let k = 0; k < n; k++) if (rel.eF[o + k] === f) { rel.eV[o + k] += v; return }
  if (n < E) { rel.eF[o + n] = f; rel.eV[o + n] = v; rel.eSrc[o + n] = src; rel.eN[i] = n + 1; return }
  let m = 0
  for (let k = 1; k < E; k++) if (rel.eV[o + k] < rel.eV[o + m]) m = k
  if (rel.eV[o + m] < v) { rel.eF[o + m] = f; rel.eV[o + m] = v; rel.eSrc[o + m] = src }
}

/** Exposure of i to the universal faiths of j, weight w. */
function exposeFrom(rel: ReligionState, i: number, j: number, w: number, pull: Float64Array): void {
  const o = j * K
  for (let k = 0; k < rel.fN[j]; k++) {
    const f = rel.fId[o + k]
    const sh = rel.fSh[o + k]
    if (sh < 0.02 || pull[f] === 0) continue
    expose(rel, i, f, w * sh * pull[f], j)
  }
}

let PULL = new Float64Array(0)

/** How readily faith f converts a town, a village or a settlement between (its appeal). */
function fitOf(rel: ReligionState, f: number, town: boolean, village: boolean): number {
  const X = RELIGION
  const a = rel.appeal[f]
  return town ? X.townBase + X.townAppeal * a : village ? X.villageBase - X.villageAppeal * a : 1
}
const BWF = new Int32Array(K), BWS = new Float64Array(K)

/** Every step: exposure, conversion, followers, faiths that died, peoples' majority faiths. */
function spreadStep(s: HistoryState, rel: ReligionState, ts: TradeState): void {
  const X = RELIGION
  const dt = X.step
  const F = rel.kind.length
  if (PULL.length < F) PULL = new Float64Array(F + 16)
  const pull = PULL
  for (let f = 0; f < F; f++) pull[f] = rel.kind[f] === FaithKind.Universal && rel.endYear[f] < 0 ? X.pullBase + rel.zeal[f] + X.pullOrg * rel.org[f] : 0
  const living = s.living
  for (let t = 0; t < living.length; t++) rel.eN[living[t]] = 0
  // Trade routes and long-haul legs.
  const list = ts.openList
  for (let t = 0; t < list.length; t++) {
    const r = list[t]
    const v = ts.rVol[r]
    if (!(v > 0)) continue
    const a = ts.rA[r], b = ts.rB[r]
    if (a >= rel.seen || b >= rel.seen) continue
    const w = (X.trade * v) / (v + X.tradeHalf)
    exposeFrom(rel, a, b, w, pull)
    exposeFrom(rel, b, a, w, pull)
  }
  const g = s.goods
  if (g !== null) {
    for (let k = 0; k < g.legCount; k++) {
      if (!g.legOpen[k]) continue
      const v = g.legVol[k]
      if (!(v > 0)) continue
      const a = g.legA[k], b = g.legB[k]
      if (a >= rel.seen || b >= rel.seen || s.abandoned[a] >= 0 || s.abandoned[b] >= 0) continue
      const w = (X.lane * v) / (v + X.laneHalf)
      exposeFrom(rel, a, b, w, pull)
      exposeFrom(rel, b, a, w, pull)
    }
  }
  // Neighbours on the link graph; the realm's church and ruler.
  const ps = s.pol
  const year = s.year
  for (let t = 0; t < living.length; t++) {
    const i = living[t]
    if (i >= rel.seen) continue
    if (i < ts.adjCount) {
      for (let k = ts.adjOff[i]; k < ts.adjOff[i + 1]; k++) {
        const j = ts.adjNode[k]
        if (j >= rel.seen || s.abandoned[j] >= 0) continue
        exposeFrom(rel, i, j, X.near, pull)
      }
    }
    if (ps === null || i >= ps.seen) continue
    const p = ps.polity[i]
    if (p < 0 || p >= rel.pcap) continue
    const cap = ps.pCapital[p]
    const sf = rel.state[p]
    // (the church's and the court's reach falls with the capital's grip: the remote countryside keeps its old ways)
    const gr = ps.dist[i] < FAR ? grip(ps.dist[i], ps.pReach[p]) : 0
    if (!(gr > 0)) continue
    if (sf >= 0 && rel.endYear[sf] < 0) {
      expose(rel, i, sf, gr * X.state * (1 + rel.zeal[sf]), cap)
      if (rel.persUntil[p] > year) expose(rel, i, sf, gr * X.persecuteConvert, cap)
    } else {
      const rf = polityFaith(s, rel, p)
      if (rf >= 0 && pull[rf] > 0) expose(rel, i, rf, gr * X.ruler, cap)
    }
  }
  // Conversion.
  const P = s.know.P
  for (let t = 0; t < living.length; t++) {
    const i = living[t]
    if (i >= rel.seen) continue
    const pop = s.pop[i]
    const town = pop >= TOWN_POPULATION, village = pop < X.villagePop
    const ceil = village ? X.ceilingVillage : X.ceilingTown
    const o = i * K
    // The bandwagon of the universal faiths present.
    let nb = 0
    for (let k = 0; k < rel.fN[i]; k++) { const f = rel.fId[o + k]; if (pull[f] === 0) continue; BWF[nb] = f; BWS[nb] = rel.fSh[o + k]; nb++ }
    for (let j = 0; j < nb; j++) {
      const f = BWF[j], sh = BWS[j]
      const room = ceil - sh
      if (room <= 0) continue
      let gain = dt * X.bandwagon * sh * room * fitOf(rel, f, town, village)
      if (gain > X.maxGain) gain = X.maxGain
      addShare(rel, i, f, gain)
    }
    // Exposure.
    const eo = i * E
    for (let k = 0; k < rel.eN[i]; k++) {
      const f = rel.eF[eo + k]
      let gain = dt * X.rate * rel.eV[eo + k] * fitOf(rel, f, town, village) * (1 - shareOf(rel, i, f))
      if (gain > X.maxGain) gain = X.maxGain
      addShare(rel, i, f, gain)
      // A faith reaching a people.
      const people = s.people[i]
      if (!rel.reached[f * P + people] && shareOf(rel, i, f) >= X.reach) {
        rel.reached[f * P + people] = 1
        logX(s, EventType.FaithReached, i, rel.eSrc[eo + k], f, people)
      }
    }
    const m = rel.fId[o]
    if (rel.firstUni[i] < 0 && rel.kind[m] === FaithKind.Universal) rel.firstUni[i] = year
  }
  // Followers, strongholds, faiths gone; peoples' faiths (monasteries); pilgrims.
  const fol = new Float64Array(F), best = new Float64Array(F), bestAt = new Int32Array(F).fill(-1)
  const pp = new Float64Array(P * F), ptot = new Float64Array(P)
  for (let t = 0; t < living.length; t++) {
    const i = living[t]
    if (i >= rel.seen) continue
    const o = i * K
    const pop = s.pop[i]
    const people = s.people[i]
    ptot[people] += pop
    for (let k = 0; k < rel.fN[i]; k++) {
      const f = rel.fId[o + k]
      const x = pop * rel.fSh[o + k]
      fol[f] += x
      pp[people * F + f] += x
      if (x > best[f]) { best[f] = x; bestAt[f] = i }
    }
  }
  for (let f = 0; f < F; f++) {
    rel.followers[f] = fol[f]
    if (bestAt[f] >= 0) rel.stronghold[f] = bestAt[f]
    if (fol[f] > rel.peak[f]) rel.peak[f] = fol[f]
    if (rel.endYear[f] < 0 && (!(fol[f] > 0) || (fol[f] < X.dieBelow && rel.peak[f] >= X.dieOnce))) {
      rel.endYear[f] = year
      let at = rel.stronghold[f]
      if (s.abandoned[at] >= 0 && s.abandoned[at] < year) at = living.length > 0 ? living[0] : at // (its last stronghold is gone: logged at the oldest living settlement)
      logX(s, EventType.FaithDied, at, -1, f, -1)
      if (fol[f] > 0) purge(s, rel, f)
    }
  }
  for (let p = 0; p < P; p++) {
    let bf = -1, bx = 0
    for (let f = 0; f < F; f++) if (pull[f] > 0 && pp[p * F + f] > bx) { bx = pp[p * F + f]; bf = f }
    rel.peopleFaith[p] = bf >= 0 && bx >= 0.5 * ptot[p] ? bf : -1
  }
  for (let f = 0; f < F; f++) {
    const h = rel.holy[f]
    rel.pilgrims[f] = 0
    if (h < 0 || rel.endYear[f] >= 0 || s.abandoned[h] >= 0) continue
    let safety = 1
    if (ps !== null && h < ps.seen) {
      safety = 1 - ps.danger[h]
      const q = ps.polity[h]
      if (q >= 0 && polityFaith(s, rel, q) !== f) safety *= X.hostileHoly
      if (safety < 0) safety = 0
    }
    rel.pilgrims[f] = X.pilgrim * fol[f] * safety
  }
}

// --- Rulers, state churches, persecution ---------------------------------------------------------------------

/** Every slow step: rulers convert, state religions are adopted, persecutions begin and end. */
function rulersStep(s: HistoryState, rel: ReligionState): void {
  const ps = s.pol
  if (ps === null) return
  const R = s.rul
  const F = rel.kind.length
  const PP = ps.P
  const tot = new Float64Array(PP * F), ppop = new Float64Array(PP)
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const i = living[t]
    if (i >= ps.seen || i >= rel.seen) continue
    const p = ps.polity[i]
    if (p < 0) continue
    const pop = s.pop[i]
    ppop[p] += pop
    const o = i * K
    for (let k = 0; k < rel.fN[i]; k++) tot[p * F + rel.fId[o + k]] += pop * rel.fSh[o + k]
  }
  const rng = rel.rng
  const year = s.year
  const C = CONVERT, Z = PERSECUTION
  for (const p of ps.alive) {
    if (ps.pEnded[p] >= 0 || !(ppop[p] > 0)) continue
    const c = ps.pCapital[p]
    let rf = polityFaith(s, rel, p)
    // A ruler converts.
    if (R !== null && p < R.pcap && R.union[p] < 0) {
      const r = R.cur[p]
      if (r >= 0 && R.rEnd[r] < 0) {
        let bf = -1, bx = 0
        for (let f = 0; f < F; f++) {
          if (f === rf || rel.kind[f] !== FaithKind.Universal || rel.endYear[f] >= 0) continue
          const x = C.capital * shareOf(rel, c, f) + C.realm * tot[p * F + f] / ppop[p]
          // (from one universal faith to another only when the capital has turned)
          if (rf >= 0 && rel.kind[rf] === FaithKind.Universal && shareOf(rel, c, f) <= shareOf(rel, c, rf)) continue
          if (x > bx) { bx = x; bf = f }
        }
        if (bf >= 0) {
          const chance = C.convert * smoothstep(C.low, C.high, bx) * (C.pietyBase + R.rPiety[r]) * (rf >= 0 && rel.kind[rf] === FaithKind.Universal ? C.switch : 1)
          if (chance > 0 && rng.next() < chance) {
            const person = R.rPerson[r]
            for (const p2 of ps.alive) if (p2 < R.pcap && R.cur[p2] >= 0 && R.rPerson[R.cur[p2]] === person) R.rFaith[R.cur[p2]] = bf // (both thrones of a union)
            logX(s, EventType.RulerConverted, c, -1, bf, rf)
            rel.diag.conversions++
            rf = bf
          }
        }
      }
    }
    // A state religion.
    if (rf >= 0 && rel.kind[rf] === FaithKind.Universal && rel.state[p] !== rf && rel.endYear[rf] < 0) {
      if (rng.next() < C.adopt * (C.adoptBase + rel.org[rf])) {
        const old = rel.state[p]
        rel.state[p] = rf
        logX(s, EventType.StateReligion, c, -1, rf, old)
        rel.diag.adopted++
        rel.persUntil[p] = -1000000
      }
    }
    // Persecution.
    const sf = rel.state[p]
    if (rel.persUntil[p] > year && R !== null && p < R.pcap && R.cur[p] !== rel.persRuler[p]) rel.persUntil[p] = year
    if (sf >= 0 && rel.persUntil[p] <= year && rel.zeal[sf] >= Z.zeal && R !== null && p < R.pcap && R.cur[p] >= 0) {
      const tol = R.rTol[R.cur[p]]
      const minority = 1 - tot[p * F + sf] / ppop[p]
      if (tol < Z.tolerance && minority >= Z.minority && rng.next() < Z.chance * rel.zeal[sf] * (1 - tol)) {
        let bf = -1, bx = 0
        for (let f = 0; f < F; f++) if (f !== sf && tot[p * F + f] > bx) { bx = tot[p * F + f]; bf = f }
        rel.persUntil[p] = year + rng.int(Z.min, Z.max)
        rel.persFaith[p] = bf
        rel.persRuler[p] = R.cur[p]
        logX(s, EventType.Persecution, c, -1, sf, bf)
        rel.diag.persecutions++
      }
    }
  }
}

/** Every step: minorities flee persecution along trade routes to tolerant places. */
function flightStep(s: HistoryState, rel: ReligionState, ts: TradeState): void {
  const ps = s.pol
  if (ps === null) return
  const year = s.year
  let any = false
  for (const p of ps.alive) if (p < rel.pcap && rel.persUntil[p] > year) { any = true; break }
  if (!any) return
  // Open routes per settlement (CSR over the routes' ends).
  const n = s.count
  const off = new Int32Array(n + 1)
  const list = ts.openList
  for (const r of list) { off[ts.rA[r] + 1]++; off[ts.rB[r] + 1]++ }
  for (let i = 0; i < n; i++) off[i + 1] += off[i]
  const adj = new Int32Array(off[n])
  const fill = off.slice(0, n)
  for (const r of list) { adj[fill[ts.rA[r]]++] = r; adj[fill[ts.rB[r]]++] = r }
  const Z = PERSECUTION
  const living = s.living.slice()
  let fled = false
  for (const i of living) {
    if (i >= ps.seen || i >= rel.seen || s.abandoned[i] >= 0) continue
    const p = ps.polity[i]
    if (p < 0 || p >= rel.pcap || rel.persUntil[p] <= year) continue
    const pop = s.pop[i]
    if (pop < Z.fleeMin) continue
    const sf = rel.state[p]
    const o = i * K
    let g = -1, gs = 0
    for (let k = 0; k < rel.fN[i]; k++) if (rel.fId[o + k] !== sf && rel.fSh[o + k] > gs) { gs = rel.fSh[o + k]; g = rel.fId[o + k] }
    if (g < 0 || gs < Z.fleeShare) continue
    const group = Math.floor(Z.flee * gs * pop)
    if (group < 20) continue
    let to = -1, route = -1, bestS = 0
    for (let k = off[i]; k < off[i + 1]; k++) {
      const r = adj[k]
      const j = ts.rA[r] === i ? ts.rB[r] : ts.rA[r]
      if (j >= ps.seen || j >= rel.seen || s.abandoned[j] >= 0 || s.outpost[j] || s.food[j] < 0.9) continue
      const q = ps.polity[j]
      if (q === p || (q >= 0 && q < rel.pcap && rel.persUntil[q] > year)) continue
      const sc = s.pop[j] * (0.2 + shareOf(rel, j, g))
      if (sc > bestS) { bestS = sc; to = j; route = r }
    }
    if (to < 0) continue
    // They go: people, faith, skills.
    s.pop[i] -= group
    s.pop[to] += group
    rel.skip.push(s.events.length)
    logEvent(s, EventType.Migration, i, to, group)
    const path = ts.rPath[route]
    const way = ts.rA[route] === i ? path.slice() : path.slice().reverse()
    logJourney(s, { departYear: Math.max(s.founded[i], year - Math.min(3, 0.5 + 0.03 * way.length)), arriveYear: year, from: i, to, size: group, kind: JourneyKind.Migrants, path: way })
    // The faith left behind, and brought.
    const left = pop - group
    for (let k = 0; k < rel.fN[i]; k++) {
      const x = rel.fSh[o + k] * pop - (rel.fId[o + k] === g ? group : 0)
      rel.fSh[o + k] = x > 0 ? x / left : 0
    }
    tidy(rel, i)
    ONE_F[0] = g
    mixInto(rel, to, ONE_F, ONE_S, 1, group / s.pop[to])
    fleeSkills(s, i, to, group)
    rel.diag.flights++
    rel.diag.fled += group
    fled = true
  }
  if (fled) milestoneSystem(s) // (the refugees may make a town or a city of their refuge this year)
}

/** Refugees of another people carry their skills (as polities' refugees do, without the danger gate). */
function fleeSkills(s: HistoryState, from: number, to: number, g: number): void {
  const a = s.people[from], b = s.people[to]
  if (a === b) return
  let popB = 0
  const living = s.living
  for (let t = 0; t < living.length; t++) if (s.people[living[t]] === b) popB += s.pop[living[t]]
  if (!(popB > 0)) return
  const f = (PERSECUTION.rate * g) / popB
  for (let k = 0; k < TECH_FIELD_COUNT; k++) {
    const d = s.tech[a * TECH_FIELD_COUNT + k] - s.tech[b * TECH_FIELD_COUNT + k]
    if (!(d > 0)) continue
    let x = f * d
    if (x > PERSECUTION.maxSkill) x = PERSECUTION.maxSkill
    s.tech[b * TECH_FIELD_COUNT + k] += x
  }
}

// --- New faiths and schisms ---------------------------------------------------------------------------------------

/** Every slow step: perhaps a universal faith arises in a large, connected, literate town (more likely in hard times). */
function foundStep(s: HistoryState, rel: ReligionState, ts: TradeState): void {
  const X = FOUNDING
  const F = rel.kind.length
  if (F >= X.max) return
  let n = 0
  for (let f = 0; f < F; f++) if (rel.kind[f] === FaithKind.Universal) n++
  const living = s.living
  let largest = 0
  for (let t = 0; t < living.length; t++) if (s.pop[living[t]] > largest) largest = s.pop[living[t]]
  let bar = 0.5 * largest
  if (bar < X.popMin) bar = X.popMin
  if (bar > X.pop) bar = X.pop
  const deg = new Int32Array(s.count)
  for (const r of ts.openList) { deg[ts.rA[r]]++; deg[ts.rB[r]]++ }
  const holyHere = new Uint8Array(s.count) // (a holy city does not found a second faith)
  for (let f = 0; f < F; f++) if (rel.holy[f] >= 0) holyHere[rel.holy[f]] = 1
  const cand: number[] = [], wt: number[] = []
  let sum = 0, woeSum = 0, popSum = 0
  const year = s.year
  for (let t = 0; t < living.length; t++) {
    const i = living[t]
    if (i >= rel.seen || s.pop[i] < bar || deg[i] < X.routes || holyHere[i]) continue
    if (s.tech[s.people[i] * TECH_FIELD_COUNT + 3] < X.crafts) continue
    const woe = year - s.lastFamine[i] <= X.woeYears || year - rel.woe[i] <= X.woeYears
    const w = s.pop[i] * (woe ? 1 + X.crisis : 1)
    cand.push(i); wt.push(w)
    sum += w; popSum += s.pop[i]
    if (woe) woeSum += s.pop[i]
  }
  if (cand.length === 0) return
  const rng = rel.rng
  const chance = (X.found * (1 + X.crisis * (woeSum / popSum))) / (1 + X.crowd * n)
  if (rng.next() >= chance) return
  let x = rng.next() * sum
  let at = cand[cand.length - 1]
  for (let k = 0; k < cand.length; k++) { x -= wt[k]; if (x < 0) { at = cand[k]; break } }
  const f = newFaith(s, rel, FaithKind.Universal, -1, s.people[at], at, 0.2 + 0.8 * rng.next(), rng.next(), rng.next())
  addShare(rel, at, f, X.share)
  rel.diag.founded++
  logX(s, EventType.FaithFounded, at, -1, f, -1)
}

/** Every schism step: a large old faith may split in a realm of another people or a rival of its holy city's holder. */
function schismStep(s: HistoryState, rel: ReligionState): void {
  const ps = s.pol
  if (ps === null) return
  const X = SCHISM
  const F = rel.kind.length
  const rng = rel.rng
  for (let f = 0; f < F; f++) {
    if (rel.kind[f] !== FaithKind.Universal || rel.endYear[f] >= 0 || s.year - rel.foundYear[f] < X.age || rel.followers[f] < X.followers) continue
    let last = -1000000
    for (let g = f + 1; g < F; g++) if (rel.parent[g] === f && rel.foundYear[g] > last) last = rel.foundYear[g]
    if (s.year - last < X.gap) continue
    if (rel.kind.length >= FOUNDING.max) return
    const h = rel.holy[f]
    const holder = h >= 0 && h < ps.seen && s.abandoned[h] < 0 ? ps.polity[h] : -1
    let best = -1
    for (const p of ps.alive) {
      if (p === holder || ps.pEnded[p] >= 0 || ps.pMembers[p] < 3) continue
      if (polityFaith(s, rel, p) !== f && rel.state[p] !== f) continue
      if (shareOf(rel, ps.pCapital[p], f) < 0.5) continue
      const foreign = ps.pPeople[p] !== rel.people[f]
      let rival = false
      if (holder >= 0) {
        const lo = p < holder ? p : holder, hi = p < holder ? holder : p
        const r = ps.relIndex.get(lo * 65536 + hi)
        rival = r !== undefined && ps.relR[r] >= X.rival
      }
      if (!foreign && !rival) continue
      if (best < 0 || ps.pPop[p] > ps.pPop[best]) best = p
    }
    if (best < 0 || rng.next() >= X.chance) continue
    schism(s, rel, f, best)
  }
}

function schism(s: HistoryState, rel: ReligionState, f: number, p: number): void {
  const ps = s.pol
  if (ps === null) return
  const X = SCHISM
  const rng = rel.rng
  const cap = ps.pCapital[p]
  const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
  const g = newFaith(s, rel, FaithKind.Universal, f, ps.pPeople[p], cap, clamp01(rel.zeal[f] + 0.4 * rng.next() - 0.1), clamp01(rel.org[f] + 0.4 * rng.next() - 0.2), clamp01(rel.appeal[f] + 0.4 * rng.next() - 0.2))
  const living = s.living
  for (let t = 0; t < living.length; t++) {
    const i = living[t]
    if (i >= ps.seen || i >= rel.seen || ps.polity[i] !== p) continue
    transfer(rel, i, f, g, shareOf(rel, i, f) * (i === cap ? X.capital : X.members))
  }
  const R = s.rul
  if (R !== null && p < R.pcap && R.cur[p] >= 0) {
    const person = R.rPerson[R.cur[p]]
    for (const p2 of ps.alive) if (p2 < R.pcap && R.cur[p2] >= 0 && R.rPerson[R.cur[p2]] === person) R.rFaith[R.cur[p2]] = g
  }
  rel.state[p] = g
  // The two churches' states fall out.
  for (let r = 0; r < ps.relA.length; r++) {
    const a = ps.relA[r], b = ps.relB[r]
    if (a !== p && b !== p) continue
    const q = a === p ? b : a
    if (ps.pEnded[q] >= 0 || (rel.state[q] !== f && polityFaith(s, rel, q) !== f)) continue
    const x = ps.relR[r] + X.rivalry
    ps.relR[r] = x > 2 ? 2 : x
  }
  rel.diag.schisms++
  logX(s, EventType.Schism, cap, rel.holy[f], g, p)
}

// --- Hooks ----------------------------------------------------------------------------------------------------------

/** Unrest hook: grievance of member i of polity p from faith (another than the ruler's; persecution). */
export function faithGrievance(s: HistoryState, rel: ReligionState, i: number, p: number): number {
  if (i >= rel.seen) return 0
  const ps = s.pol
  if (ps === null) return 0
  const rf = polityFaith(s, rel, p)
  if (rf < 0 || rel.kind[rf] !== FaithKind.Universal) return 0
  const X = EFFECTS
  const off = 1 - shareOf(rel, i, rf)
  if (!(off > 0.001)) return 0
  let g = X.grievance * off * (1 - X.sync * ps.assim[i])
  if (p < rel.pcap) {
    if (rel.state[p] === rf) g *= X.stateChurch
    if (rel.persUntil[p] > s.year) g += X.persecute * off
  }
  return g
}

/** Relations hook: rivalry a year from the faiths of a and b. */
export function faithRivalry(s: HistoryState, rel: ReligionState, a: number, b: number): number {
  const fa = polityFaith(s, rel, a), fb = polityFaith(s, rel, b)
  if (fa < 0 || fb < 0) return 0
  const X = EFFECTS
  const ua = rel.kind[fa] === FaithKind.Universal, ub = rel.kind[fb] === FaithKind.Universal
  if (fa === fb) return ua ? -X.same : 0
  if (!ua && !ub) return 0
  const za = ua ? rel.zeal[fa] : 0, zb = ub ? rel.zeal[fb] : 0
  let d = X.differ * (za > zb ? za : zb)
  if (rel.parent[fa] === fb || rel.parent[fb] === fa) d += X.schism
  return d
}

/** Declaration hook: holy war multiplier of p declaring on q. */
export function holyDrive(s: HistoryState, rel: ReligionState, p: number, q: number): number {
  if (p >= rel.pcap) return 1
  const sf = rel.state[p]
  if (sf < 0) return 1
  const fq = polityFaith(s, rel, q)
  if (fq === sf) return 1
  const X = EFFECTS
  let m = 1 + X.holy * rel.zeal[sf] * (fq < 0 || rel.kind[fq] === FaithKind.Traditional ? X.heathen : 1)
  const h = rel.holy[sf]
  const ps = s.pol
  if (ps !== null && h >= 0 && h < ps.seen && s.abandoned[h] < 0 && ps.polity[h] === q) m += X.crusade
  return m
}

/** Declaration hook: war w (p on q) is a holy war when p's zealous state religion (and its pious ruler) faces another faith. */
export function holyWarDeclared(s: HistoryState, rel: ReligionState, p: number, q: number, w: number): void {
  const ps = s.pol
  if (ps === null || p >= rel.pcap || w >= ps.wKind.length) return
  const sf = rel.state[p]
  if (sf < 0 || rel.zeal[sf] < EFFECTS.holyZeal || polityFaith(s, rel, q) === sf) return
  const R = s.rul
  if (R !== null && p < R.pcap && R.cur[p] >= 0 && R.rPiety[R.cur[p]] < EFFECTS.holyPiety) return
  rel.holyWars.push(w)
  rel.diag.holyWars++
  logX(s, EventType.HolyWar, ps.pCapital[p], ps.pCapital[q], w, sf)
}

/** Technology hook: monasteries link peoples whose majority shares a universal faith. */
export function faithLinks(rel: ReligionState, link: Float64Array, P: number): void {
  const pf = rel.peopleFaith
  for (let a = 0; a < P; a++) {
    const f = pf[a]
    if (f < 0) continue
    for (let b = 0; b < P; b++) {
      if (b === a || pf[b] !== f || !(link[a * P + b] > 0)) continue
      let x = link[a * P + b] + EFFECTS.monastery
      if (x > link[a * P + b] + TECH.near) x = link[a * P + b] + TECH.near
      link[a * P + b] = x
    }
  }
}

/** disease (hook): a plague at settlement id counts as a woe (founding crises of faiths). */
export function religionPlague(s: HistoryState, id: number): void {
  const rel = s.rel
  if (rel !== null && id < rel.cap) rel.woe[id] = s.year
}

/** tourism (hook): pilgrims' income a year at settlement id (0 unless it is a holy city). */
export function pilgrimsAt(rel: ReligionState, id: number): number {
  let x = 0
  for (let f = 0; f < rel.kind.length; f++) if (rel.holy[f] === id && rel.endYear[f] < 0) x += rel.pilgrims[f]
  return x
}

// --- Snapshots ----------------------------------------------------------------------------------------------------

const byte = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0)

/** Snapshot: majority faith and its share per settlement (expedition bases take their parent's), state religion per polity. */
export function religionSnapshot(s: HistoryState, rel: ReligionState): void {
  catchUp(s, rel)
  const n = s.count
  rel.snF = growU8(rel.snF, rel.snUsed + n)
  rel.snS = growU8(rel.snS, rel.snUsed + n)
  const o = rel.snUsed
  for (let id = 0; id < n; id++) {
    let f = 255, sh = 0
    if (s.abandoned[id] < 0) {
      let x = id
      if (s.outpost[id] && s.parent[id] >= 0 && s.abandoned[s.parent[id]] < 0) x = s.parent[id]
      f = rel.fId[x * K]
      sh = byte(rel.fSh[x * K])
    }
    rel.snF[o + id] = f
    rel.snS[o + id] = sh
  }
  rel.snOff.push(o)
  rel.snCount.push(n)
  rel.snUsed += n
  const ps = s.pol
  const P = ps === null ? 0 : ps.P
  rel.stF = growU8(rel.stF, rel.stUsed + P)
  if (ps !== null) {
    ensureReligionPolities(rel, P)
    for (let p = 0; p < P; p++) rel.stF[rel.stUsed + p] = ps.pEnded[p] < 0 && rel.state[p] >= 0 ? rel.state[p] + 1 : 0
  }
  rel.stOff.push(rel.stUsed)
  rel.stCount.push(P)
  rel.stUsed += P
}
