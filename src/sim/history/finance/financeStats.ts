// finance: the stats harness (state-finances.md §6). Not shipped in tests.
// Run: node --experimental-strip-types src/sim/history/finance/financeStats.ts [--off] [--oaths --balance --arms] [--set FIN.x=v] seeds...
// One JSON line per seed: bankrupt-war share, defaults, repudiations, ruined houses, merchant capital lost, debt share of
// Kingdom+ polity-years 1500-2000, median loan rate, rate after a default, Taxes revolts, wars, runtime.

import { EventType, RevoltCause, WarKind } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import { FIN } from './params.ts'

const argv: string[] = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
const flag = (k: string) => argv.includes(k)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--set') continue
  const [k, v] = argv[i + 1].split('=')
  ;(FIN as unknown as Record<string, number>)[k.split('.')[1]] = Number(v)
}
const seeds = argv.filter((x, i) => /^\d+$/.test(x) && argv[i - 1] !== '--set').map(Number)
const q50 = (a: number[]) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)] }

for (const seed of seeds.length ? seeds : [1, 7, 42, 1234]) {
  const t0 = Date.now()
  const { history: h, diag } = runHistory(generateWorld(seed), { years: 2000, finance: !flag('--off'), oaths: flag('--oaths'), balance: flag('--balance'), arms: flag('--arms') })
  const ms = Date.now() - t0
  const ev = (t: number) => h.events.filter((e) => e.type === t)
  const W = h.wars
  let ended = 0, conquest = 0
  for (let w = 0; w < W.count; w++) { if (W.endYear[w] >= 0) ended++; if (W.kind[w] === WarKind.Conquest) conquest++ }
  const revolts = ev(EventType.Revolt)
  const taxes = revolts.filter((e) => e.extra === RevoltCause.Taxes).length
  const P = h.polities.length
  let yrs = 0, indebted = 0
  for (let s = 0; s < h.snapshotCount; s++) {
    const y = s * h.snapshotInterval
    if (y < 1500) continue
    for (let p = 0; p < P; p++) { if (h.crownRevenue.length && h.crownRevenue[s * P + p] >= FIN.minRev) { yrs++; if (h.crownDebt[s * P + p] > 0) indebted++ } }
  }
  const L = h.loans
  let lost = 0, lent = 0
  for (let k = 0; k < L.count; k++) { lost += L.lost[k]; lent += L.peak[k] }
  const fd = diag.finance
  console.log(JSON.stringify({
    seed, ms, finance: !flag('--off'), conquest, warsEnded: ended, bankrupt: ev(EventType.WarBankrupt).length, bankruptShare: ended ? +(ev(EventType.WarBankrupt).length / ended).toFixed(3) : 0,
    unpaid: ev(EventType.ArmyUnpaid).length, defaults: ev(EventType.CrownDefault).length, repudiations: ev(EventType.Repudiation).length, ruined: ev(EventType.HousesRuined).length,
    loans: L.count, lostShareOfLent: lent ? +(lost / lent).toFixed(3) : 0, debtYearsShare: yrs ? +(indebted / yrs).toFixed(3) : 0, medianRate: fd ? +q50(fd.rates).toFixed(3) : 0,
    revolts: revolts.length, taxRevoltShare: revolts.length ? +(taxes / revolts.length).toFixed(3) : 0, alive2000: h.polities.filter((x) => x.endedYear < 0).length,
    diag: fd ? { ...fd, rates: fd.rates.length, defaultLog: fd.defaultLog.length / 5 } : null,
  }))
}
