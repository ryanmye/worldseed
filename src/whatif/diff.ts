// What-if (experience-whatif-director-sagas §1.6): how two runs of one world differ, from their fingerprints
// (fingerprint.ts). DOM-free; computed in the worker. O(E log E_year + P_A·P_B).
//
// 1. Divergence: the first year whose events differ (multisets of exact hashes per year), -1 when the runs are the same
//    throughout (a failed order changes nothing).
// 2. Similarity per decade: the share of geo-keyed events found in both, |A ∩ B| / max(|A|, |B|) as multisets.
// 3. First differences: within the causal window [divergence, divergence + CAUSAL_YEARS], the events of each side that the
//    other has not (by geo hash), up to FIRST_MAX per side (ranked later, on the main thread, by drama).
// 4. Settlements: ids below the first differing founding map to themselves; after it, by (cell, people) to the A town of
//    nearest founding year within SETTLE_YEARS.
// 5. Polities: those founded before the divergence keep their ids; the rest by score
//    0.6·J + 0.25·[same founding capital] + 0.15·exp(−|Δfounded|/100), same people only, greedy, threshold 0.35, where J
//    is the Jaccard index (Jaccard 1901) of their peak-extent land, estimated by MinHash (Broder 2000): the share of equal
//    lanes, standard error √(J(1−J)/8) with 8 lanes. Weights, scale and threshold are design defaults.
// 6. Faiths by holy city and people (|Δfounded| ≤ 150), wars by matched sides (|Δstart| ≤ 10), great epidemics by disease,
//    origin (chord ≤ 0.3) and |Δyear| ≤ 20.

import { MINHASH_EMPTY, MINHASH_K, type HistoryFingerprint } from './fingerprint.ts'

/** Years after the divergence in which differences are told as consequences of the order ("the causal window"; owner decision: about 40 years). */
export const CAUSAL_YEARS = 40
/** First differences kept per side. */
export const FIRST_MAX = 200
/** Settlement match: the largest difference in founding years. */
export const SETTLE_YEARS = 50
export const POLITY_MATCH = { wJaccard: 0.6, wCapital: 0.25, wFounded: 0.15, foundedScale: 100, threshold: 0.35 } as const
export const FAITH_YEARS = 150
export const WAR_YEARS = 10
export const EPIDEMIC_YEARS = 20
export const EPIDEMIC_CHORD = 0.3

export interface WhatIfDigest {
  /** First year whose events differ (multisets of exact event hashes per year), -1 when the two are the same throughout (a failed order). */
  divergence: number
  /** Per decade from 0: share of geo-keyed events in both, 0..1 (|A ∩ B| / max(|A|, |B|), multiset; 1 when neither has any). */
  similarity: Float32Array
  /** Up to FIRST_MAX events of each history in [divergence, divergence + CAUSAL_YEARS] that the other has not (History.events indices, chronological). */
  firstA: Int32Array
  firstB: Int32Array
  /** Settlement match: for each settlement of B, the matched settlement of A or -1 (ids below `prefix` map to themselves). */
  prefix: number
  sMatch: Int32Array
  /** Polity match: for each polity of B, the matched polity of A or -1, and the match score (1 for a shared polity). */
  pMatch: Int16Array
  pScore: Float32Array
  /** Faith match (B → A, -1), war match (B → A, -1), great-epidemic match (B row → A row of the fingerprints' g* arrays, -1). */
  fMatch: Int16Array
  wMatch: Int32Array
  gMatch: Int32Array
  /** The year compared at (the shorter run's end). */
  years: number
}

/** [lo, hi) ranges of each year in a chronological year column (lo[y] = hi[y] when none). */
function yearRanges(year: Int16Array, years: number): Int32Array {
  const r = new Int32Array(years + 2)
  let i = 0
  for (let y = 0; y <= years + 1; y++) {
    r[y] = i
    while (i < year.length && year[i] <= y) i++
  }
  return r // events of year y: [r[y], r[y + 1]) ... see at()
}

/** Common elements of two ascending Uint32 arrays (multiset). */
function common(a: Uint32Array, b: Uint32Array): number {
  let i = 0, j = 0, n = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { n++; i++; j++ } else if (a[i] < b[j]) i++
    else j++
  }
  return n
}

/** Event positions in [lo, hi) of one side that the other side's [lo2, hi2) has not (by hash, multiset), chronological. */
function unmatched(h1: Uint32Array, lo: number, hi: number, h2: Uint32Array, lo2: number, hi2: number, max: number): number[] {
  const count = new Map<number, number>()
  for (let i = lo2; i < hi2; i++) count.set(h2[i], (count.get(h2[i]) ?? 0) + 1)
  const out: number[] = []
  for (let i = lo; i < hi && out.length < max; i++) {
    const c = count.get(h1[i]) ?? 0
    if (c > 0) count.set(h1[i], c - 1)
    else out.push(i)
  }
  return out
}

/** Estimated Jaccard index of two MinHash rows (0 when either set is empty). */
export function minhashJaccard(a: Uint32Array, i: number, b: Uint32Array, j: number): number {
  let eq = 0
  for (let k = 0; k < MINHASH_K; k++) {
    const x = a[i * MINHASH_K + k], y = b[j * MINHASH_K + k]
    if (x === MINHASH_EMPTY || y === MINHASH_EMPTY) return 0
    if (x === y) eq++
  }
  return eq / MINHASH_K
}

/** How B differs from A. `positions` (the world's unit cell positions, 3 per cell) for the epidemic origin test; without them only the same cell matches. */
export function diffFingerprints(A: HistoryFingerprint, B: HistoryFingerprint, positions?: Float32Array | null): WhatIfDigest {
  const years = Math.min(A.years, B.years)
  const ra = yearRanges(A.evYear, years), rb = yearRanges(B.evYear, years)
  const at = (r: Int32Array, y: number) => [r[y], r[y + 1]] as const
  // ---- 1. divergence ----
  let divergence = -1
  for (let y = 0; y <= years && divergence < 0; y++) {
    const [a0, a1] = at(ra, y), [b0, b1] = at(rb, y)
    if (a1 - a0 !== b1 - b0) { divergence = y; break }
    if (a1 === a0) continue
    const x = A.evExact.slice(a0, a1).sort(), z = B.evExact.slice(b0, b1).sort()
    for (let k = 0; k < x.length; k++) if (x[k] !== z[k]) { divergence = y; break }
  }
  // ---- 2. similarity per decade ----
  const D = Math.floor(years / 10) + 1
  const similarity = new Float32Array(D)
  for (let d = 0; d < D; d++) {
    const y0 = d * 10, y1 = Math.min(years, y0 + 9)
    const a0 = ra[y0], a1 = ra[y1 + 1], b0 = rb[y0], b1 = rb[y1 + 1]
    const m = Math.max(a1 - a0, b1 - b0)
    if (m === 0) { similarity[d] = 1; continue }
    if (divergence < 0 || y1 < divergence) { similarity[d] = 1; continue }
    similarity[d] = common(A.evHash.slice(a0, a1).sort(), B.evHash.slice(b0, b1).sort()) / m
  }
  // ---- 3. first differences ----
  let firstA = new Int32Array(0), firstB = new Int32Array(0)
  if (divergence >= 0) {
    const y1 = Math.min(years, divergence + CAUSAL_YEARS)
    const a0 = ra[divergence], a1 = ra[y1 + 1], b0 = rb[divergence], b1 = rb[y1 + 1]
    firstA = Int32Array.from(unmatched(A.evHash, a0, a1, B.evHash, b0, b1, FIRST_MAX), (i) => A.evIndex[i])
    firstB = Int32Array.from(unmatched(B.evHash, b0, b1, A.evHash, a0, a1, FIRST_MAX), (i) => B.evIndex[i])
  }
  // ---- 4. settlements ----
  const NA = A.sCell.length, NB = B.sCell.length
  let prefix = 0
  const nMin = Math.min(NA, NB)
  while (prefix < nMin && A.sCell[prefix] === B.sCell[prefix] && A.sPeople[prefix] === B.sPeople[prefix] && A.sFounded[prefix] === B.sFounded[prefix]) prefix++
  const sMatch = new Int32Array(NB).fill(-1)
  for (let i = 0; i < prefix; i++) sMatch[i] = i
  {
    const byKey = new Map<number, number[]>()
    for (let i = prefix; i < NA; i++) {
      const k = A.sCell[i] * 1024 + (A.sPeople[i] & 1023)
      let l = byKey.get(k)
      if (!l) byKey.set(k, (l = []))
      l.push(i)
    }
    const used = new Uint8Array(NA)
    for (let j = prefix; j < NB; j++) {
      const l = byKey.get(B.sCell[j] * 1024 + (B.sPeople[j] & 1023))
      if (!l) continue
      let best = -1, bd = SETTLE_YEARS + 1
      for (const i of l) {
        if (used[i]) continue
        const d = Math.abs(A.sFounded[i] - B.sFounded[j])
        if (d < bd) { bd = d; best = i }
      }
      if (best >= 0) { used[best] = 1; sMatch[j] = best }
    }
  }
  // ---- 5. polities ----
  const PA = A.pFounded.length, PB = B.pFounded.length
  const pMatch = new Int16Array(PB).fill(-1), pScore = new Float32Array(PB)
  const pUsed = new Uint8Array(PA)
  let pPrefix = 0
  const div = divergence < 0 ? Infinity : divergence
  while (pPrefix < Math.min(PA, PB) && A.pFounded[pPrefix] < div && A.pFounded[pPrefix] === B.pFounded[pPrefix] && A.pPeople[pPrefix] === B.pPeople[pPrefix] && A.pCap[pPrefix] === B.pCap[pPrefix]) {
    pMatch[pPrefix] = pPrefix; pScore[pPrefix] = 1; pUsed[pPrefix] = 1; pPrefix++
  }
  {
    const pairs: { a: number; b: number; s: number }[] = []
    const M = POLITY_MATCH
    for (let b = pPrefix; b < PB; b++) {
      for (let a = pPrefix; a < PA; a++) {
        if (A.pPeople[a] !== B.pPeople[b]) continue
        const J = minhashJaccard(A.pMinhash, a, B.pMinhash, b)
        const capB = B.pCap[b]
        const capOk = A.pCapCell[a] === B.pCapCell[b] || (capB >= 0 && capB < NB && sMatch[capB] >= 0 && sMatch[capB] === A.pCap[a]) ? 1 : 0
        const s = M.wJaccard * J + M.wCapital * capOk + M.wFounded * Math.exp(-Math.abs(A.pFounded[a] - B.pFounded[b]) / M.foundedScale)
        if (s >= M.threshold) pairs.push({ a, b, s })
      }
    }
    pairs.sort((x, y) => y.s - x.s || x.b - y.b || x.a - y.a)
    for (const { a, b, s } of pairs) {
      if (pMatch[b] >= 0 || pUsed[a]) continue
      pMatch[b] = a; pScore[b] = s; pUsed[a] = 1
    }
  }
  // ---- 6. faiths, wars, great epidemics ----
  const FA = A.fFounded.length, FB = B.fFounded.length
  const fMatch = new Int16Array(FB).fill(-1)
  {
    const used = new Uint8Array(FA)
    for (let f = 0; f < Math.min(FB, FA, B.peoples); f++) { fMatch[f] = f; used[f] = 1 } // (each people's traditional faith: faith id = people id)
    for (let f = B.peoples; f < FB; f++) {
      let best = -1, bd = FAITH_YEARS + 1
      for (let g = A.peoples; g < FA; g++) {
        if (used[g] || A.fPeople[g] !== B.fPeople[f] || A.fHolyCell[g] !== B.fHolyCell[f]) continue
        const d = Math.abs(A.fFounded[g] - B.fFounded[f])
        if (d < bd) { bd = d; best = g }
      }
      if (best >= 0) { fMatch[f] = best; used[best] = 1 }
    }
  }
  const WA = A.wStart.length, WB = B.wStart.length
  const wMatch = new Int32Array(WB).fill(-1)
  {
    const used = new Uint8Array(WA)
    for (let w = 0; w < WB; w++) {
      const ma = B.wA[w] >= 0 && B.wA[w] < PB ? pMatch[B.wA[w]] : -1, md = B.wD[w] >= 0 && B.wD[w] < PB ? pMatch[B.wD[w]] : -1
      if (ma < 0 || md < 0) continue
      let best = -1, bd = WAR_YEARS + 1
      for (let u = 0; u < WA; u++) {
        if (used[u] || A.wA[u] !== ma || A.wD[u] !== md) continue
        const d = Math.abs(A.wStart[u] - B.wStart[w])
        if (d < bd) { bd = d; best = u }
      }
      if (best >= 0) { wMatch[w] = best; used[best] = 1 }
    }
  }
  const GA = A.gYear.length, GB = B.gYear.length
  const gMatch = new Int32Array(GB).fill(-1)
  {
    const used = new Uint8Array(GA)
    const near = (c1: number, c2: number) => {
      if (c1 === c2) return true
      if (!positions || c1 < 0 || c2 < 0) return false
      const dx = positions[c1 * 3] - positions[c2 * 3], dy = positions[c1 * 3 + 1] - positions[c2 * 3 + 1], dz = positions[c1 * 3 + 2] - positions[c2 * 3 + 2]
      return dx * dx + dy * dy + dz * dz <= EPIDEMIC_CHORD * EPIDEMIC_CHORD
    }
    for (let g = 0; g < GB; g++) {
      let best = -1, bd = EPIDEMIC_YEARS + 1
      for (let u = 0; u < GA; u++) {
        if (used[u] || A.gDisease[u] !== B.gDisease[g] || !near(A.gCell[u], B.gCell[g])) continue
        const d = Math.abs(A.gYear[u] - B.gYear[g])
        if (d < bd) { bd = d; best = u }
      }
      if (best >= 0) { gMatch[g] = best; used[best] = 1 }
    }
  }
  return { divergence, similarity, firstA, firstB, prefix, sMatch, pMatch, pScore, fMatch, wMatch, gMatch, years }
}

/** The first year (decade start) at or after the divergence at which the similarity falls below `share` (-1 never). */
export function partingYear(d: WhatIfDigest, share = 0.5): number {
  if (d.divergence < 0) return -1
  for (let k = Math.floor(d.divergence / 10); k < d.similarity.length; k++) if (d.similarity[k] < share) return k * 10
  return -1
}

/** The digest's typed arrays (to transfer it). */
export function digestBuffers(d: WhatIfDigest): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>()
  for (const v of Object.values(d)) if (ArrayBuffer.isView(v) && v.buffer instanceof ArrayBuffer && v.byteLength > 0) out.add(v.buffer)
  return [...out]
}
