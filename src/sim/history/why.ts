// causes: the causal explorer's recorders (HistoryOptions.causes; causal-explorer.md §3). Each recorder runs at a site that
// already computes what it records and copies it, at most scaled or split, into side arrays here. Nothing in the simulation
// reads them and they draw nothing, so the history is the same with causes on or off, but for History.why.
//
// Rivalry parts (relations.ts): one accumulator per term of the rivalry rule, c_k <- c_k + step (term_k - decay c_k), so the
// parts sum to the rivalry; at the clamps (0 and 2) and at the few other writers of rivalry (secession, schism, alarm, peace)
// they are rescaled or the change is booked to one part (exact without a clamp; proportional at it).
// Unrest parts (unrest.ts): the same per member over the terms of grievance(), by the EMA unrest follows; a jump of unrest
// that grievance did not make (a crushed revolt's aftermath, a break-up) is booked to UnrestPart.Shock, a fall rescales.
// Rows refer to the run's raw event log (HistoryState.events); index.ts maps them to History.events at assembly.

import type { CauseRecords, HistoryEvent } from '../../contract.ts'
import { CrisisBit, RIVALRY_PARTS, RivalryPart, UNREST_PARTS, UNREST_PART_GROUP, UnrestPart, WarKind, WarWhyFlag } from '../../contract.ts'
import type { PolityState } from './polity/state.ts'
import type { RulerState } from './rulers/state.ts'
import { RULERS, SUCCESSION } from './rulers/params.ts'

const H = RULERS.heirs
const RP = RIVALRY_PARTS
const UP = UNREST_PARTS

/** The recorders' state (HistoryState.why and PolityState.why: one object). */
export interface WhyRec {
  // rivalry parts per relation: rel[r * RP + k]
  rel: Float64Array
  // the declaration being rolled for (declarations parks it; declare takes it)
  pend: boolean
  pRv: number; pAdv: number; pE: number; pMul: number; pFlags: number; pFront: number; pDrive: number
  // WarWhy, one row per war (in war id order)
  wRiv: number[]; wParts: number[]; wOdds: number[]; wExh: number[]; wMul: number[]; wFlags: number[]; wFront: number[]
  /** The exact drive the roll used, per war (0 when not rolled): tests only, not assembled. */
  wDrive: number[]
  // unrest parts per settlement: u[i * UP + k]; the instantaneous terms of the last grievance() call
  u: Float64Array
  sub: Float64Array
  rEvent: number[]; rUnrest: number[]; rPart: number[]; rShare: number[]; rOdds: number[]
  /** The RevoltCause group with the largest instantaneous terms at each revolt (tests: it must be the event's cause). */
  rInstant: number[]
  // famine factors per settlement (foodSystem), then the rows (populationSystem)
  fH: Float64Array; fHs: Float64Array; fLeft: Float64Array; fCrowd: Float64Array; fLocal: Float64Array
  mEvent: number[]; mHarvest: number[]; mStored: number[]; mRavaged: number[]; mCrowded: number[]; mImports: number[]; mRegion: number[]
  // weather rows per year (row 0: year 0, all 0)
  regions: number
  region: Uint8Array
  wh: Uint8Array; wd: Uint8Array; wc: Uint8Array; wYears: number
  // abandoned, absorbed (by polity: its PolityEnded is found at assembly), crises
  aEvent: number[]; aCause: number[]
  bPolity: number[]; bRatio: number[]; bBound: number[]
  cEvent: number[]; cBits: number[]; cChance: number[]
  cPend: boolean; cPendBits: number; cPendChance: number
}

export function createWhy(region: Uint16Array, regions: number): WhyRec {
  const reg = new Uint8Array(region.length)
  for (let i = 0; i < region.length; i++) reg[i] = region[i]
  const f = () => new Float64Array(256)
  return {
    rel: new Float64Array(256 * RP),
    pend: false, pRv: 0, pAdv: 0, pE: 0, pMul: 1, pFlags: 0, pFront: -1, pDrive: 0,
    wRiv: [], wParts: [], wOdds: [], wExh: [], wMul: [], wFlags: [], wFront: [], wDrive: [],
    u: new Float64Array(256 * UP), sub: new Float64Array(UP),
    rEvent: [], rUnrest: [], rPart: [], rShare: [], rOdds: [], rInstant: [],
    fH: f(), fHs: f(), fLeft: f(), fCrowd: f(), fLocal: f(),
    mEvent: [], mHarvest: [], mStored: [], mRavaged: [], mCrowded: [], mImports: [], mRegion: [],
    regions, region: reg, wh: new Uint8Array(64 * regions), wd: new Uint8Array(64 * regions), wc: new Uint8Array(64), wYears: 1,
    aEvent: [], aCause: [], bPolity: [], bRatio: [], bBound: [], cEvent: [], cBits: [], cChance: [],
    cPend: false, cPendBits: 0, cPendChance: 0,
  }
}

function grow(a: Float64Array, need: number): Float64Array {
  if (need <= a.length) return a
  let n = a.length
  while (n < need) n *= 2
  const b = new Float64Array(n)
  b.set(a)
  return b
}
function growU8(a: Uint8Array, need: number): Uint8Array {
  if (need <= a.length) return a
  let n = a.length
  while (n < need) n *= 2
  const b = new Uint8Array(n)
  b.set(a)
  return b
}

/** 0..255 for 0..max. */
function q8(x: number, max: number): number {
  const v = Math.round((x / max) * 255)
  return v < 0 ? 0 : v > 255 ? 255 : v
}
/** Log-coded: 2^((b - 128) / 32), 1..255 (0 is "not recorded"). */
function qLog(x: number): number {
  if (!(x > 0)) return 1
  const v = Math.round(128 + 32 * Math.log2(x))
  return v < 1 ? 1 : v > 255 ? 255 : v
}

// --- Rivalry ------------------------------------------------------------------------------------------------------------

/** Rescales relation r's parts to sum to `to` (a rise not explained by them goes to `part`, or, with part -1, to none: scaled). */
function relTo(w: WhyRec, r: number, to: number, part: number): void {
  const o = r * RP, c = w.rel
  let sum = 0
  for (let k = 0; k < RP; k++) sum += c[o + k]
  const d = to - sum
  if (d === 0) return
  if (to === 0) { for (let k = 0; k < RP; k++) c[o + k] = 0; return }
  if (part >= 0 && d > 0) { c[o + part] += d; return }
  if (sum !== 0) { const f = to / sum; for (let k = 0; k < RP; k++) c[o + k] *= f; return }
  c[o + (part >= 0 ? part : RivalryPart.Claim)] = to
}

/**
 * relationStep, per pair after its rivalry update (newR = ps.relR[r]): the terms as computed there. The claim term is split
 * between Claim and Dispute as contested : dispute (relations.ts c = contested + CLAIM.dispute · relDispute).
 */
export function whyRivalry(w: WhyRec, r: number, step: number, decay: number, newR: number, claim: number, contested: number, dispute: number, differ: number, hunger: number, recent: number, trade: number, marriage: number, faith: number): void {
  w.rel = grow(w.rel, (r + 1) * RP)
  const c = w.rel, o = r * RP
  const cs = contested + dispute
  const cl = cs > 0 ? (claim * contested) / cs : 0
  for (let k = 0; k < RP; k++) {
    const t = k === RivalryPart.Claim ? cl : k === RivalryPart.Dispute ? claim - cl : k === RivalryPart.Differ ? differ : k === RivalryPart.Hunger ? hunger :
      k === RivalryPart.RecentWar ? recent : k === RivalryPart.Trade ? -trade : k === RivalryPart.Marriage ? -marriage : k === RivalryPart.Faith ? faith : 0
    c[o + k] += step * (t - decay * c[o + k])
  }
  let sum = 0
  for (let k = 0; k < RP; k++) sum += c[o + k]
  const d = sum - newR
  if (d > 1e-12 || d < -1e-12) relTo(w, r, newR, -1) // (the clamps; float drift)
}

/** Another writer of rivalry (secession, schism, alarm): relation r goes from `before` to `after`; a rise is booked to `part`, a fall rescales. */
export function whyRelSet(w: WhyRec, r: number, part: number, before: number, after: number): void {
  w.rel = grow(w.rel, (r + 1) * RP)
  relTo(w, r, before, part)
  relTo(w, r, after, part)
}

/** Rivalry of relation r multiplied by f (peace: WAR.peaceR): every part with it. */
export function whyRelScale(w: WhyRec, r: number, f: number): void {
  w.rel = grow(w.rel, (r + 1) * RP)
  const o = r * RP
  for (let k = 0; k < RP; k++) w.rel[o + k] *= f
}

// --- War ------------------------------------------------------------------------------------------------------------------

/**
 * declarations, just before declare: the numbers of the roll (the rivalry it read, the front advantage, exhaustion, the C1
 * multiplier, whether the defender was in crisis, the ruler's and the holy-war factor, an order) and the front town.
 */
export function whyPending(w: WhyRec, rv: number, adv: number, e: number, mul: number, crisis: boolean, ruler: number, holy: number, order: boolean, front: number, drive: number): void {
  w.pend = true
  w.pRv = rv; w.pAdv = adv; w.pE = e; w.pMul = mul; w.pFront = front; w.pDrive = drive * mul
  w.pFlags = (crisis ? WarWhyFlag.Crisis : 0) | (holy > 1 ? WarWhyFlag.Holy : 0) | (order ? WarWhyFlag.Order : 0) | (ruler > 1.25 ? WarWhyFlag.Warlike : 0)
}

/** declare (first thing): one WarWhy row for the war being declared on relation r. */
export function whyWar(w: WhyRec, ps: PolityState, r: number, kind: number, joined: boolean): void {
  const R = ps.relR[r]
  const rolled = w.pend && !joined && kind !== WarKind.CivilWar
  w.wRiv.push(q8(rolled ? w.pRv : R, 2))
  w.rel = grow(w.rel, (r + 1) * RP)
  const o = r * RP
  for (let k = 0; k < RP; k++) {
    const x = R > 1e-9 ? w.rel[o + k] / R : 0
    const v = Math.round(x * 127)
    w.wParts.push(v < -127 ? -127 : v > 127 ? 127 : v)
  }
  w.wOdds.push(rolled ? qLog(w.pAdv) : 0)
  w.wExh.push(rolled ? q8(w.pE, 1) : 0)
  w.wMul.push(rolled ? qLog(w.pMul) : 0)
  w.wFlags.push((rolled ? w.pFlags : 0) | (joined ? WarWhyFlag.Joined : 0) | (kind === WarKind.CivilWar ? WarWhyFlag.Civil : 0))
  w.wFront.push(rolled ? w.pFront : -1)
  w.wDrive.push(rolled ? w.pDrive : 0)
  w.pend = false
}

// --- Unrest ---------------------------------------------------------------------------------------------------------------

/** grievance(): its terms as computed there (faith is set by the religion branch: w.sub[UnrestPart.Faith]). */
export function whyGrievance(w: WhyRec, famine: number, crowding: number, badTax: number, distance: number, exhaustion: number, crisis: number, corruption: number, foreign: number, conquest: number, colony: number): void {
  const t = w.sub
  t.fill(0)
  t[UnrestPart.Famine] = famine; t[UnrestPart.Crowding] = crowding; t[UnrestPart.BadTax] = badTax
  t[UnrestPart.Distance] = distance; t[UnrestPart.Exhaustion] = exhaustion; t[UnrestPart.Crisis] = crisis; t[UnrestPart.Corruption] = corruption
  t[UnrestPart.Foreign] = foreign; t[UnrestPart.Conquest] = conquest; t[UnrestPart.Colony] = colony
}

/** Member i's parts rescaled to its unrest u (a jump grievance did not make goes to Shock). */
function unrestTo(w: WhyRec, i: number, u: number): void {
  w.u = grow(w.u, (i + 1) * UP)
  const c = w.u, o = i * UP
  let sum = 0
  for (let k = 0; k < UP; k++) sum += c[o + k]
  const d = u - sum
  if (d <= 1e-12 && d >= -1e-12) return
  if (u <= 0) { for (let k = 0; k < UP; k++) c[o + k] = 0; return }
  if (d > 0) { c[o + UnrestPart.Shock] += d; return }
  const f = u / sum
  for (let k = 0; k < UP; k++) c[o + k] *= f
}

/** unrestStep, before member i's unrest (now u) moves toward its grievance h at `rate`: the parts move toward the terms. */
export function whyUnrest(w: WhyRec, i: number, rate: number, h: number, u: number): void {
  unrestTo(w, i, u)
  const t = w.sub, c = w.u, o = i * UP
  let sum = 0
  for (let k = 0; k < UP; k++) sum += t[k]
  const f = sum > 0 ? h / sum : 0 // (the C2 form multiplier, when there is one, scales every term)
  for (let k = 0; k < UP; k++) c[o + k] += rate * (t[k] * f - c[o + k])
}

/** revolt(), once the odds are known (the Revolt event is the last logged): the seat's unrest u, its four largest parts, the odds. */
export function whyRevolt(w: WhyRec, event: number, seat: number, u: number, rb: number, sup: number): void {
  unrestTo(w, seat, u)
  const c = w.u, o = seat * UP
  w.rEvent.push(event)
  w.rUnrest.push(q8(u, 2))
  const used: number[] = []
  for (let j = 0; j < 4; j++) {
    let best = -1
    for (let k = 0; k < UP; k++) if (c[o + k] > 0 && used.indexOf(k) < 0 && (best < 0 || c[o + k] > c[o + best])) best = k
    if (best < 0 || u <= 0) { w.rPart.push(255); w.rShare.push(0); continue }
    used.push(best)
    w.rPart.push(best)
    w.rShare.push(q8(c[o + best] / u, 1))
  }
  w.rOdds.push(q8((rb * rb) / (rb * rb + sup * sup + 1e-12), 1))
  // (the trigger: the group of the instantaneous terms, as causeOf reads them)
  const g = [0, 0, 0, 0, 0]
  for (let k = 0; k < UNREST_PART_GROUP.length; k++) g[UNREST_PART_GROUP[k]] += w.sub[k]
  let best = 0
  for (let k = 1; k < 5; k++) if (g[k] > g[best]) best = k
  w.rInstant.push(best)
}

// --- Weather and famine ---------------------------------------------------------------------------------------------------

/** weatherSystem, after the year's draws: the harvest per region, the droughts and the world's crisis. */
export function whyWeather(w: WhyRec, year: number, harvest: Float64Array, drought: Float64Array, crisis: number): void {
  const R = w.regions
  const n = year + 1
  w.wh = growU8(w.wh, n * R); w.wd = growU8(w.wd, n * R); w.wc = growU8(w.wc, n)
  for (let r = 0; r < R; r++) { w.wh[year * R + r] = q8(harvest[r], 1.4); w.wd[year * R + r] = q8(drought[r], 1) }
  w.wc[year] = q8(crisis, 1)
  if (n > w.wYears) w.wYears = n
}

/** foodSystem, per settlement: the region's harvest h0, what storage and dams left of it h, the fields left by war, food expected and produced. */
export function whyFood(w: WhyRec, id: number, h0: number, h: number, left: number, expected: number, supply: number, pop: number): void {
  if (id >= w.fH.length) {
    const n = id + 1
    w.fH = grow(w.fH, n); w.fHs = grow(w.fHs, n); w.fLeft = grow(w.fLeft, n); w.fCrowd = grow(w.fCrowd, n); w.fLocal = grow(w.fLocal, n)
  }
  w.fH[id] = h0; w.fHs[id] = h; w.fLeft[id] = left; w.fCrowd[id] = expected > 0 ? pop / expected : 2; w.fLocal[id] = supply
}

/** populationSystem, at a Famine (the last event logged): the food the town had in the end, its usual imports, its weather region. */
export function whyFamine(w: WhyRec, event: number, id: number, supply: number, usualImport: number, region: number): void {
  w.mEvent.push(event)
  w.mHarvest.push(q8(w.fH[id], 1.4))
  w.mStored.push(q8(w.fHs[id], 1.4))
  w.mRavaged.push(q8(1 - w.fLeft[id], 1))
  w.mCrowded.push(q8(w.fCrowd[id], 2))
  const netIn = supply - w.fLocal[id]
  w.mImports.push(usualImport > 0 ? q8(1 - (netIn > 0 ? netIn : 0) / usualImport, 1) : 0)
  w.mRegion.push(region)
}

// --- Abandoned, absorbed, crises -----------------------------------------------------------------------------------------

export function whyAbandon(w: WhyRec, event: number, cause: number): void {
  w.aEvent.push(event)
  w.aCause.push(cause)
}

/** Before polity p is absorbed: the absorber's people and its own, and whether it was the absorber's vassal. */
export function whyAbsorbed(w: WhyRec, p: number, absorberPop: number, pop: number, bound: number): void {
  w.bPolity.push(p)
  w.bRatio.push(qLog(pop > 0 ? absorberPop / pop : 256))
  w.bBound.push(bound)
}

/** What made p's succession contestable (rulers: the same terms as hazards.ts contestChanceOf; design-default thresholds). */
export function crisisBits(ps: PolityState, R: RulerState, p: number, law: number, dead: number, heir: number, year: number): number {
  const i = p * H + heir
  let b = 0
  if (year - R.hBorn[i] < RULERS.majority) b |= CrisisBit.Minor
  if (R.hFemale[i]) b |= CrisisBit.Woman
  if (!R.hLegit[i]) b |= CrisisBit.Bastard
  if (1 - R.rAbility[dead] > 0.5) b |= CrisisBit.WeakPredecessor
  if (ps.pAsab[p] < 0.5) b |= CrisisBit.LowCohesion
  if (ps.pMulti[p]) b |= CrisisBit.ManyPeoples
  if (law === 2 || law === 3) b |= CrisisBit.Law // (seniority, elective: rival adults)
  return b
}

/** The succession roll about to be made (rulers): its bits and chance, taken by the SuccessionCrisis that follows. */
export function whyCrisisPending(w: WhyRec, chance: number, bits: number): void {
  w.cPend = true; w.cPendChance = chance; w.cPendBits = bits
}

/** A SuccessionCrisis logged (the last event): from the pending roll, or else (a house died out) the fixed chance. */
export function whyCrisis(w: WhyRec, event: number): void {
  w.cEvent.push(event)
  if (w.cPend) { w.cBits.push(w.cPendBits); w.cChance.push(q8(w.cPendChance, 1)) }
  else { w.cBits.push(CrisisBit.Extinct); w.cChance.push(q8(SUCCESSION.extinctContested, 1)) }
  w.cPend = false
}

/** The crisis just recorded had a rival centre (a civil war may follow). */
export function whyCrisisRival(w: WhyRec): void {
  const n = w.cBits.length
  if (n > 0) w.cBits[n - 1] |= CrisisBit.RivalCentre
}

/** A SuccessionCrisis without rulers (unrest.ts realmStep): its chance and bits. */
export function whyCrisisAt(w: WhyRec, event: number, chance: number, bits: number): void {
  w.cEvent.push(event)
  w.cBits.push(bits)
  w.cChance.push(q8(chance, 1))
}

// --- Assembly -------------------------------------------------------------------------------------------------------------

/**
 * History.why up to year `years`: rows copied out (the run goes on), raw event indices mapped by `ev` to History.events, the
 * absorbed rows found by their polity's PolityEnded in `events`.
 */
export function assembleWhy(w: WhyRec, years: number, warCount: number, ev: (raw: number) => number, events: readonly HistoryEvent[], cellCount: number): CauseRecords {
  const i32 = (a: number[], f: (x: number) => number = (x) => x) => Int32Array.from(a, f)
  const u8 = (a: number[]) => Uint8Array.from(a)
  const W = warCount
  const R = w.regions
  const Y = Math.min(years + 1, w.wYears)
  const ended = new Map<number, number>()
  for (let i = 0; i < events.length; i++) if (events[i].type === 21) ended.set(events[i].value, i) // EventType.PolityEnded
  const bEv: number[] = [], bR: number[] = [], bB: number[] = []
  for (let k = 0; k < w.bPolity.length; k++) {
    const e = ended.get(w.bPolity[k])
    if (e === undefined) continue
    bEv.push(e); bR.push(w.bRatio[k]); bB.push(w.bBound[k])
  }
  const region = new Uint8Array(cellCount)
  region.set(w.region.subarray(0, cellCount))
  return {
    wars: {
      rivalry: u8(w.wRiv.slice(0, W)), parts: Int8Array.from(w.wParts.slice(0, W * RP)), odds: u8(w.wOdds.slice(0, W)),
      exhaustion: u8(w.wExh.slice(0, W)), mul: u8(w.wMul.slice(0, W)), flags: u8(w.wFlags.slice(0, W)), front: i32(w.wFront.slice(0, W)),
    },
    revolts: { count: w.rEvent.length, event: i32(w.rEvent, ev), unrest: u8(w.rUnrest), part: u8(w.rPart), share: u8(w.rShare), odds: u8(w.rOdds) },
    famines: { count: w.mEvent.length, event: i32(w.mEvent, ev), harvest: u8(w.mHarvest), stored: u8(w.mStored), ravaged: u8(w.mRavaged), crowded: u8(w.mCrowded), imports: u8(w.mImports), region: u8(w.mRegion) },
    weather: { regions: R, harvest: w.wh.slice(0, Y * R), drought: w.wd.slice(0, Y * R), crisis: w.wc.slice(0, Y), region },
    abandons: { count: w.aEvent.length, event: i32(w.aEvent, ev), cause: u8(w.aCause) },
    absorbed: { count: bEv.length, event: i32(bEv), ratio: u8(bR), bound: u8(bB) },
    crises: { count: w.cEvent.length, event: i32(w.cEvent, ev), bits: Uint16Array.from(w.cBits), chance: u8(w.cChance) },
  }
}
