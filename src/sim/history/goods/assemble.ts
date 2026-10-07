// goods: snapshots of the goods state (every trade snapshot) and the History fields assembled from them (each array with
// its own buffer). Ragged while the run goes (settlements, traditions, legs and secrets grow); assembly pads to the counts
// at the end of the run asked for, so a longer run repeats a shorter one exactly.

import { GOOD_COUNT, Good, IndustryBit, PRICE_INDEX_GOODS, SecretKind, VarietyKind } from '../../../contract.ts'
import type { Deposit, LongHaul, Secret, SecretHolds, Tradition, TradingPost, Variety } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { TradeState } from '../trade.ts'
import { CLASS, STOCK } from './params.ts'
import type { GoodsState } from './state.ts'
import { Maker } from './state.ts'
import { DK_CONTRACT } from './deposits.ts'
import { assembleLegRecords, legRecord, legRecordVolumes } from './legHistory.ts'

const G = GOOD_COUNT

/** Log-code thresholds: STEP16[b] = 2^((b - 128) / 16) for b in [0, 256), from repeated products of 2^(1/16) (sqrt only). */
const STEP16: Float64Array = (() => {
  const r = Math.sqrt(Math.sqrt(Math.sqrt(Math.sqrt(2))))
  const a = new Float64Array(256)
  a[128] = 1
  for (let b = 129; b < 256; b++) a[b] = a[b - 1] * r
  for (let b = 127; b >= 0; b--) a[b] = a[b + 1] / r
  return a
})()

/** Byte b (1..255) with 2^((b - zero) / 16) nearest below x (0 for x <= 0 or below the range). */
function logByte(x: number, zero: number): number {
  if (!(x > 0)) return 0
  const y = x * STEP16[zero] // (scale so that byte b means 2^((b - zero) / 16))
  // y relative to STEP16 with zero 128: find the largest b with STEP16[b] <= y.
  let lo = 0, hi = 255
  if (y < STEP16[1]) return 1
  if (y >= STEP16[255]) return 255
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (STEP16[mid] <= y) lo = mid; else hi = mid }
  return lo < 1 ? 1 : lo
}

function growU8(a: Uint8Array, need: number): Uint8Array { if (need <= a.length) return a; let n = a.length; while (n < need) n *= 2; const b = new Uint8Array(n); b.set(a); return b }
function growU16(a: Uint16Array, need: number): Uint16Array { if (need <= a.length) return a; let n = a.length; while (n < need) n *= 2; const b = new Uint16Array(n); b.set(a); return b }
function growF32(a: Float32Array, need: number): Float32Array { if (need <= a.length) return a; let n = a.length; while (n < need) n *= 2; const b = new Float32Array(n); b.set(a); return b }

/** Snapshot (with the trade snapshots, every tradeInterval years). */
export function goodsSnapshot(s: HistoryState, g: GoodsState, ts: TradeState): void {
  const S = s.count
  const D = g.dCount, T = g.tCount, L = g.legHist.count, K = g.sCount // (legs: History.longHaul's records, legHistory.ts)
  g.snapS.push(S); g.snapL.push(L); g.snapT.push(T); g.snapK.push(K)
  g.snapOffS.push(g.sUsed); g.snapOffL.push(g.lvUsed); g.snapOffT.push(g.tqUsed); g.snapOffK.push(g.gUsed)
  g.snapCount++
  g.depositOutput = growF32(g.depositOutput, g.depUsed + D)
  for (let d = 0; d < D; d++) g.depositOutput[g.depUsed + d] = g.dOut[d]
  g.depUsed += D
  g.traditionQ = growU8(g.traditionQ, g.tqUsed + T)
  for (let t = 0; t < T; t++) { const q = Math.floor(g.tQ[t] * 64 + 0.5); g.traditionQ[g.tqUsed + t] = g.tEnd[t] >= 0 ? 0 : q > 255 ? 255 : q }
  g.tqUsed += T
  g.legVolSnap = growF32(g.legVolSnap, g.lvUsed + L)
  legRecordVolumes(g, g.legVolSnap, g.lvUsed)
  g.lvUsed += L
  g.guardSnap = growU8(g.guardSnap, g.gUsed + K)
  for (let k = 0; k < K; k++) { const x = Math.floor(g.sPsi[k] * 255 + 0.5); g.guardSnap[g.gUsed + k] = g.sLost[k] >= 0 ? 0 : x > 255 ? 255 : x < 0 ? 0 : x }
  g.gUsed += K
  // Per settlement: industry, tools and arms, prices, marts.
  const o = g.sUsed
  g.industry = growU16(g.industry, o + S)
  g.metal = growU8(g.metal, (o + S) * 2)
  g.priceIndex = growU8(g.priceIndex, (o + S) * 5)
  g.mart = growU8(g.mart, o + S)
  // Industry bits from the deposits, traditions, posts and lanes.
  const ind = g.industry
  ind.fill(0, o, o + S)
  for (let d = 0; d < D; d++) { const w = g.dWorker[d]; if (w >= 0 && g.dOut[d] > 0 && w < S) ind[o + w] |= IndustryBit.Mine }
  for (let t = 0; t < T; t++) {
    if (g.tEnd[t] >= 0) continue
    const se = g.tSeats[t], to = g.tSeatTo[t]
    for (let k = 0; k < se.length; k++) {
      if (to[k] >= 0) continue
      if (g.tCraft[t] === 3) ind[o + se[k]] |= IndustryBit.Bladesmiths
      if (g.tRenowned[t]) ind[o + se[k]] |= IndustryBit.GuildHall
    }
  }
  for (let i = 0; i < g.postCount; i++) if (g.pEnded[i] < 0 && g.pHost[i] >= 0) ind[o + g.pHost[i]] |= IndustryBit.Factory
  for (const k of g.lanes) if (g.legOpen[k]) ind[o + g.legA[k]] |= IndustryBit.Shipyard
  const ps = s.pol
  for (let id = 0; id < S; id++) {
    const alive = s.abandoned[id] < 0
    const pop = s.pop[id]
    let bits = ind[o + id]
    if (alive && id < g.cap) {
      if (g.wOut[id * 3] > 1) bits |= IndustryBit.Forge
      if (g.wOut[id * 3 + 2] > 1 || g.silkOut[id] > 1) bits |= IndustryBit.Weaving
      if (g.wOut[id * 3 + 1] > 1) bits |= IndustryBit.Dyeworks
      if (g.isMart[id]) {
        let merchant = false
        for (const c of PRICE_INDEX_GOODS) if (g.held[id * G + c] > STOCK.capYearsHV * ts.demand[id * G + c] * 0.5 && ts.demand[id * G + c] > 0) merchant = true
        if (merchant) bits |= IndustryBit.Warehouses
      }
      if (ps !== null && id < ps.seen) {
        const p = ps.polity[id]
        if (p >= 0 && ps.pCapital[p] === id && g.held[id * G + Good.Treasure] >= 2 * ts.demand[id * G + Good.Treasure] && ts.demand[id * G + Good.Treasure] > 0) bits |= IndustryBit.Mint
      }
    } else bits = 0
    ind[o + id] = bits
    const mo = (o + id) * 2
    if (alive && id < g.cap && pop > 0) {
      g.metal[mo] = logByte(g.tools[id] / pop, 160)
      g.metal[mo + 1] = logByte(g.arms[id] / pop, 160)
    } else { g.metal[mo] = 0; g.metal[mo + 1] = 0 }
    const po = (o + id) * 5
    const trades = alive && id < ts.trader.length && ts.trader[id] === 1
    for (let j = 0; j < 5; j++) {
      const c = PRICE_INDEX_GOODS[j]
      const w = trades ? ts.worth[id * G + c] : 0
      g.priceIndex[po + j] = trades && w > 0 ? logByte(ts.price[id * G + c] / w, 128) : 0
    }
    g.mart[o + id] = alive && id < g.cap && g.isMart[id] ? 1 : 0
  }
  g.sUsed += S
}

/** The goods fields of History (empty ones when the system is off). */
export interface GoodsHistory {
  varieties: Variety[]
  deposits: Deposit[]
  depositOutput: Float32Array
  traditions: Tradition[]
  traditionQuality: Uint8Array
  industry: Uint16Array
  metal: Uint8Array
  longHaul: LongHaul
  longHaulVolume: Float32Array
  priceIndex: Uint8Array
  mart: Uint8Array
  secrets: Secret[]
  secretHolds: SecretHolds
  secretGuard: Uint8Array
  posts: TradingPost[]
}

export function emptyGoodsHistory(): GoodsHistory {
  return {
    varieties: [], deposits: [], depositOutput: new Float32Array(0), traditions: [], traditionQuality: new Uint8Array(0), industry: new Uint16Array(0), metal: new Uint8Array(0),
    longHaul: { count: 0, a: new Int32Array(0), b: new Int32Array(0), kind: new Uint8Array(0), openedYear: new Int16Array(0), closedYear: new Int16Array(0), chart: new Int16Array(0), goodAB: new Uint8Array(0), goodBA: new Uint8Array(0), pathOffsets: new Uint32Array(1), path: new Uint32Array(0) },
    longHaulVolume: new Float32Array(0), priceIndex: new Uint8Array(0), mart: new Uint8Array(0),
    secrets: [], secretHolds: { count: 0, secret: new Uint16Array(0), people: new Int8Array(0), polity: new Int16Array(0), from: new Int16Array(0), to: new Int16Array(0), channel: new Uint8Array(0), via: new Int32Array(0) },
    secretGuard: new Uint8Array(0), posts: [],
  }
}

/**
 * The goods fields of History up to `tradeSnapshotCount` trade snapshots (taken by year `years`), names from the settlement
 * and people names. Things that began after `years` cannot exist yet (the state is at `years`).
 */
export function assembleGoods(g: GoodsState, years: number, tradeSnapshotCount: number, S: number, names: readonly string[], peopleNames: readonly string[]): GoodsHistory {
  const Q = tradeSnapshotCount
  const nameOf = (kind: number, id: number): string => kind === Maker.People ? peopleNames[id] ?? '' : kind === Maker.Settlement ? names[id] ?? '' : ''
  const varieties: Variety[] = []
  for (let v = 0; v < g.vCount; v++) {
    varieties.push({
      id: v, good: (v === 0 ? 0 : g.vGood[v]) as Good, kind: g.vKind[v] as Variety['kind'], source: g.vSource[v], people: g.vPeople[v],
      maker: nameOf(g.vMakerKind[v], g.vMakerId[v]), value: v === 0 ? 0 : g.vValue[v], firstYear: g.vFirst[v],
    })
  }
  const D = g.dCount
  const deposits: Deposit[] = []
  for (let d = 0; d < D; d++) deposits.push({ id: d, kind: DK_CONTRACT[g.dKind[d]] as Deposit['kind'], cell: g.dCell[d], richness: g.dRich[d], foundYear: g.dFound[d], foundBy: g.dFoundBy[d], exhaustedYear: g.dExh[d], variety: g.dVar[d] })
  const depositOutput = new Float32Array(Q * D)
  depositOutput.set(g.depositOutput.subarray(0, Q * D))
  const T = g.tCount
  const traditions: Tradition[] = []
  for (let t = 0; t < T; t++) {
    traditions.push({
      id: t, craft: g.tCraft[t] as Tradition['craft'], good: CLASS.mixed[g.tCraft[t] === 3 ? 1 : 2] as Good, variety: g.tVar[t], people: g.tPeople[t],
      maker: names[g.tBornAt[t]] ?? '', bornYear: g.tBorn[t], bornAt: g.tBornAt[t], endYear: g.tEnd[t], parent: g.tParent[t],
      seats: g.tSeats[t].slice(), seatFrom: g.tSeatFrom[t].slice(), seatTo: g.tSeatTo[t].slice(),
    })
  }
  const traditionQuality = new Uint8Array(Q * T)
  for (let q = 0; q < Q; q++) traditionQuality.set(g.traditionQ.subarray(g.snapOffT[q], g.snapOffT[q] + g.snapT[q]), q * T)
  const industry = new Uint16Array(Q * S)
  const metal = new Uint8Array(Q * S * 2)
  const priceIndex = new Uint8Array(Q * S * 5)
  const mart = new Uint8Array(Q * S)
  for (let q = 0; q < Q; q++) {
    const o = g.snapOffS[q], n = g.snapS[q]
    industry.set(g.industry.subarray(o, o + n), q * S)
    metal.set(g.metal.subarray(o * 2, (o + n) * 2), q * S * 2)
    priceIndex.set(g.priceIndex.subarray(o * 5, (o + n) * 5), q * S * 5)
    mart.set(g.mart.subarray(o, o + n), q * S)
  }
  // Legs: the records of the legs' spells (legHistory.ts), so a longer run repeats a shorter one.
  const lh: LongHaul = assembleLegRecords(g)
  const L = lh.count
  const longHaulVolume = new Float32Array(Q * L)
  for (let q = 0; q < Q; q++) longHaulVolume.set(g.legVolSnap.subarray(g.snapOffL[q], g.snapOffL[q] + g.snapL[q]), q * L)
  const K = g.sCount
  const secrets: Secret[] = []
  for (let k = 0; k < K; k++) secrets.push({ id: k, kind: g.sKind[k] as Secret['kind'], subject: g.sKind[k] === SecretKind.Chart ? legRecord(g, g.sSubject[k]) : g.sSubject[k], foundYear: g.sFound[k], foundAt: g.sFoundAt[k], lostYear: g.sLost[k] })
  const H = g.hSecret.length
  const order: number[] = []
  for (let i = 0; i < H; i++) order.push(i)
  order.sort((x, y) => g.hFrom[x] - g.hFrom[y] || x - y)
  const holds: SecretHolds = { count: H, secret: new Uint16Array(H), people: new Int8Array(H), polity: new Int16Array(H), from: new Int16Array(H), to: new Int16Array(H), channel: new Uint8Array(H), via: new Int32Array(H) }
  for (let j = 0; j < H; j++) {
    const i = order[j]
    holds.secret[j] = g.hSecret[i]; holds.people[j] = g.hPeople[i]; holds.polity[j] = g.hPolity[i]; holds.from[j] = g.hFrom[i]
    holds.to[j] = g.hTo[i]; holds.channel[j] = g.hChannel[i]; holds.via[j] = g.hVia[i]
  }
  const secretGuard = new Uint8Array(Q * K)
  for (let q = 0; q < Q; q++) secretGuard.set(g.guardSnap.subarray(g.snapOffK[q], g.snapOffK[q] + g.snapK[q]), q * K)
  const posts: TradingPost[] = []
  for (let i = 0; i < g.postCount; i++) posts.push({ id: i, kind: g.pKind[i] as TradingPost['kind'], owner: g.pOwner[i], host: g.pHost[i], settlement: g.pSettlement[i], leg: legRecord(g, g.pLeg[i]), foundedYear: g.pFounded[i], endedYear: g.pEnded[i] })
  void years
  void VarietyKind
  return { varieties, deposits, depositOutput, traditions, traditionQuality, industry, metal, longHaul: lh, longHaulVolume, priceIndex, mart, secrets, secretHolds: holds, secretGuard, posts }
}
