// ideas: stats harness for the ideas system. Per seed: who conceived what and when (and how many independent origins), the
// ideas per people at 1000/1500/2000, the share of adoptions by transmission path, the technology gap between contact networks
// and the population surge of the poorer side after two networks of different cradles meet, how much of what each people holds
// it conceived itself, lost and resisted ideas, and whether well-connected trading peoples hold more ideas earlier. Aggregates
// over the seeds: adoption curves per idea, path shares, the targets. --off also runs each world with ideas off for the same
// figures (the gap and the surge before). --detail prints per seed the conceptions in order and the journeys of three ideas.
//   node src/sim/history/ideas/ideasStats.ts [--off] [--detail] [--json] [--years N] seeds...
//   node src/sim/history/ideas/ideasStats.ts --merge rows1.json rows2.json ...   (the table of shards written with --json)

import { EventType, IdeaHow, IdeaLoss, IdeaResist } from '../../../contract.ts'
import type { History } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import { HISTORY_STATS_SEEDS } from '../stats.ts'
import { IDEA_DEFS } from './params.ts'

const AT = [500, 1000, 1500, 2000]
const HOW = ['Invented', 'Contact', 'Neighbours', 'Trade', 'Lane', 'Post', 'Migration', 'Conquest', 'Empire', 'Pilgrims', 'Visitors', 'Marriage', 'Theft', 'Lost']

export interface Join {
  year: number
  /** Population of the poorer side at contact; the two sides' best mean technology then; their ratio. */
  pop: number
  poorT: number
  richT: number
  /** Poorer side's population 200 years on over its pre-contact trend (the century before, extrapolated), and over the richer side's growth. */
  surge: number
  vsRich: number
  /** Ideas the richer side held that the poorer side lacked at contact, and of them held by the poorer side 100 and 200 years on. */
  missing: number
  got100: number
  got200: number
}

export interface IdeasRow {
  seed: number
  years: number
  ms: number
  peoples: number
  /** Gap (best / worst network's best mean technology - 1) per AT year among networks of at least 1000 people (NaN with one). */
  gap: number[]
  networks: number[]
  joins: Join[]
  /** World population at AT years. */
  pop: number[]
  /** Ideas held per people at AT years (median, min, max over living peoples). */
  heldMed: number[]
  heldMin: number[]
  heldMax: number[]
  /** Ideas conceived by anyone by the end, all conceptions, independent second (or later) origins. */
  conceived: number
  conceptions: number
  independent: number
  /** Largest share of the ideas a people holds at the end that it conceived itself (peoples holding >= 5), and the median share. */
  maxOwn: number
  medOwn: number
  /** Adoptions per IdeaHow (Lost: losses). */
  how: number[]
  /** Losses per IdeaLoss, refusals per IdeaResist. */
  lost: number[]
  resisted: number[]
  /** Median ideas held at 1000 / 1500 by the best-connected and the least-connected third of peoples (by trade volume per head). */
  connected: number[]
  isolated: number[]
  /** Per idea: first year (-1), origins, holders' share of living peoples at AT years. */
  ideaFirst: number[]
  ideaOrigins: number[]
  ideaShare: number[][]
  /** Mean technology of the median and best people at 2000 (between-world spread). */
  techMed: number
  techMax: number
  /** The same figures with ideas off (NaN without --off). */
  gapOff: number[]
  joinsOff: Join[]
  popOff: number[]
  detail: string[]
}

const med = (x: number[]): number => { const a = x.filter((v) => Number.isFinite(v)).sort((p, q) => p - q); if (!a.length) return NaN; return a.length % 2 ? a[a.length >> 1] : 0.5 * (a[a.length / 2 - 1] + a[a.length / 2]) }

/** Contact networks (label: smallest member) as of `year`. */
function networks(h: History, year: number): Int32Array {
  const P = h.peoples.length
  const lab = new Int32Array(P)
  for (let p = 0; p < P; p++) lab[p] = p
  const find = (x: number): number => { while (lab[x] !== x) x = lab[x]; return x }
  for (let a = 0; a < P; a++) for (let b = a + 1; b < P; b++) {
    const y = h.contactYear[a * P + b]
    if (y < 0 || y > year) continue
    const ra = find(a), rb = find(b)
    if (ra !== rb) { if (ra < rb) lab[rb] = ra; else lab[ra] = rb }
  }
  for (let p = 0; p < P; p++) lab[p] = find(p)
  return lab
}

const meanTech = (h: History, q: number, p: number): number => { let t = 0; for (let f = 0; f < 4; f++) t += h.technology[(q * h.peoples.length + p) * 4 + f]; return t / 4 }
function popPeople(h: History, q: number): Float64Array {
  const P = h.peoples.length, S = h.settlements.length
  const out = new Float64Array(P)
  for (let i = 0; i < S; i++) out[h.settlements[i].people] += h.population[q * S + i]
  return out
}

/** Ideas held per people at `year` (flat [p * I + i]). */
function heldAt(h: History, year: number): Uint8Array {
  const P = h.peoples.length, I = h.ideas.length, A = h.ideaAdoptions
  const held = new Uint8Array(P * I)
  if (I === 0) return held
  for (let k = 0; k < A.count && A.year[k] <= year; k++) held[A.people[k] * I + A.idea[k]] = A.how[k] === IdeaHow.Lost ? 0 : 1
  return held
}

function gapsAndJoins(h: History): { gap: number[]; nets: number[]; joins: Join[] } {
  const P = h.peoples.length, I = h.ideas.length
  const gap: number[] = [], nets: number[] = []
  for (const y of AT) {
    if (y > h.years) { gap.push(NaN); nets.push(0); continue }
    const q = Math.floor(y / h.snapshotInterval)
    const lab = networks(h, y)
    const pp = popPeople(h, q)
    const best = new Map<number, number>(), np = new Map<number, number>() // (lookup only)
    for (let p = 0; p < P; p++) { const v = meanTech(h, q, p); if (!(v > 0)) continue; const n = lab[p]; if (!best.has(n) || v > best.get(n)!) best.set(n, v); np.set(n, (np.get(n) ?? 0) + pp[p]) }
    const vs = [...best.entries()].filter(([n]) => (np.get(n) ?? 0) >= 1000).map(([, v]) => v)
    nets.push(vs.length)
    gap.push(vs.length >= 2 ? Math.max(...vs) / Math.min(...vs) - 1 : NaN)
  }
  const joins: Join[] = []
  const done = new Set<string>()
  for (const e of h.events) {
    if (e.type !== EventType.FirstContact) continue
    const y = e.year
    if (y < 100 || y + 200 > h.years) continue
    const a = h.settlements[e.settlement].people, b = h.settlements[e.other].people
    if (h.peoples[a].cradle === h.peoples[b].cradle) continue
    const before = networks(h, y - 1)
    const na = before[a], nb = before[b]
    if (na === nb) continue
    const key = Math.min(na, nb) + ':' + Math.max(na, nb) + ':' + y
    if (done.has(key)) continue
    done.add(key)
    const I0 = h.snapshotInterval
    const q0 = Math.round(y / I0), q1 = Math.round((y - 100) / I0), q2 = Math.round((y + 200) / I0)
    const side = (n: number): number[] => { const m: number[] = []; for (let p = 0; p < P; p++) if (before[p] === n) m.push(p); return m }
    const A = side(na), B = side(nb)
    const bestT = (m: number[]): number => Math.max(...m.map((p) => meanTech(h, q0, p)))
    const P0 = popPeople(h, q0), P1 = popPeople(h, q1), P2 = popPeople(h, q2)
    const sum = (m: number[], x: Float64Array): number => m.reduce((t, p) => t + x[p], 0)
    const [poor, rich] = bestT(A) < bestT(B) ? [A, B] : [B, A]
    const now = sum(poor, P0), pre = sum(poor, P1), aft = sum(poor, P2)
    if (now < 500 || pre <= 0) continue
    const g = now / pre
    const rnow = sum(rich, P0), raft = sum(rich, P2)
    let missing = 0, got100 = 0, got200 = 0
    if (I > 0) {
      const H0 = heldAt(h, y), H1 = heldAt(h, y + 100), H2 = heldAt(h, y + 200)
      const any = (H: Uint8Array, m: number[], i: number): boolean => m.some((p) => H[p * I + i] === 1)
      for (let i = 0; i < I; i++) if (any(H0, rich, i) && !any(H0, poor, i)) { missing++; if (any(H1, poor, i)) got100++; if (any(H2, poor, i)) got200++ }
    }
    joins.push({ year: y, pop: now, poorT: bestT(poor), richT: bestT(rich), surge: aft / (now * g * g), vsRich: rnow > 0 ? (aft / now) / (raft / rnow) : NaN, missing, got100, got200 })
  }
  return { gap, nets, joins }
}

/** The journey of idea i: its origins and every adoption, loss and refusal, in order. */
function journey(h: History, i: number): string {
  const A = h.ideaAdoptions
  const pn = (p: number): string => h.peoples[p].name
  const sn = (s: number): string => (s >= 0 ? h.settlements[s].name : '?')
  const L: string[] = [`  ${h.ideas[i].name} (${h.ideas[i].key}): ${h.ideas[i].origins} origin(s)`]
  for (let k = 0; k < A.count; k++) {
    if (A.idea[k] !== i) continue
    const how = A.how[k]
    if (how === IdeaHow.Invented) L.push(`    ${A.year[k]} conceived by the ${pn(A.people[k])} at ${sn(A.via[k])}`)
    else if (how === IdeaHow.Lost) L.push(`    ${A.year[k]} lost by the ${pn(A.people[k])}`)
    else L.push(`    ${A.year[k]} the ${pn(A.people[k])} at ${sn(A.via[k])}, by ${HOW[how]}, from the ${pn(A.from[k])} (${sn(A.source[k])})`)
  }
  for (const e of h.events) if (e.type === EventType.IdeaResisted && e.value === i) L.push(`    ${e.year} refused by the ${pn(h.settlements[e.settlement].people)} at ${sn(e.settlement)} (${['faith', 'ruler', 'guilds'][e.extra ?? 0]})`)
  return L.join('\n')
}

export function ideasSeedStats(seed: number, years: number, off: boolean, detail: boolean): IdeasRow {
  const w = generateWorld(seed)
  const t0 = performance.now()
  const h = runHistory(w, { years }).history
  const ms = performance.now() - t0
  const P = h.peoples.length, I = h.ideas.length, S = h.settlements.length, A = h.ideaAdoptions
  const { gap, nets, joins } = gapsAndJoins(h)
  const pop = AT.map((y) => (y > years ? NaN : popPeople(h, Math.floor(y / h.snapshotInterval)).reduce((a, b) => a + b, 0)))
  const heldMed: number[] = [], heldMin: number[] = [], heldMax: number[] = []
  const ideaShare: number[][] = h.ideas.map(() => [])
  for (const y of AT) {
    if (y > years) { heldMed.push(NaN); heldMin.push(NaN); heldMax.push(NaN); for (const x of ideaShare) x.push(NaN); continue }
    const H = heldAt(h, y)
    const pp = popPeople(h, Math.floor(y / h.snapshotInterval))
    const counts: number[] = []
    let alive = 0
    for (let p = 0; p < P; p++) { if (!(pp[p] > 0)) continue; alive++; let n = 0; for (let i = 0; i < I; i++) n += H[p * I + i]; counts.push(n) }
    heldMed.push(med(counts)); heldMin.push(Math.min(...counts)); heldMax.push(Math.max(...counts))
    for (let i = 0; i < I; i++) { let n = 0; for (let p = 0; p < P; p++) if (pp[p] > 0) n += H[p * I + i]; ideaShare[i].push(alive > 0 ? n / alive : 0) }
  }
  // Origin shares at the end.
  const Hend = heldAt(h, years)
  const own = new Int32Array(P)
  for (let k = 0; k < A.count; k++) if (A.how[k] === IdeaHow.Invented && Hend[A.people[k] * I + A.idea[k]]) own[A.people[k]]++
  const shares: number[] = []
  for (let p = 0; p < P; p++) { let n = 0; for (let i = 0; i < I; i++) n += Hend[p * I + i]; if (n >= 5) shares.push(own[p] / n) }
  const how = new Array<number>(HOW.length).fill(0)
  for (let k = 0; k < A.count; k++) how[A.how[k]]++
  const lost = [0, 0, 0], resisted = [0, 0, 0]
  for (const e of h.events) { if (e.type === EventType.IdeaLost) lost[e.extra ?? 0]++; else if (e.type === EventType.IdeaResisted) resisted[e.extra ?? 0]++ }
  // Connected vs isolated: trade volume per head on the routes touching each people's settlements at the trade snapshot.
  const connected: number[] = [], isolated: number[] = []
  for (const y of [1000, 1500]) {
    if (y > years) { connected.push(NaN); isolated.push(NaN); continue }
    const tq = Math.floor(y / h.tradeInterval), RC = h.trade.count
    const vol = new Float64Array(P)
    for (let r = 0; r < RC; r++) { const v = h.tradeVolume[tq * RC + r]; if (!(v > 0)) continue; vol[h.settlements[h.trade.a[r]].people] += v; vol[h.settlements[h.trade.b[r]].people] += v }
    const pp = popPeople(h, Math.floor(y / h.snapshotInterval))
    const H = heldAt(h, y)
    const ps: [number, number][] = []
    for (let p = 0; p < P; p++) { if (!(pp[p] > 0)) continue; let n = 0; for (let i = 0; i < I; i++) n += H[p * I + i]; ps.push([vol[p] / pp[p], n]) }
    ps.sort((a, b) => a[0] - b[0])
    const third = Math.max(1, Math.floor(ps.length / 3))
    isolated.push(med(ps.slice(0, third).map((x) => x[1])))
    connected.push(med(ps.slice(ps.length - third).map((x) => x[1])))
  }
  const q2 = Math.floor(Math.min(2000, years) / h.snapshotInterval)
  const mt: number[] = []
  for (let p = 0; p < P; p++) { const v = meanTech(h, q2, p); if (v > 0) mt.push(v) }
  let gapOff: number[] = AT.map(() => NaN), joinsOff: Join[] = [], popOff: number[] = AT.map(() => NaN)
  if (off) {
    const ho = runHistory(w, { years, ideas: false }).history
    const r = gapsAndJoins(ho)
    gapOff = r.gap; joinsOff = r.joins
    popOff = AT.map((y) => (y > years ? NaN : popPeople(ho, Math.floor(y / ho.snapshotInterval)).reduce((a, b) => a + b, 0)))
  }
  const out: string[] = []
  if (detail) {
    out.push(`seed ${seed}: ${P} peoples in ${new Set(h.peoples.map((p) => p.cradle)).size} cradles; conceptions in order:`)
    for (let k = 0; k < A.count; k++) if (A.how[k] === IdeaHow.Invented) out.push(`  ${A.year[k]} ${h.ideas[A.idea[k]].name} by the ${h.peoples[A.people[k]].name} (cradle ${h.peoples[A.people[k]].cradle}) at ${h.settlements[A.via[k]].name}${h.ideas[A.idea[k]].firstYear < A.year[k] ? ' (independent)' : ''}`)
    out.push('ideas held per people at 500/1000/1500/2000 (own at the end):')
    const HA = AT.map((y) => heldAt(h, y))
    for (let p = 0; p < P; p++) out.push(`  ${h.peoples[p].name} (cradle ${h.peoples[p].cradle}): ${HA.map((H) => { let n = 0; for (let i = 0; i < I; i++) n += H[p * I + i]; return n }).join('/')} own ${own[p]}`)
    out.push('journeys:')
    for (const key of ['writing', 'iron', 'printing']) { const i = h.ideas.findIndex((d) => d.key === key); if (i >= 0) out.push(journey(h, i)) }
    out.push(`network joins: ${joins.map((j) => `${j.year} T${j.poorT.toFixed(2)}/${j.richT.toFixed(2)} surge x${j.surge.toFixed(2)} missing ${j.missing} got ${j.got100}/${j.got200}`).join('; ')}`)
    void S
  }
  return {
    seed, years, ms, peoples: P, gap, networks: nets, joins, pop, heldMed, heldMin, heldMax,
    conceived: h.ideas.filter((d) => d.firstYear >= 0).length, conceptions: how[IdeaHow.Invented], independent: h.ideas.reduce((a, d) => a + Math.max(0, d.origins - 1), 0),
    maxOwn: shares.length ? Math.max(...shares) : NaN, medOwn: med(shares), how, lost, resisted, connected, isolated,
    ideaFirst: h.ideas.map((d) => d.firstYear), ideaOrigins: h.ideas.map((d) => d.origins), ideaShare,
    techMed: med(mt), techMax: Math.max(...mt), gapOff, joinsOff, popOff, detail: out,
  }
}

const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '-')
const pc = (x: number): string => (Number.isFinite(x) ? (100 * x).toFixed(0) + '%' : '-')
const rng = (xs: number[], f: (x: number) => string): string => { const a = xs.filter((v) => Number.isFinite(v)); return a.length ? `${f(med(a))} [${f(Math.min(...a))}..${f(Math.max(...a))}]` : '-' }

export function ideasTable(rows: IdeasRow[]): string {
  const L: string[] = []
  L.push('per seed: peoples; gap between networks at 500/1000/1500 (networks); ideas held per people med[min-max] at 1000/1500/2000; conceived ideas, conceptions, independent; max/median own share; lost; resisted; surge of joins (>= 900)')
  for (const r of rows) {
    const late = r.joins.filter((j) => j.year >= 900)
    L.push(`  seed ${r.seed} P${r.peoples} ${(r.ms / 1000).toFixed(1)}s gap ${[0, 1, 2].map((k) => `${pc(r.gap[k])}(${r.networks[k]})`).join('/')} held ${[1, 2, 3].map((k) => `${r.heldMed[k]}[${r.heldMin[k]}-${r.heldMax[k]}]`).join('/')} ideas ${r.conceived} conc ${r.conceptions} indep ${r.independent} own ${f2(r.maxOwn)}/${f2(r.medOwn)} lost ${r.lost.join(',')} resisted ${r.resisted.join(',')} surge ${late.map((j) => 'x' + f2(j.surge)).join(' ') || '-'}${Number.isFinite(r.gapOff[1]) ? ` | off gap ${[0, 1, 2].map((k) => pc(r.gapOff[k])).join('/')}` : ''}`)
  }
  const all = rows.flatMap((r) => r.joins), late = all.filter((j) => j.year >= 900)
  L.push(`targets over ${rows.length} seeds:`)
  L.push(`  gap at 500/1000/1500 (seeds with >= 2 networks): ${[0, 1, 2].map((k) => `${pc(med(rows.map((r) => r.gap[k])))} (${rows.filter((r) => Number.isFinite(r.gap[k])).length})`).join(' / ')}`)
  L.push(`  cradle network joins ${all.length}: tech ratio at contact ${rng(all.map((j) => j.richT / j.poorT), f2)}; poorer side's population 200 y on vs its trend: all ${rng(all.map((j) => j.surge), f2)}, joins >= 900 ${rng(late.map((j) => j.surge), f2)} (${late.length}), ratio >= 1.2 ${f2(med(all.filter((j) => j.richT / j.poorT >= 1.2).map((j) => j.surge)))}; vs the richer side ${f2(med(all.map((j) => j.vsRich)))}`)
  const mi = all.reduce((a, j) => a + j.missing, 0)
  L.push(`  ideas the poorer side lacked at contact ${mi}, of them held 100 / 200 years on ${pc(all.reduce((a, j) => a + j.got100, 0) / Math.max(1, mi))} / ${pc(all.reduce((a, j) => a + j.got200, 0) / Math.max(1, mi))}`)
  L.push(`  largest share of its ideas a people conceived itself ${rng(rows.map((r) => r.maxOwn), f2)}; median people ${f2(med(rows.map((r) => r.medOwn)))}`)
  const how = HOW.map((_, i) => rows.reduce((a, r) => a + r.how[i], 0))
  const tot = how.slice(1, IdeaHow.Lost).reduce((a, b) => a + b, 0)
  L.push(`  adoptions ${tot} by path: ${HOW.slice(1, IdeaHow.Lost).map((n, i) => `${n} ${pc(how[i + 1] / tot)}`).join(', ')}; conceptions ${how[0]} (independent ${rows.reduce((a, r) => a + r.independent, 0)}), losses ${how[IdeaHow.Lost]}`)
  L.push(`  losses by cause (isolated/collapse/prerequisite) ${[IdeaLoss.Isolated, IdeaLoss.Collapse, IdeaLoss.Prerequisite].map((c) => rows.reduce((a, r) => a + r.lost[c], 0)).join('/')}; refusals (faith/ruler/guild) ${[IdeaResist.Faith, IdeaResist.Ruler, IdeaResist.Guild].map((c) => rows.reduce((a, r) => a + r.resisted[c], 0)).join('/')}`)
  L.push(`  ideas held per people at 500/1000/1500/2000: median ${[0, 1, 2, 3].map((k) => f2(med(rows.map((r) => r.heldMed[k])))).join('/')}, least ${[0, 1, 2, 3].map((k) => f2(med(rows.map((r) => r.heldMin[k])))).join('/')}, most ${[0, 1, 2, 3].map((k) => f2(med(rows.map((r) => r.heldMax[k])))).join('/')}`)
  L.push(`  best-connected vs least-connected third of peoples (trade per head), ideas held at 1000 / 1500: ${f2(med(rows.map((r) => r.connected[0])))} vs ${f2(med(rows.map((r) => r.isolated[0])))} / ${f2(med(rows.map((r) => r.connected[1])))} vs ${f2(med(rows.map((r) => r.isolated[1])))}`)
  L.push(`  world population at 500/1000/1500/2000 ${[0, 1, 2, 3].map((k) => rng(rows.map((r) => r.pop[k]), (x) => (x / 1000).toFixed(0) + 'k')).join(' / ')}; mean technology at 2000 of the median people ${rng(rows.map((r) => r.techMed), f2)}, of the best ${rng(rows.map((r) => r.techMax), f2)}`)
  if (rows.some((r) => Number.isFinite(r.gapOff[1]))) {
    const ao = rows.flatMap((r) => r.joinsOff), lo = ao.filter((j) => j.year >= 900)
    L.push(`  with ideas off: gap ${[0, 1, 2].map((k) => pc(med(rows.map((r) => r.gapOff[k])))).join(' / ')}; surge all ${f2(med(ao.map((j) => j.surge)))}, >= 900 ${f2(med(lo.map((j) => j.surge)))}; population ${[0, 1, 2, 3].map((k) => (med(rows.map((r) => r.popOff[k])) / 1000).toFixed(0) + 'k').join('/')}`)
  }
  L.push('per idea: first conceived (median year over the worlds that did; worlds), origins per world, share of living peoples holding it at 500/1000/1500/2000')
  const n = rows.length
  rows[0].ideaFirst.forEach((_, i) => {
    const fy = rows.map((r) => r.ideaFirst[i]).filter((y) => y >= 0)
    L.push(`  ${String(i).padStart(2)} ${IDEA_DEFS[i].key.padEnd(14)} first ${Number.isFinite(med(fy)) ? med(fy).toFixed(0) : '-'} (${fy.length}/${n}) origins ${(rows.reduce((a, r) => a + r.ideaOrigins[i], 0) / n).toFixed(1)} held ${[0, 1, 2, 3].map((k) => pc(rows.reduce((a, r) => a + (r.ideaShare[i][k] || 0), 0) / n)).join('/')}`)
  })
  for (const r of rows) if (r.detail.length) L.push(...r.detail)
  return L.join('\n')
}

if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) {
  const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
  const args = argv.slice(2)
  const off = args.includes('--off'), json = args.includes('--json'), detail = args.includes('--detail')
  const yi = args.indexOf('--years')
  const years = yi >= 0 ? Number(args[yi + 1]) : 2000
  const seeds = args.filter((a: string, i: number) => !a.startsWith('--') && (yi < 0 || i !== yi + 1) && !args.includes('--merge')).map(Number)
  const use = seeds.length ? seeds : HISTORY_STATS_SEEDS
  const mi = args.indexOf('--merge')
  let rows: IdeasRow[]
  if (mi >= 0) {
    // (--merge files...: the table of rows written with --json, one file per shard)
    const fs = (await import('node:' + 'fs')) as { readFileSync: (p: string, e: string) => string }
    rows = args.slice(mi + 1).flatMap((f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as IdeasRow[])
  } else rows = use.map((s: number) => ideasSeedStats(s, years, off, detail))
  if (json) console.log(JSON.stringify(rows))
  else console.log(ideasTable(rows))
}
