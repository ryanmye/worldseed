// What-if (experience-whatif-director-sagas §1.6 "Consequences", §1.8): what the comparison panel and the whatif saga
// say, ranked from the digest and the two fingerprints (whatif/diff.ts, fingerprint.ts) and the two histories (the
// other one may be a skeleton). DOM-free and CSS-free (no saga or chronicle imports): plain facts with both worlds' ids.
//
// - First differences (the causal window, CAUSAL_YEARS after the divergence): ranked near the order's place first (chord
//   <= NEAR_CHORD), then by the director's static score of the event (story/drama.ts eventScore), then by year.
// - The long divergence (after the causal window the two worlds are other draws of one world: owner decision, told as
//   "differences, not effects"): polities only in one world (peak × ln(1 + lifespan)), matched polities whose peak or
//   end differs a lot, peoples whose population, land or towns differ by more than RHO in log ratio, universal faiths
//   only in one world, a matched realm's state faith, great wars (dead >= 3000) and great epidemics only in one world.
// RHO is the noise floor measured by whatifStats.ts: the 90th percentile of |ln(popB/popA)| per people at 2000 years
// over trivial orders (a fortify of a far town of 500-800 people; 11 fulfilled orders on seeds 42 and 1234, 110
// people-runs: p50 0.136, p90 0.462). A people's difference under it is "about the same" (owner decision).

import type { History, HistoryEvent } from '../../contract.ts'
import type { HistoryFingerprint } from '../../whatif/fingerprint.ts'
import { CAUSAL_YEARS, type WhatIfDigest } from '../../whatif/diff.ts'
import { politiesOf, polityTitle, tierAt, type PolitiesData } from '../politiesData.ts'
import { createDramaCtx, eventScore, type DramaCtx } from '../story/drama.ts'

/** "About the same": |ln(B/A)| below this is within the noise of a trivial order (whatifStats.ts, see the header). */
export const RHO = 0.46
/** A first difference this close to the order's place (chord on the unit sphere) is "near the nudge". */
export const NEAR_CHORD = 0.4
/** Wars named (sagas/wars.ts names a war of this many dead). */
export const GREAT_WAR_DEAD = 3000
/** A matched polity whose peak differs by this much (|ln|) is told. */
export const PEAK_DIFF = 0.5

export type Side = 'A' | 'B'

/** One first difference: an event of one world the other has not. */
export interface FirstDiff { side: Side; event: number; year: number; score: number; near: boolean; cell: number }

export type ConsequenceKind = 'polity' | 'polityDiff' | 'people' | 'faith' | 'stateFaith' | 'war' | 'epidemic'

/** One long-run difference, with both worlds' ids (-1 where a world has none). */
export interface Consequence {
  kind: ConsequenceKind
  /** Which world has it ('A' only here, 'B' only in the other world); both for a difference between matched things. */
  side: Side | 'both'
  /** Ids in A and B (polity, people, faith, war id, or the epidemic's History.epidemics id). */
  a: number
  b: number
  weight: number
  /** The year and the cell to show it at (-1 none). */
  year: number
  cell: number
  /** Numbers for the wording: A's and B's values (population, peak, land...), and the log ratio. */
  va: number
  vb: number
  r: number
  /** For 'people': which measure ('pop', 'land', 'towns'); for 'polityDiff': 'peak' or 'end'. */
  what?: string
}

export interface WhatIfFacts {
  digest: WhatIfDigest
  /** The year compared at (the end of both runs). */
  T: number
  firstA: FirstDiff[]
  firstB: FirstDiff[]
  /** Long-run differences, heaviest first per kind. */
  items: Consequence[]
  /** Peoples within RHO on population at T (the majority, as measured). */
  samePeoples: number[]
  /** The year the similarity falls below one in ten after the causal window ("the worlds part"), -1 never. */
  partTenth: number
}

const chord = (P: Float32Array, a: number, b: number) => (a < 0 || b < 0 ? 9 : Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]))

function rankFirst(h: History, c: DramaCtx, idx: Int32Array, side: Side, nudgeCell: number, P: Float32Array | null): FirstDiff[] {
  const out: FirstDiff[] = []
  for (const i of idx) {
    const e: HistoryEvent | undefined = h.events[i]
    if (!e) continue
    const cell = e.settlement >= 0 && e.settlement < h.settlements.length ? h.settlements[e.settlement].cell : -1
    const near = !!P && nudgeCell >= 0 && cell >= 0 && chord(P, cell, nudgeCell) <= NEAR_CHORD
    out.push({ side, event: i, year: e.year, score: eventScore(c, e), near, cell })
  }
  out.sort((x, y) => Number(y.near) - Number(x.near) || y.score - x.score || x.year - y.year || x.event - y.event)
  return out
}

const lastK = (fp: HistoryFingerprint, T: number) => {
  let k = fp.checkYears.length - 1
  while (k > 0 && fp.checkYears[k] > T) k--
  return k
}
const life = (fp: HistoryFingerprint, p: number, T: number) => Math.max(1, (fp.pEnded[p] >= 0 && fp.pEnded[p] <= T ? fp.pEnded[p] : T) - fp.pFounded[p])
const endedBy = (fp: HistoryFingerprint, p: number, T: number) => fp.pEnded[p] >= 0 && fp.pEnded[p] <= T
const capCell = (fp: HistoryFingerprint, p: number) => fp.pCapCell[p]
const topN = <T extends { weight: number }>(xs: T[], n: number) => xs.sort((a, b) => b.weight - a.weight).slice(0, n)

/** Everything the comparison tells, at the end of both runs. `nudgeCell`: where the order acted (-1 none). */
export function whatIfFacts(hA: History, hB: History, fpA: HistoryFingerprint, fpB: HistoryFingerprint, d: WhatIfDigest, nudgeCell: number, positions: Float32Array | null): WhatIfFacts {
  const T = d.years
  const facts: WhatIfFacts = { digest: d, T, firstA: [], firstB: [], items: [], samePeoples: [], partTenth: -1 }
  if (d.divergence < 0) return facts
  facts.firstA = rankFirst(hA, createDramaCtx(hA), d.firstA, 'A', nudgeCell, positions)
  facts.firstB = rankFirst(hB, createDramaCtx(hB), d.firstB, 'B', nudgeCell, positions)
  for (let k = Math.floor((d.divergence + CAUSAL_YEARS) / 10); k < d.similarity.length; k++) if (d.similarity[k] < 0.1) { facts.partTenth = k * 10; break }
  const items = facts.items
  // ---- polities only in one world, and matched ones that differ ----
  const PA = fpA.pFounded.length, PB = fpB.pFounded.length
  const matchedA = new Int32Array(PA).fill(-1)
  for (let b = 0; b < PB; b++) if (d.pMatch[b] >= 0) matchedA[d.pMatch[b]] = b
  const only: Consequence[] = []
  const peakOf = (fp: HistoryFingerprint, p: number) => fp.pPeak[p]
  for (let a = 0; a < PA; a++) if (matchedA[a] < 0 && fpA.pFounded[a] <= T) only.push({ kind: 'polity', side: 'A', a, b: -1, weight: peakOf(fpA, a) * Math.log(1 + life(fpA, a, T)), year: fpA.pFounded[a], cell: capCell(fpA, a), va: peakOf(fpA, a), vb: 0, r: 0 })
  const onlyB: Consequence[] = []
  for (let b = 0; b < PB; b++) if (d.pMatch[b] < 0 && fpB.pFounded[b] <= T) onlyB.push({ kind: 'polity', side: 'B', a: -1, b, weight: peakOf(fpB, b) * Math.log(1 + life(fpB, b, T)), year: fpB.pFounded[b], cell: capCell(fpB, b), va: 0, vb: peakOf(fpB, b), r: 0 })
  items.push(...topN(only.filter((x) => x.va >= 1000), 4), ...topN(onlyB.filter((x) => x.vb >= 1000), 4))
  const diffs: Consequence[] = []
  for (let b = 0; b < PB; b++) {
    const a = d.pMatch[b]
    if (a < 0) continue
    const pa = peakOf(fpA, a), pb = peakOf(fpB, b)
    const r = pa > 0 && pb > 0 ? Math.log(pb / pa) : 0
    const ea = endedBy(fpA, a, T), eb = endedBy(fpB, b, T)
    if (ea !== eb) diffs.push({ kind: 'polityDiff', side: 'both', a, b, weight: Math.max(pa, pb) * 2, year: ea ? fpA.pEnded[a] : fpB.pEnded[b], cell: capCell(fpA, a), va: pa, vb: pb, r, what: 'end' })
    else if (Math.abs(r) >= PEAK_DIFF && Math.max(pa, pb) >= 5000) diffs.push({ kind: 'polityDiff', side: 'both', a, b, weight: Math.max(pa, pb) * Math.abs(r), year: Math.max(fpA.pPeakYear[a], fpB.pPeakYear[b]), cell: capCell(fpA, a), va: pa, vb: pb, r, what: 'peak' })
  }
  items.push(...topN(diffs, 4))
  // ---- peoples ----
  const P = Math.min(fpA.peoples, fpB.peoples)
  const ka = lastK(fpA, T), kb = lastK(fpB, T)
  const peopleItems: Consequence[] = []
  for (let p = 0; p < P; p++) {
    const a = fpA.peoplePop[ka * fpA.peoples + p], b = fpB.peoplePop[kb * fpB.peoples + p]
    const r = a > 0 && b > 0 ? Math.log(b / a) : a > 0 || b > 0 ? (b > a ? 9 : -9) : 0
    const founder = hA.peoples[p]?.founder ?? -1
    const cell = founder >= 0 && founder < hA.settlements.length ? hA.settlements[founder].cell : -1
    if (Math.abs(r) >= RHO && Math.max(a, b) >= 1000) peopleItems.push({ kind: 'people', side: 'both', a: p, b: p, weight: Math.abs(r) * Math.max(a, b), year: T, cell, va: a, vb: b, r, what: 'pop' })
    else if (Math.max(a, b) >= 1000) facts.samePeoples.push(p)
    const la = fpA.peopleLand[ka * fpA.peoples + p], lb = fpB.peopleLand[kb * fpB.peoples + p]
    const rl = la > 0 && lb > 0 ? Math.log(lb / la) : 0
    if (Math.abs(rl) >= RHO && Math.max(la, lb) >= 50) peopleItems.push({ kind: 'people', side: 'both', a: p, b: p, weight: Math.abs(rl) * Math.max(la, lb) * 10, year: T, cell, va: la, vb: lb, r: rl, what: 'land' })
  }
  items.push(...topN(peopleItems, 6))
  // ---- faiths: universal ones only in one world; the state faith of matched realms of kingdom rank ----
  const faithItems: Consequence[] = []
  const fUsedA = new Uint8Array(fpA.fFounded.length)
  for (let f = 0; f < fpB.fFounded.length; f++) if (d.fMatch[f] >= 0) fUsedA[d.fMatch[f]] = 1
  for (let f = fpA.peoples; f < fpA.fFounded.length; f++) if (!fUsedA[f] && fpA.fFounded[f] <= T && fpA.fPeak[f] > 0) faithItems.push({ kind: 'faith', side: 'A', a: f, b: -1, weight: fpA.fPeak[f], year: fpA.fFounded[f], cell: fpA.fHolyCell[f], va: fpA.fPeak[f], vb: 0, r: 0 })
  for (let f = fpB.peoples; f < fpB.fFounded.length; f++) if (d.fMatch[f] < 0 && fpB.fFounded[f] <= T && fpB.fPeak[f] > 0) faithItems.push({ kind: 'faith', side: 'B', a: -1, b: f, weight: fpB.fPeak[f], year: fpB.fFounded[f], cell: fpB.fHolyCell[f], va: 0, vb: fpB.fPeak[f], r: 0 })
  items.push(...topN(faithItems, 4))
  const pdA = politiesOf(hA), pdB = politiesOf(hB)
  if (pdA && pdB && hA.stateFaith?.length && hB.stateFaith?.length) {
    const sA = Math.min(hA.snapshotCount - 1, Math.floor(T / hA.snapshotInterval)), sB = Math.min(hB.snapshotCount - 1, Math.floor(T / hB.snapshotInterval))
    const sf: Consequence[] = []
    for (let b = 0; b < PB; b++) {
      const a = d.pMatch[b]
      if (a < 0 || endedBy(fpA, a, T) || endedBy(fpB, b, T)) continue
      if (tierAt(pdA, a, sA) < 1 || tierAt(pdB, b, sB) < 1) continue
      const fa = hA.stateFaith[sA * PA + a] - 1, fb = hB.stateFaith[sB * PB + b] - 1
      if (fa === fb) continue
      // (the same faith under its two worlds' ids is no difference)
      if (fb >= 0 && fa >= 0 && d.fMatch[fb] === fa) continue
      sf.push({ kind: 'stateFaith', side: 'both', a, b, weight: Math.max(fpA.pPeak[a], fpB.pPeak[b]), year: T, cell: capCell(fpA, a), va: fa, vb: fb, r: 0 })
    }
    items.push(...topN(sf, 3))
  }
  // ---- great wars and great epidemics only in one world ----
  const wUsedA = new Uint8Array(fpA.wStart.length)
  for (let w = 0; w < fpB.wStart.length; w++) if (d.wMatch[w] >= 0) wUsedA[d.wMatch[w]] = 1
  const warA: Consequence[] = [], warB: Consequence[] = []
  const warCell = (fp: HistoryFingerprint, w: number) => (fp.wD[w] >= 0 && fp.wD[w] < fp.pCapCell.length ? fp.pCapCell[fp.wD[w]] : -1)
  for (let w = 0; w < fpA.wStart.length; w++) if (!wUsedA[w] && fpA.wStart[w] >= d.divergence && fpA.wStart[w] <= T && fpA.wDead[w] >= GREAT_WAR_DEAD) warA.push({ kind: 'war', side: 'A', a: w, b: -1, weight: fpA.wDead[w], year: fpA.wStart[w], cell: warCell(fpA, w), va: fpA.wDead[w], vb: 0, r: 0 })
  for (let w = 0; w < fpB.wStart.length; w++) if (d.wMatch[w] < 0 && fpB.wStart[w] >= d.divergence && fpB.wStart[w] <= T && fpB.wDead[w] >= GREAT_WAR_DEAD) warB.push({ kind: 'war', side: 'B', a: -1, b: w, weight: fpB.wDead[w], year: fpB.wStart[w], cell: warCell(fpB, w), va: 0, vb: fpB.wDead[w], r: 0 })
  items.push(...topN(warA, 3), ...topN(warB, 3))
  const gUsedA = new Uint8Array(fpA.gYear.length)
  for (let g = 0; g < fpB.gYear.length; g++) if (d.gMatch[g] >= 0) gUsedA[d.gMatch[g]] = 1
  for (let g = 0; g < fpA.gYear.length; g++) if (!gUsedA[g] && fpA.gYear[g] >= d.divergence) items.push({ kind: 'epidemic', side: 'A', a: fpA.gId[g], b: -1, weight: fpA.gShare[g], year: fpA.gYear[g], cell: fpA.gCell[g], va: fpA.gShare[g], vb: 0, r: 0 })
  for (let g = 0; g < fpB.gYear.length; g++) if (d.gMatch[g] < 0 && fpB.gYear[g] >= d.divergence) items.push({ kind: 'epidemic', side: 'B', a: -1, b: fpB.gId[g], weight: fpB.gShare[g], year: fpB.gYear[g], cell: fpB.gCell[g], va: 0, vb: fpB.gShare[g], r: 0 })
  return facts
}

/** A polity's title at its height in history `h` ("Kingdom of Vashtar"). */
export function peakTitle(pd: PolitiesData | null, fp: HistoryFingerprint, p: number): string {
  if (!pd || p < 0 || p >= pd.count) return 'a forgotten realm'
  const y = fp.pPeakYear[p] >= 0 ? fp.pPeakYear[p] : fp.pFounded[p]
  return polityTitle(pd, p, Math.max(0, Math.min(pd.snapshotCount - 1, Math.floor(y / pd.interval))))
}

/** The top-n events by drama score of `h` from year `from` on (for the timeline's ticks): History.events indices. */
export function topEvents(h: History, from: number, to: number, n: number): { event: number; year: number; score: number }[] {
  const c = createDramaCtx(h)
  const out: { event: number; year: number; score: number }[] = []
  const E = h.events
  let lo = 0, hi = E.length
  while (lo < hi) { const m = (lo + hi) >>> 1; if (E[m].year < from) lo = m + 1; else hi = m }
  for (let i = lo; i < E.length && E[i].year <= to; i++) {
    const t = E[i].type as number
    if (t >= 170 && t <= 180) continue
    const s = eventScore(c, E[i])
    if (s <= 0) continue
    if (out.length < n || s > out[out.length - 1].score) {
      out.push({ event: i, year: E[i].year, score: s })
      out.sort((a, b) => b.score - a.score || a.event - b.event)
      if (out.length > n) out.pop()
    }
  }
  return out.sort((a, b) => a.year - b.year)
}
