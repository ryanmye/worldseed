// language: the stats harness (language-drift.md §8). Per seed (2000-year runs with HistoryOptions.language) it reports the
// tree, core cognates against separation (the glottochronology fit), name-form similarity against separation, erosion,
// shifts, loans, mergers and cost, with the plan's targets; then the pooled fit.
//   node --experimental-strip-types --no-warnings src/sim/names/languageStats.ts [years] [seeds...]   (default 2000; 1 7 42 1234)
// The fit is ln c = -2 λ t by least squares through the origin over every pair of related languages (same people, both
// begun) at Y in {500, 1000, 1500, 2000}, t = Y - the year their lines parted, c the share of the LANG.core meanings whose
// words in force descend from the same row (loans from anyone else count as not shared; the loan-inflated c counts a loan
// from the sister as shared). Target λ̂ in [0.11, 0.19] per millennium (Swadesh's 0.151 ± 25%, a design default).

import { generateWorld } from '../index.ts'
import { runHistory } from '../history/index.ts'
import { EventType, type History } from '../../contract.ts'
import { LANG } from './languageParams.ts'
import { evolve, isAncestor, lineage, similarity } from './soundChange.ts'
import { spokenNameAt } from './spoken.ts'

const C = LANG.core

/** The lex row in force for meaning m in language n at `year`. */
function wordRow(h: History, n: number, m: number, year: number): number {
  const L = h.languages!
  let end = Infinity
  for (let k = n; k >= 0; k = L.parent[k]) {
    for (let r = L.lexStart[k * C + m + 1] - 1; r >= L.lexStart[k * C + m]; r--) {
      const y = L.lexYear[r]
      if (y <= year && y < end) return r
    }
    end = L.splitYear[k]
  }
  return -1
}

/** The year the lines of a and b parted (both of one people), or -1 when unrelated. */
export function divergence(h: History, a: number, b: number): number {
  const L = h.languages!
  if (a === b) return -1
  const pa = lineage(L, a), pb = lineage(L, b)
  if (pa[0] !== pb[0]) return -1
  let i = 0
  while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++
  const sa = i < pa.length ? L.splitYear[pa[i]] : Infinity
  const sb = i < pb.length ? L.splitYear[pb[i]] : Infinity
  return Math.min(sa, sb)
}

export interface CognatePoint { t: number; c: number; cLoan: number }

/** Shared core of every related pair begun by each Y (see the file comment). */
export function cognatePoints(h: History, ys: readonly number[]): CognatePoint[] {
  const L = h.languages!
  const out: CognatePoint[] = []
  for (const Y of ys) {
    if (Y > h.years) continue
    for (let a = 0; a < L.count; a++) {
      if (L.splitYear[a] > Y) continue
      for (let b = a + 1; b < L.count; b++) {
        if (L.splitYear[b] > Y) continue
        const d = divergence(h, a, b)
        if (d < 0 || d >= Y) continue
        let same = 0, loan = 0
        for (let m = 0; m < C; m++) {
          const ra = wordRow(h, a, m, Y), rb = wordRow(h, b, m, Y)
          if (ra === rb) { same++; loan++ } else if ((ra >= 0 && L.lexDonor[ra] === b) || (rb >= 0 && L.lexDonor[rb] === a)) loan++
        }
        out.push({ t: (Y - d) / 1000, c: same / C, cLoan: loan / C })
      }
    }
  }
  return out
}

/** λ̂ of ln c = -2 λ t through the origin (c floored at 0.01). */
export function fitLambda(points: readonly CognatePoint[], key: 'c' | 'cLoan' = 'c'): number {
  let num = 0, den = 0
  for (const p of points) { const y = Math.log(Math.max(0.01, p[key])); num += p.t * y; den += p.t * p.t }
  return den > 0 ? -num / (2 * den) : NaN
}

interface SeedStats {
  seed: number
  nodes: number
  causes: number[]
  medianTowns: number
  singletonShare: number
  depth: number
  pairs: number
  lambda: number
  lambdaLoan: number
  sdAt1000: number
  sim1000: number
  sim2000: number
  simUnrelated: number
  recall1000: number
  falsePos: number
  erosion: number
  letterLoss: number
  shifted: number
  ruled200: number
  shiftShare: number
  died: number
  loanShare: number
  waves: number
  mergers: number
  msOn: number
  parts: Record<string, number>
  points: CognatePoint[]
}

function mean(a: readonly number[]): number { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN }

export function languageStats(seed: number, years: number): SeedStats {
  const w = generateWorld(seed)
  const run = runHistory(w, { years, language: true })
  const h = run.history
  const L = h.languages!
  const S = h.settlements.length
  const Y = years
  // --- tree ---
  const towns = new Int32Array(L.count)
  for (let id = 0; id < S; id++) {
    const st = h.settlements[id]
    if (st.abandonedYear >= 0 && st.abandonedYear <= Y) continue
    const sp = h.speech!
    towns[sp.language[sp.start[id + 1] - 1]]++
  }
  const live = [...towns].filter((x) => x > 0).sort((a, b) => a - b)
  const causes = [0, 0, 0]
  for (let n = 0; n < L.count; n++) causes[L.cause[n]]++
  let depth = 0
  for (let n = 0; n < L.count; n++) depth = Math.max(depth, lineage(L, n).length - 1)
  // --- cognates ---
  const points = cognatePoints(h, [500, 1000, 1500, 2000])
  const lambda = fitLambda(points), lambdaLoan = fitLambda(points, 'cLoan')
  const near = points.filter((p) => p.t >= 0.8 && p.t <= 1.2)
  const sdAt1000 = Math.sqrt(mean(near.map((p) => (p.c - Math.exp(-2 * lambda * p.t)) ** 2)))
  // --- name forms: a town coined in the common line, said in two sister lines at Y ---
  const nf = h.nameForms!
  const sims1000: number[] = [], sims2000: number[] = []
  const recallPool: number[] = []
  for (let a = 0; a < L.count; a++) {
    for (let b = a + 1; b < L.count; b++) {
      const d = divergence(h, a, b)
      if (d < 0) continue
      const t = Y - d
      let k = 0
      for (let id = 0; id < S && k < 20; id++) {
        const coin = nf.language[id]
        if (h.settlements[id].foundedYear >= d || !isAncestor(L, coin, a) || !isAncestor(L, coin, b)) continue
        k++
        const sa = evolve(L, nf.form[id], a, -1, Y, 3), sb = evolve(L, nf.form[id], b, -1, Y, 3)
        const s = similarity(sa, sb)
        if (t >= 800 && t <= 1200) sims1000.push(s)
        if (t >= 1700) sims2000.push(s)
        if (t <= 1000) recallPool.push(s)
      }
    }
  }
  // unrelated: founding forms of towns of different peoples, said at Y
  const unrel: number[] = []
  for (let i = 0; i < 400; i++) {
    const x = (i * 7919) % S, y = (i * 104729 + 13) % S
    if (L.people[nf.language[x]] === L.people[nf.language[y]]) continue
    unrel.push(similarity(spokenNameAt(h, x, Y).toLowerCase(), spokenNameAt(h, y, Y).toLowerCase()))
  }
  // --- erosion: founding names of towns founded before 500, said at Y by their own line ---
  let eroded = 0, old = 0
  const loss: number[] = []
  for (let id = 0; id < S; id++) {
    const st = h.settlements[id]
    if (st.foundedYear >= 500) continue
    old++
    const sp = h.speech!
    const n = sp.language[sp.start[id + 1] - 1]
    const said = evolve(L, nf.form[id], isAncestor(L, nf.language[id], n) ? n : nf.language[id], -1, Y, 3)
    const then = st.name.toLowerCase()
    if (said !== then) eroded++
    loss.push(then.replace(/[^a-z]/g, '').length - said.replace(/[^a-z]/g, '').length)
  }
  // --- shifts against long foreign rule ---
  const sp = h.speech!
  let shifted = 0
  for (let id = 0; id < S; id++) {
    for (let r = sp.start[id] + 1; r < sp.start[id + 1]; r++) {
      if (L.people[sp.language[r]] !== L.people[sp.language[r - 1]]) { shifted++; break }
    }
  }
  let ruled200 = 0
  const need = Math.ceil(200 / h.snapshotInterval)
  const pol = h.polity
  if (pol && pol.length && h.polities) {
    for (let id = 0; id < S; id++) {
      let run = 0
      for (let q = 0; q < h.snapshotCount; q++) {
        const p = pol[q * S + id]
        if (p >= 0 && h.population[q * S + id] > 0 && h.polities[p].people !== h.settlements[id].people) { if (++run >= need) { ruled200++; break } } else run = 0
      }
    }
  }
  // --- loans: visible words in force at Y in the languages spoken then ---
  let vis = 0, loans = 0
  for (let n = 0; n < L.count; n++) {
    if (!towns[n]) continue
    for (let m = 0; m < LANG.visible; m++) { const r = wordRow(h, n, m, Y); if (r < 0) continue; vis++; if (L.lexDonor[r] >= 0) loans++ }
  }
  // --- mergers: living towns of one language with one spoken name ---
  const byName = new Map<string, number>()
  let mergers = 0
  for (let id = 0; id < S; id++) {
    const st = h.settlements[id]
    if (st.abandonedYear >= 0 && st.abandonedYear <= Y) continue
    const key = sp.language[sp.start[id + 1] - 1] + ':' + spokenNameAt(h, id, Y).toLowerCase()
    const c = byName.get(key) ?? 0
    if (c > 0) mergers++
    byName.set(key, c + 1)
  }
  const count = (t: number) => h.events.filter((e) => e.type === t).length
  return {
    seed, nodes: L.count, causes, medianTowns: live[live.length >> 1] ?? 0, singletonShare: live.filter((x) => x === 1).length / Math.max(1, live.length), depth,
    pairs: points.length, lambda, lambdaLoan, sdAt1000,
    sim1000: mean(sims1000), sim2000: mean(sims2000), simUnrelated: mean(unrel),
    recall1000: recallPool.filter((s) => s >= 0.5).length / Math.max(1, recallPool.length), falsePos: unrel.filter((s) => s >= 0.5).length / Math.max(1, unrel.length),
    erosion: eroded / Math.max(1, old), letterLoss: mean(loss),
    shifted, ruled200, shiftShare: shifted / Math.max(1, ruled200), died: count(EventType.LanguageDied),
    loanShare: loans / Math.max(1, vis), waves: count(EventType.LoanWave), mergers, msOn: run.diag.language?.ms ?? NaN, parts: Object.fromEntries(Object.entries(run.diag.language?.parts ?? {}).map(([k, v]) => [k, Math.round(v)])), points,
  }
}

const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
if (argv[1] && /languageStats\.ts$/.test(argv[1])) {
  const nums = argv.slice(2).map(Number)
  const years = nums[0] || 2000
  const seeds = nums.length > 1 ? nums.slice(1) : [1, 7, 42, 1234]
  const all: CognatePoint[] = []
  const r = (x: number, d = 3) => (Number.isFinite(x) ? +x.toFixed(d) : x)
  for (const seed of seeds) {
    const s = languageStats(seed, years)
    all.push(...s.points)
    const { points: _p, ...rest } = s
    console.log(JSON.stringify(Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'number' ? r(v) : v]))))
  }
  const lambda = fitLambda(all), lambdaLoan = fitLambda(all, 'cLoan')
  console.log(JSON.stringify({ pooled: true, seeds, pairs: all.length, lambda: r(lambda), lambdaLoan: r(lambdaLoan), target: [0.11, 0.19], pass: lambda >= 0.11 && lambda <= 0.19 }))
}
