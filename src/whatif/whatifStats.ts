// What-if stats harness (experience-whatif-director-sagas §1.10). Node:
//   node --experimental-strip-types src/whatif/whatifStats.ts [--seeds 1,7,42,1234] [--years 2000] [--at 300,800,1500]
//        [--kinds fortify,war,explore,settle] [--trivial 8]
// Per seed: one run without orders, then one per (kind, year) and K trivial Fortify orders. Reports per run: the order's
// outcome, the divergence year (-1 exactly when nothing changed: target 100% agreement with "Failed or Expired with nothing
// done"), the parting year (similarity < 0.5), the share of B's polities with peak >= 10k matched, the fingerprint and diff
// times and the fingerprint size. The noise floor: |ln(popB/popA)| per people at the end, over the trivial orders that were
// fulfilled; its 90th percentile is the "about the same" threshold ρ (owner decision: calibrated against trivial orders).

import { OrderKind, OrderStatus, TOWN_POPULATION, type History, type Order, type World } from '../contract.ts'
import { generateWorld, simulateHistory } from '../sim/index.ts'
import { fingerprintBytes, fingerprintOf, type HistoryFingerprint } from './fingerprint.ts'
import { diffFingerprints, partingYear } from './diff.ts'

const ARGV = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
const arg = (k: string, d: string) => { const i = ARGV.indexOf(`--${k}`); return i >= 0 ? ARGV[i + 1] : d }
const seeds = arg('seeds', '1,7,42,1234').split(',').map(Number)
const YEARS = Number(arg('years', '2000'))
const AT = arg('at', '300,800,1500').split(',').map(Number)
const KINDS = arg('kinds', 'fortify,war,explore,settle').split(',')
const TRIVIAL = Number(arg('trivial', '8'))

const snapOf = (h: History, y: number) => Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval))
function largestTown(h: History, y: number): number {
  const N = h.settlements.length, s = snapOf(h, y)
  let best = -1
  for (let id = 0; id < N; id++) if (best < 0 || h.population[s * N + id] > h.population[s * N + best]) best = id
  return best
}
function chord(w: World, a: number, b: number): number {
  const P = w.grid.positions
  return Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2])
}
function polityPop(h: History, y: number): Float64Array {
  const N = h.settlements.length, s = snapOf(h, y), out = new Float64Array(h.polities.length)
  for (let id = 0; id < N; id++) { const p = h.polity[s * N + id]; if (p >= 0) out[p] += h.population[s * N + id] }
  return out
}
function capitalAt(h: History, p: number, y: number): number {
  const x = h.polities[p]
  let c = x.capitals[0]
  for (let k = 0; k < x.capitals.length; k++) if (x.capitalYears[k] <= y) c = x.capitals[k]
  return c
}
/** An order of `kind` at `y`, or null when the world gives no actor for it. */
function orderFor(w: World, h: History, kind: string, y: number): Order | null {
  const town = largestTown(h, y)
  if (kind === 'fortify') return { year: y, kind: OrderKind.Fortify, actor: town }
  const people = h.settlements[town].people
  const cell = h.settlements[town].cell
  if (kind === 'explore' || kind === 'settle') {
    // the land cell farthest from the town that the people does not know yet (explore) / knows (settle), 0.6 chord at most
    const C = w.grid.cellCount
    let best = -1, bd = -1
    for (let q = 0; q < C; q += 7) {
      if (w.elevation[q] < 0) continue
      const known = h.knownYear[people * C + q] >= 0 && h.knownYear[people * C + q] <= y
      if ((kind === 'explore') === known) continue
      const d = chord(w, cell, q)
      if (d <= 0.6 && d > bd) { bd = d; best = q }
    }
    return best >= 0 ? { year: y, kind: kind === 'explore' ? OrderKind.Explore : OrderKind.Settle, actor: people, target: best } : null
  }
  if (kind === 'war') {
    const pp = polityPop(h, y)
    let a = -1
    for (let p = 0; p < pp.length; p++) if (pp[p] > 0 && (a < 0 || pp[p] > pp[a])) a = p
    if (a < 0) return null
    const ca = h.settlements[capitalAt(h, a, y)].cell
    let b = -1, bd = Infinity
    for (let p = 0; p < pp.length; p++) {
      if (p === a || pp[p] <= 0) continue
      const d = chord(w, ca, h.settlements[capitalAt(h, p, y)].cell)
      if (d < bd) { bd = d; b = p }
    }
    return b >= 0 ? { year: y, kind: OrderKind.War, actor: a, target: b } : null
  }
  return null
}
/** K towns of 500-800 people at `y` farthest from any city-sized town: trivial Fortify actors. */
function trivialTowns(w: World, h: History, y: number, k: number): number[] {
  const N = h.settlements.length, s = snapOf(h, y)
  const big: number[] = [], small: number[] = []
  for (let id = 0; id < N; id++) {
    const v = h.population[s * N + id]
    if (v >= TOWN_POPULATION * 5) big.push(id)
    else if (v >= 500 && v <= 800) small.push(id)
  }
  const far = (id: number) => big.reduce((m, b) => Math.min(m, chord(w, h.settlements[id].cell, h.settlements[b].cell)), Infinity)
  return small.map((id) => [id, far(id)] as const).sort((a, b) => b[1] - a[1]).slice(0, k * 3).map((x) => x[0])
}

function compare(w: World, _A: History, fpA: HistoryFingerprint, order: Order) {
  const B = simulateHistory(w, { years: YEARS, orders: [order] })
  let t0 = performance.now()
  const fpB = fingerprintOf(B)
  const fpMs = performance.now() - t0
  t0 = performance.now()
  const d = diffFingerprints(fpA, fpB, w.grid.positions)
  const diffMs = performance.now() - t0
  const o = B.orderOutcomes![0]
  let bigB = 0, bigMatched = 0
  for (let p = 0; p < fpB.pPeak.length; p++) if (fpB.pPeak[p] >= 10_000) { bigB++; if (d.pMatch[p] >= 0) bigMatched++ }
  return { B, fpB, d, o, fpMs, diffMs, bigB, bigMatched }
}

const deltas: number[] = []
let agree = 0, total = 0
for (const seed of seeds) {
  const w = generateWorld(seed)
  let t0 = performance.now()
  const A = simulateHistory(w, { years: YEARS })
  const simMs = performance.now() - t0
  t0 = performance.now()
  const fpA = fingerprintOf(A)
  console.log(`seed ${seed}: run ${simMs.toFixed(0)} ms, fingerprint ${(performance.now() - t0).toFixed(1)} ms, ${(fingerprintBytes(fpA) / 1e6).toFixed(3)} MB, ${fpA.evCount} events`)
  const runs: Order[] = []
  for (const k of KINDS) for (const y of AT) { const o = orderFor(w, A, k, y); if (o) runs.push(o) }
  for (const order of runs) {
    const r = compare(w, A, fpA, order)
    const nothing = (r.o.status === OrderStatus.Failed || r.o.status === OrderStatus.Expired) && r.o.acted < 0
    const ok = nothing === (r.d.divergence < 0) && (r.d.divergence < 0 || r.d.divergence >= Math.max(1, order.year) - 1)
    total++
    if (ok) agree++
    console.log(`  ${Object.keys(OrderKind).find((k) => OrderKind[k as keyof typeof OrderKind] === order.kind) ?? order.kind}@${order.year}`.padEnd(22) +
      ` status ${r.o.status} reason ${r.o.reason} acted ${r.o.acted} | divergence ${r.d.divergence} parting ${partingYear(r.d)} | prefix ${r.d.prefix}/${A.settlements.length} | big polities matched ${r.bigMatched}/${r.bigB} | fp ${r.fpMs.toFixed(1)} ms diff ${r.diffMs.toFixed(1)} ms${ok ? '' : '  DISAGREE'}`)
  }
  // ---- noise floor: trivial orders ----
  let done = 0
  for (const id of trivialTowns(w, A, 800, TRIVIAL)) {
    if (done >= TRIVIAL) break
    const r = compare(w, A, fpA, { year: 800, kind: OrderKind.Fortify, actor: id })
    if (r.o.status !== OrderStatus.Fulfilled || r.d.divergence < 0) continue
    done++
    const K = fpA.checkYears.length - 1, P = fpA.peoples
    const ds: number[] = []
    for (let p = 0; p < P; p++) {
      const a = fpA.peoplePop[K * P + p], b = r.fpB.peoplePop[K * P + p]
      if (a > 1000 && b > 1000) ds.push(Math.abs(Math.log(b / a)))
    }
    deltas.push(...ds)
    console.log(`  trivial fortify ${id}: divergence ${r.d.divergence} parting ${partingYear(r.d)} |ln r| median ${median(ds).toFixed(3)} max ${Math.max(...ds).toFixed(3)}`)
  }
}
function median(a: number[]) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN }
const q = (a: number[], f: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN }
console.log(`divergence agreement ${agree}/${total}`)
console.log(`noise floor over ${deltas.length} people-runs: |ln(popB/popA)| p50 ${q(deltas, 0.5).toFixed(3)} p90 ${q(deltas, 0.9).toFixed(3)} (rho)`)
