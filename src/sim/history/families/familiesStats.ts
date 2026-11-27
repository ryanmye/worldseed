// families: stats harness (merchant-families.md §6). Run with
//   node --experimental-strip-types --no-warnings src/sim/history/families/familiesStats.ts [--years N] [--check-off] [--finance] [seed ...]
// (default seeds 1 7 42 1234, 2000 years). Families on (and finance with --finance); --check-off also runs them off and checks that
// every other History field is the same (the pure-layer guarantee).

import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import { EventType, FamilyEnd, LegKind, WarKind } from '../../../contract.ts'
import { FAMILY } from './params.ts'
import type { History, HistoryOptions } from '../../../contract.ts'
import { hashValue } from '../../../historyCache.ts'

const ENDS = ['Alive', 'Bankrupt', 'Faded', 'NoHeir', 'TownLost']
const RUINS = ['None', 'Fleet', 'Venture', 'Default', 'War', 'Plague']

function q(xs: number[], p: number): number {
  if (xs.length === 0) return NaN
  const a = xs.slice().sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor(p * a.length))]
}

/** Every History key but families and events, hashed one by one (the pure-layer check). */
export function offDiff(a: History, b: History): string[] {
  const out: string[] = []
  const ka = Object.keys(a).filter((k) => k !== 'families' && k !== 'events')
  for (const k of ka) if (hashValue((a as unknown as Record<string, unknown>)[k]) !== hashValue((b as unknown as Record<string, unknown>)[k])) out.push(k)
  const ea = a.events.filter((e) => e.type < EventType.FamilyFounded || e.type > EventType.FamilyFell)
  if (hashValue(ea) !== hashValue(b.events)) out.push('events')
  return out
}

/** Live families at year y (founded <= y and not ended by y). */
function liveAt(h: History, y: number): number {
  const F = h.families
  let n = 0
  for (let f = 0; f < F.count; f++) if (F.founded[f] <= y && (F.ended[f] < 0 || F.ended[f] > y)) n++
  return n
}

export function familyReport(h: History, ms: number): Record<string, number | string> {
  const F = h.families
  const r: Record<string, number | string> = {}
  r.families = F.count
  let first = -1
  for (let f = 0; f < F.count; f++) if (first < 0 || F.founded[f] < first) first = F.founded[f]
  r.first = first
  r.live = [500, 1000, 1500, 2000].map((y) => liveAt(h, y)).join('/')
  const life: number[] = []
  const end = [0, 0, 0, 0, 0], ruin = [0, 0, 0, 0, 0, 0]
  for (let f = 0; f < F.count; f++) {
    if (F.ended[f] >= 0) life.push(F.ended[f] - F.founded[f])
    end[F.end[f]]++
    if (F.end[f] === FamilyEnd.Bankrupt) ruin[F.ruin[f]]++
  }
  r.life = `${q(life, 0.5)}/${q(life, 0.9)}/${life.length ? Math.max(...life) : NaN}`
  const ended = life.length || 1
  r.ends = [1, 2, 3, 4].map((k) => `${ENDS[k]} ${Math.round((100 * end[k]) / ended)}%`).join(' ')
  r.ruins = [1, 2, 3, 4, 5].map((k) => `${RUINS[k]} ${ruin[k]}`).join(' ')
  // heads
  const heads = new Array<number>(F.count).fill(0)
  const ten: number[] = []
  for (let k = 0; k < F.headCount; k++) { heads[F.headFamily[k]]++; if (F.headTo[k] >= 0) ten.push(F.headTo[k] - F.headFrom[k]) }
  r.headsPer = (heads.reduce((a, b) => a + b, 0) / (F.count || 1)).toFixed(1)
  r.tenure = (ten.reduce((a, b) => a + b, 0) / (ten.length || 1)).toFixed(1)
  let splits = 0, venture = 0, nonMart = 0
  for (let f = 0; f < F.count; f++) { if (F.parent[f] >= 0) splits++; if (F.cause[f] === 1) venture++ }
  r.splits = splits
  r.venture = venture
  void nonMart
  r.marriages = F.marriageCount
  // backings: share of civil wars after 1000 with a backer
  let civ = 0, backed = 0
  const bw = new Set<number>(F.backWar)
  for (let w = 0; w < h.wars.count; w++) if (h.wars.kind[w] === WarKind.CivilWar && h.wars.startYear[w] >= 1000) { civ++; if (bw.has(w)) backed++ }
  r.backed = `${backed}/${civ}`
  // emigrations
  let mm = 0, fm = 0
  for (const e of h.events) {
    if (e.type === EventType.MerchantsMoved) {
      let home = false
      for (let k = 0; k < F.seatCount && !home; k++) if (F.seatTown[k] === e.settlement && F.seatKind[k] === 0 && F.seatFrom[k] <= e.year && (F.seatTo[k] < 0 || F.seatTo[k] >= e.year)) home = true
      if (home) mm++
    }
    if (e.type === EventType.FamilyMoved && e.extra === 0) fm++
  }
  r.emigr = `${fm}/${mm}`
  // capital at the last snapshot
  const Q = h.snapshotCount - 1, S = h.settlements.length
  let famCap = 0, top = 0
  for (let i = F.famSnapOffsets[Q]; i < F.famSnapOffsets[Q + 1]; i++) { famCap += F.famSnapCapital[i]; if (F.famSnapCapital[i] > top) top = F.famSnapCapital[i] }
  let mwAll = 0
  for (let t = 0; t < S; t++) mwAll += h.merchantWealth[Q * S + t]
  r.topShare = famCap > 0 ? (top / famCap).toFixed(2) : '-'
  r.famShare = mwAll > 0 ? (famCap / mwAll).toFixed(2) : '-'
  // factors per live family at the end; invariant (seat capital at a town <= merchant capital)
  const per = new Map<number, number>()
  let breach = 0
  const atTown = new Float64Array(S)
  for (let i = F.seatSnapOffsets[Q]; i < F.seatSnapOffsets[Q + 1]; i++) {
    const k = F.seatSnapSeat[i]
    per.set(F.seatFamily[k], (per.get(F.seatFamily[k]) ?? 0) + 1)
    atTown[F.seatTown[k]] += F.seatSnapCapital[i]
  }
  for (let t = 0; t < S; t++) if (atTown[t] > 0.9 * h.merchantWealth[Q * S + t] * (1 + 1e-4) + 1e-3) breach++
  const ps = [...per.values()].map((x) => x - 1)
  r.factors = ps.length ? `${(ps.reduce((a, b) => a + b, 0) / ps.length).toFixed(1)}/${Math.max(...ps)}` : '-'
  r.breaches = breach
  // lanes with an owner at the end
  const open = new Set<number>()
  for (let k = 0; k < h.longHaul.count; k++) if (h.longHaul.kind[k] === LegKind.Lane && h.longHaul.closedYear[k] < 0) open.add(k)
  let owned = 0
  for (let k = 0; k < F.laneCount; k++) if (F.laneTo[k] < 0 && open.has(F.laneLeg[k])) owned++
  r.lanesOwned = `${owned}/${open.size}`
  r.ms = Math.round(ms)
  return r
}

function topHouses(h: History, y: number): string[] {
  const F = h.families
  const q = Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval))
  const rows: [number, number][] = []
  for (let i = F.famSnapOffsets[q]; i < F.famSnapOffsets[q + 1]; i++) rows.push([F.famSnapFamily[i], F.famSnapCapital[i]])
  rows.sort((a, b) => b[1] - a[1])
  return rows.slice(0, 5).map(([f, c]) => {
    let fac = 0
    for (let k = 0; k < F.seatCount; k++) if (F.seatFamily[k] === f && F.seatKind[k] === 1 && F.seatFrom[k] <= y && (F.seatTo[k] < 0 || F.seatTo[k] > y)) fac++
    let mar = 0
    for (let m = 0; m < F.marriageCount; m++) if (F.marriageFamily[m] === f) mar++
    return `${F.name[f]} of ${h.settlements[F.firstHome[f]].name} (${F.founded[f]}) ${Math.round(c)} f${fac} m${mar}`
  })
}

const argv0: string[] = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
if (argv0.length > 1 && import.meta.url === `file://${argv0[1]}`) {
  const args = argv0.slice(2)
  let years = 2000, checkOff = false, finance = false
  const seeds: number[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--years') years = Number(args[++i])
    else if (args[i] === '--check-off') checkOff = true
    else if (args[i] === '--finance') finance = true
    else if (args[i] === '--set') { const [k, v] = args[++i].split('='); (FAMILY as unknown as Record<string, number | boolean>)[k] = v === 'true' ? true : v === 'false' ? false : Number(v) }
    else seeds.push(Number(args[i]))
  }
  if (seeds.length === 0) seeds.push(1, 7, 42, 1234)
  for (const seed of seeds) {
    const w = generateWorld(seed)
    const opt: HistoryOptions = { years, families: true, ...(finance ? { finance: true } : {}) }
    const t0 = performance.now()
    const run = runHistory(w, opt)
    const t1 = performance.now()
    const r = familyReport(run.history, t1 - t0)
    const d = run.diag.families
    console.log(`seed ${seed}:`, JSON.stringify(r), d ? `famMs ${Math.round(d.ms)} capHits ${d.capHits} nonMart ${d.nonMart} branches ${d.branches}` : '')
    for (const y of [1500, 2000]) if (y <= years) console.log(`  top ${y}:`, topHouses(run.history, y).join(' | '))
    if (checkOff) {
      const off = runHistory(w, { ...opt, families: false }).history
      const diff = offDiff(run.history, off)
      console.log(`  pure-layer: ${diff.length === 0 ? 'OK' : 'DIFF ' + diff.join(',')}`)
    }
  }
}
