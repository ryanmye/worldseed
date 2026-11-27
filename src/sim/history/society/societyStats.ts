// society: the stats harness (society-secular-cycles.md §6). Not shipped in tests.
// Run: node --experimental-strip-types src/sim/history/society/societyStats.ts [seed ...] [--no-ab] [--finance] [--set SOC.x=v ...]
// One JSON line per seed and arm (on, and off unless --no-ab): periodicity (P1 ACF, P2 crisis intervals, P3 band test),
// crisis rate, Spearman(Ψ, next-25-year instability), ε median/p90, Ψ p90, Urban share of revolts, the guards (revolts, civil
// wars, crises, polities alive at 1500/2000, world pop at 2000) and runtime. Instability weights as socYear (§2.6).

import { EventType, PolityEnd, ReignEnd, RevoltCause } from '../../../contract.ts'
import type { History } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import { SOC } from './params.ts'

const argv: string[] = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
const flag = (k: string) => argv.includes(k)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--set') continue
  const [k, v] = argv[i + 1].split('=')
  ;(SOC as unknown as Record<string, number | boolean>)[k.split('.')[1]] = v === 'true' ? true : v === 'false' ? false : Number(v)
}
const seeds = argv.filter((x, i) => /^\d+$/.test(x) && argv[i - 1] !== '--set').map(Number)
const YEARS = 2000
const qq = (a: number[], q: number) => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(q * (b.length - 1))] }
const r3 = (x: number) => Math.round(x * 1000) / 1000

/** Polity ruled from `id` at `year` (from the capitals table), -1. */
function capIndex(h: History): (id: number, year: number) => number {
  const m = new Map<number, [number, number, number][]>()
  for (const P of h.polities) for (let k = 0; k < P.capitals.length; k++) {
    const to = k + 1 < P.capitals.length ? P.capitalYears[k + 1] : P.endedYear >= 0 ? P.endedYear : 1e9
    const a = m.get(P.capitals[k]) ?? []; a.push([P.id, P.capitalYears[k], to]); m.set(P.capitals[k], a)
  }
  return (id, year) => { const a = m.get(id); if (!a) return -1; for (const [p, f, t] of a) if (year >= f && year <= t) return p; return -1 }
}

/** Yearly weighted instability per polity. */
function instability(h: History): Float64Array[] {
  const at = capIndex(h)
  const out = h.polities.map(() => new Float64Array(YEARS + 1))
  const ev = h.events
  const add = (p: number, y: number, w: number) => { if (p >= 0 && p < out.length && y <= YEARS) out[p][y] += w }
  for (let k = 0; k < ev.length; k++) {
    const e = ev[k]
    switch (e.type) {
      case EventType.Revolt: { const n = ev[k + 1]; const won = !(n && n.type === EventType.RevoltCrushed && n.settlement === e.settlement); add(at(e.other, e.year), e.year, won ? 2 : 1); break }
      case EventType.SuccessionCrisis: add(e.value, e.year, 1); break
      case EventType.CivilWar: add(at(e.other, e.year), e.year, 3); break
      case EventType.Partitioned: add(e.value, e.year, 2); break
      case EventType.ReignEnded: if (e.extra === ReignEnd.Overthrown || e.extra === ReignEnd.Deposed) add(at(e.settlement, e.year), e.year, 1); break
      case EventType.PolityEnded: if (h.polities[e.value]?.endCause === PolityEnd.Fragmented) add(e.value, e.year, 3); break
    }
  }
  return out
}

/** Detrended decadal series of polity p over its life (±25-decade moving mean). */
function decadal(x: Float64Array, y0: number, y1: number): number[] {
  const d: number[] = []
  for (let y = y0; y + 10 <= y1; y += 10) { let s = 0; for (let k = 0; k < 10; k++) s += x[y + k]; d.push(s) }
  const out: number[] = []
  for (let i = 0; i < d.length; i++) { let s = 0, n = 0; for (let j = i - 25; j <= i + 25; j++) if (j >= 0 && j < d.length) { s += d[j]; n++ } out.push(d[i] - s / n) }
  return out
}
function acf(x: number[], lag: number): number {
  const n = x.length
  if (n <= lag + 5) return NaN
  let m = 0; for (const v of x) m += v; m /= n
  let v0 = 0; for (const v of x) v0 += (v - m) * (v - m)
  if (v0 === 0) return NaN
  let c = 0; for (let i = 0; i + lag < n; i++) c += (x[i] - m) * (x[i + lag] - m)
  return c / v0
}
/** Share of the periodogram power in periods 15-35 decades. */
function bandShare(x: number[]): number {
  const n = x.length
  let tot = 0, band = 0
  for (let k = 1; k <= n / 2; k++) {
    let re = 0, im = 0
    for (let t = 0; t < n; t++) { const a = (2 * Math.PI * k * t) / n; re += x[t] * Math.cos(a); im -= x[t] * Math.sin(a) }
    const pw = re * re + im * im
    tot += pw
    const per = n / k
    if (per >= 15 && per <= 35) band += pw
  }
  return tot > 0 ? band / tot : 0
}
function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]) => { const i = v.map((x, k) => [x, k] as [number, number]).sort((x, y) => x[0] - y[0]); const r = new Array<number>(v.length); let k = 0; while (k < i.length) { let j = k; while (j + 1 < i.length && i[j + 1][0] === i[k][0]) j++; for (let t = k; t <= j; t++) r[i[t][1]] = (k + j) / 2; k = j + 1 } return r }
  const ra = rank(a), rb = rank(b), n = a.length
  let ma = 0, mb = 0; for (let k = 0; k < n; k++) { ma += ra[k]; mb += rb[k] } ma /= n; mb /= n
  let c = 0, va = 0, vb = 0; for (let k = 0; k < n; k++) { c += (ra[k] - ma) * (rb[k] - mb); va += (ra[k] - ma) ** 2; vb += (rb[k] - mb) ** 2 }
  return c / Math.sqrt(va * vb)
}

function row(seed: number, on: boolean): Record<string, unknown> {
  const t0 = Date.now()
  const { history: h, diag } = runHistory(generateWorld(seed), { years: YEARS, society: on, finance: flag('--finance') })
  const ms = Date.now() - t0
  const inst = instability(h)
  const long = h.polities.filter((P) => (P.endedYear < 0 ? YEARS : P.endedYear) - P.foundedYear >= 400)
  const lags: number[][] = []
  let lcg = 12345
  const rnd = () => { lcg = (lcg * 1103515245 + 12345) % 2147483648; return lcg / 2147483648 }
  let sig = 0, tested = 0, pyLong = 0
  for (const P of long) {
    const y1 = P.endedYear < 0 ? YEARS : P.endedYear
    pyLong += y1 - P.foundedYear
    const x = decadal(inst[P.id], P.foundedYear, y1)
    const l: number[] = []
    for (let k = 5; k <= 35; k++) l.push(acf(x, k))
    lags.push(l)
    if (x.some((v) => v !== 0)) {
      tested++
      const b0 = bandShare(x)
      let ge = 0
      for (let s = 0; s < 100; s++) { const y = x.slice(); for (let i = y.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = y[i]; y[i] = y[j]; y[j] = t } if (bandShare(y) >= b0) ge++ }
      if ((ge + 1) / 101 <= 0.05) sig++
    }
  }
  const meanLag = (k: number) => { let s = 0, n = 0; for (const l of lags) { const v = l[k - 5]; if (Number.isFinite(v)) { s += v; n++ } } return n ? s / n : NaN }
  let minL = Infinity, minAt = 7
  for (let k = 7; k <= 17; k++) if (meanLag(k) < minL) { minL = meanLag(k); minAt = k }
  let maxL = -Infinity
  for (let k = Math.max(15, minAt + 1); k <= 35; k++) if (meanLag(k) > maxL) maxL = meanLag(k)
  const ev = h.events
  const count = (t: number) => ev.filter((e) => e.type === t).length
  const revolts = ev.filter((e) => e.type === EventType.Revolt)
  const out: Record<string, unknown> = {
    seed, society: on, ms, long: long.length,
    acfMin7_17: r3(minL), acfMax15_35: r3(maxL), p3Sig: tested ? r3(sig / tested) : 0,
    revolts: revolts.length, urbanShare: r3(revolts.filter((e) => e.value === RevoltCause.Urban).length / Math.max(1, revolts.length)),
    civilWars: count(EventType.CivilWar), crises: count(EventType.SuccessionCrisis), partitions: count(EventType.Partitioned),
    overthrown: ev.filter((e) => e.type === EventType.ReignEnded && (e.extra === ReignEnd.Overthrown || e.extra === ReignEnd.Deposed)).length,
    fragmented: h.polities.filter((P) => P.endCause === PolityEnd.Fragmented).length,
    alive1500: h.polities.filter((P) => P.foundedYear <= 1500 && (P.endedYear < 0 || P.endedYear > 1500)).length,
    alive2000: h.polities.filter((P) => P.endedYear < 0).length,
  }
  let pop = 0
  const S = h.settlements.length, q = h.snapshotCount - 1
  for (let i = 0; i < S; i++) pop += h.population[q * S + i]
  out.pop2000 = Math.round(pop)
  const d = diag.society
  if (on && d) {
    const st = d.steps
    const psi: number[] = [], eps: number[] = [], nx: number[] = []
    const crisisYears = new Map<number, number[]>()
    for (let i = 0; i < st.length; i += 6) {
      const y = st[i], p = st[i + 1]
      psi.push(st[i + 2]); eps.push(st[i + 3])
      let s = 0; for (let k = y + 1; k <= y + 25 && k <= YEARS; k++) s += inst[p] ? inst[p][k] : 0
      nx.push(s)
    }
    for (const e of ev) if (e.type === EventType.SocialPhase && e.extra === 2) { const a = crisisYears.get(e.value) ?? []; a.push(e.year); crisisYears.set(e.value, a) }
    const gaps: number[] = []
    let crisisLong = 0
    for (const P of long) { const a = crisisYears.get(P.id) ?? []; crisisLong += a.length; for (let k = 1; k < a.length; k++) gaps.push(a[k] - a[k - 1]) }
    const fac = (a: Uint8Array, sc: number) => { const v: number[] = []; for (let i = 0; i < a.length; i++) if (h.socPhase[i] !== 255) v.push((a[i] / 255) * sc); return r3(qq(v, 0.5)) }
    Object.assign(out, {
      mmp50: fac(h.socMMP, 8), emp50: fac(h.socEMP, 8), sfd50: fac(h.socSFD, 8), w50: fac(h.socWage, 4), urb50: fac(h.socUrban, 1), kappa50: fac(h.socCoercion, 1),
      spearman: r3(spearman(psi, nx)), psi50: r3(qq(psi, 0.5)), psi90: r3(qq(psi, 0.9)), eps50: r3(qq(eps, 0.5)), eps90: r3(qq(eps, 0.9)),
      crisisPer1000: r3((1000 * crisisLong) / Math.max(1, pyLong)), crisisGap50: qq(gaps, 0.5), gaps: gaps.length,
      ev: { crisis: d.crises, expansion: d.expansions, dear: d.dear, serfOn: d.serfOn, serfOff: d.serfOff, factions: d.factions, ennobled: d.ennobled, thinned: d.thinned },
    })
  }
  return out
}

for (const seed of seeds.length ? seeds : [1, 7, 42, 1234]) {
  console.log(JSON.stringify(row(seed, true)))
  if (!flag('--no-ab')) console.log(JSON.stringify(row(seed, false)))
}
