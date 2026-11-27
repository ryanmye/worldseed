// families: merchant families (merchant-families.md §5 steps 1-9, 14). One long run per case is shared by the tests of a describe.
import { beforeAll, describe, expect, it } from 'vitest'
import { generateWorld } from '../../index.ts'
import { simulateHistory } from '../index.ts'
import { EventType, FamilyEnd, FamilySeatClose, FamilySeatKind, HeadHow, LenderKind, WarKind } from '../../../contract.ts'
import type { History } from '../../../contract.ts'
import { hashBase } from '../../../hashBase.ts'
import { offDiff } from './familiesStats.ts'
import { createFamilies } from './state.ts'
import type { FamilyState } from './state.ts'
import { FAMILY } from './params.ts'
import { familiesAt, familyAbsorbDefault, familyCapitalAt, familyInfluence, familyLend, familyLendCapacity, familyOwed, familyRepaid, lendersFor, topFamilies, topFamilyAt } from './api.ts'
import type { HistoryState } from '../state.ts'

const YEARS = 1500

describe('families: shapes when off', () => {
  it('empty with families off (the default) and with goods off', () => {
    const w = generateWorld(3)
    const a = simulateHistory(w, { years: 300 })
    expect(a.families.count).toBe(0)
    expect(a.families.famSnapOffsets.length).toBe(1)
    const b = simulateHistory(w, { years: 300, goods: false, families: true })
    expect(b.families.count).toBe(0)
    expect(a.events.some((e) => e.type >= EventType.FamilyFounded && e.type <= EventType.FamilyFell)).toBe(false)
  })
})

describe('families: seed 42 (on, off, shorter)', () => {
  let h: History, off: History, short: History
  beforeAll(() => {
    const w = generateWorld(42)
    h = simulateHistory(w, { years: YEARS, families: true })
    off = simulateHistory(w, { years: YEARS })
    short = simulateHistory(w, { years: 1150, families: true })
  }, 900000)

  it('a pure layer: every other field (and the other events) the same on or off; hashBase unchanged', () => {
    expect(offDiff(h, off)).toEqual([])
    const noFam = { ...h, events: h.events.filter((e) => e.type < EventType.FamilyFounded || e.type > EventType.FamilyFell) }
    expect(hashBase(noFam)).toBe(hashBase(off))
  })

  it('families exist, with snapshots sparse, ascending and within the merchant capital (sum at a town <= kappa * mw)', () => {
    const F = h.families
    expect(F.count).toBeGreaterThan(5)
    const S = h.settlements.length
    for (let q = 0; q < h.snapshotCount; q++) {
      for (let i = F.famSnapOffsets[q] + 1; i < F.famSnapOffsets[q + 1]; i++) expect(F.famSnapFamily[i]).toBeGreaterThan(F.famSnapFamily[i - 1])
      const at = new Map<number, number>()
      for (let i = F.seatSnapOffsets[q]; i < F.seatSnapOffsets[q + 1]; i++) {
        if (i > F.seatSnapOffsets[q]) expect(F.seatSnapSeat[i]).toBeGreaterThan(F.seatSnapSeat[i - 1])
        const k = F.seatSnapSeat[i]
        expect(F.seatSnapCapital[i]).toBeGreaterThanOrEqual(0)
        at.set(F.seatTown[k], (at.get(F.seatTown[k]) ?? 0) + F.seatSnapCapital[i])
      }
      for (const [t, c] of at) expect(c).toBeLessThanOrEqual(FAMILY.kappa * h.merchantWealth[q * S + t] * (1 + 1e-5) + 1e-3)
    }
  })

  it('prefix-stable: a shorter run repeats the longer one up to its end', () => {
    const A = short.families, B = h.families
    expect(B.count).toBeGreaterThanOrEqual(A.count)
    for (let f = 0; f < A.count; f++) {
      expect(B.name[f]).toBe(A.name[f])
      expect(B.founded[f]).toBe(A.founded[f])
      expect(B.firstHome[f]).toBe(A.firstHome[f])
      if (A.ended[f] >= 0) { expect(B.ended[f]).toBe(A.ended[f]); expect(B.end[f]).toBe(A.end[f]); expect(B.ruin[f]).toBe(A.ruin[f]) }
    }
    for (let k = 0; k < A.seatCount; k++) { expect(B.seatFamily[k]).toBe(A.seatFamily[k]); expect(B.seatTown[k]).toBe(A.seatTown[k]); expect(B.seatFrom[k]).toBe(A.seatFrom[k]) }
    for (let k = 0; k < A.headCount; k++) { expect(B.headName[k]).toBe(A.headName[k]); expect(B.headBorn[k]).toBe(A.headBorn[k]) }
    for (let i = 0; i < A.famSnapOffsets[short.snapshotCount]; i++) { expect(B.famSnapFamily[i]).toBe(A.famSnapFamily[i]); expect(B.famSnapCapital[i]).toBe(A.famSnapCapital[i]) }
  })

  it('names: unique among founding families, never a ruling house name; a cadet keeps its parent surname', () => {
    const F = h.families
    const houses = new Set(h.dynasties.map((d) => d.name.toLowerCase()))
    const seen = new Set<string>()
    for (let f = 0; f < F.count; f++) {
      expect(F.name[f].length).toBeGreaterThanOrEqual(3)
      expect(houses.has(F.name[f].toLowerCase())).toBe(false)
      if (F.parent[f] >= 0) { expect(F.name[f]).toBe(F.name[F.parent[f]]); continue }
      expect(seen.has(F.name[f])).toBe(false)
      seen.add(F.name[f])
    }
  })

  it('heads tile each family life; born before taking over; FamilyHead events agree with the head rows', () => {
    const F = h.families
    const byFam: number[][] = Array.from({ length: F.count }, () => [])
    for (let k = 0; k < F.headCount; k++) byFam[F.headFamily[k]].push(k)
    for (let f = 0; f < F.count; f++) {
      const hs = byFam[f]
      expect(hs.length).toBeGreaterThan(0)
      expect(F.headFrom[hs[0]]).toBe(F.founded[f])
      for (let i = 0; i < hs.length; i++) {
        expect(F.headBorn[hs[i]]).toBeLessThan(F.headFrom[hs[i]])
        if (i > 0) expect(F.headFrom[hs[i]]).toBe(F.headTo[hs[i - 1]])
      }
      const last = hs[hs.length - 1]
      if (F.ended[f] >= 0) expect(F.headTo[last]).toBe(F.ended[f])
      else expect(F.headTo[last]).toBe(-1)
    }
    for (const e of h.events) if (e.type === EventType.FamilyHead) {
      expect(F.headFamily[e.extra!]).toBe(e.value)
      expect(F.headFrom[e.extra!]).toBe(e.year)
      expect(F.how[e.extra!]).not.toBe(HeadHow.Founder)
    }
  })

  it('a cadet split from a living parent', () => {
    const F = h.families
    for (let f = 0; f < F.count; f++) {
      const p = F.parent[f]
      if (p < 0) continue
      expect(F.founded[p]).toBeLessThanOrEqual(F.founded[f])
      expect(F.ended[p] < 0 || F.ended[p] >= F.founded[f]).toBe(true)
    }
  })

  it('exactly one open home per live family at every snapshot year; bankrupt families keep no open seat', () => {
    const F = h.families
    for (let q = 0; q < h.snapshotCount; q += 10) {
      const y = q * h.snapshotInterval
      const homes = new Map<number, number>()
      for (let k = 0; k < F.seatCount; k++) if (F.seatKind[k] === FamilySeatKind.Home && F.seatFrom[k] <= y && (F.seatTo[k] < 0 || F.seatTo[k] > y)) homes.set(F.seatFamily[k], (homes.get(F.seatFamily[k]) ?? 0) + 1)
      for (let f = 0; f < F.count; f++) if (F.founded[f] <= y && (F.ended[f] < 0 || F.ended[f] > y)) expect(homes.get(f)).toBe(1)
    }
    for (let k = 0; k < F.seatCount; k++) {
      const f = F.seatFamily[k]
      if (F.ended[f] >= 0) { expect(F.seatTo[k]).toBeGreaterThanOrEqual(0); expect(F.seatTo[k]).toBeLessThanOrEqual(F.ended[f]) }
      if (F.end[f] === FamilyEnd.Bankrupt && F.seatTo[k] === F.ended[f]) expect([FamilySeatClose.Bankrupt, FamilySeatClose.Withdrawn, FamilySeatClose.Seized, FamilySeatClose.Expelled, FamilySeatClose.Ended, FamilySeatClose.TownLost]).toContain(F.seatClose[k])
    }
  })

  it('end, ruin and the FamilyFell extra agree; ruin only when bankrupt', () => {
    const F = h.families
    const fell = new Map<number, number>()
    for (const e of h.events) if (e.type === EventType.FamilyFell) { expect(fell.has(e.value)).toBe(false); fell.set(e.value, e.extra!); expect(e.year).toBe(F.ended[e.value]) }
    for (let f = 0; f < F.count; f++) {
      if (F.ended[f] < 0) { expect(fell.has(f)).toBe(false); expect(F.end[f]).toBe(FamilyEnd.Alive); continue }
      expect(fell.get(f)).toBe(F.end[f] * 16 + F.ruin[f])
      if (F.end[f] !== FamilyEnd.Bankrupt) expect(F.ruin[f]).toBe(0)
    }
  })

  it('every FamilyMoved for a bypass follows a MerchantsMoved at its old home that year; branches open at their FamilyBranch', () => {
    for (const e of h.events) if (e.type === EventType.FamilyMoved && e.extra === 0) expect(h.events.some((x) => x.type === EventType.MerchantsMoved && x.settlement === e.other && x.year === e.year)).toBe(true)
    const F = h.families
    for (const e of h.events) if (e.type === EventType.FamilyBranch) {
      const k = e.extra!
      expect(F.seatFamily[k]).toBe(e.value)
      expect(F.seatTown[k]).toBe(e.settlement)
      expect(F.seatKind[k]).toBe(FamilySeatKind.Branch)
      expect(F.seatFrom[k]).toBe(e.year)
    }
  })

  it('marriages: the house reigned in that polity at that year; backings reference civil wars', () => {
    const F = h.families
    for (let m = 0; m < F.marriageCount; m++) {
      const r = h.rulers[F.marriageRuler[m]]
      expect(r.polity).toBe(F.marriagePolity[m])
      expect(r.dynasty).toBe(F.marriageDynasty[m])
      expect(r.acceded).toBeLessThanOrEqual(F.marriageYear[m])
      expect(r.ended < 0 || r.ended >= F.marriageYear[m]).toBe(true)
      if (F.marriageEnd[m] >= 0) expect(F.marriageEnd[m]).toBeGreaterThanOrEqual(F.marriageYear[m])
    }
    for (let b = 0; b < F.backCount; b++) {
      expect(h.wars.kind[F.backWar[b]]).toBe(WarKind.CivilWar)
      if (F.backOutcome[b] !== 0) expect(h.wars.endYear[F.backWar[b]]).toBeGreaterThanOrEqual(0)
    }
  })

  it('patrons were seated at the landmark town in its begun year', () => {
    const F = h.families
    for (let r = 0; r < F.patronCount; r++) {
      const f = F.patronFamily[r], l = F.patronLandmark[r]
      const t = h.landmarks.settlement[l]
      expect(F.patronYear[r]).toBe(h.landmarks.begunYear[l])
      let seated = false
      for (let k = 0; k < F.seatCount; k++) if (F.seatFamily[k] === f && F.seatTown[k] === t && F.seatFrom[k] <= F.patronYear[r] && (F.seatTo[k] < 0 || F.seatTo[k] >= F.patronYear[r])) seated = true
      expect(seated).toBe(true)
    }
  })
})

// --- api on a synthetic state (step 14) -----------------------------------------------------------------------------

function synthetic(): { s: HistoryState; F: FamilyState } {
  const F = createFamilies(1, 8, 4)
  const mw = new Float64Array(8)
  mw[2] = 1000; mw[3] = 500
  const ps = { seen: 8, polity: Int32Array.from([0, 0, 0, 0, 1, 1, 1, 1]), P: 2, pCapital: Int32Array.from([2, 4]) }
  const s = { count: 8, abandoned: new Int32Array(8).fill(-1), wealth: new Float64Array(8).fill(100), goods: { ext: { fam: F, merch: { mw } } }, pol: ps } as unknown as HistoryState
  // two families: 0 at town 2 (0.4) with a factor at 3 (0.2); 1 at town 2 (0.3)
  const push = (f: number, town: number, kind: number, sig: number) => {
    const k = F.sFam.length
    F.sFam.push(f); F.sTown.push(town); F.sKind.push(kind); F.sFrom.push(0); F.sTo.push(-1); F.sOpen.push(0); F.sClose.push(0); F.sLeg.push(-1); F.sPost.push(-1); F.sSig.push(sig)
    ;(F.atTown[town] ??= []).push(k)
    F.fSeats[f].push(k)
    if (kind === FamilySeatKind.Home) { F.fHomeSeat[f] = k; F.fHome[f] = town }
  }
  for (let f = 0; f < 2; f++) {
    F.fFounded.push(0); F.fEnded.push(-1); F.fSeats.push([]); F.fLanes.push([]); F.fHomeSeat.push(-1); F.fHome.push(-1); F.fLent.push(0); F.alive.push(f)
  }
  push(0, 2, FamilySeatKind.Home, 0.4)
  push(0, 3, FamilySeatKind.Branch, 0.2)
  push(1, 2, FamilySeatKind.Home, 0.3)
  return { s, F }
}

describe('families: api (synthetic)', () => {
  it('city-states reads: families at a town, their capital, influence and the council', () => {
    const { s } = synthetic()
    const out: number[] = []
    expect(familiesAt(s, 2, out)).toBe(2)
    expect(out).toEqual([0, 2]) // (seat ids by share)
    expect(familyCapitalAt(s, 2)).toBeCloseTo(700)
    expect(familyInfluence(s, 0, 2)).toBeCloseTo(400 / 1101)
    expect(topFamilies(s, 2, 5, out)).toBe(2)
    expect(out).toEqual([0, 1])
    expect(topFamilyAt(s, 3)).toBe(0)
    expect(topFamilyAt(s, 5)).toBe(-1)
  })

  it('lending is off without FAMILY.feedback; with it, capacity, lend, repay and default keep the books', () => {
    const { s, F } = synthetic()
    expect(familyLendCapacity(s, 0, 0)).toBe(0)
    const fb = FAMILY.feedback
    FAMILY.feedback = true
    try {
      const cap = familyLendCapacity(s, 0, 0)
      expect(cap).toBeCloseTo(0.5 * (400 + 100)) // (FIN.lendCap of 400 at town 2 and 100 at town 3)
      const ids = new Int32Array(4)
      expect(lendersFor(s, 0, ids)).toBe(2)
      expect(Array.from(ids.subarray(0, 2))).toEqual([0, 1])
      const mw = (s.goods as unknown as { ext: { merch: { mw: Float64Array } } }).ext.merch.mw
      const lent = familyLend(s, 0, 0, 100)
      expect(lent).toBeCloseTo(100)
      expect(mw[2] + mw[3]).toBeCloseTo(1400)
      expect(familyOwed(s, 0, 0)).toBeCloseTo(100)
      expect(familyLendCapacity(s, 0, 0)).toBeLessThan(cap)
      familyRepaid(s, 0, 30, 0, true)
      expect(familyOwed(s, 0, 0)).toBeCloseTo(70)
      expect(mw[2]).toBeCloseTo(1000 - 80 + 30)
      familyAbsorbDefault(s, 0, 0, 70)
      expect(familyOwed(s, 0, 0)).toBe(0)
      expect(F.pendingRuin).toEqual([0, 2])
      expect(F.lendY[2]).toBeCloseTo(80 - 30)
      void LenderKind
    } finally { FAMILY.feedback = fb }
  })
})
