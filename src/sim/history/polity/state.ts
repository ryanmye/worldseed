// polities: state of the polity system (struct-of-arrays per settlement and per polity, grown by
// doubling), and the primitives every polity rule uses: membership changes, founding and ending a
// polity, power, reach and the submission test.
//
// A polity is a set of member settlements, one of them the capital. Membership is per settlement;
// territory is a function of membership and the territory map (territory.ts). Polity ids are assigned
// in founding order and never reused, so they are prefix-stable.

import { BondEnd, BondKind, EventType, PolityEnd, TECH_FIELD_COUNT, TechField } from '../../../contract.ts'
import type { PolityOrigin } from '../../../contract.ts'
import type { Rng } from '../../rng.ts'
import { createRng } from '../../rng.ts'
import { Heap } from '../heap.ts'
import type { HistoryState } from '../state.ts'
import { logEvent } from '../state.ts'
import { prosperity } from '../migration.ts'
import { hasHorse } from '../species.ts'
import { buildDefense } from './defense.ts'
import { COHESION, FORT, POLITY, UNREST } from './params.ts'
import { armsQuality } from '../goods/hooks.ts' // goods:
import { rulerNewPolity, rulerPolityEnded } from '../rulers/system.ts' // rulers:

/** Never: a year long before any. */
export const NEVER = -1000000
/** Graph distance of a member its capital cannot reach. */
export const FAR = 1e9

export interface PolityState {
  rng: Rng
  rngWar: Rng
  /** Static defensibility T in [1, 2.2] per cell, and D = (T - 1) / 1.2 in [0, 1]. */
  defense: Float64Array
  defenseD: Float64Array
  /** Land cells (elevation >= 0), ascending, and each cell's index among them (-1 for sea). */
  landCells: Int32Array
  landIndex: Int32Array

  // --- Per settlement (capacity `cap`; ids [0, seen) initialised) ---
  cap: number
  seen: number
  polity: Int32Array
  joined: Int32Array
  conqueredAt: Int32Array
  asab: Float64Array
  unrest: Float64Array
  assim: Float64Array
  /** Graph cost from its polity's capital (control pass), FAR if unreachable. */
  dist: Float64Array
  danger: Float64Array
  dangerAvg: Float64Array
  ravage: Float64Array
  /** Wall rings in use, and the population when the last ring went up. */
  walls: Int32Array
  wallPop: Float64Array
  /** Power b and Local (defence on its own) this step. */
  str: Float64Array
  local: Float64Array
  /** 1 if taxed in a harvest below UNREST.badHarvest since the last step. */
  badTax: Uint8Array
  /** Year of the last revolt it took part in. */
  rose: Int32Array
  /** Cell danger at founding and defensibility of the cell (stats). */
  foundZ: Float32Array
  /** Smoothed tax received (capitals) / paid. */
  taxIn: Float64Array
  // v2 (outlaw economy): lawlessness (bandits) this step, corruption, contraband income this year and smoothed, smoothed
  // income, pirate strength pi and lane traffic (havens), 1 once PiratesRise was logged (until suppressed), 1 once
  // SmugglingRing was logged, the fort in use (structure id, -1).
  lawless: Float64Array
  corrupt: Float64Array
  smugYear: Float64Array
  smugSm: Float64Array
  incSm: Float64Array
  pir: Float64Array
  lane: Float64Array
  pirRose: Uint8Array
  /** 1 when the haven preyed on some route at the last outlaw step. */
  taker: Uint8Array
  ringDone: Uint8Array
  fort: Int32Array
  /** Contraband through each hub: the largest cut this year, and the good and the evaded polity of the largest cut lately. */
  hubBest: Float64Array
  hubGood: Int32Array
  hubPol: Int32Array

  // --- Per polity (capacity `pcap`) ---
  P: number
  pcap: number
  pCapital: Int32Array
  pFounded: Int32Array
  pEnded: Int32Array
  pParent: Int32Array
  pOrigin: Uint8Array
  pEnd: Uint8Array
  pPeople: Int32Array
  pMembers: Int32Array
  pPop: Float64Array
  pMass: Float64Array
  pAsab: Float64Array
  pReach: Float64Array
  pExh: Float64Array
  pCrisisUntil: Int32Array
  pNextSucc: Int32Array
  pWars: Int32Array
  pRival: Int32Array
  pRivalSince: Int32Array
  pPeak: Int32Array
  /** 1 when two or more peoples each hold >= multiShare of its population (control pass). */
  pMulti: Uint8Array
  /** Conqueror's capital at the end, or -1. */
  pEndBy: Int32Array
  pCapIds: number[][]
  pCapYears: number[][]
  // v2: tariff rate, duty revenue and seized contraband this year and smoothed, ports among the members (control pass),
  // the war in which its ports are blockaded (-1), the bond in which it is the vassal or tributary (-1).
  pTariff: Float64Array
  pRevYear: Float64Array
  pRevSm: Float64Array
  pSub: Int32Array
  pPorts: Int32Array
  pBlockade: Int32Array
  /** Leagues: year since which its members have been safe (-1 not). */
  pCalm: Int32Array
  /** The market's view of the trade pairs (policy.ts; refreshed every step and when the pairs change), and the capitals this year (1, listed). */
  policy: unknown
  /** Year of the last flush of the market's accounts (outlaw.ts flushAccounts). */
  flushYear: number
  capMark: Uint8Array
  capList: number[]
  /** Settlements whose income is watched (capitals, smugglers' hubs): 1 per settlement, and the list in order of watching. */
  watch: Uint8Array
  watchList: number[]
  /** Settlements with pirates (pi > 0) at the last outlaw step. */
  havens: number[]
  /** Per-polity scratch. */
  scratchPol: Float64Array
  scratchPol2: Int32Array
  /** Alive polity ids, ascending. */
  alive: number[]

  // --- Bonds (v2, bonds.ts): vassalage, tribute, alliances, in order of making; the active ones in a list ---
  bKind: number[]
  bA: number[]
  bB: number[]
  bStart: number[]
  bEnd: number[]
  bCause: number[]
  /** Tribute: the year it lapses; alliance: the common rival. */
  bUntil: number[]
  bThreat: number[]
  activeBonds: number[]

  // --- Members, per polity (rebuilt by the control pass) ---
  memOff: Int32Array
  memList: Int32Array

  // --- Settlement graph (territory.ts) ---
  gNb: number[][]
  gCost: number[][]
  /** Persistent sea links of colonies to their parents (re-added at each map pass): flat pairs and costs. */
  linkA: number[]
  linkB: number[]
  linkCost: number[]
  /** Territory: owning settlement per cell (-1 nobody) and cost from it. */
  tOwner: Int32Array
  tDist: Float64Array
  /** Cells on a border between owners: cell, the other owner. */
  borderCell: number[]
  borderOther: number[]
  /** Cell danger 0..1 this step (siting, snapshots), and 1 on a border with a rival or enemy. */
  cellZ: Float32Array
  hostile: Uint8Array
  /** Unowned cells next to owned ones (map pass): cell, and their neighbouring owners [fringeOff[k], fringeOff[k + 1]). */
  fringeCell: number[]
  fringeOff: number[]
  fringeOwner: number[]
  /**
   * Claims (claims.ts, every map year after the step): the claiming polity and member per cell of nobody's land (-1 none),
   * and the search's share of reach spent and highest ground crossed (scratch); the year of the last claims pass.
   */
  cPol: Int32Array
  cOwner: Int32Array
  cKey: Float64Array
  cPeak: Float32Array
  claimYear: number
  /** Share of its food each member sends its capital (set every step), and the members that pay, ascending. */
  taxShare: Float64Array
  taxPayers: number[]
  /** Events already scanned for abandonments. */
  evSeen: number
  mapYear: number

  // --- Relations (pairs of adjacent polities whose peoples are in contact) ---
  relA: number[]
  relB: number[]
  relR: number[]
  relTruce: number[]
  relWar: number[]
  relLastWar: number[]
  relIndex: Map<number, number>
  /** v2: 1 while the pair embargoes trade short of war (policy.ts). */
  relEmb: number[]
  /** v2: the embargo record (embA..) of each relation's embargo in force, -1. */
  relEmbRec: number[]
  /** v2: embargoes, in order of declaration (History.embargoes). */
  embA: number[]
  embB: number[]
  embStart: number[]
  embEnd: number[]
  /** Border edges of each pair this step: flat (u, v, cost) triples, u < v. */
  relEdges: number[][]
  /** Contested cells per pair (recounted every map pass). */
  relContested: number[]
  /** Per-cell scratch for contested claims. */
  cellMark: Int32Array
  cellPol: Int32Array
  cellRun: number

  // --- Wars ---
  wKind: number[]
  wAtt: number[]
  wDef: number[]
  wStart: number[]
  wEnd: number[]
  wOutcome: number[]
  wTaken: number[]
  wRetaken: number[]
  wDead: number[]
  wSiege: number[]
  wSiegeYears: number[]
  wSiegeFrom: number[]
  /** Last year the attacker took ground. */
  wLastGain: number[]
  activeWars: number[]
  /** v2: bumped whenever a war begins or ends (the market refreshes its embargoes then). */
  warEpoch: number

  // --- Raid summary (decade, settlement) in order of first raid, looked up by key ---
  raidKey: Map<number, number>
  raidDecade: number[]
  raidSettlement: number[]
  raidCount: number[]
  raidWealth: number[]

  // --- Scratch ---
  heap: Heap
  /** Army path search (per cell). */
  aDist: Float64Array
  aPrev: Int32Array
  aStamp: Int32Array
  aRun: number
  aHeap: Heap
  stamp: Int32Array
  run: number
  /** Control pass: cost to ring settlements (foreign or stateless, next to members). */
  ringDist: Float64Array
  scratchF: Float64Array
  scratchI: Int32Array
  // --- Outlaw economy per route (v2, outlaw.ts; by route id, grown with the routes) ---
  /** Share of the cargo lost to pirates / privateers and to bandits, and who takes it (-1 none). */
  rPir: Float64Array
  rPirBy: Int32Array
  rBand: Float64Array
  rBandBy: Int32Array
  /** Sea cells on the route's path (-1 not counted yet). */
  rSea: Int32Array
  /** Contraband loads and share lost this year (for the trade snapshots). */
  rSmug: Float64Array
  rLoss: Float64Array
  /** Routes whose losses were set at the last outlaw step (to clear), and routes with contraband or losses this year (to clear). */
  outRoutes: number[]
  lossRoutes: number[]
  /** Coastal settlements near each route's sea cells (map pass): CSR over route ids [0, nearRoutes). */
  nearRoutes: number
  /** People of the world at the last control pass (living settlements, outposts excepted), for tierOf. */
  worldPop: number
  /** goods: the long-haul legs' legal and smuggled loads, plunder by pirates and by bandits since the last flush (outlaw.ts flushAccounts). */
  legAcc: Float64Array
  nearOff: Int32Array
  nearId: Int32Array
  /** Per cell: outlaw danger (pirates on coasts, bandits on roads) and the cells set, to clear; static sea-cell neighbourhoods of coasts (lazily). */
  cellOut: Float32Array
  outCells: number[]
  /** The unowned ones among outCells (the last outlaw step). */
  outFree: number[]
  /** Settlements within reach of a pirate haven (the last outlaw step): id, danger, haven; exMark[id] = index or -1. */
  exId: number[]
  exZ: number[]
  exBy: number[]
  exMark: Int32Array
  seaNearOff: Int32Array | null
  seaNearCell: Int32Array | null
  /** Counters for the stats harness. */
  diag: PolityDiag
}

export interface PolityDiag {
  raids: number
  raidsWon: number
  revolts: number
  revoltsWon: number
  fragmentations: number
  absorbed: number
  warDead: number
  sackDead: number
  raidDead: number
  /** Year and cell danger / defensibility of each founding (any settlement founded while the system ran). */
  foundYear: number[]
  foundCellZ: number[]
  foundT: number[]
  /** The founders' own danger, and 1 when the new settlement is on its parent's landmass. */
  foundFromZ: number[]
  foundHome: number[]
  /** The cell of each founding (for harness measures of site choice). */
  foundCell: number[]
  /**
   * Site choice against its alternatives (migration's foundings): year, the chosen cell's danger and defensibility, those of
   * the site the group would have chosen without danger (the best of those weighed by its score without the polities' site
   * factor), how many sites it weighed, 1 when that is the site chosen, the founders' own danger.
   */
  siteYear: number[]
  siteZ: number[]
  siteD: number[]
  siteAltZ: number[]
  siteAltD: number[]
  siteAltN: number[]
  siteSame: number[]
  siteFromZ: number[]
  // v2, per year (index = year): duty revenue, capitals' income, value crossing restricted borders legally and as
  // contraband (loads), cargo value lost to pirates / privateers and to bandits, sum of pirate strength.
  yRev: number[]
  yCapInc: number[]
  yLegal: number[]
  ySmug: number[]
  yPir: number[]
  yBand: number[]
  yPirates: number[]
  civilWars: number
  partitions: number
  reunified: number
  vassals: number
  tributes: number
  alliances: number
  forts: number
  refugeeTech: number
  /** People taken from the coasts by pirates; leagues formed. */
  pirCaptives: number
  leagues: number
}

function f64(n: number): Float64Array { return new Float64Array(n) }
function i32(n: number, v = 0): Int32Array { const a = new Int32Array(n); if (v !== 0) a.fill(v); return a }

export function createPolityState(s: HistoryState): PolityState {
  const T = s.terrain
  const N = T.cellCount
  const cap = 256, pcap = 64
  const land: number[] = []
  const landIndex = new Int32Array(N).fill(-1)
  for (let c = 0; c < N; c++) if (!T.sea[c]) { landIndex[c] = land.length; land.push(c) }
  const { defense, defenseD } = buildDefense(s.world, T)
  // (two literals: V8 keeps an object literal of 128 or more properties in slow dictionary mode; one assigned on keeps it fast)
  const base = {
    rng: createRng(s.world.seed, 'history-polities'),
    rngWar: createRng(s.world.seed, 'history-war'),
    defense, defenseD,
    landCells: Int32Array.from(land),
    landIndex,
    cap, seen: 0,
    polity: i32(cap, -1), joined: i32(cap), conqueredAt: i32(cap, NEVER),
    asab: f64(cap), unrest: f64(cap), assim: f64(cap), dist: f64(cap), danger: f64(cap), dangerAvg: f64(cap), ravage: f64(cap),
    walls: i32(cap), wallPop: f64(cap), str: f64(cap), local: f64(cap), badTax: new Uint8Array(cap), rose: i32(cap, NEVER),
    foundZ: new Float32Array(cap), taxIn: f64(cap),
    P: 0, pcap,
    pCapital: i32(pcap), pFounded: i32(pcap), pEnded: i32(pcap), pParent: i32(pcap), pOrigin: new Uint8Array(pcap), pEnd: new Uint8Array(pcap),
    pPeople: i32(pcap), pMembers: i32(pcap), pPop: f64(pcap), pMass: f64(pcap), pAsab: f64(pcap), pReach: f64(pcap), pExh: f64(pcap),
    pCrisisUntil: i32(pcap), pNextSucc: i32(pcap), pWars: i32(pcap), pRival: i32(pcap), pRivalSince: i32(pcap), pPeak: i32(pcap),
    pMulti: new Uint8Array(pcap), pEndBy: i32(pcap), pCapIds: [], pCapYears: [], alive: [],
    memOff: new Int32Array(1), memList: new Int32Array(0),
    gNb: [], gCost: [], linkA: [], linkB: [], linkCost: [],
    tOwner: new Int32Array(N).fill(-1), tDist: new Float64Array(N), borderCell: [], borderOther: [],
    cellZ: new Float32Array(N), hostile: new Uint8Array(N), fringeCell: [], fringeOff: [0], fringeOwner: [], taxShare: f64(cap), taxPayers: [], evSeen: 0, mapYear: -1,
    relA: [], relB: [], relR: [], relTruce: [], relWar: [], relLastWar: [], relIndex: new Map(), relEmb: [], relEmbRec: [], embA: [], embB: [], embStart: [], embEnd: [], relEdges: [], relContested: [], cellMark: new Int32Array(N), cellPol: new Int32Array(N), cellRun: 0,
    wKind: [], wAtt: [], wDef: [], wStart: [], wEnd: [], wOutcome: [], wTaken: [], wRetaken: [], wDead: [], wSiege: [], wSiegeYears: [], wSiegeFrom: [], wLastGain: [], activeWars: [], warEpoch: 0,
    raidKey: new Map(), raidDecade: [], raidSettlement: [], raidCount: [], raidWealth: [],
    heap: new Heap(256), aDist: new Float64Array(N), aPrev: new Int32Array(N), aStamp: new Int32Array(N), aRun: 0, aHeap: new Heap(256),
    stamp: new Int32Array(cap), run: 0, ringDist: f64(cap), scratchF: f64(cap), scratchI: i32(cap),
    diag: {
      raids: 0, raidsWon: 0, revolts: 0, revoltsWon: 0, fragmentations: 0, absorbed: 0, warDead: 0, sackDead: 0, raidDead: 0, foundYear: [], foundCellZ: [], foundT: [], foundFromZ: [], foundHome: [], foundCell: [],
      siteYear: [], siteZ: [], siteD: [], siteAltZ: [], siteAltD: [], siteAltN: [], siteSame: [], siteFromZ: [],
      yRev: [], yCapInc: [], yLegal: [], ySmug: [], yPir: [], yBand: [], yPirates: [], civilWars: 0, partitions: 0, reunified: 0, vassals: 0, tributes: 0, alliances: 0, forts: 0, refugeeTech: 0, pirCaptives: 0, leagues: 0,
    },
  }
  const v2 = {
    lawless: f64(cap), corrupt: f64(cap), smugYear: f64(cap), smugSm: f64(cap), incSm: f64(cap), pir: f64(cap), lane: f64(cap), pirRose: new Uint8Array(cap), taker: new Uint8Array(cap), ringDone: new Uint8Array(cap), fort: i32(cap, -1),
    hubBest: f64(cap), hubGood: i32(cap), hubPol: i32(cap, -1),
    pTariff: f64(pcap), pRevYear: f64(pcap), pRevSm: f64(pcap), pSub: i32(pcap, -1), pPorts: i32(pcap), pBlockade: i32(pcap, -1), pCalm: i32(pcap, -1), scratchPol: f64(pcap), scratchPol2: i32(pcap), policy: null, flushYear: 0, capMark: new Uint8Array(cap), capList: [], watch: new Uint8Array(cap), watchList: [], havens: [],
    bKind: [], bA: [], bB: [], bStart: [], bEnd: [], bCause: [], bUntil: [], bThreat: [], activeBonds: [],
    rPir: f64(256), rPirBy: i32(256, -1), rBand: f64(256), rBandBy: i32(256, -1), rSea: i32(256, -1), rSmug: f64(256), rLoss: f64(256), outRoutes: [], lossRoutes: [],
    nearRoutes: 0, nearOff: new Int32Array(1), nearId: new Int32Array(0), legAcc: new Float64Array(4), worldPop: 0,
    cellOut: new Float32Array(N), outCells: [], outFree: [], exId: [], exZ: [], exBy: [], exMark: i32(cap, -1), seaNearOff: null, seaNearCell: null,
    cPol: new Int32Array(N).fill(-1), cOwner: new Int32Array(N).fill(-1), cKey: new Float64Array(N), cPeak: new Float32Array(N), claimYear: -1,
  }
  return Object.assign(base, v2) as PolityState
}

function grow<T extends Int32Array | Float64Array | Float32Array | Uint8Array>(a: T, size: number, fill = 0): T {
  const b = new (a.constructor as { new (n: number): T })(size)
  if (fill !== 0) b.fill(fill)
  b.set(a)
  return b
}

/** Grows the per-settlement arrays to hold `need` settlements. */
export function ensureSettlements(ps: PolityState, need: number): void {
  if (need <= ps.cap) return
  let size = ps.cap
  while (size < need) size *= 2
  ps.polity = grow(ps.polity, size, -1)
  ps.joined = grow(ps.joined, size)
  ps.conqueredAt = grow(ps.conqueredAt, size, NEVER)
  ps.asab = grow(ps.asab, size)
  ps.unrest = grow(ps.unrest, size)
  ps.assim = grow(ps.assim, size)
  ps.dist = grow(ps.dist, size)
  ps.danger = grow(ps.danger, size)
  ps.dangerAvg = grow(ps.dangerAvg, size)
  ps.ravage = grow(ps.ravage, size)
  ps.walls = grow(ps.walls, size)
  ps.wallPop = grow(ps.wallPop, size)
  ps.str = grow(ps.str, size)
  ps.local = grow(ps.local, size)
  ps.badTax = grow(ps.badTax, size)
  ps.rose = grow(ps.rose, size, NEVER)
  ps.foundZ = grow(ps.foundZ, size)
  ps.taxIn = grow(ps.taxIn, size)
  ps.lawless = grow(ps.lawless, size)
  ps.corrupt = grow(ps.corrupt, size)
  ps.smugYear = grow(ps.smugYear, size)
  ps.smugSm = grow(ps.smugSm, size)
  ps.incSm = grow(ps.incSm, size)
  ps.pir = grow(ps.pir, size)
  ps.lane = grow(ps.lane, size)
  ps.pirRose = grow(ps.pirRose, size)
  ps.taker = grow(ps.taker, size)
  ps.ringDone = grow(ps.ringDone, size)
  ps.fort = grow(ps.fort, size, -1)
  ps.hubBest = grow(ps.hubBest, size)
  ps.hubGood = grow(ps.hubGood, size)
  ps.hubPol = grow(ps.hubPol, size, -1)
  ps.capMark = grow(ps.capMark, size)
  ps.watch = grow(ps.watch, size)
  ps.exMark = grow(ps.exMark, size, -1)
  ps.taxShare = grow(ps.taxShare, size)
  ps.stamp = grow(ps.stamp, size)
  ps.ringDist = grow(ps.ringDist, size)
  ps.scratchF = grow(ps.scratchF, size)
  ps.scratchI = grow(ps.scratchI, size)
  ps.cap = size
}

function ensurePolities(ps: PolityState, need: number): void {
  if (need <= ps.pcap) return
  let size = ps.pcap
  while (size < need) size *= 2
  ps.pCapital = grow(ps.pCapital, size)
  ps.pFounded = grow(ps.pFounded, size)
  ps.pEnded = grow(ps.pEnded, size)
  ps.pParent = grow(ps.pParent, size)
  ps.pOrigin = grow(ps.pOrigin, size)
  ps.pEnd = grow(ps.pEnd, size)
  ps.pPeople = grow(ps.pPeople, size)
  ps.pMembers = grow(ps.pMembers, size)
  ps.pPop = grow(ps.pPop, size)
  ps.pMass = grow(ps.pMass, size)
  ps.pAsab = grow(ps.pAsab, size)
  ps.pReach = grow(ps.pReach, size)
  ps.pExh = grow(ps.pExh, size)
  ps.pCrisisUntil = grow(ps.pCrisisUntil, size)
  ps.pNextSucc = grow(ps.pNextSucc, size)
  ps.pWars = grow(ps.pWars, size)
  ps.pRival = grow(ps.pRival, size)
  ps.pRivalSince = grow(ps.pRivalSince, size)
  ps.pPeak = grow(ps.pPeak, size)
  ps.pMulti = grow(ps.pMulti, size)
  ps.pEndBy = grow(ps.pEndBy, size)
  ps.pTariff = grow(ps.pTariff, size)
  ps.pRevYear = grow(ps.pRevYear, size)
  ps.pRevSm = grow(ps.pRevSm, size)
  ps.pSub = grow(ps.pSub, size, -1)
  ps.pPorts = grow(ps.pPorts, size)
  ps.pBlockade = grow(ps.pBlockade, size, -1)
  ps.pCalm = grow(ps.pCalm, size, -1)
  ps.scratchPol = grow(ps.scratchPol, size)
  ps.scratchPol2 = grow(ps.scratchPol2, size)
  ps.pcap = size
}

/** Grows the per-route arrays (outlaw economy) to hold `need` routes. */
export function ensureRoutesP(ps: PolityState, need: number): void {
  if (need <= ps.rPir.length) return
  let size = ps.rPir.length
  while (size < need) size *= 2
  ps.rPir = grow(ps.rPir, size)
  ps.rPirBy = grow(ps.rPirBy, size, -1)
  ps.rBand = grow(ps.rBand, size)
  ps.rBandBy = grow(ps.rBandBy, size, -1)
  ps.rSea = grow(ps.rSea, size, -1)
  ps.rSmug = grow(ps.rSmug, size)
  ps.rLoss = grow(ps.rLoss, size)
}

// --- Power -------------------------------------------------------------------------------------

/** Loss-of-strength gradient g(d) = 1 / (1 + (d / lambda)^2): a flat core and a falling frontier. */
export function grip(d: number, lambda: number): number {
  const x = d / lambda
  return 1 / (1 + x * x)
}

/**
 * Grain share gamma (the taxable, storable base): (1 - fishFrac - liveWeight * liveFrac) * storableOf, at least 0:
 * the farm part of a settlement's food, times how much of its crop keeps and can be counted and carried.
 */
export function grainShare(s: HistoryState, id: number): number {
  const g = (1 - s.fishFrac[id] - POLITY.liveWeight * s.liveFrac[id]) * storableOf(s, id)
  return g > 0 ? g : 0
}

/**
 * Taxable share of settlement id's crop (0..1): storeFloor + (1 - storeFloor) * min(1, sto / storeRef), sto species
 * v2's storable share of the crop (species.ts cropOf, storage.ts: what of each staple's harvest keeps, weighted by the
 * staples' shares of its crop food; grains about 0.75-0.95, tubers 0.05-0.5, minor crops SPECIES2.minorStore). A
 * harvest that keeps as well as storeRef counts in full; even one that does not keep is taxed in part (standing crops,
 * labour, tribute in kind), so wheat 1, maize 0.94, minor crops 0.79, sweet potato 0.68, cassava 0.56.
 * (History.storable is sto times the crop part of the food, storableByte; the grain share above applies its own
 * farm part, so the crop part is not counted twice.)
 */
export function storableOf(s: HistoryState, id: number): number {
  const v = s.sp.sto[id] / POLITY.storeRef
  return POLITY.storeFloor + (1 - POLITY.storeFloor) * (v < 1 ? v : 1)
}

/** Horses: 1 when settlement id keeps horses (species.ts), else 0 (military quality, steppe raiding). */
export function horseOf(s: HistoryState, id: number): number {
  return hasHorse(s, id) ? 1 : 0
}

/** Military quality q from the settlement's people's Metalworking and Crafts (and horses). */
export function qualityOf(s: HistoryState, id: number): number {
  const o = s.people[id] * TECH_FIELD_COUNT
  if (s.goods !== null) return armsQuality(s.goods, s.tech, o, horseOf(s, id), s.pop[id], id) // goods: arms stocks carry part of Metalworking's weight
  return 1 + POLITY.qMetal * (s.tech[o + TechField.Metalworking] - 1) + POLITY.qCrafts * (s.tech[o + TechField.Crafts] - 1) + 0.3 * horseOf(s, id)
}

/** Power b = pop * q * (1 + prosperityPower * prosperity). */
export function powerOf(s: HistoryState, id: number): number {
  return s.pop[id] * qualityOf(s, id) * (1 + POLITY.prosperityPower * prosperity(s, id))
}

/** Wall factor (1 + wall bonus) of settlement id; capital marks a walled capital's citadel. */
export function wallFactor(ps: PolityState, id: number, capital: boolean): number {
  const r = ps.walls[id]
  if (r <= 0) return 1
  return 1 + POLITY.wall + POLITY.wallRing * (r - 1) + (capital ? POLITY.wallCapital : 0)
}

/** True when settlement id is its polity's capital. */
export function isCapital(ps: PolityState, id: number): boolean {
  const p = ps.polity[id]
  return p >= 0 && ps.pCapital[p] === id
}

/** Local_i = a * b * T * (1 + wall): what a settlement can raise to defend itself (from this step's b). */
export function localOf(s: HistoryState, ps: PolityState, id: number): number {
  const x = ps.asab[id] * ps.str[id] * ps.defense[s.cell[id]] * wallFactor(ps, id, isCapital(ps, id))
  return ps.fort[id] >= 0 ? x * (1 + FORT.bonus) : x // (v2: a fort on its border)
}

/** Reach lambda_p (cost units) of polity p with `members` members. */
export function reachOf(s: HistoryState, p: number, people: number, members: number): number {
  const crafts = s.tech[people * TECH_FIELD_COUNT + TechField.Crafts]
  void p
  return (POLITY.lambda0 * s.terrain.cellScale * (1 + POLITY.reachCrafts * (crafts - 1))) / Math.sqrt(1 + members / POLITY.overload)
}

/** True while polity p is in a succession crisis. */
export function inCrisis(s: HistoryState, ps: PolityState, p: number): boolean {
  return ps.pCrisisUntil[p] > s.year
}

/** Power polity p projects at graph cost d from its capital (from this step's mass). */
export function projAt(ps: PolityState, p: number, d: number): number {
  const wars = ps.pWars[p]
  let e = ps.pExh[p]
  if (e > 1) e = 1
  return (ps.pMass[p] * grip(d, ps.pReach[p])) / (1 + POLITY.multiWar * (wars > 1 ? wars - 1 : 0)) * (1 - POLITY.exhaustionProj * e)
}

/** The submission test: does settlement j submit to power `proj` of a polity of people `people` (alpha the threshold)? */
export function submits(s: HistoryState, ps: PolityState, j: number, proj: number, people: number, alpha: number): boolean {
  const g = grainShare(s, j)
  const foreign = s.people[j] !== people ? 1 + POLITY.foreign : 1
  return proj * (POLITY.subBase + (1 - POLITY.subBase) * g) >= alpha * localOf(s, ps, j) * foreign
}

/** Peoples a and b are the same or have met. */
export function inContact(s: HistoryState, a: number, b: number): boolean {
  return a === b || s.know.contact[a * s.know.P + b] >= 0
}

// --- Membership ------------------------------------------------------------------------------------

/** Moves settlement id to polity p (-1: stateless) this year, keeping the counts. */
export function setPolity(s: HistoryState, ps: PolityState, id: number, p: number, dist: number): void {
  const old = ps.polity[id]
  if (old === p) return
  if (old >= 0) { ps.pMembers[old]--; ps.pPop[old] -= s.pop[id] }
  ps.polity[id] = p
  ps.joined[id] = s.year
  ps.dist[id] = dist
  if (p >= 0) {
    ps.pMembers[p]++
    ps.pPop[p] += s.pop[id]
    if (ps.pMembers[p] > ps.pPeak[p]) ps.pPeak[p] = ps.pMembers[p]
    if (s.people[id] === ps.pPeople[p]) ps.assim[id] = 1
    else if (old < 0 || ps.pPeople[old] !== ps.pPeople[p]) ps.assim[id] = 0
  }
}

/** Founds a polity with capital `capital` this year (logs PolityFounded); returns its id. */
export function newPolity(s: HistoryState, ps: PolityState, capital: number, origin: PolityOrigin, parent: number): number {
  const p = ps.P++
  ensurePolities(ps, p + 1)
  ps.pCapital[p] = capital
  ps.pFounded[p] = s.year
  ps.pEnded[p] = -1
  ps.pParent[p] = parent
  ps.pOrigin[p] = origin
  ps.pEnd[p] = PolityEnd.Alive
  ps.pPeople[p] = s.people[capital]
  ps.pMembers[p] = 0
  ps.pPop[p] = 0
  ps.pMass[p] = 0
  ps.pAsab[p] = ps.asab[capital]
  ps.pReach[p] = reachOf(s, p, s.people[capital], 1)
  ps.pExh[p] = 0
  ps.pCrisisUntil[p] = NEVER
  ps.pNextSucc[p] = s.year + UNREST.first + Math.floor(ps.rng.next() * UNREST.spreadYears)
  ps.pWars[p] = 0
  ps.pRival[p] = -1
  ps.pRivalSince[p] = NEVER
  ps.pPeak[p] = 0
  ps.pMulti[p] = 0
  ps.pEndBy[p] = -1
  ps.pTariff[p] = 0
  ps.pRevYear[p] = 0
  ps.pRevSm[p] = 0
  ps.pSub[p] = -1
  ps.pPorts[p] = 0
  ps.pBlockade[p] = -1
  ps.pCalm[p] = -1
  ps.pCapIds.push([capital])
  ps.pCapYears.push([s.year])
  ps.alive.push(p) // (ids ascend)
  setPolity(s, ps, capital, p, 0)
  logEvent(s, EventType.PolityFounded, capital, parent >= 0 ? ps.pCapital[parent] : -1, p)
  if (s.rul !== null) rulerNewPolity(s, ps, s.rul, p) // rulers: its first ruler
  return p
}

/** Makes `id` the capital of p this year (logs CapitalMoved unless it is already). */
export function moveCapital(s: HistoryState, ps: PolityState, p: number, id: number): void {
  const old = ps.pCapital[p]
  if (old === id) return
  ps.pCapital[p] = id
  ps.dist[id] = 0
  const ids = ps.pCapIds[p], years = ps.pCapYears[p]
  if (years[years.length - 1] === s.year) ids[ids.length - 1] = id
  else { ids.push(id); years.push(s.year) }
  ps.pRival[p] = -1
  ps.pRivalSince[p] = NEVER
  logEvent(s, EventType.CapitalMoved, id, s.abandoned[old] >= 0 && s.abandoned[old] < s.year ? -1 : old, p)
}

/** Ends polity p this year: its remaining members go stateless; logs PolityEnded. */
export function endPolity(s: HistoryState, ps: PolityState, p: number, cause: PolityEnd, by: number): void {
  if (ps.pEnded[p] >= 0) return
  const living = s.living
  for (let t = 0; t < living.length; t++) if (ps.polity[living[t]] === p) setPolity(s, ps, living[t], -1, FAR)
  for (let id = 0; id < ps.seen; id++) if (ps.polity[id] === p) setPolity(s, ps, id, -1, FAR) // (abandoned this year)
  ps.pEnded[p] = s.year
  ps.pEnd[p] = cause
  ps.pEndBy[p] = by
  ps.pMembers[p] = 0
  ps.pPop[p] = 0
  ps.pMass[p] = 0
  const i = ps.alive.indexOf(p)
  if (i >= 0) ps.alive.splice(i, 1)
  // v2: its bonds end with it.
  for (let j = ps.activeBonds.length - 1; j >= 0; j--) {
    const k = ps.activeBonds[j]
    if (ps.bA[k] !== p && ps.bB[k] !== p) continue
    ps.bEnd[k] = s.year
    ps.bCause[k] = BondEnd.Ended
    if (ps.bKind[k] !== BondKind.Alliance && ps.pSub[ps.bA[k]] === k) ps.pSub[ps.bA[k]] = -1
    ps.activeBonds.splice(j, 1)
  }
  if (s.rul !== null) rulerPolityEnded(s, ps, s.rul, p) // rulers: the reign ends with the realm
  logEvent(s, EventType.PolityEnded, ps.pCapital[p], by, p)
}

/** Tiers (derived, never stored; design 1.1). */
export const Tier = { Chiefdom: 0, Kingdom: 1, Empire: 2 } as const

/**
 * Tier of a polity of `pop` people in `members` settlements in a world of `world` people (living settlements, outposts
 * excepted: PolityState.worldPop); `multi` when two peoples each hold >= multiShare of its people.
 */
export function tierOf(pop: number, members: number, multi: boolean, world: number): number {
  const X = POLITY
  const e = X.empireShare * world
  if (pop >= (e > X.empirePop ? e : X.empirePop) || (multi && members >= X.multiMembers && pop >= X.empirePop)) return Tier.Empire
  const k = X.kingdomShare * world
  if (members >= X.kingdomMembers && pop >= (k > X.kingdomPop ? k : X.kingdomPop)) return Tier.Kingdom
  return Tier.Chiefdom
}

/** Clamps cohesion into [min, max]. */
export function clampAsab(a: number): number {
  return a < COHESION.min ? COHESION.min : a > COHESION.max ? COHESION.max : a
}
