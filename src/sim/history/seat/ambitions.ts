// seat: the player's ambitions (SeatOptions.ambitions; seat-mode §3.8), judged yearly while the seat is held (pure reads).
// AmbitionFulfilled 273 is logged once per ambition. Lane N3: Unify's share is 60% (SEAT.unifyShare), and Monument is judged: a great landmark finished at a town of the realm while the seat is
// held (LandmarkCompleted 141).
import { AmbitionKind, EventType, FaithKind } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import type { SeatState } from './state.ts'
import { SEAT } from './params.ts'
import { houseOf } from './system.ts'

/** Ambitions of the year (after the seat is resolved; the seat is held). */
export function seatAmbitions(s: HistoryState, st: SeatState): void {
  const amb = st.opts.ambitions
  if (!amb || amb.length === 0) return
  const ps = s.pol
  const p = st.polity
  const cap = ps !== null && p >= 0 ? ps.pCapital[p] : -1
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
          if (id < ps.polity.length && ps.polity[id] === p) { ours += s.pop[id]; towns++ }
        }
        const now = towns >= SEAT.unifyTowns && ours >= SEAT.unifyShare * all
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
        if (ps === null || p < 0) break
        for (let e = s.events.length - 1; e >= 0 && s.events[e].year === s.year && !ok; e--) {
          const x = s.events[e]
          if (x.type === EventType.LandmarkCompleted && x.settlement >= 0 && x.settlement < ps.polity.length && ps.polity[x.settlement] === p) ok = true
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
