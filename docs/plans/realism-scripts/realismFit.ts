// realism: estimators for the realism harness (realismStats.ts). Pure functions, no simulation imports, so they can be unit-tested
// on synthetic draws (realismFit.test.ts). Methods:
//   - continuous power-law tail fit after Clauset, Shalizi & Newman (2009), "Power-law distributions in empirical data",
//     SIAM Review 51(4):661-703: alpha by MLE for each candidate xmin, xmin chosen by the smallest KS distance, a
//     semi-parametric bootstrap goodness-of-fit p, and Vuong likelihood-ratio tests against the truncated lognormal and
//     truncated exponential;
//   - rank-size (Zipf) exponent zeta = alpha - 1 (the CCDF slope); also the Gabaix & Ibragimov (2011) "rank - 1/2" OLS for comparison;
//   - right-censored exponential durations; OLS; Poisson pseudo-maximum likelihood (Santos Silva & Tenreyro 2006) by IRLS.

/** Small deterministic PRNG (mulberry32): the bootstrap must not touch any simulation stream. */
export function rng32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** log erfc(z) without underflow (Numerical Recipes erfcc, relative error < 1.2e-7). */
export function logErfc(z: number): number {
  const az = Math.abs(z)
  const t = 1 / (1 + 0.5 * az)
  const p = -az * az - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
  const l = Math.log(t) + p
  return z >= 0 ? l : Math.log(2 - Math.exp(l))
}

export interface PowerLawFit {
  /** Exponent of the density p(x) ~ x^-alpha above xmin (CSN's alpha); the CCDF exponent is alpha - 1. */
  alpha: number
  /** Standard error (alpha - 1) / sqrt(n). */
  se: number
  xmin: number
  /** Points at or above xmin, and all points. */
  nTail: number
  n: number
  /** KS distance of the tail from the fitted law. */
  ks: number
  /** Bootstrap goodness-of-fit p (NaN unless asked): p <= 0.1 rules the power law out (CSN 4.1). */
  p: number
  /** Vuong normalised log-likelihood ratio and its two-sided p, power law vs truncated lognormal / exponential (R > 0 favours the power law). */
  lnR: number; lnP: number
  expR: number; expP: number
}

/** alpha and KS distance with xmin = x[i] of ascending x. */
function tailFit(x: Float64Array, i: number): { alpha: number; ks: number } {
  const n = x.length - i, xm = x[i]
  let S = 0
  for (let j = i; j < x.length; j++) S += Math.log(x[j] / xm)
  if (!(S > 0)) return { alpha: NaN, ks: Infinity }
  const alpha = 1 + n / S
  let D = 0
  for (let j = i; j < x.length; j++) {
    const F = 1 - Math.pow(x[j] / xm, 1 - alpha)
    const lo = (j - i) / n, hi = (j - i + 1) / n
    const d = Math.max(Math.abs(F - lo), Math.abs(F - hi))
    if (d > D) D = d
  }
  return { alpha, ks: D }
}

/** Index of the best xmin and its fit: the candidate xmin with the smallest KS distance, at least minTail points above it. */
function scan(x: Float64Array, minTail: number, maxCand: number): { i: number; alpha: number; ks: number } {
  const N = x.length
  const cands: number[] = []
  for (let i = 0; i <= N - minTail; i++) if (i === 0 || x[i] !== x[i - 1]) cands.push(i)
  const step = Math.max(1, Math.ceil(cands.length / maxCand))
  let best = { i: -1, alpha: NaN, ks: Infinity }
  for (let c = 0; c < cands.length; c += step) {
    const f = tailFit(x, cands[c])
    if (f.ks < best.ks) best = { i: cands[c], alpha: f.alpha, ks: f.ks }
  }
  return best
}

function vuong(l: number[]): { R: number; p: number } {
  const n = l.length
  let m = 0
  for (const v of l) m += v
  const R = m
  m /= n
  let v2 = 0
  for (const v of l) v2 += (v - m) * (v - m)
  const sd = Math.sqrt(v2 / n)
  if (!(sd > 0)) return { R, p: NaN }
  const z = Math.abs(R) / (sd * Math.sqrt(2 * n))
  return { R: R / (sd * Math.sqrt(n)), p: Math.exp(logErfc(z)) }
}

/** Nelder-Mead minimiser in 2D (enough for the truncated lognormal). */
function nm2(f: (a: number, b: number) => number, a0: number, b0: number): [number, number] {
  let P: [number, number, number][] = [[a0, b0, f(a0, b0)], [a0 + 0.5, b0, f(a0 + 0.5, b0)], [a0, b0 + 0.3, f(a0, b0 + 0.3)]]
  for (let it = 0; it < 400; it++) {
    P.sort((u, v) => u[2] - v[2])
    const [b, g, w] = P
    const cx = (b[0] + g[0]) / 2, cy = (b[1] + g[1]) / 2
    const rx = 2 * cx - w[0], ry = 2 * cy - w[1], fr = f(rx, ry)
    if (fr < b[2]) {
      const ex = 3 * cx - 2 * w[0], ey = 3 * cy - 2 * w[1], fe = f(ex, ey)
      P = fe < fr ? [b, g, [ex, ey, fe]] : [b, g, [rx, ry, fr]]
    } else if (fr < g[2]) P = [b, g, [rx, ry, fr]]
    else {
      const kx = (cx + w[0]) / 2, ky = (cy + w[1]) / 2, fk = f(kx, ky)
      if (fk < w[2]) P = [b, g, [kx, ky, fk]]
      else P = [b, [(b[0] + g[0]) / 2, (b[1] + g[1]) / 2, f((b[0] + g[0]) / 2, (b[1] + g[1]) / 2)], [(b[0] + w[0]) / 2, (b[1] + w[1]) / 2, f((b[0] + w[0]) / 2, (b[1] + w[1]) / 2)]]
    }
    if (Math.abs(P[0][2] - P[2][2]) < 1e-10 && it > 30) break
  }
  P.sort((u, v) => u[2] - v[2])
  return [P[0][0], P[0][1]]
}

/**
 * Fits a continuous power-law tail to positive data (CSN 2009). boot > 0 runs that many semi-parametric bootstrap
 * replicates for the goodness-of-fit p (seeded, deterministic). Returns null with fewer than minTail positive points.
 */
export function fitPowerLaw(data: ArrayLike<number>, opts: { minTail?: number; maxCand?: number; boot?: number; seed?: number; xmin?: number } = {}): PowerLawFit | null {
  const minTail = opts.minTail ?? 20, maxCand = opts.maxCand ?? 150
  const x = Float64Array.from(Array.from(data).filter((v) => v > 0 && Number.isFinite(v))).sort()
  if (x.length < minTail) return null
  let i: number, alpha: number, ks: number
  if (opts.xmin !== undefined) {
    i = x.findIndex((v) => v >= opts.xmin!)
    if (i < 0 || x.length - i < 5) return null
    ;({ alpha, ks } = tailFit(x, i))
  } else ({ i, alpha, ks } = scan(x, minTail, maxCand))
  if (i < 0) return null
  const xm = x[i], n = x.length - i
  // Vuong tests on the tail.
  let sl = 0, sl2 = 0
  for (let j = i; j < x.length; j++) { const l = Math.log(x[j]); sl += l; sl2 += l * l }
  const m0 = sl / n, s0 = Math.sqrt(Math.max(1e-6, sl2 / n - m0 * m0))
  const lnXm = Math.log(xm)
  const negLL = (mu: number, ls: number): number => {
    const sg = Math.exp(ls)
    let ll = 0
    const lS = logErfc((lnXm - mu) / (sg * Math.SQRT2)) - Math.LN2
    for (let j = i; j < x.length; j++) { const z = (Math.log(x[j]) - mu) / sg; ll += -Math.log(x[j]) - ls - 0.9189385332 - 0.5 * z * z - lS }
    return -ll
  }
  const [mu, ls] = nm2(negLL, m0, Math.log(s0))
  const sg = Math.exp(ls), lS = logErfc((lnXm - mu) / (sg * Math.SQRT2)) - Math.LN2
  let mean = 0
  for (let j = i; j < x.length; j++) mean += x[j]
  mean /= n
  const lam = 1 / Math.max(1e-12, mean - xm)
  const dLn: number[] = [], dExp: number[] = []
  for (let j = i; j < x.length; j++) {
    const lp = Math.log(alpha - 1) - lnXm - alpha * Math.log(x[j] / xm)
    const z = (Math.log(x[j]) - mu) / sg
    const lln = -Math.log(x[j]) - ls - 0.9189385332 - 0.5 * z * z - lS
    const lex = Math.log(lam) - lam * (x[j] - xm)
    dLn.push(lp - lln); dExp.push(lp - lex)
  }
  const vl = vuong(dLn), ve = vuong(dExp)
  // Bootstrap.
  let p = NaN
  const B = opts.boot ?? 0
  if (B > 0) {
    const r = rng32(opts.seed ?? 12345)
    const N = x.length, below = i
    let ge = 0
    for (let b = 0; b < B; b++) {
      const y = new Float64Array(N)
      for (let k = 0; k < N; k++) {
        if (below === 0 || r() < n / N) y[k] = xm * Math.pow(1 - r(), -1 / (alpha - 1))
        else y[k] = x[Math.floor(r() * below)]
      }
      y.sort()
      const f = opts.xmin !== undefined ? tailFit(y, Math.max(0, y.findIndex((v) => v >= xm))) : scan(y, minTail, maxCand)
      if (f.ks >= ks) ge++
    }
    p = ge / B
  }
  return { alpha, se: (alpha - 1) / Math.sqrt(n), xmin: xm, nTail: n, n: x.length, ks, p, lnR: vl.R, lnP: vl.p, expR: ve.R, expP: ve.p }
}

/** Gabaix-Ibragimov rank-size slope: OLS of ln(rank - 1/2) on ln(size) over the top n sizes; returns zeta (positive) and its GI standard error zeta * sqrt(2 / n). */
export function giZipf(sizes: ArrayLike<number>, top: number): { zeta: number; se: number; n: number } {
  const x = Array.from(sizes).filter((v) => v > 0).sort((a, b) => b - a).slice(0, top)
  const n = x.length
  if (n < 5) return { zeta: NaN, se: NaN, n }
  const X = x.map((v) => Math.log(v)), Y = x.map((_, k) => Math.log(k + 1 - 0.5))
  const o = ols(Y, X.map((v) => [v]))
  const z = -o.beta[1]
  return { zeta: z, se: z * Math.sqrt(2 / n), n }
}

export interface Ols { beta: number[]; se: number[]; r2: number; n: number }

/** OLS with an intercept (beta[0]); rows of X without the intercept column. */
export function ols(y: number[], X: number[][]): Ols {
  const n = y.length, k = (X[0]?.length ?? 0) + 1
  const A = Array.from({ length: k }, () => new Float64Array(k)), b = new Float64Array(k)
  for (let r = 0; r < n; r++) {
    const row = [1, ...X[r]]
    for (let a = 0; a < k; a++) { b[a] += row[a] * y[r]; for (let c = 0; c < k; c++) A[a][c] += row[a] * row[c] }
  }
  const inv = invert(A)
  if (!inv) return { beta: new Array(k).fill(NaN), se: new Array(k).fill(NaN), r2: NaN, n }
  const beta = inv.map((row) => row.reduce((s, v, c) => s + v * b[c], 0))
  let sse = 0, my = 0
  for (const v of y) my += v
  my /= n
  let sst = 0
  for (let r = 0; r < n; r++) { const row = [1, ...X[r]]; const f = row.reduce((s, v, c) => s + v * beta[c], 0); sse += (y[r] - f) ** 2; sst += (y[r] - my) ** 2 }
  const s2 = sse / Math.max(1, n - k)
  return { beta, se: inv.map((row, a) => Math.sqrt(s2 * row[a])), r2: 1 - sse / sst, n }
}

function invert(A: Float64Array[]): number[][] | null {
  const k = A.length
  const M = A.map((row, a) => [...row, ...Array.from({ length: k }, (_, c) => (c === a ? 1 : 0))])
  for (let c = 0; c < k; c++) {
    let p = c
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    const d = M[c][c]
    for (let j = 0; j < 2 * k; j++) M[c][j] /= d
    for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * k; j++) M[r][j] -= f * M[c][j] }
  }
  return M.map((row) => row.slice(k))
}

/** Poisson pseudo-ML (log link) by IRLS, with an intercept: the gravity estimator robust to heteroskedastic log errors. */
export function ppml(y: number[], X: number[][]): number[] {
  const n = y.length
  let my = 0
  for (const v of y) my += v
  my /= n
  const ys = y.map((v) => v / my) // scale-free
  let beta = ols(ys.map((v) => Math.log(v + 1e-3)), X).beta
  for (let it = 0; it < 60; it++) {
    const eta = X.map((row) => beta[0] + row.reduce((s, v, c) => s + v * beta[c + 1], 0))
    const mu = eta.map((e) => Math.exp(Math.min(50, e)))
    const z = eta.map((e, r) => e + (ys[r] - mu[r]) / mu[r])
    // Weighted OLS: scale rows by sqrt(mu).
    const k = beta.length
    const A = Array.from({ length: k }, () => new Float64Array(k)), b = new Float64Array(k)
    for (let r = 0; r < n; r++) {
      const row = [1, ...X[r]], w = mu[r]
      for (let a = 0; a < k; a++) { b[a] += w * row[a] * z[r]; for (let c = 0; c < k; c++) A[a][c] += w * row[a] * row[c] }
    }
    const inv = invert(A)
    if (!inv) break
    const nb = inv.map((row) => row.reduce((s, v, c) => s + v * b[c], 0))
    const dd = nb.reduce((s, v, c) => s + Math.abs(v - beta[c]), 0)
    beta = nb
    if (dd < 1e-9) break
  }
  beta[0] += Math.log(my)
  return beta
}

export interface Durations {
  n: number; ended: number
  /** Censored exponential MLE of the mean (total exposure / ended), median of the ended ones, their coefficient of variation. */
  meanMle: number; median: number; cv: number
  /** KS distance of the ended durations from the exponential with the MLE mean (a rough check: censoring is ignored here). */
  ksExp: number
}

/** Right-censored durations: d[i] years, ended[i] false when still going at the end of the run. */
export function durations(d: number[], ended: boolean[]): Durations {
  let tot = 0, e = 0
  const done: number[] = []
  for (let i = 0; i < d.length; i++) { tot += d[i]; if (ended[i]) { e++; done.push(d[i]) } }
  done.sort((a, b) => a - b)
  const meanMle = e > 0 ? tot / e : NaN
  const m = done.reduce((s, v) => s + v, 0) / Math.max(1, done.length)
  const sd = Math.sqrt(done.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, done.length))
  let D = 0
  for (let j = 0; j < done.length; j++) {
    const F = 1 - Math.exp(-done[j] / meanMle)
    D = Math.max(D, Math.abs(F - j / done.length), Math.abs(F - (j + 1) / done.length))
  }
  return { n: d.length, ended: e, meanMle, median: done.length ? done[done.length >> 1] : NaN, cv: m > 0 ? sd / m : NaN, ksExp: D }
}

/** Spearman rank correlation. */
export function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]): number[] => { const i = v.map((_, k) => k).sort((x, y) => v[x] - v[y]); const r = new Array(v.length); i.forEach((k, j) => { r[k] = j }); return r }
  const ra = rank(a), rb = rank(b), n = a.length
  if (n < 3) return NaN
  const m = (n - 1) / 2
  let sab = 0, saa = 0, sbb = 0
  for (let k = 0; k < n; k++) { sab += (ra[k] - m) * (rb[k] - m); saa += (ra[k] - m) ** 2; sbb += (rb[k] - m) ** 2 }
  return sab / Math.sqrt(saa * sbb)
}

export function quant(a: number[], q: number): number { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(q * b.length))] : NaN }
