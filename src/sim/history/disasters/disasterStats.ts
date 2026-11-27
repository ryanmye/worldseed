// disasters: the stats harness (disasters-climate.md §7). Run with:
//   node --experimental-strip-types src/sim/history/disasters/disasterStats.ts [--off] [--feedback] [--json] [--years N] [seed ...]   (default 1 7 42 1234)
// Each seed runs with disasters on and (unless --on-only) off, on the same world, and prints the plan's targets: eruptions by
// VEI, volcanic winters, earthquake rows with deaths, CityDestroyed, tsunamis, megadroughts and the share of regions in drought
// at once, epochs, harvest statistics (population-weighted mean, sd, lag-1, sd of 30-year means), famine events and starvation
// deaths on/off, the response table to global bad years and to volcanic-winter years, the worst 10-year world population fall,
// world population at the end on/off, peoples extinct, the largest single event's deaths over world population, and how often
// the hard caps bound. --off prints only the off run's baseline figures. --feedback runs the disasters with the Phase 2
// feedback (DX.feedback, step 10) and adds its figures: region-years bad and with the stores run out, reliefs paid / unpaid.

import { DisasterKind, EventType } from '../../../contract.ts'
import type { HistoryOptions } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { createRunner } from '../index.ts'
import type { HistoryState } from '../state.ts'
import { DX } from './params.ts'

interface Run {
  hw: number[]; pop: number[]; starve: number[]
  events: { year: number; type: number; settlement: number }[]
  peoplesAlive: number
  h: ReturnType<ReturnType<typeof createRunner>['advance']>['history']
  diag: ReturnType<ReturnType<typeof createRunner>['advance']>['diag']
}

function runOne(seed: number, years: number, on: boolean): Run {
  const w = generateWorld(seed)
  const hw: number[] = [1], pop: number[] = [0], starve: number[] = [0]
  const opts: HistoryOptions = { years, disasters: on }
  const runner = createRunner(w, opts, (s: HistoryState) => {
    let wp = 0, wh = 0, st = 0
    const dx = s.dx
    for (const id of s.living) {
      const p = s.pop[id]
      wp += p
      wh += p * s.harvest[s.weatherRegion[s.cell[id]]] * (dx !== null && id < dx.cap ? dx.local[id] : 1)
      if (s.supply[id] < p) st += 0.5 * (p - s.supply[id])
    }
    hw[s.year] = wp > 0 ? wh / wp : 1
    pop[s.year] = wp
    starve[s.year] = st
  })
  const r = runner.advance(years)
  const h = r.history
  const S = h.settlements.length
  const last = (h.snapshotCount - 1) * S
  const alive = new Set<number>()
  for (let id = 0; id < S; id++) if (h.population[last + id] > 0) alive.add(h.settlements[id].people)
  return { hw, pop, starve, events: h.events, peoplesAlive: alive.size, h, diag: r.diag }
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) * (x - m)))) }
function lag1(a: number[]): number { const m = mean(a); let n = 0, d = 0; for (let i = 1; i < a.length; i++) n += (a[i] - m) * (a[i - 1] - m); for (const x of a) d += (x - m) * (x - m); return d > 0 ? n / d : 0 }

function counts(r: Run, type: number, Y: number): Int32Array {
  const a = new Int32Array(Y)
  for (const e of r.events) if (e.type === type && e.year < Y) a[e.year]++
  return a
}

/** Rate in the windows after flagged years over the rate after the others (years >= 300). */
function resp(a: Int32Array, flag: (y: number) => boolean, lo: number, hi: number): number {
  let bs = 0, bn = 0, ns = 0, nn = 0
  for (let y = 300; y < a.length - hi; y++) {
    let x = 0
    for (let l = lo; l <= hi; l++) x += a[y + l]
    if (flag(y)) { bs += x; bn++ } else { ns += x; nn++ }
  }
  return bn > 0 && nn > 0 && ns > 0 ? bs / bn / (ns / nn) : NaN
}

function worstFall(pop: number[], span: number, from: number): number {
  let worst = 0
  for (let y = from; y + span < pop.length; y++) if (pop[y] > 0) { const d = 1 - pop[y + span] / pop[y]; if (d > worst) worst = d }
  return worst
}

function measure(r: Run, Y: number) {
  const hw = r.hw.slice(1)
  const dec: number[] = []
  for (let i = 0; i + 30 <= hw.length; i += 30) dec.push(mean(hw.slice(i, i + 30)))
  const famine = counts(r, EventType.Famine, Y)
  let fam = 0
  for (const x of famine) fam += x
  let st = 0, peak = 0, peakShare = 0
  for (let y = 1; y < r.starve.length; y++) { st += r.starve[y]; if (r.starve[y] > peak) peak = r.starve[y]; if (r.pop[y] > 0 && r.starve[y] / r.pop[y] > peakShare) peakShare = r.starve[y] / r.pop[y] }
  return {
    hMean: mean(hw), hSd: sd(hw), hLag1: lag1(hw), hSd30: sd(dec),
    famine: fam, starve: st, peakStarve: peak, peakStarveShare: peakShare,
    worst10: worstFall(r.pop, 10, 400), worst50: worstFall(r.pop, 50, 0), popEnd: r.pop[Y - 1], peoples: r.peoplesAlive,
  }
}

function disasterFigures(r: Run, Y: number) {
  const d = r.h.disasters
  const vei = [0, 0, 0]
  let quakeDead = 0, tsunamis = 0, mega = 0, epochs = 0, maxEvent = 0, maxEventRow = -1, floods = 0, droughts = 0
  for (let i = 0; i < d.count; i++) {
    const k = d.kind[i]
    if (k === DisasterKind.Eruption) vei[d.size[i] - 5]++
    if (k === DisasterKind.Earthquake && d.struck[i] > 0) quakeDead++
    if (k === DisasterKind.Tsunami && d.struck[i] > 0) tsunamis++
    if (k === DisasterKind.Flood) floods++
    if (k === DisasterKind.Drought) { droughts++; if (d.size[i] >= DX.megaYears) mega++ }
    if (k === DisasterKind.ColdEpoch || k === DisasterKind.WarmEpoch) epochs++
    const wp = r.pop[d.year[i]] || 1
    if (d.deaths[i] / wp > maxEvent) { maxEvent = d.deaths[i] / wp; maxEventRow = i }
  }
  // regions in drought at once (share of land regions)
  const dx = r.diag.disasterState!
  let landR = 0
  for (let q = 0; q < dx.R; q++) if (dx.rLand[q] > 0) landR++
  const inD = new Int32Array(Y)
  for (let i = 0; i < d.count; i++) if (d.kind[i] === DisasterKind.Drought) { const e = d.endYear[i] < 0 ? Y - 1 : d.endYear[i]; for (let y = d.year[i]; y <= e && y < Y; y++) inD[y]++ }
  let maxD = 0
  for (const x of inD) if (x > maxD) maxD = x
  const dg = r.diag.disasters!
  return {
    vei, winters: dg.winterYears.length, quakeDead, destroyed: dg.destroyed, tsunamis, floods, droughts, mega, maxDroughtShare: maxD / landR, epochs,
    maxEventShare: maxEvent, maxEventKind: maxEventRow >= 0 ? d.kind[maxEventRow] : -1,
    clampLoss: dg.clampLoss / Math.max(1, dg.regionYears), clampGain: dg.clampGain / Math.max(1, dg.regionYears), clampVolc: dg.clampVolc / Math.max(1, dg.regionYears),
    winterYears: dg.winterYears,
    fbBad: dg.fbBad, fbExhausted: dg.fbExhausted, fbRelief: dg.fbRelief, fbUnpaid: dg.fbUnpaid, regionYears: dg.regionYears,
  }
}

function responses(r: Run, Y: number, winterYears: number[]) {
  const hw = r.hw
  const win = new Set(winterYears)
  const bad = (y: number) => hw[y] < 0.85
  const vw = (y: number) => win.has(y)
  const tab: Record<string, [number, number, number, number]> = {}
  const rows: [string, number, number, number][] = [
    ['famine+0', EventType.Famine, 0, 0], ['migration+0..2', EventType.Migration, 0, 2], ['abandoned+0..3', EventType.Abandoned, 0, 3],
    ['revolt+1..10', EventType.Revolt, 1, 10], ['wars+1..5', EventType.WarDeclared, 1, 5], ['polityEnded+1..15', EventType.PolityEnded, 1, 15],
  ]
  for (const [name, type, lo, hi] of rows) {
    const a = counts(r, type, Y)
    let nb = 0
    for (let y = 300; y < Y; y++) if (bad(y)) nb++
    tab[name] = [resp(a, bad, lo, hi), nb, resp(a, vw, lo, hi), win.size]
  }
  return tab
}

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a')

const argv: string[] = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
const json = argv.includes('--json')
const offOnly = argv.includes('--off')
if (argv.includes('--feedback')) DX.feedback = true
const yi = argv.indexOf('--years')
const years = yi >= 0 ? Number(argv[yi + 1]) : 2000
const seeds = argv.filter((a, i) => !a.startsWith('--') && (yi < 0 || i !== yi + 1)).map(Number)
const SEEDS = seeds.length ? seeds : [1, 7, 42, 1234]
const Y = years + 1
for (const seed of SEEDS) {
  const t0 = Date.now()
  const off = runOne(seed, years, false)
  const mOff = measure(off, Y)
  if (offOnly) { console.log(JSON.stringify({ seed, off: mOff })); continue }
  const on = runOne(seed, years, true)
  const mOn = measure(on, Y)
  const dz = disasterFigures(on, Y)
  const rsp = responses(on, Y, dz.winterYears)
  const out = { seed, years, ms: Date.now() - t0, off: mOff, on: mOn, disasters: { ...dz, winterYears: undefined }, responses: rsp }
  if (json) { console.log(JSON.stringify(out)); continue }
  console.log(`\n=== seed ${seed} (${years} y, ${out.ms} ms) ===`)
  console.log(`eruptions VEI5/6/7 ${dz.vei.join('/')} [120-220 / 10-35 / 0-6]; volcanic winters ${dz.winters} [6-25]`)
  console.log(`quake rows with deaths ${dz.quakeDead} [30-150]; CityDestroyed ${dz.destroyed} [2-15]; tsunamis ${dz.tsunamis} [1-8]; flood rows ${dz.floods}`)
  console.log(`droughts ${dz.droughts}, megadroughts ${dz.mega} [2-12]; most regions in drought at once ${f(dz.maxDroughtShare)} [<= 0.15]; epochs ${dz.epochs} [3-10]`)
  console.log(`harvest mean ${f(mOn.hMean, 3)} (off ${f(mOff.hMean, 3)}) [on-off within 0.01]; sd ${f(mOn.hSd, 3)} (off ${f(mOff.hSd, 3)}) [<= 0.08]; lag1 ${f(mOn.hLag1)} (off ${f(mOff.hLag1)}) [0.6-0.8]; sd30 ${f(mOn.hSd30, 3)} (off ${f(mOff.hSd30, 3)}) [0.03-0.05]`)
  console.log(`famine events ${mOn.famine} / off ${mOff.famine} = ${f(mOn.famine / mOff.famine)} [0.9-1.6]; starvation ${Math.round(mOn.starve)} / ${Math.round(mOff.starve)} = ${f(mOn.starve / mOff.starve)} [0.9-1.8]; peak year ${Math.round(mOn.peakStarve)} (off ${Math.round(mOff.peakStarve)}), peak share ${f(mOn.peakStarveShare, 3)} (off ${f(mOff.peakStarveShare, 3)})`)
  console.log(`worst 10-y fall ${f(mOn.worst10 * 100, 1)}% (off ${f(mOff.worst10 * 100, 1)}%) [<= 25%]; worst 50-y fall (yearly) ${f(mOn.worst50 * 100, 1)}% (off ${f(mOff.worst50 * 100, 1)}%)`)
  console.log(`world pop at end ${Math.round(mOn.popEnd)} / ${Math.round(mOff.popEnd)} = ${f(mOn.popEnd / mOff.popEnd)} [0.8-1.05]; peoples alive ${mOn.peoples} (off ${mOff.peoples}) [loss <= 1]`)
  console.log(`largest single event: ${f(dz.maxEventShare * 100, 2)}% of world pop (kind ${dz.maxEventKind}) [<= 3%]; caps bound: region loss ${f(dz.clampLoss * 100, 2)}%, gain ${f(dz.clampGain * 100, 2)}%, volcanic ${f(dz.clampVolc * 100, 2)}%${dz.clampLoss > 0.05 || dz.clampGain > 0.05 || dz.clampVolc > 0.05 ? '  WARNING: a cap binds in more than 5% of region-years' : ''}`)
  if (DX.feedback) console.log(`feedback: bad region-years ${dz.fbBad}, stores run out ${dz.fbExhausted} (${f(dz.fbExhausted / Math.max(1, dz.regionYears) * 100, 2)}% of land region-years); reliefs paid ${dz.fbRelief}, unpaid ${dz.fbUnpaid}`)
  console.log('response (rate ratio): global bad years (n) | volcanic-winter years (n)')
  for (const [k, v] of Object.entries(rsp)) console.log(`  ${k.padEnd(18)} ${f(v[0])} (${v[1]}) | ${f(v[2])} (${v[3]})`)
}
