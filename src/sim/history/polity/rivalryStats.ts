// cold wars: the stats harness (barriers-coldwar.md §5, rows CW1-CW8). Not shipped in tests.
// Run: node --experimental-strip-types src/sim/history/polity/rivalryStats.ts [--ab] [--years N] [--opts JSON] [--set CW.k=v] seeds...
// Prints one JSON line per seed (cold wars on, plus `opts`), then the CW rows over all seeds against their targets. --ab also runs
// each seed with cold wars off for CW8 (the share of wars between pairs with R >= 1 at declaration, from History.why: causes is
// switched on in both runs, recording only).

import { ColdWarEnd, CrisisOutcome, EventType, WarKind } from '../../../contract.ts'
import type { History, HistoryOptions } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import { CW } from './coldwar.ts'

const argv: string[] = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
const flag = (k: string) => argv.includes(k)
const val = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined }
const years = Number(val('--years') ?? 2000)
const extra: HistoryOptions = val('--opts') ? JSON.parse(val('--opts')!) : {}
const skip = new Set([val('--years'), val('--opts'), ...argv.filter((_, i) => argv[i - 1] === '--set')])
const seeds = argv.filter((x) => /^\d+$/.test(x) && !skip.has(x)).map(Number)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--set') continue
  const [k, v] = argv[i + 1].split('=')
  ;(CW as unknown as Record<string, number | boolean>)[k.split('.')[1]] = v === 'true' ? true : v === 'false' ? false : Number(v)
}

const median = (a: number[]) => { if (a.length === 0) return NaN; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)] }

/** Share of declared wars (not civil) whose rivalry at the roll was >= 1 (History.why). */
function rivalShare(h: History): number {
  const W = h.wars, Y = h.why?.wars
  if (!Y) return NaN
  let n = 0, k = 0
  for (let w = 0; w < W.count && w < Y.rivalry.length; w++) { if (W.kind[w] === WarKind.CivilWar) continue; n++; if (Y.rivalry[w] >= 128) k++ }
  return n > 0 ? k / n : NaN
}

interface Row { seed: number; ms: number; n: number; long: number; became: number; dur: number[]; proxies: number[]; ends: number[]; crises: number; escalated: number; cwYears: number; directDuring: number; directBefore: number; partDuring: number; partBefore: number; spanYears: number; rivalOn: number; rivalOff: number; maxProxies: number; defections: number; gate: number[]; sphereN: number; aidBattles: number; aidPaid: number; aidUnpaid: number; restraintMean: number; restraintN: number; conquestShare: number; calmed: number; wars: number; looked: number; eligible: number }

function stats(seed: number): Row {
  const opts: HistoryOptions = { years, ...extra, coldWars: true, causes: true }
  const t0 = Date.now()
  const { history: h, diag } = runHistory(generateWorld(seed), opts)
  const ms = Date.now() - t0
  const C = h.coldWars, W = h.wars
  const d = diag.coldWars!
  const dur: number[] = [], proxies: number[] = [], ends = [0, 0, 0, 0, 0]
  let crises = 0, escalated = 0, cwYears = 0, directDuring = 0, directBefore = 0, partDuring = 0, partBefore = 0, spanYears = 0, maxProxies = 0, defections = 0
  for (let i = 0; i < C.count; i++) {
    const a = C.a[i], b = C.b[i], st = C.start[i], en = C.end[i] >= 0 ? C.end[i] : years
    const L = en - st
    dur.push(L); proxies.push(C.proxies[i]); if (C.proxies[i] > maxProxies) maxProxies = C.proxies[i]
    defections += C.defections[i]
    if (C.end[i] >= 0) ends[C.endCause[i]]++
    cwYears += L
    // stability-instability: wars the principals fought (as a side) during vs the 200 years before (rates a year); participation adds proxies
    // stability-instability: wars between the principals (the HotWar that ends it included) during vs the same span before;
    // the principals' wars with anyone, plus their proxies, during vs before
    const b0 = st - 200 > 0 ? st - 200 : 0
    for (let w = 0; w < W.count; w++) {
      if (W.kind[w] === WarKind.CivilWar) continue
      const p = W.attacker[w], q = W.defender[w]
      if (p !== a && p !== b && q !== a && q !== b) continue
      const y = W.startYear[w]
      const direct = (p === a && q === b) || (p === b && q === a)
      if (y >= st && y <= en) { if (direct) directDuring++; if (y < en) partDuring++ }
      else if (y >= b0 && y < st) { if (direct) directBefore++; partBefore++ }
    }
    spanYears += st - b0
    partDuring += C.proxies[i]
  }
  for (const e of h.events) if (e.type === EventType.Crisis) { crises++; if (e.extra === CrisisOutcome.Escalated) escalated++ }
  let rivalOff = NaN
  if (flag('--ab')) { const { history: h0 } = runHistory(generateWorld(seed), { ...opts, coldWars: false }); rivalOff = rivalShare(h0) }
  return { seed, ms, n: C.count, long: d.longRivalries, became: d.longBecame, dur, proxies, ends, crises, escalated, cwYears, directDuring, directBefore, partDuring, partBefore, spanYears, rivalOn: rivalShare(h), rivalOff, maxProxies, defections, gate: d.gate, sphereN: d.sphereN, aidBattles: d.aidBattles, aidPaid: d.aidPaid, aidUnpaid: d.aidUnpaid, restraintMean: d.restraintN > 0 ? d.restraintSum / d.restraintN : 1, restraintN: d.restraintN, conquestShare: d.conquestSteps / Math.max(1, d.greatSteps), calmed: d.calmed, wars: W.count, looked: d.proxyLooked, eligible: d.proxyEligible }
}

const rows: Row[] = []
for (const seed of seeds) {
  const r = stats(seed)
  rows.push(r)
  console.log(JSON.stringify(r))
}
const sum = (f: (r: Row) => number) => rows.reduce((t, r) => t + f(r), 0)
const all = (f: (r: Row) => number[]) => rows.flatMap(f)
const ended = sum((r) => r.ends.reduce((x, y) => x + y, 0))
const share = (k: number) => (ended > 0 ? sum((r) => r.ends[k]) / ended : NaN)
const pr = all((r) => r.proxies)
const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : String(x))
const lines: [string, string, string][] = [
  ['CW1 long rivalries -> cold war', fmt(sum((r) => r.became) / Math.max(1, sum((r) => r.long))), '0.10-0.35'],
  ['CW2 cold wars per seed', rows.map((r) => r.n).join(' '), '1-6; >= 1 on 3 of 4'],
  ['CW3 median duration (y)', fmt(median(all((r) => r.dur))), '40-150'],
  ['CW4 proxies: median, share >= 1, max', `${fmt(median(pr))}, ${fmt(pr.filter((x) => x >= 1).length / Math.max(1, pr.length))}, ${Math.max(0, ...pr)}`, '1-5; >= 0.6; <= 12'],
  ['CW5 ends Thaw/Hot/Coll+Ecl/Ended', `${fmt(share(ColdWarEnd.Thaw))}/${fmt(share(ColdWarEnd.HotWar))}/${fmt(share(ColdWarEnd.Collapsed) + share(ColdWarEnd.Eclipsed))}/${fmt(share(ColdWarEnd.Ended))}`, '0.2-0.5/0.2-0.5/0.1-0.4; none > 0.6'],
  ['CW6 crises per cw-century; escalated share', `${fmt((100 * sum((r) => r.crises)) / Math.max(1, sum((r) => r.cwYears)))}; ${fmt(sum((r) => r.escalated) / Math.max(1, sum((r) => r.crises)))}`, '1-5; 0.05-0.25'],
  ['CW7 principals at war: direct during/before; all incl. proxies', `${fmt(sum((r) => r.directDuring) / Math.max(1, sum((r) => r.cwYears)) / (sum((r) => r.directBefore) / Math.max(1, sum((r) => r.spanYears))))}; ${fmt(sum((r) => r.partDuring) / Math.max(1, sum((r) => r.cwYears)) / (sum((r) => r.partBefore) / Math.max(1, sum((r) => r.spanYears))))}`, '< 0.5; >= 1'],
  ['CW8 wars with R >= 1: on vs off', `${fmt(median(rows.map((r) => r.rivalOn)))} vs ${fmt(median(rows.map((r) => r.rivalOff)))}`, 'not lower by > 0.05'],
]
if (rows.length > 1) for (const [k, v, t] of lines) console.log(`${k.padEnd(62)} ${v.padEnd(28)} target ${t}`)
