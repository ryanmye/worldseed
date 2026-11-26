// realism: headless harness that scores a run against empirical regularities of real history. Lives at
// src/sim/history/realismStats.ts (imports are relative to that). Run with:
//   node --experimental-strip-types src/sim/history/realismStats.ts [seed ...]       (default 1 7 42 1234; Node 22 needs the flag, 23+ not)
//   ... --boot 100        bootstrap replicates for the power-law goodness-of-fit p (default 0: skip; ~1-5 s per fit at 100)
//   ... --json            one JSON row per seed on stdout instead of the table (for sweeps; aggregate with --from)
//   ... --from rows.jsonl aggregate earlier --json rows (any number of seeds) into the target table
//   ... --opts '{"goods":false}'  HistoryOptions for the run (A/B of a feature against the targets)
//   ... --from a.jsonl --vs b.jsonl   A/B: per-target medians and misses of B against A (the sibling plans' realism guard)
// Reports (realism-metrics.md section 3): Zipf rank-size of towns per era (CSN power-law MLE, not OLS on log-log), Gibrat's
// law of town growth, Richardson's law of war severity (CSN) and war durations and onsets, polity lifespans (Arbesman) and
// sizes (Taagepera), the largest state's share of people and land, faith shares, epidemic mortality, urbanisation, and a
// gravity-model fit of route and long-haul volumes (with the circularity caveat: partners are chosen by size / cost^2).

import { CITY_POPULATION, WarKind } from '../../contract.ts'
import type { History, World } from '../../contract.ts'
import { generateWorld } from '../index.ts'
import { runHistory } from './index.ts'
import { durations, fitPowerLaw, giZipf, ols, ppml, quant, spearman } from './realismFit.ts'
import type { PowerLawFit } from './realismFit.ts'

const R_KM = 6371
export const REALISM_SEEDS = [1, 7, 42, 1234]
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
    }
    for (const y of CENTURIES) if (y <= h.years) row[`pol.largestPop${y}`] = largestPopShare.get(y) ?? 0
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
  ['pol.largestPop1500', 0.15, 0.4, 'Han/Rome/Qing 25-35%'],
  ['pol.largestPop2000', 0.15, 0.4, 'Han/Rome/Qing 25-35%'],
  ['pol.largestLand2000', 0.08, 0.25, 'Taagepera: Mongol 16%, British 24%'],
  ['faith2000.top1', 0.2, 0.4, 'Pew 2012: 31.5%'],
  ['faith2000.top4', 0.55, 0.9, 'Pew 2012: ~77%'],
  ['epi.worstNet', 0.25, 0.55, 'Black Death 30-50%'],
  ['epi.plagueWorstNet', 0.25, 0.55, 'Black Death 30-50%'],
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

/** Every key, per seed (the detail printout). */
export function formatDetail(rows: Row[]): string {
  const keys = Object.keys(rows[0]).filter((k) => k !== 'seed')
  return keys.map((k) => k.padEnd(28) + rows.map((r) => fmt(r[k]).padStart(9)).join('')).join('\n')
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
  const flag = (f: string): boolean => argv.includes(f)
  const val = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
  const boot = Number(val('--boot') ?? 0)
  const from = val('--from')
  const opts = val('--opts') ? JSON.parse(val('--opts')!) : {}
  const vs = val('--vs')
  const skip = new Set([val('--boot'), val('--from'), val('--opts'), vs].filter((x) => x !== undefined))
  let rows: Row[] = []
  const fs = (await import('node:' + 'fs')) as { readFileSync: (p: string, e: string) => string }
  const load = (f: string): Row[] => fs.readFileSync(f, 'utf8').split('\n').filter((l: string) => l.trim().startsWith('{')).map((l: string) => JSON.parse(l, (_k, v) => (v === null ? NaN : v)) as Row)
  if (from && vs) { console.log(formatVs(load(from), load(vs))); return }
  if (from) rows = load(from)
  else {
    const seeds = argv.filter((a) => !a.startsWith('--') && !skip.has(a)).map(Number)
    for (const seed of seeds.length ? seeds : REALISM_SEEDS) {
      const t0 = performance.now()
      const w = generateWorld(seed)
      const h = runHistory(w, opts).history
      const t1 = performance.now()
      const r = realism(h, w, boot, seed)
      r.seed = seed; r.msRun = t1 - t0; r.msStats = performance.now() - t1
      if (flag('--json')) console.log(JSON.stringify(r))
      rows.push(r)
    }
  }
  if (flag('--json')) return
  console.log(formatTable(rows))
  if (flag('--detail') || rows.length <= 6) console.log('\n' + formatDetail(rows))
}

if (import.meta.url === `file://${(globalThis as { process?: { argv: string[] } }).process?.argv[1]}`) await main()
