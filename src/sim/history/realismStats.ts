// realism: headless harness that scores a run against empirical regularities of real history (realism-metrics.md). Run with:
//   node --experimental-strip-types src/sim/history/realismStats.ts [seed ...]       (default 1 7 42 1234; Node 22 needs the flag, 23+ not)
//   ... --boot 100        bootstrap replicates for the power-law goodness-of-fit p (default 0: skip; ~1-5 s per fit at 100)
//   ... --json            one JSON row per seed on stdout instead of the table (for sweeps; aggregate with --from)
//   ... --from rows.jsonl aggregate earlier --json rows (any number of seeds) into the target table
//   ... --opts '{"goods":false}'  HistoryOptions for the run (A/B of a feature against the targets)
//   ... --from a.jsonl --vs b.jsonl   A/B: per-target medians and misses of B against A (the sibling plans' realism guard)
//   ... --check ref.jsonl [--from rows.jsonl] [--tol 0.03] [--allow k1,k2]
//                         the ratchet (MASTER-PLAN §2.7, §4.2): exit 1 if the candidate's score (rows from --from, else fresh
//                         runs on ref's seeds) exceeds ref's by more than --tol (default 0.03), if any target is WORSE (mean
//                         miss up > 0.1 band widths) and not in --allow, or if a ref seed has no row. Scores are recomputed
//                         from the rows under the current TARGETS on both sides, so a band edit never fails it by itself.
//   ... --check ref.jsonl --noise docs/realism-noise.jsonl ...   judge WORSE and the score against the null-perturbation
//                         ensemble of ref (RealismNoise: ref re-run with --opts '{"jitter":{"year":100,"draws":d}}', d = 1..K, rows
//                         tagged `jitter`) instead of ref's single realisation: WORSE = mean miss > null mean + max(0.1, 3 sd).
//   Full sweep (22 seeds, ~15-25 min on 2 cores): bash scripts/realism-sweep.sh out.jsonl 2 0
//
// Ratchet usage:
//   - per PR (guard against current main; features ship default-off, so off = main by the off-identity rule):
//       ... 1 7 42 1234 --json --opts '{"<feature>":false}' > off.jsonl;  ... same with true > on.jsonl
//       ... --check off.jsonl --from on.jsonl [--allow <the plan's accepted trade-offs>]
//   - phase exit (4-seed score <= the recomputed 8cabf09 baseline):  ... --check docs/realism-baseline.jsonl --tol 0
//     (npm run realism:check runs it with the default tol; it runs the 4 sims, minutes on a loaded box)
// Re-baselining docs/realism-baseline.jsonl (rows of the 8cabf09 history, --boot 0, seeds 1 7 42 1234):
//   - a TARGETS band or label edit: no rerun. Update REALISM_BASELINE below to the score the test prints
//     (npx vitest run src/sim/history/realismStats.test.ts) in the same commit, and state old -> new in the PR.
//   - a new or changed measure: rerun on a tree where G0 holds, with every post-8cabf09 option off (default until R29 flips):
//       node --experimental-strip-types --no-warnings src/sim/history/realismStats.ts 1 7 42 1234 --json --opts '<all new
//       options false>' > docs/realism-baseline.jsonl     (or bash scripts/realism-sweep.sh docs/realism-baseline.jsonl 2 0 1 7 42 1234)
//     then update REALISM_BASELINE. The harness reads only 8cabf09 History fields, so those rows equal 8cabf09's.
//   - moving the anchor itself (e.g. tightening it at a phase exit): coordinator decision, recorded in MASTER-PLAN §6.
//   The 22-seed rows of the same history are in docs/realism-sweep22.jsonl (re-record with the sweep script, all 22 seeds).
//   The null ensemble docs/realism-noise.jsonl (--noise) is re-recorded with the baseline: the same runs with --opts
//   '{"jitter":{"year":Y,"draws":d}}' (Y 100: d 1..9; Y 500, 1000: d 1; and {"year":100,"draws":1,"stream":"structures"}), rows tagged
//   `jitter` by the harness; 12 x 4 runs.
// Reports (realism-metrics.md section 3): Zipf rank-size of towns per era (CSN power-law MLE, not OLS on log-log), Gibrat's
// law of town growth, Richardson's law of war severity (CSN) and war durations and onsets, polity lifespans (Arbesman) and
// sizes (Taagepera), the largest state's share of people and land, faith shares, epidemic mortality, urbanisation, and a
// gravity-model fit of route and long-haul volumes (with the circularity caveat: partners are chosen by size / cost^2).

import { CITY_POPULATION, WarKind } from '../../contract.ts'
import type { History, HistoryOptions, World } from '../../contract.ts'
import { generateWorld } from '../index.ts'
import { runHistory } from './index.ts'
import { durations, fitPowerLaw, giZipf, ols, ppml, quant, spearman } from './realismFit.ts'
import type { PowerLawFit } from './realismFit.ts'

const R_KM = 6371
export const REALISM_SEEDS = [1, 7, 42, 1234]
/** The 22-seed sweep (realism-metrics.md section 0): the 4 named seeds and 18 more. scripts/realism-sweep.sh's default. */
export const REALISM_SWEEP_SEEDS = [1, 7, 42, 1234, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 77, 99, 1337, 2024, 31337, 99999, 123456]
export const ZIPF_YEARS = [500, 1000, 1500, 2000]
const GIBRAT_ERAS: [number, number][] = [[500, 1000], [1000, 1500], [1500, 2000]]
const GIBRAT_STEP = 50, GIBRAT_MIN = 1000
const GRAVITY_YEARS = [1000, 1500, 2000]
const CENTURIES = Array.from({ length: 20 }, (_, k) => (k + 1) * 100)

/** Polity tiers by the sim's rule (polity/params.ts POLITY), without the multi-people Empire clause (not recoverable cheaply). */
function tier(pop: number, members: number, W: number): number {
  if (pop >= Math.max(20000, 0.08 * W)) return 2
  if (members >= 6 && pop >= Math.max(2000, 0.008 * W)) return 1
  return 0
}

function kmBetween(P: Float32Array, a: number, b: number): number {
  const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]
  const c = Math.min(2, Math.sqrt(dx * dx + dy * dy + dz * dz))
  return R_KM * 2 * Math.asin(c / 2)
}

type Row = Record<string, number>

function plRow(row: Row, k: string, f: PowerLawFit | null): void {
  row[k + '.alpha'] = f ? f.alpha : NaN
  row[k + '.se'] = f ? f.se : NaN
  row[k + '.xmin'] = f ? f.xmin : NaN
  row[k + '.nTail'] = f ? f.nTail : 0
  row[k + '.n'] = f ? f.n : 0
  row[k + '.p'] = f ? f.p : NaN
  row[k + '.lnR'] = f ? f.lnR : NaN
  row[k + '.lnP'] = f ? f.lnP : NaN
  row[k + '.expR'] = f ? f.expR : NaN
}

/** All the realism measures of one finished history. */
export function realism(h: History, w: World, boot = 0, seed = 0): Row {
  const row: Row = {}
  const S = h.settlements.length, Q = h.snapshotCount, dt = h.snapshotInterval
  const P = w.grid.positions
  const out = h.settlements.map((s) => s.outpost)
  const pop = (q: number, i: number): number => (out[i] ? 0 : h.population[q * S + i])
  const qOf = (y: number): number => Math.min(Q - 1, Math.round(y / dt))
  const W = new Float64Array(Q)
  for (let q = 0; q < Q; q++) { let t = 0; for (let i = 0; i < S; i++) t += pop(q, i); W[q] = t }
  const sizesAt = (y: number): number[] => { const q = qOf(y), a: number[] = []; for (let i = 0; i < S; i++) { const x = pop(q, i); if (x > 0) a.push(x) } return a }

  // 1. Zipf / rank-size per era: zeta = CCDF exponent = alpha - 1. Three estimators: CSN (xmin by KS), Hill at xmin 1000, GI OLS on the top 50.
  for (const y of ZIPF_YEARS) {
    if (y > h.years) continue
    const x = sizesAt(y)
    const f = fitPowerLaw(x, { boot, seed: seed * 31 + y, minTail: 20 })
    plRow(row, `zipf${y}`, f)
    row[`zipf${y}.zeta`] = f ? f.alpha - 1 : NaN
    const f1k = fitPowerLaw(x, { xmin: 1000 })
    row[`zipf${y}.zeta1k`] = f1k ? f1k.alpha - 1 : NaN
    row[`zipf${y}.n1k`] = f1k ? f1k.nTail : 0
    const gi = giZipf(x, 50)
    row[`zipf${y}.zetaGI50`] = gi.zeta
    const s = [...x].sort((a, b) => b - a)
    row[`zipf${y}.primacy`] = s.length > 1 ? s[0] / s[1] : NaN // Zipf predicts 2
  }

  // 2. Gibrat: 50-year log growth of towns >= GIBRAT_MIN people, demeaned per window, regressed on log size. Exits counted apart.
  for (const [y0, y1] of GIBRAT_ERAS) {
    if (y1 > h.years) continue
    const g: number[] = [], ls: number[] = []
    let n = 0, exits = 0
    for (let t = y0; t + GIBRAT_STEP <= y1; t += GIBRAT_STEP) {
      const qa = qOf(t), qb = qOf(t + GIBRAT_STEP)
      const gw: number[] = [], lw: number[] = []
      for (let i = 0; i < S; i++) {
        const a = pop(qa, i)
        if (a < GIBRAT_MIN) continue
        n++
        const b = pop(qb, i)
        if (b <= 0) { exits++; continue }
        gw.push(Math.log(b / a)); lw.push(Math.log(a))
      }
      const m = gw.reduce((s, v) => s + v, 0) / Math.max(1, gw.length)
      for (let k = 0; k < gw.length; k++) { g.push(gw[k] - m); ls.push(lw[k]) }
    }
    const o = ols(g, ls.map((v) => [v]))
    const key = `gibrat${y0}`
    row[key + '.beta'] = o.beta[1]
    row[key + '.betaSe'] = o.se[1]
    row[key + '.rho'] = spearman(ls, g)
    row[key + '.n'] = n
    row[key + '.exit'] = n ? exits / n : NaN
    // Dispersion of growth in size terciles (Gibrat: equal; real: falls somewhat with size).
    const idx = ls.map((_, k) => k).sort((a, b) => ls[a] - ls[b])
    const sd = (ks: number[]): number => { const v = ks.map((k) => g[k]); const m = v.reduce((s, x) => s + x, 0) / Math.max(1, v.length); return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, v.length)) }
    const T = idx.length
    row[key + '.sdSmall'] = sd(idx.slice(0, Math.floor(T / 3)))
    row[key + '.sdLarge'] = sd(idx.slice(Math.floor((2 * T) / 3)))
  }

  // 3. Wars: severity (CSN on deaths), durations (censored exponential), onsets per decade (Poisson dispersion).
  const Wr = h.wars
  const dead: number[] = [], deadConq: number[] = [], deadShare: number[] = [], dur: number[] = [], ended: boolean[] = []
  const onsets = new Map<number, number>()
  let firstWar = Infinity
  for (let k = 0; k < Wr.count; k++) {
    const d = Wr.dead[k]
    if (d > 0) { dead.push(d); if (Wr.kind[k] === WarKind.Conquest) deadConq.push(d); deadShare.push(d / W[qOf(Wr.startYear[k])]) }
    const e = Wr.endYear[k]
    dur.push(Math.max(1, (e >= 0 ? e : h.years) - Wr.startYear[k] + (e >= 0 ? 1 : 0))); ended.push(e >= 0)
    const dec = Math.floor(Wr.startYear[k] / 10)
    onsets.set(dec, (onsets.get(dec) ?? 0) + 1)
    firstWar = Math.min(firstWar, Wr.startYear[k])
  }
  row['war.count'] = Wr.count
  row['war.zeroDead'] = Wr.count - dead.length
  plRow(row, 'war', fitPowerLaw(dead, { boot, seed: seed * 31 + 7, minTail: 15 }))
  plRow(row, 'warConq', fitPowerLaw(deadConq, { boot: 0, minTail: 15 }))
  row['war.maxShare'] = deadShare.length ? Math.max(...deadShare) : NaN
  row['war.medDead'] = quant(dead, 0.5)
  row['war.p90Dead'] = quant(dead, 0.9)
  const dd = durations(dur, ended)
  row['war.durMean'] = dd.meanMle; row['war.durMedian'] = dd.median; row['war.durCv'] = dd.cv; row['war.durKs'] = dd.ksExp
  row['war.durMax'] = Math.max(...dur)
  row['war.deadDurRho'] = spearman(dur.filter((_, k) => Wr.dead[k] > 0), dead)
  if (Number.isFinite(firstWar)) {
    const d0 = Math.floor(firstWar / 10), d1 = Math.floor(h.years / 10)
    const c: number[] = []
    for (let d = d0; d < d1; d++) c.push(onsets.get(d) ?? 0)
    const m = c.reduce((s, v) => s + v, 0) / c.length
    const v = c.reduce((s, x) => s + (x - m) ** 2, 0) / c.length
    row['war.onsetPerDecade'] = m
    row['war.onsetDispersion'] = v / m // Poisson: 1
  }

  // 4. Polities: lifespans (censored exponential), peak tiers, largest share of people and of land, peak areas.
  const NP = h.polities.length
  if (NP > 0) {
    const peakPop = new Float64Array(NP), peakMem = new Int32Array(NP), peakTier = new Int8Array(NP), peakShare = new Float64Array(NP)
    const ppop = new Float64Array(NP), pmem = new Int32Array(NP)
    const largestPopShare = new Map<number, number>()
    let largestPeak = 0, largestPeakYear = -1
    for (let q = 0; q < Q; q++) {
      ppop.fill(0); pmem.fill(0)
      for (let i = 0; i < S; i++) { const p = h.polity[q * S + i]; if (p < 0) continue; ppop[p] += pop(q, i); if (!out[i] && h.population[q * S + i] > 0) pmem[p]++ }
      let mx = 0
      for (let p = 0; p < NP; p++) {
        if (pmem[p] === 0) continue
        if (ppop[p] > peakPop[p]) peakPop[p] = ppop[p]
        if (pmem[p] > peakMem[p]) peakMem[p] = pmem[p]
        const t = tier(ppop[p], pmem[p], W[q])
        if (t > peakTier[p]) peakTier[p] = t
        const sh = ppop[p] / W[q]
        if (sh > peakShare[p]) peakShare[p] = sh
        if (sh > mx) mx = sh
      }
      const y = q * dt
      if (y % 100 === 0) largestPopShare.set(y, mx)
      if (mx > largestPeak) { largestPeak = mx; largestPeakYear = y }
    }
    for (const y of CENTURIES) if (y <= h.years) row[`pol.largestPop${y}`] = largestPopShare.get(y) ?? 0
    // MASTER-PLAN §2.7: the scored shares are at fixed years; the peak over every snapshot (unscored) is the number the
    // Han/Rome/Qing peaks (30-37%) describe. Snapshots before the first state, or with no people, count 0.
    row['pol.largestPopPeak'] = largestPeak
    row['pol.largestPopPeakYear'] = largestPeakYear
    // Land: territory per land snapshot (owner settlement + 1) mapped to its polity at the matching snapshot.
    const L = h.landCells.length
    const peakArea = new Int32Array(NP), peakAreaYear = new Int32Array(NP).fill(-1)
    const area = new Int32Array(NP)
    for (let ql = 0; ql < h.landSnapshotCount; ql++) {
      const y = ql * h.landInterval, q = qOf(y)
      area.fill(0)
      let owned = 0
      for (let k = 0; k < L; k++) { const o = h.territory[ql * L + k] - 1; if (o < 0) continue; owned++; const p = h.polity[q * S + o]; if (p >= 0) area[p]++ }
      let mx = 0
      for (let p = 0; p < NP; p++) { if (area[p] > peakArea[p]) { peakArea[p] = area[p]; peakAreaYear[p] = y } if (area[p] > mx) mx = area[p] }
      if (y % 100 === 0 && y > 0) { row[`pol.largestLand${y}`] = mx / L; row[`pol.largestOwned${y}`] = owned ? mx / owned : 0 }
    }
    const life = (keep: (p: number) => boolean, k: string): void => {
      const d: number[] = [], e: boolean[] = []
      for (let p = 0; p < NP; p++) {
        if (!keep(p)) continue
        const pl = h.polities[p]
        d.push(Math.max(1, (pl.endedYear >= 0 ? pl.endedYear : h.years) - pl.foundedYear)); e.push(pl.endedYear >= 0)
      }
      const r = durations(d, e)
      row[k + '.n'] = r.n; row[k + '.ended'] = r.ended; row[k + '.mean'] = r.meanMle; row[k + '.median'] = r.median; row[k + '.cv'] = r.cv; row[k + '.ks'] = r.ksExp
    }
    life((p) => peakMem[p] >= 2, 'life2')
    life((p) => peakTier[p] >= 1, 'lifeK')
    life((p) => peakTier[p] >= 2, 'lifeE')
    // Taagepera: rise time (founding to peak area) as a share of lifetime, for ended Kingdom+ states.
    const rise: number[] = []
    for (let p = 0; p < NP; p++) {
      const pl = h.polities[p]
      if (peakTier[p] < 1 || pl.endedYear < 0 || peakAreaYear[p] < 0) continue
      const life = pl.endedYear - pl.foundedYear
      if (life >= 40) rise.push((peakAreaYear[p] - pl.foundedYear) / life)
    }
    row['pol.riseFracMed'] = quant(rise, 0.5)
    row['pol.riseN'] = rise.length
    row['pol.empires'] = Array.from(peakTier).filter((t) => t >= 2).length
    row['pol.kingdoms'] = Array.from(peakTier).filter((t) => t >= 1).length
    // Peak-area share distribution of Kingdom+ states (Taagepera's empire sizes): median and max share of world land.
    const pa: number[] = []
    for (let p = 0; p < NP; p++) if (peakTier[p] >= 1) pa.push(peakArea[p] / L)
    row['pol.peakLandMed'] = quant(pa, 0.5)
    row['pol.peakLandMax'] = pa.length ? Math.max(...pa) : NaN
    // Rank-size of polity populations at 1500 and 2000 (exploratory).
    for (const y of [1500, 2000]) {
      if (y > h.years) continue
      const q = qOf(y)
      ppop.fill(0)
      for (let i = 0; i < S; i++) { const p = h.polity[q * S + i]; if (p >= 0) ppop[p] += pop(q, i) }
      const f = fitPowerLaw(Array.from(ppop).filter((v) => v > 0), { minTail: 10 })
      row[`pol.zeta${y}`] = f ? f.alpha - 1 : NaN
      row[`pol.zetaN${y}`] = f ? f.nTail : 0
    }
  }

  // 5. Faiths: followers = majority faith x its share (minorities are not recorded: a lower bound per faith).
  if (h.faiths.length > 0) {
    for (const y of [500, 1000, 1500, 2000]) {
      if (y > h.years) continue
      const q = qOf(y)
      const f = new Float64Array(h.faiths.length)
      for (let i = 0; i < S; i++) { const x = pop(q, i); if (x <= 0) continue; const k = h.faith[q * S + i]; if (k === 255) continue; f[k] += x * (h.faithShare[q * S + i] / 255) }
      const sh = Array.from(f).map((v) => v / W[q]).sort((a, b) => b - a)
      row[`faith${y}.top1`] = sh[0] ?? 0
      row[`faith${y}.top4`] = sh.slice(0, 4).reduce((s, v) => s + v, 0)
      row[`faith${y}.n5`] = sh.filter((v) => v >= 0.05).length
      row[`faith${y}.hhi`] = sh.reduce((s, v) => s + v * v, 0)
      let uni = 0
      for (let k = 0; k < h.faiths.length; k++) if (h.faiths[k].kind === 1) uni += f[k]
      row[`faith${y}.universal`] = uni / W[q]
    }
  }

  // 6. Epidemics: deaths / network per epidemic, the worst against the world, plague outbreak mortality.
  if (h.epidemics.length > 0) {
    const m = h.epidemics.map((e) => (e.network > 0 ? e.deaths / e.network : 0))
    const mw = h.epidemics.map((e) => e.deaths / W[qOf(e.startYear)])
    row['epi.count'] = h.epidemics.length
    row['epi.great'] = h.epidemics.filter((e) => e.great).length
    row['epi.worstNet'] = Math.max(...m)
    row['epi.worstWorld'] = Math.max(...mw)
    row['epi.medNet'] = quant(m, 0.5)
    row['epi.n10'] = m.filter((v) => v >= 0.1).length
    row['epi.n25'] = m.filter((v) => v >= 0.25).length
    const plague = h.epidemics.filter((e) => h.diseases[e.disease].archetype === 'plague').map((e) => (e.network > 0 ? e.deaths / e.network : 0))
    row['epi.plagueWorstNet'] = plague.length ? Math.max(...plague) : NaN
    const ob = h.outbreaks, pm: number[] = [], am: number[] = []
    for (let k = 0; k < ob.count; k++) { const v = ob.mortality[k] / 255; am.push(v); if (h.diseases[ob.disease[k]].archetype === 'plague') pm.push(v) }
    row['epi.obP50'] = quant(am, 0.5); row['epi.obP90'] = quant(am, 0.9)
    row['epi.plagueObP50'] = quant(pm, 0.5); row['epi.plagueObP90'] = quant(pm, 0.9); row['epi.plagueObMax'] = pm.length ? Math.max(...pm) : NaN
  }
  // Worst 50-year fall of world population from its running peak (any cause).
  let peak = 0, fall = 0
  for (let q = 0; q < Q; q++) {
    if (W[q] > peak) peak = W[q]
    const qb = Math.min(Q - 1, q + Math.round(50 / dt))
    if (W[q] > 0) fall = Math.max(fall, 1 - W[qb] / W[q])
  }
  row['pop.worst50yFall'] = fall

  // 7. Urbanisation: share in places of >= 10,000 and >= 5,000; world people; the largest place.
  for (const y of CENTURIES) {
    if (y > h.years) continue
    const x = sizesAt(y)
    let u10 = 0, u5 = 0, mx = 0
    for (const v of x) { if (v >= CITY_POPULATION) u10 += v; if (v >= 5000) u5 += v; if (v > mx) mx = v }
    const Wy = W[qOf(y)]
    row[`urb${y}.u10`] = u10 / Wy; row[`urb${y}.u5`] = u5 / Wy; row[`urb${y}.world`] = Wy; row[`urb${y}.largest`] = mx
  }

  // 8. Gravity: ln V on ln Pa + ln Pb (joint mass elasticity) and ln distance (great-circle km), OLS and PPML,
  //    on open routes (partners picked by size / cost^2: circular on the extensive margin) and on long-haul legs.
  const grav = (key: string, y: number, A: ArrayLike<number>, B: ArrayLike<number>, V: (k: number) => number, count: number): void => {
    const q = qOf(y)
    const Y: number[] = [], X: number[][] = [], Xs: number[][] = []
    for (let k = 0; k < count; k++) {
      const v = V(k)
      if (!(v > 0)) continue
      const a = A[k], b = B[k], pa = h.population[q * S + a], pb = h.population[q * S + b]
      if (!(pa > 0 && pb > 0)) continue
      const d = Math.max(1, kmBetween(P, h.settlements[a].cell, h.settlements[b].cell))
      Y.push(v); X.push([Math.log(pa * pb), Math.log(d)]); Xs.push([Math.log(Math.min(pa, pb)), Math.log(Math.max(pa, pb)), Math.log(d)])
    }
    row[`${key}${y}.n`] = Y.length
    if (Y.length < 20) return
    const o = ols(Y.map(Math.log), X)
    row[`${key}${y}.olsMass`] = o.beta[1]; row[`${key}${y}.olsDist`] = o.beta[2]; row[`${key}${y}.olsR2`] = o.r2
    const p = ppml(Y, X)
    row[`${key}${y}.ppmlMass`] = p[1]; row[`${key}${y}.ppmlDist`] = p[2]
    const os = ols(Y.map(Math.log), Xs)
    row[`${key}${y}.olsSmall`] = os.beta[1]; row[`${key}${y}.olsBig`] = os.beta[2]
  }
  const T = h.trade
  for (const y of GRAVITY_YEARS) {
    if (y > h.years) continue
    const qt = Math.min(h.tradeSnapshotCount - 1, Math.round(y / h.tradeInterval))
    grav('grav', y, T.a, T.b, (k) => h.tradeVolume[qt * T.count + k], T.count)
    const LH = h.longHaul
    if (LH && LH.count > 0) grav('gravLH', y, LH.a, LH.b, (k) => h.longHaulVolume[qt * LH.count + k], LH.count)
  }
  return row
}

// ---------------------------------------------------------------------------
// Targets: [key, low, high, source tag]. A verdict is ok inside [low, high], else off. See realism-metrics.md section 2 for the citations.

export const TARGETS: [string, number, number, string][] = [
  ['zipf1000.zeta', 0.8, 1.25, 'Zipf/Gabaix99, Soo05'],
  ['zipf1500.zeta', 0.8, 1.25, 'Zipf/Gabaix99, Soo05'],
  ['zipf2000.zeta', 0.8, 1.25, 'Zipf/Gabaix99, Soo05'],
  ['zipf2000.zeta1k', 0.8, 1.25, 'Zipf (xmin 1000)'],
  ['zipf2000.primacy', 1.3, 4, 'Zipf: 2 (Jefferson primacy wider)'],
  ['gibrat1000.beta', -0.06, 0.03, 'Gibrat (Eeckhout04)'],
  ['gibrat1500.beta', -0.06, 0.03, 'Gibrat (Eeckhout04)'],
  ['war.alpha', 1.3, 1.9, 'Clauset18 1.53+-0.07; Cederman03'],
  ['war.durCv', 0.7, 1.4, 'Richardson: ~exponential'],
  ['war.onsetDispersion', 0.6, 1.6, 'Richardson: Poisson onsets'],
  ['war.maxShare', 0.005, 0.05, 'WWII ~3% of world'],
  ['lifeE.mean', 130, 350, 'Arbesman11 ~220y'],
  ['lifeK.mean', 100, 350, 'Arbesman11 (loose)'],
  ['lifeE.cv', 0.6, 1.4, 'Arbesman11 exponential'],
  ['pol.largestPop1500', 0.15, 0.4, 'Han/Rome/Qing peaks 30-37%'],
  ['pol.largestPop2000', 0.15, 0.4, 'Han/Rome/Qing peaks 30-37%'],
  ['pol.largestLand2000', 0.08, 0.25, 'Taagepera: Mongol 16%, British 24%'],
  ['faith2000.top1', 0.2, 0.4, 'Pew 2012: 31.5%'],
  ['faith2000.top4', 0.55, 0.9, 'Pew 2012: ~77%'],
  ['epi.worstNet', 0.25, 0.6, 'Black Death 30-60%'],
  ['epi.plagueWorstNet', 0.25, 0.6, 'Black Death 30-60%'],
  ['pop.worst50yFall', 0.08, 0.35, 'C14 Eurasia ~15-25% (approx)'],
  ['urb1500.u10', 0.03, 0.12, 'de Vries84: Europe 5.6%'],
  ['urb2000.u10', 0.05, 0.15, 'de Vries84: Europe 1800 10%'],
  ['grav2000.ppmlDist', -1.3, -0.6, 'Disdier-Head08 ~-0.9'],
  ['gravLH2000.ppmlDist', -1.3, -0.4, 'Disdier-Head08 (pre-modern looser)'],
]

function fmt(x: number): string { return x === undefined || !Number.isFinite(x) ? '-' : Math.abs(x) >= 10000 ? (x / 1000).toFixed(0) + 'k' : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(3) }

export function formatTable(rows: Row[]): string {
  const L: string[] = []
  const seeds = rows.map((r) => r.seed)
  const sc = realismScore(rows)
  const many = rows.length > 6
  L.push(`measure`.padEnd(24) + `target`.padEnd(14) + (many ? 'p10'.padStart(8) + 'median'.padStart(8) + 'p90'.padStart(8) + '  in-range' : seeds.map((s) => String(s).padStart(9)).join('') + '  ok') + '  source')
  for (const [k, lo, hi, src] of TARGETS) {
    const v = rows.map((r) => r[k])
    const ok = v.filter((x) => x >= lo && x <= hi).length
    const cells = many ? [quant(v, 0.1), quant(v, 0.5), quant(v, 0.9)].map((x) => fmt(x).padStart(8)).join('') : v.map((x) => fmt(x).padStart(9)).join('')
    L.push(k.padEnd(24) + `${fmt(lo)}..${fmt(hi)}`.padEnd(14) + cells + `  ${ok}/${v.length}`.padEnd(many ? 12 : 6) + '  ' + src)
  }
  L.push(`realism score (mean miss, lower is better): ${sc.score.toFixed(3)}; in range ${sc.inRange}/${sc.total}`)
  return L.join('\n')
}

/** Distance of v outside [lo, hi] in units of the band's width (0 inside, capped at 2; NaN counts 2): the realism score is its mean over TARGETS. */
export function miss(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 2
  const w = hi - lo
  return Math.min(2, v < lo ? (lo - v) / w : v > hi ? (v - hi) / w : 0)
}

/** Mean miss over the targets and seeds (lower is better; 0 = every target in range on every seed), and the in-range count. */
export function realismScore(rows: Row[]): { score: number; inRange: number; total: number } {
  let s = 0, k = 0, n = 0
  for (const [key, lo, hi] of TARGETS) for (const r of rows) { const m = miss(r[key], lo, hi); s += m; if (m === 0) k++; n++ }
  return { score: s / n, inRange: k, total: n }
}

/** A/B: per target, the median over seeds of B and A and the change in misses (seeds matched by seed). */
export function formatVs(a: Row[], b: Row[]): string {
  const L: string[] = ['measure'.padEnd(24) + 'A median'.padStart(10) + 'B median'.padStart(10) + '  miss A -> B']
  const bs = new Map(b.map((r) => [r.seed, r]))
  const pa = a.filter((r) => bs.has(r.seed)), pb = pa.map((r) => bs.get(r.seed)!)
  for (const [k, lo, hi] of TARGETS) {
    const ma = pa.reduce((s, r) => s + miss(r[k], lo, hi), 0) / pa.length, mb = pb.reduce((s, r) => s + miss(r[k], lo, hi), 0) / pb.length
    const flag = mb > ma + 0.1 ? '  WORSE' : mb < ma - 0.1 ? '  better' : ''
    L.push(k.padEnd(24) + fmt(quant(pa.map((r) => r[k]), 0.5)).padStart(10) + fmt(quant(pb.map((r) => r[k]), 0.5)).padStart(10) + `  ${ma.toFixed(2)} -> ${mb.toFixed(2)}${flag}`)
  }
  const sa = realismScore(pa), sb = realismScore(pb)
  L.push(`realism score (mean miss, lower is better): ${sa.score.toFixed(3)} -> ${sb.score.toFixed(3)}; in range ${sa.inRange}/${sa.total} -> ${sb.inRange}/${sb.total}`)
  return L.join('\n')
}

// ---------------------------------------------------------------------------
// Ratchet (MASTER-PLAN §2.7, §4.2). The committed baseline docs/realism-baseline.jsonl holds the 4-seed rows (--boot 0) of the
// 8cabf09 history (any tree where G0 holds gives the same rows with default options: the harness reads only 8cabf09 fields).
// REALISM_BASELINE is its score under the current TARGETS; realismStats.test.ts fails if the two drift apart, so a band edit
// must re-record the number in the same commit.

/** The committed baseline's score under the current TARGETS, recomputed with the MASTER-PLAN §2.7 bands: 0.399916 (it was
 *  0.401521 under the old epi bands; the plan's quoted 0.404 does not reproduce from its own main4.jsonl rows). This is the
 *  phase-exit cap (§4.2). */
export const REALISM_BASELINE = { file: 'docs/realism-baseline.jsonl', seeds: REALISM_SEEDS, score: 0.399916, inRange: 45, total: 104 }
/** The same history's 22-seed sweep (recorded, not a gate): 0.418184 (old bands 0.419233; the plan quoted 0.421). */
export const REALISM_SWEEP_BASELINE = { file: 'docs/realism-sweep22.jsonl', seeds: REALISM_SWEEP_SEEDS, score: 0.418184, inRange: 212, total: 572 }

/** Per-PR guard: the score may rise by at most this much over the reference (realism-metrics.md section 6). Phase exit uses 0. */
export const REALISM_TOL = 0.03
/** A target is WORSE when its mean miss over the seeds rises by more than this many band widths (as in formatVs). */
export const REALISM_WORSE = 0.1
/** With a null-perturbation ensemble (--noise): a target is WORSE only when its mean miss exceeds the ensemble's mean by more
 *  than max(REALISM_WORSE, REALISM_Z * sd * sqrt(1 + 1/K)), sd the spread of the ensemble's K members (one candidate run is one
 *  more draw from that spread, compared with the K-member mean); the score likewise with max(tol, REALISM_Z * sd). z = 3 is
 *  ~0.1% one-sided per target under normality, ~3% family-wise over the 26 targets (the miss distributions have heavier tails). */
export const REALISM_Z = 3

/** Null-perturbation ensemble rows: the reference model re-run with HistoryOptions.jitter (discard a few draws of one stream at
 *  a year: same model, another realisation of a sensitively dependent trajectory), tagged by `jitter`. */
export interface RealismNoise {
  /** Members: the reference itself plus each jitter group covering every matched seed. */
  k: number
  /** Per target: the members' mean miss over the seeds, its spread (sample sd over members) and the WORSE threshold. */
  mean: Record<string, number>
  sd: Record<string, number>
  thr: Record<string, number>
  score: { mean: number; sd: number }
}

/** The noise reference of `base` (matched seeds) and its ensemble rows (grouped by their `jitter` tag). */
export function realismNoise(base: Row[], noise: Row[]): RealismNoise {
  const seeds = base.map((r) => r.seed)
  const groups = new Map<number, Map<number, Row>>()
  for (const r of noise) { if (!Number.isFinite(r.jitter)) continue; const g = groups.get(r.jitter) ?? new Map<number, Row>(); g.set(r.seed, r); groups.set(r.jitter, g) }
  const members: Row[][] = [base]
  for (const g of groups.values()) if (seeds.every((s) => g.has(s))) members.push(seeds.map((s) => g.get(s)!))
  const k = members.length
  const msd = (v: number[]): [number, number] => { const m = v.reduce((s, x) => s + x, 0) / v.length; return [m, v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) : 0] }
  const mean: Record<string, number> = {}, sd: Record<string, number> = {}, thr: Record<string, number> = {}
  for (const [key, lo, hi] of TARGETS) {
    const [m, s] = msd(members.map((rs) => rs.reduce((a, r) => a + miss(r[key], lo, hi), 0) / rs.length))
    mean[key] = m; sd[key] = s; thr[key] = Math.max(REALISM_WORSE, REALISM_Z * s * Math.sqrt(1 + 1 / k))
  }
  const [sm, ss] = msd(members.map((rs) => realismScore(rs).score))
  return { k, mean, sd, thr, score: { mean: sm, sd: ss } }
}

export interface RealismCheck {
  ok: boolean
  /** Scores over the matched seeds, reference and candidate. */
  base: number
  score: number
  tol: number
  /** Seeds of the reference with no candidate row (any is a failure: the comparison would not be like for like). */
  missing: number[]
  /** Targets whose mean miss rose by more than REALISM_WORSE and are not in `allow`. */
  worse: string[]
  /** WORSE targets excused by `allow` (a plan's accepted trade-offs, listed in its PR). */
  allowed: string[]
  /** The null-perturbation reference, when an ensemble was given (then `base` is its mean score). */
  noise?: RealismNoise
  report: string
}

/** Compares candidate rows against reference rows (matched by seed): fails if the score rises by more than `tol`, if any
 *  target is WORSE unless it is in `allow`, or if a reference seed has no candidate row. With `noise` (null-perturbation
 *  ensemble rows of the reference, see RealismNoise) both are judged against the ensemble's mean and spread instead of the
 *  single reference realisation (which is lucky on some rows: every perturbation then regresses to the mean). Pure: no sim runs. */
export function realismCheck(base: Row[], rows: Row[], tol = REALISM_TOL, allow: string[] = [], noise?: Row[]): RealismCheck {
  const bySeed = new Map(rows.map((r) => [r.seed, r]))
  const missing = base.filter((r) => !bySeed.has(r.seed)).map((r) => r.seed)
  const pa = base.filter((r) => bySeed.has(r.seed)), pb = pa.map((r) => bySeed.get(r.seed)!)
  const nz = noise && pa.length ? realismNoise(pa, noise) : undefined
  const worse: string[] = [], allowed: string[] = [], noisy: string[] = []
  for (const [k, lo, hi] of TARGETS) {
    if (pa.length === 0) break
    const ma = pa.reduce((s, r) => s + miss(r[k], lo, hi), 0) / pa.length, mb = pb.reduce((s, r) => s + miss(r[k], lo, hi), 0) / pb.length
    const bad = nz ? mb > nz.mean[k] + nz.thr[k] : mb > ma + REALISM_WORSE
    if (bad) (allow.includes(k) ? allowed : worse).push(k)
    else if (nz && mb > ma + REALISM_WORSE) noisy.push(`${k} (${ma.toFixed(2)} -> ${mb.toFixed(2)}; null ${nz.mean[k].toFixed(2)} + ${nz.thr[k].toFixed(2)})`)
  }
  const sa = pa.length ? (nz ? nz.score.mean : realismScore(pa).score) : NaN, sb = pb.length ? realismScore(pb).score : NaN
  const stol = nz ? Math.max(tol, REALISM_Z * nz.score.sd) : tol
  const ok = pa.length > 0 && missing.length === 0 && worse.length === 0 && sb <= sa + stol + 1e-12
  const L = [pa.length ? formatVs(pa, pb) : 'no seeds in common']
  if (nz) L.push(`null ensemble: ${nz.k} members (reference + ${nz.k - 1} jitters); score ${nz.score.mean.toFixed(3)} sd ${nz.score.sd.toFixed(3)}`)
  if (noisy.length) L.push(`within null noise (would be WORSE against the single reference): ${noisy.join(', ')}`)
  if (missing.length) L.push(`FAIL: no candidate row for reference seed(s) ${missing.join(' ')}`)
  if (worse.length) L.push(nz ? `FAIL: WORSE (mean miss above the null mean by > max(${REALISM_WORSE}, ${REALISM_Z} sd)): ${worse.join(', ')}` : `FAIL: WORSE (mean miss up > ${REALISM_WORSE} band widths): ${worse.join(', ')}`)
  if (allowed.length) L.push(`allowed WORSE (--allow): ${allowed.join(', ')}`)
  if (sb > sa + stol + 1e-12) L.push(`FAIL: score ${sb.toFixed(3)} > reference ${sa.toFixed(3)} + tol ${stol.toFixed(3)}`)
  L.push(ok ? `realism check OK: ${sa.toFixed(3)} -> ${sb.toFixed(3)} (tol ${stol.toFixed(3)}, ${pa.length} seeds)` : 'realism check FAILED')
  return { ok, base: sa, score: sb, tol: stol, missing, worse, allowed, noise: nz, report: L.join('\n') }
}

/** Every key, per seed (the detail printout). */
export function formatDetail(rows: Row[]): string {
  const keys = Object.keys(rows[0]).filter((k) => k !== 'seed')
  return keys.map((k) => k.padEnd(28) + rows.map((r) => fmt(r[k]).padStart(9)).join('')).join('\n')
}

// ---------------------------------------------------------------------------

/** Runs the sim and the measures for each seed (one row per seed: the measures plus seed, msRun, msStats). */
export function runRealismStats(seeds: number[], boot = 0, opts: HistoryOptions = {}, onRow?: (r: Row) => void): Row[] {
  const rows: Row[] = []
  for (const seed of seeds) {
    const t0 = performance.now()
    const w = generateWorld(seed)
    const h = runHistory(w, opts).history
    const t1 = performance.now()
    const r = realism(h, w, boot, seed)
    r.seed = seed; r.msRun = t1 - t0; r.msStats = performance.now() - t1
    if (opts.jitter) r.jitter = opts.jitter.year * 100 + opts.jitter.draws + (opts.jitter.stream === 'structures' ? 50 : 0) // null-ensemble member tag
    onRow?.(r)
    rows.push(r)
  }
  return rows
}

/** Parses --json rows (one JSON object per line; null reads as NaN, which is how JSON.stringify wrote it). */
export function parseRows(text: string): Row[] {
  return text.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l, (_k, v) => (v === null ? NaN : v)) as Row)
}

if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) {
  const argv = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
  const flag = (f: string): boolean => argv.includes(f)
  const val = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
  const boot = Number(val('--boot') ?? 0)
  const from = val('--from')
  const opts = val('--opts') ? (JSON.parse(val('--opts')!) as HistoryOptions) : {}
  if (typeof opts !== 'object' || opts === null || Array.isArray(opts)) throw new Error(`--opts must be a JSON object of HistoryOptions, got ${val('--opts')}`)
  const vs = val('--vs')
  const skip = new Set([val('--boot'), from, val('--opts'), vs].filter((x) => x !== undefined))
  // node:fs only on the CLI path (the module itself stays browser-safe; tsconfig has no node types).
  const fs = (await import('node:' + 'fs')) as { readFileSync: (p: string, e: string) => string }
  const load = (f: string): Row[] => parseRows(fs.readFileSync(f, 'utf8'))
  const check = val('--check')
  if (check !== undefined) {
    // Ratchet: candidate rows from --from, else fresh runs on the reference's seeds (or the seeds given), against the reference.
    skip.add(check); skip.add(val('--tol') ?? ''); skip.add(val('--allow') ?? ''); skip.add(val('--noise') ?? '')
    const base = load(check)
    const given = argv.filter((a) => !a.startsWith('--') && !skip.has(a)).map(Number)
    const rows = from ? load(from) : runRealismStats(given.length ? given : base.map((r) => r.seed), boot, opts)
    const nf = val('--noise')
    const c = realismCheck(base, rows, Number(val('--tol') ?? REALISM_TOL), (val('--allow') ?? '').split(',').filter(Boolean), nf ? load(nf) : undefined)
    console.log(c.report)
    ;(globalThis as { process?: { exitCode?: number } }).process!.exitCode = c.ok ? 0 : 1
  } else if (from && vs) console.log(formatVs(load(from), load(vs)))
  else {
    const seeds = argv.filter((a) => !a.startsWith('--') && !skip.has(a)).map(Number)
    const json = flag('--json')
    const rows = from ? load(from) : runRealismStats(seeds.length ? seeds : REALISM_SEEDS, boot, opts, json ? (r) => console.log(JSON.stringify(r)) : undefined)
    if (!json) {
      console.log(formatTable(rows))
      if (flag('--detail') || rows.length <= 6) console.log('\n' + formatDetail(rows))
    }
  }
}
