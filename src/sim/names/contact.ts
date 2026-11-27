// language: contact between languages (language-drift.md §4.5, §4.6), at assembly, from the population and polity snapshots;
// before any name is coined, so that names coined later use the loans, and renamings the tongue a town shifted to.
//
// The tongue of a realm is the language its capital speaks (by the tree's rows: splits, not shifts).
//   - Language shift: a town held without a break by a realm whose tongue is another people's becomes a candidate after
//     LANG.shiftMin years; then at each snapshot it takes up the rulers' tongue with chance shiftRate x share², share being the
//     population of the ruling people's own towns in the realm over the realm's (x shiftRenamed if the realm renamed it Adapted,
//     for a ruler or a house; x shiftCapital for the capital). One draw per eligible snapshot from 'lang-shift-<v>'.
//   - Loans: in each LANG.bin-year bin, a language's exposure to a donor is the share of its speakers (by population at the
//     bin's first snapshot) living in realms whose tongue is the donor's (another people's). Each meaning of each language
//     takes loans from the bin's main donor as a time-changed Poisson process at loanRate x exposure per millennium
//     (x coreLoanMul past the visible words), from 'lang-loan-<n>-<m>': the donor's word as said then, borrowed into the
//     recipient people's sound pattern (placeNames.ts borrowWord).
//   - LoanWave: at least waveLoans visible loans from one donor within waveYears (once per pair per waveGap years).
// Faith (liturgical) loans are not modelled (the plan's faithLoanMul; religion is assembled after the names).

import { EventType, RenameForm, TOWN_POPULATION } from '../../contract.ts'
import type { HistoryEvent } from '../../contract.ts'
import { createRng } from '../rng.ts'
import type { Rng } from '../rng.ts'
import type { Drift } from './drift.ts'
import { LANG } from './languageParams.ts'
import { nodeAt } from './languageTree.ts'
import { borrowWord } from './placeNames.ts'
import { logD } from '../detMath.ts'

export interface ContactInput {
  /** Settlements in the table (the snapshots' row width). */
  S: number
  people: ArrayLike<number>
  parent: ArrayLike<number>
  foundedYear: ArrayLike<number>
  snapshotInterval: number
  snapshotCount: number
  /** Population per snapshot and settlement (snapshotCount x S). */
  population: Float32Array
  /** Polity per snapshot and settlement, -1 none (snapshotCount x S); null without polities. */
  polity: Int16Array | null
  /** The ruling people of each polity. */
  polityPeople: ArrayLike<number>
  /** The capital of polity p at a year (-1 none). */
  capitalAt(p: number, year: number): number
  /** Renamings decided (the renaming system's decisions; the names are made later): settlement, year, polity and form. */
  renamed: { settlement: number; year: number; polity: number; form: number }[]
}

export interface ContactResult {
  events: HistoryEvent[]
  shifts: number
  loans: number
  visibleLoans: number
}

/** Adds shifts (speech rows) and loans (lexicon rows) to `drift`; returns the events LanguageShift and LoanWave. */
export function applyContact(drift: Drift, inp: ContactInput): ContactResult {
  const { tree } = drift
  const seed = drift.world.seed
  const { S, snapshotInterval: I, snapshotCount: Q, population: pop, polity: pol } = inp
  const res: ContactResult = { events: [], shifts: 0, loans: 0, visibleLoans: 0 }
  if (!pol) return res
  const P = inp.polityPeople.length
  // the tongue of each realm at each snapshot (its capital's language by the tree), and the shares
  const tongue = new Int32Array(Q * P).fill(-1)
  const capital = new Int32Array(Q * P).fill(-1)
  const polPop = new Float64Array(P), ownPop = new Float64Array(P)
  const share = new Float32Array(Q * P)
  for (let q = 0; q < Q; q++) {
    const year = q * I
    polPop.fill(0); ownPop.fill(0)
    for (let v = 0; v < S; v++) {
      const p = pol[q * S + v]
      const x = pop[q * S + v]
      if (p < 0 || p >= P || !(x > 0)) continue
      polPop[p] += x
      if (inp.people[v] === inp.polityPeople[p]) ownPop[p] += x
    }
    for (let p = 0; p < P; p++) {
      if (!(polPop[p] > 0)) continue
      share[q * P + p] = ownPop[p] / polPop[p]
      const c = inp.capitalAt(p, year)
      if (c >= 0 && c < S) { capital[q * P + p] = c; tongue[q * P + p] = nodeAt(tree, c, year) }
    }
  }
  const renamedBy = new Map<number, number[]>() // settlement -> [polity, year, ...] of Adapted/Ruler/House renamings
  for (const r of inp.renamed) {
    if (r.form !== RenameForm.Adapted && r.form !== RenameForm.Ruler && r.form !== RenameForm.House) continue
    let a = renamedBy.get(r.settlement)
    if (!a) renamedBy.set(r.settlement, (a = []))
    a.push(r.polity, r.year)
  }

  // --- Language shift ---
  for (let v = 0; v < S; v++) {
    // a town founded from one that had taken up another tongue begins in that tongue
    const par = inp.parent[v]
    if (par >= 0 && par < v) {
      const ys = tree.rowYear[par]
      let k = 0
      for (let i = 1; i < ys.length; i++) if (ys[i] <= inp.foundedYear[v]) k = i
      if (tree.rowShift[par][k] === 1 && tree.rowNode[par][k] !== tree.foundNode[v]) {
        tree.foundNode[v] = tree.rowNode[par][k]
        tree.rowYear[v] = [inp.foundedYear[v]]
        tree.rowNode[v] = [tree.rowNode[par][k]]
        tree.rowShift[v] = [0]
      }
    }
    let heldBy = -1, since = 0
    let rng: Rng | null = null
    for (let q = 0; q < Q; q++) {
      const year = q * I
      const p = pol[q * S + v]
      if (!(pop[q * S + v] > 0) || p < 0 || p >= P) { heldBy = -1; continue }
      const d = tongue[q * P + p]
      const n = nodeAt(tree, v, year)
      if (d < 0 || tree.people[d] === tree.people[n]) { heldBy = -1; continue }
      if (p !== heldBy) { heldBy = p; since = year }
      if (year - since < LANG.shiftMin) continue
      rng ??= createRng(seed, `lang-shift-${v}`)
      const sh = share[q * P + p]
      let hazard = LANG.shiftRate * sh * sh
      const rb = renamedBy.get(v)
      if (rb) for (let i = 0; i < rb.length; i += 2) if (rb[i] === p && rb[i + 1] <= year) { hazard *= LANG.shiftRenamed; break }
      if (capital[q * P + p] === v) hazard *= LANG.shiftCapital
      if (rng.next() >= hazard) continue
      // (a split of the old tongue's region later on no longer reaches a town that gave it up)
      while (tree.rowYear[v].length > 1 && tree.rowYear[v][tree.rowYear[v].length - 1] > year) { tree.rowYear[v].pop(); tree.rowNode[v].pop(); tree.rowShift[v].pop() }
      tree.rowYear[v].push(year)
      tree.rowNode[v].push(d)
      tree.rowShift[v].push(1)
      res.shifts++
      if (pop[q * S + v] >= TOWN_POPULATION) {
        res.events.push({ year, type: EventType.LanguageShift, settlement: v, other: capital[q * P + p], value: d, extra: n })
      }
      heldBy = -1
    }
  }

  // --- Loans ---
  const N = tree.count
  const C = LANG.core
  const B = Math.floor(drift.years / LANG.bin) + 1
  /** Per bin and language: exposure to its main donor, and the donor. */
  const expo = new Float32Array(B * N)
  const donor = new Int32Array(B * N).fill(-1)
  const speak = new Float64Array(N)
  for (let b = 0; b < B; b++) {
    const year = b * LANG.bin
    const q = Math.min(Q - 1, Math.floor(year / I))
    speak.fill(0)
    const by: Map<number, number>[] = []
    for (let v = 0; v < S; v++) {
      const x = pop[q * S + v]
      if (!(x > 0)) continue
      const n = nodeAt(tree, v, year)
      speak[n] += x
      const p = pol[q * S + v]
      if (p < 0 || p >= P) continue
      const d = tongue[q * P + p]
      if (d < 0 || tree.people[d] === tree.people[n]) continue
      const m = (by[n] ??= new Map<number, number>())
      m.set(d, (m.get(d) ?? 0) + x)
    }
    for (let n = 0; n < N; n++) {
      const m = by[n]
      if (!m || !(speak[n] > 0)) continue
      let best = -1, bx = 0
      for (const [d, x] of m) if (x > bx || (x === bx && d < best)) { best = d; bx = x }
      expo[b * N + n] = bx / speak[n]
      donor[b * N + n] = best
    }
  }
  const waves = new Map<string, { years: number[]; last: number }>()
  const largest = (n: number, year: number): number => {
    const q = Math.min(Q - 1, Math.floor(year / I))
    let best = -1, bx = 0
    for (let v = 0; v < S; v++) { const x = pop[q * S + v]; if (x > bx && nodeAt(tree, v, year) === n) { bx = x; best = v } }
    return best >= 0 ? best : tree.seat[n]
  }
  /** Per (language, meaning): the unit-exponential budget left, and the stream. */
  const budget = new Float64Array(N * C).fill(NaN)
  const streams = new Map<number, Rng>()
  for (let b = 0; b < B; b++) {
    const y0 = b * LANG.bin
    const y1 = Math.min((b + 1) * LANG.bin, drift.years + 1)
    for (let n = 0; n < N; n++) {
      const e = expo[b * N + n]
      const d = donor[b * N + n]
      if (!(e > 0) || d < 0 || tree.splitYear[n] > y0) continue
      for (let m = 0; m < C; m++) {
        const k = n * C + m
        let rng = streams.get(k)
        if (!rng) { rng = createRng(seed, `lang-loan-${n}-${m}`); streams.set(k, rng); budget[k] = -logD(1 - rng.next()) }
        const perYear = LANG.loanRate * e * (m < LANG.visible ? 1 : LANG.coreLoanMul) / 1000
        let t = y0
        while (t < y1) {
          const need = budget[k] / perYear
          if (t + need >= y1) { budget[k] -= (y1 - t) * perYear; break }
          t += need
          budget[k] = -logD(1 - rng.next())
          const year = Math.floor(t)
          const said = drift.wordSaid(d, m, year)
          const form = said.split('|').map((w) => borrowWord(w, drift.base(n), rng)).join('|')
          const list = drift.lex.rows[k]
          let at = list.length
          while (at > 0 && list[at - 1].year > year) at--
          list.splice(at, 0, { year, donor: d, form })
          res.loans++
          if (m >= LANG.visible) continue
          res.visibleLoans++
          const key = n + ':' + d
          let w = waves.get(key)
          if (!w) waves.set(key, (w = { years: [], last: -Infinity }))
          w.years.push(year)
          while (w.years.length && w.years[0] < year - LANG.waveYears) w.years.shift()
          if (w.years.length >= LANG.waveLoans && year - w.last >= LANG.waveGap) {
            w.last = year
            res.events.push({ year, type: EventType.LoanWave, settlement: largest(n, year), other: largest(d, year), value: n, extra: d })
          }
        }
      }
    }
  }
  res.events.sort((a, b) => a.year - b.year || a.type - b.type || a.settlement - b.settlement)
  return res
}
