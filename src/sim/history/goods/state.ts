// goods: state of the goods system (struct-of-arrays per settlement, per variety, deposit, tradition, leg, secret and
// post, grown by doubling), and the primitives the rules share: varieties, the variety mix of a trader's stock, events.
//
// Everything here is in the history state (HistoryState.goods), so a run is prefix-stable and resumable: assembly
// copies it out, and nothing depends on the run's length.

import type { LegPolicy } from './longhaul.ts'
import { EventType as EventTypeC, GOOD_COUNT, TECH_FIELD_COUNT, VarietyKind } from '../../../contract.ts'
import type { HistoryEvent } from '../../../contract.ts'
import type { Rng } from '../../rng.ts'
import { createRng } from '../../rng.ts'
import type { HistoryState } from '../state.ts'
import { CLASS, MIX } from './params.ts'

const G = GOOD_COUNT
/** Mixed classes (Luxury, Metalware, Finery, Treasure) and the mix index of each class (-1 unmixed). */
export const MIXED = CLASS.mixed
export const M = MIXED.length
export const K = MIX.K
export const MIX_OF: Int32Array = (() => { const a = new Int32Array(G).fill(-1); MIXED.forEach((g, m) => { a[g] = m }); return a })()
/** Maker of a variety: a people (its name) or a settlement (its name). */
export const Maker = { None: 0, People: 1, Settlement: 2 } as const

export interface GoodsDiag {
  /** Trade expeditions: year, home mart, outcome (0 no target in range, 1 lane, 2 lost), variety, path cells, by sea (1). */
  expYear: number[]; expFrom: number[]; expOutcome: number[]; expVariety: number[]; expCells: number[]; expSea: number[]
  /** Price records per decade for tracked varieties: year, variety, source settlement, source price, far price, far settlement, its distance (chord), hops of legs. */
  priceLog: number[]
  /** Leaks: year, secret, people, channel. */
  leakLog: number[]
  /** War campaign outcomes for the arms test: year, attacker arms per head, defender arms per head, attacker mass, defender mass, won (1). */
  battleLog: number[]
  /** Smithing / workshop output per people at the last technology step. */
  farmGain: number[]
  /** Income created per decade by source: [decade * 16 + j], j = class (local market, 0..12), 13 long-haul, 14 transit cuts, 15 contraband. */
  income: number[]
}

export interface GoodsState {
  rng: Rng
  /** Settlement capacity of the per-settlement arrays. */
  cap: number
  P: number

  // --- Per settlement ---
  /** Stock carried into next year per class: held[id * G + g]. */
  held: Float64Array
  /** Variety mix of the trader's stock (this year: the market stock; between years: the held stock), per mixed class: K slots [((id * M + m) * K + k)]. */
  mixV: Int32Array
  mixA: Float64Array
  /** Tools and arms stocks (units), the farm and military multipliers they give. */
  tools: Float64Array
  arms: Float64Array
  /** Arms quality factor of the arms stock (fine blades count more), 1 for common. */
  armsRel: Float64Array
  toolMul: Float64Array
  /** Workshop recipe shares (3 per settlement) and this year's outputs (class units): smithing, dyeing, fine cloth; silk Finery; fine-blade work. */
  wShare: Float64Array
  wOut: Float64Array
  silkOut: Float64Array
  /** Potential crop food the cash crops are reckoned on this year (cashCrops.ts marketGoods). */
  pot: Float64Array
  /** Per cash species output coefficient per unit of potential crop food (cashCrops.ts cashUpdate): cashCoef[id * NC + q]. */
  cashCoef: Float64Array
  /** Craft practice per settlement and craft (4), the tradition each settlement is a seat of (-1), years with little output. */
  practice: Float64Array
  seatOf: Int32Array
  seatIdle: Int32Array
  /** 1 while a mart; the forward price per class (marts). */
  isMart: Uint8Array
  fwd: Float64Array
  /** The neighbouring mart each mart's forward price comes through, per class (-1: its own price): goods never go back that way at the forward price. */
  fwdVia: Int32Array
  /** The merchants' bid for the season: forward price times their appetite at the start of the year. */
  fwdBid: Float64Array
  /** Relay income (this year, 20-year smoothed, peak and its year), the variety that made most of it near the peak and its share; Bypassed logged. */
  relayYear: Float64Array
  relaySm: Float64Array
  relayPeak: Float64Array
  relayPeakYear: Int32Array
  relayTopVar: Int32Array
  relayTopShare: Float64Array
  relayVarYear: Int32Array
  relayVarAmt: Float64Array
  bypassed: Uint8Array
  /** Route-seeking urge, next year it may try again, the chart variety it may sail for (+1, 0 none) and its target settlement. */
  urge: Float64Array
  urgeNext: Int32Array
  urgeChart: Int32Array
  /** Trading post id of the settlement (fort or station), -1; the post the settlement hosts (a factory), -1. */
  postOf: Int32Array
  factoryAt: Int32Array
  /** Year of the last famine / sack / revolt (push events, from the event log). */
  sackedYear: Int32Array
  /** A hostile border in a settlement's fields (arms demand), and the year it was reckoned. */
  front: Uint8Array
  frontYear: Int32Array
  /** Mined this year (class units, by the deposits it works). */
  mined: Float64Array
  /** Stimulant kept by species [id * NK + k] (the held part of the habit system's per-species stock). */
  heldAmt: Float64Array
  NK: number

  // --- Varieties ---
  vCount: number
  vGood: Int32Array
  vKind: Int32Array
  vSource: Int32Array
  vPeople: Int32Array
  vMakerKind: Int32Array
  vMakerId: Int32Array
  vRel: Float64Array
  vFirst: Int32Array
  /** Base value (worth relative to grain) for the contract. */
  vValue: Float64Array
  /** Secret id of the variety (secret species or craft), -1. */
  vSecret: Int32Array
  /** Varieties tied to a secret (vSecret >= 0): the market looks for monopoly rent only while there are any. */
  nSecretVars: number
  /** 1 for a dye (indigo, cochineal, murex). */
  vDye: Uint8Array
  /** Output this decade (class units) and the settlement that produced most of it (its origin). */
  vOut: Float64Array
  vOrigin: Int32Array
  vOriginOut: Float64Array
  /** Crop varieties by (people, species) and wild furs by people (-1 until first made). */
  cropVar: Int32Array
  furVar: Int32Array
  /** Rumour: the year people p first heard of variety v, -1: rumour[p * maxVarieties + v]. */
  rumour: Int16Array
  /** Import value of each variety per people this decade (secret varieties only): imp[v * P + p]. */
  vImp: Float64Array
  /** The contraband among those imports (polities v2's smuggling: duties evaded, embargoes and wars, the monopoly rent evaded), same layout: the smuggled seeds' channel. */
  vSmug: Float64Array
  /** SecretSmuggled logged for secret k and people p: smugLogged[k * P + p] (grown with the secrets). */
  smugLogged: number[]

  // --- Deposits ---
  dCount: number
  /** Internal kind 0..6 (placer, lode, silver, gems, amber, pearls, murex). */
  dKind: Int32Array
  dCell: Int32Array
  dRich: Float64Array
  dFound: Int32Array
  dFoundBy: Int32Array
  dExh: Int32Array
  dVar: Int32Array
  dR: Float64Array
  dR0: Float64Array
  dPeak: Float64Array
  dOut: Float64Array
  dWorker: Int32Array
  dCamp: Int32Array
  dMine: Int32Array
  /** Market town a small working settlement sells a deposit's output at (-1). */
  dSink: Int32Array
  /** Sum of the base catchment weights of each cell (static; -1 until reckoned): bog iron. */
  wsum: Float64Array
  /** Per deposit: cells within DEPOSIT.rushHops hops (discovery and rush); deposit within a hop of each cell (+1, 0 none). */
  dRing: number[][]
  dNear: Int32Array
  /** Rush multiplier per cell (1 nowhere near a fresh find), and the rush end years per deposit. */
  rush: Float64Array
  rushUntil: Int32Array
  boomLogged: Uint8Array
  /** World Treasure output this year (class units). */
  treasureOut: number

  // --- Traditions ---
  tCount: number
  tCraft: number[]
  tPeople: number[]
  tVar: number[]
  tQ: number[]
  tBorn: number[]
  tBornAt: number[]
  tEnd: number[]
  tParent: number[]
  tSeats: number[][]
  tSeatFrom: number[][]
  tSeatTo: number[][]
  tRenowned: number[]
  /** Output of the tradition this decade (class units). */
  tOut: number[]

  // --- Long-haul legs ---
  legCount: number
  legA: number[]
  legB: number[]
  legKind: number[]
  legOpened: number[]
  legClosed: number[]
  legChart: number[]
  legPath: number[][]
  /** Route cost of the leg (cell units), refreshed at mart rebuilds. */
  legCost: number[]
  /** Leg cost times its ends' transport factor this year (forwardPrices), per leg. */
  legT: number[]
  legOpen: number[]
  /** Leg index by mart pair key (lookup only). */
  legIndex: Map<number, number>
  /** Open legs, cheapest first (rebuilt with the marts). */
  legOrder: number[]
  /** Volume this year (class units, both ways) and cumulative per class and direction: [(k * G + g) * 2 + dir]. */
  legVol: Float64Array
  legGood: Float64Array
  /** Lanes: capacity, use this year, years sailed, idle years, variety sought, holder people and polity at opening, first-decade profit. */
  legCap: number[]
  legUse: number[]
  legSailed: number[]
  legIdle: number[]
  legVariety: number[]
  legHazard: number[]
  /** Lanes: loss rate of the way at opening (it falls with sailing). */
  legRisk0: number[]
  legProfit: number[]
  /** polities v2 on the legs: duties, embargo, smuggling, pirates and bandits (longhaul.ts; null until the first sweep with states). */
  legPol: LegPolicy | null
  /** Lanes opened (leg ids) in order. */
  lanes: number[]

  // --- Secrets ---
  sCount: number
  sKind: number[]
  sSubject: number[]
  sFound: number[]
  sFoundAt: number[]
  sLost: number[]
  /** Holding per secret and people: 1 held. sHeld[k][p]. */
  sHeld: Uint8Array[]
  /** Guard of the main holder (0..1), the original holder people, MonopolyBroken logged. */
  sPsi: number[]
  sOrig: number[]
  sBroken: number[]
  sGuardLogged: number[]
  /** Holding intervals: secret, people, polity, from, to, channel, via. */
  hSecret: number[]
  hPeople: number[]
  hPolity: number[]
  hFrom: number[]
  hTo: number[]
  hChannel: number[]
  hVia: number[]
  /** Secret id per species (-1), and the craft secrets: purple and steel (-1 until created). */
  speciesSecret: Int32Array
  purple: number
  steel: number
  /** Monopoly rent income per secret this decade, and producers' export value. */
  sRent: number[]
  sExport: number[]
  /** Mean protection of each secret's producers (last guard pass). */
  sPi: number[]
  /** Relay income summed this decade per settlement (for the variety share behind it). */
  relayDec: Float64Array
  /** Settlements that ever had relay income (ascending by first income; the only ones relayYear visits), and those with smuggled income. */
  relayList: number[]
  relayIn: Uint8Array

  // --- Posts ---
  postCount: number
  pKind: number[]
  pOwner: number[]
  pHost: number[]
  pSettlement: number[]
  pLeg: number[]
  pFounded: number[]
  pEnded: number[]
  pStrikes: number[]
  pCost: number[]
  pHostile: number[]

  // --- Middlemen ---
  /** Transit cut sum per local pair, and the HV value moved on the pair this year; reckoned for the pair arrays of ts. */
  pairMu: Float64Array
  pairHv: Float64Array
  pairFor: Int32Array | null
  pairYear: number

  // --- Technology (Q4 brake) ---
  /** Own technology level per people per field (growth only, without diffusion). */
  own: Float64Array
  /** Smithing and other workshop output per people this year (technology activity). */
  smithAct: Float64Array
  workAct: Float64Array

  // --- Per species (static, filled by system.ts): the class its cash crop yields, its relative worth in that class, the fit it needs ---
  spClass: Int32Array
  spRel: Float64Array
  spMinFit: Float64Array

  // --- Events scanned ---
  evSeen: number

  // --- Snapshots (ragged per trade snapshot) ---
  snapCount: number
  snapS: number[]
  snapL: number[]
  snapT: number[]
  snapK: number[]
  snapOffS: number[]
  snapOffL: number[]
  snapOffT: number[]
  snapOffK: number[]
  depositOutput: Float32Array
  depUsed: number
  traditionQ: Uint8Array
  tqUsed: number
  industry: Uint16Array
  metal: Uint8Array
  priceIndex: Uint8Array
  mart: Uint8Array
  sUsed: number
  legVolSnap: Float32Array
  lvUsed: number
  guardSnap: Uint8Array
  gUsed: number

  diag: GoodsDiag
}

function f64(n: number, v = 0): Float64Array { const a = new Float64Array(n); if (v !== 0) a.fill(v); return a }
function i32(n: number, v = 0): Int32Array { const a = new Int32Array(n); if (v !== 0) a.fill(v); return a }

/** Creates the goods state (after the tribes are founded: the people count is known). */
export function createGoods(s: HistoryState, speciesCount: number, cashCount: number, stimCount: number): GoodsState {
  const cap = 256
  const P = s.know.P
  const N = s.terrain.cellCount
  const VM = MIX.maxVarieties
  // (Two literals joined, the first under 128 properties and the second's under 128: V8 keeps an object literal of 128 or
  // more properties, or one given 128 or more properties after it, in slow dictionary mode.)
  const base = {
    rng: createRng(s.world.seed, 'history-goods'),
    cap, P,
    held: f64(cap * G), mixV: i32(cap * M * K), mixA: f64(cap * M * K),
    tools: f64(cap), arms: f64(cap), armsRel: f64(cap, 1), toolMul: f64(cap, 1),
    wShare: f64(cap * 3), wOut: f64(cap * 3), silkOut: f64(cap), pot: f64(cap), cashCoef: f64(cap * cashCount),
    practice: f64(cap * 4), seatOf: i32(cap * 4, -1), seatIdle: i32(cap * 4),
    isMart: new Uint8Array(cap), fwd: f64(cap * G), fwdVia: i32(cap * G, -1), fwdBid: f64(cap * G),
    relayYear: f64(cap), relaySm: f64(cap), relayPeak: f64(cap), relayPeakYear: i32(cap, -1), relayTopVar: i32(cap, -1), relayTopShare: f64(cap),
    relayVarYear: i32(cap, -1), relayVarAmt: f64(cap), bypassed: new Uint8Array(cap),
    urge: f64(cap), urgeNext: i32(cap), urgeChart: i32(cap), postOf: i32(cap, -1), factoryAt: i32(cap, -1), sackedYear: i32(cap, -1000000), front: new Uint8Array(cap), frontYear: i32(cap, -1000000), mined: f64(cap), heldAmt: f64(cap * stimCount), NK: stimCount,
    vCount: 1,
    vGood: i32(VM, -1), vKind: i32(VM), vSource: i32(VM, -1), vPeople: i32(VM, -1), vMakerKind: i32(VM), vMakerId: i32(VM, -1),
    nSecretVars: 0, vRel: f64(VM, 1), vFirst: i32(VM), vValue: f64(VM), vSecret: i32(VM, -1), vDye: new Uint8Array(VM), vOut: f64(VM), vOrigin: i32(VM, -1), vOriginOut: f64(VM),
    cropVar: i32(P * speciesCount, -1), furVar: i32(P, -1),
    rumour: new Int16Array(P * VM).fill(-1), vImp: f64(VM * P), vSmug: f64(VM * P), smugLogged: [] as number[],
    dCount: 0, dKind: i32(0), dCell: i32(0), dRich: f64(0), dFound: i32(0), dFoundBy: i32(0), dExh: i32(0), dVar: i32(0), dR: f64(0), dR0: f64(0), dPeak: f64(0), dOut: f64(0),
    dWorker: i32(0), dCamp: i32(0), dMine: i32(0), dSink: i32(0), dRing: [], dNear: i32(0), wsum: f64(N, -1), rush: f64(N, 1), rushUntil: i32(0), boomLogged: new Uint8Array(0), treasureOut: 0,
    tCount: 0, tCraft: [], tPeople: [], tVar: [], tQ: [], tBorn: [], tBornAt: [], tEnd: [], tParent: [], tSeats: [], tSeatFrom: [], tSeatTo: [], tRenowned: [], tOut: [],
    legCount: 0, legA: [], legB: [], legKind: [], legOpened: [], legClosed: [], legChart: [], legPath: [], legCost: [], legT: [], legOpen: [], legIndex: new Map(), legOrder: [],
    legVol: f64(64), legGood: f64(64 * G * 2), legCap: [], legUse: [], legSailed: [], legIdle: [], legVariety: [], legHazard: [], legRisk0: [], legProfit: [], legPol: null, lanes: [],
  }
  const more = {
    sCount: 0, sKind: [], sSubject: [], sFound: [], sFoundAt: [], sLost: [], sHeld: [], sPsi: [], sOrig: [], sBroken: [], sGuardLogged: [],
    hSecret: [], hPeople: [], hPolity: [], hFrom: [], hTo: [], hChannel: [], hVia: [],
    speciesSecret: i32(speciesCount, -1), purple: -1, steel: -1, sRent: [], sExport: [], sPi: [], relayDec: f64(cap), relayList: [], relayIn: new Uint8Array(cap),
    postCount: 0, pKind: [], pOwner: [], pHost: [], pSettlement: [], pLeg: [], pFounded: [], pEnded: [], pStrikes: [], pCost: [], pHostile: [],
    pairMu: f64(0), pairHv: f64(0), pairFor: null, pairYear: -1000,
    own: f64(P * TECH_FIELD_COUNT, 1), smithAct: f64(P), workAct: f64(P),
    spClass: i32(speciesCount), spRel: f64(speciesCount, 1), spMinFit: f64(speciesCount),
    evSeen: 0,
    snapCount: 0, snapS: [], snapL: [], snapT: [], snapK: [], snapOffS: [], snapOffL: [], snapOffT: [], snapOffK: [],
    depositOutput: new Float32Array(256), depUsed: 0, traditionQ: new Uint8Array(256), tqUsed: 0,
    industry: new Uint16Array(4096), metal: new Uint8Array(8192), priceIndex: new Uint8Array(20480), mart: new Uint8Array(4096), sUsed: 0,
    legVolSnap: new Float32Array(1024), lvUsed: 0, guardSnap: new Uint8Array(256), gUsed: 0,
    diag: { expYear: [], expFrom: [], expOutcome: [], expVariety: [], expCells: [], expSea: [], priceLog: [], leakLog: [], battleLog: [], farmGain: [], income: [] },
  }
  const g = Object.assign(base, more) as unknown as GoodsState
  // Variety 0: the Common variety of every class.
  g.vGood[0] = -1
  g.vKind[0] = VarietyKind.Common
  return g
}

function gf(a: Float64Array, n: number, v = 0): Float64Array { const b = new Float64Array(n); if (v !== 0) b.fill(v); b.set(a); return b }
function gi(a: Int32Array, n: number, v = 0): Int32Array { const b = new Int32Array(n); if (v !== 0) b.fill(v); b.set(a); return b }
function gu(a: Uint8Array, n: number): Uint8Array { const b = new Uint8Array(n); b.set(a); return b }

/** Grows the per-settlement arrays to cover `count` settlements. */
export function ensureGoods(g: GoodsState, count: number): void {
  if (count <= g.cap) return
  let n = g.cap
  while (n < count) n *= 2
  const NC = g.cashCoef.length / g.cap
  g.held = gf(g.held, n * G)
  g.mixV = gi(g.mixV, n * M * K)
  g.mixA = gf(g.mixA, n * M * K)
  g.tools = gf(g.tools, n); g.arms = gf(g.arms, n); g.armsRel = gf(g.armsRel, n, 1); g.toolMul = gf(g.toolMul, n, 1)
  g.wShare = gf(g.wShare, n * 3); g.wOut = gf(g.wOut, n * 3); g.silkOut = gf(g.silkOut, n); g.pot = gf(g.pot, n); g.cashCoef = gf(g.cashCoef, n * NC)
  g.practice = gf(g.practice, n * 4); g.seatOf = gi(g.seatOf, n * 4, -1); g.seatIdle = gi(g.seatIdle, n * 4)
  g.isMart = gu(g.isMart, n); g.fwd = gf(g.fwd, n * G); g.fwdVia = gi(g.fwdVia, n * G, -1); g.fwdBid = gf(g.fwdBid, n * G)
  g.relayYear = gf(g.relayYear, n); g.relaySm = gf(g.relaySm, n); g.relayPeak = gf(g.relayPeak, n); g.relayPeakYear = gi(g.relayPeakYear, n, -1)
  g.relayTopVar = gi(g.relayTopVar, n, -1); g.relayTopShare = gf(g.relayTopShare, n); g.relayVarYear = gi(g.relayVarYear, n, -1); g.relayVarAmt = gf(g.relayVarAmt, n); g.bypassed = gu(g.bypassed, n)
  g.relayDec = gf(g.relayDec, n); g.relayIn = gu(g.relayIn, n); g.urge = gf(g.urge, n); g.urgeNext = gi(g.urgeNext, n); g.urgeChart = gi(g.urgeChart, n); g.postOf = gi(g.postOf, n, -1); g.factoryAt = gi(g.factoryAt, n, -1); g.sackedYear = gi(g.sackedYear, n, -1000000); g.front = gu(g.front, n); g.frontYear = gi(g.frontYear, n, -1000000); g.mined = gf(g.mined, n); g.heldAmt = gf(g.heldAmt, n * g.NK)
  g.cap = n
}

/** Grows the per-leg buffers. */
export function ensureLegs(g: GoodsState, count: number): void {
  if (count <= g.legVol.length) return
  let n = g.legVol.length
  while (n < count) n *= 2
  g.legVol = gf(g.legVol, n)
  g.legGood = gf(g.legGood, n * G * 2)
}

/** A trading post founded this year (logs PostFounded at its settlement, or at the host for a factory); returns its id. */
export function addPost(s: HistoryState, g: GoodsState, kind: number, owner: number, host: number, settlement: number, leg: number): number {
  const i = g.postCount++
  g.pKind.push(kind); g.pOwner.push(owner); g.pHost.push(host); g.pSettlement.push(settlement); g.pLeg.push(leg)
  g.pFounded.push(s.year); g.pEnded.push(-1); g.pStrikes.push(0); g.pCost.push(0); g.pHostile.push(0)
  if (settlement >= 0) g.postOf[settlement] = i
  if (host >= 0) g.factoryAt[host] = i
  logGoods(s, EventTypeC.PostFounded, settlement >= 0 ? settlement : host, owner, i, kind)
  return i
}

/** Trading post i is lost this year (cause 0 upkeep, 1 conquest, 2 expelled). */
export function losePost(s: HistoryState, g: GoodsState, i: number, cause: number): void {
  if (g.pEnded[i] >= 0) return
  g.pEnded[i] = s.year
  const x = g.pSettlement[i], h = g.pHost[i]
  if (x >= 0 && g.postOf[x] === i) g.postOf[x] = -1
  if (h >= 0 && g.factoryAt[h] === i) g.factoryAt[h] = -1
  logGoods(s, EventTypeC.PostLost, x >= 0 ? x : h, g.pOwner[i], i, cause)
}

/** Diagnostics: income created this year from source j (see GoodsDiag.income), summed into INCOME and flushed yearly (flushIncome). */
export function noteIncome(s: HistoryState, g: GoodsState, j: number, x: number): void {
  void s; void g
  INCOME[j] += x
}
export const INCOME = new Float64Array(16)
/** Adds this year's income by source to the decade's record. */
export function flushIncome(s: HistoryState, g: GoodsState): void {
  const i0 = Math.floor(s.year / 10) * 16
  const a = g.diag.income
  while (a.length < i0 + 16) a.push(0)
  for (let j = 0; j < 16; j++) { a[i0 + j] += INCOME[j]; INCOME[j] = 0 }
}

/** Pushes an event with a second number (HistoryEvent.extra). */
export function logGoods(s: HistoryState, type: HistoryEvent['type'], settlement: number, other: number, value: number, extra?: number): void {
  if (extra === undefined) s.events.push({ year: s.year, type, settlement, other, value })
  else s.events.push({ year: s.year, type, settlement, other, value, extra })
}

/** Ties variety v to secret k (its goods pay the monopoly rent and count for the secret's leaks). */
export function setVarSecret(g: GoodsState, v: number, k: number): void {
  if (v <= 0 || k < 0 || g.vSecret[v] === k) return
  if (g.vSecret[v] < 0) g.nSecretVars++
  g.vSecret[v] = k
}

/** Registers a variety; returns its id (0, the Common variety, when the catalogue is full). */
export function newVariety(s: HistoryState, g: GoodsState, good: number, kind: number, source: number, people: number, makerKind: number, makerId: number, value: number, rel: number, dye = false): number {
  if (g.vCount >= MIX.maxVarieties) return 0
  const v = g.vCount++
  g.vGood[v] = good
  g.vKind[v] = kind
  g.vSource[v] = source
  g.vPeople[v] = people
  g.vMakerKind[v] = makerKind
  g.vMakerId[v] = makerId
  g.vValue[v] = value
  g.vRel[v] = rel
  g.vFirst[v] = s.year
  g.vDye[v] = dye ? 1 : 0
  return v
}

// --- Mix -------------------------------------------------------------------------------------------------

/** Adds `amount` class units of variety v to the named slots of trader id's mixed class m (the stock itself is raised by the caller). */
export function mixAdd(g: GoodsState, id: number, m: number, v: number, amount: number): void {
  if (v <= 0 || !(amount > MIX.epsilon)) return
  const o = (id * M + m) * K
  const mv = g.mixV, ma = g.mixA
  let empty = -1, small = -1
  for (let k = 0; k < K; k++) {
    const x = mv[o + k]
    if (x === v) { ma[o + k] += amount; return }
    if (x === 0) { if (empty < 0) empty = k }
    else if (small < 0 || ma[o + k] < ma[o + small]) small = k
  }
  if (empty >= 0) { mv[o + empty] = v; ma[o + empty] = amount; return }
  // Full: the smallest name is lost to the Common remainder if this one is larger.
  if (amount > ma[o + small]) { mv[o + small] = v; ma[o + small] = amount }
}

/** Scales trader id's mix of class m by f (a share of the stock left), dropping slots that become negligible. */
export function mixScale(g: GoodsState, id: number, m: number, f: number): void {
  const o = (id * M + m) * K
  const mv = g.mixV, ma = g.mixA
  for (let k = 0; k < K; k++) {
    if (mv[o + k] === 0) continue
    const a = ma[o + k] * f
    if (a > MIX.epsilon) ma[o + k] = a
    else { mv[o + k] = 0; ma[o + k] = 0 }
  }
}

/** Clears trader id's mix of every class. */
export function mixClear(g: GoodsState, id: number): void {
  const o = id * M * K
  g.mixV.fill(0, o, o + M * K)
  g.mixA.fill(0, o, o + M * K)
}

/**
 * A flow of q class units of class m from `from` (stock `before`, before the flow) to `to`: the named slots move in
 * proportion; whatever the receiver has no slot for joins its Common remainder. Returns the moved value of secret
 * varieties (share of q), for the monopoly rent, in MIX_SECRET.
 */
export function mixFlow(g: GoodsState, from: number, to: number, m: number, q: number, before: number): void {
  if (!(before > 0)) return
  const f = q / before
  const o = (from * M + m) * K
  const mv = g.mixV, ma = g.mixA
  for (let k = 0; k < K; k++) {
    const v = mv[o + k]
    if (v === 0) continue
    const moved = ma[o + k] * f
    const left = ma[o + k] - moved
    if (left > MIX.epsilon) ma[o + k] = left
    else { mv[o + k] = 0; ma[o + k] = 0 }
    mixAdd(g, to, m, v, moved)
  }
}

/** Value density factor of trader id's stock of class m (stock S): sum of shares / rel (the Common remainder at rel 1). */
export function density(g: GoodsState, id: number, m: number, S: number): number {
  if (!(S > 0)) return 1
  const o = (id * M + m) * K
  const mv = g.mixV, ma = g.mixA
  let named = 0, rho = 0
  for (let k = 0; k < K; k++) {
    const v = mv[o + k]
    if (v === 0) continue
    const a = ma[o + k]
    named += a
    rho += a / g.vRel[v]
  }
  if (named > S) named = S
  return (rho + (S - named)) / S
}
