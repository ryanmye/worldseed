// seat: the player's ambitions (SeatOptions.ambitions; seat-mode §3.8), judged yearly while the seat is held (pure reads).
// AmbitionFulfilled 273 is logged once per ambition. Lane N3: Unify's share is 60% (SEAT.unifyShare), and Monument is judged: a great landmark, or a town's great temple, finished by the realm while the
// seat is held (the landmarks' state, SeatState.lm).
// Lane N3b (throne balance r2): the bots found a landmass share barely moves with play (seed 61343's realm peaks at 0.52 under
// every persona; seed 7's from 700 starts at 0.64 Dramatic, met by all, even the one that never decides): Unify is now won by the
// sword: SEAT.unifyTaken towns taken in the realm's wars since the seat was taken (SeatState.townsTaken), and the realm's share of its
// landmass (vassals count) kept at least min(unifyShare, its share at the seat's year) - unifyKeep, unifyYears running. Monument is
// a great work raised in the seat's time: a great landmark begun and finished by the realm while the seat is held, not the
// castle or palace every old capital raises (a town's temple, met by every realm, no longer counts).
import { AmbitionKind, EventType, FaithKind, LandmarkKind, LandmarkRank } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { SeatState } from './state.ts'
import { SEAT } from './params.ts'
import { houseOf } from './system.ts'
import { overlordOf } from '../polity/bonds.ts'

/** Ambitions of the year (after the seat is resolved; the seat is held). */
export function seatAmbitions(s: HistoryState, st: SeatState): void {
  const amb = st.opts.ambitions
  if (!amb || amb.length === 0) return
  const ps = s.pol
  const p = st.polity
  const cap = ps !== null && p >= 0 ? ps.pCapital[p] : -1
  // (lane N3b: towns the realm took in war this year: Conquered events whose town is now the realm's)
  if (ps !== null && p >= 0) for (let e = st.ambSeen; e < s.events.length; e++) { const x = s.events[e]; if (x.type === EventType.Conquered && x.settlement >= 0 && x.settlement < ps.polity.length && ps.polity[x.settlement] === p && s.year > st.opts.from) st.townsTaken++ }
  st.ambSeen = s.events.length
  for (let i = 0; i < amb.length; i++) {
    if (st.ambitionYear[i] >= 0) continue
    let ok = false
    switch (amb[i]) {
      case AmbitionKind.Endure: ok = s.year - st.opts.from >= SEAT.endureYears; break
      case AmbitionKind.Unify: {
        if (ps === null || cap < 0) break
        const L = s.terrain.landmass[s.cell[cap]]
        let all = 0, ours = 0, towns = 0
        for (const id of s.living) {
          if (s.outpost[id] || s.terrain.landmass[s.cell[id]] !== L) continue
          all += s.pop[id]
          const q = id < ps.polity.length ? ps.polity[id] : -1
          if (q === p) { ours += s.pop[id]; towns++ }
          else if (q >= 0 && overlordOf(ps, q) === p) ours += s.pop[id] // (lane N3: a vassal's or tributary's land is unified under us too)
        }
        const share = all > 0 ? ours / all : 0
        if (st.share0 < 0) st.share0 = share
        const keep = (st.share0 < SEAT.unifyShare ? st.share0 : SEAT.unifyShare) - SEAT.unifyKeep
        const now = towns >= SEAT.unifyTowns && st.townsTaken >= SEAT.unifyTaken && share >= keep
        st.ambitionRun[i] = now ? st.ambitionRun[i] + 1 : 0
        ok = st.ambitionRun[i] >= SEAT.unifyYears
        break
      }
      case AmbitionKind.Faith: {
        const rel = s.rel
        if (rel === null || ps === null || p < 0) break
        for (let f = 0; f < rel.kind.length && !ok; f++) {
          if (rel.kind[f] !== FaithKind.Universal) continue
          const at = rel.holy[f] >= 0 ? rel.holy[f] : rel.foundAt[f]
          if (at >= 0 && at < ps.polity.length && ps.polity[at] === p && (rel.foundYear[f] === s.year || (p < rel.pcap && rel.state[p] === f))) ok = true
        }
        break
      }
      case AmbitionKind.Riches: {
        if (ps === null || p < 0) break
        const sum = new Float64Array(ps.pcap)
        for (const id of s.living) { const q = id < ps.polity.length ? ps.polity[id] : -1; if (q >= 0) sum[q] += s.wealth[id] }
        let top = true
        for (const q of ps.alive) if (q !== p && sum[q] > sum[p]) { top = false; break }
        st.ambitionRun[i] = top ? st.ambitionRun[i] + 1 : 0
        ok = st.ambitionRun[i] >= SEAT.richesYears
        break
      }
      case AmbitionKind.Monument: {
        // lane N3b: a great landmark begun after the seat was taken and finished this year by the realm, not a castle or palace
        // (the capital's guarantee); a town's temple (lesser) no longer counts: every realm finished one
        const lm = st.lm
        if (ps === null || p < 0 || !lm) break
        for (let j = 0; j < lm.lDone.length && !ok; j++) {
          if (lm.lDone[j] !== s.year || lm.lPol[j] !== p || lm.lRank[j] !== LandmarkRank.Great || lm.lBegun[j] <= st.opts.from) continue
          if (lm.lKind[j] !== LandmarkKind.Castle && lm.lKind[j] !== LandmarkKind.Palace) ok = true
        }
        break
      }
      case AmbitionKind.Union: {
        if (ps === null || st.house < 0) break
        let n = 0
        for (const q of ps.alive) if (houseOf(s, q) === st.house) n++
        ok = n >= 2
        break
      }
    }
    if (ok) {
      st.ambitionYear[i] = s.year
      s.events.push({ year: s.year, type: EventType.AmbitionFulfilled, settlement: cap, other: -1, value: amb[i], extra: s.year - st.opts.from })
    }
  }
}
