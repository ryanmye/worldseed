// grudges and oaths: the stats harness (grudges-and-oaths.md §2, §4 step 0, §5). Not shipped in tests.
// Run: node --experimental-strip-types src/sim/history/polity/oathStats.ts [--oaths] [--balance] [--arms] [--years N] seeds...
// Prints one JSON line per seed: the baseline columns of §2 (wars, alliances, joined wars, revenge-like wars, hegemony and
// coalitions) and the grudges measures (betrayals, broken truces, revenge wars, grievances, delta, bandwagons, arms races).

import { BondEnd, BondKind, EventType, WarKind, WarOutcome } from '../../../contract.ts'
import type { History } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'

const argv: string[] = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
const flag = (k: string) => argv.includes(k)
let years = 2000
const yi = argv.indexOf('--years')
if (yi >= 0) years = Number(argv[yi + 1])
const seeds = argv.filter((x, i) => /^\d+$/.test(x) && argv[i - 1] !== '--years').map(Number)
const opts = { years, oaths: flag('--oaths'), balance: flag('--balance'), arms: flag('--arms') }

function quantile(a: number[], q: number): number {
  if (a.length === 0) return 0
  const b = a.slice().sort((x, y) => x - y)
  return b[Math.min(b.length - 1, Math.floor(q * b.length))]
}

/** Population of each polity at snapshot q (from the membership matrix). */
function popsAt(h: History, q: number): Float64Array {
  const S = h.settlements.length, P = h.polities.length
  const out = new Float64Array(P)
  for (let i = 0; i < S; i++) { const p = h.polity[q * S + i]; if (p >= 0) out[p] += h.population[q * S + i] }
  return out
}

function stats(seed: number): Record<string, unknown> {
  const t0 = Date.now()
  const { history: h, diag } = runHistory(generateWorld(seed), opts)
  const ms = Date.now() - t0
  const W = h.wars
  let conquest = 0, civil = 0, revenge = 0, joined = 0, raceWars = 0
  for (let w = 0; w < W.count; w++) {
    if (W.kind[w] === WarKind.CivilWar) { civil++; continue }
    conquest++
    if (W.cause[w] >= 0) revenge++
    if (W.ally[w] >= 0) joined++
    if (W.race[w] >= 0) raceWars++
  }
  // Revenge-like (heuristic of §2): q attacks p within 100 years of a war p won against q.
  let revengeLike = 0
  for (let w = 0; w < W.count; w++) {
    if (W.kind[w] !== WarKind.Conquest) continue
    for (let v = 0; v < w; v++) {
      if (W.kind[v] !== WarKind.Conquest || W.endYear[v] < 0 || W.attacker[v] !== W.defender[w] || W.defender[v] !== W.attacker[w]) continue
      if (W.startYear[w] - W.endYear[v] <= 100 && (W.outcome[v] === WarOutcome.AttackerGains || W.outcome[v] === WarOutcome.Conquest || W.outcome[v] === WarOutcome.Vassalage || W.outcome[v] === WarOutcome.Tribute)) { revengeLike++; break }
    }
  }
  const ev = (t: number, x?: number) => h.events.filter((e) => e.type === t && (x === undefined || e.extra === x)).length
  const B = h.bonds
  let alliances = 0, betrayedBonds = 0
  for (let k = 0; k < B.count; k++) if (B.kind[k] === BondKind.Alliance) { alliances++; if (B.end[k] === BondEnd.Betrayed) betrayedBonds++ }
  // Hegemony (§2 rev 2): top realm share per decade, coalition decades.
  const shares: number[] = []
  let coalDec = 0, coalDec30 = 0, dec30 = 0
  const allianceRows: { a: number; b: number; s: number; e: number; c: number }[] = []
  for (const e of h.events) if (e.type === EventType.Alliance) allianceRows.push({ a: -1, b: -1, s: e.year, e: -1, c: e.extra ?? -1 })
  const alliancesK: number[] = []
  for (let k = 0; k < B.count; k++) if (B.kind[k] === BondKind.Alliance) alliancesK.push(k)
  // (bThreat is not in History: the Alliance events' extra, in bond order)
  for (let i = 0; i < alliancesK.length && i < allianceRows.length; i++) { const k = alliancesK[i]; allianceRows[i].a = B.a[k]; allianceRows[i].b = B.b[k]; allianceRows[i].e = B.endYear[k] }
  let vsTop = 0, vsTop3 = 0
  const step = Math.max(1, Math.round(10 / h.snapshotInterval))
  const topAt: number[] = []
  for (let q = 0; q < h.snapshotCount; q += step) {
    const y = q * h.snapshotInterval
    const pops = popsAt(h, q)
    let tot = 0, top = -1
    for (let p = 0; p < pops.length; p++) { tot += pops[p]; if (top < 0 || pops[p] > pops[top]) top = p }
    if (tot <= 0 || top < 0) continue
    const sh = pops[top] / tot
    shares.push(sh)
    topAt[y] = top
    const coal = allianceRows.some((r) => r.c === top && r.s <= y && (r.e < 0 || r.e > y))
    if (coal) coalDec++
    if (sh >= 0.3) { dec30++; if (coal) coalDec30++ }
  }
  for (const r of allianceRows) {
    const q = Math.min(h.snapshotCount - 1, Math.floor(r.s / h.snapshotInterval))
    const pops = popsAt(h, q)
    const order = Array.from(pops.keys()).sort((a, b) => pops[b] - pops[a])
    if (order[0] === r.c) vsTop++
    if (order.slice(0, 3).includes(r.c)) vsTop3++
  }
  const gr = h.grievances
  let open = 0
  const life: number[] = []
  for (let i = 0; i < gr.count; i++) { if (gr.endYear[i] < 0) open++; else life.push(gr.endYear[i] - gr.year[i]) }
  let peakF = 0
  for (let i = 0; i < h.faithless.length; i++) if (h.faithless[i] > peakF) peakF = h.faithless[i]
  const AR = h.armsRaces
  const raceLen: number[] = []
  let eased = 0, warEnd = 0, closed = 0
  for (let i = 0; i < AR.count; i++) { if (AR.end[i] >= 0) { closed++; raceLen.push(AR.end[i] - AR.start[i]); if (AR.endCause[i] === 2) eased++; if (AR.endCause[i] === 1) warEnd++ } }
  const gd = diag.grudges
  return {
    seed, ms, conquest, civil, alliances, joined, revengeLike, revenge, revengeShare: conquest ? +(revenge / conquest).toFixed(3) : 0,
    betrayals: ev(EventType.Betrayal), betrayal0: ev(EventType.Betrayal, 0), betrayal1: ev(EventType.Betrayal, 1), trucesBroken: ev(EventType.OathBroken, 0), alliesAttacked: ev(EventType.OathBroken, 1), betrayedBonds,
    avenged: ev(EventType.Avenged), grievances: gr.count, openGrievances: open, grievanceLifeMedian: quantile(life, 0.5), peakFaithless: +(peakF / 255 * 3).toFixed(2),
    topShareMean: +(shares.reduce((a, b) => a + b, 0) / Math.max(1, shares.length)).toFixed(3), topShareMedian: +quantile(shares, 0.5).toFixed(3), topShareP90: +quantile(shares, 0.9).toFixed(3), topShareMax: +quantile(shares, 1).toFixed(3),
    coalitionDecades: +(coalDec / Math.max(1, shares.length)).toFixed(3), coalitionDecades30: dec30 ? +(coalDec30 / dec30).toFixed(3) : null, alliancesVsTop: vsTop, alliancesVsTop3: vsTop3,
    bandwagon: ev(EventType.Bandwagon), races: AR.count, racesClosed: closed, racesEased: eased, racesWar: warEnd, raceLenMedian: quantile(raceLen, 0.5), raceWarShare: conquest ? +(raceWars / conquest).toFixed(3) : 0,
    meanDelta: gd && gd.deltaN ? +(gd.deltaSum / gd.deltaN).toFixed(3) : null, meanBreakDelta: gd && gd.breakDeltaN ? +(gd.breakDeltaSum / gd.breakDeltaN).toFixed(3) : null,
    diag: gd,
  }
}

for (const seed of seeds.length ? seeds : [1, 7, 42, 1234]) console.log(JSON.stringify(stats(seed)))
