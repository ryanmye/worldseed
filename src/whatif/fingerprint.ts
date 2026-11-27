// What-if (experience-whatif-director-sagas §1.5): the fingerprint of a History, what comparing it with another run of the
// same world needs, struct-of-arrays and small (about 0.3 MB for 2000 years), built in the worker before the History's
// arrays are transferred away. DOM-free and CSS-free: it imports only contract.ts and eventFields.ts.
//
// Everything that must be matched across two runs is keyed by geography (cells), not by ids: after the first founding
// that differs the two runs number their towns differently, and their polities, wars and rulers after the first state
// that differs. Two hashes per event: `evExact` (every field, ids and quantities bit for bit) finds the first year the
// runs differ at all, and `evHash` (type, year, the cells of `settlement` and of `other` when it is a settlement) says
// whether "the same thing happened in the same place" after they part. (Deviation from the plan's single evHash: one hash
// with rounded quantities would either miss a divergence that changes only a quantity, or split geo-equal events after
// the divergence; two hashes do both jobs.)
//
// Hash: FNV-1a 32-bit constants (offset basis 2166136261, prime 16777619; Noll et al. 2026, RFC 9923) over 32-bit words,
// not octets: a design choice; the hash is only ever compared with itself.

import type { History } from '../contract.ts'
import { isPlayerEvent, otherIsSettlementType } from './eventFields.ts'

/** Years between the per-people checkpoints (population, land, towns). */
export const CHECK_YEARS = 50
/** MinHash lanes per polity (the k-permutation estimator of Jaccard similarity: Broder 2000). */
export const MINHASH_K = 8
/** A MinHash lane of an empty set. */
export const MINHASH_EMPTY = 0xffffffff

/**
 * What the comparison of two histories needs of each, struct-of-arrays and small (well under 1 MB for 2000 years), built
 * in the worker before a History's arrays are transferred away. Settlement ids are kept for the shared prefix only:
 * after the first differing founding the two runs number their towns differently, so everything here that must be
 * matched across runs is keyed by geography (cells), not ids.
 */
export interface HistoryFingerprint {
  years: number
  snapshotInterval: number
  peoples: number
  /** Events in chronological order, order events (170-179) and cradle events (180) left out. */
  evCount: number
  evYear: Int16Array
  evType: Uint16Array
  /** Index of the event in History.events (for the main thread to look it up in its own copy). */
  evIndex: Int32Array
  /** Geo hash: type, year, the cell of `settlement`, the cell of `other` when it is a settlement (eventFields.ts); never an entity id. */
  evHash: Uint32Array
  /** Exact hash: type, year, settlement, other, value and extra bit for bit (equal only for the same event of the same numbering). */
  evExact: Uint32Array
  /** Cell of the event's settlement (-1 none). */
  evCell: Int32Array
  /** Settlements: cell, people, founded, abandoned (-1), peak population. */
  sCell: Int32Array; sPeople: Int16Array; sFounded: Int16Array; sAbandoned: Int16Array; sPeak: Float32Array
  /** Per checkpoint (every CHECK_YEARS years from 0, and the last year) per people: population, land cells held or claimed by states of that people, settlements alive. Row-major [k * peoples + p]. */
  checkYears: Int16Array
  peoplePop: Float32Array; peopleLand: Uint32Array; peopleTowns: Uint16Array
  /** Polities: founded, ended (-1), people, the founding capital (settlement id and cell), peak population and its year, and a MinHash (MINHASH_K lanes) of its land cells (held and claimed) at its peak (MINHASH_EMPTY lanes: no land then). */
  pFounded: Int16Array; pEnded: Int16Array; pPeople: Int16Array; pCap: Int32Array; pCapCell: Int32Array
  pPeak: Float32Array; pPeakYear: Int16Array; pMinhash: Uint32Array
  /** Faiths: founded, the holy city's cell (-1 a traditional faith), the founding people, peak followers (share-weighted population). */
  fFounded: Int16Array; fHolyCell: Int32Array; fPeople: Int16Array; fPeak: Float32Array
  /** Wars: start, end, attacker and defender polity ids (this run's), dead, outcome. */
  wStart: Int16Array; wEnd: Int16Array; wA: Int16Array; wD: Int16Array; wDead: Float32Array; wOutcome: Uint8Array
  /** Great epidemics (History.epidemics with `great`): their id, start year, origin cell, disease id, share of their network dead. */
  gId: Int32Array; gYear: Int16Array; gCell: Int32Array; gDisease: Int16Array; gShare: Float32Array
}

const FNV0 = 2166136261
const FNV_P = 16777619
const word = (h: number, w: number) => Math.imul(h ^ (w | 0), FNV_P)
const f64 = new Float64Array(1)
const u32 = new Uint32Array(f64.buffer)
/** Two words of a double, bit for bit. */
function wordsOf(h: number, v: number): number {
  f64[0] = v
  return word(word(h, u32[0]), u32[1])
}
/** A 32-bit finaliser (murmur3 fmix32) for the MinHash lanes. */
function fmix(x: number): number {
  x ^= x >>> 16
  x = Math.imul(x, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return x >>> 0
}
const LANE_SALT = [0x9e3779b9, 0x7f4a7c15, 0x632be59b, 0x1b873593, 0xcc9e2d51, 0xe6546b64, 0x85ebca6b, 0xc2b2ae35]
/** MinHash lane k of cell q. */
export const laneHash = (q: number, k: number) => fmix((q + 1) ^ LANE_SALT[k % LANE_SALT.length]) ^ fmix(k + 0x51ed27)

/** The fingerprint of `h` (needs only its fields: safe on a History whose big arrays are about to be transferred). */
export function fingerprintOf(h: History): HistoryFingerprint {
  const N = h.settlements.length
  const S = Math.max(1, h.snapshotCount)
  const I = Math.max(1, h.snapshotInterval)
  const P = h.peoples.length
  const snap = (y: number) => Math.max(0, Math.min(S - 1, Math.floor(y / I)))
  const cellOf = (id: number) => (id >= 0 && id < N ? h.settlements[id].cell : -1)

  // ---- events ----
  const E = h.events
  let n = 0
  for (const e of E) if (!isPlayerEvent(e.type)) n++
  const evYear = new Int16Array(n), evType = new Uint16Array(n), evIndex = new Int32Array(n), evHash = new Uint32Array(n), evExact = new Uint32Array(n), evCell = new Int32Array(n)
  n = 0
  for (let i = 0; i < E.length; i++) {
    const e = E[i]
    if (isPlayerEvent(e.type)) continue
    const cell = cellOf(e.settlement)
    const other = otherIsSettlementType(e.type) ? cellOf(e.other) : -2
    evYear[n] = e.year; evType[n] = e.type; evIndex[n] = i; evCell[n] = cell
    evHash[n] = word(word(word(word(FNV0, e.type), e.year), cell), other) >>> 0
    evExact[n] = wordsOf(wordsOf(word(word(word(word(FNV0, e.type), e.year), e.settlement), e.other), e.value), e.extra ?? -0.5) >>> 0
    n++
  }

  // ---- settlements ----
  const sCell = new Int32Array(N), sPeople = new Int16Array(N), sFounded = new Int16Array(N), sAbandoned = new Int16Array(N), sPeak = new Float32Array(N)
  for (let id = 0; id < N; id++) {
    const s = h.settlements[id]
    sCell[id] = s.cell; sPeople[id] = s.people; sFounded[id] = s.foundedYear; sAbandoned[id] = s.abandonedYear
  }
  const pop = h.population
  for (let s = 0; s < S; s++) {
    const o = s * N
    for (let id = 0; id < N; id++) { const v = pop[o + id]; if (v > sPeak[id]) sPeak[id] = v }
  }

  // ---- polities: peak population and its year ----
  const PL = h.polities?.length ?? 0
  const pol = h.polity && h.polity.length >= S * N ? h.polity : null
  const pFounded = new Int16Array(PL), pEnded = new Int16Array(PL), pPeople = new Int16Array(PL), pCap = new Int32Array(PL), pCapCell = new Int32Array(PL)
  const pPeak = new Float32Array(PL), pPeakYear = new Int16Array(PL).fill(-1), pPeakSnap = new Int32Array(PL).fill(-1)
  for (let p = 0; p < PL; p++) {
    const x = h.polities[p]
    pFounded[p] = x.foundedYear; pEnded[p] = x.endedYear; pPeople[p] = x.people
    pCap[p] = x.capitals[0] ?? -1; pCapCell[p] = cellOf(pCap[p])
  }
  if (pol && PL > 0) {
    const acc = new Float64Array(PL)
    for (let s = 0; s < S; s++) {
      acc.fill(0)
      const o = s * N
      for (let id = 0; id < N; id++) { const q = pol[o + id]; if (q >= 0 && q < PL) acc[q] += pop[o + id] }
      for (let p = 0; p < PL; p++) if (acc[p] > pPeak[p]) { pPeak[p] = acc[p]; pPeakSnap[p] = s; pPeakYear[p] = s * I }
    }
  }

  // ---- land: per people per checkpoint, and each polity's MinHash at its peak ----
  const L = h.landCells?.length ?? 0
  const Q = h.landSnapshotCount ?? 0
  const LI = Math.max(1, h.landInterval)
  const terr = h.territory && L > 0 && Q > 0 && h.territory.length >= Q * L ? h.territory : null
  const landQ = (y: number) => Math.max(0, Math.min(Q - 1, Math.round(y / LI)))
  /** Polity of land cell k at land snapshot q, with membership at snapshot s (-1 nobody's). */
  const ownerPolity = (q: number, k: number, s: number) => {
    const o = terr![q * L + k]
    return o > 0 && pol ? pol[s * N + o - 1] : -1
  }
  const K = Math.floor(h.years / CHECK_YEARS) + (h.years % CHECK_YEARS === 0 ? 1 : 2)
  const checkYears = new Int16Array(K)
  for (let k = 0; k < K; k++) checkYears[k] = Math.min(h.years, k * CHECK_YEARS)
  const peoplePop = new Float32Array(K * P), peopleLand = new Uint32Array(K * P), peopleTowns = new Uint16Array(K * P)
  for (let k = 0; k < K; k++) {
    const s = snap(checkYears[k]), o = s * N
    for (let id = 0; id < N; id++) {
      const v = pop[o + id], pe = sPeople[id]
      if (v > 0 && pe >= 0 && pe < P) { peoplePop[k * P + pe] += v; peopleTowns[k * P + pe]++ }
    }
    if (terr && pol) {
      const q = landQ(checkYears[k])
      for (let c = 0; c < L; c++) {
        const p = ownerPolity(q, c, s)
        if (p >= 0 && p < PL) { const pe = pPeople[p]; if (pe >= 0 && pe < P) peopleLand[k * P + pe]++ }
      }
    }
  }
  const pMinhash = new Uint32Array(PL * MINHASH_K).fill(MINHASH_EMPTY)
  if (terr && pol && PL > 0) {
    const groups = new Map<number, number[]>()
    for (let p = 0; p < PL; p++) {
      if (pPeakSnap[p] < 0) continue
      const q = landQ(pPeakYear[p])
      let g = groups.get(q)
      if (!g) groups.set(q, (g = []))
      g.push(p)
    }
    const want = new Uint8Array(PL)
    for (const [q, g] of groups) {
      // (membership at the land snapshot's own year, so borders and members agree)
      const s = snap(q * LI)
      for (const p of g) want[p] = 1
      for (let c = 0; c < L; c++) {
        const p = ownerPolity(q, c, s)
        if (p < 0 || p >= PL || !want[p]) continue
        const cell = h.landCells[c]
        for (let lane = 0; lane < MINHASH_K; lane++) {
          const v = laneHash(cell, lane), j = p * MINHASH_K + lane
          if (v < pMinhash[j]) pMinhash[j] = v
        }
      }
      for (const p of g) want[p] = 0
    }
  }

  // ---- faiths ----
  const FL = h.faiths?.length ?? 0
  const fFounded = new Int16Array(FL), fHolyCell = new Int32Array(FL), fPeople = new Int16Array(FL), fPeak = new Float32Array(FL)
  for (let f = 0; f < FL; f++) {
    const x = h.faiths[f]
    fFounded[f] = x.foundedYear; fHolyCell[f] = cellOf(x.holyCity); fPeople[f] = x.people
  }
  if (FL > 0 && h.faith && h.faith.length >= S * N) {
    const acc = new Float64Array(FL)
    for (let s = 0; s < S; s++) {
      acc.fill(0)
      const o = s * N
      for (let id = 0; id < N; id++) {
        const f = h.faith[o + id]
        if (f < FL) acc[f] += (pop[o + id] * (h.faithShare?.[o + id] ?? 255)) / 255
      }
      for (let f = 0; f < FL; f++) if (acc[f] > fPeak[f]) fPeak[f] = acc[f]
    }
  }

  // ---- wars ----
  const W = h.wars
  const WC = W?.count ?? 0
  const wStart = new Int16Array(WC), wEnd = new Int16Array(WC), wA = new Int16Array(WC), wD = new Int16Array(WC), wDead = new Float32Array(WC), wOutcome = new Uint8Array(WC)
  for (let w = 0; w < WC; w++) {
    wStart[w] = W.startYear[w]; wEnd[w] = W.endYear[w]; wA[w] = W.attacker[w]; wD[w] = W.defender[w]; wDead[w] = W.dead[w]; wOutcome[w] = W.outcome[w]
  }

  // ---- great epidemics ----
  const great = (h.epidemics ?? []).filter((x) => x.great)
  const G = great.length
  const gId = new Int32Array(G), gYear = new Int16Array(G), gCell = new Int32Array(G), gDisease = new Int16Array(G), gShare = new Float32Array(G)
  great.forEach((x, k) => { gId[k] = x.id; gYear[k] = x.startYear; gCell[k] = cellOf(x.origin); gDisease[k] = x.disease; gShare[k] = x.network > 0 ? x.deaths / x.network : 0 })

  return {
    years: h.years, snapshotInterval: I, peoples: P,
    evCount: evYear.length, evYear, evType, evIndex, evHash, evExact, evCell,
    sCell, sPeople, sFounded, sAbandoned, sPeak,
    checkYears, peoplePop, peopleLand, peopleTowns,
    pFounded, pEnded, pPeople, pCap, pCapCell, pPeak, pPeakYear, pMinhash,
    fFounded, fHolyCell, fPeople, fPeak,
    wStart, wEnd, wA, wD, wDead, wOutcome,
    gId, gYear, gCell, gDisease, gShare,
  }
}

/** The fingerprint's typed arrays (to transfer it). */
export function fingerprintBuffers(fp: HistoryFingerprint): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>()
  for (const v of Object.values(fp)) if (ArrayBuffer.isView(v) && v.buffer instanceof ArrayBuffer && v.byteLength > 0) out.add(v.buffer)
  return [...out]
}

/** Bytes of its typed arrays. */
export function fingerprintBytes(fp: HistoryFingerprint): number {
  let b = 0
  for (const v of Object.values(fp)) if (ArrayBuffer.isView(v)) b += v.byteLength
  return b
}
